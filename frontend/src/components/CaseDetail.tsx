import React from 'react';
import { RecoveryCase, Explanation, AuditEvent, Execution, formatINR, title, formatDate, formatExpiryDate } from '../types';
import { API_BASE_URL } from '../config';
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

function renderChannelIcon(channel?: string | null, size = 14) {
  const ch = channel?.toLowerCase();
  if (ch === 'whatsapp') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
        <path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.978-.276-.1-.477-.15-.678.15-.2.301-.778.978-.954 1.179-.176.2-.352.226-.653.075-1.506-.754-2.49-1.34-3.48-3.037-.26-.447.26-.415.744-1.383.08-.16.04-.301-.02-.451-.06-.15-.678-1.633-.93-2.235-.245-.588-.494-.508-.678-.517l-.578-.01c-.2 0-.527.075-.803.376s-1.054 1.03-1.054 2.511c0 1.482 1.079 2.913 1.23 3.114.15.201 2.124 3.243 5.145 4.549 1.954.845 2.72.923 3.71.775.602-.09 1.78-.727 2.03-1.431.251-.703.251-1.305.176-1.431-.075-.125-.276-.201-.577-.351zM12.04 2C6.544 2 2.07 6.474 2.07 11.97c0 1.96.568 3.79 1.554 5.337L2 22l4.836-1.572c1.474.887 3.204 1.402 5.05 1.402 5.496 0 9.97-4.474 9.97-9.97C21.856 6.474 17.382 2 12.04 2z"/>
      </svg>
    );
  }
  if (ch === 'sms') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
        <line x1="12" y1="18" x2="12.01" y2="18"/>
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  );
}

function renderChannelBadge(channel?: string | null, size = 12) {
  const ch = channel?.toLowerCase();
  const cls = ch === 'whatsapp' ? 'ch-icon-whatsapp' : ch === 'sms' ? 'ch-icon-sms' : 'ch-icon-email';
  return (
    <span className={`channel-icon-container ${cls}`}>
      {renderChannelIcon(channel, size)}
    </span>
  );
}

function formatNextActionLabel(nextAction: string, channel: string | null): string {
  const ch = channel ? title(channel) : '';
  switch (nextAction) {
    case 'RETRY_SAME_CHANNEL':
      return channel === 'whatsapp' ? 'Send WhatsApp Reminder' :
             channel === 'sms' ? 'Send SMS Reminder' :
             `Send ${ch} Reminder`;
    case 'SWITCH_CHANNEL':
      return channel === 'sms' ? 'Switch to SMS' :
             channel === 'whatsapp' ? 'Switch to WhatsApp' :
             `Switch to ${ch}`;
    case 'DISPATCH_INITIAL':
      return `Dispatch ${ch} Communication`;
    case 'AWAIT_APPROVAL':
      return 'Await Human Approval';
    case 'AWAIT_RESPONSE':
      return 'Wait for Customer Response';
    case 'GENERATE_NEW_LINK':
      return 'Generate New Payment Link';
    case 'STOP_RECOVERY':
      return 'Close Recovery';
    default:
      return nextAction.replace(/_/g, ' ');
  }
}

function formatPreviousOutcome(outcome: string | null, isTerminal = false): string {
  if (!outcome) return 'None';
  switch (outcome) {
    case 'LINK_CLICKED':
    case 'CLICKED':
      return 'Payment Link Clicked';
    case 'NO_ENGAGEMENT':
    case 'IGNORED':
      return 'Delivered • No Customer Engagement';
    case 'PAYMENT_COMPLETED':
      return 'Payment Captured Successfully';
    case 'FAILED_DELIVERY':
    case 'FAILED':
      return 'Delivery Failed';
    case 'PAYMENT_LINK_EXPIRED':
      return 'Payment Link Expired';
    case 'AWAITING_RESPONSE':
      return isTerminal ? 'Delivered • No Customer Engagement' : 'Awaiting Customer Response';
    default:
      return outcome.replace(/_/g, ' ');
  }
}

