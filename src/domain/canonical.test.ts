import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIO_PRESETS } from './scenarios.ts';
import {
  presetToCanonicalTopology,
  canonicalTopologyToSimulationInput,
  workspaceSettingsToCanonicalTopology,
  type CanonicalTopology,
} from './canonical.ts';
import { runDiscreteEventSimulation } from './simulationEngine.ts';

test('presetToCanonicalTopology maps presets to versioned canonical representation', () => {
  const preset = SCENARIO_PRESETS[0];
  const canonical = presetToCanonicalTopology(preset);

  assert.equal(canonical.schema_version, '1.0.0');
  assert.equal(canonical.topology_id, preset.id);
  assert.equal(canonical.version, 1);
  assert.equal(canonical.name, preset.title);
  assert.equal(canonical.source_provenance.synthetic_fixture, true);
  assert.equal(canonical.source_provenance.author, 'Aryan Aggarwal & Gurpreet Dhillon');
  assert.equal(canonical.nodes.length, preset.nodes.length);
  assert.equal(canonical.dependencies.length, preset.edges.length);
});

test('canonical adapter enforces explicit provider_node_id to dependent_node_id mapping', () => {
  const preset = SCENARIO_PRESETS[0];
  const canonical = presetToCanonicalTopology(preset);

  for (let i = 0; i < preset.edges.length; i++) {
    const originalEdge = preset.edges[i];
    const canonicalDep = canonical.dependencies[i];

    assert.equal(canonicalDep.provider_node_id, originalEdge.source);
    assert.equal(canonicalDep.dependent_node_id, originalEdge.target);
  }

  const simInput = canonicalTopologyToSimulationInput(canonical);
  assert.equal(simInput.edges.length, canonical.dependencies.length);
  for (let i = 0; i < canonical.dependencies.length; i++) {
    const dep = canonical.dependencies[i];
    const edge = simInput.edges[i];
    assert.equal(edge.source, dep.provider_node_id);
    assert.equal(edge.target, dep.dependent_node_id);
  }
});

test('canonical simulation input produces identical simulation results to direct preset input', () => {
  const preset = SCENARIO_PRESETS[0];
  const canonical = presetToCanonicalTopology(preset);
  const simInput = canonicalTopologyToSimulationInput(canonical);

  const directResult = runDiscreteEventSimulation({
    scenario_id: preset.id,
    horizon_hours: preset.horizon_hours,
    baseline_movements_per_hour: preset.baseline_movements_per_hour,
    trigger_hour: preset.trigger_hour,
    nodes: preset.nodes,
    edges: preset.edges,
  });

  const canonicalResult = runDiscreteEventSimulation(simInput);

  assert.equal(
    canonicalResult.summary_kpis.estimated_lost_movement_capacity,
    directResult.summary_kpis.estimated_lost_movement_capacity
  );
  assert.equal(canonicalResult.hourly_capacity.length, directResult.hourly_capacity.length);
  assert.equal(canonicalResult.events.length, directResult.events.length);
});

test('workspaceSettingsToCanonicalTopology adapts overrides without mutating base preset', () => {
  const preset = SCENARIO_PRESETS[0];
  const originalCapacity = preset.baseline_movements_per_hour;

  const mockSettings = {
    activeScenarioId: preset.id,
    activePolicyId: 'baseline',
    baselineMovementsPerHour: 60,
    triggerHour: 3.5,
    costPerDelayedMovement: 9000,
    nodes: preset.nodes.map((n) => ({ ...n })),
  };

  const wsCanonical = workspaceSettingsToCanonicalTopology(mockSettings, preset, 'ws-custom-1', 2);

  assert.equal(wsCanonical.topology_id, 'ws-custom-1');
  assert.equal(wsCanonical.version, 2);
  assert.equal(wsCanonical.baseline_movements_per_hour, 60);
  assert.equal(wsCanonical.trigger_hour, 3.5);
  assert.equal(wsCanonical.cost_per_delayed_movement, 9000);

  // Original preset remains untouched
  assert.equal(preset.baseline_movements_per_hour, originalCapacity);
});
