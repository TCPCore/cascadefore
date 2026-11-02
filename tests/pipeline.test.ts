import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/pipeline/run';
import { createDemoSource } from '../src/demo/seedSource';
import { parseIntentLocally } from '../src/domain/intent';
import type { GraphSource } from '../src/pipeline/run';

const NOW = '2026-11-01T12:00:00.000Z';
const FAILURE_AT = '2026-10-14T09:00:00.000Z';
const CREATED_AT = '2026-10-14T09:05:00.000Z';

function deps(source: GraphSource = createDemoSource()) {
  return {
    source,
    parseIntent: async (text: string, horizon?: Parameters<typeof parseIntentLocally>[1]) =>
      parseIntentLocally(text, horizon),
    now: () => NOW,
  };
}

function input(intentText: string, horizon: 'weeks' | 'years') {
  return {
    runId: 'run_test',
    workItemKey: 'BILL-142',
    intentText,
    horizon,
    failureAt: FAILURE_AT,
    createdAt: CREATED_AT,
  };
}

describe('pipeline end to end (seeded graph)', () => {
  it('produces a loaded snapshot with a spine and scored branches', async () => {
    const { snapshot, nodes } = await runPipeline(
      input('Restore the build this week', 'weeks'),
      deps(),
    );
    expect(snapshot.status).toBe('loaded');
    expect(snapshot.nodes.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.spine.length).toBeGreaterThanOrEqual(3);
    expect(snapshot.branches.length).toBeGreaterThan(0);
    expect(nodes.length).toBe(snapshot.nodes.length);
    expect(snapshot.stats.traversalMs).toBeGreaterThan(0);
  });

  it('every rendered branch carries at least one evidence ARI', async () => {
    const { snapshot } = await runPipeline(input('Restore the build this week', 'weeks'), deps());
    for (const branch of snapshot.branches) {
      expect(branch.evidenceArIs.length).toBeGreaterThan(0);
      for (const ari of branch.evidenceArIs) {
        expect(ari).toMatch(/^ari:cloud:/);
      }
    }
  });

  it('every tree node carries an ARI', async () => {
    const { snapshot } = await runPipeline(input('Restore the build this week', 'weeks'), deps());
    for (const node of snapshot.nodes) {
      expect(node.ari.length).toBeGreaterThan(0);
    }
  });

  it('flips the recommendation when the horizon flips', async () => {
    const weeks = await runPipeline(input('Restore the build this week', 'weeks'), deps());
    const years = await runPipeline(input('Reduce maintenance burden over the next year', 'years'), deps());

    expect(weeks.snapshot.recommendation?.kind).toBe('graft');
    expect(years.snapshot.recommendation?.kind).toBe('graft');
    if (weeks.snapshot.recommendation?.kind !== 'graft') return;
    if (years.snapshot.recommendation?.kind !== 'graft') return;

    expect(weeks.snapshot.recommendation.best.branchId).not.toBe(
      years.snapshot.recommendation.best.branchId,
    );
  });

  it('exposes the then/now split for every branch', async () => {
    const { snapshot } = await runPipeline(input('Restore the build this week', 'weeks'), deps());
    expect(snapshot.thenNow).toHaveLength(snapshot.branches.length);
    for (const row of snapshot.thenNow) {
      expect(row.knowability).toBeGreaterThanOrEqual(0);
      expect(row.knowability).toBeLessThanOrEqual(1);
      expect(row.viability).toBeGreaterThanOrEqual(0);
      expect(row.viability).toBeLessThanOrEqual(1);
    }
  });

  it('reports empty (not failed) when the graph yields nothing', async () => {
    const empty: GraphSource = {
      async collect() {
        return {
          artifacts: [],
          scopeProbe: [{ objectType: 'ConfluencePage', scope: 'read:graph:page:confluence', yielded: false }],
          errorCode: null,
          traversalMs: 5,
          evidenceSource: 'graph',
        };
      },
    };
    const { snapshot } = await runPipeline(input('Restore the build this week', 'weeks'), {
      ...deps(empty),
    });
    expect(snapshot.status).toBe('empty');
    expect(snapshot.scopeProbe).toHaveLength(1);
    expect(snapshot.recommendation).toBeNull();
  });

  it('reports failed when the graph returns an error code', async () => {
    const failing: GraphSource = {
      async collect() {
        return {
          artifacts: [],
          scopeProbe: [],
          errorCode: 'FEATURE_UNAVAILABLE',
          traversalMs: 3,
          evidenceSource: 'graph',
        };
      },
    };
    const { snapshot } = await runPipeline(input('Restore the build this week', 'weeks'), deps(failing));
    expect(snapshot.status).toBe('failed');
    expect(snapshot.errorCode).toBe('FEATURE_UNAVAILABLE');
  });

  it('survives a dossier write failure without losing the run', async () => {
    const { snapshot } = await runPipeline(input('Restore the build this week', 'weeks'), {
      ...deps(),
      writeDossier: async () => {
        throw new Error('confluence down');
      },
    });
    expect(snapshot.status).toBe('loaded');
    expect(snapshot.dossierUrl).toBeNull();
  });
});

describe('pipeline against recorded live graph data', () => {
  it('reconstructs decisions from real Confluence comments', async () => {
    const { createLiveGraphSource, LIVE_ARTIFACTS } = await import('../src/demo/liveGraph');
    const { snapshot } = await runPipeline(input('restore the build this week', 'weeks'), {
      source: createLiveGraphSource(),
      parseIntent: async (text, horizon) => parseIntentLocally(text, horizon),
      now: () => NOW,
    });

    expect(snapshot.status).toBe('loaded');
    // One decision, three positions — a thread is a decision, not three.
    expect(snapshot.nodes.length).toBe(1);
    expect(snapshot.branches.length).toBe(3);

    // Real ARIs, so anything the UI links resolves on the site.
    for (const node of snapshot.nodes) {
      expect(node.ari).toMatch(/^ari:cloud:confluence:e264c23b/);
    }

    // The node is the page; the branches are the positions people took.
    expect(snapshot.nodes[0]?.title).toMatch(/Mobile Development Strategy/);
    const positions = snapshot.branches.map((b) => b.label);
    expect(new Set(positions).size).toBe(3);
    expect(positions.some((l) => /Finance/i.test(l))).toBe(true);

    // The resolution in plain speech is the taken branch.
    const taken = snapshot.branches.find((b) => b.taken);
    expect(taken?.label).toMatch(/Yes, for now/i);

    expect(LIVE_ARTIFACTS.length).toBe(5);
  });
});

describe('evidence provenance', () => {
  it('is declared by the source, not by the caller', async () => {
    const { createLiveGraphSource } = await import('../src/demo/liveGraph');
    const { snapshot } = await runPipeline(input('restore the build this week', 'weeks'), {
      source: createLiveGraphSource(),
      parseIntent: async (text, horizon) => parseIntentLocally(text, horizon),
      now: () => NOW,
    });
    expect(snapshot.evidenceSource).toBe('real_confluence_thread');
  });

  it('marks the seeded fixture as a fixture', async () => {
    const { snapshot } = await runPipeline(input('restore the build this week', 'weeks'), deps());
    expect(snapshot.evidenceSource).toBe('seeded_fixture');
  });

  it('ignores a caller-supplied evidenceSource', async () => {
    const { snapshot } = await runPipeline(
      { ...input('restore the build this week', 'weeks'), evidenceSource: 'real_confluence_thread' },
      deps(),
    );
    // The source wins: a fixture cannot be relabelled by configuration.
    expect(snapshot.evidenceSource).toBe('seeded_fixture');
  });
});
