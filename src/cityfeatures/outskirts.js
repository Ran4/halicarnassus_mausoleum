// Town feature: outskirts — the land outside the circuit wall. Necropoleis line the roads beyond the Myndos
// (west) and east gates: family plots with stelai, marble lekythoi and loutrophoroi, sarcophagi, a temple-tomb,
// a lion tomb, a pillar tomb, stone-heaped tumuli and cypresses. Further out, farmsteads with towers, threshing
// floors, pens, hives, wells and field shrines sit among walled fields, vineyards and olive terraces with presses.
import * as THREE from 'three';
import { Bucket, ColorBucket, box, lathe, rectSweep, tubeY, ellipsoid, tx, mat, rng, lerp, clamp, smoothstep, TAU, makeNoise2D } from '../util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight, slopeAt, SEA } from '../terrain.js';
import { figureGeometry, lionGeometry } from '../sculpture.js';

export const name = 'outskirts';
const OWN = 'outskirts';

// ---------- the rendered ground: buildTerrainMesh's warped 420-cell grid, interpolated per triangle ----------
const TS = 3400, TN = 420, warp = t => TS / 2 * (0.13 * t + 0.87 * t * t * t);
const unwarp = x => { let lo = -1, hi = 1; for (let i = 0; i < 34; i++) { const m = (lo + hi) / 2; if (warp(m) < x) lo = m; else hi = m; } return (lo + hi) / 2; };
const HC = new Map();
const vh = (i, j) => { const k = i * 1000 + j; let h = HC.get(k); if (h === undefined) HC.set(k, h = terrainHeight(warp(i / TN * 2 - 1), warp(j / TN * 2 - 1))); return h; };
function gy(x, z) {
  const i = Math.floor((unwarp(x) + 1) / 2 * TN), j = Math.floor((unwarp(z) + 1) / 2 * TN);
  const xa = warp(i / TN * 2 - 1), xb = warp((i + 1) / TN * 2 - 1), za = warp(j / TN * 2 - 1), zb = warp((j + 1) / TN * 2 - 1);
  const u = (x - xa) / (xb - xa), v = (z - za) / (zb - za), a = vh(i, j), b = vh(i + 1, j), c = vh(i, j + 1);
  if (u + v <= 1) return a + (b - a) * u + (c - a) * v;
  const d = vh(i + 1, j + 1); return d + (c - d) * (1 - u) + (b - d) * (1 - v);
}

// ---------- geography: the wall circuit, roads, oriented rectangles ----------
const WALL = [[-640, 640], [-700, 350], [-760, 0], [-720, -350], [-560, -650], [-300, -880], [0, -960], [300, -900], [560, -700], [740, -400], [780, -50], [760, 300], [640, 560]];
const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1); return Math.hypot(px - ax - t * dx, pz - az - t * dz); };
const polyD = (P, x, z) => { let d = Infinity; for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segD(x, z, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1])); return d; };
const inWall = (x, z) => { let c = false; for (let i = 0, j = WALL.length - 1; i < WALL.length; j = i++) { const [xi, zi] = WALL[i], [xj, zj] = WALL[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
const outside = (x, z, m = 20) => !inWall(x, z) && polyD(WALL, x, z) >= m;
const ov = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
// oriented rect o = {x, z, ry, hw, hd}: local +Z is the front, world = (x + c·lx + s·lz, z − s·lx + c·lz)
const L2W = (o, lx, lz) => { const c = Math.cos(o.ry), s = Math.sin(o.ry); return [o.x + c * lx + s * lz, o.z - s * lx + c * lz]; };
const W2L = (o, x, z) => { const dx = x - o.x, dz = z - o.z, c = Math.cos(o.ry), s = Math.sin(o.ry); return [c * dx - s * dz, s * dx + c * dz]; };
const aabb = (o, m = 0) => { const xs = [], zs = []; for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const p = L2W(o, a * (o.hw + m), b * (o.hd + m)); xs.push(p[0]); zs.push(p[1]); } return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }; };
const samples = (o, n = 4) => { const out = []; for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) out.push(L2W(o, (i / n * 2 - 1) * o.hw, (j / n * 2 - 1) * o.hd)); return out; };
const gRange = (o, n = 4) => { let lo = Infinity, hi = -Infinity; for (const [x, z] of samples(o, n)) { const h = gy(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); } return [lo, hi]; };
const polyLen = P => { let L = 0; for (let i = 0; i < P.length - 1; i++) L += Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]); return L; };
function polyAt(P, s) {
  for (let i = 0; i < P.length - 1; i++) {
    const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dz);
    if (s <= l || i === P.length - 2) { const t = s / l; return { x: P[i][0] + dx * t, z: P[i][1] + dz * t, tx: dx / l, tz: dz / l }; }
    s -= l;
  }
}


