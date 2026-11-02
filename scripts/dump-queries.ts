import { writeFileSync } from 'node:fs';
import { QUERY_CATALOG, scopesFor } from '../src/graph/queries';

const lines: string[] = [
  '# Teamwork Graph queries — paste into TWG Labs',
  '',
  'Open <https://teamwork-graph.atlassian.com/query-builder>, select the site, and',
  'paste each query below into the editor. The builder validates syntax and schema',
  'before you save, so a validation error here is exactly what we need to see.',
  '',
  'Do them in order and stop at the first failure — each one builds on the last.',
  '',
];

for (const [index, query] of QUERY_CATALOG.entries()) {
  lines.push(`## ${index + 1}. ${query.key} — ${query.name}`, '', query.description, '');
  lines.push('**Scopes it needs**', '');
  for (const scope of scopesFor(query)) lines.push(`- \`${scope}\``);
  lines.push('', '```cypher', query.cypher.trim(), '```', '');
  lines.push('---', '');
}

lines.push(
  '## What to send back',
  '',
  'For each query: **validated and saved** (then paste the generated query key), or',
  'the **validation error text** verbatim. The error names the offending',
  'relationship or object type, which is the thing I cannot guess from the docs.',
  '',
);

writeFileSync('docs/queries-for-twg-labs.md', lines.join('\n'));
console.log('wrote docs/queries-for-twg-labs.md');
