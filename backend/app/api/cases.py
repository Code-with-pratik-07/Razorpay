from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.database import get_db
from app.models.payment_case import PaymentCase, CaseStatus, RecoveryAction, NextActionType
from app.models.communication_record import CommunicationRecord
from app.schemas.recovery import CaseExplanation, CaseSummary, ExecuteRecoveryResponse, AIDecision, PaymentAttemptSummary, RecordPaymentAttemptRequest
from app.services.recovery_service import _features, _last_ai_decision, _policy, analyze_case, execute_recovery, ml_routing_decision, record_payment_attempt
from app.services.audit_service import list_audit_events, log_audit_event
from app.services.channel_service import get_case_channel_intelligence, evaluate_channel_suitability, dispatch_channel_communication
from app.services.policy_service import check_recovery_policy

router = APIRouter(prefix="/api/cases", tags=["cases"])


def _case(db: Session, case_id: str) -> PaymentCase:
    case = db.scalar(
        select(PaymentCase)
        .options(joinedload(PaymentCase.customer), joinedload(PaymentCase.payment_attempts))
        .where((PaymentCase.id == case_id) | (PaymentCase.case_number == case_id))
    )
    if case is None:
        raise HTTPException(status_code=404, detail="Recovery case not found.")

    # Precedence: If retry limit reached and not recovered/closed, transition to ABANDONED
    if case.status not in {CaseStatus.RECOVERED, CaseStatus.CLOSED} and (case.retry_count or 0) >= (case.max_retries or 3):
        if case.status != CaseStatus.ABANDONED:
            case.status = CaseStatus.ABANDONED
            case.recovery_action = RecoveryAction.NONE
            db.commit()
    return case


