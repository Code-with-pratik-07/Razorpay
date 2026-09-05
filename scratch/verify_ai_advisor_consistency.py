#!/usr/bin/env python3
"""Targeted verification script for AI Advisor Business Insight consistency
and 6-component alignment across DEMO-A-AUTO recovery lifecycles.
"""
import json
import urllib.request
import urllib.error
import sys

BASE_URL = "http://127.0.0.1:8000"


def req(path: str, method: str = "GET", body: dict | None = None) -> dict:
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request) as resp:
        return json.loads(resp.read().decode("utf-8"))


def get_demo_a():
    cases = req("/api/cases?limit=1000")
    demo_a = next(c for c in cases if c["case_number"] == "DEMO-A-AUTO")
    exp = req(f"/api/cases/{demo_a['id']}/explanation")
    audit = req(f"/api/cases/{demo_a['id']}/audit")
    return demo_a, exp, audit


def test_unengaged_sms_switch_lifecycle():
    print("\n" + "=" * 70)
    print("TEST 1: UNENGAGED FLOW (WHATSAPP DELIVERED -> NO ENGAGEMENT -> SMS SWITCH)")
    print("=" * 70)

    # 1. Reset database
    print("\n1. Resetting database to baseline...")
    req("/api/demo/reset", method="POST")

    demo_a, exp1, audit1 = get_demo_a()
    case_id = demo_a["id"]

    # Initial state assertions
    journey1 = exp1["channel_intelligence"]["communication_journey"]
    fup1 = exp1["channel_intelligence"]["followup_decision"]
    ai1 = exp1["ai"]

    assert len(journey1) == 1, f"Expected 1 attempt, got {len(journey1)}"
    assert journey1[0]["attempt_number"] == 1
    assert journey1[0]["channel"] == "whatsapp"
    assert journey1[0]["outcome"] == "DELIVERED"
    assert fup1["next_action"] == "SWITCH_CHANNEL"
    assert fup1["selected_channel"] == "sms"
    print("✓ Initial state verified: Attempt 1 WhatsApp Delivered, Follow-up: SWITCH_CHANNEL to SMS")

    # 2. Trigger next-step (no customer engagement, channel switches to SMS)
    print("\n2. Executing next recovery step (channel switch to SMS)...")
    switch_res = req(f"/api/cases/{case_id}/next-step", method="POST")
    assert switch_res["action"] == "channel_switched"
    assert switch_res["channel"] == "sms"
    assert switch_res["attempt"] == 2

    # 3. Audit all 6 components for strict consistency
    print("\n3. Performing strict consistency audit across 6 components...")
    demo_a2, exp2, audit2 = get_demo_a()
    ci2 = exp2["channel_intelligence"]
    journey2 = ci2["communication_journey"]
    fup2 = ci2["followup_decision"]
    ai2 = exp2["ai"]

    # Component 1: AI Recovery Advisor
    print("   [1] Auditing AI Recovery Advisor Business Insight...")
    insight = ai2["reasoning"]
    print(f"       Advisor Insight: \"{insight}\"")
    
    # Must NOT claim customer engaged
    assert "previously engaged" not in insight.lower(), "CONTRADICTION: Insight falsely claims customer previously engaged!"
    assert "opening the recovery payment link" not in insight.lower(), "CONTRADICTION: Insight falsely claims link was opened!"
    
    # Must explain WhatsApp delivered without engagement -> switched to SMS -> observing in 24h window
    expected_fragment_1 = "The initial WhatsApp recovery communication was delivered but received no customer engagement."
    expected_fragment_2 = "RecoverAI therefore selected SMS as the next-best communication channel."
    expected_fragment_3 = "One recovery attempt remains"
    expected_fragment_4 = "24-hour response window to avoid unnecessary messaging."

    assert expected_fragment_1 in insight, f"Missing fragment 1: '{expected_fragment_1}' in '{insight}'"
    assert expected_fragment_2 in insight, f"Missing fragment 2: '{expected_fragment_2}' in '{insight}'"
    assert expected_fragment_3 in insight, f"Missing fragment 3: '{expected_fragment_3}' in '{insight}'"
    assert expected_fragment_4 in insight, f"Missing fragment 4: '{expected_fragment_4}' in '{insight}'"
    print("       ✓ AI Recovery Advisor Business Insight is truthful and non-contradictory.")

    # Component 2: Channel Intelligence recommended channel
    print("   [2] Auditing Channel Intelligence recommended channel...")
    assert ci2["recommended_channel"] == "sms", f"Expected SMS, got {ci2['recommended_channel']}"
    assert "WHATSAPP notification was delivered but received no engagement" in ci2["reason"]
    print(f"       ✓ Recommended channel: {ci2['recommended_channel']} (Reason: {ci2['reason'][:60]}...)")

    # Component 3: Communication Journey attempts and outcomes
    print("   [3] Auditing Communication Journey...")
    assert len(journey2) == 2, f"Expected 2 attempts, got {len(journey2)}"
    assert journey2[0]["attempt_number"] == 1
    assert journey2[0]["channel"] == "whatsapp"
    assert journey2[0]["outcome"] == "DELIVERED"
    assert journey2[1]["attempt_number"] == 2
    assert journey2[1]["channel"] == "sms"
    assert journey2[1]["outcome"] == "AWAITING_RESPONSE"
    print("       ✓ Attempt 1: WhatsApp (DELIVERED) -> Attempt 2: SMS (AWAITING_RESPONSE)")

    # Component 4: Follow-Up Decision
    print("   [4] Auditing Follow-Up Decision...")
    assert fup2["previous_outcome"] == "AWAITING_RESPONSE"
    assert fup2["next_action"] == "AWAIT_RESPONSE"
    assert fup2["selected_channel"] == "sms"
    assert fup2["recommended_wait_period"] == "24 hours"
    print(f"       ✓ Next Action: {fup2['next_action']}, Channel: {fup2['selected_channel']}, Wait: {fup2['recommended_wait_period']}")

    # Component 5: Observation Period
    print("   [5] Auditing Observation Period...")
    retries = demo_a2["retry_count"]
    max_retries = demo_a2["max_retries"]
    remaining = max_retries - retries
    assert remaining == 1, f"Expected 1 remaining retry, got {remaining}"
    print(f"       ✓ Observation Period Active: Retries={retries}/{max_retries}, Remaining={remaining}")

    # Component 6: Recovery Journey / Audit Timeline
    print("   [6] Auditing Audit Timeline...")
    event_types = [e["event_type"] for e in audit2]
    assert "channel_switched" in event_types, "Missing channel_switched audit event"
    assert "observation_period_started" in event_types, "Missing observation_period_started audit event"
    
    switch_event = next(e for e in audit2 if e["event_type"] == "channel_switched")
    assert switch_event["event_data"]["channel"] == "sms"
    assert switch_event["event_data"]["attempt_number"] == 2

    obs_event = next(e for e in audit2 if e["event_type"] == "observation_period_started")
    assert obs_event["event_data"]["channel"] == "sms"
    assert obs_event["event_data"]["wait_period"] == "24 hours"
    assert obs_event["event_data"]["remaining_attempts"] == 1
    print("       ✓ Audit Timeline records channel_switched to SMS and observation_period_started (24h, 1 remaining)")


