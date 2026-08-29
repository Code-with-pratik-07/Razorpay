import os
import requests
from dotenv import load_dotenv

load_dotenv()
auth = (os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET"))
res = requests.get("https://api.razorpay.com/v1/payment_links", auth=auth)
import json
print(json.dumps(res.json(), indent=2))
