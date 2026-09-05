#!/usr/bin/env python3
"""Comprehensive Verification of RecoverAI Recovery Journey & Audit Timeline Consistency.

Tests:
- Part 11: Primary deterministic DEMO-A-AUTO recovery lifecycle
- Part 12: Legitimate channel-switch scenario (no customer engagement -> SMS)
- Part 13: Deterministic reset consistency across 3 consecutive mutation-reset cycles
"""
import json
import sys
import urllib.error
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


def get_case_data(case_number: str) -> tuple[dict, dict, list]:
    cases = request("GET", "/api/cases?limit=1000")
    case = next(c for c in cases if c["case_number"] == case_number)
    exp = request("GET", f"/api/cases/{case['id']}/explanation")
    audit = request("GET", f"/api/cases/{case['id']}/audit")
    return case, exp, audit


def test_part_11_demo_a_lifecycle():
    print("\n" + "=" * 70)
    print("PART 11: DEMO-A-AUTO PRIMARY RECOVERY LIFECYCLE AUDIT")
    print("=" * 70)

    # 1. Reset demo
    print("1. Resetting demo database to authoritative baseline...")
    res = request("POST", "/api/demo/reset")
    assert res.get("message"), f"Reset failed: {res}"

    # 2. Verify initial DEMO-A-AUTO state
    case, exp, audit = get_case_data("DEMO-A-AUTO")
    case_id = case["id"]
    print(f"2. Initial state for {case['case_number']} (ID: {case_id}):")
    print(f"   Status: {case['status']} (expected: recovering)")
    print(f"   Attempts: {case['retry_count']} of {case['max_retries']} (expected: 1 of 3)")
    print(f"   Payment Attempts: {len(case.get('payment_attempts', []))} (expected: 0)")

    journey = exp["channel_intelligence"]["communication_journey"]
    assert case["status"] == "recovering"
    assert case["retry_count"] == 1
    assert case["max_retries"] == 3
    assert len(case.get("payment_attempts", [])) == 0
    assert len(journey) == 1
    assert journey[0]["channel"] == "whatsapp"
    assert journey[0]["outcome"] == "DELIVERED"

    # Verify duplicate policy_check removal
    policy_events = [e for e in audit if e["event_type"] == "policy_check"]
    print(f"   Policy check audit events: {len(policy_events)} (expected: exactly 1 canonical event)")
    assert len(policy_events) == 1, f"Expected 1 policy_check event, found {len(policy_events)}"

    # 3. Track payment link click
    print("\n3. Tracking customer opening payment link (track-click)...")
    click_res = request("POST", f"/api/cases/{case_id}/track-click")
    assert click_res.get("outcome") == "LINK_CLICKED"

    case, exp, audit = get_case_data("DEMO-A-AUTO")
    journey = exp["channel_intelligence"]["communication_journey"]
    followup = exp["channel_intelligence"]["followup_decision"]

    print(f"   Attempt 1 Outcome: {journey[0]['outcome']} (expected: LINK_CLICKED)")
    print(f"   retry_count: {case['retry_count']} (expected: 1, unchanged)")
    print(f"   Payment Attempts: {len(case.get('payment_attempts', []))} (strictly: 0)")
    print(f"   Follow-up Next Action: {followup['next_action']} (expected: RETRY_SAME_CHANNEL)")
    print(f"   Follow-up Selected Channel: {followup['selected_channel']} (expected: whatsapp)")

    assert journey[0]["outcome"] == "LINK_CLICKED"
    assert case["retry_count"] == 1
    assert len(case.get("payment_attempts", [])) == 0
    assert followup["next_action"] == "RETRY_SAME_CHANNEL"
    assert followup["selected_channel"] == "whatsapp"

    # 4. Execute next recovery step (Attempt 1 -> Attempt 2)
    print("\n4. Triggering 'Simulate Next Recovery Step' (Attempt 1 -> Attempt 2)...")
    step_res = request("POST", f"/api/cases/{case_id}/next-step")
    print(f"   Step Result: action={step_res.get('action')}, channel={step_res.get('channel')}, attempt={step_res.get('attempt')}")
    assert step_res.get("action") == "reminder_dispatched"
    assert step_res.get("channel") == "whatsapp"
    assert step_res.get("attempt") == 2

    case, exp, audit = get_case_data("DEMO-A-AUTO")
    journey = exp["channel_intelligence"]["communication_journey"]
    followup = exp["channel_intelligence"]["followup_decision"]

    print(f"   retry_count: {case['retry_count']} of {case['max_retries']} (expected: 2 of 3)")
    print(f"   Communication records: {len(journey)} (expected: 2)")
    print(f"   Attempt 1: {journey[0]['channel']} -> {journey[0]['outcome']}")
    print(f"   Attempt 2: {journey[1]['channel']} -> {journey[1]['outcome']}")
    print(f"   Follow-up Next Action: {followup['next_action']} (expected: AWAIT_RESPONSE)")

    assert case["retry_count"] == 2
    assert len(journey) == 2
    assert journey[1]["channel"] == "whatsapp"
    assert journey[1]["attempt_number"] == 2
    assert journey[1]["outcome"] == "AWAITING_RESPONSE"

    # Audit timeline verification:
    event_types = [e["event_type"] for e in audit]
    print(f"   Audit event sequence: {event_types}")

    assert "recovery_reminder_dispatched" in event_types
    rem_event = next(e for e in audit if e["event_type"] == "recovery_reminder_dispatched")
    assert rem_event["event_data"]["channel"] == "whatsapp"
    assert rem_event["event_data"]["attempt_number"] == 2

    assert "observation_period_started" in event_types
    obs_event = next(e for e in audit if e["event_type"] == "observation_period_started")
    assert obs_event["event_data"]["channel"] == "whatsapp"
    assert obs_event["event_data"]["attempt_number"] == 2
    assert obs_event["event_data"]["remaining_attempts"] == 1

    # STRICT CHECK: No channel_switched event may exist in this WhatsApp-engaged lifecycle!
    switched_events = [e for e in audit if e["event_type"] == "channel_switched"]
    print(f"   channel_switched events in WhatsApp flow: {len(switched_events)} (strictly expected: 0)")
    assert len(switched_events) == 0, f"Found unexpected channel_switched events: {switched_events}"

    # 5. Click Check Recovery Status (Awaiting Response)
    print("\n5. Clicking 'Check Recovery Status (Awaiting Response)'...")
    check_res = request("POST", f"/api/cases/{case_id}/next-step")
    print(f"   Response status: {check_res.get('status')} (expected: no_action)")
    assert check_res.get("status") == "no_action"

    case_after, exp_after, audit_after = get_case_data("DEMO-A-AUTO")
    assert case_after["retry_count"] == 2, "retry_count must remain 2!"
    assert len(exp_after["channel_intelligence"]["communication_journey"]) == 2, "Records count must remain 2!"
    assert len(case_after.get("payment_attempts", [])) == 0, "Payment attempts must remain 0!"
    assert len(audit_after) == len(audit), "Audit event count must remain exactly unchanged on no_action!"
    print("   Idempotent no_action check PASSED: zero side effects, retry_count=2, 0 duplicate events.")

    # 6. Reset demo and verify deterministic restoration
    print("\n6. Resetting demo and verifying restoration...")
    reset_res = request("POST", "/api/demo/reset")
    assert reset_res.get("message")

    case_restored, exp_restored, audit_restored = get_case_data("DEMO-A-AUTO")
    assert case_restored["status"] == "recovering"
    assert case_restored["retry_count"] == 1
    assert len(exp_restored["channel_intelligence"]["communication_journey"]) == 1
    assert len(case_restored.get("payment_attempts", [])) == 0
    assert not any(e["event_type"] == "channel_switched" for e in audit_restored)
    print("   Part 11 verification PASSED completely!")


