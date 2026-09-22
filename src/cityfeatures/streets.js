// Town feature: streets. Packed-earth side streets with sunken stone-lined drains along one side, the paved platea with kerbs and
// honorific statues, the avenue's kerbed earth way down to the quay, herms, altars, wells, fountains and plane trees on the block corners,
// goods set out against the house walls beside the doors (jars, sacks, firewood, building stuff), and carts and tethered donkeys at the
// street edges and on the roads out of town. Plans nothing; runs last.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, lathe, rectSweep, tubeY, ellipsoid, tx, mat, rng, lerp, clamp, smoothstep, TAU, normalizeGeom, colorize, makeNoise2D } from '../util.js';
import { terrainHeight, slopeAt, inTerrace, SEA, flats } from '../terrain.js';
import { streetX, streetZ, swX, swZ, GRID } from '../layout.js';
import { figureGeometry, lionGeometry } from '../sculpture.js';

export const name = 'streets';
export function plan() {}

// ---------- geometry helpers ----------
const cyl = (rt, rb, h, s = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const mergeN = parts => mergeGeometries(parts.map(normalizeGeom), false);
function limb(a, b, r0, r1, s = 6) {             // open tapered cylinder from a (radius r0) to b (radius r1)
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), len = A.distanceTo(Bv);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize());
  return cyl(r1, r0, len, s, true).applyMatrix4(new THREE.Matrix4().compose(A.add(Bv).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
}
// a closed log along X: n bark sides (radius r0 at -X, r1 at +X) and two flat end-grain caps of n-2 triangles each
function logG(r0, r1, L, n = 5) {
  const side = new THREE.CylinderGeometry(r1, r0, L, n, 1, true), caps = [];
  for (const [r, y, up] of [[r1, L / 2, 1], [r0, -L / 2, -1]]) {
    const p = [], ix = []; for (let j = 0; j < n; j++) { const a = j / n * TAU; p.push(Math.sin(a) * r, y, Math.cos(a) * r); }
    for (let j = 1; j < n - 1; j++) ix.push(...(up > 0 ? [0, j, j + 1] : [0, j + 1, j]));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [0, up, 0]).flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(p.filter((_, i) => i % 3 !== 1), 2)); caps.push(g);
  }
  const rot = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
  return { bark: side.applyMatrix4(rot), cap: mergeGeometries(caps, false).applyMatrix4(rot) };
}
const plank = (a, b, t, w = t) =>tx(box(Math.hypot(b[0] - a[0], b[1] - a[1]), t, w), (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2], 0, 0, Math.atan2(b[1] - a[1], b[0] - a[0]));
// flat-shaded quads with a known outward normal (kerbs, drain linings, skirts)
class Quads {
  constructor() { this.p = []; this.u = []; this.i = []; }
  add(A, Bq, C, D, uv, n) {
    const o = this.p.length / 3; this.p.push(...A, ...Bq, ...C, ...D); this.u.push(...uv);
    const e1 = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]], e2 = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (c[0] * n[0] + c[1] * n[1] + c[2] * n[2] >= 0) this.i.push(o, o + 1, o + 2, o, o + 2, o + 3); else this.i.push(o, o + 2, o + 1, o, o + 3, o + 2);
  }
  geom() {
    if (!this.i.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setIndex(this.i); g.computeVertexNormals();
    return g;
  }
}
// a slab on four corners [x, z] (in order around it) with its own top at each corner, sides down to lo[i]: top and sides into quads q
function slab(q, c, top, lo) {
  const cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, cz = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4, off = (cx + cz) % 3;
  q.add(...c.map(([x, z], i) => [x, top[i], z]), c.map(([x, z]) => [x, z]).flat(), [0, 1, 0]);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, [ax, az] = c[i], [bx, bz] = c[j], L = Math.hypot(bx - ax, bz - az), n = [(ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz];
    q.add([ax, lo[i], az], [bx, lo[j], bz], [bx, top[j], bz], [ax, top[i], az], [off, 0, off + L, 0, off + L, top[j] - lo[j], off, top[i] - lo[i]], n);
  }
}
// vertex-clustering simplification for distant repeats of a detailed figure (UVs re-projected, normals smooth); clustering leaves
// back-to-back duplicates and slivers that show as jagged shards, so those are dropped before the normals are made; cell may be a
// function of the height (a finer cell keeps a figure's head)
function lowPoly(g, cell, cull = true) {
  const src = normalizeGeom(g), p = src.attributes.position, key = new Map(), rep = new Int32Array(p.count), acc = [];
  for (let i = 0; i < p.count; i++) {
    const cl = typeof cell === 'number' ? cell : cell(p.getY(i)), k = `${cl},${Math.round(p.getX(i) / cl)},${Math.round(p.getY(i) / cl)},${Math.round(p.getZ(i) / cl)}`;
    let c = key.get(k); if (c === undefined) { key.set(k, c = acc.length); acc.push([0, 0, 0, 0]); }
    rep[i] = c; const a = acc[c]; a[0] += p.getX(i); a[1] += p.getY(i); a[2] += p.getZ(i); a[3]++;
  }
  const ix = src.index.array, idx = [], pos = [], uv = [], seen = new Set(), V = acc.map(([x, y, z, n]) => [x / n, y / n, z / n]);
  for (let t = 0; t < ix.length; t += 3) {
    const a = rep[ix[t]], b = rep[ix[t + 1]], c = rep[ix[t + 2]]; if (a === b || b === c || a === c) continue;
    if (cull) {
      const k = [a, b, c].sort((u, v) => u - v).join(); if (seen.has(k)) continue; seen.add(k);
      const [A, Bv, C] = [V[a], V[b], V[c]], d = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]), e = [d(A, Bv), d(Bv, C), d(C, A)];
      const ux = Bv[0] - A[0], uy = Bv[1] - A[1], uz = Bv[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
      if (0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-4 || Math.max(...e) > 8 * Math.min(...e)) continue;
    }
    idx.push(a, b, c);
  }
  for (const [x, y, z] of V) { pos.push(x, y, z); uv.push((x + z) * 0.7, y); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setIndex(idx); out.computeVertexNormals();
  return out;
}
// the paving's large-scale weathering: the texture's own slab-sized blotches (which line up into a lattice seen from the air) are
// half flattened against the tile's mean, and the shared macro noise at 1/35 (and an octave above it) times a second, turned, at 1/90,
// lays light and dark patches that never fall into step along the 700 m of the way
function paveMacro(m, tex) {
  m.onBeforeCompile = sh => {
    sh.uniforms.macroMap = { value: tex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMacroPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos; uniform sampler2D macroMap;').replace('#include <map_fragment>', `#include <map_fragment>
      #ifdef USE_MAP
      float lumL = dot(textureLod(map, vMapUv, 6.5).rgb, vec3(0.3, 0.59, 0.11)), lumG = dot(textureLod(map, vMapUv, 11.0).rgb, vec3(0.3, 0.59, 0.11));
      diffuseColor.rgb *= mix(1.0, clamp(lumG / max(lumL, 1e-3), 0.6, 1.7), 0.6);
      #endif
      float mA = texture2D(macroMap, vMacroPos.xz / 35.0).r * 0.65 + texture2D(macroMap, vMacroPos.xz / 35.0 * 3.7 + 0.31).r * 0.35;
      float mB = texture2D(macroMap, mat2(0.8, -0.6, 0.6, 0.8) * vMacroPos.xz / 90.0 + vec2(0.37, 0.61)).r;
      diffuseColor.rgb *= (0.7 + 0.6 * mA) * (0.85 + 0.3 * mB);`);
  };
  m.customProgramCacheKey = () => 'streetsPaveMacro';
  return m;
}
// a prototype: {slot: merged geometry}; slots are ctx.B bucket names or the feature's own vertex-colour lists
function proto(parts, ox = 0, oz = 0) {
  const by = {};
  for (const [slot, g, c] of parts) { const n = normalizeGeom(g); if (typeof c === 'function') c(n); else if (c !== undefined) colorize(n, c); if (ox || oz) n.translate(-ox, 0, -oz); (by[slot] ||= []).push(n); }
  for (const k in by) by[k] = mergeGeometries(by[k], false);
  return by;
}

// ---------- the ground as drawn ----------
// terrain.js meshes the analytic height on a warped grid (3400 m, 420 segments); over convex ground its flat triangles ride a few
// centimetres above the analytic surface, so whatever is laid just above the ground follows the higher of the two
const TGX = Array.from({ length: 421 }, (_, i) => { const t = i / 210 - 1; return 1700 * (0.13 * t + 0.87 * t * t * t); });
const TH = new Map(), thAt = (i, j) => { const k = i * 1024 + j; let v = TH.get(k); if (v === undefined) TH.set(k, v = terrainHeight(TGX[i], TGX[j])); return v; };
const tCell = v => { if (!(v > TGX[0] && v < TGX[420])) return -1; let lo = 0, hi = 420; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (TGX[md] <= v) lo = md; else hi = md; } return lo; };
function meshHeight(x, z) {
  const i = tCell(x), j = tCell(z); if (i < 0 || j < 0) return terrainHeight(x, z);
  const fx = (x - TGX[i]) / (TGX[i + 1] - TGX[i]), fz = (z - TGX[j]) / (TGX[j + 1] - TGX[j]);
  if (fx + fz <= 1) { const ha = thAt(i, j); return ha + (thAt(i + 1, j) - ha) * fx + (thAt(i, j + 1) - ha) * fz; }
  const hd = thAt(i + 1, j + 1); return hd + (thAt(i, j + 1) - hd) * (1 - fx) + (thAt(i + 1, j) - hd) * (1 - fz);
}
// the terrain splat's grass weight (same noise and formula as terrain.js): earth strips over grass get a skirt into the ground
const NZ = makeNoise2D(5);
function grassAt(x, z) {
  const h = terrainHeight(x, z), rock = smoothstep(0.42, 0.75, slopeAt(x, z, 3)) * (h > SEA - 2 ? 1 : 0), veg = NZ.fbm(x / 170 + 11, z / 170 + 4, 3) * 0.5 + 0.5;
  return (1 - rock) * clamp(veg * 2.4 - 0.5 - Math.max(h - 130, 0) * 0.004, 0, 1) * smoothstep(SEA + 1, SEA + 4, h) * ((z > 60 && z < 440 && Math.abs(x) < 470) ? 0.25 : 1);
}

const CLAY = [0xb86d48, 0xc98458, 0xa45f3d, 0xd29a6c, 0xbd7a55];
const LINEN = [0x7d6a4d, 0x735f44, 0x857152, 0x6b5a41];      // sacking: undyed linen, a little lighter than the earth it stands on
const STRAW = 0x8f7440, BRZ = [0x795737, 0x705232, 0x7f5f3c, 0x694e31];
function patina(g, hex, ph) {     // weathered bronze: warm where the light falls, darker underneath, green-grey streaks run down from the folds
  const p = g.attributes.position, nm = g.attributes.normal, base = new THREE.Color(hex), green = new THREE.Color(0x5a7262), dark = new THREE.Color(0x33261a), col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const up = nm ? nm.getY(i) : 0, x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const st = clamp((Math.sin(x * 21 + ph) * Math.sin(z * 17 - ph) + 0.7 * Math.sin(y * 6.1 + x * 4.3 + ph)) * 0.38 + 0.36 - 0.18 * up - 0.06 * y, 0.12, 0.75);
    c.copy(base).multiplyScalar(0.92 + 0.16 * clamp(up, 0, 1)).lerp(dark, clamp(-up, 0, 1) * 0.4).lerp(green, st); col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}
// weathered marble: a warm stone white, darker where it faces sideways and down and towards the foot (y0 → y1: foot → head), faintly mottled
const marbleTone = (hex, y0 = 0, y1 = 1.8) => g => {
  const p = g.attributes.position, nm = g.attributes.normal, base = new THREE.Color(hex), col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), up = nm ? nm.getY(i) : 0, t = clamp((y - y0) / (y1 - y0), 0, 1);
    c.copy(base).multiplyScalar((1 - (1 - up) * 0.15) * lerp(0.8, 1, smoothstep(0, 0.55, t)) * (0.97 + 0.03 * Math.sin(x * 13 + y * 7) * Math.sin(z * 11 - y * 5))); col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
};
const sackG = () =>lathe([[0.001, 0], [0.2, 0.015], [0.25, 0.19], [0.19, 0.42], [0.05, 0.53], [0.085, 0.6], [0.001, 0.615]], 6);   // a full belly, a pinched neck, the tied mouth
const sides = g => { g.setIndex([...g.index.array.slice(0, 12), ...g.index.array.slice(24)]); return g; };     // a box without its top and bottom
const amphoraG = (s = 7, handles = true) => mergeN([lathe([[0.001, 0], [0.16, 0.44], [0.165, 0.62], [0.06, 0.79], [0.05, 0.955]], s),
  ...(handles ? [tx(sides(box(0.028, 0.2, 0.04)), 0.1, 0.83, 0, 0, 0, 0.36), tx(sides(box(0.028, 0.2, 0.04)), -0.1, 0.83, 0, 0, 0, -0.36)] : [])]);
const pelikeG = () => mergeN([lathe([[0.14, -0.01], [0.22, 0.26], [0.17, 0.44], [0.09, 0.54], [0.12, 0.64]], 5), tx(box(0.03, 0.22, 0.04), 0.13, 0.52, 0, 0, 0, 0.3), tx(box(0.03, 0.22, 0.04), -0.13, 0.52, 0, 0, 0, -0.3)]);
const hydriaG = () => mergeN([lathe([[0.11, -0.01], [0.2, 0.28], [0.14, 0.45], [0.065, 0.53], [0.09, 0.6]], 5), tx(box(0.03, 0.26, 0.04), 0, 0.42, -0.17, 0.3, 0, 0)]);

export function build(ctx) {
  const { M, world, layout, B, G } = ctx;
  let R = rng(35711);      // re-seeded per section, so a change in one leaves the others as they were
  const pick = a => a[Math.floor(R() * a.length)];
  const gh = (x, z) => inTerrace(x, z) ? 0 : terrainHeight(x, z);
  const gb = (x, z) => inTerrace(x, z) ? 0 : Math.max(terrainHeight(x, z), meshHeight(x, z));
  const own = { paint: [], terra: [], bronze: [], leaf: [] };
  const put = (p, m) => { for (const k in p) { if (!p[k].isBufferGeometry) continue; if (own[k]) own[k].push(p[k].clone().applyMatrix4(m)); else B[k].add(p[k], m); } };
  const E = { p: [], c: [], u: [], i: [] }, kerb = new Quads(), lining = new Quads();
  // node tools (world.debugStreets) get a breakdown in layout.stats.streets
  const dbg = world.debugStreets ? (layout.stats.streets = { tris: {}, props: [], corners: [], runs: [] }) : null;
  const pave = { p: [], u: [], c: [], i: [] };
  const triNow = () => { let n = E.i.length / 3 + kerb.i.length / 3 + lining.i.length / 3 + pave.i.length / 3; for (const k in own) for (const g of own[k]) n += g.index.count / 3; for (const k in B) for (const g of B[k].list) n += (g.index ? g.index.count : g.attributes.position.count) / 3; return n; };
  let lastT = dbg ? triNow() : 0;
  const mark = l => { if (!dbg) return; const t = triNow(); dbg.tris[l] = (dbg.tris[l] || 0) + t - lastT; lastT = t; };

  // ---------- where the streets may be dressed ----------
  const special = [flats[1], flats[3], flats[4]];
  const offLimits = (x, z) => inTerrace(x, z, 4.2) || z > 446 || (Math.abs(x) < 152 && z > 363) || terrainHeight(x, z) < SEA + 2 ||
    special.some(f => f.r ? Math.hypot(x - f.cx, z - f.cz) < f.r + 16 : (Math.abs(x - f.cx) < f.hw + 5 && Math.abs(z - f.cz) < f.hd + 5));
  const roads = (layout.roads || []).filter(r => r.width !== 16 && r.width !== 12);   // the platea and the avenue are dressed here
  const nearRoad = (x, z, pad) => roads.some(r => {
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1], dx = x1 - x0, dz = z1 - z0, t = clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz), 0, 1);
      if (Math.hypot(x - x0 - t * dx, z - z0 - t * dz) < r.width / 2 + pad) return true;
    }
    return false;
  });
  const ov = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;
  const grid = () => {
    const g = new Map(), C = 8;
    return {
      add(r) { for (let i = Math.floor(r.minX / C); i <= Math.floor(r.maxX / C); i++) for (let j = Math.floor(r.minZ / C); j <= Math.floor(r.maxZ / C); j++) { const k = i * 65536 + j; let l = g.get(k); if (!l) g.set(k, l = []); l.push(r); } },
      hit(r, m = 0) { for (let i = Math.floor((r.minX - m) / C); i <= Math.floor((r.maxX + m) / C); i++) for (let j = Math.floor((r.minZ - m) / C); j <= Math.floor((r.maxZ + m) / C); j++) { const l = g.get(i * 65536 + j); if (l) for (const o of l) if (ov(o, r, m)) return true; } return false; },
      at(x, z, skip) { const l = g.get(Math.floor(x / C) * 65536 + Math.floor(z / C)); if (l) for (const o of l) if (x > o.minX && x < o.maxX && z > o.minZ && z < o.maxZ && !skip.has(o)) return o; return null; },
    };
  };
  const solid = grid(), occ = grid();      // solid: everyone's colliders; occ: + houses, doorways, other features' pois/areas, my own things
  for (const c of world.colliders) { solid.add(c); occ.add(c); }
  // furniture keeps 1.5 m from what the other features and the city built (the houses excepted: goods stand against their walls),
  // and 4 m from the civic buildings' fronts and stairs
  const houseKey = c => `${c.minX.toFixed(2)},${c.minZ.toFixed(2)},${c.maxX.toFixed(2)},${c.maxZ.toFixed(2)}`, houseC = new Set();
  for (const h of layout.houses) { houseC.add(houseKey({ minX: h.x - h.w / 2 - 0.3, minZ: h.z - h.d / 2 - 0.3, maxX: h.x + h.w / 2 + 0.3, maxZ: h.z + h.d / 2 + 0.3 })); if (h.wing) houseC.add(houseKey({ minX: h.wing.x - h.wing.w / 2 - 0.3, minZ: h.wing.z - h.wing.d / 2 - 0.3, maxX: h.wing.x + h.wing.w / 2 + 0.3, maxZ: h.wing.z + h.wing.d / 2 + 0.3 })); }
  const feat = grid(); for (const c of world.colliders) if (!houseC.has(houseKey(c)) && !(Math.abs((c.minX + c.maxX) / 2) < 124.5 && Math.abs((c.minZ + c.maxZ) / 2) < 56)) feat.add(c);
  const civic = layout.reserved.filter(q => q.owner === 'civic');
  const othersEG = world.extraGround.slice(), otherTop = (x, z) => { let y = -Infinity; for (const f of othersEG) { const v = f(x, z); if (v > y) y = v; } return y; };   // raised floors the other features laid
  for (const h of layout.houses) {
    occ.add({ minX: h.minX - 0.25, maxX: h.maxX + 0.25, minZ: h.minZ - 0.25, maxZ: h.maxZ + 0.25 });
    const d = h.door; occ.add({ minX: d.x - 0.95, maxX: d.x + 0.95, minZ: Math.min(d.z, d.z + d.nz * 1.8), maxZ: Math.max(d.z, d.z + d.nz * 1.8) });
  }
  for (const p of layout.pois) { const e = (p.type === 'door' || p.type === 'stall') && p.owner !== name ? 2.0 : 0.9; occ.add({ minX: p.x - e, maxX: p.x + e, minZ: p.z - e, maxZ: p.z + e }); }   // doors and gates keep 2 m clear
  const mineC = new Set();       // my own colliders: a path to the street may pass those
  // from a spot, the way out to the street (tx, tz) must not pass anyone else's collider: nothing ends up behind a yard wall
  const reach = (x, z, tx, tz) => { const n = Math.ceil(Math.hypot(tx - x, tz - z) / 0.15); for (let i = 1; i <= n; i++) if (solid.at(x + (tx - x) * i / n, z + (tz - z) * i / n, mineC)) return false; return true; };
  // walled yards (a residential gate poi names the house): corner pieces stay within 1 m of such a lot's edge
  const yardIds = new Set(layout.pois.filter(p => p.type === 'door' && /yard/.test(p.note || '') && p.house !== undefined).map(p => p.house));
  const yardLots = layout.houses.filter(h => yardIds.has(h.id) && h.lot).map(h => h.lot);
  const inYardLot = r => yardLots.some(l => ov(l, r) && Math.min(r.maxX - l.minX, l.maxX - r.minX, r.maxZ - l.minZ, l.maxZ - r.minZ) > 1.0);
  for (const a of layout.areas) if (a.owner !== 'city') occ.add(a);
  for (const r of layout.reserved) occ.add(r);
  // the cypress rows planted later by environment.js (no colliders): along the platea at z≈79–81 and the avenue at x≈154–155,
  // less the trees it leaves out of the side streets' lanes and off the platea
  const inRow = (v, first, step, half) => { const q = ((v - first) % step + step) % step; return q < half || step - q < half; };
  const CYP = [];
  for (let x = -440; x <= 440; x += 15) if (Math.abs(x) > 10 && !inRow(x, 145, 45, 3.5)) CYP.push([x, 80]);
  for (let z = -40; z <= 380; z += 14) if (!(Math.abs(z - 64) < 10 || inRow(z, 64, 60, 4))) CYP.push([154.5, z]);
  for (const [x, z] of CYP) occ.add(z === 80 ? { minX: x - 1.3, maxX: x + 1.3, minZ: 77.8, maxZ: 82.2 } : { minX: 152.7, maxX: 156.3, minZ: z - 1.3, maxZ: z + 1.3 });
  const laneX = k => k === 0 ? 4.0 : 1.3, laneZ = m => m === 0 ? 5.5 : m === -2 ? 2.2 : 1.3;
  const inLane = r => {
    const k = Math.round(((r.minX + r.maxX) / 2 - 145) / 45), m = Math.round(((r.minZ + r.maxZ) / 2 - 64) / 60);
    for (let kk = k - 1; kk <= k + 1; kk++) { const c = streetX(kk), h = laneX(kk); if (r.minX < c + h && r.maxX > c - h) return true; }
    for (let mm = m - 1; mm <= m + 1; mm++) { const c = streetZ(mm), h = laneZ(mm); if (r.minZ < c + h && r.maxZ > c - h) return true; }
    return false;
  };
  const free = (r, m = 0.12, lane = true, pad, fm = 1.5) => {
    const cx = (r.minX + r.maxX) / 2, cz = (r.minZ + r.maxZ) / 2;
    return !(lane && inLane(r)) && !offLimits(cx, cz) && !occ.hit(r, m) && !layout.isReserved(r, m) && !feat.hit(r, fm) && !civic.some(q => ov(q, r, 4)) && !nearRoad(cx, cz, pad ?? Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2 + 0.3);
  };
  const addPoi = p => { layout.addPoi(p); if (p.type !== 'bench' && p.type !== 'seat') occ.add(rectC(p.x, p.z, p.type === 'gather' ? 0.8 : 0.45, p.type === 'gather' ? 0.8 : 0.45)); return p; };   // keep people's spots clear of what comes later
  const claim = (r, isSolid = true) => { occ.add(r); if (isSolid) { const c = { minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ }; world.colliders.push(c); solid.add(c); mineC.add(c); } };
  const rectC = (x, z, hx, hz) => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
  const houses = (k, m) => { const b = layout.block(k, m); return b ? b.houses : []; };
  const dens = (x, z) => {        // how busy a spot is: the platea, the avenue, the agora and the road north are the town's thoroughfares
    const dP = Math.abs(x) < 480 ? Math.abs(z - 64) : 1e3, dA = z > -70 && z < 450 ? Math.abs(x - 145) : 1e3, dG = Math.hypot(Math.max(0, Math.abs(x) - 150), Math.max(0, 365 - z));
    const dN = z < -50 && z > -430 ? 1.4 * Math.abs(x - (z > -300 ? lerp(145, 130, (-58 - z) / 242) : lerp(130, 100, (-300 - z) / 260))) + 25 : 1e3;
    return lerp(1, 0.38, smoothstep(20, 230, Math.min(dP, dA, dG, dN))) * lerp(1, 0.6, smoothstep(300, 750, Math.hypot(x, z - 180)));
  };

  // ---------- street runs: stretches of side street between crossings, clear of precincts, roads and buildings ----------
  // a run has an origin, a direction d (along = a) and a normal n (across = u); grid runs are axis 'z' (N–S street) or 'x' (E–W street)
  const P = (r, a, u) => [r.ox + r.dx * a + r.nx * u, r.oz + r.dz * a + r.nz * u];
  const rectOf = (r, a0, a1, u0, u1) => { const q = [P(r, a0, u0), P(r, a1, u0), P(r, a0, u1), P(r, a1, u1)]; return { minX: Math.min(...q.map(v => v[0])), maxX: Math.max(...q.map(v => v[0])), minZ: Math.min(...q.map(v => v[1])), maxZ: Math.max(...q.map(v => v[1])) }; };
  const frame = (axis, c) => axis === 'z' ? { ox: c, oz: 0, dx: 0, dz: 1, nx: 1, nz: 0 } : { ox: 0, oz: c, dx: 1, dz: 0, nx: 0, nz: 1 };
  const stripOk = (x, z) => !offLimits(x, z) && slopeAt(x, z) < 0.42 && !solid.hit({ minX: x - 0.3, maxX: x + 0.3, minZ: z - 0.3, maxZ: z + 0.3 }) && !layout.isReserved({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5 }) && !nearRoad(x, z, 0.8);
  const runs = [];
  const addRuns = (axis, k, m, c, w, a0, a1, hs) => {
    const n = Math.ceil(a1 - a0), at = i => a0 + (a1 - a0) * i / n;
    let s = -1;
    for (let i = 0; i <= n + 1; i++) {
      const ok = i <= n && stripOk(...(axis === 'z' ? [c, at(i)] : [at(i), c]));
      if (ok && s < 0) s = i;
      else if (!ok && s >= 0) { if (at(i - 1) - at(s) >= 6) runs.push({ axis, k, m, c, w, a0: at(s), a1: at(i - 1), full: s === 0 && i - 1 === n, hs, ...frame(axis, c) }); s = -1; }
    }
  };
  for (let k = GRID.k0; k <= GRID.k1 + 1; k++) for (let m = GRID.m0; m <= GRID.m1; m++) {
    if (k === 0) continue;
    const hs = [...houses(k - 1, m), ...houses(k, m)]; if (hs.length < 3) continue;
    addRuns('z', k, m, streetX(k), swX(k), streetZ(m) + swZ(m) / 2, streetZ(m + 1) - swZ(m + 1) / 2, hs);
  }
  for (let k = GRID.k0; k <= GRID.k1; k++) for (let m = GRID.m0; m <= GRID.m1 + 1; m++) {
    if (m === 0) continue;
    const hs = [...houses(k, m - 1), ...houses(k, m)]; if (hs.length < 3) continue;
    addRuns('x', k, m, streetZ(m), swZ(m), streetX(k) + swX(k) / 2, streetX(k + 1) - swX(k + 1) / 2, hs);
  }
  // a run that stops a few metres short of the avenue, the platea or a road (the road's margin kept it off) is carried on to meet it
  const onWay = (x, z, pad = 0) => (Math.abs(x - 145) < 5.75 + pad && z > -57.5 - pad && z < 440 + pad) || (Math.abs(z - 64) < 8 + pad && Math.abs(x) < 470 + pad) || nearRoad(x, z, pad);
  for (const r of runs) {
    r.tuck = [false, false];
    for (const e of [0, 1]) for (let t = 0.25, a = e ? r.a1 : r.a0; t <= 5.01 && onWay(...P(r, a, 0), 5.3); t += 0.25) {
      const [x, z] = P(r, e ? a + t : a - t, 0);
      if (onWay(x, z)) { if (e) r.a1 = a + t - 0.25; else r.a0 = a - t + 0.25; r.tuck[e] = true; break; }
      if (offLimits(x, z) || slopeAt(x, z) >= 0.42 || solid.hit(rectC(x, z, 0.3, 0.3)) || layout.isReserved(rectC(x, z, 0.5, 0.5))) break;
    }
  }
  const DIRT = [0.93, 0.86, 0.76];
  for (const r of runs) {
    const [mx, mz] = P(r, (r.a0 + r.a1) / 2, 0);
    r.d = dens(mx, mz) * lerp(0.7, 1, smoothstep(2, 8, r.hs.length));
    r.side = R() < 0.5 ? -1 : 1;
    const q = R();
    r.chan = r.d > 0.55 ? (q < 0.6 ? 'stone' : q < 0.9 ? 'ditch' : 'none') : r.d > 0.33 ? (q < 0.24 ? 'stone' : q < 0.75 ? 'ditch' : 'none') : (q < 0.05 ? 'stone' : q < 0.45 ? 'ditch' : 'none');
    const lt = 1.03 + R() * 0.12, gr = 0.3 + R() * 0.3; r.tint = new THREE.Color(...DIRT.map(c => lerp(c, 0.98, gr) * lt));
    r.sk = [-1, 1].map(e => [r.a0, (r.a0 + r.a1) / 2, r.a1].some(a => grassAt(...P(r, a, e * r.side * r.w / 2)) > 0.3));     // per side (u′ < 0, u′ > 0)
    r.spans = []; r.joined = [false, false]; r.patch = [false, false];
    if (dbg) dbg.runs.push({ mx, mz, a0: r.a0, a1: r.a1, d: r.d });
  }

  // ---------- drains: where each stone channel can run, and where two of them meet at a block corner ----------
  const T_ST = 0.18, F_CH = 0.03, T_END = 0.065, T_SUMP = 0.02;      // edging-stone tops and the channel floor, above the ground; the lining's
  // top where it comes down at a joined corner (T_END) and under a sump's cover, which comes down to the crossing's own surface (T_SUMP)
  for (const r of runs) {
    if (r.chan !== 'stone') continue;
    const hw = r.w / 2, s = r.side;
    let st = r.a0;
    for (let a = r.a0; a < r.a1; a += 1) {
      const cell = rectOf(r, a, Math.min(a + 1, r.a1), s * (hw - 1.25), s * (hw - 0.1)), [cx, cz] = P(r, a + 0.5, s * (hw - 0.7));
      if (solid.hit(cell, 0.1) || layout.isReserved(cell) || nearRoad(cx, cz, 0.7)) { if (st !== null && a - 0.4 - st >= 3) r.spans.push([st, a - 0.4]); st = null; }
      else if (st === null) st = Math.min(a + 1, r.a1);
    }
    if (st !== null && r.a1 - st >= 3) r.spans.push([st, r.a1]);
    if (!r.spans.length) r.chan = 'ditch';
  }
  const runAt = new Map();
  for (const r of runs) if (r.full) runAt.set(`${r.axis}${r.k},${r.m}`, r);
  const touches = (r, e) => r.spans.length > 0 && (e ? r.spans[r.spans.length - 1][1] >= r.a1 - 0.01 : r.spans[0][0] <= r.a0 + 0.01);
  const walk = [];     // walkable surfaces: [rect, fn(x, z) → y | -Infinity]
  for (const r of runs) {
    if (r.axis !== 'z' || r.chan !== 'stone' || !r.full) continue;
    for (const e of [0, 1]) {
      const kb = r.side > 0 ? r.k : r.k - 1, q = runAt.get(`x${kb},${e ? r.m + 1 : r.m}`), qe = kb === r.k ? 0 : 1;
      if (!touches(r, e) || !q || q.chan !== 'stone' || q.side !== (e ? -1 : 1) || !touches(q, qe)) continue;
      r.joined[e] = q.joined[qe] = true;
      // a square cover stone over the corner where the two channels join: both linings come down to it, and it lies just proud of the crossing
      const x0 = r.c + r.side * (r.w / 2 - 1.25), x1 = r.c + r.side * (r.w / 2 + 0.02), z0 = q.c + q.side * (q.w / 2 - 1.25), z1 = q.c + q.side * (q.w / 2 + 0.02);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, jt = (R() - 0.5) * 0.006, c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], top = c.map(([x, z]) => gb(x, z) + T_END + 0.012 + jt);
      slab(lining, c, top, c.map(([x, z], i) => top[i] - 0.11)); if (dbg) (dbg.joins ||= []).push({ cs: c, top });
      const xs = [Math.min(x0, x1), Math.max(x0, x1)], zs = [Math.min(z0, z1), Math.max(z0, z1)], Yc = xs.map(x => zs.map(z => top[c.findIndex(p => p[0] === x && p[1] === z)]));
      const rc = rectC(cx, cz, 0.64, 0.64); occ.add(rc); walk.push([rc, (x, z) => gridAt(xs, zs, Yc, x, z) ?? -Infinity]);
    }
  }
  // a channel that ends at a crossing drains into a sump under a cover slab: under it the lining comes down towards the street
  const tstAt = (r, a) => {
    let t = T_ST;
    for (const e of [0, 1]) if (r.sumpE[e] || r.joined[e]) t = Math.min(t, lerp(T_ST, r.sumpE[e] ? T_SUMP : T_END, clamp(e ? (a - r.a1 + 1.2) / 1.2 : (r.a0 + 1.2 - a) / 1.2, 0, 1)));
    return t;
  };
  // crossings of dressed streets get a patch joining their surfaces
  const patches = [];
  for (let k = GRID.k0; k <= GRID.k1 + 1; k++) for (let m = GRID.m0; m <= GRID.m1 + 1; m++) {
    if (k === 0 || m === 0) continue;
    const zN = runAt.get(`z${k},${m - 1}`), zS = runAt.get(`z${k},${m}`), xW = runAt.get(`x${k - 1},${m}`), xE = runAt.get(`x${k},${m}`), adj = [zN, zS, xW, xE].filter(Boolean);
    if (adj.length < 2) continue;
    const x = streetX(k), z = streetZ(m), hx = swX(k) / 2, hz = swZ(m) / 2;
    if (offLimits(x, z) || nearRoad(x, z, Math.max(hx, hz) + 1)) continue;
    if (zN) zN.patch[1] = true; if (zS) zS.patch[0] = true; if (xW) xW.patch[1] = true; if (xE) xE.patch[0] = true;
    patches.push({ x, z, hx, hz, zN, zS, xW, xE, adj });
  }
  // (a channel that ends where no crossing is laid ends in a closing stone instead)
  for (const r of runs) { const sp = r.spans; r.sumpE = [0, 1].map(e => r.chan === 'stone' && touches(r, e) && !r.joined[e] && r.patch[e] && (e ? sp[sp.length - 1][1] - sp[sp.length - 1][0] : sp[0][1] - sp[0][0]) >= 5); }

  // ---------- earth surfaces (one vertex-coloured mesh on the terrain's dirt texture) ----------
  const earthGrid = (rows, cols, at) => {
    const o = E.p.length / 3;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const v = at(i, j); E.p.push(v[0], v[1], v[2]); E.c.push(v[3], v[4], v[5]); E.u.push(v[0], v[2]); }
    const p = (i, j) => { const q = (o + i * cols + j) * 3; return [E.p[q], E.p[q + 1], E.p[q + 2]]; };
    const a = p(0, 0), b = p(1, 0), c = p(0, 1), up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 0;
    for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) { const q = o + i * cols + j, s = q + cols; if (up) E.i.push(q, s, q + 1, q + 1, s, s + 1); else E.i.push(q, q + 1, s, q + 1, s + 1, s); }
  };
  const WET = new THREE.Color(0.19, 0.16, 0.125), DITCH = new THREE.Color(0.5, 0.42, 0.34), EDGE = new THREE.Color(...DIRT), SKW = 0.3, SKL = -0.07, TAP = 1.3;
  const crown = (u, hw, rut, el) => { const a = Math.abs(u); return a <= rut ? lerp(0.095, 0.08, a / rut) : a <= hw ? lerp(0.08, el, (a - rut) / (hw - rut)) : lerp(el, SKL, clamp((a - hw) / SKW, 0, 1)); };
  const flush = (l, f) => l > 0.02 ? lerp(0.02, l, f) : l;
  const endFade = (r, a, uP) => {
    if (!r.fade) return 1;
    const d = r.fade[1] === 2 || r.fade[0] === 2 ? clamp(uP / (r.w / 2 - 1.2), 0, 1) : 0;
    return Math.min(...[0, 1].map(e => !r.fade[e] ? 1 : lerp(smoothstep(0, 2.5, e ? r.a1 - a : a - r.a0), 1, r.fade[e] === 2 ? d : 0)));
  };
  const spanOf = (r, a) => r.spans.find(([sa, sb]) => a >= sa - 1e-4 && a <= sb + 1e-4);
  // the cross-section: u′ is measured towards the drain side; inside a drain span the street rises gently to the edging stones
  // a sump's cover (last 1.22 m of a channel at a crossing): sf = 0 at the crossing's edge, 1 where the cover lies on the lining; its top
  // comes down from the lining to just above the crossing's crown, and the street beside it rises to meet it
  const sumpF = (r, a) => r.sumpE[1] && a > r.a1 - 1.22 ? (r.a1 - a) / 1.22 : r.sumpE[0] && a < r.a0 + 1.22 ? (a - r.a0) / 1.22 : -1;
  const sumpTop = (hw, rut, uP, f) => lerp(crown(uP, hw, rut, 0.04) + 0.008, T_ST + 0.012, clamp(f, 0, 1));
  const liftOf = (r, uP, kind, a, walking = false) => {
    const hw = r.w / 2, rut = r.w > 6 ? 1.1 : 0.72, el = r.sk[uP < 0 ? 0 : 1] ? 0.04 : 0.025, base = crown(uP, hw, rut, el);
    if (kind === 'dt') return base - 0.02;
    const sp = r.chan === 'stone' && spanOf(r, a); if (!sp) return base;
    const ts = tstAt(r, a), sf = sumpF(r, a), edge = sf >= 0 ? sumpTop(hw, rut, hw - 1.27, sf) - 0.012 : 0;
    if (walking && sf >= 0 && uP >= hw - 1.27 && uP <= hw - 0.09) return sumpTop(hw, rut, uP, sf);
    if (walking && uP >= hw - 1.2 && uP <= hw - 0.18) return uP > hw - 0.88 && uP < hw - 0.5 ? F_CH : ts + (a > r.a1 - 1.2 || a < r.a0 + 1.2 ? 0.012 : 0);
    if (kind === 'fl') return F_CH;
    if (kind === 'ua' || kind === 'ub') return sf >= 0 ? edge - 0.006 * sf : ts - 0.006;
    if (kind === 'sk') return SKL;
    if (uP > 0 && uP < hw - 1.2) return sf >= 0 ? lerp(base, lerp(0.095, edge - 0.03 * sf, uP / (hw - 1.2)), smoothstep(0, 0.45, sf)) : lerp(base, lerp(0.095, ts - 0.03, uP / (hw - 1.2)), smoothstep(0, 1.2, Math.min(a - sp[0], sp[1] - a)));
    return base;
  };
  const colsOf = r => {
    const hw = r.w / 2, rut = r.w > 6 ? 1.1 : 0.72, ruts = r.d > 0.5 || r.chan === 'stone', c = [];
    if (r.sk[0]) c.push([-hw - SKW, 'sk']);
    c.push([-hw, 'e']); if (r.d > 0.5) c.push([-rut, 'rut']); c.push([0, 'mid']); if (ruts) c.push([rut, 'rut']);
    if (r.chan === 'stone') return c.concat([[hw - 1.2, 'ua'], [hw - 0.88, 'fl'], [hw - 0.5, 'fl'], [hw - 0.12, 'sk']]);   // behind the drain the bank dips into the ground
    if (r.chan === 'ditch') c.push([hw - 0.78, 'dt'], [hw - 0.4, 'dt']);
    c.push([hw, 'e']); if (r.sk[1]) c.push([hw + SKW, 'sk']);
    return c;
  };
  for (const r of runs) {
    const hw = r.w / 2, s = r.side, cols = colsOf(r);
    // rows along the run: split until the ground between them is near linear and each quad near planar (a folded quad lets the terrain through)
    const hAt = (a, u) => gb(...P(r, a, u));
    const rows = [r.a0], dev = (a0, a1) => {
      let d = 0; for (const u of [-hw, 0, hw]) for (const t of [0.25, 0.5, 0.75]) d = Math.max(d, Math.abs(hAt(lerp(a0, a1, t), u) - lerp(hAt(a0, u), hAt(a1, u), t)));
      for (const [u0, u1] of [[-hw, 0], [0, hw]]) d = Math.max(d, 0.8 * Math.abs(hAt(a0, u0) + hAt(a1, u1) - hAt(a1, u0) - hAt(a0, u1)));
      return d;
    };
    const split = (a0, a1) => { if (a1 - a0 > 3 && (a1 - a0 > 20 || dev(a0, a1) > 0.055)) { split(a0, (a0 + a1) / 2); split((a0 + a1) / 2, a1); } else rows.push(a1); };
    split(r.a0, r.a1);
    for (const [sa, sb] of r.spans) for (const a of [sa - 0.02, sa, sa + 1.2, sb - 1.2, sb, sb + 0.02]) if (a > r.a0 + 0.01 && a < r.a1 - 0.01) rows.push(a);
    // loose ends: one tucked under the way it meets dips at once; any other comes down flush with the ground over its last 2.5 m (unless a
    // drain ends there) and runs out 1.3 m beyond, sinking into the ground as it fades to bare earth
    r.ext = [0, 1].map(e => r.patch[e] ? 0 : r.tuck[e] ? SKW : solid.hit(rectOf(r, e ? r.a1 : r.a0 - TAP, e ? r.a1 + TAP : r.a0, -hw - 0.3, hw + 0.3)) || [TAP * 0.5, TAP].some(t => { const q = P(r, e ? r.a1 + t : r.a0 - t, 0); return onWay(...q) || inTerrace(...q, 1.5) || q[1] > 446 || otherTop(...q) > gb(...q) - 0.05; }) ? SKW : TAP);
    r.fade = [0, 1].map(e => r.ext[e] === TAP && r.a1 - r.a0 > 8 ? (r.spans.some(([sa, sb]) => e ? sb > r.a1 - 3.5 : sa < r.a0 + 3.5) ? 2 : 1) : 0);     // 2: only the half away from a drain that ends there
    for (const e of [0, 1]) if (r.fade[e]) rows.push(e ? r.a1 - 2.5 : r.a0 + 2.5);
    rows.sort((p, q) => p - q);
    r.rows = rows.filter((a, i) => i === 0 || a - rows[i - 1] > 0.012);
    const endRows = e => r.ext[e] > SKW ? [0.45, 1].map(t => (e ? 1 : -1) * r.ext[e] * t) : r.ext[e] ? [(e ? 1 : -1) * SKW] : [];
    const all = [...endRows(0).reverse().map(t => r.a0 + t), ...r.rows, ...endRows(1).map(t => r.a1 + t)];
    // between two rows the surface is straight while the drawn ground can bulge above that line (most in a drain's thin floor):
    // each vertex is lifted by the larger bulge of the two stretches beside it
    const bulge = cols.map(([uP, kind]) => {
      const b = new Float32Array(all.length); if (kind === 'sk') return b;
      for (let i = 0; i < all.length - 1; i++) {
        const a0 = all[i], a1 = all[i + 1]; if (a0 < r.a0 - 1e-6 || a1 > r.a1 + 1e-6) continue;
        const n = Math.max(2, Math.ceil((a1 - a0) / 1.1)), h0 = hAt(a0, uP * s), h1 = hAt(a1, uP * s); let m = 0;
        for (let t = 1; t < n; t++) m = Math.max(m, hAt(lerp(a0, a1, t / n), uP * s) - lerp(h0, h1, t / n));
        b[i] = Math.max(b[i], m); b[i + 1] = Math.max(b[i + 1], m);
      }
      return b;
    });
    earthGrid(all.length, cols.length, (i, j) => {
      const a0 = all[i], out = a0 < r.a0 - 1e-6 ? r.a0 - a0 : a0 > r.a1 + 1e-6 ? a0 - r.a1 : 0, a = clamp(a0, r.a0, r.a1), [uP, kind] = cols[j], [x, z] = P(r, a0, uP * s), f = 0.93 + R() * 0.13, sp = kind === 'fl' && r.chan === 'stone' && spanOf(r, a);
      const col = kind === 'sk' || kind === 'e' ? EDGE : kind === 'fl' ? (spanOf(r, a) ? WET : r.tint) : kind === 'dt' ? DITCH : r.tint.clone().multiplyScalar(kind === 'rut' ? (r.d > 0.5 ? 0.8 : 1) : kind === 'mid' ? (r.d > 0.5 ? 1.12 : 1.06) : 1);
      let lift = flush(liftOf(r, uP, kind, a), endFade(r, a, kind === 'ua' || kind === 'fl' || (kind === 'sk' && uP > 0) ? 1e3 : uP)) + (out ? 0 : Math.min(bulge[j][i] + (sp ? 0.008 : 0), sp ? Math.max(0, tstAt(r, a) - F_CH - 0.012) : 0.06));
      if (out) { const E_ = a0 < r.a0 ? r.ext[0] : r.ext[1], t = E_ > SKW ? smoothstep(0, 1, out / E_) : 1; lift = lerp(lift, E_ > SKW ? -0.05 : SKL, t); }
      const cc = out ? new THREE.Color().copy(col).lerp(EDGE, out / (a0 < r.a0 ? r.ext[0] : r.ext[1]) > 0.99 ? 1 : 0.6) : col;
      if (dbg && kind === 'fl') ((r.flY ||= [])[i] ||= [a0])[j] = gb(x, z) + lift;
      return [x, gb(x, z) + lift, z, cc.r * f, cc.g * f, cc.b * f];
    });
    walk.push([rectOf(r, r.a0, r.a1, -hw, hw), (x, z) => { const dx = x - r.ox, dz = z - r.oz, a = dx * r.dx + dz * r.dz, u = dx * r.nx + dz * r.nz; return a < r.a0 || a > r.a1 || Math.abs(u) > hw ? -Infinity : gb(x, z) + flush(liftOf(r, u * s, '', a, true), endFade(r, a, r.chan === 'stone' && u * s > r.w / 2 - 1.25 ? 1e3 : u * s)); }]);
    if (r.chan !== 'stone') continue;
    // the drain: two courses of edging stones, their tops just proud of the street, either side of a dark channel sunk to the ground
    const nIn = [r.nx * s, 0, r.nz * s], nOut = [-r.nx * s, 0, -r.nz * s], UP = [0, 1, 0], off = R() * 3;
    const pt = (a, uP, dy) => { const [x, z] = P(r, a, uP * s); return [x, gb(x, z) + dy, z]; };
    for (const [sa, sb] of r.spans) {
      const sr = r.rows.filter(a => a >= sa - 1e-6 && a <= sb + 1e-6);
      for (let i = 0; i < sr.length - 1; i++) {
        const a0 = sr[i], a1 = sr[i + 1], A = a0 + off, Bq = a1 + off, jt = (R() - 0.5) * 0.01, t0 = tstAt(r, a0) + jt, t1 = tstAt(r, a1) + jt;
        const top = (u0, u1) => lining.add(pt(a0, u0, t0), pt(a1, u0, t1), pt(a1, u1, t1), pt(a0, u1, t0), [A, u0, Bq, u0, Bq, u1, A, u1], UP);
        const face = (u, y0, n) => lining.add(pt(a0, u, y0), pt(a1, u, y0), pt(a1, u, t1), pt(a0, u, t0), [A, y0, Bq, y0, Bq, T_ST, A, T_ST], n);
        top(hw - 1.2, hw - 0.88); top(hw - 0.5, hw - 0.18); face(hw - 0.88, F_CH - 0.03, nIn); face(hw - 0.5, F_CH - 0.03, nOut); face(hw - 0.18, -0.08, nIn);
      }
      // each end of the channel: on into the next drain at the corner, a sump under a pierced cover slab at a crossing, else a closing stone
      for (const [a, e] of [[sa, 0], [sb, 1]]) {
        const atEnd = e ? sb >= r.a1 - 0.01 : sa <= r.a0 + 0.01;
        if (atEnd && r.joined[e]) continue;
        if (!atEnd || !r.sumpE[e]) { stoneAt(r, e ? a + 0.02 : a - 0.02, 0.6, 1.16, 0.34, T_ST + 0.018); continue; }
        // the cover lies on the lining where it starts down and comes down with it to the crossing, its low edge just proud of the crossing's crown
        const rut = r.w > 6 ? 1.1 : 0.72, uS = hw - 1.27, uO = hw - 0.09, aH = e ? a - 1.22 : a + 1.22, aL = e ? a + 0.01 : a - 0.01, hi = sumpTop(hw, rut, 0, 1), low = u => sumpTop(hw, rut, u, 0);
        const cs = [[aH, uS], [aL, uS], [aL, uO], [aH, uO]].map(([aa, u]) => P(r, aa, s * u)), top = [hi, low(uS), low(uO), hi].map((t, i) => gb(...cs[i]) + t);
        slab(lining, cs, top, cs.map(q => gb(...q) - 0.06)); if (dbg) (dbg.sumps ||= []).push({ cs, top });
        const [hx, hz] = P(r, e ? a - 0.36 : a + 0.36, s * (hw - 0.69));
        const tA = (top[0] + top[3] - top[1] - top[2]) / 2 / (aH - aL), tU = (top[2] + top[3] - top[0] - top[1]) / 2 / (s * (uO - uS)), N = new THREE.Vector3(-(tA * r.dx + tU * r.nx), 1, -(tA * r.dz + tU * r.nz)).normalize();   // the hole lies in the slope
        B.doors.add(new THREE.CircleGeometry(0.13, 8).rotateX(-Math.PI / 2).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), N)).translate(hx, gb(hx, hz) + lerp(low(hw - 0.69), hi, 0.37 / 1.23) + 0.004, hz));
      }
      // cover slabs: often in the busy streets, at the house doors, rarely in the outskirts
      const gap = r.d > 0.55 ? [9, 8] : r.d > 0.4 ? [14, 10] : [22, 14], slabs = [];
      for (let a = sa + 1.8 + R() * gap[0]; a < sb - 1.3; a += gap[0] + R() * gap[1]) slabs.push(a);
      if (r.axis === 'x') for (const h of r.hs) { const d = h.door; if (Math.abs(d.z - (r.c + s * hw)) < 4 && Math.sign(d.nz) === -s && d.x > sa + 1.3 && d.x < sb - 1.3 && slabs.every(q => Math.abs(q - d.x) > 1.2)) slabs.push(d.x); }
      for (const a of slabs) stoneAt(r, a, 0.62 + R() * 0.28, 1.12, 0.11, T_ST + 0.028, (R() - 0.5) * 0.06);
      occ.add(rectOf(r, sa - 0.6, sb + 0.6, s * (hw - 1.2), s * (hw - 0.14)));
    }
  }
  function stoneAt(r, a, along, across, thick, top, rot = 0, tilt = 0) {   // a squared stone across the drain of run r at a (top above the ground; tilt: sloping along the run)
    const hw = r.w / 2, [x, z] = P(r, a, r.side * (hw - 0.68)), y = Math.max(gb(x, z), gb(...P(r, a, r.side * (hw - 1.2))), gb(...P(r, a, r.side * (hw - 0.14)))) + top;
    const g = box(along, thick, across); g.setIndex([...g.index.array.slice(0, 18), ...g.index.array.slice(24)]);     // no underside
    B.socles.add(g, mat(x, y - thick / 2, z, 0, (r.axis === 'z' ? Math.PI / 2 : 0) + rot, 0).multiply(mat(0, 0, 0, 0, 0, tilt)));
    return y;
  }
  // ditches: planks at the doors on that side
  for (const r of runs) {
    if (r.chan !== 'ditch' || r.axis !== 'x') continue;
    const hw = r.w / 2, edge = r.c + r.side * hw;
    for (const h of r.hs) {
      const d = h.door;
      if (Math.abs(d.z - edge) < 4 && Math.sign(d.nz) === -r.side && d.x > r.a0 + 1.4 && d.x < r.a1 - 1.4 && !solid.hit(rectOf(r, d.x - 0.5, d.x + 0.5, r.side * (hw - 1.2), r.side * (hw - 0.1)))) {
        const [x, z] = P(r, d.x, r.side * (hw - 0.59)); B.socles.add(box(0.7, 0.08, 0.86), mat(x, gb(x, z) + 0.05, z, 0, (R() - 0.5) * 0.08, 0));
      }
    }
  }
  mark('street surfaces + drains');
  if (dbg) Object.assign(dbg, { runObjs: runs, liftOf, gb, P, colsOf, grassAt });
  if (dbg) dbg.surf = { earth: E.i.length / 3, lining: lining.i.length / 3, runs: runs.length, rows: runs.reduce((n, r) => n + r.rows.length, 0), cols: runs.reduce((n, r) => n + colsOf(r).length, 0), len: runs.reduce((n, r) => n + r.a1 - r.a0, 0), stone: runs.filter(r => r.chan === 'stone').length, skirt: runs.filter(r => r.skirt).length, spanLen: runs.reduce((n, r) => n + r.spans.reduce((m, q) => m + q[1] - q[0], 0), 0) };
  // crossings: the crowns of both streets meet (the higher wins); a side with no street ends in an edge and a skirt
  for (const pc of patches) {
    const { x, z, hx, hz } = pc, zOn = pc.zN || pc.zS, xOn = pc.xW || pc.xE, el = pc.adj.some(r => r.sk[0] || r.sk[1]) ? 0.04 : 0.025, rx = hx > 3 ? 1.1 : 0.72, rz = hz > 3 ? 1.1 : 0.72;
    const rutted = q => q && (q.d > 0.5 || q.chan === 'stone'), rU = rutted(pc.zN) || rutted(pc.zS) ? [-rx, 0, rx] : [0], rV = rutted(pc.xW) || rutted(pc.xE) ? [-rz, 0, rz] : [0];     // rut rows only where a rutted street comes in
    const us = [...(pc.xW ? [] : [-hx - SKW]), -hx, ...rU, hx, ...(pc.xE ? [] : [hx + SKW])], vs = [...(pc.zN ? [] : [-hz - SKW]), -hz, ...rV, hz, ...(pc.zS ? [] : [hz + SKW])];
    const tint = pc.adj.reduce((c, r) => c.add(r.tint), new THREE.Color(0, 0, 0)).multiplyScalar(1 / pc.adj.length);
    const fac = (t, h, r) => Math.abs(t) >= h - 1e-6 ? 0 : Math.abs(t) < 1e-6 ? 1.1 : Math.abs(t) <= r + 1e-6 ? 0.88 : 1;
    const L = us.map(() => []);
    earthGrid(us.length, vs.length, (i, j) => {
      const u = us[i], v = vs[j], px = x + u, pz = z + v, f = 0.93 + R() * 0.13;
      if (Math.abs(u) > hx + 1e-6 || Math.abs(v) > hz + 1e-6) { L[i][j] = SKL; return [px, gb(px, pz) + SKL, pz, EDGE.r * f, EDGE.g * f, EDGE.b * f]; }
      let lz = zOn ? crown(u, hx, rx, el) : el, lx = xOn ? crown(v, hz, rz, el) : el;
      if (zOn && ((v < 0 && !pc.zN) || (v > 0 && !pc.zS))) lz = lerp(lz, el, smoothstep(0, hz, Math.abs(v)));
      if (xOn && ((u < 0 && !pc.xW) || (u > 0 && !pc.xE))) lx = lerp(lx, el, smoothstep(0, hx, Math.abs(u)));
      const l = L[i][j] = Math.max(lz, lx), e = Math.max(zOn ? fac(u, hx, rx) : 0, xOn ? fac(v, hz, rz) : 0), c = l <= el + 1e-4 || !e ? EDGE : tint.clone().multiplyScalar(e);
      return [px, gb(px, pz) + l, pz, c.r * f, c.g * f, c.b * f];
    });
    const xs = us.map(u => x + u), zs = vs.map(v => z + v);
    walk.push([rectC(x, z, hx, hz), (qx, qz) => { const l = gridAt(xs, zs, L, qx, qz); return l === null ? -Infinity : gb(qx, qz) + l; }]);
  }
  function gridAt(xs, zs, Y, x, z) {      // bilinear lookup on a rectilinear grid Y[i][j] at (xs[i], zs[j])
    const bs = (a, v) => { let lo = 0, hi = a.length - 1; if (!(v >= a[0] && v <= a[hi])) return -1; while (hi - lo > 1) { const md = (lo + hi) >> 1; if (a[md] <= v) lo = md; else hi = md; } return lo; };
    const i = bs(xs, x), j = bs(zs, z); if (i < 0 || j < 0) return null;
    const t = (x - xs[i]) / (xs[i + 1] - xs[i]), u = (z - zs[j]) / (zs[j + 1] - zs[j]);
    return lerp(lerp(Y[i][j], Y[i][j + 1], u), lerp(Y[i + 1][j], Y[i + 1][j + 1], u), t);
  }
  mark('crossings');

  // ---------- the platea: slab paving between kerbs, honorific statues, the stair lions ----------
  // the paving runs from the side street at x = -350 to the one at 370, beyond which the way climbs the flanks as packed earth
  const PX0 = -347.5, PX1 = 367.5, PZ0 = 56, PZ1 = 72, pavLift = 0.12;
  const zc = [PZ0 + 0.3]; for (let i = 1; i <= 10; i++) zc.push(lerp(PZ0 + 0.3, PZ1 - 0.3, i / 10));      // height rows = slab course joints
  const pxs = [PX0, PX1, -6.5, 6.5]; for (let x = Math.ceil(PX0 / 2.5) * 2.5; x < PX1; x += 2.5) if (x > PX0 + 0.5 && x < PX1 - 0.5 && Math.abs(Math.abs(x) - 6.5) > 0.6) pxs.push(x);
  pxs.sort((a, b) => a - b);
  // the city's gravel strips are sampled every 5 m with 3 vertices across, so over the dip at the foot of the precinct they ride
  // well above the ground: paving and the avenue's surface are laid over whichever is higher, that strip or the ground
  const roadTris = new Map();
  for (const rd of layout.roads || []) {
    const g = ctx.kit.roadGeometry(rd.pts, rd.width), p = g.attributes.position, ix = g.index.array;
    for (let t = 0; t < ix.length; t += 3) {
      const tr = [0, 1, 2].map(k => [p.getX(ix[t + k]), p.getY(ix[t + k]), p.getZ(ix[t + k])]);
      for (let i = Math.floor(Math.min(...tr.map(v => v[0])) / 8); i <= Math.floor(Math.max(...tr.map(v => v[0])) / 8); i++) for (let j = Math.floor(Math.min(...tr.map(v => v[2])) / 8); j <= Math.floor(Math.max(...tr.map(v => v[2])) / 8); j++) { const k = i * 65536 + j; let l = roadTris.get(k); if (!l) roadTris.set(k, l = []); l.push(tr); }
    }
  }
  const roadTop = (x, z) => {
    let top = -Infinity;
    for (const [a, b, c] of roadTris.get(Math.floor(x / 8) * 65536 + Math.floor(z / 8)) || []) {
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]); if (Math.abs(d) < 1e-9) continue;
      const l1 = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, l2 = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, l3 = 1 - l1 - l2;
      if (l1 > -1e-6 && l2 > -1e-6 && l3 > -1e-6) top = Math.max(top, l1 * a[1] + l2 * b[1] + l3 * c[1]);
    }
    return top;
  };
  // the city's platea strip leaves a gap before the Mausoleum stair (|x| < 9): the paving bridges it as the strip would have run
  const stripTop = (x, z) => { if (Math.abs(x) >= 9.3 || Math.abs(z - 64) > 8) return roadTop(x, z); const a = roadTop(-9.3, z), b = roadTop(9.3, z); return a > -1e9 && b > -1e9 ? lerp(a, b, (x + 9.3) / 18.6) : roadTop(x, z); };
  const overRoad = (x, z, lift, m = 0.4) => Math.max(gb(x, z) + lift, Math.max(stripTop(x - m, z), stripTop(x + m, z), stripTop(x, z - m), stripTop(x, z + m), stripTop(x, z)) + 0.08);
  const pavY = pxs.map(x => zc.map(z => overRoad(x, z, pavLift)));
  const pavGrid = (x, z) => gridAt(pxs, zc, pavY, clamp(x, PX0, PX1), clamp(z, zc[0], zc[zc.length - 1]));
  // at the foot of the Mausoleum stair the paving runs back over the two lowest steps (below the city's strip) to the riser of the
  // step at -4.8, where a threshold course closes it; it blends into the way over 1.5 m
  const SF0 = 53.9 + 12 * 0.55, SFY = -4.8, stripY = z => lerp(-3.868, -5.538, (z - 56) / 8);
  let paveSkirts;
  const pavAt = (x, z) => Math.abs(x) <= 6.5 && z < SF0 + 1.5 ? Math.max(lerp(SFY - 0.01, pavGrid(x, z), smoothstep(SF0 + 0.1, SF0 + 1.5, z)), stripY(Math.max(z, SF0 + 0.34)) + 0.03) : pavGrid(x, z);
  {   // courses of big sandstone slabs, 1.54 m wide, laid along the way; every 5–10 m a course takes another stretch of the texture (any of
    // its four courses, either way round), stretched a little so that the change falls on one of the texture's own joints at both ends
    const nc = pxs.length, CW = (PZ1 - 0.3 - zc[0]) / 10, K = 0.75 / CW;       // the texture has four courses to a tile: joints at v ≡ 0.545 (mod 0.75)
    const JOINT = [[0.293, 0.435, 0.926], [0.202, 0.505, 0.842], [0.262, 0.581, 0.895], [0.132, 0.516, 0.723]];    // the joints along each course (tile fractions; the tile is 3 m of uv)
    const tone = pxs.map(() => zc.map(() => 0.86 + R() * 0.2));
    for (let c = 0; c < 10; c++) {
      const c0 = zc[c], c1 = zc[c + 1];
      for (let i0 = 0; i0 < nc - 1;) {
        const i1 = Math.min(nc - 1, i0 + 2 + Math.floor(R() * 3)), L = pxs[i1] - pxs[i0], row = Math.floor(R() * 4), dir = R() < 0.5 ? -1 : 1, fv = R() < 0.5, o = pave.p.length / 3, w = i1 - i0 + 1;
        const J = JOINT[row], U0 = 3 * (J[Math.floor(R() * 3)] + Math.floor(R() * 4)), gt = 0.9 + R() * 0.16;      // gt: each stretch a shade of its own
        let fu = dir * K, best = 0.2;
        for (let n = -4; n <= 8; n++) for (const j of J) { const q = (3 * (j + n) - U0) / (dir * L) / K - 1; if (Math.abs(q) < best) { best = Math.abs(q); fu = dir * K * (1 + q); } }
        const ou = U0 - fu * pxs[i0], ov = 0.545 + 0.75 * row;
        const foot = pxs[i0] < 6.5 && pxs[i1] > -6.5, rowsZ = [c0, ...(foot ? [SF0 + 0.1, SF0 + 0.5, SF0 + 1.0, 61.65, SF0 + 1.5] : []).filter(q => q > c0 + 0.05 && q < c1 - 0.05), c1];
        for (const z of rowsZ) for (let i = i0; i <= i1; i++) { const x = pxs[i], t = (z - c0) / (c1 - c0), f = lerp(tone[i][c], tone[i][c + 1], t) * gt; pave.p.push(x, pavAt(x, z), z); pave.u.push(x * fu + ou, ov + (fv ? c1 - z : z - c0) * K); pave.c.push(f, f * 0.99, f * 0.97); }
        for (let r = 0; r < rowsZ.length - 1; r++) for (let i = i0; i < i1; i++) {
          if (rowsZ[r + 1] <= SF0 + 0.11 && pxs[i] >= -6.5 && pxs[i + 1] <= 6.5) continue;   // not over the upper steps
          const q = o + r * w + (i - i0), v = q + w; pave.i.push(q, v, q + 1, q + 1, v, v + 1);
        }
        i0 = i1;
      }
    }
    paveSkirts = cover => {          // skirts under the paving's edges, seen where the kerb opens for a side street (cover: the kerb stones laid along each edge)
    const sk = new Quads(), hidden = (l, x0, x1) => { let x = x0; for (const [a, b] of l) { if (a > x + 0.03) break; x = Math.max(x, b); } return x >= x1 - 0.03; };
    for (const l of cover) l.sort((p, q) => p[0] - q[0]);
    for (let i = 0; i < nc - 1; i++) for (const [j, nz] of [[0, -1], [zc.length - 1, 1]]) {
      const x0 = pxs[i], x1 = pxs[i + 1], z = zc[j]; if (hidden(cover[j ? 1 : 0], x0, x1)) continue;
      sk.add([x0, gh(x0, z) - 0.15, z], [x1, gh(x1, z) - 0.15, z], [x1, pavY[i + 1][j], z], [x0, pavY[i][j], z], [x0, 0, x1, 0, x1, 0.3, x0, 0.3], [0, 0, nz]);
    }
    for (const [i, nx] of [[0, -1], [nc - 1, 1]]) for (let j = 0; j < zc.length - 1; j++) { const x = pxs[i], z0 = zc[j], z1 = zc[j + 1]; sk.add([x, gh(x, z0) - 0.15, z0], [x, gh(x, z1) - 0.15, z1], [x, pavY[i][j + 1], z1], [x, pavY[i][j], z0], [z0, 0, z1, 0, z1, 0.3, z0, 0.3], [nx, 0, 0]); }
    const sg = sk.geom(), sp = sg.attributes.position, su = sg.attributes.uv, o = pave.p.length / 3;
    for (let i = 0; i < sp.count; i++) { pave.p.push(sp.getX(i), sp.getY(i), sp.getZ(i)); pave.u.push(su.getX(i) * 0.3, su.getY(i) * 0.3); pave.c.push(0.9, 0.89, 0.87); }
    for (const i of sg.index.array) pave.i.push(o + i);
    };
  }
  world.extraGround.push((x, z) => (x > PX0 && x < PX1 && z > PZ0 + 0.3 && z < PZ1 - 0.3 && !(Math.abs(x) < 6.5 && z < SF0)) ? pavAt(x, z) : -Infinity);

  // another feature's stair or floor already laid here (sampled over the rectangle, pad m beyond it)
  const hasOther = (x, z) => otherTop(x, z) > gb(x, z) - 0.05;
  const underOther = (r, m = 0) => { for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) if (hasOther(lerp(r.minX - m, r.maxX + m, i / 4), lerp(r.minZ - m, r.maxZ + m, j / 2))) return true; return false; };
  // kerb stones: rows of sandstone blocks, broken where a street comes in or something already stands
  function kerbRow(axis, c, a0, a1, gaps, topAt, width = 0.34, cover = []) {
    let a = a0, open = true;
    while (a < a1 - 0.3) {
      const L = Math.min(a1 - a, 1.5 + R() * 1.1), b = a + L;
      const blocked = gaps.some(([g0, g1]) => a < g1 && b > g0);
      const [x0, z0] = axis === 'x' ? [a, c] : [c, a], [x1, z1] = axis === 'x' ? [b, c] : [c, b];
      const rr = axis === 'x' ? { minX: a, maxX: b, minZ: c - width / 2, maxZ: c + width / 2 } : { minX: c - width / 2, maxX: c + width / 2, minZ: a, maxZ: b };
      if (blocked || solid.hit(rr, 0.05) || layout.isReserved(rr) || nearRoad((x0 + x1) / 2, (z0 + z1) / 2, 0.3) || underOther(rr, 0.3)) { open = true; a = b + 0.01; continue; }
      occ.add(rr); cover.push([a, b]);
      const j = (R() - 0.5) * 0.025, t0 = topAt(x0, z0) + j, t1 = topAt(x1, z1) + j, d = width / 2;
      const q = axis === 'x' ? (aa, side, y) => [aa, y, c + side * d] : (aa, side, y) => [c + side * d, y, aa];
      const lo = (x, z) => gb(x, z) - 0.14, off = R() * 3;
      const A0 = q(a, -1, t0), A1 = q(b, -1, t1), B0 = q(a, 1, t0), B1 = q(b, 1, t1);
      const nS = axis === 'x' ? [0, 0, 1] : [1, 0, 0], nN = nS.map(v => -v), nA = axis === 'x' ? [-1, 0, 0] : [0, 0, -1];
      kerb.add(A0, A1, B1, B0, [off, 0, off + L, 0, off + L, width, off, width], [0, 1, 0]);
      kerb.add(q(a, -1, lo(x0, z0)), q(b, -1, lo(x1, z1)), A1, A0, [off, 0, off + L, 0, off + L, 0.3, off, 0.3], nN);
      kerb.add(q(a, 1, lo(x0, z0)), q(b, 1, lo(x1, z1)), B1, B0, [off, 0, off + L, 0, off + L, 0.3, off, 0.3], nS);
      if (open) kerb.add(q(a, -1, lo(x0, z0)), q(a, 1, lo(x0, z0)), B0, A0, [0, 0, width, 0, width, 0.3, 0, 0.3], nA);
      const nextBlocked = gaps.some(([g0, g1]) => b + 0.01 < g1 && b + 0.9 > g0);
      if (nextBlocked || b >= a1 - 0.3) kerb.add(q(b, -1, lo(x1, z1)), q(b, 1, lo(x1, z1)), B1, A1, [0, 0, width, 0, width, 0.3, 0, 0.3], nA.map(v => -v));
      open = false; a = b + 0.012;
    }
  }
  const crossX = []; for (let k = GRID.k0; k <= GRID.k1 + 1; k++) crossX.push([streetX(k) - swX(k) / 2 - 0.3, streetX(k) + swX(k) / 2 + 0.3, k]);
  const crossZ = []; for (let m = GRID.m0; m <= GRID.m1 + 1; m++) crossZ.push([streetZ(m) - swZ(m) / 2 - 0.3, streetZ(m) + swZ(m) / 2 + 0.3, m]);
  const pavKerbTop = (x, z) => pavAt(x, z) + 0.11;
  const kerbCover = [[], []];
  kerbRow('x', PZ0 + 0.17, PX0, PX1, [...crossX.filter(g => Math.abs(g[0] + g[1]) / 2 > 124), [-7.75, 7.75]], pavKerbTop, undefined, kerbCover[0]);
  kerbRow('x', PZ1 - 0.17, PX0, PX1, crossX, pavKerbTop, undefined, kerbCover[1]);
  paveSkirts(kerbCover);
  for (const x of [PX0 + 0.17, PX1 - 0.17]) kerbRow('z', x, PZ0 + 0.34, PZ1 - 0.34, [], pavKerbTop);       // a threshold course where the paving ends
  kerbRow('x', SF0 + 0.17, -6.45, 6.45, [], () => SFY + 0.006);        // and one against the stair's lowest visible step
  const aveTop = (x, z) => overRoad(x, z, 0.1, 0.9) + 0.14, AVE1 = 440.3;       // the avenue's surface ends at the quay's edge
  // where it reaches the quay, a threshold of big slabs across the way at the quay's height covers the end of the city's road strip
  const THR = [440.2, 442.3], thrTop = x => Math.max(otherTop(x, 441.3), roadTop(x, 441.3), roadTop(x, 442), gb(x, 441.3)) + 0.018;
  {   // the avenue's surface inside the kerbs, and the platea's continuation up the flanks: crowned earth sampled finer than the city's road strip
    const crownGrid = (along, across, lift, fac, a0, a1, o5, endTo) => {      // rows on the city strip's own 5 m rows (o5: where that strip starts), so the two stay parallel
      const base = new THREE.Color(...DIRT.map(c => lerp(c, 1.0, 0.65) * 1.12)), as = [a0], Y = [], mask = new Set();
      for (let a = o5 + 5 * Math.ceil((a0 - o5) / 5 + 0.01); a < a1 - (endTo ? 1.8 : 0.3); a += 5) if (a > a0 + 0.3) as.push(a);
      if (endTo) as.push(a1 - 1.5);       // endTo: the last row comes down to meet (and tuck under) the threshold
      as.push(a1);
      // where another feature's stair or floor comes in, the way dips under it and leaves the walking to that floor: the 1 m cells it
      // touches (at a corner or the centre) are marked, and in those the walk asks that floor point by point
      for (let a = Math.floor(a0); a <= a1; a++) for (let u = Math.floor(across[0]); u <= across[across.length - 1]; u++) {
        const [x, z] = along === 'z' ? [u + 0.5, a + 0.5] : [a + 0.5, u + 0.5];
        if ([[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].some(([ox, oz]) => hasOther(x + ox, z + oz))) mask.add(Math.floor(x) * 4096 + Math.floor(z));
      }
      earthGrid(as.length, across.length, (i, j) => {
        const [x, z] = along === 'z' ? [across[j], as[i]] : [as[i], across[j]], f = fac[j] * (0.94 + R() * 0.12), o = mask.size ? otherTop(x, z) : -Infinity;
        let y = overRoad(x, z, lift[j], 0.9) + (lift[j] - 0.1) * 0.5; if (o > gb(x, z) - 0.05) y = Math.min(y, o - 0.04);
        if (endTo && i === as.length - 1) y = endTo(x);
        (Y[i] ||= [])[j] = y; return [x, y, z, base.r * f, base.g * f, base.b * f];
      });
      const [xs, zs, G2] = along === 'z' ? [across, as, across.map((_, j) => as.map((_, i) => Y[i][j]))] : [as, across, Y];
      walk.push([{ minX: xs[0], maxX: xs[xs.length - 1], minZ: zs[0], maxZ: zs[zs.length - 1] }, (x, z) => mask.has(Math.floor(x) * 4096 + Math.floor(z)) && hasOther(x, z) ? -Infinity : gridAt(xs, zs, G2, x, z) ?? -Infinity]);
    };
    const lift = [0.1, 0.12, 0.13, 0.15, 0.13, 0.12, 0.1], fac = [0.86, 0.96, 0.8, 1.1, 0.8, 0.96, 0.86];
    for (const [z0, z1] of [[-57.5, PZ0], [PZ1, AVE1]]) crownGrid('z', [139.33, 141.2, 143.3, 145, 146.7, 148.8, 150.67], lift, fac, z0, z1, -58, z1 === AVE1 ? x => thrTop(x) - 0.012 : null);     // past the agora's east stoa down to the quay
    for (const [x0, x1] of [[-468, PX0 + 0.05], [PX1 - 0.05, 468]]) crownGrid('x', [57.4, 59.4, 61.7, 64, 66.3, 68.6, 70.6], lift, fac, x0, x1, -470);
  }
  for (const x of [139.17, 150.83]) kerbRow('z', x, -57.5, THR[0] - 0.01, [...crossZ.filter(g => g[2] !== 0), [PZ0 - 0.5, PZ1 + 0.5]], aveTop);
  for (let x = 139.0; x < 150.95;) {       // the threshold's slabs, 1.5–2.2 m along it, laid level
    const L = 1.5 + R() * 0.7, x1 = x + L > 150.2 ? 151.0 : x + L, rr = { minX: x + 0.006, maxX: x1 - 0.006, minZ: THR[0], maxZ: THR[1] };
    if (!solid.hit(rr, 0.02)) {
      const y = Math.max(thrTop(x), thrTop(x1)) + (R() - 0.5) * 0.006, lo = Math.min(gb(x, THR[0]), gb(x1, THR[1])) - 0.12, off = R() * 3;
      const c = [[rr.minX, rr.minZ], [rr.maxX, rr.minZ], [rr.maxX, rr.maxZ], [rr.minX, rr.maxZ]];
      kerb.add([c[0][0], y, c[0][1]], [c[1][0], y, c[1][1]], [c[2][0], y, c[2][1]], [c[3][0], y, c[3][1]], [off, 0, off + x1 - x, 0, off + x1 - x, 2.1, off, 2.1], [0, 1, 0]);
      for (let e = 0; e < 4; e++) { const A = c[e], Bq = c[(e + 1) % 4], n = [Math.sign(Bq[1] - A[1]), 0, -Math.sign(Bq[0] - A[0])], Lq = Math.hypot(Bq[0] - A[0], Bq[1] - A[1]); kerb.add([A[0], lo, A[1]], [Bq[0], lo, Bq[1]], [Bq[0], y, Bq[1]], [A[0], y, A[1]], [off, 0, off + Lq, 0, off + Lq, y - lo, off, y - lo], n); }
      occ.add(rr); walk.push([rr, (qx, qz) => qx >= rr.minX && qx <= rr.maxX && qz >= rr.minZ && qz <= rr.maxZ ? y : -Infinity]);
    }
    x = x1;
  }
  mark('paving, kerbs, avenue');
  if (dbg) dbg.kerbTris = [kerb.i.length / 3, pave.i.length / 3];

  // honorific statues on moulded bases, both sides, and a pair of lions at the foot of the Mausoleum stair
  R = rng(4711);
  const MSLOT = 'terra', MHI = 0xfff1dc, MLO = 0xf0e4d0;     // marble figures: warm stone in the textured bucket
  const FIG = [{ seed: 61, draped: 'full' }, { seed: 62, draped: 'full', female: true }, { seed: 63, draped: 'short', spear: true }, { seed: 64, draped: 'none', spear: true, shield: true }, { seed: 65, draped: 'none' }, { seed: 67, draped: 'full' }].map(o => figureGeometry(o));
  const FIG_MID = FIG.map((g, i) => i === 3 || i === 4 ? null : lowPoly(g, 0.05)), FIG_LO = FIG.map((g, i) => i === 3 || i === 4 ? null : lowPoly(g, y => y > 1.5 ? 0.035 : 0.07));   // draped figures only; far out the head keeps its face and hair
  const baseG = rectSweep(1.08, 1.08, [{ o: 0.21, y: 0 }, { o: 0.21, y: 0.16, hard: true }, { o: 0.08, y: 0.28 }, { o: 0, y: 0.36, hard: true }, { o: 0, y: 1.7, hard: true }, { o: 0.08, y: 1.78 }, { o: 0.18, y: 1.92, hard: true }], { top: true });
  const panelG = mergeN([box(0.6, 0.32, 0.02), ...[[0.74, 0.06, 0, 0.19], [0.74, 0.06, 0, -0.19], [0.07, 0.32, 0.335, 0], [0.07, 0.32, -0.335, 0]].map(([w, h, ox, oy]) => box(w, h, 0.07).translate(ox, oy, 0.015))]);
  const baseStone = { socles: baseG }, panelMarble = { pave: panelG }, panelBronze = { socles: panelG };
  const lettersP = [907, 911].map(sd => {      // the inscription: rows of short cut letters, dark in the stone
    const RL = rng(sd), q = [];
    for (const [y, w] of [[0.08, 0.46], [0.01, 0.5], [-0.06, 0.34]]) for (let x = -w / 2; x < w / 2 - 0.025;) { const l = Math.min(0.04 + RL() * 0.06, w / 2 - x); q.push(new THREE.PlaneGeometry(l, 0.017).translate(x + l / 2, y + (RL() - 0.5) * 0.004, 0.0135)); x += l + 0.016 + (RL() < 0.2 ? 0.02 : 0); }
    return proto([['paint', mergeN(q), 0x6e665a]]);
  });
  const statueAt = (px, z, side, fi, turn, isBronze = R() < 0.4, lv) => {
    const ax = Math.abs(px), rr = rectC(px, z, 0.8, 0.8), y = Math.min(pavAt(px - 0.7, z), pavAt(px + 0.7, z)) - 0.03;
    lv ||= ax < 20 ? 'full' : ax < 160 ? 'mid' : 'lo';     // full detail by the Mausoleum stair, the simplest only east of the avenue and far west
    if (fi === 3 || fi === 4) fi = fi === 3 ? 5 : 1;    // no nudes: the shared figure's nude has a mannequin's round belly
    if (lv === 'lo' && fi === 2) fi = 0;                  // and far out long drapery only: simplified bare legs go to spikes
    const fig = (lv === 'lo' ? FIG_LO : lv === 'full' ? FIG : FIG_MID)[fi], stone = baseStone;   // moulded sandstone bases; the marbles' inscribed panels a lighter stone
    put(stone, mat(px, y, z, 0, (R() - 0.5) * 0.04, 0));
    const pm = mat(px, y + 1.2, z - side * 0.55, 0, side < 0 ? 0 : Math.PI, 0);
    put(isBronze ? panelBronze : panelMarble, pm); put(lettersP[fi % 2], pm);        // the inscribed panel in its frame
    const m = mat(px, y + 1.92, z, 0, (side < 0 ? 0 : Math.PI) + turn, 0, 1.08 + R() * 0.12);
    if (dbg) { (dbg.statues ||= {})[lv] = (dbg.statues[lv] || 0) + 1; (dbg.statues.tris ||= {})[lv] = (dbg.statues.tris[lv] || 0) + fig.index.count / 3; dbg.corners.push({ kind: isBronze ? 'bronze' : 'marbleStatue', x: px, z }); }
    if (isBronze) own.bronze.push(patina(fig.clone(), pick(BRZ), R() * 6).applyMatrix4(m)); else own[MSLOT].push(marbleTone(lv === 'lo' ? MLO : MHI, 0.03, 1.77)(fig.clone()).applyMatrix4(m));     // far out a weathered, greyer marble
    claim(rr);
    addPoi({ type: 'view', x: px, z: z - side * 2.2, y: pavAt(px, z - side * 2.2), ry: side < 0 ? Math.PI : 0, r: 1.2, owner: name, note: 'honorific statue' });
  };
  // other features' stairs and gates opening onto the platea (two matching cheek walls on its edge): a pair of statues flanks each,
  // and no single statue crowds it; nor does one stand in front of a door or a yard gate
  const keep = { [-1]: [], [1]: [] }, SZ = { [-1]: PZ0 + 1.68, [1]: PZ1 - 1.68 };
  for (const side of [-1, 1]) {
    const ez = side < 0 ? PZ0 : PZ1;
    const cheeks = world.colliders.filter(c => !mineC.has(c) && Math.abs((side < 0 ? c.maxZ : c.minZ) - ez) < 1.2 && c.maxZ - c.minZ > 3 && c.maxX - c.minX >= 0.8 && c.maxX - c.minX < 2.5 && c.minX > PX0 && c.maxX < PX1).sort((p, q) => p.minX - q.minX);
    for (let i = 0; i < cheeks.length; i++) for (let j = i + 1; j < cheeks.length; j++) {
      const a = cheeks[i], b = cheeks[j], gap = b.minX - a.maxX;
      if (gap < 5 || gap > 22 || Math.abs((a.maxX - a.minX) - (b.maxX - b.minX)) > 0.35 || Math.abs((a.maxZ - a.minZ) - (b.maxZ - b.minZ)) > 2.5) continue;
      const xa = a.minX - 1.3, xb = b.maxX + 1.3, z = SZ[side], fi = (i * 2 + 1) % FIG.length, br = R() < 0.5;
      if (free(rectC(xa, z, 0.8, 0.8), 0.1, false) && free(rectC(xb, z, 0.8, 0.8), 0.1, false)) { statueAt(xa, z, side, fi, 0.12, br, 'mid'); statueAt(xb, z, side, fi, -0.12, br, 'mid'); keep[side].push([xa - 12, xb + 12]); }
      else keep[side].push([a.minX - 4, b.maxX + 4]);
    }
    for (const p of layout.pois) if (p.owner !== name && p.x > PX0 && p.x < PX1 && (side < 0 ? p.z < ez + 0.5 && p.z > ez - 12 : p.z > ez - 0.5 && p.z < ez + 12)) {
      if (p.type === 'door') keep[side].push([p.x - 2.8, p.x + 2.8]);
      else if (p.type === 'stall' || p.type === 'work' || (p.type === 'gather' && /shop/.test(p.note || ''))) keep[side].push([p.x - 3, p.x + 3]);     // nor in front of a shop counter
    }
  }
  if (dbg) dbg.statueKeep = keep;
  for (const side of [-1, 1]) for (const dir of [-1, 1]) {
    const z = SZ[side], lim = dir > 0 ? PX1 - 9 : -PX0 - 9;
    let x = dir * (side < 0 ? 15.5 : 18 + R() * 4), n = 0;
    while (Math.abs(x) < lim && Math.abs(gh(x + 2, 64) - gh(x - 2, 64)) < 0.64) {     // until the way starts climbing the flanks
      let px = x, ok = false;
      for (const nudge of [0, 3, 6, 9, 12]) {        // a slot that is taken moves on a few metres before it is given up
        px = x + dir * nudge;
        for (let pass = 0; pass < 3; pass++) {
          for (const [g0, g1] of crossX) { const c = (g0 + g1) / 2, e = side > 0 || Math.abs(c) > 124 ? (g1 - g0) / 2 + 2.6 : 2.2; if (Math.abs(px - c) < e) px = c + dir * e; }     // north of the way only the lane line: no street there
          for (const [g0, g1] of keep[side]) if (px > g0 - 0.8 && px < g1 + 0.8) px = dir > 0 ? g1 + 0.8 : g0 - 0.8;
        }
        if ((ok = Math.abs(px) < lim && free(rectC(px, z, 0.8, 0.8), 0.1, false))) break;
      }
      if (ok) statueAt(px, z, side, (n * 2 + (side > 0 ? 1 : 0) + (dir > 0 ? 3 : 0)) % FIG.length, (R() - 0.5) * 0.35);
      x = (ok ? px : x) + dir * (Math.abs(px) < 152 ? 26 + R() * 8 : 38 + R() * 10); n++;
    }
  }
  {
    const lion = lowPoly(lionGeometry({ seed: 3, stride: 0.12 }), 0.07);
    for (const sx of [-1, 1]) {
      const x = sx * 10.4, z = PZ0 + 1.42, y = Math.min(pavAt(x, z - 1), pavAt(x, z + 1)) - 0.03, rr = rectC(x, z, 0.54, 1.0);
      if (!free(rr, 0.05, false)) continue;
      B.grey.add(rectSweep(0.8, 1.72, [{ o: 0.14, y: 0 }, { o: 0.14, y: 0.14, hard: true }, { o: 0, y: 0.22, hard: true }, { o: 0, y: 0.95, hard: true }, { o: 0.08, y: 1.05, hard: true }], { top: true }), mat(x, y, z));
      B.marble.add(lion, mat(x, y + 1.05, z + 0.08, 0, -Math.PI / 2, 0, 0.72));
      claim(rr);
    }
    addPoi({ type: 'gather', x: 0, z: 65.5, y: pavAt(0, 65.5), r: 4, owner: name, note: 'foot of the Mausoleum stair' });
  }
  if (dbg) { const tc = g => (g.index ? g.index.count : g.attributes.position.count) / 3; dbg.statueParts = { base: tc(baseG), panel: tc(panelG), letters: tc(lettersP[0].paint), lion: tc(lowPoly(lionGeometry({ seed: 3, stride: 0.12 }), 0.07)) }; }
  mark('statues');

  // everything walkable laid above the ground so far: street surfaces, drains, crossings, the avenue (8 m cell index)
  {
    const gIdx = new Map();
    for (const [rc, fn] of walk) for (let i = Math.floor(rc.minX / 8); i <= Math.floor(rc.maxX / 8); i++) for (let j = Math.floor(rc.minZ / 8); j <= Math.floor(rc.maxZ / 8); j++) { const k = i * 65536 + j; let l = gIdx.get(k); if (!l) gIdx.set(k, l = []); l.push(fn); }
    world.extraGround.push((x, z) => { const l = gIdx.get(Math.floor(x / 8) * 65536 + Math.floor(z / 8)); if (!l) return -Infinity; let y = -Infinity; for (const f of l) { const v = f(x, z); if (v > y) y = v; } return y; });
  }
  const ground = (x, z) => Math.max(gb(x, z), world.groundHeight(x, z));

  // ---------- corner pieces ----------
  R = rng(5813);
  const HERM = marbleTone(0xfff1dc, 0.2, 1.9), HEK = marbleTone(0xf6ead6, 0.24, 1.47), ALT = marbleTone(0xfbeeda, -0.2, 1.1);     // (in the textured bucket, like the marble figures)
  const hermP = proto([
    ['socles', tx(box(0.52, 0.22, 0.52), 0, 0.11, 0)], ['terra', tx(box(0.42, 0.1, 0.42), 0, 0.27, 0), HERM],
    ['terra', tx(cyl(0.2, 0.165, 1.1, 4), 0, 0.87, 0, 0, Math.PI / 4, 0), HERM], ['terra', tx(box(0.37, 0.12, 0.24), 0, 1.47, 0), HERM],
    ['terra', tx(box(0.1, 0.09, 0.1), 0.23, 1.39, 0), HERM], ['terra', tx(box(0.1, 0.09, 0.1), -0.23, 1.39, 0), HERM],
    ['terra', tx(cyl(0.066, 0.075, 0.2, 6, true), 0, 1.6, 0), HERM], ['terra', ellipsoid(0.1, 0.125, 0.11, 7, 5).translate(0, 1.78, 0.005), HERM],
    ['terra', tx(new THREE.ConeGeometry(0.022, 0.06, 4), 0, 1.77, 0.115, Math.PI / 2 - 0.15, 0, 0), HERM],
    ['paint', ellipsoid(0.112, 0.085, 0.118, 7, 3).translate(0, 1.84, -0.02), 0x4a3a2e], ['paint', tx(ellipsoid(0.085, 0.125, 0.07, 6, 3), 0, 1.66, 0.07, -0.25, 0, 0), 0x4a3a2e],
    ['paint', cyl(0.116, 0.114, 0.022, 7, true).translate(0, 1.83, -0.012), 0x8a3324],
  ]);
  const altarP = proto([
    ['terra', rectSweep(0.78, 0.56, [{ o: 0.12, y: 0 }, { o: 0.12, y: 0.12, hard: true }, { o: 0.04, y: 0.2 }, { o: 0, y: 0.24, hard: true }, { o: 0, y: 0.8, hard: true }, { o: 0.05, y: 0.86 }, { o: 0.1, y: 0.95, hard: true }], { top: true }), ALT],
    ['terra', tx(cyl(0.07, 0.07, 0.72, 8), 0, 1.02, 0.25, 0, 0, Math.PI / 2), ALT], ['terra', tx(cyl(0.07, 0.07, 0.72, 8), 0, 1.02, -0.25, 0, 0, Math.PI / 2), ALT],
    ['doors', tx(box(0.42, 0.03, 0.26), 0, 0.965, 0)], ['paint', tx(box(0.8, 0.05, 0.58), 0, 0.62, 0), 0x7c2e24],
    ['terra', lathe([[0.001, 0], [0.06, 0], [0.11, 0.06], [0.12, 0.08], [0.001, 0.05]], 9).translate(0.2, 0, 0.5), 0xb4704b],
  ]);
  const hekP = proto([
    ['socles', tx(box(0.58, 0.24, 0.58), 0, 0.12, 0)], ['terra', tx(cyl(0.2, 0.22, 0.12, 3), 0, 0.3, 0), HEK], ['terra', tx(cyl(0.09, 0.11, 1.0, 6, true), 0, 0.86, 0), HEK],
    ...[0, 1, 2].flatMap(i => { const a = i * TAU / 3, sx = Math.sin(a), sz = Math.cos(a); return [['terra', tx(cyl(0.085, 0.125, 0.86, 5, true), sx * 0.11, 0.79, sz * 0.11, 0, a, 0), HEK], ['terra', ellipsoid(0.085, 0.07, 0.06, 5, 3).translate(sx * 0.13, 1.2, sz * 0.13), HEK], ['terra', ellipsoid(0.055, 0.07, 0.058, 6, 3).translate(sx * 0.13, 1.33, sz * 0.13), HEK], ['terra', cyl(0.05, 0.042, 0.08, 5, true).translate(sx * 0.125, 1.43, sz * 0.125), HEK]]; }), ['terra', lathe([[0.001, 0], [0.05, 0], [0.08, 0.1], [0.05, 0.14], [0.001, 0.14]], 8).translate(0.18, 0.24, 0.18), 0xa86846],
  ]);
  const horosP = proto([['socles', tx(box(0.28, 0.66, 0.14), 0, 0.3, 0)], ['socles', tx(new THREE.CylinderGeometry(0.14, 0.14, 0.14, 8, 1, false, -Math.PI / 2, Math.PI), 0, 0.63, 0, Math.PI / 2, 0, 0)]]);
  const POOL = 0x323f39, SPOUT = 0xa9b6b1;        // small basins: dark still water; the jet a pale thread
  const wellP = proto([
    ['socles', cyl(0.76, 0.8, 0.14, 10, true).translate(0, 0.05, 0)], ['socles', new THREE.RingGeometry(0.42, 0.76, 10, 1).rotateX(-Math.PI / 2).translate(0, 0.12, 0)],
    ['socles', lathe([[0.42, 0.12], [0.6, 0.12], [0.62, 0.2], [0.55, 0.28], [0.55, 0.74], [0.6, 0.79], [0.6, 0.86], [0.44, 0.86], [0.42, 0.12]], 10)],
    ['doors', tx(new THREE.CircleGeometry(0.43, 10), 0, 0.68, 0, -Math.PI / 2, 0, 0)],
    ['woodDark', tx(box(0.09, 1.72, 0.09), 0, 0.98, 0.68)], ['woodDark', tx(box(0.09, 1.72, 0.09), 0, 0.98, -0.68)], ['woodDark', tx(box(0.1, 0.11, 1.56), 0, 1.86, 0)],
    ['woodDark', cyl(0.012, 0.012, 0.8, 4).translate(0, 1.42, 0)], ['woodDark', tx(cyl(0.08, 0.08, 0.06, 10), 0, 1.76, 0, Math.PI / 2, 0, 0)],
    ['bronze', cyl(0.12, 0.09, 0.2, 9).translate(0.38, 0.96, 0.32), 0x7d6546],
    ['ashlar', box(1.2, 0.08, 0.46).translate(1.28, 0.04, 0)], ['ashlar', box(1.2, 0.46, 0.07).translate(1.28, 0.23, 0.195)], ['ashlar', box(1.2, 0.46, 0.07).translate(1.28, 0.23, -0.195)],
    ['ashlar', box(0.07, 0.46, 0.32).translate(0.715, 0.23, 0)], ['ashlar', box(0.07, 0.46, 0.32).translate(1.845, 0.23, 0)],
    ['paint', tx(new THREE.PlaneGeometry(1.06, 0.32), 1.28, 0.39, 0, -Math.PI / 2, 0, 0), POOL],
    ['terra', hydriaG().translate(-0.7, 0, 0.62), 0xb8704a],
  ], 0.45, 0);
  const lionHead = [      // a cast lion mask, dark and weathered: a full mane of deep staggered locks on a solid ruff, ears, heavy brow and eyes, projecting muzzle, the water from its open mouth
    ['terra', ellipsoid(0.175, 0.185, 0.04, 8, 4).translate(0, 1.13, -0.44), 0x3e3022],
    ...Array.from({ length: 10 }, (_, i) => { const a = (i + 0.5) / 10 * TAU, o = i % 2 ? 0.15 : 0.14; return ['terra', ellipsoid(0.064, 0.066, 0.078, 5, 3).translate(Math.cos(a) * o, 1.13 + Math.sin(a) * o * 1.06, i % 2 ? -0.405 : -0.375), i % 2 ? 0x4a3a28 : 0x5c4830]; }),
    ['terra', ellipsoid(0.095, 0.1, 0.075, 7, 4).translate(0, 1.125, -0.35), 0x7a6242], ['terra', box(0.15, 0.036, 0.06).translate(0, 1.168, -0.305), 0x5e4a32],
    ...[-1, 1].flatMap(sx => [['terra', ellipsoid(0.034, 0.04, 0.03, 4, 3).translate(sx * 0.1, 1.245, -0.36), 0x4e3e2a], ['paint', ellipsoid(0.019, 0.012, 0.012, 4, 3).translate(sx * 0.042, 1.143, -0.29), 0x140e08]]),
    ['terra', ellipsoid(0.056, 0.042, 0.064, 6, 3).translate(0, 1.09, -0.295), 0x846a48], ['terra', box(0.045, 0.028, 0.03).translate(0, 1.115, -0.24), 0x3e3020],
    ['paint', ellipsoid(0.04, 0.024, 0.03, 5, 3).translate(0, 1.052, -0.275), 0x140e08], ['terra', box(0.06, 0.018, 0.03).translate(0, 1.026, -0.285), 0x6a5436],
  ];
  const fountainP = proto([
    ['ashlar', box(2.0, 1.96, 0.5).translate(0, 0.98, -0.7)], ['terra', box(2.2, 0.14, 0.62).translate(0, 2.03, -0.7), 0xd9cfbd],
    ['terra', tx(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-1.1, 0), new THREE.Vector2(1.1, 0), new THREE.Vector2(0, 0.34)]), { depth: 0.5, bevelEnabled: false }), 0, 2.1, -0.95), 0xd4c9b6],
    ['terra', box(1.8, 0.1, 0.8).translate(0, 0.05, -0.05), 0xcdc3b1], ['terra', box(1.8, 0.62, 0.1).translate(0, 0.31, 0.3), 0xcdc3b1], ['terra', box(0.1, 0.62, 0.7).translate(0.85, 0.31, -0.1), 0xcdc3b1], ['terra', box(0.1, 0.62, 0.7).translate(-0.85, 0.31, -0.1), 0xcdc3b1],
    ['terra', box(1.92, 0.06, 0.16).translate(0, 0.64, 0.3), 0xd9cfbd],
    ['paint', tx(new THREE.PlaneGeometry(1.6, 0.74), 0, 0.53, -0.08, -Math.PI / 2, 0, 0), POOL],
    ['paint', limb([0, 1.05, -0.265], [0, 0.95, -0.2], 0.011, 0.012, 5), SPOUT], ['paint', limb([0, 0.95, -0.2], [0, 0.54, -0.13], 0.012, 0.016, 5), SPOUT], ['paint', ellipsoid(0.075, 0.008, 0.075, 7, 3).translate(0, 0.535, -0.13), 0x8a9892],
    ...lionHead,
    ['ashlar', box(2.2, 0.14, 0.55).translate(0, 0.07, 0.62)], ['terra', hydriaG().translate(0.72, 0.14, 0.64), 0xc07a52],
  ]);
  const BARK = [new THREE.Color(0x8d8672), new THREE.Color(0xc4b898), new THREE.Color(0x9a9a78)];
  function planeTree(sc, ax = 0, az = 0) {         // a plane tree: mottled trunk and limbs, a dense crown of leaf cards (drawn back on the side (-ax, -az) where a house stands)
    const bark = [], leaf = [], H = 4.0 + R() * 1.2, ph = R() * TAU;
    bark.push(tubeY(5, 10, (i, j, t, a) => { const rr = lerp(0.46, 0.27, t) * (1 + 0.09 * Math.sin(4 * a + ph)) * (t === 0 ? 1.18 : 1); return [Math.cos(a) * rr, t * H - 0.1, -Math.sin(a) * rr]; }, 3, H));
    for (let b = 0; b < 5; b++) { const a = b / 5 * TAU + R(), L = (1.5 + R() * 0.6) * (Math.cos(a) * ax - Math.sin(a) * az < -0.3 ? 0.55 : 1); bark.push(limb([0, H - 0.3, 0], [Math.cos(a) * L, H + 1.3 + R() * 0.8, -Math.sin(a) * L], 0.22, 0.07, 5)); }
    const card = new THREE.PlaneGeometry(2.0, 2.0);
    for (let i = 0; i < 64; i++) { let px, py, pz, l; do { px = R() * 2 - 1; py = R() * 2 - 1; pz = R() * 2 - 1; l = px * px + py * py + pz * pz; } while (l > 1 || l < 0.08); const k = 0.35 + 0.65 * Math.cbrt(l) / Math.sqrt(l); let lx = px * k * 3.3, lz = pz * k * 3.3; const dd = lx * ax + lz * az; if (dd < 0) { lx -= dd * 0.6 * ax; lz -= dd * 0.6 * az; } leaf.push(card.clone().applyMatrix4(mat(lx, H + 1.9 + py * k * 2.0, lz, R() * TAU, R() * TAU, R() * TAU))); }
    const bk = mergeN(bark).scale(sc, sc, sc), p = bk.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) { const n = Math.sin(p.getX(i) * 9.1 + p.getY(i) * 2.7 + ph) * Math.sin(p.getZ(i) * 8.3 - p.getY(i) * 3.9) * 0.5 + 0.5; c.copy(BARK[0]).lerp(n > 0.55 ? BARK[1] : BARK[2], Math.abs(n - 0.55) * 1.8); col.set([c.r, c.g, c.b], i * 3); }
    bk.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { terra: bk, leaf: mergeN(leaf).scale(sc, sc, sc) };
  }
  const ringP = proto([['socles', lathe([[0.96, -0.28], [0.96, 0.26], [0.8, 0.26], [0.8, -0.1]], 12)], ['paint', lathe([[0.81, 0.17], [0.55, 0.2], [0.001, 0.24]], 12), 0x5e4c3a]]);   // the ring's outer wall is traversed upwards (outward normals); a low mound of soil inside
  const benchP = proto([['ashlar', box(1.9, 0.1, 0.46).translate(0, 0.42, 0)], ['socles', box(0.3, 0.37, 0.4).translate(0.7, 0.185, 0)], ['socles', box(0.3, 0.37, 0.4).translate(-0.7, 0.185, 0)]]);

  // ---------- street-edge clutter prototypes (local X along the street, +Z towards the street centre) ----------
  const handcart = (load) => {
    const p = [], wr = 0.4;
    for (const s of [-1, 1]) { p.push(['woodDark', tx(cyl(wr, wr, 0.07, 8), 0, wr, s * 0.56, Math.PI / 2, 0, 0)], ['woodDark', box(0.06, 0.72, 0.02).translate(0, wr, s * 0.6)], ['woodDark', tx(cyl(0.07, 0.07, 0.2, 5), 0, wr, s * 0.56, Math.PI / 2, 0, 0)]); }
    p.push(['woodDark', box(0.07, 0.07, 1.2).translate(0, wr, 0)], ['wood', box(1.4, 0.06, 0.9).translate(-0.05, 0.62, 0)]);
    for (const s of [-1, 1]) p.push(['wood', box(1.4, 0.24, 0.05).translate(-0.05, 0.77, s * 0.45)], ['wood', box(0.05, 0.24, 0.85).translate(-0.05 + s * 0.68, 0.77, 0)], ['woodDark', box(1.5, 0.06, 0.06).translate(1.35, 0.6, s * 0.3)]);
    p.push(['woodDark', box(0.06, 0.06, 0.66).translate(2.08, 0.6, 0)], ['woodDark', box(0.05, 0.58, 0.05).translate(2.0, 0.29, 0)]);
    if (load === 'sacks') for (let i = 0; i < 4; i++) p.push(['paint', tx(ellipsoid(0.3, 0.15, 0.2, 5, 3), -0.4 + (i % 2) * 0.62, 0.8 + (i > 1 ? 0.2 : 0), i > 1 ? 0 : (i ? 0.2 : -0.2), 0, 0.2 * i, 0), pick(LINEN)]);
    if (load === 'amph') { const A = amphoraG(5, false); for (let i = 0; i < 3; i++) p.push(['terra', A.clone().applyMatrix4(mat(-0.5, 0.82, (i - 1) * 0.3, 0, 0, -Math.PI / 2)), pick(CLAY)]); }
    if (load === 'wood') p.push(...logLoad(7, 1.5, 0.07, -0.05, 0.65, 0.15));
    return Object.assign(proto(p, 0.66, 0), { la: 1.5, lc: 0.66 });
  };
  const oxcart = (load) => {
    const p = [], wr = 0.58;
    for (const s of [-1, 1]) { p.push(['woodDark', tx(cyl(wr, wr, 0.1, 10), 0, wr, s * 0.8, Math.PI / 2, 0, 0)], ['woodDark', box(0.14, 2 * wr - 0.06, 0.03).translate(0, wr, s * 0.865)], ['woodDark', box(0.9, 0.08, 0.03).translate(0, wr, s * 0.865)], ['woodDark', tx(cyl(0.1, 0.1, 0.3, 5), 0, wr, s * 0.8, Math.PI / 2, 0, 0)]); }
    p.push(['woodDark', box(0.1, 0.1, 1.9).translate(0, wr, 0)], ['wood', box(2.3, 0.08, 1.3).translate(0, wr + 0.2, 0)]);
    for (const s of [-1, 1]) p.push(['wood', box(2.3, 0.38, 0.05).translate(0, wr + 0.43, s * 0.63)], ['wood', box(0.05, 0.38, 1.3).translate(s * 1.13, wr + 0.43, 0)]);
    p.push(['woodDark', plank([1.1, wr + 0.12, 0], [3.9, 0.36, 0], 0.1)], ['woodDark', box(0.12, 0.1, 1.6).translate(3.9, 0.33, 0)], ['socles', box(0.34, 0.24, 0.42).translate(3.9, 0.12, 0)]);
    for (const s of [-1, 1]) p.push(['woodDark', box(0.05, 0.34, 0.05).translate(3.9, 0.24, s * 0.5)]);
    const top = wr + 0.24;
    if (load === 'amph') { p.push(['paint', ellipsoid(1.05, 0.2, 0.56, 7, 3).translate(0, top + 0.05, 0), STRAW]); const A = amphoraG(6, false); for (let i = 0; i < 5; i++) p.push(['terra', A.clone().applyMatrix4(mat(-0.72 + (i % 3) * 0.72 + (i > 2 ? 0.36 : 0), top, i < 3 ? -0.27 : 0.27, (R() - 0.5) * 0.12, R() * 3, 0)), pick(CLAY)]); }
    if (load === 'sacks') for (let i = 0; i < 8; i++) p.push(['paint', tx(ellipsoid(0.36, 0.17, 0.25, 5, 3), -0.72 + (i % 3) * 0.72 + (i > 5 ? 0.35 : 0), top + 0.15 + (i > 5 ? 0.28 : 0), i > 5 ? 0 : (i % 2 ? 0.27 : -0.27), 0, R() * 0.5, 0), pick(LINEN)]);
    if (load === 'wood') p.push(...logLoad(11, 2.1, 0.08, 0, top, 0.17));
    if (load === 'hay') for (let i = 0; i < 4; i++) p.push(['paint', tx(ellipsoid(0.62, 0.36, 0.5, 6, 4), -0.62 + i * 0.42, top + 0.16 + (i % 2) * 0.1, (i % 2 ? 0.12 : -0.1), 0, R() * 3, 0), i % 2 ? STRAW : 0x86683a]);
    return Object.assign(proto(p, 1.45, 0), { la: 2.7, lc: 0.95 });
  };
  const donkey = (col, pack, sc) => {       // a small donkey or mule tethered to a post: body, neck and head, tapered legs
    const p = [], dark = new THREE.Color(col).multiplyScalar(0.45).getHex(), muzzle = 0x5a5046;
    p.push(['terra', ellipsoid(0.5, 0.26, 0.2, 6, 4).translate(0, 0.9, 0), col], ['terra', ellipsoid(0.27, 0.27, 0.21, 5, 3).translate(-0.36, 0.92, 0), col], ['terra', ellipsoid(0.24, 0.27, 0.2, 5, 3).translate(0.33, 0.9, 0), col]);
    p.push(['terra', limb([0.3, 0.96, 0], [0.66, 1.34, 0], 0.17, 0.09, 6), col], ['terra', tx(box(0.44, 0.07, 0.05), 0.48, 1.19, 0, 0, 0, 0.82), dark]);
    p.push(['terra', tx(ellipsoid(0.24, 0.1, 0.092, 6, 3), 0.8, 1.22, 0, 0, 0, -0.85), col], ['terra', ellipsoid(0.085, 0.075, 0.08, 5, 3).translate(0.95, 1.05, 0), muzzle]);
    for (const s of [-1, 1]) p.push(['terra', tx(new THREE.ConeGeometry(0.045, 0.26, 4, 1, true), 0.68, 1.46, s * 0.06, s * 0.25, 0, 0.45), col]);
    for (const fx of [0.36, -0.4]) for (const s of [-1, 1]) {
      const hx = fx + (fx > 0 ? 0.01 : -0.04), knee = fx > 0 ? 0.42 : 0.5;     // a thick forearm or gaskin tapering to a thin cannon
      p.push(['terra', limb([fx, 0.86, s * 0.1], [hx, knee, s * 0.105], 0.08, 0.036, 5), col], ['terra', limb([hx, knee, s * 0.105], [fx + 0.02, 0.07, s * 0.11], 0.036, 0.026, 3), col], ['terra', cyl(0.03, 0.043, 0.075, 4, true).translate(fx + 0.02, 0.038, s * 0.11), dark]);
    }
    p.push(['terra', limb([-0.6, 0.98, 0], [-0.66, 0.5, 0.02], 0.025, 0.018, 3), dark]);
    if (pack) {
      p.push(['terra', box(0.5, 0.1, 0.46).translate(0.02, 1.17, 0), pick([0x6a2a1c, 0x3e4252, 0x7a6440])]);
      for (const s of [-1, 1]) p.push(['terra', cyl(0.17, 0.14, 0.4, 6).translate(0.02, 0.9, s * 0.33), 0x6e5230]);
      if (pack === 'amph') { const A = amphoraG(5, false); for (const s of [-1, 1]) p.push(['terra', A.clone().applyMatrix4(mat(0.02, 0.75, s * 0.33, 0, 0, 0, 0.62)), pick(CLAY)]); }
    }
    p.push(['woodDark', box(0.1, 1.1, 0.1).translate(1.2, 0.55, -0.34)], ['woodDark', limb([0.97, 1.07, 0], [1.2, 1.0, -0.3], 0.01, 0.01, 4)]);
    const g = proto(p, 0.28, 0); for (const k in g) g[k].scale(sc, sc, sc);
    return Object.assign(g, { la: 0.98 * sc, lc: (pack ? 0.5 : 0.42) * sc });
  };
  const amphoraStack = (n, layers = 3) => {      // amphorae laid toe to mouth, in one to three layers
    const p = [], A = amphoraG(5, false);
    const lay = (x, y, flip) => p.push(['terra', A.clone().applyMatrix4(mat(x, y, flip ? 0.475 : -0.475, flip ? -Math.PI / 2 : Math.PI / 2, 0, 0)), pick(CLAY)]);
    for (let i = 0; i < n; i++) lay((i - (n - 1) / 2) * 0.35, 0.175, i % 2);
    if (layers > 1) for (let i = 0; i < n - 1; i++) lay((i - (n - 2) / 2) * 0.35, 0.47, (i + 1) % 2);
    if (layers > 2 && n > 3) lay(0, 0.77, 0);
    return Object.assign(proto(p), { la: n * 0.175 + 0.06, lc: 0.52 });
  };
  const jarRow = (n, same) => {
    const p = [], H = hydriaG(), K = same ? H : pelikeG();
    for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * 0.48; p.push(['terra', (i % 2 ? H : K).clone().applyMatrix4(mat(x, 0, (R() - 0.5) * 0.08, 0, R() * TAU, 0, 0.9 + R() * 0.2)), pick(CLAY)]); }
    return Object.assign(proto(p), { la: n * 0.23 + 0.05, lc: 0.28 });
  };
  const BARKC = new THREE.Color(0x86643f), BARKC2 = new THREE.Color(0x9f7c54), ENDC = new THREE.Color(0xdfb982);     // bark and sawn ends (the textured bucket darkens them)
  const firewood = (L, n0 = 4, rows = 3) => {      // a pile of logs against the wall: grey-brown bark, pale sawn ends, each resting in the groove below it
    const p = [], below = [];
    for (let row = 0; row < rows; row++) {
      const here = [];
      for (let i = 0; i < n0 - row; i++) {
        const r = 0.05 + R() * 0.04, z = (i - (n0 - row - 1) / 2) * 0.165 + (R() - 0.5) * 0.02;
        let y = r; for (const q of below) { const dz = Math.abs(q.z - z); if (dz < q.r + r) y = Math.max(y, q.y + Math.sqrt((q.r + r) ** 2 - dz * dz)); }
        here.push({ z, y, r });
        const g = logG(r, r * (0.88 + R() * 0.1), L + (R() - 0.5) * 0.5), m = mat((R() - 0.5) * 0.12, y, z, 0, (R() - 0.5) * 0.3, 0).multiply(mat(0, 0, 0, R() * TAU, 0, 0));
        p.push(['terra', g.bark.applyMatrix4(m), BARKC.clone().lerp(BARKC2, R()).getHex()], ['terra', g.cap.applyMatrix4(m), ENDC.clone().multiplyScalar(0.9 + R() * 0.15).getHex()]);
      }
      below.splice(0, below.length, ...here);
    }
    return Object.assign(proto(p), { la: L / 2 + 0.2, lc: (n0 - 1) * 0.0825 + 0.17 });
  };
  const logLoad = (n, L, r, x, y0, dz) => {         // logs laid on a cart bed, two courses
    const p = [];
    for (let i = 0; i < n; i++) {
      const top = i >= Math.ceil(n * 0.6), k = top ? i - Math.ceil(n * 0.6) : i, nr = top ? n - Math.ceil(n * 0.6) : Math.ceil(n * 0.6), rr = r * (0.85 + R() * 0.3);
      const g = logG(rr, rr * 0.92, L + (R() - 0.5) * 0.3), m = mat(x + (R() - 0.5) * 0.15, y0 + rr + (top ? 1.7 * r : 0), (k - (nr - 1) / 2) * dz, 0, (R() - 0.5) * 0.08, 0).multiply(mat(0, 0, 0, R() * TAU, 0, 0));
      p.push(['terra', g.bark.applyMatrix4(m), BARKC.clone().lerp(BARKC2, R()).getHex()], ['terra', g.cap.applyMatrix4(m), ENDC.getHex()]);
    }
    return p;
  };
  const sacksPile = (n) => {      // sacks of grain against the wall, leaning on each other, the last one laid on its side
    const p = [], ns = n - 1, w = ns * 0.46 + 0.66;
    for (let i = 0; i < ns; i++) p.push(['paint', tx(sackG(), -w / 2 + 0.26 + i * 0.46, 0, (R() - 0.5) * 0.06, -0.08 - R() * 0.06, R() * 3, (i - (ns - 1) / 2) * 0.12, 0.92 + R() * 0.18), pick(LINEN)]);
    p.push(['paint', tx(sackG(), w / 2 - 0.66, 0.22, 0.02, 0, (R() - 0.5) * 0.3, -Math.PI / 2, 0.9), pick(LINEN)]);
    return Object.assign(proto(p), { la: w / 2, lc: 0.27 });
  };
  const amphLean = (n) => {       // amphorae stood on their toes and leant against the wall
    const p = [], A = amphoraG(6, true);
    for (let i = 0; i < n; i++) p.push(['terra', A.clone().applyMatrix4(mat((i - (n - 1) / 2) * 0.35, 0.01, 0.07, -0.22 - R() * 0.05, 0, (R() - 0.5) * 0.1).multiply(mat(0, 0, 0, 0, R() * 3, 0))), pick(CLAY)]);
    return Object.assign(proto(p), { la: n * 0.175 + 0.02, lc: 0.24 });
  };
  const pithos = (lid) => {       // a big storage jar, lidded or open
    const s = 0.78 + R() * 0.22, p = [['terra', lathe([[0.2, -0.03], [0.39, 0.36], [0.35, 0.8], [0.25, 1.02], ...(lid ? [] : [[0.001, 1.02]])], 7).scale(s, s, s), pick(CLAY)]];
    if (lid) p.push(['woodDark', cyl(0.27 * s, 0.27 * s, 0.04, 7, true).translate(0, 1.03 * s, 0)], ['woodDark', new THREE.CircleGeometry(0.27 * s, 7).rotateX(-Math.PI / 2).translate(0, 1.05 * s, 0)]);
    return Object.assign(proto(p), { la: 0.42 * s, lc: 0.42 * s });
  };
  const bricks = () => {
    const p = [];
    for (let l = 0; l < 4; l++) p.push(['terra', box(1.2 - (l === 3 ? 0.5 : 0), 0.11, 0.62).translate((R() - 0.5) * 0.06 - (l === 3 ? 0.25 : 0), 0.055 + l * 0.115, (R() - 0.5) * 0.05), pick([0xb39676, 0xa8886a, 0xbfa07c])]);
    p.push(['terra', tx(box(0.4, 0.11, 0.2), 0.75, 0.055, 0.2, 0, 0.5, 0), 0xb39676]);
    return Object.assign(proto(p, 0.08, 0), { la: 0.9, lc: 0.36 });
  };
  const tiles = () => {            // a stack of new roof tiles and a few ridge tiles
    const p = [];
    for (let l = 0; l < 3; l++) p.push(['terra', box(0.62, 0.2, 0.46).translate((R() - 0.5) * 0.05, 0.1 + l * 0.2, (R() - 0.5) * 0.04), pick([0xc27d53, 0xb8714a, 0xc8804f])], ['terra', box(0.62, 0.2, 0.46).translate(0.68 + (R() - 0.5) * 0.05, 0.1 + l * 0.2 - (l === 2 ? 0.2 : 0), (R() - 0.5) * 0.04), pick([0xc27d53, 0xb8714a])]);
    for (let i = 0; i < 2; i++) p.push(['terra', tx(cyl(0.09, 0.09, 0.55, 6, true), -0.62, 0.1, (i - 0.5) * 0.24, 0, 0, Math.PI / 2), 0xb06a44]);
    return Object.assign(proto(p, 0.3, 0), { la: 1.0, lc: 0.3 });
  };
  const baskets = (n) => {
    const p = [], K = lathe([[0.19, -0.01], [0.24, 0.28], [0.17, 0.05], [0.001, 0.05]], 6), fruit = [0x8b3a2a, 0x9a8a3a, 0x6d7a3a, 0x5a3a4a];
    for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * 0.56, c = pick(fruit); p.push(['paint', K.clone().translate(x, 0, 0), 0x7a5a2c], ['paint', ellipsoid(0.2, 0.085, 0.2, 6, 2).translate(x, 0.235, 0), c]); }     // heaped with fruit
    return Object.assign(proto(p), { la: n * 0.28, lc: 0.26 });
  };
  const brushwood = () => {        // bundles of brushwood for the ovens: thin switches fanned out from a tied waist
    const p = [];
    for (let i = 0; i < 3; i++) {
      const L = 1.15 + R() * 0.25, bx = (R() - 0.5) * 0.15, by = 0.17 + (i === 2 ? 0.28 : 0), bz = i === 2 ? 0 : (i - 0.5) * 0.4, rot = (R() - 0.5) * 0.2;
      for (let j = 0; j < 8; j++) {
        const a = j / 8 * TAU + R() * 0.5, sp = 0.08 + R() * 0.06, off = (R() - 0.5) * 0.18, r = 0.022 + R() * 0.012;
        const A = new THREE.Vector3(-L / 2 + off, Math.sin(a) * sp, Math.cos(a) * sp), Bv = new THREE.Vector3(L / 2 + off, -Math.sin(a + 0.4) * sp * 1.3, -Math.cos(a + 0.4) * sp * 1.3);
        const g = limb([A.x, A.y, A.z], [Bv.x, Bv.y, Bv.z], r * 0.8, r, 3);
        p.push(['terra', g.applyMatrix4(mat(bx, by, bz, 0, rot, 0)), pick([0x6e5f45, 0x75644a, 0x7d6a4a, 0x6a5a40])]);
      }
      p.push(['woodDark', tx(cyl(0.075, 0.075, 0.05, 5, true), bx, by, bz, 0, rot, Math.PI / 2)]);
    }
    return Object.assign(proto(p), { la: 0.8, lc: 0.44 });
  };
  const loomStool = () => {        // a stool by the door with a hank of wool on it, a row of clay loom weights along the wall behind
    const p = [['wood', box(0.4, 0.05, 0.36).translate(0, 0.45, 0)], ['paint', ellipsoid(0.13, 0.05, 0.1, 5, 2).translate(0.03, 0.49, 0.02), 0xa89d84]], W = new THREE.ConeGeometry(0.055, 0.13, 4);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) p.push(['woodDark', limb([sx * 0.16, 0, sz * 0.14], [sx * 0.14, 0.43, sz * 0.12], 0.022, 0.018, 4)]);
    for (let i = 0; i < 5; i++) p.push(['terra', tx(W, -0.28 + i * 0.13, 0.065, 0.22 + (R() - 0.5) * 0.04, 0, R() * 0.6, (R() - 0.5) * 0.2), pick([0xb87c56, 0xa86e4a, 0xc08a5e])]);
    return Object.assign(proto(p), { la: 0.36, lc: 0.28 });
  };
  const woolBasket = () => Object.assign(proto([['paint', lathe([[0.001, 0.02], [0.17, 0.02], [0.22, 0.26], [0.24, 0.28]], 7), 0x6e5230], ['paint', ellipsoid(0.23, 0.12, 0.23, 6, 2).translate(0, 0.27, 0), 0xa39880]]), { la: 0.25, lc: 0.25 });   // raw wool heaped in a basket
  const potRack = () => {          // a rail on two posts against the wall: jugs hung by their handles, strings of onions
    const p = [['woodDark', sides(box(0.05, 1.35, 0.05)).translate(-0.62, 0.675, 0)], ['woodDark', sides(box(0.05, 1.35, 0.05)).translate(0.62, 0.675, 0)], ['woodDark', sides(box(1.34, 0.05, 0.05)).translate(0, 1.33, 0)]];
    const J = lathe([[0.001, 0], [0.1, 0.04], [0.105, 0.17], [0.045, 0.29]], 5), O = ellipsoid(0.08, 0.24, 0.07, 4, 3);
    for (let i = 0; i < 5; i++) {
      const x = -0.5 + i * 0.25, jug = i % 2 === 0, top = jug ? 0.88 + R() * 0.08 : 0.78, bot = top + (jug ? 0.27 : 0.46);
      p.push(jug ? ['terra', J.clone().applyMatrix4(mat(x, top - 0.02, 0.01, (R() - 0.5) * 0.08, R() * 3, (R() - 0.5) * 0.08)), pick(CLAY)] : ['paint', O.clone().applyMatrix4(mat(x, top + 0.23, 0.02, 0, R() * 3, 0)), pick([0xa88a58, 0x9a7446])]);
      if (bot < 1.3) p.push(['woodDark', tx(new THREE.PlaneGeometry(0.012, 1.31 - bot), x, (1.31 + bot) / 2, 0.01)]);
    }
    return Object.assign(proto(p), { la: 0.68, lc: 0.1 });
  };
  const seatP = Object.assign(proto([['socles', box(1.1, 0.44, 0.44).translate(0, 0.2, 0)]]), { la: 0.6, lc: 0.25, seat: 0.42 });
  const DONK = [0x584636, 0x46362a, 0x5e5044, 0x6a5440, 0x3a302a];
  const trisOf = p => Object.values(p).reduce((n, g) => n + (g && g.isBufferGeometry ? g.index.count / 3 : 0), 0);
  const named = (kind, p) => Object.assign(p, { kind, tris: trisOf(p) });
  // the traffic parked at the street edge
  const TRAFFIC = {
    handcart: ['sacks', 'amph', 'wood', 'sacks', 'amph'].map(l => named('handcart', handcart(l))),
    oxcart: ['amph', 'sacks', 'wood', 'hay', 'amph'].map(l => named('oxcart', oxcart(l))),
    donkey: [[DONK[0], null, 1], [DONK[1], 'bags', 1.15], [DONK[2], 'amph', 1], [DONK[4], 'bags', 1.12], [DONK[0], 'amph', 1.05]].map(a => named('donkey', donkey(...a))),
  };
  // goods set out against a house wall, a few things together, their backs to the wall (fixed: a cart or a donkey, never mirrored)
  const group = (gname, parts, gap = 0.16, fixed = false) => {
    const LC = Math.max(...parts.map(p => p.lc)), L = parts.reduce((s, p) => s + 2 * p.la, 0) + gap * (parts.length - 1), out = [];
    let x = -L / 2;
    for (const p of parts) { out.push([p, x + p.la, -(LC - p.lc) + R() * 0.03]); x += 2 * p.la + gap; }
    return { name: gname, parts: out, la: L / 2 + 0.04, lc: LC + 0.03, fixed, tris: parts.reduce((s, p) => s + trisOf(p), 0) };
  };
  const basketP = named('baskets', baskets(1)), seatN = named('seat', seatP);
  const GROUPS = [      // [weight, lowest density, group]; the first pass along every street takes the small ones
    [2.5, 0, group('store', [named('pithoi', pithos(true)), named('amphorae', amphLean(1))], 0.08)],
    [2.5, 0, group('store', [named('amphorae', amphLean(2)), basketP])],
    [1.5, 0, group('store', [named('pithoi', pithos(false)), named('pithoi', pithos(true))], 0.1)],
    [2.5, 0, group('wood', [named('firewood', firewood(1.2, 4, 3)), seatN], 0.3)],
    [1.5, 0, group('wood', [seatN, named('logs', firewood(1.3, 4, 2))], 0.25)],
    [1.5, 0, group('grain', [named('sacks', sacksPile(2)), basketP])],
    [2, 0, group('water', [named('jars', jarRow(2, true)), named('pithoi', pithos(false))])],
    [2, 0, group('water', [named('pithoi', pithos(true)), named('jars', jarRow(3))], 0.1)],
    [2, 0, group('produce', [named('baskets', baskets(2)), named('amphorae', amphLean(1))], 0.12)],
    [1.5, 0, group('build', [named('bricks', bricks()), named('tiles', tiles())], 0.3)],
    [2, 0, group('loom', [named('stool', loomStool()), named('wool', woolBasket())], 0.06)],
    [1.5, 0.4, group('loom', [named('jars', jarRow(1, true)), named('stool', loomStool()), named('wool', woolBasket())], 0.1)],
    [1.5, 0.3, group('oil', [named('amphorae', amphoraStack(3, 1)), named('pithoi', pithos(false))], 0.1)],
    [1.5, 0.3, group('potter', [named('jars', jarRow(2, true)), named('amphorae', amphLean(1))], 0.12)],
    [2, 0, group('rack', [named('rack', potRack())])],
    [5, 0.4, group('store', [named('pithoi', pithos(true)), named('amphorae', amphLean(2)), basketP])],
    [2, 0.4, group('store', [named('amphorae', amphLean(3)), named('pithoi', pithos(false))])],
    [3, 0.4, group('grain', [named('sacks', sacksPile(3)), basketP])],
    [2, 0.45, group('cart', [named('sacks', sacksPile(4)), named('handcart', handcart('sacks'))], 0.3, true)],
    [1.5, 0.4, group('wood', [named('logs', firewood(1.0, 4, 2)), named('brush', brushwood())])],
    [3, 0.4, group('oil', [named('amphorae', amphoraStack(3, 2)), named('pithoi', pithos(true))])],
    [2.5, 0.4, group('water', [named('jars', jarRow(3)), named('pithoi', pithos(false))])],
    [2, 0.45, group('potter', [named('jars', jarRow(2, true)), named('amphorae', amphLean(2)), basketP])],
    [2.5, 0.45, group('cart', [named('handcart', handcart('empty')), named('sacks', sacksPile(2))], 0.2, true)],
    [2, 0.45, group('cart', [named('sacks', sacksPile(3)), named('handcart', handcart('amph'))], 0.35, true)],
    [2.2, 0.45, group('donkey', [named('donkey', donkey(DONK[1], 'bags', 1.1)), named('sacks', sacksPile(2))], 0.35, true)],
    [1.5, 0.45, group('donkey', [named('amphorae', amphLean(2)), named('donkey', donkey(DONK[3], 'amph', 1))], 0.4, true)],
  ];
  if (dbg) dbg.extra = { groups: GROUPS.map(g => `${g[2].name}:${g[2].tris}:${(2 * g[2].la).toFixed(1)}`).join(' '), traffic: Object.entries(TRAFFIC).map(([k, v]) => `${k}:${v.map(p => p.tris).join('/')}`).join(' ') };
  const faceRy = (r, s) => Math.atan2(-s * r.nx, -s * r.nz);     // local +Z towards the street centre
  // stand a prototype on the ground: pitch along local X, roll across local Z
  const settle = (p, x, z, ry, la, lc) => {
    const dx = Math.cos(ry), dz = -Math.sin(ry), sx = Math.sin(ry), sz = Math.cos(ry);
    const hX0 = ground(x - dx * la, z - dz * la), hX1 = ground(x + dx * la, z + dz * la), hZ0 = ground(x - sx * lc, z - sz * lc), hZ1 = ground(x + sx * lc, z + sz * lc);
    const y = (hX0 + hX1 + hZ0 + hZ1) / 4 + 0.012;
    put(p, mat(x, y, z, 0, ry, 0).multiply(mat(0, 0, 0, 0, 0, Math.atan2(hX1 - hX0, 2 * la))).multiply(mat(0, 0, 0, -Math.atan2(hZ1 - hZ0, 2 * lc), 0, 0)));
    return y;
  };

  // ---------- corners: herms, altars, wells, fountains, plane trees with benches, boundary stones ----------
  R = rng(6924);
  const nodes = [];
  for (let k = GRID.k0; k <= GRID.k1 + 1; k++) for (let m = GRID.m0; m <= GRID.m1 + 1; m++) {
    const x = streetX(k), z = streetZ(m), nh = houses(k - 1, m - 1).length + houses(k, m - 1).length + houses(k - 1, m).length + houses(k, m).length;
    if (nh < 3 || offLimits(x, z)) continue;
    nodes.push({ k, m, x, z, nh, d: dens(x, z), big: k === 0 || m === 0 || m === -2 });
  }
  for (const nd of nodes) nd.j = nd.d + R() * 0.2;
  nodes.sort((a, b) => b.j - a.j);      // the busiest crossings first, so the triangle budget runs out in the outskirts
  const cornerTris = [0, 0], CORNER_BUDGET = [20000, 8600], kindTris = { herm: trisOf(hermP), altar: trisOf(altarP), hekataion: trisOf(hekP), horos: trisOf(horosP), well: trisOf(wellP), fountain: trisOf(fountainP), tree: 450 };
  const placed = { well: [], fountain: [], tree: [] }, cornerAt = []; if (dbg) dbg.kindTris = kindTris;
  const farFrom = (list, x, z, d) => list.every(p => Math.hypot(p[0] - x, p[1] - z) > d);
  const someCorner = (nd, sx, sz, used, at) => {      // the preferred corner first, then the crossing's other free corners
    for (const c of [[sx, sz], [-sx, sz], [sx, -sz], [-sx, -sz]]) { if (used.some(u => u[0] === c[0] && u[1] === c[1])) continue; const q = at(...c); if (q) return Object.assign(q, { c }); }
    return null;
  };
  const nearCypress = (x, z) => CYP.some(([cx, cz]) => Math.abs(cx - x) < 4.5 && Math.abs(cz - z) < 4.5);
  const cornerSpot = (nd, sx, sz, hx, hz, prefs) => {
    const cx0 = nd.x + sx * swX(nd.k) / 2, cz0 = nd.z + sz * swZ(nd.m) / 2;
    for (const [ex, ez] of prefs) { const cx = cx0 + sx * (ex + hx), cz = cz0 + sz * (ez + hz), rr = rectC(cx, cz, hx, hz); if (free(rr) && !inYardLot(rr) && reach(cx, cz, nd.x, nd.z)) return { x: cx, z: cz, rr }; }
    return null;
  };
  const E1 = [-0.6, -0.3, 0, 0.3, 0.7, 1.2], near = []; for (const a of E1) for (const b of E1) near.push([a, b]); near.sort((p, q) => Math.hypot(p[0] - 0.1, p[1] - 0.1) - Math.hypot(q[0] - 0.1, q[1] - 0.1));
  const deep = []; for (const a of [0.2, 0.6, 1.0, 1.6, 2.4]) for (const b of [0.2, 0.6, 1.0, 1.6, 2.4, -0.4]) deep.push([a, b], [b, a]);
  // the tree takes whichever corner of this crossing has room for its crown: no house within 1.8 m (a smaller tree, drawn back from it,
  // below 2.6 m), no upper storey under it; on an open lot at the corner it may stand further in
  const lotAt = (x, z) => layout.lots.find(l => x > l.minX && x < l.maxX && z > l.minZ && z < l.maxZ);
  const deepOpen = [...deep, [3.2, 1.0], [1.0, 3.2], [3.2, 3.2], [4.2, 2.0], [2.0, 4.2]];
  const plantTree = (nd, sx, sz, used, along) => {
    const spot = someCorner(nd, sx, sz, used, (qx, qz) => {
      const lot = lotAt(nd.x + qx * (swX(nd.k) / 2 + 3), nd.z + qz * (swZ(nd.m) / 2 + 3)), q = cornerSpot(nd, qx, qz, 1.0, 1.0, lot && (lot.state === 'empty' || lot.state === 'void') ? deepOpen : deep);
      if (!q || nearCypress(q.x, q.z)) return null;
      let dm = 9, ax = 0, az = 0;
      for (const h of layout.housesIn(rectC(q.x, q.z, 4.5, 4.5))) {
        const ex = Math.max(h.minX - q.x, 0, q.x - h.maxX), ez = Math.max(h.minZ - q.z, 0, q.z - h.maxZ), dd = Math.hypot(ex, ez);
        if (h.two && dd < 4.5) return null;
        if (dd < dm) { dm = dd; const cx = clamp(q.x, h.minX, h.maxX), cz = clamp(q.z, h.minZ, h.maxZ), l = Math.hypot(q.x - cx, q.z - cz) || 1; ax = (q.x - cx) / l; az = (q.z - cz) / l; }
      }
      if (dm < 1.8) return null;
      return Object.assign(q, { sc: dm < 2.6 ? 0.7 : dm < 3.6 ? 0.8 + R() * 0.08 : 0.88 + R() * 0.18, ax: dm < 3.6 ? ax : 0, az: dm < 3.6 ? az : 0 });
    });
    if (!spot) return null;
    const [tsx, tsz] = spot.c, y = ground(spot.x, spot.z), ry = R() * TAU, c = Math.cos(ry), sn = Math.sin(ry);
    put(planeTree(spot.sc, spot.ax * c - spot.az * sn, spot.ax * sn + spot.az * c), mat(spot.x, y - 0.05, spot.z, 0, ry, 0)); put(ringP, mat(spot.x, y, spot.z)); claim(rectC(spot.x, spot.z, 0.97, 0.97));
    placed.tree.push([nd.x, nd.z]); if (dbg) (dbg.trees ||= []).push({ x: spot.x, z: spot.z, sc: spot.sc, ax: spot.ax, az: spot.az });
    // a bench in the shade beside the tree, facing the street
    const alongE = [tsx * 2.1, 0, tsz > 0 ? Math.PI : 0], alongN = [0, tsz * 2.1, -tsx * Math.PI / 2];   // beside the tree on the E–W or the N–S street, facing it
    for (const [ox, oz, bry] of along === 'x' ? [alongE, alongN] : [alongN, alongE]) {
      const bx = spot.x + ox, bz = spot.z + oz, br = Math.abs(Math.sin(bry)) > 0.5 ? rectC(bx, bz, 0.25, 0.97) : rectC(bx, bz, 0.97, 0.25);
      if (!free(br, 0.05) || !reach(bx, bz, nd.x, nd.z)) continue;
      const by = Math.min(ground(br.minX, br.minZ), ground(br.maxX, br.maxZ)) - 0.03; put(benchP, mat(bx, by, bz, 0, bry, 0)); claim(br);
      addPoi({ type: 'bench', x: bx, z: bz, y: by + 0.47, ry: bry, owner: name }); break;
    }
    gatherAt(nd, tsx, tsz);
    return spot;
  };
  const gatherAt = (nd, sx, sz) => { const x = nd.x + sx * (swX(nd.k) / 2 - 0.4), z = nd.z + sz * (swZ(nd.m) / 2 - 0.4); if (!solid.hit(rectC(x, z, 0.3, 0.3))) addPoi({ type: 'gather', x, z, y: ground(x, z), r: 2.2, owner: name, note: 'street corner' }); };
  // plane trees first: the thoroughfares' crossings and the busier side streets, one every 40 m or so
  for (const nd of nodes) {
    if (placed.tree.length >= 22 || !(nd.big || nd.d > 0.34) || !farFrom(placed.tree, nd.x, nd.z, 40)) continue;
    const sx = R() < 0.5 ? -1 : 1, sz = R() < 0.5 ? -1 : 1, spot = plantTree(nd, sx, sz, [], R() < 0.5 ? 'x' : 'z');
    if (spot) { nd.used = [spot.c]; nd.kinds = ['tree']; cornerTris[nd.d < 0.5 ? 1 : 0] += kindTris.tree; cornerAt.push([spot.x, spot.z]); if (dbg) dbg.corners.push({ kind: 'tree', x: spot.x, z: spot.z }); }
  }
  for (const nd of nodes) {
    const p = Math.max(0.15, clamp(0.85 * nd.d - 0.12, 0, 0.8)) * (nd.nh >= 6 ? 1 : 0.6);
    const pool = nd.d < 0.5 ? 1 : 0;      // the outskirts keep a share of the budget of their own
    if (R() > p || cornerTris[pool] > CORNER_BUDGET[pool]) continue;
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]]; for (let i = 3; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [corners[i], corners[j]] = [corners[j], corners[i]]; }
    const count = 1 + (R() < nd.d * 0.3 ? 1 : 0), used = [...(nd.used || [])], kinds = [...(nd.kinds || [])];     // never the same kind twice at one crossing
    let done = 0;
    for (const [sx, sz] of corners) {
      if (done >= count) break;
      const w = [['herm', 3], ['altar', 1.6], ['hekataion', 0.9], ['horos', 1.4],
        ['well', farFrom(placed.well, nd.x, nd.z, 60) && farFrom(placed.fountain, nd.x, nd.z, 60) ? 2.8 : 0], ['fountain', nd.d > 0.45 && farFrom(placed.fountain, nd.x, nd.z, 100) && farFrom(placed.well, nd.x, nd.z, 60) ? 2.4 : 0],
        ['tree', (nd.big || nd.d > 0.4) && farFrom(placed.tree, nd.x, nd.z, 48) ? 4.0 : 0]].map(([k, v]) => [k, kinds.includes(k) ? 0 : pool && kindTris[k] > 400 ? v * 0.4 : v]).filter(q => q[1] > 0);
      let t = R() * w.reduce((s, q) => s + q[1], 0), kind = w[0][0]; for (const q of w) if ((t -= q[1]) < 0) { kind = q[0]; break; }
      const face = Math.atan2(-sx, -sz), along = R() < 0.5 ? 'x' : 'z';
      let spot, y, tsx = sx, tsz = sz;
      if (kind === 'herm' || kind === 'altar' || kind === 'hekataion' || kind === 'horos') {
        const h = { herm: 0.3, altar: 0.5, hekataion: 0.33, horos: 0.2 }[kind];
        if (used.some(u => u[0] === sx && u[1] === sz) || !(spot = cornerSpot(nd, sx, sz, h, h, near))) continue;
        y = ground(spot.x, spot.z) - 0.04;
        const pr = { herm: hermP, altar: altarP, hekataion: hekP, horos: horosP }[kind];
        put(pr, mat(spot.x, y, spot.z, 0, kind === 'horos' ? face + Math.PI / 4 : face, 0));
        claim(spot.rr);
        const px = spot.x - sx * (h + 0.55), pz = spot.z - sz * (h + 0.55), inFront = !solid.hit(rectC(px, pz, 0.25, 0.25));   // the worshipper's spot, diagonally in front
        if (kind !== 'horos') addPoi({ type: kind === 'herm' ? 'shrine' : 'altar', x: inFront ? px : spot.x, z: inFront ? pz : spot.z, y: ground(px, pz), ry: face + Math.PI, r: 1.0, owner: name, note: kind });
      } else if (kind === 'well') {
        const hx = along === 'x' ? 1.45 : 0.85, hz = along === 'x' ? 0.85 : 1.45;
        const standAt = (q, cx, cz) => { const ry = along === 'x' ? (cx < 0 ? 0 : Math.PI) : (cz < 0 ? -Math.PI / 2 : Math.PI / 2), wx = q.x - Math.cos(ry) * 0.45, wz = q.z + Math.sin(ry) * 0.45; return [ry, wx, wz, ...(along === 'x' ? [wx, q.z - cz * 1.4] : [q.x - cx * 1.4, wz])]; };   // stand at the well head, on the street side
        if (!(spot = someCorner(nd, sx, sz, used, (cx, cz) => { const q = cornerSpot(nd, cx, cz, hx, hz, deep), st = q && standAt(q, cx, cz); return q && !solid.hit(rectC(st[3], st[4], 0.3, 0.3)) ? q : null; }))) continue;
        [tsx, tsz] = spot.c;
        const [ry, wx, wz, qx, qz] = standAt(spot, tsx, tsz);
        y = Math.min(ground(spot.rr.minX, spot.rr.minZ), ground(spot.rr.maxX, spot.rr.maxZ), ground(spot.x, spot.z)) - 0.04; put(wellP, mat(spot.x, y, spot.z, 0, ry, 0)); claim(spot.rr);
        addPoi({ type: 'well', x: qx, z: qz, y: ground(qx, qz), ry: Math.atan2(wx - qx, wz - qz), r: 1.2, owner: name }); placed.well.push([nd.x, nd.z]); gatherAt(nd, tsx, tsz);
      } else if (kind === 'fountain') {
        const hx = along === 'x' ? 1.12 : 0.97, hz = along === 'x' ? 0.97 : 1.12, faceOf = (cx, cz) => along === 'x' ? (cz > 0 ? Math.PI : 0) : (cx < 0 ? Math.PI / 2 : -Math.PI / 2);   // back to the block, basin to the street
        if (!(spot = someCorner(nd, sx, sz, used, (cx, cz) => { const q = cornerSpot(nd, cx, cz, hx, hz, deep), f = faceOf(cx, cz); return q && !solid.hit(rectC(q.x + Math.sin(f) * 1.35, q.z + Math.cos(f) * 1.35, 0.3, 0.3)) ? q : null; }))) continue;
        [tsx, tsz] = spot.c;
        const ry = faceOf(tsx, tsz);
        y = Math.min(ground(spot.x - hx, spot.z - hz), ground(spot.x + hx, spot.z + hz), ground(spot.x, spot.z)) - 0.04; put(fountainP, mat(spot.x, y, spot.z, 0, ry, 0)); claim(spot.rr);
        const fx = spot.x + Math.sin(ry) * 1.35, fz = spot.z + Math.cos(ry) * 1.35;
        addPoi({ type: 'fountain', x: fx, z: fz, y: ground(fx, fz), ry: ry + Math.PI, r: 1.6, owner: name }); placed.fountain.push([nd.x, nd.z]); gatherAt(nd, tsx, tsz);
      } else {
        if (!(spot = plantTree(nd, sx, sz, used, along))) continue;
        [tsx, tsz] = spot.c;
      }
      used.push([tsx, tsz]); kinds.push(kind); done++; cornerTris[pool] += kindTris[kind]; cornerAt.push([spot.x, spot.z]); if (dbg) dbg.corners.push({ kind, x: spot.x, z: spot.z });
    }
  }
  if (dbg) dbg.cornerInfo = { nodes: [nodes.filter(n => n.d >= 0.5).length, nodes.filter(n => n.d < 0.5).length], tris: cornerTris.slice() };
  mark('corners');

  // ---------- goods against the house walls beside the doors; carts, ox-carts and donkeys at the street edge and on the roads ----------
  R = rng(7919);
  let clutterTris = 0; const CLUTTER_BUDGET = 122200, nGroup = {};
  const wallRuns = [...runs];
  for (let m = GRID.m0; m <= GRID.m1; m++) {      // the avenue's stretches between crossings and the platea's: houses stand along them too
    const a0 = Math.max(streetZ(m) + swZ(m) / 2, -57), a1 = Math.min(streetZ(m + 1) - swZ(m + 1) / 2, 361), hs = [...houses(-1, m), ...houses(0, m)];
    if (hs.length && a1 - a0 > 8) wallRuns.push({ axis: 'z', k: 0, m, c: streetX(0), w: swX(0), a0, a1, hs, chan: 'none', side: 0, ...frame('z', streetX(0)) });
  }
  for (let k = GRID.k0; k <= GRID.k1; k++) {
    const a0 = streetX(k) + swX(k) / 2, a1 = streetX(k + 1) - swX(k + 1) / 2, hs = [...houses(k, -1), ...houses(k, 0)];
    if (hs.length) wallRuns.push({ axis: 'x', k, m: 0, c: streetZ(0), w: swZ(0), a0, a1, hs, chan: 'none', side: 0, ...frame('x', streetZ(0)) });
  }
  for (const r of wallRuns) if (r.d === undefined) r.d = dens(...P(r, (r.a0 + r.a1) / 2, 0));
  // the walls along side s of a run: {lo, hi} along it, u the house collider's edge from the centre line, the door (along) if the front
  const facesOf = (r, s) => {
    const f = [];
    for (const h of r.hs) {
      const rects = [{ minX: h.x - h.w / 2, maxX: h.x + h.w / 2, minZ: h.z - h.d / 2, maxZ: h.z + h.d / 2, main: true }, ...(h.wing ? [{ minX: h.wing.x - h.wing.w / 2, maxX: h.wing.x + h.wing.w / 2, minZ: h.wing.z - h.wing.d / 2, maxZ: h.wing.z + h.wing.d / 2 }] : [])];
      for (const q of rects) {
        const [lo, hi, u] = r.axis === 'x' ? [q.minX, q.maxX, s > 0 ? q.minZ - r.c : r.c - q.maxZ] : [q.minZ, q.maxZ, s > 0 ? q.minX - r.c : r.c - q.maxX];
        if (u < r.w / 2 + 0.4 || u > r.w / 2 + 8.8 || hi - lo < 2) continue;      // no wall within ~9 m of the street edge: nothing set out
        const door = r.axis === 'x' && q.main && Math.sign(h.door.nz) === -s ? h.door.x : null;
        f.push({ lo: Math.max(lo + 0.1, r.a0 + 1.2), hi: Math.min(hi - 0.1, r.a1 - 1.2), u: u - 0.3, door });
      }
    }
    return f;
  };
  // where each kind of vignette already stands (60 m cells): the same kind again within 60 m is picked less often
  const gSeen = new Map(), spots = [...cornerAt], seenNear = (gname, x, z) => {
    const i = Math.floor(x / 60), j = Math.floor(z / 60);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const q of gSeen.get((i + di) * 4096 + j + dj) || []) if (q[0] === gname && Math.hypot(q[1] - x, q[2] - z) < 60) return true;
    return false;
  };
  const seen = (gname, x, z) => { const k = Math.floor(x / 60) * 4096 + Math.floor(z / 60); if (!gSeen.has(k)) gSeen.set(k, []); gSeen.get(k).push([gname, x, z]); spots.push([x, z]); };
  const pickGroup = (d, room, cheap, x, z) => {
    const w = GROUPS.filter(([, dmin, g]) => d >= dmin && 2 * g.la <= room && !(g.name === 'build' && (nGroup.build || 0) >= 18) && !(g.name === 'wood' && (nGroup.wood || 0) >= 120) && !(cheap && g.tris > cheap))
      .map(([wt, dm, g]) => [seenNear(g.name, x, z) ? wt * 0.3 : wt, dm, g]);
    let t = R() * w.reduce((s, q) => s + q[0], 0); for (const q of w) if ((t -= q[0]) < 0) return q[2]; return w.length ? w[0][2] : null;
  };
  const setGroup = (r, s, g, a, uw, mirror) => {
    const uc = s * (uw - 0.05 - g.lc), rr = rectOf(r, a - g.la, a + g.la, uc - g.lc, uc + g.lc);
    if (!free(rr, 0.02) || ![0, -0.8, 0.8].every(e => reach(...P(r, a + e * g.la, uc), ...P(r, a + e * g.la, 0)))) return false;     // the whole of it in plain sight of the street
    const [cx, cz] = P(r, a, uc), ry = faceRy(r, s), c = Math.cos(ry), sn = Math.sin(ry), mx = mirror ? -1 : 1;
    for (const [p, lx, lz] of g.parts) {
      const x = cx + c * lx * mx + sn * lz, z = cz - sn * lx * mx + c * lz, y = settle(p, x, z, ry, p.la, p.lc);
      if (p.seat) addPoi({ type: 'seat', x, z, y: y + p.seat, ry, owner: name });
      if (dbg) dbg.props.push({ kind: p.kind, x, z, group: g.name });
    }
    claim(rr);
    if (g.fixed) {       // someone loading the cart or seeing to the donkey, on the street side of it
      const [wx, wz] = P(r, a, uc - s * (g.lc + 0.5)), wr = rectC(wx, wz, 0.3, 0.3);
      if (!solid.hit(wr) && !inLane(wr) && !occ.hit(wr)) addPoi({ type: 'work', x: wx, z: wz, y: ground(wx, wz), ry: Math.atan2(cx - wx, cz - wz), r: 0.8, owner: name, note: g.name === 'donkey' ? 'load the donkey' : 'load the cart' });
    }
    clutterTris += g.tris; nGroup[g.name] = (nGroup[g.name] || 0) + 1; seen(g.name, cx, cz);
    return true;
  };
  // up to `want` groups along side s, one to a wall, beside a door (never in front of it) where the wall has one
  const dressWall = (r, s, want, cheap, budget) => {
    const fs = (r.faces ||= {})[s] ||= facesOf(r, s);
    let n = 0;
    for (const f of fs.map(f => [f, R()]).sort((p, q) => (q[0].door !== null) - (p[0].door !== null) || p[1] - q[1]).map(q => q[0])) {     // the fronts with a door first
      if (n >= want) break;
      if (f.used) continue;
      const [fx, fz] = P(r, (f.lo + f.hi) / 2, s * f.u);
      for (let t = 0; t < 3 && !f.used; t++) {
        const g = pickGroup(r.d, f.hi - f.lo, cheap, fx, fz); if (!g) break;
        if (clutterTris + g.tris > budget) return n;
        const as = [...(f.door !== null ? [2.1, 2.9, 3.8].flatMap(o => R() < 0.5 ? [f.door + o + g.la, f.door - o - g.la] : [f.door - o - g.la, f.door + o + g.la]) : []), ...[0.5, R(), R()].map(q => lerp(f.lo + g.la, f.hi - g.la, q))]
          .filter(a => f.door === null || Math.abs(a - f.door) >= g.la + 2.0);     // beside a door, never in front of it
        if (as.some(a => a - g.la >= f.lo - 1e-6 && a + g.la <= f.hi + 1e-6 && setGroup(r, s, g, a, f.u, !g.fixed && R() < 0.5))) { f.used = true; n++; }
      }
    }
    return n;
  };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // the traffic first, with a share of its own: carts, ox-carts and tethered donkeys at the street edge, on the avenue and along the roads
  const aveRuns = [{ axis: 'z', c: 145, w: 11.1, a0: -50, a1: 360, side: 0, chan: 'none', d: 0.9, ave: true, ...frame('z', 145) }];
  const roadRuns = [];      // the verges of the city's gravel roads where houses stand near, in 40 m pieces
  for (const rd of roads) for (let i = 0; i < rd.pts.length - 1; i++) {
    const [x0, z0] = rd.pts[i], [x1, z1] = rd.pts[i + 1], L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L;
    for (let a = 0; a < L - 8; a += 40) {
      const q = { axis: 'r', ox: x0, oz: z0, dx, dz, nx: -dz, nz: dx, a0: a, a1: Math.min(L, a + 40), w: rd.width + 0.9, side: 0, chan: 'none', road: true }, [mx, mz] = P(q, a + 20, 0);
      if (offLimits(mx, mz) || layout.housesIn(rectC(mx, mz, 30, 30)).length < 2) continue;
      q.d = Math.max(0.3, dens(mx, mz)); q.mx = mx; q.mz = mz; roadRuns.push(q);
    }
  }
  const TRAFFIC_BUDGET = 18000, oxAt = [];
  // one vehicle or animal pr at a along side s of run r: against the edge (on the avenue inside the kerb, or out on its verge), clear of the lane
  const parkAt = (r, s, pr, kind, a) => {
    const hw = r.w / 2, drain = r.chan !== 'none' && s === r.side, la = pr.la, lc = pr.lc;
    if (a - la < r.a0 + 1.2 || a + la > r.a1 - 1.2) return false;
    if (r.ave && crossZ.some(([g0, g1]) => a + la > g0 - 1.5 && a - la < g1 + 1.5)) return false;
    const wide = r.ave && kind === 'oxcart';     // an ox-cart on the avenue stands against the kerb and leaves 7 m of the way clear
    for (const push of drain ? [1.3, 1.8] : r.road ? [0, 0.3, 0.8] : wide ? [0.1, 0.65 + 2 * lc] : r.ave ? [0, 0.25, 0.65 + 2 * lc, 1.0 + 2 * lc] : [0, 0.25, 0.6, 1.1]) {
      const uc = s * (hw - lc - 0.05 + push) + (r.road ? 2 * s * lc : 0), rr = rectOf(r, a - la, a + la, uc - lc, uc + lc);
      if ((wide && Math.abs(uc) - lc < 3.6) || !free(rr, wide ? 0.03 : 0.1, !wide, r.road ? lc + 0.25 : undefined, wide ? 0.5 : 1.5) || !reach(...P(r, a, uc), ...P(r, a, 0))) continue;
      const [x, z] = P(r, a, uc), ry = faceRy(r, s) + (kind !== 'donkey' && R() < 0.5 ? Math.PI : 0);
      settle(pr, x, z, ry, la, lc); claim(rr);
      for (const e of R() < 0.5 ? [1, -1] : [-1, 1]) {       // the one tending it stands beside it along the street, clear of the lane
        const [wx, wz] = P(r, a + e * (la + 0.45), uc), wr = rectC(wx, wz, 0.3, 0.3);
        if (solid.hit(wr) || inLane(wr) || occ.hit(wr)) continue;
        addPoi({ type: 'work', x: wx, z: wz, y: ground(wx, wz), ry: Math.atan2(x - wx, z - wz), r: 0.8, owner: name, note: kind === 'donkey' ? 'tend the donkey' : 'load the cart' }); break;
      }
      clutterTris += pr.tris; nGroup[kind] = (nGroup[kind] || 0) + 1; spots.push([x, z]); if (dbg) dbg.props.push({ kind, x, z });
      if (kind === 'oxcart') oxAt.push([x, z]);
      return true;
    }
    return false;
  };
  // ox-carts: on the avenue, up the road north and in the busiest side streets, taken in turn, 50 m or more apart
  {
    const slots = [[], [], []];
    for (let i = 0; i < 6; i++) slots[0].push([aveRuns[0], i % 2 ? 1 : -1, lerp(-40, 350, (i + R() * 0.6) / 6)]);
    for (const q of roadRuns.filter(q => Math.abs(q.mx - 145) < 6 && q.mz < -60).sort((p, q) => q.mz - p.mz)) slots[1].push([q, R() < 0.5 ? -1 : 1, lerp(q.a0 + 6, q.a1 - 6, R())]);
    for (const q of runs.filter(q => q.d > 0.55 && q.a1 - q.a0 > 20).map(q => [q, q.d + R() * 0.25]).sort((p, q) => q[1] - p[1]).map(q => q[0])) slots[2].push([q, R() < 0.5 ? -1 : 1, lerp(q.a0 + 4, q.a1 - 4, R())]);
    for (let turn = 0, n = [0, 0, 0]; oxAt.length < 12 && turn < 120; turn++) {
      const kind = turn % 3; if (n[kind] >= slots[kind].length) continue;
      const [r, s, a] = slots[kind][n[kind]++], [x, z] = P(r, a, 0);
      if (!farFrom(oxAt, x, z, 50)) continue;
      const pr = pick(TRAFFIC.oxcart);
      for (const da of [0, 4, -4, 9, -9]) if (parkAt(r, s, pr, 'oxcart', a + da) || parkAt(r, -s, pr, 'oxcart', a + da)) break;
    }
  }
  const TW = [['handcart', 5, 0.3], ['oxcart', 1.5, 0.45], ['donkey', 5, 0.3]];
  const park = (r, s, spacing, budget) => {
    const mean = spacing(r.d);
    let a = r.a0 + 1.2 + R() * Math.min(mean, (r.a1 - r.a0) * 0.7), placed = 0;     // a short street gets its one now and then
    while (a < r.a1 - 1.2) {
      const w = TW.filter(k => r.d >= k[2]); if (!w.length) return placed;
      let t = R() * w.reduce((q, k) => q + k[1], 0), kind = w[0][0]; for (const k of w) if ((t -= k[1]) < 0) { kind = k[0]; break; }
      const pr = pick(TRAFFIC[kind]), la = pr.la;
      if (clutterTris + pr.tris > budget) return placed;
      if (a - la < r.a0 + 1.2) a = r.a0 + 1.2 + la;
      if (a + la > r.a1 - 1.2) return placed;
      if (kind === 'oxcart' && !farFrom(oxAt, ...P(r, a, 0), 50)) { a += 3; continue; }
      const ok = parkAt(r, s, pr, kind, a); if (ok) placed++;
      a += ok ? 2 * la + 1.5 + mean * (0.5 + R()) : r.ave && crossZ.some(([g0, g1]) => a + la > g0 - 1.5 && a - la < g1 + 1.5) ? 3 : 2.5;
    }
    return placed;
  };
  // one handcart or donkey somewhere along run r (either side), for the quarters the busy streets would leave without
  const parkOne = (r, budget) => {
    for (const t of [0.25 + R() * 0.5, 0.1 + R() * 0.25, 0.65 + R() * 0.25, 0.5]) for (const s of R() < 0.5 ? [-1, 1] : [1, -1]) {
      const kind = R() < 0.45 ? 'handcart' : 'donkey', pr = pick(TRAFFIC[kind]);
      if (clutterTris + pr.tris > budget) return false;
      if (parkAt(r, s, pr, kind, lerp(r.a0 + 1.3 + pr.la, r.a1 - 1.3 - pr.la, t))) return true;
    }
    return false;
  };
  for (const s of [-1, 1]) park(aveRuns[0], s, () => 90, TRAFFIC_BUDGET);
  {   // the upper town gets a share of its own, handed round its 100 m squares in turn, the busiest square first
    const cells = new Map(), NORTH = clutterTris + 5000;
    for (const q of runs) {
      const [mx, mz] = P(q, (q.a0 + q.a1) / 2, 0), k = Math.floor(mx / 100) * 4096 + Math.floor(mz / 100);
      if (mz > -60 || q.d <= 0.3 || q.a1 - q.a0 < 14 || Math.abs(mx - 145) < 12) continue;
      if (!cells.has(k)) cells.set(k, []); cells.get(k).push([q, q.d + R() * 0.3]);
    }
    const order = [...cells.values()].map(l => l.sort((p, q) => q[1] - p[1]).map(p => p[0])).sort((p, q) => q[0].d - p[0].d), got = order.map(() => 0);
    for (let round = 0, more = true; more && clutterTris < NORTH - 250; round++) {
      more = false;
      for (let c = 0; c < order.length && clutterTris < NORTH - 250; c++) {
        if (got[c] > round) continue;
        while (order[c].length) { more = true; if (parkOne(order[c].shift(), NORTH)) { got[c]++; break; } }
      }
    }
    if (dbg) dbg.northCells = [order.length, got.filter(n => n > 0).length, got.reduce((a, b) => a + b, 0)];
  }
  for (const r of [...runs.filter(q => q.d > 0.3), ...roadRuns].map(q => [q, q.d + R() * 0.3]).sort((p, q) => q[1] - p[1]).map(q => q[0])) for (const s of [-1, 1]) park(r, s, d => lerp(380, 110, smoothstep(0.3, 0.95, d)), TRAFFIC_BUDGET);
  if (dbg) dbg.phaseT = [clutterTris, dbg.props.length];
  // then one of the smaller groups to every street with houses along it, the busiest first
  const FILL = 5000, MORE = 1000, PHASE1 = CLUTTER_BUDGET - FILL - MORE;
  for (const r of wallRuns.map(q => [q, q.d + R() * 0.2]).sort((p, q) => q[1] - p[1]).map(q => q[0])) { const s0 = R() < 0.5 ? -1 : 1, cheap = r.d < 0.4 ? 165 : 240; dressWall(r, s0, 1, cheap, PHASE1) || dressWall(r, -s0, 1, cheap, PHASE1); }
  if (dbg) dbg.phase0 = [clutterTris, dbg.props.length, wallRuns.length, wallRuns.filter(r => r.faces && (r.faces[1] || r.faces[-1] || []).some(f => f.used)).length, wallRuns.filter(r => r.faces && [...(r.faces[1] || []), ...(r.faces[-1] || [])].length).length, wallRuns.filter(r => !r.faces).length];
  // any stretch of 25 m or more still bare gets something: goods at a wall, else a handcart or a donkey
  for (const r of runs.filter(q => q.a1 - q.a0 >= 25).map(q => [q, q.d + R() * 0.2]).sort((p, q) => q[1] - p[1]).map(q => q[0])) {
    if (spots.some(([x, z]) => { const dx = x - r.ox, dz = z - r.oz, a = dx * r.dx + dz * r.dz; return a > r.a0 - 3 && a < r.a1 + 3 && Math.abs(dx * r.nx + dz * r.nz) < r.w / 2 + 9; })) continue;
    const s0 = R() < 0.5 ? -1 : 1;
    if (!(dressWall(r, s0, 1, 165, CLUTTER_BUDGET - MORE) || dressWall(r, -s0, 1, 165, CLUTTER_BUDGET - MORE) || parkOne(r, CLUTTER_BUDGET - MORE)) && dbg) (dbg.bare ||= []).push(P(r, (r.a0 + r.a1) / 2, 0));
  }
  if (dbg) dbg.phase1 = [clutterTris, dbg.props.length];
  // then the busier streets get more: a group every 30–70 m of wall on both sides
  for (const r of wallRuns.filter(q => q.d > 0.4).map(q => [q, q.d + R() * 0.15]).sort((p, q) => q[1] - p[1]).map(q => q[0]))
    for (const s of [-1, 1]) dressWall(r, s, Math.max(0, Math.round((r.a1 - r.a0) / lerp(70, 30, smoothstep(0.4, 0.95, r.d)))), 0, CLUTTER_BUDGET);
  if (dbg) Object.assign(dbg, { phase2: [clutterTris, dbg.props.length], groups: nGroup });
  mark('clutter');

  // ---------- meshes of my own ----------
  B.socles.add(kerb.geom()); const lg = lining.geom(); if (lg) B.socles.add(lg);
  // patinated bronze, tinted per piece; it reflects the sky once the city joins the scene
  const bronzeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.75, roughness: 0.62 });
  ctx.setupMaterial(bronzeMat);
  G.addEventListener('added', () => { const env = G.parent && G.parent.environment; if (env && !bronzeMat.envMap) { bronzeMat.envMap = env; bronzeMat.envMapIntensity = 0.2; bronzeMat.needsUpdate = true; } });
  if (E.i.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(E.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(E.c, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(E.u, 2)); g.setIndex(E.i); g.computeVertexNormals();
    const T = M.T && M.T.dirt;       // the terrain's own dirt, trodden smoother and tinted per street
    const earthMat = ctx.setupMaterial(new THREE.MeshStandardMaterial({ map: T ? T.map : null, normalMap: T ? T.normalMap : null, roughnessMap: T ? T.roughnessMap : null, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.35, normalScale: new THREE.Vector2(0.45, 0.45) }));
    const mesh = new THREE.Mesh(g, earthMat); mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = name; G.add(mesh);
  }
  if (pave.i.length) {        // the platea's paving: the socles' sandstone, laid flat, lighter and warmer than the precinct's ashlar
    const g = new THREE.BufferGeometry(), TS = M.T && M.T.sandstone;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pave.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(pave.u, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(pave.c, 3)); g.setIndex(pave.i); g.computeVertexNormals();
    const pm = new THREE.MeshStandardMaterial({ map: TS ? TS.map : null, normalMap: TS ? TS.normalMap : null, roughnessMap: TS ? TS.roughnessMap : null, color: 0xf4e9d6, vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.4, normalScale: new THREE.Vector2(0.8, 0.8) });
    if (M.T && M.T.macro) paveMacro(pm, M.T.macro);
    const mesh = new THREE.Mesh(g, ctx.setupMaterial(pm)); mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = name; G.add(mesh);
  }
  for (const [k, m] of [['paint', M.painted], ['terra', M.terracotta], ['bronze', bronzeMat], ['leaf', M.leafPlane]]) {
    if (!own[k].length) continue;
    const mesh = new THREE.Mesh(mergeGeometries(own[k], false), m); mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = name; G.add(mesh);
  }
}
