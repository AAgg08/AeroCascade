import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRawRPN,
  computeGraphCentrality,
  computeResidualRPN,
  evaluateControlMaturityPSOE,
  evaluateNodePSOE,
  runDiscreteEventSimulation,
} from './simulationEngine.ts';
import { SCENARIO_PRESETS } from './scenarios.ts';
import { CascadeStage, ControlCategory, ER040Severity, PSOELevel, type SystemNodeModel } from './types.ts';

test('FMEA RPN = Likelihood * Impact * Recovery Complexity', () => {
  assert.equal(
    calculateRawRPN({ likelihood: 4, impact: 5, recovery_complexity: 4, policy_investment: 50 }),
    80
  );
  assert.equal(
    calculateRawRPN({ likelihood: 5, impact: 5, recovery_complexity: 5, policy_investment: 20 }),
    125
  );
  assert.equal(
    calculateRawRPN({ likelihood: 1, impact: 1, recovery_complexity: 1, policy_investment: 90 }),
    1
  );
});

test('Dhillon & Moores Tripartite Controls reduce Stage 3 RPN primarily via Formal & Informal controls', () => {
  const scenario = SCENARIO_PRESETS[0];
  const stage3Node = scenario.nodes.find((n) => n.stage === CascadeStage.STAGE_3_BLOCKER)!;

  // Baseline Stage 3 node with low Formal & Informal controls
  const baseRpn = computeResidualRPN(stage3Node);

  // Increasing ONLY Technical controls to 100 on a Stage 3 blocker has limited effect
  const techMaxNode = {
    ...stage3Node,
    tripartite: { ...stage3Node.tripartite, technical: 100 },
  };
  const techMaxRpn = computeResidualRPN(techMaxNode);

  // Increasing Formal & Informal controls to 95 significantly reduces Stage 3 blocker RPN
  const formalInformalMaxNode = {
    ...stage3Node,
    tripartite: { ...stage3Node.tripartite, formal: 95, informal: 95 },
  };
  const formalInformalRpn = computeResidualRPN(formalInformalMaxNode);

  assert.ok(formalInformalRpn < techMaxRpn, 'Formal + Informal investment must reduce Stage 3 RPN more than Technical alone');
  assert.ok(formalInformalRpn < baseRpn * 0.65, 'High Formal + Informal controls must substantially lower Stage 3 RPN');
  assert.equal(evaluateNodePSOE(formalInformalMaxNode), PSOELevel.EFFECTIVE);
});

test('Chokepoint centrality identifies Stage 2 propagation hubs with positive betweenness', () => {
  const scenario = SCENARIO_PRESETS[0];
  const metrics = computeGraphCentrality(scenario.nodes, scenario.edges);
  const otwFusion = metrics.find((m) => m.node_id === 'n-otw-fusion')!;

  assert.ok(otwFusion, 'OTW Fusion node metric should exist');
  assert.ok(otwFusion.betweenness_centrality > 0, 'Stage 2 OTW Fusion hub must have positive betweenness centrality');
  assert.ok(otwFusion.chokepoint_index > 40, 'Stage 2 OTW Fusion hub should register high chokepoint index');
});

