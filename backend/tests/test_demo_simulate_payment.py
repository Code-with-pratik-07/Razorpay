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
