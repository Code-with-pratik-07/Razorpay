from sqlalchemy.orm import Session
from app.models.payment_case import PaymentCase
from app.services.audit_service import log_audit_event
from app.services.providers.base import BaseCommunicationProvider, ProviderResult


class SimulatedWhatsAppProvider(BaseCommunicationProvider):
    """Simulated WhatsApp Business provider for demonstration and testing."""

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
                channel="whatsapp",
                status="NOT_AVAILABLE",
                recipient=None,
                message_snippet="No customer phone number available for WhatsApp.",
                provider="simulated_whatsapp",
                simulated=True,
            )

        recipient = case.customer.phone
        order_ref = case.razorpay_order_id or case.case_number
        amount_fmt = f"₹{case.amount / 100:,.2f}" if case.currency == "INR" else f"{case.currency} {case.amount / 100:,.2f}"

        wa_body = message or (
            f"Hello, we noticed your payment of {amount_fmt} for Order #{order_ref} could not be completed.\n\n"
            f"You can securely complete your payment with 1-click here:\n{payment_link_url}\n\n"
            f"— RecoverAI Support"
        )

        log_audit_event(db, case.id, "whatsapp_notification_simulated", {
            "channel": "whatsapp",
            "recipient": recipient,
            "message": wa_body,
            "payment_link_url": payment_link_url,
            "simulated": True,
            "note": "Simulated for Demo — Real WhatsApp Business API not yet connected.",
        })

        case.notification_status = "WHATSAPP_SIMULATED"
        db.commit()

        return ProviderResult(
            success=True,
            channel="whatsapp",
            status="SIMULATED",
            recipient=recipient,
            message_snippet=wa_body[:100] + ("..." if len(wa_body) > 100 else ""),
            provider="simulated_whatsapp",
            simulated=True,
            details={"message": wa_body},
        )
