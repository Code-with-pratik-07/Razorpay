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


def test_demo_b_human_lifecycle_state_consistency():
    """Verify DEMO-B-HUMAN state consistency through approval, dispatch, and follow-up."""
    from app.core.config import get_settings
    settings = get_settings()
    original_demo_mode = settings.demo_mode
    settings.demo_mode = True
    try:
        init_db()
        client = TestClient(app)

        reset_res = client.post("/api/demo/reset")
        assert reset_res.status_code == 200

        # Fetch DEMO-B-HUMAN from DB
        with SessionLocal() as db_session:
            cases = db_session.query(PaymentCase).all()
            demo_b = next(c for c in cases if "DEMO-B-HUMAN" in c.case_number)

        # 1. Before Human Approval
        exp_pre = client.get(f"/api/cases/{demo_b.id}/explanation").json()
        assert exp_pre["status"] == "human_review"
        assert exp_pre["human_review_status"] == "REQUIRED"
        assert exp_pre["communication_status"] == "PAUSED"
        assert exp_pre["channel_intelligence"]["followup_decision"]["next_action"] == "AWAIT_APPROVAL"
        assert len(exp_pre["channel_intelligence"]["communication_journey"]) == 0

        # 2. After Human Approval (Before Dispatch)
        exec_res = client.post(f"/api/cases/{demo_b.id}/execute")
        assert exec_res.status_code == 200
        exp_approved = client.get(f"/api/cases/{demo_b.id}/explanation").json()
        assert exp_approved["status"] == "recovering"
        assert exp_approved["human_review_status"] == "APPROVED"
        assert exp_approved["payment_link_status"] == "ACTIVE"
        assert exp_approved["communication_status"] == "READY"
        assert exp_approved["recommended_channel"] == "email"

        # 3. After Dispatch (Attempt 1 - Email)
        disp_res = client.post(f"/api/cases/{demo_b.id}/dispatch-communication", json={"channel": "email"})
        assert disp_res.status_code == 200
        exp_disp = client.get(f"/api/cases/{demo_b.id}/explanation").json()
        assert exp_disp["status"] == "recovering"
        journey_disp = exp_disp["channel_intelligence"]["communication_journey"]
        assert len(journey_disp) == 1
        assert journey_disp[0]["channel"] == "email"

        # 4. After Next Recovery Step (Attempt 2 - WhatsApp Reminder)
        step_res = client.post(f"/api/cases/{demo_b.id}/next-step")
        assert step_res.status_code == 200
        exp_step = client.get(f"/api/cases/{demo_b.id}/explanation").json()
        assert exp_step["status"] == "recovering"
        journey_step = exp_step["channel_intelligence"]["communication_journey"]
        assert len(journey_step) == 2
        assert journey_step[-1]["channel"] == "whatsapp"
        assert journey_step[-1]["outcome"] == "AWAITING_RESPONSE"

        followup_step = exp_step["channel_intelligence"]["followup_decision"]
        assert followup_step["next_action"] == "AWAIT_RESPONSE"
        assert followup_step["previous_outcome"] == "AWAITING_RESPONSE"
        assert followup_step["selected_channel"] == "whatsapp"

        # Verify idempotency prevents further step during awaiting response
        repeat_step = client.post(f"/api/cases/{demo_b.id}/next-step")
        assert repeat_step.status_code == 200
        assert repeat_step.json().get("status") == "no_action"
    finally:
        settings.demo_mode = original_demo_mode


    
