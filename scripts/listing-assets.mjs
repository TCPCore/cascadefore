/**
 * Listing assets, rendered from HTML so they stay in sync with the product's own
 * type and colour rather than being hand-made in an image editor.
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const browser = await chromium.launch();
const shot = (await readFile('docs/screenshots/02-paths-not-taken.png')).toString('base64');
const shot2 = (await readFile('docs/screenshots/04-projected-tree.png')).toString('base64');

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.setContent(`
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; width: 1280px; height: 720px; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: linear-gradient(135deg, #0b1b3a 0%, #123a6b 55%, #0b1b3a 100%);
      color: #fff; display: grid; grid-template-columns: 1fr 1fr;
    }
    .left { padding: 56px 24px 56px 56px; display: flex; flex-direction: column; justify-content: center; }
    .eyebrow { font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #79f2c0; font-weight: 700; }
    h1 { font-size: 54px; line-height: 1.05; margin: 14px 0 18px; letter-spacing: -0.02em; }
    p { font-size: 21px; line-height: 1.45; color: #d5e0f5; margin: 0 0 22px; max-width: 30ch; }
    .tag { display: inline-block; font-size: 14px; font-weight: 600; background: rgba(121,242,192,0.16);
           color: #79f2c0; border: 1px solid rgba(121,242,192,0.4); border-radius: 999px; padding: 6px 14px; }
    .right { position: relative; padding: 44px 40px 44px 0; }
    .card { position: absolute; border-radius: 12px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.14); }
    .card img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top left; }
    .a { top: 64px; left: 0; width: 560px; height: 380px; }
    .b { top: 300px; left: 150px; width: 520px; height: 340px; }
    .kv { margin-top: 6px; font-size: 15px; color: #9fb4d8; }
    .kv b { color: #fff; }
  </style>
  <div class="left">
    <div class="eyebrow">Atlassian Forge · Jira + Confluence</div>
    <h1>Cascade</h1>
    <p>See what was decided, what was rejected — and what was knowable at the time.</p>
    <div><span class="tag">decision index</span></div>
    <div class="kv" style="margin-top:26px">
      <b>6 decisions</b> · 7 areas · 4 enforced · 1 violated · <b>1 orphaned</b>
    </div>
  </div>
  <div class="right">
    <div class="card a"><img src="data:image/png;base64,${shot}" /></div>
    <div class="card b"><img src="data:image/png;base64,${shot2}" /></div>
  </div>
`);
await page.screenshot({ path: 'docs/screenshots/banner-1280x720.png' });
console.log('banner written');

// Video thumbnail: same visual language, less text, safe for a small tile
const thumb = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await thumb.setContent(`
  <style>
    body { margin:0; width:1280px; height:720px; display:grid; place-items:center;
      background: radial-gradient(circle at 30% 20%, #14406f, #0b1b3a 70%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color:#fff; }
    .wrap { text-align:center; }
    h1 { font-size: 92px; margin: 0 0 10px; letter-spacing: -0.03em; }
    p { font-size: 30px; color:#9fe8c8; margin: 0; font-weight: 600; }
    .sub { margin-top: 26px; font-size: 22px; color:#c9d8f2; }
  </style>
  <div class="wrap">
    <h1>Cascade</h1>
    <p>What was decided. What was rejected. What was knowable.</p>
    <div class="sub">Decision index for Jira and Confluence</div>
  </div>
`);
await thumb.screenshot({ path: 'docs/screenshots/youtube-thumbnail.png' });
console.log('thumbnail written');

await browser.close();
