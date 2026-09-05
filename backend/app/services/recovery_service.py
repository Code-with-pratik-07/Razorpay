"""Policy-controlled recovery orchestration; Groq is advisory only."""

from datetime import datetime, timezone, timedelta
from typing import Any
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.ai.groq_service import GroqRecoveryAdvisor, GroqUnavailableError, fallback_decision
from app.ml.predict import predict_recovery
from app.models.payment_case import CaseStatus, PaymentCase, RecoveryAction, NextActionType
from app.models.recovery_policy import RecoveryPolicy
from app.schemas.recovery import AIDecision
from app.services.audit_service import list_audit_events, log_audit_event
from app.services.channel_service import dispatch_channel_communication, evaluate_channel_suitability
from app.services.notification_service import send_recovery_email
from app.services.policy_service import check_recovery_policy
from app.services.razorpay_service import RazorpayService, RazorpayServiceError


# ---------------------------------------------------------------------------
# ML routing thresholds — application-level constants; no schema change needed.
# These drive the three-way routing: HIGH → automatic, UNCERTAIN → human review,
# LOW → stopped (ABANDONED status, which already exists in CaseStatus).
# ---------------------------------------------------------------------------
ML_HIGH_THRESHOLD = 0.60       # probability >= this → automatic recovery
ML_UNCERTAIN_THRESHOLD = 0.40  # probability >= this but < HIGH → human review
# probability < ML_UNCERTAIN_THRESHOLD → ABANDONED (no recovery attempt)


def ml_routing_decision(recovery_probability: float | None, is_cold_start: bool = False) -> str:
    """Classify ML probability into HIGH / UNCERTAIN / LOW / COLD_START routing bucket."""
    if is_cold_start:
        return "COLD_START"
    if recovery_probability is None or recovery_probability < ML_UNCERTAIN_THRESHOLD:
        return "LOW"
    if recovery_probability < ML_HIGH_THRESHOLD:
        return "UNCERTAIN"
    return "HIGH"


def _policy(db: Session) -> RecoveryPolicy:
    policy = db.scalar(select(RecoveryPolicy).order_by(RecoveryPolicy.created_at.desc()))
    if policy is None:
        policy = RecoveryPolicy()
        db.add(policy); db.commit(); db.refresh(policy)
    return policy


def _features(case: PaymentCase) -> dict[str, Any]:
    customer = case.customer
    return {
        "amount": case.amount, "customer_lifetime_value": customer.lifetime_value,
        "customer_successful_payments": customer.successful_payments,
        "customer_failed_payments": customer.failed_payments,
        "time_since_failure": max(0, (datetime.now(timezone.utc).replace(tzinfo=None) - case.created_at).total_seconds() / 3600),
        "payment_method": case.payment_method if case.payment_method in {"card", "upi", "netbanking"} else "card",
        "failure_count": customer.failed_payments,
        "failure_reason": case.failure_reason if case.failure_reason in {"insufficient_funds", "card_expired", "network_timeout", "fraud_suspicion", "bank_declined"} else "bank_declined",
        "customer_age_days": max(1, (datetime.now(timezone.utc).replace(tzinfo=None) - customer.created_at).days),
    }


def _last_ai_decision(db: Session, case_id: str) -> AIDecision | None:
    for event in reversed(list_audit_events(db, case_id)):
        if event.event_type == "ai_analysis":
            try: return AIDecision.model_validate(event.event_data)
            except Exception: return None
    return None


