import { useCallback, useEffect, useRef, useState } from "react";
import { RecoveryCase, Explanation, AuditEvent, Execution, DashboardStats } from "./types";
import { TopNav } from "./components/TopNav";
import { DemoControlCenter } from "./components/DemoControlCenter";
import { MetricsGrid } from "./components/MetricsGrid";
import { Charts } from "./components/Charts";
import { RecoveryQueue } from "./components/RecoveryQueue";
import { CaseDetail } from "./components/CaseDetail";
import { API_BASE_URL } from "./config";

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
  const lastSyncRef = useRef<number>(0);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef<number>(0);
  const activeRequestIdRef = useRef<string | null>(null);
  const isResettingDemoRef = useRef<boolean>(false);

  const refreshCases = useCallback(async (preserveSelection = true) => {
    if (isResettingDemoRef.current) return [];
    setLoading(true);
    try {
      const [next, stats] = await Promise.all([
        api<RecoveryCase[]>("/api/cases?limit=1000"),
        api<DashboardStats>("/api/dashboard/stats").catch(() => null),
      ]);
      if (isResettingDemoRef.current) return next;
      setCases(next);
      if (stats) setDashboardStats(stats);
      setSelectedId((currentSelectedId) => {
        return preserveSelection && currentSelectedId && next.some((item) => item.id === currentSelectedId)
          ? currentSelectedId : next[0]?.id ?? null;
      });
      setError(null);
      return next;
    } catch (requestError) {
      if (isResettingDemoRef.current) return [];
      setError(extractErrorMessage(requestError, "Could not load recovery cases."));
      return [];
    } finally {
      if (!isResettingDemoRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const loadDetails = useCallback(async (id: string) => {
    if (isResettingDemoRef.current) return;
    const currentSeq = ++requestSeqRef.current;
    activeRequestIdRef.current = id;
    setDetailLoading(true);
    try {
      const [caseData, explanationData, auditData] = await Promise.all([
        api<RecoveryCase>(`/api/cases/${id}`),
        api<Explanation>(`/api/cases/${id}/explanation`),
        api<AuditEvent[]>(`/api/cases/${id}/audit`),
      ]);
      // Discard response if user already switched or a newer request superseded this one
      if (currentSeq !== requestSeqRef.current || activeRequestIdRef.current !== id || isResettingDemoRef.current) return;
      setSelected(caseData);
      setExplanation(explanationData);
      setAudit(auditData);
      setError(null);
    } catch (requestError) {
      if (currentSeq !== requestSeqRef.current || activeRequestIdRef.current !== id || isResettingDemoRef.current) return;
      setError(extractErrorMessage(requestError, "Could not load case details."));
    } finally {
      if (currentSeq === requestSeqRef.current && activeRequestIdRef.current === id && !isResettingDemoRef.current) {
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Check if a specific case is requested via URL query params (e.g. after payment simulation)
    const urlParams = new URLSearchParams(window.location.search);
    const targetCaseId = urlParams.get("case");

    void refreshCases(false).then((loadedCases) => {
      if (targetCaseId && loadedCases.some((c) => c.id === targetCaseId)) {
        setSelectedId(targetCaseId);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    });

    void api<{ demo_mode_enabled: boolean }>("/api/demo/status")
      .then((data) => setDemoMode(data.demo_mode_enabled))
      .catch(() => setDemoMode(false));
  }, [refreshCases]);

  // Real-time synchronization when returning to dashboard tab or receiving cross-tab payment event (throttled & debounced)
  useEffect(() => {
    const handleSync = (targetCaseId?: string) => {
      if (isResettingDemoRef.current) return;
      const now = Date.now();
      const caseToLoad = targetCaseId || selectedId;
      if (now - lastSyncRef.current < 1500) {
        if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = setTimeout(() => {
          if (isResettingDemoRef.current) return;
          lastSyncRef.current = Date.now();
          void refreshCases(true);
          if (caseToLoad) {
            void loadDetails(caseToLoad);
          }
        }, 300);
        return;
      }
      lastSyncRef.current = now;
      void refreshCases(true);
      if (caseToLoad) {
        void loadDetails(caseToLoad);
      }
    };

    const onFocus = () => handleSync();
    window.addEventListener("focus", onFocus);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        handleSync();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("recoverai_payment_sync");
      bc.onmessage = (event) => {
        if (event.data?.caseId) {
          setSelectedId(event.data.caseId);
          handleSync(event.data.caseId);
        } else {
          handleSync();
        }
      };
    } catch {
      // BroadcastChannel unsupported fallback
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "recoverai_last_paid_case" && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed.caseId) {
            setSelectedId(parsed.caseId);
            handleSync(parsed.caseId);
            return;
          }
        } catch {}
        handleSync();
      }
    };
    window.addEventListener("storage", handleStorage);

    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "PAYMENT_COMPLETED" && e.data?.caseId) {
        setSelectedId(e.data.caseId);
        handleSync(e.data.caseId);
      }
    };
    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("message", handleMessage);
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      if (bc) bc.close();
    };
  }, [selectedId, loadDetails, refreshCases]);

  const resetDemoData = async (skipConfirm = false) => {
    if (!skipConfirm && !window.confirm("This will reset all demo scenarios to their original deterministic state. Continue?")) return [];
    
    // Invalidate any in-flight requests and cancel pending sync timeouts
    const currentSeq = ++requestSeqRef.current;
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }
    
    isResettingDemoRef.current = true;
    setResettingDemo(true);
    setDetailLoading(true);
    setError(null);
    setNotice(null);

    // Step 3: Immediately clear stale selected detail state so UI never displays old simulation objects
    setSelected(null);
    setExplanation(null);
    setAudit([]);
    setExecution(null);
    setSelectedId(null);
    activeRequestIdRef.current = null;

    try {
      // Step 1 & 2: Trigger POST /api/demo/reset and wait for successful response
      const res = await api<{ message: string }>("/api/demo/reset", { method: "POST" });
      setNotice(res.message);

      // Step 4 & 5: Fetch fresh cases from backend and fetch fresh dashboard statistics
      const [newCases, newStats] = await Promise.all([
        api<RecoveryCase[]>("/api/cases?limit=1000"),
        api<DashboardStats>("/api/dashboard/stats").catch(() => null),
      ]);

      if (currentSeq !== requestSeqRef.current) return [];

      setCases(newCases);
      if (newStats) setDashboardStats(newStats);

      // Step 6: Locate DEMO-A-AUTO from the newly fetched cases
      const demoA = (newCases || []).find((c) => c.case_number === 'DEMO-A-AUTO') || newCases?.[0] || null;

      if (demoA) {
        // Step 7: Set DEMO-A-AUTO as the selected case
        setSelectedId(demoA.id);
        activeRequestIdRef.current = demoA.id;
        setSelected(demoA);

        // Step 8, 9, 10: Fetch fresh case details, fresh explanation, and fresh audit timeline
        const [freshCase, freshExp, freshAudit] = await Promise.all([
          api<RecoveryCase>(`/api/cases/${demoA.id}`),
          api<Explanation>(`/api/cases/${demoA.id}/explanation`),
          api<AuditEvent[]>(`/api/cases/${demoA.id}/audit`),
        ]);

        if (currentSeq === requestSeqRef.current) {
          // Step 11: Render only the newly fetched authoritative data
          setSelected(freshCase);
          setExplanation(freshExp);
          setAudit(freshAudit);
        }
      }

      return newCases || [];
    } catch (requestError) {
      if (currentSeq === requestSeqRef.current) {
        setError(extractErrorMessage(requestError, "Failed to reset demo data."));
      }
      return [];
    } finally {
      if (currentSeq === requestSeqRef.current) {
        isResettingDemoRef.current = false;
        setResettingDemo(false);
        setDetailLoading(false);
        setLoading(false);
      }
    }
  };

  const selectScenario = (caseNumber: string, list: RecoveryCase[]) => {
    const c = list.find(x => x.case_number === caseNumber);
    if (c) {
      if (c.id !== selectedId) {
        setSelected(null);
        setExplanation(null);
        setAudit([]);
        setExecution(null);
        setSelectedId(c.id);
      }
      document.getElementById('recovery-queue')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const resetDemo = async () => {
    await resetDemoData(true);
    document.getElementById('recovery-queue')?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    setExecution(null);
    if (selectedId) {
      // Clear out previous case data immediately when switching cases so no stale data from the previous case is displayed
      setSelected((prev) => (prev?.id === selectedId ? prev : null));
      setExplanation((prev) => (prev?.id === selectedId ? prev : null));
      setAudit([]);
      // Only invoke loadDetails if not already freshly loaded by resetDemoData
      if (activeRequestIdRef.current !== selectedId || !selected) {
        void loadDetails(selectedId);
      }
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
    if (!selected || actionLoading !== null) return;
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
          resetDemo={resetDemo}
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
