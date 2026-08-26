from app.ml.features import RecoveryFeatureEncoder
from app.ml.predict import predict_recovery
from app.ml.train import train_and_save_model


FEATURES = {
    "amount": 149900,
    "customer_lifetime_value": 30000.0,
    "customer_successful_payments": 8,
    "customer_failed_payments": 1,
    "time_since_failure": 3.0,
    "payment_method": "upi",
    "failure_count": 1,
    "failure_reason": "network_timeout",
    "customer_age_days": 220,
}


def test_training_creates_reusable_pipeline(tmp_path) -> None:
    model_path = train_and_save_model(tmp_path / "recoverai-model.joblib", samples=5000)
    assert model_path.exists()
    result = predict_recovery(FEATURES, model_path)
    assert 0.0 <= result["recovery_probability"] <= 1.0
    assert result["risk_level"] in {
        "HIGH RECOVERY POTENTIAL", "MEDIUM RECOVERY POTENTIAL", "LOW RECOVERY POTENTIAL",
    }


def test_feature_preprocessing_is_consistent() -> None:
    encoder = RecoveryFeatureEncoder().fit([FEATURES])
    first = encoder.transform([FEATURES])
    second = encoder.transform([FEATURES.copy()])
    assert first.tolist() == second.tolist()
    assert first[0][5] == 1.0  # upi
    assert first[0][7] == 2.0  # network_timeout
