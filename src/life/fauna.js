// The animals of Halicarnassus: street dogs, hens round the poultry sellers, the pens and the farmyards, flocks of sheep and
// goats grazing beyond the walls, and strings of pack donkeys and mules on the roads.
//
// Rendering: one InstancedMesh per species (dog, hen, sheep, goat, donkey), all on one animated material. Every vertex knows
// its part (body, head, tail, one of four legs, a wing, the load), a colour slot and the joints it turns about: aPA the
// shoulder / hip / neck base / tail root / wing root (w: how far the neck bends), aPB the knee or hock / the poll (w: how far
// the lower leg folds or the head bends), aPC a jaw hinge or an ear root (w: sub-part + 10 × what the instance must have
// for the piece to show: pricked or drop ears, a rooster's comb, a bell, horns, a load). Per instance: iPos (x, y, z, yaw),
// iAnim (gait phase, stride, head pitch, head yaw), iAct (action + weight, pose + weight, tail wag, body pitch), iLook
// (packed coat colours, flags, seed) and iMisc (scale, tail raise, walk ↔ trot, species). Coat patterns (brindle, piebald,
// a dark saddle, a donkey's pale belly) are painted per fragment from the rest-pose position. Only animals in view and in
// range are packed each frame.
//
// Simulation: struct-of-arrays with one state machine per species. Dogs trot the open street edges, stop to sniff, scratch,
// sit, lie down in the shade of walls, greet each other, trail a passer-by, and one at a time may follow the player; guard
// dogs lie at doors and bark at the player; hens peck and scratch round their spot and scatter from feet with a flap; herds
// drift across open pasture outside the walls, grazing a step at a time, bell-wethers clanking; donkey strings walk out-and-
// back loops along the roads, heads nodding. Animals far from the camera update less often; beyond 420 m they sleep.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp, smoothstep, TAU } from '../util.js';
import { SEA, slopeAt } from '../terrain.js';
import { insideWalls, WALL } from '../city.js';

const SP = { DOG: 0, HEN: 1, SHEEP: 2, GOAT: 3, DONKEY: 4 }, SPN = ['dog', 'hen', 'sheep', 'goat', 'donkey'];
// L: leg length (m, at scale 1) for the stride; a0 + ak·v/L: the stride angle, up to amax; rad: the nose probe; range: drawn
// out to; cap: instances drawn; hk: how quickly the head follows its target
const SPEC = [
  { L: 0.5, a0: 0.16, ak: 0.075, amax: 0.62, rad: 0.36, range: 170, cap: 64, hk: 5 },
  { L: 0.14, a0: 0.22, ak: 0.05, amax: 0.72, rad: 0.12, range: 95, cap: 150, hk: 14 },
  { L: 0.48, a0: 0.15, ak: 0.085, amax: 0.42, rad: 0.42, range: 650, cap: 150, hk: 2.5 },
  { L: 0.52, a0: 0.15, ak: 0.085, amax: 0.45, rad: 0.4, range: 650, cap: 90, hk: 3 },
  { L: 0.86, a0: 0.16, ak: 0.1, amax: 0.4, rad: 0.7, range: 420, cap: 16, hk: 2.5 },
];
const PT = { BODY: 0, HEAD: 1, TAIL: 2, LF: 3, RF: 4, LH: 5, RH: 6, WINGL: 7, WINGR: 8, LOAD: 9 };
const SL = { COAT: 0, DARK: 1, PALE: 2, HORN: 3, RED: 4, YELLOW: 5, FACE: 6, TAILF: 7, WICKER: 8, CLOTH: 9, CLAY: 10, WOOD: 11, PRODUCE: 12, BRONZE: 13, MANE: 14, SACK: 15, HACKLE: 16, EYE: 17, LEG: 18, BARREL: 19 };
const SUB = { NONE: 0, JAW: 1, EARL: 2, EARR: 3, NECK: 4 };
const VIS = { ALL: 0, PRICK: 1, DROP: 2, ROOSTER: 3, HEN: 4, BELL: 5, HORNS: 6, BEARD: 7, PANNIER: 8, AMPH: 9, WOOD: 10, SACKS: 11, LOADED: 12 };
const FL = { PRICK: 1, ROOSTER: 2, BELL: 4, HORNS: 8, BEARD: 16, LOAD: 32, BRINDLE: 256, PIEBALD: 512, SADDLE: 1024, STOCKY: 2048, BELLY: 8192 };
const LOAD = { NONE: 0, PANNIER: 1, AMPH: 2, WOOD: 3, SACKS: 4 };
const ACT = { NONE: 0, SCRATCH: 1, BARK: 2, PANT: 3, CHEW: 4, CALL: 5, PECK: 6, RAKE: 7, FLAP: 8 };   // CALL: a bleat, a bray, a crow
const POSE = { STAND: 0, LIE: 1, SIT: 2 };

// ---------- geometry (rest pose: facing +Z, left side at +X, feet on y = 0) ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const place = (g, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => g.applyMatrix4(_m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)));
const O4 = [0, 0, 0, 0];
// a piece of an animal: part, colour slot and { A, B, C: joints [x, y, z, w], sub, vis, t } (t: 0 above the knee, 1 below it;
// along a tail the fraction from the root; on the head the neck's stretch when it reaches down to graze)
function T(g, part, slot, o = {}) {
  const at = g.attributes.aT, n = g.attributes.position.count, A = o.A || O4, B = o.B || O4, C = o.C || O4;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  const info = new Float32Array(n * 3), pa = new Float32Array(n * 4), pb = new Float32Array(n * 4), pc = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    info[i * 3] = part; info[i * 3 + 1] = slot; info[i * 3 + 2] = o.t !== undefined ? o.t : at ? at.getX(i) : 0;
    for (let k = 0; k < 3; k++) { pa[i * 4 + k] = A[k]; pb[i * 4 + k] = B[k]; pc[i * 4 + k] = C[k]; }
    pa[i * 4 + 3] = A[3] || 0; pb[i * 4 + 3] = B[3] || 0; pc[i * 4 + 3] = (o.sub || 0) + 10 * (o.vis || 0);
  }
  g.setAttribute('aInfo', new THREE.BufferAttribute(info, 3)); g.setAttribute('aPA', new THREE.BufferAttribute(pa, 4)); g.setAttribute('aPB', new THREE.BufferAttribute(pb, 4)); g.setAttribute('aPC', new THREE.BufferAttribute(pc, 4));
  return g;
}
// a tube through points (radius r or [across, in the plane of the bend]); aT = fraction of the length; caps true | false | 'start' | 'end'
function tube(pts, radii, segs, caps = true) {
  const pos = [], tv = [], idx = [], n = pts.length, acc = [0];
  for (let i = 1; i < n; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  const L = acc[n - 1] || 1, TT = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl; TT.push([tx, ty, tz]);
    // u: the x axis (or y) made square to the tube, v = t × u; so a tube in the body's mid-plane keeps its width along x
    let ux, uy, uz; if (Math.abs(tx) < 0.95) { ux = 1 - tx * tx; uy = -tx * ty; uz = -tx * tz; } else { ux = -ty * tx; uy = 1 - ty * ty; uz = -ty * tz; }
    const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const vx = ty * uz - tz * uy, vy = tz * ux - tx * uz, vz = tx * uy - ty * ux, r = radii[i], ru = Array.isArray(r) ? r[0] : r, rv = Array.isArray(r) ? r[1] : r;
    for (let j = 0; j < segs; j++) { const an = j / segs * TAU, c = Math.cos(an) * ru, s = Math.sin(an) * rv; pos.push(pts[i][0] + ux * c + vx * s, pts[i][1] + uy * c + vy * s, pts[i][2] + uz * c + vz * s); tv.push(acc[i] / L); }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++) { const a = i * segs + j, b = i * segs + (j + 1) % segs; idx.push(a, b, a + segs, b, b + segs, a + segs); }
  for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
    if (!caps || (caps === 'start' && dir > 0) || (caps === 'end' && dir < 0)) continue;
    const r = radii[i], rr = Array.isArray(r) ? Math.min(...r) : r, c = pos.length / 3, base = i * segs, t = TT[i];
    pos.push(pts[i][0] + t[0] * dir * rr * 0.6, pts[i][1] + t[1] * dir * rr * 0.6, pts[i][2] + t[2] * dir * rr * 0.6); tv.push(dir > 0 ? 1 : 0);
    for (let j = 0; j < segs; j++) { const a = base + j, b = base + (j + 1) % segs; if (dir > 0) idx.push(a, b, c); else idx.push(b, a, c); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aT', new THREE.Float32BufferAttribute(tv, 1)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// a body round the z axis through rings [z, y, rx, ry], tail end first
const loft = (R, segs, caps = true) => tube(R.map(r => [0, r[1], r[0]]), R.map(r => [r[2], r[3]]), segs, caps);
const ell = (rx, ry, rz, x, y, z, ws = 6, hs = 4, ax = 0, ay = 0, az = 0) => { const g = new THREE.SphereGeometry(1, ws, hs); g.deleteAttribute('uv'); g.scale(rx, ry, rz); return place(g, x, y, z, ax, ay, az); };
const cone = (r, h, segs, x, y, z, ax = 0, ay = 0, az = 0) => { const g = new THREE.ConeGeometry(r, h, segs); g.deleteAttribute('uv'); return place(g, x, y, z, ax, ay, az); };
const cyl = (r0, r1, h, segs, x, y, z, ax = 0, ay = 0, az = 0) => { const g = new THREE.CylinderGeometry(r1, r0, h, segs); g.deleteAttribute('uv'); return place(g, x, y, z, ax, ay, az); };
const bx = (w, h, d, x, y, z, ax = 0, ay = 0, az = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.deleteAttribute('uv'); return place(g, x, y, z, ax, ay, az); };
// wool: the surface pushed in and out round the axis of the body (y = cy)
function woolly(g, a, cy, f = 1) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + a * (Math.sin(x * 29 * f + z * 7) * Math.sin(y * 31 * f + z * 17) + 0.6 * Math.sin(z * 41 * f + x * 13 - y * 5)); p.setXYZ(i, x * k, cy + (y - cy) * k, z); }
  g.computeVertexNormals(); return g;
}
// four legs: [shoulder / hip joint, knee or hock, points above it, points below it, radii], one pair mirrored
function legs(L, s, front, J, K, up, lo, ru, rl, slot, foot) {
  const part = front ? (s > 0 ? PT.LF : PT.RF) : (s > 0 ? PT.LH : PT.RH), M = p => [s * p[0], p[1], p[2]];
  const A = [s * J[0], J[1], J[2], 0], B = [s * K[0], K[1], K[2], K[3]];
  L.push(T(tube(up.map(M), ru, 6, false), part, slot, { A, B, t: 0 }));
  L.push(T(tube(lo.map(M), rl, 6, false), part, slot, { A, B, t: 1 }));
  L.push(T(ell(rl[0] * 1.05, rl[0] * 1.05, rl[0] * 1.05, s * K[0], K[1], K[2], 5, 3), part, slot, { A, B, t: 1 }));   // (the joint, so the fold shows no gap)
  if (foot) L.push(T(foot(s), part, foot.slot ?? slot, { A, B, t: 1 }));
}
function build1(L) { const g = mergeGeometries(L, false); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5); return g; }

function dogGeometry() {
  const L = [], NB = [0, 0.56, 0.29, 0.75], PO = [0, 0.72, 0.415, 0.5], H = { A: NB, B: PO, t: 0.9 };
  // body: rump → chest, a deep chest and a tucked-up waist
  L.push(T(loft([[-0.38, 0.52, 0.02, 0.02], [-0.355, 0.515, 0.08, 0.085], [-0.27, 0.505, 0.106, 0.105], [-0.12, 0.51, 0.094, 0.09], [0.04, 0.49, 0.106, 0.122], [0.19, 0.465, 0.118, 0.155], [0.3, 0.5, 0.1, 0.128], [0.365, 0.545, 0.055, 0.07]], 12), PT.BODY, SL.COAT));
  L.push(T(tube([[0, 0.53, 0.26], [0, 0.635, 0.355], [0, 0.71, 0.425]], [[0.078, 0.092], [0.066, 0.074], [0.057, 0.06]], 8, false), PT.HEAD, SL.COAT, { ...H, sub: SUB.NECK }));
  // head: skull, muzzle, nose, eyes, the lower jaw on its hinge, pricked or dropped ears
  L.push(T(ell(0.063, 0.064, 0.078, 0, 0.742, 0.45, 8, 6), PT.HEAD, SL.COAT, H));
  L.push(T(tube([[0, 0.735, 0.48], [0, 0.72, 0.55], [0, 0.708, 0.612]], [[0.042, 0.04], [0.033, 0.03], [0.024, 0.021]], 7, 'end'), PT.HEAD, SL.COAT, H));
  L.push(T(ell(0.02, 0.016, 0.014, 0, 0.713, 0.618, 5, 3), PT.HEAD, SL.DARK, H));
  for (const s of [-1, 1]) L.push(T(ell(0.012, 0.011, 0.008, s * 0.036, 0.76, 0.505, 4, 3), PT.HEAD, SL.EYE, H));
  L.push(T(tube([[0, 0.694, 0.48], [0, 0.686, 0.597]], [[0.026, 0.012], [0.017, 0.008]], 5), PT.HEAD, SL.COAT, { ...H, C: [0, 0.7, 0.465], sub: SUB.JAW }));
  for (const s of [-1, 1]) {
    const sub = s > 0 ? SUB.EARL : SUB.EARR;
    L.push(T(cone(0.028, 0.07, 4, s * 0.04, 0.808, 0.428, -0.25, 0, -s * 0.32), PT.HEAD, SL.COAT, { ...H, C: [s * 0.034, 0.78, 0.435], sub, vis: VIS.PRICK }));
    L.push(T(ell(0.013, 0.05, 0.034, s * 0.068, 0.742, 0.428, 5, 3, 0.1, 0, s * 0.3), PT.HEAD, SL.COAT, { ...H, C: [s * 0.055, 0.78, 0.435], sub, vis: VIS.DROP }));
  }
  // legs: shoulder → elbow → carpus, hip → stifle → hock; below the joint the pastern and paw
  const paw = z => s => ell(0.029, 0.021, 0.04, s * 0.08, 0.021, z, 6, 3);
  for (const s of [-1, 1]) {
    legs(L, s, true, [0.08, 0.47, 0.22], [0.08, 0.115, 0.212, 1.8], [[0.082, 0.5, 0.2], [0.084, 0.315, 0.185], [0.08, 0.115, 0.212]], [[0.08, 0.115, 0.212], [0.08, 0.03, 0.232]], [0.056, 0.04, 0.026], [0.025, 0.022], SL.COAT, paw(0.25));
    legs(L, s, false, [0.076, 0.49, -0.26], [0.076, 0.135, -0.3, 1.4], [[0.076, 0.52, -0.26], [0.08, 0.31, -0.2], [0.076, 0.135, -0.3]], [[0.076, 0.135, -0.3], [0.076, 0.03, -0.285]], [0.072, 0.047, 0.028], [0.025, 0.022], SL.COAT, paw(-0.265));
  }
  L.push(T(tube([[0, 0.525, -0.35], [0, 0.495, -0.45], [0, 0.435, -0.53], [0, 0.355, -0.575]], [0.028, 0.022, 0.016, 0.01], 5, 'end'), PT.TAIL, SL.COAT, { A: [0, 0.525, -0.35, 0] }));
  return build1(L);
}