def _summary(case: PaymentCase) -> dict:
    status_val = case.status.value
    if case.status not in {CaseStatus.RECOVERED, CaseStatus.CLOSED} and (case.retry_count or 0) >= (case.max_retries or 3):
        status_val = CaseStatus.ABANDONED.value
    elif case.status not in {CaseStatus.RECOVERED, CaseStatus.CLOSED, CaseStatus.ABANDONED}:
        now_dt = datetime.now(timezone.utc).replace(tzinfo=None)
        has_active_link = bool(case.payment_link_expires_at and case.payment_link_expires_at > now_dt)
        if case.status == CaseStatus.FAILED and (has_active_link or (case.retry_count or 0) > 0 or case.notification_status in {"SENT", "SIMULATED", "WHATSAPP_SIMULATED", "SMS_SIMULATED"}):
            status_val = CaseStatus.RECOVERING.value

    attempts_list = []
    if hasattr(case, "payment_attempts") and case.payment_attempts:
        for pa in case.payment_attempts:
            attempts_list.append({
                "id": pa.id,
                "case_id": pa.case_id,
                "payment_method": pa.payment_method,
                "amount": pa.amount,
                "currency": pa.currency,
                "status": pa.status,
                "failure_reason": pa.failure_reason,
                "source": pa.source,
                "created_at": pa.created_at,
            })

    return {
        "id": case.id, "case_number": case.case_number, "customer_email": case.customer.email, 
        "amount": case.amount, "currency": case.currency, "status": status_val, 
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
        "last_payment_method": getattr(case, "last_payment_method", None),
        "selected_channel": getattr(case, "selected_channel", None),
        "payment_attempts": attempts_list,
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
from app.models.payment_case import CaseStatus, RecoveryAction
from app.models.communication_record import CommunicationRecord
from app.services.channel_service import dispatch_channel_communication, evaluate_channel_suitability, get_case_channel_intelligence

def _explanation(db: Session, case: PaymentCase) -> CaseExplanation:
    events = list_audit_events(db, case.id)

    is_attempt_exhausted = (case.retry_count or 0) >= (case.max_retries or 3)
    if is_attempt_exhausted and case.status not in {CaseStatus.RECOVERED, CaseStatus.CLOSED}:
        if case.status != CaseStatus.ABANDONED:
            case.status = CaseStatus.ABANDONED
            case.recovery_action = RecoveryAction.NONE
            db.commit()
    elif case.status == CaseStatus.FAILED and case.status not in {CaseStatus.RECOVERED, CaseStatus.CLOSED, CaseStatus.ABANDONED}:
        now_dt = datetime.now(timezone.utc).replace(tzinfo=None)
        has_active_link = bool(case.payment_link_expires_at and case.payment_link_expires_at > now_dt)
        has_human_approval = any(e.event_type in {"human_approval", "manual_review_approved"} for e in events)
        if has_active_link or (case.retry_count or 0) > 0 or has_human_approval:
            case.status = CaseStatus.RECOVERING
            db.commit()

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

    # 3. Customer payment workflow state (Precedence: RECOVERED > ABANDONED/EXHAUSTED > FAILED > PENDING > NONE)
    if case.status == CaseStatus.RECOVERED:
        customer_payment_status = "RECEIVED"
    elif case.status in {CaseStatus.ABANDONED, CaseStatus.CLOSED} or is_attempt_exhausted:
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

    # 5. Communication workflow state (Precedence: RECOVERED/CLOSED > ABANDONED/EXHAUSTED > HUMAN_REVIEW > Notification states)
    if case.status in {CaseStatus.RECOVERED, CaseStatus.CLOSED}:
        communication_status = "COMPLETED"
    elif case.status == CaseStatus.ABANDONED or is_attempt_exhausted:
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

    # 6. AI Advisor Decision (Retain historical analysis event from audit trail with fallback)
    ai_decision = _last_ai_decision(db, case.id)
    if not ai_decision and (case.status == CaseStatus.ABANDONED or is_attempt_exhausted):
        ai_decision = AIDecision(
            recommended_action="none",
            reasoning="The maximum permitted recovery attempts have been reached without successful payment. Further automated communication should stop to prevent unnecessary customer outreach.",
            customer_message="Recovery closed.",
            confidence=0.95,
            source="groq",
        )

    return CaseExplanation(
        **_summary(case),
        ml={"recovery_probability": case.recovery_probability, "features": _features(case)},
        policy=policy,
        ai=ai_decision,
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
    if case.status in {CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED} or (case.retry_count or 0) >= (case.max_retries or 3):
        raise HTTPException(status_code=400, detail="Cannot dispatch communication for a terminal case.")
    
    # Idempotency guard: prevent duplicate dispatches for the same channel on rapid repeated clicks
    recent = list(
        db.scalars(
            select(CommunicationRecord)
            .where(CommunicationRecord.case_id == case.id)
            .order_by(CommunicationRecord.created_at.desc())
            .limit(1)
        )
    )
    if recent and req.channel and recent[0].channel == req.channel.lower():
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        time_diff = (now - recent[0].created_at).total_seconds()
        if time_diff < 60:
            return {
                "status": "no_action",
                "reason": "The current follow-up action has already been executed.",
                "explanation": _explanation(db, case),
            }

    events = list_audit_events(db, case.id)
    last_link_event = next((e for e in reversed(events) if e.event_type == "payment_link_created"), None)
    url = last_link_event.event_data.get("url") if last_link_event else "https://rzp.io/i/demo_link"
    
    res = dispatch_channel_communication(
        db, case, url, override_channel=req.channel, automatic=False
    )
    return res


@router.post("/{case_id}/next-step")
def run_next_recovery_step(case_id: str, db: Session = Depends(get_db)):
    case = _case(db, case_id)
    if case.status in {CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED}:
        raise HTTPException(status_code=400, detail="Cannot run next step on a terminal case.")

    if case.status == CaseStatus.HUMAN_REVIEW and not case.policy_check_passed:
        raise HTTPException(status_code=400, detail="Case requires human approval before proceeding.")

    # Get communication records
    case_records = list(
        db.scalars(
            select(CommunicationRecord)
            .where(CommunicationRecord.case_id == case.id)
            .order_by(CommunicationRecord.created_at.desc())
        )
    )

    all_records = list(
        db.scalars(
            select(CommunicationRecord)
            .join(PaymentCase)
            .where(PaymentCase.customer_id == case.customer_id)
            .order_by(CommunicationRecord.created_at.desc())
        )
    )

    intel = evaluate_channel_suitability(case, case.customer, case_records, all_records)
    followup = intel.followup_decision

    if not followup:
        raise HTTPException(status_code=400, detail="No follow-up decision available.")

    events = list_audit_events(db, case.id)
    last_link_event = next((e for e in reversed(events) if e.event_type == "payment_link_created"), None)
    url = last_link_event.event_data.get("url") if last_link_event else "https://rzp.io/i/demo_link"

    if (case.retry_count or 0) >= (case.max_retries or 3):
        raise HTTPException(status_code=400, detail="Maximum recovery attempts reached.")

    # Duplicate / Idempotency prevention: If the latest attempt is already awaiting customer response
    if (case_records and case_records[0].outcome in {"AWAITING_RESPONSE", "PENDING_RESPONSE"}) or followup.next_action == "AWAIT_RESPONSE":
        return {
            "status": "no_action",
            "reason": "The current follow-up action has already been executed.",
            "explanation": _explanation(db, case)
        }

    now = datetime.now(timezone.utc).replace(tzinfo=None)

    if followup.next_action == "STOP_RECOVERY":
        case.status = CaseStatus.ABANDONED
        case.recovery_action = RecoveryAction.NONE
        db.commit()
        log_audit_event(db, case.id, "recovery_closed", {"reason": followup.reason})
        return {"action": "stopped", "message": followup.reason, "explanation": _explanation(db, case)}

    elif followup.next_action == "RETRY_SAME_CHANNEL":
        channel = followup.selected_channel or "whatsapp"
        attempt_num = len(case_records) + 1
        case.retry_count = attempt_num
        db.commit()

        ch_name = "WhatsApp" if channel == "whatsapp" else "SMS" if channel == "sms" else "Email"
        record = CommunicationRecord(
            case_id=case.id,
            channel=channel,
            status="SIMULATED",
            suitability_score=intel.suitability_score,
            channel_scores=intel.channel_scores,
            reason=followup.reason,
            attempt_number=attempt_num,
            simulated=True,
            outcome="AWAITING_RESPONSE",
            delivery_status="DELIVERED",
            recipient=case.customer.phone if channel in {"whatsapp", "sms"} else case.customer.email,
            message_snippet=f"{ch_name} reminder delivered — Awaiting customer response",
            created_at=now,
        )
        db.add(record)
        case.selected_channel = channel
        case.notification_status = f"{channel.upper()}_SIMULATED"
        db.commit()

        log_audit_event(db, case.id, "recovery_reminder_dispatched", {
            "channel": channel,
            "attempt_number": attempt_num,
            "wait_period": followup.recommended_wait_period,
            "reason": followup.reason,
        })

        if attempt_num >= (case.max_retries or 3):
            case.status = CaseStatus.ABANDONED
            case.recovery_action = RecoveryAction.NONE
            db.commit()
            log_audit_event(db, case.id, "recovery_closed", {"reason": "Maximum recovery attempts reached."})

        return {"action": "reminder_dispatched", "channel": channel, "attempt": attempt_num, "explanation": _explanation(db, case)}

    elif followup.next_action == "SWITCH_CHANNEL":
        channel = followup.selected_channel or "sms"
        attempt_num = len(case_records) + 1
        case.retry_count = attempt_num
        db.commit()

        ch_name = "WhatsApp" if channel == "whatsapp" else "SMS" if channel == "sms" else "Email"
        record = CommunicationRecord(
            case_id=case.id,
            channel=channel,
            status="SIMULATED",
            suitability_score=intel.channel_scores.get(channel, 0.70),
            channel_scores=intel.channel_scores,
            reason=followup.reason,
            attempt_number=attempt_num,
            simulated=True,
            outcome="AWAITING_RESPONSE",
            delivery_status="DELIVERED",
            recipient=case.customer.phone if channel in {"whatsapp", "sms"} else case.customer.email,
            message_snippet=f"{ch_name} escalation notice delivered — Awaiting customer response",
            created_at=now,
        )
        db.add(record)
        case.selected_channel = channel
        case.notification_status = f"{channel.upper()}_SIMULATED"
        db.commit()

        log_audit_event(db, case.id, "channel_switched", {
            "channel": channel,
            "attempt_number": attempt_num,
            "reason": followup.reason,
        })

        if attempt_num >= (case.max_retries or 3):
            case.status = CaseStatus.ABANDONED
            case.recovery_action = RecoveryAction.NONE
            db.commit()
            log_audit_event(db, case.id, "recovery_closed", {"reason": "Maximum recovery attempts reached."})

        return {"action": "channel_switched", "channel": channel, "attempt": attempt_num, "explanation": _explanation(db, case)}

    elif followup.next_action == "DISPATCH_INITIAL":
        res = dispatch_channel_communication(db, case, url, override_channel=followup.selected_channel, automatic=False)
        return {"action": "dispatched", "result": res, "explanation": _explanation(db, case)}

    return {"action": followup.next_action, "explanation": _explanation(db, case)}


@router.post("/{case_id}/payment-attempt")
def record_case_payment_attempt(
    case_id: str,
    payload: RecordPaymentAttemptRequest,
    db: Session = Depends(get_db),
):
    case = _case(db, case_id)
    return record_payment_attempt(
        db=db,
        case=case,
        payment_method=payload.payment_method or "card",
        status=payload.status,
        failure_reason=payload.failure_reason,
        amount=payload.amount,
    )


@router.get("/{case_id}/payment-attempts", response_model=list[PaymentAttemptSummary])
def get_case_payment_attempts(
    case_id: str,
    db: Session = Depends(get_db),
) -> list[PaymentAttemptSummary]:
    case = _case(db, case_id)
    return [PaymentAttemptSummary.model_validate(pa) for pa in case.payment_attempts]
