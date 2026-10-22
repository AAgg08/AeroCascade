import { useMemo } from 'react';
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
  } = useCascadeStore();

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

  return (
    <div className="space-y-6">
      {/* Scenario & Policy Allocation Toolbar */}
      <section
        aria-label="Scenario and Policy Configuration"
        className="rounded-md border border-slate-800 bg-[#111827] p-4"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-400">
              <span>AIAA AVIATION 2026 REFERENCE MODEL</span>
              <span aria-hidden="true">·</span>
              <span>{activeScenario.aerodrome_profile}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="scenario-select" className="sr-only">
                Select Aviation Cascade Scenario
              </label>
              <select
                id="scenario-select"
                value={activeScenarioId}
                onChange={(e) => selectScenario(e.target.value)}
                className="w-full sm:max-w-xl rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-2 text-sm font-semibold text-slate-100 focus:border-cyan-400 focus:outline-none"
              >
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed max-w-4xl pt-1">
              {activeScenario.abstract}
            </p>
          </div>

          {/* Policy Regime Quick Presets */}
          <div className="flex flex-col gap-2 shrink-0">
            <span className="text-[11px] font-mono text-slate-400">
              DHILLON &amp; MOORES (2001) POLICY ALLOCATION PRESETS
            </span>
            <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-800 bg-[#0B0F17] p-1">
              <button
                type="button"
                onClick={() => applyGlobalPreset('baseline')}
                className="rounded px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap shrink-0"
              >
                Paper Baseline
              </button>
              <button
                type="button"
                onClick={() => applyGlobalPreset('technical-heavy')}
                className="rounded px-2.5 py-1.5 text-xs font-medium text-amber-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Technical-Only Bias
              </button>
              <button
                type="button"
                onClick={() => applyGlobalPreset('tripartite-balanced')}
                className="rounded px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Tripartite Balanced
              </button>
              <button
                type="button"
                onClick={() => applyGlobalPreset('unmitigated-stress')}
                className="rounded px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                Unmitigated Stress
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Main Split Console: Left/Center Dagre ReactFlow Canvas + Right Node Tripartite Inspector */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12 items-stretch">
        {/* Left/Center: 3-Stage Directed Cascade Topology Canvas (8 cols on XL) */}
        <div className="xl:col-span-8 flex flex-col rounded-md border border-slate-800 bg-[#111827] overflow-hidden">
          {/* Stage Column Headers */}
          <div className="grid grid-cols-3 border-b border-slate-800 bg-[#0F172A] px-4 py-2.5 text-xs font-mono">
            <div className="text-cyan-400 font-semibold truncate">
              ● STAGE 1: CYBER/TECHNICAL TRIGGER
            </div>
            <div className="text-amber-400 font-semibold truncate">
              ▲ STAGE 2: FRAGILITY PROPAGATION
            </div>
            <div className="text-rose-400 font-semibold truncate">
              ✖ STAGE 3: RECOVERY BLOCKER (FORMAL/INFORMAL)
            </div>
          </div>

          {/* Node Quick-Selector Strip for keyboard & screen-reader accessibility */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-800/80 bg-[#0B0F17]/60 px-4 py-2">
            <span className="text-[11px] font-mono text-slate-400 mr-1">SELECT NODE:</span>
            {nodes.map((n) => {
              const active = n.id === selectedNode?.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => selectNode(n.id)}
                  className={`rounded px-2 py-1 text-[11px] font-mono transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/50 font-semibold'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {n.code}
                </button>
              );
            })}
          </div>

          {/* React Flow v12 Canvas */}
          <div className="relative h-[640px] w-full bg-[#090D14]" data-testid="cascade-flow-canvas">
            <ReactFlow<CascadeFlowNodeData>
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
                gap={20}
                size={1}
                color="#1E293B"
              />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          {/* Canvas Footer Telemetry */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 bg-[#0F172A] px-4 py-2.5 text-xs font-mono text-slate-400">
            <div>
              DAGRE L-TO-R TOPOLOGY <span aria-hidden="true">·</span> {nodes.length} NODES{' '}
              <span aria-hidden="true">·</span> {edges.length} DIRECTED EDGES
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <span>BASELINE MVMT/HR:</span>
                <input
                  type="number"
                  min={12}
                  max={120}
                  value={baselineMovementsPerHour}
                  onChange={(e) => setBaselineMovements(Number(e.target.value))}
                  aria-label="Baseline airport movements per hour"
                  className="w-16 rounded border border-slate-700 bg-[#0B0F17] px-2 py-0.5 text-right text-slate-100"
                />
              </label>
              <label className="flex items-center gap-2">
                <span>TRIGGER HOUR:</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={triggerHour}
                  onChange={(e) => setTriggerHour(Number(e.target.value))}
                  aria-label="Simulation trigger hour"
                  className="w-14 rounded border border-slate-700 bg-[#0B0F17] px-2 py-0.5 text-right text-slate-100"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Dhillon & Moores (2001) Tripartite Control & FMEA Inspector (4 cols on XL) */}
        <aside
          aria-label="Selected Node Tripartite Control and FMEA Inspector"
          className="xl:col-span-4 flex flex-col justify-between rounded-md border border-slate-800 bg-[#111827] p-5"
        >
          {selectedNode ? (
            <div className="space-y-5">
              {/* Node Header */}
              <div className="border-b border-slate-800 pb-3.5">
                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span>
                    {selectedNode.code} <span aria-hidden="true">·</span>{' '}
                    {selectedNode.stage === CascadeStage.STAGE_1_TRIGGER
                      ? 'STAGE 1 TRIGGER'
                      : selectedNode.stage === CascadeStage.STAGE_2_PROPAGATION
                        ? 'STAGE 2 PROPAGATION'
                        : 'STAGE 3 RECOVERY BLOCKER'}
                  </span>
                  <span className="text-cyan-300">
                    PSOE: {evaluateNodePSOE(selectedNode)}
                  </span>
                </div>
                <h2 className="mt-1 text-base font-bold text-slate-100 leading-snug">
                  {selectedNode.label}
                </h2>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  {selectedNode.description}
                </p>
              </div>

              {/* Live RPN & Centrality Readout Grid */}
              <div className="grid grid-cols-3 gap-2.5 rounded-md border border-slate-800 bg-[#0B0F17] p-3 font-mono tabular-nums">
                <div>
                  <div className="text-[10px] text-slate-400">RAW FMEA RPN</div>
                  <div className="mt-0.5 text-xl font-bold text-slate-200">
                    {calculateRawRPN(selectedNode.fmea)}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    {selectedNode.fmea.likelihood}×{selectedNode.fmea.impact}×
                    {selectedNode.fmea.recovery_complexity}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">RESIDUAL RPN</div>
                  <div
                    className={`mt-0.5 text-xl font-bold ${
                      computeResidualRPN(selectedNode) >= 55
                        ? 'text-rose-400'
                        : computeResidualRPN(selectedNode) >= 35
                          ? 'text-amber-300'
                          : 'text-emerald-400'
                    }`}
                    data-testid="inspector-residual-rpn"
                  >
                    {computeResidualRPN(selectedNode).toFixed(1)}
                  </div>
                  <div className="text-[10px] text-slate-500">Post-Tripartite</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">CHOKEPOINT</div>
                  <div className="mt-0.5 text-xl font-bold text-cyan-300">
                    {selectedCentrality ? selectedCentrality.chokepoint_index.toFixed(1) : '0.0'}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    BC: {selectedCentrality ? selectedCentrality.betweenness_centrality.toFixed(2) : '0'}
                  </div>
                </div>
              </div>

              {/* Dhillon & Moores (2001) Tripartite Controls Sliders */}
              <div className="space-y-3.5 border-t border-slate-800 pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold tracking-wide text-slate-200">
                    Dhillon &amp; Moores (2001) Tripartite Controls
                  </h3>
                  <span className="text-[11px] font-mono text-slate-400">
                    Dominant: {selectedNode.dominant_control}
                  </span>
                </div>

                {/* Technical Controls Slider */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="slider-technical" className="text-slate-300 font-medium">
                      Technical Controls (Hardware / Crypto / IDS)
                    </label>
                    <span className="font-mono tabular-nums text-cyan-300 font-semibold">
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
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                </div>

                {/* Formal Controls Slider */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="slider-formal" className="text-slate-300 font-medium">
                      Formal Controls (Part-IS SOPs / LVP Rules / SLAs)
                    </label>
                    <span className="font-mono tabular-nums text-amber-300 font-semibold">
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
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                </div>

                {/* Informal Controls Slider */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="slider-informal" className="text-slate-300 font-medium">
                      Informal Controls (ATCO Trust / Culture / Norms)
                    </label>
                    <span className="font-mono tabular-nums text-emerald-300 font-semibold">
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
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* FMEA Parameter Calibration (Likelihood, Impact, Recovery Complexity, Policy Investment) */}
              <div className="space-y-3 border-t border-slate-800 pt-4">
                <h3 className="text-xs font-semibold tracking-wide text-slate-200">
                  FMEA Quantification &amp; Policy Investment
                </h3>

                <div className="grid grid-cols-3 gap-2.5 font-mono text-xs">
                  <div>
                    <label htmlFor="fmea-likelihood" className="block text-[10px] text-slate-400 mb-1">
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
                      className="w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="fmea-impact" className="block text-[10px] text-slate-400 mb-1">
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
                      className="w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
                    />
                  </div>
                  <div>
                    <label htmlFor="fmea-recovery" className="block text-[10px] text-slate-400 mb-1">
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
                      className="w-full rounded border border-slate-700 bg-[#0B0F17] px-2.5 py-1.5 text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <label htmlFor="slider-investment" className="text-slate-300 font-medium">
                      Policy &amp; Capital Investment Allocation (0–100)
                    </label>
                    <span className="font-mono tabular-nums text-slate-200 font-semibold">
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
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>
              </div>

              {/* Failure Mode & Mitigation Box */}
              <div className="rounded-md border border-slate-800 bg-[#0B0F17] p-3 text-xs space-y-2">
                <div>
                  <span className="font-mono text-[10px] text-rose-400 font-semibold">
                    FAILURE MODE ({selectedNode.er040_severity}):
                  </span>
                  <p className="text-slate-300 mt-0.5 leading-relaxed">
                    {selectedNode.failure_mode}
                  </p>
                </div>
                <div className="border-t border-slate-800/80 pt-2">
                  <span className="font-mono text-[10px] text-emerald-400 font-semibold">
                    RECOMMENDED TRIPARTITE COUNTERMEASURE:
                  </span>
                  <p className="text-slate-300 mt-0.5 leading-relaxed">
                    {selectedNode.mitigation_recommendation}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      {/* Bottom Telemetry Tray: SimPy Discrete-Event Simulation (DES) Cascade Log */}
      <section
        aria-label="Discrete-Event Simulation Timeline"
        className="rounded-md border border-slate-800 bg-[#111827] overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 bg-[#0F172A] px-5 py-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Discrete-Event Simulation (DES) Cascade Propagation Log
            </h3>
            <p className="text-xs text-slate-400">
              Chronological event trace mapping Stage 1 (Trigger) → Stage 2 (Operational Fragility Propagation) → Stage 3 (Recovery Blocker)
            </p>
          </div>
          <div className="text-xs font-mono text-slate-400 tabular-nums">
            RECOVERY WINDOW: <span className="text-amber-300 font-semibold">{simulationResult.summary_kpis.recovery_window_hours} HRS</span>
            <span aria-hidden="true"> · </span>
            DISRUPTED MOVEMENTS: <span className="text-rose-400 font-semibold">{simulationResult.summary_kpis.total_disrupted_movements} FLIGHTS</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0B0F17] font-mono text-[11px] text-slate-400">
                <th className="py-2.5 px-4">SIM TIME</th>
                <th className="py-2.5 px-4">CASCADE STAGE</th>
                <th className="py-2.5 px-4">NODE CODE</th>
                <th className="py-2.5 px-4">SUBSYSTEM / NODE</th>
                <th className="py-2.5 px-4">DOMINANT CONTROL</th>
                <th className="py-2.5 px-4">EVENT NARRATIVE</th>
                <th className="py-2.5 px-4 text-right">CAPACITY DROP</th>
                <th className="py-2.5 px-4 text-right">RESIDUAL RPN</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {simulationResult.events.map((evt) => {
                const isSelected = evt.node_id === selectedNodeId;
                const stageMeta =
                  evt.stage === CascadeStage.STAGE_1_TRIGGER
                    ? { label: '● Stage 1 · Trigger', cls: 'text-cyan-400' }
                    : evt.stage === CascadeStage.STAGE_2_PROPAGATION
                      ? { label: '▲ Stage 2 · Propagation', cls: 'text-amber-400' }
                      : { label: '✖ Stage 3 · Blocker', cls: 'text-rose-400' };

                return (
                  <tr
                    key={evt.event_id}
                    onClick={() => selectNode(evt.node_id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-cyan-950/30' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-200 whitespace-nowrap">
                      {evt.formatted_time}
                    </td>
                    <td className={`py-2.5 px-4 font-mono font-semibold whitespace-nowrap ${stageMeta.cls}`}>
                      {stageMeta.label}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap">
                      {evt.node_code}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-100">
                      {evt.node_label}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-300 whitespace-nowrap">
                      {evt.dominant_control}
                    </td>
                    <td className="py-2.5 px-4 text-slate-300 max-w-md">
                      {evt.narrative}
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right text-amber-300 whitespace-nowrap">
                      -{evt.capacity_impact_pct.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-4 font-mono tabular-nums text-right font-semibold text-slate-100 whitespace-nowrap">
                      {evt.residual_rpn.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
