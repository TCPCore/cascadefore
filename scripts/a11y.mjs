import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const scan = async (label) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
    help: v.help,
    sample: v.nodes[0]?.target?.join(' '),
  }));
  console.log(`\n[${label}] violations: ${violations.length}`);
  for (const v of violations) console.log(`  ${v.impact} ${v.id} (${v.nodes}) — ${v.help} :: ${v.sample}`);
  return violations;
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await scan('reconstruction');

await page.getByRole('button', { name: 'Case base' }).click();
await page.waitForTimeout(1400);
await scan('case base');

await page.getByText('Use Postgres as the primary datastore').first().click();
await page.waitForTimeout(700);
await scan('decision detail');

await page.getByRole('button', { name: 'Reconstruction' }).click();
await page.getByRole('button', { name: 'Run Cascade' }).click();
await page.waitForTimeout(4000);
await scan('run');
await page.getByRole('button', { name: 'Projected tree' }).click();
await page.waitForTimeout(1200);
await scan('projected');

await browser.close();
