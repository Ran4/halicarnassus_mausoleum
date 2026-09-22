// Halicarnassus around the precinct: the gridded town, agora + stoas, harbour, ships, theatre,
// Temple of Ares, the palace on Zephyrion, the circuit wall and the roads.
// Everything the town adds beyond that lives in src/cityfeatures/ and plugs in through the layout (src/layout.js).
import * as THREE from 'three';
import { Bucket, ColorBucket, box, lathe, rectSweep, tubeY, bone, ellipsoid, tx, mat, rng, lerp, clamp, smoothstep, TAU, scaleUV } from './util.js';
import { terrainHeight, slopeAt, inTerrace, SEA, flats } from './terrain.js';
import { makeColumn } from './mausoleum.js';
import { figureGeometry } from './sculpture.js';
import { hipRoof, gableRoof, gableEnds, roadGeometry } from './citykit.js';
import { createLayout, streetX, streetZ, swX, swZ, GRID } from './layout.js';
import { FEATURES } from './cityfeatures/index.js';

// the circuit wall along the ridges, open to the sea between its two ends
export const WALL = [[-640, 640], [-700, 350], [-760, 0], [-720, -350], [-560, -650], [-300, -880], [0, -960], [300, -900], [560, -700], [740, -400], [780, -50], [760, 300], [640, 560]];
// inside the walls, at least `m` metres from them (the polygon is closed along the shore)
export function insideWalls(x, z, m = 0) {
  let inside = false;
  for (let i = 0, j = WALL.length - 1; i < WALL.length; j = i++) {
    const [xi, zi] = WALL[i], [xj, zj] = WALL[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  if (!inside || m <= 0) return inside;
  for (let i = 0; i < WALL.length - 1; i++) {
    const [x0, z0] = WALL[i], [x1, z1] = WALL[i + 1], dx = x1 - x0, dz = z1 - z0, t = clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz), 0, 1);
    if (Math.hypot(x - x0 - dx * t, z - z0 - dz * t) < m) return false;
  }
  return true;
}

const PLASTER = [0xf1e9d8, 0xe8dcc4, 0xe6d3b0, 0xf4efe4, 0xd9c7a3, 0xe9d9c0, 0xdcc39a, 0xefe3cd];
const ROOFS = [0xc8804f, 0xb8714a, 0xd08b5a, 0xa8654a, 0xc5895f, 0xbf7d55];

