import pandas as pd
import numpy as np

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.ml.predict import load_model
from app.ml.train import MODEL_PATH
from app.schemas.recovery import ExperimentResult
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
    success: bool

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



@router.post("/simulate-failure")
def simulate_payment_failure(body: SimulateFailureRequest | None = None):
    """Simulate a payment.failed event and run the full automatic recovery pipeline.

    This is the primary demo action. It creates a realistic customer + failed PaymentCase,
    then executes the real ML prediction → policy check → Groq advisory → routing pipeline.
    No mocking. If DEMO_MODE=true and Razorpay credentials are set, a real Razorpay Test
    Mode invoice is generated for HIGH-confidence cases.
    """
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
    from datetime import datetime, timezone
    from app.db.database import SessionLocal
    from app.models.payment_case import PaymentCase, CaseStatus, NextActionType
    from app.services.audit_service import log_audit_event
    from app.models.customer import Customer

    from sqlalchemy import select

    with SessionLocal() as db:
        case = db.scalar(
            select(PaymentCase).options(joinedload(PaymentCase.customer)).where(PaymentCase.id == case_id)
        )
        if not case:
            raise HTTPException(status_code=404, detail="Case not found.")

        now = datetime.now(timezone.utc).replace(tzinfo=None)

        if payload.success:
            if case.status in {CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED}:
                return {"success": True, "payment_result": "already_terminal", "case_status": case.status.value, "message": "Case is already in a terminal state."}
            
            case.status = CaseStatus.RECOVERED
            case.recovered_at = now
            case.next_action_type = NextActionType.NONE
            case.next_action_at = None
            
            case.last_payment_status = "SUCCESS"
            case.last_payment_attempt_at = now
            case.last_payment_failure_reason = None

            if case.customer:
                case.customer.successful_payments += 1
                case.customer.lifetime_value += case.amount
            
            db.commit()
            log_audit_event(db, case.id, "payment_success", {"simulated": True, "event": "simulate_payment"})
            log_audit_event(db, case.id, "case_recovered", {"simulated": True, "order_id": case.razorpay_order_id})
            
            return {"success": True, "payment_result": "success", "case_status": case.status.value, "message": "Simulated payment successful."}
        
        else:
            if case.status in {CaseStatus.RECOVERED, CaseStatus.ABANDONED, CaseStatus.CLOSED}:
                return {"success": True, "payment_result": "already_terminal", "case_status": case.status.value, "message": "Case is already in a terminal state."}

            case.last_payment_status = "FAILED"
            case.last_payment_attempt_at = now
            case.last_payment_failure_reason = "Simulated payment failure"

            log_audit_event(db, case.id, "payment_failed_simulated", {
                "source": "simulated_payment_page",
                "success": False,
                "payment_method": case.payment_method,
                "failure_reason": "simulated_payment_failure",
                "retry_count": case.retry_count,
                "max_retries": case.max_retries
            })
            
            # We don't increment retry_count or change status here, preserving the scheduler's logic.
            db.commit()
            return {
                "success": True, 
                "payment_result": "failed", 
                "case_status": case.status.value, 
                "message": "Payment failure recorded successfully. Recovery will continue according to the scheduled workflow."
            }


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
