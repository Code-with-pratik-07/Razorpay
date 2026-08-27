# RecoverAI: Complete Beginner's Guide

Welcome to RecoverAI! This guide is written for you to fully understand every part of the system, even if you are not a developer. You can read this from beginning to end to understand the project deeply and demonstrate it confidently to a hackathon judge.

---

## PART 1 — WHAT IS RECOVERAI?

**What problem RecoverAI solves:** When a business charges customers (like for a subscription), some payments fail because of expired cards, empty bank accounts, or network errors. Businesses lose a lot of money (called "revenue churn") because they can't recover these failed payments efficiently.

**Who would use it:** Online businesses, SaaS (Software as a Service) companies, and subscription platforms that use Razorpay for payments.

**What happens when a payment fails:** A record of the failed transaction is sent to the business. Usually, the business just blindly emails the customer asking them to pay again.

**Why simply retrying every failed payment is not ideal:** Some customers are highly unlikely to ever pay (e.g., fraudulent accounts), and constantly sending payment links costs the business money and damages customer relationships. Sometimes, the failed amount is too high to trust to an automated system without human review.

**What RecoverAI does differently:** It uses Machine Learning (ML) to predict *if* the customer will actually pay, a strict Policy Engine to ensure safety, and Generative AI to recommend the best way to ask the customer for money.

**The complete system in one paragraph:** RecoverAI is a smart dashboard that catches failed Razorpay payments. It uses Machine Learning to calculate the probability of recovering the money, applies strict business rules to decide if it's safe to ask for it, and uses AI to generate personalized communication. When approved, it automatically generates a new Razorpay Payment Link, tracks when the customer pays, and keeps an airtight audit log of every step for financial safety.

**The one-sentence explanation I should memorize:**
*"RecoverAI is an intelligent payment recovery platform that uses ML to predict recovery probability, strict policies to ensure financial safety, and AI to orchestrate Razorpay payment links to win back lost revenue."*

### "ML predicts. Policy decides. AI recommends. Recovery executes."

*   **ML predicts:** Machine Learning looks at past data and guesses the *probability* (e.g., 85%) that this specific customer will successfully pay if we try to recover the money.
*   **Policy decides:** A hardcoded set of business rules (the Policy Engine) acts as a security guard. Even if ML says 99%, the policy might say "No, this amount is too large for automation, send it to a human."
*   **AI recommends:** A large language model (Groq/Llama) looks at the ML score and the policy decision, and *advises* on what action to take (e.g., "Send a payment link") and drafts a polite message to the customer.
*   **Recovery executes:** The system actually talks to Razorpay, generates a real, clickable payment link for the exact amount owed, and monitors the transaction until it succeeds.

---

## PART 2 — THE COMPLETE SYSTEM FLOW

```text
Customer
  ↓
Payment fails
  ↓
RecoverAI case (A new FAILED case appears in the dashboard)
  ↓
Analyze (User clicks the button to evaluate the case)
  ↓
ML prediction (Model calculates an 85% chance of success)
  ↓
Policy Engine (Rules check if the case is safe to automate)
  ↓
AI/Groq recommendation (AI suggests sending a payment link)
  ↓
Execute Recovery (User clicks Execute to perform the action)
  ↓
Razorpay Payment Link (Backend asks Razorpay for a real checkout link)
  ↓
Customer pays (Customer clicks the link and enters their card)
  ↓
Razorpay webhook (Razorpay secretly pings our server: "Payment successful!")
  ↓
RecoverAI updates case (Backend updates the database)
  ↓
Recovered (Case turns green in the dashboard)
  ↓
Audit Trail (Every single step above is permanently logged)
```

**Step-by-Step Breakdown:**

