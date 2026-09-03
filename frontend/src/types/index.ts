export type Status = "failed" | "abandoned" | "analyzing" | "recovering" | "recovered" | "closed" | "human_review";

export type AI = {
  recommended_action: string;
  reasoning: string;
  customer_message: string | null;
  confidence: number;
  source: "groq" | "fallback";
};

export type RecoveryCase = {
  id: string;
  case_number: string;
  customer_email: string | null;
  amount: number;
  currency: string;
  status: Status;
  failure_reason: string | null;
  payment_method: string | null;
  recovery_probability: number | null;
  recovery_action: string;
  retry_count: number;
  max_retries: number;
  policy_check_passed: boolean | null;
  policy_reason: string | null;
  notification_status: string | null;
  created_at: string;
  next_action_at: string | null;
  next_action_type: string;
  payment_link_expires_at: string | null;
  last_notification_at: string | null;
  last_payment_status?: string | null;
  last_payment_attempt_at?: string | null;
  last_payment_failure_reason?: string | null;
  selected_channel?: string | null;
};

export type DecisionBasisItem = {
  factor: string;
  impact: "positive" | "negative" | "neutral";
  description: string;
};

export type DecisionFactorSummary = {
  name: string;
  status: string;
  score: number;
};

export type FollowupDecision = {
  previous_outcome: string | null;
  recommended_wait_period: string;
  next_action: string;
  selected_channel: string | null;
  reason: string;
};

export type CommunicationAttemptSummary = {
  id?: string | null;
  attempt_number: number;
  channel: string;
  status: string;
  outcome: string;
  simulated: boolean;
  recipient?: string | null;
  message_snippet?: string | null;
  recovery_attributed?: boolean;
  created_at: string | null;
};

export type ChannelIntelligence = {
  communication_maturity: "COLD_START" | "LEARNING" | "ESTABLISHED";
  maturity_description: string;
  recommended_channel: "email" | "sms" | "whatsapp" | string;
  suitability_score: number;
  confidence: "low" | "medium" | "high";
  confidence_score: number;
  reason: string;
  decision_basis: DecisionBasisItem[];
  decision_factors: DecisionFactorSummary[];
  channel_scores: Record<string, number>;
  alternatives: string[];
  status: string;
  attempts_count: number;
  last_channel_used?: string | null;
  last_communicated_at?: string | null;
  communication_journey: CommunicationAttemptSummary[];
  opted_out_channels: string[];
  attributed_channel?: string | null;
  followup_decision?: FollowupDecision | null;
};

export type Explanation = RecoveryCase & {
  ml: {
    recovery_probability: number | null;
    features: Record<string, unknown>;
  };
  policy: {
    allowed: boolean;
    reason: string;
    requires_human_approval: boolean;
    retry_after: string | null;
  };
  ai: AI | null;
  customer_history: {
    lifetime_value: number;
    successful_payments: number;
    failed_payments: number;
  };
  ml_decision: "HIGH" | "UNCERTAIN" | "LOW" | "COLD_START" | null;
  execution_error?: string | null;
  manual_execution: boolean;
  channel_intelligence?: ChannelIntelligence | null;
  human_review_status?: "NOT_REQUIRED" | "REQUIRED" | "APPROVED" | "REJECTED";
  payment_link_status?: "ACTIVE" | "EXPIRED" | "PAID" | "NONE";
  communication_status?: "PAUSED" | "READY" | "GENERATED" | "SENT" | "SIMULATED" | "NOT_AVAILABLE" | "COMPLETED" | "FAILED" | "EXHAUSTED";
  customer_payment_status?: "PENDING" | "RECEIVED" | "EXHAUSTED" | "FAILED" | "NONE";
  recommended_channel?: string;
  dispatched_channel?: string | null;
};

export type AuditEvent = {
  id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  timestamp: string;
};

export type Execution = {
  action: string;
  status: string;
  message: string;
  payment_link_url: string | null;
};

export type DashboardStats = {
  revenue_at_risk: number;
  revenue_recovered: number;
  recovery_rate: number;
  cases_processed: number;
  human_review_cases: number;
  human_review_amount: number;
  automatic_recoveries: number;
  customer_payment_status: Record<string, number>;
};

export const formatINR = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const title = (value: string | null) => {
  if (!value) return "—";
  const lower = value.toLowerCase().trim();
  if (lower === "whatsapp") return "WhatsApp";
  if (lower === "sms") return "SMS";
  if (lower === "email") return "Email";
  let formatted = value.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase());
  return formatted.replace(/\bWhatsapp\b/g, "WhatsApp").replace(/\bSms\b/g, "SMS");
};

export const formatDate = (timestamp: string | null | undefined): string => {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).toUpperCase();
};
