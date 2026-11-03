import { describe, expect, it } from 'vitest';

import {
  baseRate,
  estimateSuccess,
  gradeFor,
  isUsableOutcome,
  wilsonInterval,
  type PredictorFeatures,
} from '../src/domain/predictor';

const neutral: PredictorFeatures = {
  precedentWins: 0,
  precedentTrials: 0,
  knowability: 0.5,
  applicability: 0.5,
  freshness: 0.5,
  migrationCost: 0.5,
  intentFit: 0.5,
};

describe('calibration primitives', () => {
  it('Laplace-smooths the base rate, so nothing reads 0 or 1 on thin data', () => {
    expect(baseRate(0, 0)).toBe(0.5);
    expect(baseRate(0, 1)).toBeCloseTo(1 / 3, 5);
    expect(baseRate(1, 1)).toBeCloseTo(2 / 3, 5);
    expect(baseRate(5, 5)).toBeCloseTo(6 / 7, 5);
  });

  it('widens the interval as the sample shrinks', () => {
    const small = wilsonInterval(2, 3);
    const large = wilsonInterval(20, 30);
    expect(small[1] - small[0]).toBeGreaterThan(large[1] - large[0]);
  });

  it('returns the full range when there is no sample', () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
  });

  it('grades samples by size', () => {
    expect(gradeFor(0)).toBe('C');
    expect(gradeFor(2)).toBe('C');
    expect(gradeFor(3)).toBe('B');
    expect(gradeFor(7)).toBe('B');
    expect(gradeFor(8)).toBe('A');
  });

  it('rejects an outcome nobody observed', () => {
    expect(isUsableOutcome('tried_ok')).toBe(true);
    expect(isUsableOutcome('tried_bad')).toBe(true);
    expect(isUsableOutcome('never_tried')).toBe(false);
    expect(isUsableOutcome('unknown')).toBe(false);
  });
});

describe('deterministic estimator', () => {
  it('is deterministic: same input, same output', () => {
    const a = estimateSuccess(neutral);
    const b = estimateSuccess({ ...neutral });
    expect(a).toEqual(b);
  });

  it('returns the base rate at neutral features', () => {
    const result = estimateSuccess({ ...neutral, precedentWins: 4, precedentTrials: 8 });
    // base 5/10 = 0.5, no feature pushes it
    expect(result.probability).toBeCloseTo(0.5, 3);
    expect(result.baseRate).toBe(0.5);
  });

  it('rises with more precedent wins', () => {
    const low = estimateSuccess({ ...neutral, precedentWins: 1, precedentTrials: 6 });
    const high = estimateSuccess({ ...neutral, precedentWins: 5, precedentTrials: 6 });
    expect(high.probability).toBeGreaterThan(low.probability);
  });

  it('rises with knowability, applicability, freshness and intent fit', () => {
    const low = estimateSuccess({ ...neutral, knowability: 0.1, applicability: 0.1, freshness: 0.1, intentFit: 0.1 });
    const high = estimateSuccess({ ...neutral, knowability: 0.9, applicability: 0.9, freshness: 0.9, intentFit: 0.9 });
    expect(high.probability).toBeGreaterThan(low.probability);
  });

  it('falls as migration cost rises', () => {
    const cheap = estimateSuccess({ ...neutral, migrationCost: 0.1 });
    const dear = estimateSuccess({ ...neutral, migrationCost: 0.9 });
    expect(dear.probability).toBeLessThan(cheap.probability);
  });

  it('never leaves 0..1, even with maximal inputs', () => {
    const result = estimateSuccess({
      precedentWins: 1000,
      precedentTrials: 1000,
      knowability: 1,
      applicability: 1,
      freshness: 1,
      migrationCost: 0,
      intentFit: 1,
    });
    expect(result.probability).toBeGreaterThan(0);
    expect(result.probability).toBeLessThanOrEqual(1);
    expect(result.interval[0]).toBeGreaterThanOrEqual(0);
    expect(result.interval[1]).toBeLessThanOrEqual(1);
  });

  it('is bounded in log-odds, so extreme features cannot claim certainty', () => {
    const result = estimateSuccess({
      precedentWins: 50,
      precedentTrials: 50,
      knowability: 1,
      applicability: 1,
      freshness: 1,
      migrationCost: 0,
      intentFit: 1,
    });
    expect(result.probability).toBeLessThan(0.999);
  });

  it('refuses to call thin data evidence', () => {
    const result = estimateSuccess({ ...neutral, precedentWins: 1, precedentTrials: 1 });
    expect(result.grade).toBe('C');
    expect(result.caveat).toMatch(/not evidence/i);
    expect(result.interval[1] - result.interval[0]).toBeGreaterThan(0.5);
  });

  it('withdraws the caveat once the sample is credible', () => {
    const result = estimateSuccess({ ...neutral, precedentWins: 7, precedentTrials: 10 });
    expect(result.grade).toBe('A');
    expect(result.caveat).toBeNull();
  });

  it('exposes every driver with its contribution', () => {
    const result = estimateSuccess({ ...neutral, knowability: 0.9, migrationCost: 0.9 });
    expect(result.drivers).toHaveLength(5);
    for (const driver of result.drivers) {
      expect(Number.isFinite(driver.contribution)).toBe(true);
    }
    const knowability = result.drivers.find((d) => d.label === 'knowability');
    const migration = result.drivers.find((d) => d.label === 'migrationCost');
    expect(knowability!.contribution).toBeGreaterThan(0);
    expect(migration!.contribution).toBeLessThan(0);
  });

  it('lets evidence dominate facts once the sample is credible', () => {
    // 1 win in 6 is a 25% observed rate; ideal current facts must not lift it
    // above 60%. The earlier additive model returned 0.897 here — plausible
    // output, silently wrong.
    const result = estimateSuccess({
      precedentWins: 1,
      precedentTrials: 6,
      knowability: 0.9,
      applicability: 1,
      freshness: 1,
      migrationCost: 0.2,
      intentFit: 0.9,
    });
    expect(result.probability).toBeLessThan(0.6);
    expect(result.probability).toBeGreaterThan(0.25);
    expect(result.baseRate).toBeCloseTo(2 / 8, 5);
  });

  it('reports the fact assessment separately from the blended number', () => {
    const result = estimateSuccess({ ...neutral, applicability: 1, knowability: 1 });
    expect(result.factAssessment).toBeGreaterThan(0.5);
    expect(result.evidenceWeight).toBe(0); // no precedent
    expect(result.probability).toBeCloseTo(result.factAssessment, 6);
  });

  it('survives NaN inputs without producing NaN', () => {
    const result = estimateSuccess({
      precedentWins: Number.NaN,
      precedentTrials: Number.NaN,
      knowability: Number.NaN,
      applicability: Number.NaN,
      freshness: Number.NaN,
      migrationCost: Number.NaN,
      intentFit: Number.NaN,
    });
    expect(Number.isFinite(result.probability)).toBe(true);
    expect(Number.isFinite(result.baseRate)).toBe(true);
  });
});

