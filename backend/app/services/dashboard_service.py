from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.payment_case import CaseStatus, PaymentCase


def dashboard_stats(db: Session) -> dict[str, int | float]:
    cases = list(db.scalars(select(PaymentCase)))
    at_risk = [case for case in cases if case.status not in {CaseStatus.RECOVERED, CaseStatus.CLOSED}]
    recovered = [case for case in cases if case.status == CaseStatus.RECOVERED]
    processed = cases
    human_review = [case for case in cases if case.status == CaseStatus.HUMAN_REVIEW]

    from app.models.audit_event import AuditEvent
    audit_events = list(db.scalars(select(AuditEvent).where(AuditEvent.event_type == "recovery_started")))
    automatic_count = sum(1 for e in audit_events if isinstance(e.event_data, dict) and e.event_data.get("automatic") is True)

    revenue_at_risk = sum(case.amount for case in at_risk)
    revenue_recovered = sum(case.amount for case in recovered)
    total_opportunity = revenue_recovered + revenue_at_risk
    recovery_rate = round((revenue_recovered / total_opportunity) * 100, 1) if total_opportunity > 0 else 0.0

    payment_successful = 0
    payment_failed = 0
    awaiting_payment = 0

    for case in cases:
        reached_payment_stage = (
            case.status in [
                CaseStatus.RECOVERING,
                CaseStatus.RECOVERED,
            ]
            or case.last_payment_status is not None
        )

        if not reached_payment_stage:
            continue

        if (
            case.status == CaseStatus.RECOVERED
            or case.last_payment_status == "SUCCESS"
        ):
            payment_successful += 1
        elif case.last_payment_status == "FAILED":
            payment_failed += 1
        elif case.status == CaseStatus.RECOVERING:
            awaiting_payment += 1

    return {
        "revenue_at_risk": revenue_at_risk,
        "revenue_recovered": revenue_recovered,
        "recovery_rate": recovery_rate,
        "cases_processed": len(processed),
        "human_review_cases": len(human_review),
        "human_review_amount": sum(case.amount for case in human_review),
        "automatic_recoveries": automatic_count,
        "customer_payment_status": {
            "awaiting_payment": awaiting_payment,
            "payment_failed": payment_failed,
            "payment_successful": payment_successful,
        }
    }


def at_risk_breakdown(db: Session) -> dict[str, int]:
    cases = list(db.scalars(select(PaymentCase).where(PaymentCase.status != CaseStatus.RECOVERED)))
    return dict(Counter(case.failure_reason or "unknown" for case in cases))
