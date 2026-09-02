from typing import Any

from pydantic import BaseModel, ConfigDict
from app.schemas.common import UTCDateTime

class AuditEventRead(BaseModel):
    id: str
    case_id: str
    event_type: str
    event_data: dict[str, Any]
    timestamp: UTCDateTime

    model_config = ConfigDict(from_attributes=True)
