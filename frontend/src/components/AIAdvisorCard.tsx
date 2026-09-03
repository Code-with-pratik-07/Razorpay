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
  let reasoning = explanation.ai.reasoning;

  if (isRecovered) {
    actionBadge = 'Recovery Successful';
    reasoning = `The customer completed payment following ${title(explanation.channel_intelligence?.attributed_channel || 'SMS')} communication. All recovery workflows successfully resolved.`;
  } else if (isAbandoned) {
    actionBadge = 'Close Recovery';
    reasoning = 'The maximum recovery attempt limit has been reached without payment completion.';
  } else if (isHumanReview && !isApproved) {
    actionBadge = 'Manual Review Required';
    reasoning = 'The recovery probability is high, but the transaction requires human approval because of the applicable policy and risk context.';
  } else if (isApproved && !isRecovered) {
    actionBadge = 'Dispatch Recovery Communication';
    reasoning = 'Manual review has been approved. A secure payment link is ready and should be communicated through the highest-ranked verified channel.';
  } else if (followupAction === 'RETRY_SAME_CHANNEL') {
    actionBadge = selectedChannel ? `Send ${title(selectedChannel)} Reminder` : 'Send Reminder';
    reasoning = `The customer engaged with the previous payment link but has not completed payment. Follow up through ${selectedChannel ? title(selectedChannel) : 'the same channel'} after the recommended waiting period.`;
  } else if (followupAction === 'SWITCH_CHANNEL') {
    actionBadge = selectedChannel ? `Switch to ${title(selectedChannel)}` : 'Switch Communication Channel';
    reasoning = `The previous communication received no customer engagement. ${selectedChannel ? title(selectedChannel) : 'The alternate channel'} is now the next best available channel.`;
  } else if (followupAction === 'AWAIT_RESPONSE') {
    actionBadge = 'Awaiting Customer Response';
    reasoning = 'A recovery reminder has been dispatched. Currently observing customer response before scheduling further recovery attempts.';
  } else if (explanation.case_number === 'DEMO-A-AUTO' || (explanation.recovery_probability && explanation.recovery_probability >= 0.8)) {
    actionBadge = 'Automatic Recovery';
    reasoning = 'The payment has a high predicted recovery probability and passed all policy checks. A secure payment link was generated and WhatsApp was selected as the primary communication channel.';
  }

  const rawMsg = explanation.ai.customer_message || '';
  const isGenericMsg = 
    rawMsg.toLowerCase().includes('please pay') ||
    rawMsg.toLowerCase().includes('n/a') ||
    rawMsg.toLowerCase().includes('escalated for manual review') ||
    rawMsg.toLowerCase().includes('recovery closed');

  return (
    <div className="intelligence-card ai-advisor-card">
      <div className="ai-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
        <div style={{fontWeight: 700, fontSize: '0.85rem', color: '#93c5fd', letterSpacing: '0.05em', textTransform: 'uppercase'}}>
          ✦ 6. AI Advisor
        </div>
        <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
          <span style={{fontSize: '0.75rem', color: '#94a3b8'}}>Recommended Next Action:</span>
          <Badge value={actionBadge} />
        </div>
      </div>
      <div className="ai-body" style={{fontSize: '0.9rem', color: '#e2e8f0', lineHeight: 1.5}}>
        <div style={{color: '#94a3b8', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4}}>
          Reason & Operational Context:
        </div>
        <div>{reasoning}</div>
      </div>
      {!isGenericMsg && rawMsg.trim().length > 0 && (
        <blockquote style={{marginTop: 10, padding: '8px 12px', borderLeft: '3px solid #3b82f6', background: 'rgba(30, 58, 138, 0.2)', fontSize: '0.85rem', color: '#cbd5e1', fontStyle: 'italic', borderRadius: '0 4px 4px 0'}}>
          "{rawMsg}"
        </blockquote>
      )}
    </div>
  );
}
