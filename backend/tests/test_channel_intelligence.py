"""Tests for the Channel Intelligence Engine."""

import uuid
import pytest
from sqlalchemy.orm import Session

from app.db.database import SessionLocal, init_db
from app.models.customer import Customer
from app.models.payment_case import CaseStatus, PaymentCase
from app.models.communication_record import CommunicationRecord
from app.services.channel_service import (
    evaluate_channel_suitability,
    dispatch_channel_communication,
    get_case_channel_intelligence,
    HISTORICAL_ENGAGEMENT_WEIGHT,
    PREVIOUS_RECOVERY_SUCCESS_WEIGHT,
    CUSTOMER_PREFERENCE_WEIGHT,
    CHANNEL_AVAILABILITY_WEIGHT,
)


@pytest.fixture
def db_session():
    init_db()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_channel_scoring_weights():
    """Verify deterministic weight distribution equals 1.00."""
    total_weights = (
        HISTORICAL_ENGAGEMENT_WEIGHT
        + PREVIOUS_RECOVERY_SUCCESS_WEIGHT
        + CUSTOMER_PREFERENCE_WEIGHT
        + CHANNEL_AVAILABILITY_WEIGHT
    )
    assert pytest.approx(total_weights, 0.001) == 1.00
    assert HISTORICAL_ENGAGEMENT_WEIGHT == 0.40
    assert PREVIOUS_RECOVERY_SUCCESS_WEIGHT == 0.30
    assert CUSTOMER_PREFERENCE_WEIGHT == 0.20
    assert CHANNEL_AVAILABILITY_WEIGHT == 0.10


def test_best_channel_selection_for_upi(db_session: Session):
    """UPI payment method with mobile customer should recommend WhatsApp."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        email=f"customer_{uid}@example.com",
        phone=f"+9198765{uid[:5]}",
        successful_payments=3,
        failed_payments=1,
    )
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-UPI-{uid}",
        customer_id=customer.id,
        amount=150000,
        payment_method="upi",
        status=CaseStatus.FAILED,
    )
    db_session.add(case)
    db_session.commit()

    rec = evaluate_channel_suitability(case, customer)
    assert rec.recommended_channel == "whatsapp"
    assert rec.suitability_score >= 0.85
    assert "whatsapp" in rec.channel_scores
    assert rec.channel_scores["whatsapp"] > rec.channel_scores["email"]
    assert "sms" in rec.alternatives
    assert "email" in rec.alternatives
    assert "WhatsApp" in rec.reason


def test_channel_unavailable_if_missing_contact_info(db_session: Session):
    """If customer has no phone number, SMS and WhatsApp scores should be 0."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        email=f"onlyemail_{uid}@example.com",
        phone=None,
        successful_payments=2,
    )
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-NOPHONE-{uid}",
        customer_id=customer.id,
        amount=50000,
        payment_method="upi",
        status=CaseStatus.FAILED,
    )
    db_session.add(case)
    db_session.commit()

    rec = evaluate_channel_suitability(case, customer)
    assert rec.recommended_channel == "email"
    assert rec.channel_scores["sms"] == 0.0
    assert rec.channel_scores["whatsapp"] == 0.0
    assert rec.channel_scores["email"] > 0.0


