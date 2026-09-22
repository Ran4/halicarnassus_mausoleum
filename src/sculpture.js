// Procedural marble sculpture: standing figures, draped figures, lions, horses, the quadriga.
// Figures face +Z (feet at y=0). Animals face +X.
import * as THREE from 'three';
import { Bucket, bone, ellipsoid, capsule, box, lathe, tubeY, tx, mat, rng, lerp, TAU, normalizeGeom } from './util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function merge(list) { return mergeGeometries(list.map(normalizeGeom), false); }
const V = (x, y, z) => [x, y, z];

// Cone-ish tube with vertical drapery folds. rings: [{y, r, sz?}] bottom→top.
export function foldedTube(rings, { folds = 14, depth = 0.07, seed = 1, segs = 48, ovalZ = 0.85, twist = 0 } = {}) {
  const R = rng(seed);
  const ph = R() * TAU, ph2 = R() * TAU, ph3 = R() * TAU;
  const amp2 = 0.4 + R() * 0.4;
  const n = rings.length;
  // resample rings along t with linear interpolation
  const yAt = t => { const k = t * (n - 1), i = Math.min(n - 2, Math.floor(k)), f = k - i; return lerp(rings[i].y, rings[i + 1].y, f); };
  const rAt = t => { const k = t * (n - 1), i = Math.min(n - 2, Math.floor(k)), f = k - i; return lerp(rings[i].r, rings[i + 1].r, f); };
  const rows = 14;
  return tubeY(rows, segs, (i, j, t, a) => {
    const y = yAt(t), r0 = rAt(t);
    const dep = depth * (0.35 + 0.65 * (1 - t));           // folds deepen toward the hem
    const f = Math.sin(folds * a + ph + twist * t) + amp2 * Math.sin(3 * a + ph2 + t * 2) + 0.3 * Math.sin(7 * a + ph3 - t * 3);
    const r = r0 * (1 + dep * f);
    return [Math.cos(a) * r, y, -Math.sin(a) * r * ovalZ];
  }, 2, 1);
}