// ---------- geometry helpers ----------
const M4 = (m, x = 0, y = 0, z = 0, ry = 0, s = 1) => m.clone().multiply(mat(x, y, z, 0, ry, 0, s));
const pick = (R, a) => a[Math.floor(R() * a.length)];
function taperBox(w, h, d, kx = 1, kz = 1) { const g = box(w, h, d), p = g.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * kx); p.setZ(i, p.getZ(i) * kz); } g.computeVertexNormals(); return g; }
function rod(a, b, r, seg = 5, r2 = r) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), L = A.distanceTo(B) || 1e-3, g = new THREE.CylinderGeometry(r2, r, L, seg, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return g.applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}
const cyl = (r0, r1, h, seg = 10, open = false) => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open);
// triangle in XY (base w, apex h), extruded d along Z and centred: pediments; rotate by π/2 for a gable lid along X
function pedZ(w, h, d) { const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]); return tx(new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false }), 0, 0, -d / 2); }
function extrudeZ(pts, d) { return tx(new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1]))), { depth: d, bevelEnabled: false, curveSegments: 3 }), 0, 0, -d / 2); }
function anthemion(w, d) {  // palmette finial silhouette, 7 lobes over two volutes, base at y=0
  const pts = [[-0.26, 0], [-0.42, 0.04], [-0.46, 0.13], [-0.36, 0.17]];
  for (let i = 0; i <= 14; i++) { const u = i / 14, a = -1.1 + 2.2 * u, r = 0.5 * (0.6 + 0.4 * Math.pow(Math.abs(Math.sin(u * 7 * Math.PI)), 0.6)) * (1 + 0.25 * Math.cos(a * 1.4)); pts.push([Math.sin(a) * r * 0.9, 0.14 + Math.cos(a) * r * 1.25]); }
  pts.push([0.36, 0.17], [0.46, 0.13], [0.42, 0.04], [0.26, 0]);
  return extrudeZ(pts.map(p => [p[0] * w, p[1] * w]), d);
}
const LEKY = [[0.001, 0], [0.14, 0], [0.14, 0.05], [0.09, 0.08], [0.2, 0.22], [0.21, 0.72], [0.08, 0.84], [0.045, 0.9], [0.045, 1.02], [0.085, 1.1], [0.001, 1.16]];
const LOUT = [[0.001, 0], [0.15, 0], [0.15, 0.05], [0.06, 0.13], [0.17, 0.4], [0.2, 0.6], [0.17, 0.8], [0.07, 0.94], [0.05, 1.35], [0.16, 1.55], [0.001, 1.58]];
const PITHOS = [[0.001, 0], [0.18, 0], [0.42, 0.25], [0.55, 0.6], [0.52, 0.9], [0.34, 1.12], [0.3, 1.16], [0.34, 1.22], [0.27, 1.25], [0.001, 1.2]];
const AMPH = [[0.001, 0], [0.03, 0], [0.05, 0.08], [0.16, 0.3], [0.2, 0.5], [0.18, 0.62], [0.08, 0.72], [0.06, 0.85], [0.08, 0.88], [0.001, 0.88]];
const SMALLPOT = [[0.001, 0], [0.06, 0.01], [0.1, 0.13], [0.05, 0.22], [0.03, 0.3], [0.001, 0.33]];
// a draped figure as a flat relief silhouette (0.78 m): cheap processions on friezes
const SILH = [[-0.11, 0], [0.11, 0], [0.08, 0.35], [0.1, 0.5], [0.14, 0.52], [0.15, 0.46], [0.17, 0.47], [0.16, 0.56], [0.1, 0.6], [0.04, 0.62], [0.045, 0.66], [0.06, 0.7], [0.04, 0.76], [0, 0.78], [-0.04, 0.76], [-0.06, 0.7], [-0.045, 0.66], [-0.04, 0.62], [-0.1, 0.6], [-0.14, 0.5], [-0.16, 0.36], [-0.12, 0.36], [-0.09, 0.48], [-0.08, 0.35]];
// a figure squashed into a relief: whatever lies behind the ground plane z = zc is dropped
function relief(g, m, zc) {
  g = g.clone().applyMatrix4(m); const p = g.attributes.position, idx = g.index.array, keep = [];
  const A = new THREE.Vector3(), B2 = new THREE.Vector3(), C = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    A.fromBufferAttribute(p, idx[i]); B2.fromBufferAttribute(p, idx[i + 1]); C.fromBufferAttribute(p, idx[i + 2]);
    const nz = (B2.x - A.x) * (C.y - A.y) - (B2.y - A.y) * (C.x - A.x);   // faces turned away from the viewer are never seen against the panel
    if (Math.max(A.z, B2.z, C.z) > zc && nz > -1e-5) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  g.setIndex(keep); return g;
}
function cypressGeo(R, H) {
  const body = new Bucket(), cards = new Bucket(), mx = 1.1 * (H / 11), pts = [[0.001, 0.55], [0.45 * mx, 0.62], [0.6 * mx, 0.85]];   // columnar on a blunt base over a short bare trunk, tapering only in the upper half
  for (let i = 1; i <= 9; i++) { const t = i / 9; pts.push([Math.max(0.03, 1.1 * (0.58 + 0.42 * smoothstep(0, 0.25, t)) * (1 - Math.pow(t, 2.2)) * (0.96 + 0.05 * Math.sin(i * 2.3 + R() * 2)) * (H / 11)), 0.85 + t * (H - 0.85)]); }
  pts.push([0.01, H + 0.05]); body.add(lathe(pts, 8));
  const card = new THREE.PlaneGeometry(2.6 * (H / 11), H - 0.5);
  for (let i = 0; i < 3; i++) cards.add(card, mat(0, 1.0 + (H - 0.5) / 2, 0, 0, i * Math.PI / 3, 0));
  return { body: body.build(), cards: cards.build(), trunk: cyl(0.2, 0.12, 1.4, 6, true).translate(0, 0.7, 0) };
}
function oliveGeo(R, lo = false, V = {}) {   // lo: fewer branches and cards for the distant groves; V: other proportions make an almond or a fig
  const { h0 = 1.6, hr = 0.7, r0 = 0.24, nb0 = lo ? 2 : 3, l0 = 0.9, lr = 0.8, up = 0.7, cs = lo ? 2.0 : 1.6, nc = lo ? 4 : 6, sp = 2.2 } = V;
  const trunk = new Bucket(), leaves = new Bucket(), ph = R() * TAU, H = h0 + R() * hr;
  const wx = t => 0.3 * Math.sin(t * 2.5 + ph) * t, wz = t => 0.25 * Math.cos(t * 2.1 + ph) * t;
  trunk.add(tubeY(lo ? 3 : 4, lo ? 5 : 6, (i, j, t, a) => { const r = lerp(r0, 0.1, t) * (1 + 0.25 * Math.sin(3 * a + t * 5 + ph) * (1 - 0.6 * t)); return [Math.cos(a) * r + wx(t), t * H, -Math.sin(a) * r + wz(t)]; }, 1.4, H));
  const top = [wx(1), H, wz(1)], nB = nb0 + (R() < 0.5 ? 1 : 0), card = new THREE.PlaneGeometry(cs, cs);
  for (let b = 0; b < nB; b++) {
    const a = b / nB * TAU + R() * 0.8, L = l0 + R() * lr, c = [top[0] + Math.cos(a) * L, H + up + R() * 0.6, top[2] - Math.sin(a) * L];
    trunk.add(rod(top, c, 0.08, lo ? 3 : 4, 0.05));
    for (let i = 0; i < nc; i++) leaves.add(card, mat(c[0] + (R() - 0.5) * sp, c[1] + (R() - 0.5) * 1.4, c[2] + (R() - 0.5) * sp, R() * TAU, R() * TAU, R() * TAU));
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}

// ---------- animals (painted, facing +Z) ----------
function animal(K, m, R, kind) {
  const C = K.paint, graze = R() < 0.45, A = (g, c, x = 0, y = 0, z = 0, rx = 0) => C.add(g, m.clone().multiply(mat(x, y, z, rx, 0, 0)), c);
  const legs = (hx, fz, bz, top, r, c) => { for (const sx of [-1, 1]) for (const sz of [fz, bz]) A(rod([sx * hx, top, sz], [sx * hx * 1.05, 0, sz + 0.02 * sx], r, 4, r * 0.8), c); };
  if (kind === 'sheep') {
    const fl = pick(R, [0xd8cfbc, 0xcfc4ad, 0xc9bda3, 0x8a7a66, 0xe0d8c6]), hd = R() < 0.6 ? 0x3a3129 : 0xc9bba2, hy = graze ? 0.28 : 0.66, hz = graze ? 0.55 : 0.5;
    A(ellipsoid(0.23, 0.22, 0.42, 8, 5), fl, 0, 0.56, 0); A(ellipsoid(0.2, 0.17, 0.14, 6, 4), fl, 0, 0.62, 0.3);
    A(ellipsoid(0.075, 0.09, 0.15, 6, 4), hd, 0, hy, hz, graze ? 0.9 : 0.35);
    for (const s of [-1, 1]) A(box(0.1, 0.03, 0.05), hd, s * 0.09, hy + 0.05, hz - 0.08);
    legs(0.12, 0.26, -0.26, 0.45, 0.03, hd); A(rod([0, 0.6, -0.4], [0, 0.35, -0.46], 0.035, 4), fl);
  } else if (kind === 'goat') {
    const c = pick(R, [0x3a2e26, 0x6e5238, 0xd6cdbd, 0x8f7b66, 0x4a3f36]), hy = graze ? 0.25 : 0.86, hz = graze ? 0.52 : 0.46;
    A(ellipsoid(0.16, 0.19, 0.38, 8, 5), c, 0, 0.62, 0); A(rod([0, 0.7, 0.3], [0, hy + 0.05, hz - 0.1], 0.07, 5, 0.05), c);
    A(ellipsoid(0.065, 0.075, 0.15, 6, 4), c, 0, hy, hz, graze ? 1.0 : 0.5);
    for (const s of [-1, 1]) { A(rod([s * 0.04, hy + 0.07, hz - 0.08], [s * 0.08, hy + 0.22, hz - 0.22], 0.018, 4, 0.006), 0x4a4038); A(box(0.09, 0.025, 0.04), c, s * 0.08, hy + 0.04, hz - 0.1); }
    legs(0.1, 0.25, -0.25, 0.5, 0.025, c); A(rod([0, 0.7, -0.37], [0, 0.8, -0.44], 0.03, 4), c);
  } else if (kind === 'ox') {
    const c = pick(R, [0x4a3a2c, 0x5e4c3a, 0x362a22, 0x6a5440]);
    A(ellipsoid(0.36, 0.42, 0.9, 10, 6), c, 0, 1.0, 0); A(ellipsoid(0.3, 0.3, 0.3, 8, 5), c, 0, 1.15, 0.55);
    A(ellipsoid(0.15, 0.2, 0.3, 8, 5), c, 0, 0.95, 1.05, 0.9); A(rod([0, 1.12, 0.7], [0, 0.95, 1.0], 0.2, 6, 0.13), c);
    for (const s of [-1, 1]) A(rod([s * 0.1, 1.12, 0.98], [s * 0.36, 1.3, 0.95], 0.035, 4, 0.012), 0xd8ccb0);
    legs(0.22, 0.6, -0.62, 0.8, 0.07, c); A(rod([0, 1.2, -0.88], [0, 0.45, -0.95], 0.025, 4), c);
  } else {  // donkey
    const c = pick(R, [0x8a8278, 0x6f665c, 0x9a8f80]);
    A(ellipsoid(0.24, 0.27, 0.55, 8, 5), c, 0, 0.85, 0); A(rod([0, 0.95, 0.4], [0, 1.25, 0.62], 0.12, 5, 0.09), c);
    A(ellipsoid(0.1, 0.12, 0.26, 6, 4), c, 0, 1.2, 0.78, 0.7);
    for (const s of [-1, 1]) A(rod([s * 0.05, 1.33, 0.62], [s * 0.1, 1.6, 0.56], 0.03, 4, 0.015), c);
    legs(0.13, 0.38, -0.38, 0.7, 0.04, c); A(rod([0, 0.95, -0.52], [0, 0.5, -0.6], 0.02, 4), 0x3a342e);
  }
}

// ---------- funerary monuments (local +Z faces the road, y = 0 at the ground they stand on) ----------
function stele(K, m, R, kind, fig) {
  kind = kind || pick(R, ['anthemion', 'anthemion', 'pediment', 'rosette']);
  const w = 0.5 + R() * 0.2, h = (fig ? 1.45 : 1.15) + R() * 0.6, t = 0.14, y1 = 0.4 + h, tw = w * 0.9;
  (R() < 0.4 ? K.socles : K.grey).add(box(w + 0.3, 0.8, 0.52), m);
  (R() < 0.3 ? K.grey : K.marble).add(taperBox(w, h, t, 0.9, 0.92), M4(m, 0, 0.4 + h / 2, 0));
  if (kind === 'anthemion') { K.marble.add(box(tw + 0.04, 0.06, t + 0.03), M4(m, 0, y1 + 0.03, 0)); K.marble.add(anthemion(tw * 1.05, 0.07), M4(m, 0, y1 + 0.06, 0)); }
  else if (kind === 'pediment') {
    K.marble.add(box(tw + 0.1, 0.07, t + 0.05), M4(m, 0, y1 + 0.035, 0)); K.marble.add(pedZ(tw + 0.1, 0.19, t + 0.03), M4(m, 0, y1 + 0.07, 0));
    for (const s of [-1, 0, 1]) K.marble.add(box(0.09, s ? 0.09 : 0.13, 0.05), M4(m, s * (tw / 2 + 0.03), y1 + (s ? 0.11 : 0.3), 0));
  } else {
    K.marble.add(box(tw + 0.08, 0.1, t + 0.05), M4(m, 0, y1 + 0.05, 0));   // a painted band under the crown carrying three small rosettes
    K.paint.add(box(tw * 0.98, 0.16, 0.012), M4(m, 0, y1 - 0.3, t / 2 + 0.004), 0x6e3a30);
    for (const s of [-1, 0, 1]) K.marble.add(cyl(0.045, 0.04, 0.03, 6).rotateX(Math.PI / 2), M4(m, s * tw * 0.3, y1 - 0.3, t / 2 + 0.012));
  }
  if (fig) {
    for (const s of [-1, 1]) K.marble.add(box(0.05, 0.98, 0.04), M4(m, s * (tw / 2 - 0.02), 0.95, t / 2 + 0.01));
    K.marble.add(box(tw, 0.06, 0.05), M4(m, 0, 1.47, t / 2 + 0.01)); K.statue.add(fig, M4(m, 0, 0.46, t / 2 - 0.005));
  }
  if (R() < 0.4) {
    const by = 0.4 + h * (0.5 + R() * 0.3), c = pick(R, [0x8a2f2a, 0x5b3a6e, 0x2f4f7f, 0x9a6a2a]);
    K.paint.add(box(w * 0.95 + 0.02, 0.045, t + 0.025), M4(m, 0, by, 0), c);
    for (const s of [-1, 1]) K.paint.add(box(0.035, 0.34, 0.012), m.clone().multiply(mat(s * 0.06, by - 0.18, t / 2 + 0.02, 0, 0, s * 0.12)), c);
  }
  if (R() < 0.3) for (let i = 0, n = 1 + Math.floor(R() * 3); i < n; i++) K.terra.add(lathe(SMALLPOT, 5), M4(m, (R() - 0.5) * (w + 0.2), 0, 0.42 + R() * 0.2, 0, 0.8 + R() * 0.7), pick(R, [0xe3d8c2, 0xb8734a, 0x8a5a3a, 0xd9ccb2]));
  return [(w + 0.3) / 2, 0.3];
}
function naiskos(K, m, R, pair) {
  K.grey.add(box(1.95, 0.9, 1.0), M4(m, 0, 0.05, 0));
  K.marble.add(box(1.75, 0.12, 0.8), M4(m, 0, 0.56, 0.05));
  K.marble.add(box(1.5, 1.75, 0.18), M4(m, 0, 0.62 + 0.875, -0.27));
  K.paint.add(box(1.14, 1.55, 0.01), M4(m, 0, 0.62 + 0.8, -0.175), 0x5f7590);
  for (const s of [-1, 1]) K.marble.add(taperBox(0.18, 1.75, 0.62, 0.9, 1), M4(m, s * 0.66, 0.62 + 0.875, 0.0));
  K.marble.add(box(1.62, 0.22, 0.68), M4(m, 0, 2.48, 0.0));
  K.paint.add(box(1.62, 0.07, 0.01), M4(m, 0, 2.46, 0.345), 0x7a3328);
  K.marble.add(pedZ(1.75, 0.34, 0.64), M4(m, 0, 2.59, 0));
  for (const s of [-1, 0, 1]) K.marble.add(s ? box(0.12, 0.14, 0.12) : anthemion(0.34, 0.06), M4(m, s * 0.84, s ? 2.66 : 2.84, 0.1));
  K.statue.add(pair, M4(m, 0, 0.62, -0.18));
  for (let i = 0, n = Math.floor(R() * 4); i < n; i++) K.terra.add(lathe(SMALLPOT, 6), M4(m, (R() - 0.5) * 1.4, 0, 0.62 + R() * 0.25, 0, 0.9 + R() * 0.8), pick(R, [0xe3d8c2, 0xb8734a, 0x8a5a3a]));
  return [0.98, 0.5];
}
function vase(K, m, R, loutro) {
  K.grey.add(box(0.62, 0.9, 0.62), M4(m, 0, 0.05, 0)); K.grey.add(box(0.7, 0.06, 0.7), M4(m, 0, 0.53, 0));
  const s = loutro ? 0.9 : 1.0, v = M4(m, 0, 0.56, 0, R() * TAU, s);
  K.marble.add(lathe(loutro ? LOUT : LEKY, 6), v);
  if (loutro) for (const x of [-1, 1]) { K.marble.add(rod([x * 0.15, 0.78, 0], [x * 0.19, 1.4, 0], 0.022, 4), v); K.marble.add(rod([x * 0.19, 1.4, 0], [x * 0.06, 1.44, 0], 0.022, 4), v); }
  else { K.marble.add(rod([0, 0.79, -0.15], [0, 1.02, -0.13], 0.022, 4), v); K.marble.add(rod([0, 1.02, -0.13], [0, 1.02, -0.045], 0.022, 4), v); }
  if (R() < 0.3) K.paint.add(cyl(0.215, 0.215, 0.05, 12, true), M4(v, 0, 0.62, 0), pick(R, [0x8a2f2a, 0x2f4f7f]));
  return [0.35, 0.35];
}
function sarcophagus(K, m, R, bucket) {
  const w = 2.2 + R() * 0.3, d = 0.95 + R() * 0.15, h = 0.95;
  bucket.add(rectSweep(w, d, [{ o: 0.1, y: -0.4 }, { o: 0.1, y: 0.16, hard: true }, { o: 0.02, y: 0.24, hard: true }, { o: 0, y: 0.3, hard: true }, { o: 0, y: h, hard: true }, { o: 0.06, y: h + 0.06, hard: true }, { o: 0.06, y: h + 0.12, hard: true }], { top: true }), m);
  bucket.add(pedZ(d + 0.14, 0.3, w + 0.14), M4(m, 0, h + 0.12, 0, Math.PI / 2));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bucket.add(box(0.2, 0.2, 0.16), M4(m, sx * (w / 2 + 0.02), h + 0.22, sz * (d / 2 + 0.02)));
  return [w / 2 + 0.12, d / 2 + 0.12];
}
function kioniskos(K, m, R) {
  K.grey.add(box(0.55, 0.7, 0.55), M4(m, 0, -0.05, 0));
  K.marble.add(cyl(0.15, 0.13, 1.0 + R() * 0.3, 8), M4(m, 0, 0.8, 0));
  K.marble.add(cyl(0.16, 0.21, 0.08, 8), M4(m, 0, 1.36, 0)); if (R() < 0.5) K.marble.add(lathe(SMALLPOT, 6), M4(m, 0, 1.4, 0, 0, 1.2));
  return [0.3, 0.3];
}
function trapeza(K, m, R) {
  (R() < 0.5 ? K.grey : K.marble).add(rectSweep(1.5, 0.8, [{ o: 0.08, y: -0.4 }, { o: 0.08, y: 0.1, hard: true }, { o: 0, y: 0.18, hard: true }, { o: 0, y: 0.55, hard: true }, { o: 0.08, y: 0.62, hard: true }, { o: 0.08, y: 0.7 }], { top: true }), m);
  return [0.85, 0.5];
}
function lionPillar(K, m, R) {
  K.grey.add(rectSweep(1.0, 1.6, [{ o: 0.08, y: -0.4 }, { o: 0.08, y: 0.2, hard: true }, { o: 0, y: 0.3, hard: true }, { o: 0, y: 1.2, hard: true }, { o: 0.08, y: 1.3 }], { top: true }), m);
  K.statue.add(K.lionS, M4(m, 0, 1.3, 0, R() < 0.5 ? -Math.PI / 2 : Math.PI / 2));
  return [0.6, 0.9];
}
const ionic = (K, m, h) => {
  K.marble.add(lathe([[0.001, 0], [0.34, 0], [0.34, 0.08], [0.28, 0.14], [0.3, 0.2], [0.25, 0.26]], 12), m);
  K.marble.add(cyl(0.25, 0.21, h - 0.46, 12, true), M4(m, 0, 0.26 + (h - 0.46) / 2, 0));
  K.marble.add(box(0.7, 0.14, 0.44), M4(m, 0, h - 0.13, 0)); K.marble.add(box(0.52, 0.08, 0.52), M4(m, 0, h - 0.02, 0));
  for (const s of [-1, 1]) K.marble.add(cyl(0.1, 0.1, 0.46, 8).rotateX(Math.PI / 2), M4(m, s * 0.31, h - 0.18, 0));
};

// ---------- build-time state: buckets, colliders, POIs ----------
let S = null;
const col = bb => S.world.colliders.push(bb);
const colRect = (o, lx, lz, hw, hd, m = 0) => {   // a rotated rect becomes a ring of small AABBs so it does not swallow the space around it
  const [cx, cz] = L2W(o, lx, lz);
  if (Math.abs(Math.sin(2 * o.ry)) < 0.05) return col(aabb({ x: cx, z: cz, ry: o.ry, hw, hd }, m));
  const nx = Math.max(1, Math.ceil(2 * hw / 1.6)), nz = Math.max(1, Math.ceil(2 * hd / 1.6));
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
    const [x, z] = L2W(o, lx + ((2 * i + 1) / nx - 1) * hw, lz + ((2 * j + 1) / nz - 1) * hd); col(aabb({ x, z, ry: o.ry, hw: hw / nx, hd: hd / nz }, m * 0.6));
  }
};
const poi = (type, o, lx, lz, dry, extra = {}) => { const [x, z] = L2W(o, lx, lz); return S.layout.addPoi({ type, x, z, y: S.world.groundHeight(x, z), ry: o.ry + dry, r: 1.5, owner: OWN, ...extra }); };
const at = (o, lx, lz, dry = 0, s = 1) => { const [x, z] = L2W(o, lx, lz); return mat(x, gy(x, z), z, 0, o.ry + dry, 0, s); };
const frame = (o, y) => mat(o.x, y, o.z, 0, o.ry, 0);
const frontGap = (o, inset, w, off = 0) => { const c = 4 * (o.hd - inset) + 3 * (o.hw - inset) - off; return [[c - w / 2, c + w / 2]]; };  // arc interval of a gap in rectPts' front edge
const rectPts = (o, inset = 0) => [[-1, 1], [-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => L2W(o, a * (o.hw - inset), b * (o.hd - inset)));

// dry-stone / ashlar wall along a world polyline as one continuous battered strip following the ground;
// gaps: [[s0, s1]] arc intervals left open. Colliders in short runs.
function dryWall(bucket, P, h, t, { gaps = [], seg = 3, cap = null, k = 0.8, jit = 0.12, R = null } = {}) {
  const closed = P.length > 2 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 0.01;
  const dirs = []; for (let i = 0; i < P.length - 1; i++) { const dx = P[i + 1][0] - P[i][0], dz = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dz) || 1; dirs.push([dx / l, dz / l, l]); }
  const secN = (i) => {   // mitred left normal at polyline vertex i
    const a = dirs[i > 0 ? i - 1 : (closed ? dirs.length - 1 : 0)], b = dirs[i < dirs.length ? i : (closed ? 0 : dirs.length - 1)];
    let nx = -(a[1] + b[1]), nz = a[0] + b[0], l = Math.hypot(nx, nz); if (l < 1e-3) { nx = -b[1]; nz = b[0]; l = 1; }
    nx /= l; nz /= l; const mit = 1 / Math.max(0.5, nx * -b[1] + nz * b[0]); return [nx * mit, nz * mit];
  };
  let run = [], s0 = 0, acc = null;
  const flushCol = () => { if (acc) col(acc); acc = null; };
  const addCol = (ax, az, bx, bz) => {   // pieces short enough that a slanted wall does not swallow the ground beside it
    const l = Math.hypot(bx - ax, bz - az), sn = Math.min(Math.abs(bx - ax), Math.abs(bz - az)) / (l || 1), k = Math.max(1, Math.ceil(l / clamp(0.8 / Math.max(sn, 1e-3), 0.8, 12)));
    for (let e = 0; e < k; e++) {
      const x0 = lerp(ax, bx, e / k), z0 = lerp(az, bz, e / k), x1 = lerp(ax, bx, (e + 1) / k), z1 = lerp(az, bz, (e + 1) / k);
      const bb = { minX: Math.min(x0, x1) - t / 2, maxX: Math.max(x0, x1) + t / 2, minZ: Math.min(z0, z1) - t / 2, maxZ: Math.max(z0, z1) + t / 2 };
      const nb = acc && { minX: Math.min(acc.minX, bb.minX), maxX: Math.max(acc.maxX, bb.maxX), minZ: Math.min(acc.minZ, bb.minZ), maxZ: Math.max(acc.maxZ, bb.maxZ) };
      if (nb && Math.min(nb.maxX - nb.minX, nb.maxZ - nb.minZ) <= t + 0.8 && Math.max(nb.maxX - nb.minX, nb.maxZ - nb.minZ) <= 12) acc = nb; else { flushCol(); acc = bb; }
    }
  };
  const emit = () => {
    if (run.length > 1) {
      const pos = [], uv = [], idx = [], V = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1; };
      const L = run.map(q => [q.x + q.nx * t / 2, q.b, q.z + q.nz * t / 2, q.x + q.nx * t * k / 2, q.T, q.z + q.nz * t * k / 2]);
      const Rr = run.map(q => [q.x - q.nx * t / 2, q.b, q.z - q.nz * t / 2, q.x - q.nx * t * k / 2, q.T, q.z - q.nz * t * k / 2]);
      const strip = (A, B, flip, uvB) => { const base = pos.length / 3; run.forEach((q, j) => { V(A[j][0], A[j][1], A[j][2], q.s, 0); V(B[j][0], B[j][1], B[j][2], q.s, uvB(j)); }); for (let j = 0; j < run.length - 1; j++) { const a = base + 2 * j, b = a + 1, c = a + 2, d = a + 3; if (!flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c); } };
      strip(L.map(v => v.slice(0, 3)), L.map(v => v.slice(3)), false, j => run[j].T - run[j].b);
      strip(Rr.map(v => v.slice(0, 3)), Rr.map(v => v.slice(3)), true, j => run[j].T - run[j].b);
      strip(L.map(v => v.slice(3)), Rr.map(v => v.slice(3)), false, () => t);
      for (const [j, flip] of [[0, false], [run.length - 1, true]]) { const a = V(...L[j].slice(0, 3), 0, 0), b = V(...L[j].slice(3), 0, 1), c = V(...Rr[j].slice(3), t, 1), d = V(...Rr[j].slice(0, 3), t, 0); if (!flip) idx.push(a, b, d, b, c, d); else idx.push(a, d, b, b, d, c); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
      bucket.add(g);
    }
    run = []; flushCol();
  };
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz, L] = [P[i + 1][0], P[i + 1][1], dirs[i][2]], n = Math.max(1, Math.ceil(L / seg)), nA = secN(i), nB = secN(i + 1), nm = [-dirs[i][1], dirs[i][0]];
    const ts = []; for (let q = i > 0 ? 1 : 0; q <= n; q++) ts.push({ s: s0 + L * q / n, f: q / n, nn: q === 0 ? nA : q === n ? nB : nm });
    for (const g of gaps) for (const e of [0, 1]) if (g[e] > s0 + 1e-3 && g[e] < s0 + L - 1e-3) ts.push({ s: g[e], f: (g[e] - s0) / L, nn: nm, edge: e });   // gap edges exactly where asked
    ts.sort((a, b) => a.s - b.s);
    for (const q of ts) {
      if (gaps.some(g => q.s > g[0] + 1e-4 && q.s < g[1] - 1e-4)) { emit(); continue; }
      const x = lerp(ax, bx, q.f), z = lerp(az, bz, q.f), g0 = gy(x, z);
      run.push({ x, z, s: q.s, nx: q.nn[0], nz: q.nn[1], b: g0 - 0.45, T: g0 + h + (R ? (R() - 0.5) * jit : 0) });
      if (run.length > 1) {
        const p = run[run.length - 2]; addCol(p.x, p.z, x, z);
        if (cap) { const len = Math.hypot(x - p.x, z - p.z) + 0.1, top = (p.T + run[run.length - 1].T) / 2; cap.add(box(len, 0.1, t * k + 0.1), mat((x + p.x) / 2, top + 0.05, (z + p.z) / 2, 0, Math.atan2(-(z - p.z), x - p.x), 0)); }
      }
      if (q.edge === 0) emit();
    }
    s0 += L;
  }
  emit();
}

