from typing import Any

from pydantic import BaseModel, Field, field_validator


class CreateOrderRequest(BaseModel):
    amount: int = Field(ge=100, le=100_000_000, description="Amount in paise")
    currency: str = Field(default="INR", min_length=3, max_length=3)
    receipt: str | None = Field(default=None, max_length=40)
    notes: dict[str, str] | None = None

    @field_validator("currency")
    @classmethod
    def supported_currency(cls, currency: str) -> str:
        normalized = currency.upper()
        if normalized != "INR":
            raise ValueError("Only INR is supported in the current Test Mode flow.")
        return normalized


class CheckoutVerificationRequest(BaseModel):
    razorpay_order_id: str = Field(min_length=1, max_length=100)
    razorpay_payment_id: str = Field(min_length=1, max_length=100)
    razorpay_signature: str = Field(min_length=1, max_length=256)


class SafeOrderResponse(BaseModel):
    id: str
    amount: int
    currency: str
    receipt: str | None
    status: str | None
    created_at: int | None


class PaymentVerificationResponse(BaseModel):
    verified: bool
    payment_id: str
    order_id: str


class CheckoutConfigResponse(BaseModel):
    """Public configuration that Razorpay Checkout requires in the browser."""

    key_id: str
