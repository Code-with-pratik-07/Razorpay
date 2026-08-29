import os
from dotenv import load_dotenv

load_dotenv()
print("Without arg:", os.getenv("RAZORPAY_KEY_ID"))

load_dotenv("../.env")
print("With arg:", os.getenv("RAZORPAY_KEY_ID"))
