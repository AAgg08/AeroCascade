import { useRef, useState, type ChangeEvent } from 'react';
import { useCascadeStore } from '../store/useCascadeStore.ts';
import { MAX_WORKSPACE_FILE_SIZE, parseWorkspace, serializeWorkspace } from '../store/workspaceSession.ts';

export function WorkspaceTransfer() {
  const fileInput = useRef<HTMLInputElement>(null);
  const readId = useRef(0);
  const [pending, setPending] = useState<{ text: string; title: string; demand: number; trigger: number } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function downloadWorkspace() {
    const state = useCascadeStore.getState();
    const text = serializeWorkspace(state);
    if (!parseWorkspace(text)) {
      setError('These settings could not be exported. Review the scenario inputs and try again.');
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `aerocascade-workspace-${state.activeScenarioId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setError('');
    setMessage('Workspace settings exported.');
  }

  async function readWorkspace(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    const id = ++readId.current;
    setPending(null);
    setMessage('');
    setError('');
    try {
      if (file.size > MAX_WORKSPACE_FILE_SIZE) throw new Error('File too large');
      const text = await file.text();
      if (id !== readId.current) return;
      const settings = parseWorkspace(text);
      if (!settings) throw new Error('Invalid workspace');
      const title = useCascadeStore.getState().scenarios.find((s) => s.id === settings.activeScenarioId)?.title;
      setPending({ text, title: title ?? settings.activeScenarioId, demand: settings.baselineMovementsPerHour, trigger: settings.triggerHour });
    } catch {
      if (id === readId.current) setError('Choose a compatible AeroCascade workspace JSON file under 100 KB.');
    }
  }

  function applyWorkspace() {
    if (!pending || !useCascadeStore.getState().importWorkspace(pending.text)) {
      setError('The workspace could not be imported.');
      return;
    }
    setPending(null);
    setError('');
    setMessage('Workspace loaded. Run Simulation to evaluate the imported settings.');
  }

  return (
    <section aria-label="Workspace files" className="mt-5 border-t border-gray-200 pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={downloadWorkspace} className="rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold">Export workspace</button>
        <button type="button" onClick={() => fileInput.current?.click()} className="rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold">Import workspace</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={readWorkspace} />
        <p className="text-xs text-gray-600">Transfer scenario settings as a JSON file.</p>
      </div>
      {pending && (
        <div className="mt-3 rounded-md border border-gray-200 p-3 text-sm">
          <p className="font-semibold">{pending.title}</p>
          <p className="mt-1 text-xs text-gray-600">{pending.demand} movements/hr · Trigger at hour {pending.trigger}</p>
          <p className="mt-1 text-xs text-gray-600">Loading this file replaces the current settings and starts a browser preview.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={applyWorkspace} className="rounded-md bg-gray-900 px-3 py-2 text-xs text-white">Load workspace</button>
            <button type="button" onClick={() => setPending(null)} className="rounded-md border border-gray-300 px-3 py-2 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-rose-700">{error}</p>}
      {message && <p role="status" className="mt-2 text-xs text-gray-600">{message}</p>}
    </section>
  );
}
