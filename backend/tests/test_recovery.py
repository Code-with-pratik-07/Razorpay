from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.ai.groq_service import GroqRecoveryAdvisor, GroqUnavailableError, groq_structured_schema
from app.db.database import SessionLocal, init_db
from app.models.payment_case import CaseStatus
from app.services.recovery_service import analyze_case, execute_recovery
from tests.helpers import create_case


class ValidCompletion:
    class choices:
        class message:
            content = '{"recommended_action":"payment_link","reasoning":"Policy permits a payment link recovery.","customer_message":"Please complete payment using the secure payment link.","confidence":0.7,"source":"fallback"}'
        message = message()
    choices = [choices()]


class ValidClient:
    class chat:
        class completions:
            @staticmethod
            def create(**_kwargs): return ValidCompletion()
        completions = completions()
    chat = chat()


class InvalidClient(ValidClient):
    class chat:
        class completions:
            @staticmethod
            def create(**_kwargs):
                return type("Response", (), {"choices": [type("Choice", (), {"message": type("Message", (), {"content": "not json"})()})()]})()
        completions = completions()
    chat = chat()


class RecordingClient(ValidClient):
    request: dict | None = None

    class chat:
        class completions:
            @staticmethod
            def create(**kwargs):
                RecordingClient.request = kwargs
                return ValidCompletion()
        completions = completions()
    chat = chat()


def _case(**values):
    init_db()
    with SessionLocal() as db:
        case = create_case(db, **values)
        case_id = case.id
    return case_id


def test_groq_success_and_invalid_response_fallback(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    case_id = _case()
    with SessionLocal() as db:
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        result = analyze_case(db, case, advisor=GroqRecoveryAdvisor(client=ValidClient()))
        assert result["ai"].source == "groq"
        try:
            GroqRecoveryAdvisor(client=InvalidClient()).advise({}, {"payment_link"})
        except GroqUnavailableError:
            pass
        else:
            raise AssertionError("Malformed AI response must be rejected")


def test_groq_strict_schema_disallows_extra_properties_for_every_object() -> None:
    nested_schema = {"type": "object", "properties": {"nested": {"type": "object", "properties": {"value": {"type": "string"}}}, "items": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "integer"}}}}}}
    normalized = groq_structured_schema(nested_schema)
    assert normalized["additionalProperties"] is False
    assert normalized["required"] == ["nested", "items"]
    assert normalized["properties"]["nested"]["additionalProperties"] is False
    assert normalized["properties"]["nested"]["required"] == ["value"]
    assert normalized["properties"]["items"]["items"]["additionalProperties"] is False
    assert normalized["properties"]["items"]["items"]["required"] == ["id"]
    GroqRecoveryAdvisor(client=RecordingClient()).advise({"case": "test"}, {"payment_link"})
    schema = RecordingClient.request["response_format"]["json_schema"]["schema"]  # type: ignore[index]
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])


def test_execution_is_blocked_by_policy(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    case_id = _case(amount=2000100)
    with SessionLocal() as db:
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        result = execute_recovery(db, case)
        assert result["action"] == "escalate"
        assert case.status == CaseStatus.HUMAN_REVIEW


def test_retry_timing_and_window_remain_blocked(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    for values in ({"retry_count": 4}, {"last_retry_at": datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=4)}, {"created_at": datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=8)}):
        case_id = _case(**values)
        with SessionLocal() as db:
            case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
            result = execute_recovery(db, case)["action"]
            assert result in ("escalate", "stopped")