// ---------- the great tombs ----------
function lionTomb(K, o, R) {   // after the lion tomb at Knidos: podium, engaged Doric colonnade, stepped pyramid, lion
  const c = { ...o, hw: 5.4, hd: 5.4 }, [lo, hi] = gRange(c), m = frame(o, hi), dep = hi - lo + 0.8;
  [[10.8, 0.35], [10.1, 0.7], [9.4, 1.05]].forEach(([s, y], i) => K.grey.add(box(s, (i ? 0.35 : 0.35 + dep), s), M4(m, 0, i ? y - 0.175 : (0.35 - dep) / 2, 0)));
  K.ashlar.add(box(8.6, 3.4, 8.6), M4(m, 0, 2.75, 0));
  K.marble.add(rectSweep(8.6, 8.6, [{ o: 0, y: 4.45 }, { o: 0.14, y: 4.6, hard: true }, { o: 0.14, y: 4.75 }], { top: true }), m);
  K.marble.add(box(7.5, 3.2, 7.5), M4(m, 0, 6.35, 0));
  const P = [-3.8, -1.27, 1.27, 3.8];
  for (const a of P) for (const b of P) { if (Math.abs(a) < 3 && Math.abs(b) < 3) continue; K.marble.add(cyl(0.36, 0.3, 3.0, 12, true), M4(m, a, 6.25, b)); K.marble.add(box(0.82, 0.2, 0.82), M4(m, a, 7.85, b)); }
  K.marble.add(box(8.4, 0.5, 8.4), M4(m, 0, 8.2, 0)); K.marble.add(box(8.2, 0.55, 8.2), M4(m, 0, 8.72, 0));
  for (let r = 0; r < 4; r++) for (let i = 0; i < 7; i++) { const u = -3.81 + i * 1.27, rr = r * Math.PI / 2; K.paint.add(box(0.24, 0.5, 0.06), m.clone().multiply(mat(0, 0, 0, 0, rr, 0)).multiply(mat(u, 8.72, 4.11)), 0x5a6470); }
  K.marble.add(box(8.9, 0.26, 8.9), M4(m, 0, 9.12, 0));
  for (let i = 0; i < 8; i++) K.grey.add(box(8.4 - i * 0.72, 0.42, 8.4 - i * 0.72), M4(m, 0, 9.46 + i * 0.42, 0));
  K.grey.add(box(3.36, 0.32, 1.9), M4(m, 0, 12.76, 0)); K.marble.add(box(3.1, 0.9, 1.5), M4(m, 0, 13.36, 0));   // tall plinth, the lion broadside to the road
  K.statue.add(K.lionB, M4(m, 0.05, 13.81, 0, R() < 0.5 ? 0 : Math.PI));
  colRect(o, 0, 0, 5.4, 5.4, 0.1);
  dryWall(K.ashlar, rectPts(o, 0.4), 0.95, 0.6, { gaps: frontGap(o, 0.4, 3.2), cap: K.marble, k: 1 });
  K.ashlar.add(box(1.7, 1.5, 1.1), M4(at(o, 0, 7.3), 0, 0.35, 0)); colRect(o, 0, 7.3, 0.9, 0.6); K.marble.add(box(1.9, 0.12, 1.3), M4(at(o, 0, 7.3), 0, 1.16, 0));
  for (const s of [-1, 1]) { S.cyp.push([...L2W(o, s * (o.hw - 2.2), -o.hd + 2.2), 11 + R() * 3]); stele(K, at(o, s * 3.4, 7.2), R, 'anthemion'); }
  poi('shrine', o, 0, 8.6, Math.PI, { note: 'offerings at the lion tomb' }); poi('gather', o, 0, o.hd + 2.5, Math.PI, { r: 4, note: 'mourners at the lion tomb' });
}
function templeTomb(K, o, R, v = 0) {  // on a moulded podium with a stair to the road: distyle in antis, or prostyle tetrastyle with a painted pediment
  const c = { ...o, hw: 3.2, hd: 5.6 }, [lo, hi] = gRange(c), m = M4(frame(o, hi), 0, 0, -1.2), dep = hi - lo + 0.8;
  K.ashlar.add(rectSweep(5.6, 8.4, [{ o: 0.25, y: -dep }, { o: 0.25, y: 0.3, hard: true }, { o: 0.1, y: 0.42, hard: true }, { o: 0, y: 0.5, hard: true }, { o: 0, y: 1.95, hard: true }, { o: 0.12, y: 2.05, hard: true }, { o: 0.18, y: 2.15 }], { top: true }), m);
  for (let i = 0; i < 6; i++) { const top = 2.15 - (i + 1) * 0.36; K.grey.add(box(3.4, top + dep, 0.37), M4(m, 0, (top - dep) / 2, 4.38 + i * 0.36)); }
  K.marble.add(box(4.9, 3.6, 5.2), M4(m, 0, 3.95, -2.3));
  if (v % 2 === 0) for (const s of [-1, 1]) { K.marble.add(box(0.45, 3.6, 2.5), M4(m, s * 2.225, 3.95, 1.55)); ionic(K, M4(m, s * 0.85, 2.15, 2.5), 3.6); }
  else { for (const x of [-2.05, -0.68, 0.68, 2.05]) ionic(K, M4(m, x, 2.15, 3.2), 3.6); K.paint.add(pedZ(4.5, 0.52, 0.01), M4(m, 0, 6.6, 4.16), 0x4f6a86); K.paint.add(box(5.2, 0.14, 0.01), M4(m, 0, 5.97, 4.01), 0x7a3328); }
  K.doors.add(box(1.1, 2.3, 0.06), M4(m, 0, 3.3, 0.32));
  K.marble.add(box(5.2, 0.45, 8.0), M4(m, 0, 5.97, 0)); K.egg.add(box(5.26, 0.14, 8.06), M4(m, 0, 6.26, 0));
  K.marble.add(box(5.6, 0.2, 8.4), M4(m, 0, 6.43, 0));
  const ap = 0.75, a = Math.atan2(ap, 2.8), Ls = Math.hypot(2.8, ap) + 0.15;
  for (const s of [-1, 1]) K.roofs.add(box(Ls, 0.12, 8.6), m.clone().multiply(mat(s * 1.4, 6.53 + ap / 2 + 0.06, 0, 0, 0, -s * a)), 0xc27d53);
  for (const s of [-1, 1]) { K.marble.add(pedZ(5.5, ap, 0.3), M4(m, 0, 6.53, s * 4.0)); K.marble.add(anthemion(0.8, 0.1), M4(m, 0, 6.53 + ap - 0.1, s * 4.1)); for (const q of [-1, 1]) K.marble.add(box(0.22, 0.25, 0.22), M4(m, q * 2.7, 6.65, s * 4.1)); }
  colRect(o, 0, -0.1, 3.0, 5.6, 0.1);
  dryWall(K.ashlar, rectPts(o, 0.4), 0.9, 0.55, { gaps: frontGap(o, 0.4, 3.2), cap: K.marble, k: 1 });
  for (const s of [-1, 1]) { S.cyp.push([...L2W(o, s * (o.hw - 1.6), -o.hd + 1.4), 10 + R() * 3]); (R() < 0.5 ? vase(K, at(o, s * 4.0, 5.9), R, R() < 0.4) : stele(K, at(o, s * 4.0, 5.9), R)); }
  poi('shrine', o, 0, 6.0, Math.PI, { note: 'offerings at the temple-tomb' });
}
function tumulus(K, o, R, v = 0) {    // stone-heaped Carian tumulus; a walled dromos is cut into its front down to the tomb door
  const [lo, hi] = gRange({ ...o, hw: 8, hd: 8 }), g0 = lo - 0.25, H = 4.2 + (hi - lo), r = o.hw - 1.4, m = frame(o, g0);
  const zf = r * 0.62, wo = 2.3, ze = Math.sqrt(r * r - wo * wo), dome = (x, z) => H * Math.sqrt(Math.max(0, 1 - (x * x + z * z) / (r * r)));
  // the mound, with every vertex inside the dromos cut (|x| < wo, z > zf) pressed onto its faces, which the walls then hide
  const mound = new THREE.SphereGeometry(1, 44, 11, 0, TAU, 0, Math.PI / 2), p = mound.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * r, y = p.getY(i) * H, z = p.getZ(i) * r;
    if (Math.abs(x) < wo && z > zf) { if (z - zf < wo - Math.abs(x)) z = zf; else x = (x < 0 ? -1 : 1) * wo; y = Math.min(y, dome(x, z)); }
    const rho = Math.hypot(x, z), k = rho > 1e-4 ? Math.hypot(rho, H - y) / rho : 1; p.setXYZ(i, x, y, z); mound.attributes.uv.setXY(i, x * k / 2.5, z * k / 2.5);   // unrolled from the crown: the stones keep their size up the sides and do not pinch at the top
  }
  { const ix = mound.index.array, keep = []; for (let i = 0; i < ix.length; i += 3) { let cx = 0, cz = 0; for (let k = 0; k < 3; k++) { cx += p.getX(ix[i + k]) / 3; cz += p.getZ(ix[i + k]) / 3; } if (!(Math.abs(cx) < wo - 0.02 && cz > zf + 0.02)) keep.push(ix[i], ix[i + 1], ix[i + 2]); } mound.setIndex(keep); }   // nothing may span the cut
  mound.computeVertexNormals(); K.rubble.add(mound, m);
  const gd = gy(...L2W(o, 0, zf + 1.5)) - g0, hF = dome(0, zf);    // dromos floor and façade height in the mound frame
  // façade: ashlar retaining wall with antae, moulded cornice, door with a pedimented frame
  K.ashlar.add(box(2 * wo + 0.3, hF + 0.6, 0.9), M4(m, 0, (hF - 0.6) / 2 + 0.3, zf + 0.35));
  K.marble.add(box(2 * wo + 0.5, 0.22, 1.05), M4(m, 0, hF + 0.41, zf + 0.35));
  for (const s of [-1, 1]) K.marble.add(box(0.36, hF - gd + 0.2, 0.12), M4(m, s * (wo - 0.85), gd + (hF - gd + 0.2) / 2 - 0.1, zf + 0.84));
  K.doors.add(box(1.0, 1.95, 0.06), M4(m, 0, gd + 0.97, zf + 0.82)); for (const s of [-1, 1]) K.marble.add(box(0.14, 2.05, 0.1), M4(m, s * 0.57, gd + 1.02, zf + 0.84));
  K.marble.add(box(1.5, 0.22, 0.2), M4(m, 0, gd + 2.14, zf + 0.86)); K.marble.add(pedZ(1.5, 0.32, 0.16), M4(m, 0, gd + 2.25, zf + 0.86));
  // dromos walls, their tops following the mound they retain, ending in low piers past its foot
  const zEnd = ze + 1.3;
  for (const s of [-1, 1]) {
    const pts = [[zf, -0.4], [zEnd, -0.4]]; for (let z = zEnd; z > zf - 1e-3; z -= 0.7) pts.push([z, Math.max(dome(wo - 0.35, z) + 0.28, gd + 1.0)]);
    pts.push([zf, Math.max(dome(wo - 0.35, zf) + 0.28, gd + 1.0)]); K.ashlar.add(extrudeZ(pts, 0.7).rotateY(-Math.PI / 2), M4(m, s * (wo - 0.3), 0, 0));
    K.ashlar.add(box(0.95, gd + 1.45, 0.95), M4(m, s * (wo - 0.3), (gd + 1.45) / 2 - 0.3, zEnd + 0.1)); K.marble.add(box(1.05, 0.14, 1.05), M4(m, s * (wo - 0.3), gd + 1.22, zEnd + 0.1));
  }
  // kerb ring round the foot, open where the dromos runs out
  const dl = Math.asin((wo + 0.2) / (r + 0.25)), ring = [];
  for (let i = 0; i <= 26; i++) { const a = Math.PI / 2 + dl + i / 26 * (TAU - 2 * dl); ring.push(L2W(o, Math.cos(a) * (r + 0.25), Math.sin(a) * (r + 0.25))); }
  if (v % 2 === 0) { dryWall(K.ashlar, ring, 0.55, 0.5, { k: 1, seg: 3 }); stele(K, M4(m, 0, H - 0.15, 0), R, 'anthemion'); }
  else { dryWall(K.ashlar, ring, 0.85, 0.6, { k: 1, seg: 3, cap: K.marble }); K.grey.add(box(1.3, 0.7, 1.3), M4(m, 0, H + 0.05, 0)); K.marble.add(lathe([[0.001, 0], [0.42, 0], [0.5, 0.35], [0.4, 0.75], [0.18, 0.98], [0.001, 1.02]], 10), M4(m, 0, H + 0.4, 0)); }
  for (let i = 0; i < 3; i++) K.paint.add(lathe(SMALLPOT, 6), M4(m, (R() - 0.5) * 2.2, gd - 0.02, zf + 1.3 + R() * 1.4, 0, 1 + R()), pick(R, [0xe3d8c2, 0xb8734a, 0x8a5a3a]));
  // colliders: the disc in bands, leaving the dromos open to its door
  const band = (x0, x1, z0, z1) => { const [cx, cz] = L2W(o, (x0 + x1) / 2, (z0 + z1) / 2); col(aabb({ x: cx, z: cz, ry: o.ry, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2 })); };
  band(-0.8 * r, 0.8 * r, -r, -0.6 * r); band(-r, r, -0.6 * r, 0.3 * r); band(-0.95 * r, 0.95 * r, 0.3 * r, zf + 0.8);
  for (const s of [-1, 1]) band(s > 0 ? wo - 0.65 : -0.8 * r, s > 0 ? 0.8 * r : -(wo - 0.65), zf + 0.8, zEnd + 0.6);
  poi('shrine', o, 0, zf + 2.6, Math.PI, { note: 'offerings at the tumulus door' });
}
function lycianTomb(K, o, R, v = 0) {  // sarcophagus on a high hyposorion: ogival or gabled lid, frieze of mourners or riders
  const [lo, hi] = gRange(o), m = frame(o, hi), dep = hi - lo + 0.8;
  K.grey.add(box(4.2, 0.4 + dep, 3.2), M4(m, 0, (0.4 - dep) / 2, 0)); K.grey.add(box(3.8, 0.4, 2.8), M4(m, 0, 0.6, 0));
  K.ashlar.add(box(3.2, 2.0, 2.2), M4(m, 0, 1.8, 0)); K.doors.add(box(0.62, 0.95, 0.06), M4(m, 0, 1.3, 1.11));
  K.grey.add(box(3.5, 0.2, 2.5), M4(m, 0, 2.9, 0));
  K.marble.add(rectSweep(3.0, 1.9, [{ o: 0.06, y: 3.0 }, { o: 0.06, y: 3.1, hard: true }, { o: 0, y: 3.18, hard: true }, { o: 0, y: 4.5, hard: true }, { o: 0.1, y: 4.6, hard: true }, { o: 0.1, y: 4.7 }], { top: true }), m);
  const nf = [4, 3, 5][v % 3], bg = [0x5f7590, 0x8a4a3a, 0x4f6a5e][v % 3], sil = extrudeZ(SILH, 0.04);
  for (const z of [-1, 1]) {
    K.marble.add(box(2.5, 0.96, 0.04), M4(m, 0, 3.75, z * 0.965)); K.paint.add(box(2.34, 0.8, 0.01), M4(m, 0, 3.75, z * 0.99), bg);
    for (let i = 0; i < nf; i++) { const x = (i - (nf - 1) / 2) * 2.1 / nf, face = (v % 3 === 1 ? i < nf / 2 : z > 0) ? 0 : Math.PI; K.statue.add(sil, M4(m, x, 3.36 + (i % 2) * 0.03 * (v % 2), z * 1.015, face, 0.88 + 0.12 * ((i * 7 + v) % 3) / 2)); }
  }
  if (v % 2 === 0) {
    const pts = [[1.05, 0], [1.05, 0.2]]; for (let i = 1; i <= 6; i++) { const t = i / 6 * 1.24; pts.push([-(0.5 - 1.55 * Math.cos(t)), 0.2 + 1.55 * Math.sin(t) * 0.85]); }
    const lid = pts.concat(pts.slice().reverse().map(p => [-p[0], p[1]]));
    K.marble.add(extrudeZ(lid, 3.3), M4(m, 0, 4.7, 0, Math.PI / 2)); K.marble.add(box(3.4, 0.22, 0.34), M4(m, 0, 6.12, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.marble.add(box(0.22, 0.26, 0.3), M4(m, sx * 1.0, 5.1, sz * 1.1));
  } else {   // low gabled lid with palmette akroteria and a painted tympanum
    K.marble.add(pedZ(2.2, 0.62, 3.26).rotateY(Math.PI / 2), M4(m, 0, 4.7, 0));
    for (const s of [-1, 1]) { K.paint.add(pedZ(1.7, 0.42, 0.01), M4(m, s * 1.635, 4.78, 0, Math.PI / 2), bg); K.marble.add(anthemion(0.5, 0.08), M4(m, s * 1.6, 5.2, 0, Math.PI / 2)); for (const q of [-1, 1]) K.marble.add(box(0.2, 0.2, 0.2), M4(m, s * 1.55, 4.8, q * 1.05)); }
  }
  colRect(o, 0, 0, 2.1, 1.6, 0.1); poi('shrine', o, 0, 3.0, Math.PI, { note: 'offerings at the sarcophagus' });
}
function pillarTomb(K, o, R) {
  const [lo, hi] = gRange(o), m = frame(o, hi), dep = hi - lo + 0.8;
  K.grey.add(box(3.6, 0.4 + dep, 3.6), M4(m, 0, (0.4 - dep) / 2, 0)); K.grey.add(box(3.0, 0.4, 3.0), M4(m, 0, 0.6, 0));
  K.ashlar.add(taperBox(1.8, 4.6, 1.8, 0.92, 0.92), M4(m, 0, 3.1, 0));
  K.marble.add(box(2.2, 1.3, 2.2), M4(m, 0, 6.05, 0)); K.paint.add(box(2.22, 0.1, 2.22), M4(m, 0, 6.62, 0), 0x7a3328);
  K.statue.add(K.smallFigs[2], M4(m, 0, 5.43, 1.1));
  K.marble.add(box(2.7, 0.22, 2.7), M4(m, 0, 6.81, 0)); K.marble.add(box(2.4, 0.2, 2.4), M4(m, 0, 7.02, 0));
  K.statue.add(K.lionS, M4(m, 0, 7.12, 0, -Math.PI / 2));
  colRect(o, 0, 0, 1.9, 1.9, 0.1); poi('shrine', o, 0, 2.8, Math.PI, { note: 'offerings at the pillar tomb' });
}

// ---------- family plots along the road ----------
const MON = { stele: 0.45, fig: 0.45, naiskos: 1.0, vase: 0.36, loutro: 0.36, kion: 0.3, trapeza: 0.85 };
function plot(K, o, R, terrace, N) {
  const [lo, hi] = gRange(o, 3);
  let T = 0, m0 = frame(o, 0);
  if (terrace) {
    T = hi + 0.8 + R() * 0.6; const base = lo - 0.5, ft = 0.7, H = T - base;
    (R() < 0.45 ? K.socles : K.ashlar).add(box(2 * o.hw, H, ft), M4(m0, 0, (T + base) / 2, o.hd - ft / 2));
    K.marble.add(box(2 * o.hw + 0.1, 0.12, ft + 0.1), M4(m0, 0, T + 0.06, o.hd - ft / 2));
    for (const s of [-1, 1]) K.rubble.add(box(0.6, H + 0.05, 2 * o.hd - ft), M4(m0, s * (o.hw - 0.3), (T + 0.05 + base) / 2, -ft / 2));
    K.rubble.add(box(2 * o.hw - 1.2, H + 0.05, 0.6), M4(m0, 0, (T + 0.05 + base) / 2, -o.hd + 0.3));
    { const [cx, cz] = L2W(o, 0, -0.05); overlay(K, { ...o, x: cx, z: cz, hw: o.hw - 0.55, hd: o.hd - 0.6 }, () => pick(R, [0x949c76, 0x9ca07c]), { step: 20, inset: 0, flatY: T - 0.02 }); }   // up to the inner wall faces
    col(aabb(o, 0.05));
  } else {
    dryWall(R() < 0.5 ? K.ashlar : K.rubble, rectPts(o, 0.3), 0.7 + R() * 0.4, 0.5, { k: 0.9, R });
  }
  const place = (kind, lx, lz, dry = 0) => {
    const m = terrace ? M4(frame(o, T), lx, 0, lz, dry) : at(o, lx, lz, dry);
    if (kind === 'stele') stele(K, m, R); else if (kind === 'fig') stele(K, m, R, null, pick(R, K.smallFigs));
    else if (kind === 'naiskos') naiskos(K, m, R, K.pairs[N.naiskos++ % K.pairs.length]);
    else if (kind === 'vase' || kind === 'loutro') vase(K, m, R, kind === 'loutro');
    else if (kind === 'kion') kioniskos(K, m, R); else if (kind === 'trapeza') trapeza(K, m, R);
    else if (kind === 'sarc') sarcophagus(K, m, R, R() < 0.5 ? K.grey : K.socles);
    if (!terrace) colRect(o, lx, lz, kind === 'sarc' ? 1.35 : kind === 'naiskos' ? 1.0 : 0.5, kind === 'sarc' ? 0.65 : 0.5);
  };
  // front row facing the road
  const zf = o.hd - (terrace ? 1.5 : 1.2);
  let x = -o.hw + 0.9;
  const row = [];
  while (x < o.hw - 0.9) {
    const r = R();
    let kind = r < 0.3 ? 'stele' : r < 0.42 ? 'fig' : r < 0.54 ? 'vase' : r < 0.64 ? 'loutro' : r < 0.74 ? 'kion' : r < 0.82 ? 'trapeza' : 'naiskos';
    if (kind === 'naiskos' && (N.naiskos >= N.maxNaiskos || R() < 0.3)) kind = 'stele';
    if (kind === 'fig' && N.figs++ >= N.maxFigs) kind = 'stele';
    const hw = MON[kind]; if (x + 2 * hw > o.hw - 0.6) break;
    row.push([kind, x + hw]); x += 2 * hw + 0.6 + R() * 1.3;
  }
  const shift = row.length ? -((row[0][1] - MON[row[0][0]]) + (row[row.length - 1][1] + MON[row[row.length - 1][0]])) / 2 : 0;
  for (const [kind, lx] of row) place(kind, lx + shift, zf - (kind === 'naiskos' ? 0.3 : 0));
  if (o.hd > 3.4 && R() < 0.55) place('sarc', (R() - 0.5) * Math.max(0, o.hw - 2), zf - 2.6);
  else if (o.hd > 3.4 && R() < 0.5) place('stele', (R() - 0.5) * (o.hw - 1), zf - 2.4);
  if (R() < 0.55) S.cyp.push([...L2W(o, (R() < 0.5 ? -1 : 1) * (o.hw + 1.4), -o.hd + 1 + R() * 2), 8 + R() * 4]);
  if (row.some(r => r[0] === 'naiskos' || r[0] === 'fig') || R() < 0.3) poi('shrine', o, row.length ? row[0][1] + shift : 0, o.hd + 1.3, Math.PI, { note: 'mourners at a family plot' });
}

// ---------- farmsteads ----------
function farmhouse(K, o, R, kit) {   // courtyard house: rooms on the north (and west), a tower at a front corner, gate south; mirrored or L-plan per farm
  const W = 2 * o.hw, D = 2 * o.hd, [lo, hi] = gRange(o), F = hi + 0.05, m = frame(o, F), dep = F - lo + 0.6;
  const pc = pick(R, [0xd9c7a3, 0xdcc39a, 0xe6d3b0, 0xcfb892]), rc = pick(R, [0xc8804f, 0xb8714a, 0xa8654a, 0xbf7d55]);
  const sx = R() < 0.5 ? 1 : -1, lp = R() < 0.4, X = v => sx * v, gx = X(-1), hw = o.hw, hd = o.hd;
  const at2 = (x, y, z, ry = 0) => M4(m, X(x), y, z, sx * ry), soffit = (w, d, x, y, z) => K.woodDark.add(box(w + 0.96, 0.04, d + 0.96), at2(x, y + 0.02, z));
  K.socles.add(box(W + 0.3, dep + 0.35, 0.9), M4(m, 0, (0.35 - dep) / 2, -(hd - 0.3)));
  for (const s of [-1, 1]) { K.socles.add(box(0.9, dep + 0.35, D - 0.3), M4(m, s * (hw - 0.3), (0.35 - dep) / 2, 0)); const a = s < 0 ? -hw - 0.15 : gx + 1.35, b = s < 0 ? gx - 1.35 : hw + 0.15; K.socles.add(box(b - a, dep + 0.35, 0.9), M4(m, (a + b) / 2, (0.35 - dep) / 2, hd - 0.3)); }
  // the gate: a sill in the socle, then a stair down to the ground in front, as many 0.35 m treads as the drop needs
  const gyL = (lx, lz) => gy(...L2W(o, lx, lz)), T0 = F + 0.08, tr = 0.35, z0 = hd + 0.3;
  let nS = 0, rS = 0.28; for (; nS < 24; nS++) { const gd = gyL(gx, z0 + nS * tr + 0.2); rS = (T0 - gd) / (nS + 1); if (rS <= 0.28) break; }
  rS = Math.max(0, rS); const zS = z0 + nS * tr; let gMin = Infinity; for (let k = 0; k <= nS + 1; k++) for (const dx of [-1.6, 0, 1.6]) gMin = Math.min(gMin, gyL(gx + dx, z0 + k * tr - 0.3));
  const bot = Math.min(gMin, lo) - F - 0.4;
  K.socles.add(box(2.7, 0.08 - bot, 1.05), M4(m, gx, (0.08 + bot) / 2, hd - 0.225));
  if (nS > 0) { const sp = [[hd + 0.1, bot], [hd + 0.1, 0.08], [z0, 0.08]]; for (let k = 1; k <= nS; k++) sp.push([z0 + (k - 1) * tr, 0.08 - k * rS], [z0 + k * tr, 0.08 - k * rS]); sp.push([zS, bot]); K.socles.add(extrudeZ(sp, 3.2).rotateY(-Math.PI / 2), M4(m, gx, 0, 0)); }
  overlay(K, { ...o, hw: hw - 0.5, hd: hd - 0.5 }, () => 0xa8a08a, { step: 40, inset: 0, flatY: F + 0.04 });
  // north range, and a west range or (L-plan) a walled yard with a lean-to
  K.walls.add(box(W, 3.4, 5.5), M4(m, 0, 1.7, -hd + 2.75), pc); K.roofs.add(kit.hipRoof(W, 5.5, 0.5, 0.4), M4(m, 0, 3.4, -hd + 2.75), rc); soffit(W, 5.5, 0, 3.4, -hd + 2.75);
  if (!lp) { K.walls.add(box(4.5, 3.0, D - 5.5), at2(-hw + 2.25, 1.5, 2.75), pc); K.roofs.add(kit.hipRoof(4.5, D - 5.5, 0.5, 0.4), at2(-hw + 2.25, 3.0, 2.75), rc); soffit(4.5, D - 5.5, -hw + 2.25, 3.0, 2.75); K.doors.add(box(0.12, 2.0, 1.0), at2(-hw + 4.52, 1.0, 3)); }
  else {
    K.walls.add(box(0.6, 2.4, D - 5.5), at2(-hw + 0.3, 1.2, 2.75), pc); K.roofs.add(box(0.9, 0.12, D - 5.5), at2(-hw + 0.3, 2.46, 2.75), rc);
    for (const z of [-2.2, 1.4, 5.0]) K.woodDark.add(cyl(0.08, 0.07, 2.0, 6, true), at2(-hw + 3.3, 1.0, z));
    K.woodDark.add(box(0.14, 0.14, 7.6), at2(-hw + 3.3, 2.0, 1.4)); K.roofs.add(box(3.6, 0.1, 8.2), m.clone().multiply(mat(X(-hw + 2.0), 2.28, 1.4, 0, 0, -sx * Math.atan2(0.45, 3.3))), rc);
  }
  for (const x of [-5.5, 0.5, 6]) K.doors.add(box(1.0, 2.0, 0.12), at2(x, 1.0, -hd + 5.52));
  for (const x of [-6, 4]) K.doors.add(box(0.5, 0.4, 0.12), at2(x, 2.6, -hd - 0.02));
  // tower
  const tx0 = hw - 2.6, tz0 = hd - 2.6;
  K.ashlar.add(box(5.3, 3.2, 5.3), at2(tx0, 1.6, tz0)); K.walls.add(box(5.2, 5.8, 5.2), at2(tx0, 6.1, tz0), pc); K.roofs.add(kit.hipRoof(5.2, 5.2, 0.5, 0.5), at2(tx0, 9.0, tz0), rc); soffit(5.2, 5.2, tx0, 9.0, tz0);
  for (const y of [4.6, 7.3]) { K.doors.add(box(0.3, 0.7, 0.12), at2(tx0, y, hd + 0.02)); K.doors.add(box(0.12, 0.7, 0.3), at2(hw + 0.02, y, tz0)); }
  K.doors.add(box(0.12, 1.9, 0.9), at2(hw - 5.27, 0.95, tz0));
  // courtyard walls with a coping of tiles, gate in the south wall
  const ew = D - 5.5 - 5.2;
  K.walls.add(box(0.6, 2.4, ew), at2(hw - 0.3, 1.2, -hd + 5.5 + ew / 2), pc); K.roofs.add(box(0.9, 0.12, ew), at2(hw - 0.3, 2.46, -hd + 5.5 + ew / 2), rc);
  const sw0 = lp ? -hw + 0.6 : -hw + 4.5, sw1 = hw - 5.2;
  for (const [a, b] of [[sw0, -2.5], [0.5, sw1]]) { K.walls.add(box(b - a, 2.4, 0.6), at2((a + b) / 2, 1.2, hd - 0.3), pc); K.roofs.add(box(b - a, 0.12, 0.9), at2((a + b) / 2, 2.46, hd - 0.3), rc); }
  for (const s of [-1, 1]) K.ashlar.add(box(0.5, 2.7, 0.8), M4(m, gx + s * 1.6, 1.35, hd - 0.3));
  K.woodDark.add(box(3.7, 0.3, 0.9), M4(m, gx, 2.85, hd - 0.3)); K.roofs.add(box(4.2, 0.12, 1.6), M4(m, gx, 3.06, hd - 0.3), rc);
  for (const x of [-2.3, 0.3]) K.wood.add(box(1.4, 2.2, 0.08), at2(x, 1.15, hd - 1.32, Math.PI / 2));   // both leaves swung in against the wall
  // courtyard: pergola, pithoi, cart, trough, woodpile, altar, quern, loom — slots shuffled per farm
  const pz = -hd + 7.4, swap = R() < 0.5, cart = pick(R, lp ? [[3.5, 2.2, 0.4], [-5.5, 5.5, -0.3]] : [[3.5, 2.2, 0.4], [4.2, 0.2, Math.PI - 0.3]]);
  for (const x of [-3.5, 0, 3.5]) K.woodDark.add(cyl(0.09, 0.08, 2.6, 6, true), at2(x, 1.3, pz));
  K.woodDark.add(box(7.6, 0.14, 0.14), at2(0, 2.6, pz)); for (let x = -3.5; x <= 3.5; x += 0.9) K.wood.add(box(0.08, 0.08, 2.0), at2(x, 2.72, pz - 0.95));
  const card = new THREE.PlaneGeometry(1.4, 1.1);
  for (let i = 0; i < 30; i++) K.foliage.add(card, m.clone().multiply(mat(X(-3.6 + R() * 7.2), 2.85 + R() * 0.25, pz - 2 + R() * 2.2, -Math.PI / 2 + (R() - 0.5) * 0.7, R() * TAU, 0)), 0xb8d27a);
  const pith = lp ? i => [-hw + 1.5 + (i % 2) * 1.2, 1.2 + i * 1.4] : i => [-hw + 5.6 + (i % 2) * 1.3, 4.4 + i * 1.1];
  for (let i = 0; i < 4; i++) { const [x, z] = pith(i); K.paint.add(lathe(PITHOS, 10), at2(x, -0.25, z, R() * TAU), pick(R, [0xb8734a, 0xa86a45, 0xc08050])); }
  const ct = at2(cart[0], 0, cart[1], cart[2]);
  K.wood.add(box(1.4, 0.5, 2.4), M4(ct, 0, 0.85, 0)); K.woodDark.add(rod([0, 0.7, 1.2], [0, 0.15, 3.2], 0.06, 5), ct);
  for (const s of [-1, 1]) K.woodDark.add(cyl(0.45, 0.45, 0.12, 12).rotateZ(Math.PI / 2), M4(ct, s * 0.8, 0.45, 0));
  K.ashlar.add(box(1.6, 0.5, 0.6), at2(-3, 0.25, 1.2)); K.paint.add(box(1.4, 0.02, 0.4), at2(-3, 0.46, 1.2), 0x4d5a5a);
  for (let i = 0; i < 9; i++) K.woodDark.add(cyl(0.08, 0.08, 1.1, 5).rotateX(Math.PI / 2), at2(hw - 0.72 - (i % 3) * 0.17, 0.1 + Math.floor(i / 3) * 0.16, -1.5 + (i % 3) * 0.02));   // woodpile against the east wall
  K.socles.add(rectSweep(0.8, 0.8, [{ o: 0.1, y: 0 }, { o: 0.1, y: 0.15, hard: true }, { o: 0, y: 0.22, hard: true }, { o: 0, y: 0.8, hard: true }, { o: 0.08, y: 0.9 }], { top: true }), at2(-3.5, 0, -1.5)); K.paint.add(box(0.5, 0.03, 0.5), at2(-3.5, 0.91, -1.5), 0x3a332c);
  const aw = lp ? -hw + 0.95 : -hw + 4.85;
  for (let i = 0; i < 5; i++) K.paint.add(lathe(AMPH, 8), m.clone().multiply(mat(X(aw), 0.02, -1.8 + i * 0.45, 0, 0, sx * 0.22)), pick(R, [0xb07048, 0xc08058, 0xa86848]));
  for (let i = 0; i < 3; i++) K.paint.add(cyl(0.26, 0.32, 0.34, 8), at2(hw - 1.0, 0.17, 0.7 + i * 0.7), pick(R, [0x9a7a4a, 0x8a6c40]));
  const lx0 = swap ? -2.6 : 2.4, qx = swap ? 2.2 : -2.2;
  { const lm = at2(lx0, 0, -hd + 6.2); for (const x of [-0.8, 0.8]) K.woodDark.add(cyl(0.05, 0.05, 2.1, 5, true), M4(lm, x, 1.05, 0)); K.woodDark.add(cyl(0.04, 0.04, 1.9, 5, true).rotateZ(Math.PI / 2), M4(lm, 0, 1.95, 0));   // warp-weighted loom
    const wc = pick(R, [0xc8b89a, 0x9a4a3a, 0xb0a080]); K.paint.add(box(1.5, 0.34, 0.03), M4(lm, 0, 1.72, 0.03), wc); K.woodDark.add(cyl(0.025, 0.025, 1.6, 4, true).rotateZ(Math.PI / 2), M4(lm, 0, 1.2, 0.05));
    for (let i = 0; i < 15; i++) K.paint.add(box(0.012, 0.95, 0.012), M4(lm, -0.7 + i * 0.1, 1.08, 0.03 + (i % 2) * 0.03), 0xd8ccb0);
    for (let i = 0; i < 8; i++) K.paint.add(cyl(0.035, 0.05, 0.1, 5), M4(lm, -0.7 + i * 0.2, 0.56, 0.05), 0xa86a45); }
  K.socles.add(box(0.9, 0.2, 0.5), at2(qx, 0.1, -hd + 6.3)); K.socles.add(box(0.35, 0.1, 0.25), at2(qx, 0.25, -hd + 6.3));
  // colliders, floor, POIs
  const cr = (x, z, a, b, mm) => colRect(o, X(x), z, a, b, mm);
  colRect(o, 0, -hd + 2.75, hw, 2.75, 0.3); if (!lp) cr(-hw + 2.25, 2.75, 2.25, (D - 5.5) / 2, 0.3); else { cr(-hw + 0.3, 2.75, 0.3, (D - 5.5) / 2, 0.2); cr(-hw + 2.1, 3.3, 1.3, 2.9); }
  cr(tx0, tz0, 2.65, 2.65, 0.3); cr(hw - 0.3, -hd + 5.5 + ew / 2, 0.3, ew / 2, 0.2);
  for (const [a, b] of [[sw0, -2.3], [0.3, sw1]]) cr((a + b) / 2, hd - 0.3, (b - a) / 2, 0.3, 0.2);
  cr(cart[0], cart[1], 1.3, 1.3); if (!lp) cr(-hw + 6.2, 6.05, 1.3, 2.2); cr(-3.5, -1.5, 0.5, 0.5); cr(hw - 0.95, 0.2, 0.45, 2.3);
  const inner = { ...o, hw: hw - 0.6, hd: hd - 0.6 };
  const ext = Math.hypot(hw + 2, zS + 2);
  S.world.extraGround.push((x, z) => { if (Math.abs(x - o.x) > ext || Math.abs(z - o.z) > ext) return -Infinity; const [lx, lz] = W2L(o, x, z); if (Math.abs(lx) < inner.hw && Math.abs(lz) < inner.hd) return F + 0.04; if (Math.abs(lx - gx) < 1.35 && lz >= inner.hd && lz < z0) return T0; if (Math.abs(lx - gx) < 1.6 && lz >= z0 && lz < zS + 1.5) return T0 - ((lz - z0) / tr + 0.5) * rS; return -Infinity; });
  const [nx, nz] = [Math.sin(o.ry), Math.cos(o.ry)];
  for (const x of [-5.5, 0.5, 6]) { const [px, pzw] = L2W(o, X(x), -hd + 6.4); S.layout.addPoi({ type: 'door', x: px, z: pzw, nx, nz, y: F + 0.04, owner: OWN, note: 'farmhouse' }); }
  poi('gather', o, 0, -1, 0, { r: 2.5, y: F + 0.04, note: 'farm courtyard' }); poi('altar', o, X(-3.5), -0.6, Math.PI, { y: F + 0.04, note: 'courtyard altar of Zeus Herkeios' });
  poi('work', o, X(qx), -hd + 7.0, Math.PI, { y: F + 0.04, note: 'grinding grain at the quern' });
  S.layout.addArea({ name: 'farm courtyard', ...aabb({ ...o, hw: 3, hd: 3 }), y: F + 0.04, owner: OWN });
  return { F, gate: L2W(o, gx, hd + 1.5) };
}
function threshingFloor(K, c, R) {
  const r = c.hw - 0.7, [lo, hi] = gRange(c), F = hi + 0.15, m = frame(c, F), dep = F - lo + 0.5;
  K.rubble.add(lathe([[r + 0.5, -dep], [r + 0.5, 0.0], [r + 0.2, 0.1]], 22), m);
  const pv = new THREE.CircleGeometry(r + 0.25, 22).rotateX(-Math.PI / 2); for (let i = 0, uv = pv.attributes.uv; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2 * r, uv.getY(i) * 2 * r);
  K.pave.add(pv, M4(m, 0, 0.09, 0));
  for (let i = 0; i < 30; i++) { const a = i / 30 * TAU; K.ashlar.add(box(0.22, 0.16 + R() * 0.06, 0.9 + R() * 0.2), m.clone().multiply(mat(Math.cos(a) * (r + 0.3), 0.14, Math.sin(a) * (r + 0.3), 0, -a + (R() - 0.5) * 0.1, 0))); }
  K.woodDark.add(cyl(0.1, 0.08, 1.5, 6), M4(m, 0, 0.8, 0));
  K.paint.add(ellipsoid(2.0, 0.65, 1.5, 10, 5), M4(m, r * 0.45, 0.05, -r * 0.3, 0.5), 0x8a7440);
  K.paint.add(ellipsoid(1.1, 0.35, 0.9, 8, 4), M4(m, -r * 0.4, 0.05, r * 0.4, 1.2), 0x806a3e);
  K.wood.add(box(1.7, 0.09, 0.85), M4(m, -1.6, 0.16, 1.4, 0.9)); K.wood.add(rod([2.3, 0.1, 1.8], [2.9, 2.0, 1.5], 0.03, 4));
  const yoke = M4(m, -2.2, 0.1, -1.6, 2.2);
  for (const s of [-1, 1]) animal(K, M4(yoke, s * 0.75, 0, 0), R, 'ox');
  K.woodDark.add(box(2.1, 0.12, 0.12), M4(yoke, 0, 1.28, 1.0));
  colRect(c, 0, 0, 0.3, 0.3); { const [x, z] = L2W(c, -2.2, -1.6); col({ minX: x - 1.4, maxX: x + 1.4, minZ: z - 1.4, maxZ: z + 1.4 }); }
  S.world.extraGround.push((x, z) => (Math.abs(x - c.x) < r + 0.6 && Math.abs(z - c.z) < r + 0.6 && Math.hypot(x - c.x, z - c.z) < r + 0.5) ? F + 0.09 : -Infinity);
  poi('work', c, 1.8, 1.5, Math.PI, { y: F + 0.09, note: 'winnowing on the threshing floor' });
  S.layout.addArea({ name: 'threshing floor', ...aabb({ ...c, hw: r * 0.6, hd: r * 0.6 }), y: F + 0.09, owner: OWN });
}
function pen(K, o, R) {
  dryWall(K.rubble, rectPts(o), 1.1, 0.7, { gaps: frontGap(o, 0, 2.2, o.hw * 0.5), R });
  const gx0 = o.hw * 0.5, ga = 1.15, gh = at(o, gx0 + 1.1, o.hd + 0.3);   // wattle gate hung on a post at the right side of the opening, swung out
  K.woodDark.add(cyl(0.07, 0.06, 1.35, 5, true), M4(gh, 0, 0.6, 0)); K.wood.add(box(2.05, 0.95, 0.07), M4(gh, -1.05 * Math.cos(ga), 0.55, 1.05 * Math.sin(ga), ga));
  const sh = at(o, -o.hw + 2.2, -o.hd + 1.7);
  for (const [x, z, h] of [[-1.6, -1.0, 2.0], [1.6, -1.0, 2.0], [-1.6, 1.0, 1.6], [1.6, 1.0, 1.6]]) K.woodDark.add(cyl(0.08, 0.07, h, 5, true), M4(sh, x, h / 2, z));
  K.roofs.add(box(3.8, 0.1, 2.6), sh.clone().multiply(mat(0, 1.9, 0, 0.2, 0, 0)), 0xb8714a);
  K.paint.add(box(3.0, 0.4, 1.6), M4(sh, 0, 0.1, -0.2), 0xa89058); K.rubble.add(box(3.6, 1.9, 0.5), M4(sh, 0, 0.8, -1.3));
  K.ashlar.add(box(1.6, 0.4, 0.5), M4(at(o, o.hw - 1.4, -o.hd + 1.2), 0, 0.2, 0)); K.paint.add(box(1.4, 0.02, 0.3), M4(at(o, o.hw - 1.4, -o.hd + 1.2), 0, 0.39, 0), 0x4d5a5a);
  const pts = [], n = 5 + Math.floor(R() * 5);
  for (let k = 0; k < 60 && pts.length < n; k++) { const lx = (R() * 2 - 1) * (o.hw - 1.2), lz = (R() * 2 - 1) * (o.hd - 1.2); if (lx < -o.hw + 4.2 && lz < -o.hd + 3.4) continue; if (pts.some(p => Math.hypot(p[0] - lx, p[1] - lz) < 1.1)) continue; pts.push([lx, lz]); }
  for (const [lx, lz] of pts) animal(K, at(o, lx, lz, R() * TAU), R, R() < 0.55 ? 'sheep' : 'goat');
  colRect(o, -o.hw + 2.2, -o.hd + 1.7, 1.8, 1.2);
  poi('work', o, gx0, o.hd + 1.6, Math.PI, { note: 'tending the flock' });
}
function hives(K, o, R) {
  const [lo, hi] = gRange(o), m = frame(o, hi), dep = hi - lo + 0.4;
  K.ashlar.add(box(3.4, 0.5 + dep, 0.95), M4(m, 0, (0.5 - dep) / 2, 0)); K.rubble.add(box(3.9, 1.6 + dep, 0.5), M4(m, 0, (1.6 - dep) / 2, -0.75));
  for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
    const x = -1.2 + i * 0.8 + (row ? 0.4 : 0) * 0, y = 0.5 + 0.18 + row * 0.35;
    K.terra.add(cyl(0.18, 0.17, 0.85, 8).rotateX(Math.PI / 2), M4(m, x, y, 0.02), pick(R, [0xb87a52, 0xa86d48, 0xc28a5e]));
    K.paint.add(cyl(0.15, 0.15, 0.03, 8).rotateX(Math.PI / 2), M4(m, x, y, 0.45), 0x7b5a40); K.doors.add(box(0.07, 0.04, 0.02), M4(m, x, y - 0.08, 0.47));
  }
  K.grey.add(box(3.6, 0.08, 1.0), M4(m, 0, 1.25, -0.05));
  colRect(o, 0, -0.2, 2.0, 0.8); poi('work', o, 0.4, 1.6, Math.PI, { note: 'taking honey from the hives' });
}
function well(K, o, R) {
  const m = at(o, 0, 0);
  K.ashlar.add(lathe([[0.55, -0.4], [0.55, 0.75], [0.72, 0.8], [0.72, -0.4]].reverse(), 12), m); K.doors.add(new THREE.CircleGeometry(0.56, 12).rotateX(-Math.PI / 2), M4(m, 0, 0.35, 0));
  K.woodDark.add(cyl(0.12, 0.09, 3.1, 6), M4(m, 2.0, 1.4, 0));
  K.woodDark.add(rod([-0.1, 4.05, 0], [3.3, 2.0, 0], 0.07, 5, 0.05), m); K.woodDark.add(rod([-0.05, 4.0, 0], [0, 1.45, 0], 0.012, 3), m);
  K.rubble.add(box(0.5, 0.45, 0.45), M4(m, 3.3, 1.75, 0)); K.terra.add(lathe(AMPH, 8), M4(m, 0, 1.0, 0, 0, 0.5), 0x9c6a48);
  const tr = at(o, 0, 1.6);
  K.ashlar.add(box(1.8, 0.8, 0.6), M4(tr, 0, 0.15, 0)); K.paint.add(box(1.6, 0.02, 0.4), M4(tr, 0, 0.56, 0), 0x4d5a5a);
  K.terra.add(lathe(AMPH, 8), M4(at(o, 1.2, 1.0), 0, 0, 0, 0, 0.9), 0xb8734a);
  colRect(o, 0, 0, 0.8, 0.8); colRect(o, 2.0, 0, 0.2, 0.2); colRect(o, 0, 1.6, 0.9, 0.35);
  poi('well', o, -1.1, 0, Math.PI / 2, { r: 2, note: 'drawing water' });
}
function fieldShrine(K, o, R) {
  const [lo, hi] = gRange(o), m = frame(o, hi), dep = hi - lo + 0.4;
  K.rubble.add(box(1.0, 0.95 + dep, 0.75), M4(m, 0, (0.95 - dep) / 2, -0.2)); K.marble.add(box(1.1, 0.1, 0.85), M4(m, 0, 1.0, -0.2));
  K.paint.add(box(0.6, 0.03, 0.45), M4(m, 0, 1.06, -0.2), 0x33302c);
  for (let i = 0; i < 3; i++) K.terra.add(lathe(SMALLPOT, 6), M4(m, -0.35 + i * 0.35, 1.05, -0.2 + (R() - 0.5) * 0.3, 0, 0.8), pick(R, [0xb8734a, 0xe3d8c2, 0x8a5a3a]));
  const h = M4(m, 1.05, 0, -0.9);
  K.grey.add(box(0.55, 0.3 + dep, 0.5), M4(h, 0, (0.3 - dep) / 2, 0)); K.marble.add(taperBox(0.26, 1.2, 0.22, 1.15, 1.1), M4(h, 0, 0.9, 0));
  for (const s of [-1, 1]) K.marble.add(box(0.1, 0.1, 0.14), M4(h, s * 0.2, 1.42, 0));
  K.statue.add(ellipsoid(0.1, 0.13, 0.11, 8, 6), M4(h, 0, 1.64, 0.01)); K.statue.add(ellipsoid(0.07, 0.08, 0.05, 6, 4), M4(h, 0, 1.52, 0.08));
  const pk = M4(m, -1.1, 0, -0.8); K.woodDark.add(cyl(0.04, 0.035, 1.5, 5, true), M4(pk, 0, 0.75, 0)); K.paint.add(box(0.34, 0.24, 0.03), M4(pk, 0, 1.4, 0.05), pick(R, [0x9c4a32, 0x5a6e8a, 0xc49a5a]));
  S.cyp.push([...L2W(o, -1.3, -2.4), 7 + R() * 3]);
  colRect(o, 0.2, -0.5, 1.5, 0.9); poi('altar', o, 0, 1.0, Math.PI, { note: 'field shrine of the Nymphs' });
}
function oilPress(K, o, R) {    // lever-and-weight press under a tiled lean-to
  const [lo, hi] = gRange(o), m = frame(o, hi), dep = hi - lo + 0.3;
  K.socles.add(box(2 * o.hw, 0.2 + dep, 2 * o.hd), M4(m, 0, (0.2 - dep) / 2, 0));
  for (const [x, z, hh] of [[-3.8, -2.4, 3.0], [3.8, -2.4, 3.0], [-3.8, 2.4, 2.4], [3.8, 2.4, 2.4]]) K.woodDark.add(cyl(0.1, 0.09, hh, 6, true), M4(m, x, 0.2 + hh / 2, z));
  for (const z of [-2.4, 2.4]) K.woodDark.add(box(8.0, 0.16, 0.16), M4(m, 0, z < 0 ? 3.2 : 2.6, z));
  K.roofs.add(box(8.8, 0.12, 5.8), m.clone().multiply(mat(0, 3.0, 0, Math.atan2(0.6, 4.8), 0, 0)), 0xb8714a);
  K.ashlar.add(box(1.0, 2.2, 1.0), M4(m, -3.1, 1.3, -1.0));
  K.socles.add(cyl(0.8, 0.75, 0.45, 14), M4(m, 0.2, 0.42, -1.0)); K.socles.add(box(0.2, 0.1, 0.6), M4(m, 0.2, 0.5, -0.1));
  K.terra.add(lathe(PITHOS, 10), M4(m, 0.2, -0.2, 0.45, 0, 0.45), 0xa86a45);
  for (let i = 0; i < 5; i++) K.paint.add(cyl(0.56, 0.54, 0.09, 10), M4(m, 0.2, 0.7 + i * 0.1, -1.0), i % 2 ? 0x5a4630 : 0x6b5238);
  K.woodDark.add(box(7.0, 0.3, 0.3), m.clone().multiply(mat(0.3, 1.45, -1.0, 0, 0, -Math.atan2(0.5, 6.6))));
  for (const dz of [-0.25, 0.25]) { K.woodDark.add(rod([3.5, 1.2, -1.0 + dz], [3.5, 0.55, -1.0 + dz], 0.015, 3), m); K.ashlar.add(box(0.45, 0.45, 0.4), M4(m, 3.5, 0.45, -1.0 + dz * 2)); }
  K.socles.add(lathe([[0.001, 0.2], [0.5, 0.2], [0.55, 0.7], [0.72, 0.65], [0.72, 0]].reverse(), 12), M4(m, 2.3, 0.2, 1.2)); K.ashlar.add(ellipsoid(0.32, 0.25, 0.32, 8, 5), M4(m, 2.3, 0.6, 1.2));
  for (let i = 0; i < 3; i++) K.terra.add(lathe(PITHOS, 10), M4(m, -2.4 + i * 1.1, 0.0, 1.5, R() * TAU, 0.75), pick(R, [0xb8734a, 0xa86a45]));
  for (let i = 0; i < 4; i++) K.terra.add(lathe(AMPH, 8), m.clone().multiply(mat(-3.2 + i * 0.35, 0.35, 0.3, 0.25, 0, 0.1)), 0xb07048);
  colRect(o, -3.1, -1.0, 0.6, 0.6); colRect(o, 0.2, -1.0, 0.9, 0.9); colRect(o, -1.3, 1.5, 1.8, 0.7); colRect(o, 2.3, 1.2, 0.8, 0.8); colRect(o, 3.5, -1.0, 0.35, 0.6);
  S.world.extraGround.push((x, z) => { if (Math.abs(x - o.x) > o.hw + o.hd || Math.abs(z - o.z) > o.hw + o.hd) return -Infinity; const [lx, lz] = W2L(o, x, z); return Math.abs(lx) < o.hw && Math.abs(lz) < o.hd ? hi + 0.2 : -Infinity; });
  poi('work', o, 1.4, 0.3, Math.PI, { y: hi + 0.2, note: 'pressing olives' });
}

// ---------- ground overlays: fields, roads and tracks (one mesh, pulled over the terrain with polygonOffset) ----------
const NF = makeNoise2D(77);
const qAt = (Q, a, b) => { const x0 = lerp(Q[0][0], Q[1][0], a), z0 = lerp(Q[0][1], Q[1][1], a), x1 = lerp(Q[3][0], Q[2][0], a), z1 = lerp(Q[3][1], Q[2][1], a); return [lerp(x0, x1, b), lerp(z0, z1, b)]; };
const qBox = (Q, m = 0) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const p of Q) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); } return { minX: a - m, maxX: b + m, minZ: c - m, maxZ: d + m }; };
const dist2 = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const inQuad = (Q, x, z) => { let pos = 0, neg = 0; for (let k = 0; k < 4; k++) { const a = Q[k], b = Q[(k + 1) % 4], c = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c > 0) pos++; else if (c < 0) neg++; } return !(pos && neg); };
function insetQuad(Q, ins) {   // move side k (Q[k]→Q[k+1]) inward by ins[k], re-intersect the corners
  const cx = (Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4, cz = (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4, ln = [];
  for (let k = 0; k < 4; k++) {
    const a = Q[k], b = Q[(k + 1) % 4], l = dist2(a, b) || 1; let nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l;
    if ((cx - a[0]) * nx + (cz - a[1]) * nz < 0) { nx = -nx; nz = -nz; }
    ln.push([a[0] + nx * ins[k], a[1] + nz * ins[k], (b[0] - a[0]) / l, (b[1] - a[1]) / l]);
  }
  return [0, 1, 2, 3].map(k => { const [px, pz, dx, dz] = ln[(k + 3) % 4], [qx, qz, ex, ez] = ln[k], den = dx * ez - dz * ex; if (Math.abs(den) < 1e-6) return [qx, qz]; const t = ((qx - px) * ez - (qz - pz) * ex) / den; return [px + dx * t, pz + dz * t]; });
}
function quadRect(Q) {   // the largest centred rect inside a convex quad, squared to its b edges, its a edges or between them
  const x = (Q[0][0] + Q[1][0] + Q[2][0] + Q[3][0]) / 4, z = (Q[0][1] + Q[1][1] + Q[2][1] + Q[3][1]) / 4, rb = Math.atan2(Q[3][0] - Q[0][0] + Q[2][0] - Q[1][0], Q[3][1] - Q[0][1] + Q[2][1] - Q[1][1]);
  let ru = Math.atan2(-(Q[1][1] - Q[0][1] + Q[2][1] - Q[3][1]), Q[1][0] - Q[0][0] + Q[2][0] - Q[3][0]); while (ru - rb > Math.PI / 2) ru -= Math.PI; while (rb - ru > Math.PI / 2) ru += Math.PI;
  let best = { x, z, ry: rb, hw: 0.1, hd: 0.1 };
  for (const ry of [rb, ru, (rb + ru) / 2]) {
    const o = { x, z, ry }, Lq = Q.map(p => W2L(o, p[0], p[1])), C = [];   // each side: |nx|·hw + |nz|·hd ≤ d
    for (let k = 0; k < 4; k++) { const a = Lq[k], b = Lq[(k + 1) % 4], l = dist2(a, b) || 1; let nx = (b[1] - a[1]) / l, nz = -(b[0] - a[0]) / l, d = nx * a[0] + nz * a[1]; if (d < 0) { nx = -nx; nz = -nz; d = -d; } C.push([Math.abs(nx), Math.abs(nz), d]); }
    const hdMax = Math.min(...C.map(([, b, d]) => b > 1e-6 ? d / b : Infinity));
    for (let i = 1; i <= 40; i++) { const hd = hdMax * i / 40, hw = Math.min(...C.map(([a, b, d]) => a > 1e-6 ? (d - b * hd) / a : Infinity)); if (hw > 0 && hw * hd > best.hw * best.hd) best = { x, z, ry, hw, hd }; }
  }
  return { ...best, Q };
}
function finishOverlay(K, pos, colr, uv, idx) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  let up = 0; for (let i = 0; i < idx.length; i += 3) { const a = 3 * idx[i], b = 3 * idx[i + 1], c = 3 * idx[i + 2]; up += (pos[b + 2] - pos[a + 2]) * (pos[c] - pos[a]) - (pos[b] - pos[a]) * (pos[c + 2] - pos[a + 2]); }   // facing up as a whole, whatever its first corner does
  if (up < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.setIndex(idx); g.computeVertexNormals();
  K.fields.push(g);
}
function overlay(K, c, colorFn, { step = 2.5, stepX = step, rowW = 0, ridge = 0.16, inset = 0.8, flatY = null, tone = 1 } = {}) {
  const Q = c.Q, hw = c.hw - inset, hd = c.hd - inset;
  const W = Q ? (dist2(Q[0], Q[1]) + dist2(Q[3], Q[2])) / 2 : 2 * hw, D = Q ? (dist2(Q[0], Q[3]) + dist2(Q[1], Q[2])) / 2 : 2 * hd;
  const nx = Math.max(1, Math.ceil(W / stepX)), nz = rowW ? Math.max(2, 2 * Math.round(D / 2 / rowW)) : Math.max(1, Math.ceil(D / step));
  const pos = [], colr = [], uv = [], idx = [], C = new THREE.Color();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const [x, z] = Q ? qAt(Q, i / nx, j / nz) : L2W(c, -hw + W * i / nx, -hd + D * j / nz), [lx, lz] = Q ? W2L(c, x, z) : [-hw + W * i / nx, -hd + D * j / nz], rid = rowW && j % 2 === 1;
    pos.push(x, (flatY ?? gy(x, z) + 0.06) + (rid ? ridge : 0), z); uv.push(x, z);
    const cv = colorFn(lx, lz, rid); if (Array.isArray(cv)) C.setRGB(cv[0], cv[1], cv[2]); else C.set(cv); const n = tone * (1 + 0.16 * NF.fbm(x / 9, z / 9, 3) + 0.06 * NF.noise(x * 0.9, z * 0.9));
    colr.push(C.r * n, C.g * n, C.b * n);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + nx + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  finishOverlay(K, pos, colr, uv, idx);
}
// beaten earth along a polyline: grassy verges, dust, a pair of darker wheel ruts; fade(s, L) ∈ [0, 1] narrows it and greys it into the verge
const RC = { edge: [0.7, 0.86, 0.6], dust: [0.8, 0.9, 1.06], rut: [0.56, 0.62, 0.7], crown: [0.74, 0.86, 0.88] }, TOWN = 0xd8c2a2;   // multiplied into the warm dirt texture; TOWN: the city's M.roadEarth
// town(s) ∈ [0, 1] widens it to the city road's 7 m and takes on that road's colour, so the two meet without a seam
function dirtStrip(K, pts, { half = 2.25, verge = 1.5, lift = 0.07, step = 4, fade = () => 1, town = () => 0, O = [-1.4, -1, -0.62, -0.38, 0, 0.38, 0.62, 1, 1.4] } = {}) {
  const L = polyLen(pts), n = Math.max(2, Math.ceil(L / step)), E = new THREE.Color(...RC.edge), C = new THREE.Color(), TC = new THREE.Color(TOWN);
  const CS = O.map(o => new THREE.Color(...(Math.abs(o) > 1.01 ? RC.edge : Math.abs(o) > 0.8 ? RC.dust : Math.abs(Math.abs(o) - 0.45) < 0.08 ? RC.rut : RC.crown)));
  const pos = [], colr = [], uv = [], idx = [];
  for (let r = 0; r <= n; r++) {
    const s = L * r / n, p = polyAt(pts, s), a = polyAt(pts, Math.max(0, s - 2.5)), b = polyAt(pts, Math.min(L, s + 2.5)), tl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / tl, nz = (b.x - a.x) / tl, f = clamp(fade(s, L), 0, 1), w = town(s), hc = lerp(half * lerp(0.55, 1, f), 3.5, w), hv = verge * lerp(0.5, 1, f) * lerp(1, 0.04, w);
    O.forEach((o, k) => {
      const off = Math.abs(o) <= 1 ? o * hc : Math.sign(o) * (hc + (Math.abs(o) - 1) / 0.4 * hv), x = p.x + nx * off, z = p.z + nz * off;
      pos.push(x, (w > 0 ? Math.max(gy(x, z), terrainHeight(x, z)) : gy(x, z)) + lift + 0.03 * w, z); uv.push(x, z);
      C.copy(E).lerp(CS[k], f).lerp(TC, w); const q = 1 + 0.12 * NF.fbm(x / 7, z / 7, 3) + 0.05 * NF.noise(x * 1.3, z * 1.3); colr.push(C.r * q, C.g * q, C.b * q);
    });
  }
  const w = O.length; for (let r = 0; r < n; r++) for (let k = 0; k < w - 1; k++) { const a = r * w + k, b = a + w; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  finishOverlay(K, pos, colr, uv, idx);
}

// ---------- fields: ploughland, stubble, gardens, vineyards, olive orchards, pasture, fallow ----------
// contour lines across a cell (local z as a function of local x), for terrace walls and planting rows
function contourBands(c) {
  const lines = [], sl = slopeAt(c.x, c.z, 8);
  if (sl < 0.11 || c.hw < 9) return { lines, terraced: false };
  const dz = clamp(1.1 / sl, 5.5, 12);
  for (let z0 = -c.hd + dz; z0 < c.hd - dz * 0.5; z0 += dz) {
    const [x0, zz0] = L2W(c, 0, z0), h0 = gy(x0, zz0), pts = [];
    for (let lx = -c.hw + 0.6; lx <= c.hw - 0.6 + 1e-6; lx += Math.min(3, c.hw)) {
      let a = z0 - 5, b = z0 + 5; const f = lz => { const [x, z] = L2W(c, lx, lz); return gy(x, z) - h0; };
      const fa = f(a), fb = f(b); let lz = z0;
      if (fa * fb < 0) { for (let k = 0; k < 18; k++) { const mid = (a + b) / 2; if (f(mid) * fa > 0) a = mid; else b = mid; } lz = (a + b) / 2; }
      pts.push([lx, clamp(lz, z0 - 3, z0 + 3)]);
    }
    for (let it = 0; it < 2; it++) for (let i = 1; i < pts.length - 1; i++) pts[i][1] = (pts[i - 1][1] + 2 * pts[i][1] + pts[i + 1][1]) / 4;
    for (const q of pts) q[1] = clamp(q[1], -c.hd + 2, c.hd - 2);
    lines.push(pts);
  }
  return { lines, terraced: true };
}
const lineZ = (pts, lx) => { for (let i = 0; i < pts.length - 1; i++) if (lx <= pts[i + 1][0]) { const t = (lx - pts[i][0]) / (pts[i + 1][0] - pts[i][0]); return lerp(pts[i][1], pts[i + 1][1], clamp(t, 0, 1)); } return pts[pts.length - 1][1]; };
function stook(K, m, R) {   // four fat sheaves stood up leaning into one another, ears bunched on top
  const c = pick(R, [0xc8aa62, 0xbc9e58, 0xd0b46c]);
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; K.paint.add(cyl(0.2, 0.15, 0.95, 4, true), m.clone().multiply(mat(Math.cos(a) * 0.17, 0.46, Math.sin(a) * 0.17)).multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), 0.2)), c); }
  K.paint.add(ellipsoid(0.3, 0.2, 0.3, 5, 2), M4(m, 0, 0.98, 0, R()), 0xb89c5a);
}
function field(K, c, R, type) {
  const det = c.detail, tone = 0.93 + R() * 0.14;
  const { lines, terraced } = det && (type === 'vineyard' || type === 'orchard' || type === 'meadow') ? contourBands(c) : { lines: [], terraced: false };
  for (const pts of lines) dryWall(K.rubble, pts.map(([lx, lz]) => L2W(c, lx, lz)), 0.75, 0.6, { R, seg: 4 });
  const bands = [[[-c.hw, -c.hd + 0.4], [c.hw, -c.hd + 0.4]], ...lines, [[-c.hw, c.hd - 0.4], [c.hw, c.hd - 0.4]]];
  const rows = (step, first, last, fn) => { for (let b = 0; b < bands.length - 1; b++) for (let lx = -c.hw + 1.3; lx < c.hw - 1.0; lx += step * (0.9 + R() * 0.2)) { const za = lineZ(bands[b], lx) + first, zb = lineZ(bands[b + 1], lx) - last; fn(lx, za, zb); } };
  if (type === 'plough') {
    overlay(K, c, (lx, lz, rid) => rid ? [0.56, 0.58, 0.46] : [0.47, 0.5, 0.4], det ? { rowW: 1.5, ridge: 0.12, stepX: 8, inset: 0, tone } : { rowW: 3.2, ridge: 0.05, stepX: 14, inset: 0, tone });
    if (c.poi) poi('work', c, -c.hw + 3, 0, Math.PI / 2, { note: 'ploughing' });
  } else if (type === 'stubble') {
    overlay(K, c, (lx, lz, rid) => rid ? [0.85, 0.92, 0.63] : [0.78, 0.84, 0.55], { rowW: 3.6, ridge: 0, stepX: 14, inset: 0, tone });   // pale straw over the warm dirt map
    if (det) { let n = 0; for (let lz = -c.hd + 3; lz < c.hd - 2.5 && n < 4; lz += 5.5) for (let lx = -c.hw + 3; lx < c.hw - 2.5 && n < 4; lx += 4.5 + R() * 2) { if (R() < 0.55) continue; stook(K, at(c, lx + R(), lz + R(), R() * TAU), R); n++; } }
    if (c.poi) poi('work', c, 0, c.hd - 3, 0, { note: 'gleaning' });
  } else if (type === 'garden') {
    overlay(K, c, (lx, lz, rid) => rid ? (Math.floor((lx + 100) / 7) % 3 ? [0.33, 0.49, 0.14] : [0.45, 0.58, 0.16]) : [0.36, 0.31, 0.23], { rowW: 0.9, ridge: 0.2, stepX: 5, inset: 0, tone });
    if (c.poi) poi('work', c, 0, -c.hd + 2, 0, { note: 'watering the garden' });
  } else if (type === 'vineyard') {
    overlay(K, c, () => 0xa49e8c, { step: 8, inset: 0, tone });
    const card = new THREE.PlaneGeometry(0.95, 0.75), grape = ellipsoid(0.05, 0.085, 0.05, 4, 3), tint = pick(R, [0x9cbc60, 0xa8c468, 0x94b45c]);
    const sx = Math.max(det ? 1.5 : 2.2, (2 * c.hw - 2.3) / (det ? 10 : 8)), sz = Math.max(det ? 1.9 : 2.4, (2 * c.hd - 2) / (det ? 9 : 7));
    rows(sx, 1.2, 0.8, (lx, za, zb) => {
      for (let lz = za; lz <= zb; lz += sz) {
        const m = at(c, lx + (R() - 0.5) * 0.15, lz, (R() - 0.5) * 0.6);
        K.wood.add(cyl(0.03, 0.025, 1.3, 3, true), M4(m, 0.1, 0.55, 0)); K.bark.add(rod([0, -0.1, 0], [0.05, 0.62, 0.03], 0.04, 3, 0.025), m);
        for (let q = 0; q < (det ? 2 : 1); q++) K.foliage.add(card, m.clone().multiply(mat(0.05, 0.82 + q * 0.12, 0, (R() - 0.5) * 0.8, R() * TAU, (R() - 0.5) * 0.5)), tint);
        if (det && R() < 0.3) K.paint.add(grape, M4(m, (R() - 0.5) * 0.4, 0.55, 0.16), pick(R, [0x3b2442, 0x4a2c48, 0x7a8a3a]));
      }
    });
    if (c.poi) poi('work', c, 0, c.hd - 0.9, 0, { note: 'tending the vines' });
  } else if (type === 'orchard') {
    overlay(K, c, () => pick(R, [[0.61, 0.78, 0.41], [0.57, 0.72, 0.38]]), { step: 14, inset: 0, tone });
    rows(8.5, 3.0, 2.2, (lx, za, zb) => { for (let lz = za; lz <= zb + 0.01; lz += 7.5) if (R() < 0.85) S.olives.push([...L2W(c, lx + (R() - 0.5) * 1.2, lz + (R() - 0.5) * 0.8), 0.7 + R() * 0.35, !(c.fd < 70)]); });
    if (c.poi) poi('work', c, c.hw - 3, 0, -Math.PI / 2, { note: 'olive harvest' });
  } else if (type === 'meadow') {
    overlay(K, c, () => pick(R, [[0.555, 0.78, 0.36], [0.52, 0.74, 0.34], [0.58, 0.76, 0.39]]), { step: 14, inset: 0, tone });
    if (terraced) rows(12, 3.5, 2.5, (lx, za, zb) => { for (let lz = za; lz <= zb + 0.01; lz += 9) if (R() < 0.4) S.olives.push([...L2W(c, lx + (R() - 0.5) * 2, lz), 0.75 + R() * 0.4, !(c.fd < 70)]); });
    if (det && R() < 0.25) animal(K, at(c, (R() - 0.5) * (2 * c.hw - 4), (R() - 0.5) * (2 * c.hd - 4), R() * TAU), R, R() < 0.3 ? 'donkey' : 'goat');
  } else if (type === 'fallow') {
    overlay(K, c, () => pick(R, [[0.63, 0.77, 0.47], [0.6, 0.73, 0.45]]), { step: 14, inset: 0, tone });
    if (det && R() < 0.3) for (let i = 0, n = 1 + Math.floor(R() * 2); i < n; i++) animal(K, at(c, (R() - 0.5) * (2 * c.hw - 4), (R() - 0.5) * (2 * c.hd - 4), R() * TAU), R, R() < 0.12 ? 'donkey' : R() < 0.5 ? 'sheep' : 'goat');
  }
  // field trees: an olive, almond or fig or three left standing, most of them near the boundary (the open fields also keep the wild olives of the hills)
  const open = (type === 'meadow' && !terraced) || type === 'fallow' || type === 'stubble', nT = !c.walled ? (R() < (type === 'plough' ? 0.12 : open ? 0.32 : 0) ? 1 : 0) : open ? (R() < 0.8 ? 1 + Math.floor(R() * (type === 'stubble' ? 2 : 3)) : 0) : type === 'plough' && R() < 0.3 ? 1 : 0;
  for (let i = 0; i < nT && c.hw > 3.5 && c.hd > 3.5; i++) {
    const edge = R() < 0.7, side = R() < 0.5 ? -1 : 1, alongX = R() < 0.5, u = (R() - 0.5) * 2, lx = edge && !alongX ? side * (c.hw - 2.4) : u * (c.hw - 3), lz = edge && alongX ? side * (c.hd - 2.4) : (edge ? u : R() - 0.5) * (c.hd - 3);
    const kind = pick(R, [0, 0, 0, 1, 2]); S.olives.push([...L2W(c, lx, lz), (kind ? 0.85 : 0.75) + R() * 0.4, !(c.fd < 70), kind]);
  }
}

