// Life: hearths — the signs of households at work, seen from the streets and from above.
// Greek houses had no chimneys: the smoke of the kitchen hearth found its way out through a gap in the roof tiles (a raised
// tile, the opaion) or rose from the courtyard, and on baking days the domed clay oven in the yard puffed from its mouth.
// So a hundred-odd houses send up a thin blue-grey wisp that leans and spreads down-wind (ctx.wind) and fades 8–20 m up,
// the lit yard ovens thicker puffs, the town's bakeries a steady grey plume, and from the air the town wears a light haze.
// All of it is one Points draw whose puffs are placed by the vertex shader from static attributes and the clock (no work
// on the CPU per frame); the same draw carries the warm additive glows at the fires, faded out away from the camera.
// Fires: the mouths of the lit ovens glow with embers and small tongues of flame, and along the quay's seaward edge sailors
// cook at open fires with a cauldron on a tripod (one unlit merged mesh for the flames and embers, flickering in its
// vertex shader; one lit merged mesh for the stones, wood and pots).
// Laundry: the washing residential.js hangs on the lines in the yards and on the roof terraces is taken over (its static
// mesh hidden, the same pieces redrawn as one InstancedMesh) and swings and billows in the wind, casting moving shadows.
// Events (ctx.emit): 'fire' {kind: 'oven'|'cookfire', d} for the fires near the camera, twice a second;
//                    'flap' {strength} when a gust catches washing near the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ColorBucket, box, lathe, ellipsoid, mat, rng, clamp, lerp, smoothstep, TAU, makeNoise2D } from '../util.js';
import { flats } from '../terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// the same travelling gust field as ctx.wind.gust (src/life/index.js), for the shaders
const GUST_GLSL = `uniform vec3 uWind; uniform float uTime;
float gust(vec2 p, float t) {
  float u = dot(p, uWind.xy) - t * uWind.z * 1.6, v = p.x * uWind.y - p.y * uWind.x;
  return 1.0 + 0.35 * sin(u * 0.021 + sin(v * 0.013) * 1.7) + 0.25 * sin(u * 0.067 + v * 0.021 + t * 0.3);
}`;

// ---------- a soft, ragged puff (alpha only; the colour comes from the shader) ----------
function wispTexture() {
  const S = 64, N = makeNoise2D(77), a = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S - 0.5, v = (y + 0.5) / S - 0.5, d = Math.hypot(u, v) * 2, n = N.fbm(u * 4.5 + 3, v * 4.5 + 1, 4) * 0.5 + 0.5;
    const al = clamp((1 - d) * 1.25 + (n - 0.5) * 1.2, 0, 1) * smoothstep(1, 0.75, d), i = (y * S + x) * 4;
    a[i] = a[i + 1] = a[i + 2] = 255; a[i + 3] = al * 255;
  }
  const t = new THREE.DataTexture(a, S, S, THREE.RGBAFormat);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  return t;
}

