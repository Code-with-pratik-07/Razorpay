import razorpay
import os
from dotenv import load_dotenv
import json

load_dotenv()
client = razorpay.Client(auth=(os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")))

try:
    links = client.payment_link.all()
    print("Links:")
    print(json.dumps(links, indent=2))
except Exception as e:
    print(f"Error fetching links: {e}")
