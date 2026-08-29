import os
from dotenv import load_dotenv
from app.services.razorpay_service import RazorpayService, RazorpayServiceError

load_dotenv("../.env")

try:
    svc = RazorpayService()
    # Bypass logic in the script itself just to test
    data = {"amount": 5000, "currency": "INR", "reference_id": "TEST_BYPASS", "description": "Payment recovery", "customer": {"name": "Customer", "email": "test@test.com", "contact": "9999999999"}}
    
    invoice_payload = {
        "type": "invoice",
        "description": data.get("description", "Secure payment recovery link"),
        "customer": data.get("customer", {}),
        "receipt": data.get("reference_id"),
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
    link = svc.client.invoice.create(invoice_payload)
    print("Success:", link.get("short_url"))
except Exception as e:
    cause = getattr(e, "__cause__", None)
    print("Error:", e, "| Cause:", cause)
