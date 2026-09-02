"""Tests for the Enterprise Channel Intelligence Engine."""

import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.database import SessionLocal, init_db
from app.models.customer import Customer
from app.models.payment_case import CaseStatus, PaymentCase
from app.models.communication_record import CommunicationRecord
from app.services.channel_service import (
    evaluate_channel_suitability,
    dispatch_channel_communication,
    get_case_channel_intelligence,
    attribute_recovery_to_communication,
    WEIGHT_COMM_HISTORY,
    WEIGHT_RECOVERY_SUCCESS,
    WEIGHT_PREFERENCE,
    WEIGHT_AVAILABILITY,
    WEIGHT_RECOVERY_CONTEXT,
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
    """Verify 5-factor weight distribution equals 1.00."""
    total_weights = (
        WEIGHT_COMM_HISTORY
        + WEIGHT_RECOVERY_SUCCESS
        + WEIGHT_PREFERENCE
        + WEIGHT_AVAILABILITY
        + WEIGHT_RECOVERY_CONTEXT
    )
    assert pytest.approx(total_weights, 0.001) == 1.00
    assert WEIGHT_COMM_HISTORY == 0.30
    assert WEIGHT_RECOVERY_SUCCESS == 0.25
    assert WEIGHT_PREFERENCE == 0.15
    assert WEIGHT_AVAILABILITY == 0.15
    assert WEIGHT_RECOVERY_CONTEXT == 0.15


def test_cold_start_customer_evaluation(db_session: Session):
    """New customer with 0 prior interactions should classify as COLD_START with baseline strategy."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        email=f"newbie_{uid}@example.com",
        phone=f"+9198765{uid[:5]}",
        successful_payments=0,
        failed_payments=0,
    )
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-COLD-{uid}",
        customer_id=customer.id,
        amount=150000,
        payment_method="upi",
        status=CaseStatus.FAILED,
    )
    db_session.add(case)
    db_session.commit()

    intel = evaluate_channel_suitability(case, customer)
    assert intel.communication_maturity == "COLD_START"
    assert intel.confidence == "low"
    assert intel.confidence_score == 0.55
    assert intel.recommended_channel == "whatsapp"
    assert intel.suitability_score == 0.55
    assert intel.channel_scores["whatsapp"] == 0.55
    assert intel.channel_scores["sms"] == 0.50
    assert "This is a new customer with no previous communication history" in intel.reason
    assert "WhatsApp is recommended" in intel.reason
    assert any(item.factor == "customer_stage" for item in intel.decision_basis)
    assert any(df.name == "Contact Availability" and df.status == "Available" for df in intel.decision_factors)


def test_learning_customer_maturity(db_session: Session):
    """Customer with 1 or 2 interactions should classify as LEARNING."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        email=f"learner_{uid}@example.com",
        phone=f"+9198765{uid[:5]}",
    )
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-LEARN-{uid}",
        customer_id=customer.id,
        amount=100000,
        payment_method="card",
        status=CaseStatus.FAILED,
    )
    db_session.add(case)
    db_session.commit()

    record_1 = CommunicationRecord(
        case_id=case.id,
        channel="email",
        status="SENT",
        outcome="CLICKED",
        suitability_score=0.65,
        reason="Initial email",
        attempt_number=1,
    )
    db_session.add(record_1)
    db_session.commit()

    intel = evaluate_channel_suitability(case, customer, all_customer_records=[record_1])
    assert intel.communication_maturity == "LEARNING"
    assert intel.confidence == "medium"
    assert "Building communication preferences" in intel.maturity_description


