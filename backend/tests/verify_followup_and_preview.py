import urllib.request
import urllib.error
import json

BASE = "http://127.0.0.1:8000"

def get(path):
    req = urllib.request.Request(f"{BASE}{path}")
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode())

def post(path, data=None):
    payload = json.dumps(data or {}).encode()
    req = urllib.request.Request(f"{BASE}{path}", data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode())

def run():
    print("==================================================")
    print("1. Resetting demo database...")
    reset_res = post("/api/demo/reset")
    print("Reset response:", reset_res)

    print("\n2. Fetching cases...")
    cases = get("/api/cases")
    case_map = {c["case_number"]: c for c in cases}
    print("Found showcase cases:", [k for k in case_map if k.startswith("DEMO-")])

    # ----------------------------------------------------
    # DEMO-A-AUTO
    # ----------------------------------------------------
    print("\n==================================================")
    print("VERIFYING DEMO-A-AUTO")
    demo_a = case_map["DEMO-A-AUTO"]
    exp_a = get(f"/api/cases/{demo_a['id']}/explanation")
    intel_a = exp_a["channel_intelligence"]
    journey_a = intel_a["communication_journey"]
    followup_a = intel_a["followup_decision"]

    print("Status:", demo_a["status"])
    print("Journey channels:", [f"{j['channel']} (Attempt {j['attempt_number']}, outcome={j['outcome']})" for j in journey_a])
    print("Follow-up Decision:", followup_a)
    print("AI Reasoning:", exp_a["ai"]["reasoning"])

    assert len(journey_a) == 1, f"Expected 1 record, got {len(journey_a)}"
    assert journey_a[0]["channel"] == "whatsapp", f"Expected whatsapp, got {journey_a[0]['channel']}"
    assert journey_a[0]["outcome"] == "LINK_CLICKED", f"Expected LINK_CLICKED, got {journey_a[0]['outcome']}"
    assert followup_a["previous_outcome"] == "LINK_CLICKED"
    assert followup_a["recommended_wait_period"] == "24 hours"
    assert followup_a["next_action"] == "RETRY_SAME_CHANNEL"
    assert followup_a["selected_channel"] == "whatsapp"
    assert "remains effective" in followup_a["reason"]

    # Test next-step endpoint on DEMO-A-AUTO
    print("\nTriggering [Run Next Recovery Step] on DEMO-A-AUTO...")
    next_step_res = post(f"/api/cases/{demo_a['id']}/next-step")
    print("Next step result:", next_step_res["action"], next_step_res.get("channel"))
    exp_a2 = get(f"/api/cases/{demo_a['id']}/explanation")
    journey_a2 = exp_a2["channel_intelligence"]["communication_journey"]
    print("Updated journey channels:", [f"{j['channel']} (Attempt {j['attempt_number']}, outcome={j['outcome']})" for j in journey_a2])
    assert len(journey_a2) == 2, f"Expected 2 records after next step, got {len(journey_a2)}"
    assert journey_a2[1]["channel"] == "whatsapp", f"Expected Attempt 2 to be WhatsApp, got {journey_a2[1]['channel']}"
    assert journey_a2[1]["attempt_number"] == 2

    # ----------------------------------------------------
    # DEMO-B-HUMAN
    # ----------------------------------------------------
    print("\n==================================================")
    print("VERIFYING DEMO-B-HUMAN")
    demo_b = case_map["DEMO-B-HUMAN"]
    exp_b = get(f"/api/cases/{demo_b['id']}/explanation")
    journey_b = exp_b["channel_intelligence"]["communication_journey"]
    followup_b = exp_b["channel_intelligence"]["followup_decision"]

    print("Pre-approval status:", demo_b["status"])
    print("Pre-approval journey records:", journey_b)
    print("Pre-approval comm status:", exp_b["communication_status"])
    print("Pre-approval follow-up decision:", followup_b)

    assert len(journey_b) == 0, f"Expected 0 pre-approval records, got {len(journey_b)}"
    assert exp_b["human_review_status"] == "REQUIRED"
    assert exp_b["communication_status"] == "PAUSED"
    assert followup_b["next_action"] == "AWAIT_APPROVAL"

    print("\nApproving DEMO-B-HUMAN...")
    exec_res = post(f"/api/cases/{demo_b['id']}/execute")
    exp_b_post = get(f"/api/cases/{demo_b['id']}/explanation")
    print("Post-approval human status:", exp_b_post["human_review_status"])
    print("Post-approval link status:", exp_b_post["payment_link_status"])
    print("Post-approval comm status:", exp_b_post["communication_status"])
    print("Post-approval recommended channel:", exp_b_post["recommended_channel"])
    assert exp_b_post["human_review_status"] == "APPROVED"
    assert exp_b_post["payment_link_status"] == "ACTIVE"
    assert exp_b_post["recommended_channel"] == "email"

    print("\nSimulating dispatch for DEMO-B-HUMAN...")
    disp_res = post(f"/api/cases/{demo_b['id']}/dispatch-communication", {"channel": "email"})
    exp_b_disp = get(f"/api/cases/{demo_b['id']}/explanation")
    journey_b_disp = exp_b_disp["channel_intelligence"]["communication_journey"]
    print("Post-dispatch journey:", [f"{j['channel']} (Attempt {j['attempt_number']})" for j in journey_b_disp])
    assert len(journey_b_disp) == 1
    assert journey_b_disp[0]["channel"] == "email"

    # ----------------------------------------------------
    # DEMO-C-RECOVERED
    # ----------------------------------------------------
    print("\n==================================================")
    print("VERIFYING DEMO-C-RECOVERED")
    demo_c = case_map["DEMO-C-RECOVERED"]
    exp_c = get(f"/api/cases/{demo_c['id']}/explanation")
    journey_c = exp_c["channel_intelligence"]["communication_journey"]
    followup_c = exp_c["channel_intelligence"]["followup_decision"]

    print("Status:", demo_c["status"])
    print("Journey channels:", [f"{j['channel']} (Attempt {j['attempt_number']}, attr={j['recovery_attributed']})" for j in journey_c])
    print("Followup decision:", followup_c)

    assert len(journey_c) == 1
    assert journey_c[0]["channel"] == "sms"
    assert journey_c[0]["recovery_attributed"] is True
    assert followup_c["next_action"] == "STOP_RECOVERY"

    # Verify terminal protection
    try:
        post(f"/api/cases/{demo_c['id']}/next-step")
        assert False, "Should have blocked next-step on terminal recovered case"
    except urllib.error.HTTPError as e:
        print("Terminal check on next-step returned expected HTTP", e.code)
        assert e.code == 400

    # ----------------------------------------------------
    # DEMO-D-STOPPED
    # ----------------------------------------------------
    print("\n==================================================")
    print("VERIFYING DEMO-D-STOPPED")
    demo_d = case_map["DEMO-D-STOPPED"]
    exp_d = get(f"/api/cases/{demo_d['id']}/explanation")
    journey_d = exp_d["channel_intelligence"]["communication_journey"]
    followup_d = exp_d["channel_intelligence"]["followup_decision"]

    print("Status:", demo_d["status"])
    print("Journey channels:", [f"{j['channel']} (Attempt {j['attempt_number']}, outcome={j['outcome']})" for j in journey_d])
    print("Followup decision:", followup_d)

    assert len(journey_d) == 2, f"Expected exactly 2 attempts, got {len(journey_d)}"
    assert journey_d[0]["channel"] == "whatsapp", f"Expected Attempt 1 WhatsApp, got {journey_d[0]['channel']}"
    assert journey_d[1]["channel"] == "sms", f"Expected Attempt 2 SMS, got {journey_d[1]['channel']}"
    assert not any(j["channel"] == "email" for j in journey_d), "Email must not exist in DEMO-D"
    assert followup_d["next_action"] == "STOP_RECOVERY"

    try:
        post(f"/api/cases/{demo_d['id']}/next-step")
        assert False, "Should have blocked next-step on terminal abandoned case"
    except urllib.error.HTTPError as e:
        print("Terminal check on next-step returned expected HTTP", e.code)
        assert e.code == 400

    print("\n==================================================")
    print("ALL VERIFICATIONS COMPLETED SUCCESSFULLY!")

if __name__ == "__main__":
    run()
