/**
 * Offline renderer.
 *
 * Runs the real pipeline against the seeded graph and writes a standalone HTML
 * report. No Forge, no Jira, no browser host — this is the fastest way to see
 * exactly what the app produces, and it doubles as the demo artefact.
 *
 *   npx tsx scripts/render.ts
 */
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { runPipeline } from '../src/pipeline/run';
import { createDemoSource } from '../src/demo/seedSource';
import { parseIntentLocally } from '../src/domain/intent';
import type { RunSnapshotDto } from '../src/shared/dtos';
import type { Horizon } from '../src/shared/types';
import { buildDecisionReport } from '../src/decisions/service';
import { loadDecisionDirectory } from '../src/runner/load';
import { createHostExecutors } from '../src/runner/executors';

const CSS = readFileSync(new URL('../static/panel/src/styles.css', import.meta.url), 'utf8');

const NOW = new Date().toISOString();
const FAILURE_AT = new Date(Date.now() - 3 * 86_400_000).toISOString();

async function run(horizon: Horizon, intentText: string): Promise<RunSnapshotDto> {
  const result = await runPipeline(
    {
      runId: `render-${horizon}`,
      workItemKey: 'CX-11',
      intentText,
      horizon,
      failureAt: FAILURE_AT,
      createdAt: NOW,
    },
    {
      source: createDemoSource(),
      parseIntent: async (text, h) => parseIntentLocally(text, h),
      now: () => NOW,
    },
  );
  return result.snapshot;
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gapClass(gap: number): string {
  if (gap >= 0.15) return 'gap gap--high';
  if (gap >= 0.05) return 'gap gap--mid';
  return 'gap gap--low';
}

function shortAri(ari: string): string {
  const parts = ari.split('/');
  return parts[parts.length - 1] ?? ari;
}

function renderTree(snapshot: RunSnapshotDto): string {
  const nodeById = new Map(snapshot.nodes.map((n) => [n.id, n]));
  const byNode = new Map<string, RunSnapshotDto['branches']>();
  for (const branch of snapshot.branches) {
    const list = byNode.get(branch.nodeId) ?? [];
    list.push(branch);
    byNode.set(branch.nodeId, list);
  }

  const items = snapshot.spine
    .map((segment) => {
      const branches = byNode.get(segment.nodeId) ?? [];
      const branchHtml = branches
        .map(
          (branch) => `
        <li class="branch ${branch.taken ? 'branch--taken' : ''}">
          <div class="branch__top">
            <span class="pill ${branch.taken ? 'pill--taken' : 'pill--alt'}">${branch.taken ? 'taken' : 'alternative'}</span>
            <span class="${gapClass(branch.score.gap)}">gap ${branch.score.gap.toFixed(2)}</span>
            <span class="muted">${branch.evidenceArIs.length} evidence</span>
          </div>
          <p class="branch__label">${esc(branch.label)}</p>
          <p class="branch__scores">knowable ${branch.score.knowability.toFixed(2)} · viable ${branch.score.viability.toFixed(2)} · confidence ${branch.score.confidence.toFixed(2)}</p>
          <details class="branch__math">
            <summary>How this was scored</summary>
            <table><tbody>
              ${branch.score.arithmetic
                .map((step) => `<tr><th scope="row">${esc(step.label)}</th><td>${esc(step.expression)}</td><td class="num">${step.value.toFixed(3)}</td></tr>`)
                .join('')}
            </tbody></table>
          </details>
        </li>`,
        )
        .join('');

      return `
      <li class="spine__item">
        <div class="node ${segment.resolved ? '' : 'node--unresolved'}">
          <span class="node__order">${segment.order + 1}</span>
          <div class="node__body">
            <p class="node__title">${esc(segment.title)}</p>
            <p class="node__meta"><code>${esc(shortAri(segment.ari))}</code><span>·</span><span>${(nodeById.get(segment.nodeId)?.decidedAt ?? '').slice(0, 10)}</span><span>·</span><span>${segment.resolved ? 'resolved' : 'still open'}</span></p>
          </div>
        </div>
        ${branchHtml ? `<ul class="branches">${branchHtml}</ul>` : ''}
      </li>`;
    })
    .join('');

  return `
  <section class="card">
    <header class="card__head"><h2>Decision cascade</h2><span class="muted">${snapshot.spine.length} decisions on the spine</span></header>
    <ol class="spine">${items}</ol>
  </section>`;
}

function renderThenNow(snapshot: RunSnapshotDto): string {
  const rows = snapshot.thenNow
    .map(
      (row) => `
    <div class="thennow__pair">
      <div class="thennow__col">
        <div class="meter"><div class="meter__fill meter__fill--then" style="width:${row.knowability * 100}%"></div></div>
        <p class="meter__label">W_k ${row.knowability.toFixed(2)} · ${row.knowableArIs.length} object(s)</p>
        <p class="thennow__branch">${esc(row.label)}</p>
      </div>
      <div class="thennow__col">
        <div class="meter"><div class="meter__fill meter__fill--now" style="width:${row.viability * 100}%"></div></div>
        <p class="meter__label">W_v ${row.viability.toFixed(2)} · ${row.withheldArIs.length} withheld object(s)</p>
        <p class="thennow__gap">gap ${row.gap.toFixed(2)}</p>
      </div>
    </div>`,
    )
    .join('');

  return `
  <section class="card">
    <header class="card__head"><h2>Then vs now</h2><span class="muted">same evidence, two vantage points</span></header>
    <div class="thennow">
      <div class="thennow__col thennow__col--head">Knowable at the time</div>
      <div class="thennow__col thennow__col--head">Viable in hindsight</div>
      ${rows}
    </div>
  </section>`;
}

function renderGraft(snapshot: RunSnapshotDto): string {
  const rec = snapshot.recommendation;
  const graft = snapshot.graft;

  if (!rec) return '';
  if (rec.kind === 'noEvidencedPath') {
    return `<section class="card card--warn"><header class="card__head"><h2>No evidenced path</h2></header>
      <p class="lead">No reconstructed path satisfies the stated intent.</p>
      <p class="verdict">${esc(rec.failingCriterion)}</p>
      <p class="muted">${esc(rec.note)}</p></section>`;
  }
  if (!graft) return '';

  return `
  <section class="card">
    <header class="card__head"><h2>Recommended path</h2><span class="score">score ${rec.best.score.toFixed(2)}</span></header>
    <p class="verdict">${esc(rec.best.label)}</p>
    <div class="lanes">
      <div class="lane lane--keep"><h3>Keep <span class="lane__count">${graft.keep.length}</span></h3>
        <ul>${graft.keep.map((i) => `<li>${esc(i.title)}</li>`).join('') || '<li class="muted">Nothing to keep</li>'}</ul></div>
      <div class="lane lane--graft"><h3>Graft <span class="lane__count">1</span></h3><p>${esc(graft.graft.label)}</p></div>
      <div class="lane lane--unwind"><h3>Unwind <span class="lane__count">${graft.unwind.length}</span></h3>
        <ul>${graft.unwind.map((i) => `<li>${esc(i.title)} <span class="muted">· ${i.dependentCount} dependent object(s)</span></li>`).join('') || '<li class="muted">Nothing to unwind</li>'}</ul></div>
    </div>
  </section>`;
}

function renderRun(snapshot: RunSnapshotDto, intentText: string, label: string): string {
  return `
  <div class="run">
    <h2 class="run__title">${esc(label)}</h2>
    <p class="run__intent">Intent: <em>${esc(intentText)}</em> · horizon <strong>${snapshot.intent.horizon}</strong></p>
    <div class="stats">
      <div class="stat"><span class="stat__value">${snapshot.stats.nodeCount}</span><span class="stat__label">decisions</span></div>
      <div class="stat"><span class="stat__value">${snapshot.stats.branchCount}</span><span class="stat__label">branches</span></div>
      <div class="stat"><span class="stat__value">${snapshot.stats.evidenceCount}</span><span class="stat__label">evidence</span></div>
      <div class="stat"><span class="stat__value">${snapshot.stats.traversalMs}</span><span class="stat__label">graph ms</span></div>
      <div class="stat"><span class="stat__value">${snapshot.stats.scoringMs}</span><span class="stat__label">score ms</span></div>
    </div>
    ${renderGraft(snapshot)}
    ${renderTree(snapshot)}
    ${renderThenNow(snapshot)}
  </div>`;
}

const weeksIntent = 'Restore the build this week without adding a new dependency #no-new-dependency';
const yearsIntent = 'Reduce maintenance burden over the next year';

async function caseBaseHtml(): Promise<string> {
  const loaded = await loadDecisionDirectory('examples/decision-repo/.decisions');
  const report = await buildDecisionReport(
    loaded.decisions,
    createHostExecutors({ root: 'examples/decision-repo' }),
  );

  const rows = report.decisions
    .map(
      (d) => `<tr>
        <td><span class="status status--${d.status}">${d.status}</span></td>
        <td>${esc(d.decision)}</td>
        <td class="num">${d.passed}✓ ${d.failed}✗ ${d.skipped}⤼</td>
        <td class="muted">${esc(d.results[0]?.evidence.slice(0, 70) ?? '')}</td>
      </tr>`,
    )
    .join('');

  const growth = report.growth
    .map((point) => {
      const confidence = point.top?.confidence ?? 0;
      return `<div class="growth__col">
        <div class="growth__value">${point.top ? point.top.confidence.toFixed(2) : '—'}</div>
        <div class="growth__track"><div class="growth__bar ${point.top ? 'growth__bar--on' : ''}" style="height:${Math.max(4, confidence * 100)}%"></div></div>
        <div class="growth__label">${point.n}</div>
      </div>`;
    })
    .join('');

  const patterns = report.patterns
    .map(
      (p) => `<li class="pattern">
        <div class="pattern__top"><span class="pattern__conf">${p.confidence.toFixed(2)}</span>
        <span class="pattern__support">${p.confirmations} held · ${p.refutations} refuted</span></div>
        <p class="pattern__text">${esc(p.patternText)}</p>
      </li>`,
    )
    .join('');

  return `
  <section class="card">
    <header class="card__head"><h2>Case base</h2>
      <span class="muted">${report.testability.testable} of ${report.testability.total} decisions are machine-checkable</span></header>
    <div class="stats">
      <div class="stat stat--good"><span class="stat__value">${report.counts.enforced}</span><span class="stat__label">enforced</span></div>
      <div class="stat stat--bad"><span class="stat__value">${report.counts.violated}</span><span class="stat__label">violated</span></div>
      <div class="stat stat--warn"><span class="stat__value">${report.counts.orphaned}</span><span class="stat__label">orphaned</span></div>
      <div class="stat"><span class="stat__value">${Math.round(report.testability.rate * 100)}%</span><span class="stat__label">testable</span></div>
      <div class="stat"><span class="stat__value">${report.patterns.length}</span><span class="stat__label">patterns</span></div>
    </div>
    <div class="growth">${growth}</div>
    <ul class="patterns">${patterns}</ul>
    <table class="results"><tbody>${rows}</tbody></table>
  </section>`;
}

async function main(): Promise<void> {
const [weeks, years] = await Promise.all([
  run('weeks', weeksIntent),
  run('years', yearsIntent),
]);

const weeksBest = weeks.recommendation?.kind === 'graft' ? weeks.recommendation.best.label : 'none';
const yearsBest = years.recommendation?.kind === 'graft' ? years.recommendation.best.label : 'none';

const caseBase = await caseBaseHtml();

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Cascade — offline report</title>
<style>${CSS}
  body { padding: 24px; }
  .run { display: flex; flex-direction: column; gap: 16px; margin-bottom: 40px; }
  .run__title { font-size: 20px; margin: 0; }
  .run__intent { margin: 0; color: #6b778c; }
  .flip { background: #0b1220; color: #fff; padding: 16px 18px; border-radius: 10px; }
  .flip code { background: rgba(255,255,255,.12); padding: 2px 6px; border-radius: 4px; }
</style></head>
<body>
  <div class="panel">
    <header class="panel__head">
      <div>
        <h1>Cascade <span class="panel__issue">CX-11</span></h1>
        <p class="muted">Offline render of the real engine against the seeded graph. No Forge, no Jira.</p>
      </div>
    </header>

    <div class="flip">
      <strong>The same evidence, two intents:</strong>
      week horizon recommends <code>${esc(weeksBest)}</code>;
      year horizon recommends <code>${esc(yearsBest)}</code>.
    </div>

    ${caseBase}

    ${renderRun(weeks, weeksIntent, 'Run 1 — restore service this week')}
    ${renderRun(years, yearsIntent, 'Run 2 — reduce maintenance over a year')}
  </div>
</body></html>`;

mkdirSync('demo', { recursive: true });
writeFileSync('demo/report.html', html);

console.log('wrote demo/report.html');
console.log(`weeks  -> ${weeksBest}`);
console.log(`years  -> ${yearsBest}`);
console.log(`same answer? ${weeksBest === yearsBest ? 'YES (bad)' : 'NO (good)'}`);

}

void main();
