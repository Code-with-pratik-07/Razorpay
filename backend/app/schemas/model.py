from pydantic import BaseModel, Field


class ModelTrainingResult(BaseModel):
    samples_trained: int
    model_path: str


class ModelPredictionRequest(BaseModel):
    amount: int = Field(gt=0, description="Amount in paise")
    customer_lifetime_value: float = Field(ge=0)
    customer_successful_payments: int = Field(ge=0)
    customer_failed_payments: int = Field(ge=0)
    time_since_failure: float = Field(ge=0, description="Hours")
    payment_method: str
    failure_count: int = Field(ge=0)
    failure_reason: str
    customer_age_days: int = Field(ge=0)


class ModelPredictionResult(BaseModel):
    recovery_probability: float
    risk_level: str
    feature_summary: dict[str, int | float | str]
