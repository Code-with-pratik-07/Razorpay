import hashlib
import hmac


def verify_razorpay_webhook_signature(raw_body: bytes, signature: str | None, webhook_secret: str) -> bool:
    """Timing-safe verification over the exact, unparsed webhook request bytes."""
    if not signature or not webhook_secret:
        return False
    expected = hmac.new(webhook_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def create_test_webhook_signature(raw_body: bytes, webhook_secret: str) -> str:
    """Development/test-only helper; never expose the secret through an API."""
    return hmac.new(webhook_secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
