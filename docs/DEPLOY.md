# RecoverAI Deployment Guide

This guide explains how to deploy the Razorpay RecoverAI project for a hackathon or demo environment using free-tier services. 

> [!WARNING]
> **Free-Tier Limitations**: This deployment utilizes Render's free tier for the backend and PostgreSQL, and Vercel's free tier for the frontend. 
> - Render free Web Services spin down after 15 minutes of inactivity. The first request after a spin-down will take 30-60 seconds (a "cold start").
> - Render free PostgreSQL databases expire after 30 days.
> This setup is perfect for a hackathon demonstration but is **not** suitable for permanent production infrastructure without upgrading to paid plans.

---

## A. Accounts Required

Before you begin, ensure you have active accounts for the following services:
1. **GitHub**: To host your repository.
2. **Render** (render.com): To host the Python backend and PostgreSQL database.
3. **Vercel** (vercel.com): To host the React frontend.
4. **Razorpay**: To obtain API keys and configure webhooks.
5. **Groq**: To obtain the LLM API key.

## B. GitHub Connection

Ensure your local repository is pushed to a GitHub repository that you own. Both Render and Vercel will connect directly to this repository to automate deployments.

## C & D. Deploy Backend & PostgreSQL (Render)

We have provided a `render.yaml` Infrastructure-as-Code file that automatically provisions both the PostgreSQL database and the Backend Web Service.

1. Go to your Render Dashboard.
2. Click **New +** and select **Blueprint**.
3. Connect your GitHub repository.
4. Render will detect the `render.yaml` file. Click **Apply**.
5. Render will begin provisioning the `recoverai-db` (PostgreSQL) and the `recoverai-backend` (Web Service). 

## E. Configure Backend Environment Variables

Once the backend service is created in Render, go to the **Environment** tab of your `recoverai-backend` Web Service and fill in the missing values:

- `CORS_ORIGINS`: Set this to your frontend URL later (e.g., `https://your-frontend.vercel.app`).
- `RAZORPAY_KEY_ID`: Your Razorpay Test Key ID.
- `RAZORPAY_KEY_SECRET`: Your Razorpay Test Key Secret.
- `RAZORPAY_WEBHOOK_SECRET`: A secure random string you choose (e.g., `my_secure_webhook_secret_123`).
- `GROQ_API_KEY`: Your Groq API key (`gsk_...`).
- `DEMO_MODE`: Set to `true` for the hackathon presentation.
- *(Note: `DATABASE_URL` is automatically securely injected by Render).*

After saving, Render will automatically trigger a new deployment. Wait for it to complete. Note your backend URL (e.g., `https://recoverai-backend-xxxx.onrender.com`).

## F & G. Deploy Frontend & Configure API URL (Vercel)

1. Go to your Vercel Dashboard.
2. Click **Add New...** -> **Project**.
3. Import your GitHub repository.
4. Expand the **Environment Variables** section before deploying.
5. Add the following variable:
   - Key: `VITE_API_BASE_URL`
   - Value: Your Render backend URL (e.g., `https://recoverai-backend-xxxx.onrender.com`). *Ensure there is no trailing slash.*
6. Click **Deploy**. Vercel will build and host the frontend. Note your public Vercel URL.

## H. Configure Production CORS

Now that you have your Vercel URL, go back to your **Render Backend Environment** settings.
1. Update `CORS_ORIGINS` to exactly match your Vercel URL (e.g., `https://recoverai.vercel.app`). Do not use a trailing slash or wildcard (`*`).
2. Save and allow the backend to restart.

## I. Configure Razorpay Webhook

To receive live failure events, you must configure Razorpay to talk to your backend.
1. Go to the Razorpay Dashboard -> **Account & Settings** -> **Webhooks**.
2. Click **Add New Webhook**.
3. **Webhook URL**: `https://your-backend.onrender.com/api/webhooks/razorpay`
4. **Secret**: Enter the exact string you used for `RAZORPAY_WEBHOOK_SECRET` in step E.
5. **Active Events**: Check `payment.failed`, `payment.captured`, and `order.paid`. *(Note: `payment_link.paid` is not currently processed by the worker).*
6. Click **Save**.

## J. Configure Groq

Ensure your `GROQ_API_KEY` is valid. The backend uses the `llama-3.3-70b-versatile` model by default. If Groq rate-limits your request, the system will gracefully fall back to a deterministic advisor.

## K. Enable DEMO_MODE for Hackathon

By setting `DEMO_MODE=true` in Render, the frontend will display the "Demo Environment Active" banner. This allows judges to safely click **Reset Demo Data** to populate the PostgreSQL database with 50 synthetic failed payments. This reset does **not** consume real Razorpay or Groq API calls.

## L. Run Production Smoke Tests

1. Visit your Vercel frontend URL.
2. Ensure the UI loads and the "Demo Environment Active" banner is visible.
3. Click **Reset Demo Data**. Wait for it to succeed.
4. Verify the Dashboard stats update with synthetic cases.
5. Click **Analyze** on a case to verify the ML and Policy engines respond.

## M. Troubleshooting

- **CORS Errors in browser console:** Double-check that your Render `CORS_ORIGINS` exactly matches the Vercel URL (including `https://` and no trailing slash).
- **Webhook Signature Mismatch:** Ensure the secret in Razorpay exactly matches the `RAZORPAY_WEBHOOK_SECRET` in Render.
- **Backend takes 60 seconds to respond:** This is a Render cold start. Refresh the page. To avoid this during your live pitch, ping your backend URL manually 1 minute before you present.

## N. How to Disable Demo Mode

For a true production environment, go to Render -> Environment, and set `DEMO_MODE=false`. This immediately removes the demo banner and physically blocks the reset API from wiping the database.

## O. How to Rollback

- **Frontend (Vercel):** Go to Vercel -> Deployments -> Click the three dots on a previous successful deployment -> **Promote to Production**.
- **Backend (Render):** Go to Render -> Events -> Find a successful previous deploy -> **Rollback to this deploy**.
