// Town feature: the working harbour. Cargo on the quay (a shear-leg crane, gangplanks, amphora racks, bales,
// ropes), storehouses on the shore strips, the royal shipsheds under the palace (Vitruvius' "secret harbour"),
// fishermen's beaches and moored boats, walkable moles with beacon braziers, and a small shrine of Poseidon.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Bucket, ColorBucket, box, lathe, tx, mat, rng, lerp, clamp, smoothstep, TAU, ellipsoid, rectSweep, scaleUV } from '../util.js';
import { terrainHeight, slopeAt, SEA, flats } from '../terrain.js';
import { streetX, streetZ, GRID } from '../layout.js';
import { figureGeometry } from '../sculpture.js';

export const name = 'harbour';
const MOLE = [[240, 446], [252, 500], [246, 555], [222, 605]], MT = SEA + 2.5;
const MERCH = [-150, -88, -26, 36, 98], TRIR = [120, 146, 172, 198];
const ROOFC = [0xc8804f, 0xb8714a, 0xd08b5a, 0xa8654a, 0xc5895f];
const PLAST = [0xe8dcc4, 0xe6d3b0, 0xd9c7a3, 0xe9d9c0, 0xdcc39a, 0xefe3cd];
const CLAY = [0xb86a45, 0xc47a50, 0xa85f3c, 0xcf8f62, 0x9c5a3a, 0xbd7b55];
const SACK = [0xb08058, 0xa0744e, 0xb68a60, 0xa87a52, 0x9a6e4a], BALE = [0xac7c52, 0x9e704a, 0xb4865a, 0x946846];   // multiplied by the plaster map's grain
const BAND = [0x7a3a2a, 0x3d5670, 0x9a7a45, 0xb3a78e, 0x4f5c48, 0x6a4a34];
const ROPE = 0x7a6448, PITCH = 0x332d26, IRON = 0x3b3632, BRONZE = 0x6b4a2a, OAK = 0x7a5a3c;
// the low inlet north of the east quay (sand dipping under the sea beside the avenue's end) is filled with a paved apron
const APRON = { minX: 151, maxX: 206, minZ: 419.5, maxZ: 440.5 };

// height of the rendered terrain mesh (buildTerrainMesh's warped grid, linearly interpolated)
const SEG = 420, HALF = 1700, warp = t => HALF * (0.13 * t + 0.87 * t * t * t);
const unwarp = x => { let lo = -1, hi = 1; for (let i = 0; i < 44; i++) { const m = (lo + hi) / 2; if (warp(m) < x) lo = m; else hi = m; } return (lo + hi) / 2; };
const meshH = (x, z) => {
  const i = Math.floor((unwarp(x) + 1) / 2 * SEG), j = Math.floor((unwarp(z) + 1) / 2 * SEG);
  const x0 = warp(i / SEG * 2 - 1), x1 = warp((i + 1) / SEG * 2 - 1), z0 = warp(j / SEG * 2 - 1), z1 = warp((j + 1) / SEG * 2 - 1), s = (x - x0) / (x1 - x0), t = (z - z0) / (z1 - z0);
  const ha = terrainHeight(x0, z0), hb = terrainHeight(x1, z0), hc = terrainHeight(x0, z1), hd = terrainHeight(x1, z1);
  return s + t <= 1 ? ha + s * (hb - ha) + t * (hc - ha) : hd + (1 - s) * (hc - hd) + (1 - t) * (hb - hd);
};

// ---------- the palace road ----------
// From the avenue's end the quay's paved lane carries it east; past the quay's end it runs out on a low causeway, along the
// shore above the storehouses and up the flank of Zephyrion to a gate in the north wall of the palace terrace. Its surface is
// laid with a slight crossfall (never sinking into the slope), graded along, and held up by sandstone walls where it stands
// clear of the ground. Computed from the terrain alone, so plan() can keep houses and other sites off it.
const PAL = flats[4], GATE = { x: 503, z: PAL.cz - PAL.hd };   // the north wall of the palace terrace runs along z = 545
const PROAD = (() => {
  const ctrl = [[240, 444.3], [268, 444.6], [300, 445.3], [345, 448.4], [420, 448.8], [484, 518], [GATE.x - 2, 530], [GATE.x, GATE.z - 5.5]], rad = [40, 60, 60, 30, 60, 12], HW = 2.5;
  const P = [ctrl[0]];
  for (let i = 1; i < ctrl.length - 1; i++) {   // fillet each corner
    const a = ctrl[i - 1], b = ctrl[i], c = ctrl[i + 1], l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const u1 = [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1], u2 = [(c[0] - b[0]) / l2, (c[1] - b[1]) / l2], th = Math.acos(clamp(u1[0] * u2[0] + u1[1] * u2[1], -1, 1));
    if (th < 1e-3) { P.push(b); continue; }
    const t = Math.min(rad[i - 1] * Math.tan(th / 2), Math.min(l1, l2) * 0.48), rr = t / Math.tan(th / 2), sd = Math.sign(u1[0] * u2[1] - u1[1] * u2[0]);
    const p0 = [b[0] - u1[0] * t, b[1] - u1[1] * t], cen = [p0[0] - u1[1] * sd * rr, p0[1] + u1[0] * sd * rr], a0 = Math.atan2(p0[1] - cen[1], p0[0] - cen[0]), k = Math.max(2, Math.ceil(rr * th / 1.2));
    for (let j = 0; j <= k; j++) { const aa = a0 + sd * th * j / k; P.push([cen[0] + Math.cos(aa) * rr, cen[1] + Math.sin(aa) * rr]); }
  }
  P.push(ctrl[ctrl.length - 1]);
  const pts = [P[0]]; for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let j = 1; j <= n; j++) pts.push([lerp(a[0], b[0], j / n), lerp(a[1], b[1], j / n)]); }
  const N = pts.length, s = [0]; for (let i = 1; i < N; i++) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const nor = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N - 1, i + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l]; });
  const OFF = [-HW - 0.3, -HW / 2, 0, HW / 2, HW + 0.3], cf = [], gnd = (x, z) => Math.max(terrainHeight(x, z), meshH(x, z));
  const m = pts.map((p, i) => { const t = OFF.map(o => gnd(p[0] + nor[i][0] * o, p[1] + nor[i][1] * o)), c = clamp((t[4] - t[0]) / (2 * HW + 0.6), -0.08, 0.08) * smoothstep(3, 12, s[N - 1] - s[i]); cf.push(c); return Math.max(...t.map((h, k) => h + 0.05 - c * OFF[k])); });
  let y = m.slice();
  for (let it = 0; it < 3; it++) y = y.map((_, i) => { let a = 0, n = 0; for (let j = Math.max(0, i - 3); j <= Math.min(N - 1, i + 3); j++) { a += y[j]; n++; } return Math.max(m[i], a / n); });
  const Q = flats[2].level + 0.06; y = y.map((v, i) => Math.max(v, Q - 0.045 * s[i]));   // the causeway leaves the quay top at a gentle fall
  y = y.map((v, i) => s[N - 1] - s[i] < 14 ? Math.max(v, PAL.level + 0.02 - 0.17 * (s[N - 1] - s[i])) : v);   // and meets the gate's threshold
  // over the root of the east mole (city.js: a 9 m ashlar box along (240,446)→(252,500), top at MT) it rides clearly on the paving
  const ML = Math.hypot(12, 54), onRoot = (x, z, m = 1) => { const lx = x - 246, lz = z - 473; return Math.abs(lx * 12 + lz * 54) / ML < ML / 2 + 1 + m && Math.abs(-lx * 54 + lz * 12) / ML < 4.5 + m; };
  y = y.map((v, i) => { let w = v; for (const o of OFF) if (onRoot(pts[i][0] + nor[i][0] * o, pts[i][1] + nor[i][1] * o)) w = Math.max(w, MT + 0.035 - cf[i] * o); return w; });
  // grid of sample indices for fast lookups
  const cell = new Map(), C = 6; pts.forEach(([x, z], i) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const k = (Math.floor(x / C) + a) * 4096 + Math.floor(z / C) + b; let l = cell.get(k); if (!l) cell.set(k, l = []); l.push(i); } });
  // nearest centre-line sample: { i, d (lateral, signed along the normal), a (along), y (surface there) }
  const near = (x, z) => {
    const l = cell.get(Math.floor(x / C) * 4096 + Math.floor(z / C)); if (!l) return null; let best = null;
    for (const i of l) { if (i >= N - 1) continue; const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), px = ax + dx * t - x, pz = az + dz * t - z, d = Math.hypot(px, pz); if (!best || d < best.dist) best = { i, t, dist: d }; }
    if (!best) return null; const { i, t } = best, L = Math.sqrt((pts[i + 1][0] - pts[i][0]) ** 2 + (pts[i + 1][1] - pts[i][1]) ** 2), lat = ((x - pts[i][0]) * -(pts[i + 1][1] - pts[i][1]) + (z - pts[i][1]) * (pts[i + 1][0] - pts[i][0])) / L;
    return { i, t, dist: best.dist, lat, y: lerp(y[i], y[i + 1], t) + lerp(cf[i], cf[i + 1], t) * lat };
  };
  let bb = { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 }; for (const [x, z] of pts) bb = { minX: Math.min(bb.minX, x - 6), maxX: Math.max(bb.maxX, x + 6), minZ: Math.min(bb.minZ, z - 6), maxZ: Math.max(bb.maxZ, z + 6) };
  return { pts, s, nor, y, cf, HW, N, near, bb, onRoot, dist: (x, z) => { if (x < bb.minX - 20 || x > bb.maxX + 20 || z < bb.minZ - 20 || z > bb.maxZ + 20) return 1e9; const q = near(x, z); if (q) return q.dist; let d = 1e9; for (let i = 0; i < N; i += 2) d = Math.min(d, Math.hypot(pts[i][0] - x, pts[i][1] - z)); return d; } };
})();

export function plan(ctx) {
  ctx.layout.reserve(APRON, 'harbour', 'quay apron over the inlet');
  // the palace road, in short pieces (clear of the street centre lines it crosses, so those crossings stay open)
  const R_ = PROAD, onStreet = r => { for (let k = GRID.k0; k <= GRID.k1 + 1; k++) if (r.minX < streetX(k) + 1 && r.maxX > streetX(k) - 1) return true; for (let m = GRID.m0; m <= GRID.m1 + 1; m++) if (r.minZ < streetZ(m) + 1 && r.maxZ > streetZ(m) - 1) return true; return false; };
  for (let i = 0; i < R_.N - 1; i += 6) {
    const j = Math.min(R_.N - 1, i + 6), xs = [R_.pts[i][0], R_.pts[j][0]], zs = [R_.pts[i][1], R_.pts[j][1]], e = R_.HW + 0.25;
    const r = { minX: Math.min(...xs) - e, maxX: Math.max(...xs) + e, minZ: Math.min(...zs) - e, maxZ: Math.max(...zs) + e };
    if (!onStreet(r)) ctx.layout.reserve(r, 'harbour', 'palace road');
  }
}

