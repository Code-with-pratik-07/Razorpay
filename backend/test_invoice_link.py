import os
from dotenv import load_dotenv
from razorpay import Client

load_dotenv("../.env")
client = Client(auth=(os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")))

try:
    payload = {
        "type": "link",
        "description": "Secure payment recovery link",
        "amount": 5000,
        "currency": "INR",
        "customer": {
            "name": "Test",
            "email": "test@example.com",
            "contact": "9999999999"
        }
    }
    link = client.invoice.create(payload)
    print("Success:", link.get("short_url"))
except Exception as e:
    print("Error:", e)
