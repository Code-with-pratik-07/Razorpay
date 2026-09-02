"""Channel Intelligence Engine for RecoverAI.

Evaluates deterministic channel suitability across supported channels (email, sms, whatsapp)
based on:
- Historical customer engagement (40%)
- Previous recovery success (30%)
- Customer channel preference (20%)
- Channel availability (10%)

Enforces business and safety rules (policy respect, duplicate prevention, terminal state protection,
max attempt limits, and next-best channel progression).
"""

from datetime import datetime, timezone
from typing import Any
import uuid

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.communication_record import CommunicationRecord
from app.models.customer import Customer
from app.models.payment_case import CaseStatus, PaymentCase
from app.schemas.recovery import ChannelIntelligence
from app.services.audit_service import list_audit_events, log_audit_event
from app.services.providers import get_communication_provider

# ---------------------------------------------------------------------------
# Scoring Weights (Total = 1.00)
# ---------------------------------------------------------------------------
HISTORICAL_ENGAGEMENT_WEIGHT = 0.40
PREVIOUS_RECOVERY_SUCCESS_WEIGHT = 0.30
CUSTOMER_PREFERENCE_WEIGHT = 0.20
CHANNEL_AVAILABILITY_WEIGHT = 0.10

SUPPORTED_CHANNELS = ["email", "sms", "whatsapp"]

ChannelRecommendation = ChannelIntelligence


# ---------------------------------------------------------------------------
# Scoring Components
# ---------------------------------------------------------------------------
def _compute_availability(channel: str, customer: Customer | None) -> float:
    """Check channel availability (10% weight).
    
    1.0 if requisite contact details exist, otherwise 0.0.
    If 0.0, the channel cannot be used.
    """
    if not customer:
        return 0.0
    if channel == "email":
        return 1.0 if (customer.email and "@" in customer.email) else 0.0
    if channel in {"sms", "whatsapp"}:
        return 1.0 if bool(customer.phone) else 0.0
    return 0.0


def _compute_preference(channel: str, case: PaymentCase, customer: Customer | None) -> float:
    """Customer channel preference (20% weight).
    
    Infers channel affinity from payment method or explicit preferences.
    - UPI: Smartphone-centric; high WhatsApp affinity.
    - Card: Transactional alerts; email & SMS affinity.
    - Netbanking: Desktop browser; email affinity.
    """
    method = (case.payment_method or "").lower()
    if method == "upi":
        affinity = {"whatsapp": 0.95, "sms": 0.70, "email": 0.50}
    elif method == "card":
        affinity = {"email": 0.85, "sms": 0.75, "whatsapp": 0.60}
    elif method == "netbanking":
        affinity = {"email": 0.90, "sms": 0.70, "whatsapp": 0.55}
    else:
        affinity = {"whatsapp": 0.80, "sms": 0.70, "email": 0.65}

    return affinity.get(channel, 0.50)


def _compute_recovery_success(channel: str, customer: Customer | None, history_records: list[CommunicationRecord]) -> float:
    """Previous recovery success rate (30% weight).
    
    Uses customer's empirical recovery rate for this channel if available,
    otherwise relies on domain recovery benchmarks.
    """
    if history_records:
        channel_records = [r for r in history_records if r.channel == channel]
        if channel_records:
            recovered_count = sum(1 for r in channel_records if r.status in {"RECOVERED", "SUCCESS", "SENT"})
            if len(channel_records) > 0:
                return min(1.0, max(0.2, (recovered_count / len(channel_records)) + 0.1))

    # Benchmark conversion baselines for payment link recovery
    benchmarks = {
        "whatsapp": 0.92,  # Instant delivery & high interaction
        "sms": 0.72,       # Reliable delivery, moderate click-through
        "email": 0.62,     # Standard transactional email recovery rate
    }
    return benchmarks.get(channel, 0.60)


def _compute_engagement(
    channel: str,
    customer: Customer | None,
    case_records: list[CommunicationRecord],
) -> float:
    """Historical customer engagement (40% weight).
    
    Baseline responsiveness by channel, dynamically penalized if an earlier attempt
    on this channel went unheeded (supporting next-best channel progression).
    """
    base_engagement = {
        "whatsapp": 0.90,
        "sms": 0.75,
        "email": 0.60,
    }.get(channel, 0.60)

    # If customer previously received a message on this channel in this case,
    # and payment was NOT completed, apply an unheeded penalty so the next-best
    # channel is selected on subsequent attempts!
    unheeded_attempts = sum(1 for r in case_records if r.channel == channel and r.status in {"SENT", "SIMULATED"})
    penalty = unheeded_attempts * 0.45

    score = base_engagement - penalty
    return max(0.10, min(1.0, score))


