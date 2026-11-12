import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDisruptionCostComparison,
  validateRunProvenanceMatch,
  formatCurrencyValue,
  DisruptionComparisonMismatchError,
} from './disruptionCost.ts';
import type { HourlyCapacityPoint } from './types.ts';

function makeMockCapacityPoints(
  horizon = 24,
  baseline = 48,
  unmitValues?: number[],
  mitValues?: number[]
): HourlyCapacityPoint[] {
  const points: HourlyCapacityPoint[] = [];
  for (let h = 0; h < horizon; h++) {
    const unmit = unmitValues ? unmitValues[h] : h < 4 ? 48 : 12; // collapses to 12
    const mit = mitValues ? mitValues[h] : h < 4 ? 48 : h < 12 ? 24 : 48; // recovers at h=12
    points.push({
      hour: h,
      time_label: `T+${String(h).padStart(2, '0')}:00`,
      baseline_capacity: baseline,
      unmitigated_capacity: unmit,
      technical_only_capacity: unmit,
      tripartite_mitigated_capacity: mit,
      active_stage: h < 4 ? 'NORMAL' : 'DISRUPTION',
      estimated_lost_capacity_cumulative: 0,
      delayed_flights_cumulative: 0,
    });
  }
  return points;
}

describe('AeroCascade Disruption Cost & Comparative Economics Engine', () => {
  it('Acceptance: Zero delay when demand is fully served by both series', () => {
    // Both unmitigated and mitigated equal baseline capacity throughout
    const points = makeMockCapacityPoints(24, 48, Array(24).fill(48), Array(24).fill(48));
    const comparison = computeDisruptionCostComparison(points, {
      currency: 'EUR',
      costPerFlightHour: 2500,
      implementationCost: null,
      initialBacklogMovements: 0,
    });

    assert.equal(comparison.unmitigated.totalDelayFlightHours, 0);
    assert.equal(comparison.mitigated.totalDelayFlightHours, 0);
    assert.equal(comparison.deltaDelayFlightHours, 0);
    assert.equal(comparison.deltaDisruptionCost, 0);
    assert.equal(comparison.unmitigated.terminalBacklogMovements, 0);
    assert.equal(comparison.mitigated.terminalBacklogMovements, 0);
    assert.equal(comparison.formattedDeltaCost, '€0');
  });

  it('Acceptance: Dollar outputs remain blank until a cost per flight-hour is entered', () => {
    const points = makeMockCapacityPoints(24, 48);

    // Rate is null
    const comparisonBlank = computeDisruptionCostComparison(points, {
      currency: 'USD',
      costPerFlightHour: null,
      implementationCost: null,
      initialBacklogMovements: 0,
    });

    assert.equal(comparisonBlank.unmitigated.modeledDisruptionCost, null);
    assert.equal(comparisonBlank.mitigated.modeledDisruptionCost, null);
    assert.equal(comparisonBlank.deltaDisruptionCost, null);
    assert.equal(comparisonBlank.netBenefit, null);
    assert.equal(comparisonBlank.unmitigated.formattedCost, '—');
    assert.equal(comparisonBlank.mitigated.formattedCost, '—');
    assert.equal(comparisonBlank.formattedDeltaCost, '—');
    assert.equal(comparisonBlank.formattedNetBenefit, '—');

    // Flight-hours of delay are still strictly computed and displayed
    assert.ok(comparisonBlank.unmitigated.totalDelayFlightHours > 0);
    assert.ok(comparisonBlank.mitigated.totalDelayFlightHours > 0);
    assert.ok(comparisonBlank.deltaDelayFlightHours > 0);
  });

  it('Acceptance: Signed delta calculates Unmitigated Cost minus Mitigated Cost with positive savings', () => {
    const points = makeMockCapacityPoints(24, 48);
    const comparison = computeDisruptionCostComparison(points, {
      currency: 'USD',
      costPerFlightHour: 3000,
      implementationCost: null,
      initialBacklogMovements: 0,
    });

    assert.ok(comparison.unmitigated.totalDelayFlightHours > comparison.mitigated.totalDelayFlightHours);
    assert.ok(comparison.unmitigated.modeledDisruptionCost! > comparison.mitigated.modeledDisruptionCost!);

    const expectedDelta =
      comparison.unmitigated.modeledDisruptionCost! - comparison.mitigated.modeledDisruptionCost!;
    assert.equal(comparison.deltaDisruptionCost, expectedDelta);
    assert.ok(comparison.deltaDisruptionCost! > 0);
    assert.ok(comparison.formattedDeltaCost.startsWith('$'));
  });

  it('Acceptance: Negative savings remain negative when mitigation performs worse', () => {
    // Unmitigated recovers faster than an ineffective or prolonged mitigation
    const unmit = Array(24).fill(48);
    const mit = Array(24).fill(48);
    // Unmitigated drops to 30 for 2 hours
    unmit[4] = 30;
    unmit[5] = 30;
    // Mitigated drops to 20 for 6 hours (worse!)
    for (let h = 4; h <= 9; h++) mit[h] = 20;

    const points = makeMockCapacityPoints(24, 48, unmit, mit);
    const comparison = computeDisruptionCostComparison(points, {
      currency: 'EUR',
      costPerFlightHour: 2000,
      implementationCost: 50000,
      initialBacklogMovements: 0,
    });

    // Unmitigated delay should be LOWER than mitigated delay
    assert.ok(comparison.unmitigated.totalDelayFlightHours < comparison.mitigated.totalDelayFlightHours);
    assert.ok(comparison.deltaDelayFlightHours < 0, 'Delay delta must be negative');
    assert.ok(comparison.deltaDisruptionCost! < 0, 'Cost savings delta must be negative');
    assert.ok(comparison.formattedDeltaCost.startsWith('-€'), 'Formatted delta must show negative currency');

    // Net benefit = negative savings - implementation cost = even more negative
    const expectedNet = comparison.deltaDisruptionCost! - 50000;
    assert.equal(comparison.netBenefit, expectedNet);
    assert.ok(comparison.netBenefit! < comparison.deltaDisruptionCost!);
    assert.ok(comparison.formattedNetBenefit.startsWith('-€'));
  });

  it('Acceptance: Net benefit is computed separately when implementation cost is entered', () => {
    const points = makeMockCapacityPoints(24, 48);
    const costRate = 2000;
    const implCost = 150000;

    const comparison = computeDisruptionCostComparison(points, {
      currency: 'GBP',
      costPerFlightHour: costRate,
      implementationCost: implCost,
      initialBacklogMovements: 0,
    });

    const expectedSavings =
      comparison.unmitigated.modeledDisruptionCost! - comparison.mitigated.modeledDisruptionCost!;
    assert.equal(comparison.deltaDisruptionCost, expectedSavings);
    assert.equal(comparison.netBenefit, expectedSavings - implCost);
    assert.ok(comparison.formattedNetBenefit.startsWith('£'));
  });

  it('Acceptance: Terminal backlog remains visible and is labeled separately from within-horizon cost', () => {
    // Severe sustained disruption leaving stuck flights at T+24
    const unmit = Array(24).fill(10); // severe deficit
    const mit = Array(24).fill(20); // deficit remains
    const points = makeMockCapacityPoints(24, 48, unmit, mit);

    const comparison = computeDisruptionCostComparison(points, {
      currency: 'USD',
      costPerFlightHour: 2500,
      implementationCost: null,
      initialBacklogMovements: 0,
    });

    assert.ok(comparison.unmitigated.terminalBacklogMovements > 0);
    assert.ok(comparison.mitigated.terminalBacklogMovements > 0);
    assert.ok(comparison.deltaTerminalBacklogMovements > 0);
    assert.ok(comparison.formattedTerminalBacklogNote.includes('Terminal backlog at T+24:00'));
    assert.ok(comparison.formattedTerminalBacklogNote.includes('stuck movements'));
  });

  it('Acceptance: Mismatched runs are rejected with descriptive errors', () => {
    const runA = {
      horizon_hours: 24,
      baseline_movements_per_hour: 48,
      hourly_capacity: makeMockCapacityPoints(24, 48),
      model_version: '2.0.0-causal',
    };

    // 1. Horizon mismatch
    const runMismatchedHorizon = {
      horizon_hours: 48,
      baseline_movements_per_hour: 48,
      hourly_capacity: makeMockCapacityPoints(48, 48),
      model_version: '2.0.0-causal',
    };
    assert.throws(
      () => validateRunProvenanceMatch(runA, runMismatchedHorizon),
      /Mismatched simulation horizon: Run A has 24h, Run B has 48h/
    );

    // 2. Baseline demand mismatch
    const runMismatchedDemand = {
      horizon_hours: 24,
      baseline_movements_per_hour: 60,
      hourly_capacity: makeMockCapacityPoints(24, 60),
      model_version: '2.0.0-causal',
    };
    assert.throws(
      () => validateRunProvenanceMatch(runA, runMismatchedDemand),
      /Mismatched baseline demand/
    );

    // 3. Model version mismatch
    const runMismatchedModel = {
      horizon_hours: 24,
      baseline_movements_per_hour: 48,
      hourly_capacity: makeMockCapacityPoints(24, 48),
      model_version: '1.0.0-legacy',
    };
    assert.throws(
      () => validateRunProvenanceMatch(runA, runMismatchedModel),
      /Mismatched model version/
    );
  });

  it('Stochastic comparisons remain deterministic when only marginal percentiles are available', () => {
    const points = makeMockCapacityPoints(24, 48);
    const comparison = computeDisruptionCostComparison(
      points,
      {
        currency: 'USD',
        costPerFlightHour: 2500,
        implementationCost: null,
        initialBacklogMovements: 0,
      },
      {
        horizonHours: 24,
        baselineDemand: 48,
        modelVersion: '2.0.0-causal',
        replicates: 30, // Monte Carlo run
      }
    );

    assert.equal(comparison.provenance.isStochastic, true);
    assert.ok(comparison.provenance.stochasticNote?.includes('Deterministic comparison'));
    assert.ok(comparison.provenance.stochasticNote?.includes('marginal hourly percentiles'));
  });

  it('Currency formatting accurately handles various currency symbols and negative values', () => {
    assert.equal(formatCurrencyValue(1500, 'USD'), '$1,500');
    assert.equal(formatCurrencyValue(-2500, 'USD'), '-$2,500');
    assert.equal(formatCurrencyValue(10000, 'EUR'), '€10,000');
    assert.equal(formatCurrencyValue(-10000, 'EUR'), '-€10,000');
    assert.equal(formatCurrencyValue(500, 'GBP'), '£500');
    assert.equal(formatCurrencyValue(null, 'USD'), '—');
  });
});
