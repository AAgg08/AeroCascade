import {
  CascadeStage,
  ControlCategory,
  PSOELevel,
  type DependencyEdgeModel,
  type DiscreteEventRecord,
  type EASAPartISNotification,
  type FMEAMetrics,
  type HourlyCapacityPoint,
  type NodeCentralityMetric,
  type SimulationResponse,
  type SystemNodeModel,
} from './types.ts';

/**
 * Computes raw FMEA Risk Priority Number:
 * RPN = Likelihood (1-5) * Impact (1-5) * Recovery Complexity (1-5)
 */
export function calculateRawRPN(fmea: FMEAMetrics): number {
  const l = Math.min(5, Math.max(1, Math.round(fmea.likelihood)));
  const i = Math.min(5, Math.max(1, Math.round(fmea.impact)));
  const rc = Math.min(5, Math.max(1, Math.round(fmea.recovery_complexity)));
  return l * i * rc;
}

/**
 * Dynamically evaluates PSOE (Present, Suitable, Operational, Effective) maturity
 * from Dhillon & Moores (2001) Tripartite Controls based on stage-dominant requirements.
 */
export function evaluateNodePSOE(node: SystemNodeModel): PSOELevel {
  const { technical, formal, informal } = node.tripartite;
  let score = 0;
  if (node.stage === CascadeStage.STAGE_1_TRIGGER) {
    score = 0.6 * technical + 0.25 * formal + 0.15 * informal;
  } else if (node.stage === CascadeStage.STAGE_2_PROPAGATION) {
    score = 0.4 * technical + 0.35 * formal + 0.25 * informal;
  } else {
    score = 0.1 * technical + 0.45 * formal + 0.45 * informal;
  }

  if (score >= 76) return PSOELevel.EFFECTIVE;
  if (score >= 56) return PSOELevel.OPERATIONAL;
  if (score >= 38) return PSOELevel.SUITABLE;
  return PSOELevel.PRESENT;
}

/**
 * Computes residual FMEA RPN after applying Dhillon & Moores (2001) Tripartite Controls
 * and Policy Investment (0-100).
 */
export function computeResidualRPN(node: SystemNodeModel): number {
  const raw = calculateRawRPN(node.fmea);
  const t = Math.min(100, Math.max(0, node.tripartite.technical)) / 100.0;
  const f = Math.min(100, Math.max(0, node.tripartite.formal)) / 100.0;
  const i = Math.min(100, Math.max(0, node.tripartite.informal)) / 100.0;
  const inv = Math.min(100, Math.max(0, node.fmea.policy_investment)) / 100.0;

  let mitigationFactor = 0;
  if (node.stage === CascadeStage.STAGE_1_TRIGGER) {
    mitigationFactor = 0.60 * t + 0.25 * f + 0.15 * i;
  } else if (node.stage === CascadeStage.STAGE_2_PROPAGATION) {
    mitigationFactor = 0.40 * t + 0.35 * f + 0.25 * i;
  } else {
    // Stage 3 Recovery Blocker: Technical controls alone cannot overcome Formal/Informal deficits
    mitigationFactor = 0.10 * t + 0.45 * f + 0.45 * i;
  }

  const combinedDamping = Math.min(0.78, (0.75 * mitigationFactor + 0.25 * inv) * 0.85);
  return Number(Math.max(5.0, raw * (1.0 - combinedDamping)).toFixed(1));
}

/**
 * Computes Directed Graph Chokepoint Centrality (Betweenness, In-Degree Vulnerability, Out-Degree Blast Radius)
 * across Stage 1 -> Stage 2 -> Stage 3 paths.
 */
