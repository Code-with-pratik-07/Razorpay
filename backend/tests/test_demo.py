import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import get_settings
from app.db.database import get_db

client = TestClient(app)

def test_demo_status_endpoint():
    response = client.get("/api/demo/status")
    assert response.status_code == 200
    data = response.json()
    assert "demo_mode_enabled" in data
    # By default in test environment it should be False (or whatever is set in .env)
    assert data["demo_mode_enabled"] == get_settings().demo_mode

def test_demo_reset_disabled():
    # Force DEMO_MODE = False
    get_settings().demo_mode = False
    response = client.post("/api/demo/reset")
    assert response.status_code == 403
    assert "forbidden" in response.json()["detail"].lower()

def test_demo_reset_enabled():
    # Force DEMO_MODE = True
    get_settings().demo_mode = True
    # The endpoint should succeed and return a message
    response = client.post("/api/demo/reset")
    assert response.status_code == 200
    assert "successfully reset" in response.json()["message"]

    # Verify that data was actually seeded
    cases_response = client.get("/api/cases?limit=1")
    assert cases_response.status_code == 200
    assert len(cases_response.json()) > 0

    # Reset DEMO_MODE to avoid leaking state
    get_settings().demo_mode = False
