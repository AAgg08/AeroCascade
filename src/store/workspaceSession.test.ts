import test from 'node:test';
import assert from 'node:assert/strict';
import { SCENARIO_PRESETS } from '../domain/scenarios.ts';
import { loadWorkspace, parseWorkspace, serializeWorkspace } from './workspaceSession.ts';

function settings() {
  const scenario = SCENARIO_PRESETS[1];
  const nodes = structuredClone(scenario.nodes);
  nodes[0].tripartite.formal = 91;
  nodes[0].fmea.likelihood = 2;
  return {
    activeScenarioId: scenario.id,
    baselineMovementsPerHour: 72,
    triggerHour: 0,
    costPerDelayedMovement: 0,
    nodes,
  };
}

test('Workspace round trip preserves edits, scenario, and zero-valued inputs', () => {
  const input = settings();
  assert.deepEqual(parseWorkspace(serializeWorkspace(input)), input);
});

test('Workspace restore rejects corrupted, incompatible, or unsafe settings', () => {
  const valid = JSON.parse(serializeWorkspace(settings()));
  const invalid = [
    '{bad json', 'null', JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, activeScenarioId: 'missing' }),
    JSON.stringify({ ...valid, triggerHour: 999 }),
    JSON.stringify({ ...valid, baselineMovementsPerHour: 12.5 }),
    JSON.stringify({ ...valid, costPerDelayedMovement: -10 }),
    JSON.stringify({ ...valid, nodes: [] }),
    JSON.stringify({ ...valid, nodes: [valid.nodes[0], ...valid.nodes.slice(1).map(() => valid.nodes[0])] }),
  ];
  for (const text of invalid) assert.equal(parseWorkspace(text), null);

  valid.nodes[0].tripartite.formal = 101;
  assert.equal(parseWorkspace(JSON.stringify(valid)), null);
  valid.nodes[0].tripartite.formal = 50;
  valid.nodes[0].fmea.impact = 0;
  assert.equal(parseWorkspace(JSON.stringify(valid)), null);
  valid.nodes[0].fmea.impact = 3;
  valid.nodes[0].psoe_status = 'invented';
  assert.equal(parseWorkspace(JSON.stringify(valid)), null);
});

test('Workspace restore uses current preset definitions instead of stored topology or descriptions', () => {
  const saved = JSON.parse(serializeWorkspace(settings()));
  saved.nodes[0].label = 'Injected label';
  saved.nodes[0].repair_duration_hours = 99999;
  const restored = parseWorkspace(JSON.stringify(saved))!;
  assert.equal(restored.nodes[0].label, SCENARIO_PRESETS[1].nodes[0].label);
  assert.equal(restored.nodes[0].repair_duration_hours, SCENARIO_PRESETS[1].nodes[0].repair_duration_hours);
});

test('Disabled storage and corrupt sessions do not prevent workspace startup', () => {
  assert.equal(loadWorkspace(undefined).status, 'unavailable');
  assert.equal(loadWorkspace({ getItem() { throw new Error('Access denied'); } }).status, 'unavailable');
  assert.equal(loadWorkspace({ getItem() { return null; } }).status, 'none');
  assert.equal(loadWorkspace({ getItem() { return 'invalid'; } }).status, 'invalid');
  assert.equal(loadWorkspace({ getItem() { return serializeWorkspace(settings()); } }).status, 'restored');
});