1.  **Payment fails:** A transaction fails. (In a live system, a webhook would trigger this. In our demo, these are pre-seeded in the database).
2.  **RecoverAI case:** A record is created in our database. *Code: `models/payment_case.py`*
3.  **Analyze:** The user clicks the Analyze button. *Code: `App.tsx` (Frontend)* sends a request to our API.
4.  **ML prediction:** The backend asks our ML model how likely the customer is to pay. *Code: `ml/predict.py`*. Input: Case data. Output: A percentage score (0.0 to 1.0).
5.  **Policy Engine:** The backend runs strict business rules (e.g., "Is the amount > ₹5,000?"). *Code: `services/policy_service.py`*. Input: The case. Output: Allowed or Blocked.
6.  **AI/Groq recommendation:** We send the ML score and Policy result to Groq (a fast AI provider). Groq returns an advisory action and a drafted customer message. *Code: `ai/groq_service.py`*.
7.  **Execute Recovery:** The user clicks the Execute button. *Code: `App.tsx`* calls the backend execution API.
8.  **Razorpay Payment Link:** The backend calls Razorpay's API to generate a link. *Code: `services/razorpay_service.py`*. Input: Amount and Currency. Output: A unique `rzp.io` link.
9.  **Razorpay webhook:** When the customer pays, Razorpay sends an automatic HTTP message to our server. *Code: `api/webhooks.py`*.
10. **Audit Trail:** Throughout this process, every action is logged into a permanent history. *Code: `services/audit_service.py`*.

---

## PART 3 — WHAT ARE THE 50 DEMO CASES?

To make the dashboard look like a real, active business during a hackathon, we automatically populate the database with **50 fake cases**.

*   **Where they come from:** They are generated by a script when the backend starts. *Code: `services/demo_service.py`*.
*   **Are they real?** No. They use fake emails (`demo_user_xxx@example.com`) and fake case numbers (`DEMO-XXXXXXXXXX`).
*   **Are amounts real?** The amounts are randomly generated but realistic.
*   **Failure reasons:** Things like `insufficient_funds` or `card_expired`. They are just text labels to look realistic.
*   **Why different statuses?** To show off the UI!
    *   **FAILED:** Cases waiting for you to analyze and execute them.
    *   **RECOVERING:** Cases where a payment link has already been sent, waiting for the customer to pay.
    *   **RECOVERED:** Cases where the customer successfully paid.
    *   **HUMAN REVIEW:** Cases blocked by policy because they were too risky or too large.
*   **What "Potential" / Recovery Probability means:** This is a pre-calculated ML score showing the likelihood (e.g., 85%) of recovering the funds.

These 50 cases exist entirely so that a judge can look at the dashboard and immediately understand what the software does without waiting for 50 real payments to fail.

---

## PART 4 — UNDERSTAND ONE CASE

If you select one case on the dashboard, you'll see these fields:

