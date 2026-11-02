#!/usr/bin/env node
/**
 * Switches this codebase between its two Marketplace identities.
 *
 *   node scripts/set-app.mjs demo <appId>   -> unlicensed, shareable via install link
 *   node scripts/set-app.mjs mkt  <appId>   -> licensed, submitted for listing
 *
 * The two-app split exists because an app that has been submitted for listing
 * (or carries a license in its manifest) can no longer be shared by
 * installation link — and Codegeist requires an installation link for judges.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , target, appId] = process.argv;
if (!['demo', 'mkt'].includes(target) || !appId) {
  console.error('usage: node scripts/set-app.mjs <demo|mkt> <appId>');
  process.exit(1);
}
if (!/^ari:cloud:ecosystem::app\/[0-9a-f-]{36}$/.test(appId)) {
  console.error(`not an app id: ${appId}`);
  process.exit(1);
}

const path = 'manifest.yml';
let text = readFileSync(path, 'utf8');

text = text.replace(/^(\s*)id: ari:cloud:ecosystem::app\/.*$/m, `$1id: ${appId}`);

// Licensing block: present only for the marketplace identity.
text = text.replace(/\n\s*licensing:\n\s*enabled: true\n/g, '\n');
if (target === 'mkt') {
  text = text.replace(/^(\s*)id: addr.*$/gm, '$&');
  text = text.replace(/^app:\n/m, 'app:\n');
  if (!/^\s*licensing:/m.test(text)) {
    text = text.replace(/^(\s*)id: ari:.*$/m, `$1id: ${appId}\n${' '.repeat(2)}licensing:\n${' '.repeat(4)}enabled: true`);
  }
}

writeFileSync(path, text);
console.log(`manifest.yml -> ${target} (${appId})`);
