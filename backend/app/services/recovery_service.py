"""Policy-controlled recovery orchestration; Groq is advisory only."""

from datetime import datetime, timezone
from typing import Any

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
    case.status = CaseStatus.FAILED if policy_result.allowed else CaseStatus.HUMAN_REVIEW
    case.recovery_action = RecoveryAction(decision.recommended_action)
    db.commit()
    return {"prediction": prediction, "policy": policy_result.to_dict(), "ai": decision}


def execute_recovery(db: Session, case: PaymentCase, automatic: bool = False) -> dict[str, Any]:
    original_status = case.status
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
    log_audit_event(db, case.id, "recovery_started", {"advisory_action": requested, "executed_action": action, "automatic": automatic})
    if action == "escalate":
        case.status, case.recovery_action = CaseStatus.HUMAN_REVIEW, RecoveryAction.ESCALATE
        db.commit(); log_audit_event(db, case.id, "human_escalation", {"reason": "Advisory escalation"})
        return {"action": action, "status": case.status.value, "message": "Escalated to human review.", "payment_link_url": None}

    updated = db.query(PaymentCase).filter(
        PaymentCase.id == case.id,
        PaymentCase.status == case.status
    ).update({"status": CaseStatus.RECOVERING}, synchronize_session=False)

    if updated == 0:
        db.rollback()
        return {"action": "no_action", "status": case.status.value, "message": "Concurrent recovery blocked.", "payment_link_url": None}
    db.commit()

    try:
        link = RazorpayService().create_payment_link({"amount": case.amount, "currency": case.currency, "reference_id": case.case_number, "description": "Secure payment recovery link"})
    except RazorpayServiceError:
        case.status = original_status
        db.commit(); log_audit_event(db, case.id, "error", {"operation": "payment_link", "safe_message": "Payment Link creation failed."})
        return {"action": "error", "status": case.status.value, "message": "Payment Link could not be created.", "payment_link_url": None}
    case.recovery_action = RecoveryAction.PAYMENT_LINK
    case.retry_count += 1; case.last_retry_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit(); log_audit_event(db, case.id, "payment_link_created", {"payment_link_id": link.get("id"), "url": link.get("short_url")})
    send_recovery_email(db, case, link.get("short_url"))
    return {"action": "payment_link", "status": case.status.value, "message": "Payment Link created.", "payment_link_url": link.get("short_url")}
