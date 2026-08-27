from _pytest import assertion
from app.models.customer import Customer
import json
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import create_test_webhook_signature
from app.db.database import SessionLocal, init_db
from app.main import app
from app.models.audit_event import AuditEvent
from app.models.payment_case import CaseStatus, PaymentCase
from app.models.customer import Customer
from app.models.webhook_log import WebhookLog

SECRET = "local-webhook-secret-for-tests"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("RAZORPAY_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("GROQ_API_KEY", "")
    get_settings.cache_clear()
    init_db()
    with TestClient(app) as test_client:
        yield test_client
    get_settings.cache_clear()


def _payment(payment_id: str, order_id: str, status: str = "failed") -> dict:
    return {
        "event": f"payment.{status}",
        "payload": {"payment": {"entity": {
            "id": payment_id, "order_id": order_id, "amount": 499900,
            "currency": "INR", "status": status, "method": "upi",
            "email": "webhook-test@example.com", "contact": "+919999999999",
            "error_reason": "network_timeout",
        }}},
    }


def _post(client: TestClient, payload: dict | bytes, event_id: str | None = None, *, signature: str | None = None):
    raw = payload if isinstance(payload, bytes) else json.dumps(payload, separators=(",", ":")).encode()
    headers = {"x-razorpay-signature": signature or create_test_webhook_signature(raw, SECRET)}
    if event_id is not None:
        headers["x-razorpay-event-id"] = event_id
    return client.post("/webhooks/razorpay", content=raw, headers=headers)


def test_valid_signature_and_payment_failed_create_case_and_audit(client: TestClient) -> None:
    suffix = uuid.uuid4().hex[:8]
    response = _post(client, _payment(f"pay_{suffix}", f"order_{suffix}"), f"evt_{suffix}")
    assert response.status_code == 200
    with SessionLocal() as db:
        case = db.scalar(select(PaymentCase).where(PaymentCase.razorpay_payment_id == f"pay_{suffix}"))
        events = list(db.scalars(select(AuditEvent).where(AuditEvent.case_id == case.id)))
        log = db.scalar(select(WebhookLog).where(WebhookLog.event_id == f"evt_{suffix}"))
    assert case is not None and case.status == CaseStatus.FAILED

    customer = db.get(Customer, case.customer_id)

    assert customer is not None
    assert customer.failed_payments >= 1
    assert {"failure_detected", "case_created", "ml_prediction", "policy_check", "ai_analysis", "ai_unavailable"}.issubset(
        {event.event_type for event in events})

    assert log.processed


def test_invalid_missing_and_raw_body_signature_are_rejected(client: TestClient) -> None:
    payload = _payment("pay_invalid", "order_invalid")
    invalid = _post(client, payload, "evt_invalid", signature="not-a-valid-signature")
    assert invalid.status_code == 400
    raw = json.dumps(payload, indent=2).encode()
    compact_signature = create_test_webhook_signature(json.dumps(payload, separators=(",", ":")).encode(), SECRET)
    raw_body_mismatch = _post(client, raw, "evt_raw", signature=compact_signature)
    assert raw_body_mismatch.status_code == 400
    missing = client.post("/webhooks/razorpay", content=b"{}", headers={})
    assert missing.status_code == 400


def test_duplicate_event_id_is_idempotent(client: TestClient) -> None:
    suffix = uuid.uuid4().hex[:8]
    payload = _payment(f"pay_{suffix}", f"order_{suffix}")
    event_id = f"evt_{suffix}"
    assert _post(client, payload, event_id).status_code == 200
    duplicate = _post(client, payload, event_id)
    assert duplicate.status_code == 200
    assert duplicate.json() == {"status": "duplicate_ignored"}
    with SessionLocal() as db:
        assert len(list(db.scalars(select(WebhookLog).where(WebhookLog.event_id == event_id)))) == 1
        assert len(list(db.scalars(select(PaymentCase).where(PaymentCase.razorpay_payment_id == f"pay_{suffix}")))) == 1


def test_captured_and_order_paid_recover_associated_case(client: TestClient) -> None:
    first = uuid.uuid4().hex[:8]
    assert _post(client, _payment(f"pay_{first}", f"order_{first}"), f"evt_fail_{first}").status_code == 200
    assert _post(client, _payment(f"pay_{first}", f"order_{first}", "captured"), f"evt_capture_{first}").status_code == 200
    second = uuid.uuid4().hex[:8]
    assert _post(client, _payment(f"pay_{second}", f"order_{second}"), f"evt_fail_{second}").status_code == 200
    order_paid = {
        "event": "order.paid",
        "payload": {"order": {"entity": {"id": f"order_{second}", "status": "paid"}}, "payment": {"entity": {"id": f"pay_{second}", "order_id": f"order_{second}"}}},
    }
    assert _post(client, order_paid, f"evt_paid_{second}").status_code == 200
    with SessionLocal() as db:
        cases = list(db.scalars(select(PaymentCase).where(PaymentCase.razorpay_order_id.in_([f"order_{first}", f"order_{second}"]))))
        assert all(case.status == CaseStatus.RECOVERED and case.recovered_at is not None for case in cases)


def test_unsupported_and_malformed_payload_are_safe(client: TestClient) -> None:
    suffix = uuid.uuid4().hex[:8]
    unsupported = _post(client, {"event": "refund.failed", "payload": {}}, f"evt_unknown_{suffix}")
    assert unsupported.status_code == 200
    with SessionLocal() as db:
        log = db.scalar(select(WebhookLog).where(WebhookLog.event_id == f"evt_unknown_{suffix}"))
    assert log.processed and log.error_message == "Unsupported event ignored."
    malformed = _post(client, b"not json", f"evt_malformed_{suffix}")
    assert malformed.status_code == 400
