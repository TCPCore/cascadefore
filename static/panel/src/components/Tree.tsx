import type { RunSnapshotDto } from '../../../src/shared/dtos';

interface Props {
  snapshot: RunSnapshotDto;
}

function gapClass(gap: number): string {
  if (gap >= 0.15) return 'gap gap--high';
  if (gap >= 0.05) return 'gap gap--mid';
  return 'gap gap--low';
}

export function Tree({ snapshot }: Props): JSX.Element {
  const branchesByNode = new Map<string, RunSnapshotDto['branches']>();
  for (const branch of snapshot.branches) {
    const list = branchesByNode.get(branch.nodeId) ?? [];
    list.push(branch);
    branchesByNode.set(branch.nodeId, list);
  }

  return (
    <section className="card" aria-label="Cascade tree">
      <header className="card__head">
        <h2>Decision cascade</h2>
        <span className="muted">{snapshot.spine.length} decisions on the spine</span>
      </header>

      <ol className="spine">
        {snapshot.spine.map((segment) => {
          const branches = branchesByNode.get(segment.nodeId) ?? [];
          return (
            <li key={segment.nodeId} className="spine__item">
              <div className={`node ${segment.resolved ? '' : 'node--unresolved'}`}>
                <span className="node__order">{segment.order + 1}</span>
                <div className="node__body">
                  <p className="node__title">{segment.title}</p>
                  <p className="node__meta">
                    <code>{shortAri(segment.ari)}</code>
                    <span>·</span>
                    <span>{segment.decidedAt.slice(0, 10)}</span>
                    <span>·</span>
                    <span>{segment.resolved ? 'resolved' : 'still open'}</span>
                  </p>
                </div>
              </div>

              {branches.length > 0 && (
                <ul className="branches">
                  {branches.map((branch) => (
                    <li key={branch.id} className={`branch ${branch.taken ? 'branch--taken' : ''}`}>
                      <div className="branch__top">
                        <span className={`pill ${branch.taken ? 'pill--taken' : 'pill--alt'}`}>
                          {branch.taken ? 'taken' : 'alternative'}
                        </span>
                        <span className={gapClass(branch.score.gap)}>
                          gap {branch.score.gap.toFixed(2)}
                        </span>
                        <span className="muted">{branch.evidenceArIs.length} evidence</span>
                      </div>
                      <p className="branch__label">{branch.label}</p>
                      <p className="branch__scores">
                        knowable {branch.score.knowability.toFixed(2)} · viable{' '}
                        {branch.score.viability.toFixed(2)} · confidence{' '}
                        {branch.score.confidence.toFixed(2)}
                      </p>
                      <details className="branch__math">
                        <summary>How this was scored</summary>
                        <table>
                          <tbody>
                            {branch.score.arithmetic.map((step) => (
                              <tr key={step.label}>
                                <th scope="row">{step.label}</th>
                                <td>{step.expression}</td>
                                <td className="num">{step.value.toFixed(3)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function shortAri(ari: string): string {
  const parts = ari.split('/');
  return parts[parts.length - 1] ?? ari;
}