function henGeometry() {
  const L = [], NB = [0, 0.235, 0.07, 1.0], PO = [0, 0.33, 0.11, 0.7], H = { A: NB, B: PO, t: 0.9 };
  L.push(T(loft([[-0.155, 0.245, 0.018, 0.022], [-0.125, 0.228, 0.062, 0.072], [-0.075, 0.207, 0.084, 0.092], [0.0, 0.198, 0.09, 0.098], [0.06, 0.208, 0.083, 0.09], [0.1, 0.228, 0.064, 0.07], [0.128, 0.25, 0.036, 0.045]], 10), PT.BODY, SL.COAT));
  L.push(T(ell(0.022, 0.075, 0.062, 0, 0.292, -0.128, 6, 4, -0.55), PT.TAIL, SL.COAT, { A: [0, 0.25, -0.1, 0], vis: VIS.HEN, t: 0.8 }));
  for (const [x, s] of [[0, 1], [0.014, 0.85], [-0.014, 0.9]]) L.push(T(tube([[x, 0.27, -0.11], [x, 0.4 * s + 0.03, -0.17], [x, 0.43 * s, -0.27], [x, 0.36 * s, -0.33], [x, 0.26 * s, -0.33]], [[0.008, 0.03], [0.008, 0.035], [0.007, 0.03], [0.006, 0.022], [0.004, 0.01]], 4, false), PT.TAIL, SL.TAILF, { A: [0, 0.25, -0.1, 0], vis: VIS.ROOSTER }));
  L.push(T(tube([[0, 0.225, 0.055], [0, 0.29, 0.095], [0, 0.34, 0.112]], [[0.052, 0.05], [0.039, 0.037], [0.029, 0.028]], 7, false), PT.HEAD, SL.HACKLE, { ...H, sub: SUB.NECK }));
  L.push(T(ell(0.031, 0.033, 0.038, 0, 0.35, 0.118, 7, 5), PT.HEAD, SL.COAT, H));
  L.push(T(cone(0.012, 0.036, 4, 0, 0.345, 0.165, Math.PI / 2 + 0.15), PT.HEAD, SL.YELLOW, H));
  L.push(T(bx(0.008, 0.024, 0.042, 0, 0.387, 0.12), PT.HEAD, SL.RED, { ...H, vis: VIS.HEN }));
  L.push(T(bx(0.01, 0.055, 0.075, 0, 0.402, 0.115), PT.HEAD, SL.RED, { ...H, vis: VIS.ROOSTER }));
  L.push(T(ell(0.01, 0.02, 0.012, 0, 0.312, 0.148, 4, 3), PT.HEAD, SL.RED, H));
  for (const s of [-1, 1]) L.push(T(ell(0.006, 0.006, 0.005, s * 0.028, 0.357, 0.135, 4, 3), PT.HEAD, SL.EYE, H));
  for (const s of [-1, 1]) L.push(T(ell(0.02, 0.055, 0.1, s * 0.07, 0.218, -0.02, 7, 4, 0.25), s > 0 ? PT.WINGL : PT.WINGR, SL.COAT, { A: [s * 0.06, 0.25, 0.04, 0] }));
  for (const s of [-1, 1]) {
    const part = s > 0 ? PT.LH : PT.RH, A = [s * 0.035, 0.15, 0.0, 0], B = [s * 0.035, 0.1, 0.0, 0];
    L.push(T(ell(0.03, 0.04, 0.04, s * 0.04, 0.135, 0.0, 6, 3), part, SL.COAT, { A, B, t: 0 }));
    L.push(T(tube([[s * 0.036, 0.11, 0.0], [s * 0.036, 0.012, 0.012]], [0.009, 0.008], 4, false), part, SL.YELLOW, { A, B, t: 0 }));
    for (const a of [-0.45, 0, 0.45, Math.PI]) L.push(T(bx(0.008, 0.006, 0.05, s * 0.036 + Math.sin(a) * 0.022, 0.006, 0.012 + Math.cos(a) * 0.022, 0, a), part, SL.YELLOW, { A, B, t: 0 }));
  }
  return build1(L);
}

// sheep and goats share the plan of a small ruminant; the sheep's wool, the goat's horns and beard make the difference
function ruminantGeometry(goat) {
  const L = [];
  const NB = goat ? [0, 0.62, 0.3, 1.2] : [0, 0.56, 0.33, 1.25], PO = goat ? [0, 0.86, 0.43, 0.5] : [0, 0.7, 0.45, 0.55], H = { A: NB, B: PO, t: goat ? 1.0 : 1.3 };
  if (goat) {
    L.push(T(loft([[-0.41, 0.655, 0.03, 0.035], [-0.38, 0.65, 0.115, 0.125], [-0.26, 0.64, 0.14, 0.16], [0.0, 0.625, 0.148, 0.18], [0.2, 0.63, 0.14, 0.175], [0.32, 0.665, 0.108, 0.14], [0.38, 0.7, 0.05, 0.07]], 10), PT.BODY, SL.COAT));
    L.push(T(tube([[0, 0.64, 0.28], [0, 0.76, 0.37], [0, 0.85, 0.425]], [[0.065, 0.085], [0.055, 0.065], [0.048, 0.052]], 7, false), PT.HEAD, SL.COAT, { ...H, sub: SUB.NECK }));
    L.push(T(ell(0.054, 0.062, 0.078, 0, 0.88, 0.46, 7, 5, 0.5), PT.HEAD, SL.COAT, H));
    L.push(T(tube([[0, 0.87, 0.49], [0, 0.83, 0.56], [0, 0.8, 0.605]], [[0.04, 0.042], [0.034, 0.034], [0.024, 0.024]], 6, 'end'), PT.HEAD, SL.FACE, H));
    L.push(T(tube([[0, 0.8, 0.525], [0, 0.79, 0.575]], [[0.02, 0.01], [0.014, 0.008]], 4), PT.HEAD, SL.FACE, { ...H, C: [0, 0.81, 0.51], sub: SUB.JAW }));
    L.push(T(cone(0.018, 0.1, 4, 0, 0.745, 0.54, Math.PI - 0.25), PT.HEAD, SL.MANE, { ...H, C: [0, 0.81, 0.51], sub: SUB.JAW, vis: VIS.BEARD }));
    for (const s of [-1, 1]) {
      L.push(T(ell(0.06, 0.013, 0.024, s * 0.07, 0.885, 0.45, 4, 3, 0, 0, -s * 0.35), PT.HEAD, SL.COAT, { ...H, C: [s * 0.04, 0.89, 0.45], sub: s > 0 ? SUB.EARL : SUB.EARR }));
      L.push(T(tube([[s * 0.025, 0.92, 0.45], [s * 0.04, 0.99, 0.42], [s * 0.055, 1.03, 0.36], [s * 0.065, 1.02, 0.3]], [0.017, 0.013, 0.009, 0.004], 4, 'end'), PT.HEAD, SL.HORN, { ...H, vis: VIS.HORNS }));
      L.push(T(ell(0.01, 0.01, 0.008, s * 0.036, 0.9, 0.5, 4, 3), PT.HEAD, SL.EYE, H));
    }
    L.push(T(cyl(0.022, 0.018, 0.05, 5, 0, 0.62, 0.37), PT.HEAD, SL.BRONZE, { ...H, sub: SUB.NECK, vis: VIS.BELL }));
    for (const s of [-1, 1]) {
      const hoof = z => Object.assign(s2 => cyl(0.022, 0.018, 0.035, 5, s2 * 0.085, 0.018, z), { slot: SL.DARK });
      legs(L, s, true, [0.085, 0.52, 0.24], [0.085, 0.24, 0.245, 1.7], [[0.085, 0.55, 0.24], [0.088, 0.38, 0.235], [0.085, 0.24, 0.245]], [[0.085, 0.24, 0.245], [0.085, 0.035, 0.25]], [0.042, 0.03, 0.022], [0.019, 0.017], SL.LEG, hoof(0.25));
      legs(L, s, false, [0.082, 0.56, -0.28], [0.082, 0.24, -0.34, 1.2], [[0.082, 0.58, -0.28], [0.085, 0.4, -0.25], [0.082, 0.24, -0.34]], [[0.082, 0.24, -0.34], [0.082, 0.035, -0.325]], [0.058, 0.036, 0.022], [0.019, 0.017], SL.LEG, hoof(-0.325));
    }
    L.push(T(tube([[0, 0.71, -0.38], [0, 0.77, -0.43], [0, 0.79, -0.46]], [0.024, 0.017, 0.008], 4, 'end'), PT.TAIL, SL.COAT, { A: [0, 0.71, -0.38, 0] }));
  } else {
    L.push(T(woolly(loft([[-0.46, 0.6, 0.04, 0.04], [-0.43, 0.6, 0.165, 0.165], [-0.31, 0.6, 0.232, 0.222], [-0.05, 0.6, 0.252, 0.236], [0.17, 0.61, 0.246, 0.232], [0.31, 0.63, 0.2, 0.2], [0.41, 0.66, 0.1, 0.11]], 12), 0.035, 0.6), PT.BODY, SL.COAT));
    L.push(T(woolly(tube([[0, 0.57, 0.3], [0, 0.65, 0.39], [0, 0.7, 0.445]], [[0.125, 0.13], [0.1, 0.11], [0.075, 0.08]], 8, false), 0.03, 0.64), PT.HEAD, SL.COAT, { ...H, sub: SUB.NECK }));
    L.push(T(ell(0.056, 0.068, 0.085, 0, 0.71, 0.48, 7, 5, 0.6), PT.HEAD, SL.FACE, H));
    L.push(T(tube([[0, 0.69, 0.52], [0, 0.665, 0.565], [0, 0.645, 0.6]], [[0.045, 0.043], [0.038, 0.034], [0.028, 0.024]], 6, 'end'), PT.HEAD, SL.FACE, H));
    L.push(T(ell(0.068, 0.05, 0.06, 0, 0.755, 0.45, 6, 4), PT.HEAD, SL.COAT, H));
    L.push(T(tube([[0, 0.655, 0.525], [0, 0.635, 0.58]], [[0.022, 0.01], [0.015, 0.008]], 4), PT.HEAD, SL.FACE, { ...H, C: [0, 0.665, 0.505], sub: SUB.JAW }));
    for (const s of [-1, 1]) {
      L.push(T(ell(0.056, 0.012, 0.024, s * 0.075, 0.72, 0.458, 4, 3, 0, 0, s * 0.4), PT.HEAD, SL.FACE, { ...H, C: [s * 0.045, 0.725, 0.46], sub: s > 0 ? SUB.EARL : SUB.EARR }));
      L.push(T(ell(0.01, 0.01, 0.008, s * 0.038, 0.73, 0.51, 4, 3), PT.HEAD, SL.EYE, H));
    }
    L.push(T(cyl(0.024, 0.02, 0.055, 5, 0, 0.5, 0.42), PT.HEAD, SL.BRONZE, { ...H, sub: SUB.NECK, vis: VIS.BELL }));
    for (const s of [-1, 1]) {
      const hoof = z => Object.assign(s2 => cyl(0.024, 0.02, 0.035, 5, s2 * 0.11, 0.018, z), { slot: SL.DARK });
      legs(L, s, true, [0.11, 0.48, 0.26], [0.11, 0.22, 0.27, 1.6], [[0.11, 0.5, 0.26], [0.112, 0.36, 0.255], [0.11, 0.22, 0.27]], [[0.11, 0.22, 0.27], [0.11, 0.035, 0.278]], [0.046, 0.032, 0.024], [0.021, 0.019], SL.LEG, hoof(0.28));
      legs(L, s, false, [0.1, 0.5, -0.29], [0.1, 0.23, -0.35, 1.2], [[0.1, 0.52, -0.29], [0.103, 0.36, -0.26], [0.1, 0.23, -0.35]], [[0.1, 0.23, -0.35], [0.1, 0.035, -0.332]], [0.06, 0.036, 0.024], [0.021, 0.019], SL.LEG, hoof(-0.33));
    }
    L.push(T(woolly(tube([[0, 0.62, -0.44], [0, 0.5, -0.5], [0, 0.34, -0.5], [0, 0.26, -0.49]], [0.055, 0.048, 0.04, 0.028], 5, 'end'), 0.04, 0.45), PT.TAIL, SL.COAT, { A: [0, 0.62, -0.44, 0] }));
  }
  return build1(L);
}

function donkeyGeometry() {
  const L = [], NB = [0, 1.0, 0.44, 0.9], PO = [0, 1.3, 0.69, 0.55], H = { A: NB, B: PO, t: 0.5 };
  L.push(T(loft([[-0.63, 0.97, 0.06, 0.08], [-0.595, 0.965, 0.2, 0.22], [-0.44, 0.955, 0.25, 0.27], [-0.16, 0.935, 0.238, 0.265], [0.14, 0.925, 0.24, 0.28], [0.36, 0.95, 0.228, 0.27], [0.5, 1.0, 0.17, 0.2], [0.565, 1.04, 0.08, 0.1]], 12), PT.BODY, SL.BARREL));
  L.push(T(tube([[0, 1.0, 0.42], [0, 1.15, 0.56], [0, 1.28, 0.67]], [[0.125, 0.175], [0.105, 0.14], [0.09, 0.105]], 8, false), PT.HEAD, SL.COAT, { ...H, sub: SUB.NECK }));
  L.push(T(tube([[0, 1.14, 0.42], [0, 1.28, 0.55], [0, 1.4, 0.67]], [[0.022, 0.05], [0.02, 0.045], [0.018, 0.03]], 4, false), PT.HEAD, SL.MANE, { ...H, sub: SUB.NECK }));
  L.push(T(tube([[0, 1.33, 0.66], [0, 1.24, 0.8], [0, 1.13, 0.92]], [[0.09, 0.105], [0.078, 0.09], [0.068, 0.075]], 8, false), PT.HEAD, SL.COAT, H));
  L.push(T(ell(0.072, 0.078, 0.075, 0, 1.105, 0.95, 7, 5), PT.HEAD, SL.PALE, H));
  L.push(T(ell(0.03, 0.03, 0.02, 0, 1.09, 1.018, 5, 3), PT.HEAD, SL.DARK, H));
  L.push(T(tube([[0, 1.06, 0.84], [0, 1.045, 0.96]], [[0.05, 0.022], [0.045, 0.02]], 5), PT.HEAD, SL.PALE, { ...H, C: [0, 1.08, 0.82], sub: SUB.JAW }));
  for (const s of [-1, 1]) {
    L.push(T(ell(0.014, 0.014, 0.012, s * 0.07, 1.27, 0.8, 4, 3), PT.HEAD, SL.EYE, H));
    L.push(T(cone(0.042, 0.3, 5, s * 0.07, 1.5, 0.64, -0.35, 0, -s * 0.3), PT.HEAD, SL.COAT, { ...H, C: [s * 0.05, 1.36, 0.67], sub: s > 0 ? SUB.EARL : SUB.EARR }));
    L.push(T(cone(0.014, 0.06, 4, s * 0.105, 1.63, 0.605, -0.35, 0, -s * 0.3), PT.HEAD, SL.DARK, { ...H, C: [s * 0.05, 1.36, 0.67], sub: s > 0 ? SUB.EARL : SUB.EARR }));
  }
  for (const s of [-1, 1]) {
    const hoof = z => Object.assign(s2 => cyl(0.05, 0.042, 0.075, 6, s2 * 0.13, 0.037, z), { slot: SL.DARK });
    legs(L, s, true, [0.13, 0.86, 0.36], [0.13, 0.38, 0.37, 1.5], [[0.13, 0.9, 0.36], [0.132, 0.62, 0.35], [0.13, 0.38, 0.37]], [[0.13, 0.38, 0.37], [0.13, 0.2, 0.375], [0.13, 0.075, 0.385]], [0.085, 0.062, 0.05], [0.045, 0.036, 0.038], SL.COAT, hoof(0.388));
    legs(L, s, false, [0.13, 0.93, -0.42], [0.13, 0.42, -0.5, 1.2], [[0.13, 0.97, -0.42], [0.135, 0.62, -0.33], [0.13, 0.42, -0.5]], [[0.13, 0.42, -0.5], [0.13, 0.22, -0.485], [0.13, 0.075, -0.47]], [0.11, 0.07, 0.048], [0.042, 0.035, 0.038], SL.COAT, hoof(-0.468));
  }
  L.push(T(tube([[0, 1.0, -0.6], [0, 0.88, -0.66], [0, 0.66, -0.68], [0, 0.56, -0.68]], [0.03, 0.022, 0.017, 0.014], 4, false), PT.TAIL, SL.COAT, { A: [0, 1.0, -0.6, 0] }));
  L.push(T(ell(0.035, 0.1, 0.035, 0, 0.5, -0.68, 5, 3), PT.TAIL, SL.MANE, { A: [0, 1.0, -0.6, 0], t: 1 }));
  // loads: a pack saddle and its frame, then baskets, a pair of amphorae, firewood or sacks slung either side
  const LD = (g, slot, vis) => L.push(T(g, PT.LOAD, slot, { vis }));
  LD(bx(0.6, 0.05, 0.62, 0, 1.2, -0.02), SL.CLOTH, VIS.LOADED);
  for (const s of [-1, 1]) LD(bx(0.05, 0.28, 0.55, s * 0.27, 1.07, -0.02, 0, 0, s * 0.25), SL.CLOTH, VIS.LOADED);
  for (const z of [-0.2, 0.16]) LD(bx(0.46, 0.1, 0.05, 0, 1.28, z), SL.WOOD, VIS.LOADED);
  const basket = new THREE.LatheGeometry([[0.001, 0], [0.13, 0.01], [0.18, 0.2], [0.19, 0.36], [0.001, 0.36]].map(([r, y]) => new THREE.Vector2(r, y)), 8); basket.deleteAttribute('uv');
  const amph = new THREE.LatheGeometry([[0.001, 0], [0.03, 0], [0.05, 0.07], [0.15, 0.25], [0.17, 0.42], [0.15, 0.52], [0.07, 0.6], [0.05, 0.72], [0.07, 0.75], [0.001, 0.75]].map(([r, y]) => new THREE.Vector2(r, y)), 8); amph.deleteAttribute('uv');
  for (const s of [-1, 1]) {
    LD(place(basket.clone(), s * 0.4, 0.78, -0.02), SL.WICKER, VIS.PANNIER);
    LD(ell(0.17, 0.08, 0.17, s * 0.4, 1.14, -0.02, 6, 3), SL.PRODUCE, VIS.PANNIER);
    for (const z of [-0.18, 0.14]) LD(place(amph.clone(), s * 0.36, 0.62, z, 0, 0, s * 0.12), SL.CLAY, VIS.AMPH);
    for (let k = 0; k < 7; k++) { const a = k / 7 * TAU; LD(cyl(0.035, 0.035, 1.05, 5, s * (0.38 + Math.cos(a) * 0.07), 1.02 + Math.sin(a) * 0.09, -0.04 + ((k * 37) % 7 - 3) * 0.015, Math.PI / 2), SL.WOOD, VIS.WOOD); }
    LD(cyl(0.12, 0.12, 0.03, 8, s * 0.38, 1.02, 0.25, Math.PI / 2), SL.SACK, VIS.WOOD);
    LD(ell(0.15, 0.25, 0.3, s * 0.37, 0.98, -0.02, 7, 5), SL.SACK, VIS.SACKS);
  }
  return build1(L);
}

