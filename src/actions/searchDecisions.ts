import { searchDecisions, whyIsThisLikeThis } from '../decisions/search';

function input(event: unknown): Record<string, unknown> {
  if (!event || typeof event !== 'object') return {};
  const record = event as Record<string, unknown>;
  return (record.input ?? record.payload ?? record) as Record<string, unknown>;
}

export async function searchDecisionsAction(event: unknown): Promise<Record<string, unknown>> {
  const payload = input(event);
  try {
    return (await searchDecisions({
      text: typeof payload.text === 'string' ? payload.text : undefined,
      area: typeof payload.area === 'string' ? payload.area : undefined,
      status: typeof payload.status === 'string' ? payload.status : undefined,
      limit: typeof payload.limit === 'number' ? payload.limit : undefined,
    })) as unknown as Record<string, unknown>;
  } catch (error) {
    return { error: 'SEARCH_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
}

export async function whyIsThisLikeThisAction(event: unknown): Promise<Record<string, unknown>> {
  const payload = input(event);
  const subject =
    (typeof payload.subject === 'string' && payload.subject) ||
    (typeof payload.path === 'string' && payload.path) ||
    (typeof payload.issueKey === 'string' && payload.issueKey) ||
    (typeof payload.pageId === 'string' && payload.pageId) ||
    (typeof payload.text === 'string' && payload.text) ||
    '';

  if (!subject) {
    return {
      error: 'NO_SUBJECT',
      message: 'Pass what you are asking about: a technology, a constraint, an issue key or a page id.',
    };
  }

  try {
    return (await whyIsThisLikeThis({ subject })) as unknown as Record<string, unknown>;
  } catch (error) {
    return { error: 'WHY_FAILED', message: error instanceof Error ? error.message : String(error) };
  }
}
