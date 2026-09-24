// The moving air: one wind (ctx.wind — a direction and a gust field of travelling swells) over the whole land.
//
// Vegetation: the trees are merged, static geometry built elsewhere (src/environment.js, the agora, streets, civic,
// residential and outskirts features). After the build this module finds their meshes by material, gives each vertex
// aWind = (height above the ground, a random per leaf-card phase) and swaps in a copy of the material whose vertex
// shader bends it: the crown leans with the gust and swings about that lean at ~0.3 Hz (the bend grows with h^1.5,
// so trunks barely move near the ground and a 15 m cypress sways like a flame), leaf cards flutter on top of that.
// A matching depth material makes the shadows sway too. The agora's awnings and big sails billow and ripple.
//
// Airborne life near the camera: sunlit dust motes and pollen (one Points field that follows the camera and drifts
// down-wind) and butterflies (one InstancedMesh, wings flapped in the vertex shader) fluttering round the foliage.
import * as THREE from 'three';
import { rng, TAU, clamp, lerp } from '../util.js';
import { SEA } from '../terrain.js';

// ---------- the wind in GLSL: ctx.wind.gust term for term, the sway, the flutter, the cloth ----------
const H_MAX = 25.5, CLOTH_MAX = 0.1;   // aWind is two normalised bytes: x = h / H_MAX (trees) or amplitude / CLOTH_MAX (cloth)
const GLSL = `
attribute vec2 aWind;
uniform float uWT; uniform vec3 uWD; uniform vec3 uWCam;
float windGust(vec2 p, float t) {
  float u = dot(p, uWD.xy) - t * uWD.z * 1.6, v = p.x * uWD.y - p.y * uWD.x;
  return 1.0 + 0.35 * sin(u * 0.021 + sin(v * 0.013) * 1.7) + 0.25 * sin(u * 0.067 + v * 0.021 + t * 0.3);
}
// a crown leans down-wind as far as the gust pushes it and swings about that lean; the phase drifts slowly across the
// land (neighbouring trees are never in step) and lags a little up the stem, so a tall cypress bends in a soft S
vec3 windSway(vec3 P, float h, float g) {
  float ph = dot(P.xz, vec2(0.061, 0.047)) + sin(dot(P.xz, vec2(0.043, -0.057))), a = uWT * 1.9 - h * 0.06 + ph;
  float along = g * (0.5 + 0.28 * sin(a) + 0.1 * sin(a * 1.73 + 1.1)), across = g * 0.13 * sin(a * 0.81 + 2.3);
  return vec3(uWD.x * along - uWD.y * across, 0.0, uWD.y * along + uWD.x * across) * (0.004 * h * sqrt(h));
}
// leaf cards: each shivers on its own (r: per card) and twists a little (the terms in P), stronger in a gust; faded
// out with distance so far groves do not sparkle as their alpha-tested cards shift under the pixels
vec3 windFlutter(vec3 P, float h, float g, float r) {
  float t = uWT, f = r * 6.2832, k = g * (0.4 + 0.6 * g) * min(h * 0.5, 1.0) * (1.0 - smoothstep(70.0, 170.0, distance(P, uWCam)));
  vec3 rigid = vec3(sin(t * 7.3 + f), 0.8 * sin(t * 9.1 + f * 1.3), sin(t * 6.1 + f * 2.1));
  vec3 twist = vec3(sin(t * 12.7 + f + dot(P, vec3(1.9, 2.3, 1.7))), sin(t * 14.3 + f * 1.7 + dot(P, vec3(2.1, 1.3, 2.7))), sin(t * 11.1 + f * 2.3 + dot(P, vec3(1.5, 2.9, 2.2))));
  return (rigid * 0.011 + twist * 0.009) * k;
}
// ... and its normal wobbles with it, so a shivering crown glitters as the cards turn to and from the sun
vec3 windTilt(vec3 P, float h, float g, float r) {
  float f = r * 6.2832, k = g * min(h * 0.5, 1.0) * (1.0 - smoothstep(70.0, 170.0, distance(P, uWCam)));
  return vec3(sin(uWT * 5.3 + f * 1.9), 0.0, sin(uWT * 6.7 + f * 2.7)) * 0.3 * k;
}
// cloth: w.x = how far this vertex may move (0 where it is tied), w.y = 1 if it hangs (swings down-wind), 0 if spread
// flat (billows up and ripples, the ripples running down-wind)
vec3 windCloth(vec3 P, vec2 w, float g) {
  float k = dot(P.xz, uWD.xy), q = P.x * uWD.y - P.z * uWD.x, A = w.x * ${CLOTH_MAX.toFixed(3)};
  float wave = 0.6 * sin(k * 0.9 - uWT * 3.3 + q * 0.3) + 0.3 * sin(k * 2.1 - uWT * 5.9 + q * 0.7 + 1.3);
  if (w.y > 0.5) return vec3(uWD.x, 0.0, uWD.y) * A * g * (0.6 + 0.5 * wave);
  return vec3(0.0, A * g * (0.35 + wave), 0.0);
}
`;
const APPLY = {
  leaf: `transformed += (windSway(wP, aWind.x * ${H_MAX.toFixed(1)}, wg) + windFlutter(wP, aWind.x * ${H_MAX.toFixed(1)}, wg, aWind.y)) * mat3(modelMatrix);`,
  wood: `transformed += windSway(wP, aWind.x * ${H_MAX.toFixed(1)}, wg) * mat3(modelMatrix);`,
  cloth: 'transformed += windCloth(wP, aWind, wg) * mat3(modelMatrix);',
};
// displacements are made in world space; the transpose of the model matrix's rotation takes them back into the mesh's frame
const applyChunk = kind => `#include <begin_vertex>
{ vec3 wP = (modelMatrix * vec4(transformed, 1.0)).xyz; float wg = windGust(wP.xz, uWT); ${APPLY[kind]} }`;
const tiltChunk = `#include <beginnormal_vertex>
{ vec3 wP = (modelMatrix * vec4(position, 1.0)).xyz; objectNormal = normalize(objectNormal + windTilt(wP, aWind.x * ${H_MAX.toFixed(1)}, windGust(wP.xz, uWT), aWind.y) * mat3(modelMatrix)); }`;