def test_established_customer_maturity(db_session: Session):
    """Customer with 3+ interactions should classify as ESTABLISHED with high confidence."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        email=f"established_{uid}@example.com",
        phone=f"+9198765{uid[:5]}",
    )
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-EST-{uid}",
        customer_id=customer.id,
        amount=200000,
        payment_method="upi",
        status=CaseStatus.FAILED,
    )
    db_session.add(case)
    db_session.commit()

    records = [
        CommunicationRecord(case_id=case.id, channel="sms", status="SENT", outcome="PAYMENT_COMPLETED", recovery_attributed=True, attempt_number=1, reason="Test 1"),
        CommunicationRecord(case_id=case.id, channel="sms", status="SENT", outcome="PAYMENT_COMPLETED", recovery_attributed=True, attempt_number=2, reason="Test 2"),
        CommunicationRecord(case_id=case.id, channel="whatsapp", status="SENT", outcome="IGNORED", attempt_number=3, reason="Test 3"),
    ]
    db_session.add_all(records)
    db_session.commit()

    intel = evaluate_channel_suitability(case, customer, all_customer_records=records)
    assert intel.communication_maturity == "ESTABLISHED"
    assert intel.confidence == "high"
    assert intel.confidence_score == 0.85
    assert "Personalized based on 3 previous interactions" in intel.maturity_description


def test_customer_opt_out_enforcement(db_session: Session):
    """Customer who opted out of SMS should have SMS suitability 0.0 and status Opted Out."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        email=f"optout_{uid}@example.com",
        phone=f"+9198765{uid[:5]}",
        opted_out_channels="sms",
    )
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-OPT-{uid}",
        customer_id=customer.id,
        amount=50000,
        payment_method="upi",
        status=CaseStatus.FAILED,
    )
    db_session.add(case)
    db_session.commit()

    intel = evaluate_channel_suitability(case, customer)
    assert intel.channel_scores["sms"] == 0.0
    assert "sms" in intel.opted_out_channels

    # Dispatch to opted-out channel directly should be rejected
    dispatch_res = dispatch_channel_communication(
        db_session, case, "https://rzp.io/test", override_channel="sms"
    )
    assert dispatch_res["success"] is False
    assert dispatch_res["status"] == "OPTED_OUT"


def test_next_best_channel_escalation(db_session: Session):
    """If previous WhatsApp attempt was unheeded, engine deprioritizes WhatsApp and selects next-best channel."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        email=f"escalate_{uid}@example.com",
        phone=f"+9198765{uid[:5]}",
    )
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-ESC-{uid}",
        customer_id=customer.id,
        amount=150000,
        payment_method="upi",
        status=CaseStatus.RECOVERING,
    )
    db_session.add(case)
    db_session.commit()

    record_wa_ignored = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        outcome="IGNORED",
        delivery_status="DELIVERED",
        suitability_score=0.85,
        reason="WhatsApp attempt 1",
        attempt_number=1,
    )
    db_session.add(record_wa_ignored)
    db_session.commit()

    intel = evaluate_channel_suitability(
        case,
        customer,
        case_records=[record_wa_ignored],
        all_customer_records=[record_wa_ignored],
    )
    assert intel.recommended_channel in {"sms", "email"}
    assert intel.channel_scores["whatsapp"] < 0.60
    assert "previous WHATSAPP notification was delivered but received no engagement" in intel.reason
    assert any(b.factor == "previous_channel_attempt" for b in intel.decision_basis)


def test_payment_recovery_attribution(db_session: Session):
    """When a payment succeeds, the latest active communication record receives attribution."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(
        email=f"attrib_{uid}@example.com",
        phone=f"+9198765{uid[:5]}",
    )
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-ATTR-{uid}",
        customer_id=customer.id,
        amount=250000,
        status=CaseStatus.RECOVERING,
    )
    db_session.add(case)
    db_session.commit()

    comm_record = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        outcome="DELIVERED",
        delivery_status="DELIVERED",
        suitability_score=0.90,
        reason="WhatsApp reminder",
        attempt_number=1,
    )
    db_session.add(comm_record)
    db_session.commit()

    attributed = attribute_recovery_to_communication(db_session, case)
    assert attributed is not None
    assert attributed.id == comm_record.id
    assert attributed.recovery_attributed is True
    assert attributed.outcome == "PAYMENT_COMPLETED"

    # Next evaluation should reflect attributed channel
    intel = get_case_channel_intelligence(db_session, case)
    assert intel.attributed_channel == "whatsapp"


