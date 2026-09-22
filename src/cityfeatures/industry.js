// Town feature: industry. The potters' and craftsmen's quarter in the south-west of the town (four potteries with
// domed updraught kilns, a smithy, a dye works and fullery, a weaving yard, an olive press) and the masons' and
// sculptors' yard of the Mausoleum works beside the precinct's west wall. See src/cityfeatures/index.js.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Bucket, ColorBucket, box, lathe, ellipsoid, mat, rng, lerp, clamp, smoothstep, TAU, scaleUV, colorize, makeNoise2D } from '../util.js';
import { terrainHeight } from '../terrain.js';
import { figureGeometry, lionGeometry, horseGeometry } from '../sculpture.js';

export const name = 'industry';
const OWN = 'industry';

// ---------- sites (whole blocks or lots; see the lot list in layout.lots) ----------
function sites(L) {
  const b = (k, m, o = {}) => ({ ...L.blockRect(k, m), ...o });
  return {
    amphora: b(-9, 5), tiles: b(-8, 5, { maxZ: 394 }), dye: b(-8, 5, { minZ: 394 }), fine: b(-10, 5, { minZ: 385.2 }),
    family: b(-12, 5, { minX: -372.5, maxZ: 385.5 }), weave: b(-12, 4, { minZ: 344.5 }), press: b(-11, 5, { maxX: -329.6, minZ: 385.1, maxZ: 403.4 }),
    smithy: b(-8, 4, { maxX: -192.5, minZ: 340.5 }), masonsN: b(-7, -2), masonsS: b(-7, -1),
  };
}
export function plan(ctx) { for (const [k, r] of Object.entries(sites(ctx.layout))) ctx.layout.reserve(r, OWN, k); }

// ---------- shared shapes ----------
const cyl = (r0, r1, h, s = 8, open = false) => scaleUV(new THREE.CylinderGeometry(r0, r1, h, s, 1, open), TAU * Math.max(r0, r1), h);
const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1);
function pole(a, b, r, s = 6, open = true) { _A.set(...a); _B.set(...b); const L = _A.distanceTo(_B), g = cyl(r, r, L, s, open); _q.setFromUnitVectors(_Y, _B.clone().sub(_A).normalize()); return g.applyMatrix4(new THREE.Matrix4().compose(_A.clone().add(_B).multiplyScalar(0.5), _q, _one)); }
const POTS = {
  amph: [[[0.001, 0], [0.035, 0.02], [0.07, 0.14], [0.14, 0.36], [0.175, 0.56], [0.165, 0.68], [0.11, 0.76], [0.055, 0.8], [0.05, 0.92], [0.066, 0.95], [0.04, 0.96]], 7],
  jug: [[[0.001, 0], [0.07, 0], [0.1, 0.04], [0.15, 0.15], [0.13, 0.27], [0.06, 0.33], [0.055, 0.4], [0.075, 0.42]], 7],
  bowl: [[[0.001, 0], [0.06, 0], [0.08, 0.03], [0.17, 0.11], [0.19, 0.15], [0.17, 0.14], [0.07, 0.04], [0.001, 0.03]], 7],
  krater: [[[0.001, 0], [0.08, 0], [0.08, 0.06], [0.13, 0.1], [0.2, 0.27], [0.22, 0.35], [0.2, 0.37], [0.18, 0.33], [0.001, 0.3]], 8],
  small: [[[0.001, 0], [0.04, 0], [0.07, 0.08], [0.07, 0.19], [0.03, 0.23], [0.02, 0.29], [0.035, 0.31]], 5],
  pithos: [[[0.001, 0], [0.2, 0], [0.4, 0.25], [0.52, 0.65], [0.48, 1.0], [0.32, 1.2], [0.3, 1.28], [0.36, 1.32], [0.26, 1.3], [0.001, 1.2]], 12],
};
const POTW = { amph: 0.36, jug: 0.3, bowl: 0.38, krater: 0.44, small: 0.15, plate: 0.38, pithos: 1.05 };
const potCache = {};
// hi: rounder pots for shelves and racks, seen from a metre or two
const HISEG = { jug: 9, bowl: 10, krater: 10, small: 6 };
const pot = (t, hi = false) => potCache[t + hi] || (potCache[t + hi] = lathe(POTS[t][0], hi ? HISEG[t] ?? POTS[t][1] : POTS[t][1]));
const plates = k => potCache['p' + k] || (potCache['p' + k] = lathe([[0.001, 0], [0.07, 0], [0.18, 0.035], [0.19, 0.03 * k + 0.02], [0.17, 0.03 * k + 0.015], [0.001, 0.03 * k]], 10));
const FIRED = [0xb86a44, 0xc27b50, 0xa95f3c, 0xc98a5e, 0xb5744c];
const lin = (r, g, b) => new THREE.Color(r, g, b);          // linear, may exceed 1 (offsets the grey texture of M.terracotta / M.cloth)
const RAW = [lin(1.05, 0.72, 0.42), lin(1.0, 0.7, 0.44), lin(0.92, 0.64, 0.4), lin(1.1, 0.78, 0.5)];
const STONE = lin(1.3, 1.02, 0.68), MARB = lin(1.28, 1.0, 0.66), DRESSED = lin(1.45, 1.22, 0.9), REED = lin(1.0, 0.72, 0.34), WOOL = 0xc6a676, WOOLP = 0x9e8b66, WOOLC = lin(1.2, 0.98, 0.68);   // WOOLC: undyed wool on M.cloth
const BLACK = [0x2b2622, 0x332c27, 0x2f2723];
const DYES = [0x5b2a57, 0x9a3526, 0xc99a2e, 0x2e4a78, 0x4d6b3a, 0x7a2f4f, WOOL];
const ROOFC = [0xc8804f, 0xb8714a, 0xd08b5a, 0xa8654a, 0xbf7d55];
const PLASTER = [0xe8dcc4, 0xe6d3b0, 0xd9c7a3, 0xe9d9c0, 0xdcc39a];

// position hash in [-0.5, 0.5)
const hs = (x, y, z, k, seed = 0) => { const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 3.1 + k * 17.3) * 43758.5453; return v - Math.floor(v) - 0.5; };
// a box with jittered vertices (rough-hewn marble), UVs projected in metres
function rough(w, h, d, seed) {
  const g = new THREE.BoxGeometry(w, h, d, 3, 2, 3), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    uv.setXY(i, ax > 0.5 ? z : x, ay > 0.5 ? z : y);
    p.setXYZ(i, x + hs(x, y, z, 1, seed) * 0.1, y + hs(x, y, z, 2, seed) * 0.08, z + hs(x, y, z, 3, seed) * 0.1);
  }
  g.computeVertexNormals(); return g;
}
// soft round puff for the smoke (DataTexture: works in Node too)
function puffTexture() {
  const S = 64, N = makeNoise2D(41), a = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S - 0.5, v = y / S - 0.5, d = Math.hypot(u, v) * 2, n = N.fbm(u * 5 + 2, v * 5 + 7, 4) * 0.5 + 0.5;
    const al = clamp((1 - d) * 1.6 + (n - 0.5) * 1.1, 0, 1), i = (y * S + x) * 4, sh = 0.82 + 0.18 * (0.5 - v);
    a[i] = 250 * sh; a[i + 1] = 247 * sh; a[i + 2] = 243 * sh; a[i + 3] = Math.pow(al, 1.5) * 255;
  }
  const t = new THREE.DataTexture(a, S, S); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
