#!/usr/bin/env tsx
/**
 * decisions-runner
 *
 * The repository-side half of Decision as Code. Runs every `.decisions/*.decision`
 * file's tests and reports:
 *
 *   --json            machine-readable report on stdout
 *   --emit-statuses   write the Bitbucket commit-status payloads to a file,
 *                     so the pipeline can POST them with curl and the runner
 *                     never needs Bitbucket credentials itself
 *   --strict          exit non-zero on violations or parse errors (default)
 *   --no-strict       always exit 0, useful while adopting the tool
 *
 * Exit codes: 0 clean · 1 violations or parse errors · 2 usage error.
 */
import { writeFile } from 'node:fs/promises';

import { loadDecisionDirectory } from '../src/runner/load';
import { createHostExecutors } from '../src/runner/executors';
import { buildRunnerReport, formatText } from '../src/runner/report';
import { runAll } from '../src/decisions/runner';
import { createRecordedCaller, SANDBOX_PAGES } from '../src/graph/sandbox';
import type { GraphCaller } from '../src/graph/client';

interface Args {
  dir: string;
  root: string;
  json: boolean;
  emitStatuses: string | null;
  strict: boolean;
  graph: 'none' | 'sandbox';
  repoUrl?: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    dir: '.decisions',
    root: '.',
    json: false,
    emitStatuses: null,
    strict: true,
    graph: 'none',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--dir':
        args.dir = argv[++i] ?? args.dir;
        break;
      case '--root':
        args.root = argv[++i] ?? args.root;
        break;
      case '--json':
        args.json = true;
        break;
      case '--emit-statuses':
        args.emitStatuses = argv[++i] ?? 'statuses.json';
        break;
      case '--no-strict':
        args.strict = false;
        break;
      case '--graph':
        args.graph = (argv[++i] as Args['graph']) ?? 'none';
        break;
      case '--repo-url':
        args.repoUrl = argv[++i];
        break;
      case '--help':
        console.log('usage: decisions-runner [--dir .decisions] [--root .] [--json] [--emit-statuses file] [--no-strict] [--graph none|sandbox]');
        process.exit(0);
        break;
      default:
        if (arg?.startsWith('--')) {
          console.error(`unknown option: ${arg}`);
          process.exit(2);
        }
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const loaded = await loadDecisionDirectory(args.dir);
  if (args.dir !== '.decisions' || loaded.loaded.length > 0) {
    console.error(`loaded ${loaded.decisions.length} decision(s) from ${args.dir}`);
  }
  for (const error of loaded.errors) {
    console.error(`  ✗ ${error.path}: ${error.message}`);
  }

  let graph: GraphCaller | undefined;
  if (args.graph === 'sandbox') {
    graph = createRecordedCaller(SANDBOX_PAGES);
  }

  const executors = createHostExecutors({
    root: args.root,
    ...(graph ? { graph } : {}),
  });

  const decisions = await runAll(loaded.decisions, executors);
  const report = buildRunnerReport(decisions, loaded.errors.length, {
    ...(args.repoUrl ? { repoUrl: args.repoUrl } : {}),
  });

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('');
    console.log(formatText(report));
  }

  if (args.emitStatuses) {
    await writeFile(args.emitStatuses, JSON.stringify(report.statuses, null, 2));
    console.error(`\nwrote ${report.statuses.length} commit status(es) to ${args.emitStatuses}`);
  }

  const failed = report.violated > 0 || report.parseErrors > 0;
  if (failed && args.strict) process.exit(1);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
});
