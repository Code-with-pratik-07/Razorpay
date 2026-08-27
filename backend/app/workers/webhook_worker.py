"""Fast, idempotent processing of already verified and durably stored webhooks."""

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.models.customer import Customer
from app.models.payment_case import CaseStatus, PaymentCase
from app.models.webhook_log import WebhookLog
from app.services.audit_service import log_audit_event
from app.services.recovery_service import analyze_case


def _entity(payload: dict[str, Any], name: str) -> dict[str, Any]:
    entity = payload.get("payload", {}).get(name, {}).get("entity", {})
    return entity if isinstance(entity, dict) else {}


def _find_or_create_customer(db: Session, payment: dict[str, Any]) -> Customer:
    razorpay_customer_id = payment.get("customer_id")
    email, phone = payment.get("email"), payment.get("contact")
    criteria = []
    if razorpay_customer_id:
        criteria.append(Customer.razorpay_customer_id == razorpay_customer_id)
    if email:
        criteria.append(Customer.email == email)
    if phone:
        criteria.append(Customer.phone == phone)
    customer = db.scalar(select(Customer).where(or_(*criteria))) if criteria else None
    if customer:
        return customer
    customer = Customer(razorpay_customer_id=razorpay_customer_id, email=email, phone=phone)
    db.add(customer)
    db.flush()
    return customer


def _find_case(db: Session, payment_id: str | None, order_id: str | None) -> PaymentCase | None:
    clauses = []
    if payment_id:
        clauses.append(PaymentCase.razorpay_payment_id == payment_id)
    if order_id:
        clauses.append(PaymentCase.razorpay_order_id == order_id)
    return db.scalar(select(PaymentCase).where(or_(*clauses))) if clauses else None


def _process_failed(db: Session, payload: dict[str, Any]) -> None:
    payment = _entity(payload, "payment")
    if not payment.get("id") and not payment.get("order_id"):
        raise ValueError("payment.failed payload is missing payment and order identifiers")
    payment_id, order_id = payment.get("id"), payment.get("order_id")
    case = _find_case(db, payment_id, order_id)
    if case is None:
        customer = _find_or_create_customer(db, payment)
        # Increment failed payments on the customer for new case creation only.
        # The existing webhook idempotency (unique event_id) already prevents the
        # _process_failed path from running twice for the same event. But guard
        # here against a second *different* failed event for the same payment by
        # only incrementing in the new-case branch, not the existing-case branch.
        customer.failed_payments += 1
        case = PaymentCase(
            case_number=f"RPA-{uuid.uuid4().hex[:20]}", customer_id=customer.id,
            razorpay_payment_id=payment_id, razorpay_order_id=order_id,
            amount=int(payment.get("amount", 0)), currency=payment.get("currency", "INR"),
            failure_reason=payment.get("error_reason") or payment.get("error_code"),
            payment_method=payment.get("method"), status=CaseStatus.FAILED,
        )
        db.add(case)
        db.commit()
        db.refresh(case)
        log_audit_event(db, case.id, "failure_detected", {"payment_id": payment_id, "order_id": order_id})
        log_audit_event(db, case.id, "case_created", {"source": "razorpay_webhook"})
        analyze_case(db, case)
        return
    case.razorpay_payment_id = payment_id or case.razorpay_payment_id
    case.razorpay_order_id = order_id or case.razorpay_order_id
    case.status = CaseStatus.FAILED
    db.commit()


def _process_recovered(db: Session, payload: dict[str, Any], event_type: str) -> None:
    payment, order = _entity(payload, "payment"), _entity(payload, "order")
    payment_id = payment.get("id")
    order_id = payment.get("order_id") or order.get("id")
    case = _find_case(db, payment_id, order_id)
    if case is None:
        return  # Events can arrive out of order; a later failed event will create the case.
    confirmed = (event_type == "payment.captured" and payment.get("status") == "captured") or (
        event_type == "order.paid" and order.get("status") == "paid"
    )
    if not confirmed or case.status == CaseStatus.RECOVERED:
        return
    case.razorpay_payment_id = payment_id or case.razorpay_payment_id
    case.razorpay_order_id = order_id or case.razorpay_order_id
    case.status = CaseStatus.RECOVERED
    case.recovered_at = datetime.now(timezone.utc).replace(tzinfo=None)
    # Update customer lifetime stats now that a payment has been confirmed.
    # The guard above (case.status == CaseStatus.RECOVERED) ensures this only
    # runs once per case — the second call for an already-recovered case returns
    # early before reaching this point.
    customer = db.get(Customer, case.customer_id)
    if customer is not None:
        customer.successful_payments += 1
        customer.lifetime_value += case.amount
    db.commit()
    log_audit_event(db, case.id, "payment_success", {"event": event_type, "payment_id": payment_id})
    log_audit_event(db, case.id, "case_recovered", {"order_id": order_id})


def process_webhook_event(webhook_log_id: str) -> None:
    with SessionLocal() as db:
        log = db.get(WebhookLog, webhook_log_id)
        if log is None or log.processed:
            return
        try:
            if log.event_type == "payment.failed":
                _process_failed(db, log.raw_payload)
            elif log.event_type in {"payment.captured", "order.paid"}:
                _process_recovered(db, log.raw_payload, log.event_type)
            else:
                log.error_message = "Unsupported event ignored."
            log.processed = True
            log.processed_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.commit()
        except Exception as exc:
            db.rollback()
            log = db.get(WebhookLog, webhook_log_id)
            if log:
                log.error_message = str(exc)[:1000]
                log.processed_at = datetime.now(timezone.utc).replace(tzinfo=None)
                db.commit()
