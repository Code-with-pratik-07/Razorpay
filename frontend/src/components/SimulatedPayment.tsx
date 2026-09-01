import { useEffect, useState } from "react";
import { RecoveryCase, formatINR } from "../types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export const SimulatedPayment = ({ caseId }: { caseId: string }) => {
  const [caseData, setCaseData] = useState<RecoveryCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<'success' | 'failure' | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<string>("card");

  useEffect(() => {
    const fetchCase = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/cases/${caseId}`);
        if (!response.ok) throw new Error("Failed to fetch case details.");
        const data = await response.json();
        setCaseData(data);
        if (data.payment_method) {
          setSelectedMethod(data.payment_method.toLowerCase());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred.");
      } finally {
        setLoading(false);
      }
    };
    void fetchCase();
  }, [caseId]);

  const simulatePayment = async (success: boolean) => {
    setProcessing(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/demo/simulate-payment/${caseId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success })
      });
      if (!response.ok) throw new Error("Failed to process simulated payment.");
      setResult(success ? 'success' : 'failure');
      setTimeout(() => {
        window.location.href = '/';
      }, success ? 3000 : 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment processing failed.");
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="simulated-payment-layout">
        <div className="simulated-payment-container loading">
          <div className="loader"></div>
          <p>Loading secure payment gateway...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="simulated-payment-layout">
        <div className="simulated-payment-container">
          <div className="alert error">{error}</div>
          <button className="button" onClick={() => window.location.href = '/'}>Return to Dashboard</button>
        </div>
      </div>
    );
  }

  if (!caseData) return null;

  return (
    <div className="simulated-payment-layout">
      <div className="simulated-payment-badge">
        <strong>Demo Mode</strong>
        <span>Simulated Payment Gateway</span>
      </div>

      <div className="simulated-payment-container">
        {result === 'success' ? (
          <div className="payment-result success">
            <div className="success-icon">✓</div>
            <h2>Payment Successful</h2>
            <p>Your simulated payment of {formatINR(caseData.amount)} has been confirmed.</p>
            <p className="redirect-text">Redirecting to dashboard...</p>
            <button className="button" onClick={() => window.location.href = '/'}>Return Now</button>
          </div>
        ) : result === 'failure' ? (
          <div className="payment-result error">
            <div className="error-icon">✗</div>
            <h2>Payment Failed</h2>
            <p>The payment failure has been recorded successfully. The recovery workflow will continue according to the scheduled recovery rules.</p>
            <p className="redirect-text">Redirecting to dashboard...</p>
          </div>
        ) : (
          <>
            <header className="checkout-header">
              <h1>RecoverAI</h1>
              <h2>Secure Checkout</h2>
            </header>

            <div className="checkout-summary">
              <div className="summary-row">
                <span>Case Reference</span>
                <strong>{caseData.case_number}</strong>
              </div>
              <div className="summary-row">
                <span>Customer</span>
                <strong>{caseData.customer_email || 'Customer'}</strong>
              </div>
              <div className="summary-row amount-row">
                <span>Amount Payable</span>
                <strong>{formatINR(caseData.amount)}</strong>
              </div>
            </div>

            <div className="payment-methods">
              <h3>Select Payment Method</h3>
              <div className="method-selector">
                {['card', 'upi', 'netbanking'].map(method => (
                  <label key={method} className={`method-option ${selectedMethod === method ? 'selected' : ''}`}>
                    <input 
                      type="radio" 
                      name="payment_method" 
                      value={method} 
                      checked={selectedMethod === method}
                      onChange={() => setSelectedMethod(method)}
                    />
                    {method.toUpperCase()}
                  </label>
                ))}
              </div>
            </div>

            <div className="mock-inputs">
              {selectedMethod === 'card' && (
                <>
                  <input type="text" placeholder="Card Number (Simulation)" disabled value="4111 1111 1111 1111" />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input type="text" placeholder="MM/YY" disabled value="12/25" />
                    <input type="text" placeholder="CVV" disabled value="123" />
                  </div>
                </>
              )}
              {selectedMethod === 'upi' && (
                <input type="text" placeholder="UPI ID" disabled value="demo@ybl" />
              )}
              {selectedMethod === 'netbanking' && (
                <select disabled>
                  <option>Demo Bank</option>
                </select>
              )}
            </div>

            <div className="checkout-actions">
              <button 
                className="button primary full-width" 
                disabled={processing}
                onClick={() => simulatePayment(true)}
              >
                {processing ? 'Processing...' : `Complete Payment (${formatINR(caseData.amount)})`}
              </button>
              
              <button 
                className="button secondary full-width fail-btn" 
                disabled={processing}
                onClick={() => simulatePayment(false)}
              >
                Simulate Payment Failure
              </button>

              <button 
                className="button text full-width" 
                disabled={processing}
                onClick={() => window.location.href = '/'}
              >
                Cancel and Return
              </button>
            </div>
            
            <div className="checkout-footer">
              <p>This is a safely simulated checkout for demonstration purposes.</p>
              <p>No real charges will be made. Do not enter real credentials.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
