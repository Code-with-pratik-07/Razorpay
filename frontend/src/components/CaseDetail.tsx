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
  const policyAllowed = explanation?.policy?.allowed ?? selected?.policy_check_passed ?? false;
  const existingPaymentLink = audit.find((event) => event.event_type === "payment_link_created")?.event_data.url as string | undefined;
  const currentLink = execution?.payment_link_url || existingPaymentLink;

  const recoveryStartedEvent = audit.find((e) => e.event_type === "recovery_started");
  const isAutomatic = recoveryStartedEvent?.event_data.automatic === true;
  const executionMode = isAutomatic ? "AUTOMATIC" : recoveryStartedEvent ? "MANUAL" : "";

  // Modal and preview states
  const [showCommModal, setShowCommModal] = React.useState(false);
  const [activeCommTab, setActiveCommTab] = React.useState<'email' | 'sms' | 'whatsapp'>('email');
  const [copied, setCopied] = React.useState(false);

  // Set default preview tab when opening modal
  const openCommunicationModal = (channelOverride?: 'email' | 'sms' | 'whatsapp') => {
    if (channelOverride) {
      setActiveCommTab(channelOverride);
    } else if (selected.notification_status === 'WHATSAPP_SIMULATED' || selected.selected_channel === 'whatsapp') {
      setActiveCommTab('whatsapp');
    } else if (selected.notification_status === 'SMS_SIMULATED' || selected.selected_channel === 'sms') {
      setActiveCommTab('sms');
    } else {
      setActiveCommTab('email');
    }
    setShowCommModal(true);
  };

  // Status flags
  const isAbandoned = selected.status === 'abandoned';
  const isHumanReview = selected.status === 'human_review';
  const isRecovering = selected.status === 'recovering';
  const isRecovered = selected.status === 'recovered';

  // Can approve recovery for HUMAN_REVIEW if under retry limit
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

  // Formatted date helper
  const formattedExpiry = selected.payment_link_expires_at
    ? formatDate(selected.payment_link_expires_at)
    : "In 7 days";

  // Normalized notification status label
  const getNotificationStatusDisplay = () => {
    if (isHumanReview || !policyAllowed) {
      return { text: "⏳ Waiting for Human Approval", cls: "status-waiting", canView: false };
    }
    if (selected.notification_status === 'WHATSAPP_SIMULATED') {
      return { text: "✓ WhatsApp Simulated", cls: "status-simulated", canView: true };
    }
    if (selected.notification_status === 'SMS_SIMULATED') {
      return { text: "✓ SMS Simulated", cls: "status-simulated", canView: true };
    }
    if (selected.notification_status === 'SENT') {
      return { text: "✓ Email Sent", cls: "status-sent", canView: true };
    }
    if (selected.notification_status === 'MOCKED' || selected.notification_status === 'GENERATED') {
      return { text: "✓ Email Generated", cls: "status-generated", canView: true };
    }
    if (selected.notification_status === 'NOT_AVAILABLE') {
      return { text: "No Customer Contact Endpoint Available", cls: "status-none", canView: false };
    }
    if (selected.notification_status === 'FAILED') {
      return { text: "Payment Link exists, but delivery failed.", cls: "status-failed", canView: true };
    }
    return { text: "Pending", cls: "status-pending", canView: false };
  };

  const notifDisplay = getNotificationStatusDisplay();

  // Handler for Complete Payment in all previews
  const handlePaymentClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentLink && (currentLink.startsWith("http://") || currentLink.startsWith("https://"))) {
      window.open(currentLink, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = `/simulate-payment/${selected.id}`;
    }
  };

  const channelIntel = explanation?.channel_intelligence;

  return (
    <>
      {/* 1. Case Header */}
      <header className="details-header">
        <div className="details-title">
          <h2>
            {selected.case_number} 
            {selected.case_number === 'DEMO-C-RECOVERED' && <span className="synthetic-badge">Synthetic Demo Data</span>}
            {isAutomatic && isRecovering && <span className="synthetic-badge" style={{background:'#0ea5e9',marginLeft:8}}>AUTO</span>}
          </h2>
          <div className="details-meta">
            {selected.customer_email ?? 'Unknown'} • {title(selected.payment_method)}
          </div>
          <div className="details-meta notification-meta">
            <span className={`notif-indicator ${notifDisplay.cls}`}>
              {notifDisplay.text}
            </span>
            {notifDisplay.canView && (
              <button
                id="view-comm-header-btn"
                className="button secondary comm-trigger-btn"
                onClick={() => openCommunicationModal()}
              >
                View Communication
              </button>
            )}
          </div>
        </div>
        <div className="details-amount">
          {formatINR(selected.amount)}
          <div className="status-badge-wrapper"><Badge value={selected.status} /></div>
        </div>
      </header>

      <div className="details-body">
        {/* 2. Recovery Journey (Pipeline) */}
        <DecisionPipeline selected={selected} explanation={explanation} />

        {/* 3. Key Metrics Grid */}
        {explanation && (
          <div className="intelligence-panel">
            <div className="intelligence-card">
              <h4><i/> Key Recovery Metrics</h4>
              <div className="stat-row">
                <span>ML Recovery Probability</span>
                <b>{mlDecision === 'COLD_START' ? "N/A (Cold Start)" : explanation.ml.recovery_probability != null ? (explanation.ml.recovery_probability * 100).toFixed(1) + "%" : "—"}</b>
              </div>
              {mlBadge && (
                <div className="stat-row">
                  <span>ML Decision Tier</span>
                  <b className={mlBadge.cls} style={{
                    fontSize: '0.7rem', padding: '2px 7px', borderRadius: 4,
                    background: mlDecision === 'HIGH' ? '#064e3b' : mlDecision === 'UNCERTAIN' ? '#78350f' : mlDecision === 'COLD_START' ? '#1e3a8a' : '#3b1515',
                    color: mlDecision === 'HIGH' ? '#34d399' : mlDecision === 'UNCERTAIN' ? '#fbbf24' : mlDecision === 'COLD_START' ? '#93c5fd' : '#f87171',
                  }}>{mlBadge.label}</b>
                </div>
              )}
              <div className="stat-row">
                <span>Recovery Attempts</span>
                <b>{selected.retry_count} of {selected.max_retries} used</b>
              </div>
              <div className="stat-row">
                <span>Customer Lifetime Value</span>
                <b>{formatINR(explanation.customer_history.lifetime_value)}</b>
              </div>
            </div>

            <div className="intelligence-card">
              <h4><i/> Policy Enforcement</h4>
              <div className="stat-row"><span>Decision</span> <b>{explanation.policy.allowed ? "APPROVED" : "BLOCKED"}</b></div>
              <div className="stat-row"><span>Reason</span> <b>{title(explanation.policy.reason)}</b></div>
              <div className="stat-row"><span>Human Review</span> <b>{explanation.policy.requires_human_approval ? "Required by policy" : "Not Required"}</b></div>
              <div className="stat-row"><span>Prior Successes</span> <b>{explanation.customer_history.successful_payments} completed payments</b></div>
            </div>

            {/* 4. Simplified, Professional Communication Intelligence Card */}
            {channelIntel && (
              <div className="intelligence-card communication-intelligence-card" style={{gridColumn: '1 / -1'}}>
                {/* Header & Compact Profile Badge */}
                <div className="comm-card-header">
                  <div className="comm-profile-compact">
                    <span className={`comm-profile-pill maturity-${channelIntel.communication_maturity.toLowerCase()}`}>
                      {channelIntel.communication_maturity === 'COLD_START' ? '🔵 COLD START' :
                       channelIntel.communication_maturity === 'LEARNING' ? '🟡 LEARNING' : '🟢 ESTABLISHED'}
                    </span>
                    <span className="comm-profile-desc">{channelIntel.maturity_description}</span>
                  </div>

                  <span className={`channel-status-pill status-${channelIntel.status.toLowerCase()}`}>
                    {channelIntel.status === 'RECOMMENDED' ? 'Recommended for recovery' :
                     channelIntel.status === 'SIMULATED' ? 'Simulated for Demo' :
                     channelIntel.status === 'SENT' ? 'Dispatched' :
                     channelIntel.status === 'POLICY_BLOCKED' ? 'Policy Blocked' :
                     channelIntel.status === 'COMPLETED' ? 'Recovery Complete' :
                     channelIntel.status === 'ATTEMPT_LIMIT_REACHED' ? 'Attempt Limit Reached' :
                     channelIntel.status}
                  </span>
                </div>

                {/* Primary Visual Focus: Recommended Channel */}
                <div className="comm-primary-focus">
                  <div className="comm-focus-channel">
                    <span className="comm-focus-icon">
                      {channelIntel.recommended_channel === 'whatsapp' ? '💬' :
                       channelIntel.recommended_channel === 'sms' ? '📱' : '✉️'}
                    </span>
                    <div>
                      <div className="comm-focus-title">
                        Recommended Channel: <b>{title(channelIntel.recommended_channel)}</b>
                      </div>
                      <div className="comm-focus-metrics">
                        <span className="comm-suitability-badge">
                          <b>{(channelIntel.suitability_score * 100).toFixed(0)}%</b> Channel Suitability
                        </span>
                        <span className={`comm-conf-badge conf-${channelIntel.confidence}`}>
                          {title(channelIntel.confidence)} Confidence
                        </span>
                      </div>
                      <div className="comm-subtle-hint">
                        Channel suitability measures the expected effectiveness of this communication method. It is not the customer's recovery probability.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Why This Channel? (1-2 Concise Sentences) */}
                <div className="comm-why-box">
                  <span className="comm-why-title">Why This Channel?</span>
                  <p className="comm-why-body">{channelIntel.reason}</p>
                </div>

                {/* Compact Alternative Channels */}
                <div className="comm-alts-row">
                  <span className="comm-alts-label">Alternative Channels:</span>
                  <div className="comm-alts-list">
                    {channelIntel.alternatives.map((alt) => {
                      const score = channelIntel.channel_scores[alt] ?? 0;
                      const icon = alt === 'whatsapp' ? '💬' : alt === 'sms' ? '📱' : '✉️';
                      return (
                        <span key={alt} className="comm-alt-item">
                          {icon} {title(alt)} — <b>{(score * 100).toFixed(0)}%</b>
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Communication Journey Timeline */}
                <div className="comm-journey-block">
                  <span className="comm-journey-title">Communication Journey</span>
                  <div className="journey-v-timeline">
                    {channelIntel.communication_journey && channelIntel.communication_journey.length > 0 ? (
                      channelIntel.communication_journey.map((item, idx) => {
                        const isPriorToNext = idx < channelIntel.communication_journey.length - 1;
                        const isIgnored = item.outcome === 'IGNORED';
                        return (
                          <React.Fragment key={idx}>
                            <div className="journey-v-step">
                              <div className="journey-v-badge">Attempt {item.attempt_number}</div>
                              <div className="journey-v-card">
                                <div className="journey-v-top">
                                  <span className="journey-v-channel">
                                    {item.channel === 'whatsapp' ? '💬 WhatsApp' : item.channel === 'sms' ? '📱 SMS' : '✉️ Email'}
                                  </span>
                                  <span className={`journey-v-status outcome-${item.outcome.toLowerCase()}`}>
                                    {item.outcome === 'PAYMENT_COMPLETED' ? '✓ Paid' : item.outcome.replace('_', ' ')}
                                  </span>
                                </div>
                                <div className="journey-v-actions">
                                  <button
                                    className="journey-preview-btn"
                                    onClick={() => openCommunicationModal(item.channel as 'email' | 'sms' | 'whatsapp')}
                                  >
                                    View Message
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Transition indicator */}
                            {isPriorToNext && isIgnored && (
                              <div className="journey-transition-tag">
                                ↓ {item.channel.toUpperCase()} deprioritized (No engagement)
                              </div>
                            )}
                            {isPriorToNext && !isIgnored && (
                              <div className="journey-transition-tag">
                                ↓ Next attempt
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })
                    ) : (
                      /* Cold Start / Initial Attempt */
                      <div className="journey-v-step">
                        <div className="journey-v-badge">Attempt 1</div>
                        <div className="journey-v-card">
                          <div className="journey-v-top">
                            <span className="journey-v-channel">
                              {channelIntel.recommended_channel === 'whatsapp' ? '💬 WhatsApp' :
                               channelIntel.recommended_channel === 'sms' ? '📱 SMS' : '✉️ Email'}
                            </span>
                            <span className="journey-v-status outcome-pending">Recommended</span>
                          </div>
                          <div className="journey-v-actions">
                            <button
                              className="journey-preview-btn"
                              onClick={() => openCommunicationModal(channelIntel.recommended_channel as 'email' | 'sms' | 'whatsapp')}
                            >
                              Preview Communication
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Attribution in Journey if recovered */}
                    {isRecovered && (
                      <div className="journey-success-step">
                        <span className="journey-success-check">✓</span>
                        <span><b>Recovery Successful:</b> Customer completed payment via recovery reminder.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 5. Concise AI Advisor */}
        {explanation?.ai && <AIAdvisorCard explanation={explanation} />}

        {/* 6. Payment Recovery & Communication Action Area */}
        <div className="payment-recovery-card">
          <div className="pr-header">
            <h3>⚡ PAYMENT RECOVERY ACTION</h3>
            <span className={`pr-status-badge ${isRecovered ? 'completed' : isAbandoned ? 'exhausted' : currentLink ? 'active' : 'pending'}`}>
              {isRecovered ? '✓ COMPLETED' : isAbandoned ? 'EXHAUSTED' : currentLink ? '🟢 ACTIVE' : 'PENDING'}
            </span>
          </div>

          {/* Recovery Attribution Success Banner */}
          {isRecovered && (
            <div className="recovery-attribution-banner">
              <div className="attr-badge">✓ RECOVERY SUCCESS</div>
              <p className="attr-text">
                Payment completed after an {channelIntel?.attributed_channel?.toUpperCase() || 'SMS'} recovery notification.
              </p>
              <div className="attr-meta">
                Attributed Channel: <b>{channelIntel?.attributed_channel === 'whatsapp' ? '💬 WhatsApp' : channelIntel?.attributed_channel === 'sms' ? '📱 SMS' : '✉️ Email'}</b> • Attribution Confidence: <span className="attr-conf-pill">High</span>
              </div>
            </div>
          )}

          <div className="pr-body-grid">
            <div className="pr-info-col">
              <div className="pr-meta-item">
                <span className="pr-label">Payment Link:</span>
                <b>{isRecovered ? 'Paid' : isAbandoned ? 'Expired' : currentLink ? 'Active' : 'Not Created'}</b>
              </div>
              <div className="pr-meta-item">
                <span className="pr-label">Recovery Workflow:</span>
                <b>{executionMode || (isAutomatic ? 'Automatic' : 'Manual')}</b>
              </div>
              <div className="pr-meta-item">
                <span className="pr-label">Expires:</span>
                <b>{formattedExpiry}</b>
              </div>
            </div>

            <div className="pr-actions-col">
              {currentLink && (
                <div className="pr-link-buttons">
                  <a
                    className="button primary"
                    href={currentLink.startsWith("http") ? currentLink : `/simulate-payment/${selected.id}`}
                    target={currentLink.startsWith("http") ? "_blank" : "_self"}
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      if (!currentLink.startsWith("http")) {
                        e.preventDefault();
                        window.location.href = `/simulate-payment/${selected.id}`;
                      }
                    }}
                  >
                    Open Payment Page ↗
                  </a>
                  <button
                    className="button secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      void navigator.clipboard.writeText(String(currentLink));
                      setNotice("Payment link copied to clipboard!");
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? "✓ Link Copied" : "Copy Link"}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Customer Communication Row */}
          <div className="pr-comm-row">
            <div className="pr-comm-status-wrap">
              <span className="pr-label">Customer Communication:</span>
              <span className={`pr-comm-pill ${notifDisplay.cls}`}>
                {notifDisplay.text}
              </span>
            </div>
            {notifDisplay.canView && (
              <button
                id="view-comm-panel-btn"
                className="button secondary comm-action-btn"
                onClick={() => openCommunicationModal()}
              >
                View Communication
              </button>
            )}
          </div>
        </div>

        {/* Failed Payment Alert if simulated payment failure occurred */}
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

        {/* 7. Action Panel & Approval */}
        <div className="action-panel">
          <div className="action-info">
            {isAbandoned ? (
              <span style={{color:'#f87171'}}>
                <b>Recovery Abandoned</b><br/>
                The recovery attempt limit was reached and the payment was not completed before the recovery window expired. No further recovery actions will be taken.
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
                {selected.retry_count >= selected.max_retries ? (
                  <><b>Attempt Limit Reached:</b> No additional recovery attempts will be created. The current payment link remains available until its scheduled expiry.</>
                ) : (
                  <><b>Next Scheduled Action:</b> {
                    selected.next_action_type === 'reminder' ? `Reminder scheduled for ${formatDate(selected.next_action_at)}` :
                    selected.next_action_type === 'expiry_check' ? `Waiting for payment link expiry at ${formatDate(selected.next_action_at)}` :
                    selected.next_action_type === 'recovery_attempt' ? `Next recovery attempt eligible after expiry` :
                    currentLink ? 'Waiting for customer payment' :
                    (explanation?.execution_error ? 'FAILED TO CREATE' : 'Pending')
                  }</>
                )}
              </span>
            )}
          </div>

          <div className="action-buttons">
            {!explanation?.ml && (
              <button id="view-analysis-btn" className="button secondary" onClick={() => void analyze()} disabled={actionLoading !== null}>
                {actionLoading === 'analyze' ? <span className="spinner"/> : null}
                Generate Analysis
              </button>
            )}

            {/* Approve Recovery — only for HUMAN_REVIEW */}
            {canApproveRecovery && !isRecovered && (
              <button id="approve-recovery-btn" className="button primary" onClick={() => void execute()} disabled={actionLoading !== null}>
                {actionLoading === 'execute' ? <span className="spinner"/> : null}
                Approve Recovery
              </button>
            )}
          </div>
        </div>

        {/* Audit Timeline */}
        <AuditTimeline audit={audit} />
      </div>

      {/* 8. Interactive Multi-Channel Communication Viewer Modal */}
      {showCommModal && (
        <div className="modal-overlay" onClick={() => setShowCommModal(false)}>
          <div className="comm-modal-container" onClick={(e) => e.stopPropagation()}>
            <div className="comm-modal-header">
              <div className="comm-modal-title">
                <h3>Customer Communication Preview</h3>
                <span className="comm-modal-sub">Realistic customer preview for {selected.case_number}</span>
              </div>
              <button className="comm-modal-close" onClick={() => setShowCommModal(false)}>✕</button>
            </div>

            {/* Channel Tabs */}
            <div className="comm-modal-tabs">
              <button
                className={`comm-modal-tab ${activeCommTab === 'email' ? 'active' : ''}`}
                onClick={() => setActiveCommTab('email')}
              >
                ✉️ Email Preview
              </button>
              <button
                className={`comm-modal-tab ${activeCommTab === 'sms' ? 'active' : ''}`}
                onClick={() => setActiveCommTab('sms')}
              >
                📱 SMS Preview
              </button>
              <button
                className={`comm-modal-tab ${activeCommTab === 'whatsapp' ? 'active' : ''}`}
                onClick={() => setActiveCommTab('whatsapp')}
              >
                💬 WhatsApp Preview
              </button>
            </div>

            {/* Tab Contents */}
            <div className="comm-modal-content">
              {/* TAB 1: EMAIL */}
              {activeCommTab === 'email' && (
                <div className="email-preview-wrapper">
                  <div className="email-preview-header-bar">
                    <div className="email-brand">
                      <span className="brand-dot">●</span> <strong>RecoverAI</strong>
                    </div>
                    <span className="email-badge">TRANSACTIONAL RECOVERY NOTICE</span>
                  </div>
                  <div className="email-preview-body">
                    <h3 style={{marginTop: 0, color: '#1e293b'}}>Payment Attempt Unsuccessful</h3>
                    <p style={{color: '#475569'}}>Hi Customer,</p>
                    <p style={{color: '#475569'}}>
                      We were unable to process your recent payment of <strong>{formatINR(selected.amount)}</strong> for Order #{selected.case_number}.
                    </p>
                    <div className="email-meta-box">
                      <div><span>Reason:</span> <b>{title(selected.failure_reason || 'Insufficient Funds')}</b></div>
                      <div><span>Payment Deadline:</span> <b>{formattedExpiry}</b></div>
                    </div>
                    <p style={{color: '#475569'}}>You can complete your payment securely using the button below:</p>
                    <div style={{textAlign: 'center', margin: '24px 0'}}>
                      <button
                        className="button email-complete-btn"
                        onClick={handlePaymentClick}
                      >
                        Complete Payment →
                      </button>
                    </div>
                    <div className="email-footer-note">
                      Secure 256-bit encrypted checkout powered by Razorpay.<br/>
                      Payment link expires on {formattedExpiry}.
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: SMS */}
              {activeCommTab === 'sms' && (
                <div className="sms-tab-container">
                  <div className="sms-phone-frame">
                    <div className="phone-top-bar">
                      <span className="phone-time">9:41</span>
                      <div className="phone-notch" />
                      <span className="phone-icons">5G 📶 🔋</span>
                    </div>
                    <div className="sms-chat-header">
                      <span className="sms-back">‹ Back</span>
                      <div className="sms-contact-name">
                        <strong>RecoverAI</strong>
                        <span className="sms-sub">Transactional Alert</span>
                      </div>
                      <span className="sms-info">ℹ️</span>
                    </div>
                    <div className="sms-chat-body">
                      <div className="sms-timestamp">Today 9:41 AM</div>
                      <div className="sms-bubble">
                        <div className="sms-text">
                          <strong>RecoverAI Alert:</strong> Your payment of {formatINR(selected.amount)} for Order #{selected.case_number} could not be completed.
                        </div>
                        <div className="sms-reason">Reason: {title(selected.failure_reason || 'Insufficient Funds')}.</div>
                        <div className="sms-cta">Complete your payment securely here:</div>
                        <div className="sms-link-text">{currentLink ? currentLink.replace(/^https?:\/\//, '') : 'rzp.io/i/rec_demo'}</div>
                        <button
                          className="button sms-action-btn"
                          onClick={handlePaymentClick}
                        >
                          Complete Payment
                        </button>
                        <div className="sms-expiry">Link expires: {formattedExpiry}.</div>
                      </div>
                    </div>
                    <div className="phone-bottom-indicator" />
                  </div>
                  <div className="simulation-disclaimer">
                    📱 SMS communication simulated for demonstration purposes.
                  </div>
                </div>
              )}

              {/* TAB 3: WHATSAPP */}
              {activeCommTab === 'whatsapp' && (
                <div className="wa-tab-container">
                  <div className="wa-chat-frame">
                    <div className="wa-header">
                      <div className="wa-header-avatar">R</div>
                      <div className="wa-header-info">
                        <div className="wa-header-name">
                          RecoverAI <span className="wa-verified-badge" title="Verified Business">✓</span>
                        </div>
                        <div className="wa-header-sub">Official Business Account</div>
                      </div>
                    </div>
                    <div className="wa-chat-body">
                      <div className="wa-date-chip">TODAY</div>
                      <div className="wa-bubble">
                        <div className="wa-greeting">Hello,</div>
                        <p className="wa-body-text">
                          We noticed that your recent payment of <strong>{formatINR(selected.amount)}</strong> for Order #{selected.case_number} was unsuccessful.
                        </p>
                        <div className="wa-field-row">
                          <span>Reason:</span> <b>{title(selected.failure_reason || 'Insufficient Funds')}</b>
                        </div>
                        <p className="wa-body-text">
                          You can securely complete your payment with 1-click using the button below.
                        </p>
                        <button
                          className="wa-btn"
                          onClick={handlePaymentClick}
                        >
                          ⚡ Complete Payment
                        </button>
                        <div className="wa-footer-msg">
                          Payment link expires on {formattedExpiry}.<br/>
                          Need assistance? Reply directly to this message.
                        </div>
                        <div className="wa-bubble-time">
                          09:41 AM <span className="wa-receipts">✓✓</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="simulation-disclaimer">
                    💬 WhatsApp message simulated for demonstration purposes.
                  </div>
                </div>
              )}
            </div>

            <div className="comm-modal-footer">
              <button className="button secondary" onClick={() => setShowCommModal(false)}>
                Close Preview
              </button>
              {currentLink && (
                <a
                  className="button primary"
                  href={currentLink.startsWith("http") ? currentLink : `/simulate-payment/${selected.id}`}
                  target={currentLink.startsWith("http") ? "_blank" : "_self"}
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    if (!currentLink.startsWith("http")) {
                      e.preventDefault();
                      window.location.href = `/simulate-payment/${selected.id}`;
                    }
                  }}
                >
                  Open Active Payment Link ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
