from sqlalchemy.orm import Session

from app.services.audit_service import log_audit_event


def send_mock_recovery_message(db: Session, case_id: str, message: str) -> None:
    """Records a simulated notification only; no real SMS, email, or WhatsApp is sent."""
    log_audit_event(db, case_id, "recovery_message_generated", {"channel": "mock", "message": message, "simulated": True})
