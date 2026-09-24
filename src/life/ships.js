// Traffic on the water. A trireme under oars patrols the bay, rows in through the harbour mouth and out again and calls at the
// royal shipsheds under the palace; merchantmen under square sails cross the bay, stand in and out of the harbour and pass far
// out on the horizon; fishermen row along the shores or lie to a net. Every craft heaves, pitches and rolls on a swell of its
// own (the sea itself is a flat plane with scrolling normals), the merchantmen heel to the wind, and all leave a fading wake.
//
// Rendering: every rigid part of every craft (hulls, 170 oars, yards, crews, rigging) is ONE SkinnedMesh whose "bones" are
// nothing but per-part world matrices written straight into the skeleton each frame (no hierarchy, identity binds, our own
// Skeleton.update); the cloth (sails, pennants) is a second SkinnedMesh on the same skeleton, bellied, luffed and fluttered in
// the vertex shader from the shared wind (with a matching depth material for its shadow); wakes, hull foam and oar puddles are
// one dynamic ribbon mesh lying on the water. Three draw calls, plus the shadow cascades.
// Routes are Catmull-Rom loops resampled every metre and checked against the depth of the water, the moles and the moored ships.
import * as THREE from 'three';
import { rng, clamp, lerp, smoothstep, TAU, mat, box, ellipsoid, lathe, normalizeGeom, scaleUV } from '../util.js';
import { terrainHeight, SEA } from '../terrain.js';
import { hullGeo } from '../cityfeatures/harbour.js';

const PITCH = 0x1d1a17, PITCHB = 0x3a3029, OAKD = 0x6a5038, DECK = 0x9a7a58, OCHRE = 0x8e3b26, BRONZE = 0x9a7038, ROPE = 0x7a6448;
const LEATHERD = 0x46302a, IVORY = 0xe6dfd0, INK = 0x1a1512, CORK = 0x4a3b2c, WICKER = 0xa08458, WET = 0x5a4632;
const SKIN = [0xb08264, 0x9c6e52, 0xbc8e6e, 0x8c6046, 0xc49c7c, 0x7e583e];
const TUNIC = [0xd3c8ae, 0xcabd9d, 0xbfae8b, 0xa39373, 0x877157, 0x6d604f, 0x8c3a2b, 0x44517a, 0x7a5a3c, 0xb4863c, 0x93846a];
const CAP = [0x6e5a40, 0x7a6a50, 0x5e5040, 0x8a7458], BAND = [0x7a3a2a, 0x3d5670, 0x9a7a45, 0xb3a78e, 0x4f5c48, 0x6a4a34];
const WY = SEA + 0.035;                 // the wakes lie just on the water
const UA = 0.3, FA = 0.29;              // upper arm, forearm (the rowers' and haulers' arms are solved to their hands)

// ---------- routes ----------
// closed loops of waypoints [x, z, speed m/s, sail (1 = full, less = brailed up), hold s]; the square-riggers only run, reach
// and stand in or out with the wind (it blows towards the ESE): their upwind legs lie far out, beyond 2.3 km, under bare yards
export const ROUTES = {
  trireme: { draft: 1.1, clear: 11, pts: [   // kept inshore of the merchantmen's track in and out of the harbour
    [200, 880, 3.2], [300, 850, 3.2], [335, 770, 3.0], [312, 718, 2.4], [340, 672, 1.8], [366, 637, 1.0, 1, 22],   // up to the royal shipsheds,
    [366, 606, 1.2], [345, 585, 1.4], [318, 579, 1.6], [298, 600, 2.0], [292, 652, 2.6], [270, 712, 3.0],        // round before them and out,
    [215, 736, 2.8], [187, 690, 2.4], [185, 610, 2.0], [172, 556, 1.6], [140, 537, 1.6], [112, 556, 1.7],        // in through the harbour mouth,
    [104, 612, 2.2], [110, 700, 2.8], [150, 800, 3.2]] },                                                           // out, and a sweep of the inner bay
  harbour: { draft: 1.6, clear: 12, pts: [   // a merchantman standing into the harbour, lying there a while, and out to sea
    [-1200, 2000, 3.0], [-600, 1250, 2.6], [-262, 862, 2.4], [-180, 724, 1.8, 0.55], [-171, 640, 1.2, 0.5], [-165, 592, 0.9, 0.45],
    [-146, 563, 0.6, 0.15, 45], [-122, 563, 0.8, 0.3], [-108, 592, 1.2, 0.5], [-104, 660, 1.6, 0.55], [-70, 752, 2.2, 1],
    [300, 1050, 2.6], [1000, 1600, 3.0], [1500, 2300, 3.0], [400, 2700, 3.0], [-700, 2600, 3.0]] },
  bay: { draft: 1.7, clear: 14, pts: [
    [-1600, 1150, 2.6], [-800, 1010, 2.6], [-200, 965, 2.6], [400, 1000, 2.6], [1000, 1100, 2.6], [1700, 1400, 2.6],
    [2300, 2100, 2.6], [1200, 2900, 2.2], [-600, 2800, 2.2], [-1700, 2200, 2.4]] },
  far: { draft: 1.8, clear: 14, pts: [
    [-2600, 2000, 2.4], [-900, 1800, 2.4], [800, 1850, 2.4], [2600, 2100, 2.4], [2800, 3400, 2.2], [0, 3900, 2.2], [-2800, 3400, 2.2]] },
  south: { draft: 1.3, clear: 12, pts: [
    [-400, 800, 2.2], [-250, 1300, 2.3], [100, 2000, 2.3], [-500, 2900, 2.0], [-1500, 2500, 2.0], [-1300, 1600, 2.2], [-800, 1100, 2.2]] },
  west: { draft: 0.25, clear: 6, pts: [   // a fisherman working along the west shore
    [-393, 604, 1.2], [-408, 642, 1.2], [-430, 680, 1.2], [-460, 712, 1.1], [-500, 742, 1.0, 1, 28], [-470, 764, 1.2], [-430, 738, 1.2],
    [-395, 695, 1.2], [-372, 645, 1.2]] },
  east: { draft: 0.25, clear: 6, pts: [   // and one along the shore south of the shipsheds
    [434, 650, 1.1], [458, 686, 1.1], [494, 716, 1.1], [530, 740, 1.0, 1, 24], [500, 754, 1.1], [462, 732, 1.1], [430, 692, 1.1], [416, 660, 1.1]] },
  mole: { draft: 0.25, clear: 9, pts: [   // out of the harbour round the west mole-head, to lie off its outer face, and home
    [-205, 528, 1.2], [-200, 600, 1.2], [-206, 646, 1.2], [-246, 666, 1.2], [-284, 640, 1.1], [-290, 592, 0.9, 1, 30], [-300, 626, 1.2],
    [-266, 674, 1.2], [-214, 662, 1.2], [-192, 610, 1.2], [-191, 542, 1.2]] },
};

// ---------- what a route must keep clear of ----------
const MOLE = [[240, 446], [252, 500], [246, 555], [222, 605]];
const MOORED = [[-90, 540, 12], [60, 585, 21], [20, 640, 12], [-520, 1350, 12], [700, 1700, 12], [150, 1100, 21], [-222, 605, 5], [222, 605, 5]];   // city.js's ships, the mole towers
const SHEDS = { cx: 430, cz: 590, ux: Math.sin(22.5 * Math.PI / 180), uz: Math.cos(22.5 * Math.PI / 180), W: 29, L: 44 };   // harbour.js's slips (v = (-uz, ux))
function clearance(x, z) {
  let d = 1e9;
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const ax = s * MOLE[i][0], az = MOLE[i][1], bx = s * MOLE[i + 1][0], bz = MOLE[i + 1][1], dx = bx - ax, dz = bz - az, u = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
    d = Math.min(d, Math.hypot(x - ax - dx * u, z - az - dz * u) - 4.5);
  }
  for (const [mx, mz, r] of MOORED) d = Math.min(d, Math.hypot(x - mx, z - mz) - r);
  const px = x - SHEDS.cx, pz = z - SHEDS.cz, su = px * SHEDS.ux + pz * SHEDS.uz, tv = -px * SHEDS.uz + pz * SHEDS.ux;
  d = Math.min(d, Math.hypot(Math.max(0, Math.abs(su) - SHEDS.W), Math.max(0, tv - SHEDS.L, -tv)));
  if (Math.abs(x) < 252 && z < 510) d = Math.min(d, z - 510);   // the basin before the quay (dredged only in the depth buffer)
  return d;
}
// every place a route runs aground or scrapes past something: [name, x, z, what]
export function checkRoutes() {
  const bad = [];
  for (const [nm, def] of Object.entries(ROUTES)) {
    const r = makeRoute(def);
    for (let i = 0; i < r.N; i += 2) {
      const x = r.X[i], z = r.Z[i], depth = SEA - terrainHeight(x, z), cl = clearance(x, z);
      if (depth < def.draft + 0.5) bad.push([nm, Math.round(x), Math.round(z), 'depth ' + depth.toFixed(1)]);
      else if (cl < def.clear) bad.push([nm, Math.round(x), Math.round(z), 'clear ' + cl.toFixed(1)]);
    }
  }
  return bad;
}
function makeRoute(def) {
  const pts = def.pts, n = pts.length, curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
  let L0 = 0; for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; L0 += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const div = curve.arcLengthDivisions = Math.ceil(L0 * 1.3), lens = curve.getLengths(div), L = lens[div], N = Math.ceil(L);
  const P = curve.getSpacedPoints(N), X = new Float32Array(N), Z = new Float32Array(N), H = new Float32Array(N), Vt = new Float32Array(N), F = new Float32Array(N);
  for (let i = 0; i < N; i++) { X[i] = P[i].x; Z[i] = P[i].z; }
  for (let i = 0; i < N; i++) { const a = (i + N - 1) % N, b = (i + 1) % N; H[i] = Math.atan2(-(Z[b] - Z[a]), X[b] - X[a]); }
  const wS = pts.map((_, i) => lens[Math.round(i / n * div)]);
  for (let i = 0, k = 0; i < N; i++) {
    const s = i * L / N; while (k < n - 1 && wS[k + 1] <= s) k++;
    const k2 = (k + 1) % n, u = (s - wS[k]) / Math.max(1e-6, (k2 ? wS[k2] : L) - wS[k]);
    Vt[i] = lerp(pts[k][2], pts[k2][2], u); F[i] = lerp(pts[k][3] ?? 1, pts[k2][3] ?? 1, u);
  }
  return { N, L, X, Z, H, Vt, F, wS, stops: pts.map((p, i) => p[4] ? { s: wS[i], dur: p[4] } : null).filter(Boolean) };
}
function sample(r, s, o) {
  const f = (((s % r.L) + r.L) % r.L) / r.L * r.N, i = Math.floor(f) % r.N, j = (i + 1) % r.N, u = f - Math.floor(f);
  let dh = r.H[j] - r.H[i]; dh -= TAU * Math.round(dh / TAU);
  o.x = lerp(r.X[i], r.X[j], u); o.z = lerp(r.Z[i], r.Z[j], u); o.h = r.H[i] + dh * u; o.v = lerp(r.Vt[i], r.Vt[j], u); o.f = lerp(r.F[i], r.F[j], u);
  return o;
}

// ---------- the swell (felt by the craft only) ----------
const WAVES = [[46, 0.2, 0], [23, 0.09, 1.3], [13, 0.07, 0.55], [7.5, 0.04, -0.7]];   // wavelength, amplitude, heading off the wind
function makeSwell(wind) {
  const base = Math.atan2(wind.dz, wind.dx), W = WAVES.map(([l, a, d], i) => { const k = TAU / l; return { kx: Math.cos(base + d) * k, kz: Math.sin(base + d) * k, w: Math.sqrt(9.81 * k), a, p: i * 1.7 }; });
  return (x, z, t) => { let h = 0; for (const q of W) h += q.a * Math.sin(q.kx * x + q.kz * z - q.w * t + q.p); return h; };
}
// how much of it reaches a spot: little inside the moles, some in the royal harbour and under the shores, all of it in the bay
const shelter = (x, z) => (Math.abs(x) < 232 && z < 612 ? 0.22 : x > 250 && x < 440 && z < 665 ? 0.4 : 0.45 + 0.55 * smoothstep(640, 950, z));

