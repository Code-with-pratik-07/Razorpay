export type Status = "failed" | "abandoned" | "analyzing" | "recovering" | "recovered" | "closed" | "human_review";

export type AI = {
  recommended_action: string;
  reasoning: string;
  customer_message: string;
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
  ml_decision: "HIGH" | "UNCERTAIN" | "LOW" | null;
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
};

export const formatINR = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

export const title = (value: string | null) =>
  value ? value.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()) : "—";
