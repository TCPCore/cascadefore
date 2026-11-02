import api, { route } from '@forge/api';

/**
 * Diagnostic: can this app reach the Teamwork Graph endpoint at all, and as whom?
 *
 * Teamwork Graph documents say calls run as the current user and that apps
 * cannot call it as themselves. That claim decides the whole integration
 * strategy, so it is worth one probe rather than an assumption.
 */
export async function probeGraphAction(): Promise<Record<string, unknown>> {
  const query = 'query { echo(myString: "cascade-probe") }';
  const results: Record<string, unknown> = {};

  interface MinimalResponse {
    status: number;
    text(): Promise<string>;
  }

  const attempts: Array<[string, () => Promise<MinimalResponse>]> = [
    [
      'asApp',
      () =>
        api.asApp().requestJira(route`/gateway/api/graphql/twg`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query }),
        }),
    ],
    [
      'asUser',
      () =>
        api.asUser().requestJira(route`/gateway/api/graphql/twg`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query }),
        }),
    ],
  ];

  for (const [label, run] of attempts) {
    try {
      const response = await run();
      const text = await response.text();
      results[label] = { status: response.status, body: text.slice(0, 400) };
    } catch (error) {
      results[label] = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  return results;
}
