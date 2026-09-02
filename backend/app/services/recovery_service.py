"""Policy-controlled recovery orchestration; Groq is advisory only."""

from datetime import datetime, timezone, timedelta
from typing import Any
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

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
        if ml_decision == "LOW":
            case.status = CaseStatus.HUMAN_REVIEW if original_status == CaseStatus.HUMAN_REVIEW else CaseStatus.FAILED
            log_audit_event(db, case.id, "low_probability_routing", {
                "reason": "Predicted recovery probability is low. 1 recovery attempt allowed.",
                "recovery_probability": case.recovery_probability,
                "ml_decision": "LOW",
                "max_retries": 1,
                "threshold": ML_UNCERTAIN_THRESHOLD,
            })
        elif ml_decision == "UNCERTAIN":
            case.status = CaseStatus.HUMAN_REVIEW if original_status == CaseStatus.HUMAN_REVIEW else CaseStatus.FAILED
            log_audit_event(db, case.id, "uncertain_probability_routing", {
                "reason": "Recovery confidence is uncertain, but an automatic recovery attempt is permitted.",
                "recovery_probability": case.recovery_probability,
                "ml_decision": "UNCERTAIN",
                "threshold": ML_HIGH_THRESHOLD,
                "source": "ml_routing",
            })
        elif ml_decision == "COLD_START":
            case.status = CaseStatus.HUMAN_REVIEW if original_status == CaseStatus.HUMAN_REVIEW else CaseStatus.FAILED
            log_audit_event(db, case.id, "cold_start_routing", {"message": "Using COLD_START recovery policy", "max_retries": 2})
        else:  # HIGH
            case.status = CaseStatus.HUMAN_REVIEW if original_status == CaseStatus.HUMAN_REVIEW else CaseStatus.FAILED

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
    
    dispatch_channel_communication(db, case, link.get("short_url"), automatic=automatic)
    
    return {"action": "payment_link", "status": case.status.value, "message": "Payment Link created.", "payment_link_url": link.get("short_url")}
