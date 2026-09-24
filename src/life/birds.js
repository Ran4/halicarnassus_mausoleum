// Birds over and in the town: swallows hawking fast and erratic over the roofs, the temenos and the agora; yellow-legged
// gulls soaring on the wind over the harbour, riding the swell in the basin and standing on the moles and the quay edge;
// rock doves and house sparrows walking and pecking on the pavements (and pigeons on roof ridges and the stoa eaves) that
// burst up when someone comes at them and settle again a few dozen metres off; kestrels hanging over the slopes and two
// short-toed eagles circling high over the ridges.
//
// One InstancedMesh draws them all: its geometry holds a low-poly model of every species (body, head, tail, two-segment
// wings, legs) and an instance keeps only its own species' vertices (the others collapse to a point). The pose — flap,
// swept glide, wings folded along the back, walking legs, the pigeon's head-bob and peck, a fanned tail — is computed per
// vertex from per-instance attributes, in the lit and the shadow-depth pass alike. CPU side: steering for the swallows and
// the soaring gulls and eagles, flights between two spots for everything that takes off and lands (a course clear of what
// stands in the way — read off depth renders of the town — flown at the bird's own rates of climb, sink and braking), a walk /
// peck / look-round loop on the ground; birds far from the camera think less often.
//
// Events (ctx.emit): 'flutter' {n, species} a flock (or one bird) takes off · 'gull' {flying} a gull calls ·
// 'coo' {n} pigeons near the camera · 'chirp' {n} sparrows near the camera · 'swallow' {n} swallows screaming past close by.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp, lerp, TAU } from '../util.js';
import { terrainHeight, inTerrace, SEA, flats } from '../terrain.js';

const SW = 0, SP = 1, PG = 2, GU = 3, RP = 4;   // barn swallow, house sparrow, rock dove, yellow-legged gull, raptor (kestrel / eagle)
const SPN = ['swallow', 'sparrow', 'pigeon', 'gull', 'raptor'];
const ST = { GROUND: 0, WATER: 1, PERCH: 2, FLIGHT: 3, SOAR: 4, HAWK: 5, HOVER: 6 };
const A = { IDLE: 0, WALK: 1, PECK: 2, HOP: 3, CALL: 4 };
const NB = 400;
// per species: height of the shoulder line over the feet, flee distance, cull distance, extra size far away, bounding radius
const STAND = [0.03, 0.054, 0.103, 0.176, 0.09], FLEE = [0, 3.2, 4.5, 6.5, 0], CULL = [380, 170, 330, 1300, 3500], BOOST = [1.3, 0.5, 0.45, 1.1, 1.0], RAD = [0.2, 0.15, 0.35, 0.75, 0.45];
// per species, for the flights that take off and land: the steepest the course climbs and sinks, the fastest climb and sink (m/s),
// speed off the jump (m/s), acceleration and braking (m/s²), touch-down speed (m/s)
const GUP = [0.9, 0.9, 0.9, 0.4, 0.9], GDN = [0.7, 0.7, 0.6, 0.45, 0.6], VUP = [3.0, 3.0, 3.0, 2.2, 3.0], VDN = [3.5, 3.5, 3.5, 3.5, 3.5];
const V0 = [1.8, 1.8, 2.0, 1.5, 2.0], ACC = [6, 6, 4.5, 3.5, 4.5], DEC = [3.5, 3.5, 3.0, 2.2, 3.0], VTD = [1.0, 1.0, 1.2, 1.5, 1.2];
const FK = 24, FK1 = FK + 1;   // stations along a flight's course

// ---------- geometry (+Z forward, +X the left wing, origin between the shoulders) ----------
const C = h => new THREE.Color(h);   // sRGB hex → linear
function mkGeo(P, Cc, I) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setIndex(I); return g; }
// a body of elliptic rings [z, halfWidth, halfHeight, yCentre] (zero-size first and last rings close it); paint(x, y, z, up)
function loft(rings, segs, paint) {
  const P = [], Cc = [], I = [];
  for (const [z, hw, hh, yc] of rings) for (let j = 0; j < segs; j++) { const a = j / segs * TAU, x = Math.cos(a) * hw, y = yc + Math.sin(a) * hh, c = paint(x, y, z, Math.sin(a)); P.push(x, y, z); Cc.push(c.r, c.g, c.b); }
  for (let k = 0; k < rings.length - 1; k++) for (let j = 0; j < segs; j++) { const a = k * segs + j, b = k * segs + (j + 1) % segs; I.push(a, b, a + segs, b, b + segs, a + segs); }
  return mkGeo(P, Cc, I);
}
// a thin cambered plate, upper and under surface: stations [s, a, b] along the span with the chord running from a (leading) to b;
// map(s, c) → [x, z]; fr: chord fractions (close pairs make crisp colour bars); paint(station, fraction, top)
function plate(st, fr, map, th, paint) {
  const P = [], Cc = [], I = [], nf = fr.length;
  for (const top of [1, 0]) {
    const o = P.length / 3;
    st.forEach(([s, a, b], k) => { for (const f of fr) { const [x, z] = map(s, lerp(a, b, f)), cam = (f < 0.3 ? f / 0.3 : (1 - f) / 0.7) * th * (1 - 0.7 * k / (st.length - 1)), c = paint(k, f, top); P.push(x, top ? cam : -cam * 0.3, z); Cc.push(c.r, c.g, c.b); } });
    for (let k = 0; k < st.length - 1; k++) for (let q = 0; q < nf - 1; q++) {
      const a = o + k * nf + q;
      for (const [u, v, w] of [[a, a + 1, a + nf], [a + 1, a + nf + 1, a + nf]]) {
        const cy = (P[v * 3 + 2] - P[u * 3 + 2]) * (P[w * 3] - P[u * 3]) - (P[v * 3] - P[u * 3]) * (P[w * 3 + 2] - P[u * 3 + 2]);
        if ((cy >= 0) === !!top) I.push(u, v, w); else I.push(u, w, v);
      }
    }
  }
  return mkGeo(P, Cc, I);
}
function mirrorX(g) {
  const c = g.clone(), p = c.attributes.position, ix = c.index.array;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  return c;
}
function flat(g, col) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }

function birdGeometry() {
  const parts = [];
  // aJ = (species·8 + part, pivot a, pivot b, tint weight); parts: 0 body, 1 head (+neck, beak), 2 tail, 3 arm, 4 hand, 5 leg
  const put = (g, s, part, a = 0, b = 0, tw = 1) => {
    if (g.attributes.uv) g.deleteAttribute('uv'); if (g.attributes.normal) g.deleteAttribute('normal'); g.computeVertexNormals();
    const n = g.attributes.position.count, j = new Float32Array(n * 4); for (let i = 0; i < n; i++) j.set([s * 8 + part, a, b, tw], i * 4);
    g.setAttribute('aJ', new THREE.BufferAttribute(j, 4)); parts.push(g);
  };
  const wings = (s, sh, wr, inner, outer, frI, frO, th, pI, pO) => { for (const [stn, fr, part, paint] of [[inner, frI, 3, pI], [outer, frO, 4, pO]]) { const g = plate(stn, fr, (u, c) => [u, c], th, paint); put(g, s, part, sh, wr); put(mirrorX(g), s, part, sh, wr); } };
  const tailP = (s, stn, fr, th, paint, base, len, both = false) => { const g = plate(stn, fr, (u, c) => [c, u], th, paint); put(g, s, 2, base, len); if (both) put(mirrorX(g), s, 2, base, len); };
  const legs = (s, hx, hy, hz, len, w, col, toe) => {
    for (const sx of [-1, 1]) {
      put(flat(new THREE.BoxGeometry(w, len, w).translate(sx * hx, hy - len / 2, hz), col), s, 5, hy, hz, 0);
      put(flat(new THREE.BoxGeometry(toe[0], w * 0.45, toe[1]).translate(sx * hx, hy - len + w * 0.22, hz + toe[1] * 0.3), col), s, 5, hy, hz, 0);
    }
  };
  const FR3 = [0, 0.3, 1], FR2 = [0, 1];

  // barn swallow: glossy blue-black above, cream below, a rufous throat and forehead, long tail streamers, no legs worth drawing
  {
    const dark = C(0x121a2b), ruf = C(0x8e3b22), cream = C(0xe3d8c6), under = C(0x8c8474), dim = C(0x2a2f3a), beak = C(0x121212);
    put(loft([[-0.058, 0, 0, 0.002], [-0.05, 0.007, 0.006, 0.002], [-0.03, 0.014, 0.013, 0], [-0.005, 0.018, 0.017, -0.002], [0.02, 0.017, 0.016, -0.001], [0.036, 0.013, 0.013, 0.002], [0.046, 0, 0, 0.004]], 6,
      (x, y, z, up) => up > -0.2 ? dark : z > 0.026 ? ruf : cream), SW, 0);
    put(loft([[0.028, 0, 0, 0.003], [0.034, 0.011, 0.011, 0.003], [0.048, 0.013, 0.012, 0.004], [0.06, 0.01, 0.009, 0.003], [0.066, 0.005, 0.004, 0.001], [0.074, 0, 0, 0]], 6,
      (x, y, z, up) => z > 0.063 ? beak : up > 0.3 ? (z > 0.055 ? ruf : dark) : up > -0.3 ? dark : ruf), SW, 1, 0.003, 0.034);
    tailP(SW, [[-0.04, 0, 0.011], [-0.07, 0.004, 0.018], [-0.1, 0.012, 0.025], [-0.128, 0.026, 0.029]], FR2, 0.002, (k, f, top) => top ? dark : dim, -0.04, 0.09, true);
    wings(SW, 0.01, 0.055, [[0.01, 0.014, -0.022], [0.055, 0.016, -0.028]], [[0.055, 0.016, -0.028], [0.1, 0.006, -0.03], [0.14, -0.012, -0.036], [0.168, -0.042, -0.05]], FR3, FR3, 0.004,
      (k, f, top) => top ? dark : under, (k, f, top) => top ? dark : k > 1 ? dim : under);
  }
  // house sparrow (a cock): brown back, grey crown, chestnut nape, white cheek, black bib, a white wing bar
  {
    const brown = C(0x7a5634), dark = C(0x4a3622), belly = C(0xb3a894), crown = C(0x78787b), chest = C(0x8b4a26), bib = C(0x1c1a18), cheek = C(0xd6d0c4), bar = C(0xdcd8cc), under = C(0x9a9084), beak = C(0x3a3530);
    put(loft([[-0.052, 0, 0, 0.004], [-0.045, 0.009, 0.008, 0.004], [-0.025, 0.021, 0.02, 0], [0, 0.026, 0.026, -0.004], [0.02, 0.024, 0.024, -0.002], [0.032, 0.017, 0.018, 0.004], [0.038, 0, 0, 0.006]], 7,
      (x, y, z, up) => up > 0.1 ? brown : z > 0.018 ? bib : belly), SP, 0);
    put(loft([[0.018, 0, 0, 0.01], [0.024, 0.013, 0.013, 0.012], [0.036, 0.016, 0.016, 0.016], [0.05, 0.013, 0.013, 0.016], [0.056, 0.008, 0.007, 0.013], [0.061, 0.006, 0.005, 0.011], [0.07, 0, 0, 0.009]], 7,
      (x, y, z, up) => z > 0.057 ? beak : up > 0.45 ? crown : up < -0.45 ? bib : z > 0.03 ? cheek : chest), SP, 1, 0.008, 0.026);
    tailP(SP, [[-0.045, 0.011, -0.011], [-0.075, 0.016, -0.016], [-0.105, 0.019, -0.019]], FR2, 0.002, () => dark, -0.045, 0.06);
    wings(SP, 0.014, 0.05, [[0.014, 0.022, -0.024], [0.05, 0.024, -0.028]], [[0.05, 0.024, -0.028], [0.085, 0.015, -0.03], [0.112, -0.012, -0.03]], [0, 0.32, 0.36, 0.42, 0.46, 1], FR3, 0.005,
      (k, f, top) => top ? (f > 0.34 && f < 0.44 ? bar : brown) : under, (k, f, top) => top ? dark : under);
    legs(SP, 0.011, -0.018, 0, 0.036, 0.004, C(0x8a6a58), [0.012, 0.018]);
  }
  // rock dove (the wild type): blue-grey, two black bars on the arm, dark primaries and tail band, an iridescent neck, red legs
  {
    const back = C(0x6e7888), cov = C(0x7c8797), head = C(0x5a6272), green = C(0x3f5e54), purple = C(0x5a4a70), belly = C(0x687282), rump = C(0x98a0ac), tailc = C(0x5e6674),
      band = C(0x222428), bar = C(0x1a1b1e), prim = C(0x3c4048), under = C(0xadb3bc), beak = C(0x2a2828), cere = C(0xd0d0d0);
    put(loft([[-0.125, 0, 0, 0.008], [-0.115, 0.012, 0.01, 0.008], [-0.09, 0.032, 0.03, 0.003], [-0.05, 0.052, 0.05, -0.008], [-0.005, 0.062, 0.06, -0.014], [0.04, 0.058, 0.058, -0.01], [0.072, 0.04, 0.042, 0.004], [0.092, 0, 0, 0.02]], 8,
      (x, y, z, up) => z > 0.045 ? (up > -0.2 ? green : purple) : up > 0 ? (z < -0.07 ? rump : back) : belly), PG, 0);
    put(loft([[0.045, 0, 0, 0.018], [0.055, 0.031, 0.033, 0.022], [0.08, 0.027, 0.029, 0.036], [0.1, 0.021, 0.022, 0.052], [0.122, 0.02, 0.021, 0.058], [0.137, 0.013, 0.013, 0.056], [0.144, 0.006, 0.005, 0.052], [0.16, 0, 0, 0.048]], 8,
      (x, y, z, up) => z > 0.141 ? beak : z > 0.136 ? cere : z < 0.092 ? (up > -0.2 ? green : purple) : head), PG, 1, 0.018, 0.058);
    tailP(PG, [[-0.1, 0.03, -0.03], [-0.15, 0.04, -0.04], [-0.188, 0.046, -0.046], [-0.19, 0.046, -0.046], [-0.215, 0.044, -0.044]], FR2, 0.003, k => k >= 3 ? band : tailc, -0.1, 0.11);
    wings(PG, 0.035, 0.14, [[0.035, 0.05, -0.06], [0.14, 0.045, -0.075]], [[0.14, 0.045, -0.075], [0.22, 0.035, -0.072], [0.29, 0.01, -0.055], [0.325, -0.025, -0.04]],
      [0, 0.45, 0.5, 0.58, 0.63, 0.72, 0.77, 0.85, 1], FR3, 0.012,
      (k, f, top) => top ? ((f > 0.52 && f < 0.6) || (f > 0.74 && f < 0.82) ? bar : cov) : under, (k, f, top) => top ? (k >= 1 ? prim : cov) : k >= 2 ? prim : under);
    legs(PG, 0.02, -0.04, -0.005, 0.062, 0.007, C(0xb2463e), [0.02, 0.03]);
  }
  // yellow-legged gull: white, a mid-grey mantle, black wing tips, a yellow bill with a red spot, yellow legs
  {
    const white = C(0xeeeeea), grey = C(0x7f8a96), black = C(0x18191c), bill = C(0xd8b43a), red = C(0xc03020), shade = C(0xd4d6d6);
    put(loft([[-0.2, 0, 0, 0.01], [-0.18, 0.025, 0.02, 0.01], [-0.13, 0.055, 0.05, 0.003], [-0.06, 0.078, 0.076, -0.012], [0.02, 0.083, 0.082, -0.018], [0.09, 0.07, 0.072, -0.008], [0.13, 0.045, 0.05, 0.012], [0.15, 0, 0, 0.03]], 8,
      (x, y, z, up) => up > 0.55 && z > -0.13 && z < 0.07 ? grey : up < -0.3 ? shade : white), GU, 0);
    put(loft([[0.09, 0, 0, 0.03], [0.1, 0.042, 0.045, 0.04], [0.14, 0.038, 0.04, 0.06], [0.18, 0.04, 0.042, 0.075], [0.212, 0.034, 0.034, 0.078], [0.232, 0.018, 0.018, 0.072], [0.265, 0.012, 0.016, 0.068], [0.29, 0.008, 0.013, 0.064], [0.305, 0, 0, 0.066]], 8,
      (x, y, z, up) => z > 0.23 ? (z > 0.26 && z < 0.295 && up < -0.3 ? red : bill) : white), GU, 1, 0.02, 0.1);
    tailP(GU, [[-0.17, 0.05, -0.05], [-0.24, 0.065, -0.065], [-0.29, 0.068, -0.068]], FR2, 0.004, () => white, -0.17, 0.12);
    wings(GU, 0.07, 0.3, [[0.07, 0.09, -0.12], [0.3, 0.085, -0.14]], [[0.3, 0.085, -0.14], [0.44, 0.06, -0.11], [0.52, 0.04, -0.095], [0.52, 0.04, -0.095], [0.6, 0.015, -0.08], [0.66, -0.02, -0.074], [0.705, -0.07, -0.08]],
      [0, 0.3, 0.85, 0.9, 1], [0, 0.3, 1], 0.02,
      (k, f, top) => top ? (f > 0.87 ? white : grey) : white, (k, f, top) => k >= 3 ? (k === 5 && top ? white : black) : top ? grey : white);
    legs(GU, 0.035, -0.06, -0.005, 0.116, 0.011, C(0xd6b848), [0.045, 0.05]);
  }
  // kestrel (a tiercel: rufous back, grey head and tail with a black band, dark primaries); the eagles use it too, larger and tinted
  {
    const ruf = C(0xa35d2d), prim = C(0x2c241e), head = C(0x707882), buff = C(0xd8bc90), tailc = C(0x7d848c), band = C(0x1c1a18), tip = C(0xd8d0c0), under = C(0xd8ccb4), cere = C(0xd0b040), beak = C(0x3a4048);
    put(loft([[-0.1, 0, 0, 0.006], [-0.09, 0.014, 0.012, 0.006], [-0.06, 0.033, 0.032, 0], [-0.02, 0.046, 0.045, -0.008], [0.03, 0.044, 0.044, -0.006], [0.06, 0.032, 0.034, 0.006], [0.075, 0, 0, 0.012]], 8,
      (x, y, z, up) => up > 0 ? ruf : buff), RP, 0);
    put(loft([[0.045, 0, 0, 0.015], [0.055, 0.026, 0.027, 0.02], [0.08, 0.029, 0.029, 0.028], [0.103, 0.024, 0.024, 0.03], [0.116, 0.014, 0.014, 0.026], [0.128, 0.008, 0.01, 0.02], [0.136, 0, 0, 0.012]], 8,
      (x, y, z, up) => z > 0.118 ? beak : z > 0.112 ? cere : up < -0.4 ? buff : head), RP, 1, 0.012, 0.05);
    tailP(RP, [[-0.085, 0.022, -0.022], [-0.16, 0.028, -0.028], [-0.214, 0.032, -0.032], [-0.215, 0.032, -0.032], [-0.234, 0.033, -0.033], [-0.235, 0.033, -0.033], [-0.246, 0.031, -0.031]], FR2, 0.003,
      k => k === 3 || k === 4 ? band : k >= 5 ? tip : tailc, -0.085, 0.16);
    wings(RP, 0.03, 0.16, [[0.03, 0.05, -0.05], [0.16, 0.045, -0.07]], [[0.16, 0.045, -0.07], [0.25, 0.03, -0.065], [0.33, 0, -0.045], [0.375, -0.035, -0.04]], FR3, FR3, 0.01,
      (k, f, top) => top ? ruf : under, (k, f, top) => top ? (k >= 1 ? prim : ruf) : k >= 2 ? prim : under);
    legs(RP, 0.02, -0.035, 0, 0.055, 0.007, C(0xd8b848), [0.02, 0.028]);
  }
  const g = mergeGeometries(parts, false);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return g;
}

