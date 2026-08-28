# RecoverAI Deployment Guide

This guide explains how to configure and deploy the RecoverAI dashboard for a production environment. 

## 1. Backend Deployment (Render / Railway / Heroku)

The backend is built with FastAPI and runs on Python 3.13. It requires a PostgreSQL or SQLite database.

### Environment Variables
Configure the following environment variables in your backend hosting provider (e.g., Render):

*   **`DATABASE_URL`**: Your connection string. (e.g., `postgresql://user:pass@host/dbname`). If Render provides `postgres://`, the backend will automatically upgrade it to `postgresql://`.
*   **`CORS_ORIGINS`**: A comma-separated list of allowed frontend domains. 
    *   *Example*: `https://recoverai-dashboard.vercel.app,http://localhost:5173`
*   **`RAZORPAY_KEY_ID`**: Your Razorpay Test Mode Key ID.
*   **`RAZORPAY_KEY_SECRET`**: Your Razorpay Test Mode Key Secret. **(KEEP SECRET)**
*   **`RAZORPAY_WEBHOOK_SECRET`**: A strong string used to verify Razorpay webhooks. **(KEEP SECRET)**
*   **`GROQ_API_KEY`**: Your API key from Groq for the AI Advisor. **(KEEP SECRET)**
*   **`DEMO_MODE`**: `true` or `false`.
    *   Set to `false` for normal production. Synthetic cases will be hidden and database resets are rejected.
    *   Set to `true` to enable deterministic Hackathon demo scenarios.

### Razorpay Webhooks
1.  Go to the Razorpay Dashboard -> Account & Settings -> Webhooks.
2.  Add a new webhook URL: `https://<YOUR-BACKEND-URL>/api/webhooks/razorpay`
3.  Set the secret to match your `RAZORPAY_WEBHOOK_SECRET`.
4.  Subscribe to the `payment.captured` and `payment.failed` events.

---

## 2. Frontend Deployment (Vercel)

The frontend is a React application powered by Vite.

### Vercel Configuration
1.  Connect your GitHub repository to Vercel.
2.  Set the **Framework Preset** to `Vite`.
3.  Set the **Root Directory** to `frontend`.
4.  Set the **Build Command** to `npm run build`.
5.  Set the **Output Directory** to `dist`.

### Environment Variables
You MUST configure this environment variable in the Vercel Dashboard before deploying:

*   **`VITE_API_BASE_URL`**: The URL of your deployed backend. 
    *   *Example*: `https://recoverai-backend.onrender.com` (No trailing slash).

**Note:** Never put Razorpay secrets, database URLs, or Groq API keys in the Vercel frontend environment variables. They belong ONLY in the backend.

---

## 3. Local Development

To run the application locally for testing:

1.  **Backend:**
    ```bash
    cd backend
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app.main:app --reload
    ```
2.  **Frontend:**
    ```bash
    cd frontend
    npm install
    npm run dev
    ```
    The frontend will automatically fallback to `http://127.0.0.1:8000` if `VITE_API_BASE_URL` is not set.

---

## Troubleshooting

### "Unable to connect to the backend..." Error in UI
- **Cause:** The frontend cannot reach the backend.
- **Fix:** Check if your backend is running. Ensure `VITE_API_BASE_URL` in Vercel exactly matches your backend URL. Ensure `CORS_ORIGINS` in your backend exactly matches your Vercel URL.

### "Bad Gateway" Error
- **Cause:** The backend server is down or crashed.
- **Fix:** Check your backend logs (e.g., Render Dashboard).

### Payment Link Not Created
- **Cause:** Razorpay credentials might be missing or invalid.
- **Fix:** Verify `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in your backend environment.

### Webhook Not Received
- **Cause:** Razorpay cannot reach your backend.
- **Fix:** Ensure your webhook URL is public and correct. Check the Razorpay Webhooks dashboard for delivery failures. Ensure your webhook secret matches exactly.
