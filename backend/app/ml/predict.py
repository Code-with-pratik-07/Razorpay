from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from app.ml.features import normalize_feature_record
from app.ml.train import MODEL_PATH, train_and_save_model


def recovery_potential_level(probability: float) -> str:
    if probability >= 0.70:
        return "HIGH RECOVERY POTENTIAL"
    if probability >= 0.40:
        return "MEDIUM RECOVERY POTENTIAL"
    return "LOW RECOVERY POTENTIAL"


def load_model(model_path: Path = MODEL_PATH):
    if not model_path.exists():
        train_and_save_model(model_path)
    return joblib.load(model_path)


def predict_recovery(feature_data: dict[str, Any], model_path: Path = MODEL_PATH) -> dict[str, Any]:
    record = normalize_feature_record(feature_data)
    pipeline = load_model(model_path)
    probability = float(pipeline.predict_proba(pd.DataFrame([record]))[0][1])
    return {
        "recovery_probability": round(probability, 4),
        "risk_level": recovery_potential_level(probability),
        "feature_summary": record,
    }
