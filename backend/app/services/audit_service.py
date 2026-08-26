"""Append-only audit logging. No mutation or deletion operation is exposed."""

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_event import AuditEvent


def log_audit_event(db: Session, case_id: str, event_type: str, event_data: dict[str, Any] | None = None) -> AuditEvent:
    event = AuditEvent(case_id=case_id, event_type=event_type, event_data=event_data or {})
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def list_audit_events(db: Session, case_id: str) -> list[AuditEvent]:
    statement = select(AuditEvent).where(AuditEvent.case_id == case_id).order_by(AuditEvent.timestamp.asc(), AuditEvent.id.asc())
    return list(db.scalars(statement))
