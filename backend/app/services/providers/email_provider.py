from sqlalchemy.orm import Session
from app.models.payment_case import PaymentCase
from app.services.notification_service import send_recovery_email
from app.services.providers.base import BaseCommunicationProvider, ProviderResult


class EmailCommunicationProvider(BaseCommunicationProvider):
    """Email provider wrapping RecoverAI's email service (Resend or Mock Demo)."""

    def send(
        self,
        db: Session,
        case: PaymentCase,
        payment_link_url: str,
        message: str | None = None,
    ) -> ProviderResult:
        send_recovery_email(db, case, payment_link_url)
        status = case.notification_status or "SENT"
        simulated = status == "MOCKED"
        recipient = case.customer.email if case.customer else None

        return ProviderResult(
            success=status in {"SENT", "MOCKED"},
            channel="email",
            status=status,
            recipient=recipient,
            message_snippet=f"Payment recovery notice sent to {recipient}",
            provider="resend" if status == "SENT" else "mock_email",
            simulated=simulated,
        )
