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

        print("Seeding showcase cases...")
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        case_a = PaymentCase(
            case_number="DEMO-A-AUTO", customer_id=customers[0].id, razorpay_payment_id="pay_demo_auto", razorpay_order_id="order_demo_auto",
            amount=250000, currency="INR", status=CaseStatus.RECOVERING, failure_reason="insufficient_funds", payment_method="upi",
            recovery_probability=0.95, recovery_action=RecoveryAction.PAYMENT_LINK, created_at=now - timedelta(minutes=10),
            policy_check_passed=True, policy_reason="Recovery action is permitted by policy.", notification_status="NOT_SENT"
        )
        case_b = PaymentCase(
            case_number="DEMO-B-HUMAN", customer_id=customers[1].id, razorpay_payment_id="pay_demo_human", razorpay_order_id="order_demo_human",
            amount=600000, currency="INR", status=CaseStatus.HUMAN_REVIEW, failure_reason="fraud_suspicion", payment_method="card",
            recovery_probability=0.88, recovery_action=RecoveryAction.ESCALATE, created_at=now - timedelta(minutes=15),
            policy_check_passed=False, policy_reason="Amount exceeds the automatic recovery limit.", notification_status=None
        )
        case_c = PaymentCase(
            case_number="DEMO-C-RECOVERED", customer_id=customers[2].id, razorpay_payment_id="pay_demo_recovered", razorpay_order_id="order_demo_recovered",
            amount=150000, currency="INR", status=CaseStatus.RECOVERED, failure_reason="network_timeout", payment_method="netbanking",
            recovery_probability=0.92, recovery_action=RecoveryAction.PAYMENT_LINK, created_at=now - timedelta(hours=2), recovered_at=now - timedelta(minutes=30),
            policy_check_passed=True, policy_reason="Recovery action is permitted by policy.", notification_status="SENT"
        )
        case_d = PaymentCase(
            case_number="DEMO-D-DUPLICATE", customer_id=customers[3].id, razorpay_payment_id="pay_demo_duplicate", razorpay_order_id="order_demo_duplicate",
            amount=300000, currency="INR", status=CaseStatus.RECOVERING, failure_reason="card_expired", payment_method="card",
            recovery_probability=0.75, recovery_action=RecoveryAction.PAYMENT_LINK, created_at=now - timedelta(hours=1),
            policy_check_passed=True, policy_reason="Recovery action is permitted by policy.", notification_status="NOT_SENT"
        )
        db.add_all([case_a, case_b, case_c, case_d])
        db.flush()

        log_audit_event(db, case_a.id, "failure_detected", {"demo": True, "note": "Synthetic Demo A"})
        log_audit_event(db, case_a.id, "ml_prediction", {"recovery_probability": 0.95})
        log_audit_event(db, case_a.id, "policy_check", {"allowed": True, "reason": "Recovery action is permitted by policy."})
        log_audit_event(db, case_a.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "High recovery probability and good lifetime value.", "customer_message": "Please complete your payment using this secure link.", "confidence": 0.95, "source": "groq"})
        log_audit_event(db, case_a.id, "recovery_started", {"advisory_action": "payment_link", "executed_action": "payment_link", "automatic": True})
        log_audit_event(db, case_a.id, "payment_link_created", {"url": "mock_demo_link"})

        log_audit_event(db, case_b.id, "failure_detected", {"demo": True, "note": "Synthetic Demo B"})
        log_audit_event(db, case_b.id, "ml_prediction", {"recovery_probability": 0.88})
        log_audit_event(db, case_b.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "Customer is likely to pay, recommend sending link.", "customer_message": "Please pay using this link.", "confidence": 0.85, "source": "groq"})
        log_audit_event(db, case_b.id, "policy_check", {"allowed": False, "reason": "Amount exceeds the automatic recovery limit."})
        log_audit_event(db, case_b.id, "human_escalation", {"reason": "Policy blocked automatic recovery"})

        log_audit_event(db, case_c.id, "failure_detected", {"demo": True, "note": "Synthetic Demo C"})
        log_audit_event(db, case_c.id, "ml_prediction", {"recovery_probability": 0.92})
        log_audit_event(db, case_c.id, "policy_check", {"allowed": True, "reason": "Recovery action is permitted by policy."})
        log_audit_event(db, case_c.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "Network timeout, easy to recover.", "customer_message": "Please try your payment again.", "confidence": 0.90, "source": "groq"})
        log_audit_event(db, case_c.id, "recovery_started", {"advisory_action": "payment_link", "executed_action": "payment_link", "automatic": True})
        log_audit_event(db, case_c.id, "payment_link_created", {"url": "mock_demo_link"})
        log_audit_event(db, case_c.id, "email_notification_sent", {"provider": "demo", "status_code": 200})
        log_audit_event(db, case_c.id, "payment_success", {"demo": True, "event": "payment.captured", "payment_id": "pay_demo_success"})
        log_audit_event(db, case_c.id, "case_recovered", {"order_id": "order_demo_success"})

        log_audit_event(db, case_d.id, "failure_detected", {"demo": True, "note": "Synthetic Demo D"})
        log_audit_event(db, case_d.id, "ml_prediction", {"recovery_probability": 0.75})
        log_audit_event(db, case_d.id, "policy_check", {"allowed": True, "reason": "Recovery action is permitted by policy."})
        log_audit_event(db, case_d.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "Standard recovery process recommended.", "customer_message": "Please use this link to pay.", "confidence": 0.80, "source": "groq"})
        log_audit_event(db, case_d.id, "recovery_started", {"advisory_action": "payment_link", "executed_action": "payment_link", "automatic": True})
        log_audit_event(db, case_d.id, "payment_link_created", {"url": "mock_demo_real_simulated"})

        print("Seeding synthetic demo cases...")
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
                log_audit_event(db, case.id, "payment_link_created", {"url": "mock_demo_link"})

            if status == CaseStatus.RECOVERED:
                case.recovered_at = created_at + timedelta(hours=1)
                log_audit_event(db, case.id, "payment_success", {"demo": True})

            if status == CaseStatus.HUMAN_REVIEW:
                log_audit_event(db, case.id, "human_escalation", {"reason": "Demo escalation"})

        db.commit()
        print("Demo data successfully seeded!")