def test_analyze_case_state_guard(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    for status in [CaseStatus.RECOVERING, CaseStatus.RECOVERED, CaseStatus.CLOSED]:
        case_id = _case(status=status)
        with SessionLocal() as db:
            case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
            result = analyze_case(db, case)
            assert "error" in result
            assert case.status == status # Assert state was not corrupted

def test_execute_recovery_mock_demo_link_allows_execution(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
    case_id = _case(status=CaseStatus.RECOVERING, recovery_probability=0.9)
    with SessionLocal() as db:
        from app.services.audit_service import log_audit_event
        log_audit_event(db, case_id, "payment_link_created", {"url": "mock_demo_link"})
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        # Mock RazorpayService to avoid real network call in test
        class DummyRazorpayService:
            def create_payment_link(self, data): return {"id": "plink_123", "short_url": "https://rzp.io/rzp/123"}
        monkeypatch.setattr("app.services.recovery_service.RazorpayService", lambda *args, **kwargs: DummyRazorpayService())

        result = execute_recovery(db, case)
        assert result["action"] == "payment_link"
        assert result["payment_link_url"] == "https://rzp.io/rzp/123"

def test_execute_recovery_real_link_recovering_returns_no_action(monkeypatch) -> None:
    case_id = _case(status=CaseStatus.RECOVERING)
    with SessionLocal() as db:
        from app.services.audit_service import log_audit_event
        log_audit_event(db, case_id, "payment_link_created", {"url": "https://rzp.io/rzp/real"})
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        result = execute_recovery(db, case)
        assert result["action"] == "no_action"
        assert result["payment_link_url"] is None

def test_execute_recovery_failed_allowed_executes(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
    case_id = _case(status=CaseStatus.FAILED, amount=1000, recovery_probability=0.9)
    with SessionLocal() as db:
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        class DummyRazorpayService:
            def create_payment_link(self, data): return {"id": "plink_123", "short_url": "https://rzp.io/rzp/123"}
        monkeypatch.setattr("app.services.recovery_service.RazorpayService", lambda *args, **kwargs: DummyRazorpayService())

        result = execute_recovery(db, case)
        assert result["action"] == "payment_link"

def test_execute_recovery_recovered_returns_no_action(monkeypatch) -> None:
    case_id = _case(status=CaseStatus.RECOVERED)
    with SessionLocal() as db:
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        result = execute_recovery(db, case)
        assert result["action"] == "no_action"
        assert result["payment_link_url"] is None
        assert "complete" in result["message"]

def test_execute_recovery_policy_blocked_returns_escalate(monkeypatch) -> None:
    case_id = _case(status=CaseStatus.FAILED, amount=2500000) # Policy limit is 2M
    with SessionLocal() as db:
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        result = execute_recovery(db, case)
        assert result["action"] == "escalate"

def test_execute_recovery_atomic_lock_prevents_duplicate(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
    case_id = _case(status=CaseStatus.FAILED, amount=1000, recovery_probability=0.9)
    with SessionLocal() as db:
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        db.expire_on_commit = False
        # Simulate that another thread already changed it in the DB while our in-memory `case` is still FAILED
        db.query(type(case)).filter(type(case).id == case_id).update({"status": CaseStatus.RECOVERING}, synchronize_session=False)
        db.commit()

        result = execute_recovery(db, case)
        assert result["action"] == "no_action"
        assert result["message"] == "Concurrent recovery blocked."

def test_execute_recovery_email_failure_does_not_rollback_link(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
    monkeypatch.setenv("EMAIL_ENABLED", "true")
    monkeypatch.setenv("EMAIL_PROVIDER_API_KEY", "invalid_key")
    __import__("app.core.config", fromlist=["get_settings"]).get_settings.cache_clear()

    case_id = _case(status=CaseStatus.FAILED, amount=1000, recovery_probability=0.9)
    with SessionLocal() as db:
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        class DummyRazorpayService:
            def create_payment_link(self, data): return {"id": "plink_123", "short_url": "https://rzp.io/rzp/123"}
        monkeypatch.setattr("app.services.recovery_service.RazorpayService", lambda *args, **kwargs: DummyRazorpayService())

        def mock_post(*args, **kwargs):
            raise __import__("httpx").RequestError("Connection failed")
        monkeypatch.setattr("httpx.post", mock_post)

        result = execute_recovery(db, case)
        assert result["action"] == "payment_link"
        assert result["payment_link_url"] == "https://rzp.io/rzp/123"
        assert case.status == CaseStatus.RECOVERING
        assert case.notification_status == "FAILED"
