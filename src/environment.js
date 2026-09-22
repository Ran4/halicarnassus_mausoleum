// Sky, sea, clouds, the temenos (precinct) and vegetation.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Bucket, ColorBucket, box, lathe, rectSweep, tubeY, bone, ellipsoid, tx, mat, rng, lerp, clamp, smoothstep, TAU, scaleUV, makeNoise2D } from './util.js';
import { terrainHeight, slopeAt, inTerrace, SEA, TERRACE, flats } from './terrain.js';
import { makeColumn, MZ } from './mausoleum.js';
import { figureGeometry } from './sculpture.js';

// ---------- sky + environment map ----------
export function buildSky(renderer, scene, sunDir) {
  const sky = new Sky();
  sky.scale.setScalar(12000);
  const u = sky.material.uniforms;
  u.turbidity.value = 3.2; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.0035; u.mieDirectionalG.value = 0.88;
  u.sunPosition.value.copy(sunDir);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(sky);
  const rt = pmrem.fromScene(envScene, 0.02);
  envScene.remove(sky);
  scene.add(sky);
  pmrem.dispose();
  return { sky, envMap: rt.texture };
}

export function buildSea(M) {
  const g = new THREE.PlaneGeometry(9000, 9000, 1, 1);
  g.rotateX(-Math.PI / 2);
  scaleUV(g, 9000 / 24, 9000 / 24);
  const m = new THREE.Mesh(g, M.sea);
  m.position.y = SEA; m.receiveShadow = false; m.name = 'sea';
  return m;
}

export function buildClouds(M) {
  const G = new THREE.Group(); const R = rng(77);
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(M.cloud);
    const a = R() * TAU, d = 2600 + R() * 4200, h = 900 + R() * 900;
    s.position.set(Math.cos(a) * d, h, Math.sin(a) * d);
    const w = 700 + R() * 1100; s.scale.set(w, w * (0.28 + R() * 0.2), 1);
    s.material = M.cloud; s.userData.drift = 0.6 + R();
    G.add(s);
  }
  G.name = 'clouds';
  return G;
}

