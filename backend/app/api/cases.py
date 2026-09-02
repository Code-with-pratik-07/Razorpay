from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.database import get_db
from app.models.payment_case import PaymentCase
from app.schemas.recovery import CaseExplanation, CaseSummary, ExecuteRecoveryResponse, AIDecision
from app.services.recovery_service import _features, _last_ai_decision, _policy, analyze_case, execute_recovery, ml_routing_decision
from app.services.audit_service import list_audit_events
from app.services.channel_service import get_case_channel_intelligence
from app.services.policy_service import check_recovery_policy

router = APIRouter(prefix="/api/cases", tags=["cases"])


def _case(db: Session, case_id: str) -> PaymentCase:
    case = db.scalar(select(PaymentCase).options(joinedload(PaymentCase.customer)).where(PaymentCase.id == case_id))
    if case is None: raise HTTPException(status_code=404, detail="Recovery case not found.")
    return case


def _summary(case: PaymentCase) -> dict:
    return {
        "id": case.id, "case_number": case.case_number, "customer_email": case.customer.email, 
        "amount": case.amount, "currency": case.currency, "status": case.status.value, 
        "failure_reason": case.failure_reason, "payment_method": case.payment_method, 
        "recovery_probability": case.recovery_probability, "recovery_action": case.recovery_action.value, 
        "retry_count": case.retry_count, "max_retries": case.max_retries, 
        "policy_check_passed": case.policy_check_passed, "policy_reason": case.policy_reason, 
        "notification_status": case.notification_status, "created_at": case.created_at,
        "payment_link_expires_at": case.payment_link_expires_at,
        "next_action_at": case.next_action_at,
        "next_action_type": case.next_action_type.value if hasattr(case.next_action_type, 'value') else case.next_action_type,
        "last_notification_at": case.last_notification_at,
        "last_payment_status": case.last_payment_status,
        "last_payment_attempt_at": case.last_payment_attempt_at,
        "last_payment_failure_reason": case.last_payment_failure_reason,
        "selected_channel": getattr(case, "selected_channel", None),
    }