describe('path forecast (additive layer)', () => {
  const path = {
    pathId: 'path_1',
    branchId: 'br_1',
    label: 'Adopt the sharded schema',
    facts: {
      migrationCost: 0.25,
      residualRisk: 0.2,
      applicability: 1,
      freshness: 1,
      intentFit: 0.8,
    },
  };

  it('produces a forecast from facts already in the run', async () => {
    const { predictForPath } = await import('../src/domain/forecast');
    const forecast = predictForPath(path, { knowability: 0.9 }, { wins: 3, trials: 4 });
    expect(forecast.label).toBe('Adopt the sharded schema');
    expect(forecast.prediction.grade).toBe('B');
    expect(forecast.prediction.probability).toBeGreaterThan(0.5);
  });

  it('labels a forecast with no precedent as a fact assessment', async () => {
    const { predictForPath, NO_PRECEDENT } = await import('../src/domain/forecast');
    const forecast = predictForPath(path, { knowability: 0.9 }, NO_PRECEDENT);
    expect(forecast.prediction.grade).toBe('C');
    expect(forecast.prediction.evidenceWeight).toBe(0);
    expect(forecast.prediction.caveat).toMatch(/not evidence/i);
  });

  it('joins paths to scores and ranks by probability', async () => {
    const { forecastRun } = await import('../src/domain/forecast');
    const result = forecastRun(
      [path, { ...path, pathId: 'path_2', branchId: 'br_2', facts: { ...path.facts, applicability: 0.2 } }],
      [
        { branchId: 'br_1', knowability: 0.9 },
        { branchId: 'br_2', knowability: 0.9 },
      ],
      { wins: 2, trials: 5 },
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.prediction.probability).toBeGreaterThanOrEqual(result[1]!.prediction.probability);
  });

  it('drops paths with no matching score rather than guessing one', async () => {
    const { forecastRun } = await import('../src/domain/forecast');
    expect(forecastRun([path], [], { wins: 1, trials: 2 })).toEqual([]);
  });
});