// ---------- the plan: roads, the land lattice, farms and their tracks, great tombs, family plots, fields (terrain only, so plan() can reserve) ----------
const ROADS = [
  { pts: [[-745, 62], [-790, 63], [-880, 70], [-1000, 76], [-1120, 72], [-1240, 78], [-1360, 86], [-1470, 95]], from: [-600, 72], end: 615, width: 4.5, seed: 21,
    specials: [{ kind: 'temple', s: 92, side: -1, hw: 6, hd: 7.5, off: 6 }, { kind: 'lion', s: 152, side: 1, hw: 10, hd: 10, off: 7 }, { kind: 'lycian', s: 208, side: -1, hw: 4, hd: 4, off: 5.5 }, { kind: 'tumulus', s: 262, side: 1, hw: 10, hd: 10, off: 7 }] },
  { pts: [[770, 120], [830, 124], [940, 134], [1060, 148], [1200, 152], [1370, 160], [1480, 167]], from: [752, 84], end: 600, width: 4.5, seed: 22,
    specials: [{ kind: 'lycian', s: 72, side: 1, hw: 4, hd: 4, off: 5.5 }, { kind: 'temple', s: 118, side: -1, hw: 6, hd: 7.5, off: 6 }, { kind: 'pillar', s: 185, side: 1, hw: 3, hd: 3, off: 5.5 }, { kind: 'tumulus', s: 240, side: -1, hw: 10, hd: 10, off: 7 }, { kind: 'lycian', s: 292, side: 1, hw: 4, hd: 4, off: 5.5 }] },
];
const FARMS = [{ x: -1190, z: 222, seed: 11, press: true }, { x: -1015, z: -105, seed: 12 }, { x: -955, z: 430, seed: 13, press: true }, { x: 1150, z: 285, seed: 14 }, { x: 1010, z: -80, seed: 15, press: true }];
const TRK = 2.85;
const TREES = [{}, { h0: 1.25, hr: 0.4, r0: 0.15, nb0: 3, l0: 0.85, lr: 0.5, up: 1.15, cs: 1.6, nc: 6, sp: 1.8 }, { h0: 1.0, hr: 0.4, r0: 0.2, nb0: 4, l0: 1.2, lr: 0.6, up: 0.35, cs: 2.3, nc: 3, sp: 1.8 }], TREE_TINT = [0xffffff, 0xc8e29c, 0x8fae62];   // olive, almond, fig   // field walls stand this far either side of a farm track
function smoothPath(Q, step = 3) {   // centripetal Catmull-Rom through the waypoints, resampled every ~step metres
  const out = [], P = [Q[0], ...Q, Q[Q.length - 1]], tj = (a, b) => Math.sqrt(Math.max(1e-6, dist2(a, b)));
  for (let i = 1; i < P.length - 2; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2], t1 = tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3), n = Math.max(1, Math.ceil(dist2(p1, p2) / step));
    const Lr = (a, b, ta, tb, t) => [0, 1].map(k => ((tb - t) * a[k] + (t - ta) * b[k]) / (tb - ta));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) { const t = lerp(t1, t2, k / n), A1 = Lr(p0, p1, 0, t1, t), A2 = Lr(p1, p2, t1, t2, t), A3 = Lr(p2, p3, t2, t3, t); out.push(Lr(Lr(A1, A2, 0, t2, t), Lr(A2, A3, t1, t3, t), t1, t2, t)); }
  }
  return out;
}
// a waypoint either side of every corner, so the spline bends there instead of bowing out into the walls that line the track
const pinCorners = (Q, r = 5) => [Q[0], ...Q.slice(1, -1).flatMap((b, i) => { const a = Q[i], c = Q[i + 2], la = dist2(a, b) || 1, lc = dist2(b, c) || 1, ka = Math.min(r, la / 3) / la, kc = Math.min(r, lc / 3) / lc; return [[b[0] + (a[0] - b[0]) * ka, b[1] + (a[1] - b[1]) * ka], b, [b[0] + (c[0] - b[0]) * kc, b[1] + (c[1] - b[1]) * kc]]; }), Q[Q.length - 1]];
let PLAN = null;
function makePlan(layout) {
  const P = { roads: ROADS.map(r => ({ pts: r.pts, width: r.width, end: r.end, seed: r.seed, from: r.from })), tracks: [], specials: [], plots: [], singles: [], farms: [], fields: [], walls: [], hedges: [], res: [], claims: [] };
  const others = (bb, m = 1) => layout.reserved.some(r => r.owner !== OWN && ov(r, bb, m));
  const roadD = (x, z) => { let d = Infinity; for (const r of P.roads.concat(P.tracks)) d = Math.min(d, polyD(r.pts, x, z) - r.width / 2); return d; };
  const ok = (o, { slope = 0.35, wallM = 20, road = 1.0, n = 4, margin = 0 } = {}) => {
    const bb = aabb(o, margin); if (P.claims.some(c => ov(c, bb)) || others(bb)) return false;
    for (const [x, z] of samples(o, n)) if (!outside(x, z, wallM) || terrainHeight(x, z) < SEA + 3 || slopeAt(x, z) > slope || roadD(x, z) < road) return false;
    return true;
  };
  const claim = (o, m = 0) => { const bb = aabb(o, m); P.claims.push(bb); return bb; };
  const onRoad = (pts, s, side, off, hd) => { const p = polyAt(pts, s), nx = -p.tz, nz = p.tx, d = side * (off + hd); return { x: p.x + nx * d, z: p.z + nz * d, ry: Math.atan2(-side * nx, -side * nz) }; };
  // 1. the land lattice beyond each gate: u out along the road, v across it (+v south); the lines nearest the road follow its bends, the rest are jittered
  const LAT = ROADS.map((road, si) => {
    const R = rng(road.seed * 13 + 5), A = road.pts[0], E = road.pts[road.pts.length - 1], len = dist2(A, E), d = [(E[0] - A[0]) / len, (E[1] - A[1]) / len], n = d[0] >= 0 ? [-d[1], d[0]] : [d[1], -d[0]];
    const R2 = road.pts.map(p => [(p[0] - A[0]) * d[0] + (p[1] - A[1]) * d[1], (p[0] - A[0]) * n[0] + (p[1] - A[1]) * n[1]]);
    const dev = u => { for (let i = 0; i < R2.length - 1; i++) if (u <= R2[i + 1][0] || i === R2.length - 2) return lerp(R2[i][1], R2[i + 1][1], clamp((u - R2[i][0]) / (R2[i + 1][0] - R2[i][0]), 0, 1)); };
    const W = (u, v) => [A[0] + d[0] * u + n[0] * v, A[1] + d[1] * u + n[1] * v];
    const us = []; for (let u = -90; u < 660; u += 30 + R() * 16) us.push(u);
    const vs = [-5.6, 5.6]; for (const s of [-1, 1]) for (let v = 34; v < 430; v += 22 + R() * 18) vs.push(s * v);
    vs.sort((a, b) => a - b); const r0 = vs.indexOf(-5.6);
    const phU = us.map(() => R() * TAU), phV = vs.map(() => R() * TAU);   // slow bends so the division lines wander like old field boundaries
    const V = us.map((u, i) => vs.map((v, j) => { const av = Math.abs(v), near = av < 6, uu = u + (near ? 0 : (R() - 0.5) * 7 + 8 * Math.sin(v / 80 + phU[i]) * smoothstep(6, 70, av)); return W(uu, v + dev(uu) * smoothstep(170, 40, av) + (near ? 0 : (R() - 0.5) * (av < 40 ? 3 : 7) + 6 * Math.sin(u / 95 + phV[j]) * smoothstep(40, 90, av))); }));
    const cells = [];
    for (let i = 0; i < us.length - 1; i++) {
      cells.push([]);
      for (let j = 0; j < vs.length - 1; j++) {
        const Q = [V[i][j], V[i + 1][j], V[i + 1][j + 1], V[i][j + 1]], [cx, cz] = qAt(Q, 0.5, 0.5);
        let good = j !== r0 && polyD(WALL, cx, cz) < 600 && dist2(Q[0], Q[2]) > 20;
        for (let a = 0; a < 3 && good; a++) for (let b = 0; b < 3 && good; b++) { const [x, z] = qAt(Q, 0.04 + a * 0.46, 0.04 + b * 0.46); if (!outside(x, z, 24) || terrainHeight(x, z) < SEA + 3 || slopeAt(x, z) > 0.3 || P.roads.some(r => polyD(r.pts, x, z) < r.width / 2 + 1.5)) good = false; }
        cells[i].push({ i, j, Q, good });
      }
    }
    return { si, seed: road.seed, R, A, d, n, dev, W, us, vs, r0, V, cells, TE: new Set() };
  });
  // 2. farms take a block of lattice cells near their sites; a track runs out from the road along a lattice line to the gate
  for (const F of FARMS) {
    const Lt = LAT[F.x < 0 ? 0 : 1], { us, vs, V, cells, r0 } = Lt; let best = null;
    for (const [bw, bh] of [[2, 2], [3, 2], [2, 3], [3, 3]]) for (let i = 0; i + bw < us.length; i++) for (let j = 0; j + bh < vs.length; j++) {
      if (j <= r0 && j + bh > r0) continue;
      const B = [V[i][j], V[i + bw][j], V[i + bw][j + bh], V[i][j + bh]], [x, z] = qAt(B, 0.5, 0.5), dd = Math.hypot(x - F.x, z - F.z), score = dd + (bw * bh - 4) * 30;
      if (dd > 130 || (best && best.score <= score)) continue;
      let good = true; for (let a = 0; a < bw; a++) for (let b = 0; b < bh; b++) if (!cells[i + a][j + b].good || cells[i + a][j + b].core) good = false;
      if (!good) continue;
      const core = { x, z, ry: Math.atan2(B[3][0] - B[0][0] + B[2][0] - B[1][0], B[3][1] - B[0][1] + B[2][1] - B[1][1]), hw: 36, hd: 22 };
      if (![[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([p, q]) => inQuad(B, ...L2W(core, p * 38.5, q * 24.5)))) continue;
      if (!ok(core, { slope: 0.22, road: 16 })) continue;
      const [lo, hi] = gRange({ x, z, ry: core.ry, hw: 11, hd: 9 }); if (hi - lo > 2.4) continue;
      best = { score, i, j, bw, bh, core };
    }
    if (!best) continue;
    const { i, j, bw, bh, core } = best, wp = [];
    for (let a = 0; a < bw; a++) for (let b = 0; b < bh; b++) cells[i + a][j + b].core = F;
    let line, tail, sgn = 1;
    if (j + bh <= r0) {   // north of the road: straight up a lattice line to the courtyard gate
      line = i + 1; for (let k = i + 2; k < i + bw; k++) if (Math.abs(W2L(core, ...V[k][j + bh])[0]) < Math.abs(W2L(core, ...V[line][j + bh])[0])) line = k;
      for (let k = r0; k >= j + bh; k--) wp.push(V[line][k]); for (let k = j + bh; k < r0; k++) Lt.TE.add(`u:${line}:${k}`);
      tail = [[-1, 17], [-1, 8]]; sgn = -1;
    } else {              // south of it: along the block's town-side edge, then in across the yard
      const jm = j + Math.floor(bh / 2), sg = Math.sign(W2L(core, ...Lt.A)[0]) || 1;
      line = W2L(core, ...V[i][jm])[0] * sg > 0 ? i : i + bw;
      for (let k = r0 + 1; k <= jm; k++) wp.push(V[line][k]); for (let k = r0 + 1; k < jm; k++) Lt.TE.add(`u:${line}:${k}`);
      tail = [[sg * 31, 12.4], [sg * 9, 13], [sg * 2.5, 11.8], [-1, 7.2]];   // clear of the well trough
    }
    const [u0] = [(wp[0][0] - Lt.A[0]) * Lt.d[0] + (wp[0][1] - Lt.A[1]) * Lt.d[1]], start = Lt.W(u0, Lt.dev(u0) + sgn * 3.8);
    const track = { pts: smoothPath(pinCorners([start, ...wp, ...tail.map(p => L2W(core, p[0], p[1]))]), 3), width: 3.2, track: true };
    P.tracks.push(track); claim(core);
    P.farms.push({ ...F, core, track });
  }
  // 3. great tombs, then family plots and single markers along both roads
  for (const road of ROADS) {
    const R = rng(road.seed), pts = road.pts;
    for (const q of road.specials) for (const ds of [0, 6, -6, 12, -12, 18]) {
      const o = { ...onRoad(pts, q.s + ds, q.side, q.off, q.hd), hw: q.hw, hd: q.hd };
      if (ok(o, { slope: 0.2, road: 1.5 })) { claim(o, 0.5); P.specials.push({ kind: q.kind, o, seed: road.seed * 31 + P.specials.length, road: road.seed, s: q.s + ds, side: q.side, hw: q.hw }); break; }
    }
    for (const side of [-1, 1]) {
      let s = 20;
      while (s < 320) {
        const near = 1 - smoothstep(60, 340, s), r = R();
        if (r < 0.2 + 0.45 * (1 - near)) {
          if (R() < 0.6) { const o = { ...onRoad(pts, s + 0.6, side, 4.9 + R() * 0.8, 0.5), hw: 0.6, hd: 0.5 }; if (ok(o, { road: 0.8, n: 1 })) { claim(o, 0.3); P.singles.push({ o, seed: Math.floor(R() * 1e6) }); } }
          s += 2.5 + R() * 6; continue;
        }
        const hw = 2.8 + R() * 4.2, hd = 2.6 + R() * 2.6, off = 5.0 + R() * 1.2, o = { ...onRoad(pts, s + hw, side, off, hd), hw, hd };
        if (!ok(o, { slope: 0.25, road: 1.2 })) { s += 3; continue; }
        claim(o, 0.2); P.plots.push({ o, terrace: R() < 0.25 + 0.5 * near, seed: Math.floor(R() * 1e6), road: road.seed });
        if (s < 230 && R() < 0.5) {
          const hw2 = 2.5 + R() * 2.5, hd2 = 2.5 + R() * 1.8, o2 = { ...onRoad(pts, s + hw, side, off + 2 * hd + 1.8 + R() * 2.5, hd2), hw: hw2, hd: hd2 };
          if (ok(o2, { slope: 0.25, road: 1.2 })) { claim(o2, 0.2); P.plots.push({ o: o2, terrace: false, seed: Math.floor(R() * 1e6), road: road.seed }); }
        }
        s += 2 * hw + 1.2 + R() * 3.5;
      }
    }
  }
  // 4. the fields: lattice cells merged into larger fields far out and split into strips near the farms; neighbours share one wall
  for (const Lt of LAT) {
    const { cells, V, us, vs, TE, d: D0, n: N0 } = Lt, R = rng(Lt.seed * 7 + 1), NI = us.length - 1, NJ = vs.length - 1, list = [], w0 = P.walls.length;
    const hitClaim = Q => {
      const bb = qBox(Q); if (others(bb, 0)) return true;
      for (const c of P.claims) {
        if (!ov(c, bb)) continue;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { const [x, z] = qAt(Q, 0.02 + a * 0.48, 0.02 + b * 0.48); if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true; }
        if ([[c.minX, c.minZ], [c.maxX, c.minZ], [c.maxX, c.maxZ], [c.minX, c.maxZ]].some(p => inQuad(Q, p[0], p[1]))) return true;
      }
      return false;
    };
    for (const col of cells) for (const cl of col) {
      if (!cl.good || cl.core) continue; if (hitClaim(cl.Q)) { cl.claimed = true; continue; }
      const [x, z] = qAt(cl.Q, 0.5, 0.5); cl.wd = polyD(WALL, x, z); cl.fd = 1e9; P.farms.forEach((f, k) => { const dd = Math.hypot(f.core.x - x, f.core.z - z); if (dd < cl.fd) { cl.fd = dd; cl.farm = k; } });
      if (cl.fd < 150 || R() < (cl.wd < 260 ? 0.95 : lerp(0.95, 0.35, (cl.wd - 260) / 340))) { cl.cand = true; cl.par = cl; cl.size = 1; }
    }
    // the patchwork frays out: lone cells go, and the outermost ring lies open as fallow
    const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]], filled = (i, j) => { const n = cells[i] && cells[i][j]; return !!n && (n.cand || n.core || n.claimed || j === Lt.r0); };
    for (let pass = 0; pass < 2; pass++) { const drop = []; for (const col of cells) for (const cl of col) if (cl.cand && cl.fd >= 150 && NB4.filter(([a, b]) => filled(cl.i + a, cl.j + b)).length < 2) drop.push(cl); for (const cl of drop) cl.cand = false; }
    for (const col of cells) for (const cl of col) if (cl.cand && cl.fd >= 150 && NB4.some(([a, b]) => !filled(cl.i + a, cl.j + b))) cl.ring = true;
    const root = cl => { while (cl.par !== cl) cl = cl.par; return cl; };
    const trackSide = cl => TE.has(`u:${cl.i}:${cl.j}`) || TE.has(`u:${cl.i + 1}:${cl.j}`);
    for (const col of cells) for (const cl of col) {
      if (!cl.cand || R() > (cl.fd < 110 ? 0.15 : 0.65)) continue;
      const [di, dj] = R() < 0.5 ? [1, 0] : [0, 1], nb = cells[cl.i + di] && cells[cl.i + di][cl.j + dj];
      if (!nb || !nb.cand || (di && TE.has(`u:${cl.i + 1}:${cl.j}`))) continue;
      const a = root(cl), b = root(nb); if (a === b || !cl.ring !== !nb.ring || a.size + b.size > (cl.fd < 110 ? 2 : cl.fd < 260 ? 3 : 5)) continue;
      b.par = a; a.size += b.size;
    }
    const byRoot = new Map();
    for (const col of cells) for (const cl of col) {
      if (!cl.cand) continue;
      const rt = root(cl), Wd = (dist2(cl.Q[0], cl.Q[1]) + dist2(cl.Q[3], cl.Q[2])) / 2, Dd = (dist2(cl.Q[0], cl.Q[3]) + dist2(cl.Q[1], cl.Q[2])) / 2;
      if (rt.size === 1 && cl.fd < 115 && !trackSide(cl) && R() < 0.6) {   // strips along the longer side
        const dir = Wd > Dd ? 'u' : 'v', m = Math.max(Wd, Dd) > 36 ? 3 : 2, fr = [0]; for (let k = 1; k < m; k++) fr.push(k / m + (R() - 0.5) * 0.14); fr.push(1);
        cl.split = { dir, fr }; cl.subs = [];
        for (let k = 0; k < m; k++) { const f = { subs: [], fd: cl.fd, wd: cl.wd, farm: cl.farm, seed: Math.floor(R() * 1e6), strip: true }, sub = dir === 'u' ? { a0: fr[k], a1: fr[k + 1], b0: 0, b1: 1, f } : { a0: 0, a1: 1, b0: fr[k], b1: fr[k + 1], f }; f.subs.push(sub); f.cl = cl; cl.subs.push(sub); list.push(f); }
      } else {
        let f = byRoot.get(rt); if (!f) { f = { subs: [], fd: cl.fd, wd: cl.wd, farm: cl.farm, seed: Math.floor(R() * 1e6), cl }; byRoot.set(rt, f); list.push(f); }
        const sub = { a0: 0, a1: 1, b0: 0, b1: 1, f }; cl.subs = [sub]; f.subs.push(sub); f.fd = Math.min(f.fd, cl.fd);
      }
    }
    const cap = { vineyard: 0, orchard: 0, garden: 0 }, LIM = { vineyard: 2, orchard: 7, garden: 8 }, has = P.farms.map(() => ({}));
    list.sort((a, b) => a.fd - b.fd);
    for (const f of list) {
      const [x, z] = qAt(f.cl.Q, 0.5, 0.5), sl = slopeAt(x, z, 8), near = f.fd < 150, mid = f.fd < 300 || f.wd < 220;
      let t = near ? pick(R, f.strip ? ['garden', 'plough', 'stubble', 'garden', 'stubble', 'plough'] : ['orchard', 'plough', 'stubble', 'fallow', 'meadow', 'stubble'])
        : mid ? pick(R, ['plough', 'stubble', 'fallow', 'orchard', 'plough', 'stubble', 'meadow', 'vineyard']) : pick(R, ['meadow', 'fallow', 'plough', 'stubble', 'meadow', 'fallow', 'orchard']);
      const hf = has[f.farm], one = f.subs.length === 1 && !f.strip, must = f.fd < 100 ? (one && !hf.vineyard ? 'vineyard' : one && !hf.orchard ? 'orchard' : f.strip && !hf.garden ? 'garden' : null) : null;   // every farm keeps its vines, olives and garden close by
      if (f.cl.ring) t = R() < 0.75 ? 'fallow' : 'meadow';
      else if (must) t = must;
      else {
        if (sl > 0.13 && (t === 'plough' || t === 'stubble' || t === 'garden')) t = R() < 0.4 ? 'orchard' : 'meadow';
        if (LIM[t] !== undefined && (cap[t] += f.subs.length) > LIM[t]) t = R() < 0.5 ? 'meadow' : 'fallow';
      }
      hf[t] = true;
      f.type = t; f.walled = !f.cl.ring && (t === 'vineyard' || t === 'garden' || t === 'orchard' || R() < (near ? 0.5 : t === 'plough' || t === 'stubble' ? 0.22 : 0.3));
    }
    // walls: every lattice edge is split where either side's strips change; a wall stands wherever two different fields meet and one is walled
    const pieces = new Map(), hedgeCand = [];
    const subsOn = (cl, test, lo, hi) => cl && cl.subs ? cl.subs.filter(test).map(s => [s[lo], s[hi], s.f]) : [];
    const edge = (lk, e, key, SA, SB) => {
      const br = [...new Set([0, 1, ...SA.flatMap(s => [s[0], s[1]]), ...SB.flatMap(s => [s[0], s[1]])])].sort((a, b) => a - b), fAt = (S, t) => { const s = S.find(q => t > q[0] && t < q[1]); return s ? s[2] : null; };
      for (let k = 0; k < br.length - 1; k++) {
        const t0 = br[k], t1 = br[k + 1], tm = (t0 + t1) / 2, fA = fAt(SA, tm), fB = fAt(SB, tm); if (t1 - t0 < 1e-4 || fA === fB) continue;
        const put = (off, a, b) => { const key2 = lk + '|' + off; if (!pieces.has(key2)) pieces.set(key2, []); pieces.get(key2).push({ e, t0, t1, fA: a, fB: b }); };
        if (TE.has(key)) { if (fA && fA.walled) put(-1, fA, null); if (fB && fB.walled) put(1, null, fB); }
        else if ((fA && fA.walled) || (fB && fB.walled)) put(0, fA, fB);
        else hedgeCand.push([lk, e, t0, t1]);
      }
    };
    for (let j = 0; j <= NJ; j++) for (let i = 0; i < NI; i++) edge('v' + j, i, `v:${i}:${j}`, subsOn(j > 0 ? cells[i][j - 1] : null, s => s.b1 === 1, 'a0', 'a1'), subsOn(j < NJ ? cells[i][j] : null, s => s.b0 === 0, 'a0', 'a1'));
    for (let i = 0; i <= NI; i++) for (let j = 0; j < NJ; j++) edge('u' + i, j, `u:${i}:${j}`, subsOn(i > 0 ? cells[i - 1][j] : null, s => s.a1 === 1, 'b0', 'b1'), subsOn(i < NI ? cells[i][j] : null, s => s.a0 === 0, 'b0', 'b1'));
    const lineOf = lk => lk[0] === 'v' ? V.map(c => c[+lk.slice(1)]) : V[+lk.slice(1)];
    const fp = new Map(), addFP = (f, w, pc) => { if (!f || !f.walled) return; if (!fp.has(f)) fp.set(f, []); fp.get(f).push([w, pc]); };
    for (const [key2, lst] of pieces) {
      const [lk, os] = key2.split('|'), off = +os * TRK, Lv = lineOf(lk), ref = lk[0] === 'v' ? N0 : D0;
      const perp = e => { const a = Lv[e], b = Lv[e + 1], l = dist2(a, b) || 1; let nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l; if (nx * ref[0] + nz * ref[1] < 0) { nx = -nx; nz = -nz; } return [nx, nz]; };
      const pt = (e, t) => { let [nx, nz] = perp(e); if (off && t === 0 && e > 0) { const q = perp(e - 1); nx = (nx + q[0]) / 2; nz = (nz + q[1]) / 2; } else if (off && t === 1 && e < Lv.length - 2) { const q = perp(e + 1); nx = (nx + q[0]) / 2; nz = (nz + q[1]) / 2; } return [lerp(Lv[e][0], Lv[e + 1][0], t) + nx * off, lerp(Lv[e][1], Lv[e + 1][1], t) + nz * off]; };
      lst.sort((p, q) => p.e + p.t0 - (q.e + q.t0));
      let w = null;
      for (const pc of lst) {
        const st = pc.e + pc.t0;
        if (!w || Math.abs(st - w.end) > 1e-6) { w = { pts: [pt(pc.e, pc.t0)], end: st, len: 0, h: 0.8 + R() * 0.35, seed: Math.floor(R() * 1e6), gaps: [] }; P.walls.push(w); }
        const q = pt(pc.e, pc.t1), s0 = w.len; w.len += dist2(w.pts[w.pts.length - 1], q); w.pts.push(q); w.end = pc.e + pc.t1;
        const pr = { s0, s1: w.len, other: pc.fA && pc.fB ? 1 : 0 }; addFP(pc.fA, w, pr); addFP(pc.fB, w, pr);
      }
    }
    for (const col of cells) for (const cl of col) if (cl.split) {   // walls between the strips of a split cell
      const { dir, fr } = cl.split;
      for (let k = 1; k < fr.length - 1; k++) {
        const fA = cl.subs[k - 1].f, fB = cl.subs[k].f; if (!fA.walled && !fB.walled) continue;
        const a = dir === 'u' ? qAt(cl.Q, fr[k], 0) : qAt(cl.Q, 0, fr[k]), b = dir === 'u' ? qAt(cl.Q, fr[k], 1) : qAt(cl.Q, 1, fr[k]), w = { pts: [a, b], len: dist2(a, b), h: 0.75 + R() * 0.3, seed: Math.floor(R() * 1e6), gaps: [] };
        P.walls.push(w); const pr = { s0: 0, s1: w.len, other: 1 }; addFP(fA, w, pr); addFP(fB, w, pr);
      }
    }
    // the farm tracks pass through: a wall is opened wherever it comes into a track's corridor, out to the walls lining the track, so they meet in T-junctions
    const TB = P.tracks.map(t => qBox(t.pts, TRK + 1)), tD = (x, z) => { let d = Infinity; P.tracks.forEach((t, k) => { const b = TB[k]; if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) d = Math.min(d, polyD(t.pts, x, z)); }); return d; };
    for (const w of P.walls.slice(w0)) {
      const wb = qBox(w.pts); if (!TB.some(b => ov(b, wb))) continue;
      const ss = [], ds = []; let s0 = 0;
      for (let a = 0; a < w.pts.length - 1; a++) { const [ax, az] = w.pts[a], [bx, bz] = w.pts[a + 1], l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / 0.25)); for (let q = a ? 1 : 0; q <= n; q++) { ss.push(s0 + l * q / n); ds.push(tD(lerp(ax, bx, q / n), lerp(az, bz, q / n))); } s0 += l; }
      const G = [], lim = TRK + 0.2;
      for (let k = 0; k < ds.length; k++) {
        if (ds[k] >= 2.0) continue;
        let a = k, b = k; while (b + 1 < ds.length && ds[b + 1] < 2.0) b++;
        while (a > 0 && ds[a - 1] < lim && ds[a - 1] > ds[a] + 0.01 && ss[k] - ss[a - 1] < 12) a--;
        const e = b; while (b + 1 < ds.length && ds[b + 1] < lim && ds[b + 1] > ds[b] + 0.01 && ss[b + 1] - ss[e] < 12) b++;
        G.push([a > 0 ? ss[a - 1] : -1, b + 1 < ds.length ? ss[b + 1] : s0 + 1]); k = b;
      }
      for (const g of G) { if (g[0] < 1.5) g[0] = -1; if (g[1] > s0 - 1.5) g[1] = s0 + 1; const p = w.gaps[w.gaps.length - 1]; if (p && g[0] - p[1] < 1.5) p[1] = Math.max(p[1], g[1]); else w.gaps.push(g); }
    }
    for (const [f, opts] of fp) {   // one gate per walled field, onto open land or a track where it can
      const good = opts.filter(o => o[1].s1 - o[1].s0 > 9); if (!good.length) continue;
      const best = Math.min(...good.map(o => o[1].other)), [w, pr] = pick(R, good.filter(o => o[1].other === best)), c = lerp(pr.s0 + 3.5, pr.s1 - 3.5, R());
      if (!w.gaps.some(g => c + 1.4 > g[0] - 3 && c - 1.4 < g[1] + 3)) w.gaps.push([c - 1.4, c + 1.4]);
    }
    for (const [lk, e, t0, t1] of hedgeCand) {   // now and then a row of olives on an unwalled boundary
      const Lv = lineOf(lk), a = Lv[e], b = Lv[e + 1], L = dist2(a, b) * (t1 - t0); if (L < 16 || R() > 0.12) continue;
      for (let s = 4; s < L - 3; s += 9 + R() * 4) { const t = t0 + (t1 - t0) * s / L; S_HEDGE(P, lerp(a[0], b[0], t), lerp(a[1], b[1], t), 0.75 + R() * 0.35); }
    }
    // the planted cells and reservations over row runs of them
    for (const col of cells) for (const cl of col) if (cl.subs) {
      const ins = [`v:${cl.i}:${cl.j}`, `u:${cl.i + 1}:${cl.j}`, `v:${cl.i}:${cl.j + 1}`, `u:${cl.i}:${cl.j}`].map(k => TE.has(k) ? TRK : 0), Qt = ins.some(Boolean) ? insetQuad(cl.Q, ins) : cl.Q;
      cl.subs.forEach((sub, k) => {
        const f = sub.f; let Q = [qAt(Qt, sub.a0, sub.b0), qAt(Qt, sub.a1, sub.b0), qAt(Qt, sub.a1, sub.b1), qAt(Qt, sub.a0, sub.b1)];
        if (!f.walled) Q = insetQuad(Q, [0.5, 0.5, 0.5, 0.5]);
        P.fields.push({ ...quadRect(Q), type: f.type, seed: f.seed + k * 7919 + cl.i * 31 + cl.j, detail: f.fd < 105, poi: false, farm: f.farm, fd: f.fd, walled: f.walled, first: f.subs[0] === sub });
      });
    }
    for (let j = 0; j < NJ; j++) {
      let bb = null, n = 0;
      for (let i = 0; i <= NI; i++) {
        const cl = i < NI ? cells[i][j] : null;
        if (!cl || !cl.subs || !cl.subs.some(q => q.f.walled || /plough|stubble|garden/.test(q.f.type))) { if (bb) P.res.push(bb); bb = null; n = 0; continue; }   // tilled land keeps the hills' pines and olives out; fallow and meadow keep them
        const q = qBox(cl.Q, -0.5);
        if (bb && n < 3) { bb = { minX: Math.min(bb.minX, q.minX), maxX: Math.max(bb.maxX, q.maxX), minZ: Math.min(bb.minZ, q.minZ), maxZ: Math.max(bb.maxZ, q.maxZ) }; n++; } else { if (bb) P.res.push(bb); bb = q; n = 1; }
      }
    }
  }
  // work spots in the fields: two per farm, on the walled fields nearest a track or the road, where they are seen
  P.farms.forEach((_, k) => {
    const c = P.fields.filter(q => q.farm === k && q.first && q.fd < 200 && /plough|stubble|garden|vineyard|orchard/.test(q.type)).map(q => ({ q, d: roadD(q.x, q.z) - Math.min(q.hw, q.hd) + (q.walled ? 0 : 25) })).sort((a, b) => a.d - b.d);
    const a = c[0], b = a && (c.find(e => e !== a && e.q.type !== a.q.type) || c[1]); for (const e of [a, b]) if (e) e.q.poi = true;
  });
  return P;
}
const S_HEDGE = (P, x, z, s) => { if (outside(x, z, 24)) P.hedges.push([x, z, s]); };

