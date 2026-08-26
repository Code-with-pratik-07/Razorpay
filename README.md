# Razorpay RecoverAI

AI-assisted payment recovery and revenue protection for Razorpay Test Mode.

This first phase delivers FastAPI, SQLAlchemy models, a health endpoint, initial tests, and a React/Vite dashboard shell.

## Quick start

Backend: from `backend/`, create and activate a virtual environment, run `pip install -r requirements.txt`, then run `uvicorn app.main:app --reload`.

Frontend: from `frontend/`, run `npm install`, then `npm run dev`.

Copy `.env.example` to `.env` before configuring external services. Never commit it.

## Planned phases

Recovery policy and audit services, ML, Razorpay Test Mode/webhooks, Groq, dashboard views, demo data, simulation, tests, and full documentation follow in later phases.
