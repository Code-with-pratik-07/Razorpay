from fastapi import APIRouter, HTTPException, status

from app.core.config import get_settings
from app.schemas.payment import (
    CheckoutConfigResponse,
    CheckoutVerificationRequest,
    CreateOrderRequest,
    PaymentVerificationResponse,
    SafeOrderResponse,
)
from app.services.razorpay_service import RazorpayService, RazorpayServiceError

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.get("/checkout-config", response_model=CheckoutConfigResponse)
def checkout_config() -> CheckoutConfigResponse:
    """Expose only Razorpay's browser-safe public key ID, never a secret."""
    key_id = get_settings().razorpay_key_id
    if not key_id:
        raise HTTPException(status_code=503, detail="Razorpay Test Mode key ID is not configured.")
    return CheckoutConfigResponse(key_id=key_id)


@router.post("/create-order", response_model=SafeOrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(payload: CreateOrderRequest) -> SafeOrderResponse:
    try:
        order = RazorpayService().create_order(payload.amount, payload.currency, payload.receipt, payload.notes)
    except RazorpayServiceError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return SafeOrderResponse(
        id=order["id"], amount=order["amount"], currency=order["currency"],
        receipt=order.get("receipt"), status=order.get("status"), created_at=order.get("created_at"),
    )


@router.post("/verify", response_model=PaymentVerificationResponse)
def verify_payment(payload: CheckoutVerificationRequest) -> PaymentVerificationResponse:
    try:
        RazorpayService().verify_checkout_signature(
            payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature
        )
    except RazorpayServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # A valid checkout signature is not by itself persisted as a successful payment.
    # Signed webhooks (and later a payment fetch where needed) remain the source of truth.
    return PaymentVerificationResponse(
        verified=True, payment_id=payload.razorpay_payment_id, order_id=payload.razorpay_order_id
    )
