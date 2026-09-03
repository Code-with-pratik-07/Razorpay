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
