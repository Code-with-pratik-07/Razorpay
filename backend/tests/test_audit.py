import json

from fastapi.testclient import TestClient

from app.main import app
from app.db.database import SessionLocal, init_db
from app.services.audit_service import list_audit_events, log_audit_event
from tests.helpers import create_case


def test_audit_events_are_append_only_and_chronological() -> None:
    init_db()
    with SessionLocal() as db:
        case = create_case(db)
        first = log_audit_event(db, case.id, "case_created", {"source": "test"})
        second = log_audit_event(db, case.id, "ml_prediction", {"probability": 0.72})
        events = list_audit_events(db, case.id)
    assert [event.id for event in events[-2:]] == [first.id, second.id]
    assert not hasattr(__import__("app.services.audit_service", fromlist=["*"]), "update_audit_event")
    assert not hasattr(__import__("app.services.audit_service", fromlist=["*"]), "delete_audit_event")


def test_audit_api_and_json_export() -> None:
    init_db()
    with SessionLocal() as db:
        case = create_case(db)
        log_audit_event(db, case.id, "failure_detected", {"demo": True})
        case_id = case.id
    with TestClient(app) as client:
        events_response = client.get(f"/api/cases/{case_id}/audit")
        export_response = client.get(f"/api/cases/{case_id}/audit/export")
    assert events_response.status_code == 200
    assert events_response.json()[0]["event_type"] == "failure_detected"
    payload = json.loads(export_response.text)
    assert export_response.status_code == 200
    assert payload["case_id"] == case_id
    assert payload["events"][0]["event_data"] == {"demo": True}
