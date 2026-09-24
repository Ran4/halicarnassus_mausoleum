// The people of Halicarnassus: a thousand citizens, slaves, vendors, porters, worshippers and water carriers.
//
// Rendering: four InstancedMeshes sharing one material — three detailed archetypes (short chiton / exomis,
// a man wrapped in a himation, a woman in chiton + himation) and a far LOD. The pose is computed per vertex
// from per-instance attributes: iPos (x, y, z, yaw), iAnim (walk phase, stride amplitude, head yaw, scale),
// iAct (action + weight, lean, gesture, seat height), iLook (packed colours, flags + seed); aInfo = (part,
// colour slot, hem weight) per vertex. Every frame only visible people are packed, nearest into the detailed meshes.
//
// Simulation: struct-of-arrays; a nav graph of validated open street edges + free-space nodes in open areas +
// POI spots with A*; a spatial hash for neighbours; people far from the camera are updated less often.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp, TAU } from './util.js';
import { SEA } from './terrain.js';
import { insideWalls } from './city.js';

const N = 1000, CAP_NEAR = 180, LOD_D = 42, PL = 64, HC = 2, HMASK = 8191;
const PT = { PELVIS: 0, TORSO: 1, HEAD: 2, LUA: 3, LFA: 4, RUA: 5, RFA: 6, LTH: 7, LSH: 8, RTH: 9, RSH: 10, SKIRT: 11 };
const SL = { SKIN: 0, HAIR: 1, A: 2, B: 3, LEATHER: 4, AMPHORA: 5, HYDRIA: 6, BASKET: 7, VEIL: 8, BEARD: 9, TOOL: 10, LOWER: 11, EXO: 12, EXOA: 13, EYE: 14, TABLET: 15, JARDOWN: 16 };
const FL = { VEIL: 4, BEARD: 8, CHILD: 16, LONG: 32, PROP: 64 };
const ACT = { NONE: 0, HAMMER: 1, BEND: 2, PRAY: 3, AMPHORA: 4, JAR: 5, BROWSE: 6, VEND: 7, MEND: 8, WRESTLE: 9, WRITE: 10, MOURN: 11 };
const PROP = { NONE: 0, AMPHORA: 1, HYDRIA: 2, BASKET: 3 };
const K = { STREET: 0, AREA: 1, COMMUTE: 2, FOLLOW: 3, KNOT: 4, SOLO: 5, SHOP: 6, VENDOR: 7, CRAFT: 8, PORTER: 9, SIT: 10, PRAY: 11, WATER: 12, ROAD: 13 };
const MD = { IDLE: 0, STREET: 1, PATH: 2, DIRECT: 3, FOLLOW: 4 };

// ---------- clothing & skin (c. 350 BC: undyed wool, linen, ochre, madder, indigo, saffron, walnut brown, grey-green) ----------
const COL = {
  undyed: [0xd3c8ae, 0xcabd9d, 0xbfae8b, 0xd9cfb9, 0xc4b797], white: [0xe2d8c4, 0xdcd1b9, 0xe6dccb],
  dyed: [0xb4863c, 0x8c3a2b, 0x44517a, 0xc99a40, 0x7a5a3c, 0x78826a, 0x9e5a4a, 0x5b4b3e, 0x3e5c58, 0xa86f3a],
  rich: [0x5a3446, 0x2f3e6c, 0x8a302a, 0x2e5a4a], work: [0xa39373, 0x877157, 0x6d604f, 0x898870, 0xb1a283, 0x7a5c40, 0x93846a],
  skinM: [0xb08264, 0x9c6e52, 0xbc8e6e, 0x8c6046, 0xc49c7c, 0x7e583e], skinF: [0xaa7c5c, 0x9e7254, 0xb48664, 0x8e6448, 0xba8e6c],
};

// ---------- figure geometry (rest pose: 1.75 m, feet at y = 0, facing +Z, left side at +X) ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
function place(g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) { return g.applyMatrix4(_m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz))); }
function tag(g, part, slot, w = 0) {
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = part; a[i * 3 + 1] = slot; a[i * 3 + 2] = w; }
  g.setAttribute('aInfo', new THREE.BufferAttribute(a, 3));
  return g;
}
function mkGeo(pos, info, idx) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3)); g.setIndex(idx); g.computeVertexNormals(); return g; }
const ell = (rx, ry, rz, ws, hs, x, y, z, part, slot, thLen = Math.PI, rotX = 0, thStart = 0) => tag(place(new THREE.SphereGeometry(1, ws, hs, 0, TAU, thStart, thLen), x, y, z, rotX, 0, 0, rx, ry, rz), part, slot);
// vertical tube through rings [{y, rx, rz, cz, p(part), s(slot), w, fold}] bottom → top, closed at the top
function rings(list, segs, folds = 0, capTop = true) {
  const pos = [], info = [], idx = [], nr = list.length;
  for (const r of list) for (let j = 0; j < segs; j++) {
    const a = j / segs * TAU, f = 1 + (r.fold || 0) * Math.sin(folds * a + 0.7);
    pos.push(Math.sin(a) * r.rx * f, r.y + (r.ty || 0) * Math.sin(a + 0.6), (r.cz || 0) + Math.cos(a) * r.rz * f); info.push(r.p, r.s, r.w || 0);
  }
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < segs; j++) { const a = i * segs + j, b = i * segs + (j + 1) % segs; idx.push(a, b, a + segs, b, b + segs, a + segs); }
  if (capTop) { const t = list[nr - 1], c = pos.length / 3; pos.push(0, t.y + 0.012, t.cz || 0); info.push(t.p, t.s, 0); for (let j = 0; j < segs; j++) idx.push((nr - 1) * segs + j, (nr - 1) * segs + (j + 1) % segs, c); }
  return mkGeo(pos, info, idx);
}
// tube along a polyline; radius r or [ru, rv]; one part per point; rounded end caps
function chain(pts, radii, parts, slot, segs, caps = true) {   // caps: true | false | 'start' | 'end'
  const pos = [], info = [], idx = [], n = pts.length, P = pts.map(p => new THREE.Vector3(...p));
  const t = new THREE.Vector3(), u = new THREE.Vector3(), v = new THREE.Vector3(), ref = new THREE.Vector3(), T = [];
  for (let i = 0; i < n; i++) {
    t.subVectors(P[Math.min(n - 1, i + 1)], P[Math.max(0, i - 1)]).normalize(); T.push(t.clone());
    ref.set(0, 0, 1); if (Math.abs(t.z) > 0.9) ref.set(1, 0, 0);
    u.crossVectors(t, ref).normalize(); v.crossVectors(u, t).normalize();
    const r = radii[i], ru = Array.isArray(r) ? r[0] : r, rv = Array.isArray(r) ? r[1] : r;
    for (let j = 0; j < segs; j++) { const a = j / segs * TAU, c = Math.cos(a) * ru, s = Math.sin(a) * rv; pos.push(P[i].x + u.x * c + v.x * s, P[i].y + u.y * c + v.y * s, P[i].z + u.z * c + v.z * s); info.push(parts[i], slot, 0); }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++) { const a = i * segs + j, b = i * segs + (j + 1) % segs; idx.push(a, a + segs, b, b, a + segs, b + segs); }
  if (caps) for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
    if ((caps === 'start' && dir > 0) || (caps === 'end' && dir < 0)) continue;
    const r = radii[i], rr = Array.isArray(r) ? Math.min(...r) : r, c = pos.length / 3, base = i * segs;
    pos.push(P[i].x + T[i].x * dir * rr * 0.6, P[i].y + T[i].y * dir * rr * 0.6, P[i].z + T[i].z * dir * rr * 0.6); info.push(parts[i], slot, 0);
    for (let j = 0; j < segs; j++) { const a = base + j, b = base + (j + 1) % segs; if (dir < 0) idx.push(c, a, b); else idx.push(c, b, a); }
  }
  return mkGeo(pos, info, idx);
}
const lathe = (pts, segs) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs);
// a garment layer lying on a body of rings R [{y, rx, rz, cz}]: its columns sit at the ring angles, so it stays parallel to
// the body facets; rows(a) → [y, off] (offset outward) or [y, rx, rz, cz] (explicit ellipse), bottom → top
function surfAt(R, y, a, off) {
  let i = 0; while (i < R.length - 2 && y > R[i + 1].y) i++;
  const r0 = R[i], r1 = R[i + 1], t = clamp((y - r0.y) / (r1.y - r0.y), 0, 1);
  return [Math.sin(a) * (lerp(r0.rx, r1.rx, t) + off), y, lerp(r0.cz || 0, r1.cz || 0, t) + Math.cos(a) * (lerp(r0.rz, r1.rz, t) + off)];
}
function sheet(R, rows, segs, part, slot) {
  const pos = [], info = [], idx = [];
  for (const row of rows) for (let j = 0; j < segs; j++) { const a = j / segs * TAU, q = row(a); pos.push(...(q.length > 2 ? [Math.sin(a) * q[1], q[0], (q[3] || 0) + Math.cos(a) * q[2]] : surfAt(R, q[0], a, q[1]))); info.push(part, slot, 0); }
  for (let i = 0; i < rows.length - 1; i++) for (let j = 0; j < segs; j++) { const a = i * segs + j, b = i * segs + (j + 1) % segs; idx.push(a, b, a + segs, b, b + segs, a + segs); }
  return mkGeo(pos, info, idx);
}

function headParts(L, { beard, female, veil, far }) {
  if (far) { L.push(ell(0.088, 0.108, 0.1, 5, 4, 0, 1.645, 0.006, PT.HEAD, SL.SKIN), ell(0.095, 0.1, 0.106, 5, 2, 0, 1.664, -0.01, PT.HEAD, SL.HAIR, 1.45, -0.5)); return; }
  L.push(ell(0.082, 0.104, 0.095, 7, 5, 0, 1.643, 0.012, PT.HEAD, SL.SKIN));
  L.push(ell(0.09, 0.1, 0.102, 7, 3, 0, 1.662, -0.006, PT.HEAD, SL.HAIR, 1.62, -0.5));
  L.push(tag(place(new THREE.ConeGeometry(0.017, 0.045, 3), 0, 1.632, 0.106, Math.PI / 2 + 0.25), PT.HEAD, SL.SKIN));
  for (const sx of [-1, 1]) L.push(tag(place(new THREE.BoxGeometry(0.03, 0.007, 0.008), sx * 0.034, 1.676, 0.084, 0, sx * 0.5, sx * -0.1), PT.HEAD, SL.HAIR),   // brows
    tag(place(new THREE.BoxGeometry(0.019, 0.016, 0.006), sx * 0.033, 1.657, 0.084, 0, sx * 0.5), PT.HEAD, SL.EYE));   // eyes, sunk into the face
  if (beard) L.push(ell(0.064, 0.058, 0.052, 6, 2, 0, 1.592, 0.046, PT.HEAD, SL.BEARD, Math.PI / 2, 0, Math.PI / 2));
  if (female) L.push(ell(0.042, 0.04, 0.036, 4, 3, 0, 1.628, -0.088, PT.HEAD, SL.HAIR));
  if (veil) {
    L.push(ell(0.105, 0.117, 0.119, 7, 3, 0, 1.656, -0.012, PT.HEAD, SL.VEIL, 1.95, -0.62));
    L.push(chain([[0, 1.64, -0.075], [0, 1.5, -0.125], [0, 1.33, -0.145]], [[0.1, 0.05], [0.168, 0.065], [0.205, 0.055]], [PT.HEAD, PT.TORSO, PT.TORSO], SL.VEIL, 5, false));
  }
}
function armParts(L, { far, mantleL, bareR }) {
  for (const sx of [1, -1]) {
    const UA = sx > 0 ? PT.LUA : PT.RUA, FA = sx > 0 ? PT.LFA : PT.RFA;
    if (far) { L.push(chain([[sx * 0.19, 1.45, 0], [sx * 0.215, 1.15, -0.015], [sx * 0.226, 0.9, 0.02]], [0.052, 0.042, 0.034], [UA, UA, FA], SL.SKIN, 3, false)); continue; }
    // the upper arm starts at the shoulder pivot; a bare (exomis) right shoulder needs its top closed
    L.push(chain([[sx * 0.19, 1.43, -0.005], [sx * 0.215, 1.15, -0.015], [sx * 0.226, 0.925, 0.02]], [0.05, 0.039, 0.03], [UA, UA, FA], SL.SKIN, 6, sx < 0 && bareR ? true : 'end'));
    L.push(ell(0.031, 0.05, 0.025, 4, 3, sx * 0.229, 0.872, 0.026, FA, SL.SKIN));
    const cover = sx > 0 && mantleL, sl = cover ? SL.B : SL.A, t = (1.43 - (cover ? 1.1 : 1.3)) / 0.28;
    // the sleeve runs along the arm's own axis (so the arm cannot poke through it) and is closed by a rounded cap centred on the
    // shoulder pivot, which keeps its shape however far the arm swings
    L.push(chain([[sx * 0.19, 1.43, -0.005], [sx * (0.19 + 0.025 * t), 1.43 - 0.28 * t, -0.005 - 0.01 * t]], [0.058, cover ? 0.053 : 0.054], [UA, UA], sl, 6, false));
    L.push(ell(0.058, 0.034, 0.058, 6, 2, sx * 0.19, 1.43, -0.005, UA, sl, Math.PI / 2));
  }
}
function legParts(L, { top, far }) {
  for (const sx of [1, -1]) {
    const TH = sx > 0 ? PT.LTH : PT.RTH, SH = sx > 0 ? PT.LSH : PT.RSH;
    if (far) { L.push(chain([[sx * 0.095, 0.95, 0], [sx * 0.1, 0.49, 0.015], [sx * 0.1, 0.06, 0.02]], [0.075, 0.05, 0.042], [TH, TH, SH], SL.SKIN, 3, false)); continue; }
    const pts = [], rad = [], parts = [];
    if (top > 0.6) { pts.push([sx * 0.092, top, 0]); rad.push(0.066); parts.push(TH); }
    if (top > 0.45) { pts.push([sx * 0.1, 0.49, 0.015]); rad.push(0.051); parts.push(TH); }
    pts.push([sx * 0.1, 0.31, -0.008], [sx * 0.1, 0.085, -0.008]); rad.push(0.047, 0.034); parts.push(SH, SH);
    L.push(chain(pts, rad, parts, SL.SKIN, 5, 'end'));
    L.push(tag(place(new THREE.BoxGeometry(0.086, 0.06, 0.235), sx * 0.1, 0.03, 0.045), SH, SL.LEATHER, top < 0.45 ? 1 : 0));   // (w: under an ankle-length skirt)
  }
}
function propParts(L, { amphora, hydria, basket, tool, tablet, far }) {
  const sg = far ? 4 : 6;
  // the amphora lies on the left shoulder behind the head, its neck forward, a little down and outward where the hand holds it
  if (amphora) L.push(tag(place(lathe((far ? [[0.001, -0.33], [0.12, -0.1], [0.11, 0.13], [0.04, 0.3], [0.001, 0.32]] : [[0.001, -0.33], [0.11, -0.13], [0.13, 0], [0.1, 0.14], [0.04, 0.24], [0.058, 0.315], [0.001, 0.32]]).map(([r, y]) => [r * 0.85, y]), sg), 0.26, 1.56, -0.19, 1.8, 0, -0.4), PT.TORSO, SL.AMPHORA));
  if (hydria) L.push(tag(place(lathe(far ? [[0.001, 0], [0.13, 0.08], [0.11, 0.21], [0.05, 0.33], [0.001, 0.345]] : [[0.001, 0], [0.1, 0.02], [0.13, 0.12], [0.1, 0.23], [0.045, 0.3], [0.06, 0.345], [0.001, 0.345]], sg), 0, 1.742, -0.005), PT.HEAD, SL.HYDRIA));
  if (hydria && !far) L.push(tag(place(lathe([[0.001, 0], [0.1, 0.02], [0.13, 0.12], [0.1, 0.23], [0.045, 0.3], [0.06, 0.345], [0.001, 0.345]], sg), 0.34, 0.0, 0.16), PT.PELVIS, SL.JARDOWN));   // (set down beside her at the spout)
  if (basket) L.push(tag(place(lathe([[0.001, 0], [0.09, 0.005], [0.126, 0.15], [0.001, 0.15]], sg), -0.236, 0.68, 0.03), PT.RFA, SL.BASKET));
  if (tablet) L.push(tag(place(new THREE.BoxGeometry(0.15, 0.2, 0.014), 0.232, 0.93, 0.058), PT.LFA, SL.TABLET));   // a writing tablet on the palm
  if (tool) L.push(tag(place(new THREE.BoxGeometry(0.03, 0.03, 0.34), -0.229, 0.868, 0.18), PT.RFA, SL.TOOL), tag(place(new THREE.BoxGeometry(0.05, 0.1, 0.055), -0.229, 0.868, 0.33), PT.RFA, SL.TOOL));
}
// kind: 0 short chiton / exomis, 1 man in a himation, 2 woman in chiton + himation, 3 far LOD, 4 the carried things (drawn only for those who carry)
function figureGeometry(kind) {
  const L = [], A = SL.A, B = SL.B;
  if (kind === 4) propParts(L, { amphora: true, hydria: true, basket: true, tool: true, tablet: true });
  else if (kind === 3) {
    L.push(rings([
      { y: 0.6, rx: 0.205, rz: 0.155, p: PT.SKIRT, s: SL.LOWER, w: 1 }, { y: 0.92, rx: 0.18, rz: 0.13, p: PT.PELVIS, s: SL.LOWER },
      { y: 1.08, rx: 0.155, rz: 0.11, p: PT.TORSO, s: A }, { y: 1.42, rx: 0.2, rz: 0.11, p: PT.TORSO, s: A }, { y: 1.5, rx: 0.07, rz: 0.06, p: PT.TORSO, s: A },
    ], 6));
    headParts(L, { far: true }); armParts(L, { far: true }); legParts(L, { far: true }); propParts(L, { amphora: true, hydria: true, far: true });
  } else {
    const T0 = [{ y: 1.05, rx: 0.155, rz: 0.112 }, { y: 1.29, rx: 0.176, rz: 0.122, cz: 0.012 }, { y: 1.425, rx: 0.2, rz: 0.108 }, { y: 1.49, rx: 0.085, rz: 0.066 }];
    const T1 = [{ y: 1.13, rx: 0.153, rz: 0.108 }, ...T0.slice(1)];
    const T2 = [{ y: 1.1, rx: 0.145, rz: 0.105 }, { y: 1.28, rx: 0.163, rz: 0.125, cz: 0.015 }, { y: 1.41, rx: 0.186, rz: 0.105 }, { y: 1.47, rx: 0.084, rz: 0.064 }];
    const ring = (T, i, o) => ({ ...T[i], p: PT.TORSO, s: A, ...o });
    if (kind === 0) L.push(rings([
      { y: 0.6, rx: 0.165, rz: 0.12, p: PT.SKIRT, s: A, w: 1 }, { y: 0.6, rx: 0.212, rz: 0.158, p: PT.SKIRT, s: A, w: 1, fold: 0.07 },
      { y: 0.77, rx: 0.198, rz: 0.148, p: PT.SKIRT, s: A, w: 0.45, fold: 0.05 }, { y: 0.91, rx: 0.172, rz: 0.13, p: PT.PELVIS, s: A, fold: 0.02 },
      { y: 1.01, rx: 0.155, rz: 0.112, p: PT.TORSO, s: A }, { y: 1.01, rx: 0.159, rz: 0.116, p: PT.TORSO, s: SL.LEATHER },
      { y: 1.05, rx: 0.159, rz: 0.116, p: PT.TORSO, s: SL.LEATHER }, ring(T0, 0), ring(T0, 1), ring(T0, 2), ring(T0, 3),
    ], 9, 9));
    if (kind === 1) L.push(rings([
      { y: 0.36, rx: 0.17, rz: 0.13, p: PT.SKIRT, s: B, w: 1, ty: 0.05 }, { y: 0.36, rx: 0.228, rz: 0.178, p: PT.SKIRT, s: B, w: 1, fold: 0.08, ty: 0.05 },
      { y: 0.47, rx: 0.228, rz: 0.176, p: PT.SKIRT, s: B, w: 0.8, fold: 0.07 }, { y: 0.58, rx: 0.226, rz: 0.172, p: PT.SKIRT, s: B, w: 0.62, fold: 0.06 }, { y: 0.8, rx: 0.207, rz: 0.157, p: PT.SKIRT, s: B, w: 0.2, fold: 0.045 },
      { y: 0.95, rx: 0.186, rz: 0.142, p: PT.PELVIS, s: B, fold: 0.03 }, { y: 1.13, rx: 0.172, rz: 0.128, p: PT.TORSO, s: B, fold: 0.02, ty: 0.06 },
      ring(T1, 0, { ty: 0.06 }), ring(T1, 1), ring(T1, 2), ring(T1, 3),
    ], 9, 7));
    if (kind === 2) L.push(rings([
      { y: 0.04, rx: 0.2, rz: 0.16, p: PT.SKIRT, s: A, w: 1 }, { y: 0.04, rx: 0.265, rz: 0.215, p: PT.SKIRT, s: A, w: 1, fold: 0.1 },
      { y: 0.26, rx: 0.235, rz: 0.185, p: PT.SKIRT, s: A, w: 0.8, fold: 0.08 }, { y: 0.5, rx: 0.21, rz: 0.163, p: PT.SKIRT, s: A, w: 0.6, fold: 0.05, ty: 0.05 },
      { y: 0.5, rx: 0.238, rz: 0.188, p: PT.SKIRT, s: B, w: 0.6, fold: 0.07, ty: 0.05 }, { y: 0.8, rx: 0.212, rz: 0.162, p: PT.SKIRT, s: B, w: 0.2, fold: 0.05 },
      { y: 0.95, rx: 0.19, rz: 0.145, p: PT.PELVIS, s: B, fold: 0.02 }, { y: 1.1, rx: 0.165, rz: 0.125, p: PT.TORSO, s: B, ty: 0.05 },
      ring(T2, 0, { ty: 0.05 }), ring(T2, 1), ring(T2, 2), ring(T2, 3),
    ], 9, 11));
    // the himation: a mantle wrapped round the body, its rolled upper edge running from under the right arm over the left shoulder
    if (kind > 0) {
      const T = kind === 1 ? T1 : T2, [y0, ty, bx, bz, fo] = kind === 1 ? [1.13, 0.06, 0.172, 0.128, 0.02] : [1.1, 0.05, 0.165, 0.125, 0];
      const top = T[3].y - 0.006, fold = a => Math.min(top - 0.022, (kind === 1 ? 1.295 : 1.275) + (kind === 1 ? 0.165 : 0.16) * Math.sin(a));
      const yb = a => y0 + ty * Math.sin(a + 0.6), fa = a => 1 + fo * Math.sin(7 * a + 0.7);
      L.push(sheet(T, [a => [yb(a), bx * fa(a) + 0.004, bz * fa(a) + 0.004], a => [Math.max(yb(a), Math.min(T[1].y, fold(a))), 0.016], a => [Math.max(yb(a), Math.min(T[2].y, fold(a))), 0.016],
        a => [Math.max(yb(a), fold(a)), 0.032], a => [Math.max(yb(a), fold(a)) + 0.022, 0.006]], 9, PT.TORSO, B));
    }
    // exomis: the right shoulder and chest bare (skin layer shown only with the exomis flag)
    if (kind === 0) {
      const e = a => Math.min(1.49, 1.36 + 0.14 * Math.sin(a)), open = a => clamp((1.485 - e(a)) / 0.03, 0, 1);
      L.push(sheet(T0, [a => [e(a), 0.004], a => [Math.max(e(a), 1.29), 0.006], a => [Math.max(e(a), 1.425), 0.006], a => [1.49, 0.006], a => [lerp(1.49, 1.503, open(a)), lerp(0.091, 0.056, open(a)), lerp(0.072, 0.056, open(a)), 0.004 * open(a)]], 9, PT.TORSO, SL.EXO));
      L.push(sheet(T0, [a => [e(a) - 0.03, 0.002], a => [e(a) - 0.004, 0.013], a => [e(a), 0.003]], 9, PT.TORSO, SL.EXOA));
    }
    L.push(chain([[0, 1.42, 0], [0, 1.575, 0.01]], [0.052, 0.045], [PT.TORSO, PT.HEAD], SL.SKIN, 6, false));
    headParts(L, { beard: kind !== 2, female: kind === 2, veil: kind === 2 });
    armParts(L, { mantleL: kind > 0, bareR: kind === 0 });   // the himation covers the left shoulder and upper arm
    legParts(L, { top: kind === 0 ? 0.95 : kind === 1 ? 0.52 : 0.3 });
  }
  return mergeGeometries(L, false);
}

