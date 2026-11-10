import { useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Briefcase,
  ChevronRight,
  DollarSign,
  FileText,
  Network,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { EASAComplianceView } from './components/EASAComplianceView.tsx';
import { FMEACapacityAnalytics } from './components/FMEACapacityAnalytics.tsx';
import { PythonBackendView } from './components/PythonBackendView.tsx';
import { TopologyWorkspace } from './components/TopologyWorkspace.tsx';
import { useCascadeStore, type WorkspaceTab } from './store/useCascadeStore.ts';

const NAV_ITEMS: { id: WorkspaceTab; label: string; icon: typeof Network }[] = [
  { id: 'topology', label: 'Topology & DES', icon: Network },
  { id: 'fmea-capacity', label: 'FMEA & Capacity', icon: Activity },
  { id: 'easa-compliance', label: 'Part-IS Dossier', icon: ShieldCheck },
  { id: 'python-engine', label: 'SimPy Backend', icon: Terminal },
];

export default function App() {
  const {
    activeTab,
    setActiveTab,
    simulationResult,
    executeSimulationOnServer,
    isSimulating,
    activeRunMode,
    inputRevision,
    backendError,
    clearBackendError,
  } = useCascadeStore();

  const isStale = inputRevision > (simulationResult.provenance?.input_revision ?? 0);
  const kpis = simulationResult.summary_kpis;
  const nominalCapacity = simulationResult.hourly_capacity[0]?.baseline_capacity;
  const recovery = simulationResult.recovery_metrics;
  const lostCapacity = kpis.estimated_lost_movement_capacity ?? kpis.total_disrupted_movements;

  const isDeterministicBusy = isSimulating && activeRunMode === 'deterministic';
  const isMonteCarloBusy = isSimulating && activeRunMode === 'monte-carlo';
  const [showVcTour, setShowVcTour] = useState(false);

  useEffect(() => {
    const handleHash = () => {
      const hash = window.location.hash.replace('#', '') as WorkspaceTab;
      if (['topology', 'fmea-capacity', 'easa-compliance', 'python-engine'].includes(hash)) {
        setActiveTab(hash);
      }
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [setActiveTab]);

  return (
    <div className="min-h-screen flex bg-[#F8F9FA] text-gray-900 font-sans antialiased">
      {/* Screen-reader Accessible Live Announcer */}
      <div role="status" aria-live="polite" className="sr-only" data-testid="live-simulation-announcer">
        {isSimulating
          ? `Simulation in progress (${activeRunMode === 'monte-carlo' ? '30 Monte Carlo replicates' : 'deterministic causal engine'})...`
          : backendError
          ? `Simulation error: ${backendError}`
          : isStale
          ? `Inputs modified. Editor is at Revision #${inputRevision}, displaying previous results from Revision #${simulationResult.provenance?.input_revision ?? 1}.`
          : `Simulation complete. Engine: ${simulationResult.provenance?.engine_label}. Input Revision #${simulationResult.provenance?.input_revision ?? 1}.`}
      </div>

      {/* Clean Icon-Only Vertical Sidebar (Left side, white background) */}
      <aside
        aria-label="Sidebar Navigation"
        className="no-print w-16 sm:w-20 bg-white border-r border-gray-100 flex flex-col items-center justify-between py-6 shrink-0 shadow-xs sticky top-0 h-screen z-40"
      >
        <div className="flex flex-col items-center gap-6 w-full">
          {/* Brand Logo Icon */}
          <button
            type="button"
            onClick={() => setActiveTab('topology')}
            className="h-11 w-11 rounded-2xl bg-gray-950 text-white flex items-center justify-center font-extrabold shadow-sm hover:scale-105 transition-transform"
            title="AeroCascade Aviation Console"
          >
            <span className="bg-gradient-to-tr from-emerald-400 to-teal-200 bg-clip-text text-transparent font-black text-xl">
              A
            </span>
          </button>

          {/* Navigation Icon Buttons */}
          <nav aria-label="Main Navigation" className="flex flex-col items-center gap-3 w-full px-2">
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  title={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={`h-11 w-11 rounded-2xl flex items-center justify-center transition-all ${
                    isActive
                      ? 'bg-gray-900 text-white shadow-md'
                      : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="sr-only">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header Bar */}
        <header className="no-print sticky top-0 z-30 bg-white/90 backdrop-blur-md border-b border-gray-100 px-6 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
                Dashboard
              </h1>
              <p className="text-xs text-gray-500 font-medium hidden sm:block">
                AeroCascade · Remote Tower Cybersecurity &amp; Cascading Failure Simulator
              </p>
            </div>
            <div className="hidden lg:flex items-center gap-2 rounded-full bg-gray-50 border border-gray-200/60 px-4 py-1.5 text-xs text-gray-500 shadow-inner">
              <span>AIAA 2026 Reference Model · Dhillon &amp; Moores (2001)</span>
            </div>
            <button
              type="button"
              data-testid="vc-tour-btn"
              onClick={() => setShowVcTour(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200/80 px-3.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100/80 transition-all shadow-xs"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
              <span>VC Demo Guide</span>
            </button>
          </div>

          {/* Header Action Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Provenance Badge */}
            <span
              data-testid="provenance-engine-badge"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-gray-50 border border-gray-200/80 px-3 py-1 text-xs font-semibold text-gray-700 shadow-xs"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span>
                {simulationResult.provenance?.engine === 'fastapi-python'
                  ? 'FastAPI + SimPy (Authoritative)'
                  : simulationResult.provenance?.is_fallback
                  ? 'Client Preview (Fallback)'
                  : 'Client Preview'}
              </span>
            </span>

            {isStale && (
              <span
                data-testid="provenance-stale-badge"
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 text-xs font-semibold shadow-xs"
              >
                Stale (Rev #{simulationResult.provenance?.input_revision ?? 1})
              </span>
            )}

            {simulationResult.replicates && simulationResult.replicates > 1 && (
              <span
                data-testid="provenance-replicates-badge"
                className="inline-flex items-center gap-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1 text-xs font-semibold shadow-xs"
              >
                ⚡ {simulationResult.replicates} Replicates
              </span>
            )}

            {/* Run Buttons (Pill shaped with smooth rounding) */}
            <button
              type="button"
              data-testid="run-simulation-btn"
              onClick={() => executeSimulationOnServer()}
              disabled={isSimulating}
              className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-60 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            >
              {isDeterministicBusy ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <RotateCw className="h-3.5 w-3.5" />
              )}
              <span>{isDeterministicBusy ? 'Simulating...' : 'Run Simulation'}</span>
            </button>

            <button
              type="button"
              data-testid="run-monte-carlo-btn"
              onClick={() => executeSimulationOnServer({ replicates: 30 })}
              disabled={isSimulating}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-60 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
              title="Run 30 stochastic Monte Carlo replicates with Lognormal repair and Uniform propagation delays"
            >
              {isMonteCarloBusy && (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{isMonteCarloBusy ? 'Simulating (30 Reps)...' : 'Run Monte Carlo (30 Reps)'}</span>
            </button>
          </div>
        </header>

        {/* Main Content Workspace */}
        <main className="p-6 sm:p-8 space-y-8 max-w-[1600px] w-full mx-auto">
          {/* Stale Result Alert Banner */}
          {isStale && (
            <div
              data-testid="stale-result-banner"
              role="status"
              className="rounded-3xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50/50 p-4 sm:p-5 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span className="rounded-full bg-amber-500 text-white p-1.5 shadow-xs">
                  <AlertCircle className="h-3.5 w-3.5" />
                </span>
                <div>
                  <span className="font-bold text-amber-950">Inputs modified since last run: </span>
                  <span className="text-amber-800">
                    Current editor is at Rev #{inputRevision} — displaying previous results from Rev #{simulationResult.provenance?.input_revision ?? 1}.
                  </span>
                </div>
              </div>
              <button
                type="button"
                data-testid="stale-run-btn"
                onClick={() => executeSimulationOnServer()}
                disabled={isSimulating}
                className="rounded-full bg-amber-600 px-4 py-1.5 font-semibold text-white hover:bg-amber-700 shadow-sm transition-all whitespace-nowrap shrink-0"
              >
                Run Simulation to Update
              </button>
            </div>
          )}

          {/* Backend Error Alert Banner */}
          {backendError && (
            <div
              data-testid="backend-error-banner"
              role="alert"
              className="rounded-3xl border border-rose-200 bg-rose-50/80 p-5 text-xs text-rose-900 shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-rose-800 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-600" />
                  AUTHORITATIVE SIMULATION BACKEND ERROR
                </span>
                <button
                  type="button"
                  onClick={clearBackendError}
                  className="rounded-full px-2 py-0.5 text-rose-500 hover:text-rose-800 hover:bg-rose-100"
                >
                  ✕ Dismiss
                </button>
              </div>
              <p className="text-rose-700">{backendError}</p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => executeSimulationOnServer()}
                  disabled={isSimulating}
                  className="rounded-full bg-rose-600 px-4 py-1.5 font-semibold text-white hover:bg-rose-700 shadow-sm"
                >
                  Retry Authoritative Simulation
                </button>
                <button
                  type="button"
                  onClick={() => executeSimulationOnServer({ allowLegacyDemo: true })}
                  disabled={isSimulating}
                  className="rounded-full bg-white border border-rose-200 px-4 py-1.5 font-semibold text-rose-700 hover:bg-rose-100/60 shadow-xs"
                >
                  Run Legacy Demo Mode
                </button>
              </div>
            </div>
          )}

          {/* Hero KPI Banner Card (Styled after reference dashboard) */}
          <section
            aria-label="Simulation Summary Telemetry"
            className="rounded-3xl bg-white p-6 sm:p-8 shadow-sm border border-gray-100"
          >
            {(simulationResult.replicates ?? 1) > 1 && (
              <p className="mb-4 text-sm text-gray-600">Summary metrics use the deterministic run. See FMEA &amp; Capacity for Monte Carlo percentiles.</p>
            )}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8 pb-8 border-b border-gray-100">
              {/* Giant Metric Display */}
              <div>
                <div className="flex items-baseline gap-3">
                  <span
                    data-testid="kpi-min-capacity"
                    className="text-5xl sm:text-6xl font-extrabold tracking-tight text-gray-900"
                  >
                    {kpis.min_hourly_capacity.toFixed(0)}
                  </span>
                  {nominalCapacity !== undefined && (
                    <span className="text-xl sm:text-2xl font-bold text-gray-500">
                      / {nominalCapacity}
                    </span>
                  )}
                </div>
                <div className="text-sm font-medium text-gray-500 mt-1">
                  Minimum capacity / nominal capacity (movements per hour)
                </div>
              </div>

              {/* Smooth multi-stop gradient progress bar */}
              <div className="flex-1 max-w-2xl space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
                    {kpis.capacity_retention_pct.toFixed(1)}% nominal capacity floor
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-500 font-medium">
                      {lostCapacity} estimated lost movements
                    </span>
                    {lostCapacity > 0 && (
                      <span
                        className="font-semibold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200 text-[11px]"
                        title="Direct airline delay & passenger disruption cost calculated at standard $7,500/movement benchmark"
                      >
                        ≈ ${( (lostCapacity * 7500) / 1_000_000 ).toFixed(1)}M est. disruption
                      </span>
                    )}
                  </div>
                </div>
                {/* Horizontal progress bar with smooth vibrant gradient */}
                <div className="relative h-7 w-full rounded-full bg-gray-100/80 shadow-inner overflow-hidden p-1 flex items-center">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-orange-400 via-amber-300 to-emerald-400 shadow-sm transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.max(0, kpis.capacity_retention_pct))}%` }}
                  />
                </div>
              </div>
            </div>

            {/* 3 Sub-Metrics with subtle up/down trend pill badges */}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3 pt-6">
              {/* Metric 1 */}
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-gray-500">Mean Adjusted Risk Score</span>
                <div className="flex items-center gap-3 mt-1.5">
                  <span
                    data-testid="kpi-mean-residual-rpn"
                    className="text-2xl sm:text-3xl font-extrabold text-gray-900"
                  >
                    {kpis.mean_residual_rpn.toFixed(1)}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-600 border border-rose-100">
                    -{(100 - (kpis.mean_residual_rpn / Math.max(1, kpis.mean_raw_rpn)) * 100).toFixed(0)}%
                  </span>
                </div>
                <span className="text-xs text-gray-400 mt-1 font-medium">
                  from {kpis.mean_raw_rpn.toFixed(1)} raw RPN (tripartite mitigation)
                </span>
              </div>

              {/* Metric 2 */}
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-gray-500">{recovery ? "Sustained recovery" : "Preview hours below 90%"}</span>
                <div className="flex items-center gap-3 mt-1.5">
                  <span
                    data-testid="kpi-recovery-hours"
                    className="text-2xl sm:text-3xl font-extrabold text-amber-600"
                  >
                    {recovery
                      ? recovery.is_censored
                        ? 'Not reached'
                        : recovery.recovery_time_hours === 0
                          ? 'No threshold breach'
                          : `T+${recovery.recovery_time_hours} h`
                      : `${kpis.recovery_window_hours} h`}
                  </span>
                </div>
                <span className="text-xs text-gray-400 mt-1 font-medium">
                  {recovery
                    ? `Threshold: ${recovery.threshold_capacity} movements/hr for ${recovery.sustained_duration_hours} h`
                    : 'Hourly samples from the browser preview'}
                </span>
              </div>

              {/* Metric 3 */}
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-gray-500">Primary Graph Chokepoint</span>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-2xl sm:text-3xl font-extrabold text-gray-900">
                    {kpis.top_chokepoint_code}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-100">
                    idx {kpis.top_chokepoint_score.toFixed(1)}
                  </span>
                </div>
                <span className="text-xs text-gray-400 mt-1 font-medium">
                  Avg control score: {(kpis.average_control_score ?? kpis.tripartite_balance_index).toFixed(0)}%
                </span>
              </div>
            </div>
          </section>

          {/* Active Workspace View */}
          <div className="transition-opacity duration-200">
            {activeTab === 'topology' && <TopologyWorkspace />}
            {activeTab === 'fmea-capacity' && <FMEACapacityAnalytics />}
            {activeTab === 'easa-compliance' && <EASAComplianceView />}
            {activeTab === 'python-engine' && <PythonBackendView />}
          </div>
        </main>

        {/* Clean Light Footer */}
        <footer className="no-print border-t border-gray-100 bg-white px-8 py-5 text-xs text-gray-400">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              AeroCascade · Modernizing Aviation Infrastructure (Aggarwal &amp; Dhillon, AIAA Aviation 2026)
            </div>
            <div className="text-[11px] text-gray-400">
              EASA Part-IS (EU) 2022/1645 &amp; 2023/203 · EUROCAE ER-040 · PSOE Maturity
            </div>
          </div>
        </footer>
      </div>

      {/* VC Analyst Demo Walkthrough Modal */}
      {showVcTour && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="vc-tour-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-xs transition-opacity"
        >
          <div className="relative w-full max-w-2xl rounded-3xl bg-white p-6 sm:p-8 shadow-2xl border border-gray-100 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-5">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-100 px-3 py-0.5 text-xs font-semibold text-indigo-700 mb-2">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                  VC Demo &amp; Investment Overview
                </div>
                <h2 id="vc-tour-title" className="text-xl font-bold text-gray-900 tracking-tight">
                  AeroCascade: Resiliency Digital Twin for Critical Aviation Infrastructure
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  Predicting and mitigating multi-million dollar cascading capacity collapse in Remote Tower Centres (RTC)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowVcTour(false)}
                className="rounded-full p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                aria-label="Close VC Tour Modal"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Core Value Proposition Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-1">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">The Market Need</span>
                <div className="text-xs font-bold text-gray-900">$4.8B Aviation Shift</div>
                <p className="text-[11px] text-gray-500 leading-snug">
                  ANSPs are centralizing air traffic towers into multi-aerodrome digital centres, introducing massive cyber-physical fragility.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-1">
                <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">The Tech Moat</span>
                <div className="text-xs font-bold text-gray-900">Causal SimPy Engine</div>
                <p className="text-[11px] text-gray-500 leading-snug">
                  Traditional IT firewalls miss physical dependency cascades. AeroCascade simulates 3-stage failure and 30-rep Monte Carlo spreads.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 space-y-1">
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Regulatory Catalyst</span>
                <div className="text-xs font-bold text-gray-900">EASA Part-IS Mandate</div>
                <p className="text-[11px] text-gray-500 leading-snug">
                  EU 2022/1645 &amp; 2023/203 make cyber resilience audits and 72-hour incident reporting legally mandatory by 2026.
                </p>
              </div>
            </div>

            {/* 3-Step Clickable Demo Flow */}
            <div className="space-y-2.5">
              <span className="text-xs font-bold text-gray-900 uppercase tracking-wider">Recommended 3-Minute Demo Sequence</span>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('topology');
                  setShowVcTour(false);
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40 text-left transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="h-7 w-7 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                  <div>
                    <div className="text-xs font-bold text-gray-900 group-hover:text-indigo-700">Explore Cyber-Physical Failure Propagation</div>
                    <div className="text-[11px] text-gray-500">Show how Stage 1 optical spoofing cascades into Stage 2 sector overload and Stage 3 controller distrust.</div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-indigo-600 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('fmea-capacity');
                  executeSimulationOnServer({ replicates: 30 });
                  setShowVcTour(false);
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-gray-100 hover:border-purple-200 hover:bg-purple-50/40 text-left transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="h-7 w-7 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                  <div>
                    <div className="text-xs font-bold text-gray-900 group-hover:text-purple-700">Quantify Runway Capacity Collapse (Monte Carlo)</div>
                    <div className="text-[11px] text-gray-500">Show Chart 02's 5th–95th percentile confidence band across 30 stochastic replicates and calculate $1.4M+ in mitigated disruption.</div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-purple-600 shrink-0" />
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveTab('easa-compliance');
                  setShowVcTour(false);
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl border border-gray-100 hover:border-emerald-200 hover:bg-emerald-50/40 text-left transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="h-7 w-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                  <div>
                    <div className="text-xs font-bold text-gray-900 group-hover:text-emerald-700">Automate EASA Part-IS Regulatory Filing</div>
                    <div className="text-[11px] text-gray-500">Demonstrate instant JSON risk register export and executive print-ready dossier complying with Art. IS.I.OR.230.</div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-gray-400 group-hover:text-emerald-600 shrink-0" />
              </button>
            </div>

            {/* Bottom Actions */}
            <div className="flex items-center justify-between pt-2 border-t border-gray-100 text-xs">
              <div className="text-gray-500">
                <span className="font-semibold text-gray-700">Pricing Model:</span> $180k–$450k ACV Enterprise SaaS per aerodrome cluster
              </div>
              <button
                type="button"
                onClick={() => setShowVcTour(false)}
                className="rounded-full bg-gray-900 px-5 py-2 font-semibold text-white hover:bg-black transition-colors"
              >
                Got It, Let's Demo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
