from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.payment_case import PaymentCase
from app.schemas.audit import AuditEventRead
from app.services.audit_service import list_audit_events

router = APIRouter(prefix="/api/cases/{case_id}/audit", tags=["audit"])


def _case_or_404(db: Session, case_id: str) -> None:
    if db.get(PaymentCase, case_id) is None:
        raise HTTPException(status_code=404, detail="Recovery case not found.")


@router.get("", response_model=list[AuditEventRead])
def get_audit_events(case_id: str, db: Session = Depends(get_db)) -> list[AuditEventRead]:
    _case_or_404(db, case_id)
    return list_audit_events(db, case_id)


@router.get("/export")
def export_audit_events(case_id: str, db: Session = Depends(get_db)) -> dict[str, object]:
    _case_or_404(db, case_id)
    events = [AuditEventRead.model_validate(event).model_dump(mode="json") for event in list_audit_events(db, case_id)]
    return {"case_id": case_id, "events": events}
