from datetime import datetime, timezone
from typing import Annotated
from pydantic import PlainSerializer

def _serialize_datetime(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")

UTCDateTime = Annotated[datetime, PlainSerializer(_serialize_datetime, return_type=str)]
