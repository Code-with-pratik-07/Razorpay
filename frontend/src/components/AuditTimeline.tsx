import React from 'react';
import { AuditEvent, title, formatDate } from '../types';

interface AuditTimelineProps {
  audit: AuditEvent[];
}

export function AuditTimeline({ audit }: AuditTimelineProps) {
  return (
    <div className="audit-journey">
       <h3>Recovery Journey</h3>
       {audit.length === 0 ? (
         <div className="empty-state">No events recorded.</div>
       ) : (
         <div className="timeline">
           {audit.map((event) => {
             const type = event.event_type.toLowerCase();
             const kind = type.includes('fail') || type.includes('block') || type.includes('escalat') ? 'warning' : type.includes('success') || type.includes('recover') || type.includes('sent') ? 'success' : 'info';

             const auditLabels: Record<string, string> = {
               "webhook_received": "Payment failure received",
               "failure_detected": "Payment failure detected",
               "case_created": "Recovery case created",
               "ml_prediction": "ML prediction generated",
               "policy_check": "Recovery policy evaluated",
               "recovery_started": "Recovery execution started",
               "payment_link_created": "Razorpay Payment Link created",
               "email_notification_sent": "Customer recovery email sent",
               "email_notification_failed": "Customer notification failed",
               "payment_success": "Customer payment received",
               "payment_captured": "Customer payment received",
               "case_recovered": "Recovery completed",
               "ai_analysis": "AI Advisory recommendation",
               "human_escalation": "Escalated for human review"
             };
             const label = auditLabels[type] || title(event.event_type);

             return (
               <div key={event.id} className={`timeline-event ${kind}`}>
                  <div className="timeline-dot" />
                  <div className="timeline-time">{formatDate(event.timestamp)}</div>
                  <div className="timeline-content">
                     <b>{label}</b>
                     <pre>{JSON.stringify(event.event_data, null, 2)}</pre>
                  </div>
               </div>
             )
           })}
         </div>
       )}
    </div>
  );
}
