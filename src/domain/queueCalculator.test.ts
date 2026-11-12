import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateQueueDelay,
  validateQueueInput,
  QueueCalculatorError,
} from './queueCalculator.ts';

describe('AeroCascade Queue Calculator & Flight-Hour Delay Engine', () => {
  it('Acceptance Criterion 1: Hand-worked queue fixture matches exact manual integration', () => {
    // 3 hours, dt = 1.0, Demand = [10, 10, 10], Capacity = [4, 14, 14], Initial Backlog = 0
    // Step 0: [0, 1], d=10, c=4 -> startQ=0, net=10-4=6, endQ=6. Delay = (0+6)/2 * 1 = 3.0 hr
    // Step 1: [1, 2], d=10, c=14 -> startQ=6, net=6+10-14=2, endQ=2. Delay = (6+2)/2 * 1 = 4.0 hr
    // Step 2: [2, 3], d=10, c=14 -> startQ=2, net=2+10-14=-2, endQ=0.
    //         Drain rate = (14-10)/1 = 4 mvmt/hr. Time to drain = 2/4 = 0.5 hr.
    //         Delay = 0.5 * 2 * 0.5 = 0.5 hr.
    // Total Delay = 3.0 + 4.0 + 0.5 = 7.5 flight-hours. Terminal Backlog = 0.
    const result = calculateQueueDelay({
      timeGridHours: [0, 1, 2, 3],
      demand: [10, 10, 10],
      capacity: [4, 14, 14],
      initialBacklog: 0,
    });

    assert.equal(result.steps.length, 3);
    assert.equal(result.steps[0].startBacklogMovements, 0);
    assert.equal(result.steps[0].endBacklogMovements, 6);
    assert.equal(result.steps[0].stepDelayFlightHours, 3.0);

    assert.equal(result.steps[1].startBacklogMovements, 6);
    assert.equal(result.steps[1].endBacklogMovements, 2);
    assert.equal(result.steps[1].stepDelayFlightHours, 4.0);

    assert.equal(result.steps[2].startBacklogMovements, 2);
    assert.equal(result.steps[2].endBacklogMovements, 0);
    assert.equal(result.steps[2].stepDelayFlightHours, 0.5);

    assert.equal(result.totalDelayFlightHours, 7.5);
    assert.equal(result.terminalBacklogMovements, 0);
    assert.equal(result.drainHour, 2.5); // 2.0 + 0.5 hr into step 2
    assert.equal(result.peakBacklogMovements, 6);
  });

  it('Acceptance Criterion 2: Zero delay when demand is fully served by capacity', () => {
    // Demand is consistently <= Capacity, initial backlog = 0
    const result = calculateQueueDelay({
      timeGridHours: [0, 1, 2, 3, 4],
      demand: [48, 48, 48, 48],
      capacity: [48, 50, 48, 52],
      initialBacklog: 0,
    });

    assert.equal(result.totalDelayFlightHours, 0);
    assert.equal(result.terminalBacklogMovements, 0);
    assert.equal(result.peakBacklogMovements, 0);
    assert.equal(result.totalServedMovements, 192);
    assert.equal(result.totalDemandMovements, 192);
    assert.equal(result.drainHour, null);
    for (const step of result.steps) {
      assert.equal(step.stepDelayFlightHours, 0);
      assert.equal(step.endBacklogMovements, 0);
    }
  });

  it('Acceptance Criterion 3: Backlog drains when spare capacity returns and delay stops accumulating', () => {
    // 5-hour horizon: hour 0-1 disruption, hour 1-4 high capacity recovery
    const result = calculateQueueDelay({
      timeGridHours: [0, 1, 2, 3, 4, 5],
      demand: [20, 20, 20, 20, 20],
      capacity: [10, 30, 20, 20, 20], // Step 0 drops 10 mvmt; Step 1 has +10 spare capacity
      initialBacklog: 0,
    });

    // Step 0: [0, 1] d=20, c=10 -> endQ = 10. Delay = (0+10)/2 = 5.0
    // Step 1: [1, 2] d=20, c=30 -> startQ = 10, spare = 30-20 = 10. Drains in 10/10 = 1 hr.
    //         Delay = 0.5 * 10 * 1 = 5.0. endQ = 0.
    // Steps 2, 3, 4: d=20, c=20, startQ=0 -> endQ=0, delay=0.
    assert.equal(result.steps[0].endBacklogMovements, 10);
    assert.equal(result.steps[1].endBacklogMovements, 0);
    assert.equal(result.steps[2].endBacklogMovements, 0);
    assert.equal(result.steps[3].endBacklogMovements, 0);
    assert.equal(result.steps[4].endBacklogMovements, 0);

    assert.equal(result.steps[0].stepDelayFlightHours, 5.0);
    assert.equal(result.steps[1].stepDelayFlightHours, 5.0);
    assert.equal(result.steps[2].stepDelayFlightHours, 0.0);
    assert.equal(result.steps[3].stepDelayFlightHours, 0.0);
    assert.equal(result.steps[4].stepDelayFlightHours, 0.0);

    assert.equal(result.totalDelayFlightHours, 10.0);
    assert.equal(result.terminalBacklogMovements, 0);
    assert.equal(result.drainHour, 2.0);
  });

  it('Acceptance Criterion 4: Terminal backlog remains visible when capacity deficit persists', () => {
    // Severe sustained disruption: capacity never recovers to meet demand
    const result = calculateQueueDelay({
      timeGridHours: [0, 1, 2, 3],
      demand: [10, 10, 10],
      capacity: [4, 4, 4],
      initialBacklog: 0,
    });

    // Step 0: endQ = 6, delay = 3.0
    // Step 1: endQ = 12, delay = 9.0
    // Step 2: endQ = 18, delay = 15.0
    assert.equal(result.terminalBacklogMovements, 18);
    assert.equal(result.totalDelayFlightHours, 27.0);
    assert.equal(result.peakBacklogMovements, 18);
    assert.equal(result.drainHour, null);
  });

  it('Initial backlog is carried forward and properly adds to delay', () => {
    // Starts with 5 movements in queue, balanced capacity
    const result = calculateQueueDelay({
      timeGridHours: [0, 1, 2],
      demand: [10, 10],
      capacity: [10, 10],
      initialBacklog: 5,
    });

    // Step 0: startQ=5, d=10, c=10 -> endQ=5. Delay = 5 * 1 = 5.0 hr
    // Step 1: startQ=5, d=10, c=10 -> endQ=5. Delay = 5 * 1 = 5.0 hr
    assert.equal(result.steps[0].startBacklogMovements, 5);
    assert.equal(result.steps[0].endBacklogMovements, 5);
    assert.equal(result.steps[1].endBacklogMovements, 5);
    assert.equal(result.totalDelayFlightHours, 10.0);
    assert.equal(result.terminalBacklogMovements, 5);
  });

  it('Arbitrary irregular time step sizes are correctly integrated', () => {
    // Time grid: [0, 0.5, 2.0] -> dt1 = 0.5 hr, dt2 = 1.5 hr
    // Step 0: dt=0.5, d=10, c=6 -> endQ = 4. Delay = (0+4)/2 * 0.5 = 1.0 hr
    // Step 1: dt=1.5, d=15, c=19 -> startQ = 4, spare = 19-15 = 4.
    //         Drain rate = 4 / 1.5. Time to drain = 4 / (4/1.5) = 1.5 hr.
    //         Delay = 0.5 * 4 * 1.5 = 3.0 hr. endQ = 0.
    const result = calculateQueueDelay({
      timeGridHours: [0, 0.5, 2.0],
      demand: [10, 15],
      capacity: [6, 19],
      initialBacklog: 0,
    });

    assert.equal(result.steps[0].durationHours, 0.5);
    assert.equal(result.steps[1].durationHours, 1.5);
    assert.equal(result.steps[0].stepDelayFlightHours, 1.0);
    assert.equal(result.steps[1].stepDelayFlightHours, 3.0);
    assert.equal(result.totalDelayFlightHours, 4.0);
    assert.equal(result.terminalBacklogMovements, 0);
  });

  describe('Validation & Safety Bounds', () => {
    it('Rejects non-array or insufficient timeGrid', () => {
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0], demand: [], capacity: [] }),
        /timeGridHours must be an array of at least 2 time points/
      );
    });

    it('Rejects non-monotonic timeGrid', () => {
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 2, 1], demand: [1, 1], capacity: [1, 1] }),
        /strictly monotonically increasing/
      );
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 1, 1], demand: [1, 1], capacity: [1, 1] }),
        /strictly monotonically increasing/
      );
    });

    it('Rejects negative initial backlog', () => {
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 1], demand: [1], capacity: [1], initialBacklog: -5 }),
        /initialBacklog must be a finite non-negative number/
      );
    });

    it('Rejects mismatched array lengths', () => {
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 1, 2], demand: [1], capacity: [1, 1] }),
        /demand array length/
      );
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 1, 2], demand: [1, 1], capacity: [1] }),
        /capacity array length/
      );
    });

    it('Rejects negative demand and capacity values', () => {
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 1], demand: [-10], capacity: [10] }),
        /demand\[0\] must be a finite non-negative number/
      );
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 1], demand: [10], capacity: [-5] }),
        /capacity\[0\] must be a finite non-negative number/
      );
    });

    it('Rejects non-finite values (NaN, Infinity)', () => {
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, NaN], demand: [1], capacity: [1] }),
        /timeGridHours\[1\] must be a finite number/
      );
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 1], demand: [Infinity], capacity: [1] }),
        /demand\[0\] must be a finite non-negative number/
      );
      assert.throws(
        () => calculateQueueDelay({ timeGridHours: [0, 1], demand: [1], capacity: [NaN] }),
        /capacity\[0\] must be a finite non-negative number/
      );
    });
  });
});