// ---------- human figure ----------
export function figureGeometry({ scale = 1, seed = 1, draped = 'none', female = false, spear = false, shield = false, pose = 'stand' } = {}) {
  const R = rng(seed);
  const parts = [];
  const s = scale;
  const add = (g, m) => { if (m) g.applyMatrix4(m); parts.push(g); };
  // landmarks (1.8 m figure)
  const hipY = 0.93, kneeY = 0.5, ankleY = 0.08, shY = 1.47, headY = 1.665;
  const hipW = female ? 0.15 : 0.13, shW = female ? 0.18 : 0.21;
  const yaw = (R() - 0.5) * 0.5;
  const side = R() < 0.5 ? 1 : -1;            // which leg is free
  // legs
  if (draped !== 'full') {
    for (const L of [-1, 1]) {
      const free = L === side;
      const hip = V(L * hipW * 0.75, hipY, 0);
      const knee = free ? V(L * hipW * 0.9 + (R() - 0.5) * 0.04, kneeY + 0.02, 0.13 + R() * 0.08) : V(L * hipW * 0.75, kneeY, 0.01);
      const ankle = free ? V(knee[0] + L * 0.03, ankleY, knee[2] + 0.1) : V(hip[0], ankleY, 0);
      add(bone(hip, knee, 0.078)); add(bone(knee, ankle, 0.06));
      add(ellipsoid(0.07, 0.11, 0.08), mat(knee[0], knee[1], knee[2]));
      const foot = box(0.1, 0.06, 0.27); add(foot, mat(ankle[0], 0.03, ankle[2] + 0.06));
    }
  }
  const full = draped === 'full';
  // pelvis, torso (hidden inside the drapery for fully draped figures, kept for the shoulders)
  if (!full) {
    add(ellipsoid(hipW + 0.05, 0.13, 0.12), mat(0, hipY + 0.02, 0));
    add(ellipsoid(0.17, 0.22, 0.115), mat(0, 1.18, 0, 0, 0, side * 0.03));
    if (female) { add(ellipsoid(0.075, 0.07, 0.07), mat(-0.085, 1.3, 0.07)); add(ellipsoid(0.075, 0.07, 0.07), mat(0.085, 1.3, 0.07)); }
  }
  add(ellipsoid(shW, 0.105, 0.125), mat(0, shY - 0.02, 0, 0, 0, -side * 0.04));
  // neck + head
  add(capsule(0.05, 0.1), mat(0, shY + 0.05, 0));
  add(ellipsoid(0.082, 0.105, 0.092), mat(0, headY - 0.02, 0.01, 0, yaw, 0));
  add(ellipsoid(0.092, 0.095, 0.1), mat(0, headY + 0.01, -0.015, 0, yaw, 0));  // hair cap
  if (female) add(ellipsoid(0.05, 0.05, 0.05), mat(0, headY - 0.02, -0.1, 0, yaw, 0));
  add(tx(new THREE.ConeGeometry(0.016, 0.045, 6), 0, headY - 0.03, 0.095, Math.PI / 2 - 0.2, 0, 0)); // nose
  // arms
  const armPose = pose === 'stand' ? (R() < 0.5 ? 'spearUp' : 'restDown') : pose;
  const sh = L => V(L * shW, shY - 0.01, 0);
  const rightUp = !full && (armPose === 'spearUp' || spear);
  for (const L of [-1, 1]) {
    const S = sh(L);
    let elbow, wrist;
    if (full) {
      if (L === 1) { elbow = V(shW + 0.04, 1.2, 0.1); wrist = V(0.06, 1.24, 0.19); }           // right arm across the chest, holding the mantle
      else { elbow = V(-shW - 0.02, 1.2, 0.02); wrist = V(-shW, 0.97, 0.07); }                     // left arm hanging in the folds
    }
    else if (L === 1 && rightUp) { elbow = V(0.30, 1.30, 0.06); wrist = V(0.30, 1.60, 0.08); }
    else if (L === -1 && shield) { elbow = V(-0.28, 1.22, 0.12); wrist = V(-0.1, 1.2, 0.36); }
    else { const f = 0.08 + R() * 0.1; elbow = V(L * (shW + 0.05), 1.2, f); wrist = V(L * (shW + 0.06), 0.93, f + 0.1); }
    const ar = full ? 0.066 : 0.058, fr = full ? 0.055 : 0.048;
    add(bone(S, elbow, ar)); add(bone(elbow, wrist, fr)); add(ellipsoid(0.05, 0.065, 0.045), mat(wrist[0], wrist[1] - 0.05, wrist[2]));
    if (L === 1 && rightUp) add(tx(new THREE.CylinderGeometry(0.014, 0.014, 2.4, 6), wrist[0] + 0.02, wrist[1] + 0.35, wrist[2] + 0.01));
    if (L === -1 && shield) add(tx(new THREE.SphereGeometry(0.42, 16, 6, 0, TAU, 0, 0.6), wrist[0] - 0.05, wrist[1] + 0.05, wrist[2] + 0.02, Math.PI / 2 + 0.15, 0, 0));
  }
  // drapery
  if (full) {
    // chiton + himation hanging from the shoulders, deep vertical folds, a fold-roll across the chest
    const rings = [{ y: 0.03, r: 0.31 }, { y: 0.45, r: 0.27 }, { y: 0.9, r: hipW + 0.08 }, { y: 1.15, r: 0.195 }, { y: 1.36, r: shW + 0.03 }, { y: 1.47, r: shW - 0.01 }, { y: 1.52, r: 0.1 }];
    add(foldedTube(rings, { folds: female ? 16 : 12, depth: 0.075, seed: seed + 3, ovalZ: 0.78 }));
    add(tx(ellipsoid(0.23, 0.055, 0.14), -0.02, 1.26, 0.09, 0, 0, 0.7));
    add(tx(ellipsoid(0.1, 0.12, 0.11), -0.19, 1.44, 0.0));
  } else if (draped === 'short') {
    const rings = [{ y: 0.55, r: 0.24 }, { y: 0.75, r: 0.21 }, { y: 0.98, r: hipW + 0.07 }, { y: 1.35, r: shW }];
    add(foldedTube(rings, { folds: 12, depth: 0.06, seed: seed + 5, ovalZ: 0.85 }));
  }
  const g = merge(parts);
  g.scale(s, s, s);
  return g;
}

