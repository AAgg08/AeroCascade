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
    executeSimulationOnServer,
    isSimulating,
    activeRunMode,
    inputRevision,
  } = useCascadeStore();

  const isStale = inputRevision > (simulationResult.provenance?.input_revision ?? 0);
  const isDeterministicBusy = isSimulating && activeRunMode === 'deterministic';
  const isMonteCarloBusy = isSimulating && activeRunMode === 'monte-carlo';

  const replicates = simulationResult.replicates ?? 1;
  const isStochastic = Boolean(
    replicates > 1 &&
      simulationResult.hourly_capacity.some(
        (pt) => pt.capacity_5th != null && pt.capacity_95th != null
      )
  );

  const recordedTrigger = simulationResult.input_snapshot?.trigger_hour;
  const resultTrigger = typeof recordedTrigger === 'number'
    ? recordedTrigger
    : isStale ? undefined : triggerHour;
  const triggerTimeLabel = resultTrigger === undefined
    ? undefined
    : `T+${String(resultTrigger).padStart(2, '0')}:00`;

  const capacityChartData = useMemo(() => {
    return simulationResult.hourly_capacity.map((pt) => {
      const normalizedLabel = pt.time_label?.startsWith('T+')
        ? pt.time_label
        : `T+${String(pt.hour).padStart(2, '0')}:00`;
      return {
        ...pt,
        time_label: normalizedLabel,
        percentile_band:
          pt.capacity_5th != null && pt.capacity_95th != null
            ? [pt.capacity_5th, pt.capacity_95th]
            : undefined,
        primary_capacity:
          isStochastic && pt.capacity_median != null
            ? pt.capacity_median
            : pt.tripartite_mitigated_capacity,
      };
    });
  }, [simulationResult.hourly_capacity, isStochastic]);

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
    <div className="space-y-8">
      {/* Top Action & Preset Comparison Bar */}
      <section
        aria-label="FMEA and Capacity Curve Policy Controls"
        className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"
      >
        <div>
          <span className="rounded-full bg-emerald-50 text-emerald-800 border border-emerald-100 px-3 py-1 text-xs font-semibold">
            FMEA RPN Quantification &amp; Throughput Degradation
          </span>
          <h2 className="mt-2 text-lg font-bold text-gray-900">
            Risk Priority Number (RPN) vs. Policy Investment &amp; Recovery Trajectories
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Contrasts Stage 1 cyber triggers against Stage 3 Formal and Informal governance recovery deficits.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="fmea-simulate-btn"
              onClick={() => executeSimulationOnServer()}
              disabled={isSimulating}
              className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-60 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900"
            >
              {isDeterministicBusy && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{isDeterministicBusy ? 'Simulating...' : 'Simulate'}</span>
            </button>
            <button
              type="button"
              data-testid="fmea-monte-carlo-btn"
              onClick={() => executeSimulationOnServer({ replicates: 30 })}
              disabled={isSimulating}
              className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:opacity-95 disabled:opacity-60 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
            >
              {isMonteCarloBusy && (
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              )}
              <span>{isMonteCarloBusy ? 'Simulating (30 Reps)...' : 'Run Monte Carlo (30 Reps)'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* Dual Charts Grid */}
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        {/* Chart 1: FMEA RPN vs. Policy Investment Bar Chart */}
        <section
          aria-label="FMEA RPN vs Policy Investment Chart"
          className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm flex flex-col justify-between"
        >
          <div className="border-b border-gray-100 pb-4 mb-4">
            <div className="flex items-center justify-between text-xs text-gray-500 font-semibold">
              <span className="rounded-full bg-gray-100 px-3 py-0.5 text-gray-700">Chart 01 · Misalignment Analysis</span>
              <span>RPN (1–125) · Policy (0–100)</span>
            </div>
            <h3 className="mt-2 text-base font-bold text-gray-900">
              FMEA RPN (Raw &amp; Residual) vs. Policy Investment by System Node
            </h3>
            <p className="mt-1 text-xs text-gray-500 leading-relaxed">
              Reveals the Stage 3 governance gap: high Policy Investment in Stage 1 sensors contrasts with under-funded Stage 3 recovery blockers.
            </p>
          </div>

          <div className="h-[340px] w-full" data-testid="chart-fmea-rpn">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={fmeaChartData}
                margin={{ top: 12, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="code"
                  stroke="#9CA3AF"
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={44}
                  tick={{ fill: '#4B5563', fontSize: 11 }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  domain={[0, 130]}
                  tick={{ fill: '#6B7280', fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E5E7EB',
                    borderRadius: '1rem',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08)',
                    fontSize: '12px',
                    color: '#111827',
                  }}
                />
                <Legend
                  wrapperStyle={{
                    fontSize: '11px',
                    paddingTop: '8px',
                  }}
                />
                <Bar
                  dataKey="raw_rpn"
                  name="Raw FMEA RPN (1-125)"
                  fill="#94A3B8"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="residual_rpn"
                  name="Residual RPN (Post-Tripartite)"
                  fill="#FB7185"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="policy_investment"
                  name="Policy Investment (0-100)"
                  fill="#10B981"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="chokepoint_index"
                  name="Chokepoint Index"
                  stroke="#F59E0B"
                  strokeWidth={2.5}
                  dot={{ r: 4, fill: '#F59E0B' }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Chart 2: Hourly Airport Capacity Degradation Curves */}
        <section
          aria-label="Hourly Airport Capacity Degradation Curve"
          className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm flex flex-col justify-between"
        >
          <div className="border-b border-gray-100 pb-4 mb-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs font-bold text-gray-700">
                  Chart 02
                </span>
                <span
                  data-testid="chart-engine-badge"
                  className={`rounded-full px-3 py-0.5 text-[11px] font-bold border ${
                    simulationResult.provenance?.engine === 'fastapi-python'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                      : simulationResult.provenance?.is_fallback
                      ? 'bg-amber-50 text-amber-700 border-amber-100'
                      : 'bg-gray-100 text-gray-700 border-gray-200'
                  }`}
                >
                  ● {simulationResult.provenance?.engine === 'fastapi-python'
                    ? 'Authoritative Engine (SimPy)'
                    : simulationResult.provenance?.is_fallback
                    ? 'Client Fallback'
                    : 'Client Preview'}
                </span>
                {isStale && (
                  <span
                    data-testid="chart-stale-badge"
                    className="rounded-full bg-amber-50 px-3 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200"
                  >
                    Stale (Rev #{simulationResult.provenance?.input_revision ?? 1})
                  </span>
                )}
                {isStochastic && (
                  <span
                    data-testid="chart-monte-carlo-badge"
                    className="rounded-full bg-purple-50 px-3 py-0.5 text-[11px] font-bold text-purple-700 border border-purple-200"
                  >
                    {replicates} replicates
                  </span>
                )}
              </div>
              {triggerTimeLabel && (
                <span className="rounded-full bg-rose-50 text-rose-700 border border-rose-100 px-3 py-0.5 text-[11px] font-bold">
                  Trigger: {triggerTimeLabel}
                </span>
              )}
            </div>
            <h3 className="mt-2 text-base font-bold text-gray-900">
              How does airport capacity recover after the trigger?
            </h3>
            <p className="mt-1 text-xs text-gray-500 leading-relaxed">
              {isStochastic
                ? `Hourly movement capacity over elapsed time. The 5th–95th percentile band shows the spread of simulated capacity outcomes across ${replicates} Monte Carlo replicates, alongside the 50th percentile median and deterministic policy benchmarks.`
                : 'Hourly movement capacity (movements/hr) over elapsed time (T+HH:MM), contrasting active Tripartite mitigation against unmitigated collapse and technical-only recovery stalls.'}
            </p>
          </div>

          <div className="h-[340px] w-full" data-testid="chart-capacity-degradation">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={capacityChartData}
                margin={{ top: 12, right: 16, left: 0, bottom: 8 }}
              >
                <CartesianGrid stroke="#F3F4F6" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="time_label"
                  stroke="#9CA3AF"
                  interval={2}
                  tick={{ fill: '#4B5563', fontSize: 11 }}
                />
                <YAxis
                  stroke="#9CA3AF"
                  tick={{ fill: '#6B7280', fontSize: 11 }}
                  label={{
                    value: 'Movements / Hr',
                    angle: -90,
                    position: 'insideLeft',
                    fill: '#6B7280',
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E5E7EB',
                    borderRadius: '1rem',
                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.08)',
                    fontSize: '12px',
                    color: '#111827',
                  }}
                  formatter={(value: any, name: any) => {
                    if (
                      name === '5th–95th percentile band' ||
                      name === 'percentile_band' ||
                      String(name).toLowerCase().includes('percentile band')
                    ) {
                      if (Array.isArray(value)) {
                        return [
                          `${Number(value[0]).toFixed(1)} – ${Number(value[1]).toFixed(1)} mvmt/hr (spread of simulated capacity outcomes)`,
                          '5th–95th percentile band',
                        ];
                      }
                      return [value, '5th–95th percentile band (spread of simulated capacity outcomes)'];
                    }
                    if (Array.isArray(value)) {
                      return [`[${Number(value[0]).toFixed(1)}, ${Number(value[1]).toFixed(1)}] mvmt/hr`, name];
                    }
                    if (typeof value === 'number') {
                      return [`${value.toFixed(1)} mvmt/hr`, name];
                    }
                    return [value, name];
                  }}
                  labelFormatter={(label) => `Elapsed Sim Time: ${label}`}
                />
                <Legend
                  wrapperStyle={{
                    fontSize: '11px',
                    paddingTop: '8px',
                  }}
                  formatter={(value: string) => {
                    if (value === '5th–95th percentile band') {
                      return '5th–95th percentile band (spread of simulated capacity outcomes)';
                    }
                    return value;
                  }}
                />
                {triggerTimeLabel && (
                  <ReferenceLine
                    x={triggerTimeLabel}
                    stroke="#F43F5E"
                    strokeDasharray="4 4"
                    label={{
                      value: `Stage 1 Trigger (${triggerTimeLabel})`,
                      position: 'top',
                      fill: '#BE123C',
                      fontSize: 10,
                    }}
                  />
                )}

                {/* Layer 1: Monte Carlo percentile band */}
                {isStochastic && (
                  <Area
                    type="monotone"
                    dataKey="percentile_band"
                    name="5th–95th percentile band"
                    fill="#C084FC"
                    fillOpacity={0.16}
                    stroke="#A855F7"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                )}

                {/* Layer 1b: Deterministic Fill (only when not in stochastic mode) */}
                {!isStochastic && (
                  <Area
                    type="monotone"
                    dataKey="tripartite_mitigated_capacity"
                    name="Active Tripartite Fill [Shaded]"
                    fill="#10B981"
                    fillOpacity={0.1}
                    stroke="none"
                  />
                )}

                {/* Layer 2: Baseline Nominal Capacity */}
                <Line
                  type="stepAfter"
                  dataKey="baseline_capacity"
                  name="Nominal Capacity (Baseline) [Step-dashed]"
                  stroke="#9CA3AF"
                  strokeDasharray="6 4"
                  strokeWidth={1.75}
                  dot={false}
                />

                {/* Layer 3: Primary Solid Line: Median Capacity (50th %ile) or Active Tripartite Capacity */}
                <Line
                  type="monotone"
                  dataKey="primary_capacity"
                  name={isStochastic ? 'Monte Carlo 50th %ile Median [Solid cyan]' : 'Active Tripartite Configuration [Solid]'}
                  stroke={isStochastic ? '#06B6D4' : '#10B981'}
                  strokeWidth={3}
                  dot={isStochastic ? { r: 3.5, fill: '#06B6D4' } : false}
                />

                {/* Layer 4: Deterministic benchmark line when stochastic is active */}
                {isStochastic && (
                  <Line
                    type="monotone"
                    dataKey="tripartite_mitigated_capacity"
                    name="Deterministic Baseline (1 Rep) [Fine-dashed]"
                    stroke="#10B981"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                    dot={false}
                  />
                )}

                {/* Layer 5: Technical-Only Capacity */}
                <Line
                  type="monotone"
                  dataKey="technical_only_capacity"
                  name="Technical-Only Bias (Stage 3 Deficit) [Dashed]"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={false}
                />

                {/* Layer 6: Unmitigated Cascade */}
                <Line
                  type="monotone"
                  dataKey="unmitigated_capacity"
                  name="Unmitigated Stress (Worst-Case) [Dotted]"
                  stroke="#F43F5E"
                  strokeWidth={2}
                  strokeDasharray="3 3"
                  dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Interactive FMEA & Tripartite Matrix Table Card */}
      <section
        aria-label="Interactive FMEA Risk Register"
        className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm overflow-hidden"
      >
        <div className="flex flex-col gap-4 pb-5 border-b border-gray-100 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-base font-bold text-gray-900">
              Interactive FMEA Risk Register &amp; Calibration Matrix
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Adjust Likelihood (1–5), Impact (1–5), Recovery Complexity (1–5), Policy Investment (0–100), or Tripartite Controls directly.
            </p>
          </div>

          {/* Interactive Filter Controls (Pill format) */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 rounded-full bg-gray-100 p-1 text-xs">
              {(['ALL', CascadeStage.STAGE_1_TRIGGER, CascadeStage.STAGE_2_PROPAGATION, CascadeStage.STAGE_3_BLOCKER] as const).map(
                (st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStageFilter(st)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                      stageFilter === st
                        ? 'bg-white text-gray-900 shadow-xs'
                        : 'text-gray-500 hover:text-gray-800'
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

            <div className="flex items-center gap-1 rounded-full bg-gray-100 p-1 text-xs">
              {(['ALL', ControlCategory.TECHNICAL, ControlCategory.FORMAL, ControlCategory.INFORMAL] as const).map(
                (ctrl) => (
                  <button
                    key={ctrl}
                    type="button"
                    onClick={() => setControlFilter(ctrl)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-all whitespace-nowrap shrink-0 ${
                      controlFilter === ctrl
                        ? 'bg-white text-gray-900 shadow-xs'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {ctrl === 'ALL' ? 'All Controls' : ctrl}
                  </button>
                )
              )}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto pt-3">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-3">Node</th>
                <th className="py-3 px-3">Stage &amp; Dominant</th>
                <th className="py-3 px-3 text-center">L (1-5)</th>
                <th className="py-3 px-3 text-center">I (1-5)</th>
                <th className="py-3 px-3 text-center">RC (1-5)</th>
                <th className="py-3 px-3 text-right">Raw RPN</th>
                <th className="py-3 px-3">Technical %</th>
                <th className="py-3 px-3">Formal %</th>
                <th className="py-3 px-3">Informal %</th>
                <th className="py-3 px-3">Policy Inv.</th>
                <th className="py-3 px-3 text-right">Adjusted Risk</th>
                <th className="py-3 px-3 text-right">PSOE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredNodes.map((node) => {
                const rawRpn = calculateRawRPN(node.fmea);
                const resRpn = computeResidualRPN(node);
                const psoe = evaluateNodePSOE(node);

                return (
                  <tr key={node.id} className="hover:bg-gray-50/80 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-bold text-gray-900">{node.code}</div>
                      <div className="text-[11px] text-gray-500 max-w-[210px] truncate font-medium">
                        {node.label}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-[11px] text-gray-700 whitespace-nowrap">
                      <span className="font-semibold">{node.stage.replace('STAGE_', 'S').replace('_', ' · ')}</span>
                      <div className="text-gray-400">{node.dominant_control}</div>
                    </td>
                    <td className="py-3 px-3 text-center">
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
                        className="w-12 rounded-xl border border-gray-200 bg-gray-50/70 px-1.5 py-1 text-center font-bold text-gray-900 focus:bg-white"
                      />
                    </td>
                    <td className="py-3 px-3 text-center">
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
                        className="w-12 rounded-xl border border-gray-200 bg-gray-50/70 px-1.5 py-1 text-center font-bold text-gray-900 focus:bg-white"
                      />
                    </td>
                    <td className="py-3 px-3 text-center">
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
                        className="w-12 rounded-xl border border-gray-200 bg-gray-50/70 px-1.5 py-1 text-center font-bold text-gray-900 focus:bg-white"
                      />
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-gray-700">
                      {rawRpn}
                    </td>
                    <td className="py-3 px-3">
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
                          className="w-16 accent-teal-500 cursor-pointer"
                        />
                        <span className="text-teal-700 font-bold w-8 text-right">
                          {node.tripartite.technical.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
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
                          className="w-16 accent-amber-500 cursor-pointer"
                        />
                        <span className="text-amber-700 font-bold w-8 text-right">
                          {node.tripartite.formal.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
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
                          className="w-16 accent-emerald-500 cursor-pointer"
                        />
                        <span className="text-emerald-700 font-bold w-8 text-right">
                          {node.tripartite.informal.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3">
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
                          className="w-16 accent-indigo-500 cursor-pointer"
                        />
                        <span className="text-gray-800 font-bold w-7 text-right">
                          {node.fmea.policy_investment.toFixed(0)}
                        </span>
                      </div>
                    </td>
                    <td
                      className={`py-3 px-3 text-right font-extrabold ${
                        resRpn >= 55
                          ? 'text-rose-600'
                          : resRpn >= 35
                            ? 'text-amber-600'
                            : 'text-emerald-600'
                      }`}
                    >
                      {resRpn.toFixed(1)}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <span className="rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 font-bold text-[10px]">
                        {psoe}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="border-t border-gray-100 pt-3 text-[11px] text-gray-500">
          * <span className="font-semibold text-gray-700">Adjusted Risk Score</span> (0.0 ≤ Adjusted ≤ Raw) reflects illustrative mitigation damping from Dhillon &amp; Moores (2001) tripartite controls.
        </div>
      </section>

      {/* Dedicated Paper Reference Table (Aggarwal & Dhillon, AIAA Aviation 2026, Table 3) */}
      <section
        aria-label="AIAA Aviation 2026 Paper Reference Benchmarks"
        className="rounded-3xl border border-gray-100 bg-white p-6 sm:p-8 shadow-sm space-y-4"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between border-b border-gray-100 pb-4">
          <div>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-100">
              Paper Reference · AIAA Aviation 2026 Table 3 Benchmarks
            </span>
            <h3 className="text-base font-bold text-gray-900 mt-2">
              Macro-Category Qualitative FMEA Paper Reference Scores
            </h3>
          </div>
          <span className="text-xs font-medium text-gray-400">
            Category-level paper scores · Sector assessments
          </span>
        </div>

        <p className="text-xs text-gray-600 leading-relaxed">
          The table below reflects the four qualitative macro-categories established in Section VI.A / Table 3 of Aggarwal &amp; Dhillon (AIAA Aviation 2026).
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                <th className="py-3 px-3">Paper Macro-Category (Table 3)</th>
                <th className="py-3 px-3 text-center">Likelihood (L)</th>
                <th className="py-3 px-3 text-center">Impact (I)</th>
                <th className="py-3 px-3 text-center">Recovery Complexity (RC)</th>
                <th className="py-3 px-3 text-right">Raw RPN (L × I × RC)</th>
                <th className="py-3 px-3">Methodological Focus in Paper</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              <tr>
                <td className="py-3 px-3 font-bold text-gray-900">Legacy Infrastructure</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">4</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">4</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">4</td>
                <td className="py-3 px-3 text-right font-extrabold text-amber-600">64</td>
                <td className="py-3 px-3 text-gray-500">
                  Aging communication masts, unencrypted analog video feeds, legacy serial interfaces, and lack of firmware hardening.
                </td>
              </tr>
              <tr>
                <td className="py-3 px-3 font-bold text-gray-900">Cybersecurity Threats</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">5</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">5</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">3</td>
                <td className="py-3 px-3 text-right font-extrabold text-amber-600">75</td>
                <td className="py-3 px-3 text-gray-500">
                  RTP sensor replay attacks, A-SMGCS ghost track injection, and PTP/GNSS time desynchronization on RTC ingress links.
                </td>
              </tr>
              <tr>
                <td className="py-3 px-3 font-bold text-gray-900">Operational Fragility</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">4</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">5</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">4</td>
                <td className="py-3 px-3 text-right font-extrabold text-rose-600">80</td>
                <td className="py-3 px-3 text-gray-500">
                  Highest macro RPN in paper: multi-aerodrome sector split failures, OTW spatial-temporal decoupling, and capacity collapse.
                </td>
              </tr>
              <tr>
                <td className="py-3 px-3 font-bold text-gray-900">Human Factors &amp; Staffing</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">4</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">3</td>
                <td className="py-3 px-3 text-center text-gray-600 font-semibold">3</td>
                <td className="py-3 px-3 text-right font-extrabold text-emerald-600">36</td>
                <td className="py-3 px-3 text-gray-500">
                  Controller cognitive distrust, alert fatigue, reversion hesitation, and cross-organization SLA coordination deficits.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
