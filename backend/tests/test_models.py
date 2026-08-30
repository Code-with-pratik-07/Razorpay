from app.models.payment_case import CaseStatus, RecoveryAction
from app.models.recovery_policy import RecoveryPolicy
from app.db.database import SessionLocal, init_db


def test_default_policy_uses_inr_paise() -> None:
    init_db()
    policy = RecoveryPolicy()
    with SessionLocal() as db:
        db.add(policy)
        db.commit()
        db.refresh(policy)
        assert policy.max_retry_attempts == 3
        assert policy.max_auto_recovery_amount == 2000000


def test_case_enums_are_restricted() -> None:
    assert CaseStatus.FAILED.value == "failed"
    assert RecoveryAction.PAYMENT_LINK.value == "payment_link"
