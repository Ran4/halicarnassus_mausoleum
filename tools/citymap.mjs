// Builds the town in Node (no browser, no GPU) and reports on the layout: what each feature in
// src/cityfeatures/ added (triangles, colliders, reservations, POIs), overlaps between a feature's
// colliders and houses or other features, street edges closed, and an optional ASCII map.
//
// usage: node tools/citymap.mjs [--map x0,z0,x1,z1] [--cell 4] [--json out.json] [--only feature]
//   --map     draw the rectangle as ASCII (1 char = --cell metres, default 4)
//             #  house   .  empty lot   R  reserved   o  feature collider   +  other collider   =  open street   x closed street
//   --json    dump the layout (houses, lots, reserved, pois, areas, street graph) for other tools
import * as THREE from 'three';
import fs from 'fs';
import { buildCity } from '../src/city.js';
import { buildTemenos } from '../src/environment.js';
import { mausoleumGround, mausoleumColliders } from '../src/mausoleum.js';
import { terrainHeight, inTerrace } from '../src/terrain.js';
import { FEATURES } from '../src/cityfeatures/index.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const errors = [];
const origErr = console.error, origWarn = console.warn;
console.error = (...a) => { errors.push(a.map(x => x instanceof Error ? x.stack : String(x)).join(' ')); };
console.warn = (...a) => { errors.push('WARN ' + a.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x)).join(' ')); };

const M = new Proxy({}, { get: (t, k) => t[k] || (t[k] = new THREE.MeshStandardMaterial({ name: String(k) })) });
const world = {
  colliders: [], extraGround: [],
  groundHeight(x, z) { let h = inTerrace(x, z) ? mausoleumGround(x, z) : terrainHeight(x, z); for (const f of this.extraGround) { const v = f(x, z); if (v > h) h = v; } return h; },
  blocked(x, z) { for (const c of this.colliders) if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true; return false; },
  setupMaterial: m => m,
};
world.colliders.push(...mausoleumColliders);
buildTemenos(M, world);

// instrument each feature
const report = {};
const triCount = g => g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0;
let ctxRef = null;
const bucketTris = () => { let n = 0; if (ctxRef) for (const b of Object.values(ctxRef.B)) for (const g of b.list) n += triCount(g); return n; };
const groupTris = () => { let n = 0; if (ctxRef) ctxRef.G.traverse(o => { if (o.isMesh) n += triCount(o.geometry) * (o.isInstancedMesh ? o.count : 1); }); return n; };
for (let i = 0; i < FEATURES.length; i++) {
  const f = FEATURES[i];
  const r = report[f.name] = { planMs: 0, buildMs: 0, tris: 0, colliders: [0, 0], reserved: 0, pois: 0, areas: 0, updaters: 0, meshes: 0 };
  FEATURES[i] = {
    name: f.name,
    plan: (ctx) => { ctxRef = ctx; const t0 = performance.now(), n0 = ctx.layout.reserved.length; f.plan?.(ctx); r.planMs = performance.now() - t0; r.reserved = ctx.layout.reserved.length - n0; },
    build: (ctx) => {
      ctxRef = ctx;
      const t0 = performance.now(), c0 = world.colliders.length, p0 = ctx.layout.pois.length, a0 = ctx.layout.areas.length, u0 = ctx.layout.updaters.length, tb = bucketTris(), tg = groupTris(), m0 = ctx.G.children.length;
      try { f.build?.(ctx); } finally {
        r.buildMs = performance.now() - t0; r.colliders = [c0, world.colliders.length];
        r.pois = ctx.layout.pois.length - p0; r.areas = ctx.layout.areas.length - a0; r.updaters = ctx.layout.updaters.length - u0;
        r.tris = (bucketTris() - tb) + (groupTris() - tg); r.meshes = ctx.G.children.length - m0;
      }
    },
  };
}
const t0 = performance.now();
const city = buildCity(M, world);
const layout = world.layout;
const buildMs = performance.now() - t0;

// ---------- overlap checks ----------
const ov = (a, b, m = 0) => a.minX < b.maxX - m && a.maxX > b.minX + m && a.minZ < b.maxZ - m && a.maxZ > b.minZ + m;
const owner = new Array(world.colliders.length).fill(null);
for (const [name, r] of Object.entries(report)) for (let i = r.colliders[0]; i < r.colliders[1]; i++) owner[i] = name;
const problems = [];
const houseBoxes = layout.houses.flatMap(h => [{ minX: h.x - h.w / 2, maxX: h.x + h.w / 2, minZ: h.z - h.d / 2, maxZ: h.z + h.d / 2, h }, ...(h.wing ? [{ minX: h.wing.x - h.wing.w / 2, maxX: h.wing.x + h.wing.w / 2, minZ: h.wing.z - h.wing.d / 2, maxZ: h.wing.z + h.wing.d / 2, h }] : [])]);
for (let i = 0; i < world.colliders.length; i++) {
  if (!owner[i]) continue;
  const c = world.colliders[i];
  for (const hb of houseBoxes) if (ov(c, hb, 0.05)) { problems.push(`${owner[i]}: collider ${fmt(c)} overlaps house #${hb.h.id} at (${hb.h.x.toFixed(1)}, ${hb.h.z.toFixed(1)})`); break; }
  for (let j = 0; j < i; j++) if (owner[j] && owner[j] !== owner[i] && ov(c, world.colliders[j], 0.05)) { problems.push(`${owner[i]}: collider ${fmt(c)} overlaps ${owner[j]} collider ${fmt(world.colliders[j])}`); break; }
}
function fmt(c) { return `[${c.minX.toFixed(1)}..${c.maxX.toFixed(1)} × ${c.minZ.toFixed(1)}..${c.maxZ.toFixed(1)}]`; }
for (const p of layout.pois) if (world.blocked(p.x, p.z) && !['stall', 'work', 'altar', 'shrine', 'seat', 'bench', 'fountain', 'well'].includes(p.type)) problems.push(`poi ${p.type} (${p.owner}) at (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) stands inside a collider`);

