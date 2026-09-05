import React from 'react';
import { RecoveryCase, Explanation, title } from '../types';

interface DecisionPipelineProps {
  selected: RecoveryCase;
  explanation: Explanation | null;
}

export function DecisionPipeline({ selected, explanation }: DecisionPipelineProps) {
  const prob = explanation?.ml?.recovery_probability;
  const probStr = prob != null ? `${(prob * 100).toFixed(0)}%` : null;

  const isRecovered = selected.status === 'recovered';
  const isAbandoned = selected.status === 'abandoned' || selected.status === 'closed';
  const isRecoveryClosed = isAbandoned;
  const isRecovering = selected.status === 'recovering';

  // Derived / backend workflow states
  const humanStatus = explanation?.human_review_status ?? (explanation?.manual_execution ? 'APPROVED' : (explanation?.policy?.requires_human_approval && !explanation?.policy?.allowed) ? 'REQUIRED' : 'NOT_REQUIRED');
  const isHumanReview = (selected.status === 'human_review' || humanStatus === 'REQUIRED') && humanStatus !== 'APPROVED';
  const payLinkStatus = explanation?.payment_link_status ?? (isRecovered ? 'PAID' : isRecovering ? 'ACTIVE' : isRecoveryClosed ? 'EXPIRED' : 'NONE');
  const custPayStatus = explanation?.customer_payment_status ?? (isRecovered ? 'RECEIVED' : isRecoveryClosed ? 'EXHAUSTED' : isRecovering ? 'PENDING' : 'NONE');
  const commStatus = explanation?.communication_status ?? 'PAUSED';

  // Policy step state
  const policyDone = explanation?.policy != null;
  const policyAllowed = explanation?.policy?.allowed ?? false;

  // ML step label
  const mlConfidence = prob != null ? (prob >= 0.75 ? 'High' : prob >= 0.40 ? 'Moderate' : 'Low') : 'High';
  const mlLabel = probStr ? `${probStr} • ${mlConfidence}` : 'Completed';

  // Stage 3 Policy label
  const policyLabel = humanStatus === 'APPROVED'
    ? 'Human Approved'
    : (humanStatus === 'REQUIRED' || (!policyAllowed && policyDone))
    ? 'Human Review Required'
    : 'Policy Approved';

  // Stage 4 Recovery Action label
  let recoveryLabel = 'Pending Execution';
  if (isRecovered) {
    recoveryLabel = 'Recovery Completed';
  } else if (isAbandoned || isRecoveryClosed) {
    recoveryLabel = 'Recovery Action Stopped';
  } else if (isHumanReview) {
    recoveryLabel = 'Awaiting Approval';
  } else if (humanStatus === 'APPROVED' || explanation?.manual_execution) {
    recoveryLabel = 'Human Approved Recovery';
  } else if (isRecovering || payLinkStatus === 'ACTIVE') {
    recoveryLabel = 'Automatic Recovery';
  } else {
    recoveryLabel = 'Pending Execution';
  }

  const followupAction = explanation?.channel_intelligence?.followup_decision?.next_action;
  const followupOutcome = explanation?.channel_intelligence?.followup_decision?.previous_outcome;
  const isAwaitingResponse = !isRecovered && !isRecoveryClosed && (
    followupAction === 'AWAIT_RESPONSE' ||
    followupOutcome === 'AWAITING_RESPONSE'
  );

  // Stage 5 Communication label
  const rawChannel = explanation?.dispatched_channel || explanation?.recommended_channel;
  const chName = rawChannel ? title(rawChannel) : 'Communication';
  let commLabel = 'Communication Ready';
  if (isRecovered) {
    commLabel = 'Communication Completed';
  } else if (isAbandoned || isRecoveryClosed) {
    commLabel = 'Communication Complete';
  } else if (isHumanReview || commStatus === 'PAUSED') {
    commLabel = 'Communication Paused';
  } else if (isAwaitingResponse) {
    commLabel = 'Awaiting Customer Response';
  } else if (commStatus === 'READY') {
    commLabel = `${chName} Ready`;
  } else if (commStatus === 'GENERATED') {
    commLabel = `${chName} Generated`;
  } else if (commStatus === 'SIMULATED') {
    commLabel = `${chName} Simulated`;
  } else if (commStatus === 'SENT') {
    commLabel = `${chName} Sent`;
  }

  const hasClickedLink = explanation?.channel_intelligence?.communication_journey?.some(
    r => r.outcome === 'LINK_CLICKED' || r.outcome === 'CLICKED'
  );

  // Stage 6 Customer Outcome label
  let outcomeLabel = 'Awaiting Payment';
  if (isRecovered) {
    outcomeLabel = 'Payment Recovered';
  } else if (isAbandoned || isRecoveryClosed) {
    outcomeLabel = 'Recovery Closed';
  } else if (isHumanReview) {
    outcomeLabel = 'Awaiting Review';
  } else if (custPayStatus === 'FAILED') {
    outcomeLabel = 'Attempt Failed';
  } else if (hasClickedLink && (custPayStatus === 'PENDING' || isRecovering)) {
    outcomeLabel = 'Payment Page Opened — Payment Pending';
  } else if (custPayStatus === 'PENDING' || isRecovering) {
    outcomeLabel = 'Payment Pending';
  }

  const renderCheckIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  );

  const renderAlertIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
  );

  const renderClockIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <polyline points="12 6 12 12 16 14"/>
    </svg>
  );

  const renderMailIcon = () => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  );

  const renderStopIcon = () => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
    </svg>
  );

  const renderCrossIcon = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );

  const renderDotIcon = () => (
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
  );

  return (
    <div className="decision-pipeline">
      <div className="pipeline-track" />

      {/* Stage 1: PAYMENT FAILED */}
      <div className="pipeline-step completed">
        <div className="step-icon">{renderCheckIcon()}</div>
        <div className="step-content">
          <div className="step-title">1. Payment Failed</div>
          <div className="step-meta">{title(selected.failure_reason || 'Transaction Failed')}{selected.payment_method ? ` • ${title(selected.payment_method)}` : ''}</div>
        </div>
      </div>

      {/* Stage 2: ML PREDICTION */}
      <div className={`pipeline-step ${explanation?.ml ? 'completed' : 'active'}`}>
        <div className="step-icon">{explanation?.ml ? renderCheckIcon() : renderDotIcon()}</div>
        <div className="step-content">
          <div className="step-title">2. ML Prediction</div>
          <div className="step-meta">{mlLabel}</div>
        </div>
      </div>

      {/* Stage 3: POLICY DECISION */}
      <div className={`pipeline-step ${humanStatus === 'APPROVED' || policyAllowed ? 'completed' : 'warning'}`}>
        <div className="step-icon">{humanStatus === 'APPROVED' || policyAllowed ? renderCheckIcon() : renderAlertIcon()}</div>
        <div className="step-content">
          <div className="step-title">3. Policy Decision</div>
          <div className="step-meta">{policyLabel}</div>
        </div>
      </div>

      {/* Stage 4: RECOVERY ACTION */}
      <div className={`pipeline-step ${isRecovered ? 'completed' : (isAbandoned || isRecoveryClosed) ? 'blocked' : isHumanReview ? 'warning' : (humanStatus === 'APPROVED' || explanation?.manual_execution || isRecovering || payLinkStatus === 'ACTIVE') ? 'completed' : 'active'}`}>
        <div className="step-icon">
          {isRecovered ? renderCheckIcon() :
           (isAbandoned || isRecoveryClosed) ? renderStopIcon() :
           isHumanReview ? renderClockIcon() :
           (humanStatus === 'APPROVED' || explanation?.manual_execution || isRecovering || payLinkStatus === 'ACTIVE') ? renderCheckIcon() :
           renderDotIcon()}
        </div>
        <div className="step-content">
          <div className="step-title">4. Recovery Action</div>
          <div className="step-meta">{recoveryLabel}</div>
        </div>
      </div>

      {/* Stage 5: COMMUNICATION */}
      <div className={`pipeline-step ${isRecovered ? 'completed' : (isAbandoned || isRecoveryClosed) ? 'blocked' : (isHumanReview || commStatus === 'PAUSED') ? 'warning' : (commStatus === 'SENT' || commStatus === 'SIMULATED' || isAwaitingResponse) ? 'completed' : 'active'}`}>
        <div className="step-icon">
          {isRecovered ? renderCheckIcon() :
           (isAbandoned || isRecoveryClosed) ? renderStopIcon() :
           (isHumanReview || commStatus === 'PAUSED') ? renderClockIcon() :
           (commStatus === 'SENT' || commStatus === 'SIMULATED' || isAwaitingResponse) ? renderCheckIcon() :
           (commStatus === 'READY' || commStatus === 'GENERATED') ? renderMailIcon() : renderDotIcon()}
        </div>
        <div className="step-content">
          <div className="step-title">5. Communication</div>
          <div className="step-meta">{commLabel}</div>
        </div>
      </div>

      {/* Stage 6: CUSTOMER OUTCOME */}
      <div className={`pipeline-step ${isRecovered ? 'completed' : (isAbandoned || isRecoveryClosed) ? 'blocked' : isHumanReview ? 'warning' : custPayStatus === 'FAILED' ? 'warning' : (custPayStatus === 'PENDING' || isRecovering) ? 'active' : ''}`}>
        <div className="step-icon">
          {isRecovered ? renderCheckIcon() :
           (isAbandoned || isRecoveryClosed) ? renderStopIcon() :
           isHumanReview ? renderClockIcon() :
           custPayStatus === 'FAILED' ? renderCrossIcon() : renderDotIcon()}
        </div>
        <div className="step-content">
          <div className="step-title">6. Customer Outcome</div>
          <div className="step-meta">{outcomeLabel}</div>
        </div>
      </div>
    </div>
  );
}


