import os
import requests
from dotenv import load_dotenv

load_dotenv("../.env")
auth = (os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET"))
res = requests.get("https://api.razorpay.com/v1/payment_links", auth=auth)
data = res.json()
print("Total fetched:", len(data.get("items", [])))
