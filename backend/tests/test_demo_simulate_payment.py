import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timezone, timedelta

from app.main import app
from app.core.config import get_settings
from app.db.database import SessionLocal, init_db
from app.models.payment_case import CaseStatus, PaymentCase, NextActionType
from app.models.customer import Customer
import uuid

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    get_settings().demo_mode = True
    yield
    get_settings().demo_mode = False

def create_mock_case(db, status=CaseStatus.RECOVERING):
    customer = Customer(
        email=f"test_{uuid.uuid4().hex[:6]}@example.com",
        razorpay_customer_id=f"cust_{uuid.uuid4().hex[:6]}",
        successful_payments=1,
        failed_payments=0,
        lifetime_value=1000,
    )
    db.add(customer)
    db.flush()

    case = PaymentCase(
        case_number=f"SIM-{uuid.uuid4().hex[:6].upper()}",
        customer_id=customer.id,
        amount=5000,
        currency="INR",
        status=status,
        failure_reason="fraud_suspicion",
        payment_method="card",
        retry_count=1,
        next_action_type=NextActionType.EXPIRY_CHECK,
        next_action_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)
    )
    db.add(case)
    db.commit()
    db.refresh(case)
    return case

def test_simulate_payment_success():
    with SessionLocal() as db:
        case = create_mock_case(db)
        case_id = case.id
        old_successes = case.customer.successful_payments
        old_ltv = case.customer.lifetime_value

    response = client.post(f"/api/demo/simulate-payment/{case_id}", json={"success": True})
    assert response.status_code == 200
    assert response.json()["case_status"] == CaseStatus.RECOVERED.value

    with SessionLocal() as db:
        updated_case = db.get(PaymentCase, case_id)
        assert updated_case.status == CaseStatus.RECOVERED
        assert updated_case.next_action_type == NextActionType.NONE
        assert updated_case.next_action_at is None
        assert updated_case.recovered_at is not None
        assert updated_case.customer.successful_payments == old_successes + 1
        assert updated_case.customer.lifetime_value == old_ltv + updated_case.amount
        assert updated_case.last_payment_status == "SUCCESS"
        assert updated_case.last_payment_attempt_at is not None
        assert updated_case.last_payment_failure_reason is None

def test_simulate_payment_failure():
    with SessionLocal() as db:
        case = create_mock_case(db)
        case_id = case.id

    response = client.post(f"/api/demo/simulate-payment/{case_id}", json={"success": False})
    assert response.status_code == 200
    assert response.json()["case_status"] == CaseStatus.RECOVERING.value

    with SessionLocal() as db:
        updated_case = db.get(PaymentCase, case_id)
        # Should not change status or retry_count
        assert updated_case.status == CaseStatus.RECOVERING
        assert updated_case.retry_count == 1
        assert updated_case.next_action_type == NextActionType.EXPIRY_CHECK
        assert updated_case.last_payment_status == "FAILED"
        assert updated_case.last_payment_attempt_at is not None
        assert updated_case.last_payment_failure_reason == "Simulated payment failure"

def test_duplicate_simulate_failure_requests():
    with SessionLocal() as db:
        case = create_mock_case(db)
        case_id = case.id

    # first failure
    client.post(f"/api/demo/simulate-payment/{case_id}", json={"success": False})
    # second failure
    client.post(f"/api/demo/simulate-payment/{case_id}", json={"success": False})
    
    with SessionLocal() as db:
        updated_case = db.get(PaymentCase, case_id)
        assert updated_case.status == CaseStatus.RECOVERING
        assert updated_case.retry_count == 1
        assert updated_case.last_payment_status == "FAILED"

def test_simulate_payment_already_terminal():
    with SessionLocal() as db:
        case = create_mock_case(db, status=CaseStatus.ABANDONED)
        case_id = case.id

    response = client.post(f"/api/demo/simulate-payment/{case_id}", json={"success": True})
    assert response.status_code == 200
    assert "already in a terminal state" in response.json()["message"]

    with SessionLocal() as db:
        updated_case = db.get(PaymentCase, case_id)
        assert updated_case.status == CaseStatus.ABANDONED


