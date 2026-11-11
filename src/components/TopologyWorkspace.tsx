import { WorkspaceTransfer } from './WorkspaceTransfer.tsx';
import { TopologyRepositoryModal } from './TopologyRepositoryModal.tsx';
import { useMemo } from 'react';
import { Download, GitBranch } from 'lucide-react';
import {
  Background,
  BackgroundVariant,
  Controls,
  type NodeMouseHandler,
  ReactFlow,
} from '@xyflow/react';
import {
  calculateRawRPN,
  computeResidualRPN,
  evaluateNodePSOE,
} from '../domain/simulationEngine.ts';
import { CascadeStage, type NodeCentralityMetric } from '../domain/types.ts';
import { useCascadeStore } from '../store/useCascadeStore.ts';
import { buildDagreCascadeLayout, type CascadeFlowNodeData } from '../utils/dagreLayout.ts';
import { CascadeCustomNode } from './CascadeCustomNode.tsx';

const nodeTypes = {
  cascadeNode: CascadeCustomNode,
};

export function TopologyWorkspace() {
  const {
    scenarios,
    activeScenarioId,
    selectScenario,
    nodes,
    edges,
    selectedNodeId,
    selectNode,
    updateNodeTripartite,
    updateNodeFMEA,
    applyGlobalPreset,
    simulationResult,
    baselineMovementsPerHour,
    triggerHour,
    setBaselineMovements,
    setTriggerHour,
    executeSimulationOnServer,
    isSimulating,
    activeRunMode,
    costPerDelayedMovement,
    setCostPerDelayedMovement,
    setTopologyModalOpen,
    currentTopologyVersion,
  } = useCascadeStore();

  const isDeterministicBusy = isSimulating && activeRunMode === 'deterministic';
  const isMonteCarloBusy = isSimulating && activeRunMode === 'monte-carlo';

  const activeScenario = useMemo(
    () => scenarios.find((s) => s.id === activeScenarioId) ?? scenarios[0],
    [scenarios, activeScenarioId]
  );

  const centralityMap = useMemo(() => {
    const map: Record<string, NodeCentralityMetric> = {};
    for (const item of simulationResult.node_analytics) {
      map[item.node_id] = item;
    }
    return map;
  }, [simulationResult.node_analytics]);

  const { flowNodes, flowEdges } = useMemo(
    () => buildDagreCascadeLayout(nodes, edges, centralityMap, selectedNodeId),
    [nodes, edges, centralityMap, selectedNodeId]
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? nodes[0],
    [nodes, selectedNodeId]
  );

  const selectedCentrality = selectedNode ? centralityMap[selectedNode.id] : undefined;

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    selectNode(node.id);
  };

  const handleExportTraceCSV = () => {
    const headers = [
      'Timestamp (Hours)',
      'Sim Time',
      'Cascade Stage',
      'Node Code',
      'Subsystem Name',
      'Dominant Control',
      'Event Type',
      'Description',
      'Capacity Impact (%)',
      'Residual RPN',
    ];

    const rows = simulationResult.events.map((evt) => [
      evt.timestamp_hours.toFixed(2),
      `"${evt.formatted_time}"`,
      `"${evt.stage}"`,
      `"${evt.node_code}"`,
      `"${evt.node_label.replace(/"/g, '""')}"`,
      `"${evt.dominant_control}"`,
      `"${(evt.event_type || '').replace(/"/g, '""')}"`,
      `"${(evt.narrative || '').replace(/"/g, '""')}"`,
      (-evt.capacity_impact_pct).toFixed(1),
      evt.residual_rpn.toFixed(1),
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `aerocascade-event-trace-${activeScenarioId}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      {/* Scenario & Policy Allocation Card */}
      <section
        aria-label="Scenario and Policy Configuration"
        className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 px-3 py-1 text-xs font-semibold">
                AIAA 2026 Reference Model
              </span>
              <span className="text-gray-300">·</span>
              <span className="text-xs font-semibold text-gray-500">{activeScenario.aerodrome_profile}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="scenario-select" className="sr-only">
                Select Aviation Cascade Scenario
              </label>
              <select
                id="scenario-select"
                value={activeScenarioId}
                onChange={(e) => selectScenario(e.target.value)}
                className="w-full sm:max-w-xl rounded-full border border-gray-200 bg-gray-50/80 px-4 py-2.5 text-sm font-semibold text-gray-800 shadow-inner focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed max-w-4xl">
              {activeScenario.abstract}
            </p>
          </div>

          {/* Policy Allocation Presets */}
          <div className="flex flex-col gap-2 shrink-0">
            <span className="text-xs font-semibold text-gray-500">
              Dhillon &amp; Moores (2001) Policy Presets
            </span>
            <div className="flex flex-wrap items-center gap-1.5 rounded-full bg-gray-100/90 p-1.5 border border-gray-200/60 shadow-inner">
              <button
                type="button"
                onClick={() => applyGlobalPreset('baseline')}
                className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white hover:text-gray-900 hover:shadow-xs transition-all whitespace-nowrap shrink-0"
              >
                Scenario Baseline
              </button>
              <button
                type="button"
                onClick={() => applyGlobalPreset('technical-heavy')}
                className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-white hover:shadow-xs transition-all whitespace-nowrap shrink-0"
              >
                Technical-Only Bias
              </button>
              <button
                type="button"
                onClick={() => applyGlobalPreset('tripartite-balanced')}
                className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-white hover:shadow-xs transition-all whitespace-nowrap shrink-0"
              >
                Tripartite Balanced
              </button>
              <button
                type="button"
                onClick={() => applyGlobalPreset('unmitigated-stress')}
                className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-white hover:shadow-xs transition-all whitespace-nowrap shrink-0"
              >
                Unmitigated Stress
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTopologyModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50/70 px-3.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>Repository Versions ({currentTopologyVersion ? `v${currentTopologyVersion}` : 'v1'})</span>
          </button>
          <WorkspaceTransfer />
        </div>
      </section>

      {/* Main Split Console: Left/Center ReactFlow Canvas + Right Node Tripartite Inspector */}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-12 items-stretch">
        {/* Left/Center: 3-Stage Directed Cascade Topology Canvas (8 cols on XL) */}
        <div className="xl:col-span-8 flex flex-col rounded-3xl border border-gray-100 bg-white p-6 shadow-sm overflow-hidden">
          {/* Stage Column Headers (Pill format) */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-4">
            <span className="rounded-full bg-rose-50 text-rose-700 border border-rose-100 px-3 py-1 font-semibold text-xs">
              ● Stage 1: Cyber/Technical Trigger
            </span>
            <span className="rounded-full bg-amber-50 text-amber-700 border border-amber-100 px-3 py-1 font-semibold text-xs">
              ▲ Stage 2: Fragility Propagation
            </span>
            <span className="rounded-full bg-purple-50 text-purple-700 border border-purple-100 px-3 py-1 font-semibold text-xs">
              ✖ Stage 3: Recovery Blocker (Formal/Informal)
            </span>
          </div>

          {/* Node Quick-Selector Strip */}
          <div className="flex flex-wrap items-center gap-1.5 py-3 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-400 mr-1">Select Node:</span>
            {nodes.map((n) => {
              const active = n.id === selectedNode?.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => selectNode(n.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-all whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-gray-900 text-white shadow-xs font-semibold'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {n.code}
                </button>
              );
            })}
          </div>

          {/* React Flow Canvas - Clean light background with soft dots */}
          <div className="relative h-[440px] sm:h-[540px] xl:h-[640px] w-full bg-gray-50/60 rounded-2xl border border-gray-100/80 overflow-hidden my-4" data-testid="cascade-flow-canvas">
            <ReactFlow
              key={activeScenarioId}
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodeClick={handleNodeClick}
              fitView
              fitViewOptions={{ padding: 0.08 }}
              minZoom={0.35}
              maxZoom={1.6}
              proOptions={{ hideAttribution: false }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={24}
                size={1}
                color="#CBD5E1"
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          {/* Canvas Footer Telemetry */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 text-xs font-medium text-gray-500">
            <div>
              Dagre L-to-R Layout <span aria-hidden="true">·</span> {nodes.length} Nodes{' '}
              <span aria-hidden="true">·</span> {edges.length} Directed Edges
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <span>Baseline Mvmt/hr:</span>
                <input
                  type="number"
                  min={12}
                  max={120}
                  value={baselineMovementsPerHour}
                  onChange={(e) => setBaselineMovements(Number(e.target.value))}
                  aria-label="Baseline airport movements per hour"
                  className="w-16 rounded-full border border-gray-200 bg-white px-3 py-1 text-right text-gray-900 shadow-xs focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>
              <label className="flex items-center gap-2">
                <span>Trigger Hour:</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={triggerHour}
                  onChange={(e) => setTriggerHour(Number(e.target.value))}
                  aria-label="Simulation trigger hour"
                  className="w-14 rounded-full border border-gray-200 bg-white px-3 py-1 text-right text-gray-900 shadow-xs focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>
              <label className="flex items-center gap-2">
                <span>Cost/Mvmt ($):</span>
                <input
                  type="number"
                  min={0}
                  step={500}
                  value={costPerDelayedMovement}
                  onChange={(e) => setCostPerDelayedMovement(Number(e.target.value))}
                  aria-label="Disruption cost multiplier per movement"
                  className="w-20 rounded-full border border-gray-200 bg-white px-3 py-1 text-right text-gray-900 shadow-xs focus:ring-2 focus:ring-emerald-500/20"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Dhillon & Moores (2001) Tripartite Control & FMEA Inspector (4 cols on XL) */}
        <aside
          aria-label="Selected Node Tripartite Control and FMEA Inspector"
          className="xl:col-span-4 flex flex-col justify-between rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm"
        >
          {selectedNode ? (
            <div className="space-y-6">
              {/* Node Header */}
              <div className="border-b border-gray-100 pb-4">
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs font-bold text-gray-700">
                    {selectedNode.code} ·{' '}
                    {selectedNode.stage === CascadeStage.STAGE_1_TRIGGER
                      ? 'Stage 1 Trigger'
                      : selectedNode.stage === CascadeStage.STAGE_2_PROPAGATION
                        ? 'Stage 2 Propagation'
                        : 'Stage 3 Blocker'}
                  </span>
                  <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-0.5 text-xs font-bold">
                    PSOE: {evaluateNodePSOE(selectedNode)}
                  </span>
                </div>
                <h2 className="mt-2.5 text-lg font-bold text-gray-900 leading-snug">
                  {selectedNode.label}
                </h2>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  {selectedNode.description}
                </p>
              </div>

              {/* Live RPN & Centrality Readout Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl bg-gray-50/80 p-3.5 border border-gray-100 text-center">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Raw RPN</div>
                  <div className="mt-1 text-2xl font-extrabold text-gray-800">
                    {calculateRawRPN(selectedNode.fmea)}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {selectedNode.fmea.likelihood}×{selectedNode.fmea.impact}×{selectedNode.fmea.recovery_complexity}
                  </div>
                </div>
                <div className="rounded-2xl bg-gray-50/80 p-3.5 border border-gray-100 text-center">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Residual RPN</div>
                  <div
                    className={`mt-1 text-2xl font-extrabold ${
                      computeResidualRPN(selectedNode) >= 55
                        ? 'text-rose-600'
                        : computeResidualRPN(selectedNode) >= 35
                          ? 'text-amber-600'
                          : 'text-emerald-600'
                    }`}
                    data-testid="inspector-residual-rpn"
                  >
                    {computeResidualRPN(selectedNode).toFixed(1)}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">Mitigated</div>
                </div>
                <div className="rounded-2xl bg-gray-50/80 p-3.5 border border-gray-100 text-center">
                  <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Chokepoint</div>
                  <div className="mt-1 text-2xl font-extrabold text-gray-900">
                    {selectedCentrality ? selectedCentrality.chokepoint_index.toFixed(1) : '0.0'}
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    BC: {selectedCentrality ? selectedCentrality.betweenness_centrality.toFixed(2) : '0'}
                  </div>
                </div>
              </div>

              {/* Dhillon & Moores (2001) Tripartite Controls Sliders */}
              <div className="space-y-4 border-t border-gray-100 pt-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-gray-800">
                    Dhillon &amp; Moores (2001) Tripartite Controls
                  </h3>
                  <span className="text-[11px] font-semibold text-gray-500">
                    Dominant: {selectedNode.dominant_control}
                  </span>
                </div>

                {/* Technical Controls Slider */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5 font-medium">
                    <label htmlFor="slider-technical" className="text-gray-700">
                      Technical (Hardware / Crypto / IDS)
                    </label>
                    <span className="font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-full border border-teal-100">
                      {selectedNode.tripartite.technical.toFixed(0)}%
                    </span>
                  </div>
                  <input
                    id="slider-technical"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={selectedNode.tripartite.technical}
                    onChange={(e) =>
                      updateNodeTripartite(selectedNode.id, {
                        technical: Number(e.target.value),
                      })
                    }
                    className="w-full accent-teal-500 cursor-pointer"
                  />
                </div>

                {/* Formal Controls Slider */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5 font-medium">
                    <label htmlFor="slider-formal" className="text-gray-700">
                      Formal (Part-IS SOPs / SLAs / LVP)
                    </label>
                    <span className="font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">
                      {selectedNode.tripartite.formal.toFixed(0)}%
                    </span>
                  </div>
                  <input
                    id="slider-formal"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={selectedNode.tripartite.formal}
                    onChange={(e) =>
                      updateNodeTripartite(selectedNode.id, {
                        formal: Number(e.target.value),
                      })
                    }
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                {/* Informal Controls Slider */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5 font-medium">
                    <label htmlFor="slider-informal" className="text-gray-700">
                      Informal (ATCO Trust / Culture)
                    </label>
                    <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                      {selectedNode.tripartite.informal.toFixed(0)}%
                    </span>
                  </div>
                  <input
                    id="slider-informal"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={selectedNode.tripartite.informal}
                    onChange={(e) =>
                      updateNodeTripartite(selectedNode.id, {
                        informal: Number(e.target.value),
                      })
                    }
                    className="w-full accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* FMEA Parameter Calibration */}
              <div className="space-y-4 border-t border-gray-100 pt-5">
                <h3 className="text-xs font-bold text-gray-800">
                  FMEA Calibration &amp; Policy Investment
                </h3>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div>
                    <label htmlFor="fmea-likelihood" className="block text-[10px] font-semibold text-gray-500 mb-1">
                      LIKELIHOOD (1-5)
                    </label>
                    <input
                      id="fmea-likelihood"
                      type="number"
                      min={1}
                      max={5}
                      value={selectedNode.fmea.likelihood}
                      onChange={(e) =>
                        updateNodeFMEA(selectedNode.id, {
                          likelihood: Math.min(5, Math.max(1, Number(e.target.value))),
                        })
                      }
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-1.5 text-gray-900 font-semibold focus:bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="fmea-impact" className="block text-[10px] font-semibold text-gray-500 mb-1">
                      IMPACT (1-5)
                    </label>
                    <input
                      id="fmea-impact"
                      type="number"
                      min={1}
                      max={5}
                      value={selectedNode.fmea.impact}
                      onChange={(e) =>
                        updateNodeFMEA(selectedNode.id, {
                          impact: Math.min(5, Math.max(1, Number(e.target.value))),
                        })
                      }
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-1.5 text-gray-900 font-semibold focus:bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="fmea-recovery" className="block text-[10px] font-semibold text-gray-500 mb-1">
                      RECOVERY (1-5)
                    </label>
                    <input
                      id="fmea-recovery"
                      type="number"
                      min={1}
                      max={5}
                      value={selectedNode.fmea.recovery_complexity}
                      onChange={(e) =>
                        updateNodeFMEA(selectedNode.id, {
                          recovery_complexity: Math.min(5, Math.max(1, Number(e.target.value))),
                        })
                      }
                      className="w-full rounded-xl border border-gray-200 bg-gray-50/80 px-3 py-1.5 text-gray-900 font-semibold focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1.5 font-medium">
                    <label htmlFor="slider-investment" className="text-gray-700">
                      Policy &amp; Capital Investment (0–100)
                    </label>
                    <span className="font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded-full">
                      {selectedNode.fmea.policy_investment.toFixed(0)} / 100
                    </span>
                  </div>
                  <input
                    id="slider-investment"
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={selectedNode.fmea.policy_investment}
                    onChange={(e) =>
                      updateNodeFMEA(selectedNode.id, {
                        policy_investment: Number(e.target.value),
                      })
                    }
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Failure Mode & Countermeasure Box */}
              <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-4 text-xs space-y-2.5">
                <div>
                  <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wide">
                    Failure Mode ({selectedNode.er040_severity}):
                  </span>
                  <p className="text-gray-700 mt-1 leading-relaxed">
                    {selectedNode.failure_mode}
                  </p>
                </div>
                <div className="border-t border-gray-200/60 pt-2.5">
                  <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wide">
                    Recommended Countermeasure:
                  </span>
                  <p className="text-gray-700 mt-1 leading-relaxed">
                    {selectedNode.mitigation_recommendation}
                  </p>
                </div>
              </div>

              {/* Simulation Dispatch Trigger (Pill Shaped) */}
              <div className="border-t border-gray-100 pt-4 flex flex-col gap-2.5">
                <button
                  type="button"
                  data-testid="inspector-simulate-btn"
                  onClick={() => executeSimulationOnServer()}
                  disabled={isSimulating}
                  className="inline-flex items-center justify-center gap-2 w-full rounded-full bg-gray-900 py-3 text-xs font-semibold text-white hover:bg-black disabled:opacity-60 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
                >
                  {isDeterministicBusy && (
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )}
                  <span>{isDeterministicBusy ? 'Simulating...' : 'Simulate'}</span>
                </button>
                <button
                  type="button"
                  data-testid="inspector-monte-carlo-btn"
                  onClick={() => executeSimulationOnServer({ replicates: 30 })}
                  disabled={isSimulating}
                  className="inline-flex items-center justify-center gap-2 w-full rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 py-3 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-60 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                >
                  {isMonteCarloBusy && (
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  )}
                  <span>{isMonteCarloBusy ? 'Simulating (30 Reps)...' : 'Run Monte Carlo (30 Replicates)'}</span>
                </button>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Bottom Telemetry Card: Discrete-Event Simulation (DES) Cascade Log */}
      <section
        aria-label="Discrete-Event Simulation Timeline"
        className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-gray-100">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-base font-bold text-gray-900">
                Discrete-Event Simulation (DES) Propagation Log
              </h3>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600">
                {simulationResult.provenance?.engine_label ?? 'Client TypeScript Engine'}
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Chronological event trace mapping Stage 1 (Trigger) → Stage 2 (Operational Fragility) → Stage 3 (Recovery Blocker)
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs font-semibold text-gray-600">
              Recovery Window: <span className="text-amber-600 font-bold">{simulationResult.summary_kpis.recovery_window_hours} hrs</span>
              <span aria-hidden="true" className="mx-2 text-gray-300">·</span>
              Modeled Lost Capacity: <span className="text-rose-600 font-bold">{simulationResult.summary_kpis.total_disrupted_movements} mvmt</span>
            </div>
            <button
              type="button"
              data-testid="export-event-trace-btn"
              onClick={handleExportTraceCSV}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3.5 py-1.5 text-xs font-semibold text-gray-700 hover:bg-white hover:text-gray-900 hover:border-gray-300 hover:shadow-xs transition-all shrink-0 cursor-pointer"
              title="Download Discrete-Event Simulation Propagation Log as CSV"
            >
              <Download className="h-3.5 w-3.5 text-gray-500" />
              <span>Export Event Trace (.csv)</span>
            </button>
          </div>
        </div>

        <div className="max-h-[440px] overflow-y-auto overflow-x-auto pt-3 rounded-2xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="sticky top-0 bg-white/95 backdrop-blur-xs z-10 border-b border-gray-100 shadow-2xs">
              <tr className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-4">Sim Time</th>
                <th className="py-3 px-4">Cascade Stage</th>
                <th className="py-3 px-4">Node Code</th>
                <th className="py-3 px-4">Subsystem / Node</th>
                <th className="py-3 px-4">Dominant Control</th>
                <th className="py-3 px-4 min-w-[260px] max-w-sm">Description</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Mitigation Impact</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Residual RPN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {simulationResult.events.map((evt) => {
                const isSelected = evt.node_id === selectedNodeId;
                const stageMeta =
                  evt.stage === CascadeStage.STAGE_1_TRIGGER
                    ? { label: '● Stage 1 · Trigger', cls: 'text-rose-600 bg-rose-50 border-rose-100' }
                    : evt.stage === CascadeStage.STAGE_2_PROPAGATION
                      ? { label: '▲ Stage 2 · Propagation', cls: 'text-amber-600 bg-amber-50 border-amber-100' }
                      : { label: '✖ Stage 3 · Blocker', cls: 'text-purple-600 bg-purple-50 border-purple-100' };

                return (
                  <tr
                    key={evt.event_id}
                    onClick={() => selectNode(evt.node_id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-emerald-50/60' : 'hover:bg-gray-50/80'
                    }`}
                  >
                    <td className="py-3.5 px-4 font-semibold text-gray-800 whitespace-nowrap">
                      {evt.formatted_time}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${stageMeta.cls}`}>
                        {stageMeta.label}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-bold text-gray-700 whitespace-nowrap">
                      {evt.node_code}
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-gray-900">
                      {evt.node_label}
                    </td>
                    <td className="py-3.5 px-4 text-gray-600 whitespace-nowrap font-medium">
                      {evt.dominant_control}
                    </td>
                    <td className="py-3.5 px-4 text-gray-600 max-w-sm break-words leading-relaxed">
                      {evt.narrative}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <span className="font-bold text-rose-600">-{evt.capacity_impact_pct.toFixed(1)}%</span>
                      <div className="text-[10px] text-gray-400 font-medium">capacity drop</div>
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <span className="font-extrabold text-gray-900">{evt.residual_rpn.toFixed(1)}</span>
                      <div className="text-[10px] text-gray-400 font-medium">adjusted RPN</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <TopologyRepositoryModal />
    </div>
  );
}
