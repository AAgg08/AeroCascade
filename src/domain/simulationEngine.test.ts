import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRawRPN,
  computeGraphCentrality,
  computeResidualRPN,
  evaluateNodePSOE,
  runDiscreteEventSimulation,
} from './simulationEngine.ts';
import { SCENARIO_PRESETS } from './scenarios.ts';
import { CascadeStage, PSOELevel } from './types.ts';

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