def test_part_12_legitimate_channel_switch():
    print("\n" + "=" * 70)
    print("PART 12: LEGITIMATE CHANNEL-SWITCH SCENARIO AUDIT (NO ENGAGEMENT -> SMS)")
    print("=" * 70)

    # 1. Reset demo
    request("POST", "/api/demo/reset")

    case, exp, audit = get_case_data("DEMO-A-AUTO")
    case_id = case["id"]

    # Initial state: Attempt 1 = WhatsApp (DELIVERED, no customer engagement)
    journey = exp["channel_intelligence"]["communication_journey"]
    assert journey[0]["outcome"] == "DELIVERED"
    print(f"1. Initial state: Attempt 1 is {journey[0]['channel']} ({journey[0]['outcome']}, no engagement tracked)")

    followup = exp["channel_intelligence"]["followup_decision"]
    print(f"2. Follow-up decision on unengaged WhatsApp: {followup['next_action']} -> {followup['selected_channel']}")
    assert followup["next_action"] == "SWITCH_CHANNEL"
    assert followup["selected_channel"] == "sms"

    # Execute next recovery step: legitimately switches to SMS
    print("3. Executing next recovery step on unengaged case...")
    step_res = request("POST", f"/api/cases/{case_id}/next-step")
    print(f"   Step Result: action={step_res.get('action')}, channel={step_res.get('channel')}, attempt={step_res.get('attempt')}")
    assert step_res.get("action") == "channel_switched"
    assert step_res.get("channel") == "sms"
    assert step_res.get("attempt") == 2

    # Verify all layers agree on SMS
    case_switched, exp_switched, audit_switched = get_case_data("DEMO-A-AUTO")
    journey_switched = exp_switched["channel_intelligence"]["communication_journey"]
    followup_switched = exp_switched["channel_intelligence"]["followup_decision"]

    print("4. Verifying cross-layer consistency on switched channel (SMS):")
    print(f"   Communication Journey Attempt 2: {journey_switched[1]['channel']} (expected: sms)")
    print(f"   Follow-up Selected Channel: {followup_switched['selected_channel']} (expected: sms)")
    print(f"   Case selected_channel: {case_switched.get('selected_channel')} (expected: sms)")

    assert journey_switched[1]["channel"] == "sms"
    assert journey_switched[1]["attempt_number"] == 2
    assert journey_switched[1]["outcome"] == "AWAITING_RESPONSE"
    assert followup_switched["selected_channel"] == "sms"
    assert followup_switched["next_action"] == "AWAIT_RESPONSE"
    assert case_switched.get("selected_channel") == "sms"

    # Audit timeline verification
    event_types = [e["event_type"] for e in audit_switched]
    assert "channel_switched" in event_types
    switch_event = next(e for e in audit_switched if e["event_type"] == "channel_switched")
    assert switch_event["event_data"]["channel"] == "sms"
    assert switch_event["event_data"]["attempt_number"] == 2

    assert "observation_period_started" in event_types
    obs_event = next(e for e in audit_switched if e["event_type"] == "observation_period_started")
    assert obs_event["event_data"]["channel"] == "sms"
    assert obs_event["event_data"]["attempt_number"] == 2

    print("   Part 12 verification PASSED: All layers agree 100% on SMS!")