// ---------- the animated shader (lit, shadow-depth) ----------
const GLSL = /* glsl */`
attribute vec3 aInfo; attribute vec4 aPA; attribute vec4 aPB; attribute vec4 aPC;
attribute vec4 iPos; attribute vec4 iAnim; attribute vec4 iAct; attribute vec4 iLook; attribute vec4 iMisc;
uniform float uTime;
vec3 fRX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c + v.z * s, -v.y * s + v.z * c); }
vec3 fRY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 fRZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
float fBit(float f, float b) { return mod(floor((f + 0.5) / b), 2.0); }
vec3 fUn(float c) { vec3 k = vec3(floor(c / 65536.0), mod(floor(c / 256.0), 256.0), mod(c, 256.0)) / 255.0; return pow(k, vec3(2.2)); }
float fPeck(float x) { float u = fract(x); return smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.22, 0.5, u)); }   // a quick stab down, a slower lift
bool fHidden(float vis, float fl) {
  if (vis < 0.5) return false;
  float load = mod(floor((fl + 0.5) / 32.0), 8.0);
  if (vis == 1.0) return fBit(fl, 1.0) < 0.5;
  if (vis == 2.0) return fBit(fl, 1.0) > 0.5;
  if (vis == 3.0) return fBit(fl, 2.0) < 0.5;
  if (vis == 4.0) return fBit(fl, 2.0) > 0.5;
  if (vis == 5.0) return fBit(fl, 4.0) < 0.5;
  if (vis == 6.0) return fBit(fl, 8.0) < 0.5;
  if (vis == 7.0) return fBit(fl, 16.0) < 0.5;
  if (vis == 12.0) return load < 0.5;
  return load != vis - 7.0;
}
void fAnimate(inout vec3 p, inout vec3 n) {
  float part = aInfo.x, tt = aInfo.z, fl = iLook.z, vis = floor((aPC.w + 0.5) / 10.0), sub = floor(aPC.w - 10.0 * vis + 0.5);
  if (fHidden(vis, fl)) { p = vec3(0.0, -3000.0, 0.0); return; }
  float ph = iAnim.x, A = iAnim.y, hp = iAnim.z, hy = iAnim.w;
  float act = floor(iAct.x), aw = min(1.0, fract(iAct.x) * 1.0102), pose = floor(iAct.y), pw = min(1.0, fract(iAct.y) * 1.0102);
  float wag = iAct.z, pitch = iAct.w, sc = iMisc.x, tUp = iMisc.y, walkK = iMisc.z, sp = iMisc.w, t = uTime + iLook.w * 97.0;
  bool dog = sp < 0.5, hen = sp > 0.5 && sp < 1.5, hoof = sp > 1.5;
  if (fBit(fl, 2048.0) > 0.5) { p.x *= 1.17; n.x /= 1.17; if (dog && part == 1.0 && sub != 4.0 && p.z > 0.47) { p.z = 0.47 + (p.z - 0.47) * 0.72; p.x *= 1.15; p.y += (0.72 - p.y) * 0.1; } }   // a heavy Molossian build, short in the muzzle
  // hoofed animals nod twice a stride; a hen stabs at the ground, bending from the hips; calls lift the head
  if (hoof) hp += 0.45 * A * sin(2.0 * ph + 0.6);
  float bodyP = 0.0;
  if (hen && act == 6.0) { float k = aw * fPeck(t * 2.2); hp += 1.1 * k; bodyP = 0.55 * k + 0.2 * aw; }
  if (hen && act == 7.0) bodyP = 0.28 * aw;
  if (act == 5.0) hp -= 0.45 * aw;
  if (act == 2.0) hp -= 0.18 * aw;
  if (part >= 3.0 && part <= 6.0) {
    float li = part - 3.0, front = step(li, 1.5), left = 1.0 - mod(li, 2.0);
    // trot: diagonal pairs together; walk: each foot a quarter after the one before (hind, fore of that side, other hind...)
    float off = hen ? (left > 0.5 ? 0.0 : 3.1416) : front > 0.5 ? (left > 0.5 ? 0.0 : 3.1416) - 1.5708 * walkK : (left > 0.5 ? 3.1416 : 0.0);
    float q = ph + off, cq = cos(q), th = A * sin(q), f = A * aPB.w * cq * cq * step(0.0, cq);
    if (hen && act == 7.0) { float r = max(0.0, sin(t * 7.0 + off)); th = mix(th, 0.2 - 1.0 * r * r, aw); }   // raking: each foot scratches back in turn
    if (pose == 1.0) {   // lying: a dog stretches its forelegs out in front; hoofed animals fold all four under
      vec2 Lg = dog ? (front > 0.5 ? vec2(1.25, -0.32) : vec2(1.22, 2.7)) : hen ? vec2(1.2, 0.0) : (front > 0.5 ? vec2(1.0, 2.6) : vec2(1.0, 2.5));
      th = mix(th, Lg.x, pw); f = mix(f, Lg.y, pw);
    } else if (pose == 2.0) {   // sitting (dog): forelegs straight down, hind legs folded forward under the haunch
      vec2 Lg = front > 0.5 ? vec2(-0.74, 0.0) : vec2(0.85, 2.2);
      th = mix(th, Lg.x, pw); f = mix(f, Lg.y, pw);
      if (act == 1.0 && part == 6.0) { th = mix(th, 1.7 + 0.25 * sin(t * 25.0), aw); f = mix(f, 1.0, aw); }   // scratching behind the ear
    }
    vec3 Hp = aPA.xyz, Kn = aPB.xyz;
    if (tt > 0.5) { p = Kn + fRX(p - Kn, -f); n = fRX(n, -f); }
    p = Hp + fRX(p - Hp, th); n = fRX(n, th);
  } else if (part == 1.0) {
    vec3 C = aPC.xyz;
    if (sub == 1.0) {   // the lower jaw: a bark, panting, chewing the cud, a call
      float jo = act == 2.0 ? 0.6 * aw : act == 3.0 ? aw * (0.24 + 0.07 * sin(t * 16.0)) : act == 4.0 ? aw * 0.14 * (0.5 + 0.5 * sin(t * 8.0)) : act == 5.0 ? aw * (0.45 + 0.12 * sin(t * 21.0)) : 0.0;
      p = C + fRX(p - C, -jo); n = fRX(n, -jo);
    } else if (sub == 2.0 || sub == 3.0) {   // ears: a flick now and then (a donkey's swivel), laid back when lying
      float s = sub == 2.0 ? 1.0 : -1.0, fk = pow(max(0.0, sin(t * (hoof ? 0.8 : 1.1) + s * 1.9)), 24.0) * 0.55 + (dog ? 0.35 * pw * float(pose == 1.0) : 0.0);
      p = C + fRZ(fRX(p - C, -fk * 0.6), -s * fk * 0.5); n = fRZ(fRX(n, -fk * 0.6), -s * fk * 0.5);
    }
    vec3 NB = aPA.xyz, PO = aPB.xyz, ax = normalize(PO - NB);
    if (sub != 4.0) { float aH = hp * aPB.w; p = PO + fRX(p - PO, -aH); n = fRX(n, -aH); }
    float st = tt * max(0.0, hp - 0.25);   // reaching down to graze or sniff, the neck stretches
    if (sub == 4.0) p += ax * dot(p - NB, ax) * st; else p += (PO - NB) * st;
    if (hen) { float u = fract(ph / 3.1416), bob = 0.034 * min(1.0, A * 3.0) * (u < 0.3 ? mix(-1.0, 1.0, u / 0.3) : mix(1.0, -1.0, (u - 0.3) / 0.7)); p.z += bob * (sub == 4.0 ? max(0.0, p.y - NB.y) / 0.1 : 1.0); }   // the head thrust forward, then held while the body catches up
    float aN = hp * aPA.w;
    p = NB + fRY(fRX(p - NB, -aN), hy); n = fRY(fRX(n, -aN), hy);
  } else if (part == 2.0) {
    vec3 R = aPA.xyz; float k = 0.35 + 0.65 * tt, w = wag * sin(t * (dog ? 13.0 : hen ? 4.0 : 6.5)) * (0.4 + 0.9 * tt);
    p = R + fRY(fRX(p - R, -tUp * k), w); n = fRY(fRX(n, -tUp * k), w);
  } else if (part == 7.0 || part == 8.0) {
    float s = part == 7.0 ? 1.0 : -1.0, a = act == 8.0 ? aw * (0.95 + 0.85 * sin(t * 34.0)) : 0.0;
    vec3 W = aPA.xyz; p = W + fRZ(p - W, s * a); n = fRZ(n, s * a);
  }
  bool legP = part >= 3.0 && part <= 6.0;
  if (!legP) p.y += (dog ? 0.02 : hen ? 0.008 : 0.012) * A * cos(2.0 * ph);   // the body rises twice a stride
  if (hen && bodyP > 0.0 && !legP) { vec3 Hp = vec3(0.0, 0.15, 0.0); p = Hp + fRX(p - Hp, -bodyP); n = fRX(n, -bodyP); }
  if (pose == 1.0) p.y -= pw * (dog ? 0.33 : sp == 2.0 ? 0.31 : sp == 3.0 ? 0.37 : hen ? 0.07 : 0.0);
  if (pose == 2.0 && dog) { vec3 Hp = vec3(0.0, 0.49, -0.26); float a = 0.74 * pw; p = Hp + fRX(p - Hp, a); n = fRX(n, a); p.y -= 0.28 * pw; }
  p = fRY(fRX(p * sc, pitch), iPos.w) + iPos.xyz; n = fRY(fRX(n, pitch), iPos.w);
}
`;
const GLSL_FRAG = /* glsl */`
varying vec3 vRest; varying vec3 vCA; varying vec3 vCB; varying vec3 vFS;
float fBitF(float f, float b) { return mod(floor((f + 0.5) / b), 2.0); }
vec3 fCol() {
  float slot = floor(vFS.x + 0.5), fl = floor(vFS.y + 0.5), sd = vFS.z; vec3 r = vRest;
  if (slot == 19.0) return mix(vCA, vec3(0.27, 0.24, 0.2), smoothstep(0.8, 0.7, r.y));   // a donkey's pale belly
  if (slot == 0.0) {
    vec3 c = vCA;
    if (fBitF(fl, 256.0) > 0.5) { float s = sin(r.z * 62.0 + 3.0 * sin(r.y * 21.0 + r.x * 7.0) + sd * 30.0) + 0.45 * sin(r.z * 23.0 - r.y * 37.0); c = mix(c, vCB, smoothstep(0.3, 0.8, s)); }   // brindle
    if (fBitF(fl, 512.0) > 0.5) { float m = sin(r.x * 9.0 + sd * 41.0) * sin(r.y * 11.0 + sd * 13.0) * sin(r.z * 8.0 + sd * 29.0) + 0.25 * sin(r.z * 19.0 + r.x * 13.0); c = mix(c, vCB, smoothstep(0.04, 0.1, m)); }   // piebald
    if (fBitF(fl, 1024.0) > 0.5) c = mix(c, vCB, smoothstep(0.56, 0.61, r.y) * (1.0 - smoothstep(0.24, 0.34, abs(r.z + 0.04))));   // a dark saddle
    return c;
  }
  if (slot == 1.0) return vec3(0.022, 0.018, 0.016);
  if (slot == 2.0) return mix(vCA, vec3(0.3, 0.27, 0.22), 0.7);
  if (slot == 3.0) return vec3(0.2, 0.17, 0.13);
  if (slot == 4.0) return vec3(0.45, 0.035, 0.025);
  if (slot == 5.0) return vec3(0.52, 0.36, 0.08);
  if (slot == 6.0 || slot == 18.0) return vCB;
  if (slot == 7.0) return vec3(0.012, 0.028, 0.022);
  if (slot == 8.0) return vec3(0.33, 0.23, 0.11);
  if (slot == 9.0) { float k = fract(sd * 7.31); return k < 0.33 ? vec3(0.32, 0.07, 0.04) : k < 0.66 ? vec3(0.08, 0.1, 0.22) : vec3(0.36, 0.26, 0.1); }
  if (slot == 10.0) return vec3(0.34, 0.12, 0.055);
  if (slot == 11.0) return vec3(0.16, 0.1, 0.055);
  if (slot == 12.0) { float k = fract(sd * 3.7); return k < 0.3 ? vec3(0.45, 0.25, 0.03) : k < 0.55 ? vec3(0.12, 0.2, 0.04) : k < 0.8 ? vec3(0.3, 0.05, 0.08) : vec3(0.5, 0.42, 0.2); }
  if (slot == 13.0) return vec3(0.3, 0.18, 0.06);
  if (slot == 14.0) return vCA * 0.3;
  if (slot == 15.0) return vec3(0.43, 0.38, 0.28);
  if (slot == 16.0) return fBitF(fl, 2.0) > 0.5 ? vec3(0.5, 0.26, 0.05) : vCA;
  if (slot == 17.0) return vec3(0.01, 0.008, 0.006);
  return vCA;
}
`;
function patchMaterial(m, kind, uTime) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL + (kind === 'std' ? 'varying vec3 vRest; varying vec3 vCA; varying vec3 vCB; varying vec3 vFS;\n' : ''));
    if (kind === 'depth') shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); vec3 fN = vec3(0.0, 1.0, 0.0); fAnimate(transformed, fN);');
    else shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 fP = vec3(position); vRest = position; vCA = fUn(iLook.x); vCB = fUn(iLook.y); vFS = vec3(aInfo.y, iLook.z, iLook.w); fAnimate(fP, objectNormal);')
      .replace('#include <begin_vertex>', 'vec3 transformed = fP;');
    if (kind === 'std') shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + GLSL_FRAG).replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= fCol();');
  };
  m.customProgramCacheKey = () => 'fauna-' + kind;
  return m;
}

// ---------- looks (sRGB hex; c. 350 BC Caria) ----------
const DOGS = {
  // Laconian hounds: light, long-legged, pricked ears; Molossians: heavy guard dogs; street mongrels; a Melitan lapdog or two
  laconian: { sc: [0.88, 1.04], ears: 1, cols: [[0xa87a46, 0x3a2a1c], [0x8a5a32, 0x2a1e16], [0x2a231e, 0x2a231e], [0xa06c3a, 0x1e1812, FL.SADDLE], [0x9a7040, 0x2e2218, FL.BRINDLE], [0xc4a676, 0x5a4230]] },
  molossian: { sc: [1.12, 1.3], ears: 0, stocky: true, cols: [[0x201b17, 0x201b17], [0x9c7446, 0x3a2a1e], [0x8a6844, 0x2a2018, FL.BRINDLE], [0xb49a72, 0x4a3a2a], [0x5e5650, 0x2a2622]] },
  street: { sc: [0.78, 0.98], ears: 0.5, cols: [[0xb08850, 0x3a2c20], [0xb8a888, 0x8a6a44, FL.PIEBALD], [0x6a645c, 0x2a2622], [0xbcb2a0, 0x9a7a52, FL.PIEBALD], [0x7a5534, 0x2a2018], [0x2e2822, 0xb08850, FL.PIEBALD], [0xa0703e, 0x201a14, FL.SADDLE]] },
  melitan: { sc: [0.52, 0.6], ears: 0, cols: [[0xc4bcac, 0xb0a48c], [0xc0b49c, 0xa08a68]] },
};
const HENS = [[0x8a5a30, 0x5a3a20], [0x7a3e22, 0x3a2016], [0xc8a060, 0x8a6a3a], [0xc4bcac, 0xb0a490], [0x2e2a26, 0x1a1816], [0xa8a090, 0x2a2622, FL.PIEBALD], [0x9a6a3a, 0x3a2a1a, FL.PIEBALD]];
const SHEEP = [[0xc4b89e, 0x3a3129], [0xbcae92, 0x3a3129], [0xb4a688, 0xb8a88c], [0xc0b49a, 0x2a2420], [0x7e6c58, 0x3a3129], [0x3a3028, 0x2a2420], [0xbaac90, 0x6a5a48]];
const GOATS = [[0x3a2e26, 0x2e2620], [0x6e5238, 0x4a3828], [0xbab09e, 0x9e9482], [0x8f7b66, 0x5a4a3c], [0x4a3f36, 0x2a2420], [0xb8ac98, 0x3a2e26, FL.PIEBALD], [0x6a4a30, 0xb4a894, FL.PIEBALD]];
const DONK = [[0x6a6056, 0x6a6056], [0x564c44, 0x564c44], [0x746858, 0x746858], [0x5e5246, 0x5e5246]], MULES = [[0x5a4030, 0x5a4030], [0x3e3028, 0x3e3028], [0x6a4c34, 0x6a4c34]];

