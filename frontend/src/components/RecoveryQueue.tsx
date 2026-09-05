import React from 'react';
import { RecoveryCase, formatINR, title } from '../types';
import { Badge } from './Badge';

interface RecoveryQueueProps {
  cases: RecoveryCase[];
  loading: boolean;
  selectedId: string | null;
  setSelectedId: (id: string) => void;
}

export function RecoveryQueue({ cases, loading, selectedId, setSelectedId }: RecoveryQueueProps) {
  const getScoreClass = (score: number) => {
    const pct = Math.round(score * 100);
    if (pct >= 70) return 'score-high';
    if (pct >= 40) return 'score-mid';
    return 'score-low';
  };

  return (
    <section className="queue-panel">
      <div className="list-header">
        <h2>Recovery Queue</h2>
        <span className="queue-count-badge">{cases.length} cases</span>
      </div>
      <div className="case-list">
        {loading && cases.length === 0 ? (
          <div className="empty-state">Loading cases...</div>
        ) : (
          cases.map(item => (
            <div
              key={item.id}
              className={`case-item ${selectedId === item.id ? 'active' : ''}`}
              onClick={() => setSelectedId(item.id)}
            >
              <div className="case-item-main">
                <div className="case-item-title">
                  <span className="case-number">{item.case_number}</span>
                  <Badge value={item.status} />
                </div>
                <div className="case-item-meta">
                  {item.customer_email ?? "Not specified"} • {title(item.failure_reason)}
                </div>
              </div>
              <div className="case-item-amount">
                 <div className="amount-val">{formatINR(item.amount)}</div>
                 {item.recovery_probability != null && (
                   <span className={`probability-score ${getScoreClass(item.recovery_probability)}`}>
                     {(item.recovery_probability * 100).toFixed(0)}% score
                   </span>
                 )}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