// ---------- geometry helpers ----------
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function rod(a, b, r, segs = 5, rq = r) {
  const A = V3(...a), B = V3(...b), L = A.distanceTo(B) || 1e-3, q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), B.clone().sub(A).normalize());
  return scaleUV(new THREE.CylinderGeometry(rq, r, L, segs, 1), TAU * r, L).applyMatrix4(new THREE.Matrix4().compose(A.add(B).multiplyScalar(0.5), q, V3(1, 1, 1)));
}
function tube(pts, r, radial = 6, per = 5) { const c = new THREE.CatmullRomCurve3(pts.map(p => V3(...p))); return scaleUV(new THREE.TubeGeometry(c, Math.max(2, (pts.length - 1) * per), r, radial, false), c.getLength(), TAU * r); }
function basis(c, ax, up) { const X = V3(...ax).normalize(), Z = V3().crossVectors(X, V3(...up)).normalize(), Y = V3().crossVectors(Z, X); return new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(...c); }
const flipWinding = g => { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); return g; };
// A decked hull lofted through stations t ∈ [-1, 1] (stern → bow), waterline at y = 0: sec(t) → { w: half-beam at the sheer, top: sheer,
// bot: keel, k: section exponent (< 1 full and round, > 1 sharp) }. Strakes run along u (the plank texture's grain).
function loft(sec, HL, n = 36, m = 14) {
  const pos = [], uv = [], idx = [], dp = [], du = [], di = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n * 2 - 1, s = sec(t), x = t * HL; let arc = 0, py = 0, pz = 0;
    for (let j = 0; j <= m; j++) { const a = j / m * Math.PI, y = s.top - (s.top - s.bot) * Math.pow(Math.sin(a), s.k), z = -s.w * Math.cos(a); if (j) arc += Math.hypot(y - py, z - pz); py = y; pz = z; pos.push(x, y, z); uv.push(x, arc * 0.45); }
    dp.push(x, s.top - 0.03, -s.w * 0.98, x, s.top - 0.03, s.w * 0.98); du.push(x, -s.w, x, s.w);
  }
  for (let i = 0; i < n; i++) { for (let j = 0; j < m; j++) { const a = i * (m + 1) + j, b = a + m + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); } const a = i * 2; di.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const mk = (p, u, ix) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2)); g.setIndex(ix); g.computeVertexNormals(); return g; };
  const skin = mk(pos, uv, idx), deck = mk(dp, du, di);
  if (skin.attributes.normal.getY(Math.floor(n / 2) * (m + 1) + Math.floor(m / 2)) > 0) flipWinding(skin);
  if (deck.attributes.normal.getY(0) < 0) flipWinding(deck);
  // starboard half-breadth at (x, y), and a frame on the skin there (x along the hull, z out of it)
  const half = (x, y) => { const s = sec(clamp(x / HL, -1, 1)); if (y >= s.top) return s.w; if (y <= s.bot) return 0; const q = Math.pow((s.top - y) / (s.top - s.bot), 1 / s.k); return s.w * Math.sqrt(Math.max(0, 1 - q * q)); };
  const onSkin = (x, y, sd, off = 0.012) => {
    const P = V3(x, y, sd * half(x, y)), dx = V3(0.1, 0, sd * (half(x + 0.05, y) - half(x - 0.05, y))), dy = V3(0, 0.1, sd * (half(x, y + 0.05) - half(x, y - 0.05)));
    const N = V3().crossVectors(dx, dy).normalize(); if (N.z * sd < 0) N.negate();
    const X = dx.normalize(), Y = V3().crossVectors(N, X); return new THREE.Matrix4().makeBasis(X, Y, N).setPosition(P.addScaledVector(N, off));
  };
  return { skin, deck, half, onSkin, sec };
}

