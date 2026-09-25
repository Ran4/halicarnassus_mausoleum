// Geometry + math helpers shared by every builder.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- math ----------
export function rng(seed) {            // mulberry32
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;

// Periodic 2D gradient noise. noise(u, v, period): lattice wraps every `period` cells,
// so fbm built on it tiles perfectly when u,v ∈ [0,1) map onto `period` cells.
export function makeNoise2D(seed = 1) {
  const r = rng(seed);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y, period = 0) {
    let X = Math.floor(x), Y = Math.floor(y);
    const fx = x - X, fy = y - Y;
    let X1 = X + 1, Y1 = Y + 1;
    if (period > 0) { X = ((X % period) + period) % period; Y = ((Y % period) + period) % period; X1 = (X + 1) % period; Y1 = (Y + 1) % period; }
    X &= 255; Y &= 255; X1 &= 255; Y1 &= 255;
    const g00 = G[p[p[X] + Y] & 7], g10 = G[p[p[X1] + Y] & 7], g01 = G[p[p[X] + Y1] & 7], g11 = G[p[p[X1] + Y1] & 7];
    const n00 = g00[0] * fx + g00[1] * fy, n10 = g10[0] * (fx - 1) + g10[1] * fy;
    const n01 = g01[0] * fx + g01[1] * (fy - 1), n11 = g11[0] * (fx - 1) + g11[1] * (fy - 1);
    const u = fade(fx), v = fade(fy);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 0.75; // ≈ [-1,1]
  }
  function fbm(x, y, oct = 5, period = 0, lac = 2, gain = 0.5) {
    let a = 1, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f, period * f); n += a; a *= gain; f *= lac; }
    return s / n;
  }
  return { noise, fbm };
}

// ---------- geometry ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _v.set(x, y, z);
  if (typeof s === 'number') _s.set(s, s, s); else _s.copy(s);
  return new THREE.Matrix4().compose(_v, _q, _s);
}
export function tx(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) { g.applyMatrix4(mat(x, y, z, rx, ry, rz, s)); return g; }

export function scaleUV(g, su, sv, ou = 0, ov = 0) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su + ou, uv.getY(i) * sv + ov);
  return g;
}

// Box whose UVs are in metres on every face (textures use repeat = 1/realSize).
export function box(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) { const f = Math.floor(i / 4); uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]); }
  return g;
}
export function boxAt(w, h, d, x, y, z, ry = 0) { return tx(box(w, h, d), x, y, z, 0, ry, 0); }

// Lathe around Y with metric UVs. pts: [[r, y], ...] bottom → top.
export function lathe(pts, segs = 32, phiStart = 0, phiLen = TAU) {
  const v2 = pts.map(p => new THREE.Vector2(p[0], p[1]));
  const g = new THREE.LatheGeometry(v2, segs, phiStart, phiLen);
  let len = 0, rsum = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (const p of pts) rsum += p[0];
  const rMean = rsum / pts.length;
  scaleUV(g, rMean * phiLen, len);
  return g;
}

