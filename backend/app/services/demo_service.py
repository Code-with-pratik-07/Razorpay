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
                lifetime_value=random.randint(10000, 2000000)
            )
            db.add(c)
            customers.append(c)
        db.commit()

        print("Seeding showcase cases...")
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        case_a = PaymentCase(
            case_number="DEMO-A-AUTO", customer_id=customers[0].id, razorpay_payment_id="pay_demo_auto", razorpay_order_id="order_demo_auto",
            amount=250000, currency="INR", status=CaseStatus.FAILED, failure_reason="insufficient_funds", payment_method="upi",
            recovery_probability=0.95, recovery_action=RecoveryAction.PAYMENT_LINK, created_at=now - timedelta(minutes=10),
            policy_check_passed=True, policy_reason="Automatic recovery approved.", notification_status="PENDING", max_retries=3
        )
        case_b = PaymentCase(
            case_number="DEMO-B-HUMAN", customer_id=customers[1].id, razorpay_payment_id="pay_demo_human", razorpay_order_id="order_demo_human",
            amount=2500000, currency="INR", status=CaseStatus.HUMAN_REVIEW, failure_reason="fraud_suspicion", payment_method="card",
            recovery_probability=0.55, recovery_action=RecoveryAction.ESCALATE, created_at=now - timedelta(minutes=15),
            policy_check_passed=False, policy_reason="Automatic recovery blocked — Human approval required.", notification_status="PENDING", max_retries=2
        )
        case_c = PaymentCase(
            case_number="DEMO-C-RECOVERED", customer_id=customers[2].id, razorpay_payment_id="pay_demo_recovered", razorpay_order_id="order_demo_recovered",
            amount=150000, currency="INR", status=CaseStatus.RECOVERED, failure_reason="network_timeout", payment_method="netbanking",
            recovery_probability=0.92, recovery_action=RecoveryAction.PAYMENT_LINK, created_at=now - timedelta(hours=2), recovered_at=now - timedelta(minutes=30),
            policy_check_passed=True, policy_reason="Automatic recovery approved.", notification_status="SENT", max_retries=3
        )
        case_d = PaymentCase(
            case_number="DEMO-D-STOPPED", customer_id=customers[3].id, razorpay_payment_id="pay_demo_stopped", razorpay_order_id="order_demo_stopped",
            amount=30000, currency="INR", status=CaseStatus.ABANDONED, failure_reason="bank_declined", payment_method="card",
            recovery_probability=0.25, recovery_action=RecoveryAction.NONE, created_at=now - timedelta(hours=1),
            policy_check_passed=True, policy_reason="Automatic recovery approved.", notification_status="NOT_SENT", max_retries=1
        )
        db.add_all([case_a, case_b, case_c, case_d])
        db.flush()

        # Execute recovery for DEMO-A-AUTO to get a REAL Razorpay link!
        log_audit_event(db, case_a.id, "failure_detected", {"demo": True, "note": "Synthetic Demo A"})
        log_audit_event(db, case_a.id, "ml_prediction", {"recovery_probability": 0.95})
        log_audit_event(db, case_a.id, "policy_check", {"allowed": True, "reason": "Automatic recovery approved."})
        log_audit_event(db, case_a.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "High recovery probability.", "customer_message": "Please pay.", "confidence": 0.95, "source": "groq"})
        
        from app.services.recovery_service import execute_recovery
        execute_recovery(db, case_a, automatic=True)

        log_audit_event(db, case_b.id, "failure_detected", {"demo": True, "note": "Synthetic Demo B"})
        log_audit_event(db, case_b.id, "ml_prediction", {"recovery_probability": 0.88})
        log_audit_event(db, case_b.id, "policy_check", {"allowed": False, "reason": "Automatic recovery blocked — Human approval required."})
        log_audit_event(db, case_b.id, "ai_analysis", {"recommended_action": "escalate", "reasoning": "Policy block.", "confidence": 0.85, "source": "groq"})
        log_audit_event(db, case_b.id, "human_escalation", {"reason": "Policy blocked automatic recovery", "source": "policy"})

        log_audit_event(db, case_c.id, "failure_detected", {"demo": True, "note": "Synthetic Demo C"})
        log_audit_event(db, case_c.id, "ml_prediction", {"recovery_probability": 0.92})
        log_audit_event(db, case_c.id, "policy_check", {"allowed": True, "reason": "Automatic recovery approved."})
        log_audit_event(db, case_c.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "High recovery probability and eligible recovery profile.", "customer_message": "Please complete your payment using this secure payment link.", "confidence": 0.92, "source": "demo"})
        log_audit_event(db, case_c.id, "recovery_started", {"advisory_action": "payment_link", "executed_action": "payment_link", "automatic": True})
        log_audit_event(db, case_c.id, "payment_link_created", {"url": "https://rzp.io/i/demo_recovered"})
        log_audit_event(db, case_c.id, "email_notification_sent", {"provider": "demo", "status_code": 200})
        log_audit_event(db, case_c.id, "payment_success", {"demo": True, "event": "payment.captured", "payment_id": "pay_demo_success"})
        log_audit_event(db, case_c.id, "case_recovered", {"order_id": "order_demo_success"})

        log_audit_event(db, case_d.id, "failure_detected", {"demo": True, "note": "Synthetic Demo D"})
        log_audit_event(db, case_d.id, "ml_prediction", {"recovery_probability": 0.25})
        log_audit_event(db, case_d.id, "policy_check", {"allowed": True, "reason": "Automatic recovery approved."})
        log_audit_event(db, case_d.id, "ai_analysis", {"recommended_action": "escalate", "reasoning": "Low probability.", "confidence": 0.80, "source": "groq"})
        log_audit_event(db, case_d.id, "recovery_stopped", {"reason": "Predicted recovery probability is too low.", "ml_decision": "LOW"})

        print("Seeding synthetic demo cases...")
        features, _ = generate_training_data(samples=50)
        from app.services.recovery_service import execute_recovery

        for i, row in features.iterrows():
            customer = random.choice(customers)
            amount = int(row['amount'])
            
            prob = random.uniform(0.1, 0.95)
            policy_pass = amount <= 2000000

            created_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=random.randint(1, 120))
            is_cold_start = (customer.successful_payments + customer.failed_payments) < 3
            if is_cold_start:
                max_retries = 2
            elif prob >= 0.60:
                max_retries = 3
            elif prob >= 0.40:
                max_retries = 2
            else:
                max_retries = 1

            status = CaseStatus.FAILED
            action = RecoveryAction.NONE

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
                recovery_probability=prob,
                recovery_action=action,
                created_at=created_at,
                policy_check_passed=policy_pass,
                policy_reason="Automatic recovery approved." if policy_pass else "Automatic recovery blocked — Human approval required.",
                max_retries=max_retries
            )
            db.add(case)
            db.flush()

            log_audit_event(db, case.id, "failure_detected", {"demo": True, "note": "Seeded data"})
            log_audit_event(db, case.id, "ml_prediction", {"recovery_probability": case.recovery_probability})
            log_audit_event(db, case.id, "policy_check", {"allowed": case.policy_check_passed, "reason": case.policy_reason})

            # Evaluate routing to log AI correctly and set status
            if not policy_pass:
                case.status = CaseStatus.HUMAN_REVIEW
                case.recovery_action = RecoveryAction.ESCALATE
                log_audit_event(db, case.id, "ai_analysis", {"recommended_action": "escalate", "reasoning": "Policy blocked automatic recovery.", "customer_message": "Manual review required.", "confidence": prob, "source": "fallback"})
                log_audit_event(db, case.id, "human_escalation", {"reason": "Policy blocked automatic recovery", "source": "policy"})
            elif prob < 0.40:
                case.status = CaseStatus.ABANDONED
                case.recovery_action = RecoveryAction.NONE
                log_audit_event(db, case.id, "ai_analysis", {"recommended_action": "escalate", "reasoning": "Low recovery probability.", "customer_message": "", "confidence": prob, "source": "fallback"})
                log_audit_event(db, case.id, "recovery_stopped", {"reason": "Probability too low", "ml_decision": "LOW"})
            elif prob < 0.60:
                case.status = CaseStatus.HUMAN_REVIEW
                case.recovery_action = RecoveryAction.NONE
                log_audit_event(db, case.id, "ai_analysis", {"recommended_action": "escalate", "reasoning": "Uncertain recovery probability.", "customer_message": "", "confidence": prob, "source": "fallback"})
                log_audit_event(db, case.id, "human_escalation", {"reason": "Uncertain ML probability", "source": "ml_routing"})
            else:
                # High probability + Policy passed -> execute automatically!
                log_audit_event(db, case.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "High recovery probability.", "customer_message": "Please pay.", "confidence": prob, "source": "fallback"})
                execute_recovery(db, case, automatic=True)

        db.commit()
        print("Demo data successfully seeded!")


