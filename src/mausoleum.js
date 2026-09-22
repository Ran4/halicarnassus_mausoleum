// The Mausoleum itself (Jeppesen/Waywell-type reconstruction, c. 350 BC).
// +X = east, +Z = south. Terrace level y = 0.
import * as THREE from 'three';
import { Bucket, box, lathe, rectSweep, tubeY, tx, mat, rng, lerp, TAU, scaleUV } from './util.js';
import { figureGeometry, lionGeometry, horseGeometry, quadrigaGeometries } from './sculpture.js';

export const MZ = {
  W: 38.4, D: 32.5,
  krepis: { steps: 3, rise: 0.4, tread: 0.9 },
  tiers: [
    { y0: 1.2, y1: 7.0, w: 38.4, d: 32.5, frieze: null },
    { y0: 7.0, y1: 13.0, w: 35.6, d: 29.7, frieze: 'blue', friezeH: 0.75 },
    { y0: 13.0, y1: 20.0, w: 33.2, d: 27.3, frieze: 'red', friezeH: 0.9 },
  ],
  stylobate: { y: 20.0, h: 0.4, w: 32.2, d: 26.3 },
  cols: { ax: 30, az: 24, nx: 11, nz: 9, h: 9.6, rBot: 0.525, rTop: 0.44, baseH: 0.5, capH: 0.9 },
  entab: { h: 2.6 },
  pyramid: { steps: 24, rise: 0.29, w0: 31.5, d0: 25.5, topW: 8, topD: 6 },
  core: { w: 24, d: 18 },
};
MZ.colBaseY = MZ.stylobate.y + MZ.stylobate.h;            // 20.4
MZ.colTopY = MZ.colBaseY + MZ.cols.h;                     // 30.0
MZ.entabTop = MZ.colTopY + MZ.entab.h;                    // 32.6
MZ.pyramidTop = MZ.entabTop + MZ.pyramid.steps * MZ.pyramid.rise; // 39.56
MZ.plinthTop = MZ.pyramidTop + 1.0;

// ---------- walkable krepis + blocking podium ----------
export function mausoleumGround(x, z) {
  const k = MZ.krepis, ax = Math.abs(x), az = Math.abs(z);
  let h = 0;
  for (let i = 0; i < k.steps; i++) {
    const hw = MZ.W / 2 + k.tread * (k.steps - i), hd = MZ.D / 2 + k.tread * (k.steps - i);
    if (ax <= hw && az <= hd) h = (i + 1) * k.rise;
  }
  return h;
}
export const mausoleumColliders = [{ minX: -MZ.W / 2 - 0.45, maxX: MZ.W / 2 + 0.45, minZ: -MZ.D / 2 - 0.45, maxZ: MZ.D / 2 + 0.45 }];

