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

def verify_deterministic_demo_a(cycle_num: int):
    cases = req("/api/cases?limit=1000")
    demo_a = next((c for c in cases if c["case_number"] == "DEMO-A-AUTO"), None)
    assert demo_a is not None, f"Cycle {cycle_num}: DEMO-A-AUTO not found in case list!"
    
    case_id = demo_a["id"]
    detail = req(f"/api/cases/{case_id}")
    exp = req(f"/api/cases/{case_id}/explanation")
    audit = req(f"/api/cases/{case_id}/audit")

    print(f"\n[Cycle {cycle_num}] Authoritative DEMO-A-AUTO State (ID: {case_id}):")
    print(f"  Status: {detail['status']} (expected: recovering)")
    print(f"  Retry Count: {detail['retry_count']} of {detail['max_retries']} (expected: 1 of 3)")
    print(f"  Amount: ₹{detail['amount'] / 100:,.2f} (expected: ₹2,500.00)")
    print(f"  ML Probability: {detail['recovery_probability']} (expected: 0.95)")
    print(f"  Policy Check: {detail['policy_check_passed']} (expected: True)")
    print(f"  Payment Attempts: {len(detail['payment_attempts'])} (expected: 0)")
    print(f"  Payment Link Status: {exp['payment_link_status']} (expected: ACTIVE)")
    print(f"  Customer Payment Status: {exp['customer_payment_status']} (expected: PENDING)")
    print(f"  Audit Events: {len(audit)} events")

    # Strict Invariant Checks
    assert detail["status"] == "recovering", f"Cycle {cycle_num}: Status is {detail['status']}, expected recovering!"
    assert detail["status"] != "abandoned", f"Cycle {cycle_num}: Case must NEVER be abandoned after reset!"
    assert detail["status"] != "recovered", f"Cycle {cycle_num}: Case must not retain recovered state after reset!"
    assert detail["retry_count"] == 1, f"Cycle {cycle_num}: Retry count is {detail['retry_count']}, expected 1!"
    assert detail["max_retries"] == 3, f"Cycle {cycle_num}: Max retries is {detail['max_retries']}, expected 3!"
    assert detail["amount"] == 250000, f"Cycle {cycle_num}: Amount is {detail['amount']}, expected 250000 paise!"
    assert detail["recovery_probability"] == 0.95, f"Cycle {cycle_num}: ML prob is {detail['recovery_probability']}!"
    assert len(detail["payment_attempts"]) == 0, f"Cycle {cycle_num}: Found {len(detail['payment_attempts'])} payment attempts, expected 0!"
    assert exp["payment_link_status"] == "ACTIVE", f"Cycle {cycle_num}: Link status is {exp['payment_link_status']}!"
    assert exp["customer_payment_status"] == "PENDING", f"Cycle {cycle_num}: Customer payment status is {exp['customer_payment_status']}!"
    assert exp["policy"]["allowed"] is True

    # Audit Events Invariants
    event_types = [e["event_type"] for e in audit]
    assert "payment_success" not in event_types, f"Cycle {cycle_num}: Stale payment_success event survived!"
    assert "payment_captured" not in event_types, f"Cycle {cycle_num}: Stale payment_captured event survived!"
    assert "recovery_closed" not in event_types, f"Cycle {cycle_num}: Stale recovery_closed event survived!"

    return case_id

def mutate_demo_a(case_id: str, cycle_num: int):
    print(f"  [Cycle {cycle_num}] Mutating DEMO-A-AUTO...")
    # 1. Track link click
    click_res = req(f"/api/cases/{case_id}/track-click", method="POST")
    assert click_res["outcome"] == "LINK_CLICKED"
    
    # 2. Simulate payment success
    pay_res = req(f"/api/demo/simulate-payment/{case_id}", method="POST", body={
        "success": True,
        "payment_method": "card",
        "status": "success",
        "amount": 250000
    })
    assert pay_res["case_status"] == "recovered"
    
    # Verify mutation happened
    mutated = req(f"/api/cases/{case_id}")
    mutated_exp = req(f"/api/cases/{case_id}/explanation")
    assert mutated["status"] == "recovered"
    assert len(mutated["payment_attempts"]) == 1
    assert mutated_exp["payment_link_status"] == "PAID"
    assert mutated_exp["customer_payment_status"] == "RECEIVED"
    print(f"  [Cycle {cycle_num}] Mutation verified -> Status: recovered, 1 payment attempt, Link: PAID")

def main():
    print("====================================================")
    print("RUNNING 3 CONSECUTIVE MUTATION & RESET CYCLES")
    print("====================================================")

    for cycle in range(1, 4):
        print(f"\n>>> STARTING CYCLE {cycle} of 3 <<<")
        
        # 1. Reset
        reset_res = req("/api/demo/reset", method="POST")
        assert reset_res["message"] == "Demo database successfully reset and seeded."
        
        # 2. Verify deterministic state
        case_id = verify_deterministic_demo_a(cycle)
        
        # 3. Mutate
        mutate_demo_a(case_id, cycle)

    print("\n>>> FINAL RESET AND DETERMINISTIC CHECK <<<")
    req("/api/demo/reset", method="POST")
    final_id = verify_deterministic_demo_a(4)

    print("\n--- Checking Showcase B, C, D Invariants ---")
    cases = req("/api/cases?limit=1000")
    
    demo_b = next(c for c in cases if c["case_number"] == "DEMO-B-HUMAN")
    exp_b = req(f"/api/cases/{demo_b['id']}/explanation")
    assert demo_b["status"] == "human_review"
    assert demo_b["retry_count"] == 0
    assert exp_b["human_review_status"] == "REQUIRED"
    assert exp_b["payment_link_status"] in {"NONE", "NOT_GENERATED"}
    print("DEMO-B-HUMAN: Verified human_review, 0 of 3, link not generated, human review required.")

    demo_c = next(c for c in cases if c["case_number"] == "DEMO-C-RECOVERED")
    assert demo_c["status"] == "recovered"
    assert len(demo_c["payment_attempts"]) == 1
    print("DEMO-C-RECOVERED: Verified recovered, exactly 1 genuine attempt.")

    demo_d = next(c for c in cases if c["case_number"] == "DEMO-D-STOPPED")
    assert demo_d["status"] == "abandoned"
    assert demo_d["retry_count"] == 2
    assert demo_d["max_retries"] == 2
    assert len(demo_d["payment_attempts"]) == 0
    print("DEMO-D-STOPPED: Verified abandoned, 2 of 2 exhausted, 0 payment attempts.")

    print("\n====================================================")
    print("ALL 3 CONSECUTIVE CYCLES PASSED WITH ZERO STALE DATA!")
    print("====================================================")

if __name__ == "__main__":
    main()