// Sweeps a moulding profile around a w×d rectangle centred on the origin.
// profile: [{o, y} | {ox, oz, y}], bottom → top; `hard:true` on a point gives a crease there.
// opts.top / opts.bottom add flat caps.
export function rectSweep(w, d, profile, opts = {}) {
  const P = profile.map(p => ({ ox: p.ox ?? p.o ?? 0, oz: p.oz ?? p.o ?? 0, y: p.y, hard: !!p.hard }));
  const pos = [], nor = [], uv = [], idx = [];
  const segN = [];  // 2D normal (o, y) for each profile segment
  for (let i = 0; i < P.length - 1; i++) {
    const dO = ((P[i + 1].ox - P[i].ox) + (P[i + 1].oz - P[i].oz)) * 0.5, dY = P[i + 1].y - P[i].y;
    const l = Math.hypot(dO, dY) || 1;
    segN.push([dY / l, -dO / l]);
  }
  const vn = (i, which) => { // vertex normal at profile point i, for segment `which` (i-1 or i)
    const s = segN[which];
    if (P[i].hard) return s;
    const a = segN[i - 1], b = segN[i];
    if (!a) return b; if (!b) return a;
    const nx = a[0] + b[0], ny = a[1] + b[1], l = Math.hypot(nx, ny) || 1;
    return [nx / l, ny / l];
  };
  // sides: [dir vector (outward), along vector]
  const sides = [
    { n: [1, 0, 0], corner: (ox, oz, t) => [w / 2 + ox, 0, lerp(-(d / 2 + oz), d / 2 + oz, t)] },   // east, north→south
    { n: [0, 0, 1], corner: (ox, oz, t) => [lerp(w / 2 + ox, -(w / 2 + ox), t), 0, d / 2 + oz] },   // south, east→west
    { n: [-1, 0, 0], corner: (ox, oz, t) => [-(w / 2 + ox), 0, lerp(d / 2 + oz, -(d / 2 + oz), t)] }, // west
    { n: [0, 0, -1], corner: (ox, oz, t) => [lerp(-(w / 2 + ox), w / 2 + ox, t), 0, -(d / 2 + oz)] }, // north
  ];
  let vArc = 0; const arcs = [0];
  for (let i = 0; i < P.length - 1; i++) { vArc += Math.hypot((P[i + 1].ox - P[i].ox + P[i + 1].oz - P[i].oz) * 0.5, P[i + 1].y - P[i].y); arcs.push(vArc); }
  let uOff = 0;
  for (const sd of sides) {
    const len = (sd.n[0] !== 0) ? d : w;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i], b = P[i + 1];
      const nA = vn(i, i), nB = vn(i + 1, i);
      const base = pos.length / 3;
      const c0 = sd.corner(a.ox, a.oz, 0), c1 = sd.corner(a.ox, a.oz, 1), c2 = sd.corner(b.ox, b.oz, 1), c3 = sd.corner(b.ox, b.oz, 0);
      c0[1] = a.y; c1[1] = a.y; c2[1] = b.y; c3[1] = b.y;
      const nA3 = [sd.n[0] * nA[0], nA[1], sd.n[2] * nA[0]], nB3 = [sd.n[0] * nB[0], nB[1], sd.n[2] * nB[0]];
      pos.push(...c0, ...c1, ...c2, ...c3);
      nor.push(...nA3, ...nA3, ...nB3, ...nB3);
      uv.push(uOff, arcs[i], uOff + len, arcs[i], uOff + len, arcs[i + 1], uOff, arcs[i + 1]);
      // winding check against intended normal
      const ax = c1[0] - c0[0], ay = c1[1] - c0[1], az = c1[2] - c0[2], bx = c3[0] - c0[0], by = c3[1] - c0[1], bz = c3[2] - c0[2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      const flip = (cx * nA3[0] + cy * nA3[1] + cz * nA3[2]) < 0;
      if (!flip) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    uOff += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const parts = [g];
  if (opts.top) { const t = P[P.length - 1]; parts.push(tx(scaleUV(new THREE.PlaneGeometry(w + 2 * t.ox, d + 2 * t.oz), w + 2 * t.ox, d + 2 * t.oz), 0, t.y, 0, -Math.PI / 2)); }
  if (opts.bottom) { const t = P[0]; parts.push(tx(scaleUV(new THREE.PlaneGeometry(w + 2 * t.ox, d + 2 * t.oz), w + 2 * t.ox, d + 2 * t.oz), 0, t.y, 0, Math.PI / 2)); }
  return parts.length > 1 ? mergeGeometries(parts.map(normalizeGeom), false) : g;
}

// Generic ring-sweep around Y: rings × segs grid; fn(i, j, t, a) → [x,y,z]  (t = i/(rings-1), a = angle).
// Convention: fn returns [cos a·r, y, −sin a·r] for an outward-facing surface.
export function tubeY(rings, segs, fn, uvU = 1, uvV = 1, closed = true) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * TAU;
      const p = fn(i, j % segs, t, a);
      pos.push(p[0], p[1], p[2]);
      uv.push(uvU * j / segs, uvV * t);
    }
  }
  for (let i = 0; i < rings - 1; i++) for (let j = 0; j < segs; j++) {
    const a = i * (segs + 1) + j, b = a + segs + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // stitch seam normals (j=0 and j=segs) so the seam is invisible
  const n = g.attributes.normal;
  for (let i = 0; i < rings; i++) {
    const a = i * (segs + 1), b = a + segs;
    const nx = (n.getX(a) + n.getX(b)) * 0.5, ny = (n.getY(a) + n.getY(b)) * 0.5, nz = (n.getZ(a) + n.getZ(b)) * 0.5;
    n.setXYZ(a, nx, ny, nz); n.setXYZ(b, nx, ny, nz);
  }
  return g;
}

