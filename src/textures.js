// Texture loading (Polyhaven CC0 sets) and procedural texture synthesis.
import * as THREE from 'three';
import { makeNoise2D, clamp, smoothstep, lerp, rng, TAU } from './util.js';

const MAX_ANISO = 8;

// ---------- file-based PBR sets ----------
// textures/<name>/<name>_<map>_<res>.jpg ; sizeM = real-world size of one tile in metres.
export function loadSet(loader, name, res, sizeM, opts = {}) {
  const out = { sizeM };
  const rep = 1 / sizeM;
  const cfg = (t, srgb) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep * (opts.aspect || 1)); t.anisotropy = MAX_ANISO;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  out.map = cfg(loader.load(`textures/${name}/${name}_diff_${res}.jpg`), true);
  out.normalMap = cfg(loader.load(`textures/${name}/${name}_nor_gl_${res}.jpg`), false);
  if (opts.rough !== false) out.roughnessMap = cfg(loader.load(`textures/${name}/${name}_rough_${res}.jpg`), false);
  return out;
}

// ---------- helpers ----------
function dataTex(arr, w, h, { srgb = false, flipY = false, repeat = true } = {}) {
  const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.flipY = flipY;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.anisotropy = MAX_ANISO;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}
// height (Float32, 0..1) → tangent-space normal RGBA. rowsDown=true when row 0 is the top of the image (canvas origin).
export function heightToNormal(h, w, hgt, strength = 1, rowsDown = true, wrap = true) {
  const out = new Uint8ClampedArray(w * hgt * 4);
  const at = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + hgt) % hgt; } else { x = clamp(x, 0, w - 1); y = clamp(y, 0, hgt - 1); }
    return h[y * w + x];
  };
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * strength;
    let nx = -dx, ny = rowsDown ? dy : -dy, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out[i] = (nx * 0.5 + 0.5) * 255; out[i + 1] = (ny * 0.5 + 0.5) * 255; out[i + 2] = (nz * 0.5 + 0.5) * 255; out[i + 3] = 255;
  }
  return out;
}
function blur(h, w, hgt, r, wrap = true) { // separable box blur, r passes of radius 1 approximates gaussian
  let a = h, b = new Float32Array(h.length);
  const idx = (x, y) => { if (wrap) { x = (x + w) % w; y = (y + hgt) % hgt; } else { x = clamp(x, 0, w - 1); y = clamp(y, 0, hgt - 1); } return y * w + x; };
  for (let p = 0; p < r; p++) {
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) b[y * w + x] = (a[idx(x - 1, y)] + a[idx(x, y)] * 2 + a[idx(x + 1, y)]) * 0.25;
    for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) a[y * w + x] = (b[idx(x, y - 1)] + b[idx(x, y)] * 2 + b[idx(x, y + 1)]) * 0.25;
  }
  return a;
}
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function canvasHeight(c) { // luminance of a canvas → Float32 0..1
  const ctx = c.getContext('2d'); const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}
