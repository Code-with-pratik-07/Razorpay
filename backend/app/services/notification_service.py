import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.payment_case import PaymentCase
from app.services.audit_service import log_audit_event


def send_mock_recovery_message(db: Session, case_id: str, message: str) -> None:
    """Records a simulated notification only; no real SMS, email, or WhatsApp is sent."""
    log_audit_event(db, case_id, "recovery_message_generated", {"channel": "mock", "message": message, "simulated": True})


def send_recovery_email(db: Session, case: PaymentCase, payment_link_url: str) -> None:
    settings = get_settings()

    if not case.customer or not case.customer.email:
        case.notification_status = "NOT_AVAILABLE"
        db.commit()
        log_audit_event(db, case.id, "email_notification_failed", {"reason": "Customer email not available"})
        return

    if not settings.email_enabled or not settings.email_provider_api_key:
        case.notification_status = "NOT_SENT"
        db.commit()
        log_audit_event(db, case.id, "email_notification_skipped", {"reason": "Email service not configured"})
        return

    reason_map = {
        "insufficient_funds": "Your payment could not be completed because there were insufficient funds available.",
        "card_expired": "Your bank declined this transaction because the card has expired.",
        "network_timeout": "We could not complete your payment because of a temporary issue. Please try again.",
        "bank_declined": "Your bank declined this transaction.",
        "fraud_suspicion": "Your bank declined this transaction for security reasons."
    }

    failure_msg = reason_map.get(case.failure_reason, "We could not complete your payment. Please try again using the secure payment link below.")
    amount_str = f"₹{case.amount / 100:,.2f}" if case.currency == "INR" else f"{case.currency} {case.amount / 100:,.2f}"

    html_content = f"""
    <p>Hi,</p>
    <p>Your payment for Order #{case.razorpay_order_id or case.case_number} could not be completed.</p>
    <p><strong>Amount:</strong> {amount_str}</p>
    <p>{failure_msg}</p>
    <p>You can securely complete your payment using the button below:</p>
    <p><a href="{payment_link_url}" style="display:inline-block;padding:10px 20px;background-color:#0070f3;color:#fff;text-decoration:none;border-radius:5px;">Complete Payment</a></p>
    <p>Thank you,<br>RecoverAI Team</p>
    """

    payload = {
        "from": settings.email_from,
        "to": [case.customer.email],
        "subject": f"Action Required: Payment failed for Order #{case.razorpay_order_id or case.case_number}",
        "html": html_content
    }

    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            json=payload,
            headers={"Authorization": f"Bearer {settings.email_provider_api_key}"},
            timeout=10.0
        )
        response.raise_for_status()
        case.notification_status = "SENT"
        db.commit()
        log_audit_event(db, case.id, "email_notification_sent", {"provider": "resend", "status_code": response.status_code})
    except Exception as e:
        case.notification_status = "FAILED"
        db.commit()
        log_audit_event(db, case.id, "email_notification_failed", {"provider": "resend", "error": str(e)})
