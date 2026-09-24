// Sound: the soundscape of Halicarnassus, played through WebAudio from the bank synthesized in synth.js.
//
// Beds that follow the listener, their levels read from where the camera is (5× a second): the wind (stronger up high
// and in the open, swelling with ctx.wind's gusts), the sea (surf on open shore, water slapping stone in the harbour,
// panned toward the nearest water), cicadas in the trees outside the built-up town, sparrows in the eaves, the murmur of
// the crowd (from how many people stand near) and the far hum of the town.
// Sources in the world, HRTF-panned with air absorption by distance: people talking (the current speaker of each
// knot, an orator), the hammers of smiths, masons and shipwrights — struck on the frame the animation lands the blow
// (people.js's swing is a pure function of time, so the strike can be scheduled ahead) — fountains, a lyre player in the
// agora, an aulos at the altar of the temenos, a chorus rehearsing the Bacchae in the theatre, and whatever the other life modules emit (ctx.emit: gulls, wings, oar
// strokes, barks, bells, bleats, clucks, brays; 'speech' from chatter.js is spoken aloud in the same Greek).
// The player's own sandals on paving or on beaten earth.
//
// The bank is synthesized in a Web Worker (synthworker.js) from the moment the town starts loading, so nothing is computed
// on the main thread. WebAudio needs a user gesture: the context is made in start() (the click into the scene); ?audio=1
// starts at load (for tests, with Chrome's --autoplay-policy=no-user-gesture-required). M mutes (remembered).
import * as S from './synth.js';
import { terrainHeight, SEA, inTerrace, flats } from '../terrain.js';
import { rng, clamp, smoothstep } from '../util.js';

// what the modules may emit, and how it sounds: bank, gain, reference distance, audible range, playback rate
const EV = {
  gull: ['gull', 0.55, 14, 260], flutter: ['flutter', 0.7, 4, 70], flap: ['flutterS', 0.45, 2.5, 35], stroke: ['splash', 0.85, 16, 320],
  bark: ['bark', 0.75, 5, 140], cluck: ['cluck', 0.4, 2.5, 45], bell: ['bell', 0.45, 4, 130], bleat: ['bleat', 0.5, 5, 160], bray: ['bray', 0.7, 9, 280],
  clink: ['chisel', 0.5, 3, 60], knock: ['knock', 0.5, 3, 50], anvil: ['anvil', 0.55, 4, 80],
  oar: ['splash', 0.28, 5, 90, 1.7], luff: ['cloth', 0.55, 6, 120, 0.55],
  coo: ['coo', 0.35, 2, 30], chirp: ['sparrow', 0.3, 3, 40], swallow: ['swallow', 0.22, 4, 45], crow: ['crow', 0.7, 8, 220], growl: ['growl', 0.6, 2.5, 35], whine: ['whine', 0.3, 3, 45],
};