// ---------- butterflies: an atlas of four wing pairs, drawn as the right-hand pair seen from above ----------
// (each 128 px cell: the body along the left edge, the head at the top; the left wings mirror it)
const SPECIES = [
  { name: 'cabbage white', span: 0.029, rate: 9.5, w: 3 }, { name: 'cleopatra', span: 0.034, rate: 8, w: 2 },
  { name: 'clouded yellow', span: 0.026, rate: 11, w: 2 }, { name: 'swallowtail', span: 0.043, rate: 6, w: 1.2, glide: true },
];
function butterflyAtlas() {
  if (typeof document === 'undefined') return null;
  const S = 128, c = document.createElement('canvas'); c.width = S * 4; c.height = S;
  const g = c.getContext('2d');
  const path = (pts) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 6) g.bezierCurveTo(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]); g.closePath(); };
  const fore = () => path([3, 30, 40, 4, 96, 2, 124, 14, 118, 40, 100, 66, 78, 70, 50, 74, 18, 66, 3, 62]);
  const hind = () => path([3, 58, 40, 56, 88, 64, 96, 84, 98, 104, 70, 124, 42, 124, 20, 122, 6, 104, 3, 84]);
  for (let k = 0; k < 4; k++) {
    g.save(); g.translate(k * S, 0);
    const clip = (fn, fill) => { g.save(); fn(); g.clip(); g.fillStyle = fill; g.fillRect(0, 0, S, S); return () => g.restore(); };
    if (k === 0) {        // cabbage white: chalk white, a sooty tip and a black spot on the forewing, a creamy hindwing
      let done = clip(fore, '#f3f0e4'); g.fillStyle = '#34322e'; g.beginPath(); g.ellipse(112, 18, 22, 16, -0.4, 0, TAU); g.fill(); g.beginPath(); g.arc(78, 40, 6, 0, TAU); g.fill(); done();
      done = clip(hind, '#eeead2'); g.fillStyle = '#d8d3b4'; g.fillRect(0, 56, 20, 70); done();
    } else if (k === 1) { // Cleopatra: sulphur-lemon, the forewing flushed orange (a Mediterranean brimstone)
      let done = clip(fore, '#f1e24c'); g.fillStyle = 'rgba(240,140,40,0.85)'; g.beginPath(); g.ellipse(52, 36, 34, 20, -0.2, 0, TAU); g.fill(); g.fillStyle = '#c96a1a'; g.beginPath(); g.arc(70, 38, 3, 0, TAU); g.fill(); done();
      done = clip(hind, '#e9dc56'); g.fillStyle = '#d8732a'; g.beginPath(); g.arc(58, 88, 3, 0, TAU); g.fill(); done();
    } else if (k === 2) { // clouded yellow: deep saffron with broad black borders
      let done = clip(fore, '#f0a22a'); g.strokeStyle = '#2c2620'; g.lineWidth = 22; fore(); g.stroke(); g.fillStyle = '#2c2620'; g.beginPath(); g.arc(62, 36, 5, 0, TAU); g.fill(); done();
      done = clip(hind, '#e9a431'); g.strokeStyle = '#2c2620'; g.lineWidth = 16; hind(); g.stroke(); g.fillStyle = '#f7c45a'; g.beginPath(); g.arc(50, 84, 6, 0, TAU); g.fill(); done();
    } else {              // swallowtail: pale yellow, black veins and bands, a blue row and a red eye by the tail
      g.fillStyle = '#1d1a16'; g.beginPath(); g.moveTo(78, 112); g.lineTo(92, 127); g.lineTo(100, 124); g.lineTo(88, 104); g.closePath(); g.fill();   // the tail
      let done = clip(fore, '#f0dc78'); g.fillStyle = '#1d1a16'; g.fillRect(0, 0, 30, 70); g.strokeStyle = '#1d1a16'; g.lineWidth = 3;
      for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(8, 34 + i * 5); g.lineTo(60 + i * 12, 6 + i * 11); g.stroke(); }
      g.lineWidth = 18; fore(); g.stroke(); g.fillStyle = '#f0dc78'; for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(98 - i * 10, 18 + i * 9, 3.2, 0, TAU); g.fill(); } done();
      done = clip(hind, '#efd978'); g.strokeStyle = '#1d1a16'; g.lineWidth = 26; hind(); g.stroke(); g.fillStyle = '#3f63b8'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(34 + i * 16, 100 + i * 2, 4, 0, TAU); g.fill(); }
      g.fillStyle = '#c8402a'; g.beginPath(); g.arc(18, 110, 6, 0, TAU); g.fill(); g.lineWidth = 3; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(8, 64); g.lineTo(40 + i * 16, 110); g.stroke(); } done();
    }
    g.fillStyle = k === 0 ? '#3a3834' : '#2a2520'; g.beginPath(); g.ellipse(0, 60, 5, 46, 0, 0, TAU); g.fill();   // half the body (the mirrored wing draws the other half)
    g.restore();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------- build ----------
