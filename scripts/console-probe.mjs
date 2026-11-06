import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
await page.goto(process.env.BASE ?? 'http://127.0.0.1:4199', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
console.log('buttons:', await page.getByRole('button').allTextContents());
await browser.close();
