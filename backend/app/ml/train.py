from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.pipeline import Pipeline

from app.ml.features import FAILURE_REASON_ENCODING, PAYMENT_METHOD_ENCODING, RecoveryFeatureEncoder

MODEL_PATH = Path(__file__).with_name("model.joblib")


def generate_training_data(samples: int = 5000, seed: int = 42) -> tuple[pd.DataFrame, np.ndarray]:
    rng = np.random.default_rng(seed)
    methods = np.array(list(PAYMENT_METHOD_ENCODING))
    reasons = np.array(list(FAILURE_REASON_ENCODING))
    frame = pd.DataFrame({
        "amount": rng.integers(10_000, 1_000_000, size=samples),
        "customer_lifetime_value": rng.uniform(0, 250_000, size=samples),
        "customer_successful_payments": rng.integers(0, 50, size=samples),
        "customer_failed_payments": rng.integers(0, 12, size=samples),
        "time_since_failure": rng.uniform(0, 168, size=samples),
        "payment_method": rng.choice(methods, size=samples),
        "failure_count": rng.integers(0, 12, size=samples),
        "failure_reason": rng.choice(reasons, size=samples),
        "customer_age_days": rng.integers(1, 2500, size=samples),
    })
    score = (
        0.75 * (frame.customer_successful_payments / 50)
        + 0.45 * (frame.customer_lifetime_value / 250_000)
        - 0.65 * (frame.customer_failed_payments / 12)
        - 0.45 * (frame.failure_count / 12)
        - 0.35 * (frame.time_since_failure / 168)
        - 0.25 * (frame.amount / 1_000_000)
        + np.where(frame.failure_reason.eq("network_timeout"), 0.25, 0)
        - np.where(frame.failure_reason.eq("fraud_suspicion"), 0.55, 0)
        + rng.normal(0, 0.12, size=samples)
    )
    labels = (score > 0.25).astype(int)
    return frame, labels


def build_pipeline() -> Pipeline:
    return Pipeline([
        ("features", RecoveryFeatureEncoder()),
        ("classifier", GradientBoostingClassifier(random_state=42, n_estimators=120, max_depth=3)),
    ])


def train_and_save_model(model_path: Path = MODEL_PATH, samples: int = 5000) -> Path:
    features, labels = generate_training_data(samples=samples)
    pipeline = build_pipeline()
    pipeline.fit(features, labels)
    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(pipeline, model_path)
    return model_path
