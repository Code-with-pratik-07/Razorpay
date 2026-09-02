from abc import ABC, abstractmethod
from typing import Any
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.models.payment_case import PaymentCase


class ProviderResult(BaseModel):
    success: bool
    channel: str
    status: str  # "SENT", "SIMULATED", "FAILED", "NOT_AVAILABLE"
    recipient: str | None = None
    message_snippet: str | None = None
    provider: str
    simulated: bool = False
    error: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)


class BaseCommunicationProvider(ABC):
    """Abstract base class for channel communication providers."""

    @abstractmethod
    def send(
        self,
        db: Session,
        case: PaymentCase,
        payment_link_url: str,
        message: str | None = None,
    ) -> ProviderResult:
        """Send or simulate a communication message to the customer."""
        pass