export function buildCity(M, world) {
  const G = new THREE.Group();
  const R = rng(2024);
  const walls = new ColorBucket(), roofs = new ColorBucket(), socles = new Bucket(), doors = new Bucket(), marble = new Bucket(), grey = new Bucket(), ashlar = new Bucket(), pave = new Bucket(), wood = new Bucket(), woodDark = new Bucket(), canvas = new Bucket(), egg = new Bucket(), statue = new Bucket(), gravel = new Bucket();
  const pick = arr => arr[Math.floor(R() * arr.length)];
  const inFlat = (x, z, m = 8) => flats.some(f => f.r ? Math.hypot(x - f.cx, z - f.cz) < f.r + m : (Math.abs(x - f.cx) < f.hw + m && Math.abs(z - f.cz) < f.hd + m));

  // ---------- plan: public sites claim ground before any house is placed ----------
  const layout = world.layout || (world.layout = createLayout());
  const B = { walls, roofs, socles, doors, marble, grey, ashlar, pave, wood, woodDark, canvas, egg, statue, gravel };
  const ctx = { M, world, layout, B, G, setupMaterial: world.setupMaterial || (m => m), kit: { stoa, ship, hipRoof, gableRoof, gableEnds, roadGeometry } };
  const runFeatures = (stage) => {
    for (const f of FEATURES) {
      if (typeof f[stage] !== 'function') continue;
      try { f[stage](ctx); } catch (e) { console.error(`[city:${f.name}] ${stage} failed`, e); }
    }
  };
  runFeatures('plan');

  // ---------- houses ----------
  // Every lot draws the same random numbers whether or not its house is built, so reserving a
  // site removes those houses and leaves the rest of the town exactly as it was.
  let houseCount = 0;
  function house(x, z, w, d, h, ry, two, lot) {
    const pc = pick(PLASTER), rc = pick(ROOFS);
    const gab = R() < 0.35;
    const doorOff = (R() - 0.5) * (w - 3);
    let wing = null;
    if (R() < 0.3) {
      const ww = w * 0.5, wd = d * 0.6, wh = h * 0.8, ox = (R() < 0.5 ? -1 : 1) * (w / 2 + ww / 2 - 0.5), oz = -d / 2 + wd / 2;
      wing = { ww, wd, wh, ox, oz };
    }
    const sg = ry === 0 ? 1 : -1;                 // ry is 0 or π: local (lx, lz) → world (x + sg·lx, z + sg·lz)
    if (wing) {
      // a wing may not run out into the street: try the other side, else leave it off
      const blk = layout.blockRect(lot.k, lot.m), fits = ox => x + sg * ox - wing.ww / 2 > blk.minX + 0.5 && x + sg * ox + wing.ww / 2 < blk.maxX - 0.5;
      if (!fits(wing.ox)) { if (fits(-wing.ox)) wing.ox = -wing.ox; else wing = null; }
    }
    const rec = {
      id: layout.houses.length, x, z, y: terrainHeight(x, z), w, d, h, ry, two, gable: gab, plaster: pc, roof: rc,
      door: { x: x + sg * doorOff, z: z + sg * (d / 2), nx: 0, nz: sg },
      wing: wing && { x: x + sg * wing.ox, z: z + sg * wing.oz, w: wing.ww, d: wing.wd, h: wing.wh },
      minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, lot, k: lot.k, m: lot.m,
    };
    if (rec.wing) {
      rec.minX = Math.min(rec.minX, rec.wing.x - rec.wing.w / 2); rec.maxX = Math.max(rec.maxX, rec.wing.x + rec.wing.w / 2);
      rec.minZ = Math.min(rec.minZ, rec.wing.z - rec.wing.d / 2); rec.maxZ = Math.max(rec.maxZ, rec.wing.z + rec.wing.d / 2);
    }
    if (layout.isReserved(rec, 1)) { lot.state = 'reserved'; return; }
    if (![[rec.minX, rec.minZ], [rec.maxX, rec.minZ], [rec.minX, rec.maxZ], [rec.maxX, rec.maxZ]].every(([px, pz]) => insideWalls(px, pz, 8))) { lot.state = 'outside'; return; }   // no town house outside its own walls

    const gy = rec.y;
    const m = mat(x, gy, z, 0, ry, 0);
    socles.add(box(w + 0.12, 3.2, d + 0.12), m.clone().multiply(mat(0, -0.6, 0)));
    walls.add(box(w, h - 1.0, d), m.clone().multiply(mat(0, 1.0 + (h - 1) / 2, 0)), pc);
    if (gab) { roofs.add(gableRoof(w, d), m.clone().multiply(mat(0, h, 0)), rc); walls.add(gableEnds(w, d), m.clone().multiply(mat(0, h, 0)), pc); }
    else roofs.add(hipRoof(w, d), m.clone().multiply(mat(0, h, 0)), rc);
    walls.add(box(w + 0.9, 0.1, d + 0.9), m.clone().multiply(mat(0, h + 0.05, 0)), 0xd8ccb8);
    // door on the front (+z local) and a couple of windows
    doors.add(box(1.1, 2.1, 0.14), m.clone().multiply(mat(doorOff, 1.05, d / 2 + 0.02)));
    if (two) for (let i = 0; i < 2; i++) doors.add(box(0.55, 0.7, 0.12), m.clone().multiply(mat((i - 0.5) * w * 0.5, h - 1.4, d / 2 + 0.02)));
    // occasional wing
    if (wing) {
      const { ww, wd, wh, ox, oz } = wing;
      socles.add(box(ww + 0.12, 3.2, wd + 0.12), m.clone().multiply(mat(ox, -0.6, oz)));
      walls.add(box(ww, wh - 1.0, wd), m.clone().multiply(mat(ox, 1.0 + (wh - 1) / 2, oz)), pc);
      roofs.add(hipRoof(ww, wd), m.clone().multiply(mat(ox, wh, oz)), rc);
      world.colliders.push({ minX: rec.wing.x - ww / 2 - 0.3, maxX: rec.wing.x + ww / 2 + 0.3, minZ: rec.wing.z - wd / 2 - 0.3, maxZ: rec.wing.z + wd / 2 + 0.3 });
    }
    // collider (axis aligned)
    const hw = w / 2 + 0.3, hdp = d / 2 + 0.3;
    world.colliders.push({ minX: x - hw, maxX: x + hw, minZ: z - hdp, maxZ: z + hdp });
    lot.state = 'house'; lot.house = rec;
    layout.houses.push(rec);
    houseCount++;
  }
  for (let k = GRID.k0; k <= GRID.k1; k++) for (let m = GRID.m0; m <= GRID.m1; m++) {
    const x0 = streetX(k) + swX(k) / 2, x1 = streetX(k + 1) - swX(k + 1) / 2;
    const z0 = streetZ(m) + swZ(m) / 2, z1 = streetZ(m + 1) - swZ(m + 1) / 2;
    const bw = x1 - x0, bd = z1 - z0;
    const nx = GRID.lotsX, nz = GRID.lotsZ, lw = bw / nx, ld = bd / nz;
    const block = { k, m, minX: x0, maxX: x1, minZ: z0, maxZ: z1, lots: [], houses: [] };
    layout.blocks.push(block);
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const lot = { k, m, i, j, minX: x0 + i * lw, maxX: x0 + (i + 1) * lw, minZ: z0 + j * ld, maxZ: z0 + (j + 1) * ld, state: 'void', house: null };
      layout.lots.push(lot); block.lots.push(lot);
      if (R() < 0.12) { lot.state = 'empty'; continue; }   // an open lot inside the town
      const w = 10 + R() * 6, d = 9 + R() * 5;
      const cx = x0 + (i + 0.5) * lw + (R() - 0.5) * (lw - w - 1), cz = z0 + (j + 0.5) * ld + (R() - 0.5) * (ld - d - 1);
      if (inTerrace(cx, cz, 9) || inFlat(cx, cz)) continue;
      const h = terrainHeight(cx, cz);
      if (h < SEA + 2.5 || slopeAt(cx, cz) > 0.34) continue;
      const dist = Math.hypot(cx, cz);
      let p = smoothstep(1150, 380, dist);
      if (cz < -60) p *= 0.55;
      if (cz > 445) p = 0;
      if (R() > p) continue;
      const two = R() < 0.3;
      house(cx, cz, w, d, two ? 6.2 + R() * 0.8 : 3.7 + R() * 0.8, (j === nz - 1 || (j > 0 && R() < 0.5)) ? 0 : Math.PI, two, lot);
      if (lot.house) block.houses.push(lot.house);
    }
  }

  // ---------- stoa builder ----------
  function stoa(cx, cz, len, depth, ry, level) {
    const m = mat(cx, level, cz, 0, ry, 0);
    const wallH = 6.5, colH = 5.2;
    walls.add(box(len, wallH, 0.8), m.clone().multiply(mat(0, wallH / 2, -depth / 2)), 0xe9dfcc);
    for (const s of [-1, 1]) walls.add(box(0.8, wallH, depth), m.clone().multiply(mat(s * (len / 2 - 0.4), wallH / 2, 0)), 0xe9dfcc);
    socles.add(box(len + 0.4, 1.5, depth + 0.4), m.clone().multiply(mat(0, -0.5, 0)));
    pave.add(scaleUV(new THREE.PlaneGeometry(len, depth), len, depth).rotateX(-Math.PI / 2), m.clone().multiply(mat(0, 0.26, 0)));
    // Doric colonnade along the front (+z local)
    const n = Math.floor(len / 2.6);
    const col = tubeY(4, 40, (i, j, t, a) => { const R0 = lerp(0.36, 0.29, t); const f = j % 2 ? 0.965 : 1; return [Math.cos(a) * R0 * f, 0.25 + t * colH, -Math.sin(a) * R0 * f]; }, 2, colH);
    const cap = new Bucket(); cap.add(lathe([[0.28, 0], [0.4, 0.15], [0.44, 0.2]], 20)); cap.add(box(0.95, 0.12, 0.95), mat(0, 0.26, 0));
    const capG = cap.build();
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + 1.3 + i * ((len - 2.6) / (n - 1));
      marble.add(col, m.clone().multiply(mat(x, 0, depth / 2 - 0.6)));
      marble.add(capG, m.clone().multiply(mat(x, 0.25 + colH, depth / 2 - 0.6)));
    }
    marble.add(box(len, 1.0, 0.9), m.clone().multiply(mat(0, colH + 0.25 + 0.5 + 0.32, depth / 2 - 0.6)));
    // single pitch roof from the back wall down to the colonnade
    const rise = wallH + 0.9 - (colH + 1.57), span = depth + 0.4, L = Math.hypot(span, rise);
    roofs.add(box(len + 0.8, 0.16, L), m.clone().multiply(mat(0, colH + 1.57 + rise / 2, 0.2, Math.atan2(rise, span), 0, 0)), 0xc9855a);
    // walls and columns block, the colonnade floor is walkable (ry is 0 or ±π/2)
    const c = Math.cos(ry), sn = Math.sin(ry);
    const worldRect = (lx0, lx1, lz0, lz1) => {
      const xs = [], zs = [];
      for (const lx of [lx0, lx1]) for (const lz of [lz0, lz1]) { xs.push(cx + c * lx + sn * lz); zs.push(cz - sn * lx + c * lz); }
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
    };
    world.colliders.push(worldRect(-len / 2, len / 2, -depth / 2 - 0.4, -depth / 2 + 0.4));
    for (const s of [-1, 1]) world.colliders.push(worldRect(s * (len / 2 - 0.4) - 0.4, s * (len / 2 - 0.4) + 0.4, -depth / 2, depth / 2));
    for (let i = 0; i < n; i++) { const x = -len / 2 + 1.3 + i * ((len - 2.6) / (n - 1)); world.colliders.push(worldRect(x - 0.4, x + 0.4, depth / 2 - 1.0, depth / 2 - 0.2)); }
    const floor = worldRect(-len / 2 - 0.2, len / 2 + 0.2, -depth / 2 - 0.2, depth / 2 + 0.2);
    world.extraGround.push((x, z) => (x > floor.minX && x < floor.maxX && z > floor.minZ && z < floor.maxZ) ? level + 0.26 : -Infinity);
    for (let x = -len / 2 + 5; x < len / 2 - 3; x += 9) { const p = worldRect(x, x, 0.3, 0.3); layout.addPoi({ type: 'gather', x: p.minX, z: p.minZ, y: level + 0.26, r: 2, owner: 'city', note: 'stoa shade' }); }
    layout.addArea({ name: 'stoa', ...worldRect(-len / 2 + 1.2, len / 2 - 1.2, -depth / 2 + 1, depth / 2 - 1.4), y: level + 0.26, owner: 'city' });
  }

  // ---------- agora + harbour ----------
  const agora = flats[2]; const L = agora.level;
  {
    const pl = scaleUV(new THREE.PlaneGeometry(250, 72), 250, 72).rotateX(-Math.PI / 2);
    pave.add(pl, mat(0, L + 0.05, 406));
    stoa(0, 378, 210, 13, 0, L);                 // north stoa, colonnade facing south
    stoa(-118, 408, 62, 11, Math.PI / 2, L);     // west stoa, colonnade facing east into the agora
    stoa(118, 408, 62, 11, -Math.PI / 2, L);     // east stoa facing west
    // a monument in the plaza
    marble.add(rectSweep(3, 3, [{ o: 0.4, y: 0 }, { o: 0.4, y: 0.3, hard: true }, { o: 0, y: 0.5, hard: true }, { o: 0, y: 4, hard: true }, { o: 0.3, y: 4.3, hard: true }], { top: true }), mat(0, L, 410));
    statue.add(figureGeometry({ seed: 77, draped: 'full' }), mat(0, L + 4.3, 410, 0, Math.PI, 0, 1.5));
    world.colliders.push({ minX: -1.9, maxX: 1.9, minZ: 408.1, maxZ: 411.9 });
    // quay along the shore
    ashlar.add(box(480, 12, 9), mat(0, L - 6, 445));
    pave.add(scaleUV(new THREE.PlaneGeometry(480, 9), 480, 9).rotateX(-Math.PI / 2), mat(0, L + 0.06, 445));
    const bollard = lathe([[0.45, -0.3], [0.45, 0.2], [0.36, 0.75], [0.4, 0.95], [0.3, 1.12], [0.01, 1.2]], 10);
    for (let i = 0; i < 20; i++) socles.add(bollard, mat(-230 + i * 24, L - 0.1, 449));
    // moles
    for (const s of [-1, 1]) {
      const pts = [[240, 446], [252, 500], [246, 555], [222, 605]];
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
        const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz), ang = Math.atan2(dx, dz);
        ashlar.add(box(9, 16, len + 2), mat(s * (x0 + dx / 2), SEA - 5.5, z0 + dz / 2, 0, s > 0 ? ang : -ang, 0));
      }
      grey.add(new THREE.CylinderGeometry(4.5, 5, 10, 16), mat(s * 222, SEA + 7, 605));
      grey.add(new THREE.CylinderGeometry(2.2, 2.6, 4, 12), mat(s * 222, SEA + 14, 605));
    }
  }

  // ---------- ships ----------
  function ship(x, z, ry, type = 'merchant', sail = false) {
    const m = mat(x, SEA, z, 0, ry, 0);
    const long = type === 'trireme' ? 17 : 10, wide = type === 'trireme' ? 2.4 : 3.4, hgt = type === 'trireme' ? 1.5 : 2.3;
    wood.add(ellipsoid(long, hgt, wide, 20, 10), m.clone().multiply(mat(0, 0.2, 0)));
    wood.add(box(long * 1.5, 0.15, wide * 1.35), m.clone().multiply(mat(0, hgt * 0.62 + 0.2, 0)));
    woodDark.add(bone([-long * 0.9, 0.8, 0], [-long * 1.05, hgt + 2.6, 0], 0.2), m);
    woodDark.add(bone([long * 0.9, 0.8, 0], [long * 1.02, hgt + 1.6, 0], 0.18), m);
    if (type === 'trireme') { woodDark.add(new THREE.ConeGeometry(0.5, 2.6, 8), m.clone().multiply(mat(long * 1.03, 0.1, 0, 0, 0, -Math.PI / 2))); for (let i = 0; i < 14; i++) for (const s of [-1, 1]) woodDark.add(new THREE.CylinderGeometry(0.06, 0.06, 4.5, 5), m.clone().multiply(mat(-long * 0.7 + i * long * 0.1, 0.3, s * (wide + 1.4), 0, 0, s * 0.5))); }
    const mastH = type === 'trireme' ? 11 : 13;
    if (!sail && type === 'trireme') {   // in harbour the mast and yard come down and lie along the deck
      const dy = hgt * 0.62 + 0.45;
      woodDark.add(new THREE.CylinderGeometry(0.14, 0.2, mastH, 8), m.clone().multiply(mat(-1, dy, 0.45, 0, 0, Math.PI / 2)));
      woodDark.add(new THREE.CylinderGeometry(0.08, 0.08, long * 1.05, 6), m.clone().multiply(mat(0, dy + 0.05, -0.5, 0, 0, Math.PI / 2)));
      return;
    }
    woodDark.add(new THREE.CylinderGeometry(0.16, 0.22, mastH, 8), m.clone().multiply(mat(type === 'trireme' ? -2 : 0, mastH / 2 + 0.5, 0)));
    const yardY = sail ? mastH - 0.6 : mastH * 0.62;
    woodDark.add(new THREE.CylinderGeometry(0.1, 0.07, long * 1.1, 6), m.clone().multiply(mat(type === 'trireme' ? -2 : 0, yardY, 0, Math.PI / 2, 0, 0)));
    if (sail) { const s = new THREE.PlaneGeometry(long * 1.0, mastH * 0.65, 6, 1); const p = s.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / long + 0.5) * Math.PI) * 1.4); s.computeVertexNormals(); canvas.add(s, m.clone().multiply(mat(type === 'trireme' ? -2 : 0, mastH - 0.6 - mastH * 0.33, 0, 0, Math.PI / 2, 0))); }
    else canvas.add(ellipsoid(0.26, long * 0.46, 0.3, 8, 8), m.clone().multiply(mat(0, yardY - 0.3, 0, Math.PI / 2, 0, 0)));   // sail furled along the lowered yard
  }
  for (let i = 0; i < 5; i++) ship(-150 + i * 62, 458, (R() - 0.5) * 0.2, 'merchant');
  for (let i = 0; i < 4; i++) ship(120 + i * 26, 470, Math.PI / 2 + (R() - 0.5) * 0.3, 'trireme');
  ship(-90, 540, 0.6, 'merchant'); ship(60, 585, -0.4, 'trireme'); ship(20, 640, 1.1, 'merchant');
  ship(-520, 1350, 0.4, 'merchant', true); ship(700, 1700, -1.9, 'merchant', true); ship(150, 1100, 2.4, 'trireme', true);

  // ---------- theatre (faces south) ----------
  {
    const f = flats[1], cx = f.cx, cz = f.cz, L = f.level;
    // seats: profile traversed outer→inner so the lathe faces the orchestra; outer wall separate
    const pts = [];
    let r = 12.5, y = 0;
    for (let i = 0; i < 34; i++) { pts.push([r, y], [r + 0.82, y], [r + 0.82, y + 0.4]); r += 0.82; y += 0.4; if (i === 16) { pts.push([r, y], [r + 2.4, y]); r += 2.4; } }
    pts.push([r + 1.2, y + 0.4]);
    const seats = lathe(pts.slice().reverse(), 64, Math.PI / 2 - 0.22, Math.PI + 0.44);
    grey.add(seats, mat(cx, L, cz));
    grey.add(lathe([[r + 1.2, -14], [r + 1.2, y + 0.4]], 64, Math.PI / 2 - 0.22, Math.PI + 0.44), mat(cx, L, cz));
    grey.add(lathe([[12.5, -6], [12.5, 0.02]], 48, Math.PI / 2 - 0.22, Math.PI + 0.44), mat(cx, L, cz));
    gravel.add(new THREE.CircleGeometry(12.6, 40).rotateX(-Math.PI / 2), mat(cx, L + 0.04, cz));
    // analemma walls at the two ends
    for (const s of [-1, 1]) { const a = Math.PI / 2 - 0.22; const ex = Math.sin(a) * s, ez = Math.cos(a); ashlar.add(box(1.6, 18, r - 10), mat(cx + ex * (r / 2 + 6), L + 1, cz + ez * (r / 2 + 6) * (s > 0 ? 1 : 1), 0, -s * (Math.PI / 2 - 0.22) + (s < 0 ? Math.PI : 0), 0)); }
    // skene
    const sk = mat(cx, L, cz + 19);
    walls.add(box(30, 7.5, 7), sk.clone().multiply(mat(0, 3.75, 0)), 0xe6dac4);
    roofs.add(hipRoof(30, 7), sk.clone().multiply(mat(0, 7.5, 0)), 0xc27d53);
    socles.add(box(30.2, 3, 7.2), sk.clone().multiply(mat(0, -0.5, 0)));
    for (let i = 0; i < 11; i++) marble.add(new THREE.CylinderGeometry(0.26, 0.3, 3.2, 12), sk.clone().multiply(mat(-13 + i * 2.6, 1.6, -4.2)));
    marble.add(box(29, 0.5, 1.4), sk.clone().multiply(mat(0, 3.45, -4.2)));
  }

  // ---------- Temple of Ares on its hill terrace ----------
  {
    const f = flats[3], cx = f.cx, cz = f.cz, L = f.level;
    ashlar.add(rectSweep(2 * f.hw, 2 * f.hd, [{ o: 0, y: L - 18 }, { o: 0, y: L + 0.3 }]), mat(cx, 0, cz));
    marble.add(box(2 * f.hw + 0.6, 0.4, 2 * f.hd + 0.6), mat(cx, L + 0.3, cz));
    pave.add(scaleUV(new THREE.PlaneGeometry(2 * f.hw, 2 * f.hd), 2 * f.hw, 2 * f.hd).rotateX(-Math.PI / 2), mat(cx, L + 0.52, cz));
    const base = L + 0.52;
    const ax = 40, az = 17.6, nx = 11, nz = 6;
    for (let i = 0; i < 3; i++) grey.add(rectSweep(ax + 3.4 + (2 - i) * 1.6, az + 3.4 + (2 - i) * 1.6, [{ o: 0, y: base + i * 0.38 }, { o: 0, y: base + (i + 1) * 0.38 }], { top: true }), mat(cx, 0, cz));
    const sty = base + 3 * 0.38;
    const col = makeColumn({ h: 8.6, rBot: 0.5, rTop: 0.42, baseH: 0.45, capH: 0.85 });
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
      const x = cx - ax / 2 + i * ax / (nx - 1), z = cz - az / 2 + j * az / (nz - 1);
      const onEW = (i === 0 || i === nx - 1) && !(j === 0 || j === nz - 1);
      marble.add(col.marble, mat(x, sty, z, 0, onEW ? Math.PI / 2 : 0, 0)); egg.add(col.echinus, mat(x, sty, z, 0, onEW ? Math.PI / 2 : 0, 0));
    }
    marble.add(box(ax - 8, 8.6, az - 6), mat(cx, sty + 4.3, cz));
    const eY = sty + 8.6;
    const E = [{ o: 0.4, y: 0 }, { o: 0.4, y: 0.28, hard: true }, { o: 0.46, y: 0.28, hard: true }, { o: 0.46, y: 0.58, hard: true }, { o: 0.52, y: 0.58, hard: true }, { o: 0.52, y: 0.9, hard: true }, { o: 0.62, y: 1.0, hard: true },
      { o: 0.55, y: 1.0, hard: true }, { o: 0.55, y: 1.32, hard: true }, { o: 0.8, y: 1.32, hard: true }, { o: 0.8, y: 1.4, hard: true }, { o: 1.0, y: 1.4, hard: true }, { o: 1.0, y: 1.7, hard: true }, { o: 1.1, y: 1.82 }, { o: 1.18, y: 1.94, hard: true }];
    marble.add(rectSweep(ax, az, E.map(p => ({ ...p, y: p.y + eY })), { top: true }), mat(cx, 0, cz));
    const rY = eY + 1.94, half = az / 2 + 1.18, apex = half * 0.27, Ls = Math.hypot(half, apex);
    for (const s of [-1, 1]) marble.add(box(ax + 2.6, 0.24, Ls + 0.3), mat(cx, rY + apex / 2 + 0.1, cz + s * half / 2, s * Math.atan2(apex, half), 0, 0));
    for (const s of [-1, 1]) { const sh = new THREE.Shape([new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0), new THREE.Vector2(0, apex)]); marble.add(new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false }), mat(cx + s * (ax / 2 + 0.4) - 0.25, rY, cz, 0, Math.PI / 2, 0)); }
    // altar east of the temple
    marble.add(rectSweep(6, 3, [{ o: 0.4, y: 0 }, { o: 0.4, y: 0.3, hard: true }, { o: 0, y: 0.5, hard: true }, { o: 0, y: 1.5, hard: true }, { o: 0.3, y: 1.7, hard: true }], { top: true }), mat(cx + ax / 2 + 14, base, cz));
  }

  // ---------- palace on Zephyrion ----------
  {
    const f = flats[4], cx = f.cx, cz = f.cz, L = f.level;
    ashlar.add(rectSweep(2 * f.hw, 2 * f.hd, [{ o: 0, y: L - 12 }, { o: 0, y: L + 7.5 }]), mat(cx, 0, cz));
    marble.add(rectSweep(2 * f.hw, 2 * f.hd, [{ o: 0.3, y: L + 7.5 }, { o: 0.3, y: L + 8 }], { top: true }), mat(cx, 0, cz));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) ashlar.add(box(13, 21, 13), mat(cx + sx * f.hw, L + 3, cz + sz * f.hd));
    pave.add(scaleUV(new THREE.PlaneGeometry(2 * f.hw - 2, 2 * f.hd - 2), 2 * f.hw, 2 * f.hd).rotateX(-Math.PI / 2), mat(cx, L + 0.1, cz));
    const bl = [[-25, -15, 36, 9, 20], [22, 5, 30, 11, 26], [-20, 22, 24, 7, 14], [25, -25, 20, 6.5, 16]];
    for (const [ox, oz, w, h, d] of bl) { walls.add(box(w, h, d), mat(cx + ox, L + h / 2, cz + oz), 0xefe6d4); roofs.add(hipRoof(w, d), mat(cx + ox, L + h, cz + oz), 0xc7825a); }
    // peristyle court
    for (let i = 0; i < 10; i++) for (const s of [-1, 1]) marble.add(new THREE.CylinderGeometry(0.3, 0.35, 5, 12), mat(cx - 9 + i * 2.6, L + 2.5, cz + s * 7));
  }

  // ---------- circuit wall along the ridges ----------
  {
    const pts = WALL;
    const gates = [[-745, 60], [770, 120]];           // the Myndos gate (west) and the east gate: an 8 m passage between two towers
    const wallBox = (x, z, r = 1.8) => world.colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0), n = Math.ceil(len / 18), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
      // openings along this stretch, as [s0, s1] distances from its start
      const cuts = gates.map(([gx, gz]) => { const s = (gx - x0) * dx + (gz - z0) * dz, off = Math.abs((gx - x0) * dz - (gz - z0) * dx); return off < 6 && s > 0 && s < len ? [s - 4, s + 4] : null; }).filter(Boolean);
      for (let k = 0; k < n; k++) {
        let pieces = [[k * len / n - 0.2, (k + 1) * len / n + 0.2]];
        for (const [c0, c1] of cuts) pieces = pieces.flatMap(([a, b]) => b <= c0 || a >= c1 ? [[a, b]] : [[a, c0], [c1, b]].filter(([p, q]) => q - p > 0.3));
        for (const [a, b] of pieces) {
          const sm = (a + b) / 2, xm = x0 + dx * sm, zm = z0 + dz * sm, h = terrainHeight(x0 + dx * (k + 0.5) * len / n, z0 + dz * (k + 0.5) * len / n);
          ashlar.add(box(3.2, 12, b - a), mat(xm, h + 2.5, zm, 0, ang, 0));
          for (let s = a + 1.5; s < b; s += 3) wallBox(x0 + dx * s, z0 + dz * s);
        }
        acc += len / n;
        const sm = (k + 0.5) * len / n;
        if (acc > 58 && !cuts.some(([c0, c1]) => sm > c0 - 8 && sm < c1 + 8)) {
          acc = 0; const xm = x0 + dx * sm, zm = z0 + dz * sm, h = terrainHeight(xm, zm);
          ashlar.add(box(9, 15, 9), mat(xm, h + 4.5, zm, 0, ang, 0)); wallBox(xm, zm, 5.5);
        }
      }
    }
    for (const [x, z] of gates) {
      const h = terrainHeight(x, z);
      for (const s of [-1, 1]) { ashlar.add(box(10, 17, 10), mat(x, h + 5.5, z + s * 9)); world.colliders.push({ minX: x - 5, maxX: x + 5, minZ: z + s * 9 - 5, maxZ: z + s * 9 + 5 }); }
      // threshold, and the two timber leaves standing open against the towers on the town side
      socles.add(box(10.4, 0.5, 8), mat(x, h - 0.12, z));
      const inward = x < 0 ? 1 : -1;
      for (const s of [-1, 1]) {
        woodDark.add(box(0.22, 5.2, 3.9), mat(x + inward * 5.3, h + 2.6, z + s * 3.9, 0, 0, 0));
        for (let b = 0; b < 3; b++) woodDark.add(box(0.12, 0.22, 3.9), mat(x + inward * 5.45, h + 0.9 + b * 1.7, z + s * 3.9));
        world.colliders.push({ minX: x + inward * 5.3 - 0.2, maxX: x + inward * 5.3 + 0.2, minZ: z + s * 3.9 - 1.95, maxZ: z + s * 3.9 + 1.95 });
      }
    }
  }

  // ---------- roads (gravel strips following the terrain) ----------
  // inside the grid they keep to the street lines, so no road runs through a house
  const roads = new Bucket();
  const road = (pts, width) => { roads.add(roadGeometry(pts, width)); layout.roads.push({ pts, width }); };
  layout.roads = [];
  road([[-470, 64], [-9, 64]], 16); road([[9, 64], [470, 64]], 16);            // the platea (the streets' paving meets the precinct stair in between)
  road([[145, -58], [145, 442]], 12);
  road([[123, 0], [151, 0]], 8);
  road([[145, -58], [145, -530], [100, -560], [80, -588]], 7);                    // north road up the avenue line to the Temple of Ares
  road([[-470, 64], [-582, 64], [-600, 72], [-745, 62]], 7);                      // west road to the Myndos gate
  road([[470, 64], [736, 64], [752, 84], [770, 120]], 7);                         // east road
  road([[-150, -292], [-150, -268], [-125, -250], [-125, -58]], 5);               // theatre road along street line x = -125

  // ---------- open ground and landmarks the town already has ----------
  layout.addArea({ name: 'agora', minX: -104, maxX: 104, minZ: 386, maxZ: 438, y: L, owner: 'city' });
  layout.addArea({ name: 'quay', minX: -238, maxX: 238, minZ: 441.5, maxZ: 448, y: L, owner: 'city' });
  layout.addArea({ name: 'temenos', minX: -118, maxX: 118, minZ: -49, maxZ: 49, y: 0, owner: 'city' });
  layout.addArea({ name: 'platea', minX: -470, maxX: 470, minZ: 57, maxZ: 71, y: null, owner: 'city' });
  layout.addPoi({ type: 'gather', x: 0, z: 416, y: L, r: 6, owner: 'city', note: 'agora monument' });
  if (world.altar) layout.addPoi({ type: 'altar', x: world.altar.x, z: world.altar.z, y: 0, ry: -Math.PI / 2, r: 6, owner: 'city' });

  // ---------- the town's additions (src/cityfeatures/) ----------
  runFeatures('build');
  layout.finalizeStreets(world);

  { const mesh = roads.mesh(M.roadEarth || M.gravel, false); if (mesh) { mesh.name = 'city'; G.add(mesh); } }
  for (const [b, m] of [[walls, M.plaster], [roofs, M.roof], [socles, M.sandstone], [doors, M.doorDark], [marble, M.marble], [grey, M.marbleGrey], [ashlar, M.ashlar], [pave, M.pave], [wood, M.wood], [woodDark, M.woodDark], [canvas, M.sand], [egg, M.eggDart], [statue, M.marbleStatue], [gravel, M.gravel]]) {
    const mesh = b.mesh(m); if (mesh) { mesh.name = 'city'; if (b === gravel || b === pave) mesh.castShadow = false; G.add(mesh); }
  }
  G.userData.houseCount = houseCount;
  G.userData.layout = layout;
  G.userData.update = (dt, t, camera) => { for (const u of layout.updaters) u(dt, t, camera); };
  return G;
}
