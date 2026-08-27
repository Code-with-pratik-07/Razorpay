import { useCallback, useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

type Status =
  | "failed"
  | "abandoned"
  | "analyzing"
  | "recovering"
  | "recovered"
  | "closed"
  | "human_review";

type AI = {
  recommended_action: string;
  reasoning: string;
  customer_message: string;
  confidence: number;
  source: "groq" | "fallback";
};

type RecoveryCase = {
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
  created_at: string;
};

type Explanation = RecoveryCase & {
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
};

type AuditEvent = {
  id: string;
  event_type: string;
  event_data: Record<string, unknown>;
  timestamp: string;
};

type Execution = {
  action: string;
  status: string;
  message: string;
  payment_link_url: string | null;
};

type TrainingResult = {
  samples_trained: number;
  model_path: string;
};

type DashboardStats = {
  revenue_at_risk: number;
  revenue_recovered: number;
  recovery_rate: number;
  cases_processed: number;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.detail ?? "Unable to complete the request.");
  }

  return body as T;
}

const formatINR = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", {
    maximumFractionDigits: 0,
  })}`;

const title = (value: string | null) =>
  value
    ? value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "—";

function Badge({
  value,
  kind = "status",
}: {
  value: string;
  kind?: "status" | "policy" | "action";
}) {
  return (
    <span className={`badge ${kind} ${value.replaceAll("_", "-")}`}>
      {title(value)}
    </span>
  );
}

function App() {
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecoveryCase | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const [actionLoading, setActionLoading] = useState<
    "analyze" | "execute" | "train" | "audit" | null
  >(null);

  const [trainingResult, setTrainingResult] =
    useState<TrainingResult | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);

  const [demoMode, setDemoMode] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);

  const refreshCases = useCallback(
    async (preserveSelection = true) => {
      setLoading(true);

      try {
        const [next, stats] = await Promise.all([
          api<RecoveryCase[]>("/api/cases?limit=1000"),
          api<DashboardStats>("/api/dashboard/stats").catch(() => null),
        ]);

        setCases(next);
        if (stats) setDashboardStats(stats);

        setSelectedId((currentSelectedId) => {
          return preserveSelection &&
            currentSelectedId &&
            next.some((item) => item.id === currentSelectedId)
              ? currentSelectedId
              : next[0]?.id ?? null;
        });

        setError(null);
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Could not load recovery cases."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const loadDetails = useCallback(async (id: string) => {
    setDetailLoading(true);
    setExecution(null);

    try {
      const [caseData, explanationData, auditData] = await Promise.all([
        api<RecoveryCase>(`/api/cases/${id}`),
        api<Explanation>(`/api/cases/${id}/explanation`),
        api<AuditEvent[]>(`/api/cases/${id}/audit`),
      ]);

      setSelected(caseData);
      setExplanation(explanationData);
      setAudit(auditData);
      setError(null);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not load case details."
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshCases(false);
    void api<{ demo_mode_enabled: boolean }>("/api/demo/status")
      .then((data) => setDemoMode(data.demo_mode_enabled))
      .catch(() => setDemoMode(false));
  }, [refreshCases]);

  const resetDemoData = async () => {
    if (!window.confirm("This will permanently delete all current data and regenerate a fresh demo dataset. Continue?")) return;

    setResettingDemo(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ message: string }>("/api/demo/reset", { method: "POST" });
      setNotice(res.message);
      await refreshCases(false);
      setSelectedId(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to reset demo data.");
    } finally {
      setResettingDemo(false);
    }
  };

  useEffect(() => {
    if (selectedId) {
      void loadDetails(selectedId);
    } else {
      setSelected(null);
      setExplanation(null);
      setAudit([]);
    }
  }, [selectedId, loadDetails]);

  const analyze = async () => {
    if (!selected) return;

    setActionLoading("analyze");
    setError(null);
    setNotice(null);

    try {
      const data = await api<Explanation>(
        `/api/cases/${selected.id}/analyze`,
        {
          method: "POST",
        }
      );

      setExplanation(data);
      setSelected(data);

      setNotice(
        "Analysis completed using ML, policy, and advisory AI."
      );

      await refreshCases();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Analysis could not be completed."
      );
    } finally {
      setActionLoading(null);
    }
  };

  const execute = async () => {
    if (!selected || explanation?.policy.allowed === false) return;

    setActionLoading("execute");
    setError(null);
    setNotice(null);

    try {
      const result = await api<Execution>(
        `/api/cases/${selected.id}/execute`,
        {
          method: "POST",
        }
      );

      setExecution(result);
      setNotice(result.message);

      await refreshCases();
      await loadDetails(selected.id);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Recovery execution could not be completed."
      );
    } finally {
      setActionLoading(null);
    }
  };

  const trainModel = async () => {
    setActionLoading("train");
    setError(null);
    setNotice(null);

    try {
      const result = await api<TrainingResult>("/api/model/train", {
        method: "POST",
      });

      setTrainingResult(result);

      setNotice(
        `Model trained successfully using ${result.samples_trained.toLocaleString()} samples.`
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Model training could not be completed."
      );
    } finally {
      setActionLoading(null);
    }
  };

  const refreshAudit = async () => {
    if (!selected) return;

    setActionLoading("audit");
    setError(null);
    setNotice(null);

    try {
      const auditData = await api<AuditEvent[]>(
        `/api/cases/${selected.id}/audit`
      );

      setAudit(auditData);

      setNotice(
        `Audit trail refreshed — ${auditData.length} events found.`
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Audit trail could not be loaded."
      );
    } finally {
      setActionLoading(null);
    }
  };

  const revenueData = useMemo(() => {
    if (!dashboardStats) return [];
    return [
      { name: "Recovered", value: dashboardStats.revenue_recovered },
      { name: "At Risk", value: dashboardStats.revenue_at_risk },
    ];
  }, [dashboardStats]);

  const statusData = useMemo(() => {
    const counts = cases.reduce((acc, curr) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts)
      .map(([name, value]) => ({ name: title(name), value }))
      .sort((a, b) => b.value - a.value);
  }, [cases]);

  const failureData = useMemo(() => {
    const counts = cases.reduce((acc, curr) => {
      const reason = curr.failure_reason || "unknown";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts)
      .map(([name, value]) => ({ name: title(name), value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5); // top 5
  }, [cases]);

  const COLORS = ['#10B981', '#EF4444', '#F59E0B', '#3B82F6', '#8B5CF6', '#64748B'];

  const policyAllowed =
    explanation?.policy.allowed ??
    selected?.policy_check_passed ??
    false;

  const existingPaymentLink = audit.find(
    (event) => event.event_type === "payment_link_created"
  )?.event_data.url;

  return (
    <div className="product-shell">
      <aside className="sidebar">
        <div className="logo">
          <span>R</span>
          <div>
            RAZORPAY
            <br />
            <b>RECOVERAI</b>
          </div>
        </div>

        <nav>
  <a
    className="active"
    href="#overview"
    onClick={(event) => {
      event.preventDefault();
      document
        .getElementById("overview")
        ?.scrollIntoView({ behavior: "smooth" });
    }}
  >
    Overview
  </a>

  <a
    href="#recovery-queue"
    onClick={(event) => {
      event.preventDefault();
      document
        .getElementById("recovery-queue")
        ?.scrollIntoView({ behavior: "smooth" });
    }}
  >
    Recovery Queue
  </a>

  <a
    href="#audit-trail"
    onClick={(event) => {
      event.preventDefault();
      document
        .getElementById("audit-trail")
        ?.scrollIntoView({ behavior: "smooth" });
    }}
  >
    Audit Trail
  </a>
</nav>

        <div className="sidebar-foot">
          <i /> Policy engine active
        </div>
      </aside>

      <main className="content" id="overview">
        <header className="topbar">
          <div>
            <p className="eyebrow">RECOVERY OPERATIONS</p>
            <h1>Revenue recovery, with guardrails.</h1>
          </div>

          <div className="top-actions">
            <button
              className="button ghost"
              onClick={() => void trainModel()}
              disabled={actionLoading !== null}
            >
              {actionLoading === "train"
                ? "Training…"
                : "↻ Train Recovery Model"}
            </button>

            <button
              className="button ghost"
              onClick={() => void refreshCases()}
              disabled={loading || actionLoading !== null}
            >
              ↻ Refresh data
            </button>
          </div>
        </header>

        {demoMode && (
          <div className="demo-banner">
            <div>
              <h3>Demo Environment Active</h3>
              <p>This is a safe sandbox. Data is synthetic and no real Razorpay or Groq API calls are made.</p>
            </div>
            <button
              className="button"
              onClick={() => void resetDemoData()}
              disabled={resettingDemo || loading}
            >
              {resettingDemo ? "Resetting Database..." : "Reset Demo Data"}
            </button>
          </div>
        )}

        {error && (
          <div className="alert error" role="alert">
            {error}
          </div>
        )}

        {notice && <div className="alert success">{notice}</div>}

        {trainingResult && (
          <div className="training-result">
            <strong>Recovery model trained successfully</strong>

            <span>
              {trainingResult.samples_trained.toLocaleString()} samples trained
            </span>
          </div>
        )}

        {dashboardStats && (
          <>
            <section className="metric-grid">
              <article className="metric failed">
                <small>Revenue At Risk</small>
                <strong>{formatINR(dashboardStats.revenue_at_risk)}</strong>
                <span>Actionable failed payments</span>
              </article>
              <article className="metric recovered">
                <small>Revenue Recovered</small>
                <strong>{formatINR(dashboardStats.revenue_recovered)}</strong>
                <span>Successfully captured</span>
              </article>
              <article className="metric all">
                <small>Recovery Rate</small>
                <strong>{(dashboardStats.recovery_rate * 100).toFixed(1)}%</strong>
                <span>Of total failed volume</span>
              </article>
              <article className="metric all">
                <small>Cases Processed</small>
                <strong>{dashboardStats.cases_processed.toLocaleString()}</strong>
                <span>Analyzed & executed</span>
              </article>
            </section>

            <section className="charts-grid">
              <div className="chart-card">
                <p className="eyebrow">RECOVERY PERFORMANCE</p>
                <h3>Revenue Recovered vs At Risk</h3>
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={revenueData}
                        cx="50%"
                        cy="50%"
                        innerRadius={65}
                        outerRadius={85}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {revenueData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip formatter={(value) => formatINR(value as number)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="chart-card">
                <p className="eyebrow">OPERATIONAL DISTRIBUTION</p>
                <h3>Case Status Breakdown</h3>
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} vertical={true} stroke="#E2E8F0" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                      <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 11, fill: '#475569' }} axisLine={false} tickLine={false} />
                      <RechartsTooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Bar dataKey="value" fill="#3B82F6" radius={[0, 4, 4, 0]} barSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="chart-card">
                <p className="eyebrow">FAILURE ANALYSIS</p>
                <h3>Top Failure Reasons</h3>
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={failureData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} horizontal={true} stroke="#E2E8F0" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
                      <RechartsTooltip cursor={{fill: '#F1F5F9'}} contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                      <Bar dataKey="value" fill="#8B5CF6" radius={[4, 4, 0, 0]} barSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>
          </>
        )}

        <section className="workspace">
          <div className="queue-panel" id="recovery-queue">
            <div className="section-heading">
              <div>
                <p className="eyebrow">LIVE QUEUE</p>
                <h2>Recovery cases</h2>
              </div>

              <span>{cases.length} cases</span>
            </div>

            {loading ? (
              <div className="empty">Loading recovery cases…</div>
            ) : cases.length === 0 ? (
              <div className="empty">
                No recovery cases yet. Verified failed-payment webhooks will
                appear here.
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Case</th>
                      <th>Customer</th>
                      <th>Amount</th>
                      <th>Failure</th>
                      <th>Potential</th>
                      <th>Policy</th>
                      <th>Status</th>
                    </tr>
                  </thead>

                  <tbody>
                    {cases.map((item) => (
                      <tr
                        className={
                          item.id === selectedId ? "selected" : ""
                        }
                        key={item.id}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td>
                          <b>{item.case_number}</b>
                          <small>{title(item.payment_method)}</small>
                        </td>

                        <td>
                          {item.customer_email ?? "Unknown"}
                        </td>

                        <td>{formatINR(item.amount)}</td>

                        <td>{title(item.failure_reason)}</td>

                        <td>
                          {item.recovery_probability === null
                            ? "—"
                            : `${Math.round(
                                item.recovery_probability * 100
                              )}%`}
                        </td>

                        <td>
                          <Badge
                            kind="policy"
                            value={
                              item.policy_check_passed
                                ? "allowed"
                                : "blocked"
                            }
                          />
                        </td>

                        <td>
                          <Badge value={item.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <aside className="details-panel">
            {detailLoading ? (
              <div className="empty">Loading case…</div>
            ) : !selected ? (
              <div className="empty">
                Select a case to view recovery details.
              </div>
            ) : (
              <>
                <div className="detail-title">
                  <div>
                    <p className="eyebrow">CASE DETAILS</p>
                    <h2>{selected.case_number}</h2>
                    <span>
                      Internal ID is used securely for API actions.
                    </span>
                  </div>

                  <Badge value={selected.status} />
                </div>

                <div className="detail-grid">
                  <div>
                    <small>Customer</small>
                    <b>
                      {selected.customer_email ?? "Unknown customer"}
                    </b>
                  </div>

                  <div>
                    <small>Payment</small>
                    <b>
                      {formatINR(selected.amount)} ·{" "}
                      {title(selected.payment_method)}
                    </b>
                  </div>

                  <div>
                    <small>Failure reason</small>
                    <b>{title(selected.failure_reason)}</b>
                  </div>

                  <div>
                    <small>Retries</small>
                    <b>
                      {selected.retry_count} / {selected.max_retries}
                    </b>
                  </div>
                </div>

                <div className="triad-container">
                  <section className="decision-card policy-card">
                    <p className="eyebrow">
                      POLICY DECISION · AUTHORITATIVE
                    </p>

                    <div>
                      <Badge
                        kind="policy"
                        value={
                          policyAllowed ? "allowed" : "blocked"
                        }
                      />

                      <b>
                        {explanation?.policy.reason ??
                          selected.policy_reason ??
                          "Awaiting policy check"}
                      </b>
                    </div>

                    {explanation?.policy.retry_after && (
                      <small>
                        Retry available after{" "}
                        {new Date(
                          explanation.policy.retry_after
                        ).toLocaleString()}
                      </small>
                    )}
                  </section>

                  <section className="decision-card ai-card">
                    <p className="eyebrow">
                      AI RECOMMENDATION · ADVISORY
                    </p>

                    {explanation?.ai ? (
                      <>
                        <div>
                          <Badge
                            kind="action"
                            value={explanation.ai.recommended_action}
                          />

                          <b>
                            {Math.round(
                              explanation.ai.confidence * 100
                            )}
                            % confidence ·{" "}
                            {explanation.ai.source === "groq"
                              ? "Groq"
                              : "Deterministic fallback"}
                          </b>
                        </div>

                        <p>{explanation.ai.reasoning}</p>

                        <blockquote>
                          {explanation.ai.customer_message}
                        </blockquote>
                      </>
                    ) : (
                      <p>Run analysis to generate an explanation.</p>
                    )}
                  </section>

                  <section className="decision-card history-card">
                    <p className="eyebrow">CUSTOMER HISTORY</p>

                    <div className="history">
                      <span>
                        Lifetime value
                        <b>
                          {formatINR(
                            explanation?.customer_history
                              .lifetime_value ?? 0
                          )}
                        </b>
                      </span>

                      <span>
                        Successful payments
                        <b>
                          {explanation?.customer_history
                            .successful_payments ?? 0}
                        </b>
                      </span>

                      <span>
                        Failed payments
                        <b>
                          {explanation?.customer_history
                            .failed_payments ?? 0}
                        </b>
                      </span>
                    </div>

                    {explanation?.policy.allowed === false && (
                      <div className="policy-reason">
                        Policy Block: {explanation.policy.reason}
                      </div>
                    )}
                  </section>
                </div>

                <div className="actions">
                  <button
                    className="button secondary"
                    onClick={() => void analyze()}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === "analyze"
                      ? "Analyzing…"
                      : "Analyze"}
                  </button>

                  {selected.status === "recovering" ? (
                    <div className="in-progress">
                      Payment Link recovery is already in progress. A new
                      automatic action is not offered.
                    </div>
                  ) : policyAllowed ? (
                    <button
                      className="button"
                      onClick={() => void execute()}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === "execute"
                        ? "Executing…"
                        : `Execute ${title(
                            explanation?.ai?.recommended_action ??
                              selected.recovery_action
                          )}`}
                    </button>
                  ) : (
                    <div className="human-review">
                      Human Review required — automatic recovery is
                      unavailable.
                    </div>
                  )}
                </div>

                {(execution || existingPaymentLink) && (
                  <section className="execution-result">
                    <p className="eyebrow">
                      FINAL EXECUTED ACTION
                    </p>

                    <b>
                      {execution
                        ? `${title(execution.action)} · ${title(
                            execution.status
                          )}`
                        : `Payment Link · ${title(
                            selected.status
                          )}`}
                    </b>

                    <p>
                      {execution?.message ??
                        "Payment Link created previously; recovery is in progress."}
                    </p>

                    {(execution?.payment_link_url ||
                      typeof existingPaymentLink === "string") && (
                      <div className="link-actions">
                        <a
                          href={
                            (execution?.payment_link_url ||
                              existingPaymentLink) as string
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open payment link ↗
                        </a>

                        <button
                          onClick={() =>
                            void navigator.clipboard.writeText(
                              (execution?.payment_link_url ||
                                existingPaymentLink) as string
                            )
                          }
                        >
                          Copy link
                        </button>
                      </div>
                    )}
                  </section>
                )}

                <section className="audit-section" id="audit-trail">
                  <div className="audit-heading">
                    <p className="eyebrow">AUDIT TIMELINE</p>

                    <button
                      className="button ghost"
                      onClick={() => void refreshAudit()}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === "audit"
                        ? "Refreshing…"
                        : "↻ Refresh Audit"}
                    </button>
                  </div>

                  {audit.length ? (
                    <div className="audit-timeline">
                      {audit.map((event) => (
                        <div className="audit-item" key={event.id}>
                          <i />

                          <div>
                            <b>{title(event.event_type)}</b>

                            <small>
                              {new Date(
                                event.timestamp
                              ).toLocaleString()}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="empty">No audit events available.</p>
                  )}
                </section>
              </>
            )}
          </aside>
        </section>
      </main>
    </div>
  );
}

export default App;