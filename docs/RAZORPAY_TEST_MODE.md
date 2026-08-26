# Razorpay Test Mode manual integration

This document describes a manual Test Mode check; it has not been run without supplied Test Mode credentials.

1. Copy `.env.example` to `.env` and provide `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and a unique `RAZORPAY_WEBHOOK_SECRET`.
2. From `backend/`, run `./.venv/bin/python -m uvicorn app.main:app --reload`.
3. Call `POST /api/payments/create-order` with an INR amount in paise (minimum 100). Use the returned order ID in Razorpay Standard Checkout with the Test Mode key ID.
4. Complete a Test Mode payment in Checkout. The frontend handler must send `razorpay_order_id`, `razorpay_payment_id` and `razorpay_signature` to `POST /api/payments/verify`.
5. Expose `/webhooks/razorpay` on a publicly reachable HTTPS URL. Razorpay webhooks require an accessible endpoint; configure it in Test Mode Dashboard → Account & Settings → Webhooks and subscribe to `payment.failed`, `payment.captured` and `order.paid`.
6. Perform failure and success test transactions. Inspect `webhook_logs`, `payment_cases` and the case audit endpoint to confirm the signed events were recorded and processed.

Payment verification only validates the Checkout signature. A signed `payment.captured` or `order.paid` webhook is what updates an associated recovery case to recovered. The application does not implement a direct payment retry; Razorpay's Payments API does not collect/retry payments. Payment Links are the supported future recovery path.
