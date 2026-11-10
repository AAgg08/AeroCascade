import { EASAComplianceView } from './components/EASAComplianceView.tsx';
import { FMEACapacityAnalytics } from './components/FMEACapacityAnalytics.tsx';
import { PythonBackendView } from './components/PythonBackendView.tsx';
import { TopologyWorkspace } from './components/TopologyWorkspace.tsx';
import { useCascadeStore, type WorkspaceTab } from './store/useCascadeStore.ts';

const NAV_ITEMS: { id: WorkspaceTab; label: string }[] = [
  { id: 'topology', label: 'Topology & DES' },
  { id: 'fmea-capacity', label: 'FMEA & Capacity' },
  { id: 'easa-compliance', label: 'Part-IS Dossier' },
  { id: 'python-engine', label: 'SimPy Backend' },
];

export default function App() {
  const {
    activeTab,
    setActiveTab,
    simulationResult,
    executeSimulationOnServer,
    isSimulating,
    baselineMovementsPerHour,
    backendError,
    clearBackendError,
  } = useCascadeStore();

  const kpis = simulationResult.summary_kpis;

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="no-print sticky top-0 z-30 flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-4 gap-y-2 sm:gap-8 border-b border-slate-800 bg-[#0B0F17]/95 backdrop-blur px-4 sm:px-6 py-3">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('topology');
          }}
          className="text-base sm:text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          AeroCascade
        </a>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav
          aria-label="Primary Workspace Views"
          className="order-3 sm:order-2 w-full sm:w-auto flex items-center justify-between sm:justify-center gap-3 sm:gap-6 text-xs sm:text-sm font-medium overflow-x-auto border-t border-slate-800/80 sm:border-t-0 pt-2 sm:pt-0"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  isActive
                    ? 'border-cyan-400 text-slate-100 font-semibold'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-600'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="order-2 sm:order-3 flex items-center shrink-0">
          <button
            type="button"
            onClick={() => executeSimulationOnServer()}
            disabled={isSimulating}
            className="rounded-md bg-cyan-500 px-3.5 sm:px-4 py-1.5 sm:py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
          >
            {isSimulating ? 'Simulating...' : 'Run Simulation'}
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main id="top" className="flex-1 mx-auto w-full max-w-[1440px] px-4 sm:px-6 py-6 space-y-6">
        {/* Research Context & 4-Column Telemetry Strip */}
        <section aria-label="Simulation Summary Telemetry" className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100">
                Remote Tower Cybersecurity &amp; Three-Stage Cascading Failure Simulator
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Illustrative research model grounded in Aggarwal &amp; Dhillon (AIAA Aviation 2026) · Dhillon &amp; Moores (2001) Tripartite Controls
              </p>
            </div>

            {/* Result Provenance Badge */}
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span
                data-testid="provenance-engine-badge"
                className={`inline-flex items-center px-2.5 py-1 rounded text-[11px] font-semibold border ${
                  simulationResult.provenance?.engine === 'fastapi-python'
                    ? 'bg-cyan-950/80 text-cyan-300 border-cyan-800'
                    : simulationResult.provenance?.is_fallback
                    ? 'bg-amber-950/80 text-amber-300 border-amber-800'
                    : 'bg-slate-900 text-slate-300 border-slate-700'
                }`}
              >
                ● ENGINE: {simulationResult.provenance?.engine_label ?? 'In-Browser Client (TypeScript)'}
              </span>
              {simulationResult.run_id && (
                <span className="text-slate-400 text-[11px]" title={`Authoritative Run ID: ${simulationResult.run_id}`}>
                  RUN: {simulationResult.run_id.slice(0, 8)}
                </span>
              )}
              {simulationResult.input_hash && (
                <span className="text-slate-400 text-[11px]" title={`Canonical Input SHA256: ${simulationResult.input_hash}`}>
                  HASH: {simulationResult.input_hash.slice(0, 8)}
                </span>
              )}
              <span className="text-slate-400">
                REV #{simulationResult.provenance?.input_revision ?? 1}
              </span>
              {simulationResult.provenance?.is_fallback && (
                <span className="text-amber-400 text-[11px]" title={simulationResult.provenance.fallback_reason}>
                  (FALLBACK ACTIVE)
                </span>
              )}
            </div>
          </div>

          {backendError && (
            <div
              data-testid="backend-error-banner"
              className="rounded-md border border-rose-800/80 bg-rose-950/40 p-4 text-xs font-mono"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-rose-300">
                  ⚠ AUTHORITATIVE SIMULATION BACKEND ERROR
                </span>
                <button
                  type="button"
                  onClick={clearBackendError}
                  className="text-slate-400 hover:text-slate-200"
                >
                  ✕ Dismiss
                </button>
              </div>
              <p className="mt-1 text-slate-300 font-sans">{backendError}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => executeSimulationOnServer()}
                  className="rounded border border-rose-700 bg-rose-900/60 px-3 py-1 font-semibold text-rose-200 hover:bg-rose-800"
                >
                  Retry Authoritative Simulation
                </button>
                <button
                  type="button"
                  onClick={() => executeSimulationOnServer({ allowLegacyDemo: true })}
                  className="rounded border border-slate-700 bg-slate-800 px-3 py-1 text-slate-300 hover:bg-slate-700"
                >
                  Run Legacy Demo Mode (Explicitly Uncalibrated)
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Metric 1: Mean Adjusted Risk vs Raw RPN */}
            <div className="rounded-md border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
                MEAN ADJUSTED RISK SCORE
              </div>
              <div className="mt-1 flex items-baseline">
                <span
                  className="text-3xl font-mono font-bold tabular-nums text-slate-100"
                  data-testid="kpi-mean-residual-rpn"
                >
                  {kpis.mean_residual_rpn.toFixed(1)}
                </span>
                <span className="ml-1.5 text-xs font-mono text-slate-400">
                  / {kpis.mean_raw_rpn.toFixed(1)} RAW RPN
                </span>
              </div>
              <div className="mt-1 text-xs font-mono text-emerald-400 tabular-nums">
                EST. MITIGATION: -{(100 - (kpis.mean_residual_rpn / Math.max(1, kpis.mean_raw_rpn)) * 100).toFixed(1)}% (MODEL DAMPING)
              </div>
            </div>

            {/* Metric 2: Minimum Hourly Capacity */}
            <div className="rounded-md border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
                MIN HOURLY THROUGHPUT
              </div>
              <div className="mt-1 flex items-baseline">
                <span
                  className="text-3xl font-mono font-bold tabular-nums text-slate-100"
                  data-testid="kpi-min-capacity"
                >
                  {kpis.min_hourly_capacity.toFixed(1)}
                </span>
                <span className="ml-1.5 text-xs font-mono text-slate-400">
                  / {baselineMovementsPerHour} MVMT/HR
                </span>
              </div>
              <div className="mt-1 text-xs font-mono text-cyan-300 tabular-nums">
                RETENTION FLOOR: {kpis.capacity_retention_pct.toFixed(1)}% NOMINAL
              </div>
            </div>

            {/* Metric 3: Time Below 90% Capacity & Estimated Lost Movement Capacity */}
            <div className="rounded-md border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
                TIME BELOW 90% CAPACITY
              </div>
              <div className="mt-1 flex items-baseline">
                <span
                  className="text-3xl font-mono font-bold tabular-nums text-amber-300"
                  data-testid="kpi-recovery-hours"
                >
                  {kpis.recovery_window_hours}
                </span>
                <span className="ml-1.5 text-xs font-mono text-slate-400">
                  HOURS (PROVISIONAL)
                </span>
              </div>
              <div className="mt-1 text-xs font-mono text-rose-400 tabular-nums">
                LOST CAPACITY: {kpis.total_disrupted_movements} MOVEMENTS (EST. DEFICIT)
              </div>
            </div>

            {/* Metric 4: Primary Chokepoint & Average Control Score */}
            <div className="rounded-md border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
                PRIMARY GRAPH CHOKEPOINT
              </div>
              <div className="mt-1 flex items-baseline">
                <span className="text-2xl font-mono font-bold tabular-nums text-cyan-300">
                  {kpis.top_chokepoint_code}
                </span>
                <span className="ml-2 text-xs font-mono text-slate-400 tabular-nums">
                  IDX {kpis.top_chokepoint_score.toFixed(1)}
                </span>
              </div>
              <div className="mt-1 text-xs font-mono text-slate-300 tabular-nums">
                AVG CONTROL SCORE: {(kpis.average_control_score ?? kpis.tripartite_balance_index).toFixed(1)}% (0-100)
              </div>
            </div>
          </div>
        </section>

        {/* Active Workspace View */}
        {activeTab === 'topology' && <TopologyWorkspace />}
        {activeTab === 'fmea-capacity' && <FMEACapacityAnalytics />}
        {activeTab === 'easa-compliance' && <EASAComplianceView />}
        {activeTab === 'python-engine' && <PythonBackendView />}
      </main>

      {/* Clean Quiet Footer */}
      <footer className="no-print border-t border-slate-800/80 bg-[#0B0F17] px-6 py-4 text-xs text-slate-400">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            AeroCascade · Modernizing Aviation Infrastructure—Cybersecurity Challenges in the Era of Remote Tower Operations (Aggarwal &amp; Dhillon, AIAA Aviation 2026)
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            EASA Part-IS (EU) 2022/1645 &amp; 2023/203 · EUROCAE ER-040 · PSOE Maturity
          </div>
        </div>
      </footer>
    </div>
  );
}