def test_safety_gates_and_policy_block(db_session: Session):
    """Policy-blocked case calculates recommendation but blocks automatic dispatch."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"safe_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-SAFE-{uid}",
        customer_id=customer.id,
        amount=5000000,
        status=CaseStatus.HUMAN_REVIEW,
        policy_check_passed=False,
        policy_reason="Policy limit exceeded",
    )
    db_session.add(case)
    db_session.commit()

    intel = get_case_channel_intelligence(db_session, case)
    assert intel.status == "POLICY_BLOCKED"
    assert "manual review before dispatching recovery communication" in intel.reason

    dispatch_res = dispatch_channel_communication(
        db_session, case, "https://rzp.io/test", automatic=True
    )
    assert dispatch_res["success"] is False
    assert dispatch_res["status"] == "POLICY_BLOCKED"


def test_recovered_case_protection(db_session: Session):
    """Cases in terminal state (RECOVERED) must never receive communication."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"term_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-TERM-{uid}",
        customer_id=customer.id,
        amount=100000,
        status=CaseStatus.RECOVERED,
    )
    db_session.add(case)
    db_session.commit()

    intel = get_case_channel_intelligence(db_session, case)
    assert intel.status == "COMPLETED"

    dispatch_res = dispatch_channel_communication(
        db_session, case, "https://rzp.io/test", automatic=True
    )
    assert dispatch_res["success"] is False
    assert dispatch_res["status"] == "COMPLETED"


def test_active_payment_link_in_dispatch(db_session: Session):
    """Dispatching SMS and WhatsApp must record the active payment link URL."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"link_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-LINK-{uid}",
        customer_id=customer.id,
        amount=150000,
        status=CaseStatus.RECOVERING,
        policy_check_passed=True,
    )
    db_session.add(case)
    db_session.commit()

    active_url = "https://rzp.io/i/test_active_link"
    res = dispatch_channel_communication(db_session, case, active_url, automatic=True)
    assert res["success"] is True
    assert res["payment_link_url"] == active_url
    assert res["status"] in ("SIMULATED", "SENT")
    assert case.notification_status in ("WHATSAPP_SIMULATED", "SMS_SIMULATED", "SENT")

    # Verify audit event and communication record contain the active URL
    records = list(db_session.scalars(select(CommunicationRecord).where(CommunicationRecord.case_id == case.id)))
    assert len(records) == 1
    assert active_url in records[0].message_snippet


def test_channel_escalation_and_deprioritization(db_session: Session):
    """Unheeded WhatsApp attempt must cause channel deprioritization and escalate to SMS."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"esc_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-ESC-{uid}",
        customer_id=customer.id,
        amount=250000,
        status=CaseStatus.RECOVERING,
        policy_check_passed=True,
        retry_count=1,
        max_retries=3,
    )
    db_session.add(case)
    db_session.commit()

    # Attempt 1 on WhatsApp was ignored
    rec_1 = CommunicationRecord(
        case_id=case.id,
        channel="whatsapp",
        status="SIMULATED",
        outcome="IGNORED",
        delivery_status="DELIVERED",
        suitability_score=0.75,
        attempt_number=1,
    )
    db_session.add(rec_1)
    db_session.commit()

    intel = get_case_channel_intelligence(db_session, case)
    assert intel.recommended_channel == "sms"
    assert "The previous WHATSAPP notification was delivered but received no engagement" in intel.reason
    assert len(intel.communication_journey) == 1
    assert intel.communication_journey[0].channel == "whatsapp"
    assert intel.communication_journey[0].outcome == "IGNORED"


def test_attribution_sets_recovery_flag(db_session: Session):
    """attribute_recovery_to_communication correctly flags latest communication record."""
    uid = uuid.uuid4().hex[:8]
    customer = Customer(email=f"attr_{uid}@example.com", phone=f"+9198765{uid[:5]}")
    db_session.add(customer)
    db_session.flush()

    case = PaymentCase(
        case_number=f"CASE-ATTR-{uid}",
        customer_id=customer.id,
        amount=100000,
        status=CaseStatus.RECOVERED,
    )
    db_session.add(case)
    db_session.commit()

    rec = CommunicationRecord(
        case_id=case.id,
        channel="sms",
        status="SENT",
        outcome="SENT",
        attempt_number=1,
    )
    db_session.add(rec)
    db_session.commit()

    attributed = attribute_recovery_to_communication(db_session, case)
    assert attributed is not None
    assert attributed.recovery_attributed is True
    assert attributed.outcome == "PAYMENT_COMPLETED"