export function plan(ctx) {
  PLAN = makePlan(ctx.layout);
  const L = ctx.layout, res = (bb, note) => { if (!L.reserved.some(r => r.owner !== OWN && ov(r, bb))) L.reserve(bb, OWN, note); };
  for (const q of PLAN.specials) res(aabb(q.o, 0.5), q.kind + ' tomb');
  for (const q of PLAN.plots) res(aabb(q.o, 0.5), 'grave plot');
  for (const f of PLAN.farms) res(aabb(f.core), 'farmstead');
  for (const bb of PLAN.res) res(bb, 'fields');
  for (const r of PLAN.roads.concat(PLAN.tracks)) {
    const Lr = polyLen(r.pts);
    for (let s = 0; s < Lr; s += 20) { const a = polyAt(r.pts, s), b = polyAt(r.pts, Math.min(Lr, s + 20)), w = r.width / 2 + 1; if (!outside(a.x, a.z, 12)) continue; res({ minX: Math.min(a.x, b.x) - w, maxX: Math.max(a.x, b.x) + w, minZ: Math.min(a.z, b.z) - w, maxZ: Math.max(a.z, b.z) + w }, 'road'); }
  }
}

// ---------- build ----------
export function build(ctx) {
  const { M, world, layout, B, kit } = ctx;
  const P = PLAN || (PLAN = makePlan(layout));
  const K = { ...B, rubble: new Bucket(), paint: new ColorBucket(), foliage: new ColorBucket(), bark: new Bucket(), cypB: new Bucket(), fields: [] };
  K.terra = K.paint;
  S = { world, layout, cyp: [], olives: [] };
  const c0 = world.colliders.length, foreign = world.colliders.slice(0, c0), far = foreign.filter(c => !inWall((c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2));
  const free = (bb, m = 0.5) => !layout.reserved.some(r => r.owner !== OWN && ov(r, bb)) && !foreign.some(c => ov(c, bb, m));
  const freeFar = bb => !layout.reserved.some(r => r.owner !== OWN && ov(r, bb)) && !far.some(c => ov(c, bb, 0.3));
  // sculpture shared by the tombs: relief pairs for the naiskoi, small relief figures, lions
  const V3 = (a, b, c) => new THREE.Vector3(a, b, c);
  const figs = [figureGeometry({ seed: 301, draped: 'full', female: true }), figureGeometry({ seed: 302, draped: 'full' }), figureGeometry({ seed: 303, draped: 'short' }), figureGeometry({ seed: 304, draped: 'full', female: true })];
  K.pairs = [[0, 1], [3, 2], [1, 3], [0, 2]].map(([a, b]) => new Bucket().add(relief(figs[a], mat(-0.3, 0, 0.03, 0, 0.35, 0, V3(0.72, 0.72, 0.42)), 0)).add(relief(figs[b], mat(0.3, 0, 0.03, 0, -0.35, 0, V3(0.72, 0.72, 0.42)), 0)).build());
  K.smallFigs = figs.slice(0, 3).map(g => relief(g, mat(0, 0, 0.02, 0, 0, 0, V3(0.45, 0.45, 0.34)), 0));
  K.lionS = lionGeometry({ scale: 0.55, seed: 5 }); K.lionB = lionGeometry({ scale: 1.85, seed: 6 });

  // roads beyond the gates and farm tracks: beaten earth, the roads thinning out into a track where they end
  for (const r of P.roads) {   // begun 8 m inside the gate over the end of the city's road, in its colour, turning to the country road's over 40 m
    const [gx, gz] = r.pts[0], l = dist2(r.pts[0], r.from), IN = 8, pts = [[gx + (r.from[0] - gx) / l * IN, gz + (r.from[1] - gz) / l * IN], ...r.pts];
    dirtStrip(K, pts, { fade: (s, L) => 1 - clamp((s - IN - (r.end - 60)) / (L - IN - r.end + 60), 0, 0.96), town: s => 1 - smoothstep(IN, IN + 40, s) }); layout.roads.push({ pts: r.pts, width: r.width, owner: OWN });
  }
  for (const t of P.tracks) { dirtStrip(K, t.pts, { half: 1.25, verge: 0.9, lift: 0.06, O: [-1.4, -1, -0.45, 0, 0.45, 1, 1.4], fade: (s, L) => 0.8 * clamp(Math.min(0.45 + s / 6, (L - s) / 12), 0.05, 1) }); layout.roads.push({ pts: t.pts, width: t.width, owner: OWN }); }

  // necropoleis
  const NR = {}; for (const r of ROADS) NR[r.seed] = { naiskos: 0, maxNaiskos: 2, figs: 0, maxFigs: 2 };
  const nth = {};
  for (const q of P.specials) {
    if (!free(aabb(q.o))) continue; const R = rng(q.seed), v = nth[q.kind] = (nth[q.kind] ?? -1) + 1;
    ({ lion: lionTomb, temple: templeTomb, tumulus, lycian: lycianTomb, pillar: pillarTomb })[q.kind](K, q.o, R, v);
  }
  for (const q of P.plots) { if (free(aabb(q.o))) plot(K, q.o, rng(q.seed), q.terrace, NR[q.road]); }
  for (const q of P.singles) {
    if (!free(aabb(q.o))) continue; const R = rng(q.seed), m = at(q.o, 0, 0), r = R();
    if (r < 0.55) stele(K, m, R); else if (r < 0.8) vase(K, m, R, R() < 0.4); else kioniskos(K, m, R);
    colRect(q.o, 0, 0, 0.45, 0.35);
  }
  const tombSpots = layout.pois.filter(q => q.owner === OWN && q.type === 'shrine' && !/family plot/.test(q.note || ''));
  for (const road of P.roads) {    // cypresses strung along the verges among the tombs, but never across a great tomb's frontage or its offering spot
    const R = rng(97 + road.pts[0][0]), sp = P.specials.filter(q => q.road === road.seed);
    for (let s = 30; s < 330; s += 9 + R() * 14) for (const side of [-1, 1]) {
      if (R() < 0.6) continue; const p = polyAt(road.pts, s), off = side * (4.6 + R() * 0.6), x = p.x - p.tz * off, z = p.z + p.tx * off, H = 8 + R() * 5;
      if (sp.some(q => q.side === side && Math.abs(s - q.s) < q.hw + 3) || tombSpots.some(q => Math.hypot(q.x - x, q.z - z) < 6)) continue;
      S.cyp.push([x, z, H]);
    }
    // asphodel and grass tufts on the verges and between the plots
    const card = new THREE.PlaneGeometry(0.8, 0.55);
    for (let s = 18; s < 340; s += 2.2 + R() * 3.5) {
      const p = polyAt(road.pts, s), side = R() < 0.5 ? -1 : 1, off = side * (3.9 + R() * (R() < 0.3 ? 9 : 1.2)), x = p.x - p.tz * off, z = p.z + p.tx * off;
      if (world.blocked(x, z) || !outside(x, z, 20)) continue;
      const m = mat(x, gy(x, z) - 0.05, z, 0, R() * TAU, 0, 0.7 + R() * 0.6), tint = pick(R, [0x8aa05a, 0x9aa866, 0xa8a870]);
      for (let q = 0; q < 2; q++) K.foliage.add(card, m.clone().multiply(mat(0, 0.24, 0, 0, q * Math.PI / 2, 0)), tint);
      if (R() < 0.4) for (let q = 0; q < 2; q++) { const a = R() * TAU, h = 0.8 + R() * 0.3; K.paint.add(rod([0, 0, 0], [Math.cos(a) * 0.1, h, Math.sin(a) * 0.1], 0.012, 3), m, 0x6a7a44); K.paint.add(rod([Math.cos(a) * 0.1, h - 0.05, Math.sin(a) * 0.1], [Math.cos(a) * 0.12, h + 0.2, Math.sin(a) * 0.12], 0.024, 3, 0.01), m, 0xc8c0aa); }
    }
  }
  const verge = (road, s0, r) => {   // a free spot on the verge 3.6 m off the centre line, a little along the road if the first is taken
    for (const ds of [0, 5, -5, 10, -10, 16]) for (const side of [1, -1]) {
      const p = polyAt(road.pts, s0 + ds), x = p.x - p.tz * side * 3.6, z = p.z + p.tx * side * 3.6;
      if (outside(x, z, 20) && !world.blocked(x, z) && [0, 1, 2, 3].every(k => !world.blocked(x + Math.cos(k * Math.PI / 2) * r, z + Math.sin(k * Math.PI / 2) * r))) return { x, z, y: world.groundHeight(x, z), along: Math.atan2(p.tx, p.tz), toRoad: Math.atan2(side * p.tz, -side * p.tx) };
    }
    return null;
  };
  P.roads.forEach((road, i) => { const v = verge(road, 30, 0.8); if (v) layout.addPoi({ type: 'view', x: v.x, z: v.z, y: v.y, ry: v.along, r: 2, owner: OWN, note: i ? 'the east necropolis' : 'the Street of Tombs beyond the Myndos gate' }); });
  for (const road of P.roads) { const v = verge(road, 140, 1.2); if (v) layout.addPoi({ type: 'gather', x: v.x, z: v.z, y: v.y, ry: v.toRoad, r: 3, owner: OWN, note: 'funeral procession on the road' }); }

  // farmsteads
  for (const f of P.farms) {
    const R = rng(f.seed), c = f.core, sub = (lx, lz, hw, hd, dry = 0) => { const [x, z] = L2W(c, lx, lz); return { x, z, ry: c.ry + dry, hw, hd }; };
    const house = sub(0, -6, 11, 9);
    if (!free(aabb(house))) continue;
    farmhouse(K, house, R, kit);
    const tf = sub(-24, -5, 6.2, 6.2); if (free(aabb(tf)) && slopeAt(tf.x, tf.z) < 0.18) threshingFloor(K, tf, R);
    const pn = sub(23, -7, 6.5, 5); if (free(aabb(pn))) pen(K, pn, R);
    const hv = sub(22, 8.5, 2.2, 1.2); if (free(aabb(hv))) hives(K, hv, R);
    const wl = sub(6, 7.5, 1.6, 2.2); if (free(aabb(wl))) well(K, wl, R);
    const sh = sub(-20, 17, 1.8, 1.8); if (free(aabb(sh))) fieldShrine(K, sh, R);
    if (f.press) { const pr = sub(11, 17, 4.3, 2.9); if (free(aabb(pr))) oilPress(K, pr, R); }
    for (const [lx, lz] of [[-13, -13], [-31, 4]]) { const m = at(c, lx, lz, R() * TAU); K.paint.add(lathe([[1.4, -0.2], [1.5, 0.6], [1.3, 1.5], [0.8, 2.4], [0.25, 2.9], [0.001, 3.0]], 9), m, 0x6e5a34); K.woodDark.add(cyl(0.05, 0.04, 4.0, 4, true), M4(m, 0, 1.8, 0)); }
    for (const lx of [0, 5, -5, 10, -10, 15]) {   // looking out over the fields, from beside the track rather than on it
      const [vx, vz] = L2W(c, lx, 24); if (world.blocked(vx, vz) || P.roads.concat(P.tracks).some(r => polyD(r.pts, vx, vz) < r.width / 2 + 1.5)) continue;
      layout.addPoi({ type: 'view', x: vx, z: vz, y: world.groundHeight(vx, vz), ry: c.ry, r: 2, owner: OWN, note: 'looking out over the fields' }); break;
    }
  }
  // the chora: shared field walls, then what grows inside them
  for (const w of P.walls) { if (freeFar(qBox(w.pts))) dryWall(K.rubble, w.pts, w.h, 0.7, { gaps: w.gaps, R: rng(w.seed), seg: 7.5 }); }
  for (const q of P.fields) { if (freeFar(qBox(q.Q))) field(K, q, rng(q.seed), q.type); }
  for (const [x, z, s] of P.hedges) S.olives.push([x, z, s, true]);

  // planted trees: olives in the orchards and on field boundaries, cypresses by the tombs and shrines
  const oliveV = [], oliveLo = [], cypV = [], RT = rng(4242);
  for (let i = 0; i < 6; i++) oliveV.push(oliveGeo(RT));
  for (let i = 0; i < 4; i++) oliveLo.push(oliveGeo(RT, true));
  for (let i = 0; i < 5; i++) cypV.push(cypressGeo(RT, 11));
  const kindV = [null, [0, 1, 2].map(() => oliveGeo(RT, true, TREES[1])), [0, 1, 2].map(() => oliveGeo(RT, true, TREES[2]))];
  const TBx = P.tracks.map(t => [qBox(t.pts, 3), t]), onTrack = (x, z) => TBx.some(([b, t]) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && polyD(t.pts, x, z) < t.width / 2 + 0.9);
  for (const [x, z, s, lo, kind = 0] of S.olives) {
    if (world.blocked(x, z) || onTrack(x, z)) continue;
    const vs = kind ? kindV[kind] : lo ? oliveLo : oliveV, g = vs[Math.floor(RT() * vs.length)], m = mat(x, gy(x, z) - 0.12, z, 0, RT() * TAU, 0, s); K.bark.add(g.trunk, m); K.foliage.add(g.leaves, m, TREE_TINT[kind]); col({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 });
  }
  for (const [x, z, H] of S.cyp) {
    if (world.blocked(x, z) || world.blocked(x + 0.8, z) || world.blocked(x - 0.8, z) || world.blocked(x, z + 0.8) || world.blocked(x, z - 0.8) || !outside(x, z, 18)) continue;
    if (P.roads.concat(P.tracks).some(r => polyD(r.pts, x, z) < r.width / 2 + 1.6) || layout.reserved.some(r => r.owner !== OWN && x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ)) continue;
    const g = cypV[Math.floor(RT() * cypV.length)], m = mat(x, gy(x, z) - 0.1, z, 0, RT() * TAU, 0, V3(1, H / 11, 1));
    K.cypB.add(g.body, m); K.foliage.add(g.cards, m, 0x4f6a3e); K.bark.add(g.trunk, m); col({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 });
  }

  for (const q of layout.pois) {   // a spot a tree was later planted on steps aside to open ground
    if (q.owner !== OWN || !world.blocked(q.x, q.z)) continue;
    search: for (let r = 0.8; r <= 3.2; r += 0.8) for (let a = 0; a < 8; a++) { const x = q.x + Math.cos(a * Math.PI / 4) * r, z = q.z + Math.sin(a * Math.PI / 4) * r; if (!world.blocked(x, z) && Math.abs(world.groundHeight(x, z) - q.y) < 0.3) { q.x = x; q.z = z; q.y = world.groundHeight(x, z); break search; } }
  }

  // meshes: shared buckets are merged by city.js; these are the outskirts' own (six)
  const dirt = M.T && M.T.dirt;
  const fieldMat = ctx.setupMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: (dirt && dirt.map) || null, normalMap: (dirt && dirt.normalMap) || null, roughness: 1, metalness: 0, envMapIntensity: 0.3, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  const own = [[K.rubble, M.rubble, true], [K.paint, M.painted, true], [K.foliage, M.foliage, true], [K.bark, M.barkOlive, true], [K.cypB, M.cypressBody, true]];
  for (const [b, m, sh] of own) { const mesh = b.mesh(m, sh); if (mesh) { mesh.name = 'outskirts'; ctx.G.add(mesh); } }
  if (K.fields.length) { const mesh = new THREE.Mesh(mergeGeometries(K.fields, false), fieldMat); mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'outskirts fields'; ctx.G.add(mesh); }
  S = null;
}
