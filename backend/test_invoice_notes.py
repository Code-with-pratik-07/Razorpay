import os
import uuid
from dotenv import load_dotenv
from app.services.razorpay_service import RazorpayService

load_dotenv("../.env")

try:
    svc = RazorpayService()
    case_id = "test-case-1234"
    invoice_payload = {
        "type": "invoice",
        "description": "Payment recovery",
        "notes": {"recoverai_case_id": case_id},
        "customer": {"name": "Customer", "email": "test@test.com", "contact": "9999999999"},
        "line_items": [{"name": "Recovery Payment", "amount": 5000, "currency": "INR", "quantity": 1}],
        "receipt": f"RECOVERAI-TEST-{uuid.uuid4().hex[:8]}"
    }
    
    inv = svc.client.invoice.create(invoice_payload)
    print("Invoice notes:", inv.get("notes"))
    
except Exception as e:
    cause = getattr(e, "__cause__", None)
    print("Error:", e, "| Cause:", cause)
