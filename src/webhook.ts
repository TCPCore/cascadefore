/**
 * App-scoped HTTP surface.
 *
 * A plain URL that runs inside the Atlassian runtime with no user session. The
 * panel needs a browser session and MCP needs an OAuth client; this needs
 * neither, so it is the fastest way to see the product actually working inside
 * the account.
 *
 * Actions:
 *   ?action=health    — is the app alive, is demo mode on
 *   ?action=replay    — run the full pipeline, write Forge SQL, read it back
 *   ?action=cases     — the case base as JSON
 */
import { repository } from './bootstrap';
import { projectTreeFor } from './actions/projectTree';
import { findPrecedentFor } from './actions/findPrecedent';
import { decisionMatrixAction } from './actions/decisionMatrix';
import { searchDecisionsAction, whyIsThisLikeThisAction } from './actions/searchDecisions';
import { forgeSqlDriver as sqlDriver } from './storage/forgeDriver';
import { persistStatements } from './storage/runs';
import { ensureSchema } from './storage/schema';
import { runPipeline } from './pipeline/run';
import { createDemoSource } from './demo/seedSource';
import { parseIntentLocally } from './domain/intent';
import { computeCaseBase, buildDecisionReport } from './decisions/service';
import { loadSeedDecisions, createFixtureExecutors } from './decisions/seed';

const json = (body: unknown, status = 200) => ({
  statusCode: status,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(body, null, 2),
});

const DIAGNOSTIC_ACTIONS = new Set(['replay', 'sqlprobe']);

export async function handler(event: { queryParameters?: Record<string, string[]> }) {
  const params = event.queryParameters ?? {};
  const action = params.action?.[0] ?? 'health';

  // `replay` writes to Forge SQL and `sqlprobe` executes statements. An
  // unguessable URL is not authorisation, so both are off unless the operator
  // has explicitly set a token on the environment and supplied it here.
  if (DIAGNOSTIC_ACTIONS.has(action)) {
    const token = process.env.CASCADE_DIAGNOSTIC_TOKEN;
    if (!token || params.token?.[0] !== token) {
      return json(
        {
          ok: false,
          error: 'DIAGNOSTIC_DISABLED',
          message: 'This action requires CASCADE_DIAGNOSTIC_TOKEN and a matching ?token=.',
        },
        403,
      );
    }
  }

  try {
    if (action === 'health') {
      return json({
        ok: true,
        surface: 'webtrigger',
        runtime: 'forge',
        demoMode: process.env.CASCADE_DEMO_MODE === 'true',
        appId: process.env.CASCADE_APP_ID ?? null,
        now: new Date().toISOString(),
      });
    }

    if (action === 'sqlprobe') {
      const now = new Date().toISOString();
      const runId = `probe_${Date.now().toString(36)}`;
      const { snapshot, nodes } = await runPipeline(
        {
          runId,
          workItemKey: 'LEO-47',
          intentText: 'restore the build this week',
          horizon: 'weeks',
          failureAt: now,
          createdAt: now,
        },
        {
          source: createDemoSource(),
          parseIntent: async (text, horizon) => parseIntentLocally(text, horizon),
          now: () => now,
        },
      );

      const results: Array<Record<string, unknown>> = [];
      try {
        await ensureSchema(sqlDriver);
        results.push({ step: 'schema', ok: true });
      } catch (error) {
        results.push({ step: 'schema', ok: false, error: String(error) });
      }

      const statements = persistStatements(snapshot, nodes);
      for (const [index, statement] of statements.entries()) {
        const head = statement.text.slice(0, 60).replace(/\s+/g, ' ');
        try {
          await sqlDriver.query(statement.text, statement.params);
          results.push({ step: index, ok: true, sql: head, params: statement.params.length });
        } catch (error) {
          results.push({
            step: index,
            ok: false,
            sql: head,
            params: statement.params.length,
            error: error instanceof Error ? error.message : String(error),
          });
          break;
        }
      }

      return json({ ok: true, statements: results });
    }

    if (action === 'search') {
      return json({
        ok: true,
        ...(await searchDecisionsAction({
          input: { text: params.text?.[0], area: params.area?.[0], status: params.status?.[0] },
        })),
      });
    }

    if (action === 'why') {
      return json({
        ok: true,
        ...(await whyIsThisLikeThisAction({ input: { subject: params.subject?.[0] } })),
      });
    }

    if (action === 'matrix') {
      return json({ ok: true, ...(await decisionMatrixAction({ input: { groupBy: params.groupBy?.[0] } })) });
    }

    if (action === 'precedent') {
      return json({
        ok: true,
        ...findPrecedentFor({
          alternativeText: params.alternativeText?.[0],
          asOf: params.asOf?.[0],
          area: params.area?.[0],
        }),
      });
    }

    if (action === 'project') {
      const runId = params.runId?.[0];
      if (!runId) return json({ ok: false, error: 'runId required' }, 400);

      const result = await projectTreeFor({
        runId,
        asOf: params.asOf?.[0],
        direction: params.direction?.[0],
        depth: params.depth?.[0],
      });

      return json(
        result.ok
          ? { ok: true, ...result.projection }
          : { ok: false, error: result.error, message: result.message },
      );
    }

    if (action === 'cases') {
      const base = await computeCaseBase();
      return json({ ok: true, caseBase: base });
    }

    if (action === 'replay') {
      const now = new Date().toISOString();
      const runId = `wt_${Date.now().toString(36)}`;

      const { snapshot, nodes } = await runPipeline(
        {
          runId,
          workItemKey: params.workItemKey?.[0] ?? 'LEO-47',
          intentText: params.intent?.[0] ?? 'restore the build this week',
          horizon: 'weeks',
          failureAt: now,
          createdAt: now,
        },
        {
          source: createDemoSource(),
          parseIntent: async (text, horizon) => parseIntentLocally(text, horizon),
          now: () => now,
        },
      );

      await repository().save(snapshot, nodes);
      const restored = await repository().get(runId);
      // Reports are incidental to the round trip; a failure here must not hide
      // whether the run itself succeeded.
      let caseBase: unknown = null;
      let report: unknown = null;
      try {
        const decisions = loadSeedDecisions();
        const base = await computeCaseBase(decisions, createFixtureExecutors());
        const built = await buildDecisionReport(decisions, createFixtureExecutors());
        caseBase = {
          decisions: base.report.decisions.length,
          patterns: base.report.patterns.length,
          testability: base.report.testability.rate,
          counts: base.report.counts,
        };
        report = {
          decisions: built.decisions.length,
          firstDecision: built.decisions[0]?.id ?? null,
        };
      } catch (error) {
        caseBase = { error: error instanceof Error ? error.message : String(error) };
      }

      return json({
        ok: Boolean(restored),
        surface: 'webtrigger',
        runId,
        wroteToForgeSql: true,
        readBack: Boolean(restored),
        status: restored?.status ?? null,
        decisions: restored?.nodes.length ?? 0,
        branches: restored?.branches.length ?? 0,
        counterfactuals: restored?.counterfactuals.length ?? 0,
        evidenceSource: restored?.evidenceSource ?? null,
        caseBase,
        report,
      });
    }

    return json({ ok: false, error: 'unknown action', actions: ['health', 'replay', 'cases'] }, 400);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
