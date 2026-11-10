import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { useCascadeStore } from './useCascadeStore.ts';
import { SCENARIO_PRESETS } from '../domain/scenarios.ts';
import type { SimulationResponse } from '../domain/types.ts';

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
});
