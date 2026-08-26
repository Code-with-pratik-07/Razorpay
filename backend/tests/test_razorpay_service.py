import pytest

from app.services.razorpay_service import RazorpayService, RazorpayServiceError


class FailingOrders:
    def create(self, _payload):
        raise RuntimeError("provider unavailable")


class FailingClient:
    order = FailingOrders()


def test_razorpay_api_exception_is_wrapped_safely() -> None:
    service = RazorpayService(client=FailingClient())
    with pytest.raises(RazorpayServiceError, match="Unable to create Razorpay order"):
        service.create_order(10000, "INR", "receipt-1", None)
