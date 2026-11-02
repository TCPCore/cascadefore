import { useCallback, useEffect, useState } from 'react';
import { view } from '@forge/bridge';

import type { RunSnapshotDto } from '../../../src/shared/dtos';
import type { Horizon } from '../../../src/shared/types';
import { getRun, health, startCascade, type Health } from './api';
import { EmptyState } from './components/EmptyState';
import { Graft } from './components/Graft';
import { ThenNow } from './components/ThenNow';
import { Tree } from './components/Tree';

type Phase = 'idle' | 'working' | 'done' | 'error';
type Tab = 'tree' | 'thennow' | 'graft';

const DEFAULT_GOAL = 'Restore the build this week without adding a new dependency #no-new-dependency';

export function App(): JSX.Element {
  const [issueKey, setIssueKey] = useState('');
  const [healthState, setHealthState] = useState<Health | null>(null);
  const [intentText, setIntentText] = useState(DEFAULT_GOAL);
  const [horizon, setHorizon] = useState<Horizon>('weeks');
  const [phase, setPhase] = useState<Phase>('idle');
  const [snapshot, setSnapshot] = useState<RunSnapshotDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('tree');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    void health().then(setHealthState);
    void view
      .getContext()
      .then((context: unknown) => {
        const ctx = context as { extension?: { issue?: { key?: string } }; issueKey?: string };
        setIssueKey(ctx.extension?.issue?.key ?? ctx.issueKey ?? '');
      })
      .catch(() => setIssueKey(''));
  }, []);

  useEffect(() => {
    if (phase !== 'working') return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [phase]);

  const run = useCallback(async () => {
    setPhase('working');
    setError(null);
    setSnapshot(null);
    setElapsed(0);

    try {
      const started = await startCascade({ workItemKey: issueKey, intentText, horizon });
      if (started.error || !started.runId) {
        setError(started.message ?? started.error ?? 'Cascade could not start.');
        setPhase('error');
        return;
      }

      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const result = await getRun(started.runId);
        if (result.snapshot) {
          setSnapshot(result.snapshot);
          if (result.snapshot.status !== 'running' && result.snapshot.status !== 'queued') {
            setPhase('done');
            return;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }

      setError('The reconstruction is taking longer than expected. It may still complete — reopen the panel.');
      setPhase('error');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unexpected error while running Cascade.');
      setPhase('error');
    }
  }, [horizon, intentText, issueKey]);

  return (
    <div className="panel">
      <header className="panel__head">
        <div>
          <h1>
            Cascade <span className="panel__issue">{issueKey || 'no work item'}</span>
          </h1>
          <p className="muted">
            Reconstruct the decision that seeded this failure, and score the paths that were
            available at the time.
          </p>
        </div>
        <div className="badges">
          {healthState?.demoMode && <span className="badge badge--demo">demo graph</span>}
          {healthState && !healthState.configured && !healthState.demoMode && (
            <span className="badge badge--warn">queries not registered</span>
          )}
        </div>
      </header>

      <section className="card">
        <label className="field">
          <span>What are you trying to achieve?</span>
          <textarea
            value={intentText}
            rows={3}
            onChange={(event) => setIntentText(event.target.value)}
            placeholder="Restore service this week. Must not add a new dependency."
          />
        </label>

        <div className="row">
          <label className="field field--inline">
            <span>Horizon</span>
            <select value={horizon} onChange={(event) => setHorizon(event.target.value as Horizon)}>
              <option value="weeks">Weeks — restore service</option>
              <option value="quarters">Quarters — stabilise</option>
              <option value="years">Years — reduce maintenance</option>
            </select>
          </label>

          <button className="btn" onClick={() => void run()} disabled={phase === 'working' || !issueKey}>
            {phase === 'working' ? `Reconstructing… ${elapsed}s` : 'Run Cascade'}
          </button>
        </div>

        <p className="hint">
          Append <code>#no-new-dependency</code>, <code>#ship-within-2-weeks</code>,{' '}
          <code>#no-schema-change</code> or <code>#no-downtime</code> to a constraint to make it a
          hard veto.
        </p>
      </section>

      {error && (
        <section className="card card--error">
          <p>{error}</p>
        </section>
      )}

      {phase === 'working' && !snapshot && (
        <section className="card">
          <p className="muted">Traversing the graph, synthesising decisions, scoring branches…</p>
        </section>
      )}

      {snapshot && snapshot.status === 'empty' && <EmptyState snapshot={snapshot} />}

      {snapshot && snapshot.status === 'failed' && (
        <section className="card card--error">
          <h2>Reconstruction failed</h2>
          <p>
            Error code: <code>{snapshot.errorCode ?? 'unknown'}</code>
          </p>
        </section>
      )}

      {snapshot && snapshot.status === 'loaded' && (
        <>
          <div className="stats">
            <Stat label="decisions" value={snapshot.stats.nodeCount} />
            <Stat label="branches" value={snapshot.stats.branchCount} />
            <Stat label="evidence" value={snapshot.stats.evidenceCount} />
            <Stat label="graph ms" value={snapshot.stats.traversalMs} />
            <Stat label="score ms" value={snapshot.stats.scoringMs} />
          </div>

          <nav className="tabs" aria-label="Views">
            {(
              [
                ['tree', 'Cascade tree'],
                ['thennow', 'Then vs now'],
                ['graft', 'Recommended path'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                className={`tab ${tab === key ? 'tab--active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>

          {tab === 'tree' && <Tree snapshot={snapshot} />}
          {tab === 'thennow' && <ThenNow snapshot={snapshot} />}
          {tab === 'graft' && <Graft snapshot={snapshot} />}

          <footer className="foot">
            <span className="muted">
              Intent: <em>{snapshot.intent.goal}</em> · horizon {snapshot.intent.horizon} · source{' '}
              {snapshot.intent.source}
            </span>
            {snapshot.dossierUrl && (
              <a href={snapshot.dossierUrl} target="_blank" rel="noreferrer">
                Open dossier page
              </a>
            )}
          </footer>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="stat">
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}
