import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


class CaseStatus(str, enum.Enum):
    FAILED = "failed"
    ABANDONED = "abandoned"
    ANALYZING = "analyzing"
    RECOVERING = "recovering"
    RECOVERED = "recovered"
    CLOSED = "closed"
    HUMAN_REVIEW = "human_review"


class RecoveryAction(str, enum.Enum):
    RETRY = "retry"
    PAYMENT_LINK = "payment_link"
    MESSAGE = "message"
    ESCALATE = "escalate"
    NONE = "none"


class PaymentCase(Base):
    __tablename__ = "payment_cases"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    case_number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id"), nullable=False, index=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    razorpay_order_id: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False, comment="Smallest currency unit (paise)")
    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    status: Mapped[CaseStatus] = mapped_column(default=CaseStatus.FAILED, nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    recovery_probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    recovery_action: Mapped[RecoveryAction] = mapped_column(default=RecoveryAction.NONE, nullable=False)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_retries: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    last_retry_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now(timezone.utc).replace(tzinfo=None), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now(timezone.utc).replace(tzinfo=None), onupdate=datetime.now(timezone.utc).replace(tzinfo=None), nullable=False)
    recovered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    policy_check_passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    policy_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    customer = relationship("Customer", back_populates="payment_cases")
    audit_events = relationship("AuditEvent", back_populates="payment_case")