// ---------- Ionic column (base + fluted shaft + volute capital) ----------
function spiralShape(r0, turns, band, ccw) {
  const k = Math.log(1 / 0.08) / (turns * TAU);
  const pts = [], inner = [];
  const N = Math.floor(turns * 40);
  for (let i = 0; i <= N; i++) {
    const th = (i / N) * turns * TAU;
    const r = r0 * Math.exp(-k * th);
    const a = Math.PI / 2 - th * (ccw ? -1 : 1);
    pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    const ri = Math.max(r - band * (0.35 + 0.65 * r / r0), 0.004);
    inner.push(new THREE.Vector2(Math.cos(a) * ri, Math.sin(a) * ri));
  }
  const shape = new THREE.Shape(pts.concat(inner.reverse()));
  return shape;
}
export function makeColumn(C = MZ.cols) {
  const parts = [];
  const add = (g, m) => { if (m) g.applyMatrix4(m); parts.push(g); };
  const rb = C.rBot, rt = C.rTop, H = C.h, bH = C.baseH, cH = C.capH, sH = H - bH - cH;
  // base: plinth + Asiatic spira
  add(box(2.5 * rb, 0.1, 2.5 * rb), mat(0, 0.05, 0));
  const rr = rb / 0.525;
  add(lathe([[0.64 * rr, 0.1], [0.67 * rr, 0.14], [0.65 * rr, 0.18], [0.59 * rr, 0.21], [0.555 * rr, 0.26], [0.59 * rr, 0.31], [0.65 * rr, 0.34], [0.68 * rr, 0.38], [0.65 * rr, 0.42], [0.60 * rr, 0.45], [0.56 * rr, 0.48], [rb, bH]], 40));
  // shaft: 24 flutes, 7 samples per flute, entasis, apophyge at both ends
  const flutes = 24, pf = 7, fw = 0.17, depth = 0.055, rings = 9;
  add(tubeY(rings, flutes * pf, (i, j, t) => {
    const f = Math.floor(j / pf), k = j % pf;
    const u = k === 0 ? 0 : (k === 1 ? fw : fw + (1 - fw) * (k - 1) / 6);
    const a = (f + u) / flutes * TAU;
    let R = lerp(rb, rt, t) + 0.012 * Math.sin(Math.PI * t);
    R += 0.03 * Math.exp(-t * sH / 0.1) + 0.022 * Math.exp(-(1 - t) * sH / 0.1);
    let r = R;
    if (k >= 1) { const s = (u - fw) / (1 - fw); r = R - depth * R * Math.sin(Math.PI * s); }
    return [Math.cos(a) * r, bH + t * sH, -Math.sin(a) * r];
  }, TAU * (rb + rt) / 2, sH));
  // shaft top astragal
  add(new THREE.TorusGeometry(rt + 0.005, 0.028, 8, 40), mat(0, bH + sH + 0.03, 0, Math.PI / 2, 0, 0));
  // ---- capital (local y from 0 at shaft top) ----
  const cap = [];
  const cadd = (g, m) => { if (m) g.applyMatrix4(m); cap.push(g); };
  const L = 2.3 * rt, rollR = 0.55 * rt, rollX = 0.95 * rt, echTop = 0.30 * (cH / 0.9);
  const cy = echTop + rollR;
  // rolls (bolsters) along Z
  const rollPts = []; const nR = 12;
  for (let i = 0; i <= nR; i++) { const z = -L / 2 + (i / nR) * L; const q = Math.abs(z) / (L / 2); rollPts.push([rollR * (0.84 + 0.16 * q * q) * (i === 0 || i === nR ? 0.97 : 1), z]); }
  rollPts.unshift([0.02, -L / 2]); rollPts.push([0.02, L / 2]);
  for (const sx of [-1, 1]) cadd(lathe(rollPts, 28), mat(sx * rollX, cy, 0, Math.PI / 2, 0, 0));
  // balteus (belt) in the middle of each bolster
  for (const sx of [-1, 1]) cadd(new THREE.TorusGeometry(rollR * 0.86, 0.02, 6, 24), mat(sx * rollX, cy, 0));
  // volute spirals on both faces
  const cw = new THREE.ExtrudeGeometry(spiralShape(rollR * 0.98, 2.7, rollR * 0.16, false), { depth: 0.02, bevelEnabled: false, curveSegments: 4 });
  const ccw = new THREE.ExtrudeGeometry(spiralShape(rollR * 0.98, 2.7, rollR * 0.16, true), { depth: 0.02, bevelEnabled: false, curveSegments: 4 });
  cadd(cw.clone(), mat(rollX, cy, L / 2));                    // front right (seen from +Z)
  cadd(ccw.clone(), mat(-rollX, cy, L / 2));                  // front left
  cadd(cw.clone(), mat(-rollX, cy, -L / 2, 0, Math.PI, 0));   // back (rotated 180°)
  cadd(ccw.clone(), mat(rollX, cy, -L / 2, 0, Math.PI, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) cadd(new THREE.SphereGeometry(rollR * 0.1, 10, 8), mat(sx * rollX, cy, sz * (L / 2 + 0.01)));
  // canalis + core cushion + abacus
  for (const sz of [-1, 1]) cadd(box(rollX * 2, rollR * 0.55, 0.08), mat(0, cy + rollR * 0.7, sz * (L / 2 - 0.04)));
  cadd(box(rollX * 2, rollR * 1.9, L - 0.1), mat(0, cy, 0));
  const abY = cy + rollR;
  cadd(box(rollX * 2 + rollR * 1.2, 0.05, L - 0.02), mat(0, abY + 0.025, 0));
  cadd(box(rollX * 2 + rollR * 1.5, 0.05, L + 0.08), mat(0, abY + 0.075, 0));
  cadd(box(rollX * 2 + rollR * 1.6, cH - (abY + 0.1), L + 0.12), mat(0, (abY + 0.1 + cH) / 2, 0));
  for (const g of cap) add(g, mat(0, bH + sH, 0));
  // echinus (egg-and-dart) → separate geometry so it can use its own material
  const echinus = lathe([[rt - 0.01, 0.05], [rt + 0.02, 0.1], [rt + 0.08, 0.18], [rt + 0.11, 0.26], [rt + 0.1, echTop]], 40);
  tx(echinus, 0, bH + sH, 0);
  const b = new Bucket(); for (const g of parts) b.add(g);
  return { marble: b.build(), echinus };
}

// positions around a rectangle (half-width hw, half-depth hd), spacing along each side, calls fn(x, z, sideIndex, t)
function ring(hw, hd, spacing, fn) {
  const sides = [
    { len: 2 * hd, at: t => [hw, -hd + t * 2 * hd] },      // east, north→south
    { len: 2 * hw, at: t => [hw - t * 2 * hw, hd] },       // south, east→west
    { len: 2 * hd, at: t => [-hw, hd - t * 2 * hd] },      // west
    { len: 2 * hw, at: t => [-hw + t * 2 * hw, -hd] },     // north
  ];
  sides.forEach((s, si) => {
    const n = Math.max(1, Math.round(s.len / spacing));
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; const [x, z] = s.at(t); fn(x, z, si, t, i, n); }
  });
}
const OUT_YAW = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];      // figure (faces +Z) → facing outward per side
const ALONG_YAW = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];    // animal (faces +X) → walking along the side (E: north, S: east, W: south, N: west)

