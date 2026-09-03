import pandas as pd
import numpy as np

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.ml.predict import load_model
from app.ml.train import MODEL_PATH
from app.schemas.recovery import CaseSummary, ExperimentResult
from app.core.config import get_settings
from app.services.demo_service import seed_demo_data, simulate_failure_event

router = APIRouter(prefix="/api/demo", tags=["demo"])


class DemoStatus(BaseModel):
    demo_mode_enabled: bool

class SimulateFailureRequest(BaseModel):
    amount: int | None = None
    failure_reason: str | None = None
    payment_method: str | None = None
    successful_payments: int | None = None

class SimulatePaymentRequest(BaseModel):
    success: bool = True
    payment_method: str | None = None
    status: str | None = None
    failure_reason: str | None = None
    amount: int | None = None

@router.get("/status", response_model=DemoStatus)
def get_demo_status():
    settings = get_settings()
    return DemoStatus(demo_mode_enabled=settings.demo_mode)

@router.post("/reset")
def reset_demo_data():
    settings = get_settings()
    if not settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo mode is disabled. Destructive actions are forbidden."
        )
    seed_demo_data(reset=True)
    return {"message": "Demo database successfully reset and seeded."}

@router.post("/simulate-failure", response_model=CaseSummary)
def simulate_failure(body: SimulateFailureRequest | None = None):
    """Simulate a payment.failed event and run the full automatic recovery pipeline."""
    settings = get_settings()
    if not settings.demo_mode:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Demo mode is disabled. Simulated failure events are only available in demo mode.",
        )
    req = body or SimulateFailureRequest()
    result = simulate_failure_event(
        amount=req.amount,
        failure_reason=req.failure_reason,
        payment_method=req.payment_method,
        successful_payments=req.successful_payments,
    )
    return result


@router.post("/simulate-payment/{case_id}")
def simulate_payment(case_id: str, payload: SimulatePaymentRequest):
    from sqlalchemy.orm import joinedload
    from app.db.database import SessionLocal
    from app.models.payment_case import PaymentCase
    from app.services.recovery_service import record_payment_attempt
    from sqlalchemy import select

    with SessionLocal() as db:
        case = db.scalar(
            select(PaymentCase).options(joinedload(PaymentCase.customer)).where(PaymentCase.id == case_id)
        )
        if not case:
            raise HTTPException(status_code=404, detail="Case not found.")

        effective_status = payload.status or ("success" if payload.success else "failed")
        method = payload.payment_method or case.payment_method or "card"
        reason = payload.failure_reason if payload.failure_reason else ("Simulated payment failure" if effective_status == "failed" else None)

        result = record_payment_attempt(
            db=db,
            case=case,
            payment_method=method,
            status=effective_status,
            failure_reason=reason,
            amount=payload.amount,
        )
        return result


@router.post("/run-experiment", response_model=ExperimentResult)
def run_experiment() -> ExperimentResult:
    """Synthetic Simulation only: no Groq or Razorpay calls are performed."""
    rng = np.random.default_rng(9); cases = 1000; risk = recovered = eligible = attempts = blocked = successful = 0; probabilities = []; model = load_model(MODEL_PATH)
    for _ in range(cases):
        amount = int(rng.integers(10_000, 800_000)); risk += amount
        features = {"amount": amount, "customer_lifetime_value": float(rng.integers(0, 200_000)), "customer_successful_payments": int(rng.integers(0, 30)), "customer_failed_payments": int(rng.integers(0, 8)), "time_since_failure": float(rng.integers(0, 240)), "payment_method": str(rng.choice(["card", "upi", "netbanking"])), "failure_count": int(rng.integers(0, 8)), "failure_reason": str(rng.choice(["insufficient_funds", "card_expired", "network_timeout", "fraud_suspicion", "bank_declined"])), "customer_age_days": int(rng.integers(1, 1000))}
        probability = float(model.predict_proba(pd.DataFrame([features]))[0][1]); probabilities.append(probability)
        allowed = amount <= 500_000 and features["time_since_failure"] <= 168 and features["failure_count"] < 3
        if not allowed: blocked += 1; continue
        eligible += 1
        if probability >= .4:
            attempts += 1
            if rng.random() < probability:
                recovered += amount; successful += 1
    return ExperimentResult(cases_processed=cases, revenue_at_risk=risk, cases_eligible=eligible, recovery_attempts=attempts, successful_recoveries=successful, revenue_recovered=recovered, recovery_rate=round(recovered / risk, 4), average_recovery_probability=round(float(np.mean(probabilities)), 4), policy_blocked_cases=blocked)
