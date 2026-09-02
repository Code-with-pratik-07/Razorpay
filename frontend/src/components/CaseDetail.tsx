import React from 'react';
import { RecoveryCase, Explanation, AuditEvent, Execution, formatINR, title, formatDate } from '../types';
import { Badge } from './Badge';
import { DecisionPipeline } from './DecisionPipeline';
import { AIAdvisorCard } from './AIAdvisorCard';
import { AuditTimeline } from './AuditTimeline';

interface CaseDetailProps {
  selected: RecoveryCase | null;
  explanation: Explanation | null;
  audit: AuditEvent[];
  execution: Execution | null;
  detailLoading: boolean;
  actionLoading: string | null;
  analyze: () => Promise<void>;
  execute: () => Promise<void>;
  setNotice: (n: string) => void;
}

export function CaseDetail({
  selected,
  explanation,
  audit,
  execution,
  detailLoading,
  actionLoading,
  analyze,
  execute,
  setNotice
}: CaseDetailProps) {
  if (detailLoading && !selected) {
    return <div className="empty-state">Loading case details...</div>;
  }
  
  if (!selected) {
    return <div className="empty-state">Select a case to view details</div>;
  }

  const mlDecision = explanation?.ml_decision ?? null;
  const policyAllowed = explanation?.policy.allowed ?? selected?.policy_check_passed ?? false;
  const existingPaymentLink = audit.find((event) => event.event_type === "payment_link_created")?.event_data.url as string | undefined;
  const currentLink = execution?.payment_link_url || existingPaymentLink;

  const recoveryStartedEvent = audit.find((e) => e.event_type === "recovery_started");
  const isAutomatic = recoveryStartedEvent?.event_data.automatic === true;
  const executionMode = isAutomatic ? "AUTOMATIC" : recoveryStartedEvent ? "MANUAL" : "";

  // Find mock email preview from audit events
  const emailPreviewEvent = audit.find((e) => e.event_type === "email_notification_mocked" && e.event_data.email_html_preview);
  const emailHtmlPreview = emailPreviewEvent?.event_data.email_html_preview as string | undefined;
  const [showEmailPreview, setShowEmailPreview] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // Determine what action buttons the merchant can see
  const isAbandoned = selected.status === 'abandoned';
  const isHumanReview = selected.status === 'human_review';
  const isRecovering = selected.status === 'recovering';
  const isRecovered = selected.status === 'recovered';

  // Merchant can approve recovery for HUMAN_REVIEW if under retry limit
  // The backend will enforce manual policy limits upon execution.
  const canApproveRecovery = isHumanReview && selected.retry_count < selected.max_retries;

  // ML routing label helpers
  const mlBadge = mlDecision === 'HIGH'
    ? { label: 'HIGH CONFIDENCE', cls: 'ml-high' }
    : mlDecision === 'UNCERTAIN'
    ? { label: 'UNCERTAIN — Human Review', cls: 'ml-uncertain' }
    : mlDecision === 'LOW'
    ? { label: 'LOW — Attempt Limit Reached', cls: 'ml-low' }
    : mlDecision === 'COLD_START'
    ? { label: 'LIMITED HISTORY', cls: 'ml-cold' }
    : null;

  return (
    <>
      <header className="details-header">
        <div className="details-title">
          <h2>
            {selected.case_number} 
            {selected.case_number === 'DEMO-C-RECOVERED' && <span className="synthetic-badge">Synthetic Demo Data</span>}
            {isAutomatic && isRecovering && <span className="synthetic-badge" style={{background:'#0ea5e9',marginLeft:8}}>AUTO</span>}
          </h2>
          <div className="details-meta">{selected.customer_email ?? 'Unknown'} • {title(selected.payment_method)}</div>
          <div className="details-meta email-status">
            <strong>Notification: </strong>
            {selected.notification_status === 'SENT' ? "✓ Recovery email sent to customer." :
             selected.notification_status === 'NOT_AVAILABLE' ? "No customer email available." :
             selected.notification_status === 'FAILED' ? "Payment Link exists, but email delivery failed." :
             selected.notification_status === 'MOCKED' ? "Email mocked — " : "Pending"}
            {selected.notification_status === 'MOCKED' && emailHtmlPreview && (
              <button
                id="view-email-preview-btn"
                className="button secondary"
                style={{marginLeft: 8, padding: '2px 10px', fontSize: '0.75rem'}}
                onClick={() => setShowEmailPreview(v => !v)}
              >
                {showEmailPreview ? 'Hide Email' : 'View Generated Email'}
              </button>
            )}
          </div>
          {showEmailPreview && emailHtmlPreview && (
            <div className="email-preview-panel" style={{
              marginTop: 12, padding: 16, background: '#0f1729', border: '1px solid #2a3a5c',
              borderRadius: 8, maxHeight: 320, overflowY: 'auto'
            }}>
              <div style={{marginBottom: 8, color: '#64748b', fontSize: '0.75rem'}}>
                📧 MOCKED EMAIL PREVIEW — not actually sent
              </div>
              <div dangerouslySetInnerHTML={{ __html: emailHtmlPreview }} />
            </div>
          )}
        </div>
        <div className="details-amount">
          {formatINR(selected.amount)}
          <div className="status-badge-wrapper"><Badge value={selected.status} /></div>
        </div>
      </header>

      <div className="details-body">
        <DecisionPipeline selected={selected} explanation={explanation} />

        {explanation && (
          <div className="intelligence-panel">
             <div className="intelligence-card">
               <h4><i/> Case Metrics</h4>
                <div className="stat-row"><span>ML Probability</span> <b>{mlDecision === 'COLD_START' ? "N/A (Cold Start)" : explanation.ml.recovery_probability != null ? (explanation.ml.recovery_probability * 100).toFixed(1) + "%" : "—"}</b></div>
               {mlBadge && (
                 <div className="stat-row">
                   <span>ML Decision</span>
                   <b className={mlBadge.cls} style={{
                     fontSize: '0.7rem', padding: '2px 7px', borderRadius: 4,
                     background: mlDecision === 'HIGH' ? '#064e3b' : mlDecision === 'UNCERTAIN' ? '#78350f' : mlDecision === 'COLD_START' ? '#1e3a8a' : '#3b1515',
                     color: mlDecision === 'HIGH' ? '#34d399' : mlDecision === 'UNCERTAIN' ? '#fbbf24' : mlDecision === 'COLD_START' ? '#93c5fd' : '#f87171',
                   }}>{mlBadge.label}</b>
                 </div>
               )}
               <div className="stat-row"><span>Recovery Tier</span> <b>{mlDecision === 'COLD_START' ? 'COLD START' : mlDecision}</b></div>
               <div className="stat-row"><span>Max Attempts</span> <b>{selected.max_retries}</b></div>
               <div className="stat-row"><span>Attempts Used</span> <b>{selected.retry_count}</b></div>
               <div className="stat-row"><span>Attempts Remaining</span> <b>{Math.max(0, selected.max_retries - selected.retry_count)}</b></div>
               <div className="stat-row"><span>Lifetime Value</span> <b>{formatINR(explanation.customer_history.lifetime_value)}</b></div>
               <div className="stat-row"><span>Success Rate</span> <b>{explanation.customer_history.successful_payments} / {explanation.customer_history.successful_payments + explanation.customer_history.failed_payments}</b></div>
             </div>
             <div className="intelligence-card">
               <h4><i/> Policy Enforcement</h4>
               <div className="stat-row"><span>Decision</span> <b>{explanation.policy.allowed ? "APPROVED" : "BLOCKED"}</b></div>
               <div className="stat-row"><span>Reason</span> <b>{title(explanation.policy.reason)}</b></div>
               <div className="stat-row"><span>Human Review</span> <b>{explanation.policy.requires_human_approval ? "Required by policy" : "Not Required"}</b></div>
             </div>

             <div className="intelligence-card" style={{gridColumn: '1 / -1'}}>
               <h4><i/> ML Routing</h4>
               <div className="stat-row"><span>Tier</span> <b>{mlDecision === 'COLD_START' ? 'COLD START' : mlDecision}</b></div>
               <div className="stat-row"><span>Action</span> <b>
                 {mlDecision === 'HIGH' ? "Automatic Recovery Permitted" 
                 : mlDecision === 'UNCERTAIN' ? "Controlled Automatic Recovery (2 Attempts)" 
                 : mlDecision === 'LOW' ? "Controlled Automatic Recovery (1 Attempt)" 
                 : "Controlled Workflow (Limited History)"}
               </b></div>
               <div className="stat-row" style={{flexDirection: 'column', alignItems: 'flex-start'}}>
                  <span style={{marginBottom: 4}}>Reason</span> 
                  <b style={{fontSize: 12}}>
                    {mlDecision === 'HIGH' ? "Recovery probability is >= 60%, qualifying for automatic execution."
                    : mlDecision === 'UNCERTAIN' ? "Recovery probability is between 40% and 59.99%. A controlled automatic recovery attempt is permitted."
                    : mlDecision === 'LOW' ? "Recovery probability is < 40%. A single automatic attempt is permitted."
                    : "Customer has fewer than 3 historical transactions."}
                  </b>
               </div>
             </div>
          </div>
        )}

        {explanation?.ai && <AIAdvisorCard explanation={explanation} />}

        {(execution || currentLink) && (
          <div className="success-panel">
            <h3>{isRecovered ? '✓ CUSTOMER PAYMENT' : '✓ RECOVERY ACTION EXECUTED'}</h3>
            <p>
              {isRecovered
                ? <>Payment received successfully.<br/><br/><b>✓ RECOVERY ACTION EXECUTED</b><br/>Payment Link recovery was initiated.</>
                : (execution?.message || "Payment Link recovery is in progress.")}
            </p>
            {currentLink && (currentLink.startsWith("http://") || currentLink.startsWith("https://")) && (
              <>
                <div className="success-link">{currentLink}</div>
                <div className="success-actions">
                  <a className="button" href={currentLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Open Payment Link ↗</a>
                  <button
                    className="button secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      void navigator.clipboard.writeText(String(currentLink));
                      setNotice("Link copied to clipboard!");
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? "Copied ✓" : "Copy Link"}
                  </button>
                </div>
              </>
            )}
            {currentLink && !(currentLink.startsWith("http://") || currentLink.startsWith("https://")) && (
              <>
                <div className="success-link simulated">{currentLink}</div>
                <div className="success-actions" style={{ marginTop: '1rem' }}>
                  <button
                    className="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.location.href = `/simulate-payment/${selected.id}`;
                    }}
                  >
                    Open Simulated Payment ↗
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {selected.last_payment_status === 'FAILED' && (
          <div className="alert error" style={{ marginBottom: '1.5rem', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', padding: '1rem', borderRadius: '8px' }}>
            <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>✕</span> CUSTOMER PAYMENT FAILED
            </h3>
            <p style={{ margin: '0.5rem 0' }}>The customer attempted to complete payment using the active recovery link, but the payment was unsuccessful.</p>
            <p style={{ margin: '0.5rem 0' }}>
              <b>Failure reason:</b><br/>
              {selected.last_payment_failure_reason || 'Simulated payment failure'}
            </p>
            <p style={{ margin: '0.5rem 0' }}>
              <b>Recovery workflow:</b><br/>
              The active payment link and scheduled reminders remain valid according to the recovery lifecycle.
            </p>
            {selected.last_payment_attempt_at && (
              <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: '#7f1d1d' }}>
                <b>Last Payment Attempt:</b> {formatDate(selected.last_payment_attempt_at)}
              </p>
            )}
          </div>
        )}

        <div className="action-panel">
           <div className="action-info">
             {isAbandoned ? (
               <span style={{color:'#f87171'}}>
                 <b>Recovery abandoned</b><br/>
                 Recovery attempt limit has been reached. The existing payment link remains available until its scheduled expiry.
               </span>
             ) : isRecovered ? (
               <span>
                 <b>Recovery:</b> {executionMode || 'AUTOMATIC'}<br/>
                 <b>Payment Link:</b> PAID<br/>
                 <b>Customer Payment:</b> PAYMENT RECEIVED
               </span>
             ) : isHumanReview ? (
               canApproveRecovery
                 ? <span style={{color:'#fbbf24'}}><b>Human Review Required</b> — Click "Approve Recovery" to proceed.</span>
                 : <span style={{color:'#f87171'}}><b>Human Review Required</b> — Recovery cannot be approved (low probability).</span>
             ) : (
               <span>
                 <b>Recovery:</b> {executionMode || 'AUTOMATIC'}<br/>
                 <b>Attempts Used:</b> {selected.retry_count} / {selected.max_retries}<br/>
                 <b>Active Payment Link:</b> {(selected.payment_link_expires_at && new Date(selected.payment_link_expires_at).getTime() > Date.now()) ? 'Yes' : 'No'}<br/>
                 {selected.payment_link_expires_at && (
                    <><b>Payment Link Expiry:</b> {formatDate(selected.payment_link_expires_at)}<br/></>
                 )}
                 {selected.last_notification_at && (
                    <><b>Last Notification:</b> {formatDate(selected.last_notification_at)}<br/></>
                 )}
                 <b>Next Scheduled Action:</b> {
                    selected.next_action_type === 'reminder' ? `Reminder scheduled for ${formatDate(selected.next_action_at)}` :
                    selected.next_action_type === 'expiry_check' ? `Waiting for payment link expiry at ${formatDate(selected.next_action_at)}` :
                    selected.next_action_type === 'recovery_attempt' ? `Next recovery attempt eligible after expiry` :
                    selected.retry_count >= selected.max_retries ? `Recovery attempt limit has been reached. The existing payment link remains available until its scheduled expiry.` :
                    currentLink ? 'Waiting for customer payment' :
                    (explanation?.execution_error ? 'FAILED TO CREATE' : 'Pending')
                 }
               </span>
             )}
           </div>

           <div className="action-buttons">
             <button id="view-analysis-btn" className="button secondary" onClick={() => void analyze()} disabled={actionLoading !== null}>
               {actionLoading === 'analyze' ? <span className="spinner"/> : null}
               View Analysis
             </button>

             {/* Approve Recovery — only for HUMAN_REVIEW with NOT LOW */}
             {canApproveRecovery && !isRecovered && (
               <button id="approve-recovery-btn" className="button primary" onClick={() => void execute()} disabled={actionLoading !== null}>
                 {actionLoading === 'execute' ? <span className="spinner"/> : null}
                 Approve Recovery
               </button>
             )}
           </div>
        </div>

        <AuditTimeline audit={audit} />
      </div>
    </>
  );
}