*   **Case ID:** A unique identifier (e.g., `DEMO-123456`).
*   **Customer:** The email address of the person who owes money.
*   **Amount:** How much they owe (e.g., ₹1,499.00).
*   **Payment method:** How they originally tried to pay (e.g., `card`, `upi`).
*   **Failure reason:** Why it failed (e.g., `insufficient_funds`).
*   **Retries:** How many times we've tried to recover this money (usually 0 at first).
*   **Potential (ML Score):** Our Machine Learning model's prediction of success (e.g., High - 85%).
*   **Policy:** Whether our hardcoded business rules `Allow` or `Block` automated recovery for this specific case.
*   **Status:** The current state of the case (`Failed`, `Recovering`, `Recovered`, `Human Review`).
*   **Customer history:** The lifetime value of the customer (how much they've spent with us historically) to help decide if they are a good customer worth saving.

---

## PART 5 — WHAT DOES ANALYZE DO?

**Analyze is an investigation tool.** It evaluates the case but *does not actually try to collect money*.

When you click **ANALYZE**:
1.  **Frontend button:** The UI shows a loading spinner.
2.  **API request:** The frontend asks the backend (`/api/cases/{id}/analyze`) to evaluate the case.
3.  **ML model:** The backend feeds the customer's data into the Machine Learning model to get a Recovery Probability (e.g., 85%).
4.  **Policy Engine:** The backend runs the business rules. Let's say the amount is ₹1,368 (which is under our ₹5,000 limit), so the policy says "Allowed".
5.  **Groq/AI:** The backend tells the AI: *"We have a failed payment of ₹1,368. The ML says there's an 85% chance of success, and our policy Allows automation. What should we do?"*
6.  **AI Recommendation:** The AI replies: *"Action: Send Payment Link. Message: 'Hi, your payment failed. Please use this link to retry.'"*
7.  **Audit events:** The backend logs "ML Prediction made", "Policy Checked", and "AI Advised" into the database.
8.  **UI Refresh:** The frontend receives all this data and displays the AI Recommendation panel.

**Analyze is safe.** You can click Analyze a hundred times and it will never accidentally charge a customer.

---

## PART 6 — WHAT IS THE ML MODEL?

*   **What ML means:** Machine Learning is a way to teach a computer to recognize patterns by showing it historical data, rather than writing explicit `if/then` rules.
*   **What our model predicts:** It predicts a probability (0% to 100%).
*   **What "85% probability" means:** Based on past data, 85 out of 100 customers with similar profiles successfully paid when we asked them to.
*   **What it DOES NOT mean:** It does not mean the customer *will* pay. It's just an educated guess.
*   **Features/Inputs:** The model looks at things like the amount owed, the failure reason, and the customer's lifetime value.
*   **Where it was trained:** In `scripts/train_model.py`. We generate synthetic (fake but mathematically realistic) data and train a `Scikit-Learn` model.
*   **What `model.joblib` is:** This is the actual "brain" of the model saved to a file so the backend can load it instantly without retraining it every time.

---

## PART 7 — WHAT IS THE POLICY ENGINE?

If we have AI and ML, why do we need a Policy Engine?
**Because AI can hallucinate, and ML is just a guess.** In fintech, you cannot trust AI with money.

*   **ML = Prediction** (A smart guess).
*   **AI = Recommendation** (A smart suggestion).
*   **Policy = Authority** (The absolute law).

The Policy Engine (`services/policy_service.py`) is a set of hardcoded `if/then` rules. For example: *If amount > ₹5,000, block automation.*

**Why AI cannot override policy:** The code strictly runs the policy check *first*. If the policy says "Block", the system will never allow the AI or the user to execute a recovery link.

*   **Example A:** ML says 90%, Policy allows. → Execute button is enabled.
*   **Example B:** ML says 90%, Policy blocks (amount is ₹10,000). → Execute button is disabled. Case goes to Human Review.

This guarantees financial safety.

---

## PART 8 — WHAT DOES GROQ / AI DO?

*   **Groq:** A blazingly fast AI platform that runs Llama-3 models.
*   **Why advisory:** The AI is an *Advisor*, not a commander. It looks at the facts and suggests a plan.
*   **What it generates:** It generates a structured decision (e.g., action = `payment_link`) and drafts a friendly, context-aware text message to send to the customer.
*   **Fallback:** If Groq's servers go down, our code automatically catches the error and uses a basic, hardcoded logic tree (`fallback_decision`) so the application never breaks.
*   **AI RECOMMENDATION · ADVISORY:** This UI badge reminds the user that the AI is just offering advice, but the human/policy is ultimately in control.

---

## PART 9 — WHAT DOES EXECUTE DO?

This is where the magic happens.

*   **ANALYZE:** "Should we recover this?"
*   **EXECUTE:** "Actually do it."

When you click **EXECUTE**:
1.  **Backend guard:** The backend double-checks the Policy Engine to ensure it is still safe to proceed.
2.  **Razorpay API:** The backend makes a network call to Razorpay's servers (`client.payment_link.create()`), passing the exact amount and currency.
3.  **Payment Link:** Razorpay generates a unique checkout page (e.g., `https://rzp.io/rzp/SFs01E2`) and hands the URL back to our backend.
4.  **Database update:** The case status changes from `FAILED` to `RECOVERING`.
5.  **UI Result:** The dashboard displays the new, clickable Razorpay link and a "RECOVERY ACTION EXECUTED" success panel.

**IMPORTANT:** Clicking Execute creates the *link*. It does **not** mean the payment succeeded. The payment only succeeds when the customer opens that link and pays.

---

## PART 10 — MOCK DEMO LINK

When you open the dashboard, some seeded cases are already in the `RECOVERING` state.

Because these cases were faked by the seed script, they don't have real Razorpay payment links (we didn't want to spam Razorpay's API with 50 fake link requests). Instead, they are seeded with the word:
`mock_demo_link`

*   **Why we do this:** It shows the judge what a recovering case looks like in the UI.
*   **The Execute button:** Usually, the Execute button is disabled for recovering cases (to prevent sending duplicate links to the same customer). But we programmed a special exception: if the link is exactly `mock_demo_link`, the Execute button remains enabled!
*   **What happens when clicked:** If you click Execute on a mock demo case, the backend clears the mock status, talks to Razorpay, generates a *real* payment link, and updates the UI seamlessly.

---

## PART 11 — REAL RAZORPAY PAYMENT FLOW

1.  **RecoverAI** asks Razorpay for a link.
2.  **Razorpay API** returns `https://rzp.io/rzp/...`
3.  **Customer** opens the link in their browser and sees a beautiful Razorpay checkout screen.
4.  **Customer** types in their card/UPI and clicks Pay.
5.  **Razorpay processes** the money.
6.  **Razorpay Webhook** secretly pings our server in the background.
7.  **RecoverAI** receives the ping and marks the case as `RECOVERED`.

We use Razorpay **Test Mode**, meaning no real money is moved, but the entire API behaves exactly like production.

---

## PART 12 — WHAT IS A WEBHOOK?

*Instead of RecoverAI constantly asking Razorpay "Did they pay yet? Did they pay yet?", Razorpay simply promises to tap RecoverAI on the shoulder the moment a payment happens.* That tap is a Webhook.

*   **Webhook URL:** An endpoint on our server (`/api/webhooks/razorpay`) designed specifically to listen for Razorpay's messages.
*   **Signature Verification:** Anyone on the internet could send a fake message claiming a payment succeeded. Razorpay signs their webhooks with a secret cryptographic key (HMAC). Our backend verifies this signature. If it doesn't match, we reject the message to prevent fraud.
*   **Processing:** If verified, we look at the Razorpay Order ID in the webhook, find the matching case in our database, change its status to `RECOVERED`, and add an audit log.

---

## PART 13 — CASE STATUSES

| Status | Meaning | Can Analyze? | Can Execute? |
| :--- | :--- | :--- | :--- |
| **FAILED** | A payment failed and is waiting for action. | Yes | Yes (if policy allows) |
| **RECOVERING** | A payment link was sent. Waiting for customer to pay. | Yes | **NO** (Unless it's a `mock_demo_link`) |
| **RECOVERED** | The customer paid successfully via the link! | Yes | **NO** |
| **HUMAN_REVIEW** | Blocked by policy due to risk/size. Human must look at it. | Yes | **NO** |
| **CLOSED** | Case is abandoned or resolved offline. | Yes | **NO** |

**Duplicate Recovery Protection:** If a case is already `RECOVERING` with a real Razorpay link, the backend absolutely forbids executing it again. This prevents accidentally spamming a customer with multiple payment links for the same debt.

---

## PART 14 — NO ACTION

Sometimes you click Execute, and the response says **No Action**.
This does **not** mean the application is broken! It means the backend actively protected you from doing something wrong.

Examples of when the system says "No Action":
*   You try to execute a case that is already `RECOVERED`.
*   You try to execute a case that is blocked by the Policy Engine.
*   You try to execute a case that is already `RECOVERING` with a real link.

This is a successful outcome of a safe fintech system.

---

## PART 15 — AUDIT TRAIL / AUDIT JOURNEY

The Audit Trail is a permanent, undeletable history of every single thing that happened to a specific case.

**Realistic Flow:**
1.  `failure_detected` (The original failure)
2.  `ml_prediction` (We scored it 85%)
3.  `policy_check` (We allowed it)
4.  `ai_analysis` (Groq recommended a payment link)
5.  `payment_link_created` (We executed it via Razorpay)
6.  `payment_success` (Webhook confirmed payment)

*   **Why it matters:** In fintech, if money is lost or a customer complains, you must be able to prove exactly what the system did and why.
*   **Current Status vs Audit:** The "Status" is the *current state* (e.g., RECOVERED). The "Audit Trail" is the *story* of how it got there.

---

## PART 16 — CUSTOMER HISTORY

When analyzing a case, the model looks at the customer's history.
*   **Lifetime Value:** The total amount of money this customer has successfully paid us in the past.
*   **Successful/Failed payments:** A ratio of how reliable they are.
*   *Note:* In our demo, these values are randomly generated during the seeding process to give the ML model varied data to analyze.

---

## PART 17 — DASHBOARD

*   **Metrics Row (Top):** High-level business stats. *Revenue at Risk* (total value of FAILED cases), *Revenue Recovered* (total value of RECOVERED cases), and *Recovery Rate* (percentage of success).
*   **LIVE QUEUE (Left):** The list of all cases. Click one to view its details.
*   **Decision Pipeline (Right):** A visual stepper showing where the case is in its lifecycle (Failed → ML Scored → Policy → Executed).
*   **Recovery Intelligence:** Shows the ML score and the Policy decision clearly.
*   **AI Advisor:** Shows Groq's recommended action and suggested customer message.
*   **Audit Journey (Bottom):** The chronological timeline of events for the selected case.
*   **Demo Environment (Top Right):** A toggle or tag reminding the user that this is a safe, seeded environment.

---

## PART 18 — RESET DEMO

The **Reset Demo** button clears the database and regenerates the 50 fake cases.
*   **Why it exists:** If you play around with the app, execute a bunch of cases, and mess up the queue, you can click Reset Demo to return the dashboard to a fresh, clean state for the next presentation.
*   **Safety:** It relies on a `DEMO_MODE=true` environment variable. In a real production deployment, this button is disabled so you can't accidentally delete real company data.

---

## PART 19 — FRONTEND / BACKEND / DATABASE

*   **Frontend (React + Vite):** This is the user interface you see in the browser. It is built with React, styled entirely with custom CSS (`styles.css`), and handles the visual dashboard. It runs on a user's browser (or deployed to Vercel).
*   **Backend (FastAPI - Python):** This is the brain. It contains the API routes, the Policy Engine, the ML model, and the integrations with Razorpay and Groq. It never trusts the frontend; it verifies all policies itself. It runs on a server (like Render).
*   **Database (PostgreSQL / SQLite):** Where cases and audit logs are permanently stored.

**Flow:** Browser clicks button → Frontend tells Backend → Backend checks Database, asks ML, asks Groq, talks to Razorpay → Backend updates Database → Backend tells Frontend it worked → Frontend updates the screen.

---

## PART 20 — IMPORTANT FILES

| File Path | What it does |
| :--- | :--- |
| `frontend/src/App.tsx` | The entire frontend UI logic. Handles buttons, state, and API calls to the backend. |
| `frontend/src/styles.css` | The premium, custom CSS that makes the dashboard look like a professional fintech app. |
| `backend/app/main.py` | The entry point for the Python FastAPI server. Wires up all the routes. |
| `backend/app/api/cases.py` | The backend API endpoints for getting, analyzing, and executing cases. |
| `backend/app/api/webhooks.py` | The secret listener that waits for Razorpay to ping us about successful payments. |
| `backend/app/services/recovery_service.py` | The core engine. Contains `analyze_case` and `execute_recovery`. This is where all the major business logic lives. |
| `backend/app/services/demo_service.py` | The script that generates the 50 fake cases so the dashboard isn't empty. |
| `backend/scripts/seed_demo.py` | A terminal script that can trigger the demo seeding manually. |
| `backend/Dockerfile` | The blueprint that tells hosting providers (like Render) how to install Python, train the ML model, and run the backend. |
| `render.yaml` | Configuration file that automates deployment to Render (our backend host). |

---

## PART 21 — LIVE DEPLOYMENT

*   **Vercel:** A world-class hosting provider optimized for frontend applications. Our React app lives here.
*   **Render:** A powerful hosting provider for backend services. Our Python FastAPI server and ML model live here.
*   **PostgreSQL:** A robust, production-grade database hosted on Render that replaces our local SQLite file when deployed to the internet.
*   **Why separated:** Standard industry practice. The frontend can be delivered blazingly fast to users globally, while the backend focuses purely on heavy computing and secure API keys.

---

## PART 22 — 5-MINUTE DEMO SCRIPT

*Follow this script exactly for a flawless presentation.*

**0:00–0:30 (Introduction)**
*"Hi, this is RecoverAI. We solve a massive problem for subscription businesses: failed payments. Instead of blindly spamming customers or wasting human effort, we built an intelligent pipeline that uses Machine Learning to predict success, strict business policies to guarantee safety, and AI to orchestrate Razorpay payment links."*

**0:30–1:00 (Dashboard overview)**
*(Point to the top metrics)*
*"As you can see, our dashboard gives an instant view of Revenue at Risk. On the left, we have a live queue of failed payments, seeded with demo data for this presentation."*

**1:00–2:00 (Analyze)**
*(Click on a case in the LIVE QUEUE that is 'FAILED' and has an amount under ₹5,000)*
*"Let's look at this failed payment. I'm going to click **Analyze**. Notice we don't just blindly send a link. Under the hood, our Scikit-Learn ML model just scored this customer with a high recovery probability. More importantly, our deterministic Policy Engine verified this is safe to automate. Finally, our Groq AI advisor evaluated these facts and drafted a custom recovery strategy."*

**2:00–3:00 (Execute)**
*(Point to the Execute button)*
*"Because the policy allowed it, the Execute button is unlocked. I'll click **Execute**."*
*(Wait for the green success panel to appear)*
*"Boom. Our backend just communicated directly with the Razorpay API and generated a real, unique payment checkout link for this specific exact amount. The status is now RECOVERING."*

**3:00–4:00 (Safety & Audit)**
*(Point to the Audit Journey at the bottom)*
*"In fintech, traceability is everything. Look at the Audit Journey. Every single step—the ML prediction, the policy check, the Groq advice, and the Razorpay link creation—is permanently logged. Furthermore, our backend is strictly guarded. If I try to execute this again, the backend physically blocks duplicate recoveries to prevent customer spam."*

**4:00–5:00 (Conclusion)**
*"When the customer pays that Razorpay link, Razorpay fires a cryptographic webhook back to our FastAPI server, which instantly updates this case to RECOVERED and secures the revenue. That is RecoverAI: ML predicts, Policy decides, AI recommends, and Recovery executes."*

---

## PART 23 — JUDGE QUESTIONS

**"What exactly is AI doing?"**
It acts as an advisor. It looks at the ML score and the policy rules, and drafts a context-aware strategy and customer message. It does *not* make the final execution decision.

**"Why do you need ML? Why not just use AI?"**
Large Language Models (AI) are bad at raw statistical math. Machine Learning models (like Random Forests) are brilliant at analyzing thousands of rows of historical numerical data to predict probabilities. We use ML for math, and AI for reasoning/text.

**"What is the Policy Engine?"**
It's a hardcoded security guard. It ensures the system never breaks business rules, like attempting to auto-recover a massive ₹100,000 transaction.

**"Can AI override the policy?"**
Never. Policy is absolute.

**"How does Razorpay integration work?"**
We use the official Razorpay Python SDK to dynamically generate Payment Links via their `/v1/payment_links` API, passing the exact dynamically required amount.

**"What happens after payment?"**
The customer gets a receipt, and Razorpay triggers a webhook.

**"What is the webhook?"**
An automated HTTP POST request Razorpay sends to our backend to notify us that the payment succeeded, so we don't have to poll their API continuously.

**"What happens if the webhook fails?"**
Razorpay automatically retries webhooks several times over 24 hours.

**"Are the 50 cases real?"**
No, they are synthetic demo cases generated by a seeding script so we can demonstrate the UI instantly.

**"Where did your dataset come from?"**
We generate a synthetic dataset in code that mimics real-world failed payment patterns (correlating failure reasons with success rates) to train the ML model.

**"What happens if ML predicts incorrectly?"**
Nothing dangerous. If it predicts a high chance of success but fails, we just sent an email that didn't convert. The Policy Engine prevents any catastrophic financial errors.

**"How do you prevent duplicate recovery?"**
The backend explicitly checks the database before execution. If a case is already `RECOVERING` with a real Razorpay link, it returns a safe "No Action" response and blocks execution.

**"What does No Action mean?"**
It means the backend intentionally blocked an action because it violated a safety rule (like trying to execute a case that is already recovered).

**"Why use Groq?"**
It runs Llama-3 models at incredible speeds, providing near-instant advisory responses which creates a snappy UX.

**"What makes this different from a normal payment retry system?"**
Normal systems use "dumb" retries (try every card 3 times). We use predictive ML to triage which customers to prioritize, and AI to personalize the outreach.

---

## PART 24 — I WILL PROBABLY GET CONFUSED ABOUT THESE

*   **Analyze vs Execute:** Analyze is just *thinking* and asking for advice. Execute is *doing* and talking to Razorpay.
*   **ML vs AI:** ML (Machine Learning) is the math calculating the percentage. AI (Groq/Llama) is the chat-bot writing the advice.
*   **Policy vs ML:** ML predicts the future. Policy enforces the rules. Policy always wins.
*   **Recovering vs Recovered:** Recover*ing* = Link sent, waiting for money. Recover*ed* = Money is in the bank.
*   **Payment Link created vs Payment succeeded:** Generating a link doesn't mean you got paid. It's just an invoice. The webhook proves payment success.
*   **Mock link vs real Razorpay link:** A mock link (`mock_demo_link`) is a placeholder we put in fake demo cases. If you execute it, the backend replaces it with a *real* Razorpay link.
*   **Frontend vs Backend:** Frontend (React) is what the user clicks. Backend (FastAPI) is the brain that actually does the work and talks to the database.

---

## PART 25 — FINAL CHEAT SHEET

**RecoverAI in one sentence:**
*An intelligent recovery platform using ML to predict, Policy to protect, AI to recommend, and Razorpay to execute.*

**The 5-Step System:**
1. Fails → 2. Analyze (ML+Policy+AI) → 3. Execute (Razorpay Link) → 4. Customer Pays → 5. Webhook (Recovered)

*   **Analyze:** Think about the case.
*   **Execute:** Generate the Razorpay link.
*   **Policy:** The ultimate security guard.
*   **AI:** The text/strategy advisor.
*   **Webhook:** Razorpay's automatic text message saying "Paid!"
*   **Audit:** The permanent history log.

**5-Minute Demo Order:**
Intro → Dashboard → Select Case → Click Analyze → Explain ML/Policy/AI → Click Execute → Explain Razorpay link → Explain Webhook & Audit.

**Sentences to Memorize:**
1. "ML predicts. Policy decides. AI recommends. Recovery executes."
2. "We don't trust AI with money; our hardcoded Policy Engine is the absolute authority."
3. "Analyze evaluates the data safely; Execute generates the real Razorpay transaction."
4. "Every single action is permanently logged in the Audit Journey for financial compliance."
5. "Instead of dumb retries, we use predictive triage."
