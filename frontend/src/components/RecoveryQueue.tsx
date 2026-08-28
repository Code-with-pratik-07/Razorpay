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
  return (
    <section className="queue-panel">
      <div className="list-header">
        <h2>Recovery Queue</h2>
        <span>{cases.length} cases</span>
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
                  {item.case_number}
                  <Badge value={item.status} />
                </div>
                <div className="case-item-meta">
                  {item.customer_email ?? "Unknown"} • {title(item.failure_reason)}
                </div>
              </div>
              <div className="case-item-amount">
                 {formatINR(item.amount)}
                 {item.recovery_probability != null && (
                   <span className="probability-score">
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
