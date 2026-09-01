import pytest
from app.db.database import SessionLocal, init_db
from app.models.payment_case import CaseStatus, PaymentCase
from app.models.customer import Customer
from app.services.dashboard_service import dashboard_stats
import uuid

@pytest.fixture(autouse=True)
def setup_db():
    init_db()
    yield

def _create_case(db, status: CaseStatus, amount: int):
    customer = Customer(
        email=f"test_{uuid.uuid4().hex[:6]}@example.com",
        razorpay_customer_id=f"cust_{uuid.uuid4().hex[:6]}",
    )
    db.add(customer)
    db.flush()

    case = PaymentCase(
        case_number=f"SIM-{uuid.uuid4().hex[:6].upper()}",
        customer_id=customer.id,
        amount=amount,
        currency="INR",
        status=status,
    )
    db.add(case)
    db.commit()
    return case

def test_recovery_rate_calculation():
    with SessionLocal() as db:
        base_stats = dashboard_stats(db)
        
        # Example values ₹43,837 recovered and ₹2,59,893 at risk
        # Amount in paise
        _create_case(db, CaseStatus.RECOVERED, 4383700)
        _create_case(db, CaseStatus.FAILED, 25989300)

        stats = dashboard_stats(db)
        
        recovered_diff = stats["revenue_recovered"] - base_stats["revenue_recovered"]
        at_risk_diff = stats["revenue_at_risk"] - base_stats["revenue_at_risk"]
        
        assert recovered_diff == 4383700
        assert at_risk_diff == 25989300
        
        # We also want to assert the recovery rate calculation is correct for these specific values.
        # But since we have base_stats, the total recovery rate will be based on the sum.
        # Let's verify the formula matches what we expect from the raw numbers.
        expected_rate = round((stats["revenue_recovered"] / (stats["revenue_recovered"] + stats["revenue_at_risk"])) * 100, 1)
        assert stats["recovery_rate"] == expected_rate

def test_recovery_rate_zero_recovered():
    with SessionLocal() as db:
        # clear cases for isolation
        db.query(PaymentCase).delete()
        db.commit()
        
        _create_case(db, CaseStatus.FAILED, 10000)

        stats = dashboard_stats(db)
        
        assert stats["revenue_recovered"] == 0
        assert stats["revenue_at_risk"] == 10000
        assert stats["recovery_rate"] == 0.0

def test_recovery_rate_zero_at_risk():
    with SessionLocal() as db:
        db.query(PaymentCase).delete()
        db.commit()

        _create_case(db, CaseStatus.RECOVERED, 50000)

        stats = dashboard_stats(db)
        
        assert stats["revenue_recovered"] == 50000
        assert stats["revenue_at_risk"] == 0
        assert stats["recovery_rate"] == 100.0

def test_recovery_rate_zero_total():
    with SessionLocal() as db:
        db.query(PaymentCase).delete()
        db.commit()

        # No cases
        stats = dashboard_stats(db)
        
        assert stats["revenue_recovered"] == 0
        assert stats["revenue_at_risk"] == 0
        assert stats["recovery_rate"] == 0.0
