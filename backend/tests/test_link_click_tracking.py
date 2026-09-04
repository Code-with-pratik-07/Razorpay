"""Tests for Payment Link Click Tracking and Data Independence."""

import uuid
from datetime import datetime, timezone, timedelta
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.config import get_settings
from app.db.database import SessionLocal, init_db
from app.models.customer import Customer
from app.models.payment_case import CaseStatus, PaymentCase
from app.models.communication_record import CommunicationRecord
from app.models.audit_event import AuditEvent
from app.services.recovery_service import record_payment_attempt

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    get_settings().demo_mode = True
    yield
    get_settings().demo_mode = False


def create_test_case(db, status=CaseStatus.RECOVERING, retry_count=1, max_retries=3):
    customer = Customer(
        email=f"customer_{uuid.uuid4().hex[:6]}@example.com",
        phone="+919876543210",
        razorpay_customer_id=f"cust_{uuid.uuid4().hex[:6]}",
        successful_payments=1,
        failed_payments=0,
        lifetime_value=5000,
    )
    db.add(customer)
    db.flush()

    case = PaymentCase(
        case_number=f"CLK-{uuid.uuid4().hex[:6].upper()}",
        customer_id=customer.id,
        amount=1500,
        currency="INR",
        status=status,
        failure_reason="network_timeout",
        payment_method="card",
        retry_count=retry_count,
        max_retries=max_retries,
        selected_channel="whatsapp",
        payment_link_expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=5),
    )
    db.add(case)
    db.flush()

    comm = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        suitability_score=0.9,
        channel_scores={"whatsapp": 0.9, "sms": 0.7, "email": 0.5},
        reason="Verified WhatsApp delivery",
        attempt_number=retry_count,
        simulated=True,
        outcome="AWAITING_RESPONSE",
        delivery_status="DELIVERED",
        recipient="+919876543210",
        message_snippet="WhatsApp reminder delivered — Awaiting customer response",
    )
    db.add(comm)
    db.commit()
    db.refresh(case)
    db.refresh(comm)
    return case, comm


def test_track_payment_link_click_success():
    with SessionLocal() as db:
        case, comm = create_test_case(db, status=CaseStatus.RECOVERING, retry_count=2, max_retries=3)
        case_id = case.id
        initial_retries = case.retry_count

    # 1. Trigger link click endpoint
    response = client.post(f"/api/cases/{case_id}/track-click")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["outcome"] == "LINK_CLICKED"

    # 2. Verify DB state
    with SessionLocal() as db:
        c = db.get(PaymentCase, case_id)
        # Data Independence: retry_count MUST NOT increment on link click
        assert c.retry_count == initial_retries
        # Must not mark case as RECOVERED
        assert c.status == CaseStatus.RECOVERING

        # CommunicationRecord must be updated to LINK_CLICKED
        records = db.query(CommunicationRecord).filter(CommunicationRecord.case_id == case_id).all()
        assert len(records) == 1
        assert records[0].outcome == "LINK_CLICKED"
        assert "Payment link clicked" in (records[0].message_snippet or "")

        # Audit event payment_link_clicked exists
        click_events = (
            db.query(AuditEvent)
            .filter(AuditEvent.case_id == case_id, AuditEvent.event_type == "payment_link_clicked")
            .all()
        )
        assert len(click_events) == 1
        assert click_events[0].event_data["channel"] == "whatsapp"
        assert click_events[0].event_data["attempt_number"] == 2

    # 3. Verify Follow-Up Decision via explanation endpoint
    exp_res = client.get(f"/api/cases/{case_id}/explanation")
    assert exp_res.status_code == 200
    exp_data = exp_res.json()
    followup = exp_data["channel_intelligence"]["followup_decision"]
    assert followup["previous_outcome"] == "LINK_CLICKED"
    assert followup["next_action"] == "RETRY_SAME_CHANNEL"