// ---------- trees ----------
function oliveGeo(R) {
  const trunk = new Bucket(), leaves = new Bucket();
  const ph = R() * TAU, lean = 0.12 * (R() - 0.5), H = 2.0 + R() * 0.8;
  const wx = t => 0.35 * Math.sin(t * 2.5 + ph) * t + lean * t * H, wz = t => 0.3 * Math.cos(t * 2.1 + ph) * t;
  trunk.add(tubeY(7, 10, (i, j, t, a) => {
    const r = lerp(0.32, 0.13, t) * (1 + 0.28 * Math.sin(3 * a + t * 5 + ph) * (1 - 0.6 * t)) * (1 + 0.1 * Math.sin(7 * a));
    return [Math.cos(a) * r + wx(t), t * H, -Math.sin(a) * r + wz(t)];
  }, 1.6, H));
  const top = [wx(1), H, wz(1)];
  const nB = 3 + Math.floor(R() * 2);
  for (let b = 0; b < nB; b++) {
    const a = (b / nB) * TAU + R() * 0.8, L = 1.0 + R() * 0.9;
    const c = [top[0] + Math.cos(a) * L, H + 0.8 + R() * 0.7, top[2] - Math.sin(a) * L];
    trunk.add(bone(top, c, 0.09));
    const card = new THREE.PlaneGeometry(1.7, 1.7);
    for (let i = 0; i < 11; i++) {
      const px = c[0] + (R() - 0.5) * 2.4, py = c[1] + (R() - 0.5) * 1.6, pz = c[2] + (R() - 0.5) * 2.4;
      leaves.add(card, mat(px, py, pz, R() * TAU, R() * TAU, R() * TAU));
    }
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}
function cypressGeo(R, H) {
  const body = new Bucket(), cards = new Bucket(), trunk = new Bucket();
  const pts = [[0.02, 0]];
  for (let i = 1; i <= 12; i++) { const t = i / 12; pts.push([Math.max(0.03, 1.15 * Math.sin(Math.PI * Math.pow(t, 0.7)) * (0.9 + 0.15 * Math.sin(i * 2.3)) * (H / 11)), 0.6 + t * (H - 0.6)]); }
  pts.push([0.01, H + 0.05]);
  body.add(lathe(pts, 14));
  const card = new THREE.PlaneGeometry(2.6 * (H / 11), H);
  for (let i = 0; i < 3; i++) cards.add(card, mat(0, 0.5 + H / 2, 0, 0, i * Math.PI / 3, 0));
  trunk.add(new THREE.CylinderGeometry(0.12, 0.2, 1.4, 8), mat(0, 0.7, 0));
  return { body: body.build(), cards: cards.build(), trunk: trunk.build() };
}
function pineGeo(R) {
  const trunk = new Bucket(), leaves = new Bucket();
  const H = 6 + R() * 4, lean = (R() - 0.5) * 0.25, ph = R() * TAU;
  trunk.add(tubeY(6, 9, (i, j, t, a) => {
    const r = lerp(0.36, 0.17, t) * (1 + 0.08 * Math.sin(5 * a + ph));
    return [Math.cos(a) * r + lean * t * t * H + 0.3 * Math.sin(t * 3 + ph) * t, t * H, -Math.sin(a) * r];
  }, 1.8, H));
  const tx0 = lean * H + 0.3 * Math.sin(3 + ph);
  const cx = [tx0, H, 0];
  const nB = 4;
  for (let b = 0; b < nB; b++) { const a = b / nB * TAU + R(); trunk.add(bone(cx, [cx[0] + Math.cos(a) * 1.8, H + 0.9, cx[2] - Math.sin(a) * 1.8], 0.09)); }
  leaves.add(ellipsoid(3.4, 1.15, 3.4, 12, 8), mat(cx[0], H + 1.2, 0));
  const card = new THREE.PlaneGeometry(3.4, 3.0);
  for (let i = 0; i < 9; i++) {
    const a = R() * TAU, d = 0.6 + R() * 2.2;
    leaves.add(card, mat(cx[0] + Math.cos(a) * d, H + 1.0 + (R() - 0.5) * 1.2, -Math.sin(a) * d, (R() - 0.5) * 1.2, R() * TAU, (R() - 0.5) * 0.8));
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}
function planeGeo(R) {
  const trunk = new Bucket(), leaves = new Bucket();
  const H = 4.5 + R() * 1.5, ph = R() * TAU;
  trunk.add(tubeY(6, 12, (i, j, t, a) => { const r = lerp(0.5, 0.3, t) * (1 + 0.1 * Math.sin(4 * a + ph)); return [Math.cos(a) * r, t * H, -Math.sin(a) * r]; }, 3, H));
  const c = [0, H + 2.5, 0];
  for (let b = 0; b < 5; b++) { const a = b / 5 * TAU + R(); trunk.add(bone([0, H, 0], [Math.cos(a) * 2.8, H + 2.6 + R(), -Math.sin(a) * 2.8], 0.16)); }
  const card = new THREE.PlaneGeometry(2.6, 2.6);
  for (let i = 0; i < 46; i++) {
    let px, py, pz;
    do { px = (R() - 0.5) * 2; py = (R() - 0.5) * 2; pz = (R() - 0.5) * 2; } while (px * px + py * py + pz * pz > 1);
    leaves.add(card, mat(c[0] + px * 5.5, c[1] + py * 3.2, c[2] + pz * 5.5, R() * TAU, R() * TAU, R() * TAU));
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}

const NV = makeNoise2D(31);
export function buildVegetation(M, world) {
  const G = new THREE.Group();
  const R = rng(1234);
  const olives = [], pines = [], planes = [], cypress = [];
  const bOliveT = new Bucket(), bOliveL = new Bucket(), bPineT = new Bucket(), bPineL = new Bucket(), bPlaneT = new Bucket(), bPlaneL = new Bucket();
  const bCypB = new Bucket(), bCypC = new Bucket(), bCypT = new Bucket();
  const inFlat = (x, z) => flats.some(f => f.r ? Math.hypot(x - f.cx, z - f.cz) < f.r + 12 : (Math.abs(x - f.cx) < f.hw + 10 && Math.abs(z - f.cz) < f.hd + 10));
  const inTown = (x, z) => z > 58 && z < 445 && Math.abs(x) < 470;
  const okLand = (x, z, maxSlope) => terrainHeight(x, z) > SEA + 3 && slopeAt(x, z) < maxSlope && !inFlat(x, z) && !inTerrace(x, z, 6);
  // olive groves on the slopes around the city
  for (let n = 0; n < 9000 && olives.length < 1500; n++) {
    const a = R() * TAU, d = 380 + Math.pow(R(), 0.8) * 1150;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (z > 700 || inTown(x, z) || !okLand(x, z, 0.5)) continue;
    if (NV.fbm(x / 210, z / 210, 3) < -0.05) continue;
    if (terrainHeight(x, z) > 95) continue;
    olives.push([x, z, 0.8 + R() * 0.55]);
  }
  // pines on the upper hills
  for (let n = 0; n < 9000 && pines.length < 900; n++) {
    const a = R() * TAU, d = 450 + R() * 1300;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (inTown(x, z) || !okLand(x, z, 0.7)) continue;
    const h = terrainHeight(x, z); if (h < 55) continue;
    if (NV.fbm(x / 160 + 7, z / 160, 3) < -0.1) continue;
    pines.push([x, z, 0.85 + R() * 0.5]);
  }
  // formal cypress rows: inside the temenos, along the platea and the avenue
  for (let x = -112; x <= 112; x += 8.5) { for (const z of [-46.5, 46.5]) { if (z > 0 && Math.abs(x) < 12) continue; cypress.push([x, z, 9.5 + R() * 3.5, true]); } }
  // rows along the platea and the avenue: a tree that would stand in a side street's lane or on the platea is left out
  // (flagged, not dropped, so the random numbers — and every other tree — stay as they were)
  const inLane = (v, first, step, half) => { const r = ((v - first) % step + step) % step; return r < half || step - r < half; };
  for (let x = -440; x <= 440; x += 15) if (Math.abs(x) > 10) cypress.push([x, 79 + R() * 1.5, 8 + R() * 4, false, inLane(x, 145, 45, 3.5)]);
  for (let z = -40; z <= 380; z += 14) cypress.push([154 + R(), z, 8 + R() * 4, false, Math.abs(z - 64) < 10 || inLane(z, 64, 60, 4)]);
  for (let i = 0; i < 90; i++) { const a = R() * TAU, d = 300 + R() * 900; const x = Math.cos(a) * d, z = Math.sin(a) * d; if (okLand(x, z, 0.5) && !inTown(x, z)) cypress.push([x, z, 7 + R() * 5]); }
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; cypress.push([80 + Math.cos(a) * 58, -640 + Math.sin(a) * 40, 9 + R() * 3]); }
  // plane trees: temenos corners, agora front, a few by the harbour
  for (const [x, z] of [[-108, -40], [108, -40], [-108, 40], [108, 40]]) planes.push([x, z, 1, true]);
  for (let x = -110; x <= 110; x += 22) planes.push([x + (R() - 0.5) * 3, 363, 0.9 + R() * 0.3]);
  for (let i = 0; i < 10; i++) { const x = (R() - 0.5) * 500, z = 300 + R() * 60; if (okLand(x, z, 0.4) && Math.abs(x) > 130) planes.push([x, z, 0.9 + R() * 0.3]); }

  const groundY = (x, z) => inTerrace(x, z) ? 0 : terrainHeight(x, z);
  // a tree whose trunk would stand inside a building or a reserved public site is left out
  // (its random numbers are still drawn, so every other tree stays where it was)
  const occupied = (x, z, formal) => !formal && (world.blocked(x, z) || (world.layout && world.layout.isReserved({ minX: x - 1, maxX: x + 1, minZ: z - 1, maxZ: z + 1 })));
  for (const [x, z, s] of olives) { const g = oliveGeo(R); const m = mat(x, groundY(x, z) - 0.15, z, 0, R() * TAU, 0, s); if (occupied(x, z)) continue; bOliveT.add(g.trunk, m); bOliveL.add(g.leaves, m); }
  for (const [x, z, s] of pines) { const g = pineGeo(R); const m = mat(x, groundY(x, z) - 0.2, z, 0, R() * TAU, 0, s); if (occupied(x, z)) continue; bPineT.add(g.trunk, m); bPineL.add(g.leaves, m); }
  for (const [x, z, s, collide] of planes) { const g = planeGeo(R); const m = mat(x, groundY(x, z) - 0.1, z, 0, R() * TAU, 0, s); if (occupied(x, z, collide)) continue; bPlaneT.add(g.trunk, m); bPlaneL.add(g.leaves, m); if (collide) world.colliders.push({ minX: x - 0.55, maxX: x + 0.55, minZ: z - 0.55, maxZ: z + 0.55 }); }
  for (const [x, z, H, collide, skip] of cypress) { const g = cypressGeo(R, H); const m = mat(x, groundY(x, z) - 0.1, z, 0, R() * TAU, 0); if (skip || occupied(x, z, collide)) continue; bCypB.add(g.body, m); bCypC.add(g.cards, m); bCypT.add(g.trunk, m); if (collide) world.colliders.push({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 }); }

  for (const [b, m, shadow] of [[bOliveT, M.barkOlive, true], [bOliveL, M.leafOlive, true], [bPineT, M.barkPine, true], [bPineL, M.leafPine, true], [bPlaneT, M.barkOlive, true], [bPlaneL, M.leafPlane, true], [bCypB, M.cypressBody, true], [bCypC, M.leafCypress, false], [bCypT, M.barkPine, false]]) {
    const mesh = b.mesh(m, shadow); if (mesh) { mesh.name = 'vegetation'; G.add(mesh); }
  }
  return G;
}

// ---------- the temenos: pavement, peribolos wall, propylon, altar, stairs, honorific statues ----------
export function buildTemenos(M, world) {
  const G = new THREE.Group();
  const marble = new Bucket(), grey = new Bucket(), ashlar = new Bucket(), statue = new Bucket(), bronze = new Bucket(), egg = new Bucket(), wood = new Bucket();
  const { hw, hd } = TERRACE;
  // pavement
  const pave = new THREE.PlaneGeometry(2 * hw, 2 * hd); pave.rotateX(-Math.PI / 2); scaleUV(pave, 2 * hw, 2 * hd);
  const paveMesh = new THREE.Mesh(pave, M.pave); paveMesh.position.y = 0.01; paveMesh.receiveShadow = true; G.add(paveMesh);
  // peribolos wall segments: [x0,x1,z0,z1]
  const t = 1.4, top = 4.2, bot = -14;
  const segs = [
    [hw, hw + t, -hd - t, -4.5], [hw, hw + t, 4.5, hd + t],                     // east (gap for the propylon)
    [-hw - t, -hw, -hd - t, hd + t],                                              // west
    [-hw - t, -6.5, hd, hd + t], [6.5, hw + t, hd, hd + t],                       // south (gap for the stair)
    [-hw - t, hw + t, -hd - t, -hd],                                              // north
  ];
  for (const [x0, x1, z0, z1] of segs) {
    const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    ashlar.add(box(w, top - bot, d), mat(cx, (top + bot) / 2, cz));
    marble.add(box(w + 0.3, 0.28, d + 0.3), mat(cx, top + 0.14, cz));
    world.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 });
  }
  // ---- propylon (east gate) ----
  {
    const px = hw + t / 2, floorH = 0.3;
    marble.add(box(11.5, floorH, 14.5), mat(px, floorH / 2, 0));
    marble.add(box(1.4, 0.15, 14.5), mat(px + 6.4, 0.075, 0)); marble.add(box(1.4, 0.15, 14.5), mat(px - 6.4, 0.075, 0));
    world.extraGround.push((x, z) => (Math.abs(x - px) < 5.75 && Math.abs(z) < 7.25) ? floorH : (Math.abs(x - px) < 7.1 && Math.abs(z) < 7.25 ? 0.15 : -Infinity));
    for (const sz of [-1, 1]) { ashlar.add(box(11, 6.8, 1.0), mat(px, floorH + 3.4, sz * 6.75)); world.colliders.push({ minX: px - 5.5, maxX: px + 5.5, minZ: sz * 6.75 - 0.5, maxZ: sz * 6.75 + 0.5 }); }
    // cross wall with the doorway
    for (const sz of [-1, 1]) { ashlar.add(box(0.7, 6.8, 4.25), mat(px + 0.6, floorH + 3.4, sz * 4.125)); world.colliders.push({ minX: px + 0.25, maxX: px + 0.95, minZ: Math.min(sz * 2, sz * 6.25), maxZ: Math.max(sz * 2, sz * 6.25) }); }
    marble.add(box(0.9, 1.5, 4.6), mat(px + 0.6, floorH + 5.35, 0));
    // bronze door leaves, standing open
    for (const sz of [-1, 1]) bronze.add(box(0.08, 4.5, 1.9), mat(px + 0.15, floorH + 2.3, sz * (2 - 0.95), 0, sz * 1.25, 0));
    const col = makeColumn({ h: 6.4, rBot: 0.37, rTop: 0.31, baseH: 0.34, capH: 0.62 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const cx = px + sx * 4.3, cz = sz * 2.7;
      marble.add(col.marble, mat(cx, floorH, cz, 0, Math.PI / 2, 0)); egg.add(col.echinus, mat(cx, floorH, cz, 0, Math.PI / 2, 0));
      world.colliders.push({ minX: cx - 0.5, maxX: cx + 0.5, minZ: cz - 0.5, maxZ: cz + 0.5 });
    }
    const eY = floorH + 6.4;
    const E = [{ o: 0.3, y: 0 }, { o: 0.3, y: 0.2, hard: true }, { o: 0.36, y: 0.2, hard: true }, { o: 0.36, y: 0.42, hard: true }, { o: 0.42, y: 0.42, hard: true }, { o: 0.42, y: 0.66, hard: true }, { o: 0.5, y: 0.74, hard: true },
      { o: 0.45, y: 0.74, hard: true }, { o: 0.45, y: 0.98, hard: true }, { o: 0.65, y: 0.98, hard: true }, { o: 0.65, y: 1.04, hard: true }, { o: 0.82, y: 1.04, hard: true }, { o: 0.82, y: 1.26, hard: true }, { o: 0.9, y: 1.36 }, { o: 0.96, y: 1.44, hard: true }];
    marble.add(rectSweep(10.2, 13.5, E.map(p => ({ ...p, y: p.y + eY })), { top: true }), mat(px, 0, 0));
    // gabled roof: ridge along X, pediments east and west
    const rY = eY + 1.44, halfSpan = 13.5 / 2 + 0.96, pitch = 0.27, apex = halfSpan * pitch;
    for (const sz of [-1, 1]) {
      const L = Math.hypot(halfSpan, apex);
      const slab = box(12.2, 0.22, L + 0.3);
      marble.add(slab, mat(px, rY + apex / 2 + 0.1, sz * halfSpan / 2, sz * Math.atan2(apex, halfSpan), 0, 0));
    }
    for (const sx of [-1, 1]) {
      const sh = new THREE.Shape([new THREE.Vector2(-halfSpan, 0), new THREE.Vector2(halfSpan, 0), new THREE.Vector2(0, apex)]);
      const tym = new THREE.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: false });
      marble.add(tym, mat(px + sx * 5.1 - 0.25, rY, 0, 0, Math.PI / 2, 0));
    }
    marble.add(box(12.6, 0.35, 0.5), mat(px, rY + apex + 0.15, 0));
  }
  // ---- south stair down to the platea ----
  {
    const z0 = hd + t, rise = 0.4, tread = 0.55, W = 13;
    const foot = terrainHeight(0, z0 + 8);
    const n = Math.ceil(-foot / rise);
    for (let i = 0; i < n; i++) grey.add(box(W, 8, tread), mat(0, -(i + 1) * rise - 4, z0 + (i + 0.5) * tread));   // step i: top at -(i+1)·rise, as walked
    const L = n * tread;
    world.extraGround.push((x, z) => (Math.abs(x) < W / 2 && z >= z0 - 0.01 && z <= z0 + L + 0.01) ? Math.max(-Math.floor((z - z0) / tread + 1) * rise, terrainHeight(x, z)) : -Infinity);
    for (const sx of [-1, 1]) { ashlar.add(box(1.2, 8, L + 0.4), mat(sx * (W / 2 + 0.6), -2.5, z0 + L / 2)); world.colliders.push({ minX: sx * (W / 2 + 0.6) - 0.6, maxX: sx * (W / 2 + 0.6) + 0.6, minZ: z0 - 0.2, maxZ: z0 + L + 0.2 }); }
    // gate piers at the top of the stair
    for (const sx of [-1, 1]) { marble.add(box(1.6, 5.2, 1.6), mat(sx * 7.3, 2.6, z0 - 0.7)); }
  }
  // ---- altar east of the tomb ----
  {
    const ax = MZ.W / 2 + 3 * MZ.krepis.tread + 14, ay = 0;
    marble.add(rectSweep(8.5, 3.8, [{ o: 0.6, y: 0 }, { o: 0.6, y: 0.25, hard: true }, { o: 0.3, y: 0.25, hard: true }, { o: 0.3, y: 0.5, hard: true }, { o: 0, y: 0.5, hard: true }, { o: 0, y: 1.6, hard: true }, { o: 0.2, y: 1.7 }, { o: 0.35, y: 1.85, hard: true }], { top: true }), mat(ax, ay, 0));
    marble.add(box(6.5, 0.3, 2.4), mat(ax, 2.0, 0));
    world.colliders.push({ minX: ax - 4.9, maxX: ax + 4.9, minZ: -2.5, maxZ: 2.5 });
    world.altar = new THREE.Vector3(ax, 2.2, 0);
    world.extraGround.push((x, z) => (Math.abs(x - ax) < 4.85 && Math.abs(z) < 2.5) ? 0.5 : -Infinity);
  }
  // ---- honorific statues on pedestals along the approach ----
  {
    const R = rng(9);
    const figs = [figureGeometry({ seed: 51, draped: 'full' }), figureGeometry({ seed: 52, draped: 'short', spear: true }), figureGeometry({ seed: 53, draped: 'full', female: true }), figureGeometry({ seed: 54, draped: 'none', spear: true, shield: true })];
    for (let i = 0; i < 6; i++) for (const sz of [-1, 1]) {
      const x = 52 + i * 12, z = sz * 11;
      marble.add(rectSweep(1.5, 1.5, [{ o: 0.25, y: 0 }, { o: 0.25, y: 0.2, hard: true }, { o: 0.08, y: 0.35 }, { o: 0, y: 0.45, hard: true }, { o: 0, y: 1.85, hard: true }, { o: 0.1, y: 1.95 }, { o: 0.22, y: 2.1, hard: true }], { top: true }), mat(x, 0, z));
      statue.add(figs[(i + (sz > 0 ? 1 : 0)) % figs.length], mat(x, 2.1, z, 0, sz > 0 ? Math.PI : 0, 0, 1.15));
      world.colliders.push({ minX: x - 1.0, maxX: x + 1.0, minZ: z - 1.0, maxZ: z + 1.0 });
      bronze.add(new THREE.CylinderGeometry(0.02, 0.02, 2.4, 6), mat(x - 0.35, 3.2, z + sz * 0.1));
    }
    // benches (exedrae) near the west end
    for (const sz of [-1, 1]) marble.add(box(6, 0.5, 0.7), mat(-70, 0.25, sz * 30));
  }
  for (const [b, m] of [[marble, M.marble], [grey, M.marbleGrey], [ashlar, M.ashlar], [statue, M.marbleStatue], [bronze, M.bronze], [egg, M.eggDart], [wood, M.wood]]) {
    const mesh = b.mesh(m); if (mesh) { mesh.name = 'temenos'; G.add(mesh); }
  }
  return G;
}

// smoke rising from the altar
export function buildSmoke(M, origin) {
  const G = new THREE.Group(); const R = rng(3);
  const mat2 = M.cloud.clone(); mat2.color = new THREE.Color(0x6d6a66); mat2.opacity = 0.35; mat2.fog = true;
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(mat2.clone());
    s.userData = { t: R(), seed: R() * TAU };
    G.add(s);
  }
  G.position.copy(origin);
  G.userData.update = (time) => {
    for (const s of G.children) {
      const t = (s.userData.t + time * 0.06) % 1;
      const y = t * 22, x = Math.sin(s.userData.seed + time * 0.3) * (0.4 + t * 2.0) + t * 4, z = Math.cos(s.userData.seed * 1.3 + time * 0.2) * (0.4 + t * 2.0);
      s.position.set(x, y, z);
      const sc = 1.5 + t * 7; s.scale.set(sc, sc * 0.8, 1);
      s.material.opacity = 0.32 * (1 - t) * smoothstep(0, 0.1, t);
    }
  };
  return G;
}
