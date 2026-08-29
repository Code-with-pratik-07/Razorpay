# Razorpay RecoverAI

AI-assisted payment-recovery and revenue-protection system for Razorpay Test Mode.

---

## Hackathon Demo

RecoverAI includes a fully deterministic "Demo Mode" for 5-minute hackathon presentations.

1. **Start the Environment**
   ```bash
   cd backend && uvicorn app.main:app --reload
   # In a new terminal
   cd frontend && npm run dev
   ```

2. **Access the Demo Dashboard**
   Open `http://localhost:5173`. You will see the `DEMO MODE` badge at the top.

3. **Reset Demo Data**
   Click the **Start Demo** button in the LIVE DEMO panel. This securely resets the synthetic database and loads 4 specific presentation scenarios:
   - `01 Automatic Recovery` (Perfect execution path)
   - `02 Human Review` (Policy strictly overrides AI)
   - `03 Recovered Payment` (Success webhook simulation)
   - `04 Duplicate Protection` (Concurrency safety)

4. **Detailed Presentation Guide**
   For the exact 5-minute script and step-by-step walkthrough, read the [Demo Guide](docs/RECOVERAI_DEMO_GUIDE.md).

---

## Overview

RecoverAI automatically detects failed payments arriving via Razorpay webhooks, evaluates each case through a multi-layer decision pipeline, and attempts to recover the revenue by generating a Razorpay Payment Link for the customer. All decisions are governed by a deterministic policy engine that acts as the authoritative guardrail. A Groq-hosted LLM provides an advisory recommendation only — it can never override policy.

### Problem Being Solved

When a payment fails in Razorpay, the default experience is silence. RecoverAI turns every `payment.failed` webhook into a structured recovery case with ML-scored recovery probability, policy validation, AI advisory, and an auditable action trail. If policy allows, a Payment Link is generated and the case transitions to recovering status. If not, the case is flagged for human review with a clear reason.

---

## Main Features

| Feature | Description |
|---|---|
| **Webhook ingestion** | Receives and HMAC-verifies signed Razorpay webhooks; fully idempotent on `event_id` |
| **ML recovery prediction** | GradientBoosting classifier scores each case's recovery probability from 9 payment and customer features |
| **Deterministic policy engine** | Six hard guardrails enforce amount limits, retry caps, recovery windows, cooldowns, and currency requirements; policy is always authoritative |
| **Groq AI advisory** | `llama-3.3-70b-versatile` provides a recommended action with reasoning and a customer message; treated as advisory only with automatic fallback |
| **Recovery execution** | Issues a Razorpay Payment Link for eligible cases; unsupported `retry` requests are automatically converted to Payment Links |
| **Human-review flow** | Cases blocked by policy or AI escalation are flagged `human_review` with an explicit reason |
| **Audit trail** | Every state transition, ML score, policy decision, AI recommendation, and execution result is logged as an immutable, append-only audit event |
| **Dashboard statistics** | Live revenue-at-risk, recovered revenue, recovery rate, and cases-processed metrics |
| **Case management API** | List, detail, analyse, explain, execute, and export audit events for any recovery case |
| **Synthetic demo experiment** | `POST /api/demo/run-experiment` simulates 1,000 recovery cases without touching the live DB or external APIs |
| **Model retraining** | `POST /api/model/train` retrains the GBM pipeline on 5,000 synthetic samples in-process |

---


## Architecture

```
Razorpay Webhook
      │
      ▼
POST /webhooks/razorpay  ──── HMAC verify ──── idempotency check
      │
      ▼  (BackgroundTask)
  webhook_worker.py
      │
      ├── find or create Customer (increment failed_payments on new case)
      ├── create PaymentCase (status=FAILED)
      └── analyze_case()
                │
                ├── ML predict (GradientBoostingClassifier)
                ├── check_recovery_policy()   ← authoritative guardrail
                └── GroqRecoveryAdvisor.advise()  ← advisory only
                      └── FallbackDecision if Groq unavailable

POST /api/cases/{id}/execute
      │
      ├── Early-return guard  (already RECOVERING → no-op, no DB writes)
      ├── check_recovery_policy()   ← re-enforced at execution
      ├── AI decision lookup (last stored advisory)
      └── RazorpayService.create_payment_link()
                │
                └── case status → RECOVERING

payment.captured / order.paid webhook
      │
      └── case status → RECOVERED
          customer.successful_payments += 1
          customer.lifetime_value += case.amount
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Python 3.12, FastAPI, SQLAlchemy 2, Pydantic v2, Uvicorn |
| **Database** | SQLite (configurable via `DATABASE_URL`; swap to Postgres for production) |
| **ML** | scikit-learn `GradientBoostingClassifier`, joblib, pandas |
| **AI advisory** | Groq SDK (`groq`), `llama-3.3-70b-versatile`, structured JSON output |
| **Payments** | Razorpay Python SDK (Test Mode) |
| **Frontend** | React 18, TypeScript, Vite |
| **Testing** | pytest, FastAPI `TestClient` |

---

## Environment Variables

Copy `.env.example` to `.env` before starting. **Never commit `.env`.**

```dotenv
# Razorpay Test Mode credentials (Razorpay Dashboard → Settings → API Keys)
RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...

# Webhook secret (Razorpay Dashboard → Settings → Webhooks → Secret)
RAZORPAY_WEBHOOK_SECRET=...

# Groq API key (https://console.groq.com)
GROQ_API_KEY=gsk_...

