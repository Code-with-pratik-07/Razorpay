import urllib.request
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

def inspect_all():
    print("Resetting demo database...")
    post("/api/demo/reset")
    
    cases = get("/api/cases")
    case_map = {c["case_number"]: c for c in cases}
    
    targets = ["DEMO-A-AUTO", "DEMO-B-HUMAN", "DEMO-C-RECOVERED", "DEMO-D-STOPPED"]
    
    results = {}
    for t in targets:
        c = case_map.get(t)
        if not c:
            print(f"ERROR: {t} not found!")
            continue
        exp = get(f"/api/cases/{c['id']}/explanation")
        
        ci = exp.get("channel_intelligence", {})
        followup = ci.get("followup_decision", {})
        journey = ci.get("communication_journey", [])
        pay_attempts = exp.get("payment_attempts", [])
        cust_hist = exp.get("customer_history", {})
        
        results[t] = {
            "status": exp.get("status"),
            "ml_probability": exp.get("ml", {}).get("recovery_probability"),
            "policy_decision": "Approved" if exp.get("policy", {}).get("allowed") else "Requires Human Review",
            "comm_attempts": f"{len(journey)} of {c.get('max_retries', 3)}",
            "payment_attempts": len(pay_attempts),
            "customer_history": f"{cust_hist.get('interaction_count', 0)} transactions (Maturity: {ci.get('communication_maturity')})",
            "maturity_desc": ci.get("maturity_desc") or ci.get("maturity_description"),
            "payment_link_state": exp.get("payment_link_status"),
            "next_action": followup.get("next_action"),
            "customer_payment_status": exp.get("customer_payment_status")
        }
        
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    inspect_all()