def test_track_payment_link_click_idempotency():
    with SessionLocal() as db:
        case, comm = create_test_case(db, status=CaseStatus.RECOVERING, retry_count=1, max_retries=3)
        case_id = case.id

    # Click 1
    res1 = client.post(f"/api/cases/{case_id}/track-click")
    assert res1.status_code == 200
    assert res1.json()["success"] is True

    # Click 2 (Immediate duplicate)
    res2 = client.post(f"/api/cases/{case_id}/track-click")
    assert res2.status_code == 200
    assert res2.json()["success"] is True

    # Click 3 (Repeated click)
    res3 = client.post(f"/api/cases/{case_id}/track-click")
    assert res3.status_code == 200
    assert res3.json()["success"] is True

    with SessionLocal() as db:
        # Audit event should NOT be spammed infinitely
        click_events = (
            db.query(AuditEvent)
            .filter(AuditEvent.case_id == case_id, AuditEvent.event_type == "payment_link_clicked")
            .all()
        )
        assert len(click_events) == 1
        c = db.get(PaymentCase, case_id)
        assert c.retry_count == 1


def test_link_click_followed_by_failed_payment():
    with SessionLocal() as db:
        case, comm = create_test_case(db, status=CaseStatus.RECOVERING, retry_count=2, max_retries=3)
        case_id = case.id
        initial_retries = case.retry_count

    # 1. Customer opens payment link
    res_click = client.post(f"/api/cases/{case_id}/track-click")
    assert res_click.status_code == 200

    # 2. Customer attempts UPI payment, which fails
    res_pay = client.post(
        f"/api/demo/simulate-payment/{case_id}",
        json={"success": False, "payment_method": "upi", "failure_reason": "Bank UPI server timeout"},
    )
    assert res_pay.status_code == 200

    with SessionLocal() as db:
        c = db.get(PaymentCase, case_id)
        # Data Independence: Communication attempts MUST NOT be consumed by failed payment
        assert c.retry_count == initial_retries
        # Case status remains RECOVERING
        assert c.status == CaseStatus.RECOVERING
        assert c.last_payment_method == "upi"
        assert c.last_payment_status == "FAILED"

        # Communication record outcome preserves LINK_CLICKED
        records = db.query(CommunicationRecord).filter(CommunicationRecord.case_id == case_id).all()
        assert len(records) == 1
        assert records[0].outcome == "LINK_CLICKED"


def test_link_click_followed_by_successful_payment():
    with SessionLocal() as db:
        case, comm = create_test_case(db, status=CaseStatus.RECOVERING, retry_count=1, max_retries=3)
        case_id = case.id

    # 1. Customer opens link
    client.post(f"/api/cases/{case_id}/track-click")

    # 2. Customer completes payment successfully
    res_pay = client.post(
        f"/api/demo/simulate-payment/{case_id}",
        json={"success": True, "payment_method": "netbanking"},
    )
    assert res_pay.status_code == 200

    with SessionLocal() as db:
        c = db.get(PaymentCase, case_id)
        assert c.status == CaseStatus.RECOVERED
        assert c.recovered_at is not None

        # Communication record has recovery_attributed = True
        rec = db.query(CommunicationRecord).filter(CommunicationRecord.case_id == case_id).first()
        assert rec.recovery_attributed is True

    # 3. Subsequent link click on RECOVERED case must be rejected / no mutation
    res_terminal = client.post(f"/api/cases/{case_id}/track-click")
    assert res_terminal.status_code == 200
    assert res_terminal.json()["success"] is False
    assert "terminal" in res_terminal.json()["message"].lower()


def test_track_click_terminal_cases_rejected():
    with SessionLocal() as db:
        case_abandoned, _ = create_test_case(db, status=CaseStatus.ABANDONED, retry_count=3, max_retries=3)
        abandoned_id = case_abandoned.id

    res = client.post(f"/api/cases/{abandoned_id}/track-click")
    assert res.status_code == 200
    assert res.json()["success"] is False
    assert "terminal" in res.json()["message"].lower()
