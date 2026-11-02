import type { GraphCollection, GraphSource } from '../pipeline/run.js';
import type { RawArtifact } from '../graph/extract.js';

/**
 * Demo graph.
 *
 * A deterministic, seeded scenario so the product is end-to-end demonstrable
 * without Teamwork Graph access — during development, in a judge's fresh site,
 * and if the Preview API is unavailable on the day. The real source
 * (`createGraphSource`) is swapped in by configuration; nothing downstream
 * knows the difference.
 *
 * The scenario is deliberately small and legible on video: one billing-schema
 * decision, two alternatives, and two pieces of proof that an alternative was
 * actually built and shipped.
 */
export const DEMO_ARTIFACTS: RawArtifact[] = [
  {
    ari: 'ari:cloud:confluence::page/ADR-014',
    type: 'confluence-page',
    title: 'ADR-014: keep the billing schema unsharded',
    createdAt: '2026-03-12T10:00:00.000Z',
    authorAri: 'ari:cloud:identity::user/alice',
    areaKey: 'billing',
    dependentCount: 4,
    bodyText:
      'Options considered: range-shard by tenant, or keep a single schema. Decision outcome: keep a single schema for now.',
  },
  {
    ari: 'ari:cloud:confluence::page/DESIGN-shard',
    type: 'confluence-page',
    title: 'Design doc: sharded billing schema',
    createdAt: '2026-03-10T09:00:00.000Z',
    authorAri: 'ari:cloud:identity::user/carol',
    areaKey: 'billing',
    dependentCount: 0,
    bodyText:
      'Alternatives considered: range sharding by tenant. Consequences: two-week migration, removes the cross-tenant lock.',
  },
  {
    ari: 'ari:cloud:confluence::page/ADR-003',
    type: 'confluence-page',
    title: 'ADR-003: region-scoped single tenant schema',
    createdAt: '2026-01-05T08:00:00.000Z',
    authorAri: 'ari:cloud:identity::user/bob',
    areaKey: 'billing',
    dependentCount: 0,
    bodyText: 'Options considered: per-region schemas. Decision outcome: adopted.',
    outcome: 'passed',
  },
  {
    ari: 'ari:cloud:confluence::page/THREAD-ledger',
    type: 'confluence-page',
    title: 'RFC: event-sourced billing ledger',
    createdAt: '2026-07-01T09:00:00.000Z',
    authorAri: 'ari:cloud:identity::user/dan',
    areaKey: 'ledger',
    bodyText: 'Options considered: event sourcing versus mutable rows. Decision outcome: open.',
  },
  {
    ari: 'ari:cloud:external::build/77',
    type: 'external-build',
    title: 'payments-service build #77',
    createdAt: '2026-09-20T09:00:00.000Z',
    componentAri: 'ari:cloud:compass::component/payments',
    areaKey: 'billing',
    implementationProof: true,
    outcome: 'passed',
  },
  {
    ari: 'ari:cloud:external::deployment/12',
    type: 'external-deployment',
    title: 'payments-service deployment to prod-eu',
    createdAt: '2026-09-22T09:00:00.000Z',
    componentAri: 'ari:cloud:compass::component/payments',
    areaKey: 'billing',
    implementationProof: true,
    outcome: 'passed',
  },
];

export function createDemoSource(): GraphSource {
  return {
    async collect(): Promise<GraphCollection> {
      return {
        artifacts: DEMO_ARTIFACTS,
        scopeProbe: [],
        errorCode: null,
        traversalMs: 42,
      };
    },
  };
}
