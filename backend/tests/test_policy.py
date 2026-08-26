from datetime import datetime, timedelta

import pytest

from app.db.database import SessionLocal, init_db
from app.models.payment_case import CaseStatus
from app.models.recovery_policy import RecoveryPolicy
from app.services.policy_service import check_recovery_policy
from tests.helpers import create_case


@pytest.fixture
def policy() -> RecoveryPolicy:
    return RecoveryPolicy(
        max_retry_attempts=3,
        max_recovery_window_days=7,
        max_auto_recovery_amount=500000,
        min_time_between_retries_hours=24,
    )


def _check(policy: RecoveryPolicy, **overrides: object):
    init_db()
    with SessionLocal() as db:
        case = create_case(db, **overrides)
        return check_recovery_policy(case, policy, now=datetime.utcnow())


def test_inr_amounts_at_or_below_limit_are_allowed(policy: RecoveryPolicy) -> None:
    assert _check(policy, amount=499900).allowed  # ₹4,999
    assert _check(policy, amount=500000).allowed  # ₹5,000


def test_amount_above_inr_limit_requires_human_approval(policy: RecoveryPolicy) -> None:
    result = _check(policy, amount=500100)  # ₹5,001
    assert not result.allowed
    assert result.requires_human_approval


def test_retry_limit_and_cooldown_are_enforced(policy: RecoveryPolicy) -> None:
    assert _check(policy, retry_count=0).allowed
    assert not _check(policy, retry_count=3).allowed
    cooldown = _check(policy, last_retry_at=datetime.utcnow() - timedelta(hours=12))
    assert not cooldown.allowed
    assert cooldown.retry_after is not None


def test_expired_and_terminal_cases_are_blocked(policy: RecoveryPolicy) -> None:
    assert not _check(policy, created_at=datetime.utcnow() - timedelta(days=8)).allowed
    assert not _check(policy, status=CaseStatus.RECOVERED).allowed
    assert not _check(policy, status=CaseStatus.CLOSED).allowed