def simulate_failure_event(
    amount: int | None = None,
    failure_reason: str | None = None,
    payment_method: str | None = None,
    successful_payments: int | None = None,
) -> dict:
    """Create a synthetic payment failure and run the full analysis + ML routing pipeline.

    This is the demo equivalent of Razorpay sending a real payment.failed webhook.
    It intentionally runs the real pipeline — no shortcuts, no mocked decisions.
    """
    import random as _random
    from app.services.recovery_service import analyze_case, execute_recovery

    # Randomly vary customer history to show different ML routing outcomes across demos.
    _methods = ["card", "upi", "netbanking"]
    _reasons = ["insufficient_funds", "card_expired", "network_timeout", "bank_declined"]

    with SessionLocal() as db:
        suffix = uuid.uuid4().hex[:8]
        succ = successful_payments if successful_payments is not None else _random.randint(0, 10)
        customer = Customer(
            email=f"demo_{suffix}@example.com",
            razorpay_customer_id=f"cust_sim_{suffix}",
            successful_payments=succ,
            failed_payments=_random.randint(0, 3),
            lifetime_value=float(succ * _random.randint(5000, 50000)),
        )
        db.add(customer)
        db.commit()
        db.refresh(customer)

        case = PaymentCase(
            case_number=f"SIM-{suffix.upper()}",
            customer_id=customer.id,
            razorpay_payment_id=f"pay_sim_{suffix}",
            razorpay_order_id=f"order_sim_{suffix}",
            amount=amount if amount is not None else _random.randint(10000, 250000),
            currency="INR",
            status=CaseStatus.FAILED,
            failure_reason=failure_reason if failure_reason in _reasons else _random.choice(_reasons),
            payment_method=payment_method if payment_method in _methods else _random.choice(_methods),
        )
        db.add(case)
        db.commit()
        db.refresh(case)

        log_audit_event(db, case.id, "failure_detected", {
            "payment_id": case.razorpay_payment_id,
            "order_id": case.razorpay_order_id,
            "source": "demo_simulation",
        })
        log_audit_event(db, case.id, "case_created", {"source": "demo_simulation"})

        # Run the real pipeline — ML → policy → Groq → routing.
        analyze_case(db, case)
        db.refresh(case)

        # If analyze_case routed to HIGH (status=FAILED), trigger automatic recovery.
        if case.status == CaseStatus.FAILED:
            execute_recovery(db, case, automatic=True)
            db.refresh(case)

        return {
            "case_id": case.id,
            "case_number": case.case_number,
            "status": case.status.value,
            "recovery_probability": case.recovery_probability,
            "ml_decision": (
                "HIGH" if (case.recovery_probability or 0) >= 0.60
                else "UNCERTAIN" if (case.recovery_probability or 0) >= 0.40
                else "LOW"
            ),
            "message": (
                f"Case {case.case_number} created and processed automatically."
            ),
        }

