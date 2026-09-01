import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from typing import Any

from app.db.database import SessionLocal
from app.models.payment_case import PaymentCase, CaseStatus
from app.services.recovery_service import execute_recovery

logger = logging.getLogger(__name__)

def run_scheduler() -> dict[str, Any]:
    """
    Finds all cases that are due for their next recovery action and executes them.
    Idempotent and safe to run frequently.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    processed_count = 0
    errors = 0

    with SessionLocal() as db:
        eligible_cases = (
            db.query(PaymentCase)
            .filter(PaymentCase.status.notin_([CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED]))
            .filter(PaymentCase.next_action_at != None)
            .filter(PaymentCase.next_action_at <= now)
            .all()
        )

        for case in eligible_cases:
            try:
                execute_recovery(db, case, automatic=True)
                processed_count += 1
            except Exception as e:
                logger.error(f"Error processing case {case.id} in scheduler: {e}")
                errors += 1
                db.rollback()

    return {
        "status": "success",
        "processed_count": processed_count,
        "errors": errors
    }
