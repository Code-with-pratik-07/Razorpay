import uuid

from sqlalchemy.orm import Session

from app.models.customer import Customer
from app.models.payment_case import CaseStatus, PaymentCase


def create_case(db: Session, **overrides: object) -> PaymentCase:
    suffix = uuid.uuid4().hex[:10]
    customer = Customer(email=f"test-{suffix}@recoverai.local")
    db.add(customer)
    db.flush()
    values: dict[str, object] = {
        "case_number": f"REC-{suffix}",
        "customer_id": customer.id,
        "amount": 499900,
        "razorpay_order_id": f"order_{suffix}",
        "status": CaseStatus.FAILED,
    }
    values.update(overrides)
    case = PaymentCase(**values)
    db.add(case)
    db.commit()
    db.refresh(case)
    return case
