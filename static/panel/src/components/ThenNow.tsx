import type { RunSnapshotDto } from '../../../../src/shared/dtos';

interface Props {
  snapshot: RunSnapshotDto;
}

/**
 * The hindsight-bias defence, rendered.
 *
 * Left column: what the organisation could see when the decision was made.
 * Right column: what proved viable afterwards. A wide right-hand gap with a
 * narrow left-hand one is the finding.
 */
export function ThenNow({ snapshot }: Props): JSX.Element {
  return (
    <section className="card" aria-label="Then versus now">
      <header className="card__head">
        <h2>Then vs now</h2>
        <span className="muted">same evidence, two vantage points</span>
      </header>

      <div className="thennow">
        <div className="thennow__col thennow__col--head">Knowable at the time</div>
        <div className="thennow__col thennow__col--head">Viable in hindsight</div>

        {snapshot.thenNow.map((row) => (
          <div key={row.branchId} className="thennow__pair">
            <div className="thennow__col">
              <div className="meter">
                <div className="meter__fill meter__fill--then" style={{ width: `${row.knowability * 100}%` }} />
              </div>
              <p className="meter__label">
                W_k {row.knowability.toFixed(2)} · {row.knowableArIs.length} object(s)
              </p>
              <p className="thennow__branch">{row.label}</p>
            </div>
            <div className="thennow__col">
              <div className="meter">
                <div className="meter__fill meter__fill--now" style={{ width: `${row.viability * 100}%` }} />
              </div>
              <p className="meter__label">
                W_v {row.viability.toFixed(2)} · {row.withheldArIs.length} withheld object(s)
              </p>
              <p className="thennow__gap">gap {row.gap.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
