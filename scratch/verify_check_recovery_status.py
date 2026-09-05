#!/usr/bin/env python3
"""Targeted verification for 'Check Recovery Status (Awaiting Response)' button,
idempotent zero-mutation behavior, rapid double click concurrency, and lifecycle restoration.
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
    print("=" * 70)
    print("VERIFICATION: 'CHECK RECOVERY STATUS (AWAITING RESPONSE)' BUTTON")
    print("=" * 70)

    # Step 1 — Reset Demo
    print("\nStep 1: Resetting demo database...")
    res = request("POST", "/api/demo/reset")
    assert res.get("message"), f"Reset failed: {res}"

    demo_a, exp, audit = get_demo_a()
    case_id = demo_a["id"]
    print(f"  DEMO-A-AUTO ID: {case_id}")
    print(f"  Status: {demo_a['status']} (expected: recovering)")
    print(f"  Communication: {demo_a['retry_count']} of {demo_a['max_retries']} (expected: 1 of 3)")
    print(f"  Payment Attempts: {len(demo_a.get('payment_attempts', []))} (expected: 0)")
    assert demo_a["status"] == "recovering"
    assert demo_a["retry_count"] == 1
    assert len(demo_a.get("payment_attempts", [])) == 0

    # Step 2 — Open Payment Link (Track Click)
    print("\nStep 2: Tracking customer opening payment link (track-click)...")
    click_res = request("POST", f"/api/cases/{case_id}/track-click")
    assert click_res.get("outcome") == "LINK_CLICKED"

    demo_a, exp, audit = get_demo_a()
    journey = exp["channel_intelligence"]["communication_journey"]
    print(f"  Attempt 1 Outcome: {journey[0]['outcome']} (expected: LINK_CLICKED)")
    print(f"  Payment Attempts: {len(demo_a.get('payment_attempts', []))} (strictly expected: 0)")
    assert journey[0]["outcome"] == "LINK_CLICKED"
    assert len(demo_a.get("payment_attempts", [])) == 0

    # Step 3 — Simulate Next Recovery Step (1 of 3 -> 2 of 3)
    print("\nStep 3: Triggering Next Recovery Step (Attempt 1 -> 2)...")
    step_res = request("POST", f"/api/cases/{case_id}/next-step")
    print(f"  Action: {step_res.get('action')}, Channel: {step_res.get('channel')}, Attempt: {step_res.get('attempt')}")
    assert step_res.get("action") == "reminder_dispatched"
    assert step_res.get("attempt") == 2

    demo_a, exp, audit = get_demo_a()
    journey = exp["channel_intelligence"]["communication_journey"]
    followup = exp["channel_intelligence"]["followup_decision"]
    print(f"  Communication: {demo_a['retry_count']} of {demo_a['max_retries']} (expected: 2 of 3)")
    print(f"  Attempt 2 Outcome: {journey[1]['outcome']} (expected: AWAITING_RESPONSE)")
    print(f"  Follow-up Next Action: {followup['next_action']} (expected: AWAIT_RESPONSE)")
    print(f"  Follow-up Wait: {followup['recommended_wait_period']} (expected: 24 hours)")
    assert demo_a["retry_count"] == 2
    assert journey[1]["outcome"] == "AWAITING_RESPONSE"
    assert followup["next_action"] == "AWAIT_RESPONSE"

    # Step 4 — Click "Check Recovery Status" (authoritative no_action test)
    print("\nStep 4: Executing 'Check Recovery Status' (POST /api/cases/{id}/next-step)...")
    audit_count_before = len(audit)
    check_res = request("POST", f"/api/cases/{case_id}/next-step")
    print(f"  Response status: {check_res.get('status')}")
    print(f"  Response reason: {check_res.get('reason')}")
    assert check_res.get("status") == "no_action"
    assert "already been executed" in check_res.get("reason", "")

    # Verify state remains strictly unchanged
    demo_a_after, exp_after, audit_after = get_demo_a()
    print("\n  Verifying database invariants after status check:")
    print(f"  - Case Status: {demo_a_after['status']} (expected: recovering)")
    print(f"  - Communication Attempts: {demo_a_after['retry_count']} of {demo_a_after['max_retries']} (expected: 2 of 3)")
    print(f"  - Communication Records: {len(exp_after['channel_intelligence']['communication_journey'])} (expected: 2)")
    print(f"  - Payment Attempts: {len(demo_a_after.get('payment_attempts', []))} (expected: 0)")
    print(f"  - Audit Events: {len(audit_after)} (expected: {audit_count_before}, exactly 0 new events)")
    print(f"  - Remaining Attempts: {demo_a_after['max_retries'] - demo_a_after['retry_count']} (expected: 1)")

    assert demo_a_after["status"] == "recovering"
    assert demo_a_after["retry_count"] == 2
    assert demo_a_after["max_retries"] == 3
    assert len(exp_after["channel_intelligence"]["communication_journey"]) == 2
    assert len(demo_a_after.get("payment_attempts", [])) == 0
    assert len(audit_after) == audit_count_before
    print("  All invariants verified: ZERO mutations created.")

    # Step 5 — Rapid Double Click Concurrency Test
    print("\nStep 5: Testing rapid concurrent double-click on status check...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(request, "POST", f"/api/cases/{case_id}/next-step")
        f2 = executor.submit(request, "POST", f"/api/cases/{case_id}/next-step")
        r1, r2 = f1.result(), f2.result()

    print(f"  Call 1: {r1.get('status')}")
    print(f"  Call 2: {r2.get('status')}")
    assert r1.get("status") == "no_action"
    assert r2.get("status") == "no_action"

    demo_a_conc, exp_conc, audit_conc = get_demo_a()
    assert demo_a_conc["retry_count"] == 2
    assert len(exp_conc["channel_intelligence"]["communication_journey"]) == 2
    assert len(demo_a_conc.get("payment_attempts", [])) == 0
    assert len(audit_conc) == audit_count_before
    print("  Concurrency test PASSED: 0 race conditions, state strictly preserved at 2 of 3.")

    # Final Reset Test
    print("\nStep 6: Resetting demo database to verify original deterministic state restored...")
    reset_final = request("POST", "/api/demo/reset")
    assert reset_final.get("message")
    demo_a_reset, _, _ = get_demo_a()
    assert demo_a_reset["status"] == "recovering"
    assert demo_a_reset["retry_count"] == 1
    assert len(demo_a_reset.get("payment_attempts", [])) == 0
    print("  Reset verified: DEMO-A-AUTO restored to 1 of 3, 0 payment attempts.")

    print("\n" + "=" * 70)
    print(">>> ALL CHECKS FOR 'CHECK RECOVERY STATUS' PASSED PERFECTLY! <<<")
    print("=" * 70)


if __name__ == "__main__":
    main()
