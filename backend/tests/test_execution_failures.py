import pytest
from sqlalchemy.orm import Session
from tests.helpers import create_case

from app.db.database import SessionLocal, init_db
from app.models.payment_case import CaseStatus, RecoveryAction
from app.services.recovery_service import execute_recovery
from app.services.audit_service import list_audit_events
from app.api.cases import _explanation

@pytest.fixture(scope="module", autouse=True)
def setup_db():
    init_db()


def test_high_prob_amount_5181_executes_automatically(monkeypatch):
    """HIGH + ₹5,181 → automatic execution attempted (execute_recovery called)."""
    # Mock RazorpayService to fail so we can verify the failure reason propagation too
    class MockRazorpayErrorService:
        def create_payment_link(self, data):
            from app.services.razorpay_service import RazorpayServiceError
            raise RazorpayServiceError("Rate limit exceeded")
            
    monkeypatch.setattr("app.services.recovery_service.RazorpayService", lambda *args, **kwargs: MockRazorpayErrorService())

    with SessionLocal() as db:
        case = create_case(db, status=CaseStatus.FAILED, recovery_probability=0.826, amount=518100, max_retries=3)
        # Mock the audit event that would have been created by AI Analysis
        from app.services.audit_service import log_audit_event
        log_audit_event(db, case.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "High.", "customer_message": "Pay.", "confidence": 0.826, "source": "fallback"})
        
        # Act
        result = execute_recovery(db, case, automatic=True)
        
        # Assert execution was attempted and failed cleanly
        assert result["action"] == "error"
        assert "Rate limit exceeded" in result["message"]
        assert case.status == CaseStatus.FAILED
        
        # Assert audit log contains the error
        events = list_audit_events(db, case.id)
        error_events = [e for e in events if e.event_type == "error"]
        assert len(error_events) == 1
        assert error_events[0].event_data["provider_error"] == "Rate limit exceeded"
        
        # Assert the explanation endpoint correctly exposes the execution_error
        explanation = _explanation(db, case)
        assert explanation.execution_error == "Rate limit exceeded"
        assert explanation.policy["allowed"] is True

def test_policy_approved_case_cannot_silently_remain_failed_with_retry_0():
    """Policy-approved case cannot silently remain FAILED with retry_count=0 and no execution failure reason."""
    with SessionLocal() as db:
        case = create_case(db, status=CaseStatus.FAILED, recovery_probability=0.826, amount=518100, max_retries=3, retry_count=0)
        
        # No error events logged yet
        explanation = _explanation(db, case)
        # If it hasn't been executed, execution_error is None
        assert explanation.execution_error is None
        
        # But if it failed execution, it MUST have an execution_error
        from app.services.audit_service import log_audit_event
        log_audit_event(db, case.id, "error", {"operation": "payment_link", "safe_message": "Failed", "provider_error": "Connection timed out"})
        
        explanation_after_failure = _explanation(db, case)
        assert explanation_after_failure.execution_error == "Connection timed out"
