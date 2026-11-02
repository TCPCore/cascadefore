import type { Ari, Iso } from '../shared/types';

/**
 * Cascade is not a build-failure tool.
 *
 * Anything that happened in the graph can anchor a reconstruction: a failed
 * build, an incident, a deployment, a closed task, a release, a service change.
 * The event kind determines which object types the traversal anchors on and how
 * the failure terminal is located — everything downstream (scoring, ranking,
 * projection) is identical, which is why one engine covers all of them.
 */
export type EventKind =
  | 'build-failure'
  | 'incident'
  | 'deployment'
  | 'task'
  | 'milestone'
  | 'service-change';

export interface EventContext {
  kind: EventKind;
  subjectKey: string;
  subjectAri: Ari;
  title: string;
  at: Iso;
}

export interface EventKindSpec {
  kind: EventKind;
  label: string;
  description: string;
  /** Graph object types the traversal anchors on for this event kind. */
  anchors: string[];
  /** Where the "terminal" sits, used by the extractor to order the spine. */
  terminal: 'external-build' | 'external-deployment' | 'jira-work-item' | 'compass-component';
}

export const EVENT_KINDS: EventKindSpec[] = [
  {
    kind: 'build-failure',
    label: 'Build failure',
    description: 'A pipeline went red and something upstream decided it could.',
    anchors: ['ExternalBuild', 'ExternalCommit', 'JiraWorkItem'],
    terminal: 'external-build',
  },
  {
    kind: 'incident',
    label: 'Incident',
    description: 'Production degraded; reconstruct what made it possible.',
    anchors: ['JiraWorkItem', 'ExternalDeployment', 'CompassComponent'],
    terminal: 'jira-work-item',
  },
  {
    kind: 'deployment',
    label: 'Deployment',
    description: 'A release shipped and changed behaviour; trace the decisions behind it.',
    anchors: ['ExternalDeployment', 'ExternalBuild', 'CompassComponent'],
    terminal: 'external-deployment',
  },
  {
    kind: 'task',
    label: 'Task or work item',
    description: 'A work item closed, was cancelled, or slipped — reconstruct why.',
    anchors: ['JiraWorkItem', 'JiraWorkItemStatus', 'JiraWorkItemComment'],
    terminal: 'jira-work-item',
  },
  {
    kind: 'milestone',
    label: 'Milestone or release',
    description: 'A version shipped late or was cut; walk back through scope decisions.',
    anchors: ['JiraVersion', 'JiraSprint', 'JiraWorkItem'],
    terminal: 'jira-work-item',
  },
  {
    kind: 'service-change',
    label: 'Service change',
    description: 'A component was created, split or retired; trace the architecture decisions.',
    anchors: ['CompassComponent', 'CompassComponentLink', 'JiraWorkItem'],
    terminal: 'compass-component',
  },
];

export function specFor(kind: EventKind): EventKindSpec {
  return EVENT_KINDS.find((spec) => spec.kind === kind) ?? EVENT_KINDS[0]!;
}

export function isEventKind(value: unknown): value is EventKind {
  return typeof value === 'string' && EVENT_KINDS.some((spec) => spec.kind === value);
}

export function makeEvent(input: {
  kind?: EventKind;
  subjectKey: string;
  subjectAri?: Ari;
  title?: string;
  at: Iso;
}): EventContext {
  const kind = input.kind ?? 'build-failure';
  const spec = specFor(kind);
  return {
    kind,
    subjectKey: input.subjectKey,
    subjectAri: input.subjectAri ?? `ari:cloud:jira::issue/${input.subjectKey}`,
    title: input.title ?? `${spec.label} ${input.subjectKey}`,
    at: input.at,
  };
}