def analyze_case(db: Session, case: PaymentCase, advisor: GroqRecoveryAdvisor | None = None, recalculate_ml: bool = False) -> dict[str, Any]:
    if case.status not in {CaseStatus.FAILED, CaseStatus.ABANDONED, CaseStatus.HUMAN_REVIEW}:
        return {"error": f"Case is in '{case.status.value}' state and cannot be analyzed."}
    
    original_status = case.status
    case.status = CaseStatus.ANALYZING
    db.commit()
    features = _features(case)
    if case.recovery_probability is None or recalculate_ml:
        prediction = predict_recovery(features)
        case.recovery_probability = prediction["recovery_probability"]
    else:
        prediction = {
            "recovery_probability": case.recovery_probability,
            "risk_level": "PRESERVED",
            "feature_summary": features
        }
    
    is_cold_start = (case.customer.successful_payments + case.customer.failed_payments) < 3
    ml_decision = ml_routing_decision(case.recovery_probability, is_cold_start)
    
    if ml_decision == "COLD_START":
        case.max_retries = 2
    elif ml_decision == "HIGH":
        case.max_retries = 3
    elif ml_decision == "UNCERTAIN":
        case.max_retries = 2
    else:
        case.max_retries = 1

    log_audit_event(db, case.id, "customer_analyzed", {"customer_id": case.customer_id, "is_cold_start": is_cold_start, "max_retries": case.max_retries})
    log_audit_event(db, case.id, "ml_prediction", prediction)
    policy_result = check_recovery_policy(case, _policy(db))
    case.policy_check_passed = policy_result.allowed
    case.policy_reason = policy_result.reason
    db.commit()
    log_audit_event(db, case.id, "policy_check", policy_result.to_dict())
    permitted = {"retry", "payment_link"} if policy_result.allowed else set()
    context = {"case_id": case.id, "recovery_probability": case.recovery_probability, "failure_reason": case.failure_reason, "policy_reason": policy_result.reason, "is_cold_start": is_cold_start}
    try:
        decision = (advisor or GroqRecoveryAdvisor()).advise(context, permitted)
    except GroqUnavailableError:
        decision = fallback_decision(context, permitted, "AI unavailable")
        log_audit_event(db, case.id, "ai_unavailable", {"fallback": True})
    log_audit_event(db, case.id, "ai_analysis", decision.model_dump())
    case.recovery_action = RecoveryAction(decision.recommended_action) if decision.recommended_action in RecoveryAction._value2member_map_ else RecoveryAction.NONE

    # -----------------------------------------------------------------
    # Three-way ML routing — determines next status for this case.
    # Policy is the authoritative safety gate: if policy blocks, the case
    # goes to HUMAN_REVIEW regardless of ML probability.
    # Among policy-allowed cases, ML probability determines routing.
    # -----------------------------------------------------------------
    if not policy_result.allowed:
        case.status = CaseStatus.HUMAN_REVIEW
        log_audit_event(db, case.id, "human_escalation", {
            "reason": policy_result.reason,
            "source": "policy",
            "ml_decision": ml_decision,
        })
    else:
        status_to_keep = (
            CaseStatus.HUMAN_REVIEW if original_status == CaseStatus.HUMAN_REVIEW
            else (CaseStatus.RECOVERING if original_status == CaseStatus.RECOVERING else CaseStatus.FAILED)
        )
        if ml_decision == "LOW":
            case.status = status_to_keep
            log_audit_event(db, case.id, "low_probability_routing", {
                "reason": "Predicted recovery probability is low. 1 recovery attempt allowed.",
                "recovery_probability": case.recovery_probability,
                "ml_decision": "LOW",
                "max_retries": 1,
                "threshold": ML_UNCERTAIN_THRESHOLD,
            })
        elif ml_decision == "UNCERTAIN":
            case.status = status_to_keep
            log_audit_event(db, case.id, "uncertain_probability_routing", {
                "reason": "Recovery confidence is uncertain, but an automatic recovery attempt is permitted.",
                "recovery_probability": case.recovery_probability,
                "ml_decision": "UNCERTAIN",
                "threshold": ML_HIGH_THRESHOLD,
                "source": "ml_routing",
            })
        elif ml_decision == "COLD_START":
            case.status = status_to_keep
            log_audit_event(db, case.id, "cold_start_routing", {"message": "Using COLD_START recovery policy", "max_retries": 2})
        else:  # HIGH
            case.status = status_to_keep

    # -----------------------------------------------------------------
    # Channel Intelligence evaluation
    # -----------------------------------------------------------------
    channel_rec = evaluate_channel_suitability(case, case.customer)
    log_audit_event(db, case.id, "channel_intelligence_evaluated", {
        "recommended_channel": channel_rec.recommended_channel,
        "suitability_score": channel_rec.suitability_score,
        "channel_scores": channel_rec.channel_scores,
        "reason": channel_rec.reason,
        "alternatives": channel_rec.alternatives,
    })

    db.commit()
    return {
        "prediction": prediction,
        "policy": policy_result.to_dict(),
        "ai": decision,
        "ml_decision": ml_decision,
        "channel_intelligence": channel_rec,
    }


