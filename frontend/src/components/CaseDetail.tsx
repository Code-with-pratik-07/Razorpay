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

function formatNextActionLabel(nextAction: string, channel: string | null): string {
  const ch = channel ? title(channel) : '';
  switch (nextAction) {
    case 'RETRY_SAME_CHANNEL':
      return channel === 'whatsapp' ? '💬 Send WhatsApp Reminder' :
             channel === 'sms' ? '📱 Send SMS Reminder' :
             `✉️ Send ${ch} Reminder`;
    case 'SWITCH_CHANNEL':
      return channel === 'sms' ? '📱 Switch to SMS' :
             channel === 'whatsapp' ? '💬 Switch to WhatsApp' :
             `✉️ Switch to ${ch}`;
    case 'DISPATCH_INITIAL':
      return `Dispatch ${ch} Communication`;
    case 'AWAIT_APPROVAL':
      return '⏳ Await Human Approval';
    case 'AWAIT_RESPONSE':
      return '⏳ Awaiting Customer Response';
    case 'GENERATE_NEW_LINK':
      return '🔄 Generate New Payment Link';
    case 'STOP_RECOVERY':
      return 'Close Recovery';
    default:
      return nextAction.replace(/_/g, ' ');
  }
}

function formatPreviousOutcome(outcome: string | null): string {
  if (!outcome) return 'None';
  switch (outcome) {
    case 'LINK_CLICKED':
    case 'CLICKED':
      return '🔗 Payment Link Clicked';
    case 'NO_ENGAGEMENT':
    case 'IGNORED':
      return 'Delivered • No Customer Engagement';
    case 'PAYMENT_COMPLETED':
      return '✓ Payment Completed';
    case 'FAILED_DELIVERY':
    case 'FAILED':
      return '✕ Delivery Failed';
    case 'PAYMENT_LINK_EXPIRED':
      return '⏱ Payment Link Expired';
    case 'AWAITING_RESPONSE':
      return '✓ Simulated Sent • Awaiting Response';
    default:
      return outcome.replace(/_/g, ' ');
  }
}

