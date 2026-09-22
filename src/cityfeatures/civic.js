// Town feature: civic — the public buildings of Halicarnassus c. 350 BC.
//   A  Sanctuary of Apollo on a terrace north of the platea: Ionic amphiprostyle temple, altar, gate, stoa, laurels
//   B  Fountain house (krene) at the platea × avenue crossing, with the prytaneion (civic hearth) behind it
//   C  Gymnasium on the avenue: Doric palaestra + ephebeion + propylon, grove, seat-steps, xystos and paradromis
//   D  Bouleuterion (council house) on the avenue just north of the agora
//   E  Sanctuary of Aphrodite and Hermes with the Salmakis spring, terraced into the west promontory
// POI ry convention: a person at (x, z) faces (sin ry, cos ry), like a figure rotated by ry.
import * as THREE from 'three';
import { Bucket, ColorBucket, box, lathe, rectSweep, tubeY, bone, ellipsoid, mat, rng, lerp, clamp, TAU, scaleUV } from '../util.js';
import { terrainHeight as TH, SEA } from '../terrain.js';
import { figureGeometry, lionGeometry } from '../sculpture.js';

export const name = 'civic';
const OWNER = 'civic';
const LION = 0xd6ccb8;
const PAINT = { red: 0x86392b, blue: 0x3a4a66, dark: 0x2a2e38, ochre: 0xa8834c, ash: 0x4a423c, ember: 0x6a2a14, bronze: 0x8a6a3e, gilt: 0xb0914f, sky: 0x4a5d7c, oxblood: 0x74362c };

function sites(L) {
  const u = (a, b) => ({ minX: Math.min(a.minX, b.minX), maxX: Math.max(a.maxX, b.maxX), minZ: Math.min(a.minZ, b.minZ), maxZ: Math.max(a.maxZ, b.maxZ) });
  return {
    apollo: u(L.blockRect(-9, -1), L.blockRect(-8, -1)),     // x -257.5..-172.5, z 6.5..56
    krene: L.blockRect(0, -1),                                // x 151..187.5,     z 6.5..56
    gym: u(L.blockRect(-2, 2), L.blockRect(-1, 2)),           // x 57.5..139,      z 186.5..241.5
    boule: L.blockRect(-1, 4),                                // x 102.5..139,     z 306.5..361.5
    // the promontory site leaves the x = -440 grid line free, so the street graph still reaches the spring from the town
    // the approach tracks from the town are reserved too (no olive grows on them), but never within 0.5 m of the x = -440 centre line
    salmakisWay: [{ minX: -442.4, maxX: -440.6, minZ: 486.5, maxZ: 539 }, { minX: -444.2, maxX: -441.5, minZ: 522, maxZ: 539 }, { minX: -439.4, maxX: -432.8, minZ: 522, maxZ: 533.5 }, { minX: -435.8, maxX: -427.3, minZ: 530, maxZ: 539 }, { minX: -431, maxX: -427.5, minZ: 555, maxZ: 559.5 }],
    salmakis: [{ minX: -483.5, maxX: -443.8, minZ: 522, maxZ: 568 }, { minX: -443.8, maxX: -440.7, minZ: 539, maxZ: 568 }, { minX: -439.3, maxX: -427, minZ: 539, maxZ: 555 }, { minX: -439.3, maxX: -400, minZ: 559.5, maxZ: 568 }, { minX: -405, maxX: -400, minZ: 568, maxZ: 585 }],
  };
}

export function plan(ctx) {
  const S = sites(ctx.layout);
  ctx.layout.reserve(S.apollo, OWNER, 'sanctuary of Apollo');
  ctx.layout.reserve(S.krene, OWNER, 'krene + prytaneion');
  ctx.layout.reserve(S.gym, OWNER, 'gymnasium');
  ctx.layout.reserve(S.boule, OWNER, 'bouleuterion');
  for (const r of S.salmakis) ctx.layout.reserve(r, OWNER, 'sanctuary of Aphrodite and Hermes, Salmakis spring');
  for (const r of S.salmakisWay) ctx.layout.reserve(r, OWNER, 'the way to the Salmakis sanctuary');
}

// ---------- terrain sampling ----------
function tStat(r, fn, st = 2) {
  const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / st)), nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / st));
  let v = fn === Math.max ? -Infinity : Infinity;
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) v = fn(v, TH(r.minX + (r.maxX - r.minX) * i / nx, r.minZ + (r.maxZ - r.minZ) * j / nz));
  return v;
}
const tMax = r => tStat(r, Math.max), tMin = r => tStat(r, Math.min);
// height of the rendered terrain mesh (terrain.js buildTerrainMesh defaults: 3400 m, 420 segments, cubic warp, quads split b–c),
// so a track draped on it neither sinks into nor floats over the visible ground between the mesh's ~9 m vertices
const meshH = (() => {
  const size = 3400, segs = 420, H = size / 2, warp = t => H * (0.13 * t + 0.87 * t * t * t);
  const inv = x => { let t = Math.sign(x) * Math.min(1, Math.cbrt(Math.abs(x) / (H * 0.87))); for (let k = 0; k < 8; k++) t -= (warp(t) - x) / (H * (0.13 + 2.61 * t * t)); return t; };
  const g = k => warp(k / segs * 2 - 1);
  return (x, z) => {
    const i = Math.floor((inv(x) + 1) / 2 * segs), j = Math.floor((inv(z) + 1) / 2 * segs), x0 = g(i), x1 = g(i + 1), z0 = g(j), z1 = g(j + 1), u = (x - x0) / (x1 - x0), v = (z - z0) / (z1 - z0);
    const ha = TH(x0, z0), hb = TH(x1, z0), hc = TH(x0, z1), hd = TH(x1, z1);
    return u + v <= 1 ? ha + u * (hb - ha) + v * (hc - ha) : hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
  };
})();

// ---------- geometry kit ----------
const cache = new Map();
const cached = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

