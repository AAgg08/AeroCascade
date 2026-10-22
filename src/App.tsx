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
          <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100">
              Remote Tower Cybersecurity &amp; Three-Stage Cascading Failure Simulator
            </h1>
            <div className="text-xs font-mono text-slate-400">
              Aggarwal &amp; Dhillon (AIAA Aviation 2026) <span aria-hidden="true">·</span> Dhillon &amp; Moores (2001)
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Metric 1: Mean Residual vs Raw RPN */}
            <div className="rounded-md border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
                MEAN RESIDUAL FMEA RPN
              </div>
              <div className="mt-1 flex items-baseline">
                <span
                  className="text-3xl font-mono font-bold tabular-nums text-slate-100"
                  data-testid="kpi-mean-residual-rpn"
                >
                  {kpis.mean_residual_rpn.toFixed(1)}
                </span>
                <span className="ml-1.5 text-xs font-mono text-slate-400">
                  / {kpis.mean_raw_rpn.toFixed(1)} RAW
                </span>
              </div>
              <div className="mt-1 text-xs font-mono text-emerald-400 tabular-nums">
                REDUCTION: -{(100 - (kpis.mean_residual_rpn / Math.max(1, kpis.mean_raw_rpn)) * 100).toFixed(1)}% VIA TRIPARTITE
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

            {/* Metric 3: Stage 3 Recovery Window & Disrupted Flights */}
            <div className="rounded-md border border-slate-800 bg-[#111827] p-4">
              <div className="text-xs font-mono uppercase tracking-wider text-slate-400">
                STAGE 3 RECOVERY WINDOW
              </div>
              <div className="mt-1 flex items-baseline">
                <span
                  className="text-3xl font-mono font-bold tabular-nums text-amber-300"
                  data-testid="kpi-recovery-hours"
                >
                  {kpis.recovery_window_hours}
                </span>
                <span className="ml-1.5 text-xs font-mono text-slate-400">
                  HOURS (&lt;90% CAP)
                </span>
              </div>
              <div className="mt-1 text-xs font-mono text-rose-400 tabular-nums">
                CUMULATIVE DELAYED: {kpis.total_disrupted_movements} MOVEMENTS
              </div>
            </div>

            {/* Metric 4: Primary Chokepoint & Tripartite Balance */}
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
                TRIPARTITE BALANCE: {kpis.tripartite_balance_index.toFixed(1)}% COMPOSITE
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
