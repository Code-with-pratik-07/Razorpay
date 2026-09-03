import { useCallback, useEffect, useState } from "react";
import { RecoveryCase, Explanation, AuditEvent, Execution, DashboardStats } from "./types";
import { TopNav } from "./components/TopNav";
import { DemoControlCenter } from "./components/DemoControlCenter";
import { MetricsGrid } from "./components/MetricsGrid";
import { Charts } from "./components/Charts";
import { RecoveryQueue } from "./components/RecoveryQueue";
import { CaseDetail } from "./components/CaseDetail";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export function extractErrorMessage(err: unknown, defaultMessage = "An error occurred."): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) {
    if (err.message && err.message !== "[object Object]") return err.message;
  }
  if (err && typeof err === "object") {
    if ("detail" in err && err.detail) {
      if (typeof err.detail === "string") return err.detail;
      if (Array.isArray(err.detail) && err.detail.length > 0 && err.detail[0].msg) {
        return err.detail[0].msg;
      }
      return JSON.stringify(err.detail);
    }
    if ("message" in err && typeof err.message === "string") return err.message;
  }
  return defaultMessage;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const fetchInit: RequestInit = { ...init };
  if (fetchInit.body && typeof fetchInit.body === 'string') {
    fetchInit.headers = {
      'Content-Type': 'application/json',
      ...fetchInit.headers,
    };
  }
  
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, fetchInit);
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch')) {
      throw new Error(`Unable to connect to the backend (${API_BASE_URL}). Please verify that the backend is running and CORS is configured for this origin.`);
    }
    throw new Error("A network error occurred while communicating with the server.");
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    let detailMsg: string | undefined;
    if (body.detail) {
      if (typeof body.detail === 'string') {
        detailMsg = body.detail;
      } else if (Array.isArray(body.detail) && body.detail[0]?.msg) {
        detailMsg = body.detail[0].msg;
      } else {
        detailMsg = JSON.stringify(body.detail);
      }
    }
    
    if (response.status === 403) throw new Error(detailMsg ?? "Access denied. Feature may be disabled in current configuration.");
    if (response.status === 500) throw new Error("The backend server encountered an internal error.");
    if (response.status === 502) throw new Error("Bad Gateway: The backend server is currently unavailable.");
    throw new Error(detailMsg ?? `Server returned an error (${response.status}).`);
  }

  return body as T;
}

export default function App() {
  const [cases, setCases] = useState<RecoveryCase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecoveryCase | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [execution, setExecution] = useState<Execution | null>(null);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<"analyze" | "execute" | null>(null);
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
      setError(extractErrorMessage(requestError, "Could not load recovery cases."));
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
      setError(extractErrorMessage(requestError, "Could not load case details."));
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
      setError(extractErrorMessage(requestError, "Failed to reset demo data."));
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

  const simulateFailure = async () => {
    setResettingDemo(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ message: string; case_id: string }>("/api/demo/simulate-failure", { method: "POST", body: JSON.stringify({}) });
      setNotice(res.message);
      const newCases = await refreshCases(false);
      selectScenario(newCases[0].case_number, newCases);
    } catch (requestError) {
      setError(extractErrorMessage(requestError, "Unable to simulate payment failure. Please try again."));
    } finally {
      setResettingDemo(false);
    }
  };

  useEffect(() => {
    setExecution(null);
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
      const data = await api<Explanation>(`/api/cases/${selected.id}/analyze`, { 
        method: "POST"
      });
      setExplanation(data);
      setSelected(data);
      setNotice("Analysis completed using ML, policy, and advisory AI.");
      await refreshCases();
      await loadDetails(selected.id);
    } catch (requestError) {
      setError(extractErrorMessage(requestError, "Analysis could not be completed."));
    } finally {
      setActionLoading(null);
    }
  };

  const execute = async () => {
    if (!selected) return;
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
      setError(extractErrorMessage(requestError, "Recovery execution could not be completed."));
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="product-shell">
      <TopNav demoMode={demoMode} />

      <main className="content" id="overview">
        <header className="dashboard-hero">
          <div className="hero-content">
            <h1>Payment Recovery Intelligence</h1>
            <p className="dashboard-story">
              Turn failed payments into recovered revenue.
              <span>ML predicts. Policy decides. AI recommends. Recovery executes.</span>
            </p>
          </div>
          <div className="hero-status">
            <span className="status-dot"></span>
            Recovery Engine • Operational
          </div>
        </header>

        <DemoControlCenter
          demoMode={demoMode}
          cases={cases}
          resettingDemo={resettingDemo}
          loading={loading}
          startDemo={startDemo}
          simulateFailure={simulateFailure}
          selectScenario={selectScenario}
          selectedId={selectedId}
        />


        {error && <div className="alert error">{error}</div>}
        {notice && <div className="alert success">{notice}</div>}

        <MetricsGrid stats={dashboardStats} cases={cases} setSelectedId={setSelectedId} />
        <Charts stats={dashboardStats} cases={cases} />

        <div className="workspace" id="recovery-queue">
          <RecoveryQueue
            cases={cases}
            loading={loading}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
          />
          <section className="details-panel">
            <CaseDetail
              selected={selected}
              explanation={explanation}
              audit={audit}
              execution={execution}
              detailLoading={detailLoading}
              actionLoading={actionLoading}
              analyze={analyze}
              execute={execute}
              setNotice={setNotice}
              setError={setError}
              loadDetails={loadDetails}
              refreshCases={refreshCases}
            />
          </section>
        </div>
      </main>
    </div>
  );
}