function texFromCanvas(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAX_ANISO; if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- marble ----------
export function makeMarble({ size = 1024, seed = 7, tileM = 3.0, veinStrength = 0.75, warm = 1 } = {}) {
  const N = makeNoise2D(seed), N2 = makeNoise2D(seed + 11);
  const P = 4;
  const col = new Uint8ClampedArray(size * size * 4), rgh = new Uint8ClampedArray(size * size * 4), hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = y * size + x;
    const wx = N.fbm(u * P, v * P, 4, P), wy = N2.fbm(u * P + 3.1, v * P + 1.7, 4, P);
    const vA = Math.abs(Math.sin(TAU * (2 * u + 1 * v) + 4.5 * wx));
    const vB = Math.abs(Math.sin(TAU * (1 * u - 3 * v) + 6.0 * wy + 1.3));
    const clouds = N.fbm(u * P * 2 + 7, v * P * 2 + 2, 4, P * 2);
    const speck = N2.fbm(u * P * 24, v * P * 24, 2, P * 24);
    const fadeA = smoothstep(-0.35, 0.25, clouds), fadeB = smoothstep(-0.2, 0.4, -clouds);
    const veinA = Math.pow(1 - smoothstep(0, 0.10, vA), 1.6) * fadeA;
    const veinB = Math.pow(1 - smoothstep(0, 0.045, vB), 1.4) * 0.7 * fadeB;
    const vein = clamp(veinA + veinB, 0, 1) * veinStrength;
    const base = 0.93 + 0.05 * clouds - 0.03 * Math.abs(speck);
    let r = base * 244, g = base * 241, b = base * (233 + 4 * (1 - warm));
    r = lerp(r, 128, vein); g = lerp(g, 130, vein); b = lerp(b, 140, vein);
    col[i * 4] = r; col[i * 4 + 1] = g; col[i * 4 + 2] = b; col[i * 4 + 3] = 255;
    const ro = clamp(0.42 + 0.16 * speck + 0.12 * vein + 0.05 * clouds, 0, 1) * 255;
    rgh[i * 4] = ro; rgh[i * 4 + 1] = ro; rgh[i * 4 + 2] = ro; rgh[i * 4 + 3] = 255;
    hgt[i] = 0.5 + 0.35 * speck - 0.6 * vein;
  }
  const nrm = heightToNormal(hgt, size, size, 2.2, false, true);
  const rep = 1 / tileM;
  const mk = (arr, srgb) => { const t = dataTex(arr, size, size, { srgb }); t.repeat.set(rep, rep); return t; };
  return { map: mk(col, true), roughnessMap: mk(rgh, false), normalMap: mk(nrm, false), sizeM: tileM };
}

