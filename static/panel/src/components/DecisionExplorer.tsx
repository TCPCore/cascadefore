import { useMemo, useState } from 'react';
import type { BranchViewDto, RunSnapshotDto } from '../../../src/shared/dtos';

interface Props {
  snapshot: RunSnapshotDto;
}

type Direction = 'backward' | 'forward';

function gapClass(gap: number): string {
  if (gap >= 0.15) return 'gap gap--high';
  if (gap >= 0.05) return 'gap gap--mid';
  return 'gap gap--low';
}

function shortAri(ari: string): string {
  const parts = ari.split('/');
  return parts[parts.length - 1] ?? ari;
}

/**
 * The decision tree.
 *
 * Every decision point on the spine is a node. Under it sit the alternatives
 * that the graph evidences — including the one that was taken. Selecting an
 * alternative shows what taking it would do: what it invalidates downstream,
 * what survives, and what precedent exists for it having actually worked.
 *
 * The panel never predicts. It shows observed precedent where it exists and
 * structural consequence where it does not, and labels the difference.
 */
export function DecisionExplorer({ snapshot }: Props): JSX.Element {
  const recommended =
    snapshot.recommendation?.kind === 'graft' ? snapshot.recommendation.best.branchId : null;

  const [selectedId, setSelectedId] = useState<string | null>(recommended);
  const [direction, setDirection] = useState<Direction>('forward');

  const nodeById = useMemo(() => new Map(snapshot.nodes.map((n) => [n.id, n])), [snapshot.nodes]);

  const byNode = useMemo(() => {
    const map = new Map<string, BranchViewDto[]>();
    for (const branch of snapshot.branches) {
      const list = map.get(branch.nodeId) ?? [];
      list.push(branch);
      map.set(branch.nodeId, list);
    }
    return map;
  }, [snapshot.branches]);

  const ordered = useMemo(() => {
    const copy = [...snapshot.spine];
    copy.sort((a, b) => (direction === 'forward' ? b.order - a.order : a.order - b.order));
    return copy;
  }, [snapshot.spine, direction]);

  const selected = snapshot.branches.find((b) => b.id === selectedId) ?? null;
  const invalidated = new Set(selected?.projection?.invalidates ?? []);
  const selectedNode = selected ? nodeById.get(selected.nodeId) : undefined;

  return (
    <section className="card" aria-label="Decision tree">
      <header className="card__head">
        <h2>Decision tree</h2>
        <div className="segmented" role="group" aria-label="Walk direction">
          <button
            className={`seg ${direction === 'forward' ? 'seg--active' : ''}`}
            onClick={() => setDirection('forward')}
          >
            Walk forward
          </button>
          <button
            className={`seg ${direction === 'backward' ? 'seg--active' : ''}`}
            onClick={() => setDirection('backward')}
          >
            Walk back
          </button>
        </div>
      </header>

      <p className="muted explorer__hint">
        {direction === 'forward'
          ? 'From the earliest decision forward to the failure — this is how the path was built.'
          : 'From the failure backward to the decision that seeded it — this is diagnosis.'}
      </p>

      {selected && (
        <div className={`projection ${selected.taken ? 'projection--taken' : ''}`}>
          <div className="projection__head">
            <span className={`pill ${selected.taken ? 'pill--taken' : 'pill--alt'}`}>
              {selected.taken ? 'path taken' : 'alternative'}
            </span>
            <strong className="projection__label">{selected.label}</strong>
            <span className={`flag ${selected.projection?.evidenced ? 'flag--evidence' : 'flag--unproven'}`}>
              {selected.projection?.evidenced ? 'evidenced' : 'no precedent'}
            </span>
          </div>

          <p className="projection__headline">{selected.projection?.headline ?? 'No projection available.'}</p>

          <div className="projection__grid">
            <div>
              <span className="projection__k">Knowable then</span>
              <span className="projection__v">{selected.score.knowability.toFixed(2)}</span>
            </div>
            <div>
              <span className="projection__k">Viable now</span>
              <span className="projection__v">{selected.score.viability.toFixed(2)}</span>
            </div>
            <div>
              <span className="projection__k">Gap</span>
              <span className={`projection__v ${gapClass(selected.score.gap)}`}>
                {selected.score.gap.toFixed(2)}
              </span>
            </div>
            <div>
              <span className="projection__k">Confidence</span>
              <span className="projection__v">{selected.score.confidence.toFixed(2)}</span>
            </div>
            <div>
              <span className="projection__k">Dependents to move</span>
              <span className="projection__v">{selected.projection?.dependentObjects ?? 0}</span>
            </div>
          </div>

          <ul className="consequence">
            {selected.consequence.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>

          {selected.projection && selected.projection.timeline.length > 0 && (
            <details className="timeline">
              <summary>Evidence timeline ({selected.projection.timeline.length})</summary>
              <ol>
                {selected.projection.timeline.map((entry) => (
                  <li key={`${entry.ari}-${entry.at}`}>
                    <time>{entry.at.slice(0, 10)}</time>
                    <span>{entry.label}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          <p className="muted projection__note">
            {selected.projection?.evidenced
              ? 'Outcome above is observed from where this path was actually built.'
              : 'No build, deployment or shipped artefact exists for this path. Only the structural consequence is claimed.'}
          </p>
        </div>
      )}

      <ol className="tree">
        {ordered.map((segment) => {
          const node = nodeById.get(segment.nodeId);
          const branches = byNode.get(segment.nodeId) ?? [];
          const isInvalidated = invalidated.has(segment.nodeId);

          return (
            <li
              key={segment.nodeId}
              className={`tree__node ${isInvalidated ? 'tree__node--invalidated' : ''}`}
            >
              <div className="tree__marker">
                <span className="tree__dot" />
                <span className="tree__index">{segment.order + 1}</span>
              </div>

              <div className="tree__body">
                <p className="tree__title">{node?.title ?? segment.title}</p>
                <p className="tree__meta">
                  <code>{shortAri(segment.ari)}</code>
                  <span>·</span>
                  <span>{(node?.decidedAt ?? '').slice(0, 10)}</span>
                  <span>·</span>
                  <span>{node?.kind ?? 'decision'}</span>
                  <span>·</span>
                  <span>{segment.resolved ? 'resolved' : 'still open'}</span>
                  {isInvalidated && <span className="tree__badge">invalidated by selection</span>}
                </p>

                <ul className="alts">
                  {branches.map((branch) => {
                    const isSelected = branch.id === selectedId;
                    return (
                      <li key={branch.id}>
                        <button
                          className={`alt ${isSelected ? 'alt--selected' : ''} ${
                            branch.taken ? 'alt--taken' : ''
                          }`}
                          onClick={() => setSelectedId(branch.id)}
                          aria-pressed={isSelected}
                        >
                          <span className="alt__top">
                            <span className={`pill ${branch.taken ? 'pill--taken' : 'pill--alt'}`}>
                              {branch.taken ? 'taken' : 'alternative'}
                            </span>
                            <span className={gapClass(branch.score.gap)}>
                              gap {branch.score.gap.toFixed(2)}
                            </span>
                            <span className="muted">{branch.evidenceArIs.length} evidence</span>
                          </span>
                          <span className="alt__label">{branch.label}</span>
                        </button>
                      </li>
                    );
                  })}
                  {branches.length === 0 && (
                    <li className="muted alt__empty">No recorded alternative at this decision.</li>
                  )}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>

      {selectedNode && (
        <p className="muted explorer__foot">
          Selected decision recorded {selectedNode.decidedAt.slice(0, 10)} · confidence{' '}
          {selectedNode.confidence.toFixed(2)} · {selectedNode.evidenceCount} evidence object(s)
        </p>
      )}
    </section>
  );
}