export function build(ctx) {
  const { M, world, layout, B, G, setupMaterial, kit } = ctx;
  const S = sites(layout);
  const R = rng(3507);
  const c0 = world.colliders.length;
  const own = { tc: new ColorBucket(), pt: new ColorBucket(), rb: new Bucket(), gl: new ColorBucket(), fl: new ColorBucket() };   // (cloth, 'cl', is written two-faced into tc)
  const COL = new Set(['tc', 'pt', 'cl', 'fl', 'gl', 'walls', 'roofs']);
  // the laid floor of a masons' yard lifts everything standing on it (FLO: world x,z → metres above the terrain, or null)
  let FLO = null;
  const gy = (x, z) => terrainHeight(x, z) + (FLO ? FLO(x, z) : 0);
  const tgt = k => k === 'cl' ? own.tc : own[k] || B[k];
  const pick = a => a[Math.floor(R() * a.length)];
  const jit = (hex, a = 0.14) => { const c = new THREE.Color().copy(hex.isColor ? hex : new THREE.Color(hex)), k = 1 + (R() - 0.5) * a; c.r *= k; c.g *= k; c.b *= k; return c; };
  const norm = g => { const o = g.index ? g.clone() : mergeVertices(g, 1e-4); for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) o.deleteAttribute(k); if (!o.attributes.normal) o.computeVertexNormals(); if (!o.attributes.uv) o.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2)); o.clearGroups(); return o; };
  const put = (k, g, m, color) => { if (k === 'cl') { const [a, b] = twoFaced(g); put('tc', b, m, color); k = 'tc'; g = a; } const c = norm(g); if (COL.has(k)) { if (!c.attributes.color) colorize(c, color ?? 0xffffff); } else if (c.attributes.color) c.deleteAttribute('color'); if (m) c.applyMatrix4(m); tgt(k).list.push(c); return c; };
  const twoFaced = g => { const a = norm(g), b = a.clone(), ix = Array.from(b.index.array), nm = b.attributes.normal; for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]]; b.setIndex(ix); for (let i = 0; i < nm.count; i++) nm.setXYZ(i, -nm.getX(i), -nm.getY(i), -nm.getZ(i)); return [a, b]; };
  const colorFn = (g, fn) => { const p = g.attributes.position, a = new Float32Array(p.count * 3), c = new THREE.Color(); for (let i = 0; i < p.count; i++) { fn(p.getX(i), p.getY(i), p.getZ(i), c); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const collide = (minX, maxX, minZ, maxZ) => world.colliders.push({ minX, maxX, minZ, maxZ });
  const foreign = r => { for (let i = 0; i < c0; i++) { const q = world.colliders[i]; if (r.minX < q.maxX && r.maxX > q.minX && r.minZ < q.maxZ && r.maxZ > q.minZ) return true; } return false; };
  const minG = (x, z, hw, hd = hw) => Math.min(gy(x, z), gy(x - hw, z - hd), gy(x + hw, z - hd), gy(x - hw, z + hd), gy(x + hw, z + hd));
  const maxG = (x, z, hw, hd = hw) => Math.max(gy(x, z), gy(x - hw, z - hd), gy(x + hw, z - hd), gy(x - hw, z + hd), gy(x + hw, z + hd));
  const plumes = [];
  const plume = (x, y, z, o = {}) => plumes.push({ x, y, z, n: o.n ?? 14, H: o.H ?? 16, rate: o.rate ?? 0.035, size: o.size ?? 1.2, alpha: o.alpha ?? 0.62, col: new THREE.Color(o.col ?? 0xcfc8be), seed: R() * TAU });

  // local frame: (lx, lz) rotated by ry about the origin (x, z), heights relative to y
  function frame(x, z, ry = 0, y = null) {
    const c = Math.cos(ry), s = Math.sin(ry), Y = y ?? gy(x, z), base = mat(x, Y, z, 0, ry, 0);
    const w = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
    const F = {
      x, z, ry, y: Y, w,
      g: (lx, lz) => { const [a, b] = w(lx, lz); return gy(a, b) - Y; },
      m: (lx, ly, lz, rx = 0, r2 = 0, rz = 0, sc = 1) => base.clone().multiply(mat(lx, ly, lz, rx, r2, rz, sc)),
      p: (k, g, lx, ly, lz, o = {}) => put(k, g, F.m(lx, ly, lz, o.rx, o.ry, o.rz, o.s), o.c),
      pg: (k, g, lx, dy, lz, o = {}) => put(k, g, F.m(lx, F.g(lx, lz) + dy, lz, o.rx, o.ry, o.rz, o.s), o.c),
      vc: (k, g, fn, lx, ly, lz, o = {}) => { const cg = colorFn(norm(g), fn); cg.applyMatrix4(F.m(lx, ly, lz, o.rx, o.ry, o.rz, o.s)); tgt(k).list.push(cg); },
      col: (x0, x1, z0, z1) => { const p = [w(x0, z0), w(x1, z0), w(x0, z1), w(x1, z1)]; collide(Math.min(...p.map(q => q[0])), Math.max(...p.map(q => q[0])), Math.min(...p.map(q => q[1])), Math.max(...p.map(q => q[1]))); },
      work: (lx, lz, tlx, tlz, note) => { const [px, pz] = w(lx, lz), [qx, qz] = w(tlx, tlz); layout.addPoi({ type: 'work', x: px, z: pz, y: gy(px, pz), ry: Math.atan2(qx - px, qz - pz), r: 1, owner: OWN, note }); },
    };
    return F;
  }
  const gather = (x, z, r, note) => layout.addPoi({ type: 'gather', x, z, y: gy(x, z), r, owner: OWN, note });
  const area = (rect, nm, inset = 1.2) => layout.addArea({ name: nm, minX: rect.minX + inset, maxX: rect.maxX - inset, minZ: rect.minZ + inset, maxZ: rect.maxZ - inset, y: null, owner: OWN });

  // ---------- yard walls: low rubble following the ground, with gates ----------
  function wallStrip(ax, az, bx, bz, t, h) {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.3) return;
    const n = Math.max(1, Math.ceil(len / 1.2)), dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz * t / 2, nz = dx * t / 2;
    const rows = [];
    for (let i = 0; i <= n; i++) { const s = i / n * len, x = ax + dx * s, z = az + dz * s, g1 = gy(x + nx, z + nz), g2 = gy(x - nx, z - nz); rows.push({ x, z, s, yb: Math.min(g1, g2) - 0.6, yt: Math.max(g1, g2) + h + (i % n ? (R() - 0.5) * 0.14 : 0) }); }
    const P = [], U = [], I = [];
    const strip = (fa, fb, flip) => { const b0 = P.length / 3; for (const r of rows) { const A = fa(r), Bq = fb(r); P.push(...A[0], ...Bq[0]); U.push(...A[1], ...Bq[1]); } for (let i = 0; i < n; i++) { const a = b0 + 2 * i; if (flip) I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); else I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } };
    strip(r => [[r.x + nx, r.yb, r.z + nz], [r.s, r.yb]], r => [[r.x + nx, r.yt, r.z + nz], [r.s, r.yt]], false);
    strip(r => [[r.x - nx, r.yb, r.z - nz], [r.s, r.yb]], r => [[r.x - nx, r.yt, r.z - nz], [r.s, r.yt]], true);
    strip(r => [[r.x + nx, r.yt, r.z + nz], [r.s, 0]], r => [[r.x - nx, r.yt, r.z - nz], [r.s, t]], false);
    for (const [r, end] of [[rows[0], false], [rows[n], true]]) {
      const b0 = P.length / 3; P.push(r.x + nx, r.yb, r.z + nz, r.x + nx, r.yt, r.z + nz, r.x - nx, r.yt, r.z - nz, r.x - nx, r.yb, r.z - nz); U.push(0, r.yb, 0, r.yt, t, r.yt, t, r.yb);
      if (end) I.push(b0, b0 + 2, b0 + 1, b0, b0 + 3, b0 + 2); else I.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals();
    own.rb.list.push(g);
  }
  // spec: {n|s: [gate x offsets from minX] | false, w|e: [gate z offsets from minZ] | false}
  function yardWalls(r, spec, h = 1.25, t = 0.55) {
    const i = 0.35, GW = 1.35;
    const zA = spec.n === false ? r.minZ - i + t / 2 : r.minZ + i + t / 2, zB = spec.s === false ? r.maxZ + i - t / 2 : r.maxZ - i - t / 2;
    const runs = [];
    if (spec.n !== false) runs.push({ axis: 'x', c: r.minZ + i, a: r.minX + i - t / 2, b: r.maxX - i + t / 2, gates: (spec.n || []).map(u => r.minX + u), inward: 1 });
    if (spec.s !== false) runs.push({ axis: 'x', c: r.maxZ - i, a: r.minX + i - t / 2, b: r.maxX - i + t / 2, gates: (spec.s || []).map(u => r.minX + u), inward: -1 });
    if (spec.w !== false) runs.push({ axis: 'z', c: r.minX + i, a: zA, b: zB, gates: (spec.w || []).map(v => r.minZ + v), inward: 1 });
    if (spec.e !== false) runs.push({ axis: 'z', c: r.maxX - i, a: zA, b: zB, gates: (spec.e || []).map(v => r.minZ + v), inward: -1 });
    for (const run of runs) {
      const segs = []; let a = run.a;
      for (const g of run.gates.sort((p, q) => p - q)) { segs.push([a, g - GW]); a = g + GW; }
      segs.push([a, run.b]);
      for (const [s0, s1] of segs) {
        if (s1 - s0 < 0.3) continue;
        if (run.axis === 'x') { wallStrip(s0, run.c, s1, run.c, t, h); collide(s0, s1, run.c - t / 2, run.c + t / 2); }
        else { wallStrip(run.c, s0, run.c, s1, t, h); collide(run.c - t / 2, run.c + t / 2, s0, s1); }
      }
      for (const g of run.gates) {
        const F = run.axis === 'x' ? frame(g, run.c, 0) : frame(run.c, g, Math.PI / 2);
        for (const sx of [-1, 1]) F.pg('ashlar', box(0.55, h + 1.05, t + 0.1), sx * (GW + 0.02), (h + 1.05) / 2 - 0.5, 0);
        F.pg('ashlar', box(2 * GW - 0.1, 0.4, t + 0.1), 0, -0.14, 0);
        // one leaf standing open against the inner face
        const sx = R() < 0.5 ? -1 : 1, iz = run.inward, lx = sx * (GW + 0.72);
        F.pg('woodDark', box(1.2, 1.55, 0.06), lx, 0.85, iz * (t / 2 + 0.1));
        for (const by of [0.35, 1.35]) F.pg('wood', box(1.1, 0.12, 0.04), lx, by, iz * (t / 2 + 0.15));
      }
    }
  }

  // ---------- reed matting: bundles laid down the slope on a thin mat, a ragged fringe at the low eave, purlins beneath (roof frame: x across, z down the slope) ----------
  function reedRoof(F, w, L, y, rx, lz = 0, fringe = 0.34) {
    const base = F.m(0, y, lz, rx), q = (k, g, m, c) => put(k, g, base.clone().multiply(m), c);
    const n = Math.max(6, Math.round(w / 0.15)), bw = w / n, P = [], C = [], c = new THREE.Color();
    const quad = (a, b, d, e, col) => { P.push(...a, ...b, ...d, ...a, ...d, ...e); for (let k = 0; k < 6; k++) C.push(col.r, col.g, col.b); };
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + i * bw, x1 = x0 + bw * 1.08, xm = (x0 + x1) / 2, h = 0.025 + R() * 0.025, z0 = -L / 2 + (R() - 0.5) * 0.12, z1 = L / 2 + (R() - 0.5) * 0.12, dy = (R() - 0.5) * 0.02;
      c.set(0xa38358).multiplyScalar(0.7 + R() * 0.42); const lo = c.clone().multiplyScalar(0.8);
      quad([x0, dy, z1], [xm, dy + h, z1], [xm, dy + h, z0], [x0, dy, z0], c);
      quad([xm, dy + h, z1], [x1, dy, z1], [x1, dy, z0], [xm, dy + h, z0], c.clone().multiplyScalar(0.9));
      quad([x0, dy - 0.005, z0], [x1, dy - 0.005, z0], [x1, dy - 0.005, z1], [x0, dy - 0.005, z1], lo);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeVertexNormals();
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(P.length / 3 * 2), 2)); g.applyMatrix4(base); own.pt.list.push(mergeVertices(g, 1e-5));
    const fr = new THREE.PlaneGeometry(w, fringe, Math.max(4, Math.round(w / 0.11)), 1), p = fr.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setXYZ(i, p.getX(i) + (R() - 0.5) * 0.06, p.getY(i) - R() * fringe * 0.45, (R() - 0.5) * 0.05);
    fr.computeVertexNormals();
    q('cl', fr, mat(0, 0.02, L / 2 - 0.02, -rx).multiply(mat(0, -fringe / 2, 0)), jit(REED, 0.12).multiplyScalar(0.9));
    if (fringe > 0.3) for (const t of [-0.32, 0.02, 0.34]) q('woodDark', cyl(0.035, 0.035, w - 0.3, 6), mat(0, -0.06, t * L, 0, 0, Math.PI / 2));
  }

  // ---------- pots and stacks ----------
  // handles only on pots seen up close
  const handle = new THREE.TorusGeometry(0.065, 0.016, 3, 5, Math.PI);
  function amphora(F, lx, ly, lz, o = {}) {
    const m = F.m(lx, ly, lz, o.rx || 0, o.ry || 0, o.rz || 0, o.s || 1), c = o.c ?? jit(pick(FIRED));
    put('tc', pot('amph'), m, c);
    if (o.handles) for (const sx of [-1, 1]) put('tc', handle, m.clone().multiply(mat(sx * 0.055, 0.8, 0, 0, sx > 0 ? 0 : Math.PI, -Math.PI / 2)), c);
  }
  function amphoraStack(x, z, ry, n = 5, colors = FIRED) {
    const F = frame(x, z, ry, minG(x, z, n * 0.2, 0.6) - 0.02);
    for (const sz of [-0.3, 0.3]) F.p('woodDark', box(n * 0.37 + 0.2, 0.09, 0.1), 0, 0.04, sz);
    for (let k = 0; k < Math.min(3, n); k++) for (let i = 0; i < n - k; i++) {
      const dir = (i + k) % 2 ? 1 : -1, px = (i - (n - k - 1) / 2) * 0.36, py = 0.25 + k * 0.29;
      put('tc', pot('amph'), F.m(px, py, 0, dir * Math.PI / 2, 0, 0).multiply(mat(0, -0.5, 0, 0, R() * TAU, 0)), jit(pick(colors)));
    }
    F.col(-n * 0.2 - 0.1, n * 0.2 + 0.1, -0.55, 0.55);
    return F;
  }
  function jarRows(x, z, ry, nx, nz, type = 'amph', colors = FIRED, sp = 0.4, handles = false) {
    const F = frame(x, z, ry);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lx = (i - (nx - 1) / 2) * sp + (R() - 0.5) * 0.05, lz = (j - (nz - 1) / 2) * sp + (R() - 0.5) * 0.05;
      if (type === 'amph') amphora(F, lx, F.g(lx, lz) - 0.05, lz, { rx: (R() - 0.5) * 0.12, rz: (R() - 0.5) * 0.12, ry: R() * TAU, c: jit(pick(colors)), handles, s: 0.9 + R() * 0.15 });
      else F.pg('tc', pot(type), lx, -0.03, lz, { ry: R() * TAU, c: jit(pick(colors)), s: 0.9 + R() * 0.2 });
    }
    F.col(-nx * sp / 2 - 0.05, nx * sp / 2 + 0.05, -nz * sp / 2 - 0.05, nz * sp / 2 + 0.05);
    return F;
  }
  const potTypes = ['jug', 'jug', 'bowl', 'krater', 'small', 'small', 'plate'];
  function shelfPots(F, x0, x1, y, lz, colors) {
    let px = x0;
    while (true) {
      const t = pick(potTypes), s = 0.8 + R() * 0.3, w = POTW[t] * s;
      if (px + w > x1) break;
      if (t === 'plate') F.p('tc', plates(3 + Math.floor(R() * 4)), px + w / 2, y, lz, { s, c: jit(pick(colors)) });
      else F.p('tc', pot(t, true), px + w / 2, y, lz + (R() - 0.5) * 0.12, { s, ry: R() * TAU, c: jit(pick(colors)) });
      px += w + 0.06 + R() * 0.08;
    }
  }
  // drying rack: long axis local X, open both sides, a reed mat on top
  function rack(x, z, ry, len = 3.2, colors = RAW, matTop = true, shelves = [0.34, 0.98, 1.62]) {
    const F = frame(x, z, ry, minG(x, z, len / 2, 0.5));
    const nP = Math.max(2, Math.round(len / 1.6) + 1);
    for (let i = 0; i < nP; i++) for (const sz of [-1, 1]) F.p('wood', box(0.08, 2.35, 0.08), -len / 2 + i * len / (nP - 1), 0.97, sz * 0.33);
    for (const y of shelves) { F.p('wood', box(len + 0.12, 0.035, 0.74), 0, y, 0); shelfPots(F, -len / 2 + 0.08, len / 2 - 0.08, y + 0.018, 0, colors); }
    if (matTop) reedRoof(F, len + 0.6, 1.2, 2.17, 0.06, 0, 0.18);
    F.col(-len / 2 - 0.1, len / 2 + 0.1, -0.42, 0.42);
    return F;
  }
  function tileRows(x, z, ry, rows = 3, n = 14, flat = 2) {
    const F = frame(x, z, ry);
    for (let r = 0; r < rows; r++) for (let i = 0; i < n; i++) {
      const lx = (i - n / 2) * 0.09, lz = (r - (rows - 1) / 2) * 0.72;
      F.pg('tc', box(0.028, 0.5, 0.62), lx, 0.23, lz, { rz: 0.22, c: jit(pick(FIRED), 0.2) });
    }
    for (let p = 0; p < flat; p++) { const lx = n * 0.045 + 0.5 + p * 0.72; for (let k = 0; k < 10; k++) F.pg('tc', box(0.62, 0.03, 0.5), lx + (R() - 0.5) * 0.04, 0.015 + k * 0.032, (R() - 0.5) * 0.04, { ry: (R() - 0.5) * 0.06, c: jit(pick(FIRED), 0.2) }); }
    F.col(-n * 0.045 - 0.2, n * 0.045 + 0.5 + flat * 0.72, -rows * 0.36 - 0.1, rows * 0.36 + 0.1);
    return F;
  }
  function brickField(x, z, ry, nx, nz) {
    const F = frame(x, z, ry);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { if (R() < 0.08) continue; const lx = (i - (nx - 1) / 2) * 0.56, lz = (j - (nz - 1) / 2) * 0.56; F.pg('pt', box(0.44, 0.09, 0.44), lx, 0.02, lz, { ry: (R() - 0.5) * 0.08, c: jit(0x7f6547, 0.12) }); }
    // a mould and a finished stack
    F.pg('woodDark', box(0.52, 0.09, 0.06), nx * 0.28 + 0.4, 0.04, -0.23); F.pg('woodDark', box(0.52, 0.09, 0.06), nx * 0.28 + 0.4, 0.04, 0.23);
    for (let a = 0; a < 5; a++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) F.pg('pt', box(0.44, 0.09, 0.44), nx * 0.28 + 1.6 + i * 0.46, 0.04 + a * 0.095, (j - 1) * 0.46 - nz * 0.1, { c: jit(0x8a7152, 0.08) });
  }
  function sherdHeap(x, z, r = 1.6) {
    const F = frame(x, z, 0);
    F.pg('tc', ellipsoid(r, 0.55, r * 0.8, 10, 6), 0, -0.1, 0, { c: jit(0x9c6a4c) });
    for (let i = 0; i < 28; i++) { const a = R() * TAU, d = Math.sqrt(R()) * r * 0.95, lx = Math.cos(a) * d, lz = Math.sin(a) * d * 0.8, hh = 0.45 * Math.sqrt(Math.max(0, 1 - (d / r) ** 2)); F.p('tc', box(0.14 + R() * 0.12, 0.02, 0.1 + R() * 0.08), lx, F.g(lx, lz) - 0.1 + hh, lz, { rx: (R() - 0.5) * 1.2, ry: R() * TAU, rz: (R() - 0.5) * 1.2, c: jit(pick([...FIRED, 0x2b2622])) }); }
    F.col(-r * 0.8, r * 0.8, -r * 0.65, r * 0.65);
  }
  function fuel(x, z, ry, n = 16, len = 1.5) {
    const F = frame(x, z, ry);
    let k = 0;
    for (let layer = 0; k < n && layer < 5; layer++) for (let i = 0; i < 5 - layer && k < n; i++, k++) {
      const lx = (i - (4 - layer) / 2) * 0.3, r = 0.1 + R() * 0.06;
      F.p(R() < 0.5 ? 'woodDark' : 'wood', cyl(r, r, len + (R() - 0.5) * 0.4, 6), lx, F.g(0, 0) + r + layer * 0.26, (R() - 0.5) * 0.15, { rx: Math.PI / 2, ry: (R() - 0.5) * 0.15 });
    }
    F.col(-0.85, 0.85, -len / 2 - 0.1, len / 2 + 0.1);
  }
  function clayHeap(x, z, r = 1.3) {
    const F = frame(x, z, R() * TAU);
    F.pg('pt', ellipsoid(r, 0.6, r * 0.75, 10, 6), 0, -0.12, 0, { c: jit(0x86684c) });
    for (let i = 0; i < 5; i++) F.pg('pt', ellipsoid(0.22, 0.14, 0.18, 7, 5), r + 0.3 + (R() - 0.5) * 0.4, 0.06, (R() - 0.5) * 1.4, { ry: R() * 3, c: jit(0x756049) });
    F.col(-r, r, -r * 0.75, r * 0.75);
  }
  // levigation tanks stepping down along local X
  function tanks(x, z, ry, n = 3) {
    const F = frame(x, z, ry, minG(x, z, n * 1.1, 0.9));
    for (let i = 0; i < n; i++) {
      const lx = (i - (n - 1) / 2) * 2.15, top = 0.62 - i * 0.12;
      for (const sz of [-1, 1]) F.p('socles', box(2.1, top + 0.5, 0.18), lx, (top - 0.5) / 2, sz * 0.72);
      for (const sx of [-1, 1]) F.p('socles', box(0.18, top + 0.5, 1.26), lx + sx * 0.96, (top - 0.5) / 2, 0);
      F.p('pt', box(1.76, 0.02, 1.28), lx, top - 0.16, 0, { c: jit(i === n - 1 ? 0x8a7258 : 0x6f5a48, 0.06) });
    }
    F.col(-n * 1.08, n * 1.08, -0.85, 0.85);
    return F;
  }

  // ---------- buildings ----------
  function shed(x, z, w, d, h, ry, o = {}) {
    const hw = Math.abs(Math.cos(ry)) > 0.5 ? w / 2 : d / 2, hd = Math.abs(Math.cos(ry)) > 0.5 ? d / 2 : w / 2;
    const F = frame(x, z, ry, (minG(x, z, hw, hd) + maxG(x, z, hw, hd)) / 2);
    const pc = o.plaster ?? jit(pick(PLASTER), 0.05), rc = o.roof ?? pick(ROOFC), lo = minG(x, z, hw, hd) - F.y - 0.6;
    F.p('socles', box(w + 0.12, 0.7 - lo, d + 0.12), 0, (0.7 + lo) / 2, 0);
    F.p('walls', box(w, h - 0.7, d), 0, 0.7 + (h - 0.7) / 2, 0, { c: pc });
    F.p('roofs', kit.hipRoof(w, d), 0, h, 0, { c: rc });
    F.p('walls', box(w + 0.9, 0.1, d + 0.9), 0, h + 0.05, 0, { c: 0xd8ccb8 });
    const dx = o.door ?? 0;
    F.p('doors', box(1.2, 2.1, 0.14), dx, 1.05, d / 2 + 0.02);
    F.col(-w / 2 - 0.3, w / 2 + 0.3, -d / 2 - 0.3, d / 2 + 0.3);
    const [px, pz] = F.w(dx, d / 2 + 0.9), [nx, nz] = [Math.sin(ry), Math.cos(ry)];
    layout.addPoi({ type: 'door', x: px, z: pz, nx: Math.round(nx), nz: Math.round(nz), owner: OWN });
    return F;
  }
  // open-fronted shed (opening toward local +Z): back and side walls, posts, single-pitch tiled roof; heights from the highest ground
  function openShed(x, z, w, d, ry, o = {}) {
    const hb = o.hb ?? 3.4, hf = o.hf ?? 2.6;
    const hw = Math.abs(Math.cos(ry)) > 0.5 ? w / 2 : d / 2, hd = Math.abs(Math.cos(ry)) > 0.5 ? d / 2 : w / 2;
    const F = frame(x, z, ry, maxG(x, z, hw, hd));
    const pc = o.plaster ?? jit(pick(PLASTER), 0.05), rc = o.roof ?? pick(ROOFC), lo = minG(x, z, hw, hd) - F.y - 0.5;
    const soc = (sw, sd, lx, lz) => F.p('socles', box(sw, 0.3 - lo, sd), lx, (0.3 + lo) / 2, lz);
    soc(w + 0.1, 0.56, 0, -d / 2 + 0.25);
    F.p('walls', box(w, hb - 0.3, 0.45), 0, 0.3 + (hb - 0.3) / 2, -d / 2 + 0.25, { c: pc });
    const sd = o.sides ?? d - 0.5;
    for (const sx of [-1, 1]) {
      soc(0.56, sd, sx * (w / 2 - 0.25), -d / 2 + 0.5 + sd / 2);
      const topAt = lz => lerp(hb, hf, (lz + d / 2) / d);
      const sh = new THREE.Shape([new THREE.Vector2(-d / 2 + 0.5, 0.3), new THREE.Vector2(-d / 2 + 0.5 + sd, 0.3), new THREE.Vector2(-d / 2 + 0.5 + sd, topAt(-d / 2 + 0.5 + sd)), new THREE.Vector2(-d / 2 + 0.5, topAt(-d / 2 + 0.5))]);
      F.p('walls', new THREE.ExtrudeGeometry(sh, { depth: 0.45, bevelEnabled: false }), sx * (w / 2 - 0.25) + 0.225, 0, 0, { ry: -Math.PI / 2, c: pc });
    }
    const nPost = Math.max(2, Math.ceil(w / 3.6) + 1);
    for (let i = 0; i < nPost; i++) {
      const lx = -w / 2 + 0.15 + i * (w - 0.3) / (nPost - 1), g = F.g(lx, d / 2 - 0.15);
      F.p('socles', box(0.34, 0.5, 0.34), lx, g + 0.1, d / 2 - 0.15); F.p('wood', box(0.2, hf - g - 0.2, 0.2), lx, (hf + g + 0.2) / 2, d / 2 - 0.15); F.col(lx - 0.2, lx + 0.2, d / 2 - 0.35, d / 2 + 0.05);
    }
    F.p('wood', box(w + 0.1, 0.22, 0.24), 0, hf, d / 2 - 0.15);
    const rise = hb - hf, L = Math.hypot(d + 0.5, rise);
    F.p('roofs', box(w + 0.7, 0.12, L), 0, (hb + hf) / 2 + 0.1, 0.05, { rx: Math.atan2(rise, d + 0.5), c: rc });
    F.col(-w / 2 - 0.05, w / 2 + 0.05, -d / 2 - 0.05, -d / 2 + 0.5);
    for (const sx of [-1, 1]) F.col(sx > 0 ? w / 2 - 0.5 : -w / 2 - 0.05, sx > 0 ? w / 2 + 0.05 : -w / 2 + 0.5, -d / 2, -d / 2 + 0.5 + sd);
    return F;
  }
  // lean-to on posts (opening toward +Z), tiled or reed roof; heights from the highest ground
  function leanTo(x, z, w, d, ry, o = {}) {
    const hb = o.hb ?? 2.8, hf = o.hf ?? 2.15;
    const hw = Math.abs(Math.cos(ry)) > 0.5 ? w / 2 : d / 2, hd = Math.abs(Math.cos(ry)) > 0.5 ? d / 2 : w / 2;
    const F = frame(x, z, ry, maxG(x, z, hw, hd));
    const nP = Math.max(2, Math.ceil(w / 3.2) + 1);
    for (let i = 0; i < nP; i++) {
      const lx = -w / 2 + 0.1 + i * (w - 0.2) / (nP - 1), gb = F.g(lx, -d / 2 + 0.1) - 0.3, gf = F.g(lx, d / 2 - 0.1) - 0.3;
      F.p('woodDark', box(0.14, hb - gb, 0.14), lx, (hb + gb) / 2, -d / 2 + 0.1);
      F.p('woodDark', box(0.16, hf - gf, 0.16), lx, (hf + gf) / 2, d / 2 - 0.1);
      F.col(lx - 0.15, lx + 0.15, d / 2 - 0.25, d / 2 + 0.05);
    }
    F.p('woodDark', box(w, 0.14, 0.14), 0, hb - 0.07, -d / 2 + 0.1); F.p('woodDark', box(w, 0.16, 0.18), 0, hf - 0.08, d / 2 - 0.1);
    const rise = hb - hf, L = Math.hypot(d + 0.6, rise);
    if (o.reed) { const a = Math.atan2(rise, d - 0.2); reedRoof(F, w + 0.5, (d + 0.6) / Math.cos(a), (hb + hf) / 2 + 0.025, a); }
    else F.p('roofs', box(w + 0.5, 0.1, L), 0, (hb + hf) / 2 + 0.07, 0, { rx: Math.atan2(rise, d + 0.6), c: o.roof ?? pick(ROOFC) });
    return F;
  }

  // ---------- pottery ----------
  function ladder(F, a, b, w = 0.5, n = 0) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), k = n || Math.round(L / 0.32), dx = b[0] - a[0], dz = b[2] - a[2], hl = Math.hypot(dx, dz) || 1, px = -dz / hl * w / 2, pz = dx / hl * w / 2;
    for (const s of [-1, 1]) F.p('wood', pole([a[0] + s * px, a[1], a[2] + s * pz], [b[0] + s * px, b[1], b[2] + s * pz], 0.03, 5), 0, 0, 0);
    for (let i = 1; i < k; i++) { const t = i / k; F.p('wood', pole([lerp(a[0], b[0], t) - px, lerp(a[1], b[1], t), lerp(a[2], b[2], t) - pz], [lerp(a[0], b[0], t) + px, lerp(a[1], b[1], t), lerp(a[2], b[2], t) + pz], 0.018, 4), 0, 0, 0); }
  }
  // the stoke tunnel's vault (an arch profile extruded 1.25 m toward +Z) and the opening it frames
  const archTunnel = (() => { const IW = 0.38, IH = 0.42, OW = 0.72, b = -0.25, s = new THREE.Shape();
    s.moveTo(IW, b); s.lineTo(OW, b); s.lineTo(OW, IH); s.absarc(0, IH, OW, 0, Math.PI, false); s.lineTo(-OW, b); s.lineTo(-IW, b); s.lineTo(-IW, IH); s.absarc(0, IH, IW, Math.PI, 0, true); s.lineTo(IW, b);
    return new THREE.ExtrudeGeometry(s, { depth: 1.25, bevelEnabled: false, curveSegments: 7 }); })();
  const mouthPanel = (() => { const g = new THREE.CircleGeometry(0.37, 14), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, Math.max(0, p.getY(i) + 0.16)); return g; })();
  const hot = (c0, c1, rr) => (x, y, z, c) => { const t = smoothstep(0, rr, Math.hypot(x, (y - c1) * 1.1)); c.setScalar(lerp(1.15, c0, t)); };
  // updraught kiln: a mud-plastered firing chamber on a rubble footing, a domed top with a vent, the stoke hole toward local +Z
  function kiln(x, z, ry, o = {}) {
    const r = o.r ?? 2, firing = o.firing ?? true, H = r * 1.25 + 0.5;
    const F = frame(x, z, ry, minG(x, z, r + 0.6) - 0.05);
    const clay = new THREE.Color(jit(0xb48a62, 0.08)), soot = new THREE.Color(0x2e2824), burnt = new THREE.Color(0x9a6a4a);
    const prof = [[r + 0.02, 0.3], [r, 1.1], [r * 0.96, H * 0.5], [r * 0.86, H * 0.66], [r * 0.66, H * 0.82], [r * 0.4, H * 0.95], [0.38, H], [0.31, H - 0.02], [0.29, H - 0.35]];
    F.vc('walls', lathe(prof, 18), (px, py, pz, c) => {
      const ang = Math.abs(Math.atan2(px, pz)), front = (1 - smoothstep(0.15, 0.5, ang)) * clamp(1.25 - py * 0.55, 0, 0.85) * (firing ? 1 : 0.75);
      c.lerpColors(clay, burnt, clamp(py / H - 0.3, 0, 0.5) * (firing ? 0.9 : 0.5)); c.lerp(soot, Math.max(smoothstep(H * 0.72, H, py) * (firing ? 0.85 : 0.55), front));
    }, 0, 0, 0);
    F.p('socles', lathe([[r + 0.28, -0.8], [r + 0.26, 0.28], [r + 0.12, 0.4], [r - 0.05, 0.42]], 18), 0, 0, 0);
    // stoke passage: a short clay-vaulted tunnel into the firing chamber, black with soot inside, the fire at its far end
    const IW = 0.38, IH = 0.42;
    F.vc('walls', archTunnel, (px, py, pz, c) => {
      const inner = Math.abs(px) < IW + 0.02 && Math.hypot(px, Math.max(0, py - IH)) < IW + 0.02;
      c.lerpColors(clay, soot, inner ? 0.93 : clamp(0.2 + (pz - 0.6) * 0.5 + Math.max(0, 0.9 - Math.hypot(px, Math.max(0, py - IH)) * 1.1) * 0.5, 0.1, 0.8));
    }, 0, 0, r - 0.35);
    if (firing) { F.vc('gl', new THREE.CircleGeometry(0.3, 10), hot(0.2, 0, 0.3), 0, H - 0.33, 0, { rx: -Math.PI / 2 }); F.vc('gl', mouthPanel, hot(0.12, 0.12, 0.42), 0, 0.26, r + 0.3); }
    else { F.p('doors', new THREE.CircleGeometry(0.3, 10), 0, H - 0.33, 0, { rx: -Math.PI / 2 }); F.p('doors', mouthPanel, 0, 0.26, r + 0.3); }
    if (firing) {
      F.vc('gl', ellipsoid(0.34, 0.09, 0.34, 8, 4), hot(0.35, 0.09, 0.34), 0, 0.02, r + 0.5);
      for (let i = 0; i < 6; i++) F.p('pt', box(0.09, 0.05, 0.07), (R() - 0.5) * 0.5, 0.07 + R() * 0.03, r + 0.45 + R() * 0.3, { ry: R() * 3, c: 0x1c1a19 });
      for (let i = 0; i < 5; i++) F.p('woodDark', cyl(0.045, 0.04, 1.3, 5, true), (R() - 0.5) * 0.45, 0.07, r + 1.55 + R() * 0.25, { rx: Math.PI / 2 - 0.08, rz: (R() - 0.5) * 0.3 });
      ladder(F, [-(r + 1.3), F.g(-(r + 1.3), 0), 0.3], [-r * 0.52, H * 0.88, 0.2], 0.45);
      plume(F.w(0, 0)[0], F.y + H + 0.1, F.w(0, 0)[1], { H: 14 + R() * 5, size: 1.0 + r * 0.12 });
    } else {
      F.p('pt', ellipsoid(0.55, 0.07, 0.8, 8, 4), 0, 0.0, r + 1.3, { c: 0x5d5853 });
      // loading door in the dome, a stack of bricks to close it, pots waiting to be set
      const a = o.door ?? 1.0, rd = r * 0.97;
      F.p('doors', box(0.8, 1.0, 0.3), Math.sin(a) * rd, 1.5, Math.cos(a) * rd, { ry: a });
      for (let k = 0; k < 12; k++) F.pg('pt', box(0.36, 0.09, 0.2), Math.sin(a - 0.35) * (r + 1.4) + (k % 3 - 1) * 0.38, 0.045 + Math.floor(k / 3) * 0.095, Math.cos(a - 0.35) * (r + 1.4), { ry: a - 0.35, c: jit(0x7d6448) });
      for (let i = 0; i < 10; i++) { const d2 = r + 1.0 + (i % 5) * 0.4, a2 = a + (i < 5 ? 0.1 : 0.3); F.pg('tc', pot(pick(['jug', 'krater', 'jug', 'bowl'])), Math.sin(a2) * d2, -0.02, Math.cos(a2) * d2, { ry: R() * TAU, c: jit(pick(o.raw ?? RAW)) }); }
    }
    F.col(-r - 0.4, r + 0.4, -r - 0.4, r + 1.25);
    F.work(0, r + 2.1, 0, r, firing ? 'stoking the kiln' : 'loading the kiln');
    return F;
  }
  function brushPile(x, z, r = 1.6) {
    const F = frame(x, z, R() * TAU);
    F.pg('pt', ellipsoid(r, 0.7, r * 0.7, 10, 6), 0, -0.15, 0, { c: jit(0x5e5040) });
    for (let i = 0; i < 34; i++) { const a = R() * TAU, d = Math.sqrt(R()) * r * 0.9, lx = Math.cos(a) * d, lz = Math.sin(a) * d * 0.7, hh = 0.5 * Math.sqrt(Math.max(0, 1 - (d / r) ** 2)), L = 1.0 + R() * 1.4, b = R() * TAU, e = (R() - 0.5) * 0.5; F.p(R() < 0.6 ? 'woodDark' : 'wood', pole([lx - Math.cos(b) * L / 2, hh - Math.sin(e) * L / 2, lz - Math.sin(b) * L / 2], [lx + Math.cos(b) * L / 2, hh + Math.sin(e) * L / 2, lz + Math.sin(b) * L / 2], 0.02 + R() * 0.02, 4), 0, F.g(lx, lz) - 0.05, 0); }
    F.col(-r, r, -r * 0.7, r * 0.7);
  }
  // potter's wheel(s) under a lean-to; the potter sits with his back to the wall facing the yard
  function wheelShed(x, z, ry, n = 1, colors = RAW) {
    const w = 2.8 * n + 1.2, d = 3.2, F = leanTo(x, z, w, d, ry, { reed: R() < 0.4 });
    for (let i = 0; i < n; i++) {
      const lx = -w / 2 + 1.9 + i * 2.8;
      F.pg('socles', cyl(0.2, 0.24, 0.16, 8), lx, 0.02, 0.2);
      F.pg('woodDark', cyl(0.05, 0.05, 0.3, 6), lx, 0.2, 0.2);
      F.pg('wood', cyl(0.38, 0.38, 0.07, 14), lx, 0.36, 0.2);
      F.pg('tc', pot(pick(['krater', 'jug', 'bowl'])), lx, 0.395, 0.2, { c: jit(0x8f7a64), s: 0.9 });
      F.pg('wood', box(0.36, 0.32, 0.32), lx, 0.16, -0.62);
      F.pg('pt', ellipsoid(0.16, 0.1, 0.13, 7, 5), lx + 0.62, 0.05, 0.05, { c: jit(0x7b6450) });
      F.pg('tc', pot('bowl'), lx - 0.55, 0, 0.45, { c: jit(0xa0694a), s: 0.9 });
      F.col(lx - 0.42, lx + 0.42, -0.2, 0.6);
      F.work(lx, -0.62, lx, 0.2, 'throwing pots at the wheel');
    }
    // bench along the back with finished work
    F.pg('wood', box(w - 0.6, 0.06, 0.42), 0, 0.6, -1.25);
    for (const sx of [-1, 1]) F.pg('socles', box(0.3, 0.6, 0.4), sx * (w / 2 - 0.6), 0.28, -1.25);
    shelfPots(F, -w / 2 + 0.4, w / 2 - 0.4, F.g(0, -1.25) + 0.63, -1.25, colors);
    F.col(-w / 2 + 0.2, w / 2 - 0.2, -1.5, -1.0);
    return F;
  }

  function well(x, z, ry = 0) {
    const F = frame(x, z, ry);
    F.p('socles', lathe([[0.78, -0.6], [0.8, 0.62], [0.72, 0.72], [0.52, 0.72], [0.5, 0.2]], 14), 0, 0, 0);
    F.p('pt', new THREE.CircleGeometry(0.5, 14), 0, 0.05, 0, { rx: -Math.PI / 2, c: 0x141414 });
    for (const sx of [-1, 1]) { F.pg('woodDark', box(0.14, 2.4, 0.14), sx * 0.95, 1.1, 0); }
    F.p('woodDark', cyl(0.06, 0.06, 2.2, 6), 0, 2.2, 0, { rz: Math.PI / 2 });
    F.p('wood', cyl(0.16, 0.16, 0.08, 10), 0, 2.2, 0, { rx: Math.PI / 2 });
    F.p('pt', cyl(0.012, 0.012, 1.3, 4, true), 0.16, 1.55, 0, { c: 0x8a7a5a });
    F.p('tc', pot('jug'), 0.16, 0.5, 0, { c: jit(pick(FIRED)), s: 0.9 });
    F.p('tc', pot('jug'), -0.55, F.g(-0.55, 0.95), 0.95, { c: jit(pick(FIRED)), ry: 1 });
    F.p('socles', box(1.4, 0.5, 0.55), 1.55, F.g(1.55, 0.9) + 0.1, 0.9); F.p('pt', box(1.2, 0.02, 0.35), 1.55, F.g(1.55, 0.9) + 0.33, 0.9, { c: 0x3c4a4e });
    F.col(-1.05, 1.05, -0.85, 0.85); F.col(0.85, 2.25, 0.62, 1.18);
    const [px, pz] = F.w(0, 0); layout.addPoi({ type: 'well', x: px, z: pz, y: gy(px, pz), r: 1.6, owner: OWN, note: 'yard well' });
  }

  // ---------- smithy ----------
  function forge(F, lx, lz) {
    const y = F.g(lx, lz);
    F.p('socles', box(1.7, 1.3, 1.15), lx, y + 0.2, lz);
    for (const [ox, oz, w, d] of [[0, -0.52, 1.7, 0.12], [0, 0.52, 1.7, 0.12], [-0.8, 0, 0.12, 1.15], [0.8, 0, 0.12, 1.15]]) F.p('tc', box(w, 0.16, d), lx + ox, y + 0.93, lz + oz, { c: 0x5a4a3e });
    F.vc('gl', ellipsoid(0.55, 0.14, 0.34, 10, 4), hot(0.3, 0.14, 0.5), lx + 0.05, y + 0.95, lz);
    for (let i = 0; i < 14; i++) F.p('pt', box(0.07, 0.05, 0.06), lx + (R() - 0.5) * 1.3, y + 0.98 + R() * 0.05, lz + (R() - 0.5) * 0.8, { ry: R() * 3, c: 0x1c1a19 });
    F.p('pt', box(0.9, 0.03, 0.03), lx + 0.3, y + 1.0, lz + 0.2, { ry: 0.3, rz: -0.08, c: 0x3a3432 });
    // bellows: two tall leather bags between boards, clay pipes from each bag joining in a tuyère through the side of the hearth
    const bx = lx - 1.62, tuy = 0x7d5a42;
    for (const sz of [-0.28, 0.28]) {
      F.p('pt', ellipsoid(0.36, 0.25, 0.24, 10, 7), bx, y + 0.27, lz + sz, { c: jit(0x4a3526, 0.1) });
      F.p('pt', ellipsoid(0.1, 0.07, 0.07, 6, 4), bx + 0.36, y + 0.26, lz + sz, { c: 0x3f2d20 });
      F.p('woodDark', box(0.66, 0.04, 0.44), bx, y + 0.52, lz + sz, { rz: 0.07 });
      F.p('woodDark', box(0.66, 0.04, 0.44), bx, y + 0.03, lz + sz);
      F.p('woodDark', pole([-0.2, 0.55, 0], [-0.45, 1.05, 0], 0.022, 5, false), bx, y, lz + sz);
      F.p('tc', pole([bx + 0.4, y + 0.26, lz + sz], [lx - 1.02, y + 0.42, lz + sz * 0.15], 0.055, 7), 0, 0, 0, { c: tuy });
    }
    F.p('tc', pole([lx - 1.08, y + 0.42, lz], [lx - 0.8, y + 0.5, lz], 0.08, 8), 0, 0, 0, { c: tuy });
    F.p('tc', ellipsoid(0.11, 0.1, 0.13, 8, 5), lx - 1.05, y + 0.42, lz, { c: tuy });
    F.col(lx - 2.05, lx + 0.9, lz - 0.6, lz + 0.6);
  }
  function anvil(F, lx, lz, ry = 0) {
    const y = F.g(lx, lz);
    F.p('woodDark', cyl(0.27, 0.32, 0.62, 10), lx, y + 0.28, lz);
    F.p('pt', box(0.32, 0.17, 0.2), lx, y + 0.67, lz, { ry, c: 0x2e2c2b });
    F.p('pt', new THREE.ConeGeometry(0.07, 0.2, 6), lx + Math.cos(ry) * 0.24, y + 0.7, lz - Math.sin(ry) * 0.24, { ry, rz: -Math.PI / 2, c: 0x2e2c2b });
    F.p('woodDark', cyl(0.018, 0.018, 0.34, 5, true), lx + 0.1, y + 0.78, lz + 0.05, { rz: Math.PI / 2, ry: 0.4 });
    F.p('pt', box(0.1, 0.06, 0.06), lx + 0.24, y + 0.78, lz - 0.02, { ry: 0.4, c: 0x2a2827 });
    F.col(lx - 0.35, lx + 0.35, lz - 0.35, lz + 0.35);
  }
  function trough(F, lx, lz, ry = 0, w = 1.2, d = 0.55, water = 0x3c4a4e) {
    const y = F.g(lx, lz), T = frame(...F.w(lx, lz), F.ry + ry, F.y + y - 0.02);
    for (const sz of [-1, 1]) T.p('socles', box(w, 0.75, 0.1), 0, 0.2, sz * (d / 2 - 0.05));
    for (const sx of [-1, 1]) T.p('socles', box(0.1, 0.75, d), sx * (w / 2 - 0.05), 0.2, 0);
    liquid(T, new THREE.PlaneGeometry(w - 0.2, d - 0.2, 4, 2), 0, 0.47, 0, water, { hw: (w - 0.2) / 2, hd: (d - 0.2) / 2 });
    T.col(-w / 2, w / 2, -d / 2, d / 2);
  }
  // still liquid (a flat shape in its XY plane, laid level): darker toward the middle, paler scum at the edge
  function liquid(F, g, lx, ly, lz, color, o = {}) {
    const base = new THREE.Color(color);
    F.vc('pt', g, (px, py, pz, c) => { const e = o.r ? Math.hypot(px, py) / o.r : Math.max(Math.abs(px) / o.hw, Math.abs(py) / o.hd); c.copy(base).multiplyScalar(lerp(0.3, 0.62, smoothstep(0.45, 1.0, e))); }, lx, ly, lz, { rx: -Math.PI / 2 });
  }
  // a wet hank of wool over a vat's rim (radius r), dipping into the dye; the radial direction is local +X
  const drape = r => { const P = [[r + 0.21, 0.5, 0.17], [r + 0.2, 0.66, 0.15], [r + 0.18, 0.82, 0.14], [r + 0.14, 0.915, 0.13], [r + 0.03, 0.935, 0.13], [r - 0.1, 0.87, 0.13], [r - 0.2, 0.79, 0.14], [r - 0.3, 0.74, 0.15]], pos = [], idx = [], K = 4;
    P.forEach(([x, y, hw], i) => { for (let k = 0; k < K; k++) { const u = k / (K - 1) * 2 - 1; pos.push(x + (i < 3 ? 0.02 * (1 - u * u) : 0), y - 0.035 * u * u + (i && i < P.length - 1 ? hs(i, k, r, 7) * 0.03 : 0), u * hw); } if (i) for (let k = 0; k < K - 1; k++) { const a = (i - 1) * K + k, b = i * K + k; idx.push(a, a + 1, b, a + 1, b + 1, b); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; };
  function cartWheel(F, lx, lz, ry, lean = 0.25) {
    const m = F.m(lx, F.g(lx, lz) + 0.58, lz, 0, ry, 0).multiply(mat(0, 0, 0, lean, 0, 0));
    put('wood', new THREE.TorusGeometry(0.55, 0.05, 5, 16), m); put('woodDark', cyl(0.1, 0.1, 0.28, 8), m.clone().multiply(mat(0, 0, 0, Math.PI / 2, 0, 0)));
    for (let k = 0; k < 8; k++) put('wood', box(0.04, 0.5, 0.04), m.clone().multiply(mat(0, 0, 0, 0, 0, k * Math.PI / 4)).multiply(mat(0, 0.3, 0)));
  }

  // ---------- dye works ----------
  function vat(F, lx, lz, color, r = 0.62) {
    const y = F.g(lx, lz);
    F.p('socles', box(2 * r + 0.5, 1.3, 2 * r + 0.5), lx, y - 0.03, lz);
    F.p('tc', lathe([[r + 0.02, 0.6], [r + 0.12, 0.8], [r + 0.13, 0.86], [r - 0.02, 0.87], [r - 0.06, 0.7], [r - 0.12, 0.4]], 14), lx, y, lz, { c: jit(pick(FIRED)) });
    liquid(F, new THREE.CircleGeometry(r - 0.07, 14), lx, y + 0.76, lz, color, { r: r - 0.07 });
    for (let i = 0; i < 2; i++) F.p('cl', drape(r), lx, y, lz, { ry: 0.5 + i * 1.1 + R() * 0.4, c: jit(color, 0.12).multiplyScalar(0.8) });
    F.col(lx - r - 0.25, lx + r + 0.25, lz - r - 0.25, lz + r + 0.25);
  }
  // a line on posts every 5–6 m, sagging between them, cloth hung over it
  // a sheet of wet cloth heaped in folds, its edges sunk under the water (y 0 = the water line)
  const wetCloth = (w, seed) => { const g = new THREE.PlaneGeometry(w, w * 0.75, 6, 5).rotateX(-Math.PI / 2), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), e = Math.max(Math.abs(x) / (w / 2), Math.abs(z) / (w * 0.375)); p.setY(i, (1 - e * e) * 0.09 + Math.sin(x * 9 + seed) * Math.cos(z * 7 - seed) * 0.035 - 0.03); }
    g.computeVertexNormals(); return g; };
  function clothLine(F, x0, x1, lz, n, colors) {
    const L = x1 - x0, nS = Math.max(1, Math.round(L / 5.5)), top = (F.g(x0, lz) + F.g(x1, lz)) / 2 + 2.3, sag = 0.16;
    const lineY = x => { const t = (x - x0) / L * nS, f = t - Math.floor(Math.min(t, nS - 1e-6)); return top - sag * 4 * f * (1 - f); };
    for (let i = 0; i <= nS; i++) { const px = x0 + i * L / nS, g = F.g(px, lz); F.p('woodDark', cyl(0.05, 0.06, top + 0.1 - g + 0.3, 6), px, (top + 0.1 + g - 0.3) / 2, lz); F.col(px - 0.12, px + 0.12, lz - 0.12, lz + 0.12); }
    for (let i = 0; i < nS; i++) { const a = x0 + i * L / nS; for (let k = 0; k < 4; k++) { const u0 = a + k * L / nS / 4, u1 = u0 + L / nS / 4; F.p('pt', pole([u0, lineY(u0 + 1e-3) - 0.01, lz], [u1, lineY(u1 - 1e-3) - 0.01, lz], 0.012, 4), 0, 0, 0, { c: 0x8a7a5e }); } }
    let px = x0 + 0.4;
    for (let i = 0; i < n && px < x1 - 0.8; i++) {
      const w = 0.9 + R() * 0.9, h = 1.0 + R() * 0.6, g = new THREE.PlaneGeometry(w, h, 6, 3), p = g.attributes.position, ly = (lineY(px) + lineY(px + w)) / 2, tilt = Math.atan2(lineY(px + w) - lineY(px), w);
      for (let k = 0; k < p.count; k++) p.setZ(k, Math.sin(p.getX(k) * 4 + i) * 0.06 + (p.getY(k) < 0 ? 0.04 * Math.sin(p.getX(k) * 7) : 0));
      g.computeVertexNormals();
      { const m = F.m(px + w / 2, ly - h / 2 - 0.02, lz + (R() - 0.5) * 0.05, 0, (R() - 0.5) * 0.15, tilt * 0.6), c = jit(pick(colors), 0.12).lerp(new THREE.Color(0x9a7a58), 0.2), ph = R() * 6;
        for (const f of twoFaced(g)) { colorFn(f, (x, y, z, o) => o.copy(c).multiplyScalar(0.82 + 0.18 * Math.sin(x * 11 + ph) + (y > h / 2 - 0.05 ? -0.08 : 0))); f.applyMatrix4(m); own.pt.list.push(f); } }
      px += w + 0.12 + R() * 0.3;
    }
    F.col(x0, x1, lz - 0.18, lz + 0.18);
  }

  // ---------- weaving ----------
  const loomWeight = new THREE.ConeGeometry(0.035, 0.1, 4);
  function loom(F, lx, lz, color) {
    const H = 2.25, W = 1.7, lean = 0.22, back = y => -y * Math.tan(lean), y0 = F.g(lx, lz);
    for (const sx of [-1, 1]) F.p('wood', pole([sx * W / 2, -0.1, 0], [sx * W / 2, H, back(H)], 0.05, 6, false), lx, y0, lz);
    F.p('woodDark', cyl(0.06, 0.06, W + 0.35, 8), lx, y0 + H - 0.12, lz + back(H - 0.12), { rz: Math.PI / 2 });
    const yw = 1.15 + R() * 0.45, clothH = H - 0.2 - yw, warpH = yw - 0.42;
    // the web: weft bands every few centimetres, bowed back between the uprights, a woven border near the growing edge
    { const rows = Math.max(4, Math.round(clothH / 0.055)), bow = g => { const p = g.attributes.position; for (let k = 0; k < p.count; k++) p.setZ(k, -0.035 * Math.cos(p.getX(k) / (W - 0.25) * Math.PI)); g.computeVertexNormals(); return g; };
      const base = new THREE.Color().copy(color.isColor ? color : new THREE.Color(color)), seedC = R() * 99;
      const band = new THREE.Color(pick(DYES.slice(0, 6))), bRow = 2 + Math.floor(R() * 2);
      for (const g of twoFaced(bow(new THREE.PlaneGeometry(W - 0.25, clothH, 4, rows * 2)))) F.vc('pt', g, (px, py, pz, c) => { const row = Math.floor((py + clothH / 2) / clothH * rows * 2 + 0.5); c.copy(base).multiplyScalar(1 + hs(row >> 1, 0, 0, 5, seedC) * 0.16 + (row % 2 ? 0.06 : -0.06)); if ((row >> 1) === bRow || (row >> 1) === bRow + 1) c.lerp(band, 0.85); }, lx, y0 + yw + clothH / 2, lz + back(yw + clothH / 2) + 0.04, { rx: -lean });
    }
    const thread = new THREE.PlaneGeometry(0.012, warpH), wc = jit(0xc4b48f, 0.06);
    for (let i = 0; i < 26; i++) F.p('cl', thread, lx - (W - 0.3) / 2 + i * (W - 0.3) / 25, y0 + 0.42 + warpH / 2, lz + back(0.42 + warpH / 2) + 0.04 + (i % 2) * 0.012, { rx: -lean, c: wc });
    F.p('woodDark', cyl(0.025, 0.025, W + 0.1, 6, true), lx, y0 + 1.05, lz + back(1.05) + 0.2, { rz: Math.PI / 2 });
    for (const sx of [-1, 1]) F.p('woodDark', pole([sx * W / 2, 1.05, back(1.05)], [sx * W / 2, 1.05, back(1.05) + 0.22], 0.02, 5), lx, y0, lz);
    F.p('woodDark', cyl(0.02, 0.02, W, 5, true), lx, y0 + 0.66, lz + back(0.66) + 0.04, { rz: Math.PI / 2 });
    const nW = 22;
    for (let i = 0; i < nW; i++) { const px = -W / 2 + 0.2 + i * (W - 0.4) / (nW - 1), py = 0.36 + (i % 2) * 0.05; F.p('tc', loomWeight, lx + px, y0 + py, lz + back(py) + (i % 2 ? -0.03 : 0.06), { c: jit(0x9a7458, 0.1) }); }
    F.col(lx - W / 2 - 0.1, lx + W / 2 + 0.1, lz + back(H) - 0.1, lz + 0.25);
    F.work(lx, lz + 0.85, lx, lz, 'weaving at the loom');
  }
  function basket(F, lx, lz, fill, r = 0.26, h = 0.34) {
    const y = F.g(lx, lz);
    F.p('pt', lathe([[0.001, 0], [r * 0.8, 0], [r, h], [r * 0.92, h], [r * 0.72, 0.04]], 9), lx, y - 0.01, lz, { c: jit(0x9c8352) });
    if (fill != null) F.p('pt', ellipsoid(r * 0.9, 0.08, r * 0.9, 8, 4), lx, y + h - 0.06, lz, { c: jit(fill, 0.1) });
  }

  // ---------- masons ----------
  const drumGeo = (r, h) => { const b = new Bucket(); b.add(cyl(r, r, h, 16)); for (const s of [-1, 1]) b.add(box(0.16, 0.2, 0.14), mat(s * (r + 0.05), 0, 0)); return b.build(); };
  const oct = new THREE.OctahedronGeometry(1, 0), _sv = new THREE.Vector3();
  const dust = [], tracks = [];              // world [x, z, radius] of marble dust around work, [ax, az, bx, bz, halfWidth] of worn cart tracks — painted into the yard floor
  function chips(F, lx, lz, rad, n) {
    { const [wx, wz] = F.w(lx, lz); dust.push([wx, wz, rad * 1.6]); }
    n = Math.round(n * 0.45);
    for (let i = 0; i < n; i++) {
      const a = R() * TAU, d = rad * Math.pow(R(), 0.7), [wx, wz] = F.w(lx + Math.cos(a) * d, lz + Math.sin(a) * d), s = 0.025 + R() * R() * 0.07;
      put('marble', oct, mat(wx, gy(wx, wz) + s * 0.1, wz, (R() - 0.5) * 0.6, R() * 3, (R() - 0.5) * 0.6, _sv.set(s, s * 0.45, s * (0.6 + R() * 0.6))));
    }
  }
  // shear-legs: two poles meeting over the load (reach metres toward local +Z), back-stay and side guys, a windlass behind
  function shearLegs(x, z, ry, H, reach, hookY, load) {
    const F = frame(x, z, ry), top = [0, H, reach], hy = hookY - F.y, rope = 0x8a7a5a;
    const f1 = [-2.1, F.g(-2.1, 0) - 0.3, 0], f2 = [2.1, F.g(2.1, 0) - 0.3, 0];
    for (const f of [f1, f2]) { F.p('woodDark', pole(f, top, 0.13, 8, false), 0, 0, 0); F.p('socles', box(0.5, 0.3, 0.5), f[0], f[1] + 0.3, f[2]); }
    F.p('woodDark', box(0.34, 0.34, 0.34), 0, H - 0.1, reach);
    const stake = [0, F.g(0, -7.5) + 0.3, -7.5];
    F.p('pt', pole(top, stake, 0.025, 4), 0, 0, 0, { c: rope }); F.p('woodDark', box(0.12, 0.8, 0.12), 0, stake[1] - 0.1, -7.5);
    for (const sx of [-1, 1]) { const st = [sx * 5, F.g(sx * 5, -3) + 0.2, -3]; F.p('pt', pole(top, st, 0.02, 4), 0, 0, 0, { c: rope }); F.p('woodDark', box(0.1, 0.6, 0.1), st[0], st[1] - 0.1, st[2]); }
    F.p('pt', pole([0, H - 0.25, reach], [0, hy + 0.12, reach], 0.028, 4), 0, 0, 0, { c: rope });
    F.p('woodDark', box(0.2, 0.25, 0.16), 0, hy, reach);
    const wz = -2.2, wy = F.g(0, wz);
    for (const sx of [-1, 1]) { F.p('woodDark', box(0.14, 1.0, 0.14), sx * 0.85, wy + 0.4, wz - 0.2, { rx: 0.25 }); F.p('woodDark', box(0.14, 1.0, 0.14), sx * 0.85, wy + 0.4, wz + 0.2, { rx: -0.25 }); }
    F.p('wood', cyl(0.17, 0.17, 1.9, 10), 0, wy + 0.85, wz, { rz: Math.PI / 2 });
    F.p('pt', cyl(0.19, 0.19, 0.7, 10, true), 0.2, wy + 0.85, wz, { rz: Math.PI / 2, c: rope });
    for (const a of [0.3, 1.87]) F.p('woodDark', box(0.06, 1.6, 0.06), -0.8, wy + 0.85, wz, { rx: a });
    F.p('pt', pole([0.2, wy + 1.02, wz], [0, H - 0.25, reach], 0.025, 4), 0, 0, 0, { c: rope });
    F.col(-2.4, -1.8, -0.3, 0.3); F.col(1.8, 2.4, -0.3, 0.3); F.col(-1.1, 1.1, wz - 0.45, wz + 0.45);
    F.work(1.6, wz, 0, wz, 'turning the windlass'); F.work(-1.6, wz, 0, wz, 'turning the windlass');
    if (load) load(F, 0, hy, reach);
    return F;
  }
  function scaffold(F, lx, lz, s, H) {
    const y0 = F.g(lx, lz), h = s / 2;
    const corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (const [cx, cz] of corners) F.p('woodDark', cyl(0.07, 0.08, H + 0.5, 6, true), lx + cx, y0 + H / 2 - 0.25, lz + cz);
    for (const ly of [2.2, 4.4, H - 0.2]) for (let k = 0; k < 4; k++) {
      const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
      F.p('woodDark', pole([lx + ax * 1.08, y0 + ly, lz + az * 1.08], [lx + bx * 1.08, y0 + ly, lz + bz * 1.08], 0.05, 5), 0, 0, 0);
    }
    for (const [k, ly] of [[0, 0], [2, 2.2]]) { const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4]; F.p('woodDark', pole([lx + ax, y0 + ly + 0.1, lz + az], [lx + bx, y0 + ly + 2.1, lz + bz], 0.04, 5), 0, 0, 0); }
    for (const ly of [2.28, 4.48]) for (const side of [-1, 1]) for (let p = 0; p < 2; p++) F.p('wood', box(s + 0.3, 0.05, 0.28), lx, y0 + ly, lz + side * (h - 0.2 - p * 0.3));
    // ladder
    const lz0 = lz + h + 0.1, lzt = lz + h - 0.15;
    for (const sx of [-0.25, 0.25]) F.p('wood', pole([lx - h + 0.6 + sx, y0 - 0.05, lz0 + 0.9], [lx - h + 0.6 + sx, y0 + 4.6, lzt], 0.035, 5), 0, 0, 0);
    for (let k = 1; k < 15; k++) { const t = k / 15; F.p('wood', box(0.55, 0.04, 0.04), lx - h + 0.6, y0 - 0.05 + t * 4.65, lerp(lz0 + 0.9, lzt, t)); }
    for (const [cx, cz] of corners) F.col(lx + cx - 0.15, lx + cx + 0.15, lz + cz - 0.15, lz + cz + 0.15);
  }
  function wagon(F, lx, lz, ry) {
    const W = frame(...F.w(lx, lz), F.ry + ry, F.y + F.g(lx, lz));
    for (const sx of [-1.15, 1.15]) for (const sz of [-0.85, 0.85]) { W.p('wood', cyl(0.46, 0.46, 0.12, 14), sx, 0.46, sz, { rx: Math.PI / 2 }); W.p('woodDark', cyl(0.09, 0.09, 0.3, 8), sx, 0.46, sz, { rx: Math.PI / 2 }); }
    for (const sx of [-1.15, 1.15]) W.p('woodDark', cyl(0.06, 0.06, 1.9, 6), sx, 0.46, 0, { rx: Math.PI / 2 });
    W.p('wood', box(3.1, 0.14, 1.35), 0, 0.82, 0); for (const sz of [-1, 1]) W.p('woodDark', box(3.1, 0.2, 0.08), 0, 0.99, sz * 0.66);
    W.p('woodDark', pole([1.5, 0.75, 0], [4.2, 0.55, 0], 0.06, 6, false), 0, 0, 0); W.p('woodDark', box(0.1, 0.1, 1.8), 4.1, 0.58, 0);
    W.p('tc', rough(1.9, 1.0, 1.1, 91), 0, 1.4, 0, { c: jit(STONE, 0.06) });
    W.col(-1.7, 1.7, -1.0, 1.0);
  }
  // the laid floor of a masons' yard (outside the bare-earth town, where grass would show): trodden earth in the town's own dirt texture,
  // pale with marble dust around the work, darker along the cart tracks; 6 cm proud in the middle, sinking under the ground in a ragged band along the walls
  const NZ = makeNoise2D(913);
  const floorOff = r => { const x0 = r.minX + 0.62, x1 = r.maxX - 0.62, z0 = r.minZ + 0.62, z1 = r.maxZ - 0.62;
    return (x, z) => { const dE = Math.min(x - x0, x1 - x, z - z0, z1 - z); return dE < -0.3 ? 0 : lerp(-0.16, 0.06, smoothstep(0, 0.9 + 1.5 * (NZ.noise(x * 0.23, z * 0.23) * 0.5 + 0.5), dE)); }; };
  function yardBegin(r) { dust.length = 0; tracks.length = 0; const f = floorOff(r); FLO = (x, z) => Math.max(0, f(x, z)); return f; }
  function yardFloor(r, f, step = 1.25) {
    FLO = null;
    const x0 = r.minX + 0.62, x1 = r.maxX - 0.62, z0 = r.minZ + 0.62, z1 = r.maxZ - 0.62, g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, Math.ceil((x1 - x0) / step), Math.ceil((z1 - z0) / step)).rotateX(-Math.PI / 2);
    const p = g.attributes.position, uv = g.attributes.uv, col = new Float32Array(p.count * 3), c = new THREE.Color();
    const EARTH = lin(0.98, 0.9, 0.8), DUST = lin(1.18, 1.6, 2.6);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + (x0 + x1) / 2, z = p.getZ(i) + (z0 + z1) / 2, dE = Math.min(x - x0, x1 - x, z - z0, z1 - z);
      p.setXYZ(i, x, terrainHeight(x, z) + f(x, z), z); uv.setXY(i, x, z);
      let d = 0, tr = 0;
      for (const [dx, dz, rr] of dust) { const e = Math.hypot(x - dx, z - dz); if (e < rr) d = Math.max(d, 1 - smoothstep(rr * 0.3, rr, e)); }
      for (const [ax, az, bx, bz, hw] of tracks) { const vx = bx - ax, vz = bz - az, t = clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1); tr = Math.max(tr, 1 - smoothstep(hw * 0.35, hw, Math.hypot(x - ax - vx * t, z - az - vz * t))); }
      const n1 = NZ.fbm(x * 0.07 + 11, z * 0.07, 3), n2 = NZ.noise(x * 0.3, z * 0.3 + 5);
      c.copy(EARTH).multiplyScalar(0.95 + n1 * 0.3 + n2 * 0.14).lerp(DUST, clamp(0.12 + n1 * 0.12 + d * 0.62, 0, 0.8)).multiplyScalar((1 - tr * 0.3) * (0.84 + 0.16 * smoothstep(0, 2.2, dE)));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); put('fl', g, null);
  }
  // unfinished sculpture, in the block's own stone: a finished shape swollen along its normals by a hashed amount (the stone the point chisel has still to take off)
  // o.sx/o.sz widen it; o.hide: boxes [x0, x1, y0, y1, z0, z1] (geometry units) still inside the stone, whose triangles are dropped
  function roughOut(g, amp, seed, o = {}) {
    const g2 = norm(g), p = g2.attributes.position, n = g2.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color(), sx = o.sx ?? 1, sz = o.sz ?? 1;
    const key = i => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`, avg = new Map(), keys = [];
    for (let i = 0; i < p.count; i++) { const k = key(i); keys.push(k); const a = avg.get(k) || [0, 0, 0]; a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); avg.set(k, a); }
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = keys[i].split(',').map(Number), a = avg.get(keys[i]), l = Math.hypot(...a) || 1, k = amp * (0.75 + 1.1 * hs(x, y, z, 1, seed));
      p.setXYZ(i, (p.getX(i) + a[0] / l * k) * sx, p.getY(i) + a[1] / l * k, (p.getZ(i) + a[2] / l * k) * sz);
      c.copy(MARB).multiplyScalar(1 + hs(x, y, z, 4, seed) * 0.12); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    if (o.hide) {
      const idx = g2.index.array, keep = [], inBox = (i, b) => { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); return x > b[0] && x < b[1] && y > b[2] && y < b[3] && z > b[4] && z < b[5]; };
      for (let t = 0; t < idx.length; t += 3) if (!o.hide.some(b => inBox(idx[t], b) && inBox(idx[t + 1], b) && inBox(idx[t + 2], b))) keep.push(idx[t], idx[t + 1], idx[t + 2]);
      g2.setIndex(keep);
    }
    g2.setAttribute('color', new THREE.BufferAttribute(col, 3)); g2.computeVertexNormals(); return g2;
  }
  const stoneC = (g, seed, base = MARB) => colorFn(norm(g), (x, y, z, c) => c.copy(base).multiplyScalar(1 + hs(x, y, z, 4, seed) * 0.12));
  // a wooden mallet and three chisels lying on a surface at local height ly
  function tools(F, lx, ly, lz, ry = 0) {
    const T = frame(...F.w(lx, lz), F.ry + ry, F.y + ly);
    T.p('woodDark', cyl(0.07, 0.075, 0.22, 8), -0.1, 0.07, -0.02, { rz: Math.PI / 2 }); T.p('wood', cyl(0.016, 0.018, 0.3, 5), -0.1, 0.02, 0.2, { rx: Math.PI / 2 });
    for (let i = 0; i < 3; i++) T.p('pt', box(0.02, 0.02, 0.2 + i * 0.03), 0.1 + i * 0.06, 0.01, 0.05 + (R() - 0.5) * 0.06, { ry: (R() - 0.5) * 0.3, c: 0x34302d });
  }
  function toolStand(F, lx, lz, ry = 0) {
    const T = frame(...F.w(lx, lz), F.ry + ry, F.y + F.g(lx, lz));
    T.p('wood', box(0.62, 0.05, 0.4), 0, 0.46, 0); for (const sx of [-0.25, 0.25]) T.p('woodDark', box(0.06, 0.46, 0.34), sx, 0.22, 0);
    tools(T, 0, 0.485, -0.05); T.col(-0.34, 0.34, -0.23, 0.23);
  }
  // the fore part of a horse as the sculptor has blocked it out (faces +X, 1.6 m to the withers before scaling): deep chest, a neck of oval section, a long tapering head hung low
  const horseProtome = () => {
    const b = new Bucket(), A = new THREE.Vector3(0.7, 1.34, 0), P = new THREE.Vector3(1.26, 1.97, 0), d = P.clone().sub(A), L = d.length(), ang = -Math.atan2(d.x, d.y);
    b.add(ellipsoid(0.36, 0.44, 0.3, 10, 8), mat(0.6, 1.18, 0));
    b.add(new THREE.CylinderGeometry(0.17, 0.26, L, 8, 3).scale(1.45, 1, 0.72), mat(...A.clone().add(P).multiplyScalar(0.5).toArray(), 0, 0, ang));
    const hd = new THREE.Vector3(Math.sin(0.62), -Math.cos(0.62), 0), head = new THREE.CylinderGeometry(0.075, 0.135, 0.64, 7, 3).scale(1, 1, 0.72);
    b.add(head, mat(...P.clone().add(hd.clone().multiplyScalar(0.3)).toArray(), 0, 0, 0.62));
    b.add(ellipsoid(0.24, 0.2, 0.15, 9, 6), mat(...P.clone().add(new THREE.Vector3(-0.03, 0.02, 0)).toArray(), 0, 0, 0.6));
    return b.build();
  };
  // a colossal horse for the quadriga roughed out of its block: chest, neck and head free, a strut of stone left under the muzzle; a working platform alongside
  function horseInBlock(F, lx, lz, ry, s = 1.6) {
    const H = frame(...F.w(lx, lz), F.ry + ry, F.y + F.g(lx, lz)), sp = (g, x, y, z, sd) => H.p('tc', stoneC(g, sd), x, y, z);
    sp(rough(5.9, 0.3, 1.6, 61), 0.5, 0.12, 0, 61);
    sp(rough(3.12, 2.64, 1.34, 62), -0.6, 1.58, 0, 62);
    sp(rough(1.75, 1.36, 1.28, 63), 1.82, 0.94, 0, 63);
    sp(rough(1.15, 0.85, 1.22, 64), 2.12, 2.04, 0, 64);             // not yet cut away from under the head
    H.p('tc', roughOut(horseProtome(), 0.03 / s, 5, { sz: 1.1 }), 0, 0.26, 0, { s });
    for (const tx of [-0.4, 2.8]) for (const sz of [0.95, 1.95]) H.p('woodDark', box(0.12, 1.75, 0.12), tx, 0.85, sz);
    for (let k = 0; k < 3; k++) H.p('wood', box(3.8, 0.06, 0.32), 1.2, 1.72, 1.1 + k * 0.38);
    for (const tx of [-0.4, 2.8]) H.p('woodDark', box(0.12, 0.12, 1.2), tx, 1.63, 1.45);
    ladder(H, [3.6, H.g(3.6, 2.75) - 0.05, 2.75], [3.2, 1.75, 2.0], 0.45);
    tools(H, 2.2, 1.75, 1.25, 0.4);
    H.col(-2.3, 3.0, -0.85, 0.85); H.col(-0.55, 3.0, 0.85, 2.05);
    H.work(1.4, 2.55, 1.5, 0.3, 'carving a colossal horse'); H.work(-1.3, -1.35, -1.4, 0, 'roughing out the block');
    chips(H, 0.6, 0.0, 3.4, 150);
    return H;
  }
  function roughBlock(F, lx, lz, w, h, d, ry = 0, skids = true, seed = R() * 99) {
    const y = F.g(lx, lz);
    if (skids) for (const s of [-1, 1]) F.p('woodDark', box(0.12, 0.12, d + 0.3), lx + Math.cos(ry) * s * w * 0.3, y + 0.04, lz - Math.sin(ry) * s * w * 0.3, { ry });
    F.p('tc', rough(w, h, d, seed), lx, y + h / 2 + (skids ? 0.08 : -0.02), lz, { ry, c: jit(STONE, 0.06) });
    const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry)), hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    F.col(lx - hw - 0.05, lx + hw + 0.05, lz - hd - 0.05, lz + hd + 0.05);
  }
  // is a local rect (in a yard frame, ry 0) clear of everything this feature has placed so far?
  const free = (F, x0, x1, z0, z1, m = 0.25) => { const r = { minX: F.x + x0 - m, maxX: F.x + x1 + m, minZ: F.z + z0 - m, maxZ: F.z + z1 + m }; for (let i = c0; i < world.colliders.length; i++) { const q = world.colliders[i]; if (r.minX < q.maxX && r.maxX > q.minX && r.minZ < q.maxZ && r.maxZ > q.minZ) return false; } return true; };
  // a moulding block on two trestles, its egg-and-dart half cut, the rest still a plain band (local X along the block)
  function mouldingTrestle(F, lx, lz, ry = 0, L = 1.9) {
    const T = frame(...F.w(lx, lz), F.ry + ry, F.y + F.g(lx, lz)), y = 0.84, H = 0.48, D = 0.55, cut = L * (0.45 + R() * 0.25);
    for (const sx of [-0.65, 0.65]) { for (const sz of [-1, 1]) T.p('wood', box(0.07, 0.9, 0.07), sx, 0.4, sz * 0.24, { rx: -sz * 0.24 }); T.p('wood', box(0.1, 0.09, 0.56), sx, y - 0.045, 0); }
    T.p('marble', box(L, H, D), 0, y + H / 2, 0);
    T.p('egg', scaleUV(box(cut, 0.17, 0.07), 1, 1 / 0.17), -L / 2 + cut / 2, y + H - 0.12, D / 2 + 0.035);
    T.p('marble', box(L - cut, 0.19, 0.085), cut / 2, y + H - 0.12, D / 2 + 0.042);
    tools(T, 0.3, y + H, -0.08, 0.4);
    T.col(-L / 2 - 0.1, L / 2 + 0.1, -0.42, 0.42); T.work(-L / 2 + cut, 1.05, -L / 2 + cut, 0, 'carving egg-and-dart');
    chips(T, 0, 0.7, 1.1, 40);
  }
  // a cornice block: fascia, cyma and corona in profile (XY), 1.7 m long toward +Z
  const corniceGeo = (() => { const s = new THREE.Shape(); [[0, 0], [0.48, 0], [0.48, 0.12], [0.54, 0.14], [0.54, 0.2], [0.64, 0.25], [0.7, 0.35], [0.7, 0.41], [0.78, 0.43], [0.78, 0.55], [0, 0.55]].forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); return new THREE.ExtrudeGeometry(s, { depth: 1.7, bevelEnabled: false }); })();
  function corniceRow(F, lx, lz, n) {                       // along local X, on timber skids
    for (let i = 0; i < n; i++) { const x = lx + i * 2.05, g = F.g(x, lz); for (const sz of [-0.3, 0.3]) F.p('woodDark', box(1.9, 0.12, 0.14), x, g + 0.04, lz + sz); F.p('marble', corniceGeo, x - 0.85, g + 0.1, lz + 0.39, { ry: Math.PI / 2 + (R() - 0.5) * 0.04 }); }
    F.col(lx - 1.05, lx + (n - 1) * 2.05 + 1.05, lz - 0.5, lz + 0.5);
    const [wx, wz] = F.w(lx + (n - 1) * 1.02, lz); dust.push([wx, wz, n * 1.2]);
  }
  // coffer slabs for the ceiling of the peristyle, stacked: a raised frame round a sunk panel
  function cofferStack(F, lx, lz, n, ry = 0) {
    const T = frame(...F.w(lx, lz), F.ry + ry, F.y + F.g(lx, lz));
    for (const sz of [-0.4, 0.4]) T.p('woodDark', box(1.5, 0.12, 0.14), 0, 0.04, sz);
    for (let k = 0; k < n; k++) { const y = 0.1 + k * 0.3, ox = (R() - 0.5) * 0.08;
      for (const [x, z, w, d] of [[0, -0.52, 1.3, 0.26], [0, 0.52, 1.3, 0.26], [-0.52, 0, 0.26, 0.78], [0.52, 0, 0.26, 0.78]]) T.p('marble', box(w, 0.28, d), x + ox, y + 0.14, z);
      T.p('marble', box(0.8, 0.13, 0.8), ox, y + 0.065, 0); T.p('marble', box(0.46, 0.06, 0.46), ox, y + 0.16, 0); }
    T.col(-0.75, 0.75, -0.75, 0.75);
  }
  // a heap of spoil: broken stone and chips
  function spoil(F, lx, lz, r) {
    const y = F.g(lx, lz);
    F.p('tc', stoneC(ellipsoid(r, r * 0.36, r * 0.8, 10, 6), 90, STONE), lx, y - 0.1, lz);
    for (let i = 0; i < 7; i++) { const a = R() * TAU, d = R() * r * 0.75; F.p('tc', stoneC(rough(0.32 + R() * 0.3, 0.22 + R() * 0.15, 0.28 + R() * 0.25, 50 + i), 50 + i, STONE), lx + Math.cos(a) * d, y + (1 - d / r) * r * 0.28, lz + Math.sin(a) * d * 0.8, { ry: R() * 3 }); }
    F.col(lx - r * 0.85, lx + r * 0.85, lz - r * 0.7, lz + r * 0.7);
    chips(F, lx, lz, r * 1.3, 45);
  }
  // squared blocks stacked two high in a row along local X
  function blockRow(F, lx, lz, n, layers = 2) {
    for (let i = 0; i < n; i++) { const x = lx + i * 2.45, y = F.g(x, lz); for (const sz of [-0.35, 0.35]) F.p('woodDark', box(0.14, 0.12, 1.3), x + sz * 2, y + 0.04, lz);
      for (let k = 0; k < layers - (i % 3 === 2 ? 1 : 0); k++) F.p('tc', box(2.2, 0.62, 1.1), x + (R() - 0.5) * 0.06, y + 0.41 + k * 0.63, lz, { ry: (R() - 0.5) * 0.04, c: jit(DRESSED, 0.05) }); }
    F.col(lx - 1.2, lx + (n - 1) * 2.45 + 1.2, lz - 0.65, lz + 0.65);
  }
  // a block being dressed: one end still rough, the other squared and smooth
  function dressingBlock(F, lx, lz, ry = 0) {
    const T = frame(...F.w(lx, lz), F.ry + ry, F.y + F.g(lx, lz));
    for (const sx of [-0.7, 0.7]) T.p('woodDark', box(0.14, 0.12, 1.3), sx, 0.04, 0);
    T.p('tc', stoneC(rough(1.05, 1.02, 1.12, 97), 97, STONE), -0.55, 0.6, 0); T.p('marble', box(1.25, 0.9, 1.0), 0.5, 0.55, 0);
    tools(T, 0.5, 1.0, 0.0, 1.2);
    T.col(-1.15, 1.2, -0.65, 0.65); T.work(0.2, 1.25, 0.1, 0, 'dressing a block'); chips(T, 0, 0.9, 1.5, 50);
  }
  // timber, levers and rope under a lean-to against a yard wall
  function timberStore(x, z, ry) {
    const T = leanTo(x, z, 10, 3.2, ry, { hb: 3.0, hf: 2.45 });
    for (let i = 0; i < 11; i++) { const layer = i < 5 ? 0 : i < 9 ? 1 : 2, k = i < 5 ? i : i < 9 ? i - 5 : i - 9; T.pg(i % 3 ? 'wood' : 'woodDark', cyl(0.11, 0.11, 7 + R() * 1.5, 6), -0.6 + (R() - 0.5) * 0.3, 0.11 + layer * 0.2, -1.05 + k * 0.23 + layer * 0.11, { rz: Math.PI / 2 }); }
    for (let i = 0; i < 3; i++) T.pg('woodDark', box(3.2, 0.16, 0.2), 3.2, 0.08 + i * 0.16, 0.35 + i * 0.02);
    for (let i = 0; i < 4; i++) T.p('woodDark', pole([-4.2 + i * 0.35, T.g(-4.2 + i * 0.35, 0.3) - 0.05, 0.4], [-4.0 + i * 0.3, 2.2, -1.35], 0.05, 6, false), 0, 0, 0);
    for (let i = 0; i < 3; i++) T.pg('pt', new THREE.TorusGeometry(0.32, 0.05, 5, 12), -2.3 + (i === 2 ? 0.2 : 0), 0.05 + (i === 2 ? 0.1 : 0), 0.7 + i * 0.05 - (i === 2 ? 0.1 : 0), { rx: Math.PI / 2, c: jit(0x8a7a5a, 0.1) });
    T.p('pt', new THREE.TorusGeometry(0.26, 0.045, 5, 12), 0, 1.5, -1.5, { rx: Math.PI / 2 + 0.15, c: jit(0x8a7a5a, 0.1) });
    T.col(-4.7, 4.9, -1.5, 1.05); T.work(-1.5, 1.95, -2.3, 0.75, 'coiling rope');
    return T;
  }
  // a pit of slaked lime for plaster and the joints of the foundations
  function limePit(F, lx, lz) {
    const y = F.g(lx, lz);
    for (const [x, z, w, d] of [[0, -0.8, 2.4, 0.22], [0, 0.8, 2.4, 0.22], [-1.1, 0, 0.22, 1.4], [1.1, 0, 0.22, 1.4]]) F.p('socles', box(w, 0.6, d), lx + x, y + 0.05, lz + z);
    liquid(F, new THREE.PlaneGeometry(1.98, 1.38, 4, 2), lx, y + 0.24, lz, 0xcfc8b8, { hw: 0.99, hd: 0.69 });
    F.p('pt', ellipsoid(0.7, 0.3, 0.55, 9, 5), lx + 2.1, y - 0.05, lz - 0.2, { c: 0xd6d0c2 });
    F.p('woodDark', pole([lx - 0.3, y + 0.24, lz + 0.1], [lx + 0.9, y + 1.7, lz + 1.2], 0.025, 5, false), 0, 0, 0); F.p('pt', box(0.25, 0.02, 0.18), lx - 0.33, y + 0.25, lz + 0.08, { ry: 0.7, c: 0x3a3431 });
    basket(F, lx + 1.6, lz + 1.0, 0xd6d0c2, 0.28, 0.36);
    F.col(lx - 1.25, lx + 2.85, lz - 0.95, lz + 1.3); F.work(lx - 0.4, lz + 1.8, lx, lz, 'slaking lime');
  }
  // a second lion, only blocked out: body, forequarters and head as stepped masses
  function lionBlock(F, lx, lz, ry = 0) {
    const T = frame(...F.w(lx, lz), F.ry + ry, F.y + F.g(lx, lz)), sp = (g, x, y, z, sd) => T.p('tc', stoneC(g, sd), x, y, z);
    sp(rough(3.4, 0.3, 1.25, 71), 0, 0.12, 0, 71); sp(rough(2.3, 1.2, 1.1, 72), -0.45, 0.85, 0, 72);
    sp(rough(1.0, 0.75, 1.05, 73), 1.15, 1.02, 0, 73); sp(rough(0.62, 0.55, 0.62, 74), 1.62, 1.28, 0, 74); sp(rough(0.9, 0.5, 0.9, 75), 1.2, 0.5, 0, 75);
    toolStand(T, 0.2, -1.2, 0.1);
    T.col(-1.8, 1.8, -0.7, 0.7); T.work(1.0, 1.3, 1.0, 0.2, 'blocking out a lion'); chips(T, 0.3, 0.3, 2.2, 70);
  }

  // ================= region A: the potters' and craftsmen's quarter =================
  const ok = (r) => !layout.housesIn(r, 0.2).length && !foreign({ minX: r.minX + 0.2, maxX: r.maxX - 0.2, minZ: r.minZ + 0.2, maxZ: r.maxZ - 0.2 }) && !layout.reserved.some(q => q.owner !== OWN && q.minX < r.maxX && q.maxX > r.minX && q.minZ < r.maxZ && q.maxZ > r.minZ);
  const Y = (r, u, v) => [r.minX + u, r.minZ + v];
  const yard = r => frame(r.minX, r.minZ, 0, 0);          // local = metres from the north-west corner, absolute heights

  // --- amphora works (block k=-9, m=5): three kilns, tanks, a drying shed, amphora store; gate on the street to the north ---
  if (ok(S.amphora)) {
    const r = S.amphora, F = yard(r);
    yardWalls(r, { n: [20], s: [], w: [], e: [] });
    shed(...Y(r, 9.2, 4.4), 16, 6.4, 4.2, 0, { door: 3 });
    wheelShed(...Y(r, 29, 2.5), 0, 2);
    clayHeap(...Y(r, 36.2, 3.6), 1.3);
    tanks(...Y(r, 2.2, 15), Math.PI / 2, 3);
    clayHeap(...Y(r, 6.5, 21.5), 1.4);
    // drying shed along the east wall, racks of leather-hard pots under it
    leanTo(...Y(r, 37.6, 16), 16, 3.4, -Math.PI / 2, { reed: true, hb: 3.0, hf: 2.5 });
    for (const v of [10, 14, 18, 22]) rack(...Y(r, 37.6, v), Math.PI / 2, 3.4, RAW, false);
    rack(...Y(r, 25.5, 11), 0, 3.4, FIRED); rack(...Y(r, 30, 11), 0, 3.4, FIRED);
    jarRows(...Y(r, 28.5, 17.5), 0, 6, 3, 'amph', RAW, 0.42); jarRows(...Y(r, 15, 17.5), 0, 4, 3, 'amph', RAW, 0.42);
    kiln(...Y(r, 12, 36), Math.PI, { r: 2.3, firing: true });
    kiln(...Y(r, 28, 36), Math.PI, { r: 2.0, firing: false, door: -1.2 });
    kiln(...Y(r, 20.5, 41), Math.PI, { r: 1.5, firing: true });
    fuel(...Y(r, 20.5, 32.5), 0.2, 15); fuel(...Y(r, 4.5, 37), Math.PI / 2 - 0.1, 12);
    brushPile(...Y(r, 4.2, 30), 1.8); brushPile(...Y(r, 35.2, 30.5), 1.6);
    // store for finished amphorae along the south wall
    const St = openShed(...Y(r, 29, 51.6), 16, 4.6, Math.PI, { hb: 3.4, hf: 2.7 });
    amphoraStack(...St.w(-4.4, -0.4), Math.PI, 7); amphoraStack(...St.w(0, -0.4), Math.PI, 5, [0xc27b50, 0xa95f3c]); amphoraStack(...St.w(4.2, -0.4), Math.PI, 6, [0xc98a5e, 0xb5744c]);
    amphoraStack(...Y(r, 7, 52.4), 0, 6); amphoraStack(...Y(r, 15.5, 52.4), 0, 5); amphoraStack(...Y(r, 34, 45), Math.PI / 2, 5, RAW);
    jarRows(...Y(r, 12, 46.8), 0, 7, 3, 'amph', FIRED, 0.4, true);
    // new amphorae drying in the sun, and a handcart being loaded for the harbour
    jarRows(...Y(r, 31.5, 30.8), 0, 8, 2, 'amph', RAW, 0.42); jarRows(...Y(r, 8.0, 30.2), 0, 5, 2, 'amph', RAW, 0.42);
    // a second line of drying racks across the middle of the yard, between the well and the kilns
    for (const u of [15.8, 25.2]) if (free(F, u - 1.9, u + 1.9, 29.1, 29.9, 0.2)) rack(...Y(r, u, 29.5), 0, 3.4, RAW, true, [0.42, 1.2]);
    { const C = frame(...Y(r, 27, 45.2), 0.15), cy = C.g(0, 0);
      for (const sz of [-0.8, 0.8]) { C.p('wood', cyl(0.5, 0.5, 0.1, 14), 0, cy + 0.5, sz, { rx: Math.PI / 2 }); C.p('woodDark', cyl(0.08, 0.08, 0.24, 8), 0, cy + 0.5, sz, { rx: Math.PI / 2 }); }
      C.p('woodDark', cyl(0.05, 0.05, 1.8, 6), 0, cy + 0.5, 0, { rx: Math.PI / 2 }); C.p('wood', box(2.2, 0.1, 1.3), 0.2, cy + 0.72, 0); for (const sz of [-0.62, 0.62]) C.p('woodDark', box(2.2, 0.25, 0.06), 0.2, cy + 0.88, sz);
      for (const sz of [-0.3, 0.3]) C.p('woodDark', pole([1.2, cy + 0.72, sz], [2.9, cy + 0.35, sz * 1.4], 0.04, 5), 0, 0, 0);
      C.p('woodDark', box(0.1, 0.62, 0.1), -0.85, cy + 0.36, 0);
      for (let i = 0; i < 5; i++) amphora(C, -0.6 + i * 0.36, cy + 0.95, 0.05, { rx: Math.PI / 2 * (i % 2 ? 1 : -1), ry: Math.PI / 2, c: jit(pick(FIRED)), s: 0.95 });
      C.col(-1.0, 1.4, -0.95, 0.95); C.work(2.0, 1.3, 1.0, 0.3, 'loading the cart'); }
    sherdHeap(...Y(r, 2.9, 44), 1.7);
    jarRows(...Y(r, 9.2, 10.2), 0, 2, 1, 'pithos', FIRED, 1.1);
    F.work(4.2, 15, 2.2, 15, 'working the clay tanks'); F.work(35.4, 12.8, 37.6, 12.8, 'setting pots to dry'); F.work(25.5, 12.1, 25.5, 11, 'setting pots to dry'); F.work(8.6, 21.5, 6.5, 21.5, 'treading clay');
    well(...Y(r, 20.5, 25.5), 0.3);
    gather(...Y(r, 16, 27), 3, 'potters\' yard'); area(r, 'amphora works yard');
  }

  // --- tile and brick works (north part of block k=-8, m=5) ---
  if (ok(S.tiles)) {
    const r = S.tiles, F = yard(r);
    yardWalls(r, { n: [14], s: [], w: [], e: [] });
    kiln(...Y(r, 32, 16), -Math.PI / 2, { r: 2.5, firing: true });
    const T = leanTo(...Y(r, 5.2, 2.6), 8.4, 3.2, 0, { reed: true });
    T.pg('wood', box(3.2, 0.08, 0.9), -1.8, 0.82, 0.3); for (const sx of [-3.2, -0.4]) for (const sz of [-0.1, 0.7]) T.pg('wood', box(0.08, 0.82, 0.08), sx, 0.4, sz);
    T.pg('woodDark', box(0.7, 0.05, 0.56), -2.2, 0.9, 0.3); T.pg('pt', box(0.6, 0.08, 0.45), -1.2, 0.9, 0.3, { c: 0x86684c });
    T.col(-3.5, -0.1, -0.2, 0.8); T.work(-1.8, 1.25, -1.8, 0.3, 'moulding roof tiles'); tileRows(...T.w(2.2, 0.2), 0, 2, 10, 1);
    shed(...Y(r, 3.95, 12.5), 6.2, 6.0, 3.6, Math.PI / 2, { door: 0.8 });
    brickField(...Y(r, 12.5, 18.5), 0, 12, 9); F.col(9.2, 19.0, 15.9, 21.1);
    const Td = leanTo(...Y(r, 24, 25.1), 12, 3.0, Math.PI, { reed: true, hb: 2.6, hf: 2.1 });
    for (const lx of [-4, 0.2, 4.2]) tileRows(...Td.w(lx, 0.1), 0, 2, 14, 0);
    tileRows(...Y(r, 37.2, 6.5), Math.PI / 2, 2, 20, 1); tileRows(...Y(r, 23.5, 15.5), 0, 3, 16, 2);
    tanks(...Y(r, 22, 2.2), 0, 2); clayHeap(...Y(r, 27.5, 3.4), 1.2);
    fuel(...Y(r, 25.5, 11), 1.2, 16); brushPile(...Y(r, 36.8, 24.2), 1.5); sherdHeap(...Y(r, 16, 25), 1.1);
    F.work(19.6, 18.5, 17, 18.5, 'turning drying bricks'); F.work(22, 4.2, 22, 2.2, 'working the clay tanks');
    gather(...Y(r, 16, 7), 2.5, 'tile works'); area(r, 'tile works yard');
  }

  // --- dye works and fullery (south part of block k=-8, m=5); gate on the street to the east ---
  if (ok(S.dye)) {
    const r = S.dye, F = yard(r);
    yardWalls(r, { n: false, s: [], w: [], e: [12] });
    const D = openShed(...Y(r, 3.4, 11), 15, 5.4, Math.PI / 2, { hb: 3.6, hf: 2.7 });
    for (let i = 0; i < 5; i++) amphora(D, -5.5 + i * 0.5, D.g(-5.5 + i * 0.5, -1.6) - 0.05, -1.6, { handles: true, ry: R() * 3 });
    for (let i = 0; i < 4; i++) basket(D, 1 + i * 0.7, -1.5, WOOL, 0.3, 0.4);
    for (let i = 0; i < 3; i++) D.pg('cl', box(0.9, 0.35, 0.7), 4.3, 0.17 + i * 0.36, -1.4, { ry: (R() - 0.5) * 0.3, c: jit(pick(DYES)) });
    D.col(-6, 5, -2.1, -0.8); D.work(0, -0.2, 0, -1.5, 'sorting wool');
    [DYES[0], DYES[1], DYES[2], DYES[3], DYES[0]].forEach((c, i) => { vat(F, 11 + i * 3.4, 5.5, c); F.work(11 + i * 3.4, 6.95, 11 + i * 3.4, 5.5, 'dyeing wool'); });
    { const lx = 14.4, lz = 5.5, y = F.g(lx, lz); F.p('woodDark', pole([lx - 0.18, y + 0.45, lz + 0.12], [lx + 0.45, y + 2.25, lz - 0.62], 0.028, 6, false), 0, 0, 0); }
    // heated vat: a bronze cauldron over a fire
    { const lx = 30.8, lz = 5.5, y = F.g(lx, lz);
      for (const [ox, oz, rr] of [[-0.62, 0, 0], [0.62, 0, 0], [0, -0.62, Math.PI / 2]]) F.p('socles', box(0.3, 0.65, 1.4), lx + ox, y + 0.2, lz + oz, { ry: rr });
      F.p('gl', ellipsoid(0.36, 0.1, 0.36, 8, 4), lx, y + 0.05, lz + 0.05);
      F.p('pt', lathe([[0.001, 0.45], [0.35, 0.5], [0.58, 0.75], [0.62, 1.05], [0.58, 1.08], [0.5, 0.98], [0.3, 0.62], [0.001, 0.57]], 12), lx, y, lz, { c: 0x6b4c2e });
      liquid(F, new THREE.CircleGeometry(0.46, 12), lx, y + 0.9, lz, DYES[1], { r: 0.46 });
      F.col(lx - 0.85, lx + 0.85, lz - 0.85, lz + 0.85); F.work(lx, lz + 1.5, lx, lz, 'tending the dye kettle');
      plume(r.minX + lx, y + 1.2, r.minZ + lz, { col: 0xe2ded8, H: 9, alpha: 0.42, n: 10, size: 0.9 }); fuel(...Y(r, 33.6, 3.0), 0.1, 8, 1.1); }
    // fullers' treading basins
    for (let i = 0; i < 3; i++) { const lx = 11.5 + i * 2.6, lz = 12.2; trough(F, lx, lz, 0, 2.0, 1.5, 0x5e5a4e); for (const [ox, oz, w, c] of [[0.25, -0.1, 0.95, WOOLC], [-0.4, 0.2, 0.7, lin(0.95, 0.8, 0.6)]]) F.p('cl', wetCloth(w, i * 3 + (ox > 0 ? 1 : 2)), lx + ox, F.g(lx, lz) + 0.47, lz + oz, { ry: R() * 3, c: jit(c, 0.08) }); F.work(lx, lz + 1.3, lx, lz, 'fulling cloth'); }
    jarRows(...Y(r, 20.3, 12.2), 0, 2, 3, 'amph', FIRED, 0.4, true);
    for (const v of [15.8, 18.6, 21.4]) clothLine(F, 9.5, 31.5, v, 12, DYES);
    // murex shells from the purple dye
    { const lx = 35.5, lz = 22.5, y = F.g(lx, lz), sh = new THREE.ConeGeometry(0.06, 0.15, 5);
      F.p('pt', ellipsoid(1.5, 0.65, 1.2, 10, 6), lx, y - 0.12, lz, { c: 0x7c6a58 });
      for (let i = 0; i < 100; i++) { const a = R() * TAU, d = Math.sqrt(R()) * 1.45, px = lx + Math.cos(a) * d, pz = lz + Math.sin(a) * d * 0.8, hh = 0.52 * Math.sqrt(Math.max(0, 1 - (d / 1.5) ** 2)); F.p('pt', sh, px, F.g(px, pz) - 0.05 + hh, pz, { rx: R() * 3, ry: R() * 3, c: jit(pick([0xa89a86, 0x86725f, 0x9a8672]), 0.15) }); }
      F.col(lx - 1.5, lx + 1.5, lz - 1.2, lz + 1.2); F.work(lx - 2.0, lz, lx, lz, 'cracking murex shells'); }
    // store along the south wall: baskets of washed wool, bundles of dyed skeins, jars of mordant
    const Ds = openShed(...Y(r, 20, 24.9), 18, 3.8, Math.PI, { hb: 3.2, hf: 2.6 });
    for (let i = 0; i < 6; i++) basket(Ds, -7.5 + i * 0.75, -0.9, pick([WOOL, 0xc4b28c, DYES[0], DYES[2]]), 0.3, 0.4);
    for (let i = 0; i < 8; i++) Ds.pg('cl', box(0.8, 0.3, 0.6), -1.5 + (i % 4) * 0.9, 0.15 + Math.floor(i / 4) * 0.31, -0.8, { ry: (R() - 0.5) * 0.3, c: jit(pick(DYES)) });
    for (let i = 0; i < 6; i++) amphora(Ds, 3.5 + i * 0.42, Ds.g(3.5 + i * 0.42, -1.0) - 0.05, -1.0, { handles: true, ry: R() * 3 });
    Ds.col(-8, 6.2, -1.4, -0.4); Ds.work(-2, 0.4, -2, -0.8, 'sorting dyed wool');
    well(...Y(r, 36.2, 6.0), Math.PI / 2);
    gather(...Y(r, 24, 9.4), 2.5, 'dye works'); area(r, 'dye works yard');
  }

  // --- fine-ware pottery (block k=-10, m=5, south of the houses); gate on the street to the west ---
  if (ok(S.fine)) {
    const r = S.fine, F = yard(r);
    yardWalls(r, { n: [], s: [], w: [14], e: [] });
    shed(...Y(r, 27.5, 4.2), 10, 6.2, 4.0, 0, { door: -2 });
    shed(...Y(r, 7.5, 32.2), 12, 5.6, 3.8, Math.PI, { door: 2.5 });
    wheelShed(...Y(r, 11.5, 2.4), 0, 2, [...BLACK, ...FIRED]);
    rack(...Y(r, 15, 12.5), 0, 3.2, BLACK); rack(...Y(r, 20.5, 12.5), 0, 3.2, [...RAW, ...BLACK]);
    leanTo(...Y(r, 37.6, 25), 10, 3.4, -Math.PI / 2, { reed: true, hb: 3.0, hf: 2.5 });
    for (const v of [22.6, 27.4]) rack(...Y(r, 37.6, v), Math.PI / 2, 3.6, [...BLACK, ...RAW], false);
    kiln(...Y(r, 29.5, 25.5), -Math.PI / 2, { r: 1.9, firing: true });
    kiln(...Y(r, 21, 30.8), Math.PI, { r: 1.5, firing: false, door: -0.9, raw: [...BLACK, ...FIRED] });
    tanks(...Y(r, 37.4, 12.8), Math.PI / 2, 2); clayHeap(...Y(r, 35.6, 18.3), 1.0);
    fuel(...Y(r, 24.5, 21.2), 0.3, 14); sherdHeap(...Y(r, 34.6, 34), 1.3); brushPile(...Y(r, 27.5, 33.4), 1.3);
    jarRows(...Y(r, 3.2, 26), 0, 3, 3, 'jug', BLACK, 0.34); jarRows(...Y(r, 8.5, 25.5), 0, 4, 2, 'krater', [...BLACK, ...FIRED], 0.46);
    // a trestle table of finished black-glaze ware by the gate; the potter's wife sells from behind it
    { const T = frame(...Y(r, 3.0, 19.5), Math.PI / 2);
      T.pg('wood', box(2.4, 0.07, 0.8), 0, 0.85, 0); for (const sx of [-1, 1]) for (const sz of [-1, 1]) T.pg('wood', box(0.07, 0.85, 0.07), sx * 1.05, 0.42, sz * 0.3);
      shelfPots(T, -1.1, 1.1, T.g(0, 0) + 0.89, 0, BLACK); T.col(-1.25, 1.25, -0.45, 0.45);
      const [vx, vz] = T.w(0, -1.0); layout.addPoi({ type: 'stall', x: vx, z: vz, y: gy(vx, vz), ry: Math.PI / 2, r: 1.5, owner: OWN, note: 'black-glaze pottery for sale' }); }
    F.work(15, 13.6, 15, 12.5, 'setting pots to dry'); F.work(35.9, 12.8, 37.4, 12.8, 'working the clay tanks'); F.work(35.2, 23.8, 37.6, 23.8, 'setting pots to dry');
    gather(...Y(r, 22, 19.5), 2.5, 'fine-ware pottery'); area(r, 'pottery yard');
  }

  // --- a small family pottery (lot k=-12, m=5) ---
  if (ok(S.family)) {
    const r = S.family;
    yardWalls(r, { n: [6], s: [], w: [], e: [] });
    kiln(...Y(r, 14.5, 7.2), -Math.PI / 2, { r: 1.7, firing: true });
    wheelShed(...Y(r, 12.5, 16.5), Math.PI, 1, FIRED);
    rack(...Y(r, 1.6, 10.5), Math.PI / 2, 3.0);
    tanks(...Y(r, 4.6, 16.2), 0, 1); clayHeap(...Y(r, 2.5, 6.4), 0.9);
    jarRows(...Y(r, 17.5, 16.6), 0, 2, 3, 'amph', FIRED, 0.4, true);
    fuel(...Y(r, 18.3, 12.2), Math.PI / 2, 10); brushPile(...Y(r, 7.6, 16.2), 1.0);
    gather(...Y(r, 8, 10), 2, 'family pottery'); area(r, 'pottery yard', 1.0);
  }

  // --- weaving yard (south strip of block k=-12, m=4): warp-weighted looms under a long lean-to ---
  if (ok(S.weave)) {
    const r = S.weave, F = yard(r);
    yardWalls(r, { n: [], s: [20], w: [], e: [] });
    shed(...Y(r, 4.2, 3.9), 6.4, 5.6, 3.8, 0, { door: 1.2 });
    const lt = leanTo(...Y(r, 22, 2.55), 22, 3.4, 0, { hb: 3.6, hf: 3.0 });
    const cols = [0xa88a5c, 0x7a3326, 0x96794e, 0x324668, 0x8f7550];
    for (let i = 0; i < 5; i++) loom(lt, -8.6 + i * 4.3, -0.55, cols[i]);
    for (let i = 0; i < 4; i++) lt.pg('wood', box(0.34, 0.42, 0.34), -6.45 + i * 4.3, 0.2, 0.7);
    for (const [u, v, f] of [[35.5, 3.5, 0xd2c19c], [36.3, 4.3, 0xc4b28c], [34.7, 4.4, DYES[3]], [35.6, 6.8, 0xd2c19c], [36.8, 7.4, DYES[0]]]) basket(F, u, v, f);
    F.col(34.1, 37.4, 2.9, 7.9);
    trough(F, 37.2, 11, Math.PI / 2, 1.6, 0.8, 0x6f7a78);
    clothLine(F, 3.0, 16.5, 12.2, 7, [WOOL, 0xbfae8a, DYES[2], DYES[1]]);
    for (const u of [28.5, 30.2]) { F.pg('wood', box(0.4, 0.4, 0.4), u, 0.2, 13.5); basket(F, u + 0.6, 13.9, 0xd2c19c, 0.22, 0.3); }
    F.pg('wood', box(2.6, 0.08, 0.5), 32.5, 0.46, 9.6); for (const sx of [-1, 1]) F.pg('socles', box(0.3, 0.46, 0.45), 32.5 + sx * 1.1, 0.2, 9.6);
    F.col(31.1, 33.9, 9.3, 9.9);
    F.work(28.5, 13.5, 28.5, 12.3, 'spinning wool'); F.work(30.2, 13.5, 30.2, 12.3, 'spinning wool'); F.work(35.9, 11, 37.2, 11, 'washing wool');
    gather(...Y(r, 22, 9), 2.5, 'weavers'); area(r, 'weaving yard', 1.0);
  }

  // --- olive press (lot k=-11, m=5): beam press with hanging weights under a gabled roof ---
  if (ok(S.press)) {
    const r = S.press, F = yard(r), P = frame(...Y(r, 10.5, 5.2), 0);
    yardWalls(r, { n: [], s: [], w: [9], e: [] });
    for (const lx of [-4.6, 0, 5.6]) for (const lz of [-2.4, 2.4]) { P.pg('wood', box(0.2, 3.0, 0.2), lx, 1.4, lz); P.col(lx - 0.18, lx + 0.18, lz - 0.18, lz + 0.18); }
    for (const lz of [-2.4, 2.4]) P.p('wood', box(10.6, 0.2, 0.22), 0.5, P.g(0.5, lz) + 2.85, lz);
    P.p('roofs', kit.gableRoof(10.8, 5.4), 0.5, Math.max(P.g(-4.6, 0), P.g(5.6, 0)) + 2.95, 0, { c: pick(ROOFC) });
    // posts holding the butt of the beam
    const yb = P.g(4.6, 0), bx = 3.2, ybed = P.g(bx, 0);
    P.p('ashlar', box(1.1, 0.5, 1.1), 4.6, yb + 0.1, 0); for (const sz of [-0.22, 0.22]) P.p('woodDark', box(0.2, 2.4, 0.18), 4.6, yb + 1.3, sz);
    P.p('woodDark', box(0.18, 0.18, 0.7), 4.6, ybed + 1.66, 0); P.p('woodDark', box(0.18, 0.18, 0.7), 4.6, ybed + 1.0, 0);
    P.col(4.0, 5.2, -0.6, 0.6);
    // press bed, stacked frails, beam and weights
    P.p('socles', cyl(0.85, 0.9, 0.5, 14), bx, ybed + 0.2, 0); P.p('socles', box(0.2, 0.12, 0.7), bx, ybed + 0.3, 1.0);
    for (let i = 0; i < 7; i++) P.p('pt', cyl(0.5, 0.48, 0.1, 12), bx + (R() - 0.5) * 0.05, ybed + 0.5 + i * 0.105, (R() - 0.5) * 0.05, { c: jit(0x6a5232, 0.12) });
    P.p('woodDark', cyl(0.46, 0.46, 0.08, 12), bx, ybed + 1.22, 0);
    P.p('tc', pot('pithos'), bx, ybed - 0.85, 1.55, { c: jit(pick(FIRED)) });
    const pivY = ybed + 1.31, bedTop = ybed + 1.41, slope = (pivY - bedTop) / (4.6 - bx), yAt = lx => bedTop + slope * (lx - bx);
    const x0 = -3.4, L = 4.9 - x0, xe = x0 + 0.3;
    P.p('woodDark', box(L, 0.3, 0.3), (4.9 + x0) / 2, yAt((4.9 + x0) / 2), 0, { rz: Math.atan(slope) });
    P.p('woodDark', box(0.12, 0.12, 1.2), xe, yAt(xe) - 0.21, 0);
    for (const sz of [-0.42, 0.42]) { const hy = yAt(xe) - 0.27, gw = P.g(xe, sz); P.p('pt', cyl(0.02, 0.02, hy - (gw + 0.95), 4, true), xe, (hy + gw + 0.95) / 2, sz, { c: 0x8a7a5a }); P.p('socles', rough(0.5, 0.5, 0.38, 7 + sz), xe, gw + 0.7, sz); }
    P.col(x0 - 0.1, bx + 0.9, -1.0, 1.0);
    P.work(bx - 1.0, 1.4, bx, 0, 'working the olive press'); P.work(xe, 1.7, xe, 0.5, 'hanging the press weights');
    // stone crushing basin with a hand roller
    { const lx = 4.0, lz = 14.0, y = F.g(lx, lz);
      F.p('grey', lathe([[0.95, -0.3], [0.95, 0.55], [0.8, 0.6], [0.72, 0.3], [0.001, 0.25]], 14), lx, y, lz); F.p('pt', ellipsoid(0.7, 0.08, 0.7, 10, 4), lx, y + 0.3, lz, { c: 0x2f2a22 });
      F.p('grey', cyl(0.22, 0.22, 0.8, 10), lx + 0.1, y + 0.55, lz, { rx: Math.PI / 2, ry: 0.3 }); F.col(lx - 1, lx + 1, lz - 1, lz + 1); F.work(lx + 1.6, lz, lx, lz, 'crushing olives'); }
    for (const [u, v] of [[1.6, 12.2], [2.4, 12.0], [6.2, 12.4], [1.5, 16.6]]) basket(F, u, v, 0x2c2822, 0.3, 0.38);
    jarRows(...Y(r, 11.5, 16.4), 0, 5, 1, 'pithos', FIRED, 1.1);
    trough(F, 14.5, 11.5, 0, 1.6, 1.1, 0x6b6a3a); F.work(14.5, 12.6, 14.5, 11.5, 'skimming the oil');
    gather(...Y(r, 8.5, 11.0), 2, 'olive press'); area(r, 'olive press yard', 1.0);
  }

  // --- smithy (lot k=-8, m=4 south): forge under an open shed facing the yard; gate on the street to the south ---
  if (ok(S.smithy)) {
    const r = S.smithy, F = yard(r);
    yardWalls(r, { n: [], s: [10], w: [], e: [] });
    const Fs = openShed(...Y(r, 8.4, 3.6), 13, 5.6, 0, { hb: 3.8, hf: 2.9, plaster: 0xcdbb9a });
    forge(Fs, -2.6, -1.35); anvil(Fs, -2.0, 0.9, 0.3); trough(Fs, 1.0, -1.6, 0, 1.3, 0.55);
    Fs.work(-2.0, 1.8, -2.0, 0.9, 'hammering at the anvil'); Fs.work(-4.6, -0.4, -4.1, -1.35, 'working the bellows'); Fs.work(-1.2, -0.2, -2.6, -1.35, 'tending the forge');
    // smoke hole in the roof above the hearth, covered by a raised tile
    Fs.p('roofs', box(1.0, 0.1, 1.0), -2.6, 3.55 + 0.32, -1.3, { rx: Math.atan2(0.9, 6.1), c: 0x9e5e3f });
    for (const sx of [-0.42, 0.42]) Fs.p('roofs', box(0.1, 0.3, 0.8), -2.6 + sx, 3.55 + 0.17, -1.3, { c: 0x9e5e3f });
    // tools hanging from a rail on the back wall: tongs, hammers, a file, a poker, a fuller; soot on the wall above the hearth
    Fs.p('woodDark', box(3.2, 0.1, 0.08), 3.6, 2.25, -2.28);
    { const iron = 0x2e2c2b, wz = -2.26, tl = (g, lx, ly, o = {}) => Fs.p('pt', g, lx, ly, wz, { c: iron, ...o });
      for (const [tx0, len] of [[2.35, 0.62], [4.55, 0.5]]) { for (const s of [-1, 1]) tl(box(0.028, len, 0.02), tx0 + s * 0.05, 2.2 - len / 2, { rz: s * 0.09 }); tl(box(0.05, 0.06, 0.03), tx0, 2.2, {}); }
      for (const [hx, hl] of [[2.85, 0.42], [3.3, 0.36]]) { Fs.p('woodDark', box(0.035, hl, 0.03), hx, 2.18 - hl / 2, wz); tl(box(0.15, 0.06, 0.06), hx, 2.18 - hl + 0.02); }
      tl(box(0.035, 0.34, 0.008), 3.75, 1.99, { rz: 0.03 }); Fs.p('woodDark', box(0.03, 0.1, 0.03), 3.75, 2.2, wz);
      tl(box(0.02, 0.8, 0.02), 4.1, 1.8); tl(box(0.07, 0.02, 0.02), 4.13, 2.2);
      tl(box(0.06, 0.26, 0.05), 5.0, 2.0); Fs.p('woodDark', box(0.03, 0.14, 0.03), 5.0, 2.22, wz);
      Fs.vc('walls', scaleUV(new THREE.PlaneGeometry(2.6, 2.7, 6, 6), 2.6, 2.7), (px, py, pz, c) => c.lerpColors(new THREE.Color(0xcdbb9a), new THREE.Color(0x3a322b), clamp((1 - Math.abs(px) / (0.75 + (py + 1.35) * 0.22)) * (0.95 - (py + 1.35) * 0.18) * smoothstep(-1.36, -0.85, py), 0, 0.9)), -2.6, 2.45, -2.3); }
    for (let i = 0; i < 12; i++) Fs.p('pt', box(1.3, 0.045, 0.045), 4.2 + (R() - 0.5) * 0.1, Fs.g(4.2, -1.2) + 0.04 + Math.floor(i / 4) * 0.05, -1.35 + (i % 4) * 0.08, { ry: (R() - 0.5) * 0.1, c: 0x3a3431 });
    Fs.col(3.4, 5.0, -1.6, -0.9);
    { const [px, pz] = Fs.w(-2.6, -1.3); plume(px, Fs.y + 4.0, pz, { col: 0xb8b0a6, H: 11, alpha: 0.5, n: 10, size: 0.8 }); }
    { const lx = 16.3, lz = 3.4, y = F.g(lx, lz); F.p('pt', ellipsoid(1.3, 0.55, 1.0, 10, 6), lx, y - 0.1, lz, { c: 0x1f1d1c }); for (let i = 0; i < 20; i++) F.pg('pt', box(0.12, 0.08, 0.1), lx + (R() - 0.5) * 2.4, 0.02, lz + 1.1 + R() * 0.4, { ry: R() * 3, c: 0x242120 }); F.col(lx - 1.3, lx + 1.3, lz - 1.0, lz + 1.0); }
    fuel(...Y(r, 17.8, 8.5), Math.PI / 2, 14);
    anvil(F, 9.5, 11.5, 1.2); F.work(9.5, 12.5, 9.5, 11.5, 'forging a ploughshare');
    cartWheel(F, 18.9, 13.5, Math.PI / 2, 0.28); cartWheel(F, 18.9, 15.2, Math.PI / 2, 0.3);
    trough(F, 7.2, 8.6, 0, 1.6, 0.6);
    shed(...Y(r, 3.2, 15.5), 5.2, 5.0, 3.4, Math.PI / 2, { door: -0.8 });
    for (let i = 0; i < 6; i++) F.pg('pt', box(0.5, 0.03, 0.18), 8.6 + (R() - 0.5) * 0.3, 0.02 + i * 0.03, 17.6 + (R() - 0.5) * 0.3, { ry: R() * 0.6, c: 0x3b3532 });
    for (let i = 0; i < 5; i++) F.pg('woodDark', cyl(0.025, 0.02, 1.4, 5, true), 12.5 + i * 0.12, 0.7, 19.9, { rx: 0.3, rz: (R() - 0.5) * 0.2 });
    basket(F, 14.4, 19.6, 0x1f1d1c, 0.32, 0.4); basket(F, 15.2, 19.8, 0x1f1d1c, 0.3, 0.38);
    gather(...Y(r, 13, 15.5), 2, 'smithy yard'); area(r, 'smithy yard', 1.0);
  }

  // ================= region B: the masons' and sculptors' yard of the Mausoleum =================
  if (ok(S.masonsN)) {
    const r = S.masonsN, F = yard(r);
    yardWalls(r, { n: [20], s: [20], w: [26], e: [] }, 1.35);
    const fOff = yardBegin(r);
    // rough quarry blocks along the north wall (two stacked) and the west wall
    let seed = 1;
    [3.2, 6.1, 9.0, 11.9, 26.3, 29.2, 32.1].forEach((u, i) => {
      const h = 1.0 + R() * 0.3, v = 3.3 + (R() - 0.5) * 0.3;
      roughBlock(F, u, v, 2.3 + R() * 0.3, h, 1.25 + R() * 0.2, (R() - 0.5) * 0.1, true, seed++);
      if (i % 2 === 1) F.p('tc', rough(1.9, 0.85, 1.05, seed++), u + 0.1, F.g(u, v) + 0.08 + h + 0.4, v, { ry: 0.1, c: jit(STONE, 0.06) });
    });
    for (let i = 0; i < 4; i++) roughBlock(F, 3.0, 9 + i * 3.0 + (R() - 0.5) * 0.3, 1.3 + R() * 0.3, 1.1 + R() * 0.3, 2.2 + R() * 0.4, (R() - 0.5) * 0.1, true, seed++);
    for (let i = 0; i < 3; i++) roughBlock(F, 6.4 + i * 2.6, 9.6, 1.4 + R() * 0.3, 0.9 + R() * 0.4, 1.8, (R() - 0.5) * 0.15, true, seed++);
    wagon(F, 9.5, 31, 0);
    // rollers and levers
    for (let i = 0; i < 7; i++) F.p('wood', cyl(0.13, 0.13, 3.2 + R() * 0.6, 7), 3.4 + (i % 4) * 0.28 + (i > 3 ? 0.14 : 0), F.g(3.5, 38) + 0.13 + (i > 3 ? 0.24 : 0), 38 + (R() - 0.5) * 0.2, { rx: Math.PI / 2 });
    F.col(2.9, 4.6, 36.2, 39.8);
    // shear-legs lifting a block off its sledge
    { const [lx, lz] = [18.5, 19.1]; shearLegs(...Y(r, 18.5, 17.5), 0, 8.2, 1.6, gy(r.minX + lx, r.minZ + lz) + 2.0, (G2, ax, hy, az) => {
      const gl = G2.g(ax, az); G2.p('tc', rough(1.7, 0.9, 1.0, 55), ax, gl + 0.95, az, { c: jit(STONE, 0.06) });
      for (const sx of [-1, 1]) G2.p('pt', pole([ax + sx * 0.8, gl + 1.38, az], [ax, hy, az], 0.02, 4), 0, 0, 0, { c: 0x8a7a5a });
      for (const sx of [-1, 1]) G2.pg('woodDark', box(2.6, 0.16, 0.2), ax, 0.1, az + sx * 0.4);
      for (const t of [-0.8, 0, 0.8]) G2.pg('wood', cyl(0.1, 0.1, 1.3, 7), ax + t, 0.14, az, { rx: Math.PI / 2 });
      G2.col(ax - 1.3, ax + 1.3, az - 0.6, az + 0.6); G2.work(ax + 1.8, az + 0.6, ax, az, 'guiding the block'); }); }
    // sawing a block into slabs: saw blade, sand and water
    { const lx = 30, lz = 20; roughBlock(F, lx, lz, 2.2, 1.1, 1.3, 0, true, 77); const y = F.g(lx, lz);
      F.p('pt', box(2.9, 0.18, 0.012), lx, y + 1.0, lz + 0.1, { c: 0x6b4c2e }); for (const sx of [-1, 1]) F.p('woodDark', box(0.06, 0.5, 0.06), lx + sx * 1.45, y + 1.1, lz + 0.1);
      F.p('pt', ellipsoid(0.5, 0.2, 0.4, 8, 5), lx + 2.0, y, lz + 1.0, { c: 0xc9b894 }); F.p('tc', pot('pithos'), lx - 1.9, y, lz + 1.2, { c: jit(pick(FIRED)), s: 0.7 });
      F.work(lx - 1.8, lz - 0.2, lx, lz, 'sawing marble'); F.work(lx + 1.8, lz - 0.2, lx, lz, 'sawing marble'); chips(F, lx, lz + 1, 1.8, 60); }
    // long shed for architectural carving along the east wall
    const E = openShed(...Y(r, 36.6, 27), 24, 5.6, -Math.PI / 2, { hb: 3.9, hf: 3.1, plaster: 0xdcd2bd });
    for (const [lx, kind] of [[-8.5, 'cap'], [-4.5, 'cap'], [-0.5, 'dent'], [3.5, 'base'], [7.5, 'dent']]) {
      const y = E.g(lx, 0.2);
      E.p('woodDark', box(1.6, 0.25, 1.2), lx, y + 0.1, 0.2);
      if (kind === 'cap') { E.p('marble', box(1.35, 0.42, 0.95), lx, y + 0.45, 0.2); for (const sx of [-1, 1]) E.p('marble', cyl(0.24, 0.24, 0.95, 12), lx + sx * 0.5, y + 0.55, 0.2, { rx: Math.PI / 2 }); }
      else if (kind === 'dent') { E.p('marble', box(1.5, 0.5, 0.7), lx, y + 0.48, 0.2); for (let k = 0; k < 9; k++) E.p('marble', box(0.1, 0.14, 0.12), lx - 0.64 + k * 0.16, y + 0.62, 0.6); }
      else E.p('marble', lathe([[0.66, 0], [0.69, 0.05], [0.66, 0.1], [0.58, 0.14], [0.56, 0.2], [0.6, 0.25], [0.67, 0.29], [0.62, 0.35], [0.55, 0.4], [0.001, 0.4]], 16), lx, y + 0.23, 0.2);
      E.col(lx - 0.85, lx + 0.85, -0.45, 0.85); E.work(lx, 1.5, lx, 0.2, 'carving mouldings'); chips(E, lx, 1.2, 1.3, 45);
    }
    for (let i = 0; i < 5; i++) E.p('pt', box(0.03, 0.02, 0.25), -10.6 + i * 0.15, E.g(-10.5, -1.5) + 0.9, -2.0, { rx: 1.2, c: pick([0x2e2c2b, 0x6b4c2e]) });
    E.p('woodDark', box(1.2, 0.08, 0.3), -10.2, E.g(-10.5, -1.5) + 0.85, -1.9);
    // rough drums just unloaded, and a block being moved on rollers with levers
    { const rd = new THREE.CylinderGeometry(0.62, 0.62, 1.15, 12); for (let i = 0; i < 5; i++) { const lx = 20.5 + i * 1.5, lz = 38.5 + (i % 2) * 0.2; F.p('tc', rd, lx, F.g(lx, lz) + 0.6, lz, { rx: Math.PI / 2, ry: (R() - 0.5) * 0.2, c: jit(STONE, 0.06) }); F.pg('woodDark', box(0.18, 0.12, 1.6), lx, 0.02, lz, { ry: 0.05 }); } F.col(19.8, 27.2, 37.7, 39.5); }
    { const lx = 25.5, lz = 29.5, y = F.g(lx, lz); for (const t of [-0.9, 0.1, 1.1]) F.p('wood', cyl(0.12, 0.12, 1.6, 8), lx + t, y + 0.12, lz, { rx: Math.PI / 2 }); F.p('tc', rough(2.6, 1.0, 1.3, 88), lx, y + 0.74, lz, { c: jit(STONE, 0.06) });
      for (const sz of [-0.4, 0.4]) F.p('woodDark', pole([lx - 1.35, y + 0.35, lz + sz], [lx - 2.9, y + 1.2, lz + sz * 1.6], 0.05, 6, false), 0, 0, 0);
      F.col(lx - 1.4, lx + 1.4, lz - 0.8, lz + 0.8); F.work(lx - 3.1, lz - 0.8, lx - 1.4, lz, 'levering a block'); F.work(lx - 3.1, lz + 0.8, lx - 1.4, lz, 'levering a block'); }
    // a squared block roped onto a sledge, water jars and sand baskets for the saw
    { const S2 = frame(...Y(r, 25.5, 9.8), 0.08), y = S2.g(0, 0);
      for (const sz of [-0.5, 0.5]) S2.p('woodDark', box(3.4, 0.18, 0.18), 0, y + 0.08, sz);
      for (const sx of [-1.2, 0, 1.2]) S2.p('woodDark', box(0.14, 0.12, 1.3), sx, y + 0.22, 0);
      S2.p('marble', box(2.0, 0.9, 1.05), -0.1, y + 0.73, 0);
      for (const sx of [-0.6, 0.5]) S2.p('pt', box(0.04, 0.96, 1.1), sx, y + 0.74, 0, { c: 0x8a7a5a });
      S2.p('woodDark', pole([1.7, y + 0.1, 0], [3.4, y + 0.1, 0.4], 0.03, 4), 0, 0, 0);
      S2.col(-1.8, 1.8, -0.7, 0.7); S2.work(0.3, 1.3, -0.1, 0.4, 'roping a block'); }
    for (let i = 0; i < 4; i++) F.p('tc', pot(i % 2 ? 'pithos' : 'amph'), 33.6 + i * 0.62, F.g(33.6 + i * 0.62, 23.2) - 0.02, 23.2, { s: i % 2 ? 0.55 : 1.1, ry: R() * 3, c: jit(pick(FIRED)) });
    for (let i = 0; i < 3; i++) basket(F, 33.8 + i * 0.7, 24.3, 0xcbb98f, 0.28, 0.36);
    F.col(33.2, 36.2, 22.8, 24.7);
    // finished, squared blocks waiting to be hauled up to the precinct
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { const lx = 8 + i * 3.0, lz = 41.2 + j * 2.4, y = F.g(lx, lz); F.p('tc', box(2.2, 0.62, 1.1), lx, y + 0.29, lz, { c: jit(DRESSED, 0.05) }); if ((i + j) % 2) F.p('tc', box(2.2, 0.62, 1.1), lx, y + 0.91, lz, { ry: (R() - 0.5) * 0.06, c: jit(DRESSED, 0.05) }); F.col(lx - 1.15, lx + 1.15, lz - 0.6, lz + 0.6); }
    // the masons' own forge for re-tempering chisels, under a lean-to by the south wall
    { const Fg = leanTo(...Y(r, 30, 50.9), 7.5, 3.2, Math.PI, { hb: 3.0, hf: 2.5 });
      forge(Fg, 1.2, -0.2); anvil(Fg, -1.6, 0.4, 0.8); trough(Fg, -2.8, -0.9, 0, 1.1, 0.5);
      Fg.work(1.4, 1.1, 1.2, -0.2, 'sharpening chisels'); Fg.work(-1.6, 1.3, -1.6, 0.4, 'hammering chisels');
      const [px, pz] = Fg.w(1.2, -0.2); plume(px, Fg.y + 3.1, pz, { col: 0xb8b0a6, H: 10, alpha: 0.5, n: 10, size: 0.8 }); }
    // spoil: a mound of chips and broken stone
    { const lx = 37, lz = 46; F.p('tc', ellipsoid(1.7, 0.6, 1.3, 10, 6), lx, F.g(lx, lz) - 0.12, lz, { c: jit(STONE, 0.05) }); F.col(lx - 1.6, lx + 1.6, lz - 1.2, lz + 1.2); chips(F, lx, lz, 2.2, 70); }
    // more stone and more hands: moulding trestles, a row of cornice blocks, a block being dressed, rows of finished blocks, spoil, the lime pit, the timber store
    for (const u of [7.2, 11.6]) if (free(F, u - 1.1, u + 1.1, 21.0, 22.0)) mouldingTrestle(F, u, 21.5, 0);
    if (free(F, 4.95, 15.25, 33.7, 34.7)) corniceRow(F, 6, 34.2, 5);
    if (free(F, 26.35, 28.7, 14.85, 16.15)) dressingBlock(F, 27.5, 15.5, 0);
    if (free(F, 27.4, 33.05, 33.85, 35.15)) blockRow(F, 28.6, 34.5, 2);
    if (free(F, 4.8, 12.1, 13.85, 15.15)) blockRow(F, 6, 14.5, 3);
    if (free(F, 13.7, 16.3, 3.95, 6.05)) spoil(F, 15, 5, 1.5);
    if (free(F, 34.7, 36.9, 41.3, 43.1)) spoil(F, 35.8, 42.2, 1.3);
    if (free(F, 23.75, 27.85, 43.55, 45.8)) limePit(F, 25, 44.5);
    if (free(F, 0.9, 3.95, 41.6, 51.2)) timberStore(...Y(r, 2.4, 46.5), Math.PI / 2);
    for (const [u, v, u1, v1] of [[0, 26, 9.5, 31], [20, 0, 18.5, 19], [20, 53.5, 23, 38.5]]) tracks.push([r.minX + u, r.minZ + v, r.minX + u1, r.minZ + v1, 1.7]);
    for (const [u, v, rr] of [[12, 43.5, 5], [30.5, 34.5, 3.5], [9, 14.5, 4], [4, 6, 5], [29, 3.3, 4.5]]) dust.push([r.minX + u, r.minZ + v, rr]);
    gather(...Y(r, 16, 25), 3, 'masons\' yard'); area(r, 'masons\' yard');
    yardFloor(r, fOff);
  }
  if (ok(S.masonsS)) {
    const r = S.masonsS, F = yard(r);
    yardWalls(r, { n: [20], s: [20], w: [25], e: [] }, 1.3);
    const fOff = yardBegin(r);
    // sculptors' shed along the west wall, opening east; the half-carved statue at its mouth
    const W = openShed(...Y(r, 3.2, 12), 16, 5.4, Math.PI / 2, { hb: 3.9, hf: 3.1, plaster: 0xe2d6bf });
    { const lx = 3.2, lz = 1.4, y = W.g(lx, lz), s = 1.45, sp = (g, px, py, pz, sd) => W.p('tc', stoneC(g, sd), lx + px, y + py, lz + pz);
      sp(rough(1.3, 1.25, 1.08, 12), 0, 0.6, -0.04, 12);             // the block, cut down to the waist in front
      sp(rough(1.3, 0.72, 0.46, 13), 0, 1.58, -0.35, 13);            // the back still standing to the shoulder blades
      sp(rough(0.34, 0.5, 0.62, 14), -0.52, 1.46, -0.12, 14);        // a lump left beside the hanging arm
      W.p('tc', roughOut(figureGeometry({ seed: 311, draped: 'full', female: true }), 0.025 / s, 311, { sx: 1.08, sz: 1.1, hide: [[-0.6, 0.6, -1, 0.8, -0.5, 0.45]] }), lx, y - 0.02, lz, { s });
      W.p('wood', box(0.9, 0.8, 0.8), lx - 1.35, y + 0.38, lz + 0.1); tools(W, lx - 1.35, y + 0.78, lz + 0.1, 0.5);
      W.col(lx - 1.8, lx + 0.75, lz - 0.65, lz + 0.55); W.work(lx, lz + 1.7, lx, lz, 'carving a statue'); chips(W, lx, lz + 0.6, 2.0, 140); }
    for (let i = 0; i < 2; i++) { const lx = -4.5 + i * 3.2; W.pg('wood', box(2.2, 0.08, 0.8), lx, 0.9, -1.4); for (const sx of [-1, 1]) W.pg('wood', box(0.08, 0.9, 0.7), lx + sx * 0.95, 0.45, -1.4); W.col(lx - 1.1, lx + 1.1, -1.8, -1.0); W.work(lx, -0.5, lx, -1.4, 'modelling'); }
    // clay models for the carvers: a standing figure and a lion, roughly modelled
    { const y = W.g(-4.3, -1.4) + 0.94, cm = 0x8f7a64; W.p('pt', cyl(0.1, 0.13, 0.55, 7), -4.3, y + 0.3, -1.4, { c: cm }); W.p('pt', ellipsoid(0.09, 0.08, 0.07, 7, 5), -4.3, y + 0.62, -1.4, { c: cm }); W.p('pt', ellipsoid(0.05, 0.055, 0.05, 6, 4), -4.3, y + 0.74, -1.4, { c: cm }); W.p('wood', box(0.3, 0.03, 0.3), -4.3, y + 0.015, -1.4);
      const yl = W.g(-1.2, -1.4) + 0.94; W.p('pt', ellipsoid(0.26, 0.11, 0.1, 8, 5), -1.2, yl + 0.2, -1.4, { c: cm }); W.p('pt', ellipsoid(0.1, 0.1, 0.1, 7, 5), -0.95, yl + 0.3, -1.4, { c: cm }); for (const sx of [-0.18, 0.15]) for (const sz of [-0.06, 0.06]) W.p('pt', cyl(0.025, 0.025, 0.14, 5), -1.2 + sx, yl + 0.07, -1.4 + sz, { c: cm }); W.p('wood', box(0.7, 0.03, 0.3), -1.2, yl + 0.015, -1.4); }
    for (let i = 0; i < 6; i++) W.p('pt', box(0.03, 0.02, 0.2 + R() * 0.1), -5 + R() * 1.6, W.g(-4, -1.4) + 0.95, -1.2 - R() * 0.3, { ry: R() * 3, c: pick([0x2e2c2b, 0x6b4c2e]) });
    for (const lx of [-6.4, 5.8]) { W.p('tc', rough(0.8, 1.2, 0.7, 70 + lx), lx, W.g(lx, -1.3) + 0.6, -1.3, { c: jit(STONE, 0.06) }); W.col(lx - 0.5, lx + 0.5, -1.7, -0.9); }
    // half-carved lion under an awning: the forequarters already free of the block
    { const lx = 14.5, lz = 18, y = F.g(lx, lz), s = 1.4, sp = (g, px, py, sd) => F.p('tc', stoneC(g, sd), lx + px, y + py, lz);
      sp(rough(3.85, 0.3, 1.33, 21), 0, 0.12, 21);                   // plinth, left under the paws
      sp(rough(2.59, 1.37, 1.18, 22), -0.6, 0.94, 22);               // the block still holding body and hindquarters
      F.p('tc', roughOut(lionGeometry({ seed: 7, stride: 0.2 }), 0.03 / s, 7, { hide: [[-1.31, 0.45, 0.04, 0.94, -0.38, 0.38], [-1.33, 1.33, -1, 0.0, -0.44, 0.44]] }), lx, y + 0.25, lz, { s });
      toolStand(F, lx - 0.4, lz + 1.15, 0.2);
      F.col(lx - 2.1, lx + 1.95, lz - 0.75, lz + 0.75); F.work(lx + 1.2, lz + 1.4, lx + 1.0, lz, 'carving a lion'); F.work(lx - 0.6, lz - 1.4, lx - 0.6, lz, 'roughing out the block'); chips(F, lx + 0.4, lz, 2.8, 130);
      for (const [ox, oz] of [[-3, -2.4], [3, -2.4], [-3, 2.4], [3, 2.4]]) { F.pg('woodDark', cyl(0.05, 0.06, 3.0, 6), lx + ox, 1.2, lz + oz); F.col(lx + ox - 0.1, lx + ox + 0.1, lz + oz - 0.1, lz + oz + 0.1); }
      const aw = new THREE.PlaneGeometry(6.4, 5.2, 4, 3), ap = aw.attributes.position; for (let k = 0; k < ap.count; k++) ap.setZ(k, -0.18 * Math.cos(ap.getX(k) / 6.4 * Math.PI) * Math.cos(ap.getY(k) / 5.2 * Math.PI)); aw.computeVertexNormals();
      F.p('cl', aw, lx, Math.max(F.g(lx - 3, lz), F.g(lx + 3, lz)) + 2.62, lz, { rx: -Math.PI / 2, c: lin(1.3, 1.02, 0.66) }); }
    // column drums waiting for fluting; some lying on timbers, one being dressed
    const drum = drumGeo(0.5, 0.95);
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) F.pg('marble', drum, 24.5 + i * 1.6, 0.45, 5.2 + j * 1.7, { ry: R() * 3 });
    F.col(23.8, 32.8, 4.5, 7.6);
    for (let k = 0; k < 3; k++) { const lz = 11 + k * 1.3; for (let i = 0; i < 3; i++) F.pg('woodDark', box(0.14, 0.14, 1.1), 32.2 + i * 0.95, 0.07, lz); F.pg('marble', drum, 33.2, 0.64, lz, { rz: Math.PI / 2, ry: 0 }); }
    F.col(32.1, 34.4, 10.3, 14.3);
    { const lx = 26, lz = 14; F.pg('marble', drum, lx, 0.45, lz); F.work(lx, lz + 1.1, lx, lz, 'dressing a column drum'); chips(F, lx, lz, 1.6, 50); F.col(lx - 0.65, lx + 0.65, lz - 0.65, lz + 0.65); }
    // a test-assembled column under scaffolding; the shear-legs are setting its fifth drum
    { const lx = 28.5, lz = 34, gs = [F.g(lx - 1.4, lz - 1.4), F.g(lx + 1.4, lz + 1.4), F.g(lx - 1.4, lz + 1.4), F.g(lx + 1.4, lz - 1.4)], g0 = Math.max(...gs), gm = Math.min(...gs);
      F.p('ashlar', box(2.8, g0 - gm + 0.6, 2.8), lx, (g0 + gm) / 2, lz);
      const y = g0 + 0.3;
      F.p('marble', box(1.35, 0.1, 1.35), lx, y + 0.05, lz);
      F.p('marble', lathe([[0.66, 0.1], [0.69, 0.15], [0.66, 0.19], [0.58, 0.23], [0.56, 0.29], [0.6, 0.34], [0.67, 0.38], [0.62, 0.44], [0.53, 0.5], [0.001, 0.5]], 16), lx, y, lz);
      for (let k = 0; k < 4; k++) F.p('marble', drum, lx, y + 0.5 + 0.475 + k * 0.955, lz, { ry: k * 0.7 });
      scaffold(F, lx, lz, 2.6, 6.6);
      F.col(lx - 1.0, lx + 1.0, lz - 1.0, lz + 1.0); F.work(lx + 1.9, lz, lx, lz, 'fitting the column');
      const topY = y + 0.5 + 4 * 0.955, hook = topY + 0.45 + 0.95 + 0.6;
      shearLegs(...Y(r, 22.0, lz), Math.PI / 2, 10.5, lx - 22.0, hook, (G2, ax, hy, az) => {
        const dy = hy - 0.6 - 0.475; G2.p('marble', drum, ax, dy, az, { ry: 0.4 });
        for (const sx of [-1, 1]) G2.p('pt', pole([ax + sx * 0.52, dy + 0.1, az], [ax, hy, az], 0.02, 4), 0, 0, 0, { c: 0x8a7a5a }); }); }
    // a colossal horse for the quadriga, and raw blocks for statues along the south wall; a finished lion on its sledge
    horseInBlock(F, 9.5, 31, 0, 1.6);
    for (let i = 0; i < 3; i++) roughBlock(F, 3.5 + i * 3.0, 44, 1.2, 1.9 + R() * 0.4, 1.1, (R() - 0.5) * 0.2, true, 40 + i);
    { const lx = 14, lz = 43.5, y = F.g(lx, lz), s = 1.35; for (const sz of [-0.5, 0.5]) F.p('woodDark', box(3.8, 0.2, 0.18), lx, y + 0.06, lz + sz); F.p('tc', stoneC(rough(3.2, 0.24, 0.9, 31), 31, STONE), lx, y + 0.28, lz); F.p('tc', stoneC(lionGeometry({ seed: 11, stride: 0.25 }), 32, STONE), lx, y + 0.38, lz, { s, ry: Math.PI }); F.col(lx - 1.95, lx + 1.95, lz - 0.7, lz + 0.7); }
    chips(F, 9, 42.5, 3.2, 70); chips(F, 27, 6.3, 3.5, 60);
    // finished statues for the Mausoleum waiting under a shed by the east wall, one crated for hauling
    { const Sh = openShed(...Y(r, 37.0, 30), 20, 4.6, -Math.PI / 2, { hb: 4.4, hf: 3.7, plaster: 0xe0d5c0 });
      [[-7, 401, true], [-3, 402, false], [1, 403, true], [5, 404, false]].forEach(([lx, seed, fem]) => {
        const y = Sh.g(lx, -0.3); Sh.p('socles', box(1.1, 0.5, 1.1), lx, y + 0.2, -0.3);
        Sh.p('statue', figureGeometry({ seed, draped: 'full', female: fem }), lx, y + 0.45, -0.3, { s: 1.3, ry: (R() - 0.5) * 0.3 }); Sh.col(lx - 0.6, lx + 0.6, -0.9, 0.3); });
      { const lx = 8.3, y = Sh.g(lx, -0.3); for (const sx of [-0.75, 0.75]) for (const sz of [-0.55, 0.55]) Sh.p('wood', box(0.12, 2.5, 0.12), lx + sx, y + 1.25, -0.3 + sz); for (const hy of [0.3, 1.3, 2.3]) for (const sz of [-0.55, 0.55]) Sh.p('wood', box(1.62, 0.12, 0.05), lx, y + hy, -0.3 + sz); for (const hy of [0.3, 1.3, 2.3]) for (const sx of [-0.75, 0.75]) Sh.p('wood', box(0.05, 0.12, 1.22), lx + sx, y + hy, -0.3); Sh.p('cl', box(1.3, 1.9, 0.9), lx, y + 1.2, -0.3, { c: jit(REED) }); Sh.col(lx - 0.85, lx + 0.85, -0.95, 0.35); }
      Sh.work(-5, 1.2, -5, -0.3, 'polishing a statue'); }
    // timber for scaffolds and sledges
    { const lx = 24, lz = 45.5; for (let i = 0; i < 9; i++) F.p(i % 3 ? 'wood' : 'woodDark', cyl(0.14, 0.14, 6 + R(), 6), lx + (i % 4 - 1.5) * 0.3 + (i > 3 ? 0.15 : 0) + (i > 6 ? 0.15 : 0), F.g(lx, lz) + 0.14 + (i > 3 ? 0.26 : 0) + (i > 6 ? 0.26 : 0), lz, { rz: Math.PI / 2, ry: Math.PI / 2 + (R() - 0.5) * 0.05 }); F.col(lx - 0.8, lx + 0.8, lz - 3.5, lz + 3.5); }
    // a second lion only blocked out, cornice blocks and coffers for the peristyle, a block being dressed, spoil
    if (free(F, 10.2, 13.8, 7.5, 9.7)) lionBlock(F, 12, 9, 0);
    if (free(F, 23.15, 31.4, 21.0, 22.0)) corniceRow(F, 24.2, 21.5, 4);
    if (free(F, 7.0, 14.3, 2.55, 3.85)) blockRow(F, 8.2, 3.2, 3);
    if (free(F, 2.2, 7.05, 36.35, 37.65)) blockRow(F, 3.4, 37, 2);
    if (free(F, 3.35, 5.7, 28.35, 29.65)) dressingBlock(F, 4.5, 29, 0);
    for (const [u, n] of [[30.5, 3], [32.5, 2]]) if (free(F, u - 0.75, u + 0.75, 43.75, 45.25, 0.1)) cofferStack(F, u, 44.5, n, (R() - 0.5) * 0.1);
    if (free(F, 35.0, 37.4, 44.5, 46.5)) spoil(F, 36.2, 45.5, 1.4);
    if (free(F, 2.2, 4.2, 40.2, 41.8)) spoil(F, 3.2, 41, 1.2);
    if (free(F, 15.05, 16.95, 38.1, 38.9)) mouldingTrestle(F, 16, 38.5, 0);
    for (const [u, v, u1, v1] of [[20, 0, 27, 6], [20, 49.5, 22, 36], [0, 25, 8, 29.5]]) tracks.push([r.minX + u, r.minZ + v, r.minX + u1, r.minZ + v1, 1.7]);
    for (const [u, v, rr] of [[28.5, 6, 5], [5, 44, 4.5], [14, 43.5, 3.5], [28.5, 34, 4], [10.5, 3.2, 4.5]]) dust.push([r.minX + u, r.minZ + v, rr]);
    gather(...Y(r, 18, 25), 3, 'sculptors\' yard'); area(r, 'sculptors\' yard');
    yardFloor(r, fOff);
  }

  // ---------- meshes, glow, smoke ----------
  // fire: emissive scaled by the vertex colour, so a mouth or a bed of coals can glow hotter at its heart
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x2a1408, emissive: 0xff5a18, emissiveIntensity: 2.4, roughness: 0.9, vertexColors: true });
  glowMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= vColor.rgb;'); };
  setupMaterial(glowMat); { const k = glowMat.customProgramCacheKey.bind(glowMat); glowMat.customProgramCacheKey = () => k() + '|industryGlow'; }
  // the masons' yard floors in the town's own dirt texture (UVs in metres, like the terrain), tinted per vertex
  const floorMat = setupMaterial(M.T?.dirt ? new THREE.MeshStandardMaterial({ map: M.T.dirt.map, normalMap: M.T.dirt.normalMap, roughnessMap: M.T.dirt.roughnessMap, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.35, normalScale: new THREE.Vector2(0.8, 0.8) }) : new THREE.MeshStandardMaterial({ vertexColors: true }));
  for (const [b, m, shadow] of [[own.tc, M.terracotta, true], [own.pt, M.painted, true], [own.rb, M.rubble, true], [own.gl, glowMat, false], [own.fl, floorMat, false]]) {
    const mesh = b.mesh(m, shadow); if (mesh) { mesh.name = 'industry'; if (!shadow) mesh.receiveShadow = m !== glowMat; G.add(mesh); }
  }
  const VENT = 4;                                   // small dense puffs pinned just above each vent
  const N = plumes.reduce((a, p) => a + p.n + VENT, 0);
  let smoke = null;
  if (N) {
    const pos = new Float32Array(N * 12), col = new Float32Array(N * 16), uv = new Float32Array(N * 8), idx = [];
    for (let i = 0; i < N; i++) { uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8); const b = i * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); sg.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage)); sg.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); sg.setIndex(idx);
    smoke = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ map: puffTexture(), transparent: true, depthWrite: false, vertexColors: true }));
    smoke.frustumCulled = false; smoke.renderOrder = 2; smoke.name = 'industry smoke';
    // keep the smoke out of the GTAO normal pass (it renders with an override material)
    smoke.onBeforeRender = (r, sc, cam, g) => g.setDrawRange(0, sc.overrideMaterial ? 0 : Infinity);
    G.add(smoke);
  }
  const centres = [[-280, 385], [-147, 2]];
  layout.updaters.push((dt, t, camera) => {
    const p = camera.position, near = Math.min(...centres.map(([cx, cz]) => Math.hypot(p.x - cx, p.z - cz))) < 1100;
    glowMat.emissiveIntensity = 2.3 + 0.35 * Math.sin(t * 7.1) * Math.sin(t * 2.3 + 1.3) + 0.15 * Math.sin(t * 17.3);
    if (!smoke) return;
    smoke.visible = near; if (!near) return;
    const e = camera.matrixWorld.elements, rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6];
    const pa = smoke.geometry.attributes.position.array, ca = smoke.geometry.attributes.color.array;
    let i = 0;
    for (const pl of plumes) for (let j = 0; j < pl.n + VENT; j++, i++) {
      const vent = j >= pl.n, tt = vent ? ((j - pl.n) / VENT + t * pl.rate * 6) % 1 * 0.09 : (j / pl.n + t * pl.rate) % 1, sd = pl.seed + j * 2.39;
      const cx = pl.x + Math.sin(sd + t * 0.3) * (0.15 + tt * 1.8) + tt * tt * pl.H * 0.5, cy = pl.y + tt * pl.H, cz = pl.z + Math.cos(sd * 1.3 + t * 0.2) * (0.15 + tt * 1.8) + tt * pl.H * 0.12;
      const s = pl.size * (vent ? 0.3 + tt * 5 : 0.4 + tt * 4.5), a = pl.alpha * Math.pow(1 - tt, 1.3) * (vent ? 0.75 * (1 - smoothstep(0.05, 0.09, tt)) : smoothstep(-0.05, 0.05, tt));
      for (let k = 0; k < 4; k++) {
        const sx = k === 0 || k === 3 ? -s : s, sy = k < 2 ? -s : s, o = (i * 4 + k);
        pa[o * 3] = cx + rx * sx + ux * sy; pa[o * 3 + 1] = cy + ry * sx + uy * sy; pa[o * 3 + 2] = cz + rz * sx + uz * sy;
        ca[o * 4] = pl.col.r; ca[o * 4 + 1] = pl.col.g; ca[o * 4 + 2] = pl.col.b; ca[o * 4 + 3] = a;
      }
    }
    smoke.geometry.attributes.position.needsUpdate = true; smoke.geometry.attributes.color.needsUpdate = true;
  });
}
