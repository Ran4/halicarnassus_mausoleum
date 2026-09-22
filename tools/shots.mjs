// usage: node shots.mjs views.json [w h]   views: [{name,pos:[x,y,z],yaw,pitch,js?,wait?}]
// env: PORT (default 8787) · UNCAPPED=1 lifts the 60 fps vsync cap so fpsProbe measures real headroom · QUERY extra url params, e.g. QUERY='&noao=1'
// Views may run js (e.g. "console.log('[shot] ' + JSON.stringify(window.__people.debug()))"); console lines
// starting with [shot] are printed, as are errors/warnings. Prints __stats() at the first view (frame totals: draw calls and triangles across shadows + main + AO).
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const [,, viewsFile, w = '1600', h = '900'] = process.argv;
const views = JSON.parse(fs.readFileSync(viewsFile, 'utf8'));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', `--window-size=${w},${h}`, ...(process.env.UNCAPPED ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])] });
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
page.on('console', m => { const t = m.text(); if ((/error|warn|THREE/i.test(t) || t.startsWith('[shot]')) && !/Clock|PCFSoft/.test(t)) console.log('[console]', t.slice(0, 400)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
const t0 = Date.now();
const port = process.env.PORT || '8787';
await page.goto(`http://127.0.0.1:${port}/index.html?shot=1${process.env.QUERY || ''}`, { waitUntil: 'load' });
try { await page.waitForFunction('window.__ready === true', { timeout: 240000, polling: 500 }); } catch (e) { console.log('timeout; status =', await page.evaluate(() => document.getElementById('start')?.textContent)); }
console.log('ready after', ((Date.now() - t0) / 1000).toFixed(1), 's');
{ const a = await page.evaluate(() => window.__frame); await new Promise(r => setTimeout(r, 3000)); const b = await page.evaluate(() => window.__frame); console.log('fpsProbe ~', ((b - a) / 3).toFixed(0), 'fps at first view'); }
try { console.log('stats', JSON.stringify(await page.evaluate(() => window.__stats()))); } catch (e) { console.log('stats unavailable', e.message); }
for (const v of views) {
  const f0 = await page.evaluate(() => window.__frame);
  await page.evaluate((v) => { window.__setView(...v.pos, v.yaw, v.pitch); if (v.js) eval(v.js); }, v);
  await page.waitForFunction(`window.__frame > ${f0 + (v.wait || 4)}`, { timeout: 60000, polling: 100 });
  await page.screenshot({ path: v.name });
  console.log('saved', v.name);
}
await browser.close();
