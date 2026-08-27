import random
import uuid
from datetime import timedelta, datetime, timezone

from app.db.database import SessionLocal, init_db, engine
from app.models.customer import Customer
from app.models.payment_case import CaseStatus, PaymentCase, RecoveryAction
from app.services.audit_service import log_audit_event
from app.ml.train import generate_training_data

def seed_demo_data(reset: bool = False):
    if reset:
        print("Resetting database...")
        from app.db.database import Base
        Base.metadata.drop_all(bind=engine)
        init_db()
        print("Database tables recreated.")

    with SessionLocal() as db:
        print("Seeding demo customers...")
        customers = []
        for i in range(20):
            suffix = uuid.uuid4().hex[:6]
            c = Customer(
                email=f"demo_user_{suffix}@example.com",
                razorpay_customer_id=f"cust_demo_{suffix}",
                successful_payments=random.randint(0, 5),
                failed_payments=random.randint(1, 3),
                lifetime_value=random.randint(10000, 500000)
            )
            db.add(c)
            customers.append(c)
        db.commit()

        print("Seeding demo cases...")
        features, _ = generate_training_data(samples=50)

        for i, row in features.iterrows():
            customer = random.choice(customers)
            amount = int(row['amount'])

            # Mix up statuses
            rand = random.random()
            if rand < 0.4:
                status = CaseStatus.FAILED
                action = RecoveryAction.NONE
            elif rand < 0.6:
                status = CaseStatus.RECOVERING
                action = RecoveryAction.PAYMENT_LINK
            elif rand < 0.75:
                status = CaseStatus.RECOVERED
                action = RecoveryAction.PAYMENT_LINK
            elif rand < 0.9:
                status = CaseStatus.HUMAN_REVIEW
                action = RecoveryAction.ESCALATE
            else:
                status = CaseStatus.CLOSED
                action = RecoveryAction.NONE

            created_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=random.randint(1, 120))

            case = PaymentCase(
                case_number=f"DEMO-{uuid.uuid4().hex[:10].upper()}",
                customer_id=customer.id,
                razorpay_payment_id=f"pay_demo_{uuid.uuid4().hex[:8]}",
                razorpay_order_id=f"order_demo_{uuid.uuid4().hex[:8]}",
                amount=amount,
                currency="INR",
                status=status,
                failure_reason=row['failure_reason'],
                payment_method=row['payment_method'],
                recovery_probability=random.uniform(0.1, 0.95),
                recovery_action=action,
                created_at=created_at,
                policy_check_passed=amount <= 500000,
                policy_reason="Recovery action is permitted by policy." if amount <= 500000 else "Amount exceeds the automatic recovery limit."
            )
            db.add(case)
            db.flush()

            log_audit_event(db, case.id, "failure_detected", {"demo": True, "note": "Seeded data"})
            log_audit_event(db, case.id, "ml_prediction", {"recovery_probability": case.recovery_probability})
            log_audit_event(db, case.id, "policy_check", {"allowed": case.policy_check_passed, "reason": case.policy_reason})

            if status in {CaseStatus.RECOVERING, CaseStatus.RECOVERED}:
                log_audit_event(db, case.id, "payment_link_created", {"url": "https://rzp.io/i/demo"})

            if status == CaseStatus.RECOVERED:
                case.recovered_at = created_at + timedelta(hours=1)
                log_audit_event(db, case.id, "payment_success", {"demo": True})

            if status == CaseStatus.HUMAN_REVIEW:
                log_audit_event(db, case.id, "human_escalation", {"reason": "Demo escalation"})

        db.commit()
        print("Demo data successfully seeded!")