def _schedule_next_action(db: Session, case: PaymentCase, action_type: NextActionType, dt: datetime):
    case.next_action_type = action_type
    case.next_action_at = dt
    db.commit()
    log_audit_event(db, case.id, "recovery_scheduled", {
        "next_action_type": action_type.value,
        "next_action_at": dt.isoformat(),
    })

def execute_recovery(db: Session, case: PaymentCase, automatic: bool = False) -> dict[str, Any]:
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # 1. Guard against terminal states
    if case.status == CaseStatus.ABANDONED:
        return {
            "action": "stopped",
            "status": case.status.value,
            "message": "Recovery probability was too low or attempts exhausted.",
            "payment_link_url": None,
        }
    if case.status in {CaseStatus.RECOVERED, CaseStatus.CLOSED}:
        return {
            "action": "no_action",
            "status": case.status.value,
            "message": f"Recovery is already complete for this case. No further actions permitted.",
            "payment_link_url": None,
        }

    # 2. Identify if there's a valid active payment link
    has_active_link = False
    if case.payment_link_expires_at:
        if case.payment_link_expires_at > now:
            has_active_link = True
    elif case.status == CaseStatus.RECOVERING:
        has_active_link = True
        
        # Check if it's a mocked demo link that we want to override in manual mode
        events = list_audit_events(db, case.id)
        last_link_event = next((e for e in reversed(events) if e.event_type == "payment_link_created"), None)
        is_mock = last_link_event and last_link_event.event_data.get("url") == "mock_demo_link"
        
        if is_mock and not automatic:
            has_active_link = False # allow manual override of a mock link

    # 3. Active Link Processing (Reminders & Expiry)
    if has_active_link:
        # 3a. Are we scheduled for an expiry check but it's not expired yet?
        # Alternatively, if we don't have an expiry check but it's an active link, it's just no action.
        if case.next_action_type == NextActionType.EXPIRY_CHECK and case.next_action_at and case.next_action_at > now:
            return {
                "action": "no_action",
                "status": case.status.value,
                "message": "Payment link is active. Waiting for expiry or payment.",
                "payment_link_url": None,
            }
        
        # Guard: if it's RECOVERING but hasn't reached schedule, don't just spam reminders
        # We'll just return no_action if there's no next_action_at or if it's in the future.
        if case.next_action_at is None or case.next_action_at > now:
            return {
                "action": "no_action",
                "status": case.status.value,
                "message": "Recovery is already in progress.",
                "payment_link_url": None,
            }
        
        # 3b. Send a Reminder
        # Send a reminder without incrementing retry_count or creating a new link.
        # Find the URL from the last link event
        url = "mock_demo_link"
        events = list_audit_events(db, case.id)
        last_link_event = next((e for e in reversed(events) if e.event_type == "payment_link_created"), None)
        if last_link_event:
            url = last_link_event.event_data.get("url")

        # Send notification via Channel Intelligence
        dispatch_channel_communication(db, case, url, automatic=automatic)
        log_audit_event(db, case.id, "payment_reminder_sent", {"url": url})

        # Calculate next schedule
        # Attempt 1 -> Reminder 1 (+24h). Reminder 1 -> Reminder 2 (+72h).
        reminder_count = sum(1 for e in events if e.event_type == "payment_reminder_sent")
        if reminder_count == 0:
            # We just sent Reminder 1. Schedule Reminder 2 at last_retry_at + 72h
            next_t = (case.last_retry_at or now) + timedelta(hours=72)
            if case.payment_link_expires_at and next_t > case.payment_link_expires_at:
                _schedule_next_action(db, case, NextActionType.EXPIRY_CHECK, case.payment_link_expires_at)
            else:
                _schedule_next_action(db, case, NextActionType.REMINDER, next_t)
        else:
            # We just sent Reminder 2. Wait for expiry.
            if case.payment_link_expires_at:
                _schedule_next_action(db, case, NextActionType.EXPIRY_CHECK, case.payment_link_expires_at)

        return {
            "action": "reminder",
            "status": case.status.value,
            "message": "Reminder sent for active payment link.",
            "payment_link_url": url,
        }

    # 4. No active link. Are we abandoning?
    if case.retry_count >= case.max_retries:
        case.status = CaseStatus.ABANDONED
        case.next_action_type = NextActionType.NONE
        db.commit()
        log_audit_event(db, case.id, "recovery_abandoned", {
            "reason": f"Maximum recovery attempts ({case.max_retries}) exhausted and final link expired/failed."
        })
        return {
            "action": "abandoned",
            "status": case.status.value,
            "message": "Recovery abandoned. All attempts exhausted.",
            "payment_link_url": None,
        }

    # 5. Execute new recovery attempt (Policy check)
    original_status = case.status
    policy_result = check_recovery_policy(case, _policy(db), automatic=automatic)
    case.policy_check_passed = policy_result.allowed
    case.policy_reason = policy_result.reason
    db.commit()

    # Deduplication guard: do not create redundant policy_check events if recently recorded
    recent_events = list_audit_events(db, case.id)
    has_recent_policy = any(
        e.event_type == "policy_check" and (now - e.timestamp).total_seconds() < 10.0
        for e in reversed(recent_events)
    )
    if not has_recent_policy:
        log_audit_event(db, case.id, "policy_check", policy_result.to_dict())

    if not policy_result.allowed:
        case.status = CaseStatus.HUMAN_REVIEW
        case.recovery_action = RecoveryAction.ESCALATE
        case.next_action_type = NextActionType.NONE
        db.commit()
        log_audit_event(db, case.id, "human_escalation", {"reason": policy_result.reason, "source": "policy"})
        return {"action": "escalate", "status": case.status.value, "message": policy_result.reason, "payment_link_url": None}

    # Decide Action
    decision = _last_ai_decision(db, case.id) or fallback_decision(
        {"recovery_probability": case.recovery_probability},
        {"payment_link", "retry"},
    )
    requested = decision.recommended_action
    
    if not automatic:
        action = "payment_link"
        log_audit_event(db, case.id, "human_approval", {"approved_by": "Risk Ops Specialist", "source": "manual", "notes": "Manual review approved."})
    elif requested == "retry":
        action = "payment_link"
    elif requested in {"payment_link", "escalate", "message"}:
        action = requested
    else:
        action = "escalate"
        log_audit_event(db, case.id, "error", {"operation": "recovery_action_validation", "safe_message": "Invalid recovery action; escalated."})
    
    log_audit_event(db, case.id, "recovery_started", {"advisory_action": requested, "executed_action": action, "automatic": automatic})

    if action == "escalate":
        case.status = CaseStatus.HUMAN_REVIEW
        case.recovery_action = RecoveryAction.ESCALATE
        case.next_action_type = NextActionType.NONE
        db.commit()
        log_audit_event(db, case.id, "human_escalation", {"reason": "Advisory escalation"})
        return {"action": action, "status": case.status.value, "message": "Escalated to human review.", "payment_link_url": None}

    if action == "message":
        case.recovery_action = RecoveryAction.MESSAGE
        case.next_action_type = NextActionType.NONE
        db.commit()
        log_audit_event(db, case.id, "recovery_message_generated", {
            "channel": "advisory",
            "message": decision.customer_message,
            "source": decision.source,
        })
        return {
            "action": "message",
            "status": case.status.value,
            "message": "Advisory recovery message recorded. No Payment Link was created.",
            "payment_link_url": None,
        }

    # Execute Payment Link
    updated = db.query(PaymentCase).filter(
        PaymentCase.id == case.id,
        PaymentCase.status == case.status
    ).update({"status": CaseStatus.RECOVERING}, synchronize_session=False)

    if updated == 0:
        db.rollback()
        return {"action": "no_action", "status": case.status.value, "message": "Concurrent recovery blocked.", "payment_link_url": None}
    case.status = CaseStatus.RECOVERING
    db.commit()

    # Razorpay expiry: 7 days
    expiry_time = now + timedelta(days=7)
    expires_unix = int(expiry_time.timestamp())

    try:
        payload = {
            "amount": int(case.amount),
            "currency": case.currency,
            "reference_id": f"RECOVERAI-{case.case_number}-{uuid.uuid4().hex[:8]}",
            "description": "Payment recovery for case " + str(case.case_number),
            "notes": {"recoverai_case_id": str(case.id)},
            "customer": {
                "name": "Customer",
                "email": case.customer.email,
                "contact": "9999999999"
            },
            "expire_by": expires_unix,
        }
        link = RazorpayService().create_payment_link(payload)
    except RazorpayServiceError as exc:
        if get_settings().demo_mode:
            link = {"id": f"plink_demo_{uuid.uuid4().hex[:8]}", "short_url": "https://rzp.io/i/demo_b_manual_recovery"}
        else:
            case.status = original_status
            db.commit()
            log_audit_event(db, case.id, "error", {"operation": "payment_link", "safe_message": "Payment Link creation failed.", "provider_error": str(exc)})
            return {"action": "error", "status": case.status.value, "message": str(exc), "payment_link_url": None}

    case.recovery_action = RecoveryAction.PAYMENT_LINK
    case.retry_count += 1
    case.last_retry_at = now
    case.payment_link_expires_at = expiry_time
    
    # Schedule first reminder at +24h
    next_t = now + timedelta(hours=24)
    if next_t > expiry_time:
        case.next_action_type = NextActionType.EXPIRY_CHECK
        case.next_action_at = expiry_time
    else:
        case.next_action_type = NextActionType.REMINDER
        case.next_action_at = next_t
        
    db.commit()
    log_audit_event(db, case.id, "payment_link_created", {"payment_link_id": link.get("id"), "url": link.get("short_url"), "expires_at": expiry_time.isoformat()})

    if original_status == CaseStatus.HUMAN_REVIEW:
        case.notification_status = "PENDING"
        db.commit()
    else:
        dispatch_channel_communication(db, case, link.get("short_url"), automatic=automatic)
    
    return {"action": "payment_link", "status": case.status.value, "message": "Payment Link created.", "payment_link_url": link.get("short_url")}