# Groq model — confirmed to work with the structured-output schema used here
GROQ_MODEL=llama-3.3-70b-versatile

# Database (SQLite default; replace with postgresql+psycopg2://... for production)
DATABASE_URL=sqlite:///./recoverai.db

# Randomised secret (generate: python -c "import secrets; print(secrets.token_hex(32))")
SECRET_KEY=...

# Set to "production" for live deployments
ENVIRONMENT=development

# Comma-separated list of allowed CORS origins for the frontend.
# Do NOT use * with allow_credentials=True in production.
CORS_ORIGINS=http://localhost:5173
```

---

## Backend Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Start the dev server

```bash
source .venv/bin/activate
uvicorn app.main:app --reload
```

The API is served at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

---

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

The dashboard is served at `http://localhost:5173`. It connects to the backend at `http://localhost:8000` via the Vite proxy.

---

## Running Tests

```bash
cd backend
source .venv/bin/activate
python -m pytest -v
```

All 23 tests should pass. The suite covers: health endpoints, policy engine, ML pipeline, recovery service, Groq advisor, webhook ingestion and idempotency, audit trail, and dashboard statistics.

### Build frontend (production check)

```bash
cd frontend
npm run build
```

## Demo Data Seeder

To quickly populate the database with realistic demo cases for presentations or testing:

```bash
cd backend
source .venv/bin/activate
PYTHONPATH=. python scripts/seed_demo.py
```
*(Use `--reset` to wipe all existing data and start fresh).*

---

## API Reference (Summary)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `GET` | `/health/database` | DB connectivity check |
| `POST` | `/webhooks/razorpay` | Receive signed Razorpay webhooks |
| `GET` | `/api/cases` | List all recovery cases |
| `GET` | `/api/cases/{id}` | Get case detail |
| `POST` | `/api/cases/{id}/analyze` | Run ML + policy + Groq analysis |
| `GET` | `/api/cases/{id}/explanation` | Fetch stored analysis |
| `POST` | `/api/cases/{id}/execute` | Execute recovery action |
| `GET` | `/api/cases/{id}/audit` | List audit events |
| `GET` | `/api/cases/{id}/audit/export` | Export audit trail as JSON |
| `GET` | `/api/dashboard/stats` | Revenue at-risk, recovered, rate |
| `GET` | `/api/dashboard/at-risk-breakdown` | Failure-reason histogram |
| `GET` | `/api/dashboard/trend` | Current recovery snapshot |
| `POST` | `/api/model/train` | Retrain ML model |
| `GET` | `/api/model/predict` | One-shot ML prediction |
| `POST` | `/api/demo/run-experiment` | 1,000-case synthetic simulation |
| `GET` | `/api/payments/checkout-config` | Public Razorpay key ID |
| `POST` | `/api/payments/create-order` | Create Razorpay order |
| `POST` | `/api/payments/verify` | Verify Razorpay checkout signature |

---

## Example Recovery Flow

1. A customer's payment fails in Razorpay.
2. Razorpay sends a signed `payment.failed` webhook to `POST /webhooks/razorpay`.
3. The webhook worker verifies the HMAC signature, checks the `event_id` for duplicates, creates a `PaymentCase` (status=`failed`), and increments the customer's `failed_payments` count.
4. `analyze_case()` runs in a background task:
   - ML model scores recovery probability (0–1).
   - Policy engine checks amount, retry count, recovery window, cooldown, and currency.
   - Groq AI provides an advisory recommendation (falls back to a deterministic decision if unavailable).
   - All three results are written as audit events.
5. From the dashboard, an operator selects the case and clicks **Execute**.
6. `POST /api/cases/{id}/execute` re-enforces policy (including blocking `RECOVERING` cases). If allowed, a Razorpay Payment Link is created and the case moves to status=`recovering`.
7. If the customer pays, a `payment.captured` or `order.paid` webhook arrives, transitions the case to status=`recovered`, and updates the customer's `successful_payments` and `lifetime_value`.
8. Every step is recorded in the immutable audit trail and visible in the dashboard.

---

## Security Notes

- **Webhook signature**: All webhook requests are verified with HMAC-SHA256 over the raw, unparsed request body. Timing-safe comparison (`hmac.compare_digest`) is used. Invalid signatures are rejected with HTTP 400.
- **Secrets**: `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and `GROQ_API_KEY` are never returned by any API endpoint, never logged, and excluded from version control via `.gitignore`.
- **API keys**: Only `RAZORPAY_KEY_ID` (the public browser key) is exposed via `GET /api/payments/checkout-config`.
- **CORS**: Set `CORS_ORIGINS` to your exact frontend origin. Do not use `*` with `allow_credentials=True` in production.
- **AI is advisory**: The Groq AI recommendation cannot authorise a recovery action that policy has blocked. Policy is always the final authority.
- **Duplicate execution**: The backend independently blocks re-execution of already-recovering cases, regardless of the calling client.
- **Test Mode only**: This project is designed and tested against Razorpay Test Mode credentials. No real money is moved.

---

## Known Limitations

- Payment retry is not supported by Razorpay's API. All automatic recovery actions use Payment Links.
- `GET /api/dashboard/trend` returns a single-point snapshot rather than a full time-series.
- SQLite is the default database and is suitable for development and demo. Configure `DATABASE_URL` for PostgreSQL in production.
- Groq AI availability is best-effort. The policy engine and deterministic fallback ensure correct operation without it.
