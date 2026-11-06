import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const browser = await chromium.launch();

async function withPage(fn, name) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  try {
    await fn(page);
    await page.screenshot({ path: `artifacts/shots/${name}.png`, fullPage: true });
    console.log('captured', name);
  } catch (error) {
    console.log('FAILED', name, String(error).split('\n')[0]);
  } finally {
    await page.close();
  }
}

const runReconstruction = async (page) => {
  await page.getByRole('button', { name: 'Reconstruction' }).click();
  await page.getByRole('button', { name: 'Run Cascade' }).click();
  await page.waitForTimeout(4500);
};

await withPage(async (page) => {
  await page.getByRole('button', { name: 'Case base' }).click();
  await page.waitForTimeout(1500);
}, '01-case-base');

await withPage(async (page) => {
  await page.getByRole('button', { name: 'Case base' }).click();
  await page.waitForTimeout(1200);
  const row = page.getByText('Use Postgres as the primary datastore').first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(1000);
  }
}, '02-paths-not-taken');

await withPage(async (page) => {
  await runReconstruction(page);
}, '03-decision-tree');

await withPage(async (page) => {
  await runReconstruction(page);
  await page.getByRole('button', { name: 'Projected tree' }).click();
  await page.waitForTimeout(1400);
}, '04-projected-tree');

await withPage(async (page) => {
  await runReconstruction(page);
  await page.getByRole('button', { name: 'Projected tree' }).click();
  await page.waitForTimeout(1000);
  const date = page.locator('input[type="date"]').first();
  await date.fill('2020-01-01');
  await page.waitForTimeout(1600);
}, '05-projected-before');

await withPage(async (page) => {
  await runReconstruction(page);
  await page.getByRole('button', { name: 'Forensic view' }).click();
  await page.waitForTimeout(1400);
}, '06-forensic');

await browser.close();
