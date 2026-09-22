// Analytic landscape of Halicarnassus: a bowl of hills opening south onto the harbour.
// Terrace level (Mausoleum precinct) = 0. Sea level = SEA. +X east, +Z south.
import * as THREE from 'three';
import { makeNoise2D, clamp, smoothstep, lerp } from './util.js';

export const SEA = -22;
export const TERRACE = { hw: 121.5, hd: 52.5 };          // half extents of the temenos platform
const N = makeNoise2D(5);

function baseHeight(x, z) {
  let h;
  if (z >= -53) {
    const s = z + 53;
    h = -22 + 25.8 * Math.exp(-s / 300) - 0.0096 * s;
    if (z > 450) h -= 0.03 * (z - 450);
  } else {
    const n = -53 - z;
    h = 3.8 + 0.09 * n + 0.00012 * n * n;
  }
  const ax = Math.abs(x);
  // flanks of the bowl rise east and west, but not out over the bay
  h += 45 * smoothstep(250, 800, ax) * (1 - smoothstep(300, 800, z));
  // the two promontories embracing the harbour
  h += 30 * smoothstep(400, 560, ax) * (1 - smoothstep(620, 780, z));
  // far hills
  const dist = Math.hypot(x, z);
  h += 30 * smoothstep(500, 1200, dist) * (N.fbm(x / 900 + 3, z / 900, 3) * 0.5 + 0.5) * (1 - smoothstep(400, 900, z));
  // gentle undulation everywhere
  h += 6 * N.fbm(x / 260, z / 260, 4) + 1.4 * N.fbm(x / 55 + 9, z / 55, 3);
  return h;
}

// flat platforms cut into the slope: [cx, cz, half-w, half-d, level|null, blend]
const FLATS = [
  { cx: 0, cz: 0, hw: TERRACE.hw, hd: TERRACE.hd, level: 0, blend: 5.0 },                 // Mausoleum terrace
  { cx: -150, cz: -320, r: 20, level: null, blend: 6 },                                     // theatre orchestra
  { cx: 0, cz: 405, hw: 150, hd: 40, level: null, blend: 12 },                              // agora
  { cx: 80, cz: -640, hw: 66, hd: 46, level: null, blend: 3 },                              // Temple of Ares terrace
  { cx: 530, cz: 590, hw: 60, hd: 45, level: null, blend: 4 },                              // palace on Zephyrion
];
for (const f of FLATS) if (f.level === null) f.level = baseHeight(f.cx, f.cz) + (f.r ? 0 : 0.5);
export const flats = FLATS;

function flatMask(f, x, z) {
  if (f.r) { const d = Math.hypot(x - f.cx, z - f.cz); return 1 - smoothstep(f.r, f.r + f.blend, d); }
  const dx = Math.abs(x - f.cx) - f.hw, dz = Math.abs(z - f.cz) - f.hd;
  const d = Math.max(dx, dz);
  return 1 - smoothstep(0, f.blend, d);
}

export function terrainHeight(x, z) {
  let h = baseHeight(x, z);
  for (const f of FLATS) { const m = flatMask(f, x, z); if (m > 0) h = lerp(h, f.level, m); }
  return h;
}
export function terrainNormal(x, z, e = 1.5) {
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z), hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return new THREE.Vector3(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
}
export function slopeAt(x, z, e = 2) {
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z), hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(hx, hz) / (2 * e);
}
export const inTerrace = (x, z, m = 0) => Math.abs(x) < TERRACE.hw + m && Math.abs(z) < TERRACE.hd + m;

// Warped grid: fine near the centre, coarse far away.
export function buildTerrainMesh(material, { size = 3400, segs = 420 } = {}) {
  const n = segs + 1;
  const pos = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2), splat = new Float32Array(n * n * 3);
  const warp = t => size / 2 * (0.13 * t + 0.87 * t * t * t);
  let k = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const tx = (i / segs) * 2 - 1, tz = (j / segs) * 2 - 1;
    const x = warp(tx), z = warp(tz);
    const h = terrainHeight(x, z);
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
    uv[k * 2] = x; uv[k * 2 + 1] = z;
    // splat weights: dirt / grass / rock
    const sl = slopeAt(x, z, 3);
    const rock = smoothstep(0.42, 0.75, sl) * (h > SEA - 2 ? 1 : 0);
    const veg = N.fbm(x / 170 + 11, z / 170 + 4, 3) * 0.5 + 0.5;
    let grass = (1 - rock) * clamp(veg * 2.4 - 0.5 - Math.max(h - 130, 0) * 0.004, 0, 1) * smoothstep(SEA + 1, SEA + 4, h);
    // the built-up town is trodden bare
    const town = (z > 60 && z < 440 && Math.abs(x) < 470) ? 0.75 : 0;
    grass *= (1 - town);
    if (inTerrace(x, z, 2)) grass = 0;
    const dirt = clamp(1 - rock - grass, 0, 1);
    splat[k * 3] = dirt; splat[k * 3 + 1] = grass; splat[k * 3 + 2] = rock;
    k++;
  }
  const idx = [];
  for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('splat', new THREE.BufferAttribute(splat, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.name = 'terrain';
  return mesh;
}
