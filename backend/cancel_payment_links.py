import razorpay
import os
from dotenv import load_dotenv

load_dotenv()
client = razorpay.Client(auth=(os.getenv("RAZORPAY_KEY_ID"), os.getenv("RAZORPAY_KEY_SECRET")))

try:
    links = client.payment_link.all()
    count = 0
    for item in links.get('items', []):
        if item.get('status') in ['created', 'issued']:
            print(f"Canceling {item['id']}")
            try:
                client.payment_link.cancel(item['id'])
                count += 1
            except Exception as e:
                print(f"Failed to cancel {item['id']}: {e}")
    print(f"Canceled {count} links.")
except Exception as e:
    print(f"Error fetching links: {e}")
