from datetime import datetime, timedelta

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
    case_id = _case(amount=500100)
    with SessionLocal() as db:
        case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
        result = execute_recovery(db, case)
        assert result["action"] == "escalate"
        assert case.status == CaseStatus.HUMAN_REVIEW


def test_retry_timing_and_window_remain_blocked(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    for values in ({"retry_count": 3}, {"last_retry_at": datetime.utcnow() - timedelta(hours=4)}, {"created_at": datetime.utcnow() - timedelta(days=8)}):
        case_id = _case(**values)
        with SessionLocal() as db:
            case = db.get(__import__("app.models.payment_case", fromlist=["PaymentCase"]).PaymentCase, case_id)
            assert execute_recovery(db, case)["action"] == "escalate"
