#!/usr/bin/env python3
import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000"

def req(path, method="GET", body=None):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))

def main():
    print("=== VERIFYING DEMO-A-AUTO LIFECYCLE ===")
    
    # 1. Reset demo database
    print("\n1. Resetting demo database...")
    reset_res = req("/api/demo/reset", method="POST")
    print("Reset response:", reset_res["message"])

    # 2. Fetch DEMO-A-AUTO initial state
    print("\n2. Fetching DEMO-A-AUTO initial state...")
    cases = req("/api/cases?limit=1000")
    case_map = {c["case_number"]: c for c in cases}
    demo_a = case_map["DEMO-A-AUTO"]
    case_id = demo_a["id"]
    
    assert demo_a["status"] == "recovering", f"Expected recovering, got {demo_a['status']}"
    assert demo_a["retry_count"] == 1
    assert demo_a["max_retries"] == 3
    exp_a = req(f"/api/cases/{case_id}/explanation")
    assert exp_a["ml"]["recovery_probability"] == 0.95
    assert exp_a["human_review_status"] == "NOT_REQUIRED"
    assert exp_a["policy"]["allowed"] is True
    assert len(exp_a.get("payment_attempts", [])) == 0
    print("Initial state verified: Status=recovering, Retries=1/3, ML=95%, Payment Attempts=0, Link=Active")

    # 3. Simulate Link Click
    print("\n3. Tracking payment link click (open)...")
    click_res = req(f"/api/cases/{case_id}/track-click", method="POST")
    print("Track click response:", click_res["outcome"])
    
    case_after_click = req(f"/api/cases/{case_id}")
    assert len(case_after_click.get("payment_attempts", [])) == 0, "Attempts must remain 0 after link click"
    assert case_after_click["status"] == "recovering"
    
    exp_after_click = req(f"/api/cases/{case_id}/explanation")
    fd = exp_after_click["channel_intelligence"]["followup_decision"]
    assert fd["previous_outcome"] == "LINK_CLICKED"
    print("Click verified: Outcome=LINK_CLICKED, Status=recovering, Payment Attempts=0 (No synthetic attempts)")

    # 4. Simulate Successful Payment
    print("\n4. Simulating successful recovery payment...")
    pay_res = req(f"/api/demo/simulate-payment/{case_id}", method="POST", body={
        "success": True,
        "payment_method": "card",
        "status": "success"
    })
    print("Payment simulation response:", pay_res["message"])
    assert pay_res["case_status"] == "recovered"
    assert pay_res["attempt"]["status"] == "success"

    # 5. Verify Case Persistence After Payment
    print("\n5. Verifying case persistence and state after payment...")
    case_recovered = req(f"/api/cases/{case_id}")
    assert case_recovered["status"] == "recovered", f"Expected recovered, got {case_recovered['status']}"
    assert len(case_recovered.get("payment_attempts", [])) == 1
    att = case_recovered["payment_attempts"][0]
    assert att["status"] == "success"
    assert att["amount"] == 250000
    print("Recovered state verified: Status=recovered, Genuine Payment Attempts=1 (Recorded in DB)")

    # 6. Verify Dashboard Metrics Update
    print("\n6. Verifying dashboard metrics update...")
    stats = req("/api/dashboard/stats")
    assert stats["revenue_recovered"] >= 250000
    print(f"Dashboard stats verified: Revenue Recovered=₹{stats['revenue_recovered']/100:,.2f}")

    # 7. Reset and Verify Restoration
    print("\n7. Testing reset restoration of DEMO-A-AUTO...")
    req("/api/demo/reset", method="POST")
    cases_reset = req("/api/cases?limit=1000")
    case_map_reset = {c["case_number"]: c for c in cases_reset}
    demo_a_reset = case_map_reset["DEMO-A-AUTO"]
    assert demo_a_reset["status"] == "recovering"
    assert demo_a_reset["retry_count"] == 1
    assert len(demo_a_reset.get("payment_attempts", [])) == 0
    print("Reset restoration verified: Restored to recovering with 0 payment attempts.")

    print("\n>>> DEMO-A-AUTO LIFECYCLE TEST COMPLETED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    main()