export function build(ctx) {
  const { world, layout, people } = ctx;
  const q = new URLSearchParams(location.search);

  // ---------- maps, once: where the water is and how built-up each place is (20 m cells over ±1700 m) ----------
  const G = 20, GN = 170, G0 = -1700, N2 = GN * GN;
  const ci = (x, z) => clamp(Math.floor((z - G0) / G), 0, GN - 1) * GN + clamp(Math.floor((x - G0) / G), 0, GN - 1);
  const nearW = new Int32Array(N2).fill(-1), qu = new Int32Array(N2); let qh = 0, qt = 0;
  for (let c = 0; c < N2; c++) if (terrainHeight(G0 + (c % GN + 0.5) * G, G0 + (Math.floor(c / GN) + 0.5) * G) < SEA - 0.4) { nearW[c] = c; qu[qt++] = c; }
  while (qh < qt) {   // breadth-first from every water cell: each land cell learns its nearest water
    const c = qu[qh++], cx = c % GN, cz = Math.floor(c / GN), w = nearW[c], wx = w % GN, wz = Math.floor(w / GN);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= GN || nz >= GN) continue;
      const nc = nz * GN + nx, o = nearW[nc];
      if (o < 0) { nearW[nc] = w; qu[qt++] = nc; } else if (o !== w && (nx - wx) ** 2 + (nz - wz) ** 2 < (nx - o % GN) ** 2 + (nz - Math.floor(o / GN)) ** 2) nearW[nc] = w;
    }
  }
  const dens = new Float32Array(N2), raw = new Float32Array(N2);
  for (const h of layout.houses) raw[ci(h.x, h.z)] += 1;
  for (let c = 0; c < N2; c++) { const cx = c % GN, cz = Math.floor(c / GN); let s = 0; for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) { const nx = cx + dx, nz = cz + dz; if (nx >= 0 && nz >= 0 && nx < GN && nz < GN) s += raw[nz * GN + nx]; } dens[c] = s; }
  let dMax = 1; for (let c = 0; c < N2; c++) dMax = Math.max(dMax, dens[c]);
  const urbanAt = (x, z) => Math.min(1, dens[ci(x, z)] / (dMax * 0.55));
  const paved = layout.areas.filter(a => typeof a.y === 'number');
  const onStone = (x, z, y) => inTerrace(x, z) || paved.some(a => x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ && Math.abs(y - a.y) < 0.4);
  const fountains = layout.pois.filter(p => p.type === 'fountain');
  const workPois = layout.pois.filter(p => p.type === 'work');
  const tradeOf = new Map();   // person → the sound of their tool, from the work spot they stand at
  const trade = (i, x, z) => {
    let t = tradeOf.get(i); if (t) return t;
    let best = null, bd = 16; for (const p of workPois) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } }
    const n = best ? best.note || '' : '';
    t = /smith|forge|anvil|ploughshare|chisels|bronze/.test(n) ? 'anvil' : /mason|sculpt|carv|chisel|stone|marble|block|column|statue|lion|horse|moulding|egg-and-dart|polish|dressing a|roughing/.test(n) ? 'clink' : 'knock';
    tradeOf.set(i, t); return t;
  };

  // ---------- the bank, synthesized in a worker while the town loads ----------
  const SR = 48000, pcm = {};
  let worker = null, wid = 0; const waiting = new Map();
  const local = (job, seed, args) => { const R = S.mulberry(seed); return job === 'speech' ? S.speech(args[0], args[1], SR, R) : job === 'babble' ? S.speech(S.babbleText(R), S.VOICES[args[0]](R), SR, R) : S[job](SR, R, ...args); };
  const fallback = () => { worker = null; for (const [, w] of waiting) setTimeout(() => w.res(local(w.job, w.seed, w.args)), 0); waiting.clear(); };
  try {
    worker = new Worker(new URL('./synthworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const w = waiting.get(e.data.id); if (!w) return; waiting.delete(e.data.id); if (e.data.error) { console.error('[audio] synth', e.data.error); w.res(null); } else w.res(e.data.data); };
    worker.onerror = e => { console.warn('[audio] synth worker unavailable, synthesizing on the main thread', e.message || ''); fallback(); };
  } catch (e) { worker = null; }
  const synth = (job, seed, ...args) => new Promise(res => {
    if (worker) { const id = ++wid; waiting.set(id, { res, job, seed, args }); worker.postMessage({ id, job, sr: SR, seed, args }); }
    else setTimeout(() => res(local(job, seed, args)), 0);
  });
  // [name, synth job, how many, args or i → args]; the loops last
  const SPEC = [
    ['stepStone', 'stepStone', 6], ['stepDirt', 'stepDirt', 6], ['chisel', 'chisel', 4], ['anvil', 'anvil', 3], ['knock', 'knock', 4],
    ['gull', 'gull', 5], ['flutter', 'flutter', 2, [12]], ['flutterS', 'flutter', 2, [3]], ['splash', 'splash', 3],
    ['barkS', 'bark', 2, [0.65]], ['bark', 'bark', 3, [1]], ['barkL', 'bark', 2, [1.35]], ['cluck', 'cluck', 4], ['bleat', 'bleat', 4], ['bray', 'bray', 2],
    ['bell', 'bell', 5, i => [[620, 700, 790, 880, 1010][i]]], ['trickle', 'trickle', 1], ['wind', 'windNoise', 1], ['crackle', 'crackle', 1], ['cloth', 'cloth', 3], ['coo', 'coo', 3], ['sparrow', 'sparrow', 3], ['swallow', 'swallow', 3], ['crow', 'crow', 2], ['growl', 'growl', 2], ['whine', 'whine', 2], ['rustle', 'rustle', 3], ['call', 'speech', 2, i => [['ō óp! ō óp!', 'rhyppapai!'][i], { f0: 128, fs: 0.97, rate: 0.95, range: 1.6, breath: 0.03 }]],
    ['vox_man', 'babble', 9, ['man']], ['vox_woman', 'babble', 8, ['woman']], ['vox_old', 'babble', 3, ['old']], ['vox_child', 'babble', 3, ['child']],
    ['surf', 'surf', 1], ['lap', 'lap', 1], ['cicadas', 'cicadas', 1], ['chirps', 'chirps', 1], ['walla', 'walla', 1], ['lyre', 'lyrePiece', 1], ['aulos', 'aulosPiece', 1], ['chorus', 'chorusPiece', 1],
  ];
  let seedN = 1000;
  const bankReady = Promise.all(SPEC.map(([name, job, n, args]) => Promise.all(Array.from({ length: n }, (_, i) => synth(job, seedN++, ...(typeof args === 'function' ? args(i) : args || [])))).then(list => { pcm[name] = list.filter(Boolean); })));

  // ---------- engine (built on start) ----------
  let A = null, master, comp, busFx, busVox, verb, verbSend, muted = false, ready = false;
  try { muted = localStorage.getItem('halicarnassus.mute') === '1'; } catch (e) { /* storage may be blocked */ }
  const bank = {}, beds = {}, R = rng(4242), RR = rng(99);
  const L = { wind: 0, sea: 0, lap: 0, cicada: 0, chirp: 0, walla: 0, hum: 0 }, stats = { events: 0, voices: 0, strikes: 0, steps: 0, speech: 0, heard: {} };   // heard: the emitted events that were played, by type
  const buf = arr => { const b = A.createBuffer(1, arr.length, SR); b.copyToChannel(arr, 0); return b; };   // (WebAudio resamples if the device runs at another rate)
  const pick = a => a[Math.floor(RR() * a.length)];

  function panner(x, y, z, ref, hrtf = true) {
    const p = A.createPanner(); p.panningModel = hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.1; p.maxDistance = 10000;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; return p;
  }
  // a one-shot in the world: source → gain → air (a lowpass that closes with distance) → panner → bus (+ reverb send)
  const live = new Set();
  function play(b, x, y, z, { gain = 0.6, ref = 3, rate = 1, when = 0, bus = busFx, wet = 1 } = {}) {
    if (!b || live.size > 28) return null;
    const cam = ctx.camera.position, d = Math.hypot(x - cam.x, y - cam.y, z - cam.z);
    const s = A.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
    const g = A.createGain(); g.gain.value = gain;
    const air = A.createBiquadFilter(); air.type = 'lowpass'; air.frequency.value = clamp(18000 * Math.exp(-d / 110), 900, 18000);
    const p = panner(x, y, z, ref, d < 60);
    s.connect(g).connect(air).connect(p).connect(bus);
    if (wet) { const w = A.createGain(); w.gain.value = wet; p.connect(w).connect(verbSend); s.onended = () => { live.delete(s); w.disconnect(); p.disconnect(); }; }
    else s.onended = () => { live.delete(s); p.disconnect(); };
    live.add(s); s.start(A.currentTime + Math.max(0, when)); stats.events++;
    return { s, g, p };
  }
  function bed(name, b, { gain = 0, pan = false } = {}) {
    if (!b) return null;
    const s = A.createBufferSource(); s.buffer = b; s.loop = true;
    const g = A.createGain(); g.gain.value = gain; let node = s.connect(g);
    let p = null; if (pan) { p = A.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'linear'; p.rolloffFactor = 0; node = node.connect(p); }
    node.connect(busFx); s.start(A.currentTime, RR() * b.duration);
    return (beds[name] = { s, g, p });
  }
  const setG = (bd, v, tc = 0.35) => bd && bd.g.gain.setTargetAtTime(v, A.currentTime, tc);

  async function start() {
    if (A) { if (A.state !== 'running') A.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    A = new AC({ latencyHint: 'interactive' });
    const sr = A.sampleRate;
    master = A.createGain(); master.gain.value = muted ? 0 : 0.9;
    comp = A.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
    master.connect(comp).connect(A.destination);
    busFx = A.createGain(); busFx.connect(master); busVox = A.createGain(); busVox.connect(master);
    // a room made of the town: short diffuse reflections, a little more in the narrow streets
    verb = A.createConvolver(); { const n = Math.floor(1.3 * sr), ir = A.createBuffer(2, n, sr); for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); let lp = 0; for (let i = 0; i < n; i++) { lp += ((R() * 2 - 1) - lp) * 0.35; d[i] = lp * Math.exp(-i / sr / 0.32) * (i < sr * 0.012 ? 0 : 1); } } verb.buffer = ir; }
    verbSend = A.createGain(); verbSend.gain.value = 0.15; verbSend.connect(verb).connect(master);
    window.__audio = { ctx: A, master };
    document.addEventListener('visibilitychange', () => { if (document.hidden) A.suspend(); else A.resume(); });
    await bankReady;
    for (const [k, list] of Object.entries(pcm)) bank[k] = list.map(buf);
    const one = k => bank[k] && bank[k][0];
    try {
      if (bed('wind', one('wind'))) windBed();
      bed('sea', one('surf'), { pan: true }); bed('lap', one('lap'), { pan: true }); bed('cicada', one('cicadas')); bed('chirp', one('chirps'));
      bed('walla', one('walla')); const h = bed('hum', one('walla'));
      if (h) { const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 650; h.g.disconnect(); h.g.connect(lp).connect(busFx); h.s.playbackRate.value = 0.93; }
      startMusic();
    } catch (e) { console.error('[audio]', e); }
    ready = true;
    if (A.state !== 'running') A.resume();
  }
  // the wind: a noise loop through a lowpass that the gusts open, and a faint whistle over the ridges
  let windLP, windWh, windWhG;
  function windBed() {
    const w = beds.wind; w.g.disconnect(); windLP = A.createBiquadFilter(); windLP.type = 'lowpass'; windLP.frequency.value = 500; windLP.Q.value = 0.7; w.g.connect(windLP).connect(busFx);
    windWh = A.createBiquadFilter(); windWh.type = 'bandpass'; windWh.frequency.value = 900; windWh.Q.value = 9; windWhG = A.createGain(); windWhG.gain.value = 0; w.s.connect(windWh).connect(windWhG).connect(busFx);
  }
  // ---------- music: a lyre player sitting in the agora, an aulos at the altar of the temenos, a chorus rehearsing in the theatre ----------
  const music = [];
  function startMusic() {
    let lyreAt = [0, -17.3, 405];
    const sitters = people.listen(0, 408, 45).filter(p => p.state === 'sitting' && !p.female).sort((a, b) => a.d - b.d);
    if (sitters.length) lyreAt = [sitters[0].x, sitters[0].y + 1.0, sitters[0].z];
    const th = flats[1];   // the theatre's orchestra
    for (const [b, at, gain, ref] of [[bank.lyre[0], lyreAt, 0.55, 2.2], [bank.aulos[0], world.altar ? [world.altar.x + 3.2, world.altar.y - 0.6, world.altar.z + 1.5] : [60, 1.4, 1.5], 0.4, 3], [bank.chorus[0], [th.cx, th.level + 1.6, th.cz], 1.1, 16]]) {
      if (!b) continue;
      const s = A.createBufferSource(); s.buffer = b; s.loop = true; const g = A.createGain(); g.gain.value = gain; const p = panner(...at, ref); p.rolloffFactor = 1.3;
      const w = A.createGain(); w.gain.value = 0.6; s.connect(g).connect(p).connect(busFx); p.connect(w).connect(verbSend); s.start(A.currentTime, RR() * b.duration); music.push({ at, s });
    }
    ctx.musicians = music.map(m => m.at);
  }

  // ---------- per frame ----------
  let strokes = 0, tick = 0, heard = [], stepClock = 0, lastX = 0, lastZ = 0, wasGrounded = true, fountN = null, fireN = null, fireP = null;
  const voxBusy = new Map(), struck = new Map();
  function update(dt, t, camera, player) {
    if (!A || !ready || A.state !== 'running') return;
    const cam = camera.position, lis = A.listener, T = A.currentTime;
    const fx = -Math.sin(camera.rotation.y) * Math.cos(camera.rotation.x), fz = -Math.cos(camera.rotation.y) * Math.cos(camera.rotation.x), fy = Math.sin(camera.rotation.x);
    if (lis.positionX) { lis.positionX.setTargetAtTime(cam.x, T, 0.015); lis.positionY.setTargetAtTime(cam.y, T, 0.015); lis.positionZ.setTargetAtTime(cam.z, T, 0.015); lis.forwardX.setTargetAtTime(fx, T, 0.015); lis.forwardY.setTargetAtTime(fy, T, 0.015); lis.forwardZ.setTargetAtTime(fz, T, 0.015); lis.upX.value = 0; lis.upY.value = 1; lis.upZ.value = 0; }
    else { lis.setPosition(cam.x, cam.y, cam.z); lis.setOrientation(fx, fy, fz, 0, 1, 0); }

    // what the other modules made happen this frame
    for (const e of ctx.events) {
      if (e.type === 'speech') { speak(e); continue; }
      if (e.type === 'fire') { const d = Math.hypot(e.x - cam.x, e.z - cam.z); if (!fireN || d < fireN.d - 1 || fireN.seen < t - 1.5) fireN = { x: e.x, y: e.y, z: e.z, d, big: e.data && e.data.kind === 'cookfire', seen: t }; else if (Math.abs(e.x - fireN.x) < 0.5 && Math.abs(e.z - fireN.z) < 0.5) { fireN.seen = t; fireN.d = d; } continue; }
      if (e.type === 'gust') { const lv = e.data ? e.data.leaves || 0 : 0; if (lv > 0.08) play(pick(bank.rustle || []), cam.x + ctx.wind.dz * 8, cam.y + 3, cam.z - ctx.wind.dx * 8, { gain: 0.2 + 0.45 * lv, ref: 6, rate: 0.9 + RR() * 0.2 }); continue; }   // (leaves rustling as a gust passes, from the trees around)
      if (e.type === 'flap' && e.data && e.data.strength !== undefined) { const d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z); if (d < 25) play(pick(bank.cloth || []), e.x, e.y, e.z, { gain: 0.4 * e.data.strength, ref: 2.5, rate: 0.9 + RR() * 0.2 }); continue; }   // (washing; a 'flap' without strength is wings)
      const k = EV[e.type]; if (!k) continue;
      const d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z); if (d > k[3]) continue;
      let name = k[0]; if (e.type === 'bark') name = (e.data && e.data.size) < 0.8 ? 'barkS' : (e.data && e.data.size) > 1.2 ? 'barkL' : 'bark';
      if (e.type === 'flutter' && e.data && e.data.n < 5) name = 'flutterS';
      let b = pick(bank[name] || []);
      if (e.type === 'bell' && e.data && e.data.size !== undefined && bank.bell) b = bank.bell[clamp(Math.round((1.3 - e.data.size) * 6), 0, bank.bell.length - 1)];   // (a big animal's bell is lower)
      stats.heard[e.type] = (stats.heard[e.type] || 0) + 1;
      play(b, e.x, e.y, e.z, { gain: k[1] * (e.data && e.data.gain || 1) * (e.type === 'luff' && e.data ? 0.5 + 0.5 * (e.data.strength ?? 1) : 1), ref: k[2], rate: (k[4] || 1) * (0.9 + RR() * 0.2) });
      if (e.type === 'stroke' && ++strokes % 3 === 0 && d < 160) play(pick(bank.call || []), e.x, e.y + 2.5, e.z, { gain: 0.8, ref: 6, rate: 0.97 + RR() * 0.06 });   // the keleustes calls the stroke
    }

    // the player's sandals
    const walking = player && !player.fly, sp = Math.hypot(cam.x - lastX, cam.z - lastZ) / Math.max(dt, 1e-3); lastX = cam.x; lastZ = cam.z;
    if (walking) {
      if (player.grounded && !wasGrounded) step(cam, 1.4);
      if (player.grounded && sp > 0.8 && sp < 40) { stepClock += dt * (sp > 11 ? 2.9 : 2.05); if (stepClock >= 1) { stepClock -= 1; step(cam, sp > 11 ? 1.15 : 1); } } else stepClock = 0.6;
      wasGrounded = player.grounded;
    }

    // hammers: strike exactly when the swing lands (u = fract((t + hammerT) · 0.85) reaching 0.8)
    for (const h of heard) {
      if (h.hammerT < 0 || h.d > 48) continue;
      const ph = (t + h.hammerT) * 0.85, cyc = Math.floor(ph - 0.8), u = ph - 0.8 - cyc;   // u: how far past the last blow
      const next = cyc + 1, wait = (1 - u) / 0.85;
      if (wait < 0.09 && struck.get(h.i) !== next) {
        struck.set(h.i, next); const tr = trade(h.i, h.x, h.z), k = EV[tr];
        const hx = h.x + Math.sin(h.yaw) * 0.55, hz = h.z + Math.cos(h.yaw) * 0.55;
        play(pick(bank[k[0]]), hx, h.y + 0.9, hz, { gain: k[1], ref: k[2], rate: 0.94 + RR() * 0.12, when: wait }); stats.strikes++;
      }
    }

    if ((tick += dt) < 0.2) return;
    tick = 0;
    // ---------- the beds, from where the listener is ----------
    const gh = world.groundHeight(cam.x, cam.z), hag = Math.max(0, cam.y - gh), urb = urbanAt(cam.x, cam.z), gust = ctx.wind.gust(cam.x, cam.z, t);
    const w = nearW[ci(cam.x, cam.z)], wx = G0 + (w % GN + 0.5) * G, wz = G0 + (Math.floor(w / GN) + 0.5) * G, dW = w >= 0 ? Math.max(0, Math.hypot(wx - cam.x, wz - cam.z) - G * 0.5) : 1e4;
    const harbour = smoothstep(60, 0, Math.max(-330 - cam.x, cam.x - 600, cam.z - 650, 400 - cam.z, 0)), overSea = terrainHeight(cam.x, cam.z) < SEA ? 1 : 0;
    const seaNear = 1 / (1 + Math.pow(dW / 22, 1.4)) * (1 - 0.6 * smoothstep(40, 200, hag));
    const exposure = (1 - 0.65 * urb) * (0.5 + 0.5 * smoothstep(0, 60, hag)), flySp = player && player.fly ? smoothstep(12, 60, sp) : 0;
    L.wind = 0.05 + 0.2 * exposure * gust + 0.25 * smoothstep(20, 200, hag) + 0.25 * flySp;
    L.sea = 0.55 * seaNear * (1 - harbour * 0.8); L.lap = 0.5 * seaNear * harbour;
    L.cicada = 0.14 * (1 - 0.92 * urb) * (1 - smoothstep(15, 70, hag)) * (1 - smoothstep(40, 8, dW)) * (1 - overSea) * (inTerrace(cam.x, cam.z) ? 0.5 : 1);
    L.chirp = 0.07 * smoothstep(0.1, 0.6, urb) * (1 - smoothstep(10, 40, hag));
    heard = people.listen(cam.x, cam.z, 48);
    let crowd = 0; for (const p of heard) crowd += 1 / (1 + (p.d / 7) ** 2);
    L.walla = 0.3 * smoothstep(0.4, 9, crowd) * (1 - smoothstep(10, 50, hag)); L.hum = 0.13 * urb * (1 - smoothstep(60, 300, hag)) + 0.05 * smoothstep(0.2, 1, urb);
    for (const k of Object.keys(L)) setG(beds[k], L[k] * (k === 'wind' ? 1 : 1));
    if (windLP) { windLP.frequency.setTargetAtTime(260 + 520 * gust * (0.6 + exposure) + 900 * flySp, T, 0.4); windWhG.gain.setTargetAtTime(0.02 * smoothstep(30, 150, hag) * gust, T, 0.6); windWh.frequency.setTargetAtTime(700 + 400 * gust, T, 0.8); }
    for (const nm of ['sea', 'lap']) { const b = beds[nm]; if (b && b.p) { b.p.positionX.setTargetAtTime(dW < 1e3 ? wx : cam.x, T, 0.8); b.p.positionY.setTargetAtTime(SEA, T, 0.8); b.p.positionZ.setTargetAtTime(dW < 1e3 ? wz : cam.z + 10, T, 0.8); } }
    verbSend.gain.setTargetAtTime(0.08 + 0.22 * urb * (1 - smoothstep(5, 30, hag)), T, 0.5);

    // ---------- a fountain within earshot ----------
    let fb = null, fd = 30; for (const f of fountains) { const d = Math.hypot(f.x - cam.x, f.z - cam.z); if (d < fd) { fd = d; fb = f; } }
    if (fb !== fountN) {
      if (beds.fount) { const o = beds.fount; o.g.gain.setTargetAtTime(0, T, 0.3); setTimeout(() => { try { o.s.stop(); } catch (e) { /* already stopped */ } }, 1500); beds.fount = null; }
      fountN = fb;
      if (fb && bank.trickle) { const s = A.createBufferSource(); s.buffer = bank.trickle[0]; s.loop = true; const g = A.createGain(); g.gain.value = 0; const p = panner(fb.x, world.groundHeight(fb.x, fb.z) + 0.7, fb.z, 1.5); s.connect(g).connect(p).connect(busFx); s.start(); g.gain.setTargetAtTime(0.35, T, 0.4); beds.fount = { s, g, p }; }
    }

    // ---------- the nearest fire the hearths module reports: one crackling loop, moved to it ----------
    const fire = fireN && fireN.seen > t - 1.5 ? fireN : null;
    if (fire && !beds.fire && bank.crackle) { const s = A.createBufferSource(); s.buffer = bank.crackle[0]; s.loop = true; const g = A.createGain(); g.gain.value = 0; const p = panner(fire.x, fire.y, fire.z, 1.2); s.connect(g).connect(p).connect(busFx); s.start(A.currentTime, RR() * 8); beds.fire = { s, g, p }; }
    if (beds.fire) {
      const f = beds.fire; if (fire && fire !== fireP) { f.p.positionX.setTargetAtTime(fire.x, T, 0.05); f.p.positionY.setTargetAtTime(fire.y, T, 0.05); f.p.positionZ.setTargetAtTime(fire.z, T, 0.05); }
      f.g.gain.setTargetAtTime(fire ? (fire.big ? 0.95 : 0.6) : 0, T, 0.4); fireP = fire;
    }

    // ---------- voices: whoever holds the floor nearby says something (not everyone at once) ----------
    let busy = 0; for (const [i, until] of voxBusy) { if (until < T) voxBusy.delete(i); else busy++; }
    stats.voices = busy;
    for (const p of heard) {
      if (busy >= 5) break;
      if (!p.talking || p.walking || p.d > 20 || voxBusy.has(p.i) || RR() > (p.orator ? 0.8 : 0.35)) continue;
      const kind = p.child ? 'child' : p.female ? 'woman' : RR() < 0.2 ? 'old' : 'man', b = pick(bank['vox_' + kind] || []); if (!b) continue;
      const r = (p.child ? 1.05 : 0.93) + ((p.seed * 7.31) % 1) * 0.14;   // a steady pitch per person
      play(b, p.x, p.y + 1.55, p.z, { gain: p.orator ? 1.0 : 0.75, ref: p.orator ? 2.5 : 1.3, rate: r, bus: busVox, wet: 0.8 });
      voxBusy.set(p.i, T + b.duration / r + 0.6 + RR() * 2.5); busy++;
    }
  }
  function step(cam, k = 1) {
    const feet = cam.y - 1.7, stone = onStone(cam.x, cam.z, feet), b = pick(bank[stone ? 'stepStone' : 'stepDirt'] || []); if (!b) return;
    const s = A.createBufferSource(); s.buffer = b; s.playbackRate.value = 0.9 + RR() * 0.2; const g = A.createGain(); g.gain.value = (stone ? 0.16 : 0.2) * k; const pn = A.createStereoPanner(); pn.pan.value = (stats.steps % 2 ? 0.12 : -0.12);
    s.connect(g).connect(pn).connect(busFx); s.start(); stats.steps++;
  }
  // a line from chatter.js, spoken in Greek at the speaker's head (rendered a tick later, off the frame that asked)
  function speak(e) {
    const d = e.data || {}; stats.speech++;
    if (d.i !== undefined) voxBusy.set(d.i, A.currentTime + (d.dur || 3) + 1);   // (no other babble from them meanwhile)
    const kind = d.child ? 'child' : d.female ? 'woman' : d.old ? 'old' : d.orator ? 'orator' : 'man', v = S.VOICES[kind](rng(d.seed ? Math.floor(d.seed * 1e6) : 7));   // (a person keeps their voice)
    if (d.sing) v.sing = 1;
    const text = d.greek || S.babbleText(RR, Math.max(3, Math.round((d.dur || 3) * 1.6)));
    synth('speech', Math.floor(RR() * 1e9), text, v).then(arr => {
      if (!arr || !A) return;
      const b = buf(arr); if (d.i !== undefined) voxBusy.set(d.i, A.currentTime + b.duration + 1);
      play(b, e.x, e.y, e.z, { gain: d.orator ? 1.0 : d.sing ? 0.95 : 0.8, ref: d.orator || d.sing ? 2.5 : 1.6, bus: busVox, wet: 0.8 });
    });
  }

  function toggleMute() {
    muted = !muted; try { localStorage.setItem('halicarnassus.mute', muted ? '1' : '0'); } catch (e) { /* storage may be blocked */ }
    if (A) master.gain.setTargetAtTime(muted ? 0 : 0.9, A.currentTime, 0.08);
  }
  document.addEventListener('keydown', e => { if (e.code === 'KeyM' && !e.repeat) toggleMute(); });
  if (q.get('audio') === '1') start();
  return {
    start, update,
    get muted() { return muted; },
    debug: () => ({ running: A ? A.state : 'not started', ready, muted, levels: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, +v.toFixed(3)])), live: live.size, ...stats, bank: Object.fromEntries(Object.entries(bank).map(([k, v]) => [k, v.length])) }),
  };
}