def test_engaged_whatsapp_reminder_lifecycle():
    print("\n" + "=" * 70)
    print("TEST 2: ENGAGED FLOW (WHATSAPP DELIVERED -> LINK CLICKED -> REMINDER)")
    print("=" * 70)

    # 1. Reset database
    print("\n1. Resetting database to baseline...")
    req("/api/demo/reset", method="POST")

    demo_a, exp1, audit1 = get_demo_a()
    case_id = demo_a["id"]

    # 2. Simulate customer clicking the link on Attempt 1
    print("\n2. Customer opens payment link on WhatsApp (track-click)...")
    click_res = req(f"/api/cases/{case_id}/track-click", method="POST")
    assert click_res["outcome"] == "LINK_CLICKED"

    demo_a_clicked, exp_clicked, _ = get_demo_a()
    fup_clicked = exp_clicked["channel_intelligence"]["followup_decision"]
    assert fup_clicked["next_action"] == "RETRY_SAME_CHANNEL"
    assert fup_clicked["selected_channel"] == "whatsapp"
    print("   ✓ Click registered, follow-up recommends RETRY_SAME_CHANNEL on WhatsApp")

    # 3. Execute next step (reminder sent via WhatsApp)
    print("\n3. Executing next recovery step (WhatsApp reminder)...")
    step_res = req(f"/api/cases/{case_id}/next-step", method="POST")
    assert step_res["action"] == "reminder_dispatched"
    assert step_res["channel"] == "whatsapp"
    assert step_res["attempt"] == 2

    # 4. Audit AI Recovery Advisor
    print("\n4. Auditing AI Recovery Advisor Business Insight for engaged flow...")
    demo_a2, exp2, audit2 = get_demo_a()
    insight = exp2["ai"]["reasoning"]
    print(f"   Advisor Insight: \"{insight}\"")

    expected_engaged_1 = "The customer previously engaged by opening the recovery payment link, and a WhatsApp reminder was delivered."
    expected_engaged_2 = "One recovery attempt remains within policy limits"
    expected_engaged_3 = "24-hour response window to avoid unnecessary messaging."

    assert expected_engaged_1 in insight, f"Missing engaged fragment 1 in '{insight}'"
    assert expected_engaged_2 in insight, f"Missing engaged fragment 2 in '{insight}'"
    assert expected_engaged_3 in insight, f"Missing engaged fragment 3 in '{insight}'"
    print("   ✓ AI Recovery Advisor Business Insight correctly recognizes and explains customer engagement.")


def main():
    print("=" * 70)
    print("RECOVERAI: STRICT CONSISTENCY & AI RECOVERY ADVISOR VERIFICATION")
    print("=" * 70)

    test_unengaged_sms_switch_lifecycle()
    test_engaged_whatsapp_reminder_lifecycle()

    print("\n" + "=" * 70)
    print("ALL VERIFICATION CHECKS PASSED: ZERO CONTRADICTIONS DETECTED")
    print("=" * 70)


if __name__ == "__main__":
    main()
