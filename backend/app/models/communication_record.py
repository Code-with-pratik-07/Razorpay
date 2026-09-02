import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class CommunicationRecord(Base):
    __tablename__ = "communication_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_id: Mapped[str] = mapped_column(ForeignKey("payment_cases.id"), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(30), nullable=False)  # "email", "sms", "whatsapp"
    status: Mapped[str] = mapped_column(String(50), nullable=False)  # "RECOMMENDED", "SENT", "SIMULATED", "POLICY_BLOCKED", "COMPLETED", "ATTEMPT_LIMIT_REACHED", "FAILED"
    suitability_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    channel_scores: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    reason: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    attempt_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    simulated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recipient: Mapped[str | None] = mapped_column(String(255), nullable=True)
    message_snippet: Mapped[str | None] = mapped_column(String(500), nullable=True)
    outcome: Mapped[str] = mapped_column(String(50), nullable=False, default="SENT")  # PENDING, SENT, DELIVERED, OPENED, CLICKED, RESPONDED, PAYMENT_COMPLETED, FAILED, IGNORED, OPTED_OUT
    delivery_status: Mapped[str] = mapped_column(String(50), nullable=False, default="DELIVERED")
    recovery_attributed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc).replace(tzinfo=None),
        nullable=False,
    )

    payment_case = relationship("PaymentCase", back_populates="communication_records")
