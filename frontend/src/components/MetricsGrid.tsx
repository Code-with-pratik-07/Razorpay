import React from 'react';
import { DashboardStats, formatINR, RecoveryCase } from '../types';

interface MetricsGridProps {
  stats: DashboardStats | null;
  cases: RecoveryCase[];
  setSelectedId: (id: string) => void;
}

export function MetricsGrid({ stats, cases, setSelectedId }: MetricsGridProps) {
  return (
    <div className="metric-grid">
      <div className="metric">
        <span className="metric-label">Revenue at Risk</span>
        <div className="metric-value">{formatINR(stats?.revenue_at_risk ?? 0)}</div>
        <div className="metric-sub">Failed value currently eligible or under review.</div>
      </div>
      <div className="metric">
        <span className="metric-label">Recovered Revenue</span>
        <div className="metric-value" style={{ color: 'var(--color-success)' }}>{formatINR(stats?.revenue_recovered ?? 0)}</div>
        <div className="metric-sub">Revenue recovered through successful payment recovery.</div>
      </div>
      <div className="metric">
        <span className="metric-label">Recovery Rate</span>
        <div className="metric-value">{(stats?.recovery_rate ?? 0).toFixed(1)}%</div>
        <div className="metric-sub">Share of eligible recovery value successfully recovered.</div>
      </div>
      <div className="metric">
        <span className="metric-label">Cases Processed</span>
        <div className="metric-value">{stats?.cases_processed ?? 0}</div>
        <div className="metric-sub">In decision pipeline</div>
      </div>
      <div className="metric">
        <span className="metric-label">Automatic Recoveries</span>
        <div className="metric-value">{stats?.automatic_recoveries ?? 0}</div>
        <div className="metric-sub">Automatic recoveries initiated</div>
      </div>
      <div className="metric warning-metric" onClick={() => {
        const hrCases = cases.filter(c => c.status === 'human_review');
        if (hrCases.length > 0) setSelectedId(hrCases[0].id);
      }} style={{ cursor: 'pointer' }}>
        <span className="metric-label">HUMAN REVIEW REQUIRED</span>
        <div className="metric-value">{stats?.human_review_cases ?? 0} CASES</div>
        <div className="metric-sub">{formatINR(stats?.human_review_amount ?? 0)} AT RISK</div>
      </div>
    </div>
  );
}