export function computeGraphCentrality(
  nodes: SystemNodeModel[],
  edges: DependencyEdgeModel[]
): NodeCentralityMetric[] {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Compute all-pairs shortest/strongest directed paths (Stage 1 -> Stage 2 -> Stage 3) for betweenness
  const betweennessCount: Record<string, number> = {};
  for (const n of nodes) betweennessCount[n.id] = 0;

  let totalPaths = 0;
  for (const s of nodes) {
    for (const t of nodes) {
      if (s.id === t.id) continue;
      // Find 2-hop paths s -> m -> t
      const outFromS = validEdges.filter((e) => e.source === s.id);
      for (const e1 of outFromS) {
        const mid = e1.target;
        if (mid === t.id) continue;
        const outFromMid = validEdges.filter((e) => e.source === mid && e.target === t.id);
        for (const e2 of outFromMid) {
          const pathStrength = e1.coupling_weight * e2.coupling_weight;
          betweennessCount[mid] = (betweennessCount[mid] ?? 0) + pathStrength;
          totalPaths += pathStrength;
        }
      }
    }
  }

  const maxDegScale = Math.max(1.5, (nodes.length - 1) * 0.35);

  return nodes.map((node) => {
    const inWeight = validEdges
      .filter((e) => e.target === node.id)
      .reduce((acc, e) => acc + e.coupling_weight, 0);
    const outWeight = validEdges
      .filter((e) => e.source === node.id)
      .reduce((acc, e) => acc + e.coupling_weight, 0);

    const inVuln = Number(Math.min(1.0, inWeight / maxDegScale).toFixed(3));
    const outBlast = Number(Math.min(1.0, outWeight / maxDegScale).toFixed(3));
    const bCent =
      totalPaths > 0
        ? Number(Math.min(1.0, (betweennessCount[node.id] ?? 0) / Math.max(1.0, totalPaths * 0.45)).toFixed(3))
        : 0;

    const rawRpn = calculateRawRPN(node.fmea);
    const residualRpn = computeResidualRPN(node);
    const psoe = evaluateNodePSOE(node);

    const chokepointIndex = Number(
      Math.min(
        100.0,
        (0.45 * bCent + 0.30 * outBlast + 0.25 * inVuln) * 100.0 + (residualRpn / 125.0) * 35.0
      ).toFixed(1)
    );

    const normalizedRpnPct = (residualRpn / 125.0) * 100.0;
    const efficiencyGap = Number((normalizedRpnPct - node.fmea.policy_investment).toFixed(1));

    return {
      node_id: node.id,
      node_code: node.code,
      label: node.label,
      stage: node.stage,
      dominant_control: node.dominant_control,
      betweenness_centrality: bCent,
      in_degree_vulnerability: inVuln,
      out_degree_blast_radius: outBlast,
      chokepoint_index: chokepointIndex,
      raw_rpn: rawRpn,
      residual_rpn: residualRpn,
      policy_investment: node.fmea.policy_investment,
      investment_efficiency_gap: efficiencyGap,
      psoe_status: psoe,
      er040_severity: node.er040_severity,
    };
  });
}

function formatSimTime(hoursFloat: number): string {
  const totalMinutes = Math.round(hoursFloat * 60);
  const hh = Math.floor(totalMinutes / 60) % 24;
  const mm = totalMinutes % 60;
  return `T+${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}Z`;
}

export interface SimulationInputParams {
  scenario_id: string;
  horizon_hours: number;
  baseline_movements_per_hour: number;
  trigger_hour: number;
  nodes: SystemNodeModel[];
  edges: DependencyEdgeModel[];
}

/**
 * Executes the Three-Stage Cascading Failure Discrete-Event Simulation (DES)
 * and generates 24-hour airport capacity degradation trajectories + EASA Part-IS dossier.
 */
