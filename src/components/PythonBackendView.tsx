import { useEffect, useState } from 'react';
import { Check, Copy, Play } from 'lucide-react';
import { useCascadeStore } from '../store/useCascadeStore.ts';

const DEFAULT_FILES = [
  'main.py',
  'models.py',
  'graph_engine.py',
  'simpy_engine.py',
  'requirements.txt',
];

export function PythonBackendView() {
  const { simulationResult, executeSimulationOnServer, isSimulating } = useCascadeStore();
  const [sources, setSources] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>('simpy_engine.py');
  const [copied, setCopied] = useState(false);

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
    <div className="space-y-6">
      <section
        aria-label="Python FastAPI and SimPy Engine Overview"
        className="flex flex-col gap-4 rounded-md border border-slate-800 bg-[#111827] p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <div className="text-xs font-mono text-slate-400">
            BACKEND ARCHITECTURE · PYTHON 3.12+ · FASTAPI · PYDANTIC V2 · NETWORKX · SIMPY · NUMPY
          </div>
          <h2 className="mt-0.5 text-base font-bold text-slate-100">
            Discrete-Event Simulation &amp; Directed Dependency Graph Backend Modules
          </h2>
        </div>

        <button
          type="button"
          onClick={() => executeSimulationOnServer()}
          disabled={isSimulating}
          className="inline-flex items-center gap-2 rounded-md bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
        >
          <Play className="h-3.5 w-3.5" />
          <span>{isSimulating ? 'Running POST /api/simulate...' : 'Execute POST /api/simulate'}</span>
        </button>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left: Python Source Code Explorer (7 cols) */}
        <section
          aria-label="Python Backend Source Code"
          className="xl:col-span-7 rounded-md border border-slate-800 bg-[#111827] overflow-hidden flex flex-col"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-[#0F172A] px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {DEFAULT_FILES.map((file) => (
                <button
                  key={file}
                  type="button"
                  onClick={() => setSelectedFile(file)}
                  className={`rounded px-2.5 py-1 font-mono text-xs transition-colors whitespace-nowrap shrink-0 ${
                    selectedFile === file
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  backend/{file}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1 text-xs font-mono text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Module'}</span>
            </button>
          </div>

          <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto max-h-[600px] leading-relaxed bg-[#090D14]">
            <code>{currentCode}</code>
          </pre>
        </section>

        {/* Right: Live API Response Payload Inspector (5 cols) */}
        <section
          aria-label="Live Simulation API Response Payload"
          className="xl:col-span-5 rounded-md border border-slate-800 bg-[#111827] overflow-hidden flex flex-col"
        >
          <div className="border-b border-slate-800 bg-[#0F172A] px-4 py-3">
            <div className="text-xs font-mono text-cyan-400">
              LIVE REST API PAYLOAD · POST /api/simulate
            </div>
            <h3 className="mt-0.5 text-sm font-bold text-slate-100">
              Pydantic v2 / SimulationResponse JSON Artifact
            </h3>
          </div>

          <pre className="p-4 text-xs font-mono text-emerald-300/90 overflow-x-auto max-h-[600px] leading-relaxed bg-[#090D14]">
            <code>{JSON.stringify(simulationResult, null, 2)}</code>
          </pre>
        </section>
      </div>
    </div>
  );
}