export async function build(ctx) {
  const { M, world, scene } = ctx, W = ctx.wind, tStart = performance.now();
  const U = { uWT: { value: 0 }, uWD: { value: new THREE.Vector3(W.dx, W.dz, W.speed) }, uWCam: { value: new THREE.Vector3() } };
  const stats = { meshes: [], verts: 0 };

  // ----- material variants: a clone of the mesh's material whose vertex shader bends it, and a depth material to match -----
  const patch = (sh, kind, lit) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + GLSL).replace('#include <begin_vertex>', applyChunk(kind));
    if (lit && kind === 'leaf') sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', tiltChunk);
  };
  const variants = new Map();
  const windMaterial = (src, kind) => {
    const key = src.uuid + kind; let v = variants.get(key); if (v) return v;
    // the clone runs the source's hook (the cascaded-shadow setup and whatever came before it) and then bends
    const m = src.clone(), prev = src.onBeforeCompile, srcKey = src.customProgramCacheKey.bind(src);
    m.defines = { ...src.defines };               // copy() resets defines to { STANDARD }, which would drop USE_CSM and friends
    m.onBeforeCompile = (sh, r) => { prev.call(src, sh, r); patch(sh, kind, true); };
    m.customProgramCacheKey = () => srcKey() + '|wind-' + kind;
    const d = new THREE.MeshDepthMaterial();      // one per variant: three.js copies map / alphaTest / side onto it per draw
    d.onBeforeCompile = sh => patch(sh, kind); d.customProgramCacheKey = () => 'wind-depth-' + kind;
    variants.set(key, v = { m, d }); return v;
  };

  // ----- which meshes: by material (and owner: the town's bark buckets also hold ladders and posts) -----
  const LEAF = new Set([M.leafOlive, M.leafPine, M.leafPlane, M.leafCypress, M.foliage].filter(Boolean));
  const WOOD = new Set([M.barkOlive, M.barkPine, M.cypressBody].filter(Boolean)), WOODY = new Set(['vegetation', 'outskirts', 'civic']);
  const targets = [];
  scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.geometry?.attributes.position || o.geometry.attributes.aWind) return;
    const m = o.material; let kind = null;
    if (LEAF.has(m)) kind = 'leaf';
    else if (WOOD.has(m) && WOODY.has(o.name)) kind = 'wood';
    else if (o.name === 'residential' && m.alphaTest > 0 && m.map?.image?.height === 1536) kind = 'wicker';   // the wicker atlas carries the yards' leaf cards
    else if (o.name === 'agora cloth') kind = 'cloth';
    if (kind) targets.push([o, kind]);
  });

  // ----- the ground under every vertex: world.groundHeight on a lazily filled 2 m grid, bilinear -----
  const box = new THREE.Box3(), bb = new THREE.Box3();
  for (const [o] of targets) { o.updateMatrixWorld(); o.geometry.computeBoundingBox(); bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(bb); }
  const GC = 2, gx0 = Math.floor(box.min.x / GC) - 1, gz0 = Math.floor(box.min.z / GC) - 1, gnx = Math.ceil((box.max.x - box.min.x) / GC) + 3, gnz = Math.ceil((box.max.z - box.min.z) / GC) + 3;
  const grid = targets.length ? new Float32Array(gnx * gnz).fill(NaN) : null;
  const cellH = (i, j) => { const k = j * gnx + i; let v = grid[k]; if (v !== v) v = grid[k] = world.groundHeight((gx0 + i) * GC, (gz0 + j) * GC); return v; };
  const ground = (x, z) => { const fx = x / GC - gx0, fz = z / GC - gz0, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j; return lerp(lerp(cellH(i, j), cellH(i + 1, j), u), lerp(cellH(i, j + 1), cellH(i + 1, j + 1), u), v); };

  // connected pieces (a leaf card, a cloth sheet): union-find over the triangles, the root being the piece's lowest vertex index
  const pieces = (g) => {
    const n = g.attributes.position.count, ix = g.index ? g.index.array : null, par = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    const find = a => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
    const join = (a, b) => { a = find(a); b = find(b); if (a < b) par[b] = a; else if (b < a) par[a] = b; };
    const nt = ix ? ix.length : n;
    for (let t = 0; t < nt; t += 3) { const a = ix ? ix[t] : t; join(a, ix ? ix[t + 1] : t + 1); join(a, ix ? ix[t + 2] : t + 2); }
    for (let i = 0; i < n; i++) par[i] = find(i);
    return par;
  };
  const hash = i => (Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) >>> 8 & 0xff) / 255;

  // foliage near the ground, for the butterflies: one anchor per 4 m cell
  const anchors = [], anchorCells = new Set();
  let lastK = NaN;
  const addAnchor = (x, z, gy) => { const k = Math.floor(x / 4) * 100003 + Math.floor(z / 4); if (k === lastK || anchorCells.has(k)) return; lastK = k; anchorCells.add(k); anchors.push(x, z, gy); };
  const inAgora = (x, z) => z > 370 && z < 470 && Math.abs(x) < 160;   // the market and the quay: too busy for butterflies

  const _p = new THREE.Vector3(), swapped = [];   // [mesh, its own material, the bending one, the bending depth material]
  for (const [o, kind] of targets) {
    const t0 = performance.now(), g = o.geometry, P = g.attributes.position, n = P.count, aw = new Uint8Array(n * 2), mw = o.matrixWorld, ident = mw.equals(new THREE.Matrix4());
    const wx = new Float32Array(n), wy = new Float32Array(n), wz = new Float32Array(n);
    for (let i = 0; i < n; i++) { _p.fromBufferAttribute(P, i); if (!ident) _p.applyMatrix4(mw); wx[i] = _p.x; wy[i] = _p.y; wz[i] = _p.z; }
    const hq = h => clamp(Math.round(h / H_MAX * 255), 0, 255);
    if (kind === 'wood') {
      for (let i = 0; i < n; i++) aw[i * 2] = hq(wy[i] - ground(wx[i], wz[i]));
    } else if (kind === 'leaf' || kind === 'wicker') {
      const par = pieces(g), uv = kind === 'wicker' ? g.attributes.uv : null;
      for (let i = 0; i < n; i++) {
        if (uv) { const u = uv.getX(i), v = uv.getY(i); if (v > 0.165 || u < 0 || u > 0.5) continue; }   // outside the atlas's leaf cell: hurdles, looms, nets stay put
        const gy = ground(wx[i], wz[i]), h = wy[i] - gy;
        aw[i * 2] = hq(h); aw[i * 2 + 1] = hash(par[i]) * 255;
        if (h > 0.2 && h < 7 && !inAgora(wx[i], wz[i])) addAnchor(wx[i], wz[i], gy);
      }
    } else if (kind === 'cloth') {
      // the sheets (src/cityfeatures/agora.js sheet(): a PlaneGeometry(1, 1, 1, segs) bent between two edges, so rows of two
      // vertices at one height). Spread ones billow most mid-way between their tied ends, hanging ones swing most at the hem.
      const par = pieces(g); let sheets = 0;
      for (let i = 0; i < n;) {
        let j = i; while (j < n && par[j] === par[i]) j++;
        const cnt = j - i, rows = cnt / 2;
        let ok = cnt >= 4 && cnt <= 32 && cnt % 2 === 0;
        for (let r = 0; ok && r < rows; r++) if (Math.abs(wy[i + 2 * r] - wy[i + 2 * r + 1]) > 1e-3) ok = false;
        if (ok) {
          sheets++;
          const mid = r => [(wx[i + 2 * r] + wx[i + 2 * r + 1]) / 2, (wz[i + 2 * r] + wz[i + 2 * r + 1]) / 2], a = mid(0), b = mid(rows - 1);
          const run = Math.hypot(b[0] - a[0], b[1] - a[1]), drop = Math.abs(wy[i] - wy[j - 1]), hanging = drop > 0.8 * run;
          let len = 0; for (let r = 1; r < rows; r++) { const p = mid(r - 1), q = mid(r); len += Math.hypot(q[0] - p[0], q[1] - p[1], wy[i + 2 * r] - wy[i + 2 * r - 2]); }
          const top = Math.max(wy[i], wy[j - 1]);
          for (let r = 0; r < rows; r++) {
            const w = hanging ? Math.abs(top - wy[i + 2 * r]) / Math.max(drop, 1e-3) * clamp(0.035 * drop, 0.008, 0.035) : Math.sin(Math.PI * r / (rows - 1)) * clamp(0.0045 * len, 0.008, 0.055);
            for (const k of [i + 2 * r, i + 2 * r + 1]) { aw[k * 2] = clamp(Math.round(w / CLOTH_MAX * 255), 0, 255); aw[k * 2 + 1] = hanging ? 255 : 0; }
          }
        }
        i = j;
      }
      stats.sheets = sheets;
    }
    g.setAttribute('aWind', new THREE.BufferAttribute(aw, 2, true));
    const v = windMaterial(o.material, kind === 'wicker' ? 'leaf' : kind);
    // opaque meshes that move more than a few cm leave GTAO's static normal pass (the bark barely moves: it keeps its AO)
    const noAO = kind === 'cloth' || o.material === M.cypressBody;
    swapped.push([o, o.material, v.m, v.d, noAO]); o.material = v.m; if (o.castShadow) o.customDepthMaterial = v.d; if (noAO) o.userData.noAO = true;
    stats.meshes.push(`${o.name}:${kind}:${n}:${Math.round(performance.now() - t0)}ms`); stats.verts += n;
  }
  stats.patchMs = Math.round(performance.now() - tStart); stats.anchors = anchors.length / 3;

  // ---------- dust motes and pollen: a box of points round the camera, wrapped, drifting down-wind ----------
  const G = new THREE.Group(); G.name = 'wind';
  const BOX = 14, NM = 1400, R = rng(8111);
  const mg = new THREE.BufferGeometry(), seeds = new Float32Array(NM * 4);
  for (let i = 0; i < NM * 4; i++) seeds[i] = R();
  mg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NM * 3), 3)); mg.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const sun = (ctx.sunDir || new THREE.Vector3(0.5, 0.6, 0.4)).clone().normalize();
  const moteMat = new THREE.ShaderMaterial({
    uniforms: { uT: U.uWT, uWD: U.uWD, uCam: U.uWCam, uSun: { value: sun }, scale: { value: 500 } },
    vertexShader: `attribute vec4 seed; uniform float uT, scale; uniform vec3 uWD, uCam, uSun; varying float vA; varying float vPollen;
void main() {
  float r = seed.w, t = uT;
  // carried down-wind at 0.35..0.85 of a slow breeze near the ground, wandering in small eddies, pollen sinking a little
  vec3 p = seed.xyz * ${BOX.toFixed(1)} + vec3(uWD.x, 0.0, uWD.y) * t * (0.35 + 0.5 * r)
         + vec3(sin(t * 0.31 + r * 40.0), 0.5 * sin(t * 0.23 + r * 27.0) - 0.04 * t * step(0.8, r), cos(t * 0.27 + r * 33.0)) * 0.9;
  p = uCam + mod(p - uCam + ${(BOX / 2).toFixed(1)}, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)};
  vec4 mv = viewMatrix * vec4(p, 1.0); float d = -mv.z; vec3 e = p - uCam; float dist = length(e);
  float mu = dot(e / max(dist, 1e-3), uSun);
  // a mote is seen by the light it scatters forward: bright when you look towards the sun, faint with it behind you
  float phase = 0.55 + 2.6 * pow(max(mu, 0.0), 4.0) + 0.3 * pow(max(-mu, 0.0), 3.0);
  float glint = 0.5 + 0.5 * sin(t * (1.3 + 4.0 * r) + r * 91.0);   // tumbling flakes catch the sun now and then
  float size = (0.007 + 0.012 * r) * scale / max(d, 0.1);
  vA = (1.0 - smoothstep(${(BOX * 0.3).toFixed(1)}, ${(BOX / 2).toFixed(1)}, dist)) * smoothstep(0.4, 1.2, d) * phase * (0.35 + 0.65 * glint) * min(size * size, 1.0);
  vPollen = step(0.8, r);
  gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size, 1.0, 3.5);
}`,
    fragmentShader: `varying float vA; varying float vPollen;
void main() { vec2 q = gl_PointCoord - 0.5; float a = vA * (1.0 - smoothstep(0.15, 0.5, length(q))); if (a < 0.002) discard;
  gl_FragColor = vec4(mix(vec3(1.0, 0.94, 0.84), vec3(1.0, 0.9, 0.55), vPollen) * 1.5, a); }   // additive: src * alpha + dst`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const motes = new THREE.Points(mg, moteMat); motes.name = 'wind-motes'; motes.frustumCulled = false; motes.userData.noAO = true; motes.renderOrder = 2;
  const vs = new THREE.Vector2(); motes.onBeforeRender = (r, s, cam) => { r.getDrawingBufferSize(vs); moteMat.uniforms.scale.value = vs.y * 0.5 * cam.projectionMatrix.elements[5]; };
  G.add(motes);

  // ---------- butterflies: one instanced pair of wing quads, the flap angle and species per instance ----------
  const NB = 36, atlas = butterflyAtlas();
  const bg = new THREE.BufferGeometry();
  // right wing x 0..1, left wing x -1..0, head at +z; u runs from the body out to the wing tip, v from tail to head
  bg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0, -0.5, 0, 0, 0.5, -1, 0, 0.5, -1, 0, -0.5, 0, 0, -0.5], 3));
  bg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0], 2));
  bg.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  const aFly = new THREE.InstancedBufferAttribute(new Float32Array(NB * 2), 2).setUsage(THREE.DynamicDrawUsage); bg.setAttribute('aFly', aFly);
  const bmat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, metalness: 0, envMapIntensity: 0.4 });
  bmat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aFly;')
      // each wing turns about the body's long axis: aFly.x = 0 spread flat, > 0 wings up (1.5 = closed over the back)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nfloat bfS = position.x < 0.0 ? -1.0 : 1.0, bfA = aFly.x; objectNormal = vec3(-bfS * sin(bfA), cos(bfA), 0.0);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ float r = abs(transformed.x); transformed = vec3(bfS * r * cos(bfA), r * sin(bfA), transformed.z); }')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (aFly.y + vMapUv.x) * 0.25;\n#endif');
  };
  bmat.customProgramCacheKey = () => 'wind-butterfly';
  ctx.setupMaterial(bmat);
  const flies = new THREE.InstancedMesh(bg, bmat, NB); flies.name = 'wind-butterflies'; flies.frustumCulled = false; flies.castShadow = false; flies.receiveShadow = true; flies.userData.noAO = true;
  flies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  G.add(flies);

  // anchors in 32 m cells, to find foliage near the camera
  const AC = 32, acell = new Map();
  for (let i = 0; i < anchors.length; i += 3) { const k = Math.floor(anchors[i] / AC) * 4096 + Math.floor(anchors[i + 1] / AC); let l = acell.get(k); if (!l) acell.set(k, l = []); l.push(i); }
  const near = (x, z, r, out) => {
    out.length = 0;
    for (let i = Math.floor((x - r) / AC); i <= Math.floor((x + r) / AC); i++) for (let j = Math.floor((z - r) / AC); j <= Math.floor((z + r) / AC); j++) {
      const l = acell.get(i * 4096 + j); if (l) for (const a of l) { const dx = anchors[a] - x, dz = anchors[a + 1] - z; if (dx * dx + dz * dz < r * r) out.push(a); }
    }
    return out;
  };
  const B = {
    x: new Float32Array(NB), y: new Float32Array(NB), z: new Float32Array(NB), hd: new Float32Array(NB), tgt: new Float32Array(NB), sp: new Float32Array(NB),
    turn: new Float32Array(NB), ph: new Float32Array(NB), alt: new Float32Array(NB), gy: new Float32Array(NB), hx: new Float32Array(NB), hz: new Float32Array(NB),
    rest: new Float32Array(NB), glide: new Float32Array(NB), sp2: new Uint8Array(NB), live: new Uint8Array(NB),
  };
  const RB = rng(4747), SPW = SPECIES.reduce((s, q) => s + q.w, 0), cand = [];
  const pickSpecies = () => { let r = RB() * SPW; for (let k = 0; k < SPECIES.length; k++) if ((r -= SPECIES[k].w) < 0) return k; return 0; };
  const spawn = (i, cx, cz, dmin) => {
    near(cx, cz, 38, cand);
    for (let tries = 0; tries < 6 && cand.length; tries++) {
      const a = cand[Math.floor(RB() * cand.length)], x = anchors[a] + (RB() - 0.5) * 5, z = anchors[a + 1] + (RB() - 0.5) * 5;
      if (Math.hypot(x - cx, z - cz) < dmin || world.blocked(x, z)) continue;
      const gy = world.groundHeight(x, z); if (gy < SEA + 0.5) continue;
      B.x[i] = x; B.z[i] = z; B.gy[i] = gy; B.alt[i] = 0.5 + RB() * 1.8; B.y[i] = gy + B.alt[i]; B.hx[i] = x; B.hz[i] = z;
      B.hd[i] = B.tgt[i] = RB() * TAU; B.sp2[i] = pickSpecies(); B.sp[i] = 1.1 + RB() * 1.0; B.ph[i] = RB() * TAU; B.turn[i] = RB(); B.rest[i] = 0; B.glide[i] = 0; B.live[i] = 1;
      return true;
    }
    B.live[i] = 0; return false;
  };
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let spawned = false, respawnT = 0, gustHi = false, leafNear = 0, leafT = 0, lastUpdateMs = 0;

  function updateFlies(dt, t, cam) {
    const cx = cam.x, cz = cam.z, fa = aFly.array;
    if (!spawned) { spawned = true; for (let i = 0; i < NB; i++) spawn(i, cx, cz, 3); }
    respawnT -= dt; const tryRespawn = respawnT < 0; if (tryRespawn) respawnT = 0.5;
    for (let i = 0; i < NB; i++) {
      if (!B.live[i] || Math.hypot(B.x[i] - cx, B.z[i] - cz) > 50) {
        if (!tryRespawn || !spawn(i, cx, cz, 14)) { flies.setMatrixAt(i, _zero); continue; }
      }
      const S = SPECIES[B.sp2[i]]; let a;
      if (B.rest[i] > 0) {                 // settled on a leaf or a stone: wings closed over the back, opened now and then to bask
        B.rest[i] -= dt; a = 1.35 - 1.1 * Math.max(0, Math.sin(t * 0.7 + B.ph[i])) ** 6;
        if (B.rest[i] <= 0) { B.alt[i] = 0.6 + RB() * 1.5; B.tgt[i] = RB() * TAU; }
      } else {
        // erratic flight: a new heading every fraction of a second, drawn back towards its patch of foliage
        if ((B.turn[i] -= dt) < 0) {
          B.turn[i] = 0.15 + RB() * 0.7; const hx = B.hx[i] - B.x[i], hz = B.hz[i] - B.z[i], dh = Math.hypot(hx, hz);
          B.tgt[i] = dh > 5 && RB() < 0.7 ? Math.atan2(hx, hz) + (RB() - 0.5) * 1.2 : B.hd[i] + (RB() - 0.5) * 3.2;
          if (RB() < 0.25) B.alt[i] = clamp(B.alt[i] + (RB() - 0.5) * 1.2, 0.3, 2.8);
          if (S.glide && RB() < 0.2) B.glide[i] = 0.4 + RB() * 0.6;
          if (RB() < 0.035) B.rest[i] = 2 + RB() * 6;
        }
        let dh = B.tgt[i] - B.hd[i]; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); B.hd[i] += clamp(dh, -5 * dt, 5 * dt);
        const g = W.gust(B.x[i], B.z[i], t), sp = B.sp[i] * (B.glide[i] > 0 ? 1.2 : 1);
        const nx = B.x[i] + Math.sin(B.hd[i]) * sp * dt + W.dx * 0.35 * g * dt, nz = B.z[i] + Math.cos(B.hd[i]) * sp * dt + W.dz * 0.35 * g * dt;
        if (world.blocked(nx, nz)) { B.tgt[i] = B.hd[i] + Math.PI * (0.7 + RB() * 0.6); B.turn[i] = 0.4; }
        else { B.x[i] = nx; B.z[i] = nz; B.gy[i] = world.groundHeight(nx, nz); }
        if (B.glide[i] > 0) { B.glide[i] -= dt; a = 0.12 + 0.05 * Math.sin(t * 3 + i); }
        else { B.ph[i] += dt * S.rate * TAU; a = 0.4 + 0.95 * Math.sin(B.ph[i]); }
      }
      // each downstroke lifts it a little: the bobbing, dancing line of a butterfly's flight
      const bob = B.rest[i] > 0 ? 0 : 0.035 * Math.sin(B.ph[i] - 0.8), ty = B.gy[i] + (B.rest[i] > 0 ? 0.08 : B.alt[i]);
      B.y[i] += (ty - B.y[i]) * Math.min(1, dt * (B.rest[i] > 0 ? 3 : 1.5));
      _e.set(B.rest[i] > 0 ? 0 : -0.25 + 0.12 * Math.sin(B.ph[i]), B.hd[i], 0); _q.setFromEuler(_e);
      const s = S.span; flies.setMatrixAt(i, _m4.compose(_v.set(B.x[i], B.y[i] + bob, B.z[i]), _q, _s.set(s, s, s * 1.05)));
      fa[i * 2] = a; fa[i * 2 + 1] = B.sp2[i];
    }
    flies.instanceMatrix.needsUpdate = true; aFly.needsUpdate = true;
  }

  return {
    group: G,
    update(dt, t, camera) {
      const t0 = performance.now(), cam = camera.position;
      U.uWT.value = t; U.uWCam.value.copy(cam);
      updateFlies(Math.min(dt, 0.1), t, cam);
      // a gust rising over the listener: the audio can make the leaves hiss (leaves: how much foliage is within 25 m, 0..1)
      if ((leafT -= dt) < 0) { leafT = 0.5; leafNear = Math.min(1, near(cam.x, cam.z, 25, cand).length / 30); }
      const g = W.gust(cam.x, cam.z, t);
      if (!gustHi && g > 1.38) { gustHi = true; ctx.emit('gust', cam.x, cam.y, cam.z, { strength: g, leaves: leafNear }); } else if (gustHi && g < 1.2) gustHi = false;
      lastUpdateMs = performance.now() - t0;
    },
    // still air (for A/B timing and comparison): the meshes get their own materials back
    setWind(on) { for (const [o, m0, m, d, noAO] of swapped) { o.material = on ? m : m0; o.customDepthMaterial = on && o.castShadow ? d : undefined; if (noAO) o.userData.noAO = on; } G.visible = on; },
    debug() {
      let live = 0; for (let i = 0; i < NB; i++) live += B.live[i];
      return { ...stats, butterflies: live, motes: NM, gust: +W.gust(U.uWCam.value.x, U.uWCam.value.z, U.uWT.value).toFixed(2), leafNear: +leafNear.toFixed(2), updateMs: +lastUpdateMs.toFixed(3) };
    },
  };
}
