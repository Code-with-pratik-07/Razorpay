"""Tests for the three-way ML routing: HIGH → automatic recovery, UNCERTAIN → HUMAN_REVIEW, LOW → ABANDONED."""

import pytest
from datetime import datetime, timezone

from app.db.database import SessionLocal, init_db
from app.models.payment_case import CaseStatus, RecoveryAction
from app.services.recovery_service import (
    ML_HIGH_THRESHOLD,
    ML_UNCERTAIN_THRESHOLD,
    analyze_case,
    execute_recovery,
    ml_routing_decision,
)
from tests.helpers import create_case


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _case(monkeypatch, **overrides):
    monkeypatch.setenv("GROQ_API_KEY", "")
    init_db()
    with SessionLocal() as db:
        case = create_case(db, **overrides)
        return case.id


# ---------------------------------------------------------------------------
# Unit: ml_routing_decision
# ---------------------------------------------------------------------------

class TestMlRoutingDecision:
    def test_none_is_low(self):
        assert ml_routing_decision(None) == "LOW"

    def test_zero_is_low(self):
        assert ml_routing_decision(0.0) == "LOW"

    def test_explicit_0_3999_is_low(self):
        assert ml_routing_decision(0.3999) == "LOW"

    def test_explicit_0_40_is_uncertain(self):
        assert ml_routing_decision(0.40) == "UNCERTAIN"

    def test_explicit_0_5999_is_uncertain(self):
        assert ml_routing_decision(0.5999) == "UNCERTAIN"

    def test_explicit_0_60_is_high(self):
        assert ml_routing_decision(0.60) == "HIGH"

    def test_explicit_0_6001_is_high(self):
        assert ml_routing_decision(0.6001) == "HIGH"

    def test_between_thresholds_is_uncertain(self):
        assert ml_routing_decision(0.55) == "UNCERTAIN"


# ---------------------------------------------------------------------------
# Integration: analyze_case ML routing via injected probability
# ---------------------------------------------------------------------------

class TestAnalyzeCaseRouting:
    """analyze_case is the single routing authority. We use a mock Razorpay service
    for execute_recovery so these tests never touch real payment APIs."""

    def _run_analyze(self, monkeypatch, recovery_probability_override: float):
        """Run analyze_case with a controlled ML probability by monkey-patching predict_recovery."""
        monkeypatch.setenv("GROQ_API_KEY", "")

        import app.services.recovery_service as rs

        def mock_predict(features, model_path=None):
            return {"recovery_probability": recovery_probability_override, "risk_level": "TEST", "feature_summary": features}

        monkeypatch.setattr(rs, "predict_recovery", mock_predict)
        init_db()
        with SessionLocal() as db:
            case = create_case(db, status=CaseStatus.FAILED, amount=1000)
            result = analyze_case(db, case)
            db.refresh(case)
            return case, result

    def test_high_probability_sets_failed_status(self, monkeypatch):
        """HIGH ML → status=FAILED (ready for auto execute_recovery)."""
        case, result = self._run_analyze(monkeypatch, 0.85)
        assert case.status == CaseStatus.FAILED
        assert result.get("ml_decision") == "HIGH"

    def test_uncertain_probability_sets_human_review(self, monkeypatch):
        """UNCERTAIN ML → status=HUMAN_REVIEW, no Payment Link."""
        case, result = self._run_analyze(monkeypatch, 0.55)
        assert case.status == CaseStatus.HUMAN_REVIEW
        assert result.get("ml_decision") == "UNCERTAIN"

    def test_low_probability_sets_abandoned(self, monkeypatch):
        """LOW ML → status=ABANDONED, no Payment Link."""
        case, result = self._run_analyze(monkeypatch, 0.25)
        assert case.status == CaseStatus.ABANDONED
        assert result.get("ml_decision") == "LOW"

    def test_policy_blocked_overrides_high_ml(self, monkeypatch):
        """Policy block trumps HIGH ML — case goes to HUMAN_REVIEW regardless."""
        monkeypatch.setenv("GROQ_API_KEY", "")

        import app.services.recovery_service as rs

        def mock_predict(features, model_path=None):
            return {"recovery_probability": 0.90, "risk_level": "HIGH", "feature_summary": features}

        monkeypatch.setattr(rs, "predict_recovery", mock_predict)
        init_db()
        # amount > 2000000 triggers policy block
        with SessionLocal() as db:
            case = create_case(db, status=CaseStatus.FAILED, amount=2500000)
            analyze_case(db, case)
            db.refresh(case)
            assert case.status == CaseStatus.HUMAN_REVIEW
            assert case.policy_check_passed is False

    def test_uncertain_audit_event_recorded(self, monkeypatch):
        """UNCERTAIN routing records a human_escalation audit event with ml_routing source."""
        from sqlalchemy import select
        from app.models.audit_event import AuditEvent

        case, _ = self._run_analyze(monkeypatch, 0.55)
        with SessionLocal() as db:
            events = list(db.scalars(select(AuditEvent).where(AuditEvent.case_id == case.id)))
        escalation = next((e for e in events if e.event_type == "human_escalation"), None)
        assert escalation is not None
        assert escalation.event_data.get("source") == "ml_routing"
        assert escalation.event_data.get("ml_decision") == "UNCERTAIN"

    def test_low_recovery_stopped_audit_event_recorded(self, monkeypatch):
        """LOW routing records a recovery_stopped audit event."""
        from sqlalchemy import select
        from app.models.audit_event import AuditEvent

        case, _ = self._run_analyze(monkeypatch, 0.20)
        with SessionLocal() as db:
            events = list(db.scalars(select(AuditEvent).where(AuditEvent.case_id == case.id)))
        stopped = next((e for e in events if e.event_type == "recovery_stopped"), None)
        assert stopped is not None
        assert stopped.event_data.get("ml_decision") == "LOW"


