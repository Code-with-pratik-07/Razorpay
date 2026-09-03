import React from 'react';
import { Explanation, title } from '../types';
import { Badge } from './Badge';

interface AIAdvisorCardProps {
  explanation: Explanation;
}

export function AIAdvisorCard({ explanation }: AIAdvisorCardProps) {
  if (!explanation?.ai) return null;

  const isApproved = explanation.human_review_status === 'APPROVED' || explanation.manual_execution;
  const isHumanReview = explanation.human_review_status === 'REQUIRED' || explanation.status === 'human_review';
  const isAbandoned = explanation.status === 'abandoned';
  const isRecovered = explanation.status === 'recovered';
  const followupAction = explanation.channel_intelligence?.followup_decision?.next_action;

  const selectedChannel = explanation.channel_intelligence?.followup_decision?.selected_channel;

  let actionBadge = 'Automatic Recovery';
  let businessInsight = explanation.ai.reasoning;

  if (isRecovered) {
    actionBadge = 'Close Recovery Successfully';
    businessInsight = `Payment recovery completed successfully. The customer captured payment following ${title(explanation.channel_intelligence?.attributed_channel || 'SMS')} recovery communication.`;
  } else if (isAbandoned) {
    actionBadge = 'Close Recovery';
    businessInsight = 'The maximum permitted recovery attempts have been reached without successful payment. Further automated communication should stop.';
  } else if (isHumanReview && !isApproved) {
    actionBadge = 'Manual Review Required';
    businessInsight = 'Transaction policy requires manual oversight. Human approval ensures compliance before recovery outreach begins.';
  } else if (isApproved && !isRecovered) {
    actionBadge = 'Dispatch Recovery Communication';
    businessInsight = 'Manual review approved. Secure payment link prepared for customer delivery via the recommended verified channel.';
  } else if (explanation.channel_intelligence?.followup_decision?.previous_outcome === 'FAILED_DELIVERY') {
    actionBadge = 'Use Immediate Channel Fallback';
    businessInsight = 'Delivery failed on the initial channel. Immediately switching to an alternate verified communication channel without delay.';
  } else if (followupAction === 'RETRY_SAME_CHANNEL') {
    actionBadge = selectedChannel ? `Send ${title(selectedChannel)} Reminder` : 'Send WhatsApp Reminder';
    businessInsight = 'The customer demonstrated payment intent by opening the recovery link but did not complete checkout. A follow-up through the same channel is recommended before switching to another communication method.';
  } else if (followupAction === 'SWITCH_CHANNEL') {
    actionBadge = 'Switch Communication Channel';
    businessInsight = 'The customer did not engage with the previous WhatsApp communication. After the follow-up period, SMS is recommended as the next best verified channel.';
  } else if (followupAction === 'GENERATE_NEW_LINK') {
    actionBadge = 'Generate New Payment Link';
    businessInsight = 'The previous recovery link has expired. Regenerating a new secure payment link within policy limits is recommended.';
  } else if (followupAction === 'AWAIT_RESPONSE') {
    actionBadge = 'Wait for Customer Response';
    businessInsight = 'A reminder has been dispatched through WhatsApp. Observing customer response patterns before committing further recovery attempts.';
  } else if (explanation.case_number === 'DEMO-A-AUTO' || (explanation.recovery_probability && explanation.recovery_probability >= 0.8)) {
    actionBadge = 'Automatic Recovery';
    businessInsight = 'The payment has a high predicted recovery probability and passed all policy checks. A secure payment link was generated and WhatsApp was selected as the primary communication channel.';
  }

  return (
    <div className="intelligence-card ai-advisor-card">
      <div className="ai-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
        <div style={{fontWeight: 700, fontSize: '0.85rem', color: '#93c5fd', letterSpacing: '0.05em', textTransform: 'uppercase'}}>
          ✦ AI ADVISOR
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
          <span style={{fontSize: '0.75rem', color: '#94a3b8'}}>Recommended Next Action:</span>
          <Badge value={actionBadge} />
        </div>
      </div>
      <div className="ai-body" style={{fontSize: '0.9rem', color: '#e2e8f0', lineHeight: 1.5}}>
        <div style={{color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4}}>
          Business Insight
        </div>
        <div>{businessInsight}</div>
      </div>
    </div>
  );
}
