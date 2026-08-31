from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.payment_case import CaseStatus, PaymentCase


def dashboard_stats(db: Session) -> dict[str, int | float]:
    cases = list(db.scalars(select(PaymentCase)))
    at_risk = [case for case in cases if case.status not in {CaseStatus.RECOVERED, CaseStatus.CLOSED}]
    recovered = [case for case in cases if case.status == CaseStatus.RECOVERED]
    processed = [case for case in cases if case.status in {CaseStatus.FAILED, CaseStatus.RECOVERING, CaseStatus.RECOVERED, CaseStatus.ABANDONED}]
    human_review = [case for case in cases if case.status == CaseStatus.HUMAN_REVIEW]

    from app.models.audit_event import AuditEvent
    audit_events = list(db.scalars(select(AuditEvent).where(AuditEvent.event_type == "recovery_started")))
    automatic_count = sum(1 for e in audit_events if isinstance(e.event_data, dict) and e.event_data.get("automatic") is True)

    return {
        "revenue_at_risk": sum(case.amount for case in at_risk),
        "revenue_recovered": sum(case.amount for case in recovered),
        "recovery_rate": round(len(recovered) / len(cases), 4) if cases else 0.0,
        "cases_processed": len(processed),
        "human_review_cases": len(human_review),
        "human_review_amount": sum(case.amount for case in human_review),
        "automatic_recoveries": automatic_count
    }


def at_risk_breakdown(db: Session) -> dict[str, int]:
    cases = list(db.scalars(select(PaymentCase).where(PaymentCase.status != CaseStatus.RECOVERED)))
    return dict(Counter(case.failure_reason or "unknown" for case in cases))