// ---------- painted relief frieze (Amazonomachy) ----------
const MARBLE_FIG = '#e9e3d6';
function stroke(ctx, pts, w) { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke(); }
function disc(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
function ell(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill(); }

function drawWarrior(ctx, x, baseY, h, R, kind) {
  const u = h / 7.5;
  ctx.save(); ctx.translate(x, baseY); if (R() < 0.5) ctx.scale(-1, 1);
  const lean = (R() - 0.3) * 0.5;
  ctx.rotate(lean * 0.4);
  const hipY = -3.6 * u, shY = -6.1 * u, headY = -6.95 * u;
  const pose = kind === 'fallen' ? 'fallen' : (R() < 0.5 ? 'lunge' : (R() < 0.5 ? 'guard' : 'strike'));
  if (pose === 'fallen') { ctx.rotate(-Math.PI / 2 + 0.25); ctx.translate(0.8 * u, -0.3 * u); }
  ctx.strokeStyle = ctx.fillStyle = MARBLE_FIG; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // legs
  const lw = 0.62 * u;
  if (pose === 'lunge') { stroke(ctx, [[0, hipY], [1.4 * u, -1.9 * u], [1.9 * u, 0]], lw); stroke(ctx, [[0, hipY], [-1.0 * u, -1.6 * u], [-2.4 * u, 0]], lw); }
  else if (pose === 'guard') { stroke(ctx, [[0, hipY], [0.5 * u, -1.8 * u], [0.9 * u, 0]], lw); stroke(ctx, [[0, hipY], [-0.6 * u, -1.9 * u], [-1.2 * u, 0]], lw); }
  else { stroke(ctx, [[0, hipY], [0.9 * u, -1.7 * u], [1.3 * u, 0]], lw); stroke(ctx, [[0, hipY], [-0.8 * u, -2.0 * u], [-0.4 * u, 0]], lw); }
  // feet
  ell(ctx, 1.4 * u, -0.15 * u, 0.55 * u, 0.22 * u); ell(ctx, -1.2 * u, -0.15 * u, 0.55 * u, 0.22 * u);
  // skirt / chiton
  ctx.beginPath(); ctx.moveTo(-0.9 * u, hipY + 0.2 * u); ctx.lineTo(0.9 * u, hipY + 0.2 * u); ctx.lineTo(1.3 * u, hipY + 1.5 * u); ctx.lineTo(-1.3 * u, hipY + 1.5 * u); ctx.closePath(); ctx.fill();
  // torso
  ell(ctx, 0, (hipY + shY) / 2, 0.95 * u, 1.45 * u, lean * 0.3);
  ell(ctx, 0, shY + 0.1 * u, 1.25 * u, 0.5 * u);
  // head + helmet / hair
  disc(ctx, 0, headY, 0.52 * u);
  if (kind === 'greek') { ctx.beginPath(); ctx.arc(0, headY - 0.05 * u, 0.62 * u, Math.PI, TAU); ctx.fill(); stroke(ctx, [[-0.2 * u, headY - 0.6 * u], [0.6 * u, headY - 1.3 * u], [1.3 * u, headY - 1.1 * u]], 0.3 * u); }
  else { ell(ctx, -0.15 * u, headY - 0.15 * u, 0.6 * u, 0.5 * u); ell(ctx, -0.55 * u, headY + 0.3 * u, 0.25 * u, 0.5 * u); }
  // arms
  const aw = 0.48 * u;
  if (pose === 'strike') { stroke(ctx, [[0.6 * u, shY], [1.5 * u, shY - 1.2 * u], [0.9 * u, shY - 2.2 * u]], aw); stroke(ctx, [[-0.6 * u, shY], [-1.6 * u, shY + 0.6 * u], [-1.9 * u, shY + 1.6 * u]], aw); }
  else if (pose === 'guard') { stroke(ctx, [[0.6 * u, shY], [1.6 * u, shY + 0.5 * u], [1.4 * u, shY + 1.6 * u]], aw); stroke(ctx, [[-0.6 * u, shY], [-1.5 * u, shY - 0.6 * u], [-2.3 * u, shY - 1.3 * u]], aw); }
  else { stroke(ctx, [[0.6 * u, shY], [1.8 * u, shY - 0.4 * u], [2.6 * u, shY - 1.2 * u]], aw); stroke(ctx, [[-0.6 * u, shY], [-1.4 * u, shY + 0.8 * u], [-1.0 * u, shY + 1.8 * u]], aw); }
  // weapon / shield
  if (R() < 0.55) { ctx.lineWidth = 0.14 * u; const sx = pose === 'strike' ? 0.9 * u : 2.6 * u, sy = pose === 'strike' ? shY - 2.2 * u : shY - 1.2 * u; ctx.beginPath(); ctx.moveTo(sx - 2.5 * u, sy + 2.0 * u); ctx.lineTo(sx + 2.0 * u, sy - 1.6 * u); ctx.stroke(); }
  if (R() < 0.5) { const sx = pose === 'guard' ? 1.4 * u : -1.0 * u, sy = pose === 'guard' ? shY + 1.6 * u : shY + 1.8 * u; ctx.fillStyle = MARBLE_FIG; disc(ctx, sx, sy, 1.35 * u); ctx.fillStyle = '#cfc7b8'; disc(ctx, sx, sy, 1.0 * u); }
  else if (R() < 0.4) { const sx = pose === 'guard' ? 1.4 * u : -1.0 * u, sy = pose === 'guard' ? shY + 1.6 * u : shY + 1.8 * u; ctx.fillStyle = MARBLE_FIG; ctx.beginPath(); ctx.moveTo(sx - 0.9 * u, sy - 0.6 * u); ctx.lineTo(sx + 0.9 * u, sy - 0.6 * u); ctx.lineTo(sx + 0.6 * u, sy + 1.2 * u); ctx.lineTo(sx - 0.6 * u, sy + 1.2 * u); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}
function drawHorseRider(ctx, x, baseY, h, R) {
  const u = h / 7.5;
  ctx.save(); ctx.translate(x, baseY); if (R() < 0.5) ctx.scale(-1, 1);
  ctx.strokeStyle = ctx.fillStyle = MARBLE_FIG; ctx.lineCap = 'round';
  const rear = R() < 0.5;
  ctx.rotate(rear ? -0.35 : -0.05);
  // legs
  const lw = 0.5 * u;
  stroke(ctx, [[1.6 * u, -3.2 * u], [2.4 * u, -1.6 * u], [2.2 * u, 0]], lw); stroke(ctx, [[1.2 * u, -3.2 * u], [1.9 * u, -1.4 * u], [3.0 * u, -0.6 * u]], lw);
  stroke(ctx, [[-1.6 * u, -3.2 * u], [-2.3 * u, -1.6 * u], [-2.0 * u, 0]], lw); stroke(ctx, [[-1.2 * u, -3.2 * u], [-1.6 * u, -1.6 * u], [-2.8 * u, -0.3 * u]], lw);
  // body, neck, head
  ell(ctx, 0, -3.7 * u, 2.4 * u, 1.05 * u);
  ell(ctx, 2.4 * u, -4.9 * u, 0.7 * u, 1.5 * u, -0.5);
  ell(ctx, 3.4 * u, -6.0 * u, 0.9 * u, 0.45 * u, 0.35);
  stroke(ctx, [[3.0 * u, -6.4 * u], [3.1 * u, -7.0 * u]], 0.2 * u);
  stroke(ctx, [[-2.3 * u, -3.9 * u], [-3.3 * u, -2.6 * u], [-3.5 * u, -1.4 * u]], 0.35 * u); // tail
  // rider
  const rx = -0.2 * u;
  stroke(ctx, [[rx, -4.4 * u], [rx + 0.9 * u, -3.4 * u], [rx + 1.1 * u, -2.2 * u]], 0.45 * u);
  ell(ctx, rx, -5.6 * u, 0.85 * u, 1.3 * u, 0.15);
  disc(ctx, rx + 0.2 * u, -7.3 * u, 0.5 * u);
  ell(ctx, rx + 0.05 * u, -7.45 * u, 0.6 * u, 0.5 * u);
  stroke(ctx, [[rx + 0.5 * u, -6.4 * u], [rx + 1.7 * u, -6.9 * u], [rx + 2.4 * u, -7.8 * u]], 0.42 * u);
  ctx.lineWidth = 0.13 * u; ctx.beginPath(); ctx.moveTo(rx + 0.5 * u, -6.0 * u); ctx.lineTo(rx + 4.2 * u, -9.4 * u); ctx.stroke();
  ctx.restore();
}
export function makeFrieze({ w = 2048, h = 512, seed = 3, bg = '#6e2a22', tileM = 3.6, heightM = 0.9, density = 1 } = {}) {
  const hc = canvas(w, h), hctx = hc.getContext('2d');
  hctx.fillStyle = '#000'; hctx.fillRect(0, 0, w, h);
  const R = rng(seed);
  const figH = h * 0.78, baseY = h * 0.91;
  const n = Math.round(9 * density);
  // draw twice (x and x±w) so figures wrap across the tile seam
  const items = [];
  for (let i = 0; i < n; i++) items.push({ x: (i + 0.5) * (w / n) + (R() - 0.5) * (w / n) * 0.5, kind: R() < 0.22 ? 'rider' : (R() < 0.15 ? 'fallen' : (R() < 0.5 ? 'greek' : 'amazon')), s: 0.9 + R() * 0.15 });
  for (const it of items) for (const dx of [-w, 0, w]) {
    const r2 = rng(Math.floor(it.x * 13) + seed);
    if (it.kind === 'rider') drawHorseRider(hctx, it.x + dx, baseY, figH * it.s, r2); else drawWarrior(hctx, it.x + dx, baseY, figH * it.s * (it.kind === 'fallen' ? 0.9 : 1), r2, it.kind);
  }
  // ground line
  hctx.fillStyle = '#fff'; hctx.fillRect(0, baseY - 2, w, 6);
  const mask = canvasHeight(hc);
  const soft = blur(Float32Array.from(mask), w, h, 3);
  const N = makeNoise2D(seed);
  const col = new Uint8ClampedArray(w * h * 4);
  const bgc = new THREE.Color(bg), fg = new THREE.Color(MARBLE_FIG);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, m = mask[i];
    const nse = N.fbm(x / w * 6, y / h * 1.5, 3, 6) * 0.06;
    const shade = 0.78 + 0.25 * soft[i];
    const r = m > 0.5 ? fg.r * shade : bgc.r * (1 + nse), g = m > 0.5 ? fg.g * shade : bgc.g * (1 + nse), b = m > 0.5 ? fg.b * shade : bgc.b * (1 + nse);
    col[i * 4] = clamp(r, 0, 1) * 255; col[i * 4 + 1] = clamp(g, 0, 1) * 255; col[i * 4 + 2] = clamp(b, 0, 1) * 255; col[i * 4 + 3] = 255;
  }
  const hgt = blur(Float32Array.from(mask), w, h, 2);
  for (let i = 0; i < hgt.length; i++) hgt[i] = hgt[i] * 0.8 + soft[i] * 0.2;
  const nrm = heightToNormal(hgt, w, h, 6, true, true);
  const map = dataTex(col, w, h, { srgb: true, flipY: true }), normalMap = dataTex(nrm, w, h, { flipY: true });
  map.repeat.set(1 / tileM, 1 / heightM); normalMap.repeat.set(1 / tileM, 1 / heightM);
  const rough = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = mask[i] > 0.5 ? 120 : 175; rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = v; rough[i * 4 + 3] = 255; }
  const roughnessMap = dataTex(rough, w, h, { flipY: true }); roughnessMap.repeat.set(1 / tileM, 1 / heightM);
  return { map, normalMap, roughnessMap, tileM, heightM };
}