export function build(ctx) {
  const { world, layout } = ctx, people = ctx.people;
  const perf = typeof performance !== 'undefined' ? performance : Date;
  const tBuild = perf.now(), R = rng(4711), RR = rng(9001);
  const pick = a => a[Math.floor(R() * a.length)], range = (a, b) => a + (b - a) * R();
  const gh = (x, z) => world.groundHeight(x, z), blocked = (x, z) => world.blocked(x, z);
  const wrap = a => a - TAU * Math.floor((a + Math.PI) / TAU);
  const clearAt = (x, z, r) => !blocked(x, z) && !blocked(x + r, z) && !blocked(x - r, z) && !blocked(x, z + r) && !blocked(x, z - r);
  const lineClear = (x0, z0, x1, z1, st = 0.5) => { const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(L / st)); for (let k = 1; k <= n; k++) if (blocked(x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n)) return false; return true; };
  const sunX = ctx.sunDir ? ctx.sunDir.x / Math.hypot(ctx.sunDir.x, ctx.sunDir.z) : 0.62, sunZ = ctx.sunDir ? ctx.sunDir.z / Math.hypot(ctx.sunDir.x, ctx.sunDir.z) : 0.78;
  // in the shade of a wall: something solid within a few metres towards the sun (a wall of 3 m throws a 4 m shadow at 38°)
  const shaded = (x, z) => { for (const d of [0.45, 0.9, 1.5, 2.2, 3.0]) if (blocked(x + sunX * d, z + sunZ * d)) return true; return false; };
  const segD = (x, z, x0, z0, x1, z1) => { const dx = x1 - x0, dz = z1 - z0, t = clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(x - x0 - dx * t, z - z0 - dz * t); };
  const roadD = (x, z) => { let d = Infinity; for (const r of layout.roads || []) for (let k = 0; k < r.pts.length - 1; k++) d = Math.min(d, segD(x, z, r.pts[k][0], r.pts[k][1], r.pts[k + 1][0], r.pts[k + 1][1]) - r.width / 2); return d; };
  const wallD = (x, z) => { let d = Infinity; for (let i = 0; i < WALL.length - 1; i++) { const [x0, z0] = WALL[i], [x1, z1] = WALL[i + 1], dx = x1 - x0, dz = z1 - z0, t = clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz), 0, 1); d = Math.min(d, Math.hypot(x - x0 - dx * t, z - z0 - dz * t)); } return d; };

  // ---------- the animals (struct of arrays) ----------
  const N = 420;
  const sp = new Uint8Array(N), px = new Float32Array(N), pz = new Float32Array(N), py = new Float32Array(N), yaw = new Float32Array(N), spd = new Float32Array(N), vpref = new Float32Array(N);
  const phase = new Float32Array(N), gait = new Float32Array(N), hP = new Float32Array(N), hPT = new Float32Array(N), hY = new Float32Array(N), hYT = new Float32Array(N);
  const act = new Uint8Array(N), actW = new Float32Array(N), actWT = new Float32Array(N), pose = new Uint8Array(N), poseW = new Float32Array(N), poseWT = new Float32Array(N);
  const wag = new Float32Array(N), wagT = new Float32Array(N), tUp = new Float32Array(N), tUpT = new Float32Array(N), pitch = new Float32Array(N);
  const md = new Uint8Array(N), sub = new Uint8Array(N), timer = new Float32Array(N), tgx = new Float32Array(N), tgz = new Float32Array(N), grp = new Int16Array(N).fill(-1);
  const flags = new Float32Array(N), colA = new Float32Array(N), colB = new Float32Array(N), seed = new Float32Array(N), scl = new Float32Array(N).fill(1);
  const gX = new Float32Array(N), gZ = new Float32Array(N), gY = new Float32Array(N), gS = new Float32Array(N), gYaw = new Float32Array(N), gEdge = new Uint8Array(N);
  const lastT = new Float32Array(N), blockT = new Float32Array(N), frozen = new Uint8Array(N);
  const e1 = new Int32Array(N).fill(-1), dir = new Int8Array(N).fill(1), lane = new Float32Array(N), laneT = new Float32Array(N), a1 = new Float32Array(N), a2 = new Float32Array(N), a3 = new Float32Array(N);
  const homeX = new Float32Array(N), homeZ = new Float32Array(N), homeYaw = new Float32Array(N), kind = new Uint8Array(N), friendly = new Uint8Array(N), bn = new Uint8Array(N), bt = new Float32Array(N), cool = new Float32Array(N);
  let n = 0;
  function add(s, x, z, ry, look) {
    if (n >= N) return -1;
    const i = n++;
    sp[i] = s; px[i] = x; pz[i] = z; yaw[i] = ry; seed[i] = R(); scl[i] = look.sc || 1; colA[i] = look.a; colB[i] = look.b; flags[i] = look.fl || 0;
    gX[i] = 1e9; ground(i, true); timer[i] = R() * 4; hPT[i] = hP[i] = 0.1; lastT[i] = 0;
    return i;
  }
  const setAct = (i, a, w = 1) => { if (act[i] !== a) { act[i] = a; actW[i] = 0; } actWT[i] = w; };
  const setPose = (i, p) => { if (p) { if (pose[i] !== p && poseW[i] > 0.05) poseW[i] = 0; pose[i] = p; poseWT[i] = 1; } else poseWT[i] = 0; };

  // ground under an animal: sampled every 0.35 m moved (or on turning), extrapolated along the slope in between;
  // a jump of more than 0.45 m ahead (a quay edge, a terrace, water) is an edge it will not walk off
  function ground(i, force = false) {
    const x = px[i], z = pz[i], ox = x - gX[i], oz = z - gZ[i];
    if (force || ox * ox + oz * oz > 0.12 || Math.abs(wrap(yaw[i] - gYaw[i])) > 0.6) {
      const fx = Math.sin(yaw[i]), fz = Math.cos(yaw[i]), r = SPEC[sp[i]].rad * scl[i] + 0.2, y0 = gh(x, z), y1 = gh(x + fx * r, z + fz * r);
      gX[i] = x; gZ[i] = z; gY[i] = y0; gYaw[i] = yaw[i]; gS[i] = clamp((y1 - y0) / r, -1, 1);
      gEdge[i] = Math.abs(y1 - y0) > 0.45 || y1 < SEA + 0.3 ? 1 : 0; if (gEdge[i]) gS[i] = 0;
    }
    const along = (x - gX[i]) * Math.sin(gYaw[i]) + (z - gZ[i]) * Math.cos(gYaw[i]);
    py[i] = gY[i] + gS[i] * clamp(along, 0, 0.6);
  }
  function stride(i, dt) {
    const S = SPEC[sp[i]], L = S.L * scl[i], v = spd[i], A = v < 0.03 ? 0 : clamp(S.a0 + S.ak * v / L, 0.1, S.amax);
    gait[i] += (A - gait[i]) * Math.min(1, dt * 6);
    if (gait[i] > 0.02) phase[i] = (phase[i] + dt * TAU * v / (4 * L * Math.sin(Math.max(gait[i], 0.1)))) % (TAU * 64);
  }
  // forward along yaw at speed v (eased): slides along walls, stops short of people and the player, will not step off an edge
  let plX = 0, plZ = 0, plOn = false, plVX = 0, plVZ = 0, now = 0, frame = 0;
  function go(i, dt, v) {
    spd[i] += (v - spd[i]) * Math.min(1, dt * (v > spd[i] ? 3 : 5));
    const s = spd[i] * dt; if (s < 1e-5) { stride(i, dt); return 0; }
    const fx = Math.sin(yaw[i]), fz = Math.cos(yaw[i]), r = SPEC[sp[i]].rad * scl[i], x = px[i], z = pz[i];
    let nx = x + fx * s, nz = z + fz * s, res = 0;
    if (gEdge[i]) { nx = x; nz = z; res = 1; }
    else if (blocked(nx + fx * r, nz + fz * r)) {
      res = 1;
      if (!blocked(nx + fx * r, z)) nz = z; else if (!blocked(x, nz + fz * r)) nx = x; else { nx = x; nz = z; }
    }
    const db = world.dynamicBlocked;
    if (res !== 1 && db && sp[i] !== SP.HEN && db(nx + fx * r * 0.8, nz + fz * r * 0.8, x + fx * r * 0.8, z + fz * r * 0.8)) { nx = x; nz = z; res = 2; }
    if (plOn && !(sp[i] === SP.DOG && md[i] === DM.HEEL)) { const dx = plX - nx, dz = plZ - nz, rr = 0.4 + r * 0.8; if (dx * dx + dz * dz < rr * rr && dx * fx + dz * fz > 0) { nx = x; nz = z; res = 2; } }
    px[i] = nx; pz[i] = nz;
    if (res) { blockT[i] += dt; spd[i] *= 0.6; } else blockT[i] = Math.max(0, blockT[i] - dt * 0.5);
    ground(i); stride(i, dt);
    return res;
  }
  function steer(i, dt, tx, tz, v, turn = 3.5) {
    const da = wrap(Math.atan2(tx - px[i], tz - pz[i]) - yaw[i]);
    yaw[i] = wrap(yaw[i] + clamp(da, -turn * dt, turn * dt));
    return go(i, dt, v * clamp(1.35 - Math.abs(da) * 0.8, 0.12, 1));
  }
  const faceTo = (i, dt, a, k = 3) => { yaw[i] = wrap(yaw[i] + clamp(wrap(a - yaw[i]), -k * dt, k * dt)); };
  const lookAt = (i, x, z, lim = 1.15) => { hYT[i] = clamp(wrap(Math.atan2(x - px[i], z - pz[i]) - yaw[i]), -lim, lim); };
  const camD2 = i => (px[i] - camX) ** 2 + (pz[i] - camZ) ** 2;
  let camX = 0, camY = 0, camZ = 0;
  const counts = { emitted: {} };
  function emit(type, i, maxD, data, dy = 0.5) {
    if (camD2(i) > maxD * maxD || !ctx.emit) return;
    ctx.emit(type, px[i], py[i] + dy * scl[i] * SPEC[sp[i]].L * 2, pz[i], data); counts.emitted[type] = (counts.emitted[type] || 0) + 1;
  }

  // ---------- dogs: the street graph (open edges, their lanes as wide as is clear) ----------
  const E = [], adjN = new Map();
  for (const e of layout.edges || []) {
    if (!e.open) continue;
    const ax = e.a.x, az = e.a.z, bx2 = e.b.x, bz2 = e.b.z, len = Math.hypot(bx2 - ax, bz2 - az); if (len < 4) continue;
    const ux = (bx2 - ax) / len, uz = (bz2 - az) / len;
    let ok = true; for (let s = 1; s < len - 1 && ok; s += 1.5) if (blocked(ax + ux * s, az + uz * s)) ok = false;
    if (!ok) continue;
    let half = Math.max(0.3, e.width / 2 - 0.7);
    const laneOk = h => { for (let s = 1.5; s < len - 1.5; s += 2) { const x = ax + ux * s, z = az + uz * s; if (blocked(x - uz * h, z + ux * h) || blocked(x + uz * h, z - ux * h)) return false; } return true; };
    while (half > 0.35 && !laneOk(half)) half -= 0.3;
    const k = E.length; E.push({ a: e.a.id, b: e.b.id, ax, az, bx: bx2, bz: bz2, len, ux, uz, half, w: e.width, houses: e.houses || 0, main: !!e.main });
    for (const id of [e.a.id, e.b.id]) { let l = adjN.get(id); if (!l) adjN.set(id, l = []); l.push(k); }
  }
  const DM = { ROAM: 0, PAUSE: 1, LIE: 2, GO: 3, TRAIL: 4, HEEL: 5, GUARD: 6, GREET: 7 };
  const DK = { STREET: 0, AREA: 1, GUARD: 2 };
  const PS = { SNIFF: 0, SCRATCH: 1, SIT: 2, LOOK: 3, BARK: 4, RISE: 5 };
  // squares a dog may idle about in: the agora's lanes and small squares, the platea (free spots found once)
  const areaSpots = [];
  for (const a of layout.areas || []) {
    if (a.private || !/^(agora|platea|quay)$|market lane|civic square/.test(a.name || '')) continue;
    for (let q = 0; q < 30; q++) { const x = lerp(a.minX + 0.8, a.maxX - 0.8, R()), z = lerp(a.minZ + 0.8, a.maxZ - 0.8, R()); if (clearAt(x, z, 0.6)) areaSpots.push([x, z, a.name]); }
  }
  const agoraSpots = areaSpots.filter(s => s[2] !== 'platea' && s[2] !== 'quay');
  function dogLook(type) {
    const T0 = DOGS[type], c = pick(T0.cols);
    let fl = (c[2] || 0) | (T0.stocky ? FL.STOCKY : 0) | (R() < T0.ears ? FL.PRICK : 0);
    return { sc: range(...T0.sc), a: c[0], b: c[1], fl };
  }
  const dogType = () => { const r = R(); return r < 0.36 ? 'laconian' : r < 0.58 ? 'molossian' : r < 0.95 ? 'street' : 'melitan'; };
  function placeOnEdge(i, k, s, ln) {
    const e = E[k]; e1[i] = k; dir[i] = R() < 0.5 ? 1 : -1; lane[i] = laneT[i] = ln;
    const sx = dir[i] > 0 ? e.ax : e.bx, sz = dir[i] > 0 ? e.az : e.bz, ux = e.ux * dir[i], uz = e.uz * dir[i], off = ln * e.half;
    px[i] = sx + ux * s - uz * off; pz[i] = sz + uz * s + ux * off; yaw[i] = Math.atan2(ux, uz); gX[i] = 1e9; ground(i, true);
  }
  const trotV = i => (1.55 + seed[i] * 0.7) * Math.sqrt(scl[i]), walkV = i => 0.85 + seed[i] * 0.25;
  function newDog(k, type) {
    const i = add(SP.DOG, 0, 0, 0, dogLook(type)); if (i < 0) return -1;
    kind[i] = k; friendly[i] = R() < 0.4 ? 1 : 0; vpref[i] = R() < 0.65 ? trotV(i) : walkV(i); tUpT[i] = 0.3; hPT[i] = 0.1; return i;
  }
  // street dogs, weighted to the busy streets; two on the avenue for certain
  const busy = E.map(e => (e.houses + 1) * (e.main ? 3 : 1) * (Math.abs((e.ax + e.bx) / 2 - 60) < 420 && (e.az + e.bz) / 2 > -250 ? 1 : 0.25));
  const busyT = busy.reduce((a, b) => a + b, 0);
  const pickEdge = () => { let r = R() * busyT; for (let k = 0; k < E.length; k++) if ((r -= busy[k]) <= 0) return k; return E.length - 1; };
  if (E.length) {
    const avenue = E.map((e, k) => k).filter(k => Math.abs(E[k].ax - 145) < 1 && Math.abs(E[k].bx - 145) < 1 && Math.min(E[k].az, E[k].bz) > 90 && Math.max(E[k].az, E[k].bz) < 420);
    for (let q = 0; q < 26; q++) { const k = q < 2 && avenue.length ? avenue[q % avenue.length] : pickEdge(), i = newDog(DK.STREET, dogType()); if (i < 0) break; placeOnEdge(i, k, range(2, E[k].len - 2), range(-0.8, 0.8)); md[i] = DM.ROAM; timer[i] = 2 + R() * 12; }
  }
  // dogs about the agora and the platea
  for (let q = 0; q < 4 && agoraSpots.length; q++) { const s = pick(agoraSpots), i = newDog(DK.AREA, dogType()); if (i < 0) break; px[i] = s[0]; pz[i] = s[1]; yaw[i] = R() * TAU; gX[i] = 1e9; ground(i, true); md[i] = DM.PAUSE; sub[i] = PS.LOOK; timer[i] = R() * 5; }
  // guard dogs at house doors on open streets, lying across the threshold
  {
    const doors = (layout.pois || []).filter(p => p.type === 'door' && p.owner === 'residential' && !p.note && p.nx !== undefined), got = [];
    for (const d of doors.sort(() => R() - 0.5)) {
      if (got.length >= 5) break;
      const x = d.x + d.nx * 0.75, z = d.z + d.nz * 0.75;
      if (!clearAt(x, z, 0.45) || got.some(g => Math.hypot(g[0] - x, g[1] - z) < 70) || Math.abs(x - 60) > 500 || z < -300 || z > 380) continue;
      if (!E.some(e => { const t = clamp((x - e.ax) * e.ux + (z - e.az) * e.uz, 0, e.len), ex = e.ax + e.ux * t - x, ez = e.az + e.uz * t - z; return ex * ex + ez * ez < (e.w / 2 + 0.5) ** 2; })) continue;
      const i = newDog(DK.GUARD, R() < 0.6 ? 'molossian' : 'street'); if (i < 0) break;
      px[i] = homeX[i] = x; pz[i] = homeZ[i] = z; yaw[i] = homeYaw[i] = Math.atan2(d.nx, d.nz); gX[i] = 1e9; ground(i, true); friendly[i] = 0;
      md[i] = DM.GUARD; sub[i] = 0; setPose(i, POSE.LIE); poseW[i] = 1; got.push([x, z]);
    }
  }
  const nDogs = n;

  function nextEdge(i, node) {
    const l = adjN.get(node) || [], cur = e1[i], e = E[cur];
    let best = -1;
    if (l.length > 1) {
      const straight = l.find(k => k !== cur && Math.abs(E[k].ux * e.ux + E[k].uz * e.uz) > 0.9);
      if (straight !== undefined && R() < 0.45) best = straight;
      else for (let q = 0; q < 6 && best < 0; q++) { const k = l[Math.floor(RR() * l.length)]; if (k !== cur) best = k; }
    }
    if (best < 0) { dir[i] = -dir[i]; return; }
    e1[i] = best; dir[i] = E[best].a === node ? 1 : -1;
    if (RR() < 0.3) laneT[i] = (RR() - 0.5) * 1.8;
  }
  // back to what a dog does when nothing is going on: its street, its square, its door
  function resume(i) {
    setPose(i, 0); setAct(i, 0, 0); hPT[i] = 0.1; hYT[i] = 0; tUpT[i] = 0.3; wagT[i] = friendly[i] ? 0.25 : 0;
    if (kind[i] === DK.GUARD) { tgx[i] = homeX[i]; tgz[i] = homeZ[i]; md[i] = DM.GO; sub[i] = 1; timer[i] = 60; vpref[i] = walkV(i); return; }
    if (kind[i] === DK.AREA) { const s = agoraSpots.length ? agoraSpots[Math.floor(RR() * agoraSpots.length)] : [px[i], pz[i]]; tgx[i] = s[0]; tgz[i] = s[1]; md[i] = DM.GO; sub[i] = 0; timer[i] = 60; vpref[i] = RR() < 0.5 ? trotV(i) : walkV(i); return; }
    // the nearest point of a street edge in plain sight, then along it
    let bk = -1, bd = 1e9, bs = 0;
    for (let k = 0; k < E.length; k++) {
      const e = E[k], t = clamp((px[i] - e.ax) * e.ux + (pz[i] - e.az) * e.uz, 1, e.len - 1), x = e.ax + e.ux * t, z = e.az + e.uz * t, d = (x - px[i]) ** 2 + (z - pz[i]) ** 2;
      if (d < bd && (d > 900 || lineClear(px[i], pz[i], x, z, 0.8))) { bd = d; bk = k; bs = t; }
    }
    if (bk < 0) { md[i] = DM.PAUSE; sub[i] = PS.LOOK; timer[i] = 5; return; }
    e1[i] = bk; dir[i] = RR() < 0.5 ? 1 : -1; laneT[i] = (RR() - 0.5) * 1.4;
    const e = E[bk]; tgx[i] = e.ax + e.ux * bs; tgz[i] = e.az + e.uz * bs; md[i] = DM.GO; sub[i] = 0; timer[i] = 40; vpref[i] = trotV(i);
    if (bd < 1) md[i] = DM.ROAM;
  }
  let heelDog = -1, heelCool = 0, ambT = 8, ansI = -1, ansT = 0;
  function barkBurst(i, nb, gap = 0.45) { bn[i] = nb; bt[i] = now + 0.1 + RR() * 0.2; a3[i] = gap; }
  function barkTick(i) {
    if (!bn[i] || now < bt[i]) return;
    bn[i]--; bt[i] = now + a3[i] * (0.75 + RR() * 0.6);
    act[i] = ACT.BARK; actW[i] = 1; actWT[i] = 0; tUpT[i] = 0.8;
    emit('bark', i, 260, { size: +scl[i].toFixed(2), n: bn[i] }, 0.7);
  }
  function dogThink(i) {
    const r = RR();
    if (md[i] === DM.ROAM) {
      if (a1[i] > 0) { a1[i] = 0; vpref[i] = RR() < 0.6 ? trotV(i) : walkV(i); hPT[i] = 0.1; timer[i] = 4 + RR() * 10; return; }   // (done sniffing along)
      if (r < 0.2) { md[i] = DM.PAUSE; sub[i] = PS.SNIFF; hPT[i] = 1.05; timer[i] = 2 + RR() * 5; return; }
      if (r < 0.32) { a1[i] = 1; vpref[i] = 0.45; hPT[i] = 0.95; laneT[i] = Math.sign(lane[i] || 1) * (0.85 + RR() * 0.15); timer[i] = 3 + RR() * 6; return; }   // nose down along the foot of the wall
      if (r < 0.39) { md[i] = DM.PAUSE; sub[i] = PS.SCRATCH; setPose(i, POSE.SIT); setAct(i, ACT.SCRATCH); timer[i] = 2.5 + RR() * 2.5; return; }
      if (r < 0.47) { md[i] = DM.PAUSE; sub[i] = PS.SIT; setPose(i, POSE.SIT); timer[i] = 5 + RR() * 12; return; }
      if (r < 0.6 && lieSpot(i)) return;
      if (r < 0.7 && trail(i)) return;
      vpref[i] = RR() < 0.7 ? trotV(i) : walkV(i); if (RR() < 0.4) laneT[i] = (RR() - 0.5) * 1.8; timer[i] = 5 + RR() * 16; return;
    }
    if (md[i] === DM.PAUSE) {
      if (sub[i] === PS.SCRATCH) { setAct(i, 0, 0); sub[i] = PS.SIT; timer[i] = 0.6 + RR() * 2; return; }
      if (sub[i] === PS.SIT || sub[i] === PS.RISE) { if (sub[i] === PS.SIT) { setPose(i, 0); sub[i] = PS.RISE; timer[i] = 0.7; return; } }
      if (sub[i] === PS.LOOK && RR() < 0.5) { hYT[i] = (RR() - 0.5) * 2; timer[i] = 1.5 + RR() * 3; return; }
      if (kind[i] === DK.AREA) { if (r < 0.3 && lieSpot(i)) return; resume(i); return; }
      md[i] = DM.ROAM; hPT[i] = 0.1; hYT[i] = 0; timer[i] = 5 + RR() * 12; if (!(e1[i] >= 0)) resume(i); return;
    }
    if (md[i] === DM.LIE) {
      if (sub[i] === 0) { if (RR() < 0.25) { setPose(i, 0); sub[i] = 1; timer[i] = 1.2; return; } hPT[i] = RR() < 0.5 ? 0.55 : 0.05; hYT[i] = (RR() - 0.5) * 1.2; setAct(i, !shadeOf(i) && RR() < 0.6 ? ACT.PANT : 0, 1); timer[i] = 5 + RR() * 18; return; }
      resume(i); return;
    }
    if (md[i] === DM.GREET) { resume(i); if (kind[i] === DK.STREET && md[i] === DM.GO && Math.hypot(tgx[i] - px[i], tgz[i] - pz[i]) < 3) md[i] = DM.ROAM; return; }
    if (md[i] === DM.GO) { resume(i); return; }
    if (md[i] === DM.TRAIL) { resume(i); return; }
    timer[i] = 2;
  }
  const shadeOf = i => shaded(px[i], pz[i]);
  // somewhere to lie down: the shady side of the street a few metres on, else the foot of any wall, else right here
  function lieSpot(i) {
    let x = px[i], z = pz[i], ok = false;
    if (kind[i] === DK.STREET && e1[i] >= 0) {
      const e = E[e1[i]], d = dir[i], sx = d > 0 ? e.ax : e.bx, sz = d > 0 ? e.az : e.bz, ux = e.ux * d, uz = e.uz * d, s = clamp((px[i] - sx) * ux + (pz[i] - sz) * uz + 2 + RR() * 4, 1, e.len - 1);
      for (const side of RR() < 0.5 ? [1, -1] : [-1, 1]) {
        for (let o = e.w / 2 - 0.45; o >= e.half && !ok; o -= 0.3) { const cx = sx + ux * s - uz * o * side, cz = sz + uz * s + ux * o * side; if (clearAt(cx, cz, 0.3) && shaded(cx, cz)) { x = cx; z = cz; ok = true; } }
        if (ok) break;
      }
    } else for (let q = 0; q < 10 && !ok; q++) { const a = RR() * TAU, rr = 1 + RR() * 5, cx = px[i] + Math.sin(a) * rr, cz = pz[i] + Math.cos(a) * rr; if (clearAt(cx, cz, 0.35) && shaded(cx, cz) && lineClear(px[i], pz[i], cx, cz)) { x = cx; z = cz; ok = true; } }
    if (!ok && RR() < 0.6) return false;
    tgx[i] = x; tgz[i] = z; md[i] = DM.GO; sub[i] = 2; vpref[i] = walkV(i); timer[i] = 20; return true;
  }
  // trot after a passer-by for a while
  function trail(i) {
    if (!people || !people.listen) return false;
    const L = people.listen(px[i], pz[i], 9); let best = null;
    for (const p of L) if (p.walking && p.speed > 0.6 && p.kind !== 'ROAD' && (!best || p.d < best.d)) best = p;
    if (!best) return false;
    e1[i] = best.i; tgx[i] = best.x; tgz[i] = best.z; a1[i] = 0; a2[i] = 15 + RR() * 30; md[i] = DM.TRAIL; timer[i] = a2[i]; wagT[i] = 0.5; tUpT[i] = 0.5; return true;
  }
  function dogStep(i, dt) {
    barkTick(i);
    const dxp = plX - px[i], dzp = plZ - pz[i], dp2 = dxp * dxp + dzp * dzp;
    // the player: a friendly dog may fall in behind (one at a time); any dog looks up at someone passing close
    if (plOn && dp2 < 64 && heelDog < 0 && now > heelCool && friendly[i] && (md[i] === DM.ROAM || md[i] === DM.PAUSE || (md[i] === DM.LIE && RR() < 0.3)) && RR() < dt * 0.35) {
      heelDog = i; md[i] = DM.HEEL; setPose(i, 0); setAct(i, 0, 0); a2[i] = 50 + RR() * 90; timer[i] = a2[i]; wagT[i] = 0.9; tUpT[i] = 0.6; a1[i] = RR() < 0.5 ? 1 : -1; vpref[i] = trotV(i);
    }
    if (plOn && dp2 < 36 && md[i] !== DM.HEEL && md[i] !== DM.GUARD) { lookAt(i, plX, plZ); if (friendly[i]) wagT[i] = 0.5; }
    else if (md[i] === DM.ROAM || md[i] === DM.GO || md[i] === DM.TRAIL) hYT[i] = 0;
    if ((md[i] === DM.LIE || md[i] === DM.PAUSE || md[i] === DM.GREET) && world.dynamicBlocked && camD2(i) < 3600 && world.dynamicBlocked(px[i], pz[i], px[i] + 50, pz[i] + 50)) {
      for (let q = 0; q < 6; q++) { const a = RR() * TAU, x = px[i] + Math.sin(a) * 1.4, z = pz[i] + Math.cos(a) * 1.4; if (clearAt(x, z, 0.3) && lineClear(px[i], pz[i], x, z, 0.4)) { setPose(i, 0); setAct(i, 0, 0); tgx[i] = x; tgz[i] = z; md[i] = DM.GO; sub[i] = 0; vpref[i] = walkV(i); timer[i] = 6; break; } }
    }
    switch (md[i]) {
      case DM.ROAM: {
        if (e1[i] < 0) { resume(i); break; }
        const e = E[e1[i]], d = dir[i], sx = d > 0 ? e.ax : e.bx, sz = d > 0 ? e.az : e.bz, ux = e.ux * d, uz = e.uz * d;
        const s = (px[i] - sx) * ux + (pz[i] - sz) * uz;
        if (s > e.len - 0.9) { nextEdge(i, d > 0 ? e.b : e.a); go(i, dt, spd[i]); break; }
        lane[i] += (laneT[i] - lane[i]) * Math.min(1, dt * 0.6);
        const off = lane[i] * e.half, ta = Math.min(e.len, Math.max(s, 0) + 1.8);
        const res = steer(i, dt, sx + ux * ta - uz * off, sz + uz * ta + ux * off, vpref[i], 3.2);
        if (res && blockT[i] > 1.2) { blockT[i] = 0; if (res === 2) laneT[i] = -laneT[i] || 0.8; else dir[i] = -dir[i]; }
        tUpT[i] = spd[i] > 1.2 ? 0.45 : 0.2;
        break;
      }
      case DM.PAUSE: {
        go(i, dt, 0);
        if (sub[i] === PS.SNIFF) { hPT[i] = 1.0 + 0.1 * Math.sin(now * 3 + seed[i] * 9); hYT[i] = 0.35 * Math.sin(now * 1.3 + seed[i] * 20); }
        if (sub[i] === PS.SCRATCH) { hYT[i] = -0.55; hPT[i] = 0.2; }
        if (sub[i] === PS.BARK && !bn[i] && actW[i] < 0.1) timer[i] = Math.min(timer[i], 0.8);
        break;
      }
      case DM.LIE: go(i, dt, 0); if (sub[i] === 1 && poseW[i] < 0.1) timer[i] = Math.min(timer[i], 0.01); break;
      case DM.GO: {
        const d = Math.hypot(tgx[i] - px[i], tgz[i] - pz[i]);
        if (d < 0.35 || (d < 1.5 && blockT[i] > 1.5)) {
          if (sub[i] === 2) { md[i] = DM.LIE; sub[i] = 0; setPose(i, POSE.LIE); faceTo(i, 1, kind[i] === DK.STREET && e1[i] >= 0 ? Math.atan2(E[e1[i]].ux, E[e1[i]].uz) + (RR() < 0.5 ? 0 : Math.PI) : RR() * TAU, 10); tUpT[i] = -0.25; wagT[i] = 0; hPT[i] = 0.3; timer[i] = 4 + RR() * 8; a2[i] = 25 + RR() * 100; break; }
          if (sub[i] === 1) { md[i] = DM.GUARD; sub[i] = 0; setPose(i, POSE.LIE); break; }
          if (kind[i] === DK.AREA) { md[i] = DM.PAUSE; sub[i] = RR() < 0.5 ? PS.SNIFF : PS.LOOK; hPT[i] = sub[i] === PS.SNIFF ? 1 : 0.05; timer[i] = 2 + RR() * 8; break; }
          md[i] = DM.ROAM; timer[i] = 3 + RR() * 10; break;
        }
        if (d < 0.9) steer(i, dt, tgx[i], tgz[i], vpref[i] * Math.max(0.3, d / 0.9), 4); else steer(i, dt, tgx[i], tgz[i], vpref[i], 4);
        if (blockT[i] > 4) { blockT[i] = 0; if (camD2(i) > 3600) { px[i] = tgx[i]; pz[i] = tgz[i]; gX[i] = 1e9; ground(i, true); } else timer[i] = 0; }
        break;
      }
      case DM.TRAIL: {
        a1[i] -= dt;
        if (a1[i] <= 0) {   // where has my person got to (a look round their last spot four times a second)
          a1[i] = 0.25; let hit = null;
          if (people && people.listen) for (const p of people.listen(tgx[i], tgz[i], 3)) if (p.i === e1[i]) hit = p;
          if (!hit) { resume(i); break; }
          a2[i] = hit.walking ? 0 : a2[i] + 0.25; tgx[i] = hit.x; tgz[i] = hit.z; homeYaw[i] = hit.yaw;
          if (a2[i] > 4 || Math.hypot(hit.x - px[i], hit.z - pz[i]) > 14) { resume(i); break; }
        }
        const fx = Math.sin(homeYaw[i]), fz = Math.cos(homeYaw[i]), cx = tgx[i] - fx * 1.3, cz = tgz[i] - fz * 1.3, d = Math.hypot(cx - px[i], cz - pz[i]);
        if (d < 0.4) { go(i, dt, 0); faceTo(i, dt, Math.atan2(tgx[i] - px[i], tgz[i] - pz[i])); }
        else steer(i, dt, cx, cz, clamp(d * 1.4, 0.3, 3.2), 4.5);
        hPT[i] = 0.35;
        break;
      }
      case DM.HEEL: {
        const d = Math.sqrt(dp2);
        if (!plOn || d > 30 || timer[i] <= 0) { heelDog = -1; heelCool = now + 45 + RR() * 60; emit('whine', i, 40, { size: +scl[i].toFixed(2) }); resume(i); break; }
        const pv = Math.hypot(plVX, plVZ), fx = pv > 0.3 ? plVX / pv : dxp / (d || 1), fz = pv > 0.3 ? plVZ / pv : dzp / (d || 1);
        // a few metres behind and to one side of the player; when the player stands, come up close and sit
        const cx = plX - fx * 2.6 - fz * a1[i] * 0.9, cz = plZ - fz * 2.6 + fx * a1[i] * 0.9, dc = Math.hypot(cx - px[i], cz - pz[i]);
        if (pv < 0.3 && d < 3.2) { go(i, dt, 0); faceTo(i, dt, Math.atan2(dxp, dzp), 3); if (spd[i] < 0.1 && poseWT[i] === 0 && RR() < dt * 0.4) setPose(i, POSE.SIT); hYT[i] = 0; hPT[i] = -0.1; }
        else { if (poseWT[i]) setPose(i, 0); steer(i, dt, cx, cz, clamp(dc * 1.3 + pv * 0.8, 0, 7.5), 5); hPT[i] = 0.05; }
        wagT[i] = 0.9; tUpT[i] = 0.55;
        break;
      }
      case DM.GUARD: {
        const d = Math.sqrt(dp2), away = Math.hypot(px[i] - homeX[i], pz[i] - homeZ[i]);
        if (plOn && d < 11) {
          // up on its feet, facing the stranger, barking in bursts; backing to the door when they come close; tiring of it after a while
          if (sub[i] === 0) { sub[i] = 1; setPose(i, 0); a2[i] = 0; a1[i] = now + 0.8; }
          if (sub[i] === 1) {
            a2[i] += dt; faceTo(i, dt, Math.atan2(dxp, dzp), 4); hYT[i] = 0; hPT[i] = d < 4 ? 0.2 : -0.05; tUpT[i] = d < 4 ? -0.1 : 0.85; wagT[i] = 0;
            if (!bn[i] && now > a1[i] && poseW[i] < 0.3) { if (d < 3.5 && RR() < 0.5) { emit('growl', i, 30, { size: +scl[i].toFixed(2) }); a1[i] = now + 2 + RR() * 2; } else { const k = 2 + Math.floor(RR() * 2); barkBurst(i, k, 0.42); a1[i] = now + k * 0.45 + 4.5 + RR() * 6; } }
            if (a2[i] > 14 + seed[i] * 10) { sub[i] = 2; setPose(i, POSE.LIE); hPT[i] = 0.2; tUpT[i] = -0.2; emit('growl', i, 30, { size: +scl[i].toFixed(2) }); }
          } else if (sub[i] === 2) lookAt(i, plX, plZ, 0.9);
          go(i, dt, 0);
        } else {
          if (d > 18 && sub[i] !== 0) { sub[i] = 0; setPose(i, POSE.LIE); }
          if (sub[i] === 1 && d >= 11) { sub[i] = 0; setPose(i, POSE.LIE); }
          if (away > 0.8 && poseWT[i] === 0) { tgx[i] = homeX[i]; tgz[i] = homeZ[i]; md[i] = DM.GO; sub[i] = 1; vpref[i] = walkV(i); timer[i] = 30; break; }
          go(i, dt, 0); if (poseW[i] > 0.9) faceTo(i, dt, homeYaw[i], 1); hPT[i] = timer[i] > 0 && seed[i] > 0.5 ? 0.55 : 0.1; tUpT[i] = -0.25;
          if (timer[i] <= 0) { timer[i] = 6 + RR() * 12; hYT[i] = (RR() - 0.5) * 1.2; }
        }
        break;
      }
      case DM.GREET: { go(i, dt, 0); const j = e1[i]; if (j >= 0) faceTo(i, dt, Math.atan2(px[j] - px[i], pz[j] - pz[i]), 3); hPT[i] = 0.4; wagT[i] = 0.8; tUpT[i] = 0.5; break; }
    }
    if (timer[i] <= 0 && md[i] !== DM.GUARD && md[i] !== DM.HEEL) dogThink(i);
  }
  // two dogs meeting in the street stop to sniff each other
  function greetings() {
    for (let i = 0; i < nDogs; i++) {
      if (md[i] !== DM.ROAM || cool[i] > now || camD2(i) > 6400) continue;
      for (let j = i + 1; j < nDogs; j++) {
        if (md[j] !== DM.ROAM || cool[j] > now) continue;
        const dx = px[j] - px[i], dz = pz[j] - pz[i]; if (dx * dx + dz * dz > 2.6) continue;
        const T = 2.5 + RR() * 4;
        for (const [a, b] of [[i, j], [j, i]]) { md[a] = DM.GREET; e1[a] = b; timer[a] = T; cool[a] = now + 60 + RR() * 60; }
        if (RR() < 0.25) barkBurst(i, 1 + Math.floor(RR() * 2), 0.35);
        break;
      }
    }
  }

  // ---------- hens: flocks round the poultry sellers, the town pens and the farmyards ----------
  const flocks = [];
  const HM = { IDLE: 0, PECK: 1, RAKE: 2, WALK: 3, FLEE: 4 };
  function flockAt(x0, z0, want, rmax, nh, roosters, owner) {
    // the most open spot near (x0, z0): clear of colliders all round
    let best = null;
    for (let q = 0; q < 40; q++) {
      const a = R() * TAU, rr = q ? 0.8 + R() * rmax : 0, x = x0 + Math.cos(a) * rr, z = z0 + Math.sin(a) * rr;
      if (!clearAt(x, z, 0.5)) continue;
      let open = 0; for (let k = 0; k < 8; k++) { const b = k / 8 * TAU; if (!blocked(x + Math.cos(b) * want, z + Math.sin(b) * want)) open++; }
      if (!best || open > best.open) best = { x, z, open };
      if (open === 8) break;
    }
    if (!best || best.open < 4) return;
    const F = { x: best.x, z: best.z, r: want, ids: [], clk: R() * 5, crowT: 20 + R() * 60, lt: 0, thr: new Float32Array(8), nThr: 0, flapT: 0, owner, y: gh(best.x, best.z) };
    for (let k = 0; k < nh + roosters; k++) {
      const a = R() * TAU, rr = R() * want * 0.8, x = F.x + Math.cos(a) * rr, z = F.z + Math.sin(a) * rr;
      if (!clearAt(x, z, 0.15)) continue;
      const rooster = k >= nh, c = rooster ? [0x7a3018, 0x2a1a12] : pick(HENS);
      const i = add(SP.HEN, x, z, R() * TAU, { sc: rooster ? range(1.2, 1.32) : range(0.88, 1.05), a: c[0], b: c[1], fl: (c[2] || 0) | (rooster ? FL.ROOSTER : 0) });
      if (i < 0) break;
      grp[i] = flocks.length; md[i] = HM.IDLE; timer[i] = R() * 2; F.ids.push(i); tUpT[i] = 0;
    }
    if (F.ids.length) flocks.push(F);
  }
  {
    const pois = layout.pois || [];
    const stalls = pois.filter(p => p.type === 'stall' && p.note === 'chickens');
    for (const [k, p] of stalls.entries()) if (k % 2 === 0) { const fx = Math.sin(p.ry || 0), fz = Math.cos(p.ry || 0); flockAt(p.x + fx * 3.0, p.z + fz * 3.0, 1.3, 1.2, 2 + Math.floor(R() * 2), 0, 'agora'); }
    const pens = pois.filter(p => p.type === 'work' && p.note === 'pen').sort((a, b) => Math.hypot(a.x - 60, a.z - 150) - Math.hypot(b.x - 60, b.z - 150));
    pens.slice(0, 14).forEach((p, k) => flockAt(p.x + Math.sin(p.ry || 0) * 4.5, p.z + Math.cos(p.ry || 0) * 4.5, 2.0, 2.5, 3 + Math.floor(R() * 3), k % 5 === 0 ? 1 : 0, 'pen'));   // (in front of the pen, where its hens are)
    for (const p of pois.filter(p => p.type === 'gather' && /farm courtyard/.test(p.note || ''))) flockAt(p.x, p.z, 3.5, 6, 5 + Math.floor(R() * 3), 1, 'farm');
  }
  function henThink(i) {
    const F = flocks[grp[i]], r = RR(), dx = px[i] - F.x, dz = pz[i] - F.z, out = dx * dx + dz * dz > F.r * F.r;
    setAct(i, 0, 0); hPT[i] = 0; tUpT[i] = 0;
    if (out || r < 0.28) {   // a few steps to another spot (back towards the middle if strayed), sometimes a dash
      for (let q = 0; q < 6; q++) {
        const a = RR() * TAU, rr = RR() * F.r * 0.9, x = out ? F.x + Math.cos(a) * rr * 0.5 : px[i] + Math.cos(a) * (0.4 + RR() * 1.2), z = out ? F.z + Math.sin(a) * rr * 0.5 : pz[i] + Math.sin(a) * (0.4 + RR() * 1.2);
        if ((x - F.x) ** 2 + (z - F.z) ** 2 > F.r * F.r || blocked(x, z)) continue;
        tgx[i] = x; tgz[i] = z; md[i] = HM.WALK; vpref[i] = RR() < 0.1 ? 1.6 : 0.3 + RR() * 0.2; timer[i] = 6; return;
      }
    }
    if (r < 0.62) { md[i] = HM.PECK; setAct(i, ACT.PECK); timer[i] = 0.9 + RR() * 2.8; return; }
    if (r < 0.8 && !(flags[i] & FL.ROOSTER)) { md[i] = HM.RAKE; setAct(i, ACT.RAKE); timer[i] = 0.8 + RR() * 1.2; return; }
    md[i] = HM.IDLE; timer[i] = 0.6 + RR() * 2.5;
  }
  function henFlee(i, x, z) {
    const a = Math.atan2(px[i] - x, pz[i] - z) + (RR() - 0.5) * 1.2;
    yaw[i] = a; md[i] = HM.FLEE; vpref[i] = 2.2 + RR() * 0.9; timer[i] = 0.5 + RR() * 0.6; setAct(i, ACT.FLAP); actW[i] = 1; hPT[i] = -0.2;
    const F = flocks[grp[i]]; if (now > F.flapT) { F.flapT = now + 1.5; emit('flap', i, 60, { n: F.ids.length }, 0.4); if (RR() < 0.5) emit('cluck', i, 60, { alarm: true, rooster: !!(flags[i] & FL.ROOSTER) }, 0.8); }
  }
  function henStep(i, dt) {
    const F = flocks[grp[i]];
    if (md[i] !== HM.FLEE) {
      // feet: the player's, and anyone else's that come too near
      const dx = px[i] - plX, dz = pz[i] - plZ, rr = 1.5 + seed[i] * 0.6;
      if (plOn && dx * dx + dz * dz < rr * rr) henFlee(i, plX, plZ);
      else for (let k = 0; k < F.nThr; k++) { const ex = px[i] - F.thr[k * 2], ez = pz[i] - F.thr[k * 2 + 1]; if (ex * ex + ez * ez < 0.64) { henFlee(i, F.thr[k * 2], F.thr[k * 2 + 1]); break; } }
    }
    switch (md[i]) {
      case HM.IDLE: go(i, dt, 0); if (RR() < dt * 2.5) { hYT[i] = (RR() - 0.5) * 1.8; hPT[i] = (RR() - 0.6) * 0.4; } break;   // the head in quick jerks
      case HM.PECK: case HM.RAKE: go(i, dt, 0); hYT[i] = 0; if (md[i] === HM.RAKE && timer[i] < 0.25 && actWT[i] > 0) { setAct(i, ACT.PECK); } break;
      case HM.WALK: { const d = Math.hypot(tgx[i] - px[i], tgz[i] - pz[i]); if (d < 0.12 || blockT[i] > 0.8) { timer[i] = 0; go(i, dt, 0); } else steer(i, dt, tgx[i], tgz[i], vpref[i], 7); hYT[i] = 0; hPT[i] = -0.05; break; }
      case HM.FLEE: {
        if (go(i, dt, vpref[i])) yaw[i] = wrap(yaw[i] + (RR() < 0.5 ? 1 : -1) * 1.2);
        if (timer[i] <= 0) { md[i] = HM.IDLE; setAct(i, 0, 0); actWT[i] = 0; timer[i] = 1 + RR() * 2.5; hPT[i] = -0.15; return; }
        break;
      }
    }
    if (timer[i] <= 0) henThink(i);
  }
  function flockTick(F) {
    if (F.nThr >= 0 && now > F.lt) {   // who is walking among the hens (only while the camera is near)
      F.lt = now + 0.4 + RR() * 0.2; F.nThr = 0;
      if (people && people.listen && (F.x - camX) ** 2 + (F.z - camZ) ** 2 < 3600) for (const p of people.listen(F.x, F.z, F.r + 1.5)) { if (F.nThr >= 4) break; F.thr[F.nThr * 2] = p.x; F.thr[F.nThr * 2 + 1] = p.z; F.nThr++; }
    }
    const cd2 = (F.x - camX) ** 2 + (F.z - camZ) ** 2;
    if (now > F.clk) { F.clk = now + 4 + RR() * 10; if (cd2 < 2500) { const i = F.ids[Math.floor(RR() * F.ids.length)]; emit('cluck', i, 50, { rooster: !!(flags[i] & FL.ROOSTER) }, 0.8); } }
    if (now > F.crowT) {
      F.crowT = now + 50 + RR() * 110; const i = F.ids.find(j => flags[j] & FL.ROOSTER);
      if (i !== undefined && cd2 < 22500 && md[i] !== HM.FLEE) { md[i] = HM.IDLE; setAct(i, ACT.CALL); hPT[i] = -0.5; timer[i] = 1.8; emit('crow', i, 150, {}, 0.9); }
    }
  }

  // ---------- herds of sheep and goats on open pasture beyond the walls ----------
  const herds = [];
  const GM = { GRAZE: 0, LOOK: 1, WALK: 2, LIE: 3, FLEE: 4, STEP: 5 };
  const pastureOk = (x, z, r) => {
    if (insideWalls(x, z) || wallD(x, z) < 30) return false;
    const y = gh(x, z); if (y < SEA + 4 || slopeAt(x, z, 6) > 0.32) return false;
    for (let k = 0; k < 12; k++) { const a = k / 12 * TAU, xx = x + Math.cos(a) * r, zz = z + Math.sin(a) * r; if (blocked(xx, zz) || Math.abs(gh(xx, zz) - y) > r * 0.4) return false; }
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU + 0.3; if (blocked(x + Math.cos(a) * r * 0.5, z + Math.sin(a) * r * 0.5)) return false; }
    return true;
  };
  {
    const sites = [];
    for (const g of [[-745, 60], [770, 120]]) sites.push({ x: g[0] + Math.sign(g[0]) * 110, z: g[1], rmin: 30, rmax: 170, n: 2 });
    for (const p of (layout.pois || []).filter(p => p.type === 'gather' && /farm courtyard/.test(p.note || ''))) sites.push({ x: p.x, z: p.z, rmin: 55, rmax: 170, n: 1 });
    for (const s of sites) {
      for (let h = 0, q = 0; h < s.n && q < 60; q++) {
        const a = R() * TAU, rr = range(s.rmin, s.rmax), x = s.x + Math.cos(a) * rr, z = s.z + Math.sin(a) * rr;
        if (herds.some(o => Math.hypot(o.hx - x, o.hz - z) < 70) || roadD(x, z) < 16 || !pastureOk(x, z, 16)) continue;
        const goats = R() < 0.35, nh = 11 + Math.floor(R() * 12), H = { hx: x, hz: z, hr: 38, cx: x, cz: z, tx: x, tz: z, v: range(0.04, 0.09), ids: [], bleatT: R() * 10, moveT: 20 + R() * 60, kind: goats ? 'goat' : 'sheep' };
        const rad = 1.0 * Math.sqrt(nh) + 1.2;
        for (let k = 0; k < nh; k++) {
          const goat = goats ? R() < 0.85 : R() < 0.15, a2_ = R() * TAU, r2 = Math.sqrt(R()) * rad, ox = Math.cos(a2_) * r2, oz = Math.sin(a2_) * r2;
          if (!clearAt(x + ox, z + oz, 0.3)) continue;
          const c = pick(goat ? GOATS : SHEEP), bell = k < (goats ? 2 : 1) + (R() < 0.4 ? 1 : 0);
          const fl = (c[2] || 0) | (bell ? FL.BELL : 0) | (goat && R() < 0.7 ? FL.HORNS : 0) | (goat && R() < 0.5 ? FL.BEARD : 0) | (!goat && bell && R() < 0.5 ? FL.HORNS : 0);
          const i = add(goat ? SP.GOAT : SP.SHEEP, x + ox, z + oz, R() * TAU, { sc: range(0.86, 1.1) * (bell ? 1.08 : 1), a: c[0], b: c[1], fl });
          if (i < 0) break;
          grp[i] = herds.length; homeX[i] = ox; homeZ[i] = oz; md[i] = R() < 0.12 ? GM.LIE : GM.GRAZE; if (md[i] === GM.LIE) { setPose(i, POSE.LIE); poseW[i] = 1; setAct(i, ACT.CHEW); }
          hPT[i] = hP[i] = md[i] === GM.GRAZE ? 1 : 0; timer[i] = R() * 6; tUpT[i] = goat ? 0.9 : 0; bt[i] = R() * 4; H.ids.push(i);
        }
        if (H.ids.length) { herds.push(H); h++; }
      }
    }
  }
  function herdTick(H, dt) {
    // the herd drifts, a few metres a minute, to a new patch of open grazing within its range
    const dx = H.tx - H.cx, dz = H.tz - H.cz, d = Math.hypot(dx, dz);
    if (d > 0.5) { const s = Math.min(d, H.v * dt); H.cx += dx / d * s; H.cz += dz / d * s; }
    if ((H.moveT -= dt) <= 0) {
      H.moveT = 50 + RR() * 110;
      for (let q = 0; q < 6; q++) {
        const a = RR() * TAU, rr = 8 + RR() * 22, x = H.cx + Math.cos(a) * rr, z = H.cz + Math.sin(a) * rr;
        if (Math.hypot(x - H.hx, z - H.hz) > H.hr || !lineClear(H.cx, H.cz, x, z, 2) || !pastureOk(x, z, 7)) continue;
        H.tx = x; H.tz = z; break;
      }
    }
    const cd2 = (H.cx - camX) ** 2 + (H.cz - camZ) ** 2;
    if ((H.bleatT -= dt) <= 0) {
      H.bleatT = 8 + RR() * 24;
      if (cd2 < 48400) { const i = H.ids[Math.floor(RR() * H.ids.length)]; if (md[i] !== GM.FLEE) { setAct(i, ACT.CALL); actW[i] = 0; a3[i] = 0.9; hPT[i] = Math.min(hPT[i], 0.1); emit('bleat', i, 220, { kind: SPN[sp[i]] }, 0.8); } }
    }
  }
  function ringBell(i) { emit('bell', i, 170, { size: +(scl[i] * (sp[i] === SP.GOAT ? 0.85 : 1)).toFixed(2), kind: SPN[sp[i]] }, 0.6); bt[i] = now + (md[i] === GM.WALK || md[i] === GM.STEP || md[i] === GM.FLEE ? 0.7 + RR() * 1.3 : 3 + RR() * 9); }
  function grazerStep(i, dt) {
    const H = herds[grp[i]], tx = H.cx + homeX[i], tz = H.cz + homeZ[i], dtg = Math.hypot(tx - px[i], tz - pz[i]), goat = sp[i] === SP.GOAT;
    if ((flags[i] & FL.BELL) && now > bt[i]) ringBell(i);
    if (act[i] === ACT.CALL && (a3[i] -= dt) <= 0) setAct(i, md[i] === GM.GRAZE || md[i] === GM.LIE || md[i] === GM.LOOK ? ACT.CHEW : 0, 1);
    // the player coming close: move off, and the ones beside them go too
    const dxp = px[i] - plX, dzp = pz[i] - plZ, fr = goat ? 3.2 : 5;
    if (plOn && md[i] !== GM.FLEE && dxp * dxp + dzp * dzp < fr * fr) {
      for (const j of H.ids) { if (md[j] === GM.FLEE || (px[j] - px[i]) ** 2 + (pz[j] - pz[i]) ** 2 > 9) continue; md[j] = GM.FLEE; setPose(j, 0); setAct(j, 0, 0); timer[j] = 2 + RR() * 2.5; vpref[j] = goat ? 1.2 : 1.5; hPT[j] = 0; a2[j] = Math.atan2(px[j] - plX, pz[j] - plZ) + (RR() - 0.5) * 0.8; }
    }
    switch (md[i]) {
      case GM.GRAZE: go(i, dt, 0); hPT[i] = 1.0 + 0.08 * Math.sin(now * 0.7 + seed[i] * 20); hYT[i] = 0.25 * Math.sin(now * 0.4 + seed[i] * 11); if (act[i] !== ACT.CALL) setAct(i, ACT.CHEW); break;
      case GM.LOOK: go(i, dt, 0); if (act[i] !== ACT.CALL) setAct(i, ACT.CHEW); break;
      case GM.LIE: go(i, dt, 0); if (dtg > 7) timer[i] = 0; break;
      case GM.STEP: case GM.WALK: {
        const d = Math.hypot(tgx[i] - px[i], tgz[i] - pz[i]);
        if (d < 0.15 || blockT[i] > 1.2) { md[i] = GM.GRAZE; timer[i] = 2 + RR() * 6; go(i, dt, 0); break; }
        steer(i, dt, tgx[i], tgz[i], vpref[i] * Math.min(1, d / 0.4 + 0.3), 1.6);
        if (md[i] === GM.WALK) { tgx[i] = tx; tgz[i] = tz; hPT[i] = 0.25; }
        break;
      }
      case GM.FLEE: { faceTo(i, dt, a2[i], 3); if (go(i, dt, vpref[i])) a2[i] = wrap(a2[i] + 1.3); if (timer[i] <= 0) { md[i] = GM.LOOK; hPT[i] = -0.05; hYT[i] = 0; timer[i] = 2 + RR() * 4; } break; }
    }
    if (timer[i] > 0) return;
    const r = RR();
    if (md[i] === GM.LIE) { setPose(i, 0); md[i] = GM.LOOK; timer[i] = 1.5 + RR() * 2; hPT[i] = 0; return; }
    if (dtg > 3.2) { md[i] = GM.WALK; tgx[i] = tx; tgz[i] = tz; vpref[i] = 0.55 + RR() * 0.3; setAct(i, 0, 0); timer[i] = 30; if (flags[i] & FL.BELL) ringBell(i); return; }
    if (r < 0.5) {   // a step or three on, head still down, not into a neighbour
      const a = Math.atan2(tx - px[i], tz - pz[i]) * (dtg > 1 ? 1 : 0) + (dtg > 1 ? (RR() - 0.5) * 1.2 : RR() * TAU), L = 0.3 + RR() * 0.6, x = px[i] + Math.sin(a) * L, z = pz[i] + Math.cos(a) * L;
      let free = !blocked(x, z); for (const j of H.ids) if (j !== i && (px[j] - x) ** 2 + (pz[j] - z) ** 2 < 0.5) { free = false; break; }
      if (free) { md[i] = GM.STEP; tgx[i] = x; tgz[i] = z; vpref[i] = 0.35 + RR() * 0.15; timer[i] = 8; if ((flags[i] & FL.BELL) && RR() < 0.6) ringBell(i); return; }
    }
    if (r < 0.68) { md[i] = GM.LOOK; hPT[i] = RR() < 0.5 ? 0.0 : 0.35; hYT[i] = (RR() - 0.5) * 1.6; timer[i] = 2 + RR() * 5; return; }
    if (r < (goat ? 0.72 : 0.78)) { md[i] = GM.LIE; setPose(i, POSE.LIE); hPT[i] = 0.1; hYT[i] = (RR() - 0.5) * 0.8; setAct(i, ACT.CHEW); timer[i] = 40 + RR() * 110; return; }
    md[i] = GM.GRAZE; hYT[i] = 0; timer[i] = 2 + RR() * 7;
    if (RR() < 0.04) { const a = RR() * TAU, rr = Math.sqrt(RR()) * (1.0 * Math.sqrt(H.ids.length) + 1.2); homeX[i] = Math.cos(a) * rr; homeZ[i] = Math.sin(a) * rr; }   // (the herd slowly shuffles)
  }

  // ---------- pack donkeys and mules: out-and-back loops along the roads ----------
  const strings = [];
  const roadsBy = test => (layout.roads || []).find(test);
  const near = (p, x, z, r = 3) => Math.hypot(p[0] - x, p[1] - z) < r;
  // a polyline as a closed loop along its right-hand side there and its other side back, U-turns at the ends,
  // resampled every 2 m, each sample nudged to where a loaded donkey clears the walls; the loop stops where the way is shut
  function makeLoop(P, off = 1.1) {
    const S = [];
    for (let k = 0; k < P.length - 1; k++) {
      const [x0, z0] = P[k], [x1, z1] = P[k + 1], L = Math.hypot(x1 - x0, z1 - z0), m = Math.max(1, Math.round(L / 2));
      for (let q = k ? 1 : 0; q <= m; q++) S.push([x0 + (x1 - x0) * q / m, z0 + (z1 - z0) * q / m]);
    }
    const lanePt = (k, side) => {
      const a = S[Math.max(0, k - 1)], b = S[Math.min(S.length - 1, k + 1)], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / l, uz = (b[1] - a[1]) / l;
      for (const o of [off, off - 0.5, off + 0.5, off - 1.0, off + 1.0, 0.3, off + 1.6, off - 1.6]) { const x = S[k][0] - uz * o * side, z = S[k][1] + ux * o * side; if (clearAt(x, z, 0.6) && gh(x, z) > SEA + 0.5) return [x, z]; }
      return null;
    };
    const out = [], back = []; let cut = null;
    for (let k = 0; k < S.length; k++) {
      const a = lanePt(k, 1), b = lanePt(k, -1);
      if (!a || !b || (out.length && (!lineClear(out[out.length - 1][0], out[out.length - 1][1], a[0], a[1], 0.4) || !lineClear(back[back.length - 1][0], back[back.length - 1][1], b[0], b[1], 0.4) || Math.abs(gh(a[0], a[1]) - gh(out[out.length - 1][0], out[out.length - 1][1])) > 1.1))) { if (out.length > 20) { cut = S[k]; break; } out.length = back.length = 0; continue; }
      out.push(a); back.push(b);
    }
    if (out.length < 20) return null;
    const pts = out.concat(back.reverse());
    const x = new Float32Array(pts.length + 1), z = new Float32Array(pts.length + 1), cum = new Float32Array(pts.length + 1);
    for (let k = 0; k <= pts.length; k++) { const p = pts[k % pts.length]; x[k] = p[0]; z[k] = p[1]; if (k) cum[k] = cum[k - 1] + Math.hypot(x[k] - x[k - 1], z[k] - z[k - 1]); }
    return { x, z, cum, n: pts.length + 1, len: cum[pts.length], ends: [cum[out.length - 1], cum[pts.length] - 0.01], raw: S.length, kept: out.length, cut };
  }
  // through a gate in the circuit wall: the roads run up to the gate's middle, but the way is the straight clear line 18 m long through
  // the passage (between the towers, past the open leaves), as near the road's own direction as the towers allow
  const GATES = [[-745, 60], [770, 120]];
  function throughGates(P) {
    for (const [gx, gz] of GATES) {
      const k = P.findIndex(p => Math.hypot(p[0] - gx, p[1] - gz) < 16); if (k < 0) continue;
      const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], rl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, rx = (b[0] - a[0]) / rl, rz = (b[1] - a[1]) / rl;
      let best = null;
      for (let an = 0; an < Math.PI; an += Math.PI / 36) {
        const ux = Math.sin(an), uz = Math.cos(an), dev = Math.acos(Math.min(1, Math.abs(ux * rx + uz * rz)));
        for (let o = -4; o <= 4; o += 0.5) {
          const cx = gx - uz * o, cz = gz + ux * o, sc = dev + 0.12 * Math.abs(o); if (best && sc >= best.sc) continue;
          let ok = insideWalls(cx - ux * 9, cz - uz * 9) !== insideWalls(cx + ux * 9, cz + uz * 9);
          for (let t = -9; t <= 9 && ok; t += 0.25) for (const w of [-1.9, -1, 0, 1, 1.9]) if (blocked(cx + ux * t - uz * w, cz + uz * t + ux * w)) { ok = false; break; }
          if (ok) best = { sc, ax: cx - ux * 9, az: cz - uz * 9, bx: cx + ux * 9, bz: cz + uz * 9 };
        }
      }
      if (!best) continue;
      let i0 = k; while (i0 > 0 && Math.hypot(P[i0 - 1][0] - gx, P[i0 - 1][1] - gz) < 16) i0--;
      let i1 = k; while (i1 < P.length - 1 && Math.hypot(P[i1 + 1][0] - gx, P[i1 + 1][1] - gz) < 16) i1++;
      const prev = P[Math.max(0, i0 - 1)], ends = Math.hypot(best.ax - prev[0], best.az - prev[1]) < Math.hypot(best.bx - prev[0], best.bz - prev[1]) ? [[best.ax, best.az], [best.bx, best.bz]] : [[best.bx, best.bz], [best.ax, best.az]];
      P = [...P.slice(0, i0), ...ends, ...P.slice(i1 + 1)];
    }
    return P;
  }
  const loopAt = (Lp, s, k0, out) => {   // position on a loop at arc length s, searching from segment k0; out = [x, z, k]
    s = ((s % Lp.len) + Lp.len) % Lp.len; let k = Math.min(Math.max(0, k0), Lp.n - 2);
    while (k < Lp.n - 2 && Lp.cum[k + 1] < s) k++; while (k > 0 && Lp.cum[k] > s) k--;
    const t = (s - Lp.cum[k]) / Math.max(1e-4, Lp.cum[k + 1] - Lp.cum[k]); out[0] = Lp.x[k] + (Lp.x[k + 1] - Lp.x[k]) * t; out[1] = Lp.z[k] + (Lp.z[k + 1] - Lp.z[k]) * t; out[2] = k; return out;
  };
  {
    const R1 = roadsBy(r => !r.owner && r.pts.length === 2 && near(r.pts[0], 145, -58) && near(r.pts[1], 145, 442));   // the avenue
    const RE = roadsBy(r => !r.owner && near(r.pts[0], 470, 64) && near(r.pts[r.pts.length - 1], 770, 120, 6)), RW = roadsBy(r => !r.owner && near(r.pts[0], -470, 64) && near(r.pts[r.pts.length - 1], -745, 62, 6));
    const OE = roadsBy(r => r.owner === 'outskirts' && near(r.pts[0], 770, 120, 6)), OW = roadsBy(r => r.owner === 'outskirts' && near(r.pts[0], -745, 62, 6));
    const trackFrom = (road, far) => { const t = (layout.roads || []).filter(r => r.owner === 'outskirts' && r.width < 4 && road && road.pts.some(p => near(p, r.pts[0][0], r.pts[0][1], 80))).sort((a, b) => Math.abs(a.pts[0][0]) - Math.abs(b.pts[0][0]))[far ? 1 : 0]; return t; };
    const onRoadTo = (road, x) => { const out = []; for (const p of road.pts) { if (Math.abs(p[0]) >= Math.abs(x) - 2) break; out.push(p); } return out; };
    const routes = [];
    if (R1) routes.push({ P: [[145, 438], [145, -40]], size: 3, loads: [LOAD.AMPH, LOAD.AMPH, LOAD.AMPH], s0: 0.2, swap: false });
    if (R1 && RE && OE) { const tr = trackFrom(OE); if (tr) routes.push({ P: [[145, 425], [145, 64], [470, 64], ...RE.pts.slice(1), ...onRoadTo(OE, tr.pts[0][0]).slice(1), ...tr.pts], size: 2, loads: [LOAD.PANNIER, LOAD.SACKS], s0: 0.62, swap: true }); }
    if (RW && OW) { const tr = trackFrom(OW); routes.push({ P: [[-30, 64], [-470, 64], ...RW.pts.slice(1), ...(tr ? [...onRoadTo(OW, tr.pts[0][0]).slice(1), ...tr.pts] : OW.pts.slice(1, 4))], size: 3, loads: [LOAD.WOOD, LOAD.WOOD, LOAD.SACKS], mule: 0, s0: 0.35, swap: false }); }
    const RN = roadsBy(r => !r.owner && near(r.pts[0], 145, -58) && r.pts.length > 2);
    if (RN) routes.push({ P: [[145, 60], ...RN.pts], size: 1, loads: [LOAD.WOOD], mule: 0, s0: 0.3, swap: false });
    for (const ro of routes) {
      const Lp = makeLoop(throughGates(ro.P)); if (!Lp) continue;
      const S = { loop: Lp, ids: [], s: Lp.len * ro.s0, spd: 0, v: range(0.95, 1.15), pause: R() * 5, brayT: 60 + R() * 200, swap: ro.swap, loaded: true, wait: 0, lastEnd: -1, P: ro.P };
      const tmp = [0, 0, 0];
      for (let k = 0; k < ro.size; k++) {
        const mule = ro.mule === k || (ro.mule === undefined && R() < 0.25), c = pick(mule ? MULES : DONK);
        loopAt(Lp, S.s - k * 2.5, 0, tmp);
        const i = add(SP.DONKEY, tmp[0], tmp[1], 0, { sc: mule ? range(1.12, 1.2) : range(0.94, 1.04), a: c[0], b: c[1], fl: FL.BELLY | ro.loads[k] * FL.LOAD });
        if (i < 0) break;
        grp[i] = strings.length; e1[i] = tmp[2]; a1[i] = ro.loads[k]; kind[i] = mule ? 1 : 0; S.ids.push(i); tUpT[i] = 0; hPT[i] = 0.15;
      }
      if (S.ids.length) strings.push(S);
    }
  }
  const _lp = [0, 0, 0], _lq = [0, 0, 0];
  function stringTick(S, dt) {
    const Lp = S.loop, L = S.ids[0], lead = S.ids[0];
    let vT = S.pause > 0 ? 0 : S.v;
    if (S.pause > 0) S.pause -= dt;
    // someone in the road: the string stands and waits (and after a while edges past)
    if (vT > 0) {
      const fx = Math.sin(yaw[lead]), fz = Math.cos(yaw[lead]), ax = px[lead] + fx * 1.25, az = pz[lead] + fz * 1.25, db = world.dynamicBlocked;
      const blockedP = (db && db(ax, az, px[lead] + fx * 0.6, pz[lead] + fz * 0.6)) || (plOn && (plX - ax) ** 2 + (plZ - az) ** 2 < 1.1);
      if (blockedP && S.wait < 6) { vT = 0; S.wait += dt; } else if (!blockedP) S.wait = Math.max(0, S.wait - dt * 0.5);
    }
    S.spd += (vT - S.spd) * Math.min(1, dt * 1.2);
    const s0 = S.s; S.s = (S.s + S.spd * dt) % Lp.len;
    // at either end of the road: a long stand (unloaded in town, loaded again at the farm)
    for (let e = 0; e < 2; e++) { const m = Lp.ends[e]; if (S.lastEnd !== e && ((s0 <= m && S.s > m) || (s0 > S.s && (m > s0 || m <= S.s)))) { S.lastEnd = e; S.pause = 25 + RR() * 45; if (S.swap) { S.loaded = !S.loaded; for (const i of S.ids) flags[i] = FL.BELLY + (S.loaded ? a1[i] : 0) * FL.LOAD; } } }
    const cd2 = (px[L] - camX) ** 2 + (pz[L] - camZ) ** 2;
    if ((S.brayT -= dt) <= 0) { S.brayT = 140 + RR() * 260; if (cd2 < 62500) { const i = S.ids[Math.floor(RR() * S.ids.length)]; setAct(i, ACT.CALL); a3[i] = 1.8; emit('bray', i, 260, { mule: !!kind[i] }, 0.8); } }
    for (let k = 0; k < S.ids.length; k++) {
      const i = S.ids[k], s = S.s - k * 2.5 * (0.96 + 0.04 * Math.sin(now * 0.3 + k));
      if (frozen[i]) continue;
      loopAt(Lp, s + 0.6, e1[i], _lp); loopAt(Lp, s - 0.6, e1[i], _lq);
      const a = Math.atan2(_lp[0] - _lq[0], _lp[1] - _lq[1]);
      loopAt(Lp, s, e1[i], _lp); e1[i] = _lp[2];
      yaw[i] = wrap(yaw[i] + clamp(wrap(a - yaw[i]), -2 * dt, 2 * dt)); px[i] = _lp[0]; pz[i] = _lp[1]; spd[i] = S.spd;
      ground(i); stride(i, dt);
      if (act[i] === ACT.CALL && (a3[i] -= dt) <= 0) setAct(i, 0, 0);
      if (S.spd < 0.1) { if (RR() < dt * 0.15) hPT[i] = 0.2 + RR() * 0.5; if (RR() < dt * 0.3) wagT[i] = RR() < 0.5 ? 0.5 : 0; } else { hPT[i] = 0.15; wagT[i] = 0; }
      if (act[i] === ACT.CALL) hPT[i] = -0.1;
    }
  }

  // ---------- meshes ----------
  const uTime = { value: 0 };
  const matStd = patchMaterial(new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, envMapIntensity: 0.35 }), 'std', uTime);
  (ctx.setupMaterial || (m => m))(matStd);
  const matDepth = patchMaterial(new THREE.MeshDepthMaterial(), 'depth', uTime);
  const group = new THREE.Group(); group.name = 'fauna';
  const GEO = [dogGeometry, henGeometry, () => ruminantGeometry(false), () => ruminantGeometry(true), donkeyGeometry];
  const ATT = ['iPos', 'iAnim', 'iAct', 'iLook', 'iMisc'];
  const meshes = GEO.map((f, s) => {
    const g = f(), cap = SPEC[s].cap;
    for (const nm of ATT) g.setAttribute(nm, new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.InstancedMesh(g, matStd, cap); m.frustumCulled = false; m.castShadow = s !== SP.HEN; m.receiveShadow = true; m.customDepthMaterial = matDepth; m.name = 'fauna ' + SPN[s];
    m.userData.noAO = true; m.userData.attrs = ATT.map(nm => g.attributes[nm]); m.userData.tris = g.index.count / 3; m.count = 0; m.visible = false;
    group.add(m); return m;
  });
  const B = meshes.map(m => m.userData.attrs.map(a => a.array)), drawn = new Int32Array(5);
  const _pm = new THREE.Matrix4(), _fr = new THREE.Frustum(), PLN = new Float32Array(24);
  function pack(cam) {
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    for (let p = 0; p < 6; p++) { const pl = _fr.planes[p]; PLN[p * 4] = pl.normal.x; PLN[p * 4 + 1] = pl.normal.y; PLN[p * 4 + 2] = pl.normal.z; PLN[p * 4 + 3] = pl.constant; }
    drawn.fill(0);
    for (let i = 0; i < n; i++) {
      const s = sp[i], S = SPEC[s], x = px[i], z = pz[i], y = py[i] + S.L * scl[i] * 0.7, rad = S.L * scl[i] * 1.6;
      const d2 = (x - camX) ** 2 + (z - camZ) ** 2; if (d2 > S.range * S.range || drawn[s] >= S.cap) continue;
      let vis = true; for (let p = 0; p < 24; p += 4) if (PLN[p] * x + PLN[p + 1] * y + PLN[p + 2] * z + PLN[p + 3] < -rad) { vis = false; break; }
      if (!vis) continue;
      const k = drawn[s]++ * 4, A = B[s];
      A[0][k] = x; A[0][k + 1] = py[i]; A[0][k + 2] = z; A[0][k + 3] = yaw[i];
      A[1][k] = phase[i]; A[1][k + 1] = gait[i]; A[1][k + 2] = hP[i]; A[1][k + 3] = hY[i];
      A[2][k] = act[i] + clamp(actW[i], 0, 1) * 0.99; A[2][k + 1] = pose[i] + clamp(poseW[i], 0, 1) * 0.99; A[2][k + 2] = wag[i]; A[2][k + 3] = pitch[i];
      A[3][k] = colA[i]; A[3][k + 1] = colB[i]; A[3][k + 2] = flags[i]; A[3][k + 3] = seed[i] * 0.999;
      // far off, a touch larger (a dog at 150 m is a few pixels)
      A[4][k] = scl[i] * (d2 > 6400 ? 1 + Math.min(0.25, (Math.sqrt(d2) - 80) / 500) : 1); A[4][k + 1] = tUp[i]; A[4][k + 2] = s === SP.DOG ? 1 - smoothstep(1.1, 1.5, spd[i]) : 1; A[4][k + 3] = s;
    }
    for (let s = 0; s < 5; s++) {
      const m = meshes[s], c = drawn[s]; m.count = c; m.visible = c > 0;
      if (c) for (const at of m.userData.attrs) { at.clearUpdateRanges(); at.addUpdateRange(0, c * 4); at.needsUpdate = true; }
    }
  }

  // ---------- simulation ----------
  const updMs = new Float32Array(120); let updK = 0;
  function simulate(i, dt) {
    timer[i] -= dt;
    switch (sp[i]) {
      case SP.DOG: dogStep(i, dt); break;
      case SP.HEN: henStep(i, dt); break;
      case SP.SHEEP: case SP.GOAT: grazerStep(i, dt); break;
    }
    const k = Math.min(1, dt * SPEC[sp[i]].hk);
    hP[i] += (hPT[i] - hP[i]) * k; hY[i] += (hYT[i] - hY[i]) * k;
    actW[i] += (actWT[i] - actW[i]) * Math.min(1, dt * (act[i] === ACT.BARK ? 7 : 3.5)); if (actWT[i] === 0 && actW[i] < 0.02) act[i] = 0;
    poseW[i] += (poseWT[i] - poseW[i]) * Math.min(1, dt * 1.6); if (poseWT[i] === 0 && poseW[i] < 0.02) pose[i] = 0;
    wag[i] += (wagT[i] - wag[i]) * Math.min(1, dt * 3); tUp[i] += (tUpT[i] - tUp[i]) * Math.min(1, dt * 3);
    pitch[i] += (Math.atan(gS[i]) * (poseW[i] > 0.5 ? 0.5 : 1) - pitch[i]) * Math.min(1, dt * 4);
  }
  let lastCX = 0, lastCZ = 0;
  function update(dt, t, cam, player) {
    const T0 = perf.now();
    dt = Math.min(Math.max(dt, 0), 0.1); now = t; uTime.value = t; frame++;
    camX = cam.position.x; camY = cam.position.y; camZ = cam.position.z;
    plVX = dt > 0 ? (camX - lastCX) / dt : 0; plVZ = dt > 0 ? (camZ - lastCZ) / dt : 0; if (Math.hypot(plVX, plVZ) > 20) plVX = plVZ = 0;
    lastCX = camX; lastCZ = camZ; plX = camX; plZ = camZ;
    plOn = !!player && (!player.fly || (frame % 8 === 0 ? (plOnLow = camY - gh(camX, camZ) < 2.3) : plOnLow));
    for (const S of strings) { const L = S.ids[0], d2 = (px[L] - camX) ** 2 + (pz[L] - camZ) ** 2; if (d2 < 176400 || frame % 30 === 0) stringTick(S, d2 < 176400 ? dt : dt * 30); }
    for (const H of herds) { const d2 = (H.cx - camX) ** 2 + (H.cz - camZ) ** 2; if (d2 < 360000 && (d2 < 40000 || frame % 4 === 0)) herdTick(H, d2 < 40000 ? dt : dt * 4); }
    for (const F of flocks) if ((F.x - camX) ** 2 + (F.z - camZ) ** 2 < 40000) flockTick(F);
    if (frame % 20 === 0) greetings();
    // now and then a dog somewhere barks, and sometimes another answers
    if (now > ambT) {
      ambT = now + 20 + RR() * 35;
      for (let q = 0; q < 10; q++) { const i = Math.floor(RR() * nDogs), d2 = camD2(i); if (d2 > 400 && d2 < 28900 && md[i] !== DM.HEEL && md[i] !== DM.GUARD && !bn[i]) { barkBurst(i, 2 + Math.floor(RR() * 4), 0.38 + RR() * 0.2); if (md[i] === DM.ROAM) { md[i] = DM.PAUSE; sub[i] = PS.BARK; timer[i] = 3; hPT[i] = -0.1; } if (RR() < 0.3) { ansI = Math.floor(RR() * nDogs); ansT = now + 1.5 + RR() * 2.5; } break; } }
    }
    if (ansI >= 0 && now > ansT) { if (!bn[ansI] && md[ansI] !== DM.HEEL && camD2(ansI) < 40000) barkBurst(ansI, 1 + Math.floor(RR() * 4), 0.45); ansI = -1; }
    for (let i = 0; i < n; i++) {
      if (frozen[i] || sp[i] === SP.DONKEY) continue;
      const d2 = camD2(i), tier = d2 < 3600 ? 1 : d2 < 22500 ? 3 : d2 < 176400 ? 8 : 0;
      if (!tier) { lastT[i] = t; continue; }   // asleep
      if (tier > 1 && (frame + i) % tier) continue;
      const d = Math.min(0.25, t - lastT[i]); lastT[i] = t;
      if (d > 0) simulate(i, frame === 1 ? dt : d);
    }
    for (const S of strings) for (const i of S.ids) if (!frozen[i]) { const k = Math.min(1, dt * 2.5); hP[i] += (hPT[i] - hP[i]) * k; actW[i] += (actWT[i] - actW[i]) * Math.min(1, dt * 3); if (actWT[i] === 0 && actW[i] < 0.02) act[i] = 0; wag[i] += (wagT[i] - wag[i]) * Math.min(1, dt * 2); pitch[i] += (Math.atan(gS[i]) - pitch[i]) * Math.min(1, dt * 3); }
    pack(cam);
    updMs[updK++ % 120] = perf.now() - T0;
  }
  let plOnLow = false;

  const modeName = i => {
    const s = sp[i];
    if (s === SP.DOG) return ['roam', 'pause', 'lie', 'go', 'trail', 'heel', 'guard', 'greet'][md[i]] + (md[i] === DM.PAUSE ? ':' + ['sniff', 'scratch', 'sit', 'look', 'bark', 'rise'][sub[i]] : md[i] === DM.GUARD ? ':' + sub[i] : '');
    if (s === SP.HEN) return ['idle', 'peck', 'rake', 'walk', 'flee'][md[i]];
    if (s === SP.DONKEY) return strings[grp[i]].spd > 0.1 ? 'walk' : 'stand';
    return ['graze', 'look', 'walk', 'lie', 'flee', 'step'][md[i]];
  };
  const api = {
    group, update,
    debug() {
      const bySp = {}, byMode = {}; let below = 0, inside = 0; const belowAt = [], insideAt = [];
      for (let i = 0; i < n; i++) {
        const nm = SPN[sp[i]]; bySp[nm] = (bySp[nm] || 0) + 1; const k = nm + ' ' + modeName(i); byMode[k] = (byMode[k] || 0) + 1;
        const dy = py[i] - gh(px[i], pz[i]); if (Math.abs(dy) > 0.2) { below++; if (belowAt.length < 5) belowAt.push([i, nm, +px[i].toFixed(1), +pz[i].toFixed(1), +dy.toFixed(2)]); }
        if (blocked(px[i], pz[i])) { inside++; if (insideAt.length < 5) insideAt.push([i, nm, +px[i].toFixed(1), +pz[i].toFixed(1), modeName(i)]); }
      }
      let avg = 0, mx = 0; const nn = Math.min(updK, 120); for (let k = 0; k < nn; k++) { avg += updMs[k]; mx = Math.max(mx, updMs[k]); }
      return { count: n, bySpecies: bySp, byMode, offGround: below, offGroundAt: belowAt, insideColliders: inside, insideAt, drawn: Array.from(drawn), trisPer: meshes.map(m => m.userData.tris),
        updateMsAvg: +(avg / Math.max(1, nn)).toFixed(3), updateMsMax: +mx.toFixed(3), emitted: counts.emitted, heelDog, streetEdges: E.length, areaSpots: agoraSpots.length,
        flocks: flocks.map(F => [F.owner, +F.x.toFixed(1), +F.z.toFixed(1), F.ids.length]), herds: herds.map(H => [H.kind, +H.cx.toFixed(0), +H.cz.toFixed(0), H.ids.length]),
        strings: strings.map(S => ({ n: S.ids.length, at: [+px[S.ids[0]].toFixed(0), +pz[S.ids[0]].toFixed(0)], loop: Math.round(S.loop.len), kept: S.loop.kept + '/' + S.loop.raw, cut: S.loop.cut, pause: +S.pause.toFixed(0) })), buildMs: Math.round(buildMs) };
    },
    // a few animals of a species (optionally in a mode), for screenshots and tests
    find(species, mode, max = 5) { const out = []; for (let i = 0; i < n && out.length < max; i++) if (SPN[sp[i]] === species && (!mode || modeName(i).startsWith(mode))) out.push({ i, x: +px[i].toFixed(1), y: +py[i].toFixed(2), z: +pz[i].toFixed(1), yaw: +yaw[i].toFixed(2), m: modeName(i), d: Math.round(Math.sqrt(camD2(i))) }); return out; },
    nearest(species, x, z, mode) { let b = -1, bd = 1e18; for (let i = 0; i < n; i++) if (SPN[sp[i]] === species && (!mode || modeName(i).startsWith(mode))) { const d = (px[i] - x) ** 2 + (pz[i] - z) ** 2; if (d < bd) { bd = d; b = i; } } return b < 0 ? null : { i: b, x: +px[b].toFixed(1), z: +pz[b].toFixed(1), y: +py[b].toFixed(2), yaw: +yaw[b].toFixed(2), m: modeName(b), d: Math.round(Math.sqrt(bd)) }; },
    // the camera beside animal i: dist metres out from its side (side° from its facing), h above the ground there
    look(i, dist = 2.5, h = 0.9, side = 60, pitch = -10) { const a = yaw[i] + side * Math.PI / 180, cx = px[i] + Math.sin(a) * dist, cz = pz[i] + Math.cos(a) * dist; if (typeof window !== 'undefined' && window.__setView) window.__setView(cx, gh(cx, cz) + h, cz, a * 180 / Math.PI, pitch); return [cx, cz]; },
    // freeze animals in a row in front of the camera for pose checks: items [{sp, pose, poseW, act, actW, gait, phase, hp, hy, fl, a, b, sc, tUp, wag, walk}]
    stage(x, z, ry, items, gap = 1.2) {
      const used = new Set();
      items.forEach((it, q) => {
        let i = -1; for (let j = 0; j < n; j++) if (SPN[sp[j]] === it.sp && !used.has(j) && !frozen[j] && sp[j] !== SP.DONKEY) { i = j; break; }
        if (i < 0 && it.sp === 'donkey') for (let j = 0; j < n; j++) if (sp[j] === SP.DONKEY && !used.has(j) && !frozen[j]) { i = j; break; }
        if (i < 0) return; used.add(i); frozen[i] = 1;
        const o = (q - (items.length - 1) / 2) * gap; px[i] = x + Math.cos(ry) * o; pz[i] = z - Math.sin(ry) * o; yaw[i] = ry + (it.ry || 0); gX[i] = 1e9; ground(i, true); gS[i] = 0; pitch[i] = 0;
        pose[i] = it.pose || 0; poseW[i] = poseWT[i] = it.pose ? (it.poseW ?? 1) : 0; act[i] = it.act || 0; actW[i] = actWT[i] = it.act ? (it.actW ?? 1) : 0; gait[i] = it.gait || 0; phase[i] = it.phase || 0; spd[i] = it.gait ? 1.8 : 0;
        hP[i] = hPT[i] = it.hp || 0; hY[i] = hYT[i] = it.hy || 0; if (it.fl !== undefined) flags[i] = it.fl; if (it.a !== undefined) colA[i] = it.a; if (it.b !== undefined) colB[i] = it.b; if (it.sc) scl[i] = it.sc;
        tUp[i] = tUpT[i] = it.tUp || 0; wag[i] = wagT[i] = it.wag || 0;
        if (it.walk !== undefined) { spd[i] = it.walk ? 0.8 : 1.9; }
      });
    },
    // a frozen animal walks in place: gait advancing (for stride checks)
    animate(on = true) { stageAnim = on; },
    inspect(i) { return { sp: SPN[sp[i]], m: modeName(i), x: +px[i].toFixed(2), z: +pz[i].toFixed(2), y: +py[i].toFixed(2), yaw: +yaw[i].toFixed(2), spd: +spd[i].toFixed(2), gait: +gait[i].toFixed(2), hp: +hP[i].toFixed(2), act: act[i], actW: +actW[i].toFixed(2), pose: pose[i], poseW: +poseW[i].toFixed(2), timer: +timer[i].toFixed(1), blockT: +blockT[i].toFixed(2), e: e1[i], kind: kind[i], fr: friendly[i], fl: flags[i] }; },
    unfreeze() { frozen.fill(0); },
  };
  let stageAnim = false;
  const upd0 = api.update;
  api.update = (dt, t, cam, player) => { if (stageAnim) for (let i = 0; i < n; i++) if (frozen[i] && gait[i] > 0) { const L = SPEC[sp[i]].L * scl[i]; phase[i] += dt * TAU * spd[i] / (4 * L * Math.sin(Math.max(gait[i], 0.1))); } upd0(dt, t, cam, player); };
  const buildMs = perf.now() - tBuild;
  return api;
}
