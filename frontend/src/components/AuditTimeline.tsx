import React from 'react';
import { AuditEvent, title, formatDate } from '../types';

interface AuditTimelineProps {
  audit: AuditEvent[];
}

/** Mask customer phone number (e.g. +91 98765 43210 -> +91 98765 •••••) */
function maskPhone(phone?: unknown): string {
  if (!phone || typeof phone !== 'string') return '';
  const trimmed = phone.trim();
  if (trimmed.length > 5) {
    return trimmed.slice(0, trimmed.length - 5) + ' •••••';
  }
  return '•••••';
}

/** Mask or truncate payment link URL */
function maskUrl(url?: unknown): string {
  if (!url || typeof url !== 'string') return 'Payment Link Generated';
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    const last = pathParts[pathParts.length - 1] || '';
    const maskedLast = last.length > 4 ? `••••${last.slice(-4)}` : '••••';
    return `${u.host}/${pathParts.slice(0, -1).join('/')}/${maskedLast}`.replace('//', '/');
  } catch {
    return 'Payment Link Generated';
  }
}

/** Sanitize event payload to prevent exposure of sensitive PII or secrets */
function sanitizeEventData(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data || {})) {
    const key = k.toLowerCase();
    if (key.includes('secret') || key.includes('token') || key.includes('password') || key.includes('api_key')) {
      result[k] = '••••••••';
    } else if (key.includes('phone') || key.includes('recipient') || key.includes('contact')) {
      result[k] = typeof v === 'string' ? maskPhone(v) : v;
    } else if (key.includes('url') || key.includes('link')) {
      result[k] = typeof v === 'string' ? maskUrl(v) : v;
    } else if (key === 'message' && typeof v === 'string' && v.length > 120) {
      result[k] = v.slice(0, 120) + '...';
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = sanitizeEventData(v as Record<string, unknown>);
    } else {
      result[k] = v;
    }
  }
  return result;
}

