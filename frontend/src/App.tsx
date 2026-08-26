import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
type RazorpayResponse = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string };
type RazorpayCheckout = new (options: Record<string, unknown>) => { open: () => void };
declare global { interface Window { Razorpay?: RazorpayCheckout; } }
type Order = { id: string; amount: number; currency: string };
type RecoveryCase = { id: string; case_number: string; customer_email: string | null; amount: number; status: string; failure_reason: string | null; recovery_probability: number | null; recovery_action: string; policy_reason: string | null };
type AuditEvent = { id: string; event_type: string; timestamp: string; event_data: Record<string, unknown> };

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
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [stats, setStats] = useState<{ revenue_at_risk: number; revenue_recovered: number; recovery_rate: number; cases_processed: number } | null>(null);
  const [selected, setSelected] = useState<RecoveryCase | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [view, setView] = useState<"queue" | "checkout">("queue");

  const refreshQueue = async () => {
    try {
      const [nextCases, nextStats] = await Promise.all([requestJson<RecoveryCase[]>("/api/cases"), requestJson<typeof stats>("/api/dashboard/stats")]);
      setCases(nextCases); setStats(nextStats); if (!selected && nextCases[0]) setSelected(nextCases[0]);
    } catch { /* The empty state remains useful before the first failed webhook. */ }
  };
  useEffect(() => { void refreshQueue(); }, []);
  useEffect(() => { if (selected) void requestJson<AuditEvent[]>(`/api/cases/${selected.id}/audit`).then(setAudit).catch(() => setAudit([])); }, [selected]);

  const executeSelected = async () => {
    if (!selected) return;
    setLoading(true);
    try { const result = await requestJson<{ message: string }>(`/api/cases/${selected.id}/execute`, { method: "POST" }); setVerificationResult(result.message); await refreshQueue(); }
    catch (executeError) { setError(executeError instanceof Error ? executeError.message : "Recovery could not be executed."); }
    finally { setLoading(false); }
  };

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

  return <main className="app-shell"><section className="brand"><span>R</span><div>RAZORPAY<br /><strong>RECOVERAI</strong></div><nav><button onClick={() => setView("queue")}>Recovery Queue</button><button onClick={() => setView("checkout")}>Test Checkout</button></nav></section>{view === "checkout" ? <section className="checkout-card"><p className="eyebrow">DEVELOPMENT / TEST PAGE</p><h1>Razorpay Test Checkout</h1><p className="intro">Creates a ₹100 Razorpay Test Mode order and verifies the signed response server-side.</p><button className="checkout-button" onClick={() => void openTestCheckout()} disabled={loading}>{loading ? "Preparing checkout…" : "Pay ₹100 in Test Mode"}</button>{error && <p className="error" role="alert">{error}</p>}<dl className="checkout-results"><div><dt>Order ID</dt><dd>{order?.id ?? "—"}</dd></div><div><dt>Payment ID</dt><dd>{paymentId}</dd></div><div><dt>Checkout result</dt><dd>{checkoutResult}</dd></div><div><dt>Server verification</dt><dd>{verificationResult}</dd></div></dl></section> : <section className="recovery-ui"><p className="eyebrow">AI RECOVERY QUEUE</p><h1>Protect revenue with policy in control.</h1><div className="stat-grid">{[["Revenue at risk", stats?.revenue_at_risk], ["Revenue recovered", stats?.revenue_recovered], ["Recovery rate", stats ? `${Math.round(stats.recovery_rate * 100)}%` : "—"], ["Cases processed", stats?.cases_processed]].map(([label, value]) => <article key={String(label)}><small>{label}</small><strong>{typeof value === "number" ? `₹${(value / 100).toLocaleString("en-IN")}` : value ?? "—"}</strong></article>)}</div><div className="queue-layout"><section><button className="checkout-button" onClick={() => void refreshQueue()}>Refresh queue</button>{cases.length ? cases.map((item) => <button className={`case-row ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelected(item)}><b>{item.case_number}</b><span>{item.customer_email ?? "Unknown customer"} · ₹{(item.amount / 100).toLocaleString("en-IN")}</span><span>{item.recovery_probability === null ? "Awaiting analysis" : `${Math.round(item.recovery_probability * 100)}% recovery potential`} · {item.status}</span></button>) : <p className="intro">No recovery cases yet. A verified <code>payment.failed</code> webhook will appear here.</p>}</section><aside>{selected ? <><p className="eyebrow">AI EXPLANATION</p><h2>{selected.case_number}</h2><p>{selected.policy_reason ?? "Policy will be checked before execution."}</p><p>Recommended action: <b>{selected.recovery_action}</b></p><button className="checkout-button" onClick={() => void executeSelected()} disabled={loading}>Execute permitted recovery</button><h3>Audit timeline</h3>{audit.map((event) => <p className="audit" key={event.id}><b>{event.event_type}</b><br />{new Date(event.timestamp).toLocaleString()}</p>)}</> : <p>Select a case to view its policy, AI explanation, and audit trail.</p>}</aside></div></section>}</main>;
}

export default App;