def test_recovery_payment_failed_netbanking():
    """Requirement A: Recovery payment failed using Netbanking."""
    with SessionLocal() as db:
        case = create_mock_case(db)
        case_id = case.id

    # Simulate failure using Netbanking via both endpoint styles
    response = client.post(
        f"/api/demo/simulate-payment/{case_id}",
        json={
            "success": False,
            "payment_method": "netbanking",
            "failure_reason": "Bank server timeout during netbanking verification"
        }
    )
    assert response.status_code == 200
    assert response.json()["payment_result"] == "failed"

    with SessionLocal() as db:
        updated_case = db.get(PaymentCase, case_id)
        # 1. Original payment method remains unchanged!
        assert updated_case.payment_method == "card"
        assert updated_case.failure_reason == "fraud_suspicion"

        # 2. Case remains in active recovery state
        assert updated_case.status == CaseStatus.RECOVERING

        # 3. Communication retry_count does NOT increase
        assert updated_case.retry_count == 1

        # 4. Latest recovery payment attempt is recorded
        assert updated_case.last_payment_status == "FAILED"
        assert updated_case.last_payment_method == "netbanking"
        assert "Bank server timeout" in (updated_case.last_payment_failure_reason or "")

        # 5. PaymentAttempt entity exists in database
        from app.models.payment_attempt import PaymentAttempt
        attempts = db.query(PaymentAttempt).filter(PaymentAttempt.case_id == case_id).all()
        assert len(attempts) == 1
        assert attempts[0].payment_method == "netbanking"
        assert attempts[0].status == "failed"
        assert attempts[0].amount == 5000

        # 6. Audit events recorded
        from app.models.audit_event import AuditEvent
        events = db.query(AuditEvent).filter(AuditEvent.case_id == case_id).all()
        event_types = [e.event_type for e in events]
        assert "recovery_payment_attempted" in event_types
        assert "recovery_payment_failed" in event_types


def test_recovery_payment_succeeds_netbanking():
    """Requirement B: Recovery payment succeeds with Netbanking."""
    with SessionLocal() as db:
        case = create_mock_case(db)
        case_id = case.id

    response = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={
            "payment_method": "netbanking",
            "status": "success",
            "amount": 5000
        }
    )
    assert response.status_code == 200
    assert response.json()["payment_result"] == "success"

    with SessionLocal() as db:
        updated_case = db.get(PaymentCase, case_id)
        # Original payment method remains unchanged
        assert updated_case.payment_method == "card"
        assert updated_case.last_payment_method == "netbanking"
        assert updated_case.status == CaseStatus.RECOVERED
        assert updated_case.recovered_at is not None

        # Verify attempts
        from app.models.payment_attempt import PaymentAttempt
        attempts = db.query(PaymentAttempt).filter(PaymentAttempt.case_id == case_id).all()
        assert len(attempts) == 1
        assert attempts[0].status == "success"
        assert attempts[0].payment_method == "netbanking"

    # Further recovery next-step actions are blocked
    blocked = client.post(f"/api/cases/{case_id}/next-step")
    assert blocked.status_code == 400


def test_multiple_payment_attempts_history():
    """Requirement C: Multiple payment attempts in chronological history."""
    with SessionLocal() as db:
        case = create_mock_case(db)
        case_id = case.id

    # Attempt 1: Failed Netbanking
    client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "netbanking", "status": "failed", "failure_reason": "Limit exceeded"}
    )
    # Attempt 2: Failed UPI
    client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "upi", "status": "failed", "failure_reason": "PIN incorrect"}
    )
    # Attempt 3: Successful Card
    client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "card", "status": "success"}
    )

    # Fetch attempts via API endpoint
    att_res = client.get(f"/api/cases/{case_id}/payment-attempts")
    assert att_res.status_code == 200
    attempts_data = att_res.json()
    assert len(attempts_data) == 3

    # Latest payment activity reflects last attempt (card, success)
    exp_res = client.get(f"/api/cases/{case_id}/explanation")
    assert exp_res.status_code == 200
    exp_data = exp_res.json()
    assert exp_data["last_payment_status"] == "SUCCESS"
    assert exp_data["last_payment_method"] == "card"
    assert exp_data["payment_method"] == "card"  # original payment method intact
    assert len(exp_data["payment_attempts"]) == 3


