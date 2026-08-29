import os
from dotenv import load_dotenv
from razorpay import Client

load_dotenv("../.env")
client = Client(auth=(os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")))

try:
    payload = {
        "type": "invoice",
        "description": "Secure payment recovery link",
        "customer": {
            "name": "Test",
            "email": "test@example.com",
            "contact": "9999999999"
        },
        "line_items": [
            {
                "name": "Recovery Payment",
                "description": "Payment recovery",
                "amount": 5000,
                "currency": "INR",
                "quantity": 1
            }
        ]
    }
    link = client.invoice.create(payload)
    print("Success:", link.get("short_url"))
except Exception as e:
    cause = getattr(e, "__cause__", None)
    print("Error:", e, "| Cause:", cause)
