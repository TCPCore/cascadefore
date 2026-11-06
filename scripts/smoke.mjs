/**
 * Smoke test: the app renders, every tab works, and nothing throws.
 *
 * Exists because two regressions in this project shipped as a blank page — an
 * undefined component and an unimported module. A blank page is invisible to
 * type-checking when the failure is runtime-only, so this asserts on the DOM.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

const fail = (message) => {
  console.log('FAIL', message);
  process.exitCode = 1;
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);

// 1. the shell renders
const heading = await page.locator('h1').first().textContent();
if (!heading?.includes('Cascade')) fail('header did not render');

// 2. case base renders the matrix
await page.getByRole('button', { name: 'Case base' }).click();
await page.waitForTimeout(1200);
if (!(await page.getByText('Decision matrix').count())) fail('case base did not render the matrix');

// 3. search answers
const box = page.getByPlaceholder('why does the billing service use Postgres?');
if (await box.count()) {
  await box.fill('postgres');
  await box.press('Enter');
  await page.waitForTimeout(1200);
  if (!(await page.getByText(/decisions match/i).count())) fail('search returned no summary');
} else {
  fail('search input missing');
}

// 4. reconstruction runs and every tab renders
await page.getByRole('button', { name: 'Reconstruction' }).click();
await page.getByRole('button', { name: 'Run Cascade' }).click();
await page.waitForTimeout(4000);

for (const tab of ['Projected tree', 'Forensic view', 'Decision tree', 'Then vs now', 'Paths compared']) {
  await page.getByRole('button', { name: tab }).click();
  await page.waitForTimeout(900);
  const cards = await page.locator('.card').count();
  if (cards === 0) fail(`tab "${tab}" rendered nothing`);
  if (await page.getByText('could not render').count()) fail(`tab "${tab}" hit the error boundary`);
}

if (errors.length > 0) fail(`console errors: ${errors.slice(0, 3).join(' | ')}`);

await browser.close();
console.log(process.exitCode ? 'SMOKE FAILED' : 'smoke passed');
