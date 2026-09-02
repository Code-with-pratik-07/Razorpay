import React from 'react';
import { RecoveryCase } from '../types';

interface DemoControlCenterProps {
  demoMode: boolean;
  cases: RecoveryCase[];
  resettingDemo: boolean;
  loading: boolean;
  startDemo: () => Promise<void>;
  simulateFailure: () => Promise<void>;
  selectScenario: (caseNumber: string, list: RecoveryCase[]) => void;
  selectedId: string | null;
}

export function DemoControlCenter({
  demoMode,
  cases,
  resettingDemo,
  loading,
  startDemo,
  simulateFailure,
  selectScenario,
  selectedId
}: DemoControlCenterProps) {
  if (!demoMode) return null;

  const getSelectedCase = () => cases.find(c => c.id === selectedId);
  const selectedCase = getSelectedCase();

  const isSelected = (caseNumber: string) => selectedCase?.case_number === caseNumber;

  return (
    <div className="demo-scenarios-panel">
      <div className="demo-scenarios-header">
        <div className="demo-header-text">
          <h3>LIVE DEMO</h3>
          <p>4 deterministic scenarios demonstrating RecoverAI</p>
        </div>
        <button className="button secondary" style={{marginRight: '8px'}} onClick={() => void simulateFailure()} disabled={resettingDemo || loading}>
          Simulate Payment Failure
        </button>
        <button className="button primary" onClick={() => void startDemo()} disabled={resettingDemo || loading}>
          {resettingDemo ? "Starting..." : "Start Demo"}
        </button>
      </div>
      <div className="demo-scenarios-grid">
        <div className={`demo-card ${isSelected('DEMO-A-AUTO') ? 'active' : ''}`} onClick={() => selectScenario('DEMO-A-AUTO', cases)}>
          <div className="demo-card-header">
            <h4>01 — Automatic Recovery</h4>
            {isSelected('DEMO-A-AUTO') && <div className="demo-active-dot" />}
          </div>
          <p>Policy-approved payment recovery</p>
          <code>DEMO-A-AUTO</code>
        </div>
        <div className={`demo-card ${isSelected('DEMO-B-HUMAN') ? 'active' : ''}`} onClick={() => selectScenario('DEMO-B-HUMAN', cases)}>
          <div className="demo-card-header">
            <h4>02 — Human Review</h4>
            {isSelected('DEMO-B-HUMAN') && <div className="demo-active-dot" />}
          </div>
          <p>Policy blocks automatic action</p>
          <code>DEMO-B-HUMAN</code>
        </div>
        <div className={`demo-card ${isSelected('DEMO-C-RECOVERED') ? 'active' : ''}`} onClick={() => selectScenario('DEMO-C-RECOVERED', cases)}>
          <div className="demo-card-header">
            <h4>03 — Recovered Payment</h4>
            {isSelected('DEMO-C-RECOVERED') && <div className="demo-active-dot" />}
          </div>
          <p>Successful customer payment</p>
          <code>DEMO-C-RECOVERED</code>
        </div>
        <div className={`demo-card ${isSelected('DEMO-D-STOPPED') ? 'active' : ''}`} onClick={() => selectScenario('DEMO-D-STOPPED', cases)}>
          <div className="demo-card-header">
            <h4>04 — Controlled Stopping</h4>
            {isSelected('DEMO-D-STOPPED') && <div className="demo-active-dot" />}
          </div>
          <p>Attempt limit reached & recovery closed</p>
          <code>DEMO-D-STOPPED</code>
        </div>
      </div>
    </div>
  );
}