/** Get human-readable title, summary, kind and chips for each audit event type */
function getEventDescriptor(event: AuditEvent): {
  title: string;
  summary: string;
  kind: 'success' | 'warning' | 'info' | 'danger';
  chips: string[];
} {
  const type = event.event_type.toLowerCase();
  const data = (event.event_data || {}) as Record<string, any>;
  const chips: string[] = [];

  switch (type) {
    case 'failure_detected':
    case 'webhook_received':
      return {
        title: 'Payment Failure Detected',
        summary: data.amount
          ? `Payment of ₹${(Number(data.amount) / 100).toLocaleString('en-IN')} could not be completed.`
          : `Payment failure detected${data.reason ? ` (${data.reason})` : ''}.`,
        kind: 'danger',
        chips: data.note ? [String(data.note)] : [],
      };

    case 'ml_prediction': {
      const prob = Math.round(Number(data.recovery_probability ?? 0.95) * 100);
      chips.push(`${prob}% Probability`);
      if (prob >= 75) chips.push('High Confidence');
      else if (prob >= 50) chips.push('Medium Confidence');
      return {
        title: 'ML Recovery Prediction',
        summary: `${prob}% probability of successful recovery.`,
        kind: 'info',
        chips,
      };
    }

    case 'policy_check': {
      const allowed = Boolean(data.allowed);
      chips.push(allowed ? 'Policy Passed' : 'Policy Blocked');
      return {
        title: allowed ? 'Recovery Policy Approved' : 'Recovery Policy Blocked',
        summary: String(data.reason || (allowed ? 'Automatic recovery was approved.' : 'Transaction requires manual human review.')),
        kind: allowed ? 'success' : 'warning',
        chips,
      };
    }

    case 'ai_analysis': {
      const conf = Math.round(Number(data.confidence ?? 0.95) * 100);
      chips.push(`AI Confidence ${conf}%`);
      if (data.recommended_action) chips.push(title(String(data.recommended_action)));
      return {
        title: 'AI Advisory Recommendation',
        summary: String(data.reasoning || (data.customer_message ? `Recommendation: "${data.customer_message}"` : 'AI recovery analysis completed.')),
        kind: 'info',
        chips,
      };
    }

    case 'recovery_started':
      chips.push(data.automatic ? 'Automatic' : 'Manual');
      return {
        title: 'Recovery Execution Started',
        summary: 'Automated recovery execution workflow initiated.',
        kind: 'info',
        chips,
      };

    case 'payment_link_created':
      chips.push('Active 7 Days');
      return {
        title: 'Payment Link Created',
        summary: 'A secure recovery payment link was generated.',
        kind: 'info',
        chips,
      };

    case 'channel_intelligence_evaluated': {
      const chName = title(String(data.recommended_channel || 'WhatsApp'));
      const score = Math.round(Number(data.suitability_score ?? 0.9) * 100);
      chips.push(chName);
      chips.push(`Score: ${score}%`);
      return {
        title: 'Channel Intelligence Evaluated',
        summary: `${chName} selected as optimal recovery channel (Suitability: ${score}%).`,
        kind: 'info',
        chips,
      };
    }

    case 'channel_communication_dispatched': {
      const chName = title(String(data.channel || 'WhatsApp'));
      chips.push(chName);
      chips.push(`Attempt ${data.attempt_number || 1}`);
      return {
        title: `${chName} Communication Sent`,
        summary: `Recovery communication delivered through ${chName} (Attempt ${data.attempt_number || 1}).`,
        kind: 'success',
        chips,
      };
    }

    case 'payment_link_clicked': {
      chips.push('Engagement Registered');
      if (data.channel) chips.push(title(String(data.channel)));
      return {
        title: 'Customer Opened Payment Link',
        summary: 'The customer opened the recovery payment page.',
        kind: 'success',
        chips,
      };
    }

    case 'recovery_reminder_dispatched': {
      const chName = title(String(data.channel || 'WhatsApp'));
      chips.push(chName);
      chips.push(`Attempt ${data.attempt_number || 2}`);
      if (data.wait_period) chips.push(`Wait: ${data.wait_period}`);
      return {
        title: `${chName} Reminder Sent`,
        summary: `A follow-up reminder was sent through ${chName} (Attempt ${data.attempt_number || 2}).`,
        kind: 'success',
        chips,
      };
    }

    case 'channel_switched': {
      const chUpper = String(data.channel || 'SMS').toUpperCase();
      chips.push(`Switched to ${chUpper}`);
      chips.push(`Attempt ${data.attempt_number || 2}`);
      return {
        title: `Channel Switched to ${chUpper}`,
        summary: String(data.reason || `Switched communication to ${chUpper} for Attempt ${data.attempt_number || 2}.`),
        kind: 'warning',
        chips,
      };
    }

    case 'observation_period_started': {
      const wait = String(data.wait_period || '24 hours');
      chips.push(`Window: ${wait}`);
      if (data.remaining_attempts !== undefined) {
        chips.push(`${data.remaining_attempts} Remaining Attempt${Number(data.remaining_attempts) === 1 ? '' : 's'}`);
      }
      return {
        title: 'Observation Period Started',
        summary: `RecoverAI is waiting ${wait} for customer activity before considering further outreach.`,
        kind: 'info',
        chips,
      };
    }

    case 'payment_captured':
    case 'payment_success':
      chips.push('Payment Completed');
      return {
        title: 'Customer Payment Received',
        summary: 'Customer completed recovery payment successfully.',
        kind: 'success',
        chips,
      };

    case 'case_recovered':
      chips.push('Recovered');
      return {
        title: 'Recovery Completed',
        summary: 'Case marked as recovered — funds settled successfully.',
        kind: 'success',
        chips,
      };

    case 'recovery_closed':
      chips.push('Closed');
      return {
        title: 'Recovery Closed',
        summary: String(data.reason || 'Recovery closed: Maximum communication attempts completed.'),
        kind: 'info',
        chips,
      };

    case 'recovery_abandoned':
      chips.push('Abandoned');
      return {
        title: 'Recovery Abandoned',
        summary: String(data.reason || 'Maximum recovery attempts exhausted.'),
        kind: 'warning',
        chips,
      };

    case 'human_escalation':
      chips.push('Human Review');
      return {
        title: 'Escalated for Human Review',
        summary: String(data.reason || 'Case escalated for risk operations approval.'),
        kind: 'warning',
        chips,
      };

    case 'human_approval':
      chips.push('Approved');
      return {
        title: 'Manual Approval Granted',
        summary: String(data.notes || 'Approved by risk operations specialist.'),
        kind: 'success',
        chips,
      };

    case 'recovery_attribution_recorded':
      chips.push('Attributed');
      return {
        title: 'Recovery Attribution Recorded',
        summary: String(data.signal || `Payment attributed to ${title(String(data.channel || 'SMS'))} communication.`),
        kind: 'success',
        chips,
      };

    case 'email_notification_sent':
      chips.push('Email Sent');
      return {
        title: 'Customer Recovery Email Sent',
        summary: 'Email notification delivered to customer.',
        kind: 'success',
        chips,
      };

    case 'email_notification_failed':
      chips.push('Email Failed');
      return {
        title: 'Customer Notification Failed',
        summary: String(data.reason || 'Failed to dispatch email notification.'),
        kind: 'warning',
        chips,
      };

    case 'case_created':
      return {
        title: 'Recovery Case Created',
        summary: 'Payment failure ingested and recovery case opened.',
        kind: 'info',
        chips: [],
      };

    default:
      return {
        title: title(event.event_type),
        summary: String(data.reason || data.message || data.note || 'Audit event recorded.'),
        kind: type.includes('fail') || type.includes('block') || type.includes('escalat')
          ? 'warning'
          : type.includes('success') || type.includes('recover') || type.includes('sent')
          ? 'success'
          : 'info',
        chips: [],
      };
  }
}

