import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.database import Base


def generate_ordered_id() -> str:
    return f"{time.time_ns():016x}-{uuid.uuid4().hex[:19]}"

class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=generate_ordered_id)
    case_id: Mapped[str] = mapped_column(ForeignKey("payment_cases.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    event_data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.now(timezone.utc).replace(tzinfo=None), nullable=False)
    payment_case = relationship("PaymentCase", back_populates="audit_events")