// ---------- the pose, in the vertex shader (shared by the lit and the shadow-depth material) ----------
// iPos (x, y, z, yaw) · iOri (pitch nose-up, bank right-wing-down, scale, species + variant) · iWing (flap phase, amplitude, sweep,
// fold) · iPose (head pitch down, head yaw, head forward, leg phase) · iMisc (legs out, tail fanned, leg swing, dihedral)
const GLSL = /* glsl */`
attribute vec4 aJ; attribute vec4 iPos; attribute vec4 iOri; attribute vec4 iWing; attribute vec4 iPose; attribute vec4 iMisc;
// per species: half-width of the body (where a folded wing lies), hip height and z (a standing bird tips about its hips),
// how far the hand droops below the arm in a glide (a gull's crooked wing)
const vec4 BSP[5] = vec4[5](vec4(0.017, 0.0, 0.0, 0.0), vec4(0.025, -0.018, 0.0, 0.0), vec4(0.06, -0.04, -0.005, 0.05), vec4(0.082, -0.06, -0.005, 0.3), vec4(0.046, -0.035, 0.0, 0.08));
// how far past square the folded wings sweep, so their tips meet over the rump
const float BFC[5] = float[5](0.16, 0.37, 0.3, 0.19, 0.23);
vec3 bRX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 bRY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 bRZ(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
vec3 bTint() {
  float s = floor(iOri.w + 0.001), v = fract(iOri.w + 0.001);
  // pigeons: most the wild blue-grey, some darker chequers, a few pale or brownish dovecote birds
  if (s == 2.0) return v < 0.52 ? vec3(1.0) : v < 0.72 ? vec3(0.72, 0.72, 0.76) : v < 0.85 ? vec3(0.5, 0.48, 0.5) : v < 0.94 ? vec3(1.22, 1.08, 0.94) : vec3(1.5, 1.45, 1.4);
  if (s == 4.0 && v > 0.5) return vec3(0.8, 0.74, 0.7);   // the eagles: browner than a kestrel
  return vec3(0.9 + 0.2 * v);
}
bool bPose(inout vec3 p, inout vec3 n) {
  float sp = floor(aJ.x / 8.0 + 0.01), part = aJ.x - sp * 8.0;
  if (abs(sp - floor(iOri.w + 0.001)) > 0.5) return false;
  vec4 K = BSP[int(sp)];
  float amp = iWing.y, sweep = iWing.z, fold = iWing.w, of = 1.0 - fold;
  if (part > 2.5 && part < 4.5) {
    float sx = p.x < 0.0 ? -1.0 : 1.0; vec3 q = vec3(p.x * sx, p.y, p.z), m = vec3(n.x * sx, n.y, n.z);
    float sh = aJ.y, wr = aJ.z;
    // the arm beats about the shoulder; the hand lags it, and in a glide droops a little (a gull's) and sweeps back further
    float a1 = (iMisc.w + amp * sin(iWing.x)) * of, a2 = (-K.w * (1.0 - smoothstep(0.0, 0.25, amp)) + amp * 0.55 * sin(iWing.x - 0.9)) * of;
    if (part > 3.5) { vec3 W = vec3(wr, 0.0, 0.0); q = W + bRY(bRZ(q - W, a2), sweep * of); m = bRY(bRZ(m, a2), sweep * of); }
    // folded: the span shortened, the wing turned on edge (upper side out) and laid back along the flank, the tips over the tail
    vec3 S = vec3(sh, 0.0, 0.0);
    q = S + (q - S) * vec3(mix(1.0, 0.56, fold), 1.0, mix(1.0, 0.56, fold));
    float sw = sweep * 0.35 * of + (1.5708 + BFC[int(sp)]) * fold;
    q = S + bRZ(bRY(bRX(q - S, 1.45 * fold), sw), a1); m = bRZ(bRY(bRX(m, 1.45 * fold), sw), a1);
    q.x += fold * (K.x - sh); q.y += fold * K.x * 0.15;
    p = vec3(q.x * sx, q.y, q.z); n = vec3(m.x * sx, m.y, m.z);
  } else if (part > 0.5 && part < 1.5) {
    vec3 N = vec3(0.0, aJ.y, aJ.z);
    p = N + bRY(bRX(p - N, iPose.x), iPose.y) + vec3(0.0, 0.0, iPose.z); n = bRY(bRX(n, iPose.x), iPose.y);
  } else if (part > 1.5 && part < 2.5) {
    p.x *= 1.0 + iMisc.y * clamp((aJ.y - p.z) / aJ.z, 0.0, 1.0);   // the tail fans out
  } else if (part > 4.5) {
    // legs: tucked back in flight; standing, they swing with the step and stay upright however the body tips
    float a = (1.0 - iMisc.x) * 1.35 + iMisc.x * (iMisc.z * sin(iPose.w + (p.x < 0.0 ? 3.1416 : 0.0)) + iOri.x);
    vec3 H = vec3(p.x, aJ.y, aJ.z); p = H + bRX(p - H, a) * smoothstep(0.0, 0.4, iMisc.x); n = bRX(n, a);   // (drawn up into the belly feathers)
  }
  vec3 PV = vec3(0.0, K.y, K.z) * iMisc.x;
  p = PV + bRX(p - PV, -iOri.x); n = bRX(n, -iOri.x);
  p = bRZ(p, iOri.y); n = bRZ(n, iOri.y);
  p = bRY(p * iOri.z, iPos.w) + iPos.xyz; n = bRY(n, iPos.w);
  return true;
}
`;
function patchMaterial(m, kind) {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL);
    if (kind === 'depth') shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); vec3 bN = vec3(0.0, 1.0, 0.0); if (!bPose(transformed, bN)) transformed = vec3(0.0);');
    else shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 bP = vec3(position); if (!bPose(bP, objectNormal)) bP = vec3(0.0);')
      .replace('#include <begin_vertex>', 'vec3 transformed = bP;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb *= mix(vec3(1.0), bTint(), aJ.w);');
  };
  m.customProgramCacheKey = () => 'birds-' + kind;
  return m;
}