@router.get("", response_model=list[CaseSummary])
def list_cases(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[CaseSummary]:
    cases = list(db.scalars(select(PaymentCase).options(joinedload(PaymentCase.customer)).order_by(PaymentCase.created_at.desc()).offset(skip).limit(limit)))
    return [CaseSummary(**_summary(case)) for case in cases]


@router.get("/{case_id}", response_model=CaseSummary)
def get_case(case_id: str, db: Session = Depends(get_db)) -> CaseSummary:
    return CaseSummary(**_summary(_case(db, case_id)))


@router.post("/{case_id}/analyze", response_model=CaseExplanation)
def analyze(case_id: str, db: Session = Depends(get_db)) -> CaseExplanation:
    case = _case(db, case_id)
    analyze_case(db, case)
    return _explanation(db, case)


@router.get("/{case_id}/explanation", response_model=CaseExplanation)
def explanation(case_id: str, db: Session = Depends(get_db)) -> CaseExplanation:
    return _explanation(db, _case(db, case_id))


from datetime import datetime, timezone
from pydantic import BaseModel
from app.models.payment_case import CaseStatus
from app.services.channel_service import dispatch_channel_communication

def _explanation(db: Session, case: PaymentCase) -> CaseExplanation:
    events = list_audit_events(db, case.id)
    
    first_policy_check = next((e for e in events if e.event_type == "policy_check"), None)
    if first_policy_check:
        policy = {
            "allowed": first_policy_check.event_data.get("allowed"), 
            "reason": first_policy_check.event_data.get("reason"), 
            "requires_human_approval": not first_policy_check.event_data.get("allowed")
        }
    elif case.policy_reason:
        policy = {"allowed": case.policy_check_passed, "reason": case.policy_reason, "requires_human_approval": not case.policy_check_passed}
    else:
        policy = check_recovery_policy(case, _policy(db)).to_dict()
        
    history = {"lifetime_value": case.customer.lifetime_value, "successful_payments": case.customer.successful_payments, "failed_payments": case.customer.failed_payments}
    
    is_cold_start = (case.customer.successful_payments + case.customer.failed_payments) < 3
    
    error_event = next((e for e in reversed(events) if e.event_type == "error" and e.event_data.get("operation") == "payment_link"), None)
    execution_error = error_event.event_data.get("provider_error") if error_event else None
    
    manual_execution = any(e.event_type == "recovery_started" and e.event_data.get("automatic") is False for e in events)
    
    channel_intelligence = get_case_channel_intelligence(db, case)

    # 1. Human review workflow state
    has_human_approval = any(e.event_type in {"human_approval", "manual_review_approved"} for e in events)
    if has_human_approval:
        human_review_status = "APPROVED"
    elif case.status == CaseStatus.HUMAN_REVIEW or (policy.get("requires_human_approval") and not policy.get("allowed")):
        human_review_status = "REQUIRED"
    else:
        human_review_status = "NOT_REQUIRED"

    # 2. Payment link workflow state
    now_dt = datetime.now(timezone.utc).replace(tzinfo=None)
    has_link_event = any(e.event_type == "payment_link_created" for e in events)
    if case.status == CaseStatus.RECOVERED:
        payment_link_status = "PAID"
    elif case.payment_link_expires_at:
        payment_link_status = "EXPIRED" if case.payment_link_expires_at <= now_dt else "ACTIVE"
    elif has_link_event:
        payment_link_status = "ACTIVE"
    else:
        payment_link_status = "NONE"

    # 3. Customer payment workflow state
    if case.status == CaseStatus.RECOVERED:
        customer_payment_status = "RECEIVED"
    elif case.status == CaseStatus.ABANDONED:
        customer_payment_status = "EXHAUSTED"
    elif case.last_payment_status == "FAILED":
        customer_payment_status = "FAILED"
    elif payment_link_status == "ACTIVE":
        customer_payment_status = "PENDING"
    else:
        customer_payment_status = "NONE"

    # 4. Recommended & Dispatched channels
    recommended_channel = channel_intelligence.recommended_channel or "email"
    last_dispatched = None
    if channel_intelligence.attempts_count > 0 and case.notification_status:
        last_dispatched = channel_intelligence.last_channel_used or case.selected_channel
    dispatched_channel = last_dispatched

    # 5. Communication workflow state
    if case.status in {CaseStatus.RECOVERED, CaseStatus.CLOSED}:
        communication_status = "COMPLETED"
    elif case.status == CaseStatus.ABANDONED:
        communication_status = "EXHAUSTED"
    elif human_review_status == "REQUIRED":
        communication_status = "PAUSED"
    elif case.notification_status in {"WHATSAPP_SIMULATED", "SMS_SIMULATED"}:
        communication_status = "SIMULATED"
    elif case.notification_status == "SENT":
        communication_status = "SENT"
    elif case.notification_status in {"GENERATED", "MOCKED", "EMAIL_GENERATED"}:
        communication_status = "GENERATED"
    elif case.notification_status == "NOT_AVAILABLE":
        communication_status = "NOT_AVAILABLE"
    elif case.notification_status == "FAILED":
        communication_status = "FAILED"
    elif human_review_status == "APPROVED" or payment_link_status == "ACTIVE" or case.status == CaseStatus.RECOVERING:
        communication_status = "READY"
    else:
        communication_status = "PAUSED"

    return CaseExplanation(
        **_summary(case),
        ml={"recovery_probability": case.recovery_probability, "features": _features(case)},
        policy=policy,
        ai=_last_ai_decision(db, case.id),
        customer_history=history,
        ml_decision=ml_routing_decision(case.recovery_probability, is_cold_start),
        execution_error=execution_error,
        manual_execution=manual_execution,
        channel_intelligence=channel_intelligence,
        human_review_status=human_review_status,
        payment_link_status=payment_link_status,
        communication_status=communication_status,
        customer_payment_status=customer_payment_status,
        recommended_channel=recommended_channel,
        dispatched_channel=dispatched_channel,
    )


@router.post("/{case_id}/execute", response_model=ExecuteRecoveryResponse)
def execute(case_id: str, db: Session = Depends(get_db)) -> ExecuteRecoveryResponse:
    case = _case(db, case_id)
    return ExecuteRecoveryResponse(case_id=case.id, **execute_recovery(db, case, automatic=False))


class DispatchCommunicationRequest(BaseModel):
    channel: str | None = None


@router.post("/{case_id}/dispatch-communication")
def dispatch_communication(case_id: str, req: DispatchCommunicationRequest, db: Session = Depends(get_db)):
    case = _case(db, case_id)
    if case.status in {CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED}:
        raise HTTPException(status_code=400, detail="Cannot dispatch communication for a terminal case.")
    events = list_audit_events(db, case.id)
    last_link_event = next((e for e in reversed(events) if e.event_type == "payment_link_created"), None)
    url = last_link_event.event_data.get("url") if last_link_event else "https://rzp.io/i/demo_link"
    
    res = dispatch_channel_communication(
        db, case, url, override_channel=req.channel, automatic=False
    )
    return res
