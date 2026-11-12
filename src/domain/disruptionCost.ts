/**
 * AeroCascade — Disruption Cost & Comparative Delay Economics Engine
 *
 * Connects pure queue-integrated flight-hours of delay with customer-entered financial assumptions:
 * - Contrasts unmitigated collapse vs mitigated recovery series.
 * - Enforces strict provenance and run matching (horizon, demand, model version).
 * - Leaves dollar outputs blank until customer enters cost per flight-hour.
 * - Computes signed savings delta (Unmitigated Cost - Mitigated Cost); negative savings remain negative.
 * - Separately computes and displays Net Benefit (Savings - Implementation Cost).
 * - Distinguishes within-horizon modeled disruption cost from terminal backlog.
 * - Keeps financial comparison deterministic when engine only provides marginal percentile curves.
 */

import {
  calculateQueueDelay,
  type QueueSimulationOutput,
} from './queueCalculator.ts';
import type { HourlyCapacityPoint, ResultProvenance } from './types.ts';

export class DisruptionComparisonMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DisruptionComparisonMismatchError';
  }
}

export interface DisruptionFinancialAssumptions {
  currency: string; // e.g. "USD", "EUR", "GBP"
  costPerFlightHour: number | null; // Customer-entered cost per flight-hour (>= 0), or null if blank
  implementationCost: number | null; // Optional customer-entered mitigation investment (>= 0), or null
  initialBacklogMovements: number; // Initial queue backlog (movements), default = 0
}

export interface SeriesDisruptionSummary {
  seriesKey: 'unmitigated' | 'tripartite_mitigated' | 'technical_only';
  label: string;
  totalDelayFlightHours: number;
  terminalBacklogMovements: number;
  peakBacklogMovements: number;
  drainHour: number | null;
  modeledDisruptionCost: number | null; // null if costPerFlightHour is blank
  formattedCost: string; // e.g. "$120,000", "€85,000" or "—" if blank
  queueDetails: QueueSimulationOutput;
}

export interface ProvenanceMatchInfo {
  matched: boolean;
  horizonHours: number;
  baselineDemandPerHour: number;
  modelVersion: string;
  engine: string;
  isStochastic: boolean;
  stochasticNote?: string;
}

export interface DisruptionCostComparison {
  provenance: ProvenanceMatchInfo;
  assumptions: DisruptionFinancialAssumptions;
  unmitigated: SeriesDisruptionSummary;
  mitigated: SeriesDisruptionSummary;

  // Signed Deltas: Unmitigated minus Mitigated
  deltaDelayFlightHours: number; // Delay saved (positive = benefit, negative = worse delay)
  deltaTerminalBacklogMovements: number; // Fewer stuck flights
  deltaDisruptionCost: number | null; // Financial savings (positive = savings, negative = loss)
  netBenefit: number | null; // Savings minus implementation cost (null if cost or rate blank)

  // Formatted display strings
  formattedDeltaCost: string;
  formattedNetBenefit: string;
  formattedTerminalBacklogNote: string;
}

/**
 * Validates that two simulation runs or series share identical experimental conditions:
 * - Horizon hours
 * - Scheduled demand (movements per hour)
 * - Time series point count
 * - Model version
 */
export function validateRunProvenanceMatch(
  runA: {
    horizon_hours?: number;
    baseline_movements_per_hour?: number;
    hourly_capacity: HourlyCapacityPoint[];
    model_version?: string;
    schema_version?: string;
    provenance?: ResultProvenance;
  },
  runB: {
    horizon_hours?: number;
    baseline_movements_per_hour?: number;
    hourly_capacity: HourlyCapacityPoint[];
    model_version?: string;
    schema_version?: string;
    provenance?: ResultProvenance;
  }
): void {
  if (!runA || !runB) {
    throw new DisruptionComparisonMismatchError('Both runs must be defined for comparison.');
  }

  const hA = runA.horizon_hours ?? runA.hourly_capacity.length;
  const hB = runB.horizon_hours ?? runB.hourly_capacity.length;
  if (hA !== hB) {
    throw new DisruptionComparisonMismatchError(
      `Mismatched simulation horizon: Run A has ${hA}h, Run B has ${hB}h. Cannot compare costs across different horizons.`
    );
  }

  const ptsA = runA.hourly_capacity?.length ?? 0;
  const ptsB = runB.hourly_capacity?.length ?? 0;
  if (ptsA !== ptsB || ptsA < 2) {
    throw new DisruptionComparisonMismatchError(
      `Mismatched time grid length: Run A has ${ptsA} points, Run B has ${ptsB} points.`
    );
  }

  const demA = runA.baseline_movements_per_hour ?? runA.hourly_capacity[0]?.baseline_capacity;
  const demB = runB.baseline_movements_per_hour ?? runB.hourly_capacity[0]?.baseline_capacity;
  if (demA !== demB) {
    throw new DisruptionComparisonMismatchError(
      `Mismatched baseline demand: Run A requires ${demA} mvmt/h, Run B requires ${demB} mvmt/h. Disruption cost requires matched demand.`
    );
  }

  const modA = runA.model_version ?? runA.provenance?.model_version;
  const modB = runB.model_version ?? runB.provenance?.model_version;
  if (modA && modB && modA !== modB) {
    throw new DisruptionComparisonMismatchError(
      `Mismatched model version: Run A is ${modA}, Run B is ${modB}. Incompatible causal models.`
    );
  }
}

/**
 * Formats a monetary value or returns "—" if null/undefined.
 */
