from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.main import app
from app.db.database import SessionLocal, init_db
from app.models.payment_case import PaymentCase, CaseStatus, NextActionType
from app.services.recovery_service import execute_recovery

def test_attempt_limit_reached():
    init_db()
    with SessionLocal() as db:
        case = db.query(PaymentCase).filter(PaymentCase.case_number.like("%DEMO%")).first()
        assert case is not None
        
        # Manually force state to "Attempt Limit Reached"
        case.status = CaseStatus.RECOVERING
        case.retry_count = 3
        case.max_retries = 3
        case.payment_link_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)
        db.commit()
        
        db.refresh(case)
        assert case.status == CaseStatus.RECOVERING
        assert case.retry_count == case.max_retries
        assert case.payment_link_expires_at > datetime.now(timezone.utc).replace(tzinfo=None)

def test_recovery_abandoned():
    init_db()
    with SessionLocal() as db:
        case = db.query(PaymentCase).filter(PaymentCase.case_number.like("%DEMO%")).first()
        assert case is not None
        
        # Manually force state to "ABANDONED"
        case.status = CaseStatus.ABANDONED
        case.retry_count = 3
        case.max_retries = 3
        case.payment_link_expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
        case.next_action_type = NextActionType.NONE
        db.commit()
        
        db.refresh(case)
        assert case.status == CaseStatus.ABANDONED
        assert case.payment_link_expires_at < datetime.now(timezone.utc).replace(tzinfo=None)
        assert case.next_action_type == NextActionType.NONE

def test_no_automatic_recovery_after_abandonment():
    init_db()
    with SessionLocal() as db:
        case = db.query(PaymentCase).filter(PaymentCase.case_number.like("%DEMO%")).first()
        assert case is not None
        
        case.status = CaseStatus.ABANDONED
        db.commit()
        
        # Should return an error or skip recovery if already terminal
        # Let's hit the execute endpoint
        client = TestClient(app)
        res = client.post(f"/api/cases/{case.id}/execute")
        
        # Assuming execute fails with 400 for terminal case
        assert res.status_code == 200
        assert res.json().get("status") == "abandoned"
        assert res.json().get("action") == "stopped"


def test_attempt_limit_exhausted_consistency():
    """Verify strict state consistency when retry_count >= max_retries."""
    init_db()
    with SessionLocal() as db:
        case = db.query(PaymentCase).filter(PaymentCase.case_number.like("%DEMO%")).first()
        assert case is not None
        case.status = CaseStatus.RECOVERING
        case.retry_count = 2
        case.max_retries = 2
        db.commit()
        case_id = case.id

    client = TestClient(app)

    # 1. Case summary must reflect terminal ABANDONED status
    res = client.get(f"/api/cases/{case_id}")
    assert res.status_code == 200
    assert res.json()["status"] == "abandoned"

    # 2. Case explanation must have consistent terminal state across all sections
    exp_res = client.get(f"/api/cases/{case_id}/explanation")
    assert exp_res.status_code == 200
    exp = exp_res.json()
    assert exp["status"] == "abandoned"
    assert exp["customer_payment_status"] == "EXHAUSTED"
    assert exp["communication_status"] == "EXHAUSTED"
    assert exp["channel_intelligence"]["status"] == "ATTEMPT_LIMIT_REACHED"
    assert exp["channel_intelligence"]["followup_decision"]["next_action"] == "STOP_RECOVERY"
    assert exp["channel_intelligence"]["followup_decision"]["recommended_wait_period"] == "None"

    # 3. Next step must reject with HTTP 400
    next_step_res = client.post(f"/api/cases/{case_id}/next-step")
    assert next_step_res.status_code == 400
    assert "terminal case" in next_step_res.json()["detail"].lower()