// ---------- merged geometry for the skinned meshes ----------
class Rig {   // every part rigidly bound to one bone; vertex colour and how much wood grain shows through it
  constructor() { this.parts = []; this.nv = 0; this.ni = 0; }
  add(g, m, bone, color, grain = 1) { const q = normalizeGeom(g); if (m) q.applyMatrix4(m); this.parts.push([q, bone, new THREE.Color(color), grain]); this.nv += q.attributes.position.count; this.ni += q.index.count; }
  geometry() {
    const nv = this.nv, P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), U = new Float32Array(nv * 2), C = new Float32Array(nv * 3), G = new Float32Array(nv), SI = new Uint16Array(nv * 4), SW = new Float32Array(nv * 4), I = new Uint32Array(this.ni);
    let v = 0, k = 0;
    for (const [g, b, c, gr] of this.parts) {
      const n = g.attributes.position.count, ix = g.index.array;
      P.set(g.attributes.position.array, v * 3); N.set(g.attributes.normal.array, v * 3); U.set(g.attributes.uv.array, v * 2);
      for (let i = v; i < v + n; i++) { C[i * 3] = c.r; C[i * 3 + 1] = c.g; C[i * 3 + 2] = c.b; G[i] = gr; SI[i * 4] = b; SW[i * 4] = 1; }
      for (let i = 0; i < ix.length; i++) I[k++] = ix[i] + v;
      v += n;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); geo.setAttribute('grain', new THREE.BufferAttribute(G, 1));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    return geo;
  }
}
class Cloth {   // grids whose shape the vertex shader makes: aSail = (u, v, slot); uv metric for the linen texture
  constructor() { this.S = []; this.U = []; this.B = []; this.I = []; this.n = 0; }
  grid(nu, nv, bone, slot, pennant, w, h) {
    const base = this.n;
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = pennant ? i / nu : i / nu * 2 - 1, v = pennant ? j / nv - 0.5 : j / nv;
      this.S.push(u, v, slot); this.U.push(pennant ? u * w : u * w / 2, v * h); this.B.push(bone); this.n++;
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; this.I.push(a, c, b, b, c, d); }
  }
  geometry() {
    const g = new THREE.BufferGeometry(), n = this.n, SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { SI[i * 4] = this.B[i]; SW[i * 4] = 1; }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('aSail', new THREE.Float32BufferAttribute(this.S, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    g.setIndex(this.I); return g;
  }
}

// ---------- shaders ----------
const NCL = 16;
const CLOTH_POS = /* glsl */`
attribute vec3 aSail; uniform vec4 uClothA[${NCL}]; uniform vec4 uClothB[${NCL}]; uniform float uTime; varying vec3 vSail;
// A = (belly, luff, set, mode), B = (width | length, height, phase, gust). Mode 0: a square sail hanging from its yard (bone y = 0)
// and bellying forward along +x, brailed up towards the yard as the set drops; mode 1: a pennant streaming along +x from its staff.
vec3 clothPos(vec2 q, vec4 A, vec4 B) {
  if (A.w < 0.5) {
    float u = q.x, v = q.y, s = sqrt(max(0.0, 1.0 - u * u));
    float bell = (1.0 - u * u) * sin(2.67 * v);
    float fl = A.y * v * s * (0.3 * sin(uTime * 6.3 + u * 4.1 + v * 3.3 + B.z) + 0.12 * sin(uTime * 13.7 - u * 9.0 + v * 5.0 + B.z * 2.3));
    return vec3(0.4 + (A.x * bell + fl) * A.z, -0.18 - v * A.z * B.y, u * B.x * 0.5);
  }
  float s = q.x, e = 0.55 + 0.45 * min(A.y, 1.0);
  float wv = sin(s * 8.0 - uTime * (5.0 + 4.0 * B.w) + B.z) * (0.04 + 0.3 * s * s) * e;
  return vec3(s * B.x, q.y * B.y * (1.0 - 0.7 * s) - 0.3 * s * s / max(B.w, 0.5), wv);
}`;
const CLOTH_EVAL = /* glsl */`
int ci = int(aSail.z + 0.5); vec4 cA = uClothA[ci], cB = uClothB[ci];
vec3 cP = clothPos(aSail.xy, cA, cB);`;

export function build(ctx) {
  const { M } = ctx, wind = ctx.wind, R = rng(5150), pick = a => a[Math.floor(R() * a.length)], t0 = performance.now();
  const swell = makeSwell(wind), rig = new Rig(), cloth = new Cloth(), crafts = [];
  let NB = 0, NC = 0; const newBone = () => NB++;
  const clothA = Array.from({ length: NCL }, () => new THREE.Vector4(0, 0, 1, 0)), clothB = Array.from({ length: NCL }, () => new THREE.Vector4(1, 1, 0, 1));
  const clothC = Array.from({ length: NCL }, () => new THREE.Vector4(0.8, 0.75, 0.65, 0)), clothD = Array.from({ length: NCL }, () => new THREE.Vector4(0.5, 0.2, 0.1, 10));
  const setCol = (v, hex, w) => { const c = new THREE.Color(hex); v.set(c.r, c.g, c.b, w); };
  const add = (g, m, b, c, gr) => rig.add(g, m, b, c, gr);

  // ---------- crew (figure frame: facing +x, right side +z, hip at the origin) ----------
  const TORSO = lathe([[0.001, -0.3], [0.2, -0.3], [0.19, -0.05], [0.17, 0.18], [0.2, 0.4], [0.16, 0.5], [0.06, 0.56]], 8).scale(0.72, 1, 1);
  function torso(put, skin, tunic, hat) {
    put(TORSO.clone(), tunic, 0.15);
    put(rod([0, 0.54, 0], [0, 0.66, 0], 0.05, 6), skin, 0);
    put(ellipsoid(0.1, 0.12, 0.092, 8, 6).translate(0.01, 0.76, 0), skin, 0);
    if (hat === 'helmet') { put(ellipsoid(0.125, 0.1, 0.118, 8, 5).translate(0, 0.8, 0), BRONZE, 0); put(box(0.34, 0.08, 0.035).translate(-0.03, 0.93, 0), 0x7a2418, 0); }
    else if (hat === 'pilos') put(new THREE.ConeGeometry(0.11, 0.2, 8).translate(0, 0.9, 0), pick(CAP), 0);
    else put(ellipsoid(0.105, 0.075, 0.098, 8, 4).translate(-0.012, 0.8, 0), 0x2a2018, 0);
  }
  // a standing man, feet at the origin of m: arms 'down' | 'fore' (hands at a tiller, a rail, the pipes)
  function standing(m, b, o = {}) {
    const hip = m.clone().multiply(mat(0, 0.92, 0)), put = (g, c, gr) => add(g, hip, b, c, gr), skin = o.skin ?? pick(SKIN), tunic = o.tunic ?? pick(TUNIC);
    torso(put, skin, tunic, o.hat);
    for (const s of [-1, 1]) {
      put(rod([0, -0.2, s * 0.1], [0.02, -0.88, s * 0.12], 0.065, 6, 0.055), skin, 0);
      put(rod([0, 0.47, s * 0.2], o.arms === 'fore' ? [0.4, 0.14, s * 0.17] : [0.04, -0.08, s * 0.25], 0.05, 6, 0.042), skin, 0);
    }
    if (o.shield) put(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 16).rotateX(Math.PI / 2).translate(0.16, 0.18, -0.34), BRONZE, 0);
    if (o.spear) put(rod([0.12, -0.92, 0.3], [0.12, 1.6, 0.3], 0.018, 4), OAKD, 0.2);
    if (o.pipes) for (const s of [-1, 1]) put(rod([0.1, 0.7, 0], [0.42, 0.42, s * 0.07], 0.012, 4), IVORY, 0);
  }
  // a man sitting with his hip at m's origin, thighs forward, feet on a floor footY below
  function seatedLegs(m, b, skin, tunic, footY) { for (const s of [-1, 1]) { add(rod([0, 0.02, s * 0.1], [0.42, 0.06, s * 0.12], 0.075, 6, 0.065), m, b, tunic, 0.1); add(rod([0.42, 0.06, s * 0.12], [0.5, footY + 0.04, s * 0.13], 0.06, 6, 0.05), m, b, skin, 0); add(box(0.2, 0.06, 0.09).translate(0.55, footY + 0.03, s * 0.13), m, b, 0x3a2a1c, 0); } }
  // an arm solved to its hand: two line bones (upper arm, forearm with the hand at its end)
  function armBones(skin) { const u = newBone(), f = newBone(); add(rod([0, 0, 0], [UA, 0, 0], 0.052, 6, 0.045), null, u, skin, 0); add(rod([0, 0, 0], [FA, 0, 0], 0.044, 6, 0.036), null, f, skin, 0); add(ellipsoid(0.05, 0.035, 0.045, 6, 4).translate(FA + 0.03, 0, 0), null, f, skin, 0); return [u, f]; }
  const BLADE = new THREE.CylinderGeometry(0.1, 0.055, 0.72, 8).rotateZ(-Math.PI / 2).scale(1, 1, 0.16);   // an oar blade: along +x, flat in z, widest at its tip
  const lineBone = (r = 0.02, color = ROPE) => { const b = newBone(); add(rod([0, 0, 0], [1, 0, 0], r, 4), null, b, color, 0); return b; };
  const clothSlot = () => NC++;

  // ---------- craft ----------
  function craft(id, kind, def, o) {
    const r = def && makeRoute(def), c = {
      id, kind, r, s: 0, v: 0, vt: 0, vk: 1, give: 1, giveT: 0, giveK: 1, surge: 1, wait: 0, acc: 0.12, dec: 0.1, bone: newBone(), m: new THREE.Matrix4(), x: 0, z: 0, h: 0, yawRate: 0,
      heel: 0, roll: 0, pitch: 0, pitchX: 0, heave: 0, y0: 0, sw: 1, rollA: 0.012, rollT: 6 + R() * 3, ph: R(), row: 0, sp: R() * TAU,
      wk: null, foam: [], sternX: 0, vref: 3, ...o,
    };
    c.prio = { merchant: 30, trireme: 20, boat: 10, net: 40 }[kind] - crafts.length * 0.01;   // right of way: sail over oars over boats
    if (r && o.at !== undefined) c.s = (r.wS[o.at] + (o.ahead || 0)) % r.L;
    if (r) c.v = sample(r, c.s, {}).v;
    crafts.push(c); return c;
  }
  const wakeRing = (K, gap, life, w0, k = 1) => ({ K, gap, life, w0, k, n: 0, head: 0, X: new Float32Array(K), Z: new Float32Array(K), T: new Float32Array(K), V: new Float32Array(K) });

  // ---------- the trireme ----------
  function trireme(id, def, at) {
    const c = craft(id, 'trireme', def, { at, len: 36, beam: 3.6, acc: 0.18, dec: 0.12, sw: 0.8, vref: 3.2, sternX: -16.5, oars: [], puddles: Array.from({ length: 8 }, () => ({ t0: -99 })), pi: 0 }), b = c.bone, HL = 17;
    const L = loft(t => {
      const tb = Math.max(t, 0), ts = Math.max(-t, 0), at = Math.abs(t);
      return { w: 1.78 * Math.pow(Math.max(0, 1 - Math.pow(at, t > 0 ? 2.4 : 2.0)), t > 0 ? 0.62 : 0.5) + 0.03, top: 1.95 + 0.55 * tb * tb + 1.5 * Math.pow(smoothstep(0.45, 1, ts), 1.6),
        bot: -1.05 + 0.75 * Math.pow(smoothstep(0.7, 1, tb), 2) + 1.9 * Math.pow(smoothstep(0.5, 1, ts), 1.4), k: 0.72 };
    }, HL, 44, 14);
    add(L.skin, null, b, PITCH, 0.55); add(L.deck, null, b, DECK, 1);
    c.foam = [0.5, 0.33, 0.1, -0.15, -0.4].map(f => [f * 34, L.half(f * 34, 0.02)]);
    // wales following the sheer, the upper one painted
    const top = x => L.sec(clamp(x / HL, -1, 1)).top;
    const wale = (dy, r, col, x0, x1) => { const pts = []; for (let i = 0; i <= 18; i++) { const x = lerp(x0, x1, i / 18), y = top(x) - dy; pts.push([x, y, L.half(x, y) + r * 0.6]); } for (const sd of [1, -1]) add(tube(pts.map(p => [p[0], p[1], sd * p[2]]), r, 5, 4), null, b, col, 0.3); };
    wale(0.2, 0.1, OCHRE, -14.6, 16.4); wale(0.95, 0.07, 0x2c211a, -14.2, 16.1);
    // the outrigger carrying the upper oars' tholes, on brackets and struts; leather screens sloping down to it from the deck edge
    for (const sd of [-1, 1]) {
      add(box(26.4, 0.24, 0.16), mat(0.6, 2.06, sd * 2.58), b, OCHRE, 0.4);
      for (let x = -12.4; x <= 13.61; x += 2.0) {
        const zi = L.half(x, 1.93), wz = 2.58 - zi + 0.05;
        add(box(2.0, 0.05, wz), mat(x + 1.0, 1.95, sd * (2.58 + zi) / 2), b, OAKD, 0.8);
        add(box(0.16, 0.12, wz), mat(x, 1.9, sd * (2.58 + zi) / 2), b, OAKD, 0.6);
        add(rod([x, 1.15, sd * (L.half(x, 1.15) + 0.02)], [x, 1.88, sd * 2.45], 0.05, 4), null, b, OAKD, 0.4);
      }
      add(box(26.7, 0.035, Math.hypot(0.93, 0.71)), mat(0.5, 2.5, sd * 2.115, sd * Math.atan2(0.71, 0.93), 0, 0), b, LEATHERD, 0.25);
    }
    // the deck (katastroma) over the rowers, closed at its ends
    add(box(26.7, 0.1, 3.3), mat(0.5, 2.86, 0), b, DECK, 1);
    for (const x of [-12.85, 13.85]) { const y0 = top(x) - 0.05; add(box(0.12, 2.86 - y0, 3.3), mat(x, (2.86 + y0) / 2, 0), b, OAKD, 0.6); }
    // bronze ram with its fins, the lesser ram above it, the stem, the catheads
    add(new THREE.CylinderGeometry(0.1, 0.5, 3.4, 4).rotateY(Math.PI / 4).rotateZ(-Math.PI / 2), mat(18.1, -0.02, 0), b, BRONZE, 0);
    for (const y of [-0.3, 0, 0.3]) add(new THREE.CylinderGeometry(0.02, 0.5, 3.0, 4).rotateZ(-Math.PI / 2).scale(1, 0.12, 1), mat(18.2, y, 0), b, BRONZE, 0);
    add(new THREE.CylinderGeometry(0.02, 0.45, 3.0, 4).rotateZ(-Math.PI / 2).scale(1, 1, 0.12), mat(18.2, 0, 0), b, BRONZE, 0);
    add(new THREE.ConeGeometry(0.2, 1.1, 6).rotateZ(-Math.PI / 2), mat(17.95, 1.45, 0), b, BRONZE, 0);
    add(tube([[16.6, -0.4, 0], [17.1, 0.7, 0], [17.45, 1.8, 0], [17.55, 2.8, 0], [17.3, 3.55, 0], [16.85, 3.8, 0]], 0.19, 6), null, b, PITCH, 0.4);
    add(box(0.42, 0.42, 5.4), mat(14.3, 2.25, 0), b, OCHRE, 0.4);
    // the painted eyes
    for (const sd of [-1, 1]) { const m = L.onSkin(15.1, 1.1, sd); add(new THREE.CircleGeometry(0.34, 16).scale(1.5, 0.95, 1), m, b, IVORY, 0); add(new THREE.CircleGeometry(0.16, 12), m.clone().multiply(mat(0.05, 0, 0.006)), b, INK, 0); add(new THREE.RingGeometry(0.34, 0.42, 16).scale(1.5, 0.95, 1), m.clone().multiply(mat(0, 0, -0.004)), b, OCHRE, 0); }
    // stern: sternpost and the aphlaston fanning up and forward over it, the ensign staff, two steering oars with their tillers
    add(tube([[-16.0, 0.9, 0], [-16.9, 2.0, 0], [-17.6, 3.2, 0], [-17.9, 4.1, 0]], 0.2, 6), null, b, PITCH, 0.4);
    for (let k = 0; k < 5; k++) { const zk = (k - 2) * 0.13; add(tube([[-17.7, 3.8, zk * 0.4], [-18.3, 4.8, zk * 0.8], [-18.2, 5.8, zk], [-17.5, 6.5, zk * 1.15], [-16.7, 6.6, zk * 1.3], [-16.3, 6.3, zk * 1.3]], 0.065, 5, 4), null, b, k % 2 ? OCHRE : PITCH, 0.3); }
    add(rod([-15.3, 3.1, 0], [-15.3, 5.9, 0], 0.04, 5), null, b, OAKD, 0.3);
    for (const sd of [-1, 1]) {
      const a = [-13.4, 2.95, sd * 1.55], e = [-16.0, -0.9, sd * 2.05];
      add(rod(a, e, 0.1, 6, 0.08), null, b, OAKD, 0.7);
      add(box(1.5, 0.05, 0.42), basis([lerp(a[0], e[0], 0.86), lerp(a[1], e[1], 0.86), lerp(a[2], e[2], 0.86)], [e[0] - a[0], e[1] - a[1], e[2] - a[2]], [0, 0, 1]), b, OAKD, 0.7);
      add(rod(a, [-12.15, 3.92, sd * 0.2], 0.045, 4), null, b, OAKD, 0.5);
    }
    // three banks of oars: thranites on the outrigger, zygites and thalamites through ports in the side (leather-sleeved)
    for (const [n, x0, dx, y, Lo, Li, lower] of [[31, -12.2, 0.83, 2.08, 3.3, 0.1, false], [27, -11.4, 0.92, 1.35, 3.1, 0.9, true], [27, -10.9, 0.92, 0.55, 2.75, 0.8, true]]) {
      for (let i = 0; i < n; i++) for (const sd of [-1, 1]) {
        const x = x0 + i * dx, pz = lower ? L.half(x, y) + 0.02 : 2.6, ob = newBone();
        add(rod([-Li, 0, 0], [Lo - 0.62, 0, 0], 0.036, 5, 0.03), null, ob, 0x8a6a48, 0.5);
        add(BLADE, mat(Lo - 0.36, 0, 0), ob, 0x6e5238, 0.5);
        c.oars.push({ bone: ob, px: x, py: y, pz: sd * pz, sd, Lo, j: (R() - 0.5) * 0.02 });
        if (lower) { const m = L.onSkin(x, y, sd, 0.008); add(new THREE.CircleGeometry(0.11, 8), m, b, 0x2a1a12, 0); }
      }
    }
    c.bank = [-12.2, -12.2 + 30 * 0.83];
    // the crew on deck: a lookout at the bow, marines, archers, the rowing master and his piper, the trierarch and the helmsman
    const deckY = 2.91;
    standing(mat(13.2, deckY, 0), b, { arms: 'down', hat: 'pilos' });
    for (const [x, z] of [[10.5, 0.8], [8.3, -0.7], [-4.5, 0.75], [-6.8, -0.8]]) standing(mat(x, deckY, z, 0, z > 0 ? -0.5 : 0.5, 0), b, { hat: 'helmet', shield: true, spear: true, tunic: pick([0x8c3a2b, 0x7a3a2a, 0xa39373]) });
    for (const [x, z] of [[5.6, 0.9], [-1.8, -0.9]]) standing(mat(x, deckY, z, 0, R() * 2 - 1, 0), b, { hat: 'pilos', tunic: pick([0x44517a, 0xb4863c]) });
    standing(mat(1.6, deckY, 0.1, 0, Math.PI, 0), b, { arms: 'fore', tunic: 0xcabd9d });
    standing(mat(0.4, deckY, -0.25, 0, Math.PI, 0), b, { arms: 'fore', pipes: true, tunic: 0xd3c8ae });
    standing(mat(-10.6, deckY, 0.3), b, { tunic: 0x8a302a });
    standing(mat(-12.55, deckY, 0), b, { arms: 'fore', hat: 'pilos', tunic: 0x877157 });
    // the ensign on its staff
    c.ens = { bone: newBone(), slot: clothSlot(), local: V3(-15.3, 5.75, 0) };
    cloth.grid(8, 2, c.ens.bone, c.ens.slot, true, 1.1, 0.7); clothA[c.ens.slot].set(0, 0.5, 1, 1); clothB[c.ens.slot].set(1.1, 0.7, R() * TAU, 1); setCol(clothC[c.ens.slot], 0xe0d6c0, 4); setCol(clothD[c.ens.slot], 0x7a2418, 0);
    c.wk = wakeRing(72, 3.5, 75, 2.1, 1);
    return c;
  }

  // ---------- merchantmen: round hull, one mast with a square sail, a steering oar on each quarter ----------
  function merchant(id, def, at, o) {
    const sc = o.sc, HL = 9.25 * sc, c = craft(id, 'merchant', def, { at, ahead: o.ahead, len: 18.5 * sc, beam: 5.5 * sc, acc: 0.06, dec: 0.05, sw: 0.9, vref: 2.6, sternX: -8.8 * sc, sc, brace: 0, reef: 1, bellyS: 0, luffS: 0, luffing: false });
    const b = c.bone;
    const L = loft(t => {
      const tb = Math.max(t, 0), ts = Math.max(-t, 0), at = Math.abs(t);
      return { w: 2.75 * sc * Math.pow(Math.max(0, 1 - Math.pow(at, t > 0 ? 2.1 : 2.6)), 0.42) + 0.03, top: (1.45 + 0.85 * tb * tb + 1.25 * ts * ts) * sc, bot: (-1.55 + 1.05 * Math.pow(smoothstep(0.55, 1, at), 1.5)) * sc, k: 0.55 };
    }, HL, 34, 14);
    const top = x => L.sec(clamp(x / HL, -1, 1)).top;
    add(L.skin, null, b, PITCHB, 0.6); add(L.deck, null, b, DECK, 1);
    c.foam = [0.5, 0.3, 0.05, -0.2, -0.45].map(f => [f * 2 * HL, L.half(f * 2 * HL, 0.02)]);
    // wale, a wicker bulwark along the waist with its rail, stem and a sternpost curling forward
    { const pts = []; for (let i = 0; i <= 16; i++) { const x = lerp(-0.93 * HL, 0.96 * HL, i / 16), y = top(x) - 0.42 * sc; pts.push([x, y, L.half(x, y) + 0.06]); } for (const sd of [1, -1]) add(tube(pts.map(p => [p[0], p[1], sd * p[2]]), 0.1 * sc, 5, 4), null, b, o.band, 0.3); }
    for (const sd of [-1, 1]) {
      const pos = [], idx = [], rail = [], n = 14;
      for (let i = 0; i <= n; i++) { const x = lerp(-0.72 * HL, 0.8 * HL, i / n), y = top(x), z = sd * L.half(x, y - 0.02); pos.push(x, y - 0.05, z, x, y + 0.48 * sc, z + sd * 0.04); rail.push([x, y + 0.5 * sc, z + sd * 0.04]); }
      for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.filter((_, k) => k % 3 !== 2).map((v, k) => k % 2 ? v * 3 : v * 0.6), 2)); g.setIndex(idx); g.computeVertexNormals();
      add(g, null, b, WICKER, 0.5); add(flipWinding(g.clone()), null, b, WICKER, 0.5);
      add(tube(rail, 0.06, 5, 3), null, b, OAKD, 0.6);
    }
    add(tube([[8.9 * sc, -0.9 * sc, 0], [9.5 * sc, 0.8 * sc, 0], [9.8 * sc, 2.3 * sc, 0], [9.65 * sc, 3.2 * sc, 0], [9.2 * sc, 3.5 * sc, 0]], 0.2 * sc, 6), null, b, OAKD, 0.6);
    add(tube([[-8.8 * sc, -0.6 * sc, 0], [-9.6 * sc, 1.2 * sc, 0], [-10.0 * sc, 2.8 * sc, 0], [-9.8 * sc, 3.9 * sc, 0], [-9.1 * sc, 4.4 * sc, 0], [-8.5 * sc, 4.2 * sc, 0]], 0.22 * sc, 6), null, b, OAKD, 0.6);
    for (const sd of [-1, 1]) { const m = L.onSkin(7.9 * sc, 1.25 * sc, sd); add(new THREE.CircleGeometry(0.22 * sc, 14).scale(1.45, 0.9, 1), m, b, IVORY, 0); add(new THREE.CircleGeometry(0.1 * sc, 10), m.clone().multiply(mat(0.03, 0, 0.005)), b, INK, 0); }
    // stern platform for the helmsman, the hatch amidships with deck cargo, the mast and its stays and shrouds
    const sy = top(-6.9 * sc); add(box(3.2 * sc, 0.35, 3.6 * sc), mat(-6.9 * sc, sy + 0.1, 0), b, DECK, 1);
    add(box(5.2 * sc, 0.4, 2.6 * sc), mat(-1.8 * sc, top(0) + 0.12, 0), b, OAKD, 0.8);
    const amph = lathe([[0.012, 0], [0.12, 0.25], [0.168, 0.44], [0.15, 0.6], [0.06, 0.69], [0.045, 0.83]], 7);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) add(amph.clone().rotateZ(Math.PI / 2 + 0.1), mat(-3.9 * sc + i * 0.95 * sc, top(0) + 0.5, (j - 1) * 0.72 * sc), b, pick([0xb86a45, 0xc47a50, 0xa85f3c]), 0.1);
    for (const [x, z] of [[2.6, 0.7], [2.9, -0.6], [3.9, 0.1]]) add(box(0.9, 0.6, 0.7), mat(x * sc, top(x * sc) + 0.3, z * sc, 0, R(), 0), b, pick([0xac7c52, 0x9e704a, 0xb4865a]), 0.2);
    const mastX = 0.9 * sc, mastTop = 13.8 * sc, yardY = 13.0 * sc, W = 11.5 * sc, H = 8.2 * sc;
    add(rod([mastX, top(mastX) - 0.2, 0], [mastX, mastTop, 0], 0.2 * sc, 8, 0.13 * sc), null, b, OAKD, 0.8);
    add(box(0.4, 0.5, 0.35).translate(mastX, mastTop - 0.1, 0), null, b, OAKD, 0.6);
    for (const p of [[9.4 * sc, 3.1 * sc, 0], [-9.0 * sc, 4.3 * sc, 0], [0.1 * sc, top(0) + 0.1, 2.72 * sc], [-1.3 * sc, top(0) + 0.1, 2.68 * sc], [0.1 * sc, top(0) + 0.1, -2.72 * sc], [-1.3 * sc, top(0) + 0.1, -2.68 * sc]])
      add(rod([mastX, mastTop - 0.3, 0], p, 0.025, 3), null, b, ROPE, 0);
    for (const sd of [-1, 1]) {   // steering oars on the quarters, their tillers reaching in to the helmsman's hands
      const a = [-7.3 * sc, top(-7.3 * sc) + 0.45, sd * 2.5 * sc], e = [-9.2 * sc, -1.25 * sc, sd * 2.9 * sc];
      add(rod(a, e, 0.1, 6, 0.08), null, b, OAKD, 0.7);
      add(box(1.4 * sc, 0.05, 0.5 * sc), basis([lerp(a[0], e[0], 0.84), lerp(a[1], e[1], 0.84), lerp(a[2], e[2], 0.84)], [e[0] - a[0], e[1] - a[1], e[2] - a[2]], [0, 0, 1]), b, OAKD, 0.7);
      add(rod(a, [-6.45 * sc, sy + 1.3, sd * 0.2], 0.045, 4), null, b, OAKD, 0.5);
    }
    standing(mat(-6.85 * sc, sy + 0.28, 0), b, { arms: 'fore', hat: 'pilos' });
    standing(mat(1.8 * sc, top(1.8 * sc), -1.0 * sc, 0, 0.8, 0), b, {});
    { const hip = mat(6.4 * sc, top(6.4 * sc) + 0.02, 0.6 * sc, 0, -2.4, 0), put = (g, cl, gr) => add(g, hip, b, cl, gr), sk = pick(SKIN), tu = pick(TUNIC); torso(put, sk, tu, 'pilos'); seatedLegs(hip, b, sk, tu, 0.0); }
    // the yard (its own bone, braced round the mast), the sail on it, braces and sheets as line bones, a pennant at the masthead
    c.yard = { bone: newBone(), slot: clothSlot(), mastX, yardY, W, H, mastTop };
    for (const sd of [-1, 1]) add(rod([0.28, 0, 0], [0.28, 0, sd * (W / 2 + 0.3)], 0.13 * sc, 6, 0.06 * sc), null, c.yard.bone, OAKD, 0.7);
    cloth.grid(14, 10, c.yard.bone, c.yard.slot, false, W, H);
    clothB[c.yard.slot].set(W, H, R() * TAU, 1); setCol(clothC[c.yard.slot], o.linen, o.pat); setCol(clothD[c.yard.slot], o.dye ?? 0x8c3a2b, Math.round(H / 0.75));
    c.lines = [lineBone(0.03), lineBone(0.03), lineBone(0.03), lineBone(0.03)];   // braces, sheets
    c.pen = { bone: newBone(), slot: clothSlot() }; cloth.grid(10, 1, c.pen.bone, c.pen.slot, true, 3.2 * sc, 0.42 * sc);
    clothA[c.pen.slot].set(0, 0.6, 1, 1); clothB[c.pen.slot].set(3.2 * sc, 0.42 * sc, R() * TAU, 1); setCol(clothC[c.pen.slot], 0xe0d6c0, 4); setCol(clothD[c.pen.slot], o.dye ?? 0x8c3a2b, 0);
    c.topAft = top(-8 * sc); c.topMid = top(0);
    c.wk = wakeRing(52, 3.5, 60, 2.2 * sc, 0.8);
    return c;
  }

  // ---------- fishing boats (the harbour's own hull shape) ----------
  function boatHull(c, len) {
    const b = c.bone, wid = 1.55 + len * 0.05, h = hullGeo(len, wid, 0.62);
    add(h.outer, null, b, PITCHB, 0.4); add(h.band, null, b, pick(BAND), 0.2); add(h.inner, null, b, 0x7a5a3c, 0.8);
    // floorboards just above the waterline: the sea is an opaque plane and would otherwise show inside the open hull
    const fy = 0.3, pos = [], idx = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12 * 2 - 1, w = Math.max(0.02, wid / 2 * Math.pow(Math.max(0, 1 - t * t), 0.55) - 0.05), sheer = 0.62 + 0.22 * t * t * (t > 0 ? 1.5 : 1), d = 0.62 * (1 - 0.38 * t * t) - 0.05;
      const q = (sheer - fy) / Math.max(d, 1e-3), zf = q >= 1 ? 0 : w * Math.sqrt(Math.max(0, 1 - Math.pow(q, 8 / 3))) + 0.015, x = t * len / 2 * 0.985;
      pos.push(x, fy, -zf, x, fy, zf); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(pos.filter((_, k) => k % 3 !== 1), 2)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) flipWinding(g);
    add(g, null, b, WET, 0.9);
    for (const t of [-0.22, 0.2]) add(box(0.22, 0.05, wid * Math.pow(1 - 4 * t * t, 0.55) - 0.08), mat(t * len, 0.5, 0), b, 0x8a6a48, 0.8);
    const ew = wid / 2 * Math.pow(1 - 0.76 * 0.76, 0.55) * 0.97 + 0.012;
    for (const sz of [-1, 1]) { add(new THREE.CircleGeometry(0.065, 10), mat(len * 0.38, 0.7, sz * ew, 0, sz > 0 ? 0.45 : Math.PI - 0.45, 0), b, 0xd8cfbf, 0); add(new THREE.CircleGeometry(0.032, 8), mat(len * 0.38 + 0.01, 0.7, sz * (ew + 0.006), 0, sz > 0 ? 0.45 : Math.PI - 0.45, 0), b, 0x1e1a18, 0); }
    if (R() < 0.7) add(ellipsoid(0.45, 0.15, 0.35, 6, 4), mat(-len * 0.3, fy + 0.08, 0.1), b, pick([0x6e5a40, 0x5e5040, 0x4a3b2c]), 0.2);   // a heap of net
    add(lathe([[0.16, 0], [0.2, 0.2], [0.22, 0.28]], 8), mat(-len * 0.1, fy, -0.35), b, 0x9a7a4a, 0.4);   // a basket
    c.y0 = 0.18; c.wid = wid; c.len = len; c.beam = wid; c.sternX = -len * 0.46;
    c.foam = [0.49, 0.3, 0, -0.3, -0.46].map(f => { const t = f * 2; return [f * len, Math.max(0.05, wid / 2 * Math.pow(Math.max(0, 1 - t * t), 0.55) * 0.8)]; });
    c.wk = wakeRing(30, 1.0, 22, wid * 0.4, 0.55);
    return wid;
  }
  function rowingBoat(id, def, at, crew2) {
    const len = 5.4 + R() * 1.2, c = craft(id, 'boat', def, { at, len, acc: 0.25, dec: 0.2, sw: 1.0, rollA: 0.02, vref: 1.2, oars: [], puddles: Array.from({ length: 6 }, () => ({ t0: -99 })), pi: 0 }), wid = boatHull(c, len), b = c.bone;
    // the rower on the forward thwart, facing aft; his oars on tholes a little aft of him
    const sk = pick(SKIN), tu = pick(TUNIC), hx = 0.2 * len, tt = (hx - 0.38) / (len / 2);
    const gw = wid / 2 * Math.pow(Math.max(0, 1 - tt * tt), 0.55), gy = 0.62 + 0.22 * tt * tt * 1.5;
    c.rower = { hip: V3(hx, 0.6, 0), torso: newBone(), arms: [armBones(sk), armBones(sk)] };
    const tp = (g, cl, gr) => add(g, null, c.rower.torso, cl, gr); torso(tp, sk, tu, R() < 0.6 ? 'pilos' : null);
    seatedLegs(mat(hx, 0.6, 0, 0, Math.PI, 0), b, sk, tu, 0.3 - 0.6);
    for (const sd of [-1, 1]) {
      const ob = newBone(); add(rod([-0.72, 0, 0], [1.38, 0, 0], 0.03, 5, 0.026), null, ob, 0x8a6a48, 0.5); add(BLADE.clone().scale(0.85, 0.8, 1), mat(1.66, 0, 0), ob, 0x6e5238, 0.5);
      add(ellipsoid(0.05, 0.045, 0.05, 6, 4).translate(-0.68, 0, 0), null, ob, sk, 0);   // the hand on the loom
      c.oars.push({ bone: ob, px: hx - 0.38, py: gy + 0.06, pz: sd * (gw - 0.02), sd, Lo: 1.97, Li: 0.68, j: 0 });
      add(rod([hx - 0.38, gy - 0.05, sd * (gw - 0.03)], [hx - 0.38, gy + 0.12, sd * (gw - 0.03)], 0.02, 4), null, b, OAKD, 0.4);
    }
    if (crew2) { const hip = mat(-0.22 * len, 0.56, 0), put = (g, cl, gr) => add(g, hip, b, cl, gr), s2 = pick(SKIN), t2 = pick(TUNIC); torso(put, s2, t2, 'pilos'); seatedLegs(hip, b, s2, t2, 0.3 - 0.56); for (const s of [-1, 1]) put(rod([0, 0.47, s * 0.2], [0.34, 0.08, s * 0.12], 0.05, 6, 0.042), s2, 0); }
    return c;
  }
  function netBoat(id, x, z, h) {
    const len = 5.6 + R() * 1.0, c = craft(id, 'net', null, { len, sw: 1.0, rollA: 0.02, anchor: [x, z, h], vref: 1 }), wid = boatHull(c, len), b = c.bone;
    // the hauler kneels at the starboard side facing out over the gunwale, the other sits aft over the shipped oars
    const sk = pick(SKIN), tu = pick(TUNIC);
    c.hauler = { hip: V3(0.1, 0.72, 0.28), torso: newBone(), arms: [armBones(sk), armBones(sk)], line: lineBone(0.012) };
    const tp = (g, cl, gr) => add(g, null, c.hauler.torso, cl, gr); torso(tp, sk, tu, R() < 0.5 ? 'pilos' : null);
    for (const s of [-1, 1]) { add(rod([0.1 + s * 0.11, 0.72, 0.28], [0.1 + s * 0.12, 0.35, 0.58], 0.075, 6, 0.065), null, b, tu, 0.1); add(rod([0.1 + s * 0.12, 0.35, 0.58], [0.1 + s * 0.13, 0.34, 0.1], 0.06, 6, 0.05), null, b, sk, 0); }
    { const hip = mat(-0.22 * len, 0.56, 0), put = (g, cl, gr) => add(g, hip, b, cl, gr), s2 = pick(SKIN), t2 = pick(TUNIC); torso(put, s2, t2, 'pilos'); seatedLegs(hip, b, s2, t2, 0.3 - 0.56); for (const s of [-1, 1]) put(rod([0, 0.47, s * 0.2], [0.3, 0.02, s * 0.14], 0.05, 6, 0.042), s2, 0); }
    for (const s of [-1, 1]) add(rod([-len * 0.36, 0.52, s * 0.25], [len * 0.3, 0.42, s * 0.1], 0.03, 4), null, b, 0x5a4432, 0.4);   // the oars shipped
    // the net's float line lying on the water in an arc off the starboard side (a bone of its own, fixed on the sea)
    c.floats = newBone(); const fl = [];
    for (let i = 0; i <= 26; i++) { const a = i / 26, px = 1.5 - 13 * a + 6 * Math.sin(a * Math.PI), pz = 2.2 + 26 * a; fl.push([px, 0, pz]); if (i % 1 === 0) add(ellipsoid(0.09, 0.05, 0.09, 6, 3), mat(px, 0, pz), c.floats, CORK, 0); }
    add(tube(fl, 0.012, 3, 2), null, c.floats, ROPE, 0);
    c.wk = null;
    return c;
  }

  // ---------- the fleet ----------
  trireme('trireme', ROUTES.trireme, 13);   // (entering the harbour)
  merchant('merchant-harbour', ROUTES.harbour, 2, { sc: 1.0, ahead: 150, band: OCHRE, linen: 0xd9cfb8, pat: 1, dye: 0x8c3a2b });
  merchant('merchant-harbour-2', ROUTES.harbour, 2, { sc: 0.92, ahead: 150 + 3715, band: 0x6a4a34, linen: 0xdcd2bc, pat: 2, dye: 0x9a5a2a });
  merchant('merchant-bay', ROUTES.bay, 1, { sc: 1.08, ahead: 350, band: 0x3d5670, linen: 0xd6c8a8, pat: 2, dye: 0x44517a });
  merchant('merchant-far', ROUTES.far, 1, { sc: 1.12, ahead: 600, band: 0x9a7a45, linen: 0xcbb58e, pat: 0 });
  merchant('merchant-south', ROUTES.south, 6, { sc: 0.82, ahead: 200, band: 0x4f5c48, linen: 0xc49a5a, pat: 3, dye: 0x7a3a2a });
  rowingBoat('boat-west', ROUTES.west, 1, true);
  rowingBoat('boat-east', ROUTES.east, 5, false);
  rowingBoat('boat-mole', ROUTES.mole, 2, true);
  netBoat('boat-net-cape', -335, 700, 0.4);
  netBoat('boat-net-bay', 40, 715, -0.8);
  for (const c of crafts) if (c.r) { const bad = []; for (let i = 0; i < c.r.N; i += 4) { const x = c.r.X[i], z = c.r.Z[i]; if (SEA - terrainHeight(x, z) < 0.6) bad.push([Math.round(x), Math.round(z)]); } if (bad.length) console.warn(`[ships] ${c.id} runs aground near`, bad.slice(0, 4)); }

  // ---------- materials and meshes ----------
  const skel = new THREE.Skeleton(Array.from({ length: NB }, () => new THREE.Bone()), Array.from({ length: NB }, () => new THREE.Matrix4()));
  skel.update = function () { if (this.boneTexture) this.boneTexture.needsUpdate = true; };   // the matrices are ours, written in update()
  const put = (b, m) => { const a = skel.boneMatrices, e = m.elements, o = b * 16; for (let i = 0; i < 16; i++) a[o + i] = e[i]; };
  // a bone whose x axis runs from A to B (scaled by |AB| / rest), y as near up as it can be
  const putLine = (b, ax, ay, az, bx, by, bz, rest = 1) => {
    let dx = bx - ax, dy = by - ay, dz = bz - az; const L = Math.hypot(dx, dy, dz) || 1e-4; dx /= L; dy /= L; dz /= L;
    let zx = -dz, zz = dx; const zl = Math.hypot(zx, zz); if (zl < 1e-4) { zx = 0; zz = 1; } else { zx /= zl; zz /= zl; }
    const a = skel.boneMatrices, o = b * 16, k = L / rest;
    a[o] = dx * k; a[o + 1] = dy * k; a[o + 2] = dz * k; a[o + 3] = 0;
    a[o + 4] = -zz * dy; a[o + 5] = zz * dx - zx * dz; a[o + 6] = zx * dy; a[o + 7] = 0;
    a[o + 8] = zx; a[o + 9] = 0; a[o + 10] = zz; a[o + 11] = 0;
    a[o + 12] = ax; a[o + 13] = ay; a[o + 14] = az; a[o + 15] = 1;
  };

  const hullMat = new THREE.MeshStandardMaterial({ map: M.T.wood.map, normalMap: M.T.wood.normalMap, vertexColors: true, roughness: 0.78, metalness: 0, envMapIntensity: 0.35, normalScale: new THREE.Vector2(0.7, 0.7) });
  hullMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float grain; varying float vGrain;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrain = grain;');
    // the plank texture only as grain (its luminance, normalised) over the paint, and its normals only where the wood is bare
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGrain;')
      .replace('#include <map_fragment>', 'vec4 texW = texture2D(map, vMapUv); diffuseColor.rgb *= mix(vec3(1.0), vec3(dot(texW.rgb, vec3(0.2126, 0.7152, 0.0722)) * 5.8), vGrain);')
      .replace('#include <normal_fragment_maps>', 'vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0; mapN.xy *= normalScale * vGrain; normal = normalize(tbn * mapN);');
  };
  hullMat.customProgramCacheKey = () => 'ships-hull';
  ctx.setupMaterial(hullMat);

  const clothU = { uTime: { value: 0 }, uClothA: { value: clothA }, uClothB: { value: clothB }, uClothC: { value: clothC }, uClothD: { value: clothD } };
  const clothMat = new THREE.MeshStandardMaterial({ map: M.T.plasterGrey.map, normalMap: M.T.plasterGrey.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), side: THREE.DoubleSide, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
  clothMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, clothU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + CLOTH_POS)
      .replace('#include <beginnormal_vertex>', CLOTH_EVAL + '\nvec3 objectNormal = normalize(cross(clothPos(aSail.xy + vec2(0.01, 0.0), cA, cB) - cP, clothPos(aSail.xy + vec2(0.0, 0.01), cA, cB) - cP)); vSail = aSail;')
      .replace('#include <begin_vertex>', 'vec3 transformed = cP;');
    // linen: dyed bands by pattern, the brails running down its face and the seams across it
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nuniform vec4 uClothC[${NCL}]; uniform vec4 uClothD[${NCL}]; varying vec3 vSail;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      { int ci = int(vSail.z + 0.5); vec4 C = uClothC[ci], D = uClothD[ci]; vec3 col = C.rgb; float p = C.w, u = vSail.x, v = vSail.y, au = abs(u);
        if (p > 0.5 && p < 1.5) col = mix(col, D.rgb, step(0.3, au) * step(au, 0.52));
        else if (p > 1.5 && p < 2.5) col = mix(col, D.rgb, max(step(v, 0.1), step(0.9, v)));
        else if (p > 2.5 && p < 3.5) col = mix(D.rgb, col, step(au, 0.2));
        else if (p > 3.5) col = D.rgb * mix(1.0, 1.25, step(0.5, fract(u * 3.0)));
        if (p < 3.5) { float bl = abs(fract(u * 5.0) - 0.5), sm = abs(fract(v * D.w) - 0.5); col *= 1.0 - 0.3 * smoothstep(0.455, 0.5, bl) - 0.12 * smoothstep(0.45, 0.5, sm); }
        diffuseColor.rgb *= col; }`);
  };
  clothMat.customProgramCacheKey = () => 'ships-cloth';
  ctx.setupMaterial(clothMat);
  const clothDepth = new THREE.MeshDepthMaterial();
  clothDepth.onBeforeCompile = sh => { Object.assign(sh.uniforms, clothU); sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + CLOTH_POS).replace('#include <begin_vertex>', CLOTH_EVAL + '\nvec3 transformed = cP; vSail = aSail;'); };
  clothDepth.customProgramCacheKey = () => 'ships-cloth-depth';

  const group = new THREE.Group(); group.name = 'ships';
  const hullMesh = new THREE.SkinnedMesh(rig.geometry(), hullMat); hullMesh.name = 'ships-hulls';
  hullMesh.bind(skel, new THREE.Matrix4()); hullMesh.frustumCulled = false; hullMesh.castShadow = hullMesh.receiveShadow = true;
  const clothMesh = new THREE.SkinnedMesh(cloth.geometry(), clothMat); clothMesh.name = 'ships-sails';
  clothMesh.bind(skel, new THREE.Matrix4()); clothMesh.frustumCulled = false; clothMesh.castShadow = clothMesh.receiveShadow = true; clothMesh.customDepthMaterial = clothDepth; clothMesh.userData.noAO = true;
  group.add(hullMesh, clothMesh);

  // ---------- wakes: one ribbon mesh on the water ----------
  // aW.w = kind + strength: 0 the wake behind, aW = (metres across, half-width, age s), aB = its churned wash's half-width at the stern;
  // 1 white water along the hull, aW = (metres out from the hull side, metres from the bow); 2 oar puddles, aW = (±1, cells along, age)
  const WV = 4096, WI = 12288, wPos = new Float32Array(WV * 3), wAtt = new Float32Array(WV * 4), wB = new Float32Array(WV), wIdx = new Uint16Array(WI);
  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3).setUsage(THREE.DynamicDrawUsage)); wGeo.setAttribute('aW', new THREE.BufferAttribute(wAtt, 4).setUsage(THREE.DynamicDrawUsage)); wGeo.setAttribute('aB', new THREE.BufferAttribute(wB, 1).setUsage(THREE.DynamicDrawUsage)); wGeo.setIndex(new THREE.BufferAttribute(wIdx, 1).setUsage(THREE.DynamicDrawUsage));
  const wakeMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uFoam: { value: new THREE.Color(0xf2f6f8) } }]),
    vertexShader: /* glsl */`attribute vec4 aW; attribute float aB; varying vec4 vW; varying float vB; varying vec2 vXZ;
