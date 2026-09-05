"""Thin, exception-safe adapter around the official Razorpay Python SDK."""

from typing import Any

import razorpay

from app.core.config import get_settings


class RazorpayServiceError(RuntimeError):
    """Safe external-service error; callers must not expose provider internals."""


class RazorpayService:
    def __init__(self, client: Any | None = None) -> None:
        settings = get_settings()
        if client is not None:
            self.client = client
            return
        if not settings.razorpay_key_id or not settings.razorpay_key_secret:
            raise RazorpayServiceError("Razorpay Test Mode credentials are not configured.")
        self.client = razorpay.Client(auth=(settings.razorpay_key_id, settings.razorpay_key_secret))

    def create_order(self, amount: int, currency: str, receipt: str | None, notes: dict[str, str] | None) -> dict[str, Any]:
        payload: dict[str, Any] = {"amount": amount, "currency": currency}
        if receipt:
            payload["receipt"] = receipt
        if notes:
            payload["notes"] = notes
        try:
            return dict(self.client.order.create(payload))
        except Exception as exc:
            raise RazorpayServiceError("Unable to create Razorpay order.") from exc

    def fetch_payment(self, payment_id: str) -> dict[str, Any]:
        try:
            return dict(self.client.payment.fetch(payment_id))
        except Exception as exc:
            raise RazorpayServiceError("Unable to fetch Razorpay payment.") from exc

    def verify_checkout_signature(self, order_id: str, payment_id: str, signature: str) -> bool:
        payload = {
            "razorpay_order_id": order_id,
            "razorpay_payment_id": payment_id,
            "razorpay_signature": signature,
        }
        try:
            self.client.utility.verify_payment_signature(payload)
            return True
        except Exception as exc:
            raise RazorpayServiceError("Payment signature verification failed.") from exc

    def create_payment_link(self, data: dict[str, Any]) -> dict[str, Any]:
        """Create a documented Payment Link; it is not used to retry a payment.
        Uses the invoice API under the hood in test mode to bypass the hard 30-link limit.
        """
        try:
            invoice_payload = {
                "type": "invoice",
                "description": data.get("description", "Secure payment recovery link"),
                "customer": data.get("customer", {}),
                "line_items": [
                    {
                        "name": "Recovery Payment",
                        "description": data.get("description", ""),
                        "amount": data.get("amount", 0),
                        "currency": data.get("currency", "INR"),
                        "quantity": 1
                    }
                ]
            }
            if "reference_id" in data:
                invoice_payload["receipt"] = data["reference_id"]
            if "notes" in data:
                invoice_payload["notes"] = data["notes"]
                
            return dict(self.client.invoice.create(invoice_payload))
        except Exception as exc:
            error_details = str(exc)
            if hasattr(exc, 'args') and len(exc.args) > 0:
                error_details = str(exc.args[0])
            raise RazorpayServiceError(f"Unable to create Razorpay Payment Link: {error_details}") from exc

    def fetch_payment_link_or_invoice(self, link_id: str) -> dict[str, Any]:
        """Fetch payment link or invoice status from Razorpay."""
        try:
            if link_id.startswith("inv_"):
                return dict(self.client.invoice.fetch(link_id))
            elif link_id.startswith("plink_"):
                return dict(self.client.payment_link.fetch(link_id))
            return {}
        except Exception:
            return {}
