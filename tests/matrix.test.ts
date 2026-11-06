import { describe, expect, it } from 'vitest';

import { buildMatrix } from '../src/decisions/matrix';
import { computeCaseBase } from '../src/decisions/service';

// The matrix reads executed decisions: a status only exists after the runner has
// run the tests, so the raw seed (all "unknown") would produce a useless view.
const decisions = (await computeCaseBase()).models;

describe('decision matrix', () => {

  it('groups by area and counts every status', () => {
    const matrix = buildMatrix(decisions, 'area');
    expect(matrix.rows.length).toBeGreaterThan(0);
    for (const row of matrix.rows) {
      expect(row.total).toBe(row.enforced + row.violated + row.orphaned + row.unknown);
    }
  });

  it('totals count each decision once, even when it spans several areas', () => {
    const matrix = buildMatrix(decisions, 'area');
    expect(matrix.totals.decisions).toBe(decisions.length);
    expect(
      matrix.totals.enforced + matrix.totals.violated + matrix.totals.orphaned + matrix.totals.unknown,
    ).toBe(decisions.length);
    // Rows may double count; totals may not.
    expect(matrix.rows.reduce((n, r) => n + r.total, 0)).toBeGreaterThanOrEqual(decisions.length);
  });

  it('reports the oldest and newest decision in each group', () => {
    const matrix = buildMatrix(decisions, 'area');
    const datastore = matrix.rows.find((r) => r.group === 'datastore')!;
    expect(Date.parse(datastore.oldest!)).toBeLessThanOrEqual(Date.parse(datastore.newest!));
  });

  it('sorts groups by size so the biggest area is first', () => {
    const matrix = buildMatrix(decisions, 'area');
    for (let i = 1; i < matrix.rows.length; i += 1) {
      expect(matrix.rows[i - 1]!.total).toBeGreaterThanOrEqual(matrix.rows[i]!.total);
    }
  });

  it('groups by status when asked', () => {
    const matrix = buildMatrix(decisions, 'status');
    expect(matrix.rows.map((r) => r.group)).toContain('enforced');
    expect(matrix.groupBy).toBe('status');
  });

  it('handles an empty index without inventing rows', () => {
    const matrix = buildMatrix([]);
    expect(matrix.rows).toHaveLength(0);
    expect(matrix.summary).toMatch(/no decisions/i);
  });
});