// ---------- lion (walking, faces +X) ----------
export function lionGeometry({ scale = 1, seed = 1, stride = 0.2 } = {}) {
  const parts = [];
  const add = (g, m) => { if (m) g.applyMatrix4(m); parts.push(g); };
  add(ellipsoid(0.62, 0.30, 0.26), mat(0, 0.62, 0));
  add(ellipsoid(0.34, 0.33, 0.30), mat(0.45, 0.67, 0));
  add(ellipsoid(0.30, 0.30, 0.26), mat(-0.48, 0.60, 0));
  add(ellipsoid(0.31, 0.35, 0.32), mat(0.72, 0.85, 0));      // mane
  add(ellipsoid(0.20, 0.19, 0.17), mat(0.95, 0.9, 0));        // head
  add(ellipsoid(0.15, 0.10, 0.11), mat(1.11, 0.84, 0));       // muzzle
  add(ellipsoid(0.05, 0.05, 0.04), mat(0.92, 1.07, 0.1)); add(ellipsoid(0.05, 0.05, 0.04), mat(0.92, 1.07, -0.1));
  for (const L of [-1, 1]) {
    const fx = L === 1 ? stride : -stride * 0.5;
    add(bone(V(0.5, 0.55, L * 0.17), V(0.55 + fx, 0.28, L * 0.18), 0.08)); add(bone(V(0.55 + fx, 0.28, L * 0.18), V(0.58 + fx, 0.06, L * 0.18), 0.07));
    add(ellipsoid(0.12, 0.05, 0.09), mat(0.64 + fx, 0.04, L * 0.18));
    const bx = L === 1 ? -stride * 0.5 : stride;
    add(bone(V(-0.45, 0.5, L * 0.16), V(-0.62 + bx, 0.26, L * 0.17), 0.08)); add(bone(V(-0.62 + bx, 0.26, L * 0.17), V(-0.52 + bx, 0.06, L * 0.17), 0.065));
    add(ellipsoid(0.12, 0.05, 0.09), mat(-0.45 + bx, 0.04, L * 0.17));
  }
  add(bone(V(-0.72, 0.62, 0), V(-1.02, 0.38, 0.05), 0.045)); add(bone(V(-1.02, 0.38, 0.05), V(-1.2, 0.3, 0.02), 0.035)); add(ellipsoid(0.07, 0.06, 0.06), mat(-1.24, 0.29, 0.02));
  const g = merge(parts); g.scale(scale, scale, scale); return g;
}

// ---------- horse (faces +X, withers ≈ 1.6·scale) ----------
export function horseGeometry({ scale = 1, seed = 1, raisedLeg = true, headDown = 0.55 } = {}) {
  const parts = [];
  const add = (g, m) => { if (m) g.applyMatrix4(m); parts.push(g); };
  add(ellipsoid(0.82, 0.36, 0.29), mat(0, 1.22, 0));
  add(ellipsoid(0.36, 0.40, 0.30), mat(0.58, 1.24, 0));
  add(ellipsoid(0.36, 0.37, 0.31), mat(-0.58, 1.27, 0));
  // neck (tapered)
  const neckA = V(0.78, 1.42, 0), neckB = V(1.32, 2.0, 0);
  add(bone(neckA, neckB, 0.2)); add(bone(V(0.95, 1.6, 0), V(1.36, 2.02, 0), 0.15));
  // head, angled down
  const hm = mat(1.5, 2.0, 0, 0, 0, -headDown);
  add(ellipsoid(0.30, 0.16, 0.12), hm.clone().multiply(mat(0.12, 0, 0)));
  add(ellipsoid(0.13, 0.11, 0.09), hm.clone().multiply(mat(0.4, -0.04, 0)));
  add(tx(new THREE.ConeGeometry(0.04, 0.16, 6), 0, 0.2, 0.07).applyMatrix4(hm.clone().multiply(mat(-0.05, 0.02, 0))));
  add(tx(new THREE.ConeGeometry(0.04, 0.16, 6), 0, 0.2, -0.07).applyMatrix4(hm.clone().multiply(mat(-0.05, 0.02, 0))));
  // mane: ridge along the neck
  add(ellipsoid(0.42, 0.08, 0.035), mat(1.05, 1.86, 0, 0, 0, 0.8));
  // legs
  for (const L of [-1, 1]) {
    const z = L * 0.18;
    if (raisedLeg && L === 1) {
      add(bone(V(0.6, 1.05, z), V(0.9, 0.72, z), 0.075)); add(bone(V(0.9, 0.72, z), V(0.78, 0.4, z), 0.055)); add(ellipsoid(0.07, 0.06, 0.06), mat(0.9, 0.72, z));
      add(tx(new THREE.CylinderGeometry(0.075, 0.07, 0.1, 10), 0.74, 0.36, z, 0, 0, 0.5));
    } else {
      add(bone(V(0.6, 1.05, z), V(0.63, 0.58, z), 0.075)); add(bone(V(0.63, 0.58, z), V(0.64, 0.1, z), 0.055)); add(ellipsoid(0.07, 0.07, 0.06), mat(0.63, 0.58, z));
      add(tx(new THREE.CylinderGeometry(0.08, 0.07, 0.1, 10), 0.65, 0.05, z));
    }
    add(bone(V(-0.58, 1.1, z), V(-0.78, 0.6, z), 0.08)); add(bone(V(-0.78, 0.6, z), V(-0.66, 0.1, z), 0.055)); add(ellipsoid(0.08, 0.08, 0.06), mat(-0.78, 0.6, z));
    add(tx(new THREE.CylinderGeometry(0.08, 0.07, 0.1, 10), -0.65, 0.05, z));
  }
  // tail
  add(bone(V(-0.9, 1.4, 0), V(-1.1, 0.95, 0.03), 0.07)); add(bone(V(-1.1, 0.95, 0.03), V(-1.12, 0.5, 0.0), 0.06));
  const g = merge(parts); g.scale(scale, scale, scale); return g;
}

