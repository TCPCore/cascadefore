import type { RunSnapshotDto } from '../../../src/shared/dtos';

interface Props {
  snapshot: RunSnapshotDto;
}

/**
 * Empty state. The most common cause of "no data" is a scope the admin never
 * granted, and Teamwork Graph returns an empty result rather than an error for
 * that case, so the panel has to say so explicitly.
 */
export function EmptyState({ snapshot }: Props): JSX.Element {
  const missing = snapshot.scopeProbe.filter((probe) => !probe.yielded);

  return (
    <section className="card card--warn" aria-label="No decision evidence">
      <header className="card__head">
        <h2>No decision evidence found</h2>
      </header>
      <p className="lead">
        Cascade found no artefacts it could read as a decision for{' '}
        <code>{snapshot.workItemKey}</code>.
      </p>

      {missing.length > 0 ? (
        <>
          <p>
            This usually means a Teamwork Graph scope was not granted. A missing scope returns an
            empty result, not an error — so these need checking in the install consent screen:
          </p>
          <table className="probe">
            <thead>
              <tr>
                <th scope="col">Object type</th>
                <th scope="col">Scope</th>
                <th scope="col">Returned</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.scopeProbe.map((probe) => (
                <tr key={probe.objectType}>
                  <td>{probe.objectType}</td>
                  <td>
                    <code>{probe.scope}</code>
                  </td>
                  <td>{probe.yielded ? 'yes' : <strong>no</strong>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">
          Scopes look healthy, so the graph genuinely has no linked documents, comments or
          status transitions behind this work item. Link an ADR or a decision record first.
        </p>
      )}
    </section>
  );
}
