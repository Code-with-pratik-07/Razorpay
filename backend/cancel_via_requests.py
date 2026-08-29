import os
import requests
from dotenv import load_dotenv

load_dotenv("../.env")
key_id = os.getenv("RAZORPAY_KEY_ID")
key_secret = os.getenv("RAZORPAY_KEY_SECRET")

auth = (key_id, key_secret)
res = requests.get("https://api.razorpay.com/v1/payment_links?count=100", auth=auth)
data = res.json()
print("Total items fetched:", len(data.get("items", [])))

count = 0
for item in data.get("items", []):
    if item.get("status") in ["created", "issued"]:
        print(f"Canceling {item['id']}")
        cancel_res = requests.post(f"https://api.razorpay.com/v1/payment_links/{item['id']}/cancel", auth=auth)
        if cancel_res.status_code == 200:
            count += 1
        else:
            print(f"Failed to cancel {item['id']}: {cancel_res.text}")

print(f"Canceled {count} links.")
