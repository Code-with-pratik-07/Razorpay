import urllib.request
import urllib.error
import json
import sys

BASE_URL = "http://127.0.0.1:8000"

def req(path, method="GET", body=None):
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))

def run_tests():
    print("=== STEP 1: INITIAL RESET DEMO DATA ===")
    reset_res = req("/api/demo/reset", method="POST")
    print("Reset response:", reset_res)

    print("\n=== STEP 2: LOAD CASES & STATS ===")
    cases = req("/api/cases?limit=1000")
    case_map = {c["case_number"]: c for c in cases}
    initial_stats = req("/api/dashboard/stats")
    print(f"Loaded {len(cases)} cases.")
    print("Initial Revenue Recovered:", initial_stats["revenue_recovered"])
    print("Initial Human Review Cases:", initial_stats["human_review_cases"])

    # ----------------------------------------------------
    # 1. Test DEMO-A-AUTO
    # ----------------------------------------------------
    print("\n=== STEP 3: AUDIT DEMO-A-AUTO (INITIAL DETERMINISTIC STATE) ===")
    case_a = case_map["DEMO-A-AUTO"]
    exp_a = req(f"/api/cases/{case_a['id']}/explanation")
    assert case_a["status"] == "recovering", f"Expected recovering, got {case_a['status']}"
    assert case_a["retry_count"] == 1, f"Expected retry_count 1, got {case_a['retry_count']}"
    assert case_a["max_retries"] == 3, f"Expected max_retries 3, got {case_a['max_retries']}"
    assert exp_a["ml"]["recovery_probability"] == 0.95, f"Expected 0.95, got {exp_a['ml']['recovery_probability']}"
    assert exp_a["human_review_status"] == "NOT_REQUIRED"
    assert exp_a["policy"]["allowed"] is True
    assert len(exp_a.get("payment_attempts", [])) == 0, "Expected 0 payment attempts initially"
    print("DEMO-A-AUTO initial state verified: recovering, 1 of 3, ML 95%, 0 payment attempts.")

    print("\n=== STEP 4: TRACK LINK CLICK ON DEMO-A-AUTO ===")
    click_res = req(f"/api/cases/{case_a['id']}/track-click", method="POST")
    print("Track click response:", click_res)
    exp_a_clicked = req(f"/api/cases/{case_a['id']}/explanation")
    case_a_clicked = req(f"/api/cases/{case_a['id']}")
    # Verify link click does NOT create a payment attempt
    assert len(case_a_clicked.get("payment_attempts", [])) == 0, "Payment attempts must remain 0 after click!"
    fd_a_clicked = exp_a_clicked["channel_intelligence"]["followup_decision"]
    assert fd_a_clicked["previous_outcome"] == "LINK_CLICKED", f"Expected LINK_CLICKED, got {fd_a_clicked['previous_outcome']}"
    print("DEMO-A-AUTO after click verified: LINK_CLICKED, 0 payment attempts.")

    print("\n=== STEP 5: SIMULATE PAYMENT ON DEMO-A-AUTO ===")
    pay_res = req(f"/api/demo/simulate-payment/{case_a['id']}", method="POST", body={
        "success": True,
        "payment_method": "card",
        "status": "success"
    })
    print("Payment simulation response:", pay_res)
    assert pay_res["success"] is True
    assert pay_res["case_status"] == "recovered"

    print("\n=== STEP 6: AUDIT DEMO-A-AUTO (AFTER PAYMENT & PERSISTENCE) ===")
    case_a_updated = req(f"/api/cases/{case_a['id']}")
    exp_a_updated = req(f"/api/cases/{case_a['id']}/explanation")
    stats_updated = req("/api/dashboard/stats")

    assert case_a_updated["status"] == "recovered", f"Expected recovered, got {case_a_updated['status']}"
    assert case_a_updated["last_payment_status"] == "SUCCESS"
    assert len(case_a_updated.get("payment_attempts", [])) == 1, "Expected 1 genuine payment attempt"
    att = case_a_updated["payment_attempts"][0]
    assert att["status"] == "success"
    assert att["amount"] == 250000
    assert att["payment_method"] == "card"
    assert exp_a_updated["status"] == "recovered"
    assert exp_a_updated["payment_link_status"] == "PAID"
    assert exp_a_updated["channel_intelligence"]["followup_decision"]["next_action"] == "STOP_RECOVERY"
    assert exp_a_updated["channel_intelligence"]["followup_decision"]["previous_outcome"] == "PAYMENT_COMPLETED"
    assert stats_updated["revenue_recovered"] == initial_stats["revenue_recovered"] + 250000
    print("DEMO-A-AUTO recovered state verified and persisted!")

    # ----------------------------------------------------
    # 2. Test DEMO-B-HUMAN
    # ----------------------------------------------------
    print("\n=== STEP 7: AUDIT DEMO-B-HUMAN (BEFORE APPROVAL) ===")
    case_b = case_map["DEMO-B-HUMAN"]
    exp_b = req(f"/api/cases/{case_b['id']}/explanation")
    assert case_b["status"] == "human_review", f"Expected human_review, got {case_b['status']}"
    assert case_b["retry_count"] == 0, f"Expected 0 retry count, got {case_b['retry_count']}"
    assert len(case_b.get("payment_attempts", [])) == 0, "Expected 0 payment attempts"
    assert exp_b["human_review_status"] == "REQUIRED", f"Expected REQUIRED, got {exp_b['human_review_status']}"
    assert exp_b["policy"]["allowed"] is False
    assert exp_b["policy"]["requires_human_approval"] is True
    assert exp_b["communication_status"] == "PAUSED"
    print("DEMO-B-HUMAN initial state verified: human_review, 0 of 3, comms paused, no payment attempts.")

    print("\n=== STEP 8: APPROVE RECOVERY ON DEMO-B-HUMAN ===")
    exec_res = req(f"/api/cases/{case_b['id']}/execute", method="POST")
    print("Approval execution response:", exec_res)
    assert exec_res["status"] == "recovering"

    print("\n=== STEP 9: AUDIT DEMO-B-HUMAN (AFTER APPROVAL & PERSISTENCE) ===")
    case_b_updated = req(f"/api/cases/{case_b['id']}")
    exp_b_updated = req(f"/api/cases/{case_b['id']}/explanation")
    stats_after_b = req("/api/dashboard/stats")

    assert case_b_updated["status"] == "recovering", f"Expected recovering, got {case_b_updated['status']}"
    assert exp_b_updated["human_review_status"] == "APPROVED"
    assert exp_b_updated["manual_execution"] is True
    assert exp_b_updated["communication_status"] == "READY"
    assert stats_after_b["human_review_cases"] == initial_stats["human_review_cases"] - 1
    print("DEMO-B-HUMAN approval verified and persisted!")

    # ----------------------------------------------------
    # 3. Test DEMO-C-RECOVERED
    # ----------------------------------------------------
    print("\n=== STEP 10: AUDIT DEMO-C-RECOVERED ===")
    case_c = case_map["DEMO-C-RECOVERED"]
    exp_c = req(f"/api/cases/{case_c['id']}/explanation")
    assert case_c["status"] == "recovered"
    assert len(case_c.get("payment_attempts", [])) == 1, "Must have 1 genuine PaymentAttempt record"
    assert exp_c["status"] == "recovered"
    assert exp_c["channel_intelligence"]["followup_decision"]["next_action"] == "STOP_RECOVERY"
    assert exp_c["channel_intelligence"]["followup_decision"]["previous_outcome"] == "PAYMENT_COMPLETED"
    print("DEMO-C-RECOVERED verified: recovered, 1 genuine payment attempt, STOP_RECOVERY, PAYMENT_COMPLETED.")

    # ----------------------------------------------------
    # 4. Test DEMO-D-STOPPED
    # ----------------------------------------------------
    print("\n=== STEP 11: AUDIT DEMO-D-STOPPED ===")
    case_d = case_map["DEMO-D-STOPPED"]
    exp_d = req(f"/api/cases/{case_d['id']}/explanation")
    assert case_d["status"] == "abandoned"
    assert case_d["retry_count"] == 2
    assert case_d["max_retries"] == 2
    assert len(case_d.get("payment_attempts", [])) == 0, "0 payment attempts"
    assert exp_d["status"] == "abandoned"
    assert exp_d["communication_status"] == "EXHAUSTED"
    assert exp_d["channel_intelligence"]["followup_decision"]["next_action"] == "STOP_RECOVERY"
    assert exp_d["channel_intelligence"]["followup_decision"]["previous_outcome"] == "NO_ENGAGEMENT"
    print("DEMO-D-STOPPED verified: abandoned, 2 of 2 attempts, EXHAUSTED, STOP_RECOVERY, 0 payment attempts.")

    # ----------------------------------------------------
    # 5. Test Reset Demo Restores Original States
    # ----------------------------------------------------
    print("\n=== STEP 12: RESET DEMO AND VERIFY ORIGINAL DETERMINISTIC STATES RESTORED ===")
    req("/api/demo/reset", method="POST")
    cases_reset = req("/api/cases?limit=1000")
    reset_map = {c["case_number"]: c for c in cases_reset}

    # Verify DEMO-A-AUTO is restored to recovering, retry 1 of 3, 0 payment attempts
    case_a_reset = reset_map["DEMO-A-AUTO"]
    exp_a_reset = req(f"/api/cases/{case_a_reset['id']}/explanation")
    assert case_a_reset["status"] == "recovering", f"Expected recovering after reset, got {case_a_reset['status']}"
    assert len(case_a_reset.get("payment_attempts", [])) == 0, "Payment attempts must be 0 after reset!"
    assert case_a_reset["retry_count"] == 1
    assert exp_a_reset["ml"]["recovery_probability"] == 0.95

    # Verify DEMO-B-HUMAN is restored to human_review
    case_b_reset = reset_map["DEMO-B-HUMAN"]
    assert case_b_reset["status"] == "human_review"
    assert case_b_reset["retry_count"] == 0
    assert len(case_b_reset.get("payment_attempts", [])) == 0

    # Verify DEMO-C-RECOVERED is recovered with 1 payment attempt
    case_c_reset = reset_map["DEMO-C-RECOVERED"]
    assert case_c_reset["status"] == "recovered"
    assert len(case_c_reset.get("payment_attempts", [])) == 1

    # Verify DEMO-D-STOPPED is abandoned with 2 of 2
    case_d_reset = reset_map["DEMO-D-STOPPED"]
    assert case_d_reset["status"] == "abandoned"
    assert case_d_reset["retry_count"] == 2
    assert len(case_d_reset.get("payment_attempts", [])) == 0

    print("Reset Demo test verified: All 4 deterministic scenarios restored accurately!")
    print("\n>>> ALL 12 END-TO-END VERIFICATION CHECKS PASSED PERFECTLY! <<<")

if __name__ == "__main__":
    run_tests()
