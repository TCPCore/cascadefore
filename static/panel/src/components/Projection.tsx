import { useCallback, useEffect, useState } from 'react';

import { projectTree, type TreeProjectionRow } from '../api';

/**
 * The projected tree.
 *
 * Nothing here is stored. Change the date and the tree changes, because the
 * projection is computed from the decision index at whatever anchor you ask
 * about. The "not yet knowable" column is the point: it shows what the people
 * involved could not have seen, so the view never implies hindsight.
 */
export function Projection({ runId, anchorAt }: { runId: string; anchorAt: string }): JSX.Element {
  const [asOf, setAsOf] = useState(anchorAt.slice(0, 10));
  const [direction, setDirection] = useState<'backward' | 'forward'>('backward');
  const [projection, setProjection] = useState<TreeProjectionRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const result = await projectTree({
      runId,
      asOf: `${asOf}T23:59:59.000Z`,
      direction,
    });
    if (!result) {
      setError('The projection could not be computed for this run.');
      setProjection(null);
      return;
    }
    setProjection(result);
  }, [runId, asOf, direction]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="card">
      <div className="row row--between">
        <div>
          <h2>Projected tree</h2>
          <p className="muted">
            Computed from the decision index at the date you choose — not a stored graph.
          </p>
        </div>
        <div className="row">
          <label className="field field--inline">
            <span>As of</span>
            <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
          <label className="field field--inline">
            <span>Direction</span>
            <select
              value={direction}
              onChange={(event) => setDirection(event.target.value as 'backward' | 'forward')}
            >
              <option value="backward">backward — how we got here</option>
              <option value="forward">forward — what this still binds</option>
            </select>
          </label>
        </div>
      </div>

      {error && <p className="hint">{error}</p>}

      {projection && (
        <>
          <p className="hint">{projection.summary}</p>
          {projection.invisibleAfter && (
            <p className="hint">
              Not knowable at this anchor until <strong>{projection.invisibleAfter.slice(0, 10)}</strong> —
              anything after that date could not have informed the decision.
            </p>
          )}

          <ol className="projection">
            {projection.nodes.map((node) => (
              <li key={node.id} className="projection__node">
                <div className="projection__head">
                  <span className="timeline__date">{node.decidedAt.slice(0, 10)}</span>
                  <span className="badge badge--decision">{node.kind}</span>
                  <span className="projection__title">{node.title}</span>
                </div>

                {node.visibleAlternatives.map((alt) => (
                  <div key={alt.id} className={`projection__alt ${alt.taken ? 'is-taken' : ''}`}>
                    <span>{alt.taken ? 'taken' : 'alt'}</span>
                    <span className="projection__label">{alt.label}</span>
                    <span className="muted">gap {alt.gap.toFixed(2)}</span>
                  </div>
                ))}

                {node.hiddenAlternatives.map((alt) => (
                  <div key={alt.id} className="projection__alt is-hidden">
                    <span>not yet knowable</span>
                    <span className="projection__label">{alt.label}</span>
                    <span className="muted">evidence {alt.evidenceAfter.slice(0, 10)}</span>
                  </div>
                ))}
              </li>
            ))}
            {projection.nodes.length === 0 && (
              <li className="muted">No decision existed at this date — every path was still open.</li>
            )}
          </ol>
        </>
      )}
    </section>
  );
}