test('Three-Stage Cascading Failure DES emits chronological Stage 1 -> Stage 2 -> Stage 3 events and 24h capacity curves', () => {
  const scenario = SCENARIO_PRESETS[0];
  const result = runDiscreteEventSimulation({
    scenario_id: scenario.id,
    horizon_hours: scenario.horizon_hours,
    baseline_movements_per_hour: scenario.baseline_movements_per_hour,
    trigger_hour: scenario.trigger_hour,
    nodes: scenario.nodes,
    edges: scenario.edges,
  });

  assert.equal(result.hourly_capacity.length, 24);
  assert.equal(result.easa_notification.initial_notification_deadline_hours, 72);
  assert.ok(result.events.length === scenario.nodes.length);

  // Verify chronological ordering
  for (let i = 1; i < result.events.length; i++) {
    assert.ok(
      result.events[i].timestamp_hours >= result.events[i - 1].timestamp_hours,
      'Events must be chronologically ordered'
    );
  }

  // Verify Stage 1 precedes Stage 2 and Stage 2 precedes Stage 3
  const firstS1 = result.events.find((e) => e.stage === CascadeStage.STAGE_1_TRIGGER)!;
  const firstS2 = result.events.find((e) => e.stage === CascadeStage.STAGE_2_PROPAGATION)!;
  const firstS3 = result.events.find((e) => e.stage === CascadeStage.STAGE_3_BLOCKER)!;

  assert.ok(firstS1.timestamp_hours < firstS2.timestamp_hours);
  assert.ok(firstS2.timestamp_hours < firstS3.timestamp_hours);
});

test('Low-RPN invariant: adjusted risk never exceeds raw RPN for any raw score, including raw 1-4', () => {
  // Test lowest possible raw score (L=1, I=1, RC=1 => Raw RPN = 1)
  const lowRawNode: SystemNodeModel = {
    id: 'test-low-raw',
    code: 'TST-01',
    label: 'Low RPN Test Asset',
    subsystem: 'Test Subsystem',
    stage: CascadeStage.STAGE_1_TRIGGER,
    dominant_control: ControlCategory.TECHNICAL,
    description: 'Test node with minimum raw FMEA score',
    failure_mode: 'Minor sensor flicker',
    tripartite: { technical: 100, formal: 100, informal: 100 },
    fmea: { likelihood: 1, impact: 1, recovery_complexity: 1, policy_investment: 100 },
    psoe_status: PSOELevel.EFFECTIVE,
    er040_severity: ER040Severity.NO_SAFETY_EFFECT_5,
    base_latency_minutes: 5,
    mitigation_recommendation: 'Verify non-inflation invariant',
  };

  const rawRpn = calculateRawRPN(lowRawNode.fmea);
  assert.equal(rawRpn, 1, 'Minimum raw RPN must be exactly 1');

  const adjustedWithMaxControls = computeResidualRPN(lowRawNode);
  assert.ok(
    adjustedWithMaxControls <= rawRpn,
    `Adjusted risk (${adjustedWithMaxControls}) must not exceed raw RPN (${rawRpn}) at raw=1`
  );
  assert.ok(
    adjustedWithMaxControls >= 0.0,
    `Adjusted risk (${adjustedWithMaxControls}) must remain non-negative`
  );
  // Specifically verify absence of the old Math.max(5.0, ...) defect:
  assert.ok(
    adjustedWithMaxControls < 5.0,
    `Adjusted risk must not be clamped to the old arbitrary 5.0 floor`
  );

  // Test across all raw scores in {1, 2, 3, 4, 5, 8, 27, 64, 80, 125}
  for (let l = 1; l <= 5; l++) {
    for (let i = 1; i <= 5; i++) {
      for (let rc = 1; rc <= 5; rc++) {
        const testNode: SystemNodeModel = {
          ...lowRawNode,
          fmea: { likelihood: l, impact: i, recovery_complexity: rc, policy_investment: 50 },
          tripartite: { technical: 50, formal: 50, informal: 50 },
        };
        const raw = calculateRawRPN(testNode.fmea);
        const adjusted = computeResidualRPN(testNode);

        assert.ok(
          adjusted <= raw,
          `Adjusted risk (${adjusted}) exceeded raw score (${raw}) for L=${l}, I=${i}, RC=${rc}`
        );
        assert.ok(
          adjusted >= 0.0,
          `Adjusted risk (${adjusted}) was negative for L=${l}, I=${i}, RC=${rc}`
        );
      }
    }
  }
});

