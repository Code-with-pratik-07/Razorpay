import os
import requests
from dotenv import load_dotenv

load_dotenv("../.env")
auth = (os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET"))
res = requests.get("https://api.razorpay.com/v1/payment_links?count=100", auth=auth)
data = res.json()
print("Total fetched:", len(data.get("items", [])))
if len(data.get("items", [])) > 0:
    print("First item status:", data["items"][0].get("status"))