def test_part_13_reset_consistency_three_cycles():
    print("\n" + "=" * 70)
    print("PART 13: DETERMINISTIC RESET CONSISTENCY (3 CONSECUTIVE CYCLES)")
    print("=" * 70)

    for cycle in range(1, 4):
        print(f"\n--- CYCLE {cycle} of 3 ---")
        # 1. Reset
        reset_res = request("POST", "/api/demo/reset")
        assert reset_res.get("message")

        case, exp, audit = get_case_data("DEMO-A-AUTO")
        case_id = case["id"]

        # Invariants after reset
        assert case["status"] == "recovering"
        assert case["retry_count"] == 1
        assert len(exp["channel_intelligence"]["communication_journey"]) == 1
        assert len(case.get("payment_attempts", [])) == 0
        policy_checks = [e for e in audit if e["event_type"] == "policy_check"]
        assert len(policy_checks) == 1, f"Cycle {cycle}: Expected 1 policy_check, got {len(policy_checks)}"
        assert not any(e["event_type"] == "channel_switched" for e in audit)
        print(f"Cycle {cycle}: Initial state clean. Mutating...")

        # 2. Mutate depending on cycle
        if cycle == 1:
            # Click link then next step
            request("POST", f"/api/cases/{case_id}/track-click")
            request("POST", f"/api/cases/{case_id}/next-step")
            c_mut, _, a_mut = get_case_data("DEMO-A-AUTO")
            assert c_mut["retry_count"] == 2
            assert any(e["event_type"] == "recovery_reminder_dispatched" for e in a_mut)
            assert not any(e["event_type"] == "channel_switched" for e in a_mut)

        elif cycle == 2:
            # Next step without click (channel switch)
            request("POST", f"/api/cases/{case_id}/next-step")
            c_mut, _, a_mut = get_case_data("DEMO-A-AUTO")
            assert c_mut["retry_count"] == 2
            assert any(e["event_type"] == "channel_switched" for e in a_mut)

        elif cycle == 3:
            # Click, next step, then simulate payment
            request("POST", f"/api/cases/{case_id}/track-click")
            request("POST", f"/api/cases/{case_id}/next-step")
            pay_res = request("POST", f"/api/demo/simulate-payment/{case_id}", {"payment_method": "card", "action": "success"})
            assert pay_res.get("success") is True
            c_mut, _, _ = get_case_data("DEMO-A-AUTO")
            assert c_mut["status"] == "recovered"

        print(f"Cycle {cycle}: Mutation completed. Resetting...")

        # 3. Reset again and verify pristine state
        request("POST", "/api/demo/reset")
        c_restored, exp_restored, audit_restored = get_case_data("DEMO-A-AUTO")
        assert c_restored["status"] == "recovering"
        assert c_restored["retry_count"] == 1
        assert len(exp_restored["channel_intelligence"]["communication_journey"]) == 1
        assert len(c_restored.get("payment_attempts", [])) == 0
        policy_restored = [e for e in audit_restored if e["event_type"] == "policy_check"]
        assert len(policy_restored) == 1
        assert not any(e["event_type"] == "channel_switched" for e in audit_restored)
        assert not any(e["event_type"] == "observation_period_started" for e in audit_restored)
        print(f"Cycle {cycle}: Pristine baseline verified successfully!")

    print("\nPart 13: ALL 3 MUTATION-RESET CYCLES PASSED PERFECTLY!")


def main():
    print("=" * 70)
    print("RECOVERAI: RECOVERY JOURNEY & AUDIT TIMELINE STRICT AUDIT SUITE")
    print("=" * 70)
    test_part_11_demo_a_lifecycle()
    test_part_12_legitimate_channel_switch()
    test_part_13_reset_consistency_three_cycles()
    print("\n" + "=" * 70)
    print(">>> ALL AUDIT & RECOVERY JOURNEY CONSISTENCY TESTS PASSED! <<<")
    print("=" * 70)


if __name__ == "__main__":
    main()
