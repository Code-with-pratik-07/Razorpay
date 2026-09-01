import pytest
from datetime import datetime, timedelta, timezone

from app.db.database import SessionLocal, init_db
from app.models.payment_case import CaseStatus, RecoveryAction, NextActionType
from app.services.recovery_service import execute_recovery
from app.services.razorpay_service import RazorpayService
from tests.helpers import create_case

@pytest.fixture(autouse=True)
def mock_razorpay(monkeypatch):
    monkeypatch.setattr(RazorpayService, "create_payment_link", lambda self, payload: {"id": "plink_123", "short_url": "https://rzp.io/i/123"})

def test_execute_recovery_sets_next_action_reminder():
    init_db()
    with SessionLocal() as db:
        case = create_case(db, recovery_probability=0.88, amount=5000)
        result = execute_recovery(db, case, automatic=True)
        assert result["action"] == "payment_link"
        assert case.retry_count == 1
        assert case.next_action_type == NextActionType.REMINDER
        assert case.payment_link_expires_at is not None

def test_execute_recovery_with_active_link_sends_reminder():
    init_db()
    with SessionLocal() as db:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        case = create_case(
            db, 
            recovery_probability=0.88, 
            amount=5000, 
            status=CaseStatus.RECOVERING,
            payment_link_expires_at=now + timedelta(days=6),
            next_action_type=NextActionType.REMINDER,
            next_action_at=now - timedelta(minutes=5), # due now
            retry_count=1
        )
        
        result = execute_recovery(db, case, automatic=True)
        assert result["action"] == "reminder"
        assert case.retry_count == 1  # unchanged
        assert case.next_action_type in {NextActionType.REMINDER, NextActionType.EXPIRY_CHECK}

def test_execute_recovery_abandons_only_when_exhausted_and_expired():
    init_db()
    with SessionLocal() as db:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        # Low case (max 1), already has 1 retry, and link is expired
        case = create_case(
            db, 
            recovery_probability=0.25, 
            amount=5000, 
            status=CaseStatus.RECOVERING,
            payment_link_expires_at=now - timedelta(days=1), # expired
            max_retries=1,
            retry_count=1
        )
        result = execute_recovery(db, case, automatic=True)
        assert result["action"] == "abandoned"
        assert case.status == CaseStatus.ABANDONED
        
def test_execute_recovery_does_not_abandon_if_active():
    init_db()
    with SessionLocal() as db:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        # Low case (max 1), already has 1 retry, but link is still active!
        case = create_case(
            db, 
            recovery_probability=0.25, 
            amount=5000, 
            status=CaseStatus.RECOVERING,
            payment_link_expires_at=now + timedelta(days=5), # ACTIVE
            max_retries=1,
            retry_count=1
        )
        result = execute_recovery(db, case, automatic=True)
        # Should just send reminder or wait, but NOT abandon
        assert result["action"] != "abandoned"
        assert case.status != CaseStatus.ABANDONED
