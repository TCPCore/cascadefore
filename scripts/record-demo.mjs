/**
 * Records the demo video from the running sandbox.
 *
 * Every frame is the real product: the same bundle the Forge app serves, the
 * same case base, the same projection. Captions carry the narration because a
 * silent screencast with on-screen text is honest about what is being shown.
 */
import { chromium } from 'playwright';
import { rename, mkdir } from 'node:fs/promises';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4199';
const OUT = 'artifacts/video/demo.webm';

const CAPTIONS = [
  { at: 0, text: 'Cascade — the decision index for a codebase.' },
  { at: 3500, text: 'Ask it the way people actually ask.' },
  { at: 6500, text: 'One decision matches, and it tells you why it matched.' },
  { at: 10000, text: 'Six decisions. Four still hold. One broke. One nobody can check.' },
  { at: 15000, text: 'The orphan is reported, not hidden: a decision nobody can test teaches the case base nothing.' },
  { at: 15000, text: 'Now open one decision. Postgres as the primary datastore.' },
  { at: 19500, text: 'Rejected: SQLite. No concurrent writers. No precedent existed — decided on documentation.' },
  { at: 25000, text: 'Rejected: MongoDB. Weak ACID at the time.' },
  { at: 30000, text: 'Known when they decided: 0009 took MongoDB for audit logs, and held.' },
  { at: 35500, text: 'Learned afterwards: 0027 moved the ledger to MongoDB and reverted it.' },
  { at: 41000, text: 'That split is the time gate — the counterfactual is not hindsight.' },
  { at: 47000, text: 'Now the reconstruction: an issue, and the decision behind it.' },
  { at: 53000, text: 'One decision, three positions, and the resolution they actually took.' },
  { at: 60000, text: 'The tree is not stored. It is projected from the index at a date you choose.' },
  { at: 66000, text: 'Anchor before the decision: nothing had been made. Every path was still open.' },
  { at: 73000, text: 'Move the anchor forward and the same tree assembles itself.' },
  { at: 79000, text: 'The forensic timeline dates every entry, and marks what was knowable then.' },
  { at: 85000, text: 'Nothing here predicts. It reports what existed, what was rejected, and what was knowable.' },
  { at: 98000, text: 'Cascade. Plausible output is not evidence — an assertion is.' },
  { at: 103000, text: '' },
];

const browser = await chromium.launch();
await mkdir('artifacts/video', { recursive: true });

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: 'artifacts/video', size: { width: 1920, height: 1080 } },
});

const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// Persistent caption bar
await page.addStyleTag({
  content: `
    #cascade-caption {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 99999;
      background: rgba(9, 30, 66, 0.94); color: #fff;
      font: 500 26px/1.45 -apple-system, system-ui, sans-serif;
      padding: 22px 48px; letter-spacing: 0.01em;
      box-shadow: 0 -2px 20px rgba(0,0,0,0.25);
    }
    #cascade-caption b { color: #79f2c0; font-weight: 700; }
  `,
});
await page.evaluate(() => {
  const el = document.createElement('div');
  el.id = 'cascade-caption';
  el.textContent = '';
  document.body.appendChild(el);
});

const started = Date.now();
async function caption(index) {
  const target = CAPTIONS[index];
  if (!target) return;
  const wait = target.at - (Date.now() - started);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.evaluate((text) => {
    const el = document.getElementById('cascade-caption');
    if (el) el.textContent = text;
  }, target.text);
}

// Beat 1 — ask the index, then the case base
await caption(0);
await page.getByRole('button', { name: 'Case base' }).click();
await page.waitForTimeout(1200);
await caption(1);
const box = page.getByPlaceholder('why does the billing service use Postgres?');
await box.fill('why does the billing service use Postgres');
await page.waitForTimeout(400);
await box.press('Enter');
await page.waitForTimeout(1400);
await caption(2);
await page.waitForTimeout(1800);
await caption(17);
await page.waitForTimeout(2400);
await caption(18);

// Beat 2 — open a decision, show paths not taken
await caption(3);
const row = page.getByText('Use Postgres as the primary datastore').first();
await row.click();
await page.waitForTimeout(1400);
await caption(4);
await page.waitForTimeout(2200);
await caption(5);
await page.waitForTimeout(2400);
await caption(6);
await page.waitForTimeout(2400);
await caption(7);
await page.waitForTimeout(2400);
await caption(8);

// Beat 3 — reconstruction
await caption(9);
await page.getByRole('button', { name: 'Reconstruction' }).click();
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Run Cascade' }).click();
await page.waitForTimeout(3000);
await caption(10);
await page.waitForTimeout(2800);
await caption(11);
await page.getByRole('button', { name: 'Projected tree' }).click();
await page.waitForTimeout(1600);

// Beat 4 — as-of projection
await caption(12);
const date = page.locator('input[type="date"]').first();
await date.fill('2020-01-01');
await page.waitForTimeout(2200);
await caption(13);
await date.fill('2026-11-06');
await page.waitForTimeout(2200);

// Beat 5 — forensic timeline
await caption(14);
await page.getByRole('button', { name: 'Forensic view' }).click();
await page.waitForTimeout(2400);
await caption(15);
await page.waitForTimeout(2600);
await caption(16);
await page.waitForTimeout(3000);

// End card: how to try it, on screen long enough to read
await page.evaluate(() => {
  const card = document.createElement('div');
  card.id = 'end-card';
  card.innerHTML = `
    <div style="font-size:56px;font-weight:800;letter-spacing:-0.02em;margin-bottom:10px">Cascade</div>
    <div style="font-size:24px;color:#79f2c0;font-weight:600;margin-bottom:26px">
      What was decided · what was rejected · what was knowable
    </div>
    <div style="font-size:22px;color:#d5e0f5;line-height:1.7">
      github.com/TCPCore/cascadefore<br/>
      <span style="color:#9fb4d8">npm run evaluate</span> → localhost:4173
    </div>`;
  card.style.cssText = [
    'position:fixed','inset:0','z-index:100000','display:flex','flex-direction:column',
    'align-items:center','justify-content:center','text-align:center','color:#fff',
    'font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif',
    'background:radial-gradient(circle at 30% 20%, #14406f, #0b1b3a 70%)',
  ].join(';');
  document.body.appendChild(card);
  const caption = document.getElementById('cascade-caption');
  if (caption) caption.remove();
});
await page.waitForTimeout(5200);

await context.close();
await browser.close();

// Playwright writes a random name; give the artefact a stable one.
const { readdir } = await import('node:fs/promises');
const files = (await readdir('artifacts/video')).filter((f) => f.endsWith('.webm') && f !== 'demo.webm');
if (files[0]) await rename(`artifacts/video/${files[0]}`, OUT);
console.log('video written:', OUT);