function formatTiming(waitPeriod: string): string {
  if (!waitPeriod || waitPeriod === 'None' || waitPeriod === 'none') return '⏱ None';
  if (waitPeriod.toLowerCase().includes('24')) return '⏱ After 24 hours';
  if (waitPeriod.toLowerCase().includes('immediate')) return '⏱ Immediate';
  return `⏱ ${waitPeriod}`;
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
  const existingPaymentLink = audit.find((event) => event.event_type === "payment_link_created")?.event_data.url as string | undefined;
  const currentLink = execution?.payment_link_url || existingPaymentLink;

  const recoveryStartedEvent = audit.find((e) => e.event_type === "recovery_started");
  const isAutomatic = recoveryStartedEvent?.event_data.automatic === true;
  const executionMode = isAutomatic ? "Automatic Recovery" : recoveryStartedEvent ? "Manual Recovery" : "Automatic Recovery";

  // Modal and preview states
  const [showCommModal, setShowCommModal] = React.useState(false);
  const [activeCommTab, setActiveCommTab] = React.useState<'email' | 'sms' | 'whatsapp'>('email');
  const [copied, setCopied] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);

  // Status flags
  const isAbandoned = selected.status === 'abandoned';
  const isHumanReview = selected.status === 'human_review';
  const isRecovering = selected.status === 'recovering';
  const isRecovered = selected.status === 'recovered';

  // Backend workflow state derived from explanation
  const humanReviewStatus = explanation?.human_review_status ?? (explanation?.manual_execution ? 'APPROVED' : isHumanReview ? 'REQUIRED' : 'NOT_REQUIRED');
  const commStatus = explanation?.communication_status ?? (isRecovered ? 'COMPLETED' : isAbandoned ? 'EXHAUSTED' : humanReviewStatus === 'REQUIRED' ? 'PAUSED' : 'READY');
  const recommendedChannel = explanation?.recommended_channel ?? explanation?.channel_intelligence?.recommended_channel ?? 'email';
  const dispatchedChannel = explanation?.dispatched_channel ?? null;
  const recChannelName = recommendedChannel === 'whatsapp' ? 'WhatsApp' : recommendedChannel === 'sms' ? 'SMS' : 'Email';

  // Can approve recovery for HUMAN_REVIEW if under retry limit
  const canApproveRecovery = (isHumanReview || humanReviewStatus === 'REQUIRED') && selected.retry_count < selected.max_retries;

  // Selected communication ID for multi-attempt modal
  const [selectedCommId, setSelectedCommId] = React.useState<string>('');
  const [isRunningNextStep, setIsRunningNextStep] = React.useState<boolean>(false);

  // Dynamic available communications strictly from backend records & prepared channel
  const journey = explanation?.channel_intelligence?.communication_journey || [];
  const actualComms = journey
    .filter(r => r.channel)
    .map(r => ({
      id: r.id || `${r.channel.toLowerCase()}-${r.attempt_number}`,
      channel: r.channel.toLowerCase() as 'email' | 'sms' | 'whatsapp',
      attempt: r.attempt_number,
      status: r.outcome,
      simulated: r.simulated,
      recipient: r.recipient || (r.channel.toLowerCase() === 'email' ? selected.customer_email : 'Verified Mobile'),
      message: r.message_snippet,
      recovery_attributed: r.recovery_attributed || false,
      isPrepared: false,
    }));

  if (commStatus === 'READY' && humanReviewStatus !== 'REQUIRED') {
    const hasExisting = actualComms.some(c => c.channel === recommendedChannel.toLowerCase());
    if (!hasExisting) {
      actualComms.push({
        id: `prepared-${recommendedChannel.toLowerCase()}`,
        channel: recommendedChannel.toLowerCase() as 'email' | 'sms' | 'whatsapp',
        attempt: actualComms.length + 1,
        status: 'PREPARED',
        simulated: false,
        recipient: recommendedChannel.toLowerCase() === 'email' ? selected.customer_email : 'Verified Mobile',
        message: `${recChannelName} notification prepared for review. Not yet dispatched.`,
        recovery_attributed: false,
        isPrepared: true,
      });
    }
  }

  const availableCommunications = actualComms;

  const openCommunicationModal = (channelOverride?: 'email' | 'sms' | 'whatsapp', commIdOverride?: string) => {
    if (commIdOverride) {
      setSelectedCommId(commIdOverride);
      const target = availableCommunications.find(c => c.id === commIdOverride);
      if (target) {
        setActiveCommTab(target.channel);
      }
    } else if (channelOverride) {
      const target = availableCommunications.find(c => c.channel === channelOverride);
      if (target) {
        setSelectedCommId(target.id);
        setActiveCommTab(target.channel);
      } else {
        setActiveCommTab(channelOverride);
      }
    } else if (availableCommunications.length > 0) {
      setSelectedCommId(availableCommunications[0].id);
      setActiveCommTab(availableCommunications[0].channel);
    }
    setShowCommModal(true);
  };

  const handleRunNextStep = async () => {
    setIsRunningNextStep(true);
    try {
      const res = await fetch(`http://127.0.0.1:8000/api/cases/${selected.id}/next-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.detail || 'Failed to execute next recovery step');
        return;
      }
      await analyze();
      setNotice('Next recovery step simulated successfully.');
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunningNextStep(false);
    }
  };

  // ML routing label helpers
  const mlBadge = mlDecision === 'HIGH'
    ? { label: 'HIGH CONFIDENCE', cls: 'ml-high' }
    : mlDecision === 'UNCERTAIN'
    ? { label: 'UNCERTAIN — Review', cls: 'ml-uncertain' }
    : mlDecision === 'LOW'
    ? { label: 'LOW — Attempt Limit', cls: 'ml-low' }
    : mlDecision === 'COLD_START'
    ? { label: 'COLD START PROFILE', cls: 'ml-cold' }
    : null;

  // Formatted date helper
  const formattedExpiry = selected.payment_link_expires_at
    ? formatDate(selected.payment_link_expires_at)
    : "10 Sep 2026, 12:39 AM";

  // Normalized Communication Status Display
  const getCommunicationStatusInfo = () => {
    if (humanReviewStatus === 'REQUIRED') {
      return {
        icon: "⏳",
        badge: "Communication Paused",
        text: "Waiting for human approval",
        cls: "status-waiting",
        canView: false,
        isReady: false,
      };
    }
    if (commStatus === 'READY') {
      return {
        icon: recommendedChannel === 'whatsapp' ? "💬" : recommendedChannel === 'sms' ? "📱" : "✉️",
        badge: `${recChannelName} Ready`,
        text: `${recChannelName} selected for recovery communication`,
        cls: "status-ready",
        canView: true,
        isReady: true,
      };
    }
    if (commStatus === 'GENERATED' || selected.notification_status === 'MOCKED' || selected.notification_status === 'GENERATED') {
      return {
        icon: "✓",
        badge: `${recChannelName} Generated`,
        text: "Ready for customer delivery",
        cls: "status-generated",
        canView: true,
        isReady: false,
      };
    }
    if (commStatus === 'SIMULATED' || selected.notification_status === 'WHATSAPP_SIMULATED' || selected.notification_status === 'SMS_SIMULATED') {
      const ch = selected.notification_status === 'WHATSAPP_SIMULATED' ? 'WhatsApp' : 'SMS';
      return {
        icon: "✓",
        badge: `${ch} Simulated`,
        text: `${ch} communication simulated for demo`,
        cls: "status-simulated",
        canView: true,
        isReady: false,
      };
    }
    if (commStatus === 'SENT' || selected.notification_status === 'SENT') {
      return {
        icon: "✓",
        badge: "Email Sent",
        text: "Email delivered to customer",
        cls: "status-sent",
        canView: true,
        isReady: false,
      };
    }
    if (commStatus === 'COMPLETED' || selected.status === 'recovered') {
      return {
        icon: "✓",
        badge: "Communication Completed",
        text: "Payment recovered successfully",
        cls: "status-completed",
        canView: true,
        isReady: false,
      };
    }
    if (commStatus === 'EXHAUSTED' || selected.status === 'abandoned') {
      return {
        icon: "■",
        badge: "Communication Stopped",
        text: "Maximum attempt limit reached",
        cls: "status-exhausted",
        canView: true,
        isReady: false,
      };
    }
    return {
      icon: "•",
      badge: "Pending",
      text: "Awaiting recovery action",
      cls: "status-pending",
      canView: false,
      isReady: false,
    };
  };

  const commInfo = getCommunicationStatusInfo();

  // Handler for Complete Payment in all previews
  const handlePaymentClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (currentLink && (currentLink.startsWith("http://") || currentLink.startsWith("https://"))) {
      window.open(currentLink, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = `/simulate-payment/${selected.id}`;
    }
  };

  // Handler for demo simulation sending
  const handleSimulateDispatch = async (channelToDispatch: string) => {
    setIsSending(true);
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${apiBase}/api/cases/${selected.id}/dispatch-communication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: channelToDispatch })
      });
      if (res.ok) {
        setNotice(`${title(channelToDispatch)} communication simulated successfully.`);
        await analyze();
      } else {
        const err = await res.json().catch(() => ({}));
        setNotice(`Dispatch notice: ${err.detail || 'Simulated for demo'}`);
        await analyze();
      }
    } catch (err) {
      setNotice(`Dispatch error: ${(err as Error).message}`);
    } finally {
      setIsSending(false);
    }
  };

  const channelIntel = explanation?.channel_intelligence;

  const canRunNextStep = Boolean(
    !isRecovered &&
    !isAbandoned &&
    !isHumanReview &&
    channelIntel?.followup_decision &&
    channelIntel.followup_decision.next_action !== 'STOP_RECOVERY' &&
    channelIntel.followup_decision.next_action !== 'AWAIT_RESPONSE' &&
    channelIntel.followup_decision.next_action !== 'AWAIT_APPROVAL' &&
    selected.retry_count < selected.max_retries
  );

  return (
    <>
      <header className="details-header">
        <div className="details-title">
          <h2>
            {selected.case_number} 
            <span style={{marginLeft: 12, fontSize: '1.25rem', color: '#10b981', fontWeight: 600}}>
              {formatINR(selected.amount)}
            </span>
            <Badge value={selected.status} />
          </h2>
          <div className="details-meta">
            {selected.customer_email ?? 'Customer'} • {title(selected.payment_method)}
          </div>
          <div className="details-meta notification-meta">
            <span className={`notif-indicator ${commInfo.cls}`}>
              {commInfo.icon} {commInfo.badge}
            </span>
            {availableCommunications.length > 0 && (
              <button
                id="view-comm-header-btn"
                className="button secondary view-comm-header-btn"
                onClick={() => openCommunicationModal()}
              >
                {availableCommunications.length === 1
                  ? `View ${title(availableCommunications[0].channel)} Message`
                  : 'View Communications'}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="details-grid">
        {/* 2. RECOVERY JOURNEY (Six-stage pipeline) */}
        <DecisionPipeline selected={selected} explanation={explanation} />

        {explanation && (
          <div className="intelligence-panel" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'}}>
            {/* 3. KEY RECOVERY METRICS */}
            <div className="intelligence-card">
              <h4>
                <i/> 3. Key Recovery Metrics
              </h4>
              <div className="stat-row">
                <span>
                  ML Recovery Probability
                  <span 
                    className="info-tooltip-wrap" 
                    title="Likelihood that the payment can eventually be recovered." 
                    style={{marginLeft: 6, cursor: 'help', color: '#64748b'}}
                  >ℹ️</span>
                </span>
                <b>{mlDecision === 'COLD_START' ? "N/A (Cold Start)" : explanation.ml.recovery_probability != null ? (explanation.ml.recovery_probability * 100).toFixed(0) + "%" : "—"}</b>
              </div>
              {mlBadge && (
                <div className="stat-row">
                  <span>Recovery Tier</span>
                  <b className={mlBadge.cls} style={{
                    fontSize: '0.7rem', padding: '2px 7px', borderRadius: 4,
                    background: mlDecision === 'HIGH' ? '#064e3b' : mlDecision === 'UNCERTAIN' ? '#78350f' : mlDecision === 'COLD_START' ? '#1e3a8a' : '#3b1515',
                    color: mlDecision === 'HIGH' ? '#34d399' : mlDecision === 'UNCERTAIN' ? '#fbbf24' : mlDecision === 'COLD_START' ? '#93c5fd' : '#f87171',
                  }}>{mlBadge.label}</b>
                </div>
              )}
              <div className="stat-row">
                <span>Attempts Used</span>
                <b>{selected.retry_count} of {selected.max_retries}</b>
              </div>
              <div className="stat-row">
                <span>Customer Lifetime Value</span>
                <b>{formatINR(explanation.customer_history.lifetime_value)}</b>
              </div>
            </div>

            {/* 4. COMMUNICATION INTELLIGENCE */}
            {channelIntel && (
              <div className="intelligence-card communication-intelligence-card" style={{gridColumn: '1 / -1'}}>
                <div className="comm-card-header">
                  <div className="comm-profile-compact">
                    <span className={`comm-profile-pill maturity-${channelIntel.communication_maturity.toLowerCase()}`}>
                      {channelIntel.communication_maturity === 'COLD_START' ? '🔵 COLD START' :
                       channelIntel.communication_maturity === 'LEARNING' ? '🟡 LEARNING' : '🟢 ESTABLISHED'}
                    </span>
                    <span className="comm-profile-desc">{channelIntel.maturity_description}</span>
                  </div>

                  <span className={`channel-status-pill status-${commStatus.toLowerCase()}`}>
                    {commInfo.badge}
                  </span>
                </div>

                <div className="comm-primary-focus">
                  <div className="comm-focus-channel">
                    <span className="comm-focus-icon">
                      {channelIntel.recommended_channel === 'whatsapp' ? '💬' :
                       channelIntel.recommended_channel === 'sms' ? '📱' : '✉️'}
                    </span>
                    <div>
                      <div className="comm-focus-title">
                        RECOMMENDED CHANNEL: <b>{title(channelIntel.recommended_channel)}</b>
                      </div>
                      <div className="comm-focus-metrics">
                        <span className="comm-suitability-badge">
                          <b>{(channelIntel.suitability_score * 100).toFixed(0)}%</b> Suitability
                          <span 
                            className="info-tooltip-wrap" 
                            title="Expected effectiveness of this communication channel." 
                            style={{marginLeft: 6, cursor: 'help', color: '#93c5fd'}}
                          >ℹ️</span>
                        </span>
                        <span className={`comm-conf-badge conf-${channelIntel.confidence}`}>
                          {title(channelIntel.confidence)} Confidence
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="comm-why-box">
                  <span className="comm-why-title">Why this channel?</span>
                  <p className="comm-why-body">{channelIntel.reason}</p>
                </div>

                <div className="comm-alts-row">
                  <span className="comm-alts-label">Alternatives:</span>
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

                <div className="comm-journey-block" style={{marginTop: 18}}>
                  <span className="comm-journey-title">COMMUNICATION JOURNEY</span>
                  <div className="journey-v-timeline">
                    {journey.map((item, idx) => {
                      const isLinkClicked = item.outcome === 'LINK_CLICKED';
                      const isIgnored = item.outcome === 'NO_ENGAGEMENT' || item.outcome === 'IGNORED';
                      const isPaid = item.outcome === 'PAYMENT_COMPLETED';
                      const isAwaiting = item.outcome === 'AWAITING_RESPONSE';
                      const chIcon = item.channel === 'whatsapp' ? '💬' : item.channel === 'sms' ? '📱' : '✉️';
                      const itemId = item.id || `${item.channel}-${item.attempt_number}`;
                      const isReminder = item.attempt_number > 1 && item.channel === journey[0]?.channel;

                      return (
                        <React.Fragment key={idx}>
                          <div 
                            className="journey-v-step clickable-journey-step"
                            onClick={() => openCommunicationModal(item.channel as any, itemId)}
                            title={`Click to view ${title(item.channel)} Attempt ${item.attempt_number} preview`}
                            style={{cursor: 'pointer'}}
                          >
                            <div className="journey-v-badge">Attempt {item.attempt_number}</div>
                            <div className="journey-v-card">
                              <div className="journey-v-top">
                                <span className="journey-v-channel">
                                  {chIcon} {title(item.channel)}{isReminder ? ' Reminder' : ''}
                                </span>
                                <span className={`journey-v-status outcome-${item.outcome.toLowerCase()}`}>
                                  {isPaid ? '✓ Payment Completed' : 
                                   isLinkClicked ? '✓ Delivered • 🔗 Payment Link Clicked' : 
                                   isAwaiting ? '✓ Simulated Sent • ⏳ Awaiting Customer Response' :
                                   isIgnored ? '✓ Delivered • No customer engagement' : 
                                   '✓ Delivered'}
                                </span>
                              </div>
                            </div>
                          </div>
                          {isLinkClicked && (
                            <div className="journey-transition-tag" style={{background: 'rgba(30, 58, 138, 0.3)', color: '#93c5fd', borderColor: '#1d4ed8'}}>
                              ↓ Wait 24 hours
                            </div>
                          )}
                          {isIgnored && (
                            <>
                              <div className="journey-transition-tag" style={{background: 'rgba(51, 65, 85, 0.4)', color: '#94a3b8', borderColor: '#475569'}}>
                                ↓ Wait 24 hours
                              </div>
                              <div className="journey-transition-tag">
                                ↓ {title(item.channel)} deprioritized
                              </div>
                            </>
                          )}
                        </React.Fragment>
                      );
                    })}

                    {!isRecovered && !isAbandoned && channelIntel.followup_decision?.next_action !== 'AWAIT_RESPONSE' && (
                      <div 
                        className="journey-v-step next-action-step clickable-journey-step"
                        onClick={() => openCommunicationModal(recommendedChannel as any)}
                        title="Click to view communication preview"
                        style={{cursor: 'pointer'}}
                      >
                        <div className="journey-v-badge" style={{background: '#2563eb'}}>Recommended Next Step</div>
                        <div className="journey-v-card" style={{border: '1px dashed #60a5fa'}}>
                          <div className="journey-v-top">
                            <span className="journey-v-channel">
                              {channelIntel.followup_decision?.selected_channel 
                                ? `${channelIntel.followup_decision.selected_channel === 'whatsapp' ? '💬' : channelIntel.followup_decision.selected_channel === 'sms' ? '📱' : '✉️'} ${title(channelIntel.followup_decision.selected_channel)} ${channelIntel.followup_decision.next_action === 'RETRY_SAME_CHANNEL' ? 'Reminder' : ''}`
                                : (recommendedChannel === 'whatsapp' ? '💬 WhatsApp' : recommendedChannel === 'sms' ? '📱 SMS' : '✉️ Email')}
                            </span>
                            <span className="journey-v-status" style={{background: '#1e3a8a', color: '#93c5fd'}}>
                              {commStatus === 'READY' ? 'Ready for review' : commStatus === 'GENERATED' ? '✓ Generated' : 'Pending'}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {isAbandoned && (
                      <div className="journey-transition-tag" style={{background: 'rgba(127, 29, 29, 0.3)', color: '#f87171', borderColor: '#991b1b'}}>
                        Attempt Limit Reached • Recovery Closed
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 5. FOLLOW-UP INTELLIGENCE */}
            {channelIntel?.followup_decision && (
              <div className="intelligence-card followup-intelligence-card" style={{gridColumn: '1 / -1'}}>
                <div className="fd-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6}}>
                  <div style={{fontWeight: 700, fontSize: '0.82rem', color: '#60a5fa', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6}}>
                    <span>🔄</span> 5. Follow-up Intelligence
                  </div>
                  <div style={{fontSize: '0.8rem', color: '#cbd5e1', background: '#1e293b', padding: '3px 10px', borderRadius: 4, border: '1px solid #475569'}}>
                    {formatTiming(channelIntel.followup_decision.recommended_wait_period)}
                  </div>
                </div>

                <div className="fd-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12}}>
                  <div className="fd-item" style={{background: '#0f172a', padding: '10px 12px', borderRadius: 6, border: '1px solid #1e293b'}}>
                    <div style={{fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3, letterSpacing: '0.04em'}}>Previous Outcome</div>
                    <div style={{fontSize: '0.88rem', fontWeight: 600, color: '#e2e8f0'}}>
                      {formatPreviousOutcome(channelIntel.followup_decision.previous_outcome)}
                    </div>
                  </div>
                  <div className="fd-item" style={{background: '#0f172a', padding: '10px 12px', borderRadius: 6, border: '1px solid #1e293b'}}>
                    <div style={{fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3, letterSpacing: '0.04em'}}>Recommended Action</div>
                    <div style={{fontSize: '0.88rem', fontWeight: 600, color: '#93c5fd'}}>
                      {formatNextActionLabel(channelIntel.followup_decision.next_action, channelIntel.followup_decision.selected_channel)}
                    </div>
                  </div>
                  <div className="fd-item" style={{background: '#0f172a', padding: '10px 12px', borderRadius: 6, border: '1px solid #1e293b'}}>
                    <div style={{fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3, letterSpacing: '0.04em'}}>Timing</div>
                    <div style={{fontSize: '0.88rem', fontWeight: 600, color: '#fde047'}}>
                      {formatTiming(channelIntel.followup_decision.recommended_wait_period)}
                    </div>
                  </div>
                </div>

                <div className="fd-reason" style={{marginBottom: 12}}>
                  <div style={{fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.04em'}}>
                    Reason
                  </div>
                  <p style={{margin: 0, fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.5}}>
                    {channelIntel.followup_decision.reason}
                  </p>
                </div>

                {canRunNextStep && (
                  <div style={{marginTop: 12}}>
                    <button
                      className="button primary simulate-step-btn"
                      onClick={handleRunNextStep}
                      disabled={isRunningNextStep}
                      style={{background: '#2563eb', padding: '8px 18px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: 6}}
                    >
                      {isRunningNextStep ? 'Simulating...' : '⚡ Simulate Next Recovery Step'}
                    </button>
                    <span style={{display: 'block', marginTop: 6, fontSize: '0.78rem', color: '#94a3b8'}}>
                      Simulates the recommended follow-up without waiting for the actual follow-up period.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 5. AI ADVISOR */}
        {explanation?.ai && <AIAdvisorCard explanation={explanation} />}

        {/* 6. PAYMENT RECOVERY ACTION */}
        {isRecovered ? (
          <div className="payment-recovery-card terminal-banner terminal-recovered" style={{
            background: '#064e3b', border: '1px solid #059669', borderRadius: 8, padding: '20px', color: '#ecfdf5'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <span style={{fontSize: '1.4rem'}}>✓</span>
              <h3 style={{margin: 0, color: '#34d399', fontSize: '1.1rem', letterSpacing: '0.05em'}}>PAYMENT SUCCESSFULLY RECOVERED</h3>
            </div>
            <div style={{fontSize: '1.25rem', fontWeight: 700, margin: '10px 0 6px 0', color: '#ffffff'}}>
              {formatINR(selected.amount)} recovered successfully.
            </div>
            <div style={{fontSize: '0.9rem', color: '#a7f3d0'}}>
              Recovery attributed to: <b>{channelIntel?.attributed_channel?.toUpperCase() || 'SMS'}</b>
            </div>
          </div>
        ) : isAbandoned ? (
          <div className="payment-recovery-card terminal-banner terminal-abandoned" style={{
            background: '#271212', border: '1px solid #7f1d1d', borderRadius: 8, padding: '20px', color: '#fee2e2'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
              <span style={{fontSize: '1.4rem'}}>■</span>
              <h3 style={{margin: 0, color: '#f87171', fontSize: '1.1rem', letterSpacing: '0.05em'}}>RECOVERY CLOSED</h3>
            </div>
            <div style={{fontSize: '0.95rem', margin: '10px 0 4px 0', color: '#fca5a5'}}>
              Maximum permitted recovery attempts were reached without payment completion.
            </div>
            <div style={{fontSize: '0.85rem', color: '#cbd5e1'}}>
              No further automated recovery actions will be performed.
            </div>
          </div>
        ) : canApproveRecovery ? (
          <div className="action-panel" style={{background: '#1e293b', border: '1px solid #f59e0b', borderRadius: 8, padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12}}>
            <div className="action-info">
              <span style={{color: '#fbbf24', fontWeight: 600, fontSize: '0.95rem'}}>
                ⏳ Human Review Required — Automatic recovery was paused by safety policy.
              </span>
            </div>
            <div className="action-buttons">
              <button id="approve-recovery-btn" className="button primary" onClick={() => void execute()} disabled={actionLoading !== null} style={{background: '#f59e0b', color: '#0f172a', fontWeight: 700}}>
                {actionLoading === 'execute' ? <span className="spinner"/> : null}
                Approve Recovery
              </button>
            </div>
          </div>
        ) : (
          <div className="payment-recovery-card">
            <div className="pr-header">
              <h3>⚡ 7. PAYMENT RECOVERY ACTION</h3>
              <span className={`pr-status-badge ${currentLink ? 'active' : 'pending'}`}>
                {currentLink ? '🟢 Active Payment Link' : 'PENDING'}
              </span>
            </div>

            <div className="pr-body-grid">
              <div className="pr-info-col">
                <div className="pr-meta-item">
                  <span className="pr-label">Recovery Method:</span>
                  <b>{executionMode}</b>
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

            <div className="pr-comm-row">
              <div className="pr-comm-status-wrap">
                <span className="pr-label">CUSTOMER COMMUNICATION</span>
                <div style={{display: 'flex', alignItems: 'center', gap: 10, marginTop: 4}}>
                  <span className={`pr-comm-pill ${commInfo.cls}`}>
                    {commInfo.icon} {commInfo.badge}
                  </span>
                  <span style={{fontSize: '0.85rem', color: '#94a3b8'}}>
                    {commInfo.text}
                  </span>
                </div>
              </div>
              {availableCommunications.length > 0 && (
                <button
                  id="view-comm-panel-btn"
                  className="button secondary comm-action-btn"
                  onClick={() => openCommunicationModal()}
                >
                  {availableCommunications.length === 1
                    ? `View ${title(availableCommunications[0].channel)} Message`
                    : 'View Communications'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 8. CUSTOMER OUTCOME */}
        <div className="intelligence-card customer-outcome-card">
          <h4>8. Customer Outcome</h4>
          <div className="co-body" style={{marginTop: 8}}>
            {isRecovered ? (
              <div>
                <span className="badge" style={{background: '#064e3b', color: '#34d399', fontWeight: 600, padding: '4px 10px', borderRadius: 4}}>
                  ✓ PAYMENT COMPLETED
                </span>
                <p style={{margin: '8px 0 0 0', color: '#cbd5e1', fontSize: '0.9rem'}}>
                  Payment successfully captured via {channelIntel?.attributed_channel?.toUpperCase() || 'SMS'} recovery notice.
                </p>
              </div>
            ) : isAbandoned ? (
              <div>
                <span className="badge" style={{background: '#3b1515', color: '#f87171', fontWeight: 600, padding: '4px 10px', borderRadius: 4}}>
                  RECOVERY CLOSED
                </span>
                <p style={{margin: '8px 0 0 0', color: '#94a3b8', fontSize: '0.9rem'}}>
                  Maximum permitted recovery attempts were reached without payment completion.
                </p>
              </div>
            ) : selected.last_payment_status === 'FAILED' ? (
              <div>
                <span className="badge" style={{background: '#450a0a', color: '#fca5a5', fontWeight: 600, padding: '4px 10px', borderRadius: 4}}>
                  ✕ CUSTOMER PAYMENT FAILED
                </span>
                <p style={{margin: '8px 0 4px 0', color: '#fca5a5', fontSize: '0.9rem'}}>
                  The customer attempted to pay using the link, but the transaction was unsuccessful: <b>{selected.last_payment_failure_reason || 'Failure'}</b>.
                </p>
                {selected.last_payment_attempt_at && (
                  <span style={{fontSize: '0.8rem', color: '#94a3b8'}}>Last Attempt: {formatDate(selected.last_payment_attempt_at)}</span>
                )}
              </div>
            ) : isRecovering ? (
              <div>
                <span className="badge" style={{background: '#1e3a8a', color: '#93c5fd', fontWeight: 600, padding: '4px 10px', borderRadius: 4}}>
                  ⏳ CUSTOMER PAYMENT PENDING
                </span>
                <p style={{margin: '8px 0 0 0', color: '#cbd5e1', fontSize: '0.9rem'}}>
                  Payment link is active. Waiting for customer checkout.
                </p>
              </div>
            ) : (
              <div>
                <span className="badge" style={{background: '#78350f', color: '#fbbf24', fontWeight: 600, padding: '4px 10px', borderRadius: 4}}>
                  ⏳ AWAITING REVIEW
                </span>
                <p style={{margin: '8px 0 0 0', color: '#cbd5e1', fontSize: '0.9rem'}}>
                  Recovery execution paused pending manual reviewer approval.
                </p>
              </div>
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

            {/* Dynamic Channel Tabs */}
            <div className="comm-modal-tabs">
              {availableCommunications.map((comm) => {
                const isActive = selectedCommId ? comm.id === selectedCommId : comm.id === availableCommunications[0]?.id;
                const chIcon = comm.channel === 'whatsapp' ? '💬' : comm.channel === 'sms' ? '📱' : '✉️';
                return (
                  <button
                    key={comm.id}
                    className={`comm-modal-tab ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedCommId(comm.id);
                      setActiveCommTab(comm.channel);
                    }}
                  >
                    {chIcon} {title(comm.channel)}
                    {availableCommunications.length > 1 && ` – Attempt ${comm.attempt}`}
                  </button>
                );
              })}
            </div>

            {/* Tab Contents */}
            <div className="comm-modal-content">
              {/* Payment Completed Attribution banner */}
              {isRecovered && (
                <div style={{
                  background: 'rgba(6, 78, 59, 0.4)', border: '1px solid #059669', color: '#34d399',
                  padding: '10px 16px', borderRadius: 6, marginBottom: 16, fontSize: '0.88rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <span>✓</span> Payment completed after this communication.
                </div>
              )}

              {/* Prepared but not dispatched notice */}
              {commStatus === 'READY' && (!dispatchedChannel || dispatchedChannel !== activeCommTab) && (
                <div className="comm-ready-banner" style={{
                  background: '#0f172a', border: '1px solid #3b82f6', borderRadius: 8, padding: '14px 18px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12
                }}>
                  <div>
                    <div style={{fontWeight: 700, fontSize: '0.85rem', color: '#60a5fa', letterSpacing: '0.05em'}}>
                      {activeCommTab.toUpperCase()} PREVIEW
                    </div>
                    <div style={{fontSize: '0.85rem', color: '#cbd5e1', marginTop: 2}}>
                      Communication prepared for review. Not yet dispatched.
                    </div>
                  </div>
                  <button
                    className="button primary"
                    style={{background: '#2563eb', padding: '6px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap'}}
                    onClick={() => void handleSimulateDispatch(activeCommTab)}
                    disabled={isSending}
                  >
                    {isSending ? "Dispatching..." : `⚡ Simulate Sending for Demo`}
                  </button>
                </div>
              )}

              {/* TAB 1: EMAIL */}
              {activeCommTab === 'email' && (
                <div className="email-preview-wrapper">
                  <div className="email-preview-header-bar">
                    <div className="email-brand">
                      <span className="brand-dot">●</span> <strong>RecoverAI</strong>
                    </div>
                    <span className="email-badge">FAILED PAYMENT RECOVERY</span>
                  </div>
                  <div className="email-preview-body">
                    <h3 style={{marginTop: 0, color: '#1e293b'}}>Failed Payment Recovery</h3>
                    <p style={{color: '#475569'}}>Hi Customer,</p>
                    <p style={{color: '#475569'}}>
                      We noticed that your recent payment could not be completed.
                    </p>
                    <div className="email-meta-box">
                      <div><span>Amount:</span> <b>{formatINR(selected.amount)}</b></div>
                      <div><span>Order:</span> <b>#{selected.case_number}</b></div>
                      <div><span>Reason:</span> <b>{title(selected.failure_reason || 'Insufficient Funds')}</b></div>
                      <div><span>Payment Deadline:</span> <b>{formattedExpiry}</b></div>
                    </div>
                    <p style={{color: '#475569', fontWeight: 500}}>
                      Complete your payment securely before the recovery link expires.
                    </p>
                    <div style={{textAlign: 'center', margin: '24px 0'}}>
                      <button
                        className="button email-complete-btn"
                        onClick={handlePaymentClick}
                      >
                        Complete Payment
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
                        <div className="sms-text" style={{whiteSpace: 'pre-line', lineHeight: 1.6}}>
                          <strong>RecoverAI</strong>{"\n\n"}
                          Your payment of {formatINR(selected.amount)} requires attention.{"\n\n"}
                          Complete your payment securely:
                        </div>
                        <button
                          className="button sms-action-btn"
                          style={{marginTop: 14}}
                          onClick={handlePaymentClick}
                        >
                          Complete Payment
                        </button>
                        <div className="sms-expiry" style={{marginTop: 10}}>Link expires: {formattedExpiry}.</div>
                      </div>
                    </div>
                    <div className="phone-bottom-indicator" />
                  </div>
                  <div className="simulation-disclaimer">
                    SMS communication simulated for demonstration purposes.
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
                        <div className="wa-greeting" style={{fontWeight: 700}}>RecoverAI ✓</div>
                        <p className="wa-body-text" style={{margin: '10px 0 6px 0'}}>
                          Your recent payment could not be completed.
                        </p>
                        <div style={{margin: '8px 0 12px 0', fontSize: '0.95rem', color: '#1e293b'}}>
                          Amount: <b>{formatINR(selected.amount)}</b>
                        </div>
                        <button
                          className="wa-btn"
                          style={{marginTop: 4}}
                          onClick={handlePaymentClick}
                        >
                          ⚡ Complete Payment
                        </button>
                        <div className="wa-footer-msg" style={{marginTop: 12}}>
                          Payment link expires on {formattedExpiry}.
                        </div>
                        <div className="wa-bubble-time">
                          09:41 AM <span className="wa-receipts">✓✓</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="simulation-disclaimer">
                    WhatsApp message simulated for demonstration purposes.
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
