"""Feature preparation shared verbatim by ML training and inference."""

from typing import Any

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, TransformerMixin

FEATURE_COLUMNS = [
    "amount", "customer_lifetime_value", "customer_successful_payments",
    "customer_failed_payments", "time_since_failure", "payment_method",
    "failure_count", "failure_reason", "customer_age_days",
]
PAYMENT_METHOD_ENCODING = {"card": 0, "upi": 1, "netbanking": 2}
FAILURE_REASON_ENCODING = {
    "insufficient_funds": 0, "card_expired": 1, "network_timeout": 2,
    "fraud_suspicion": 3, "bank_declined": 4,
}


class RecoveryFeatureEncoder(BaseEstimator, TransformerMixin):
    """Sklearn-compatible, deterministic feature encoding with safe unknown values."""

    def fit(self, x: Any, y: Any = None) -> "RecoveryFeatureEncoder":
        return self

    def transform(self, x: Any) -> np.ndarray:
        frame = pd.DataFrame(x).copy()
        missing = set(FEATURE_COLUMNS) - set(frame.columns)
        if missing:
            raise ValueError(f"Missing required feature fields: {', '.join(sorted(missing))}")
        frame = frame[FEATURE_COLUMNS]
        frame["payment_method"] = frame["payment_method"].map(PAYMENT_METHOD_ENCODING).fillna(-1)
        frame["failure_reason"] = frame["failure_reason"].map(FAILURE_REASON_ENCODING).fillna(-1)
        return frame.astype(float).to_numpy()


def normalize_feature_record(feature_data: dict[str, Any]) -> dict[str, Any]:
    """Keep API and internal input keys constrained to the model contract."""
    return {name: feature_data[name] for name in FEATURE_COLUMNS}
