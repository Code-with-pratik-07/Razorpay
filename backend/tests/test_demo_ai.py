import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.main import app
from app.db.database import SessionLocal, init_db
from app.models.payment_case import PaymentCase
from app.schemas.recovery import CaseExplanation, AIDecision

def test_demo_b_human_has_ai_analysis():
    # 1. Reset demo data to ensure a fresh state
    from app.core.config import get_settings
    settings = get_settings()
    original_demo_mode = settings.demo_mode
    settings.demo_mode = True
    
    init_db()
    client = TestClient(app)
    
    response = client.post("/api/demo/reset")
    assert response.status_code == 200
    settings.demo_mode = original_demo_mode
    
    # Fetch DEMO-B-HUMAN from DB
    with SessionLocal() as db_session:
        cases = db_session.query(PaymentCase).all()
        demo_b_human = next((c for c in cases if "DEMO-B-HUMAN" in c.case_number), None)
        assert demo_b_human is not None
    
    # 2. API response contains AI analysis
    response = client.get(f"/api/cases/{demo_b_human.id}/explanation")
    assert response.status_code == 200
    
    explanation = response.json()
    assert explanation["ai"] is not None
    assert explanation["ai"]["recommended_action"] == "escalate"
    
    # 3. Missing customer_message does not cause validation failure
    # Ensure customer_message is null or missing, but AI is still parsed!
    ai_decision = AIDecision(**explanation["ai"])
    assert ai_decision.recommended_action == "escalate"
    
    # 4. A recovered case retains AI analysis
    # Let's transition DEMO-B-HUMAN to RECOVERED and ensure it retains AI analysis.
    client.post(f"/api/cases/{demo_b_human.id}/execute")
    client.post(f"/api/demo/simulate-payment/{demo_b_human.id}", json={"success": True})
    
    response2 = client.get(f"/api/cases/{demo_b_human.id}/explanation")
    assert response2.status_code == 200
    explanation2 = response2.json()
    assert explanation2["ai"] is not None
    assert explanation2["ai"]["recommended_action"] == "escalate"
    assert explanation2["status"] == "recovered"
    