export function runDiscreteEventSimulation(req: SimulationInputParams): SimulationResponse {
  const nodeAnalytics = computeGraphCentrality(req.nodes, req.edges);

  const stage1Nodes = req.nodes.filter((n) => n.stage === CascadeStage.STAGE_1_TRIGGER);
  const stage2Nodes = req.nodes.filter((n) => n.stage === CascadeStage.STAGE_2_PROPAGATION);
  const stage3Nodes = req.nodes.filter((n) => n.stage === CascadeStage.STAGE_3_BLOCKER);

  const events: DiscreteEventRecord[] = [];
  let simClock = req.trigger_hour;

  // Stage 1: Trigger Events
  stage1Nodes.forEach((s1, idx) => {
    const resRpn = computeResidualRPN(s1);
    const techDamping = s1.tripartite.technical / 100.0;
    simClock = Number((simClock + 0.08 + idx * 0.12).toFixed(2));
    const capDrop = Number(Math.max(8.0, (resRpn / 125.0) * 32.0 * (1.0 - 0.45 * techDamping)).toFixed(1));

    events.push({
      event_id: `EVT-S1-0${idx + 1}`,
      timestamp_hours: simClock,
      formatted_time: formatSimTime(simClock),
      stage: CascadeStage.STAGE_1_TRIGGER,
      node_id: s1.id,
      node_code: s1.code,
      node_label: s1.label,
      dominant_control: s1.dominant_control,
      event_type: 'INITIAL_VECTOR_BREACH',
      narrative: `${s1.failure_mode} (Technical Control Maturity: ${s1.tripartite.technical.toFixed(0)}%, Residual RPN: ${resRpn}).`,
      capacity_impact_pct: capDrop,
      residual_rpn: resRpn,
    });
  });

  // Stage 2: Operational Fragility Propagation Events
  stage2Nodes.forEach((s2, idx) => {
    const resRpn = computeResidualRPN(s2);
    const propDelay = Number(
      ((s2.base_latency_minutes / 60.0) * (0.7 + 0.3 * (s2.tripartite.technical / 100.0))).toFixed(2)
    );
    simClock = Number((simClock + propDelay).toFixed(2));
    const capDrop = Number(Math.max(14.0, (resRpn / 125.0) * 58.0).toFixed(1));

    events.push({
      event_id: `EVT-S2-0${idx + 1}`,
      timestamp_hours: simClock,
      formatted_time: formatSimTime(simClock),
      stage: CascadeStage.STAGE_2_PROPAGATION,
      node_id: s2.id,
      node_code: s2.code,
      node_label: s2.label,
      dominant_control: s2.dominant_control,
      event_type: 'OPERATIONAL_CASCADE_PROPAGATION',
      narrative: `Cascade propagated to ${s2.label}: ${s2.failure_mode} Separation buffers widened across RTM sectors.`,
      capacity_impact_pct: capDrop,
      residual_rpn: resRpn,
    });
  });

  // Stage 3: Recovery Blockers (Formal & Informal Control Deficits)
  stage3Nodes.forEach((s3, idx) => {
    const resRpn = computeResidualRPN(s3);
    const formalInformalAvg = 0.5 * (s3.tripartite.formal + s3.tripartite.informal);
    const stallDurationHrs = Number(Math.max(0.45, (100.0 - formalInformalAvg) / 28.0).toFixed(2));
    simClock = Number((simClock + stallDurationHrs).toFixed(2));
    const capDrop = Number(
      Math.max(18.0, (resRpn / 125.0) * 72.0 * (1.0 - formalInformalAvg / 140.0)).toFixed(1)
    );

    events.push({
      event_id: `EVT-S3-0${idx + 1}`,
      timestamp_hours: simClock,
      formatted_time: formatSimTime(simClock),
      stage: CascadeStage.STAGE_3_BLOCKER,
      node_id: s3.id,
      node_code: s3.code,
      node_label: s3.label,
      dominant_control: s3.dominant_control,
      event_type: 'RECOVERY_GOVERNANCE_STALL',
      narrative: `Recovery blocked by ${s3.dominant_control} control deficit at ${s3.label}: ${s3.failure_mode} (Formal=${s3.tripartite.formal.toFixed(0)}%, Informal=${s3.tripartite.informal.toFixed(0)}%).`,
      capacity_impact_pct: capDrop,
      residual_rpn: resRpn,
    });
  });

  // Aggregate Tripartite metrics
  const nodeCount = Math.max(1, req.nodes.length);
  const avgTech = req.nodes.reduce((s, n) => s + n.tripartite.technical, 0) / nodeCount;
  const avgFormal = req.nodes.reduce((s, n) => s + n.tripartite.formal, 0) / nodeCount;
  const avgInformal = req.nodes.reduce((s, n) => s + n.tripartite.informal, 0) / nodeCount;
  const meanRawRpn = req.nodes.reduce((s, n) => s + calculateRawRPN(n.fmea), 0) / nodeCount;
  const meanResidualRpn = req.nodes.reduce((s, n) => s + computeResidualRPN(n), 0) / nodeCount;

  // Stage 3 Formal + Informal recovery rate
  const s3FormalAvg =
    stage3Nodes.length > 0
      ? stage3Nodes.reduce((s, n) => s + n.tripartite.formal, 0) / stage3Nodes.length
      : avgFormal;
  const s3InformalAvg =
    stage3Nodes.length > 0
      ? stage3Nodes.reduce((s, n) => s + n.tripartite.informal, 0) / stage3Nodes.length
      : avgInformal;

  const tripartiteRecoveryRate = 0.07 + 0.28 * ((0.5 * s3FormalAvg + 0.5 * s3InformalAvg) / 100.0);
  const shockDepthTripartite = Math.min(
    0.84,
    Math.max(0.15, (meanResidualRpn / 100.0) * (1.0 - 0.35 * (avgTech / 100.0)))
  );

  const hourlyCapacity: HourlyCapacityPoint[] = [];
  let cumulativeDelayed = 0;
  const t0 = req.trigger_hour;

  for (let h = 0; h < req.horizon_hours; h++) {
    const base = req.baseline_movements_per_hour;
    let unmit = base;
    let techOnly = base;
    let tripartiteCap = base;
    let stageLabel = 'NOMINAL_OPS';

    if (h >= t0) {
      const dt = h - t0;
      // 1. Unmitigated Cascade Curve
      let unmitFactor = 1.0;
      if (dt <= 2) {
        unmitFactor = 1.0 - 0.38 * (dt + 1);
      } else if (dt <= 9) {
        unmitFactor = 0.22 + 0.02 * (dt - 2);
      } else {
        unmitFactor = Math.min(0.88, 0.36 + 0.045 * (dt - 9));
      }

      // 2. Technical-Only Mitigation Curve (High Technical, Low Formal/Informal -> Stage 3 recovery stall)
      let techFactor = 1.0;
      if (dt <= 2) {
        techFactor = 1.0 - 0.24 * (dt + 1);
      } else if (dt <= 8) {
        techFactor = 0.48 + 0.015 * (dt - 2);
      } else {
        techFactor = Math.min(0.94, 0.57 + 0.045 * (dt - 8));
      }

      // 3. Live Tripartite Mitigated Curve (Driven by Technical, Formal, Informal sliders)
      let triFactor = 1.0;
      if (dt === 0) {
        triFactor = 1.0 - shockDepthTripartite * 0.45;
        stageLabel = 'STAGE_1_TRIGGER';
      } else if (dt <= 2) {
        triFactor = 1.0 - shockDepthTripartite * (0.75 + 0.12 * dt);
        stageLabel = 'STAGE_2_PROPAGATION';
      } else {
        const recoveryProgress = 1.0 - Math.exp(-tripartiteRecoveryRate * (dt - 2));
        triFactor = 1.0 - shockDepthTripartite + shockDepthTripartite * recoveryProgress;
        stageLabel = triFactor < 0.92 ? 'STAGE_3_RECOVERY' : 'RESTORED_OPS';
      }

      unmit = Number(Math.max(4.0, base * unmitFactor).toFixed(1));
      techOnly = Number(Math.max(8.0, base * techFactor).toFixed(1));
      tripartiteCap = Number(Math.min(base, Math.max(6.0, base * triFactor)).toFixed(1));
      cumulativeDelayed += Math.max(0, Math.round(base - tripartiteCap));
    }

    hourlyCapacity.push({
      hour: h,
      time_label: `${String(h).padStart(2, '0')}:00Z`,
      baseline_capacity: base,
      unmitigated_capacity: unmit,
      technical_only_capacity: techOnly,
      tripartite_mitigated_capacity: tripartiteCap,
      active_stage: stageLabel,
      delayed_flights_cumulative: cumulativeDelayed,
    });
  }

  const minCap = Math.min(...hourlyCapacity.map((p) => p.tripartite_mitigated_capacity));
  const recoveryWindowHours = hourlyCapacity.filter(
    (p) => p.hour >= t0 && p.tripartite_mitigated_capacity < 0.9 * req.baseline_movements_per_hour
  ).length;

  const sortedByChokepoint = [...nodeAnalytics].sort((a, b) => b.chokepoint_index - a.chokepoint_index);
  const topChokepoint = sortedByChokepoint[0];

  const toPSOELevel = (score: number): PSOELevel => {
    if (score >= 75) return PSOELevel.EFFECTIVE;
    if (score >= 55) return PSOELevel.OPERATIONAL;
    if (score >= 38) return PSOELevel.SUITABLE;
    return PSOELevel.PRESENT;
  };

  const easaNotification: EASAPartISNotification = {
    report_id: `EASA-PART-IS-${req.scenario_id.toUpperCase()}-2026`,
    regulation_basis: [
      'Commission Delegated Regulation (EU) 2022/1645 (Part-IS.D.OR.200 / 230)',
      'Commission Implementing Regulation (EU) 2023/203 (Part-IS.I.OR.230)',
      'EUROCAE ED-202A / ER-040 Safety & Information Security Risk Process',
    ],
    reporting_entity: 'Remote Tower Centre (RTC) Multi-Aerodrome Operations Authority',
    initial_notification_deadline_hours: 72,
    incident_classification:
      meanResidualRpn > 50
        ? 'Priority 1 — Significant Information Security Incident Affecting Flight Safety & Capacity'
        : 'Priority 2 — Contained Aviation Information Security Perturbation',
    er040_risk_class:
      meanResidualRpn > 45
        ? 'ER-040 Class II (Hazardous) — Immediate Tripartite Mitigation Mandatory'
        : 'ER-040 Class III (Major) —Acceptable with Continuous PSOE Monitoring',
    affected_assets: req.nodes.map((n) => `${n.code}: ${n.label}`),
    stage_1_technical_root_cause: stage1Nodes.map((n) => `${n.code} (${n.failure_mode})`).join(' | '),
    stage_2_operational_propagation: stage2Nodes.map((n) => `${n.code} (${n.failure_mode})`).join(' | '),
    stage_3_governance_recovery_blocker: stage3Nodes
      .map((n) => `${n.code} [${n.dominant_control}]: ${n.failure_mode}`)
      .join(' | '),
    psoe_maturity_summary: {
      'Technical Controls (Encryption, IDS, PTP Holdover)': toPSOELevel(avgTech),
      'Formal Controls (Part-IS Reversion SOPs & SLAs)': toPSOELevel(avgFormal),
      'Informal Controls (ATCO Cognitive Trust & Culture)': toPSOELevel(avgInformal),
    },
    containment_actions: stage1Nodes.concat(stage2Nodes).map((n) => `${n.code}: ${n.mitigation_recommendation}`),
    structural_remediations: stage3Nodes.map((n) => `${n.code} (${n.dominant_control}): ${n.mitigation_recommendation}`),
  };

  return {
    scenario_id: req.scenario_id,
    summary_kpis: {
      mean_raw_rpn: Number(meanRawRpn.toFixed(1)),
      mean_residual_rpn: Number(meanResidualRpn.toFixed(1)),
      min_hourly_capacity: Number(minCap.toFixed(1)),
      capacity_retention_pct: Number(((minCap / req.baseline_movements_per_hour) * 100.0).toFixed(1)),
      recovery_window_hours: recoveryWindowHours,
      total_disrupted_movements: cumulativeDelayed,
      tripartite_balance_index: Number(((avgTech + avgFormal + avgInformal) / 3.0).toFixed(1)),
      top_chokepoint_code: topChokepoint ? topChokepoint.node_code : 'N/A',
      top_chokepoint_score: topChokepoint ? topChokepoint.chokepoint_index : 0,
    },
    events,
    hourly_capacity: hourlyCapacity,
    node_analytics: nodeAnalytics,
    easa_notification: easaNotification,
  };
}
