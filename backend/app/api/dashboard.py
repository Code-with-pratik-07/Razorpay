from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.recovery import DashboardStats
from app.services.dashboard_service import at_risk_breakdown, dashboard_stats

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
def stats(db: Session = Depends(get_db)) -> DashboardStats:
    return DashboardStats(**dashboard_stats(db))


@router.get("/at-risk-breakdown")
def breakdown(db: Session = Depends(get_db)) -> dict[str, int]:
    return at_risk_breakdown(db)


@router.get("/trend")
def trend(db: Session = Depends(get_db)) -> list[dict[str, object]]:
    values = dashboard_stats(db)
    return [{"label": "Current", "at_risk": values["revenue_at_risk"], "recovered": values["revenue_recovered"]}]
