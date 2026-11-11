import { useEffect, useState } from 'react';
import { Check, Copy, Play, RotateCw } from 'lucide-react';
import { useCascadeStore } from '../store/useCascadeStore.ts';

const DEFAULT_FILES = [
  'main.py',
  'models.py',
  'graph_engine.py',
  'simpy_engine.py',
  'requirements.txt',
];

export function PythonBackendView() {
  const { simulationResult, executeSimulationOnServer, isSimulating, activeRunMode } = useCascadeStore();
  const [sources, setSources] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>('simpy_engine.py');
  const [copied, setCopied] = useState(false);

  const isDeterministicBusy = isSimulating && activeRunMode === 'deterministic';
  const isMonteCarloBusy = isSimulating && activeRunMode === 'monte-carlo';

  useEffect(() => {
    fetch('/api/backend-source')
      .then((res) => res.json())
      .then((data) => {
        if (data?.files) {
          setSources(data.files);
        }
      })
      .catch(() => {
        // Ignore network errors if offline
      });
  }, []);

  const currentCode =
    sources[selectedFile] ??
    `# Loading /backend/${selectedFile} from server...`;

  const handleCopy = () => {
    navigator.clipboard?.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-8">
      {/* Top Action Bar */}
      <section
        aria-label="Python FastAPI and SimPy Engine Overview"
        className="flex flex-col gap-4 rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-3 py-0.5 rounded-full border border-indigo-100 inline-block">
            BACKEND ARCHITECTURE · PYTHON 3.12+ · FASTAPI · PYDANTIC V2 · NETWORKX · SIMPY · NUMPY
          </div>
          <h2 className="mt-2 text-lg sm:text-xl font-bold text-gray-900 tracking-tight">
            Discrete-Event Simulation &amp; Directed Dependency Graph Backend Modules
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Monte Carlo stochastic replicate sampling &amp; authoritative causal propagation engine
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => executeSimulationOnServer()}
            disabled={isSimulating}
            className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-50 transition-all shadow-sm shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
          >
            {isDeterministicBusy ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            <span>{isDeterministicBusy ? 'Running POST /api/simulate...' : 'Execute Deterministic Run'}</span>
          </button>
          <button
            type="button"
            onClick={() => executeSimulationOnServer({ replicates: 30 })}
            disabled={isSimulating}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-50 transition-all shadow-sm shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          >
            {isMonteCarloBusy ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Play className="h-3.5 w-3.5 text-white" />
            )}
            <span>{isMonteCarloBusy ? 'Running (30 Reps)...' : 'Run Monte Carlo (30 Replicates)'}</span>
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
        {/* Left: Python Source Code Explorer (7 cols) */}
        <section
          aria-label="Python Backend Source Code"
          className="xl:col-span-7 rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden flex flex-col"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 bg-gray-50/70 px-6 py-3.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {DEFAULT_FILES.map((file) => (
                <button
                  key={file}
                  type="button"
                  onClick={() => setSelectedFile(file)}
                  className={`rounded-full px-3 py-1 font-mono text-xs transition-all whitespace-nowrap shrink-0 ${
                    selectedFile === file
                      ? 'bg-gray-900 text-white font-semibold shadow-xs'
                      : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/60'
                  }`}
                >
                  backend/{file}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-xs whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-gray-500" />}
              <span>{copied ? 'Copied' : 'Copy Module'}</span>
            </button>
          </div>

          <pre className="p-6 text-xs font-mono text-gray-800 overflow-x-auto max-h-[600px] leading-relaxed bg-gray-50/30">
            <code>{currentCode}</code>
          </pre>
        </section>

        {/* Right: Live API Response Payload Inspector (5 cols) */}
        <section
          aria-label="Live Simulation API Response Payload"
          className="xl:col-span-5 rounded-3xl border border-gray-100 bg-white shadow-sm overflow-hidden flex flex-col"
        >
          <div className="border-b border-gray-100 bg-gray-50/70 px-6 py-4">
            <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
              LIVE REST API PAYLOAD · POST /api/simulate
            </div>
            <h3 className="mt-0.5 text-sm font-bold text-gray-900">
              Pydantic v2 / SimulationResponse JSON Artifact
            </h3>
          </div>

          <pre className="p-6 text-xs font-mono text-emerald-800 overflow-x-auto max-h-[600px] leading-relaxed bg-emerald-50/20">
            <code>{JSON.stringify(simulationResult, null, 2)}</code>
          </pre>
        </section>
      </div>
    </div>
  );
}