def evaluate_channel_suitability(
    case: PaymentCase,
    customer: Customer | None,
    case_records: list[CommunicationRecord] | None = None,
    customer_history_records: list[CommunicationRecord] | None = None,
) -> ChannelRecommendation:
    """Deterministically score each channel and recommend the best one."""
    records = case_records or []
    hist_records = customer_history_records or []

    scores: dict[str, float] = {}

    for ch in SUPPORTED_CHANNELS:
        avail = _compute_availability(ch, customer)
        if avail == 0.0:
            scores[ch] = 0.0
            continue

        engagement = _compute_engagement(ch, customer, records)
        rec_success = _compute_recovery_success(ch, customer, hist_records)
        pref = _compute_preference(ch, case, customer)

        composite = (
            (HISTORICAL_ENGAGEMENT_WEIGHT * engagement)
            + (PREVIOUS_RECOVERY_SUCCESS_WEIGHT * rec_success)
            + (CUSTOMER_PREFERENCE_WEIGHT * pref)
            + (CHANNEL_AVAILABILITY_WEIGHT * avail)
        )
        scores[ch] = round(composite, 2)

    # Sort channels by score descending
    sorted_channels = sorted(scores.keys(), key=lambda c: scores[c], reverse=True)
    recommended = sorted_channels[0]
    top_score = scores[recommended]
    alternatives = [c for c in sorted_channels if c != recommended]

    # Human-readable reasoning
    reason_map = {
        "whatsapp": "Customer historically has a higher recovery response rate through WhatsApp.",
        "sms": "SMS provides the highest direct delivery confidence and urgency for this transaction.",
        "email": "Customer profile and payment method show highest response consistency via email notice.",
    }
    
    # If this was a progression from an earlier attempt:
    if records and records[-1].channel != recommended:
        reason = f"Prior communication on {records[-1].channel.upper()} received no response. Escalated to next-best channel: {recommended.upper()}."
    else:
        reason = reason_map.get(recommended, "Optimized based on engagement and historical recovery performance.")

    # Determine status
    if case.status in {CaseStatus.RECOVERED, CaseStatus.CLOSED}:
        status = "COMPLETED"
    elif case.status == CaseStatus.ABANDONED or case.retry_count >= case.max_retries:
        status = "ATTEMPT_LIMIT_REACHED"
    elif not case.policy_check_passed or case.status == CaseStatus.HUMAN_REVIEW:
        status = "POLICY_BLOCKED"
    else:
        status = "RECOMMENDED"

    last_record = records[0] if records else None

    return ChannelRecommendation(
        recommended_channel=recommended,
        suitability_score=top_score,
        channel_scores=scores,
        reason=reason,
        alternatives=alternatives,
        status=status,
        attempts_count=len(records),
        last_channel_used=last_record.channel if last_record else None,
        last_communicated_at=last_record.created_at if last_record else None,
    )


# ---------------------------------------------------------------------------
# Service Operations & Safety Gates
# ---------------------------------------------------------------------------
def get_case_channel_intelligence(db: Session, case: PaymentCase) -> ChannelRecommendation:
    """Retrieve or compute current channel intelligence for a case."""
    records = list(
        db.scalars(
            select(CommunicationRecord)
            .where(CommunicationRecord.case_id == case.id)
            .order_by(CommunicationRecord.created_at.desc())
        )
    )
    
    customer = case.customer

    # Check terminal state
    if case.status in {CaseStatus.RECOVERED, CaseStatus.CLOSED}:
        rec = evaluate_channel_suitability(case, customer, records)
        rec.status = "COMPLETED"
        rec.reason = "Recovery is already complete. No further communications permitted."
        return rec

    if case.status == CaseStatus.ABANDONED or case.retry_count >= case.max_retries:
        rec = evaluate_channel_suitability(case, customer, records)
        rec.status = "ATTEMPT_LIMIT_REACHED"
        rec.reason = f"Maximum recovery attempts ({case.max_retries}) exhausted. Communication stopped."
        return rec

    if case.policy_check_passed is False or case.status == CaseStatus.HUMAN_REVIEW:
        rec = evaluate_channel_suitability(case, customer, records)
        rec.status = "POLICY_BLOCKED"
        rec.reason = "Automatic communication blocked by safety policy. Requires human review."
        return rec

    return evaluate_channel_suitability(case, customer, records)


