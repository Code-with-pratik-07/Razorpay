import json

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.security import verify_razorpay_webhook_signature
from app.db.database import SessionLocal
from app.models.webhook_log import WebhookLog
from app.workers.webhook_worker import process_webhook_event

router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/razorpay", status_code=status.HTTP_200_OK)
async def razorpay_webhook(request: Request, background_tasks: BackgroundTasks) -> dict[str, str]:
    raw_body = await request.body()
    signature = request.headers.get("x-razorpay-signature")
    if not verify_razorpay_webhook_signature(raw_body, signature, get_settings().razorpay_webhook_secret):
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")
    try:
        payload = json.loads(raw_body)
    except (TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Malformed webhook payload.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Malformed webhook payload.")
    event_id = request.headers.get("x-razorpay-event-id")
    if not event_id:
        raise HTTPException(status_code=400, detail="Missing webhook event ID.")
    event_type = payload.get("event")
    if not isinstance(event_type, str) or not event_type:
        raise HTTPException(status_code=400, detail="Webhook event type is missing.")

    with SessionLocal() as db:
        event = WebhookLog(event_id=event_id, event_type=event_type, raw_payload=payload)
        db.add(event)
        try:
            db.commit()  # Durable record before acknowledging Razorpay.
            db.refresh(event)
        except IntegrityError:
            db.rollback()
            return {"status": "duplicate_ignored"}
        background_tasks.add_task(process_webhook_event, event.id)
    return {"status": "accepted"}