def test_terminal_cases_payment_attempt_rules():
    """Requirement D: Payment attempts on terminal cases behave according to terminal rules."""
    with SessionLocal() as db:
        case = create_mock_case(db, status=CaseStatus.ABANDONED)
        case_id = case.id

    # Attempt on abandoned case
    res = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "netbanking", "status": "failed"}
    )
    assert res.status_code == 200
    assert res.json()["payment_result"] == "already_terminal"

    with SessionLocal() as db:
        c = db.get(PaymentCase, case_id)
        assert c.status == CaseStatus.ABANDONED


def test_comprehensive_payment_attempt_edge_cases():
    """Verify all payment attempt edge cases: netbanking, upi, card, multiple consecutive,

    repeated same method, debounce, terminal cases (recovered, abandoned, closed).
    """
    with SessionLocal() as db:
        case = create_mock_case(db)
        case_id = case.id

    orig_method = case.payment_method
    orig_failure = case.failure_reason
    orig_amount = case.amount
    orig_retries = case.retry_count

    # 1. Failed payment using Netbanking
    res_nb = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "netbanking", "status": "failed", "failure_reason": "Bank timeout"}
    )
    assert res_nb.status_code == 200
    assert res_nb.json()["payment_result"] == "failed"

    # 2. Rapid repeated submission (debounce / duplicate protection within 2s)
    res_dup = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "netbanking", "status": "failed", "failure_reason": "Bank timeout"}
    )
    assert res_dup.status_code == 200
    assert "duplicate submission prevented" in res_dup.json()["message"]

    # 3. Failed payment using UPI
    res_upi = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "upi", "status": "failed", "failure_reason": "MPIN incorrect"}
    )
    assert res_upi.status_code == 200
    assert res_upi.json()["payment_result"] == "failed"

    # 4. Failed payment using Card
    res_card = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "card", "status": "failed", "failure_reason": "OTP expired"}
    )
    assert res_card.status_code == 200
    assert res_card.json()["payment_result"] == "failed"

    # 5. Multiple consecutive failures with the same method (UPI again)
    res_upi_2 = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "upi", "status": "failed", "failure_reason": "Bank server down"}
    )
    assert res_upi_2.status_code == 200
    assert res_upi_2.json()["payment_result"] == "failed"

    with SessionLocal() as db:
        c = db.get(PaymentCase, case_id)
        # Verify original transaction attributes NEVER mutated
        assert c.payment_method == orig_method
        assert c.failure_reason == orig_failure
        assert c.amount == orig_amount
        assert c.retry_count == orig_retries  # Payment attempts NEVER increment retry_count
        assert c.status == CaseStatus.RECOVERING

    # 6. Failure followed by successful payment
    res_succ = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "card", "status": "success"}
    )
    assert res_succ.status_code == 200
    assert res_succ.json()["payment_result"] == "success"

    with SessionLocal() as db:
        c = db.get(PaymentCase, case_id)
        assert c.status == CaseStatus.RECOVERED
        assert c.last_payment_status == "SUCCESS"
        assert c.last_payment_method == "card"
        assert c.payment_method == orig_method  # Still original!

    # 7. Successful payment followed by an attempted second payment request
    res_post_succ = client.post(
        f"/api/cases/{case_id}/payment-attempt",
        json={"payment_method": "netbanking", "status": "success"}
    )
    assert res_post_succ.status_code == 200
    assert res_post_succ.json()["payment_result"] == "already_terminal"

    # 8. Payment attempt on CLOSED case
    with SessionLocal() as db:
        closed_case = create_mock_case(db, status=CaseStatus.CLOSED)
        closed_id = closed_case.id

    res_closed = client.post(
        f"/api/cases/{closed_id}/payment-attempt",
        json={"payment_method": "upi", "status": "failed"}
    )
    assert res_closed.status_code == 200
    assert res_closed.json()["payment_result"] == "already_terminal"

    with SessionLocal() as db:
        c_closed = db.get(PaymentCase, closed_id)
        assert c_closed.status == CaseStatus.CLOSED


