# RecoverAI Hackathon Demo Guide

This guide details the exact 5-minute presentation flow for the Razorpay RecoverAI project. Follow this script to clearly demonstrate the value, safety, and functionality of the ML-driven recovery pipeline.

---

## Preparation

1. Open the RecoverAI Dashboard in your browser.
2. Ensure you see the `DEMO MODE · Razorpay Test Environment` badge.
3. Click **Start Demo** in the LIVE DEMO panel to reset the dataset and automatically select Case A (`DEMO-A-AUTO`).

---

## The 5-Minute Presentation

### 0:00 — Problem
**Goal:** Introduce the problem.
**Action:** Point to the dashboard header and the "Revenue at Risk" metric.
**Script:** 
> "Failed payments cause significant revenue leakage for merchants. Traditionally, discovering and recovering these payments is a manual, inefficient process. RecoverAI solves this by providing automated, intelligent payment recovery."

### 0:30 — Failure Reception & Analysis
**Goal:** Show how RecoverAI processes failures.
**Action:** With Case 01 (`DEMO-A-AUTO`) selected, point to the Decision Pipeline.
**Script:** 
> "RecoverAI receives the payment failure through a Razorpay webhook. The system instantly analyzes the failure. First, our ML model predicts the likelihood of successful recovery. Then, our deterministic Policy Engine evaluates the rules, and an AI Advisor provides a recommendation."

### 1:15 — Safety Architecture
**Goal:** Demonstrate that AI is advisory, while Policy is authoritative.
**Action:** Click **02 Human Review** (`DEMO-B-HUMAN`) in the LIVE DEMO panel.
**Script:** 
> "Safety is critical in financial operations. Here, the AI Advisor might recommend action, but our Policy Engine blocks it because the amount exceeds the automatic recovery limit. The AI is advisory; the Policy Engine is authoritative. This prevents risky actions and escalates the case for human review."

### 2:00 — Automatic Recovery
**Goal:** Show the successful automated path.
**Action:** Click **01 Automatic Recovery** (`DEMO-A-AUTO`). Show the "RECOVERY" step in the pipeline. Click the **Execute** button to demonstrate the Razorpay integration (this converts the mock link to a real Razorpay Test Mode link).
**Script:** 
> "Returning to our eligible case, because the policy approved it, RecoverAI automatically creates a legitimate Razorpay Payment Link and sends a notification to the customer. We are now awaiting payment."

### 3:00 — Successful Recovery
**Goal:** Show the success webhook completing the cycle.
**Action:** Click **03 Recovered Payment** (`DEMO-C-RECOVERED`).
**Script:** 
> "Once the customer pays via the generated link, Razorpay sends a success webhook back to RecoverAI. The case is marked as RECOVERED, and the revenue is successfully recaptured without any human intervention."

### 3:45 — Engineering Reliability
**Goal:** Demonstrate duplicate protection.
**Action:** Click **04 Duplicate Protection** (`DEMO-D-DUPLICATE`).
**Script:** 
> "To prevent spam and duplicate links, RecoverAI enforces strict concurrency protection. Since a recovery action is already in progress here, the system prevents any duplicate executions."

### 4:30 — Business Impact
**Goal:** Summarize the value proposition.
**Action:** Point to the top metric cards (Revenue at Risk, Recovered Revenue, Recovery Rate, Automatic Recoveries).
**Script:** 
> "In summary, RecoverAI gives merchants complete visibility into their revenue at risk and recovered revenue, automating the safe cases and routing the risky ones to human review. Thank you!"

---

## Demo Scenarios Reference

- **01 Automatic Recovery (`DEMO-A-AUTO`)**: Perfect path. FAILED → ML → POLICY ALLOWED → RECOVERING.
- **02 Human Review (`DEMO-B-HUMAN`)**: Blocked path. FAILED → ML → POLICY BLOCKED → HUMAN REVIEW.
- **03 Recovered (`DEMO-C-RECOVERED`)**: Success path. Case closed successfully.
- **04 Duplicate Protection (`DEMO-D-DUPLICATE`)**: Protected path. Action already executed; no duplicates allowed.
