from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from app.schemas.common import UTCDateTime


AllowedAIAction = Literal["retry", "payment_link", "message", "escalate", "none"]


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


class DecisionBasisItem(BaseModel):
    factor: str
    impact: Literal["positive", "negative", "neutral"]
    description: str


class DecisionFactorSummary(BaseModel):
    name: str
    status: str
    score: float  # 0.0 to 1.0 for UI progress bars


class FollowupDecision(BaseModel):
    previous_outcome: str | None = None
    recommended_wait_period: str = "None"
    next_action: str
    selected_channel: str | None = None
    reason: str


class CommunicationAttemptSummary(BaseModel):
    id: str | None = None
    attempt_number: int
    channel: str
    status: str
    outcome: str
    simulated: bool
    recipient: str | None = None
    message_snippet: str | None = None
    recovery_attributed: bool = False
    created_at: UTCDateTime | None = None


class ChannelIntelligence(BaseModel):
    communication_maturity: Literal["COLD_START", "LEARNING", "ESTABLISHED"] = "COLD_START"
    maturity_description: str = "Learning communication preferences"
    recommended_channel: str
    suitability_score: float
    confidence: Literal["low", "medium", "high"] = "medium"
    confidence_score: float = 0.55
    reason: str
    decision_basis: list[DecisionBasisItem] = Field(default_factory=list)
    decision_factors: list[DecisionFactorSummary] = Field(default_factory=list)
    channel_scores: dict[str, float]
    alternatives: list[str]
    status: str
    attempts_count: int = 0
    last_channel_used: str | None = None
    last_communicated_at: UTCDateTime | None = None
    communication_journey: list[CommunicationAttemptSummary] = Field(default_factory=list)
    opted_out_channels: list[str] = Field(default_factory=list)
    attributed_channel: str | None = None
    followup_decision: FollowupDecision | None = None


class CaseExplanation(CaseSummary):
    ml: dict[str, object]
    policy: dict[str, object]
    ai: AIDecision | None
    customer_history: dict[str, object]
    ml_decision: str | None = None  # "HIGH" | "UNCERTAIN" | "LOW" | "COLD_START" | None
    execution_error: str | None = None
    manual_execution: bool = False
    channel_intelligence: ChannelIntelligence | None = None
    human_review_status: Literal["NOT_REQUIRED", "REQUIRED", "APPROVED", "REJECTED"] = "NOT_REQUIRED"
    payment_link_status: Literal["ACTIVE", "EXPIRED", "PAID", "NONE"] = "NONE"
    communication_status: Literal["PAUSED", "READY", "GENERATED", "SENT", "SIMULATED", "NOT_AVAILABLE", "COMPLETED", "FAILED", "EXHAUSTED"] = "PAUSED"
    customer_payment_status: Literal["PENDING", "RECEIVED", "EXHAUSTED", "FAILED", "NONE"] = "NONE"
    recommended_channel: str = "email"
    dispatched_channel: str | None = None


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
