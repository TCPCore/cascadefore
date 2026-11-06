import { useEffect, useState } from 'react';
import {
  getAttribution,
  getDecisionReport,
  getCaseCounterfactuals,
  getSimilar,
  type AttributionSummary,
  type DecisionReport,
  type DecisionRow,
  type CaseCounterfactualRow,
  type SimilarRow,
} from '../api';

/**
 * The case base.
 *
 * This is the part of the product that is not a form: decisions that have been
 * checked against reality, the patterns that emerge from them, and the curve
 * that shows confidence moving as evidence accumulates.
 */
export function CaseBase(): JSX.Element {
  const [report, setReport] = useState<DecisionReport | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [similar, setSimilar] = useState<SimilarRow[]>([]);
  const [attribution, setAttribution] = useState<AttributionSummary | null>(null);
  const [paths, setPaths] = useState<CaseCounterfactualRow[]>([]);

  useEffect(() => {
    void getDecisionReport().then(setReport);
    void getAttribution().then(setAttribution);
    void getCaseCounterfactuals().then(setPaths).catch(() => setPaths([]));
  }, []);

  useEffect(() => {
    if (!selected) {
      setSimilar([]);
      return;
    }
    void getSimilar(selected).then(setSimilar);
  }, [selected]);

  if (!report) {
    return (
      <section className="card">
        <p className="muted">Loading the case base…</p>
      </section>
    );
  }

  const maxConfidence = Math.max(0.5, ...report.patterns.map((p) => p.confidence));

  return (
    <div className="cases">
      <Matrix />

      <section className="card">
        <header className="card__head">
          <h2>Case base</h2>
          <span className="muted">
            {report.testability.testable} of {report.testability.total} decisions are machine-checkable
          </span>
        </header>

        <div className="stats">
          <Stat label="enforced" value={report.counts.enforced ?? 0} tone="good" />
          <Stat label="violated" value={report.counts.violated ?? 0} tone="bad" />
          <Stat label="orphaned" value={report.counts.orphaned ?? 0} tone="warn" />
          <Stat label="testable" value={`${Math.round(report.testability.rate * 100)}%`} />
          <Stat label="patterns" value={report.patterns.length} />
        </div>

        <p className="hint">
          Orphaned means no testable assertion exists. It is reported, not hidden — a decision
          nobody can check is a decision the case base cannot learn from.
        </p>
      </section>

      <section className="card">
        <header className="card__head">
          <h2>Growth curve</h2>
          <span className="muted">confidence of the leading pattern, as decisions accumulate</span>
        </header>

        <div className="growth" role="img" aria-label="Pattern confidence by corpus size">
          {report.growth.map((point) => {
            const confidence = point.top?.confidence ?? 0;
            return (
              <div key={point.n} className="growth__col">
                <div className="growth__value">{point.top ? point.top.confidence.toFixed(2) : '—'}</div>
                <div className="growth__track">
                  <div
                    className={`growth__bar ${point.top ? 'growth__bar--on' : ''}`}
                    style={{ height: `${Math.max(4, confidence * 100)}%` }}
                  />
                </div>
                <div className="growth__label">{point.n}</div>
              </div>
            );
          })}
        </div>

        <p className="hint">
          Laplace smoothing, not raw ratios: three clean cases read 0.80, not 1.00. The fourth
          decision is violated and confidence falls; the fifth holds and it recovers. The sixth is
          orphaned, so the curve does not move.
        </p>
      </section>

      <section className="card">
        <header className="card__head">
          <h2>Patterns</h2>
          <span className="muted">{report.patterns.length} extracted</span>
        </header>

        {report.patterns.length === 0 && (
          <p className="muted">Not enough agreeing cases yet. Three are required before a pattern is claimed.</p>
        )}

        <ul className="patterns">
          {report.patterns.map((pattern) => (
            <li key={pattern.id} className="pattern">
              <div className="pattern__top">
                <span className="pattern__conf">{pattern.confidence.toFixed(2)}</span>
                <span className="pattern__support">
                  {pattern.confirmations} held · {pattern.refutations} refuted
                </span>
                <span className="pattern__ids">{pattern.evidenceDecisionIds.join(', ')}</span>
              </div>
              <p className="pattern__text">{pattern.patternText}</p>
              <div className="pattern__bar">
                <div
                  className="pattern__bar-fill"
                  style={{ width: `${(pattern.confidence / maxConfidence) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {attribution && attribution.events.length > 0 && (
        <section className="card">
          <header className="card__head">
            <h2>Outcome trail</h2>
            <span className="muted">
              {attribution.builds} build(s) · {attribution.workItems} work item(s) ·{' '}
              {attribution.pullRequests} PR(s) · {attribution.deployments} deployment(s)
            </span>
          </header>

          <p className="hint">
            Commit statuses named <code>decision/&lt;id&gt;</code> are synced by Atlassian into Teamwork
            Graph. The join key rides inside the name, so no database is shared between the repository
            and the app.
          </p>

          <ul className="trail">
            {attribution.events.map((event) => (
              <li key={`${event.kind}-${event.ari}`}>
                <span className={`trail__kind trail__kind--${event.kind}`}>{event.kind}</span>
                <span className="trail__title">{event.title}</span>
                {event.state && <span className={`trail__state ${event.state === 'FAILED' ? 'is-bad' : ''}`}>{event.state}</span>}
                {event.decisionId && <span className="trail__decision">{event.decisionId}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <header className="card__head">
          <h2>Decisions</h2>
          <span className="muted">select one to see its precedent</span>
        </header>

        <ul className="decisions">
          {report.decisions.map((decision) => (
            <DecisionItem
              key={decision.id}
              decision={decision}
              open={selected === decision.id}
              onSelect={() => setSelected(selected === decision.id ? null : decision.id)}
              similar={selected === decision.id ? similar : []}
              paths={selected === decision.id ? paths.filter((p) => p.decisionId === decision.id) : []}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'good' | 'bad' | 'warn';
}): JSX.Element {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function DecisionItem({
  decision,
  open,
  onSelect,
  similar,
  paths,
}: {
  decision: DecisionRow;
  open: boolean;
  onSelect: () => void;
  similar: SimilarRow[];
  paths: CaseCounterfactualRow[];
}): JSX.Element {
  return (
    <li className={`decision ${open ? 'decision--open' : ''}`}>
      <button className="decision__head" onClick={onSelect} aria-expanded={open}>
        <span className={`status status--${decision.status}`}>{decision.status}</span>
        <span className="decision__title">{decision.decision}</span>
        <span className="decision__meta">
          {decision.passed}✓ {decision.failed}✗ {decision.skipped}⤼
        </span>
      </button>

      {open && (
        <div className="decision__body">
          <p className="decision__id">
            <code>{decision.id}</code> · decided {decision.decidedAt.slice(0, 10)} ·{' '}
            {decision.domain.join(', ')}
          </p>

          <table className="results">
            <tbody>
              {decision.results.map((result) => (
                <tr key={result.name} className={result.skipped ? 'is-skipped' : result.passed ? 'is-pass' : 'is-fail'}>
                  <td className="results__mark">{result.skipped ? '—' : result.passed ? '✓' : '✗'}</td>
                  <td>{result.name}</td>
                  <td className="results__evidence">{result.evidence}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {paths.length > 0 && (
            <>
              <p className="decision__similar-label">Paths not taken</p>
              {paths.map((path) => (
                <article key={`${path.decisionId}-${path.name}`} className="counterfactual">
                  <h3>{path.name}</h3>
                  <p className="muted">
                    Rejected because: <strong>{path.rejectedBecause ?? 'no reason recorded'}</strong>
                  </p>
                  <p>{path.summary}</p>
                  <div className="counterfactual__cols">
                    <div>
                      <span className="stat__label">Known at decision time</span>
                      {path.knownThen.length === 0 ? (
                        <p className="muted">Nothing — decided on documentation.</p>
                      ) : (
                        <ul>
                          {path.knownThen.map((p) => (
                            <li key={p.decisionId}>
                              {p.decisionId} — {p.title} ({p.outcome})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div>
                      <span className="stat__label">Learned since</span>
                      {path.learnedLater.length === 0 ? (
                        <p className="muted">Nothing observed yet.</p>
                      ) : (
                        <ul>
                          {path.learnedLater.map((p) => (
                            <li key={p.decisionId}>
                              {p.decisionId} — {p.title} ({p.outcome})
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </>
          )}

          <p className="decision__similar-label">
            {similar.length > 0 ? 'Similar decisions' : 'No comparable precedent'}
          </p>
          <ul className="similar">
            {similar.map((entry) => (
              <li key={entry.id}>
                <span className={`status status--${entry.status}`}>{entry.status}</span>
                <span className="similar__title">{entry.decision}</span>
                <span className="similar__score">{entry.score.toFixed(2)}</span>
                <span className="similar__why">{entry.because.slice(0, 2).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