// ---------- what stands where: depth renders of the finished scene from straight above and below ----------
// Over each cell of a grid (x0, z0 its corner, nx × nz cells of `cell` m, rendered at 1 m): the highest solid surface within a
// metre of it (roofs, stalls, statues, trunks; the ground or the sea where nothing stands), and the top and the underside of any
// foliage there (tree crowns, vines, nets: whatever is cut out of cards). Opaque meshes only (no sky, clouds, smoke, people,
// nothing that moves); null where float render targets cannot be read back.
function heightsFromAbove(renderer, scene, x0, z0, nx, nz, cell, skip) {
  if (!renderer || !scene || !renderer.extensions.has('EXT_color_buffer_float')) return null;
  const W = nx * cell, D = nz * cell, SOLID = 30, LEAF = 31, far = 700, out = new Set(), marked = [];
  for (const g of skip) if (g) g.traverse(o => out.add(o));
  scene.traverseVisible(o => {
    if (!o.isMesh || out.has(o) || o.userData.noAO) return;
    const ms = (Array.isArray(o.material) ? o.material : [o.material]).filter(m => m && !m.transparent && m.side !== THREE.BackSide && !m.isShaderMaterial);
    if (!ms.length) return;
    const l = ms.some(m => m.alphaTest > 0) ? LEAF : SOLID; o.layers.enable(l); marked.push([o, l]);
  });
  const rt = new THREE.WebGLRenderTarget(W, D, { type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const mat = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });   // (red: 1 − depth, linear under an orthographic camera)
  const cam = new THREE.OrthographicCamera(-W / 2, W / 2, D / 2, -D / 2, 1, far), px = new Float32Array(W * D * 4);
  const res = { solid: new Float32Array(nx * nz), leafTop: new Float32Array(nx * nz), leafBot: new Float32Array(nx * nz) };
  // one layer seen from height y0, looking down (dir 1) or up (dir −1), each cell the highest (lowest) thing within a metre
  const pass = (layer, y0, dir, into) => {
    cam.position.set(x0 + W / 2, y0, z0 + D / 2); cam.up.set(0, 0, -dir); cam.lookAt(x0 + W / 2, y0 - dir, z0 + D / 2); cam.updateMatrixWorld(); cam.layers.set(layer);
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam); renderer.readRenderTargetPixels(rt, 0, 0, W, D, px);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      let h = dir > 0 ? -1e9 : 1e9;
      for (let z = Math.max(0, j * cell - 1); z <= Math.min(D - 1, j * cell + cell); z++) {
        const r = dir > 0 ? D - 1 - z : z;   // (the camera's up is −z looking down, +z looking up: the read-back's rows run accordingly)
        for (let x = Math.max(0, i * cell - 1); x <= Math.min(W - 1, i * cell + cell); x++) { const v = y0 - dir * (1 + (1 - px[(r * W + x) * 4]) * (far - 1)); h = dir > 0 ? Math.max(h, v) : Math.min(h, v); }
      }
      into[j * nx + i] = h;
    }
  };
  const was = { rt: renderer.getRenderTarget(), over: scene.overrideMaterial, bg: scene.background, col: renderer.getClearColor(new THREE.Color()), a: renderer.getClearAlpha() };
  let ok = true;
  try {
    scene.overrideMaterial = mat; scene.background = null; renderer.setClearColor(0x000000, 0);
    pass(SOLID, 600, 1, res.solid); pass(LEAF, 600, 1, res.leafTop); pass(LEAF, -200, -1, res.leafBot);
  } catch (e) { console.warn('[birds] no heights:', e); ok = false; }
  finally {
    scene.overrideMaterial = was.over; scene.background = was.bg; renderer.setRenderTarget(was.rt); renderer.setClearColor(was.col, was.a);
    for (const [o, l] of marked) o.layers.disable(l);
    rt.dispose(); mat.dispose();
  }
  return ok ? res : null;
}

