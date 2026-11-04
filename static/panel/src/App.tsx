import { useCallback, useEffect, useState } from 'react';

import type { RunSnapshotDto } from '../../../src/shared/dtos';
import type { Horizon } from '../../../src/shared/types';
import { getRun, health, isStandalone, startCascade, type Health, type RunView,
} from './api';
import { EmptyState } from './components/EmptyState';
import { Graft } from './components/Graft';
import { ThenNow } from './components/ThenNow';
import { CaseBase } from './components/CaseBase';
import { recentPages, recentRuns, recentWorkItems, type PageOption, type RunOption, type WorkItemOption } from './api';
import { Forensic } from './components/Forensic';
import { DecisionExplorer } from './components/DecisionExplorer';

type Phase = 'idle' | 'working' | 'done' | 'error';
type Tab = 'tree' | 'thennow' | 'graft';

const DEFAULT_GOAL = 'Restore the build this week without adding a new dependency #no-new-dependency';

/** Mirrors src/domain/events.ts — the host decides which kinds it can anchor. */
const EVENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'build-failure', label: 'Build failure' },
  { value: 'incident', label: 'Incident' },
  { value: 'deployment', label: 'Deployment' },
  { value: 'task', label: 'Task / work item' },
  { value: 'milestone', label: 'Milestone / release' },
  { value: 'service-change', label: 'Service change' },
];