# ---------------------------------------------------------------------------
# Integration: execute_recovery respects ML routing
# ---------------------------------------------------------------------------

class TestExecuteRecoveryMlRouting:
    def _dummy_razorpay(self, monkeypatch):
        import app.services.recovery_service as rs

        class DummyRazorpay:
            def create_payment_link(self, data):
                return {"id": "inv_test_123", "short_url": "https://rzp.io/rzp/test"}

        monkeypatch.setattr(rs, "RazorpayService", lambda *a, **kw: DummyRazorpay())

    def test_abandoned_case_cannot_be_executed(self, monkeypatch):
        """LOW → ABANDONED cases return 'stopped' and are not sent to Razorpay."""
        monkeypatch.setenv("GROQ_API_KEY", "")
        self._dummy_razorpay(monkeypatch)
        case_id = _case(monkeypatch, status=CaseStatus.ABANDONED, amount=1000, recovery_probability=0.15)
        with SessionLocal() as db:
            case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
            result = execute_recovery(db, case)
        assert result["action"] == "stopped"
        assert case.status == CaseStatus.ABANDONED

    def test_low_probability_manual_execute_blocked(self, monkeypatch):
        """Manual execute on a FAILED case with LOW probability is blocked."""
        monkeypatch.setenv("GROQ_API_KEY", "")
        self._dummy_razorpay(monkeypatch)
        # FAILED status but LOW probability — merchant tries to execute manually.
        case_id = _case(monkeypatch, status=CaseStatus.FAILED, amount=1000, recovery_probability=0.20)
        with SessionLocal() as db:
            case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
            result = execute_recovery(db, case, automatic=False)
        assert result["action"] == "stopped"
        assert case.status == CaseStatus.ABANDONED

    def test_human_review_can_be_manually_executed(self, monkeypatch):
        """HUMAN_REVIEW with HIGH probability and policy allowed → merchant can approve."""
        monkeypatch.setenv("GROQ_API_KEY", "")
        monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
        monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
        self._dummy_razorpay(monkeypatch)
        case_id = _case(monkeypatch, status=CaseStatus.HUMAN_REVIEW, amount=1000, recovery_probability=0.85)
        with SessionLocal() as db:
            case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
            result = execute_recovery(db, case, automatic=False)
        assert result["action"] == "payment_link"
        assert result["payment_link_url"] == "https://rzp.io/rzp/test"

    def test_high_probability_auto_execute_creates_payment_link(self, monkeypatch):
        """HIGH probability + policy allowed → automatic execute creates a Payment Link."""
        monkeypatch.setenv("GROQ_API_KEY", "")
        monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
        monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
        self._dummy_razorpay(monkeypatch)
        case_id = _case(monkeypatch, status=CaseStatus.FAILED, amount=1000, recovery_probability=0.85)
        with SessionLocal() as db:
            case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
            result = execute_recovery(db, case, automatic=True)
        assert result["action"] == "payment_link"
        assert result["payment_link_url"] is not None
        assert case.status == CaseStatus.RECOVERING