def record_payment_attempt(
    db: Session,
    case: PaymentCase,
    payment_method: str = "card",
    status: str = "failed",
    failure_reason: str | None = None,
    amount: int | None = None,
) -> dict[str, Any]:
    """Record a recovery payment attempt (failed or successful) and update case state."""
    from app.models.payment_attempt import PaymentAttempt
    from app.services.channel_service import attribute_recovery_to_communication

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    method_clean = (payment_method or case.payment_method or "card").lower()
    attempt_amount = amount if amount is not None else case.amount
    is_success = status.lower() == "success"

    # 1. Terminal state check
    if case.status in {CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED}:
        return {
            "success": True,
            "payment_result": "already_terminal",
            "case_status": case.status.value,
            "message": "Case is already in a terminal state.",
            "attempt": None,
        }

    # 2. Debounce / Idempotency protection against rapid duplicate submissions (within 2 seconds)
    recent_attempt = (
        db.query(PaymentAttempt)
        .filter(
            PaymentAttempt.case_id == case.id,
            PaymentAttempt.payment_method == method_clean,
            PaymentAttempt.status == ("success" if is_success else "failed"),
            PaymentAttempt.created_at >= now - timedelta(seconds=2),
        )
        .order_by(PaymentAttempt.created_at.desc())
        .first()
    )
    if recent_attempt:
        return {
            "success": True,
            "payment_result": recent_attempt.status,
            "case_status": case.status.value,
            "message": "Payment attempt already recorded (duplicate submission prevented).",
            "attempt": {
                "id": recent_attempt.id,
                "payment_method": recent_attempt.payment_method,
                "status": recent_attempt.status,
                "amount": recent_attempt.amount,
                "failure_reason": recent_attempt.failure_reason,
                "created_at": recent_attempt.created_at.isoformat(),
            },
        }

    # 3. Record PaymentAttempt
    attempt = PaymentAttempt(
        case_id=case.id,
        payment_method=method_clean,
        amount=attempt_amount,
        currency=case.currency,
        status="success" if is_success else "failed",
        failure_reason=None if is_success else (failure_reason or "Payment simulation failed"),
        source="recovery_payment_link",
        created_at=now,
    )
    db.add(attempt)

    # 3. Update latest payment activity on PaymentCase (without modifying original failure/method)
    case.last_payment_method = method_clean
    case.last_payment_status = "SUCCESS" if is_success else "FAILED"
    case.last_payment_attempt_at = now

    # 4. Log initial attempt event
    log_audit_event(db, case.id, "recovery_payment_attempted", {
        "source": "recovery_payment_link",
        "payment_method": method_clean,
        "amount": attempt_amount,
        "status": "success" if is_success else "failed",
        "timestamp": now.isoformat(),
    })

    if is_success:
        case.status = CaseStatus.RECOVERED
        case.recovered_at = now
        case.next_action_type = NextActionType.NONE
        case.next_action_at = None
        case.last_payment_failure_reason = None

        if case.customer:
            case.customer.successful_payments += 1
            case.customer.lifetime_value += attempt_amount

        attribute_recovery_to_communication(db, case)
        db.commit()

        log_audit_event(db, case.id, "recovery_payment_completed", {
            "source": "recovery_payment_link",
            "payment_method": method_clean,
            "amount": attempt_amount,
            "resulting_status": "recovered",
            "timestamp": now.isoformat(),
        })
        log_audit_event(db, case.id, "payment_success", {"simulated": True, "event": "simulate_payment", "payment_method": method_clean})
        log_audit_event(db, case.id, "case_recovered", {"simulated": True, "order_id": case.razorpay_order_id, "payment_method": method_clean})

        return {
            "success": True,
            "payment_result": "success",
            "case_status": case.status.value,
            "message": "Simulated recovery payment successful.",
            "attempt": {
                "id": attempt.id,
                "payment_method": attempt.payment_method,
                "status": attempt.status,
                "amount": attempt.amount,
                "created_at": attempt.created_at.isoformat(),
            },
        }
    else:
        case.last_payment_failure_reason = failure_reason or "Payment simulation failed"
        # Preserve active recovering state (do not change status to FAILED or increment retries)
        if case.status != CaseStatus.RECOVERING and case.status != CaseStatus.HUMAN_REVIEW:
            case.status = CaseStatus.RECOVERING

        db.commit()

        log_audit_event(db, case.id, "recovery_payment_failed", {
            "source": "recovery_payment_link",
            "payment_method": method_clean,
            "amount": attempt_amount,
            "failure_reason": case.last_payment_failure_reason,
            "resulting_status": case.status.value,
            "timestamp": now.isoformat(),
        })
        # Backward compatibility for existing tests
        log_audit_event(db, case.id, "payment_failed_simulated", {
            "source": "simulated_payment_page",
            "success": False,
            "payment_method": method_clean,
            "failure_reason": case.last_payment_failure_reason,
            "retry_count": case.retry_count,
            "max_retries": case.max_retries,
        })

        return {
            "success": True,
            "payment_result": "failed",
            "case_status": case.status.value,
            "message": "Recovery payment failure recorded successfully. Recovery workflow will continue.",
            "attempt": {
                "id": attempt.id,
                "payment_method": attempt.payment_method,
                "status": attempt.status,
                "amount": attempt.amount,
                "failure_reason": attempt.failure_reason,
                "created_at": attempt.created_at.isoformat(),
            },
        }


