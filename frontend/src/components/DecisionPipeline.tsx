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
    : mlDecision === 'UNCERTAIN'
    ? 'Allowed — Uncertain ML (Human Review)'
    : mlDecision === 'LOW'
    ? 'Allowed — ML too low (Stopped)'
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

       <div className={`pipeline-step ${explanation?.ml ? (mlDecision === 'LOW' ? 'warning' : 'completed') : 'active'}`}>
         <div className="step-icon">{explanation?.ml ? (mlDecision === 'LOW' ? '↓' : '✓') : '•'}</div>
         <div className="step-content">
           <div className="step-title">ML PREDICTION</div>
           <div className="step-meta">{mlLabel}</div>
         </div>
       </div>

       <div className={`pipeline-step ${policyDone ? (policyAllowed && mlDecision !== 'UNCERTAIN' && mlDecision !== 'LOW' ? 'completed' : 'warning') : ''}`}>
         <div className="step-icon">{policyDone ? (policyAllowed && mlDecision !== 'UNCERTAIN' && mlDecision !== 'LOW' ? '✓' : '!') : '•'}</div>
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

       {/* Recovery step */}
       {isAbandoned ? (
         <div className="pipeline-step blocked">
           <div className="step-icon">■</div>
           <div className="step-content">
             <div className="step-title">RECOVERY STOPPED</div>
             <div className="step-meta">ML probability too low — no action taken</div>
           </div>
         </div>
       ) : isHumanReview ? (
         <div className="pipeline-step warning">
           <div className="step-icon">→</div>
           <div className="step-content">
             <div className="step-title">HUMAN REVIEW REQUIRED</div>
             <div className="step-meta">{!policyAllowed ? 'Policy blocked automatic recovery' : 'Below automatic recovery threshold'}</div>
           </div>
         </div>
       ) : (
         <div className={`pipeline-step ${isRecovered || isRecovering ? 'completed' : explanation?.execution_error ? 'warning' : policyDone && !policyAllowed ? 'blocked' : ''}`}>
          <div className="step-icon">{isRecovered || isRecovering ? '✓' : explanation?.execution_error ? '!' : policyDone && !policyAllowed ? '—' : '•'}</div>
          <div className="step-content">
            <div className="step-title">RECOVERY</div>
            <div className="step-meta">{isRecovered || isRecovering ? 'Payment Link created' : explanation?.execution_error ? `Execution Failed: ${explanation.execution_error}` : policyDone ? 'Not executed' : 'Pending'}</div>
          </div>
        </div>
       )}

       {/* Customer payment step */}
       {!isAbandoned && (
         <div className={`pipeline-step ${isRecovered ? 'completed' : isRecovering ? 'active' : ''}`}>
           <div className="step-icon">{isRecovered ? '✓' : '•'}</div>
           <div className="step-content">
             <div className="step-title">CUSTOMER PAYMENT</div>
             <div className="step-meta">
               {isRecovered ? 'Payment Received' : isRecovering ? 'Awaiting customer payment' : 'Awaiting recovery action'}
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
