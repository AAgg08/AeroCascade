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
});
