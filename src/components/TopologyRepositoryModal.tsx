import { useEffect, useState } from 'react';
import { useCascadeStore } from '../store/useCascadeStore.ts';
import { GitBranch, GitCommit, Copy, RefreshCw, X, AlertTriangle, CheckCircle2, History } from 'lucide-react';

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
  } = useCascadeStore();

  const [changeSummary, setChangeSummary] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [targetCloneId, setTargetCloneId] = useState<string | null>(null);

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
                Topology Repository & Version Control
              </h2>
              <p className="text-xs text-gray-500">
                Immutable SQLite-backed version store, lineage tracking, and optimistic locking.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              clearTopologyConflictError();
              clearTopologySuccessMessage();
              setTopologyModalOpen(false);
            }}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
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
            Refresh
          </button>
        </div>

        {/* Notifications: Conflict Error (Optimistic Lock Rejection) & Success */}
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

        {/* Actions Strip: Save Version & Clone */}
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
                writes if v{currentVersionNum} was already bumped.
              </p>
              <input
                type="text"
                placeholder="Change summary (e.g. Adjusted radar latency and failover)..."
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
                Creates an independent topology with a new identity while preserving origin lineage (
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
              No topologies loaded from repository. Click "Refresh" or ensure backend server is active.
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
    </div>
  );
}