export function App(): JSX.Element {
  const [issueKey, setIssueKey] = useState('');
  // A Confluence page id switches the source to the live thread on that page.
  const [pageId, setPageId] = useState('');
  // Records pulled from the platform, so the form offers choices.
  const [workItems, setWorkItems] = useState<WorkItemOption[]>([]);
  const [pages, setPages] = useState<PageOption[]>([]);
  const [runs, setRuns] = useState<RunOption[]>([]);
  const [healthState, setHealthState] = useState<Health | null>(null);
  const [intentText, setIntentText] = useState(DEFAULT_GOAL);
  const [horizon, setHorizon] = useState<Horizon>('weeks');
  const [eventKind, setEventKind] = useState('build-failure');
  const [phase, setPhase] = useState<Phase>('idle');
  const [snapshot, setSnapshot] = useState<RunSnapshotDto | null>(null);
  // The run view carries the forensic layer (timeline + counterfactuals) that the
  // snapshot does not.
  const [runView, setRunView] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('tree');
  const [elapsed, setElapsed] = useState(0);
  const [mode, setMode] = useState<'run' | 'cases'>('run');

  useEffect(() => {
    void recentWorkItems().then(setWorkItems).catch(() => setWorkItems([]));
    void recentPages().then(setPages).catch(() => setPages([]));
    void recentRuns().then(setRuns).catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    void health().then((state) => {
      setHealthState(state);
      if (state.workItemKey) setIssueKey(state.workItemKey);
    });
    if (isStandalone) return;
    void import('@forge/bridge')
      .then(({ view }) => view.getContext())
      .then((context: unknown) => {
        const ctx = context as {
          extension?: { type?: string; issue?: { key?: string } };
          issueKey?: string;
        };
        setIssueKey(ctx.extension?.issue?.key ?? ctx.issueKey ?? '');
        // A dashboard gadget has no issue and no room for the reconstruction
        // form, so it opens straight into the case base.
        if (ctx.extension?.type === 'jira:dashboardGadget') {
          setMode('cases');
          setIssueKey(ctx.issueKey ?? 'dashboard');
        }

        // Full-page surfaces (global page, admin page) have no issue, so there is
        // nothing to reconstruct by default. Open the case base instead of showing
        // a disabled Run button and the words "no work item".
        const key = ctx.extension?.issue?.key ?? ctx.issueKey ?? '';
        if (!key) setMode('cases');
      })
      .catch(() => setIssueKey(''));
  }, []);

  useEffect(() => {
    if (phase !== 'working') return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [phase]);

  const openRun = useCallback(async (runId: string) => {
    setPhase('working');
    setError(null);
    try {
      const result = await getRun(runId);
      if (result.snapshot) {
        setSnapshot(result.snapshot);
        setRunView(result);
        setPhase('done');
      } else {
        setError(result.message ?? 'That run could not be loaded.');
        setPhase('error');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load that run.');
      setPhase('error');
    }
  }, []);

  const run = useCallback(async () => {
    setPhase('working');
    setError(null);
    setSnapshot(null);
    setRunView(null);
    setElapsed(0);

    try {
      const started = await startCascade({
        workItemKey: issueKey,
        intentText,
        horizon,
        eventKind,
        ...(pageId.trim() ? { pageId: pageId.trim() } : {}),
      });
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
          setRunView(result);
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
  }, [horizon, intentText, issueKey, eventKind]);

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

      <nav className="modes" aria-label="View">
        <button
          className={`mode ${mode === 'run' ? 'mode--active' : ''}`}
          onClick={() => setMode('run')}
        >
          Reconstruction
        </button>
        <button
          className={`mode ${mode === 'cases' ? 'mode--active' : ''}`}
          onClick={() => setMode('cases')}
        >
          Case base
        </button>
      </nav>

      {mode === 'cases' && <CaseBase />}

      {mode === 'run' && (
      <>
      {runs.length > 0 && (
        <section className="card">
          <h2>Recent reconstructions</h2>
          <p className="muted">Pulled from this installation's ledger — pick one to reopen it.</p>
          <ul className="runs">
            {runs.slice(0, 8).map((item) => (
              <li key={item.runId} className="runs__row">
                <button className="link" onClick={() => void openRun(item.runId)}>
                  {item.workItemKey}
                </button>
                <span className="badge badge--evidence">{item.status}</span>
                <span className="muted">{item.createdAt.slice(0, 16).replace('T', ' ')}</span>
                <span className="badge badge--decision">{item.evidenceSource}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <label className="field">
          <span>Work item {workItems.length > 0 ? `· ${workItems.length} recent` : ''}</span>
          {workItems.length > 0 ? (
            <select value={issueKey} onChange={(event) => setIssueKey(event.target.value)}>
              <option value="">Choose a recent work item…</option>
              {workItems.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key} — {item.summary.slice(0, 60)}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={issueKey}
              placeholder="LEO-47"
              onChange={(event) => setIssueKey(event.target.value)}
            />
          )}
        </label>

        <label className="field">
          <span>Confluence page {pages.length > 0 ? `· ${pages.length} recent` : '(optional)'}</span>
          {pages.length > 0 ? (
            <select value={pageId} onChange={(event) => setPageId(event.target.value)}>
              <option value="">None — use the seeded graph</option>
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.title.slice(0, 70)} · {page.createdAt.slice(0, 10)}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={pageId}
              placeholder="2129941"
              onChange={(event) => setPageId(event.target.value)}
            />
          )}
        </label>

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
            <span>Event</span>
            <select value={eventKind} onChange={(event) => setEventKind(event.target.value)}>
              {EVENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field field--inline">
            <span>Horizon</span>
            <select value={horizon} onChange={(event) => setHorizon(event.target.value as Horizon)}>
              <option value="weeks">Weeks — restore service</option>
              <option value="quarters">Quarters — stabilise</option>
              <option value="years">Years — reduce maintenance</option>
            </select>
          </label>

          <button className="btn" onClick={() => void run()} disabled={phase === 'working' || !issueKey.trim()}>
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
                ['forensic', 'Forensic view'],
                ['tree', 'Decision tree'],
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

          {tab === 'forensic' &&
            (runView?.timeline ? (
              <Forensic
                timeline={runView.timeline}
                counterfactuals={runView.counterfactuals ?? []}
                anchorAt={runView.snapshot?.event.at ?? snapshot.event.at}
              />
            ) : (
              <section className="card">
                <h2>Forensic view unavailable</h2>
                <p className="muted">
                  This run has no timeline attached. The reconstruction itself completed — this is a
                  read-path problem, not a missing run. Reload the panel; if it persists, the
                  resolver returned a snapshot without the forensic layer.
                </p>
              </section>
            ))}
          {tab === 'tree' && <DecisionExplorer snapshot={snapshot} />}
          {tab === 'thennow' && <ThenNow snapshot={snapshot} />}
          {tab === 'graft' && <Graft snapshot={snapshot} />}

          <footer className="foot">
            <span className="muted">
              Graph around: <strong>{snapshot.event.title}</strong> · {snapshot.event.kind} ·{' '}
              {snapshot.event.at.slice(0, 10)} — intent: <em>{snapshot.intent.goal}</em> · horizon{' '}
              {snapshot.intent.horizon}
            </span>
            {snapshot.dossierUrl && (
              <a href={snapshot.dossierUrl} target="_blank" rel="noreferrer">
                Open dossier page
              </a>
            )}
          </footer>
        </>
      )}
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