export function capsule(r, len, ...rest) { const g = new THREE.CapsuleGeometry(r, len, 4, 10); scaleUV(g, TAU * r, len + 2 * r); return g; }
export function ellipsoid(rx, ry, rz, ws = 14, hs = 10) { const g = new THREE.SphereGeometry(1, ws, hs); g.scale(rx, ry, rz); scaleUV(g, TAU * rx, Math.PI * ry); return g; }
// capsule between two points
export function bone(a, b, r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = capsule(r, len);
  const dir = B.clone().sub(A).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m); return g;
}

export function normalizeGeom(g) {
  let out = g.index ? g : mergeVertices(g, 1e-4);
  if (out === g) out = g.clone();
  for (const k of Object.keys(out.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.attributes.position.count * 2), 2));
  out.clearGroups();
  return out;
}

// Collects geometries (with transforms) and merges them into one.
export class Bucket {
  constructor() { this.list = []; }
  add(g, m) { const c = normalizeGeom(g); if (m) c.applyMatrix4(m); this.list.push(c); return this; }
  at(g, x = 0, y = 0, z = 0, ry = 0, s = 1) { return this.add(g, mat(x, y, z, 0, ry, 0, s)); }
  get size() { return this.list.length; }
  build() {
    if (!this.list.length) return null;
    const g = mergeGeometries(this.list, false);
    this.list.length = 0;
    return g;
  }
  mesh(material, shadows = true) {
    const g = this.build(); if (!g) return null;
    const m = new THREE.Mesh(g, material);
    m.castShadow = shadows; m.receiveShadow = true;
    return m;
  }
}

// Per-vertex colour helper for merged geometry (vertexColors materials).
export function colorize(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function weatherize(c, w, own = false) {
  c.userData.ownWear = own;
  const p = c.attributes.position, n = p.count, a = new Float32Array(n * 4);
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const y = p.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
  for (let i = 0; i < n; i++) { const y = p.getY(i); a[i * 4] = 99; a[i * 4 + 1] = y1 - y; a[i * 4 + 2] = y - y0; a[i * 4 + 3] = w; }
  c.setAttribute('weather', new THREE.BufferAttribute(a, 4));
}
export class ColorBucket extends Bucket {
  // weather: a default wear (0 = kept fresh .. 1 = falling apart) turns on the per-vertex `weather` attribute
  // (x = height above the ground, filled in by fillGround(); y = below the piece's top; z = above its bottom; w = wear),
  // which src/weather/*.js read. add() then takes the piece's own wear, else the bucket's default.
  constructor(weather = null) { super(); this.weather = weather; }
  add(g, m, color = 0xffffff, wear = null) {
    let c = g.index ? g.clone() : mergeVertices(g, 1e-4);
    for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') c.deleteAttribute(k);
    if (!c.attributes.normal) c.computeVertexNormals();
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    c.clearGroups();
    colorize(c, color);
    if (m) c.applyMatrix4(m);
    if (this.weather !== null) weatherize(c, wear ?? this.weather, wear !== null);
    this.list.push(c); return this;
  }
  build() { if (this.weather !== null) for (const c of this.list) if (!c.attributes.weather) weatherize(c, this.weather); return super.build(); }
  // weather.x = height above ground(x, z) for every piece added so far; pieces added without a wear of their own
  // take wearAt(x, z) at their centre when it gives one (a yard wall wears like its house)
  fillGround(ground, wearAt = null) {
    for (const c of this.list) {
      if (!c.attributes.weather) weatherize(c, this.weather);   // pieces some features push straight onto .list
      const p = c.attributes.position, a = c.attributes.weather;
      for (let i = 0; i < p.count; i++) a.setX(i, p.getY(i) - ground(p.getX(i), p.getZ(i)));
      if (wearAt && !c.userData.ownWear) {
        c.computeBoundingBox(); const b = c.boundingBox, w = wearAt((b.min.x + b.max.x) / 2, (b.min.z + b.max.z) / 2);
        if (w !== null) for (let i = 0; i < p.count; i++) a.setW(i, w);
      }
    }
  }
  at(g, x, y, z, ry = 0, s = 1, color = 0xffffff) { return this.add(g, mat(x, y, z, 0, ry, 0, s), color); }
}
