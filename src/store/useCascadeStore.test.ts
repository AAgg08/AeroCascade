import { serializeWorkspace } from './workspaceSession.ts';
import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useCascadeStore } from './useCascadeStore.ts';
import { SCENARIO_PRESETS } from '../domain/scenarios.ts';
import type { SimulationResponse } from '../domain/types.ts';
import { buildDagreCascadeLayout } from '../utils/dagreLayout.ts';
import { computeGraphCentrality } from '../domain/simulationEngine.ts';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMockResponse(runId: string, revision: number): Partial<SimulationResponse> {
  const initial = structuredClone(useCascadeStore.getState().simulationResult);
  return {
    ...initial,
    run_id: runId,
    scenario_id: 'rtc-optical-asmgcs-spoof',
    summary_kpis: {
      ...initial.summary_kpis,
      estimated_lost_movement_capacity: revision * 10,
    },
    provenance: {
      engine: 'fastapi-python',
      engine_label: 'Python 3.12 (SimPy + NetworkX)',
      model_version: '2.0.0-causal',
      input_revision: revision,
      generated_at: new Date().toISOString(),
      is_fallback: false,
    },
  };
}

const originalFetch = globalThis.fetch;

test('Store Lifecycle & Concurrency Suite', async (t) => {
  t.beforeEach(() => {
    // Reset store state to initial scenario baseline
    useCascadeStore.setState({
      activeScenarioId: SCENARIO_PRESETS[0].id,
      baselineMovementsPerHour: 48,
      costPerDelayedMovement: 7500,
      simulationResult: useCascadeStore.getInitialState().simulationResult,
      triggerHour: 4,
      horizonHours: 24,
      nodes: structuredClone(SCENARIO_PRESETS[0].nodes),
      edges: structuredClone(SCENARIO_PRESETS[0].edges),
      inputRevision: 1,
      latestRequestedRevision: 1,
      pendingRequestsCount: 0,
      isSimulating: false,
      backendError: null,
    });
  });

  t.afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  await t.test('Import replaces settings and prevents an older request from replacing the preview', async () => {
    const preset = SCENARIO_PRESETS[1];
    const nodes = structuredClone(preset.nodes);
    nodes[0].tripartite.formal = 91;
    const original = useCascadeStore.getState().simulationResult;
    const pending = createDeferred<Response>();
    globalThis.fetch = async () => pending.promise;
    const run = useCascadeStore.getState().executeSimulationOnServer();

    assert.equal(useCascadeStore.getState().importWorkspace('invalid'), false);
    assert.equal(useCascadeStore.getState().simulationResult, original);
    const text = serializeWorkspace({
      activeScenarioId: preset.id, nodes, baselineMovementsPerHour: 72,
      triggerHour: 0, costPerDelayedMovement: 0,
    });
    assert.equal(useCascadeStore.getState().importWorkspace(text), true);
    const loaded = useCascadeStore.getState();
    assert.equal(loaded.activeScenarioId, preset.id);
    assert.equal(loaded.baselineMovementsPerHour, 72);
    assert.equal(loaded.triggerHour, 0);
    assert.equal(loaded.costPerDelayedMovement, 0);
    assert.equal(loaded.nodes[0].tripartite.formal, 91);
    assert.equal(loaded.simulationResult.provenance.engine, 'browser-typescript');
    assert.equal(loaded.simulationResult.provenance.input_revision, loaded.inputRevision);

    pending.resolve(Response.json(makeMockResponse('old-run', 1)));
    await run;
    assert.equal(useCascadeStore.getState().simulationResult, loaded.simulationResult);
    assert.equal(useCascadeStore.getState().isSimulating, false);
  });

  await t.test('Edits during in-flight request: older response does not overwrite newer result', async () => {
    const deferred1 = createDeferred<Response>();

    globalThis.fetch = async () => deferred1.promise;

    // Dispatch request at revision 1
    const promise1 = useCascadeStore.getState().executeSimulationOnServer();
    assert.equal(useCascadeStore.getState().isSimulating, true, 'isSimulating must be true while request is in flight');
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 1);

    // User edits an input during request 1, bumping revision to 2
    useCascadeStore.getState().setBaselineMovements(60);
    assert.equal(useCascadeStore.getState().inputRevision, 2, 'Input revision must be bumped to 2');

    // Request 1 completes later with data tagged for rev 1
    const mockData1 = makeMockResponse('run-rev-1', 1);
    deferred1.resolve(
      new Response(JSON.stringify(mockData1), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await promise1;

    // Verify stale response was discarded:
    // simulationResult must NOT be overwritten by run-rev-1
    assert.notEqual(
      useCascadeStore.getState().simulationResult.run_id,
      'run-rev-1',
      'Stale request 1 must not overwrite the store simulationResult'
    );
    // Since request 1 finished and no request 2 was dispatched, isSimulating cleans up to false
    assert.equal(useCascadeStore.getState().isSimulating, false);
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 0);
  });

  await t.test('Older in-flight request resolving FIRST must NOT clear loading state of newer request', async () => {
    const deferred1 = createDeferred<Response>();
    const deferred2 = createDeferred<Response>();

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return callCount === 1 ? deferred1.promise : deferred2.promise;
    };

    // Dispatch request 1 at rev 1
    const promise1 = useCascadeStore.getState().executeSimulationOnServer();
    assert.equal(useCascadeStore.getState().isSimulating, true);
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 1);

    // User edits, bumping revision to 2
    useCascadeStore.getState().setBaselineMovements(55);
    assert.equal(useCascadeStore.getState().inputRevision, 2);

    // Dispatch request 2 at rev 2
    const promise2 = useCascadeStore.getState().executeSimulationOnServer();
    assert.equal(useCascadeStore.getState().isSimulating, true);
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 2);
    assert.equal(useCascadeStore.getState().latestRequestedRevision, 2);

    // Deferred 1 (older request) finishes FIRST
    const mockData1 = makeMockResponse('run-rev-1', 1);
    deferred1.resolve(
      new Response(JSON.stringify(mockData1), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await promise1;

    // CRITICAL: Older request resolving must NOT clear loading state because request 2 is still pending!
    assert.equal(
      useCascadeStore.getState().isSimulating,
      true,
      'Older request must NOT clear isSimulating while newer request is still in flight'
    );
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 1);
    assert.notEqual(
      useCascadeStore.getState().simulationResult.run_id,
      'run-rev-1',
      'Older request must not overwrite result'
    );

    // Now deferred 2 (newer request) finishes
    const mockData2 = makeMockResponse('run-rev-2', 2);
    deferred2.resolve(
      new Response(JSON.stringify(mockData2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await promise2;

    // Now newer request has settled
    assert.equal(useCascadeStore.getState().isSimulating, false, 'isSimulating must be false after all requests finish');
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 0);
    assert.equal(
      useCascadeStore.getState().simulationResult.run_id,
      'run-rev-2',
      'Store must reflect the latest request 2 result'
    );
  });

  await t.test('Overlapping requests: newer request finishing first is not clobbered by later older request', async () => {
    const deferred1 = createDeferred<Response>();
    const deferred2 = createDeferred<Response>();

    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return callCount === 1 ? deferred1.promise : deferred2.promise;
    };

    // Dispatch request 1 at rev 1
    const p1 = useCascadeStore.getState().executeSimulationOnServer();

    // User edits and dispatches request 2 at rev 2
    useCascadeStore.getState().setBaselineMovements(70);
    const p2 = useCascadeStore.getState().executeSimulationOnServer();

    // Request 2 completes FIRST
    const mockData2 = makeMockResponse('run-rev-2', 2);
    deferred2.resolve(
      new Response(JSON.stringify(mockData2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await p2;

    assert.equal(useCascadeStore.getState().simulationResult.run_id, 'run-rev-2');

    // Now Request 1 completes LATER
    const mockData1 = makeMockResponse('run-rev-1', 1);
    deferred1.resolve(
      new Response(JSON.stringify(mockData1), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await p1;

    // Result must STILL be run-rev-2!
    assert.equal(
      useCascadeStore.getState().simulationResult.run_id,
      'run-rev-2',
      'Later arriving older request must not clobber newer result'
    );
    assert.equal(useCascadeStore.getState().isSimulating, false);
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 0);
  });

  await t.test('Error handling and loading-state cleanup', async () => {
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: 'Authoritative Python simulation engine is offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await useCascadeStore.getState().executeSimulationOnServer();

    assert.equal(useCascadeStore.getState().isSimulating, false, 'isSimulating must be cleared after error');
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 0);
    assert.ok(
      useCascadeStore.getState().backendError?.includes('offline'),
      'Backend error state must be recorded'
    );

    // Clear error
    useCascadeStore.getState().clearBackendError();
    assert.equal(useCascadeStore.getState().backendError, null);
  });

  await t.test('Structured validation errors preserve the last result and clear the loading state', async () => {
    const previous = useCascadeStore.getState().simulationResult;
    globalThis.fetch = async () => Response.json({
      error: [{ loc: ['body', 'trigger_hour'], msg: 'Input should be a valid integer' }],
    }, { status: 422 });

    await useCascadeStore.getState().executeSimulationOnServer();

    const state = useCascadeStore.getState();
    assert.equal(state.backendError, 'Check the simulation inputs. trigger_hour: Input should be a valid integer');
    assert.equal(state.simulationResult, previous);
    assert.equal(state.pendingRequestsCount, 0);
    assert.equal(state.isSimulating, false);
  });

  await t.test('Empty or incomplete success responses do not lock the run controls', async () => {
    const previous = useCascadeStore.getState().simulationResult;
    for (const body of [null, {}]) {
      globalThis.fetch = async () => Response.json(body);
      await useCascadeStore.getState().executeSimulationOnServer();
      const state = useCascadeStore.getState();
      assert.match(state.backendError ?? '', /incomplete results/);
      assert.equal(state.simulationResult, previous);
      assert.equal(state.pendingRequestsCount, 0);
      assert.equal(state.isSimulating, false);
    }
  });

  await t.test('Input validation rejects empty node list without dispatching network request', async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response('{}');
    };

    useCascadeStore.setState({ nodes: [] });

    await useCascadeStore.getState().executeSimulationOnServer();

    assert.equal(fetchCalled, false, 'Network fetch should not be dispatched for empty node list');
    assert.equal(useCascadeStore.getState().isSimulating, false);
    assert.ok(
      useCascadeStore.getState().backendError?.includes('empty'),
      'Error message must indicate empty node list'
    );
  });

  await t.test('Monte Carlo stochastic run: dispatches replicates: 30 and saves percentile arrays', async () => {
    let capturedBody: any = null;
    const mockStochasticResponse = {
      ...makeMockResponse('run-mc-30', 1),
      replicates: 30,
      capacity_median: [48, 48, 48, 48, 36, 24, 20, 24, 36, 48],
      capacity_5th: [48, 48, 48, 48, 30, 16, 12, 16, 30, 48],
      capacity_95th: [48, 48, 48, 48, 42, 32, 28, 32, 42, 48],
      stochastic_capacity: Array.from({ length: 10 }, (_, h) => ({
        hour: h,
        time_label: `T+0${h}:00`,
        baseline_capacity: 48,
        capacity_median: h < 4 ? 48 : 36,
        capacity_5th: h < 4 ? 48 : 24,
        capacity_95th: h < 4 ? 48 : 42,
      })),
      hourly_capacity: Array.from({ length: 10 }, (_, h) => ({
        hour: h,
        time_label: `T+0${h}:00`,
        baseline_capacity: 48,
        unmitigated_capacity: 20,
        technical_only_capacity: 25,
        tripartite_mitigated_capacity: h < 4 ? 48 : 36,
        capacity_median: h < 4 ? 48 : 36,
        capacity_5th: h < 4 ? 48 : 24,
        capacity_95th: h < 4 ? 48 : 42,
        active_stage: 'STAGE_1_TRIGGER',
        estimated_lost_capacity_cumulative: h * 5,
        delayed_flights_cumulative: h * 5,
      })),
    };

    globalThis.fetch = async (_url: any, init?: any) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(mockStochasticResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await useCascadeStore.getState().executeSimulationOnServer({ replicates: 30 });

    assert.equal(capturedBody?.replicates, 30, 'Request body must pass replicates: 30');
    const result = useCascadeStore.getState().simulationResult;
    assert.equal(result.replicates, 30, 'Result in store must have replicates: 30');
    assert.equal(result.capacity_median?.length, 10, 'Result must contain median capacity array');
    assert.equal(result.capacity_5th?.length, 10, 'Result must contain 5th percentile array');
    assert.equal(result.capacity_95th?.length, 10, 'Result must contain 95th percentile array');
    assert.equal(result.hourly_capacity[4].capacity_5th, 24);
    assert.equal(result.hourly_capacity[4].capacity_median, 36);
    assert.equal(result.hourly_capacity[4].capacity_95th, 42);
    assert.ok(
      useCascadeStore.getState().lastSyncedAt.includes('Monte Carlo (30 Reps)'),
      'lastSyncedAt should reflect Monte Carlo run'
    );
  });

  await t.test('Bug 1: Preset run action sends explicit initiating events at trigger hour and at hour zero', async () => {
    let capturedBody: any = null;
    globalThis.fetch = async (_url: any, init?: any) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify(makeMockResponse('run-trigger-4', 1)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    // Case A: trigger_hour = 4
    useCascadeStore.setState({ triggerHour: 4 });
    await useCascadeStore.getState().executeSimulationOnServer();
    assert.ok(Array.isArray(capturedBody?.initiating_events), 'initiating_events array must be present');
    assert.ok(capturedBody.initiating_events.length > 0, 'Stage 1 trigger nodes must be mapped to initiating_events');
    assert.equal(capturedBody.initiating_events[0].event_time_hours, 4, 'Event time must match triggerHour 4');

    // Case B: trigger_hour = 0
    useCascadeStore.getState().setTriggerHour(0);
    assert.equal(useCascadeStore.getState().triggerHour, 0);
    await useCascadeStore.getState().executeSimulationOnServer();
    assert.ok(Array.isArray(capturedBody?.initiating_events), 'initiating_events array must be present at hour 0');
    assert.ok(capturedBody.initiating_events.length > 0);
    assert.equal(capturedBody.initiating_events[0].event_time_hours, 0, 'Event time must match triggerHour 0');
  });

  await t.test('Regression Bug 4: Out-of-order resolution at same revision does not overwrite newer run and clears loading', async () => {
    const deferredA = createDeferred<Response>();
    const deferredB = createDeferred<Response>();

    let dispatchCount = 0;
    globalThis.fetch = async () => {
      dispatchCount += 1;
      return dispatchCount === 1 ? deferredA.promise : deferredB.promise;
    };

    // Dispatch Run A
    const promiseA = useCascadeStore.getState().executeSimulationOnServer();
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 1);
    assert.equal(useCascadeStore.getState().isSimulating, true);

    // Dispatch Run B at same input revision
    const promiseB = useCascadeStore.getState().executeSimulationOnServer();
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 2);
    assert.equal(useCascadeStore.getState().isSimulating, true);

    // Run B resolves FIRST
    const mockDataB = makeMockResponse('run-b-newer', 1);
    deferredB.resolve(
      new Response(JSON.stringify(mockDataB), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await promiseB;

    assert.equal(useCascadeStore.getState().simulationResult.run_id, 'run-b-newer');
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 1);
    assert.equal(useCascadeStore.getState().isSimulating, true, 'isSimulating must remain true while Run A is pending');

    // Run A resolves SECOND (out-of-order)
    const mockDataA = makeMockResponse('run-a-older', 1);
    deferredA.resolve(
      new Response(JSON.stringify(mockDataA), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await promiseA;

    // Run A must NOT overwrite Run B's result!
    assert.equal(
      useCascadeStore.getState().simulationResult.run_id,
      'run-b-newer',
      'Older Run A must not overwrite newer Run B even at the same input revision'
    );
    assert.equal(useCascadeStore.getState().pendingRequestsCount, 0, 'Pending requests count must be exactly 0');
    assert.equal(useCascadeStore.getState().isSimulating, false, 'isSimulating must be false after all dispatches settle');
  });

  await t.test('Input modifications mark state as stale and preserve previous run results until re-simulated', async () => {
    const original = useCascadeStore.getState();
    assert.equal(original.simulationResult.input_snapshot?.trigger_hour, original.triggerHour);
    assert.equal(original.simulationResult.hourly_capacity[0]?.baseline_capacity, original.baselineMovementsPerHour);
    original.setTriggerHour(original.triggerHour === 0 ? 1 : 0);
    original.setBaselineMovements(original.baselineMovementsPerHour === 48 ? 60 : 48);
    const edited = useCascadeStore.getState();
    assert.notEqual(edited.triggerHour, original.triggerHour);
    assert.notEqual(edited.baselineMovementsPerHour, original.baselineMovementsPerHour);
    assert.equal(edited.simulationResult.input_snapshot?.trigger_hour, original.triggerHour);
    assert.equal(edited.simulationResult.hourly_capacity[0]?.baseline_capacity, original.baselineMovementsPerHour);

    const initialRev = useCascadeStore.getState().inputRevision;
    const initialSimRev = useCascadeStore.getState().simulationResult.provenance?.input_revision ?? 0;
    assert.ok(initialRev > initialSimRev, 'Editing the trigger and capacity makes the previous result stale');

    // Operator edits a node slider
    const firstNodeId = useCascadeStore.getState().nodes[0].id;
    useCascadeStore.getState().updateNodeTripartite(firstNodeId, { technical: 95 });

    const updatedRev = useCascadeStore.getState().inputRevision;
    const currentSimRev = useCascadeStore.getState().simulationResult.provenance?.input_revision ?? 0;

    assert.equal(updatedRev, initialRev + 1, 'Input revision must increment');
    assert.equal(currentSimRev, initialSimRev, 'Simulation result must preserve previous run revision');
    assert.ok(updatedRev > currentSimRev, 'State is detected as stale: inputRevision > simulationResult revision');

    // Operator runs simulation to update
    globalThis.fetch = async () => {
      return new Response(JSON.stringify(makeMockResponse('run-rev-updated', updatedRev)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await useCascadeStore.getState().executeSimulationOnServer();

    const afterRunRev = useCascadeStore.getState().inputRevision;
    const afterRunSimRev = useCascadeStore.getState().simulationResult.provenance?.input_revision ?? 0;

    assert.equal(afterRunRev, afterRunSimRev, 'After simulation, result revision matches input revision (fresh)');
    assert.equal(useCascadeStore.getState().simulationResult.run_id, 'run-rev-updated');
  });

  await t.test('Hero metrics and badges update when scenario or run changes', async () => {
    // 1. Initial State: Scenario I (48 mvmt/hr)
    assert.equal(useCascadeStore.getState().activeScenarioId, 'rtc-optical-asmgcs-spoof');
    assert.equal(useCascadeStore.getState().baselineMovementsPerHour, 48);
    const initialKpis = useCascadeStore.getState().simulationResult.summary_kpis;
    assert.ok(initialKpis.min_hourly_capacity > 0);

    // 2. Change Scenario to Scenario II (60 mvmt/hr)
    useCascadeStore.getState().selectScenario('swim-amhs-flight-object-lockout');
    const scenario2State = useCascadeStore.getState();
    assert.equal(scenario2State.activeScenarioId, 'swim-amhs-flight-object-lockout');
    assert.equal(scenario2State.baselineMovementsPerHour, 60, 'Baseline movements must update to 60 for Scenario II');
    assert.equal(scenario2State.triggerHour, 3, 'Trigger hour must update to 3 for Scenario II');

    // Check that hero KPIs have updated for the new scenario
    const scenario2Kpis = scenario2State.simulationResult.summary_kpis;
    assert.ok(scenario2Kpis, 'KPIs must exist for Scenario II');
    assert.equal(
      scenario2State.inputRevision,
      scenario2State.simulationResult.provenance?.input_revision,
      'Scenario switch immediately produces fresh client preview (not stale)'
    );

    // 3. Run Deterministic Simulation on Server
    const mockAuthResponse: Partial<SimulationResponse> = {
      ...structuredClone(scenario2State.simulationResult),
      run_id: 'auth-run-scenario-2',
      summary_kpis: {
        ...scenario2Kpis,
        min_hourly_capacity: 35.0,
        total_disrupted_movements: 120,
      },
      provenance: {
        engine: 'fastapi-python',
        engine_label: 'FastAPI + SimPy (Authoritative Engine)',
        model_version: '2.0.0-causal',
        input_revision: scenario2State.inputRevision,
        generated_at: new Date().toISOString(),
        is_fallback: false,
      },
    };

    globalThis.fetch = async () => {
      return new Response(JSON.stringify(mockAuthResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await useCascadeStore.getState().executeSimulationOnServer();
    const afterDeterministicState = useCascadeStore.getState();
    assert.equal(
      afterDeterministicState.simulationResult.provenance?.engine,
      'fastapi-python',
      'Engine badge must reflect authoritative FastAPI engine'
    );
    assert.equal(
      afterDeterministicState.simulationResult.summary_kpis.min_hourly_capacity,
      35.0,
      'Hero metric min capacity must update to authoritative result'
    );
    assert.equal(
      afterDeterministicState.simulationResult.summary_kpis.total_disrupted_movements,
      120,
      'Hero metric disrupted movements must update'
    );

    // 4. Run Monte Carlo Simulation (30 Replicates)
    const mockMonteCarloResponse: Partial<SimulationResponse> = {
      ...mockAuthResponse,
      run_id: 'mc-run-scenario-2',
      replicates: 30,
      hourly_capacity: scenario2State.simulationResult.hourly_capacity.map((pt) => ({
        ...pt,
        capacity_5th: (pt.tripartite_mitigated_capacity ?? 30) - 4,
        capacity_median: pt.tripartite_mitigated_capacity ?? 30,
        capacity_95th: (pt.tripartite_mitigated_capacity ?? 30) + 3,
      })),
    };

    globalThis.fetch = async () => {
      return new Response(JSON.stringify(mockMonteCarloResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    await useCascadeStore.getState().executeSimulationOnServer({ replicates: 30 });
    const afterMonteCarloState = useCascadeStore.getState();
    assert.equal(
      afterMonteCarloState.simulationResult.replicates,
      30,
      'Monte Carlo replicates badge must reflect 30 replicates'
    );
    assert.ok(
      afterMonteCarloState.simulationResult.hourly_capacity[0].capacity_5th !== undefined,
      '5th percentile band must be present for Monte Carlo run'
    );
    assert.ok(
      afterMonteCarloState.simulationResult.hourly_capacity[0].capacity_95th !== undefined,
      '95th percentile band must be present for Monte Carlo run'
    );
  });

  await t.test('Disruption Cost Multiplier: configurable state defaults to 7500 and updates dynamically', async () => {
    const store = useCascadeStore.getState();
    assert.equal(store.costPerDelayedMovement, 7500, 'costPerDelayedMovement must default to 7500');

    // Baseline calculation check: 145 movements * 7500 = $1,087,500 ≈ $1.1M
    const lostMovements = 145;
    const initialDisruptionMillions = ((lostMovements * store.costPerDelayedMovement) / 1_000_000).toFixed(1);
    assert.equal(initialDisruptionMillions, '1.1', '145 lost movements at $7,500 must equal $1.1M est. disruption');

    // Update cost multiplier to 12,000
    const prevRev = store.inputRevision;
    useCascadeStore.getState().setCostPerDelayedMovement(12000);
    const updatedStore = useCascadeStore.getState();
    assert.equal(updatedStore.costPerDelayedMovement, 12000, 'costPerDelayedMovement must update to 12000');
    assert.equal(
      updatedStore.inputRevision,
      prevRev,
      'Cost multiplier change is analytical telemetry and must not invalidate simulation input revision'
    );

    const updatedDisruptionMillions = ((lostMovements * updatedStore.costPerDelayedMovement) / 1_000_000).toFixed(1);
    assert.equal(updatedDisruptionMillions, '1.7', '145 lost movements at $12,000 must recalculate to $1.7M est. disruption');

    // Negative values must be clamped to 0
    useCascadeStore.getState().setCostPerDelayedMovement(-500);
    assert.equal(useCascadeStore.getState().costPerDelayedMovement, 0, 'Negative values must be clamped to 0');
  });

  await t.test('Dagre layout spacing: columns expanded (+40px) and vertical nodes spaced (+25px)', async () => {
    const scenario = SCENARIO_PRESETS[0];
    const centralityMap = Object.fromEntries(
      computeGraphCentrality(scenario.nodes, scenario.edges).map((metric) => [metric.node_id, metric]),
    );
    const { flowNodes, flowEdges } = buildDagreCascadeLayout(scenario.nodes, scenario.edges, centralityMap, null);

    // Find Stage 1, Stage 2, and Stage 3 nodes
    const stage1Nodes = flowNodes.filter((n) => n.data.nodeModel.stage === 'STAGE_1_TRIGGER');
    const stage2Nodes = flowNodes.filter((n) => n.data.nodeModel.stage === 'STAGE_2_PROPAGATION');
    const stage3Nodes = flowNodes.filter((n) => n.data.nodeModel.stage === 'STAGE_3_BLOCKER');

    assert.ok(stage1Nodes.length > 0 && stage2Nodes.length > 0 && stage3Nodes.length > 0);

    // Column horizontal positions
    assert.equal(stage1Nodes[0].position.x, 24, 'Stage 1 X coordinate must be 24');
    assert.equal(stage2Nodes[0].position.x, 514, 'Stage 2 X coordinate must be 514 (expanded horizontal spacing)');
    assert.equal(stage3Nodes[0].position.x, 1004, 'Stage 3 X coordinate must be 1004 (expanded horizontal spacing)');

    // Column gap: 514 - (24 + 310) = 180px gap between columns
    const colGap = stage2Nodes[0].position.x - (stage1Nodes[0].position.x + 310);
    assert.equal(colGap, 180, 'Horizontal gap between Stage 1 and Stage 2 columns must be 180px');

    // Vertical spacing between consecutive nodes in same column: (NODE_HEIGHT + 49) = 176 + 49 = 225
    if (stage2Nodes.length > 1) {
      const sortedY = stage2Nodes.map((n) => n.position.y).sort((a, b) => a - b);
      const verticalGap = sortedY[1] - (sortedY[0] + 176);
      assert.equal(verticalGap, 49, 'Vertical gap between consecutive cards must be 49px (24px + 25px)');
    }

    // Edge label styling: light-mode pill with border and high contrast
    assert.ok(flowEdges.length > 0);
    const firstEdge = flowEdges[0];
    assert.equal(firstEdge.labelBgStyle?.fill, '#FFFFFF', 'Edge label background must be white');
    assert.equal(firstEdge.labelBgBorderRadius, 6, 'Edge label background must have 6px border radius');
  });

  await t.test('Topology Repository & Versioning Suite', async () => {
    // 1. fetchTopologies
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/topologies')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            topologies: [
              {
                id: 'rtc-optical-asmgcs-spoof',
                name: 'Remote Tower Optical ASMGCS Spoof',
                description: 'Test description',
                current_version: 1,
                updated_at: new Date().toISOString(),
                created_at: new Date().toISOString(),
              },
            ],
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    await useCascadeStore.getState().fetchTopologies();
    assert.equal(useCascadeStore.getState().topologies.length, 1);
    assert.equal(useCascadeStore.getState().topologies[0].id, 'rtc-optical-asmgcs-spoof');

    // 2. saveNewTopologyVersion - success
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/versions') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        assert.equal(body.expected_version, 1);
        assert.equal(body.change_summary, 'Updated failover configuration');
        return {
          ok: true,
          status: 201,
          json: async () => ({
            version: 2,
            change_summary: body.change_summary,
            created_at: new Date().toISOString(),
          }),
        } as Response;
      }
      if (urlStr.includes('/api/topologies')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ topologies: [] }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    const saveOk = await useCascadeStore.getState().saveNewTopologyVersion('Updated failover configuration');
    assert.equal(saveOk, true);
    assert.equal(useCascadeStore.getState().currentTopologyVersion, 2);
    assert.ok(useCascadeStore.getState().topologySuccessMessage?.includes('v2'));

    // 3. saveNewTopologyVersion - optimistic lock stale write conflict (HTTP 409)
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/versions') && init?.method === 'POST') {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            detail: 'Stale version conflict: expected version 2 but repository is at version 3.',
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    const staleSaveOk = await useCascadeStore.getState().saveNewTopologyVersion('Conflicting change');
    assert.equal(staleSaveOk, false);
    assert.ok(
      useCascadeStore.getState().topologyConflictError?.includes('Conflict (HTTP 409)'),
      'Conflict error must clearly report optimistic locking rejection'
    );

    // 4. cloneTopology
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/clone') && init?.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            summary: {
              id: 'topo-clone-999',
              name: 'Cloned Scenario Test',
              description: 'Cloned test',
              current_version: 1,
              updated_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              cloned_from_id: 'rtc-optical-asmgcs-spoof',
              cloned_from_version: 2,
            },
            canonical: {
              schema_version: '1.0.0',
              topology_id: 'topo-clone-999',
              name: 'Cloned Scenario Test',
              description: 'Cloned test',
              version: 1,
              aerodrome_profile: 'EHAM',
              baseline_movements_per_hour: 48,
              trigger_hour: 4,
              horizon_hours: 24,
              cost_per_delayed_movement: 7500,
              source_provenance: {
                author: 'Test',
                citation: 'Test',
                source_document: 'Test',
                synthetic_fixture: true,
                origin_scenario_id: 'rtc-optical-asmgcs-spoof',
                cloned_from_id: 'rtc-optical-asmgcs-spoof',
                cloned_from_version: 2,
                created_at: new Date().toISOString(),
              },
              nodes: structuredClone(SCENARIO_PRESETS[0].nodes),
              dependencies: SCENARIO_PRESETS[0].edges.map((e) => ({
                id: e.id,
                provider_node_id: e.source,
                dependent_node_id: e.target,
                coupling_weight: e.coupling_weight,
                propagation_mechanism: e.propagation_mechanism,
                protocol_layer: 'IP/Ethernet',
              })),
            },
          }),
        } as Response;
      }
      if (urlStr.includes('/api/topologies/topo-clone-999')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schema_version: '1.0.0',
            topology_id: 'topo-clone-999',
            name: 'Cloned Scenario Test',
            description: 'Cloned test',
            version: 1,
            aerodrome_profile: 'EHAM',
            baseline_movements_per_hour: 48,
            trigger_hour: 4,
            horizon_hours: 24,
            cost_per_delayed_movement: 7500,
            nodes: structuredClone(SCENARIO_PRESETS[0].nodes),
            dependencies: SCENARIO_PRESETS[0].edges.map((e) => ({
              id: e.id,
              provider_node_id: e.source,
              dependent_node_id: e.target,
              coupling_weight: e.coupling_weight,
              propagation_mechanism: e.propagation_mechanism,
              protocol_layer: 'IP/Ethernet',
            })),
          }),
        } as Response;
      }
      if (urlStr.includes('/api/topologies')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ topologies: [] }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    const cloneOk = await useCascadeStore.getState().cloneTopology('Cloned Scenario Test');
    assert.equal(cloneOk, true);
    assert.equal(useCascadeStore.getState().currentTopologyId, 'topo-clone-999');
    assert.equal(useCascadeStore.getState().currentTopologyVersion, 1);

    // 5. uploadImportFile (Server-Side Import Preview)
    const mockFile = new File(['test,csv,data'], 'synthetic_vendors.csv', { type: 'text/csv' });
    globalThis.fetch = (async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/import/preview')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valid: true,
            file_name: 'synthetic_vendors.csv',
            file_type: 'csv',
            summary: {
              node_count: 5,
              edge_count: 4,
              error_count: 0,
              warning_count: 1,
              cycle_count: 0,
              provisional_id_count: 0,
              deduplicated_edge_count: 1,
            },
            errors: [],
            warnings: [
              {
                row: 2,
                column: 'Upstream IDs',
                message: 'Reconciled reciprocal declaration',
                severity: 'WARNING',
              },
            ],
            cycles: [],
            preview_topology: {
              schema_version: '1.0.0',
              topology_id: 'topo-imported-001',
              name: 'Synthetic Airport Import',
              description: 'Imported test',
              version: 1,
              aerodrome_profile: 'EHAM',
              baseline_movements_per_hour: 48,
              trigger_hour: 4,
              horizon_hours: 24,
              cost_per_delayed_movement: 7500,
              nodes: structuredClone(SCENARIO_PRESETS[0].nodes),
              dependencies: SCENARIO_PRESETS[0].edges.map((e) => ({
                id: e.id,
                provider_node_id: e.source,
                dependent_node_id: e.target,
                coupling_weight: e.coupling_weight,
                propagation_mechanism: e.propagation_mechanism,
                protocol_layer: 'IP/Ethernet',
              })),
            },
          }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    const uploadOk = await useCascadeStore.getState().uploadImportFile(mockFile);
    assert.equal(uploadOk, true);
    assert.equal(useCascadeStore.getState().importPreview?.valid, true);
    assert.equal(useCascadeStore.getState().importPreview?.summary.node_count, 5);
    assert.equal(useCascadeStore.getState().importPreview?.summary.deduplicated_edge_count, 1);

    // 6. saveImportedTopology
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes('/api/import/save') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        assert.equal(body.name, 'Final Airport Hub');
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: 'topo-imported-001',
            name: body.name,
            current_version: 1,
          }),
        } as Response;
      }
      if (urlStr.includes('/api/topologies/topo-imported-001')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            schema_version: '1.0.0',
            topology_id: 'topo-imported-001',
            name: 'Final Airport Hub',
            description: 'Test',
            version: 1,
            aerodrome_profile: 'EHAM',
            baseline_movements_per_hour: 48,
            trigger_hour: 4,
            horizon_hours: 24,
            cost_per_delayed_movement: 7500,
            nodes: structuredClone(SCENARIO_PRESETS[0].nodes),
            dependencies: [],
          }),
        } as Response;
      }
      if (urlStr.includes('/api/topologies')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ topologies: [] }),
        } as Response;
      }
      return { ok: false, status: 404 } as Response;
    }) as typeof fetch;

    const saveImportOk = await useCascadeStore.getState().saveImportedTopology('Final Airport Hub');
    assert.equal(saveImportOk, true);
    assert.equal(useCascadeStore.getState().currentTopologyId, 'topo-imported-001');
    assert.equal(useCascadeStore.getState().importPreview, null);

    // 7. clearImportPreview (cancel with no save)
    useCascadeStore.setState({
      importPreview: {
        valid: true,
        file_name: 'cancel.xlsx',
        file_type: 'xlsx',
        summary: {
          node_count: 1,
          edge_count: 0,
          error_count: 0,
          warning_count: 0,
          cycle_count: 0,
          provisional_id_count: 0,
          deduplicated_edge_count: 0,
        },
        errors: [],
        warnings: [],
        cycles: [],
      },
      importError: 'Old error',
    });
    useCascadeStore.getState().clearImportPreview();
    assert.equal(useCascadeStore.getState().importPreview, null);
    assert.equal(useCascadeStore.getState().importError, null);
  });
});
