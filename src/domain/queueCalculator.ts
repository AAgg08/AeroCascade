/**
 * AeroCascade — Pure Airport Movement Queue & Flight-Hour Delay Calculator
 *
 * Implements an authoritative fluid-flow FIFO queue integration over documented time steps:
 * - Tracks cumulative demand, capacity, and carried-forward backlog (movements).
 * - Continuous-rate piecewise-linear queue drainage within each interval.
 * - Integrates backlog Q(t) over elapsed time to compute modeled flight-hours of delay.
 * - Validates time grid, units, non-negativity, and finite bounds.
 * - Reports within-horizon modeled delay flight-hours and terminal backlog separately.
 *
 * References:
 * - Aggarwal & Dhillon (AIAA Aviation 2026), Section VI.B.
 * - FAA / Eurocontrol Airport Demand-Capacity Delay Integration Standards.
 */

export class QueueCalculatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueCalculatorError';
  }
}

export interface QueueInput {
  /**
   * Monotonically increasing time grid offsets in hours, e.g. [0, 1, 2, ..., 24].
   * Length must be at least 2. Interval count = length - 1.
   */
  timeGridHours: number[];

  /**
   * Movements scheduled/demanded during each time interval [t_{i-1}, t_i].
   * Length must equal timeGridHours.length - 1. All values >= 0.
   */
  demand: number[];

  /**
   * Available service capacity (movements) during each time interval [t_{i-1}, t_i].
   * Length must equal timeGridHours.length - 1. All values >= 0.
   */
  capacity: number[];

  /**
   * Carried-in queue backlog at t_0 (movements). Must be finite and >= 0. Default = 0.
   */
  initialBacklog?: number;
}

export interface QueueStepDetail {
  stepIndex: number;
  startHour: number;
  endHour: number;
  durationHours: number;
  demandMovements: number;
  capacityMovements: number;
  startBacklogMovements: number;
  servedMovements: number;
  endBacklogMovements: number;
  drainFraction: number; // Fraction of step duration before backlog drained to 0 (1.0 if not drained)
  stepDelayFlightHours: number;
  cumulativeDelayFlightHours: number;
}

export interface QueueSimulationOutput {
  timeGridHours: number[];
  steps: QueueStepDetail[];
  totalDemandMovements: number;
  totalCapacityMovements: number;
  totalServedMovements: number;
  initialBacklogMovements: number;
  terminalBacklogMovements: number; // Backlog stuck at end of horizon
  peakBacklogMovements: number;
  totalDelayFlightHours: number; // Integrated flight-hours of delay within horizon
  drainHour: number | null; // First hour at which backlog reached zero after positive queue, or null
}

/**
 * Validates queue inputs according to strict mathematical and physical constraints.
 */
export function validateQueueInput(input: QueueInput): void {
  if (!input) {
    throw new QueueCalculatorError('Queue input must not be null or undefined.');
  }

  // 1. Time Grid Validation
  if (!Array.isArray(input.timeGridHours) || input.timeGridHours.length < 2) {
    throw new QueueCalculatorError('timeGridHours must be an array of at least 2 time points.');
  }

  for (let i = 0; i < input.timeGridHours.length; i++) {
    const t = input.timeGridHours[i];
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      throw new QueueCalculatorError(`timeGridHours[${i}] must be a finite number. Received: ${t}`);
    }
    if (t < 0) {
      throw new QueueCalculatorError(`timeGridHours[${i}] cannot be negative. Received: ${t}`);
    }
    if (i > 0 && t <= input.timeGridHours[i - 1]) {
      throw new QueueCalculatorError(
        `timeGridHours must be strictly monotonically increasing. Point ${i} (${t}) <= point ${i - 1} (${input.timeGridHours[i - 1]}).`
      );
    }
  }

  const expectedSteps = input.timeGridHours.length - 1;

  // 2. Initial Backlog Validation
  const initialQ = input.initialBacklog ?? 0;
  if (typeof initialQ !== 'number' || !Number.isFinite(initialQ) || initialQ < 0) {
    throw new QueueCalculatorError(
      `initialBacklog must be a finite non-negative number. Received: ${initialQ}`
    );
  }

  // 3. Demand Series Validation
  if (!Array.isArray(input.demand) || input.demand.length !== expectedSteps) {
    throw new QueueCalculatorError(
      `demand array length (${input.demand?.length}) must equal time steps (${expectedSteps}).`
    );
  }

  for (let i = 0; i < input.demand.length; i++) {
    const d = input.demand[i];
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) {
      throw new QueueCalculatorError(
        `demand[${i}] must be a finite non-negative number. Received: ${d}`
      );
    }
  }

  // 4. Capacity Series Validation
  if (!Array.isArray(input.capacity) || input.capacity.length !== expectedSteps) {
    throw new QueueCalculatorError(
      `capacity array length (${input.capacity?.length}) must equal time steps (${expectedSteps}).`
    );
  }

  for (let i = 0; i < input.capacity.length; i++) {
    const c = input.capacity[i];
    if (typeof c !== 'number' || !Number.isFinite(c) || c < 0) {
      throw new QueueCalculatorError(
        `capacity[${i}] must be a finite non-negative number. Received: ${c}`
      );
    }
  }
}

