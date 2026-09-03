"""Tests for Recovery Follow-up Intelligence and turn-by-turn progression."""

import pytest
from app.db.database import SessionLocal, init_db
from app.models.payment_case import PaymentCase, CaseStatus
from app.models.customer import Customer
from app.models.communication_record import CommunicationRecord
from app.services.channel_service import evaluate_followup_decision


@pytest.fixture
def db_session():
    init_db()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_followup_decision_link_clicked():
    case = PaymentCase(amount=50000, status=CaseStatus.RECOVERING, retry_count=1, max_retries=3)
    rec = CommunicationRecord(channel="whatsapp", outcome="LINK_CLICKED", attempt_number=1)
    followup = evaluate_followup_decision(case, [rec], None, "whatsapp", ["sms", "email"])
    assert followup.previous_outcome == "LINK_CLICKED"
    assert followup.recommended_wait_period == "24 hours"
    assert followup.next_action == "RETRY_SAME_CHANNEL"
    assert "effective" in followup.reason and "remains" in followup.reason


def test_followup_decision_no_engagement():
    case = PaymentCase(amount=50000, status=CaseStatus.RECOVERING, retry_count=1, max_retries=3)
    rec = CommunicationRecord(channel="whatsapp", outcome="NO_ENGAGEMENT", attempt_number=1)
    followup = evaluate_followup_decision(case, [rec], None, "whatsapp", ["sms", "email"])
    assert followup.previous_outcome == "NO_ENGAGEMENT"
    assert followup.recommended_wait_period == "24 hours"
    assert followup.next_action == "SWITCH_CHANNEL"
    assert followup.selected_channel == "sms"
    assert "suitability was reduced" in followup.reason


def test_followup_decision_failed_delivery():
    case = PaymentCase(amount=50000, status=CaseStatus.RECOVERING, retry_count=1, max_retries=3)
    rec = CommunicationRecord(channel="sms", outcome="FAILED_DELIVERY", attempt_number=1)
    followup = evaluate_followup_decision(case, [rec], None, "sms", ["whatsapp", "email"])
    assert followup.previous_outcome == "FAILED_DELIVERY"
    assert followup.recommended_wait_period == "Immediate"
    assert followup.next_action == "SWITCH_CHANNEL"
    assert followup.selected_channel == "whatsapp"
    assert "Delivery failed" in followup.reason


def test_followup_decision_terminal_recovered():
    case = PaymentCase(amount=50000, status=CaseStatus.RECOVERED, retry_count=1, max_retries=3)
    rec = CommunicationRecord(channel="sms", outcome="PAYMENT_COMPLETED", attempt_number=1, recovery_attributed=True)
    followup = evaluate_followup_decision(case, [rec], None, "sms", ["whatsapp", "email"])
    assert followup.previous_outcome == "PAYMENT_COMPLETED"
    assert followup.next_action == "STOP_RECOVERY"


def test_followup_decision_attempt_limit_reached():
    case = PaymentCase(amount=50000, status=CaseStatus.ABANDONED, retry_count=3, max_retries=3)
    rec = CommunicationRecord(channel="email", outcome="NO_ENGAGEMENT", attempt_number=3)
    followup = evaluate_followup_decision(case, [rec], None, "email", ["sms", "whatsapp"])
    assert followup.next_action == "STOP_RECOVERY"
    assert "maximum number of recovery attempts has been reached" in followup.reason


# ---------------------------------------------------------------------------
# API Endpoint End-to-End Tests for POST /api/cases/{case_id}/next-step
# ---------------------------------------------------------------------------
import uuid
from fastapi.testclient import TestClient
from app.main import app
from app.models.payment_case import RecoveryAction