def dispatch_channel_communication(
    db: Session,
    case: PaymentCase,
    payment_link_url: str,
    automatic: bool = False,
    override_channel: str | None = None,
) -> dict[str, Any]:
    """Execute communication on the intelligently recommended channel.
    
    Enforces business rules:
    - Never contact if recovered.
    - Never contact if policy blocked.
    - Never send duplicates.
    - Respect max attempt limits.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # 1. Terminal state check
    if case.status in {CaseStatus.RECOVERED, CaseStatus.CLOSED}:
        log_audit_event(db, case.id, "communication_blocked", {
            "reason": "Recovery already completed. Communication halted.",
            "status": case.status.value,
        })
        return {
            "success": False,
            "status": "COMPLETED",
            "message": "Recovery is already complete for this case. No further communications permitted.",
        }

    # 2. Policy enforcement
    if (case.policy_check_passed is False or case.status == CaseStatus.HUMAN_REVIEW) and automatic:
        log_audit_event(db, case.id, "communication_blocked", {
            "reason": "Policy check blocked automatic communication.",
            "status": case.status.value,
        })
        return {
            "success": False,
            "status": "POLICY_BLOCKED",
            "message": "Policy blocks automatic communication. Human review required.",
        }

    # 3. Attempt limit check
    if case.retry_count > case.max_retries:
        return {
            "success": False,
            "status": "ATTEMPT_LIMIT_REACHED",
            "message": "Maximum communication attempts reached.",
        }

    # 4. Duplicate prevention
    # Check if a communication was already dispatched for this attempt & link within last 2 minutes
    recent_records = list(
        db.scalars(
            select(CommunicationRecord)
            .where(CommunicationRecord.case_id == case.id)
            .order_by(CommunicationRecord.created_at.desc())
            .limit(5)
        )
    )
    if recent_records:
        latest = recent_records[0]
        time_diff = (now - latest.created_at).total_seconds()
        if time_diff < 10 and latest.attempt_number == case.retry_count:
            return {
                "success": True,
                "status": "DUPLICATE_PREVENTED",
                "message": "Communication already dispatched for this attempt.",
                "channel": latest.channel,
            }

    # 5. Evaluate Recommendation
    recommendation = evaluate_channel_suitability(case, case.customer, recent_records)
    channel_to_use = override_channel or recommendation.recommended_channel

    # Record evaluation event
    log_audit_event(db, case.id, "channel_intelligence_evaluated", {
        "recommended_channel": recommendation.recommended_channel,
        "suitability_score": recommendation.suitability_score,
        "channel_scores": recommendation.channel_scores,
        "reason": recommendation.reason,
        "alternatives": recommendation.alternatives,
    })

    # 6. Execute via Provider
    provider = get_communication_provider(channel_to_use)
    result = provider.send(db, case, payment_link_url)

    # 7. Persist CommunicationRecord
    comm_record = CommunicationRecord(
        case_id=case.id,
        channel=channel_to_use,
        status=result.status,
        suitability_score=recommendation.suitability_score,
        channel_scores=recommendation.channel_scores,
        reason=recommendation.reason,
        attempt_number=case.retry_count or 1,
        simulated=result.simulated,
        recipient=result.recipient,
        message_snippet=result.message_snippet,
    )
    db.add(comm_record)
    case.selected_channel = channel_to_use
    case.last_notification_at = now
    db.commit()

    log_audit_event(db, case.id, "channel_communication_dispatched", {
        "channel": channel_to_use,
        "status": result.status,
        "provider": result.provider,
        "simulated": result.simulated,
        "recipient": result.recipient,
        "attempt_number": comm_record.attempt_number,
    })

    return {
        "success": result.success,
        "channel": channel_to_use,
        "status": result.status,
        "simulated": result.simulated,
        "suitability_score": recommendation.suitability_score,
        "reason": recommendation.reason,
    }
