import React from 'react';
import { RecoveryCase, Explanation, AuditEvent, Execution, formatINR, title } from '../types';
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

  const policyAllowed = explanation?.policy.allowed ?? selected?.policy_check_passed ?? false;
  const existingPaymentLink = audit.find((event) => event.event_type === "payment_link_created")?.event_data.url as string | undefined;
  const currentLink = execution?.payment_link_url || existingPaymentLink;

  const recoveryStartedEvent = audit.find((e) => e.event_type === "recovery_started");
  const isAutomatic = recoveryStartedEvent?.event_data.automatic === true;
  const executionMode = isAutomatic ? "AUTOMATIC" : recoveryStartedEvent ? "MANUAL" : "";

  return (
    <>
      <header className="details-header">
        <div className="details-title">
          <h2>
            {selected.case_number} 
            {selected.case_number === 'DEMO-C-RECOVERED' && <span className="synthetic-badge">Synthetic Demo Data</span>}
          </h2>
          <div className="details-meta">{selected.customer_email ?? 'Unknown'} • {title(selected.payment_method)}</div>
          <div className="details-meta email-status">
            <strong>Email: </strong>
            {selected.notification_status === 'SENT' ? "Recovery instructions sent to the customer." :
             selected.notification_status === 'NOT_AVAILABLE' ? "No customer email is available." :
             selected.notification_status === 'FAILED' ? "Payment Link exists, but notification delivery failed." :
             selected.notification_status === 'NOT_SENT' ? "Notification has not been sent." : "Pending"}
          </div>
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
               <div className="stat-row"><span>Probability</span> <b>{explanation.ml.recovery_probability != null ? (explanation.ml.recovery_probability * 100).toFixed(1) + "%" : "—"}</b></div>
               <div className="stat-row"><span>Lifetime Value</span> <b>{formatINR(explanation.customer_history.lifetime_value)}</b></div>
               <div className="stat-row"><span>Success Rate</span> <b>{explanation.customer_history.successful_payments} / {explanation.customer_history.successful_payments + explanation.customer_history.failed_payments}</b></div>
             </div>
             <div className="intelligence-card">
               <h4><i/> Policy Enforcement</h4>
               <div className="stat-row"><span>Decision</span> <b>{explanation.policy.allowed ? "APPROVED" : "BLOCKED"}</b></div>
               <div className="stat-row"><span>Reason</span> <b>{title(explanation.policy.reason)}</b></div>
               <div className="stat-row"><span>Human Review</span> <b>{explanation.policy.requires_human_approval ? "Required" : "Not Required"}</b></div>
             </div>
          </div>
        )}

        {explanation?.ai && <AIAdvisorCard explanation={explanation} />}

        {(execution || currentLink) && (
          <div className="success-panel">
            <h3>{selected.status === 'recovered' ? '✓ PAYMENT SUCCESSFUL' : '✓ RECOVERY ACTION EXECUTED'}</h3>
            <p>{selected.status === 'recovered' ? 'Revenue successfully recovered via Razorpay.' : (execution?.message || "Payment Link recovery is in progress.")}</p>
            {currentLink && currentLink !== "mock_demo_link" && currentLink !== "mock_demo_real_simulated" && (
              <>
                <div className="success-link">{currentLink}</div>
                <div className="success-actions">
                  <a className="button" href={currentLink} target="_blank" rel="noreferrer">Open Payment Link ↗</a>
                  <button
                    className="button secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(String(currentLink));
                      setNotice("Link copied to clipboard!");
                    }}
                  >
                    Copy Link
                  </button>
                </div>
              </>
            )}
            {currentLink === "mock_demo_link" && !execution && (
               <div className="demo-payment-link">
                  <b>DEMO PAYMENT LINK</b><br/>
                  Execute Recovery to generate a real Razorpay Test Mode Payment Link.
               </div>
            )}
            {currentLink === "mock_demo_real_simulated" && (
               <div className="demo-payment-link">
                  <b>SIMULATED PAYMENT LINK</b><br/>
                  This is a safely protected case. It will not execute as a live URL.
               </div>
            )}
          </div>
        )}

        <div className="action-panel">
           <div className="action-info">
             <b>Execute Action</b>
             {selected.status === 'recovered' ? 'Revenue successfully recovered.' : selected.status === 'recovering' ? `Payment link is active. ${executionMode ? `(${executionMode})` : ''}` : policyAllowed ? 'Ready to execute recommendation.' : 'Policy blocked execution.'}
           </div>

           <div className="action-buttons">
             <button className="button secondary" onClick={() => void analyze()} disabled={actionLoading !== null}>
               {actionLoading === 'analyze' ? <span className="spinner"/> : null}
               Analyze
             </button>

             {policyAllowed && selected.status !== 'recovered' && (selected.status !== 'recovering' || currentLink === 'mock_demo_link') && (
               <button className="button primary" onClick={() => void execute()} disabled={actionLoading !== null}>
                 {actionLoading === 'execute' ? <span className="spinner"/> : null}
                 Execute
               </button>
             )}
           </div>
        </div>

        <AuditTimeline audit={audit} />
      </div>
    </>
  );
}
