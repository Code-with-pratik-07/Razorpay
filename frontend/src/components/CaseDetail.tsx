import React from 'react';
import { RecoveryCase, Explanation, AuditEvent, Execution, formatINR, title, formatDate, formatExpiryDate } from '../types';
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
  setError?: (e: string | null) => void;
  loadDetails?: (id: string) => Promise<void>;
  refreshCases?: (preserveSelection?: boolean) => Promise<RecoveryCase[]>;
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
      return 'Wait for Customer Response';
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
      return '⏳ Awaiting Customer Response';
    default:
      return outcome.replace(/_/g, ' ');
  }
}

function formatTiming(waitPeriod: string, nextAction?: string): string {
  if (!waitPeriod || waitPeriod === 'None' || waitPeriod === 'none' || nextAction === 'STOP_RECOVERY') return 'None';
  if (nextAction === 'AWAIT_RESPONSE') return '⏱ Review after 24 hours';
  if (waitPeriod.toLowerCase().includes('24')) return '⏱ After 24 Hours';
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
  setNotice,
  setError,
  loadDetails,
  refreshCases
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
  const [isRunningNextStep, setIsRunningNextStep] = React.useState(false);

  // Status flags & unified derived state
  const isRecovered = selected.status === 'recovered';
  const isAttemptLimitReached =
    selected.retry_count >= selected.max_retries ||
    selected.status === 'abandoned' ||
    explanation?.channel_intelligence?.status === 'ATTEMPT_LIMIT_REACHED';
  const isAbandoned = selected.status === 'abandoned' || isAttemptLimitReached;
  const followupAction = explanation?.channel_intelligence?.followup_decision?.next_action;
  const followupOutcome = explanation?.channel_intelligence?.followup_decision?.previous_outcome;
  const isTerminalCase = isRecovered || isAbandoned || selected.status === 'closed' || followupAction === 'STOP_RECOVERY';
  const isHumanReview = !isTerminalCase && (selected.status === 'human_review' || explanation?.human_review_status === 'REQUIRED');
  const isRecovering = !isTerminalCase && !isHumanReview && (selected.status === 'recovering');

  // Dynamic available communications strictly from backend records & prepared channel
  const journey = explanation?.channel_intelligence?.communication_journey || [];
  const latestComm = journey.length > 0 ? journey[journey.length - 1] : null;
  const isAwaitingResponse = !isTerminalCase && (
    followupAction === 'AWAIT_RESPONSE' ||
    followupOutcome === 'AWAITING_RESPONSE' ||
    latestComm?.outcome === 'AWAITING_RESPONSE'
  );

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

  const recommendedChannel = explanation?.recommended_channel || selected.selected_channel || 'whatsapp';
  const recChannelName = title(recommendedChannel);
  const commStatus = explanation?.communication_status || selected.notification_status || 'PENDING';
  const humanReviewStatus = explanation?.human_review_status || 'NOT_REQUIRED';
  const dispatchedChannel = explanation?.dispatched_channel || selected.selected_channel;
  const canApproveRecovery = (isHumanReview || humanReviewStatus === 'REQUIRED') && !isTerminalCase && !isAttemptLimitReached && selected.retry_count < selected.max_retries;

  if (commStatus === 'READY' && humanReviewStatus !== 'REQUIRED' && !isTerminalCase && !isAttemptLimitReached) {
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

  const [selectedCommId, setSelectedCommId] = React.useState<string | null>(null);

  const availableCommunications = actualComms;
  const selectedComm = availableCommunications.find(c => c.id === selectedCommId) || availableCommunications[0];

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

  React.useEffect(() => {
    if (!showCommModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowCommModal(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showCommModal]);

  const handleRunNextStep = async () => {
    if (!selected) return;
    setIsRunningNextStep(true);
    if (setError) setError(null);
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8000";
      const res = await fetch(`${apiBase}/api/cases/${selected.id}/next-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data.detail || 'Failed to execute next recovery step';
        if (setError) setError(errMsg);
        setNotice(`Execution error: ${errMsg}`);
        return;
      }

      if (data.status === 'no_action') {
        setNotice(data.reason || 'No further action required. The current follow-up step has already been executed.');
      } else {
        const channelName = data.channel ? title(data.channel) : 'Communication';
        setNotice(`Next recovery step (${channelName} Attempt ${data.attempt || 2}) executed successfully.`);
        if (data.channel) {
          setActiveCommTab(data.channel.toLowerCase() as 'email' | 'sms' | 'whatsapp');
        }
      }

      // Refresh case data immediately
      if (loadDetails) {
        await loadDetails(selected.id);
      }
      if (refreshCases) {
        await refreshCases(true);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Network error executing next step';
      console.error('Failed to run next recovery step:', e);
      if (setError) setError(errMsg);
      setNotice(`Network error: ${errMsg}`);
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
    ? formatExpiryDate(selected.payment_link_expires_at)
    : "10 Sep 2026, 10:00 AM";

  const isLinkExpired = selected.payment_link_expires_at
    ? new Date(selected.payment_link_expires_at).getTime() < Date.now()
    : false;

  // Normalized Communication Status Display
  const getCommunicationStatusInfo = () => {
    if (isRecovered || commStatus === 'COMPLETED' || selected.status === 'recovered') {
      return {
        icon: "✓",
        badge: "Communication Completed",
        text: "Payment recovered successfully",
        cls: "status-completed",
        canView: true,
        isReady: false,
      };
    }
    if (isTerminalCase || isAttemptLimitReached || isAbandoned || commStatus === 'EXHAUSTED' || selected.status === 'abandoned') {
      return {
        icon: "■",
        badge: "Communication Stopped",
        text: "Maximum recovery attempt limit reached",
        cls: "status-exhausted",
        canView: true,
        isReady: false,
      };
    }
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
    if (isAwaitingResponse) {
      return {
        icon: "⏳",
        badge: "Awaiting Customer Response",
        text: "Recovery communication dispatched; observing customer activity",
        cls: "status-awaiting",
        canView: true,
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
    !isTerminalCase &&
    !isAttemptLimitReached &&
    !isRecovered &&
    !isAbandoned &&
    !isHumanReview &&
    !isAwaitingResponse &&
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
            <Badge value={isRecovered ? 'recovered' : isAbandoned ? 'abandoned' : selected.status} />
          </h2>
          <div className="details-meta" style={{wordBreak: 'break-word'}}>
            {selected.customer_email ?? 'Customer'} • {title(selected.payment_method)}
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
                        <div key={idx} className="journey-v-item">
                          <div className="journey-v-node-header">
                            <span className="journey-v-dot" />
                            <span className="journey-v-title-text">Attempt {item.attempt_number}</span>
                          </div>
                          <div 
                            className="journey-compact-card clickable-journey-step"
                            onClick={() => openCommunicationModal(item.channel as any, itemId)}
                            title={`Click to view ${title(item.channel)} Attempt ${item.attempt_number} preview`}
                            style={{cursor: 'pointer'}}
                          >
                            <span className="journey-v-channel" style={{fontSize: '0.85rem', fontWeight: 600}}>
                              {chIcon} {title(item.channel)}{isReminder ? ' Reminder' : ''}
                            </span>
                            <span className={`journey-v-status outcome-${item.outcome.toLowerCase()}`} style={{fontSize: '0.72rem', padding: '3px 8px', borderRadius: 4}}>
                              {isPaid ? '✓ Payment Completed' : 
                               isLinkClicked ? '✓ Delivered • 🔗 Payment Link Clicked' : 
                               isAwaiting ? '✓ Simulated Sent • ⏳ Awaiting Customer Response' :
                               isIgnored ? '✓ Delivered • No Customer Engagement' : 
                               '✓ Delivered'}
                            </span>
                          </div>
                          {isLinkClicked && (
                            <div className="journey-transition-row">
                              <span>{journey.length > 1 ? 'Waited 24 hours' : 'Follow-up after 24 hours'}</span>
                            </div>
                          )}
                          {isIgnored && (
                            <div className="journey-transition-row">
                              <span>{journey.length > 1 ? 'Waited 24 hours' : 'Follow-up after 24 hours'}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {!isTerminalCase && !isAttemptLimitReached && !isAwaitingResponse && channelIntel.followup_decision?.next_action !== 'AWAIT_RESPONSE' && channelIntel.followup_decision?.next_action !== 'STOP_RECOVERY' && (
                      <div className="journey-v-item next-action-item">
                        <div className="journey-v-node-header">
                          <span className="journey-v-dot dot-pending" />
                          <span className="journey-v-title-text" style={{color: '#60a5fa'}}>Next Action</span>
                        </div>
                        <div 
                          className="journey-compact-card clickable-journey-step"
                          onClick={() => openCommunicationModal(recommendedChannel as any)}
                          title="Click to view communication preview"
                          style={{cursor: 'pointer', border: '1px dashed #60a5fa'}}
                        >
                          <span className="journey-v-channel" style={{fontSize: '0.85rem', fontWeight: 600}}>
                            {channelIntel.followup_decision?.selected_channel 
                              ? `${channelIntel.followup_decision.selected_channel === 'whatsapp' ? '💬' : channelIntel.followup_decision.selected_channel === 'sms' ? '📱' : '✉️'} ${title(channelIntel.followup_decision.selected_channel)} ${channelIntel.followup_decision.next_action === 'RETRY_SAME_CHANNEL' ? 'Reminder' : ''}`
                              : (recommendedChannel === 'whatsapp' ? '💬 WhatsApp' : recommendedChannel === 'sms' ? '📱 SMS' : '✉️ Email')}
                          </span>
                          <span className="journey-v-status" style={{background: '#1e3a8a', color: '#93c5fd', fontSize: '0.72rem', padding: '3px 8px', borderRadius: 4}}>
                            ⏳ Scheduled
                          </span>
                        </div>
                      </div>
                    )}

                    {(isTerminalCase || isAttemptLimitReached || isAbandoned) && !isRecovered && (
                      <div className="journey-v-item terminal-item">
                        <div className="journey-v-node-header">
                          <span className="journey-v-dot dot-terminal" />
                          <span className="journey-v-title-text" style={{color: '#f87171'}}>Recovery Closed</span>
                        </div>
                        <div className="journey-compact-card" style={{borderColor: '#7f1d1d', background: 'rgba(69, 10, 10, 0.4)'}}>
                          <span style={{fontSize: '0.82rem', color: '#fca5a5'}}>
                            Maximum recovery attempt limit reached.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 5. FOLLOW-UP DECISION */}
            {channelIntel?.followup_decision && (
              <div className="intelligence-card followup-intelligence-card" style={{gridColumn: '1 / -1'}}>
                <div className="fd-header" style={{marginBottom: 12}}>
                  <div style={{fontWeight: 700, fontSize: '0.85rem', color: '#60a5fa', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6}}>
                    <span>🔄</span> FOLLOW-UP DECISION
                  </div>
                </div>

                <div className="fd-grid" style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: canRunNextStep ? 14 : 0}}>
                  <div className="fd-item" style={{background: '#0f172a', padding: '10px 14px', borderRadius: 6, border: '1px solid #1e293b'}}>
                    <div style={{fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.04em'}}>Previous Outcome</div>
                    <div style={{fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0'}}>
                      {formatPreviousOutcome(channelIntel.followup_decision.previous_outcome)}
                    </div>
                  </div>
                  <div className="fd-item" style={{background: '#0f172a', padding: '10px 14px', borderRadius: 6, border: '1px solid #1e293b'}}>
                    <div style={{fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.04em'}}>Next Action</div>
                    <div style={{fontSize: '0.9rem', fontWeight: 600, color: '#93c5fd'}}>
                      {formatNextActionLabel(channelIntel.followup_decision.next_action, channelIntel.followup_decision.selected_channel)}
                    </div>
                  </div>
                  <div className="fd-item" style={{background: '#0f172a', padding: '10px 14px', borderRadius: 6, border: '1px solid #1e293b'}}>
                    <div style={{fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 4, letterSpacing: '0.04em'}}>When</div>
                    <div style={{fontSize: '0.9rem', fontWeight: 600, color: '#fde047'}}>
                      {formatTiming(channelIntel.followup_decision.recommended_wait_period, channelIntel.followup_decision.next_action)}
                    </div>
                  </div>
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
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 6. AI ADVISOR */}
        {explanation?.ai && <AIAdvisorCard explanation={explanation} />}

        {/* 7. PAYMENT RECOVERY ACTION */}
        {isRecovered ? (
          <div className="payment-recovery-card terminal-banner terminal-recovered" style={{
            background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)',
            border: '1.5px solid #10b981',
            borderRadius: 8,
            padding: '22px 24px',
            color: '#ffffff',
            boxShadow: '0 4px 20px rgba(6, 78, 59, 0.3)'
          }}>
            <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12}}>
              <span style={{fontSize: '1.3rem', color: '#6ee7b7', fontWeight: 800}}>✓</span>
              <h3 style={{margin: 0, color: '#6ee7b7', fontSize: '1.05rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase'}}>
                PAYMENT SUCCESSFULLY RECOVERED
              </h3>
            </div>
            <div style={{margin: '8px 0 12px 0', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap'}}>
              <span style={{fontSize: '2rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.03em', lineHeight: 1.1}}>
                {formatINR(selected.amount)}
              </span>
              <span style={{fontSize: '1.05rem', fontWeight: 600, color: '#e6fffa'}}>
                recovered successfully.
              </span>
            </div>
            <div style={{fontSize: '0.92rem', color: '#d1fae5', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8, marginTop: 10}}>
              <span>Recovery attributed to:</span>
              <span style={{
                fontWeight: 700,
                color: '#ffffff',
                background: 'rgba(255, 255, 255, 0.18)',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                padding: '3px 10px',
                borderRadius: 4,
                letterSpacing: '0.04em',
                fontSize: '0.85rem'
              }}>
                {channelIntel?.attributed_channel?.toUpperCase() || 'SMS'}
              </span>
            </div>
          </div>
        ) : isAbandoned ? (
          <div className="payment-recovery-card terminal-banner terminal-abandoned" style={{
            background: '#271212', border: '1px solid #7f1d1d', borderRadius: 8, padding: '20px', color: '#fee2e2'
          }}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <span style={{fontSize: '1.4rem'}}>■</span>
                <h3 style={{margin: 0, color: '#f87171', fontSize: '1.1rem', letterSpacing: '0.05em'}}>RECOVERY CLOSED</h3>
              </div>
              <span className="pr-status-badge" style={{background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d', fontSize: '0.78rem', padding: '4px 10px', borderRadius: 4}}>
                {isLinkExpired ? '🔴 Expired Payment Link' : currentLink ? 'Existing Payment Link' : 'Recovery Closed'}
              </span>
            </div>
            <div style={{fontSize: '0.95rem', margin: '12px 0 6px 0', color: '#fca5a5'}}>
              Maximum permitted recovery attempts were reached without payment completion. Automated recovery communication has stopped.
            </div>
            {currentLink && !isLinkExpired && (
              <div style={{fontSize: '0.85rem', color: '#cbd5e1', marginTop: 8}}>
                Existing Payment Link remains technically valid until {formatExpiryDate(selected.payment_link_expires_at)}, but no further recovery actions will be scheduled.
              </div>
            )}
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
              <h3>⚡ PAYMENT RECOVERY</h3>
              <span className={`pr-status-badge ${isLinkExpired ? 'expired' : currentLink ? 'active' : 'pending'}`}>
                {isLinkExpired ? '🔴 Expired Payment Link' : currentLink ? '🟢 Active Payment Link' : 'PENDING'}
              </span>
            </div>

            <div className="pr-body-grid">
              <div className="pr-info-col">
                <div className="pr-meta-item">
                  <span className="pr-label">Recovery Method</span>
                  <b>{executionMode}</b>
                </div>
                <div className="pr-meta-item">
                  <span className="pr-label">Expires</span>
                  <b>{formattedExpiry}{isLinkExpired ? ' (Expired)' : ''}</b>
                </div>
              </div>

              <div className="pr-actions-col">
                {currentLink && !isLinkExpired && (
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
                {isLinkExpired && (
                  <div style={{color: '#fca5a5', fontSize: '0.85rem', fontWeight: 500, padding: '6px 12px', background: 'rgba(127, 29, 29, 0.3)', borderRadius: 6, border: '1px solid #7f1d1d'}}>
                    ⚠️ Payment link has expired. Regenerating a new link is recommended.
                  </div>
                )}
              </div>
            </div>

            <div className="pr-comm-row">
              <div className="pr-comm-status-wrap">
                <span className="pr-label">CUSTOMER COMMUNICATION</span>
                <div style={{marginTop: 4}}>
                  <span className={`pr-comm-pill ${commInfo.cls}`}>
                    {commInfo.icon} {commInfo.badge}
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
                <span className="badge" style={{background: '#065f46', color: '#ffffff', fontWeight: 700, padding: '5px 12px', borderRadius: 6, fontSize: '0.82rem', letterSpacing: '0.04em'}}>
                  ✓ PAYMENT COMPLETED
                </span>
                <p style={{margin: '10px 0 0 0', color: '#0f172a', fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.5}}>
                  The payment was successfully completed.
                </p>
              </div>
            ) : isAbandoned ? (
              <div>
                <span className="badge" style={{background: '#7f1d1d', color: '#ffffff', fontWeight: 700, padding: '5px 12px', borderRadius: 6, fontSize: '0.82rem', letterSpacing: '0.04em'}}>
                  RECOVERY CLOSED
                </span>
                <p style={{margin: '10px 0 0 0', color: '#0f172a', fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.5}}>
                  The maximum number of recovery attempts has been reached without successful payment. Automated recovery communication has been stopped.
                </p>
              </div>
            ) : selected.last_payment_status === 'FAILED' ? (
              <div>
                <span className="badge" style={{background: '#991b1b', color: '#ffffff', fontWeight: 700, padding: '5px 12px', borderRadius: 6, fontSize: '0.82rem', letterSpacing: '0.04em'}}>
                  ✕ CUSTOMER PAYMENT FAILED
                </span>
                <p style={{margin: '10px 0 4px 0', color: '#991b1b', fontSize: '0.95rem', fontWeight: 500}}>
                  The customer attempted to pay using the link, but the transaction was unsuccessful: <b style={{color: '#7f1d1d'}}>{selected.last_payment_failure_reason || 'Failure'}</b>.
                </p>
                {selected.last_payment_attempt_at && (
                  <span style={{fontSize: '0.82rem', color: '#475569', fontWeight: 500}}>Last Attempt: {formatDate(selected.last_payment_attempt_at)}</span>
                )}
              </div>
            ) : isAwaitingResponse || channelIntel?.followup_decision?.next_action === 'AWAIT_RESPONSE' ? (
              <div>
                <span className="badge" style={{background: '#1e40af', color: '#ffffff', fontWeight: 700, padding: '5px 12px', borderRadius: 6, fontSize: '0.82rem', letterSpacing: '0.04em'}}>
                  ⏳ CUSTOMER RESPONSE PENDING
                </span>
                <p style={{margin: '10px 0 0 0', color: '#0f172a', fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.5}}>
                  A WhatsApp reminder has been sent. RecoverAI is waiting for customer activity before taking another recovery action.
                </p>
              </div>
            ) : channelIntel?.followup_decision?.previous_outcome === 'LINK_CLICKED' ? (
              <div>
                <span className="badge" style={{background: '#1e40af', color: '#ffffff', fontWeight: 700, padding: '5px 12px', borderRadius: 6, fontSize: '0.82rem', letterSpacing: '0.04em'}}>
                  ⏳ CUSTOMER PAYMENT PENDING
                </span>
                <p style={{margin: '10px 0 0 0', color: '#0f172a', fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.5}}>
                  The customer opened the payment link but has not completed the payment.
                </p>
              </div>
            ) : isRecovering ? (
              <div>
                <span className="badge" style={{background: '#1e40af', color: '#ffffff', fontWeight: 700, padding: '5px 12px', borderRadius: 6, fontSize: '0.82rem', letterSpacing: '0.04em'}}>
                  ⏳ CUSTOMER PAYMENT PENDING
                </span>
                <p style={{margin: '10px 0 0 0', color: '#0f172a', fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.5}}>
                  Payment link is active. Waiting for customer checkout.
                </p>
              </div>
            ) : (
              <div>
                <span className="badge" style={{background: '#92400e', color: '#ffffff', fontWeight: 700, padding: '5px 12px', borderRadius: 6, fontSize: '0.82rem', letterSpacing: '0.04em'}}>
                  ⏳ AWAITING REVIEW
                </span>
                <p style={{margin: '10px 0 0 0', color: '#0f172a', fontSize: '0.95rem', fontWeight: 500, lineHeight: 1.5}}>
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
              </div>
              <button className="comm-modal-close" onClick={() => setShowCommModal(false)}>✕</button>
            </div>

            {/* Dynamic Channel Tabs / Selector */}
            <div className="comm-modal-tabs">
              {availableCommunications.map((comm) => {
                const isActive = selectedCommId ? comm.id === selectedCommId : comm.id === availableCommunications[0]?.id;
                const chIcon = comm.channel === 'whatsapp' ? '💬' : comm.channel === 'sms' ? '📱' : '✉️';
                const isReminder = comm.attempt > 1 && comm.channel === availableCommunications[0]?.channel;
                const label = comm.isPrepared 
                  ? `${chIcon} ${title(comm.channel)} • Prepared`
                  : `${chIcon} ${title(comm.channel)}${isReminder ? ' Reminder' : ''} • Attempt ${comm.attempt}`;
                return (
                  <button
                    key={comm.id}
                    className={`comm-modal-tab ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedCommId(comm.id);
                      setActiveCommTab(comm.channel);
                    }}
                  >
                    {label}
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

              {/* TAB 1: EMAIL */}
              {activeCommTab === 'email' && (
                <div className="email-tab-container" style={{width: '100%', maxWidth: 500, margin: '0 auto'}}>
                  {/* Prepared vs Sent Status Banner */}
                  {(selectedComm?.isPrepared || (commStatus === 'READY' && !actualComms.some(c => c.channel === 'email' && !c.isPrepared))) ? (
                    <div className="email-status-banner prepared" style={{
                      background: '#1e293b',
                      border: '1px solid #f59e0b',
                      borderRadius: 8,
                      padding: '12px 16px',
                      marginBottom: 16,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 12
                    }}>
                      <div>
                        <div style={{fontWeight: 700, fontSize: '0.85rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 6}}>
                          <span>🟡</span> Communication Prepared
                        </div>
                        <div style={{fontSize: '0.82rem', color: '#cbd5e1', marginTop: 2}}>
                          This email is ready for review and has not been sent to the customer.
                        </div>
                      </div>
                      <button
                        className="button primary"
                        style={{background: '#2563eb', padding: '6px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap'}}
                        onClick={() => void handleSimulateDispatch('email')}
                        disabled={isSending}
                      >
                        {isSending ? "Dispatching..." : `⚡ Simulate Sending`}
                      </button>
                    </div>
                  ) : (
                    <div className="email-status-banner simulated" style={{
                      background: 'rgba(6, 78, 59, 0.3)',
                      border: '1px solid #059669',
                      borderRadius: 8,
                      padding: '8px 14px',
                      marginBottom: 16,
                      color: '#34d399',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}>
                      <span>✓</span> Email Simulated
                    </div>
                  )}

                  {/* Transactional Email Card */}
                  <div className="email-preview-wrapper" style={{
                    background: '#ffffff',
                    color: '#1e293b',
                    borderRadius: 8,
                    overflow: 'hidden',
                    width: '100%',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.1)'
                  }}>
                    <div className="email-preview-body" style={{padding: '28px 24px'}}>
                      <div style={{fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', marginBottom: 20}}>
                        RecoverAI
                      </div>

                      <h3 style={{margin: '0 0 16px 0', color: '#0f172a', fontSize: '1.1rem', fontWeight: 700}}>
                        Payment Requires Your Attention
                      </h3>

                      <p style={{color: '#334155', margin: '0 0 12px 0', fontSize: '0.92rem'}}>
                        Hello,
                      </p>

                      <p style={{color: '#334155', margin: '0 0 12px 0', fontSize: '0.92rem'}}>
                        Your recent payment of <b>{formatINR(selected.amount)}</b> could not be completed.
                      </p>

                      <p style={{color: '#334155', margin: '0 0 22px 0', fontSize: '0.92rem'}}>
                        Please complete your payment securely using the payment link below.
                      </p>

                      <div style={{margin: '22px 0'}}>
                        <button
                          className="button primary email-complete-btn"
                          onClick={handlePaymentClick}
                          style={{
                            background: '#2563eb',
                            color: '#ffffff',
                            padding: '11px 24px',
                            borderRadius: 6,
                            fontWeight: 600,
                            fontSize: '0.92rem',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6
                          }}
                        >
                          Complete Payment →
                        </button>
                      </div>

                      <div style={{fontSize: '0.85rem', color: '#64748b', margin: '0 0 16px 0', lineHeight: 1.5}}>
                        Payment link expires on<br />
                        <b style={{color: '#0f172a'}}>{formattedExpiry}</b>
                      </div>

                      <p style={{color: '#64748b', fontSize: '0.82rem', margin: '0 0 20px 0', lineHeight: 1.4}}>
                        If you have already completed this payment, please ignore this message.
                      </p>

                      <hr style={{border: 'none', borderTop: '1px solid #e2e8f0', margin: '20px 0 14px 0'}} />

                      <div style={{fontSize: '0.78rem', color: '#94a3b8', textAlign: 'center'}}>
                        Secure payment processing powered by Razorpay
                      </div>
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
                        <div className="sms-text" style={{whiteSpace: 'pre-line', lineHeight: 1.5}}>
                          <strong>RecoverAI</strong>{"\n\n"}
                          Your payment of {formatINR(selected.amount)} requires attention.{"\n\n"}
                          Complete payment securely:{"\n"}
                          <span
                            onClick={handlePaymentClick}
                            style={{color: '#38bdf8', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600, wordBreak: 'break-all'}}
                          >
                            {currentLink ? (currentLink.includes('rzp.io') ? currentLink.replace(/^https?:\/\//, '') : `rzp.io/pay_${selected.case_number.toLowerCase().replace(/[^a-z0-9]/g, '')}`) : 'rzp.io/demo_pay'}
                          </span>
                        </div>
                        <button
                          className="button sms-action-btn"
                          style={{marginTop: 14}}
                          onClick={handlePaymentClick}
                        >
                          Complete Payment
                        </button>
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
                    <div className="wa-header" style={{display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#075e54', color: '#fff'}}>
                      <span className="wa-back-arrow" style={{fontSize: '1.2rem', cursor: 'pointer', marginRight: 2}}>←</span>
                      <div className="wa-header-avatar" style={{width: 36, height: 36, borderRadius: '50%', background: '#128c7e', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', border: '1px solid rgba(255,255,255,0.25)'}}>
                        RA
                      </div>
                      <div className="wa-header-info" style={{flex: 1}}>
                        <div className="wa-header-name" style={{fontWeight: 700, fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: 4}}>
                          RecoverAI <span className="wa-verified-badge" style={{fontSize: '0.75rem', color: '#4ade80'}} title="Verified Business">✓</span>
                        </div>
                        <div className="wa-header-sub" style={{fontSize: '0.7rem', color: '#e0f2fe', opacity: 0.9}}>
                          Official Business Account
                        </div>
                      </div>
                    </div>
                    <div className="wa-chat-body" style={{background: '#efeae2', padding: '16px 12px'}}>
                      <div className="wa-date-chip" style={{textAlign: 'center', margin: '0 auto 12px auto', fontSize: '0.72rem', background: 'rgba(255,255,255,0.85)', padding: '3px 10px', borderRadius: 6, width: 'fit-content', color: '#54656f', fontWeight: 600}}>
                        TODAY
                      </div>
                      <div className="wa-bubble" style={{background: '#ffffff', borderRadius: '8px 8px 8px 2px', padding: '12px 14px', maxWidth: '320px', boxShadow: '0 1px 2px rgba(0,0,0,0.15)', color: '#111b21'}}>
                        {selectedComm?.attempt && selectedComm.attempt > 1 ? (
                          <>
                            <div style={{fontWeight: 700, fontSize: '0.92rem', color: '#075e54', marginBottom: 6}}>
                              Payment Reminder
                            </div>
                            <p className="wa-body-text" style={{margin: '0 0 10px 0', fontSize: '0.88rem', lineHeight: 1.45, color: '#111b21'}}>
                              Your payment is still pending. Please complete it securely using the payment link below.
                            </p>
                          </>
                        ) : (
                          <p className="wa-body-text" style={{margin: '0 0 10px 0', fontSize: '0.88rem', lineHeight: 1.45, color: '#111b21'}}>
                            Your recent payment could not be completed.
                          </p>
                        )}
                        <div style={{margin: '0 0 12px 0'}}>
                          <div style={{fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', marginBottom: 2}}>Amount Due</div>
                          <b style={{fontSize: '1.05rem', color: '#111b21'}}>{formatINR(selected.amount)}</b>
                        </div>
                        <button
                          className="wa-btn"
                          style={{
                            width: '100%',
                            background: '#25d366',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '9px 14px',
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                            boxShadow: '0 1px 2px rgba(0,0,0,0.2)'
                          }}
                          onClick={handlePaymentClick}
                        >
                          ⚡ Complete Payment
                        </button>
                        <div className="wa-footer-msg" style={{marginTop: 12, fontSize: '0.78rem', color: '#667781', lineHeight: 1.4}}>
                          This payment link expires on<br />
                          <b>{formattedExpiry}</b>
                        </div>
                        <div className="wa-bubble-time" style={{textAlign: 'right', fontSize: '0.68rem', color: '#667781', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3}}>
                          09:41 <span className="wa-receipts" style={{color: '#53bdeb'}}>✓✓</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="simulation-disclaimer" style={{textAlign: 'center', fontSize: '0.74rem', color: '#94a3b8', marginTop: 12, fontStyle: 'italic'}}>
                    Simulated WhatsApp communication for demonstration purposes.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
