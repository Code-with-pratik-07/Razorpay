from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from app.schemas.common import UTCDateTime


AllowedAIAction = Literal["retry", "payment_link", "message", "escalate"]


class AIDecision(BaseModel):
    recommended_action: AllowedAIAction
    reasoning: str = Field(min_length=1, max_length=2000)
    customer_message: str | None = Field(default=None, max_length=1000)
    confidence: float = Field(ge=0, le=1)
    source: Literal["groq", "fallback", "demo"] = "fallback"


class CaseSummary(BaseModel):
    id: str
    case_number: str
    customer_email: str | None
    amount: int
    currency: str
    status: str
    failure_reason: str | None
    payment_method: str | None
    recovery_probability: float | None
    recovery_action: str
    retry_count: int
    max_retries: int
    policy_check_passed: bool | None
    policy_reason: str | None
    notification_status: str | None
    created_at: UTCDateTime
    last_payment_status: str | None = None
    last_payment_attempt_at: UTCDateTime | None = None
    last_payment_failure_reason: str | None = None
    payment_link_expires_at: UTCDateTime | None = None
    next_action_at: UTCDateTime | None = None
    next_action_type: str | None = None
    last_notification_at: UTCDateTime | None = None
    selected_channel: str | None = None

    model_config = ConfigDict(from_attributes=True)


class ChannelIntelligence(BaseModel):
    recommended_channel: str
    suitability_score: float
    channel_scores: dict[str, float]
    reason: str
    alternatives: list[str]
    status: str
    attempts_count: int = 0
    last_channel_used: str | None = None
    last_communicated_at: UTCDateTime | None = None


class CaseExplanation(CaseSummary):
    ml: dict[str, object]
    policy: dict[str, object]
    ai: AIDecision | None
    customer_history: dict[str, object]
    ml_decision: str | None = None  # "HIGH" | "UNCERTAIN" | "LOW" | "COLD_START" | None
    execution_error: str | None = None
    manual_execution: bool = False
    channel_intelligence: ChannelIntelligence | None = None


class ExecuteRecoveryResponse(BaseModel):
    case_id: str
    action: str
    status: str
    message: str
    payment_link_url: str | None = None


class DashboardStats(BaseModel):
    revenue_at_risk: int
    revenue_recovered: int
    recovery_rate: float
    cases_processed: int
    human_review_cases: int
    human_review_amount: int
    automatic_recoveries: int
    customer_payment_status: dict[str, int]


class ExperimentResult(BaseModel):
    simulation: Literal["Synthetic Simulation"] = "Synthetic Simulation"
    cases_processed: int
    revenue_at_risk: int
    cases_eligible: int
    recovery_attempts: int
    successful_recoveries: int
    revenue_recovered: int
    recovery_rate: float
    average_recovery_probability: float
    policy_blocked_cases: int
