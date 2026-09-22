// Town feature: residential — the life around the houses.
// Greek houses turn inward: walled yards with gates, trees, wells, storage jars, ovens, looms, laundry and flat-roofed
// store rooms with roof terraces; on the facades door steps, shuttered windows, balconies, vine pergolas, benches,
// herb pots, painted door frames and herms; shopfronts along the platea and the avenue; and the empty lots become
// kitchen gardens, orchards, animal pens, building sites, ruins and small open yards.
import * as THREE from 'three';
import { Bucket, ColorBucket, box, lathe, tubeY, rectSweep, mat, rng, lerp, clamp, TAU, makeNoise2D } from '../util.js';
import { terrainHeight, slopeAt, inTerrace, SEA, flats } from '../terrain.js';
import { insideWalls } from '../city.js';

export const name = 'residential';
export function plan() {}

const PLAT = [];        // the harbourside terraces built in this run: {minX, maxX, minZ, maxZ, y}
const gy = (x, z) => { const t = terrainHeight(x, z); if (PLAT.length && z > 395 && z < 442 && x > 148 && x < 280) for (const p of PLAT) if (x >= p.minX && x <= p.maxX && z >= p.minZ && z <= p.maxZ) return Math.max(t, p.y); return t; };
const OWN = 'residential';
const ov = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
const rectOf = (x0, z0, x1, z1, m = 0) => ({ minX: Math.min(x0, x1) - m, maxX: Math.max(x0, x1) + m, minZ: Math.min(z0, z1) - m, maxZ: Math.max(z0, z1) + m });
// rectangle around a segment along X or Z, widened by m across it only
const lineRect = (x0, z0, x1, z1, m) => Math.abs(z1 - z0) < 1e-6 ? rectOf(x0, z0 - m, x1, z0 + m) : rectOf(x0 - m, z0, x0 + m, z1);
const inRect = (r, lim) => r.minX >= lim.minX && r.maxX <= lim.maxX && r.minZ >= lim.minZ && r.maxZ <= lim.maxZ;
const hash = (...a) => { let h = 0x9e3779b9; for (const v of a) { h = Math.imul(h ^ (v | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; } return h >>> 0; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const CLOTH = [0xd9ccb0, 0xe0d6c2, 0xc99a3a, 0xa2432e, 0x4a5f86, 0x7d7a4a, 0xb87a3a, 0x6a3f5c, 0xcdbf9c, 0x8e5a3c, 0xd4c7a8];
const SHUT = [0x4f6f7a, 0x5f7a52, 0x6b4a30, 0x8e3b2a, 0x3d5a80, 0x7a6a48, 0x55705a];
const TERRA = [0xb4603c, 0xa85a3a, 0xc27a50, 0x9a5236, 0xb86e48, 0xc88a60];
const FRAME = [0x8e3b2a, 0x3d5a80, 0x4a6048, 0xe5dccb, 0xb8893a];

// box keeping only some faces: f ⊂ 'XxYyZz' (upper case = + side)
function boxF(w, h, d, f = 'XxYyZz') {
  const g = box(w, h, d), src = g.index.array, idx = [];
  for (let i = 0; i < 6; i++) if (f.includes('XxYyZz'[i])) for (let k = 0; k < 6; k++) idx.push(src[i * 6 + k]);
  g.setIndex(idx); return g;
}
// rectangles in a 16 m grid; hit() skips rects whose id equals `skip`
function grid() {
  const g = new Map();
  return {
    add(r) { for (let i = Math.floor(r.minX / 16); i <= Math.floor(r.maxX / 16); i++) for (let j = Math.floor(r.minZ / 16); j <= Math.floor(r.maxZ / 16); j++) { const k = i * 4096 + j; let l = g.get(k); if (!l) g.set(k, l = []); l.push(r); } return r; },
    hit(r, m = 0, skip) {
      for (let i = Math.floor((r.minX - m) / 16); i <= Math.floor((r.maxX + m) / 16); i++) for (let j = Math.floor((r.minZ - m) / 16); j <= Math.floor((r.maxZ + m) / 16); j++) {
        const l = g.get(i * 4096 + j); if (l) for (const c of l) if ((skip === undefined || c.id !== skip) && ov(c, r, m)) return c;
      }
      return null;
    },
    each(r, fn) { const seen = new Set(); for (let i = Math.floor(r.minX / 16); i <= Math.floor(r.maxX / 16); i++) for (let j = Math.floor(r.minZ / 16); j <= Math.floor(r.maxZ / 16); j++) { const l = g.get(i * 4096 + j); if (l) for (const c of l) if (!seen.has(c) && ov(c, r)) { seen.add(c); fn(c); } } },
    at(x, z) { const l = g.get(Math.floor(x / 16) * 4096 + Math.floor(z / 16)); if (l) for (const c of l) if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return c; return null; },
    // distance from a point to the nearest rectangle (capped at rad)
    gap(x, z, rad) {
      let d = rad;
      for (let i = Math.floor((x - rad) / 16); i <= Math.floor((x + rad) / 16); i++) for (let j = Math.floor((z - rad) / 16); j <= Math.floor((z + rad) / 16); j++) {
        const l = g.get(i * 4096 + j); if (l) for (const c of l) d = Math.min(d, Math.hypot(Math.max(c.minX - x, 0, x - c.maxX), Math.max(c.minZ - z, 0, z - c.maxZ)));
      }
      return d;
    },
  };
}
// a cylinder from a to b
function branch(a, b, r, segs = 4) {
  const A = V(...a), Bv = V(...b), len = A.distanceTo(Bv);
  const g = new THREE.CylinderGeometry(r * 0.55, r, len, segs, 1, true);
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), Bv.clone().sub(A).normalize()), V(1, 1, 1)));
  return g;
}
// the faces of a house (or wing) in its frame, door side = 0: u runs along the face, o outwards, a = extra yaw
function faceOf(h, s) {
  const sg = h.ry === 0 ? 1 : -1, w = h.w, d = h.d;
  const [cx, cz, tx, tz, nx, nz, a, len] = [[0, d / 2, 1, 0, 0, 1, 0, w], [w / 2, 0, 0, -1, 1, 0, Math.PI / 2, d], [0, -d / 2, -1, 0, 0, -1, Math.PI, w], [-w / 2, 0, 0, 1, -1, 0, -Math.PI / 2, d]][s];
  const P = (u, o) => [h.x + sg * (cx + tx * u + nx * o), h.z + sg * (cz + tz * u + nz * o)];
  return {
    s, len, top: h.h, nx: sg * nx, nz: sg * nz, tx: sg * tx, tz: sg * tz, ry: h.ry + a, P,
    M: (u, y, o, ra = 0, sc = 1) => { const p = P(u, o); return mat(p[0], y, p[1], 0, h.ry + a + ra, 0, sc); },
    rect: (u0, u1, o0, o1) => { const p = P(u0, o0), q = P(u1, o1); return rectOf(p[0], p[1], q[0], q[1]); },
  };
}
const faceRy = (nx, nz) => Math.atan2(nx, nz);   // yaw that turns +z to (nx, nz)

// ---------- templates ----------
// small fruit trees: fig (broad), pomegranate (small, dark), olive (grey-green), almond (light)
function treeGeo(R, kind) {
  const trunk = new Bucket(), cards = new Bucket();
  const pom = kind === 'pom', H = pom ? 1.0 + R() * 0.4 : kind === 'fig' ? 1.2 + R() * 0.5 : 1.4 + R() * 0.5, ph = R() * TAU, lean = (R() - 0.5) * 0.45;
  const r0 = pom ? 0.08 : kind === 'olive' ? 0.17 : 0.13, wz = 0.18 * Math.sin(ph);
  trunk.add(tubeY(3, 4, (i, j, t, a) => { const r = lerp(r0, r0 * 0.6, t) * (1 + 0.15 * Math.sin(3 * a + ph)); return [Math.cos(a) * r + lean * t * t, t * H, -Math.sin(a) * r + wz * t]; }, 0.8, H, false));
  const top = [lean, H - 0.05, wz], crown = [];
  for (let b = 0; b < 3; b++) {
    const a = ph + b / 3 * TAU + R() * 0.7, l = (pom ? 0.55 : 0.8) + R() * 0.35;
    const e = [top[0] + Math.cos(a) * l * 0.85, H + l * (0.65 + R() * 0.35), top[2] - Math.sin(a) * l * 0.85];
    trunk.add(branch(top, e, r0 * 0.6, 3)); crown.push(e);
  }
  const S = kind === 'fig' ? 2.1 : pom ? 1.6 : 1.9, n = pom ? 9 : 11, mid = [(crown[0][0] + crown[1][0] + crown[2][0]) / 3, (crown[0][1] + crown[1][1] + crown[2][1]) / 3 + 0.2, (crown[0][2] + crown[1][2] + crown[2][2]) / 3];
  for (let i = 0; i < n; i++) {
    const c = i < 4 ? mid : crown[i % 3];
    const q = new THREE.Quaternion().setFromEuler(i % 2 ? new THREE.Euler(R() * TAU, R() * TAU, R() * TAU) : new THREE.Euler(-Math.PI / 2 + (R() - 0.5) * 1.2, R() * TAU, 0, 'YXZ'));
    cards.add(new THREE.PlaneGeometry(S, S), new THREE.Matrix4().compose(V(c[0] + (R() - 0.5) * S * 0.5, c[1] + (R() - 0.4) * S * 0.4, c[2] + (R() - 0.5) * S * 0.5), q, V(1, 1, 1)));
  }
  const leaves = cards.build(), lp = leaves.attributes.position; let cr = 0;       // cr: how far the crown reaches from the trunk
  for (let i = 0; i < lp.count; i++) cr = Math.max(cr, Math.hypot(lp.getX(i), lp.getZ(i)));
  return { trunk: trunk.build(), leaves, cr };
}
const TREE_TINT = { fig: 0xa0d474, pom: 0x7eaa58, olive: 0xd4dcc0, almond: 0xc4e09c };

