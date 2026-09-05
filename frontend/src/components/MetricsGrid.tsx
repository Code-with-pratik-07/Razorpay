import React from 'react';
import { DashboardStats, formatINR, RecoveryCase } from '../types';

interface MetricsGridProps {
  stats: DashboardStats | null;
  cases: RecoveryCase[];
  setSelectedId: (id: string) => void;
}

const IconTrendDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 17 13 8 8 13 2 7"/><polyline points="16 17 22 17 22 11"/>
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const IconTrendUp = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13 16 8 11 2 17"/><polyline points="16 7 22 7 22 13"/>
  </svg>
);

const IconStack = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 2 7 12 12 22 7 12 2"/>
    <polyline points="2 17 12 22 22 17"/>
    <polyline points="2 12 12 17 22 12"/>
  </svg>
);

const IconZap = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);

const IconAlertTriangle = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

export function MetricsGrid({ stats, cases, setSelectedId }: MetricsGridProps) {
  return (
    <div className="metric-grid">

      <div className="metric">
        <div className="metric-header">
          <span className="metric-label">Revenue at Risk</span>
          <div className="metric-icon-wrap metric-icon-danger">
            <IconTrendDown />
          </div>
        </div>
        <div className="metric-value">{formatINR(stats?.revenue_at_risk ?? 0)}</div>
        <div className="metric-sub">Failed value eligible or under review.</div>
      </div>

      <div className="metric">
        <div className="metric-header">
          <span className="metric-label">Recovered Revenue</span>
          <div className="metric-icon-wrap metric-icon-success">
            <IconCheck />
          </div>
        </div>
        <div className="metric-value metric-value-success">{formatINR(stats?.revenue_recovered ?? 0)}</div>
        <div className="metric-sub">Revenue recovered through successful payment recovery.</div>
      </div>

      <div className="metric">
        <div className="metric-header">
          <span className="metric-label">Recovery Rate</span>
          <div className="metric-icon-wrap metric-icon-primary">
            <IconTrendUp />
          </div>
        </div>
        <div className="metric-value">{(stats?.recovery_rate ?? 0).toFixed(1)}%</div>
        <div className="metric-sub">Share of eligible recovery value successfully recovered.</div>
      </div>

      <div className="metric">
        <div className="metric-header">
          <span className="metric-label">Cases Processed</span>
          <div className="metric-icon-wrap metric-icon-slate">
            <IconStack />
          </div>
        </div>
        <div className="metric-value">{stats?.cases_processed ?? 0}</div>
        <div className="metric-sub">In decision pipeline</div>
      </div>

      <div className="metric">
        <div className="metric-header">
          <span className="metric-label">Automatic Recoveries</span>
          <div className="metric-icon-wrap metric-icon-success">
            <IconZap />
          </div>
        </div>
        <div className="metric-value">{stats?.automatic_recoveries ?? 0}</div>
        <div className="metric-sub">Automatic recoveries initiated</div>
      </div>

      <div
        className="metric warning-metric"
        onClick={() => {
          const hrCases = cases.filter(c => c.status === 'human_review');
          if (hrCases.length > 0) setSelectedId(hrCases[0].id);
        }}
        style={{ cursor: 'pointer' }}
        role="button"
        tabIndex={0}
      >
        <div className="metric-header-row">
          <span className="metric-label">Human Review Required</span>
          <div className="metric-icon-wrap metric-icon-warning">
            <IconAlertTriangle />
          </div>
        </div>
        <div className="metric-value">{stats?.human_review_cases ?? 0}</div>
        <div className="metric-footer">
          <span className="metric-sub">{formatINR(stats?.human_review_amount ?? 0)} at risk</span>
          <span className="metric-badge-warning">Action Needed</span>
        </div>
      </div>

    </div>
  );
}