test('Monotonic non-increasing invariant: increasing controls never increases adjusted risk', () => {
  const baseNode: SystemNodeModel = {
    id: 'test-monotonic',
    code: 'TST-02',
    label: 'Monotonicity Test Asset',
    subsystem: 'Test Subsystem',
    stage: CascadeStage.STAGE_2_PROPAGATION,
    dominant_control: ControlCategory.FORMAL,
    description: 'Test node for monotonic control damping',
    failure_mode: 'Inter-subsystem message queue backlog',
    tripartite: { technical: 0, formal: 0, informal: 0 },
    fmea: { likelihood: 4, impact: 4, recovery_complexity: 4, policy_investment: 0 },
    psoe_status: PSOELevel.NOT_PRESENT,
    er040_severity: ER040Severity.MAJOR_3,
    base_latency_minutes: 10,
    mitigation_recommendation: 'Evaluate control monotonicity',
  };

  let previousScore = computeResidualRPN(baseNode);

  // As tripartite controls scale from 0% to 100%, score must strictly decrease or remain equal
  for (let level = 10; level <= 100; level += 10) {
    const upgradedNode: SystemNodeModel = {
      ...baseNode,
      tripartite: { technical: level, formal: level, informal: level },
      fmea: { ...baseNode.fmea, policy_investment: level },
    };
    const currentScore = computeResidualRPN(upgradedNode);

    assert.ok(
      currentScore <= previousScore,
      `Increasing controls to ${level}% increased score from ${previousScore} to ${currentScore}`
    );
    previousScore = currentScore;
  }
});

test('Centralized PSOE maturity evaluation: zero settings yield NOT_PRESENT and thresholds are centralized', () => {
  // Direct function checks
  assert.equal(evaluateControlMaturityPSOE(0), PSOELevel.NOT_PRESENT, 'Zero score must yield NOT_PRESENT');
  assert.equal(evaluateControlMaturityPSOE(-5), PSOELevel.NOT_PRESENT, 'Negative score must yield NOT_PRESENT');
  assert.equal(evaluateControlMaturityPSOE(10), PSOELevel.PRESENT, 'Low positive score yields PRESENT');
  assert.equal(evaluateControlMaturityPSOE(25), PSOELevel.PRESENT, 'Score of 25 yields PRESENT');
  assert.equal(evaluateControlMaturityPSOE(35), PSOELevel.SUITABLE, 'Score of 35 yields SUITABLE');
  assert.equal(evaluateControlMaturityPSOE(55), PSOELevel.OPERATIONAL, 'Score of 55 yields OPERATIONAL');
  assert.equal(evaluateControlMaturityPSOE(75), PSOELevel.EFFECTIVE, 'Score of 75 yields EFFECTIVE');
  assert.equal(evaluateControlMaturityPSOE(100), PSOELevel.EFFECTIVE, 'Score of 100 yields EFFECTIVE');

  // Node evaluation check with zero controls
  const zeroControlNode: SystemNodeModel = {
    id: 'test-zero',
    code: 'TST-03',
    label: 'Zero Control Node',
    subsystem: 'Testing',
    stage: CascadeStage.STAGE_3_BLOCKER,
    dominant_control: ControlCategory.TECHNICAL,
    description: 'Node with completely unmitigated controls',
    failure_mode: 'Total bypass',
    tripartite: { technical: 0, formal: 0, informal: 0 },
    fmea: { likelihood: 5, impact: 5, recovery_complexity: 5, policy_investment: 0 },
    psoe_status: PSOELevel.NOT_PRESENT,
    er040_severity: ER040Severity.CATASTROPHIC_1,
    base_latency_minutes: 0,
    mitigation_recommendation: 'None',
  };

  assert.equal(
    evaluateNodePSOE(zeroControlNode),
    PSOELevel.NOT_PRESENT,
    'Zero-control node must evaluate to NOT_PRESENT, never asserting evidenced presence'
  );
});

