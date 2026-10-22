import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  calculateRawRPN,
  computeResidualRPN,
  evaluateNodePSOE,
} from '../domain/simulationEngine.ts';
import { CascadeStage, ControlCategory } from '../domain/types.ts';
import { useCascadeStore } from '../store/useCascadeStore.ts';

export function FMEACapacityAnalytics() {
  const {
    nodes,
    simulationResult,
    updateNodeFMEA,
    updateNodeTripartite,
    applyGlobalPreset,
    triggerHour,
  } = useCascadeStore();

  const [stageFilter, setStageFilter] = useState<'ALL' | CascadeStage>('ALL');
  const [controlFilter, setControlFilter] = useState<'ALL' | ControlCategory>('ALL');

  const fmeaChartData = useMemo(() => {
    return simulationResult.node_analytics.map((metric) => ({
      code: metric.node_code,
      label: metric.label,
      stage: metric.stage,
      raw_rpn: metric.raw_rpn,
      residual_rpn: metric.residual_rpn,
      policy_investment: metric.policy_investment,
      chokepoint_index: metric.chokepoint_index,
      efficiency_gap: metric.investment_efficiency_gap,
    }));
  }, [simulationResult.node_analytics]);

  const filteredNodes = useMemo(() => {
    return nodes.filter((n) => {
      if (stageFilter !== 'ALL' && n.stage !== stageFilter) return false;
      if (controlFilter !== 'ALL' && n.dominant_control !== controlFilter) return false;
      return true;
    });
  }, [nodes, stageFilter, controlFilter]);

  return (
    <div className="space-y-6">
      {/* Top Action & Preset Comparison Bar */}
      <section
        aria-label="FMEA and Capacity Curve Policy Controls"
        className="flex flex-col gap-4 rounded-md border border-slate-800 bg-[#111827] p-4 lg:flex-row lg:items-center lg:justify-between"
      >
        <div>
          <div className="text-xs font-mono text-slate-400">
            FMEA RPN QUANTIFICATION &amp; HOURLY AERODROME THROUGHPUT DEGRADATION
          </div>
          <h2 className="mt-0.5 text-base font-bold text-slate-100">
            Risk Priority Number (RPN = L × I × RC) vs. Policy Investment &amp; Recovery Trajectories
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-slate-800 bg-[#0B0F17] p-1">
          <button
            type="button"
            onClick={() => applyGlobalPreset('baseline')}
            className="rounded px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors whitespace-nowrap shrink-0"
          >
            Paper Baseline
          </button>
          <button
            type="button"
            onClick={() => applyGlobalPreset('technical-heavy')}
            className="rounded px-3 py-1.5 text-xs font-medium text-amber-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Technical-Only Bias
          </button>
          <button
            type="button"
            onClick={() => applyGlobalPreset('tripartite-balanced')}
            className="rounded px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Tripartite Balanced
          </button>
          <button
            type="button"
            onClick={() => applyGlobalPreset('unmitigated-stress')}
            className="rounded px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Unmitigated Stress
          </button>
        </div>
      </section>

      {/* Dual Charts Grid */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Chart 1: FMEA RPN vs. Policy Investment Bar Chart */}
        <section
          aria-label="FMEA RPN vs Policy Investment Chart"
          className="rounded-md border border-slate-800 bg-[#111827] p-5"
        >
          <div className="border-b border-slate-800 pb-3 mb-4">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>CHART 01 · FMEA RISK-INVESTMENT MISALIGNMENT</span>
              <span>SCALE: RPN (1–125) · POLICY (0–100)</span>
            </div>
            <h3 className="mt-1 text-sm font-bold text-slate-100">
              FMEA RPN (Raw &amp; Residual) vs. Policy Investment by System Node
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Reveals the Stage 3 governance gap: high Policy Investment in Stage 1 sensors contrasts with under-funded Stage 3 Formal/Informal recovery blockers.
            </p>
          </div>

          <div className="h-[340px] w-full" data-testid="chart-fmea-rpn">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={fmeaChartData}
                margin={{ top: 12, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="code"
                  stroke="#94A3B8"
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={44}
                  tick={{ fill: '#CBD5E1', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                />
                <YAxis
                  stroke="#94A3B8"
                  domain={[0, 130]}
                  tick={{ fill: '#94A3B8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#334155',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: '#F8FAFC',
                  }}
                />
                <Legend
                  wrapperStyle={{
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono, monospace',
                    paddingTop: '8px',
                  }}
                />
                <Bar
                  dataKey="raw_rpn"
                  name="Raw FMEA RPN (1-125)"
                  fill="#334155"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="residual_rpn"
                  name="Residual RPN (Post-Tripartite)"
                  fill="#F43F5E"
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="policy_investment"
                  name="Policy Investment (0-100)"
                  fill="#06B6D4"
                  radius={[3, 3, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="chokepoint_index"
                  name="Chokepoint Index"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  dot={{ r: 3, fill: '#F59E0B' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Chart 2: Hourly Airport Capacity Degradation Curves */}
        <section
          aria-label="Hourly Airport Capacity Degradation Curve"
          className="rounded-md border border-slate-800 bg-[#111827] p-5"
        >
          <div className="border-b border-slate-800 pb-3 mb-4">
            <div className="flex items-center justify-between text-xs font-mono text-slate-400">
              <span>CHART 02 · SIMPY 24-HOUR THROUGHPUT TRAJECTORY</span>
              <span>TRIGGER: T+0{triggerHour}:00Z</span>
            </div>
            <h3 className="mt-1 text-sm font-bold text-slate-100">
              Hourly Airport Movement Capacity Degradation &amp; Stage 3 Recovery Stall
            </h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Compares Unmitigated collapse, Technical-Only plateau (stalled by Stage 3 Formal/Informal deficits), and your active Tripartite configuration.
            </p>
          </div>

          <div className="h-[340px] w-full" data-testid="chart-capacity-degradation">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={simulationResult.hourly_capacity}
                margin={{ top: 12, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke="#1E293B" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="time_label"
                  stroke="#94A3B8"
                  interval={2}
                  tick={{ fill: '#CBD5E1', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                />
                <YAxis
                  stroke="#94A3B8"
                  tick={{ fill: '#94A3B8', fontSize: 11, fontFamily: 'JetBrains Mono' }}
                  label={{
                    value: 'Movements / Hr',
                    angle: -90,
                    position: 'insideLeft',
                    fill: '#64748B',
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    borderColor: '#334155',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontFamily: 'JetBrains Mono, monospace',
                    color: '#F8FAFC',
                  }}
                />
                <Legend
                  wrapperStyle={{
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono, monospace',
                    paddingTop: '8px',
                  }}
                />
                <ReferenceLine
                  x={`${String(triggerHour).padStart(2, '0')}:00Z`}
                  stroke="#F43F5E"
                  strokeDasharray="4 4"
                  label={{
                    value: 'Stage 1 Trigger',
                    position: 'top',
                    fill: '#FDA4AF',
                    fontSize: 10,
                  }}
                />
                <Line
                  type="stepAfter"
                  dataKey="baseline_capacity"
                  name="Nominal Capacity"
                  stroke="#64748B"
                  strokeDasharray="5 5"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="tripartite_mitigated_capacity"
                  name="Active Tripartite Configuration"
                  fill="#10B981"
                  fillOpacity={0.16}
                  stroke="#10B981"
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="technical_only_capacity"
                  name="Technical-Only (Stage 3 Stall)"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="unmitigated_capacity"
                  name="Unmitigated Cascade"
                  stroke="#F43F5E"
                  strokeWidth={1.75}
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Interactive FMEA & Tripartite Matrix Table */}
      <section
        aria-label="Interactive FMEA Risk Register"
        className="rounded-md border border-slate-800 bg-[#111827] overflow-hidden"
      >
        <div className="flex flex-col gap-3 border-b border-slate-800 bg-[#0F172A] px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              Interactive FMEA Risk Register &amp; Dhillon-Moores Tripartite Calibration Matrix
            </h3>
            <p className="text-xs text-slate-400">
              Adjust Likelihood (1–5), Impact (1–5), Recovery Complexity (1–5), Policy Investment (0–100), or Tripartite Controls directly in the register.
            </p>
          </div>

          {/* Interactive Filter Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B0F17] p-1 text-xs">
              {(['ALL', CascadeStage.STAGE_1_TRIGGER, CascadeStage.STAGE_2_PROPAGATION, CascadeStage.STAGE_3_BLOCKER] as const).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStageFilter(st)}
                    className={`rounded px-2.5 py-1 font-mono text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                      stageFilter === st
                        ? 'bg-slate-800 text-cyan-300 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st === 'ALL'
                      ? 'All Stages'
                      : st === CascadeStage.STAGE_1_TRIGGER
                        ? 'Stage 1'
                        : st === CascadeStage.STAGE_2_PROPAGATION
                          ? 'Stage 2'
                          : 'Stage 3'}
                  </button>
                )
              )}
            </div>

            <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-[#0B0F17] p-1 text-xs">
              {(['ALL', ControlCategory.TECHNICAL, ControlCategory.FORMAL, ControlCategory.INFORMAL] as const).map(
                (ctrl) => (
                  <button
                    key={ctrl}
                    type="button"
                    onClick={() => setControlFilter(ctrl)}
                    className={`rounded px-2.5 py-1 font-mono text-[11px] transition-colors whitespace-nowrap shrink-0 ${
                      controlFilter === ctrl
                        ? 'bg-slate-800 text-amber-300 font-semibold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {ctrl === 'ALL' ? 'All Controls' : ctrl}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0B0F17] font-mono text-[11px] text-slate-400">
                <th className="py-2.5 px-3">NODE</th>
                <th className="py-2.5 px-3">STAGE &amp; DOMINANT</th>
                <th className="py-2.5 px-3 text-center">L (1-5)</th>
                <th className="py-2.5 px-3 text-center">I (1-5)</th>
                <th className="py-2.5 px-3 text-center">RC (1-5)</th>
                <th className="py-2.5 px-3 text-right">RAW RPN</th>
                <th className="py-2.5 px-3">TECHNICAL %</th>
                <th className="py-2.5 px-3">FORMAL %</th>
                <th className="py-2.5 px-3">INFORMAL %</th>
                <th className="py-2.5 px-3">POLICY INV.</th>
                <th className="py-2.5 px-3 text-right">RESIDUAL RPN</th>
                <th className="py-2.5 px-3 text-right">PSOE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {filteredNodes.map((node) => {
                const rawRpn = calculateRawRPN(node.fmea);
                const resRpn = computeResidualRPN(node);
                const psoe = evaluateNodePSOE(node);

                return (
                  <tr key={node.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-3">
                      <div className="font-semibold text-slate-100">{node.code}</div>
                      <div className="font-sans text-[11px] text-slate-400 max-w-[210px] truncate">
                        {node.label}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-slate-300 whitespace-nowrap">
                      {node.stage.replace('STAGE_', 'S').replace('_', ' · ')}
                      <div className="text-slate-500">{node.dominant_control}</div>
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <input
                        type="number"
                        min={1}
                        max={5}
                        aria-label={`${node.code} Likelihood`}
                        value={node.fmea.likelihood}
                        onChange={(e) =>
                          updateNodeFMEA(node.id, {
                            likelihood: Math.min(5, Math.max(1, Number(e.target.value))),
                          })
                        }
                        className="w-12 rounded border border-slate-700 bg-[#0B0F17] px-1.5 py-1 text-center text-slate-100"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <input
                        type="number"
                        min={1}
                        max={5}
                        aria-label={`${node.code} Impact`}
                        value={node.fmea.impact}
                        onChange={(e) =>
                          updateNodeFMEA(node.id, {
                            impact: Math.min(5, Math.max(1, Number(e.target.value))),
                          })
                        }
                        className="w-12 rounded border border-slate-700 bg-[#0B0F17] px-1.5 py-1 text-center text-slate-100"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <input
                        type="number"
                        min={1}
                        max={5}
                        aria-label={`${node.code} Recovery Complexity`}
                        value={node.fmea.recovery_complexity}
                        onChange={(e) =>
                          updateNodeFMEA(node.id, {
                            recovery_complexity: Math.min(5, Math.max(1, Number(e.target.value))),
                          })
                        }
                        className="w-12 rounded border border-slate-700 bg-[#0B0F17] px-1.5 py-1 text-center text-slate-100"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-300">
                      {rawRpn}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          aria-label={`${node.code} Technical control percentage`}
                          value={node.tripartite.technical}
                          onChange={(e) =>
                            updateNodeTripartite(node.id, { technical: Number(e.target.value) })
                          }
                          className="w-16 accent-cyan-400 cursor-pointer"
                        />
                        <span className="text-cyan-300 w-8 text-right">
                          {node.tripartite.technical.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          aria-label={`${node.code} Formal control percentage`}
                          value={node.tripartite.formal}
                          onChange={(e) =>
                            updateNodeTripartite(node.id, { formal: Number(e.target.value) })
                          }
                          className="w-16 accent-amber-400 cursor-pointer"
                        />
                        <span className="text-amber-300 w-8 text-right">
                          {node.tripartite.formal.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          aria-label={`${node.code} Informal control percentage`}
                          value={node.tripartite.informal}
                          onChange={(e) =>
                            updateNodeTripartite(node.id, { informal: Number(e.target.value) })
                          }
                          className="w-16 accent-emerald-400 cursor-pointer"
                        />
                        <span className="text-emerald-300 w-8 text-right">
                          {node.tripartite.informal.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          aria-label={`${node.code} Policy investment`}
                          value={node.fmea.policy_investment}
                          onChange={(e) =>
                            updateNodeFMEA(node.id, {
                              policy_investment: Number(e.target.value),
                            })
                          }
                          className="w-16 accent-sky-400 cursor-pointer"
                        />
                        <span className="text-slate-200 w-7 text-right">
                          {node.fmea.policy_investment.toFixed(0)}
                        </span>
                      </div>
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        resRpn >= 55
                          ? 'text-rose-400'
                          : resRpn >= 35
                            ? 'text-amber-300'
                            : 'text-emerald-400'
                      }`}
                    >
                      {resRpn.toFixed(1)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{psoe}</td>
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
