"""Policy-controlled recovery orchestration; Groq is advisory only."""

from datetime import datetime, timezone
from typing import Any
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.groq_service import GroqRecoveryAdvisor, GroqUnavailableError, fallback_decision
from app.ml.predict import predict_recovery
from app.models.payment_case import CaseStatus, PaymentCase, RecoveryAction
from app.models.recovery_policy import RecoveryPolicy
from app.schemas.recovery import AIDecision
from app.services.audit_service import list_audit_events, log_audit_event
from app.services.notification_service import send_recovery_email
from app.services.policy_service import check_recovery_policy
from app.services.razorpay_service import RazorpayService, RazorpayServiceError


# ---------------------------------------------------------------------------
# ML routing thresholds — application-level constants; no schema change needed.
# These drive the three-way routing: HIGH → automatic, UNCERTAIN → human review,
# LOW → stopped (ABANDONED status, which already exists in CaseStatus).
# ---------------------------------------------------------------------------
ML_HIGH_THRESHOLD = 0.70       # probability >= this → automatic recovery
ML_UNCERTAIN_THRESHOLD = 0.40  # probability >= this but < HIGH → human review
# probability < ML_UNCERTAIN_THRESHOLD → ABANDONED (no recovery attempt)


def ml_routing_decision(recovery_probability: float | None) -> str:
    """Classify ML probability into HIGH / UNCERTAIN / LOW routing bucket."""
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


def analyze_case(db: Session, case: PaymentCase, advisor: GroqRecoveryAdvisor | None = None) -> dict[str, Any]:
    if case.status not in {CaseStatus.FAILED, CaseStatus.ABANDONED}:
        return {"error": f"Case is in '{case.status.value}' state and cannot be analyzed."}
    case.status = CaseStatus.ANALYZING
    db.commit()
    features = _features(case)
    prediction = predict_recovery(features)
    case.recovery_probability = prediction["recovery_probability"]
    log_audit_event(db, case.id, "customer_analyzed", {"customer_id": case.customer_id})
    log_audit_event(db, case.id, "ml_prediction", prediction)
    policy_result = check_recovery_policy(case, _policy(db))
    case.policy_check_passed = policy_result.allowed
    case.policy_reason = policy_result.reason
    db.commit()
    log_audit_event(db, case.id, "policy_check", policy_result.to_dict())
    permitted = {"retry", "payment_link"} if policy_result.allowed else set()
    context = {"case_id": case.id, "recovery_probability": case.recovery_probability, "failure_reason": case.failure_reason, "policy_reason": policy_result.reason}
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
            "ml_decision": ml_routing_decision(case.recovery_probability),
        })
    else:
        ml_decision = ml_routing_decision(case.recovery_probability)
        if ml_decision == "LOW":
            case.status = CaseStatus.ABANDONED
            log_audit_event(db, case.id, "recovery_stopped", {
                "reason": "Predicted recovery probability is too low to justify a recovery attempt.",
                "recovery_probability": case.recovery_probability,
                "ml_decision": "LOW",
                "threshold": ML_UNCERTAIN_THRESHOLD,
            })
        elif ml_decision == "UNCERTAIN":
            case.status = CaseStatus.HUMAN_REVIEW
            log_audit_event(db, case.id, "human_escalation", {
                "reason": "Recovery confidence is below the automatic recovery threshold.",
                "recovery_probability": case.recovery_probability,
                "ml_decision": "UNCERTAIN",
                "threshold": ML_HIGH_THRESHOLD,
                "source": "ml_routing",
            })
        else:  # HIGH
            # Leave as FAILED — ready for automatic execute_recovery.
            case.status = CaseStatus.FAILED

    db.commit()
    return {"prediction": prediction, "policy": policy_result.to_dict(), "ai": decision, "ml_decision": ml_routing_decision(case.recovery_probability)}


