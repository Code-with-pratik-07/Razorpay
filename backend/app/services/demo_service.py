import random
import uuid
from datetime import timedelta, datetime, timezone
from sqlalchemy import select

from app.db.database import SessionLocal, init_db, engine
from app.models.customer import Customer
from app.models.payment_case import CaseStatus, PaymentCase, RecoveryAction
from app.models.communication_record import CommunicationRecord
from app.models.payment_attempt import PaymentAttempt
from app.services.audit_service import log_audit_event
from app.ml.train import generate_training_data

def _simulate_execution(db, case):
    case.retry_count += 1
    case.last_retry_at = datetime.now(timezone.utc).replace(tzinfo=None)
    case.recovery_action = RecoveryAction.PAYMENT_LINK
    if case.retry_count >= case.max_retries:
        case.status = CaseStatus.ABANDONED
    else:
        case.status = CaseStatus.RECOVERING
    log_audit_event(db, case.id, "recovery_started", {"advisory_action": "payment_link", "executed_action": "payment_link", "automatic": True})
    log_audit_event(db, case.id, "payment_link_created", {"payment_link_id": f"inv_sim_{uuid.uuid4().hex[:8]}", "url": "mock_demo_real_simulated"})
    from app.services.notification_service import send_recovery_email
    send_recovery_email(db, case, "mock_demo_real_simulated")
    
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
        # Deterministic showcase customers
        c0 = Customer(
            email="arun.patel@gmail.com",
            phone="+91 98765 43210",
            razorpay_customer_id="cust_demo_auto_a",
            successful_payments=4,
            failed_payments=1,
            lifetime_value=1250000,
        )
        c1 = Customer(
            email="vikram.sharma@outlook.com",
            phone="+91 98123 45678",
            razorpay_customer_id="cust_demo_uncertain_b",
            successful_payments=1,
            failed_payments=1,
            lifetime_value=150000,
        )
        c2 = Customer(
            email="priya.nair@enterprise.in",
            phone="+91 99456 78901",
            razorpay_customer_id="cust_demo_recovered_c",
            successful_payments=5,
            failed_payments=1,
            lifetime_value=850000,
        )
        c3 = Customer(
            email="suresh.kumar@retail.in",
            phone="+91 97234 56789",
            razorpay_customer_id="cust_demo_stopped_d",
            successful_payments=1,
            failed_payments=0,
            lifetime_value=30000,
        )
        c4 = Customer(
            email="meera.reddy@corporate.com",
            phone="+91 98345 67890",
            razorpay_customer_id="cust_demo_human_b",
            successful_payments=2,
            failed_payments=1,
            lifetime_value=3500000,
            preferred_channel="email",
        )
        c5 = Customer(
            email="rohit.verma@techcorp.in",
            phone="+91 96123 45678",
            razorpay_customer_id="cust_demo_optout_e",
            successful_payments=3,
            failed_payments=1,
            lifetime_value=450000,
            opted_out_channels="sms",
        )
        db.add_all([c0, c1, c2, c3, c4, c5])
        customers.extend([c0, c1, c2, c3, c4, c5])

        for i in range(14):
            suffix = uuid.uuid4().hex[:6]
            c = Customer(
                email=f"demo_user_{suffix}@example.com",
                phone=f"+91 98765 {random.randint(10000, 99999)}",
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
            case_number="DEMO-B-UNCERTAIN", customer_id=customers[1].id, razorpay_payment_id="pay_demo_uncertain", razorpay_order_id="order_demo_uncertain",
            amount=150000, currency="INR", status=CaseStatus.FAILED, failure_reason="fraud_suspicion", payment_method="card",
            recovery_probability=0.55, recovery_action=RecoveryAction.NONE, created_at=now - timedelta(minutes=15),
            policy_check_passed=True, policy_reason="Automatic recovery approved.", notification_status="PENDING", max_retries=2
        )
        case_b_human = PaymentCase(
            case_number="DEMO-B-HUMAN", customer_id=customers[4].id, razorpay_payment_id="pay_demo_human", razorpay_order_id="order_demo_human",
            amount=2500000, currency="INR", status=CaseStatus.HUMAN_REVIEW, failure_reason="fraud_suspicion", payment_method="card",
            recovery_probability=0.88, recovery_action=RecoveryAction.ESCALATE, created_at=now - timedelta(minutes=10),
            policy_check_passed=False, policy_reason="Automatic recovery blocked — High transaction value requires manual review.", notification_status=None, max_retries=3,
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
            recovery_probability=0.25, recovery_action=RecoveryAction.NONE, created_at=now - timedelta(days=2),
            policy_check_passed=True, policy_reason="Automatic recovery approved.", notification_status="SENT", max_retries=1, retry_count=1,
            payment_link_expires_at=now - timedelta(hours=2)
        )
        db.add_all([case_a, case_b, case_b_human, case_c, case_d])
        db.flush()

        # Execute recovery for DEMO-A-AUTO to get a REAL Razorpay link!
        log_audit_event(db, case_a.id, "failure_detected", {"demo": True, "note": "Synthetic Demo A"})
        log_audit_event(db, case_a.id, "ml_prediction", {"recovery_probability": 0.95})
        log_audit_event(db, case_a.id, "ai_analysis", {
            "recommended_action": "payment_link",
            "reasoning": "The payment has a high predicted recovery probability (95%) and has passed all policy checks. RecoverAI automatically generated a secure payment link and selected WhatsApp as the primary communication channel.",
            "customer_message": "We noticed your recent payment was unsuccessful. Please use the secure payment option to complete your transaction.",
            "confidence": 0.95,
            "source": "groq",
        })
        
        from app.services.recovery_service import execute_recovery
        execute_recovery(db, case_a, automatic=True)
        rec_a = db.scalar(select(CommunicationRecord).where(CommunicationRecord.case_id == case_a.id))
        if rec_a:
            rec_a.outcome = "DELIVERED"
            rec_a.message_snippet = "WhatsApp payment link delivered — Awaiting customer response"
            db.commit()

        log_audit_event(db, case_b.id, "failure_detected", {"demo": True, "note": "Synthetic Demo B (Uncertain)"})
        log_audit_event(db, case_b.id, "ml_prediction", {"recovery_probability": 0.55})
        log_audit_event(db, case_b.id, "ai_analysis", {
            "recommended_action": "payment_link",
            "reasoning": "Automatic Recovery: Recovery probability is uncertain, but a controlled automatic recovery attempt is recommended.",
            "customer_message": "Please use the secure payment option to try again.",
            "confidence": 0.55,
            "source": "fallback",
        })
        execute_recovery(db, case_b, automatic=True)

        # Seed DEMO-B-HUMAN: Blocked by policy -> Escalated for human review
        log_audit_event(db, case_b_human.id, "failure_detected", {"demo": True, "note": "Synthetic Demo B (Policy Blocked)"})
        log_audit_event(db, case_b_human.id, "ml_prediction", {"recovery_probability": 0.88})
        log_audit_event(db, case_b_human.id, "policy_check", {"allowed": False, "reason": "Automatic recovery blocked — High transaction value requires manual review."})
        log_audit_event(db, case_b_human.id, "human_escalation", {"reason": "Policy blocked automatic recovery", "source": "policy"})
        log_audit_event(db, case_b_human.id, "ai_analysis", {
            "recommended_action": "escalate",
            "reasoning": "Escalate to Human Review: The recovery probability is high, but the fraud-related failure reason requires manual approval under the current safety policy.",
            "confidence": 0.88,
            "source": "groq",
            "customer_message": "Your payment could not be completed. Please wait while our team reviews the available recovery options.",
        })

        log_audit_event(db, case_c.id, "failure_detected", {"demo": True, "note": "Synthetic Demo C"})
        log_audit_event(db, case_c.id, "ml_prediction", {"recovery_probability": 0.92})
        log_audit_event(db, case_c.id, "policy_check", {"allowed": True, "reason": "Automatic recovery approved."})
        log_audit_event(db, case_c.id, "ai_analysis", {
            "recommended_action": "payment_link",
            "reasoning": "Automatic Recovery: Recovery probability is strong and policy checks have passed. Generate the secure payment link and communicate through the highest-ranked appropriate channel.",
            "customer_message": "Please complete your payment using this secure payment link.",
            "confidence": 0.92,
            "source": "demo",
        })
        log_audit_event(db, case_c.id, "recovery_started", {"advisory_action": "payment_link", "executed_action": "payment_link", "automatic": True})
        log_audit_event(db, case_c.id, "payment_link_created", {"url": "https://rzp.io/i/demo_recovered"})
        log_audit_event(db, case_c.id, "email_notification_sent", {"provider": "demo", "status_code": 200})
        log_audit_event(db, case_c.id, "payment_success", {"demo": True, "event": "payment.captured", "payment_id": "pay_demo_success"})
        log_audit_event(db, case_c.id, "case_recovered", {"order_id": "order_demo_success"})

        log_audit_event(db, case_d.id, "failure_detected", {"demo": True, "note": "Synthetic Demo D"})
        log_audit_event(db, case_d.id, "ml_prediction", {"recovery_probability": 0.25})
        log_audit_event(db, case_d.id, "policy_check", {"allowed": True, "reason": "Automatic recovery approved."})
        log_audit_event(db, case_d.id, "ai_analysis", {
            "recommended_action": "none",
            "reasoning": "Close Recovery: The maximum permitted attempts were reached without customer response. Stop further automated communication to protect the customer relationship.",
            "customer_message": "Recovery closed.",
            "confidence": 0.25,
            "source": "groq",
        })
        # Customer 4 (DEMO-B-HUMAN) explicitly prefers Email for high-value transactions
        customers[4].preferred_channel = "email"
        # Customer 5 opts out of SMS for Scenario E
        customers[5].opted_out_channels = "sms"
        db.commit()

        # Seed established communication history with attribution for DEMO-C (Scenario C)
        comm_c_1 = CommunicationRecord(
            case_id=case_c.id,
            channel="sms",
            status="SENT",
            suitability_score=0.82,
            channel_scores={"sms": 0.82, "whatsapp": 0.65, "email": 0.58},
            reason="The customer previously engaged with SMS notifications and completed recovery after SMS communication.",
            attempt_number=1,
            simulated=False,
            outcome="PAYMENT_COMPLETED",
            delivery_status="DELIVERED",
            recovery_attributed=True,
            recipient=customers[2].phone,
            message_snippet="Payment recovery notice delivered via SMS",
            created_at=now - timedelta(hours=2),
        )
        case_c_prior = PaymentCase(
            case_number="HIST-C-PREV", customer_id=customers[2].id, razorpay_payment_id="pay_demo_hist_c", razorpay_order_id="order_demo_hist_c",
            amount=100000, currency="INR", status=CaseStatus.RECOVERED, created_at=now - timedelta(days=30),
            policy_check_passed=True, notification_status="SENT", max_retries=3
        )
        db.add(case_c_prior)
        db.flush()

        comm_c_prior1 = CommunicationRecord(
            case_id=case_c_prior.id,
            channel="sms",
            status="SENT",
            suitability_score=0.85,
            attempt_number=1,
            outcome="PAYMENT_COMPLETED",
            recovery_attributed=True,
            recipient=customers[2].phone,
            message_snippet="Payment recovery notice delivered via SMS",
            created_at=now - timedelta(days=30),
        )
        comm_c_prior2 = CommunicationRecord(
            case_id=case_c_prior.id,
            channel="sms",
            status="SENT",
            suitability_score=0.85,
            attempt_number=1,
            outcome="PAYMENT_COMPLETED",
            recovery_attributed=True,
            recipient=customers[2].phone,
            message_snippet="Payment recovery notice delivered via SMS",
            created_at=now - timedelta(days=15),
        )
        db.add_all([comm_c_prior1, comm_c_prior2, comm_c_1])
        case_c.selected_channel = "sms"
        log_audit_event(db, case_c.id, "recovery_attribution_recorded", {
            "channel": "sms",
            "attempt_number": 1,
            "signal": "Attributed recovery signal: Customer completed payment following SMS reminder.",
        })

        # Seed real successful PaymentAttempt row for DEMO-C-RECOVERED
        attempt_c = PaymentAttempt(
            case_id=case_c.id,
            payment_method="netbanking",
            amount=case_c.amount,
            currency="INR",
            status="success",
            source="recovery_payment_link",
            created_at=now - timedelta(minutes=30),
        )
        db.add(attempt_c)
        db.commit()

        # Seed DEMO-D-STOPPED link and records
        log_audit_event(db, case_d.id, "payment_link_created", {
            "payment_link_id": "plink_demo_d",
            "url": "https://rzp.io/i/demo_d_stopped_link",
            "expires_at": (now - timedelta(hours=2)).isoformat(),
        })
        case_d.retry_count = 2
        case_d.max_retries = 2
        case_d.status = CaseStatus.ABANDONED

        # Seed Escalation communication records for DEMO-D (Scenario D)
        comm_d_1 = CommunicationRecord(
            case_id=case_d.id,
            channel="whatsapp",
            status="SIMULATED",
            suitability_score=0.75,
            channel_scores={"whatsapp": 0.75, "sms": 0.68, "email": 0.55},
            reason="Initial attempt selected WhatsApp based on mobile availability.",
            attempt_number=1,
            simulated=True,
            outcome="NO_ENGAGEMENT",
            delivery_status="DELIVERED",
            recipient=customers[3].phone,
            message_snippet="WhatsApp reminder delivered",
            created_at=now - timedelta(days=2),
        )
        comm_d_2 = CommunicationRecord(
            case_id=case_d.id,
            channel="sms",
            status="SIMULATED",
            suitability_score=0.72,
            channel_scores={"sms": 0.72, "email": 0.60, "whatsapp": 0.40},
            reason="The previous WHATSAPP notification was delivered but received no engagement. The system has deprioritized WHATSAPP and selected the next best available channel (SMS).",
            attempt_number=2,
            simulated=True,
            outcome="NO_ENGAGEMENT",
            delivery_status="DELIVERED",
            recipient=customers[3].phone,
            message_snippet="SMS escalation reminder delivered",
            created_at=now - timedelta(days=1),
        )
        db.add_all([comm_d_1, comm_d_2])
        case_d.selected_channel = "sms"
        case_d.notification_status = "SMS_SIMULATED"

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
            else:
                ml_decision = "COLD_START" if is_cold_start else ("HIGH" if prob >= 0.60 else "UNCERTAIN" if prob >= 0.40 else "LOW")
                
                if ml_decision == "LOW":
                    log_audit_event(db, case.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "The recovery probability is low. Only one recovery attempt is permitted.", "customer_message": "Please pay.", "confidence": prob, "source": "fallback"})
                    log_audit_event(db, case.id, "low_probability_routing", {"message": "Allowing 1 recovery attempt for LOW probability.", "max_retries": 1})
                    _simulate_execution(db, case)
                elif ml_decision == "UNCERTAIN":
                    log_audit_event(db, case.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "Recovery probability is uncertain, but a controlled automatic recovery attempt is recommended.", "customer_message": "Please pay.", "confidence": prob, "source": "fallback"})
                    log_audit_event(db, case.id, "uncertain_probability_routing", {"message": "Allowing 2 recovery attempts for UNCERTAIN probability.", "max_retries": 2})
                    _simulate_execution(db, case)
                else:  # HIGH or COLD_START
                    log_audit_event(db, case.id, "ai_analysis", {"recommended_action": "payment_link", "reasoning": "High recovery probability or COLD_START.", "customer_message": "Please pay.", "confidence": prob, "source": "fallback"})
                    _simulate_execution(db, case)

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

