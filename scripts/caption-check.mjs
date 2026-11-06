import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(process.env.BASE ?? 'http://127.0.0.1:4199', { waitUntil: 'networkidle' });
await page.addStyleTag({ content: `#cascade-caption{position:fixed;left:0;right:0;bottom:0;z-index:99999;background:rgba(9,30,66,.94);color:#fff;font:500 26px/1.45 -apple-system,system-ui,sans-serif;padding:22px 48px;box-shadow:0 -2px 20px rgba(0,0,0,.25)}` });
await page.evaluate(() => {
  const el = document.createElement('div');
  el.id = 'cascade-caption';
  el.textContent = 'Known when they decided: 0009 took MongoDB for audit logs, and held.';
  document.body.appendChild(el);
});
await page.getByRole('button', { name: 'Case base' }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/shots/07-caption-style.png' });
console.log('ok');
await browser.close();