// animals facing +z, standing on y = 0
function animalGeo(kind) {
  const b = new Bucket();
  if (kind === 'chicken') {
    b.add(new THREE.SphereGeometry(1, 5, 3), mat(0, 0.17, 0, -0.3, 0, 0, V(0.1, 0.1, 0.15)));
    b.add(boxF(0.05, 0.08, 0.07, 'XxYZz'), mat(0, 0.29, 0.11));
    b.add(boxF(0.02, 0.08, 0.1, 'Xx'), mat(0, 0.27, -0.13, 0.6, 0, 0));
    return b.build();
  }
  const S = kind === 'donkey' ? 1.55 : 1, sheep = kind === 'sheep', goat = kind === 'goat';
  b.add(new THREE.SphereGeometry(1, 6, 3), mat(0, 0.52 * S, 0, 0, 0, 0, V((sheep ? 0.24 : 0.19) * S, (sheep ? 0.23 : 0.21) * S, 0.42 * S)));
  if (sheep) b.add(new THREE.SphereGeometry(1, 5, 3), mat(0.03, 0.61, -0.1, 0, 0.5, 0, V(0.22, 0.19, 0.3)));
  // neck and a tapered head, muzzle forward and down
  b.add(new THREE.CylinderGeometry(0.075 * S, 0.1 * S, 0.3 * S, 4, 1, true).rotateY(Math.PI / 4), mat(0, 0.66 * S, 0.34 * S, 0.75, 0, 0, V(0.8, 1, 1)));
  b.add(new THREE.CylinderGeometry(0.03 * S, 0.075 * S, 0.3 * S, 4, 1, false).rotateY(Math.PI / 4), mat(0, 0.74 * S, 0.5 * S, Math.PI / 2 + 0.75, 0, 0, V(0.85, 1, 1)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(new THREE.CylinderGeometry(0.04 * S, 0.028 * S, 0.4 * S, 3, 1, true), mat(sx * 0.1 * S, 0.19 * S, sz * 0.27 * S));
  if (kind !== 'donkey') for (const sx of [-1, 1]) b.add(boxF(0.11, 0.015, 0.05, 'Yy'), mat(sx * 0.1, 0.8, 0.42, 0, sx * 0.3, sx * -0.45));
  if (goat) for (const sx of [-1, 1]) b.add(new THREE.ConeGeometry(0.022, 0.18, 3, 1, true), mat(sx * 0.04, 0.92, 0.4, -0.8, 0, 0));
  if (kind === 'donkey') for (const sx of [-1, 1]) b.add(new THREE.ConeGeometry(0.035, 0.26, 3, 1, true), mat(sx * 0.06, 1.46, 0.62, -0.3, 0, sx * -0.25));
  b.add(new THREE.ConeGeometry(0.03 * S, (goat ? 0.14 : 0.2) * S, 3, 1, true), goat ? mat(0, 0.7, -0.42, -0.7, 0, 0) : mat(0, 0.56 * S, -0.44 * S, -2.6, 0, 0));
  return b.build();
}
// the platea and avenue cypresses (src/environment.js, planted after the town and without colliders): replay its random numbers
function cypressTrunks() {
  const R = rng(1234), NV = makeNoise2D(31), out = [];
  const inFlat = (x, z) => flats.some(f => f.r ? Math.hypot(x - f.cx, z - f.cz) < f.r + 12 : (Math.abs(x - f.cx) < f.hw + 10 && Math.abs(z - f.cz) < f.hd + 10));
  const inTown = (x, z) => z > 58 && z < 445 && Math.abs(x) < 470;
  const okLand = (x, z, s) => terrainHeight(x, z) > SEA + 3 && slopeAt(x, z) < s && !inFlat(x, z) && !inTerrace(x, z, 6);
  for (let n = 0, k = 0; n < 9000 && k < 1500; n++) { const a = R() * TAU, d = 380 + Math.pow(R(), 0.8) * 1150, x = Math.cos(a) * d, z = Math.sin(a) * d; if (z > 700 || inTown(x, z) || !okLand(x, z, 0.5) || NV.fbm(x / 210, z / 210, 3) < -0.05 || terrainHeight(x, z) > 95) continue; R(); k++; }
  for (let n = 0, k = 0; n < 9000 && k < 900; n++) { const a = R() * TAU, d = 450 + R() * 1300, x = Math.cos(a) * d, z = Math.sin(a) * d; if (inTown(x, z) || !okLand(x, z, 0.7) || terrainHeight(x, z) < 55 || NV.fbm(x / 160 + 7, z / 160, 3) < -0.1) continue; R(); k++; }
  for (let x = -112; x <= 112; x += 8.5) for (const z of [-46.5, 46.5]) { if (z > 0 && Math.abs(x) < 12) continue; R(); }
  for (let x = -440; x <= 440; x += 15) if (Math.abs(x) > 10) { const z = 79 + R() * 1.5; out.push({ x, z, H: 8 + R() * 4 }); }
  for (let z = -40; z <= 380; z += 14) { const x = 154 + R(); out.push({ x, z, H: 8 + R() * 4 }); }
  return out;
}
// wicker atlas (512 × 1536; rows tile along u): a wattle hurdle (y 0..256), the warp of a loom with its woven band (264..504), a fishing net of light hemp
// (520..1280, 427 px to the metre); in the last row, clamped cells: the olive leaf card (for the town's M.foliage cards, so they share this mesh) and a
// tangle of heaped net
const AH = 1536, AV = y => 1 - y / AH, NET_PX = 512 / 1.2;
const LEAF_UV = [8 / 512, AV(1528), 240 / 512, 240 / AH], TANGLE_UV = [268 / 512, AV(1524), 232 / 512, 232 / AH];
function wickerTexture(leafImg) {
  if (typeof document === 'undefined') return null;
  const S = 512, c = document.createElement('canvas'); c.width = S; c.height = AH; const g = c.getContext('2d'), R = rng(404);
  g.clearRect(0, 0, S, S); g.lineCap = 'round';
  for (let i = 0; i < 8; i++) { const x = 32 + i * 64; g.fillStyle = '#5a4a36'; g.fillRect(x - 4, 2, 9, 252); g.fillStyle = '#6e5c44'; g.fillRect(x - 2, 2, 3, 252); }
  for (let r = 0, y = 20; y < 246; r++, y += 12 + Math.floor(R() * 2)) {
    const col = ['#8b7b5e', '#97866a', '#7d6d53', '#a08f72', '#857458', '#91806a'][Math.floor(R() * 6)];
    g.strokeStyle = col; g.lineWidth = 8 + R() * 2; g.beginPath();
    for (let x = -8; x <= S + 8; x += 4) { const yy = y + Math.sin((x - 32) / 64 * Math.PI + r * Math.PI) * 2.6; x === -8 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke();
    g.strokeStyle = 'rgba(60,48,34,0.55)'; g.lineWidth = 1.6; g.beginPath();
    for (let x = -8; x <= S + 8; x += 4) { const yy = y + 4 + Math.sin((x - 32) / 64 * Math.PI + r * Math.PI) * 2.6; x === -8 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke();
    for (let i = 0; i < 8; i++) if ((i + r) % 2) { const x = 32 + i * 64; g.fillStyle = '#5a4a36'; g.fillRect(x - 4, y - 6, 9, 12); }
  }
  for (let i = 0; i < 14; i++) { const x = R() * S; g.strokeStyle = '#7d6d53'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, 16); g.lineTo(x + (R() - 0.5) * 14, 2 + R() * 6); g.stroke(); }
  // loom: woven band 264..332, warp threads gathered into bundles above the weights
  g.fillStyle = '#c9bea6'; g.fillRect(0, 264, S, 68);
  for (let x = 0; x < S; x += 24) { g.fillStyle = x % 48 ? '#8a5040' : '#56627a'; g.fillRect(x + 6, 280, 12, 5); g.fillRect(x + 10, 289, 4, 9); g.fillStyle = '#9c8452'; g.fillRect(x, 312, 24, 4); g.fillRect(x + 8, 272, 8, 3); }
  g.fillStyle = 'rgba(70,52,36,0.3)'; for (let y = 265; y < 332; y += 2) g.fillRect(0, y, S, 1);
  g.fillStyle = 'rgba(255,245,225,0.12)'; for (let x = 0; x < S; x += 3) g.fillRect(x, 264, 1, 68);
  g.lineWidth = 2.6;
  for (let x = 4; x < S; x += 9) { const gc = 18 + 36 * Math.floor(x / 36); g.strokeStyle = R() < 0.5 ? '#dcd0b6' : '#cfc2a6'; g.beginPath(); g.moveTo(x, 332); g.lineTo(lerp(x, gc, 0.35), 440); g.lineTo(gc + (R() - 0.5) * 3, 500); g.stroke(); }
  g.strokeStyle = 'rgba(90,70,50,0.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 392); g.lineTo(S, 392); g.stroke();
  // a fishing net (y 520..1280): thin pale hemp twine in a diamond mesh, a little uneven, with small knots (tinted per vertex)
  // the knots sit on a jittered grid (tiling across u), each joined to its two neighbours below by a slack twine: a hanging net's meshes are pulled shut by
  // its weight into long narrow diamonds; here and there a torn hole, or a patch of new darker twine where it has been mended
  g.save(); g.beginPath(); g.rect(0, 520, S, 760); g.clip(); g.lineWidth = 1.05; g.lineCap = 'round';
  const NX = 56, cell = S / NX, dy = cell * 1.55, NY = Math.ceil(780 / dy) + 2, kn = [], holes = [], mends = [];
  for (let k = 0; k < 7; k++) holes.push([R() * S, 560 + R() * 700, 7 + R() * 10]);
  for (let k = 0; k < 5; k++) mends.push([R() * S, 560 + R() * 700, 12 + R() * 14]);
  const near = (L2, x, y) => L2.some(([hx, hy, r]) => { const dx = Math.min(Math.abs(x - hx), S - Math.abs(x - hx)); return dx * dx + (y - hy) * (y - hy) * 0.5 < r * r; });
  for (let j = 0; j < NY; j++) { kn.push([]); for (let i = 0; i < NX; i++) kn[j].push([(i + (j % 2) * 0.5) * cell + (R() - 0.5) * 3.2, 512 + j * dy + (R() - 0.5) * 5]); }
  const K = (i, j) => { const q = kn[j][((i % NX) + NX) % NX]; return [q[0] + Math.floor(i / NX) * S, q[1]]; };
  for (let j = 0; j < NY - 1; j++) for (let i = -1; i <= NX; i++) {
    const a = K(i, j), mended = near(mends, a[0], a[1]);
    for (const di of j % 2 ? [0, 1] : [-1, 0]) {
      const b = K(i + di, j + 1); if (near(holes, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
      g.strokeStyle = mended ? (R() < 0.5 ? '#a89470' : '#9a8664') : R() < 0.45 ? '#eee2c8' : R() < 0.6 ? '#dccaa6' : '#cbb690';
      g.beginPath(); g.moveTo(a[0], a[1]); g.quadraticCurveTo((a[0] + b[0]) / 2 + (R() - 0.5) * 3, (a[1] + b[1]) / 2, b[0], b[1]); g.stroke();
    }
    g.fillStyle = mended ? '#8e7a58' : '#cdb994'; g.fillRect(a[0] - 1.2, a[1] - 1.0, 2.4, 2.0);
  }
  for (const [hx, hy, r] of holes) for (let k = 0; k < 5; k++) { const a = R() * TAU, x = hx + Math.cos(a) * r, y = hy + Math.sin(a) * r * 1.4; g.strokeStyle = '#dccaa6'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 8, y + 4 + R() * 7); g.stroke(); }     // loose ends
  g.restore();
  // the last row: the leaf card, then a heap of tangled net (several meshes crumpled over each other, darker in the depths)
  if (leafImg) g.drawImage(leafImg, 8, 1288, 240, 240);
  g.save(); g.beginPath(); g.rect(264, 1284, 240, 240); g.clip(); g.lineCap = 'round';
  for (let i = 0; i < 70; i++) { g.fillStyle = ['#5e5442', '#6a5e4a', '#564c3c'][i % 3]; g.beginPath(); g.ellipse(264 + R() * 240, 1284 + R() * 240, 6 + R() * 16, 3 + R() * 7, R() * 3, 0, TAU); g.fill(); }
  for (let layer = 0; layer < 9; layer++) {
    const a = R() * TAU, sc = 6 + R() * 6, ca = Math.cos(a), sa = Math.sin(a), ox = 384, oy = 1404;
    g.strokeStyle = ['#7a6e58', '#8a7e66', '#9a8e74', '#a89c82', '#b8ac92', '#c4b89e', '#d2c6ae', '#ddd2bc', '#e8dfcc'][layer]; g.lineWidth = 1.2 + R() * 0.6;
    for (let k = -24; k <= 24; k++) for (const sg of [1, -1]) {
      g.beginPath();
      for (let t = -24; t <= 24; t++) { const u = k * sc + sg * t * sc * 0.5, v = t * sc * 0.9, bend = Math.sin(t * 0.7 + k + layer) * sc * 0.25; const x = ox + ca * (u + bend) - sa * v, y = oy + sa * (u + bend) + ca * v; t === -24 ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke();
    }
  }
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4;
  return t;
}
// a patch standing out d from a wall (local z), w wide and hgt tall from y = 0, its top and sides bevelled back to the wall over b (no lit edge)
function patchGeo(w, hgt, d, b) {
  const P = [[-w / 2 - b, 0, 0], [w / 2 + b, 0, 0], [w / 2 + b, hgt + b, 0], [-w / 2 - b, hgt + b, 0], [-w / 2, 0, d], [w / 2, 0, d], [w / 2, hgt, d], [-w / 2, hgt, d]], pos = [], uv = [];
  for (const q of [[4, 5, 6, 7], [7, 6, 2, 3], [0, 4, 7, 3], [5, 1, 2, 6]]) for (const k of [0, 1, 2, 0, 2, 3]) { const p = P[q[k]]; pos.push(...p); uv.push(p[0], p[1]); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); return g;
}
// remap the 0..1 uvs of the geometry last added to a bucket into an atlas cell [u0, v0, w, h]
const toCell = (bk, cellUV) => { const uv = bk.list[bk.list.length - 1].attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, cellUV[0] + clamp(uv.getX(i), 0, 1) * cellUV[2], cellUV[1] + clamp(uv.getY(i), 0, 1) * cellUV[3]); };
// a quad from two ground points up by hgt, uv (u0..u1, v0..v1); for the double-sided wicker material
function quadGeo(x0, y0, z0, x1, y1, z1, hgt, u0, u1, v0, v1) {
  const L0 = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / L0, nz = (x1 - x0) / L0, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, z0, x1, y1, z1, x1, y1 + hgt, z1, x0, y0 + hgt, z0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export function build(ctx) {
  const { M, world, layout: L, B, kit } = ctx;
  PLAT.length = 0;
  // own meshes: terracotta, painted, bark, cloth (double-sided M.cloth), wicker (an alpha-tested atlas: hurdles, loom warps, nets, leaf cards) and dry-stone rubble
  const terra = new ColorBucket(), paint = new ColorBucket(), bark = new Bucket(), clothB = new ColorBucket(), wick = new ColorBucket(), rub = new Bucket(), small = paint;
  const leaf = { add: (g, m, c) => { wick.add(g, m, c); toCell(wick, LEAF_UV); return leaf; } };      // leaf cards share the wicker atlas and its mesh
  // M.cloth's grey plaster map is dark (~0.29 linear): lift the vertex colour so a colour reads as it would on M.painted; laundry is washed out a little
  const cloth = { add: (g, m, c, wash = 0) => { const k = new THREE.Color(c); if (wash) k.lerp(new THREE.Color(0xb8b0a0), wash); clothB.add(g, m, k.multiplyScalar(2.6)); } };
  const cols = [], steps = [], stoops = [], stats = { yards: 0, shops: 0, lots: {}, annex: 0, balcony: 0, pergola: 0 };
  const poi = p => L.addPoi({ owner: OWN, ...p });
  const pick = (R, a) => a[Math.floor(R() * a.length)];
  const mr = (x, y, z, ry, rx = 0, rz = 0, sc = 1) => mat(x, y, z, 0, ry, 0).multiply(mat(0, 0, 0, rx, 0, rz, sc));   // yaw, then tilt in the thing's own frame
  const CG = grid(), collide = (r, m = 0) => { const c = { minX: r.minX - m, maxX: r.maxX + m, minZ: r.minZ - m, maxZ: r.maxZ + m }; cols.push(c); CG.add(c); };
  // rectangle around (x,z) with half-extents a along the thing's own x and b along its z, for a yaw that is a multiple of 90°
  const orect = (x, z, ry, a, b) => { const c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry)); return rectOf(x - c * a - s * b, z - s * a - c * b, x + c * a + s * b, z + s * a + c * b); };

  // ---------- what is already there: houses, their colliders, everybody else's colliders ----------
  const HB = grid(), FG = grid(), MG = grid(), hk = new Set();
  for (const h of L.houses) {
    HB.add({ minX: h.x - h.w / 2, maxX: h.x + h.w / 2, minZ: h.z - h.d / 2, maxZ: h.z + h.d / 2, id: h.id });
    hk.add(`${h.x - (h.w / 2 + 0.3)},${h.x + (h.w / 2 + 0.3)},${h.z - (h.d / 2 + 0.3)},${h.z + (h.d / 2 + 0.3)}`);
    if (h.wing) {
      HB.add({ minX: h.wing.x - h.wing.w / 2, maxX: h.wing.x + h.wing.w / 2, minZ: h.wing.z - h.wing.d / 2, maxZ: h.wing.z + h.wing.d / 2, id: h.id });
      hk.add(`${h.wing.x - h.wing.w / 2 - 0.3},${h.wing.x + h.wing.w / 2 + 0.3},${h.wing.z - h.wing.d / 2 - 0.3},${h.wing.z + h.wing.d / 2 + 0.3}`);
    }
  }
  for (const c of world.colliders) if (!hk.has(`${c.minX},${c.maxX},${c.minZ},${c.maxZ}`)) FG.add(c);
  // the platea and avenue cypresses have no colliders: keep clear of every trunk that is not swallowed by a house
  const CYP = cypressTrunks().filter(c => !HB.hit({ minX: c.x, maxX: c.x, minZ: c.z, maxZ: c.z }, 0.3));
  for (const c of CYP) FG.add({ minX: c.x - 1.5, maxX: c.x + 1.5, minZ: c.z - 1.5, maxZ: c.z + 1.5 });
  const cypClear = (x, z, r) => CYP.every(c => Math.hypot(c.x - x, c.z - z) > r + 1.2);
  const free = (r, id, m = 0.3) => !HB.hit(r, m, id) && !FG.hit(r, 0.15) && !MG.hit(r, 0.05, id) && !L.isReserved(r, 0.3);
  const claim = (r, id) => MG.add({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ, id });
  const inset = (r, m) => ({ minX: r.minX + m, maxX: r.maxX - m, minZ: r.minZ + m, maxZ: r.maxZ - m });

  // ---------- geometry templates ----------
  const TR = rng(8811);
  const TREES = {}; for (const k of ['fig', 'pom', 'olive', 'almond']) TREES[k] = Array.from({ length: 5 }, () => treeGeo(TR, k));
  const ANIM = { goat: animalGeo('goat'), sheep: animalGeo('sheep'), donkey: animalGeo('donkey'), chicken: animalGeo('chicken') };
  const T = {
    pot: lathe([[0.09, 0], [0.16, 0.13], [0.15, 0.27], [0.11, 0.33]], 5),
    herb: new THREE.CylinderGeometry(0.16, 0.11, 0.3, 5, 1, true),
    amph: lathe([[0.02, 0], [0.15, 0.22], [0.18, 0.42], [0.07, 0.64], [0.08, 0.76]], 5),
    pithos: lathe([[0.2, 0], [0.47, 0.4], [0.3, 1.04], [0.34, 1.12]], 5),
    // washing: hanging from its top edge (y = 0 .. -1), folded down the middle or twice
    folds: [[0, 0.07, 0], [0, -0.05, 0.02], [0, 0.05, -0.04, 0]].map((zs, vi) => { const n = zs.length - 1, g = new THREE.PlaneGeometry(1, 1, n, 1).translate(0, -0.5, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const col = Math.round((p.getX(i) + 0.5) * n); p.setZ(i, zs[col]); } const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4); g.computeVertexNormals(); return g; }),
    weight: new THREE.ConeGeometry(0.035, 0.1, 3, 1, true),
    mouth: new THREE.CircleGeometry(0.22, 6, 0, Math.PI).scale(1, 1.15, 1),
    rim: new THREE.RingGeometry(0.22, 0.31, 6, 1, 0, Math.PI).scale(1, 1.15, 1),
    hood: new THREE.CylinderGeometry(0.31, 0.31, 0.12, 6, 1, true, Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 1.15, 1),
    ccard: (() => { const g = new THREE.PlaneGeometry(1, 1), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.5, uv.getY(i) * 2.5); return g; })(),
    log: new THREE.CylinderGeometry(0.07, 0.07, 1.1, 5, 1, true),
    agyieus: (() => { const b = new Bucket(); b.add(new THREE.CylinderGeometry(0.065, 0.16, 1.1, 8, 1, true), mat(0, 0.55, 0)); b.add(new THREE.SphereGeometry(0.068, 8, 2, 0, TAU, 0, Math.PI / 2), mat(0, 1.095, 0, 0, 0, 0, V(1, 0.8, 1))); return b.build(); })(),
    bucket: new THREE.CylinderGeometry(0.11, 0.08, 0.2, 5, 1, true),
    bowl: lathe([[0.04, 0], [0.15, 0.05], [0.19, 0.1]], 6),
    basket: new THREE.CylinderGeometry(0.26, 0.2, 0.28, 6, 1, true),
    disc: new THREE.CircleGeometry(0.25, 6).rotateX(-Math.PI / 2),
    card: new THREE.PlaneGeometry(1, 1),
    blob: new THREE.SphereGeometry(1, 6, 4),
    // a grain sack: squat body, a tied neck, a tuft
    sack: lathe([[0.02, 0], [0.27, 0.03], [0.31, 0.2], [0.24, 0.42], [0.11, 0.53], [0.16, 0.6], [0.03, 0.63]], 6),
    rock: new THREE.OctahedronGeometry(1, 0),
    pole: new THREE.CylinderGeometry(1, 1, 1, 4, 1, true),
    stake: new THREE.CylinderGeometry(1, 1, 1, 3, 1, true),
    blob5: new THREE.SphereGeometry(1, 5, 3),
    dome: new THREE.SphereGeometry(0.75, 8, 3, 0, TAU, 0, Math.PI / 2),
    cone: new THREE.ConeGeometry(1, 1, 7, 1, true),
    wheel: new THREE.CylinderGeometry(0.5, 0.5, 0.07, 8).rotateZ(Math.PI / 2),
    hay: lathe([[0.95, 0], [1.02, 0.55], [0.82, 1.1], [0.38, 1.5], [0.02, 1.62]], 6),
    ring: new THREE.RingGeometry(0.36, 0.62, 7).rotateX(-Math.PI / 2),
    hole: new THREE.CircleGeometry(0.38, 7).rotateX(-Math.PI / 2),
    card2: (() => { const b = new Bucket(); b.add(new THREE.PlaneGeometry(1, 1)); b.add(new THREE.PlaneGeometry(1, 1), mat(0, 0, 0, 0, Math.PI / 2, 0)); return b.build(); })(),
  };
  const pole = (bk, x, y0, z, len, r = 0.05) => bk.add(T.pole, mat(x, y0 + len / 2, z, 0, 0, 0, V(r, len, r)));
  // a fruit tree, shrunk so its crown keeps out of house walls and the street; none at all next to a cypress. Returns the scale used (0 = not planted)
  const plantTree = (kind, x, z, s, R) => {
    const v = pick(R, TREES[kind]), ry = R() * TAU, bl = L.blockRect(Math.floor((x - 145) / 45), Math.floor((z - 64) / 60));
    s = Math.min(s, (HB.gap(x, z, 5) - 0.05) / (0.62 * v.cr), (Math.min(x - bl.minX, bl.maxX - x, z - bl.minZ, bl.maxZ - z) - 0.03) / v.cr);
    if (s < 0.5 || !cypClear(x, z, 0.7 * v.cr * s)) return 0;
    const m = mat(x, gy(x, z) - 0.08, z, 0, ry, 0, s); bark.add(v.trunk, m); leaf.add(v.leaves, m, TREE_TINT[kind]); return s;
  };

  // ---------- a wall run along world X or Z from (x0,z0) to (x1,z1), following the ground ----------
  // socle of stone, plaster above, optional tiled coping; ends ⊂ 'se': draw the end face at the start / the end (the rest are hidden in piers and corners)
  function run(x0, z0, x1, z1, H, t, col, cap, ends = '') {
    const dx = x1 - x0, dz = z1 - z0, L0 = Math.hypot(dx, dz); if (L0 < 0.12) return;
    const g0 = gy(x0, z0), g1 = gy(x1, z1), gm = gy(x0 + dx / 2, z0 + dz / 2);
    if (L0 > 5 && Math.abs(gm - (g0 + g1) / 2) > 0.13) { const xm = x0 + dx / 2, zm = z0 + dz / 2; run(x0, z0, xm, zm, H, t, col, cap, ends.replace('e', '')); run(xm, zm, x1, z1, H, t, col, cap, ends.replace('s', '')); return; }
    const ax = Math.abs(dz) < 1e-6, s = (g1 - g0) / (ax ? dx : dz), cx = x0 + dx / 2, cz = z0 + dz / 2, gc = (g0 + g1) / 2, up = ax ? dx > 0 : dz > 0;
    const sh = y => new THREE.Matrix4().set(1, 0, 0, cx, ax ? s : 0, 1, ax ? 0 : s, y, 0, 0, 1, cz, 0, 0, 0, 1);
    const lo = ax ? 'x' : 'z', hi = ax ? 'X' : 'Z', ef = (ends.includes('s') ? (up ? lo : hi) : '') + (ends.includes('e') ? (up ? hi : lo) : '');
    const f = (ax ? 'Zz' : 'Xx') + ef, dim = (l, hh, th) => ax ? [l, hh, th] : [th, hh, l];
    const soc = 0.42;
    B.socles.add(boxF(...dim(L0, soc + 0.55, t + 0.08), f), sh(gc - 0.55 + (soc + 0.55) / 2));
    B.walls.add(boxF(...dim(L0, H - soc + 0.02, t), f + (cap ? '' : 'Y')), sh(gc + soc - 0.02 + (H - soc + 0.02) / 2), col);
    if (cap) B.roofs.add(boxF(...dim(L0 + (ends ? 0.06 : 0), 0.09, t + 0.12), f + 'Y'), sh(gc + H + 0.03), cap);
  }
  // wall along a straight line with colliders; gap = [a, b] distance along the line left open (for a gate); ends as in run(), for the line's own two ends
  function wallLine(x0, z0, x1, z1, H, t, col, cap, gap, ends = '') {
    const L0 = Math.hypot(x1 - x0, z1 - z0), ex = (x1 - x0) / L0, ez = (z1 - z0) / L0;
    const piece = (a, b, e) => { if (b - a < 0.1) return; const p = [x0 + ex * a, z0 + ez * a], q = [x0 + ex * b, z0 + ez * b]; run(p[0], p[1], q[0], q[1], H, t, col, cap, e); collide(lineRect(p[0], p[1], q[0], q[1], t / 2)); };
    if (gap) { piece(0, gap[0], ends.replace('e', '')); piece(gap[1], L0, ends.replace('s', '')); } else piece(0, L0, ends);
  }
  // a gateway in a wall line at (x,z): piers on a stone socle, lintel, leaves; (ex,ez) along the wall, (nx,nz) into the yard
  function gate(x, z, ex, ez, nx, nz, gw, H, t, col, cap, R) {
    const g = Math.min(gy(x, z), gy(x + nx * 0.6, z + nz * 0.6), gy(x - nx * 0.6, z - nz * 0.6)), ry = faceRy(nx, nz);
    const Hp = Math.max(H + 0.3, 2.55, Math.max(gy(x - nx * 0.75, z - nz * 0.75), gy(x - nx * 0.75 + ex * 1.2, z - nz * 0.75 + ez * 1.2), gy(x - nx * 0.75 - ex * 1.2, z - nz * 0.75 - ez * 1.2)) - g + 2.62), m = (a, y, o, r = 0, sc) => mat(x + ex * a + nx * o, y, z + ez * a + nz * o, 0, ry + r, 0, sc);
    const sgm = Math.sign(Math.cos(ry) * ex - Math.sin(ry) * ez) || 1;       // the piers' local +x along ±(ex,ez)
    for (const s of [-1, 1]) {           // flush with the wall, so the face against the wall's end can go
      const inner = -s * sgm > 0 ? 'X' : 'x', a = s * (gw / 2 + 0.25);
      B.socles.add(boxF(0.5, 0.97, t + 0.08, 'Zz' + inner), m(a, g - 0.55 + 0.485, 0));
      B.walls.add(boxF(0.5, Hp - 0.4, t, 'Zz' + inner), m(a, g + 0.4 + (Hp - 0.4) / 2, 0), col);
      collide(lineRect(x + ex * s * gw / 2, z + ez * s * gw / 2, x + ex * s * (gw / 2 + 0.5), z + ez * s * (gw / 2 + 0.5), t / 2));
    }
    B.woodDark.add(boxF(gw + 0.2, 0.18, t + 0.14, 'YyZz'), m(0, g + 2.2, 0));
    if (Hp - 2.29 > 0.05) B.walls.add(boxF(gw, Hp - 2.29, t, 'Zz'), m(0, g + 2.29 + (Hp - 2.29) / 2, 0), col);
    const ra = (gw + 1.5) / 2, rc = (t + 0.7) / 2, roofR = { minX: x - Math.abs(ex) * ra - Math.abs(nx) * rc, maxX: x + Math.abs(ex) * ra + Math.abs(nx) * rc, minZ: z - Math.abs(ez) * ra - Math.abs(nz) * rc, maxZ: z + Math.abs(ez) * ra + Math.abs(nz) * rc };
    if (cap && R() < 0.35 && !HB.hit(roofR, 0.05)) { const gr = kit.gableRoof(gw + 1.5, t + 0.7, 0.12, 0.5); B.roofs.add(gr, m(0, g + Hp, 0), cap); B.walls.add(boxF(gw + 1.0, 0.06, t + 0.1, 'Y'), m(0, g + Hp - 0.02, 0), col); }
    else if (cap) B.roofs.add(boxF(gw + 1.1, 0.1, t + 0.16, 'XxYyZz'), m(0, g + Hp + 0.04, 0), cap);
    else B.walls.add(boxF(gw + 1.0, 0.06, t + 0.12, 'Y'), m(0, g + Hp - 0.01, 0), col);
    const painted = R() < 0.35, pc = pick(R, SHUT), leafB = (geo, mm) => painted ? paint.add(geo, mm, pc) : (R() < 0.5 ? B.wood : B.woodDark).add(geo, mm);
    const open = R();
    if (open < 0.45) leafB(boxF(gw, 2.14, 0.07, 'Zz'), m(0, g + 1.075, 0));
    else for (const s of [-1, 1]) {           // leaves swung into the yard
      const th = (open < 0.75 ? 1.2 : 0.55) + R() * 0.4, dx = -s * Math.cos(th), dn = Math.sin(th), w2 = gw / 2 - 0.02;
      const hx = s * gw / 2, cxl = hx + dx * w2 / 2, co = dn * w2 / 2;
      leafB(boxF(w2, 2.12, 0.06, 'XxZz'), mat(x + ex * cxl + nx * co, g + 1.07, z + ez * cxl + nz * co, 0, Math.atan2(-(ez * dx + nz * dn), ex * dx + nx * dn), 0));
      if (open > 0.75) break;
    }
    return g;
  }
  // a sagging line with washing between two points: folded, swinging a little, the colours faded
  function laundry(x0, z0, y0, x1, z1, y1, R) {
    const L0 = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(z1 - z0, x1 - x0), sag = Math.min(0.12, 0.02 * L0), xm = (x0 + x1) / 2, zm = (z0 + z1) / 2, ym = (y0 + y1) / 2 - sag;
    for (const [px, py, pz, qx, qy, qz] of [[x0, y0, z0, xm, ym, zm], [xm, ym, zm, x1, y1, z1]]) small.add(boxF(L0 / 2 + 0.02, 0.018, 0.018, 'Zz'), mr((px + qx) / 2, (py + qy) / 2, (pz + qz) / 2, -a, 0, Math.atan2(qy - py, L0 / 2)), 0x8a7a60);
    for (let s = 0.25 + R() * 0.3; s < L0 - 0.5;) {
      const cw = 0.45 + R() * 0.8, ch = 0.4 + R() * 0.65; if (s + cw > L0 - 0.2) break;
      const k = (s + cw / 2) / L0, yk = lerp(y0, y1, k) - sag * 4 * k * (1 - k);
      cloth.add(pick(R, T.folds), mr(lerp(x0, x1, k), yk - 0.005, lerp(z0, z1, k), -a, (R() - 0.5) * 0.14, (R() - 0.5) * 0.05, V(cw, ch, 1)), pick(R, CLOTH), 0.28);
      s += cw + 0.1 + R() * 0.45;
    }
  }

  // ---------- household things (x,z world; ry turns the thing's front (+z) to where it faces) ----------
  const IT = {
    pithos(x, z, ry, R, n = 1 + Math.floor(R() * 3)) {
      for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) * 1.05, px = x + Math.cos(ry) * a, pz = z - Math.sin(ry) * a, s = 0.85 + R() * 0.25; terra.add(T.pithos, mat(px, gy(px, pz) - 0.12, pz, 0, R() * TAU, 0, s), pick(R, [0xb77a55, 0xa9704c, 0xc08a62])); if (R() < 0.25) small.add(T.disc, mat(px, gy(px, pz) - 0.12 + 1.1 * s, pz, 0, 0, 0, 1.25 * s), 0x6b5a48); }
      collide(rectOf(x - Math.abs(Math.cos(ry)) * (n - 1) * 0.53, z - Math.abs(Math.sin(ry)) * (n - 1) * 0.53, x + Math.abs(Math.cos(ry)) * (n - 1) * 0.53, z + Math.abs(Math.sin(ry)) * (n - 1) * 0.53, 0.45));
    },
    amph(x, z, ry, R, n = 2 + Math.floor(R() * 3)) {
      for (let i = 0; i < n; i++) { const a = (i - (n - 1) / 2) * 0.42, px = x + Math.cos(ry) * a, pz = z - Math.sin(ry) * a; terra.add(T.amph, mr(px, gy(px, pz) - 0.05, pz, ry, -0.22, (R() - 0.5) * 0.2), pick(R, TERRA)); }
      collide(orect(x, z, ry, (n - 1) * 0.21 + 0.2, 0.22));
    },
    well(x, z, R, id) {       // a stone well-head with a worn lip; a crossbar with a rope and a bucket
      const g = gy(x, z); B.socles.add(new THREE.CylinderGeometry(0.62, 0.68, 1.0, 8, 1, true), mat(x, g + 0.22, z)); B.socles.add(T.ring, mat(x, g + 0.725, z, 0, R(), 0)); B.doors.add(T.hole, mat(x, g + 0.45, z));
      if (R() < 0.6) {
        for (const s of [-1, 1]) B.woodDark.add(boxF(0.1, 1.6, 0.1, 'XxZz'), mat(x + s * 0.72, g + 0.8, z)); B.woodDark.add(boxF(1.6, 0.1, 0.1, 'YyZz'), mat(x, g + 1.62, z));
        const yb = g + 0.95 + R() * 0.3, bx = x + 0.12; small.add(boxF(0.02, g + 1.57 - yb - 0.08, 0.02, 'XxZz'), mat(bx, (g + 1.57 + yb + 0.08) / 2, z), 0x7a6a50); terra.add(T.bucket, mat(bx, yb, z, 0, R(), 0), 0x6e5440);
      } else terra.add(T.bucket, mat(x + 0.35, g + 0.83, z - 0.4, 0, R(), 0.25), 0x6e5440);
      if (R() < 0.4) terra.add(T.amph, mat(x + 0.85, g - 0.03, z + 0.3, 0.1, R() * TAU, 0), pick(R, TERRA));
      collide(rectOf(x, z, x, z, 0.72)); poi({ type: 'well', x: x - 0.95, z, y: g, r: 1.2, house: id, ...(id >= 0 ? { note: 'courtyard', private: true } : { note: 'garden' }), _o: [x, z] });
    },
    altar(x, z, R, dir = [0, 1]) { const g = gy(x, z); B.marble.add(boxF(0.6, 0.9, 0.6, 'XxYZz'), mat(x, g + 0.35, z)); B.marble.add(boxF(0.72, 0.1, 0.72, 'XxYyZz'), mat(x, g + 0.82, z)); collide(rectOf(x, z, x, z, 0.36)); poi({ type: 'altar', x: x + dir[0] * 0.9, z: z + dir[1] * 0.9, y: g, ry: Math.atan2(-dir[0], -dir[1]), r: 1, note: 'Zeus Herkeios', _o: [x, z] }); },
    oven(x, z, ry, R) {       // clay dome; an arched mouth set back behind a thick clay rim, a sill stone, firewood
      const g = gy(x, z), fx = Math.sin(ry), fz = Math.cos(ry), at = (o, y, ra = 0) => mr(x + fx * o, y, z + fz * o, ry, ra);
      terra.add(T.dome, mat(x, g - 0.05, z, 0, ry, 0, V(1, 1.05, 1.1)), 0xa88462);
      B.doors.add(T.mouth, at(0.8, g - 0.03)); terra.add(T.rim, at(0.88, g - 0.03), 0xb48c6a); terra.add(T.hood, at(0.82, g - 0.03), 0xa88462);
      B.socles.add(boxF(0.66, 0.12, 0.3, 'XxYZ'), mat(x + fx * 1.03, g - 0.03, z + fz * 1.03, 0, ry, 0));
      for (let i = 0; i < 3; i++) B.woodDark.add(boxF(0.07, 0.07, 0.9, 'XxY'), mat(x + fx * 0.3 + Math.cos(ry) * (1.0 + i * 0.09), g + 0.04 + (i === 2 ? 0.07 : 0), z + fz * 0.3 - Math.sin(ry) * (1.0 + i * 0.09), 0, ry + (R() - 0.5) * 0.3, 0));
      collide(rectOf(x, z, x, z, 0.75)); poi({ type: 'work', x: x + fx * 1.5, z: z + fz * 1.5, y: g, ry: ry + Math.PI, note: 'oven', _o: [x, z] });
    },
    loom(x, z, ry, R) {       // warp-weighted loom leaning back against a wall: warp threads under a woven band, a shed rod, a row of clay weights
      const g = gy(x, z), base = mr(x, g - 0.02, z, ry, -0.15), m = (a, y, o, sc = 1) => base.clone().multiply(mat(a, y, o, 0, 0, 0, sc));
      for (const s of [-1, 1]) B.wood.add(boxF(0.08, 2.0, 0.08, 'XxZzY'), m(s * 0.7, 1.0, 0));
      B.wood.add(boxF(1.6, 0.1, 0.1, 'XxYyZz'), m(0, 1.86, 0));
      wick.add(quadGeo(-0.65, 0.27, 0, 0.65, 0.27, 0, 1.5, 0, 1, AV(503), AV(264)), m(0, 0, 0.03), pick(R, [0xe4dccc, 0xd8d0c0, 0xcfc8ba]));
      B.wood.add(boxF(1.5, 0.035, 0.035, 'YyZ'), m(0, 0.98, 0.07));
      for (let i = 0; i < 14; i++) terra.add(T.weight, m(-0.65 + (18 + 36 * i) / 512 * 1.3, 0.25, 0.05), pick(R, [0x9a6a4a, 0x8e6446, 0xa4745a]));
      collide(orect(x, z, ry, 0.82, 0.3));
      poi({ type: 'work', x: x + Math.sin(ry) * 1.1, z: z + Math.cos(ry) * 1.1, y: g, ry: ry + Math.PI, note: 'loom', _o: [x, z] });
    },
    bench(x, z, ry, R, stone = R() < 0.5) {
      const g = gy(x, z);
      if (stone) B.socles.add(boxF(1.5, 0.75, 0.42, 'XxYZz'), mat(x, g - 0.3 + 0.375, z, 0, ry, 0));
      else { B.wood.add(boxF(1.6, 0.06, 0.38, 'XxYyZz'), mat(x, g + 0.44, z, 0, ry, 0)); for (const s of [-1, 1]) B.woodDark.add(boxF(0.07, 0.62, 0.3, 'XxZz'), mat(x + Math.cos(ry) * s * 0.65, g + 0.11, z - Math.sin(ry) * s * 0.65, 0, ry, 0)); }
      collide(rectOf(x, z, x, z, 0.3));
      poi({ type: 'bench', x: x + Math.sin(ry) * 0.05, z: z + Math.cos(ry) * 0.05, y: g + 0.45, ry });
    },
    wood(x, z, ry, R) {       // split logs stacked along the wall
      const g = gy(x, z), fx = Math.sin(ry), fz = Math.cos(ry);
      for (let i = 0; i < 6; i++) { const r = i < 3 ? 0 : i < 5 ? 1 : 2, o = (i < 3 ? i - 1 : i < 5 ? i - 3.5 : 0) * 0.14; B.woodDark.add(T.log, mr(x + fx * o, g + 0.06 + r * 0.12, z + fz * o, ry + (R() - 0.5) * 0.1, 0, Math.PI / 2)); }
      collide(orect(x, z, ry, 0.6, 0.28));
    },
    pots(x, z, ry, R, n = 1 + Math.floor(R() * 3)) {
      for (let i = 0; i < n; i++) {
        const a = (i - (n - 1) / 2) * 0.42, px = x + Math.cos(ry) * a, pz = z - Math.sin(ry) * a, g = gy(px, pz), s = 0.8 + R() * 0.4;
        terra.add(T.herb, mat(px, g + 0.13 * s, pz, 0, R(), 0, s), pick(R, TERRA));
        leaf.add(T.card2, mat(px, g + 0.42 * s, pz, 0, R() * TAU, 0, 0.55 * s), pick(R, [0x9cc070, 0x7ea860, 0xb0c888, 0x88b070]));
        if (R() < 0.15) small.add(T.card, mat(px, g + 0.5 * s, pz, 0, R() * 3, 0, 0.18), pick(R, [0xa83a3a, 0xc89a3a]));
      }
    },
    chickens(x, z, R, n = 2 + Math.floor(R() * 4)) { for (let i = 0; i < n; i++) { const px = x + (R() - 0.5) * 2.2, pz = z + (R() - 0.5) * 2.2; paint.add(ANIM.chicken, mat(px, gy(px, pz), pz, 0, R() * TAU, 0, 0.9 + R() * 0.3), pick(R, [0xa0623a, 0xbcb098, 0x3a2e26, 0xb88a52])); } },
    animal(kind, x, z, ry, R, col) { paint.add(ANIM[kind], mat(x, gy(x, z) - 0.02, z, 0, ry, 0, 0.9 + R() * 0.2), col); },
    basket(x, z, R, fill = pick(R, [0x3e3a2a, 0x5a3a4a, 0xc8a070, 0x9a6a3a, 0xc8b050, 0x5a2e46, 0xa83a2a, 0x6a8a3a]), y) {
      const g = y ?? gy(x, z); terra.add(T.basket, mat(x, g + 0.14, z), 0xb89a60); small.add(T.disc, mat(x, g + 0.24, z), fill);
    },
  };

  // the part [u0,u1] of a face whose width stays inside lim
  function clipSpan(f, u0, u1, lim) {
    const [ax, az] = f.P(0, 0);
    if (Math.abs(f.tx) > 0.5) { const lo = (lim.minX - ax) / f.tx, hi = (lim.maxX - ax) / f.tx; return [Math.max(u0, Math.min(lo, hi)), Math.min(u1, Math.max(lo, hi))]; }
    const lo = (lim.minZ - az) / f.tz, hi = (lim.maxZ - az) / f.tz; return [Math.max(u0, Math.min(lo, hi)), Math.min(u1, Math.max(lo, hi))];
  }
  // ground patch that follows the terrain (pebbled yard floors)
  function patch(r, lift = 0.1) {
    const nx = Math.max(1, Math.ceil((r.maxX - r.minX) / 3.5)), nz = Math.max(1, Math.ceil((r.maxZ - r.minZ) / 3.5)), pos = [], uv = [], idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = lerp(r.minX, r.maxX, i / nx), z = lerp(r.minZ, r.maxZ, j / nz); pos.push(x, gy(x, z) + lift, z); uv.push(x, -z); }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + nx + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    B.walls.add(g, null, pick(TR, [0xc4ae88, 0xbba582, 0xcab690]));
  }
  const ladder = (x, y, z, ry, len, lean = 0.3) => { const base = mr(x, y, z, ry, -lean); for (const s of [-1, 1]) B.woodDark.add(boxF(0.06, len, 0.06, 'XxZz'), base.clone().multiply(mat(s * 0.22, len / 2, 0))); for (let k = 0.35; k < len - 0.1; k += 0.38) B.woodDark.add(boxF(0.44, 0.04, 0.04, 'YyZz'), base.clone().multiply(mat(0, k, 0))); };

  // ---------- walled yards ----------
  function yard(h, s, u0, u1, D, R) {
    const f = faceOf(h, s), t = 0.42, H = 2.0 + R() * 0.5, col = h.plaster, cap = R() < 0.6 ? h.roof : null, sg = h.ry === 0 ? 1 : -1;
    const doorU = s === 0 ? (h.door.x - h.x) * sg : null, iu0 = u0 + t + 0.05, iu1 = u1 - t - 0.05, io1 = D - t - 0.05;
    const W = (u, o) => f.P(u, o);
    // gate: on the outer wall or a side wall, whichever opens onto free ground (streets preferred)
    const blk = L.blockRect(h.k, h.m), gw = 1.15 + R() * 0.25, cands = [];
    const edgeDist = r => { const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2; return Math.min(cx - blk.minX, blk.maxX - cx, cz - blk.minZ, blk.maxZ - cz); };
    { const g = s === 0 ? clamp(doorU + (R() < 0.5 ? -1 : 1) * (0.6 + R() * 1.3), u0 + 1.3, u1 - 1.3) : lerp(u0 + 1.3, u1 - 1.3, R()); const ap = f.rect(g - 0.9, g + 0.9, D + 0.05, D + 1.5); cands.push({ side: 'outer', g, ap, score: (s === 0 ? 3 : 0) - edgeDist(ap) * 0.3 + R() }); }
    if (D - t - 1.2 >= 1.3) for (const side of ['s0', 's1']) { const go = lerp(1.25, D - t - 1.2, 0.3 + R() * 0.4), uu = side === 's0' ? u0 : u1, ap = side === 's0' ? f.rect(u0 - 1.5, u0 - 0.05, go - 0.9, go + 0.9) : f.rect(u1 + 0.05, u1 + 1.5, go - 0.9, go + 0.9); cands.push({ side, g: go, ap, score: -edgeDist(ap) * 0.3 + R() }); }
    const ok = cands.filter(c => free(c.ap, h.id, 0.3)).sort((a, b) => b.score - a.score);
    if (!ok.length) return null;
    const G = ok[0];
    // walls
    const gap = c => [c.g - gw / 2 - 0.5, c.g + gw / 2 + 0.5];
    { const p = W(u0, D - t / 2), q = W(u1, D - t / 2); wallLine(p[0], p[1], q[0], q[1], H, t, col, cap, G.side === 'outer' ? gap({ g: G.g - u0 }) : null, 'se'); }
    for (const side of ['s0', 's1']) { const uu = side === 's0' ? u0 + t / 2 : u1 - t / 2, p = W(uu, -0.03), q = W(uu, D - t); wallLine(p[0], p[1], q[0], q[1], H, t, col, cap, G.side === side ? gap({ g: G.g + 0.03 }) : null); }
    let gx, gz, ex, ez, nx, nz;
    if (G.side === 'outer') { [gx, gz] = W(G.g, D - t / 2); ex = f.tx; ez = f.tz; nx = -f.nx; nz = -f.nz; }
    else { [gx, gz] = W(G.side === 's0' ? u0 + t / 2 : u1 - t / 2, G.g); ex = f.nx; ez = f.nz; nx = G.side === 's0' ? f.tx : -f.tx; nz = G.side === 's0' ? f.tz : -f.tz; }
    const gg = gate(gx, gz, ex, ez, nx, nz, gw, H, t, col, cap, R);
    poi({ type: 'door', x: gx - nx * 0.9, z: gz - nz * 0.9, y: gg, nx: -nx, nz: -nz, house: h.id, note: 'yard gate' });
    claim(f.rect(u0, u1, 0, D), h.id); claim(G.ap, 'g' + h.id);
    // for the people and the features built later: the yard is private ground, the apron before its gate is kept clear
    L.addArea({ name: 'yard', private: true, owner: OWN, house: h.id, ...f.rect(u0 + t, u1 - t, 0.1, D - t), y: h.y });
    L.addArea({ name: 'gate', note: 'yard gate apron', owner: OWN, house: h.id, ...G.ap });
    stats.yards++;
    if (R() < 0.5) patch(f.rect(u0 + t, u1 - t, 0.08, D - t), 0.1);

    // contents: sample free spots in yard coordinates, keeping the way from gate to door clear
    const gu = G.side === 'outer' ? G.g : G.side === 's0' ? u0 : u1, go = G.side === 'outer' ? D : G.g;
    const pathTo = s === 0 ? [doorU, 0.3] : [G.side === 'outer' ? G.g : lerp(gu, (u0 + u1) / 2, 0.5), G.side === 'outer' ? D - 1.8 : go];
    const occ = [];
    const segDist = (u, o) => { const [au, ao] = [gu, go], [bu, bo] = pathTo, du = bu - au, dO = bo - ao, l2 = du * du + dO * dO || 1, k = clamp(((u - au) * du + (o - ao) * dO) / l2, 0, 1); return Math.hypot(u - au - k * du, o - ao - k * dO); };
    const fits = (u, o, r, a = 0.6) => u - r >= iu0 && u + r <= iu1 && o - r >= 0.08 && o + r <= io1 && segDist(u, o) > r + a && occ.every(c => Math.hypot(c[0] - u, c[1] - o) > c[2] + r);
    const spot = (r, oMin = 0) => { for (let k = 0; k < 14; k++) { const u = lerp(iu0 + r, iu1 - r, R()), o = lerp(Math.max(0.08 + r, oMin), io1 - r, R()); if (fits(u, o, r)) { occ.push([u, o, r]); return [u, o]; } } return null; };
    // along a wall: returns [u, o, ra] with the thing's back to the wall
    const wallSpot = (width, depth, houseOnly = false) => {
      for (let k = 0; k < 12; k++) {
        const wsel = houseOnly ? 0 : Math.floor(R() * 4); let u, o, ra;
        if (wsel === 0) { u = lerp(iu0 + width / 2, iu1 - width / 2, R()); o = 0.1 + depth; ra = 0; }
        else if (wsel === 1) { u = lerp(iu0 + width / 2, iu1 - width / 2, R()); o = io1 - depth; ra = Math.PI; }
        else { o = lerp(0.3 + width / 2, io1 - width / 2, R()); u = wsel === 2 ? iu0 + depth : iu1 - depth; ra = wsel === 2 ? Math.PI / 2 : -Math.PI / 2; }
        const r = Math.max(width, depth * 2) / 2;
        if (u - depth < iu0 - 0.01 || u + depth > iu1 + 0.01 || o - 0.06 < 0 || o + depth > io1 + 0.01 || width / 2 > (ra === 0 || ra === Math.PI ? (iu1 - iu0) / 2 : io1 / 2)) continue;
        if (segDist(u, o) > r * 0.8 + 0.6 && occ.every(c => Math.hypot(c[0] - u, c[1] - o) > c[2] + r * 0.8)) { occ.push([u, o, r * 0.8]); return [u, o, ra]; }
      }
      return null;
    };
    const at = (u, o) => W(u, o), yawOf = ra => f.ry + ra;
    if (s === 0) occ.push([doorU, 0.4, 1.0]);
    // a lean-to (pastas) along the house wall, or a store room with a roof terrace in a far corner
    const inf = { s, u0, u1, D, f, t, H, pastas: 0 };
    if (R() < 0.2 && io1 > 3.6 && f.top > 3.6) {
      const pd = Math.min(2.3, io1 - 1.6), yTop = h.y + Math.min(f.top - 0.3, 3.05), yLow = h.y + 2.45, n = Math.max(2, Math.round((iu1 - iu0) / 2.6) + 1), pu0 = iu0 + 0.2, pu1 = iu1 - 0.2;
      if (gy(...at(pu0, pd)) < h.y + 0.25 && gy(...at(pu1, pd)) < h.y + 0.25) {
        for (let i = 0; i < n; i++) { const [px, pz] = at(lerp(pu0, pu1, i / (n - 1)), pd); pole(B.woodDark, px, gy(px, pz) - 0.1, pz, yLow - gy(px, pz) + 0.1, 0.075); collide(rectOf(px, pz, px, pz, 0.1)); }
        B.woodDark.add(boxF(pu1 - pu0 + 0.3, 0.16, 0.16, 'YyZz'), f.M((pu0 + pu1) / 2, yLow + 0.02, pd));
        const sl = Math.hypot(pd + 0.35, yTop - yLow), ang = Math.atan2(yTop - yLow, pd + 0.35);
        B.roofs.add(boxF(pu1 - pu0 + 0.7, 0.09, sl + 0.2, 'XxYyZz'), f.M((pu0 + pu1) / 2, (yTop + yLow) / 2 + 0.12, (pd + 0.35) / 2 - 0.05).multiply(mat(0, 0, 0, ang, 0, 0)), h.roof);
        inf.pastas = pd; occ.push(...[0.25, 0.5, 0.75].map(k => [lerp(pu0, pu1, k), pd, 0.25]));
      }
    } else if (R() < 0.3 && io1 > 4.4 && iu1 - iu0 > 5.6) {
      const aw = 2.8 + R() * 0.7, ad = 2.6 + R() * 0.6, left = G.side === 's1' || (G.side === 'outer' && G.g > (u0 + u1) / 2);
      const au = left ? iu0 + aw / 2 - 0.05 : iu1 - aw / 2 + 0.05, ao = io1 - ad / 2 + 0.05;
      if (occ.every(c => Math.abs(c[0] - au) > aw / 2 + c[2] || Math.abs(c[1] - ao) > ad / 2 + c[2]) && segDist(au, ao) > Math.max(aw, ad) / 2 + 0.7) {
        const [cx, cz] = at(au, ao), corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => gy(...at(au + a * aw / 2, ao + b * ad / 2)));
        const g0 = Math.min(...corners), g1 = Math.max(...corners), Ha = g1 + 2.75 + R() * 0.3, ry = f.ry;
        B.walls.add(boxF(aw, Ha - g0 + 0.5, ad, 'XxZz'), mat(cx, (Ha + g0 - 0.5) / 2, cz, 0, ry, 0), col);
        B.socles.add(boxF(aw + 0.08, g1 - g0 + 0.9, ad + 0.08, 'XxZz'), mat(cx, g0 - 0.5 + (g1 - g0 + 0.9) / 2, cz, 0, ry, 0));
        B.walls.add(boxF(aw, 0.05, ad, 'Y'), mat(cx, Ha - 0.02, cz, 0, ry, 0), 0xbcaa88);
        const par = [{ o: 0, y: 0 }, { o: 0, y: 0.6, hard: true }, { o: -0.18, y: 0.6, hard: true }, { o: -0.18, y: 0.02 }];
        B.walls.add(rectSweep(aw, ad, par), mat(cx, Ha - 0.02, cz, 0, ry, 0), col);
        const du = au + (left ? 0.4 : -0.4); B.doors.add(boxF(0.85, 1.9, 0.12, 'ZXxY'), f.M(du, gy(...at(du, ao - ad / 2)) + 0.93, ao - ad / 2 + 0.02, Math.PI));
        // ladder against the side facing the yard, washing or an awning on the roof
        const lo = ao - ad / 4, hc = Ha + 0.55 - gy(...at(left ? au + aw / 2 + 1 : au - aw / 2 - 1, lo)), ldist = hc * Math.tan(0.3), lu = left ? au + aw / 2 + ldist : au - aw / 2 - ldist;
        ladder(...(() => { const p = at(lu, lo); return [p[0], gy(...p) - 0.05, p[1]]; })(), yawOf(left ? Math.PI / 2 : -Math.PI / 2), hc / Math.cos(0.3) + 0.5, 0.3);
        if (R() < 0.5) { const a = at(au - aw / 2 + 0.25, ao - ad / 2 + 0.25), b = at(au + aw / 2 - 0.25, ao + ad / 2 - 0.25); for (const p of [a, b]) pole(B.woodDark, p[0], Ha, p[1], 1.5, 0.035); laundry(a[0], a[1], Ha + 1.45, b[0], b[1], Ha + 1.45, R); }
        else { const aa = at(au, ao); cloth.add(T.ccard, mr(aa[0], Ha + 1.9, aa[1], ry, -Math.PI / 2 + 0.08, 0, V(aw - 0.5, ad - 0.5, 1)), pick(R, CLOTH)); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = at(au + a * (aw / 2 - 0.3), ao + b * (ad / 2 - 0.3)); pole(B.woodDark, p[0], Ha, p[1], 1.9 - b * 0.1, 0.035); } IT.pots(...at(au, ao - ad / 2 + 0.45), ry, R, 2); }
        collide(f.rect(au - aw / 2, au + aw / 2, ao - ad / 2, ao + ad / 2));
        occ.push([au, ao, Math.max(aw, ad) / 2 + 0.2], [lu, lo, 0.5]); stats.annex++;
        inf.annex = { au, ao, aw, ad, Ha };
      }
    }
    // a vine arbour along the house wall
    if (!inf.pastas && !inf.annex && R() < 0.22 && io1 > 3.4 && iu1 - iu0 > 3.6) {
      const Wp = Math.min(iu1 - iu0 - 0.4, 2.6 + R() * 1.4), Dg = Math.min(2.4, io1 - 1.2), uc = s === 0 ? clamp(doorU, iu0 + Wp / 2 + 0.2, iu1 - Wp / 2 - 0.2) : lerp(iu0 + Wp / 2 + 0.2, iu1 - Wp / 2 - 0.2, R());
      if ([-1, 1].every(sd => gy(...at(uc + sd * Wp / 2, Dg)) < h.y + 0.3) && segDist(uc - Wp / 2, Dg) > 0.5 && segDist(uc + Wp / 2, Dg) > 0.5) { pergola(h, f, R, uc, Wp, Dg); inf.arbour = true; occ.push([uc - Wp / 2, Dg, 0.3], [uc + Wp / 2, Dg, 0.3]); }
    }
    // washing across the yard (decided first so trees keep clear of the line)
    let line = null;
    if (R() < 0.42) {
      if (iu1 - iu0 < 8.5 && io1 > 2.2) { const o = lerp(inf.pastas + 0.8, io1 - 0.4, R()), a = W(u0 + t / 2, o), b = W(u1 - t / 2, o); laundry(a[0], a[1], gy(...a) + H - 0.08, b[0], b[1], gy(...b) + H - 0.08, R); line = { o }; }
      else if (io1 > 2.5 && !inf.pastas) { const u = lerp(iu0 + 0.8, iu1 - 0.8, R()), a = W(u, 0.02), b = W(u, D - t / 2); laundry(a[0], a[1], h.y + Math.min(2.3, f.top - 0.5), b[0], b[1], gy(...b) + H - 0.08, R); line = { u }; }
    }
    // what stands in the yard
    const want = [];
    if (R() < 0.7) want.push('tree'); if (R() < 0.2) want.push('well'); else if (R() < 0.12) want.push('altar');
    for (const [k, p] of [['pithos', 0.3], ['oven', 0.18], ['loom', 0.14], ['bench', 0.14], ['amph', 0.12], ['wood', 0.1], ['chickens', 0.1], ['pots', 0.18]]) if (R() < p) want.push(k);
    let n = 0;
    for (const k of want) {
      if (n >= 3) break;
      if (k === 'tree') {
        let p = null;
        for (let a = 0; a < 3 && !p; a++) { const q = spot(0.5, 1.4 + inf.pastas); if (!q) break; if (line && Math.abs(line.o !== undefined ? q[1] - line.o : q[0] - line.u) < 1.5) { occ.pop(); continue; } p = q; }
        if (p) {
          const [x, z] = at(...p), room = Math.min(p[1] - inf.pastas, p[0] - iu0 + 0.7, iu1 - p[0] + 0.7, io1 - p[1] + 1.0);
          if (room >= 1.3 && plantTree(pick(R, ['fig', 'fig', 'pom', 'olive', 'almond']), x, z, clamp(room / 2.4, 0.55, 1.0), R)) { collide(rectOf(x, z, x, z, 0.22)); n++; }
        }
        continue;
      }
      if (k === 'well' || k === 'altar' || k === 'chickens') { const p = spot(k === 'well' ? 1.0 : k === 'altar' ? 0.6 : 1.1, inf.pastas + 0.3); if (p) { const [x, z] = at(...p); const [cx, cz] = at((iu0 + iu1) / 2, io1 / 2), dl = Math.hypot(cx - x, cz - z); k === 'well' ? IT.well(x, z, R, h.id) : k === 'altar' ? IT.altar(x, z, R, dl > 0.3 ? [(cx - x) / dl, (cz - z) / dl] : [f.nx, f.nz]) : IT.chickens(x, z, R); n++; } continue; }
      const dims = { pithos: [2.2, 0.6], oven: [1.7, 0.85], loom: [1.8, 0.5], bench: [1.7, 0.3], amph: [1.5, 0.3], wood: [1.3, 0.4], pots: [1.4, 0.3] }[k];
      const p = wallSpot(dims[0], dims[1], k === 'loom' && R() < 0.6); if (!p) continue;
      const [x, z] = at(p[0], p[1]), ry = yawOf(p[2]);
      if (k === 'pithos') IT.pithos(x, z, ry, R, 1 + Math.floor(R() * 2)); else if (k === 'oven') IT.oven(x, z, ry, R); else if (k === 'loom') IT.loom(x, z, ry, R);
      else if (k === 'bench') IT.bench(x, z, ry, R); else if (k === 'amph') IT.amph(x, z, ry, R); else if (k === 'wood') IT.wood(x, z, ry, R); else IT.pots(x, z, ry, R);
      n++;
    }
    return inf;
  }

  // ---------- facades ----------
  // a small high window with wooden shutters (closed, or folded back against the wall)
  function windowAt(f, u, y, R, o0 = 0) {
    if (HB.hit(f.rect(u - 0.62, u + 0.62, 0.02, 0.3))) return;       // a neighbour's wall (or wing) stands right against it
    if (Math.max(gy(...f.P(u - 0.3, 0.35)), gy(...f.P(u + 0.3, 0.35))) > y - 0.9) return;        // the ground outside rises up to it
    if (o0 === 0) { B.doors.add(boxF(0.48, 0.52, 0.06, 'Z'), f.M(u, y, 0)); small.add(boxF(0.62, 0.05, 0.14, 'YZ'), f.M(u, y - 0.285, 0.04), 0xcdbf9f); }
    const painted = R() < 0.55, pc = pick(R, SHUT), put = (g, m) => painted ? paint.add(g, m, pc) : B.wood.add(g, m), hw = o0 ? 0.29 : 0.25, lh = o0 ? 0.74 : 0.56;
    if (R() < 0.3) put(boxF(hw * 2 + 0.06, lh + 0.04, 0.05, 'ZXx'), f.M(u, y, o0 + 0.05));
    else for (const s of [-1, 1]) { const th = 1.9 + R() * 1.15, du = -s * Math.cos(th), dn = Math.sin(th); put(boxF(hw, lh, 0.035, 'Zz'), f.M(u + s * hw + du * hw / 2, y, o0 + 0.03 + dn * hw / 2, Math.atan2(-dn, du))); }
  }
  // wooden balcony in front of the upper windows
  function balcony(h, f, R, uc, W, Dp) {
    const y = h.y + h.h - 1.85, dk = R() < 0.5 ? B.woodDark : B.wood;
    B.wood.add(boxF(W, 0.1, Dp, 'XxYyZ'), f.M(uc, y - 0.05, Dp / 2));
    for (const s of (W > 2.6 ? [-1, 0, 1] : [-1, 1])) {
      const u = uc + s * (W / 2 - 0.15);
      dk.add(boxF(0.1, 0.12, Dp, 'XxyZ'), f.M(u, y - 0.16, Dp / 2));
      dk.add(boxF(0.08, Math.hypot(0.75, Dp - 0.1), 0.08, 'XxZz'), f.M(u, y - 0.595, (Dp - 0.1) / 2).multiply(mat(0, 0, 0, Math.atan2(Dp - 0.1, 0.75), 0, 0)));
    }
    for (const s of [-1, 1]) { dk.add(boxF(0.07, 0.95, 0.07, 'XxZzY'), f.M(uc + s * (W / 2 - 0.04), y + 0.47, Dp - 0.04)); dk.add(boxF(0.07, 0.07, Dp, 'XxYy'), f.M(uc + s * (W / 2 - 0.04), y + 0.95, Dp / 2)); }
    dk.add(boxF(W, 0.07, 0.09, 'YyZz'), f.M(uc, y + 0.95, Dp - 0.04));
    if (R() < 0.7) { dk.add(boxF(W - 0.1, 0.55, 0.03, 'Zz'), f.M(uc, y + 0.45, Dp - 0.05)); for (const s of [-1, 1]) dk.add(boxF(0.03, 0.55, Dp - 0.1, 'Xx'), f.M(uc + s * (W / 2 - 0.05), y + 0.45, Dp / 2)); }
    else { const n = Math.min(5, Math.floor(W / 0.4)); for (let i = 1; i < n; i++) dk.add(boxF(0.045, 0.85, 0.045, 'XxZz'), f.M(uc - W / 2 + i * W / n, y + 0.45, Dp - 0.04)); }
    if (R() < 0.45) { const cw = 0.6 + R() * 0.7; cloth.add(T.ccard, f.M(uc + (R() - 0.5) * (W - cw - 0.2), y + 0.62, Dp + 0.02, 0, V(cw, 0.72, 1)), pick(R, CLOTH)); }
    if (R() < 0.35) { const u = uc + (R() < 0.5 ? -1 : 1) * (W / 2 - 0.35); terra.add(T.herb, f.M(u, y + 0.13, Dp - 0.3), pick(R, TERRA)); leaf.add(T.card2, f.M(u, y + 0.45, Dp - 0.3, R(), 0.6), 0x8ab868); }
    stats.balcony++;
  }
  // vine pergola over the door
  function pergola(h, f, R, uc, Wp, Dg) {
    const yT = h.y + 2.5 + R() * 0.15, dk = B.woodDark;
    for (const s of [-1, 1]) { const [px, pz] = f.P(uc + s * Wp / 2, Dg), g = gy(px, pz); pole(dk, px, g - 0.1, pz, yT - g + 0.12, 0.07); collide(rectOf(px, pz, px, pz, 0.1)); if (s < 0) bark.add(branch([px + 0.12 * f.nx, g - 0.05, pz + 0.12 * f.nz], [px + 0.2 * f.tx, yT + 0.1, pz + 0.2 * f.tz], 0.07, 4)); }
    dk.add(boxF(Wp + 0.4, 0.13, 0.13, 'YyZzXx'), f.M(uc, yT + 0.03, Dg));
    dk.add(boxF(Wp + 0.4, 0.1, 0.1, 'YyZ'), f.M(uc, yT + 0.03, 0.05));
    for (let i = 0; i < 4; i++) dk.add(boxF(0.07, 0.08, Dg + 0.4, 'XxYy'), f.M(uc - Wp / 2 + i * Wp / 3, yT + 0.14, (Dg + 0.4) / 2));
    const n = 9 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) { const [x, z] = f.P(uc + (i / (n - 1) - 0.5) * (Wp + 0.3) + (R() - 0.5) * 0.4, 0.5 + R() * (Dg - 0.25)); leaf.add(T.card, mr(x, yT + 0.2 + R() * 0.15, z, R() * TAU, -Math.PI / 2 + (R() - 0.5) * 0.5, 0, 1.4 + R() * 0.5), pick(R, [0x9ccc68, 0x8abc5c, 0xa8d078])); }
    for (let i = 0; i < 2; i++) { const [x, z] = f.P(uc + (R() - 0.5) * Wp, Dg + 0.05); leaf.add(T.card, mat(x, yT - 0.2, z, 0, f.ry + (R() - 0.5) * 0.5, 0, V(0.9, 0.7, 1)), 0x94c464); }
    for (let i = 0; i < 4; i++) { const [x, z] = f.P(uc + (R() - 0.5) * Wp * 0.8, 0.4 + R() * (Dg - 0.5)); small.add(T.cone, mat(x, yT - 0.05, z, Math.PI, 0, 0, V(0.07, 0.2, 0.07)), 0x4a2a44); }
    stats.pergola++;
  }
  // steps up to a door above the street: a straight flight out from the wall where there is room, else a landing and a flight along the wall towards the
  // lower ground. ok(ua, ub, o0, o1) says whether a piece of ground in front of the facade is free. Returns null, or {top: the lowest tread, depth, foot: [u, o]}
  function doorSteps(h, f, du, room, ok, blim) {
    const depth = 0.32, nOf = d => { let k = clamp(Math.ceil(d / 0.22), 1, 8); if (d / k > 0.3) k = Math.ceil(d / 0.3); return k; };
    let g1 = gy(...f.P(du, 0.7)), dh = h.y - g1;
    if (dh < 0.16) return null;
    let n = nOf(dh);
    for (let it = 0; it < 3; it++) { const gE = Math.min(g1, gy(...f.P(du, n * depth + 0.2))), n2 = nOf(h.y - gE); if (n2 === n || n2 > 8) { g1 = gE; dh = h.y - gE; n = n2; break; } n = n2; g1 = gE; dh = h.y - gE; }
    for (const W of [1.5, 1.15]) {
      if (n > 8 || n * depth + 0.15 > room || !ok(du - W / 2 - 0.05, du + W / 2 + 0.05, 0.05, n * depth + 0.1)) continue;
      const rise = dh / n, bot = g1 - 0.4;
      for (let k = 0; k < n; k++) { const top = h.y - k * rise, d = (k + 1) * depth; B.socles.add(boxF(W + k * 0.05, top - bot, d, 'XxYZ'), f.M(du, (top + bot) / 2, d / 2)); }
      const [px, pz] = f.P(du, 0);
      steps.push({ ...f.rect(du - W / 2, du + W / 2, 0, n * depth), px, pz, nx: f.nx, nz: f.nz, y0: h.y, rise, depth, n });
      claim(f.rect(du - W / 2 - 0.05, du + W / 2 + 0.05, 0, n * depth + 0.1), 'st' + h.id);
      return { top: h.y - (n - 1) * rise, depth: n * depth, foot: [du, n * depth + 0.45] };
    }
    // the depth of ground in front of the door inside the block (a narrow flight is better than none)
    const [cx0, cz0] = f.P(du, 0), avail = f.nz > 0.5 ? blim.maxZ - cz0 : f.nz < -0.5 ? cz0 - blim.minZ : f.nx > 0.5 ? blim.maxX - cx0 : cx0 - blim.minX;
    const lim = blim, LW = 1.4, LD = Math.min(1.25, avail - 0.05);
    if (LD >= 0.6) for (const [sd] of [-1, 1].map(s => [s, gy(...f.P(du + s * 2.6, 0.6))]).sort((a, b) => a[1] - b[1])) {
      for (let m = 1; m <= 8; m++) {
        const uE = du + sd * (LW / 2 + m * depth), gE = Math.max(gy(...f.P(uE + sd * 0.35, 0.55)), gy(...f.P(uE - sd * 0.16, LD + 0.3))), rise = (h.y - gE) / (m + 1);
        if (rise > 0.3) continue;
        if (rise < 0.1) break;
        const ua = Math.min(du - sd * LW / 2, uE), ub = Math.max(du - sd * LW / 2, uE), r = f.rect(ua, ub + 0, 0, LD);
        if (!inRect(inset(r, 0.01), lim) || !ok(ua - 0.05, ub + 0.05, 0.05, LD, lim)) break;
        // where the landing or a tread stands more than 0.55 m over the ground in front, a thin guard along its outer edge — only on a landing deep enough to
        // leave a person room to pass between the guard and the house (a shallower one stays open)
        const pcs = [[du - LW / 2, du + LW / 2, h.y, Math.min(...[-1, 0, 1].map(k => gy(...f.P(du + k * LW / 2, LD + 0.3))))]];
        for (let k = 1; k <= m; k++) { const u0 = du + sd * (LW / 2 + (k - 1) * depth), u1 = u0 + sd * depth; pcs.push([Math.min(u0, u1), Math.max(u0, u1), h.y - k * rise, gy(...f.P((u0 + u1) / 2, LD + 0.3))]); }
        const guard = LD >= 1.05 ? pcs.filter(q => q[2] - q[3] > 0.55) : [];
        const gLow = Math.min(...[ua - 0.4, ua, (ua + ub) / 2, ub, ub + 0.4].flatMap(u => [0.1, LD, LD + 0.3].map(o => gy(...f.P(u, o))))) - 0.6;
        B.socles.add(boxF(LW, h.y - gLow, LD, 'XxYZ'), f.M(du, (h.y + gLow) / 2, LD / 2));
        steps.push({ ...f.rect(du - LW / 2, du + LW / 2, 0, LD), flat: h.y });
        for (let k = 1; k <= m; k++) {
          const top = h.y - k * rise, u0 = du + sd * (LW / 2 + (k - 1) * depth), u1 = u0 + sd * depth;
          B.socles.add(boxF(depth + 0.01, top - gLow, LD, sd > 0 ? 'XYZ' : 'xYZ'), f.M((u0 + u1) / 2, (top + gLow) / 2, LD / 2));       // (the face towards the landing is inside the higher tread)
          steps.push({ ...f.rect(Math.min(u0, u1), Math.max(u0, u1), 0, LD), flat: top });
        }
        for (const q of guard) collide(f.rect(q[0], q[1], LD - 0.04, LD));
        claim(f.rect(ua - 0.05, ub + 0.05, 0, LD), 'st' + h.id); stats.sideFlights = (stats.sideFlights || 0) + 1;
        return { top: h.y - m * rise, depth: LD, foot: [uE - sd * 0.16, LD + 0.5], along: true };
      }
    }
    if (dh <= 0.5 && avail >= 0.3) {       // a low door: one tall threshold step
      const d = Math.min(0.42, avail - 0.05), bot = g1 - 0.4, W = 1.4;
      if (ok(du - W / 2 - 0.05, du + W / 2 + 0.05, 0.05, d)) {
        B.socles.add(boxF(W, h.y - bot, d, 'XxYZ'), f.M(du, (h.y + bot) / 2, d / 2)); steps.push({ ...f.rect(du - W / 2, du + W / 2, 0, d), flat: h.y });
        claim(f.rect(du - W / 2 - 0.05, du + W / 2 + 0.05, 0, d), 'st' + h.id); return { top: h.y, depth: d, foot: [du, d + 0.45] };
      }
    }
    return null;
  }
  function facade(h, R, yd, shop) {
    const f = faceOf(h, 0), sg = h.ry === 0 ? 1 : -1, du = (h.door.x - h.x) * sg, len = f.len;
    const blim = inset(L.blockRect(h.k, h.m), 0.3), inYard = yd && yd.s === 0, t = 0.42;
    const yardOk = (ua, ub, o) => !inYard || (ua >= yd.u0 + t + 0.05 && ub <= yd.u1 - t - 0.05 && o <= yd.D - t - 0.1);
    const roomAt = (ua, ub, max = 3) => { if (inYard) return yardOk(ua, ub, 0) ? Math.min(max, yd.D - t - 0.1 - (yd.annex && Math.abs(yd.annex.au - (ua + ub) / 2) < yd.annex.aw / 2 + (ub - ua) / 2 ? yd.annex.ad : 0)) : 0; let D = 0; while (D < max && inRect(f.rect(ua, ub, 0.05, D + 0.25), blim) && free(f.rect(ua, ub, 0.05, D + 0.25), h.id, 0.2) && !CG.hit(f.rect(ua, ub, 0.05, D + 0.25), 0.02)) D += 0.25; return D; };
    const shopU = shop && shop.s === 0 ? [shop.u0 - 0.3, shop.u1 + 0.3] : null, clearOfShop = (a, b) => !shopU || b < shopU[0] || a > shopU[1];
    const shopDoor = shop && shop.s === 0 && Math.abs(du - shop.uc) < shop.ow / 2 + 0.3, wingR = h.wing && { minX: h.wing.x - h.wing.w / 2, maxX: h.wing.x + h.wing.w / 2, minZ: h.wing.z - h.wing.d / 2, maxZ: h.wing.z + h.wing.d / 2 };
    const open = (ua, ub, o0, o1, lim = blim) => { const r = f.rect(ua, ub, o0, o1); return yardOk(ua, ub, o1) && (inYard || inRect(r, lim)) && free(r, h.id, 0.1) && !CG.hit(r, 0.02) && !(wingR && ov(r, wingR, 0.25)) && !(shop && shop.s === 0 && ub > shop.uc - shop.ow / 2 - 0.35 && ua < shop.uc + shop.ow / 2 + 0.35); };
    // a door leaf set in the socle's face (the original door box stands 0.09 m out: this covers it), and the old doorway walled up in the wall's own finish
    const doorLeaf = (y0, y1) => B.doors.add(boxF(1.1, y1 - y0, 0.06, 'Z'), f.M(du, (y0 + y1) / 2, 0.07));
    const wallUp = (y0, y1) => {
      const sT = Math.min(y1, h.y + 1.0);
      if (sT > y0) B.socles.add(patchGeo(1.16, sT - y0, 0.11, sT < y1 ? 0 : 0.14), f.M(du, y0, 0));
      if (y1 > Math.max(y0, h.y + 1.0)) { const a = Math.max(y0, h.y + 1.0); B.walls.add(patchGeo(1.16, y1 - a, 0.11, 0.14), f.M(du, a, 0), h.plaster); }
    };
    // a street door that cannot be raised out of the ground: the way in is on a side or the back, where the ground lies nearest the floor
    let sideIn = null;
    const sideDoor = () => {
      let best = null;
      for (const s of [1, 3, 2]) {
        if ((shop && shop.s === s)) continue;
        const fs = faceOf(h, s), yardHere = yd && yd.s === s;
        for (let u = -fs.len / 2 + 1.0; u <= fs.len / 2 - 1.0; u += 0.5) {
          const gs = [gy(...fs.P(u - 0.55, 0.3)), gy(...fs.P(u + 0.55, 0.3)), gy(...fs.P(u, 0.8))], gMax = Math.max(...gs), gMin = Math.min(...gs);
          if (gMax - h.y > 0.3 || h.y - gMin > 0.35) continue;
          const r = fs.rect(u - 0.8, u + 0.8, 0.05, 1.3);
          if (HB.hit(r, 0.05, h.id) || (wingR && ov(r, wingR, 0.2)) || FG.hit(r, 0.1) || CG.hit(r, 0.02) || MG.hit(r, 0.02, h.id) || L.isReserved(r, 0.1)) continue;
          if (yardHere ? !(u - 0.8 >= yd.u0 + t + 0.05 && u + 0.8 <= yd.u1 - t - 0.05 && yd.D - t > 1.5) : !inRect(r, blim)) continue;
          const score = gMin + Math.abs(u) * 0.01;
          if (!best || score < best.score) best = { s, fs, u, gMax, gMin, score };
        }
      }
      if (!best) return null;
      const { fs, u, gMax, gMin } = best, yS = Math.max(h.y, gMax + 0.02);
      B.doors.add(boxF(1.0, 2.0, 0.06, 'Z'), fs.M(u, yS + 1.0, 0.07));
      for (const sd of [-1, 1]) B.socles.add(boxF(0.12, 2.05, 0.16, 'XxZ'), fs.M(u + sd * 0.56, yS + 0.975, 0.08));
      B.socles.add(boxF(1.4, 0.22, 0.18, 'XxYyZ'), fs.M(u, yS + 2.11, 0.09));
      let stepTop = null;
      if (yS - gMin > 0.12) { B.socles.add(boxF(1.3, yS - gMin + 0.3, 0.32, 'XxYZ'), fs.M(u, (yS + gMin - 0.3) / 2, 0.16)); steps.push({ ...fs.rect(u - 0.65, u + 0.65, 0, 0.32), flat: yS }); stepTop = yS; }
      claim(fs.rect(u - 0.8, u + 0.8, 0, 1.3), 'sd' + h.id);
      return { ...best, stepTop };
    };
    // where the street rises above the threshold the door is set higher, level with the ground outside (the old one is buried behind it)
    const gDs = [gy(...f.P(du - 0.55, 0.2)), gy(...f.P(du + 0.55, 0.2)), gy(...f.P(du, 0.6))], gD = Math.max(...gDs), sunk = !shopDoor && gD - h.y > 0.35;
    let yD = sunk ? gD + 0.02 : h.y; const dH = sunk ? Math.min(2.1, h.y + h.h - 0.6 - yD) : 2.1, doorOk = !sunk || dH >= 1.6;
    if (sunk) {
      const lo = Math.min(...gDs) - 0.15;
      const [fx0, fz0] = f.P(du, 0), fAvail = f.nz > 0.5 ? blim.maxZ - fz0 : f.nz < -0.5 ? fz0 - blim.minZ : f.nx > 0.5 ? blim.maxX - fx0 : fx0 - blim.minX, thD = clamp(fAvail - 0.03, 0.18, 0.34);
      if (doorOk) { doorLeaf(yD - 0.1, yD + dH); B.socles.add(boxF(1.4, yD + 0.02 - lo, thD, 'XxYZ'), f.M(du, (yD + 0.02 + lo) / 2, thD / 2)); stats.raisedDoors = (stats.raisedDoors || 0) + 1; }
      else { if (h.y + 2.13 > lo) wallUp(lo, h.y + 2.13); sideIn = sideDoor(); (stats.buriedDoors = stats.buriedDoors || []).push([h.id, sideIn ? 'side ' + sideIn.s : 'walled up']); }
    }
    // steps, door POI (with the step people may sit on)
    const st = sunk || shopDoor ? null : doorSteps(h, f, du, roomAt(du - 0.8, du + 0.8, 3.0), open, blim), stoop = shopDoor ? stoops.find(q => q.h === h.id) : null;
    if (!st && !sunk && !shopDoor && h.y - gy(...f.P(du, 0.7)) > 0.3) {
      // no room for steps between the house and the street: the way in is cut down through the socle to the street, the old doorway walled up above it
      const gL = Math.min(gy(...f.P(du - 0.55, 0.15)), gy(...f.P(du + 0.55, 0.15))), gH = Math.max(gy(...f.P(du - 0.55, 0.15)), gy(...f.P(du + 0.55, 0.15)), gy(...f.P(du, 0.6)));
      if (h.y - gH > 0.3) {
        yD = gH + 0.02; doorLeaf(gL - 0.15, yD + 2.1);
        if (h.y + 2.13 - (yD + 2.1) > 0.02) wallUp(yD + 2.1, h.y + 2.13);
        stats.loweredDoors = (stats.loweredDoors || 0) + 1;
      } else (stats.doorsNoAccess = stats.doorsNoAccess || []).push([h.id, +h.door.x.toFixed(1), +h.door.z.toFixed(1), +(h.y - gy(...f.P(du, 0.7))).toFixed(2)]);
    }
    if (sideIn) { const [x, z] = sideIn.fs.P(sideIn.u, 0.85); poi({ type: 'door', x, z, y: gy(x, z), nx: sideIn.fs.nx, nz: sideIn.fs.nz, house: h.id, note: 'side door', stepTop: sideIn.stepTop, stepDepth: sideIn.stepTop === null ? 0 : 0.32 }); }
    else { const fu = st ? st.foot[0] : du, okAt = o => { const [x, z] = f.P(fu, o); return !HB.hit({ minX: x, maxX: x, minZ: z, maxZ: z }, 0.33) && !FG.at(x, z) && !CG.at(x, z); };
      const o = [st ? st.foot[1] : 0.8, 0.8, 0.68, 1.2].find(okAt) ?? (st ? st.foot[1] : 0.8), [x, z] = f.P(fu, o);
      poi({ type: 'door', x, z, y: gy(x, z), nx: f.nx, nz: f.nz, house: h.id, stepTop: st ? st.top : stoop ? stoop.top : null, stepDepth: st ? st.depth : stoop ? stoop.depth : 0, ...(sunk && !doorOk ? { note: 'walled up', private: true } : {}) });
      if (R() < 0.06 && !inYard) { const [gx, gz] = f.P(fu + (R() - 0.5), o + 1.1); poi({ type: 'gather', x: gx, z: gz, y: gy(gx, gz), r: 1.4, note: 'doorstep' }); } }
    // door frame: painted jambs and lintel, or a stone lintel (none where the door had nowhere to go)
    const fr = doorOk ? R() : 1;
    if (doorOk && yD !== h.y) {       // a door moved up or down always gets its opening dressed: two jamb reveals and a lintel (painted now and then)
      const c = fr < 0.1 ? pick(R, FRAME) : null, put = (g, m) => c === null ? B.socles.add(g, m) : paint.add(g, m, c), jb = sunk ? yD + 0.02 : yD - 0.12;
      for (const s of [-1, 1]) put(boxF(0.12, yD + dH - jb, 0.16, 'XxZ'), f.M(du + s * 0.61, (yD + dH + jb) / 2, 0.08));
      put(boxF(1.5, 0.22, 0.18, 'YyZ'), f.M(du, yD + dH + 0.11, 0.09));
    }
    else if (fr < 0.1) { const c = pick(R, FRAME); for (const s of [-1, 1]) paint.add(boxF(0.14, dH + 0.14, 0.1, 'XxYZ'), f.M(du + s * 0.62, yD + dH / 2 + 0.05, 0.03), c); paint.add(boxF(1.5, 0.18, 0.12, 'XxYyZ'), f.M(du, yD + dH + 0.2, 0.03), c); }
    else if (fr < 0.28) B.socles.add(boxF(1.7, 0.28, 0.14, 'XxYyZ'), f.M(du, yD + dH + 0.15, 0.03));
    // pergola with a vine
    let perg = null;
    if (R() < 0.17 && !(inYard && (yd.pastas || yd.annex || yd.arbour)) && clearOfShop(du - 2, du + 2)) {
      const Wp = 2.3 + R() * 0.8, Dg = 1.6 + R() * 0.5, uc = clamp(du, -len / 2 + Wp / 2 + 0.3, len / 2 - Wp / 2 - 0.3);
      const ok = yardOk(uc - Wp / 2 - 0.2, uc + Wp / 2 + 0.2, Dg + 0.3) && [-1, 1].every(sd => roomAt(uc + sd * Wp / 2 - 0.2, uc + sd * Wp / 2 + 0.2, 3) >= Dg + 0.3) && [-1, 1].every(s => gy(...f.P(uc + s * Wp / 2, Dg)) < h.y + 0.3) && h.h > 3.3;
      if (ok) { pergola(h, f, R, uc, Wp, Dg); perg = [uc - Wp / 2, uc + Wp / 2]; claim(f.rect(uc - Wp / 2 - 0.2, uc + Wp / 2 + 0.2, 0, Dg + 0.3), h.id); }
    }
    // small high windows on the ground floor
    const wins = [], nw = R() < 0.6 ? 1 + (R() < 0.45 ? 1 : 0) : 0;
    for (let k = 0; k < 10 && wins.length < nw; k++) { const u = lerp(-len / 2 + 0.8, len / 2 - 0.8, R()); if (Math.abs(u - du) > 1.3 && wins.every(w => Math.abs(w - u) > 1.6) && clearOfShop(u - 0.4, u + 0.4)) wins.push(u); }
    for (const u of wins) windowAt(f, u, h.y + 1.85 + R() * 0.2, R);
    // upper floor: shutters on the existing windows, or a balcony
    if (h.two) {
      const upU = [-h.w / 4, h.w / 4];
      let balc = null;
      if (R() < 0.33) {
        const both = R() < 0.4, uc = both ? 0 : pick(R, upU), W = both ? h.w / 2 + 1.4 : 1.9 + R() * 0.6, Dp = 0.85 + R() * 0.25;
        const r = f.rect(uc - W / 2, uc + W / 2, 0.05, Dp), e = inset(L.blockRect(h.k, h.m), -1.1);
        const bb = h.y + h.h - 1.85 - 0.65, clearOver = inRect(r, inset(L.blockRect(h.k, h.m), 0.3)) || [-1, 0, 1].every(k => bb >= gy(...f.P(uc + k * W / 2, Dp)) + 2.3);
        if (Math.abs(uc) + W / 2 < len / 2 - 0.15 && inRect(r, e) && clearOver && !HB.hit(r, 0.2, h.id) && !FG.hit(r, 0.1) && !L.isReserved(r, 0.2)) {
          balcony(h, f, R, uc, W, Dp); balc = both ? upU : [uc];
          for (const u of balc) B.doors.add(boxF(0.78, 1.66, 0.14, 'ZXxY'), f.M(u, h.y + h.h - 1.85 + 0.83, 0.05));
        }
      }
      for (const u of upU) if (!(balc && balc.includes(u)) && R() < 0.5) windowAt(f, u, h.y + h.h - 1.4, R, 0.08);
    }
    // bench and herb pots by the door
    const side = R() < 0.5 ? 1 : -1;
    if (R() < 0.3) {
      const u = du + side * (1.55 + R() * 0.4), g = gy(...f.P(u, 0.3));
      if (Math.abs(u) < len / 2 - 0.85 && clearOfShop(u - 0.8, u + 0.8) && yardOk(u - 0.85, u + 0.85, 0.7) && roomAt(u - 0.85, u + 0.85, 1) >= 0.75 && Math.abs(g - h.y) < 0.6 && !(perg && u > perg[0] - 0.9 && u < perg[1] + 0.9 && false)) {
        const [x, z] = f.P(u, 0.29); IT.bench(x, z, f.ry, R); claim(f.rect(u - 0.85, u + 0.85, 0, 0.7), 'b' + h.id);
      }
    }
    if (R() < 0.35) {
      const n = 1 + Math.floor(R() * 3), u = du - side * (1.2 + n * 0.21);
      if (Math.abs(u) < len / 2 - 0.2 - n * 0.21 && clearOfShop(u - 0.7, u + 0.7) && yardOk(u - 0.7, u + 0.7, 0.5) && roomAt(u - 0.7, u + 0.7, 1) >= 0.5) { const [x, z] = f.P(u, 0.3); IT.pots(x, z, f.ry, R, n); }
    }
    // a herm or a pillar of Apollo Agyieus beside the door
    const hr = R();
    if (hr < 0.06 && !inYard) {
      const u = du - side * 1.05, [x, z] = f.P(u, 0.35), g = gy(x, z);
      if (Math.abs(u) < len / 2 - 0.4 && clearOfShop(u - 0.4, u + 0.4) && roomAt(u - 0.3, u + 0.3, 1) >= 0.75) {
        if (hr < 0.03) { B.marble.add(boxF(0.26, 1.3, 0.24, 'XxYZz'), mat(x, g + 0.55, z, 0, f.ry, 0)); B.statue.add(boxF(0.2, 0.27, 0.23, 'XxYZz'), mat(x, g + 1.33, z, 0, f.ry, 0)); B.marble.add(boxF(0.4, 0.14, 0.38, 'XxYZz'), mat(x, g, z, 0, f.ry, 0)); }
        else { B.socles.add(T.agyieus, mat(x, g + 0.2, z)); B.socles.add(boxF(0.44, 0.25, 0.44, 'XxYZz'), mat(x, g + 0.075, z, 0, f.ry, 0)); }
        collide(rectOf(x, z, x, z, 0.24)); const [px, pz] = f.P(u, 1.15); poi({ type: 'shrine', x: px, z: pz, y: gy(px, pz), ry: f.ry + Math.PI, r: 0.8, note: hr < 0.03 ? 'herm' : 'Apollo Agyieus' });
      }
    }
    // windows on a side wall that faces a street
    for (const s of [1, 3]) {
      if ((yd && yd.s === s) || (shop && shop.s === s) || (h.wing && ((h.wing.x - h.x) * sg > 0) === (s === 1))) continue;
      const fs = faceOf(h, s), [cx, cz] = fs.P(0, 0), blk = L.blockRect(h.k, h.m), e = fs.nx > 0 ? blk.maxX - cx : fs.nx < 0 ? cx - blk.minX : fs.nz > 0 ? blk.maxZ - cz : cz - blk.minZ;
      if (e < 5 && R() < 0.45) { const nwin = 1 + (fs.len > 11 && R() < 0.5 ? 1 : 0); for (let i = 0; i < nwin; i++) { const u = nwin === 1 ? (R() - 0.5) * 3 : (i - 0.5) * fs.len * 0.45, yw = h.y + 1.9 + R() * 0.2; if (!(sideIn && sideIn.s === s && Math.abs(u - sideIn.u) < 1.4)) windowAt(fs, u, yw, R); } }
    }
  }

  // ---------- an upper room with a roof terrace on a wing (the wing and its roof are left as they are, inside it) ----------
  function upperRoom(h, R) {
    const wg = h.wing, r = { minX: wg.x - wg.w / 2, maxX: wg.x + wg.w / 2, minZ: wg.z - wg.d / 2, maxZ: wg.z + wg.d / 2 };
    if (HB.hit(r, 0.9, h.id) || FG.hit(r, 0.5) || L.isReserved(r, 0.5)) return false;
    const yE = h.y + wg.h, rise = 0.1 + (Math.min(wg.w, wg.d) / 2 + 0.45) * 0.3, Hr = Math.max(rise + 0.35, 2.25 + R() * 0.35), yT = yE + Hr, ry = h.ry, col = h.plaster, sg = h.ry === 0 ? 1 : -1;
    B.walls.add(boxF(wg.w, Hr + 0.1, wg.d, 'XxZz'), mat(wg.x, yE - 0.1 + (Hr + 0.1) / 2, wg.z, 0, ry, 0), col);
    B.walls.add(boxF(wg.w + 0.3, 0.1, wg.d + 0.3, 'XxYyZz'), mat(wg.x, yT - 0.05, wg.z, 0, ry, 0), 0xd8ccb8);
    B.walls.add(rectSweep(wg.w + 0.3, wg.d + 0.3, [{ o: 0, y: 0 }, { o: 0, y: 0.62, hard: true }, { o: -0.16, y: 0.62, hard: true }, { o: -0.16, y: 0.02 }]), mat(wg.x, yT, wg.z, 0, ry, 0), col);
    const hr = { x: wg.x, z: wg.z, w: wg.w, d: wg.d, h: wg.h, ry }, outer = (wg.x - h.x) * sg > 0 ? 1 : 3;
    for (const s of [0, outer]) { const f = faceOf(hr, s); windowAt(f, (R() - 0.5) * Math.max(0, f.len - 1.8), yE + Math.min(1.2, Hr * 0.5), R); }
    const P = (lx, lz) => [wg.x + sg * lx, wg.z + sg * lz], ix = wg.w / 2 - 0.4, iz = wg.d / 2 - 0.4;
    if (R() < 0.6) { const a = P(-ix, -iz), b = P(ix, iz); for (const p of [a, b]) pole(B.woodDark, p[0], yT, p[1], 1.55, 0.035); laundry(a[0], a[1], yT + 1.5, b[0], b[1], yT + 1.5, R); }
    else { const c = P(0, 0); cloth.add(T.ccard, mr(c[0], yT + 1.95, c[1], ry, -Math.PI / 2 + 0.06, 0, V(wg.w - 0.9, wg.d - 0.9, 1)), pick(R, CLOTH)); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const p = P(a * (wg.w / 2 - 0.5), b * (wg.d / 2 - 0.5)); pole(B.woodDark, p[0], yT, p[1], 1.95 - b * 0.06, 0.035); } }
    for (let i = 0, n = 1 + Math.floor(R() * 3); i < n; i++) { const p = P((i - 1) * 0.45, -iz + 0.05); terra.add(T.herb, mat(p[0], yT + 0.14, p[1], 0, R(), 0), pick(R, TERRA)); leaf.add(T.card2, mat(p[0], yT + 0.44, p[1], 0, R() * TAU, 0, 0.55), 0x8ab868); }
    (stats.terraces = stats.terraces || []).push([+wg.x.toFixed(1), +wg.z.toFixed(1), h.id]); return true;
  }

  // ---------- shopfronts on the platea and the avenue ----------
  const SHOPS = ['pottery', 'amphorae', 'produce', 'textile', 'bakery', 'fish', 'bronze', 'leather', 'produce', 'pottery'];
  const AWN = [0xa2432e, 0x4a5f86, 0x7d7a4a, 0xb87a3a, 0x6a3f5c, 0x8e5a3c, 0x8e3b2a, 0x3d5a80], AWN_L = [0xc8b89a, 0xbdad8e, 0xc2b294];
  // a quad facing +z, w × hgt standing on y = 0, its colour running from cb at the foot to ct at the top
  const gradQuad = (bk, w, hgt, m, cb, ct) => {
    const g = new THREE.PlaneGeometry(w, hgt).translate(0, hgt / 2, 0), p = g.attributes.position, a = new Float32Array(p.count * 3), c0 = new THREE.Color(cb), c1 = new THREE.Color(ct), k = new THREE.Color();
    for (let i = 0; i < p.count; i++) { k.copy(c0).lerp(c1, p.getY(i) / hgt); a[i * 3] = k.r; a[i * 3 + 1] = k.g; a[i * 3 + 2] = k.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.applyMatrix4(m); bk.list.push(g);
  };
  function shopfront(h, face, s, edge, R) {
    const f = face, len = f.len, sg = h.ry === 0 ? 1 : -1, top = h.y + f.top;
    const du = s === 0 && face.isHouse ? (h.door.x - h.x) * sg : null;
    // opening: beside the door when there is room, else the door itself is widened
    let ow = 2.4 + R() * 0.8, uc;
    if (du === null) uc = (R() - 0.5) * Math.max(0, len - ow - 1.6);
    else {
      const left = du - 0.9 - (-len / 2 + 0.4), right = len / 2 - 0.4 - (du + 0.9);
      if (Math.max(left, right) >= 2.2) { const room = Math.max(left, right); ow = Math.min(ow, room - 0.2); uc = left > right ? du - 0.9 - room / 2 : du + 0.9 + room / 2; }
      else { ow = Math.min(2.6, len - 0.8); uc = clamp(du, -len / 2 + ow / 2 + 0.4, len / 2 - ow / 2 - 0.4); }
    }
    const type = pick(R, SHOPS), gF = gy(...f.P(uc, 1.0));
    // the opening stands on the house floor, or on the street where that rises above the floor; no shop high above a falling street (the house gets its steps)
    const gO = Math.max(...[-0.5, 0, 0.5].map(k => gy(...f.P(uc + k * ow, 0.2)))), base = Math.max(h.y, gO + 0.03);
    // where the street falls away the shop floor is a stone stoop, with steps down in front of it when it stands high
    const drop = base - gF; let nT = drop > 0.42 ? Math.ceil(drop / 0.3) - 1 : 0, stoopD = drop > 0.12 && edge > 0.6 ? Math.min(1.0, edge - 0.35 - nT * 0.34) : 0;
    if (nT && stoopD < 0.75 && drop <= 0.62) { nT = 0; stoopD = Math.min(1.0, edge - 0.35); if (stoopD < 0.25) stoopD = 0; }
    if (drop > 1.2 || (nT && stoopD < 0.75) || (drop > 0.42 && stoopD < 0.25) || base + 2.6 > top - 0.2) return null;
    let dA = Math.min(1.7 + R() * 0.6, edge + 1.1); const goodsD = Math.min(2.2, edge - 0.35);
    if (!free(f.rect(uc - ow / 2 - 0.6, uc + ow / 2 + 0.6, 0.05, Math.max(0.6, Math.min(dA, edge - 0.3))), h.id, 0.1)) return null;
    // a shallow shop front: plaster reveals, a timber lintel over them, the dim room behind, a shelf of wares, a threshold stone
    const rd = clamp(edge - 0.32, 0.04, 0.36), gJ = Math.min(...[-1, 1].map(sd => gy(...f.P(uc + sd * (ow / 2 + 0.14), rd / 2))));
    for (const sd of [-1, 1]) B.walls.add(boxF(0.28, base + 2.22 - gJ + 0.2, rd, 'XxZ'), f.M(uc + sd * (ow / 2 + 0.14), (base + 2.22 + gJ - 0.2) / 2, rd / 2 + 0.004), h.plaster);
    B.woodDark.add(boxF(ow + 0.72, 0.2, Math.min(rd + 0.08, edge - 0.3), 'ZXxYy'), f.M(uc, base + 2.3, Math.min(rd + 0.08, edge - 0.3) / 2));
    gradQuad(paint, ow, 2.26, f.M(uc, base - 0.05, 0.11), 0x7a5a3e, 0x21180f);        // (on the plain material: the room behind, dark under the lintel, warm brown at the floor)
    B.socles.add(boxF(ow, 0.14, rd, 'YZ'), f.M(uc, base - 0.06, rd / 2));
    const shD = Math.min(0.25, edge - 0.44), shY = base + 1.3 + R() * 0.15, nS = 2 + Math.floor(R() * 2);
    if (shD >= 0.14 && !((edge < 2.05 || nT > 0) && edge < 0.95)) { B.wood.add(boxF(ow - 0.16, 0.05, shD, 'YyZ'), f.M(uc, shY, 0.11 + shD / 2));
      for (let i = 0; i < nS; i++) { const u = uc - ow / 2 + 0.3 + (i + 0.5) * (ow - 0.6) / nS, y = shY + 0.025, rot = R() * 3, sk = shD / 0.25;
        const oS = 0.11 + shD / 2;
        if (type === 'pottery' || type === 'fish') terra.add(i % 2 && type === 'pottery' ? T.bowl : T.pot, f.M(u, y, oS, rot, (i % 2 && type === 'pottery' ? 0.8 : 0.62) * sk), pick(R, TERRA));
        else if (type === 'amphorae' || type === 'produce') terra.add(T.amph, f.M(u, y, oS, rot, 0.5 * sk), pick(R, TERRA));
        else if (type === 'bakery') small.add(T.blob5, f.M(u, y + 0.05, oS, rot, V(0.12, 0.07, 0.1 * sk)), pick(R, [0x9a6434, 0xb07a44]));
        else if (type === 'bronze') paint.add(T.pot, f.M(u, y, oS, rot, 0.6 * sk), pick(R, [0x8a6238, 0x7a5a36]));
        else small.add(boxF(0.34, 0.1 + (i % 2) * 0.06, 0.22 * sk, 'XxYZ'), f.M(u, y + 0.05 + (i % 2) * 0.03, oS), type === 'leather' ? pick(R, [0x7a5638, 0x5a3e28]) : pick(R, CLOTH)); } }
    // counter: out in front with the shopkeeper behind it where there is room, in the opening with him beside it, or (shallow) a board on brackets
    const mid = edge < 2.05 || nT > 0, shallow = mid && edge < 0.95, cd = !mid ? 0.5 : edge >= 0.95 ? 0.5 : clamp(edge - 0.15, 0.22, 0.35), out = !mid, hasC = cd >= 0.14;
    const cl = Math.min(ow * (0.55 + R() * 0.2), ow - 0.95), cu = uc + (R() < 0.5 ? -1 : 1) * (ow - cl) / 2, oc = out ? 1.45 : cd >= 0.5 ? 0.3 : 0.11 + cd / 2;
    // stone stoop where the street falls away (it carries the counter too when that stands out in front)
    let floor = gF;
    if (stoopD > 0) {
      const d = out ? Math.min(oc + cd / 2 + 0.05, edge - 0.35) : stoopD, gS = Math.min(gF, ...[-1, 1].map(sd => gy(...f.P(uc + sd * (ow / 2 + 0.25), d + nT * 0.34))));
      B.socles.add(boxF(ow + 0.5, base - gS + 0.35, d, 'XxYZ'), f.M(uc, (base + gS - 0.35) / 2, d / 2)); floor = base;
      steps.push({ ...f.rect(uc - ow / 2 - 0.25, uc + ow / 2 + 0.25, 0, d), flat: base });
      const rise = (base - gF) / (nT + 1);
      for (let k = 1; k <= nT; k++) { const tp = base - k * rise, o0 = d + (k - 1) * 0.34; B.socles.add(boxF(ow + 0.3, tp - gS + 0.35, 0.34, 'XxYZ'), f.M(uc, (tp + gS - 0.35) / 2, o0 + 0.17)); steps.push({ ...f.rect(uc - ow / 2 - 0.15, uc + ow / 2 + 0.15, o0, o0 + 0.34), flat: tp }); }
      claim(f.rect(uc - ow / 2 - 0.25, uc + ow / 2 + 0.25, 0, d + nT * 0.34), 'stoop' + h.id); stoops.push({ h: h.id, top: base - nT * rise, depth: d + nT * 0.34 });
    }
    if (shallow) {
      const yb = floor + 0.95;
      B.wood.add(boxF(cl + 0.1, 0.06, cd, 'XxYyZ'), f.M(cu, yb + 0.03, oc));
      for (const sd of [-1, 1]) { const bu = cu + sd * (cl / 2 - 0.15), th = Math.atan2(cd - 0.1, 0.38); B.woodDark.add(boxF(0.05, 0.05, cd - 0.04, 'XxYy'), f.M(bu, yb - 0.025, 0.11 + (cd - 0.04) / 2)); B.woodDark.add(boxF(0.05, Math.hypot(cd - 0.1, 0.38), 0.05, 'XxZz'), f.M(bu, yb - 0.22, 0.11 + (cd - 0.1) / 2).multiply(mat(0, 0, 0, th, 0, 0))); }
      collide(f.rect(cu - cl / 2 - 0.05, cu + cl / 2 + 0.05, 0.05, 0.11 + cd + 0.03));
    } else if (hasC) {
      const cb = floor === base && (out || cd < 0.5 || edge > 1.3) ? Math.min(base, gy(...f.P(cu, oc))) : Math.min(floor, gy(...f.P(cu, oc)));
      B.walls.add(boxF(cl, floor + 0.95 - cb + 0.3, cd, out ? 'XxYZz' : 'XxYZ'), f.M(cu, (floor + 0.95 + cb - 0.3) / 2, oc), h.plaster);
      const tw = Math.min(cd + 0.1, 2 * (edge - 0.31 - oc));
      B.wood.add(boxF(cl + 0.12, 0.06, tw, 'XxYyZz'), f.M(cu, floor + 0.98, oc));
      collide(out ? f.rect(cu - cl / 2 - 0.06, cu + cl / 2 + 0.06, oc - cd / 2 - 0.03, oc + cd / 2 + 0.07) : f.rect(cu - cl / 2, cu + cl / 2, 0.05, Math.min(oc + cd / 2 + 0.07, edge - 0.3)));
    }
    // an awning must keep 2.3 m of headroom over the ground under it, street included: raise it (a little), shorten it, or do without
    const aw = ow + 0.9, gUnder = d => Math.max(...[-1, 0, 1].flatMap(sd => [0.3, Math.min(d, Math.max(0.3, edge)), d].map(o => gy(...f.P(uc + sd * aw / 2, o)))));
    let awning = R() < 0.72 && dA >= 1.25 && top - 0.15 > base + 2.75, ya = Math.min(base + 2.95, top - 0.15), yf = 0;
    if (awning) {
      for (;;) { yf = Math.max(base + 2.4, ya - 0.3 * dA, gUnder(dA) + 2.62); if (yf <= ya || dA < 1.3) break; dA -= 0.25; }
      if (yf > ya) { if (yf <= Math.min(top - 0.15, base + 3.25)) ya = yf; else awning = false; }
    }
    // shutters folded back beside the opening, or a top-hinged board propped up (clear of heads over the street)
    if (!awning || R() < 0.5) {
      const clearL = uc - ow - 0.32 > -len / 2 && (du === null || uc - ow - 0.42 > du + 0.7 || uc - ow / 2 - 0.3 < du - 0.7), clearR = uc + ow + 0.32 > len / 2 ? false : (du === null || uc + ow + 0.42 < du - 0.7 || uc + ow / 2 + 0.3 > du + 0.7);
      const lift = Math.max(0, Math.max(...[-1, 1].flatMap(sd => [0.5, 1.05].map(o => gy(...f.P(uc + sd * (ow / 2 - 0.1), o))))) + 0.2 - base);
      if (clearL && clearR) for (const sd of [-1, 1]) B.woodDark.add(boxF(ow / 2 - 0.02, 2.1, 0.05, 'XxYyZ'), f.M(uc + sd * (ow * 0.75 + 0.31), base + 1.08, 0.1));
      else if (!awning && lift < 0.25 && top - 0.15 > base + 2.9 + lift && base + 2.5 + lift >= Math.max(gy(...f.P(uc, 1.25 + rd)), gy(...f.P(uc - ow / 2, 1.25 + rd)), gy(...f.P(uc + ow / 2, 1.25 + rd))) + 2.32) {       // (a matte board: the shared dark-wood material turns into a mirror of the sky seen from below)
        terra.add(boxF(ow + 0.1, 0.06, 1.0, 'XxYyZz'), f.M(uc, base + 2.7 + lift, 0.46 + rd).multiply(mat(0, 0, 0, -0.35, 0, 0)), pick(R, [0x7a5a3e, 0x6a4e36, 0x5a6a5a]));
        for (const sd of [-1, 1]) B.wood.add(boxF(0.05, 0.9, 0.05, 'XxZz'), f.M(uc + sd * (ow / 2 - 0.1), base + 2.5 + lift, 0.8 + rd).multiply(mat(0, 0, 0, 0.5, 0, 0)));
      }
    }
    if (awning) {       // striped cloth awning with a hemmed valance, on poles, or on struts when the street is narrow
      const ns = 4 + Math.floor(R() * 3), c1 = pick(R, AWN), c2 = R() < 0.6 ? pick(R, AWN_L) : pick(R, AWN.filter(c => c !== c1)), ang = Math.atan2(ya - yf, dA);
      for (let i = 0; i < ns; i++) cloth.add(T.ccard, f.M(uc - aw / 2 + (i + 0.5) * aw / ns, (ya + yf) / 2, dA / 2).multiply(mat(0, 0, 0, -Math.PI / 2 + ang, 0, 0, V(aw / ns + 0.005, Math.hypot(dA, ya - yf), 1))), i % 2 ? c2 : c1);
      cloth.add(T.ccard, f.M(uc, yf - 0.12, dA + 0.01, 0, V(aw, 0.24, 1)), c1);
      cloth.add(T.ccard, f.M(uc, yf - 0.215, dA + 0.022, 0, V(aw + 0.01, 0.055, 1)), new THREE.Color(c1).multiplyScalar(0.5));
      B.woodDark.add(boxF(aw + 0.1, 0.07, 0.07, 'YyZz'), f.M(uc, yf - 0.02, dA));
      const poles = dA <= edge - 0.42 && [-1, 1].every(sd => gy(...f.P(uc + sd * aw / 2, dA)) > base - 0.6);
      for (const sd of [-1, 1]) {
        const [px, pz] = f.P(uc + sd * (aw / 2 - 0.05), dA - 0.03), g = gy(px, pz);
        if (poles) { pole(B.wood, px, g - 0.1, pz, yf - g + 0.08, 0.06); collide(rectOf(px, pz, px, pz, 0.08)); continue; }
        // wall strut: where it reaches out over the street its lower part must clear 2.3 m too
        const oT = dA * 0.6, yT = ya - (ya - yf) * 0.6 - 0.06, k = clamp((edge - 0.03) / oT, 0, 0.9), gE = Math.max(...[-1, 1].map(q => gy(...f.P(uc + sd * (aw / 2 - 0.1) + q * 0.05, Math.max(0, edge)))));
        const k2 = clamp(0.42 / oT, 0, 0.9), gW = gy(...f.P(uc + sd * (aw / 2 - 0.1), 0.45)), need = (gg, kk, cl2) => (gg + cl2 - yT * kk) / (1 - kk);
        const yB = Math.min(yT - 0.25, Math.max(ya - 1.0, gy(...f.P(uc + sd * (aw / 2 - 0.1), 0.05)) + 2.0, need(gW, k2, 2.2), k < 0.9 ? need(gE, k, 2.3) : -Infinity));
        B.woodDark.add(boxF(0.06, Math.hypot(oT, yT - yB), 0.06, 'XxZz'), f.M(uc + sd * (aw / 2 - 0.1), (yT + yB) / 2, oT / 2 + 0.03).multiply(mat(0, 0, 0, Math.atan2(oT, yT - yB), 0, 0)));
      }
    }
    // goods on the counter and out in front
    let gs = 1;       // goods on a narrow sill are made smaller so that they keep off the street
    const cy = floor + 1.01, narrow = cd < 0.45, onC = (fn) => { if (!hasC || shallow) return; gs = narrow ? clamp((edge - 0.31 - oc) / 0.2, 0.35, 1) : 1; const n = Math.max(2, Math.floor(cl / 0.45)); for (let i = 0; i < n; i++) fn(cu - cl / 2 + (i + 0.5) * cl / n, i); gs = 1; };
    const outU = [uc - ow / 2 - 0.5, uc + ow / 2 + 0.5].filter(u => Math.abs(u) < len / 2 + 0.3 && (du === null || Math.abs(u - du) > 1.3));
    const ground = (u, o) => gy(...f.P(u, o));
    const goodsOut = goodsD >= 0.9, gr = [];
    const put = (bk, geo, u, y, o, c, ra = 0, sc = 1) => bk.add(geo, f.M(u, y, o, ra, typeof sc === 'number' ? sc * gs : sc.clone().multiplyScalar(gs)), c);
    if (type === 'pottery') {
      onC((u, i) => put(small, i % 2 ? T.bowl : T.pot, u, cy, oc, pick(R, TERRA), R(), i % 2 ? (narrow ? 0.7 : 1) : 0.6));
      if (goodsOut) for (const u of outU) { for (let i = 0; i < 5; i++) { const uu = u + (R() - 0.5) * 0.55, oo = 0.35 + R() * (goodsD - 0.5); put(terra, R() < 0.3 ? T.amph : T.pot, uu, ground(uu, oo) - 0.03, oo, pick(R, TERRA), R() * 3, 0.8 + R() * 0.4); } for (let i = 0; i < 3; i++) put(terra, T.bowl, u, ground(u, 0.35) + i * 0.08, 0.35, pick(R, TERRA)); gr.push(u); }
    } else if (type === 'amphorae') {
      onC(u => put(small, T.pot, u, cy, oc, pick(R, TERRA), R(), 0.55));
      if (edge >= 0.8) for (const u of outU) { const n = 2 + Math.floor(R() * 2); for (let i = 0; i < n; i++) { const uu = u + (i - (n - 1) / 2) * 0.38, [x, z] = f.P(uu, 0.28 + rd * 0.3); terra.add(T.amph, mr(x, gy(x, z) - 0.04, z, f.ry, -0.2), pick(R, TERRA)); } gr.push(u); }
    } else if (type === 'produce' || type === 'bakery' || type === 'fish') {
      const fills = type === 'produce' ? [0x3e3a2a, 0x5a3a4a, 0xc8a070, 0x9a6a3a, 0xc8b050, 0x5a2e46, 0xa83a2a, 0x6a8a3a] : type === 'bakery' ? [0x9a6434, 0xb07a44, 0x8a5a30] : [0x8a9098, 0x9aa2a8, 0x7a8288];
      onC(u => { if (type === 'produce' && !narrow) { IT.basket(...f.P(u, oc), R, pick(R, fills), cy - 0.02); } else if (type === 'produce') put(terra, T.pot, u, cy, oc, pick(R, TERRA), R(), 0.5); else for (let k = 0; k < 3; k++) put(small, T.blob5, u + (k - 1) * 0.13, cy + 0.04, oc + (R() - 0.5) * 0.12 * cd, pick(R, fills), R() * 3, type === 'fish' ? V(0.04, 0.03, 0.17) : V(0.1, 0.06, 0.12)); });
      if (goodsOut) for (const u of outU) {
        const tg = ground(u, 0.7); B.wood.add(boxF(1.0, 0.05, 0.6, 'XxYyZz'), f.M(u, tg + 0.62, 0.7)); for (const sd of [-1, 1]) B.woodDark.add(boxF(0.06, 0.6, 0.5, 'XxZz'), f.M(u + sd * 0.42, tg + 0.3, 0.7));
        for (let k = 0; k < 2; k++) IT.basket(...f.P(u + (k - 0.5) * 0.5, 0.7), R, pick(R, fills), tg + 0.65);
        if (type === 'produce') { const os = Math.min(1.25, edge - 0.66); for (let k = 0; k < 2; k++) { const uu = u + (k - 0.5) * 0.62; put(terra, T.sack, uu, ground(uu, os) - 0.02, os, pick(R, [0xa08664, 0x94795a, 0xaa906c]), R() * 3, V(0.95 + R() * 0.15, 0.85 + R() * 0.15, 0.95 + R() * 0.15)); } }
        gr.push(u);
      }
    } else if (type === 'textile' || type === 'leather') {
      onC((u, i) => put(small, boxF(0.36, 0.08 + i % 3 * 0.04, Math.min(0.3, cd - 0.04), 'XxYZz'), u, cy + 0.05, oc, type === 'leather' ? pick(R, [0x7a5638, 0x5a3e28, 0x8e6a48]) : pick(R, CLOTH)));
      if (goodsOut) for (const u of outU) {
        const o = Math.min(0.9, goodsD - 0.2), g = ground(u, o); for (const sd of [-1, 1]) pole(B.woodDark, ...(() => { const [x, z] = f.P(u + sd * 0.48, o); return [x, gy(x, z) - 0.1, z]; })(), 2.0, 0.035);
        B.woodDark.add(boxF(1.1, 0.05, 0.05, 'YyZz'), f.M(u, g + 1.88, o));
        for (let k = 0; k < 3; k++) cloth.add(T.ccard, f.M(u + (k - 1) * 0.31, g + 1.88 - 0.45, o + (R() - 0.5) * 0.06, (R() - 0.5) * 0.2, V(0.28, 0.86, 1)), type === 'leather' ? pick(R, [0x7a5638, 0x6a4a30, 0x9a7a58]) : pick(R, CLOTH));
        gr.push(u);
      }
    } else {        // bronze vessels and lamps
      onC((u, i) => put(paint, i % 2 ? T.bowl : T.pot, u, cy, oc, pick(R, [0x8a6238, 0x7a5a36, 0x9a7040]), R(), i % 2 ? (narrow ? 0.7 : 1.1) : 0.7));
      if (!shallow) for (let i = 0; i < 4; i++) put(paint, T.pot, uc - ow / 2 + (i + 0.5) * ow / 4, base + 2.0, Math.min(0.3, edge - 0.4), 0x8a6238, 0, 0.45);
      if (goodsOut) for (const u of outU) { put(paint, T.pithos, u, ground(u, 0.5) - 0.05, 0.5, 0x7a5a36, R(), 0.45); gr.push(u); }
    }
    for (const u of gr) collide(f.rect(u - 0.5, u + 0.5, 0.1, Math.min(goodsD, type === 'amphorae' ? 0.55 : goodsD)));
    if (shallow) {        // wares big enough to read from across the street on the board, and more hung from a rail in front of the dark room
      const n = Math.max(2, Math.floor(cl / 0.4)), BRONZE = [0x8a6238, 0x7a5a36, 0x9a7040];
      const tub = (u, fill) => { terra.add(T.basket, f.M(u, cy + 0.075, oc, R(), 0.55), 0xb89a60); small.add(T.disc, f.M(u, cy + 0.15, oc, 0, 0.55), fill); };
      for (let i = 0; i < n; i++) {
        const u = cu - cl / 2 + (i + 0.5) * cl / n, alt = (i + (R() < 0.3 ? 1 : 0)) % 2;
        if (type === 'pottery') alt ? terra.add(T.pot, f.M(u, cy, oc, R() * 3, 0.8), pick(R, TERRA)) : [0, 1, 2].forEach(k => terra.add(T.bowl, f.M(u, cy + k * 0.05, oc, R(), 0.72), pick(R, TERRA)));
        else if (type === 'amphorae') alt ? terra.add(T.amph, f.M(u, cy, oc, R() * 3, 0.38), pick(R, TERRA)) : terra.add(T.pot, f.M(u, cy, oc, R() * 3, 0.78), pick(R, TERRA));
        else if (type === 'bronze') paint.add(alt ? T.pot : T.bowl, f.M(u, cy, oc, R() * 3, alt ? 0.78 : 0.7), pick(R, BRONZE));
        else if (type === 'textile' || type === 'leather') for (let k = 0; k < 2 + Math.floor(R() * 2); k++) small.add(boxF(0.32, 0.06, 0.26, 'XxYZz'), f.M(u + (R() - 0.5) * 0.04, cy + 0.03 + k * 0.06, oc, (R() - 0.5) * 0.2), type === 'leather' ? pick(R, [0x7a5638, 0x5a3e28, 0x8e6a48]) : pick(R, CLOTH));
        else if (alt || type === 'produce') tub(u, type === 'produce' ? pick(R, [0x3e3a2a, 0x5a3a4a, 0xc8a070, 0x9a6a3a, 0xc8b050, 0xa83a2a, 0x6a8a3a]) : type === 'bakery' ? 0x9a6434 : 0x8a9098);
        else for (let k = 0; k < 3; k++) small.add(T.blob5, f.M(u + (k - 1) * 0.1, cy + 0.04, oc + (R() - 0.5) * 0.1, R() * 3, type === 'fish' ? V(0.04, 0.03, 0.16) : V(0.1, 0.06, 0.12)), type === 'fish' ? 0x8a9098 : pick(R, [0x9a6434, 0xb07a44]));
      }
      const yR = base + 2.06, oR = 0.17, nh = Math.max(3, Math.floor((ow - 0.3) / 0.42)); B.woodDark.add(boxF(ow - 0.05, 0.04, 0.04, 'YyZ'), f.M(uc, yR, oR));
      const cord = (u, l) => small.add(boxF(0.012, l, 0.012, 'XxZz'), f.M(u, yR - l / 2, oR), 0x6e604a);
      for (let i = 0; i < nh; i++) {
        const u = uc - (ow - 0.3) / 2 + (i + 0.5) * (ow - 0.3) / nh + (R() - 0.5) * 0.08, q = R();
        if (type === 'produce' || type === 'bakery' || (type === 'fish' && q < 0.3)) { const l = 0.45 + R() * 0.2, garlic = R() < 0.4; cord(u, l); for (let k = 0; k < 6; k++) terra.add(T.rock, f.M(u + (R() - 0.5) * 0.07, yR - 0.1 - k * (l - 0.1) / 6, oR + 0.03 + (R() - 0.5) * 0.04, R() * 3, V(0.05, 0.06, 0.05)), garlic ? pick(R, [0xd8ccb2, 0xcfc2a6]) : pick(R, [0xb07a44, 0x9a5e34, 0xa86a3c])); }
        else if (type === 'fish') { cord(u, 0.25); for (let k = 0; k < 3; k++) small.add(T.blob5, f.M(u + (k - 1) * 0.07, yR - 0.4, oR + 0.03, (R() - 0.5) * 0.2, V(0.03, 0.16, 0.05)), pick(R, [0x8a8478, 0x7a7468, 0x9a9282])); }
        else if (type === 'leather' && q < 0.65) { cord(u, 0.12); for (const sd of [-1, 1]) small.add(boxF(0.09, 0.25, 0.02, 'XxYyZz'), f.M(u + sd * 0.055, yR - 0.26, oR + 0.02, 0.08 * sd), pick(R, [0x6a4a30, 0x7a5638])); }
        else if (type === 'textile' || type === 'leather' || q < 0.35) cloth.add(T.ccard, f.M(u, yR - 0.36, oR + 0.03, (R() - 0.5) * 0.15, V(0.34, 0.62, 1)), type === 'leather' ? pick(R, [0x7a5638, 0x6a4a30, 0x9a7a58]) : pick(R, CLOTH));
        else { cord(u, 0.2); (type === 'bronze' ? paint : terra).add(T.pot, f.M(u, yR - 0.52, oR + 0.05, R() * 3, 0.62), type === 'bronze' ? pick(R, BRONZE) : pick(R, TERRA)); }
      }
      stats.shallowShops = (stats.shallowShops || 0) + 1;
    }
    // the shopkeeper's place and customers
    const ug = cu > uc ? uc - ow / 2 + (ow - cl) / 2 : uc + ow / 2 - (ow - cl) / 2, [sx, sz] = out ? f.P(cu, 0.75) : f.P(hasC ? ug : uc, 0.62), [ox, oz] = f.P(cu, oc);
    poi({ type: 'stall', x: sx, z: sz, y: gy(sx, sz), ry: f.ry, house: h.id, note: type, _o: [ox, oz] });
    if (R() < 0.5) { const [x, z] = f.P(cu, oc + cd / 2 + 0.9); poi({ type: 'gather', x, z, y: gy(x, z), r: 1.2, note: 'shop' }); }
    claim(f.rect(uc - ow / 2 - 1.1, uc + ow / 2 + 1.1, 0, Math.max(0.8, Math.min(dA, edge - 0.3))), h.id);
    stats.shops++;
    return { s, u0: uc - ow / 2 - (gr.length ? 1.1 : 0.4), u1: uc + ow / 2 + (gr.length ? 1.1 : 0.4), uc, ow, type };
  }

  // ---------- empty lots ----------
  // a box along world X or Z from (x0,z0) to (x1,z1) whose base follows the ground; faces: L = long sides, E = ends (S = start, N = end only), Y/y
  function shearBox(bk, x0, z0, x1, z1, yb, hgt, th, faces, color, gg) {       // gg = [ground at start, at end] when not the terrain's
    const dx = x1 - x0, dz = z1 - z0, ax = Math.abs(dz) < 1e-6, L0 = Math.hypot(dx, dz); if (L0 < 0.05) return;
    const g0 = gg ? gg[0] : gy(x0, z0), g1 = gg ? gg[1] : gy(x1, z1), s = (g1 - g0) / (ax ? dx : dz);
    const m = new THREE.Matrix4().set(1, 0, 0, x0 + dx / 2, ax ? s : 0, 1, ax ? 0 : s, (g0 + g1) / 2 + yb + hgt / 2, 0, 0, 1, z0 + dz / 2, 0, 0, 0, 1);
    const up = ax ? dx > 0 : dz > 0, lo = ax ? 'x' : 'z', hi = ax ? 'X' : 'Z';
    const g = boxF(ax ? L0 : th, hgt, ax ? th : L0, faces.replace(/L/g, ax ? 'Zz' : 'Xx').replace(/E/g, ax ? 'Xx' : 'Zz').replace(/S/g, up ? lo : hi).replace(/N/g, up ? hi : lo));
    color === undefined ? bk.add(g, m) : bk.add(g, m, color);
  }
  // a mud-brick wall piece: the body with two bond lines, an unfinished course or two on top, now and then a loose brick
  function mudWall(p, q, yb, hb, t, col, R, lines = true) {
    const L0 = Math.hypot(q[0] - p[0], q[1] - p[1]), g0 = gy(...p), g1 = gy(...q), at = k => [lerp(p[0], q[0], k), lerp(p[1], q[1], k)], gk = k => [lerp(g0, g1, k)];
    shearBox(B.walls, ...p, ...q, yb, hb, t, 'LEY', col, [g0, g1]);
    const dark = new THREE.Color(col).multiplyScalar(0.7);
    if (lines) for (const k of [0.36, 0.7]) if (hb * k > 0.3) shearBox(B.walls, ...p, ...q, yb + hb * k, 0.035, t + 0.016, 'L', dark, [g0, g1]);
    for (let j = 0, s = R() * 0.4; j < 2 && s < L0 - 0.3; j++) { const l = Math.min(L0 - s, 0.35 + R() * 1.1), k0 = s / L0, k1 = (s + l) / L0; shearBox(B.walls, ...at(k0), ...at(k1), yb + hb - 0.02, 0.1 + R() * 0.16, t - 0.06, 'LEY', col, [gk(k0)[0], gk(k1)[0]]); s += l + 0.25 + R() * 0.9; }
    if (R() < 0.5) { const k = 0.15 + R() * 0.7, [x, z] = at(k); B.walls.add(boxF(0.34, 0.1, 0.17, 'XxYZz'), mat(x, gk(k)[0] + yb + hb + 0.2, z, 0, R() * 3, 0.08), col); }
  }
  // split a line into pieces no longer than maxL (keeps sheared pieces close to the ground)
  const pieces = (x0, z0, x1, z1, maxL, fn) => { const L0 = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L0 / maxL)); for (let i = 0; i < n; i++) fn(lerp(x0, x1, i / n), lerp(z0, z1, i / n), lerp(x0, x1, (i + 1) / n), lerp(z0, z1, (i + 1) / n), i, n); };
  // enclose a rectangle with a low dry-stone wall or a wattle fence, leaving an entry on side `entry`
  function enclose(A0, kind, entry, R, gapW = 1.6) {
    const A = inset(A0, kind === 'stone' ? 0.3 : 0.05), hc = pick(R, [0xd6c6ae, 0xcab8a0, 0xbfb09a]);
    const sides = { minZ: [A.minX, A.minZ, A.maxX, A.minZ], maxZ: [A.minX, A.maxZ, A.maxX, A.maxZ], minX: [A.minX, A.minZ, A.minX, A.maxZ], maxX: [A.maxX, A.minZ, A.maxX, A.maxZ] };
    let gate = null;
    for (const [k, [x0, z0, x1, z1]] of Object.entries(sides)) {
      const L0 = Math.hypot(x1 - x0, z1 - z0), segs = [];
      if (k === entry) { const c = L0 * (0.3 + R() * 0.4); segs.push([0, c - gapW / 2], [c + gapW / 2, L0]); gate = [lerp(x0, x1, c / L0), lerp(z0, z1, c / L0)]; } else segs.push([0, L0]);
      for (const [a, b] of segs) {
        if (b - a < 0.3) continue;
        const p = [lerp(x0, x1, a / L0), lerp(z0, z1, a / L0)], q = [lerp(x0, x1, b / L0), lerp(z0, z1, b / L0)];
        if (kind === 'stone') {        // dry-stone walling in stretches of a few heights, a loose stone lodged on top here and there
          const Ls = Math.hypot(q[0] - p[0], q[1] - p[1]);
          for (let s0 = 0; s0 < Ls - 0.05;) {
            const l = Ls - s0 < 5.2 ? Ls - s0 : 2.6 + R() * 2.6, k0 = s0 / Ls, k1 = (s0 + l) / Ls, hh = 0.92 + R() * 0.3, a0 = lerp(p[0], q[0], k0), b0 = lerp(p[1], q[1], k0), a1 = lerp(p[0], q[0], k1), b1 = lerp(p[1], q[1], k1);
            shearBox(rub, a0, b0, a1, b1, -0.36, hh, 0.5 + R() * 0.08, 'LEY');
            if (R() < 0.25) { const k = lerp(k0, k1, 0.2 + R() * 0.6), x = lerp(p[0], q[0], k), z = lerp(p[1], q[1], k); rub.add(boxF(0.36 + R() * 0.2, 0.1, 0.26, 'XxYZz'), mat(x, gy(x, z) - 0.36 + hh + 0.04, z, (R() - 0.5) * 0.2, R() * 3, (R() - 0.5) * 0.2)); }
            s0 += l;
          }
        }
        else pieces(...p, ...q, 3.2, (a0, b0, a1, b1, i, n) => {         // woven wattle hurdles between stakes
          const u0 = (a + Math.hypot(a0 - p[0], b0 - p[1])) / 1.6, u1 = u0 + Math.hypot(a1 - a0, b1 - b0) / 1.6;
          wick.add(quadGeo(a0, gy(a0, b0) - 0.07, b0, a1, gy(a1, b1) - 0.07, b1, 1.12, u0, u1, AV(253), AV(4)), null, hc);
          for (const [sx, sz, ok] of [[a0, b0, i % 2 === 0], [a1, b1, i === n - 1]]) if (ok) B.woodDark.add(T.stake, mat(sx, gy(sx, sz) + 0.45, sz, 0, R() * 2, 0, V(0.045, 1.3, 0.045)));
        });
        collide(lineRect(...p, ...q, kind === 'stone' ? 0.28 : 0.08));
      }
    }
    return gate;
  }
  // a raised bed of dug earth L0 long along local x: a humped top on low sides; caps: 'S' start end, 'N' far end
  function bedGeo(L0, caps) {
    const W = [-0.575, 0, 0.575], Hs = [0.09, 0.19, 0.09], pos = [], uv = [], idx = [], x0 = -L0 / 2, x1 = L0 / 2;
    const vtx = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1; };
    const t = [x0, x1].map(x => W.map((w, k) => vtx(x, Hs[k], w, x, w)));
    for (let k = 0; k < 2; k++) idx.push(t[0][k], t[0][k + 1], t[1][k + 1], t[0][k], t[1][k + 1], t[1][k]);
    for (const [w, hk, sgn] of [[W[0], Hs[0], -1], [W[2], Hs[2], 1]]) { const a = vtx(x0, -0.2, w, x0, 0), b = vtx(x1, -0.2, w, x1, 0), c = vtx(x1, hk, w, x1, 0.3), d = vtx(x0, hk, w, x0, 0.3); if (sgn > 0) idx.push(a, b, c, a, c, d); else idx.push(b, a, d, b, d, c); }
    for (const [x, on, sgn] of [[x0, caps.includes('S'), -1], [x1, caps.includes('N'), 1]]) if (on) {
      const p0 = vtx(x, -0.2, W[0], W[0], 0), p1 = vtx(x, -0.2, W[2], W[2], 0), tp = W.map((w, k) => vtx(x, Hs[k], w, w, Hs[k] + 0.2)), tri = (a, b, c) => sgn < 0 ? idx.push(a, b, c) : idx.push(a, c, b);
      tri(p0, p1, tp[2]); tri(p0, tp[2], tp[1]); tri(p0, tp[1], tp[0]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  function bedRow(x0, z0, x1, z1, R, crop) {   // a raised bed with a crop (sown thinner far from the platea and the avenue)
    const soil = pick(R, [0x94705a, 0x8a684e, 0x9c7a5c]), dist = Math.min(Math.abs(z0 - 64), Math.abs(x0 - 145)), far = dist > 170;
    pieces(x0, z0, x1, z1, 6.5, (a0, b0, a1, b1, i, n) => {
      const ax = Math.abs(b1 - b0) < 1e-6, Lp = Math.hypot(a1 - a0, b1 - b0), g0 = gy(a0, b0), g1 = gy(a1, b1), sl = (g1 - g0) / (ax ? a1 - a0 : b1 - b0), up = ax ? a1 > a0 : b1 > b0;
      const caps = (i === 0 ? (up ? 'S' : 'N') : '') + (i === n - 1 ? (up ? 'N' : 'S') : '');
      const m = new THREE.Matrix4().set(1, 0, 0, (a0 + a1) / 2, ax ? sl : 0, 1, ax ? 0 : sl, (g0 + g1) / 2, 0, 0, 1, (b0 + b1) / 2, 0, 0, 0, 1);
      terra.add(bedGeo(Lp, caps), ax ? m : m.multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)), soil);
    });
    collide(lineRect(x0, z0, x1, z1, 0.55));
    const L0 = Math.hypot(x1 - x0, z1 - z0), ex = (x1 - x0) / L0, ez = (z1 - z0) / L0, ry = Math.atan2(-ez, ex);
    const tint = { cabbage: 0xa4d47a, leek: 0x7aa050, bean: 0x6a9a48, gourd: 0x88b058, herb: 0x98b078, wheat: 0xd8c078 }[crop];
    for (let s = 0.4, row = 0; s < L0 - 0.3; s += (crop === 'bean' ? 1.5 : (far ? 0.82 : 0.6) + R() * 0.16) * (dist > 250 ? 2 : 1), row++) for (const side of [row % 2 ? -0.28 : 0.28]) {
      const x = x0 + ex * s - ez * side, z = z0 + ez * s + ex * side, g = gy(x, z) + 0.15;
      if (crop === 'bean') { for (let k = 0; k < 2; k++) B.woodDark.add(branch([x + (k - 0.5) * 0.7 * ex, g, z + (k - 0.5) * 0.7 * ez], [x, g + 1.75, z], 0.03, 3)); leaf.add(T.card2, mat(x, g + 0.85, z, 0, R() * 3, 0, V(0.8, 1.6, 0.8)), tint); }
      else if (crop === 'leek' || crop === 'wheat') leaf.add(T.card2, mat(x, g + 0.25, z, 0, R() * 3, 0, V(0.7, 0.55, 0.7)), tint);
      else { leaf.add(T.card, mr(x, g + 0.2, z, R() * TAU, -Math.PI / 2 + (R() - 0.5) * 0.9, 0, 0.75 + R() * 0.25), tint); if (crop === 'gourd' && R() < 0.3) paint.add(T.blob5, mat(x + 0.2, g + 0.06, z, 0, R() * 3, 0, V(0.14, 0.12, 0.18)), 0xc8a848); }
    }
    return ry;
  }
  function cart(x, z, ry, lim, keep) {       // a two-wheeled cart resting on its shafts; ry a multiple of 90°, the whole of it inside lim
    const fp = orect(x + Math.sin(ry) * 0.93, z + Math.cos(ry) * 0.93, ry, 0.8, 1.9);
    if (!inRect(fp, lim) || (keep && ov(fp, keep))) return false;
    const g = gy(x, z), base = mr(x, g, z, ry, 0.12), m = (a, y, o) => base.clone().multiply(mat(a, y, o));
    for (const s of [-1, 1]) B.woodDark.add(T.wheel, m(s * 0.72, 0.5, 0));
    B.wood.add(boxF(1.25, 0.08, 1.9, 'XxYyZz'), m(0, 0.72, 0)); for (const s of [-1, 1]) B.wood.add(boxF(0.06, 0.3, 1.9, 'XxY'), m(s * 0.62, 0.9, 0));
    for (const s of [-1, 1]) B.woodDark.add(boxF(0.07, 0.07, 2.0, 'XxYy'), m(s * 0.35, 0.62, 1.8));
    collide(fp); return true;
  }
  function emptyLot(lot, R) {
    const blk = L.blockRect(lot.k, lot.m), b = L.block(lot.k, lot.m), cx = (lot.minX + lot.maxX) / 2, cz = (lot.minZ + lot.maxZ) / 2;
    if (!b || b.houses.length < 2 || inTerrace(cx, cz, 9) || cz > 438 || gy(cx, cz) < SEA + 3 || slopeAt(cx, cz) > 0.28) return;
    if (flats.some(fl => fl.r ? Math.hypot(cx - fl.cx, cz - fl.cz) < fl.r + 10 : Math.abs(cx - fl.cx) < fl.hw + 10 && Math.abs(cz - fl.cz) < fl.hd + 10)) return;
    const st = { minX: Math.abs(lot.minX - blk.minX) < 0.01, maxX: Math.abs(lot.maxX - blk.maxX) < 0.01, minZ: Math.abs(lot.minZ - blk.minZ) < 0.01, maxZ: Math.abs(lot.maxZ - blk.maxZ) < 0.01 };
    let A = { minX: lot.minX + (st.minX ? 0.4 : 0.7), maxX: lot.maxX - (st.maxX ? 0.4 : 0.7), minZ: lot.minZ + (st.minZ ? 0.4 : 0.7), maxZ: lot.maxZ - (st.maxZ ? 0.4 : 0.7) };
    const blocker = r => HB.hit(r, 0.9) || FG.hit(r, 0.4) || MG.hit(r, 0.4);
    for (let k = 0; k < 8; k++) {
      const o = blocker(A); if (!o) break;
      const cuts = [['minX', o.maxX + 0.95 - A.minX], ['maxX', A.maxX - (o.minX - 0.95)], ['minZ', o.maxZ + 0.95 - A.minZ], ['maxZ', A.maxZ - (o.minZ - 0.95)]].filter(c => c[1] > 0).sort((p, q) => p[1] - q[1]);
      if (!cuts.length) return; const [key, d] = cuts[0]; A = { ...A, [key]: key.startsWith('min') ? A[key] + d : A[key] - d };
    }
    for (let k = 0; k < 8; k++) {        // nothing of a lot's within 6.5 m of the circuit wall
      const bad = [['minX', 'minZ'], ['maxX', 'minZ'], ['minX', 'maxZ'], ['maxX', 'maxZ']].filter(([a, b]) => !insideWalls(A[a], A[b], 6.5)); if (!bad.length) break;
      for (const [a, b] of bad) { if (Math.abs(A[a] - cx) > 1) A = { ...A, [a]: A[a] + (a === 'minX' ? 1 : -1) }; if (Math.abs(A[b] - cz) > 1) A = { ...A, [b]: A[b] + (b === 'minZ' ? 1 : -1) }; }
    }
    const W0 = A.maxX - A.minX, D0 = A.maxZ - A.minZ;
    if (W0 < 7 || D0 < 6.5 || blocker(A) || L.isReserved(A, 0.5) || ![[A.minX, A.minZ], [A.maxX, A.minZ], [A.minX, A.maxZ], [A.maxX, A.maxZ]].every(([x, z]) => insideWalls(x, z, 6.5))) return;
    if ([[A.minX, A.minZ], [A.maxX, A.minZ], [A.minX, A.maxZ], [A.maxX, A.maxZ]].some(([x, z]) => Math.abs(gy(x, z) - gy(cx, cz)) > 3.2 || slopeAt(x, z) > 0.35)) return;
    const streetSides = Object.keys(st).filter(k => st[k] && Math.abs(A[k] - lot[k]) < 1.5), entry = streetSides.length ? pick(R, streetSides) : pick(R, ['minX', 'maxX', 'minZ', 'maxZ']);
    const r = R(), type = r < 0.28 ? 'garden' : r < 0.45 ? 'orchard' : r < 0.63 ? 'pen' : r < 0.77 ? 'site' : r < 0.87 ? 'ruin' : 'open';
    stats.lots[type] = (stats.lots[type] || 0) + 1;
    claim(A, 'lot' + lot.k + '_' + lot.m + '_' + lot.i + '_' + lot.j);
    const acx = (A.minX + A.maxX) / 2, acz = (A.minZ + A.maxZ) / 2, alongX = W0 >= D0;
    const inward = { minX: [1, 0], maxX: [-1, 0], minZ: [0, 1], maxZ: [0, -1] };
    LOTS[type](A, R, { entry, acx, acz, W0, D0, alongX, inward, lot });
  }
  const LOTS = {
    garden(A, R, c) {
      const gate = enclose(A, R() < 0.55 ? 'stone' : 'fence', c.entry, R);
      const I = inset(A, 1.1), across = c.alongX ? I.maxZ - I.minZ : I.maxX - I.minX, along = c.alongX ? I.maxX - I.minX : I.maxZ - I.minZ;
      const nb = clamp(Math.floor((across - 1.92) / 2.05) + 1, 1, 6), split = along - 0.8 > 9, crops = ['cabbage', 'leek', 'bean', 'gourd', 'herb', 'wheat', 'cabbage'];
      const aOf = i => (c.alongX ? I.minZ : I.minX) + (nb === 1 ? across / 2 : 0.96 + i * (across - 1.92) / (nb - 1)), endMax = c.entry === (c.alongX ? 'maxX' : 'maxZ');
      const skip = R() < 0.6 ? Math.floor(R() * nb) : -1;     // one strip left for a tree, a well or a hut
      for (let i = 0; i < nb; i++) {
        if (i === skip) continue;
        const a = aOf(i);
        const segs = split ? [[0.4, along / 2 - 0.45], [along / 2 + 0.45, along - 0.4]] : [[0.4, along - 0.4]];
        for (const [s0, s1] of segs) {
          const p0 = c.alongX ? [I.minX + s0, a] : [a, I.minZ + s0], p1 = c.alongX ? [I.minX + s1, a] : [a, I.minZ + s1];
          bedRow(...p0, ...p1, R, pick(R, crops));
        }
        if (i % 2 === 0) { const e = endMax ? along - 0.4 + 0.46 : 0.4 - 0.46, p = c.alongX ? [I.minX + e, a] : [a, I.minZ + e]; poi({ type: 'work', x: p[0], z: p[1], y: gy(...p), ry: c.alongX ? (endMax ? -Math.PI / 2 : Math.PI / 2) : (endMax ? Math.PI : 0), note: 'garden' }); }
      }
      if (skip >= 0) {
        const a = aOf(skip), p = c.alongX ? [lerp(I.minX, I.maxX, 0.25 + R() * 0.5), a] : [a, lerp(I.minZ, I.maxZ, 0.25 + R() * 0.5)];
        const q = R();
        if (q < 0.4) { if (plantTree(pick(R, ['fig', 'pom', 'almond']), ...p, 0.9, R)) collide(rectOf(...p, ...p, 0.22)); }
        else if (q < 0.7) IT.well(...p, R, -1);
        else { const g = gy(...p); B.walls.add(boxF(2.0, 2.4, 1.7, 'XxZzY'), mat(p[0], g + 0.9, p[1]), 0xd8c8a8); B.roofs.add(boxF(2.5, 0.08, 2.2, 'XxYyZz'), mat(p[0], g + 2.15, p[1], 0.1, 0, 0), 0xb8714a); B.doors.add(boxF(0.8, 1.6, 0.1, 'Z'), mat(p[0], g + 0.8, p[1] + 0.82)); collide(rectOf(...p, ...p, 1.05)); }
      }
      for (let i = 0; i < 2; i++) IT.basket(c.alongX ? I.minX - 0.3 : lerp(I.minX, I.maxX, R()), c.alongX ? lerp(I.minZ, I.maxZ, R()) : I.minZ - 0.3, R);
      L.addArea({ name: 'garden', ...inset(A, 0.8), owner: OWN });
    },
    orchard(A, R, c) {
      if (R() < 0.6) enclose(A, 'stone', c.entry, R, 2.2);
      const sp = 5.4 + R() * 1.0, main = pick(R, ['olive', 'olive', 'fig', 'almond', 'pom']), nx = Math.max(1, Math.floor((c.W0 - 4) / sp) + 1), nz = Math.max(1, Math.floor((c.D0 - 4) / sp) + 1);
      const ox = c.acx - (nx - 1) * sp / 2, oz = c.acz - (nz - 1) * sp / 2, trees = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        if (R() < 0.08) continue;
        const x = ox + i * sp + (R() - 0.5) * 0.6, z = oz + j * sp + (R() - 0.5) * 0.6, kind = R() < 0.2 ? pick(R, ['fig', 'almond', 'pom']) : main;
        if (plantTree(kind, x, z, 0.85 + R() * 0.3, R)) { collide(rectOf(x, z, x, z, 0.22)); trees.push([x, z]); }
      }
      for (let i = 0; i < 9; i++) { const x = lerp(A.minX + 0.8, A.maxX - 0.8, R()), z = lerp(A.minZ + 0.8, A.maxZ - 0.8, R()); leaf.add(T.card, mr(x, gy(x, z) + 0.12, z, R() * TAU, -Math.PI / 2 + (R() - 0.5) * 0.7, 0, 0.9 + R() * 0.5), pick(R, [0xd8cc88, 0xc0c078, 0xb8b870])); }
      if (trees.length && R() < 0.45) { const [x, z] = pick(R, trees), a = R() * TAU; ladder(x + Math.sin(a) * 1.0, gy(x, z) - 0.05, z + Math.cos(a) * 1.0, a + Math.PI, 2.6, 0.35); for (let k = 0; k < 3; k++) IT.basket(x + Math.sin(a + 0.8 + k * 0.5) * 1.5, z + Math.cos(a + 0.8 + k * 0.5) * 1.5, R, main === 'olive' ? 0x3e3a2a : main === 'fig' ? 0x5a3a4a : 0x8a7a48); poi({ type: 'work', x: x + Math.sin(a) * 1.6, z: z + Math.cos(a) * 1.6, y: gy(x, z), ry: a + Math.PI, note: 'harvest' }); }
      L.addArea({ name: 'orchard', ...inset(A, 0.8), owner: OWN });
    },
    pen(A, R, c) {      // goats or sheep in a hurdle pen with a mud-walled stable; hay, chickens and a cart in front
      const [inx, inz] = c.inward[c.entry], ext = inx ? c.W0 : c.D0, fd = clamp(ext * 0.38, 3, 6);
      const P = { ...A }; if (c.entry === 'minX') P.minX += fd; else if (c.entry === 'maxX') P.maxX -= fd; else if (c.entry === 'minZ') P.minZ += fd; else P.maxZ -= fd;
      enclose(P, 'fence', c.entry, R, 1.3);
      const back = { minX: 'maxX', maxX: 'minX', minZ: 'maxZ', maxZ: 'minZ' }[c.entry], bl = back === 'minX' || back === 'maxX';
      const pw = P.maxX - P.minX, pdp = P.maxZ - P.minZ, pcx = (P.minX + P.maxX) / 2, pcz = (P.minZ + P.maxZ) / 2;
      const span = Math.min(bl ? pdp : pw, 6.5) - 0.6, sd = 2.4, bx = back === 'minX' ? P.minX + 0.35 : back === 'maxX' ? P.maxX - 0.35 : pcx, bz = back === 'minZ' ? P.minZ + 0.35 : back === 'maxZ' ? P.maxZ - 0.35 : pcz;
      const ix = -inx, iz = -inz;   // from the back wall into the pen
      const ex = bl ? 0 : 1, ez = bl ? 1 : 0, ry = faceRy(ix, iz), g = Math.min(gy(bx, bz), gy(bx + ix * sd, bz + iz * sd)) , mud = pick(R, [0xcbb896, 0xc4ae8a, 0xd2c09e]);
      B.walls.add(boxF(span + 0.35, 2.5, 0.35, 'XxZzY'), mat(bx, g + 0.75, bz, 0, ry, 0), mud);
      for (const sdn of [-1, 1]) B.walls.add(boxF(0.3, 2.3, sd, 'XxZzY'), mat(bx + ex * sdn * span / 2 + ix * sd / 2, g + 0.65, bz + ez * sdn * span / 2 + iz * sd / 2, 0, ry, 0), mud);
      B.roofs.add(boxF(span + 0.9, 0.1, Math.hypot(sd + 0.5, 0.45), 'XxYyZz'), mr(bx + ix * (sd / 2 + 0.1), g + 2.02, bz + iz * (sd / 2 + 0.1), ry, Math.atan2(0.45, sd + 0.5)), pick(R, [0xb8714a, 0xa8654a, 0xc5895f]));
      const [px0, pz0] = [bx + ix * sd - ex * span / 2, bz + iz * sd - ez * span / 2], [px1, pz1] = [bx + ix * sd + ex * span / 2, bz + iz * sd + ez * span / 2];
      for (const [x, z] of [[px0, pz0], [px1, pz1]]) pole(B.woodDark, x, gy(x, z) - 0.1, z, g + 1.85 - gy(x, z), 0.07);
      collide(rectOf(bx - ex * span / 2, bz - ez * span / 2, bx + ex * span / 2 + ix * sd, bz + ez * span / 2 + iz * sd, 0.2));
      paint.add(T.blob, mat(bx + ix * 1.2 + ex * span * 0.25, g + 0.3, bz + iz * 1.2 + ez * span * 0.25, 0, R(), 0, V(0.9, 0.6, 0.75)), 0xc2a86a);
      // trough and animals
      const tx0 = pcx - inx * 1.0 + ex * (R() - 0.5) * 2, tz0 = pcz - inz * 1.0 + ez * (R() - 0.5) * 2, tg = gy(tx0, tz0);
      B.socles.add(boxF(1.4, 0.55, 0.55, 'XxYZz'), mat(tx0, tg + 0.1, tz0, 0, ry + Math.PI / 2, 0)); small.add(boxF(1.2, 0.02, 0.38, 'Y'), mat(tx0, tg + 0.33, tz0, 0, ry + Math.PI / 2, 0), 0x4a5a60);
      collide(rectOf(tx0, tz0, tx0, tz0, 0.75)); poi({ type: 'work', x: tx0 - inx * 1.1, z: tz0 - inz * 1.1, y: tg, ry, note: 'pen' });
      const kind = R() < 0.6 ? 'goat' : 'sheep', n = 3 + Math.floor(R() * 3), cols2 = kind === 'goat' ? [0x6a4a30, 0x2e2620, 0xb8ab92, 0x8a6a48] : [0xbfb49c, 0xb4a890, 0xa89c84, 0x3a3028];
      for (let i = 0, k = 0; i < n && k < 20; k++) { const x = lerp(P.minX + 1.0, P.maxX - 1.0, R()), z = lerp(P.minZ + 1.0, P.maxZ - 1.0, R()); if (Math.hypot(x - tx0, z - tz0) > 1.1 && Math.abs((x - bx) * inx + (z - bz) * inz) > sd + 0.7) { IT.animal(kind, x, z, R() * TAU, R, pick(R, cols2)); i++; } }
      // in front: hay stacks, chickens with their coop, a cart or a donkey
      const fx = (a, b) => [lerp(A.minX + 1.2, A.maxX - 1.2, a), lerp(A.minZ + 1.2, A.maxZ - 1.2, b)], front = t => c.entry === 'minX' ? fx(0.05, t) : c.entry === 'maxX' ? fx(0.95, t) : c.entry === 'minZ' ? fx(t, 0.05) : fx(t, 0.95);
      for (let i = 0; i < 2; i++) { const [x, z] = front(0.12 + i * 0.14), g0 = gy(x, z) - 0.1, hs = 0.8 + R() * 0.3; terra.add(T.hay, mat(x, g0, z, 0, R() * 3, 0, hs), 0xf6cf7a); collide(rectOf(x, z, x, z, 1.0)); }
      if (R() < 0.6) { const [x, z] = front(0.62); IT.chickens(x, z, R, 3 + Math.floor(R() * 4)); const [hx, hz] = front(0.85), hg = gy(hx, hz); B.woodDark.add(boxF(1.1, 0.9, 0.8, 'XxZzY'), mat(hx, hg + 0.35, hz, 0, ry, 0)); B.roofs.add(boxF(1.4, 0.07, 1.1, 'XxYyZz'), mat(hx, hg + 0.85, hz, 0.15, ry, 0), 0xb8714a); collide(rectOf(hx, hz, hx, hz, 0.6)); }
      else if (R() < 0.5) { const [x, z] = front(0.7); IT.animal('donkey', x, z, R() * TAU, R, 0x7a6a5a); }
    },
    site(A, R, c) {     // a house going up: foundations, mud-brick walls, scaffold, stacks of brick, tiles and timber
      const fw = Math.min(10.5 + R() * 3, c.W0 - 3.2), fd = Math.min(8.5 + R() * 3, c.D0 - 3.2), [inx, inz] = c.inward[c.entry];
      const F = { minX: c.acx - fw / 2 - inx * 0.6, maxX: c.acx + fw / 2 - inx * 0.6, minZ: c.acz - fd / 2 - inz * 0.6, maxZ: c.acz + fd / 2 - inz * 0.6 }, t = 0.5;
      const sides = { minZ: [F.minX, F.minZ, F.maxX, F.minZ], maxZ: [F.minX, F.maxZ, F.maxX, F.maxZ], minX: [F.minX, F.minZ, F.minX, F.maxZ], maxX: [F.maxX, F.minZ, F.maxX, F.maxZ] };
      let tall = null, tallH = 0; const brick = pick(R, [0xb89470, 0xae8c68, 0xc09c76]);
      for (const [k, [x0, z0, x1, z1]] of Object.entries(sides)) {
        const L0 = Math.hypot(x1 - x0, z1 - z0), segs = k === c.entry ? [[0, L0 * 0.45 - 0.7], [L0 * 0.45 + 0.7, L0]] : [[0, L0]];
        for (const [a, b] of segs) {
          const p = [lerp(x0, x1, a / L0), lerp(z0, z1, a / L0)], q = [lerp(x0, x1, b / L0), lerp(z0, z1, b / L0)];
          shearBox(B.socles, ...p, ...q, -0.5, 1.05, t + 0.1, 'LEY'); collide(lineRect(...p, ...q, t / 2 + 0.05));
          const n = 1 + Math.floor(R() * 3);
          for (let i = 0; i < n; i++) {
            const hb = R() < 0.2 ? 0 : 0.6 + R() * 2.0; if (!hb) continue;
            const pp = [lerp(p[0], q[0], i / n), lerp(p[1], q[1], i / n)], qq = [lerp(p[0], q[0], (i + 1) / n), lerp(p[1], q[1], (i + 1) / n)];
            mudWall(pp, qq, 0.55, hb, t, brick, R);
            if (hb > tallH && b - a > 4) { tallH = hb; tall = { p, q, k }; }
          }
        }
      }
      if (tall) {       // scaffold along the tallest wall
        const [ox, oz] = { minX: [-1, 0], maxX: [1, 0], minZ: [0, -1], maxZ: [0, 1] }[tall.k], L0 = Math.hypot(tall.q[0] - tall.p[0], tall.q[1] - tall.p[1]), ex = (tall.q[0] - tall.p[0]) / L0, ez = (tall.q[1] - tall.p[1]) / L0;
        const y0 = Math.max(gy(...tall.p), gy(...tall.q)), ry = Math.atan2(-ez, ex);
        for (let i = 0; i < 3; i++) { const a = 0.4 + i * (L0 - 0.8) / 2, px = tall.p[0] + ex * a + ox * 1.1, pz = tall.p[1] + ez * a + oz * 1.1; pole(B.woodDark, px, gy(px, pz) - 0.2, pz, y0 + 3.6 - gy(px, pz), 0.06); B.woodDark.add(boxF(0.06, 0.06, 1.1, 'XxYy'), mat(px - ox * 0.55, y0 + 1.95, pz - oz * 0.55, 0, ry, 0)); }
        const mx = (tall.p[0] + tall.q[0]) / 2 + ox * 0.85, mz = (tall.p[1] + tall.q[1]) / 2 + oz * 0.85;
        B.woodDark.add(boxF(L0, 0.07, 0.07, 'YyZz'), mat(mx + ox * 0.25, y0 + 1.9, mz + oz * 0.25, 0, ry, 0));
        B.wood.add(boxF(L0 - 0.6, 0.05, 0.55, 'XxYyZz'), mat(mx, y0 + 2.0, mz, 0, ry, 0));
        for (let i = 0; i < 3; i++) B.walls.add(boxF(0.34, 0.12, 0.24, 'XxYZz'), mat(mx + ex * (i - 1) * 1.2, y0 + 2.08, mz + ez * (i - 1) * 1.2, 0, ry, 0), brick);
        ladder(mx + ex * (L0 / 2 - 0.2) + ox * 1.3, gy(mx + ex * L0 / 2 + ox * 1.3, mz + ez * L0 / 2 + oz * 1.3) - 0.05, mz + ez * (L0 / 2 - 0.2) + oz * 1.3, faceRy(ox, oz), 2.7, 0.25);
        poi({ type: 'work', x: mx + ox * 1.9, z: mz + oz * 1.9, y: gy(mx + ox * 1.9, mz + oz * 1.9), ry: faceRy(-ox, -oz), note: 'building' });
      }
      // material stacks between the house and the lot edge
      const band = [{ minX: A.minX + 0.3, maxX: F.minX - 0.9 }, { minX: F.maxX + 0.9, maxX: A.maxX - 0.3 }].filter(r => r.maxX - r.minX > 1.0);
      const stack = (x, z, w, hh, d, col, bk = B.walls) => { const a = (R() - 0.5) * 0.3; bk.add(boxF(w, hh * 0.55, d, 'XxYZz'), mat(x, gy(x, z) - 0.05 + hh * 0.275, z, 0, a, 0), col); bk.add(boxF(w * 0.9, hh * 0.45, d * 0.9, 'XxYZz'), mat(x + 0.04, gy(x, z) - 0.05 + hh * 0.775, z - 0.03, 0, a + (R() - 0.5) * 0.25, 0), col); collide(rectOf(x, z, x, z, Math.max(w, d) / 2 + 0.05)); };
      for (const r of band) {
        const x = (r.minX + r.maxX) / 2;
        for (let i = 0; i < 4; i++) { const z = lerp(F.minZ + 0.8, F.maxZ - 0.8, i / 3); const q = R(); if (q < 0.4) stack(x, z, 0.9, 0.55 + R() * 0.3, 0.7, brick); else if (q < 0.6) stack(x, z, 0.8, 0.6, 0.6, 0xd2c6ae, B.socles); else if (q < 0.75) { for (let k = 0; k < 4; k++) B.woodDark.add(boxF(0.18, 0.18, 3.2, 'XxYZz'), mat(x + (k % 3 - 1) * 0.2, gy(x, z) + 0.05 + (k === 3 ? 0.18 : 0), z, 0, 0, 0)); collide(rectOf(x, z, x, z, 0.4)); } else { small.add(T.cone, mat(x, gy(x, z) - 0.05, z, 0, 0, 0, V(0.8, 0.65, 0.8)), 0xa89478); for (let k = 0; k < 2; k++) B.socles.add(boxF(0.95 - k * 0.1, 0.1, 0.75, 'XxYZz'), mat(x + k * 0.04, gy(x, z) + 0.02 + k * 0.1, z + 1.15, 0, (R() - 0.5) * 0.3, 0)); } }
      }
      if (!band.length) stack(c.acx, c.acz, 0.9, 0.7, 0.7, brick);
      IT.amph(F.minX + 1.2, F.minZ + 0.9, 0, R, 2);
      poi({ type: 'work', x: c.acx, z: c.acz, y: gy(c.acx, c.acz), ry: 0, note: 'building' });
    },
    ruin(A, R, c) {     // a fallen house: broken socles, wall stubs, heaps of stone and tile, weeds, a fig in the rubble
      const fw = Math.min(10 + R() * 3, c.W0 - 2), fd = Math.min(9 + R() * 3, c.D0 - 2), F = { minX: c.acx - fw / 2, maxX: c.acx + fw / 2, minZ: c.acz - fd / 2, maxZ: c.acz + fd / 2 };
      const sides = [[F.minX, F.minZ, F.maxX, F.minZ], [F.minX, F.maxZ, F.maxX, F.maxZ], [F.minX, F.minZ, F.minX, F.maxZ], [F.maxX, F.minZ, F.maxX, F.maxZ]];
      for (const [x0, z0, x1, z1] of sides) {
        const L0 = Math.hypot(x1 - x0, z1 - z0);
        for (let a = 0; a < L0;) {
          const len = 1.5 + R() * 4, b = Math.min(L0, a + len);
          if (R() < 0.7) { const p = [lerp(x0, x1, a / L0), lerp(z0, z1, a / L0)], q = [lerp(x0, x1, b / L0), lerp(z0, z1, b / L0)]; shearBox(B.socles, ...p, ...q, -0.4, 0.75 + R() * 0.3, 0.55, 'LEY'); if (R() < 0.4) {       // a crumbling stub of mud brick, stepping down, with a stone lodged on top
            const hh = 0.7 + R() * 1.2, cc = pick(R, [0x9c8466, 0x947e60, 0xa68c6c]), ks = [0, lerp(0.2, 0.45, R()), lerp(0.55, 0.8, R()), 1], hs = [hh, hh * (0.55 + R() * 0.25), hh * (0.2 + R() * 0.25)], flip = R() < 0.5, pt = k => [lerp(p[0], q[0], k), lerp(p[1], q[1], k)];
            for (let i = 0; i < 3; i++) mudWall(pt(ks[i]), pt(ks[i + 1]), 0.5, hs[flip ? 2 - i : i], 0.45, cc, R, false);
            const kr = flip ? 0.9 : 0.1, [rx, rz] = pt(kr); B.socles.add(T.rock, mat(rx, lerp(gy(...p), gy(...q), kr) + 0.5 + hh + 0.06, rz, R(), R() * 3, R(), V(0.22, 0.12, 0.18)));
          } collide(lineRect(...p, ...q, 0.28)); }
          a = b + 0.6 + R() * 1.8;
        }
      }
      for (let i = 0; i < 4; i++) {
        const x = lerp(F.minX + 1, F.maxX - 1, R()), z = lerp(F.minZ + 1, F.maxZ - 1, R()), n = 3 + Math.floor(R() * 3);
        for (let k = 0; k < n; k++) { const s = 0.2 + R() * 0.3, px = x + (R() - 0.5) * 1.4, pz = z + (R() - 0.5) * 1.4; B.socles.add(T.rock, mat(px, gy(px, pz) + s * 0.25, pz, R() * 3, R() * 3, R() * 3, V(s * 1.3, s * 0.7, s))); }
        for (let k = 0; k < 3; k++) terra.add(boxF(0.42, 0.03, 0.3, 'XxYZz'), mat(x + (R() - 0.5) * 2, gy(x, z) + 0.06, z + (R() - 0.5) * 2, (R() - 0.5) * 0.5, R() * 3, 0), 0xb06a44);
        collide(rectOf(x, z, x, z, 0.8));
      }
      for (let i = 0; i < 12; i++) { const x = lerp(A.minX + 0.6, A.maxX - 0.6, R()), z = lerp(A.minZ + 0.6, A.maxZ - 0.6, R()); leaf.add(T.card2, mat(x, gy(x, z) + 0.22, z, 0, R() * 3, 0, V(0.8, 0.55, 0.8)), pick(R, [0xc8c080, 0xb0b870, 0xd8c890])); }
      if (R() < 0.55) { const x = c.acx + (R() - 0.5) * 3, z = c.acz + (R() - 0.5) * 3; if (plantTree('fig', x, z, 0.8 + R() * 0.3, R)) collide(rectOf(x, z, x, z, 0.22)); }
      if (R() < 0.3) IT.animal('goat', c.acx + 2, c.acz - 1.5, R() * TAU, R, 0x2e2620);
    },
    open(A, R, c) {     // a little open yard: a shade tree, benches, a cart, a donkey, racks of dyed cloth
      const tx0 = c.acx + (R() - 0.5) * c.W0 * 0.3, tz0 = c.acz + (R() - 0.5) * c.D0 * 0.3;
      if (plantTree(pick(R, ['olive', 'fig']), tx0, tz0, 1.25 + R() * 0.2, R)) collide(rectOf(tx0, tz0, tx0, tz0, 0.3));
      for (const [dx, dz] of [[0, 2.2], [2.2, 0]].slice(0, 1 + (R() < 0.6 ? 1 : 0))) { const s = R() < 0.5 ? 1 : -1; IT.bench(tx0 + dx * s, tz0 + dz * s, faceRy(-dx * s, -dz * s), R, true); }
      poi({ type: 'gather', x: tx0 - 1.8, z: tz0 - 1.8, y: gy(tx0 - 1.8, tz0 - 1.8), r: 2.2, note: 'shade tree' });
      const corner = (fx, fz) => [lerp(A.minX + 2, A.maxX - 2, fx), lerp(A.minZ + 2, A.maxZ - 2, fz)];
      if (R() < 0.6) { const [x, z] = corner(R() < 0.5 ? 0 : 1, R() < 0.5 ? 0 : 1), dx = c.acx - x, dz = c.acz - z; cart(x, z, Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dz > 0 ? 0 : Math.PI), inset(A, 0.3), rectOf(tx0, tz0, tx0, tz0, 1.2)); }
      if (R() < 0.45) { const [x, z] = corner(0.5, R() < 0.5 ? 0.05 : 0.95); pole(B.woodDark, x, gy(x, z) - 0.2, z, 1.4, 0.06); IT.animal('donkey', x + 0.9, z, R() * TAU, R, pick(R, [0x7a6a5a, 0x5a4e44, 0x8a7a68])); }
      if (R() < 0.5) {
        const vert = c.W0 < c.D0, x0 = vert ? (R() < 0.5 ? A.minX + 1.2 : A.maxX - 1.2) : A.minX + 1.5, z0 = vert ? A.minZ + 1.5 : (R() < 0.5 ? A.minZ + 1.2 : A.maxZ - 1.2);
        for (let i = 0; i < 2; i++) {
          const ax = vert ? x0 : x0 + i * 3.2, az = vert ? z0 + i * 3.2 : z0, bx = vert ? ax : ax + 2.6, bz = vert ? az + 2.6 : az;
          if (Math.hypot((ax + bx) / 2 - tx0, (az + bz) / 2 - tz0) < 2.5) continue;
          for (const [x, z] of [[ax, az], [bx, bz]]) pole(B.woodDark, x, gy(x, z) - 0.2, z, 2.25, 0.04);
          laundry(ax, az, gy(ax, az) + 1.95, bx, bz, gy(bx, bz) + 1.95, R);
        }
        poi({ type: 'work', x: x0 + (vert ? 0.9 : 1.3), z: z0 + (vert ? 1.3 : 0.9), y: gy(x0, z0), ry: 0, note: 'dyed cloth' });
      }
      if (R() < 0.5) IT.wood(A.maxX - 1.5, A.maxZ - 1.2, 0, R);
      L.addArea({ name: 'yard', ...inset(A, 0.8), owner: OWN });
    },
  };

  // ---------- the low ground north of the harbour apron: terraces with boat-builders' sheds and a net-menders' yard, steps down to the lane along
  // the apron wall with a rope-walk in it, kitchen gardens, and hulls on trestles on the shore under the quay ----------
  const HULL = (() => {       // a fishing boat 6.6 m long along z, bow at +z, keel at y = 0: tarred bottom, a painted top strake, the plain inside
    const N = 10, Mh = 3, Lh = 6.6, Bm = 0.95, rows = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, e = Math.abs(2 * t - 1), z = (t - 0.5) * Lh, w = Math.pow(Math.sin(Math.PI * t), t < 0.5 ? 0.45 : 0.65), sheer = 0.7 + (t < 0.5 ? 0.75 : 0.55) * Math.pow(e, 2.4), keel = 0.12 * Math.pow(e, 3);
      const row = []; for (let k = -Mh; k <= Mh; k++) { const s = [0, 0.52, 0.84, 1][Math.abs(k)]; row.push([Math.sign(k) * Bm * w * Math.sqrt(1 - (1 - s) * (1 - s)), keel + (sheer - keel) * Math.pow(s, 1.4), z]); } rows.push(row);
    }
    const shell = (ks, inner) => {
      const pos = [], uv = [], idx = [], at = (i, k) => { const p = rows[i][k + Mh]; return inner ? [p[0] * 0.95, p[1] + 0.035, p[2] * 0.985] : p; };
      for (let i = 0; i < N; i++) for (const k of ks) { const b = pos.length / 3; for (const [ii, kk] of [[i, k], [i, k + 1], [i + 1, k + 1], [i + 1, k]]) { const p = at(ii, kk); pos.push(...p); uv.push(p[2], p[1] + Math.abs(p[0])); } if (inner) idx.push(b, b + 2, b + 1, b, b + 3, b + 2); else idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
    };
    // the painted eyes on the bow, and the stem and stern posts rising above the sheer
    const eye = new Bucket(), pupil = new Bucket(); for (const s of [-1, 1]) { const a = rows[N - 1][Mh + s * 2], b = rows[N - 2][Mh + s * 2], p = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], tx = b[0] - a[0], tz = b[2] - a[2], q = new THREE.Matrix4().makeRotationY(Math.atan2(-s * tz, s * tx)); eye.add(new THREE.CircleGeometry(0.1, 8).applyMatrix4(q), mat(p[0] + s * 0.012, p[1], p[2])); pupil.add(new THREE.CircleGeometry(0.05, 6).applyMatrix4(q), mat(p[0] + s * 0.02, p[1], p[2])); }
    const posts = new Bucket(); posts.add(boxF(0.09, 0.55, 0.12, 'XxYZz'), mat(0, rows[N][Mh][1] + 0.16, Lh / 2 + 0.03, 0.25, 0, 0)); posts.add(boxF(0.09, 0.5, 0.12, 'XxYZz'), mat(0, rows[0][Mh][1] + 0.2, -Lh / 2 - 0.06, -0.45, 0, 0));
    return { rows, low: shell([-2, -1, 0, 1], false), up: shell([-3, 2], false), inside: shell([-3, -2, -1, 0, 1, 2], true), mid: shell([-1, 0], false), midIn: shell([-1, 0], true), eye: eye.build(), pupil: pupil.build(), posts: posts.build() };
  })();
  // a hull on two trestles at (x, z) on ground y, turned by ry (0: bow to +z); returns its footprint
  function hull(x, y, z, ry, R, lift = 0.55) {
    const m = mat(x, y + lift, z, 0, ry, 0), strake = pick(R, [0x6a2e22, 0x2c4460, 0x3e4a36, 0x7a6030, 0x5a3a28]);
    paint.add(HULL.low, m, pick(R, [0x2a2420, 0x322a24])); paint.add(HULL.up, m, strake); B.wood.add(HULL.inside, m); paint.add(HULL.eye, m, 0xc8bea8); paint.add(HULL.pupil, m, 0x1c1814); paint.add(HULL.posts, m, 0x2a2420);
    for (const tz of [-1.2, 0.3]) paint.add(boxF(1.5, 0.06, 0.24, 'XxYyZz'), m.clone().multiply(mat(0, 0.58, tz)), 0x7a5a3c);
    for (const tz of [-1.7, 1.5]) { const mm = (a, b, c, rz = 0) => mat(x, y, z, 0, ry, 0).multiply(mat(a, b, c, 0, 0, rz)); B.woodDark.add(boxF(1.4, 0.12, 0.14, 'XxYyZz'), mm(0, lift - 0.02, tz)); for (const s of [-1, 1]) B.woodDark.add(boxF(0.09, lift + 0.1, 0.09, 'XxZz'), mm(s * 0.45, (lift - 0.08) / 2, tz, s * 0.3)); }
    const r = orect(x, z, ry, 1.05, 3.35); collide(r); return r;
  }
  // a drying rack along local x: two crooked square posts with forked or pegged tops, a rough pole, and a net hung over it on one side or both — each sheet
  // falls in columns of different lengths, bellies out and gathers into folds at the foot; its head rope of cork floats lies along the pole
  function netRack(x, z, ry, len, R, sides = R() < 0.35 ? [R() < 0.5 ? -1 : 1] : [-1, 1]) {
    const g = gy(x, z), ex = Math.cos(ry), ez = -Math.sin(ry), nx = Math.sin(ry), nz = Math.cos(ry), yb = g + 1.74 + R() * 0.1;
    for (const s of [-1, 1]) {
      const px = x + ex * s * len / 2, pz = z + ez * s * len / 2, gp = gy(px, pz), hp = yb - gp + 0.06;
      const base = mat(px, gp - 0.12, pz, 0, ry, 0).multiply(mat(0, 0, 0, (R() - 0.5) * 0.06, 0, (R() - 0.5) * 0.05 - s * 0.02)), at = (a, y, o, rx = 0) => base.clone().multiply(mat(a, y, o, rx, 0, 0));
      B.wood.add(boxF(0.09, hp, 0.09, 'XxZzY'), at(0, hp / 2, 0));
      if (R() < 0.6) for (const f of [-1, 1]) B.wood.add(boxF(0.05, 0.3, 0.05, 'XxZzY'), at(0, hp - 0.04, f * 0.02, f * 0.42).multiply(mat(0, 0.15, 0)));       // a forked top
      else { for (const f of [-1, 1]) B.wood.add(boxF(0.03, 0.24, 0.03, 'XxZzY'), at(0, hp + 0.06, f * 0.075)); B.wood.add(boxF(0.03, 0.03, 0.26, 'XxYy'), at(0, hp - 0.06, 0)); }   // pegs
    }
    B.wood.add(new THREE.CylinderGeometry(0.036, 0.046, len + 0.45, 5, 1, true).rotateZ(Math.PI / 2), mat(x, yb + 0.02, z, 0, ry, (R() - 0.5) * 0.03));
    const tint = pick(R, [0xa08e68, 0x9a8866, 0xa49270]), floatSide = pick(R, sides);
    for (const s of sides) {
      const C = 6 + Math.floor(R() * 3), Rw = 4, hl = len / 2 - 0.1, span = hl * 2 * (0.62 + R() * 0.33), ua = -hl + R() * (hl * 2 - span), one = sides.length === 1, dMax = Math.min(1.6, yb - g - 0.12);
      const ph = R() * TAU, dBase = one ? 1.25 + R() * 0.25 : 0.95 + R() * 0.3, spread = (one ? 0.06 : 0.12) + R() * 0.16, uo = R();
      const drop = Array.from({ length: C + 1 }, (_, c) => clamp(dBase + 0.26 * Math.sin(ph + c * 1.35) + (R() - 0.5) * 0.34, 0.8, dMax));
      const pleat = Array.from({ length: C + 1 }, (_, c) => (c % 2 ? 1 : -1) * (0.07 + R() * 0.08)), bulge = Array.from({ length: (C + 1) * (Rw + 1) }, () => (R() - 0.5) * 0.2);
      const pos = [], uv = [], idx = [];
      for (let r = 0; r <= Rw; r++) for (let c = 0; c <= C; c++) {
        const t = r / Rw, k = c / C, u0 = ua + span * k, gc = ua + span * Math.min(C, 3 * Math.round(c / 3)) / C, u = lerp(u0, gc, 0.55 * t * t) + (c === 0 ? 0.16 : c === C ? -0.16 : 0) * t;
        const o = s * (0.045 + spread * t * t + pleat[c] * (0.3 + 1.1 * t) + bulge[r * (C + 1) + c] * Math.sin(Math.PI * t)), y = yb + 0.05 - drop[c] * t * (1 - 0.05 * t) - (c % 3 ? 0.06 : 0) * t;
        pos.push(x + ex * u + nx * o, y, z + ez * u + nz * o); uv.push(uo + (u0 - ua) * 1.08 / 1.2, AV(524 + drop[c] * t * NET_PX));
      }
      for (let r = 0; r < Rw; r++) for (let c = 0; c < C; c++) { const a = r * (C + 1) + c, b = a + C + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      const gq = new THREE.BufferGeometry(); gq.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gq.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gq.setIndex(idx); gq.computeVertexNormals();
      wick.add(gq, null, tint);
      if (s === floatSide) for (let q = ua + 0.08; q < ua + span - 0.05; q += 0.16 + R() * 0.06) {          // the head rope with its corks, hung over the pole
        const o = s * (0.05 + R() * 0.02), yq = yb - 0.03 - R() * 0.05;
        terra.add(T.blob5, mat(x + ex * q + nx * o, yq, z + ez * q + nz * o, (R() - 0.5) * 0.4, ry + (R() - 0.5) * 0.5, 0, V(0.055, 0.04, 0.025)), pick(R, [0xd0a060, 0xc49456, 0xd8ac6c]));
      }
    }
    collide(orect(x, z, ry, len / 2 + 0.12, 0.62));
    const ps = sides[0];
    poi({ type: 'work', x: x + nx * ps * 1.15, z: z + nz * ps * 1.15, y: g, ry: faceRy(-nx * ps, -nz * ps), note: 'net mending', _o: [x, z] });
  }
  // a net heaped on the ground to be mended: lumpy mounds of tangled twine, a few corks showing
  function netHeap(x, z, r, R, y0 = gy(x, z)) {
    for (let i = 0; i < 2; i++) {
      const gq = new THREE.SphereGeometry(1, 9, 4, 0, TAU, 0, Math.PI / 2), p = gq.attributes.position, ph = R() * TAU;
      for (let k = 0; k < p.count; k++) { const a = Math.atan2(p.getZ(k), p.getX(k)), yy = p.getY(k), w = 1 + 0.16 * Math.sin(3 * a + ph) * (1 - yy) + 0.1 * Math.sin(5 * a + ph * 2) * yy; p.setXYZ(k, p.getX(k) * w, yy * (1 + 0.25 * Math.sin(2 * a + ph)), p.getZ(k) * w); }
      gq.computeVertexNormals();
      const rr = i ? r * (0.45 + R() * 0.15) : r, ang = R() * TAU, dx = i ? Math.cos(ang) * r * 0.75 : 0, dz = i ? Math.sin(ang) * r * 0.75 : 0;
      wick.add(gq, mat(x + dx, y0 - 0.03, z + dz, 0, R() * TAU, 0, V(rr, rr * (0.36 + R() * 0.14), rr * (0.7 + R() * 0.25))), pick(R, [0x86785c, 0x7e7058])); toCell(wick, TANGLE_UV);
    }
    { const a = R() * TAU, ca = Math.cos(a), sa = Math.sin(a), L1 = r * (1.3 + R() * 0.5), W1 = r * 1.1, pos = [], uv = [];       // a fold of net trailing out of the heap across the floor
      for (let j = 0; j <= 1; j++) for (let i = 0; i <= 2; i++) { const l = r * 0.5 + (L1 - r * 0.5) * i / 2, w = (j - 0.5) * W1 * (1 - 0.3 * i / 2), px = x + ca * l - sa * w, pz = z + sa * l + ca * w; pos.push(px, y0 + 0.02 + (i === 0 ? r * 0.18 : 0.004 * i), pz); uv.push(l / 1.2, AV(560 + (w / W1 + 0.5) * 0.9 * NET_PX)); }
      const gq = new THREE.BufferGeometry(); gq.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gq.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gq.setIndex([0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]); gq.computeVertexNormals(); wick.add(gq, null, 0x9c8c6c); }
    for (let i = 0; i < 4; i++) { const a = R() * TAU, d = r * (0.3 + R() * 0.6); terra.add(boxF(0.1, 0.07, 0.035, 'XxYyZz'), mat(x + Math.cos(a) * d, y0 + r * 0.33 * (1 - d / r) + 0.02, z + Math.sin(a) * d, R() * 1.2, R() * 3, R()), 0xb89a6a); }
    collide(rectOf(x, z, x, z, r * 0.8));
  }
  // a hull going up on the stocks: keel blocks and shores, the bottom strakes planked, the frames standing bare above them
  function hullFrame(x, y, z, R, lift = 0.42) {
    const m = mat(x, y + lift, z), rows = HULL.rows, N = rows.length - 1;
    B.wood.add(HULL.mid, m); B.wood.add(HULL.midIn, m); B.wood.add(HULL.posts, m); B.woodDark.add(boxF(0.12, 0.16, 6.5, 'XxYZz'), mat(x, y + lift - 0.04, z));
    for (let i = 1; i < N; i++) for (let k = -3; k < 3; k++) {
      const p = rows[i][k + 3], q = rows[i][k + 4], a = V(p[0] * 0.95, p[1] + 0.03, p[2]), b = V(q[0] * 0.95, q[1] + 0.03, q[2]), d = b.clone().sub(a), l = d.length(); if (l < 0.02) continue;
      B.wood.add(boxF(0.05, l + 0.05, 0.07, 'XxZz'), m.clone().multiply(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1))));
    }
    for (const tz of [-2.3, 0, 2.2]) B.woodDark.add(boxF(0.5, lift, 0.3, 'XxYZz'), mat(x, y + lift / 2 - 0.04, z + tz));
    for (const s of [-1, 1]) for (const tz of [-1.3, 1.2]) { const a = V(x + s * 1.45, y, z + tz), b = V(x + s * 0.86, y + lift + 0.42, z + tz), d = b.clone().sub(a); B.wood.add(boxF(0.07, d.length(), 0.07, 'XxZz'), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1))); }
    collide(orect(x, z, 0, 1.3, 3.4));
  }
  // a short flight of steps down from a terrace edge at zTop (top yTop) to the ground towards +z, x0..x1 wide
  function flight(x0, x1, zTop, yTop) {
    const gB = Math.min(gy((x0 + x1) / 2, zTop + 1.2), gy(x0, zTop + 1.2), gy(x1, zTop + 1.2)), n = Math.max(1, Math.round((yTop - gB) / 0.24)), rise = (yTop - gB) / (n + 1), dep = 0.32;
    for (let k = 1; k <= n; k++) { const top = yTop - k * rise, z0 = zTop + (k - 1) * dep; B.socles.add(boxF(x1 - x0, top - gB + 0.4, dep, 'XxYZ'), mat((x0 + x1) / 2, (top + gB - 0.4) / 2, z0 + dep / 2)); steps.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z0 + dep, flat: top }); }
    claim(rectOf(x0, zTop, x1, zTop + n * dep + 0.8), 'harbourside');
  }
  // a terrace of dressed stone whose top stands lift above the highest ground under it; open: sides left without an edge collider (entries)
  function terrace(r, lift, open = '', gaps = []) {      // gaps: [x0, x1] spans of the south edge left open (steps)
    let tMax = -Infinity, tMin = Infinity; for (let i = 0; i <= 5; i++) for (let j = 0; j <= 5; j++) { const t = terrainHeight(lerp(r.minX, r.maxX, i / 5), lerp(r.minZ, r.maxZ, j / 5)); tMax = Math.max(tMax, t); tMin = Math.min(tMin, t); }
    const y = tMax + lift, w = r.maxX - r.minX, d = r.maxZ - r.minZ, cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    B.socles.add(boxF(w, y - tMin + 0.5, d, 'XxZzY'), mat(cx, (y + tMin - 0.5) / 2, cz));
    B.socles.add(boxF(w + 0.1, 0.1, d + 0.1, 'XxZzY'), mat(cx, y - 0.02, cz));        // a projecting coping course
    for (const [k, x0, z0, x1, z1] of [['minZ', r.minX, r.minZ, r.maxX, r.minZ], ['maxZ', r.minX, r.maxZ, r.maxX, r.maxZ], ['minX', r.minX, r.minZ, r.minX, r.maxZ], ['maxX', r.maxX, r.minZ, r.maxX, r.maxZ]]) {
      if (open.includes(k)) continue;
      const drop = y - Math.min(terrainHeight(x0, z0), terrainHeight(x1, z1), terrainHeight((x0 + x1) / 2, (z0 + z1) / 2));
      if (drop <= 0.45) continue;
      const inx = k === 'minX' ? 0.12 : k === 'maxX' ? -0.12 : 0, inz = k === 'minZ' ? 0.12 : k === 'maxZ' ? -0.12 : 0;
      let spans = [[x0, x1]]; if (k === 'maxZ') for (const [a, b] of gaps) spans = spans.flatMap(([p, q]) => [[p, Math.min(q, a)], [Math.max(p, b), q]]).filter(([p, q]) => q - p > 0.05);
      for (const [p, q] of spans) collide(k === 'maxZ' || k === 'minZ' ? lineRect(p, z0 + inz, q, z0 + inz, 0.12) : lineRect(x0 + inx, z0, x1 + inx, z1, 0.12));
    }
    PLAT.push({ ...r, y }); claim(r, 'harbourside'); return y;
  }
  // a boat-builders' shed: rubble side and back walls, a timber gable, open to the south onto a work floor at the front of the terrace with a timber stack and an
  // adze bench; inside, a hull on trestles for repair or a new one on the stocks
  function boatShed(cx, z0, z1, W, y, R, building = false, side = R() < 0.5 ? -1 : 1, benchX = null) {
    const zF = z1 - 2.1, D = zF - z0, He = 2.6, t = 0.45;
    for (const s of [-1, 1]) { rub.add(boxF(t, He + 0.3, D, 'XxYZz'), mat(cx + s * (W / 2 - t / 2), y + He / 2 - 0.15, (z0 + zF) / 2)); collide(rectOf(cx + s * (W / 2 - t), z0, cx + s * W / 2, zF)); }
    rub.add(boxF(W - 2 * t, He + 0.3, t, 'YZz'), mat(cx, y + He / 2 - 0.15, z0 + t / 2)); collide(rectOf(cx - W / 2, z0, cx + W / 2, z0 + t));
    B.roofs.add(kit.gableRoof(W, D + 0.3, 0.45, 0.36), mat(cx, y + He, (z0 + zF) / 2 + 0.15), pick(R, [0xc8804f, 0xb8714a, 0xa8654a]));
    B.wood.add(kit.gableEnds(W, D - 0.3, 0.36), mat(cx, y + He, (z0 + zF) / 2));
    B.woodDark.add(boxF(W, 0.24, 0.26, 'XxYyZz'), mat(cx, y + He - 0.1, zF - 0.13));
    const hz = (z0 + t + zF) / 2 - 0.2;
    if (building) hullFrame(cx, y, hz, R); else hull(cx, y, hz, 0, R);
    for (let i = 0; i < 3; i++) B.wood.add(boxF(0.05, 3.2, 0.12, 'XxZz'), mat(cx - W / 2 + t + 0.12 + i * 0.1, y + 1.55, z0 + t + 1.2 + i * 0.55, 0.12, 0, 0.1));
    poi({ type: 'work', x: cx + 1.8, z: hz + 0.5, y, ry: -Math.PI / 2, note: building ? 'boat building' : 'caulking a boat', _o: [cx, hz + 0.5] });
    // the work floor, along the terrace's edge (a walkway left in front of the shed): planks seasoning on bearers, an adze bench with a plank being shaped, chips
    const zc = z1 - 0.52, sL = 2.2, sx = cx + side * (W / 2 - 0.25 - sL / 2);
    for (const dx of [-0.8, 0.8]) B.woodDark.add(boxF(0.12, 0.1, 0.62, 'XxYZz'), mat(sx + dx, y + 0.05, zc));
    for (let i = 0; i < 5; i++) { const lyr = i < 2 ? 0 : i < 4 ? 1 : 2, kk = i < 2 ? i : i < 4 ? i - 2 : 0.5; B.wood.add(boxF(sL - R() * 0.2, 0.055, 0.24, 'XxYZz'), mat(sx + (R() - 0.5) * 0.12, y + 0.13 + lyr * 0.06, zc - 0.13 + kk * 0.26, 0, (R() - 0.5) * 0.04, 0)); }
    collide(rectOf(sx - sL / 2 - 0.05, zc - 0.3, sx + sL / 2 + 0.05, zc + 0.3));
    const bx = benchX ?? cx - side * (W / 2 - 0.35 - 0.8);
    B.wood.add(boxF(1.5, 0.24, 0.28, 'XxYZz'), mat(bx, y + 0.48, zc)); for (const s of [-1, 1]) B.woodDark.add(boxF(0.15, 0.38, 0.15, 'XxZz'), mat(bx + s * 0.55, y + 0.18, zc, 0, R(), 0));
    B.wood.add(boxF(1.35, 0.05, 0.2, 'XxYZz'), mat(bx + 0.05, y + 0.625, zc - 0.02, 0, 0.06, 0.04));
    for (let i = 0; i < 9; i++) terra.add(boxF(0.07 + R() * 0.05, 0.012, 0.03, 'Y'), mat(bx + (R() - 0.5) * 1.8, y + 0.012, zc - 0.3 - R() * 0.5, 0, R() * 3, 0), pick(R, [0xc8a878, 0xb89868, 0xd0b488]));
    collide(rectOf(bx - 0.78, zc - 0.18, bx + 0.78, zc + 0.18));
    poi({ type: 'work', x: bx + 0.2, z: zc - 0.68, y, ry: 0, note: 'shipwright adze bench', _o: [bx, zc] });
  }
  function harbourQuarter(R) {
    const clear = r => !HB.hit(r, 0.6) && !FG.hit(r, 0.3) && !MG.hit(r, 0.2) && !L.isReserved(r, 0.35) && !CG.hit(r, 0.1);
    // block (0,5): a net-menders' yard and two boat-builders' sheds on terraces, the rope-walk in the lane below them along the apron wall, a kitchen garden above
    const yardR = rectOf(152.0, 400.2, 170.2, 412.6), shedR = rectOf(172.0, 399.6, 185.0, 413.2);      // (the apron's stair comes down at x 184..187: its foot and the way from it to the street at x 190 stay clear)
    if (clear(yardR)) {
      const y = terrace(yardR, 0.22, 'minZminX');
      for (const [x, z, ry, len] of [[156.8, 403.6, 0, 3.4], [163.6, 403.4, 0.08, 3.2], [157.2, 409.3, 0.12, 3.0], [163.4, 409.5, -0.1, 3.0]]) netRack(x, z, ry, len, R);
      IT.bench(160.2, 406.5, Math.PI, R, false); for (const [x, z] of [[161.8, 406.1], [158.8, 406.9]]) IT.basket(x, z, R, 0xa88a5c);
      { const x = 168.2, z = 402.4; for (let i = 0; i < 3; i++) B.socles.add(T.rock, mat(x + Math.cos(i * 2.1) * 0.32, y + 0.08, z + Math.sin(i * 2.1) * 0.32, R(), R() * 3, R(), V(0.2, 0.14, 0.18))); terra.add(T.pot, mat(x, y + 0.14, z, 0, R(), 0, 1.7), 0x3a3029); small.add(T.disc, mat(x, y + 0.02, z, 0, 0, 0, 2.2), 0x4a4440); collide(rectOf(x, z, x, z, 0.5)); poi({ type: 'work', x: x - 0.9, z, y, ry: Math.PI / 2, note: 'tar pot', _o: [x, z] }); }
      { const x = 168.4, z = 410.6; B.walls.add(boxF(2.4, 2.3, 2.2, 'XxZzY'), mat(x, y + 1.05, z), 0xcfc0a2); B.roofs.add(boxF(2.9, 0.08, 2.7, 'XxYyZz'), mat(x, y + 2.25, z, 0.08, 0, 0), 0xb8714a); B.doors.add(boxF(0.8, 1.7, 0.1, 'XxYZ'), mat(x - 1.21, y + 0.85, z, 0, -Math.PI / 2, 0)); collide(rectOf(x, z, x, z, 1.25)); }
      // oars leaning against the store's west wall beside its door, blades on the ground
      for (let i = 0; i < 4; i++) {
        const a = 0.25 + i * 0.02 + R() * 0.02, zo = 409.62 + i * 0.13, c = V(167.18 - 1.45 * Math.sin(a) - 0.03, y + 1.45 * Math.cos(a), zo), rot = mat(c.x, c.y, c.z, (R() - 0.5) * 0.05, 0, -a);
        B.wood.add(boxF(0.045, 2.9, 0.045, 'XxZzY'), rot); B.wood.add(boxF(0.022, 0.72, 0.13, 'XxZz'), rot.clone().multiply(mat(0, -1.08, 0)));
      }
      collide(rectOf(166.2, 409.5, 167.2, 410.12));
      // nets heaped on the floor to be picked over
      for (const [x, z, r] of [[160.8, 411.5, 0.85], [153.6, 406.6, 0.75], [166.0, 406.6, 0.7]]) { netHeap(x, z, r, R, y); poi({ type: 'work', x: x + 0.2, z: z - r - 0.55, y, ry: 0, note: 'net mending', _o: [x, z] }); }
      IT.amph(169.2, 406.4, -Math.PI / 2, R, 3); IT.basket(154.4, 409.8, R, 0x9c7e52); IT.basket(155.0, 410.4, R, 0x9c7e52);
      poi({ type: 'gather', x: 160.4, z: 401.2, y, r: 1.6, note: 'net menders' });
      L.addArea({ name: 'work yard', note: 'net menders', owner: OWN, ...inset(yardR, 0.6) });
    }
    if (clear(shedR)) { const y = terrace(shedR, 0.22, 'minZ', [[183.2, 184.8]]); boatShed(175.3, 399.6, 413.2, 6.0, y, R); boatShed(181.7, 399.6, 413.2, 6.0, y, R, true, -1, 182.25); flight(183.2, 184.8, 413.2, y); }
    // the rope-walk in the lane: the spinner's wheel and the whirl head at the west end, posts with pegged crossbars carrying the strands, the sledge with its stone
    { const xa = 154.0, xb = 171.0, z = 418.0, r = rectOf(xa - 1.6, z - 0.9, xb + 0.6, z + 0.9);
      if (clear(r)) {
        const ga = gy(xa, z), gb = gy(xb, z), yr = Math.max(ga, gb) + 0.95;
        for (let x = xa + 1.6; x < xb - 0.6; x += 3.0) { const g = gy(x, z); B.wood.add(boxF(0.08, yr - g + 0.35, 0.08, 'XxZzY'), mat(x, (yr + g + 0.2) / 2, z, 0, 0, (R() - 0.5) * 0.04)); B.wood.add(boxF(0.05, 0.05, 0.7, 'XxYyZz'), mat(x, yr + 0.12, z)); }
        for (const dz of [-0.22, 0, 0.22]) small.add(boxF(xb - xa - 0.6, 0.022, 0.022, 'YZz'), mat((xa + xb) / 2 + 0.3, yr + 0.16, z + dz), 0x9a8660);
        // the whirl head: two posts and a bar with three hooks
        for (const s of [-1, 1]) B.wood.add(boxF(0.09, yr - ga + 0.35, 0.09, 'XxZzY'), mat(xa, (yr + ga + 0.15) / 2, z + s * 0.45));
        B.wood.add(boxF(0.09, 0.09, 1.1, 'XxYyZz'), mat(xa, yr + 0.16, z)); for (const dz of [-0.22, 0, 0.22]) B.woodDark.add(boxF(0.12, 0.025, 0.025, 'YyZz'), mat(xa + 0.08, yr + 0.16, z + dz));
        // the spinner's wheel, turned by a crank, a band from its rim to the head
        const wx = xa - 0.85, wy = ga + 1.0, wr = 0.55;
        for (const s of [-1, 1]) B.wood.add(boxF(0.08, wy - ga + 0.1, 0.08, 'XxZzY'), mat(wx, (wy + ga) / 2 - 0.05, z + s * 0.12));
        B.wood.add(new THREE.TorusGeometry(wr, 0.028, 4, 12), mat(wx, wy, z));
        for (let i = 0; i < 8; i++) B.wood.add(boxF(0.03, 2 * wr - 0.02, 0.03, 'XxZz'), mat(wx, wy, z, 0, 0, i * Math.PI / 8));
        B.woodDark.add(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 6, 1, false).rotateX(Math.PI / 2), mat(wx, wy, z));
        B.woodDark.add(boxF(0.035, 0.035, 0.46, 'XxYy'), mat(wx, wy, z));
        B.wood.add(boxF(0.04, 0.32, 0.04, 'XxZz'), mat(wx, wy - 0.15, z - 0.24)); B.wood.add(boxF(0.035, 0.035, 0.2, 'XxYyZz'), mat(wx, wy - 0.3, z - 0.33));
        { const a = V(wx + 0.05, wy + wr, z), b = V(xa - 0.05, yr + 0.16, z), d = b.clone().sub(a); small.add(boxF(0.012, d.length(), 0.012, 'XxZz'), new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.normalize()), V(1, 1, 1)), 0x9a8660); }
        // the sledge with a stone on it, a coil of finished rope
        B.wood.add(boxF(1.0, 0.12, 0.8, 'XxYZz'), mat(xb, gb + 0.06, z)); B.socles.add(T.rock, mat(xb + 0.1, gb + 0.32, z, 0.2, 0.7, 0.1, V(0.4, 0.26, 0.34))); B.wood.add(boxF(0.09, yr - gb + 0.35, 0.09, 'XxZzY'), mat(xb - 0.45, (yr + gb + 0.35) / 2, z)); B.wood.add(boxF(0.08, 0.08, 0.75, 'XxYyZz'), mat(xb - 0.45, yr + 0.16, z));
        for (let i = 0; i < 2; i++) terra.add(new THREE.CylinderGeometry(0.34, 0.36, 0.22, 8, 1, false), mat(xa + 2.6 + i * 0.9, gy(xa + 2.6 + i * 0.9, z + 0.75) + 0.1, z + 0.72), 0x8e7a58);
        collide(rectOf(xa - 1.05, z - 0.55, xb + 0.55, z + 0.55));
        poi({ type: 'work', x: wx - 0.1, z: z - 0.95, y: gy(wx, z - 0.95), ry: 0, note: 'rope-walk', _o: [wx, z] });
        claim(r, 'ropewalk');
      }
    }
    // a frame saw on its trestles in the lane below the sheds: a log half cut into planks
    { const x = 176.0, z = 417.2, r = rectOf(x - 2.4, z - 0.8, x + 2.4, z + 0.8);
      if (clear(r)) {
        const g = gy(x, z), yt = g + 1.2;
        for (const s of [-1, 1]) { for (const f of [-1, 1]) B.woodDark.add(boxF(0.1, 1.35, 0.1, 'XxZz'), mat(x + s * 1.4, g + 0.6, z, f * 0.32, 0, 0)); B.woodDark.add(boxF(0.12, 0.12, 0.9, 'XxYyZz'), mat(x + s * 1.4, yt, z)); }
        bark.add(new THREE.CylinderGeometry(0.26, 0.28, 4.2, 7, 1, false).rotateZ(Math.PI / 2), mat(x, yt + 0.33, z));
        B.wood.add(boxF(1.6, 0.52, 0.02, 'Zz'), mat(x + 1.3, yt + 0.33, z));
        for (const s of [-1, 1]) B.woodDark.add(boxF(0.05, 1.55, 0.05, 'XxZz'), mat(x + 0.6, yt + 0.45, z + s * 0.44));        // the frame saw standing in its cut, blade turned across the frame
        B.woodDark.add(boxF(0.02, 1.45, 0.03, 'XxZz'), mat(x + 0.6, yt + 0.45, z)); for (const yy of [yt + 1.2, yt - 0.3]) B.woodDark.add(boxF(0.05, 0.05, 0.98, 'XxYy'), mat(x + 0.6, yy, z));
        for (let i = 0; i < 3; i++) B.wood.add(boxF(2.4, 0.05, 0.3, 'XxYZz'), mat(x - 0.2, g + 0.03 + i * 0.05, z + 0.55 - i * 0.02, 0, (R() - 0.5) * 0.05, 0));
        collide(rectOf(x - 2.15, z - 0.45, x + 2.15, z + 0.72));
        poi({ type: 'work', x: x + 0.7, z: z - 0.9, y: gy(x + 0.7, z - 0.9), ry: 0, note: 'sawing', _o: [x, z] });
        claim(r, 'harbourside');
      }
    }
    // the kitchen garden above the terraces, entered from the lane off the avenue
    { const A = rectOf(158.2, 386.2, 186.8, 397.8); if (clear(A)) { LOTS.garden(A, R, { entry: 'minX', acx: (A.minX + A.maxX) / 2, acz: (A.minZ + A.maxZ) / 2, W0: A.maxX - A.minX, D0: A.maxZ - A.minZ, alongX: true, inward: { minX: [1, 0], maxX: [-1, 0], minZ: [0, 1], maxZ: [0, -1] } }); claim(A, 'hgarden'); } }
    // block (1,5): a third shed on the lane that runs down to the apron, a garden beside it
    { const r = rectOf(193.2, 403.0, 201.2, 413.4); if (clear(r)) { const y = terrace(r, 0.22, 'minZ', [[199.4, 200.9]]); boatShed(197.2, 403.0, 413.4, 6.4, y, R, false, -1, 197.8); flight(199.4, 200.9, 413.4, y); netRack(199.8, 418.5, 0, 3.2, R, [-1]); } }
    { const A = rectOf(207.0, 403.2, 231.6, 419.0); if (clear(A)) { LOTS.garden(A, R, { entry: 'minX', acx: (A.minX + A.maxX) / 2, acz: (A.minZ + A.maxZ) / 2, W0: A.maxX - A.minX, D0: A.maxZ - A.minZ, alongX: true, inward: { minX: [1, 0], maxX: [-1, 0], minZ: [0, 1], maxZ: [0, -1] } }); claim(A, 'hgarden'); } }
    // block (2,5): an orchard and a garden on the slope above
    { const A = rectOf(238.4, 386.0, 256.8, 420.6); if (clear(A)) { LOTS.orchard(A, R, { entry: 'maxX', acx: (A.minX + A.maxX) / 2, acz: (A.minZ + A.maxZ) / 2, W0: A.maxX - A.minX, D0: A.maxZ - A.minZ }); claim(A, 'horchard'); } }
    // the shore under the quay wall: hulls on trestles being caulked, nets drying, a fire under a pitch pot
    for (const [x, z, ry] of [[212.2, 433.4, Math.PI / 2 + 0.06], [224.6, 432.4, -Math.PI / 2 - 0.05], [246.8, 432.6, Math.PI / 2 - 0.04]]) {
      const r = orect(x, z, Math.round(ry / (Math.PI / 2)) * Math.PI / 2, 1.8, 4.0); if (!clear(r)) continue;
      hull(x, gy(x, z) - 0.05, z, ry, R); poi({ type: 'work', x: x - Math.cos(ry) * 0 + 0, z: z + 1.7, y: gy(x, z + 1.7), ry: Math.PI, note: 'caulking', _o: [x, z] }); claim(r, 'shore');
    }
    for (const [x, z, ry, len] of [[218.4, 437.6, 0, 3.6], [231.2, 436.0, Math.PI / 2, 3.2], [252.0, 437.0, 0.08, 3.4]]) { const r = orect(x, z, 0, len / 2 + 0.8, 1.6); if (clear(r)) { netRack(x, z, ry, len, R); claim(r, 'shore'); } }
    { const x = 218.6, z = 429.6, r = rectOf(x, z, x, z, 1.2); if (clear(r)) { const g = gy(x, z); for (let i = 0; i < 4; i++) B.socles.add(T.rock, mat(x + Math.cos(i * 1.6) * 0.34, g + 0.06, z + Math.sin(i * 1.6) * 0.34, R(), R() * 3, R(), V(0.2, 0.13, 0.17))); terra.add(T.pot, mat(x, g + 0.2, z, 0, R(), 0, 1.5), 0x2e2822); small.add(T.disc, mat(x, g + 0.02, z, 0, 0, 0, 2.4), 0x3a3634); collide(rectOf(x, z, x, z, 0.5)); claim(r, 'shore'); } }
    L.addArea({ name: 'shore', note: 'boat yard under the quay', owner: OWN, minX: 207.0, maxX: 256.5, minZ: 427.5, maxZ: 439.6 });
    if (PLAT.length) world.extraGround.push((x, z) => {
      if (z < 380 || z > 442 || x < 148 || x > 280) return -Infinity;
      for (const p of PLAT) if (x > p.minX && x < p.maxX && z > p.minZ && z < p.maxZ) return p.y;
      return -Infinity;
    });
    stats.harbourside = { terraces: PLAT.length };
  }

  // ---------- over the whole town: shops first, then yards, facades and the empty lots ----------
  const p0 = L.pois.length, shopOf = new Map(), yardOf = new Map();
  // (development) triangles added by each stage; only when globalThis.RES_PROF is set, it walks every bucket
  const allB = [terra, paint, bark, clothB, wick, rub, ...Object.values(B)], trisNow = () => globalThis.RES_PROF ? allB.reduce((a, bk) => a + bk.list.reduce((s, g) => s + (g.index ? g.index.count : g.attributes.position.count) / 3, 0), 0) : 0;
  let tLast = trisNow(); const tphase = k => { if (!globalThis.RES_PROF) return; const t = trisNow(); (stats.tris = stats.tris || {})[k] = t - tLast; tLast = t; };
  for (const h of L.houses) {
    const R = rng(hash(h.k, h.m, h.lot.i, h.lot.j, 1)), blk = L.blockRect(h.k, h.m), sg = h.ry === 0 ? 1 : -1;
    let face = null, s = -1, edge = 0;
    if ((h.m === 0 && h.lot.j === 0 && h.ry !== 0) || (h.m === -1 && h.lot.j === 2 && h.ry === 0)) {
      const f = faceOf(h, 0), fz = f.P(0, 0)[1]; edge = f.nz > 0 ? blk.maxZ - fz : fz - blk.minZ;
      if (edge < 9 && R() < 0.85) { face = f; face.isHouse = true; s = 0; }
    }
    if (!face && ((h.k === -1 && h.lot.i === 1) || (h.k === 0 && h.lot.i === 0)) && R() < 0.75) {
      const wx = h.k === -1 ? 1 : -1, onWing = h.wing && (h.wing.x - h.x) * wx > 0; s = wx * sg > 0 ? 1 : 3;
      face = faceOf(onWing ? { x: h.wing.x, z: h.wing.z, w: h.wing.w, d: h.wing.d, h: h.wing.h, ry: h.ry } : h, s);
      const fx = face.P(0, 0)[0]; edge = wx > 0 ? blk.maxX - fx : fx - blk.minX;
      if (edge > 9) face = null;
    }
    if (face && edge >= 0.3) { const sh = shopfront(h, face, s, edge, R); if (sh) shopOf.set(h.id, sh); }
  }
  tphase('shops');
  for (const h of L.houses) {
    const R = rng(hash(h.k, h.m, h.lot.i, h.lot.j, 2)), shop = shopOf.get(h.id);
    if (R() > 0.43) continue;
    const lot = h.lot, blk = L.blockRect(h.k, h.m), sg = h.ry === 0 ? 1 : -1;
    const lim = { minX: lot.minX + (Math.abs(lot.minX - blk.minX) < 0.01 ? 0.4 : 0.6), maxX: lot.maxX - (Math.abs(lot.maxX - blk.maxX) < 0.01 ? 0.4 : 0.6), minZ: lot.minZ + (Math.abs(lot.minZ - blk.minZ) < 0.01 ? 0.4 : 0.6), maxZ: lot.maxZ - (Math.abs(lot.maxZ - blk.maxZ) < 0.01 ? 0.4 : 0.6) };
    const wingSide = h.wing ? ((h.wing.x - h.x) * sg > 0 ? 1 : 3) : -1, opts = [];
    for (const s of [0, 1, 2, 3]) {
      if ((shop && shop.s === s) || s === wingSide) continue;
      const f = faceOf(h, s), [u0, u1] = clipSpan(f, -f.len / 2, f.len / 2, lim);
      if (u1 - u0 < 4.2) continue;
      if (s === 0) { const du = (h.door.x - h.x) * sg; if (du - 1.2 < u0 || du + 1.2 > u1) continue; }
      let D = 0; while (D < 8.5 && inRect(f.rect(u0, u1, 0.05, D + 0.25), lim) && free(f.rect(u0, u1, 0.05, D + 0.25), h.id, 0.5)) D += 0.25;
      if (D >= (s === 0 ? 2.75 : 3.0)) opts.push({ s, u0, u1, D, w: [0.5, 0.35, 0.15, 0.35][s] });
    }
    if (!opts.length) continue;
    let q = R() * opts.reduce((a, o) => a + o.w, 0), o = opts[0];
    for (const c of opts) { q -= c.w; if (q <= 0) { o = c; break; } }
    const y = yard(h, o.s, o.u0, o.u1, Math.min(o.D, (o.s === 0 ? 2.75 : 3.0) + R() * 4.5), R);
    if (y) yardOf.set(h.id, y);
  }
  tphase('yards');
  for (const h of L.houses) facade(h, rng(hash(h.k, h.m, h.lot.i, h.lot.j, 3)), yardOf.get(h.id), shopOf.get(h.id));
  tphase('facades');
  for (const h of L.houses) if (h.wing) { const R = rng(hash(h.k, h.m, h.lot.i, h.lot.j, 5)); if (R() < (Math.min(Math.abs(h.z - 64), Math.abs(h.x - 145)) < 100 ? 0.12 : 0.04)) upperRoom(h, R); }
  tphase('upper');
  harbourQuarter(rng(hash(7, 5, 0, 1, 6)));
  tphase('harbourside');
  for (const lot of L.lots) if (lot.state === 'empty' && !L.isReserved(lot, 0.5)) emptyLot(lot, rng(hash(lot.k, lot.m, lot.i, lot.j, 4)));
  tphase('lots');

  // ---------- walkable steps, POIs that must stand on free ground, colliders, meshes ----------
  if (steps.length) {
    const SG = grid(); for (const s of steps) SG.add({ ...s, minX: s.minX - 0.02, maxX: s.maxX + 0.02, minZ: s.minZ - 0.02, maxZ: s.maxZ + 0.02 });      // (overlapping a little: no seam of bare ground between two treads)
    world.extraGround.push((x, z) => { const s = SG.at(x, z); if (!s) return -Infinity; if (s.flat !== undefined) return s.flat; const k = Math.floor(((x - s.px) * s.nx + (z - s.pz) * s.nz) / s.depth); return k >= 0 && k < s.n ? s.y0 - k * s.rise : -Infinity; });
  }
  const AG = grid(); for (const c of world.colliders) AG.add(c); for (const c of cols) AG.add(c);
  // where a person stands must be free ground inside the block: search a ring around the thing (or the spot) for the nearest free place
  const blockLim = (x, z, m = 0.35) => inset(L.blockRect(Math.floor((x - 145) / 45), Math.floor((z - 64) / 60)), m);
  const standable = (x, z, lim) => x > lim.minX && x < lim.maxX && z > lim.minZ && z < lim.maxZ && !AG.hit({ minX: x, maxX: x, minZ: z, maxZ: z }, 0.32);
  // and a person (0.28 m about) must be able to walk from it out of the block: one flood fill per block over a 0.3 m grid, from the streets inwards
  const RC = 0.3, RB = 0.28, reachMaps = new Map();
  const reachOf = (k, m) => {
    const key = (k + 64) * 256 + m + 64; let rm = reachMaps.get(key); if (rm) return rm;
    const b = L.blockRect(k, m), E = 1.5, x0 = b.minX - E, z0 = b.minZ - E, nx = Math.ceil((b.maxX - b.minX + 2 * E) / RC), nz = Math.ceil((b.maxZ - b.minZ + 2 * E) / RC), blk = new Uint8Array(nx * nz);
    AG.each({ minX: x0, maxX: x0 + nx * RC, minZ: z0, maxZ: z0 + nz * RC }, c => {
      const i0 = Math.max(0, Math.floor((c.minX - RB - x0) / RC - 0.5) + 1), i1 = Math.min(nx - 1, Math.ceil((c.maxX + RB - x0) / RC - 0.5) - 1);
      const j0 = Math.max(0, Math.floor((c.minZ - RB - z0) / RC - 0.5) + 1), j1 = Math.min(nz - 1, Math.ceil((c.maxZ + RB - z0) / RC - 0.5) - 1);
      for (let j = j0; j <= j1; j++) blk.fill(1, j * nx + i0, j * nx + i1 + 1);
    });
    const seen = new Uint8Array(nx * nz), q = new Int32Array(nx * nz); let qh = 0, qt = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = x0 + (i + 0.5) * RC, z = z0 + (j + 0.5) * RC, id = j * nx + i; if (!blk[id] && (x < b.minX - 0.3 || x > b.maxX + 0.3 || z < b.minZ - 0.3 || z > b.maxZ + 0.3)) { seen[id] = 1; q[qt++] = id; } }
    while (qh < qt) { const id = q[qh++], i = id % nx; for (const n of [i + 1 < nx ? id + 1 : -1, i > 0 ? id - 1 : -1, id + nx < nx * nz ? id + nx : -1, id - nx]) if (n >= 0 && !seen[n] && !blk[n]) { seen[n] = 1; q[qt++] = n; } }
    reachMaps.set(key, rm = { x0, z0, nx, nz, seen }); return rm;
  };
  const reaches = (x, z) => {
    const k = Math.floor((x - 145) / 45), m = Math.floor((z - 64) / 60), b = L.blockRect(k, m);
    if (x < b.minX - 0.3 || x > b.maxX + 0.3 || z < b.minZ - 0.3 || z > b.maxZ + 0.3) return true;
    const rm = reachOf(k, m), i = Math.floor((x - rm.x0) / RC), j = Math.floor((z - rm.z0) / RC);
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, c = j + dj; if (a >= 0 && c >= 0 && a < rm.nx && c < rm.nz && rm.seen[c * rm.nx + a]) return true; }
    return false;
  };
  const mine = L.pois.splice(p0);
  for (const p of mine) {
    const o = p._o; delete p._o;
    if (p.type === 'door') {
      if (AG.at(p.x, p.z) || !reaches(p.x, p.z)) {
        const d = [[0.4, 0], [0.8, 0], [1.2, 0], [0.6, 0.7], [0.6, -0.7], [1.2, 1.0], [1.2, -1.0]].find(([d, l]) => !AG.at(p.x + p.nx * d - p.nz * l, p.z + p.nz * d + p.nx * l) && reaches(p.x + p.nx * d - p.nz * l, p.z + p.nz * d + p.nx * l));
        if (d) { p.x += p.nx * d[0] - p.nz * d[1]; p.z += p.nz * d[0] + p.nx * d[1]; } else if (AG.at(p.x, p.z)) { stats.poiDropped = (stats.poiDropped || 0) + 1; continue; } else stats.doorsSealed = (stats.doorsSealed || 0) + 1;
      }
    } else if (p.type !== 'bench' && p.type !== 'seat') {
      const lim = blockLim(o ? o[0] : p.x, o ? o[1] : p.z, p.type === 'stall' || p.note === 'shop' ? -0.9 : 0.35);      // shopkeepers and their customers may stand at the edge of the platea or the avenue
      if (p.type === 'gather') { p.x = clamp(p.x, lim.minX + 0.25, lim.maxX - 0.25); p.z = clamp(p.z, lim.minZ + 0.25, lim.maxZ - 0.25); }
      if (!standable(p.x, p.z, lim) || !reaches(p.x, p.z)) {
        const cx = o ? o[0] : p.x, cz = o ? o[1] : p.z; let best = null;
        for (const rr of o ? [0.9, 1.15, 1.4, 1.7] : [0.5, 0.9, 1.4, 2.0]) for (let a = 0; a < 16; a++) {
          const x = cx + Math.sin(a / 16 * TAU) * rr, z = cz + Math.cos(a / 16 * TAU) * rr, d = Math.hypot(x - p.x, z - p.z) + rr * 0.5;
          if ((!best || d < best[0]) && standable(x, z, lim) && reaches(x, z)) best = [d, x, z];
        }
        if (!best) { (stats.poiSealed = stats.poiSealed || {})[p.type + ':' + (p.note || '')] = (stats.poiSealed[p.type + ':' + (p.note || '')] || 0) + 1; continue; }
        p.x = best[1]; p.z = best[2]; if (o && p.type !== 'stall') p.ry = Math.atan2(cx - p.x, cz - p.z);
      }
    }
    if (p.type !== 'bench' && p.type !== 'seat') p.y = world.groundHeight(p.x, p.z);
    L.pois.push(p);
  }
  world.colliders.push(...cols);
  L.stats.residential = stats;
  // cloth that stays matte: M.cloth takes its roughness from the plaster map, which gives awnings a glassy sheen against the sky at grazing angles
  const clothMat = ctx.setupMaterial(new THREE.MeshStandardMaterial({ map: M.cloth.map, normalMap: M.cloth.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), vertexColors: true, side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: 0.08 }));
  // the wicker atlas: thin twine would fade out of the alpha test in the smaller mip levels, so outside the leaf cell the alpha is raised with the level and,
  // further off, tested against a screen-space dither (a distant net thins to a haze instead of vanishing)
  const wickerMat = new THREE.MeshStandardMaterial({ map: wickerTexture(M.foliage?.map?.image), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, vertexColors: true, envMapIntensity: 0.3 });
  wickerMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `#ifdef USE_MAP
    if (vMapUv.y > ${(256 / AH).toFixed(5)} || vMapUv.x > 0.5) { vec2 ts = vec2(textureSize(map, 0)), ddx = dFdx(vMapUv * ts), ddy = dFdy(vMapUv * ts); float la = length(ddx), lb = length(ddy);
      float lod = max(log2(max(max(la, lb) / 4.0, min(la, lb))), 0.0), hsh = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
      diffuseColor.a = diffuseColor.a * (1.0 + lod * 0.3) >= mix(0.3 + 0.4 * hsh, 0.08 + 0.84 * hsh, clamp(lod - 1.5, 0.0, 1.0)) ? 1.0 : 0.0; }
    #endif
    #include <alphatest_fragment>`); };
  ctx.setupMaterial(wickerMat); wickerMat.customProgramCacheKey = () => 'residential-wicker-mipalpha';
  for (const [bk, m, sh] of [[terra, M.terracotta, true], [paint, M.painted, true], [bark, M.barkOlive, true], [clothB, clothMat, true], [wick, wickerMat, true], [rub, M.rubble, true]]) {
    const mesh = bk.mesh(m, sh); if (mesh) { mesh.name = OWN; ctx.G.add(mesh); }
  }
}