test('Result provenance and fallback tracking: responses contain engine metadata and distinguish fallback', () => {
  const scenario = SCENARIO_PRESETS[0];

  // Default browser simulation run
  const clientResult = runDiscreteEventSimulation({
    scenario_id: scenario.id,
    horizon_hours: scenario.horizon_hours,
    baseline_movements_per_hour: scenario.baseline_movements_per_hour,
    trigger_hour: scenario.trigger_hour,
    nodes: scenario.nodes,
    edges: scenario.edges,
  });

  assert.ok(clientResult.provenance, 'Simulation result must include provenance metadata');
  assert.equal(clientResult.provenance.engine, 'browser-typescript');
  assert.equal(clientResult.provenance.is_fallback, false);
  assert.ok(clientResult.provenance.model_version.includes('illustrative'));

  // Server-supplied provenance preservation (e.g., from Python backend or fallback proxy)
  const proxySuppliedResult = runDiscreteEventSimulation({
    scenario_id: scenario.id,
    horizon_hours: scenario.horizon_hours,
    baseline_movements_per_hour: scenario.baseline_movements_per_hour,
    trigger_hour: scenario.trigger_hour,
    nodes: scenario.nodes,
    edges: scenario.edges,
    provenance: {
      engine: 'server-typescript',
      engine_label: 'Node.js Express Fallback Engine',
      model_version: '1.0.0-illustrative',
      input_revision: 4,
      generated_at: new Date().toISOString(),
      is_fallback: true,
      fallback_reason: 'FastAPI service offline',
    },
  });

  assert.equal(proxySuppliedResult.provenance?.engine, 'server-typescript');
  assert.equal(proxySuppliedResult.provenance?.is_fallback, true);
  assert.equal(proxySuppliedResult.provenance?.input_revision, 4);
});

test('Displayed and exported terminology consistency: lost capacity and average control score', () => {
  const scenario = SCENARIO_PRESETS[0];
  const result = runDiscreteEventSimulation({
    scenario_id: scenario.id,
    horizon_hours: scenario.horizon_hours,
    baseline_movements_per_hour: scenario.baseline_movements_per_hour,
    trigger_hour: scenario.trigger_hour,
    nodes: scenario.nodes,
    edges: scenario.edges,
  });

  // Verify KPI fields and non-misleading terminology
  assert.ok(
    'estimated_lost_movement_capacity' in result.summary_kpis,
    'KPIs must include estimated_lost_movement_capacity'
  );
  assert.ok(
    'average_control_score' in result.summary_kpis,
    'KPIs must include average_control_score'
  );
  assert.ok(
    'mean_adjusted_risk' in result.summary_kpis,
    'KPIs must include mean_adjusted_risk'
  );

  // Backward-compatibility aliases should match
  assert.equal(
    result.summary_kpis.estimated_lost_movement_capacity,
    result.summary_kpis.total_disrupted_movements
  );
  assert.equal(
    result.summary_kpis.average_control_score,
    result.summary_kpis.tripartite_balance_index
  );

  // Hourly capacity point consistency
  assert.ok(result.hourly_capacity.length > 0);
  assert.ok(
    'estimated_lost_capacity_cumulative' in result.hourly_capacity[0],
    'Hourly points must include estimated_lost_capacity_cumulative'
  );
  assert.equal(
    result.hourly_capacity[0].estimated_lost_capacity_cumulative,
    result.hourly_capacity[0].delayed_flights_cumulative
  );

  // EASA dossier notification consistency
  const notification = result.easa_notification;
  assert.equal(notification.is_exercise_draft, true, 'Dossier must be flagged as exercise draft');
  assert.ok(
    notification.reporting_applicability.startsWith('Not assessed'),
    'Reporting applicability must be flagged as Not assessed until entered'
  );
  assert.ok(
    notification.awareness_time.startsWith('Not assessed'),
    'Awareness time must be flagged as Not assessed until entered'
  );
  assert.ok(notification.statutory_regulations.length > 0);
  assert.ok(notification.voluntary_standards.length > 0);
  assert.ok(notification.reporting_stages.length === 3);
});
