import { useCallback, useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

type Status = "failed" | "abandoned" | "analyzing" | "recovering" | "recovered" | "closed" | "human_review";

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
  notification_status: string | null;
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
  human_review_cases: number;
  human_review_amount: number;
  automatic_recoveries: number;
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
  `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const title = (value: string | null) =>
  value ? value.replaceAll("_", " ").replace(/\b\w/g, (l) => l.toUpperCase()) : "—";

function Badge({ value, kind = "status" }: { value: string; kind?: "status" | "policy" | "action" }) {
  return <span className={`badge ${kind} ${value.replaceAll("_", "-")}`}>{title(value)}</span>;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip">
        <div className="label">{payload[0].name}</div>
        <div className="desc">{typeof payload[0].value === 'number' && payload[0].value > 1000 ? formatINR(payload[0].value) : payload[0].value}</div>
      </div>
    );
  }
  return null;
};

export default function App() {
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecoveryCase | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<"analyze" | "execute" | "train" | "audit" | null>(null);
  const [trainingResult, setTrainingResult] = useState<TrainingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [demoMode, setDemoMode] = useState(false);
  const [resettingDemo, setResettingDemo] = useState(false);

  const refreshCases = useCallback(async (preserveSelection = true) => {
    setLoading(true);
    try {
      const [next, stats] = await Promise.all([
        api<RecoveryCase[]>("/api/cases?limit=1000"),
        api<DashboardStats>("/api/dashboard/stats").catch(() => null),
      ]);
      setCases(next);
      if (stats) setDashboardStats(stats);
      setSelectedId((currentSelectedId) => {
        return preserveSelection && currentSelectedId && next.some((item) => item.id === currentSelectedId)
          ? currentSelectedId : next[0]?.id ?? null;
      });
      setError(null);
      return next;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load recovery cases.");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetails = useCallback(async (id: string) => {
    setDetailLoading(true);
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
      setError(requestError instanceof Error ? requestError.message : "Could not load case details.");
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
    if (!window.confirm("This will permanently delete all current data and regenerate a fresh demo dataset. Continue?")) return [];
    setResettingDemo(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ message: string }>("/api/demo/reset", { method: "POST" });
      setNotice(res.message);
      const newCases = await refreshCases(false);
      setSelectedId(null);
      return newCases || [];
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to reset demo data.");
      return [];
    } finally {
      setResettingDemo(false);
    }
  };

  const selectScenario = (caseNumber: string, list: RecoveryCase[]) => {
    const c = list.find(x => x.case_number === caseNumber);
    if (c) {
      setSelectedId(c.id);
      document.getElementById('recovery-queue')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const startDemo = async () => {
    const newCases = await resetDemoData();
    selectScenario('DEMO-A-AUTO', newCases);
  };

  useEffect(() => {
    setExecution(null); // Fix: Clear execution only when changing cases
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
      const data = await api<Explanation>(`/api/cases/${selected.id}/analyze`, { method: "POST" });
      setExplanation(data);
      setSelected(data);
      setNotice("Analysis completed using ML, policy, and advisory AI.");
      await refreshCases();
      await loadDetails(selected.id); // Fix: Update audit log
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Analysis could not be completed.");
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
      const result = await api<Execution>(`/api/cases/${selected.id}/execute`, { method: "POST" });
      setExecution(result);
      setNotice(result.message);
      await refreshCases();
      await loadDetails(selected.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Recovery execution could not be completed.");
    } finally {
      setActionLoading(null);
    }
  };

  const trainModel = async () => {
    setActionLoading("train");
    setError(null);
    setNotice(null);
    try {
      const result = await api<TrainingResult>("/api/model/train", { method: "POST" });
      setTrainingResult(result);
      setNotice(`Model trained successfully using ${result.samples_trained.toLocaleString()} samples.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Model training could not be completed.");
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
    return Object.entries(counts).map(([name, value]) => ({ name: title(name), value })).sort((a, b) => b.value - a.value);
  }, [cases]);

  const failureData = useMemo(() => {
    const counts = cases.reduce((acc, curr) => {
      const reason = curr.failure_reason || "unknown";
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    return Object.entries(counts).map(([name, value]) => ({ name: title(name), value })).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [cases]);

  const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#8B5CF6', '#EF4444', '#64748B'];

  const policyAllowed = explanation?.policy.allowed ?? selected?.policy_check_passed ?? false;
  const existingPaymentLink = audit.find((event) => event.event_type === "payment_link_created")?.event_data.url as string | undefined;
  const currentLink = execution?.payment_link_url || existingPaymentLink;

  const recoveryStartedEvent = audit.find((e) => e.event_type === "recovery_started");
  const isAutomatic = recoveryStartedEvent?.event_data.automatic === true;
  const executionMode = isAutomatic ? "AUTOMATIC" : recoveryStartedEvent ? "MANUAL" : "";

  return (
    <div className="product-shell">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-icon">R</div>
          <div>
            <b>RecoverAI</b>
            <small>Payment Recovery Intelligence</small>
          </div>
        </div>

        <nav>
          <a className="active" href="#overview">Overview</a>
          <a href="#recovery-queue">Recovery Queue</a>
        </nav>

        <div className="sidebar-foot">
          <span className="status-dot" /> System Operational
        </div>
      </aside>

      <main className="content" id="overview">
        <header className="dashboard-hero">
          <div>
            <h1>Payment Recovery Intelligence</h1>
            <p className="dashboard-story">
              Turn failed payments into recovered revenue.
              <span>ML predicts. Policy decides. AI recommends. Recovery executes.</span>
            </p>
          </div>
          {demoMode && (
            <div className="demo-badge">
              <strong>DEMO MODE</strong> · Razorpay Test Environment
            </div>
          )}
        </header>

        {demoMode && (
          <div className="demo-scenarios-panel">
            <div className="demo-scenarios-header">
              <h3>LIVE DEMO</h3>
              <button className="button secondary" onClick={() => void startDemo()} disabled={resettingDemo || loading}>
                {resettingDemo ? "Starting..." : "Start Demo"}
              </button>
            </div>
            <div className="demo-scenarios-grid">
              <div className="demo-card" onClick={() => selectScenario('DEMO-A-AUTO', cases)}>
                <h4>01 Automatic Recovery</h4>
                <p>Policy-approved payment recovery</p>
              </div>
              <div className="demo-card" onClick={() => selectScenario('DEMO-B-HUMAN', cases)}>
                <h4>02 Human Review</h4>
                <p>Policy blocks automatic action</p>
              </div>
              <div className="demo-card" onClick={() => selectScenario('DEMO-C-RECOVERED', cases)}>
                <h4>03 Recovered Payment</h4>
                <p>Customer successfully completes payment</p>
              </div>
              <div className="demo-card" onClick={() => selectScenario('DEMO-D-DUPLICATE', cases)}>
                <h4>04 Duplicate Protection</h4>
                <p>Existing recovery cannot execute twice</p>
              </div>
            </div>

            <div className="how-it-works-panel">
              <h4>HOW RECOVERAI WORKS</h4>
              <div className="pipeline-horizontal">
                <div><b>PAYMENT FAILURE</b></div>
                <div>↓<br/><b>ML PREDICTION</b><br/><small>Predicts the likelihood of successful recovery.</small></div>
                <div>↓<br/><b>POLICY ENGINE</b><br/><small>Authoritatively decides whether recovery is allowed.</small></div>
                <div>↓<br/><b>AI ADVISOR</b><br/><small>Provides an advisory recommendation and explanation.</small></div>
                <div>↓<br/><b>AUTOMATIC RECOVERY</b><br/><small>Creates a legitimate Razorpay Payment Link when authorized.</small></div>
                <div>↓<br/><b>CUSTOMER PAYMENT</b><br/><small>Customer completes the outstanding payment.</small></div>
                <div>↓<br/><b>RECOVERED</b><br/><small>Webhook confirms successful payment and closes case.</small></div>
              </div>
            </div>
          </div>
        )}

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <div className="metric-grid">
          <div className="metric">
            <span className="metric-label">Revenue at Risk</span>
            <div className="metric-value">{formatINR(dashboardStats?.revenue_at_risk ?? 0)}</div>
            <div className="metric-sub">Failed value currently eligible or under review.</div>
          </div>
          <div className="metric">
            <span className="metric-label">Recovered Revenue</span>
            <div className="metric-value" style={{ color: 'var(--color-success)' }}>{formatINR(dashboardStats?.revenue_recovered ?? 0)}</div>
            <div className="metric-sub">Revenue recovered through successful payment recovery.</div>
          </div>
          <div className="metric">
            <span className="metric-label">Recovery Rate</span>
            <div className="metric-value">{(dashboardStats?.recovery_rate ?? 0).toFixed(1)}%</div>
            <div className="metric-sub">Share of eligible recovery value successfully recovered.</div>
          </div>
          <div className="metric">
            <span className="metric-label">Cases Processed</span>
            <div className="metric-value">{dashboardStats?.cases_processed ?? 0}</div>
            <div className="metric-sub">In decision pipeline</div>
          </div>
          <div className="metric">
            <span className="metric-label">Automatic Recoveries</span>
            <div className="metric-value">{dashboardStats?.automatic_recoveries ?? 0}</div>
            <div className="metric-sub">Automatic recoveries initiated</div>
          </div>
          <div className="metric warning-metric" onClick={() => {
            const hrCases = cases.filter(c => c.status === 'human_review');
            if (hrCases.length > 0) setSelectedId(hrCases[0].id);
          }} style={{ cursor: 'pointer' }}>
            <span className="metric-label">HUMAN REVIEW REQUIRED</span>
            <div className="metric-value">{dashboardStats?.human_review_cases ?? 0} CASES</div>
            <div className="metric-sub">{formatINR(dashboardStats?.human_review_amount ?? 0)} AT RISK</div>
          </div>
        </div>

        <div className="charts-grid">
          <div className="chart-card">
            <div className="chart-header">
              <p className="eyebrow">Financial Impact</p>
              <h3>Revenue Recovered vs At Risk</h3>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={revenueData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {revenueData.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                  </Pie>
                  <RechartsTooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <p className="eyebrow">Case Volume</p>
              <h3>Case Status Breakdown</h3>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E4E7" />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#71717A' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: '#71717A' }} axisLine={false} tickLine={false} />
                  <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#F4F4F5' }} />
                  <Bar dataKey="value" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-header">
              <p className="eyebrow">Failure Analysis</p>
              <h3>Top Failure Reasons</h3>
            </div>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={failureData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E4E4E7" />
                  <XAxis type="number" tick={{ fontSize: 12, fill: '#71717A' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#71717A' }} axisLine={false} tickLine={false} />
                  <RechartsTooltip content={<CustomTooltip />} cursor={{ fill: '#F4F4F5' }} />
                  <Bar dataKey="value" fill="#8B5CF6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="workspace" id="recovery-queue">
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
                         <span style={{ fontSize: 11, color: 'var(--color-accent)' }}>
                           {(item.recovery_probability * 100).toFixed(0)}% score
                         </span>
                       )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="details-panel">
            {detailLoading && !selected ? (
              <div className="empty-state">Loading case details...</div>
            ) : selected ? (
              <>
                <header className="details-header">
                  <div className="details-title">
                    <h2>{selected.case_number} {selected.case_number === 'DEMO-C-RECOVERED' && <span style={{fontSize: 12, fontWeight: 500, padding: '2px 6px', background: 'var(--color-bg-hover)', color: 'var(--color-text-light)', borderRadius: 4, marginLeft: 8}}>Synthetic Demo Data</span>}</h2>
                    <div className="details-meta">{selected.customer_email} • {title(selected.payment_method)}</div>
                    <div className="details-meta" style={{ marginTop: 4 }}>
                      <strong>Email: </strong>
                      {selected.notification_status === 'SENT' ? "Recovery instructions sent to the customer." :
                       selected.notification_status === 'NOT_AVAILABLE' ? "No customer email is available." :
                       selected.notification_status === 'FAILED' ? "Payment Link exists, but notification delivery failed." :
                       selected.notification_status === 'NOT_SENT' ? "Notification has not been sent." : "Pending"}
                    </div>
                  </div>
                  <div className="details-amount">
                    {formatINR(selected.amount)}
                    <div style={{ marginTop: 8 }}><Badge value={selected.status} /></div>
                  </div>
                </header>

                <div className="details-body">
                  <div className="decision-pipeline">
                     <div className="pipeline-track" />

                     <div className="pipeline-step completed">
                       <div className="step-icon">✓</div>
                       <div className="step-title">PAYMENT FAILED</div>
                       <div className="step-meta">{title(selected.failure_reason)}</div>
                     </div>

                     <div className={`pipeline-step ${explanation?.ml ? 'completed' : 'active'}`}>
                       <div className="step-icon">{explanation?.ml ? '✓' : '•'}</div>
                       <div className="step-title">ML PREDICTION</div>
                       <div className="step-meta">{explanation?.ml?.recovery_probability != null ? `${(explanation.ml.recovery_probability * 100).toFixed(0)}% recovery probability` : 'Pending'}</div>
                     </div>

                     <div className={`pipeline-step ${explanation?.policy ? (explanation.policy.allowed ? 'completed' : 'warning') : ''}`}>
                       <div className="step-icon">{explanation?.policy ? (explanation.policy.allowed ? '✓' : '!') : '•'}</div>
                       <div className="step-title">POLICY ENGINE</div>
                       <div className="step-meta">{explanation?.policy ? (explanation.policy.allowed ? 'Automatic recovery approved' : 'BLOCKED') : 'Pending'}</div>
                     </div>

                     <div className={`pipeline-step ${explanation?.ai ? 'completed' : ''}`}>
                       <div className="step-icon">{explanation?.ai ? '✓' : '•'}</div>
                       <div className="step-title">AI ADVISOR</div>
                       <div className="step-meta">{explanation?.ai ? `${title(explanation.ai.recommended_action)} recommended` : 'Pending'}</div>
                     </div>

                     <div className={`pipeline-step ${selected.status === 'recovered' || selected.status === 'recovering' ? 'completed' : explanation?.policy && !explanation.policy.allowed ? 'blocked' : ''}`}>
                       <div className="step-icon">{selected.status === 'recovered' || selected.status === 'recovering' ? '✓' : explanation?.policy && !explanation.policy.allowed ? '—' : '•'}</div>
                       <div className="step-title">RECOVERY</div>
                       <div className="step-meta">{selected.status === 'recovered' || selected.status === 'recovering' ? 'Payment Link created' : explanation?.policy && !explanation.policy.allowed ? 'Not executed' : 'Pending'}</div>
                     </div>

                     {explanation?.policy && !explanation.policy.allowed && (
                       <div className="pipeline-step blocked">
                         <div className="step-icon">→</div>
                         <div className="step-title">HUMAN REVIEW REQUIRED</div>
                       </div>
                     )}

                     {(selected.status === 'recovered' || selected.status === 'recovering') && (
                       <div className={`pipeline-step ${selected.status === 'recovered' ? 'completed' : 'active'}`}>
                         <div className="step-icon">{selected.status === 'recovered' ? '✓' : '•'}</div>
                         <div className="step-title">CUSTOMER PAYMENT</div>
                         <div className="step-meta">{selected.status === 'recovered' ? 'Payment Received' : 'Awaiting payment'}</div>
                       </div>
                     )}

                     {selected.status === 'recovered' && (
                       <div className="pipeline-step completed">
                         <div className="step-icon">✓</div>
                         <div className="step-title">RECOVERED</div>
                         <div className="step-meta">Revenue Recovered</div>
                       </div>
                     )}
                  </div>

                  {explanation && (
                    <div className="intelligence-panel">
                       <div className="intelligence-card">
                         <h4><i/> Case Metrics</h4>
                         <div className="stat-row"><span>Probability</span> <b>{explanation.ml.recovery_probability != null ? (explanation.ml.recovery_probability * 100).toFixed(1) + "%" : "—"}</b></div>
                         <div className="stat-row"><span>Lifetime Value</span> <b>{formatINR(explanation.customer_history.lifetime_value)}</b></div>
                         <div className="stat-row"><span>Success Rate</span> <b>{explanation.customer_history.successful_payments} / {explanation.customer_history.successful_payments + explanation.customer_history.failed_payments}</b></div>
                       </div>
                       <div className="intelligence-card">
                         <h4><i/> Policy Enforcement</h4>
                         <div className="stat-row"><span>Decision</span> <b>{explanation.policy.allowed ? "APPROVED" : "BLOCKED"}</b></div>
                         <div className="stat-row"><span>Reason</span> <b>{title(explanation.policy.reason)}</b></div>
                         <div className="stat-row"><span>Human Review</span> <b>{explanation.policy.requires_human_approval ? "Required" : "Not Required"}</b></div>
                       </div>
                    </div>
                  )}

                  {explanation?.ai && (
                    <div className="ai-block">
                      <div className="ai-header">
                        <div className="ai-title">✦ AI ADVISOR</div>
                        <Badge value={explanation.ai.recommended_action} />
                      </div>
                      <div className="ai-reasoning">
                        {explanation.ai.reasoning}
                      </div>
                      {explanation.ai.customer_message && (
                        <blockquote>"{explanation.ai.customer_message}"</blockquote>
                      )}
                    </div>
                  )}

                  {(execution || currentLink) && (
                    <div className="success-panel">
                      <h3>{selected.status === 'recovered' ? '✓ PAYMENT SUCCESSFUL' : '✓ RECOVERY ACTION EXECUTED'}</h3>
                      <p>{selected.status === 'recovered' ? 'Revenue successfully recovered via Razorpay.' : (execution?.message || "Payment Link recovery is in progress.")}</p>
                      {currentLink && currentLink !== "mock_demo_link" && (
                        <>
                          <div className="success-link">{currentLink}</div>
                          <div style={{ display: 'flex', gap: 12 }}>
                            <a className="button" href={currentLink} target="_blank" rel="noreferrer">Open Payment Link ↗</a>
                            <button
                              className="button secondary"
                              onClick={() => {
                                void navigator.clipboard.writeText(String(currentLink));
                                setNotice("Link copied to clipboard!");
                              }}
                            >
                              Copy Link
                            </button>
                          </div>
                        </>
                      )}
                      {currentLink === "mock_demo_link" && !execution && (
                         <div className="demo-payment-link" style={{color: 'var(--color-text-light)', fontStyle: 'italic', background: 'transparent', padding: 0}}>
                            <b>DEMO PAYMENT LINK</b><br/>
                            Execute Recovery to generate a real Razorpay Test Mode Payment Link.
                         </div>
                      )}
                    </div>
                  )}

                  <div className="action-panel">
                     <div className="action-info">
                       <b>Execute Action</b>
                       {selected.status === 'recovered' ? 'Revenue successfully recovered.' : selected.status === 'recovering' ? `Payment link is active. ${executionMode ? `(${executionMode})` : ''}` : policyAllowed ? 'Ready to execute recommendation.' : 'Policy blocked execution.'}
                     </div>

                     <div style={{ display: 'flex', gap: 12 }}>
                       <button className="button secondary" onClick={() => void analyze()} disabled={actionLoading !== null}>
                         {actionLoading === 'analyze' ? <span className="spinner"/> : null}
                         Analyze
                       </button>

                       {policyAllowed && selected.status !== 'recovered' && (selected.status !== 'recovering' || currentLink === 'mock_demo_link') && (
                         <button className="button" onClick={() => void execute()} disabled={actionLoading !== null}>
                           {actionLoading === 'execute' ? <span className="spinner"/> : null}
                           Execute
                         </button>
                       )}
                     </div>
                  </div>

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
                                <div className="timeline-time">{new Date(event.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</div>
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
                </div>
              </>
            ) : (
              <div className="empty-state">Select a case to view details</div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
