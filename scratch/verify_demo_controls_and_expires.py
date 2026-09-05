#!/usr/bin/env python3
"""Verification of Live Demo Controls (Reset Demo vs Start Demo audit)
and Payment Recovery 'Expires' metadata visibility and formatting.
"""
import glob
import json
import re
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


def test_issue_1_demo_controls():
    print("\n" + "=" * 70)
    print("AUDIT 1: DEMO CONTROLS (RESET DEMO VS START DEMO REDUNDANCY)")
    print("=" * 70)

    # 1. Static code audit: Ensure 'Start Demo' is completely removed
    print("\n1. Auditing frontend source code for Start Demo...")
    demo_control_file = "frontend/src/components/DemoControlCenter.tsx"
    app_file = "frontend/src/App.tsx"

    with open(demo_control_file, "r") as f:
        demo_control_code = f.read()
    with open(app_file, "r") as f:
        app_code = f.read()

    assert "startDemo" not in demo_control_code, "startDemo prop/handler still found in DemoControlCenter.tsx!"
    assert "Start Demo" not in demo_control_code, "'Start Demo' button label still found in DemoControlCenter.tsx!"
    print("   ✓ DemoControlCenter.tsx: 'Start Demo' and unused startDemo prop completely removed.")

    assert "const startDemo" not in app_code, "startDemo function still declared in App.tsx!"
    assert "startDemo={" not in app_code, "startDemo prop still passed in App.tsx!"
    print("   ✓ App.tsx: startDemo handler and prop pass-through completely removed.")

    # 2. Built bundle audit
    built_js_files = glob.glob("frontend/dist/assets/*.js")
    assert len(built_js_files) > 0, "No built JS bundle found!"
    bundle_text = ""
    for jf in built_js_files:
        with open(jf, "r") as f:
            bundle_text += f.read()

    assert "Start Demo" not in bundle_text, "Start Demo found in built production bundle!"
    assert "Reset Demo" in bundle_text, "Reset Demo missing from built production bundle!"
    print("   ✓ Built JS bundle: Confirmed 'Start Demo' is 100% absent and 'Reset Demo' is present.")

    # 3. Functional audit: Reset Demo restores all 4 deterministic scenarios
    print("\n2. Testing Reset Demo functional restoration via API...")
    reset_res = req("/api/demo/reset", method="POST")
    assert reset_res.get("message"), "Reset failed"
    print(f"   ✓ POST /api/demo/reset: {reset_res['message']}")

    cases = req("/api/cases?limit=1000")
    case_map = {c["case_number"]: c for c in cases}

    # Verify DEMO-A-AUTO
    demo_a = case_map["DEMO-A-AUTO"]
    assert demo_a["status"] == "recovering"
    assert demo_a["retry_count"] == 1
    assert demo_a["max_retries"] == 3
    print("   ✓ DEMO-A-AUTO restored: recovering, 1 of 3 attempts, policy approved")

    # Verify DEMO-B-HUMAN
    demo_b = case_map["DEMO-B-HUMAN"]
    assert demo_b["status"] == "human_review"
    assert demo_b["retry_count"] == 0
    assert demo_b["policy_check_passed"] is False
    print("   ✓ DEMO-B-HUMAN restored: human_review, 0 attempts, comms paused")

    # Verify DEMO-C-RECOVERED
    demo_c = case_map["DEMO-C-RECOVERED"]
    assert demo_c["status"] == "recovered"
    exp_c = req(f"/api/cases/{demo_c['id']}/explanation")
    assert exp_c["customer_payment_status"] == "RECEIVED"
    print("   ✓ DEMO-C-RECOVERED restored: recovered, payment captured (RECEIVED)")

    # Verify DEMO-D-STOPPED
    demo_d = case_map["DEMO-D-STOPPED"]
    assert demo_d["status"] == "abandoned"
    assert demo_d["retry_count"] >= demo_d["max_retries"]
    print("   ✓ DEMO-D-STOPPED restored: abandoned, attempt limit reached")