// ---------- the animated shader (shared by the lit, shadow-depth and GTAO-normal materials) ----------
const GLSL = /* glsl */`
attribute vec3 aInfo; attribute vec4 iPos; attribute vec4 iAnim; attribute vec4 iAct; attribute vec4 iLook;
uniform float uTime;
vec3 pRX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c + v.z * s, -v.y * s + v.z * c); }
vec3 pRZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
vec3 pRY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
float pBit(float f, float b) { return mod(floor(f / b), 2.0); }
// q: x swings the arm forward, y raises it sideways, z bends the elbow, w turns it in across the body
void pArm(inout vec3 p, inout vec3 n, float sx, bool fore, vec4 q) {
  vec3 S = vec3(sx * 0.19, 1.43, 0.0);
  if (fore) { vec3 E = vec3(sx * 0.215, 1.15, -0.015); p = E + pRX(p - E, q.z); n = pRX(n, q.z); }
  p = S + pRY(pRZ(pRX(p - S, q.x), sx * q.y), -sx * q.w); n = pRY(pRZ(pRX(n, q.x), sx * q.y), -sx * q.w);
}
void pLeg(inout vec3 p, inout vec3 n, float sx, bool shin, float th, float fl) {
  vec3 H = vec3(sx * 0.095, 0.93, 0.0);
  if (shin) { vec3 Kn = vec3(sx * 0.1, 0.49, 0.015); p = Kn + pRX(p - Kn, -fl); n = pRX(n, -fl); }
  p = H + pRZ(pRX(p - H, th), sx * 0.035); n = pRZ(pRX(n, th), sx * 0.035);
}
// how far back the back of a long skirt must move at depth v below the hips to clear the shin and heel of the leg further back
float pBackNeed(float v, float thL, float fL, float thR, float fR) {
  float va = min(v, 0.44), vb = max(0.0, v - 0.44), sL = thL - fL, sR = thR - fR;
  float bk = min(tan(max(thL, -1.0)) * va + tan(max(sL, -1.1)) * vb, tan(max(thR, -1.0)) * va + tan(max(sR, -1.1)) * vb) - mix(0.05, 0.13, smoothstep(0.55, 0.85, v)) - 0.05 + 0.16;
  return 0.5 * (bk - sqrt(bk * bk + 0.0016));
}
vec3 pUn(float c) { vec3 k = vec3(floor(c / 65536.0), mod(floor(c / 256.0), 256.0), mod(c, 256.0)) / 255.0; return pow(k, vec3(2.2)); }
vec3 pColor() {
  float slot = aInfo.y, fl = floor(iLook.w), hair = mod(fl, 4.0);
  if (slot == 0.0) return pUn(iLook.z);
  if (slot == 9.0) return mix(hair < 0.5 ? vec3(0.02, 0.014, 0.01) : hair < 1.5 ? vec3(0.035, 0.022, 0.013) : hair < 2.5 ? vec3(0.07, 0.045, 0.026) : vec3(0.22, 0.2, 0.18), pUn(iLook.z), 0.12);
  if (slot == 1.0) return hair < 0.5 ? vec3(0.012, 0.009, 0.007) : hair < 1.5 ? vec3(0.03, 0.018, 0.011) : hair < 2.5 ? vec3(0.06, 0.037, 0.022) : vec3(0.24, 0.22, 0.2);
  if (slot == 2.0) return pUn(iLook.x);
  if (slot == 3.0 || slot == 8.0) return pUn(iLook.y);
  if (slot == 4.0) return vec3(0.085, 0.048, 0.027);
  if (slot == 5.0) return vec3(0.3, 0.1, 0.04);
  if (slot == 6.0) return vec3(0.24, 0.075, 0.03);
  if (slot == 7.0) return vec3(0.34, 0.25, 0.12);
  if (slot == 10.0) return vec3(0.1, 0.07, 0.045);
  if (slot == 12.0) return pUn(iLook.z);
  if (slot == 13.0) return pUn(iLook.x);
  if (slot == 14.0) return vec3(0.016, 0.01, 0.007);
  if (slot == 15.0) return vec3(0.2, 0.13, 0.06);
  if (slot == 16.0) return vec3(0.24, 0.075, 0.03);
  return mix(pUn(iLook.x), pUn(iLook.y), pBit(fl, 32.0));
}
void pAnimate(inout vec3 p, inout vec3 n) {
  float part = aInfo.x, slot = aInfo.y, fl = floor(iLook.w), seed = fract(iLook.w);
  float act = floor(iAct.x), actW = min(1.0, fract(iAct.x) * 1.0102), prop = mod(floor(fl / 64.0), 4.0), longF = pBit(fl, 32.0), exo = pBit(fl, 256.0);
  if ((slot >= 12.0 && slot < 14.0 && exo < 0.5) || (slot == 2.0 && part == 5.0 && exo > 0.5) || (slot == 5.0 && prop != 1.0) || (slot == 6.0 && prop != 2.0) || (slot == 7.0 && prop != 3.0) || (slot == 8.0 && pBit(fl, 4.0) < 0.5) || (slot == 9.0 && pBit(fl, 8.0) < 0.5) || (slot == 10.0 && act != 1.0) || (slot == 15.0 && act != 10.0) || (slot == 16.0 && (prop != 2.0 || act != 2.0 || actW < 0.5)) || (slot == 6.0 && act == 2.0 && actW >= 0.5)) { p = vec3(0.0, -3000.0, 0.0); return; }
  float ph = iAnim.x, A = iAnim.y, hy = iAnim.z, sc = iAnim.w;
  float lean = iAct.y, gest = iAct.z, sitH = iAct.w, sit = step(0.001, sitH), t = uTime + seed * 97.0;
  float sp = sin(ph), cp = cos(ph);
  float idle = (1.0 - smoothstep(0.03, 0.15, A)) * (1.0 - sit), ws = sin(t * 0.41) * idle;
  float thL = A * sp, thR = -thL, cL = max(0.0, cp), cR = max(0.0, -cp);
  float lift = mix(1.7, 1.1, longF), fL = A * (0.25 + lift * cL * cL) + 0.16 * max(0.0, ws), fR = A * (0.25 + lift * cR * cR) + 0.16 * max(0.0, -ws);
  // in a long garment the trailing leg barely extends at the hip; it bends at the knee instead, so the heel stays under the cloth
  if (longF > 0.5) { float eL = max(0.0, -0.19 - thL), eR = max(0.0, -0.19 - thR); thL += eL; thR += eR; fL += 0.9 * eL; fR += 0.9 * eR; }
  float hp = 0.93, ku = 0.0;
  if (sit > 0.5) {
    hp = sitH / sc + 0.1;   // the seat height is in metres, the pose in unscaled figure units
    // on the ground: legs stretched out (always for someone with work in the lap) or knees drawn up and hugged
    float low = step(sitH, 0.15), lo = low * max(step(0.5, fract(seed * 7.3)), float(act == 8.0));
    ku = low * (1.0 - lo);
    // (knees up: the feet set well forward, so the knees stay low and out in front of the chest)
    float tilt = mix(0.12, 0.4, ku), e = max(0.0, asin(clamp((0.44 * cos(tilt) + 0.06 - hp) / 0.44, -1.0, 0.97)));
    thL = mix(1.5708 + e, 1.42, lo); thR = thL - 0.07; fL = mix(thL - tilt, 0.1, lo); fR = fL + 0.12;
  }
  float lean2 = lean + 0.05 * A, hp2 = 0.0;
  float run = smoothstep(0.5, 0.6, A);   // (a stride this long is a run: elbows bent, the body leaning into it)
  vec4 aL = vec4(0.04 - 1.1 * A * sp, 0.09, mix(0.22 + 0.5 * A, 1.5, run), 0.0), aR = vec4(0.04 + 1.1 * A * sp, 0.09, mix(0.22 + 0.5 * A, 1.5, run), 0.0); lean2 += 0.14 * run;
  if (sit > 0.5) {
    float v = fract(seed * 13.7); aL = vec4(0.3, 0.05, 0.5, 0.0); aR = vec4(0.32, 0.05, 0.48, 0.0);
    if (v < 0.3) aL = vec4(0.68, 0.02, 0.12, 0.0); else if (v < 0.55) aR = vec4(0.04, 0.2, 0.06, 0.0); else if (v < 0.7) { aL = vec4(0.66, 0.02, 0.14, 0.0); aR = vec4(0.04, 0.2, 0.06, 0.0); }
    // knees up: the arms round the shins, hands clasped in front of them (or one hand laid on its knee)
    if (ku > 0.5) { aL = vec4(0.35, 0.75, 1.0, 0.9); aR = vec4(0.3, 0.72, 1.05, 0.95); if (v < 0.35) aR = vec4(0.35, 0.55, 1.9, 0.5); lean2 -= 0.07; }
    lean2 += 0.12;
  }
  aR = mix(aR, vec4(0.5 + 0.22 * sin(t * 2.3), 0.22, 1.2 + 0.35 * sin(t * 3.1), 0.0), gest);
  if (act > 0.5) {
    vec4 tL = aL, tR = aR; float tl = 0.0, th2 = 0.0;
    if (act == 1.0) { float u = fract(t * 0.85), h = u < 0.7 ? smoothstep(0.0, 0.7, u) : 1.0 - smoothstep(0.7, 0.8, u); tR = vec4(0.55 + 1.7 * h, 0.12, 0.3 + 1.1 * h, 0.0); tL = vec4(0.85, 0.05, 0.6, 0.0); tl = 0.4; th2 = 0.35; }
    else if (act == 2.0) { float b = 0.5 + 0.5 * sin(t * 0.7); tl = 0.35 + 0.6 * b; tL = vec4(0.3 + tl, 0.08, 0.35, 0.0); tR = vec4(0.35 + tl, 0.1, 0.3, 0.0); th2 = 0.25; fL += 0.4 * b * actW; fR += 0.35 * b * actW; }
    else if (act == 3.0) { float s2 = 0.08 * sin(t * 0.5); tL = vec4(1.95 + s2, 0.34, 0.3, 0.0); tR = tL; tl = -0.06; th2 = -0.3; }
    else if (act == 4.0) { tL = vec4(1.3, -0.75, 2.2, -0.8); th2 = 0.08; }   // the hand round the neck of the jar on the left shoulder
    else if (act == 5.0) { tR = vec4(2.55, -0.12, 1.35, 0.0); }
    else if (act == 6.0) { tR = vec4(0.85 + 0.2 * sin(t * 0.9), 0.05, 0.75, 0.0); tl = 0.12; th2 = 0.3; }
    else if (act == 7.0) { tL = vec4(0.55, 0.12, 1.25, 0.0); tR = vec4(0.6 + 0.25 * sin(t * 1.7), 0.18, 1.1 + 0.2 * sin(t * 2.3), 0.0); }
    else if (act == 9.0) { float w2 = sin(t * 1.7), w3 = sin(t * 2.9); tL = vec4(1.2 + 0.18 * w2, 0.3, 0.8 + 0.2 * w3, 0.45); tR = vec4(1.2 - 0.18 * w2, 0.3, 0.8 - 0.2 * w3, 0.45); tl = 0.45 + 0.06 * w3; thL += 0.24 * actW; thR -= 0.2 * actW; }   // grappling: arms locked with the partner's, a staggered stance
    else if (act == 8.0) { tL = vec4(0.9, 0.0, 1.15 + 0.15 * sin(t * 2.1), 0.0); tR = vec4(0.92, 0.0, 1.2 + 0.15 * sin(t * 2.1 + 1.3), 0.0); tl = 0.25; th2 = 0.45; }
    else if (act == 10.0) { float wr = sin(t * 5.3) * 0.06; tL = vec4(0.55, 0.14, 1.45, 0.45); tR = vec4(0.62 + wr, 0.04, 1.5, 0.62 + wr); tl = 0.12; th2 = 0.5; }   // a tablet on the left forearm, the right hand writing on it
    else if (act == 11.0) { float s3 = 0.04 * sin(t * 0.6); tR = vec4(2.05 + s3, 0.25, 2.35, 0.55); tL = vec4(0.18, 0.02, 0.35, 0.3); tl = 0.1; th2 = 0.38; }   // mourning: head bowed, a hand raised to the brow
    aL = mix(aL, tL, actW); aR = mix(aR, tR, actW); lean2 += tl * actW; hp2 = th2 * actW;
  }
  if (part == 2.0) {
    vec3 NK = vec3(0.0, 1.5, 0.0);
    if (pBit(fl, 16.0) > 0.5) p = NK + (p - NK) * 1.3;
    float hp3 = hp2 + gest * 0.05 * sin(t * 2.9);
    p = NK + pRY(pRX(p - NK, -hp3), hy); n = pRY(pRX(n, -hp3), hy);
  } else if (part == 3.0 || part == 4.0) pArm(p, n, 1.0, part == 4.0, aL);
  else if (part == 5.0 || part == 6.0) pArm(p, n, -1.0, part == 6.0, aR);
  else if (part == 7.0 || part == 8.0) { if (part == 7.0) p.x += 0.018 * ws * clamp((p.y - 0.49) / 0.44, 0.0, 1.0); if (slot == 4.0) p.yz -= vec2(0.01, 0.02) * longF; pLeg(p, n, 1.0, part == 8.0, thL, fL); if (slot == 4.0 && aInfo.z > 0.5 && sit < 0.5) p.z = max(p.z, pBackNeed(max(0.0, 0.93 - p.y), thL, fL, thR, fR) - 0.11); }
  else if (part == 9.0 || part == 10.0) { if (part == 9.0) p.x += 0.018 * ws * clamp((p.y - 0.49) / 0.44, 0.0, 1.0); if (slot == 4.0) p.yz -= vec2(0.01, 0.02) * longF; pLeg(p, n, -1.0, part == 10.0, thR, fR); if (slot == 4.0 && aInfo.z > 0.5 && sit < 0.5) p.z = max(p.z, pBackNeed(max(0.0, 0.93 - p.y), thL, fL, thR, fR) - 0.11); }   // a heel never leaves the skirt
  else if (part == 0.0 && sit > 0.5) { float w = smoothstep(-0.02, 0.12, p.z) * (1.0 - 0.55 * ku); vec3 H = vec3(0.0, 0.93, 0.0); p = H + pRX(p - H, thL * 0.5 * w); n = pRX(n, thL * 0.5 * w); }
  else if (part == 11.0) {
    if (slot == 11.0) { p.y = 0.92 - (0.92 - p.y) * mix(1.0, 2.62, longF); p.xz *= mix(1.0, 1.12, longF * aInfo.z); }
    float s = smoothstep(-0.12, 0.12, p.x), kt = smoothstep(0.56, 0.42, p.y);
    if (ku > 0.5) {
      // knees drawn up on the ground: in front the cloth lies over the thighs and falls down the shins (a tent to the feet in a
      // long garment); behind it drops onto the ground and runs forward under the thighs; the sides hang between the two
      float v = max(0.0, 0.93 - p.y), th = mix(thR, thL, s), aS = th - mix(fR, fL, s), e2 = th - 1.5708, yg = 0.945 - hp, d0 = 0.93 - yg;
      vec3 nT = vec3(0.0, cos(e2), -sin(e2)), nS = vec3(0.0, sin(aS), cos(aS)), nk = normalize(mix(nT, nS, smoothstep(0.36, 0.52, v)));
      vec3 F = vec3(p.x * 0.85, 0.93, 0.0) + vec3(0.0, sin(e2), cos(e2)) * min(v, 0.44) + vec3(0.0, -cos(aS), sin(aS)) * clamp(v - 0.44, 0.0, 0.46) + nk * (0.04 + 0.2 * abs(p.z));
      F.y = max(F.y, yg + 0.01); F.z = max(F.z, 0.14 * smoothstep(1.3, 1.12, F.y));   // (the cloth leaves the body in front of the belly, not inside it)
      if (longF < 0.5) F = mix(F, vec3(p.x * 0.85, max(0.93 - v * 0.9, yg + 0.01), 0.15 + max(0.0, v - d0) * 0.9), 1.0 - smoothstep(0.03, 0.09, abs(p.x)));   // a short chiton falls between the thighs
      vec3 Bk = v < d0 ? vec3(p.x, 0.93 - v, p.z) : vec3(p.x, yg, min(p.z + v - d0, F.z - 0.04));
      float wf = smoothstep(-0.3, 0.5, p.z / (length(p.xz) + 1e-4));
      n = normalize(mix(vec3(p.x * 4.0, 0.6, min(p.z, 0.0) * 4.0), nk + vec3(p.x * 3.0, 0.0, 0.0), wf));
      p = mix(Bk, F, wf);
    } else if (sit > 0.5) {
      // seated drape: the cloth follows the thighs (and the shins below the knee), its front laid thin over the lap,
      // its back pulled onto the thigh undersides and the calves, narrowing towards the hem so it hugs the legs
      float th = mix(thR, thL, s), f = mix(fR, fL, s) * kt, zr = p.z - 0.015 * kt;
      n = zr > 0.07 ? normalize(vec3(n.x, n.y, n.z * 2.0)) : zr < -0.068 ? normalize(mix(n, vec3(0.0, 0.0, -1.0), 0.8)) : n;
      zr = zr > 0.07 ? 0.08 + (zr - 0.08) * 0.35 + 0.022 * sin(3.1416 * kt) - 0.045 * max(0.0, 1.0 - abs(p.x) / 0.11) * smoothstep(0.64, 0.54, p.y) : max(zr, -0.068);
      p.x *= mix(1.0, 0.86, smoothstep(0.78, 0.45, p.y)); p.z = zr + 0.015 * kt;
      vec3 Kn = vec3(p.x, 0.49, 0.015), H = vec3(0.0, 0.93, 0.0);
      p = Kn + pRX(p - Kn, -f); p = H + pRX(p - H, th); n = pRX(pRX(n, -f), th);
    } else {
      // walking: the skirt is pushed as a bell by whichever leg is in front (behind), not split between them
      float v = max(0.0, 0.93 - p.y), va = min(v, 0.44), vb = max(0.0, v - 0.44);
      float dL = sin(thL) * va + sin(thL - fL * 0.8) * vb, dR = sin(thR) * va + sin(thR - fR * 0.8) * vb;
      // the front hem also clears the toes of the leading foot, the back hem the heel of the trailing one
      float kz = p.z / (abs(p.z) + 0.06), lead = dL > dR ? 1.0 : -1.0, toe = 0.22 * A * smoothstep(0.62, 0.8, v);
      float wF = 1.0 - smoothstep(0.05, 0.14, abs(p.x - lead * 0.1)), wB = 1.0 - smoothstep(0.05, 0.14, abs(p.x + lead * 0.1));
      // the front panel is pushed out over the leading leg only, the back over the trailing one; between the legs the cloth
      // keeps to the mean of the two, so the hem tilts with the stride instead of swinging out as one stiff bell
      float lat = smoothstep(-0.2, 0.2, p.x * lead), dm = 0.5 * (dL + dR);
      float ext = kz > 0.0 ? mix(dm, max(dL, dR) + 0.02 * A * v, lat) + toe * wF : mix(min(dL, dR) - 0.03 * A * v, dm, lat) - toe * 0.25 * wB;
      float dz = mix(mix(dR, dL, s), ext, smoothstep(0.1, 0.75, abs(kz)) * mix(0.6, 1.0, longF));
      dz = clamp(dz, -0.08 - 0.4 * max(0.0, A - 0.28) * wB - 0.1 * (1.0 - smoothstep(0.06, 0.2, A)), 0.10 + 0.07 * wF);   // standing and bending, the heels may push the back out further
      if (longF > 0.5 && p.z < 0.0) {
        // the back of a long skirt hangs over the heel of whichever leg is further back: the whole back panel moves by one amount at
        // each height (so the cloth layers keep their order), just enough to clear that shin and heel, fading out towards the sides
        float need = pBackNeed(v, thL, fL, thR, fR), wb = smoothstep(0.05, 0.55, -p.z / (length(vec2(p.x * 0.8, p.z)) + 1e-4));
        dz = mix(dz, min(dz, need), wb);
      }
      float ta = mix(thR, thL, s);
      p.y += v * (1.0 - cos(ta)) * 0.5; p.z += dz;
    }
  }
  vec3 HP = vec3(0.0, 0.95, 0.0), NKl = vec3(0.0, 1.5, 0.0);
  if (part >= 1.0 && part <= 6.0) { float tw = -0.14 * A * sp; p = HP + pRY(pRX(p - HP, -lean2), tw); n = pRY(pRX(n, -lean2), tw); NKl = HP + pRY(pRX(NKl - HP, -lean2), tw); }
  if (pBit(fl, 16.0) > 0.5) {   // a child: short legs, a shorter and narrower body, a big head (moved down with the neck, not squashed)
    vec3 C = vec3(0.0, 0.93, 0.0), sk = part == 0.0 || part >= 7.0 ? vec3(0.85) : vec3(0.9, 0.88, 0.9);
    if (part == 2.0) p += C + (NKl - C) * sk - NKl; else { p = C + (p - C) * sk; n /= sk; }
    p.y -= 0.1395 * (1.0 - sit);
  }
  if (part <= 6.0 || part == 11.0) p.x += 0.018 * ws;
  p.y += hp - 0.93 - 0.05 * A * sp * sp;
  p = pRY(p * sc, iPos.w) + iPos.xyz; n = pRY(n, iPos.w);
}
`;
function patchMaterial(m, kind, uTime) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL + (kind === 'std' ? 'varying vec3 vPCol;\n' : ''));
    if (kind === 'depth') shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); vec3 pN = vec3(0.0, 1.0, 0.0); pAnimate(transformed, pN);');
    else shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 pP = vec3(position); pAnimate(pP, objectNormal);' + (kind === 'std' ? ' vPCol = pColor();' : ''))
      .replace('#include <begin_vertex>', 'vec3 transformed = pP;');
    if (kind === 'std') shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPCol;').replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vPCol;');
  };
  m.customProgramCacheKey = () => 'people-' + kind;
  return m;
}

// fake POIs for ?peopleTest=1 (what the town features will register in the full build)
function testPois(pois) {
  const add = p => pois.push({ owner: 'peopleTest', ...p });
  for (let i = 0; i < 8; i++) add({ type: 'stall', x: -42 + i * 12, z: 398, ry: Math.PI });
  for (let i = 0; i < 4; i++) add({ type: 'stall', x: 150.5, z: 170 + i * 14, ry: -Math.PI / 2 });
  for (let i = 0; i < 4; i++) add({ type: 'bench', x: -60 + i * 40, z: 431, ry: Math.PI, r: 1 });
  add({ type: 'fountain', x: 60, z: 71, r: 1.4 }); add({ type: 'well', x: 190, z: 180, r: 0.8 });
  add({ type: 'work', x: -100, z: 448.6, ry: 0, note: 'cargo-pickup' }); add({ type: 'work', x: -96, z: 441.8, ry: Math.PI, note: 'cargo-drop' });
  add({ type: 'work', x: 30, z: 448.6, ry: 0, note: 'cargo-pickup' }); add({ type: 'work', x: 40, z: 441.8, ry: Math.PI, note: 'cargo-drop' });
  add({ type: 'work', x: 212, z: 126.5, ry: 0, note: 'smithy' }); add({ type: 'work', x: 100, z: 128, ry: Math.PI, note: 'loom' });
  add({ type: 'shrine', x: 147.5, z: 206, ry: Math.PI / 2, r: 1.2 }); add({ type: 'view', x: -20, z: 447, ry: Math.PI });
}

