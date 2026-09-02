import React from 'react';
import { RecoveryCase, Explanation, title } from '../types';

interface DecisionPipelineProps {
  selected: RecoveryCase;
  explanation: Explanation | null;
}

export function DecisionPipeline({ selected, explanation }: DecisionPipelineProps) {
  const mlDecision = explanation?.ml_decision ?? null;
  const prob = explanation?.ml?.recovery_probability;
  const probStr = prob != null ? `${(prob * 100).toFixed(0)}%` : null;

  const isAbandoned = selected.status === 'abandoned';
  const isHumanReview = selected.status === 'human_review';
  const isRecovering = selected.status === 'recovering';
  const isRecovered = selected.status === 'recovered';

  // Policy step state
  const policyDone = explanation?.policy != null;
  const policyAllowed = explanation?.policy?.allowed ?? false;

  // ML step label
  let mlLabel = probStr ? `${probStr} recovery probability` : 'Pending';
  if (mlDecision === 'HIGH' && probStr) mlLabel = `${probStr} — High confidence`;
  else if (mlDecision === 'UNCERTAIN' && probStr) mlLabel = `${probStr} — Uncertain`;
  else if (mlDecision === 'LOW' && probStr) mlLabel = `${probStr} — Low`;
  else if (mlDecision === 'COLD_START') mlLabel = `Limited History (Cold Start)`;

  // Policy step label
  const policyLabel = !policyDone
    ? 'Pending'
    : !policyAllowed
    ? 'BLOCKED — Human Review'
    : '✓ Automatic recovery approved';

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
           <div className="step-meta">{mlLabel}</div>
         </div>
       </div>

       <div className={`pipeline-step ${policyDone ? (policyAllowed ? 'completed' : 'warning') : ''}`}>
         <div className="step-icon">{policyDone ? (policyAllowed ? '✓' : '!') : '•'}</div>
         <div className="step-content">
           <div className="step-title">POLICY ENGINE</div>
           <div className="step-meta">{policyLabel}</div>
         </div>
       </div>

       <div className={`pipeline-step ${explanation?.ai ? 'completed' : ''}`}>
         <div className="step-icon">{explanation?.ai ? '✓' : '•'}</div>
         <div className="step-content">
           <div className="step-title">AI ADVISOR</div>
           <div className="step-meta">{explanation?.ai ? `${title(explanation.ai.recommended_action)} recommended` : 'Pending'}</div>
         </div>
       </div>

       {/* Recovery steps */}
       {isAbandoned && selected.retry_count === 0 ? (
         <div className="pipeline-step blocked">
           <div className="step-icon">■</div>
           <div className="step-content">
             <div className="step-title">NO ADDITIONAL RECOVERY ATTEMPTS</div>
             <div className="step-meta">No recovery action permitted</div>
           </div>
         </div>
       ) : (
         <>
           {(!policyAllowed && policyDone) && (
             <div className={`pipeline-step ${explanation?.manual_execution ? 'completed' : 'warning'}`}>
               <div className="step-icon">{explanation?.manual_execution ? '✓' : '→'}</div>
               <div className="step-content">
                 <div className="step-title">HUMAN REVIEW</div>
                 <div className="step-meta">{explanation?.manual_execution ? 'Manual review approved' : 'Policy blocked automatic recovery'}</div>
               </div>
             </div>
           )}

           {(!policyDone || policyAllowed || explanation?.manual_execution) && (
             <div className={`pipeline-step ${isRecovered || isRecovering || selected.retry_count > 0 ? 'completed' : explanation?.execution_error ? 'warning' : ''}`}>
              <div className="step-icon">{isRecovered || isRecovering || selected.retry_count > 0 ? '✓' : explanation?.execution_error ? '!' : '•'}</div>
              <div className="step-content">
                <div className="step-title">{explanation?.manual_execution ? 'MANUAL RECOVERY' : 'AUTOMATIC RECOVERY'}</div>
                <div className="step-meta">{isRecovered || isRecovering || selected.retry_count > 0 ? 'Payment Link created' : explanation?.execution_error ? `Execution Failed: ${explanation.execution_error}` : 'Pending'}</div>
              </div>
            </div>
           )}
         </>
       )}

       {/* Customer payment step */}
       {(!isAbandoned || selected.retry_count > 0) && (
         <div className={`pipeline-step ${isRecovered ? 'completed' : selected.last_payment_status === 'FAILED' ? 'warning' : isRecovering ? 'active' : isAbandoned ? 'blocked' : ''}`}>
           <div className="step-icon">{isRecovered ? '✓' : selected.last_payment_status === 'FAILED' ? '✕' : isAbandoned ? '■' : '•'}</div>
           <div className="step-content">
             <div className="step-title">CUSTOMER PAYMENT</div>
             <div className="step-meta">
               {isRecovered ? 'Payment Received' : selected.last_payment_status === 'FAILED' ? 'Payment Attempt Failed' : isAbandoned ? 'Payment Timeout / Exhausted' : isRecovering ? 'Awaiting customer payment' : 'Awaiting recovery action'}
             </div>
           </div>
         </div>
       )}

       {isRecovering && selected.last_payment_status === 'FAILED' && (
         <div className="pipeline-step active">
           <div className="step-icon">→</div>
           <div className="step-content">
             <div className="step-title">NEXT ACTION</div>
             <div className="step-meta">
               {selected.next_action_type === 'reminder' ? `Reminder scheduled` :
                selected.next_action_type === 'expiry_check' ? `Waiting for payment link expiry` :
                `Waiting for scheduled workflow`}
             </div>
           </div>
         </div>
       )}

       {isRecovered && (
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
