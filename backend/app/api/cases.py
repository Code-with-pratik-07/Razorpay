from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.db.database import get_db
from app.models.payment_case import PaymentCase
from app.schemas.recovery import CaseExplanation, CaseSummary, ExecuteRecoveryResponse
from app.services.recovery_service import _features, _last_ai_decision, _policy, analyze_case, execute_recovery
from app.services.policy_service import check_recovery_policy

router = APIRouter(prefix="/api/cases", tags=["cases"])


def _case(db: Session, case_id: str) -> PaymentCase:
    case = db.scalar(select(PaymentCase).options(joinedload(PaymentCase.customer)).where(PaymentCase.id == case_id))
    if case is None: raise HTTPException(status_code=404, detail="Recovery case not found.")
    return case


def _summary(case: PaymentCase) -> dict:
    return {"id": case.id, "case_number": case.case_number, "customer_email": case.customer.email, "amount": case.amount, "currency": case.currency, "status": case.status.value, "failure_reason": case.failure_reason, "payment_method": case.payment_method, "recovery_probability": case.recovery_probability, "recovery_action": case.recovery_action.value, "retry_count": case.retry_count, "max_retries": case.max_retries, "policy_check_passed": case.policy_check_passed, "policy_reason": case.policy_reason, "created_at": case.created_at}


@router.get("", response_model=list[CaseSummary])
def list_cases(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)) -> list[CaseSummary]:
    cases = list(db.scalars(select(PaymentCase).options(joinedload(PaymentCase.customer)).order_by(PaymentCase.created_at.desc()).offset(skip).limit(limit)))
    return [CaseSummary(**_summary(case)) for case in cases]


@router.get("/{case_id}", response_model=CaseSummary)
def get_case(case_id: str, db: Session = Depends(get_db)) -> CaseSummary:
    return CaseSummary(**_summary(_case(db, case_id)))


@router.post("/{case_id}/analyze", response_model=CaseExplanation)
def analyze(case_id: str, db: Session = Depends(get_db)) -> CaseExplanation:
    case = _case(db, case_id); analyze_case(db, case)
    return _explanation(db, case)


@router.get("/{case_id}/explanation", response_model=CaseExplanation)
def explanation(case_id: str, db: Session = Depends(get_db)) -> CaseExplanation:
    return _explanation(db, _case(db, case_id))


def _explanation(db: Session, case: PaymentCase) -> CaseExplanation:
    policy = check_recovery_policy(case, _policy(db)).to_dict()
    history = {"lifetime_value": case.customer.lifetime_value, "successful_payments": case.customer.successful_payments, "failed_payments": case.customer.failed_payments}
    return CaseExplanation(**_summary(case), ml={"recovery_probability": case.recovery_probability, "features": _features(case)}, policy=policy, ai=_last_ai_decision(db, case.id), customer_history=history)


@router.post("/{case_id}/execute", response_model=ExecuteRecoveryResponse)
def execute(case_id: str, db: Session = Depends(get_db)) -> ExecuteRecoveryResponse:
    case = _case(db, case_id)
    return ExecuteRecoveryResponse(case_id=case.id, **execute_recovery(db, case))