def test_next_step_no_engagement_switches_to_sms_attempt_2(db_session):
    """1. NO_ENGAGEMENT → next-step switches to SMS Attempt 2."""
    client = TestClient(app)
    uid = uuid.uuid4().hex[:8]
    cust = Customer(
        email=f"no_eng_{uid}@example.com",
        phone=f"+9198{uid[:8]}",
        lifetime_value=10000,
        successful_payments=1,
        failed_payments=1,
    )
    db_session.add(cust)
    db_session.commit()

    case = PaymentCase(
        customer_id=cust.id,
        case_number=f"TEST-NOENG-{uid}",
        amount=250000,
        currency="INR",
        status=CaseStatus.RECOVERING,
        recovery_action=RecoveryAction.PAYMENT_LINK,
        retry_count=1,
        max_retries=3,
        policy_check_passed=True,
        selected_channel="whatsapp",
    )
    db_session.add(case)
    db_session.commit()

    rec1 = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        attempt_number=1,
        outcome="NO_ENGAGEMENT",
        recipient=cust.phone,
        message_snippet="WhatsApp link delivered - No customer engagement",
    )
    db_session.add(rec1)
    db_session.commit()

    res = client.post(f"/api/cases/{case.id}/next-step")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["action"] == "channel_switched"
    assert data["channel"] == "sms"
    assert data["attempt"] == 2

    # Verify database state
    db_session.refresh(case)
    assert case.retry_count == 2
    assert case.selected_channel == "sms"
    records = db_session.query(CommunicationRecord).filter_by(case_id=case.id).order_by(CommunicationRecord.attempt_number).all()
    assert len(records) == 2
    assert records[1].channel == "sms"
    assert records[1].attempt_number == 2
    assert records[1].outcome == "AWAITING_RESPONSE"


def test_next_step_link_clicked_creates_same_channel_reminder(db_session):
    """2. LINK_CLICKED → next-step creates same-channel reminder Attempt 2."""
    client = TestClient(app)
    uid = uuid.uuid4().hex[:8]
    cust = Customer(
        email=f"clicked_{uid}@example.com",
        phone=f"+9198{uid[:8]}",
        lifetime_value=20000,
        successful_payments=2,
        failed_payments=1,
    )
    db_session.add(cust)
    db_session.commit()

    case = PaymentCase(
        customer_id=cust.id,
        case_number=f"TEST-CLICK-{uid}",
        amount=500000,
        currency="INR",
        status=CaseStatus.RECOVERING,
        recovery_action=RecoveryAction.PAYMENT_LINK,
        retry_count=1,
        max_retries=3,
        policy_check_passed=True,
        selected_channel="whatsapp",
    )
    db_session.add(case)
    db_session.commit()

    rec1 = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        attempt_number=1,
        outcome="LINK_CLICKED",
        recipient=cust.phone,
        message_snippet="WhatsApp link delivered - Clicked",
    )
    db_session.add(rec1)
    db_session.commit()

    res = client.post(f"/api/cases/{case.id}/next-step")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["action"] == "reminder_dispatched"
    assert data["channel"] == "whatsapp"
    assert data["attempt"] == 2

    # Verify database state
    db_session.refresh(case)
    assert case.retry_count == 2
    records = db_session.query(CommunicationRecord).filter_by(case_id=case.id).order_by(CommunicationRecord.attempt_number).all()
    assert len(records) == 2
    assert records[1].channel == "whatsapp"
    assert records[1].attempt_number == 2
    assert records[1].outcome == "AWAITING_RESPONSE"


