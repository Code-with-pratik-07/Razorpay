import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.database import Base


class RecoveryPolicy(Base):
    __tablename__ = "recovery_policies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    max_retry_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    max_recovery_window_days: Mapped[int] = mapped_column(Integer, default=7, nullable=False)
    max_auto_recovery_amount: Mapped[int] = mapped_column(Integer, default=500000, nullable=False, comment="Paise; ₹5,000")
    min_time_between_retries_hours: Mapped[int] = mapped_column(Integer, default=24, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
