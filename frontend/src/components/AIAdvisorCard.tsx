import React from 'react';
import { Explanation, title } from '../types';
import { Badge } from './Badge';

interface AIAdvisorCardProps {
  explanation: Explanation;
  caseStatus?: string;
}

export function AIAdvisorCard({ explanation, caseStatus }: AIAdvisorCardProps) {
  if (!explanation?.ai) return null;

  const journey = explanation.channel_intelligence?.communication_journey || [];
  const latestComm = journey.length > 0 ? journey[journey.length - 1] : null;
  const previousComm = journey.length > 1 ? journey[journey.length - 2] : null;
  const firstComm = journey.length > 0 ? journey[0] : null;

  const followupDecision = explanation.channel_intelligence?.followup_decision;
  const followupAction = followupDecision?.next_action;
  const previousOutcome = followupDecision?.previous_outcome;

  const effectiveStatus = caseStatus || explanation.status;
  const isRecovered = effectiveStatus === 'recovered';
  const isAttemptLimitReached = explanation.retry_count >= explanation.max_retries;
  const isRecoveryClosed = effectiveStatus === 'abandoned' || effectiveStatus === 'closed' || isAttemptLimitReached || followupAction === 'STOP_RECOVERY';
  const isAbandoned = isRecoveryClosed && !isRecovered;
  const isTerminalCase = isRecovered || isRecoveryClosed;

  const isApproved = explanation.human_review_status === 'APPROVED' || explanation.manual_execution;
  const isHumanReview = !isTerminalCase && (explanation.human_review_status === 'REQUIRED' || effectiveStatus === 'human_review') && !isApproved;

  // Authoritative Awaiting Response check
  const isAwaitingResponse = !isTerminalCase && (
    latestComm?.outcome === 'AWAITING_RESPONSE' ||
    latestComm?.status === 'AWAITING_RESPONSE' ||
    followupAction === 'AWAIT_RESPONSE' ||
    previousOutcome === 'AWAITING_RESPONSE'
  );

  // Single source of truth for customer engagement:
  const hasCustomerEngaged = journey.some(r => r.outcome === 'LINK_CLICKED' || r.outcome === 'CLICKED') ||
    previousOutcome === 'LINK_CLICKED' ||
    previousOutcome === 'CLICKED';

  // Single source of truth for channel transition:
  const didSwitchChannel = Boolean(
    previousComm && latestComm && previousComm.channel.toLowerCase() !== latestComm.channel.toLowerCase()
  );

  // Remaining recovery attempts calculation
  const maxRetries = explanation.max_retries || 3;
  const currentAttempts = explanation.retry_count || journey.length || 0;
  const remainingAttempts = Math.max(0, maxRetries - currentAttempts);
  const attemptsWord = remainingAttempts === 1
    ? 'One recovery attempt remains'
    : remainingAttempts === 0
    ? 'No recovery attempts remain'
    : `${remainingAttempts} recovery attempts remain`;

  // Wait window
  const rawWait = followupDecision?.recommended_wait_period || '24 hours';
  const waitWindow = rawWait.toLowerCase().includes('24') ? '24-hour' : rawWait.toLowerCase().includes('immediate') ? 'immediate' : rawWait;

  // Dynamic channel names
  const prevChannelName = title(previousComm?.channel || firstComm?.channel || 'WhatsApp');
  const currentChannelName = title(latestComm?.channel || followupDecision?.selected_channel || 'SMS');

  // Prepared communication ready for initial dispatch (after manual approval)
  const isPreparedNotDispatched = !isTerminalCase && !isAwaitingResponse && isApproved && (
    explanation.communication_status === 'READY' ||
    explanation.communication_status === 'GENERATED' ||
    journey.length === 0
  );

  const attempts = explanation.payment_attempts || [];
  const latestPaymentAttempt = attempts.length > 0 ? attempts[0] : null;
  const lastPaymentFailed = !isTerminalCase && (explanation.last_payment_status === 'FAILED' || latestPaymentAttempt?.status === 'failed');
  const paymentAttemptMethod = explanation.last_payment_method || latestPaymentAttempt?.payment_method || null;
  const methodDisplay = paymentAttemptMethod ? title(paymentAttemptMethod) : 'the selected payment method';

  let actionBadge = 'Pending Review';
  let businessInsight = explanation.ai.reasoning;

  // 1. RECOVERED
  if (isRecovered) {
    actionBadge = 'Recovery Completed';
    const commChannel = explanation.channel_intelligence?.attributed_channel || latestComm?.channel;
    const channelText = commChannel ? `${title(commChannel)} ` : '';
    businessInsight = `Payment recovery completed successfully. The customer captured payment following ${channelText}recovery outreach.`;
  } 
  // 2. ABANDONED / CLOSED / Attempt limit reached
  else if (isRecoveryClosed) {
    actionBadge = 'Recovery Closed';
    businessInsight = 'The maximum permitted communication attempts were completed without successful payment. The recovery workflow has ended and no further automated outreach will be scheduled.';
  } 
  // 3. HUMAN_REVIEW and not yet approved
  else if (isHumanReview) {
    actionBadge = 'Manual Review Required';
    businessInsight = 'Transaction policy requires manual oversight. Human approval ensures compliance before recovery outreach begins.';
  } 
  // 4. RECENT RECOVERY PAYMENT ACTIVITY
  else if (lastPaymentFailed) {
    actionBadge = isAwaitingResponse ? 'Wait for Customer Response' : 'Follow-up on Payment Intent';
    const sameMethodFailures = paymentAttemptMethod
      ? attempts.filter(a => a.status === 'failed' && a.payment_method?.toLowerCase() === paymentAttemptMethod.toLowerCase()).length
      : 1;
    if (isAwaitingResponse) {
      businessInsight = 'The customer demonstrated payment intent by attempting payment through the recovery link, but the transaction was unsuccessful. The payment attempt has been recorded independently and did not consume a communication attempt. RecoverAI is currently evaluating customer activity before deciding whether to use the remaining recovery communication opportunity.';
    } else if (sameMethodFailures >= 2) {
      businessInsight = `The customer engaged with the recovery payment link and repeatedly attempted payment using ${methodDisplay}, but transactions were unsuccessful. This indicates clear payment intent; recommending an alternative payment method (such as UPI or Card) is advised.`;
    } else {
      businessInsight = `The customer engaged with the recovery payment link and attempted to complete payment using ${methodDisplay}, but the transaction was unsuccessful. This indicates payment intent and RecoverAI should consider the failed payment attempt when determining the next recovery action.`;
    }
  } 
  // 5. AWAITING_RESPONSE (when no payment attempt occurred yet)
  else if (isAwaitingResponse) {
    actionBadge = 'Wait for Customer Response';
    if (!hasCustomerEngaged) {
      if (didSwitchChannel) {
        businessInsight = `The initial ${prevChannelName} recovery communication was delivered but received no customer engagement. RecoverAI therefore selected ${currentChannelName} as the next-best communication channel. ${attemptsWord}, and the system is currently observing customer activity during the ${waitWindow} response window to avoid unnecessary messaging.`;
      } else {
        businessInsight = `The initial ${currentChannelName} recovery communication was delivered but received no customer engagement. ${attemptsWord}, and the system is currently observing customer activity during the ${waitWindow} response window to avoid unnecessary messaging.`;
      }
    } else {
      if (didSwitchChannel) {
        businessInsight = `The customer previously engaged with the ${prevChannelName} recovery outreach, and follow-up communication was delivered via ${currentChannelName}. ${attemptsWord}, and the system is currently observing customer activity during the ${waitWindow} response window to avoid unnecessary messaging.`;
      } else {
        const reminderWord = journey.length > 1 ? `${currentChannelName} reminder` : `${currentChannelName} communication`;
        businessInsight = `The customer previously engaged by opening the recovery payment link, and a ${reminderWord} was delivered. ${attemptsWord} within policy limits, and the system is currently observing customer activity during the ${waitWindow} response window to avoid unnecessary messaging.`;
      }
    }
  } 
  // 6. Communication prepared but not dispatched
  else if (isPreparedNotDispatched) {
    actionBadge = 'Dispatch Recovery Communication';
    businessInsight = 'Manual review approved. Secure payment link prepared for customer delivery via the recommended verified channel.';
  } 
  // 7. ACTIVE RECOVERY ACTIONS
  else if (previousOutcome === 'FAILED_DELIVERY') {
    actionBadge = 'Use Immediate Channel Fallback';
    businessInsight = `Delivery failed on ${prevChannelName}. Immediately switching to an alternate verified communication channel without delay.`;
  } else if (previousOutcome === 'LINK_CLICKED') {
    actionBadge = 'Observe Payment Outcome';
    businessInsight = 'The customer opened the recovery payment link, indicating engagement and potential payment intent. RecoverAI should observe the payment outcome before deciding whether another communication is necessary.';
  } else if (followupAction === 'RETRY_SAME_CHANNEL') {
    const chName = title(followupDecision?.selected_channel || latestComm?.channel || 'WhatsApp');
    actionBadge = `Send ${chName} Reminder`;
    businessInsight = `The customer opened the payment link but did not complete checkout. A reminder through ${chName} is recommended because the customer has already demonstrated engagement.`;
  } else if (followupAction === 'SWITCH_CHANNEL') {
    const prevCh = title(latestComm?.channel || 'WhatsApp');
    const nextCh = title(followupDecision?.selected_channel || 'SMS');
    actionBadge = 'Switch Communication Channel';
    businessInsight = `The customer did not engage with the previous ${prevCh} communication. After the follow-up period, ${nextCh} is recommended as the next best verified channel.`;
  } else if (followupAction === 'GENERATE_NEW_LINK') {
    actionBadge = 'Generate New Payment Link';
    businessInsight = 'The previous recovery link has expired. Regenerating a new secure payment link within policy limits is recommended.';
  } else if (effectiveStatus === 'recovering' || explanation.communication_status === 'SENT' || explanation.communication_status === 'SIMULATED') {
    actionBadge = isApproved ? 'Human Approved Recovery' : 'Automatic Recovery';
    businessInsight = isApproved
      ? 'Manual review approved. Automated recovery outreach is actively underway with human authorization.'
      : (explanation.ai.reasoning || 'Automated recovery workflow is actively executing recovery procedures.');
  } else {
    actionBadge = 'Pending Review';
    businessInsight = explanation.ai.reasoning || 'Case is pending initial automated policy and recovery evaluation.';
  }

  return (
    <div className="intelligence-card ai-advisor-card">
      <div className="ai-header">
        <div className="ai-title-row">
          <svg className="ai-spark-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z"/>
          </svg>
          <span className="ai-title-text">AI Recovery Advisor</span>
        </div>
      </div>

      <div className="ai-card-content">
        <div className="ai-field-group">
          <div className="ai-field-label">
            {isAbandoned ? 'Recovery Status' : 'Recommended Next Action'}
          </div>
          <div className="ai-badge-wrap">
            <Badge value={actionBadge} />
          </div>
        </div>

        <div className="ai-field-group">
          <div className="ai-field-label">
            Business Insight
          </div>
          <div className="ai-insight-body">
            {businessInsight}
          </div>
        </div>
      </div>
    </div>
  );
}