export function AuditTimeline({ audit }: AuditTimelineProps) {
  // Filter out internal low-level provider simulation logs (e.g. raw simulated payload dumps)
  // Canonical business events (channel_communication_dispatched, recovery_reminder_dispatched) represent them cleanly
  const HIDDEN_INTERNAL_EVENTS = new Set([
    'whatsapp_notification_simulated',
    'sms_notification_simulated',
  ]);

  const visibleEvents = audit.filter(
    (e) => !HIDDEN_INTERNAL_EVENTS.has(e.event_type.toLowerCase())
  );

  return (
    <div className="audit-journey">
      <h3>Recovery Journey</h3>
      {visibleEvents.length === 0 ? (
        <div className="empty-state">No events recorded.</div>
      ) : (
        <div className="timeline">
          {visibleEvents.map((event) => {
            const desc = getEventDescriptor(event);
            const sanitized = sanitizeEventData(event.event_data || {});

            return (
              <div key={event.id} className={`timeline-event ${desc.kind}`}>
                <div className="timeline-dot" />
                <div className="timeline-time">{formatDate(event.timestamp)}</div>
                <div className="timeline-content">
                  <div className="timeline-card">
                    <div className="timeline-card-header">
                      <div className="timeline-title">
                        {desc.title}
                      </div>
                      {desc.chips.length > 0 && (
                        <div className="timeline-meta-chips">
                          {desc.chips.map((chip, i) => (
                            <span key={i} className="timeline-chip">
                              {chip}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="timeline-summary">
                      {desc.summary}
                    </div>

                    {/* Technical Details Accordion for auditability without visual clutter */}
                    {Object.keys(sanitized).length > 0 && (
                      <details className="audit-tech-details">
                        <summary className="audit-tech-summary">Technical Details</summary>
                        <pre className="audit-tech-pre">{JSON.stringify(sanitized, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
