import React from 'react';
import { Explanation, title } from '../types';
import { Badge } from './Badge';

interface AIAdvisorCardProps {
  explanation: Explanation;
}

export function AIAdvisorCard({ explanation }: AIAdvisorCardProps) {
  if (!explanation?.ai) return null;

  const isRecovered = explanation.status === 'recovered';
  const isAttemptLimitReached = (explanation.retry_count >= explanation.max_retries) || explanation.status === 'abandoned' || explanation.channel_intelligence?.status === 'ATTEMPT_LIMIT_REACHED';
  const isAbandoned = explanation.status === 'abandoned' || isAttemptLimitReached;
  const followupAction = explanation.channel_intelligence?.followup_decision?.next_action;
  const isTerminalCase = isRecovered || isAbandoned || explanation.status === 'closed' || followupAction === 'STOP_RECOVERY';

  const isApproved = explanation.human_review_status === 'APPROVED' || explanation.manual_execution;
  const isHumanReview = explanation.human_review_status === 'REQUIRED' || explanation.status === 'human_review';
  const previousOutcome = explanation.channel_intelligence?.followup_decision?.previous_outcome;

  let actionBadge = 'Automatic Recovery';
  let businessInsight = explanation.ai.reasoning;

  if (isRecovered) {
    actionBadge = 'Close Recovery Successfully';
    businessInsight = `Payment recovery completed successfully. The customer captured payment following ${title(explanation.channel_intelligence?.attributed_channel || 'SMS')} recovery communication.`;
  } else if (isTerminalCase || isAttemptLimitReached || isAbandoned || followupAction === 'STOP_RECOVERY') {
    actionBadge = 'Close Recovery';
    businessInsight = 'The maximum permitted recovery attempts have been reached without successful payment. Further automated communication should stop to prevent unnecessary customer outreach.';
  } else if (isHumanReview && !isApproved) {
    actionBadge = 'Manual Review Required';
    businessInsight = 'Transaction policy requires manual oversight. Human approval ensures compliance before recovery outreach begins.';
  } else if (isApproved && !isRecovered) {
    actionBadge = 'Dispatch Recovery Communication';
    businessInsight = 'Manual review approved. Secure payment link prepared for customer delivery via the recommended verified channel.';
  } else if (previousOutcome === 'FAILED_DELIVERY') {
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
  } else if (followupAction === 'AWAIT_RESPONSE' || previousOutcome === 'AWAITING_RESPONSE') {
    actionBadge = 'Wait for Customer Response';
    businessInsight = "A WhatsApp reminder has been sent following the customer's earlier payment-link engagement. RecoverAI is currently waiting for customer activity before determining whether another recovery action is necessary.";
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
            Recommended Next Action
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