// ---------- geometry helpers ----------
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function rod(p, q, r, segs = 5, rq = r) {
  const a = V(...p), b = V(...q), L = a.distanceTo(b) || 1e-3;
  const quat = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return new THREE.CylinderGeometry(rq, r, L, segs, 1, true).applyMatrix4(new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), quat, V(1, 1, 1)));
}
function frame(c, a, b) {   // local x along a, z along b (orthogonalised), y = their normal
  const A = V(...a).normalize(), B = V(...b); B.addScaledVector(A, -B.dot(A)).normalize();
  const N = V().crossVectors(B, A); if (N.y < 0) { N.negate(); B.negate(); }
  return new THREE.Matrix4().makeBasis(A, N, B).setPosition(c[0], c[1], c[2]);
}
function shear(g, s) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - s * p.getX(i)); g.computeVertexNormals(); return g; }
// gable roof (citykit's, with the ridge axis chosen): ridge along x when alongX, eaves at y = 0
function ridgeRoof(len, span, alongX, overhang = 0.6, pitch = 0.3) {
  const half = span / 2 + overhang, apex = half * pitch, L = Math.hypot(half, apex), b = new Bucket();
  for (const s of [-1, 1]) b.add(box(len + 2 * overhang, 0.14, L + 0.1), mat(0, apex / 2 + 0.07, s * half / 2, s * Math.atan2(apex, half), 0, 0));
  const g = b.build(); if (!alongX) g.rotateY(Math.PI / 2); return g;
}
function ridgeEnds(len, span, alongX, pitch = 0.3) {
  const half = span / 2, apex = (half + 0.6) * pitch, sh = new THREE.Shape([new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0), new THREE.Vector2(0, apex)]), b = new Bucket();
  for (const s of [-1, 1]) b.add(new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }), mat(s * len / 2 - s * 0.15, 0, 0, 0, Math.PI / 2, 0));
  const g = b.build(); if (!alongX) g.rotateY(Math.PI / 2); return g;
}
// geometry with a vertical colour ramp (for the flames): c0 at y0 → c1 at y1
function ramp2(g, y0, y1, c0, c1) {
  const p = g.attributes.position, col = new Float32Array(p.count * 3), A = new THREE.Color(c0), Bc = new THREE.Color(c1), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { c.copy(A).lerp(Bc, clamp((p.getY(i) - y0) / (y1 - y0), 0, 1)); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
function amphoraGeo(segs = 7, handles = true) {
  const b = new Bucket();
  b.add(lathe(handles ? [[0.012, 0], [0.05, 0.06], [0.12, 0.25], [0.168, 0.44], [0.16, 0.58], [0.08, 0.66], [0.05, 0.71], [0.05, 0.8], [0.03, 0.83]]
    : [[0.012, 0], [0.12, 0.25], [0.168, 0.44], [0.15, 0.6], [0.06, 0.69], [0.045, 0.83]], segs));   // stacked jars: a coarser profile
  if (handles) for (const s of [-1, 1]) b.add(new THREE.TorusGeometry(0.075, 0.016, 3, 4, Math.PI), mat(s * 0.075, 0.715, 0, 0, 0, -s * Math.PI / 2));
  return b.build();
}
// open boat hull, keel at y=0 amidships, bow +x: returns {outer, band, inner} geometries (also used by src/life/ships.js)
export function hullGeo(len, wid, dep, n = 12, m = 10) {
  const ring = (i, inset) => {
    const t = i / n * 2 - 1, w = Math.max(0.02, wid / 2 * Math.pow(Math.max(0, 1 - t * t), 0.55) - inset), sheer = dep + 0.22 * t * t * (t > 0 ? 1.5 : 1), d = dep * (1 - 0.38 * t * t) - inset;
    const A = [0, 0.13, 0.45, 0.85, 1.2, Math.PI / 2], pts = []; for (let j = 0; j <= m; j++) { const a = j <= m / 2 ? A[Math.round(j / (m / 2) * 5)] : Math.PI - A[Math.round((m - j) / (m / 2) * 5)]; pts.push([t * len / 2 * (1 - inset * 0.3), sheer - Math.max(0, d) * Math.pow(Math.sin(a), 0.75), -w * Math.cos(a)]); }
    return pts;
  };
  const grid = (inset, j0, j1, flip) => {
    const pos = [], idx = [], cols = j1 - j0 + 1;
    for (let i = 0; i <= n; i++) { const r = ring(i, inset); for (let j = j0; j <= j1; j++) pos.push(...r[j]); }
    for (let i = 0; i < n; i++) for (let j = 0; j < cols - 1; j++) { const a = i * cols + j, b = a + cols; if (flip) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  };
  // the winding that puts outer normals outward: keel vertex normal must point down
  const test = grid(0, 0, m, false), nrm = test.attributes.normal, keel = Math.floor(n / 2) * (m + 1) + Math.floor(m / 2), fl = nrm.getY(keel) > 0;
  const bandB = new Bucket(); bandB.add(grid(0, 0, 1, fl)); bandB.add(grid(0, m - 1, m, fl));
  const rim = []; for (let i = 0; i <= n; i++) { const o = ring(i, 0), q = ring(i, 0.05); rim.push(o[0], q[0], o[m], q[m]); }
  const rimB = new Bucket();
  for (const side of [0, 2]) { const pos = [], idx = []; for (let i = 0; i <= n; i++) { pos.push(...rim[i * 4 + side], ...rim[i * 4 + side + 1]); } for (let i = 0; i < n; i++) { const a = i * 2; if (side) idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); else idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); rimB.add(g); }
  const inner = new Bucket(); inner.add(grid(0.05, 0, m, !fl)); inner.add(rimB.build());
  return { outer: grid(0, 1, m - 1, fl), band: bandB.build(), inner: inner.build() };
}


export function build(ctx) {
  const { M, world, layout, B, G } = ctx;
  let Rs = rng(4411); const R = () => Rs(), own = 'harbour';
  const agoraL = flats[2].level, Q = agoraL + 0.06;
  const H = terrainHeight;
  const tc = new ColorBucket(), pt = new ColorBucket(), cl = tc, netB = new Bucket();   // cl: sacks, bales, thatch — textured   // sacks and bales in plain linen tones (the cloth texture tinted them green)
  // flames keep their per-vertex colour ramp, which the shared buckets would strip
  const fireB = { list: [], add(g, m) { const c = g.clone(); if (m) c.applyMatrix4(m); c.clearGroups(); this.list.push(c); }, mesh(material) { if (!this.list.length) return null; const mm = new THREE.Mesh(mergeGeometries(this.list, false), material); mm.castShadow = false; return mm; } };
  const pick = a => a[Math.floor(R() * a.length)];
  const ov = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
  const rect = (x0, x1, z0, z1) => ({ minX: Math.min(x0, x1), maxX: Math.max(x0, x1), minZ: Math.min(z0, z1), maxZ: Math.max(z0, z1) });
  const collide = r => { world.colliders.push({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ }); return r; };
  const poi = p => layout.addPoi({ owner: own, ...p });
  // collider for a rectangle turned to (ax, az): half-length ha along it, half-width hb across, cut into AABB slices
  const ocollide = (x, z, ax, az, ha, hb, step = 0.9) => { const n = Math.max(1, Math.ceil(ha / step)); for (let i = 0; i < n; i++) { const o = -ha + (i + 0.5) * 2 * ha / n, cx = x + ax * o, cz = z + az * o, hx = Math.abs(ax) * ha / n + Math.abs(az) * hb, hz = Math.abs(az) * ha / n + Math.abs(ax) * hb; collide(rect(cx - hx, cx + hx, cz - hz, cz + hz)); } };
  const face = (dx, dz) => Math.atan2(dx, dz);   // ry for a figure (faces +Z at ry = 0) looking along (dx, dz)

  // ---------- placement checks ----------
  const roadD = (x, z) => PROAD.dist(x, z);
  const rectRoadD = r => { let d = 1e9; const ni = Math.ceil((r.maxX - r.minX) / 1.5), nj = Math.ceil((r.maxZ - r.minZ) / 1.5); for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) d = Math.min(d, roadD(lerp(r.minX, r.maxX, i / ni), lerp(r.minZ, r.maxZ, j / nj))); return d; };
  // street centre lines that are open where they run through the harbour strips stay clear (±1.3 m)
  const bands = [];
  for (let k = GRID.k0; k <= GRID.k1 + 1; k++) for (let m = GRID.m0; m <= GRID.m1 + 1; m++) {
    const x = streetX(k), z = streetZ(m), ends = [];
    if (m <= GRID.m1) ends.push([x, streetZ(m + 1)]); if (k <= GRID.k1) ends.push([streetX(k + 1), z]);
    for (const [x2, z2] of ends) {
      if (Math.max(z, z2) < 440 || Math.max(Math.abs(x), Math.abs(x2)) < 225) continue;
      let open = true; const n = Math.max(2, Math.ceil(Math.hypot(x2 - x, z2 - z) / 2));
      for (let s = 0; s <= n && open; s++) { const px = lerp(x, x2, s / n), pz = lerp(z, z2, s / n); if (H(px, pz) < SEA + 1.5 || slopeAt(px, pz) > 0.6 || world.blocked(px, pz)) open = false; }
      if (open) bands.push(rect(x - 1.3, x2 + 1.3, z - 1.3, z2 + 1.3));
    }
  }
  const hitsCollider = (r, m = 0) => { for (const c of world.colliders) if (ov(c, r, m)) return true; return false; };
  const free = (r, road = 4.4, m = 0.1) => !layout.reserved.some(q => q.owner !== own && ov(q, r, 0.3)) && !layout.housesIn(r, 0.5).length && !hitsCollider(r, m) && !bands.some(b => ov(b, r)) && rectRoadD(r) > Math.min(road, 4.4);
  const inLane = r => r.minX < 240 && r.maxX > -240 && r.maxZ > 443 && r.minZ < 447;

  // ---------- the palace road: the earth surface, retaining walls and parapets, and the gate in the palace terrace ----------
  const roadMesh = new Bucket();
  {
    const { pts, nor, y, cf, HW, N, s, near, bb } = PROAD, pos = [], uv = [], idx = [];
    const edgeY = (i, sd) => y[i] + cf[i] * sd * HW, at = (i, o) => [pts[i][0] + nor[i][0] * o, pts[i][1] + nor[i][1] * o];
    for (let i = 0; i < N; i++) { for (const sd of [-1, 1]) { const [x, z] = at(i, sd * (HW + 0.06)); pos.push(x, edgeY(i, sd) + 0.02, z); uv.push(s[i], (sd + 1) * HW); } if (i) { const a = (i - 1) * 2, b = i * 2; idx.push(a, b, a + 1, a + 1, b, b + 1); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { g.setIndex(idx.map((v, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); g.computeVertexNormals(); }
    roadMesh.add(g);
    layout.roads.push({ pts: pts.filter((_, i) => i % 4 === 0 || i === N - 1), width: 2 * HW, owner: own, note: 'palace road' });
    // (its first stretch, from the avenue's end along the quay's walking lane to the causeway, is the quay's own paving)
    layout.roads.push({ pts: [[145, 442], [149, 445], [236, 445], [240, 444.3]], width: 4, owner: own, note: 'palace road (quay)', paved: true });
    // retaining walls wherever the edge stands clear of the ground: one continuous wall per run (short gaps closed, stubs dropped),
    // its coping rising smoothly into a 0.5 m parapet where the drop passes 0.6–1 m, both ends of a run sloping down into the ground
    const gnd = (x, z) => Math.min(H(x, z), meshH(x, z));
    const sheet = (rows, want, bucket, across = false) => {   // quad strip through [p, q, u] rows, faces turned towards want(k); metric UVs
      const pos = [], uvs = [], idx = []; let dot = 0;
      rows.forEach(([p, q, u], k) => {
        pos.push(...p, ...q); if (across) uvs.push(u, 0, u, Math.hypot(q[0] - p[0], q[2] - p[2])); else uvs.push(u, p[1], u, q[1]);
        if (!k) return; const a = (k - 1) * 2, b = k * 2, P0 = rows[k - 1][0], e1 = [p[0] - P0[0], p[1] - P0[1], p[2] - P0[2]], e2 = [rows[k - 1][1][0] - P0[0], rows[k - 1][1][1] - P0[1], rows[k - 1][1][2] - P0[2]], w = want(k);
        idx.push(a, b, a + 1, a + 1, b, b + 1); dot += (e1[1] * e2[2] - e1[2] * e2[1]) * w[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * w[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * w[2];
      });
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(dot < 0 ? idx.map((v, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]]) : idx); g.computeVertexNormals(); bucket.add(g);
    };
    const morph = (a, r, erode) => a.map((_, k) => { let v = erode; for (let j = Math.max(0, k - r); j <= Math.min(N - 1, k + r); j++) v = erode ? v && a[j] : v || a[j]; return v; });
    // (fractional sample positions, so a wall can end exactly against a flight of steps)
    const lin = (arr, k) => { const i = clamp(Math.floor(k), 0, N - 2), f = k - i; return arr[i] + (arr[i + 1] - arr[i]) * f; };
    const norF = k => { const i = clamp(Math.floor(k), 0, N - 2), f = k - i, nx = lerp(nor[i][0], nor[i + 1][0], f), nz = lerp(nor[i][1], nor[i + 1][1], f), l = Math.hypot(nx, nz); return [nx / l, nz / l]; };
    const atF = (k, o) => { const i = clamp(Math.floor(k), 0, N - 2), f = k - i, n = norF(k); return [lerp(pts[i][0], pts[i + 1][0], f) + n[0] * o, lerp(pts[i][1], pts[i + 1][1], f) + n[1] * o]; };
    const edgeF = (k, sd) => lin(y, k) + lin(cf, k) * sd * HW;
    for (const sd of [-1, 1]) {
      const low = [], drop = [], skip = [];
      for (let k = 0; k < N; k++) { let lk = 1e9; for (const o of [HW, HW + 0.25, HW + 0.55]) lk = Math.min(lk, gnd(...at(k, sd * o))); const [cx, cz] = at(k, sd * (HW + 0.25)); low.push(lk); drop.push(edgeY(k, sd) - lk); skip.push(PROAD.onRoot(cx, cz, 0)); }   // the root of the east mole stands there
      let on = morph(morph(drop.map((d, k) => !skip[k] && d > 0.18), 2, false), 2, true); on = morph(morph(on, 1, true), 1, false).map((v, k) => v && !skip[k]);
      let dS = drop.map((_, k) => { let m = -1e9; for (let j = Math.max(0, k - 3); j <= Math.min(N - 1, k + 3); j++) m = Math.max(m, drop[j]); return m; });
      for (let it = 0; it < 3; it++) dS = dS.map((_, k) => { let a = 0, n = 0; for (let j = Math.max(0, k - 2); j <= Math.min(N - 1, k + 2); j++) { a += dS[j]; n++; } return a / n; });
      const par = dS.map(d => 0.5 * smoothstep(0.6, 1.0, d)), col = dS.map((d, k) => d > 0.7 || drop[k] > 0.75);
      // where an open street comes up to the road over a high wall: a flight of steps along the street between two sloping cheeks
      const cut = new Array(N).fill(false), stairs = [];
      for (const band of bands) {
        const ew = band.maxX - band.minX > band.maxZ - band.minZ, c = ew ? (band.minZ + band.maxZ) / 2 : (band.minX + band.maxX) / 2, e0 = ew ? band.minX + 1.3 : band.minZ + 1.3, e1 = ew ? band.maxX - 1.3 : band.maxZ - 1.3;
        for (let k = 0; k < N - 1; k++) {
          const p0 = at(k, sd * (HW + 0.25)), p1 = at(k + 1, sd * (HW + 0.25)), a0 = ew ? p0[1] : p0[0], a1 = ew ? p1[1] : p1[0];
          if ((a0 - c) * (a1 - c) > 0 || a0 === a1) continue;
          const kf = k + (c - a0) / (a1 - a0), [cx, cz] = atF(kf, sd * (HW + 0.25)), along = ew ? cx : cz, kr = Math.round(kf);
          if (along < e0 || along > e1 || !on[kr] || skip[kr] || drop[kr] < 0.5) continue;
          const Nn = norF(kf).map(v => v * sd), T = [Nn[1], -Nn[0]], D = ew ? [Math.sign(Nn[0]), 0] : [0, Math.sign(Nn[1])], dn_ = D[0] * Nn[0] + D[1] * Nn[1];
          if (dn_ < 0.4) continue;
          const det = T[0] * D[1] - T[1] * D[0], cr = Math.abs(det), wu = 3.0 / cr, cw = 0.45 / cr, wE = -0.25 / dn_, tr = 0.42, yTop = edgeF(kf, sd) - 0.04, yC = edgeF(kf, sd) + lin(par, kf) + 0.1;
          const gT = sd * (edgeF(Math.min(N - 1, kf + 0.5), sd) - edgeF(Math.max(0, kf - 0.5), sd)) / (lin(s, Math.min(N - 1, kf + 0.5)) - lin(s, Math.max(0, kf - 0.5))), sw = Math.abs(gT) * (wu / 2 + cw);   // the treads follow the road's grade across
          const W2 = (u, w) => [cx + T[0] * u + D[0] * w, cz + T[1] * u + D[1] * w], basis = (u, yv, w) => new THREE.Matrix4().set(T[0], 0, D[0], cx + T[0] * u + D[0] * w, 0, 1, 0, yv, T[1], 0, D[1], cz + T[1] * u + D[1] * w, 0, 0, 0, 1);
          let n = 1, gF = yTop; for (let it = 0; it < 4; it++) { const w = wE + n * tr + 0.3; gF = Math.min(...[-1, 0, 1].map(q => gnd(...W2(q * wu / 2, w)) - gT * q * wu / 2)); n = Math.max(1, Math.ceil((yTop - gF) / 0.3)); }
          const rise = (yTop - gF) / n;
          for (let i = 0; i < n; i++) { const top = yTop - (i + 1) * rise, bot = gF - 0.5 - sw, w0 = wE + i * tr - (i ? 0 : 0.35), w1 = wE + (i + 1) * tr + 0.01; B.socles.add(shear(box(wu, top - bot, w1 - w0), -gT), basis(0, (top + bot) / 2, (w0 + w1) / 2)); }
          for (const sg of [-1, 1]) {
            const u0 = sg * (wu / 2 + cw / 2), len = n * tr + 0.35, h0 = yC - gF + 0.5 + sw, g = box(cw, h0, len), p = g.attributes.position;
            for (let q = 0; q < p.count; q++) p.setY(q, (p.getY(q) > 0 ? lerp(yC, gF + 0.45, (p.getZ(q) + len / 2) / len) : gF - 0.5 - sw) + gT * (u0 + p.getX(q)));
            g.computeVertexNormals(); B.socles.add(g, basis(u0, 0, wE - 0.35 + len / 2));
            for (let w = wE + 0.2; w < wE + n * tr - 0.01; w += 0.5) { const cs = [W2(u0 - cw / 2, w), W2(u0 + cw / 2, w), W2(u0 - cw / 2, Math.min(w + 0.5, wE + n * tr)), W2(u0 + cw / 2, Math.min(w + 0.5, wE + n * tr))]; collide(rect(Math.min(...cs.map(q => q[0])), Math.max(...cs.map(q => q[0])), Math.min(...cs.map(q => q[1])), Math.max(...cs.map(q => q[1])))); }
          }
          const cs = [W2(-wu / 2, wE), W2(wu / 2, wE), W2(-wu / 2, wE + n * tr), W2(wu / 2, wE + n * tr)], sb = rect(Math.min(...cs.map(q => q[0])), Math.max(...cs.map(q => q[0])), Math.min(...cs.map(q => q[1])), Math.max(...cs.map(q => q[1])));
          world.extraGround.push((x, z) => { if (x < sb.minX || x > sb.maxX || z < sb.minZ || z > sb.maxZ) return -Infinity; const dx = x - cx, dz = z - cz, u = (dx * D[1] - dz * D[0]) / det, w = (T[0] * dz - T[1] * dx) / det; return Math.abs(u) > wu / 2 || w < wE || w >= wE + n * tr ? -Infinity : yTop + gT * u - (Math.floor((w - wE) / tr) + 1) * rise; });
          const uOf = kk => { const [px, pz] = atF(kk, sd * (HW + 0.25)); return ((px - cx) * D[1] - (pz - cz) * D[0]) / det; }, lim = wu / 2 + cw / 2;
          for (let j = 0; j < N; j++) if (Math.abs(uOf(j)) < wu / 2 + cw) cut[j] = true;
          stairs.push({ uOf, lim });
        }
      }
      // the wall end against a stair's cheek: the fractional sample between j0 (outside) and j1 (cut) where |u| = lim
      const endAt = (j0, j1) => { const st = stairs.find(q => Math.abs(q.uOf(j1)) < q.lim + 0.45 / 0.3); if (!st) return null; let lo = j0, hi = j1; for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (Math.abs(st.uOf(m)) > st.lim) lo = m; else hi = m; } return lo; };
      for (let a = 0; a < N; a++) {
        if (!on[a] || cut[a]) continue; let b = a; while (b + 1 < N && on[b + 1] && !cut[b + 1]) b++;
        if (b - a < 8 && Math.max(...drop.slice(a, b + 1)) < 0.3 && !(a > 0 && cut[a - 1]) && !(b < N - 1 && cut[b + 1])) { a = b; continue; }   // a short, barely raised stretch needs no wall
        const sec = k => ({ k, top: edgeF(k, sd) + lin(par, k), bot: Math.min(lin(low, Math.max(0, k - 1)), lin(low, k), lin(low, Math.min(N - 1, k + 1))) - 0.4, core: true });
        const secs = []; for (let k = a; k <= b; k++) secs.push(sec(k));
        for (const [k, j] of [[a - 1, a], [b + 1, b]]) {
          if (k < 0 || k >= N) continue;
          if (cut[k]) { const kk = endAt(j, k); if (kk !== null) secs[k < a ? 'unshift' : 'push'](sec(kk)); }
          else if (!skip[k]) { const t = gnd(...at(k, sd * (HW + 0.25))) - 0.03; secs[k < a ? 'unshift' : 'push']({ k, top: t, bot: Math.min(low[k], t) - 0.5 }); }   // sloped ends
        }
        const P = (k, o, yy) => { const [x, z] = atF(k, sd * o); return [x, yy, z]; }, out = k => { const n = norF(k); return [sd * n[0], 0, sd * n[1]]; }, inn = k => { const n = norF(k); return [-sd * n[0], 0, -sd * n[1]]; }, up = () => [0, 1, 0], dn = () => [0, -1, 0];
        const R_ = f => secs.map(({ k, top, bot }) => [...f(k, top, bot), lin(s, k)]), K = i => secs[i].k;
        sheet(R_((k, t, b_) => [P(k, HW, b_), P(k, HW, t)]), i => inn(K(i)), B.socles);
        sheet(R_((k, t, b_) => [P(k, HW + 0.5, b_), P(k, HW + 0.5, t)]), i => out(K(i)), B.socles);
        sheet(R_((k, t) => [P(k, HW - 0.04, t + 0.1), P(k, HW + 0.54, t + 0.1)]), up, B.ashlar, true);
        sheet(R_((k, t) => [P(k, HW - 0.04, t), P(k, HW - 0.04, t + 0.1)]), i => inn(K(i)), B.ashlar);
        sheet(R_((k, t) => [P(k, HW + 0.54, t), P(k, HW + 0.54, t + 0.1)]), i => out(K(i)), B.ashlar);
        sheet(R_((k, t) => [P(k, HW - 0.04, t), P(k, HW, t)]), dn, B.ashlar, true); sheet(R_((k, t) => [P(k, HW + 0.5, t), P(k, HW + 0.54, t)]), dn, B.ashlar, true);
        for (const [e, sg] of [[secs[0], -1], [secs[secs.length - 1], 1]]) {   // end faces
          const n = norF(e.k), tg = [sg * n[1], 0, -sg * n[0]];
          sheet([[P(e.k, HW, e.bot), P(e.k, HW, e.top), 0], [P(e.k, HW + 0.5, e.bot), P(e.k, HW + 0.5, e.top), 0.5]], () => tg, B.socles);
          sheet([[P(e.k, HW - 0.04, e.top), P(e.k, HW - 0.04, e.top + 0.1), 0], [P(e.k, HW + 0.54, e.top), P(e.k, HW + 0.54, e.top + 0.1), 0.58]], () => tg, B.ashlar);
        }
        // colliders along the parapet, each slice pushed out far enough that no corner comes nearer the centre line than HW - 0.1
        for (let i = 0; i < secs.length - 1; i++) {
          const k0 = secs[i].k, k1 = secs[i + 1].k, kr0 = Math.round(k0), kr1 = Math.round(k1);
          if (!secs[i].core || !secs[i + 1].core || (!col[kr0] && !col[kr1])) continue;
          const [x0, z0] = atF(k0, sd * (HW + 0.25)), [x1, z1] = atF(k1, sd * (HW + 0.25)), len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.01) continue;
          const ax = (x1 - x0) / len, az = (z1 - z0) / len, n = Math.max(1, Math.ceil(len / 0.4)), L = len / n, nm = norF((k0 + k1) / 2);
          const shift = Math.max(0, Math.abs(ax * az) * (L + 0.08) + 0.04), nx = sd * nm[0], nz = sd * nm[1];
          for (let q = 0; q < n; q++) { const cx = x0 + ax * (q + 0.5) * L + nx * shift, cz = z0 + az * (q + 0.5) * L + nz * shift, hx = Math.abs(ax) * (L / 2 + 0.04) + Math.abs(az) * 0.25, hz = Math.abs(az) * (L / 2 + 0.04) + Math.abs(ax) * 0.25, rr = rect(cx - hx, cx + hx, cz - hz, cz + hz); if (!bands.some(b_ => ov(b_, rr)) || drop[kr0] > 0.5 || drop[kr1] > 0.5) collide(rr); }   // (a street line may cross only where the wall is low)
        }
        a = b;
      }
    }
    world.extraGround.push((x, z) => { if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) return -Infinity; const q = near(x, z); return q && q.dist < HW + 0.5 && q.dist - Math.abs(q.lat) < 0.05 ? q.y - 0.06 : -Infinity; });
    // the gate: two ashlar pylons standing out from the terrace wall under one marble cornice, a marble lintel and a walled attic
    // between them, a paved passage and, at its back, the doors: two studded timber leaves shut (the terrace wall has no opening)
    const L_ = PAL.level, gx = GATE.x, gz = GATE.z, dep = 5.5, pw = 3.4, ow = 5.0, top = L_ + 9.4; let foot = L_ - 1; for (let i = 0; i <= 8; i++) for (let j = 0; j <= 4; j++) foot = Math.min(foot, gnd(gx - ow / 2 - pw + i * (ow + 2 * pw) / 8, gz - dep + j * dep / 4) - 0.6);
    for (const sx of [-1, 1]) { const cx = gx + sx * (ow + pw) / 2; B.ashlar.add(box(pw, top - foot, dep), mat(cx, (top + foot) / 2, gz - dep / 2)); B.marble.add(box(0.5, 6.0, 0.12), mat(gx + sx * (ow / 2 + 0.25), L_ + 3.0, gz - dep - 0.05)); collide(rect(cx - pw / 2, cx + pw / 2, gz - dep, gz)); }
    B.ashlar.add(box(ow, top - (L_ + 6.3), dep), mat(gx, (top + L_ + 6.3) / 2, gz - dep / 2));
    B.marble.add(box(ow + 1.1, 0.75, 0.5), mat(gx, L_ + 6.3 - 0.37, gz - dep + 0.2));
    B.marble.add(rectSweep(ow + 2 * pw, dep, [{ o: 0.15, y: top - 0.05 }, { o: 0.35, y: top + 0.25, hard: true }, { o: 0.35, y: top + 0.55, hard: true }, { o: 0, y: top + 0.6, hard: true }], { top: true }), mat(gx, 0, gz - dep / 2));
    {
      const dz = gz - 0.25, lh = 5.6, lw = 2.46, th = 0.14, fz = dz - th / 2, bz = dz + th / 2, STUD = new THREE.OctahedronGeometry(0.045).scale(1, 1, 0.55);
      B.woodDark.add(box(ow, 6.3 - (L_ + lh + 0.04) + L_, 0.42), mat(gx, L_ + lh + 0.04 + (6.26 - lh) / 2, dz));   // head beam up to the attic
      for (const sx of [-1, 1]) {
        const cx = gx + sx * (lw / 2 + 0.02), m = mat(cx, L_ + 0.04 + lh / 2, dz);
        B.wood.add(box(lw, lh, th), m);
        for (let j = 1; j < 6; j++) B.woodDark.add(box(0.025, lh - 0.1, 0.012), mat(cx - lw / 2 + j * lw / 6, L_ + 0.04 + lh / 2, fz - 0.004));   // plank joints
        for (const hy of [0.45, 1.95, 3.55, 5.1]) {   // front: four studded rails; back: ledges
          B.woodDark.add(box(lw - 0.12, 0.2, 0.05), mat(cx, L_ + hy, fz - 0.025)); B.woodDark.add(box(lw - 0.2, 0.24, 0.07), mat(cx, L_ + hy, bz + 0.035));
          for (let q = 0; q < 7; q++) pt.add(STUD, mat(cx - lw / 2 + 0.2 + q * (lw - 0.4) / 6, L_ + hy, fz - 0.05), BRONZE);
        }
        for (const hy of [1.2, 2.75, 4.33]) for (let q = 0; q < 5; q++) pt.add(STUD, mat(cx - lw / 2 + 0.3 + q * (lw - 0.6) / 4, L_ + hy, fz - 0.005), BRONZE);
        B.woodDark.add(box(0.12, lh - 0.3, 0.05), mat(gx + sx * 0.08, L_ + 0.04 + lh / 2, fz - 0.025));   // meeting stiles
        // a bronze ring handle on a boss, and on the inside a diagonal brace between the ledges
        const hx = gx + sx * 0.42; pt.add(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 10).rotateX(Math.PI / 2), mat(hx, L_ + 1.62, fz - 0.065), BRONZE); pt.add(new THREE.TorusGeometry(0.15, 0.022, 4, 10), mat(hx, L_ + 1.47, fz - 0.1, 0.12, 0, 0), BRONZE);
        const br = Math.hypot(lw - 0.4, 1.4); B.woodDark.add(box(br, 0.18, 0.06), mat(cx, L_ + 1.2, bz + 0.03, 0, 0, sx * Math.atan2(1.4, lw - 0.4)));
      }
      B.woodDark.add(box(0.16, lh - 0.3, 0.05), mat(gx, L_ + 0.04 + lh / 2, bz + 0.025));   // the astragal covering the joint on the inside
      B.woodDark.add(box(ow - 0.3, 0.26, 0.2), mat(gx, L_ + 2.4, bz + 0.17)); for (const sx of [-1, 1]) B.woodDark.add(box(0.2, 0.44, 0.12), mat(gx + sx * 1.9, L_ + 2.4, bz + 0.09));   // drop bar in its brackets
    }
    for (const sx of [-1, 1]) { const cx = gx + sx * 1.0, cz = gz - dep + 0.9; B.marble.add(new THREE.CylinderGeometry(0.26, 0.32, 5.35, 14), mat(cx, L_ + 0.3 + 2.675, cz)); B.marble.add(lathe([[0.25, 0], [0.4, 0.14], [0.44, 0.2]], 14), mat(cx, L_ + 5.62, cz)); B.marble.add(box(0.84, 0.12, 0.84), mat(cx, L_ + 5.87, cz)); B.marble.add(box(0.7, 0.3, 0.7), mat(cx, L_ + 0.15, cz)); collide(rect(cx - 0.36, cx + 0.36, cz - 0.36, cz + 0.36)); }   // two columns in antis
    B.marble.add(box(ow, 0.4, 0.8), mat(gx, L_ + 6.12, gz - dep + 0.9));
    B.pave.add(scaleUV(new THREE.PlaneGeometry(ow, dep), ow, dep).rotateX(-Math.PI / 2), mat(gx, L_ + 0.04, gz - dep / 2)); B.ashlar.add(box(ow, L_ - foot, dep), mat(gx, (L_ + foot) / 2, gz - dep / 2));
    B.marble.add(box(ow + 0.2, 0.2, 0.7), mat(gx, L_ - 0.06, gz - dep + 0.35));
    collide(rect(gx - ow / 2, gx + ow / 2, gz - 0.45, gz + 0.3));
    world.extraGround.push((x, z) => (Math.abs(x - gx) < ow / 2 && z > gz - dep - 0.05 && z < gz) ? L_ + 0.02 : -Infinity);
    poi({ type: 'door', x: gx, z: gz - 1.4, nx: 0, nz: -1, y: L_ + 0.02, note: 'palace gate' });
    // two guards on the paving before the columns, looking down the road
    for (const sx of [-1, 1]) { const x = gx + sx * 1.9, z = gz - dep - 0.8, g = world.groundHeight(x, z); if (!world.blocked(x, z) && Math.abs(g - L_) < 0.3) poi({ type: 'work', x, z, y: g, ry: face(0, -1), note: 'palace guard' }); }
    { const i = Math.round(N * 0.82), [vx, vz] = at(i, 1.4 * Math.sign(cf[i] || 1) * -1); poi({ type: 'view', x: vx, z: vz, ry: face(nor[i][0] * -Math.sign(cf[i] || 1), nor[i][1] * -Math.sign(cf[i] || 1)), note: 'over the harbour from the palace road' }); }
  }

  const AMPH = amphoraGeo(8), AMPH6 = amphoraGeo(6, false);   // (the stacked jars, hundreds of them, are coarser)
  // an upright grain sack: slumped body, rounded shoulders, a short gathered tuft where it is tied
  const SACKG = lathe([[0.001, 0], [0.22, 0.01], [0.29, 0.1], [0.3, 0.28], [0.27, 0.43], [0.19, 0.52], [0.08, 0.56], [0.035, 0.575], [0.06, 0.63], [0.045, 0.67], [0.001, 0.68]], 8).scale(1, 0.92, 0.78);
  const SACKL = ellipsoid(0.42, 0.17, 0.27, 7, 5);
  const BASKET = lathe([[0.001, 0], [0.15, 0], [0.23, 0.05], [0.27, 0.19], [0.28, 0.28], [0.26, 0.28], [0.001, 0.12]], 10), BRIM = new THREE.TorusGeometry(0.27, 0.025, 4, 12).rotateX(Math.PI / 2);
  // what is in a basket: a lumpy heap (grain, salt, tow, or a sacking cover) sunk below the rim, small fish, olives
  const lumpy = (g, amp, seed) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = Math.sin(x * 41 + seed) * Math.cos(z * 37 - seed * 2) + 0.5 * Math.sin((x + z) * 83 + seed * 3); p.setXYZ(i, x * (1 + amp * 0.4 * n), y + amp * 0.06 * n * (y > 0.001 ? 1 : 0), z * (1 + amp * 0.4 * n)); } g.computeVertexNormals(); return g; };
  const BLUMP = [1, 2, 3].map(k => lumpy(new THREE.SphereGeometry(1, 9, 3, 0, TAU, 0, Math.PI / 2).scale(0.215, 0.085, 0.215), 0.3, k));
  const BFISH = ellipsoid(0.12, 0.022, 0.035, 5, 3), OLIVE = new THREE.OctahedronGeometry(0.032);
  // a low bed of sand shovelled onto the paving (irregular rim), and loose clods of it
  const SANDBED = (() => { const g = new THREE.SphereGeometry(1, 18, 4, 0, TAU, 0, Math.PI / 2), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.07 * Math.sin(a * 3 + 1) + 0.04 * Math.sin(a * 5 + 2); p.setXYZ(i, x * 1.45 * k, Math.pow(y, 0.8) * 0.19 * (1 + 0.12 * Math.sin(a * 4)), z * 0.72 * k); } g.computeVertexNormals(); return g; })();
  const CLOD = lumpy(new THREE.SphereGeometry(1, 5, 2, 0, TAU, 0, Math.PI / 2).scale(0.09, 0.05, 0.07), 0.6, 4);
  // net floats and sinkers; a fish (tail at the origin, head down, 0.33 m): dark back, silvery belly, dark head and tail
  const CORK = new THREE.CylinderGeometry(0.055, 0.055, 0.025, 6), SINKER = ellipsoid(0.04, 0.03, 0.035, 4, 3);
  const FPROF = [[0.001, -0.33], [0.017, -0.315], [0.03, -0.28], [0.035, -0.21], [0.03, -0.12], [0.017, -0.05], [0.005, 0]];
  const FBACK = lathe(FPROF, 2, 0, Math.PI).scale(1, 1, 0.34), FBELLY = lathe(FPROF, 2, Math.PI, Math.PI).scale(1, 1, 0.34), FHEAD = ellipsoid(0.03, 0.05, 0.014, 5, 3);
  const FTAIL = (() => { const b = new Bucket(); for (const s of [-1, 1]) b.add(box(0.012, 0.055, 0.005), mat(s * 0.014, 0.022, 0, 0, 0, -s * 0.5)); return b.build(); })();
  const fish = (m, back = pick([0x4a4336, 0x524a3a, 0x433d33]), belly = pick([0x8a8274, 0x958c7c, 0x7f796d])) => { pt.add(FBACK, m, back); pt.add(FBELLY, m, belly); pt.add(FHEAD, m.clone().multiply(mat(0, -0.285, 0)), 0x37322b); pt.add(FTAIL, m, back); };
  const COIL = new Bucket(); COIL.add(new THREE.TorusGeometry(0.27, 0.05, 4, 12).rotateX(Math.PI / 2), mat(0, 0.05, 0)); COIL.add(new THREE.TorusGeometry(0.2, 0.045, 4, 10).rotateX(Math.PI / 2), mat(0.03, 0.14, 0)); const COILG = COIL.build();
  // clutter pieces: (x, y, z) is the foot
  const amph = (x, y, z, ry = 0, rx = 0, rz = 0, lo = false) => tc.add(lo ? AMPH6 : AMPH, mat(x, y, z, rx, ry, rz), pick(CLAY));
  const sack = (x, y, z, ry = 0) => cl.add(SACKG, mat(x, y, z, 0, ry, 0, 0.9 + R() * 0.2), pick(SACK));
  const sackL = (x, y, z, ry = 0) => cl.add(SACKL, mat(x, y + 0.16, z, 0, ry, (R() - 0.5) * 0.15), pick(SACK));
  // a bale: a soft, squarish bundle wrapped in sacking (no round ends), lashed once lengthwise and twice across with cord lying on
  // its surface (a superellipsoid: the sphere's directions pushed out towards a box, the corners sampled so the outline stays square)
  const ROPEB = 0x5e4a34;
  const BALEV = [5, 9, 13].map(seed => {
    const hx = 0.46, hy = 0.28, hz = 0.33, sq = v => Math.sign(v) * Math.pow(Math.abs(v), 0.55);
    const surf = (x, y, z, e = 0) => { const n = Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 + y * 3.7 + seed) * 0.05; return [sq(x) * (hx + e) * (1 + n), Math.max(-0.92, sq(y)) * (hy + e) * (1 + n * 0.6) + hy * 0.92, sq(z) * (hz + e) * (1 + n) * (1 - 0.08 * Math.max(0, y))]; };
    const g = new THREE.SphereGeometry(1, 12, 8, Math.PI / 12), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, ...surf(p.getX(i), p.getY(i), p.getZ(i)));
    g.computeVertexNormals();
    const cross = (o, t, e) => { const px = Math.sign(o) * Math.pow(Math.abs(o) / hx, 1 / 0.55), r = Math.sqrt(1 - px * px); return surf(px, r * Math.sin(t), r * Math.cos(t), e); };   // round the bundle at x ≈ o
    const rb = new Bucket(), loop = (f, n) => { const P = []; for (let k = 0; k < n; k++) P.push(f(k / n * TAU)); for (let k = 0; k < n; k++) rb.add(rod(P[k], P[(k + 1) % n], 0.016, 3)); };
    loop(t => surf(Math.cos(t), Math.sin(t), 0, 0.012), 16); for (const o of [-0.22, 0.2]) loop(t => cross(o, t, 0.014), 12);
    return { body: g, rope: rb.build(), cross };
  });
  const bale = (x, y, z, ry = 0, fixed = false) => { const v = pick(BALEV), r1 = (R() - 0.5) * 0.15, r2 = (R() - 0.5) * 0.06, sc = V(0.85 + R() * 0.3, 0.92 + R() * 0.16, 0.85 + R() * 0.3), m = fixed ? mat(x, y, z, 0, ry, 0) : mat(x, y, z, 0, ry + r1, r2).multiply(mat(0, 0, 0, 0, 0, 0, sc)); cl.add(v.body, m, pick(BALE)); pt.add(v.rope, m, ROPEB); return { v, m }; };
  const crate = (x, y, z, ry = 0, s = 1) => { const m = mat(x, y + 0.3 * s, z, 0, ry, 0, s); B.wood.add(box(0.8, 0.6, 0.6), m); for (const o of [-0.3, 0.3]) B.woodDark.add(box(0.1, 0.62, 0.62), m.clone().multiply(mat(o, 0, 0))); };
  const FILL = { grey: 0x7a6a50, olive: 0x5c6632, grain: 0x9c8150, fish: 0x7f858a, fish2: 0x76828a, salt: 0xa8a092 };
  const basket = (x, y, z, fill = FILL.grey) => {
    const m = mat(x, y, z, 0, R() * TAU, 0); tc.add(BASKET, m, 0xb07e4a); tc.add(BRIM, m.clone().multiply(mat(0, 0.28, 0)), 0x8a6038);
    if (fill === FILL.fish || fill === FILL.fish2) {   // the catch: a ring of fish laid head to tail round the basket, a few across the middle, on a dark heap
      tc.add(BLUMP[0], m.clone().multiply(mat(0, 0.12, 0, 0, 0, 0, V(1.05, 1, 1.05))), 0x3e3a33);
      for (let k = 0; k < 8; k++) { const ring = k < 5, a = ring ? k * TAU / 5 + R() * 0.3 : R() * TAU, r = ring ? 0.12 : 0.03 + R() * 0.04, y = ring ? 0.222 : 0.222 + (k - 5) * 0.013; pt.add(BFISH, m.clone().multiply(mat(Math.cos(a) * r, y, Math.sin(a) * r, (R() - 0.5) * 0.3, ring ? -a + Math.PI / 2 + ((k * 0.618) % 1 - 0.5) * 1.1 : a, ring ? 0.2 : (R() - 0.5) * 0.3)), pick([0x7f8078, 0x767b7e, 0x6c7176, 0x858073, 0x686459])); }
    }
    else if (fill === FILL.olive) { tc.add(BLUMP[1], m.clone().multiply(mat(0, 0.12, 0, 0, 0, 0, 0.9)), 0x2f3322); for (let k = 0; k < 11; k++) { const a = k * 2.4 + R(), r = Math.sqrt(R()) * 0.16; pt.add(OLIVE, m.clone().multiply(mat(Math.cos(a) * r, Math.max(0.135 + r * 0.62, 0.2 - r * 0.25) + R() * 0.02, Math.sin(a) * r, R() * 3, R() * 3, 0, V(1, 1.25, 1))), pick([0x3d4128, 0x4f4a2c, 0x2f3322, 0x45402a])); } }
    else tc.add(BLUMP[Math.floor(R() * 3)], m.clone().multiply(mat(0, 0.17, 0, 0, R() * TAU, 0)), fill);
  };
  // an amphora leaning on a vertical face (its foot `gap` m out from the face, `sock` = height of a plinth jutting `jut` m out below):
  // the smallest tilt at which the jar's profile touches the face or the plinth
  const AMPR = [[0.05, 0.06], [0.12, 0.25], [0.168, 0.44], [0.16, 0.58], [0.08, 0.66], [0.05, 0.8]];
  const leanTilt = (gap, sock = 0, jut = 0) => { for (let a = 0.06; a < 0.7; a += 0.02) { const s = Math.sin(a), c = Math.cos(a); if (AMPR.some(([r, y]) => gap - (y * s + r * c) <= ((y * c - r * s) <= sock ? jut : 0))) return a; } return 0.7; };
  const coil = (x, y, z) => pt.add(COILG, mat(x, y, z, 0, R() * TAU, 0), ROPE);
  const rope = (p, q, sag, r = 0.028, color = ROPE, n = 6) => { let prev = p; for (let i = 1; i <= n; i++) { const t = i / n, c = [lerp(p[0], q[0], t), lerp(p[1], q[1], t) - sag * 4 * t * (1 - t), lerp(p[2], q[2], t)]; pt.add(rod(prev, c, r, 4), null, color); prev = c; } };

  // =====================================================================
  // ---------- the quay: gangplanks, crane, cargo, mooring gear ----------
  // =====================================================================
  // the merchant ships' headings, read back from their hulls in the wood bucket (fallback 0)
  const shipRy = (x0, z0 = 458, hint = 0) => {
    for (const g of B.wood.list) {
      const p = g.attributes.position; if (p.count !== 231) continue;
      g.computeBoundingBox(); const bb = g.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
      if (Math.abs(cx - x0) > 1.5 || Math.abs(cz - z0) > 1.5) continue;
      let best = 0, ry = 0; for (let i = 0; i < p.count; i++) { const dx = p.getX(i) - cx, dz = p.getZ(i) - cz, d = dx * dx + dz * dz; if (d > best) { best = d; ry = Math.atan2(-dz, dx); } }
      while (ry > hint + Math.PI / 2) ry -= Math.PI; while (ry < hint - Math.PI / 2) ry += Math.PI; return ry;
    }
    return hint;
  };
  const bollards = []; for (let i = 0; i < 20; i++) bollards.push(-230 + i * 24);
  const nearBollard = (x, m = 1.2) => bollards.some(b => Math.abs(b - x) < m);
  const quayUsed = [];    // x-intervals of the quay's seaward band already taken
  const takeSouth = (x0, x1) => { if (quayUsed.some(([a, b]) => x0 < b && x1 > a)) return false; quayUsed.push([x0, x1]); return true; };
  const CRANE_SHIP = 36;
  // goods piled on the seaward band (z 447.25 – 449.45), beside the planks and between the ships
  const pileS = (cx, kind) => {
    const r = rect(cx - 1.5, cx + 1.5, 447.25, 449.45);
    if (nearBollard(cx, 2.0) || !free(r, 6.6, 0) || !takeSouth(cx - 1.6, cx + 1.6)) return false;
    if (kind === 'amph') for (let layer = 0; layer < 2; layer++) for (let k = 0; k < 7 - layer; k++) { const dir = (k + layer) % 2 ? 1 : -1; amph(cx - 1.15 + layer * 0.19 + k * 0.38, Q + 0.17 + layer * 0.29, 448.35 - dir * 0.42, 0, dir * Math.PI / 2, 0, true); }
    else if (kind === 'jars') {   // pointed jars pushed into a bed of sand shovelled onto the paving, leaning together
      tc.add(SANDBED, mat(cx, Q + 0.004, 448.2, 0, R() * 0.3 - 0.15, 0), 0x9a7a52);
      for (let k = 0; k < 5; k++) { const a = R() * TAU; tc.add(CLOD, mat(cx + Math.cos(a) * (1.55 + R() * 0.3), Q, 448.2 + Math.sin(a) * (0.8 + R() * 0.2), 0, R() * TAU, 0, 0.6 + R() * 0.7), 0x93744d); }
      for (let k = 0; k < 9; k++) { const row = k < 5 ? 0 : 1, lx = cx - 1.0 + (row ? 0.25 : 0) + (row ? k - 5 : k) * 0.5 + (R() - 0.5) * 0.06, lz = 447.95 + row * 0.5, bed = 0.16 * Math.sqrt(Math.max(0, 1 - ((lx - cx) / 1.45) ** 2 - ((lz - 448.2) / 0.72) ** 2));
        amph(lx, Q + bed - 0.12, lz, R() * TAU, (row ? -0.13 : 0.13) + (R() - 0.5) * 0.06, (lx - cx) * 0.07 + (R() - 0.5) * 0.06); }
      sack(cx + 1.1, Q, 449.05, R() * TAU); }
    else if (kind === 'bales') { bale(cx - 0.52, Q, 448.0, 0.05); bale(cx + 0.52, Q, 448.1, -0.08); bale(cx, Q + 0.47, 448.05, 0.1); crate(cx + 0.8, Q, 449.0, 0.2, 0.8); crate(cx - 0.75, Q, 449.0, -0.1, 0.75); }
    else { for (let k = 0; k < 3; k++) sackL(cx - 0.9 + k * 0.9, Q, 448.0, R() * 0.3); for (let k = 0; k < 2; k++) sackL(cx - 0.45 + k * 0.9, Q + 0.3, 448.0, R() * 0.3); sack(cx + 0.9, Q, 449.0); sack(cx - 0.85, Q, 449.05, R() * TAU); }
    collide(r); return true;
  };
  // the hull top of a city ship, found by casting down onto its (world-space) ellipsoid in the wood bucket
  const rayMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), ray = new THREE.Raycaster();
  const hullAt = (x0, z0) => { for (const g of B.wood.list) { if (g.attributes.position.count !== 231) continue; g.computeBoundingBox(); const bb = g.boundingBox; if (Math.abs((bb.min.x + bb.max.x) / 2 - x0) < 1.5 && Math.abs((bb.min.z + bb.max.z) / 2 - z0) < 1.5) return g; } return null; };
  const topOf = (g, x, z) => { if (!g) return -Infinity; rayMesh.geometry = g; ray.set(V(x, 40, z), V(0, -1, 0)); const hit = ray.intersectObject(rayMesh, false)[0]; return hit ? hit.point.y : -Infinity; };
  for (const X of MERCH) {
    const ry = shipRy(X), c = Math.cos(ry), s = Math.sin(ry), hull = hullAt(X, 458);
    const w2l = (lx, ly, lz) => [X + c * lx + s * lz, SEA + ly, 458 - s * lx + c * lz];   // ship local → world
    // gangplank from the quay onto the hull's near shoulder: its upper end rests 4 cm above the planking, a cleat under it
    const gx = X === CRANE_SHIP ? X - 5 : X + 3, lx = (gx - X) * c;
    const across = z => Math.max(topOf(hull, gx - 0.39, z), topOf(hull, gx + 0.39, z));
    let ztop = -Infinity; for (let z = 450; z < 458; z += 0.25) ztop = Math.max(ztop, across(z));
    let zEnd = 450; while (zEnd < 458 && across(zEnd) < ztop - 0.45) zEnd += 0.1;
    const p0 = [gx, Q + 0.05, 448.6], p1 = [gx, across(zEnd) + 0.075, zEnd];
    for (let it = 0; it < 3; it++) for (let t = 0.4; t <= 1.001; t += 0.05) { const z = lerp(p0[2], p1[2], t), need = across(z) + 0.04 + 0.035 - lerp(p0[1], p1[1], t); if (need > 0) p1[1] += need / t; }
    const len = Math.hypot(p1[1] - p0[1], p1[2] - p0[2]);
    const pm = frame([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], [0, p1[1] - p0[1], p1[2] - p0[2]], [1, 0, 0]);
    B.wood.add(box(len, 0.07, 0.78), pm);
    for (let k = 0; k < Math.floor(len / 0.42); k++) B.woodDark.add(box(0.05, 0.05, 0.74), pm.clone().multiply(mat(-len / 2 + 0.3 + k * 0.42, 0.05, 0)));
    { const z = zEnd - 0.2, t = (z - p0[2]) / (p1[2] - p0[2]); B.woodDark.add(box(0.9, 0.16, 0.14), mat(gx, lerp(p0[1], p1[1], t) - 0.035 - 0.08, z)); }
    takeSouth(gx - 1.2, gx + 1.2);
    poi({ type: 'work', x: gx, z: 447.6, y: Q, ry: face(0, 1), note: 'cargo-pickup', ship: X });
    // cargo waiting on both sides of the plank
    const kinds = ['jars', 'sacks', 'bales', 'amph'], k0 = Math.floor(R() * 4);
    for (const sd of [-1, 1]) pileS(gx + sd * 2.9, kinds[(k0 + (sd > 0 ? 1 : 0)) % 4]);
    // mooring lines from the stem and stern posts to the nearest bollards
    for (const [llx, lly] of [[-9.8, 2.7], [9.6, 2.5]]) {
      const a = w2l(llx, lly, 0), b = bollards.reduce((best, bx) => Math.abs(bx - (a[0] + Math.sign(llx) * 6)) < Math.abs(best - (a[0] + Math.sign(llx) * 6)) ? bx : best, bollards[0]);
      rope(a, [b, Q + 1.0, 449], 0.35);
      pt.add(new THREE.TorusGeometry(0.4, 0.05, 4, 10).rotateX(Math.PI / 2), mat(b, Q + 0.95, 449), ROPE);
    }
    // a little deck cargo on the hull top near the plank
    for (let k = 0; k < 3; k++) { const q = w2l(lx + 1.2 + k * 0.45, 2.42, -0.4 + (k % 2) * 0.5), ty = topOf(hull, q[0], q[2] + 0.4); amph(q[0], ty > -1e9 ? ty + 0.15 : q[1], q[2], R() * TAU, 1.45, 0.1, true); }
  }
  // bow lines of the triremes (their rams point at the quay)
  for (const X of TRIR) { const ry = shipRy(X, 470, Math.PI / 2), px = X + Math.cos(ry) * 17.2, pz = 470 - Math.sin(ry) * 17.2, b = bollards.reduce((best, bx) => Math.abs(bx - px) < Math.abs(best - px) ? bx : best); rope([px, SEA + 2.9, pz], [b, Q + 1.0, 449], 0.4); pt.add(new THREE.TorusGeometry(0.4, 0.05, 4, 10).rotateX(Math.PI / 2), mat(b, Q + 0.95, 449), ROPE); }
  // mooring rings in the quay face
  for (let x = -224; x < 236; x += 12) { if (nearBollard(x, 2)) continue; for (const sx of [-0.05, 0.05]) pt.add(box(0.03, 0.12, 0.09), mat(x + sx, Q - 0.84, 449.53), IRON); pt.add(box(0.13, 0.03, 0.03), mat(x, Q - 0.79, 449.57), IRON); pt.add(new THREE.TorusGeometry(0.17, 0.03, 4, 10), mat(x, Q - 0.99, 449.6, 0.12, 0, 0), IRON); }   // an iron staple leaded into a joint, the ring hanging from it

  // ---------- cranes: shear legs with a windlass, lifting bales off the ship at x = 36 and a crate at x = -88 ----------
  const crane = (xc, h, reach, load) => {
    const zf = 448.4, top = [xc, Q + h, zf + reach], feet = [[xc - 1.9, Q, zf], [xc + 1.9, Q, zf]];
    for (const f of feet) { B.woodDark.add(rod(f, top, 0.16, 7, 0.11)); B.socles.add(box(0.55, 0.25, 0.55), mat(f[0], Q + 0.12, f[2])); }
    const ft = 3.2 / h; B.woodDark.add(rod([xc - 1.9 * (1 - ft) - 0.14, Q + 3.2, zf + reach * ft], [xc + 1.9 * (1 - ft) + 0.14, Q + 3.2, zf + reach * ft], 0.08, 5));   // cross tie lashed to both legs
    for (const sx of [-1, 1]) pt.add(new THREE.TorusGeometry(0.15, 0.03, 4, 8).rotateY(Math.PI / 2), mat(xc + sx * 1.9 * (1 - ft), Q + 3.2, zf + reach * ft), ROPE);
    // pulley block at the apex, hoist rope, a sling with the load
    B.woodDark.add(box(0.3, 0.5, 0.22), mat(top[0], top[1] - 0.35, top[2]));
    const hook = [xc, Q + (load === 'bales' ? 3.6 : 3.3), top[2]];
    pt.add(rod([top[0], top[1] - 0.6, top[2]], hook, 0.022, 4), null, ROPE);
    if (load === 'bales') {   // two bales stacked in a sling: two loops round the pair, under the lower one, up to the hook from the top corners
      const hi = bale(xc, Q + 2.0, top[2], 0.1, true), lo = bale(xc + 0.05, Q + 1.5, top[2], -0.05, true), on = (b, o, t) => V(...b.v.cross(o, t, 0.035)).applyMatrix4(b.m).toArray();
      for (const o of [-0.27, 0.27]) {
        const path = [on(hi, o, Math.PI / 4), on(hi, o, 0), on(lo, o, 0), on(lo, o, -Math.PI / 4), on(lo, o, -Math.PI / 2), on(lo, o, -3 * Math.PI / 4), on(lo, o, Math.PI), on(hi, o, Math.PI), on(hi, o, 3 * Math.PI / 4)];
        for (let k = 0; k < path.length - 1; k++) pt.add(rod(path[k], path[k + 1], 0.018, 3), null, ROPE);
        pt.add(rod(hook, path[0], 0.018, 3), null, ROPE); pt.add(rod(hook, path[path.length - 1], 0.018, 3), null, ROPE);
      }
    }
    else { for (const [ox, oz] of [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3], [0.4, 0.3]]) pt.add(rod(hook, [xc + ox, Q + 2.46, top[2] + oz], 0.018, 3), null, ROPE); crate(xc, Q + 1.8, top[2], 0.15, 1.05); }
    // windlass between the feet and the fall of rope from the block down to its drum
    const drum = [xc, Q + 1.0, 448.5];
    for (const sx of [-1, 1]) { B.woodDark.add(rod([xc + sx * 1.1, Q, 448.1], [xc + sx * 1.1, Q + 1.2, 448.5], 0.09, 5)); B.woodDark.add(rod([xc + sx * 1.1, Q, 448.9], [xc + sx * 1.1, Q + 1.2, 448.5], 0.09, 5)); }
    B.wood.add(rod([xc - 1.15, drum[1], drum[2]], [xc + 1.15, drum[1], drum[2]], 0.2, 8));
    pt.add(rod([xc - 0.6, drum[1], drum[2]], [xc + 0.6, drum[1], drum[2]], 0.24, 8), null, ROPE);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; B.woodDark.add(rod([xc + 1.2, drum[1], drum[2]], [xc + 1.2, drum[1] + Math.cos(a) * 1.0, drum[2] + Math.sin(a) * 1.0], 0.04, 4)); }
    pt.add(rod([xc, drum[1] + 0.22, drum[2]], [top[0], top[1] - 0.6, top[2] - 0.1], 0.02, 4), null, ROPE);
    // backstays over the walking lane to two anchor posts against the agora side
    for (const sx of [-1, 1]) { const anc = [xc + sx * 3.2, Q + 1.3, 441.4]; B.woodDark.add(rod([anc[0], Q, anc[2]], anc, 0.13, 6)); pt.add(rod(top, anc, 0.025, 4), null, ROPE); collide(rect(anc[0] - 0.3, anc[0] + 0.3, 441.1, 441.7)); }
    collide(rect(xc - 2.3, xc + 2.3, 447.8, 449.3));
    takeSouth(xc - 2.6, xc + 2.6);
    coil(xc - 3.3, Q, 448.9);
    poi({ type: 'work', x: xc, z: 447.4, y: Q, ry: face(0, 1), note: 'crane' });
    poi({ type: 'work', x: xc + 1.9, z: 447.5, y: Q, ry: face(0, 1), note: 'windlass' });
  };
  crane(CRANE_SHIP + 6, 9.2, 6.6, 'bales');
  crane(-94, 7.4, 6.1, 'crate');

  // ---------- marble for the Mausoleum's builders, just landed beside the crane ----------
  {
    const x0 = CRANE_SHIP + 11.5, r = rect(x0 - 0.3, x0 + 5.3, 447.2, 449.45);
    if (free(r, 6.6, 0) && takeSouth(x0 - 0.4, x0 + 5.4)) {
      for (const bx of [x0 + 0.5, x0 + 2.5, x0 + 4.5]) B.woodDark.add(rod([bx, Q + 0.08, 447.35], [bx, Q + 0.08, 449.25], 0.08, 6));
      B.grey.add(box(4.6, 0.85, 1.0), mat(x0 + 2.5, Q + 0.585, 448.3, 0, 0.02, 0));
      B.grey.add(box(2.0, 0.78, 0.95), mat(x0 + 1.35, Q + 1.4, 448.28, 0, -0.04, 0));
      B.grey.add(box(1.5, 0.7, 0.9), mat(x0 + 3.75, Q + 1.36, 448.35, 0, 0.07, 0));
      pt.add(rod([x0 + 2.5, Q + 1.02, 447.75], [x0 + 2.5, Q + 1.02, 448.85], 0.05, 4), null, ROPE);
      collide(r);
      poi({ type: 'work', x: x0 - 0.9, z: 448.3, y: Q, ry: face(1, 0), note: 'marble blocks' });
    }
  }
  // ---------- a public balance for weighing cargo, and more goods waiting between the ships ----------
  {
    const bx = -122, bz = 448.2, top = Q + 2.7;
    if (free(rect(bx - 1.6, bx + 1.6, 447.2, 449.3), 6.6, 0) && takeSouth(bx - 1.8, bx + 1.8)) {
      for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 0.5; B.woodDark.add(rod([bx + Math.cos(a) * 0.9, Q, bz + Math.sin(a) * 0.9], [bx, top, bz], 0.07, 5)); }
      B.woodDark.add(box(2.4, 0.12, 0.12), mat(bx, top + 0.05, bz, 0, 0, 0.04));
      for (const s of [-1, 1]) {
        const py = Q + 0.75 + s * 0.05, px = bx + s * 1.1;
        for (let k = 0; k < 3; k++) { const a = k * TAU / 3; pt.add(rod([px, top + 0.05 - s * 0.045, bz], [px + Math.cos(a) * 0.3, py + 0.06, bz + Math.sin(a) * 0.3], 0.012, 3), null, ROPE); }
        pt.add(lathe([[0.01, 0], [0.3, 0.02], [0.36, 0.1]], 10), mat(px, py, bz), BRONZE);
      }
      sack(bx - 1.1, Q + 0.72, bz, 0.4);
      for (let k = 0; k < 3; k++) pt.add(box(0.14 - k * 0.03, 0.1 - k * 0.02, 0.14 - k * 0.03), mat(bx + 1.1, Q + 0.86 + k * 0.08, bz), 0x5a5550);
      collide(rect(bx - 1.5, bx + 1.5, 447.3, 449.2));
      poi({ type: 'work', x: bx, z: 447.3, y: Q, ry: face(0, 1), note: 'weighing' });
    }
    for (const [cx, kind] of [[-127, 'sacks'], [-51, 'amph'], [-40, 'jars'], [-2, 'bales'], [12, 'amph'], [70, 'amph'], [84, 'bales'], [118, 'jars'], [-104, 'jars'], [-196.5, 'sacks'],
      [-116, 'amph'], [-74, 'bales'], [-26, 'jars'], [7, 'jars'], [22, 'sacks'], [64, 'jars'], [94, 'sacks'], [124, 'bales']]) pileS(cx, kind);
  }
  // ---------- small boats tied up along the quay wall at its western end ----------
  for (const x of [-227, -213.5, -186, -171]) {
    const z = 452.6, wy = SEA, ry = (R() - 0.5) * 0.12 + (x > -200 ? Math.PI : 0);
    boat(x, wy + 0.04, z, ry, 0, (R() - 0.5) * 0.05, R() < 0.6, undefined, true);   // (keel at the surface: lower and the flat water shows inside the hull)
    const b = bollards.reduce((best, bx) => Math.abs(bx - x) < Math.abs(best - x) ? bx : best);
    rope([x + Math.cos(ry) * 2.6, wy + 0.75, z - Math.sin(ry) * 2.6], [b, Q + 1.0, 449], 0.4, 0.02);
  }

  // ---------- cargo along the landward edge of the quay (z 440.8 – 442.9) ----------
  const PITHOS = lathe([[0.001, 0], [0.2, 0.02], [0.36, 0.22], [0.45, 0.55], [0.43, 0.9], [0.3, 1.12], [0.22, 1.18], [0.26, 1.24], [0.19, 1.26]], 10);
  const LANES_X = [-80, -35, 10, 55, 100];   // the agora's market lanes run out onto the quay here: their mouths stay open
  const northCluster = (x0, x1, kind) => {
    const r = rect(x0 - 0.2, x1 + 0.2, 440.7, 443.0);
    if (!free(r, 6.6, 0) || inLane(rect(x0, x1, 440.8, 442.9)) || LANES_X.some(l => r.minX < l + 2.5 && r.maxX > l - 2.5)) return false;
    if (kind === 'pithoi') {   // big storage jars, a few small ones between them
      for (let x = x0 + 0.5, k = 0; x < x1 - 1.9; x += 1.0, k++) { tc.add(PITHOS, mat(x, Q, 441.45 + (k % 2) * 0.75, (R() - 0.5) * 0.04, R() * TAU, (R() - 0.5) * 0.04, 0.85 + R() * 0.2), pick(CLAY)); if (k % 2) amph(x + 0.45, Q + 0.17, 440.9, 0, Math.PI / 2 - 0.04, (R() - 0.5) * 0.3, true); }
      tc.add(PITHOS, mat(x1 - 0.3, Q + 0.37, 442.1, 0, 0.08, Math.PI / 2 - 0.05, 0.8), pick(CLAY));   // one lying on its side
    } else if (kind === 'tiles') {   // roof tiles stacked on edge-battens, cover tiles nested beside them
      for (let x = x0 + 0.45; x < x1 - 1.2; x += 0.8) { B.woodDark.add(box(0.7, 0.06, 1.0), mat(x, Q + 0.03, 441.6)); for (let l = 0; l < 7; l++) tc.add(box(0.62, 0.075, 0.92), mat(x + (R() - 0.5) * 0.03, Q + 0.1 + l * 0.085, 441.6 + (R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.04, 0), l % 2 ? 0xb8714a : 0xc27d53); }
      const IMB = new THREE.CylinderGeometry(0.1, 0.13, 0.7, 6, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
      for (let l = 0; l < 3; l++) for (let j = 0; j < 4 - l; j++) tc.add(IMB, mat(x1 - 0.75 + (j - (3 - l) / 2) * 0.27, Q + 0.02 + l * 0.12, 442.4, 0, 0, 0), 0xb96f48);
    } else if (kind === 'cart') {   // a two-wheeled handcart with sacks, shafts resting on the paving
      const cx = (x0 + x1) / 2 - 0.4, cz = 441.9, ax = 0.45, wy = Q + 0.45;
      for (const sz of [-1, 1]) { pt.add(new THREE.CylinderGeometry(0.45, 0.45, 0.07, 12).rotateX(Math.PI / 2), mat(cx, wy, cz + sz * 0.62), 0x5a4230); pt.add(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 6).rotateX(Math.PI / 2), mat(cx, wy, cz + sz * 0.62), 0x3a2a1e); B.woodDark.add(rod([cx - 0.3, wy + 0.13, cz + sz * 0.48], [cx + 2.4, Q + 0.05, cz + sz * 0.3], 0.04, 5)); }
      B.woodDark.add(rod([cx, wy, cz - 0.7], [cx, wy, cz + 0.7], 0.04, 5));
      B.wood.add(box(1.5, 0.07, 1.0), mat(cx - 0.1, wy + 0.1, cz, 0, 0, -0.1)); for (const sz of [-1, 1]) B.wood.add(box(1.5, 0.22, 0.05), mat(cx - 0.1, wy + 0.24, cz + sz * 0.5, 0, 0, -0.1));
      for (let k = 0; k < 3; k++) sackL(cx - 0.55 + k * 0.45, wy + 0.2 - (k - 1) * 0.05, cz + (k % 2 ? 0.2 : -0.2), Math.PI / 2 + (R() - 0.5) * 0.3); sack(cx + 1.3, Q, 442.62, R() * TAU); basket(x0 + 0.4, Q, 442.4, FILL.olive);
    } else if (kind === 'table') {   // the harbour-dues collector's trestle table: a small balance, jugs, a tally board, a stool
      const cx = (x0 + x1) / 2, tz = 441.7;
      B.wood.add(box(2.4, 0.07, 0.85), mat(cx, Q + 0.8, tz)); for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.woodDark.add(rod([cx + sx * 1.0, Q, tz + sz * 0.45], [cx + sx * 1.0, Q + 0.77, tz + sz * 0.3], 0.035, 4));
      const JUG = lathe([[0.001, 0], [0.05, 0], [0.075, 0.05], [0.08, 0.12], [0.055, 0.19], [0.03, 0.22], [0.04, 0.25], [0.001, 0.25]], 8);   // flat-footed sample jugs
      for (let k = 0; k < 5; k++) tc.add(JUG, mat(cx - 0.9 + k * 0.2, Q + 0.835, tz - 0.2 + (k % 2) * 0.1, 0, R() * TAU, 0, 0.9 + R() * 0.3), pick(CLAY));
      B.woodDark.add(rod([cx + 0.6, Q + 0.835, tz], [cx + 0.6, Q + 1.2, tz], 0.015, 4)); B.woodDark.add(box(0.5, 0.02, 0.02), mat(cx + 0.6, Q + 1.2, tz));
      for (const s of [-1, 1]) pt.add(lathe([[0.01, 0], [0.08, 0.01], [0.1, 0.04]], 8), mat(cx + 0.6 + s * 0.24, Q + 1.0, tz), BRONZE);
      pt.add(box(0.35, 0.02, 0.25), mat(cx + 0.1, Q + 0.845, tz + 0.15, 0, 0.3, 0), 0x3a342c);
      pt.add(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 8), mat(cx + 0.2, Q + 0.45, tz + 0.95), 0x6e5238); for (let k = 0; k < 3; k++) { const a = k * TAU / 3; B.woodDark.add(rod([cx + 0.2 + Math.cos(a) * 0.17, Q, tz + 0.95 + Math.sin(a) * 0.17], [cx + 0.2 + Math.cos(a) * 0.1, Q + 0.43, tz + 0.95 + Math.sin(a) * 0.1], 0.025, 4)); }
      sack(x0 + 0.4, Q, 441.3, R() * TAU); sackL(x0 + 0.5, Q, 442.3, 0.3); basket(x1 - 0.4, Q, 441.3, FILL.grain); basket(x1 - 0.5, Q, 442.2, FILL.olive);
      poi({ type: 'work', x: cx, z: 443.25, ry: face(0, -1), note: 'harbour dues' });
    } else if (kind === 'timber') {   // squared beams on sleepers
      for (const sx of [x0 + 0.5, (x0 + x1) / 2, x1 - 0.5]) B.woodDark.add(box(0.12, 0.1, 1.6), mat(sx, Q + 0.05, 441.85));
      for (let l = 0; l < 3; l++) for (let j = 0; j < 3 - (l > 1 ? 1 : 0); j++) B.wood.add(box(x1 - x0 - 0.3 - l * 0.2, 0.26, 0.26), mat((x0 + x1) / 2 + (R() - 0.5) * 0.2, Q + 0.23 + l * 0.27, 441.45 + j * 0.4 + (l > 1 ? 0.2 : 0), 0, (R() - 0.5) * 0.02, 0));
    } else if (kind === 'sledge') {   // a column drum and a block on a timber sledge, rollers beside it
      const cx = (x0 + x1) / 2;
      for (const sz of [-1, 1]) B.woodDark.add(box(x1 - x0 - 0.4, 0.2, 0.18), mat(cx, Q + 0.1, 441.85 + sz * 0.55));
      for (let k = 0; k < 4; k++) B.wood.add(box(0.14, 0.1, 1.4), mat(cx - 2 + k * 1.33, Q + 0.25, 441.85));
      B.grey.add(box(2.4, 0.9, 1.1), mat(cx - 0.9, Q + 0.75, 441.85, 0, 0.03, 0)); B.grey.add(new THREE.CylinderGeometry(0.62, 0.62, 0.8, 14), mat(cx + 1.6, Q + 0.7, 441.85));
      for (const sx of [-0.9, 1.6]) pt.add(rod([cx + sx, Q + 1.21, 441.25], [cx + sx, Q + 1.21, 442.45], 0.04, 4), null, ROPE);
      for (let k = 0; k < 2; k++) pt.add(new THREE.CylinderGeometry(0.12, 0.12, 1.3, 8).rotateZ(Math.PI / 2), mat(x0 + 0.9 + k * 1.5, Q + 0.12, 442.72), 0x7a5a3c);
    } else
    if (kind === 'rack') {
      for (let x = x0; x <= x1 + 0.01; x += 1.6) B.woodDark.add(box(0.1, 1.0, 0.1), mat(Math.min(x, x1), Q + 0.5, 441.05));
      for (const y of [0.45, 0.85]) B.wood.add(box(x1 - x0 + 0.1, 0.08, 0.1), mat((x0 + x1) / 2, Q + y, 441.12));
      for (let x = x0 + 0.25; x < x1 - 0.1; x += 0.37) amph(x, Q, 441.55 + (R() - 0.5) * 0.04, R() * TAU, -0.3 + (R() - 0.5) * 0.05, (R() - 0.5) * 0.06);
      for (let x = x0 + 0.43; x < x1 - 0.3; x += 0.37) if (R() < 0.6) amph(x + (R() - 0.5) * 0.04, Q, 441.93, R() * TAU, -0.36 + (R() - 0.5) * 0.05, (R() - 0.5) * 0.08, true);   // a second rank leaning on the first
    } else if (kind === 'stack') {
      for (let layer = 0; layer < 3; layer++) for (let x = x0 + 0.2 + layer * 0.19; x < x1 - 0.1 - layer * 0.19; x += 0.38) { const dir = ((Math.round(x * 2.63) + layer) % 2) ? 1 : -1; amph(x, Q + 0.17 + layer * 0.29, 441.85 - dir * 0.42, 0, dir * Math.PI / 2, 0, true); }
      B.woodDark.add(box(x1 - x0, 0.08, 0.1), mat((x0 + x1) / 2, Q + 0.04, 441.4)); B.woodDark.add(box(x1 - x0, 0.08, 0.1), mat((x0 + x1) / 2, Q + 0.04, 442.3));
    } else if (kind === 'sacks') {
      for (let x = x0 + 0.45; x < x1 - 0.3; x += 0.88) { sackL(x, Q, 441.4, R() * 0.3); sackL(x + 0.1, Q, 442.3, R() * 0.3); if (R() < 0.7) sackL(x + 0.4, Q + 0.3, 441.85, Math.PI / 2 + R() * 0.3); }
      sack(x1 - 0.2, Q, 442.6, R() * TAU);
    } else if (kind === 'bales') {
      for (let x = x0 + 0.55; x < x1 - 0.4; x += 1.08) { bale(x, Q, 441.3, (R() - 0.5) * 0.1); if (R() < 0.6 && x + 1.08 < x1 - 0.4) bale(x + 0.54, Q + 0.47, 441.35, (R() - 0.5) * 0.2); if (R() < 0.5) crate(x, Q, 442.4, R() * 0.4, 0.9); else basket(x, Q, 442.4, pick([FILL.grey, FILL.olive, FILL.grain])); }
    } else {   // mixed small group
      crate(x0 + 0.5, Q, 441.3, R() * 0.3); crate(x0 + 0.5, Q + 0.6, 441.3, R() * 0.5, 0.85); basket(x0 + 1.4, Q, 441.4); basket(x0 + 1.5, Q, 442.2, FILL.olive);
      for (const x of [x0 + 1.95, x1 - 0.15]) B.woodDark.add(box(0.1, 0.62, 0.1), mat(x, Q + 0.31, 441.05)); B.wood.add(box(x1 - x0 - 1.7, 0.08, 0.1), mat((x0 + x1) / 2 + 0.9, Q + 0.55, 441.1));
      for (let x = x0 + 2.2; x < x1 - 0.3; x += 0.38) amph(x, Q, 441.15 + 0.38 * 1.02, R() * TAU, -leanTilt(0.39, 0.5, -1e9) + (R() - 0.5) * 0.03, (R() - 0.5) * 0.05); coil(x1 - 0.4, Q, 442.5);
    }
    collide(r);
    return true;
  };
  {
    const plan = [[-236, -229, 'rack'], [-227, -222, 'bales'], [-219, -212, 'stack'], [-209, -203, 'sacks'], [-200, -193, 'rack'], [-190, -185, 'mixed'], [-181, -174, 'stack'], [-171, -165, 'bales'],
      [-161, -154, 'rack'], [-150, -145, 'sacks'], [-141, -134, 'stack'], [-130, -124, 'pithoi'], [-113, -108, 'mixed'], [-104, -99, 'tiles'], [-89, -83, 'cart'], [-77.2, -71, 'rack'],
      [-64, -59, 'bales'], [-54, -47, 'stack'], [-29, -23, 'pithoi'], [-15, -7, 'stack'], [-3, 5, 'table'], [12.8, 18.6, 'cart'], [27, 33, 'rack'], [57.8, 64.6, 'sledge'], [66.2, 71.4, 'timber'],
      [73.4, 78.6, 'stack'], [82, 88, 'tiles'], [89.8, 95.4, 'mixed'], [105, 111, 'pithoi'], [115, 121, 'sacks'], [132, 138, 'stack'], [198, 205, 'rack'], [208, 213, 'bales'], [216, 223, 'stack'], [226, 232, 'sacks']];
    // canvas awnings on poles shading some of the goods (seen from the agora and from above)
    const awning = (x0, x1, col) => {
      const w = x1 - x0 + 0.5, cx = (x0 + x1) / 2, yB = Q + 2.75, yF = Q + 2.35, zB = 440.85, zF = 442.9, L = Math.hypot(zF - zB, yF - yB);
      for (const [px, pz, py] of [[x0 - 0.15, zB, yB], [x1 + 0.15, zB, yB], [x0 - 0.15, zF, yF], [x1 + 0.15, zF, yF]]) B.woodDark.add(rod([px, Q, pz], [px, py + 0.05, pz], 0.05, 5));
      pt.add(box(w, 0.03, L + 0.2), frame([cx, (yB + yF) / 2 + 0.06, (zB + zF) / 2], [1, 0, 0], [0, yF - yB, zF - zB]), col);
      pt.add(box(w, 0.28, 0.03), mat(cx, yF - 0.08, zF + 0.1), col);
    };
    const AWN = { '-77.2': 0xa85a36, '-29': 0xb8a27a, '-3': 0x8a4a32, '27': 0x9a6a3e, '73.4': 0xbfae88, '115': 0xa07a48, '-161': 0xb09060, '198': 0xa85a36 };
    for (const [a, b, k] of plan) if (northCluster(a, b, k)) {
      if (AWN[a]) awning(a, b, AWN[a]);
      // porters set down their loads at the goods piled along the agora's edge, in sight of the square
      if ([-29, -15, 27].includes(a)) poi({ type: 'work', x: (a + b) / 2, z: 440.15, y: Q, ry: face(0, 1), note: 'cargo-drop', mid: true });
    }
  }
  // ---------- the seaward edge: rope coils, baskets, people sitting with their legs over the water ----------
  for (let x = -236; x < 236; x += 2) {
    if (nearBollard(x, 1.4) || !takeSouth(x - 0.9, x + 0.9) || rectRoadD(rect(x - 1, x + 1, 447.2, 449.4)) < 6.6) continue;
    const k = Math.floor(R() * 10);
    if (k < 2) { coil(x, Q, 448.8); collide(rect(x - 0.4, x + 0.4, 448.4, 449.2)); }
    else if (k < 3) { basket(x - 0.3, Q, 448.7, pick([FILL.fish, FILL.grey])); basket(x + 0.3, Q, 448.9, FILL.fish2); collide(rect(x - 0.6, x + 0.6, 448.4, 449.2)); }
    else if (k < 5) poi({ type: 'seat', x, z: 449.25, y: Q, ry: face(0, 1), note: 'quay edge' });
    x += 2 + Math.floor(R() * 4) * 2;
  }
  for (const gx of [-67.5, -35, 22, 100]) poi({ type: 'gather', x: gx, z: 441.9, y: Q, r: 2, note: 'quay' });

  // the quay top is walkable along its whole length (the terrain under it falls away towards both ends)
  world.extraGround.push((x, z) => (z > 440.5 && z < 449.5 && x > -240.2 && x < 240.2) ? Q : -Infinity);

  // ---------- the apron over the inlet at the avenue's end: an ashlar platform at quay level, timber and jars waiting on it ----------
  {
    const A = APRON, w = A.maxX - A.minX, d = A.maxZ - A.minZ + 0.1, cx = (A.minX + A.maxX) / 2, cz = A.minZ + d / 2;
    let low = Q; for (let i = 0; i <= 12; i++) for (let j = 0; j <= 6; j++) low = Math.min(low, H(lerp(A.minX, A.maxX, i / 12), lerp(A.minZ, A.maxZ, j / 6)));
    B.ashlar.add(box(w, Q - 0.015 - low + 1.2, d), mat(cx, (Q - 0.015 + low - 1.2) / 2, cz));
    B.pave.add(scaleUV(new THREE.PlaneGeometry(w, d), w, d).rotateX(-Math.PI / 2), mat(cx, Q, cz));
    // a flight of steps down the north face to the sand (towards the town's street at x = 190), the low kerb along the drop broken for it
    const SX = 185.5, sf = H(SX, A.minZ - 2), sn = Math.max(1, Math.ceil((Q - sf) / 0.33)), sr = (Q - sf) / sn, str = 0.42;
    for (let i = 0; i < sn; i++) { const top = Q - (i + 1) * sr; B.ashlar.add(box(3.0, top - sf + 1.0, str + 0.02), mat(SX, (top + sf - 1.0) / 2, A.minZ - (i + 0.5) * str)); }
    world.extraGround.push((x, z) => (Math.abs(x - SX) < 1.5 && z <= A.minZ && z > A.minZ - sn * str) ? Q - (Math.floor((A.minZ - z) / str) + 1) * sr : -Infinity);
    for (const [x0, x1, z0, z1] of [[A.minX + 0.3, SX - 1.6, A.minZ + 0.15, A.minZ + 0.45], [SX + 1.6, A.maxX - 0.3, A.minZ + 0.15, A.minZ + 0.45], [A.maxX - 0.45, A.maxX - 0.15, A.minZ + 0.3, A.maxZ - 0.3]]) B.ashlar.add(box(x1 - x0, 0.42, z1 - z0), mat((x0 + x1) / 2, Q + 0.09, (z0 + z1) / 2));   // low kerb along the drop, founded below the paving
    collide(rect(A.minX + 0.3, SX - 1.55, A.minZ + 0.1, A.minZ + 0.5)); collide(rect(SX + 1.55, A.maxX - 0.15, A.minZ + 0.1, A.minZ + 0.5)); collide(rect(A.maxX - 0.5, A.maxX - 0.1, A.minZ + 0.1, A.maxZ - 0.3));
    world.extraGround.push((x, z) => (x > A.minX && x < A.maxX && z > A.minZ && z <= A.maxZ + 0.1) ? Q : -Infinity);
    const ok = r => free(r, 6.6, 0.05);
    // more loads about the apron, clear of the way from the avenue (x < 157), the steps and the gathering space:
    // roof tiles on battens, storage jars, a marble block on its sledge, a handcart, porters resting on a timber
    { const r = rect(158.6, 165.4, 420.6, 423.2); if (ok(r)) { for (let x = 159.1; x < 165; x += 0.8) { B.woodDark.add(box(0.7, 0.06, 1.0), mat(x, Q + 0.03, 421.9)); const nl = 5 + Math.floor(R() * 4); for (let l = 0; l < nl; l++) tc.add(box(0.62, 0.075, 0.92), mat(x + (R() - 0.5) * 0.03, Q + 0.1 + l * 0.085, 421.9 + (R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.05, 0), l % 2 ? 0xb8714a : 0xc27d53); } collide(r); poi({ type: 'work', x: 162, z: 423.8, y: Q, ry: face(0, -1), note: 'cargo-drop' }); } }
    { const r = rect(167.4, 174.2, 420.6, 424.4); if (ok(r)) { for (const [px, pz, sc] of [[168.3, 421.5, 1], [169.5, 423.2, 0.9], [171.0, 421.6, 1.05], [172.6, 423.3, 0.85]]) tc.add(PITHOS, mat(px, Q, pz, (R() - 0.5) * 0.04, R() * TAU, (R() - 0.5) * 0.04, sc), pick(CLAY)); tc.add(PITHOS, mat(173.3, Q + 0.37, 421.6, 0, -0.3, Math.PI / 2 - 0.05, 0.8), pick(CLAY)); basket(170.3, Q, 424.0, FILL.grain); collide(r); poi({ type: 'work', x: 170.8, z: 425.1, y: Q, ry: face(0, -1), note: 'cargo-drop' }); } }
    { const r = rect(176.4, 183.6, 420.6, 424.6); if (ok(r)) {
      for (const sz of [-1, 1]) B.woodDark.add(box(6.4, 0.2, 0.2), mat(180, Q + 0.1, 422.6 + sz * 0.6));
      for (let k = 0; k < 4; k++) B.wood.add(box(0.14, 0.1, 1.5), mat(177.6 + k * 1.5, Q + 0.25, 422.6));
      B.grey.add(box(3.0, 1.1, 1.3), mat(179.6, Q + 0.85, 422.6, 0, 0.03, 0)); pt.add(rod([178.4, Q + 1.41, 421.9], [178.4, Q + 1.41, 423.3], 0.04, 4), null, ROPE); pt.add(rod([180.8, Q + 1.41, 421.9], [180.8, Q + 1.41, 423.3], 0.04, 4), null, ROPE);
      for (let k = 0; k < 3; k++) pt.add(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 8).rotateX(Math.PI / 2), mat(182.3 + k * 0.45, Q + 0.12, 422.6 + (k - 1) * 0.15), OAK);
      pt.add(rod([183.2, Q + 0.3, 422.1], [185.2, Q + 0.02, 423.6], 0.03, 4), null, ROPE); collide(r); poi({ type: 'work', x: 180, z: 425.2, y: Q, ry: face(0, -1), note: 'marble blocks' }); } }
    { const r = rect(195.6, 201.8, 420.6, 424.2); if (ok(r)) { const m = mat(198.2, Q, 422.4, 0, 0.12, 0), W2 = (lx, ly, lz) => V(lx, ly, lz).applyMatrix4(m).toArray();
      for (const sz of [-1, 1]) { pt.add(new THREE.CylinderGeometry(0.45, 0.45, 0.07, 12).rotateX(Math.PI / 2), m.clone().multiply(mat(0, 0.45, sz * 0.62)), 0x5a4230); pt.add(new THREE.CylinderGeometry(0.08, 0.08, 0.14, 6).rotateX(Math.PI / 2), m.clone().multiply(mat(0, 0.45, sz * 0.62)), 0x3a2a1e); B.woodDark.add(rod(W2(-0.3, 0.58, sz * 0.48), W2(2.4, 0.05, sz * 0.3), 0.04, 5)); }
      B.woodDark.add(rod(W2(0, 0.45, -0.7), W2(0, 0.45, 0.7), 0.04, 5)); B.wood.add(box(1.5, 0.07, 1.0), m.clone().multiply(mat(-0.1, 0.55, 0, 0, 0, -0.1))); for (const sz of [-1, 1]) B.wood.add(box(1.5, 0.22, 0.05), m.clone().multiply(mat(-0.1, 0.69, sz * 0.5, 0, 0, -0.1)));
      for (let k = 0; k < 2; k++) bale(...W2(-0.35 + k * 0.1, 0.62 + k * 0.4, 0), 0.12 + (R() - 0.5) * 0.2); sack(...W2(1.5, 0, 0.9), R() * TAU); collide(r); } }
    { const r = rect(157.6, 162.4, 429.3, 430.0); if (ok(r)) { B.wood.add(box(4.6, 0.22, 0.3), mat(160, Q + 0.11, 429.7, 0, 0.02, 0)); B.wood.add(box(4.3, 0.22, 0.3), mat(160.1, Q + 0.33, 429.72, 0, -0.01, 0)); collide(r); for (const x of [158.6, 161.3]) poi({ type: 'seat', x, z: 430.15, ry: face(0, 1), note: 'porters resting' }); amph(162.8, Q, 429.4, R() * TAU, -0.28, 0.1); basket(157.2, Q, 429.1, FILL.olive); poi({ type: 'gather', x: 160, z: 432, y: Q, r: 1.6, note: 'porters resting' }); } }
    { const r = rect(176, 184, 428.2, 430.6); if (ok(r)) { for (const sx of [176.6, 180, 183.4]) B.woodDark.add(box(0.12, 0.1, 2.2), mat(sx, Q + 0.05, 429.4)); for (let l = 0; l < 3; l++) for (let j = 0; j < 4 - l; j++) B.wood.add(box(7.2 - l * 0.3, 0.26, 0.26), mat(180 + (R() - 0.5) * 0.2, Q + 0.23 + l * 0.27, 428.75 + j * 0.42 + l * 0.21, 0, (R() - 0.5) * 0.02, 0)); collide(r); } }
    { const r = rect(187, 195, 428.2, 431.2); if (ok(r)) { for (let layer = 0; layer < 3; layer++) for (let x = 187.3 + layer * 0.19; x < 194.8 - layer * 0.19; x += 0.38) { const dir = ((Math.round(x * 2.63) + layer) % 2) ? 1 : -1; amph(x, Q + 0.17 + layer * 0.29, 429.7 - dir * 0.42, 0, dir * Math.PI / 2, 0, true); } for (const z of [429.25, 430.15]) B.woodDark.add(box(8, 0.08, 0.1), mat(191, Q + 0.04, z)); collide(r); } }
    { const r = rect(197.5, 204.8, 428.2, 431); if (ok(r)) { for (let k = 0; k < 4; k++) bale(198.3 + k * 1.1, Q, 429.1, (R() - 0.5) * 0.1); for (let k = 0; k < 3; k++) bale(198.85 + k * 1.1, Q + 0.47, 429.15, (R() - 0.5) * 0.15); crate(199, Q, 430.4, 0.1); crate(201.2, Q, 430.4, -0.2, 0.9); sack(203.5, Q, 430.4, R() * TAU); collide(r); poi({ type: 'work', x: 201, z: 431.9, y: Q, ry: face(0, -1), note: 'cargo-drop' }); } }
    { const r = rect(201.6, 205.4, 435.4, 439.6); if (ok(r)) { crate(203.2, Q, 436.3, 0.1); crate(203.4, Q + 0.6, 436.4, -0.15, 0.85); crate(203.0, Q, 437.3, -0.05, 0.9); for (let k = 0; k < 4; k++) amph(202.3 + (k % 2) * 0.35, Q, 438.2 + k * 0.33, R() * TAU, 0, -(0.18 + R() * 0.06)); sack(204.6, Q, 438.9, R() * TAU); collide(r); } }
    { const r = rect(163.2, 168.8, 437.2, 439.6); if (ok(r)) { for (let k = 0; k < 4; k++) sackL(163.9 + k * 0.95, Q, 437.8, R() * 0.4); for (let k = 0; k < 3; k++) sackL(164.4 + k * 0.95, Q + 0.3, 437.85, R() * 0.4); sack(164.1, Q, 438.95, R() * TAU); sack(167.9, Q, 439.0, R() * TAU); basket(166.0, Q, 439.05, FILL.grain); collide(r); poi({ type: 'work', x: 166, z: 436.6, y: Q, ry: face(0, 1), note: 'cargo-drop' }); } }
    layout.addArea({ name: 'quay', note: 'apron', minX: 176, maxX: 203, minZ: 432, maxZ: 434.5, y: Q, owner: own });
    poi({ type: 'gather', x: 190, z: 433.3, y: Q, r: 2, note: 'quay apron' });
  }

  // ---------- steps down from the quay: westwards off its west end, northwards off its north edge by the east end (the causeway
  // of the palace road carries on from the east end itself) ----------
  {
    const tread = 0.42, fw = H(-246.5, 442.3), nw = Math.max(1, Math.ceil((Q - fw) / 0.34)), rw = (Q - fw) / nw, fe = H(238, 437.6), ne = Math.max(1, Math.ceil((Q - fe) / 0.34)), re = (Q - fe) / ne;
    for (let i = 0; i < nw; i++) { const top = Q - (i + 1) * rw; B.ashlar.add(box(tread + 0.02, top - fw + 1.2, 3.0), mat(-240 - (i + 0.5) * tread, (top + fw - 1.2) / 2, 442.3)); }
    for (let i = 0; i < ne; i++) { const top = Q - (i + 1) * re; B.ashlar.add(box(3.0, top - fe + 1.2, tread + 0.02), mat(238, (top + fe - 1.2) / 2, 440.5 - (i + 0.5) * tread)); }
    world.extraGround.push((x, z) => {
      if (x < -244 || x > -240 ? !(x > 236.5 && x < 239.5 && z < 440.5 && z > 440.5 - ne * tread) : (z < 440.8 || z > 443.8)) return -Infinity;
      return x < 0 ? Q - (Math.floor((-x - 240) / tread) + 1) * rw : Q - (Math.floor((440.5 - z) / tread) + 1) * re;
    });
  }

  // a fire: glowing bed and a sheaf of thin tongues, pale yellow at the root to red at the tips (s = size)
  function flame(x, y, z, s) {
    fireB.add(ramp2(ellipsoid(0.5 * s, 0.12 * s, 0.5 * s, 8, 4), -0.12 * s, 0.12 * s, 0x5a1a08, 0xff9a40), mat(x, y, z));
    for (let k = 0; k < 11; k++) {
      const core = k < 3, a = k * 2.4 + R(), d = core ? 0.06 * s : (0.18 + R() * 0.18) * s, h = (core ? 1.1 + R() * 0.5 : 0.45 + R() * 0.6) * s, r = (core ? 0.13 : 0.06 + R() * 0.06) * s;
      const g = ramp2(new THREE.ConeGeometry(r, h, 5, 2).translate(0, h / 2, 0), 0, h, core ? 0xfff0b8 : 0xffc768, 0xc8401a);
      fireB.add(g, mat(x + Math.cos(a) * d, y + 0.02, z + Math.sin(a) * d, Math.sin(a) * (core ? 0.05 : 0.22) + (R() - 0.5) * 0.12, 0, -Math.cos(a) * (core ? 0.05 : 0.22)));
    }
  }

  // =====================================================================
  // ---------- the moles: walkable tops, bollards, boats, beacons ----------
  // =====================================================================
  const moleSegs = [];
  for (const s of [-1, 1]) for (let i = 0; i < MOLE.length - 1; i++) {
    const [x0, z0] = MOLE[i], [x1, z1] = MOLE[i + 1], dx = s * (x1 - x0), dz = z1 - z0, len = Math.hypot(dx, dz);
    moleSegs.push({ s, i, cx: s * x0 + dx / 2, cz: z0 + dz / 2, ax: dx / len, az: dz / len, hl: len / 2 + 1, len, x0: s * x0, z0, bb: rect(Math.min(s * x0, s * x1) - 6, Math.max(s * x0, s * x1) + 6, z0 - 6, z1 + 6) });
  }
  const onMole = (x, z, w = 4.5) => { for (const m of moleSegs) { if (x < m.bb.minX || x > m.bb.maxX || z < m.bb.minZ || z > m.bb.maxZ) continue; const lx = x - m.cx, lz = z - m.cz; if (Math.abs(lx * m.ax + lz * m.az) < m.hl && Math.abs(-lx * m.az + lz * m.ax) < w) return m; } return null; };
  world.extraGround.push((x, z) => (Math.abs(x) > 212 && Math.abs(x) < 262 && z > 444 && z < 612 && onMole(x, z)) ? MT : -Infinity);
  // point on a mole: segment i, distance along it, offset across (+ = away from the harbour mouth's centre line)
  const moleAt = (s, d, off) => {
    let i = 0; while (i < 2 && d > moleSegs.find(m => m.s === s && m.i === i).len) { d -= moleSegs.find(m => m.s === s && m.i === i).len; i++; }
    const m = moleSegs.find(q => q.s === s && q.i === i), nx = m.az * s, nz = -m.ax * s;   // outward (away from x = 0)
    return { x: m.x0 + m.ax * d + nx * off, z: m.z0 + m.az * d + nz * off, ax: m.ax, az: m.az, nx, nz };
  };
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'west' : 'east';
    // tower: collider, a doorway facing the mole, beacon brazier on the upper drum
    const tx0 = s * 222, tz0 = 605;
    for (const [hx, hz] of [[3.5, 3.5], [5.0, 1.9], [1.9, 5.0]]) collide(rect(tx0 - hx, tx0 + hx, tz0 - hz, tz0 + hz));   // round tower, r ≈ 5 at the mole top
    { const m = moleSegs.find(q => q.s === s && q.i === 2), dx = -m.ax, dz = -m.az, ang = Math.atan2(dx, dz); B.doors.add(box(1.2, 2.3, 0.3), mat(tx0 + dx * 4.83, MT + 1.15, tz0 + dz * 4.83, 0, ang, 0)); B.grey.add(box(1.6, 0.25, 0.4), mat(tx0 + dx * 4.9, MT + 2.42, tz0 + dz * 4.9, 0, ang, 0)); }
    const by = SEA + 16;
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3; pt.add(rod([tx0 + Math.cos(a) * 0.75, by, tz0 + Math.sin(a) * 0.75], [tx0 + Math.cos(a) * 0.45, by + 1.05, tz0 + Math.sin(a) * 0.45], 0.05, 4), null, BRONZE); }
    pt.add(lathe([[0.06, 0], [0.42, 0.06], [0.64, 0.28], [0.7, 0.42], [0.66, 0.44]], 12), mat(tx0, by + 0.95, tz0, 0, 0, 0, 1.3), BRONZE);
    flame(tx0, by + 1.42, tz0, 1.7);
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3 + 0.9, fx = tx0 + Math.cos(a) * 1.45, fz = tz0 + Math.sin(a) * 1.45; for (let j = 0; j < 5; j++) B.woodDark.add(rod([fx - Math.sin(a) * 0.45, by + 0.1 + (j > 2 ? 0.16 : 0), fz + Math.cos(a) * 0.45], [fx + Math.sin(a) * 0.45, by + 0.1 + (j > 2 ? 0.16 : 0), fz - Math.cos(a) * 0.45], 0.07, 5).translate(Math.cos(a) * (j > 2 ? (j - 3.5) * 0.15 : (j - 1) * 0.15), 0, Math.sin(a) * (j > 2 ? (j - 3.5) * 0.15 : (j - 1) * 0.15))); }   // firewood for the night
    // walkable top: areas along the mole (each rectangle lies wholly on the top)
    for (let i = 0; i < 3; i++) {
      const m = moleSegs.find(q => q.s === s && q.i === i), n = Math.ceil(m.len / 9);
      for (let k = 0; k < n; k++) {
        const d0 = (k + 0.5) * m.len / n, cx = m.x0 + m.ax * d0, cz = m.z0 + m.az * d0, hx = Math.max(1, 3.2 - Math.abs(m.ax) * (m.len / n) / 2), hz = (m.len / n) / 2 * Math.abs(m.az) - 0.2;
        if (i === 2 && k === n - 1) continue;   // the tower
        layout.addArea({ name: 'mole', side, minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, y: MT, owner: own });
      }
    }
    // bollards on the harbour side, boats tied to some of them, fishermen, seats on the seaward edge
    const total = moleSegs.filter(q => q.s === s).reduce((a, q) => a + q.len, 0);
    for (let d = 14; d < total - 12; d += 15) {
      const p = moleAt(s, d, -3.7); if (roadD(p.x, p.z) < 4.5) continue;
      B.socles.add(new THREE.CylinderGeometry(0.28, 0.36, 0.85, 8), mat(p.x, MT + 0.42, p.z)); collide(rect(p.x - 0.35, p.x + 0.35, p.z - 0.35, p.z + 0.35));
    }
    const boatDs = s < 0 ? [36, 66, 112] : [42, 80, 128];
    for (const d of boatDs) {
      const p = moleAt(s, d, -7.3), ry = Math.atan2(-p.az, p.ax) + (R() - 0.5) * 0.15;
      boat(p.x, SEA + 0.04, p.z, ry, 0, 0, R() < 0.5);
      const bp = moleAt(s, Math.round((d - 14) / 15) * 15 + 14, -3.7);
      rope([p.x - p.ax * 2.4, SEA + 0.8, p.z - p.az * 2.4], [bp.x, MT + 0.75, bp.z], 0.5, 0.02);
    }
    for (const [d, kind] of [[24, 'fish'], [58, 'seat'], [74, 'fish'], [96, 'seat'], [120, 'nets'], [135, 'seat']]) {
      const out = kind === 'seat' ? 1 : -1, p = moleAt(s, d, out * 4.1), rx = p.x - p.nx * out * 0.9, rz = p.z - p.nz * out * 0.9;
      if (kind === 'seat') poi({ type: 'seat', x: p.x - p.nx * 0.2, z: p.z - p.nz * 0.2, y: MT, ry: face(p.nx, p.nz), note: 'mole edge', side });
      else if (kind === 'fish') {
        const tip = [p.x + p.nx * out * 3.4, MT + 2.2, p.z + p.nz * out * 3.4];
        B.woodDark.add(rod([rx, MT + 0.1, rz], tip, 0.035, 4, 0.015)); pt.add(rod(tip, [tip[0] + p.nx * out * 0.2, SEA + 0.02, tip[2] + p.nz * out * 0.2], 0.004, 3), null, 0xbdb4a0);
        basket(rx + p.ax * 0.8, MT, rz + p.az * 0.8, FILL.fish); B.socles.add(box(0.5, 0.35, 0.4), mat(rx - p.ax * 0.3, MT + 0.17, rz - p.az * 0.3));
        poi({ type: 'work', x: rx - p.nx * out * 0.6, z: rz - p.nz * out * 0.6, y: MT, ry: face(p.nx * out, p.nz * out), note: 'fishing', side });
      } else {
        const c = moleAt(s, d, 2.75);
        netFlat(c.x, MT, c.z, Math.atan2(-c.az, c.ax), 3.4, 1.5); ocollide(c.x, c.z, c.ax, c.az, 1.75, 0.8, 0.6);
        poi({ type: 'work', x: c.x - c.nx * 1.5 + c.ax * 0.8, z: c.z - c.nz * 1.5 + c.az * 0.8, y: MT, ry: face(c.nx, c.nz), note: 'mending nets', side });
      }
    }
    // along the top, out of the 3 m centre lane: coils by the bollards, baskets, stone benches facing the basin, a jar in a wicker ring
    for (const [d, off, kind] of [[30.1, -3.45, 'coil'], [61, -3.4, 'baskets'], [46, 3.6, 'bench'], [90.1, -3.45, 'coil'], [107.5, -3.45, 'jar'], [128.5, 3.6, 'bench'], [150.1, -3.45, 'coil']]) {
      const p = moleAt(s, d, off), ang = Math.atan2(-p.az, p.ax); if (roadD(p.x, p.z) < 4.5) continue;
      if (kind === 'coil') { coil(p.x, MT, p.z); if (R() < 0.5) coil(p.x + p.ax * 0.7, MT, p.z + p.az * 0.7); collide(rect(p.x - 0.5, p.x + 0.5, p.z - 0.5, p.z + 0.5)); }
      else if (kind === 'baskets') { basket(p.x, MT, p.z, FILL.fish); basket(p.x + p.ax * 0.6, MT, p.z + p.az * 0.6, FILL.grey); B.woodDark.add(box(0.9, 0.08, 0.3), mat(p.x + p.ax * 0.3 - p.nx * 0.5, MT + 0.04, p.z + p.az * 0.3 - p.nz * 0.5, 0, ang + 0.3, 0)); collide(rect(p.x - 0.6, p.x + 0.6, p.z - 0.6, p.z + 0.6)); }
      else if (kind === 'jar') { pt.add(new THREE.TorusGeometry(0.15, 0.045, 4, 9).rotateX(Math.PI / 2), mat(p.x, MT + 0.04, p.z), 0x7a6040); amph(p.x, MT + 0.02, p.z, R() * TAU, (R() - 0.5) * 0.08, (R() - 0.5) * 0.08); collide(rect(p.x - 0.35, p.x + 0.35, p.z - 0.35, p.z + 0.35)); }
      else { for (const e of [-0.65, 0.65]) B.socles.add(box(0.36, 0.34, 0.4), mat(p.x + p.ax * e, MT + 0.17, p.z + p.az * e, 0, ang, 0)); B.socles.add(box(1.8, 0.12, 0.5), mat(p.x, MT + 0.4, p.z, 0, ang, 0)); ocollide(p.x, p.z, p.ax, p.az, 0.95, 0.3, 0.5); poi({ type: 'seat', x: p.x - p.nx * 0.45, z: p.z - p.nz * 0.45, y: MT, ry: face(-p.nx, -p.nz), note: 'mole bench', side }); }
    }
    // at the tower foot: split firewood stacked against the drum beside the door; on the other side a bench under a canvas awning
    {
      const m2 = moleSegs.find(q => q.s === s && q.i === 2), dd = [-m2.ax, -m2.az], no = [m2.az * s, -m2.ax * s];
      const rad = th => [Math.cos(th) * dd[0] + Math.sin(th) * no[0], Math.cos(th) * dd[1] + Math.sin(th) * no[1]], at = (R_, th) => { const [rx_, rz_] = rad(th); return [tx0 + rx_ * R_, tz0 + rz_ * R_]; };
      for (let row = 0; row < 3; row++) for (let j = 0; j < 3 - row; j++) for (const th of [0.42, 0.62]) {
        const R_ = 5.2 + j * 0.19 + row * 0.095 + (th > 0.5 ? 0.02 : 0), [cx_, cz_] = at(R_, th), [rx_, rz_] = rad(th), tg = [-rz_, rx_], y = MT + 0.09 + row * 0.16, h = 0.36 + R() * 0.08;
        B.woodDark.add(rod([cx_ - tg[0] * h, y, cz_ - tg[1] * h], [cx_ + tg[0] * h, y, cz_ + tg[1] * h], 0.085, 6));
        for (const e of [-1, 1]) pt.add(new THREE.CircleGeometry(0.083, 6), mat(cx_ + tg[0] * h * e, y, cz_ + tg[1] * h * e, 0, Math.atan2(tg[0] * e, tg[1] * e), 0), 0xa8875e);
      }
      { const [a0x, a0z] = at(5.5, 0.52); collide(rect(a0x - 0.8, a0x + 0.8, a0z - 0.8, a0z + 0.8)); }
      // the awning: four poles, a sloping cloth (high over the lane side), a bench beneath it, a jar in its ring and a basket
      const d0 = total - 13.6, d1 = total - 10.4, o0 = -2.6, o1 = -4.2, hi = MT + 2.55, lo = MT + 2.1, c0 = moleAt(s, (d0 + d1) / 2, (o0 + o1) / 2);
      for (const d of [d0, d1]) for (const o of [o0, o1]) { const q = moleAt(s, d, o), top = o === o0 ? hi : lo; B.woodDark.add(rod([q.x, MT, q.z], [q.x, top, q.z], 0.05, 5)); collide(rect(q.x - 0.2, q.x + 0.2, q.z - 0.2, q.z + 0.2)); }
      pt.add(box(d1 - d0 + 0.5, 0.03, Math.hypot(o1 - o0, hi - lo) + 0.35), frame([c0.x, (hi + lo) / 2 + 0.06, c0.z], [c0.ax, 0, c0.az], [c0.nx * (o1 - o0), lo - hi, c0.nz * (o1 - o0)]), 0x9a6a3e);
      { const q = moleAt(s, (d0 + d1) / 2, o1 - 0.12); pt.add(box(d1 - d0 + 0.5, 0.28, 0.03), mat(q.x, lo - 0.08, q.z, 0, Math.atan2(-c0.az, c0.ax), 0), 0x9a6a3e); }
      { const q = moleAt(s, (d0 + d1) / 2 + 0.3, -3.55), ang = Math.atan2(-q.az, q.ax); B.socles.add(box(1.7, 0.12, 0.45), mat(q.x, MT + 0.4, q.z, 0, ang, 0)); for (const e of [-0.6, 0.6]) B.socles.add(box(0.36, 0.34, 0.38), mat(q.x + q.ax * e, MT + 0.17, q.z + q.az * e, 0, ang, 0)); ocollide(q.x, q.z, q.ax, q.az, 0.9, 0.3, 0.5); poi({ type: 'seat', x: q.x + q.nx * 0.45, z: q.z + q.nz * 0.45, y: MT, ry: face(q.nx, q.nz), note: 'beacon keeper', side }); }
      { const q = moleAt(s, d0 + 0.45, -3.4); pt.add(new THREE.TorusGeometry(0.15, 0.045, 4, 9).rotateX(Math.PI / 2), mat(q.x, MT + 0.04, q.z), 0x7a6040); amph(q.x, MT + 0.02, q.z, R() * TAU, 0.05, 0); collide(rect(q.x - 0.3, q.x + 0.3, q.z - 0.3, q.z + 0.3)); }
      { const q = moleAt(s, d1 - 0.2, -3.5); basket(q.x, MT, q.z, FILL.grey); collide(rect(q.x - 0.3, q.x + 0.3, q.z - 0.3, q.z + 0.3)); }
    }
    const end = moleAt(s, total - 9, 0);
    for (const o of [-2.6, 2.6]) poi({ type: 'view', x: end.x + end.nx * o, z: end.z + end.nz * o, y: MT, ry: face(end.ax + end.nx * Math.sign(o) * 0.8, end.az + end.nz * Math.sign(o) * 0.8), note: 'harbour mouth', side });
    poi({ type: 'gather', x: end.x - end.ax * 6, z: end.z - end.az * 6, y: MT, r: 2.5, note: 'mole end', side });
  }

  // ---------- boats ----------
  // plain: every part in the painted mesh, which is drawn before the basin's depth skin (see the basin below)
  function boat(x, y, z, ry, pitch = 0, roll = 0, oars = true, len = 5.2 + R() * 1.4, plain = false) {
    const wid = 1.55 + len * 0.05, h = hullGeo(len, wid, 0.62), m = mat(x, y, z, 0, ry, 0).multiply(mat(0, 0, 0, roll, 0, pitch));
    const wd = plain ? { add: (g, mm) => pt.add(g, mm, 0x8a6a48) } : B.wood, wdk = plain ? { add: (g, mm) => pt.add(g, mm || null, 0x4a3524) } : B.woodDark;
    pt.add(h.outer, m, PITCH); pt.add(h.band, m, pick(BAND)); pt.add(h.inner, m, OAK);
    for (const t of [-0.22, 0.2]) wd.add(box(0.22, 0.05, wid * Math.pow(1 - 4 * t * t, 0.55) - 0.08), m.clone().multiply(mat(t * len, 0.5, 0)));
    const ew = wid / 2 * Math.pow(1 - 0.76 * 0.76, 0.55) * 0.97 + 0.012;
    for (const sz of [-1, 1]) { pt.add(new THREE.CircleGeometry(0.065, 10), m.clone().multiply(mat(len * 0.38, 0.7, sz * ew, 0, sz > 0 ? 0.45 : Math.PI - 0.45, 0)), 0xd8cfbf); pt.add(new THREE.CircleGeometry(0.032, 8), m.clone().multiply(mat(len * 0.38 + 0.01, 0.7, sz * (ew + 0.006), 0, sz > 0 ? 0.45 : Math.PI - 0.45, 0)), 0x1e1a18); }
    if (oars) for (const sz of [-1, 1]) wdk.add(rod([-len * 0.35, 0.52, sz * 0.25], [len * 0.28, 0.42, sz * 0.1], 0.03, 4), m);
    if (R() < 0.6) cl.add(ellipsoid(0.45, 0.15, 0.35, 6, 4), m.clone().multiply(mat(-len * 0.12, 0.25, 0)), pick([0x6e5a40, 0x7a6a50, 0x5e5040]));
    if (R() < 0.5) basket(...V(-len * 0.3, 0.3, 0.1).applyMatrix4(m).toArray(), FILL.fish);
  }
  // beached boat: bow up the beach towards (dx, dz); keel resting on the terrain (upturned: on two trestle blocks under the gunwales)
  function beach(x, z, dx, dz, { oars = true, upturned = false, net = false } = {}) {
    const len = 5.2 + R() * 1.4, l = Math.hypot(dx, dz), ax = dx / l, az = dz / l;
    // drawn right up on dry sand: bow, stern and both beams above the waterline, or push it further up the beach
    const dry = (px, pz) => [[0.5, 0], [-0.5, 0], [0, 0.55], [0, -0.55]].every(([a, b]) => H(px + ax * len * a - az * b * 1.6, pz + az * len * a + ax * b * 1.6) > SEA + 0.2);
    let k = 0; while (k < 12 && !dry(x, z)) { x += ax * 0.5; z += az * 0.5; k++; }
    if (!dry(x, z) || (k && !free(rect(x - 3.4, x + 3.4, z - 3.4, z + 3.4), 6.6, 0.2))) return false;
    const hb = H(x + ax * len * 0.35, z + az * len * 0.35), hs = H(x - ax * len * 0.35, z - az * len * 0.35), pitch = Math.atan2(hb - hs, len * 0.7);
    const ry = Math.atan2(-az, ax), base = Math.max(H(x, z), (hb + hs) / 2) - 0.04;
    if (upturned) {
      const h = hullGeo(len, 1.6, 0.62), hy = base + 0.3 + 0.74, m = mat(x, hy, z, 0, ry, 0).multiply(mat(0, 0, 0, Math.PI, 0, -pitch));
      pt.add(h.outer, m, PITCH); pt.add(h.band, m, pick(BAND)); pt.add(h.inner, m, OAK);
      for (const t of [-0.6, 0.6]) {   // each block reaches from the sand to the gunwale above it, and is longer than the beam
        const gw = V(t * len / 2, 0.62 + 0.22 * t * t * (t > 0 ? 1.5 : 1), 0).applyMatrix4(m), gy = H(gw.x, gw.z) - 0.08;
        B.woodDark.add(box(0.26, gw.y - gy, 2.2), mat(gw.x, (gw.y + gy) / 2, gw.z, 0, ry, 0));
      }
      if (net) netDrape(x, base, z, ry, 2.3, { rack: false, top: hy - base + 0.05, hw: 0.92, hh: 0.68, hang: [1.5 + R() * 0.2, 1.75 + R() * 0.3], tilt: pitch });
    }
    else boat(x, base, z, ry, pitch, (R() - 0.5) * 0.14, oars, len);
    ocollide(x, z, ax, az, len / 2, upturned ? 1.1 : 0.85, 0.45);
    poi({ type: 'work', x: x + az * (upturned ? 2.1 : 1.9), z: z - ax * (upturned ? 2.1 : 1.9), ry: face(-az, ax), note: upturned ? 'tarring a hull' : 'boat' });
    return { x, z, ax, az, len, base, pitch };
  }
  // fishing net: a 64 px diamond mesh; its mips keep the twine thin (anisotropic, so a net lying on the sand stays open) until one
  // texel holds a whole mesh, where it turns just solid enough not to vanish at a distance
  const NETTEX = (() => {
    const S = 64, d = new Uint8Array(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const i = (y * S + x) * 4, on = ((x + y) % 8 < 1) || ((x - y + 64) % 8 < 1); d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = on ? 255 : 0; }
    const mips = [{ data: d, width: S, height: S }];
    for (let s = S / 2; s >= 1; s /= 2) { const p = mips[mips.length - 1].data, q = new Uint8Array(s * s * 4); for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) { let a = 0; for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) a += p[((y * 2 + dy) * s * 2 + x * 2 + dx) * 4 + 3]; const i = (y * s + x) * 4; q[i] = q[i + 1] = q[i + 2] = 255; q[i + 3] = Math.min(255, a / 4 * (s === 8 ? 1.4 : 1.1)); } mips.push({ data: q, width: s, height: s }); }
    const t = new THREE.DataTexture(d, S, S); t.mipmaps = mips; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 8; t.generateMipmaps = false; t.needsUpdate = true; return t;
  })();
  // a net hung over a support running along local x — a pole resting in two crossed-stick A-frames (rack), or an upturned hull
  // (hw = half-beam, hh = depth) — both sides falling unevenly to the sand and trailing there in folds; cork floats along one
  // edge, stone sinkers along the other
  function netDrape(x, y, z, ry, w, { rack = true, top = 1.55, hw = 0.05, hh = 0.05, hang = [1.0 + R() * 0.3, 2.4 + R() * 0.3], tilt = 0 } = {}) {
    const c = Math.cos(ry), s = Math.sin(ry), NX = 16, NY = 18, pos = [], uv = [], idx = [], ph = [R() * TAU, R() * TAU, R() * TAU, R() * TAU], edges = [[], []];
    const gl = (lx, lz) => H(x + c * lx + s * lz, z - s * lx + c * lz) - y;   // the sand under a local point
    const P = Math.PI / 2 * Math.sqrt((hw * hw + hh * hh) / 2), fa = 0.52 + 0.12 * ph[0] / TAU, fb = fa + 0.26 + 0.08 * ph[1] / TAU;
    const foldOver = u => rack ? smoothstep(fa - 0.07, fa + 0.03, u) * (1 - smoothstep(fb - 0.03, fb + 0.07, u)) : 0;   // part of a rack's net lies back over the pole
    for (let i = 0; i <= NX; i++) for (let j = 0; j <= NY; j++) {
      const u = i / NX, v = j / NY * 2 - 1, side = v < 0 ? -1 : 1, a = Math.abs(v);
      const fo = foldOver(u), L0 = (rack && side < 0 ? hang[0] * (0.42 + 0.95 * Math.pow(Math.abs(Math.sin(u * Math.PI * 2 + ph[0])), 0.7)) : rack ? hang[1] * (0.62 + 0.5 * Math.pow(Math.abs(Math.sin(u * Math.PI * 2.5 + ph[1])), 0.6)) : hang[side < 0 ? 0 : 1] * (1 + 0.16 * Math.sin(u * 5.3 + ph[side < 0 ? 0 : 1]))) * (1 + 0.08 * Math.sin(u * 14.1 + ph[2]));   // a rack's near side hangs very unevenly, its far side in deep scallops
      const L = rack ? (side < 0 ? lerp(L0, 0.32 + 0.1 * Math.sin(u * 19 + ph[1]), fo) : L0 + fo * 0.5) : L0, d = a * L;
      const ridge = (rack ? top - 0.06 * Math.sin(u * Math.PI) - (1 - fo) * 0.26 * Math.pow(Math.abs(Math.sin(u * TAU)), 0.75) : top - 0.12 * (2 * u - 1) ** 2) + (u - 0.5) * w * Math.tan(tilt);   // sagging between the ties at the ends and the middle
      const lx = (u - 0.5) * w + (rack ? 0.24 : 0.12) * Math.min(1, d / 0.9) * Math.sin(u * TAU * 2.5 + ph[3]) * Math.sin(u * Math.PI);   // gathered into bunches as it hangs
      const fold = r => 0.15 * Math.min(1, r / 0.6) * (0.6 + 0.4 * Math.sin(u * 7.7 + ph[0])) * Math.sin(u * TAU * 4.5 + ph[side < 0 ? 1 : 2] + r * 1.3);   // deep vertical pleats
      let ly, lz;
      if (d < P) { const th = d / P * Math.PI / 2; lz = side * hw * Math.sin(th); ly = ridge - hh * (1 - Math.cos(th)); }
      else {
        const r = d - P, fall = Math.max(0, ridge - hh - gl(lx, side * hw) - 0.03);
        if (r < fall) { lz = side * (hw + 0.05 * r + 0.08 + fold(r)); ly = ridge - hh - r; }
        else { const q = r - fall; lz = side * (hw + 0.05 * fall + 0.08 + fold(fall) + q * 0.7); ly = gl(lx, lz) + 0.03 + 0.2 * Math.max(0, Math.sin(u * 11 + ph[side < 0 ? 2 : 3])) * Math.min(1, q * 3) * Math.exp(-q * 1.5); }
      }
      pos.push(lx, ly, lz); uv.push((u - 0.5) * w / 0.26, (side * d) / 0.34);   // meshes squeezed where it bunches, drawn out long by the weight
      if (j === 0 || j === NY) edges[j ? 1 : 0].push([lx, ly, lz]);
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) { const a = i * (NY + 1) + j, b = a + NY + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = mat(x, y, z, 0, ry, 0); netB.add(g, m); netEdges(edges, m);
    if (rack) {
      for (const ex of [-w / 2 - 0.12, w / 2 + 0.12]) {   // two sticks crossed and lashed, the pole lying in the crotch
        const g0 = gl(ex, 0), cy = top - 0.1, tip = cy + 0.3;
        for (const sg of [-1, 1]) { const f = [ex + sg * 0.04, g0 - 0.2, sg * 0.72], k = (tip - f[1]) / (cy - f[1]); B.woodDark.add(rod(f, [ex + sg * 0.04, tip, sg * 0.72 * (1 - k)], 0.045, 5, 0.035).applyMatrix4(m)); }
        pt.add(new THREE.TorusGeometry(0.07, 0.02, 3, 8).rotateY(Math.PI / 2), m.clone().multiply(mat(ex, cy + 0.02, 0)), ROPE);
      }
      // the stretch folded back over the pole: a second, bunched layer hanging on the near side
      { const fw = (fb - fa) * w + 0.3, fc = ((fa + fb) / 2 - 0.5) * w, q = V(fc, 0, 0).applyMatrix4(mat(0, 0, 0, 0, ry, 0)); netDrape(x + q.x, y, z + q.z, ry, fw, { rack: false, top: top + 0.02, hw: 0.09, hh: 0.07, hang: [0.85 + R() * 0.25, 0.3] }); }
      for (const u of [0.01, 0.5, 0.99]) pt.add(new THREE.TorusGeometry(0.065, 0.016, 3, 7).rotateY(Math.PI / 2), m.clone().multiply(mat((u - 0.5) * w, top - 0.05 - 0.06 * Math.sin(u * Math.PI), 0)), ROPE);   // the three ties
      let prev = [-w / 2 - 0.32, top - 0.05, 0]; for (let t = 1; t <= 4; t++) { const lx = lerp(-w / 2 - 0.32, w / 2 + 0.32, t / 4), q = [lx, top - 0.05 - 0.06 * Math.sin(clamp(lx / w + 0.5, 0, 1) * Math.PI), 0]; B.woodDark.add(rod(prev, q, 0.045, 6).applyMatrix4(m)); prev = q; }
    }
  }
  // a net spread flat on the ground to dry (lumpy, one edge folded back), or heaped up in a pile
  function netFlat(x, y, z, ry, w, d, ground = null) {
    const c = Math.cos(ry), s = Math.sin(ry), NX = 12, NY = 8, pos = [], uv = [], idx = [], ph = R() * TAU, edges = [[], []];
    for (let i = 0; i <= NX; i++) for (let j = 0; j <= NY; j++) {
      const u = i / NX, v = j / NY, lx = (u - 0.5) * w, lz = (v - 0.5) * d, gy = ground ? ground(x + c * lx + s * lz, z - s * lx + c * lz) - y : 0;
      const ly = gy + 0.03 + 0.09 * Math.max(0, Math.sin(u * 9 + v * 5 + ph)) * Math.sin(v * Math.PI) + 0.05 * Math.sin(u * 23 + ph) * Math.sin(v * Math.PI);
      pos.push(lx, ly, lz); uv.push(lx / 0.36, lz / 0.36); if (j === 0 || j === NY) edges[j ? 1 : 0].push([lx, ly, lz]);
    }
    for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) { const a = i * (NY + 1) + j, b = a + NY + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = mat(x, y, z, 0, ry, 0); netB.add(g, m); netEdges(edges, m);
  }
  function netHeap(x, z, r = 0.75) {
    const y = H(x, z), g = new THREE.SphereGeometry(1, 12, 5, 0, TAU, 0, Math.PI / 2), p = g.attributes.position, uvs = g.attributes.uv, ph = R() * TAU;
    for (let i = 0; i < p.count; i++) { const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), a = Math.atan2(pz, px), k = 1 + 0.18 * Math.sin(a * 3 + ph) + 0.1 * Math.sin(a * 7 + py * 4); p.setXYZ(i, px * r * k, py * r * 0.45 * (0.8 + 0.3 * Math.sin(a * 5 + ph)) - 0.02, pz * r * 0.8 * k); uvs.setXY(i, uvs.getX(i) * TAU * r / 0.36, uvs.getY(i) * r * 1.6 / 0.36); }
    g.computeVertexNormals(); netB.add(g, mat(x, y, z, 0, R() * TAU, 0));
    for (let k = 0; k < 9; k++) { const a = R() * TAU, q = 0.3 + R() * 0.7; pt.add(CORK, mat(x + Math.cos(a) * r * q, y + r * 0.45 * Math.sqrt(1 - q * q) * 0.9 + 0.01, z + Math.sin(a) * r * 0.8 * q, R() - 0.5, R() * TAU, R() - 0.5), 0x4a3b2c); }
  }
  // cork floats along one edge of a net, stone sinkers along the other
  function netEdges(edges, m) {
    for (let i = 0; i < edges[0].length; i += 2) { const [lx, ly, lz] = edges[0][i]; pt.add(CORK, m.clone().multiply(mat(lx, ly + 0.02, lz, (R() - 0.5) * 0.8, R() * TAU, (R() - 0.5) * 0.8)), 0x4a3b2c); }
    for (let i = 1; i < edges[1].length; i += 2) { const [lx, ly, lz] = edges[1][i]; pt.add(SINKER, m.clone().multiply(mat(lx, ly + 0.01, lz, 0, R() * TAU, 0)), 0x57534c); }
  }
  // salted fish drying: a pole in two crossed-stick frames and a cord below it; long narrow bodies, head down, silver bellies and
  // dark backs, hung at uneven intervals; a basket of salt and one of fish on the sand underneath
  function fishFrame(x, z, ry, w = 2.8) {
    const y = H(x, z), m = mat(x, y, z, 0, ry, 0), top = 1.75, c = Math.cos(ry), s = Math.sin(ry);
    const gl = lx => H(x + c * lx, z - s * lx) - y;
    for (const ex of [-w / 2 - 0.15, w / 2 + 0.15]) { const g0 = gl(ex), cy = top - 0.1, tip = cy + 0.28; for (const sg of [-1, 1]) { const f = [ex + sg * 0.04, g0 - 0.2, sg * 0.7], k = (tip - f[1]) / (cy - f[1]); B.woodDark.add(rod(f, [ex + sg * 0.04, tip, sg * 0.7 * (1 - k)], 0.04, 5, 0.03).applyMatrix4(m)); } }
    B.woodDark.add(rod([-w / 2 - 0.45, top - 0.05, 0], [w / 2 + 0.45, top - 0.07, 0], 0.04, 6).applyMatrix4(m));
    const cordZ = 0.7 * (1 - (1.05 + 0.2) / (top - 0.1 + 0.2)), cordP = [-w / 2 - 0.15, 1.05, cordZ], cordQ = [w / 2 + 0.15, 1.05 + (gl(w / 2) - gl(-w / 2)) * 0.5, cordZ];
    rope(V(...cordP).applyMatrix4(m).toArray(), V(...cordQ).applyMatrix4(m).toArray(), 0.1, 0.012, ROPE, 5);
    for (const [hy, hz, sag] of [[top - 0.09, 0, 0.02], [1.04, cordZ, 0.1]]) for (let fx = -w / 2 + 0.12; fx < w / 2 - 0.08; fx += 0.15 + R() * 0.2) {
      if (R() < 0.18) continue;
      const yy = hy - sag * 4 * (fx / w + 0.5) * (0.5 - fx / w) + (hz ? (gl(w / 2) - gl(-w / 2)) * 0.5 * (fx / w + 0.5) : 0);
      fish(m.clone().multiply(mat(fx, yy, hz + (R() - 0.5) * 0.03, (R() - 0.5) * 0.25, R() * 1.2 - 0.6, (R() - 0.5) * 0.3, 0.9 + R() * 0.25)));
    }
    const ba = V(-0.5, 0, 0.1).applyMatrix4(m), bq = V(0.7, 0, -0.15).applyMatrix4(m); basket(ba.x, H(ba.x, ba.z), ba.z, FILL.salt); basket(bq.x, H(bq.x, bq.z), bq.z, FILL.fish);
  }

  // =====================================================================
  // ---------- storehouses ----------
  // =====================================================================
  const steps = [];
  // A storehouse on the slope is built as a terrace of sections along its length, each with its own floor level
  // (at most ~0.75 m cut into the hill, at most three steps up to each door) and its own stepped gable roof.
  function storehouse(X0, X1, Z0, Z1, side, { wallH = 5.0, pentice = false, sections = 1, forecourt = false } = {}) {
    const [nx, nz] = { S: [0, 1], N: [0, -1], E: [1, 0], W: [-1, 0] }[side], alongX = nx === 0;
    const site = rect(X0 - 0.3 + Math.min(0, nx) * 4, X1 + 0.3 + Math.max(0, nx) * 4, Z0 - 0.3 + Math.min(0, nz) * 4, Z1 + 0.3 + Math.max(0, nz) * 4);
    if (!free(site, 6.6)) return;   // someone else built here
    const pc = pick(PLAST), rc = pick(ROOFC), Fs = [];
    collide(rect(X0 - 0.3, X1 + 0.3, Z0 - 0.3, Z1 + 0.3));
    // a front at the waterline gets a forecourt: an ashlar platform clear of the wet sand, its face to the water, the pentice on it
    let G2 = H;
    if (forecourt) {
      const dep = 3.9, fr = alongX ? rect(X0 - 0.3, X1 + 0.3, nz > 0 ? Z1 + 0.1 : Z0 - dep, nz > 0 ? Z1 + dep : Z0 - 0.1) : rect(nx > 0 ? X1 + 0.1 : X0 - dep, nx > 0 ? X1 + dep : X0 - 0.1, Z0 - 0.3, Z1 + 0.3);
      let top = SEA + 0.75, low = 1e9; for (let i = 0; i <= 12; i++) for (let j = 0; j <= 3; j++) { const h = H(lerp(fr.minX, fr.maxX, i / 12), lerp(fr.minZ, fr.maxZ, j / 3)); top = Math.max(top, h + 0.2); low = Math.min(low, h); }
      const fw = fr.maxX - fr.minX, fd = fr.maxZ - fr.minZ, fcx = (fr.minX + fr.maxX) / 2, fcz = (fr.minZ + fr.maxZ) / 2;
      B.ashlar.add(box(fw, top - low + 1.0, fd), mat(fcx, (top + low - 1.0) / 2, fcz));
      B.pave.add(scaleUV(new THREE.PlaneGeometry(fw, fd), fw, fd).rotateX(-Math.PI / 2), mat(fcx, top + 0.01, fcz));
      world.extraGround.push((x, z) => (x > fr.minX && x < fr.maxX && z > fr.minZ && z < fr.maxZ) ? top : -Infinity);
      G2 = (x, z) => (x > fr.minX && x < fr.maxX && z > fr.minZ && z < fr.maxZ) ? Math.max(top, H(x, z)) : H(x, z);
      // a kerb collider along every edge that drops more than half a metre
      const edge = (x0, z0, x1, z1) => { const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 1.5); let run = null; const out = () => { if (run) collide(rect(Math.min(run[0], run[2]) - 0.15, Math.max(run[0], run[2]) + 0.15, Math.min(run[1], run[3]) - 0.15, Math.max(run[1], run[3]) + 0.15)); run = null; };
        for (let k = 0; k <= n; k++) { const x = lerp(x0, x1, k / n), z = lerp(z0, z1, k / n), xo = x + (alongX ? 0 : nx) * 0.6 + (x === fr.minX && alongX ? -0.6 : x === fr.maxX && alongX ? 0.6 : 0), zo = z + (alongX ? nz : 0) * 0.6; if (top - H(xo, zo) > 0.5) { if (run) { run[2] = x; run[3] = z; } else run = [x, z, x, z]; } else out(); } out(); };
      if (alongX) { const zf = nz > 0 ? fr.maxZ : fr.minZ; edge(fr.minX, zf, fr.maxX, zf); for (const xe of [fr.minX, fr.maxX]) edge(xe, fr.minZ, xe, fr.maxZ); }
      else { const xf = nx > 0 ? fr.maxX : fr.minX; edge(xf, fr.minZ, xf, fr.maxZ); for (const ze of [fr.minZ, fr.maxZ]) edge(fr.minX, ze, fr.maxX, ze); }
    }
    for (let si = 0; si < sections; si++) {
      const a0 = si / sections, a1 = (si + 1) / sections;
      Fs.push(alongX ? section(lerp(X0, X1, a0), lerp(X0, X1, a1), Z0, Z1, si) : section(X0, X1, lerp(Z0, Z1, a0), lerp(Z0, Z1, a1), si));
    }
    return Fs;
    function section(x0, x1, z0, z1, si) {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const along = nx === 0 ? w : d, n = Math.max(1, Math.floor((along - 3) / 6.5)), fx = nx === 0 ? null : (nx > 0 ? x1 : x0), fz = nz === 0 ? null : (nz > 0 ? z1 : z0);
    const at = a => nx === 0 ? [cx + a, fz] : [fx, cz + a];
    const doorA = k => (k - (n - 1) / 2) * (along - 3) / Math.max(1, n);
    let hmax = -1e9, hmin = 1e9; for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) { const h = H(lerp(x0 - 1, x1 + 1, i / 8), lerp(z0 - 1, z1 + 1, j / 8)); hmax = Math.max(hmax, h); hmin = Math.min(hmin, h); }
    let hd = -1e9; for (let i = 0; i <= 6; i++) { const a = lerp(-0.45, 0.45, i / 6); hd = Math.max(hd, G2(cx + (nx === 0 ? a * w : nx * (w / 2 + 1.2)), cz + (nz === 0 ? a * d : nz * (d / 2 + 1.2)))); }
    let hfMin = 1e9; for (let k = 0; k < n; k++) { const [px, pz] = at(doorA(k)); hfMin = Math.min(hfMin, G2(px + nx * 1.2, pz + nz * 1.2)); }
    const F = Math.min(Math.max(hd + 0.3, hmax - 0.75), hfMin + 0.95);
    B.socles.add(box(w + 0.3, F - hmin + 1.2, d + 0.3), mat(cx, (F + hmin - 1.2) / 2, cz));
    B.walls.add(box(w, wallH, d), mat(cx, F + wallH / 2, cz), pc);
    const ridgeX = sections > 1 ? alongX : w >= d;
    B.roofs.add(ridgeRoof(ridgeX ? w : d, ridgeX ? d : w, ridgeX), mat(cx, F + wallH, cz), rc); B.walls.add(ridgeEnds(ridgeX ? w : d, ridgeX ? d : w, ridgeX), mat(cx, F + wallH, cz), pc);
    B.walls.add(box(w + 0.5, 0.18, d + 0.5), mat(cx, F + wallH - 0.05, cz), 0xd8ccb8);
    const ry = nx === 0 ? 0 : Math.PI / 2;
    // high slit windows on the long walls
    for (const sgn of [-1, 1]) for (let a = -along / 2 + 2; a < along / 2 - 1.5; a += 3.2) { const p = nx === 0 ? [cx + a, cz + sgn * (d / 2 + 0.02)] : [cx + sgn * (w / 2 + 0.02), cz + a]; B.doors.add(box(0.7, 0.32, 0.12), mat(p[0], F + wallH - 0.85, p[1], 0, ry, 0)); }
    for (let k = 0; k < n; k++) {
      const a = doorA(k), [px, pz] = at(a), open = R() < 0.5;
      const m = mat(px, F, pz, 0, ry, 0);
      B.doors.add(box(2.4, 3.0, 0.2), m.clone().multiply(mat(0, 1.5, 0)));
      B.woodDark.add(box(3.1, 0.32, 0.36), m.clone().multiply(mat(0, 3.16, 0)));
      for (const s of [-1, 1]) B.woodDark.add(box(0.24, 3.0, 0.3), m.clone().multiply(mat(s * 1.32, 1.5, 0)));
      const sg = (nz || nx);   // outward along the local z of the door frame
      if (open) for (const s of [-1, 1]) B.wood.add(box(1.18, 2.9, 0.08), m.clone().multiply(mat(s * 1.3, 1.47, sg * 0.62, 0, s * sg * 1.35, 0)));
      else for (const s of [-1, 1]) B.wood.add(box(1.16, 2.9, 0.08), m.clone().multiply(mat(s * 0.59, 1.47, sg * 0.13)));
      // threshold steps down to the yard
      const fxw = px + nx * 1.2, fzw = pz + nz * 1.2, hf = G2(fxw, fzw), drop = F - hf, ns = Math.max(0, Math.ceil(drop / 0.32));
      for (let i = 0; i < ns; i++) { const top = F - i * drop / ns, cxs = px + nx * (0.45 + i * 0.45), czs = pz + nz * (0.45 + i * 0.45); B.socles.add(box(nx ? 0.46 : 2.9, top - hf + 0.4, nx ? 2.9 : 0.46), mat(cxs, (top + hf - 0.4) / 2, czs)); steps.push({ r: rect(cxs - (nx ? 0.23 : 1.6), cxs + (nx ? 0.23 : 1.6), czs - (nx ? 1.6 : 0.23), czs + (nx ? 1.6 : 0.23)), y: top }); }
      const off = 0.8 + ns * 0.45;
      poi({ type: 'door', x: px + nx * off, z: pz + nz * off, nx, nz, y: F, note: 'storehouse' });
      poi({ type: 'work', x: px + nx * (off + 0.6), z: pz + nz * (off + 0.6), ry: face(-nx, -nz), note: 'cargo-drop' });
      // goods waiting at some doors
      if (R() < 0.65) { const sd = R() < 0.5 ? 1 : -1, tx2 = nz * sd, tz2 = nx * sd; for (let q = 0; q < 4; q++) { const ox = px + nx * 0.46 + tx2 * (2.0 + q * 0.42), oz = pz + nz * 0.46 + tz2 * (2.0 + q * 0.42), gy = G2(ox, oz); if (q < 3 && R() < 0.6) { const a = leanTilt(0.46, F - gy + 0.06, 0.15); tc.add(AMPH, mat(ox, gy - 0.06, oz, -nz * a, 0, nx * a).multiply(mat(0, 0, 0, 0, R() * TAU, 0)), pick(CLAY)); } else sack(ox + nx * 0.2, gy, oz + nz * 0.2, R() * TAU); } }   // jars leaning on the wall or its socle
    }
    if (pentice) {
      const depth = 2.8, len = along - (sections > 1 ? 0.1 : 1), yA = F + 3.9, yB = F + 3.3;
      for (let a = -len / 2; a <= len / 2 + 0.01; a += len / Math.round(len / 4)) { if (a > len / 2 - 0.01 && si < sections - 1) continue; const [px, pz] = at(a), qx = px + nx * depth, qz = pz + nz * depth, gy = G2(qx, qz); B.woodDark.add(rod([qx, gy - 0.2, qz], [qx, yB - 0.33, qz], 0.11, 6)); collide(rect(qx - 0.2, qx + 0.2, qz - 0.2, qz + 0.2)); }
      const [c0x, c0z] = at(0), mid = [c0x + nx * depth / 2, (yA + yB) / 2 + 0.1, c0z + nz * depth / 2];
      const fr = frame(mid, nx === 0 ? [1, 0, 0] : [0, 0, 1], [nx * depth, yB - yA, nz * depth]);
      B.roofs.add(box(len + 0.6, 0.12, Math.hypot(depth, yA - yB) + 0.5), fr, rc);
      // under the tiles a boarded ceiling on rafters, so the tile slab's underside is never seen from the forecourt
      const sl = Math.hypot(depth, yA - yB); B.wood.add(box(len + 0.4, 0.04, sl + 0.1), fr.clone().multiply(mat(0, -0.16, -0.05)));
      for (let a = -len / 2 - 0.1; a <= len / 2 + 0.11; a += (len + 0.2) / Math.round((len + 0.2) / 0.6)) B.woodDark.add(box(0.09, 0.12, sl + 0.05), fr.clone().multiply(mat(a, -0.24, -0.05)));
      B.woodDark.add(box(nx === 0 ? len + 0.4 : 0.22, 0.22, nx === 0 ? 0.22 : len + 0.4), mat(c0x + nx * depth, yB - 0.3, c0z + nz * depth));   // the beam the rafters rest on
    }
    if (steps.length) { const my = steps.splice(0), bb = my.reduce((a, st) => rect(Math.min(a.minX, st.r.minX), Math.max(a.maxX, st.r.maxX), Math.min(a.minZ, st.r.minZ), Math.max(a.maxZ, st.r.maxZ)), my[0].r); world.extraGround.push((x, z) => { if (x < bb.minX || x > bb.maxX || z < bb.minZ || z > bb.maxZ) return -Infinity; let y = -Infinity; for (const st of my) if (x > st.r.minX && x < st.r.maxX && z > st.r.minZ && z < st.r.maxZ && st.y > y) y = st.y; return y; }); }
    return F;
    }
  }

  // =====================================================================
  // ---------- west shore strip ----------
  // =====================================================================
  Rs = rng(1234);   // the shores draw their own numbers, so changes on the quay leave them as they are
  // shrine of Poseidon by the root of the west mole, facing east over its altar
  {
    const cx = -260, cz = 451, top = Math.max(H(cx - 5, cz - 4), H(cx + 5, cz + 4), H(cx - 5, cz + 4), H(cx + 5, cz - 4)) + 0.75;
    const base = top - 0.75;
    B.ashlar.add(rectSweep(9.2, 7.6, [{ o: 0.75, y: base - 1 }, { o: 0.75, y: base + 0.25, hard: true }, { o: 0.5, y: base + 0.25, hard: true }, { o: 0.5, y: base + 0.5, hard: true }, { o: 0.25, y: base + 0.5, hard: true }, { o: 0.25, y: top, hard: true }, { o: 0, y: top, hard: true }], { top: true }), mat(cx, 0, cz));
    world.extraGround.push((x, z) => (Math.abs(x - cx) < 4.6 && Math.abs(z - cz) < 3.8) ? top : (Math.abs(x - cx) < 5.35 && Math.abs(z - cz) < 4.55 ? base + 0.5 : -Infinity));
    const nx0 = cx - 3.8, nx1 = cx + 1.2, wz = 2.3, wallH = 3.4;
    for (const s of [-1, 1]) B.walls.add(box(cx + 3.35 - nx0, wallH, 0.4), mat((nx0 + cx + 3.35) / 2, top + wallH / 2, cz + s * wz), 0xd9c7a3);
    B.walls.add(box(0.4, wallH, 2 * wz + 0.4), mat(nx0 + 0.2, top + wallH / 2, cz), 0xd9c7a3);
    for (const s of [-1, 1]) { B.marble.add(new THREE.CylinderGeometry(0.2, 0.25, wallH - 0.3, 12), mat(cx + 3.2, top + (wallH - 0.3) / 2, cz + s * 1.05)); B.marble.add(box(0.62, 0.3, 0.62), mat(cx + 3.2, top + wallH - 0.15, cz + s * 1.05)); }
    // plastered entablature with a painted frieze band (blue, red fillet above), warm pediment
    const ex = (nx0 + nx1) / 2 + 1.3, el = nx1 - nx0 + 2.6, ed = 2 * wz + 0.9;
    B.walls.add(box(el, 0.3, ed), mat(ex, top + wallH + 0.15, cz), 0xd6c4a0);
    pt.add(box(el + 0.03, 0.2, ed + 0.03), mat(ex, top + wallH + 0.4, cz), 0x3d5670); pt.add(box(el + 0.1, 0.05, ed + 0.1), mat(ex, top + wallH + 0.525, cz), 0x8a3a2a);
    const rw = nx1 - nx0 + 3.2, rd = 2 * wz + 1.2;
    B.roofs.add(ctx.kit.gableRoof(rw, rd, 0.3, 0.32), mat(ex, top + wallH + 0.55, cz), 0xb8714a);
    B.walls.add(ctx.kit.gableEnds(rw - 0.1, rd - 0.6, 0.34), mat(ex, top + wallH + 0.55, cz), 0xcfbb95);
    // a wreath and fillets hung on the blank back wall
    pt.add(new THREE.TorusGeometry(0.34, 0.07, 5, 14).rotateY(Math.PI / 2), mat(nx0 - 0.06, top + 2.2, cz), 0x4f5c38);
    for (const s of [-1, 1]) pt.add(box(0.03, 0.7, 0.06), mat(nx0 - 0.05, top + 1.6, cz + s * 0.12, s * 0.12, 0, 0), 0x8a3a2a);
    B.socles.add(box(0.9, 0.9, 0.9), mat(cx - 2.2, top + 0.45, cz));
    const fig = figureGeometry({ seed: 331, draped: 'none', spear: true }), fm = mat(cx - 2.2, top + 0.9, cz, 0, Math.PI / 2, 0, 1.22);
    B.statue.add(fig, fm);
    const tip = V(0.32, 3.15, 0.09).applyMatrix4(fm);
    pt.add(box(0.36, 0.04, 0.04), mat(tip.x, tip.y, tip.z, 0, Math.PI / 2, 0), BRONZE);
    for (const o of [-0.17, 0, 0.17]) pt.add(new THREE.ConeGeometry(0.025, 0.3, 4), mat(tip.x, tip.y + 0.15, tip.z + o), BRONZE);
    collide(rect(nx0 - 0.1, cx + 3.5, cz - wz - 0.3, cz + wz + 0.3));
    // altar before the shrine, offerings, votive stone anchors against the podium
    const ax = cx + 8.6;
    B.ashlar.add(rectSweep(1.9, 1.1, [{ o: 0.15, y: H(ax, cz) - 0.3 }, { o: 0.15, y: H(ax, cz) + 0.15, hard: true }, { o: 0, y: H(ax, cz) + 0.2, hard: true }, { o: 0, y: H(ax, cz) + 0.95, hard: true }, { o: 0.12, y: H(ax, cz) + 1.08, hard: true }], { top: true }), mat(ax, 0, cz));
    collide(rect(ax - 1.1, ax + 1.1, cz - 0.7, cz + 0.7));
    pt.add(lathe([[0.02, 0], [0.18, 0.02], [0.26, 0.1]], 10), mat(ax - 0.4, H(ax, cz) + 1.09, cz - 0.2), BRONZE);
    for (let k = 0; k < 3; k++) cl.add(ellipsoid(0.11, 0.035, 0.04, 6, 3), mat(ax + 0.3, H(ax, cz) + 1.12, cz + (k - 1) * 0.12), 0x9c968a);
    amph(ax - 0.1, H(ax, cz) + 1.08 + 0.17, cz + 0.36, 0, 0, -Math.PI / 2 + 0.06, true);   // a wine jar laid on the altar
    // votive stone anchors: rough, rounded-triangular slabs pierced by a rope hole, leaning on the podium; one laid on its top
    const ANCHOR = (() => {
      const tri = [[0, 0.92], [-0.4, 0], [0.4, 0]], sh = new THREE.Shape(), rr = 0.14;
      const toward = (p, q, d) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]); return [p[0] + (q[0] - p[0]) * d / l, p[1] + (q[1] - p[1]) * d / l]; };
      for (let i = 0; i < 3; i++) { const P = tri[i], A = toward(P, tri[(i + 2) % 3], rr), Bq = toward(P, tri[(i + 1) % 3], rr); if (!i) sh.moveTo(...A); else sh.lineTo(...A); sh.quadraticCurveTo(P[0], P[1], ...Bq); }
      sh.closePath(); sh.holes.push(new THREE.Path().absarc(0, 0.6, 0.075, 0, TAU, true));
      const g = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.035, bevelSegments: 2, curveSegments: 4 }).translate(0, 0, -0.06), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), h = Math.sin(x * 37.1 + y * 17.3) * Math.cos(y * 29.7 - x * 11.9); p.setXYZ(i, x * (1 + 0.07 * h), y + 0.035 * Math.sin(x * 23 + y * 31), z * (1 + 0.12 * h)); }
      g.computeVertexNormals(); return g;
    })();
    const STONE = [0x857a6a, 0x7c7262, 0x8a7e6c, 0x80766a];
    const anchor = (am, col) => { tc.add(ANCHOR, am, col); for (const r of [0, Math.PI]) pt.add(new THREE.CircleGeometry(0.075, 8), am.clone().multiply(mat(0, 0.6, 0, 0, r, 0)), 0x1c1915); };
    for (const [ox, oz, sc] of [[-3, -4.8, 1], [0.5, -4.85, 0.8], [-1.5, 4.8, 0.9], [3.0, 4.85, 1.1]]) {
      const px = cx + ox, pz = cz + oz, gy = Math.min(base, H(px, pz)), am = mat(px, gy - 0.02, pz).multiply(mat(0, (R() - 0.5) * 0.3, 0)).multiply(mat(0, 0, 0, (oz < 0 ? 1 : -1) * 0.2, 0, (R() - 0.5) * 0.12, sc));
      anchor(am, pick(STONE)); pt.add(new THREE.TorusGeometry(0.1, 0.022, 4, 8), am.clone().multiply(mat(0, 0.6, 0, 0, Math.PI / 2 - 0.3, 0)), ROPE);
    }
    anchor(mat(cx + 4.15, top + 0.065, cz - 3.05).multiply(mat(0, 0.7, 0)).multiply(mat(0, 0, 0, -Math.PI / 2, 0, 0, 0.85)), 0x877c6b);
    poi({ type: 'altar', x: ax + 1.9, z: cz, ry: face(-1, 0), r: 3, note: 'Poseidon' });
    poi({ type: 'shrine', x: cx + 4.3, z: cz, y: top, ry: face(-1, 0), note: 'Poseidon' });
    poi({ type: 'gather', x: ax + 2.2, z: cz + 3.2, r: 2, note: 'shrine of Poseidon' });
  }
  storehouse(-298, -268, 440.8, 451.2, 'S', { pentice: true, forecourt: true });
  storehouse(-319, -307, 446, 472, 'W', { sections: 3 });
  storehouse(-339, -327, 446, 474, 'E', { wallH: 5.4, sections: 3 });
  layout.addArea({ name: 'shore', minX: -325, maxX: -321, minZ: 448, maxZ: 471, owner: own, note: 'storehouse lane' });
  // fishermen's beaches: boats drawn up singly, in pairs and threes at varied distances from the water, some staked; the work
  // behind each group (a net rack — at most two —, fish frames, gutting tables, net heaps, boat timber); huts further inland
  // a rectangle turned to (ax, az) is free: checked slice by slice like ocollide builds it
  const ofreeDir = (x, z, ax, az, ha, hb, m = 0.2) => { const n = Math.max(1, Math.ceil(ha / 0.9)); for (let i = 0; i < n; i++) { const o = -ha + (i + 0.5) * 2 * ha / n, cx = x + ax * o, cz = z + az * o, hx = Math.abs(ax) * ha / n + Math.abs(az) * hb, hz = Math.abs(az) * ha / n + Math.abs(ax) * hb; if (!free(rect(cx - hx, cx + hx, cz - hz, cz + hz), 6.6, m)) return false; } return true; };
  const orect = (x, z, tx_, tz_, inx, inz, ha, hb) => rect(x - Math.abs(tx_) * ha - Math.abs(inx) * hb, x + Math.abs(tx_) * ha + Math.abs(inx) * hb, z - Math.abs(tz_) * ha - Math.abs(inz) * hb, z + Math.abs(tz_) * ha + Math.abs(inz) * hb);
  const hut = (x, z, tx_, tz_, inx, inz) => {
    const y = H(x, z), ry = Math.atan2(-tz_, tx_), m = mat(x, y, z, 0, ry, 0), w = 4.4, d = 3.4, h = 2.3;
    let lo = 1e9, hi = -1e9; for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const q = V(a * w / 2, 0, b * d / 2).applyMatrix4(m); lo = Math.min(lo, H(q.x, q.z)); hi = Math.max(hi, H(q.x, q.z)); }
    const st = Math.max(0.25, hi - y + 0.12);   // socle top: a low course above the highest corner of the ground
    B.socles.add(box(w + 0.1, st + (y - lo) + 0.5, d + 0.1), m.clone().multiply(mat(0, (st - (y - lo) - 0.5) / 2, 0)));
    B.walls.add(box(w, h - st, d), m.clone().multiply(mat(0, st + (h - st) / 2, 0)), 0xc9b48f);
    cl.add(ctx.kit.gableRoof(w, d, 0.45, 0.62), m.clone().multiply(mat(0, h, 0)), 0x7e6c48); B.walls.add(ctx.kit.gableEnds(w, d, 0.62), m.clone().multiply(mat(0, h, 0)), 0xc9b48f);
    // the doorway (local -z faces the sea) from the socle top to 1.9 m, a dark lintel beam over it, a flat stone step before it
    B.doors.add(box(0.95, 1.9 - st, 0.12), m.clone().multiply(mat(0.6, (1.9 + st) / 2, -d / 2 - 0.02)));
    B.woodDark.add(box(1.35, 0.16, 0.22), m.clone().multiply(mat(0.6, 1.98, -d / 2 - 0.05)));
    { const q = V(0.6, 0, -d / 2 - 0.4).applyMatrix4(m), gy = H(q.x, q.z); B.socles.add(box(1.25, Math.max(0.12, y + st - 0.14 - gy) + 0.2, 0.6), mat(q.x, (y + st - 0.14 + gy - 0.2) / 2, q.z, 0, ry, 0)); }
    ocollide(x, z, tx_, tz_, w / 2 + 0.3, d / 2 + 0.3);
    const fx = x - inx * 3.2 - tx_ * 1.2, fz = z - inz * 3.2 - tz_ * 1.2, fy = H(fx, fz);
    for (let k = 0; k < 6; k++) { const a = k * TAU / 6; B.socles.add(box(0.28, 0.22, 0.24), mat(fx + Math.cos(a) * 0.45, fy + 0.06, fz + Math.sin(a) * 0.45, 0, a, 0)); }
    tc.add(lathe([[0.05, 0], [0.2, 0.04], [0.26, 0.18], [0.2, 0.3], [0.16, 0.33]], 9), mat(fx, fy + 0.12, fz), 0x6e4a32);
    flame(fx, fy + 0.1, fz, 0.35);
    collide(rect(fx - 0.6, fx + 0.6, fz - 0.6, fz + 0.6));
    poi({ type: 'gather', x: fx - tx_ * 1.4, z: fz - tz_ * 1.4, r: 1.6, note: "fishermen's fire" });
    poi({ type: 'door', x: x - inx * (d / 2 + 0.9) + tx_ * 0.6, z: z - inz * (d / 2 + 0.9) + tz_ * 0.6, nx: -inx, nz: -inz, note: "fisherman's hut" });
  };
  let racks = 0, upturnedN = 0;
  const work = (kind, rx, rz, tx_, tz_, inx, inz) => {
    if (kind === 'rack' && racks >= 2) kind = 'heap';
    const ry = Math.atan2(-tz_, tx_);
    const [ha, hb, sh] = kind === 'gut' ? [2.6, 1.25, 0.6] : kind === 'heap' ? [1.7, 1.2, 0] : kind === 'timber' ? [3.0, 1.0, 0] : [2.9, 1.3, 0];
    if (!ofreeDir(rx + inx * sh, rz + inz * sh, tx_, tz_, ha, hb) || H(rx, rz) < SEA + 0.4) return false;
    if (kind === 'rack') { netDrape(rx, H(rx, rz), rz, ry, 3.8, { hang: [0.62 + R() * 0.18, 2.4 + R() * 0.3] }); racks++; poi({ type: 'work', x: rx - inx * 2.3, z: rz - inz * 2.3, ry: face(inx, inz), note: 'mending nets' }); ocollide(rx, rz, tx_, tz_, 2.7, 1.2, 0.4); }
    else if (kind === 'fish') { fishFrame(rx, rz, ry); poi({ type: 'work', x: rx - inx * 1.9, z: rz - inz * 1.9, ry: face(inx, inz), note: 'drying fish' }); ocollide(rx, rz, tx_, tz_, 1.9, 0.85, 0.4); }
    else if (kind === 'heap') {   // a net heaped on the sand being picked over, baskets beside it
      netHeap(rx, rz, 0.7 + R() * 0.25);
      for (const [qt, qi, f] of [[1.3, 0.2, FILL.fish], [-1.2, -0.3, FILL.grey]]) { const qx = rx + tx_ * qt + inx * qi, qz = rz + tz_ * qt + inz * qi; basket(qx, H(qx, qz), qz, f); }
      poi({ type: 'work', x: rx - inx * 1.5, z: rz - inz * 1.5, ry: face(inx, inz), note: 'mending nets' }); ocollide(rx, rz, tx_, tz_, 1.6, 0.95, 0.4);
    } else if (kind === 'timber') {   // planks for the boat repairs on sleepers, a pot of pitch on stones, a basket of tow
      const y = H(rx, rz);
      for (const o of [-1.2, 0, 1.2]) B.woodDark.add(box(0.12, 0.12, 1.3), mat(rx + tx_ * o, H(rx + tx_ * o, rz + tz_ * o) + 0.03, rz + tz_ * o, 0, ry, 0));
      for (let l = 0; l < 4; l++) for (let j = 0; j < 3 - (l > 2 ? 1 : 0); j++) B.wood.add(box(3.1 - l * 0.12, 0.06, 0.3), mat(rx + inx * (j - 1) * 0.33 + tx_ * (R() - 0.5) * 0.15, Math.max(H(rx + tx_ * 1.2, rz + tz_ * 1.2), H(rx - tx_ * 1.2, rz - tz_ * 1.2)) + 0.12 + l * 0.065, rz + inz * (j - 1) * 0.33 + tz_ * (R() - 0.5) * 0.15, 0, ry + (R() - 0.5) * 0.04, 0));
      const px = rx + tx_ * 2.4, pz = rz + tz_ * 2.4, py = H(px, pz);
      for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + 0.3; B.socles.add(box(0.24, 0.2, 0.22), mat(px + Math.cos(a) * 0.32, py + 0.05, pz + Math.sin(a) * 0.32, 0, a, 0)); }
      tc.add(lathe([[0.05, 0], [0.2, 0.03], [0.25, 0.18], [0.22, 0.3], [0.2, 0.32]], 9), mat(px, py + 0.14, pz), 0x2e2924); pt.add(new THREE.CircleGeometry(0.2, 9).rotateX(-Math.PI / 2), mat(px, py + 0.44, pz), 0x0f0c0a);
      basket(rx - tx_ * 2.2, H(rx - tx_ * 2.2, rz - tz_ * 2.2), rz - tz_ * 2.2, 0x8a7a5a);
      ocollide(rx, rz, tx_, tz_, 1.7, 0.7, 0.4); collide(rect(px - 0.5, px + 0.5, pz - 0.5, pz + 0.5));
      poi({ type: 'work', x: rx - inx * 1.4, z: rz - inz * 1.4, ry: face(inx, inz), note: 'boat repairs' });
    } else {   // gutting table: the gutter stands on its seaward side, baskets at its end, traps behind it
      const y = H(rx, rz); for (const o of [-0.8, 0.8]) for (const q of [-0.35, 0.35]) B.woodDark.add(box(0.08, 0.8, 0.08), mat(rx + tx_ * o + inx * q, y + 0.22, rz + tz_ * o + inz * q));
      const tm = mat(rx, y + 0.64, rz, 0, ry, 0); B.wood.add(box(2.2, 0.05, 1.0), tm);
      for (let f = 0; f < 12; f++) if (R() < 0.85) fish(tm.clone().multiply(mat(-0.85 + (f % 6) * 0.3 + (R() - 0.5) * 0.08, 0.037, -0.02 + Math.floor(f / 6) * 0.44, Math.PI / 2, 0, (R() - 0.5) * 0.5)));   // fresh catch, flat on the board
      for (const [qt, qi] of [[1.6, -0.3], [1.6, 0.3], [2.1, 0]]) { const qx = rx + tx_ * qt + inx * qi, qz = rz + tz_ * qt + inz * qi; basket(qx, H(qx, qz), qz, pick([FILL.fish, FILL.fish2, FILL.grey])); }
      const wx = rx + inx * 1.4, wz = rz + inz * 1.4; for (let q = 0; q < 3; q++) pt.add(lathe([[0.05, 0], [0.24, 0.1], [0.26, 0.5], [0.12, 0.62]], 8), mat(wx + tx_ * (q - 1) * 0.6, H(wx, wz) + 0.26, wz + tz_ * (q - 1) * 0.6, Math.PI / 2, ry + (R() - 0.5) * 0.5, 0), 0x5e4a30);   // wicker fish traps
      ocollide(rx, rz, tx_, tz_, 1.15, 0.55, 0.4); ocollide(rx + tx_ * 1.85, rz + tz_ * 1.85, tx_, tz_, 0.55, 0.55, 0.4); ocollide(wx, wz, tx_, tz_, 0.95, 0.35, 0.4);
      poi({ type: 'work', x: rx - inx * 1.2, z: rz - inz * 1.2, ry: face(inx, inz), note: 'gutting fish' });
    }
    return true;
  };
  function fisherBeach(pts, { kinds, huts = 0, maxGroups = 99, start = 2, sizes = [1, 2, 2, 3, 3] }) {
    const seg = []; let total = 0;
    for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az); seg.push({ ax, az, tx: (bx - ax) / len, tz: (bz - az) / len, s0: total, len }); total += len; }
    const shore = s => {   // the waterline at arc length s, with the along-shore and inland directions
      const q = seg.find(g => s <= g.s0 + g.len) || seg[seg.length - 1], d = s - q.s0, inx = -q.tz, inz = q.tx; let x = q.ax + q.tx * d, z = q.az + q.tz * d;
      for (let k = 0; k < 40 && H(x, z) < SEA + 0.25; k++) { x += inx * 0.5; z += inz * 0.5; } for (let k = 0; k < 40 && H(x, z) > SEA + 0.25; k++) { x -= inx * 0.5; z -= inz * 0.5; }
      return { x, z, tx: q.tx, tz: q.tz, inx, inz };
    };
    let s = start + R() * 3, g = 0, n = 0;
    while (s < total - 2 && g < maxGroups) {
      const size = pick(sizes), up0 = R() * 4, s0 = s;
      for (let b = 0; b < size && s < total - 1; b++, s += 3.5 + R() * 1.3) {
        const p = shore(s), inl = 2.4 + clamp(up0 + (R() - 0.5) * 1.8, 0, 6), bx0 = p.x + p.inx * inl, bz0 = p.z + p.inz * inl, jit = (R() - 0.5) * 0.9;
        if (!ofreeDir(bx0, bz0, p.inx + p.tx * jit, p.inz + p.tz * jit, 3.4, 1.15)) continue;
        const up = (n++ % 5) === 3, bt = beach(bx0, bz0, p.inx + p.tx * jit, p.inz + p.tz * jit, { upturned: up, oars: R() < 0.7, net: up && (upturnedN++ % 2 === 0) });
        if (bt && !up && R() < 0.6) {   // a stake driven into the sand up the beach, the bow line tied to it
          const bx = bt.x + bt.ax * bt.len * 0.47, bz = bt.z + bt.az * bt.len * 0.47, o = (R() - 0.5) * 1.2, sx = bx + bt.ax * 1.8 + bt.az * o, sz = bz + bt.az * 1.8 - bt.ax * o, sy = H(sx, sz);
          if (!world.blocked(sx, sz)) { B.woodDark.add(rod([sx, sy - 0.25, sz], [sx + bt.ax * 0.08, sy + 0.5, sz + bt.az * 0.08], 0.05, 5, 0.035)); rope([bx, H(bx, bz) + 0.92, bz], [sx + bt.ax * 0.07, sy + 0.4, sz + bt.az * 0.07], 0.15, 0.018); collide(rect(sx - 0.2, sx + 0.2, sz - 0.2, sz + 0.2)); }
        }
      }
      const pm = shore(Math.max(s0, (s0 + s) / 2 - 1.7)), back = 10.5 + up0 * 0.7 + R() * 2.5, side = (R() - 0.5) * 3;
      let done = false; for (const k of [kinds[g % kinds.length], 'heap']) if (!done) done = work(k, pm.x + pm.inx * back + pm.tx * side, pm.z + pm.inz * back + pm.tz * side, pm.tx, pm.tz, pm.inx, pm.inz);
      s += 12 + R() * 8; g++;
    }
    const hs = [];   // huts on a line further inland, well apart
    for (let t = 4 + R() * 6; t < total && hs.length < huts; t += 4) for (const inl of [18, 22, 26]) {
      const p = shore(t), hx = p.x + p.inx * inl, hz = p.z + p.inz * inl;
      if (hs.every(([qx, qz]) => Math.hypot(qx - hx, qz - hz) > 22) && free(orect(hx, hz, p.tx, p.tz, p.inx, p.inz, 2.8, 6.0), 6.6, 0.3)) { hut(hx, hz, p.tx, p.tz, p.inx, p.inz); hs.push([hx, hz]); break; }
    }
  }
  // timber and jars in the yard, boats drawn up on the beach west of the mole
  {
    for (const x of [-296.3, -293.7]) B.woodDark.add(box(0.1, 0.66, 0.1), mat(x, H(x, 455.8) + 0.25, 455.8));
    B.woodDark.add(box(2.8, 0.12, 0.12), mat(-295, H(-295, 455.8) + 0.52, 455.8)); collide(rect(-296.5, -293.4, 455.6, 456.8));
    for (let k = 0; k < 6; k++) { const ax = -296 + k * 0.42, gy = H(ax, 456.2); amph(ax, gy, 456.2, R() * TAU, -leanTilt(0.34, 0.46, -1e9), (R() - 0.5) * 0.06); }
    beach(-252, 457.5, 0.15, -1); beach(-302, 459, 0.05, -1, { upturned: true, net: true });
    netFlat(-266, H(-266, 456.6), 456.6, 0.05, 3.2, 1.8, H); collide(rect(-267.7, -264.3, 455.8, 457.4));
  }
  // the fishermen's beach along the shore south-west of the storehouses, and a few boats and nets beyond its street
  {
    fisherBeach([[-296, 480], [-312, 488], [-326, 496], [-340, 503], [-352, 514], [-362, 524], [-372, 536], [-384, 550]], { kinds: ['rack', 'fish', 'gut', 'rack', 'heap', 'fish'], huts: 3, start: 9 });
    fisherBeach([[-384, 550], [-400, 554], [-412, 562]], { kinds: ['heap'], maxGroups: 1, start: 13, sizes: [1, 2] });
    let mid = [-338, 492];
    for (let k = 0; k < 60; k++) { const cx = -345 + (k % 10) * 2.5, cz = 486 + Math.floor(k / 10) * 3; if (!hitsCollider(rect(cx - 3, cx + 3, cz - 2, cz + 2)) && H(cx, cz) > SEA + 0.4) { mid = [cx, cz]; break; } }
    layout.addArea({ name: 'shore', minX: mid[0] - 3, maxX: mid[0] + 3, minZ: mid[1] - 2, maxZ: mid[1] + 2, owner: own, note: "fishermen's beach" });
    poi({ type: 'gather', x: mid[0], z: mid[1], r: 2.5, note: "fishermen's beach" });
  }

  // =====================================================================
  // ---------- east shore strip: storehouses along the palace road ----------
  // =====================================================================
  storehouse(256, 292, 450.2, 460.2, 'S', { pentice: true, sections: 2, forecourt: true });
  storehouse(300, 311, 453, 481, 'E', { sections: 4 });
  storehouse(318, 330, 453, 486, 'W', { wallH: 5.4, sections: 4 });
  layout.addArea({ name: 'shore', minX: 313, maxX: 316, minZ: 456, maxZ: 480, owner: own, note: 'storehouse lane' });
  beach(296, 466, 0.2, -1); beach(281.5, 468.5, -0.1, -1, { oars: false });
  // a boat-repair corner below the palace road, between the storehouses and the shipsheds
  fisherBeach([[393, 551], [381, 544], [369, 537], [357, 530], [346, 520], [337, 508]], { kinds: ['timber', 'heap', 'fish'], maxGroups: 3, start: 0.5 });

  // =====================================================================
  // ---------- the shipsheds of the royal harbour, under the palace ----------
  // =====================================================================
  {
    const C = [430, 590], ang = 22.5 * Math.PI / 180, v = [-Math.cos(ang), Math.sin(ang)], u = [v[1], -v[0]];
    const N = 8, P = 7, Ls = 44, y0 = SEA + 2.6, sl = 0.08, W = N * P, Hv = 5.2, rise = P * 0.3, Hr = Hv + rise;
    const at = (s, t) => [C[0] + u[0] * s + v[0] * t, C[1] + u[1] * s + v[1] * t];
    const ramp = t => y0 - sl * t, ry = Math.atan2(-v[1], v[0]), lineS = k => (k - N / 2) * P;
    const place = (s, t, y) => { const [x, z] = at(s, t); return mat(x, y, z, 0, ry, 0); };
    const tilt = Math.atan(sl);
    // ramp body and the kerbs (stylobates) between the slips
    B.ashlar.add(shear(box(Ls + 1, 6, W + 2), sl), place(0, Ls / 2 - 0.5, ramp(Ls / 2 - 0.5) - 3));
    for (let k = 1; k < N; k++) B.socles.add(shear(box(Ls, 0.6, 1.1), sl), place(lineS(k), Ls / 2, ramp(Ls / 2) + 0.3));
    // outer walls (a doorway in the north-west one) and the back wall retaining the hillside
    for (const k of [0, N]) {
      const s = lineS(k) + (k ? 0.45 : -0.45), wh = 1.2 + 0.6 + Hv + 0.45, segs = k ? [[-0.9, Ls]] : [[-0.9, 3], [5.2, Ls]];
      for (const [t0, t1] of segs) {
        B.socles.add(shear(box(t1 - t0, wh, 0.9), sl), place(s, (t0 + t1) / 2, ramp((t0 + t1) / 2) - 1.2 + wh / 2));
        const [wx, wz] = at(s, (t0 + t1) / 2); ocollide(wx, wz, v[0], v[1], (t1 - t0) / 2, 0.45, 0.6);
      }
      B.woodDark.add(shear(box(Ls + 1.2, 0.45, 1.0), sl), place(s, Ls / 2 - 0.3, ramp(Ls / 2 - 0.3) + 0.6 + Hv + 0.45 + 0.22));
    }
    { const wt = 0.6 + Hv + 0.45 - 3.0; B.socles.add(shear(box(2.3, wt, 0.9), sl), place(lineS(0) - 0.45, 4.1, ramp(4.1) + 3.0 + wt / 2)); B.woodDark.add(box(2.6, 0.3, 1.0), place(lineS(0) - 0.45, 4.1, ramp(4.1) + 2.85)); }
    // steps from the shipwrights' yard up to the doorway sill (the ramp top, level with the slip floor)
    const DS = lineS(0) - 0.9, dStep = 0.42;
    let dN = 1, dRise = 0;
    { let gy = H(...at(DS - 0.3, 4.1)); for (let it = 0; it < 3; it++) { dN = Math.max(1, Math.ceil((ramp(4.1) - gy) / 0.3)); gy = H(...at(DS - (dN - 1) * dStep - 0.3, 4.1)); } dRise = (ramp(4.1) - gy) / dN;
      for (let i = 0; i < dN - 1; i++) { const top = ramp(4.1) - (i + 1) * dRise, h = top - gy + 0.5; B.socles.add(shear(box(2.3, h, dStep), sl), place(DS - (i + 0.5) * dStep, 4.1, top - h / 2)); } }
    // pilasters along the outer walls, in step with the columns inside (sloped with the wall, capped just below its top)
    for (const [k, sg] of [[0, -1], [N, 1]]) for (let t = 6.6; t < Ls - 1; t += 3.6) { const top = ramp(t) + 0.6 + Hv + 0.4; B.socles.add(shear(box(0.6, top - ramp(t) + 1.2, 0.3), sl), place(lineS(k) + sg * 1.05, t, (top + ramp(t) - 1.2) / 2)); }
    const backTop = ramp(0) + 0.6 + Hv + 0.45;
    B.socles.add(box(0.9, backTop - (SEA - 2) + 0.1, W + 1.8), place(0, -0.45, (backTop + SEA - 2) / 2));
    { const [bx, bz] = at(0, -0.45); ocollide(bx, bz, u[0], u[1], W / 2 + 0.9, 0.45, 0.6); }
    // columns (taller under the ridges), beams, pitched roofs over each pair of slips
    for (let k = 1; k < N; k++) {
      const hgt = k % 2 ? Hr : Hv;
      for (let t = 3; t < Ls - 1; t += 3.6) {
        const [x, z] = at(lineS(k), t), b = ramp(t) + 0.6;
        B.walls.add(scaleUV(new THREE.CylinderGeometry(0.27, 0.33, hgt - 0.3, 8, 1, true), 1.9, hgt), mat(x, b + (hgt - 0.3) / 2, z), 0xcfc0a2);
        B.walls.add(box(0.72, 0.3, 0.72), mat(x, b + hgt - 0.15, z, 0, ry, 0), 0xc9b999);
        collide(rect(x - 0.42, x + 0.42, z - 0.42, z + 0.42));
      }
      B.woodDark.add(shear(box(Ls + 1.2, 0.45, 0.5), sl), place(lineS(k), Ls / 2 - 0.3, ramp(Ls / 2 - 0.3) + 0.6 + hgt + 0.22));
    }
    const rc = 0xbf7d55;
    for (let p = 0; p < N / 2; p++) {
      const sa = lineS(2 * p), sb = lineS(2 * p + 1), sc = lineS(2 * p + 2), tm = Ls / 2 - 0.3, yb = ramp(tm) + 0.6 + 0.45;
      const along = [v[0], -sl, v[1]], slabL = (Ls + 1.8) * Math.hypot(1, sl), slabW = Math.hypot(P, rise) + (p === 0 || p === N / 2 - 1 ? 0.5 : 0.15);
      for (const [s0, s1, y0s, y1s] of [[sa, sb, Hv, Hr], [sc, sb, Hv, Hr]]) {
        const extra = (s0 === lineS(0) || s0 === lineS(N)) ? 0.35 : 0;
        const [x0, z0] = at((s0 + s1) / 2 - Math.sign(s1 - s0) * extra / 2, tm), mid = [x0, yb + (y0s + y1s) / 2 + 0.12, z0];
        const fr = frame(mid, along, [u[0] * (s1 - s0), y1s - y0s, u[1] * (s1 - s0)]);
        B.roofs.add(box(slabL, 0.18, slabW), fr, rc);
        B.wood.add(box(slabL - 0.4, 0.05, slabW - 0.2), fr.clone().multiply(mat(0, -0.14, 0)));
      }
      B.roofs.add(shear(box(Ls + 1.9, 0.26, 0.5), sl), place(sb, tm, yb + Hr + 0.24), 0xb0704a);
      // back gable filled in, front gable with a tie beam and king post
      const sh = new THREE.Shape([new THREE.Vector2(-P, 0), new THREE.Vector2(P, 0), new THREE.Vector2(0, rise)]);
      const [gx, gz] = at(sb, -0.9);
      B.socles.add(new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: false }), frame([gx, backTop, gz], [u[0], 0, u[1]], [v[0], 0, v[1]]));
      // tie beam stopping short of the corner posts (so the façade does not read as one wire), king post
      const fy = ramp(Ls - 0.1) + 0.6 + Hv + 0.3, [kx, kz] = at(sb, Ls - 0.1), ta = sa + (p === 0 ? 0.3 : 0.6), tb = sc - (p === N / 2 - 1 ? 0.3 : 0.6), [mx, mz] = at((ta + tb) / 2, Ls - 0.1);
      B.woodDark.add(box(tb - ta, 0.36, 0.34), frame([mx, fy, mz], [u[0], 0, u[1]], [v[0], 0, v[1]])); B.woodDark.add(rod([kx, fy, kz], [kx, fy + rise + 0.2, kz], 0.15, 6));
    }
    // timber sleepers and a keelway up each slip, above the water line
    for (let i = 0; i < N; i++) {
      const s = lineS(i) + P / 2;
      for (let t = 1.2; ramp(t) > SEA - 0.25 && t < Ls; t += 2.3) B.woodDark.add(box(0.26, 0.14, P - 1.5), place(s, t, ramp(t) + 0.06));
      B.wood.add(shear(box(33, 0.14, 0.42), sl), place(s, 17, ramp(17) + 0.19));
    }
    world.extraGround.push((x, z) => {
      if (x < 360 || x > 460 || z < 540 || z > 640) return -Infinity;
      const dx = x - C[0], dz = z - C[1], s = dx * u[0] + dz * u[1], t = dx * v[0] + dz * v[1];
      if (t > 3 && t < 5.2 && s < -W / 2 && s > DS - (dN - 1) * dStep) return s > DS ? ramp(t) : ramp(t) - (Math.floor((DS - s) / dStep) + 1) * dRise;   // doorway sill and its steps
      if (t < 0 || t > Ls || Math.abs(s) > W / 2) return -Infinity;
      const ks = (s + W / 2) / P, kr = Math.round(ks), onKerb = kr > 0 && kr < N && Math.abs(ks - kr) * P < 0.55;
      return ramp(t) + (onKerb ? 0.6 : 0.2);
    });
    // triremes hauled up stern first; one hull on the stocks
    const TRI = (() => {
      const Lh = 16.5, Wd = 2.35, Hd = 1.5, dark = new Bucket(), wood = new Bucket(), red = new Bucket(), metal = new Bucket(), white = new Bucket(), black = new Bucket();
      const lower = new THREE.SphereGeometry(1, 22, 6, 0, TAU, Math.PI / 2, Math.PI / 2); lower.scale(Lh, Hd, Wd); dark.add(lower, mat(0, Hd, 0));
      const side = new THREE.CylinderGeometry(1, 1, 0.7, 22, 1, true); side.scale(Lh, 1, Wd); dark.add(side, mat(0, Hd + 0.35, 0));
      const deck = new THREE.CircleGeometry(1, 22).rotateX(-Math.PI / 2); deck.scale(Lh * 0.99, 1, Wd * 0.99); wood.add(deck, mat(0, Hd + 0.62, 0));
      for (const s of [-1, 1]) { dark.add(box(19, 0.3, 0.3), mat(-0.8, Hd + 0.5, s * (Wd + 0.2))); red.add(box(19.1, 0.09, 0.02), mat(-0.8, Hd + 0.52, s * (Wd + 0.36))); for (let k = -4; k <= 4; k++) wood.add(box(0.12, 0.12, 0.5), mat(-0.8 + k * 2.3, Hd + 0.45, s * (Wd - 0.05))); }
      metal.add(new THREE.ConeGeometry(0.3, 2.2, 6), mat(Lh + 0.9, 0.95, 0, 0, 0, -Math.PI / 2));
      dark.add(rod([Lh - 0.4, Hd + 0.3, 0], [Lh + 0.5, Hd + 1.9, 0], 0.16, 6, 0.1));
      const st = [[-Lh + 0.3, Hd + 0.3, 0], [-Lh - 1.0, Hd + 1.4, 0], [-Lh - 1.3, Hd + 2.6, 0], [-Lh - 0.8, Hd + 3.4, 0], [-Lh - 0.1, Hd + 3.6, 0]];
      for (let k = 0; k < st.length - 1; k++) dark.add(rod(st[k], st[k + 1], 0.2 - k * 0.035, 6, 0.2 - (k + 1) * 0.035));
      for (const s of [-1, 1]) { white.add(new THREE.CircleGeometry(0.26, 10), mat(Lh - 1.3, Hd + 0.05, s * 0.93, 0, s > 0 ? 0.3 : Math.PI - 0.3, 0)); black.add(new THREE.CircleGeometry(0.12, 8), mat(Lh - 1.28, Hd + 0.05, s * 0.955, 0, s > 0 ? 0.3 : Math.PI - 0.3, 0)); wood.add(rod([-Lh + 2.5, Hd + 0.8, s * 2.0], [-Lh - 0.8, 0.4, s * 2.5], 0.07, 5)); wood.add(box(1.2, 0.05, 0.32), mat(-Lh - 0.5, 0.55, s * 2.47, 0, 0, 0.3)); }
      return { dark: dark.build(), wood: wood.build(), red: red.build(), metal: metal.build(), white: white.build(), black: black.build(), Lh, Wd, Hd };
    })();
    // (hulls sit 3 m down from the head of the slips, leaving a cross passage t 0.3 – 2.4 behind their sterns)
    for (const [i, sd] of [[1, 1], [3, -1], [4, 1]]) {
      const s = lineS(i) + P / 2, tc_ = 21, [x, z] = at(s, tc_), m = mat(x, ramp(tc_) + 0.28, z, 0, ry, -tilt);
      pt.add(TRI.dark, m, PITCH); B.wood.add(TRI.wood, m); pt.add(TRI.red, m, i === 3 ? 0x2f4f8f : 0x8a3a28); pt.add(TRI.metal, m, BRONZE); pt.add(TRI.white, m, 0xe0d8c8); pt.add(TRI.black, m, 0x151210);
      for (const t of [8.5, 14.5, 27.5, 33.5]) for (const sg of [-1, 1]) { const [px, pz] = at(s + sg * 3.1, t), [hx, hz] = at(s + sg * 1.9, t); B.woodDark.add(rod([px, ramp(t) + 0.3, pz], [hx, ramp(t) + 1.6, hz], 0.07, 5)); }
      for (let t = 6; t < 38; t += 3) { const [cx, cz] = at(s, t); collide(rect(cx - 1.9, cx + 1.9, cz - 1.9, cz + 1.9)); }
      // windlass on tall posts against the back wall, its hawser to the stern above head height
      const [w0x, w0z] = at(s - 2, 0.7), [w1x, w1z] = at(s + 2, 0.7), wy = ramp(0.7) + 2.2;
      for (const [px, pz] of [[w0x, w0z], [w1x, w1z]]) B.woodDark.add(rod([px, ramp(0.7), pz], [px, wy + 0.25, pz], 0.12, 5));
      B.wood.add(rod([w0x, wy, w0z], [w1x, wy, w1z], 0.22, 8));
      for (const so of [-1.6, 1.6]) for (const a of [0.3, 0.3 + Math.PI / 2]) { const [ax_, az_] = at(s + so, 0.7 - Math.sin(a) * 0.5), [bx_, bz_] = at(s + so, 0.7 + Math.sin(a) * 0.5); B.woodDark.add(rod([ax_, wy - Math.cos(a) * 0.5, az_], [bx_, wy + Math.cos(a) * 0.5, bz_], 0.035, 4)); }   // handspikes
      const stern = V(-TRI.Lh - 0.2, TRI.Hd + 0.9, 0).applyMatrix4(m); rope([(w0x + w1x) / 2, wy + 0.15, (w0z + w1z) / 2], stern.toArray(), 0.05, 0.05);
      poi({ type: 'work', ...(([px, pz]) => ({ x: px, z: pz }))(at(s + sd * 2.6, 10)), y: ramp(10) + 0.2, ry: face(-u[0] * sd, -u[1] * sd), note: 'caulking a trireme' });
    }
    {   // a new hull on the stocks in slip 6: keel, stem, sternpost, frames, the first strakes
      const s = lineS(6) + P / 2, tc_ = 21, [x, z] = at(s, tc_), m = mat(x, ramp(tc_) + 0.3, z, 0, ry, -tilt), Lh = 15.5, Wd = 2.3, Hd = 1.45;
      const add = (a, b, r, c = OAK) => pt.add(rod(a, b, r, 5).applyMatrix4(m), null, c);
      add([-Lh, 0.25, 0], [Lh, 0.25, 0], 0.16); add([Lh, 0.25, 0], [Lh + 0.8, 2.2, 0], 0.14); add([-Lh, 0.25, 0], [-Lh - 1.1, 2.6, 0], 0.14);
      const frameAt = (fx, a) => { const q = Math.sqrt(Math.max(0, 1 - (fx / (Lh + 0.8)) ** 2)); return [fx, Hd - Hd * q * Math.sin(a) + 0.25, -Wd * q * Math.cos(a)]; };
      for (let fx = -Lh + 1.5; fx < Lh - 1; fx += 1.25) {
        let prev = frameAt(fx, 0); prev = [prev[0], prev[1] + 0.7, prev[2]];
        for (let j = 0; j <= 6; j++) { const c = frameAt(fx, j / 6 * Math.PI); add(prev, c, 0.07); prev = c; }
        const e = frameAt(fx, Math.PI); add(prev, [e[0], e[1] + 0.7, e[2]], 0.07);
      }
      for (const a of [Math.PI / 2 - 0.3, Math.PI / 2 + 0.3, Math.PI / 2 - 0.62, Math.PI / 2 + 0.62]) { let prev = frameAt(-Lh + 0.6, a); for (let fx = -Lh + 2.4; fx <= Lh - 0.5; fx += 1.8) { const c = frameAt(fx, a); pt.add(box(Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]), 0.06, 0.26), frame([(c[0] + prev[0]) / 2, (c[1] + prev[1]) / 2, (c[2] + prev[2]) / 2], [c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]], [0, Math.cos(a), -Math.sin(a) * Math.sign(Math.cos(a) || 1)]).premultiply(m), 0x8a6844); prev = c; } }
      for (let t = 7.5; t < 36; t += 4) for (const sg of [-1, 1]) { const [px, pz] = at(s + sg * 3.0, t); B.woodDark.add(rod([px, ramp(t) + 0.3, pz], [px - u[0] * sg * 0.6, ramp(t) + 2.2, pz - u[1] * sg * 0.6], 0.08, 5)); }
      for (let t = 6.5; t < 36.5; t += 3.5) { const [cx, cz] = at(s, t); collide(rect(cx - 1.8, cx + 1.8, cz - 1.8, cz + 1.8)); }
      for (const t of [12, 26]) poi({ type: 'work', ...(([px, pz]) => ({ x: px, z: pz }))(at(s - 2.7, t)), y: ramp(t) + 0.2, ry: face(u[0], u[1]), note: 'shipwright' });
    }
    // the shipwrights' yard beside the sheds: oars against the wall, logs, squared timber, spars, a pitch fire
    const S0 = lineS(0) - 0.9;   // outer face of the north-west wall
    const yard = (s, t) => { const [x, z] = at(s, t); return [x, H(x, z), z]; };
    const ofree = (s, t, ha, hb) => { const [x, z] = at(s, t); const n = Math.max(1, Math.ceil(ha / 0.9)); for (let i = 0; i < n; i++) { const o = -ha + (i + 0.5) * 2 * ha / n, cx = x + u[0] * o, cz = z + u[1] * o, hx = Math.abs(u[0]) * ha / n + Math.abs(v[0]) * hb, hz = Math.abs(u[1]) * ha / n + Math.abs(v[1]) * hb; if (!free(rect(cx - hx, cx + hx, cz - hz, cz + hz), 6.6, 0)) return false; } return H(x, z) > SEA + 0.3; };
    const ocol = (s, t, ha, hb) => { const [x, z] = at(s, t); ocollide(x, z, u[0], u[1], ha, hb); };   // long side along u (across the slope)
    // oars leaning on the wall, spaced and at varied angles, with broad dark blades along the shaft
    { let n = 0; for (let t = 6.5; t < 12.6; t += 0.55) {
        const [x0, y0g, z0] = yard(S0 - 1.2 - R() * 0.6, t + (R() - 0.5) * 0.2); if (y0g < SEA + 0.15) break;
        const [x1, z1] = at(S0 - 0.12, t + (R() - 0.5) * 0.35), foot = [x0, y0g - 0.05, z0], top = [x1, y0g + 3.9 + R() * 0.6, z1];
        B.wood.add(rod(foot, top, 0.045, 5));
        const dir = V(top[0] - foot[0], top[1] - foot[1], top[2] - foot[2]).normalize(), bc = V(...foot).addScaledVector(dir, 0.7);
        pt.add(box(1.3, 0.045, 0.21), frame(bc.toArray(), dir.toArray(), [v[0], 0, v[1]]), pick([0x5e4430, 0x6e5238, 0x54402e])); n++; }
      if (n) { const [cx, cz] = at(S0 - 0.9, 6.5 + (n - 1) * 0.275); ocollide(cx, cz, v[0], v[1], (n - 1) * 0.275 + 0.3, 0.9); poi({ type: 'work', ...(([px, pz]) => ({ x: px, z: pz }))(at(S0 - 2.8, 8)), ry: face(u[0], u[1]), note: 'oars' }); } }
    // logs in bark with pale sawn ends; debarked spars
    const pole = (m, r, len, col, endc) => { if (col) pt.add(new THREE.CylinderGeometry(r, r * 0.94, len, 9, 1, true), m, col); else tc.add(scaleUV(new THREE.CylinderGeometry(r, r * 0.94, len, 9, 1, true), 1.4, len / 1.2), m, pick([0x5e4a36, 0x564434, 0x66503a])); pt.add(new THREE.CircleGeometry(r * 0.97, 9).rotateX(-Math.PI / 2).translate(0, len / 2, 0), m, endc); pt.add(new THREE.CircleGeometry(r * 0.94, 9).rotateX(Math.PI / 2).translate(0, -len / 2, 0), m, endc); };
    const logs = (s, t, n, len) => { if (!ofree(s, t, len / 2 + 0.4, n * 0.28 + 0.4)) return; const [x, z] = at(s, t), y = Math.max(H(x + u[0] * len / 2, z + u[1] * len / 2), H(x - u[0] * len / 2, z - u[1] * len / 2), H(x, z)) - 0.12; let row = 0; for (let c = n; c > 0; c--, row++) for (let j = 0; j < c; j++) pole(place(s + (R() - 0.5) * 0.4, t + (j - (c - 1) / 2) * 0.54, y + 0.26 + row * 0.45).multiply(mat(0, 0, 0, Math.PI / 2, 0, 0)), 0.24 + R() * 0.05, len - R() * 0.6, null, pick([0xc4a47a, 0xb8966a])); ocol(s, t, len / 2 + 0.2, n * 0.28 + 0.2); };
    logs(S0 - 9, -1.5, 4, 9); logs(S0 - 9, 6.5, 3, 7.5); logs(S0 - 17, 9, 3, 8);
    { // squared timber on sticks, long spars, a beam on trestles being dressed
      const [x, z] = at(S0 - 17, 1.5), y = H(x, z) - 0.05;
      if (ofree(S0 - 17, 1.5, 3.3, 1.4)) { for (let l = 0; l < 4; l++) { for (let j = 0; j < 3; j++) B.wood.add(box(0.28, 0.28, 6), place(S0 - 17, 1.5 + (j - 1) * 0.7, y + 0.3 + l * 0.36)); for (const o of [-2.2, 0, 2.2]) B.woodDark.add(box(2.0, 0.08, 0.1), place(S0 - 17 + o, 1.5, y + 0.12 + l * 0.36)); } ocol(S0 - 17, 1.5, 3.2, 1.3); }
      const [sx, sz] = at(S0 - 7, -8.5);
      if (ofree(S0 - 7, -8.5, 6, 0.8)) { const sy = Math.max(H(sx + u[0] * 6, sz + u[1] * 6), H(sx - u[0] * 6, sz - u[1] * 6)); for (let k = 0; k < 6; k++) pole(place(S0 - 7 + (k % 2) * 0.3, -8.5 + (k - 2.5) * 0.3 * (k < 4 ? 1 : 0.5), sy + 0.12 + (k < 4 ? 0 : 0.24)).multiply(mat(0, 0, 0, Math.PI / 2, 0, 0)), 0.12, 11.5, pick([0xa08058, 0x967650]), 0xc8aa80); for (const o of [-4, 0, 4]) B.woodDark.add(box(0.14, 0.14, 1.6), place(S0 - 7 + o, -8.5, sy - 0.02).multiply(mat(0, 0, 0, 0, Math.PI / 2, 0))); ocol(S0 - 7, -8.5, 5.9, 0.7); }
      const TS = S0 - 9, TT = 2.6, [tx0, tz0] = at(TS, TT), ty = H(tx0, tz0);
      if (ofree(TS, TT, 3.4, 0.9)) {
        for (const o of [-2, 2]) { const [ax_, az_] = at(TS + o, TT); const gy = H(ax_, az_); for (const q of [-0.5, 0.5]) { const [bx_, bz_] = at(TS + o, TT + q); B.woodDark.add(rod([bx_, gy - 0.1, bz_], [ax_, gy + 0.9, az_], 0.06, 4)); } }
        B.wood.add(box(0.4, 0.36, 6.2), place(TS, TT, ty + 1.08));
        for (let k = 0; k < 14; k++) { const [cx, cz] = at(TS + (R() - 0.5) * 5, TT + (R() - 0.5) * 1.6); pt.add(box(0.12, 0.02, 0.05), mat(cx, H(cx, cz) + 0.01, cz, 0, R() * TAU, 0), 0xc8a878); }
        ocol(TS, -6.5, 3.3, 0.6);
        poi({ type: 'work', ...(([px, pz]) => ({ x: px, z: pz }))(at(TS, TT - 1.4)), ry: face(-v[0], -v[1]), note: 'dressing timber' });
      }
      let [px, py, pz] = yard(S0 - 3.5, -4); for (const [cs, ct] of [[S0 - 3.5, -4], [S0 - 3, 0.5], [S0 - 5, -5.5], [S0 - 13, -4.5], [S0 - 2.5, -2]]) { [px, py, pz] = yard(cs, ct); if (free(rect(px - 1.2, px + 1.2, pz - 1.2, pz + 1.2), 6.6, 0)) break; }
      if (free(rect(px - 1.2, px + 1.2, pz - 1.2, pz + 1.2), 6.6, 0)) {
        for (let k = 0; k < 5; k++) { const a = k * TAU / 5; pt.add(box(0.35, 0.3, 0.3), mat(px + Math.cos(a) * 0.5, py + 0.12, pz + Math.sin(a) * 0.5, 0, a, 0), 0x6e675e); }
        pt.add(lathe([[0.05, 0], [0.35, 0.05], [0.45, 0.3], [0.46, 0.55]], 10), mat(px, py + 0.28, pz), 0x2a2622);
        pt.add(new THREE.CircleGeometry(0.44, 10).rotateX(-Math.PI / 2), mat(px, py + 0.8, pz), 0x100c0a);
        flame(px, py + 0.08, pz, 0.45);
        collide(rect(px - 0.8, px + 0.8, pz - 0.8, pz + 0.8));
        poi({ type: 'work', x: px - v[0] * 1.3, z: pz - v[1] * 1.3, ry: face(v[0], v[1]), note: 'boiling pitch' });
      }
    }
    let [gx, gz] = at(S0 - 10, 2.5);
    for (let k = 0; k < 20 && hitsCollider(rect(gx - 2.5, gx + 2.5, gz - 2.5, gz + 2.5)); k++) [gx, gz] = at(S0 - 6 - k * 0.8, 2.5 - k * 0.6);
    poi({ type: 'gather', x: gx, z: gz, r: 2.2, note: 'shipsheds' });
    layout.addArea({ name: 'shipyard', minX: gx - 2.5, maxX: gx + 2.5, minZ: gz - 2.5, maxZ: gz + 2.5, owner: own });
    for (const [cs, ct] of [[S0 - 2, -5.5], [S0 - 1.5, -3], [S0 - 3, -11], [S0 - 12, -4]]) { const [vx, vz] = at(cs, ct); if (!world.blocked(vx, vz) && !hitsCollider(rect(vx - 0.5, vx + 0.5, vz - 0.5, vz + 0.5))) { poi({ type: 'view', x: vx, z: vz, ry: face(v[0], v[1]), note: 'shipsheds' }); break; } }
  }

  // =====================================================================
  // ---------- the basin in front of the quay: dredged in the depth buffer ----------
  // =====================================================================
  // The ground in front of the quay face rises up to 2.4 m out of the sea (the agora's flat running out), so the
  // moored ships would sit on sand. Instead of touching the terrain, the basin is drawn in three passes before
  // everything else: (-3) what stands in the water — copies of the hulls and of the quay and mole faces, and all of
  // this feature's own meshes; (-2) flat water at SEA; (-1) an invisible skin 10 cm above the sand that writes depth
  // only. The terrain, the only later thing lying under the skin, then fails the depth test and the water shows.
  const PRE = -3, preWood = new Bucket(), preAsh = new Bucket();
  {
    const ang = Math.atan2(12, 54), inner = z => 240 + 12 * clamp((z - 446) / 54, 0, 1) - 4.5 / Math.cos(ang) + 0.3;   // mole inner faces
    const zs = []; for (let z = 449.5; z < 499.9; z += 1.5) zs.push(z); zs.push(500);
    const NX = 330, sandAt = meshH;
    const skin = { pos: [], idx: [] }, water = { pos: [], uv: [], nor: [], idx: [] }, sand = [];
    for (const z of zs) { const xe = inner(z); for (let i = 0; i <= NX; i++) { const x = lerp(-xe, xe, i / NX), h = sandAt(x, z); sand.push(h); skin.pos.push(x, h + 0.1, z); water.pos.push(x, SEA, z); water.uv.push((x + 4500) / 24, (4500 - z) / 24); water.nor.push(0, 1, 0); } }
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1, hm = Math.max(sand[a], sand[b], sand[c], sand[d]);
      if (hm > SEA - 0.3) skin.idx.push(a, c, b, b, c, d);
      if (hm > SEA - 0.9) water.idx.push(a, c, b, b, c, d);
    }
    // wall off the painted water, so nobody steps off the quay or a mole onto sand drawn as sea: in each row, every run of cells whose
    // sand (or ground) stands above SEA - 0.35 becomes one collider; then a lip along the whole quay face and strips along the inner
    // faces of the moles' first legs, so no one walks off the stone into the basin
    for (let j = 0; j < zs.length - 1; j++) {
      const xa = inner(zs[j]), xb = inner(zs[j + 1]), zm = (zs[j] + zs[j + 1]) / 2; let run = null;
      const flush = () => { if (run) collide(rect(run[0], run[1], zs[j], zs[j + 1])); run = null; };
      for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1, x0 = Math.min(lerp(-xa, xa, i / NX), lerp(-xb, xb, i / NX)), x1 = Math.max(lerp(-xa, xa, (i + 1) / NX), lerp(-xb, xb, (i + 1) / NX));
        const hm = Math.max(sand[a], sand[b], sand[c], sand[d], H(x0, zm), H(x1, zm), H((x0 + x1) / 2, zs[j]), H((x0 + x1) / 2, zs[j + 1]));
        if (hm > SEA - 0.35) { if (run) run[1] = x1; else run = [x0, x1]; } else flush();
      }
      flush();
    }
    collide(rect(-inner(449.5) + 0.2, inner(449.5) - 0.2, 449.55, 449.95));
    for (let j = 0; j < zs.length - 1; j++) { const i0 = Math.min(inner(zs[j]), inner(zs[j + 1])) - 0.5, i1 = Math.max(inner(zs[j]), inner(zs[j + 1])); for (const sx of [-1, 1]) collide(rect(sx * i0, sx * i1, zs[j], zs[j + 1])); }
    // (the skin needs normals too: the ambient-occlusion pass draws it with a normal material; flat ones, like the water's)
    const geo = o => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(water.nor, 3)); if (o.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2)); g.setIndex(o.idx); return g; };
    const film = new THREE.Mesh(geo(water), M.sea); film.name = 'harbour-water'; film.renderOrder = PRE + 1; film.receiveShadow = film.castShadow = false; G.add(film);
    const sk = new THREE.Mesh(geo(skin), new THREE.MeshBasicMaterial({ colorWrite: false })); sk.name = 'harbour-basin-skin'; sk.renderOrder = PRE + 2; sk.receiveShadow = sk.castShadow = false; G.add(sk);
    // hulls moored in the basin (the city's merchantmen and triremes: 20×10 ellipsoids in the wood bucket) and the triremes' rams
    for (const g of B.wood.list) { if (g.attributes.position.count !== 231) continue; g.computeBoundingBox(); const bb = g.boundingBox; if (bb.max.z > 449.5 && bb.min.z < 500 && Math.abs(bb.min.x + bb.max.x) < 500 && bb.min.y < SEA) preWood.add(g.clone()); }
    for (const X of TRIR) preWood.add(new THREE.ConeGeometry(0.5, 2.6, 8), mat(X, SEA, 470, 0, shipRy(X, 470, Math.PI / 2), 0).multiply(mat(17 * 1.03, 0.1, 0, 0, 0, -Math.PI / 2)));
    // the quay block and the first leg of each mole, as city.js builds them
    preAsh.add(box(480, 12, 9), mat(0, agoraL - 6, 445));
    for (const s of [-1, 1]) preAsh.add(box(9, 16, Math.hypot(12, 54) + 2), mat(s * 246, SEA - 5.5, 473, 0, s > 0 ? ang : -ang, 0));
  }

  // ---------- smoke over the beacons: one point cloud of soft puffs that rise, spread and fade; a warm glow round each flame ----------
  if (M.cloud && M.cloud.map) {
    const BEA = [[-222, SEA + 18.3, 605], [222, SEA + 18.3, 605]], NP = 17, N = BEA.length * (NP + 1), R2 = rng(907);
    const attr = { position: new Float32Array(N * 3), size: new Float32Array(N), alpha: new Float32Array(N), age: new Float32Array(N), spin: new Float32Array(N) }, seed = [];
    for (let k = 0; k < N; k++) { attr.spin[k] = R2() * TAU; seed.push([(k % (NP + 1)) / NP + R2() * 0.03, R2() * TAU]); }
    const geo = new THREE.BufferGeometry(); for (const [k, v] of Object.entries(attr)) geo.setAttribute(k, new THREE.BufferAttribute(v, k === 'position' ? 3 : 1));
    const smat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 500 }, young: { value: new THREE.Color(0xa39b93) }, old: { value: new THREE.Color(0xd0c8bd) }, glow: { value: new THREE.Color(0xff8a30) } }]),
      vertexShader: `attribute float size; attribute float alpha; attribute float age; attribute float spin; uniform float scale; varying float vA; varying float vAge; varying float vS;
#include <fog_pars_vertex>
void main() { vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition; gl_PointSize = size * scale / max(0.5, -mvPosition.z); vA = alpha; vAge = age; vS = spin;
#include <fog_vertex>
}`,
      fragmentShader: `uniform sampler2D map; uniform vec3 young; uniform vec3 old; uniform vec3 glow; varying float vA; varying float vAge; varying float vS;
#include <fog_pars_fragment>
void main() {
  vec2 p = gl_PointCoord - 0.5; float c = cos(vS), s = sin(vS); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  if (vAge < 0.0) { float r = length(p) * 2.0, a = pow(max(0.0, 1.0 - r), 2.2) * vA; gl_FragColor = vec4(glow * a, 0.0); return; }   // additive glow
  float a = min(1.0, texture2D(map, vec2(p.x + 0.5, p.y * 0.55 + 0.5)).a * 1.6) * vA; if (a < 0.003) discard;
  gl_FragColor = vec4(mix(young, old, vAge), 1.0);
#include <fog_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`,
      transparent: true, depthWrite: false, fog: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    smat.uniforms.map = { value: M.cloud.map };
    const cloud = new THREE.Points(geo, smat); cloud.name = 'harbour-smoke'; cloud.frustumCulled = false; cloud.castShadow = cloud.receiveShadow = false; G.add(cloud);
    const vs = new THREE.Vector2(); cloud.onBeforeRender = (renderer, scene, camera) => { renderer.getDrawingBufferSize(vs); smat.uniforms.scale.value = vs.y * 0.5 * camera.projectionMatrix.elements[5]; };
    layout.updaters.push((dt, time) => {
      for (let b = 0; b < BEA.length; b++) for (let i = 0; i <= NP; i++) {
        const k = b * (NP + 1) + i, [x, y, z] = BEA[b], [t0, ph] = seed[k];
        if (i === NP) { attr.position.set([x, y - 1.2, z], k * 3); attr.size[k] = 6.5; attr.age[k] = -1; attr.alpha[k] = 0.42 + 0.1 * Math.sin(time * 9.3 + b) * Math.sin(time * 4.1) + 0.05 * Math.sin(time * 21 + b); continue; }
        const t = (t0 + time * 0.045) % 1, h = t * 17;   // a puff lives ~22 s, drifting a little down-wind as it climbs
        attr.position.set([x + Math.sin(ph + time * 0.3) * (0.2 + t * 1.6) + t * t * 5, y + h, z + Math.cos(ph * 1.3 + time * 0.23) * (0.2 + t * 1.6) + t * 2], k * 3);
        attr.size[k] = 2.8 + t * 10; attr.age[k] = Math.min(1, t * 1.4); attr.spin[k] += dt * 0.15 * (ph > Math.PI ? 1 : -1);
        attr.alpha[k] = 0.85 * Math.pow(1 - t, 1.4) * smoothstep(0, 0.07, t);
      }
      for (const k of Object.keys(attr)) geo.attributes[k].needsUpdate = true;
    });
  }

  // ---------- meshes ----------
  const netMat = ctx.setupMaterial(new THREE.MeshStandardMaterial({ map: NETTEX, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: 0.2, color: 0x3a2c1f }));
  const fireMat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
  for (const [b, m, shadow, nm] of [[tc, M.terracotta, true, 'harbour-jars'], [pt, M.painted, true, 'harbour-painted'], [netB, netMat, true, 'harbour-nets']]) {
    const mesh = b.mesh(m, shadow); if (mesh) { mesh.name = nm; mesh.renderOrder = PRE; G.add(mesh); }   // drawn before the basin's water and depth skin
  }
  {   // one mesh casting no shadows, four materials: the basin's copies of the hulls and of the quay and mole faces, the flames, the palace road
    const white = g => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; };
    const fire = fireB.list.length ? mergeGeometries(fireB.list.map(g => { const q = g.index ? g : mergeVertices(g, 1e-4); for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) q.deleteAttribute(k); return q; }), false) : null;
    const parts = [[preWood.build(), M.wood], [preAsh.build(), M.ashlar], [fire, fireMat], [roadMesh.build(), M.roadEarth || M.gravel]].filter(([g]) => g), mesh = new THREE.Mesh(mergeGeometries(parts.map(([g, mm]) => mm === fireMat ? g : white(g)), true), parts.map(([, mm]) => mm));
    mesh.name = 'harbour-basin-and-fire'; mesh.renderOrder = PRE; mesh.castShadow = false; mesh.receiveShadow = true; G.add(mesh);
  }
  layout.updaters.push((dt, t) => { fireMat.color.setScalar(0.9 + 0.1 * Math.sin(t * 9.1) * Math.sin(t * 5.3 + 1) + 0.06 * Math.sin(t * 23.7)); });

  // ---------- open shore ground: dry, unobstructed rectangles on both strips ----------
  {
    const dryOpen = r => { if (layout.isReserved(r, 0.5) || layout.housesIn(r, 1).length || rectRoadD(r) < 5 || bands.some(b => ov(b, r))) return false; for (let x = r.minX; x <= r.maxX + 0.01; x += 1) for (let z = r.minZ; z <= r.maxZ + 0.01; z += 1) if (H(x, z) < SEA + 0.35 || world.blocked(x, z) || slopeAt(x, z) > 0.25 || onMole(x, z, 5.5)) return false; return true; };
    const taken = layout.areas.filter(a => a.owner === own).map(a => rect(a.minX, a.maxX, a.minZ, a.maxZ));
    for (const sx of [-1, 1]) {
      for (const [w, d] of [[16, 10], [12, 8], [9, 6]]) { let added = 0; size: for (let x = 244; x < 460 - w; x += 3) for (let z = 440.5; z < 600 - d; z += 3) {
        if (added >= 2) break size;
        const r = sx > 0 ? rect(x, x + w, z, z + d) : rect(-x - w, -x, z, z + d);
        if ([[r.minX, r.minZ], [r.maxX, r.minZ], [r.minX, r.maxZ], [r.maxX, r.maxZ]].some(([px, pz]) => H(px, pz) < SEA + 0.35) || taken.some(t => ov(t, r, 2)) || !dryOpen(r)) continue;
        layout.addArea({ name: 'shore', ...r, owner: own, note: sx > 0 ? 'east shore' : 'west shore' }); taken.push(r); added++;
      } }
    }
  }
  // every POI stands on the ground it is at (floors, steps, quay and mole tops included)
  for (const p of layout.pois) if (p.owner === own) p.y = world.groundHeight(p.x, p.z);
}
