import React from 'react';
import { Explanation, title } from '../types';
import { Badge } from './Badge';

interface AIAdvisorCardProps {
  explanation: Explanation;
}

export function AIAdvisorCard({ explanation }: AIAdvisorCardProps) {
  if (!explanation?.ai) return null;

  const journey = explanation.channel_intelligence?.communication_journey || [];
  const latestComm = journey.length > 0 ? journey[journey.length - 1] : null;
  const followupDecision = explanation.channel_intelligence?.followup_decision;
  const followupAction = followupDecision?.next_action;
  const previousOutcome = followupDecision?.previous_outcome;

  const isRecovered = explanation.status === 'recovered';
  const isAttemptLimitReached = explanation.retry_count >= explanation.max_retries;
  const isRecoveryClosed = explanation.status === 'abandoned' || explanation.status === 'closed' || isAttemptLimitReached || followupAction === 'STOP_RECOVERY';
  const isAbandoned = isRecoveryClosed && !isRecovered;
  const isTerminalCase = isRecovered || isRecoveryClosed;

  const isApproved = explanation.human_review_status === 'APPROVED' || explanation.manual_execution;
  const isHumanReview = !isTerminalCase && (explanation.human_review_status === 'REQUIRED' || explanation.status === 'human_review') && !isApproved;

  // Authoritative Awaiting Response check
  const isAwaitingResponse = !isTerminalCase && (
    latestComm?.outcome === 'AWAITING_RESPONSE' ||
    latestComm?.status === 'AWAITING_RESPONSE' ||
    followupAction === 'AWAIT_RESPONSE' ||
    previousOutcome === 'AWAITING_RESPONSE'
  );

  // Prepared communication ready for initial dispatch (after manual approval)
  const isPreparedNotDispatched = !isTerminalCase && !isAwaitingResponse && isApproved && (
    explanation.communication_status === 'READY' ||
    explanation.communication_status === 'GENERATED' ||
    journey.length === 0
  );

  const attempts = explanation.payment_attempts || [];
  const latestPaymentAttempt = attempts.length > 0 ? attempts[0] : null;
  const lastPaymentFailed = !isTerminalCase && (explanation.last_payment_status === 'FAILED' || latestPaymentAttempt?.status === 'failed');
  const paymentAttemptMethod = explanation.last_payment_method || latestPaymentAttempt?.payment_method || 'Netbanking';

  let actionBadge = 'Automatic Recovery';
  let businessInsight = explanation.ai.reasoning;

  // 1. RECOVERED
  if (isRecovered) {
    actionBadge = 'Close Recovery Successfully';
    businessInsight = `Payment recovery completed successfully. The customer captured payment following ${title(explanation.channel_intelligence?.attributed_channel || latestComm?.channel || 'SMS')} recovery communication.`;
  } 
  // 2. ABANDONED / CLOSED / Attempt limit reached
  else if (isRecoveryClosed) {
    actionBadge = 'Recovery Complete';
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
    const sameMethodFailures = attempts.filter(a => a.status === 'failed' && a.payment_method?.toLowerCase() === paymentAttemptMethod.toLowerCase()).length;
    if (isAwaitingResponse) {
      businessInsight = 'The customer demonstrated payment intent by attempting payment through the recovery link, but the transaction was unsuccessful. The payment attempt has been recorded independently and did not consume a communication attempt. RecoverAI is currently evaluating customer activity before deciding whether to use the remaining recovery communication opportunity.';
    } else if (sameMethodFailures >= 2) {
      businessInsight = `The customer engaged with the recovery payment link and repeatedly attempted payment using ${title(paymentAttemptMethod)}, but transactions were unsuccessful. This indicates clear payment intent; recommending an alternative payment method (such as UPI or Card) is advised.`;
    } else {
      businessInsight = `The customer engaged with the recovery payment link and attempted to complete payment using ${title(paymentAttemptMethod)}, but the transaction was unsuccessful. This indicates payment intent and RecoverAI should consider the failed payment attempt when determining the next recovery action.`;
    }
  } 
  // 5. AWAITING_RESPONSE (when no payment attempt occurred yet)
  else if (isAwaitingResponse) {
    actionBadge = 'Wait for Customer Response';
    businessInsight = 'The latest recovery communication has been delivered and RecoverAI is currently waiting for customer activity before determining whether another recovery action is necessary.';
  } 
  // 6. Communication prepared but not dispatched
  else if (isPreparedNotDispatched) {
    actionBadge = 'Dispatch Recovery Communication';
    businessInsight = 'Manual review approved. Secure payment link prepared for customer delivery via the recommended verified channel.';
  } 
  // 7. ACTIVE FOLLOW-UP / FALLBACK ACTIONS
  else if (previousOutcome === 'FAILED_DELIVERY') {
    actionBadge = 'Use Immediate Channel Fallback';
    businessInsight = 'Delivery failed on the initial channel. Immediately switching to an alternate verified communication channel without delay.';
  } else if (previousOutcome === 'LINK_CLICKED' || followupAction === 'RETRY_SAME_CHANNEL') {
    actionBadge = 'Send WhatsApp Reminder';
    businessInsight = 'The customer opened the payment link but did not complete checkout. A reminder through WhatsApp is recommended because the customer has already demonstrated engagement.';
  } else if (followupAction === 'SWITCH_CHANNEL') {
    actionBadge = 'Switch Communication Channel';
    businessInsight = 'The customer did not engage with the previous WhatsApp communication. After the follow-up period, SMS is recommended as the next best verified channel.';
  } else if (followupAction === 'GENERATE_NEW_LINK') {
    actionBadge = 'Generate New Payment Link';
    businessInsight = 'The previous recovery link has expired. Regenerating a new secure payment link within policy limits is recommended.';
  } else if (explanation.recovery_probability && explanation.recovery_probability >= 0.8 && !isTerminalCase) {
    actionBadge = 'Send WhatsApp Reminder';
    businessInsight = 'The customer opened the payment link but did not complete checkout. A reminder through WhatsApp is recommended because the customer has already demonstrated engagement.';
  }

  return (
    <div className="intelligence-card ai-advisor-card">
      <div className="ai-header" style={{marginBottom: 14}}>
        <div style={{fontWeight: 800, fontSize: '0.95rem', color: '#60a5fa', letterSpacing: '0.06em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6}}>
          <span>✦</span> AI ADVISOR
        </div>
      </div>

      <div style={{display: 'flex', flexDirection: 'column', gap: 14}}>
        <div>
          <div style={{color: '#94a3b8', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6}}>
            {isAbandoned ? 'Recovery Status' : 'Recommended Next Action'}
          </div>
          <div style={{display: 'inline-flex'}}>
            <Badge value={actionBadge} />
          </div>
        </div>

        <div>
          <div style={{color: '#94a3b8', fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6}}>
            Business Insight
          </div>
          <div style={{fontSize: '0.95rem', color: '#f8fafc', fontWeight: 400, lineHeight: 1.6}}>
            {businessInsight}
          </div>
        </div>
      </div>
    </div>
  );
}