# ---------------------------------------------------------------------------
# Integration: message action fix
# ---------------------------------------------------------------------------

class TestMessageActionFix:
    def test_groq_message_does_not_escalate(self, monkeypatch):
        """Groq recommending 'message' must NOT silently convert to 'escalate'."""
        from app.ai.groq_service import GroqRecoveryAdvisor

        class MessageClient:
            class chat:
                class completions:
                    @staticmethod
                    def create(**_):
                        import types, json
                        content = json.dumps({
                            "recommended_action": "message",
                            "reasoning": "Send a gentle reminder.",
                            "customer_message": "Please complete your payment.",
                            "confidence": 0.5,
                            "source": "groq",
                        })
                        m = types.SimpleNamespace(content=content)
                        c = types.SimpleNamespace(message=m)
                        return types.SimpleNamespace(choices=[c])
                completions = completions()
            chat = chat()

        monkeypatch.setenv("GROQ_API_KEY", "")
        monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
        monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
        init_db()
        with SessionLocal() as db:
            case = create_case(db, status=CaseStatus.FAILED, amount=1000, recovery_probability=0.85)
            # Inject a Groq client that recommends 'message'
            advisor = GroqRecoveryAdvisor(client=MessageClient())
            # Manually write an ai_analysis audit event with message action
            from app.services.audit_service import log_audit_event
            log_audit_event(db, case.id, "ai_analysis", {
                "recommended_action": "message",
                "reasoning": "Send reminder.",
                "customer_message": "Please complete payment.",
                "confidence": 0.5,
                "source": "groq",
            })
            result = execute_recovery(db, case, automatic=False)
        # Must be 'message', not 'escalate'
        assert result["action"] == "message"
        assert result["payment_link_url"] is None


# ---------------------------------------------------------------------------
# Integration: notification status accuracy
# ---------------------------------------------------------------------------

class TestNotificationStatus:
    def test_no_email_config_status_is_not_sent(self, monkeypatch):
        """When email is not configured, notification_status must be NOT_SENT (not SENT)."""
        monkeypatch.setenv("GROQ_API_KEY", "")
        monkeypatch.setenv("EMAIL_ENABLED", "false")
        monkeypatch.setenv("EMAIL_PROVIDER_API_KEY", "")
        monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
        monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
        __import__("app.core.config", fromlist=["get_settings"]).get_settings.cache_clear()

        import app.services.recovery_service as rs

        class DummyRazorpay:
            def create_payment_link(self, data):
                return {"id": "inv_123", "short_url": "https://rzp.io/rzp/test"}

        monkeypatch.setattr(rs, "RazorpayService", lambda *a, **kw: DummyRazorpay())
        init_db()
        with SessionLocal() as db:
            case = create_case(db, status=CaseStatus.FAILED, amount=1000, recovery_probability=0.85)
            execute_recovery(db, case, automatic=True)
            db.refresh(case)
        assert case.notification_status == "NOT_SENT"

    def test_no_customer_email_status_is_not_available(self, monkeypatch):
        """When customer has no email, notification_status must be NOT_AVAILABLE."""
        monkeypatch.setenv("GROQ_API_KEY", "")
        monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
        monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")

        import app.services.recovery_service as rs

        class DummyRazorpay:
            def create_payment_link(self, data):
                return {"id": "inv_124", "short_url": "https://rzp.io/rzp/test2"}

        monkeypatch.setattr(rs, "RazorpayService", lambda *a, **kw: DummyRazorpay())

        from app.models.customer import Customer
        init_db()
        with SessionLocal() as db:
            # Create customer with no email
            c = Customer(email=None)
            db.add(c); db.flush()
            case = create_case(db, customer_id=c.id, status=CaseStatus.FAILED, amount=1000, recovery_probability=0.85)
            execute_recovery(db, case, automatic=True)
            db.refresh(case)
        assert case.notification_status == "NOT_AVAILABLE"