def test_recovered_payment_protection(db_session: Session):
    """Terminal state protection: never contact customer if case is already RECOVERED or CLOSED."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"rec_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-REC-{uid}",
        customer_id=customer.id,
        amount=250000,
        status=CaseStatus.RECOVERED,
    )
    db_session.add(case)
    db_session.commit()

    intelligence = get_case_channel_intelligence(db_session, case)
    assert intelligence.status == "COMPLETED"
    assert "already complete" in intelligence.reason

    dispatch_res = dispatch_channel_communication(
        db_session, case, "https://rzp.io/test", automatic=True
    )
    assert dispatch_res["success"] is False
    assert dispatch_res["status"] == "COMPLETED"
    assert "No further communications permitted" in dispatch_res["message"]


def test_policy_blocked_communication(db_session: Session):
    """Policy safety gate: if policy check failed or human review, block automatic dispatch."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"blocked_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-BLOCKED-{uid}",
        customer_id=customer.id,
        amount=5000000,
        status=CaseStatus.HUMAN_REVIEW,
        policy_check_passed=False,
        policy_reason="Amount exceeds policy threshold",
    )
    db_session.add(case)
    db_session.commit()

    intelligence = get_case_channel_intelligence(db_session, case)
    assert intelligence.status == "POLICY_BLOCKED"
    assert "safety policy" in intelligence.reason

    dispatch_res = dispatch_channel_communication(
        db_session, case, "https://rzp.io/test", automatic=True
    )
    assert dispatch_res["success"] is False
    assert dispatch_res["status"] == "POLICY_BLOCKED"
    assert "Policy blocks automatic communication" in dispatch_res["message"]


def test_duplicate_communication_prevention(db_session: Session):
    """Never send duplicate communications for the same attempt in rapid succession."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"dup_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-DUP-{uid}",
        customer_id=customer.id,
        amount=75000,
        payment_method="upi",
        status=CaseStatus.FAILED,
        policy_check_passed=True,
        retry_count=1,
        max_retries=3,
    )
    db_session.add(case)
    db_session.commit()

    res1 = dispatch_channel_communication(db_session, case, "https://rzp.io/test1")
    assert res1["success"] is True

    res2 = dispatch_channel_communication(db_session, case, "https://rzp.io/test1")
    assert res2["status"] == "DUPLICATE_PREVENTED"


def test_attempt_limit_enforcement(db_session: Session):
    """Case that reached max attempts cannot receive further communication."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"exhaust_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-EXH-{uid}",
        customer_id=customer.id,
        amount=10000,
        status=CaseStatus.ABANDONED,
        retry_count=3,
        max_retries=3,
    )
    db_session.add(case)
    db_session.commit()

    intel = get_case_channel_intelligence(db_session, case)
    assert intel.status == "ATTEMPT_LIMIT_REACHED"


def test_next_best_channel_progression(db_session: Session):
    """If customer did not respond to initial channel, engagement is penalized and next-best channel is recommended."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"prog_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-PROG-{uid}",
        customer_id=customer.id,
        amount=120000,
        payment_method="upi",
        status=CaseStatus.RECOVERING,
        policy_check_passed=True,
    )
    db_session.add(case)
    db_session.commit()

    rec_1 = evaluate_channel_suitability(case, customer)
    assert rec_1.recommended_channel == "whatsapp"

    record_1 = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        suitability_score=rec_1.suitability_score,
        channel_scores=rec_1.channel_scores,
        reason=rec_1.reason,
        attempt_number=1,
        simulated=True,
    )
    db_session.add(record_1)
    db_session.commit()

    rec_2 = evaluate_channel_suitability(case, customer, case_records=[record_1])
    assert rec_2.channel_scores["whatsapp"] < rec_1.channel_scores["whatsapp"]
    assert rec_2.recommended_channel in {"sms", "email"}
    assert "Prior communication on WHATSAPP received no response" in rec_2.reason


def test_simulated_channel_for_demo(db_session: Session):
    """WhatsApp and SMS should show 'SIMULATED' for demo without real API calls."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"sim_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-SIM-{uid}",
        customer_id=customer.id,
        amount=200000,
        payment_method="upi",
        status=CaseStatus.FAILED,
        policy_check_passed=True,
    )
    db_session.add(case)
    db_session.commit()

    result = dispatch_channel_communication(db_session, case, "https://rzp.io/demo-link")
    assert result["success"] is True
    assert result["channel"] == "whatsapp"
    assert result["status"] == "SIMULATED"
    assert result["simulated"] is True
    assert case.notification_status == "WHATSAPP_SIMULATED"
