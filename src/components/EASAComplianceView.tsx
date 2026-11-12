import { useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import {
  Download,
  Printer,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  Lock,
  User,
  RefreshCw,
  FileCheck,
} from 'lucide-react';
import {
  calculateRawRPN,
  computeResidualRPN,
  evaluateNodePSOE,
} from '../domain/simulationEngine.ts';
import { PSOELevel } from '../domain/types.ts';
import { useCascadeStore } from '../store/useCascadeStore.ts';

const PSOE_STEPS: PSOELevel[] = [
  PSOELevel.NOT_PRESENT,
  PSOELevel.PRESENT,
  PSOELevel.SUITABLE,
  PSOELevel.OPERATIONAL,
  PSOELevel.EFFECTIVE,
];

export function EASAComplianceView() {
  const {
    nodes,
    simulationResult,
    currentTopologyId,
    currentTopologyVersion,
    inputRevision,
    userSession,
    activeDevRole,
    runApproval,
    runServerState,
    dossierLoading,
    dossierError,
    dossierSuccessMessage,
    fetchUserSession,
    setActiveDevRole,
    fetchRunApprovalStatus,
    approveCurrentRun,
    downloadEvidenceJson,
    clearDossierMessages,
  } = useCascadeStore();

  const printContainerRef = useRef<HTMLDivElement>(null);
  const [signoffNotes, setSignoffNotes] = useState('');
  const [approverName, setApproverName] = useState('');
  const [copiedHash, setCopiedHash] = useState(false);

  useEffect(() => {
    fetchUserSession();
    fetchRunApprovalStatus();
  }, [fetchUserSession, fetchRunApprovalStatus, simulationResult.run_id]);

  const handleCopyHash = (text?: string) => {
    if (!text) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }
  };

  const handleApprove = async () => {
    const success = await approveCurrentRun(signoffNotes, approverName);
    if (success) {
      setSignoffNotes('');
    }
  };

  const isStale = runServerState?.isStale || inputRevision !== simulationResult.provenance?.input_revision;
  const isPersisted = runServerState?.isPersisted ?? Boolean(simulationResult.run_id);
  const runDigest = runServerState?.runSha256 || simulationResult.input_hash || null;
  const userRole = userSession?.role || activeDevRole || 'analyst';
  const isApproverRole = userRole === 'approver' || userRole === 'administrator';

  const isEnterpriseApproval = runApproval?.approval_type === 'enterprise';
  const isExerciseApproval = runApproval?.approval_type === 'exercise';
  const isLegacyApproval = runApproval?.approval_type === 'legacy';
  const hasUnprovenInEnterprise = Boolean(
    userSession?.enterprise &&
      !isEnterpriseApproval &&
      (runServerState?.allApprovals?.legacy || runServerState?.allApprovals?.exercise)
  );

  const handlePrint = useReactToPrint({
    contentRef: printContainerRef,
    documentTitle: `${simulationResult.easa_notification.report_id}_EXERCISE_DRAFT`,
  });

  const handleDownloadJson = () => {
    const payload = {
      exercise_status: 'SIMULATION_EXERCISE_DRAFT',
      submission_notice:
        'This JSON export is a research simulation draft and does NOT constitute an officially accepted submission format by EASA or any national competent authority.',
      official_reference:
        'https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-information-security?erules-id=ERULES-1963177438-19981',
      generated_at: new Date().toISOString(),
      run_id: simulationResult.run_id,
      input_hash: simulationResult.input_hash,
      model_version: simulationResult.model_version,
      schema_version: simulationResult.schema_version,
      provenance: simulationResult.provenance,
      recovery_metrics: simulationResult.recovery_metrics,
      input_snapshot: simulationResult.input_snapshot,
      reporting_applicability: simulationResult.easa_notification.reporting_applicability,
      awareness_time: simulationResult.easa_notification.awareness_time,
      easa_part_is_notification: simulationResult.easa_notification,
      summary_kpis: simulationResult.summary_kpis,
      risk_register: simulationResult.node_analytics,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${simulationResult.easa_notification.report_id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const notification = simulationResult.easa_notification;

  return (
    <div className="space-y-8">
      {/* Top Action Bar */}
      <section
        aria-label="Regulatory Dossier Export Actions"
        className="no-print flex flex-col gap-4 rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-0.5 rounded-full border border-indigo-100">
              SIMULATION EXERCISE DRAFT · ILLUSTRATIVE REGULATORY MAPPING
            </span>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 font-medium">
              NOT AN OFFICIAL FILING
            </span>
          </div>
          <h2 className="mt-2 text-lg sm:text-xl font-bold text-gray-900 tracking-tight">
            Aviation Information Security Incident Simulation Exercise Dossier &amp; Risk Register
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            EASA Part-IS (EU) 2022/1645 &amp; (EU) 2023/203 Regulatory Notification Formulation
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            data-testid="export-json-btn"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-xs shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export Exercise JSON</span>
          </button>
          <button
            type="button"
            data-testid="print-dossier-btn"
            onClick={() => handlePrint()}
            className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-black transition-all shadow-sm shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Print Exercise Dossier</span>
          </button>
        </div>
      </section>

      {/* Enterprise Dossier Workflow & Authority Sign-Off Section */}
      <section
        aria-label="Enterprise Dossier Workflow and Run Sign-Off"
        className="no-print rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm space-y-6"
      >
        {/* Header & Session Bar */}
        <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                ENTERPRISE REGULATORY DOSSIER · RUN EVIDENCE SIGN-OFF
              </span>
              <span className="text-[10px] px-2.5 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600 font-medium">
                INTERNAL RECORD &amp; RUN INTEGRITY CHECK
              </span>
            </div>
            <h3 className="mt-2 text-base sm:text-lg font-bold text-gray-900 tracking-tight">
              EASA Part-IS Verification Record &amp; Immutable Evidence Export
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Bind simulation runs to saved topology versions, record internal designated approvals, and export verifiable evidence packages.
            </p>
          </div>

          {/* User Session & Role Indicator */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 bg-gray-50/80 rounded-2xl p-3 border border-gray-100 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-bold text-xs uppercase">
                {userSession?.username ? userSession.username[0] : 'U'}
              </div>
              <div>
                <div className="font-semibold text-gray-900 leading-tight">
                  {userSession?.username || 'synthetic-operator'}
                </div>
                <div className="text-[10px] text-gray-400">
                  {userSession?.enterprise ? 'Enterprise Account' : 'Gateway Session (Synthetic Fixtures)'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 font-medium">Role:</span>
              <span
                className={`font-bold px-2.5 py-0.5 rounded-full text-xs uppercase tracking-wider border ${
                  userRole === 'approver'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : userRole === 'administrator'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : userRole === 'reviewer'
                        ? 'bg-purple-50 text-purple-700 border-purple-200'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                }`}
              >
                {userRole}
              </span>
            </div>

            {!userSession?.enterprise && (
              <div className="flex items-center gap-1 pl-2 border-l border-gray-200">
                <span className="text-[10px] text-gray-400 font-medium">Simulate Role:</span>
                {(['analyst', 'reviewer', 'approver', 'administrator'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setActiveDevRole(r)}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all ${
                      userRole === r
                        ? 'bg-gray-900 text-white shadow-xs'
                        : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-100'
                    }`}
                  >
                    {r.slice(0, 3).toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Feedback Banners */}
        {dossierError && (
          <div
            data-testid="dossier-error-banner"
            className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-xs text-rose-800"
          >
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{dossierError}</span>
            </div>
            <button
              type="button"
              onClick={clearDossierMessages}
              className="font-bold text-rose-700 hover:text-rose-900"
            >
              ✕
            </button>
          </div>
        )}

        {dossierSuccessMessage && (
          <div
            data-testid="dossier-success-banner"
            className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-xs text-emerald-800"
          >
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{dossierSuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={clearDossierMessages}
              className="font-bold text-emerald-700 hover:text-emerald-900"
            >
              ✕
            </button>
          </div>
        )}

        {isStale && (
          <div
            data-testid="dossier-stale-banner"
            className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-800 font-medium"
          >
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <div>
              <span className="font-bold">Stale Run Warning:</span> Workspace inputs or topology version have been modified since this simulation was run. Re-run the simulation against saved topology v{currentTopologyVersion ?? 1} before sign-off.
            </div>
          </div>
        )}

        {/* Grid: Run Provenance (Left) & Approval Action (Right) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Run Provenance & Integrity (5 Cols) */}
          <div className="lg:col-span-5 rounded-2xl border border-gray-100 bg-gray-50/70 p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-gray-200/60 pb-3">
              <div className="font-bold text-gray-900 uppercase tracking-wider text-[11px]">
                Run Provenance &amp; Integrity
              </div>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  isPersisted
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                {isPersisted ? 'Persisted in Repository' : 'Unpersisted Local Mock'}
              </span>
            </div>

            <div className="space-y-3 tabular-nums">
              <div>
                <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Persisted Run ID</div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="font-mono font-semibold text-gray-800">
                    {simulationResult.run_id || 'None (Execute simulation first)'}
                  </span>
                  {simulationResult.run_id && (
                    <button
                      type="button"
                      onClick={() => handleCopyHash(simulationResult.run_id)}
                      className="text-gray-400 hover:text-gray-700 p-1"
                      title="Copy Run ID"
                    >
                      {copiedHash ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    </button>
                  )}
                </div>
              </div>

              <div>
                <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Bound Topology Version</div>
                <div className="mt-0.5 font-semibold text-gray-800">
                  {currentTopologyId || simulationResult.scenario_id} · <span className="text-indigo-600">v{currentTopologyVersion ?? 1}</span>
                </div>
              </div>

              <div>
                <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Run Integrity Check (SHA-256)</div>
                <div className="mt-0.5 flex items-center justify-between">
                  <span className="font-mono text-[11px] text-gray-700 truncate max-w-[240px]" title={runDigest || 'Pending'}>
                    {runDigest || 'Calculated by server upon simulation run'}
                  </span>
                  {runDigest && (
                    <button
                      type="button"
                      onClick={() => handleCopyHash(runDigest)}
                      className="text-gray-400 hover:text-gray-700 p-1 shrink-0"
                      title="Copy SHA-256 Digest"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[10px] text-gray-400 leading-relaxed">
                  Cryptographic digest verifying unmitigated and mitigated simulation results have not been altered.
                </p>
              </div>

              <div>
                <div className="text-gray-400 text-[10px] uppercase font-bold tracking-wider">Engine Calibration</div>
                <div className="mt-0.5 text-gray-600">
                  {simulationResult.provenance?.engine_label || 'AeroCascade Causal Simulator'} · Model {simulationResult.model_version || '2.0.0-causal'}
                </div>
              </div>
            </div>
          </div>

          {/* Internal Approval & Evidence Export (7 Cols) */}
          <div className="lg:col-span-7 rounded-2xl border border-gray-100 bg-white p-5 space-y-4 text-xs flex flex-col justify-between">
            {runApproval ? (
              /* State A: Run is Approved */
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`h-4 w-4 ${
                        isEnterpriseApproval
                          ? 'text-emerald-600'
                          : isExerciseApproval
                            ? 'text-indigo-600'
                            : 'text-amber-600'
                      }`}
                    />
                    <span className="font-bold text-gray-900 text-xs">Approval Status:</span>
                    <span
                      data-testid="approval-status-badge"
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                        isEnterpriseApproval
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : isExerciseApproval
                            ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                            : 'bg-amber-50 text-amber-700 border-amber-200'
                      }`}
                    >
                      {isEnterpriseApproval
                        ? 'APPROVED · ENTERPRISE AUDIT RECORD'
                        : isExerciseApproval
                          ? 'EXERCISE SIGN-OFF · NON-ENTERPRISE RECORD'
                          : 'LEGACY APPROVAL · UNPROVEN PROVENANCE'}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchRunApprovalStatus()}
                    className="text-gray-400 hover:text-gray-700 p-1"
                    title="Refresh server state"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${dossierLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                <div
                  className={`rounded-xl border p-4 space-y-2 ${
                    isEnterpriseApproval
                      ? 'border-emerald-100 bg-emerald-50/40'
                      : isExerciseApproval
                        ? 'border-indigo-100 bg-indigo-50/30'
                        : 'border-amber-100 bg-amber-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-800">
                      {isEnterpriseApproval ? 'Enterprise Authority' : isExerciseApproval ? 'Exercise Approver' : 'Legacy Approver'}:{' '}
                      <span className="font-bold text-gray-900">{runApproval.approver}</span>
                      {runApproval.authenticated_account && (
                        <span className="text-gray-400 font-normal ml-1.5 text-[11px]">
                          (Account: {runApproval.authenticated_account})
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-bold uppercase bg-white/80 border border-gray-200 px-2 py-0.5 rounded-full text-gray-700">
                      {runApproval.approver_role}
                    </span>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Recorded at: {new Date(runApproval.approved_at).toLocaleString()}
                  </div>
                  <div className="text-gray-700 italic border-l-2 border-gray-300 pl-3 py-1 my-1">
                    &ldquo;{runApproval.signoff_notes}&rdquo;
                  </div>
                  <div className="text-[10px] text-gray-400 flex items-center justify-between">
                    <span>Integrity Digest: {runApproval.run_sha256.slice(0, 16)}...</span>
                    <span>
                      {isEnterpriseApproval
                        ? 'Authenticated Enterprise Provenance'
                        : isExerciseApproval
                          ? 'Local Exercise Provenance'
                          : 'Unproven Pre-Migration Provenance'}
                    </span>
                  </div>
                </div>

                {/* Subtext clarifying regulatory validity */}
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  {isEnterpriseApproval
                    ? 'Cryptographically bound to authenticated enterprise credentials and recorded in immutable SQLite audit table dossier_approvals.'
                    : isExerciseApproval
                      ? 'Synthetic simulation exercise record from development. Does not create or represent an authenticated enterprise regulatory sign-off.'
                      : 'Pre-migration legacy approval lacking server-authenticated account verification. Re-approval or a fresh simulation run is required for enterprise filing.'}
                </p>

                {/* Re-approval or fresh-run path for legacy or exercise records in enterprise mode */}
                {(isLegacyApproval || (isExerciseApproval && userSession?.enterprise)) && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 space-y-2">
                    <div className="font-semibold">Re-Approval &amp; Fresh-Run Path</div>
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      This run lacks authenticated enterprise provenance. An authorized approver can establish a new verified audit record without silently upgrading old rows.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        data-testid="reapprove-btn"
                        onClick={handleApprove}
                        disabled={dossierLoading || !isApproverRole}
                        className="inline-flex items-center gap-1.5 rounded-full bg-amber-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-all shadow-xs disabled:opacity-40"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        <span>Re-Approve with Active Account</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    data-testid="download-evidence-btn"
                    onClick={() => downloadEvidenceJson()}
                    disabled={dossierLoading}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{dossierLoading ? 'Exporting...' : 'Download Verified Evidence Bundle (.json)'}</span>
                  </button>
                  <p className="text-[10px] text-gray-400">
                    Exports verified run, causal model trace, and cryptographic approval digest.
                  </p>
                </div>
              </div>
            ) : (
              /* State B: Run is Pending Approval */
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-amber-600" />
                    <span className="font-bold text-gray-900 text-xs">Approval Status:</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      PENDING DESIGNATED SIGN-OFF
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchRunApprovalStatus()}
                    className="text-gray-400 hover:text-gray-700 p-1"
                    title="Refresh server state"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${dossierLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {hasUnprovenInEnterprise && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-800 space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                      <span>Unproven Provenance in Reused Database</span>
                    </div>
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      An unauthenticated exercise or legacy record exists for this run from development. Enterprise mode requires an authenticated sign-off by a designated authority. Sign off below to record the enterprise approval.
                    </p>
                  </div>
                )}

                <p className="text-xs text-gray-500 leading-relaxed">
                  Enter sign-off notes below to record an internal compliance approval. Only Designated Approvers or Administrators can sign off on regulatory dossiers.
                </p>

                <div className="space-y-3">
                  <div>
                    <label htmlFor="approver-notes" className="block text-[11px] font-bold text-gray-700 mb-1">
                      Sign-Off Notes &amp; Audit Justification <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      id="approver-notes"
                      data-testid="signoff-notes-input"
                      rows={2}
                      value={signoffNotes}
                      onChange={(e) => setSignoffNotes(e.target.value)}
                      placeholder="e.g. Reviewed tripartite mitigations and formal controls for EASA Part-IS exercise audit..."
                      className="w-full rounded-xl border border-gray-200 p-2.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    />
                  </div>

                  <div>
                    <label htmlFor="approver-name" className="block text-[11px] font-bold text-gray-700 mb-1">
                      Approver Name / Title (Optional)
                    </label>
                    <input
                      id="approver-name"
                      data-testid="approver-name-input"
                      type="text"
                      value={approverName}
                      onChange={(e) => setApproverName(e.target.value)}
                      placeholder={userSession?.username || 'Designated Approver'}
                      className="w-full rounded-xl border border-gray-200 px-3 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    data-testid="signoff-approve-btn"
                    onClick={handleApprove}
                    disabled={dossierLoading || isStale || !isPersisted || !signoffNotes.trim()}
                    className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold text-white transition-all shadow-xs focus-visible:outline-none focus-visible:ring-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                      isApproverRole
                        ? 'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-600'
                        : 'bg-gray-700 hover:bg-gray-800 focus-visible:ring-gray-700'
                    }`}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>{dossierLoading ? 'Recording Approval...' : 'Sign-Off & Approve Run'}</span>
                  </button>

                  <button
                    type="button"
                    data-testid="download-unapproved-evidence-btn"
                    onClick={() => downloadEvidenceJson()}
                    disabled={dossierLoading || !simulationResult.run_id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 transition-all shadow-xs disabled:opacity-40"
                  >
                    <Download className="h-3 w-3" />
                    <span>Export Evidence JSON (Draft)</span>
                  </button>

                  {!isApproverRole && (
                    <span className="text-[10px] text-amber-700 font-medium">
                      Role Notice: Your role ({userRole}) will be evaluated by server-side RBAC upon sign-off.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Printable Regulatory Dossier Container */}
      <div ref={printContainerRef} className="space-y-8">
        {/* Section 1: EASA Part-IS Incident Exercise Header */}
        <section
          aria-label="EASA Part-IS Notification Form"
          className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm space-y-6"
        >
          <div className="flex flex-col gap-4 border-b border-gray-100 pb-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-semibold text-amber-600 bg-amber-50 px-3 py-0.5 rounded-full border border-amber-100 inline-block">
                EXERCISE DRAFT · SUBJECT TO ORGANIZATIONAL IS.I.OR.230 DETERMINATION
              </div>
              <h3 className="mt-2 text-xl font-extrabold text-gray-900">
                {notification.report_id}
              </h3>
              <p className="mt-1 text-xs text-gray-500 font-medium">
                Reporting Entity: {notification.reporting_entity}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                <span>Applicability: <span className="font-semibold text-gray-700">{notification.reporting_applicability}</span></span>
                <span>Awareness Time: <span className="font-semibold text-gray-700">{notification.awareness_time}</span></span>
              </div>
            </div>
            <div className="text-xs text-gray-600 space-y-1.5 lg:text-right">
              <div className="font-semibold text-gray-900">{notification.incident_classification}</div>
              <div className="inline-block rounded-full bg-amber-50 px-3 py-1 font-bold text-amber-700 border border-amber-200">
                {notification.er040_risk_class}
              </div>
              <div className="text-xs text-gray-400">
                Official Guidance:{' '}
                <a
                  href={notification.official_guidance_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 underline hover:text-indigo-800"
                >
                  EASA Easy Access Rules Part-IS
                </a>
              </div>
            </div>
          </div>

          {/* Three-Stage Notification Timeline (EASA IS.I.OR.230) */}
          <div className="border-b border-gray-100 pb-6">
            <div className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">
              EASA PART-IS IS.I.OR.230 EXERCISE REPORTING WORKFLOW
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
                <div className="text-xs text-indigo-600 font-bold">STAGE 1: INITIAL NOTIFICATION</div>
                <div className="mt-1 font-semibold text-gray-900">Without Undue Delay</div>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Notify competent authority and relevant stakeholders as soon as the security condition becomes known and represents potential safety impact.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
                <div className="text-xs text-amber-600 font-bold">STAGE 2: INITIAL REPORT</div>
                <div className="mt-1 font-semibold text-gray-900">Within 72 Hours Max</div>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Submit initial report as soon as possible, in any case within 72h of awareness, unless exceptional circumstances prevent it.
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
                <div className="text-xs text-emerald-600 font-bold">STAGE 3: FOLLOW-UP REPORT</div>
                <div className="mt-1 font-semibold text-gray-900">Post-Investigation</div>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Detailed technical analysis, root-cause assessment, and structural remediation commitments once investigation concludes.
                </p>
              </div>
            </div>
          </div>

          {/* Statutory Regulations vs Voluntary Standards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 border-b border-gray-100 pb-6 text-xs">
            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
              <div className="text-xs text-indigo-600 font-bold uppercase tracking-wider">
                STATUTORY BINDING EU REGULATIONS
              </div>
              <ul className="mt-2 space-y-1.5 text-gray-600 list-disc list-inside">
                {(notification.statutory_regulations?.length
                  ? notification.statutory_regulations
                  : [
                      'Commission Delegated Regulation (EU) 2022/1645 (Part-IS.D)',
                      'Commission Implementing Regulation (EU) 2023/203 (Part-IS.I, including IS.I.OR.230)',
                    ]
                ).map((reg, idx) => (
                  <li key={idx} className="leading-relaxed font-medium">{reg}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-5">
              <div className="text-xs text-gray-500 font-bold uppercase tracking-wider">
                VOLUNTARY INDUSTRY STANDARDS &amp; GUIDANCE
              </div>
              <ul className="mt-2 space-y-1.5 text-gray-600 list-disc list-inside">
                {(notification.voluntary_standards?.length
                  ? notification.voluntary_standards
                  : [
                      'EUROCAE ED-202A / ER-040 Information Security Management Guidelines (Voluntary Guidance)',
                    ]
                ).map((std, idx) => (
                  <li key={idx} className="leading-relaxed font-medium">{std}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Three-Stage Root Cause & Blocker Breakdown */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 text-xs">
            <div className="rounded-2xl border border-rose-100 bg-rose-50/40 p-5">
              <div className="font-bold text-rose-700">
                ● STAGE 1: TECHNICAL INGRESS VECTOR
              </div>
              <p className="mt-2 text-gray-700 leading-relaxed">
                {notification.stage_1_technical_root_cause}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50/40 p-5">
              <div className="font-bold text-amber-700">
                ▲ STAGE 2: OPERATIONAL FRAGILITY PROPAGATION
              </div>
              <p className="mt-2 text-gray-700 leading-relaxed">
                {notification.stage_2_operational_propagation}
              </p>
            </div>
            <div className="rounded-2xl border border-purple-100 bg-purple-50/40 p-5">
              <div className="font-bold text-purple-700">
                ✖ STAGE 3: FORMAL &amp; INFORMAL RECOVERY BLOCKER
              </div>
              <p className="mt-2 text-gray-700 leading-relaxed">
                {notification.stage_3_governance_recovery_blocker}
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Illustrative 5x5 Screening Matrix + PSOE Maturity Estimates */}
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
          {/* Illustrative 5x5 Matrix (7 cols) */}
          <section
            aria-label="Illustrative 5x5 Screening Matrix"
            className="xl:col-span-7 rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm"
          >
            <div className="border-b border-gray-100 pb-4 mb-5">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                ILLUSTRATIVE 5×5 SCREENING MATRIX · PENDING VERIFIED ER-040 CLAUSE MAPPING
              </div>
              <h3 className="mt-1 text-base font-bold text-gray-900">
                Illustrative 5×5 Likelihood vs. Operational Severity Screening Matrix
              </h3>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                Illustrative screening tool only. Does not assert an authoritative aviation safety classification or regulatory compliance determination under ER-040. Mean score thresholds do not establish regulatory acceptability.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] text-gray-400 font-semibold">
                    <th className="p-2.5 text-left">LIKELIHOOD \ IMPACT</th>
                    <th className="p-2.5 text-center">1 · NEGLIGIBLE</th>
                    <th className="p-2.5 text-center">2 · MINOR</th>
                    <th className="p-2.5 text-center">3 · MAJOR</th>
                    <th className="p-2.5 text-center">4 · HAZARDOUS</th>
                    <th className="p-2.5 text-center">5 · CATASTROPHIC</th>
                  </tr>
                </thead>
                <tbody>
                  {[5, 4, 3, 2, 1].map((likelihoodRow) => (
                    <tr key={likelihoodRow} className="border-b border-gray-100">
                      <td className="p-2.5 font-semibold text-gray-700 whitespace-nowrap bg-gray-50/60 text-xs">
                        L={likelihoodRow} {likelihoodRow === 5 ? '(Frequent)' : likelihoodRow === 4 ? '(Probable)' : likelihoodRow === 3 ? '(Remote)' : likelihoodRow === 2 ? '(Extremely Remote)' : '(Improbable)'}
                      </td>
                      {[1, 2, 3, 4, 5].map((impactCol) => {
                        const cellNodes = nodes.filter(
                          (n) =>
                            n.fmea.likelihood === likelihoodRow &&
                            n.fmea.impact === impactCol
                        );
                        const riskScore = likelihoodRow * impactCol;
                        const cellBg =
                          riskScore >= 15
                            ? 'bg-rose-50/80 border-rose-100 text-rose-900'
                            : riskScore >= 8
                              ? 'bg-amber-50/80 border-amber-100 text-amber-900'
                              : 'bg-emerald-50/60 border-emerald-100 text-emerald-900';

                        return (
                          <td
                            key={impactCol}
                            className={`border p-2 align-top min-w-[96px] h-16 ${cellBg}`}
                          >
                            <div className="text-[10px] font-medium opacity-60">L{likelihoodRow}×I{impactCol}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {cellNodes.map((cn) => (
                                <span
                                  key={cn.id}
                                  className="inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-gray-800 border border-gray-200/80 shadow-xs"
                                >
                                  {cn.code}
                                </span>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* PSOE Maturity Model Assessment (5 cols) */}
          <section
            aria-label="PSOE Maturity Model Estimates"
            className="xl:col-span-5 rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm flex flex-col justify-between"
          >
            <div>
              <div className="border-b border-gray-100 pb-4 mb-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                  EASA PART-IS OVERSIGHT · PSOE MATURITY ESTIMATES
                </div>
                <h3 className="mt-1 text-base font-bold text-gray-900">
                  Illustrative PSOE Maturity Progression
                </h3>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Slider-derived illustrative maturity estimates, not verified organizational assessments. Zero control settings indicate NOT_PRESENT.
                </p>
              </div>

              <div className="space-y-4">
                {Object.entries(notification.psoe_maturity_summary).map(([dimension, level]) => {
                  const activeStepIdx = PSOE_STEPS.indexOf(level as PSOELevel);
                  return (
                    <div
                      key={dimension}
                      className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-gray-800">{dimension}</span>
                        <span className="font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100 text-[11px]">
                          {level.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-5 gap-1.5 text-[10px]">
                        {PSOE_STEPS.map((step, idx) => {
                          const achieved = activeStepIdx >= 0 && idx <= activeStepIdx;
                          return (
                            <div
                              key={step}
                              className={`rounded-full py-1 text-center font-medium border ${
                                achieved
                                  ? 'border-indigo-300 bg-indigo-600 text-white font-semibold shadow-xs'
                                  : 'border-gray-200 bg-white text-gray-400'
                              }`}
                              title={step}
                            >
                              {step === PSOELevel.NOT_PRESENT ? 'NONE' : step.slice(0, 4)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Proposed Structural Remediation Actions */}
            <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 text-xs">
              <div className="font-bold text-emerald-800">
                PROPOSED STRUCTURAL ACTIONS (SIMULATION RECOMMENDATIONS)
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Model-generated recommendations for organizational evaluation; not legally binding authority directives.
              </p>
              <ul className="mt-2.5 space-y-1.5 text-gray-700 list-disc list-inside">
                {notification.structural_remediations.map((rem, i) => (
                  <li key={i} className="leading-relaxed">
                    {rem}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        {/* Section 3: Node-Level Regulatory Risk & PSOE Register */}
        <section
          aria-label="Node-Level Regulatory Risk Register"
          className="rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden"
        >
          <div className="border-b border-gray-100 px-6 sm:px-8 py-5">
            <h3 className="text-base font-bold text-gray-900">
              Illustrative System Asset Compliance Register (Pending Verified Clause Mapping)
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Asset by asset mapping to EUROCAE ER-040 operational severity and residual risk metrics
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-[11px] font-semibold text-gray-500">
                  <th className="py-3 px-6">ASSET CODE</th>
                  <th className="py-3 px-6">SUBSYSTEM</th>
                  <th className="py-3 px-6">ER-040 SEVERITY</th>
                  <th className="py-3 px-6">PSOE STATUS</th>
                  <th className="py-3 px-6 text-right">RAW / ADJUSTED RISK</th>
                  <th className="py-3 px-6">PROPOSED TRIPARTITE ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {nodes.map((n) => (
                  <tr key={n.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-6 font-semibold text-gray-900 whitespace-nowrap">
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-bold text-gray-800">
                        {n.code}
                      </span>
                    </td>
                    <td className="py-3 px-6 text-gray-800">
                      <div className="font-semibold">{n.label}</div>
                      <div className="text-[11px] text-gray-500">{n.subsystem}</div>
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap">
                      <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold">
                        {n.er040_severity}
                      </span>
                    </td>
                    <td className="py-3 px-6 whitespace-nowrap">
                      <span className="rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 px-2.5 py-0.5 text-xs font-semibold">
                        {evaluateNodePSOE(n)}
                      </span>
                    </td>
                    <td className="py-3 px-6 tabular-nums text-right text-gray-700 whitespace-nowrap">
                      {calculateRawRPN(n.fmea)} → <span className="font-bold text-emerald-600">{computeResidualRPN(n).toFixed(1)}</span>
                    </td>
                    <td className="py-3 px-6 text-gray-600 max-w-md">
                      {n.mitigation_recommendation}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
