import { useCallback, useEffect, useState } from 'react';

import { getDecisionMatrix, type DecisionMatrixRow } from '../api';

/**
 * The all-areas matrix.
 *
 * One aggregate over the index: which areas the organisation has decisions in,
 * and how many still hold. A violation count is a finding; an orphan count is a
 * confession.
 */
export function Matrix(): JSX.Element {
  const [groupBy, setGroupBy] = useState<'area' | 'status'>('area');
  const [matrix, setMatrix] = useState<DecisionMatrixRow | null>(null);

  const load = useCallback(async () => {
    setMatrix(await getDecisionMatrix(groupBy));
  }, [groupBy]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!matrix) {
    return (
      <section className="card">
        <h2>Decision matrix</h2>
        <p className="muted">Loading the index…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="row row--between">
        <div>
          <h2>Decision matrix</h2>
          <p className="muted">{matrix.summary}</p>
        </div>
        <label className="field field--inline">
          <span>Group by</span>
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as 'area' | 'status')}>
            <option value="area">area</option>
            <option value="status">status</option>
          </select>
        </label>
      </div>

      <table className="matrix">
        <thead>
          <tr>
            <th>{matrix.groupBy}</th>
            <th>enforced</th>
            <th>violated</th>
            <th>orphaned</th>
            <th>total</th>
            <th>newest</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.group}>
              <td>{row.group}</td>
              <td className="matrix__ok">{row.enforced}</td>
              <td className={row.violated > 0 ? 'matrix__bad' : ''}>{row.violated}</td>
              <td className={row.orphaned > 0 ? 'matrix__warn' : ''}>{row.orphaned}</td>
              <td>{row.total}</td>
              <td className="muted">{row.newest ? row.newest.slice(0, 10) : '—'}</td>
            </tr>
          ))}
          {matrix.rows.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No decisions in the index yet.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <td>all</td>
            <td>{matrix.totals.enforced}</td>
            <td>{matrix.totals.violated}</td>
            <td>{matrix.totals.orphaned}</td>
            <td>{matrix.totals.decisions}</td>
            <td className="muted">{matrix.totals.areas} areas</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