export async function build(ctx) {
  const { M, world, layout: L, scene } = ctx, W = ctx.wind;
  const R = rng(4417);
  const G = new THREE.Group(); G.name = 'hearths';
  const uTime = { value: 0 }, uWind = { value: V(W.dx, W.dz, W.speed) };
  const gy = (x, z) => world.groundHeight(x, z);

  // ---------- where the fires burn ----------
  // plumes: {x, y, z, n, H (rise, m), life (s), size (m), alpha, tone (0 blue-grey wisp .. 1 pale thick puffs), drift (m down-wind at the top)}
  const plumes = [], glows = [], fires = [];
  const plume = (x, y, z, o) => plumes.push({ x, y, z, n: 24, H: 12, life: 16, size: 1, alpha: 0.3, tone: 0, drift: 10, seed: R(), ...o });
  const yardOf = new Map(); for (const a of L.areas) if (a.name === 'yard' && a.house !== undefined) yardOf.set(a.house, a);
  const stats = { roof: 0, yard: 0, bakery: 0, ovens: 0, ovensLit: 0, cookfires: 0, laundry: 0, balconies: 0, emitted: { fire: 0, flap: 0 } };

  // the smoke hole: a raised tile near the ridge, over the back half of the house (the kitchen side, away from the street door)
  // (the roofs are citykit's: pitch 0.3, eaves 0.45 m out; a hip roof's ridge runs |w - d| long, a gable's the whole length)
  function roofHole(h, Rh) {
    const sg = h.ry === 0 ? 1 : -1, alongX = h.w >= h.d, lo = Math.max(h.w, h.d), sh = Math.min(h.w, h.d);
    const ridgeH = h.gable ? (sh / 2 + 0.45) * 0.3 + 0.14 : 0.1 + (sh / 2 + 0.45) * 0.3, ridgeLen = h.gable ? lo - 1 : Math.max(0, lo - sh);
    const v = 0.3 + Rh() * 0.5, u = (Rh() - 0.5) * ridgeLen * 0.6;                // v: down the slope from the ridge, u: along it
    // ridge along x: the hole on the slope facing away from the street door (local +z); ridge along z: toward the back end
    const x = alongX ? h.x + u : h.x + (Rh() < 0.5 ? v : -v), z = alongX ? h.z - sg * v : h.z - sg * Math.abs(u);
    return [x, h.y + h.h + ridgeH - v * 0.3 + 0.04, z];
  }
  // households: one house in ten has the hearth going, a bakery's oven all day
  const bakeries = new Set(L.pois.filter(p => p.type === 'stall' && p.note === 'bakery' && p.house !== undefined).map(p => p.house));
  for (const h of L.houses) {
    const Rh = rng(h.id * 7919 + 13), bake = bakeries.has(h.id), p = Rh();
    if (!bake && p > 0.1) continue;
    const yd = yardOf.get(h.id);
    if (!bake && yd && Rh() < 0.4) {       // a cooking fire in the courtyard
      const x = lerp(yd.minX + 0.9, yd.maxX - 0.9, Rh()), z = lerp(yd.minZ + 0.9, yd.maxZ - 0.9, Rh());
      if (yd.maxX - yd.minX > 2 && yd.maxZ - yd.minZ > 2) { plume(x, gy(x, z) + 0.5, z, { H: 10 + Rh() * 6, size: 1.0 + Rh() * 0.3, alpha: 0.42 + Rh() * 0.12, life: 14 + Rh() * 4, drift: 12 + Rh() * 6, seed: Rh() }); stats.yard++; continue; }
    }
    const [x, y, z] = roofHole(h, Rh);
    if (bake) { plume(x, y, z, { n: 28, H: 16 + Rh() * 4, size: 1.5, alpha: 0.6, tone: 0.7, life: 18, drift: 20, seed: Rh() }); stats.bakery++; }
    else { plume(x, y, z, { H: 9 + Rh() * 7, size: 0.9 + Rh() * 0.4, alpha: 0.38 + Rh() * 0.14, life: 13 + Rh() * 6, drift: 14 + Rh() * 8, seed: Rh() }); stats.roof++; }
  }

  // ---------- fire geometry: flames and embers (unlit, flickering) and what stands round them (lit) ----------
  const flameParts = [], props = new ColorBucket();
  // a geometry with a colour ramp over its height (y0..y1) and the flicker attribute aFl = (phase, height above the fire's floor)
  const hot = (g, m, y0, y1, c0, c1, ph, lift = 0) => {
    g = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    const p = g.attributes.position, col = new Float32Array(p.count * 3), fl = new Float32Array(p.count * 2), a = new THREE.Color(c0[0], c0[1], c0[2]), b = new THREE.Color(c1[0], c1[1], c1[2]), k = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const t = clamp((p.getY(i) - y0) / (y1 - y0), 0, 1); k.copy(a).lerp(b, t); col.set([k.r, k.g, k.b], i * 3); fl[i * 2] = ph; fl[i * 2 + 1] = Math.max(0, p.getY(i) - y0) + lift; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aFl', new THREE.BufferAttribute(fl, 2)); g.applyMatrix4(m);
    flameParts.push(g);
  };
  const EMB0 = [3.2, 1.25, 0.3], EMB1 = [0.3, 0.05, 0.01], ROOT = [3.4, 2.5, 1.0], TIP = [1.6, 0.34, 0.05];
  function tongues(x, y, z, s, n, Rf) {
    for (let k = 0; k < n; k++) {
      const core = k < 2, a = k * 2.4 + Rf() * 0.5, d = core ? 0.05 * s : (0.14 + Rf() * 0.16) * s, h = (core ? 0.9 + Rf() * 0.4 : 0.4 + Rf() * 0.45) * s, r = (core ? 0.12 : 0.06 + Rf() * 0.05) * s;
      hot(new THREE.ConeGeometry(r, h, 5, 2).translate(0, h / 2, 0), mat(x + Math.cos(a) * d, y, z + Math.sin(a) * d, Math.sin(a) * (core ? 0.05 : 0.2), 0, -Math.cos(a) * (core ? 0.05 : 0.2)), 0, h, ROOT, TIP, Rf() * TAU);
    }
  }

  // ---------- the yard ovens (residential.js lists them in L.ovens): a third of them are lit today ----------
  const MOUTH = new THREE.CircleGeometry(0.2, 8, 0, Math.PI).scale(1, 1.12, 1);
  for (const ov of L.ovens || []) {
    stats.ovens++;
    const Ro = rng(Math.round(ov.x * 131 + ov.z * 977) >>> 0);
    if (Ro() > 0.4 || ov.covered) continue;      // (not one under the lean-to along the house wall: its smoke would rise through the roof)
    const fx = Math.sin(ov.ry), fz = Math.cos(ov.ry), g = ov.y - 0.03, ph = Ro() * TAU;
    // embers glowing in the mouth (a hair in front of its dark disc), a few low tongues licking out at its sill
    hot(MOUTH.clone(), mat(ov.x + fx * 0.812, g, ov.z + fz * 0.812, 0, ov.ry, 0), 0, 0.22, EMB0, EMB1, ph, 0.05);
    tongues(ov.x + fx * 0.84, g + 0.005, ov.z + fz * 0.84, 0.28, 3, Ro);
    glows.push({ x: ov.x + fx * 1.0, y: g + 0.18, z: ov.z + fz * 1.0, size: 1.3, alpha: 0.55, seed: ph });
    // smoke: thick puffs rolling out of the top of the mouth and up the dome's face
    plume(ov.x + fx * 0.9, g + 0.45, ov.z + fz * 0.9, { n: 20, H: 9 + Ro() * 4, size: 1.2 + Ro() * 0.3, alpha: 0.6, tone: 0.8, life: 11 + Ro() * 3, drift: 11, seed: Ro() });
    fires.push({ x: ov.x + fx, y: g + 0.2, z: ov.z + fz, kind: 'oven' });
    stats.ovensLit++;
  }

  // ---------- sailors' cooking fires on the quay's seaward band, in the gaps between the cargo and the bollards ----------
  {
    const Q = flats[2].level + 0.06, Rq = rng(55), seats = L.pois.filter(p => p.type === 'seat' && Math.abs(p.z - 449.25) < 0.5);
    const clearAt = (x, z) => { for (let dx = -1.0; dx <= 1.0; dx += 0.25) for (let dz = -0.8; dz <= 0.8; dz += 0.2) if (world.blocked(x + dx, z + dz)) return false; return Math.abs(gy(x, z) - Q) < 0.05; };
    const took = [];
    for (const x0 of [-150, -88, -26, 36, 98, 180]) {      // beside the merchantmen's berths (and one off the east end)
      let best = null;
      for (let d = 0; d < 20 && best === null; d += 0.5) for (const s of [1, -1]) {
        const x = x0 + s * (4 + d), z = 448.25;
        if (best === null && Math.abs(((x + 230) % 24 + 24) % 24) > 1.6 && Math.abs(((x + 230) % 24 + 24) % 24) < 22.4 && clearAt(x, z) && !seats.some(p => Math.abs(p.x - x) < 1.3) && took.every(t => Math.abs(t - x) > 30)) best = x;
      }
      if (best === null || took.length >= 4) continue;
      took.push(best);
      const x = best, z = 448.25, y = Q;
      // ash on the paving, a ring of stones, embers and flames, a tripod with a cauldron over them
      props.add(new THREE.CircleGeometry(0.62, 12).rotateX(-Math.PI / 2), mat(x, y + 0.012, z), 0x3b3734);
      for (let k = 0; k < 8; k++) { const a = k * TAU / 8 + Rq() * 0.3, r = 0.5 + Rq() * 0.06; props.add(ellipsoid(0.13 + Rq() * 0.05, 0.1 + Rq() * 0.04, 0.11, 6, 4), mat(x + Math.cos(a) * r, y + 0.05, z + Math.sin(a) * r, 0, Rq() * 3, 0), Rq() < 0.5 ? 0x8a8276 : 0x77706a); }
      hot(ellipsoid(0.34, 0.08, 0.34, 8, 4), mat(x, y + 0.03, z), -0.08, 0.08, EMB0, EMB1, Rq() * TAU);
      tongues(x, y + 0.05, z, 0.55, 7, Rq);
      const top = y + 1.45, ty = Rq() * TAU;
      for (let k = 0; k < 3; k++) { const a = ty + k * TAU / 3, fx0 = x + Math.cos(a) * 0.85, fz0 = z + Math.sin(a) * 0.85, a0 = V(fx0, y, fz0), a1 = V(x, top + 0.12, z), L0 = a0.distanceTo(a1);
        const g = new THREE.CylinderGeometry(0.025, 0.035, L0, 5, 1, true); g.applyMatrix4(new THREE.Matrix4().compose(a0.clone().add(a1).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), a1.clone().sub(a0).normalize()), V(1, 1, 1))); props.add(g, null, 0x3a2c20); }
      props.add(box(0.012, top - (y + 0.95), 0.012), mat(x, (top + y + 0.95) / 2, z), 0x3a3430);
      props.add(lathe([[0.001, 0.0], [0.16, 0.02], [0.26, 0.12], [0.28, 0.26], [0.25, 0.34], [0.27, 0.36], [0.23, 0.35], [0.001, 0.3]], 12), mat(x, y + 0.6, z), 0x3c3129);
      props.add(new THREE.TorusGeometry(0.2, 0.012, 4, 10), mat(x, y + 0.97, z, 0, 0, Math.PI / 2), 0x3a3430);
      // firewood, a basket of bread, bowls and a jug set down on the paving
      for (let k = 0; k < 3; k++) props.add(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 5).rotateZ(Math.PI / 2), mat(x - 1.35 + k * 0.02, y + 0.05 + (k === 2 ? 0.09 : 0), z - 0.35 + k * 0.1 + (k === 2 ? 0.05 : 0), 0, 0.3 + Rq() * 0.3, 0), 0x5a4432);
      props.add(new THREE.CylinderGeometry(0.22, 0.17, 0.2, 8, 1, true), mat(x + 1.2, y + 0.1, z - 0.45), 0xa88a58); props.add(ellipsoid(0.18, 0.07, 0.18, 8, 4), mat(x + 1.2, y + 0.19, z - 0.45), 0xa0703a);
      for (let k = 0; k < 3; k++) props.add(lathe([[0.001, 0], [0.05, 0], [0.1, 0.04], [0.11, 0.06]], 8), mat(x + 0.75 + k * 0.28, y, z + 0.62 + (k % 2) * 0.1), 0x8e5a3c);
      props.add(lathe([[0.001, 0], [0.07, 0], [0.1, 0.06], [0.1, 0.16], [0.06, 0.25], [0.04, 0.3], [0.05, 0.32]], 8), mat(x - 0.9, y, z + 0.5), 0xa0603c);
      glows.push({ x, y: y + 0.35, z, size: 3.2, alpha: 0.6, seed: Rq() * TAU });
      plume(x, y + 0.9, z, { n: 18, H: 10, size: 0.9, alpha: 0.75, tone: 0.45, life: 12, drift: 9, seed: Rq() });
      world.colliders.push({ minX: x - 0.95, maxX: x + 0.95, minZ: z - 0.8, maxZ: z + 0.8 });
      fires.push({ x, y: y + 0.3, z, kind: 'cookfire' });
      stats.cookfires++;
    }
  }

  // ---------- the smoke and the glows: one point cloud, placed in the vertex shader ----------
  const NP = plumes.reduce((a, p) => a + p.n, 0) + glows.length;
  const pos = new Float32Array(NP * 3), aP = new Float32Array(NP * 4), aQ = new Float32Array(NP * 4), aS = new Float32Array(NP * 2);
  {
    let k = 0;
    for (const p of plumes) for (let i = 0; i < p.n; i++, k++) {
      pos.set([p.x, p.y, p.z], k * 3);
      aP.set([(i + R() * 0.35) / p.n, R() * TAU, p.tone, p.seed * 100], k * 4);        // start phase, spin, tone, plume seed
      aQ.set([p.H, p.life, p.size, p.alpha], k * 4);
      aS.set([p.drift, R()], k * 2);
    }
    for (const g of glows) { pos.set([g.x, g.y, g.z], k * 3); aP.set([0, 0, -1, g.seed], k * 4); aQ.set([g.size, 0, 0, g.alpha], k * 4); k++; }
  }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pgeo.setAttribute('aP', new THREE.BufferAttribute(aP, 4)); pgeo.setAttribute('aQ', new THREE.BufferAttribute(aQ, 4)); pgeo.setAttribute('aS', new THREE.BufferAttribute(aS, 2));
  const smat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      scale: { value: 500 }, map: { value: null }, sunDir: { value: (ctx.sunDir || V(0.5, 0.6, 0.4)).clone().normalize() },
      youngA: { value: new THREE.Color().setRGB(0.5, 0.55, 0.64) }, oldA: { value: new THREE.Color().setRGB(0.74, 0.77, 0.83) },   // (linear) thin wood smoke: blue-grey, paling as it spreads
      youngB: { value: new THREE.Color().setRGB(0.56, 0.55, 0.54) }, oldB: { value: new THREE.Color().setRGB(0.8, 0.8, 0.8) },      // an oven's or a bakery's thicker puffs
      glow: { value: new THREE.Color(0xff7a28) } }]),
    vertexShader: `${GUST_GLSL}
attribute vec4 aP; attribute vec4 aQ; attribute vec2 aS; uniform float scale; uniform vec3 sunDir;
varying float vA; varying float vAge; varying float vSpin; varying float vAsp; varying float vTone; varying float vLit;
#include <fog_pars_vertex>
void main() {
  vec3 p = position; float size, a;
  if (aP.z < 0.0) {        // a fire's glow: pulled a little toward the eye so the oven's own clay does not cut it, gone beyond ~70 m
    vec4 mv = modelViewMatrix * vec4(p, 1.0); float d = -mv.z; mv.xyz += normalize(-mv.xyz) * min(0.35, d * 0.5);
    gl_Position = projectionMatrix * mv;
    float f = 0.78 + 0.14 * sin(uTime * 8.7 + aP.w) * sin(uTime * 5.1 + aP.w * 1.9) + 0.08 * sin(uTime * 21.3 + aP.w * 3.3);
    a = aQ.w * f * (1.0 - smoothstep(45.0, 70.0, d)); size = aQ.x * (0.92 + 0.08 * f);
    gl_PointSize = a > 0.002 ? size * scale / max(0.3, d) : 0.0;
    vA = a; vAge = -1.0; vSpin = 0.0; vAsp = 1.0; vTone = 0.0; vLit = 1.0; vec4 mvPosition = mv;
    #include <fog_vertex>
    return;
  }
  // a puff: rises quickly off the fire and slows as it cools, leaning down-wind under the gust it met on the way up, meandering
  float life = aQ.y, t = fract(aP.x + uTime / life), age = t * life;
  float g = gust(p.xz, uTime - age * 0.5), H = aQ.x;
  float h = H * (1.25 * t - 0.25 * t * t);
  float dr = aS.x * g * pow(t, 1.4);
  vec2 wd = uWind.xy, cw = vec2(-wd.y, wd.x);
  // the meander follows the time the puff left the fire, so neighbouring puffs keep together and the plume waves as a whole
  float te = uTime - age, sd = aP.w;
  float m = sin(sd + te * 0.45) * (0.1 + 1.4 * t) + sin(sd * 1.7 + te * 1.3) * 0.35 * t + (aS.y - 0.5) * 0.4 * t;
  p += vec3(wd.x * dr + cw.x * m, h + sin(sd * 2.3 + te * 0.8) * 0.4 * t, wd.y * dr + cw.y * m);
  size = aQ.z * (0.9 + 3.8 * t) * (1.0 + 0.25 * aP.z * t);
  a = aQ.w * pow(1.0 - t, 0.75) * smoothstep(0.0, 0.045, t);
  // the fire is fed and flares: the smoke comes in puffs (strongly from an oven, a little from a hearth)
  float fed = 0.5 + 0.5 * sin(te * (0.9 + fract(sd * 0.37) * 0.8) + sd);
  a *= mix(1.0, 0.45 + 0.9 * fed * fed, 0.35 + 0.65 * aP.z); size *= mix(1.0, 0.8 + 0.35 * fed, aP.z);
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0); float d = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  // seen from afar the puffs merge: they grow with the distance (a plume becomes a soft column, the town a haze) and thin out
  // (the young puffs grow less than the old, so from the air a plume reads as a streak drifting down-wind, not a blob at the roof)
  float far = clamp((d - 60.0) / 220.0, 0.0, 3.0); size *= 1.0 + far * (0.3 + 0.9 * t); a *= (1.0 + 0.4 * far * t) / (1.0 + 0.55 * far);
  float ps = size * scale / max(0.5, d);
  if (ps < 1.5) { a *= ps * ps / 2.25; ps = 1.5; }          // a far plume thins to a haze instead of flickering in and out
  a *= 1.0 - smoothstep(1600.0, 2400.0, d);
  gl_PointSize = a > 0.002 ? ps : 0.0;
  vA = a; vAge = t; vSpin = aP.y + uTime * 0.12 * (aS.y - 0.5); vAsp = 1.0 + 0.9 * (1.0 - t) * (1.0 - t); vTone = aP.z;
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz; vLit = 1.0 + 0.3 * pow(max(0.0, dot(normalize(wp - cameraPosition), sunDir)), 5.0);   // bright where the sun shines through it
  #include <fog_vertex>
}`,
    fragmentShader: `uniform sampler2D map; uniform vec3 youngA; uniform vec3 oldA; uniform vec3 youngB; uniform vec3 oldB; uniform vec3 glow;
varying float vA; varying float vAge; varying float vSpin; varying float vAsp; varying float vTone; varying float vLit;
#include <fog_pars_fragment>
void main() {
  vec2 q = gl_PointCoord - 0.5;
  if (vAge < 0.0) { float r = length(q) * 2.0, a = pow(max(0.0, 1.0 - r), 2.4) * vA; gl_FragColor = vec4(glow * a, 0.0); return; }   // additive (alpha 0 under premultiplied blending)
  q.x *= vAsp;                              // a young puff is a narrow streak, an old one a round drift
  float c = cos(vSpin), s = sin(vSpin); q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float a = texture2D(map, q + 0.5).a * vA; if (a < 0.003) discard;
  gl_FragColor = vec4(mix(mix(youngA, oldA, vAge), mix(youngB, oldB, vAge), vTone) * vLit, 1.0);
  #include <fog_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a);
}`,
    transparent: true, depthWrite: false, fog: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  smat.uniforms.map.value = wispTexture(); smat.uniforms.uTime = uTime; smat.uniforms.uWind = uWind;
  const cloud = new THREE.Points(pgeo, smat); cloud.name = 'hearth-smoke'; cloud.frustumCulled = false; cloud.renderOrder = 3; cloud.userData.noAO = true;
  const vs = new THREE.Vector2(); cloud.onBeforeRender = (r, sc, cam) => { r.getDrawingBufferSize(vs); smat.uniforms.scale.value = vs.y * 0.5 * cam.projectionMatrix.elements[5]; };
  G.add(cloud);

  // ---------- the flames' mesh: unlit, each tongue leaping, swaying down-wind and flickering on its own ----------
  let flameMesh = null;
  if (flameParts.length) {
    const fm = new THREE.MeshBasicMaterial({ vertexColors: true });
    fm.onBeforeCompile = sh => {
      sh.uniforms.uTime = uTime; sh.uniforms.uWind = uWind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>\nattribute vec2 aFl; uniform float uTime; uniform vec3 uWind;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  float fk = 0.84 + 0.12 * sin(uTime * 9.1 + aFl.x) * sin(uTime * 5.3 + aFl.x * 1.7) + 0.07 * sin(uTime * 23.7 + aFl.x * 3.1);
  float hh = aFl.y;
  transformed.y += hh * (fk - 0.84) * 1.5;
  transformed.xz += uWind.xy * hh * hh * 0.5 + vec2(sin(uTime * 7.3 + aFl.x * 2.0), cos(uTime * 6.1 + aFl.x)) * hh * 0.07;
  #ifdef USE_COLOR
  vColor.rgb *= fk + hh * 0.2;
  #endif`);
    };
    fm.customProgramCacheKey = () => 'hearths-flame';
    flameMesh = new THREE.Mesh(mergeGeometries(flameParts, false), fm);
    flameMesh.name = 'hearth-flames'; flameMesh.castShadow = false; flameMesh.receiveShadow = false; flameMesh.frustumCulled = false; flameMesh.userData.noAO = true;
    G.add(flameMesh);
  }
  { const m = props.mesh(M.painted, true); if (m) { m.name = 'hearth-props'; G.add(m); } }

  // ---------- laundry: residential.js's washing, blown about, and more hung over the balcony rails above the street ----------
  const wash = (L.laundry || []).slice();
  {
    const CLOTH = [0xd9ccb0, 0xe0d6c2, 0xc99a3a, 0xa2432e, 0x4a5f86, 0x7d7a4a, 0xb87a3a, 0x6a3f5c, 0xcdbf9c, 0x8e5a3c, 0xd4c7a8];   // (residential.js's: undyed, madder, weld, woad, ...)
    const Rb = rng(3301), wash0 = new THREE.Color(0xb8b0a0);
    for (const b of L.balconies || []) {
      if (b.draped || Rb() > 0.55) continue;        // (a cloth already over the rail, or nothing out today)
      const L0 = Math.hypot(b.x1 - b.x0, b.z1 - b.z0), n = L0 > 2.2 && Rb() < 0.5 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const w = Math.min(0.45 + Rb() * 0.5, L0 / n - 0.1), t = (k + 0.5) / n + (Rb() - 0.5) * 0.1, h = 0.45 + Rb() * 0.4;
        const col = new THREE.Color(CLOTH[Math.floor(Rb() * CLOTH.length)]).lerp(wash0, 0.28).multiplyScalar(2.6);
        wash.push({ x: lerp(b.x0, b.x1, t) + b.nx * 0.09, y: b.y + 0.01, z: lerp(b.z0, b.z1, t) + b.nz * 0.09, ry: b.ry, rx: 0, rz: (Rb() - 0.5) * 0.04, w, h, fold: Math.floor(Rb() * 3), col, rail: true });
      }
      stats.balconies++;
    }
  }
  let washMesh = null, washGrid = null, washG = null;
  if (wash.length) {
    const n = wash.length;
    const geo = new THREE.PlaneGeometry(1, 1, 6, 5).translate(0, -0.5, 0);           // hangs from its top edge: y 0 .. -1
    { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i) * 4); }
    const aDim = new Float32Array(n * 4), aFold = new Float32Array(n * 4), aWnd = new Float32Array(n * 4);
    const FOLD = [[0, 0.047, 0.047, 0], [0, -0.05, 0.02, 0.02], [0, 0.05, -0.04, 0]];   // z across the width (4 columns): folded once, or twice
    const m4 = new THREE.Matrix4();
    const cmat = new THREE.MeshStandardMaterial({ map: M.cloth.map, normalMap: M.cloth.normalMap, normalScale: new THREE.Vector2(0.3, 0.3), side: THREE.DoubleSide, roughness: 1, metalness: 0, envMapIntensity: 0.08 });
    washMesh = new THREE.InstancedMesh(geo, cmat, n);
    for (let i = 0; i < n; i++) {
      const w = wash[i], Rw = rng(i * 2654435761 >>> 0);
      washMesh.setMatrixAt(i, m4.copy(mat(w.x, w.y, w.z, 0, w.ry, 0)).multiply(mat(0, 0, 0, w.rx, 0, w.rz)));
      washMesh.setColorAt(i, w.col);
      aDim.set([w.w, w.h, Rw(), w.w * w.h], i * 4); aFold.set(FOLD[w.fold] || FOLD[0], i * 4);
      // the wind across the cloth (swings it out of its plane), along the line (shakes the free corners), and how exposed it is (roof lines more than yard lines)
      // (over a balcony rail it can only swing out, away from the railing: the sign of the exposure says so)
      const nx = Math.sin(w.ry), nz = Math.cos(w.ry), exp = clamp(0.55 + (w.y - gy(w.x, w.z) - 1.8) * 0.18, 0.55, 1.0);
      aWnd.set([W.dx * nx + W.dz * nz, W.dx * nz - W.dz * nx, w.rail ? -exp : exp, Rw() * TAU], i * 4);
    }
    geo.setAttribute('aDim', new THREE.InstancedBufferAttribute(aDim, 4)); geo.setAttribute('aFold', new THREE.InstancedBufferAttribute(aFold, 4)); geo.setAttribute('aWnd', new THREE.InstancedBufferAttribute(aWnd, 4));
    const CLOTH_GLSL = `${GUST_GLSL}
attribute vec4 aDim; attribute vec4 aFold; attribute vec4 aWnd;
// the cloth at (x across -0.5..0.5, y down 0..-1) in metres in its own frame: folds, swing about the line, billow
vec3 clothAt(vec2 q, float g, float sw) {
  float w = aDim.x, h = aDim.y, d = max(-q.y, 0.0), u = clamp(q.x + 0.5, 0.0, 1.0) * 3.0;
  float fz = u < 1.0 ? mix(aFold.x, aFold.y, u) : u < 2.0 ? mix(aFold.y, aFold.z, u - 1.0) : mix(aFold.z, aFold.w, u - 2.0);
  float ph = aWnd.w, e = abs(aWnd.z) * g;
  // ripples running across the cloth and down it, strongest at the free bottom corners
  float rip = sin(q.x * 7.0 - uTime * (4.2 + aDim.z) + ph) * 0.6 + sin(q.x * 13.0 + d * 5.0 - uTime * 6.3 + ph * 2.0) * 0.4;
  float bil = e * (0.07 + 0.07 * g) * pow(d, 1.3) * rip * (0.55 + 0.45 * abs(q.x) * 2.0);
  float bulge = e * 0.08 * aWnd.x * sin(3.14159 * (q.x + 0.5)) * d;                // the wind bellies it out between the pegs
  float dz = fz * (1.0 - 0.6 * d) + bil + bulge;
  float x = q.x * w + aWnd.y * e * 0.06 * d * d + 0.015 * sin(uTime * 2.3 + ph + d * 2.0) * d * e;
  float yy = -d * h;
  // swung about the line by sw (rad): the line is the local x axis
  return vec3(x, yy * cos(sw) - dz * sin(sw), yy * sin(sw) + dz * cos(sw));
}
float clothSwing(float g) {
  float ph = aWnd.w, e = abs(aWnd.z);
  float heavy = 1.0 / (0.6 + aDim.w * 0.9);                                          // a big wet himation swings less than a cloth
  float sw = -(aWnd.x * e * (0.14 + 0.22 * g) + (0.05 + 0.07 * e * g) * sin(uTime * (1.1 + aDim.z * 0.6) + ph) + 0.03 * sin(uTime * 2.9 + ph * 1.3)) * min(1.2, heavy);
  return aWnd.z < 0.0 ? min(sw, 0.0) : sw;                                          // (sw < 0 swings the hem toward local +z)
}`;
    const patch = (m, depth) => {
      m.onBeforeCompile = sh => {
        sh.uniforms.uTime = uTime; sh.uniforms.uWind = uWind;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + CLOTH_GLSL);
        const pre = `vec3 wP = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; float cg = gust(wP.xz, uTime); float csw = clothSwing(cg);`;
        if (depth) sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `${pre}\nvec3 transformed = clothAt(position.xy, cg, csw);`);
        else sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `${pre}
  vec3 cP = clothAt(position.xy, cg, csw), cX = clothAt(position.xy - vec2(0.03, 0.0), cg, csw), cY = clothAt(position.xy - vec2(0.0, 0.03), cg, csw);
  vec3 objectNormal = normalize(cross(cP - cX, cP - cY));     // (differences taken inwards: the cloth ends at its edges)`).replace('#include <begin_vertex>', 'vec3 transformed = cP;');
      };
    };
    patch(cmat, false);
    ctx.setupMaterial(cmat); { const k = cmat.customProgramCacheKey.bind(cmat); cmat.customProgramCacheKey = () => k() + '|hearths-laundry'; }
    const dmat = new THREE.MeshDepthMaterial(); patch(dmat, true); dmat.customProgramCacheKey = () => 'hearths-laundry-depth';
    washMesh.customDepthMaterial = dmat; washMesh.castShadow = true; washMesh.receiveShadow = true; washMesh.frustumCulled = false;
    washMesh.userData.noAO = true; washMesh.name = 'hearth-laundry';
    G.add(washMesh);
    scene.traverse(o => { if (o.isMesh && o.userData.laundry === true) o.visible = false; });   // (residential.js's static copy)
    // for the flap events: the pieces in 16 m cells
    washGrid = new Map(); washG = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = Math.floor(wash[i].x / 16) * 4096 + Math.floor(wash[i].z / 16); let l = washGrid.get(k); if (!l) washGrid.set(k, l = []); l.push(i); }
    stats.laundry = n;
  }

  // ---------- per frame: the clock, and the sounds near the camera ----------
  let evT = 0, flT = 0;
  function update(dt, t, camera) {
    uTime.value = t;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    if (flameMesh) { let dm = 1e9; for (const f of fires) dm = Math.min(dm, (f.x - cx) ** 2 + (f.z - cz) ** 2); flameMesh.visible = dm < 300 * 300; }
    if ((evT -= dt) <= 0) {        // the fires within earshot, the nearest two
      evT = 0.5; let d0 = 25, d1 = 25, f0 = null, f1 = null;
      for (const f of fires) { const d = Math.hypot(f.x - cx, f.y - cy, f.z - cz); if (d < d0) { d1 = d0; f1 = f0; d0 = d; f0 = f; } else if (d < d1) { d1 = d; f1 = f; } }
      if (f0) { ctx.emit('fire', f0.x, f0.y, f0.z, { kind: f0.kind, d: d0 }); stats.emitted.fire++; }
      if (f1) { ctx.emit('fire', f1.x, f1.y, f1.z, { kind: f1.kind, d: d1 }); stats.emitted.fire++; }
    }
    if (washGrid && (flT -= dt) <= 0) {   // a gust catching the washing near the camera
      flT = 0.2;
      const ix = Math.floor(cx / 16), iz = Math.floor(cz / 16);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const l = washGrid.get((ix + a) * 4096 + iz + b); if (!l) continue;
        for (const i of l) {
          const w = wash[i], d2 = (w.x - cx) ** 2 + (w.z - cz) ** 2; if (d2 > 18 * 18) { washG[i] = 0; continue; }
          const g = W.gust(w.x, w.z, t);
          if (g > 1.28 && washG[i] <= 1.28 && washG[i] > 0) { ctx.emit('flap', w.x, w.y - w.h / 2, w.z, { strength: clamp((g - 1.1) * 2, 0, 1) * Math.min(1, w.w * w.h * 1.5) }); stats.emitted.flap++; }
          washG[i] = g;
        }
      }
    }
  }

  return {
    group: G, update, plumes, fires, laundry: wash,          // (the sources, for tests and for anyone listening)
    debug() { return { ...stats, plumes: plumes.length, points: NP, glows: glows.length, fires: fires.map(f => [f.kind, +f.x.toFixed(1), +f.z.toFixed(1)]).slice(0, 12), flameTris: flameMesh ? flameMesh.geometry.attributes.position.count / 3 : 0 }; },
  };
}
