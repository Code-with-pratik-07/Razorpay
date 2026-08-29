from app.services.razorpay_service import RazorpayService, RazorpayServiceError
try:
    link = RazorpayService().create_payment_link({"amount": 5000, "currency": "INR", "reference_id": "TEST2", "description": "Secure payment recovery link", "customer": {"name": "Test", "email": "test@example.com", "contact": "9999999999"}})
    print("Success:", link)
except RazorpayServiceError as e:
    cause = e.__cause__
    print("Error:", cause)