// ---------- coffered ceiling tile ----------
export function makeCoffer({ size = 512, tileM = 1.0 } = {}) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const hgt = new Float32Array(size * size);
  const steps = [[0, '#ece7dc', 1.0], [0.09, '#e4ded2', 0.75], [0.16, '#dcd6c9', 0.5], [0.23, '#2f4f8f', 0.0]];
  for (const [inset, color, hv] of steps) {
    const p = inset * size; ctx.fillStyle = color; ctx.fillRect(p, p, size - 2 * p, size - 2 * p);
    for (let y = Math.floor(p); y < size - p; y++) for (let x = Math.floor(p); x < size - p; x++) hgt[y * size + x] = hv;
  }
  // gilded star in the field
  ctx.fillStyle = '#c9a63c'; ctx.beginPath();
  const cx = size / 2, R1 = size * 0.14, R2 = size * 0.05;
  for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8 - Math.PI / 2, r = i % 2 ? R2 : R1; ctx.lineTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r); }
  ctx.closePath(); ctx.fill();
  const bl = blur(hgt, size, size, 2, false);
  const nrm = heightToNormal(bl, size, size, 5, true, false);
  const map = texFromCanvas(c, true); map.repeat.set(1 / tileM, 1 / tileM);
  const normalMap = dataTex(nrm, size, size, { flipY: true }); normalMap.repeat.set(1 / tileM, 1 / tileM);
  return { map, normalMap, tileM };
}