// ---------- quadriga: 4 horses + chariot + two colossal figures ----------
export function quadrigaGeometries({ scale = 1.45 } = {}) {
  const marble = new Bucket(), bronze = new Bucket();
  const s = scale;
  // horses abreast along z, facing +X
  const spacing = 0.78 * s;
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * spacing;
    marble.add(horseGeometry({ scale: s, seed: i, raisedLeg: i % 2 === 0, headDown: 0.45 + 0.12 * (i % 2) }), mat(0.15 * (i % 2), 0, z));
  }
  // chariot behind: open half-cylinder body
  const cx = -2.35 * s;
  const shell = lathe([[0.62, 0], [0.66, 0.04], [0.66, 0.92], [0.62, 0.98], [0.56, 0.98]], 24, -Math.PI / 2, Math.PI);
  marble.add(shell, mat(cx, 0.55 * s, 0, 0, Math.PI / 2, 0, s));               // half-cylinder closed toward the horses (+X)
  marble.add(box(1.3, 0.08, 1.15), mat(cx - 0.05 * s, 0.55 * s, 0, 0, 0, 0, s));
  // wheels
  for (const L of [-1, 1]) {
    const wz = L * 0.78 * s;
    marble.add(new THREE.TorusGeometry(0.5, 0.06, 10, 28), mat(cx - 0.3 * s, 0.5 * s, wz, 0, 0, 0, s));
    marble.add(new THREE.SphereGeometry(0.1, 12, 8), mat(cx - 0.3 * s, 0.5 * s, wz, 0, 0, 0, s));
    for (let k = 0; k < 8; k++) marble.add(new THREE.CylinderGeometry(0.025, 0.025, 0.46, 6), mat(cx - 0.3 * s, 0.5 * s, wz, 0, 0, 0, s).multiply(mat(0, 0, 0, 0, 0, k * Math.PI / 4).multiply(mat(0, 0.25, 0))));
  }
  marble.add(new THREE.CylinderGeometry(0.05, 0.05, 1.7, 8), mat(cx - 0.3 * s, 0.5 * s, 0, Math.PI / 2, 0, 0, s));      // axle
  // pole + yoke
  marble.add(bone(V(cx + 0.4 * s, 0.5 * s, 0), V(0.55 * s, 1.35 * s, 0), 0.05 * s));
  marble.add(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 8), mat(0.55 * s, 1.38 * s, 0, Math.PI / 2, 0, 0, s));
  // Mausolus and Artemisia standing in the chariot (colossal, ~3 m)
  const fs = 1.0 * s * 1.15;
  const mausolus = figureGeometry({ scale: fs, seed: 101, draped: 'full', female: false, pose: 'restDown' });
  const artemisia = figureGeometry({ scale: fs, seed: 202, draped: 'full', female: true, pose: 'restDown' });
  marble.add(mausolus, mat(cx - 0.1 * s, 0.6 * s, -0.33 * s, 0, Math.PI / 2, 0));   // face +X
  marble.add(artemisia, mat(cx - 0.15 * s, 0.6 * s, 0.33 * s, 0, Math.PI / 2, 0));
  // reins (bronze)
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * spacing;
    bronze.add(bone(V(1.35 * s, 2.0 * s, z), V(cx + 0.35 * s, 1.55 * s, -0.33 * s + 0.05 * i), 0.012 * s));
  }
  return { marble: marble.build(), bronze: bronze.build() };
}