def sync_payment_link_status(db: Session, case: PaymentCase) -> bool:
    """Check Razorpay API if an active payment link or invoice has been paid.
    
    This ensures local development environments (where inbound webhooks cannot reach localhost)
    stay 100% synchronized with real Razorpay test payments.
    """
    if case.status in {CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED}:
        return False

    events = list_audit_events(db, case.id)
    last_link_event = next((e for e in reversed(events) if e.event_type == "payment_link_created"), None)
    if not last_link_event:
        return False

    link_id = last_link_event.event_data.get("payment_link_id")
    if not link_id:
        return False

    try:
        from app.services.razorpay_service import RazorpayService
        svc = RazorpayService()
        data = svc.fetch_payment_link_or_invoice(link_id)
        if data.get("status") == "paid":
            method = data.get("payment_method") or case.payment_method or "upi"
            amt = data.get("amount_paid") or case.amount
            record_payment_attempt(
                db=db,
                case=case,
                payment_method=method,
                status="success",
                amount=amt,
            )
            return True
    except Exception:
        pass
    return False


def track_payment_link_click(db: Session, case: PaymentCase) -> dict[str, Any]:
    """Record a customer payment link opened/clicked event.

    Data independence rules:
    - Does NOT increment case.retry_count
    - Does NOT consume a communication attempt
    - Does NOT mark case as RECOVERED
    - Does NOT overwrite original failure/transaction data
    """
    from app.models.communication_record import CommunicationRecord

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # 1. Guard against terminal states (reject invalid mutations)
    if case.status in {CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED}:
        return {
            "success": False,
            "case_id": case.id,
            "status": case.status.value,
            "message": f"Case is already in terminal state '{case.status.value}'. No engagement mutation allowed.",
        }

    # 2. Retrieve latest communication record
    latest = db.scalar(
        select(CommunicationRecord)
        .where(CommunicationRecord.case_id == case.id)
        .order_by(CommunicationRecord.attempt_number.desc(), CommunicationRecord.created_at.desc())
    )

    # 3. Idempotency check:
    # If already LINK_CLICKED, return success without duplicate audit logging or writes
    if latest and latest.outcome == "LINK_CLICKED":
        return {
            "success": True,
            "case_id": case.id,
            "outcome": "LINK_CLICKED",
            "message": "Payment link click already registered.",
        }

    # Debounce check: recent payment_link_clicked event within 3 seconds
    recent_events = list_audit_events(db, case.id)
    last_click_event = next((e for e in reversed(recent_events) if e.event_type == "payment_link_clicked"), None)
    if last_click_event and (now - last_click_event.timestamp).total_seconds() < 3.0:
        return {
            "success": True,
            "case_id": case.id,
            "outcome": latest.outcome if latest else "LINK_CLICKED",
            "message": "Payment link click already registered recently.",
        }

    # 4. Update the latest communication record outcome
    channel_name = "WhatsApp"
    if latest:
        latest.outcome = "LINK_CLICKED"
        if latest.delivery_status != "DELIVERED":
            latest.delivery_status = "DELIVERED"
        ch = latest.channel.lower()
        channel_name = "WhatsApp" if ch == "whatsapp" else "SMS" if ch == "sms" else "Email"
        if latest.message_snippet:
            latest.message_snippet = f"{channel_name} reminder delivered — Payment link clicked"
        db.add(latest)

    # 5. Log audit event
    log_audit_event(db, case.id, "payment_link_clicked", {
        "channel": latest.channel if latest else (case.selected_channel or "link"),
        "attempt_number": latest.attempt_number if latest else 1,
        "source": "payment_link",
        "timestamp": now.isoformat(),
    })

    db.commit()

    return {
        "success": True,
        "case_id": case.id,
        "outcome": "LINK_CLICKED",
        "message": "Payment link click registered successfully.",
    }


