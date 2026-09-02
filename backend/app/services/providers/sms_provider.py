from sqlalchemy.orm import Session
from app.models.payment_case import PaymentCase
from app.services.audit_service import log_audit_event
from app.services.providers.base import BaseCommunicationProvider, ProviderResult


class SimulatedSMSProvider(BaseCommunicationProvider):
    """Simulated SMS provider for demonstration and testing."""

    def send(
        self,
        db: Session,
        case: PaymentCase,
        payment_link_url: str,
        message: str | None = None,
    ) -> ProviderResult:
        if not (case.customer and case.customer.phone):
            case.notification_status = "NOT_AVAILABLE"
            db.commit()
            return ProviderResult(
                success=False,
                channel="sms",
                status="NOT_AVAILABLE",
                recipient=None,
                message_snippet="No customer phone number available for SMS.",
                provider="simulated_sms",
                simulated=True,
            )

        recipient = case.customer.phone
        order_ref = case.razorpay_order_id or case.case_number
        amount_fmt = f"₹{case.amount / 100:,.2f}" if case.currency == "INR" else f"{case.currency} {case.amount / 100:,.2f}"

        sms_body = message or f"RecoverAI Alert: Payment of {amount_fmt} for Order #{order_ref} failed. Tap to complete securely: {payment_link_url}"

        log_audit_event(db, case.id, "sms_notification_simulated", {
            "channel": "sms",
            "recipient": recipient,
            "message": sms_body,
            "payment_link_url": payment_link_url,
            "simulated": True,
            "note": "Simulated for Demo — Real SMS gateway not yet connected.",
        })

        case.notification_status = "SMS_SIMULATED"
        db.commit()

        return ProviderResult(
            success=True,
            channel="sms",
            status="SIMULATED",
            recipient=recipient,
            message_snippet=sms_body[:100] + ("..." if len(sms_body) > 100 else ""),
            provider="simulated_sms",
            simulated=True,
            details={"message": sms_body},
        )
