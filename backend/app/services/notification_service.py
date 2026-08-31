import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.payment_case import PaymentCase
from app.services.audit_service import log_audit_event

_REASON_MAP = {
    "insufficient_funds": "Your payment could not be completed because there were insufficient funds available.",
    "card_expired": "Your bank declined this transaction because the card has expired.",
    "network_timeout": "We could not complete your payment because of a temporary network issue. Please try again.",
    "bank_declined": "Your bank declined this transaction.",
    "fraud_suspicion": "Your bank declined this transaction for security reasons.",
}


def _build_email_html(case: PaymentCase, payment_link_url: str) -> str:
    """Build the recovery email HTML body. Used by both the real sender and the demo preview."""
    failure_msg = _REASON_MAP.get(
        case.failure_reason or "",
        "We could not complete your payment. Please use the secure link below to try again.",
    )
    amount_str = (
        f"₹{case.amount / 100:,.2f}" if case.currency == "INR"
        else f"{case.currency} {case.amount / 100:,.2f}"
    )
    order_ref = case.razorpay_order_id or case.case_number
    return f"""
<div style="font-family:sans-serif;max-width:540px;margin:0 auto;">
  <h2 style="color:#1a1a2e;">Payment Recovery Notice</h2>
  <p>Hi,</p>
  <p>Your payment for <strong>Order #{order_ref}</strong> could not be completed.</p>
  <p><strong>Amount:</strong> {amount_str}</p>
  <p style="color:#555;">{failure_msg}</p>
  <p>You can securely complete your payment using the button below:</p>
  <p>
    <a href="{payment_link_url}"
       style="display:inline-block;padding:12px 24px;background-color:#6c63ff;
              color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">
      Complete Payment
    </a>
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
  <p style="color:#aaa;font-size:12px;">Thank you,<br>RecoverAI Team</p>
</div>"""


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
        # Demo/development mode — store the full generated email in the audit log so it
        # can be previewed from the dashboard without claiming a real send occurred.
        case.notification_status = "MOCKED"
        db.commit()
        log_audit_event(db, case.id, "email_notification_mocked", {
            "reason": "Email service not configured",
            "email_html_preview": _build_email_html(case, payment_link_url),
            "recipient": case.customer.email,
            "payment_link_url": payment_link_url,
        })
        return

    html_content = _build_email_html(case, payment_link_url)
    payload = {
        "from": settings.email_from,
        "to": [case.customer.email],
        "subject": f"Action Required: Payment failed for Order #{case.razorpay_order_id or case.case_number}",
        "html": html_content,
    }
    try:
        response = httpx.post(
            "https://api.resend.com/emails",
            json=payload,
            headers={"Authorization": f"Bearer {settings.email_provider_api_key}"},
            timeout=10.0,
        )
        response.raise_for_status()
        case.notification_status = "SENT"
        db.commit()
        log_audit_event(db, case.id, "email_notification_sent", {"provider": "resend", "status_code": response.status_code})
    except Exception as e:
        case.notification_status = "FAILED"
        db.commit()
        log_audit_event(db, case.id, "email_notification_failed", {"provider": "resend", "error": str(e)})
