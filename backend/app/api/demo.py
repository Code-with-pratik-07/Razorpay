import pandas as pd
import numpy as np

from fastapi import APIRouter

from app.ml.predict import load_model
from app.ml.train import MODEL_PATH
from app.schemas.recovery import ExperimentResult

router = APIRouter(prefix="/api/demo", tags=["demo"])


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
