import os
import time
import requests
from dotenv import load_dotenv

load_dotenv("../.env")
auth = (os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET"))
res = requests.get("https://api.razorpay.com/v1/payment_links?count=100", auth=auth)
data = res.json()

count = 0
for item in data.get("items", []):
    if item.get("status") == "created":
        print(f"Expiring {item['id']}")
        payload = {"expire_by": int(time.time()) + 120} # 2 mins from now
        patch_res = requests.patch(f"https://api.razorpay.com/v1/payment_links/{item['id']}", auth=auth, json=payload)
        if patch_res.status_code == 200:
            count += 1
        else:
            print(f"Failed to expire {item['id']}: {patch_res.text}")

print(f"Expired {count} links.")
