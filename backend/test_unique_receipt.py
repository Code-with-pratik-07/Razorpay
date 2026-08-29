import os
import uuid
from dotenv import load_dotenv
from app.services.razorpay_service import RazorpayService

load_dotenv("../.env")

try:
    svc = RazorpayService()
    case_number = "DEMO-A-AUTO"
    data = {
        "amount": 5000, 
        "currency": "INR", 
        "reference_id": f"RECOVERAI-{case_number}-{uuid.uuid4().hex[:8]}", 
        "description": "Payment recovery", 
        "customer": {"name": "Customer", "email": "test@test.com", "contact": "9999999999"}
    }
    
    link = svc.create_payment_link(data)
    print("Success! Unique URL:", link.get("short_url"))
except Exception as e:
    cause = getattr(e, "__cause__", None)
    print("Error:", e, "| Cause:", cause)
