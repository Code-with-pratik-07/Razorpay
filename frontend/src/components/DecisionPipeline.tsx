import React from 'react';
import { RecoveryCase, Explanation, title } from '../types';

interface DecisionPipelineProps {
  selected: RecoveryCase;
  explanation: Explanation | null;
}

export function DecisionPipeline({ selected, explanation }: DecisionPipelineProps) {
  const prob = explanation?.ml?.recovery_probability;
  const probStr = prob != null ? `${(prob * 100).toFixed(0)}%` : null;

  const isAttemptLimitReached = selected.retry_count >= selected.max_retries;
  const followupAction = explanation?.channel_intelligence?.followup_decision?.next_action;
  const followupOutcome = explanation?.channel_intelligence?.followup_decision?.previous_outcome;
  const isRecoveryClosed = selected.status === 'abandoned' || selected.status === 'closed' || isAttemptLimitReached || followupAction === 'STOP_RECOVERY';
  const isAbandoned = isRecoveryClosed;
  const isRecovered = selected.status === 'recovered';
  const isRecovering = !isRecoveryClosed && !isRecovered && (
    selected.status === 'recovering' ||
    explanation?.payment_link_status === 'ACTIVE' ||
    (selected.retry_count > 0) ||
    explanation?.human_review_status === 'APPROVED'
  );

  // Derived / backend workflow states
  const humanStatus = explanation?.human_review_status ?? (explanation?.manual_execution ? 'APPROVED' : (explanation?.policy?.requires_human_approval && !explanation?.policy?.allowed) ? 'REQUIRED' : 'NOT_REQUIRED');
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
  let recoveryLabel = 'Pending';
  if (humanStatus === 'APPROVED' || explanation?.manual_execution) {
    recoveryLabel = 'Manual Recovery';
  } else if (isRecovered || isRecovering || payLinkStatus === 'ACTIVE') {
    recoveryLabel = 'Automatic Recovery';
  } else if (humanStatus === 'REQUIRED') {
    recoveryLabel = 'Awaiting Approval';
  } else if (isRecoveryClosed) {
    recoveryLabel = 'No Action';
  }

  const isAwaitingResponse = !isRecovered && !isRecoveryClosed && (
    followupAction === 'AWAIT_RESPONSE' ||
    followupOutcome === 'AWAITING_RESPONSE'
  );

  // Stage 5 Communication label
  const chName = title(explanation?.dispatched_channel || explanation?.recommended_channel || 'Email');
  let commLabel = 'Communication Ready';
  if (isRecovered) {
    commLabel = `${title(explanation?.channel_intelligence?.attributed_channel || 'SMS')} Sent`;
  } else if (isRecoveryClosed) {
    commLabel = 'Communication Closed';
  } else if (isAwaitingResponse) {
    commLabel = 'Awaiting Customer Response';
  } else if (commStatus === 'PAUSED' || humanStatus === 'REQUIRED') {
    commLabel = 'Communication Paused';
  } else if (commStatus === 'READY') {
    commLabel = `${chName} Ready`;
  } else if (commStatus === 'GENERATED') {
    commLabel = `${chName} Generated`;
  } else if (commStatus === 'SIMULATED') {
    commLabel = `${chName} Simulated`;
  } else if (commStatus === 'SENT') {
    commLabel = `${chName} Sent`;
  }

  // Stage 6 Customer Outcome label
  let outcomeLabel = 'Awaiting Payment';
  if (isRecovered) {
    outcomeLabel = 'Payment Recovered';
  } else if (isAbandoned) {
    outcomeLabel = 'Recovery Closed';
  } else if (custPayStatus === 'FAILED') {
    outcomeLabel = 'Attempt Failed';
  } else if (custPayStatus === 'PENDING' || isRecovering) {
    outcomeLabel = 'Payment Pending';
  }

  return (
    <div className="decision-pipeline">
      <div className="pipeline-track" />

      {/* Stage 1: PAYMENT FAILED */}
      <div className="pipeline-step completed">
        <div className="step-icon">✓</div>
        <div className="step-content">
          <div className="step-title">1. PAYMENT FAILED</div>
          <div className="step-meta">{title(selected.failure_reason || 'Transaction Failed')}{selected.payment_method ? ` • ${title(selected.payment_method)}` : ''}</div>
        </div>
      </div>

      {/* Stage 2: ML PREDICTION */}
      <div className={`pipeline-step ${explanation?.ml ? 'completed' : 'active'}`}>
        <div className="step-icon">{explanation?.ml ? '✓' : '•'}</div>
        <div className="step-content">
          <div className="step-title">2. ML PREDICTION</div>
          <div className="step-meta">{mlLabel}</div>
        </div>
      </div>

      {/* Stage 3: POLICY DECISION */}
      <div className={`pipeline-step ${humanStatus === 'APPROVED' || policyAllowed ? 'completed' : 'warning'}`}>
        <div className="step-icon">{humanStatus === 'APPROVED' || policyAllowed ? '✓' : '!'}</div>
        <div className="step-content">
          <div className="step-title">3. POLICY DECISION</div>
          <div className="step-meta">{policyLabel}</div>
        </div>
      </div>

      {/* Stage 4: RECOVERY ACTION */}
      <div className={`pipeline-step ${isRecovered || isRecovering || payLinkStatus === 'ACTIVE' ? 'completed' : isAbandoned ? 'blocked' : humanStatus === 'REQUIRED' ? 'warning' : 'active'}`}>
        <div className="step-icon">{isRecovered || isRecovering || payLinkStatus === 'ACTIVE' ? '✓' : isAbandoned ? '■' : humanStatus === 'REQUIRED' ? '⏳' : '•'}</div>
        <div className="step-content">
          <div className="step-title">4. RECOVERY ACTION</div>
          <div className="step-meta">{recoveryLabel}</div>
        </div>
      </div>

      {/* Stage 5: COMMUNICATION */}
      <div className={`pipeline-step ${commStatus === 'SENT' || commStatus === 'SIMULATED' || commStatus === 'GENERATED' || isAwaitingResponse || isRecovered ? 'completed' : commStatus === 'READY' ? 'active' : commStatus === 'PAUSED' ? 'warning' : 'active'}`}>
        <div className="step-icon">{commStatus === 'SENT' || commStatus === 'SIMULATED' || isAwaitingResponse || isRecovered ? '✓' : commStatus === 'READY' || commStatus === 'GENERATED' ? '✉️' : commStatus === 'PAUSED' ? '⏳' : '•'}</div>
        <div className="step-content">
          <div className="step-title">5. COMMUNICATION</div>
          <div className="step-meta">{commLabel}</div>
        </div>
      </div>

      {/* Stage 6: CUSTOMER OUTCOME */}
      <div className={`pipeline-step ${isRecovered ? 'completed' : isAbandoned ? 'blocked' : custPayStatus === 'FAILED' ? 'warning' : custPayStatus === 'PENDING' || isRecovering ? 'active' : ''}`}>
        <div className="step-icon">{isRecovered ? '✓' : isAbandoned ? '■' : custPayStatus === 'FAILED' ? '✕' : '•'}</div>
        <div className="step-content">
          <div className="step-title">6. CUSTOMER OUTCOME</div>
          <div className="step-meta">{outcomeLabel}</div>
        </div>
      </div>
    </div>
  );
}


