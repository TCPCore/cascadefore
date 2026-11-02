import type { RunSnapshotDto } from '../../../src/shared/dtos';

interface Props {
  snapshot: RunSnapshotDto;
}

export function Graft({ snapshot }: Props): JSX.Element | null {
  const recommendation = snapshot.recommendation;
  const graft = snapshot.graft;

  if (!recommendation) return null;

  if (recommendation.kind === 'noEvidencedPath') {
    return (
      <section className="card card--warn" aria-label="No evidenced path">
        <header className="card__head">
          <h2>No evidenced path</h2>
        </header>
        <p className="lead">
          No reconstructed path satisfies the stated intent. The failing criterion is:
        </p>
        <p className="verdict">{recommendation.failingCriterion}</p>
        <p className="muted">{recommendation.note}</p>
        {recommendation.closest && (
          <p className="muted">
            Closest path: <strong>{recommendation.closest.label}</strong> (score{' '}
            {recommendation.closest.score.toFixed(2)})
          </p>
        )}
      </section>
    );
  }

  if (!graft) return null;

  return (
    <section className="card" aria-label="Recommended graft">
      <header className="card__head">
        <h2>Recommended path</h2>
        <span className="score">score {recommendation.best.score.toFixed(2)}</span>
      </header>

      <p className="verdict">{recommendation.best.label}</p>

      <div className="lanes">
        <div className="lane lane--keep">
          <h3>Keep <span className="lane__count">{graft.keep.length}</span></h3>
          <ul>
            {graft.keep.map((item) => (
              <li key={item.nodeId}>{item.title}</li>
            ))}
            {graft.keep.length === 0 && <li className="muted">Nothing to keep</li>}
          </ul>
        </div>

        <div className="lane lane--graft">
          <h3>Graft <span className="lane__count">1</span></h3>
          <p>{graft.graft.label}</p>
        </div>

        <div className="lane lane--unwind">
          <h3>Unwind <span className="lane__count">{graft.unwind.length}</span></h3>
          <ul>
            {graft.unwind.map((item) => (
              <li key={item.nodeId}>
                {item.title}
                <span className="muted"> · {item.dependentCount} dependent object(s)</span>
              </li>
            ))}
            {graft.unwind.length === 0 && <li className="muted">Nothing to unwind</li>}
          </ul>
        </div>
      </div>

      {recommendation.alternates.length > 0 && (
        <details className="alternates">
          <summary>{recommendation.alternates.length} other evidenced path(s)</summary>
          <ul>
            {recommendation.alternates.map((alt) => (
              <li key={alt.pathId}>
                <span className="muted">{alt.score.toFixed(2)}</span> {alt.label}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
