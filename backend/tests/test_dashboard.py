from fastapi.testclient import TestClient

from app.db.database import SessionLocal, init_db
from app.main import app
from app.models.payment_case import CaseStatus
from tests.helpers import create_case


def test_dashboard_stats_and_case_explanation(monkeypatch) -> None:
    monkeypatch.setenv("GROQ_API_KEY", "")
    init_db()
    with SessionLocal() as db:
        case = create_case(db, status=CaseStatus.FAILED)
        case_id = case.id
    with TestClient(app) as client:
        assert client.get("/api/dashboard/stats").status_code == 200
        explanation = client.post(f"/api/cases/{case_id}/analyze")
        assert explanation.status_code == 200
        assert "policy" in explanation.json()


def test_synthetic_experiment_is_labeled_and_uses_1000_cases() -> None:
    with TestClient(app) as client:
        response = client.post("/api/demo/run-experiment")
    assert response.status_code == 200
    assert response.json()["simulation"] == "Synthetic Simulation"
    assert response.json()["cases_processed"] == 1000
