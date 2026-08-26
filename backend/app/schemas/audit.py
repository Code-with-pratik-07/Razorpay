from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditEventRead(BaseModel):
    id: str
    case_id: str
    event_type: str
    event_data: dict[str, Any]
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