// ---------- meander band (painted) ----------
export function makeMeander({ w = 512, h = 64, fg = '#2c4e8c', bg = '#e8e2d4' } = {}) {
  const c = canvas(w, h), ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = fg; ctx.lineWidth = h * 0.11; ctx.lineCap = 'butt';
  const s = h * 0.8, n = Math.floor(w / s);
  for (let i = 0; i < n; i++) {
    const x = i * (w / n), q = (w / n) / 4, m = h * 0.1;
    ctx.beginPath();
    ctx.moveTo(x, h - m); ctx.lineTo(x, m); ctx.lineTo(x + 3 * q, m); ctx.lineTo(x + 3 * q, h - m - 2 * q * 0.9); ctx.lineTo(x + q, h - m - 2 * q * 0.9); ctx.lineTo(x + q, m + 2 * q * 0.9); ctx.lineTo(x + 2 * q, m + 2 * q * 0.9);
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 4 * q, m); ctx.lineTo(x + 4 * q, h - m); ctx.lineTo(x + 1 * q + 4 * q, h - m); ctx.stroke();
  }
  const t = texFromCanvas(c, true); return { map: t };
}

// ---------- foliage cards ----------
export function makeLeafCard(kind, size = 256, seed = 5) {
  const c = canvas(size, kind === 'cypress' ? size * 2 : size), ctx = c.getContext('2d');
  const R = rng(seed);
  ctx.clearRect(0, 0, c.width, c.height);
  if (kind === 'olive') {
    const cols = ['#6b7a55', '#7e8d66', '#8f9c78', '#5c6a4a', '#a3ad8e'];
    for (let k = 0; k < 9; k++) {
      const cx = size * (0.2 + 0.6 * R()), cy = size * (0.2 + 0.6 * R());
      for (let i = 0; i < 26; i++) {
        const a = R() * TAU, d = R() * size * 0.22;
        ctx.fillStyle = cols[Math.floor(R() * cols.length)];
        ctx.save(); ctx.translate(cx + Math.cos(a) * d, cy + Math.sin(a) * d); ctx.rotate(a + (R() - 0.5));
        ctx.beginPath(); ctx.ellipse(0, 0, size * 0.045, size * 0.011, 0, 0, TAU); ctx.fill(); ctx.restore();
      }
    }
  } else if (kind === 'cypress') {
    const cols = ['#1f3a22', '#2a4a2b', '#213f25', '#365a35', '#172d19'];
    for (let i = 0; i < 5200; i++) {
      const v = R(); const y = v * c.height;
      const halfW = size * 0.42 * Math.sin(Math.PI * Math.pow(v, 0.75)) * (0.75 + 0.25 * R());
      const x = size / 2 + (R() * 2 - 1) * halfW;
      ctx.fillStyle = cols[Math.floor(R() * cols.length)];
      ctx.beginPath(); ctx.ellipse(x, y, size * 0.018, size * 0.03, R() * TAU, 0, TAU); ctx.fill();
    }
  } else if (kind === 'pine') {
    const cols = ['#2f4f2a', '#3b5e33', '#26411f', '#4a6e3c'];
    for (let k = 0; k < 14; k++) {
      const cx = size * (0.15 + 0.7 * R()), cy = size * (0.15 + 0.7 * R());
      ctx.lineWidth = size * 0.008; ctx.lineCap = 'round';
      for (let i = 0; i < 40; i++) {
        const a = R() * TAU, l = size * (0.05 + 0.08 * R());
        ctx.strokeStyle = cols[Math.floor(R() * cols.length)];
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); ctx.stroke();
      }
    }
  } else if (kind === 'plane') {
    const cols = ['#4f7a3a', '#5f8b45', '#6e9a52', '#436a33', '#84a862'];
    for (let k = 0; k < 7; k++) {
      const cx = size * (0.2 + 0.6 * R()), cy = size * (0.2 + 0.6 * R());
      for (let i = 0; i < 12; i++) {
        const a = R() * TAU, d = R() * size * 0.18, r = size * (0.05 + 0.03 * R());
        ctx.fillStyle = cols[Math.floor(R() * cols.length)];
        ctx.beginPath();
        const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
        for (let j = 0; j < 5; j++) { const b = a + j * TAU / 5; ctx.lineTo(px + Math.cos(b) * r, py + Math.sin(b) * r); ctx.lineTo(px + Math.cos(b + TAU / 10) * r * 0.5, py + Math.sin(b + TAU / 10) * r * 0.5); }
        ctx.closePath(); ctx.fill();
      }
    }
  }
  const t = texFromCanvas(c, true, false); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// dense, opaque cypress foliage for the spindle body
