"""Deterministic recovery guardrails used by every future recovery action."""

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

from app.models.payment_case import CaseStatus, PaymentCase
from app.models.recovery_policy import RecoveryPolicy


@dataclass(frozen=True)
class PolicyCheckResult:
    allowed: bool
    reason: str
    requires_human_approval: bool
    retry_after: datetime | None = None

    def to_dict(self) -> dict[str, object]:
        result = asdict(self)
        if self.retry_after is not None:
            result["retry_after"] = self.retry_after.isoformat()
        return result


def check_recovery_policy(case: PaymentCase, policy: RecoveryPolicy, *, now: datetime | None = None) -> PolicyCheckResult:
    """Return the sole policy verdict for an automated recovery action.

    Amounts are stored in paise, so the default 500000 policy ceiling is ₹5,000.
    The ordering is intentional: terminal states and invalid payment data are never
    made eligible by a lower amount or a strong ML score.
    """
    current_time = now or datetime.utcnow()
    if case.status == CaseStatus.RECOVERED:
        return PolicyCheckResult(False, "Case is already recovered.", False)
    if case.status == CaseStatus.CLOSED:
        return PolicyCheckResult(False, "Case is closed.", False)
    if case.status == CaseStatus.RECOVERING:
        return PolicyCheckResult(False, "Recovery is already in progress for this case.", False)
    if case.status == CaseStatus.HUMAN_REVIEW:
        return PolicyCheckResult(False, "Case requires human review; automated recovery is not permitted.", True)
    if not case.razorpay_payment_id and not case.razorpay_order_id:
        return PolicyCheckResult(False, "Valid payment or order information is required.", True)
    if case.amount <= 0:
        return PolicyCheckResult(False, "Payment amount must be positive.", True)
    if case.currency != "INR":
        return PolicyCheckResult(False, "Only INR recovery cases are currently supported.", True)
    if case.amount > policy.max_auto_recovery_amount:
        return PolicyCheckResult(False, "Amount exceeds the automatic recovery limit.", True)
    if case.retry_count >= policy.max_retry_attempts:
        return PolicyCheckResult(False, "Maximum retry attempts reached.", True)
    if current_time - case.created_at > timedelta(days=policy.max_recovery_window_days):
        return PolicyCheckResult(False, "Recovery window has expired.", True)
    if case.last_retry_at is not None:
        retry_after = case.last_retry_at + timedelta(hours=policy.min_time_between_retries_hours)
        if current_time < retry_after:
            return PolicyCheckResult(False, "Retry cooldown is active.", False, retry_after)
    return PolicyCheckResult(True, "Recovery action is permitted by policy.", False)