console.error = origErr; console.warn = origWarn;
const lotStates = {}; for (const l of layout.lots) lotStates[l.state] = (lotStates[l.state] || 0) + 1;
console.log(`built in ${(buildMs / 1000).toFixed(1)} s · houses ${layout.houses.length} · lots ${JSON.stringify(lotStates)} · colliders ${world.colliders.length} · pois ${layout.pois.length} · areas ${layout.areas.length} · street edges open ${layout.stats.openEdges}/${layout.edges.length}`);
let bucketTotal = 0; for (const o of city.children) if (o.isMesh) bucketTotal += triCount(o.geometry) * (o.isInstancedMesh ? o.count : 1);
console.log(`city meshes ${city.children.length} · city triangles ${Math.round(bucketTotal).toLocaleString()}`);
console.log('feature           tris   colliders reserved pois areas upd meshes  plan/build ms');
for (const [name, r] of Object.entries(report)) console.log(`${name.padEnd(12)} ${String(Math.round(r.tris)).padStart(9)} ${String(r.colliders[1] - r.colliders[0]).padStart(9)} ${String(r.reserved).padStart(8)} ${String(r.pois).padStart(4)} ${String(r.areas).padStart(5)} ${String(r.updaters).padStart(3)} ${String(r.meshes).padStart(6)}  ${r.planMs.toFixed(0)}/${r.buildMs.toFixed(0)}`);
const only = opt('--only');
const shown = problems.filter(p => !only || p.startsWith(only + ':') || p.includes(`(${only})`));
console.log(`\n${errors.length} errors/warnings, ${problems.length} overlap problems${only ? ` (${shown.length} for ${only})` : ''}`);
for (const e of errors.slice(0, 30)) console.log('  ERR', e.split('\n').slice(0, 4).join('\n      '));
for (const p of shown.slice(0, 60)) console.log('  ', p);
if (shown.length > 60) console.log(`   … ${shown.length - 60} more`);

const mapArg = opt('--map');
if (mapArg) {
  const [x0, z0, x1, z1] = mapArg.split(',').map(Number), cell = Number(opt('--cell', 4));
  const W = Math.ceil((x1 - x0) / cell), H = Math.ceil((z1 - z0) / cell);
  const grid = Array.from({ length: H }, () => new Array(W).fill(' '));
  const paint = (r, ch, pri) => {
    for (let j = Math.max(0, Math.floor((r.minZ - z0) / cell)); j < Math.min(H, Math.ceil((r.maxZ - z0) / cell)); j++)
      for (let i = Math.max(0, Math.floor((r.minX - x0) / cell)); i < Math.min(W, Math.ceil((r.maxX - x0) / cell)); i++) grid[j][i] = ch;
  };
  for (const e of layout.edges) {
    const ch = e.open ? '=' : 'x', hw = 0.5;
    paint({ minX: Math.min(e.a.x, e.b.x) - hw, maxX: Math.max(e.a.x, e.b.x) + hw, minZ: Math.min(e.a.z, e.b.z) - hw, maxZ: Math.max(e.a.z, e.b.z) + hw }, ch);
  }
  for (const l of layout.lots) if (l.state === 'empty') paint({ minX: l.minX + 2, maxX: l.maxX - 2, minZ: l.minZ + 2, maxZ: l.maxZ - 2 }, '.');
  for (const r of layout.reserved) paint(r, 'R');
  for (let i = 0; i < world.colliders.length; i++) paint(world.colliders[i], owner[i] ? 'o' : '+');
  for (const hb of houseBoxes) paint(hb, '#');
  console.log(`\nmap x ${x0}..${x1} (→), z ${z0}..${z1} (↓ south), ${cell} m per char`);
  console.log(grid.map(r => r.join('')).join('\n'));
}
const jsonOut = opt('--json');
if (jsonOut) {
  const strip = o => { const { lot, ...rest } = o; return rest; };
  fs.writeFileSync(jsonOut, JSON.stringify({
    houses: layout.houses.map(strip), lots: layout.lots.map(l => ({ ...l, house: l.house ? l.house.id : null })), reserved: layout.reserved,
    pois: layout.pois, areas: layout.areas, roads: layout.roads,
    nodes: layout.nodes.map(n => ({ id: n.id, k: n.k, m: n.m, x: n.x, z: n.z, y: n.y })),
    edges: layout.edges.map(e => ({ id: e.id, a: e.a.id, b: e.b.id, axis: e.axis, width: e.width, main: e.main, open: e.open, houses: e.houses, length: e.length })),
    report,
  }));
  console.log('wrote', jsonOut);
}
