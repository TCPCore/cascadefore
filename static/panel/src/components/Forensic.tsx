import { useMemo, useState } from 'react';

import type { CounterfactualRow, TimelineEntryRow } from '../api';

/**
 * The forensic view.
 *
 * Two questions, side by side: how we got here (a dated chronology), and what
 * the tree looked like at a chosen moment (the "as of" filter). The as-of date
 * is the whole point — it is the difference between a list of events and a view
 * of what the people involved could actually see.
 */
export interface ForensicProps {
  timeline: {
    summary: string;
    knowableThen: number;
    learnedSince: number;
    entries: TimelineEntryRow[];
  };
  counterfactuals: CounterfactualRow[];
  anchorAt: string;
}

const KIND_LABEL: Record<string, string> = {
  action: 'action',
  decision: 'decision',
  evidence: 'evidence',
  outcome: 'outcome',
  resolution: 'resolved',
};

function day(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : iso;
}

export function Forensic({ timeline, counterfactuals, anchorAt }: ForensicProps): JSX.Element {
  const [asOf, setAsOf] = useState(day(anchorAt));

  const shown = useMemo(() => {
    const cutoff = Date.parse(`${asOf}T23:59:59.999Z`);
    if (!Number.isFinite(cutoff)) return timeline.entries;
    return timeline.entries.filter((entry) => {
      const at = Date.parse(entry.at);
      return Number.isFinite(at) ? at <= cutoff : true;
    });
  }, [timeline.entries, asOf]);

  const hidden = timeline.entries.length - shown.length;

  return (
    <>
      <section className="card">
        <div className="row row--between">
          <div>
            <h2>Forensic timeline</h2>
            <p className="muted">{timeline.summary}</p>
          </div>
          <label className="field field--inline">
            <span>As of</span>
            <input type="date" value={asOf} onChange={(event) => setAsOf(event.target.value)} />
          </label>
        </div>

        <p className="hint">
          {shown.length} of {timeline.entries.length} entries visible on {asOf}
          {hidden > 0 ? ` — ${hidden} had not happened yet` : ''}. “Knowable” means it existed at
          the moment of the action.
        </p>

        <ol className="timeline">
          {shown.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="timeline__row">
              <span className="timeline__date">{day(entry.at)}</span>
              <span className={`badge badge--${entry.kind}`}>{KIND_LABEL[entry.kind] ?? entry.kind}</span>
              <span className="timeline__title">{entry.title}</span>
              {!entry.knowableAtAnchor && <span className="badge badge--warn">later</span>}
            </li>
          ))}
          {shown.length === 0 && (
            <li className="timeline__row muted">
              Nothing had happened yet on {asOf}. Every path was still open.
            </li>
          )}
        </ol>
      </section>

      <section className="card">
        <h2>Paths not taken</h2>
        {counterfactuals.length === 0 ? (
          <p className="muted">
            No rejected alternative was recorded in this thread. That is a finding, not a gap — the
            case base cannot compare a path nobody wrote down.
          </p>
        ) : (
          counterfactuals.map((entry) => (
            <article key={entry.name} className="counterfactual">
              <h3>{entry.name}</h3>
              <p className="muted">
                Rejected because:{' '}
                <strong>{entry.rejectedBecause ?? 'no reason recorded'}</strong>
              </p>
              <p>{entry.summary}</p>
              <div className="counterfactual__cols">
                <div>
                  <span className="stat__label">Known at decision time</span>
                  {entry.knownThen.length === 0 ? (
                    <p className="muted">Nothing — this was decided on documentation.</p>
                  ) : (
                    <ul>
                      {entry.knownThen.map((p) => (
                        <li key={p.decisionId}>
                          {p.decisionId} — {p.title} ({p.outcome})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <span className="stat__label">Learned since</span>
                  {entry.learnedLater.length === 0 ? (
                    <p className="muted">Nothing observed yet.</p>
                  ) : (
                    <ul>
                      {entry.learnedLater.map((p) => (
                        <li key={p.decisionId}>
                          {p.decisionId} — {p.title} ({p.outcome})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </article>
          ))
        )}
      </section>
    </>
  );
}