class TestMaxRetriesLogic:
    def test_cold_start_max_retries_is_2(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "")
        import app.services.recovery_service as rs
        def mock_predict(features, model_path=None):
            return {"recovery_probability": 0.95, "risk_level": "TEST", "feature_summary": features}
        monkeypatch.setattr(rs, "predict_recovery", mock_predict)
        
        init_db()
        with SessionLocal() as db:
            from app.models.customer import Customer
            # Force cold start (0 successful, 0 failed)
            customer = Customer(email="test@cold.com", successful_payments=0, failed_payments=0)
            db.add(customer); db.flush()
            case = create_case(db, customer_id=customer.id, status=CaseStatus.FAILED)
            analyze_case(db, case)
            db.refresh(case)
            assert case.max_retries == 2
            assert rs.ml_routing_decision(case.recovery_probability, is_cold_start=True) == "COLD_START"

    def test_high_probability_max_retries_is_3(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "")
        import app.services.recovery_service as rs
        def mock_predict(features, model_path=None):
            return {"recovery_probability": 0.95, "risk_level": "TEST", "feature_summary": features}
        monkeypatch.setattr(rs, "predict_recovery", mock_predict)
        
        init_db()
        with SessionLocal() as db:
            from app.models.customer import Customer
            # Not a cold start (3 successful)
            customer = Customer(email="test@high.com", successful_payments=3, failed_payments=0)
            db.add(customer); db.flush()
            case = create_case(db, customer_id=customer.id, status=CaseStatus.FAILED)
            analyze_case(db, case)
            db.refresh(case)
            assert case.max_retries == 3
            assert rs.ml_routing_decision(case.recovery_probability, is_cold_start=False) == "HIGH"

    def test_uncertain_probability_max_retries_is_2(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "")
        import app.services.recovery_service as rs
        def mock_predict(features, model_path=None):
            return {"recovery_probability": 0.50, "risk_level": "TEST", "feature_summary": features}
        monkeypatch.setattr(rs, "predict_recovery", mock_predict)
        
        init_db()
        with SessionLocal() as db:
            from app.models.customer import Customer
            customer = Customer(email="test@unc.com", successful_payments=3, failed_payments=0)
            db.add(customer); db.flush()
            case = create_case(db, customer_id=customer.id, status=CaseStatus.FAILED)
            analyze_case(db, case)
            db.refresh(case)
            assert case.max_retries == 2
            assert rs.ml_routing_decision(case.recovery_probability, is_cold_start=False) == "UNCERTAIN"

    def test_low_probability_max_retries_is_1(self, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "")
        import app.services.recovery_service as rs
        def mock_predict(features, model_path=None):
            return {"recovery_probability": 0.20, "risk_level": "TEST", "feature_summary": features}
        monkeypatch.setattr(rs, "predict_recovery", mock_predict)
        
        init_db()
        with SessionLocal() as db:
            from app.models.customer import Customer
            customer = Customer(email="test@low.com", successful_payments=3, failed_payments=0)
            db.add(customer); db.flush()
            case = create_case(db, customer_id=customer.id, status=CaseStatus.FAILED)
            analyze_case(db, case)
            db.refresh(case)
            assert case.max_retries == 1
            assert rs.ml_routing_decision(case.recovery_probability, is_cold_start=False) == "LOW"