export function makeCypressBody(size = 256, seed = 8) {
  const c = canvas(size, size), ctx = c.getContext('2d'); const R = rng(seed);
  ctx.fillStyle = '#1b3320'; ctx.fillRect(0, 0, size, size);
  const cols = ['#24452a', '#2d5231', '#1f3d24', '#3a6238', '#193020', '#33592f', '#456b3c'];
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = cols[Math.floor(R() * cols.length)];
    const x = R() * size, y = R() * size;
    for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) { ctx.beginPath(); ctx.ellipse(x + dx, y + dy, size * 0.02, size * 0.036, (R() - 0.5) * 0.8, 0, TAU); ctx.fill(); }
  }
  return texFromCanvas(c, true, true);
}

// ---------- palmette antefix silhouette ----------
export function makePalmette(size = 128) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#e8e2d4';
  const cx = size / 2, by = size * 0.95;
  for (let i = -3; i <= 3; i++) {
    const a = -Math.PI / 2 + i * 0.28, l = size * (0.42 - Math.abs(i) * 0.03);
    ctx.save(); ctx.translate(cx, by - size * 0.18); ctx.rotate(a + Math.PI / 2);
    ctx.beginPath(); ctx.ellipse(0, -l / 2, size * 0.055, l / 2, 0, 0, TAU); ctx.fill(); ctx.restore();
  }
  ctx.beginPath(); ctx.arc(cx, by - size * 0.16, size * 0.13, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(cx - size * 0.2, by - size * 0.05, size * 0.09, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + size * 0.2, by - size * 0.05, size * 0.09, 0, TAU); ctx.fill();
  ctx.fillStyle = '#b8402f'; ctx.beginPath(); ctx.arc(cx, by - size * 0.16, size * 0.06, 0, TAU); ctx.fill();
  const t = texFromCanvas(c, true, false); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// ---------- soft cloud sprite ----------
export function makeCloud(size = 512, seed = 9) {
  const N = makeNoise2D(seed);
  const arr = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size - 0.5, v = y / size - 0.5;
    const d = Math.hypot(u * 1.0, v * 2.2);
    const n = N.fbm(u * 6 + 3, v * 6 + 5, 5) * 0.5 + 0.5;
    const a = clamp((0.55 - d) * 2.2 + (n - 0.5) * 1.4, 0, 1);
    const i = (y * size + x) * 4;
    const shade = 0.82 + 0.18 * clamp(1 - a * 0.6 + (v < 0 ? 0.3 : 0), 0, 1);
    arr[i] = 255 * shade; arr[i + 1] = 253 * shade; arr[i + 2] = 250 * shade; arr[i + 3] = a * a * 255;
  }
  const t = dataTex(arr, size, size, { srgb: true, repeat: false }); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// ---------- low-frequency tileable variation (grey) ----------
export function makeMacroNoise(size = 512, seed = 21) {
  const N = makeNoise2D(seed);
  const arr = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = N.fbm(x / size * 4, y / size * 4, 5, 4) * 0.5 + 0.5;
    const i = (y * size + x) * 4; arr[i] = arr[i + 1] = arr[i + 2] = v * 255; arr[i + 3] = 255;
  }
  return dataTex(arr, size, size, {});
}

// ---------- egg-and-dart normal band ----------
export function makeEggDart({ w = 512, h = 128 } = {}) {
  const hgt = new Float32Array(w * h);
  const n = 8, pw = w / n;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lx = (x % pw) / pw - 0.5, ly = y / h - 0.45;
    const egg = 1 - clamp(Math.hypot(lx * 3.2, ly * 2.4), 0, 1);
    const dart = Math.abs(lx) > 0.42 ? 0.5 * (1 - Math.abs(ly) * 1.5) : 0;
    hgt[y * w + x] = Math.max(Math.sqrt(Math.max(egg, 0)), dart);
  }
  const nrm = heightToNormal(blur(hgt, w, h, 1), w, h, 5, true, true);
  const normalMap = dataTex(nrm, w, h, {}); return { normalMap };
}
