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
    cases_response = client.get("/api/cases?limit=100")
    assert cases_response.status_code == 200
    cases = cases_response.json()
    assert len(cases) > 0

    # Verify showcase cases are present deterministically
    case_numbers = [c["case_number"] for c in cases]
    assert "DEMO-A-AUTO" in case_numbers
    assert "DEMO-B-HUMAN" in case_numbers
    assert "DEMO-C-RECOVERED" in case_numbers
    assert "DEMO-D-STOPPED" in case_numbers

    # Reset DEMO_MODE to avoid leaking state
    get_settings().demo_mode = False
def test_demo_showcase_inconsistencies(monkeypatch):
    monkeypatch.setenv("RAZORPAY_KEY_ID", "rzp_test_123")
    monkeypatch.setenv("RAZORPAY_KEY_SECRET", "secret")
    class DummyRazorpayService:
        def create_payment_link(self, data):
            return {"id": "plink_demo", "short_url": "https://rzp.io/rzp/real_demo_link"}
    monkeypatch.setattr("app.services.recovery_service.RazorpayService", lambda *args, **kwargs: DummyRazorpayService())

    get_settings().demo_mode = True
    client.post("/api/demo/reset")
    
    cases_response = client.get("/api/cases?limit=100")
    cases = cases_response.json()
    
    demo_a = next(c for c in cases if c["case_number"] == "DEMO-A-AUTO")
    assert demo_a["status"] == "recovering"
    
    # Check audit logs for DEMO-A
    audit_a = client.get(f"/api/cases/{demo_a['id']}/audit").json()
    ai_event_a = next(e for e in audit_a if e["event_type"] == "ai_analysis")
    assert ai_event_a["event_data"]["recommended_action"] == "payment_link"
    link_event_a = next(e for e in audit_a if e["event_type"] == "payment_link_created")
    assert "demo_mock" not in link_event_a["event_data"]["url"]
    
    email_event_a = next((e for e in audit_a if e["event_type"] == "email_notification_skipped"), None)
    if email_event_a:
        assert "real_demo_link" in email_event_a["event_data"]["email_html_preview"]

    # DEMO-B
    demo_b = next(c for c in cases if c["case_number"] == "DEMO-B-HUMAN")
    assert demo_b["status"] == "human_review"
    assert demo_b["amount"] == 2500000 # 25,000 blocks auto
    audit_b = client.get(f"/api/cases/{demo_b['id']}/audit").json()
    assert not any(e["event_type"] == "payment_link_created" for e in audit_b)
    
    # Execute DEMO-B manually
    exec_res = client.post(f"/api/cases/{demo_b['id']}/execute").json()
    assert exec_res["action"] == "payment_link"
    assert exec_res["payment_link_url"] == "https://rzp.io/rzp/real_demo_link"
    
    # Duplicate execution
    dup_res = client.post(f"/api/cases/{demo_b['id']}/execute").json()
    assert dup_res["action"] == "no_action"
    
    # DEMO-C
    demo_c = next(c for c in cases if c["case_number"] == "DEMO-C-RECOVERED")
    assert demo_c["status"] == "recovered"
    
    # DEMO-D
    demo_d = next(c for c in cases if c["case_number"] == "DEMO-D-STOPPED")
    assert demo_d["status"] == "abandoned"
    
    get_settings().demo_mode = False
