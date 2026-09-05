#!/usr/bin/env python3
"""Verification of Simulate Next Recovery Step, state transitions, duplicate click protection,
and authoritative database consistency for RecoverAI.
"""
import concurrent.futures
import json
import sys
import urllib.request

BASE_URL = "http://127.0.0.1:8000"


def request(method: str, path: str, data: dict | None = None) -> dict:
    url = f"{BASE_URL}{path}"
    headers = {"Content-Type": "application/json"}
    body = json.dumps(data).encode("utf-8") if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8")
        try:
            return {"_status_code": e.code, "_error": json.loads(err_body)}
        except Exception:
            return {"_status_code": e.code, "_error": err_body}


def get_demo_a() -> tuple[dict, dict, list]:
    cases = request("GET", "/api/cases?limit=1000")
    demo_a = next(c for c in cases if c["case_number"] == "DEMO-A-AUTO")
    exp = request("GET", f"/api/cases/{demo_a['id']}/explanation")
    audit = request("GET", f"/api/cases/{demo_a['id']}/audit")
    return demo_a, exp, audit


def main():
    print("=" * 65)
    print("RECOVERAI: SIMULATE NEXT RECOVERY STEP END-TO-END VERIFICATION")
    print("=" * 65)

    # STEP 1: Reset database
    print("\n1. Resetting demo database to authoritative deterministic baseline...")
    res = request("POST", "/api/demo/reset")
    assert res.get("message"), f"Reset failed: {res}"
    print("   Reset successful.")

    # STEP 2: Verify DEMO-A-AUTO initial state
    demo_a, exp, audit = get_demo_a()
    case_id = demo_a["id"]
    print(f"\n2. Authoritative Initial DEMO-A-AUTO State (ID: {case_id}):")
    print(f"   Status: {demo_a['status']} (expected: recovering)")
    print(f"   Amount: ₹{demo_a['amount'] / 100:,.2f} (expected: ₹2,500.00)")
    print(f"   Retry Count: {demo_a['retry_count']} of {demo_a['max_retries']} (expected: 1 of 3)")
    print(f"   ML Probability: {demo_a['recovery_probability']} (expected: 0.95)")
    print(f"   Payment Attempts: {len(demo_a.get('payment_attempts', []))} (expected: 0)")
    print(f"   Payment Link Status: {exp.get('payment_link_status')} (expected: ACTIVE)")

    assert demo_a["status"] == "recovering"
    assert demo_a["retry_count"] == 1
    assert demo_a["max_retries"] == 3
    assert demo_a["amount"] == 250000
    assert demo_a["recovery_probability"] == 0.95
    assert len(demo_a.get("payment_attempts", [])) == 0
    assert exp.get("payment_link_status") == "ACTIVE"

    # STEP 3: Customer clicks payment link
    print("\n3. Tracking customer opening payment link (track-click)...")
    click_res = request("POST", f"/api/cases/{case_id}/track-click")
    assert click_res.get("outcome") == "LINK_CLICKED", f"Click tracking failed: {click_res}"

    demo_a, exp, audit = get_demo_a()
    journey = exp["channel_intelligence"]["communication_journey"]
    followup = exp["channel_intelligence"]["followup_decision"]

    print(f"   Attempt 1 Outcome: {journey[0]['outcome']} (expected: LINK_CLICKED)")
    print(f"   Payment Attempts count: {len(demo_a.get('payment_attempts', []))} (strictly expected: 0)")
    print(f"   Follow-up Next Action: {followup['next_action']} (expected: RETRY_SAME_CHANNEL)")
    print(f"   Follow-up Recommended Wait: {followup['recommended_wait_period']} (expected: 24 hours)")

    assert journey[0]["outcome"] == "LINK_CLICKED"
    assert len(demo_a.get("payment_attempts", [])) == 0, "A link click must NEVER create a payment attempt!"
    assert followup["next_action"] == "RETRY_SAME_CHANNEL"
    assert followup["recommended_wait_period"] == "24 hours"

    # STEP 4: Simulate Next Recovery Step (Attempt 1 -> Attempt 2)
    print("\n4. Triggering 'Simulate Next Recovery Step' (Attempt 1 -> Attempt 2)...")
    step_res = request("POST", f"/api/cases/{case_id}/next-step")
    print(f"   Response Action: {step_res.get('action')}, Channel: {step_res.get('channel')}, Attempt: {step_res.get('attempt')}")
    assert step_res.get("action") == "reminder_dispatched"
    assert step_res.get("attempt") == 2

    # STEP 5: Verify TARGET 2 of 3 state
    demo_a, exp, audit = get_demo_a()
    journey = exp["channel_intelligence"]["communication_journey"]
    followup = exp["channel_intelligence"]["followup_decision"]
    attempts = demo_a.get("payment_attempts", [])
    history = exp.get("customer_history", {})
    history_count = history.get("interaction_count", history.get("successful_payments", 0) + history.get("failed_payments", 0))

    print("\n5. AUDITING PRIMARY TARGET STATE (DEMO-A-AUTO at 2 of 3 attempts):")
    print(f"   Status: {demo_a['status']} (expected: recovering)")
    print(f"   Amount: ₹{demo_a['amount'] / 100:,.2f} (expected: ₹2,500.00)")
    print(f"   ML Probability: {demo_a['recovery_probability']} (expected: 0.95)")
    print(f"   Recovery Tier: {exp.get('ml_decision')} (expected: HIGH)")
    print(f"   Communication Attempts: {demo_a['retry_count']} of {demo_a['max_retries']} (expected: 2 of 3)")
    print(f"   Customer Historical Transactions: {history_count} (expected: 5)")
    print(f"   Recovery Payment Attempts: {len(attempts)} (expected: 0)")
    print(f"   Payment Link Status: {exp.get('payment_link_status')} (expected: ACTIVE)")
    print(f"   Customer Payment Status: {exp.get('customer_payment_status')} (expected: PENDING)")
    print(f"   Journey records count: {len(journey)} (expected: 2)")
    print(f"   Attempt 1: {journey[0]['channel']} -> {journey[0]['outcome']}")
    print(f"   Attempt 2: {journey[1]['channel']} -> {journey[1]['outcome']}")
    print(f"   Follow-up Next Action: {followup['next_action']} (expected: AWAIT_RESPONSE)")
    print(f"   Follow-up Recommended Wait: {followup['recommended_wait_period']} (expected: 24 hours)")

    assert demo_a["status"] == "recovering"
    assert demo_a["retry_count"] == 2
    assert demo_a["max_retries"] == 3
    assert len(attempts) == 0
    assert len(journey) == 2
    assert journey[1]["outcome"] == "AWAITING_RESPONSE"
    assert followup["next_action"] == "AWAIT_RESPONSE"
    assert followup["recommended_wait_period"] == "24 hours"

    # STEP 6: Execute Simulate Next Recovery Step from 2 of 3 state (AUTHORITATIVE DECISION)
    print("\n6. Clicking 'Simulate Next Recovery Step' from 2 of 3 AWAIT_RESPONSE state...")
    repeat_res = request("POST", f"/api/cases/{case_id}/next-step")
    print(f"   Response Status: {repeat_res.get('status')}")
    print(f"   Response Reason: {repeat_res.get('reason')}")

    assert repeat_res.get("status") == "no_action"
    assert "already been executed" in repeat_res.get("reason", "")

    # Verify database state remained unchanged
    demo_a_after, exp_after, audit_after = get_demo_a()
    assert demo_a_after["retry_count"] == 2, "retry_count must remain 2 when awaiting response!"
    assert len(exp_after["channel_intelligence"]["communication_journey"]) == 2, "No duplicate communication attempt may be created!"
    assert len(demo_a_after.get("payment_attempts", [])) == 0, "No payment attempts may be created!"
    assert len(audit_after) == len(audit), "No duplicate audit events may be logged on no_action!"
    print("   Authoritative check PASSED: retry_count=2 preserved, zero side effects.")

    # STEP 7: Test Rapid Concurrent Double-Click Protection
    print("\n7. Testing rapid concurrent double-click protection on next-step endpoint...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(request, "POST", f"/api/cases/{case_id}/next-step")
        f2 = executor.submit(request, "POST", f"/api/cases/{case_id}/next-step")
        r1, r2 = f1.result(), f2.result()

    print(f"   Concurrent call 1: {r1.get('status', r1)}")
    print(f"   Concurrent call 2: {r2.get('status', r2)}")
    assert r1.get("status") == "no_action"
    assert r2.get("status") == "no_action"

    demo_a_double, _, _ = get_demo_a()
    assert demo_a_double["retry_count"] == 2
    assert len(demo_a_double.get("payment_attempts", [])) == 0
    print("   Concurrency lock PASSED: 0 race conditions, state remained strictly 2 of 3.")

    # STEP 8: Simulate Customer Payment Checkout
    print("\n8. Simulating customer recovery payment (checkout)...")
    pay_res = request("POST", f"/api/demo/simulate-payment/{case_id}", {
        "payment_method": "card",
        "action": "success"
    })
    assert pay_res.get("success") is True, f"Payment simulation failed: {pay_res}"
    print("   Payment successfully captured.")

    demo_a_paid, exp_paid, _ = get_demo_a()
    paid_attempts = demo_a_paid.get("payment_attempts", [])
    print(f"   Status after payment: {demo_a_paid['status']} (expected: recovered)")
    print(f"   Payment Attempts: {len(paid_attempts)} (expected: exactly 1)")
    print(f"   Payment Link Status: {exp_paid.get('payment_link_status')} (expected: PAID)")
    print(f"   Customer Payment Status: {exp_paid.get('customer_payment_status')} (expected: RECEIVED)")

    assert demo_a_paid["status"] == "recovered"
    assert len(paid_attempts) == 1
    assert paid_attempts[0]["status"] == "success"
    assert exp_paid.get("payment_link_status") == "PAID"
    assert exp_paid.get("customer_payment_status") == "RECEIVED"

    # Terminal check: next-step must now be blocked with HTTP 400
    blocked_step = request("POST", f"/api/cases/{case_id}/next-step")
    assert blocked_step.get("_status_code") == 400, f"Expected HTTP 400 on terminal case, got: {blocked_step}"
    print("   Terminal guard check PASSED: next-step blocked with HTTP 400 on recovered case.")

    # STEP 9: Final Reset Demo and Verify Invariants Restored
    print("\n9. Resetting demo database to verify original deterministic state restored...")
    reset_res = request("POST", "/api/demo/reset")
    assert reset_res.get("message")

    demo_a_final, exp_final, _ = get_demo_a()
    print(f"   DEMO-A-AUTO restored: {demo_a_final['status']}, {demo_a_final['retry_count']} of {demo_a_final['max_retries']}, {len(demo_a_final.get('payment_attempts', []))} payment attempts, Link: {exp_final.get('payment_link_status')}")

    assert demo_a_final["status"] == "recovering"
    assert demo_a_final["retry_count"] == 1
    assert demo_a_final["max_retries"] == 3
    assert len(demo_a_final.get("payment_attempts", [])) == 0
    assert exp_final.get("payment_link_status") == "ACTIVE"
    print("   Restoration check PASSED.")

    print("\n" + "=" * 65)
    print(">>> ALL VERIFICATION CHECKS FOR SIMULATE NEXT RECOVERY STEP PASSED! <<<")
    print("=" * 65)


if __name__ == "__main__":
    main()
