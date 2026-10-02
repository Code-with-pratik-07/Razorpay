# RecoverAI

**AI-Assisted Payment Recovery & Revenue Protection for Razorpay Test Mode**

[![Python](https://img.shields.io/badge/Python-3.12%2B-blue?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Scikit-Learn](https://img.shields.io/badge/scikit--learn-1.5%2B-F7931E?logo=scikit-learn&logoColor=white)](https://scikit-learn.org)
[![Groq](https://img.shields.io/badge/Groq-llama--3.3--70b--versatile-F55036)](https://groq.com)
[![Razorpay](https://img.shields.io/badge/Razorpay-Test%20Mode-0C2340?logo=razorpay&logoColor=white)](https://razorpay.com)
[![Tests](https://img.shields.io/badge/Tests-129%20Passed-success?logo=pytest&logoColor=white)](https://docs.pytest.org)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> [!NOTE]
> **Prototype Disclaimer**: RecoverAI is an open-source engineering prototype built for demonstration and evaluation in **Razorpay Test Mode**. It is not an official Razorpay product and does not process real-money payments or live banking transactions.

---

## Quick Links

- **Frontend Application**: [`<YOUR_VERCEL_URL>`](https://recoverai.vercel.app) *(e.g. deployed on Vercel)*
- **Backend API**: [`<YOUR_RENDER_BACKEND_URL>`](https://recoverai-backend.onrender.com) *(FastAPI on Render)*
- **Interactive Swagger Docs**: [`<YOUR_RENDER_BACKEND_URL>/docs`](https://recoverai-backend.onrender.com/docs)
- **GitHub Repository**: [Code-with-pratik-07/Razorpay](https://github.com/Code-with-pratik-07/Razorpay)

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [How the Decision System Works](#how-the-decision-system-works)
- [The 6-Stage Recovery Lifecycle](#the-6-stage-recovery-lifecycle)
- [Core Features](#core-features)
- [System Architecture](#system-architecture)
- [Machine Learning Engine](#machine-learning-engine)
- [Deterministic Policy Guardrails](#deterministic-policy-guardrails)
- [Omnichannel Communication Intelligence](#omnichannel-communication-intelligence)
- [Interactive Demo Mode & Showcase Scenarios](#interactive-demo-mode--showcase-scenarios)
- [Technology Stack](#technology-stack)
- [Project Directory Structure](#project-directory-structure)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Production Deployment](#production-deployment)
- [Razorpay Test Mode Integration](#razorpay-test-mode-integration)
- [API Reference](#api-reference)
- [Testing & Verification](#testing--verification)
- [Security Considerations](#security-considerations)
- [System Limitations](#system-limitations)
- [Future Improvements](#future-improvements)
- [License](#license)

---

## The Problem

When customer payments fail in digital commerce—due to temporary bank downtime, insufficient funds, network timeouts, or incorrect payment details—merchants face a difficult trade-off:

1. **Passive Drop-off**: Doing nothing means silent revenue loss, abandoned carts, and customer churn.
2. **Blind Retries & Spam**: Automatically re-attempting every failure or blasting customers across SMS, WhatsApp, and email leads to customer fatigue, brand erosion, and wasted operational effort on unrecoverable transactions (e.g., fraud flags or hard declines).

Merchants need a balanced mechanism to evaluate which failed payments are genuinely recoverable, enforce strict financial risk guardrails before taking action, select the most effective communication channel, and maintain an immutable audit trail.

---

## The Solution

**RecoverAI** intercepts failed payment webhooks in real time, assesses recovery viability with an in-process machine learning model, validates the case against authoritative deterministic policy guardrails, drafts context-aware messaging via an AI advisory layer, and orchestrates customer recovery journeys via Razorpay Test Mode Payment Links.

```
Payment Failure (Razorpay Webhook)
                ↓
    HMAC-SHA256 Signature Check & Idempotent Log
                ↓
    PaymentCase Created & Customer Profile Linked
                ↓
    Behavioral Feature Extraction (9 Signals)
                ↓
    Scikit-Learn ML Recovery Scoring (0.00 – 1.00)
                ↓
    Deterministic Policy Engine (Authoritative Guardrails)
    ├── Passed   → Continue to Decision Routing
    └── Blocked  → Escalate to Human Review or Stop
                ↓
    Groq AI Advisor (Llama-3.3-70b Contextual Messaging)
    └── Fallback → Deterministic Rule-Based Messaging
                ↓
    Channel Intelligence (WhatsApp / SMS / Email Scoring)
                ↓
    Execution (Razorpay Payment Link / Communication)
                ↓
    Append-Only Audit Trail + Real-Time Dashboard
```

---

## How the Decision System Works

RecoverAI enforces strict architectural separation between **prediction**, **governance**, and **advisory assistance**:

| Layer | Responsibility | Authoritative? | Failure Behavior |
| :--- | :--- | :---: | :--- |
| **1. ML Engine** | Scores recovery viability ($0.00\text{--}1.00$) based on structured payment and customer features. | No (Informs routing) | Falls back to conservative default scores. |
| **2. Policy Engine** | Evaluates deterministic business safety rules (amount limits, max retries, cooling periods). | **YES (Sole gate)** | Default deny: any policy failure stops or escalates automated action. |
| **3. AI Advisory (Groq)** | Generates empathetic, customer-facing explanations and messaging recommendations. | No (Advisory only) | Drops back to deterministic offline templates in $< 1\text{ ms}$. |

> [!IMPORTANT]
> **Safety Principle**: In financial workflows, generative AI models must never possess autonomous authority to disburse funds, charge accounts, or override compliance guardrails. In RecoverAI, the Policy Engine is the **sole authoritative gate**. If policy rules reject automated recovery, an LLM recommendation can never authorize execution.

---

## The 6-Stage Recovery Lifecycle

Every payment case moves through an observable six-stage pipeline reflected in both API payloads and the dashboard UI:

```
Stage 01: Payment Failed
  ↳ Ingests payment.failed event, extracts payment method, amount, and failure code.

Stage 02: ML Prediction
  ↳ Computes recovery probability score (0.00 to 1.00) and assigns an ML confidence bucket.

Stage 03: Policy Decision
  ↳ Validates all 8 safety rules (amount ceiling, valid IDs, currency, retry caps, cooldown).

Stage 04: Recovery Action
  ↳ Routes to Automatic Link Generation, Human Review Escalation, or Controlled Stop.

Stage 05: Communication
  ↳ Evaluates WhatsApp, SMS, and Email suitability; dispatches over the highest-ranked channel.

Stage 06: Customer Outcome
  ↳ Tracks link clicks, payment completion, expiry, or retry exhaustion with channel attribution.
```

---

## Core Features

- **Razorpay Webhook Ingestion**: Receives live failure and capture webhooks with constant-time HMAC-SHA256 signature verification and database-enforced event idempotency (`WebhookLog.event_id`).
- **ML-Powered Recovery Scoring**: In-process Scikit-Learn `GradientBoostingClassifier` evaluating 9 behavioral and transaction features.
- **Deterministic Policy Guardrails**: 8 non-bypassable safety checks governing transaction value ceilings, maximum retries, cooldown spacing, and currency constraints.
- **Three-Way Decision Routing**: Automatically routes cases to `HIGH` (automated link dispatch), `UNCERTAIN` (controlled attempt), `LOW` (single attempt / stopped), or `HUMAN_REVIEW` (operator escalation).
- **Omnichannel Communication Intelligence**: Evaluates customer communication maturity (`COLD_START`, `LEARNING`, `ESTABLISHED`) and dynamically ranks WhatsApp, SMS, and Email across 5 weighted dimensions.
- **Automated Payment Link Creation**: Uses the Razorpay Python SDK (Invoices API in Test Mode) to generate trackable payment links (`https://rzp.io/i/...`).
- **Customer Payment Simulation**: Built-in `/simulate-payment/:caseId` interface to simulate customer payment completions and test live status transitions.
- **Append-Only Audit Trail**: Every ingestion, ML prediction, policy evaluation, LLM call, and notification is recorded in chronological `AuditEvent` logs with 1-click JSON export.
- **Executive Analytics Dashboard**: Single-page dashboard built with React 18, TypeScript, and Recharts displaying Revenue at Risk, Recovered Revenue, Recovery Rate %, and Channel Attribution.
- **Interactive Demo Control Center**: 1-click demo reset populating 56 realistic cases across deterministic showcase scenarios.

---

## System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer ["Client Layer"]
        BROWSER["Web Browser"]
        DASHBOARD["React 18 Dashboard (Vercel)"]
        PAY_SIM["Payment Simulator UI"]
    end

    subgraph BackendLayer ["FastAPI Application (Render Docker)"]
        API["FastAPI REST Endpoints (/api/...)"]
        AUTH_HMAC["HMAC-SHA256 Signature Verifier"]
        WORKER["Background Webhook Worker"]

        subgraph CoreEngines ["Core Engines"]
            ML["Scikit-Learn ML Pipeline (GradientBoosting)"]
            POLICY["Deterministic Policy Engine (Guardrails)"]
            CHANNEL["Channel Intelligence Engine (5-Dim Matrix)"]
            GROQ_SVC["Groq LLM Advisor (Llama-3.3-70b)"]
        end

        DB_ORM["SQLAlchemy 2.0 ORM (psycopg v3)"]
    end

    subgraph DataStorage ["Data Layer"]
        PG[(PostgreSQL on Render / SQLite Local)]
        AUDIT_LOG[(Append-Only AuditEvent Store)]
    end

    subgraph ExternalProviders ["External Services (Test Mode)"]
        RZP["Razorpay Test Gateway (Invoices / Links)"]
        COMM_PROV["Notification Providers (WhatsApp / SMS / Email)"]
        GROQ_API["Groq Cloud API"]
    end

    BROWSER --> DASHBOARD
    DASHBOARD -->|HTTPS REST| API
    PAY_SIM -->|Simulate Checkout| API

    RZP -->|Signed Webhooks| AUTH_HMAC
    AUTH_HMAC --> API
    API --> WORKER

    WORKER --> ML
    WORKER --> POLICY
    WORKER --> GROQ_SVC
    GROQ_SVC -.->|API Call| GROQ_API
    WORKER --> CHANNEL

    POLICY -->|Auto Approved| RZP
    CHANNEL --> COMM_PROV

    WORKER --> DB_ORM
    DB_ORM --> PG
    DB_ORM --> AUDIT_LOG
```

---

## Machine Learning Engine

The ML component provides probabilistic estimation of recovery likelihood based on structured signals.

### Model Specification
- **Algorithm**: `GradientBoostingClassifier` (`n_estimators=120`, `max_depth=3`, `random_state=42`)
- **Pipeline**: Scikit-Learn `Pipeline([('features', RecoveryFeatureEncoder()), ('classifier', GradientBoostingClassifier())])`
- **Serialization**: Saved as a portable `model.joblib` artifact loaded into memory on backend startup.

### Feature Schema (9 Variables)
| Feature | Type | Description |
| :--- | :--- | :--- |
| `amount` | Continuous (int) | Transaction value in paise (e.g., 250000 = ₹2,500) |
| `customer_lifetime_value` | Continuous (float) | Cumulative historical spend by customer |
| `customer_successful_payments` | Discrete (int) | Count of past successful transactions |
| `customer_failed_payments` | Discrete (int) | Count of past failed transactions |
| `time_since_failure` | Continuous (float) | Hours elapsed since initial webhook ingestion |
| `payment_method` | Categorical | Payment rail (`upi`, `card`, `netbanking`) |
| `failure_count` | Discrete (int) | Number of repeated failures on current order |
| `failure_reason` | Categorical | Gateway error reason (`insufficient_funds`, `network_timeout`, `card_expired`, `fraud_suspicion`, `bank_declined`) |
| `customer_age_days` | Discrete (int) | Account tenure in days |

### Training Data
- **Synthetic Dataset**: Trained on 5,000 synthetic transaction records generated by [`generate_training_data()`](backend/app/ml/train.py) modeling realistic merchant payment patterns.
- *Notice: RecoverAI does not claim this model is trained on proprietary banking data; it demonstrates end-to-end ML integration within a payment workflow.*

### Decision Thresholds & Routing
```
Recovery Probability (p)
├── p >= 0.60          → HIGH: Automatic recovery eligible (max 3 retries)
├── 0.40 <= p < 0.60   → UNCERTAIN: Controlled recovery attempt (max 2 retries)
├── p < 0.40           → LOW: Conservative routing (max 1 retry or stopped)
└── Total Tx < 3       → COLD_START: Safe default routing (max 2 retries)
```

---

## Deterministic Policy Guardrails

Implemented in [`backend/app/services/policy_service.py`](backend/app/services/policy_service.py), these 8 non-bypassable guardrails run sequentially. If any check fails, automated recovery is halted immediately.

```
                           [ Ingested Failure Case ]
                                      │
               1. Status is HUMAN_REVIEW? ──► BLOCKED: Requires manual operator action
                                      │
               2. Missing Payment/Order ID? ─► BLOCKED: Invalid transaction data
                                      │
               3. Amount <= 0? ───────────────► BLOCKED: Sanity check failed
                                      │
               4. Currency != "INR"? ─────────► BLOCKED: Non-INR unsupported
                                      │
               5. Amount > ₹20,000 Ceiling? ──► ESCALATED: Exceeds automated risk ceiling
                                      │
               6. Retries >= Max Allowed? ────► STOPPED: Retry limit exhausted
                                      │
               7. Created > 7 Days Ago? ──────► STOPPED: Recovery window expired
                                      │
               8. Last Attempt < 24h Ago? ────► DELAYED: Mandatory cooldown active
                                      │
                                      ▼
                             [ POLICY APPROVED ]
```

---

## Omnichannel Communication Intelligence

RecoverAI separates *Recovery Viability* ("Should we attempt recovery?") from *Communication Intelligence* ("What channel is most likely to convert without annoying the customer?").

### 5-Dimensional Channel Scoring Matrix
The engine dynamically scores WhatsApp, SMS, and Email:

$$\text{Score} = 0.30 \cdot H + 0.25 \cdot S + 0.15 \cdot P + 0.15 \cdot A + 0.15 \cdot C$$

- **$H$ (30%) — Historical Engagement**: Past opens, clicks, and delivery success for the customer on this channel.
- **$S$ (25%) — Recovery Conversion**: Historical payment link completion rate attributed to this channel.
- **$P$ (15%) — Preference & Opt-Outs**: Customer's preferred channel and enforcement of channel opt-outs (`opted_out_channels`).
- **$A$ (15%) — Availability**: Verified E.164 phone number vs. verified email address.
- **$C$ (15%) — Payment Context**: Matching payment rail (e.g. UPI failures prioritize WhatsApp/SMS for mobile deep-linking).

### Customer Maturity Tiers
- **`COLD_START` (0 interactions)**: Uses conservative baseline scores (WhatsApp: 0.55, SMS: 0.50, Email: 0.45) with capped retry counts ($N=2$).
- **`LEARNING` (1–2 interactions)**: Blends customer response data with default priors.
- **`ESTABLISHED` (3+ interactions)**: Fully driven by verified individual channel performance and attribution history.

---

## Interactive Demo Mode & Showcase Scenarios

When `DEMO_MODE=true` is enabled, the backend exposes demonstration controls and seeds **56 realistic cases** (6 deterministic showcase scenarios + 50 synthetic failure cases):

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              DETERMINISTIC SHOWCASE CASES                              │
├────────────────────┬────────────────────┬────────────────────┬─────────────────────────┤
│  01 · AUTO RECOVERY│  02 · POLICY BLOCK │ 03 · ATTRIBUTED    │ 04 · RETRY EXHAUSTION   │
│  [DEMO-A-AUTO]     │  [DEMO-B-HUMAN]    │ [DEMO-C-RECOVERED] │ [DEMO-D-STOPPED]        │
│                    │                    │                    │                         │
│  • ML: 0.95 (High) │  • Amount: ₹25,000 │ • Status: Recovered│ • Retries: 2/2 (Max)    │
│  • Policy: Approved│  • Policy: BLOCKED │ • Channel: SMS     │ • ML: 0.25 (Low)        │
│  • Channel: WhatsApp│ • Reason: High-Val│ • Attributed: Yes  │ • Policy: Exhausted     │
│  • Action: Auto Link│ • Action: Escalate│ • Link: Completed  │ • Status: Abandoned     │
└────────────────────┴────────────────────┴────────────────────┴─────────────────────────┘
```

1. **`DEMO-A-AUTO`**: Demonstrates the full automated happy path. ML score is 95%, policy passes, and an automated payment link is generated and sent via WhatsApp.
2. **`DEMO-B-HUMAN`**: Demonstrates policy overriding AI. Amount is ₹25,000 (exceeding the ₹20,000 ceiling). Even with an 88% ML score, the Policy Engine overrides automation and forces human review.
3. **`DEMO-C-RECOVERED`**: Demonstrates successful recovery attribution. Shows a completed recovery journey attributed to SMS with an associated `PaymentAttempt` record.
4. **`DEMO-D-STOPPED`**: Demonstrates fatigue protection. Retry count reached maximum without response; automated recovery is permanently halted to prevent customer spam.

---

## Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | React 18 | Declarative dashboard UI |
| **Language (Frontend)**| TypeScript 5 | Strict type safety for API contracts |
| **Build Tooling** | Vite | Rapid development and optimized production bundling |
| **Styling** | Vanilla CSS (Tokens) | Bespoke fintech design system with CSS custom properties |
| **Data Visualization** | Recharts | Revenue at Risk, Recovered Revenue, and trend charts |
| **Backend Framework** | FastAPI | High-performance asynchronous REST API |
| **Server Engine** | Uvicorn (ASGI) | ASGI production server |
| **Database & ORM** | SQLAlchemy 2.0 | Type-annotated ORM supporting SQLite and PostgreSQL |
| **Database Driver** | `psycopg` v3 (binary) | Non-blocking PostgreSQL driver |
| **Machine Learning** | scikit-learn, joblib | Feature encoding and gradient boosting classification |
| **Generative AI** | Groq Python SDK | Llama-3.3-70b contextual recovery advisory |
| **Payments SDK** | Razorpay Python SDK | Invoices & Payment Links API in Test Mode |
| **Testing** | Pytest, TestClient | Automated test suite (129 tests) |
| **Containerization** | Docker | Production container image for backend deployment |
| **Hosting** | Vercel & Render | Vercel (Frontend), Render (FastAPI Docker + PostgreSQL) |

---

## Project Directory Structure

```
razorpay project/
├── .env.example                     # Environment variable template
├── README.md                        # Project documentation
├── render.yaml                      # Render Blueprint infrastructure definition
├── backend/
│   ├── Dockerfile                   # Python 3.13-slim container build
│   ├── requirements.txt             # Python dependencies
│   ├── scripts/
│   │   └── seed_demo.py             # CLI seed script (--reset support)
│   ├── tests/                       # 129 automated pytest suites
│   └── app/
│       ├── main.py                  # FastAPI app factory, CORS, lifespan
│       ├── core/                    # Settings (Pydantic), security, HMAC
│       ├── db/                      # SQLAlchemy engine, URL normalizer, init_db
│       ├── models/                  # 7 ORM models (Customer, PaymentCase, etc.)
│       ├── schemas/                 # Pydantic request/response validation
│       ├── ml/                      # GradientBoosting pipeline, training, inference
│       ├── ai/                      # Groq Llama advisor & deterministic fallback
│       ├── services/                # Policy, channel intelligence, Razorpay adapter
│       ├── api/                     # Route controllers (cases, demo, health, etc.)
│       └── workers/                 # Webhook ingestion worker
├── frontend/
│   ├── package.json                 # Node dependencies (React, Vite, Recharts)
│   ├── tsconfig.json                # TypeScript compiler configuration
│   ├── vite.config.ts               # Vite configuration
│   └── src/
│       ├── main.tsx                 # Application entry point
│       ├── App.tsx                  # Master dashboard container
│       ├── config.ts                # Dynamic API_BASE_URL configuration
│       ├── styles.css               # Design system & tokens
│       ├── components/              # UI components (CaseDetail, Charts, Metrics)
│       ├── services/                # API client functions
│       └── types/                   # TypeScript interface definitions
└── docs/
    ├── DEPLOY.md                    # Step-by-step production deployment manual
    ├── RAZORPAY_TEST_MODE.md        # Webhook setup instructions
    └── RECOVERAI_DEMO_GUIDE.md      # 5-minute hackathon demo walkthrough
```

---

## Local Development Setup

### Prerequisites
- **Python**: 3.12+ (or 3.11+)
- **Node.js**: 18.x or higher
- **Git**

### 1. Clone & Configure Environment

```bash
git clone https://github.com/Code-with-pratik-07/Razorpay.git
cd "Razorpay"
cp .env.example .env
```

Edit `.env` with your test credentials:

```dotenv
# Razorpay Test Mode Credentials
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_razorpay_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Groq LLM API Key (optional; deterministic fallback activates if omitted)
GROQ_API_KEY=gsk_your_groq_key
GROQ_MODEL=llama-3.3-70b-versatile

# Runtime Settings
DATABASE_URL=sqlite:///./recoverai.db
DEMO_MODE=true
CORS_ORIGINS=http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174
```

### 2. Backend Setup

```bash
cd backend

# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Seed the initial demo database
python scripts/seed_demo.py --reset

# Start FastAPI development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
- API Health Check: `http://localhost:8000/health`
- Swagger Documentation: `http://localhost:8000/docs`

### 3. Frontend Setup

In a separate terminal window:

```bash
cd frontend

# Install Node dependencies
npm install

# Start Vite development server
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## Environment Variables

### Backend Configuration (`.env`)

| Variable | Required | Default | Purpose |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | Yes | `sqlite:///./recoverai.db` | Database connection string (PostgreSQL or SQLite) |
| `DEMO_MODE` | No | `true` | Enables presentation banner and `/api/demo/reset` |
| `CORS_ORIGINS` | Yes | `http://localhost:5173,...` | Comma-separated list of allowed web origins |
| `RAZORPAY_KEY_ID` | Yes* | `""` | Razorpay Test Key ID (*needed for link creation) |
| `RAZORPAY_KEY_SECRET` | Yes* | `""` | Razorpay Test Key Secret |
| `RAZORPAY_WEBHOOK_SECRET` | Yes* | `""` | Secret for verifying incoming webhooks |
| `GROQ_API_KEY` | No | `""` | Groq API key (system uses offline fallback if absent) |
| `GROQ_MODEL` | No | `llama-3.3-70b-versatile` | LLM model identifier |
| `PORT` | No | `8000` | Port used by Uvicorn (assigned dynamically by Render) |

### Frontend Configuration (`frontend/.env`)

| Variable | Required | Default in Dev | Purpose |
| :--- | :---: | :--- | :--- |
| `VITE_API_BASE_URL` | In Prod | `http://127.0.0.1:8000` | Full URL of the deployed FastAPI backend (no trailing slash) |

---

## Production Deployment

RecoverAI is architected for deployment across **Vercel** (Frontend) and **Render** (FastAPI Backend + PostgreSQL):

### 1. Database Provisioning (Render PostgreSQL)
1. In your Render Dashboard, click **New +** $\rightarrow$ **PostgreSQL**.
2. Set Name to `recoverai-db-new` (or similar), Region to **Oregon**, and choose the **Free** tier.
3. Once created, copy the **Internal Database URL** (e.g. `postgres://recoveraiuser:PASSWORD@dpg-xxxxxx-a/recoveraidb`).

### 2. Backend Deployment (Render Web Service)
1. In Render, create a **New Web Service** connected to your repository (or apply `render.yaml`).
2. Environment: **Docker** | Region: **Oregon** *(must match database region)*.
3. Configure the following environment variables in Render:
   - `DATABASE_URL`: Your new PostgreSQL **Internal Database URL**.
   - `CORS_ORIGINS`: Your Vercel domain (e.g. `https://your-app.vercel.app`).
   - `DEMO_MODE`: `true`
   - `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `GROQ_API_KEY`.
4. Render deploys using `backend/Dockerfile` and binds Uvicorn to `0.0.0.0:${PORT}`.
5. On initial boot, `init_db()` automatically provisions all database tables.

### 3. Frontend Deployment (Vercel)
1. Import your GitHub repository into Vercel.
2. Under **Environment Variables**, add:
   - `VITE_API_BASE_URL` = `https://your-backend.onrender.com` *(no trailing slash)*.
3. Click **Deploy**. Vercel will run `tsc -b && vite build` and deploy the static bundle.

### 4. Razorpay Webhook Configuration
1. In your Razorpay Dashboard (Test Mode), navigate to **Account & Settings** $\rightarrow$ **Webhooks**.
2. Webhook URL: `https://your-backend.onrender.com/webhooks/razorpay`
3. Secret: Enter the same secret configured in `RAZORPAY_WEBHOOK_SECRET`.
4. Active Events: Select `payment.failed`, `payment.captured`, and `order.paid`.

---

## Razorpay Test Mode Integration

- **Test Mode Only**: Uses test credentials (`rzp_test_...`). No real money is transferred.
- **Invoices API Bridge**: In Razorpay Test Mode, direct payment link creation is capped at 30 links. RecoverAI uses the Razorpay Invoices API (`type="invoice"`) under the hood to generate unlimited valid test payment links (`https://rzp.io/i/...`).
- **Supported Webhook Events**:
  - `payment.failed`: Triggers failure case creation, ML scoring, policy check, and routing.
  - `payment.captured`: Triggers case resolution, updates recovery status, and records channel attribution.
  - `order.paid`, `invoice.paid`, `payment_link.paid`: Acknowledged and attributed to corresponding cases.

---

## API Reference

### Health & Monitoring
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Application liveness status |
| `GET` | `/health/database` | Verifies database connectivity (`SELECT 1`) |

### Dashboard & Analytics
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/dashboard/stats` | High-level metrics: revenue at risk, recovered revenue, recovery rate |
| `GET` | `/api/dashboard/at-risk-breakdown`| Breakdown of failure counts by failure reason |
| `GET` | `/api/dashboard/trend` | Snapshot of revenue volume metrics |

### Recovery Cases (`/api/cases`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/cases` | List and filter recovery cases (`status`, `search`, pagination) |
| `GET` | `/api/cases/{id}` | Detailed case profile with customer and payment history |
| `POST`| `/api/cases/{id}/analyze` | Trigger full 6-stage ML, policy, and AI evaluation |
| `GET` | `/api/cases/{id}/explanation` | Fetch stored ML scores, policy results, and AI reasoning |
| `POST`| `/api/cases/{id}/execute` | Authorize and execute recovery action (creates Razorpay link) |
| `POST`| `/api/cases/{id}/dispatch-communication` | Dispatch notification over selected channel |
| `POST`| `/api/cases/{id}/next-step` | Progress case to next recovery attempt or trigger escalation |
| `POST`| `/api/cases/{id}/track-click` | Register customer payment link click |
| `POST`| `/api/cases/{id}/payment-attempt` | Record outcome of an attempted recovery payment |
| `GET` | `/api/cases/{id}/payment-attempts`| Fetch full attempt history for a case |
| `POST`| `/api/cases/{id}/sync` | Synchronize case status against Razorpay API |

### Audit & Governance (`/api/cases/{id}/audit`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/cases/{id}/audit` | Fetch chronological audit trail for a case |
| `GET` | `/api/cases/{id}/audit/export` | Export complete case audit history as JSON |

### Demo & Simulation (`/api/demo`)
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/demo/status` | Current demo mode status |
| `POST`| `/api/demo/reset` | Re-seed database with 56 deterministic & synthetic cases |
| `POST`| `/api/demo/simulate-payment/{id}` | Simulate customer completing payment link |
| `POST`| `/api/demo/simulate-failure` | Inject synthetic `payment.failed` event |
| `POST`| `/api/demo/run-experiment` | Run 1,000-case Monte-Carlo policy simulation |

### Webhooks & Gateway
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST`| `/webhooks/razorpay` | Ingest and verify signed Razorpay webhooks |
| `GET` | `/api/payments/checkout-config` | Public Razorpay Key ID for client checkout |
| `POST`| `/api/payments/create-order` | Create standard Razorpay test checkout order |
| `POST`| `/api/payments/verify` | Verify client checkout payment signature |

---

## Testing & Verification

RecoverAI maintains an automated test suite verifying all services, policies, and workflows:

```bash
cd backend
source .venv/bin/activate
pytest backend/tests
```

### Verified Test Results
```text
============================= test session starts ==============================
collected 129 items

backend/tests/test_abandoned.py ....                                     [  3%]
backend/tests/test_audit.py ..                                           [  4%]
backend/tests/test_channel_intelligence.py ............                  [ 13%]
backend/tests/test_dashboard.py ..                                       [ 15%]
backend/tests/test_dashboard_metrics.py .........                        [ 22%]
backend/tests/test_demo.py ....                                          [ 25%]
backend/tests/test_demo_ai.py ..                                         [ 27%]
backend/tests/test_demo_simulate_payment.py .........                    [ 34%]
backend/tests/test_execution_failures.py ..                              [ 35%]
backend/tests/test_followup_decision.py ...........                      [ 44%]
backend/tests/test_health.py .                                           [ 44%]
backend/tests/test_link_click_tracking.py .....                          [ 48%]
backend/tests/test_ml.py ..                                              [ 50%]
backend/tests/test_ml_routing.py .........................               [ 69%]
backend/tests/test_models.py ..                                          [ 71%]
backend/tests/test_policy.py .........                                   [ 78%]
backend/tests/test_razorpay_service.py .                                 [ 79%]
backend/tests/test_recovery.py ...............                           [ 90%]
backend/tests/test_scheduling.py ....                                    [ 93%]
backend/tests/test_webhooks.py ........                                  [100%]

====================== 129 passed in 15.64s ====================================
```

### Frontend Build Verification
```bash
cd frontend
npm run build
```
Executes TypeScript compilation (`tsc -b`) and Vite production bundle generation with zero warnings or errors.

---

## Security Considerations

- **HMAC-SHA256 Webhook Verification**: Incoming webhooks are validated using `hmac.compare_digest` over raw request bytes.
- **Durable Webhook Idempotency**: `WebhookLog` enforces a unique database constraint on `event_id`. Duplicate webhook deliveries are acknowledged with HTTP 200 without duplicate execution.
- **Zero Secrets Serialization**: API keys and secrets are loaded exclusively via environment variables and never exposed in responses or audit payloads.
- **Deterministic Policy Safety Gates**: Automated recovery is strictly gated behind non-bypassable policy rules; LLMs cannot trigger executions directly.
- **Isolated Test Mode**: Operates exclusively against Razorpay Test Mode keys; cannot debit live customer bank accounts.

---

## System Limitations

To maintain engineering transparency, the current prototype has the following limitations:

1. **Razorpay Test Mode Only**: All link creation, checkout, and webhook operations run in Test Mode. The project is not wired to live banking rails.
2. **Synthetic Training Telemetry**: The Scikit-Learn model is trained on 5,000 synthetic transaction records generated to model realistic behavior, rather than live banking transaction histories.
3. **Render Free-Tier Latency**: On Render's free tier, inactive services experience cold starts (30–60 seconds on initial wake-up). Free PostgreSQL instances expire after 30 days unless recreated or upgraded.
4. **Mocked Notification Dispatch**: While channel intelligence algorithms and attribution logic are fully implemented, external SMS/WhatsApp deliveries are simulated locally unless connected to active provider credentials.
5. **Single-Merchant Scope**: The system currently operates for a single merchant account and does not support multi-tenant organization partitioning.

---

## Future Improvements

- **Database Migrations with Alembic**: Introduce structured migration files for automated continuous deployment schema upgrades.
- **Live Communication Gateway Adapters**: Connect production Twilio (SMS), Gupshup / Meta Cloud API (WhatsApp), and Resend (Email) adapters.
- **Online Model Retraining Pipeline**: Continuously retrain the `GradientBoostingClassifier` on captured real-world recovery outcomes to refine probability calibration.
- **Persistent Background Scheduler**: Transition from in-process background tasks to a distributed task queue (e.g. Celery / Redis or Temporal) for resilient inter-attempt retry timing.
- **Multi-Tenant Organization Support**: Add merchant account isolation to support enterprise platforms managing multiple Razorpay accounts simultaneously.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

*Built for evaluation and demonstration within the Razorpay developer ecosystem.*
