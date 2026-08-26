import { useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayCheckout = new (options: Record<string, unknown>) => { open: () => void };
declare global { interface Window { Razorpay?: RazorpayCheckout; } }
type Order = { id: string; amount: number; currency: string };

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? "The backend request failed.");
  return body as T;
}

function loadRazorpaySdk(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-razorpay-checkout="true"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Unable to load Razorpay Checkout.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Razorpay Checkout."));
    document.body.appendChild(script);
  });
}

function App() {
  const [order, setOrder] = useState<Order | null>(null);
  const [paymentId, setPaymentId] = useState("—");
  const [checkoutResult, setCheckoutResult] = useState("Not started");
  const [verificationResult, setVerificationResult] = useState("Not requested");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const verifyPayment = async (payment: RazorpayResponse) => {
    setPaymentId(payment.razorpay_payment_id);
    setCheckoutResult("Checkout returned a signed payment response");
    setVerificationResult("Verifying with server…");
    try {
      const verified = await requestJson<{ verified: boolean }>("/api/payments/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payment) });
      setVerificationResult(verified.verified ? "Server signature verification passed" : "Server verification did not pass");
    } catch (verificationError) {
      setVerificationResult(`Server verification failed: ${verificationError instanceof Error ? verificationError.message : "Unknown error"}`);
    }
  };

  const openTestCheckout = async () => {
    setLoading(true); setError(null); setPaymentId("—"); setCheckoutResult("Creating ₹100 Test Mode order…"); setVerificationResult("Not requested");
    try {
      await loadRazorpaySdk();
      const [config, createdOrder] = await Promise.all([
        requestJson<{ key_id: string }>("/api/payments/checkout-config"),
        requestJson<Order>("/api/payments/create-order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 10000, currency: "INR", receipt: `recoverai-test-${Date.now()}`, notes: { source: "recoverai_temporary_test_checkout" } }) }),
      ]);
      setOrder(createdOrder); setCheckoutResult("Order created; Razorpay Checkout opened");
      if (!window.Razorpay) throw new Error("Razorpay Checkout did not initialise.");
      new window.Razorpay({
        key: config.key_id, amount: createdOrder.amount, currency: createdOrder.currency,
        name: "Razorpay RecoverAI", description: "Development / Test Mode payment", order_id: createdOrder.id,
        handler: (payment: RazorpayResponse) => { void verifyPayment(payment); },
        modal: { ondismiss: () => setCheckoutResult("Checkout closed without a completed payment") }, theme: { color: "#276cff" },
      }).open();
    } catch (checkoutError) {
      const message = checkoutError instanceof Error ? checkoutError.message : "Unable to start test checkout.";
      setCheckoutResult("Checkout could not start"); setError(message);
    } finally { setLoading(false); }
  };

  return <main className="app-shell"><section className="brand"><span>R</span><div>RAZORPAY<br /><strong>RECOVERAI</strong></div></section><section className="checkout-card"><p className="eyebrow">DEVELOPMENT / TEST PAGE</p><h1>Razorpay Test Checkout</h1><p className="intro">Creates a ₹100 Razorpay Test Mode order, opens Checkout, then sends the signed result to the backend for server-side verification. It never marks a payment successful in the browser.</p><button className="checkout-button" onClick={() => void openTestCheckout()} disabled={loading}>{loading ? "Preparing checkout…" : "Pay ₹100 in Test Mode"}</button>{error && <p className="error" role="alert">{error}</p>}<dl className="checkout-results"><div><dt>Order ID</dt><dd>{order?.id ?? "—"}</dd></div><div><dt>Payment ID</dt><dd>{paymentId}</dd></div><div><dt>Checkout result</dt><dd>{checkoutResult}</dd></div><div><dt>Server verification</dt><dd>{verificationResult}</dd></div></dl></section></main>;
}

export default App;