def test_next_step_awaiting_response_prevents_duplicate_attempt(db_session):
    """3. AWAITING_RESPONSE → repeated click returns no_action and creates no duplicate attempt."""
    client = TestClient(app)
    uid = uuid.uuid4().hex[:8]
    cust = Customer(
        email=f"awaiting_{uid}@example.com",
        phone=f"+9198{uid[:8]}",
        lifetime_value=15000,
    )
    db_session.add(cust)
    db_session.commit()

    case = PaymentCase(
        customer_id=cust.id,
        case_number=f"TEST-AWAIT-{uid}",
        amount=100000,
        currency="INR",
        status=CaseStatus.RECOVERING,
        recovery_action=RecoveryAction.PAYMENT_LINK,
        retry_count=2,
        max_retries=3,
        policy_check_passed=True,
        selected_channel="whatsapp",
    )
    db_session.add(case)
    db_session.commit()

    rec1 = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        attempt_number=1,
        outcome="LINK_CLICKED",
        recipient=cust.phone,
    )
    rec2 = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        attempt_number=2,
        outcome="AWAITING_RESPONSE",
        recipient=cust.phone,
    )
    db_session.add_all([rec1, rec2])
    db_session.commit()

    res = client.post(f"/api/cases/{case.id}/next-step")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "no_action"
    assert "already been executed" in data["reason"]

    # Verify retry_count and communication records remain unchanged
    db_session.refresh(case)
    assert case.retry_count == 2
    records = db_session.query(CommunicationRecord).filter_by(case_id=case.id).all()
    assert len(records) == 2


def test_next_step_recovered_blocked(db_session):
    """4. RECOVERED case → action is blocked."""
    client = TestClient(app)
    uid = uuid.uuid4().hex[:8]
    cust = Customer(email=f"rec_{uid}@example.com", phone=f"+9198{uid[:8]}")
    db_session.add(cust)
    db_session.commit()

    case = PaymentCase(
        customer_id=cust.id,
        case_number=f"TEST-REC-{uid}",
        amount=100000,
        currency="INR",
        status=CaseStatus.RECOVERED,
        recovery_action=RecoveryAction.PAYMENT_LINK,
        retry_count=1,
        max_retries=3,
    )
    db_session.add(case)
    db_session.commit()

    res = client.post(f"/api/cases/{case.id}/next-step")
    assert res.status_code == 400
    assert "terminal case" in res.json()["detail"].lower()


def test_next_step_abandoned_blocked(db_session):
    """5. ABANDONED case → action is blocked."""
    client = TestClient(app)
    uid = uuid.uuid4().hex[:8]
    cust = Customer(email=f"abn_{uid}@example.com", phone=f"+9198{uid[:8]}")
    db_session.add(cust)
    db_session.commit()

    case = PaymentCase(
        customer_id=cust.id,
        case_number=f"TEST-ABN-{uid}",
        amount=100000,
        currency="INR",
        status=CaseStatus.ABANDONED,
        recovery_action=RecoveryAction.NONE,
        retry_count=3,
        max_retries=3,
    )
    db_session.add(case)
    db_session.commit()

    res = client.post(f"/api/cases/{case.id}/next-step")
    assert res.status_code == 400
    assert "terminal case" in res.json()["detail"].lower()


def test_attempt_counter_only_increments_for_new_outbound(db_session):
    """6. Attempt counter increases ONLY when a new outbound communication is created."""
    client = TestClient(app)
    uid = uuid.uuid4().hex[:8]
    cust = Customer(email=f"cnt_{uid}@example.com", phone=f"+9198{uid[:8]}")
    db_session.add(cust)
    db_session.commit()

    case = PaymentCase(
        customer_id=cust.id,
        case_number=f"TEST-CNT-{uid}",
        amount=100000,
        currency="INR",
        status=CaseStatus.RECOVERING,
        recovery_action=RecoveryAction.PAYMENT_LINK,
        retry_count=1,
        max_retries=3,
        policy_check_passed=True,
    )
    db_session.add(case)
    db_session.commit()

    rec1 = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        attempt_number=1,
        outcome="DELIVERED",
        recipient=cust.phone,
    )
    db_session.add(rec1)
    db_session.commit()

    # Communication events (e.g. delivered, clicked) do NOT increment attempts
    db_session.refresh(case)
    assert case.retry_count == 1

    rec1.outcome = "LINK_CLICKED"
    db_session.commit()
    db_session.refresh(case)
    assert case.retry_count == 1

    # Only executing next recovery step increases attempt count to 2
    res = client.post(f"/api/cases/{case.id}/next-step")
    assert res.status_code == 200
    db_session.refresh(case)
    assert case.retry_count == 2
