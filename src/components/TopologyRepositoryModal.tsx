import { useEffect, useState, useRef } from 'react';
import { useCascadeStore } from '../store/useCascadeStore.ts';
import {
  GitBranch,
  GitCommit,
  Copy,
  RefreshCw,
  X,
  AlertTriangle,
  CheckCircle2,
  History,
  Upload,
  FileSpreadsheet,
  Download,
  Check,
  AlertCircle,
} from 'lucide-react';

export function TopologyRepositoryModal() {
  const {
    isTopologyModalOpen,
    setTopologyModalOpen,
    topologies,
    currentTopologyId,
    currentTopologyVersion,
    topologyLoading,
    topologyConflictError,
    topologySuccessMessage,
    fetchTopologies,
    openTopology,
    saveNewTopologyVersion,
    cloneTopology,
    clearTopologyConflictError,
    clearTopologySuccessMessage,
    importPreview,
    importLoading,
    importError,
    uploadImportFile,
    saveImportedTopology,
    clearImportPreview,
  } = useCascadeStore();

  const [activeTab, setActiveTab] = useState<'versions' | 'import'>('versions');
  const [changeSummary, setChangeSummary] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [targetCloneId, setTargetCloneId] = useState<string | null>(null);

  // Import Tab State
  const [importCustomName, setImportCustomName] = useState('');
  const [confirmCycles, setConfirmCycles] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isTopologyModalOpen) {
      fetchTopologies();
    }
  }, [isTopologyModalOpen, fetchTopologies]);

  if (!isTopologyModalOpen) return null;

  const currentVersionNum = currentTopologyVersion || 1;

  const handleSaveVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changeSummary.trim()) return;
    const ok = await saveNewTopologyVersion(changeSummary.trim());
    if (ok) setChangeSummary('');
  };

  const handleClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneName.trim()) return;
    const ok = await cloneTopology(cloneName.trim(), targetCloneId || undefined);
    if (ok) {
      setCloneName('');
      setTargetCloneId(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setConfirmCycles(false);
    setImportCustomName(file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '));
    await uploadImportFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveImport = async () => {
    if (!importPreview?.preview_topology) return;
    const finalName = importCustomName.trim() || importPreview.preview_topology.name;
    const ok = await saveImportedTopology(finalName, confirmCycles);
    if (ok) {
      setActiveTab('versions');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="repo-modal-title"
    >
      <div className="relative w-full max-w-4xl rounded-2xl bg-white shadow-2xl border border-gray-100 p-6 md:p-8 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600">
              <History className="h-6 w-6" />
            </div>
            <div>
              <h2 id="repo-modal-title" className="text-xl font-bold text-gray-900">
                Topology Repository & Ingestion Hub
              </h2>
              <p className="text-xs text-gray-500">
                SQLite-backed version store, server-side spreadsheet preview, and optimistic locking.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              clearTopologyConflictError();
              clearTopologySuccessMessage();
              clearImportPreview();
              setTopologyModalOpen(false);
            }}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal Tabs Navigation */}
        <div className="flex border-b border-gray-200 mb-4 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('versions')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'versions'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <GitBranch className="h-4 w-4" />
            Repository Versions ({topologies.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'import'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <FileSpreadsheet className="h-4 w-4" />
            Import Spreadsheet / CSV / JSON
            {importPreview && (
              <span
                className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  importPreview.valid ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                }`}
              >
                {importPreview.valid ? 'Ready' : `${importPreview.summary.error_count} Errors`}
              </span>
            )}
          </button>
        </div>

        {/* Status / Active Info Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 border border-slate-200/60 p-3 mb-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">Active Workspace Topology:</span>
            <code className="bg-slate-200/80 px-2 py-0.5 rounded text-slate-800 font-mono">
              {currentTopologyId || 'default'}
            </code>
            <span className="bg-indigo-100 text-indigo-800 font-semibold px-2 py-0.5 rounded-full">
              v{currentVersionNum}
            </span>
          </div>
          <button
            type="button"
            onClick={() => fetchTopologies()}
            disabled={topologyLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${topologyLoading ? 'animate-spin' : ''}`} />
            Refresh List
          </button>
        </div>

        {/* Global Notifications */}
        {topologyConflictError && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div className="flex-1">
              <strong className="font-semibold block mb-0.5">Write Rejected / Conflict</strong>
              <span>{topologyConflictError}</span>
            </div>
            <button
              type="button"
              onClick={clearTopologyConflictError}
              className="text-rose-500 hover:text-rose-700 font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {topologySuccessMessage && (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-800 flex items-start gap-2.5">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            <div className="flex-1">
              <strong className="font-semibold block mb-0.5">Success</strong>
              <span>{topologySuccessMessage}</span>
            </div>
            <button
              type="button"
              onClick={clearTopologySuccessMessage}
              className="text-emerald-500 hover:text-emerald-700 font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* TAB 1: VERSIONS & CLONES */}
        {activeTab === 'versions' && (
          <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {/* Save New Version Card */}
              <form
                onSubmit={handleSaveVersion}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <GitCommit className="h-4 w-4 text-indigo-600" />
                    <h3 className="font-semibold text-gray-900 text-sm">Save as New Version</h3>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Commits current workspace state as immutable <strong>v{currentVersionNum + 1}</strong>. Rejects stale
                    writes if v{currentVersionNum} was superseded.
                  </p>
                  <input
                    type="text"
                    placeholder="Change summary (e.g. Hardened radar failover delay)..."
                    value={changeSummary}
                    onChange={(e) => setChangeSummary(e.target.value)}
                    className="w-full text-xs rounded-lg border border-gray-200 px-3 py-2 text-gray-800 placeholder-gray-400 focus:outline-hidden focus:border-indigo-500 mb-3"
                  />
                </div>
                <button
                  type="submit"
                  disabled={topologyLoading || !changeSummary.trim()}
                  className="inline-flex items-center justify-center gap-1.5 w-full rounded-lg bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  <GitCommit className="h-3.5 w-3.5" />
                  Save New Version (v{currentVersionNum + 1})
                </button>
              </form>

              {/* Clone Topology Card */}
              <form
                onSubmit={handleClone}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Copy className="h-4 w-4 text-amber-600" />
                    <h3 className="font-semibold text-gray-900 text-sm">Clone Topology</h3>
                  </div>
                  <p className="text-xs text-gray-500 mb-3">
                    Creates an independent topology with a new identity while tracking origin lineage (
                    <code>cloned_from_id</code> and <code>cloned_from_version</code>).
                  </p>
                  <input
                    type="text"
                    placeholder="New topology name (e.g. Remote Tower Stress Test A)..."
                    value={cloneName}
                    onChange={(e) => setCloneName(e.target.value)}
                    className="w-full text-xs rounded-lg border border-gray-200 px-3 py-2 text-gray-800 placeholder-gray-400 focus:outline-hidden focus:border-amber-500 mb-3"
                  />
                </div>
                <button
                  type="submit"
                  disabled={topologyLoading || !cloneName.trim()}
                  className="inline-flex items-center justify-center gap-1.5 w-full rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  Clone as New Topology
                </button>
              </form>
            </div>

            {/* Topologies List */}
            <div className="flex-1 overflow-y-auto pr-1">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">
                Stored Topologies ({topologies.length})
              </h3>
              {topologies.length === 0 ? (
                <div className="text-center py-8 text-gray-400 text-xs">
                  No topologies loaded from repository. Click "Refresh List" or verify backend is active.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {topologies.map((top) => {
                    const isCurrent = top.id === currentTopologyId;
                    return (
                      <div
                        key={top.id}
                        className={`rounded-xl border p-3.5 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isCurrent
                            ? 'border-indigo-300 bg-indigo-50/40 ring-1 ring-indigo-200'
                            : 'border-gray-200 bg-white hover:border-gray-300'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-sm text-gray-900">{top.name}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                              v{top.current_version}
                            </span>
                            {isCurrent && (
                              <span className="rounded-full bg-indigo-600 text-white px-2 py-0.5 text-[10px] font-semibold">
                                ACTIVE
                              </span>
                            )}
                            {top.cloned_from_id && (
                              <span className="rounded-full bg-amber-50 border border-amber-200 text-amber-800 px-2 py-0.5 text-[10px] font-medium">
                                Cloned from {top.cloned_from_id} (v{top.cloned_from_version})
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 line-clamp-1">{top.description}</p>
                          <div className="flex items-center gap-3 text-[10px] text-gray-400">
                            <span>ID: {top.id}</span>
                            <span>•</span>
                            <span>Updated: {new Date(top.updated_at).toLocaleString()}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => openTopology(top.id)}
                            disabled={topologyLoading || isCurrent}
                            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                          >
                            {isCurrent ? 'Opened' : 'Open in Workspace'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTargetCloneId(top.id);
                              setCloneName(`${top.name} (Clone)`);
                            }}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                            title="Clone this topology"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: SERVER-SIDE IMPORT & PREVIEW */}
        {activeTab === 'import' && (
          <div className="flex-1 overflow-y-auto flex flex-col space-y-4">
            {/* Downloadable Official Templates Strip */}
            <div className="rounded-xl bg-slate-50 border border-slate-200/80 p-3.5 text-xs">
              <span className="font-semibold text-slate-800 block mb-2">
                Download Official Ingestion Templates:
              </span>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/api/import/templates/one-sheet.xlsx"
                  download="vendor_template_one_sheet.xlsx"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-100 transition-colors"
                >
                  <Download className="h-3.5 w-3.5 text-indigo-600" />
                  1-Sheet Vendor Template (.xlsx)
                </a>
                <a
                  href="/api/import/templates/two-sheet.xlsx"
                  download="vendors_dependencies_workbook.xlsx"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-100 transition-colors"
                >
                  <Download className="h-3.5 w-3.5 text-indigo-600" />
                  2-Sheet Vendors/Dependencies (.xlsx)
                </a>
                <a
                  href="/api/import/templates/one-sheet.csv"
                  download="vendor_template_one_sheet.csv"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 font-medium hover:bg-slate-100 transition-colors"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-600" />
                  1-Sheet Template (.csv)
                </a>
                <a
                  href="/api/import/templates/synthetic-30-nodes.xlsx"
                  download="synthetic_airport_30nodes.xlsx"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-300 bg-amber-50/80 text-amber-900 font-semibold hover:bg-amber-100 transition-colors"
                >
                  <Download className="h-3.5 w-3.5 text-amber-700" />
                  30-Node Airport Benchmark (.xlsx)
                </a>
              </div>
            </div>

            {/* Upload Area */}
            {!importPreview && (
              <div className="border-2 border-dashed border-gray-300 hover:border-indigo-500 rounded-2xl p-8 text-center transition-colors flex flex-col items-center justify-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  id="import-file-upload"
                  accept=".xlsx,.csv,.json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <label
                  htmlFor="import-file-upload"
                  className="cursor-pointer flex flex-col items-center space-y-2"
                >
                  <div className="p-3 bg-indigo-50 rounded-2xl text-indigo-600">
                    <Upload className="h-8 w-8" />
                  </div>
                  <span className="text-sm font-semibold text-gray-800">
                    Select .xlsx, UTF-8 CSV, or Canonical JSON file
                  </span>
                  <span className="text-xs text-gray-500 max-w-md">
                    Bounded server parser enforces 5MB limit, 500 max rows, formula injection checks,
                    provisional IDs, and reciprocal declaration reconciliation.
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors">
                    {importLoading ? 'Validating on Server...' : 'Browse File & Preview'}
                  </span>
                </label>
              </div>
            )}

            {/* Error Banner */}
            {importError && (
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-800 flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                <div className="flex-1">
                  <strong className="font-semibold block mb-0.5">Import Validation Failed</strong>
                  <span>{importError}</span>
                </div>
              </div>
            )}

            {/* Server-Side Import Preview Section */}
            {importPreview && (
              <div className="space-y-4">
                {/* Preview Header Strip */}
                <div className="rounded-xl border border-gray-200 bg-white p-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-gray-900">{importPreview.file_name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          importPreview.valid ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {importPreview.valid ? '● VALID PREVIEW' : '✖ REJECTED / ERRORS'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Type: {importPreview.file_type.toUpperCase()} • Staged in server memory only (not yet saved).
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={clearImportPreview}
                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      Cancel / Discard
                    </button>
                    {importPreview.valid && (
                      <button
                        type="button"
                        onClick={handleSaveImport}
                        disabled={importLoading || (importPreview.cycles.length > 0 && !confirmCycles)}
                        className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Check className="h-4 w-4" />
                        {importLoading ? 'Saving...' : 'Save & Open in Workspace'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Summary Metrics Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Nodes</span>
                    <span className="text-base font-extrabold text-slate-800">
                      {importPreview.summary.node_count}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Dependencies</span>
                    <span className="text-base font-extrabold text-slate-800">
                      {importPreview.summary.edge_count}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Deduplicated</span>
                    <span className="text-base font-extrabold text-indigo-700">
                      {importPreview.summary.deduplicated_edge_count}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Provisional IDs</span>
                    <span className="text-base font-extrabold text-amber-700">
                      {importPreview.summary.provisional_id_count}
                    </span>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">Cycles</span>
                    <span
                      className={`text-base font-extrabold ${
                        importPreview.summary.cycle_count > 0 ? 'text-rose-600' : 'text-slate-800'
                      }`}
                    >
                      {importPreview.summary.cycle_count}
                    </span>
                  </div>
                </div>

                {/* Cycles Alert & Engine Confirmation */}
                {importPreview.cycles.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
                    <div className="flex items-center gap-2 font-bold text-amber-800">
                      <AlertTriangle className="h-4 w-4" />
                      Feedback Cycles Detected ({importPreview.cycles.length})
                    </div>
                    <p className="leading-relaxed text-amber-800/90">
                      {importPreview.cycle_handling_explanation}
                    </p>
                    <div className="bg-white/80 p-2 rounded-lg border border-amber-200 font-mono text-[11px] text-amber-950">
                      {importPreview.cycles.slice(0, 3).map((c, idx) => (
                        <div key={idx}>• {c}</div>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 pt-1 font-semibold text-amber-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmCycles}
                        onChange={(e) => setConfirmCycles(e.target.checked)}
                        className="rounded text-amber-600 focus:ring-amber-500 h-4 w-4"
                      />
                      <span>I understand and confirm cycle simulation dynamics for this topology</span>
                    </label>
                  </div>
                )}

                {/* Validation Errors Table */}
                {importPreview.errors.length > 0 && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4">
                    <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider mb-2">
                      Row-Level Errors ({importPreview.errors.length})
                    </h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-rose-200 text-rose-900 font-bold">
                            <th className="py-1.5 px-2">Source Reference</th>
                            <th className="py-1.5 px-2">Column</th>
                            <th className="py-1.5 px-2">Message</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-rose-100 text-rose-950">
                          {importPreview.errors.map((err, i) => (
                            <tr key={i} className="hover:bg-rose-100/50">
                              <td className="py-1.5 px-2 font-mono whitespace-nowrap">{err.source_ref || `Row ${err.row || '-'}`}</td>
                              <td className="py-1.5 px-2 font-semibold whitespace-nowrap">{err.column || '-'}</td>
                              <td className="py-1.5 px-2">{err.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Warnings List */}
                {importPreview.warnings.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                    <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-2">
                      Warnings & Reconciliations ({importPreview.warnings.length})
                    </h4>
                    <ul className="text-xs text-amber-900 space-y-1 max-h-36 overflow-y-auto pr-1">
                      {importPreview.warnings.map((w, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-amber-500 font-bold">•</span>
                          <span>
                            <strong className="font-semibold">{w.source_ref || `Row ${w.row || '-'}`}:</strong> {w.message}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Topology Name & Save Bar */}
                {importPreview.valid && (
                  <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-2xs space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Topology Name in Repository:
                      </label>
                      <input
                        type="text"
                        value={importCustomName}
                        onChange={(e) => setImportCustomName(e.target.value)}
                        placeholder="e.g. Frankfurt Main Digital Remote Tower..."
                        className="w-full text-xs rounded-lg border border-gray-200 px-3 py-2 text-gray-800 focus:outline-hidden focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-gray-500">
                        Will save <strong>{importPreview.summary.node_count} nodes</strong> and{' '}
                        <strong>{importPreview.summary.edge_count} dependencies</strong> in one transaction.
                      </span>
                      <button
                        type="button"
                        onClick={handleSaveImport}
                        disabled={importLoading || (importPreview.cycles.length > 0 && !confirmCycles)}
                        className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-40 transition-colors inline-flex items-center gap-1.5"
                      >
                        <Check className="h-4 w-4" />
                        {importLoading ? 'Saving...' : 'Save to Repository & Open'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
