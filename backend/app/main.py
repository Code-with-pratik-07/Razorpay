from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.api.audit import router as audit_router
from app.api.model import router as model_router
from app.api.payments import router as payments_router
from app.api.webhooks import router as webhooks_router
from app.api.cases import router as cases_router
from app.api.dashboard import router as dashboard_router
from app.api.demo import router as demo_router
from app.core.config import get_settings
from app.db.database import init_db

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-Razorpay-Signature", "X-Razorpay-Event-Id"],
)
app.include_router(health_router)
app.include_router(audit_router)
app.include_router(model_router)
app.include_router(payments_router)
app.include_router(webhooks_router)
app.include_router(cases_router)
app.include_router(dashboard_router)
app.include_router(demo_router)


@app.on_event("startup")
def startup() -> None:
    init_db()
