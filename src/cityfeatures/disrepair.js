// Town feature: disrepair — the wear, repair and mess around the town houses (their walls and roofs weather in src/weather/).
// Neglected houses (high layout.houses[].wear) get weeds along the wall foot, fallen roof tiles and shards under the eaves, heaps
// of fallen mud brick and plaster, raking shores propping a bulging wall; a few houses are being mended (a ladder up to the eaves,
// stacks of fresh mud brick and new tiles, a mortar trough, scaffold poles); and many get a little ordinary mess: sweepings in a
// corner, a broken amphora, a cracked pithos rolled aside, firewood, a pile of stones, old tiles leaned against the wall.
// Runs last: everything built before it is rasterised into an occupancy grid so nothing lands on anybody else's things.
import * as THREE from 'three';
import { ColorBucket, box, lathe, mat, rng, lerp, clamp, TAU } from '../util.js';
import { terrainHeight } from '../terrain.js';

export const name = 'disrepair';
export function plan() {}

const OWN = 'disrepair';
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const hash = (...a) => { let h = 0x9e3779b9; for (const v of a) { h = Math.imul(h ^ (v | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; } return h >>> 0; };
const rectOf = (x0, z0, x1, z1, m = 0) => ({ minX: Math.min(x0, x1) - m, maxX: Math.max(x0, x1) + m, minZ: Math.min(z0, z1) - m, maxZ: Math.max(z0, z1) + m });
const ov = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
const pick = (R, a) => a[Math.floor(R() * a.length)];

// box keeping only some faces: f ⊂ 'XxYyZz' (upper case = + side)
function boxF(w, h, d, f = 'XxYyZz') {
  const g = box(w, h, d), src = g.index.array, idx = [];
  for (let i = 0; i < 6; i++) if (f.includes('XxYyZz'[i])) for (let k = 0; k < 6; k++) idx.push(src[i * 6 + k]);
  g.setIndex(idx); return g;
}
// a cylinder from a to b
function rod(a, b, r, segs = 5, r1 = r) {
  const A = V(...a), Bv = V(...b), len = A.distanceTo(Bv);
  const g = new THREE.CylinderGeometry(r1, r, len, segs, 1, false);
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), Bv.clone().sub(A).normalize()), V(1, 1, 1)));
  return g;
}
// a heap: a dome (radius 1, base at y = 0) pushed in and out, the same for vertices shared along the seam
function lumpy(seed, amt = 0.22) {
  const g = new THREE.SphereGeometry(1, 9, 4, 0, TAU, 0, Math.PI / 2), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = (hash(seed, Math.round(x * 500), Math.round(y * 500), Math.round(z * 500)) / 4294967296 - 0.5) * 2;
    const k = 1 + amt * n * (y > 0.01 ? 1 : 0.4);
    p.setXYZ(i, x * k, y > 0.01 ? y * (1 + amt * 0.6 * n) : 0, z * k);
  }
  g.computeVertexNormals(); return g;
}
// the faces of a house in its frame, door side = 0: u runs along the face, o outwards; M() turns local +z outwards and +x along u
function faceOf(h, s) {
  const sg = h.ry === 0 ? 1 : -1, w = h.w, d = h.d;
  const [cx, cz, tx, tz, nx, nz, a, len] = [[0, d / 2, 1, 0, 0, 1, 0, w], [w / 2, 0, 0, -1, 1, 0, Math.PI / 2, d], [0, -d / 2, -1, 0, 0, -1, Math.PI, w], [-w / 2, 0, 0, 1, -1, 0, -Math.PI / 2, d]][s];
  const P = (u, o) => [h.x + sg * (cx + tx * u + nx * o), h.z + sg * (cz + tz * u + nz * o)];
  return {
    s, len, nx: sg * nx, nz: sg * nz, ry: h.ry + a, P,
    M: (u, y, o, rx = 0, ra = 0, rz = 0, sc = 1) => { const p = P(u, o); return mat(p[0], y, p[1], 0, h.ry + a, 0).multiply(mat(0, 0, 0, rx, ra, rz, sc)); },
    W: (u, y, o) => { const p = P(u, o); return [p[0], y, p[1]]; },
    rect: (u0, u1, o0, o1) => { const p = P(u0, o0), q = P(u1, o1); return rectOf(p[0], p[1], q[0], q[1]); },
  };
}

// occupancy bits
const LOW = 1, HIGH = 2, KEEP = 4, COL = 8, MINE = 16;
const SOLID = LOW | KEEP | COL | MINE;