export function buildMausoleum(M) {
  const G = new THREE.Group();
  const B = { marble: new Bucket(), grey: new Bucket(), statue: new Bucket(), bronze: new Bucket(), coffer: new Bucket(), friezeR: new Bucket(), friezeB: new Bucket(), egg: new Bucket(), palm: new Bucket(), gold: new Bucket(), meander: new Bucket() };
  const K = MZ.krepis;

  // ---- krepis (3 steps, blue-grey marble) ----
  for (let i = 0; i < K.steps; i++) {
    const w = MZ.W + 2 * K.tread * (K.steps - i), d = MZ.D + 2 * K.tread * (K.steps - i), y0 = i * K.rise;
    B.grey.add(rectSweep(w, d, [{ o: 0, y: y0 }, { o: 0, y: y0 + K.rise }], { top: true }));
  }

  // ---- podium tiers ----
  for (const T of MZ.tiers) {
    const { y0, y1, w, d } = T;
    const base = [{ o: 0.40, y: y0 }, { o: 0.40, y: y0 + 0.15, hard: true }, { o: 0.30, y: y0 + 0.25 }, { o: 0.12, y: y0 + 0.40 }, { o: 0, y: y0 + 0.50, hard: true }];
    if (T.frieze) {
      const yFT = y1 - 0.66, yFB = yFT - T.friezeH;
      B.marble.add(rectSweep(w, d, [...base, { o: 0, y: yFB - 0.16, hard: true }, { o: 0.08, y: yFB - 0.07 }, { o: 0.08, y: yFB, hard: true }]));
      (T.frieze === 'red' ? B.friezeR : B.friezeB).add(rectSweep(w, d, [{ o: 0.06, y: yFB }, { o: 0.06, y: yFT }]));
      B.marble.add(rectSweep(w, d, [{ o: 0.10, y: yFT }, { o: 0.10, y: yFT + 0.06, hard: true }, { o: 0.22, y: yFT + 0.14 }, { o: 0.30, y: yFT + 0.24, hard: true },
        { o: 0.62, y: yFT + 0.24, hard: true }, { o: 0.62, y: yFT + 0.52, hard: true }, { o: 0.70, y: yFT + 0.62 }, { o: 0.72, y: yFT + 0.66, hard: true }], { top: true }));
    } else {
      B.marble.add(rectSweep(w, d, [...base, { o: 0, y: y1 - 0.6, hard: true }, { o: 0.15, y: y1 - 0.45 }, { o: 0.35, y: y1 - 0.25, hard: true }, { o: 0.55, y: y1 - 0.25, hard: true }, { o: 0.55, y: y1 - 0.05 }, { o: 0.6, y: y1 }], { top: true }));
    }
  }

  // ---- stylobate + core ----
  const S = MZ.stylobate;
  B.marble.add(rectSweep(S.w, S.d, [{ o: 0, y: S.y }, { o: 0, y: S.y + S.h }], { top: true }));
  const C = MZ.core, coreH = MZ.colTopY - MZ.colBaseY;
  B.marble.add(box(C.w, coreH, C.d), mat(0, MZ.colBaseY + coreH / 2, 0));
  // east door with marble frame and bronze leaves
  const doorW = 2.6, doorH = 4.8, dx = C.w / 2;
  B.marble.add(box(0.3, doorH + 0.4, 0.5), mat(dx + 0.1, MZ.colBaseY + (doorH + 0.4) / 2, doorW / 2 + 0.25));
  B.marble.add(box(0.3, doorH + 0.4, 0.5), mat(dx + 0.1, MZ.colBaseY + (doorH + 0.4) / 2, -doorW / 2 - 0.25));
  B.marble.add(box(0.45, 0.5, doorW + 1.4), mat(dx + 0.15, MZ.colBaseY + doorH + 0.55, 0));
  B.marble.add(box(0.6, 0.25, doorW + 1.8), mat(dx + 0.2, MZ.colBaseY + doorH + 0.9, 0));
  B.bronze.add(box(0.12, doorH, doorW), mat(dx - 0.05, MZ.colBaseY + doorH / 2, 0));
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) B.gold.add(new THREE.SphereGeometry(0.06, 8, 6), mat(dx + 0.02, MZ.colBaseY + 0.5 + r * 0.78, -doorW / 2 + 0.33 + c * 0.65));
  B.bronze.add(box(0.06, doorH - 0.2, 0.08), mat(dx + 0.03, MZ.colBaseY + doorH / 2, 0));

  // ---- columns ----
  const col = makeColumn();
  const CL = MZ.cols, hx = CL.ax / 2, hz = CL.az / 2;
  const colPositions = [];
  for (let i = 0; i < CL.nx; i++) for (let j = 0; j < CL.nz; j++) {
    if (i > 0 && i < CL.nx - 1 && j > 0 && j < CL.nz - 1) continue;
    const x = -hx + i * (CL.ax / (CL.nx - 1)), z = -hz + j * (CL.az / (CL.nz - 1));
    const onEW = (i === 0 || i === CL.nx - 1) && !(j === 0 || j === CL.nz - 1);
    const ry = onEW ? Math.PI / 2 : 0;
    colPositions.push([x, z]);
    B.marble.add(col.marble, mat(x, MZ.colBaseY, z, 0, ry, 0));
    B.egg.add(col.echinus, mat(x, MZ.colBaseY, z, 0, ry, 0));
  }

  // ---- entablature ----
  const E = [
    { o: 0.42, y: 0 }, { o: 0.42, y: 0.26, hard: true }, { o: 0.47, y: 0.26, hard: true }, { o: 0.47, y: 0.54, hard: true }, { o: 0.52, y: 0.54, hard: true }, { o: 0.52, y: 0.84, hard: true },
    { o: 0.60, y: 0.92 }, { o: 0.62, y: 0.96, hard: true },
    { o: 0.55, y: 0.96, hard: true }, { o: 0.55, y: 1.50, hard: true },
    { o: 0.62, y: 1.56 }, { o: 0.64, y: 1.60, hard: true },
    { o: 0.56, y: 1.60, hard: true }, { o: 0.56, y: 1.90, hard: true },
    { o: 0.84, y: 1.90, hard: true }, { o: 0.84, y: 1.96, hard: true },
    { o: 1.02, y: 1.96, hard: true }, { o: 1.02, y: 2.24, hard: true },
    { o: 1.06, y: 2.30 }, { o: 1.14, y: 2.42 }, { o: 1.20, y: 2.52 }, { o: 1.22, y: 2.60, hard: true },
  ].map(p => ({ ...p, y: p.y + MZ.colTopY }));
  // frieze band is painted with a meander; carve it out of the marble profile
  B.marble.add(rectSweep(CL.ax, CL.az, E.slice(0, 8)));
  B.meander.add(rectSweep(CL.ax, CL.az, [{ o: 0.56, y: MZ.colTopY + 0.96 }, { o: 0.56, y: MZ.colTopY + 1.50 }]));
  B.marble.add(rectSweep(CL.ax, CL.az, E.slice(9), { top: true }));
  // architrave soffit ring + coffered ceiling between core and architrave
  const soffitIn = 0.42, soffitOut = 0.41;
  for (const [w, d, x, z] of [[CL.ax + 2 * soffitOut, soffitIn + soffitOut, 0, hz], [CL.ax + 2 * soffitOut, soffitIn + soffitOut, 0, -hz], [soffitIn + soffitOut, CL.az, hx, 0], [soffitIn + soffitOut, CL.az, -hx, 0]]) {
    B.marble.add(box(w, 0.05, d), mat(x, MZ.colTopY - 0.025, z));
  }
  const cy = MZ.colTopY - 0.02;
  const ceil = (w, d, x, z) => { const p = scaleUV(new THREE.PlaneGeometry(w, d), w, d); p.rotateX(Math.PI / 2); B.coffer.add(p, mat(x, cy, z)); };
  const ix = hx - soffitIn, iz = hz - soffitIn, cw = C.w / 2, cd = C.d / 2;
  ceil(2 * ix, iz - cd, 0, (iz + cd) / 2); ceil(2 * ix, iz - cd, 0, -(iz + cd) / 2);
  ceil(ix - cw, 2 * cd, (ix + cw) / 2, 0); ceil(ix - cw, 2 * cd, -(ix + cw) / 2, 0);
  // dentils
  const dent = box(0.16, 0.30, 0.22);
  ring(hx + 0.67, hz + 0.67, 0.30, (x, z, si) => B.marble.add(dent, mat(x, MZ.colTopY + 1.75, z, 0, si % 2 ? 0 : Math.PI / 2, 0)));
  // antefixes (palmettes) along the sima
  const palm = new THREE.PlaneGeometry(0.42, 0.48);
  ring(hx + 1.20, hz + 1.20, 0.68, (x, z, si) => B.palm.add(palm, mat(x, MZ.entabTop + 0.22, z, 0, [Math.PI / 2, 0, -Math.PI / 2, Math.PI][si], 0)));

  // ---- pyramid roof: 24 steps ----
  const P = MZ.pyramid, txs = (P.w0 - P.topW) / (2 * P.steps), tzs = (P.d0 - P.topD) / (2 * P.steps);
  for (let k = 0; k < P.steps; k++) {
    const w = P.w0 - 2 * k * txs, d = P.d0 - 2 * k * tzs;
    B.marble.add(box(w, P.rise, d), mat(0, MZ.entabTop + P.rise * (k + 0.5), 0));
  }
  // plinth + quadriga
  B.marble.add(rectSweep(7, 4.8, [{ o: 0.3, y: 0 }, { o: 0.3, y: 0.15, hard: true }, { o: 0.1, y: 0.35 }, { o: 0, y: 0.45, hard: true }, { o: 0, y: 0.8, hard: true }, { o: 0.15, y: 0.92 }, { o: 0.3, y: 1.0, hard: true }], { top: true }), mat(0, MZ.pyramidTop, 0));
  const Q = quadrigaGeometries({ scale: 1.45 });
  B.statue.add(Q.marble, mat(0.5, MZ.plinthTop, 0));
  if (Q.bronze) B.bronze.add(Q.bronze, mat(0.5, MZ.plinthTop, 0));

  // ---- sculpture programme ----
  const R = rng(42);
  const variants = {
    warrior: [1, 2, 3, 4, 5, 6].map(s => figureGeometry({ seed: s, draped: R() < 0.5 ? 'short' : 'none', spear: R() < 0.7, shield: R() < 0.5 })),
    drapedM: [11, 12, 13].map(s => figureGeometry({ seed: s, draped: 'full', pose: 'restDown' })),
    drapedF: [21, 22, 23].map(s => figureGeometry({ seed: s, draped: 'full', female: true, pose: 'restDown' })),
  };
  const pick = arr => arr[Math.floor(R() * arr.length)];
  const plinth = s => box(0.95 * s, 0.14 * s, 0.7 * s);
  const placeFigure = (g, s, x, y, z, ry) => {
    B.marble.add(plinth(s), mat(x, y + 0.07 * s, z, 0, ry, 0));
    B.statue.add(g, mat(x, y + 0.14 * s, z, 0, ry, 0, s));
  };
  // tier 1 ledge: life-size hunt / battle groups (with a few horses)
  const t0 = MZ.tiers[0], t1 = MZ.tiers[1], t2 = MZ.tiers[2];
  const horseLife = horseGeometry({ scale: 0.72, raisedLeg: true });
  ring(t1.w / 2 + 0.4 + 0.55, t1.d / 2 + 0.4 + 0.55, 2.7, (x, z, si) => {
    const yaw = OUT_YAW[si] + (R() - 0.5) * 0.6;
    if (R() < 0.15) { B.marble.add(box(2.1, 0.14, 0.8), mat(x, t0.y1 + 0.07, z, 0, ALONG_YAW[si], 0)); B.statue.add(horseLife, mat(x, t0.y1 + 0.14, z, 0, ALONG_YAW[si] + (R() - 0.5) * 0.3, 0)); }
    else placeFigure(R() < 0.75 ? pick(variants.warrior) : pick(variants.drapedM), 1.0, x, t0.y1, z, yaw);
  });
  // tier 2 ledge: heroic scale
  ring(t2.w / 2 + 0.4 + 0.5, t2.d / 2 + 0.4 + 0.5, 3.3, (x, z, si) => {
    const r = R();
    placeFigure(r < 0.5 ? pick(variants.warrior) : (r < 0.8 ? pick(variants.drapedM) : pick(variants.drapedF)), 1.35, x, t1.y1, z, OUT_YAW[si] + (R() - 0.5) * 0.5);
  });
  // colossal dynastic portraits between the columns (36)
  for (let i = 0; i < CL.nx - 1; i++) for (const sz of [-1, 1]) {
    const x = -hx + (i + 0.5) * (CL.ax / (CL.nx - 1)), z = sz * hz;
    placeFigure(i % 2 ? pick(variants.drapedF) : pick(variants.drapedM), 1.65, x, MZ.colBaseY, z, sz > 0 ? 0 : Math.PI);
  }
  for (let j = 0; j < CL.nz - 1; j++) for (const sx of [-1, 1]) {
    const z = -hz + (j + 0.5) * (CL.az / (CL.nz - 1)), x = sx * hx;
    placeFigure(j % 2 ? pick(variants.drapedM) : pick(variants.drapedF), 1.65, x, MZ.colBaseY, z, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
  }
  // lions on the first step of the roof
  const lion = lionGeometry({ scale: 1.1 });
  const lx = P.w0 / 2 - 0.27, lz = P.d0 / 2 - 0.27;
  ring(lx, lz, 2.0, (x, z, si) => B.statue.add(lion, mat(x, MZ.entabTop + P.rise, z, 0, ALONG_YAW[si], 0)));

  // ---- assemble ----
  const meshes = [
    [B.marble, M.marble], [B.grey, M.marbleGrey], [B.statue, M.marbleStatue], [B.bronze, M.bronze], [B.gold, M.gold],
    [B.coffer, M.coffer], [B.friezeR, M.friezeRed], [B.friezeB, M.friezeBlue], [B.egg, M.eggDart], [B.meander, M.meander], [B.palm, M.palmette],
  ];
  for (const [b, m] of meshes) { const mesh = b.mesh(m); if (mesh) { mesh.name = 'mausoleum'; G.add(mesh); } }
  G.userData.colPositions = colPositions;
  return G;
}