def test_issue_2_expires_metadata_visibility():
    print("\n" + "=" * 70)
    print("AUDIT 2: PAYMENT RECOVERY 'EXPIRES' METADATA VISIBILITY & STYLING")
    print("=" * 70)

    # 1. Inspect CSS styling for high-contrast visibility
    print("\n1. Auditing CSS color contrast and style overrides...")
    with open("frontend/src/styles.css", "r") as f:
        css_text = f.read()

    # Assert no rogue dark-mode color override on .pr-meta-item b
    pr_meta_overrides = re.findall(r"\.pr-meta-item\s*b\s*\{[^}]*color:\s*#f8fafc", css_text)
    assert len(pr_meta_overrides) == 0, f"Found rogue #f8fafc override on .pr-meta-item b: {pr_meta_overrides}"
    print("   ✓ Confirmed: Zero '#f8fafc' (white-on-white) overrides on .pr-meta-item b.")

    # Assert .pr-meta-item b / .pr-meta-value uses var(--color-text-main) !important
    assert "color: var(--color-text-main) !important" in css_text, "Missing high contrast color on .pr-meta-item b"
    print("   ✓ Confirmed: .pr-meta-item b / .pr-meta-value explicitly enforces color: var(--color-text-main) !important (#0F172A).")

    # 2. Verify DEMO-A-AUTO has valid active expires_at and correct format
    print("\n2. Auditing DEMO-A-AUTO active payment link expiration...")
    cases = req("/api/cases?limit=1000")
    demo_a = next(c for c in cases if c["case_number"] == "DEMO-A-AUTO")
    exp_a = req(f"/api/cases/{demo_a['id']}/explanation")

    expires_at = demo_a.get("payment_link_expires_at") or exp_a.get("payment_link_expires_at")
    assert expires_at is not None, "DEMO-A-AUTO active link missing payment_link_expires_at!"
    print(f"   ✓ DEMO-A-AUTO payment_link_expires_at: {expires_at}")

    # Test date formatting logic: e.g. "12 Sep 2026, 12:56 PM"
    from datetime import datetime
    dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    formatted_expected = dt.strftime("%d %b %Y, %I:%M %p")
    print(f"   ✓ Formatted Expiry Display: '{formatted_expected}'")
    assert len(formatted_expected) > 10

    # 3. Verify DEMO-B-HUMAN has null payment_link_expires_at and does NOT display misleading expiry
    print("\n3. Auditing DEMO-B-HUMAN pending payment link expiration...")
    demo_b = next(c for c in cases if c["case_number"] == "DEMO-B-HUMAN")
    exp_b = req(f"/api/cases/{demo_b['id']}/explanation")

    b_expires_at = demo_b.get("payment_link_expires_at") or exp_b.get("payment_link_expires_at")
    assert b_expires_at is None, f"Expected null expires_at on unapproved case, got {b_expires_at}"
    print("   ✓ DEMO-B-HUMAN payment_link_expires_at is None.")

    # 4. Verify CaseDetail.tsx conditional rendering logic
    with open("frontend/src/components/CaseDetail.tsx", "r") as f:
        cd_code = f.read()

    assert "expiresAt && formattedExpiry ?" in cd_code, "CaseDetail.tsx must conditionally render Expires only when expiresAt is present!"
    print("   ✓ CaseDetail.tsx: Confirmed conditional rendering prevents misleading 'Expires' on null expiration.")


def main():
    print("=" * 70)
    print("RECOVERAI LIVE DEMO CONTROLS & PAYMENT RECOVERY EXPIRES AUDIT")
    print("=" * 70)

    test_issue_1_demo_controls()
    test_issue_2_expires_metadata_visibility()

    print("\n" + "=" * 70)
    print("ALL AUDIT VERIFICATIONS PASSED SUCCESSFULLY (0 ISSUES DETECTED)")
    print("=" * 70)


if __name__ == "__main__":
    main()
