"""Policy-controlled recovery orchestration; Groq is advisory only."""

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ai.groq_service import GroqRecoveryAdvisor, GroqUnavailableError, fallback_decision
from app.ml.predict import predict_recovery
from app.models.payment_case import CaseStatus, PaymentCase, RecoveryAction
from app.models.recovery_policy import RecoveryPolicy
from app.schemas.recovery import AIDecision
from app.services.audit_service import list_audit_events, log_audit_event
from app.services.notification_service import send_mock_recovery_message
from app.services.policy_service import check_recovery_policy
from app.services.razorpay_service import RazorpayService, RazorpayServiceError



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
        "time_since_failure": max(0, (datetime.utcnow() - case.created_at).total_seconds() / 3600),
        "payment_method": case.payment_method if case.payment_method in {"card", "upi", "netbanking"} else "card",
        "failure_count": customer.failed_payments,
        "failure_reason": case.failure_reason if case.failure_reason in {"insufficient_funds", "card_expired", "network_timeout", "fraud_suspicion", "bank_declined"} else "bank_declined",
        "customer_age_days": max(1, (datetime.utcnow() - customer.created_at).days),
    }


def _last_ai_decision(db: Session, case_id: str) -> AIDecision | None:
    for event in reversed(list_audit_events(db, case_id)):
        if event.event_type == "ai_analysis":
            try: return AIDecision.model_validate(event.event_data)
            except Exception: return None
    return None


def analyze_case(db: Session, case: PaymentCase, advisor: GroqRecoveryAdvisor | None = None) -> dict[str, Any]:
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
    case.status = CaseStatus.FAILED if policy_result.allowed else CaseStatus.HUMAN_REVIEW
    case.recovery_action = RecoveryAction(decision.recommended_action)
    db.commit()
    return {"prediction": prediction, "policy": policy_result.to_dict(), "ai": decision}


def execute_recovery(db: Session, case: PaymentCase) -> dict[str, Any]:
    policy_result = check_recovery_policy(case, _policy(db))
    case.policy_check_passed, case.policy_reason = policy_result.allowed, policy_result.reason
    db.commit(); log_audit_event(db, case.id, "policy_check", policy_result.to_dict())
    if not policy_result.allowed:
        case.status, case.recovery_action = CaseStatus.HUMAN_REVIEW, RecoveryAction.ESCALATE
        db.commit(); log_audit_event(db, case.id, "human_escalation", {"reason": policy_result.reason})
        return {"action": "escalate", "status": case.status.value, "message": policy_result.reason, "payment_link_url": None}
    decision = _last_ai_decision(db, case.id) or fallback_decision(
    {"recovery_probability": case.recovery_probability},
    {"payment_link", "retry"},
)
    requested = decision.recommended_action
    # Razorpay does not expose an API to retry a failed payment. Convert only this unsupported request to a Payment Link.
    if requested == "retry":
        action = "payment_link"
    elif requested in {"payment_link", "escalate"}:
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
    log_audit_event(db, case.id, "recovery_started", {"advisory_action": requested, "executed_action": action})
    if action == "escalate":
        case.status, case.recovery_action = CaseStatus.HUMAN_REVIEW, RecoveryAction.ESCALATE
        db.commit(); log_audit_event(db, case.id, "human_escalation", {"reason": "Advisory escalation"})
        return {"action": action, "status": case.status.value, "message": "Escalated to human review.", "payment_link_url": None}
   
    try:
        link = RazorpayService().create_payment_link({"amount": case.amount, "currency": case.currency, "reference_id": case.case_number, "description": "Secure payment recovery link"})
    except RazorpayServiceError:
        case.status, case.recovery_action = CaseStatus.HUMAN_REVIEW, RecoveryAction.ESCALATE
        db.commit(); log_audit_event(db, case.id, "error", {"operation": "payment_link", "safe_message": "Payment Link creation failed."})
        return {"action": "escalate", "status": case.status.value, "message": "Payment Link could not be created; escalated.", "payment_link_url": None}
    case.status, case.recovery_action = CaseStatus.RECOVERING, RecoveryAction.PAYMENT_LINK
    case.retry_count += 1; case.last_retry_at = datetime.utcnow()
    db.commit(); log_audit_event(db, case.id, "payment_link_created", {"payment_link_id": link.get("id"), "url": link.get("short_url")})
    send_mock_recovery_message(db, case.id, decision.customer_message)
    return {"action": "payment_link", "status": case.status.value, "message": "Payment Link created.", "payment_link_url": link.get("short_url")}
