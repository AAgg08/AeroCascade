import { useEffect, useRef } from 'react';
import type { WorkspaceTab } from '../store/useCascadeStore.ts';

interface Props {
  onClose: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
  onRun: () => void;
  onReset: () => void;
  isRunning: boolean;
}

export function GettingStarted({ onClose, onNavigate, onRun, onReset, isRunning }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  function navigate(tab: WorkspaceTab) {
    dialog.current?.close();
    onNavigate(tab);
  }

  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="getting-started-title"
      aria-describedby="getting-started-description"
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 text-gray-900 shadow-xl backdrop:bg-gray-900/50">
      <div className="flex items-start justify-between gap-4">
        <h2 id="getting-started-title" className="text-xl font-bold">Start an aviation risk exercise</h2>
        <button type="button" autoFocus onClick={() => dialog.current?.close()}
          className="rounded-md px-3 py-2 text-sm hover:bg-gray-100">Close</button>
      </div>
      <p id="getting-started-description" className="mt-3 text-sm text-gray-600">
        Choose a scenario, adjust controls, and compare simulated recovery. Settings save on this device when browser storage is available.
      </p>
      <ol className="mt-6 space-y-5 text-sm">
        <li>
          <h3 className="font-semibold">Configure the scenario</h3>
          <p className="mt-1 text-gray-600">In Topology &amp; DES, select an aviation scenario and inspect its technical, formal, and informal controls.</p>
          <button type="button" onClick={() => navigate('topology')}
            className="mt-2 rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50">Open scenarios</button>
        </li>
        <li>
          <h3 className="font-semibold">Run and compare recovery</h3>
          <p className="mt-1 text-gray-600">The initial numbers are a browser preview. Run the Python simulation for results from the causal engine. Monte Carlo adds a 5th–95th percentile band for the sampled inputs.</p>
          <button type="button" disabled={isRunning} onClick={() => { dialog.current?.close(); onRun(); }}
            className="mt-2 rounded-md bg-gray-900 px-3 py-2 text-white disabled:opacity-50">Run current scenario</button>
        </li>
        <li>
          <h3 className="font-semibold">Export your exercise</h3>
          <p className="mt-1 text-gray-600">Open the Part-IS Dossier to print the exercise draft or download its inputs, results, and provenance as JSON.</p>
          <button type="button" onClick={() => navigate('easa-compliance')}
            className="mt-2 rounded-md border border-gray-300 px-3 py-2 hover:bg-gray-50">Open exercise dossier</button>
        </li>
      </ol>
      <button type="button" onClick={() => { dialog.current?.close(); onReset(); }}
        className="mt-6 rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50">Reset current scenario settings</button>
      <p className="mt-6 border-t border-gray-200 pt-4 text-xs text-gray-600">
        Editing settings keeps the previous run visible until you run again. Reloading restores settings and generates a new browser preview. Dollar estimates use your illustrative cost assumption.
      </p>
    </dialog>
  );
}
