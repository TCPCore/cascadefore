import { useEffect, useState } from 'react';
import {
  getDecisionReport,
  getSimilar,
  type DecisionReport,
  type DecisionRow,
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

  useEffect(() => {
    void getDecisionReport().then(setReport);
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
}: {
  decision: DecisionRow;
  open: boolean;
  onSelect: () => void;
  similar: SimilarRow[];
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