export function buildPeople(ctx) {
  const { world, layout } = ctx;
  const perf = typeof performance !== 'undefined' ? performance : Date;
  const R = rng(1350), RR = rng(77);
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  // private places (courtyard wells, walled yards) are no use to the public
  const pois = layout.pois.filter(p => !p.private), pubAreas = layout.areas.filter(a => !a.private && !(a.owner === 'residential' && /^(yard|garden|orchard)$/.test(a.name || '')));   // (a house's own yard, garden or orchard is private whether flagged or not)
  if ((qs && qs.has('peopleTest')) || ctx.peopleTest) testPois(pois);
  const gh = (x, z) => world.groundHeight(x, z), blocked = (x, z) => world.blocked(x, z);
  const wrap = a => a - TAU * Math.floor((a + Math.PI) / TAU);
  // an area with a y declares its walking surface (the quay stones stand above the analytic ground towards the water)
  const yAreas = pubAreas.filter(a => typeof a.y === 'number');
  const groundAt = (x, z) => { let y = gh(x, z); for (const a of yAreas) { if (a.y <= y || a.y - y > 1.0) continue; if ((x > a.minX && x < a.maxX && z > a.minZ && z < a.maxZ) || (a.y - y > 0.3 && x > a.minX - 1.6 && x < a.maxX + 1.6 && z > a.minZ - 1.6 && z < a.maxZ + 1.6)) y = a.y; } return y; };
  const tBuild = perf.now();

  function segClear(x0, z0, x1, z1, c = 0.32) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(L / 0.5));
    const qx = L > 0 ? -dz / L * c : 0, qz = L > 0 ? dx / L * c : 0;
    let y0 = gh(x0, z0); if (y0 < SEA + 0.35) return false;
    for (let s = 1; s <= n; s++) {
      const f = s / n, x = x0 + dx * f, z = z0 + dz * f;
      if (blocked(x, z) || blocked(x + qx, z + qz) || blocked(x - qx, z - qz)) return false;
      if (s % 2 === 0 || s === n) { const y = gh(x, z); if (Math.abs(y - y0) > 0.9 || y < SEA + 0.35) return false; y0 = y; }
    }
    return true;
  }
  function standable(x, z, r = 0.3) {
    if (blocked(x, z) || blocked(x + r, z) || blocked(x - r, z) || blocked(x, z + r) || blocked(x, z - r)) return false;
    const y = gh(x, z), e = r + 0.15; if (y < SEA + 0.35) return false;
    return Math.abs(gh(x + e, z) - y) < 0.35 && Math.abs(gh(x - e, z) - y) < 0.35 && Math.abs(gh(x, z + e) - y) < 0.35 && Math.abs(gh(x, z - e) - y) < 0.35;
  }
  // gravel roads and paving sit a few cm above the analytic ground
  const roadSegs = (layout.roads || []).flatMap(r => r.pts.slice(0, -1).map((p, i) => [p[0], p[1], r.pts[i + 1][0], r.pts[i + 1][1], r.width / 2]));
  const pavedAreas = yAreas;
  function surfLift(x, z, y) {
    for (const [x0, z0, x1, z1, hw] of roadSegs) { const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz, t = clamp(((x - x0) * dx + (z - z0) * dz) / l2, 0, 1), ex = x0 + dx * t - x, ez = z0 + dz * t - z; if (ex * ex + ez * ez < hw * hw) return 0.065; }
    for (const a of pavedAreas) if (x > a.minX - 12 && x < a.maxX + 12 && z > a.minZ - 12 && z < a.maxZ + 12 && Math.abs(y - a.y) < 0.03) return 0.05;
    return 0.015;
  }

  // ---------- navigation graph ----------
  const NX = [], NZ = [], NA = [], adj = [];
  const addNode = (x, z, a) => { NX.push(x); NZ.push(z); NA.push(a); adj.push([]); return NX.length - 1; };
  const link = (a, b, half, kind, w = 1) => { if (a !== b) { adj[a].push(b, half, kind, w); adj[b].push(a, half, kind, w); } };
  const sNode = new Map(), streetEdges = [];
  for (const e of layout.edges) {
    if (!e.open || !segClear(e.a.x, e.a.z, e.b.x, e.b.z, 0.3)) continue;
    const laneOk = h => { for (let s = 0.75; s < e.length; s += 1.5) { const f = s / e.length, x = e.a.x + (e.b.x - e.a.x) * f, z = e.a.z + (e.b.z - e.a.z) * f; if (e.axis === 'x' ? blocked(x, z - h) || blocked(x, z + h) : blocked(x - h, z) || blocked(x + h, z)) return false; } return true; };
    let half = Math.max(0.1, e.width / 2 - 0.75);
    while (half > 0.3 && !laneOk(half)) half -= 0.35;
    const nid = ln => { let id = sNode.get(ln.id); if (id === undefined) { id = addNode(ln.x, ln.z, -1); sNode.set(ln.id, id); } return id; };
    const a = nid(e.a), b = nid(e.b);
    link(a, b, Math.max(0.1, half), 0, 0.25 + Math.min(e.houses, 10) / 8 + (e.main ? 1.6 : 0));
    streetEdges.push({ a, b, half: Math.max(0.1, half), main: e.main, axis: e.axis, houses: e.houses, len: e.length, width: e.width, ax: e.a.x, az: e.a.z, bx: e.b.x, bz: e.b.z });
  }
  const nStreetNodes = NX.length;
  const ck = (x, z, c) => Math.floor(x / c) * 65536 + Math.floor(z / c);
  const streetCells = new Set();
  for (const e of streetEdges) for (let s = 0; s <= e.len; s += 1.5) {
    const f = s / e.len, x = lerp(e.ax, e.bx, f), z = lerp(e.az, e.bz, f);
    for (let o = -e.width / 2; o <= e.width / 2; o += 1.5) streetCells.add(e.axis === 'x' ? ck(x, z + o, 3) : ck(x + o, z, 3));
  }
  const nearStreet = (x, z) => streetCells.has(ck(x, z, 3));
  const areaInfo = pubAreas.map((a, ai) => {
    const long = a.maxX - a.minX > a.maxZ - a.minZ; let c = 0;
    for (let i = 0; i < 9; i++) { const f = (i + 0.5) / 9, x = long ? lerp(a.minX, a.maxX, f) : (a.minX + a.maxX) / 2, z = long ? (a.minZ + a.maxZ) / 2 : lerp(a.minZ, a.maxZ, f); if (nearStreet(x, z)) c++; }
    return { a, ai, name: a.name, nodes: [], streetLike: c >= 6 };
  });
  const taken = new Set(), freeIds = [];
  for (const rec of areaInfo) {
    const a = rec.a; if (rec.streetLike || a.maxX - a.minX < 3 || a.maxZ - a.minZ < 3) continue;
    const cx = (a.minX + a.maxX) / 2, cz = (a.minZ + a.maxZ) / 2, m = 14, SP = 6;
    for (let ix = -Math.ceil((cx - a.minX + m) / SP); cx + ix * SP <= a.maxX + m; ix++) for (let iz = -Math.ceil((cz - a.minZ + m) / SP); cz + iz * SP <= a.maxZ + m; iz++) {
      const x = cx + ix * SP, z = cz + iz * SP, inside = x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ, key = ck(x, z, 3.5);
      if (taken.has(key)) { if (inside) { const j = freeIds.find(id => Math.abs(NX[id] - x) < 3.6 && Math.abs(NZ[id] - z) < 3.6); if (j !== undefined && !rec.nodes.includes(j)) rec.nodes.push(j); } continue; }
      if (nearStreet(x, z) || !standable(x, z, 0.45)) continue;
      taken.add(key); const id = addNode(x, z, inside ? rec.ai : -3); freeIds.push(id); if (inside) rec.nodes.push(id);
    }
  }
  const ngrid = new Map(), NG = 10;
  const gridAdd = id => { const k = ck(NX[id], NZ[id], NG); let l = ngrid.get(k); if (!l) ngrid.set(k, l = []); l.push(id); };
  for (let id = 0; id < NX.length; id++) gridAdd(id);
  const around = (x, z, r, fn) => { const c = Math.ceil(r / NG); for (let ox = -c; ox <= c; ox++) for (let oz = -c; oz <= c; oz++) { const l = ngrid.get((Math.floor(x / NG) + ox) * 65536 + Math.floor(z / NG) + oz); if (l) for (const id of l) fn(id); } };
  for (const i of freeIds) around(NX[i], NZ[i], 9, j => { if (j > i && NA[j] !== -1 && Math.hypot(NX[j] - NX[i], NZ[j] - NZ[i]) < 8.6 && segClear(NX[i], NZ[i], NX[j], NZ[j], 0.35)) link(i, j, 0.6, 1); });
  for (let s = 0; s < nStreetNodes; s++) {
    const c = []; around(NX[s], NZ[s], 22, j => { if (NA[j] !== -1) { const d = Math.hypot(NX[j] - NX[s], NZ[j] - NZ[s]); if (d < 22) c.push([d, j]); } });
    c.sort((p, q) => p[0] - q[0]); let made = 0;
    for (const [, j] of c.slice(0, 8)) if (segClear(NX[s], NZ[s], NX[j], NZ[j], 0.35)) { link(s, j, 0.5, 1); if (++made >= 3) break; }
  }
  const seCells = new Map();
  streetEdges.forEach((e, ei) => { for (let s = 0; s <= e.len; s += 8) { const k = ck(lerp(e.ax, e.bx, s / e.len), lerp(e.az, e.bz, s / e.len), 20); let l = seCells.get(k); if (!l) seCells.set(k, l = []); if (!l.includes(ei)) l.push(ei); } });
  // the walkable town is what can be reached from the avenue; a spot elsewhere (a courtyard well, a walled garden) is no use to a walker
  const inMain = [];
  const avE = streetEdges.find(e => e.main && e.axis === 'z' && e.az + e.bz > 130) || streetEdges[0];
  if (avE) { const q = [avE.a]; inMain[avE.a] = 1; for (let h = 0; h < q.length; h++) for (let k = 0; k < adj[q[h]].length; k += 4) { const v = adj[q[h]][k]; if (!inMain[v]) { inMain[v] = 1; q.push(v); } } }
  const mainOk = id => !avE || inMain[id] === 1;
  // a standing spot joins the graph: link to nearby nodes of the walkable town, else to the closest point of a street edge
  function connectSpot(x, z) {
    const id = addNode(x, z, -2), c = [];
    around(x, z, 16, j => { if (mainOk(j)) { const d = Math.hypot(NX[j] - x, NZ[j] - z); if (d < 16) c.push([d, j]); } });
    c.sort((p, q) => p[0] - q[0]); let made = 0;
    for (const [, j] of c.slice(0, 7)) if (segClear(x, z, NX[j], NZ[j], 0.3)) { link(id, j, 0.35, 1); if (++made >= 3) break; }
    if (!made) {
      let best = null;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (const ei of seCells.get((Math.floor(x / 20) + ox) * 65536 + Math.floor(z / 20) + oz) || []) {
        const e = streetEdges[ei], dx = e.bx - e.ax, dz = e.bz - e.az, t = clamp(((x - e.ax) * dx + (z - e.az) * dz) / (e.len * e.len), 0.05, 0.95), qx = e.ax + dx * t, qz = e.az + dz * t, d = Math.hypot(qx - x, qz - z);
        if (d < 14 && mainOk(e.a) && (!best || d < best.d)) best = { d, qx, qz, e };
      }
      if (best && segClear(x, z, best.qx, best.qz, 0.3)) { const mid = addNode(best.qx, best.qz, -1); inMain[mid] = 1; gridAdd(mid); link(mid, best.e.a, best.e.half, 0, 1); link(mid, best.e.b, best.e.half, 0, 1); link(id, mid, 0.35, 1); made = 1; }
    }
    if (!made) return -1;   // not linked to the town: stays out of the grid, so nobody plans from it
    inMain[id] = 1; gridAdd(id);
    return id;
  }

  // ---------- people (struct of arrays) ----------
  const f32 = () => new Float32Array(N), f64 = () => new Float64Array(N), i32 = (v = 0) => new Int32Array(N).fill(v), u8 = () => new Uint8Array(N);
  const px = f64(), pz = f64(), py = f32(), yaw = f32(), faceYaw = f32(), baseYaw = f32(), spd = f32(), vpref = f32(), phase = f32(), gait = f32(), headA = f32(), headT = f32();
  const act = u8(), nextAct = i32(-1), actW = f32(), actWT = f32(), workAct = u8(), lean = f32(), gest = f32(), gestT = f32(), sitH = f32(), sc = f32(), lift = f32();
  const arch = u8(), flagsB = u8(), exoB = u8(), prop = u8(), colA = f32(), colB = f32(), skin = f32(), seedP = f32();
  const kind = u8(), mode = u8(), st = u8(), timer = f32(), lastT = f32(), laneF = f32(), segHalf = f32(), turnK = f32(), slowK = f32();
  const tgx = f64(), tgz = f64(), tgYaw = f32(), pIdx = i32(), pLen = i32(), pFinal = u8(), goal = i32(-1), path = new Int32Array(N * PL);
  const gRX = f64(), gRZ = f64(), gDX = f32(), gDZ = f32(), gY = f32(), gSl = f32();
  const hx0 = f32(), hx1 = f32(), hz0 = f32(), hz1 = f32(), homeA = i32(-1), nodeA = i32(-1), nodeB = i32(-1), spotI = i32(-1), onSeat = u8();
  const dX = f64(), dZ = f64(), dYaw = f32(), failN = u8(), waitT = f32();
  const procT = i32(-1), procK = u8(), rLo = i32(0), rHi = i32(1 << 30);   // (a funeral procession: which one, and the place in its file; rLo..rHi: the stretch of its route a traveller keeps to)
  const orator = u8(), runner = u8(), frozen = u8(), tether = u8(), partner = i32(-1), sideS = f32(), grp = i32(-1), blockT = f32(), stuckT = f32(), stuckN = u8(), sX = f64(), sZ = f64(), curious = u8(), lookP = u8(), talkT = f32();   // talkT: seconds left of a line someone is saying aloud (src/life/chatter.js)
  let n = 0;
  const stages = [], mark = nm => stages.push(nm + ' ' + n);   // (how many are placed after each pass, for debug())
  const occ = new Map();
  const roomFor = (x, z, r = 0.62) => { for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) { const l = occ.get((Math.floor(x) + ox) * 65536 + Math.floor(z) + oz); if (l) for (const j of l) if ((px[j] - x) ** 2 + (pz[j] - z) ** 2 < r * r) return false; } return true; };
  const trySpot = (x, z, r = 0.3, room = 0.62) => standable(x, z, r) && roomFor(x, z, room);
  const P_near = (x, z, r) => !roomFor(x, z, r);   // (anyone placed within r)
  const pick = a => a[Math.floor(R() * a.length)];
  function dress(i, look) {
    const r = R(); let a, child = false;
    if (look === 'worker') a = r < 0.88 ? 0 : 2; else if (look === 'woman') a = 2; else if (look === 'citizen') a = r < 0.75 ? 1 : 0;
    else if (look === 'athlete') a = 0; else if (look === 'pious') a = r < 0.55 ? 2 : 1; else if (look === 'child') { a = r < 0.55 ? 0 : 2; child = true; } else a = r < 0.34 ? 0 : r < 0.64 ? 1 : 2;
    arch[i] = a;
    const worker = look === 'worker' || (a === 0 && R() < 0.6);
    if (a === 0) { colA[i] = worker ? pick(R() < 0.75 ? COL.work : COL.undyed) : pick(R() < 0.5 ? COL.dyed : COL.undyed); colB[i] = colA[i]; }
    else if (a === 1) { colA[i] = pick(COL.white.concat(COL.undyed)); const q = R(); colB[i] = pick(q < 0.38 ? COL.undyed : q < 0.9 ? COL.dyed : COL.rich); }
    else { const q = R(); colA[i] = pick(q < 0.5 ? COL.dyed : q < 0.92 ? COL.white : COL.rich); do colB[i] = pick(R() < 0.6 ? COL.dyed : COL.undyed); while (colB[i] === colA[i]); }
    skin[i] = pick(a === 2 ? COL.skinF : COL.skinM);
    const hr = R(), grey = !child && R() < 0.1;
    let f = grey ? 3 : hr < 0.45 ? 0 : hr < 0.82 ? 1 : 2;
    if (a === 2 && !child && R() < 0.45) f |= FL.VEIL;
    if (a !== 2 && !child && R() < (a === 1 ? 0.88 : 0.45)) f |= FL.BEARD;
    if (child) f |= FL.CHILD;
    if (a !== 0) f |= FL.LONG;
    flagsB[i] = f; exoB[i] = a === 0 && !child && (look === 'worker' ? R() < 0.6 : R() < 0.12) ? 1 : 0;   // labourers bare the right shoulder
    sc[i] = child ? (1.05 + R() * 0.27) / 1.75 * 1.07 : a === 2 ? (1.52 + R() * 0.16) / 1.75 : (1.62 + R() * 0.21) / 1.75;
  }
  function spawn(k, x, z, yw, look) {
    if (n >= N) return -1;
    const i = n++;
    px[i] = x; pz[i] = z; yaw[i] = faceYaw[i] = baseYaw[i] = wrap(yw); kind[i] = k; mode[i] = MD.IDLE;
    const key = Math.floor(x) * 65536 + Math.floor(z); let l = occ.get(key); if (!l) occ.set(key, l = []); l.push(i);
    dress(i, look);
    const y = groundAt(x, z); lift[i] = surfLift(x, z, y); py[i] = y + lift[i]; gRX[i] = 1e9;
    vpref[i] = (1.05 + R() * 0.45) * (flagsB[i] & FL.CHILD ? 1.1 : arch[i] === 2 ? 0.9 : 1); timer[i] = R() * 4; seedP[i] = R(); curious[i] = R() < 0.65 ? 1 : 0;
    slowK[i] = 1; turnK[i] = 1; laneF[i] = -0.55 + R() * 1.5; sX[i] = x; sZ[i] = z; sideS[i] = 1;
    return i;
  }
  const cnt = { work: 0, other: 0, sit: 0, shop: 0, stand: 0, walk: 0, chora: 0 }, TGT = { work: 170, other: 67, sit: 60, shop: 56, stand: 262 };
  const areasNamed = nm => areaInfo.filter(r => r.name === nm && r.nodes.length);
  const temenosA = areasNamed('temenos')[0], agoraA = areasNamed('agora')[0], quayA = areasNamed('quay')[0], stoaA = areasNamed('stoa').filter(r => !agoraA || (Math.abs((r.a.minX + r.a.maxX) / 2 - (agoraA.a.minX + agoraA.a.maxX) / 2) < 160 && Math.abs((r.a.minZ + r.a.maxZ) / 2 - (agoraA.a.minZ + agoraA.a.maxZ) / 2) < 60));   // the agora's stoas
  // where visitors look: the temenos axis (propylon → altar), the agora, the quay, the platea and the avenue down to the harbour
  const HOT = [[36, 0, 112, 0, 45], [0, 410, 0, 410, 60], [-120, 445, 120, 445, 25], [-150, 64, 300, 64, 15], [145, 64, 145, 440, 15]];
  const hotW = (x, z) => { let w = 0; for (const [x0, z0, x1, z1, r] of HOT) { const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz, t = l2 ? clamp(((x - x0) * dx + (z - z0) * dz) / l2, 0, 1) : 0, ex = x0 + dx * t - x, ez = z0 + dz * t - z; w = Math.max(w, 1 / (1 + (ex * ex + ez * ez) / (r * r))); } return w; };
  const areaW = r => hotW((r.a.minX + r.a.maxX) / 2, (r.a.minZ + r.a.maxZ) / 2);
  const otherA = areaInfo.filter(r => r.nodes.length > 3 && !['temenos', 'agora', 'quay', 'stoa', 'platea'].includes(r.name)).sort((p, q) => areaW(q) - areaW(p));   // the central ones first
  const plateaE = streetEdges.filter(e => e.main && e.axis === 'x'), avenueE = streetEdges.filter(e => e.main && e.axis === 'z'), sideE = streetEdges.filter(e => !e.main && e.houses > 0);
  function weighted(list, wfn) { const w = list.map(wfn), c = []; let s = 0; for (const v of w) c.push(s += v); return () => { const r = R() * s; let lo = 0, hi = c.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid] < r) lo = mid + 1; else hi = mid; } return list[lo]; }; }
  const inArea = (rec, x, z, m = 0) => x > rec.a.minX - m && x < rec.a.maxX + m && z > rec.a.minZ - m && z < rec.a.maxZ + m;
  const randIn = (rec, m = 1) => [lerp(rec.a.minX + m, rec.a.maxX - m, R()), lerp(rec.a.minZ + m, rec.a.maxZ - m, R())];
  // attractors inside open areas: the POIs there, and the gates where the area meets the streets
  for (const rec of areaInfo) {
    rec.attr = []; rec.attrTot = 0;
    if (!rec.nodes.length) continue;
    const a = rec.a, inR = (x, z, m) => x > a.minX - m && x < a.maxX + m && z > a.minZ - m && z < a.maxZ + m;
    for (const p of pois) if (inR(p.x, p.z, 3)) rec.attr.push({ x: p.x, z: p.z, w: p.type === 'altar' || (p.r || 0) >= 4 ? 3 : 1 });
    for (let st = 0; st < nStreetNodes; st++) {
      if (!inR(NX[st], NZ[st], 40)) continue;
      for (let q = 0; q < adj[st].length; q += 4) {
        const j = adj[st][q]; if (NA[j] === -1) continue;
        let best = -1, bd = 25; for (const id of rec.nodes) { const d = Math.hypot(NX[id] - NX[j], NZ[id] - NZ[j]); if (d < bd) { bd = d; best = id; } }
        if (best >= 0 && !rec.attr.some(t => Math.hypot(t.x - NX[best], t.z - NZ[best]) < 12)) rec.attr.push({ x: NX[best], z: NZ[best], w: 1.5 });
      }
    }
    const gates = rec.attr.filter(t => t.w === 1.5), sights = rec.attr.filter(t => t.w !== 1.5);
    for (const g of gates) for (const t of sights) { const d = Math.hypot(g.x - t.x, g.z - t.z); if (d > 25 && d < 130) rec.attr.push({ x: (g.x + t.x) / 2, z: (g.z + t.z) / 2, w: 1 }); }   // the way between them
    for (const t of rec.attr) t.nodes = rec.nodes.filter(id => Math.hypot(NX[id] - t.x, NZ[id] - t.z) < 18);
    rec.attr = rec.attr.filter(t => t.nodes.length); rec.attrTot = rec.attr.reduce((sum, t) => sum + t.w, 0);
  }
  // the temenos: most visitors walk the axis between the propylon and the Mausoleum's altar, some go round to the exedrae in the west
  if (temenosA) { for (const [x, z, w] of [[106, 0, 4], [86, 0, 3], [64, 0, 1.5], [-62, -22, 2], [-62, 22, 2], [-95, 0, 1.5]]) { const nodes = temenosA.nodes.filter(id => Math.hypot(NX[id] - x, NZ[id] - z) < 14); if (nodes.length) temenosA.attr.push({ x, z, w, nodes }); } temenosA.attrTot = temenosA.attr.reduce((sum, t) => sum + t.w, 0); }
  const pickAttr = (rec, rnd) => { let r = rnd() * rec.attrTot; for (const t of rec.attr) if ((r -= t.w) <= 0) return t; return rec.attr[rec.attr.length - 1]; };
  const areaPoint = (rec, m = 2) => {
    if (!rec.attr.length || R() > 0.62) return randIn(rec, m);
    const t = pickAttr(rec, R), g = Math.sqrt(-2 * Math.log(R() + 1e-9)) * 9, an = R() * TAU;
    return [clamp(t.x + Math.cos(an) * g, rec.a.minX + m, rec.a.maxX - m), clamp(t.z + Math.sin(an) * g, rec.a.minZ + m, rec.a.maxZ - m)];
  };
  const setAct = (i, a) => { if (a === ACT.NONE) { actWT[i] = 0; nextAct[i] = -1; } else if (act[i] === a) { actWT[i] = 1; nextAct[i] = -1; } else if (actW[i] < 0.05) { act[i] = a; actWT[i] = 1; nextAct[i] = -1; } else { nextAct[i] = a; actWT[i] = 0; } };

  // groups that talk among themselves
  const gMemL = [], gOffL = [], gLenL = [], gSpkL = [];
  const makeGroup = ids => { gOffL.push(gMemL.length); gLenL.push(ids.length); gSpkL.push(-1); gMemL.push(...ids); for (const id of ids) grp[id] = gOffL.length - 1; };
  function knotAt(cx, cz, size, look, spread = 1, k = K.KNOT) {
    const ids = [], r0 = (0.45 + size * 0.08) * spread, a0 = R() * TAU;
    for (let q = 0; q < size && n < N; q++) {
      const a = a0 + q / size * TAU + (R() - 0.5) * 0.5, r = r0 * (0.9 + R() * 0.25), x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!trySpot(x, z, 0.28, 0.55)) continue;
      const i = spawn(k, x, z, Math.atan2(cx - x, cz - z) + (R() - 0.5) * 0.35, typeof look === 'function' ? look() : look); ids.push(i);
    }
    if (ids.length === 1 && k === K.KNOT) kind[ids[0]] = K.SOLO; else if (ids.length > 1) makeGroup(ids);
    return ids.length;
  }
  const lookMix = () => { const r = R(); return r < 0.45 ? 'citizen' : r < 0.72 ? 'woman' : r < 0.94 ? 'any' : 'child'; };

  // ---------- workers: vendors, craftsmen, porters ----------
  // a weighted draw without replacement (Efraimidis–Spirakis): higher weight comes first, but not always
  const byWeight = (list, wfn) => list.map(p => [Math.pow(R(), 1 / Math.max(1e-6, wfn(p))), p]).sort((a, b) => b[0] - a[0]).map(q => q[1]);
  const stallSpots = [], stalls = pois.filter(p => p.type === 'stall');
  for (const s of stalls) {
    const dx = Math.sin(s.ry || 0), dz = Math.cos(s.ry || 0);
    for (let d = 0.9; d <= 3.6; d += 0.3) { const x = s.x + dx * d, z = s.z + dz * d; if (standable(x, z, 0.3)) { const node = connectSpot(x, z); if (node >= 0) stallSpots.push({ x, z, tx: -dz, tz: dx, yaw: Math.atan2(-dx, -dz), node, busy: 0, own: s.owner }); break; } }
  }
  // vendors: one to a stall (several POIs of one stall count once), spread over the market with the central aisles likelier, then a shopkeeper
  // in every shop front on the platea near the krene
  const stallCl = []; for (const q of stalls) { let c = stallCl.find(c => c.own === q.owner && c.pts.some(p => Math.hypot(p.x - q.x, p.z - q.z) < 2.5)); if (!c) stallCl.push(c = { own: q.owner, pts: [] }); c.pts.push(q); }
  const vendorAt = (s, tight = false) => {   // (a shopkeeper stands in the narrow gap between his counter and the house wall)
    const dx = Math.sin(s.ry || 0), dz = Math.cos(s.ry || 0);
    for (const d of tight ? [0, 0.12, -0.12] : [0, -0.7, -1.1, -1.6, -2.1]) { const x = s.x + dx * d, z = s.z + dz * d; if (tight ? standable(x, z, 0.15) && roomFor(x, z) : trySpot(x, z)) { const i = spawn(K.VENDOR, x, z, s.ry || 0, R() < 0.75 ? 'worker' : 'woman'); arch[i] === 0 && R() < 0.5 && (flagsB[i] |= FL.BEARD); cnt.work++; return true; } }
    return false;
  };
  let nVend = 0; const staffed = [];   // (first no two within 8 m of each other, so the sellers spread over the whole market; then the gaps)
  const vendCl = byWeight(stallCl.filter(c => c.own === 'agora' || hotW(c.pts[0].x, c.pts[0].z) > 0.5), c => hotW(c.pts[0].x, c.pts[0].z) ** 2);
  for (const gap of [8, 0]) for (const c of vendCl) { if (nVend >= 65) break; if (c.on || staffed.some(q => Math.hypot(q.x - c.pts[0].x, q.z - c.pts[0].z) < gap)) continue; if (vendorAt(pick(c.pts))) { nVend++; c.on = true; staffed.push(c.pts[0]); } }
  // shopkeepers: every shop front along the platea, and on the avenue down from the Mausoleum's gate (one to a shop)
  for (const c of stallCl.filter(c => c.own === 'residential' && ((Math.abs(c.pts[0].z - 64) < 14 && Math.abs(c.pts[0].x) < 475) || (Math.abs(c.pts[0].x - 145) < 14 && c.pts[0].z > -60 && c.pts[0].z < 60))))
    for (const s of c.pts) if (vendorAt(s, true)) { nVend++; break; }
  mark('vendors');
  const works = pois.filter(p => p.type === 'work'), frontSpot = (p, maxD = 3) => {
    if (standable(p.x, p.z, 0.3) && roomFor(p.x, p.z)) return { x: p.x, z: p.z, yaw: p.ry || 0 };
    const dx = Math.sin(p.ry || 0), dz = Math.cos(p.ry || 0);
    for (let d = 0.6; d <= maxD; d += 0.3) { const x = p.x + dx * d, z = p.z + dz * d; if (trySpot(x, z)) return { x, z, yaw: Math.atan2(-dx, -dz) }; }
    for (let a = 0; a < TAU; a += TAU / 12) for (const d of [1.2, 2]) { const x = p.x + Math.sin(a) * d, z = p.z + Math.cos(a) * d; if (trySpot(x, z)) return { x, z, yaw: Math.atan2(p.x - x, p.z - z) }; }
    return null;
  };
  // (a house's door POI may say how high its entrance step is: stepTop, stepDepth)
  const stepOf = new Map(pois.filter(p => p.type === 'door' && typeof p.stepTop === 'number' && p.house !== undefined && !/gate/.test(p.note || '')).map(p => [p.house, p]));
  const doorList = layout.houses.map(h => { const q = stepOf.get(h.id); return { x: h.door.x + h.door.nx * 0.55, z: h.door.z + h.door.nz * 0.55, nx: h.door.nx, nz: h.door.nz, stepTop: q ? q.stepTop : null, stepDepth: q ? q.stepDepth : 0 }; })
    .concat(pois.filter(p => p.type === 'door').map(p => ({ x: p.x + (p.nx || 0) * 0.55, z: p.z + (p.nz || 0) * 0.55, nx: p.nx || 0, nz: p.nz || 0, stepTop: typeof p.stepTop === 'number' ? p.stepTop : null, stepDepth: p.stepDepth || 0 })));
  // porters: at most three to a pickup/drop pair (four on a long haul), each on their own timer
  const cargo = [], spot = (x, z, yaw) => ({ x, z, yaw, tx: Math.cos(yaw), tz: -Math.sin(yaw) });
  const pickups = works.filter(p => /cargo-pickup/.test(p.note || '')), drops = works.filter(p => /cargo-drop/.test(p.note || ''));
  // can one walk from node a to node b? (the graph is still being built, so a plain breadth-first search)
  const linked = (a, b) => { const seen = new Set([a]), q = [a]; for (let h = 0; h < q.length; h++) { const u = q[h]; if (u === b) return true; for (let k = 0; k < adj[u].length; k += 4) { const v = adj[u][k]; if (!seen.has(v)) { seen.add(v); q.push(v); } } } return false; };
  const dropUse = new Map(), paired = new Set();
  for (const p of pickups.filter(p => Math.hypot(p.x - 110, p.z - 230) < 450)) {   // each pickup to a near drop it can reach, preferring drops the other pickups are not using yet
    const a = frontSpot(p), na = a ? connectSpot(a.x, a.z) : -1; if (na < 0) continue;
    const cand = drops.map(d => [Math.hypot(d.x - p.x, d.z - p.z) * (1 + 0.6 * (dropUse.get(d) || 0)), d]).filter(q => q[0] < 300 && Math.hypot(q[1].x - p.x, q[1].z - p.z) > 25).sort((q, r) => q[0] - r[0]);
    for (const [, d] of cand.slice(0, 6)) {
      const b = frontSpot(d), nb = b ? connectSpot(b.x, b.z) : -1; if (nb < 0 || !linked(na, nb)) continue;
      dropUse.set(d, (dropUse.get(d) || 0) + 1); cargo.push({ a: spot(a.x, a.z, a.yaw), b: spot(b.x, b.z, b.yaw), na, nb, n: 0 }); paired.add(p); break;
    }
  }
  // no drop near enough (or too few registered): from the quay edge up to the stoas, the agora's south side or a house door near the harbour
  const destN = stoaA.flatMap(r => r.nodes).concat(agoraA ? agoraA.nodes.filter(id => NZ[id] > agoraA.a.maxZ - 14) : []), doorsH = quayA ? doorList.filter(d => d.z > 360 && standable(d.x, d.z, 0.4)) : [];
  const upFrom = (x, z) => {
    const ds = doorsH.filter(d => Math.abs(d.x - x) < 130 && Math.hypot(d.x - x, d.z - z) > 35), ns = destN.filter(id => Math.abs(NX[id] - x) < 110 && Math.hypot(NX[id] - x, NZ[id] - z) > 30);
    const b = ds.length && (R() < 0.4 || !ns.length) ? (d => spot(d.x, d.z, Math.atan2(-d.nx, -d.nz)))(pick(ds)) : ns.length ? (id => spot(NX[id], NZ[id], R() * TAU))(pick(ns)) : null;
    return b && standable(b.x, b.z, 0.5) && !cargo.some(c => Math.hypot(c.b.x - b.x, c.b.z - b.z) < 14) ? b : null;
  };
  if (quayA) for (const p of pickups.filter(p => !paired.has(p) && Math.hypot(p.x - 110, p.z - 230) < 450)) {
    const a = frontSpot(p), na = a ? connectSpot(a.x, a.z) : -1; if (na < 0) continue;
    for (let q = 0; q < 10; q++) { const b = upFrom(a.x, a.z), nb = b ? connectSpot(b.x, b.z) : -1; if (nb >= 0 && linked(na, nb)) { cargo.push({ a: spot(a.x, a.z, a.yaw), b, na, nb, n: 0 }); break; } }
  }
  if (cargo.length < 5 && quayA) for (let q = 0; q < 80 && cargo.length < 6; q++) {
    const x = lerp(quayA.a.minX + 25, quayA.a.maxX - 25, R()), z = quayA.a.maxZ - 0.95; if (!standable(x, z, 0.5) || !standable(x, z - 1.2, 0.5) || cargo.some(c => Math.abs(c.a.x - x) < 20)) continue;
    const b = upFrom(x, z); if (!b) continue;
    const na = connectSpot(x, z), nb = connectSpot(b.x, b.z); if (na >= 0 && nb >= 0 && linked(na, nb)) cargo.push({ a: spot(x, z, 0), b, na, nb, n: 0 });
  }
  for (let q = 0, nPort = 0; nPort < 20 && q < cargo.length * 10; q++) {
    const c = cargo[q % cargo.length]; if (c.n >= (Math.hypot(c.a.x - c.b.x, c.a.z - c.b.z) > 120 ? 4 : 3)) continue;
    const atA = R() < 0.55, s = atA ? c.a : c.b, o = (R() - 0.5) * 3, x = s.x + s.tx * o, z = s.z + s.tz * o; if (!trySpot(x, z)) continue;
    const i = spawn(K.PORTER, x, z, s.yaw, 'worker'); cnt.work++; c.n++; nPort++;
    spotI[i] = cargo.indexOf(c); st[i] = atA ? 1 : 3; vpref[i] *= 0.78 + R() * 0.12; timer[i] = R() * 20; setAct(i, ACT.BEND); if (!atA) prop[i] = PROP.AMPHORA;
  }
  mark('porters');
  // craftsmen: first the kilns, the looms, the harbour cranes and the slipways, then one to every other trade of the industry quarter and the
  // harbour (the nearer the likelier), then one to each kind of work at the houses, in the streets and in the agora
  const trade = new Map();
  // what the work looks like: writing at a desk, serving, lifting and carrying, standing by the animals, reaching into the branches,
  // hammering and chiselling (only for the trades that really strike something), else bending over the work
  const actFor = note => /scribe|writ|dues|count|weigh|money|account/.test(note) ? ACT.WRITE : /barber/.test(note) ? ACT.VEND
    : /porter|load|cargo|carry/.test(note) ? ACT.BEND : /flock|^pen|donkey|herd|ploughing|guard|watch/.test(note) ? ACT.NONE : /olive harvest|vine|picking/.test(note) ? ACT.JAR
    : /smith|forge|anvil|hammer|carpent|mason|sculpt|carv|chisel|cooper|blocking|timber|caulk|shipwright|oar|saw|building|dressing|roughing|murex|stone/.test(note) ? ACT.HAMMER : ACT.BEND;
  const craftAt = w => {
    if (w.owner === 'agora' && /scribe/.test(w.note || '') && !blocked(w.x, w.z) && roomFor(w.x, w.z)) {   // (the agora puts the scribe's stool, 44 cm, on his work spot, his desk in front)
      const i = spawn(K.CRAFT, w.x, w.z, w.ry || 0, 'citizen'), fy = groundAt(w.x, w.z); cnt.work++; trade.set(w.note, (trade.get(w.note) || 0) + 1);
      lift[i] = surfLift(w.x, w.z, fy); py[i] = fy + lift[i]; sitH[i] = 0.44 - lift[i]; workAct[i] = ACT.WRITE; timer[i] = R() * 6; return true;
    }
    const sp = frontSpot(w); if (!sp) return false;
    const note = w.note || '', i = spawn(K.CRAFT, sp.x, sp.z, sp.yaw, actFor(note) === ACT.WRITE ? 'citizen' : 'worker'); cnt.work++; trade.set(note, (trade.get(note) || 0) + 1);
    workAct[i] = actFor(note); timer[i] = R() * 6; return true;
  };
  const tradeW = works.filter(w => !/cargo/.test(w.note || '') && Math.hypot(w.x - 110, w.z - 230) < 520), quarterW = tradeW.filter(w => /industry|harbour/.test(w.owner || ''));
  let nCraft = 0;
  for (const [re, cap] of [[/kiln/, 9], [/weaving at the loom/, 3], [/^crane/, 2], [/^windlass/, 2], [/caulk/, 3], [/shipwright/, 2], [/boat repairs|^oars|dressing timber|boiling pitch/, 3], [/mending nets/, 2], [/^boat$/, 3]]) {
    let k = 0; for (const w of byWeight(quarterW.filter(w => re.test(w.note || '')), p => hotW(p.x, p.z) + 0.05)) { if (k >= cap) break; if (craftAt(w)) { k++; nCraft++; } }
  }
  for (const w of byWeight(quarterW, p => hotW(p.x, p.z) + 0.05)) { if (nCraft >= 64) break; if (!trade.has(w.note || '') && craftAt(w)) nCraft++; }
  for (const [re, cap] of [[/scribe/, 3], [/porters loading/, 2]]) { let k = 0; for (const w of byWeight(tradeW.filter(w => w.owner === 'agora' && re.test(w.note || '')), p => hotW(p.x, p.z) + 0.05)) { if (k >= cap) break; if (craftAt(w)) { k++; nCraft++; } } }
  for (const w of byWeight(tradeW.filter(w => !quarterW.includes(w)), p => hotW(p.x, p.z) + 0.03)) { if (cnt.work >= TGT.work) break; if (!trade.has(w.note || '') && craftAt(w)) nCraft++; }
  mark('craft');

  // ---------- worshippers ----------
  // the Mausoleum's altar first, then the other big altars by where visitors go; what is left at wayside altars and herms on the main streets
  const altars = pois.filter(p => p.type === 'altar' || p.type === 'shrine'), isBig = p => (p.r || 2) >= 4;
  const prayAt = (a, want) => {
    const big = isBig(a), dx = Math.sin(a.ry || 0), dz = Math.cos(a.ry || 0);
    for (let q = 0, placed = 0; q < want * 5 && placed < want && cnt.other < 26; q++) {
      const d = big ? a.r * (0.85 + R() * 0.45) : (a.r || 1) + 0.5 + R() * 0.5, lat = (R() - 0.5) * (big ? 7 : 1.4), x = a.x + dx * d - dz * lat, z = a.z + dz * d + dx * lat;
      if (!trySpot(x, z, 0.3, 0.7)) continue;
      const i = spawn(K.PRAY, x, z, Math.atan2(a.x - x, a.z - z), 'pious'); cnt.other++; placed++; timer[i] = R() * 8; if (R() < 0.7) setAct(i, ACT.PRAY);
    }
  };
  altars.filter(isBig).map(p => [temenosA && inArea(temenosA, p.x, p.z) ? 10 : hotW(p.x, p.z), p]).sort((a, b) => b[0] - a[0]).forEach(([, a], q) => prayAt(a, [8, 6, 2][q] ?? 1));
  for (const a of byWeight(altars.filter(p => !isBig(p) && hotW(p.x, p.z) > 0.3), p => hotW(p.x, p.z) ** 2)) { if (cnt.other >= 26) break; prayAt(a, 1 + Math.floor(R() * 2)); }
  // ---------- water carriers ----------
  // public fountains first (the krene on the platea, the agora's), by where visitors go; private courtyard wells last. Women keep filling jars at
  // the krene's spouts and at the agora's fountain and well all day; the others carry theirs to a house near a fountain, two to a fountain,
  // and linger at the fountain before they go
  const founts = pois.filter(p => (p.type === 'fountain' || p.type === 'well') && Math.hypot(p.x - 110, p.z - 230) < 420), fountSpots = [];
  const ringSpots = f => f.spots ? f.spots.map(s => ({ x: s.x, z: s.z, yaw: s.ry })) : Array.from({ length: 8 }, (_, q) => { const a = q / 8 * TAU, r = (f.r || 1) + 0.55, x = f.x + Math.sin(a) * r, z = f.z + Math.cos(a) * r; return { x, z, yaw: Math.atan2(f.x - x, f.z - z) }; });
  for (const f of byWeight(founts, p => hotW(p.x, p.z) * (p.type === 'fountain' ? 3 : 1) * (/civic|agora|streets/.test(p.owner || '') ? 1 : 0.1))) {
    if (fountSpots.length > 90) break;
    for (const sp of ringSpots(f)) if (standable(sp.x, sp.z)) { const node = connectSpot(sp.x, sp.z); if (node >= 0) fountSpots.push({ ...sp, node, f }); }
  }
  for (const f of founts.filter(f => /krene/.test(f.note || '') || f.owner === 'agora')) {
    const ss = fountSpots.filter(s => s.f === f), want = /krene on/.test(f.note || '') ? 3 : f.type === 'fountain' && f.owner === 'agora' ? 2 : 1;
    for (let q = 0, got = 0; q < ss.length && got < want; q += 2) {
      const s = ss[q]; if (!trySpot(s.x, s.z, 0.28, 0.6)) continue;
      const i = spawn(K.WATER, s.x, s.z, s.yaw, 'woman'); cnt.other++; got++; fountSpots.splice(fountSpots.indexOf(s), 1);
      prop[i] = PROP.HYDRIA; tether[i] = 2; st[i] = 1; setAct(i, ACT.BEND); timer[i] = 1 + R() * 12; curious[i] = 0;
    }
  }
  if (fountSpots.length) {
    const nearDoors = s => { const l = doorList.filter(d => Math.hypot(d.x - s.x, d.z - s.z) < 60 && standable(d.x, d.z, 0.25)); return l.length > 2 ? l : doorList.filter(d => Math.hypot(d.x - s.x, d.z - s.z) < 110 && standable(d.x, d.z, 0.25)); };
    const perF = new Map();
    for (let q = 0; q < fountSpots.length * 3 && cnt.other < TGT.other - 8; q++) {
      const s = fountSpots[q % fountSpots.length], used = perF.get(s.f) || 0; if (used >= 2) continue;
      const ds = nearDoors(s); if (!ds.length || !trySpot(s.x, s.z, 0.3, 0.5)) continue;
      const d = pick(ds), dn = connectSpot(d.x, d.z); if (dn < 0) continue;
      const i = spawn(K.WATER, s.x, s.z, s.yaw, R() < 0.8 ? 'woman' : 'worker'); cnt.other++; perF.set(s.f, used + 1);
      prop[i] = PROP.HYDRIA; spotI[i] = fountSpots.indexOf(s); nodeB[i] = dn; dX[i] = d.x; dZ[i] = d.z; dYaw[i] = Math.atan2(-d.nx, -d.nz); vpref[i] *= 0.9;
      if (R() < 0.5) { st[i] = 1; setAct(i, ACT.BEND); timer[i] = 2 + R() * 8; } else { st[i] = 4; waitT[i] = R() * 40; timer[i] = R() * 3; }
    }
  }

  mark('town-other');
  // ---------- the countryside beyond the walls ----------
  // farmhands at each farmstead and in the fields, a woman at the farm well, mourners at the family plots and tombs along the roads
  // out of the gates, a few at the roadside where funerals gather, and travellers walking between the town and the first farm track
  const inTown = (x, z) => insideWalls(x, z, -2), choraW = works.filter(w => !insideWalls(w.x, w.z, -40) && !/harbour|industry|agora|civic/.test(w.owner || '')), farms = pois.filter(p => p.type === 'gather' && /farm courtyard/.test(p.note || '') && !inTown(p.x, p.z));
  const fetcherAt = f => { for (const sp of ringSpots(f).sort(() => R() - 0.5)) if (trySpot(sp.x, sp.z, 0.28, 0.6)) { const i = spawn(K.WATER, sp.x, sp.z, sp.yaw, 'woman'); prop[i] = PROP.HYDRIA; tether[i] = 2; st[i] = 1; setAct(i, ACT.BEND); timer[i] = 1 + R() * 12; curious[i] = 0; cnt.chora++; return i; } return -1; };
  for (const f of farms) {
    const notes = new Set();
    for (const w of byWeight(choraW.filter(w => Math.hypot(w.x - f.x, w.z - f.z) < 45), () => 1)) { if (notes.size >= 2) break; if (!notes.has(w.note) && craftAt(w)) { notes.add(w.note); cnt.chora++; } }
    const wl = pois.find(p => p.type === 'well' && Math.hypot(p.x - f.x, p.z - f.z) < 45); if (wl && R() < 0.6) fetcherAt(wl);
  }
  { let k = 0; for (const w of byWeight(choraW.filter(w => !farms.some(f => Math.hypot(w.x - f.x, w.z - f.z) < 45)), () => 1)) { if (k >= 3) break; if (craftAt(w)) { k++; cnt.chora++; } } }
  // a mourner stands where the shrine POI says, facing the grave; a second beside them
  const mournAt = (a, want) => {
    const tx = Math.cos(a.ry || 0), tz = -Math.sin(a.ry || 0); let got = 0;
    for (const o of [0, 0.6, -0.6, 1.1, -1.1]) {
      if (got >= want) break; const x = a.x + tx * o, z = a.z + tz * o; if (!trySpot(x, z, 0.28, 0.55)) continue;
      const i = spawn(K.PRAY, x, z, (a.ry || 0) + (R() - 0.5) * 0.3, R() < 0.65 ? 'woman' : 'pious'); if (i < 0) break; if (arch[i] === 2 && R() < 0.8) flagsB[i] |= FL.VEIL;
      if (R() < 0.4) { colA[i] = pick(COL.work); colB[i] = pick([0x4a4038, 0x3a3430, 0x5b4b3e]); }   // (dark mourning mantles)
      workAct[i] = R() < 0.65 ? ACT.MOURN : ACT.PRAY; setAct(i, workAct[i]); timer[i] = R() * 8; curious[i] = 0; got++; cnt.chora++;
    }
    return got;
  };
  const tombs = pois.filter(p => p.type === 'shrine' && !inTown(p.x, p.z) && /mourners|offerings/.test(p.note || '')), nearGate = p => Math.min(Math.hypot(p.x + 745, p.z - 60), Math.hypot(p.x - 770, p.z - 120));
  { let k = 0; for (const a of byWeight(tombs, p => 1 / (1 + nearGate(p) / 60))) { if (k >= 9) break; k += mournAt(a, /mourners/.test(a.note) && R() < 0.5 ? 2 : 1); } }
  // travellers: from the outer platea along the town's road out through the gate and along the country road to the first farm track, and back
  const routes = [];
  for (const cr of (layout.roads || []).filter(r => !r.owner && r.pts.length > 1)) {
    const G = cr.pts[cr.pts.length - 1]; if (insideWalls(G[0], G[1], 30) || !insideWalls(G[0], G[1], -30)) continue;   // a road that ends at a gate in the wall
    const out = (layout.roads || []).find(r => r !== cr && Math.hypot(r.pts[0][0] - G[0], r.pts[0][1] - G[1]) < 3); if (!out) continue;
    // through the gate: the straight line 18 m long through the passage, as near the road's own direction as the towers and the open gate
    // leaves allow, with room either side of it (tested every 10 cm: a gate leaf is only 40 cm thick)
    const dirOf = (P, Q) => { const l = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1; return [(Q[0] - P[0]) / l, (Q[1] - P[1]) / l]; };
    const dIn = dirOf(cr.pts[cr.pts.length - 2], G), dOut = dirOf(G, out.pts[1]), rd = dirOf([0, 0], [dIn[0] + dOut[0], dIn[1] + dOut[1]]);
    const lineClear = (x0, z0, x1, z1, c) => { const L = Math.hypot(x1 - x0, z1 - z0), qx = -(z1 - z0) / L * c, qz = (x1 - x0) / L * c; for (let f = 0; f <= L; f += 0.1) { const x = x0 + (x1 - x0) * f / L, z = z0 + (z1 - z0) * f / L; if (blocked(x, z) || blocked(x + qx, z + qz) || blocked(x - qx, z - qz) || blocked(x + qx / 2, z + qz / 2) || blocked(x - qx / 2, z - qz / 2)) return false; } return true; };
    let gIn = null, gOut = null, gC = null, best = 1e9;
    for (let an = 0; an < TAU; an += Math.PI / 36) { const ux = Math.sin(an), uz = Math.cos(an), dev = Math.acos(clamp(ux * rd[0] + uz * rd[1], -1, 1)); if (dev > 1.2) continue;
      for (let o = -4; o <= 4; o += 0.5) {
        const cx = G[0] - uz * o, cz = G[1] + ux * o, ix = cx - ux * 9, iz = cz - uz * 9, ox = cx + ux * 9, oz = cz + uz * 9, sc2 = dev + 0.15 * Math.abs(o);
        if (sc2 >= best || !insideWalls(ix, iz, 0) || insideWalls(ox, oz, 0) || !standable(ix, iz, 0.4) || !standable(ox, oz, 0.4) || !lineClear(ix, iz, ox, oz, 0.9)) continue;
        best = sc2; gIn = [ix, iz]; gOut = [ox, oz]; gC = [cx, cz];
      } }
    if (!gIn) continue;
    // as far as the first farm track leaving the road beyond the gate
    let end = out.pts.length - 1, acc = 0;
    for (let k = 1; k < out.pts.length; k++) { acc += Math.hypot(out.pts[k][0] - out.pts[k - 1][0], out.pts[k][1] - out.pts[k - 1][1]); const hit = (layout.roads || []).find(r => r.owner && r !== out && r.width < out.width && r.pts.some(q => Math.hypot(q[0] - out.pts[k][0], q[1] - out.pts[k][1]) < 70 && Math.hypot(r.pts[0][0] - out.pts[k][0], r.pts[0][1] - out.pts[k][1]) < 70)); if (acc > 90 && hit) { end = k; break; } }
    const tr = (layout.roads || []).filter(r => r.owner && r !== out && r.width < out.width).map(r => [Math.hypot(r.pts[0][0] - out.pts[end][0], r.pts[0][1] - out.pts[end][1]), r]).sort((a, b) => a[0] - b[0])[0];
    const poly = [...(Math.abs(cr.pts[0][1] - 64) < 2 && Math.abs(cr.pts[0][0]) > 300 ? [[Math.sign(cr.pts[0][0]) * 175, 64]] : []), ...cr.pts.slice(0, -1).filter(q => Math.hypot(q[0] - G[0], q[1] - G[1]) > 12), gIn, gOut, ...out.pts.slice(1, end + 1).filter(q => Math.hypot(q[0] - G[0], q[1] - G[1]) > 12)];
    if (tr && tr[0] < 40) poly.push(tr[1].pts[0]);
    // resample every 4 m; nudge a blocked sample sideways; the lane half-width each side is what is clear up to 1.4 m (3.5 m on the broad
    // platea); cut where it cannot pass
    const X = [], Z = [], H = [];
    for (let k = 0; k < poly.length - 1; k++) {
      const [x0, z0] = poly[k], [x1, z1] = poly[k + 1], L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 4)), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
      for (let q = k ? 1 : 0; q <= n; q++) {
        const bx = x0 + (x1 - x0) * q / n, bz = z0 + (z1 - z0) * q / n; let pt = null;
        for (const o of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, 2.8, -2.8]) { const x = bx - uz * o, z = bz + ux * o; if (standable(x, z, 0.4) && (!X.length || segClear(X[X.length - 1], Z[Z.length - 1], x, z, 0.35))) { pt = [x, z]; break; } }
        if (!pt) { X.length = Z.length = H.length = 0; continue; }   // (start again after an obstacle)
        let h = Math.hypot(pt[0] - gC[0], pt[1] - gC[1]) < 12 ? 0.35 : Math.abs(pt[1] - 64) < 3 && Math.abs(pt[0]) < 472 ? 3.5 : 1.4; for (let o = 0.35; o <= h + 0.01; o += 0.35) if (!standable(pt[0] - uz * o, pt[1] + ux * o, 0.3) || !standable(pt[0] + uz * o, pt[1] - ux * o, 0.3)) { h = o - 0.35; break; }
        X.push(pt[0]); Z.push(pt[1]); H.push(h);
      }
    }
    let len = 0; for (let k = 1; k < X.length; k++) len += Math.hypot(X[k] - X[k - 1], Z[k] - Z[k - 1]);
    let gk = 0; for (let k = 1; k < X.length; k++) if (Math.hypot(X[k] - gC[0], Z[k] - gC[1]) < Math.hypot(X[gk] - gC[0], Z[gk] - gC[1])) gk = k;   // (the sample in the gate)
    if (len > 80 && X.some((x, k) => !insideWalls(x, Z[k], 0)) && X.some((x, k) => insideWalls(x, Z[k], 5))) routes.push({ x: Float64Array.from(X), z: Float64Array.from(Z), h: Float32Array.from(H), n: X.length, len, gk });
  }
  const roadTarget = i => {
    const r = routes[spotI[i]], k = pIdx[i], a = Math.max(0, k - 1), b = Math.min(r.n - 1, k + 1), s = st[i] ? -1 : 1, ux = (r.x[b] - r.x[a]) * s, uz = (r.z[b] - r.z[a]) * s, l = Math.hypot(ux, uz) || 1, off = laneF[i] * r.h[k];
    tgx[i] = r.x[k] - uz / l * off; tgz[i] = r.z[k] + ux / l * off; tgYaw[i] = Math.atan2(ux, uz);
  };
  // a point D metres back along a route from sample k (s: +1 walking out, -1 walking in), off metres to the right of the way
  const offPt = (r, j, s, off) => { const a = Math.max(0, j - 1), b = Math.min(r.n - 1, j + 1), ux = (r.x[b] - r.x[a]) * s, uz = (r.z[b] - r.z[a]) * s, l = Math.hypot(ux, uz) || 1; return [r.x[j] - uz / l * off, r.z[j] + ux / l * off]; };
  const routeBack = (r, k, s, off, D) => { let [ax, az] = offPt(r, k, s, off); for (let j = k - s; j >= 0 && j < r.n; j -= s) { const [bx, bz] = offPt(r, j, s, off), l = Math.hypot(bx - ax, bz - az); if (l >= D) return [ax + (bx - ax) * D / l, az + (bz - az) * D / l]; D -= l; ax = bx; az = bz; } return [ax, az]; };
  // funeral processions on the tomb roads: two men in front with the offerings (an amphora of wine, a basket), then the women in single
  // file, dark-mantled, a hand to the brow; slowly from outside the gate to the family plots, a minute at the grave, then back to the gate
  const procs = [], TRN = 64;
  for (const g of pois.filter(p => p.type === 'gather' && /funeral procession/.test(p.note || ''))) {
    const ri = routes.findIndex(r => { for (let k = 0; k < r.n; k++) if (Math.hypot(r.x[k] - g.x, r.z[k] - g.z) < 12) return true; return false; }); if (ri < 0) continue;
    const plot = pois.filter(p => p.type === 'shrine' && /family plot/.test(p.note || '') && Math.hypot(p.x - g.x, p.z - g.z) < 40).sort((a, b) => Math.hypot(a.x - g.x, a.z - g.z) - Math.hypot(b.x - g.x, b.z - g.z))[0] || g;
    const r = routes[ri]; let hi = 0; for (let k = 1; k < r.n; k++) if (Math.hypot(r.x[k] - plot.x, r.z[k] - plot.z) < Math.hypot(r.x[hi] - plot.x, r.z[hi] - plot.z)) hi = k;   // (it stops beside the grave)
    const lo = r.gk + 5; if (hi - lo < 8) continue;
    const T = { ri, lo, hi, x: new Float64Array(TRN), z: new Float64Array(TRN), head: TRN - 1, cnt: 0, lead: -1, fx: plot.x, fz: plot.z, stop: 0 }, pi = procs.length;
    const k0 = lo + Math.floor((hi - lo) * (0.2 + R() * 0.35)), lf = 0.35, off = lf * r.h[k0], size = 5 + Math.floor(R() * 3);
    for (let D = 12.6; D >= 0; D -= 0.2) { const [x, z] = routeBack(r, k0, 1, off, D); T.head = (T.head + 1) % TRN; T.x[T.head] = x; T.z[T.head] = z; T.cnt = Math.min(TRN, T.cnt + 1); }
    const ids = [], yw = Math.atan2(r.x[k0 + 1] - r.x[k0], r.z[k0 + 1] - r.z[k0]), [lx, lz] = routeBack(r, k0, 1, off, 0);
    for (let q = 0; q < size; q++) {
      const [x, z] = q === 0 ? [lx, lz] : q === 1 ? [lx + Math.cos(yw) * 0.62, lz - Math.sin(yw) * 0.62] : routeBack(r, k0, 1, off, 0.45 + 1.1 * (q - 1));   // (the second man walks at the leader's left)
      if (!trySpot(x, z, 0.25, 0.45)) { if (q < 2) break; continue; }
      const i = spawn(q === 0 ? K.ROAD : K.FOLLOW, x, z, yw, q < 2 ? 'worker' : 'woman'); if (i < 0) break;
      if (q < 2 && arch[i] === 2) dress(i, 'athlete');
      procT[i] = pi; vpref[i] = 0.6; curious[i] = 0; cnt.chora++; cnt.walk++; ids.push(i);
      if (q < 2) { colA[i] = colB[i] = pick([0x5b4b3e, 0x6d604f, 0x4a4038, 0x877157]); flagsB[i] |= FL.BEARD; if (q === 0) { prop[i] = PROP.AMPHORA; setAct(i, ACT.AMPHORA); } else if (arch[i] !== 1) prop[i] = PROP.BASKET; }
      else { flagsB[i] |= R() < 0.85 ? FL.VEIL : 0; colA[i] = pick([0x6d604f, 0x5b4b3e, 0x877157, 0x93846a]); colB[i] = pick([0x4a4038, 0x3a3430, 0x5b4b3e, 0x443c36]); workAct[i] = ACT.MOURN; if (R() < 0.8) setAct(i, ACT.MOURN); }
      if (q === 0) { T.lead = i; spotI[i] = ri; pIdx[i] = k0 + 1; st[i] = 0; rLo[i] = lo; rHi[i] = hi; laneF[i] = lf; roadTarget(i); mode[i] = MD.DIRECT; timer[i] = 1e3; }
      else if (q === 1) { partner[i] = T.lead; partner[T.lead] = i; sideS[i] = -1; mode[i] = MD.FOLLOW; timer[i] = R() * 3; }
      else { procK[i] = q - 1; mode[i] = MD.FOLLOW; timer[i] = R() * 3; }
    }
    if (T.lead < 0 || ids.length < 4) { for (const i of ids) { procT[i] = -1; kind[i] = K.SOLO; mode[i] = MD.IDLE; partner[i] = -1; } continue; }
    procs.push(T);
  }
  // the travellers are spread evenly along the way at the start; a few slow ones with a basket or an amphora on the shoulder; and a few
  // who only go out of the gate to the tombs and the nearer fields and come back, so the gate is seldom without someone passing
  for (let ri = 0; ri < routes.length; ri++) {
    const r = routes[ri], want = Math.round(clamp(r.len / 60, 6, 10)), lo0 = Math.max(1, r.gk - 22), hi0 = Math.min(r.n - 2, r.gk + 26);
    for (let q = 0, got = 0; q < want + 3; q++) {
      const short = q >= want;
      for (let tryK = 0; tryK < 6; tryK++) {
        const k = clamp((short ? lo0 + Math.floor((q - want + R() * 0.5) / 3 * (hi0 - lo0)) : Math.floor((q + R() * 0.5) / want * (r.n - 2)) + 1) + (tryK ? (tryK % 2 ? tryK : -tryK) : 0), 1, r.n - 2), back = R() < 0.5, lf = (R() < 0.5 ? -1 : 1) * (0.3 + R() * 0.6), [x, z] = offPt(r, k, back ? -1 : 1, lf * r.h[k]);
        if (!trySpot(x, z, 0.3, 1.2)) continue;
        const slow = q % 4 === 1, look = slow ? (R() < 0.6 ? 'worker' : 'woman') : R() < 0.45 ? 'worker' : R() < 0.65 ? 'citizen' : 'woman', dx = r.x[k + (back ? -1 : 1)] - x, dz = r.z[k + (back ? -1 : 1)] - z;
        const i = spawn(K.ROAD, x, z, Math.atan2(dx, dz), look); if (i < 0) break;
        if (short) { rLo[i] = lo0; rHi[i] = hi0; }
        spotI[i] = ri; pIdx[i] = k + (back ? -1 : 1); st[i] = back ? 1 : 0; laneF[i] = lf; vpref[i] = slow ? 0.75 + R() * 0.1 : 1.05 + R() * 0.35; roadTarget(i); mode[i] = MD.DIRECT; timer[i] = 1e3; got++; cnt.chora++; cnt.walk++;
        const u = R(); if (arch[i] === 0 && (slow || u < 0.35) && look === 'worker') { prop[i] = PROP.AMPHORA; setAct(i, ACT.AMPHORA); } else if ((slow || u < 0.55) && arch[i] !== 1) prop[i] = PROP.BASKET;
        if (!slow && R() < 0.3 && addFollower(i, look === 'woman' && R() < 0.4 ? 'child' : lookMix()) >= 0) cnt.chora++;
        break;
      }
    }
  }

  mark('chora');
  // ---------- sitting: benches, steps of raised floors, temenos exedrae, doorsteps ----------
  const sitAt = (x, z, yw, seatTop, look, k = K.SIT) => {
    const fx = x + Math.sin(yw) * 0.45, fz = z + Math.cos(yw) * 0.45, fy = groundAt(fx, fz), h = seatTop - fy;
    if (h < 0.03 || h > 0.7 || blocked(fx, fz) || !roomFor(x, z, 0.6)) return -1;
    const i = spawn(k, x, z, yw, look); sitH[i] = h; lift[i] = surfLift(fx, fz, fy); py[i] = fy + lift[i]; sitH[i] = Math.max(0.03, h - lift[i]); return i;
  };
  // a doorstep: the edge of the house's own entrance step where it has one (hips on the step, feet on the one below or the street),
  // else the ground by the wall beside the door
  const doorSeat = (d, lat) => {
    const bx = d.x - d.nz * lat, bz = d.z + d.nx * lat, back = (x, z, max) => { let w = 0; while (w < max && !blocked(x - d.nx * (w + 0.05), z - d.nz * (w + 0.05))) w += 0.05; return w; };
    const inGap = (x, z) => blocked(x - d.nz * 0.95, z + d.nx * 0.95) && blocked(x + d.nz * 0.95, z - d.nx * 0.95);   // between the posts of a gateway
    // a door set back in a porch or a deep reveal: beside its jamb, with the façade at one's back
    const jamb = () => { for (const L2 of (Math.floor(d.x * 7 + d.z * 13) & 1) ? [1, -1, 1.25, -1.25] : [-1, 1, -1.25, 1.25]) {
      const jx = d.x - d.nz * L2, jz = d.z + d.nx * L2, w = back(jx, jz, 1.5); if (w >= 1.5) continue;
      const o = Math.max(0, w - 0.3), x = jx - d.nx * o, z = jz - d.nz * o;
      if (standable(x, z, 0.2) && !inGap(x, z) && !blocked(x + d.nx * 0.5, z + d.nz * 0.5)) return { x, z, top: groundAt(x, z) + 0.07, ground: true };
    } return null; };
    let wall = back(bx, bz, 2.6);
    if (typeof d.stepTop === 'number') {   // the step the house declares: hips on its front edge, feet on the ground (or the step) below
      for (let o = -0.3; o <= wall; o += 0.05) {
        const x = bx - d.nx * o, z = bz - d.nz * o; if (inGap(x, z)) break; if (Math.abs(groundAt(x, z) - d.stepTop) > 0.04) continue;
        const sx = x - d.nx * 0.04, sz = z - d.nz * 0.04, h = d.stepTop - groundAt(sx + d.nx * 0.45, sz + d.nz * 0.45);
        if (h >= 0.15 && h <= 0.6 && !blocked(sx, sz) && Math.abs(groundAt(sx - d.nx * 0.12, sz - d.nz * 0.12) - d.stepTop) < 0.04) return { x: sx, z: sz, top: d.stepTop };
        break;
      }
    }
    if (wall >= 1.5) { const j = jamb(); if (j) return j; }
    if (wall >= 2.6) return { x: d.x, z: d.z, top: groundAt(d.x, d.z) + 0.07, ground: true };   // no wall behind: an open gate, stay outside it
    let best = null;
    for (let o = wall - 0.15; o >= -0.3; o -= 0.05) {
      const x = bx - d.nx * o, z = bz - d.nz * o, y = groundAt(x, z), h = y - groundAt(x + d.nx * 0.45, z + d.nz * 0.45);
      if (inGap(x, z) || h < 0.22 || h > 0.55 || Math.abs(groundAt(x - d.nx * 0.1, z - d.nz * 0.1) - y) > 0.03 || groundAt(x + d.nx * 0.22, z + d.nz * 0.22) > y - 0.08) continue;
      if (!best || Math.abs(h - 0.36) < best.e) best = { x, z, top: y, e: Math.abs(h - 0.36) };
    }
    if (best) return best;
    const o = wall < 1.5 ? Math.max(0, wall - 0.3) : 0, x = bx - d.nx * o, z = bz - d.nz * o;
    return standable(x, z, 0.2) && !inGap(x, z) ? { x, z, top: groundAt(x, z) + 0.07, ground: true } : jamb() || { x: d.x, z: d.z, top: groundAt(d.x, d.z) + 0.07, ground: true };
  };
  const sitDoor = (d, jit, look, k = K.SIT) => { const s = doorSeat(d, (R() - 0.5) * 0.7); return sitAt(s.x, s.z, Math.atan2(d.nx, d.nz) + (R() - 0.5) * (s.ground ? jit : 0.2), s.top, look, k); };
  // ---------- the gymnasium and the council house ----------
  // wrestlers grappling in pairs in the palaestra with a trainer calling to them, youths in the ephebeion, talk in the grove, runners on the
  // track and people on the seat-steps watching them; in the bouleuterion a speaker on the bema and councillors on the benches facing him
  const usedP = new Set(), noteP = (type, re) => pois.filter(p => p.type === type && re.test(p.note || ''));
  noteP('gather', /wrestling|training in the palaestra/).map(g => [R(), g]).sort((a, b) => a[0] - b[0]).slice(0, 3).forEach(([, g], q) => {
    const a = R() * Math.PI, ux = Math.sin(a), uz = Math.cos(a), ids = []; usedP.add(g);
    for (const sd of [-1, 1]) { const x = g.x + ux * sd * 0.42, z = g.z + uz * sd * 0.42; if (trySpot(x, z, 0.25, 0.5)) { const i = spawn(K.KNOT, x, z, Math.atan2(-ux * sd, -uz * sd), 'athlete'); ids.push(i); cnt.stand++; } }
    if (ids.length === 2) { makeGroup(ids); for (const i of ids) { act[i] = ACT.WRESTLE; actW[i] = actWT[i] = 1; curious[i] = 0; flagsB[i] &= ~FL.BEARD; } } else for (const i of ids) kind[i] = K.SOLO;
    if (q < 2) for (const sd of [1, -1]) { const x = g.x - uz * sd * 1.9, z = g.z + ux * sd * 1.9; if (trySpot(x, z, 0.28, 0.6)) { const i = spawn(K.SOLO, x, z, Math.atan2(g.x - x, g.z - z), q ? 'athlete' : 'citizen'); cnt.stand++; if (!q) { orator[i] = 1; gestT[i] = gest[i] = 1; } curious[i] = 0; break; } }
  });
  for (const [re, size, look] of [[/^ephebeion/, 3, 'athlete'], [/gymnasium grove/, 3, 'citizen']]) for (const g of noteP('gather', re).slice(0, 1)) { usedP.add(g); cnt.stand += knotAt(g.x, g.z, size, look); }
  for (const rec of areaInfo.filter(r => /paradromis|running track/.test(r.name || '')).slice(0, 1)) {
    const a = rec.a;
    for (let q = 0; q < 4; q++) {
      const z = lerp(a.minZ + 1.2, a.maxZ - 1.2, (q + 0.5) / 4), x = lerp(a.minX + 2, a.maxX - 2, R()); if (!trySpot(x, z, 0.3, 0.8)) continue;
      const i = spawn(K.AREA, x, z, R() < 0.5 ? Math.PI / 2 : -Math.PI / 2, 'athlete'); runner[i] = 1; hx0[i] = a.minX; hx1[i] = a.maxX; hz0[i] = hz1[i] = z; vpref[i] = 2.5 + R() * 0.9; timer[i] = R() * 2; cnt.walk++; curious[i] = 0;
    }
  }
  const seatRow = (list, want, look, grpWith = -1) => {
    const ids = grpWith >= 0 ? [grpWith] : [];
    for (const b of list.map(b => [R(), b]).sort((p, q) => p[0] - q[0]).map(q => q[1])) {
      if (ids.length - (grpWith >= 0 ? 1 : 0) >= want) break;
      const i = sitAt(b.x, b.z, b.ry || 0, typeof b.y === 'number' ? b.y : groundAt(b.x, b.z) + 0.45, look); if (i >= 0) { ids.push(i); cnt.sit++; usedP.add(b); onSeat[i] = blocked(b.x, b.z) ? 1 : 0; }
    }
    if (ids.length > 1) { makeGroup(ids); if (grpWith >= 0) gSpkL[gSpkL.length - 1] = grpWith; }
  };
  seatRow(noteP('seat', /watching the runners/), 5, lookMix);
  seatRow(noteP('seat', /gymnasium exedra/), 2, 'citizen');
  for (const g of noteP('gather', /speaker on the bema/).filter(g => !pois.some(v => v.type === 'view' && Math.hypot(v.x - g.x, v.z - g.z) < 3))) {
    if (!trySpot(g.x, g.z, 0.2, 0.6)) continue;
    const o = spawn(K.SOLO, g.x, g.z, g.ry || 0, 'citizen'); arch[o] = 1; flagsB[o] |= FL.BEARD | FL.LONG; gestT[o] = gest[o] = 1; curious[o] = 0; orator[o] = 1; cnt.stand++; usedP.add(g);
    seatRow(noteP('seat', /council bench/).filter(b => Math.hypot(b.x - g.x, b.z - g.z) < 20), 8, () => 'citizen', o);
  }
  for (const a of pois.filter(p => (p.type === 'altar' || p.type === 'shrine') && /Hermes and Herakles/.test(p.note || '') && p.spots)) { const sp = a.spots[0]; if (trySpot(sp.x, sp.z, 0.28, 0.6)) { const i = spawn(K.PRAY, sp.x, sp.z, sp.ry, 'pious'); cnt.other++; timer[i] = R() * 8; setAct(i, ACT.PRAY); } }
  // the sanctuaries and the town's hearth: a knot at each of their gathering places, a few on Apollo's exedra and temple steps and in the
  // shade of his stoa, a woman filling her jar at the Salmakis spring and at the fountain below Apollo's terrace
  for (const [re, size, look] of [[/^temple porch/, 3, 'citizen'], [/^sanctuary court/, 2, 'pious'], [/^laurel grove/, 3, lookMix], [/^prytaneion court/, 3, 'citizen'], [/^bouleuterion porch/, 2, 'citizen'],
    [/^before the bouleuterion/, 3, 'citizen'], [/^sanctuary of Aphrodite/, 3, lookMix], [/^porch of the temple of Aphrodite/, 2, 'woman'], [/^before the gymnasium gate/, 2, 'athlete']])
    for (const g of noteP('gather', re).filter(g => !usedP.has(g)).slice(0, 1)) { usedP.add(g); const a = R() * TAU, d = Math.min(1.2, (g.r || 2) * 0.3); cnt.stand += knotAt(g.x + Math.sin(a) * d, g.z + Math.cos(a) * d, size, look); }
  for (const g of noteP('gather', /^stoa shade/).filter(g => g.owner === 'civic' && !usedP.has(g) && !inArea({ a: { minX: 100, maxX: 180, minZ: 150, maxZ: 360 } }, g.x, g.z)).sort(() => R() - 0.5).slice(0, 2)) { usedP.add(g); cnt.stand += knotAt(g.x, g.z, 2 + Math.floor(R() * 2), lookMix); }
  seatRow(noteP('seat', /exedra of Apollo/), 3, lookMix);
  seatRow(noteP('seat', /^temple steps/), 2, 'citizen');
  for (const f of pois.filter(p => (p.type === 'fountain' || p.type === 'well') && /Salmakis spring|wall fountain below/.test(p.note || ''))) {
    for (const sp of ringSpots(f)) if (trySpot(sp.x, sp.z, 0.28, 0.6)) { const i = spawn(K.WATER, sp.x, sp.z, sp.yaw, 'woman'); cnt.other++; prop[i] = PROP.HYDRIA; tether[i] = 2; st[i] = 1; setAct(i, ACT.BEND); timer[i] = 1 + R() * 12; curious[i] = 0; break; }
  }
  // the quay edge: fishermen and sailors with their legs over the water, some with a line or a net in their hands
  for (const p of pois.filter(p => (p.type === 'seat' || p.type === 'bench') && /quay edge/.test(p.note || ''))) {
    const top = typeof p.y === 'number' ? p.y : groundAt(p.x, p.z);
    if (blocked(p.x, p.z) || !roomFor(p.x, p.z, 0.6) || Math.abs(groundAt(p.x, p.z) - top) > 0.1) continue;
    const mend = R() < 0.45, i = spawn(mend ? K.CRAFT : K.SIT, p.x, p.z, p.ry || 0, R() < 0.85 ? 'worker' : 'citizen'); if (i < 0) break;
    sitH[i] = 0.45; lift[i] = 0.02; py[i] = top - 0.45 + 0.02; onSeat[i] = 2; cnt.sit++;
    if (mend) { workAct[i] = ACT.MEND; setAct(i, ACT.MEND); timer[i] = R() * 8; }
  }
  for (const b of byWeight(pois.filter(p => (p.type === 'bench' || p.type === 'seat') && !/quay edge/.test(p.note || '')), p => hotW(p.x, p.z) ** 2)) {
    if (cnt.sit >= 27) break;
    const dx = Math.sin(b.ry || 0), dz = Math.cos(b.ry || 0), ground = gh(b.x + dx * 0.45, b.z + dz * 0.45), top = typeof b.y === 'number' && b.y > ground + 0.1 ? b.y : ground + 0.45;
    const offs = (b.r || 0.5) >= 0.9 ? [-0.36, 0.36] : [0];
    const ids = [];
    for (const o of offs) if (R() < 0.72) { const i = sitAt(b.x - dz * o, b.z + dx * o, b.ry || 0, top, lookMix()); if (i >= 0) { onSeat[i] = 1; cnt.sit++; ids.push(i); } }
    if (ids.length > 1) makeGroup(ids);
  }
  const stepSeats = [];
  for (const rec of areaInfo) {
    const a = rec.a; if (typeof a.y !== 'number') continue;
    for (let side = 0; side < 4; side++) {
      const alongX = side < 2, sg = side % 2 === 0 ? 1 : -1, ox = alongX ? 0 : sg, oz = alongX ? sg : 0, len = alongX ? a.maxX - a.minX : a.maxZ - a.minZ;
      for (let s = 1.3; s < len - 1.3; s += 1.15) {
        const bx = alongX ? a.minX + s : (sg > 0 ? a.maxX : a.minX), bz = alongX ? (sg > 0 ? a.maxZ : a.minZ) : a.minZ + s;
        let e = -1, floor = false;
        for (let d = 0; d <= 3; d += 0.1) { const x = bx + ox * d, z = bz + oz * d, y = gh(x, z); if (blocked(x, z)) break; if (Math.abs(y - a.y) < 0.05) { floor = true; continue; } if (floor && y < a.y - 0.1) e = d; break; }
        if (e < 0) continue;
        const x = bx + ox * (e + 0.03), z = bz + oz * (e + 0.03);
        if (blocked(x, z) || blocked(x - ox * 0.3, z - oz * 0.3) || !standable(x + ox * 0.5, z + oz * 0.5, 0.25)) continue;
        stepSeats.push({ x, z, yaw: Math.atan2(ox, oz), top: a.y, core: rec.name === 'stoa' || rec.name === 'agora' ? 2 : 1 });
      }
    }
  }
  const stepPick = stepSeats.length && weighted(stepSeats, s => s.core * hotW(s.x, s.z) ** 2);
  for (let q = 0; q < 200 && cnt.sit < 44 && stepSeats.length; q++) {
    const s = stepPick(), ids = [], size = 1 + Math.floor(R() * 3);
    for (let m = 0; m < size; m++) {
      const o = stepSeats.find(t => Math.abs(t.x - s.x - m * 1.15 * Math.cos(s.yaw)) < 0.3 && Math.abs(t.z - s.z + m * 1.15 * Math.sin(s.yaw)) < 0.3) || (m === 0 ? s : null);
      if (!o) break;
      const i = sitAt(o.x, o.z, o.yaw + (R() - 0.5) * 0.3, o.top, lookMix()); if (i >= 0) { ids.push(i); cnt.sit++; }
    }
    if (ids.length > 1) makeGroup(ids);
  }
  if (temenosA) for (const [bx, bz, yw] of [[-70, -30, 0], [-70, 30, Math.PI]]) {   // the marble exedra benches (environment.js), seat top 0.5
    if (blocked(bx, bz) || Math.abs(gh(bx, bz)) > 0.05) continue;
    const ids = []; for (const o of [-1.9, -0.6, 0.8, 2.1]) if (R() < 0.6) { const i = sitAt(bx + o, bz + Math.cos(yw) * 0.05, yw, 0.5, lookMix()); if (i >= 0) { ids.push(i); cnt.sit++; } }
    if (ids.length > 1) makeGroup(ids);
  }
  const onMain = d => Math.abs(d.z + d.nz * 4 - 64) < 9;
  const doorPick = weighted(doorList, d => (hotW(d.x, d.z) ** 2 + 0.004) * (onMain(d) ? 4 : 1));
  // every inhabited side street near the centre gets someone of its own: a doorstep sitter, a craftsman, a pair at a door or a slow walker
  const ekey = (axis, ax, az, bx, bz) => axis + (axis === 'x' ? az + ':' + Math.min(ax, bx) : ax + ':' + Math.min(az, bz)), doorsOn = new Map();
  const edgeKey = new Map(streetEdges.map(e => [ekey(e.axis, e.ax, e.az, e.bx, e.bz), e]));
  for (const e of layout.edges) { const k = ekey(e.axis, e.a.x, e.a.z, e.b.x, e.b.z); if (e.open && !e.main && e.houses > 0 && !edgeKey.has(k)) edgeKey.set(k, { axis: e.axis, ax: e.a.x, az: e.a.z, bx: e.b.x, bz: e.b.z, width: e.width, len: e.length, houses: e.houses, main: false, noGraph: true }); }   // open, but too cluttered for the walk graph
  for (const d of doorList) {
    let key = null;
    if (Math.abs(d.nz) > 0.7) { const line = 64 + 60 * Math.round((d.z + d.nz * 4 - 64) / 60); if (Math.abs(line - d.z) < 9 && (line - d.z) * d.nz > 0) key = 'x' + line + ':' + (145 + 45 * Math.floor((d.x - 145) / 45)); }
    else if (Math.abs(d.nx) > 0.7) { const line = 145 + 45 * Math.round((d.x + d.nx * 4 - 145) / 45); if (Math.abs(line - d.x) < 9 && (line - d.x) * d.nx > 0) key = 'z' + line + ':' + (64 + 60 * Math.floor((d.z - 64) / 60)); }
    const e = key && edgeKey.get(key); if (e) { let l = doorsOn.get(e); if (!l) doorsOn.set(e, l = []); l.push(d); }
  }
  const anchorWalk = [], nearCore = e => { const x = (e.ax + e.bx) / 2, z = (e.az + e.bz) / 2; return Math.hypot(x - 145, z - 64) < 300 || Math.hypot(x - 145, z - 400) < 170; };
  for (const e of [...edgeKey.values()].filter(e => !e.main && e.houses > 0 && nearCore(e))) {
    const off = d => e.axis === 'x' ? Math.abs(d.z - e.az) : Math.abs(d.x - e.ax), ds = (doorsOn.get(e) || []).filter(d => standable(d.x, d.z, 0.25) && off(d) < e.width / 2 + 1.4).sort((a, b) => off(a) - off(b)), r = R();
    let ok = false;   // people who stay put keep a street inhabited; a tethered walker only where nobody can stand
    const stepDs = r < 0.5 ? ds.slice(0, 6).filter(d => !doorSeat(d, 0).ground) : [];   // a doorstep sitter takes a house with an entrance step if there is one
    for (let q = 0; q < 5 && !ok && ds.length && r < 0.86; q++) {
      const dd = stepDs.length && q < 3 ? stepDs : ds, d = dd[Math.floor(R() * Math.min(3, dd.length))], yw = Math.atan2(d.nx, d.nz);
      if (r < 0.4) { const i = sitDoor(d, 0.4, R() < 0.4 ? 'woman' : 'any'); if (i >= 0) { cnt.sit++; ok = true; } }
      else if (r < 0.5) { const i = sitDoor(d, 0.5, 'worker', K.CRAFT); if (i >= 0) { workAct[i] = ACT.MEND; setAct(i, ACT.MEND); timer[i] = R() * 8; cnt.work++; ok = true; } }
      else if (roomFor(d.x, d.z)) {
        const i = spawn(K.KNOT, d.x, d.z, yw, R() < 0.5 ? 'woman' : 'any'), ox = d.x + d.nx * 0.72 + (R() - 0.5) * 0.9, oz = d.z + d.nz * 0.72 + (R() - 0.5) * 0.9; ok = true;
        if (r < 0.58 && trySpot(ox, oz, 0.28, 0.55)) { const j = spawn(K.KNOT, ox, oz, Math.atan2(d.x - ox, d.z - oz), R() < 0.15 ? 'child' : lookMix()); makeGroup([i, j]); cnt.stand += 2; } else { kind[i] = K.SOLO; cnt.stand++; }
      }
    }
    for (let q = 0; q < 8 && !ok && (ds.length || r < 0.75 || e.noGraph); q++) {   // no door close to the street: a pair stands at its side
      const f = 0.15 + R() * 0.7, lat = (R() < 0.5 ? -1 : 1) * (e.width / 2 - 0.55), ux = (e.bx - e.ax) / e.len, uz = (e.bz - e.az) / e.len;
      const k = knotAt(lerp(e.ax, e.bx, f) - uz * lat, lerp(e.az, e.bz, f) + ux * lat, R() < 0.7 ? 1 : 2, lookMix, 0.8); cnt.stand += k; ok = k > 0;
    }
    if (!ok) anchorWalk.push(e);
  }
  if (quayA) for (let q = 0, got = 0; q < 30 && got < (works.some(w => /net/.test(w.note || '')) ? 2 : 7); q++) {   // net menders sitting on the quay
    const x = lerp(quayA.a.minX + 10, quayA.a.maxX - 10, R()), z = quayA.a.minZ + 1.2 + R() * 3.5, yw = Math.PI * (R() < 0.5 ? 1 : 0) + (R() - 0.5) * 0.8;
    if (!standable(x, z, 0.3) || !standable(x + Math.sin(yw) * 0.45, z + Math.cos(yw) * 0.45, 0.25)) continue;
    const i = sitAt(x, z, yw, groundAt(x, z) + 0.06, 'worker', K.CRAFT); if (i >= 0) { workAct[i] = ACT.MEND; setAct(i, ACT.MEND); timer[i] = R() * 10; cnt.work++; got++; }
  }
  for (let q = 0; q < 400 && cnt.sit < TGT.sit; q++) {
    const d = doorPick(); if (!standable(d.x, d.z, 0.25) || (q < 300 && doorSeat(d, 0).ground && R() < 0.7)) continue;   // a house with an entrance step is likelier
    const i = sitDoor(d, 0.3, R() < 0.35 ? 'woman' : 'any'); if (i >= 0) cnt.sit++;
  }

  mark('sit');
  // ---------- shoppers ----------
  const browse = [];   // {x, z, tx, tz, yaw, node, act}
  for (const s of stallSpots) browse.push({ ...s, act: ACT.BROWSE });
  if (stallSpots.length < 30) {
    // no stalls registered: shoppers with baskets meet in the open squares, and look into shop doors on the main streets
    for (const rec of [agoraA, agoraA, quayA, ...otherA].filter(Boolean)) for (let q = 0; q < 18 - stallSpots.length / 2; q++) {
      const [x, z] = randIn(rec, 3); if (!standable(x, z)) continue;
      const node = connectSpot(x, z); if (node >= 0) browse.push({ x, z, tx: 1, tz: 0, yaw: R() * TAU, node, act: ACT.NONE });
    }
    for (let q = 0; q < 80 && browse.length < 90; q++) { const d = doorPick(); if (!onMain(d) && R() < 0.8) continue; const x = d.x + d.nx * 0.45, z = d.z + d.nz * 0.45; if (standable(x, z)) { const node = connectSpot(x, z); if (node >= 0) browse.push({ x, z, tx: 1, tz: 0, yaw: Math.atan2(-d.nx, -d.nz), node, act: ACT.BROWSE }); } }
  }
  const browseAg = browse.filter(b => b.own === 'agora'), pickAg = browseAg.length && weighted(browseAg, b => hotW(b.x, b.z) + 0.6), pickB = weighted(browse, b => hotW(b.x, b.z) ** 2 + 0.002);
  for (let q = 0; q < 600 && cnt.shop < TGT.shop && browse.length; q++) {
    const s = browseAg.length >= 12 && R() < 0.9 ? pickAg() : pickB(), o = (R() - 0.5) * 1.8, x = s.x + s.tx * o, z = s.z + s.tz * o;
    if (!trySpot(x, z, 0.28, 0.58)) continue;
    const i = spawn(K.SHOP, x, z, s.yaw + (s.act ? 0 : (R() - 0.5) * 2), R() < 0.6 ? 'woman' : 'any'); cnt.shop++;
    spotI[i] = browse.indexOf(s); vpref[i] *= 0.85; st[i] = 1; timer[i] = R() * 12; setAct(i, s.act); if (arch[i] !== 1 && R() < 0.6) prop[i] = PROP.BASKET;
  }

  mark('shop');
  // ---------- standing: knots at gathering spots, in the squares, at corners and doorways ----------
  const stand0 = cnt.stand, views = pois.filter(p => p.type === 'view'), quayG = pois.filter(p => p.type === 'gather' && p.owner === 'harbour' && /quay|Poseidon/.test(p.note || '')), gathers = pois.filter(p => p.type === 'gather' && !quayG.includes(p) && !usedP.has(p));
  // an orator on the bema, gesturing, and a crowd listening to him
  for (const v of views.filter(p => /speaker|orator|bema/.test(p.note || ''))) {
    const g = gathers.find(q => /listen/.test(q.note || '') && Math.hypot(q.x - v.x, q.z - v.z) < 14); if (!g || !trySpot(v.x, v.z, 0.25, 0.6)) continue;
    const o = spawn(K.SOLO, v.x, v.z, Math.atan2(g.x - v.x, g.z - v.z), 'citizen'); arch[o] = 1; flagsB[o] |= FL.BEARD | FL.LONG; gestT[o] = gest[o] = 1; curious[o] = 0; orator[o] = 1; cnt.stand++;
    const ids = [o];   // he belongs to his audience's group: its speaker, facing them
    for (let q = 0; q < 40 && ids.length < 10; q++) {
      const a = R() * TAU, d = Math.sqrt(R()) * (g.r || 3), x = g.x + Math.sin(a) * d, z = g.z + Math.cos(a) * d; if (!trySpot(x, z, 0.28, 0.75)) continue;
      ids.push(spawn(K.KNOT, x, z, Math.atan2(v.x - x, v.z - z) + (R() - 0.5) * 0.4, lookMix()));
    }
    if (ids.length > 1) { makeGroup(ids); gSpkL[gSpkL.length - 1] = o; } cnt.stand += ids.length - 1; gathers.splice(gathers.indexOf(g), 1);
  }
  for (const g of byWeight(gathers, p => hotW(p.x, p.z) ** 3)) {
    if (cnt.stand - stand0 > 20) break;
    const r = g.r || 2, knots = r >= 4 ? 2 : 1, hot = hotW(g.x, g.z) > 0.7;
    for (let q = 0; q < knots; q++) { if (R() < (hot ? 0.2 : knots > 1 ? 0.1 : 0.5)) continue; const a = R() * TAU, d = knots > 1 ? r * 0.8 : R() * Math.min(1, r * 0.4); cnt.stand += knotAt(g.x + Math.sin(a) * d, g.z + Math.cos(a) * d, 2 + Math.floor(R() * (knots > 1 ? 3 : 2)), lookMix); }
  }
  for (const v of byWeight(views.filter(p => !/speaker|orator|bema/.test(p.note || '')), p => hotW(p.x, p.z) ** 3).slice(0, 10)) { const sp = frontSpot(v, 1.5); if (sp) { spawn(K.SOLO, sp.x, sp.z, v.ry || 0, 'any'); cnt.stand++; } }
  // visitors in the temenos between the propylon and the altar, beside the axis that people walk along
  if (temenosA) for (let q = 0, got = 0; q < 160 && got < 26; q++) {
    const x = R() < 0.78 ? lerp(75, 110, R()) : lerp(50, 75, R()), z = (R() < 0.5 ? -1 : 1) * (3.2 + R() * 8); if (!inArea(temenosA, x, z, -1)) continue;
    const k = knotAt(x, z, 2 + Math.floor(R() * 3), () => R() < 0.3 ? 'pious' : lookMix()); got += k; cnt.stand += k;
  }
  // the squares, main streets and doorways share what is left of the standing budget; the rest goes to the temenos and the agora
  const standK = clamp((TGT.stand - cnt.stand) / (50 + 16 + 22 + 2 * Math.min(6, otherA.length) + 36 + 30 + 12), 0, 1.5), sq = v => Math.round(v * standK), sqM = v => Math.round(v * clamp(standK, 0.46, 1.5));   // (the main streets keep theirs)
  const zoneKnots = (rec, people) => { let got = 0; for (let q = 0; q < people * 3 && got < people; q++) { const [x, z] = areaPoint(rec, 2); if (nearStreet(x, z) && rec.name !== 'platea') continue; got += knotAt(x, z, 2 + Math.floor(R() * Math.min(3, people - got - 1)), lookMix); } cnt.stand += got; };
  if (temenosA) zoneKnots(temenosA, sq(50));
  if (agoraA) zoneKnots(agoraA, sq(16));
  if (quayA) zoneKnots(quayA, sq(22));
  for (const rec of otherA.slice(0, 6)) zoneKnots(rec, Math.min(2, sq(2)));
  const knotsOn = new Map();
  const edgeKnots = (edges, people, wfn) => {
    if (!edges.length || people <= 0) return; const ep = weighted(edges, wfn); let got = 0;
    for (let q = 0; q < people * 4 && got < people; q++) {
      const e = ep(), f = 0.12 + R() * 0.76, sd = R() < 0.5 ? -1 : 1, lat = sd * (e.main ? lerp(e.width / 2 - 2.5, e.width / 2 - 1.1, R()) : e.width / 2 - 0.3);
      const ux = (e.bx - e.ax) / e.len, uz = (e.bz - e.az) / e.len, cx = lerp(e.ax, e.bx, f) - uz * lat, cz = lerp(e.az, e.bz, f) + ux * lat;
      const mine = knotsOn.get(e) || []; if (Math.abs(lat) < 2 || mine.some(([x, z]) => Math.hypot(x - cx, z - cz) < 6)) continue;   // beside the traffic, not bunched
      const k = knotAt(cx, cz, (e.main ? 2 : 1) + Math.floor(R() * 3), lookMix, e.main ? 1 : 0.8); if (k) { mine.push([cx, cz]); knotsOn.set(e, mine); } got += k;
    }
    cnt.stand += got;
  };
  const plateaW = e => (hotW((e.ax + e.bx) / 2, 64) ** 2 + 0.25) * (Math.abs((e.ax + e.bx) / 2 - 100) < 170 ? 4 : 1);
  const avenueW = e => Math.min(e.az, e.bz) >= 60 ? 1 : Math.min(e.az, e.bz) > -60 ? 0.5 : 0;   // (the avenue up to the Mausoleum's gate, not the north road)
  edgeKnots(plateaE, sqM(12), plateaW);
  edgeKnots(avenueE, sqM(12), avenueW);
  for (let q = 0, got = 0, want = sqM(12); q < 300 && got < want && cnt.stand < TGT.stand; q++) {   // doorway conversations
    const d = doorPick(); if (!standable(d.x, d.z, 0.25) || !roomFor(d.x, d.z)) continue;
    const i = spawn(K.KNOT, d.x, d.z, Math.atan2(d.nx, d.nz), R() < 0.5 ? 'woman' : 'any'), ox = d.x + d.nx * 0.75 + (R() - 0.5) * 0.9, oz = d.z + d.nz * 0.75 + (R() - 0.5) * 0.5;
    if (trySpot(ox, oz, 0.28, 0.55)) { const j = spawn(K.KNOT, ox, oz, Math.atan2(d.x - ox, d.z - oz), R() < 0.12 ? 'child' : lookMix()); makeGroup([i, j]); cnt.stand += 2; got += 2; } else { kind[i] = K.SOLO; cnt.stand++; got++; }
  }
  const left = TGT.stand - cnt.stand;
  if (temenosA) zoneKnots(temenosA, Math.round(left * (agoraA ? 0.55 : 1)));
  // the quay takes its share from the agora's: knots at its gathering places and the Poseidon shrine, sailors and merchants by the moored ships
  if (quayA) {
    for (const g of quayG) cnt.stand += knotAt(g.x + (R() - 0.5) * 1.5, g.z + (R() - 0.5) * 0.8, 2 + Math.floor(R() * 2), () => R() < 0.55 ? 'worker' : lookMix());
    for (const X of new Set(pickups.map(p => p.ship).filter(v => typeof v === 'number'))) for (const sd of [-1, 1]) {
      if (R() < 0.25) continue;
      for (let q = 0; q < 8; q++) {
        const x = X + sd * (5.5 + R() * 4), z = quayA.a.maxZ - 0.8 - R() * 1.4; if (!trySpot(x, z, 0.3, 0.7)) continue;
        const i = spawn(K.SOLO, x, z, (R() - 0.5) * 0.9, R() < 0.7 ? 'worker' : 'citizen'); if (i < 0) break; const ox = x + sd * (0.7 + R() * 0.4), oz = z - 0.4 - R() * 0.4; cnt.stand++;
        if (R() < 0.6 && trySpot(ox, oz, 0.28, 0.55)) { kind[i] = K.KNOT; yaw[i] = faceYaw[i] = baseYaw[i] = Math.atan2(ox - x, oz - z); const j = spawn(K.KNOT, ox, oz, Math.atan2(x - ox, z - oz), lookMix()); if (j >= 0) { makeGroup([i, j]); cnt.stand++; } }
        break;
      }
    }
  }
  // the monument's square in the middle of the market: a few talking before the exedra, by the well and on the south side of the statue
  for (const a of pubAreas.filter(a => a.owner === 'agora' && /civic square/.test(a.name || ''))) { const cx = (a.minX + a.maxX) / 2, cz = (a.minZ + a.maxZ) / 2; if (!P_near(cx, cz, Math.max(a.maxX - a.minX, a.maxZ - a.minZ) / 2 + 1)) cnt.stand += knotAt(cx + (R() - 0.5) * (a.maxX - a.minX - 2) * 0.5, cz + (R() - 0.5) * (a.maxZ - a.minZ - 2) * 0.5, 2 + Math.floor(R() * 2), lookMix); }
  if (agoraA) zoneKnots(agoraA, TGT.stand - cnt.stand);
  mark('stand');

  // ---------- finalize the graph (CSR) ----------
  const NN = NX.length;
  const nodeX = Float64Array.from(NX), nodeZ = Float64Array.from(NZ), adjS = new Int32Array(NN + 1);
  for (let i = 0; i < NN; i++) adjS[i + 1] = adjS[i] + adj[i].length / 4;
  const adjTo = new Int32Array(adjS[NN]), adjHalf = new Float32Array(adjS[NN]), adjKind = new Uint8Array(adjS[NN]), adjW = new Float32Array(adjS[NN]), adjLen = new Float32Array(adjS[NN]);
  for (let i = 0; i < NN; i++) for (let q = 0, o = adjS[i]; q < adj[i].length; q += 4, o++) { const j = adj[i][q]; adjTo[o] = j; adjHalf[o] = adj[i][q + 1]; adjKind[o] = adj[i][q + 2]; adjW[o] = adj[i][q + 3]; adjLen[o] = Math.hypot(NX[j] - NX[i], NZ[j] - NZ[i]); }
  const comp = new Int32Array(NN).fill(-1);
  { let c = 0; const stack = new Int32Array(NN); for (let s = 0; s < NN; s++) { if (comp[s] >= 0) continue; let sp = 0; stack[sp++] = s; comp[s] = c; while (sp) { const u = stack[--sp]; for (let o = adjS[u]; o < adjS[u + 1]; o++) { const v = adjTo[o]; if (comp[v] < 0) { comp[v] = c; stack[sp++] = v; } } } c++; } }
  const linkHalf = (a, b) => { for (let o = adjS[a]; o < adjS[a + 1]; o++) if (adjTo[o] === b) return adjHalf[o]; return 0.3; };
  function nearestNode(x, z, clear = true, streetOnly = false, wantC = -1) {
    let best = -1, bd = 1e9, b2 = -1, bd2 = 1e9;
    around(x, z, 20, j => { if ((streetOnly && NA[j] !== -1) || (wantC >= 0 && comp[j] !== wantC)) return; const d = (NX[j] - x) ** 2 + (NZ[j] - z) ** 2; if (d < bd) { b2 = best; bd2 = bd; best = j; bd = d; } else if (d < bd2) { b2 = j; bd2 = d; } });
    if (!clear || best < 0) return best;
    if (segClear(x, z, NX[best], NZ[best], 0.25)) return best;
    if (b2 >= 0 && segClear(x, z, NX[b2], NZ[b2], 0.25)) return b2;
    return -1;
  }
  // A* over the graph (street links slightly preferred)
  const gS = new Float64Array(NN), came = new Int32Array(NN), seen = new Int32Array(NN), closed = new Int32Array(NN), heapI = new Int32Array(adjTo.length + NN + 8), heapK = new Float64Array(adjTo.length + NN + 8), tmpPath = new Int32Array(NN);
  let stamp = 0;
  function astar(s, g, i) {
    stamp++; let hn = 0;
    const push = (id, k) => { let c = hn++; while (c > 0) { const p = (c - 1) >> 1; if (heapK[p] <= k) break; heapI[c] = heapI[p]; heapK[c] = heapK[p]; c = p; } heapI[c] = id; heapK[c] = k; };
    const pop = () => { const top = heapI[0], li = heapI[--hn], lk = heapK[hn]; let c = 0; for (;;) { let l = 2 * c + 1; if (l >= hn) break; if (l + 1 < hn && heapK[l + 1] < heapK[l]) l++; if (heapK[l] >= lk) break; heapI[c] = heapI[l]; heapK[c] = heapK[l]; c = l; } heapI[c] = li; heapK[c] = lk; return top; };
    const gx = nodeX[g], gz = nodeZ[g];
    gS[s] = 0; seen[s] = stamp; came[s] = -1; push(s, 0);
    while (hn > 0) {
      const u = pop(); if (closed[u] === stamp) continue; closed[u] = stamp; if (u === g) break;
      for (let o = adjS[u]; o < adjS[u + 1]; o++) {
        const v = adjTo[o], ng = gS[u] + adjLen[o] * (adjKind[o] ? 1.12 : 1);
        if (seen[v] !== stamp || ng < gS[v]) { seen[v] = stamp; gS[v] = ng; came[v] = u; push(v, ng + Math.hypot(nodeX[v] - gx, nodeZ[v] - gz)); }
      }
    }
    if (closed[g] !== stamp) return false;
    let len = 0; for (let u = g; u >= 0; u = came[u]) tmpPath[len++] = u;
    const use = Math.min(len, PL), b0 = i * PL;
    for (let k = 0; k < use; k++) path[b0 + k] = tmpPath[len - 1 - k];
    pLen[i] = use; pIdx[i] = 0; pFinal[i] = use === len ? 1 : 0; goal[i] = g;
    return true;
  }

  // ---------- walkers ----------
  function chooseNext(i, a, b) {
    const dx = nodeX[b] - nodeX[a], dz = nodeZ[b] - nodeZ[a], dl = Math.hypot(dx, dz) || 1;
    let tot = 0;
    for (let pass = 0; pass < 2; pass++) {
      let r = pass ? RR() * tot : 0;
      for (let o = adjS[b]; o < adjS[b + 1]; o++) {
        const c = adjTo[o]; if (adjKind[o] !== 0) continue;
        const ex = nodeX[c] - nodeX[b], ez = nodeZ[c] - nodeZ[b], cs = (ex * dx + ez * dz) / ((Math.hypot(ex, ez) || 1) * dl);
        let w = (c === a ? 0.12 : cs > 0.7 ? 3 : cs > -0.3 ? 1 : 0.15) * adjW[o];
        const out = (x, z) => x < hx0[i] || x > hx1[i] || z < hz0[i] || z > hz1[i], hcx = (hx0[i] + hx1[i]) / 2, hcz = (hz0[i] + hz1[i]) / 2;
        // strayed from home: head back (turning round included); a tethered walker keeps to its own street
        if (out(nodeX[b], nodeZ[b])) w = Math.hypot(nodeX[c] - hcx, nodeZ[c] - hcz) < Math.hypot(nodeX[b] - hcx, nodeZ[b] - hcz) ? Math.max(w, adjW[o]) * 4 : w * (tether[i] ? 0 : 0.1);
        else if (c !== a && out(nodeX[c], nodeZ[c])) w *= tether[i] ? 0 : 0.05;
        if (!pass) tot += w; else if ((r -= w) <= 0) return c;
      }
      if (!tot) return a;
    }
    return a;
  }
  function enterSeg(i) {
    const b0 = i * PL, k = mode[i] === MD.STREET ? 0 : pIdx[i], a = path[b0 + k], b = path[b0 + k + 1];
    segHalf[i] = linkHalf(a, b);
    if (mode[i] === MD.STREET || k + 2 < pLen[i]) {
      const c = path[b0 + k + 2], ux = nodeX[b] - nodeX[a], uz = nodeZ[b] - nodeZ[a], vx = nodeX[c] - nodeX[b], vz = nodeZ[c] - nodeZ[b];
      const cs = (ux * vx + uz * vz) / ((Math.hypot(ux, uz) * Math.hypot(vx, vz)) || 1); turnK[i] = 0.58 + 0.42 * (cs + 1) / 2;
    } else turnK[i] = 1;
  }
  function startStreet(i, a, b) { const b0 = i * PL; path[b0] = a; path[b0 + 1] = b; path[b0 + 2] = chooseNext(i, a, b); mode[i] = MD.STREET; enterSeg(i); }
  const homeRect = (i, x, z, w, d) => { hx0[i] = x - w; hx1[i] = x + w; hz0[i] = z - d; hz1[i] = z + d; };
  function spawnStreetWalker(e, look, homeW, homeD, k = K.STREET, fA = -1) {   // (fA: where along the edge from its node a, else anywhere)
    const f0 = 0.05 + R() * 0.9, fwd = R() < 0.5, f = fA < 0 ? f0 : fwd ? fA : 1 - fA, a = fwd ? e.a : e.b, b = fwd ? e.b : e.a;
    const ux = (nodeX[b] - nodeX[a]) / e.len, uz = (nodeZ[b] - nodeZ[a]) / e.len, lf = -0.55 + R() * 1.5;
    let x = nodeX[a] + ux * e.len * f - uz * lf * e.half, z = nodeZ[a] + uz * e.len * f + ux * lf * e.half;
    if (!trySpot(x, z, 0.25, 0.8)) { x = nodeX[a] + ux * e.len * f; z = nodeZ[a] + uz * e.len * f; if (!trySpot(x, z, 0.25, 0.8)) return -1; }
    const i = spawn(k, x, z, Math.atan2(ux, uz), look); laneF[i] = lf;
    homeRect(i, x, z, homeW, homeD); startStreet(i, a, b); timer[i] = 5 + R() * 40; cnt.walk++;
    return i;
  }
  function addFollower(L, look) {
    const lf = Math.sin(yaw[L]), lz = Math.cos(yaw[L]), sd = R() < 0.5 ? 1 : -1, x = px[L] - lz * 0.62 * sd, z = pz[L] + lf * 0.62 * sd;
    if (!trySpot(x, z, 0.25, 0.5)) return -1;
    const i = spawn(K.FOLLOW, x, z, yaw[L], look); partner[i] = L; partner[L] = i; sideS[i] = sd; mode[i] = MD.FOLLOW; vpref[i] = vpref[L]; timer[i] = R() * 3; cnt.walk++;
    return i;
  }
  const walkLook = () => { const r = R(); return r < 0.36 ? 'worker' : r < 0.64 ? 'citizen' : 'woman'; };
  const withPair = i => { if (i >= 0 && R() < 0.28 && n < N) addFollower(i, arch[i] === 2 && R() < 0.35 ? 'child' : lookMix()); };
  // jar carriers when no fountain registered
  const jarsLeft = Math.max(0, TGT.other - cnt.other);
  { const ep = weighted(plateaE.concat(avenueE, sideE), e => hotW((e.ax + e.bx) / 2, (e.az + e.bz) / 2) ** 2 * (e.main ? 3 : 1) * (e.main && e.axis === 'z' ? avenueW(e) : 1));
    for (let q = 0; q < jarsLeft * 4 && cnt.other < TGT.other && streetEdges.length; q++) { const i = spawnStreetWalker(ep(), R() < 0.85 ? 'woman' : 'worker', 90, 90, K.STREET); if (i >= 0) { prop[i] = PROP.HYDRIA; if (R() < 0.55) setAct(i, ACT.JAR); vpref[i] *= 0.9; cnt.walk--; cnt.other++; } } }
  mark('jars');
  function spawnAreaWalker(recs, look) {
    const rec = pick(recs); if (!rec) return -1;
    for (let q = 0; q < 10; q++) { const [x, z] = areaPoint(rec, 1); if (!trySpot(x, z, 0.3, 0.8)) continue; const i = spawn(K.AREA, x, z, R() * TAU, look); homeA[i] = rec.ai; timer[i] = R() * 3; cnt.walk++; return i; }
    return -1;
  }
  const agoraRecs = [agoraA, ...stoaA].filter(Boolean);
  const quota = (want, fn) => { for (let q = 0, lim = want * 4; q < lim && want > 0 && n < N; q++) { const before = n; fn(); want -= n - before; } };
  const nWalk = N - n, share = s => Math.round(nWalk * s), n0 = n;
  // the main streets are never empty: a walker of their own for every 45 m of the platea and of the avenue down from the Mausoleum's gate,
  // each keeping to that stretch; people talking where the propylon's approach meets the avenue, and at the gate of Apollo's sanctuary
  const mainAt = (axis, x, z) => streetEdges.find(e => e.main && e.axis === axis && (axis === 'x' ? Math.abs(e.az - z) < 1 && x >= Math.min(e.ax, e.bx) && x <= Math.max(e.ax, e.bx) : Math.abs(e.ax - x) < 1 && z >= Math.min(e.az, e.bz) && z <= Math.max(e.az, e.bz)));
  for (const [axis, from, to] of [['x', -470, 470], ['z', -58, 64]]) for (let c = from + 22.5; c < to; c += 45) {
    const x0 = axis === 'x' ? c : 145, z0 = axis === 'x' ? 64 : c, e = mainAt(axis, x0, z0); if (!e) continue;
    const i = spawnStreetWalker(e, walkLook(), 1, 1, K.STREET, clamp(axis === 'x' ? (x0 - e.ax) / (e.bx - e.ax) : (z0 - e.az) / (e.bz - e.az), 0.05, 0.95)); if (i < 0) continue;
    tether[i] = 1; homeRect(i, x0, z0, axis === 'x' ? 40 : 3, axis === 'x' ? 3 : 40); path[i * PL + 2] = chooseNext(i, path[i * PL], path[i * PL + 1]); vpref[i] *= 0.9;
    if (Math.abs(x0 - 100) > 130 && R() < 0.5) addFollower(i, arch[i] === 2 && R() < 0.3 ? 'child' : lookMix());   // (out along the platea, often two together)
  }
  const knotNear = (x0, z0, size, ok) => { for (let q = 0; q < 80; q++) { const a = R() * TAU, d = 2 + R() * 7, x = x0 + Math.sin(a) * d, z = z0 + Math.cos(a) * d; if (ok(x, z) && trySpot(x, z, 0.9, 1.5)) return knotAt(x, z, size, lookMix); } return 0; };
  const avE0 = avenueE.find(e => Math.abs(e.ax - 145) < 1), approach = (layout.roads || []).find(r => r.pts.length === 2 && Math.abs(r.pts[1][0] - 151) < 2 && Math.abs(r.pts[1][1]) < 2);
  if (avE0 && approach) for (const [zc, size] of [[-12, 3], [13, 2]]) cnt.stand += knotNear(143, zc, size, (x, z) => Math.abs(z - zc) < 5 && Math.abs(x - 145) > 2.6 && Math.abs(x - 145) < 4.6);   // (in sight up and down the avenue from the approach)
  for (const v of views.filter(p => p.owner === 'civic' && /temple of Apollo from its gate/.test(p.note || '')).slice(0, 1)) cnt.stand += knotNear(v.x, 62, 2, (x, z) => Math.abs(z - 64) > 3 && Math.abs(z - 64) < 7.5);
  // and nowhere along them fewer than three who stay: someone on a bench, a pair talking by a shop, a man at a statue, two at the kerb
  const stayIn = (inB) => { let c = 0; for (let i = 0; i < n; i++) if (inB(px[i], pz[i], 1)) c += mode[i] === MD.IDLE && kind[i] !== K.WATER && kind[i] !== K.SHOP && kind[i] !== K.PORTER ? 1 : tether[i] || (mode[i] === MD.FOLLOW && tether[partner[i]]) ? 0.5 : 0; return c; };   // (one who walks a stretch is there half the time)
  const fillStretch = (inB, side, want) => {   // (want is lower where the walkers are many anyway)
    const cand = pois.filter(p => inB(p.x, p.z) && /bench|seat|gather|view/.test(p.type) && !usedP.has(p)).map(p => [(p.type === 'gather' ? 2 : 1) + R(), p]).sort((a, b) => a[0] - b[0]).map(q => q[1]);   // (one on a bench or at a statue before a pair)
    for (let q = 0, have = stayIn(inB); q < 12 && have < want; q++) {
      const p = cand[q], before = n;
      if (p && (p.type === 'bench' || p.type === 'seat')) { const g = gh(p.x + Math.sin(p.ry || 0) * 0.45, p.z + Math.cos(p.ry || 0) * 0.45), i = sitAt(p.x, p.z, p.ry || 0, typeof p.y === 'number' && p.y > g + 0.1 ? p.y : g + 0.45, lookMix()); if (i >= 0) { onSeat[i] = 1; cnt.sit++; } }
      else if (p && p.type === 'view') { const sp = frontSpot(p, 1.5); if (sp && inB(sp.x, sp.z)) { spawn(K.SOLO, sp.x, sp.z, p.ry || 0, 'any'); cnt.stand++; } }
      else if (p) { if (inB(p.x, p.z)) cnt.stand += knotAt(p.x + (R() - 0.5) * 1.2, p.z + (R() - 0.5) * 1.2, 2, lookMix); }
      else { const [x, z] = side(); if (inB(x, z) && trySpot(x, z, 0.8, 1.4) && !nearCentre(x, z)) cnt.stand += knotAt(x, z, 2, lookMix); }
      if (p) usedP.add(p); have += n - before;
    }
  };
  const nearCentre = (x, z) => streetEdges.some(e => e.main && (e.axis === 'x' ? Math.abs(z - e.az) < 2.2 && x > Math.min(e.ax, e.bx) - 3 && x < Math.max(e.ax, e.bx) + 3 : Math.abs(x - e.ax) < 2.2 && z > Math.min(e.az, e.bz) - 3 && z < Math.max(e.az, e.bz) + 3));
  if (plateaE.length) for (let x0 = -475; x0 < 475; x0 += 50) fillStretch((x, z, m = 0) => x >= x0 + m && x < x0 + 50 - m && Math.abs(z - 64) < 10.5, () => [x0 + 3 + R() * 44, 64 + (R() < 0.5 ? -1 : 1) * (3.2 + R() * 3)], Math.abs(x0 + 25 - 100) < 105 ? 2 : 4.5);
  if (avenueE.length) for (let z0 = -58; z0 < 442; z0 += 50) fillStretch((x, z, m = 0) => z >= z0 + m && z < z0 + 50 - m && Math.abs(x - 145) < 8.5, () => [145 + (R() < 0.5 ? -1 : 1) * (3.5 + R() * 1.8), z0 + 3 + R() * 44], 3.5);
  mark('main streets');
  const mainN = n - n0, takeT = Math.round(mainN * 0.6), takeA = mainN - takeT;   // (they come out of the temenos's and the agora's walkers)
  for (const e of anchorWalk) { if (e.noGraph) continue; const i = spawnStreetWalker(e, walkLook(), 1, 1); if (i >= 0) { tether[i] = 1; homeRect(i, (e.ax + e.bx) / 2, (e.az + e.bz) / 2, (e.axis === 'x' ? e.len / 2 : 0) + 3, (e.axis === 'z' ? e.len / 2 : 0) + 3); path[i * PL + 2] = chooseNext(i, path[i * PL], path[i * PL + 1]); vpref[i] *= 0.8; } }
  mark('anchorWalk');
  if (avenueE.length) { const ep = weighted(avenueE, avenueW); quota(share(0.18), () => { const i = spawnStreetWalker(ep(), walkLook(), 12, 220); if (i >= 0) hz0[i] = Math.max(hz0[i], -60); withPair(i); }); }
  mark('avenueWalk');
  if (temenosA) quota(Math.max(share(0.25) - takeT, 36), () => withPair(spawnAreaWalker([temenosA], walkLook())));
  mark('temenosWalk');
  if (agoraRecs.length) quota(Math.max(share(0.085) - takeA, 6), () => withPair(spawnAreaWalker(R() < 0.7 || !stoaA.length ? [agoraA || agoraRecs[0]] : stoaA, walkLook())));
  mark('agoraWalk');
  if (plateaE.length) { const ep = weighted(plateaE, plateaW); quota(share(0.06), () => withPair(spawnStreetWalker(ep(), walkLook(), 150, 14))); }
  mark('plateaWalk');
  if (quayA) quota(share(0.08), () => withPair(spawnAreaWalker([quayA], walkLook())));
  mark('quayWalk');
  for (const rec of otherA.slice(0, 6)) quota(Math.min(2, share(0.02)), () => spawnAreaWalker([rec], walkLook()));
  mark('otherWalk');
  // commuters: wander a street near home, then walk to a square or a sanctuary and back
  const awayRecs = [temenosA, agoraA, agoraA, quayA, ...otherA].filter(Boolean), awayNodes = awayRecs.flatMap(r => r.nodes);
  if (sideE.length && awayNodes.length) {
    const ep = weighted(sideE.concat(plateaE, avenueE), e => hotW((e.ax + e.bx) / 2, (e.az + e.bz) / 2) ** 2);
    quota(share(0.06), () => { const i = spawnStreetWalker(ep(), walkLook(), 100, 100, K.COMMUTE); if (i < 0) return; nodeA[i] = path[i * PL]; for (let q = 0; q < 12; q++) { const j = pick(pick(awayRecs).nodes); if (comp[j] === comp[nodeA[i]] && Math.hypot(nodeX[j] - px[i], nodeZ[j] - pz[i]) < 520) { nodeB[i] = j; break; } } if (nodeB[i] < 0) kind[i] = K.STREET; st[i] = 0; timer[i] = 10 + R() * 60; });
  }
  // what is left walks the main streets, and a few the side streets off them
  if (sideE.length) { const sp = weighted(sideE, e => (hotW((e.ax + e.bx) / 2, (e.az + e.bz) / 2) ** 2 + 0.002) * Math.min(1.4, 0.25 + e.houses / 6)); quota(Math.round((N - n) * 0.3), () => withPair(spawnStreetWalker(sp(), walkLook(), 110, 130))); }
  mark('sideWalk');
  { const mains = plateaE.concat(avenueE), mp = mains.length && weighted(mains, e => e.axis === 'x' ? plateaW(e) : avenueW(e) * 3); if (mp) quota(N - n, () => { const e = mp(), i = spawnStreetWalker(e, walkLook(), e.axis === 'x' ? 150 : 12, e.axis === 'x' ? 14 : 220); if (i >= 0 && e.axis === 'z') hz0[i] = Math.max(hz0[i], -60); withPair(i); }); }
  mark('mainsWalk');
  { const ep = streetEdges.length && weighted(streetEdges, e => hotW((e.ax + e.bx) / 2, (e.az + e.bz) / 2) ** 2 + 0.001); for (let q = 0; n < N && q < 5000 && ep; q++) spawnStreetWalker(ep(), walkLook(), 200, 200); }
  // last resort (no street graph at all): stand anywhere open
  for (let q = 0; n < N && q < 20000; q++) { const x = (R() - 0.5) * 800, z = R() * 500 - 60; if (trySpot(x, z)) spawn(K.SOLO, x, z, R() * TAU, 'any'); }
  const count = n;
  const gMem = Int32Array.from(gMemL), gOff = Int32Array.from(gOffL), gLen = Int32Array.from(gLenL), gSpk = Int32Array.from(gSpkL), gTim = new Float32Array(gOffL.length).map(() => R() * 3), nG = gOffL.length, gCur = new Int32Array(gOffL.length).fill(-1);   // gCur: who holds the floor right now
  for (let i = 0; i < count; i++) { if (act[i] && actWT[i] > 0) actW[i] = 1; if (kind[i] === K.STREET || kind[i] === K.COMMUTE) spd[i] = vpref[i] * 0.8; }

  // ---------- meshes ----------
  const uTime = { value: 0 };
  const matStd = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0, envMapIntensity: 0.35 }), 'std', uTime);
  (ctx.setupMaterial || (m => m))(matStd);
  const matDepth = patchMaterial(new THREE.MeshDepthMaterial(), 'depth', uTime);
  const matNormal = patchMaterial(new THREE.MeshNormalMaterial({ blending: THREE.NoBlending }), 'normal', uTime); matNormal.allowOverride = false;
  const group = new THREE.Group(); group.name = 'people';
  const meshes = [0, 1, 2, 3, 4].map(a => {
    const g = figureGeometry(a), cap = a === 3 ? N : CAP_NEAR;
    for (const nm of ['iPos', 'iAnim', 'iAct', 'iLook']) g.setAttribute(nm, new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.InstancedMesh(g, matStd, cap); m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.customDepthMaterial = matDepth; m.name = 'people';
    m.userData.attrs = ['iPos', 'iAnim', 'iAct', 'iLook'].map(nm => g.attributes[nm]); m.userData.tris = g.index.count / 3;
    group.add(m); return m;
  });
  const A = meshes.map(m => m.userData.attrs.map(a => a.array)), counts = new Int32Array(5), lod2 = new Float32Array([LOD_D * LOD_D, LOD_D * LOD_D, LOD_D * LOD_D]);

  // ---------- simulation ----------
  const hHead = new Int32Array(HMASK + 1).fill(-1), hNext = new Int32Array(N).fill(-1);
  const hIdx = (ix, iz) => (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & HMASK;
  // the player (player.update runs before people.update) may query the hash before the first frame
  const rehash = () => { hHead.fill(-1); for (let i = 0; i < count; i++) { const h = hIdx(Math.floor(px[i] / HC), Math.floor(pz[i] / HC)); hNext[i] = hHead[h]; hHead[h] = i; } };
  rehash();
  let plX = 0, plZ = 0, playerOn = false, frame = 0, budget = 0;
  const updMs = new Float32Array(120); let updK = 0;
  const relAngle = (i, j) => clamp(wrap(Math.atan2(px[j] - px[i], pz[j] - pz[i]) - yaw[i]), -1.2, 1.2);

  function groundY(i) {
    const x = px[i], z = pz[i], ox = x - gRX[i], oz = z - gRZ[i];
    let s = ox * gDX[i] + oz * gDZ[i];
    if (ox * ox + oz * oz > 0.36 || s < -0.05) {
      const fx = Math.sin(yaw[i]), fz = Math.cos(yaw[i]), y0 = groundAt(x, z), y1 = groundAt(x + fx * 0.6, z + fz * 0.6);
      gRX[i] = x; gRZ[i] = z; gDX[i] = fx; gDZ[i] = fz; gY[i] = y0; gSl[i] = clamp((y1 - y0) / 0.6, -1.3, 1.3); s = 0;
      if ((frame + i) % 6 === 0) lift[i] = surfLift(x, z, y0);
    }
    py[i] = gY[i] + gSl[i] * Math.min(s, 0.6) + lift[i];
  }
  function stride(i, dt) {
    const v = spd[i], s = sc[i] * (flagsB[i] & FL.CHILD ? 0.87 : 1), A = v < 0.06 ? 0 : Math.min(runner[i] ? 0.62 : 0.46, 0.08 + 0.25 * v / s) * (arch[i] === 2 ? 0.68 : arch[i] === 1 ? 0.8 : 1);   // shorter, quicker steps in long garments
    gait[i] += (A - gait[i]) * Math.min(1, dt * 5);
    phase[i] = (phase[i] + dt * Math.PI * v / (1.76 * s * Math.sin(Math.max(gait[i], 0.1)))) % 4096;
  }
  function planTo(i, g, fx, fz, fyaw) {
    if (budget <= 0) return false;
    const d = Math.hypot(fx - px[i], fz - pz[i]);
    if (d < 36) { budget--; if (segClear(px[i], pz[i], fx, fz, 0.28)) { mode[i] = MD.DIRECT; tgx[i] = fx; tgz[i] = fz; tgYaw[i] = fyaw; stuckN[i] = 0; return true; } }
    if (g < 0) return false;
    budget -= 3;
    const s = nearestNode(px[i], pz[i], true, false, comp[g]);   // a node of the goal's part of the town
    if (s < 0 || !astar(s, g, i)) return false;
    if (pLen[i] < 2) { mode[i] = MD.DIRECT; tgx[i] = fx; tgz[i] = fz; tgYaw[i] = fyaw; return true; }
    mode[i] = MD.PATH; tgx[i] = fx; tgz[i] = fz; tgYaw[i] = fyaw; stuckN[i] = 0; enterSeg(i);
    return true;
  }
  function planArea(i) {
    const rec = areaInfo[homeA[i]]; if (!rec || !rec.nodes.length) return false;
    let id = rec.nodes[Math.floor(RR() * rec.nodes.length)]; if (rec.attr.length && RR() < 0.55) { const t = pickAttr(rec, RR); id = t.nodes[Math.floor(RR() * t.nodes.length)]; }
    const x = nodeX[id] + (RR() - 0.5) * 3, z = nodeZ[id] + (RR() - 0.5) * 3;
    if (Math.hypot(x - px[i], z - pz[i]) > 70 && RR() < 0.6) return false;
    if (blocked(x, z)) return planTo(i, id, nodeX[id], nodeZ[id], 0);
    return planTo(i, id, x, z, 0);
  }
  function becomeStreet(i) {
    const s = nearestNode(px[i], pz[i], false, true);
    if (s < 0) { kind[i] = K.SOLO; mode[i] = MD.IDLE; faceYaw[i] = baseYaw[i] = yaw[i]; return; }
    let b = -1; for (let o = adjS[s]; o < adjS[s + 1]; o++) if (adjKind[o] === 0) { b = adjTo[o]; if (RR() < 0.5) break; }
    if (b < 0) { kind[i] = K.SOLO; mode[i] = MD.IDLE; return; }
    kind[i] = K.STREET; if (!tether[i]) homeRect(i, px[i], pz[i], 120, 120); startStreet(i, s, b);
  }
  function arrive(i) {
    mode[i] = MD.IDLE; stuckN[i] = 0;
    switch (kind[i]) {
      case K.AREA: faceYaw[i] = yaw[i]; headT[i] = (RR() - 0.5) * 1.6; timer[i] = runner[i] ? 0.3 + RR() * 2.5 : 1 + RR() * 7; break;
      case K.COMMUTE: if (st[i] === 1) { st[i] = 2; kind[i] = K.COMMUTE; homeA[i] = NA[nodeB[i]] >= 0 ? NA[nodeB[i]] : -1; timer[i] = 30 + RR() * 60; } else timer[i] = 0.5; faceYaw[i] = yaw[i]; break;
      case K.SHOP: { const b = browse[spotI[i]]; faceYaw[i] = b && !b.act ? wrap(yaw[i] + (RR() - 0.5) * 2) : tgYaw[i]; setAct(i, b ? b.act : ACT.NONE); st[i] = 1; timer[i] = 10 + RR() * 18; break; }
      case K.PORTER: faceYaw[i] = tgYaw[i]; setAct(i, ACT.BEND); st[i] = st[i] === 0 ? 1 : 3; timer[i] = 3 + RR() * 7; break;
      case K.ROAD: faceYaw[i] = yaw[i]; headT[i] = (RR() - 0.5) * 1.6; timer[i] = 4 + RR() * 14;
        if (procT[i] >= 0) { const T = procs[procT[i]]; T.stop = pIdx[i] >= T.hi ? 2 : 1; headT[i] = 0; timer[i] = T.stop === 2 ? 60 : 25; if (T.stop === 2) faceYaw[i] = wrap(Math.atan2(T.fx - px[i], T.fz - pz[i])); }   // (a minute at the grave)
        break;
      case K.WATER: faceYaw[i] = baseYaw[i] = tgYaw[i]; if (st[i] === 0) { setAct(i, ACT.BEND); st[i] = 1; timer[i] = 7 + RR() * 9; } else { setAct(i, ACT.NONE); st[i] = 3; timer[i] = 3 + RR() * 5; } break;
      default: faceYaw[i] = yaw[i]; timer[i] = 2 + RR() * 4;
    }
  }
  function reroute(i) {
    if (procT[i] >= 0 && kind[i] === K.FOLLOW) { stuckN[i] = 0; blockT[i] = 0; return; }   // (one of a procession keeps to it)
    const b0 = i * PL;
    if (mode[i] === MD.STREET) { const a = path[b0], b = path[b0 + 1]; path[b0] = b; path[b0 + 1] = a; path[b0 + 2] = chooseNext(i, b, a); laneF[i] = -laneF[i] * 0.5; enterSeg(i); stuckN[i] = 0; }
    else if (mode[i] === MD.FOLLOW) { const L = partner[i]; if (L >= 0) partner[L] = -1; partner[i] = -1; becomeStreet(i); }
    else if (kind[i] === K.ROAD && laneF[i] !== 0) { laneF[i] = 0; roadTarget(i); stuckN[i] = 0; }
    else { mode[i] = MD.IDLE; faceYaw[i] = yaw[i]; timer[i] = 0.4 + RR(); stuckN[i] = 0; if (kind[i] === K.STREET) becomeStreet(i); if (kind[i] === K.ROAD) laneF[i] = (RR() < 0.5 ? -1 : 1) * (0.3 + RR() * 0.5); }
  }
  function advance(i) {
    const b0 = i * PL;
    if (mode[i] === MD.STREET) { const b = path[b0 + 1], c = path[b0 + 2]; path[b0] = b; path[b0 + 1] = c; path[b0 + 2] = chooseNext(i, b, c); slowK[i] = turnK[i]; enterSeg(i); return true; }
    pIdx[i]++;
    if (pIdx[i] + 1 >= pLen[i]) {
      if (pFinal[i]) { mode[i] = MD.DIRECT; return true; }
      const g = goal[i], s = path[b0 + pIdx[i]];
      if (g >= 0 && astar(s, g, i) && pLen[i] >= 2) { enterSeg(i); return true; }
      mode[i] = MD.DIRECT; return true;
    }
    slowK[i] = turnK[i]; enterSeg(i); return true;
  }
  function steer(i, dt, cx, cz, want) {
    const x = px[i], z = pz[i], y0 = yaw[i], fx = Math.sin(y0), fz = Math.cos(y0), intent = want;
    let side = 0, pushX = 0, pushZ = 0;
    const ix = Math.floor(x / HC), iz = Math.floor(z / HC);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (let j = hHead[hIdx(ix + ox, iz + oz)]; j >= 0; j = hNext[j]) {
      if (j === i) continue;
      const dx = px[j] - x, dz = pz[j] - z, d2 = dx * dx + dz * dz; if (d2 > 3.6) continue;
      const d = Math.sqrt(d2) + 1e-4, still = mode[j] === MD.IDLE;
      if (d < 0.62) { const f = (0.62 - d) / d * (still ? 1 : 0.5); pushX -= dx * f; pushZ -= dz * f; }
      const ahead = (dx * fx + dz * fz) / d;
      if (ahead < 0.35 || j === partner[i] || (procT[j] >= 0 && procT[j] === procT[i])) continue;
      const lat = dx * fz - dz * fx;
      if (!still && spd[j] > 0.2 && Math.sin(yaw[j]) * fx + Math.cos(yaw[j]) * fz > 0.5) { if (d < 1.5) { const slow = spd[j] < vpref[i] * 0.9; want = Math.min(want, spd[j] * (d < 1.0 ? 0.6 : 0.97) + (slow ? 0.25 : 0.05)); if (slow) side += (lat > 0 ? 0.9 : -0.9); } }
      else { side += (lat > 0 ? 1 : -1) * (1.9 - d) * ahead; if (d < 0.8 && ahead > 0.85) want *= 0.3; }
    }
    if (playerOn) {
      const dx = plX - x, dz = plZ - z, d2 = dx * dx + dz * dz;
      if (d2 < 5) { const d = Math.sqrt(d2) + 1e-4, ahead = (dx * fx + dz * fz) / d; if (d < 0.65) { const f = (0.65 - d) / d; pushX -= dx * f; pushZ -= dz * f; } if (ahead > 0.25) { side += ((dx * fz - dz * fx) > 0 ? 1 : -1) * (2.3 - d) * 1.3; if (d < 1.2 && ahead > 0.7) want = Math.min(want, Math.max(0, (d - 0.62) * 1.5)); } }
    }
    if (side !== 0) { side = clamp(side, -1.6, 1.6); cx -= fz * side; cz += fx * side; if (mode[i] !== MD.FOLLOW) laneF[i] = clamp(laneF[i] + side * dt * 0.25, -1, 1); }
    const da = wrap(Math.atan2(cx - x, cz - z) - y0);
    yaw[i] = wrap(y0 + clamp(da, -2.8 * dt, 2.8 * dt));
    want *= clamp(1.3 - Math.abs(da), 0.1, 1);
    spd[i] = Math.max(0, spd[i] + (want - spd[i]) * Math.min(1, dt * 3.2));
    const s = spd[i] * dt, k = Math.min(1, dt * 5);
    let nx = x + Math.sin(yaw[i]) * s + pushX * k, nz = z + Math.cos(yaw[i]) * s + pushZ * k;
    if (blocked(nx, nz)) {
      if (!blocked(nx, z)) nz = z; else if (!blocked(x, nz)) nx = x; else { nx = x; nz = z; }
      blockT[i] += dt; laneF[i] *= 1 - dt;
      if (blockT[i] > 1.5) { blockT[i] = 0; px[i] = nx; pz[i] = nz; reroute(i); return; }
    } else if (blockT[i] > 0) blockT[i] = Math.max(0, blockT[i] - dt * 0.5);
    px[i] = nx; pz[i] = nz;
    groundY(i); stride(i, dt);
    if (intent > 0.3) {
      stuckT[i] += dt;
      if (stuckT[i] > 4) { const mv = Math.hypot(nx - sX[i], nz - sZ[i]); stuckN[i] = mv < 0.5 ? stuckN[i] + 1 : 0; sX[i] = nx; sZ[i] = nz; stuckT[i] = 0; if (stuckN[i] >= 2) reroute(i); }
    }
  }
  function walkStep(i, dt) {
    const x = px[i], z = pz[i];
    let want = vpref[i], cx = tgx[i], cz = tgz[i];
    slowK[i] = Math.min(1, slowK[i] + dt * 0.4);
    if (mode[i] === MD.DIRECT) {
      let d = Math.hypot(cx - x, cz - z);
      if (kind[i] === K.ROAD) { const r = routes[spotI[i]], nk = pIdx[i] + (st[i] ? -1 : 1); if (nk >= rLo[i] && nk <= Math.min(rHi[i], r.n - 1)) { if (d < 2.2) { pIdx[i] = nk; roadTarget(i); cx = tgx[i]; cz = tgz[i]; } d = 9; } }
      if (d < 0.45 || (d < 1.3 && blockT[i] + stuckT[i] * (spd[i] < 0.15 ? 1 : 0) > 2.5)) { arrive(i); return; }
      if (d < 1.6) want *= Math.max(0.3, d / 1.6);
    } else if (mode[i] === MD.FOLLOW && procK[i] > 0) {   // in a procession's file: on the leader's own track, so the file turns where he turned
      const T = procs[procT[i]], L = T.lead; let ax = px[L], az = pz[L], rem = 0.45 + 1.1 * procK[i]; cx = ax; cz = az;
      for (let q = 0; q < T.cnt; q++) { const k = (T.head - q + TRN) % TRN, bx = T.x[k], bz = T.z[k], sl = Math.hypot(bx - ax, bz - az); if (sl >= rem) { cx = ax + (bx - ax) * rem / sl; cz = az + (bz - az) * rem / sl; break; } rem -= sl; ax = cx = bx; az = cz = bz; }
      const d = Math.hypot(cx - x, cz - z);
      if (mode[L] === MD.IDLE && d < 0.5) { idleStep(i, dt, true); if (T.stop === 2) faceYaw[i] = wrap(Math.atan2(T.fx - x, T.fz - z)); return; }
      want = clamp(spd[L] + (d - 0.15) * 1.2, 0, 1.1);
    } else if (mode[i] === MD.FOLLOW) {
      const L = partner[i]; if (L < 0) { reroute(i); return; }
      const lf = Math.sin(yaw[L]), lz = Math.cos(yaw[L]), sd = sideS[i];
      cx = px[L] - lz * 0.62 * sd + lf * 0.05; cz = pz[L] + lf * 0.62 * sd + lz * 0.05;
      if (blocked(cx, cz)) { cx = px[L] - lf * 0.95; cz = pz[L] - lz * 0.95; }
      const d = Math.hypot(cx - x, cz - z);
      if (d > 30) { reroute(i); return; }
      if ((mode[L] === MD.IDLE || spd[L] < 0.12) && d < 0.7) { idleStep(i, dt, true); faceYaw[i] = procT[i] >= 0 && procs[procT[i]].stop === 2 ? wrap(Math.atan2(procs[procT[i]].fx - x, procs[procT[i]].fz - z)) : wrap(Math.atan2(px[L] - x, pz[L] - z)); return; }
      want = clamp(spd[L] + (d - 0.15) * 1.3, 0, vpref[i] * 1.6);
    } else {
      const b0 = i * PL;
      for (let guard = 0; guard < 3; guard++) {
        const a = path[b0 + pIdx[i]], b = path[b0 + pIdx[i] + 1], ax = nodeX[a], az = nodeZ[a];
        let ux = nodeX[b] - ax, uz = nodeZ[b] - az; const len = Math.hypot(ux, uz) || 1e-3; ux /= len; uz /= len;
        const tt = (x - ax) * ux + (z - az) * uz, off = laneF[i] * segHalf[i], lastSeg = mode[i] === MD.PATH && pIdx[i] + 2 >= pLen[i];
        const cr = lastSeg ? 0.8 : 1.1 + Math.abs(off) * 0.7;
        if (tt > len - cr) { advance(i); if (mode[i] === MD.DIRECT) { cx = tgx[i]; cz = tgz[i]; break; } continue; }
        const ta = Math.max(0, Math.min(tt + 1.7, len));
        cx = ax + ux * ta - uz * off; cz = az + uz * ta + ux * off;
        const rem = len - tt; if (!lastSeg && rem < 3.5) want *= lerp(turnK[i], 1, rem / 3.5);
        break;
      }
      want *= slowK[i];
    }
    steer(i, dt, cx, cz, want);
    if (procT[i] >= 0 && kind[i] === K.ROAD) { const T = procs[procT[i]]; if (Math.hypot(px[i] - T.x[T.head], pz[i] - T.z[T.head]) >= 0.2) { T.head = (T.head + 1) % TRN; T.x[T.head] = px[i]; T.z[T.head] = pz[i]; T.cnt = Math.min(TRN, T.cnt + 1); } }   // (the leader's track)
  }
  function idleStep(i, dt, following = false) {
    spd[i] = Math.max(0, spd[i] - dt * 3);
    gait[i] += -gait[i] * Math.min(1, dt * 6); if (gait[i] > 0.01) phase[i] += dt * 3;
    const da = wrap(faceYaw[i] - yaw[i]); yaw[i] = wrap(yaw[i] + clamp(da, -1.6 * dt, 1.6 * dt));
    if (curious[i] && !following) {
      const dx = plX - px[i], dz = plZ - pz[i];
      if (dx * dx + dz * dz < 25) {
        const rel = wrap(Math.atan2(dx, dz) - yaw[i]);
        if (Math.abs(rel) < 2.4) { headT[i] = clamp(rel, -1.15, 1.15); lookP[i] = 1; if (Math.abs(rel) > 1.05 && sitH[i] === 0 && kind[i] !== K.VENDOR && kind[i] !== K.CRAFT && kind[i] !== K.PRAY && kind[i] !== K.PORTER) faceYaw[i] = wrap(yaw[i] + rel * 0.55); }
      } else if (lookP[i]) { lookP[i] = 0; headT[i] = 0; faceYaw[i] = baseYaw[i]; }
    }
  }
  function someoneInFront(i, r) {
    const fx = Math.sin(yaw[i]), fz = Math.cos(yaw[i]), ix = Math.floor(px[i] / HC), iz = Math.floor(pz[i] / HC);
    for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) for (let j = hHead[hIdx(ix + ox, iz + oz)]; j >= 0; j = hNext[j]) { if (j === i) continue; const dx = px[j] - px[i], dz = pz[j] - pz[i], d2 = dx * dx + dz * dz; if (d2 < r * r && dx * fx + dz * fz > 0.3) return true; }
    const dx = plX - px[i], dz = plZ - pz[i]; return dx * dx + dz * dz < r * r * 1.5 && dx * fx + dz * fz > 0;
  }
  function think(i) {
    switch (kind[i]) {
      case K.STREET:
        if (mode[i] === MD.IDLE) { if (path[i * PL] !== path[i * PL + 1]) { mode[i] = MD.STREET; enterSeg(i); } else becomeStreet(i); timer[i] = 15 + RR() * 40; headT[i] = 0; }
        else if (mode[i] === MD.STREET && RR() < (tether[i] ? 0.6 : 0.28)) { mode[i] = MD.IDLE; faceYaw[i] = baseYaw[i] = yaw[i]; headT[i] = (RR() - 0.5) * 2; timer[i] = tether[i] ? 5 + RR() * 16 : 1.5 + RR() * 4; }
        else timer[i] = tether[i] ? 5 + RR() * 12 : 8 + RR() * 30;
        return;
      case K.AREA:
        if (runner[i]) {   // up and down the track
          if (mode[i] !== MD.IDLE) { timer[i] = 20; return; }
          const far = px[i] < (hx0[i] + hx1[i]) / 2, x = far ? hx1[i] - 1 - RR() * 2.5 : hx0[i] + 1 + RR() * 2.5;
          timer[i] = planTo(i, -1, x, hz0[i] + (RR() - 0.5) * 0.6, far ? Math.PI / 2 : -Math.PI / 2) ? 40 : 0.3; headT[i] = 0; return;
        }
        if (mode[i] === MD.IDLE) { if (!planArea(i)) timer[i] = 0.2 + RR() * 0.6; else timer[i] = 60; } else timer[i] = 20; return;
      case K.COMMUTE:
        if (st[i] === 0 && mode[i] === MD.STREET) { if (planTo(i, nodeB[i], nodeX[nodeB[i]], nodeZ[nodeB[i]], 0)) { st[i] = 1; timer[i] = 400; } else timer[i] = 0.5; }
        else if (st[i] === 2) { if (mode[i] === MD.IDLE && homeA[i] >= 0 && RR() < 0.75 && planArea(i)) timer[i] = 12 + RR() * 20; else if (mode[i] === MD.IDLE && planTo(i, nodeA[i], nodeX[nodeA[i]], nodeZ[nodeA[i]], 0)) { st[i] = 3; timer[i] = 400; } else timer[i] = 0.5; }
        else if (st[i] === 3 && mode[i] === MD.IDLE) { const a = nodeA[i]; let b = -1; for (let o = adjS[a]; o < adjS[a + 1]; o++) if (adjKind[o] === 0) b = adjTo[o]; if (b >= 0) { startStreet(i, a, b); st[i] = 0; timer[i] = 30 + RR() * 90; } else becomeStreet(i); }
        else if (mode[i] === MD.IDLE) { if (st[i] === 1 && planTo(i, nodeB[i], nodeX[nodeB[i]], nodeZ[nodeB[i]], 0)) timer[i] = 400; else if (st[i] === 0) becomeStreet(i), (kind[i] = K.COMMUTE); else timer[i] = 1; }
        else timer[i] = 5;
        return;
      case K.FOLLOW: if (procT[i] >= 0) { headT[i] = (RR() - 0.5) * 0.3; timer[i] = 3 + RR() * 5; return; } { const L = partner[i]; if (L >= 0) { headT[i] = RR() < 0.5 ? clamp(wrap(Math.atan2(px[L] - px[i], pz[L] - pz[i]) - yaw[i]), -1.2, 1.2) : (RR() - 0.5) * 0.8; gestT[i] = RR() < 0.3 ? 1 : 0; if (mode[L] !== MD.IDLE) { headT[L] = RR() < 0.4 ? clamp(wrap(Math.atan2(px[i] - px[L], pz[i] - pz[L]) - yaw[L]), -1.2, 1.2) : 0; gestT[L] = gestT[i] ? 0 : (RR() < 0.3 ? 1 : 0); } } timer[i] = 2 + RR() * 4; return; }
      case K.KNOT: timer[i] = 1e6; return;
      case K.SOLO: if (orator[i]) { gestT[i] = 1; timer[i] = 30; return; } headT[i] = (RR() - 0.5) * 2.2; if (RR() < 0.12) faceYaw[i] = baseYaw[i] = wrap(baseYaw[i] + (RR() - 0.5) * 1.2); timer[i] = 2.5 + RR() * 6; return;
      case K.SIT: if (grp[i] < 0 && !lookP[i]) headT[i] = (RR() - 0.5) * 1.8; timer[i] = 3 + RR() * 6; return;
      case K.VENDOR: { const busy = someoneInFront(i, 3); setAct(i, busy ? ACT.VEND : ACT.NONE); gestT[i] = busy && RR() < 0.6 ? 1 : 0; if (!lookP[i]) headT[i] = busy ? (RR() - 0.5) * 0.4 : (RR() - 0.5) * 1.8; timer[i] = 2 + RR() * 3; return; }
      case K.CRAFT: if (actWT[i] > 0.5) { setAct(i, ACT.NONE); if (!lookP[i]) headT[i] = (RR() - 0.5) * 1.6; timer[i] = 2 + RR() * 4; } else { setAct(i, workAct[i]); headT[i] = 0; timer[i] = 6 + RR() * 14; } return;
      case K.PRAY: if (actWT[i] > 0.5) { setAct(i, ACT.NONE); timer[i] = 4 + RR() * 6; } else { setAct(i, workAct[i] || ACT.PRAY); headT[i] = 0; timer[i] = 12 + RR() * 18; } return;
      case K.ROAD: if (mode[i] !== MD.IDLE) { timer[i] = 1e3; return; } { const r = routes[spotI[i]], T = procT[i] >= 0 ? procs[procT[i]] : null, lo = rLo[i], hi = Math.min(rHi[i], r.n - 1), back = pIdx[i] >= hi ? 1 : pIdx[i] <= lo ? 0 : st[i]; st[i] = back; pIdx[i] = clamp(pIdx[i] + (back ? -1 : 1), lo, hi); if (T) T.stop = 0; roadTarget(i); mode[i] = MD.DIRECT; headT[i] = 0; timer[i] = 1e3; } return;
      case K.SHOP: {
        if (mode[i] !== MD.IDLE) { timer[i] = 5; return; }
        setAct(i, ACT.NONE);
        let s = null, sd = 1e9; for (let q = 0; q < 10; q++) { const c = browse[Math.floor(RR() * browse.length)], d = c ? Math.hypot(c.x - px[i], c.z - pz[i]) * (0.6 + RR() * 0.8) : 1e9; if (c && c !== browse[spotI[i]] && d < 50 && d < sd) { s = c; sd = d; } }
        if (!s) { timer[i] = 3 + RR() * 5; return; }
        const o = (RR() - 0.5) * 1.8, tx = s.x + s.tx * o, tz = s.z + s.tz * o;
        if (planTo(i, s.node, blocked(tx, tz) ? s.x : tx, blocked(tx, tz) ? s.z : tz, s.yaw)) { spotI[i] = browse.indexOf(s); st[i] = 0; timer[i] = 400; } else timer[i] = 0.5;
        return;
      }
      case K.PORTER: {
        if (mode[i] !== MD.IDLE) { timer[i] = 5; return; }
        const c = cargo[spotI[i]]; if (!c) { timer[i] = 10; return; }
        if (st[i] === 1) { prop[i] = PROP.AMPHORA; setAct(i, ACT.AMPHORA); st[i] = 2; }
        else if (st[i] === 3) { prop[i] = PROP.NONE; setAct(i, ACT.NONE); st[i] = 0; }
        const s = st[i] === 2 ? c.b : c.a, nd = st[i] === 2 ? c.nb : c.na, o = (RR() - 0.5) * 3, ox = s.x + s.tx * o, oz = s.z + s.tz * o, free = !blocked(ox, oz);
        if (!planTo(i, nd, free ? ox : s.x, free ? oz : s.z, s.yaw)) timer[i] = 0.5; else timer[i] = 400;
        return;
      }
      case K.WATER: {
        if (mode[i] !== MD.IDLE) { timer[i] = 5; return; }
        // the jar is full: stand about at the fountain for a while, looking round at the others (a fetcher who stays then fills the next)
        if (st[i] === 1) { setAct(i, ACT.NONE); st[i] = 4; waitT[i] = tether[i] === 2 ? 5 + RR() * 14 : 12 + RR() * 45; }
        if (st[i] === 4) {
          if (waitT[i] > 0) { const w = 2.5 + RR() * 4; waitT[i] -= w; timer[i] = w; if (!lookP[i]) headT[i] = (RR() - 0.5) * 2.2; return; }
          headT[i] = 0;
          if (tether[i] === 2) { setAct(i, ACT.BEND); st[i] = 1; timer[i] = 8 + RR() * 10; return; }
          st[i] = 5;
        }
        if (budget <= 0) { timer[i] = 0.3 + RR() * 0.4; return; }
        const f = fountSpots[spotI[i]], toDoor = st[i] === 5 || st[i] === 2;   // (2: turned back on the way to the door)
        if (toDoor ? planTo(i, nodeB[i], dX[i], dZ[i], dYaw[i]) : f && planTo(i, f.node, f.x, f.z, f.yaw)) { st[i] = toDoor ? 2 : 0; if (toDoor) setAct(i, RR() < 0.6 ? ACT.JAR : ACT.NONE); failN[i] = 0; timer[i] = 400; }
        else if (++failN[i] >= 5) { becomeStreet(i); if (RR() < 0.55) setAct(i, ACT.JAR); }   // no way there: carries the jar about the streets instead
        else timer[i] = 0.5 + RR();
        return;
      }
    }
  }
  function groupTick(dt) {
    for (let g = 0; g < nG; g++) {
      if ((gTim[g] -= dt) > 0) continue;
      const o = gOff[g], m = gLen[g], sp = gSpk[g], s = sp >= 0 && RR() < 0.85 ? sp : gMem[o + Math.floor(RR() * m)];   // an orator holds the floor
      gTim[g] = 2 + RR() * 5; gCur[g] = s;
      for (let q = 0; q < m; q++) {
        const j = gMem[o + q]; if (lookP[j] || mode[j] !== MD.IDLE) continue;
        if (j === sp) { gestT[j] = 1; const other = s !== j ? s : gMem[o + (q + 1 + Math.floor(RR() * (m - 1))) % m]; headT[j] = clamp(relAngle(j, other), -0.6, 0.6); }
        else if (j === s) { gestT[j] = RR() < (sitH[j] > 0 ? 0.45 : 0.75) ? 1 : 0; const other = gMem[o + (q + 1 + Math.floor(RR() * (m - 1))) % m]; headT[j] = relAngle(j, other); }
        else { gestT[j] = RR() < 0.07 ? 0.6 : 0; headT[j] = relAngle(j, s) * (0.75 + RR() * 0.25); }
      }
    }
  }
  function simulate(i, dt) {
    timer[i] -= dt;
    if (mode[i] === MD.IDLE) idleStep(i, dt); else walkStep(i, dt);
    if (timer[i] <= 0) think(i);
    if (nextAct[i] >= 0 && actW[i] < 0.05) { act[i] = nextAct[i]; nextAct[i] = -1; actWT[i] = 1; }
    const k = Math.min(1, dt * 3.5);
    if (talkT[i] > 0) { talkT[i] -= dt; if (talkT[i] <= 0) { gestT[i] = orator[i] ? 1 : 0; if (!curious[i]) { lookP[i] = 0; headT[i] = 0; } } else gestT[i] = 1; }   // (idleStep only lets go of the curious)
    headA[i] += (headT[i] - headA[i]) * k; gest[i] += (gestT[i] - gest[i]) * Math.min(1, dt * 2.5); actW[i] += (actWT[i] - actW[i]) * Math.min(1, dt * 2.2);
    lean[i] += ((mode[i] === MD.IDLE ? 0 : 0.04) - lean[i]) * k;
  }

  const _pm = new THREE.Matrix4(), _fr = new THREE.Frustum(), PLN = new Float64Array(24);
  function pack(cam) {
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    for (let p = 0; p < 6; p++) { const pl = _fr.planes[p]; PLN[p * 4] = pl.normal.x; PLN[p * 4 + 1] = pl.normal.y; PLN[p * 4 + 2] = pl.normal.z; PLN[p * 4 + 3] = pl.constant; }
    const cx = cam.position.x, cz = cam.position.z; counts.fill(0);
    for (let i = 0; i < count; i++) {
      const x = px[i], y = py[i] + 0.9 * sc[i], z = pz[i];
      let vis = true;
      for (let p = 0; p < 24; p += 4) if (PLN[p] * x + PLN[p + 1] * y + PLN[p + 2] * z + PLN[p + 3] < -3.2) { vis = false; break; }
      if (!vis) continue;
      const d2 = (x - cx) ** 2 + (z - cz) ** 2; if (d2 > 2.4e6) continue;
      const a = arch[i]; let m = 3; if (d2 < lod2[a] && counts[a] < CAP_NEAR) m = a;
      const k = counts[m]++ * 4, B = A[m];
      B[0][k] = x; B[0][k + 1] = py[i]; B[0][k + 2] = z; B[0][k + 3] = yaw[i];
      B[1][k] = phase[i]; B[1][k + 1] = gait[i]; B[1][k + 2] = headA[i]; B[1][k + 3] = m === 3 && d2 > 32400 ? sc[i] * (1 + Math.min(0.22, (Math.sqrt(d2) - 180) / 900)) : sc[i];   // far away: a touch larger, so the crowd still reads from the air
      B[2][k] = act[i] + clamp(actW[i], 0, 1) * 0.99; B[2][k + 1] = lean[i]; B[2][k + 2] = gest[i]; B[2][k + 3] = sitH[i];
      B[3][k] = colA[i]; B[3][k + 1] = colB[i]; B[3][k + 2] = skin[i]; B[3][k + 3] = flagsB[i] + prop[i] * 64 + exoB[i] * 256 + seedP[i] * 0.99;
      if (m < 3 && (prop[i] || act[i] === ACT.HAMMER || act[i] === ACT.WRITE) && counts[4] < CAP_NEAR) {   // what they carry: a separate small mesh
        const q = counts[4]++ * 4; for (let u = 0; u < 4; u++) { const s = B[u], dd = A[4][u]; dd[q] = s[k]; dd[q + 1] = s[k + 1]; dd[q + 2] = s[k + 2]; dd[q + 3] = s[k + 3]; }
      }
    }
    for (let m = 0; m < 5; m++) {
      const mesh = meshes[m], c = counts[m]; mesh.count = c; mesh.visible = c > 0;
      if (c) for (const at of mesh.userData.attrs) { at.clearUpdateRanges(); at.addUpdateRange(0, c * 4); at.needsUpdate = true; }
      if (m < 3) lod2[m] = c >= CAP_NEAR ? lod2[m] * 0.92 : Math.min(LOD_D * LOD_D, lod2[m] * 1.03 + 1);
    }
  }

  function update(dt, t, cam, player) {
    const T0 = perf.now();
    dt = Math.min(Math.max(dt, 0), 0.1); uTime.value = t; frame++; budget = 10;
    plX = cam.position.x; plZ = cam.position.z; playerOn = !!player && !player.fly;
    rehash();
    groupTick(dt);
    for (let i = 0; i < count; i++) {
      const d2 = (px[i] - plX) ** 2 + (pz[i] - plZ) ** 2, tier = d2 < 22500 ? 1 : d2 < 90000 ? 3 : 8;
      if ((tier > 1 && (frame + i) % tier) || frozen[i]) continue;
      const d = Math.min(0.25, t - lastT[i]); lastT[i] = t;
      if (d > 0) simulate(i, frame === 1 ? dt : d);
    }
    pack(cam);
    const ms = perf.now() - T0; updMs[updK++ % 120] = ms;
  }

  world.dynamicBlocked = (x, z, fx, fz) => {
    if (x === fx && z === fz) return false;
    const ix = Math.floor(x / HC), iz = Math.floor(z / HC);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (let j = hHead[hIdx(ix + ox, iz + oz)]; j >= 0; j = hNext[j]) {
      const d2 = (px[j] - x) ** 2 + (pz[j] - z) ** 2;
      if (d2 < 0.2025 && d2 < (px[j] - fx) ** 2 + (pz[j] - fz) ** 2) return true;
    }
    return false;
  };

  const walking = i => mode[i] !== MD.IDLE;
  function stateName(i) {
    if (procT[i] >= 0) return walking(i) ? 'in procession' : 'mourning (procession)';
    const k = kind[i], mv = walking(i);
    if (k === K.SIT) return act[i] === ACT.MEND ? 'working (seated)' : 'sitting';
    if (k === K.PRAY) return actWT[i] > 0.5 ? 'praying' : 'at the altar';
    if (k === K.PORTER) return mv ? (prop[i] ? 'carrying amphora' : 'walking (porter)') : 'loading';
    if (k === K.VENDOR) return 'vending';
    if (k === K.CRAFT) return 'working';
    if (k === K.SHOP) return mv ? 'walking (shopper)' : 'browsing';
    if (k === K.WATER || prop[i] === PROP.HYDRIA) return mv ? 'carrying water' : 'fetching water';
    if (k === K.KNOT) return act[i] === ACT.WRESTLE ? 'wrestling' : 'talking';
    if (runner[i]) return mv ? 'running' : 'pausing';
    if (k === K.ROAD) return mv ? 'travelling' : 'resting (road)';
    if (k === K.SOLO) return 'standing';
    return mv ? 'walking' : 'pausing';
  }
  const api = {
    group, count,
    update,
    gtaoBegin() { for (const m of meshes) m.material = matNormal; },
    gtaoEnd() { for (const m of meshes) m.material = matStd; },
    debug() {
      const byState = {}, byKind = {}, stuckAt = [], floatAt = [], belowAt = []; let inside = 0, seated = 0, below = 0, floating = 0, stuck = 0, ws = 0, wc = 0;
      const kn = Object.keys(K);
      for (let i = 0; i < count; i++) {
        const s = stateName(i); byState[s] = (byState[s] || 0) + 1; byKind[kn[kind[i]]] = (byKind[kn[kind[i]]] || 0) + 1;
        if (blocked(px[i], pz[i])) { if (onSeat[i]) seated++; else inside++; }
        const fy = sitH[i] > 0 ? groundAt(px[i] + Math.sin(yaw[i]) * 0.45, pz[i] + Math.cos(yaw[i]) * 0.45) : groundAt(px[i], pz[i]), dy = onSeat[i] === 2 ? 0 : py[i] - lift[i] - fy;
        if (dy < -0.15) { below++; if (belowAt.length < 5) belowAt.push([i, kn[kind[i]], +px[i].toFixed(1), +pz[i].toFixed(1), +dy.toFixed(2)]); } else if (dy > 0.15) { floating++; if (floatAt.length < 5) floatAt.push([i, kn[kind[i]], +px[i].toFixed(1), +pz[i].toFixed(1), +dy.toFixed(2)]); }
        if (walking(i) && stuckN[i] >= 1) { stuck++; if (stuckAt.length < 8) stuckAt.push([i, kn[kind[i]], mode[i], +px[i].toFixed(1), +pz[i].toFixed(1)]); }
        if (walking(i) && spd[i] > 0.2) { ws += spd[i]; wc++; }
      }
      let avg = 0, mx = 0; const nn = Math.min(updK, 120); for (let k = 0; k < nn; k++) { avg += updMs[k]; mx = Math.max(mx, updMs[k]); }
      return { count, byState, byKind, insideColliders: inside, seatedOnFurniture: seated, belowGround: below, belowAt, floating, floatAt, stuckWalkers: stuck, stuckAt, avgWalkSpeed: +(wc ? ws / wc : 0).toFixed(2),
        updateMsAvg: +(avg / Math.max(1, nn)).toFixed(3), updateMsMax: +mx.toFixed(3), drawn: Array.from(counts), trisPerFigure: meshes.map(m => m.userData.tris), routes: routes.map(r => [r.n, Math.round(r.len)]), nav: { nodes: NN, links: adjTo.length / 2, streetEdges: streetEdges.length, freeNodes: freeIds.length }, buildMs: Math.round(buildMs), placed: cnt, stages };
    },
    // positions of a few people doing something (for screenshots / tests)
    find(state, max = 5, a = -1) { const out = []; for (let i = 0; i < count && out.length < max; i++) if (stateName(i) === state && (a < 0 || arch[i] === a)) out.push({ i, a: arch[i], x: +px[i].toFixed(1), y: +py[i].toFixed(2), z: +pz[i].toFixed(1), yaw: +yaw[i].toFixed(2) }); return out; },
    // line people up in front of the camera for pose checks: items [{a, sit, act, prop, flags, gait, phase, head}]
    stage(x, z, ry, items, from = 0) { items.forEach((it, q) => { const i = from + q, o = (q - (items.length - 1) / 2) * 1.3; frozen[i] = 1; px[i] = x + Math.cos(ry) * o; pz[i] = z - Math.sin(ry) * o; yaw[i] = faceYaw[i] = baseYaw[i] = ry; kind[i] = K.SOLO; mode[i] = MD.IDLE; timer[i] = 1e9; curious[i] = 0; grp[i] = -1; arch[i] = it.a ?? arch[i]; if (it.flags !== undefined) flagsB[i] = it.flags; exoB[i] = it.exo ? 1 : 0; if (it.seed !== undefined) seedP[i] = it.seed; if (it.sc) sc[i] = it.sc; sitH[i] = it.sit || 0; act[i] = it.act || 0; actW[i] = actWT[i] = it.act ? 1 : 0; prop[i] = it.prop || 0; gest[i] = gestT[i] = it.gest || 0; headA[i] = headT[i] = it.head || 0; lift[i] = 0.02; py[i] = groundAt(px[i], pz[i]) + 0.02; if (it.gait) { mode[i] = MD.IDLE; gait[i] = it.gait; phase[i] = it.phase || 0; } }); for (let g = 0; g < nG; g++) gTim[g] = 1e9; },
    inspect(i) { return { k: Object.keys(K)[kind[i]], mode: mode[i], st: st[i], x: +px[i].toFixed(2), z: +pz[i].toFixed(2), tx: +tgx[i].toFixed(1), tz: +tgz[i].toFixed(1), spd: +spd[i].toFixed(2), timer: +timer[i].toFixed(1), pIdx: pIdx[i], pLen: pLen[i], blockT: +blockT[i].toFixed(2), stuckN: stuckN[i], act: act[i], actW: +actW[i].toFixed(2), tether: tether[i], onSeat: onSeat[i], sitH: +sitH[i].toFixed(2), hx: [hx0[i], hx1[i], hz0[i], hz1[i]].map(v => Math.round(v)) }; },
    doorSeat(x, z, nx, nz, lat = 0, stepTop = null) { return doorSeat({ x, z, nx, nz, stepTop }, lat); },
    sitters() { const out = []; for (let i = 0; i < count; i++) if (sitH[i] > 0) { const f = sitH[i] <= 0.15 && ((seedP[i] * 0.99 * 7.3) % 1) < 0.5 && act[i] !== ACT.MEND; out.push({ i, h: sitH[i], ku: f, edge: onSeat[i] === 2, door: kind[i] !== K.PRAY && onSeat[i] === 0 && doorList.some(d => Math.hypot(d.x - px[i], d.z - pz[i]) < 2.2), x: +px[i].toFixed(1), z: +pz[i].toFixed(1) }); } return out; },
    // the camera in front of person i: dist metres out along their facing turned by side degrees, h above the ground there
    look(i, dist = 3, h = 1.5, side = 0, pitch = -8) { const a = yaw[i] + side * Math.PI / 180, cx = px[i] + Math.sin(a) * dist, cz = pz[i] + Math.cos(a) * dist; if (typeof window !== 'undefined' && window.__setView) window.__setView(cx, world.groundHeight(cx, cz) + h, cz, a * 180 / Math.PI, pitch); return [cx, cz]; },
    // everyone within r of (x, z), for the sound and the overheard talk (src/life/): who they are and what they are doing.
    // talking: holds the floor in their group (or is an orator); hammerT: the time offset of their hammer swing (the strike lands
    // where fract((t + hammerT) * 0.85) passes 0.8, t = the clock people.update was given), -1 when not hammering
    listen(x, z, r = 25) {
      const out = [], R2 = r * r, c = Math.ceil(r / HC), ix = Math.floor(x / HC), iz = Math.floor(z / HC), kn = Object.keys(K);
      for (let ox = -c; ox <= c; ox++) for (let oz = -c; oz <= c; oz++) for (let j = hHead[hIdx(ix + ox, iz + oz)]; j >= 0; j = hNext[j]) {
        const dx = px[j] - x, dz = pz[j] - z, d2 = dx * dx + dz * dz; if (d2 >= R2 || Math.floor(px[j] / HC) !== ix + ox || Math.floor(pz[j] / HC) !== iz + oz) continue;
        const g = grp[j], hammer = act[j] === ACT.HAMMER && actW[j] > 0.5;
        out.push({ i: j, x: px[j], y: py[j], z: pz[j], yaw: yaw[j], d: Math.sqrt(d2), kind: kn[kind[j]], arch: arch[j], female: arch[j] === 2, child: !!(flagsB[j] & FL.CHILD),
          walking: mode[j] !== MD.IDLE, speed: spd[j], group: g, groupSize: g >= 0 ? gLen[g] : 1, talking: !!orator[j] || (g >= 0 && gCur[g] === j && mode[j] === MD.IDLE), orator: !!orator[j],
          act: act[j], hammerT: hammer ? seedP[j] * 0.99 * 97 : -1, state: stateName(j), seed: seedP[j] });
      }
      return out;
    },
    // person i says something for dur seconds: they gesture while it lasts, keep still, and (given a point) turn their head to it
    speak(i, dur, lookX, lookZ) {
      if (!(i >= 0 && i < count) || frozen[i]) return;
      talkT[i] = dur; gestT[i] = 1; if (mode[i] === MD.IDLE) timer[i] = Math.max(timer[i], dur);
      if (lookX !== undefined) { headT[i] = clamp(wrap(Math.atan2(lookX - px[i], lookZ - pz[i]) - yaw[i]), -1.15, 1.15); lookP[i] = 1; }
    },
    near(x, z, r = 20) { const out = []; for (let i = 0; i < count; i++) if ((px[i] - x) ** 2 + (pz[i] - z) ** 2 < r * r) out.push({ i, s: stateName(i), x: +px[i].toFixed(1), z: +pz[i].toFixed(1), yaw: +yaw[i].toFixed(2) }); return out; },
  };
  const buildMs = perf.now() - tBuild;
  return api;
}
