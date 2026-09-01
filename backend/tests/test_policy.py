from datetime import datetime, timedelta, timezone

import pytest

from app.db.database import SessionLocal, init_db
from app.models.payment_case import CaseStatus
from app.models.recovery_policy import RecoveryPolicy
from app.models.audit_event import AuditEvent
from app.services.policy_service import check_recovery_policy
from tests.helpers import create_case


@pytest.fixture
def policy() -> RecoveryPolicy:
    return RecoveryPolicy(
        max_retry_attempts=3,
        max_recovery_window_days=7,
        max_auto_recovery_amount=2000000,
        min_time_between_retries_hours=24,
    )


def _check(policy: RecoveryPolicy, **overrides: object):
    init_db()
    with SessionLocal() as db:
        case = create_case(db, **overrides)
        return check_recovery_policy(case, policy, now=datetime.now(timezone.utc).replace(tzinfo=None))


def test_inr_amounts_at_or_below_limit_are_allowed(policy: RecoveryPolicy) -> None:
    assert _check(policy, amount=499900).allowed  # ₹4,999
    assert _check(policy, amount=2000000).allowed  # ₹20,000


def test_amount_above_inr_limit_requires_human_approval(policy: RecoveryPolicy) -> None:
    result = _check(policy, amount=2000100)  # ₹20,001
    assert not result.allowed
    assert result.requires_human_approval


def test_retry_limit_and_cooldown_are_enforced(policy: RecoveryPolicy) -> None:
    assert _check(policy, retry_count=0).allowed
    assert not _check(policy, retry_count=3).allowed
    cooldown = _check(policy, last_retry_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=12))
    assert not cooldown.allowed
    assert cooldown.retry_after is not None


def test_expired_and_terminal_cases_are_blocked(policy: RecoveryPolicy) -> None:
    assert not _check(policy, created_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=8)).allowed
    assert not _check(policy, status=CaseStatus.HUMAN_REVIEW).allowed


from app.ai.groq_service import fallback_decision

def test_fallback_decision_policy_blocked_high():
    decision = fallback_decision({"recovery_probability": 0.88}, set())
    assert decision.recommended_action == "escalate"
    assert "Recovery probability is high, but automatic recovery is blocked by policy." in decision.reasoning
    assert "Please wait while we review" in decision.customer_message

def test_fallback_decision_policy_blocked_uncertain():
    decision = fallback_decision({"recovery_probability": 0.55}, set())
    assert decision.recommended_action == "escalate"
    assert "Recovery probability is uncertain, and automatic recovery is blocked by policy." in decision.reasoning

def test_fallback_decision_policy_blocked_low():
    decision = fallback_decision({"recovery_probability": 0.25}, set())
    assert decision.recommended_action == "escalate"
    assert "Recovery probability is low, and automatic recovery is blocked by policy." in decision.reasoning

def test_fallback_decision_policy_blocked_cold_start():
    decision = fallback_decision({"recovery_probability": 0.95, "is_cold_start": True}, set())
    assert decision.recommended_action == "escalate"
    assert "Customer history is limited, and automatic recovery is blocked by policy." in decision.reasoning

def test_fallback_decision_automatic_permitted_high():
    decision = fallback_decision({"recovery_probability": 0.88}, {"payment_link"})
    assert decision.recommended_action == "payment_link"
    assert "High recovery probability. Automatic payment-link recovery is recommended." in decision.reasoning
