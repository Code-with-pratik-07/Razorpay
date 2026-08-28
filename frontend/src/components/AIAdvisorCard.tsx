import React from 'react';
import { Explanation, title } from '../types';
import { Badge } from './Badge';

interface AIAdvisorCardProps {
  explanation: Explanation;
}

export function AIAdvisorCard({ explanation }: AIAdvisorCardProps) {
  if (!explanation?.ai) return null;

  return (
    <div className="ai-block">
      <div className="ai-header">
        <div className="ai-title">✦ AI ADVISOR</div>
        <Badge value={explanation.ai.recommended_action} />
      </div>
      <div className="ai-reasoning">
        {explanation.ai.reasoning}
      </div>
      {explanation.ai.customer_message && (
        <blockquote>"{explanation.ai.customer_message}"</blockquote>
      )}
    </div>
  );
}
