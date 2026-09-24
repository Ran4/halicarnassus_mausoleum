// usage: node tools/listen.mjs spots.json — records the scene's sound (the master bus) at each spot [{name,pos,yaw,pitch,sec,js?,shot?}] to <name>.webm in the cwd
// (headless Chrome with autoplay allowed and ?audio=1, so the soundscape starts without a click). env: PORT, QUERY
import puppeteer from 'puppeteer-core';
import fs from 'fs';
const spots = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--autoplay-policy=no-user-gesture-required', '--window-size=960,540'] });
const page = await browser.newPage();
await page.setViewport({ width: 960, height: 540 });
page.on('console', m => { const t = m.text(); if ((/error|warn|audio|\[shot\]/i.test(t)) && !/Clock|PCFSoft/.test(t)) console.log('[console]', t.slice(0, 500)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${process.env.PORT || '8787'}/index.html?shot=1&audio=1${process.env.QUERY || ''}`, { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 240000, polling: 500 });
await page.waitForFunction('window.__life && window.__life.debug().audio && window.__life.debug().audio.ready', { timeout: 60000, polling: 250 });
console.log('audio', JSON.stringify(await page.evaluate(() => window.__life.debug().audio)).slice(0, 600));
for (const s of spots) {
  await page.evaluate(s => { window.__setView(...s.pos, s.yaw, s.pitch); if (s.js) eval(s.js); }, s);
  await new Promise(r => setTimeout(r, 1500));
  const b64 = await page.evaluate(async (sec) => {
    const { ctx, master } = window.__audio, dst = ctx.createMediaStreamDestination(); master.connect(dst);
    const rec = new MediaRecorder(dst.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 128000 }), chunks = [];
    rec.ondataavailable = e => chunks.push(e.data); rec.start();
    await new Promise(r => setTimeout(r, sec * 1000)); rec.stop(); await new Promise(r => rec.onstop = r); master.disconnect(dst);
    const buf = await new Blob(chunks).arrayBuffer(); let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s);
  }, s.sec || 10);
  fs.writeFileSync(s.name + '.webm', Buffer.from(b64, 'base64'));
  const d = await page.evaluate(() => ({ a: window.__life.debug().audio, c: window.__life.debug().chatter, cap: document.getElementById('caption')?.innerText }));
  const { bank, ...a } = d.a; console.log(s.name, JSON.stringify({ ...a, chatter: d.c, caption: d.cap }).slice(0, 800));
  if (s.shot) await page.screenshot({ path: s.name + '.png' });
}
await browser.close();