export async function build(ctx) {
  const { world, layout } = ctx, people = ctx.people && ctx.people.listen ? ctx.people : null;
  const wind = ctx.wind || { dx: 0.93, dz: 0.36, speed: 4.5, gust: () => 1 }, emit = ctx.emit || (() => {});
  const R = rng(5150), perf = performance, tBuild = perf.now();
  const AGL = flats[2].level, UPWIND = Math.atan2(-wind.dx, -wind.dz);   // the yaw that faces into the wind
  const wrap = a => a - Math.round(a / TAU) * TAU;

  // ---------- the flight floor: how low a bird may fly over each 6 m cell ----------
  // 1.3 m over open ground, 14 m over anything with a collider near it (houses, stoas, walls, stalls, statues, trees), 52 m over
  // the tomb, 16 m over the sea (masts) except the inner basin, which the swallows skim; `deep` cells lie 12 m clear of anything
  // built: only there is a swallow sent down to the ground
  const GX = -520, GZ = -200, CS = 6, NX = 174, NZ = 140;
  const gFloor = new Float32Array(NX * NZ), gGround = new Float32Array(NX * NZ), deep = new Uint8Array(NX * NZ);
  {
    const built = new Uint8Array(NX * NZ), b2 = new Uint8Array(NX * NZ);
    for (const c of world.colliders) {
      const i0 = Math.max(0, Math.floor((c.minX - GX) / CS)), i1 = Math.min(NX - 1, Math.floor((c.maxX - GX) / CS)), j0 = Math.max(0, Math.floor((c.minZ - GZ) / CS)), j1 = Math.min(NZ - 1, Math.floor((c.maxZ - GZ) / CS));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) built[j * NX + i] = 1;
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) if (built[j * NX + i]) for (let a = Math.max(0, j - 1); a <= Math.min(NZ - 1, j + 1); a++) for (let b = Math.max(0, i - 1); b <= Math.min(NX - 1, i + 1); b++) b2[a * NX + b] = 1;
    const basin = (x, z) => z > 500 && z < 592 && Math.abs(x) < 205;
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i, x = GX + (i + 0.5) * CS, z = GZ + (j + 0.5) * CS, g = inTerrace(x, z) ? 0 : terrainHeight(x, z), wet = g < SEA - 0.5;
      gGround[k] = Math.max(g, SEA);
      gFloor[k] = Math.abs(x) < 27 && Math.abs(z) < 24 ? 52 : wet ? (basin(x, z) ? SEA + 0.8 : SEA + 16) : b2[k] ? g + 14 : g + 1.3;
    }
    for (let j = 2; j < NZ - 2; j++) for (let i = 2; i < NX - 2; i++) {
      const k = j * NX + i; if (gFloor[k] - gGround[k] > 2) continue;
      let ok = true; for (let a = j - 2; a <= j + 2 && ok; a++) for (let b = i - 2; b <= i + 2; b++) if (gFloor[a * NX + b] - gGround[a * NX + b] > 2) { ok = false; break; }
      deep[k] = ok ? 1 : 0;
    }
  }
  const cellOf = (x, z) => { const i = Math.floor((x - GX) / CS), j = Math.floor((z - GZ) / CS); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : j * NX + i; };
  const floorAt = (x, z) => { const k = cellOf(x, z); return k < 0 ? Math.max(terrainHeight(x, z), SEA) + 16 : gFloor[k]; };

  // ---------- what the take-off-and-land flights must clear, over each 2 m cell ----------
  // the solid tops, and tree crowns (heightsFromAbove); without them, the flight floor
  const TC = 2, TNX = NX * CS / TC, TNZ = NZ * CS / TC;
  const hm = heightsFromAbove(ctx.renderer, ctx.scene, GX, GZ, TNX, TNZ, TC, [ctx.people && ctx.people.group]);
  const cellT = (x, z) => { const i = Math.floor((x - GX) / TC), j = Math.floor((z - GZ) / TC); return i < 0 || j < 0 || i >= TNX || j >= TNZ ? -1 : j * TNX + i; };
  const solidAt = (x, z) => { const k = cellT(x, z); return k < 0 ? Math.max(terrainHeight(x, z), SEA) : hm ? Math.max(hm.solid[k], SEA) : floorAt(x, z) - 1.2; };
  // the crown over (x, z), if there is one above the solid top: [its top, its underside]
  const crownAt = (x, z) => { const k = cellT(x, z); return k >= 0 && hm && hm.leafTop[k] > Math.max(hm.solid[k], SEA) ? [hm.leafTop[k], hm.leafBot[k]] : null; };
  // what a bird flying at about height y over (x, z) has to clear: a crown too, unless it can pass under it
  const topAt = (x, z, y = Infinity) => { const s = solidAt(x, z), c = crownAt(x, z); return c && c[1] - 0.6 < y ? Math.max(s, c[0]) : s; };

  // ---------- where birds may come down: the paved squares (and, for sparrows, yards and gardens) ----------
  const NPG = ['temenos', 'agora', 'platea', 'quay', 'civic square', 'market lane', 'sanctuary of Apollo: court before the temple', 'sanctuary of Apollo: west court', 'prytaneion court', 'palaestra court'];
  const NSP = [...NPG, 'yard', 'garden', 'work yard', 'sanctuary of Apollo: laurel grove', 'gymnasium grove'];
  const inCore = a => Math.abs(a.minX + a.maxX) < 900 && a.minZ > -160 && a.maxZ < 470;
  const zonesPG = layout.areas.filter(a => NPG.includes(a.name) && a.y !== undefined && a.maxX - a.minX > 3 && a.maxZ - a.minZ > 3);
  const zonesSP = layout.areas.filter(a => NSP.includes(a.name) && a.maxX - a.minX > 2.5 && a.maxZ - a.minZ > 2.5 && inCore(a));
  const zoneAt = (zs, x, z) => { for (const a of zs) if (x > a.minX + 0.6 && x < a.maxX - 0.6 && z > a.minZ + 0.6 && z < a.maxZ - 0.6) return a; return null; };
  // ground at (x, z) if a bird may stand there: nothing solid within `c`, level, and at the zone's own height (not on a step or a bench)
  const okSpot = (x, z, y0, tol = 0.25, c = 0.4) => {
    if (world.blocked(x, z) || world.blocked(x + c, z) || world.blocked(x - c, z) || world.blocked(x, z + c) || world.blocked(x, z - c)) return NaN;
    const g = world.groundHeight(x, z);
    if (y0 !== undefined && y0 !== null && Math.abs(g - y0) > tol) return NaN;
    if (Math.abs(world.groundHeight(x + 0.35, z) - g) > 0.06 || Math.abs(world.groundHeight(x, z + 0.35) - g) > 0.06) return NaN;
    return g;
  };
  function findSpot(s, x, z, rad) {
    const zs = s === SP ? zonesSP : zonesPG;
    for (let q = 0; q < 80; q++) {
      const a = R() * TAU, d = q ? Math.sqrt(R()) * rad : 0, X = x + Math.sin(a) * d, Z = z + Math.cos(a) * d, zn = zoneAt(zs, X, Z); if (!zn) continue;
      const y = okSpot(X, Z, zn.y); if (!Number.isNaN(y)) return { x: X, z: Z, y, zone: zn };
    }
    return null;
  }

  // ---------- per-bird state ----------
  const F = () => new Float32Array(NB);
  const sp = new Uint8Array(NB), st = new Uint8Array(NB), act = new Uint8Array(NB), nxt = new Uint8Array(NB), fl = new Int16Array(NB).fill(-1), perchK = new Int16Array(NB).fill(-1);
  const px = F(), py = F(), pz = F(), vx = F(), vy = F(), vz = F(), yaw = F(), pit = F(), pitT = F(), bnk = F(), scl = F(), vari = F(), wary = F();
  const ph = F(), om = F(), amp = F(), ampT = F(), swp = F(), swpT = F(), fold = F(), foldT = F(), dih = F(), dihT = F(), tail = F(), tailT = F(), legO = F(), legOT = F(), legP = F(), legA = F();
  const hp = F(), hpT = F(), hy = F(), hyT = F(), bob = F(), bobT = F();
  const tA = F(), tB = F(), tC = F(), tD = F(), gx = F(), gy = F(), gz = F(), gg = F(), spd = F(), hdg = F(), trn = F(), trnT = F(), jx = F(), jy = F(), jz = F(), callT = F(), lastT = F(), cnt = F();
  // flights: the course over the ground (a cubic in x, z), distance along it and height at each station; length, distance flown,
  // delay, speed over the ground, time aloft, cruising speed, the station just passed
  const bz = new Float32Array(NB * 8), fS = new Float32Array(NB * FK1), fY = new Float32Array(NB * FK1);
  const fT = F(), fU = F(), fD = F(), fV = F(), fE = F(), fC = F(), fK = new Uint8Array(NB);
  let n = 0;
  function add(s, state, x, y, z, yw) {
    if (n >= NB) return -1;
    const i = n++; sp[i] = s; st[i] = state; px[i] = x; py[i] = y; pz[i] = z; yaw[i] = hdg[i] = yw; vari[i] = R(); wary[i] = 0.8 + R() * 0.45;
    scl[i] = 0.92 + R() * 0.16; ph[i] = R() * TAU; om[i] = TAU * 8;
    const sits = state <= ST.PERCH; fold[i] = foldT[i] = sits ? 1 : 0; legO[i] = legOT[i] = state === ST.GROUND || state === ST.PERCH ? 1 : 0;
    tA[i] = R() * 3; tD[i] = 30 + R() * 90; callT[i] = 0; lastT[i] = -1;
    return i;
  }

  // ---------- perches: gable ridges near the squares, the eaves of the agora's stoas ----------
  // a site: a line (x, z) + t·(dx, dz), t ∈ [0, len], at height y; the birds sit across it facing yawA or yawB (yawB null: one way only)
  const sites = [];
  const addSite = (x, z, dx, dz, len, y, yawA, yawB) => { const ns = Math.max(2, Math.floor(len / 0.42)); sites.push({ x, z, dx, dz, len, y, yawA, yawB, occ: new Int16Array(ns).fill(-1), step: len / (ns - 1) }); };
  {
    const eave = AGL + 5.2 + 1.57 + 0.09;   // city.js stoa(): colonnade 5.2 m, entablature, the roof slab's front edge
    for (let x = -96; x < 96; x += 24) addSite(x, 384.55, 1, 0, 16, eave, 0, null);            // north stoa, looking south over the agora
    for (let z = 384; z < 432; z += 24) { addSite(-112.35, z, 0, 1, 16, eave, Math.PI / 2, null); addSite(112.35, z, 0, 1, 16, eave, -Math.PI / 2, null); }
    const near = [[70, 70], [-70, 75], [0, 120], [95, 345], [-95, 345], [60, 470 - 120], [150, 20], [-150, 20], [-190, 70], [200, 110]];
    const used = new Set();
    for (const [cx, cz] of near) {
      const hs = layout.houses.filter(h => h.gable && !used.has(h) && Math.hypot(h.x - cx, h.z - cz) < 45 && Math.max(h.w, h.d) > 6).sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz)).slice(0, 2);
      for (const h of hs) {
        used.add(h);
        const ax = h.w >= h.d, along = Math.max(h.w, h.d), across = Math.min(h.w, h.d), y = h.y + h.h + (across / 2 + 0.45) * 0.3 + 0.12, len = along - 1.4;
        const r = ax ? 0 : Math.PI / 2;   // ridge along x: face north or south; along z: east or west
        addSite(h.x - (ax ? len / 2 : 0), h.z - (ax ? 0 : len / 2), ax ? 1 : 0, ax ? 0 : 1, len, y, r, r + Math.PI);
      }
    }
  }
  function claimSite(site, k, need) {   // up to `need` free slots spread along the site
    const out = [], ns = site.occ.length; let free = 0; for (let q = 0; q < ns; q++) if (site.occ[q] < 0) free++;
    if (free < need) return null;
    let q = Math.floor(R() * ns);
    for (let tries = 0; out.length < need && tries < ns * 3; tries++) { if (site.occ[q] < 0 && !out.includes(q) && !out.includes(q - 1) && !out.includes(q + 1)) out.push(q); q = (q + 1 + Math.floor(R() * 2)) % ns; }
    for (let t = 0; out.length < need && t < ns; t++) if (site.occ[t] < 0 && !out.includes(t)) out.push(t);
    return out.length === need ? out : null;
  }
  const slotXZ = (site, q) => [site.x + site.dx * q * site.step, site.z + site.dz * q * site.step];

  // ---------- ground flocks (pigeons, sparrows) ----------
  const flocks = [];
  function spotNear(f, x, z, r) {
    for (let q = 0; q < 14; q++) {
      const a = R() * TAU, d = Math.sqrt(R()) * r, X = x + Math.sin(a) * d, Z = z + Math.cos(a) * d, y = okSpot(X, Z, f.gy, 0.2, 0.3);
      if (!Number.isNaN(y)) return [X, y, Z];
    }
    return [x, f.gy, z];
  }
  function makeFlock(s, x, z, count, r, roofy) {
    const home = findSpot(s, x, z, 14); if (!home) return;
    const f = { id: flocks.length, s, m: [], cx: home.x, cz: home.z, gy: home.y, r, hx: home.x, hz: home.z, hy: home.y, state: 'ground', t: 50 + R() * 200, landed: 0, listenT: R(), roofy, site: null, slots: null };
    for (let q = 0; q < count; q++) { const [X, Y, Z] = spotNear(f, f.cx, f.cz, r); const i = add(s, ST.GROUND, X, Y + STAND[s], Z, R() * TAU); if (i < 0) break; fl[i] = f.id; f.m.push(i); gg[i] = Y; }
    flocks.push(f); return f;
  }
  function makePerched(site, count) {   // pigeons that start on a roof
    const slots = claimSite(site, sites.indexOf(site), count); if (!slots) return;
    const f = { id: flocks.length, s: PG, m: [], cx: site.x, cz: site.z, gy: site.y, r: 3, hx: 0, hz: 0, hy: 0, state: 'perch', t: 40 + R() * 150, landed: 0, listenT: 0, roofy: 0.7, site, slots };
    const home = findSpot(PG, site.x, site.z, 60); if (home) { f.hx = home.x; f.hz = home.z; f.hy = home.y; } else { f.hx = 0; f.hz = 62; f.hy = 0; }
    for (const q of slots) {
      const [X, Z] = slotXZ(site, q), yw = site.yawB === null || R() < 0.5 ? site.yawA : site.yawB, i = add(PG, ST.PERCH, X, site.y + STAND[PG], Z, yw); if (i < 0) break;
      site.occ[q] = i; perchK[i] = q; fl[i] = f.id; f.m.push(i); gx[i] = yw; gg[i] = site.y;
    }
    flocks.push(f);
  }
  // [x, z, birds, spread, chance to roost on a roof when they move]
  for (const [x, z, c, r, roofy] of [[80, 0, 14, 3.2, 0.25], [-80, 8, 11, 3, 0.2], [12, -38, 8, 2.6, 0.2], [40, 427, 12, 3, 0.35], [-12, 423, 10, 2.8, 0.3], [-72, 408, 8, 2.4, 0.3],
    [0, 61, 10, 3, 0.3], [-160, 64, 7, 2.5, 0.35], [205, 64, 7, 2.5, 0.35], [-60, 444.8, 8, 2.4, 0.25], [70, 444.8, 7, 2.4, 0.25], [-215, 42, 7, 2.5, 0.3]]) makeFlock(PG, x, z, c, r, roofy);
  for (const [x, z, c] of [[100, 409, 7], [-42, 396, 7], [-74, 401, 6], [-137, 69, 6], [72, 68, 6], [168, 392, 7], [-188, 22, 6], [62, -30, 6], [-30, 64, 6]]) makeFlock(SP, x, z, c, 1.6, 0);
  for (const k of [0, 2, 5, 8, 9]) if (sites[k]) makePerched(sites[k], 4 + Math.floor(R() * 4));
  { const rs = sites.slice(11); for (let q = 0; q < 5 && rs.length; q++) makePerched(rs.splice(Math.floor(R() * rs.length), 1)[0], 3 + Math.floor(R() * 4)); }

  // ---------- gulls: standing on the quay edge and the moles, afloat in the basin, soaring over the harbour ----------
  const stands = [];   // {x, y, z, i}
  {
    const seats = layout.pois.filter(p => p.type === 'seat' && Math.abs(p.z - 449.25) < 0.6);
    for (let x = -232; x <= 232; x += 2.9) { const X = x + (R() - 0.5), Z = 448.9 + R() * 0.35; if (seats.some(p => Math.abs(p.x - X) < 1.6)) continue; const y = okSpot(X, Z, AGL, 0.35, 0.2); if (!Number.isNaN(y)) stands.push({ x: X, y, z: Z, i: -1 }); }
    for (const a of layout.areas) if (a.name === 'mole') for (let q = 0; q < 2; q++) { const X = lerp(a.minX + 0.6, a.maxX - 0.6, R()), Z = lerp(a.minZ + 0.6, a.maxZ - 0.6, R()), y = okSpot(X, Z, a.y, 0.3, 0.3); if (!Number.isNaN(y)) stands.push({ x: X, y, z: Z, i: -1 }); }
  }
  const GZONE = { x0: -270, x1: 270, z0: 405, z1: 680 };   // (the basin, the moles, the quay and the water just outside)
  const gullAlt = () => AGL + 12 + R() * 26;                  // 12–38 m over the quay
  const water = () => {
    for (let q = 0; q < 30; q++) {
      const inner = R() < 0.7, x = inner ? (R() - 0.5) * 380 : (R() - 0.5) * 760, z = inner ? 505 + R() * 82 : 640 + R() * 120;
      if (terrainHeight(x, z) > SEA - 1) continue;
      let ok = true; for (let i = 0; i < n && ok; i++) if (st[i] === ST.WATER && (px[i] - x) ** 2 + (pz[i] - z) ** 2 < 9) ok = false;
      if (ok) return [x, z];
    }
    return [0, 560];
  };
  function standGull(i, s) { s.i = i; perchK[i] = stands.indexOf(s); gg[i] = s.y; }
  const gullIdx = [];
  for (let q = 0; q < 12 && stands.length; q++) { const s = stands[Math.floor(R() * stands.length)]; if (s.i >= 0) continue; const i = add(GU, ST.GROUND, s.x, s.y + STAND[GU], s.z, UPWIND + (R() - 0.5) * 1.2); standGull(i, s); tD[i] = 60 + R() * 200; gullIdx.push(i); }
  for (let q = 0; q < 10; q++) { const [x, z] = water(); const i = add(GU, ST.WATER, x, SEA + 0.045, z, UPWIND + (R() - 0.5)); tA[i] = 40 + R() * 200; gullIdx.push(i); }
  function startSoar(i, alt) {
    st[i] = ST.SOAR; act[i] = 0; spd[i] = sp[i] === GU ? 8.5 + R() * 2.5 : 11 + R() * 2.5; hdg[i] = yaw[i];
    const r = sp[i] === GU ? 16 + R() * 30 : 60 + R() * 50; trnT[i] = trn[i] = (R() < 0.5 ? -1 : 1) * spd[i] / r;
    gy[i] = alt; tA[i] = 10 + R() * 30; tB[i] = 2 + R() * 8; tC[i] = 0; tD[i] = 30 + R() * 60; foldT[i] = 0; legOT[i] = 0; ampT[i] = 0; tailT[i] = 0.2;
  }
  for (let q = 0; q < 22; q++) {
    const x = lerp(GZONE.x0 + 30, GZONE.x1 - 30, R()), z = lerp(GZONE.z0 + 20, R() < 0.65 ? 540 : GZONE.z1 - 20, R()), y = Math.max(floorAt(x, z) + 6, gullAlt());
    const i = add(GU, ST.SOAR, x, y, z, R() * TAU); startSoar(i, y); gullIdx.push(i);
  }
  // ---------- swallows: loose flocks hawking over one part of the town each ----------
  const hawks = [[10, -5, 70, 14], [0, 405, 70, 12], [125, 170, 90, 10], [-140, 180, 90, 10], [0, 280, 90, 10], [0, 510, 90, 10]].map(([x, z, r, c]) => ({ hx: x, hz: z, r, c, cx: x, cz: z, t: 0, near: false }));
  hawks.forEach((h, k) => { for (let q = 0; q < h.c; q++) {
    const x = h.cx + (R() - 0.5) * h.r, z = h.cz + (R() - 0.5) * h.r, y = floorAt(x, z) + 4 + R() * 20, a = R() * TAU, s0 = 12 + R() * 3;
    const i = add(SW, ST.HAWK, x, y, z, a); fl[i] = k; vx[i] = Math.sin(a) * s0; vz[i] = Math.cos(a) * s0; spd[i] = 12 + R() * 3.5; gx[i] = x; gy[i] = y; gz[i] = z; tA[i] = 0;
  } });
  // ---------- raptors: kestrels hovering over open slopes, two eagles circling over the ridges ----------
  let eagle0 = -1, mate = -1;
  const EZONE = [{ x0: -480, x1: 380, z0: -780, z1: -380 }];   // the ridge north of the town, behind the theatre and the Temple of Ares
  {
    const cand = [[-300, -300], [-380, -180], [260, -330], [-200, -470], [430, -220], [-460, 120], [470, 180], [-120, -560]];
    let k = 0;
    for (const [x, z] of cand) {
      if (k >= 2) break;
      let open = true; for (let a = -24; a <= 24 && open; a += 8) for (let b = -24; b <= 24; b += 8) if (world.blocked(x + a, z + b)) { open = false; break; }
      if (!open) continue;
      const y = terrainHeight(x, z) + 14 + R() * 5, i = add(RP, ST.HOVER, x, y, z, UPWIND); scl[i] = 0.95 + R() * 0.1; vari[i] = R() * 0.45;
      gx[i] = x; gy[i] = y; gz[i] = z; cnt[i] = x; jz[i] = z; act[i] = 0; tA[i] = 4 + R() * 8; k++;
    }
    for (let e = 0; e < 2; e++) {   // a pair: the second keeps company with the first
      const Z = EZONE[0], x = (Z.x0 + Z.x1) / 2 + e * 40, z = (Z.z0 + Z.z1) / 2, y = terrainHeight(x, z) + 110 + R() * 50, i = add(RP, ST.SOAR, x, y, z, R() * TAU);
      scl[i] = 2.3 + R() * 0.2; vari[i] = 0.55 + R() * 0.4; fl[i] = 0; startSoar(i, y); if (e) mate = i - 1; else eagle0 = i;
    }
  }

  // ---------- flights: a curve over the ground from where the bird is to where it will be, and a height along it ----------
  // The height keeps clear of whatever stands under the course (not of the spots it leaves and lands on; under a tree's crown
  // where there is room) and, for a bird going up off its feet, adds a few metres of cruising height; it is the lowest line over
  // all that which climbs and sinks no steeper than the species does. Where something close forces it steeper, moveFlight slows
  // the bird to hold its rate of climb.
  const _b = [0, 0], _x = new Float32Array(FK1), _z = new Float32Array(FK1), _c = new Float32Array(FK1), _o = new Float32Array(FK1), _u = new Float32Array(FK1), _t = new Float32Array(FK1);
  function bezXZ(o, u) { const a = 1 - u, b0 = a * a * a, b1 = 3 * a * a * u, b2 = 3 * a * u * u, b3 = u * u * u; _b[0] = bz[o] * b0 + bz[o + 2] * b1 + bz[o + 4] * b2 + bz[o + 6] * b3; _b[1] = bz[o + 1] * b0 + bz[o + 3] * b1 + bz[o + 5] * b2 + bz[o + 7] * b3; return _b; }
  function planFlight(i, X, Y, Z, next, speed, delay = 0, air = false) {
    const s = sp[i], x0 = px[i], y0 = py[i], z0 = pz[i], dx = X - x0, dz = Z - z0, L = Math.hypot(dx, dz) + 0.01, ux = dx / L, uz = dz / L, leave = next === ST.SOAR;
    // the course: straight from a standing start, out of the heading it has for a bird already on the wing
    const h0 = Math.hypot(vx[i], vz[i]), hx = air && h0 > 0.5 ? vx[i] / h0 : ux, hz = air && h0 > 0.5 ? vz[i] / h0 : uz, o = i * 8, q = i * FK1, a = L * 0.35, b = L * (leave ? 0.3 : 0.25);
    bz.set([x0, z0, x0 + hx * a, z0 + hz * a, X - ux * b, Z - uz * b, X, Z], o);
    let S = 0;
    for (let k = 0; k <= FK; k++) { const p = bezXZ(o, k / FK); if (k) S += Math.hypot(p[0] - _x[k - 1], p[1] - _z[k - 1]); _x[k] = p[0]; _z[k] = p[1]; fS[q + k] = S; }
    S = Math.max(S, 1e-3);
    const gU = Math.max(GUP[s], (Y - y0) / S * 1.1), gD = Math.max(GDN[s], (y0 - Y) / S * 1.1), clr = Math.min(1.2, 0.3 + S * 0.1);
    const H = air || leave || st[i] === ST.PERCH ? 0 : Math.min(s === SP ? clamp(0.8 + S * 0.04, 1, 2.5) : clamp(1.4 + S * 0.06, 1.8, 5), 0.2 + S * 0.2);
    // what each station must clear (_c): the hop, anything solid, and a crown — unless the bird passes under it at the height it
    // flies there anyway: then the crown's underside is a ceiling (_u), and where the line comes out above that, it goes over (_o)
    for (let k = 0; k <= FK; k++) {
      const d = fS[q + k], e = S - d, m = Math.min(clr, gU * d, gD * e);
      _c[k] = lerp(y0, Y, d / S) + Math.min(H, gU * d, gD * e);   // (a hop over the straight line from spot to spot)
      _o[k] = -1e9; _u[k] = 1e9;
      if (d > 1.5 && e > 1.5) {
        _c[k] = Math.max(_c[k], solidAt(_x[k], _z[k]) + m);
        const cr = crownAt(_x[k], _z[k]);
        if (cr) { _o[k] = cr[0] + m; _u[k] = cr[1] - 0.6; if (_u[k] < _c[k]) _c[k] = Math.max(_c[k], _o[k]); }
      }
    }
    fY[q] = y0; fY[q + FK] = Y;
    for (let it = 0; it < 6; it++) {
      for (let k = 1; k < FK; k++) { const d = fS[q + k]; let y = -1e9; for (let j = 0; j <= FK; j++) { const dj = fS[q + j]; y = Math.max(y, _c[j] - (dj > d ? gU * (dj - d) : gD * (d - dj))); } fY[q + k] = y; }
      let over = false; for (let k = 1; k < FK; k++) if (fY[q + k] > _u[k] && _c[k] < _o[k]) { _c[k] = _o[k]; over = true; }
      if (!over) break;
    }
    for (let pass = 0; pass < 2; pass++) { _t.set(fY.subarray(q, q + FK1)); for (let k = 1; k < FK; k++) fY[q + k] = (_t[k - 1] + 2 * _t[k] + _t[k + 1]) / 4; }
    fT[i] = S; fU[i] = 0; fK[i] = 0; fD[i] = delay; fC[i] = speed; fV[i] = air ? Math.max(h0, 2) : V0[s]; fE[i] = air ? 9 : 0;   // (on the wing already: no take-off)
    nxt[i] = next; st[i] = ST.FLIGHT; act[i] = A.IDLE; bobT[i] = 0; hyT[i] = 0;
  }
  function land(i) {
    const k = nxt[i], s = sp[i], climb = vy[i];
    vx[i] = vy[i] = vz[i] = 0; bnk[i] = 0; pitT[i] = 0; ampT[i] = 0; dihT[i] = 0; tailT[i] = 0; swpT[i] = 0;
    if (k === ST.SOAR) { startSoar(i, Math.max(py[i] + 4, gullAlt())); vx[i] = Math.sin(yaw[i]) * spd[i]; vz[i] = Math.cos(yaw[i]) * spd[i]; vy[i] = climb; return; }
    st[i] = k; foldT[i] = 1; legOT[i] = k === ST.WATER ? 0 : 1; act[i] = A.IDLE; tA[i] = 0.3 + R() * 1.2; hpT[i] = 0;
    gg[i] = k === ST.WATER ? SEA : py[i] - STAND[s];
    if (s === GU) { if (k === ST.WATER) tA[i] = 50 + R() * 160; else tD[i] = 40 + R() * 160; }
    const f = fl[i] >= 0 && s !== SW && !(s === RP) ? flocks[fl[i]] : null;
    if (f && f.state === 'air' && ++f.landed >= f.m.length) f.state = f.site ? 'perch' : 'ground';
  }

  // ---------- flushing a flock: all up at once, away from the threat, down again 20–60 m off (or onto a roof) ----------
  let camX = 0, camZ = 0, camY = 0, camYaw = 0, flushes = 0;
  const ev = { flutter: 0, gull: 0, coo: 0, chirp: 0, swallow: 0 };
  const say = (type, x, y, z, data) => { ev[type]++; emit(type, x, y, z, data); };
  // how hard the way from one spot to another is for species s: how far it must rise over what stands between (above the higher
  // end), and, weighing more, how much of that rise comes too close to either end to be climbed or sunk at the species' own slope
  function wayCost(s, x0, z0, y0, x1, z1, y1) {
    const L = Math.hypot(x1 - x0, z1 - z0); let over = 0, steep = 0;
    for (let d = 1.5; d <= L - 1.5; d += 2) {
      const u = d / L, t = topAt(lerp(x0, x1, u), lerp(z0, z1, u), Math.max(y0, y1) + 2.5);
      over = Math.max(over, t - Math.max(y0, y1)); steep = Math.max(steep, t + 1.2 - y0 - GUP[s] * d, t + 1.2 - y1 - GDN[s] * (L - d));
    }
    return over + steep * 3;
  }
  function pickLanding(f, ax, az, d0, d1) {
    const zs = f.s === SP ? zonesSP : zonesPG;
    let ox = f.cx - ax, oz = f.cz - az; const ol = Math.hypot(ox, oz); if (ol < 0.01) { ox = Math.sin(R() * TAU); oz = Math.cos(R() * TAU); } else { ox /= ol; oz /= ol; }
    const away = Math.atan2(ox, oz);
    let best = null, bc = 1e9;
    for (let q = 0; q < 60; q++) {
      const a = away + (R() - 0.5) * (q < 30 ? 2.2 : 5.5), d = d0 + R() * (d1 - d0), x = f.cx + Math.sin(a) * d, z = f.cz + Math.cos(a) * d;
      const zn = zoneAt(zs, x, z); if (!zn) continue;
      if ((x - camX) ** 2 + (z - camZ) ** 2 < 196) continue;
      const y = okSpot(x, z, zn.y); if (Number.isNaN(y)) continue;
      // somewhere in the open, and the way there low and easy (a stall or a statue is hopped over; a house or a tree next to the
      // flock is flown over only if nothing else will do)
      const L = Math.hypot(x - f.cx, z - f.cz), ux = (f.cx - x) / L, uz = (f.cz - z) / L;
      if (q < 40 && [0, 1.2, 2.4].some(b => topAt(x + ux * b, z + uz * b, y + 1) > y + 0.5)) continue;
      const c = wayCost(f.s, f.cx, f.cz, f.gy, x, z, y);
      if (c < 3.5) return { x, z, y };
      if (c < bc) { bc = c; best = { x, z, y }; }
    }
    return best;
  }
  function pickSite(f) {
    let best = null, bd = 1e9;
    for (let q = 0; q < sites.length; q++) {
      const s = sites[q], d0 = Math.hypot(s.x - f.cx, s.z - f.cz);
      if (d0 < 20 || d0 > 70 || (s.x - camX) ** 2 + (s.z - camZ) ** 2 < 100) continue;
      const d = d0 + R() * 30 + wayCost(PG, f.cx, f.cz, f.gy, s.x + s.dx * s.len / 2, s.z + s.dz * s.len / 2, s.y) * 6;
      if (d < bd && s.occ.filter(v => v < 0).length >= f.m.length + 2) { bd = d; best = s; }
    }
    return best;
  }
  function flush(f, ax, az, calm = false, roof = f.roofy) {
    let tgt = null, site = null, slots = null;
    if (f.s === PG && roof > 0 && R() < roof) { site = pickSite(f); if (site) slots = claimSite(site, 0, f.m.length); if (!slots) site = null; }
    if (!site) {
      const d0 = calm ? 8 : f.s === SP ? 10 : 20, d1 = calm ? 30 : f.s === SP ? 30 : 60;
      tgt = pickLanding(f, ax, az, d0, d1) || pickLanding(f, ax, az, d0, d1 * 1.8);
      if (!tgt && (f.hx - camX) ** 2 + (f.hz - camZ) ** 2 > 400 && (f.hx - f.cx) ** 2 + (f.hz - f.cz) ** 2 > 25) tgt = { x: f.hx, z: f.hz, y: f.hy };
      if (!tgt) return false;
    }
    if (f.site) for (const i of f.m) if (perchK[i] >= 0) { f.site.occ[perchK[i]] = -1; perchK[i] = -1; }
    const ox = f.cx, oz = f.cz, oy = f.gy;
    f.state = 'air'; f.landed = 0; f.site = site; f.slots = slots;
    if (site) { f.cx = site.x; f.cz = site.z; f.gy = site.y; } else { f.cx = tgt.x; f.cz = tgt.z; f.gy = tgt.y; }
    const speed = f.s === SP ? 8.5 : 11;
    f.m.forEach((i, q) => {
      const d = Math.hypot(px[i] - ax, pz[i] - az), delay = calm ? R() * 0.7 : clamp((d - 2) * 0.04, 0, 0.35) + R() * 0.22;
      let X, Y, Z;
      if (site) { const k = slots[q]; [X, Z] = slotXZ(site, k); Y = site.y; site.occ[k] = i; perchK[i] = k; gx[i] = site.yawB === null || R() < 0.5 ? site.yawA : site.yawB; }
      else [X, Y, Z] = spotNear(f, tgt.x, tgt.z, f.r);
      planFlight(i, X, Y + STAND[f.s], Z, site ? ST.PERCH : ST.GROUND, speed * (0.9 + R() * 0.2), delay, st[i] === ST.FLIGHT);
    });
    f.t = 60 + R() * 220; flushes++;
    say('flutter', ox, oy + 0.3, oz, { n: f.m.length, species: SPN[f.s] });
    return true;
  }
  // a single bird side-stepped by a passer-by: a quick walk, or a flutter of a few metres
  function scoot(i, ex, ez, fly) {
    const f = flocks[fl[i]], s = sp[i];
    if (fly || s === SP) {
      const d = 1.5 + R() * 2.5, X = px[i] + ex * d, Z = pz[i] + ez * d, y = okSpot(X, Z, f ? f.gy : gg[i], 0.2, 0.3);
      if (!Number.isNaN(y)) { planFlight(i, X, y + STAND[s], Z, ST.GROUND, 4, 0); if ((X - camX) ** 2 + (Z - camZ) ** 2 < 900) say('flutter', px[i], py[i], pz[i], { n: 1, species: SPN[s] }); return; }
    }
    const X = px[i] + ex * (0.8 + R() * 0.6), Z = pz[i] + ez * (0.8 + R() * 0.6);
    if (!Number.isNaN(okSpot(X, Z, gg[i], 0.2, 0.3))) { gx[i] = X; gz[i] = Z; act[i] = A.WALK; spd[i] = 0.9; tA[i] = 3; }
  }

  // ---------- thinking (at a rate that falls with distance) ----------
  function nextGroundAct(i) {
    const s = sp[i], r = R(), f = fl[i] >= 0 && s !== GU ? flocks[fl[i]] : null;
    const walkTo = (step) => {
      for (let q = 0; q < 6; q++) {
        let X = px[i] + (R() - 0.5) * 2 * step, Z = pz[i] + (R() - 0.5) * 2 * step;
        if (f) { const dx = X - f.cx, dz = Z - f.cz, d = Math.hypot(dx, dz); if (d > f.r) { X = f.cx + dx / d * f.r * 0.7; Z = f.cz + dz / d * f.r * 0.7; } }
        if (s === GU) { const sd = stands[perchK[i]]; if (sd && Math.hypot(X - sd.x, Z - sd.z) > 1.2) continue; }
        if (f && f.m.some(j => j !== i && (px[j] - X) ** 2 + (pz[j] - Z) ** 2 < 0.06)) continue;
        if (Number.isNaN(okSpot(X, Z, gg[i], 0.12, 0.25))) continue;
        gx[i] = X; gz[i] = Z; return true;
      }
      return false;
    };
    act[i] = A.IDLE; hpT[i] = 0; pitT[i] = 0;
    if (s === PG) {
      if (r < 0.45 && walkTo(0.4 + R() * 0.7)) { act[i] = A.WALK; spd[i] = 0.32 + R() * 0.22; tA[i] = 6; }
      else if (r < 0.85) { act[i] = A.PECK; cnt[i] = 1 + Math.floor(R() * 4); tB[i] = 0; }
      else { tA[i] = 0.5 + R() * 2.2; tC[i] = 0; }
    } else if (s === SP) {
      if (r < 0.5 && walkTo(0.25 + R() * 0.45)) { act[i] = A.HOP; tB[i] = 0; spd[i] = 1.2 + R() * 0.5; tA[i] = 4; cnt[i] = 0; }
      else if (r < 0.85) { act[i] = A.PECK; cnt[i] = 1 + Math.floor(R() * 5); tB[i] = 0; }
      else { tA[i] = 0.3 + R() * 1.4; tC[i] = 0; }
    } else {   // a gull on the stone: mostly stands, looks about, sometimes shifts a step
      if (r < 0.12 && walkTo(0.5)) { act[i] = A.WALK; spd[i] = 0.45; tA[i] = 5; }
      else { tA[i] = 2 + R() * 6; tC[i] = 0; }
    }
  }
  function thinkGround(i, dt, t) {
    const s = sp[i];
    tA[i] -= dt;
    if (act[i] === A.WALK || act[i] === A.HOP) {
      const dx = gx[i] - px[i], dz = gz[i] - pz[i], d = Math.hypot(dx, dz), want = Math.atan2(dx, dz), dy = wrap(want - yaw[i]);
      yaw[i] += clamp(dy, -9 * dt, 9 * dt);
      if (d < 0.02 || tA[i] <= 0) { legA[i] = 0; bobT[i] = 0; py[i] = gg[i] + STAND[s]; nextGroundAct(i); return; }
      if (act[i] === A.HOP) {   // sparrows hop, both feet together: 0.11 s in the air, a pause between hops
        tB[i] += dt;
        if (tB[i] < 0.11) { if (Math.abs(dy) < 0.8) { const m = Math.min(d, spd[i] * dt); px[i] += dx / d * m; pz[i] += dz / d * m; } py[i] = gg[i] + STAND[s] + 0.022 * Math.sin(Math.PI * tB[i] / 0.11); }
        else { py[i] = gg[i] + STAND[s]; if (tB[i] > 0.11 + 0.05 + vari[i] * 0.25) tB[i] = 0; }
        legA[i] = 0;
      } else if (Math.abs(dy) < 0.7) {
        const m = Math.min(d, spd[i] * dt); px[i] += dx / d * m; pz[i] += dz / d * m;
        const step = s === GU ? 0.13 : 0.07; legP[i] += m / step * Math.PI; legA[i] = s === GU ? 0.4 : 0.5;
        if (s === PG) {   // the head holds still in the air while the body walks under it, then thrusts forward
          const u = (legP[i] / Math.PI) % 1, Am = 0.35 * step;
          bobT[i] = bob[i] = u < 0.7 ? Am - 2 * Am * u / 0.7 : -Am + 2 * Am * (u - 0.7) / 0.3;
        }
      }
      return;
    }
    if (act[i] === A.PECK) {
      tB[i] += dt; const T = s === SP ? 0.2 : 0.34, u = tB[i] / T;
      const k = u < 1 ? Math.pow(Math.sin(Math.PI * u), 0.6) : 0;
      hpT[i] = hp[i] = (s === SP ? 1.1 : 1.3) * k; pitT[i] = pit[i] = -(s === SP ? 0.35 : 0.5) * k; bob[i] = bobT[i] = 0.018 * k * (s === PG ? 1 : 0.5);
      if (u >= 1 + vari[i] * 0.4) { tB[i] = 0; if (--cnt[i] <= 0) nextGroundAct(i); }
      return;
    }
    if (act[i] === A.CALL) {   // a gull's long call: the head thrown down and forward, then up and back
      tB[i] += dt; const u = tB[i] / 1.6;
      hpT[i] = u < 0.25 ? 0.9 : u < 0.9 ? -0.7 : 0; pitT[i] = u < 0.25 ? -0.25 : u < 0.9 ? 0.12 : 0;
      if (u >= 1) nextGroundAct(i);
      return;
    }
    // idle: look about
    tC[i] -= dt; if (tC[i] <= 0) { tC[i] = 0.4 + R() * 1.3; hyT[i] = (R() - 0.5) * 1.6; hpT[i] = (R() - 0.6) * 0.3; }
    if (s === GU) { const dy = wrap(UPWIND + (vari[i] - 0.5) * 1.2 - yaw[i]); yaw[i] += clamp(dy, -0.5 * dt, 0.5 * dt); }
    if (tA[i] <= 0) nextGroundAct(i);
  }
  function thinkPerch(i, dt) {
    const dy = wrap(gx[i] - yaw[i]); yaw[i] += clamp(dy, -4 * dt, 4 * dt);
    tC[i] -= dt; if (tC[i] <= 0) { tC[i] = 0.6 + R() * 2.5; hyT[i] = (R() - 0.5) * 1.8; hpT[i] = R() < 0.15 ? 0.9 : (R() - 0.5) * 0.4; }   // (now and then a look down into the street)
  }
  function thinkGull(i, dt) {
    if (st[i] === ST.WATER) {
      tA[i] -= dt; const dy = wrap(UPWIND + (vari[i] - 0.5) * 0.9 - yaw[i]); yaw[i] += clamp(dy, -0.3 * dt, 0.3 * dt);
      tC[i] -= dt; if (tC[i] <= 0) { tC[i] = 1 + R() * 3; hyT[i] = (R() - 0.5) * 1.4; hpT[i] = (R() - 0.5) * 0.3; }
      if (tA[i] <= 0) takeOffGull(i, 0);
      return;
    }
    thinkGround(i, dt);
    if ((tD[i] -= dt) <= 0 && act[i] === A.IDLE) takeOffGull(i, 0);   // it has stood long enough
  }
  function takeOffGull(i, delay) {
    const up = UPWIND + (R() - 0.5) * 1.2, d = 30 + R() * 20;
    if (perchK[i] >= 0 && stands[perchK[i]]) stands[perchK[i]].i = -1; perchK[i] = -1;
    planFlight(i, px[i] + Math.sin(up) * d, py[i] + 9 + R() * 6, pz[i] + Math.cos(up) * d, ST.SOAR, 8, delay);
    if ((px[i] - camX) ** 2 + (pz[i] - camZ) ** 2 < 3600) say('flutter', px[i], py[i], pz[i], { n: 1, species: 'gull' });
  }
  let gullsDown = 0;
  function thinkSoar(i, dt) {
    const eagle = sp[i] === RP, Z = eagle ? EZONE[fl[i]] : GZONE;
    tA[i] -= dt; tB[i] -= dt; tC[i] -= dt;
    if (px[i] < Z.x0 || px[i] > Z.x1 || pz[i] < Z.z0 || pz[i] > Z.z1) { if (act[i] !== 1) { act[i] = 1; tA[i] = 20; } gx[i] = (Z.x0 + Z.x1) / 2 + (R() - 0.5) * 60; gz[i] = (Z.z0 + Z.z1) / 2 + (R() - 0.5) * 60; }
    if (tA[i] <= 0) {
      if (act[i] === 0) {
        act[i] = 1; tA[i] = 15 + R() * 20;
        if (!eagle && camZ > 380 && camY < AGL + 30 && R() < 0.45) { const a = R() * TAU, d = 15 + R() * 30; gx[i] = camX + Math.sin(a) * d; gz[i] = Math.max(camZ + Math.cos(a) * d, 425); }   // over to the onlooker on the quay
        else { gx[i] = lerp(Z.x0, Z.x1, R()); gz[i] = lerp(Z.z0, Z.z0 + (Z.z1 - Z.z0) * (R() < 0.65 ? 0.45 : 1), R()); }   // mostly over the quay and the inner basin
        gy[i] = eagle ? terrainHeight(gx[i], gz[i]) + 100 + R() * 70 : gullAlt();
      }
      else { act[i] = 0; const r = eagle ? 60 + R() * 50 : 16 + R() * 30; trnT[i] = (R() < 0.5 ? -1 : 1) * spd[i] / r; tA[i] = eagle ? 12 + R() * 30 : 8 + R() * 16; }
    }
    if (eagle && mate >= 0 && i === mate + 1) {   // the mate: back to the other's side when it has drifted off, else circling the same way
      const e = mate, far = (px[e] - px[i]) ** 2 + (pz[e] - pz[i]) ** 2 > 90 * 90;
      if (far) { act[i] = 1; gx[i] = px[e]; gz[i] = pz[e]; tA[i] = 5; } else if (act[i] === 1) { act[i] = 0; tA[i] = 10; }
      if (!far) { trnT[i] = trn[e] * 1.05; gy[i] = gy[e] + 12; }
    }
    if (!eagle && act[i] === 0 && camZ > 380 && camY < AGL + 30 && R() < dt * 0.05 && (px[i] - camX) ** 2 + (pz[i] - camZ) ** 2 > 3600) {
      const a = R() * TAU, d = 12 + R() * 25; act[i] = 1; tA[i] = 25; gx[i] = camX + Math.sin(a) * d; gz[i] = Math.max(camZ + Math.cos(a) * d, 425); gy[i] = gullAlt();
    }
    if (act[i] === 1) {
      const want = Math.atan2(gx[i] - px[i], gz[i] - pz[i]); trnT[i] = clamp(wrap(want - hdg[i]) * 0.5, -0.35, 0.35);
      if ((gx[i] - px[i]) ** 2 + (gz[i] - pz[i]) ** 2 < 900) tA[i] = 0;
    } else gy[i] += dt * (eagle ? 0.5 : 0.35);   // circling in lift, slowly rising
    const lo = eagle ? terrainHeight(px[i], pz[i]) + 90 : Math.max(floorAt(px[i], pz[i]) + 6, SEA + 12);
    gy[i] = clamp(gy[i], lo, eagle ? lo + 90 : AGL + 42);
    // a few slow beats now and then (more when it has to climb); otherwise the wings held still in the wind
    if (tB[i] <= 0) { tB[i] = (eagle ? 12 : 5) + R() * 14; tC[i] = (2 + R() * 4) / (eagle ? 2 : 2.8); }
    const flap = tC[i] > 0 || py[i] < gy[i] - 10;
    ampT[i] = flap ? (eagle ? 0.4 : 0.55) : 0; om[i] = TAU * (eagle ? 2 : 2.8); dihT[i] = eagle ? 0.12 : 0.06; swpT[i] = flap ? 0 : 0.12;
    // a soaring gull comes down again to the water or the stone when there is room
    if (!eagle && (tD[i] -= dt) <= 0) {
      tD[i] = 40 + R() * 90;
      if (gullsDown < 24) {
        // the nearest of a few spots it can glide down to at a gull's slope: it comes in from a distance, it does not drop out of the sky
        const free = stands.filter(s => s.i < 0); let best = null, bc = Infinity;
        for (let q = 0; q < 8; q++) {
          const s = free.length && R() < 0.4 ? free[Math.floor(R() * free.length)] : null, [x, z] = s ? [s.x, s.z] : water(), y = s ? s.y + STAND[GU] : SEA + 0.045;
          const L = Math.hypot(x - px[i], z - pz[i]), g = (py[i] - y) / L, c = g < 0.35 ? L : 1e4 * g;
          if (c < bc) { bc = c; best = { s, x, y, z }; }
        }
        if (best.s) standGull(i, best.s);
        planFlight(i, best.x, best.y, best.z, best.s ? ST.GROUND : ST.WATER, 8, 0, true);
      }
    }
  }
  function pickHawkTarget(i) {
    const h = hawks[fl[i]];
    if (h.near && R() < 0.6) {   // a pass close by the onlooker: 6–24 m off, at head height to a few storeys up
      const a = R() < 0.65 ? camYaw + (R() - 0.5) * 1.6 : R() * TAU, d = 6 + R() * 18, x = camX + Math.sin(a) * d, z = camZ + Math.cos(a) * d;   // mostly across the view
      gx[i] = x; gz[i] = z; gy[i] = Math.max(floorAt(x, z) + 1.2, camY - 0.5 + R() * R() * 12); tA[i] = 0.8 + R() * 1.2; return;
    }
    if (R() < 0.3) for (let q = 0; q < 8; q++) {   // down to skim the ground (or the basin)
      const x = h.cx + (R() - 0.5) * 2 * h.r, z = h.cz + (R() - 0.5) * 2 * h.r, k = cellOf(x, z);
      if (k >= 0 && deep[k]) { gx[i] = x; gz[i] = z; gy[i] = gGround[k] + 0.8 + R() * 1.6; tA[i] = 1 + R() * 1.5; return; }
    }
    const x = h.cx + (R() - 0.5) * 2 * h.r, z = h.cz + (R() - 0.5) * 2 * h.r;
    gx[i] = x; gz[i] = z; gy[i] = floorAt(x, z) + 2 + R() * R() * 14; tA[i] = 0.8 + R() * 2.2;
  }
  function thinkHawk(i, dt) {
    tA[i] -= dt; tB[i] -= dt; tC[i] -= dt;
    if (tA[i] <= 0 || (gx[i] - px[i]) ** 2 + (gy[i] - py[i]) ** 2 + (gz[i] - pz[i]) ** 2 < 25) pickHawkTarget(i);
    if (tB[i] <= 0) { tB[i] = 0.15 + R() * 0.45; jx[i] = (R() - 0.5) * 1.1; jy[i] = (R() - 0.5) * 0.5; jz[i] = (R() - 0.5) * 1.1; }   // the jinks after insects
    if (tC[i] <= 0) { act[i] ^= 1; tC[i] = act[i] ? 0.25 + R() * 0.6 : 0.2 + R() * 0.7; }
    const s = Math.hypot(vx[i], vy[i], vz[i]), flap = (act[i] === 1 || vy[i] > 2.5) && vy[i] > -3.5;
    ampT[i] = flap ? 0.78 : 0; om[i] = TAU * (8.5 + vari[i] * 2); swpT[i] = flap ? 0.1 : s > 14 ? 0.9 : 0.5; dihT[i] = flap ? 0 : -0.04;
  }
  function thinkHover(i, dt) {
    tA[i] -= dt;
    if (act[i] === 0) {   // hanging in the wind, head still, looking down
      ampT[i] = 0.55; om[i] = TAU * 7.5; swpT[i] = 0; tailT[i] = 1; pitT[i] = 0.5; hpT[i] = 0.75; dihT[i] = 0.1;
      if (tA[i] <= 0) { act[i] = 1; const a = R() * TAU, d = 25 + R() * 45; gx[i] = cnt[i] + Math.sin(a) * d; gz[i] = jz[i] + Math.cos(a) * d; gy[i] = terrainHeight(gx[i], gz[i]) + 12 + R() * 8; tA[i] = 15; spd[i] = 8; hdg[i] = yaw[i]; }
    } else {
      ampT[i] = (tA[i] % 1.5) < 0.6 ? 0.6 : 0; om[i] = TAU * 6; swpT[i] = 0.3; tailT[i] = 0.2; hpT[i] = 0.3; pitT[i] = 0; dihT[i] = 0.05;
      const want = Math.atan2(gx[i] - px[i], gz[i] - pz[i]); trnT[i] = clamp(wrap(want - hdg[i]) * 1.2, -0.9, 0.9);
      if ((gx[i] - px[i]) ** 2 + (gz[i] - pz[i]) ** 2 < 16 || tA[i] <= 0) { act[i] = 0; tA[i] = 5 + R() * 10; gx[i] = px[i]; gy[i] = py[i]; gz[i] = pz[i]; }
    }
  }

  // ---------- moving (every frame, for everything in the air) ----------
  function moveFlight(i, dt, t) {
    if (fD[i] > 0) { fD[i] -= dt; hpT[i] = -0.3; hyT[i] = 0; return; }   // about to go: head up
    const s = sp[i], q = i * FK1, S = fT[i], toSoar = nxt[i] === ST.SOAR;
    // the speed over the ground: up from the jump towards cruising, held down where the course climbs or sinks steeply (looking
    // as far ahead as it takes to slow down), braked to touch down
    let k = fK[i], vT = fC[i];
    const d0 = fU[i], ahead = d0 + fV[i] * fV[i] / 10 + 1.5;
    for (let j = k; j < FK && (j === k || fS[q + j] < ahead); j++) {
      // (and the sink eased off towards the ground, as the speed is: 0.8 m/s at touch-down)
      const g = (fY[q + j + 1] - fY[q + j]) / Math.max(1e-3, fS[q + j + 1] - fS[q + j]), h = (j === k ? py[i] : fY[q + j]) - fY[q + FK];
      const sink = toSoar ? VDN[s] : Math.min(VDN[s], Math.sqrt(0.64 + 6 * Math.max(0, h)));
      const cap = g > 0.05 ? VUP[s] / g : g < -0.05 ? sink / -g : 1e9;
      vT = Math.min(vT, Math.sqrt(cap * cap + 10 * Math.max(0, fS[q + j] - d0)));   // (no faster than it can brake, at 5 m/s², to that stretch's speed)
    }
    if (!toSoar) vT = Math.min(vT, Math.sqrt(VTD[s] * VTD[s] + 2 * DEC[s] * Math.max(0, S - d0)));
    if (fE[i] === 0) fV[i] = Math.min(fV[i], vT);   // (off the feet no faster than the first stretch allows)
    const v = fV[i] = Math.max(0.02, fV[i] + clamp(vT - fV[i], -8 * dt, ACC[s] * dt)), brake = vT < v - 0.5;
    const d = fU[i] = Math.min(S, fU[i] + v * dt), e = fE[i] += dt;
    while (k < FK - 1 && fS[q + k + 1] <= d) k++;
    fK[i] = k;
    const s0 = fS[q + k], ds = fS[q + k + 1] - s0, f = ds > 1e-4 ? clamp((d - s0) / ds, 0, 1) : 1, u = (k + f) / FK, o = i * 8, a = 1 - u;
    const p = bezXZ(o, u); px[i] = p[0]; pz[i] = p[1]; py[i] = fY[q + k] + (fY[q + k + 1] - fY[q + k]) * f;
    let tx = a * a * (bz[o + 2] - bz[o]) + 2 * a * u * (bz[o + 4] - bz[o + 2]) + u * u * (bz[o + 6] - bz[o + 4]), tz = a * a * (bz[o + 3] - bz[o + 1]) + 2 * a * u * (bz[o + 5] - bz[o + 3]) + u * u * (bz[o + 7] - bz[o + 5]);
    const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    vx[i] = tx * v; vz[i] = tz * v; vy[i] = ds > 1e-4 ? (fY[q + k + 1] - fY[q + k]) / ds * v : 0;
    // the last metres: legs down, tail fanned, the body pitched up into the flare
    const rem = S - d, near = 1.2 + v * 0.7, landing = !toSoar && rem < near, flare = landing ? 1 - rem / near : 0, off = e < 0.35 && !toSoar;
    if (v > 0.35) { const ch = clamp(wrap(Math.atan2(vx[i], vz[i]) - yaw[i]), -8 * dt, 8 * dt); yaw[i] += ch; bnk[i] += (clamp(-ch / Math.max(dt, 1e-3) * v / 9.8, -1, 1) - bnk[i]) * Math.min(1, dt * 6); }
    pitT[i] = clamp(Math.atan2(vy[i], Math.max(v, 0.5)), -0.75, 1.0) * 0.8 + flare * 0.7 + (off ? 0.35 : 0);
    pit[i] += (pitT[i] - pit[i]) * Math.min(1, dt * 8);
    foldT[i] = 0; tailT[i] = landing || off ? 1 : 0.2; legOT[i] = landing || e < 0.25 ? 1 : 0; hpT[i] = 0; hyT[i] = 0; bobT[i] = 0; swpT[i] = 0.1; dihT[i] = 0;
    const climb = vy[i];
    if (s === PG) {
      if (e < 0.8 || climb > 1) { ampT[i] = e < 0.45 ? 1.15 : 1.0; om[i] = TAU * 8.5; }
      else if (landing || brake) { ampT[i] = 0.95; om[i] = TAU * 8; }
      else if (climb < -1) { ampT[i] = 0; dihT[i] = 0.5; }   // the pigeon's glide, wings held up in a V
      else { ampT[i] = 0.75; om[i] = TAU * 6.5; }
    } else if (s === SP) {   // bounding: a burst of beats, then a moment with the wings shut
      const c = (t * 2.6 + vari[i] * 3) % 1;
      if (e < 0.5 || landing || c < 0.62) { ampT[i] = 0.95; om[i] = TAU * 14; } else { ampT[i] = 0; foldT[i] = 1; }
    } else if (s === GU) {
      if (e < 1.5 || climb > 1.2) { ampT[i] = 0.85; om[i] = TAU * 3; }
      else if (landing) { ampT[i] = 0.7; om[i] = TAU * 3.3; }
      else { ampT[i] = 0; dihT[i] = 0.06; }
    }
    if (d >= S) land(i);
  }
  function moveHawk(i, dt) {
    const s = Math.hypot(vx[i], vy[i], vz[i]) || 1;
    let ux = vx[i] / s, uy = vy[i] / s, uz = vz[i] / s;
    let dx = gx[i] - px[i], dy = gy[i] - py[i], dz = gz[i] - pz[i]; const dl = Math.hypot(dx, dy, dz) || 1;
    dx = dx / dl + jx[i]; dy = dy / dl + jy[i]; dz = dz / dl + jz[i];
    // look ahead and pull up before the floor rises (roofs, stoas, the tomb)
    for (const tau of [0.3, 0.7, 1.2]) { const fy = py[i] + vy[i] * tau, f0 = floorAt(px[i] + vx[i] * tau, pz[i] + vz[i] * tau); if (fy < f0 + 0.5) dy += (f0 + 0.5 - fy) * 0.6; }
    let dl2 = Math.hypot(dx, dy, dz) || 1; dx /= dl2; dy /= dl2; dz /= dl2;
    const dot = ux * dx + uy * dy + uz * dz;
    if (dot < -0.9) { dx -= uz * 0.6; dz += ux * 0.6; dl2 = Math.hypot(dx, dy, dz); dx /= dl2; dy /= dl2; dz /= dl2; }
    const k = Math.min(1, 3.4 * dt / Math.max(0.05, Math.acos(clamp(dot, -1, 1))));
    ux += (dx - ux) * k; uy += (dy - uy) * k; uz += (dz - uz) * k; const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
    const sT = clamp(spd[i] - uy * 6, 9, 20), s2 = s + (sT - s) * Math.min(1, dt * 2);
    vx[i] = ux * s2; vy[i] = uy * s2; vz[i] = uz * s2;
    px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
    const f0 = floorAt(px[i], pz[i]); if (py[i] < f0 - 0.3) { py[i] += (f0 - 0.3 - py[i]) * Math.min(1, dt * 6); if (vy[i] < 0) vy[i] *= 0.5; }
    const ny = Math.atan2(vx[i], vz[i]), dYaw = wrap(ny - yaw[i]); yaw[i] = ny;
    bnk[i] += (clamp(Math.atan(-s2 * dYaw / Math.max(dt, 1e-3) / 9.8), -1.3, 1.3) - bnk[i]) * Math.min(1, dt * 7);
    pitT[i] = pit[i] = Math.atan2(vy[i], Math.hypot(vx[i], vz[i]));
  }
  function moveSoar(i, dt) {
    trn[i] += (trnT[i] - trn[i]) * Math.min(1, dt * 1.2); hdg[i] += trn[i] * dt;
    const s = spd[i], dr = sp[i] === GU ? 0.4 : 0.2, gust = wind.gust ? wind.gust(px[i], pz[i], lastTime) : 1;
    vx[i] = Math.sin(hdg[i]) * s + wind.dx * wind.speed * dr * gust; vz[i] = Math.cos(hdg[i]) * s + wind.dz * wind.speed * dr * gust;
    vy[i] += (clamp((gy[i] - py[i]) * 0.25, -1.6, 1.5) - vy[i]) * Math.min(1, dt * 0.8);
    px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
    yaw[i] = hdg[i];
    bnk[i] += (clamp(Math.atan(-s * trn[i] / 9.8), -0.75, 0.75) - bnk[i]) * Math.min(1, dt * 2.5);
    pitT[i] = pit[i] = Math.atan2(vy[i], s) * 0.6;
  }
  function moveHover(i, dt, t) {
    if (act[i] === 0) {   // fixed in the air, facing the wind, a little buffeted
      const w = vari[i] * 20;
      px[i] += (gx[i] + 0.12 * Math.sin(t * 1.3 + w) - px[i]) * Math.min(1, dt * 2); py[i] += (gy[i] + 0.18 * Math.sin(t * 0.9 + w) - py[i]) * Math.min(1, dt * 2); pz[i] += (gz[i] + 0.12 * Math.sin(t * 1.1 + w) - pz[i]) * Math.min(1, dt * 2);
      yaw[i] += clamp(wrap(UPWIND - yaw[i]), -1.5 * dt, 1.5 * dt); hdg[i] = yaw[i]; bnk[i] += (0.06 * Math.sin(t * 1.7 + w) - bnk[i]) * Math.min(1, dt * 3);
      pit[i] += (pitT[i] - pit[i]) * Math.min(1, dt * 3);
    } else {
      trn[i] += (trnT[i] - trn[i]) * Math.min(1, dt * 2); hdg[i] += trn[i] * dt;
      vx[i] = Math.sin(hdg[i]) * spd[i]; vz[i] = Math.cos(hdg[i]) * spd[i]; vy[i] = clamp((gy[i] - py[i]) * 0.5, -2, 2);
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt; yaw[i] = hdg[i];
      bnk[i] += (clamp(Math.atan(-spd[i] * trn[i] / 9.8), -0.6, 0.6) - bnk[i]) * Math.min(1, dt * 3); pit[i] += (0 - pit[i]) * Math.min(1, dt * 3);
    }
  }

  // ---------- the mesh ----------
  const geo = birdGeometry();
  const ATT = ['iPos', 'iOri', 'iWing', 'iPose', 'iMisc'];
  for (const nm of ATT) geo.setAttribute(nm, new THREE.InstancedBufferAttribute(new Float32Array(NB * 4), 4).setUsage(THREE.DynamicDrawUsage));
  const matStd = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, envMapIntensity: 0.4 }), 'std');
  (ctx.setupMaterial || (m => m))(matStd);
  const matDepth = patchMaterial(new THREE.MeshDepthMaterial(), 'depth');
  const mesh = new THREE.InstancedMesh(geo, matStd, NB);
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true; mesh.customDepthMaterial = matDepth; mesh.userData.noAO = true; mesh.name = 'birds'; mesh.count = 0;
  const AT = ATT.map(nm => geo.attributes[nm]), AA = AT.map(a => a.array);
  const group = new THREE.Group(); group.name = 'birds'; group.add(mesh);
  const trisPerBird = geo.index.count / 3;

  // ---------- per frame ----------
  const _pm = new THREE.Matrix4(), _fr = new THREE.Frustum(), PLN = new Float64Array(24);
  let frame = 0, lastTime = 0, tame = false, frozen = false, tFrozen = 0, lcx = 0, lcz = 0, cvx = 0, cvz = 0, drawn = 0, gullCallT = 4, cooT = 3, chirpT = 2, swallowT = 1;
  const updMs = new Float32Array(120); let updK = 0;
  const _near = [];

  function update(dt, t, cam, player) {
    const T0 = perf.now();
    dt = frozen ? 0 : Math.min(Math.max(dt, 0), 0.1); if (frozen) t = tFrozen; frame++; lastTime = t;
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    // the camera's ground speed (a teleport — a jump of the screenshot views — is not a charge)
    { const mx = cx - lcx, mz = cz - lcz; if (dt > 0) { if (mx * mx + mz * mz > 64) { cvx = cvz = 0; } else { const k = Math.min(1, dt * 6); cvx += (mx / dt - cvx) * k; cvz += (mz / dt - cvz) * k; } } lcx = cx; lcz = cz; }
    camX = cx; camZ = cz; camY = cy; { const e = cam.matrixWorld.elements; camYaw = Math.atan2(-e[8], -e[10]); }   // where the onlooker is looking
    const camH = cy - world.groundHeight(cx, cz), low = camH < 8 && !tame;

    // flocks on the ground: charged by the camera, side-stepped by passers-by, moving on now and then
    for (const f of flocks) {
      const dc = Math.hypot(f.cx - cx, f.cz - cz);
      if (f.state === 'ground' && dc < 40 && low) {
        for (const i of f.m) {
          if (st[i] !== ST.GROUND) continue;
          const ex = px[i] - cx, ez = pz[i] - cz, d = Math.hypot(ex, ez) || 0.01, closing = (cvx * ex + cvz * ez) / d;
          if (d < FLEE[f.s] * wary[i] + Math.max(0, closing - 1.2) * 0.8 && cy - py[i] < 7) { flush(f, cx, cz); break; }
        }
      } else if (f.state === 'perch' && dc < 25) {
        for (const i of f.m) if ((px[i] - cx) ** 2 + (pz[i] - cz) ** 2 < 12 && Math.abs(py[i] - cy) < 3) { flush(f, cx, cz); break; }
      }
      if (f.state === 'ground' && people && dc < 70 && (f.listenT -= dt) <= 0) {
        f.listenT = 0.3 + R() * 0.15;
        const ps = people.listen(f.cx, f.cz, f.r + 3);
        let close = 0;
        for (const p of ps) { if (Math.hypot(p.x - f.cx, p.z - f.cz) < f.r * 0.8) close++; for (const i of f.m) {
          if (st[i] !== ST.GROUND) continue;
          const ex = px[i] - p.x, ez = pz[i] - p.z, d = Math.hypot(ex, ez) || 0.01;
          if (d < (p.walking ? 1.1 : 0.6)) scoot(i, ex / d, ez / d, p.walking && d < 0.65);
        } }
        if (close >= 3 && R() < 0.3) flush(f, f.cx + (R() - 0.5), f.cz + (R() - 0.5), true, f.roofy);   // too busy here: the flock moves on
      }
      if (f.state !== 'air' && (f.t -= dt) <= 0) {
        if (dc < 18) f.t = 10;
        else if (f.state === 'perch') { if (!flush(f, f.cx + (R() - 0.5) * 4, f.cz + (R() - 0.5) * 4, true, 0.15)) f.t = 30; }
        else if (!flush(f, f.cx + (R() - 0.5) * 4, f.cz + (R() - 0.5) * 4, true, f.roofy * 1.6)) f.t = 40;
      }
    }
    // swallow flocks drift about their quarter, and hunt round anyone standing in it (a camera high above does not count)
    for (const h of hawks) {
      const was = h.near; h.near = Math.hypot(h.hx - cx, h.hz - cz) < h.r + 50 && camH < 30;
      if (h.near && !was) h.t = 0;   // someone just walked into their quarter: come over at once
      if ((h.t -= dt) <= 0) { h.t = 6 + R() * 10; const k = h.near ? 0.85 : 0; h.cx = lerp(h.hx, cx, k) + (R() - 0.5) * h.r * (h.near ? 0.5 : 0.8); h.cz = lerp(h.hz, cz, k) + (R() - 0.5) * h.r * (h.near ? 0.5 : 0.8); }
    }

    gullsDown = 0;
    for (let i = 0; i < n; i++) {
      const s = sp[i], k = st[i];
      if (s === GU && (k === ST.GROUND || k === ST.WATER || (k === ST.FLIGHT && nxt[i] !== ST.SOAR))) gullsDown++;
      // everything airborne moves every frame; thinking thins out with distance
      if (k === ST.FLIGHT) moveFlight(i, dt, t); else if (k === ST.HAWK) moveHawk(i, dt); else if (k === ST.SOAR) moveSoar(i, dt); else if (k === ST.HOVER) moveHover(i, dt, t);
      const d2 = (px[i] - cx) ** 2 + (pz[i] - cz) ** 2, tier = d2 < 6400 ? 1 : d2 < 90000 ? 2 : 4;
      if (tier > 1 && (frame + i) % tier) continue;
      const d = lastT[i] < 0 ? dt : Math.min(0.3, t - lastT[i]); lastT[i] = t; if (d <= 0) continue;
      const k2 = st[i];
      if (k2 === ST.GROUND) { if (s === GU) thinkGull(i, d); else thinkGround(i, d, t); }
      else if (k2 === ST.WATER) thinkGull(i, d);
      else if (k2 === ST.PERCH) thinkPerch(i, d);
      else if (k2 === ST.HAWK) thinkHawk(i, d);
      else if (k2 === ST.SOAR) thinkSoar(i, d);
      else if (k2 === ST.HOVER) thinkHover(i, d);
      // the camera walks into a standing gull
      if (s === GU && k2 === ST.GROUND && low && d2 < (FLEE[GU] * wary[i]) ** 2 && cy - py[i] < 8) takeOffGull(i, R() * 0.2);
      else if (s === GU && k2 === ST.GROUND && people && d2 < 3600 && ((frame + i) & 15) === 0) { for (const p of people.listen(px[i], pz[i], 1.4)) if (p.walking) { takeOffGull(i, 0); break; } }
    }

    // ---------- voices ----------
    if ((gullCallT -= dt) <= 0) {
      _near.length = 0; for (let q = 0; q < gullIdx.length; q++) { const i = gullIdx[q]; if ((px[i] - cx) ** 2 + (pz[i] - cz) ** 2 + (py[i] - cy) ** 2 < 40000) _near.push(i); }
      gullCallT = _near.length ? 5 + R() * 12 : 3;
      if (_near.length) {
        const fly = _near.filter(i => st[i] !== ST.GROUND && st[i] !== ST.WATER), pool = fly.length && (R() < 0.75 || fly.length === _near.length) ? fly : _near, i = pool[Math.floor(R() * pool.length)];
        if (st[i] === ST.GROUND && act[i] === A.IDLE) { act[i] = A.CALL; tB[i] = 0; } else callT[i] = 0.8;
        say('gull', px[i], py[i], pz[i], { flying: st[i] !== ST.GROUND && st[i] !== ST.WATER });
      }
    }
    if ((cooT -= dt) <= 0) { cooT = 5 + R() * 9; const f = flocks.find(f => f.s === PG && f.state !== 'air' && (f.cx - cx) ** 2 + (f.cz - cz) ** 2 < 900); if (f) { const i = f.m[Math.floor(R() * f.m.length)]; say('coo', px[i], py[i], pz[i], { n: f.m.length }); } }
    if ((chirpT -= dt) <= 0) { chirpT = 2 + R() * 5; const f = flocks.find(f => f.s === SP && f.state !== 'air' && (f.cx - cx) ** 2 + (f.cz - cz) ** 2 < 900); if (f) say('chirp', f.cx, f.gy + 0.1, f.cz, { n: f.m.length }); }
    if ((swallowT -= dt) <= 0) {
      swallowT = 0.5;
      let c = 0, sx = 0, sy = 0, sz = 0; for (let i = 0; i < n; i++) if (sp[i] === SW && (px[i] - cx) ** 2 + (py[i] - cy) ** 2 + (pz[i] - cz) ** 2 < 400) { c++; sx += px[i]; sy += py[i]; sz += pz[i]; }
      if (c) { swallowT = 2 + R() * 3; say('swallow', sx / c, sy / c, sz / c, { n: c }); }
    }

    pack(cam, dt, t);
    updMs[updK++ % 120] = perf.now() - T0;
  }

  function pack(cam, dt, t) {
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    for (let p = 0; p < 6; p++) { const pl = _fr.planes[p]; PLN[p * 4] = pl.normal.x; PLN[p * 4 + 1] = pl.normal.y; PLN[p * 4 + 2] = pl.normal.z; PLN[p * 4 + 3] = pl.constant; }
    const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z, k10 = 1 - Math.exp(-10 * dt), k6 = 1 - Math.exp(-6 * dt), k15 = 1 - Math.exp(-15 * dt);
    const [P0, P1, P2, P3, P4] = AA;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const s = sp[i], d2 = (px[i] - cx) ** 2 + (py[i] - cy) ** 2 + (pz[i] - cz) ** 2;
      if (d2 > CULL[s] * CULL[s]) continue;
      const d = Math.sqrt(d2), sc = scl[i] * (d > 12 ? 1 + Math.min(1, (d - 12) / 70) * BOOST[s] : 1), r = RAD[s] * sc;   // far away: larger, so a speck still reads
      let vis = true; for (let p = 0; p < 24; p += 4) if (PLN[p] * px[i] + PLN[p + 1] * py[i] + PLN[p + 2] * pz[i] + PLN[p + 3] < -r) { vis = false; break; }
      if (!vis) continue;
      // the pose eases toward what the thinking asked for
      amp[i] += (ampT[i] - amp[i]) * k10; swp[i] += (swpT[i] - swp[i]) * k10; dih[i] += (dihT[i] - dih[i]) * k6; tail[i] += (tailT[i] - tail[i]) * k6;
      fold[i] += (foldT[i] - fold[i]) * (foldT[i] > fold[i] ? k6 : k15); legO[i] += (legOT[i] - legO[i]) * k6;
      hp[i] += (hpT[i] - hp[i]) * k10; hy[i] += (hyT[i] - hy[i]) * k6; bob[i] += (bobT[i] - bob[i]) * k15;
      if (st[i] === ST.GROUND || st[i] === ST.PERCH) pit[i] += (pitT[i] - pit[i]) * k10;
      ph[i] = (ph[i] + om[i] * dt) % TAU;
      let y = py[i], pt = pit[i], bk = bnk[i], hpp = hp[i];
      if (st[i] === ST.WATER) { const w = vari[i] * 20; y = SEA + 0.045 + 0.03 * Math.sin(t * 1.9 + w) + 0.015 * Math.sin(t * 3.1 + w * 1.7); pt = 0.06 * Math.sin(t * 1.9 + w + 1.2); bk = 0.05 * Math.sin(t * 1.4 + w); }
      if (callT[i] > 0) { callT[i] -= dt; hpp -= 0.5 * Math.sin(Math.PI * Math.min(1, callT[i] / 0.8)); }
      const o = c * 4;
      P0[o] = px[i]; P0[o + 1] = y; P0[o + 2] = pz[i]; P0[o + 3] = yaw[i];
      P1[o] = pt; P1[o + 1] = bk; P1[o + 2] = sc; P1[o + 3] = s + vari[i] * 0.99;
      P2[o] = ph[i]; P2[o + 1] = amp[i]; P2[o + 2] = swp[i]; P2[o + 3] = clamp(fold[i], 0, 1);
      P3[o] = hpp; P3[o + 1] = hy[i]; P3[o + 2] = bob[i]; P3[o + 3] = legP[i] % TAU;
      P4[o] = clamp(legO[i], 0, 1); P4[o + 1] = tail[i]; P4[o + 2] = legA[i]; P4[o + 3] = dih[i];
      c++;
    }
    mesh.count = c; mesh.visible = c > 0; drawn = c;
    if (c) for (const at of AT) { at.clearUpdateRanges(); at.addUpdateRange(0, c * 4); at.needsUpdate = true; }
  }

  const buildMs = perf.now() - tBuild;
  return {
    group, update,
    debug() {
      const bySp = {}, bySt = {}, stN = Object.keys(ST);
      for (let i = 0; i < n; i++) { bySp[SPN[sp[i]]] = (bySp[SPN[sp[i]]] || 0) + 1; const k = SPN[sp[i]] + ':' + stN[st[i]]; bySt[k] = (bySt[k] || 0) + 1; }
      let avg = 0, mx = 0; const nn = Math.min(updK, 120); for (let k = 0; k < nn; k++) { avg += updMs[k]; mx = Math.max(mx, updMs[k]); }
      let low = 0, inside = 0; for (let i = 0; i < n; i++) { if (st[i] === ST.HAWK && py[i] < floorAt(px[i], pz[i]) - 0.5) low++; if ((st[i] === ST.GROUND) && world.blocked(px[i], pz[i])) inside++; }
      return { birds: n, bySpecies: bySp, byState: bySt, drawn, trisPerBird, swallowsBelowFloor: low, groundBirdsInColliders: inside, flocks: flocks.length, perchSites: sites.length, heights: !!hm, gullStands: stands.length, flushes, events: { ...ev },
        updateMsAvg: +(avg / Math.max(1, nn)).toFixed(3), updateMsMax: +mx.toFixed(3), buildMs: Math.round(buildMs) };
    },
    // for tests and screenshots
    flocks: () => flocks.map(f => ({ id: f.id, s: SPN[f.s], n: f.m.length, state: f.state, x: +f.cx.toFixed(1), y: +f.gy.toFixed(2), z: +f.cz.toFixed(1) })),
    birds: (s, state) => { const out = []; for (let i = 0; i < n; i++) if ((s === undefined || SPN[sp[i]] === s) && (state === undefined || Object.keys(ST)[st[i]] === state)) out.push({ i, x: +px[i].toFixed(2), y: +py[i].toFixed(2), z: +pz[i].toFixed(2), yaw: +yaw[i].toFixed(2), st: Object.keys(ST)[st[i]] }); return out; },
    top: (x, z, y) => topAt(x, z, y), crown: (x, z) => crownAt(x, z),   // what a flight over (x, z) at height y must clear; a tree's crown there
    tame(on = true) { tame = on; }, freeze(on = true) { frozen = on; tFrozen = lastTime; },
    // the camera `dist` m from bird i, `side` degrees round from behind it, `up` m above it, looking at it
    look(i, dist = 3, side = 30, up = 0.5) { const a = yaw[i] + Math.PI + side * Math.PI / 180, x = px[i] + Math.sin(a) * dist, z = pz[i] + Math.cos(a) * dist, y = Math.max(py[i] + up, world.groundHeight(x, z) + 0.52);   /* (a flying camera keeps 0.5 m off the ground) */ if (window.__setView) window.__setView(x, y, z, Math.atan2(-(px[i] - x), -(pz[i] - z)) * 180 / Math.PI, Math.atan2(py[i] - y, Math.hypot(px[i] - x, pz[i] - z)) * 180 / Math.PI); return [x, y, z]; },
    flushNear(x, z) { let best = null, bd = 1e9; for (const f of flocks) { const d = Math.hypot(f.cx - x, f.cz - z); if (f.state !== 'air' && d < bd) { bd = d; best = f; } } return best ? flush(best, x, z) : false; },
  };
}
