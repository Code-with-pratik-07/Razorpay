import React from 'react';
import { RecoveryCase, Explanation, title } from '../types';

interface DecisionPipelineProps {
  selected: RecoveryCase;
  explanation: Explanation | null;
}

export function DecisionPipeline({ selected, explanation }: DecisionPipelineProps) {
  return (
    <div className="decision-pipeline">
       <div className="pipeline-track" />

       <div className="pipeline-step completed">
         <div className="step-icon">✓</div>
         <div className="step-content">
           <div className="step-title">PAYMENT FAILED</div>
           <div className="step-meta">{title(selected.failure_reason)}</div>
         </div>
       </div>

       <div className={`pipeline-step ${explanation?.ml ? 'completed' : 'active'}`}>
         <div className="step-icon">{explanation?.ml ? '✓' : '•'}</div>
         <div className="step-content">
           <div className="step-title">ML PREDICTION</div>
           <div className="step-meta">{explanation?.ml?.recovery_probability != null ? `${(explanation.ml.recovery_probability * 100).toFixed(0)}% recovery probability` : 'Pending'}</div>
         </div>
       </div>

       <div className={`pipeline-step ${explanation?.policy ? (explanation.policy.allowed ? 'completed' : 'warning') : ''}`}>
         <div className="step-icon">{explanation?.policy ? (explanation.policy.allowed ? '✓' : '!') : '•'}</div>
         <div className="step-content">
           <div className="step-title">POLICY ENGINE</div>
           <div className="step-meta">{explanation?.policy ? (explanation.policy.allowed ? 'Automatic recovery approved' : 'BLOCKED') : 'Pending'}</div>
         </div>
       </div>

       <div className={`pipeline-step ${explanation?.ai ? 'completed' : ''}`}>
         <div className="step-icon">{explanation?.ai ? '✓' : '•'}</div>
         <div className="step-content">
           <div className="step-title">AI ADVISOR</div>
           <div className="step-meta">{explanation?.ai ? `${title(explanation.ai.recommended_action)} recommended` : 'Pending'}</div>
         </div>
       </div>

       <div className={`pipeline-step ${selected.status === 'recovered' || selected.status === 'recovering' ? 'completed' : explanation?.policy && !explanation.policy.allowed ? 'blocked' : ''}`}>
         <div className="step-icon">{selected.status === 'recovered' || selected.status === 'recovering' ? '✓' : explanation?.policy && !explanation.policy.allowed ? '—' : '•'}</div>
         <div className="step-content">
           <div className="step-title">RECOVERY</div>
           <div className="step-meta">{selected.status === 'recovered' || selected.status === 'recovering' ? 'Payment Link created' : explanation?.policy && !explanation.policy.allowed ? 'Not executed' : 'Pending'}</div>
         </div>
       </div>

       {explanation?.policy && !explanation.policy.allowed && (
         <div className="pipeline-step blocked">
           <div className="step-icon">→</div>
           <div className="step-content">
             <div className="step-title">HUMAN REVIEW REQUIRED</div>
           </div>
         </div>
       )}

       {(selected.status === 'recovered' || selected.status === 'recovering') && (
         <div className={`pipeline-step ${selected.status === 'recovered' ? 'completed' : 'active'}`}>
           <div className="step-icon">{selected.status === 'recovered' ? '✓' : '•'}</div>
           <div className="step-content">
             <div className="step-title">CUSTOMER PAYMENT</div>
             <div className="step-meta">{selected.status === 'recovered' ? 'Payment Received' : 'Awaiting payment'}</div>
           </div>
         </div>
       )}

       {selected.status === 'recovered' && (
         <div className="pipeline-step completed">
           <div className="step-icon">✓</div>
           <div className="step-content">
             <div className="step-title">RECOVERED</div>
             <div className="step-meta">Revenue Recovered</div>
           </div>
         </div>
       )}
    </div>
  );
}
