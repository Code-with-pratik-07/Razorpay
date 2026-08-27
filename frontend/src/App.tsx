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
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not load recovery cases.");
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
        {demoMode && (
          <div className="demo-banner">
            <div>
              <h3>DEMO ENVIRONMENT</h3>
              <p>Presentation data enabled. Sandbox environment active.</p>
            </div>
            <button className="button danger" onClick={() => void resetDemoData()} disabled={resettingDemo || loading}>
              {resettingDemo ? "Resetting..." : "Reset Demo Data"}
            </button>
          </div>
        )}

        <header className="dashboard-hero">
          <h1>Payment Recovery Intelligence</h1>
          <p className="dashboard-story">
            Turn failed payments into recovered revenue.
            <span>ML predicts. Policy decides. AI recommends. Recovery executes.</span>
          </p>
        </header>

        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <div className="metric-grid">
          <div className="metric">
            <span className="metric-label">Revenue at Risk</span>
            <div className="metric-value">{formatINR(dashboardStats?.revenue_at_risk ?? 0)}</div>
            <div className="metric-sub">From failed attempts</div>
          </div>
          <div className="metric">
            <span className="metric-label">Revenue Recovered</span>
            <div className="metric-value" style={{ color: 'var(--color-success)' }}>{formatINR(dashboardStats?.revenue_recovered ?? 0)}</div>
            <div className="metric-sub">Via automated links</div>
          </div>
          <div className="metric">
            <span className="metric-label">Recovery Rate</span>
            <div className="metric-value">{(dashboardStats?.recovery_rate ?? 0).toFixed(1)}%</div>
            <div className="metric-sub">Conversion of at-risk</div>
          </div>
          <div className="metric">
            <span className="metric-label">Active Cases</span>
            <div className="metric-value">{dashboardStats?.cases_processed ?? 0}</div>
            <div className="metric-sub">In decision pipeline</div>
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
                    <h2>{selected.case_number}</h2>
                    <div className="details-meta">{selected.customer_email} • {title(selected.payment_method)}</div>
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
                       <div className="step-icon">1</div>
                       <div className="step-title">Failed</div>
                       <div className="step-meta">{title(selected.failure_reason)}</div>
                     </div>

                     <div className={`pipeline-step ${explanation?.ml ? 'completed' : 'active'}`}>
                       <div className="step-icon">2</div>
                       <div className="step-title">ML Model</div>
                       <div className="step-meta">{explanation?.ml?.recovery_probability != null ? `${(explanation.ml.recovery_probability * 100).toFixed(0)}% prob` : 'Pending'}</div>
                     </div>

                     <div className={`pipeline-step ${explanation?.policy ? (explanation.policy.allowed ? 'completed' : 'active') : ''}`}>
                       <div className="step-icon">3</div>
                       <div className="step-title">Policy</div>
                       <div className="step-meta">{explanation?.policy ? (explanation.policy.allowed ? 'Allowed' : 'Blocked') : 'Pending'}</div>
                     </div>

                     <div className={`pipeline-step ${explanation?.ai ? 'completed' : ''}`}>
                       <div className="step-icon">4</div>
                       <div className="step-title">AI Advisor</div>
                       <div className="step-meta">{explanation?.ai ? title(explanation.ai.recommended_action) : 'Pending'}</div>
                     </div>

                     <div className={`pipeline-step ${selected.status === 'recovered' || selected.status === 'recovering' ? 'completed' : ''}`}>
                       <div className="step-icon">5</div>
                       <div className="step-title">Recovery</div>
                       <div className="step-meta">{title(selected.recovery_action)}</div>
                     </div>
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
                          <button
                            className="button secondary"
                            onClick={() => {
                              void navigator.clipboard.writeText(String(currentLink));
                              setNotice("Link copied to clipboard!");
                            }}
                          >
                            Copy Payment Link
                          </button>
                        </>
                      )}
                      {currentLink === "mock_demo_link" && !execution && (
                         <div className="success-link" style={{color: 'var(--color-text-light)', fontStyle: 'italic', background: 'transparent', padding: 0}}>
                            [Seeded mock link. Execute Recovery to generate a real Razorpay payment link.]
                         </div>
                      )}
                    </div>
                  )}

                  <div className="action-panel">
                     <div className="action-info">
                       <b>Execute Action</b>
                       {selected.status === 'recovered' ? 'Revenue successfully recovered.' : selected.status === 'recovering' ? 'Payment link is active.' : policyAllowed ? 'Ready to execute recommendation.' : 'Policy blocked execution.'}
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
                           const kind = type.includes('fail') || type.includes('block') || type.includes('escalat') ? 'warning' : type.includes('success') || type.includes('recover') ? 'success' : 'info';
                           return (
                             <div key={event.id} className={`timeline-event ${kind}`}>
                                <div className="timeline-dot" />
                                <div className="timeline-time">{new Date(event.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</div>
                                <div className="timeline-content">
                                   <b>{title(event.event_type)}</b>
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