export function build(ctx) {
  const { M, world, layout: L, B } = ctx;
  const houses = L.houses;
  if (!houses.length) return;
  const gy = (x, z) => world.groundHeight(x, z);
  const terra = new ColorBucket(), paint = new ColorBucket(), leaf = new ColorBucket();
  const cols = [];
  const stats = { neglected: 0, repairs: 0, weeds: 0, tiles: 0, rubble: 0, shores: 0, ladders: 0, bricks: 0, tileStacks: 0, mortar: 0, poles: 0, sweepings: 0, amphorae: 0, pithoi: 0, firewood: 0, stones: 0, oldTiles: 0, sites: [] };
  const site = (kind, h, f, u) => { const [x, z] = f.P(u, 0); stats.sites.push({ kind, id: h.id, x: +x.toFixed(2), z: +z.toFixed(2), nx: f.nx, nz: f.nz }); };

  // ---------- occupancy: 0.25 m cells over the town ----------
  let X0 = Infinity, Z0 = Infinity, X1 = -Infinity, Z1 = -Infinity;
  for (const h of houses) { X0 = Math.min(X0, h.minX); Z0 = Math.min(Z0, h.minZ); X1 = Math.max(X1, h.maxX); Z1 = Math.max(Z1, h.maxZ); }
  X0 -= 8; Z0 -= 8; X1 += 8; Z1 += 8;
  const CS = 0.25, NX = Math.ceil((X1 - X0) / CS), NZ = Math.ceil((Z1 - Z0) / CS), occ = new Uint8Array(NX * NZ);
  const CC = 4, CX = Math.ceil((X1 - X0) / CC), CZ = Math.ceil((Z1 - Z0) / CC), near = new Uint8Array(CX * CZ);     // 4 m cells within ~6 m of a house
  const HG = new Map();      // house boxes (main and wing) in 16 m cells
  const hbox = [];
  for (const h of houses) {
    hbox.push({ minX: h.x - h.w / 2, maxX: h.x + h.w / 2, minZ: h.z - h.d / 2, maxZ: h.z + h.d / 2, id: h.id, main: true });
    if (h.wing) hbox.push({ minX: h.wing.x - h.wing.w / 2, maxX: h.wing.x + h.wing.w / 2, minZ: h.wing.z - h.wing.d / 2, maxZ: h.wing.z + h.wing.d / 2, id: h.id, main: false });
  }
  for (const b of hbox) {
    for (let i = Math.floor(b.minX / 16); i <= Math.floor(b.maxX / 16); i++) for (let j = Math.floor(b.minZ / 16); j <= Math.floor(b.maxZ / 16); j++) { const k = i * 4096 + j; let l = HG.get(k); if (!l) HG.set(k, l = []); l.push(b); }
    for (let i = Math.max(0, Math.floor((b.minX - 6 - X0) / CC)); i <= Math.min(CX - 1, Math.floor((b.maxX + 6 - X0) / CC)); i++) for (let j = Math.max(0, Math.floor((b.minZ - 6 - Z0) / CC)); j <= Math.min(CZ - 1, Math.floor((b.maxZ + 6 - Z0) / CC)); j++) near[j * CX + i] = 1;
  }
  const housesAt = (r, m, fn) => {
    const seen = new Set();
    for (let i = Math.floor((r.minX - m) / 16); i <= Math.floor((r.maxX + m) / 16); i++) for (let j = Math.floor((r.minZ - m) / 16); j <= Math.floor((r.maxZ + m) / 16); j++) {
      const l = HG.get(i * 4096 + j); if (l) for (const b of l) if (!seen.has(b) && ov(b, r, m)) { seen.add(b); if (fn(b)) return true; }
    }
    return false;
  };
  const cellRange = (r) => [Math.max(0, Math.floor((r.minX - X0) / CS)), Math.min(NX - 1, Math.floor((r.maxX - X0) / CS)), Math.max(0, Math.floor((r.minZ - Z0) / CS)), Math.min(NZ - 1, Math.floor((r.maxZ - Z0) / CS))];
  const mark = (r, bits) => { const [i0, i1, j0, j1] = cellRange(r); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) occ[j * NX + i] |= bits; };
  const test = (r, bits) => {
    if (r.minX < X0 || r.maxX > X1 || r.minZ < Z0 || r.maxZ > Z1) return false;
    const [i0, i1, j0, j1] = cellRange(r); for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (occ[j * NX + i] & bits) return false;
    return true;
  };

  // everything built so far: the features' own meshes and the shared buckets (minus the houses' own walls, socles, doors and roofs)
  const E = 0.12;
  const onHouse = (x0, x1, z0, z1) => housesAt({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, 0, b => x0 >= b.minX - E && x1 <= b.maxX + E && z0 >= b.minZ - E && z1 <= b.maxZ + E);
  const raster = (g, m) => {
    const p = g.attributes.position; if (!p) return;
    const idx = g.index ? g.index.array : null, n = idx ? idx.length : p.count, e = m && !m.equals(new THREE.Matrix4()) ? m.elements : null;
    const vx = [0, 0, 0], vy = [0, 0, 0], vz = [0, 0, 0];
    for (let t = 0; t + 2 < n; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = idx ? idx[t + k] : t + k; let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (e) { const X = e[0] * x + e[4] * y + e[8] * z + e[12], Y = e[1] * x + e[5] * y + e[9] * z + e[13], Z = e[2] * x + e[6] * y + e[10] * z + e[14]; x = X; y = Y; z = Z; }
        vx[k] = x; vy[k] = y; vz[k] = z;
      }
      const x0 = Math.min(vx[0], vx[1], vx[2]), x1 = Math.max(vx[0], vx[1], vx[2]), z0 = Math.min(vz[0], vz[1], vz[2]), z1 = Math.max(vz[0], vz[1], vz[2]);
      if (x1 - x0 > 6 || z1 - z0 > 6 || x1 < X0 || x0 > X1 || z1 < Z0 || z0 > Z1) continue;
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ci = Math.floor((cx - X0) / CC), cj = Math.floor((cz - Z0) / CC);
      if (ci < 0 || cj < 0 || ci >= CX || cj >= CZ || !near[cj * CX + ci]) continue;
      const y0 = Math.min(vy[0], vy[1], vy[2]), y1 = Math.max(vy[0], vy[1], vy[2]), g0 = terrainHeight(cx, cz);
      let bits = 0;
      if (y0 < g0 + 2.1 && y1 > g0 + 0.12) bits |= LOW;
      if (y1 > g0 + 2.1 && y0 < g0 + 3.6) bits |= HIGH;
      if (!bits || onHouse(x0, x1, z0, z1)) continue;
      mark({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, bits);
    }
  };
  ctx.G.updateMatrixWorld(true);
  ctx.G.traverse(o => { if (o.isMesh && o.geometry) { if (o.isInstancedMesh) { const im = new THREE.Matrix4(); for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); raster(o.geometry, im.premultiply(o.matrixWorld)); } } else raster(o.geometry, o.matrixWorld); } });
  for (const [k, b] of Object.entries(B)) if (k !== 'roofs') for (const g of b.list) raster(g, null);
  // everybody's colliders (not the houses' own), the doors and the places people stand
  const hk = new Set();
  for (const h of houses) {
    hk.add(`${h.x - (h.w / 2 + 0.3)},${h.x + (h.w / 2 + 0.3)},${h.z - (h.d / 2 + 0.3)},${h.z + (h.d / 2 + 0.3)}`);
    if (h.wing) hk.add(`${h.wing.x - h.wing.w / 2 - 0.3},${h.wing.x + h.wing.w / 2 + 0.3},${h.wing.z - h.wing.d / 2 - 0.3},${h.wing.z + h.wing.d / 2 + 0.3}`);
  }
  for (const c of world.colliders) if (!hk.has(`${c.minX},${c.maxX},${c.minZ},${c.maxZ}`) && c.maxX > X0 && c.minX < X1 && c.maxZ > Z0 && c.minZ < Z1) mark(c, COL);
  for (const h of houses) {     // 2.2 m in front of every house door
    const d = h.door, ex = d.nz !== 0 ? 1.1 : 0, ez = d.nx !== 0 ? 1.1 : 0;
    mark(rectOf(d.x - ex, d.z - ez, d.x + d.nx * 2.2 + ex, d.z + d.nz * 2.2 + ez), KEEP);
  }
  for (const p of L.pois) {
    if (p.x < X0 || p.x > X1 || p.z < Z0 || p.z > Z1) continue;
    if (p.type === 'door') mark(rectOf(p.x, p.z, p.x, p.z, 1.6), KEEP);
    else mark(rectOf(p.x, p.z, p.x, p.z, Math.min(0.9, Math.max(0.5, (p.r || 0.5) * 0.4))), KEEP);
  }

  // ---------- taking ground ----------
  const blockLim = new Map();
  const limOf = h => { const k = h.k * 4096 + h.m; let r = blockLim.get(k); if (!r) { const b = L.blockRect(h.k, h.m); blockLim.set(k, r = { minX: b.minX + 0.15, maxX: b.maxX - 0.15, minZ: b.minZ + 0.15, maxZ: b.maxZ - 0.15 }); } return r; };
  // footprint u0..u1 × o0..o1 on face f of house h; opts: bits to test, hi = [o0, o1] over which the upper band must be clear too,
  // clear = a walking strip that must stay open beyond it, col = add a collider
  function take(h, f, u0, u1, o0, o1, { bits = SOLID, hi = null, clear = 0, col = false, slope = 0.45 } = {}) {
    const r = f.rect(u0, u1, o0, o1), lim = limOf(h);
    if (r.minX < lim.minX || r.maxX > lim.maxX || r.minZ < lim.minZ || r.maxZ > lim.maxZ) return null;
    if (!test(r, bits)) return null;
    if (housesAt(r, 0.05, b => !(b.main && b.id === h.id))) return null;
    if (L.isReserved(r, 0.2)) return null;
    if (hi && !test(f.rect(u0, u1, hi[0], hi[1]), HIGH | MINE)) return null;
    if (clear) { const c = f.rect(u0 - 0.2, u1 + 0.2, o1, o1 + clear); if (!test(c, COL | MINE) || housesAt(c, 0, () => true)) return null; }
    const g = [gy(...f.P(u0, o0)), gy(...f.P(u1, o0)), gy(...f.P(u0, o1)), gy(...f.P(u1, o1))];
    if (Math.max(...g) - Math.min(...g) > slope) return null;
    mark(r, MINE | (hi ? HIGH : 0));
    if (col) cols.push({ ...r });
    return r;
  }
  // try footprints of half-width hw centred on u, then stepping away from it along the face
  function along(h, f, u, hw, o0, o1, opts, step = 0.5) {
    const lim = f.len / 2 - hw - 0.05;
    for (let k = 0; k < 14; k++) {
      const uc = u + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * step;
      if (Math.abs(uc) > lim) continue;
      if (take(h, f, uc - hw, uc + hw, o0, o1, opts)) return uc;
    }
    return null;
  }

  // ---------- templates ----------
  const TR = rng(5150);
  const T = {
    card2: (() => { const a = new THREE.PlaneGeometry(1, 1), b = new THREE.PlaneGeometry(1, 1).rotateY(Math.PI / 2); return [a, b]; })(),
    heaps: Array.from({ length: 5 }, (_, i) => lumpy(900 + i)),
    pan: boxF(0.36, 0.022, 0.46, 'XxYZz'),
    halfPan: boxF(0.36, 0.022, 0.22, 'XxYZz'),
    cover: new THREE.CylinderGeometry(0.085, 0.075, 0.44, 6, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2),     // half-round, axis along z, curved side up
    shard: new THREE.CylinderGeometry(1, 1, 1, 3),
    brick: boxF(0.35, 0.08, 0.35, 'XxYZz'),
    chunk: boxF(1, 1, 1, 'XxYZz'),
    rock: new THREE.OctahedronGeometry(1, 0),
    amph: lathe([[0.02, 0], [0.15, 0.22], [0.18, 0.42], [0.07, 0.64], [0.08, 0.76]], 7, 0, TAU * 0.68),
    pithos: lathe([[0.2, 0], [0.47, 0.4], [0.3, 1.04], [0.34, 1.12]], 9, 0, TAU * 0.74),
    basket: new THREE.CylinderGeometry(0.24, 0.19, 0.3, 7, 1, false),
  };
  // broken pots: the outer skin, and the same shrunk a little and turned inside out for the inner face
  const inner = (g, s) => { const c = g.clone().scale(s, 0.985, s), ix = c.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; } c.computeVertexNormals(); return c; };
  T.amphIn = inner(T.amph, 0.9); T.pithosIn = inner(T.pithos, 0.93);
  void TR;

  const DRY = [0xe0d088, 0xd4cc80, 0xe8d898, 0xc8c878, 0xdcc478, 0xbcc070];
  const CLAYB = [0xb8875a, 0xae7e52, 0xc29466, 0xa87a50];       // mud brick: straw-tempered clay (saturated: M.terracotta's grey map dulls it)
  const FRESH = [0xc8965e, 0xc09060, 0xd0a068, 0xbc8c58];
  const NEWTILE = [0xc8804f, 0xd08b5a, 0xc5895f, 0xbf7d55];
  const darker = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();
  const jitter = (c, R, a = 0.08) => new THREE.Color(c).multiplyScalar(1 + (R() - 0.5) * 2 * a).getHex();

  // ---------- pieces ----------
  // a tuft of dry grass and weeds at the wall foot
  function tuft(h, f, u, o, R, s = 1) {
    const w = (0.5 + R() * 0.5) * s, hg = (0.3 + R() * 0.38) * s;
    if (!take(h, f, u - 0.12, u + 0.12, o - 0.12, o + 0.12, { bits: SOLID })) return false;
    const [x, , z] = f.W(u, 0, o), y = gy(x, z), m = mat(x, y + hg * 0.42, z, 0, R() * TAU, 0, V(w, hg, w)), c = pick(R, DRY);
    leaf.add(T.card2[0], m, c); leaf.add(T.card2[1], m, jitter(c, R));
    if (R() < 0.3) {      // a dry seed stalk or two
      for (let q = 0; q < 1 + (R() < 0.5); q++) { const a = R() * TAU, hs = 0.45 + R() * 0.35; paint.add(rod([x, y, z], [x + Math.cos(a) * 0.08, y + hs, z + Math.sin(a) * 0.08], 0.008, 3), null, 0xb8a878); }
    }
    stats.weeds++; return true;
  }
  function weeds(h, f, R, n) {
    let u = (R() - 0.5) * (f.len - 1);
    for (let i = 0; i < n; i++) {
      if (R() < 0.35) u = (R() - 0.5) * (f.len - 1);                      // a new patch
      else u = clamp(u + (R() - 0.5) * 1.2, -f.len / 2 + 0.2, f.len / 2 - 0.2);
      tuft(h, f, u, 0.14 + R() * 0.3, R);
    }
  }
  // roof tiles fallen from the eaves: whole pans, broken halves, a cover tile, sherds
  function fallenTiles(h, f, R, n) {
    const u0 = (R() - 0.5) * (f.len - 2), rc = h.roof;
    let put = 0;
    for (let i = 0; i < n; i++) {
      const u = u0 + (R() - 0.5) * 2.2, o = 0.2 + R() * 1.1, kind = R();
      if (!take(h, f, u - 0.26, u + 0.26, o - 0.26, o + 0.26, { bits: SOLID, slope: 0.3 })) continue;
      const [x, , z] = f.W(u, 0, o), y = gy(x, z), c = jitter(darker(rc, 0.92), R), yaw = R() * TAU;
      if (kind < 0.3) terra.add(T.pan, mat(x, y + 0.03, z, (R() - 0.5) * 0.25, yaw, (R() - 0.5) * 0.25), c);
      else if (kind < 0.6) terra.add(T.halfPan, mat(x, y + 0.025, z, (R() - 0.5) * 0.3, yaw, (R() - 0.5) * 0.3), c);
      else if (kind < 0.75) terra.add(T.cover, mat(x, y - 0.005, z, 0, yaw, (R() - 0.5) * 0.2, V(1, 1, 0.5 + R() * 0.5)), c);
      for (let k = 0; k < 2 + Math.floor(R() * 4); k++) { const a = R() * TAU, r = R() * 0.3, s = 0.05 + R() * 0.08; terra.add(T.shard, mat(x + Math.cos(a) * r, gy(x, z) + 0.008, z + Math.sin(a) * r, (R() - 0.5) * 0.3, R() * TAU, 0, V(s, 0.02, s * (0.6 + R() * 0.6))), jitter(c, R)); }
      put++; stats.tiles++;
    }
    return put;
  }
  // a heap of fallen mud brick and plaster against the wall foot
  function rubble(h, f, R, big) {
    const Lh = big ? 0.8 + R() * 0.5 : 0.45 + R() * 0.3, D = big ? 0.7 + R() * 0.4 : 0.4 + R() * 0.25, H = big ? 0.35 + R() * 0.3 : 0.18 + R() * 0.14;
    const u = along(h, f, (R() - 0.5) * (f.len - 2 * Lh - 0.4), Lh, 0.07, D + 0.1, { bits: SOLID, col: H > 0.45, clear: H > 0.45 ? 0.8 : 0, slope: 0.35 }, 0.6);
    if (u === null) return false;
    const gs = [[0, 0.1], [-Lh * 0.8, 0.1], [Lh * 0.8, 0.1], [0, D * 0.8]].map(([du, o]) => gy(...f.P(u + du, o)));
    const y = Math.min(...gs) - 0.04, clay = pick(R, CLAYB);
    const Ht = H + Math.max(...gs) - y;
    terra.add(pick(R, T.heaps), f.M(u, y, 0.1, 0, 0, 0, V(Lh, Ht, D)), clay);
    const surf = (du, o) => y + Ht * Math.sqrt(Math.max(0, 1 - (du / Lh) ** 2 - ((o - 0.1) / D) ** 2));
    for (let k = 0; k < (big ? 7 : 3); k++) {        // brick lumps and plaster flakes on it and around it
      const du = (R() - 0.5) * 2 * Lh * 1.05, o = 0.15 + R() * D * 1.05, s = 0.12 + R() * 0.16, flake = R() < 0.4;
      const yy = Math.max(surf(du, o), gy(...f.P(u + du, o))) - 0.02;
      if (flake) terra.add(T.chunk, f.M(u + du, yy + 0.01, o, (R() - 0.5) * 0.8, R() * TAU, (R() - 0.5) * 0.8, V(s * 1.6, 0.025, s * 1.2)), jitter(h.plaster, R, 0.05));
      else terra.add(T.chunk, f.M(u + du, yy + 0.02, o, (R() - 0.5) * 0.9, R() * TAU, (R() - 0.5) * 0.9, V(s * 1.5, s * 0.55, s)), jitter(clay, R, 0.12));
    }
    if (R() < 0.6) { const du = (R() - 0.5) * Lh, o = 0.2 + R() * D * 0.6, s = 0.12 + R() * 0.1; B.socles.add(T.rock, f.M(u + du, surf(du, o) + s * 0.2, o, R() * 3, R() * 3, R() * 3, V(s * 1.3, s * 0.7, s))); }
    stats.rubble++; site('rubble', h, f, u); return true;
  }
  // a raking shore (or a pair) propping a bulging wall: sole plate on the ground, a board against the wall
  function shore(h, f, R) {
    const g0 = gy(...f.P(0, 0.2)), top = Math.min(h.y + h.h - 0.45, g0 + 3.0 + R() * 0.6) - g0;
    if (top < 2.7) return false;
    const reach = top * 0.55 + 0.25, pair = R() < 0.45, hw = pair ? 0.95 : 0.35;
    const u = along(h, f, (R() - 0.5) * (f.len - 3), hw, 0.07, reach + 0.5, { bits: SOLID, hi: [0.05, reach], clear: 0.9, col: true, slope: 0.5 }, 0.7);
    if (u === null) return false;
    const bk = R() < 0.6 ? B.woodDark : B.wood;
    for (const du of pair ? [-0.7, 0.7] : [0]) {
      const fx = u + du * (1 - 0.35), [x0, , z0] = f.W(fx, 0, reach), gf = gy(x0, z0);
      const a = [x0, gf + 0.06, z0], b = f.W(u + du, g0 + top - 0.15, 0.17);
      bk.add(rod(a, b, 0.075, 6, 0.065));
      B.woodDark.add(box(0.24, 1.3, 0.06), f.M(u + du, g0 + top - 0.3, 0.1));       // the wall plate the head bears on
      B.woodDark.add(box(0.3, 0.1, 0.7), f.M(fx, gf + 0.03, reach + 0.05, 0, (R() - 0.5) * 0.2));
      B.woodDark.add(new THREE.ConeGeometry(0.04, 0.35, 4), f.M(fx + 0.02, gf + 0.08, reach + 0.42, Math.PI - 0.3, 0, 0));     // a stake behind the foot
    }
    stats.shores++; site('shore', h, f, u); return true;
  }
  // a wooden ladder leaning up to the eaves
  function ladder(h, f, R, uHint) {
    const g0 = gy(...f.P(0, 1.2)), topY = h.y + h.h + 0.35, H = topY - g0;
    if (H < 2.5 || H > 7.8) return null;
    const oF = 0.55 + H * 0.26;
    const u = along(h, f, uHint ?? (R() - 0.5) * (f.len - 2), 0.3, 0.07, oF + 0.2, { bits: SOLID, hi: [0.4, oF], clear: 0.8, col: true, slope: 0.35 }, 0.5);
    if (u === null) return null;
    for (const s of [-1, 1]) {
      const [x0, , z0] = f.W(u + s * 0.22, 0, oF), a = [x0, gy(x0, z0), z0], b = f.W(u + s * 0.22, topY, 0.55);
      B.wood.add(rod(a, b, 0.035, 4, 0.03));
    }
    const [xa, , za] = f.W(u, 0, oF), ga = gy(xa, za);
    for (let t = 0.3; t < H - 0.1; t += 0.3) {
      const k = t / H, o = lerp(oF, 0.55, k), y = lerp(ga, topY, k);
      B.wood.add(rod(f.W(u - 0.22, y, o), f.W(u + 0.22, y, o), 0.018, 4));
    }
    stats.ladders++; site('ladder', h, f, u); return u;
  }
  // scaffold poles leaning against the wall
  function poles(h, f, R, u) {
    const g0 = gy(...f.P(u, 0.3)), n = 2 + (R() < 0.5), top = Math.min(h.y + h.h - 0.3, g0 + 3.3 + R() * 0.8) - g0, oF = 0.35 + top * 0.24;
    if (!take(h, f, u - 0.35, u + 0.35, 0.07, oF + 0.12, { bits: SOLID, hi: [0.07, oF] })) return 0;
    for (let i = 0; i < n; i++) {
      const du = (i - (n - 1) / 2) * 0.22, [x0, , z0] = f.W(u + du, 0, oF - (R() * 0.15));
      B.wood.add(rod([x0, gy(x0, z0) - 0.03, z0], f.W(u + du * 0.3 + (R() - 0.5) * 0.1, g0 + top + (R() - 0.5) * 0.3, 0.1), 0.055, 5, 0.045));
    }
    stats.poles++; return n;
  }
  // a stack of fresh mud bricks, with a few loose ones
  function bricks(h, f, R, uHint) {
    const nx = 2 + (R() < 0.6), nz = 2, nc = 4 + Math.floor(R() * 5), W = nx * 0.37, D = nz * 0.37;
    const u = along(h, f, uHint ?? (R() - 0.5) * (f.len - 2), W / 2 + 0.05, 0.25, 0.3 + D, { bits: SOLID, clear: 0.9, col: true, slope: 0.2 }, 0.5);
    if (u === null) return false;
    const y0 = Math.min(...[[-W / 2, 0.28], [W / 2, 0.28], [-W / 2, 0.28 + D], [W / 2, 0.28 + D]].map(([du, o]) => gy(...f.P(u + du, o)))) - 0.02;
    for (let c = 0; c < nc; c++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (c === nc - 1 && R() < 0.4) continue;
      const du = (i - (nx - 1) / 2) * 0.37 + (R() - 0.5) * 0.03, o = 0.28 + D / 2 + (j - (nz - 1) / 2) * 0.37 + (R() - 0.5) * 0.03;
      terra.add(T.brick, f.M(u + du, y0 + 0.04 + c * 0.083, o, 0, (R() - 0.5) * 0.06, 0), jitter(pick(R, FRESH), R, 0.05));
    }
    for (let k = 0; k < 2 + Math.floor(R() * 3); k++) {       // loose and broken ones at its foot
      const du = (R() - 0.5) * (W + 0.8), o = 0.3 + D + 0.1 + R() * 0.3;
      if (!take(h, f, u + du - 0.2, u + du + 0.2, o - 0.2, o + 0.2, { bits: SOLID })) continue;
      const [x, , z] = f.W(u + du, 0, o);
      terra.add(T.brick, mat(x, gy(x, z) + 0.035, z, (R() - 0.5) * 0.15, R() * TAU, (R() - 0.5) * 0.15, V(1, 1, R() < 0.4 ? 0.5 : 1)), jitter(pick(R, FRESH), R, 0.05));
    }
    stats.bricks++; site('bricks', h, f, u); return true;
  }
  // new roof tiles: two stacks of pans and a row of nested cover tiles
  function tileStack(h, f, R, uHint) {
    const u = along(h, f, uHint ?? (R() - 0.5) * (f.len - 2), 0.62, 0.2, 1.0, { bits: SOLID, clear: 0.9, col: true, slope: 0.2 }, 0.5);
    if (u === null) return false;
    const base = pick(R, NEWTILE);
    for (const du of [-0.24, 0.24]) {
      const n = 8 + Math.floor(R() * 9), [x, , z] = f.W(u + du, 0, 0.5), y0 = Math.min(gy(x, z), gy(...f.P(u + du, 0.25)), gy(...f.P(u + du, 0.75))) - 0.01;
      for (let i = 0; i < n; i++) terra.add(T.pan, f.M(u + du + (R() - 0.5) * 0.03, y0 + 0.012 + i * 0.026, 0.5 + (R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.08, 0), jitter(base, R, 0.06));
    }
    if (R() < 0.7) {    // cover tiles nested in a row, lying along the wall in front of the pans
      const n = 5 + Math.floor(R() * 5);
      for (let i = 0; i < n; i++) { const du = -0.45 + i * 0.1, [x, , z] = f.W(u + du, 0, 0.88); terra.add(T.cover, f.M(u + du, gy(x, z) - 0.01, 0.88, 0, Math.PI / 2, 0.35), jitter(base, R, 0.06)); }
    }
    stats.tileStacks++; site('tileStack', h, f, u); return true;
  }
  // a trough of mud mortar, a heap of wet mud, chopped straw, a basket
  function mortar(h, f, R, uHint) {
    const u = along(h, f, uHint ?? (R() - 0.5) * (f.len - 2), 0.85, 0.3, 1.25, { bits: SOLID, clear: 0.9, col: true, slope: 0.2 }, 0.5);
    if (u === null) return false;
    const g = Math.min(...[[-0.8, 0.3], [0.8, 0.3], [-0.8, 1.2], [0.8, 1.2]].map(([du, o]) => gy(...f.P(u + du, o)))) - 0.01;
    const ut = u - 0.2, ot = 0.62;
    // the trough: four planks and a floor, the mud in it
    B.wood.add(box(1.2, 0.05, 0.6), f.M(ut, g + 0.03, ot));
    for (const s of [-1, 1]) { B.wood.add(box(1.2, 0.26, 0.04), f.M(ut, g + 0.13, ot + s * 0.28)); B.wood.add(box(0.04, 0.26, 0.52), f.M(ut + s * 0.58, g + 0.13, ot)); }
    terra.add(boxF(1.12, 0.02, 0.52, 'Y'), f.M(ut, g + 0.2, ot), 0x6a4a30);
    terra.add(pick(R, T.heaps), f.M(ut + (R() - 0.5) * 0.4, g + 0.19, ot, 0, R() * 3, 0, V(0.3, 0.07, 0.18)), 0x70503a);
    // wet mud heaped against its end, chopped straw, a basket
    terra.add(pick(R, T.heaps), f.M(u + 0.55, g, 0.58, 0, R() * 3, 0, V(0.26, 0.24, 0.22)), 0x76543a);
    terra.add(pick(R, T.heaps), f.M(u - 0.3, g, 1.05, 0, R() * 3, 0, V(0.32, 0.1, 0.16)), 0xd8b060);
    terra.add(T.basket, f.M(u + 0.55, g + 0.15, 1.0, 0, R() * 3, 0), 0xa87c48);
    terra.add(boxF(0.4, 0.01, 0.34, 'Y').rotateY(0.4), f.M(u + 0.55, g + 0.301, 1.0), 0x70503a);
    stats.mortar++; site('mortar', h, f, u); return true;
  }
  // sweepings and rubbish heaped in a corner
  function sweepings(h, f, R) {
    const end = R() < 0.5 ? -1 : 1, w = 0.4 + R() * 0.35;
    const u = end * (f.len / 2 - w - 0.08);
    if (!take(h, f, u - w, u + w, 0.07, 0.15 + w * 1.4, { bits: SOLID, slope: 0.3 })) return false;
    const [x, , z] = f.W(u, 0, 0.15), y = gy(x, z) - 0.03;
    terra.add(pick(R, T.heaps), f.M(u, y, 0.15, 0, R() * 3, 0, V(w, 0.16 + R() * 0.14, w * 1.2)), pick(R, [0x8a7058, 0x7e6a54, 0x947a5e]));
    for (let k = 0; k < 4; k++) { const du = (R() - 0.5) * w * 1.6, o = 0.15 + R() * w, s = 0.04 + R() * 0.06, [sx, , sz] = f.W(u + du, 0, o); terra.add(T.shard, mat(sx, gy(sx, sz) + 0.04 + R() * 0.05, sz, (R() - 0.5) * 0.8, R() * TAU, (R() - 0.5) * 0.8, V(s, 0.018, s)), pick(R, [0xb4603c, 0xa85a3a, 0x9a5236, 0xd8ccb0])); }
    if (R() < 0.5) terra.add(pick(R, T.heaps), f.M(u + (R() - 0.5) * w, y + 0.02, 0.2 + w * 0.6, 0, R() * 3, 0, V(w * 0.5, 0.05, w * 0.4)), 0xc8a458);    // old straw
    stats.sweepings++; site('sweepings', h, f, u); return true;
  }
  // a broken amphora on its side, the sherds around it
  function amphora(h, f, R) {
    const u = (R() - 0.5) * (f.len - 1.5), o = 0.35 + R() * 0.3;
    if (!take(h, f, u - 0.5, u + 0.5, o - 0.35, o + 0.35, { bits: SOLID, slope: 0.25 })) return false;
    const [x, , z] = f.W(u, 0, o), y = gy(x, z), yaw = R() * TAU, roll = R() * TAU, c = pick(R, [0xb4603c, 0xa85a3a, 0xc27a50, 0xb86e48]);
    const m = mat(x, y + 0.16, z, 0, yaw, 0).multiply(mat(0, 0, 0, 0, 0, Math.PI / 2 + 0.08)).multiply(mat(0, -0.38, 0, 0, roll, 0));
    terra.add(T.amph, m, c); terra.add(T.amphIn, m, darker(c, 0.7));
    for (let k = 0; k < 4 + Math.floor(R() * 4); k++) { const a = R() * TAU, r = 0.2 + R() * 0.35, s = 0.05 + R() * 0.07; terra.add(T.shard, mat(x + Math.cos(a) * r, gy(x + Math.cos(a) * r, z + Math.sin(a) * r) + 0.01, z + Math.sin(a) * r, (R() - 0.5) * 0.3, R() * TAU, 0, V(s, 0.02, s * 0.8)), jitter(c, R)); }
    stats.amphorae++; return true;
  }
  // a cracked pithos rolled aside, a big piece of its wall beside it
  function pithos(h, f, R) {
    const u = (R() - 0.5) * (f.len - 2.5), o = 0.62;
    if (!take(h, f, u - 0.75, u + 0.75, 0.1, 1.25, { bits: SOLID, clear: 0.8, col: true, slope: 0.25 })) return false;
    const [x, , z] = f.W(u, 0, o), y = Math.min(gy(...f.P(u - 0.5, o)), gy(...f.P(u + 0.5, o))), c = pick(R, [0xb87048, 0xa86440, 0xc07e56]);
    const m = f.M(u, y + 0.4, o, 0, 0, Math.PI / 2 - 0.12).multiply(mat(0, -0.55, 0, 0, R() * TAU, 0));
    terra.add(T.pithos, m, c); terra.add(T.pithosIn, m, darker(c, 0.65));
    for (let k = 0; k < 3; k++) { const du = (R() - 0.5) * 1.2, oo = 0.95 + R() * 0.2, s = 0.1 + R() * 0.12, [sx, , sz] = f.W(u + du, 0, oo); terra.add(T.shard, mat(sx, gy(sx, sz) + 0.01, sz, (R() - 0.5) * 0.3, R() * TAU, 0, V(s, 0.035, s * 0.7)), jitter(c, R)); }
    void x; void z;
    stats.pithoi++; site('pithos', h, f, u); return true;
  }
  // firewood: a bundle of sticks along the wall, or brushwood leaned up against it
  function firewood(h, f, R) {
    const lean = R() < 0.45, hw = lean ? 0.5 : 0.8;
    const u = along(h, f, (R() - 0.5) * (f.len - 2), hw, 0.07, lean ? 0.55 : 0.6, { bits: SOLID, hi: lean ? [0.07, 0.5] : null, slope: 0.25 }, 0.6);
    if (u === null) return false;
    if (lean) {
      const g0 = gy(...f.P(u, 0.3));
      for (let k = 0; k < 9 + Math.floor(R() * 6); k++) { const du = (R() - 0.5) * 0.8, len = 1.3 + R() * 0.7, oF = 0.3 + R() * 0.2; (R() < 0.5 ? B.woodDark : B.wood).add(rod(f.W(u + du, g0 - 0.02, oF), f.W(u + du + (R() - 0.5) * 0.4, g0 + len, 0.08), 0.022 + R() * 0.015, 3)); }
    } else {
      const g0 = Math.min(gy(...f.P(u - 0.6, 0.35)), gy(...f.P(u + 0.6, 0.35)));
      let n = 0;
      for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) {
        const o = 0.2 + (i - (3 - r) / 2) * 0.1 + 0.15, y = g0 + 0.05 + r * 0.085, l = 1.0 + R() * 0.35, du = (R() - 0.5) * 0.2;
        (R() < 0.5 ? B.woodDark : B.wood).add(rod(f.W(u + du - l / 2, y, o), f.W(u + du + l / 2, y + (R() - 0.5) * 0.04, o + (R() - 0.5) * 0.06), 0.045 + R() * 0.015, 5)); n++;
      }
    }
    stats.firewood++; return true;
  }
  // a pile of building stone
  function stones(h, f, R) {
    const w = 0.4 + R() * 0.35, u = (R() - 0.5) * (f.len - 2 * w - 0.5), o = 0.15 + w;
    if (!take(h, f, u - w, u + w, 0.1, o + w, { bits: SOLID, slope: 0.3, col: w > 0.6, clear: w > 0.6 ? 0.8 : 0 })) return false;
    for (let k = 0; k < 5 + Math.floor(R() * 6); k++) {
      const du = (R() - 0.5) * w * 1.4, oo = o + (R() - 0.5) * w * 1.2, s = 0.13 + R() * 0.12, hgt = (1 - Math.hypot(du / w, (oo - o) / w) * 0.7) * w * 0.5;
      const [x, , z] = f.W(u + du, 0, oo);
      B.socles.add(T.rock, mat(x, gy(x, z) + Math.max(0, hgt) * R() + s * 0.25, z, R() * 3, R() * 3, R() * 3, V(s * 1.3, s * 0.7, s)));
    }
    stats.stones++; return true;
  }
  // old tiles saved from a roof, leaned against the wall
  function oldTiles(h, f, R) {
    const n = 3 + Math.floor(R() * 5), u = (R() - 0.5) * (f.len - 1.6), b = 0.3 + (R() - 0.5) * 0.1;
    if (!take(h, f, u - 0.24, u + 0.24, 0.07, 0.25 + n * 0.03, { bits: SOLID, slope: 0.25 })) return false;
    const c = darker(h.roof, 0.95), [x, , z] = f.W(u, 0, 0.2), y = gy(x, z);
    for (let i = 0; i < n; i++) {
      const ob = 0.08 + 0.46 * Math.sin(b) + i * 0.03;       // its foot; the top rests on the wall or on the tile before it
      terra.add(T.pan, f.M(u + (R() - 0.5) * 0.04, y - 0.01 + 0.23 * Math.cos(b), ob - 0.23 * Math.sin(b), -(Math.PI / 2 + b), (R() - 0.5) * 0.06, 0), jitter(c, R, 0.08));
    }
    stats.oldTiles++; return true;
  }

  // ---------- the houses ----------
  const order = [0, 1, 2, 3];
  for (const h of houses) {
    const R = rng(hash(h.id, 0xd15e, h.k, h.m)), w = h.wear ?? 0.3;
    const faces = order.map(s => faceOf(h, s));
    const shuffled = () => faces.slice().sort(() => R() - 0.5);
    const neglected = w > 0.78, worn = w > 0.45;
    // repairs in hand: roof (ladder, new tiles, poles) or wall (bricks, mortar, perhaps a ladder)
    if (R() < 0.022 + 0.05 * w) {
      const roof = R() < 0.55; let done = 0;
      for (const f of [faces[1], faces[3], faces[2], faces[0]]) {
        if (f.len < 5) continue;
        const u0 = (R() - 0.5) * (f.len - 4);
        if (roof) {
          const lu = ladder(h, f, R, u0);
          if (lu === null) continue;
          done++;
          tileStack(h, f, R, lu + 1.3) || tileStack(h, f, R, lu - 1.3);
          if (R() < 0.6) poles(h, f, R, lu + (R() < 0.5 ? -1.2 : 1.2));
          if (R() < 0.5) fallenTiles(h, f, R, 2);
        } else {
          if (!bricks(h, f, R, u0)) continue;
          done++;
          mortar(h, f, R, u0 + 1.6) || mortar(h, f, R, u0 - 1.6);
          if (R() < 0.5) ladder(h, f, R, u0 - 1.5); else if (R() < 0.6) poles(h, f, R, u0 - 1.2);
        }
        break;
      }
      if (done) stats.repairs++;
    }
    if (neglected) {
      stats.neglected++;
      const fs = shuffled();       // the big things first, the weeds grow round them
      if (R() < 0.35) for (const f of [faces[1], faces[3], faces[2]].sort(() => R() - 0.5)) if (shore(h, f, R)) break;
      if (R() < 0.6) rubble(h, fs[2], R, R() < 0.6) || rubble(h, fs[1], R, false);
      if (R() < 0.3) pithos(h, fs[3], R) || amphora(h, fs[3], R);
      if (R() < 0.8) fallenTiles(h, fs[0], R, 2 + Math.floor(R() * 4));
      if (R() < 0.4) fallenTiles(h, fs[1], R, 1 + Math.floor(R() * 3));
      for (let i = 0; i < 3; i++) weeds(h, fs[i], R, 3 + Math.floor(R() * 5));
    } else if (worn) {
      if (R() < 0.6) weeds(h, pick(R, faces), R, 1 + Math.floor(R() * 4));
      if (R() < 0.22) fallenTiles(h, pick(R, faces), R, 1 + Math.floor(R() * 2));
      if (R() < 0.08) rubble(h, pick(R, faces), R, false);
    } else if (R() < 0.2) weeds(h, pick(R, faces), R, 1 + Math.floor(R() * 2));
    // ordinary mess, one thing at most on most houses
    const nm = R() < 0.28 + 0.4 * w ? (neglected && R() < 0.6 ? 2 : 1) : 0;
    for (let i = 0; i < nm; i++) {
      const f = pick(R, faces), k = R();
      if (k < 0.24) sweepings(h, f, R);
      else if (k < 0.4) amphora(h, f, R);
      else if (k < 0.47) pithos(h, f, R);
      else if (k < 0.68) firewood(h, f, R);
      else if (k < 0.84) stones(h, f, R);
      else oldTiles(h, f, R);
    }
  }

  world.colliders.push(...cols);
  L.stats.disrepair = stats;
  for (const [bk, m] of [[terra, M.terracotta], [paint, M.painted], [leaf, M.foliage]]) {
    const mesh = bk.mesh(m, true); if (mesh) { mesh.name = OWN; ctx.G.add(mesh); }
  }
}
