import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.getByRole('button', { name: 'Case base' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/shots/08-mobile-case-base.png', fullPage: true });
console.log('captured mobile');
await browser.close();