function doricGeo(h, r) {
  return cached(`doric${h}_${r}`, () => {
    const b = new Bucket(), capH = r * 0.9, sh = h - capH, rt = r * 0.8;
    b.add(tubeY(4, 40, (i, j, t, a) => { const R0 = lerp(r, rt, t) * (1 + 0.025 * Math.sin(Math.PI * t)), f = j % 2 ? 0.95 : 1; return [Math.cos(a) * R0 * f, t * sh, -Math.sin(a) * R0 * f]; }, 2, sh));
    b.add(lathe([[rt * 0.97, 0], [rt, capH * 0.15], [r * 1.18, capH * 0.5], [r * 1.28, capH * 0.6]], 20), mat(0, sh, 0));
    b.add(box(r * 2.7, capH * 0.4, r * 2.7), mat(0, sh + capH * 0.8, 0));
    return b.build();
  });
}
class SpiralCurve extends THREE.Curve {
  constructor(r0, turns, dir) { super(); this.r0 = r0; this.turns = turns; this.dir = dir; this.k = Math.log(1 / 0.16) / (turns * TAU); }
  getPoint(t, v = new THREE.Vector3()) { const th = t * this.turns * TAU, r = this.r0 * Math.exp(-this.k * th), a = Math.PI / 2 + this.dir * th; return v.set(Math.cos(a) * r, Math.sin(a) * r, 0); }
}
function ionicGeo(h, r) {
  return cached(`ionic${h}_${r}`, () => {
    const mb = new Bucket(), eg = new Bucket();
    const bh = r * 0.95, ch = r * 1.1, sh = h - bh - ch, rt = r * 0.85;
    mb.add(box(r * 2.5, r * 0.22, r * 2.5), mat(0, r * 0.11, 0));
    mb.add(lathe([[r * 1.2, r * 0.22], [r * 1.24, r * 0.36], [r * 1.12, r * 0.48], [r * 1.02, r * 0.56], [r * 1.14, r * 0.68], [r * 1.12, r * 0.8], [r * 1.0, bh]], 16));
    mb.add(tubeY(4, 60, (i, j, t, a) => { const R0 = lerp(r, rt, t) * (1 + 0.015 * Math.sin(Math.PI * t)), f = j % 3 === 1 ? 0.93 : 1; return [Math.cos(a) * R0 * f, bh + t * sh, -Math.sin(a) * R0 * f]; }, 2, sh));
    const y0 = bh + sh;
    eg.add(lathe([[rt * 0.98, 0], [rt * 1.14, ch * 0.2], [rt * 1.24, ch * 0.36]], 16), mat(0, y0, 0));
    const vx = rt * 1.2, vr = ch * 0.36, vy = y0 + ch * 0.44, L = rt * 2.0;
    mb.add(box(vx * 2, vr * 1.05, L - 0.02), mat(0, vy + vr * 0.45, 0));
    for (const sx of [-1, 1]) mb.add(new THREE.CylinderGeometry(vr, vr, L, 12, 1, true).rotateX(Math.PI / 2), mat(sx * vx, vy, 0));
    const disc = new THREE.CircleGeometry(vr, 12);
    const sp = [1, -1].map(dir => new THREE.TubeGeometry(new SpiralCurve(vr * 0.9, 2.2, dir), 36, vr * 0.07, 4, false));
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const m = mat(sx * vx, vy, sz * L / 2, 0, sz < 0 ? Math.PI : 0, 0);
      mb.add(disc, m); mb.add(sp[sx * sz > 0 ? 1 : 0], m.clone().multiply(mat(0, 0, 0.012)));
      mb.add(new THREE.SphereGeometry(vr * 0.16, 6, 4), m.clone().multiply(mat(0, 0, 0.01)));
    }
    mb.add(box(vx * 2 + vr * 1.4, ch * 0.14, L + 0.06), mat(0, h - ch * 0.07, 0));
    return { marble: mb.build(), egg: eg.build() };
  });
}
// gable roof, ridge along z, eaves at y=0 and x=±half
function gableZ(len, half, apex, th = 0.16) {
  const Ls = Math.hypot(half, apex), b = new Bucket();
  for (const s of [-1, 1]) b.add(box(len, th, Ls + 0.06), mat(0, apex / 2 + th / 2, s * half / 2, s * Math.atan2(apex, half), 0, 0));
  return b.build().rotateY(Math.PI / 2);
}
// single-pitch roof slab: from (z0, y0) to (z1, y1), x ∈ ±len/2
function leanRoof(len, z0, y0, z1, y1, th = 0.16) {
  const L = Math.hypot(z1 - z0, y1 - y0);
  return box(len, th, L).applyMatrix4(mat(0, (y0 + y1) / 2 + th / 2, (z0 + z1) / 2, -Math.atan2(y1 - y0, z1 - z0), 0, 0));
}
const triGeo = (half, apex, depth) => new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0), new THREE.Vector2(0, apex)]), { depth, bevelEnabled: false });
const acroGeo = () => cached('acro', () => lathe([[0.02, 0], [0.3, 0.06], [0.22, 0.2], [0.34, 0.5], [0.2, 0.85], [0.06, 1.05], [0.01, 1.1]], 8));
const jarGeo = () => cached('jar', () => lathe([[0.01, 0], [0.12, 0.02], [0.2, 0.18], [0.23, 0.36], [0.16, 0.55], [0.08, 0.62], [0.09, 0.7], [0.07, 0.72]], 10));
// lion-head spout facing +z (stone part): a ruff of broad, flat, swirling flame locks, a furrowed brow over slit eyes, a nose
// bridge sloping down to a flat nose, heavy jowls over the open mouth; mouth centre at (0, -0.083, 0.36)
const lionHeadGeo = () => cached('lionhead', () => {
  const b = new Bucket(), lock = new THREE.ConeGeometry(0.085, 0.085, 4).scale(1, 1, 0.3), lockS = new THREE.ConeGeometry(0.066, 0.068, 4).scale(1, 1, 0.35);
  b.add(ellipsoid(0.165, 0.175, 0.045, 12, 6), mat(0, 0.005, 0.03));
  for (let k = 0; k < 10; k++) { const a = (k + 0.5) / 10 * TAU, r = 0.15 + 0.012 * (k % 2); b.add(lock, mat(Math.cos(a) * r, Math.sin(a) * r * 1.05, 0.045, 0, 0, a - Math.PI / 2 + 0.4)); }
  for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; b.add(lockS, mat(Math.cos(a) * 0.12, Math.sin(a) * 0.126, 0.075, 0, 0, a - Math.PI / 2 + 0.4).multiply(mat(0, 0, 0, -0.35, 0, 0))); }
  b.add(ellipsoid(0.105, 0.115, 0.09, 10, 7), mat(0, 0.02, 0.13));                                          // skull
  for (const s of [-1, 1]) {
    b.add(ellipsoid(0.058, 0.022, 0.045, 8, 4), mat(s * 0.045, 0.068, 0.205, 0, s * 0.2, s * 0.35));    // brow ridges, low toward the nose
    b.add(ellipsoid(0.052, 0.055, 0.05, 8, 5), mat(s * 0.062, -0.03, 0.2));                              // cheeks
    b.add(ellipsoid(0.048, 0.032, 0.065, 8, 4), mat(s * 0.036, -0.058, 0.3, 0.15, 0, 0));                // heavy jowls over the mouth
    b.add(new THREE.ConeGeometry(0.026, 0.05, 4).scale(1, 1, 0.6), mat(s * 0.082, 0.118, 0.11, 0, 0, -s * 0.5));   // ears in the ruff
  }
  b.add(ellipsoid(0.042, 0.034, 0.1, 8, 5), mat(0, 0.02, 0.26, 0.3, 0, 0));                                 // nose bridge sloping down
  b.add(ellipsoid(0.04, 0.02, 0.028, 6, 3), mat(0, -0.012, 0.345));                                         // flat nose
  b.add(ellipsoid(0.04, 0.02, 0.045, 8, 4), mat(0, -0.12, 0.29));                                           // lower jaw
  return b.build();
});
const lionMouthGeo = () => cached('lionmouth', () => { const b = new Bucket(); b.add(ellipsoid(0.042, 0.024, 0.04, 8, 4), mat(0, -0.088, 0.335)); for (const s of [-1, 1]) b.add(ellipsoid(0.02, 0.008, 0.01, 5, 3), mat(s * 0.042, 0.048, 0.232, 0, 0, s * 0.3)); return b.build(); });
// a falling jet of water from the origin, leaving along +z at speed v, dropping h
class JetCurve extends THREE.Curve {
  constructor(v, h) { super(); this.v = v; this.T = Math.sqrt(h / 4.9); }
  getPoint(t, o = new THREE.Vector3()) { const T = t * this.T; return o.set(0, -4.9 * T * T, this.v * T); }
}
const jetGeo = (v, h, r) => cached(`jet${v}_${h.toFixed(2)}_${r}`, () => new THREE.TubeGeometry(new JetCurve(v, h), 10, r, 5, false));
const hermGeo = () => cached('herm', () => {
  const b = new Bucket();
  b.add(box(0.36, 1.35, 0.3), mat(0, 0.675, 0)); b.add(box(0.42, 0.08, 0.36), mat(0, 1.39, 0));
  for (const s of [-1, 1]) b.add(box(0.1, 0.1, 0.1), mat(s * 0.23, 1.25, 0));
  b.add(ellipsoid(0.1, 0.13, 0.11, 10, 8), mat(0, 1.62, 0)); b.add(ellipsoid(0.08, 0.1, 0.06, 8, 6), mat(0, 1.52, 0.07)); b.add(ellipsoid(0.11, 0.06, 0.11, 10, 5), mat(0, 1.7, -0.01));
  return b.build();
});
const basinGeo = () => cached('louterion', () => { const b = new Bucket(); b.add(lathe([[0.3, 0], [0.12, 0.1], [0.1, 0.75], [0.16, 0.8], [0.55, 0.92], [0.62, 1.0], [0.58, 1.02], [0.05, 0.9]], 14)); return b.build(); });
function treeGeo(R, H, crown, cards) {
  const trunk = new Bucket(), leaves = new Bucket(), ph = R() * TAU, lean = (R() - 0.5) * 0.5;
  trunk.add(tubeY(5, 7, (i, j, t, a) => { const r = lerp(0.2 + H * 0.02, 0.09, t) * (1 + 0.15 * Math.sin(3 * a + ph)); return [Math.cos(a) * r + lean * t, t * H, -Math.sin(a) * r]; }, 1, H));
  for (let b = 0; b < 4; b++) { const a = b / 4 * TAU + R(); trunk.add(bone([lean, H * 0.95, 0], [lean + Math.cos(a) * crown * 0.55, H + crown * 0.45, -Math.sin(a) * crown * 0.55], 0.06 + H * 0.005)); }
  const card = new THREE.PlaneGeometry(1.7, 1.7);
  for (let i = 0; i < cards; i++) {
    let px, py, pz; do { px = R() * 2 - 1; py = R() * 2 - 1; pz = R() * 2 - 1; } while (px * px + py * py + pz * pz > 1);
    leaves.add(card, mat(lean + px * crown, H + crown * 0.5 + py * crown * 0.62, pz * crown, R() * TAU, R() * TAU, R() * TAU));
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}

// ---------- build ----------
export function build(ctx) {
  const { M, world, layout, B, G } = ctx;
  const R = rng(35711);
  const own = { painted: new ColorBucket(), terra: new ColorBucket(), leaf: new ColorBucket(), water: new Bucket(), bark: new Bucket(), stream: new Bucket() };
  const addTo = (b, g, m, color) => { if (b instanceof ColorBucket) b.add(g, m, color ?? 0xe6dccb); else b.add(g, m); };
  const figs = [
    figureGeometry({ seed: 301, draped: 'full' }), figureGeometry({ seed: 302, draped: 'short', spear: true }), figureGeometry({ seed: 303, draped: 'full', female: true }),
    figureGeometry({ seed: 304, draped: 'none' }), figureGeometry({ seed: 305, draped: 'full', female: true, pose: 'restDown' }), figureGeometry({ seed: 306, draped: 'none', spear: true, shield: true }),
  ];
  const lion = lionGeometry({ seed: 3 });
  const trees = [0, 1, 2, 3].map(i => treeGeo(rng(900 + i), 3.2 + i * 0.4, 2.2 + (i % 2) * 0.5, 40));
  const planeTrees = [0, 1].map(i => treeGeo(rng(950 + i), 4.8 + i * 0.6, 4.2, 80));

  // A site collects its walkable floors into one extraGround function (bounding-box tested first).
  const site = (nm) => {
    const s = { nm, grounds: [], bb: { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity } };
    s.ground = (r, y) => { s.grounds.push({ ...r, y }); const b = s.bb; b.minX = Math.min(b.minX, r.minX); b.maxX = Math.max(b.maxX, r.maxX); b.minZ = Math.min(b.minZ, r.minZ); b.maxZ = Math.max(b.maxZ, r.maxZ); };
    s.commit = () => {
      const gs = s.grounds, b = s.bb;
      world.extraGround.push((x, z) => {
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return -Infinity;
        let h = -Infinity;
        for (const g of gs) if (x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ) { const v = typeof g.y === 'number' ? g.y : g.y(x, z); if (v > h) h = v; }
        return h;
      });
    };
    return s;
  };
  // Axis-aligned local frame: local +z is the building's front; ry is a multiple of π/2.
  const frame = (S, cx, cy, cz, ry = 0) => {
    const c = Math.round(Math.cos(ry)), sn = Math.round(Math.sin(ry)), base = mat(cx, cy, cz, 0, ry, 0);
    const F = {
      cx, cy, cz, ry, S,
      m: (x = 0, y = 0, z = 0, rx = 0, ryy = 0, rz = 0, sc = 1) => base.clone().multiply(mat(x, y, z, rx, ryy, rz, sc)),
      w: (lx, lz) => [cx + c * lx + sn * lz, cz - sn * lx + c * lz],
      l: (x, z) => { const dx = x - cx, dz = z - cz; return [c * dx - sn * dz, sn * dx + c * dz]; },
      rect(x0, x1, z0, z1) { const a = F.w(x0, z0), b = F.w(x1, z1); return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[1], b[1]), maxZ: Math.max(a[1], b[1]) }; },
      col(x0, x1, z0, z1) { world.colliders.push(F.rect(x0, x1, z0, z1)); },
      gnd(x0, x1, z0, z1, y) { S.ground(F.rect(x0, x1, z0, z1), typeof y === 'number' ? cy + y : (x, z) => { const [lx, lz] = F.l(x, z); return cy + y(lx, lz); }); },
      tmin: (x0, x1, z0, z1) => tMin(F.rect(x0, x1, z0, z1)) - cy,
      tmax: (x0, x1, z0, z1) => tMax(F.rect(x0, x1, z0, z1)) - cy,
      t: (lx, lz) => { const [x, z] = F.w(lx, lz); return TH(x, z) - cy; },
      add: (b, g, m, color) => addTo(b, g, m, color),
      blk(b, x0, x1, y0, y1, z0, z1, color) { addTo(b, box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), F.m((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color); },
      plane(b, x0, x1, z0, z1, y, color) { const w = Math.abs(x1 - x0), d = Math.abs(z1 - z0); addTo(b, scaleUV(new THREE.PlaneGeometry(w, d), b === own.water ? w / 3 : w, b === own.water ? d / 3 : d).rotateX(-Math.PI / 2), F.m((x0 + x1) / 2, y, (z0 + z1) / 2), color); },
      sub: (lx, ly, lz, dry = 0) => { const [x, z] = F.w(lx, lz); return frame(S, x, cy + ly, z, ry + dry); },
      poi(type, lx, lz, ly, lry, extra = {}) { const [x, z] = F.w(lx, lz); return layout.addPoi({ type, x, z, y: cy + ly, ry: lry === undefined ? undefined : ry + lry, owner: OWNER, ...extra }); },
      spot(lx, lz, lry) { const [x, z] = F.w(lx, lz); return { x, z, ry: ry + lry }; },
      area(nm, x0, x1, z0, z1, ly) { return layout.addArea({ name: nm, ...F.rect(x0, x1, z0, z1), y: cy + ly, owner: OWNER }); },
    };
    return F;
  };
  // flight of n steps climbing from z = zb (ground yb) to z = zt (landing yt), x ∈ [x0, x1]
  const stairs = (F, b, x0, x1, zb, zt, yb, yt, n, deep = 0.8) => {
    const rise = (yt - yb) / n, tread = (zt - zb) / n;
    for (let i = 0; i < n; i++) F.blk(b, x0, x1, yb - deep, yb + rise * (i + 1), zb + tread * i, zb + tread * (i + 1));
    F.gnd(x0, x1, Math.min(zb, zt), Math.max(zb, zt), (lx, lz) => yb + rise * clamp(Math.floor((lz - zb) / tread) + 1, 1, n));
  };
  // Doric column row helper
  const doricCol = (F, x, y, z, h, r, collide = true) => { F.add(B.marble, doricGeo(h, r), F.m(x, y, z)); if (collide) F.col(x - r - 0.08, x + r + 0.08, z - r - 0.08, z + r + 0.08); };
  const ionicCol = (F, x, y, z, h, r, collide = true, rot = 0) => { const g = ionicGeo(h, r); F.add(B.marble, g.marble, F.m(x, y, z, 0, rot, 0)); F.add(B.egg, g.egg, F.m(x, y, z, 0, rot, 0)); if (collide) F.col(x - r - 0.08, x + r + 0.08, z - r - 0.08, z + r + 0.08); };
  // Doric entablature along local x at zc: architrave, frieze with painted triglyphs on the given faces, cornice. Returns top y.
  const doricRun = (F, x0, x1, zc, y, depth, tri, faces, sc = 1) => {
    const aH = 0.45 * sc, fH = 0.5 * sc, cH = 0.18 * sc, d2 = depth / 2;
    F.blk(B.marble, x0, x1, y, y + aH, zc - d2, zc + d2);
    F.blk(B.marble, x0, x1, y + aH, y + aH + fH, zc - d2 + 0.05, zc + d2 - 0.05);
    F.blk(B.marble, x0 - 0.2 * sc, x1 + 0.2 * sc, y + aH + fH, y + aH + fH + cH, zc - d2 - 0.22 * sc, zc + d2 + 0.22 * sc);
    for (const s of faces) {
      const zf = zc + s * d2;
      F.blk(own.painted, x0, x1, y + aH - 0.06 * sc, y + aH, zf, zf + s * 0.03, PAINT.red);
      for (const x of tri) F.blk(own.painted, Math.max(x0, x - 0.19 * sc), Math.min(x1, x + 0.19 * sc), y + aH, y + aH + fH, zf - s * 0.05, zf + s * 0.03, PAINT.dark);
      F.blk(own.painted, x0 - 0.2 * sc, x1 + 0.2 * sc, y + aH + fH - 0.001, y + aH + fH + 0.05 * sc, zf + s * 0.2 * sc, zf + s * 0.23 * sc, PAINT.blue);
    }
    return y + aH + fH + cH;
  };
  const triPos = (xs, x0, x1) => { const out = [x0 + 0.19]; for (let i = 0; i < xs.length; i++) { out.push(xs[i]); if (i < xs.length - 1) out.push((xs[i] + xs[i + 1]) / 2); } out.push(x1 - 0.19); return out; };
  // gabled roof with pediments over x ∈ [x0,x1], z ∈ [z0,z1], eaves at y
  const pedRoof = (F, o) => {
    const { x0, x1, z0, z1, y, pitch = 0.27, over = 0.4, color = 0xb8714a, front = true, back = true, tymp = null } = o;
    const xm = (x0 + x1) / 2, half = (x1 - x0) / 2 + over, apex = half * pitch, Ls = Math.hypot(half, apex);
    F.add(B.roofs, gableZ(z1 - z0 + 2 * over, half, apex), F.m(xm, y, (z0 + z1) / 2), color);
    const ht = (x1 - x0) / 2 - 0.05, at = ht * pitch;
    for (const [s, on] of [[1, front], [-1, back]]) {
      if (!on) continue;
      const zt = s > 0 ? z1 - 0.1 - 0.35 : z0 + 0.1, ze = s > 0 ? z1 + over : z0 - over;
      F.add(tymp ? own.painted : B.marble, triGeo(ht, at, 0.35), F.m(xm, y, zt), tymp);
      for (const sx of [-1, 1]) F.add(B.marble, box(Ls + 0.15, 0.28, 0.62), F.m(xm + sx * half / 2, y + apex / 2 + 0.12, ze - s * 0.28, 0, 0, -sx * Math.atan2(apex, half)));
      F.add(B.marble, acroGeo(), F.m(xm, y + apex + 0.2, ze - s * 0.3, 0, 0, 0, Math.min(1.2, half * 0.14)));
      for (const sx of [-1, 1]) F.add(B.marble, acroGeo(), F.m(xm + sx * (half - 0.25), y + 0.1, ze - s * 0.3, 0, 0, 0, Math.min(0.8, half * 0.09)));
    }
    return { apex, half, ht, at };
  };
  const statueOn = (F, lx, lz, ly, lry, fig, sc = 1, baseH = 1.5, collide = true) => {
    F.add(B.marble, rectSweep(1.1 * sc, 1.1 * sc, [{ o: 0.18, y: 0 }, { o: 0.18, y: 0.18, hard: true }, { o: 0, y: 0.32, hard: true }, { o: 0, y: baseH - 0.14, hard: true }, { o: 0.1, y: baseH - 0.06 }, { o: 0.14, y: baseH, hard: true }], { top: true }), F.m(lx, ly, lz));
    F.add(B.statue, fig, F.m(lx, ly + baseH, lz, 0, lry, 0, sc));
    if (collide) F.col(lx - 0.75 * sc, lx + 0.75 * sc, lz - 0.75 * sc, lz + 0.75 * sc);
  };
  const tree = (F, lx, lz, ly, sc, geo, tint, collide = true) => {
    const m = F.m(lx, ly - 0.1, lz, 0, R() * TAU, 0, sc);
    own.bark.add(geo.trunk, m); own.leaf.add(geo.leaves, m, tint);
    if (collide) F.col(lx - 0.45 * sc, lx + 0.45 * sc, lz - 0.45 * sc, lz + 0.45 * sc);
  };
  const jar = (F, lx, lz, ly, sc = 1, tilt = 0) => F.add(own.terra, jarGeo(), F.m(lx, ly, lz, tilt, R() * TAU, 0, sc), [0xb86d44, 0xa45c3a, 0xc07a50][Math.floor(R() * 3)]);
  // lion-head spout on a wall face (head faces local +z) with a bronze pipe, an arcing jet and a splash ring on the water at yw
  const spout = (F, lx, ly, lz, sc, yw, v = 0.7, head = true) => {
    const m = F.m(lx, ly, lz, 0, 0, 0, sc);
    if (head) { own.terra.add(lionHeadGeo(), m, LION); own.painted.add(lionMouthGeo(), m, PAINT.dark); }
    const my = ly - 0.083 * sc, mz = lz + 0.36 * sc, h = my - yw, T = Math.sqrt(h / 4.9);
    own.painted.add(new THREE.CylinderGeometry(0.018, 0.022, 0.1, 6).rotateX(Math.PI / 2), F.m(lx, my, mz + 0.05), PAINT.bronze);
    own.stream.add(jetGeo(v, h, 0.024), F.m(lx, my, mz + 0.1));
    own.stream.add(new THREE.TorusGeometry(0.1, 0.018, 4, 10).rotateX(Math.PI / 2), F.m(lx, yw + 0.012, mz + 0.1 + v * T));
    own.stream.add(new THREE.CircleGeometry(0.075, 8).rotateX(-Math.PI / 2), F.m(lx, yw + 0.008, mz + 0.1 + v * T));
  };
  // door leaf hinged at local (hx, hz): closed it spans toward -sx; opened by a it swings toward sz. Collides.
  const doorLeaf = (F, hx, hz, w, h, y0, a, sx, sz) => {
    const dx = -sx * Math.cos(a), dz = sz * Math.sin(a), ex = hx + dx * w, ez = hz + dz * w, ry = Math.atan2(-dz, dx), cx = hx + dx * w / 2, cz = hz + dz * w / 2;
    F.add(B.woodDark, box(w, h, 0.09), F.m(cx, y0 + h / 2, cz, 0, ry, 0));
    for (const y of [0.18, h * 0.52, h - 0.18]) F.add(B.woodDark, box(w - 0.04, 0.12, 0.13), F.m(cx, y0 + y, cz, 0, ry, 0));
    F.col(Math.min(hx, ex) - 0.06, Math.max(hx, ex) + 0.06, Math.min(hz, ez) - 0.06, Math.max(hz, ez) + 0.06);
  };
  // exedra: half-ring wall and one continuous bench from angle a0 to a0+π (x = cos a, z = sin a), collided in 12 sectors, seats every 30°
  const exedra = (F, ex, ey, ez, rB, rW, rO, H, a0, note) => {
    const ph = -Math.PI / 2 - a0;
    F.add(B.marble, lathe([[rO, 0], [rO, H], [rO + 0.06, H], [rO + 0.06, H + 0.1], [rW - 0.06, H + 0.1], [rW - 0.06, H], [rW, H], [rW, 0]], 18, ph, Math.PI), F.m(ex, ey, ez));
    F.add(B.marble, lathe([[rW, 0.45], [rB - 0.06, 0.45], [rB - 0.06, 0.37], [rB, 0.33], [rB, 0]], 18, ph, Math.PI), F.m(ex, ey, ez));
    for (const a of [a0, a0 + Math.PI]) { F.add(B.marble, box(rO - rB + 0.12, 0.7, 0.3), F.m(ex + Math.cos(a) * (rO + rB) / 2, ey + 0.35, ez + Math.sin(a) * (rO + rB) / 2, 0, -a, 0)); F.add(B.marble, box(rO - rW + 0.12, H + 0.1, 0.3), F.m(ex + Math.cos(a) * (rO + rW) / 2, ey + (H + 0.1) / 2, ez + Math.sin(a) * (rO + rW) / 2, 0, -a, 0)); }
    const r0 = rB + 0.05;
    for (let i = 0; i < 12; i++) { const xs = [], zs = []; for (const a of [a0 + i / 12 * Math.PI, a0 + (i + 1) / 12 * Math.PI]) for (const r of [r0, rO]) { xs.push(ex + Math.cos(a) * r); zs.push(ez + Math.sin(a) * r); } F.col(Math.min(...xs) - 0.02, Math.max(...xs) + 0.02, Math.min(...zs) - 0.02, Math.max(...zs) + 0.02); }
    for (let k = 1; k < 6; k++) { const a = a0 + k / 6 * Math.PI, rs = (rB + rW) / 2; F.poi('seat', ex + Math.cos(a) * rs, ez + Math.sin(a) * rs, ey + 0.45, Math.atan2(-Math.cos(a), -Math.sin(a)), { note }); }
  };
  // generic lean-to stoa in frame Fs (front +z): floor at y 0.3, back wall at z=-depth/2
  const stoa = (Fs, o) => {
    const { len, depth, colH, colR, wallTop, backWall = true, floor = B.pave, benches = true } = o, L2 = len / 2, D2 = depth / 2;
    const yb = Fs.tmin(-L2, L2, -D2, D2) - 0.6, st = 0.3;
    Fs.blk(B.socles, -L2 + 0.03, L2 - 0.03, Math.min(yb, -0.5), st, -D2 + 0.03, D2 + 0.25);
    Fs.plane(floor, -L2 + 0.8, L2 - 0.8, -D2 + 0.9, D2 + 0.25, st + 0.012);
    if (backWall) { Fs.blk(B.ashlar, -L2, L2, yb, 1.2, -D2, -D2 + 0.9); Fs.blk(B.walls, -L2 + 0.02, L2 - 0.02, 1.2, wallTop, -D2 + 0.05, -D2 + 0.85, 0xe9dfcc); Fs.col(-L2, L2, -D2, -D2 + 0.9); }
    if (backWall && o.pilasters) {   // the street face of the back wall: buttress pilasters, a marble string course at the ashlar joint, a painted band under the eaves
      const f = -D2, n = Math.max(2, Math.round(len / 9));
      Fs.blk(B.marble, -L2 + 0.02, L2 - 0.02, 1.08, 1.3, f - 0.1, f + 0.1);
      Fs.blk(own.painted, -L2 + 0.02, L2 - 0.02, wallTop - 0.72, wallTop - 0.32, f + 0.02, f + 0.05, PAINT.oxblood); Fs.blk(own.painted, -L2 + 0.02, L2 - 0.02, wallTop - 0.8, wallTop - 0.74, f + 0.02, f + 0.05, PAINT.ochre);
      for (let i = 0; i < n; i++) {
        const x = -L2 + len * (i + 0.5) / n;
        Fs.blk(B.ashlar, x - 0.5, x + 0.5, yb, 1.08, f - 0.25, f + 0.05); Fs.col(x - 0.5, x + 0.5, f - 0.25, f);
        Fs.blk(B.walls, x - 0.36, x + 0.36, 1.3, wallTop - 0.45, f - 0.08, f + 0.1, 0xeee4d0); Fs.blk(B.marble, x - 0.45, x + 0.45, wallTop - 0.45, wallTop - 0.25, f - 0.16, f + 0.1);
      }
    }
    for (const s of [-1, 1]) { Fs.blk(B.walls, s * (L2 - 0.8), s * L2, st, wallTop, -D2 + 0.9, D2 - 0.9, 0xe6dac4); Fs.col(Math.min(s * (L2 - 0.8), s * L2), Math.max(s * (L2 - 0.8), s * L2), -D2, D2 - 0.9); }
    const n = Math.max(2, Math.round((len - 2.4) / 2.7) + 1), xs = [];
    for (let i = 0; i < n; i++) xs.push(-L2 + 1.3 + i * (len - 2.6) / (n - 1));
    for (const x of xs) doricCol(Fs, x, st, D2 - 0.55, colH, colR);
    const top = doricRun(Fs, -L2, L2, D2 - 0.55, st + colH, 0.9, triPos(xs, -L2, L2), [1], colR / 0.38);
    Fs.add(B.roofs, leanRoof(len + 0.6, -D2 - 0.4, wallTop + 0.2, D2 + 0.2, top), Fs.m(0, 0, 0), 0xbd7a50);
    const yC = st + colH + 0.95 * colR / 0.38;   // boarded ceiling on beams, level with the frieze top
    Fs.blk(B.wood, -L2 + 0.8, L2 - 0.8, yC - 0.06, yC, -D2 + 0.9, D2 - 1.0);
    for (const x of xs) Fs.blk(B.woodDark, x - 0.12, x + 0.12, yC - 0.28, yC - 0.06, -D2 + 0.9, D2 - 1.0);
    Fs.gnd(-L2 + 0.8, L2 - 0.8, -D2 + 0.9, D2 + 0.25, st);
    if (benches) for (let x = -L2 + 3; x < L2 - 4; x += 7) { Fs.blk(B.marble, x, x + 3, st, st + 0.45, -D2 + 0.95, -D2 + 1.45); Fs.col(x, x + 3, -D2 + 0.95, -D2 + 1.45); Fs.poi('bench', x + 1.5, -D2 + 1.2, st + 0.45, 0); }
    for (let x = -L2 + 6; x < L2 - 5; x += 12) Fs.poi('gather', x, 0.5, st, undefined, { r: 2, note: 'stoa shade' });
    Fs.area('stoa', -L2 + 1, L2 - 1, -D2 + 1.6, D2 - 1.1, st);
    return { xs, top };
  };

  // Ionic temple in frame F (front +z), stylobate w × d centred at the origin
  const ionicTemple = (F, o) => {
    const { w, d, steps, rise, tread, n, colH, colR, amphi, antaZ, doorZ, backZ, roof, pitch = 0.28, tymp = null, pedFigs = false } = o;
    const sty = steps * rise, hw = w / 2, hd = d / 2, edge = colR * 1.9, s = colR / 0.42;
    for (let i = 0; i < steps; i++) {
      const ex = tread * (steps - i);
      F.blk(B.grey, -hw - ex, hw + ex, i === 0 ? -1.2 : rise * i, rise * (i + 1), -hd - ex, hd + ex);
      F.gnd(-hw - ex, hw + ex, -hd - ex, hd + ex, rise * (i + 1));
    }
    const xs = []; for (let i = 0; i < n; i++) xs.push(-(hw - edge) + i * 2 * (hw - edge) / (n - 1));
    const zF = hd - edge;
    for (const z of amphi ? [zF, -zF] : [zF]) for (const x of xs) ionicCol(F, x, sty, z, colH, colR);
    // cella
    const xeW = hw - edge + colR * 0.86, t = 0.6 * s, top = sty + colH, zBackEnd = amphi ? -antaZ : -hd + 0.35, dw = 2.4 * s, dh = colH * 0.7;
    o.cellaX = xeW; const cellaX = xeW;
    for (const sx of [-1, 1]) { F.blk(B.marble, sx * (cellaX - t), sx * cellaX, sty, top, zBackEnd, antaZ); F.blk(B.marble, sx * (cellaX - t), sx * (cellaX - 0.03), top - 0.01, top + 0.7 * s, zBackEnd, antaZ); }
    F.blk(B.marble, -cellaX + t, -dw / 2, sty, top, doorZ - t / 2, doorZ + t / 2); F.blk(B.marble, dw / 2, cellaX - t, sty, top, doorZ - t / 2, doorZ + t / 2);
    F.blk(B.marble, -dw / 2, dw / 2, sty + dh, top, doorZ - t / 2, doorZ + t / 2); F.blk(B.marble, -cellaX + t, cellaX - t, top, top + 0.7 * s, doorZ - t / 2, doorZ + t / 2);
    F.blk(B.doors, -dw / 2, dw / 2, sty, sty + dh, doorZ - 0.15, doorZ + 0.15);
    for (const sx of [-1, 1]) F.blk(B.marble, sx * dw / 2, sx * (dw / 2 + 0.3 * s), sty, sty + dh + 0.3 * s, doorZ + t / 2, doorZ + t / 2 + 0.08);
    F.blk(B.marble, -dw / 2 - 0.5 * s, dw / 2 + 0.5 * s, sty + dh + 0.3 * s, sty + dh + 0.6 * s, doorZ + t / 2, doorZ + t / 2 + 0.14);
    if (amphi) F.blk(B.marble, -cellaX + t, cellaX - t, sty, top + 0.7 * s, backZ - t / 2, backZ + t / 2);
    else F.blk(B.marble, -cellaX, cellaX, sty, top, zBackEnd, zBackEnd + t);
    for (const zz of amphi ? [antaZ, -antaZ] : [antaZ]) for (const sx of [-1, 1]) F.blk(B.marble, sx * (cellaX - t - 0.08), sx * (cellaX + 0.08), top - 0.35 * s, top, zz - Math.sign(zz) * 0.9, zz + Math.sign(zz) * 0.08);
    F.col(-cellaX, cellaX, zBackEnd, antaZ);
    // entablature (swept Ionic profile), dentils, porch ceilings
    const xe = xeW, zFront = zF + colR * 0.86, zBack = amphi ? -zFront : zBackEnd, zc = (zFront + zBack) / 2, D = zFront - zBack, eY = top;
    const P = (pts) => pts.map(([oo, yy, hard = true]) => ({ o: oo * s, y: eY + yy * s, hard }));
    F.add(B.marble, rectSweep(2 * xe, D, P([[0, 0], [0, 0.22], [0.04, 0.22], [0.04, 0.46], [0.08, 0.46], [0.08, 0.68], [0.13, 0.74], [0.06, 0.74], [0.06, 1.28]])), F.m(0, 0, zc));
    F.add(B.egg, rectSweep(2 * xe, D, P([[0.06, 1.28], [0.17, 1.39]])), F.m(0, 0, zc));
    F.add(B.marble, rectSweep(2 * xe, D, P([[0.13, 1.39], [0.13, 1.55], [0.58, 1.55], [0.58, 1.76], [0.63, 1.84, false], [0.68, 1.93]]), { top: true }), F.m(0, 0, zc));
    const dent = box(0.12 * s, 0.14 * s, 0.14 * s), dp = 0.3 * s, dO = 0.13 * s + 0.07 * s;
    for (let x = -xe + 0.2; x <= xe - 0.2; x += dp) for (const sz of [-1, 1]) F.add(B.marble, dent, F.m(x, eY + 1.47 * s, zc + sz * (D / 2 + dO)));
    for (let z = zBack + 0.2; z <= zFront - 0.2; z += dp) for (const sx of [-1, 1]) F.add(B.marble, dent, F.m(sx * (xe + dO), eY + 1.47 * s, z));
    F.blk(B.marble, -xe + 0.05, xe - 0.05, eY + 0.62 * s, eY + 0.74 * s, doorZ + t / 2, zFront - 0.05);
    if (amphi) F.blk(B.marble, -xe + 0.05, xe - 0.05, eY + 0.62 * s, eY + 0.74 * s, zBack + 0.05, backZ - t / 2);
    const eTop = eY + 1.93 * s, over = 0.68 * s, half = xe + over, apex = half * pitch, Ls = Math.hypot(half, apex);
    F.add(B.roofs, gableZ(D + 2 * over, half, apex), F.m(0, eTop, zc), roof);
    const ht = xe + 0.06 * s, at = ht * pitch;
    for (const sz of amphi ? [1, -1] : [1, -1]) {
      const zt = sz > 0 ? zFront + 0.06 * s - 0.4 : zBack - 0.06 * s, ze = sz > 0 ? zFront + over : zBack - over;
      F.add(tymp ? own.painted : B.marble, triGeo(ht, at, 0.4), F.m(0, eTop, zt), tymp);
      for (const sx of [-1, 1]) {
        F.add(B.marble, box(Ls + 0.2, 0.32 * s + 0.05, 0.78 * s), F.m(sx * half / 2, eTop + apex / 2 + 0.13 * s, ze - sz * (0.39 * s - 0.03), 0, 0, -sx * Math.atan2(apex, half)));
        F.add(own.painted, box(Ls + 0.2, 0.08 * s, 0.05), F.m(sx * half / 2, eTop + apex / 2 + 0.2 * s, ze + sz * 0.04, 0, 0, -sx * Math.atan2(apex, half)), PAINT.red);
      }
      F.add(B.marble, acroGeo(), F.m(0, eTop + apex + 0.2 * s, ze - sz * 0.35 * s, 0, 0, 0, 1.3 * s));
      for (const sx of [-1, 1]) F.add(B.marble, acroGeo(), F.m(sx * (half - 0.3 * s), eTop + 0.05, ze - sz * 0.35 * s, 0, 0, 0, 0.8 * s));
      if (pedFigs && sz > 0) {
        const zf = zFront + 0.06 * s + 0.22, yb = eTop + 0.02;
        F.add(B.statue, figs[0], F.m(0, yb, zf, 0, 0, 0, at * 0.86 / 1.8));
        for (const sx of [-1, 1]) {
          F.add(B.statue, figs[sx > 0 ? 2 : 5], F.m(sx * ht * 0.34, yb, zf, 0, -sx * 0.25, 0, at * (1 - 0.34) * 0.86 / 1.8));
          F.add(B.statue, lion, F.m(sx * ht * 0.7, yb, zf, 0, sx > 0 ? Math.PI : 0, 0, at * 0.3 * 0.9 / 1.2));
        }
      }
    }
    F.gnd(-hw, hw, -hd, hd, sty);
    return { sty, top, eTop, apex, zFront, zBack, xe };
  };

  const S = sites(layout);
  buildApollo(S.apollo); buildKrene(S.krene); buildGym(S.gym); buildBoule(S.boule); buildSalmakis();

  // ======================================================================================
  // A  Sanctuary of Apollo: terrace on the platea, gate + grand stair, temple facing south
  // ======================================================================================
  function buildApollo(rect) {
    const Sx = site('apollo'), cx = (rect.minX + rect.maxX) / 2, cz = (rect.minZ + rect.maxZ) / 2, hx = (rect.maxX - rect.minX) / 2, hz = (rect.maxZ - rect.minZ) / 2;
    const LA = tMax(rect) + 0.15, F = frame(Sx, cx, LA, cz, 0), wt = 1.1, top = 2.6;
    const stoaZ0 = -21.8, stoaZ1 = 14.2;
    const par = 1.1;   // the side toward the platea is only a parapet, so the statues and laurels show over it
    const wall = (x0, x1, z0, z1, ew = false, h = top) => {
      F.blk(B.ashlar, x0, x1, F.tmin(x0, x1, z0, z1) - 0.6, h, z0, z1); F.col(x0, x1, z0, z1);
      F.blk(B.marble, x0 - 0.08, x1 + 0.08, h, h + 0.18, ew ? z0 + 0.08 : z0 - 0.08, ew ? z1 - 0.08 : z1 + 0.08);
    };
    // terrace / peribolos
    wall(-hx, -1.5, -hz, -hz + wt); wall(1.5, hx, -hz, -hz + wt);
    wall(-hx + wt, -7.2, hz - wt, hz, false, par); wall(7.2, hx - wt, hz - wt, hz, false, par);
    for (const sx of [-1, 1]) { const a = sx * (hx - wt), b = sx * hx; F.blk(B.ashlar, a, b, F.tmin(a, b, hz - wt, hz) - 0.6, top, hz - wt, hz); F.blk(B.marble, a - sx * 0.08, b + sx * 0.08, top, top + 0.18, hz - wt - 0.08, hz + 0.08); F.col(Math.min(a, b), Math.max(a, b), hz - wt, hz); }
    // the platea face: buttress piers with marble caps, a moulded string course at court level, a stepped plinth;
    // a lion-spout wall fountain, decree stelai, benches and statues at its foot
    const piers = []; for (let x = -39; x <= 39; x += 6.5) if (Math.abs(x) > 8.5) piers.push(x);
    for (const x of piers) {
      const g = F.tmin(x - 0.6, x + 0.6, hz, hz + 0.45);
      F.blk(B.ashlar, x - 0.45, x + 0.45, g - 0.6, par - 0.15, hz, hz + 0.3); F.col(x - 0.45, x + 0.45, hz, hz + 0.3);
      F.blk(B.marble, x - 0.56, x + 0.56, -0.5, -0.02, hz, hz + 0.38); F.blk(B.marble, x - 0.52, x + 0.52, par - 0.22, par, hz, hz + 0.36);
      F.blk(B.grey, x - 0.58, x + 0.58, g - 0.5, F.tmax(x - 0.6, x + 0.6, hz, hz + 0.45) + 0.5, hz, hz + 0.42);
    }
    for (const sx of [-1, 1]) {
      F.blk(B.marble, Math.min(sx * 7.2, sx * hx), Math.max(sx * 7.2, sx * hx), -0.42, -0.24, hz, hz + 0.1); F.blk(B.marble, Math.min(sx * 7.2, sx * hx), Math.max(sx * 7.2, sx * hx), -0.24, -0.06, hz, hz + 0.17);
      F.blk(B.marble, Math.min(sx * (hx + 0.03), sx * (hx - 0.56)), Math.max(sx * (hx + 0.03), sx * (hx - 0.56)), -0.5, -0.02, hz - 0.56, hz + 0.2);   // corner cap ending the course
      const edges = [7.2, ...piers.filter(x => x > 0), hx].map(v => sx * v).sort((a, b) => a - b);
      for (let i = 0; i < edges.length - 1; i++) { const a = edges[i], b = edges[i + 1]; F.blk(B.grey, a, b, F.tmin(a, b, hz, hz + 0.3) - 0.5, F.tmax(a, b, hz, hz + 0.3) + 0.32, hz, hz + 0.12); }
    }
    { const x = -29.25, g = F.tmax(x - 1.3, x + 1.3, hz, hz + 1.1), gl = F.tmin(x - 1.3, x + 1.3, hz, hz + 1.1), rim = g + 0.72;
      F.blk(B.marble, x - 1.2, x + 1.2, gl - 0.3, g + 0.25, hz, hz + 0.95);
      for (const [xa, xb, za, zb] of [[x - 1.2, x - 1.04, hz, hz + 0.95], [x + 1.04, x + 1.2, hz, hz + 0.95], [x - 1.04, x + 1.04, hz + 0.79, hz + 0.95]]) F.blk(B.marble, xa, xb, g + 0.25, rim, za, zb);
      F.blk(B.marble, x - 1.28, x + 1.28, rim, rim + 0.06, hz + 0.72, hz + 1.01);
      F.plane(own.water, x - 1.04, x + 1.04, hz, hz + 0.79, rim - 0.1);
      F.blk(B.marble, x - 0.6, x + 0.6, rim, rim + 1.3, hz, hz + 0.06); F.blk(own.painted, x - 0.6, x + 0.6, rim + 1.18, rim + 1.3, hz + 0.06, hz + 0.08, PAINT.oxblood);
      F.blk(B.marble, x - 0.74, x + 0.74, rim + 1.3, rim + 1.46, hz, hz + 0.16); F.add(B.marble, triGeo(0.74, 0.3, 0.12), F.m(x, rim + 1.46, hz + 0.02));
      spout(F, x, rim + 0.66, hz + 0.06, 1.2, rim - 0.1, 0.45);
      F.col(x - 1.2, x + 1.2, hz, hz + 1.01);
      F.poi('fountain', x, hz + 0.5, gl, 0, { r: 2, note: 'wall fountain below the sanctuary of Apollo', spots: [F.spot(x - 0.6, hz + 1.45, Math.PI), F.spot(x + 0.6, hz + 1.45, Math.PI)] }); }
    for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {   // decree stelai flanking the stair
      const x = sx * (8.6 + i * 1.5), g = F.tmin(x - 0.5, x + 0.5, hz + 0.1, hz + 0.6), hS = 1.75 + ((i + (sx > 0)) % 2) * 0.3;
      F.blk(B.grey, x - 0.5, x + 0.5, g - 0.3, g + 0.22, hz + 0.1, hz + 0.6);
      F.add(B.marble, box(0.8, hS, 0.18), F.m(x, g + 0.22 + hS / 2, hz + 0.35)); F.add(B.marble, triGeo(0.46, 0.26, 0.22), F.m(x, g + 0.22 + hS, hz + 0.24));
      F.col(x - 0.5, x + 0.5, hz + 0.1, hz + 0.6);
    }
    for (const [x, fi] of [[-35.75, 2], [29.25, 0]]) statueOn(F, x, hz + 1.05, F.tmin(x - 0.8, x + 0.8, hz + 0.25, hz + 1.85), 0, figs[fi], 1.05, 1.7);
    for (const x of [-22.75, 22.75]) { const g = F.tmin(x - 1.5, x + 1.5, hz, hz + 0.5); F.blk(B.marble, x - 1.5, x + 1.5, g - 0.3, g + 0.45, hz, hz + 0.5); F.col(x - 1.5, x + 1.5, hz, hz + 0.5); for (const dx of [-0.75, 0.75]) F.poi('bench', x + dx, hz + 0.25, g + 0.45, 0); }
    // one pier on the terrace's west face south of the stoa
    { const z = 18.75, g = F.tmin(-hx - 0.45, -hx, z - 0.6, z + 0.6); F.blk(B.ashlar, -hx - 0.3, -hx, g - 0.6, top - 0.15, z - 0.45, z + 0.45); F.blk(B.marble, -hx - 0.36, -hx, top - 0.22, top, z - 0.52, z + 0.52); F.blk(B.grey, -hx - 0.42, -hx, g - 0.5, F.tmax(-hx - 0.45, -hx, z - 0.6, z + 0.6) + 0.5, z - 0.58, z + 0.58); F.col(-hx - 0.3, -hx, z - 0.45, z + 0.45); }
    [[-21.5, 3], [-27.5, 0], [-33, 5], [-38.5, 2], [21, 1], [35, 4], [39.2, 0]].forEach(([x, fi], i) => statueOn(F, x, hz - wt - 1.0, 0, (x > 0 ? -1 : 1) * 0.12, figs[fi], 1.1, 1.5 + (i % 2) * 0.2));
    wall(hx - wt, hx, -hz + wt, hz - wt, true);
    wall(-hx, -hx + wt, -hz + wt, stoaZ0, true); wall(-hx, -hx + wt, stoaZ1, hz - wt, true);
    for (const sx of [-1, 1]) { F.blk(B.marble, sx * 1.47, sx * 1.95, -0.2, 3.2, -hz - 0.1, -hz + wt + 0.1); F.col(Math.min(sx * 1.5, sx * 1.95), Math.max(sx * 1.5, sx * 1.95), -hz, -hz + wt); }
    F.blk(B.marble, -2.1, 2.1, 3.2, 3.6, -hz - 0.15, -hz + wt + 0.15);
    for (const sx of [-1, 1]) doorLeaf(F, sx * 1.48, -hz + wt + 0.14, 1.45, 2.95, 0.02, 1.2, sx, 1);
    F.blk(B.marble, -1.5, 1.5, F.tmin(-1.5, 1.5, -hz - 0.5, -hz + wt) - 0.6, 0.02, -hz - 0.5, -hz + wt);
    F.gnd(-1.5, 1.5, -hz - 0.5, -hz + wt, 0.02);
    { const yb = Math.min(F.t(-1.8, -hz - 1.0), F.t(1.8, -hz - 1.0)), n = Math.round((0.02 - yb) / 0.2); if (n > 1) stairs(F, B.grey, -1.8, 1.8, -hz - 1.0, -hz - 0.5, yb, yb + (0.02 - yb) * (n - 1) / n, n - 1); }
    // court floors
    F.plane(B.canvas, -hx + wt, hx - wt, -hz + wt, hz - wt, 0.02);
    F.plane(B.pave, -5, 5, 3.9, 13.3, 0.04); F.plane(B.pave, -3, 3, 13.3, 16, 0.04);
    F.gnd(-hx + wt, hx - wt, -hz + wt, 20, 0); F.gnd(-hx + wt, -7.2, 20, hz - wt, 0); F.gnd(7.2, hx - wt, 20, hz - wt, 0);
    F.area('sanctuary of Apollo: court before the temple', -33, 33, 4.5, 15.5, 0); F.area('sanctuary of Apollo: laurel grove', 14, 40, -22, 3, 0); F.area('sanctuary of Apollo: west court', -33, -9, -22, 3, 0);
    // grand stair up from the platea, flanked by cheek walls, and the gate (Doric distyle in antis)
    const ybs = Math.min(F.t(0, hz + 0.3), F.t(-5, hz + 0.3), F.t(5, hz + 0.3)), nSt = Math.max(3, Math.round(-ybs / 0.29));
    stairs(F, B.grey, -6, 6, hz, 20, ybs, 0, nSt);
    for (const sx of [-1, 1]) {
      const a = sx * 6, b = sx * 7.2;
      F.blk(B.ashlar, a, b, F.tmin(a, b, 20, hz) - 0.6, par, 20, hz); F.blk(B.marble, a - sx * 0.08, b + sx * 0.08, par, par + 0.18, 20, hz + 0.08);
      F.blk(B.ashlar, a, b, -0.6, 4.85, 16, 20); F.blk(B.marble, a - sx * 0.1, b + sx * 0.1, 4.85, 5.2, 15.9, 20.1);
      F.col(Math.min(a, b), Math.max(a, b), 16, hz);
      doricCol(F, sx * 2.1, 0, 19.3, 5.2, 0.44);
    }
    F.plane(B.pave, -6, 6, 16, 20, 0.04);
    const gTop = doricRun(F, -7.2, 7.2, 18, 5.2, 4.2, [-6.6, -4.35, -2.1, 0, 2.1, 4.35, 6.6], [1, -1], 1.5);
    pedRoof(F, { x0: -7.2, x1: 7.2, z0: 15.9, z1: 20.1, y: gTop, pitch: 0.27, over: 0.35, color: 0xb46f48 });
    for (const sx of [-1, 1]) { F.add(B.marble, basinGeo(), F.m(sx * 4.3, 0, 14.6)); F.col(sx * 4.3 - 0.6, sx * 4.3 + 0.6, 14, 15.2); }
    F.poi('fountain', 4.3, 14.6, 0, Math.PI, { r: 1.5, note: 'perirrhanterion (lustral basin)', spots: [F.spot(4.3, 13.5, Math.PI), F.spot(-4.3, 13.5, Math.PI)] });
    // temple
    const FT = F.sub(0, 0, -9.3);
    const T = ionicTemple(FT, { w: 12.6, d: 23.0, steps: 3, rise: 0.33, tread: 0.45, n: 6, colH: 7.4, colR: 0.42, amphi: true, cellaX: 5.0, antaZ: 8.0, doorZ: 4.3, backZ: -4.3, roof: 0xb46f48, pitch: 0.3, tymp: PAINT.blue, pedFigs: true });
    FT.poi('gather', 0, 10.2, T.sty, 0, { r: 2.5, note: 'temple porch' });
    FT.poi('seat', -4.5, 12.2, 0.66, 0, { note: 'temple steps' }); FT.poi('seat', 4.2, 12.2, 0.66, 0, { note: 'temple steps' }); FT.poi('seat', 7.45, 6, 0.33, Math.PI / 2, { note: 'temple steps' });
    // altar with prothesis, bronze tripods on columns
    F.blk(B.grey, -4.8, 4.8, -0.5, 0.22, 7.4, 12.2);
    F.add(B.marble, rectSweep(6.2, 2.6, [{ o: 0.3, y: 0 }, { o: 0.3, y: 0.25, hard: true }, { o: 0.1, y: 0.4 }, { o: 0, y: 0.5, hard: true }, { o: 0, y: 1.45, hard: true }, { o: 0.12, y: 1.55 }, { o: 0.25, y: 1.7, hard: true }], { top: true }), F.m(0, 0.22, 9.4));
    for (const sx of [-1, 1]) F.add(B.marble, new THREE.CylinderGeometry(0.24, 0.24, 3.1, 18), F.m(sx * 3.1, 2.1, 9.4, Math.PI / 2, 0, 0));
    F.blk(own.painted, -2.6, 2.6, 1.92, 1.98, 8.6, 10.2, PAINT.ash);
    F.add(own.painted, ellipsoid(0.9, 0.18, 0.5, 8, 4), F.m(0.3, 1.95, 9.4), PAINT.ember);
    F.col(-3.45, 3.45, 8.0, 10.8);
    F.gnd(-4.8, 4.8, 7.4, 12.2, 0.22);
    F.poi('altar', 0, 9.4, 0.22, Math.PI, { r: 5, note: 'altar of Apollo', spots: [F.spot(-1.8, 11.7, Math.PI), F.spot(0, 11.9, Math.PI), F.spot(1.8, 11.7, Math.PI), F.spot(-4.2, 9.4, Math.PI / 2)] });
    for (const sx of [-1, 1]) {
      const x = sx * 6.8, z = 9.6, ty = 1.35;
      F.add(B.marble, rectSweep(1.3, 1.3, [{ o: 0.2, y: 0 }, { o: 0.2, y: 0.2, hard: true }, { o: 0, y: 0.32, hard: true }, { o: 0, y: 1.2, hard: true }, { o: 0.1, y: 1.28 }, { o: 0.14, y: ty, hard: true }], { top: true }), F.m(x, 0, z));
      F.add(own.painted, lathe([[0.05, -0.12], [0.5, -0.02], [0.66, 0.3], [0.68, 0.46], [0.6, 0.48], [0.58, 0.44]], 16), F.m(x, ty + 1.75, z), PAINT.bronze);
      for (let k = 0; k < 3; k++) { const a = k / 3 * TAU + 0.5; own.painted.add(bone([Math.cos(a) * 0.48, 0.05, Math.sin(a) * 0.48], [Math.cos(a) * 0.6, 1.95, Math.sin(a) * 0.6], 0.045), F.m(x, ty, z), PAINT.bronze); own.painted.add(ellipsoid(0.08, 0.06, 0.08, 6, 4), F.m(x + Math.cos(a) * 0.48, ty + 0.04, z + Math.sin(a) * 0.48), PAINT.bronze); }
      for (const a of [0, Math.PI]) own.painted.add(new THREE.TorusGeometry(0.26, 0.04, 5, 14), F.m(x + Math.cos(a) * 0.55, ty + 2.5, z, 0, Math.PI / 2, 0), PAINT.bronze);
      F.col(x - 0.7, x + 0.7, z - 0.7, z + 0.7);
    }
    // votive statues along the court
    const vs = [[-11, 3, 2], [11, 3, 0], [-11.5, -13, 4], [11.5, -13, 1], [-15, 14.5, 3], [15, 14.5, 5]];
    vs.forEach(([x, z, fi], i) => statueOn(F, x, z, 0, x < 0 ? Math.PI / 2 - 0.3 : -Math.PI / 2 + 0.3, figs[fi], 1.05, 1.4 + (i % 2) * 0.3));
    // stelai along the south wall
    for (let i = 0; i < 6; i++) { const x = (i < 3 ? -1 : 1) * (10 + i % 3 * 3.2); F.add(B.marble, box(0.8, 1.7 + (i % 2) * 0.3, 0.2), F.m(x, 0.85 + (i % 2) * 0.15, hz - wt - 0.35, 0, 0, (R() - 0.5) * 0.06)); F.add(B.marble, triGeo(0.45, 0.28, 0.24), F.m(x, 1.7 + (i % 2) * 0.3, hz - wt - 0.47)); }
    F.col(-17, -9.5, hz - wt - 0.6, hz - wt); F.col(9.5, 17, hz - wt - 0.6, hz - wt);
    // laurel grove in the east court
    const grove = [[20, -18], [27, -15], [34, -19], [22, -7], [31, -5], [37, -10], [25, 3], [35, 5]];
    grove.forEach(([x, z], i) => tree(F, x + (R() - 0.5) * 2, z + (R() - 0.5) * 2, 0, 1.15 + R() * 0.35, trees[i % 4], [0x5d7a45, 0x557043, 0x68824d][i % 3]));
    [[-24, 17.5], [-32, 13], [-19, -20], [38.5, 17.5], [-27, -8]].forEach(([x, z], i) => tree(F, x, z, 0, 1.0 + R() * 0.3, trees[(i + 2) % 4], 0x5f7b47));
    for (const [x, z] of [[20, 10.5], [31, 12]]) { F.blk(B.marble, x - 1.6, x + 1.6, 0, 0.45, z - 0.3, z + 0.3); F.col(x - 1.6, x + 1.6, z - 0.3, z + 0.3); F.poi('bench', x - 0.7, z, 0.45, Math.PI); F.poi('bench', x + 0.7, z, 0.45, Math.PI); }
    { const ex = 27, ez = 17.2;
      exedra(F, ex, 0, ez, 3.5, 4.1, 4.5, 1.5, 0, 'exedra of Apollo');
      for (const a of [0.55, Math.PI / 2, Math.PI - 0.55]) F.add(B.statue, figs[a === Math.PI / 2 ? 0 : 2], F.m(ex + Math.cos(a) * 4.3, 1.6, ez + Math.sin(a) * 4.3, 0, Math.PI, 0, 0.95)); }
    F.poi('gather', 28, -1, 0, undefined, { r: 3, note: 'laurel grove' });
    F.poi('gather', -20, 5, 0, undefined, { r: 3, note: 'sanctuary court' });
    F.poi('view', 0, 17, 0, Math.PI, { note: 'the temple of Apollo from its gate' });
    // west stoa for dedications (colonnade faces east)
    const Fs = F.sub(-hx + 4.05, 0, (stoaZ0 + stoaZ1) / 2, Math.PI / 2);
    stoa(Fs, { len: stoaZ1 - stoaZ0, depth: 8.1, colH: 4.4, colR: 0.33, wallTop: 5.9, pilasters: true });
    for (let i = 0; i < 8; i++) { const x = -14 + i * 4; Fs.blk(B.woodDark, x - 0.5, x + 0.5, 2.2, 3.0, -3.15, -3.1); Fs.blk(own.painted, x - 0.4, x + 0.4, 2.3, 2.9, -3.1, -3.08, [0x7a4a3a, 0x4d5a6a, 0x9a7a50, 0x5e6b4a][i % 4]); }
    for (const i of [0, 1]) jar(F, -33 + i * 0.7, -21 + i * 0.4, 0);
    Sx.commit();
  }

  // ======================================================================================
  // B  Krene on the platea (facade south) and the prytaneion behind it (entrance north)
  // ======================================================================================
  function buildKrene(rect) {
    const Sx = site('krene');
    // ---- fountain house ----
    const kx = 169.25, LK = tMax({ minX: 160, maxX: 178.5, minZ: 45, maxZ: 55.5 }) + 0.35, F = frame(Sx, kx, LK, rect.maxZ - 5.5, 0);
    const ybk = Math.min(F.t(-8.4, 5.6), F.t(8.4, 5.6), F.t(0, 5.6)), nk = Math.max(2, Math.round(-ybk / 0.3));
    stairs(F, B.grey, -8.4, 8.4, 5.5, 4.1, ybk, 0, nk);
    F.blk(B.grey, -8.4, 8.4, F.tmin(-8.4, 8.4, -5.5, 4.1) - 0.6, 0, -5.5, 4.1);
    F.plane(B.pave, -7.6, 7.6, 0.5, 4.1, 0.012);
    F.gnd(-8.4, 8.4, -5.5, 4.1, 0);
    for (const sx of [-1, 1]) { F.blk(B.ashlar, sx * 7.6, sx * 8.4, 0, 4.6, -5.5, 3.9); F.blk(B.marble, sx * 7.52, sx * 8.48, 4.25, 4.6, 3.0, 3.98); F.col(Math.min(sx * 7.6, sx * 8.4), Math.max(sx * 7.6, sx * 8.4), -5.5, 3.9); }
    F.blk(B.ashlar, -7.6, 7.6, 0, 4.6, -5.5, -4.8); F.col(-7.6, 7.6, -5.5, -4.8);
    const kxs = [-4.5, -1.5, 1.5, 4.5];
    for (const x of kxs) doricCol(F, x, 0, 3.5, 4.6, 0.36);
    const kTop = doricRun(F, -8.4, 8.4, 3.5, 4.6, 0.95, [-8.2, -6, ...kxs.flatMap((x, i) => i < 3 ? [x, (x + kxs[i + 1]) / 2] : [x]), 6, 8.2], [1], 1.3);
    for (const sx of [-1, 1]) { const Fr = F.sub(sx * 8.0, 0, -1.0, Math.PI / 2); doricRun(Fr, -4.03, 4.5, 0, 4.6, 0.8, [-3.4, -1.2, 1, 3.2], [sx], 1.28); }
    doricRun(F, -7.6, 7.6, -5.15, 4.6, 0.7, [], [], 1.27);
    F.blk(B.wood, -7.6, 7.6, 4.6 + 0.5, 4.6 + 0.6, -4.8, 3.03);
    const kp = pedRoof(F, { x0: -8.4, x1: 8.4, z0: -5.5, z1: 3.98 + 0.22, y: kTop, pitch: 0.28, over: 0.35, color: 0xb8714a, tymp: PAINT.sky });
    F.add(B.marble, new THREE.CylinderGeometry(0.62, 0.62, 0.12, 20).rotateX(Math.PI / 2), F.m(0, kTop + kp.at * 0.42, 4.14));
    own.terra.add(lionHeadGeo(), F.m(0, kTop + kp.at * 0.42, 4.14, 0, 0, 0, 1.6), LION); own.painted.add(lionMouthGeo(), F.m(0, kTop + kp.at * 0.42, 4.14, 0, 0, 0, 1.6), PAINT.dark);
    // parapet, draw basin with water, lion-head spouts on the back wall
    F.blk(B.marble, -7.6, 7.6, 0, 0.95, 0.2, 0.5); F.blk(B.marble, -7.6, 7.6, 0.95, 1.03, 0.12, 0.62);
    for (const x of [-4.5, -1.5, 1.5, 4.5]) F.blk(B.marble, x - 0.14, x + 0.14, 0, 1.1, 0.12, 0.62);
    F.blk(B.grey, -7.6, 7.6, 0, 0.3, -4.8, 0.2);
    F.plane(own.water, -7.6, 7.6, -4.8, 0.2, 0.62);
    F.col(-7.6, 7.6, -4.8, 0.62);
    for (const x of [-6, -3, 0, 3, 6]) spout(F, x, 1.85, -4.8, 1.3, 0.62, 0.75);
    F.blk(B.marble, -7.6, 7.6, 2.75, 2.95, -4.8, -4.68); F.blk(own.painted, -7.6, 7.6, 2.95, 3.45, -4.8, -4.76, PAINT.oxblood); F.blk(B.marble, -7.6, 7.6, 3.45, 3.55, -4.8, -4.7);
    for (let i = 0; i < 7; i++) jar(F, -6.6 + i * 2.1 + (R() - 0.5) * 0.4, 1.0 + R() * 0.5, 0.012, 0.95 + R() * 0.15);
    for (const x of [-5.2, 2.2]) jar(F, x, 0.37, 1.03, 0.85);
    F.poi('fountain', 0, 0.4, 0, Math.PI, { r: 7, note: 'krene on the platea', spots: [-6, -3, 0, 3, 6].map(x => F.spot(x, 1.05, Math.PI)).concat([-5, 0, 5].map(x => F.spot(x, 3.0, Math.PI))) });
    F.poi('gather', 0, 7.5, F.t(0, 7.5), undefined, { r: 4, note: 'queue at the krene' });
    F.area('krene porch', -7.2, 7.2, 1.0, 3.8, 0);
    // corner square: trough with a spout on the west wall, plane tree, bench
    const trough = F.tmax(-11.2, -8.4, -3, 2);
    F.blk(B.grey, -11.2, -8.5, F.tmin(-11.2, -8.5, -3, 2) - 0.4, trough + 0.3, -2.6, 1.6);
    for (const [xa, xb, za, zb] of [[-11.2, -11.0, -2.6, 1.6], [-8.7, -8.5, -2.6, 1.6], [-11.0, -8.7, -2.6, -2.4], [-11.0, -8.7, 1.4, 1.6]]) F.blk(B.grey, xa, xb, trough + 0.3, trough + 0.75, za, zb);
    F.plane(own.water, -11.0, -8.7, -2.4, 1.4, trough + 0.64);
    spout(F.sub(-8.4, 0, -0.5, -Math.PI / 2), 0, trough + 1.5, 0, 0.75, trough + 0.64, 0.6);
    F.col(-11.2, -8.4, -2.6, 1.6);
    F.poi('fountain', -10, -0.5, trough, Math.PI / 2, { r: 2.5, note: 'trough at the krene', spots: [F.spot(-12, -0.5, Math.PI / 2), F.spot(-12, 1.0, Math.PI / 2)] });
    tree(F, -14.3, -1.5, F.t(-14.3, -1.5), 0.9, planeTrees[0], 0x6d8a4c);
    const bz = -5.2, by = F.t(-13, bz); F.blk(B.marble, -16.5, -12, by - 0.3, by + 0.45, bz - 0.3, bz + 0.3); F.col(-16.5, -12, bz - 0.3, bz + 0.3);
    F.poi('bench', -15.5, bz, by + 0.45, 0); F.poi('bench', -13.2, bz, by + 0.45, 0);
    // ---- prytaneion (front north: local +z = north) ----
    const pf = { minX: 152.25, maxX: 186.25, minZ: rect.minZ + 2, maxZ: rect.minZ + 33 };
    const LP = tMax(pf) + 0.3, P = frame(Sx, (pf.minX + pf.maxX) / 2, LP, (pf.minZ + pf.maxZ) / 2, Math.PI), X = 17, Z = 15.5, t = 0.7, wh = 5.2;
    const pcol = 0xe8d5b5, icol = 0xe5cfae;
    const pwall = (x0, x1, z0, z1, h = wh, outer = false) => {
      if (outer) { P.blk(B.ashlar, x0, x1, P.tmin(x0, x1, z0, z1) - 0.6, 0.6, z0, z1); P.blk(B.walls, x0 + 0.01, x1 - 0.01, 0.6, h, z0 + 0.01, z1 - 0.01, pcol); }
      else P.blk(B.walls, x0, x1, 0, h, z0, z1, icol);
      P.col(x0, x1, z0, z1);
    };
    pwall(-X, -1.1, Z - t, Z, wh, true); pwall(1.1, X, Z - t, Z, wh, true); P.blk(B.walls, -1.1, 1.1, 3.3, wh, Z - t, Z, pcol);
    pwall(-X, X, -Z, -Z + t, wh, true);
    for (const sx of [-1, 1]) pwall(sx > 0 ? X - t : -X, sx > 0 ? X : -X + t, -Z + t, Z - t, wh, true);
    // one fill under every floor of the building, a marble threshold, the paved entrance passage
    P.blk(B.grey, -X + t, X - t, P.tmin(-X, X, -Z, Z) - 0.6, 0, -Z + t, Z - t);
    P.blk(B.marble, -1.1, 1.1, P.tmin(-1.1, 1.1, Z - t, Z) - 0.6, 0.02, Z - t, Z);
    // entrance: tetrastyle prostyle porch with a pediment, open doorway with leaves swung into the passage
    for (const sx of [-1, 1]) { P.blk(B.marble, sx * 1.1, sx * 1.45, 0, 3.6, Z - 0.02, Z + 0.08); doorLeaf(P, sx * 1.08, Z - t - 0.07, 1.04, 3.2, 0.02, 1.0, sx, -1); }
    P.blk(B.marble, -1.6, 1.6, 3.3, 3.65, Z - 0.02, Z + 0.12);
    const pz = Z + 1.6;
    P.blk(B.grey, -4.4, 4.4, P.tmin(-4.4, 4.4, Z, pz + 0.5) - 0.5, 0, Z, pz + 0.5);
    P.plane(B.pave, -4.2, 4.2, Z, pz + 0.4, 0.012);
    P.gnd(-4.4, 4.4, Z - t, pz + 0.5, 0);
    { const yb = P.t(0, pz + 1.1); if (yb < -0.5) { P.blk(B.grey, -3.6, 3.6, yb - 0.4, yb / 2, pz + 0.5, pz + 1.0); P.gnd(-3.6, 3.6, pz + 0.5, pz + 1.0, yb / 2); } }
    for (const x of [-3.3, -1.1, 1.1, 3.3]) doricCol(P, x, 0, pz, 5.0, 0.34);
    const pTop = doricRun(P, -4.1, 4.1, pz, 5.0, 0.85, [-3.9, -3.3, -2.2, -1.1, 0, 1.1, 2.2, 3.3, 3.9], [1], 0.9);
    for (const sx of [-1, 1]) { const h = (pz - 0.43 - Z) / 2; doricRun(P.sub(sx * 3.7, 0, Z + h, Math.PI / 2), -h, h, 0, 5.0, 0.8, [], [], 0.89); }
    P.blk(B.walls, -4.1, 4.1, wh, pTop, Z - t, Z, pcol);
    P.blk(B.wood, -3.3, 3.3, 5.0 + 0.3, 5.0 + 0.38, Z, pz - 0.43);
    pedRoof(P, { x0: -4.1, x1: 4.1, z0: Z - 0.3, z1: pz + 0.42, y: pTop, pitch: 0.3, over: 0.3, color: 0xb46f48 });
    // wings around the court
    const court = { x0: -9.5, x1: 9.5, z0: -5.5, z1: 7.5 };
    pwall(-X + t, -2.2, court.z1, court.z1 + t); pwall(2.2, X - t, court.z1, court.z1 + t);
    for (const sx of [-1, 1]) pwall(sx > 0 ? 2.2 : -2.9, sx > 0 ? 2.9 : -2.2, court.z1 + t, Z - t);
    pwall(-X + t, -5, court.z0 - t, court.z0); pwall(5, X - t, court.z0 - t, court.z0);
    for (const sx of [-1, 1]) pwall(sx > 0 ? court.x1 : court.x0 - t, sx > 0 ? court.x1 + t : court.x0, court.z0, court.z1);
    for (const sx of [-1, 1]) pwall(sx > 0 ? court.x1 : court.x0 - t, sx > 0 ? court.x1 + t : court.x0, -Z + t, court.z0 - t);
    // room doors on the court: leaves 3 cm proud of the painted dado, marble jambs and lintel
    for (const sx of [-1, 1]) for (const z of [-2, 4]) { P.blk(B.doors, sx * (court.x1 - 0.06), sx * (court.x1 - 0.03), 0, 2.4, z - 0.6, z + 0.6); for (const s of [-1, 1]) P.blk(B.marble, sx * (court.x1 - 0.08), sx * court.x1, 0, 2.4, z + s * 0.6, z + s * 0.72); P.blk(B.marble, sx * (court.x1 - 0.08), sx * court.x1, 2.4, 2.56, z - 0.72, z + 0.72); }
    for (const sx of [-1, 1]) { P.blk(B.doors, sx * 5, sx * 6.2, 0, 2.4, court.z1 - 0.06, court.z1 - 0.03); for (const [a, b] of [[4.88, 5], [6.2, 6.32]]) P.blk(B.marble, sx * a, sx * b, 0, 2.4, court.z1 - 0.08, court.z1); P.blk(B.marble, sx * 4.88, sx * 6.32, 2.4, 2.56, court.z1 - 0.08, court.z1); }
    P.blk(B.walls, -5, 5, 4.0, wh, court.z0 - t, court.z0, icol);
    for (const sx of [-1, 1]) doricCol(P, sx * 1.7, 0, court.z0 - t / 2, 3.7, 0.3);
    P.blk(B.marble, -5, 5, 3.7, 4.05, court.z0 - t - 0.05, court.z0 + 0.05);
    const roofW = (w, d, x, y, z, color, pitch = 0.3) => { P.add(B.roofs, ctx.kit.hipRoof(w, d, 0.45, pitch), P.m(x, y, z), color); P.blk(B.walls, x - w / 2 - 0.42, x + w / 2 + 0.42, y, y + 0.1, z - d / 2 - 0.42, z + d / 2 + 0.42, 0xd8ccb8); };
    roofW(2 * X, Z - court.z1, 0, wh, (Z + court.z1) / 2, 0xbf7d55);
    roofW(2 * X, court.z0 + Z, 0, wh + 0.4, (court.z0 - Z) / 2, 0xb8714a, 0.32);
    for (const sx of [-1, 1]) roofW(X - court.x1, court.z1 - court.z0 - 0.2, sx * (X + court.x1) / 2, wh - 0.01, (court.z0 + court.z1) / 2, 0xc5895f);
    P.blk(B.walls, -X, X, wh, wh + 0.4, -Z, -Z + 0.6, pcol); P.blk(B.walls, -X, X, wh, wh + 0.4, court.z0 - t, court.z0, icol);
    // street faces: pilaster strips on marble bases, an oxblood and ochre band under the eaves, small high windows
    { const pc = 0xeddcbd, win = [3.2, 3.95];
      const face = (along, n, sg, u0, u1, pils, wins, h) => {   // along 'x': wall plane z = n, outward sg; along 'z': wall plane x = n
        const B3 = (b, ua, ub, ya, yb, da, db, col) => along === 'x' ? P.blk(b, ua, ub, ya, yb, n + sg * da, n + sg * db, col) : P.blk(b, n + sg * da, n + sg * db, ya, yb, ua, ub, col);
        B3(own.painted, u0, u1, h - 0.72, h - 0.3, 0, 0.03, PAINT.oxblood); B3(own.painted, u0, u1, h - 0.8, h - 0.74, 0, 0.03, PAINT.ochre);
        for (const u of pils) {
          B3(B.walls, u - 0.3, u + 0.3, 0.6, h - 0.45, 0, 0.12, pc); B3(B.marble, u - 0.36, u + 0.36, 0.6, 0.78, 0, 0.17); B3(B.marble, u - 0.38, u + 0.38, h - 0.45, h - 0.27, 0, 0.2);
          if (along === 'x') P.col(u - 0.3, u + 0.3, n, n + sg * 0.12); else P.col(n, n + sg * 0.12, u - 0.3, u + 0.3);
        }
        for (const u of wins) { B3(B.doors, u - 0.2, u + 0.2, win[0], win[1], -0.02, 0.02); B3(B.marble, u - 0.28, u + 0.28, win[0] - 0.1, win[0], -0.02, 0.07); }
      };
      const n = X - 0.01, nz = Z - 0.01, zs = [-13.4, -9.4, -5.4, -1.4, 2.6, 6.6, 10.6], xsS = [-14.6, -10.4, -6.2, -2, 2, 6.2, 10.4, 14.6];
      for (const sg of [-1, 1]) face('z', sg * n, sg, -Z, Z, zs, [-11.4, -3.4, 4.6, 12.6], wh);
      face('x', -nz, -1, -X, X, xsS, [-12.5, -4.1, 4.1, 12.5], wh + 0.4);
      for (const sg of [-1, 1]) face('x', nz, 1, Math.min(sg * 4.5, sg * X), Math.max(sg * 4.5, sg * X), [sg * 6.6, sg * 10.6, sg * 14.6], [sg * 8.6, sg * 12.6], wh);
      for (const x of [-12.5, -4.1, 4.1, 12.5]) P.blk(B.doors, x - 0.2, x + 0.2, win[0], win[1], -Z + t - 0.03, -Z + t + 0.02);   // the same windows seen from inside the hearth hall
    }
    // court + hearth hall; the painted dado stops at the door jambs
    P.plane(B.pave, court.x0, court.x1, court.z0, court.z1, 0.02); P.plane(B.pave, -2.2, 2.2, court.z1, Z - t, 0.02);
    const dado = (x0, x1, z0, z1) => { P.blk(own.painted, x0, x1, 0, 1.1, z0, z1, PAINT.oxblood); P.blk(own.painted, x0, x1, 1.1, 1.18, z0, z1, PAINT.ochre); };
    for (const sx of [-1, 1]) for (const [za, zb] of [[court.z0 + 0.02, -2.72], [-1.28, 3.28], [4.72, court.z1 - 0.02]]) dado(sx * (court.x1 - 0.02), sx * court.x1, za, zb);
    for (const [xa, xb] of [[court.x0 + 0.02, -5], [5, court.x1 - 0.02]]) dado(xa, xb, court.z0, court.z0 + 0.02);
    for (const [xa, xb] of [[court.x0 + 0.02, -6.32], [-4.88, -2.2], [2.2, 4.88], [6.32, court.x1 - 0.02]]) dado(xa, xb, court.z1 - 0.02, court.z1);
    P.plane(B.pave, court.x0, court.x1, -Z + t, court.z0 - t, 0.02); P.plane(B.pave, -5, 5, court.z0 - t, court.z0, 0.02);
    P.gnd(-2.2, 2.2, court.z1, Z - t, 0.02); P.gnd(-1.1, 1.1, Z - t, Z, 0.02); P.gnd(court.x0, court.x1, court.z0, court.z1, 0.02); P.gnd(court.x0, court.x1, -Z + t, court.z0 - t, 0.02); P.gnd(-5, 5, court.z0 - t, court.z0, 0.02);
    P.blk(B.woodDark, court.x0, court.x1, 4.0, 4.1, -Z + t, court.z0 - t);
    P.add(B.marble, lathe([[1.25, 0], [1.25, 0.35], [0.95, 0.4], [0.95, 0.3]], 16), P.m(0, 0, -10.5));
    P.add(own.painted, new THREE.CircleGeometry(0.95, 14).rotateX(-Math.PI / 2), P.m(0, 0.28, -10.5), PAINT.ember);
    for (let i = 0; i < 4; i++) B.woodDark.add(new THREE.CylinderGeometry(0.07, 0.08, 1.2, 6), P.m(0, 0.4, -10.5, Math.PI / 2, i * 0.8, 0.15));
    P.col(-1.3, 1.3, -11.8, -9.2);
    P.poi('shrine', 0, -10.5, 0, 0, { r: 2.5, note: 'the common hearth (hestia)', spots: [P.spot(0, -8.2, Math.PI), P.spot(-2, -9, Math.PI * 0.8)] });
    statueOn(P, 0, -Z + t + 0.9, 0, 0, figs[4], 1.0, 1.2);
    for (const sx of [-1, 1]) { P.blk(B.wood, sx * 3.2, sx * 8.6, 0, 0.55, -Z + t, -Z + t + 0.9); P.col(Math.min(sx * 3.2, sx * 8.6), Math.max(sx * 3.2, sx * 8.6), -Z + t, -Z + t + 0.9); P.poi('bench', sx * 6, -Z + t + 0.55, 0.55, 0); }
    P.add(B.marble, rectSweep(1.8, 1.1, [{ o: 0.2, y: 0 }, { o: 0.2, y: 0.18, hard: true }, { o: 0, y: 0.3, hard: true }, { o: 0, y: 0.95, hard: true }, { o: 0.12, y: 1.05, hard: true }], { top: true }), P.m(0, 0, 2.5));
    P.col(-1.1, 1.1, 1.8, 3.2);
    P.poi('altar', 0, 2.5, 0, Math.PI, { r: 3, note: 'altar of Hestia in the prytaneion court', spots: [P.spot(0, 4.2, Math.PI)] });
    for (const sx of [-1, 1]) { P.blk(B.marble, sx * 5.5, sx * 8.5, 0, 0.45, 5.9, 6.5); P.col(Math.min(sx * 5.5, sx * 8.5), Math.max(sx * 5.5, sx * 8.5), 5.9, 6.5); P.poi('bench', sx * 7, 6.2, 0.45, Math.PI); }
    for (const [x, z] of [[-7.8, -3.5], [7.8, -3.5]]) { P.blk(B.socles, x - 0.55, x + 0.55, 0, 0.55, z - 0.55, z + 0.55); tree(P, x, z, 0.6, 0.42, trees[1], 0x5f7c46, false); P.col(x - 0.6, x + 0.6, z - 0.6, z + 0.6); }
    const pcz = court.z1 - 2.6;
    for (const x of [-7.5, -2.5, 2.5, 7.5]) doricCol(P, x, 0, pcz, 3.6, 0.28);
    const ptop = doricRun(P, court.x0, court.x1, pcz, 3.6, 0.66, [-9.3, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 9.3], [1, -1], 0.75);
    P.add(B.roofs, leanRoof(2 * court.x1, court.z1 + 0.2, wh - 0.1, pcz - 0.5, ptop), P.m(), 0xbd7a50);
    P.poi('gather', -4, 0, 0, undefined, { r: 3, note: 'prytaneion court' });
    P.poi('door', 0, Z + 0.4, 0, 0, { nx: 0, nz: -1, note: 'prytaneion' });
    P.area('prytaneion court', court.x0 + 0.8, court.x1 - 0.8, court.z0 + 0.8, court.z1 - 0.8, 0);
    Sx.commit();
  }

  // ======================================================================================
  // C  Gymnasium: palaestra (east, on the avenue), grove + seat-steps + xystos (west)
  // ======================================================================================
  function buildGym(rect) {
    const Sx = site('gym');
    const LG = tMax({ minX: 96, maxX: 139, minZ: 197, maxZ: 241 }) + 0.15, pcx = 117, pcz = 214, F = frame(Sx, pcx, LG, pcz, 0);
    const X = 21, Z = 27, t = 0.8, wh = 6.9, cr = 0.32, ch = 4.8, st = 0.25;
    const colX = 16.6, zN = -15.0, zS = 22.6;
    const outer = (x0, x1, z0, z1, h = wh) => { const ns = x1 - x0 > z1 - z0, e = 0.07; F.blk(B.ashlar, x0, x1, F.tmin(x0, x1, z0, z1) - 0.6, 0.7, z0, z1); F.blk(B.walls, x0 + 0.01, x1 - 0.01, 0.7, h, z0 + 0.01, z1 - 0.01, 0xebe1cf); F.blk(B.marble, ns ? x0 : x0 - e, ns ? x1 : x1 + e, 0.66, 0.8, ns ? z0 - e : z0, ns ? z1 + e : z1); F.blk(B.marble, ns ? x0 : x0 - e, ns ? x1 : x1 + e, h - 0.25, h - 0.1, ns ? z0 - e : z0, ns ? z1 + e : z1); F.col(x0, x1, z0, z1); };
    outer(-X, X, -Z, -Z + t, 7.6); outer(-X, X, Z - t, Z);
    outer(-X, -X + t, -Z + t, -12.2); outer(-X, -X + t, -9.0, Z - t);
    outer(X - t, X, -Z + t, -0.9); outer(X - t, X, 8.5, Z - t);
    for (let z = -23; z <= 24; z += 4.2) if (z < -2.5 || z > 10) F.blk(B.doors, X - 0.02, X + 0.02, 5.3, 6.1, z - 0.22, z + 0.22);
    for (let x = -18.5; x <= 19; x += 4.2) F.blk(B.doors, x - 0.22, x + 0.22, 5.3, 6.1, Z - 0.02, Z + 0.02);
    // pilaster strips between the windows and a painted band under the top course, on all four outer faces
    const pil = (along, u, face, n, h) => {   // along 'x' → wall at z = face·n, pilaster centred at x = u; along 'z' → wall at x = face·n
      const a = n, b = n + 0.12, c = n + 0.23;   // caps clear the side roofs' ends at n + 0.2
      if (along === 'x') { F.blk(B.walls, u - 0.32, u + 0.32, 0.8, h - 0.45, face * a, face * b, 0xeee4d0); F.blk(B.marble, u - 0.4, u + 0.4, h - 0.45, h - 0.25, face * a, face * c); }
      else { F.blk(B.walls, face * a, face * b, 0.8, h - 0.45, u - 0.32, u + 0.32, 0xeee4d0); F.blk(B.marble, face * a, face * c, h - 0.45, h - 0.25, u - 0.4, u + 0.4); }
    };
    const band = (along, u0, u1, face, n, h) => { if (along === 'x') { F.blk(own.painted, u0, u1, h - 0.72, h - 0.3, face * n, face * (n + 0.03), PAINT.oxblood); F.blk(own.painted, u0, u1, h - 0.8, h - 0.74, face * n, face * (n + 0.03), PAINT.ochre); } else { F.blk(own.painted, face * n, face * (n + 0.03), h - 0.72, h - 0.3, u0, u1, PAINT.oxblood); F.blk(own.painted, face * n, face * (n + 0.03), h - 0.8, h - 0.74, u0, u1, PAINT.ochre); } };
    for (let x = -16.4; x < 19; x += 4.2) { pil('x', x, 1, Z, wh); pil('x', x, -1, Z, 7.6); }
    band('x', -X, X, 1, Z, wh); band('x', -X, X, -1, Z, 7.6);
    for (const z of [-20.9, -16.7, -12.5, -8.3, -4.1, 12.7, 16.9, 21.1, 25.3]) pil('z', z, 1, X, wh);
    for (const z of [-20.9, -16.7, -5.8, -1.6, 2.6, 6.8, 11, 15.2, 19.4]) pil('z', z, -1, X, wh);
    for (const [za, zb] of [[-Z, -0.9], [8.5, Z]]) band('z', za, zb, 1, X, wh);
    for (const [za, zb] of [[-Z, -12.2], [-9, Z]]) band('z', za, zb, -1, X, wh);
    // north range of rooms: ephebeion in the middle, open to the colonnade with two Ionic columns
    const rz0 = -Z + t, rz1 = -19.4;
    F.blk(B.walls, -X + t, -6, 0, 7.6, rz1, rz1 + 0.8, 0xe6dbc6); F.blk(B.walls, 6, X - t, 0, 7.6, rz1, rz1 + 0.8, 0xe6dbc6); F.col(-X + t, -6, rz1, rz1 + 0.8); F.col(6, X - t, rz1, rz1 + 0.8);
    F.blk(B.walls, -6, 6, 6.0, 7.6, rz1, rz1 + 0.8, 0xe6dbc6);
    for (const x of [-13.5, -6, 6, 13.5]) { F.blk(B.walls, x - 0.35, x + 0.35, 0, 7.6, rz0, rz1, 0xe6dbc6); F.col(x - 0.35, x + 0.35, rz0, rz1); }
    for (const x of [-17.2, -9.8, 9.8, 17.2]) F.blk(B.doors, x - 0.7, x + 0.7, st, 2.9, rz1 + 0.78, rz1 + 0.84);
    for (const sx of [-1, 1]) ionicCol(F, sx * 2.1, 0.7, rz1 + 0.4, 5.2, 0.3);
    F.blk(B.marble, -6, 6, 5.9, 6.3, rz1 - 0.1, rz1 + 0.9);
    F.blk(B.grey, -6, 6, -0.3, 0.7, rz0, rz1 + 0.8); F.blk(B.grey, -6, 6, -0.3, 0.45, rz1 + 0.8, rz1 + 1.3);
    F.plane(B.pave, -5.65, 5.65, rz0, rz1 + 0.8, 0.712);
    F.blk(B.wood, -5.65, 5.65, 5.94, 6.04, rz0, rz1 + 0.75);
    F.gnd(-5.65, 5.65, rz0, rz1 + 0.8, 0.7); F.gnd(-6, 6, rz1 + 0.8, rz1 + 1.3, 0.45);
    for (const [x0, x1, z0, z1] of [[-5.65, 5.65, rz0, rz0 + 0.6], [-5.65, -5.05, rz0 + 0.6, rz1 - 0.5], [5.05, 5.65, rz0 + 0.6, rz1 - 0.5]]) { F.blk(B.marble, x0, x1, 0.7, 1.15, z0, z1); F.col(x0, x1, z0, z1); }
    statueOn(F, 0, rz0 + 1.6, 0.7, 0, figs[3], 1.05, 1.1);
    F.poi('gather', 0, rz1 - 1.5, 0.7, undefined, { r: 2.5, note: 'ephebeion' });
    for (const x of [-4.2, -1.5, 1.5, 4.2]) F.poi('bench', x, rz0 + 0.3, 1.15, 0);
    F.add(B.roofs, ctx.kit.hipRoof(2 * X, rz1 + 0.8 - (-Z)), F.m(0, 7.6, (-Z + rz1 + 0.8) / 2), 0xb8714a); F.blk(B.walls, -X - 0.42, X + 0.42, 7.6, 7.7, -Z - 0.42, rz1 + 1.22, 0xd8ccb8);
    // base fill at court level, stylobate kerbs on the column lines, sand court, paved colonnades
    const cz0 = st - 0.2;
    F.blk(B.grey, -X + t, X - t, F.tmin(-X, X, rz1, Z) - 0.6, cz0, rz1 + 0.8, Z - t);
    F.blk(B.grey, -colX - 0.55, colX + 0.55, cz0 - 0.1, st, zN - 0.55, zN + 0.55); F.blk(B.grey, -colX - 0.55, colX + 0.55, cz0 - 0.1, st, zS - 0.55, zS + 0.55);
    for (const sx of [-1, 1]) F.blk(B.grey, sx * colX - 0.55, sx * colX + 0.55, cz0 - 0.1, st, zN + 0.55, zS - 0.55);
    F.plane(B.canvas, -colX + 0.55, colX - 0.55, zN + 0.55, zS - 0.55, cz0 + 0.012);
    for (const [x0, x1, z0, z1] of [[-X + t, X - t, rz1 + 0.8, zN - 0.55], [-X + t, X - t, zS + 0.55, Z - t], [-X + t, -colX - 0.55, zN - 0.55, zS + 0.55], [colX + 0.55, X - t, zN - 0.55, zS + 0.55]]) F.plane(B.pave, x0, x1, z0, z1, st + 0.012);
    for (const [x0, x1, z0, z1] of [[-X + t, X - t, rz1 + 0.8, zN + 0.55], [-X + t, X - t, zS - 0.55, Z - t], [-X + t, -colX + 0.55, zN + 0.55, zS - 0.55], [colX - 0.55, X - t, zN + 0.55, zS - 0.55]]) F.gnd(x0, x1, z0, z1, st);
    F.gnd(-colX + 0.55, colX - 0.55, zN + 0.55, zS - 0.55, cz0);
    // Doric colonnades on four sides
    const nx = 14, nz = 14, xsN = [], zsW = [], zc = (zN + zS) / 2;
    for (let i = 0; i < nx; i++) xsN.push(-colX + i * 2 * colX / (nx - 1));
    for (let i = 0; i < nz; i++) zsW.push(zN + i * (zS - zN) / (nz - 1));
    for (const x of xsN) for (const z of [zN, zS]) doricCol(F, x, st, z, ch, cr);
    for (const z of zsW.slice(1, -1)) for (const x of [-colX, colX]) doricCol(F, x, st, z, ch, cr);
    const withMids = a => a.flatMap((v, i) => i < a.length - 1 ? [v, (v + a[i + 1]) / 2] : [v]);
    const eTop = doricRun(F, -colX - 0.36, colX + 0.36, zN, st + ch, 0.72, withMids(xsN), [1, -1], 1.25);
    doricRun(F, -colX - 0.36, colX + 0.36, zS, st + ch, 0.72, withMids(xsN), [1, -1], 1.25);
    const triW = withMids(zsW).map(z => z - zc).filter(v => Math.abs(v) < (zS - zN) / 2 - 0.5);
    for (const sx of [-1, 1]) doricRun(F.sub(sx * colX, 0, zc, Math.PI / 2), -(zS - zN) / 2 + 0.36, (zS - zN) / 2 - 0.36, 0, st + ch, 0.72, triW, [1, -1], 1.24);
    // lean-to roofs over the colonnades
    F.add(B.roofs, leanRoof(2 * X - 1.0, rz1 + 0.6, 7.65, zN + 0.62, eTop + 0.02), F.m(), 0xbd7a50);
    F.add(B.roofs, leanRoof(2 * X - 1.0, Z + 0.2, wh + 0.05, zS - 0.62, eTop + 0.02), F.m(), 0xbd7a50);
    // the side roofs run on under the north range's eaves and out to the south corner, so every corner closes in a valley
    for (const sx of [-1, 1]) { const zr0 = rz1 + 0.6, zr1 = Z + 0.2, Fr = F.sub(0, 0, (zr0 + zr1) / 2, sx > 0 ? Math.PI / 2 : -Math.PI / 2); Fr.add(B.roofs, leanRoof(zr1 - zr0, X + 0.2, wh + 0.08, colX - 0.62, eTop + 0.04), Fr.m(), 0xc5895f); }
    // boarded ceilings on beams under the colonnade roofs
    const yC = st + ch + 0.95 * 1.25;
    for (const [z0c, z1c] of [[rz1 + 0.8, zN - 0.36], [zS + 0.36, Z - t]]) { F.blk(B.wood, -X + t, X - t, yC - 0.06, yC, z0c, z1c); for (const x of xsN) F.blk(B.woodDark, x - 0.12, x + 0.12, yC - 0.28, yC - 0.06, z0c, z1c); }
    for (const sx of [-1, 1]) { const xa = sx > 0 ? colX + 0.36 : -X + t, xb = sx > 0 ? X - t : -colX - 0.36; F.blk(B.wood, xa, xb, yC - 0.06, yC, zN - 0.36, zS + 0.36); for (const z of zsW) F.blk(B.woodDark, xa, xb, yC - 0.28, yC - 0.06, z - 0.12, z + 0.12); }
    F.area('palaestra court', -colX + 2, colX - 2, zN + 2, zS - 2, cz0);
    for (const [x, z] of [[-7, -4], [6, 2], [-3, 12], [8, 15]]) F.poi('gather', x, z, cz0, undefined, { r: 3, note: 'wrestling / training in the palaestra' });
    // court furniture: herms, basins, benches, oil jars, a jumping pit
    for (const sx of [-1, 1]) { const x = sx * 4.6, z = zN - 2.0; F.add(B.statue, hermGeo(), F.m(x, st, z)); F.col(x - 0.3, x + 0.3, z - 0.3, z + 0.3); }
    for (const z of [-6, 8]) { F.add(B.marble, basinGeo(), F.m(-X + t + 1.4, st, z, 0, 0, 0, 1.1)); F.col(-X + t + 0.7, -X + t + 2.1, z - 0.7, z + 0.7); F.poi('well', -X + t + 2.3, z, st, -Math.PI / 2, { r: 1.2, note: 'louterion (wash basin)' }); }
    for (const z of [-11, -5, 13, 18.5]) { F.blk(B.marble, X - t - 0.6, X - t, st, st + 0.45, z - 1.6, z + 1.6); F.col(X - t - 0.6, X - t, z - 1.6, z + 1.6); F.poi('bench', X - t - 0.3, z, st + 0.45, -Math.PI / 2); }
    for (let i = 0; i < 6; i++) jar(F, -18.9 + (i % 3) * 0.55, 23.4 + Math.floor(i / 3) * 0.6, st, 1.05);
    F.col(-19.5, -17.5, 23, 24.6);
    F.plane(B.gravel, -8, 8, zS - 5.5, zS - 1.5, cz0 + 0.03);
    for (const [xa, xb, za, zb] of [[-8.1, 8.1, zS - 5.6, zS - 5.45], [-8.1, 8.1, zS - 1.55, zS - 1.4], [-8.1, -7.95, zS - 5.45, zS - 1.55], [7.95, 8.1, zS - 5.45, zS - 1.55]]) F.blk(B.wood, xa, xb, cz0, cz0 + 0.12, za, zb);
    F.add(B.marble, rectSweep(1.6, 1.0, [{ o: 0.15, y: 0 }, { o: 0.15, y: 0.15, hard: true }, { o: 0, y: 0.25, hard: true }, { o: 0, y: 0.9, hard: true }, { o: 0.1, y: 1.0, hard: true }], { top: true }), F.m(0, cz0, zN + 2.6));
    F.col(-0.95, 0.95, zN + 1.95, zN + 3.25);
    F.poi('altar', 0, zN + 2.6, cz0, Math.PI, { r: 2.5, note: 'altar of Hermes and Herakles', spots: [F.spot(0, zN + 4.2, Math.PI)] });
    for (const [x, z] of [[-10, 20], [11, 5.5], [-12.5, -3]]) own.painted.add(new THREE.CylinderGeometry(0.11, 0.11, 0.04, 12), F.m(x, cz0 + 0.03, z), PAINT.bronze);
    F.blk(B.woodDark, -X + t + 0.1, -X + t + 0.25, st + 0.3, st + 1.6, 16, 19.5); for (let i = 0; i < 6; i++) F.add(B.wood, new THREE.CylinderGeometry(0.02, 0.02, 2.4, 5), F.m(-X + t + 0.35, st + 1.2, 16.4 + i * 0.55, 0.12, 0, -0.12));
    F.col(-X + t, -X + t + 0.6, 16, 19.5);
    // propylon on the avenue: stair inside the doorway, Doric columns, pediment facing east
    const FP = F.sub(20.9, 0, 3.8, Math.PI / 2), ybP = Math.min(FP.t(-4, 1.25), FP.t(0, 1.25), FP.t(4, 1.25)), nP = Math.max(2, Math.round((st - ybP) / 0.28));
    stairs(FP, B.grey, -4.0, 4.0, 1.1, -0.7, ybP, st, nP);
    for (const sx of [-1, 1]) { FP.blk(B.ashlar, sx * 4.0, sx * 4.7, FP.tmin(sx * 4.0, sx * 4.7, -1.5, 1.1) - 0.6, 0.7, -1.5, 1.1); FP.blk(B.walls, sx * 4.0, sx * 4.7, 0.7, st + 5.25, -1.5, 1.1, 0xebe1cf); FP.col(Math.min(sx * 4, sx * 4.7), Math.max(sx * 4, sx * 4.7), -1.5, 1.1); FP.blk(B.marble, sx * 3.92, sx * 4.78, st + 4.9, st + 5.25, 0.4, 1.18); doricCol(FP, sx * 1.5, st, -0.95, 5.25, 0.38); }
    const pT = doricRun(FP, -4.7, 4.7, -0.2, st + 5.25, 2.6, [-4.35, -3, -1.5, 0, 1.5, 3, 4.35], [1], 1.2);
    FP.blk(B.walls, -4.7, 4.7, 6.5, pT, -1.5, -1.15, 0xebe1cf);
    pedRoof(FP, { x0: -4.7, x1: 4.7, z0: -1.6, z1: 1.2, y: pT, pitch: 0.3, over: 0.35, color: 0xb46f48 });
    FP.plane(B.pave, -4.0, 4.0, -1.5, -0.7, st + 0.01); FP.gnd(-4.0, 4.0, -1.6, -0.7, st);
    FP.poi('door', 0, 1.6, FP.t(0, 1.6), 0, { nx: 1, nz: 0, note: 'gymnasium propylon' });
    FP.poi('gather', 0, 3.2, FP.t(0, 3.2), undefined, { r: 3, note: 'before the gymnasium gate' });
    // door from the west colonnade into the grove
    F.blk(B.marble, -X - 0.1, -X + t + 0.1, 3.4, 3.8, -12.3, -8.9);
    F.blk(B.marble, -X - 0.3, -X + t, F.tmin(-X - 0.3, -X + t, -12.2, -9.0) - 0.6, st + 0.02, -12.2, -9.0); F.gnd(-X - 0.3, -X + t, -12.2, -9.0, st + 0.02);
    // ---- grove terrace (upper) and running terrace (lower) ----
    const LU = LG + st, x0 = rect.minX, x1 = pcx - X, zs0 = 214.3, zs1 = 216.8;
    const LL = tMax({ minX: x0, maxX: x1, minZ: zs1, maxZ: rect.maxZ }) + 0.15;
    const W = frame(Sx, 0, 0, 0, 0);
    const bw = (xa, xb, za, zb, top, cap = true) => { W.blk(B.ashlar, xa, xb, tMin({ minX: xa, maxX: xb, minZ: za, maxZ: zb }) - 0.6, top - 1.6, za, zb); W.blk(B.walls, xa + 0.01, xb - 0.01, top - 1.6, top, za + 0.01, zb - 0.01, 0xe6dbc6); if (cap) W.blk(B.marble, xa - 0.06, xb + 0.06, top, top + 0.14, za - 0.06, zb + 0.06); W.col(xa, xb, za, zb); };
    bw(x0, x1, rect.minZ + 0.5, rect.minZ + 1.3, LU + 3.2);
    bw(x0, x0 + 0.8, rect.minZ + 1.3, 197.5, LU + 3.2); bw(x0, x0 + 0.8, 200.5, zs1, LU + 3.2); bw(x0, x0 + 0.8, zs1, rect.maxZ - 7.3, LL + 3.2);
    for (const sx of [-1, 1]) W.blk(B.marble, x0 - 0.1, x0 + 0.9, LU - 0.3, LU + 3.2, sx > 0 ? 200.47 : 197.2, sx > 0 ? 200.8 : 197.53);
    W.blk(B.marble, x0 - 0.15, x0 + 0.95, LU + 3.2, LU + 3.55, 197, 201);
    const ybG = TH(x0 - 0.5, 199);
    stairs(frame(Sx, x0, 0, 199, Math.PI / 2), B.grey, -1.5, 1.5, -0.4, 1.2, ybG, LU, Math.max(2, Math.round((LU - ybG) / 0.25)));
    // a planted bed along the north wall (the hillside is higher there), kerbed off from the gravel
    const bz1 = 191.6, kTop = Math.max(LU + 0.3, tMax({ minX: x0 + 0.8, maxX: x1, minZ: rect.minZ + 1.3, maxZ: bz1 }) + 0.12);
    W.blk(B.grey, x0 + 0.8, x1, tMin({ minX: x0, maxX: x1, minZ: bz1 - 0.35, maxZ: bz1 }) - 0.4, kTop, bz1 - 0.35, bz1); W.blk(B.marble, x0 + 0.8, x1, kTop, kTop + 0.06, bz1 - 0.4, bz1 + 0.04); W.col(x0 + 0.8, x1, bz1 - 0.35, bz1);
    W.plane(B.gravel, x0 + 0.8, x1, bz1, zs0, LU + 0.01);
    W.gnd(x0 + 0.8, x1, bz1, zs0, LU);
    // seat-steps down to the running terrace, with seats for spectators
    const nS = 6, sR = (LU - LL) / nS, sT = (zs1 - zs0) / nS;
    for (let i = 0; i < nS; i++) W.blk(B.grey, x0 + 0.8, x1, LL - 0.8, LU - sR * i, zs0 + sT * i, zs0 + sT * (i + 1));
    W.gnd(x0 + 0.8, x1, zs0, zs1, (x, z) => LU - sR * clamp(Math.floor((z - zs0) / sT), 0, nS - 1));
    for (let x = x0 + 4; x < x1 - 2; x += 3.2) W.poi('seat', x, zs0 + sT * 1.5, LU - sR, 0, { note: 'watching the runners' });
    W.plane(B.gravel, x0 + 0.8, x1, zs1, 222.2, LL + 0.01);
    W.plane(B.canvas, x0 + 0.8, x1, 222.2, rect.maxZ - 8.3, LL + 0.02);
    W.gnd(x0 + 0.8, x1, zs1, rect.maxZ - 8.3, LL);
    for (const xb of [x0 + 3.5, x1 - 3]) { W.blk(B.grey, xb - 0.3, xb + 0.3, LL - 0.2, LL + 0.06, 222.6, rect.maxZ - 9.6); for (const zz of [224.8, 227.4, 230]) W.blk(B.marble, xb - 0.12, xb + 0.12, LL, LL + 1.1, zz - 0.12, zz + 0.12); }
    W.area('paradromis (running track)', x0 + 4, x1 - 3.5, 223, rect.maxZ - 10, LL);
    W.poi('view', x1 - 4, zs1 + 1.5, LL, -Math.PI / 2, { note: 'along the running track' });
    // xystos: covered running track along the south, colonnade facing north
    const FX = frame(Sx, (x0 + x1) / 2, LL, rect.maxZ - 4.1, Math.PI);
    stoa(FX, { len: x1 - x0, depth: 8.2, colH: 4.3, colR: 0.31, wallTop: 7.0, floor: B.canvas, benches: false, pilasters: true });
    FX.area('xystos (covered track)', -(x1 - x0) / 2 + 1.5, (x1 - x0) / 2 - 1.5, -2.5, 3, 0.3);
    // grove: plane trees, exedra facing the track, herms, a victor statue, basin
    [[x0 + 8, 193.4], [x0 + 22, 195.5], [x0 + 32, 193.2], [x0 + 6, 206.5], [x0 + 28, 207], [x0 + 12.5, 212.4], [x0 + 33.5, 207.3], [x0 + 2.4, 211.6]].forEach(([x, z], i) => tree(W, x, z, LU, 0.9 + R() * 0.25, planeTrees[i % 2], [0x6a874a, 0x718e50][i % 2]));
    [[x0 + 5.5, 1], [x0 + 11, 0], [x0 + 17, 1], [x0 + 23, 0], [x0 + 29, 1], [x0 + 34.5, 0]].forEach(([x, k], i) => tree(W, x, 189.6, TH(x, 189.6), k ? 0.8 + R() * 0.15 : 1.05 + R() * 0.2, k ? planeTrees[i % 2] : trees[i % 4], k ? 0x6d8a4c : 0x5d7a45));
    const ex = x0 + 17.5, ez = 208.5;
    exedra(W, ex, LU, ez, 3.3, 3.9, 4.3, 1.3, Math.PI, 'gymnasium exedra');
    for (const [x, z] of [[x0 + 12, 201], [x0 + 24, 201], [x0 + 35.5, 196]]) { W.add(B.statue, hermGeo(), W.m(x, LU, z, 0, Math.PI * (x > x0 + 30 ? -0.5 : 0), 0)); W.col(x - 0.3, x + 0.3, z - 0.3, z + 0.3); }
    statueOn(W, x0 + 33, 211.5, LU, Math.PI, figs[3], 1.0, 1.4);
    W.add(B.marble, basinGeo(), W.m(x0 + 3, LU, 193.6, 0, 0, 0, 1.15)); W.col(x0 + 2.2, x0 + 3.8, 192.8, 194.4); W.poi('well', x0 + 4.4, 193.6, LU, -Math.PI / 2, { r: 1.2, note: 'wash basin in the grove' });
    // benches along the path from the west gate to the palaestra door, a decree stele, oil jars by the door
    for (const [x, z, ry] of [[x0 + 15, 197, 0], [x0 + 32, 205.1, Math.PI]]) { W.blk(B.marble, x - 1.5, x + 1.5, LU, LU + 0.45, z - 0.25, z + 0.25); W.col(x - 1.5, x + 1.5, z - 0.25, z + 0.25); for (const dx of [-0.8, 0.8]) W.poi('bench', x + dx, z, LU + 0.45, ry); }
    { const x = x0 + 2.2, z = 203.4; W.blk(B.marble, x - 0.35, x + 0.35, LU, LU + 0.25, z - 0.6, z + 0.6); W.add(B.marble, box(0.2, 1.8, 0.9), W.m(x, LU + 1.15, z)); W.add(B.marble, triGeo(0.5, 0.3, 0.22), W.m(x, LU + 2.05, z, 0, Math.PI / 2, 0).multiply(mat(0, 0, -0.11))); W.col(x - 0.4, x + 0.4, z - 0.65, z + 0.65); }
    for (let i = 0; i < 4; i++) jar(W, x1 - 0.5 - (i % 2) * 0.5, 199.4 + i * 0.5, LU + 0.01, 0.9 + (i % 3) * 0.1); W.col(x1 - 1.3, x1, 199.1, 201.3);
    W.poi('gather', x0 + 15, 200, LU, undefined, { r: 3, note: 'gymnasium grove' });
    W.area('gymnasium grove', x0 + 2, x1 - 2, bz1 + 1, zs0 - 1, LU);
    Sx.commit();
  }

  // ======================================================================================
  // D  Bouleuterion: hall with tiers on three sides, Doric hexastyle porch toward the avenue
  // ======================================================================================
  function buildBoule(rect) {
    const Sx = site('boule'), cxw = 121, czw = (rect.minZ + rect.maxZ) / 2;
    const base = tMax({ minX: 104, maxX: 138.5, minZ: czw - 15, maxZ: czw + 15 }), LB = base + 0.96, F = frame(Sx, cxw, LB, czw, Math.PI / 2);
    // local: +z east (front), +x north.  hall x ±12, z -15..9; porch z 9..15.6
    const HX = 12, z0 = -15, z1 = 9, zp = 15.6, wh = 8.0, t = 1.0;
    F.blk(B.ashlar, -HX - 1.95, HX + 1.95, base - LB - 1.2, -0.96, z0 - 1.95, zp + 1.35);
    for (let i = 0; i < 3; i++) { const e = 0.45 * (3 - i); F.blk(B.grey, -HX - 0.6 - e, HX + 0.6 + e, -0.96 + 0.32 * i, -0.96 + 0.32 * (i + 1), z0 - 0.6 - e, zp + e); F.gnd(-HX - 0.6 - e, HX + 0.6 + e, z0 - 0.6 - e, zp + e, -0.96 + 0.32 * (i + 1)); }
    // front stair: its lowest tread clears the uphill end of the foot; a stepped kerb takes up the fall of the street at the downhill end
    { const fx = [-7.5, -5, -2.5, 0, 2.5, 5, 7.5], tAt = x => Math.max(F.t(x, 18.4), F.t(x, 18.8), F.t(x, 19.2), F.t(x, 19.7)), yMin = Math.min(...fx.map(x => Math.min(F.t(x, 19.2), F.t(x, 19.7)))), yMax = Math.max(...fx.map(tAt));
      let yb = yMin, nf = 1, rise = 0;
      for (let it = 0; it < 3; it++) { nf = Math.max(1, Math.round((-0.64 - yb) / 0.3)); rise = (-0.64 - yb) / nf; yb = Math.max(yMin, yMax - rise - 0.03); }
      if (yb < -0.9) {
        stairs(F, B.grey, -7.5, 7.5, 19.2, zp + 1.35, yb, -0.64, nf);
        for (const [xa, xb] of [[-7.5, -2.5], [-2.5, 2.5], [2.5, 7.5]]) {
          const s = [xa, (xa + xb) / 2, xb].flatMap(x => [F.t(x, 19.2), F.t(x, 19.7)]), sMin = Math.min(...s), sMax = Math.max(...s), y1 = yb + rise;
          if (y1 - sMin > 0.34) { const k = Math.min(y1 - 0.12, Math.max(sMax + 0.03, (y1 + sMin) / 2)); F.blk(B.grey, xa, xb, sMin - 0.4, k, 19.2, 19.75); F.gnd(xa, xb, 19.2, 19.75, k); }
        }
      } }
    const sw = (x0, x1, za, zb, y0 = 0, y1 = wh) => { F.blk(B.ashlar, x0, x1, y0, y1, za, zb); };
    sw(-HX, -HX + t, z0, z1); sw(HX - t, HX, z0, z1); sw(-HX + t, HX - t, z0, z0 + t);
    sw(-HX + t, -1.7, z1 - t, z1); sw(1.7, HX - t, z1 - t, z1); sw(-1.7, 1.7, z1 - t, z1, 5.4, wh);
    F.col(-HX, -HX + t, z0, z1); F.col(HX - t, HX, z0, z1); F.col(-HX, HX, z0, z0 + t); F.col(-HX, -1.7, z1 - t, z1); F.col(1.7, HX, z1 - t, z1);
    for (const [xa, xb, za, zb] of [[-HX - 0.06, HX + 0.06, z0 - 0.06, z0 + 0.3], [-HX - 0.06, -HX + 0.3, z0 + 0.3, z1 + 0.06], [HX - 0.3, HX + 0.06, z0 + 0.3, z1 + 0.06]]) F.blk(B.grey, xa, xb, 0, 1.0, za, zb);
    for (const sx of [-1, 1]) for (const [xa, xb] of [[2.25, 5.0], [6.8, HX - 0.3]]) F.blk(B.grey, sx * xa, sx * xb, 0, 1.0, z1 - 0.3, z1 + 0.06);
    // door frame + open leaves (swung flat into the hall, clear of the bema), side doors (closed) in marble frames
    for (const sx of [-1, 1]) { F.blk(B.marble, sx * 1.7, sx * 2.25, 0, 5.75, z1, z1 + 0.12); doorLeaf(F, sx * 1.7, z1 - t - 0.07, 1.62, 5.3, 0, 1.6, sx, -1); }
    F.blk(B.marble, -2.6, 2.6, 5.4, 6.0, z1, z1 + 0.16);
    for (const sx of [-1, 1]) { F.blk(B.doors, sx * 5.2, sx * 6.6, 0, 3.4, z1 + 0.07, z1 + 0.1); F.blk(B.marble, sx * 5.0, sx * 6.8, 3.4, 3.7, z1, z1 + 0.12); for (const [a, b] of [[5.0, 5.2], [6.6, 6.8]]) F.blk(B.marble, sx * a, sx * b, 0, 3.4, z1, z1 + 0.12); }
    // windows and pilasters
    for (const sx of [-1, 1]) for (const z of [-11.5, -6.5, -1.5, 3.5]) { F.blk(B.doors, sx * (HX - t - 0.02), sx * (HX + 0.02), 6.3, 7.5, z - 0.65, z + 0.65); F.blk(B.marble, sx * (HX - 0.1), sx * (HX + 0.12), 6.15, 6.3, z - 0.85, z + 0.85); }
    for (const x of [-6, 0, 6]) { F.blk(B.doors, x - 0.65, x + 0.65, 6.3, 7.5, z0 - 0.02, z0 + t + 0.02); F.blk(B.marble, x - 0.85, x + 0.85, 6.15, 6.3, z0 - 0.12, z0 + 0.1); }
    for (const sx of [-1, 1]) for (const z of [-14.2, -9, -4, 1, 6.4]) F.blk(B.ashlar, sx * HX, sx * (HX + 0.16), 1.0, wh, z - 0.4, z + 0.4);
    // porch: Doric hexastyle
    const pxs = [-11.25, -6.75, -2.25, 2.25, 6.75, 11.25];
    for (const x of pxs) doricCol(F, x, 0, zp - 0.75, wh, 0.6);
    const eT = doricRun(F, -HX, HX, zp - 0.75, wh, 1.5, triPos(pxs, -HX, HX), [1], 1.5);
    for (const sx of [-1, 1]) { const Fr = F.sub(sx * (HX - 0.6), 0, (z0 + zp - 1.5) / 2, Math.PI / 2), h = (zp - 1.5 - z0) / 2; doricRun(Fr, -h, h, 0, wh, 1.2, [], [], 1.49); }
    doricRun(F, -HX + 1.2, HX - 1.2, z0 + 0.6, wh, 1.2, [], [], 1.49); F.blk(B.ashlar, -HX + t, HX - t, wh, eT, z1 - t, z1);
    F.blk(B.wood, -HX + 0.2, HX - 0.2, wh + 0.68, wh + 0.78, z1, zp - 1.4);
    F.blk(B.wood, -HX + t, HX - t, wh - 0.1, wh, z0 + t, z1 - t); for (let z = z0 + 2.5; z < z1 - 1; z += 2.4) F.blk(B.woodDark, -HX + t, HX - t, wh - 0.45, wh - 0.1, z - 0.18, z + 0.18); for (const x of [-5.1, 5.1]) F.blk(B.woodDark, x - 0.25, x + 0.25, wh - 0.75, wh - 0.45, z0 + t, z1 - t);
    const pr = pedRoof(F, { x0: -HX, x1: HX, z0: z0 - 0.3, z1: zp - 0.75 + 0.9, y: eT, pitch: 0.26, over: 0.5, color: 0xa8654a, tymp: PAINT.oxblood });
    for (const x of [-4.6, 0, 4.6]) { const m = F.m(x, eT + pr.at * (1 - Math.abs(x) / pr.ht) * 0.42, zp - 0.75 + 0.9 - 0.1); own.painted.add(lathe([[0.02, 0.2], [0.18, 0.18], [0.5, 0.08], [0.66, 0.02], [0.68, 0]], 18).rotateX(Math.PI / 2), m, PAINT.gilt); }
    F.plane(B.pave, -HX + 0.3, HX - 0.3, z1 + 0.1, zp, 0.012);
    F.poi('gather', -6, 12.2, 0, undefined, { r: 3, note: 'bouleuterion porch' }); F.poi('gather', 6, 12.2, 0, undefined, { r: 3, note: 'bouleuterion porch' });
    F.poi('door', 0, z1 + 0.6, 0, 0, { nx: 1, nz: 0, note: 'bouleuterion' });
    F.area('bouleuterion porch', -HX + 1, HX - 1, z1 + 0.5, zp - 1.4, 0);
    // interior: floor, tiers of benches on three sides, pillars, altar, bema
    F.plane(B.pave, -HX + t, HX - t, z0 + t, z1 - t, 0.012);
    const nr = 7, rs = 0.4, rt = 0.8, zi = z0 + t, xi = HX - t, zSide = 4.8;
    for (let r = 0; r < nr; r++) {
      const h = rs * (nr - r);
      F.blk(B.grey, -xi, xi, 0, h, zi + rt * r, zi + rt * (r + 1));
      for (const sx of [-1, 1]) F.blk(B.grey, sx * (xi - rt * r), sx * (xi - rt * (r + 1)), 0, h, zi + rt * nr, zSide);
    }
    const tier = d => d >= 0 && d < rt * nr ? rs * (nr - Math.floor(d / rt)) : -Infinity;
    F.gnd(-xi, xi, zi, zSide, (lx, lz) => Math.max(tier(lz - zi), lz >= zi + rt * nr ? Math.max(tier(xi - lx), tier(lx + xi)) : -Infinity, 0));
    F.gnd(-xi, xi, zSide, z1 - t, 0);
    for (const sx of [-1, 1]) for (const [zz, k] of [[zi + rt * nr, 5], [zSide, 6]]) F.col(Math.min(sx * (xi - rt * k), sx * xi), Math.max(sx * (xi - rt * k), sx * xi), zz - 0.06, zz + 0.06);   // no stepping off the tall ends of the side tiers
    for (const sx of [-1, 1]) for (const z of [-7.6, 3.2]) { F.blk(B.marble, sx * 5.1 - 0.35, sx * 5.1 + 0.35, 0, wh - 0.15, z - 0.35, z + 0.35); F.col(sx * 5.1 - 0.4, sx * 5.1 + 0.4, z - 0.4, z + 0.4); }
    F.add(B.marble, rectSweep(1.1, 0.8, [{ o: 0.12, y: 0 }, { o: 0.12, y: 0.12, hard: true }, { o: 0, y: 0.22, hard: true }, { o: 0, y: 0.85, hard: true }, { o: 0.1, y: 0.95, hard: true }], { top: true }), F.m(0, 0, -2));
    F.col(-0.7, 0.7, -2.55, -1.45);
    F.blk(B.grey, -1.6, 1.6, 0, 0.45, 5.4, 6.8);
    F.gnd(-1.6, 1.6, 5.4, 6.8, 0.45);
    F.poi('altar', 0, -2, 0, Math.PI, { r: 2.5, note: 'altar of Hestia Boulaia', spots: [F.spot(0, -0.6, Math.PI)] });
    F.poi('gather', 0, 6.1, 0.45, Math.PI, { r: 1.2, note: 'speaker on the bema' });
    for (let r = 1; r < nr; r += 2) {
      for (const x of [-8, -3, 3, 8]) F.poi('seat', x, zi + rt * (r + 0.5), rs * (nr - r), 0, { note: 'council bench' });
      for (const sx of [-1, 1]) for (const z of [-4, 0, 3.5]) F.poi('seat', sx * (xi - rt * (r + 0.5)), z, rs * (nr - r), sx > 0 ? -Math.PI / 2 : Math.PI / 2, { note: 'council bench' });
    }
    F.area('bouleuterion hall', -5.4, 5.4, -8, 4.5, 0);
    // forecourts: honorific statues and decree stelai (south, toward the agora), trees and benches (north)
    const fy = (lx, lz) => F.t(lx, lz);
    for (const [x, z, fi] of [[-19.5, -6, 0], [-19.5, 3, 2], [-19.5, 12, 1]]) statueOn(F, x, z, fy(x, z) - 0.1, 0, figs[fi], 1.1, 1.8);
    for (let i = 0; i < 5; i++) { const x = -15.5, z = -12 + i * 2.2, y = fy(x, z); F.add(B.marble, box(0.2, 1.9, 0.85), F.m(x, y + 0.85, z)); F.add(B.marble, triGeo(0.48, 0.3, 0.22), F.m(x, y + 1.8, z, 0, Math.PI / 2, 0).multiply(mat(0, 0, -0.11))); }
    F.col(-15.8, -15.2, -12.6, -2.6);
    for (const [x, z] of [[19, -8], [22, 4], [18.5, 10]]) tree(F, x, z, fy(x, z), 1.0, planeTrees[(x > 20) ? 1 : 0], 0x6a874a);
    for (const z of [-3, 7]) { const x = 16.2, y = fy(x, z); F.blk(B.marble, x - 0.3, x + 0.3, y - 0.3, y + 0.45, z - 1.6, z + 1.6); F.col(x - 0.3, x + 0.3, z - 1.6, z + 1.6); F.poi('bench', x, z, y + 0.45, -Math.PI / 2); }
    F.poi('gather', -22, 0, fy(-22, 0), undefined, { r: 4, note: 'before the bouleuterion, toward the agora' });
    Sx.commit();
  }

  // ======================================================================================
  // E  Salmakis: temple of Aphrodite and Hermes on the upper terrace, altar court below, spring at the foot
  // ======================================================================================
  function buildSalmakis() {
    const Sx = site('salmakis');
    const xT = -471, zT = 547;
    const a0 = -481, a1 = -461.5, b0 = 536, b1 = 558;
    const T1 = tStat({ minX: a0, maxX: a1, minZ: b0, maxZ: b1 }, Math.max, 0.5) + 0.05, T2 = T1 - 4.2;   // the whole paved terrace clears the hillside
    const W = frame(Sx, 0, 0, 0, 0);
    const tmn = (xa, xb, za, zb) => tMin({ minX: xa, maxX: xb, minZ: za, maxZ: zb });
    const wallRet = (xa, xb, za, zb, top, par = 1.0) => { W.blk(B.ashlar, xa, xb, tmn(xa, xb, za, zb) - 0.8, top + par, za, zb); if (par > 0) W.blk(B.marble, xa - 0.05, xb + 0.05, top + par, top + par + 0.12, za - 0.05, zb + 0.05); W.col(xa, xb, za, zb); };
    // upper terrace T1 built out from the hillside, walled on the uphill side too; a side flight at the north-west corner
    W.blk(B.ashlar, a0, a1, tmn(a0, a1, b0, b1) - 0.6, T1, b0, b1);
    W.plane(B.pave, a0, a1, b0, b1, T1 + 0.015);
    W.gnd(a0, a1, b0, b1, T1);
    const gx0 = a0 + 0.5, gx1 = a0 + 2.9;   // gate in the north wall, reached by the sacred way from the town
    wallRet(a0 - 0.8, gx0, b0 - 0.8, b0, T1); wallRet(gx1, a1, b0 - 0.8, b0, T1); wallRet(a0 - 1.5, a1, b1, b1 + 0.8, T1); wallRet(a0 - 0.8, a0, b0, b1, T1);
    W.blk(B.marble, gx0, gx1, tmn(gx0, gx1, b0 - 0.8, b0) - 0.8, T1 + 0.02, b0 - 0.8, b0); W.gnd(gx0, gx1, b0 - 0.8, b0, T1 + 0.02);
    for (const x of [gx0, gx1]) W.blk(B.marble, x - 0.14, x + 0.14, T1, T1 + 1.3, b0 - 0.86, b0 + 0.06);
    // temple of Aphrodite and Hermes: Ionic tetrastyle prostyle, facing east over the harbour
    const FT = frame(Sx, xT, T1, zT, Math.PI / 2);
    const tp = ionicTemple(FT, { w: 8.2, d: 12.8, steps: 3, rise: 0.3, tread: 0.38, n: 4, colH: 5.6, colR: 0.3, amphi: false, cellaX: 3.5, antaZ: 3.3, doorZ: 1.8, backZ: 0, roof: 0xc07a50, pitch: 0.3 });
    FT.poi('gather', 0, 5.3, tp.sty, 0, { r: 1.8, note: 'porch of the temple of Aphrodite and Hermes' });
    // altar court T2 below, retaining walls with buttresses, stair up to the temple terrace
    const c0 = -461.5, c1 = -445, d0 = 532, d1 = 562;
    W.blk(B.ashlar, c0, c1 - 0.8, tmn(c0, c1, d0, d1) - 0.8, T2, d0 + 0.8, d1 - 0.8);
    W.blk(B.ashlar, -458, -454, tmn(-458, -454, d1 - 0.8, d1) - 0.8, T2, d1 - 0.8, d1);
    for (const zb of [534, 538.2, 554.2, 558.4]) { W.blk(B.ashlar, c1, c1 + 0.9, tmn(c1, c1 + 1, zb, zb + 1.6) - 0.8, T2 - 1.2, zb, zb + 1.6); W.col(c1, c1 + 0.9, zb, zb + 1.6); }
    W.plane(B.pave, c0, c1 - 0.8, d0 + 0.8, d1 - 0.8, T2 + 0.015);
    W.gnd(c0, c1 - 0.8, d0 + 0.8, d1 - 0.8, T2);
    wallRet(c1 - 0.8, c1, d0, d1, T2); wallRet(c0, c1 - 0.8, d0, d0 + 0.8, T2); wallRet(c0, -458, d1 - 0.8, d1, T2); wallRet(-454, c1 - 0.8, d1 - 0.8, d1, T2);
    stairs(frame(Sx, c0 + 2.5, 0, zT, Math.PI / 2), B.grey, -7, 7, 3.8, -2.5, T2, T1, 14, 0.4);
    for (const [za, zb] of [[zT - 8, zT - 7], [zT + 7, zT + 8]]) { W.blk(B.ashlar, c0, c0 + 6.3, T2 - 0.2, T1 + 0.9, za, zb); W.blk(B.marble, c0 - 0.05, c0 + 6.35, T1 + 0.9, T1 + 1.02, za - 0.05, zb + 0.05); W.col(c0, c0 + 6.3, za, zb); }
    for (const [za, zb] of [[d0 + 0.8, zT - 8], [zT + 8, d1 - 0.8]]) { W.blk(B.ashlar, c0, c0 + 0.6, T2 - 0.2, T1 + 0.9, za, zb); W.blk(B.marble, c0 - 0.05, c0 + 0.65, T1 + 0.9, T1 + 1.02, za, zb); W.col(c0, c0 + 0.6, za, zb); }
    // altar, statues of Aphrodite and Hermes, benches and trees, the view
    const ax = -451.8;
    W.add(B.marble, rectSweep(2.4, 4.4, [{ o: 0.25, y: 0 }, { o: 0.25, y: 0.2, hard: true }, { o: 0, y: 0.35, hard: true }, { o: 0, y: 1.2, hard: true }, { o: 0.12, y: 1.3 }, { o: 0.2, y: 1.42, hard: true }], { top: true }), W.m(ax, T2, zT));
    W.blk(own.painted, ax - 0.8, ax + 0.8, T2 + 1.42, T2 + 1.47, zT - 1.6, zT + 1.6, PAINT.ash);
    W.add(own.terra, jarGeo(), W.m(ax + 0.9, T2 + 1.42, zT - 1.9, 0, 0, 0, 0.5), 0xb86d44);
    W.col(ax - 1.5, ax + 1.5, zT - 2.5, zT + 2.5);
    W.poi('altar', ax, zT, T2, -Math.PI / 2, { r: 4, note: 'altar of Aphrodite and Hermes', spots: [W.spot(ax + 2.4, zT - 1, -Math.PI / 2), W.spot(ax + 2.4, zT + 1, -Math.PI / 2)] });
    statueOn(W, ax, d0 + 4.3, T2, 0, figs[4], 1.1, 1.6);
    statueOn(W, ax, d1 - 4.3, T2, Math.PI, figs[1], 1.1, 1.6);
    for (const z of [541, 553]) { W.blk(B.marble, c1 - 1.4, c1 - 0.8, T2, T2 + 0.45, z - 1.6, z + 1.6); W.col(c1 - 1.4, c1 - 0.8, z - 1.6, z + 1.6); W.poi('bench', c1 - 1.1, z, T2 + 0.45, -Math.PI / 2); }
    for (const [x, z] of [[-458.5, 535.4], [-448.6, 558.4]]) tree(W, x, z, T2, 0.85, trees[(z > 550) ? 1 : 2], 0x62804a);
    const vx = c1 - 1.4, vz = d0 + 1.6;
    W.poi('view', vx, vz, T2, Math.atan2(-vx, -vz), { note: 'over the harbour to the Mausoleum' });
    W.poi('view', c1 - 1.6, zT + 1, T2, Math.PI / 2 - 0.3, { note: 'over the harbour mouth' });
    W.poi('gather', -455.5, zT - 9.5, T2, undefined, { r: 2.5, note: 'sanctuary of Aphrodite and Hermes' });
    W.area('Salmakis altar court', c0 + 6, c1 - 1.5, d0 + 1.5, d1 - 1.5, T2);
    // flight up along the south face of the court wall, from the stepped path
    const fz0 = d1, fz1 = d1 + 3.6, fx0 = c1 + 5, fx1 = -457, fyb = TH(fx0, (fz0 + fz1) / 2), nF = Math.max(4, Math.round((T2 - fyb) / 0.3)), fr = (fx0 - fx1) / nF;
    for (let i = 0; i < nF; i++) { const xa = fx0 - fr * (i + 1), xb = fx0 - fr * i; W.blk(B.ashlar, xa, xb, tmn(xa, xb, fz0, fz1) - 0.8, fyb + (T2 - fyb) * (i + 1) / nF, fz0, fz1); }
    W.gnd(fx1, fx0, fz0, fz1, (x, z) => fyb + (T2 - fyb) * clamp(Math.floor((fx0 - x) / fr) + 1, 1, nF) / nF);
    W.blk(B.ashlar, -459, fx1, tmn(-459, fx1, fz0, fz1) - 0.6, T2, fz0, fz1); W.gnd(-459, fx1, d1 - 0.8, fz1, T2); W.gnd(-458, -454, d1 - 0.8, d1, T2);
    W.blk(B.ashlar, -459.6, -459, T2 - 1, T2 + 1.0, fz0, fz1); W.col(-459.6, -459, fz0, fz1);
    // stepped path down the slope to a stone landing at the water's edge
    let px = fx0, py = fyb;
    while (px < -408.5) {
      const nxp = px + 1.1, tn = Math.min(TH(nxp, fz0), TH(nxp, fz1));
      if (tn < SEA + 0.9) break;
      const ty = Math.max(TH(nxp, fz0), TH(nxp, fz1), TH(px, fz0), TH(px, fz1)) + 0.1, top = Math.max(Math.min(py, ty + 0.25), ty);
      W.blk(B.ashlar, px, nxp, tmn(px, nxp, fz0, fz1) - 0.6, top, fz0, fz1); W.gnd(px, nxp, fz0, fz1, top);
      py = top; px = nxp;
    }
    const lx1 = Math.max(px + 4, -400.5), lz0 = fz0 - 1.5, lz1 = fz1 + 1.8, ly = Math.max(SEA + 1.2, Math.min(py - 0.2, tMax({ minX: px, maxX: lx1, minZ: lz0, maxZ: lz1 }) + 0.15));
    W.blk(B.ashlar, px, lx1, SEA - 3, ly, lz0, lz1); W.plane(B.pave, px, lx1, lz0, lz1, ly + 0.012); W.gnd(px, lx1, lz0, lz1, ly);
    for (const [xa, xb, za, zb] of [[px + 3, lx1, lz0, lz0 + 0.35], [px + 3, lx1 - 4.2, lz1 - 0.35, lz1], [lx1 - 0.35, lx1, lz0 + 0.35, lz1]]) { W.blk(B.ashlar, xa, xb, ly, ly + 0.14, za, zb); W.col(xa, xb, za, zb); }   // kerbs on the landing's sea sides
    const bollard = (x, z) => { B.ashlar.add(new THREE.CylinderGeometry(0.28, 0.35, 0.9, 8), W.m(x, ly + 0.45, z)); W.col(x - 0.3, x + 0.3, z - 0.3, z + 0.3); };
    bollard(lx1 - 0.7, lz0 + 0.6);
    W.poi('view', px + 2.5, (lz0 + lz1) / 2, ly, Math.atan2(-(px + 2.5), -(lz0 + lz1) / 2), { note: 'landing below the Salmakis spring' });
    // a short stone mole runs on south from the landing into water deep enough for a boat to lie alongside
    { const m = { minX: lx1 - 4.2, maxX: lx1, minZ: lz1, maxZ: lz1 + 17 };
      let clear = !layout.reserved.some(o => o.owner !== OWNER && o.minX < m.maxX && o.maxX > m.minX && o.minZ < m.maxZ && o.maxZ > m.minZ);
      for (let x = m.minX; x <= m.maxX && clear; x += 1) for (let z = m.minZ + 0.5; z <= m.maxZ; z += 1) if (world.blocked(x, z)) clear = false;
      if (clear) {
        W.blk(B.ashlar, m.minX, m.maxX, SEA - 3, ly, m.minZ, m.maxZ); W.plane(B.pave, m.minX, m.maxX, m.minZ, m.maxZ, ly + 0.012); W.gnd(m.minX, m.maxX, m.minZ, m.maxZ, ly);
        for (const [xa, xb, za, zb] of [[m.minX - 0.05, m.minX + 0.35, m.minZ, m.maxZ], [m.maxX - 0.35, m.maxX + 0.05, m.minZ - 0.35, m.maxZ], [m.minX - 0.05, m.maxX + 0.05, m.maxZ - 0.35, m.maxZ + 0.05]]) { W.blk(B.ashlar, xa, xb, ly, ly + 0.14, za, zb); W.col(xa, xb, za, zb); }
        for (const z of [m.minZ + 5.5, m.minZ + 11, m.maxZ - 1]) bollard(m.maxX - 0.75, z);
        W.poi('view', (m.minX + m.maxX) / 2, m.maxZ - 1.5, ly, Math.atan2(-((m.minX + m.maxX) / 2), -(m.maxZ - 1.5)), { note: 'end of the Salmakis mole, looking across the harbour' });
      } }
    // the Salmakis spring: basin at the foot of the court wall, lion-head spouts in a small aedicula
    const sz0 = zT - 4.5, sz1 = zT + 4.5, sx1 = c1 + 3.6;
    const sy = tMax({ minX: c1, maxX: sx1 + 2.5, minZ: sz0, maxZ: sz1 }) + 0.55, sb = tmn(c1, sx1, sz0, sz1) - 0.6;
    const ry0 = sy - 0.3;   // basin rim, knee-high above the platform
    W.blk(B.marble, c1, sx1, sb, ry0, sz0, sz0 + 0.35); W.blk(B.marble, c1, sx1, sb, ry0, sz1 - 0.35, sz1); W.blk(B.marble, sx1 - 0.35, sx1, sb, ry0, sz0 + 0.35, sz1 - 0.35);
    W.blk(B.marble, c1 - 0.02, sx1 + 0.06, ry0, ry0 + 0.08, sz0 - 0.04, sz0 + 0.4); W.blk(B.marble, c1 - 0.02, sx1 + 0.06, ry0, ry0 + 0.08, sz1 - 0.4, sz1 + 0.04); W.blk(B.marble, sx1 - 0.4, sx1 + 0.06, ry0, ry0 + 0.08, sz0 + 0.4, sz1 - 0.4);
    W.blk(B.grey, c1, sx1 - 0.35, sy - 1.5, sy - 0.9, sz0 + 0.35, sz1 - 0.35);
    W.plane(own.water, c1, sx1 - 0.35, sz0 + 0.35, sz1 - 0.35, ry0 - 0.09);
    W.col(c1, sx1, sz0, sz1);
    const FA = frame(Sx, c1, sy, zT, Math.PI / 2);   // on the wall face, local +z = east
    for (const s of [-1, 1]) FA.blk(B.marble, s * 3.4, s * 4.0, -1.2, 3.2, 0, 0.4);
    FA.blk(B.marble, -4.2, 4.2, 3.2, 3.75, 0, 0.5); FA.blk(B.marble, -4.4, 4.4, 3.75, 3.95, 0, 0.65);
    FA.add(B.marble, triGeo(4.2, 1.1, 0.35), FA.m(0, 3.95, 0.1));
    FA.blk(own.painted, -3.4, 3.4, 2.2, 2.8, 0, 0.02, PAINT.oxblood); FA.blk(B.marble, -3.4, 3.4, 2.1, 2.2, 0, 0.08);
    for (const x of [-2, 0, 2]) spout(FA, x, 1.25, 0, 0.95, ry0 - 0.09 - sy, 0.8);
    const py0 = sy - 0.8, pxb = sx1 + 5.6, pza = sz0 - 1.4, pzb = sz1 + 1.4;
    W.blk(B.ashlar, sx1, pxb, tmn(sx1, pxb, pza, pzb) - 0.6, py0, pza, pzb); W.plane(B.pave, sx1, pxb, pza, pzb, py0 + 0.012); W.gnd(c1, pxb, pza, sz0, py0); W.gnd(c1, pxb, sz1, pzb, py0); W.gnd(sx1, pxb, sz0, sz1, py0);
    W.blk(B.ashlar, c1, sx1, tmn(c1, sx1, pza, sz0) - 0.6, py0 - 0.2, pza, sz0); W.blk(B.ashlar, c1, sx1, tmn(c1, sx1, sz1, pzb) - 0.6, py0 - 0.2, sz1, pzb);
    let nSp = 2; while (nSp < 24 && (py0 - Math.min(TH(pxb + nSp * 0.36 + 0.15, zT - 2.5), TH(pxb + nSp * 0.36 + 0.15, zT + 2.5))) / nSp > 0.29) nSp++;
    const ybS = Math.min(TH(pxb + nSp * 0.36 + 0.15, zT - 2.5), TH(pxb + nSp * 0.36 + 0.15, zT + 2.5));
    stairs(frame(Sx, pxb, 0, zT, Math.PI / 2), B.ashlar, -2.5, 2.5, nSp * 0.36, 0, ybS, py0, nSp);
    for (const zz of [pza, pzb]) { W.blk(B.marble, sx1 + 2.9, pxb, py0, py0 + 0.45, zz + (zz < zT ? 0 : -0.55), zz + (zz < zT ? 0.55 : 0)); W.poi('bench', sx1 + 4.3, zz + (zz < zT ? 0.275 : -0.275), py0 + 0.45, zz < zT ? 0 : Math.PI); }
    W.col(sx1 + 2.9, pxb, pza, pza + 0.55); W.col(sx1 + 2.9, pxb, pzb - 0.55, pzb);
    // beside the basin: a low step on the uphill (north) side where the path along the wall foot comes in, a stone ledge for jars on the south side
    W.blk(B.marble, c1, sx1, py0 - 0.2, py0 + 0.34, pza, sz0); W.gnd(c1, sx1, pza, sz0, py0 + 0.34);
    W.blk(B.marble, c1, sx1, py0 - 0.2, py0 + 0.45, sz1, pzb); W.col(c1, sx1, sz1, pzb);
    W.poi('fountain', sx1, zT, py0, -Math.PI / 2, { r: 5, note: 'the Salmakis spring', spots: [W.spot(sx1 + 0.8, zT - 2, -Math.PI / 2), W.spot(sx1 + 0.8, zT, -Math.PI / 2), W.spot(sx1 + 0.8, zT + 2, -Math.PI / 2)] });
    for (let i = 0; i < 3; i++) jar(W, sx1 + 3.2 + (i % 2) * 0.5, zT + 3 + i * 0.55, py0 + 0.012, 1.0);
    // ---- the way from the town: a gravel track down the x = -440 street line to the spring's north step, a spur past the foot of the
    //      spring stair to the landing path, and a stepped sacred way west along the altar court up to the gate of the temple terrace
    const track = (pts, w) => own.terra.add(ctx.kit.roadGeometry(pts, w, { lift: 0.05, step: 1.2, ground: meshH }), undefined, 0xa48d6e);   // trodden earth
    track([[-441.3, 482.5], [-441.3, 521], [-443, 529], [-443, 538.6]], 2.0);
    track([[-441.3, 520.5], [-434.5, 531], [-429.2, 541], [-429, 544], [-429, 550.2], [-429.4, 555.5], [-429.8, 561.9]], 2.2);
    { const xa = -444, xb = sx1, za = 538.5, zb = pza, top = Math.min(py0 + 0.2, tMax({ minX: xa, maxX: xb, minZ: za, maxZ: zb }) + 0.04);
      W.blk(B.marble, xa, xb, tmn(xa, xb, za, zb) - 0.4, top, za, zb); W.gnd(xa, xb, za, zb, top); }
    { const zc0 = 526.3, zc1 = 528.7; let top = -Infinity;
      for (let xb = -444.0; xb > gx0 + 0.01;) {   // treads climbing west; the last one is the corner landing
        const xa = Math.max(gx0 - 0.2, xb - (top === -Infinity ? 0.45 : 0.9)), ty = Math.max(TH(xa, zc0), TH(xa, zc1), TH(xb, zc0), TH(xb, zc1)) + 0.06; top = Math.max(top, ty);
        W.blk(B.ashlar, xa, xb, tmn(xa, xb, zc0, zc1) - 0.5, top, zc0, zc1); W.gnd(xa, xb, zc0, zc1, top); xb = xa;
      }
      for (let za = zc1, j = 0; j < 6; j++) {   // down along the terrace's west wall to the gate
        const zb = za + (b0 - 0.8 - zc1) / 6, ty = Math.max(TH(gx0, za), TH(gx1, za), TH(gx0, zb), TH(gx1, zb)) + 0.06, t2 = Math.max(ty, T1 + 0.02 - 0.25 * (5 - j));
        W.blk(B.ashlar, gx0, gx1, tmn(gx0, gx1, za, zb) - 0.5, Math.min(top, t2), za, zb); W.gnd(gx0, gx1, za, zb, Math.min(top, t2)); za = zb;
      }
      for (const x of [gx0 - 0.55, gx1 + 0.55]) { const z = b0 - 1.35; W.add(B.statue, hermGeo(), W.m(x, TH(x, z) - 0.05, z, 0, Math.PI, 0)); W.col(x - 0.3, x + 0.3, z - 0.3, z + 0.3); }
      W.poi('shrine', gx1 + 0.55, b0 - 1.35, TH(gx1 + 0.55, b0 - 1.35), Math.PI, { r: 1.5, note: 'herm at the gate of the temple terrace', spots: [W.spot(gx1 + 0.3, b0 - 2.4, Math.PI)] }); }
    { const x = -444.6, z = 525.1, y = TH(x, z); W.add(B.statue, hermGeo(), W.m(x, y - 0.05, z, 0, Math.PI / 2, 0)); W.col(x - 0.3, x + 0.3, z - 0.3, z + 0.3);
      W.add(B.marble, lathe([[0.3, 0], [0.3, 0.12], [0.22, 0.2], [0.22, 0.62], [0.3, 0.72], [0.3, 0.8], [0.01, 0.8]], 12), W.m(-437.9, TH(-437.9, 518.4) - 0.1, 518.4)); W.col(-438.25, -437.55, 518.05, 518.75);
      W.poi('shrine', x, z, y, Math.PI / 2, { r: 1.5, note: 'herm where the sacred way leaves the track', spots: [W.spot(x + 1.1, z, -Math.PI / 2)] }); }
    for (const [x, z, k] of [[-444.9, 502, 0], [-444.7, 513.5, 2], [-451.5, 523.6, 1], [-463, 523.7, 3], [-473.5, 524, 0], [-426, 539.5, 2], [-426.2, 552.5, 1]]) if (!world.blocked(x, z)) tree(W, x, z, TH(x, z), 1.05 + (k % 2) * 0.2, trees[k], [0xa3b08a, 0x97a57f][k % 2]);
    Sx.commit();
  }

  // ---------- own meshes ----------
  const streamMat = ctx.setupMaterial(new THREE.MeshStandardMaterial({ color: 0xc6dde2, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.38, depthWrite: false, envMapIntensity: 0.45 }));
  // still, shallow basin water: a clear green-grey film over the basin floor, with the sea's ripple normals turned right down
  const stillMat = ctx.setupMaterial(new THREE.MeshStandardMaterial({ color: 0x3c6468, roughness: 0.06, metalness: 0, transparent: true, opacity: 0.84, envMapIntensity: 0.8, normalMap: M.sea.normalMap || null, normalScale: new THREE.Vector2(0.08, 0.08) }));
  for (const [b, m, shadow, noAO] of [[own.painted, M.painted, true], [own.terra, M.terracotta, true], [own.leaf, M.foliage, true, true], [own.water, stillMat, false, true], [own.bark, M.barkOlive, true], [own.stream, streamMat, false, true]]) {
    const mesh = b.mesh(m, shadow); if (!mesh) continue;
    mesh.name = 'civic'; G.add(mesh);
    // GTAOPass renders every mesh opaque and un-alpha-tested into its normal pass: it skips objects flagged like Line2,
    // so water films, jets and leaf cards stay out of the AO (no dark quads around leaves, no AO painted on thin water)
    if (noAO) mesh.isLine2 = true;
  }
}