function formatTiming(waitPeriod: string, nextAction?: string): string {
  if (!waitPeriod || waitPeriod === 'None' || waitPeriod === 'none' || nextAction === 'STOP_RECOVERY') return 'None';
  if (nextAction === 'AWAIT_RESPONSE') return 'Review after 24 hours';
  if (waitPeriod.toLowerCase().includes('24')) return 'After 24 Hours';
  if (waitPeriod.toLowerCase().includes('immediate')) return 'Immediate';
  return waitPeriod;
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
  // Modal and preview states (unconditional hooks declared at top level)
  const [showCommModal, setShowCommModal] = React.useState(false);
  const [activeCommTab, setActiveCommTab] = React.useState<'email' | 'sms' | 'whatsapp'>('email');
  const [copied, setCopied] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [isRunningNextStep, setIsRunningNextStep] = React.useState(false);
  const isRunningNextStepRef = React.useRef(false);
  const [statusCheckNotice, setStatusCheckNotice] = React.useState<{
    type: 'info' | 'success' | 'error';
    title: string;
    message: string;
  } | null>(null);

  React.useEffect(() => {
    isRunningNextStepRef.current = false;
    setIsRunningNextStep(false);
    setStatusCheckNotice(null);
  }, [selected?.id]);

  const [selectedCommId, setSelectedCommId] = React.useState<string | null>(null);

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
  const hasHumanApproval = audit.some((e) => e.event_type === "human_approval" || e.event_type === "manual_review_approved");
  const isAutomatic = recoveryStartedEvent?.event_data.automatic === true;

  // Status flags & unified authoritative state
  const isRecovered = selected.status === 'recovered';
  const isAbandoned = selected.status === 'abandoned' || selected.status === 'closed';
  const isRecoveryClosed = isAbandoned;
  const isTerminalCase = isRecovered || isAbandoned;
  const isRecovering = selected.status === 'recovering';
  const isAttemptLimitReached = selected.retry_count >= selected.max_retries;
  const followupAction = explanation?.channel_intelligence?.followup_decision?.next_action;
  const followupOutcome = explanation?.channel_intelligence?.followup_decision?.previous_outcome;

  const humanReviewStatus = explanation?.human_review_status || 'NOT_REQUIRED';
  const isHumanReview = (selected.status === 'human_review' || humanReviewStatus === 'REQUIRED') && humanReviewStatus !== 'APPROVED';
  const canApproveRecovery = isHumanReview && !isRecovered && !isAbandoned;

  const executionMode = isRecovered
    ? "Recovery Completed"
    : isAbandoned
    ? "Recovery Workflow Closed"
    : isHumanReview
    ? "Pending Human Review"
    : (hasHumanApproval || explanation?.manual_execution)
    ? "Human Approved Recovery"
    : (isAutomatic || isRecovering)
    ? "Automatic Recovery"
    : "Pending Execution";

  // Dynamic available communications strictly from backend records & prepared channel
  const channelIntel = explanation?.channel_intelligence;
  const journey = channelIntel?.communication_journey || [];
  const latestComm = journey.length > 0 ? journey[journey.length - 1] : null;
  const isAwaitingResponse = !isTerminalCase && (
    followupAction === 'AWAIT_RESPONSE' ||
    followupOutcome === 'AWAITING_RESPONSE' ||
    latestComm?.outcome === 'AWAITING_RESPONSE'
  );
  const hasClickedLink = journey.some(r => r.outcome === 'LINK_CLICKED' || r.outcome === 'CLICKED') ||
    explanation?.channel_intelligence?.followup_decision?.previous_outcome === 'LINK_CLICKED' ||
    latestComm?.outcome === 'LINK_CLICKED';

  // Strictly use backend payment attempts (no fabricated synthetic records)
  const paymentAttempts = selected.payment_attempts || explanation?.payment_attempts || [];
  const latestPaymentAttempt = paymentAttempts.length > 0 ? paymentAttempts[0] : null;
  const effectiveCommChannel = latestComm?.channel || channelIntel?.recommended_channel || 'whatsapp';

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

  const recommendedChannel = explanation?.recommended_channel || selected.selected_channel || null;
  const recChannelName = recommendedChannel ? title(recommendedChannel) : 'Communication';
  const commStatus = explanation?.communication_status || selected.notification_status || 'PENDING';
  const dispatchedChannel = explanation?.dispatched_channel || selected.selected_channel;

  if (recommendedChannel && commStatus === 'READY' && humanReviewStatus !== 'REQUIRED' && !isTerminalCase && !isAttemptLimitReached) {
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
  const selectedComm = availableCommunications.find(c => c.id === selectedCommId) || availableCommunications[0];

  const getLastChannelDisplay = (): string => {
    if (latestComm?.channel) {
      return title(latestComm.channel);
    }
    if (channelIntel?.last_channel_used) {
      return title(channelIntel.last_channel_used);
    }
    if (channelIntel?.attributed_channel) {
      return title(channelIntel.attributed_channel);
    }
    if (dispatchedChannel) {
      return title(dispatchedChannel);
    }
    if (selected.selected_channel) {
      return title(selected.selected_channel);
    }
    if (audit && audit.length > 0) {
      const commEvent = audit.slice().reverse().find(a => {
        const et = a.event_type.toLowerCase();
        return et.includes('email') || et.includes('sms') || et.includes('whatsapp') || et.includes('communication_dispatched');
      });
      if (commEvent) {
        const et = commEvent.event_type.toLowerCase();
        const chData = commEvent.event_data?.channel;
        if (typeof chData === 'string' && chData) {
          return title(chData);
        }
        if (et.includes('email')) return 'Email';
        if (et.includes('whatsapp')) return 'WhatsApp';
        if (et.includes('sms')) return 'SMS';
      }
    }
    if (isHumanReview || selected.retry_count === 0) {
      return 'No communication delivered';
    }
    return 'Not applicable';
  };

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
    if (!selected || isRunningNextStep || isRunningNextStepRef.current) return;
    isRunningNextStepRef.current = true;
    setIsRunningNextStep(true);
    setStatusCheckNotice(null);
    if (setError) setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/cases/${selected.id}/next-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data.detail || 'Unable to execute recovery step. Please try again.';
        if (setError) setError(errMsg);
        setNotice(`Execution error: ${errMsg}`);
        setStatusCheckNotice({
          type: 'error',
          title: 'Unable to execute recovery step',
          message: `${errMsg}. Please try again.`,
        });
        return;
      }

      if (data.status === 'no_action') {
        // Backend safely protected against execution during observation period;
        // Refresh case data immediately
        if (loadDetails) {
          await loadDetails(selected.id);
        }
        if (refreshCases) {
          await refreshCases(true);
        }
        return;
      }

      const channelName = data.channel ? title(data.channel) : 'Communication';
      const noticeTitle = 'Recovery Step Dispatched';
      const noticeMsg = `Next recovery step (${channelName} Attempt ${data.attempt || 2}) executed successfully.`;
      setNotice(noticeMsg);
      setStatusCheckNotice({
        type: 'success',
        title: noticeTitle,
        message: noticeMsg,
      });
      if (data.channel) {
        setActiveCommTab(data.channel.toLowerCase() as 'email' | 'sms' | 'whatsapp');
      }

      // Refresh case data immediately
      if (loadDetails) {
        await loadDetails(selected.id);
      }
      if (refreshCases) {
        await refreshCases(true);
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Unable to execute recovery step. Please try again.';
      console.error('Failed to run next recovery step:', e);
      if (setError) setError(errMsg);
      setNotice(`Network error: ${errMsg}`);
      setStatusCheckNotice({
        type: 'error',
        title: 'Unable to execute recovery step',
        message: `${errMsg}. Please try again.`,
      });
    } finally {
      isRunningNextStepRef.current = false;
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
  const expiresAt = selected.payment_link_expires_at || explanation?.payment_link_expires_at;
  const formattedExpiry = expiresAt
    ? formatExpiryDate(expiresAt)
    : null;

  const isLinkExpired = expiresAt
    ? new Date(expiresAt).getTime() < Date.now()
    : false;

  // Normalized Communication Status Display
  const getCommunicationStatusInfo = () => {
    if (isRecovered || commStatus === 'COMPLETED' || selected.status === 'recovered') {
      return {
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ),
        badge: "Communication Completed",
        text: "Payment recovered successfully",
        cls: "status-completed",
        canView: true,
        isReady: false,
      };
    }
    if (isAbandoned || commStatus === 'EXHAUSTED' || selected.status === 'abandoned') {
      return {
        icon: (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
          </svg>
        ),
        badge: `Attempts Exhausted (${selected.retry_count} of ${selected.max_retries})`,
        text: "Maximum allowed communication attempts have been completed without customer recovery.",
        cls: "status-exhausted",
        canView: true,
        isReady: false,
      };
    }
    if (humanReviewStatus === 'REQUIRED') {
      return {
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        ),
        badge: "Communication Paused",
        text: "Waiting for human approval",
        cls: "status-waiting",
        canView: false,
        isReady: false,
      };
    }
    if (isAwaitingResponse) {
      return {
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
        ),
        badge: "Awaiting Customer Response",
        text: "Recovery communication dispatched; observing customer activity",
        cls: "status-awaiting",
        canView: true,
        isReady: false,
      };
    }
    if (commStatus === 'READY') {
      return {
        icon: renderChannelIcon(recommendedChannel, 13),
        badge: `${recChannelName} Ready`,
        text: `${recChannelName} selected for recovery communication`,
        cls: "status-ready",
        canView: true,
        isReady: true,
      };
    }
    if (commStatus === 'GENERATED' || selected.notification_status === 'MOCKED' || selected.notification_status === 'GENERATED') {
      return {
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ),
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
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ),
        badge: `${ch} Simulated`,
        text: `${ch} communication simulated for demo`,
        cls: "status-simulated",
        canView: true,
        isReady: false,
      };
    }
    if (commStatus === 'SENT' || selected.notification_status === 'SENT') {
      return {
        icon: (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        ),
        badge: "Email Sent",
        text: "Email delivered to customer",
        cls: "status-sent",
        canView: true,
        isReady: false,
      };
    }
    return {
      icon: <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />,
      badge: "Pending",
      text: "Awaiting recovery action",
      cls: "status-pending",
      canView: false,
      isReady: false,
    };
  };

  const commInfo = getCommunicationStatusInfo();

  // Track payment link click and refresh state
  const trackLinkClick = async () => {
    try {
      await fetch(`${API_BASE_URL}/api/cases/${selected.id}/track-click`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (loadDetails) {
        await loadDetails(selected.id);
      } else if (analyze) {
        await analyze();
      }
      if (refreshCases) {
        await refreshCases(true);
      }
    } catch (err) {
      console.warn("Failed to register payment link click:", err);
    }
  };

  // Handler for Complete Payment in all previews
  const handlePaymentClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    void trackLinkClick();
    const targetUrl = currentLink && (currentLink.startsWith("http://") || currentLink.startsWith("https://"))
      ? currentLink
      : `/simulate-payment/${selected.id}`;
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  // Handler for Open Payment Page button
  const handleOpenPaymentLink = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    void trackLinkClick();
    const targetUrl = currentLink && (currentLink.startsWith("http://") || currentLink.startsWith("https://"))
      ? currentLink
      : `/simulate-payment/${selected.id}`;
    window.open(targetUrl, "_blank", "noopener,noreferrer");
  };

  // Handler for demo simulation sending
  const handleSimulateDispatch = async (channelToDispatch: string) => {
    if (isSending) return;
    setIsSending(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/cases/${selected.id}/dispatch-communication`, {
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

  return (
    <>
      <header className="details-header">
        <div className="details-header-row-top">
          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <span className="case-id-mono">{selected.case_number}</span>
            <span className="meta-sep" style={{fontSize: '11px'}}>·</span>
            <Badge value={isRecovered ? 'recovered' : isAbandoned ? 'abandoned' : (isHumanReview ? 'human_review' : (isRecovering ? 'recovering' : selected.status))} />
          </div>
        </div>
        <div className="details-header-amount-row">
          <span className="amount-num" style={isRecovered ? {color: 'var(--color-success)'} : isAbandoned ? {color: 'var(--text-primary)'} : undefined}>
            {formatINR(selected.amount)}
          </span>
          <span className="amount-context" style={isRecovered ? {color: 'var(--color-success)', fontWeight: 500} : isAbandoned ? {color: 'var(--text-secondary)', fontWeight: 500} : undefined}>
            {isRecovered ? 'Recovered' : isAbandoned ? 'Unrecovered' : 'At risk'}
          </span>
        </div>
        <div className="details-header-meta">
          <span>{selected.customer_email ?? 'Customer'}</span>
          <span className="meta-sep">·</span>
          <span>{title(selected.payment_method)}</span>
          {explanation?.ml?.recovery_probability != null && (
            <>
              <span className="meta-sep">·</span>
              <span className="meta-prob">{(explanation.ml.recovery_probability * 100).toFixed(0)}% recovery probability</span>
            </>
          )}
          {selected.failure_reason && (
            <>
              <span className="meta-sep">·</span>
              <span className="meta-reason">Decline: {title(selected.failure_reason)}</span>
            </>
          )}
        </div>
      </header>

      <div className="details-grid">
        {/* 2. RECOVERY JOURNEY (Six-stage pipeline) */}
        <DecisionPipeline selected={selected} explanation={explanation} />

        {explanation && (
          <div className="intelligence-panel" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))'}}>
            {/* 3. KEY RECOVERY METRICS */}
            <div className="intelligence-card metrics-compact-card">
              <h4 className="intel-card-title">Key Recovery Metrics</h4>
              <div className="metrics-compact-grid">
                <div className="metric-compact-cell">
                  <div className="metric-compact-header">
                    <span className="metric-compact-icon icon-prob">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
                      </svg>
                    </span>
                    <span className="metric-compact-label">
                      {isAbandoned ? "Predicted Recovery Likelihood" : "ML Recovery Probability"}
                    </span>
                  </div>
                  <div className="metric-compact-val-row">
                    <strong className="metric-compact-val metric-val-accent">
                      {explanation.ml.recovery_probability != null ? (explanation.ml.recovery_probability * 100).toFixed(0) + "%" : "—"}
                    </strong>
                    {explanation.ml.recovery_probability != null && (
                      <span className="prob-pill-indicator" />
                    )}
                  </div>
                </div>

                <div className="metric-compact-cell">
                  <div className="metric-compact-header">
                    <span className="metric-compact-icon icon-tier">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      </svg>
                    </span>
                    <span className="metric-compact-label">Recovery Tier</span>
                  </div>
                  <strong className="metric-compact-val">
                    {mlDecision === 'HIGH' ? 'High Confidence' :
                     mlDecision === 'UNCERTAIN' ? 'Moderate Confidence' :
                     mlDecision === 'COLD_START' ? 'Cold Start' : 'Low Confidence'}
                  </strong>
                </div>

                <div className="metric-compact-cell">
                  <div className="metric-compact-header">
                    <span className="metric-compact-icon icon-comm">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                      </svg>
                    </span>
                    <span className="metric-compact-label">Communication Attempts</span>
                  </div>
                  <strong className="metric-compact-val">
                    {selected.retry_count} of {selected.max_retries}
                  </strong>
                  <span className="metric-compact-sub">Automated outreach</span>
                </div>

                <div className="metric-compact-cell">
                  <div className="metric-compact-header">
                    <span className="metric-compact-icon icon-hist">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 14 14"/>
                      </svg>
                    </span>
                    <span className="metric-compact-label">Customer History</span>
                  </div>
                  <strong className="metric-compact-val">
                    {explanation.customer_history.interaction_count ?? (explanation.customer_history.successful_payments + explanation.customer_history.failed_payments)} transactions
                  </strong>
                  <span className="metric-compact-sub">Maturity profile</span>
                </div>

                <div className="metric-compact-cell">
                  <div className="metric-compact-header">
                    <span className="metric-compact-icon icon-pay">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>
                      </svg>
                    </span>
                    <span className="metric-compact-label">{isAbandoned ? "Recovery Status" : "Payment Attempts"}</span>
                  </div>
                  <strong className="metric-compact-val">
                    {isAbandoned ? "Uncollected" : paymentAttempts.length}
                  </strong>
                  <span className="metric-compact-sub">{isAbandoned ? "Workflow closed" : "Against active link"}</span>
                </div>

                <div className="metric-compact-cell">
                  <div className="metric-compact-header">
                    <span className="metric-compact-icon icon-ltv">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                      </svg>
                    </span>
                    <span className="metric-compact-label">Lifetime Value</span>
                  </div>
                  <strong className="metric-compact-val">
                    {formatINR(explanation.customer_history.lifetime_value)}
                  </strong>
                  <span className="metric-compact-sub">Customer LTV</span>
                </div>
              </div>
            </div>

            {/* 4. COMMUNICATION INTELLIGENCE */}
            {channelIntel && (
              <div className="intelligence-card communication-intelligence-card" style={{gridColumn: '1 / -1'}}>
                <div className="comm-card-header">
                  <div className="comm-profile-compact">
                    <span className={`comm-profile-pill maturity-${channelIntel.communication_maturity.toLowerCase()}`}>
                      <span style={{width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block'}} />
                      {channelIntel.communication_maturity === 'COLD_START' ? 'Cold Start' :
                       channelIntel.communication_maturity === 'LEARNING' ? 'Learning' : 'Established'}
                    </span>
                    <span className="comm-profile-desc">
                      {channelIntel.maturity_description || (isTerminalCase ? (isRecovered ? "Payment recovery completed" : "Recovery communication completed") : "Customer communication profile")}
                    </span>
                  </div>

                  <span className={`channel-status-pill ${isTerminalCase ? (isRecovered ? 'status-completed' : 'status-exhausted') : (isAwaitingResponse ? 'status-awaiting' : `status-${commStatus.toLowerCase()}`)}`}>
                    {isTerminalCase ? (isRecovered ? 'Recovery Completed' : 'Outreach Concluded') : (isAwaitingResponse ? 'Awaiting Customer Response' : commInfo.badge)}
                  </span>
                </div>

                {!isTerminalCase && (
                  <div className="comm-recommendation-block" style={{padding: '16px', background: 'var(--surface)', border: '1px solid var(--border)', borderLeft: '3px solid var(--color-cyan)', borderRadius: '8px'}}>
                    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16}}>
                      <div>
                        <span style={{fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.02em'}}>Recommended Channel</span>
                        <div style={{display: 'flex', alignItems: 'center', gap: 8, marginTop: 4}}>
                          {renderChannelBadge(channelIntel.recommended_channel, 13)}
                          <span style={{fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)'}}>{title(channelIntel.recommended_channel)}</span>
                        </div>
                      </div>
                      <div style={{textAlign: 'right'}}>
                        <div style={{fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums'}}>{(channelIntel.suitability_score * 100).toFixed(0)}%</div>
                        <div style={{fontSize: '11px', color: 'var(--text-secondary)'}}>{title(channelIntel.confidence)} confidence</div>
                      </div>
                    </div>

                    <div style={{fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5, paddingBottom: 16, borderBottom: '1px solid var(--border-subtle)'}}>
                      {channelIntel.reason}
                    </div>

                    {channelIntel.alternatives.length > 0 && (
                      <div style={{marginTop: 16}}>
                        <span style={{fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: '0.02em', display: 'block', marginBottom: 12}}>Alternative Channels</span>
                        <div style={{display: 'flex', flexDirection: 'column', gap: 10}}>
                          {channelIntel.alternatives.map((alt) => {
                            const score = channelIntel.channel_scores[alt] ?? 0;
                            const pct = Math.round(score * 100);
                            const altBarColor = alt === 'whatsapp' ? 'var(--color-success)' : alt === 'sms' ? 'var(--color-primary)' : 'var(--color-purple)';
                            return (
                              <div key={alt} style={{display: 'flex', alignItems: 'center', gap: 12}}>
                                <div style={{width: 90, display: 'flex', alignItems: 'center', gap: 6, fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500}}>
                                  {renderChannelBadge(alt, 11)}
                                  <span>{title(alt)}</span>
                                </div>
                                <div style={{flex: 1, height: 4, background: 'var(--border-subtle)', borderRadius: 2, overflow: 'hidden'}}>
                                  <div style={{height: '100%', background: altBarColor, width: `${pct}%`, borderRadius: 2}} />
                                </div>
                                <div style={{width: 32, textAlign: 'right', fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 600, fontVariantNumeric: 'tabular-nums'}}>
                                  {pct}%
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="comm-journey-block" style={{marginTop: 18}}>
                  <span className="comm-journey-title">Communication Journey</span>
                  <div className="journey-v-timeline">
                    {journey.map((item, idx) => {
                      const isLinkClicked = item.outcome === 'LINK_CLICKED';
                      const isIgnored = item.outcome === 'NO_ENGAGEMENT' || item.outcome === 'IGNORED';
                      const isPaid = item.outcome === 'PAYMENT_COMPLETED';
                      const isAwaiting = item.outcome === 'AWAITING_RESPONSE';
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
                            <span className="journey-v-channel">
                              {renderChannelBadge(item.channel, 12)}
                              <span>{title(item.channel)}{isReminder ? ' Reminder' : ''}</span>
                            </span>
                            <span className={`journey-v-status outcome-${item.outcome.toLowerCase()}`}>
                              {isPaid ? 'Payment Captured' : 
                               isLinkClicked ? 'Payment Link Clicked' : 
                               isAwaiting ? (isTerminalCase ? 'Sent' : 'Awaiting Customer Response') :
                               isIgnored ? 'No Customer Engagement' : 
                               'Delivered'}
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

                    {!isTerminalCase && !isRecoveryClosed && !isAttemptLimitReached && !isAwaitingResponse && channelIntel.followup_decision?.next_action !== 'AWAIT_RESPONSE' && channelIntel.followup_decision?.next_action !== 'STOP_RECOVERY' && (
                      <div className="journey-v-item next-action-item">
                        <div className="journey-v-node-header">
                          <span className="journey-v-dot dot-pending" />
                          <span className="journey-v-title-text" style={{color: 'var(--color-text-main)'}}>Next Action</span>
                        </div>
                        <div 
                          className="journey-compact-card"
                          style={{background: 'var(--color-bg-subtle)'}}
                        >
                          <span className="journey-v-channel">
                            {renderChannelBadge(channelIntel.followup_decision?.selected_channel, 12)}
                            <span>{channelIntel.followup_decision?.selected_channel ? title(channelIntel.followup_decision.selected_channel) : ''}</span>
                          </span>
                          <span className="journey-v-status" style={{background: 'var(--color-card-bg)', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)'}}>
                            Scheduled
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
                <div className="fd-header">
                  <div className="fd-badge" style={{display: 'flex', alignItems: 'center', gap: 6}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                      <path d="M16 21h5v-5"/>
                    </svg>
                    <span>{isTerminalCase ? 'Final Recovery Decision' : 'Next Recovery Decision'}</span>
                  </div>
                </div>

                {isAwaitingResponse && latestPaymentAttempt?.status === 'failed' && (
                  <div style={{background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)', borderRadius: 6, padding: '12px 14px', marginBottom: 14, fontSize: '13px', color: 'var(--color-warning-text)', lineHeight: 1.5}}>
                    <b>Payment activity detected:</b> The customer attempted payment using {latestPaymentAttempt.payment_method ? title(latestPaymentAttempt.payment_method) : 'an online payment method'}, but the transaction failed. This does not consume a communication attempt. RecoverAI will consider this payment intent during the next recovery evaluation.
                  </div>
                )}

                {isTerminalCase ? (
                  <div className="fd-decision-grid" style={{background: 'var(--surface-subtle)', border: '1px solid var(--border)', padding: '16px', borderRadius: '8px', gridTemplateColumns: '1fr 1fr'}}>
                    <div className="fd-item">
                      <span className="fd-label">Final Outcome</span>
                      <strong className="fd-value" style={{color: isRecovered ? 'var(--color-success)' : 'var(--text-secondary)'}}>
                        {isRecovered ? 'Payment Recovered' : 'Payment Not Recovered'}
                      </strong>
                    </div>
                    <div className="fd-item">
                      <span className="fd-label">Attempts Used</span>
                      <strong className="fd-value">
                        {isRecovered ? `${selected.retry_count} of ${selected.max_retries} (Completed)` : `${selected.retry_count} of ${selected.max_retries} (Exhausted)`}
                      </strong>
                    </div>
                    <div className="fd-item">
                      <span className="fd-label">Last Channel</span>
                      <strong className="fd-value">
                        {getLastChannelDisplay()}
                      </strong>
                    </div>
                    <div className="fd-item">
                      <span className="fd-label">Workflow Status</span>
                      <strong className="fd-value" style={{color: isRecovered ? 'var(--color-success)' : 'var(--text-secondary)'}}>
                        {isRecovered ? 'Success' : 'Closed'}
                      </strong>
                    </div>
                  </div>
                ) : (
                  <div className="fd-decision-grid">
                    <div className="fd-item">
                      <span className="fd-label">Previous outcome</span>
                      <strong className="fd-value">
                        {formatPreviousOutcome(channelIntel.followup_decision.previous_outcome, false)}
                      </strong>
                    </div>
                    <div className="fd-item">
                      <span className="fd-label">Recommended action</span>
                      <strong className="fd-value fd-action-val">
                        {formatNextActionLabel(channelIntel.followup_decision.next_action, channelIntel.followup_decision.selected_channel)}
                      </strong>
                    </div>
                    <div className="fd-item">
                      <span className="fd-label">Next channel</span>
                      <strong className="fd-value">
                        {channelIntel.followup_decision.selected_channel ? title(channelIntel.followup_decision.selected_channel) : 'None'}
                      </strong>
                    </div>
                    <div className="fd-item">
                      <span className="fd-label">Scheduled</span>
                      <strong className="fd-value">
                        {formatTiming(channelIntel.followup_decision.recommended_wait_period, channelIntel.followup_decision.next_action)}
                      </strong>
                    </div>
                  </div>
                )}

                {/* Follow-Up Action / Observation Section */}
                {(() => {
                  if (isTerminalCase || isAttemptLimitReached || followupAction === 'STOP_RECOVERY' || isHumanReview) {
                    return null;
                  }

                  if (followupAction === 'AWAIT_RESPONSE' || isAwaitingResponse) {
                    const dynamicChannel = title(
                      latestComm?.channel ||
                      channelIntel?.followup_decision?.selected_channel ||
                      recommendedChannel ||
                      'WhatsApp'
                    );
                    const waitPeriod = channelIntel?.followup_decision?.recommended_wait_period || '24 hours';
                    const remainingCount = Math.max(0, (selected.max_retries || 3) - (selected.retry_count || 0));
                    const remainingText = `${remainingCount} communication attempt${remainingCount === 1 ? '' : 's'} remain${remainingCount === 1 ? 's' : ''}`;

                    return (
                      <div className="fd-observation-panel">
                        <div className="fd-observation-header">
                          <div className="fd-observation-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10"/>
                              <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            <span>Observation Period Active</span>
                          </div>
                          <span className="fd-observation-status-badge">
                            <span className="fd-observation-status-dot" />
                            Awaiting Customer Response
                          </span>
                        </div>

                        <p className="fd-observation-message">
                          {hasClickedLink
                            ? `${dynamicChannel} reminder was sent successfully. RecoverAI is waiting for customer activity during the recommended observation period before deciding whether another recovery attempt is necessary.`
                            : `${dynamicChannel} recovery communication was delivered. RecoverAI is observing customer activity during the recommended observation period before deciding whether another recovery attempt is necessary.`}
                        </p>

                        <div className="fd-observation-meta-grid">
                          <div className="fd-observation-meta-item">
                            <span className="fd-observation-meta-label">Recommended Wait</span>
                            <span className="fd-observation-meta-value">{waitPeriod}</span>
                          </div>
                          <div className="fd-observation-meta-item">
                            <span className="fd-observation-meta-label">Remaining Attempts</span>
                            <span className="fd-observation-meta-value">{remainingText}</span>
                          </div>
                          <div className="fd-observation-meta-item">
                            <span className="fd-observation-meta-label">Current Status</span>
                            <span className="fd-observation-meta-value">Awaiting Customer Response</span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const isSwitchChannel = followupAction === 'SWITCH_CHANNEL';
                  const isRetrySame = followupAction === 'RETRY_SAME_CHANNEL';
                  const isDispatchInitial = followupAction === 'DISPATCH_INITIAL';

                  if (!isSwitchChannel && !isRetrySame && !isDispatchInitial) {
                    return null;
                  }

                  const buttonLabel = isSwitchChannel
                    ? (isRunningNextStep ? 'Simulating Channel Switch...' : 'Simulate Channel Switch')
                    : isDispatchInitial
                    ? (isRunningNextStep ? 'Simulating Dispatch...' : 'Simulate Recovery Dispatch')
                    : (isRunningNextStep ? 'Simulating Next Step...' : 'Simulate Next Recovery Step');

                  return (
                    <div style={{ marginTop: 12 }}>
                      <button
                        className="button primary simulate-step-btn"
                        onClick={handleRunNextStep}
                        disabled={isRunningNextStep}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                        </svg>
                        {isRunningNextStep && <span className="spinner" style={{ marginRight: 6 }} />}
                        <span>{buttonLabel}</span>
                      </button>

                      {statusCheckNotice && (
                        <div
                          className={`fd-status-feedback ${statusCheckNotice.type}`}
                          style={{
                            marginTop: 12,
                            padding: '12px 14px',
                            borderRadius: 6,
                            fontSize: '13px',
                            lineHeight: 1.5,
                            border: statusCheckNotice.type === 'error'
                              ? '1px solid #FCA5A5'
                              : statusCheckNotice.type === 'success'
                              ? '1px solid #A7F3D0'
                              : '1px solid #BFDBFE',
                            background: statusCheckNotice.type === 'error'
                              ? '#FEF2F2'
                              : statusCheckNotice.type === 'success'
                              ? '#ECFDF5'
                              : '#EFF6FF',
                            color: statusCheckNotice.type === 'error'
                              ? '#991B1B'
                              : statusCheckNotice.type === 'success'
                              ? '#065F46'
                              : '#1E40AF',
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10,
                          }}
                        >
                          <div style={{ marginTop: 2, flexShrink: 0 }}>
                            {statusCheckNotice.type === 'error' ? (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="8" x2="12" y2="12" />
                                <line x1="12" y1="16" x2="12.01" y2="16" />
                              </svg>
                            ) : (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 700, marginBottom: 2 }}>{statusCheckNotice.title}</div>
                            <div>{statusCheckNotice.message}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setStatusCheckNotice(null)}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              color: 'currentColor',
                              opacity: 0.6,
                              padding: 2,
                              fontSize: '16px',
                              lineHeight: 1,
                            }}
                            aria-label="Dismiss notice"
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* 6. AI ADVISOR */}
        {explanation?.ai && <AIAdvisorCard explanation={explanation} caseStatus={selected.status} />}

        {/* 7. PAYMENT RECOVERY ACTION */}
        {isRecovered ? (
          <div className="payment-recovery-card terminal-banner terminal-recovered">
            <div style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14}}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16A34A" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <h3 style={{margin: 0, color: 'var(--color-success-text)', fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em'}}>
                Payment Successfully Recovered
              </h3>
            </div>
            <div style={{marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 4}}>
              <div style={{fontSize: '28px', fontWeight: 700, color: 'var(--color-success-text)', letterSpacing: '-0.02em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums'}}>
                {formatINR(selected.amount)}
              </div>
              <div style={{fontSize: '13px', fontWeight: 500, color: 'var(--color-success-text)'}}>
                Recovered successfully
              </div>
            </div>

            <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
              <div style={{fontSize: '11px', color: 'var(--color-success-text)', fontWeight: 600, letterSpacing: '0.02em'}}>
                Recovery attributed to
              </div>
              <div>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontWeight: 600,
                  color: 'var(--color-success-text)',
                  background: 'var(--surface)',
                  border: '1px solid var(--color-success-border)',
                  padding: '3px 10px',
                  borderRadius: 4,
                  fontSize: '12px'
                }}>
                  {renderChannelIcon(channelIntel?.attributed_channel, 13)}
                  {channelIntel?.attributed_channel ? title(channelIntel.attributed_channel) : 'Verified Channel'}
                </span>
              </div>
            </div>
          </div>
        ) : canApproveRecovery ? (
          <div className="action-panel" style={{background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12}}>
            <div className="action-info">
              <span style={{color: '#92400E', fontWeight: 600, fontSize: '13px', display: 'flex', alignItems: 'center', gap: 6}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                Human Review Required — Automatic recovery was paused by safety policy.
              </span>
            </div>
            <div className="action-buttons">
              <button id="approve-recovery-btn" className="button primary" onClick={() => void execute()} disabled={actionLoading !== null} style={{background: '#D97706', color: '#FFFFFF', fontWeight: 700}}>
                {actionLoading === 'execute' ? <span className="spinner"/> : null}
                Approve Recovery
              </button>
            </div>
          </div>
        ) : isAbandoned ? (
          <div className="payment-recovery-card terminal-closure-card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="closure-icon-wrap">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </span>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600, letterSpacing: '-0.01em' }}>
                    Recovery Closed
                  </h3>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: 2 }}>
                    Workflow ended without recovery
                  </div>
                </div>
              </div>
              <Badge value="abandoned" label="Closed" />
            </div>

            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 16px 0' }}>
              All permitted recovery communications were completed without successful payment recovery. No further automated outreach is scheduled.
            </p>

            <div className="closure-meta-grid">
              <div className="closure-meta-item">
                <span className="closure-meta-label">Unrecovered Amount</span>
                <span className="closure-meta-val" style={{ color: 'var(--text-primary)' }}>
                  {formatINR(selected.amount)}
                </span>
              </div>
              <div className="closure-meta-item">
                <span className="closure-meta-label">Outreach Attempts</span>
                <span className="closure-meta-val">
                  {selected.retry_count} of {selected.max_retries} delivered
                </span>
              </div>
              <div className="closure-meta-item">
                <span className="closure-meta-label">Last Channel Used</span>
                <span className="closure-meta-val">
                  {getLastChannelDisplay()}
                </span>
              </div>
              <div className="closure-meta-item">
                <span className="closure-meta-label">Closure Reason</span>
                <span className="closure-meta-val">
                  Max outreach limit reached
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="payment-recovery-card">
            <div className="pr-header">
              <h3>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
                Payment Recovery
              </h3>
              <span className={`pr-status-badge ${isLinkExpired ? 'expired' : currentLink ? 'active' : 'pending'}`}>
                {isLinkExpired ? 'Expired Payment Link' : currentLink ? 'Active Payment Link' : 'Not Generated'}
              </span>
            </div>

            <div className="pr-body-grid">
              <div className="pr-info-col">
                <div className="pr-meta-item">
                  <span className="pr-label">Recovery Method</span>
                  <b className="pr-meta-value">{executionMode}</b>
                </div>
                {expiresAt && formattedExpiry ? (
                  <div className="pr-meta-item">
                    <span className="pr-label">Expires</span>
                    <b className="pr-meta-value">
                      {formattedExpiry}
                      {isLinkExpired ? ' (Expired)' : ''}
                    </b>
                  </div>
                ) : null}
              </div>

              <div className="pr-actions-col">
                {currentLink && !isLinkExpired && (
                  <div className="pr-link-buttons">
                    <a
                      id="open-payment-page-btn"
                      className="button primary"
                      href={currentLink.startsWith("http") ? currentLink : `/simulate-payment/${selected.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={handleOpenPaymentLink}
                    >
                      Open Payment Page ↗
                    </a>
                    <button
                      id="copy-payment-link-btn"
                      className="button secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        void navigator.clipboard.writeText(String(currentLink));
                        setNotice("Payment link copied to clipboard!");
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                    >
                      {copied ? "Link Copied" : "Copy Link"}
                    </button>
                  </div>
                )}
                {isLinkExpired && (
                  <div style={{color: 'var(--color-danger-text)', fontSize: '13px', fontWeight: 500, padding: '8px 12px', background: 'var(--color-danger-bg)', borderRadius: 6, border: '1px solid var(--color-danger-border)'}}>
                    Payment link has expired. Regenerating a new link is recommended.
                  </div>
                )}
              </div>
            </div>

            <div className="pr-comm-section">
              <div className="comm-preview-panel">
                <div className="comm-preview-panel-header">
                  <div className="comm-preview-ch-wrap">
                    {renderChannelIcon(effectiveCommChannel, 14)}
                    <span className="comm-preview-ch-name">{title(effectiveCommChannel)}</span>
                  </div>
                  <span className="comm-preview-status-tag">
                    <span className="dot dot-success" /> Delivered
                  </span>
                </div>
                <div className="comm-preview-bubble-card">
                  <div className="comm-bubble-sender">RecoverAI</div>
                  <p className="comm-bubble-body">
                    Your payment of <b>{formatINR(selected.amount)}</b> could not be completed. Complete your payment securely using the link below.
                  </p>
                  {currentLink && !isLinkExpired && (
                    <div className="comm-bubble-action">
                      <button
                        className="comm-bubble-pay-btn"
                        onClick={handlePaymentClick}
                      >
                        Complete Payment →
                      </button>
                    </div>
                  )}
                </div>
                {availableCommunications.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      id="view-comm-panel-btn"
                      className="button secondary button-sm comm-action-btn"
                      onClick={() => openCommunicationModal()}
                    >
                      {availableCommunications.length === 1
                        ? `View ${title(availableCommunications[0].channel)} Message`
                        : 'View Communications'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CUSTOMER OUTCOME */}
        <div className="intelligence-card customer-outcome-card">
          <h4>Customer Outcome</h4>
          <div className="co-body" style={{marginTop: 8}}>
            {isRecovered ? (
              <div className="outcome-banner outcome-banner-recovered">
                <Badge value="recovered" label="Payment Recovered" />
                <p style={{margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5}}>
                  The customer successfully completed payment via the recovery link.
                </p>
              </div>
            ) : isAbandoned ? (
              <div className="outcome-banner outcome-banner-closed">
                <Badge value="abandoned" label="Uncollected" />
                <p style={{margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5}}>
                  Final transaction status remains uncollected. No customer payment was completed against the recovery link before the workflow was closed.
                </p>
              </div>
            ) : selected.last_payment_status === 'FAILED' ? (
              <div className="outcome-banner outcome-banner-failed">
                <Badge value="failed" label="Recovery Payment Attempt Failed" />
                <p style={{margin: '8px 0 4px 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5}}>
                  The customer attempted to complete the payment using <b>{(latestPaymentAttempt?.payment_method || selected.last_payment_method) ? title(latestPaymentAttempt?.payment_method || selected.last_payment_method!) : 'an online payment method'}</b>, but the transaction was unsuccessful. RecoverAI is continuing to evaluate the customer's recovery activity.
                </p>
                {selected.last_payment_attempt_at && (
                  <span style={{fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500}}>Last Attempt: {formatDate(selected.last_payment_attempt_at)}</span>
                )}
              </div>
            ) : isHumanReview ? (
              <div className="outcome-banner outcome-banner-review">
                <Badge value="human-review" label="Awaiting Review" />
                <p style={{margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5}}>
                  Recovery execution paused pending manual reviewer approval.
                </p>
              </div>
            ) : !isTerminalCase && hasClickedLink ? (
              <div className="outcome-banner outcome-banner-recovering">
                <Badge value="recovering" label="Payment Page Opened — Payment Pending" />
                <p style={{margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5}}>
                  The customer opened the recovery payment page through the initial outreach link. Checkout submission has not yet occurred, and no payment gateway attempts have been recorded yet.
                </p>
              </div>
            ) : !isTerminalCase && (isAwaitingResponse || channelIntel?.followup_decision?.next_action === 'AWAIT_RESPONSE') ? (
              <div className="outcome-banner outcome-banner-recovering">
                <Badge value="recovering" label="Customer Response Pending" />
                <p style={{margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5}}>
                  {(() => {
                    const reminderCh = channelIntel?.followup_decision?.selected_channel || latestComm?.channel;
                    const reminderChText = reminderCh ? `${title(reminderCh)} ` : '';
                    return `A ${reminderChText}recovery reminder has been delivered. RecoverAI is waiting for customer activity before determining the next recovery action.`;
                  })()}
                </p>
              </div>
            ) : !isTerminalCase && isRecovering ? (
              <div className="outcome-banner outcome-banner-recovering">
                <Badge value="recovering" label="Payment Pending" />
                <p style={{margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5}}>
                  Payment link is active and the system is waiting for customer checkout activity.
                </p>
              </div>
            ) : (
              <div className="outcome-banner outcome-banner-review">
                <Badge value="human-review" label="Awaiting Review" />
                <p style={{margin: '8px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.5}}>
                  Recovery execution paused pending manual reviewer approval.
                </p>
              </div>
            )}
            
            {(paymentAttempts.length > 0 || isRecovered) && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500 }}>Recovery payment attempts</span>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {paymentAttempts.length}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* LATEST RECOVERY PAYMENT ACTIVITY */}
        {latestPaymentAttempt && (
          <div className="intelligence-card latest-payment-activity-card" style={{marginTop: 14}}>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12}}>
              <h4 style={{margin: 0, fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600, letterSpacing: '-0.01em', display: 'flex', alignItems: 'center', gap: 6}}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                Latest Recovery Payment Activity
              </h4>
              <Badge
                value={latestPaymentAttempt.status === 'success' ? 'recovered' : 'failed'}
                label={latestPaymentAttempt.status === 'success' ? 'Payment Successful' : 'Payment Failed'}
              />
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
              gap: 12,
              background: 'var(--surface-subtle)',
              border: '1px solid var(--border)',
              padding: '12px 16px',
              borderRadius: 6
            }}>
              <div>
                <span style={{display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500}}>Recovery Method</span>
                <strong style={{fontSize: '13px', color: 'var(--text-primary)', fontWeight: 600}}>{title(latestPaymentAttempt.payment_method)}</strong>
              </div>
              <div>
                <span style={{display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500}}>Attempt Amount</span>
                <strong style={{fontSize: '13px', color: 'var(--color-success)', fontWeight: 600}}>{formatINR(latestPaymentAttempt.amount)}</strong>
              </div>
              <div>
                <span style={{display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500}}>Attempt Status</span>
                <strong style={{fontSize: '13px', color: latestPaymentAttempt.status === 'success' ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600}}>
                  {title(latestPaymentAttempt.status)}
                </strong>
              </div>
              <div>
                <span style={{display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500}}>Attempt Time</span>
                <span style={{fontSize: '13px', color: 'var(--text-secondary)', fontWeight: 500}}>
                  {formatDate(latestPaymentAttempt.created_at)}
                </span>
              </div>
              {latestPaymentAttempt.status !== 'success' && (
                <div>
                  <span style={{display: 'block', fontSize: '11px', color: 'var(--text-tertiary)', fontWeight: 500}}>Failure Reason</span>
                  <strong style={{fontSize: '13px', color: 'var(--color-danger)', fontWeight: 600}}>
                    {latestPaymentAttempt.failure_reason || selected.last_payment_failure_reason || 'Payment declined'}
                  </strong>
                </div>
              )}
            </div>

            <p style={{margin: '12px 0 0 0', color: 'var(--text-secondary)', fontSize: '13px', fontWeight: 400, lineHeight: 1.5}}>
              {latestPaymentAttempt.status === 'success'
                ? `The customer completed payment of ${formatINR(latestPaymentAttempt.amount)} using ${title(latestPaymentAttempt.payment_method)} through the recovery payment link. The recovery workflow has been automatically completed.`
                : `The customer attempted payment using ${title(latestPaymentAttempt.payment_method)} through the recovery payment link, but the recovery payment was not completed${latestPaymentAttempt.failure_reason ? `: ${latestPaymentAttempt.failure_reason}` : '.'}`}
            </p>

            {/* Multiple Payment Attempts Chronological History */}
            {paymentAttempts.length > 1 && (
              <div style={{marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 12}}>
                <div style={{fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8}}>
                  Previous Payment Attempts ({paymentAttempts.length - 1})
                </div>
                <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                  {paymentAttempts.slice(1).map((att, idx) => (
                    <div key={att.id || idx} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: 'var(--surface-subtle)',
                      border: '1px solid var(--border)',
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: '13px'
                    }}>
                      <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                        <span style={{color: att.status === 'success' ? 'var(--color-success)' : 'var(--color-danger)', display: 'inline-flex', alignItems: 'center'}}>
                          {att.status === 'success' ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          )}
                        </span>
                        <span style={{fontWeight: 600, color: 'var(--text-primary)'}}>Attempt #{paymentAttempts.length - 1 - idx}: {title(att.payment_method)}</span>
                        <span style={{color: 'var(--text-secondary)'}}>({formatINR(att.amount)})</span>
                        {att.failure_reason && (
                          <span style={{color: 'var(--color-danger)', fontSize: '12px'}}>• {att.failure_reason}</span>
                        )}
                      </div>
                      <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                        <Badge
                          value={att.status === 'success' ? 'recovered' : 'failed'}
                          label={title(att.status)}
                        />
                        <span style={{color: 'var(--text-tertiary)', fontSize: '11px'}}>{formatDate(att.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
              <button className="comm-modal-close" onClick={() => setShowCommModal(false)} aria-label="Close modal">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            {/* Dynamic Channel Tabs / Selector */}
            <div className="comm-modal-tabs">
              {availableCommunications.map((comm) => {
                const isActive = selectedCommId ? comm.id === selectedCommId : comm.id === availableCommunications[0]?.id;
                const isReminder = comm.attempt > 1 && comm.channel === availableCommunications[0]?.channel;
                return (
                  <button
                    key={comm.id}
                    className={`comm-modal-tab ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedCommId(comm.id);
                      setActiveCommTab(comm.channel);
                    }}
                    style={{display: 'inline-flex', alignItems: 'center', gap: 6}}
                  >
                    {renderChannelIcon(comm.channel)}
                    <span>{title(comm.channel)}{isReminder ? ' Reminder' : ''} • {comm.isPrepared ? 'Prepared' : `Attempt ${comm.attempt}`}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab Contents */}
            <div className="comm-modal-content">
              {/* Payment Completed Attribution banner */}
              {isRecovered && (
                <div style={{
                  background: '#ECFDF5', border: '1px solid #A7F3D0', color: '#065F46',
                  padding: '10px 16px', borderRadius: 6, marginBottom: 16, fontSize: '0.88rem', fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  Payment completed after this communication.
                </div>
              )}

              {/* TAB 1: EMAIL */}
              {activeCommTab === 'email' && (
                <div className="email-tab-container" style={{width: '100%', maxWidth: 500, margin: '0 auto'}}>
                  {/* Prepared vs Sent Status Banner */}
                  {(selectedComm?.isPrepared || (commStatus === 'READY' && !actualComms.some(c => c.channel === 'email' && !c.isPrepared))) ? (
                    <div className="email-status-banner prepared" style={{
                      background: '#FFFBEB',
                      border: '1px solid #FDE68A',
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
                        <div style={{fontWeight: 700, fontSize: '0.85rem', color: '#B45309', display: 'flex', alignItems: 'center', gap: 6}}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>
                          Communication Prepared
                        </div>
                        <div style={{fontSize: '0.82rem', color: '#475569', marginTop: 2}}>
                          This email is ready for review and has not been sent to the customer.
                        </div>
                      </div>
                      <button
                        className="button primary"
                        style={{background: 'var(--color-primary)', padding: '6px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap'}}
                        onClick={() => void handleSimulateDispatch('email')}
                        disabled={isSending}
                      >
                        {isSending ? "Dispatching..." : "Simulate Sending"}
                      </button>
                    </div>
                  ) : (
                    <div className="email-status-banner simulated" style={{
                      background: '#ECFDF5',
                      border: '1px solid #A7F3D0',
                      borderRadius: 8,
                      padding: '8px 14px',
                      marginBottom: 16,
                      color: '#065F46',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                      Email Simulated
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
                      <span className="phone-icons" style={{display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem'}}>
                        <span>5G</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="7" width="16" height="10" rx="2"/><line x1="20" y1="11" x2="20" y2="13" stroke="currentColor" strokeWidth="2"/></svg>
                      </span>
                    </div>
                    <div className="sms-chat-header">
                      <span className="sms-back">‹ Back</span>
                      <div className="sms-contact-name">
                        <strong>RecoverAI</strong>
                        <span className="sms-sub">Transactional Alert</span>
                      </div>
                      <span className="sms-info" style={{display: 'inline-flex', alignItems: 'center'}}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                      </span>
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
                          RecoverAI 
                          <span className="wa-verified-badge" style={{display: 'inline-flex', alignItems: 'center', color: '#4ade80'}} title="Verified Business">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 2.4 3.4-.4 1.1 3.2 2.9 1.8-1 3.2 1.8 2.9-2.3 2.5.3 3.4-3.3 1.2-1.9 2.8-3.1-.9-3.1.9-1.9-2.8-3.3-1.2.3-3.4-2.3-2.5 1.8-2.9-1-3.2 2.9-1.8 1.1-3.2 3.4.4L12 2z"/><polyline points="8 12 11 15 16 9" stroke="#075e54" strokeWidth="2" fill="none"/></svg>
                          </span>
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
                          Complete Payment →
                        </button>
                        <div className="wa-footer-msg" style={{marginTop: 12, fontSize: '0.78rem', color: '#667781', lineHeight: 1.4}}>
                          This payment link expires on<br />
                          <b>{formattedExpiry}</b>
                        </div>
                        <div className="wa-bubble-time" style={{textAlign: 'right', fontSize: '0.68rem', color: '#667781', marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 3}}>
                          09:41 
                          <span className="wa-receipts" style={{color: '#53bdeb', display: 'inline-flex', alignItems: 'center'}}>
                            <svg width="14" height="10" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 7 4 10 11 3"/><polyline points="5 7 8 10 15 3"/></svg>
                          </span>
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