#include <fog_pars_vertex>
void main() { vW = aW; vB = aB; vXZ = position.xz; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader: /* glsl */`uniform float uTime; uniform vec3 uFoam; varying vec4 vW; varying float vB; varying vec2 vXZ;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  // two octaves only: finer foam noise just shimmers (aliases) at the distances the water is mostly seen from
  float n = vnoise(vXZ * 0.55 + vec2(uTime * 0.04, 0.0)) * 0.6 + vnoise(vXZ * 1.9 - vec2(0.0, uTime * 0.07)) * 0.4;
  float k = floor(vW.w + 0.001), str = vW.w - k, a = 0.0;
  if (k < 0.5) {            // the wake: the churned wash about a beam wide down its middle, thin broken Kelvin arms along its spreading edges
    float x = abs(vW.x), w = max(vW.y, 0.01), age = vW.z, wc = min(w, vB * (0.8 + 0.035 * age));
    float wash = (1.0 - smoothstep(wc * 0.45, wc, x)) * exp(-age / 9.0);
    float aw0 = 0.45 + 0.03 * age, aw = max(aw0, fwidth(x) * 2.0);   // never thinner than a couple of pixels: far off it widens and fades instead
    float arm = smoothstep(w - aw * 2.2, w - aw * 0.7, x) * (1.0 - smoothstep(w - aw * 0.5, w, x)) * exp(-age / 20.0) * min(1.0, aw0 / aw) * smoothstep(0.0, 1.5, age);
    a = (wash * smoothstep(0.3, 0.8, n) * 0.7 + arm * smoothstep(0.42, 0.8, n) * 0.55) * str;
  } else if (k < 1.5) {     // white water hugging the hull, thickest at the bow
    float d = vW.x;
    a = smoothstep(-0.2, 0.05, d) * (1.0 - smoothstep(0.0, 1.0, d)) * (0.35 + 0.65 * exp(-vW.y / 3.0)) * smoothstep(0.2, 0.75, n) * str * 0.75;
  } else {                  // oar puddles: a swirl where each blade came out, spreading and fading
    float age = vW.z, n2 = vnoise(vXZ * 5.0 + age); vec2 q = vec2(fract(vW.y) - 0.5, vW.x * 0.55); float r = length(q) * 2.0 + (n2 - 0.5) * 0.6, R0 = 0.3 + age * 0.09;
    a = (smoothstep(R0 - 0.4, R0, r) * (1.0 - smoothstep(R0, R0 + 0.35, r)) * 0.4 * n2 + (1.0 - smoothstep(0.0, 0.6, r)) * exp(-age * 2.0) * 0.8) * exp(-age / 2.4) * smoothstep(0.15, 0.7, n) * str;
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(uFoam, min(a, 0.82));
#include <fog_fragment>
}`,
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
  const wakeMesh = new THREE.Mesh(wGeo, wakeMat); wakeMesh.name = 'ships-wakes'; wakeMesh.frustumCulled = false; wakeMesh.userData.noAO = true; wakeMesh.castShadow = wakeMesh.receiveShadow = false;
  group.add(wakeMesh);
  let nv = 0, ni = 0;
  const vert = (x, z, a, d, age, k, b = 0) => { if (nv >= WV) return -1; const i = nv * 3, j = nv * 4; wPos[i] = x; wPos[i + 1] = WY; wPos[i + 2] = z; wAtt[j] = a; wAtt[j + 1] = d; wAtt[j + 2] = age; wAtt[j + 3] = k; wB[nv] = b; return nv++; };
  const quad = (a, b, c, d) => { if (a < 0 || b < 0 || c < 0 || d < 0 || ni + 6 > WI) return; wIdx[ni++] = a; wIdx[ni++] = b; wIdx[ni++] = c; wIdx[ni++] = b; wIdx[ni++] = d; wIdx[ni++] = c; };

  // ---------- update ----------
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), S = { x: 0, z: 0, h: 0, v: 0, f: 1 }, ST = { sw: 0, tip: 0, fe: 0 };
  const events = { stroke: 0, oar: 0, luff: 0 }, SIDES = [-1, 1], hands = [new THREE.Vector3(), new THREE.Vector3()];
  const ease = k => k * k * (3 - 2 * k), wrap = a => a - TAU * Math.round(a / TAU), crossed = (p0, p1, x) => (p0 < x ? p1 >= x || p1 < p0 : p1 < p0 && p1 >= x);
  // one stroke, phase p ∈ [0, 1): catch, drive, release (feathering), recovery, squaring up. sw: +1 blade forward .. -1 aft
  function stroke(p, deep, high) {
    if (p < 0.06) { ST.sw = 1; ST.tip = lerp(high - 0.08, deep, ease(p / 0.06)); ST.fe = 0; }
    else if (p < 0.46) { ST.sw = 1 - 2 * ease((p - 0.06) / 0.4); ST.tip = deep; ST.fe = 0; }
    else if (p < 0.56) { const k = ease((p - 0.46) / 0.1); ST.sw = -1; ST.tip = lerp(deep, high, k); ST.fe = k; }
    else if (p < 0.92) { const k = (p - 0.56) / 0.36; ST.sw = -1 + 2 * ease(k); ST.tip = high + 0.08 * Math.sin(k * Math.PI); ST.fe = 1; }
    else { const k = ease((p - 0.92) / 0.08); ST.sw = 1; ST.tip = high - 0.08 * k; ST.fe = 1 - k; }
    return ST;
  }
  // an oar about its thole: sweep psi (+ towards the bow), the blade tip at height tip (craft frame), fe 0 square .. 1 feathered
  function oar(c, o, psi, tip, fe) {
    const sb = clamp((o.py - tip) / o.Lo, -0.3, 0.97), cb = Math.sqrt(1 - sb * sb), dx = Math.sin(psi) * cb, dy = -sb, dz = o.sd * Math.cos(psi) * cb;
    let yx = sb * dx, yy = 1 - sb * sb, yz = sb * dz; const yl = Math.hypot(yx, yy, yz); yx /= yl; yy /= yl; yz /= yl;   // "up" square to the loom
    const zx = dy * yz - dz * yy, zy = dz * yx - dx * yz, zz = dx * yy - dy * yx, cf = Math.cos(fe * Math.PI / 2), sf = Math.sin(fe * Math.PI / 2);
    const Yx = cf * yx + sf * zx, Yy = cf * yy + sf * zy, Yz = cf * yz + sf * zz, Zx = dy * Yz - dz * Yy, Zy = dz * Yx - dx * Yz, Zz = dx * Yy - dy * Yx;
    const e = _m2.elements; e[0] = dx; e[1] = dy; e[2] = dz; e[3] = 0; e[4] = Yx; e[5] = Yy; e[6] = Yz; e[7] = 0; e[8] = Zx; e[9] = Zy; e[10] = Zz; e[11] = 0; e[12] = o.px; e[13] = o.py; e[14] = o.pz; e[15] = 1;
    _m.multiplyMatrices(c.m, _m2); put(o.bone, _m); return _m;
  }
  function arm(bones, sx, sy, sz, hx, hy, hz, px, py, pz) {   // two-bone arm from shoulder to hand, the elbow out towards the pole
    let dx = hx - sx, dy = hy - sy, dz = hz - sz; const d = Math.hypot(dx, dy, dz) || 1e-4, Lr = UA + FA; dx /= d; dy /= d; dz /= d;
    let ex, ey, ez;
    if (d >= Lr * 0.999) { ex = sx + dx * d * UA / Lr; ey = sy + dy * d * UA / Lr; ez = sz + dz * d * UA / Lr; }
    else {
      const a = (UA * UA - FA * FA + d * d) / (2 * d), h = Math.sqrt(Math.max(0, UA * UA - a * a)), pd = px * dx + py * dy + pz * dz;
      let qx = px - pd * dx, qy = py - pd * dy, qz = pz - pd * dz; const ql = Math.hypot(qx, qy, qz) || 1;
      ex = sx + dx * a + qx / ql * h; ey = sy + dy * a + qy / ql * h; ez = sz + dz * a + qz / ql * h;
    }
    putLine(bones[0], sx, sy, sz, ex, ey, ez, UA); putLine(bones[1], ex, ey, ez, hx, hy, hz, FA);
  }
  const emit = (type, c, data) => { events[type] = (events[type] || 0) + 1; ctx.emit(type, c.x, SEA + 1, c.z, data); };

  function move(c, dt) {
    const r = c.r, h0 = c.h;
    if (c.wait > 0) { c.wait -= dt; c.v = Math.max(0, c.v - c.dec * dt); c.vt = 0; if (c.wait <= 0) { c.wait = 0; c.s = (c.s + 0.35) % r.L; } }
    else {
      sample(r, c.s, S); let target = S.v * c.vk * c.give, d = Infinity, st = null;
      for (const q of r.stops) { let dd = q.s - c.s; if (dd < 0) dd += r.L; if (dd < d) { d = dd; st = q; } }
      if (st) { target = Math.min(target, Math.max(0.2, Math.sqrt(2 * c.dec * d))); if (d < 0.3) { c.wait = st.dur; c.s = st.s; } }
      c.v += clamp(target - c.v, -c.dec * dt, c.acc * dt); c.vt = target;
      if (c.wait <= 0) c.s = (c.s + c.v * c.surge * dt) % r.L;
    }
    sample(r, c.s, S); c.x = S.x; c.z = S.z; c.h = S.h; c.sail = S.f;
    c.yawRate = dt > 0 ? wrap(c.h - h0) / dt : 0;
  }
  // give way to any craft with the right of way (a strict order, so no two ever wait on each other): slow for one lying just ahead,
  // and when the other's track, on both courses and speeds, would pass within a hull's length of ours inside 45 s: stop short, unless
  // where we would come to rest still lies on that track, in which case pull hard across it instead
  function giveWay(c, dt) {
    c.give = 1; c.giveT = Math.max(0, c.giveT - dt); if (c.giveT > 0) { c.give = c.giveK; return; }
    const fx = Math.cos(c.h), fz = -Math.sin(c.h), vx = fx * c.v, vz = fz * c.v;
    for (let i = 0; i < crafts.length; i++) {
      const o = crafts[i]; if (o === c || o.prio < c.prio) continue;
      const px = o.x - c.x, pz = o.z - c.z; if (px * px + pz * pz > 300 * 300) continue;
      const room = (c.len + o.len) / 2 + 6, ahead = px * fx + pz * fz, lat = Math.abs(px * fz - pz * fx);
      if (ahead > 0 && ahead < room + 44 && lat < c.beam / 2 + o.len / 2 + 9) c.give = Math.min(c.give, clamp((ahead - room) / 40, 0, 1));
      const rx = Math.cos(o.h) * o.v - vx, rz = -Math.sin(o.h) * o.v - vz, r2 = rx * rx + rz * rz, ts = r2 > 1e-4 ? clamp(-(px * rx + pz * rz) / r2, 0, 45) : 0;
      if (ahead > -room * 0.5 && Math.hypot(px + rx * ts, pz + rz * ts) < room) {
        const bd = c.v * c.v / (2 * c.dec), qx = px - fx * bd, qz = pz - fz * bd, ox = Math.cos(o.h) * o.v, oz = -Math.sin(o.h) * o.v, o2 = ox * ox + oz * oz;
        const t0 = o2 > 1e-4 ? clamp(-(qx * ox + qz * oz) / o2, 0, 60) : 0, stopClear = Math.hypot(qx + ox * t0, qz + oz * t0) >= room;
        c.giveK = c.give = stopClear ? 0 : 1.4; c.giveT = stopClear ? 5 : 10; return;
      }
    }
  }
  function pose(c, t) {
    const e = shelter(c.x, c.z) * c.sw, ch = Math.cos(c.h), sh = Math.sin(c.h), hl = c.len * 0.38, hb = c.beam * 0.5;
    const fb = swell(c.x + ch * hl, c.z - sh * hl, t), fa = swell(c.x - ch * hl, c.z + sh * hl, t), fp = swell(c.x - sh * hb, c.z - ch * hb, t), fs = swell(c.x + sh * hb, c.z + ch * hb, t);
    c.heave = e * (fa + fb + fp + fs) * 0.25;
    c.pitch = e * Math.atan2(fb - fa, 2 * hl) * 0.8 + c.pitchX;
    c.roll = e * (Math.atan2(fp - fs, 2 * hb) * 0.55 + c.rollA * Math.sin(t * TAU / c.rollT + c.sp)) + c.heel + clamp(c.v * c.yawRate * 0.08, -0.05, 0.05);
    _e.set(c.roll, c.h, c.pitch); _q.setFromEuler(_e); _p.set(c.x, SEA - c.y0 + c.heave, c.z); c.m.compose(_p, _q, _one);
    put(c.bone, c.m);
  }
  function rowTrireme(c, dt, t) {
    const T = clamp(6.0 / Math.max(c.v, 0.6), 1.7, 2.6), want = c.wait > 0 ? 0 : clamp((c.vt - 0.25) / 0.8, 0, 1);
    c.row = clamp(c.row + clamp(want - c.row, -dt * 0.6, dt * 0.8), 0, 1);
    if (c.row > 0.01) {
      const p0 = c.ph; c.ph = (c.ph + dt / T) % 1;
      if (c.row > 0.4 && crossed(p0, c.ph, 0.03)) emit('stroke', c, { ship: c.id, oars: c.oars.length, period: T });
      if (c.row > 0.4 && crossed(p0, c.ph, 0.47)) for (let si = 0; si < 2; si++) {   // puddles left along each bank as the blades come out
        _a.set(c.bank[0] - 1.3, 0, SIDES[si] * 4.5).applyMatrix4(c.m); _b.set(c.bank[1] - 1.3, 0, SIDES[si] * 4.5).applyMatrix4(c.m);
        puddle(c, _a.x, _a.z, _b.x, _b.z, t, 31, 0.8, 0.75 * c.row);
      }
    }
    c.surge = 1 + 0.12 * c.row * Math.sin(TAU * (c.ph - 0.08));
    c.pitchX = 0.004 * c.row * Math.sin(TAU * (c.ph - 0.15));
  }
  function oarsTrireme(c) {
    for (const o of c.oars) { stroke((c.ph + o.j + 1) % 1, -0.4, 0.62); oar(c, o, 0.05 + 0.5 * ST.sw * c.row, lerp(0.8, ST.tip, c.row), lerp(1, ST.fe, c.row)); }
    _v.copy(c.ens.local).applyMatrix4(c.m); _m2.makeRotationY(Math.atan2(-wind.dz, wind.dx) + 0.15 * Math.sin(c.ph * TAU)).setPosition(_v); put(c.ens.bone, _m2);
  }
  function sailMerchant(c, dt, t) {
    const ch = Math.cos(c.h), sh = Math.sin(c.h), wx = wind.dx * ch - wind.dz * sh, wz = wind.dx * sh + wind.dz * ch, al = Math.atan2(wz, wx), g = clamp(wind.gust(c.x, c.z, t), 0.3, 1.7);
    c.brace += (-clamp(0.62 * al, -1.15, 1.15) - c.brace) * Math.min(1, dt * 0.4);
    const fill = Math.max(0, Math.cos(al + c.brace)), want = Math.abs(al) > 2.0 ? Math.min(c.sail ?? 1, 0.16) : (c.sail ?? 1);   // no square sail draws close to the wind
    c.reef = clamp(c.reef + clamp(want - c.reef, -dt * 0.12, dt * 0.12), 0.14, 1);
    c.bellyS += (1.75 * c.sc * fill * (0.55 + 0.45 * g) - c.bellyS) * Math.min(1, dt * 1.5);
    c.luffS += (clamp(1.25 - fill * g * 1.1, 0, 1) - c.luffS) * Math.min(1, dt * 2);
    c.vk = 0.62 + 0.38 * fill * Math.min(g, 1.3) * (0.4 + 0.6 * c.reef);
    c.heel += (0.085 * wz * g * fill * c.reef - c.heel) * Math.min(1, dt * 0.6);
    if (!c.luffing && c.luffS > 0.5 && c.reef > 0.5) { c.luffing = true; emit('luff', c, { ship: c.id, strength: +c.luffS.toFixed(2) }); } else if (c.luffing && c.luffS < 0.3) c.luffing = false;
    const y = c.yard;
    clothA[y.slot].set(c.bellyS, c.luffS, c.reef, 0); clothB[y.slot].w = g;
    clothA[c.pen.slot].y = c.luffS; clothB[c.pen.slot].w = g;
  }
  function rigMerchant(c, t) {
    const y = c.yard, sc = c.sc;
    _m2.makeRotationY(c.brace).setPosition(y.mastX, y.yardY, 0); _m.multiplyMatrices(c.m, _m2); put(y.bone, _m);
    for (let si = 0; si < 2; si++) {   // braces from the yardarms aft, sheets from the clews to the quarters
      const sd = SIDES[si];
      _a.set(0.28, 0, sd * (y.W / 2 + 0.15)).applyMatrix4(_m); _b.set(-8.2 * sc, c.topAft + 0.2, sd * 1.3 * sc).applyMatrix4(c.m); putLine(c.lines[sd > 0 ? 0 : 1], _a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
      _a.set(0.4, -0.18 - y.H * c.reef, sd * y.W / 2).applyMatrix4(_m); _b.set(-3.0 * sc, c.topMid + 0.45, sd * 2.55 * sc).applyMatrix4(c.m); putLine(c.lines[sd > 0 ? 2 : 3], _a.x, _a.y, _a.z, _b.x, _b.y, _b.z);
    }
    _v.set(y.mastX, y.mastTop + 0.12, 0).applyMatrix4(c.m); _m2.makeRotationY(Math.atan2(-wind.dz, wind.dx) + 0.12 * Math.sin(t * 0.7 + c.sp)).setPosition(_v); put(c.pen.bone, _m2);
  }
  function rowBoat(c, dt, t) {
    const T = 2.5, want = c.wait > 0 ? 0 : clamp((c.vt - 0.2) / 0.5, 0, 1);
    c.row = clamp(c.row + clamp(want - c.row, -dt * 0.7, dt * 0.9), 0, 1);
    if (c.row > 0.01) {
      const p0 = c.ph; c.ph = (c.ph + dt / T) % 1;
      if (c.row > 0.4 && crossed(p0, c.ph, 0.03)) emit('oar', c, { ship: c.id, oars: 2 });
      if (c.row > 0.4 && crossed(p0, c.ph, 0.47)) for (let si = 0; si < 2; si++) { _a.set(c.oars[0].px - 0.9, 0, SIDES[si] * 2.4).applyMatrix4(c.m); _b.set(c.oars[0].px - 0.9 + 0.01, 0, SIDES[si] * 2.4).applyMatrix4(c.m); puddle(c, _a.x, _a.z, _b.x, _b.z, t, 1, 0.7, 0.5 * c.row); }
    }
    c.surge = 1 + 0.25 * c.row * Math.sin(TAU * (c.ph - 0.1));
    c.pitchX = 0.01 * c.row * Math.sin(TAU * (c.ph - 0.2));
  }
  function crewBoat(c) {
    stroke(c.ph, 0.0, 0.5); const sw = ST.sw * c.row, rw = c.rower;
    for (let k = 0; k < 2; k++) { const o = c.oars[k], m = oar(c, o, 0.05 + 0.55 * sw, lerp(0.62, ST.tip, c.row), lerp(0.3, ST.fe * 0.6, c.row)); hands[k].set(-o.Li + 0.04, 0, 0).applyMatrix4(m); }
    _e.set(0, Math.PI, -0.07 - 0.35 * sw); _q.setFromEuler(_e); _m2.compose(rw.hip, _q, _one); _m.multiplyMatrices(c.m, _m2); put(rw.torso, _m);
    const ch = Math.cos(c.h), sh = Math.sin(c.h);
    for (let k = 0; k < 2; k++) {   // his right hand (the figure's +z, turned to port) holds the port oar
      _a.set(0.02, 0.47, k ? -0.19 : 0.19).applyMatrix4(_m); const H = hands[k], sd = k ? 1 : -1;
      arm(rw.arms[k], _a.x, _a.y, _a.z, H.x, H.y, H.z, sh * sd * 0.5 + ch * 0.4, -0.8, ch * sd * 0.5 - sh * 0.4);
    }
  }
  function drift(c, t) {
    const [ax, az, h] = c.anchor;
    c.x = ax + 1.6 * Math.sin(t * 0.031 + c.sp); c.z = az + 1.2 * Math.sin(t * 0.023 + c.sp * 2); const h1 = h + 0.22 * Math.sin(t * 0.041 + c.sp);
    c.v = 0.05; c.yawRate = 0; c.h = h1;
    _m2.makeRotationY(h).setPosition(ax, SEA + 0.02 + 0.3 * shelter(ax, az) * swell(ax, az + 12, t), az); put(c.floats, _m2);
  }
  function haul(c, t) {
    const hl = c.hauler, p = (t / 1.7 + c.sp) % 1, lean = -0.32 - 0.14 * Math.sin(TAU * p);
    _e.set(0, -Math.PI / 2, lean); _q.setFromEuler(_e); _m2.compose(hl.hip, _q, _one); _m.multiplyMatrices(c.m, _m2); put(hl.torso, _m);
    let mx = 0, my = 0, mz = 0;
    for (let k = 0; k < 2; k++) {   // hand over hand: reach out low over the gunwale, draw in to the chest
      const q = (p + k * 0.5) % 1, out = q < 0.5 ? ease(q * 2) : 1 - ease((q - 0.5) * 2), lx = 0.1 + (k ? 0.14 : -0.14);
      _b.set(lx, lerp(1.1, 0.72, out), lerp(0.55, 0.92, out)).applyMatrix4(c.m); mx += _b.x / 2; my += _b.y / 2; mz += _b.z / 2;
      _a.set(0.02, 0.47, k ? -0.19 : 0.19).applyMatrix4(_m);
      const sh = Math.sin(c.h), ch = Math.cos(c.h), side = k ? 1 : -1;
      arm(hl.arms[k], _a.x, _a.y, _a.z, _b.x, _b.y, _b.z, ch * side * 0.5 - sh * 0.5, -0.7, -sh * side * 0.5 - ch * 0.5);
    }
    _a.set(0.1, 0.1, 1.9).applyMatrix4(c.m); putLine(hl.line, mx, my, mz, _a.x, SEA + 0.02, _a.z);
  }
  function wakeOf(c, t, far) {
    const W = c.wk; if (!W) return;
    _v.set(c.sternX, 0, 0).applyMatrix4(c.m); const sx = _v.x, sz = _v.z;
    if (c.v > 0.15 && (W.n === 0 || Math.hypot(sx - W.X[W.head], sz - W.Z[W.head]) > W.gap)) { W.head = (W.head + 1) % W.K; W.X[W.head] = sx; W.Z[W.head] = sz; W.T[W.head] = t; W.V[W.head] = c.v; W.n = Math.min(W.n + 1, W.K); }
    if (far) return;
    // the strip: the stern now, then the samples, newest first
    let pL = -1, pR = -1, px = sx, pz = sz, dxp = Math.cos(c.h), dzp = -Math.sin(c.h);
    for (let k = -1; k < W.n; k++) {
      let x = sx, z = sz, age = 0, v0 = c.v;
      if (k >= 0) { const i = (W.head - k + W.K) % W.K; x = W.X[i]; z = W.Z[i]; age = t - W.T[i]; v0 = W.V[i]; if (age > W.life) break; }
      if (k >= 0) { const ddx = px - x, ddz = pz - z, l = Math.hypot(ddx, ddz); if (l > 0.01) { dxp = ddx / l; dzp = ddz / l; } }
      const w = W.w0 + Math.min(0.3 * v0 * age, 30), str = Math.min(1, v0 / c.vref) * W.k * (k < 0 ? 0.6 : 1) * 0.999;
      const L_ = vert(x - dzp * w, z + dxp * w, -w, w, age, str, W.w0), R_ = vert(x + dzp * w, z - dxp * w, w, w, age, str, W.w0);
      if (pL >= 0) quad(pL, pR, L_, R_); pL = L_; pR = R_; px = x; pz = z;
    }
    // white water along the hull
    const fs = Math.min(1, c.v / c.vref) * 0.999; if (fs < 0.03) return;
    for (let si = 0; si < 2; si++) {
      const sd = SIDES[si]; let a0 = -1, b0 = -1;
      for (let fi = 0; fi < c.foam.length; fi++) {
        const lx = c.foam[fi][0], hw = c.foam[fi][1];
        _v.set(lx, 0, sd * (hw - 0.15)).applyMatrix4(c.m); _w.set(lx - 0.25, 0, sd * (hw + 1.1)).applyMatrix4(c.m);
        const a = vert(_v.x, _v.z, -0.15, c.len * 0.5 - lx, 0, 1 + fs), b = vert(_w.x, _w.z, 1.1, c.len * 0.5 - lx, 0, 1 + fs);
        if (a0 >= 0) quad(a0, b0, a, b); a0 = a; b0 = b;
      }
    }
  }
  // a small ring of puddle records per craft, reused
  function puddle(c, ax, az, bx, bz, t, n, hw, str) { const p = c.puddles[c.pi = (c.pi + 1) % c.puddles.length]; p.ax = ax; p.az = az; p.bx = bx; p.bz = bz; p.t0 = t; p.n = n; p.hw = hw; p.str = str; }
  function puddlesOf(c, t) {
    for (let i = 0; i < c.puddles.length; i++) {
      const p = c.puddles[i], age = t - p.t0; if (age > 7 || age < 0) continue;
      let dx = p.bx - p.ax, dz = p.bz - p.az; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const ex = p.n > 1 ? 0 : 0.5, x0 = p.ax - dx * ex, z0 = p.az - dz * ex, x1 = p.bx + dx * ex, z1 = p.bz + dz * ex, k = 2 + p.str * 0.999;
      quad(vert(x0 - dz * p.hw, z0 + dx * p.hw, -1, 0, age, k), vert(x0 + dz * p.hw, z0 - dx * p.hw, 1, 0, age, k), vert(x1 - dz * p.hw, z1 + dx * p.hw, -1, p.n, age, k), vert(x1 + dz * p.hw, z1 - dx * p.hw, 1, p.n, age, k));
    }
  }

  let tScale = 1, simT = 0, ms = 0, msMax = 0, frames = 0, follow = null;
  function update(dt, t, camera) {
    const tA = performance.now();
    dt = Math.min(dt, 0.1) * tScale; simT += dt; const T = simT;
    for (const c of crafts) {
      if (c.kind === 'net') { drift(c, T); c.heel = 0; }
      else { giveWay(c, dt); move(c, dt); }
      if (c.kind === 'trireme') rowTrireme(c, dt, T);
      else if (c.kind === 'merchant') sailMerchant(c, dt, T);
      else if (c.kind === 'boat') rowBoat(c, dt, T);
      pose(c, T);
      if (c.kind === 'trireme') oarsTrireme(c);
      else if (c.kind === 'merchant') rigMerchant(c, T);
      else if (c.kind === 'boat') crewBoat(c);
      else haul(c, T);
    }
    clothU.uTime.value = T; wakeMat.uniforms.uTime.value = T;
    nv = 0; ni = 0;
    const cx = camera ? camera.position.x : 0, cz = camera ? camera.position.z : 0;
    for (const c of crafts) { const far = Math.hypot(c.x - cx, c.z - cz) > 2200; wakeOf(c, T, far); if (c.puddles && !far) puddlesOf(c, T); }
    wGeo.setDrawRange(0, ni);
    const pa = wGeo.attributes.position, aa = wGeo.attributes.aW, ia = wGeo.index;
    pa.clearUpdateRanges(); pa.addUpdateRange(0, nv * 3); pa.needsUpdate = true; aa.clearUpdateRanges(); aa.addUpdateRange(0, nv * 4); aa.needsUpdate = true; const ba = wGeo.attributes.aB; ba.clearUpdateRanges(); ba.addUpdateRange(0, nv); ba.needsUpdate = true; ia.clearUpdateRanges(); ia.addUpdateRange(0, ni); ia.needsUpdate = true;
    if (skel.boneTexture) skel.boneTexture.needsUpdate = true;
    if (follow) frame(...follow);
    const d = performance.now() - tA; if (frames++ > 10) { ms = ms * 0.97 + d * 0.03; msMax = Math.max(msMax * 0.999, d); }
  }
  update(0, 0, ctx.camera);

  const find = id => crafts.find(c => c.id === id);
  function frame(id, dist = 40, h = 8, side = 90, pitch = -8) {   // the camera dist m off the craft, side degrees round from its bow, h above the sea
    const c = find(id); if (!c || typeof window === 'undefined' || !window.__setView) return;
    const a = c.h + side * Math.PI / 180, fx = Math.cos(a), fz = -Math.sin(a), px = c.x + fx * dist, pz = c.z + fz * dist;
    window.__setView(px, SEA + h, pz, Math.atan2(fx, fz) * 180 / Math.PI, pitch);
  }
  const tris = (rig.ni + cloth.I.length) / 3;
  console.log(`[ships] ${crafts.length} craft, ${NB} bones, ${Math.round(tris / 1000)}k tris, built in ${Math.round(performance.now() - t0)} ms`);
  return {
    group, update,
    debug: () => ({
      crafts: crafts.map(c => ({ id: c.id, x: Math.round(c.x), z: Math.round(c.z), s: c.r ? Math.round(c.s) : null, L: c.r ? Math.round(c.r.L) : null, v: +c.v.toFixed(2), wait: +Math.max(0, c.wait).toFixed(1), give: +c.give.toFixed(2), row: c.row !== undefined ? +c.row.toFixed(2) : null, reef: c.reef !== undefined ? +c.reef.toFixed(2) : null, heelDeg: +(c.heel * 57.3).toFixed(1) })),
      bones: NB, tris, wakeVerts: nv, updateMs: +ms.toFixed(3), updateMsMax: +msMax.toFixed(3), events,
    }),
    // tests and screenshots: put a craft at arc length s (or waypoint i), freeze or speed up the fleet, frame a craft from the camera
    seek(id, s) { const c = find(id); if (c && c.r) { c.s = ((s % c.r.L) + c.r.L) % c.r.L; c.wait = 0; c.v = sample(c.r, c.s, S).v; if (c.wk) c.wk.n = 0; if (c.puddles) for (const p of c.puddles) p.t0 = -99; } },
    waypoint(id, i, ahead = 0) { const c = find(id); if (c && c.r) this.seek(id, c.r.wS[i] + ahead); },
    timeScale(k) { tScale = k; },
    where(id) { const c = find(id); return c && { x: c.x, z: c.z, h: c.h, y: SEA + c.heave }; },
    look: (...a) => frame(...a),
    follow(...a) { follow = a.length && a[0] ? a : null; if (follow) frame(...follow); },
    routes: () => checkRoutes(),
  };
}
