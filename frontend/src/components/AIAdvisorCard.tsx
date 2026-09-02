import React from 'react';
import { Explanation, title } from '../types';
import { Badge } from './Badge';

interface AIAdvisorCardProps {
  explanation: Explanation;
}

export function AIAdvisorCard({ explanation }: AIAdvisorCardProps) {
  if (!explanation?.ai) return null;

  const isApproved = explanation.human_review_status === 'APPROVED' || explanation.manual_execution;
  const isAbandoned = explanation.status === 'abandoned';
  const isRecovered = explanation.status === 'recovered';

  let actionBadge = explanation.ai.recommended_action;
  let reasoning = explanation.ai.reasoning;

  if (isApproved && !isRecovered) {
    actionBadge = 'Manual Approved';
    reasoning = 'Dispatch Recovery Communication: Manual review has been approved. A secure payment link is ready and should be communicated through the highest-ranked channel.';
  } else if (isAbandoned) {
    actionBadge = 'Recovery Closed';
    reasoning = 'Close Recovery: The maximum permitted attempts were reached without customer response. Stop further automated communication to protect the customer relationship.';
  } else if (isRecovered) {
    actionBadge = 'Recovered';
    reasoning = `Recovery Successful: The customer completed payment following ${title(explanation.channel_intelligence?.attributed_channel || 'SMS')} communication.`;
  }

  const showCustomerMsg = explanation.ai.customer_message && 
    !explanation.ai.customer_message.toLowerCase().includes('n/a') &&
    !explanation.ai.customer_message.toLowerCase().includes('escalated for manual review');

  return (
    <div className="ai-block">
      <div className="ai-header">
        <div className="ai-title">✦ AI ADVISOR</div>
        <Badge value={actionBadge} />
      </div>
      <div className="ai-reasoning">
        {reasoning}
      </div>
      {showCustomerMsg && (
        <blockquote>"{explanation.ai.customer_message}"</blockquote>
      )}
    </div>
  );
}
