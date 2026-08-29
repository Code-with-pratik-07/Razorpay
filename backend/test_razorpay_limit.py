from app.services.razorpay_service import RazorpayService, RazorpayServiceError
import json

try:
    link = RazorpayService().create_payment_link({"amount": 5000, "currency": "INR", "reference_id": "TEST1", "description": "Secure payment recovery link"})
    print("Success:", link)
except RazorpayServiceError as e:
    import traceback
    cause = e.__cause__
    if hasattr(cause, 'error'):
        print("Error cause:", cause)
    if hasattr(cause, 'response'):
        resp = getattr(cause, 'response')
        if hasattr(resp, 'json'):
            print("Response JSON:", json.dumps(resp.json(), indent=2))
        else:
            print("Response text:", resp.text)
    else:
        print("No response attribute on cause", dir(cause))