export function formatCurrencyValue(amount: number | null, currency = 'USD'): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return '—';
  }

  const symbolMap: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'CA$',
    CHF: 'CHF ',
  };
  const sym = symbolMap[currency.toUpperCase()] ?? `${currency.toUpperCase()} `;

  const isNeg = amount < 0;
  const absVal = Math.abs(amount);
  const formattedNumber = Math.round(absVal).toLocaleString('en-US');

  return isNeg ? `-${sym}${formattedNumber}` : `${sym}${formattedNumber}`;
}

/**
 * Evaluates queue delay and disruption cost for a single capacity series.
 */
export function evaluateSeriesDisruption(
  points: HourlyCapacityPoint[],
  capacityKey: 'unmitigated_capacity' | 'tripartite_mitigated_capacity' | 'technical_only_capacity',
  label: string,
  assumptions: DisruptionFinancialAssumptions
): SeriesDisruptionSummary {
  const numSteps = points.length;
  const timeGridHours: number[] = [];
  for (let i = 0; i <= numSteps; i++) {
    timeGridHours.push(i);
  }

  const demand = points.map((p) => p.baseline_capacity);
  const capacity = points.map((p) => p[capacityKey]);

  const queueOutput = calculateQueueDelay({
    timeGridHours,
    demand,
    capacity,
    initialBacklog: assumptions.initialBacklogMovements ?? 0,
  });

  const costRate = assumptions.costPerFlightHour;
  const cost =
    typeof costRate === 'number' && Number.isFinite(costRate) && costRate >= 0
      ? queueOutput.totalDelayFlightHours * costRate
      : null;

  return {
    seriesKey: capacityKey === 'unmitigated_capacity' ? 'unmitigated' : 'tripartite_mitigated',
    label,
    totalDelayFlightHours: queueOutput.totalDelayFlightHours,
    terminalBacklogMovements: queueOutput.terminalBacklogMovements,
    peakBacklogMovements: queueOutput.peakBacklogMovements,
    drainHour: queueOutput.drainHour,
    modeledDisruptionCost: cost,
    formattedCost: formatCurrencyValue(cost, assumptions.currency),
    queueDetails: queueOutput,
  };
}

/**
 * Computes comparative disruption cost between unmitigated collapse and active mitigation.
 */
export function computeDisruptionCostComparison(
  points: HourlyCapacityPoint[],
  assumptions: DisruptionFinancialAssumptions,
  provenanceContext?: {
    horizonHours?: number;
    baselineDemand?: number;
    modelVersion?: string;
    engine?: string;
    replicates?: number;
  }
): DisruptionCostComparison {
  if (!Array.isArray(points) || points.length < 2) {
    throw new DisruptionComparisonMismatchError('Hourly capacity series must contain at least 2 points.');
  }

  const horizon = provenanceContext?.horizonHours ?? points.length;
  const demand = provenanceContext?.baselineDemand ?? points[0].baseline_capacity;
  const modelVer = provenanceContext?.modelVersion ?? '2.0.0-causal';
  const engine = provenanceContext?.engine ?? 'fastapi-python';
  const reps = provenanceContext?.replicates ?? 1;

  const isStochastic = reps > 1;
  const stochasticNote = isStochastic
    ? 'Deterministic comparison: current engine exposes marginal hourly percentiles rather than joint paired seed draws. Financial bounds remain deterministic to prevent cross-percentile distortion.'
    : undefined;

  const unmitSummary = evaluateSeriesDisruption(
    points,
    'unmitigated_capacity',
    'Unmitigated Cascade',
    assumptions
  );

  const mitSummary = evaluateSeriesDisruption(
    points,
    'tripartite_mitigated_capacity',
    'Tripartite Mitigated Recovery',
    assumptions
  );

  // Signed Deltas: Unmitigated minus Mitigated
  const deltaDelayFlightHours = unmitSummary.totalDelayFlightHours - mitSummary.totalDelayFlightHours;
  const deltaTerminalBacklogMovements =
    unmitSummary.terminalBacklogMovements - mitSummary.terminalBacklogMovements;

  let deltaDisruptionCost: number | null = null;
  let netBenefit: number | null = null;

  if (unmitSummary.modeledDisruptionCost !== null && mitSummary.modeledDisruptionCost !== null) {
    // Unmitigated minus Mitigated: positive indicates savings, negative indicates loss
    deltaDisruptionCost = unmitSummary.modeledDisruptionCost - mitSummary.modeledDisruptionCost;

    const implCost = assumptions.implementationCost;
    if (typeof implCost === 'number' && Number.isFinite(implCost) && implCost >= 0) {
      netBenefit = deltaDisruptionCost - implCost;
    }
  }

  // Format terminal backlog note
  let terminalBacklogNote = 'Terminal backlog: 0 movements.';
  if (unmitSummary.terminalBacklogMovements > 0 || mitSummary.terminalBacklogMovements > 0) {
    terminalBacklogNote = `Terminal backlog at T+${String(horizon).padStart(2, '0')}:00: Unmitigated has ${unmitSummary.terminalBacklogMovements} stuck movements; Mitigated has ${mitSummary.terminalBacklogMovements} stuck movements.`;
  }

  return {
    provenance: {
      matched: true,
      horizonHours: horizon,
      baselineDemandPerHour: demand,
      modelVersion: modelVer,
      engine,
      isStochastic,
      stochasticNote,
    },
    assumptions,
    unmitigated: unmitSummary,
    mitigated: mitSummary,
    deltaDelayFlightHours,
    deltaTerminalBacklogMovements,
    deltaDisruptionCost,
    netBenefit,
    formattedDeltaCost: formatCurrencyValue(deltaDisruptionCost, assumptions.currency),
    formattedNetBenefit: formatCurrencyValue(netBenefit, assumptions.currency),
    formattedTerminalBacklogNote: terminalBacklogNote,
  };
}
