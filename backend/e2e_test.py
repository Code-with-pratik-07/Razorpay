import os
import json
from datetime import datetime, timezone
from sqlalchemy import select
from app.db.database import SessionLocal
from app.models.payment_case import PaymentCase, CaseStatus, RecoveryAction
from app.models.customer import Customer
from app.services.demo_service import simulate_failure_event
from app.services.audit_service import list_audit_events
from app.workers.webhook_worker import _process_recovered

print("Running E2E validation...")

with SessionLocal() as db:
    # 1. HIGH Confidence
    high_res = simulate_failure_event(amount=250000, successful_payments=100)
    print(f"\nHIGH Confidence Case:")
    case_high = db.get(PaymentCase, high_res['case_id'])
    print(f"ID: {case_high.id}")
    print(f"Probability: {case_high.recovery_probability}")
    print(f"Status: {case_high.status.value}")
    
    events_high = list_audit_events(db, case_high.id)
    payment_link_event = next((e for e in events_high if e.event_type == 'payment_link_created'), None)
    payment_link_url = payment_link_event.event_data.get('url') if payment_link_event else None
    print(f"Payment Link: {payment_link_url}")
    
    email_event = next((e for e in events_high if e.event_type == 'email_notification_skipped'), None)
    if email_event:
        print("Email status: EMAIL MOCKED")
        html = email_event.event_data.get('email_html_preview', '')
        has_amount = '250000' in html or '2,500' in html
        has_currency = 'INR' in html
        has_button = 'Complete Payment' in html
        has_link = payment_link_url in html if payment_link_url else False
        print(f"Email contains amount/curr/button/link: {has_amount}, {has_currency}, {has_button}, {has_link}")
    
    # Simulate payment success webhook
    print("Simulating Razorpay payment.captured...")
    payload = {
        "payload": {
            "payment": {
                "entity": {
                    "id": case_high.razorpay_payment_id,
                    "order_id": case_high.razorpay_order_id,
                    "status": "captured",
                    "amount": case_high.amount,
                    "currency": case_high.currency
                }
            }
        }
    }
    _process_recovered(db, payload, "payment.captured")
    
    db.refresh(case_high)
    print(f"Post-webhook Status: {case_high.status.value}")
    print(f"Recovered At: {case_high.recovered_at}")
    customer = db.get(Customer, case_high.customer_id)
    print(f"Customer Success count: {customer.successful_payments}")

    # 2. UNCERTAIN Confidence
    uncertain_res = simulate_failure_event(amount=250000, successful_payments=2)
    print(f"\nUNCERTAIN Confidence Case:")
    case_unc = db.get(PaymentCase, uncertain_res['case_id'])
    print(f"Probability: {case_unc.recovery_probability}")
    print(f"Status: {case_unc.status.value}")
    events_unc = list_audit_events(db, case_unc.id)
    has_link_unc = any(e.event_type == 'payment_link_created' for e in events_unc)
    print(f"Has Payment Link: {has_link_unc}")

    # 3. LOW Confidence
    low_res = simulate_failure_event(amount=250000, successful_payments=0)
    print(f"\nLOW Confidence Case:")
    case_low = db.get(PaymentCase, low_res['case_id'])
    print(f"Probability: {case_low.recovery_probability}")
    print(f"Status: {case_low.status.value}")
    events_low = list_audit_events(db, case_low.id)
    has_link_low = any(e.event_type == 'payment_link_created' for e in events_low)
    print(f"Has Payment Link: {has_link_low}")