def execute_recovery(db: Session, case: PaymentCase, automatic: bool = False) -> dict[str, Any]:
    original_status = case.status

    # Guard: case that was stopped due to low ML probability — do not execute.
    if case.status == CaseStatus.ABANDONED:
        return {
            "action": "stopped",
            "status": case.status.value,
            "message": "Recovery probability was too low. No recovery action has been taken.",
            "payment_link_url": None,
        }

    # Guard: if recovery is already in progress, return immediately without any DB
    # writes, audit events, retry-count increments, or new payment link creation.
    # This makes the backend independently safe regardless of the calling client.
    if case.status in {CaseStatus.RECOVERING, CaseStatus.RECOVERED}:
        events = list_audit_events(db, case.id)
        last_link_event = next((e for e in reversed(events) if e.event_type == "payment_link_created"), None)
        is_mock = last_link_event and last_link_event.event_data.get("url") == "mock_demo_link"

        if not is_mock or case.status == CaseStatus.RECOVERED:
            return {
                "action": "no_action",
                "status": case.status.value,
                "message": f"Recovery is already {'complete' if case.status == CaseStatus.RECOVERED else 'in progress'} for this case. No new action was taken.",
                "payment_link_url": None,
            }

        # It's a mock demo link. Treat as FAILED for policy evaluation so we can generate a real link.
        case.status = CaseStatus.FAILED

    # Merchant explicit approval of a HUMAN_REVIEW case:
    # policy_service has a guardrail that blocks HUMAN_REVIEW status. Temporarily
    # restore FAILED so that the policy can evaluate the actual case attributes.
    # This does NOT bypass any policy safety guardrail — all other checks still apply.
    if case.status == CaseStatus.HUMAN_REVIEW and not automatic:
        case.status = CaseStatus.FAILED

    policy_result = check_recovery_policy(case, _policy(db))
    case.policy_check_passed, case.policy_reason = policy_result.allowed, policy_result.reason
    db.commit(); log_audit_event(db, case.id, "policy_check", policy_result.to_dict())
    if not policy_result.allowed:
        case.status, case.recovery_action = CaseStatus.HUMAN_REVIEW, RecoveryAction.ESCALATE
        db.commit(); log_audit_event(db, case.id, "human_escalation", {"reason": policy_result.reason, "source": "policy"})
        return {"action": "escalate", "status": case.status.value, "message": policy_result.reason, "payment_link_url": None}


    # For explicit manual executions on HUMAN_REVIEW cases (merchant approval), also
    # enforce ML routing for LOW-probability cases even if policy technically allows it.
    if not automatic:
        ml_decision = ml_routing_decision(case.recovery_probability)
        if ml_decision == "LOW":
            case.status = CaseStatus.ABANDONED
            db.commit()
            log_audit_event(db, case.id, "recovery_stopped", {
                "reason": "Predicted recovery probability is too low. Manual override not permitted.",
                "recovery_probability": case.recovery_probability,
                "ml_decision": "LOW",
            })
            return {
                "action": "stopped",
                "status": case.status.value,
                "message": "Recovery probability is too low. Manual execution is not permitted for this case.",
                "payment_link_url": None,
            }

    decision = _last_ai_decision(db, case.id) or fallback_decision(
    {"recovery_probability": case.recovery_probability},
    {"payment_link", "retry"},
)
    requested = decision.recommended_action
    # Razorpay does not expose an API to retry a failed payment. Convert only this unsupported request to a Payment Link.
    if requested == "retry":
        action = "payment_link"
    elif requested in {"payment_link", "escalate", "message"}:
        action = requested
    else:
        action = "escalate"
        log_audit_event(
            db,
            case.id,
            "error",
            {
                "operation": "recovery_action_validation",
                "safe_message": "Invalid recovery action; escalated.",
            },
        )
    log_audit_event(db, case.id, "recovery_started", {"advisory_action": requested, "executed_action": action, "automatic": automatic})

    if action == "escalate":
        case.status, case.recovery_action = CaseStatus.HUMAN_REVIEW, RecoveryAction.ESCALATE
        db.commit(); log_audit_event(db, case.id, "human_escalation", {"reason": "Advisory escalation"})
        return {"action": action, "status": case.status.value, "message": "Escalated to human review.", "payment_link_url": None}

    # Fix: handle Groq 'message' recommendation explicitly — record advisory message,
    # do NOT create a Payment Link or charge the customer.
    if action == "message":
        case.recovery_action = RecoveryAction.MESSAGE
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

    updated = db.query(PaymentCase).filter(
        PaymentCase.id == case.id,
        PaymentCase.status == case.status
    ).update({"status": CaseStatus.RECOVERING}, synchronize_session=False)

    if updated == 0:
        db.rollback()
        return {"action": "no_action", "status": case.status.value, "message": "Concurrent recovery blocked.", "payment_link_url": None}
    db.commit()

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
            }
        }
        link = RazorpayService().create_payment_link(payload)
    except RazorpayServiceError as exc:
        case.status = original_status
        db.commit()
        log_audit_event(db, case.id, "error", {"operation": "payment_link", "safe_message": "Payment Link creation failed.", "provider_error": str(exc)})
        return {"action": "error", "status": case.status.value, "message": "Payment Link could not be created.", "payment_link_url": None}
    case.recovery_action = RecoveryAction.PAYMENT_LINK
    case.retry_count += 1; case.last_retry_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit(); log_audit_event(db, case.id, "payment_link_created", {"payment_link_id": link.get("id"), "url": link.get("short_url")})
    send_recovery_email(db, case, link.get("short_url"))
    return {"action": "payment_link", "status": case.status.value, "message": "Payment Link created.", "payment_link_url": link.get("short_url")}