/**
 * Pure queue delay simulation.
 * Calculates flight-hours of delay by continuous-time piecewise-linear integration of backlog.
 */
export function calculateQueueDelay(input: QueueInput): QueueSimulationOutput {
  validateQueueInput(input);

  const initialBacklog = input.initialBacklog ?? 0;
  const numSteps = input.timeGridHours.length - 1;

  const steps: QueueStepDetail[] = [];
  let currentBacklog = initialBacklog;
  let cumulativeDelay = 0;
  let totalDemand = 0;
  let totalCapacity = 0;
  let totalServed = 0;
  let peakBacklog = initialBacklog;
  let drainHour: number | null = null;
  let hadBacklog = initialBacklog > 0;

  for (let i = 0; i < numSteps; i++) {
    const tStart = input.timeGridHours[i];
    const tEnd = input.timeGridHours[i + 1];
    const dt = tEnd - tStart;
    const d = input.demand[i];
    const c = input.capacity[i];

    totalDemand += d;
    totalCapacity += c;

    const startQ = currentBacklog;
    const totalRequired = startQ + d;
    const served = Math.min(totalRequired, c);
    const endQ = Math.max(0, totalRequired - served);

    totalServed += served;
    if (startQ > 0 || endQ > 0) {
      hadBacklog = true;
    }
    if (endQ > peakBacklog) {
      peakBacklog = endQ;
    }

    // Delay calculation by exact piecewise-linear continuous integration:
    let stepDelay = 0;
    let drainFrac = 1.0;

    if (totalRequired >= c) {
      // Case A: Queue does not drain to 0 in this interval (or ends >= 0).
      // Backlog transitions linearly from startQ to endQ:
      stepDelay = ((startQ + endQ) / 2) * dt;
    } else if (startQ > 0) {
      // Case B: Surplus capacity (c > d) drains the initial queue startQ to 0 within the step.
      // Net drain rate = (c - d) / dt movements/hour.
      const drainRate = (c - d) / dt;
      const timeToDrain = startQ / drainRate; // timeToDrain <= dt
      drainFrac = Math.min(1.0, Math.max(0.0, timeToDrain / dt));
      // Triangle area: 0.5 * base * height = 0.5 * timeToDrain * startQ:
      stepDelay = 0.5 * startQ * timeToDrain;
    } else {
      // Case C: No queue at start and demand <= capacity -> 0 delay.
      stepDelay = 0;
      drainFrac = 0.0;
    }

    cumulativeDelay += stepDelay;

    // Track when the queue fully drained to 0
    if (hadBacklog && endQ === 0 && drainHour === null) {
      drainHour = tStart + dt * drainFrac;
    }

    steps.push({
      stepIndex: i,
      startHour: tStart,
      endHour: tEnd,
      durationHours: dt,
      demandMovements: d,
      capacityMovements: c,
      startBacklogMovements: startQ,
      servedMovements: served,
      endBacklogMovements: endQ,
      drainFraction: drainFrac,
      stepDelayFlightHours: stepDelay,
      cumulativeDelayFlightHours: cumulativeDelay,
    });

    currentBacklog = endQ;
  }

  return {
    timeGridHours: input.timeGridHours,
    steps,
    totalDemandMovements: totalDemand,
    totalCapacityMovements: totalCapacity,
    totalServedMovements: totalServed,
    initialBacklogMovements: initialBacklog,
    terminalBacklogMovements: currentBacklog,
    peakBacklogMovements: peakBacklog,
    totalDelayFlightHours: cumulativeDelay,
    drainHour,
  };
}
