// Town feature: the market in the agora — stall rows by trade (food, pottery, textiles, crafts, fish, wholesale),
// the civic centre around the monument (bema, bronze honorific statues, sundial, fountain basin, altar, plane trees),
// herms at the entrances, tethered donkeys, and the furniture of the three stoas (counters, racks, benches, pinakes).
import * as THREE from 'three';
import { Bucket, ColorBucket, box, lathe, rectSweep, ellipsoid, mat, rng, lerp, clamp, TAU, scaleUV } from '../util.js';
import { flats } from '../terrain.js';
import { figureGeometry } from '../sculpture.js';

export const name = 'agora';
export function plan(ctx) { }

// ---------- palettes (natural dyes, fired clay, produce) ----------
const UNDYED = [0xe2c9a2, 0xd9bd94, 0xe6d2b0];
const DYES = [0x9c3f2c, 0xb5553a, 0xcf9a34, 0x3a4c72, 0x506690, 0xb48a45, 0x8a6a48, 0x7a3a4a, 0x6f7a4c];
const STRIPES = [[0xe2c9a2, 0x9c3f2c], [0xe0c8a4, 0x3a4c72], [0xcf9a34, 0x9c3f2c], [0xe2c9a2, 0xb48a45], [0xd9bd94, 0x7a3a4a]];
const REED = [0xb89262, 0xa88452, 0xc29c68];
const CLAY = [0xb8704a, 0xc27d52, 0xa9623f, 0xc98f63, 0xcf9f74, 0x9a5236];
const BLACK = 0x2e2824, WICKER = 0xb58b52, WICKER2 = 0x9c7442, ROPE = [0xa8875a, 0x9a7a4e, 0xb89668];
const PRODUCE = [0x5a3a4a, 0x4a2e48, 0x9aa050, 0xb88a5a, 0xe6d2b0, 0x3a3a28, 0x6a6a38, 0xa03028, 0xb84830, 0xc0a040, 0x6a8a40, 0x7a9a50, 0xc9a070, 0x8a5a30, 0x5c7a3a, 0xdcbf94];
const FISH = [0x8a9aa0, 0x9aa6a8, 0xb06050, 0x7d8c96, 0xa8b0a8];
const BRONZES = [0x8a5a30, 0x80542e, 0x946238, 0x7e5028], PATINA = [0x6b5e3c, 0x5f5a3c, 0x66603f];

// Pale, yellowish colours on the plaster-textured clutter materials turn olive in the blue skylight; push them
// towards red and away from blue (the stronger the paler), leaving saturated dyes and reds alone.
const _wc = new THREE.Color(), _wh = {};
function warm(hex, lift = 1) {
  _wc.set(hex); _wc.getHSL(_wh);
  const hue = _wh.h * 360, k = (_wh.s < 0.12 ? 0.8 : clamp((hue - 20) / 8, 0, 1) * clamp((112 - hue) / 12, 0, 1)) * clamp((0.85 - _wh.s) / 0.2, 0, 1);
  return new THREE.Color(_wc.r * (1 + 0.08 * k) * lift, _wc.g * (1 - 0.04 * k) * lift, _wc.b * (1 - 0.18 * k) * lift);
}
// lift > 1 brightens (unclamped): the undersides of thin cloth glow a little with the light coming through
class WarmBucket extends ColorBucket { add(g, m, c = 0xffffff, lift = 1) { return super.add(g, m, warm(c, lift)); } }
class TintBucket extends ColorBucket { constructor(def) { super(); this.def = def; } add(g, m, c) { return super.add(g, m, c ?? this.def()); } }
// lathe without the zero-area triangles that profile points on the axis leave behind
function lth(pts, segs) {
  const g = lathe(pts, segs), p = g.attributes.position, ix = g.index.array, keep = [], a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < ix.length; i += 3) { a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]).sub(a); c.fromBufferAttribute(p, ix[i + 2]).sub(a); if (b.cross(c).lengthSq() > 1e-12) keep.push(ix[i], ix[i + 1], ix[i + 2]); }
  g.setIndex(keep); return g;
}
// the same surface facing the other way (cloth must exist from both sides even in single-sided passes such as GTAO's normal pass)
function flipped(g) {
  const b = g.clone(), ix = b.index.array, n = b.attributes.normal;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return b;
}

// ---------- prefab geometry (built once, cloned into the buckets) ----------
function prefabs() {
  const P = {};
  const m = (list) => { const b = new Bucket(); for (const [g, t] of list) b.add(g, t); return b.build(); };
  const handle = () => new THREE.TorusGeometry(0.075, 0.016, 2, 2, Math.PI);
  // the upper half of an ellipsoid: heaped goods whose underside is hidden in a basket or on a table anyway
  const dome = (rx, ry, rz, ws, hs) => { const g = new THREE.SphereGeometry(1, ws, hs, 0, TAU, 0, Math.PI / 2); g.scale(rx, ry, rz); scaleUV(g, TAU * rx, Math.PI / 2 * ry); return g; };
  const AMPH = [[0.02, 0], [0.17, 0.34], [0.19, 0.5], [0.13, 0.64], [0.055, 0.72], [0.06, 0.89]];
  P.amph = m([[lathe(AMPH, 6)], [handle(), mat(0.1, 0.76, 0, 0, 0, -1.2)], [handle(), mat(-0.1, 0.76, 0, 0, Math.PI, -1.2)]]);
  P.amphPlain = lathe(AMPH, 6);
  // open vessels are closed profiles: outer wall, rim, inner wall down to an inner floor (no hidden bottom disc)
  P.pithos = lth([[0.22, 0.02], [0.47, 0.42], [0.52, 0.8], [0.38, 1.16], [0.34, 1.3], [0.27, 1.27], [0, 1.17]], 9);
  P.jug = lth([[0.07, 0], [0.1, 0.14], [0.045, 0.28], [0.065, 0.34], [0, 0.315]], 6);
  P.krater = lth([[0.1, 0], [0.07, 0.07], [0.2, 0.28], [0.245, 0.42], [0.22, 0.42], [0.17, 0.31], [0, 0.26]], 8);
  P.bowls = [1, 2, 3, 4, 5].map(n => { const h = 0.08 + (n - 1) * 0.035; return lth([[0.05, 0], [0.12, 0.04], [0.13, h], [0.114, h], [0, h - 0.045]], 7); });
  P.hydria = m([[lth([[0.08, 0], [0.15, 0.22], [0.12, 0.34], [0.045, 0.4], [0.07, 0.47], [0, 0.44]], 7)], [new THREE.TorusGeometry(0.08, 0.014, 3, 4, Math.PI), mat(0, 0.25, -0.12, 0, Math.PI / 2, Math.PI / 2)]]);
  P.basket = lth([[0.19, 0], [0.255, 0.19], [0.235, 0.19], [0, 0.15]], 7);
  P.baskets = [1, 2, 3, 4, 5].map(n => { const H = 0.19 + (n - 1) * 0.09; return lth([[0.19, 0], [0.255, H], [0.245, H + 0.012], [0.2, H - 0.02], [0, H - 0.05]], 7); });
  P.lowBasket = lth([[0.24, 0], [0.31, 0.1], [0.29, 0.105], [0, 0.04]], 8);
  P.mound = dome(0.23, 0.12, 0.23, 8, 2);
  P.lowMound = dome(0.29, 0.05, 0.29, 6, 2);
  P.dish = lth([[0.05, 0], [0.12, 0.035], [0.13, 0.06], [0, 0.045]], 7);
  P.ball = new THREE.SphereGeometry(0.06, 5, 3);
  // a fish lying on its side on the slab: flat body, horizontal tail fin
  const fishG = (l, h, w, round) => m([[round ? ellipsoid(l, h, w, 8, 4) : new THREE.OctahedronGeometry(1, 0).scale(l, h, w)], [new THREE.ConeGeometry(w * 1.25, l * 0.42, 3).scale(0.22, 1, 1), mat(-l * 1.1, 0, 0, 0, 0, -Math.PI / 2)]]);
  P.fish = fishG(0.17, 0.022, 0.05); P.bigFish = fishG(0.42, 0.07, 0.12, true);
  P.loaf = dome(0.12, 0.08, 0.12, 6, 2);
  P.ring = new THREE.TorusGeometry(0.1, 0.035, 3, 7).rotateX(Math.PI / 2);
  P.sack = lth([[0, 0], [0.22, 0.02], [0.28, 0.2], [0.26, 0.44], [0.12, 0.6], [0.09, 0.69], [0, 0.71]], 7);
  P.openSack = lth([[0.22, 0.02], [0.28, 0.2], [0.27, 0.42], [0.3, 0.47], [0.0, 0.5]], 7);
  P.cheese = lth([[0.13, 0], [0.13, 0.08], [0, 0.08]], 7).translate(0, -0.04, 0);
  P.coil = new THREE.TorusGeometry(0.22, 0.05, 3, 11).rotateX(Math.PI / 2);
  P.wreath = new THREE.TorusGeometry(0.12, 0.03, 2, 8).rotateX(Math.PI / 2);
  P.bolt = new THREE.CylinderGeometry(0.07, 0.07, 0.75, 6, 1).rotateZ(Math.PI / 2);
  P.lamps = m([0, 1, 2].map(j => [new THREE.OctahedronGeometry(1, 0).scale(0.075, 0.025, 0.038), mat((j - 1) * 0.12, 0, (j % 2) * 0.05)]));
  P.cauldron = lth([[0, 0], [0.15, 0.03], [0.24, 0.14], [0.25, 0.25], [0.23, 0.29], [0.21, 0.285], [0.2, 0.2], [0, 0.1]], 9);
  P.phiale = lth([[0, 0], [0.1, 0.012], [0.15, 0.05], [0.138, 0.052], [0, 0.024]], 8);
  P.hen = m([[ellipsoid(0.13, 0.1, 0.09, 5, 3), mat(0, 0.12, 0)], [new THREE.OctahedronGeometry(0.05, 0), mat(0.12, 0.23, 0)], [box(0.1, 0.07, 0.02), mat(-0.12, 0.2, 0, 0, 0, 0.6)]]);
  P.coin = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);
  P.nail = new THREE.PlaneGeometry(0.035, 0.035); P.cord = new THREE.PlaneGeometry(0.68, 0.012);
  P.cagePost = new THREE.CylinderGeometry(0.018, 0.018, 0.46, 3, 1, true); P.cageBar = new THREE.CylinderGeometry(0.009, 0.009, 0.44, 3, 1, true);
  const leg = new THREE.CylinderGeometry(0.018, 0.018, 0.41, 3, 1, true);
  P.stool = m([[box(0.38, 0.04, 0.32), mat(0, 0.42, 0)], ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => [leg, mat(a * 0.15, 0.2, b * 0.12, b * 0.08, 0, -a * 0.08)])]);
  // leather: a pair of sandals, a coiled belt, a rolled hide
  P.sandals = m([...[-1, 1].map(s => [ellipsoid(0.045, 0.012, 0.125, 5, 2), mat(s * 0.055, 0.012, s * 0.02, 0, s * 0.08, 0)]), [box(0.2, 0.012, 0.016), mat(0, 0.026, 0.04)]]);
  P.belt = new THREE.TorusGeometry(0.07, 0.014, 2, 9).rotateX(Math.PI / 2);
  P.hide = new THREE.CylinderGeometry(0.055, 0.055, 0.42, 6).rotateZ(Math.PI / 2);
  return P;
}

// ---------- the plane tree (copied idea from environment.js, taller trunk so the canopy clears the awnings) ----------
function planeTree(R, H) {
  const trunk = new Bucket(), leaves = new Bucket(), ph = R() * TAU;
  const tube = new THREE.CylinderGeometry(0.34, 0.52, H, 10, 6, true); tube.translate(0, H / 2, 0);
  const p = tube.attributes.position; for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getZ(i), p.getX(i)); const k = 1 + 0.1 * Math.sin(4 * a + ph); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
  tube.computeVertexNormals(); trunk.add(tube);
  for (let b = 0; b < 5; b++) { const a = b / 5 * TAU + R(), L = 2.6 + R() * 0.6, g = new THREE.CylinderGeometry(0.03, 0.2, L, 6, 1, true); g.translate(0, L / 2, 0); trunk.add(g, mat(0, H - 0.2, 0, Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9)); }
  const card = new THREE.PlaneGeometry(2.6, 2.6);
  for (let i = 0; i < 42; i++) {
    let px, py, pz; do { px = (R() - 0.5) * 2; py = (R() - 0.5) * 2; pz = (R() - 0.5) * 2; } while (px * px + py * py + pz * pz > 1);
    leaves.add(card, mat(px * 5.2, H + 2.4 + py * 2.6, pz * 5.2, R() * TAU, R() * TAU, R() * TAU));
  }
  return { trunk: trunk.build(), leaves: leaves.build() };
}

// ---------- the pinakes: painted wooden panels, one canvas atlas (4 × 2 cells) ----------
function pinakesMaterial(ctx) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, envMapIntensity: 0.3 });
  if (typeof document === 'undefined') { m.color.set(0xa0785a); return ctx.setupMaterial(m); }
  const W = 1024, H = 384, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), R = rng(4321);
  const grounds = ['#d9b98a', '#9a3a2a', '#e3d2ae', '#2f4468', '#c98f5a', '#1f1a17', '#dcc49a', '#8a3a2a'];
  const dark = c => c === '#9a3a2a' || c === '#2f4468' || c === '#1f1a17' || c === '#8a3a2a';
  const P = (pts, fill = true) => { g.beginPath(); g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); if (fill) { g.closePath(); g.fill(); } else g.stroke(); };
  const line = (x0, y0, x1, y1, w) => { g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
  // a figure in profile facing right, black-figure style: head, beard, mantle with a fold line, stepping legs, one arm forward
  const figure = (x, fy, ink, hi, staff, h = 1) => {
    g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = 'round';
    g.beginPath(); g.arc(x + 1, fy - 100 * h, 7.5 * h, 0, TAU); g.fill(); P([x + 7 * h, fy - 101 * h, x + 12 * h, fy - 98 * h, x + 7 * h, fy - 95 * h]);
    P([x - 8 * h, fy - 90 * h, x + 8 * h, fy - 90 * h, x + 13 * h, fy - 34 * h, x - 13 * h, fy - 30 * h]);
    line(x - 5 * h, fy - 32 * h, x - 9 * h, fy - 2, 4 * h); line(x + 5 * h, fy - 33 * h, x + 13 * h, fy - 2, 4 * h);
    line(x + 6 * h, fy - 86 * h, x + 20 * h, fy - 66 * h, 3.5 * h);
    if (staff) line(x + 21 * h, fy - 118 * h, x + 21 * h, fy - 2, 2.5);
    g.strokeStyle = hi; line(x - 9 * h, fy - 82 * h, x + 10 * h, fy - 46 * h, 2);
  };
  const horse = (x, fy, ink, hi, rider = true) => {
    g.fillStyle = ink; g.strokeStyle = ink; g.lineCap = 'round';
    g.beginPath(); g.ellipse(x, fy - 46, 30, 12, 0, 0, TAU); g.fill();
    P([x + 18, fy - 54, x + 28, fy - 58, x + 44, fy - 84, x + 34, fy - 88]);
    g.beginPath(); g.ellipse(x + 46, fy - 80, 12, 5.5, 0.55, 0, TAU); g.fill();
    P([x + 36, fy - 88, x + 38, fy - 97, x + 41, fy - 88]);
    for (const [lx, dx] of [[-24, -6], [-16, 4], [16, 8], [24, -2]]) { line(x + lx, fy - 40, x + lx + dx * 0.5, fy - 20, 4); line(x + lx + dx * 0.5, fy - 20, x + lx + dx, fy - 1, 3); }
    g.lineWidth = 4; g.beginPath(); g.moveTo(x - 29, fy - 50); g.quadraticCurveTo(x - 42, fy - 40, x - 38, fy - 18); g.stroke();
    if (rider) { g.beginPath(); g.arc(x + 2, fy - 94, 6.5, 0, TAU); g.fill(); line(x, fy - 86, x + 2, fy - 56, 7); line(x + 2, fy - 58, x + 10, fy - 36, 4); line(x + 2, fy - 80, x + 30, fy - 74, 3); }
    g.strokeStyle = hi; line(x - 20, fy - 44, x + 16, fy - 44, 1.5);
  };
  for (let k = 0; k < 8; k++) {
    const x0 = (k % 4) * 256, y0 = Math.floor(k / 4) * 192, bg = grounds[k], d = dark(bg);
    const ink = d ? '#e0c89a' : '#1e1814', hi = d ? '#8a3a2a' : '#b0583a', acc = d ? '#d9a24a' : '#8a3322';
    g.fillStyle = '#4e3220'; g.fillRect(x0, y0, 256, 192);
    g.fillStyle = bg; g.fillRect(x0 + 9, y0 + 9, 238, 174);
    g.fillStyle = acc; g.fillRect(x0 + 14, y0 + 14, 228, 3); g.fillRect(x0 + 14, y0 + 172, 228, 3);
    for (let m = 0; m < 19; m++) { const mx = x0 + 18 + m * 12; g.fillRect(mx, y0 + 20, 8, 2); g.fillRect(mx + 6, y0 + 20, 2, 7); g.fillRect(mx + 2, y0 + 25, 6, 2); }
    const fy = y0 + 160; g.fillStyle = ink; g.fillRect(x0 + 16, fy, 224, 3);
    const scene = k;
    if (scene === 0) { for (let i = 0; i < 4; i++) figure(x0 + 44 + i * 50, fy, ink, hi, i === 0 || i === 3, 1); g.fillStyle = ink; g.beginPath(); g.ellipse(x0 + 214, fy - 20, 16, 10, 0, 0, TAU); g.fill(); }
    else if (scene === 1) { horse(x0 + 76, fy, ink, hi); horse(x0 + 172, fy, ink, hi); }
    else if (scene === 2) {
      g.fillStyle = ink; g.strokeStyle = ink;
      g.beginPath(); g.moveTo(x0 + 30, fy - 46); g.quadraticCurveTo(x0 + 120, fy - 18, x0 + 214, fy - 50); g.lineTo(x0 + 232, fy - 40); g.lineTo(x0 + 206, fy - 30); g.quadraticCurveTo(x0 + 120, fy - 6, x0 + 40, fy - 30); g.closePath(); g.fill();
      for (let i = 0; i < 9; i++) line(x0 + 60 + i * 15, fy - 26, x0 + 50 + i * 15, fy - 2, 2);
      g.fillRect(x0 + 118, fy - 138, 4, 110); g.fillStyle = d ? '#c9b48a' : '#e8dcc0'; g.fillRect(x0 + 84, fy - 132, 72, 60); g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(x0 + 84, fy - 132, 72, 60);
      g.fillStyle = bg; g.beginPath(); g.arc(x0 + 206, fy - 40, 3, 0, TAU); g.fill();
    } else if (scene === 3) {
      g.fillStyle = ink; g.strokeStyle = ink;
      P([x0 + 52, fy - 2, x0 + 52, fy - 56, x0 + 84, fy - 56, x0 + 84, fy - 2], false); g.lineWidth = 4; P([x0 + 48, fy - 56, x0 + 90, fy - 56], false);
      g.beginPath(); g.arc(x0 + 74, fy - 106, 8, 0, TAU); g.fill(); P([x0 + 64, fy - 96, x0 + 82, fy - 96, x0 + 84, fy - 58, x0 + 62, fy - 58]); P([x0 + 64, fy - 62, x0 + 100, fy - 62, x0 + 102, fy - 4, x0 + 90, fy - 4, x0 + 88, fy - 50, x0 + 64, fy - 50]);
      line(x0 + 80, fy - 92, x0 + 98, fy - 124, 3); line(x0 + 98, fy - 136, x0 + 98, fy - 60, 2.5);
      for (let i = 0; i < 3; i++) figure(x0 + 190 - i * 34, fy, ink, hi, false, 0.9);
    } else if (scene === 4) {   // hoplites: crested helmets, round shields, spears
      for (let i = 0; i < 3; i++) {
        const x = x0 + 58 + i * 66; figure(x, fy, ink, hi, false, 1);
        g.fillStyle = ink; g.beginPath(); g.moveTo(x - 6, fy - 106); g.quadraticCurveTo(x + 2, fy - 134, x + 18, fy - 112); g.lineTo(x + 8, fy - 104); g.closePath(); g.fill();
        g.strokeStyle = ink; line(x + 30, fy - 152, x + 16, fy - 2, 2.5);
        g.beginPath(); g.arc(x + 12, fy - 62, 25, 0, TAU); g.fill(); g.strokeStyle = hi; g.lineWidth = 3; g.beginPath(); g.arc(x + 12, fy - 62, 18, 0, TAU); g.stroke();
      }
    } else if (scene === 5) {   // symposium: two drinkers on couches, a krater between them
      for (const cx of [x0 + 66, x0 + 186]) {
        g.fillStyle = ink; g.strokeStyle = ink; g.fillRect(cx - 44, fy - 48, 88, 7); line(cx - 38, fy - 42, cx - 38, fy - 2, 4); line(cx + 38, fy - 42, cx + 38, fy - 2, 4);
        g.beginPath(); g.ellipse(cx + 8, fy - 55, 34, 8, 0, 0, TAU); g.fill();
        P([cx - 32, fy - 50, cx - 16, fy - 52, cx - 8, fy - 88, cx - 24, fy - 90]);
        g.beginPath(); g.arc(cx - 15, fy - 99, 7.5, 0, TAU); g.fill();
        line(cx - 10, fy - 82, cx + 12, fy - 94, 3); g.beginPath(); g.ellipse(cx + 16, fy - 97, 9, 3, 0, 0, TAU); g.fill(); line(cx + 16, fy - 97, cx + 16, fy - 91, 2);
        g.strokeStyle = hi; line(cx - 22, fy - 58, cx + 34, fy - 56, 2);
      }
      g.fillStyle = ink; P([x0 + 120, fy - 2, x0 + 116, fy - 26, x0 + 108, fy - 40, x0 + 144, fy - 40, x0 + 136, fy - 26, x0 + 132, fy - 2]);
    } else if (scene === 6) {   // a chariot: the car on its wheel, the charioteer, a pair of horses
      horse(x0 + 186, fy - 3, ink, hi, false); horse(x0 + 170, fy, ink, hi, false);
      g.strokeStyle = ink; g.lineWidth = 4; g.beginPath(); g.arc(x0 + 84, fy - 24, 22, 0, TAU); g.stroke();
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4; line(x0 + 84 - Math.cos(a) * 20, fy - 24 - Math.sin(a) * 20, x0 + 84 + Math.cos(a) * 20, fy - 24 + Math.sin(a) * 20, 2); }
      g.fillStyle = ink; P([x0 + 62, fy - 42, x0 + 110, fy - 42, x0 + 108, fy - 64, x0 + 66, fy - 58]); line(x0 + 108, fy - 44, x0 + 150, fy - 52, 3);
      figure(x0 + 84, fy - 40, ink, hi, false, 0.78); line(x0 + 98, fy - 96, x0 + 206, fy - 82, 1.5);
    } else {   // a sacrifice: a garlanded bull led to a burning altar
      g.fillStyle = ink; g.strokeStyle = ink;
      g.fillRect(x0 + 192, fy - 44, 36, 44); g.fillRect(x0 + 188, fy - 51, 44, 8);
      g.fillStyle = acc; P([x0 + 196, fy - 51, x0 + 203, fy - 80, x0 + 209, fy - 62, x0 + 215, fy - 90, x0 + 222, fy - 51]);
      g.fillStyle = ink; g.beginPath(); g.ellipse(x0 + 124, fy - 46, 34, 16, 0, 0, TAU); g.fill();
      P([x0 + 150, fy - 58, x0 + 170, fy - 54, x0 + 174, fy - 36, x0 + 154, fy - 34]);
      line(x0 + 164, fy - 57, x0 + 172, fy - 72, 3); line(x0 + 157, fy - 58, x0 + 150, fy - 72, 3);
      for (const lx of [-24, -14, 16, 25]) line(x0 + 124 + lx, fy - 36, x0 + 124 + lx, fy - 1, 4.5);
      line(x0 + 90, fy - 52, x0 + 84, fy - 20, 3);
      g.strokeStyle = hi; line(x0 + 146, fy - 62, x0 + 148, fy - 32, 3);
      figure(x0 + 40, fy, ink, hi, true, 0.95); figure(x0 + 66, fy, ink, hi, false, 0.95); g.strokeStyle = ink; line(x0 + 86, fy - 78, x0 + 152, fy - 50, 1.5);
    }
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  m.map = tex; return ctx.setupMaterial(m);
}

export function build(ctx) {
  const { M, world, layout, B, G } = ctx;
  const R = rng(3500);
  const L = flats[2].level, Y0 = L + 0.05, YS = L + 0.26;
  const P = prefabs();
  const pick = a => a[Math.floor(R() * a.length)], rr = (a, b) => a + R() * (b - a);
  const cloth = new WarmBucket(), terra = new WarmBucket(), bronze = new TintBucket(() => R() < 0.16 ? pick(PATINA) : pick(BRONZES)), leaves = new Bucket(), water = new Bucket(), pinax = new Bucket();
  const RL = rng(3501), pickL = a => a[Math.floor(RL() * a.length)], rrL = (a, b) => a + RL() * (b - a);   // layout draws only, so detail changes never reshuffle the stalls
  const stats = { stalls: 0, skipped: 0 };
  // local frame: f(lx, ly, lz, rx, ry, rz, s) → world matrix of a point in a thing standing at (x, y, z) turned by ry (+z local = its front)
  const frame = (x, z, ry, y = Y0) => { const m0 = mat(x, y, z, 0, ry, 0); return (lx = 0, ly = 0, lz = 0, rx = 0, ry2 = 0, rz = 0, s = 1) => m0.clone().multiply(mat(lx, ly, lz, rx, ry2, rz, s)); };
  // world AABB of a local rectangle (ry is a multiple of π/2)
  const wrect = (x, z, ry, lx0, lx1, lz0, lz1) => {
    const c = Math.cos(ry), s = Math.sin(ry), xs = [], zs = [];
    for (const lx of [lx0, lx1]) for (const lz of [lz0, lz1]) { xs.push(x + lx * c + lz * s); zs.push(z - lx * s + lz * c); }
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  };
  const hit = (a, b) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
  const collide = r => world.colliders.push({ minX: r.minX, maxX: r.maxX, minZ: r.minZ, maxZ: r.maxZ });

  // ---------- what must stay open: lanes on the street lines, the promenade before the north stoa, the quay edge,
  // the corner passages and a ring round the monument ----------
  const LANES_X = [-80, -35, 10, 55, 100];
  const KEEP = [
    ...LANES_X.map(x => ({ minX: x - 2.5, maxX: x + 2.5, minZ: 384, maxZ: 441 })),
    { minX: -113, maxX: 113, minZ: 421.5, maxZ: 426.5 }, { minX: -113, maxX: 113, minZ: 384, maxZ: 389.5 }, { minX: -113, maxX: 113, minZ: 435.6, maxZ: 441 },
    { minX: -113, maxX: -99, minZ: 370, maxZ: 394 }, { minX: 99, maxX: 113, minZ: 370, maxZ: 394 },
  ];
  const nearMonument = r => Math.hypot(Math.max(r.minX, Math.min(0, r.maxX)), Math.max(r.minZ, Math.min(410, r.maxZ)) - 410) < 8;
  const clearOf = r => !world.colliders.some(c => hit(c, r)) && !layout.isReserved(r) && !layout.housesIn(r).length;
  const free = (r, keep = true) => r.minX >= -112.06 && r.maxX <= 112.06 && r.minZ >= 385 && r.maxZ <= 438 && !(keep && (KEEP.some(k => hit(k, r)) || nearMonument(r))) && clearOf(r);

  // ---------- goods ----------
  const clay = () => pick(CLAY);
  const basketOf = (f, x, y, z, col, s = 1, low = false) => {
    terra.add(low ? P.lowBasket : P.basket, f(x, y, z, 0, R() * TAU, 0, s), pick([WICKER, WICKER2, 0xa8844e]));
    terra.add(low ? P.lowMound : P.mound, f(x, y + (low ? 0.08 : 0.15) * s, z, 0, 0, 0, s), col);
    if (!low && R() < 0.7) { const c = new THREE.Color(col), n = 2 + (R() * 3 | 0); for (let k = 0; k < n; k++) { const a = k / n * TAU + R(); terra.add(P.ball, f(x + Math.cos(a) * 0.09 * s, y + 0.27 * s, z + Math.sin(a) * 0.09 * s, 0, 0, 0, s * rr(0.9, 1.3)), c.clone().multiplyScalar(rr(0.8, 1.15)).getHex()); } }
  };
  const amph = (f, x, z, y = 0.04, tilt = 0, s = 1, col, plain) => terra.add(plain ? P.amphPlain : P.amph, f(x, y, z, tilt, R() * TAU, 0, s), col ?? clay());
  const spread = (W, step, fn) => { const n = Math.max(1, Math.floor((W - 0.3) / step)); for (let i = 0; i < n; i++) fn(n > 1 ? lerp(-W / 2 + step / 2 + 0.1, W / 2 - step / 2 - 0.1, i / (n - 1)) : 0, i); };
  const rail = (f, W, y, z) => B.woodDark.add(new THREE.CylinderGeometry(0.025, 0.025, W, 5, 1, true).rotateZ(Math.PI / 2), f(0, y, z));
  function cage(f, x, y, z) {
    for (const yy of [0.015, 0.47]) terra.add(box(0.62, 0.03, 0.46), f(x, y + yy, z), WICKER2);
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) terra.add(P.cagePost, f(x + a * 0.29, y + 0.24, z + b * 0.21), WICKER2);
    for (const k of [-0.5, 0.5]) terra.add(P.cageBar, f(x + k * 0.2, y + 0.24, z + 0.215), WICKER);
    for (let k = 0; k < 1 + (R() < 0.5 ? 1 : 0); k++) terra.add(P.hen, f(x + (k - 0.5) * 0.22, y + 0.03, z, 0, R() * TAU, 0, 0.85), pick([0xd8cdb8, 0x8a5a34, 0x3a2e28, 0xb07a44]));
  }
  const GOODS = {
    produce(f, W, top, ground, noFront) {
      spread(W, 0.56, (x, i) => basketOf(f, x, top, ground ? 1.45 : 1.3 + (i % 2) * 0.3, pick(PRODUCE), rr(0.8, 1), R() < 0.35));
      if (ground) spread(W - 0.4, 0.66, x => basketOf(f, x, 0.04, 2.15, pick(PRODUCE), 0.95, R() < 0.5));
      else if (!noFront) { for (const s of [-1, 1]) if (R() < 0.75) basketOf(f, s * rr(0.35, W / 2 - 0.4), 0.04, 2.25, pick(PRODUCE), 1.15); if (R() < 0.6) cloth.add(P.sack, f(W / 2 - 0.3, 0.04, 0.35, 0, R() * TAU), pick(UNDYED)); }
    },
    bread(f, W, top, ground, noFront) {
      for (let x = -W / 2 + 0.22; x < W / 2 - 0.18; x += 0.31) for (const z of [1.22, 1.49, 1.76]) if (R() < 0.8) { const ring = R() < 0.25; terra.add(ring ? P.ring : P.loaf, f(x + rr(-0.03, 0.03), top + (ring ? 0.035 : 0), z, 0, R() * TAU, 0, rr(0.8, 1.05)), pick([0xb88550, 0xa8723e, 0xc39a62, 0x9a6634])); }
      if (!noFront) { basketOf(f, -W / 2 + 0.45, 0.04, 2.2, 0xb07a44, 1.1, true); basketOf(f, W / 2 - 0.5, 0.04, 2.2, 0xc39a62, 1.0, true); }
    },
    fish(f, W, top, ground, noFront) {
      const tilt = 0.12;
      for (let x = -W / 2 + 0.28; x < W / 2 - 0.2; x += rr(0.23, 0.31)) for (const z of [1.22, 1.68]) if (R() < 0.8) terra.add(P.fish, f(x, top + 0.022 - (z - 1.48) * tilt, z, -tilt, Math.PI / 2 + rr(-0.35, 0.35), 0), pick(FISH));
      if (R() < 0.6) terra.add(P.bigFish, f(rr(-0.3, 0.3), top + 0.075, 1.45, -tilt, rr(-0.1, 0.1), 0), pick([0x8a9eac, 0x96a6b0]));
      if (R() < 0.5) terra.add(P.lowMound, f(-W / 2 + 0.4, top + 0.03, 1.45, -tilt, 0, 0, 0.55), 0x9a5a58);
      if (!noFront) { const bx = rr(-0.4, 0.4); terra.add(P.lowBasket, f(bx, 0.04, 2.25), WICKER2); for (let k = 0; k < 6; k++) terra.add(P.fish, f(bx + rr(-0.1, 0.1), 0.1 + k * 0.014, 2.25 + rr(-0.1, 0.1), rr(-0.08, 0.08), R() * TAU, 0), pick(FISH)); amph(f, W / 2 - 0.3, 0.35); if (R() < 0.5) terra.add(P.hydria, f(-W / 2 + 0.3, 0.04, 0.35), clay()); }
    },
    pottery(f, W, top, ground, noFront) {
      if (!ground) for (let x = -W / 2 + 0.2; x < W / 2 - 0.15; x += rr(0.34, 0.48)) {
        const z = rr(1.18, 1.78), k = R();
        if (k < 0.35) terra.add(P.jug, f(x, top, z, 0, R() * TAU), R() < 0.4 ? BLACK : clay());
        else if (k < 0.6) terra.add(pick(P.bowls), f(x, top, z, 0, 0, 0, 0.8), R() < 0.5 ? BLACK : clay());
        else if (k < 0.8) terra.add(P.lamps, f(x, top + 0.02, z, 0, rr(-0.3, 0.3), 0, 0.8), clay());
        else terra.add(P.krater, f(x, top, z, 0, 0, 0, 0.55), BLACK);
      }
      else spread(W, 0.34, x => terra.add(pick(P.bowls), f(x, 0.04, 2.3, 0, 0, 0, 0.85), R() < 0.5 ? BLACK : clay()));
      if (!noFront) spread(W, 0.72, x => { const k = R(), z = ground ? 1.5 : 2.2;
        if (k < 0.4) amph(f, x, z, 0.04, 0, rr(0.85, 1)); else if (k < 0.7) terra.add(P.krater, f(x, 0.04, z), R() < 0.5 ? BLACK : clay()); else terra.add(P.hydria, f(x, 0.04, z, 0, R() * TAU), clay()); });
      if (!noFront && W > 2.3) terra.add(P.pithos, f(-W / 2 + 0.3, 0.04, 0.45, 0, R() * TAU, 0, rr(0.65, 0.8)), clay());
    },
    textiles(f, W, top, ground, noFront) {
      for (let x = -W / 2 + 0.3; x < W / 2 - 0.25; x += 0.42) {
        if (R() < 0.55) { let y = top; const n = 2 + (R() * 4 | 0); for (let j = 0; j < n; j++) { const h = rr(0.05, 0.08); cloth.add(box(0.36, h, 0.3), f(x, y + h / 2, rr(1.3, 1.36), 0, rr(-0.08, 0.08)), pick([...DYES, ...UNDYED])); y += h; } }
        else { const c = pick(DYES); for (const [dx, dy] of [[-0.075, 0.07], [0.075, 0.07], [0, 0.19]]) cloth.add(P.bolt, f(x + dx, top + dy, 1.5, 0, Math.PI / 2, 0, new THREE.Vector3(1, 1, 0.95)), R() < 0.6 ? c : pick(UNDYED)); }
      }
      if (noFront) return;
      rail(f, W, 2.12, 0.1);
      const n = Math.max(2, Math.round(W / 0.8));
      for (let k = 0; k < n; k++) if (R() < 0.8) sheet(cloth, f, lerp(-W / 2, W / 2, k / n) + 0.04, lerp(-W / 2, W / 2, (k + 1) / n) - 0.04, 0.1, 2.1, 0.12, rr(0.8, 1.3), R() < 0.3 ? pick(STRIPES)[1] : pick(DYES), 2, 0);
      basketOf(f, W / 2 - 0.4, 0.04, 2.25, pick(UNDYED), 1.05, true);
    },
    bronze(f, W, top, ground, noFront) {
      for (let x = -W / 2 + 0.25; x < W / 2 - 0.2; x += rr(0.28, 0.4)) {
        const k = R(), z = rr(1.2, 1.75);
        if (k < 0.3) bronze.add(P.hydria, f(x, top, z, 0, R() * TAU, 0, 0.8)); else if (k < 0.55) bronze.add(P.phiale, f(x, top, z));
        else if (k < 0.8) bronze.add(P.lamps, f(x, top + 0.02, z, 0, rr(-0.3, 0.3), 0, 1.1)); else bronze.add(P.jug, f(x, top, z, 0, R() * TAU, 0, 0.9));
      }
      if (noFront) return;
      const cx = rr(-0.3, 0.3) * (W - 1), bc = bronze.def(), leg = new THREE.Color(bc).multiplyScalar(0.72).getHex();
      bronze.add(P.cauldron, f(cx, 0.72, 2.2), bc);
      for (let k = 0; k < 3; k++) { const a = k / 3 * TAU; bronze.add(new THREE.CylinderGeometry(0.018, 0.018, 0.78, 5), f(cx + Math.cos(a) * 0.19, 0.39, 2.2 + Math.sin(a) * 0.19), leg); }
      rail(f, W, 2.05, 0.1);
      for (let x = -W / 2 + 0.4; x < W / 2 - 0.3; x += 0.75) bronze.add(P.phiale, f(x, 1.9, 0.13, Math.PI / 2 - 0.1, 0, 0, 0.75));
    },
    oil(f, W, top, ground, noFront) {
      if (!ground) spread(W, 0.45, x => terra.add(R() < 0.5 ? P.jug : pick(P.bowls), f(x, top, rr(1.2, 1.75), 0, R() * TAU), R() < 0.3 ? BLACK : clay()));
      if (noFront) return;
      if (ground) { rail(f, W, 0.62, 1.2); spread(W, 0.4, x => amph(f, x, 1.5, 0.04, -0.28, rr(0.95, 1.05), undefined, true)); spread(W - 0.3, 0.75, x => amph(f, x, 2.25, 0.04, 0, rr(0.8, 0.95))); }
      else spread(W, 0.52, x => amph(f, x, 2.25, 0.04, -0.12, rr(0.9, 1)));
      terra.add(P.pithos, f(W / 2 - 0.35, 0.04, 0.45, 0, R() * TAU, 0, rr(0.65, 0.85)), clay());
    },
    chickens(f, W, top, ground, noFront) {
      for (let x = -W / 2 + 0.4; x < W / 2 - 0.3; x += 0.68) { cage(f, x, 0.04, 1.45); if (R() < 0.5) cage(f, x, 0.54, 1.45); }
      if (!noFront) { terra.add(P.lowBasket, f(0, 0.04, 2.3), WICKER); for (let k = 0; k < 7; k++) terra.add(P.ball, f(rr(-0.15, 0.15), 0.1, 2.3 + rr(-0.15, 0.15), 0, 0, 0, new THREE.Vector3(0.9, 1.2, 0.9)), 0xe6dcc6); }
    },
    grain(f, W, top, ground, noFront) {
      spread(W, 0.64, (x, i) => {
        if (i % 2 === 0 || R() < 0.3) { const s = rr(0.85, 1); cloth.add(P.openSack, f(x, 0.04, 1.5, 0, R() * TAU, 0, s), pick(UNDYED)); terra.add(P.lowMound, f(x, 0.04 + 0.47 * s, 1.5, 0, 0, 0, s * 0.95), pick([0xd2b47a, 0xc9a45e, 0xb08a4a, 0x8a5a30, 0xd9c9a0])); }
        else { cloth.add(P.sack, f(x, 0.04, 1.5, 0.15, R() * TAU, 0), pick(UNDYED)); if (R() < 0.5) cloth.add(P.sack, f(x + 0.1, 0.04, 2.15, -0.3, R() * TAU, 0), pick(UNDYED)); }
      });
      if (!noFront) { B.woodDark.add(new THREE.CylinderGeometry(0.2, 0.18, 0.32, 8), f(-W / 2 + 0.35, 0.2, 2.3)); terra.add(P.pithos, f(W / 2 - 0.4, 0.04, 0.45, 0, 0, 0, 0.75), clay()); }
    },
    baskets(f, W, top, ground, noFront) {
      spread(W, 0.62, x => { terra.add(P.baskets[1 + (R() * 4 | 0)], f(x, ground ? 0.04 : top, 1.45, 0, R() * TAU, 0, 1.1), pick([WICKER, WICKER2, 0xb8925c])); });
      if (noFront) return;
      spread(W - 0.2, 0.7, x => { if (R() < 0.5) terra.add(P.coil, f(x, 0.09, 2.25), pick(ROPE)); else { terra.add(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 7), f(x, 0.44, 2.05, -0.35, 0, rr(-0.1, 0.1)), 0xc4a070); } });
    },
    garlands(f, W, top, ground, noFront) {
      for (let x = -W / 2 + 0.2; x < W / 2 - 0.15; x += 0.4) for (const z of [1.25, 1.55]) { if (R() < 0.3) continue; terra.add(P.wreath, f(x, top + 0.03, z), pick([0x55703a, 0x6a7a44, 0x4a6034])); if (R() < 0.6) terra.add(P.ball, f(x + 0.08, top + 0.06, z, 0, 0, 0, 0.6), pick([0xc04a3a, 0xd9b048, 0xe0d6c8, 0x9a5aa0])); }
      if (!noFront) for (const s of [-1, 1]) basketOf(f, s * (W / 2 - 0.5), 0.04, 2.2, pick([0xc04a3a, 0xd9b048, 0x9a5aa0, 0x6a8a40]), 1.05);
      if (!noFront) { rail(f, W, 2.12, 0.1); spread(W, 0.6, x => terra.add(P.wreath, f(x, 1.95, 0.14, Math.PI / 2), pick([0x55703a, 0x6a7a44]))); }
    },
    dairy(f, W, top, ground, noFront) {
      spread(W, 0.34, (x, i) => { if (i % 3 === 2) { terra.add(P.dish, f(x, top, 1.5, 0, 0, 0, 1.3), clay()); terra.add(P.lowMound, f(x, top + 0.07, 1.5, 0, 0, 0, 0.45), pick([0x3a3a28, 0x6a6a38])); } else for (let j = 0; j < 1 + (R() * 3 | 0); j++) terra.add(P.cheese, f(x, top + 0.04 + j * 0.08, rr(1.3, 1.65), 0, 0, 0, rr(0.8, 1)), pick([0xead6a4, 0xe2c890, 0xd8b87e])); });
      if (!noFront) { terra.add(P.pithos, f(-W / 2 + 0.35, 0.04, 2.2, 0, 0, 0, 0.6), clay()); terra.add(P.lowMound, f(-W / 2 + 0.35, 0.78, 2.2, 0, 0, 0, 0.55), 0x3a3a28); amph(f, W / 2 - 0.35, 2.25); }
    },
    leather(f, W, top, ground, noFront) {
      const LEATHER = [0x9a6a44, 0xa87a50, 0x8a5c3a, 0xb08a5c];
      spread(W, 0.42, (x, i) => { const c = pick(LEATHER), k = R();
        if (i % 3 !== 1) terra.add(P.sandals, f(x, top, 1.24 + (i % 2) * 0.06, 0, rr(-0.3, 0.3), 0, 1.25), c);                  // sandals along the front edge
        if (k < 0.4) terra.add(P.belt, f(x, top + 0.018, 1.62, 0, 0, 0, 1.3), pick(LEATHER));
        else if (k < 0.75) terra.add(P.hide, f(x, top + 0.065, 1.6, 0, rr(-0.2, 0.2), 0, new THREE.Vector3(1, 1.2, 1.2)), pick(LEATHER));
        else { let y = top; for (let j = 0; j < 2 + (R() * 3 | 0); j++) { terra.add(box(0.3, 0.03, 0.26), f(x, y + 0.015, 1.62, 0, rr(-0.15, 0.15)), pick(LEATHER)); y += 0.03; } } });
      if (noFront) return;
      rail(f, W, 2.12, 0.1);
      spread(W, 0.9, x => sheet(cloth, f, x - 0.38, x + 0.38, 0.1, 2.1, 0.13, rr(1.0, 1.4), pick([0x9a6a44, 0x8e6a48, 0xa87a50]), 2, 0));
      for (const s of [-1, 1]) if (R() < 0.6) { terra.add(ellipsoid(0.16, 0.21, 0.12, 6, 4), f(s * (W / 2 - 0.4), 0.22, 2.25, 0, 0, s * 0.3), 0xa07048); terra.add(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 5), f(s * (W / 2 - 0.4) - s * 0.1, 0.44, 2.25, 0, 0, s * 0.5), 0x8a5c3a); }   // wineskins
    },
    spices(f, W, top, ground, noFront) {
      spread(W, 0.5, (x, i) => { const z = 1.25 + (i % 2) * 0.35; terra.add(P.dish, f(x, top, z, 0, 0, 0, 1.1), clay()); terra.add(P.lowMound, f(x, top + 0.06, z, 0, 0, 0, 0.42), pick([0xc9862a, 0xa0402a, 0x6a4a2a, 0xd9b048, 0x7a8a4a, 0x8a3a3a])); });
      if (!noFront) { for (let k = 0; k < 3; k++) terra.add(P.jug, f(rr(-W / 2 + 0.2, W / 2 - 0.2), top, 1.75, 0, R() * TAU, 0, 0.45), pick([0xe0d6c0, 0xd8c8a8, BLACK])); cloth.add(P.sack, f(-W / 2 + 0.35, 0.04, 2.25, 0, R() * TAU, 0, 0.8), pick(UNDYED)); cloth.add(P.openSack, f(W / 2 - 0.35, 0.04, 2.25, 0, 0, 0, 0.8), pick(UNDYED)); terra.add(P.lowMound, f(W / 2 - 0.35, 0.42, 2.25, 0, 0, 0, 0.75), 0xc9862a); }
    },
    rope(f, W, top, ground, noFront) {
      spread(W, 0.6, x => { for (let j = 0; j < 1 + (R() * 3 | 0); j++) terra.add(P.coil, f(x, 0.09 + j * 0.1, 1.5, 0, R() * TAU, 0, rr(0.9, 1.2)), pick(ROPE)); });
      if (!noFront) spread(W - 0.3, 0.7, x => cloth.add(P.sack, f(x, 0.04, 2.25, 0, R() * TAU), pick(UNDYED)));
    },
    // the booths round the civic square: wine by the cup, scribes, barbers, water carriers
    wine(f, W, top, ground, noFront) {
      spread(W - 0.7, 0.28, (x, i) => { const z = rr(1.25, 1.72); if (i % 3 === 0) terra.add(P.jug, f(x - 0.35, top, z, 0, R() * TAU), R() < 0.5 ? BLACK : clay()); else terra.add(P.phiale, f(x - 0.35, top, z, 0, 0, 0, 0.7), BLACK); });
      terra.add(P.krater, f(W / 2 - 0.4, top, 1.5, 0, 0, 0, 0.8), BLACK);
      if (noFront) return;
      spread(W - 0.5, 0.42, x => amph(f, x, 2.25, 0.04, -0.1, rr(0.9, 1)));
      terra.add(P.pithos, f(-W / 2 + 0.35, 0.04, 0.45, 0, R() * TAU, 0, 0.7), clay());
    },
    scribe(f, W, top, ground, noFront) {
      spread(W, 0.42, (x, i) => { const z = rr(1.3, 1.62), a = rr(-0.3, 0.3);
        if (i % 2) { terra.add(box(0.2, 0.02, 0.26), f(x, top + 0.01, z, 0, a), 0x8a6a48); terra.add(box(0.16, 0.022, 0.22), f(x, top + 0.012, z, 0, a), 0x2e2824); }
        else terra.add(P.hide, f(x, top + 0.028, z, 0, a, 0, new THREE.Vector3(0.6, 0.5, 0.5)), 0xe6d2b0); });
      terra.add(P.jug, f(W / 2 - 0.3, top, 1.2, 0, 0, 0, 0.35), BLACK);
      if (!noFront) terra.add(P.stool, f(rr(-0.3, 0.3), 0, 2.3, 0, rr(-0.3, 0.3)), 0x7a5a3a);
    },
    barber(f, W, top, ground, noFront) {
      const bc = bronze.def(); bronze.add(P.phiale, f(-W / 4, top, 1.45, 0, 0, 0, 1.5), bc); terra.add(P.jug, f(-W / 4 + 0.38, top, 1.6), clay());
      bronze.add(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 10).rotateX(Math.PI / 2 - 0.25), f(W / 4, top + 0.13, 1.25), bc);
      for (let k = 0; k < 3; k++) bronze.add(box(0.02, 0.006, 0.15), f(W / 4 - 0.1 + k * 0.08, top + 0.004, 1.62, 0, rr(-0.2, 0.2)), bc);
      cloth.add(box(0.32, 0.05, 0.28), f(W / 4 + 0.35, top + 0.025, 1.6), pick(UNDYED));
      if (noFront) return;
      terra.add(P.stool, f(0, 0, 2.3, 0, R()), 0x7a5a3a); terra.add(P.stool, f(W / 2 - 0.3, 0, 2.4, 0, R()), 0x6a4a30);
      rail(f, W, 2.0, 0.1); for (const x of [-0.5, 0.2]) sheet(cloth, f, x - 0.18, x + 0.18, 0.1, 1.99, 0.11, 1.4, pick(UNDYED), 1, 0);
    },
    water(f, W, top, ground, noFront) {
      spread(W, 0.48, x => terra.add(R() < 0.6 ? P.hydria : P.jug, f(x, top, rr(1.3, 1.62), 0, R() * TAU, 0, R() < 0.6 ? 0.8 : 1), clay()));
      if (noFront) return;
      spread(W - 0.3, 0.72, x => terra.add(P.hydria, f(x, 0.04, 2.25, 0, R() * TAU, 0, 1.15), clay()));
      terra.add(P.pithos, f(-W / 2 + 0.35, 0.04, 0.45, 0, 0, 0, 0.75), clay());
    },
  };

  // ---------- stall structures ----------
  function sheet(bk, f, x0, x1, zb, yb, zf, yf, color, segs = 3, sag = 0.07) {
    const g = new THREE.PlaneGeometry(1, 1, 1, segs), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const u = p.getX(i) + 0.5, v = p.getY(i) + 0.5; p.setXYZ(i, lerp(x0, x1, u), lerp(yb, yf, v) - sag * Math.sin(Math.PI * v), lerp(zb, zf, v)); }
    // texture offset and direction differ per sheet, so neighbouring cloths never show the same tile
    // and big sails take a coarser tile, so the blotches of the cloth texture never line up into a grid
    const uv = g.attributes.uv, lu = Math.abs(x1 - x0), lv = Math.hypot(zf - zb, yf - yb), ou = R() * 2, ov = R() * 2, sw = R() < 0.5, k = clamp(Math.max(lu, lv) / 4, 1, 3.5);
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i) * lu / k + ou, v = uv.getY(i) * lv / k + ov; uv.setXY(i, sw ? v : u, sw ? u : v); }
    g.computeVertexNormals(); const m = f(), ny = g.attributes.normal.getY(0);
    bk.add(g, m, color, 1 + 0.3 * Math.max(0, -ny)); bk.add(flipped(g), m, color, 1 + 0.3 * Math.max(0, ny));
    if (k > 1.5) for (const c of bk.list.slice(-2)) {   // faded and sun-bleached patches drifting along a long sail
      const pp = c.attributes.position, cc = c.attributes.color;
      for (let i = 0; i < pp.count; i++) { const x = pp.getX(i), z = pp.getZ(i), n = 1 + 0.07 * Math.sin(x * 0.37 + 1.3) * Math.sin(z * 0.43 - 0.7) + 0.05 * Math.sin((x - z) * 0.83 + 2.1); cc.setXYZ(i, cc.getX(i) * n, cc.getY(i) * n, cc.getZ(i) * n); }
    }
  }
  const awningCols = () => R() < 0.3 ? pick(STRIPES) : [R() < 0.4 ? pick(UNDYED) : pick(DYES)];
  function awning(f, x0, x1, zb, yb, zf, yf, cols, valance = true, sag = 0.06) {
    const n = cols.length > 1 ? Math.max(4, Math.round((x1 - x0) / 0.5)) : 1;
    for (let i = 0; i < n; i++) sheet(cloth, f, lerp(x0, x1, i / n), lerp(x0, x1, (i + 1) / n), zb, yb, zf, yf, cols[i % cols.length], n > 1 ? 2 : 3, sag);
    if (valance) sheet(cloth, f, x0, x1, zf - 0.005, yf + 0.008, zf + 0.005, yf - 0.3, cols[cols.length - 1], 1, 0);
  }
  const post = (f, x, z, h, r = 0.05) => B.woodDark.add(new THREE.CylinderGeometry(r * 0.8, r, h, 3, 1, true), f(x, h / 2, z));
  const pole = (f, W, y, z, r = 0.03, x = 0) => B.woodDark.add(new THREE.CylinderGeometry(r, r, W, 4, 1, true).rotateZ(Math.PI / 2), f(x, y, z));
  // the shade over a stall: a sloping cloth awning, a gabled cloth over a ridge pole, a reed mat, parasols, or nothing
  const RAILED = ['textiles', 'leather', 'garlands', 'bronze', 'barber'];
  function shade(f, W, D, style, kind) {
    const zf = D - 0.05, hw = W / 2 + 0.05;
    let k = R(); if (k >= 0.42 && k < 0.6 && RAILED.includes(kind)) k = 0.2;
    if (k < 0.42) {
      const hb = rr(2.35, 2.8), hf = rr(2.0, 2.3);
      for (const s of [-1, 1]) { post(f, s * hw, 0.08, hb); post(f, s * hw, zf, hf); }
      awning(f, -W / 2 - 0.15, W / 2 + 0.15, -0.05, hb + 0.03, zf + 0.25, hf - 0.02, awningCols(), R() < 0.75, rr(0.03, 0.1));
    } else if (k < 0.6) {
      const hr = rr(2.6, 2.95), he = rr(1.95, 2.1), zm = zf / 2, cols = awningCols();
      for (const s of [-1, 1]) { post(f, s * hw, zm, hr); post(f, s * hw, -0.12, he, 0.035); post(f, s * hw, zf + 0.12, he, 0.035); }
      pole(f, W + 0.3, hr, zm);
      for (const ze of [-0.25, zf + 0.25]) awning(f, -W / 2 - 0.12, W / 2 + 0.12, zm, hr + 0.03, ze, he - 0.04, cols, false, 0.05);
    } else if (k < 0.76) {
      const hb = rr(2.25, 2.45), hf = hb - rr(0.05, 0.2);
      for (const s of [-1, 1]) { post(f, s * hw, 0.08, hb); post(f, s * hw, zf, hf); }
      sheet(cloth, f, -W / 2 - 0.12, W / 2 + 0.12, -0.1, hb + 0.03, zf + 0.15, hf + 0.03, pick(REED), 1, 0);
      for (const t of [0.1, 0.5, 0.9]) pole(f, W + 0.3, lerp(hb, hf, t) - 0.02, lerp(-0.1, zf + 0.15, t), 0.02);
    } else if (k < 0.86) {
      for (let i = 0, n = W > 3.1 ? 2 : 1; i < n; i++) {
        const x = n > 1 ? (i - 0.5) * W * 0.52 : rr(-0.25, 0.25), h = rr(2.3, 2.6), r = rr(1.15, 1.45) * (n > 1 ? 0.95 : 1.15), g = new THREE.ConeGeometry(r, 0.5, 8, 1, true), m = f(x, h - 0.25, 0.75, 0, R(), 0), col = R() < 0.45 ? pick(UNDYED) : pick(DYES);
        post(f, x, 0.75, h, 0.03); cloth.add(g, m, col); cloth.add(flipped(g), m, col, 1.25);
      }
    }
  }
  // x, z: middle of the back line; ry: the way the vendor faces; W: frontage
  function stall(x, z, ry, W, kind, style = {}) {
    const f = frame(x, z, ry), D = 2.8, ground = !!style.ground;
    if (!free(wrect(x, z, ry, -W / 2 - 0.2, W / 2 + 0.2, 0.05, D + 0.05), style.keep !== false)) { stats.skipped++; return false; }
    let top = 0.825;
    if (kind === 'fish') {
      B.grey.add(box(W, 0.1, 0.9), f(0, 0.82, 1.48, 0.12, 0, 0));
      for (const s of [-1, 1]) B.ashlar.add(box(0.3, 0.76, 0.55), f(s * (W / 2 - 0.35), 0.38, 1.48));
      top = 0.87;
    } else if (!ground) {
      B.wood.add(box(W, 0.05, 0.86), f(0, 0.8, 1.48));
      for (const s of [-1, 1]) B.woodDark.add(box(0.05, 0.76, 0.66), f(s * (W / 2 - 0.25), 0.39, 1.48));
      if (W > 2.6) B.woodDark.add(box(W - 0.5, 0.05, 0.05), f(0, 0.28, 1.48));
    } else { cloth.add(box(W, 0.02, 1.7), f(0, 0.015, 1.75), pick([0x8f7a5a, 0x9c8a66, 0x7a5a44, 0xa89470])); top = 0.04; }
    if (style.awning !== false) shade(f, W, D, style, kind);
    if (R() < 0.35) terra.add(P.stool, f(rr(0.45, 0.7) * (R() < 0.5 ? -1 : 1), 0, 0.42, 0, rr(-0.4, 0.4)), 0x7a5a3a);
    GOODS[kind](f, W, top, ground, false);
    collide(wrect(x, z, ry, -W / 2 - 0.08, W / 2 + 0.08, 0.98, D - 0.1));
    const v = wrect(x, z, ry, 0, 0, 0.55, 0.55);
    layout.addPoi({ type: 'stall', x: v.minX, z: v.minZ, y: Y0, ry, r: 1.6, owner: 'agora', note: kind });
    stats.stalls++; return true;
  }
  // a line of stalls whose back line runs from A to B, all facing ry
  function stallRow(ax, az, bx, bz, ry, kinds, style = {}) {
    const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len, widths = style.widths || [2.4, 2.8, 3.0, 3.2, 3.6];
    const minW = Math.min(2.25, ...widths) - 0.15;   // the narrowest stall this row sells from (ground sellers need less)
    let s = rrL(0, 0.5);
    while (s < len - minW) {
      if (RL() < (style.gapP ?? 0.1)) { s += rrL(1.2, 2.6); continue; }
      const W = Math.min(len - s - 0.1, pickL(widths) + rrL(-0.1, 0.1));
      if (W < minW) break;
      const c = s + W / 2 + 0.15;
      stall(ax + ux * c, az + uz * c, ry, W, style.cycle ? kinds[(style.i = (style.i ?? -1) + 1) % kinds.length] : pickL(kinds), style);
      s += W + 0.3 + rrL(0.25, 0.8);
    }
  }
  const doubleRow = (ax, az, bx, bz, ryA, kinds, style) => { stallRow(ax, az, bx, bz, ryA, kinds, style); stallRow(bx, bz, ax, az, ryA + Math.PI, kinds, style); };

  // ---------- smaller things ----------
  function bench(x, z, ry, len, y = Y0, keep = false) {
    const f = frame(x, z, ry, y), r = wrect(x, z, ry, -len / 2, len / 2, -0.26, 0.26);
    if (y === Y0 && !free(r, keep)) return false;
    B.grey.add(box(len, 0.1, 0.5), f(0, 0.4, 0));
    for (const s of [-1, 1]) B.grey.add(box(0.16, 0.36, 0.4), f(s * (len / 2 - 0.3), 0.18, 0));
    collide(r);
    for (let t = -len / 2 + 0.45; t <= len / 2 - 0.44; t += 0.8) { const p = wrect(x, z, ry, t, t, 0.02, 0.02); layout.addPoi({ type: 'bench', x: p.minX, z: p.minZ, y: y + 0.45, ry, owner: 'agora' }); }
    return true;
  }
  function donkey(x, z, ry, packed) {
    const f = frame(x, z, ry), col = pick([0x6e6258, 0x7a6a5a, 0x5e534a, 0x86776a]), dark = 0x2e2824, pale = 0xb0a28c;
    const r = wrect(x, z, ry, -0.85, 1.55, -0.5, 0.5);
    if (!free(r)) return false;
    terra.add(ellipsoid(0.56, 0.27, 0.25, 8, 5), f(0, 0.9, 0), col);
    terra.add(ellipsoid(0.25, 0.24, 0.23, 6, 4), f(-0.4, 0.94, 0), col); terra.add(ellipsoid(0.24, 0.25, 0.23, 6, 4), f(0.36, 0.95, 0), col);
    terra.add(ellipsoid(0.24, 0.1, 0.19, 6, 3), f(0.02, 0.72, 0), pale);
    terra.add(ellipsoid(0.33, 0.14, 0.12, 6, 4), f(0.62, 1.13, 0, 0, 0, 0.75), col);
    terra.add(ellipsoid(0.27, 0.12, 0.11, 6, 4), f(0.9, 1.2, 0, 0, 0, -0.95), col);
    terra.add(ellipsoid(0.1, 0.09, 0.095, 5, 3), f(1.04, 0.98, 0), pale);
    terra.add(box(0.44, 0.07, 0.04), f(0.58, 1.28, 0, 0, 0, 0.75), dark);
    for (const s of [-1, 1]) terra.add(new THREE.ConeGeometry(0.055, 0.32, 4), f(0.8, 1.44, s * 0.08, s * 0.3, 0, 0.4), col);
    for (const [lx, lz] of [[0.38, -0.13], [0.38, 0.13], [-0.42, -0.12], [-0.42, 0.12]]) { terra.add(new THREE.CylinderGeometry(0.07, 0.05, 0.72, 6), f(lx, 0.4, lz), col); terra.add(box(0.09, 0.07, 0.09), f(lx, 0.035, lz), dark); }
    terra.add(new THREE.CylinderGeometry(0.025, 0.015, 0.6, 4), f(-0.66, 0.7, 0, 0, 0, -0.2), col); terra.add(ellipsoid(0.04, 0.09, 0.04, 4, 3), f(-0.72, 0.4, 0), dark);
    if (packed) {
      cloth.add(box(0.55, 0.05, 0.56), f(-0.05, 1.16, 0), pick(DYES));
      for (const s of [-1, 1]) { terra.add(P.basket, f(-0.05, 0.62, s * 0.34, 0, 0, 0, 1.25), WICKER2); terra.add(P.mound, f(-0.05, 0.86, s * 0.34, 0, 0, 0, 1.2), pick(PRODUCE)); }
    }
    B.woodDark.add(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 6), f(1.45, 0.55, 0));
    terra.add(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 3), f(1.25, 0.98, 0, 0, 0, 1.2), 0x6a5a40);
    collide(r);
    return true;
  }
  function herm(x, z, ry) {
    const f = frame(x, z, ry), r = wrect(x, z, ry, -0.32, 0.32, -0.3, 0.3);
    if (!clearOf(r)) return;
    B.grey.add(box(0.56, 0.14, 0.52), f(0, 0.07, 0));
    B.marble.add(box(0.3, 1.24, 0.27), f(0, 0.14 + 0.62, 0));
    B.marble.add(box(0.46, 0.09, 0.12), f(0, 1.24, 0));
    B.statue.add(new THREE.CylinderGeometry(0.055, 0.07, 0.16, 6), f(0, 1.44, 0));
    B.statue.add(ellipsoid(0.105, 0.135, 0.12, 8, 6), f(0, 1.6, 0.01));
    B.statue.add(ellipsoid(0.085, 0.1, 0.07, 6, 4), f(0, 1.47, 0.08));
    B.statue.add(ellipsoid(0.115, 0.075, 0.12, 8, 4), f(0, 1.69, -0.01));
    terra.add(new THREE.TorusGeometry(0.15, 0.02, 3, 8), f(0, 1.36, 0.02, 1.35, 0, 0), 0x55703a);
    collide(r);
  }

  // ---------- which way do the side stoas face? (read from their colliders: the back wall is the unbroken one) ----------
  const wallAlong = x => { for (let z = 379; z <= 437; z += 1.1) if (!world.blocked(x, z)) return false; return true; };
  const sideStoa = s => wallAlong(s * 112.5) ? { face: s * 112.9, ry: s * Math.PI / 2 } : wallAlong(s * 123.5) ? { face: s * 123.1, ry: -s * Math.PI / 2 } : null;
  const westStoa = sideStoa(-1), eastStoa = sideStoa(1);
  const E = Math.PI / 2, Wd = -Math.PI / 2, N = Math.PI, S = 0;   // facings

  // ---------- the market blocks ----------
  const POT = ['pottery', 'pottery', 'pottery', 'baskets'], FOOD = ['produce', 'produce', 'produce', 'bread', 'dairy', 'garlands', 'spices'];
  const CLOTH = ['textiles', 'textiles', 'leather', 'baskets'], CRAFT = ['bronze', 'bronze', 'pottery', 'oil', 'spices', 'leather'], WHOLE = ['grain', 'grain', 'oil', 'rope', 'baskets'];
  const aisles = [], aisle = (...r) => aisles.push(r);   // checked for obstructions once everything stands
  // W1 pottery: two double rows and ground sellers between them
  for (const [a, b] of [[394.5, 406.5], [409.5, 421.3]]) { doubleRow(-102, a, -102, b, E, POT, { gapP: 0.15 }); doubleRow(-85.4, a, -85.4, b, E, POT, { gapP: 0.12 }); doubleRow(-93.7, a + 0.4, -93.7, b - 0.4, E, ['pottery', 'baskets', 'pottery'], { ground: true, awning: false, gapP: 0.3, widths: [1.8, 2.2, 2.4] }); }
  aisle(-107.9, -105, 400.1, 414.4); aisle(-99, -96.6, 394, 421); aisle(-90.8, -88.3, 394, 421);
  // W2 food: singles on the lanes, two double rows, ground sellers down the middle
  for (const [a, b] of [[390, 405], [408, 421.3]]) {
    stallRow(-74.6, b, -74.6, a, Wd, FOOD, { gapP: 0.1 }); stallRow(-40.4, a, -40.4, b, E, FOOD, { gapP: 0.1 });
    doubleRow(-66, a, -66, b, E, FOOD, { gapP: 0.12 }); doubleRow(-49, a, -49, b, E, FOOD, { gapP: 0.12 });
    doubleRow(-57.5, a + 0.5, -57.5, b - 0.5, E, ['produce', 'produce', 'chickens', 'chickens', 'baskets'], { ground: true, awning: false, gapP: 0.3, widths: [1.8, 2.2, 2.4] });
  }
  aisle(-74.5, -69, 390, 421); aisle(-63, -60.5, 390, 421); aisle(-54.5, -52, 390, 421); aisle(-46, -40.5, 390, 421); aisle(-77.5, -37.5, 405.2, 407.8);
  // E1 cloth: a single row facing the plaza, a double row
  for (const [a, b] of [[390, 405], [408, 421.3]]) { stallRow(40.3, b, 40.3, a, Wd, CLOTH, { gapP: 0.08 }); doubleRow(47.2, a, 47.2, b, E, CLOTH, { gapP: 0.1 }); }
  aisle(40.5, 44.2, 390, 421);
  // E2 crafts: east–west double rows, ground sellers between
  for (const [a, b] of [[58, 76], [79, 97.3]]) {
    doubleRow(a, 397.5, b, 397.5, N, CRAFT, { gapP: 0.14 }); doubleRow(a, 413, b, 413, N, CRAFT, { gapP: 0.14 });
    doubleRow(a + 1, 405.3, b - 1, 405.3, N, ['baskets', 'pottery', 'rope', 'spices'], { ground: true, awning: false, gapP: 0.3, widths: [1.8, 2.2, 2.4] });
  }
  aisle(57.5, 97.5, 400.5, 402.3); aisle(57.5, 97.5, 408.3, 410); aisle(57.5, 97.5, 416, 421.5); aisle(76, 79, 390, 421.5);
  // E3: a short row for the donkey drivers facing the east stoa, customers between it and the colonnade
  stallRow(103.0, 406.4, 103.0, 421.3, E, ['rope', 'baskets', 'grain', 'oil', 'leather'], { gapP: 0.12 });
  // the strip along the quay: fish to the west, wholesale to the east
  for (const [a, b] of [[-108.5, -96], [-93.5, -82.6], [-77.4, -59], [-56, -37.6]]) doubleRow(a, 431, b, 431, N, ['fish', 'fish', 'fish', 'fish', 'oil'], { gapP: 0.08 });
  for (const [a, b] of [[37.6, 52.4], [57.6, 76], [79, 97.4]]) doubleRow(a, 431, b, 431, N, WHOLE, { gapP: 0.12 });
  aisle(-112, 112, 426.5, 428); aisle(-112, 112, 434, 435.6);

  // ---------- cloth sails on tall poles (a world rectangle; poles along its long sides) ----------
  function sail(x0, x1, z0, z1, h = 3.3) {
    const alongX = x1 - x0 > z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, ry = alongX ? Math.PI / 2 : 0, hw = (alongX ? z1 - z0 : x1 - x0) / 2, len = alongX ? x1 - x0 : z1 - z0, f = frame(cx, cz, ry);
    const np = Math.max(2, Math.ceil(len / 7.5) + 1), posts = [];
    for (const sx of [-1, 1]) for (let i = 0; i < np; i++) posts.push([sx * hw, -len / 2 + len * i / (np - 1)]);
    const pr = ([lx, lz]) => wrect(cx, cz, ry, lx - 0.09, lx + 0.09, lz - 0.09, lz + 0.09);
    if (posts.some(p => !free(pr(p), false))) { stats.sailsSkipped = (stats.sailsSkipped || 0) + 1; return false; }
    for (const p of posts) { B.woodDark.add(new THREE.CylinderGeometry(0.05, 0.065, h + 0.1, 4, 1, true), f(p[0], (h + 0.1) / 2, p[1])); collide(pr(p)); }
    const cols = R() < 0.4 ? pick(STRIPES) : [R() < 0.6 ? pick(UNDYED) : pick(DYES)], n = cols.length > 1 ? Math.round(hw * 2 / 0.7) : 1;
    for (let i = 0; i < n; i++) sheet(cloth, f, lerp(-hw - 0.1, hw + 0.1, i / n), lerp(-hw - 0.1, hw + 0.1, (i + 1) / n), -len / 2 - 0.1, h, len / 2 + 0.1, h, cols[i % cols.length], n > 1 ? 4 : 6, 0.3);
    return true;
  }

  // ---------- money-changers by the quay under two long sails: a row facing the quay and a staggered row facing it across
  // a narrow lane of customers; each banker with his scale, coins, counters and a strongbox, benches for those waiting ----------
  const bankSail = [sail(-28.4, -10.6, 427.4, 434.0), sail(14.6, 32.4, 427.4, 434.0)];
  function changer(x, zb, ry, sheltered) {
    const f = frame(x, zb, ry), bc = bronze.def();
    if (!free(wrect(x, zb, ry, -0.9, 0.9, 0.1, 1.9))) return;
    const side = [-1, 1].find(s => clearOf(wrect(x, zb, ry, s * 0.76 - 0.36, s * 0.76 + 0.36, 0.18, 0.72)));
    B.wood.add(box(1.4, 0.05, 0.7), f(0, 0.8, 1.2));
    for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.woodDark.add(box(0.05, 0.78, 0.05), f(a * 0.62, 0.39, 1.2 + b * 0.28));
    terra.add(P.stool, f(0, 0, 0.45), 0x7a5a3a);
    B.woodDark.add(box(0.5, 0.02, 0.34), f(-0.35, 0.835, 1.2));
    for (let k = 0; k < 6; k++) terra.add(P.ball, f(-0.35 + rr(-0.2, 0.2), 0.85, 1.2 + rr(-0.13, 0.13), 0, 0, 0, 0.35), 0xe0d6c0);
    for (let k = 0; k < 5; k++) { const n = 2 + (R() * 5 | 0), c = pick([0xc9a24a, 0xb8b8b0, 0x9a6a3a]), cx = rr(0, 0.5), cz = 1.2 + rr(-0.22, 0.22); terra.add(P.coin, f(cx, 0.825 + n * 0.004, cz, 0, 0, 0, new THREE.Vector3(1, n * 0.008, 1)), c); }
    bronze.add(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 4), f(0.45, 1.03, 1.45), bc); bronze.add(box(0.44, 0.015, 0.015), f(0.45, 1.24, 1.45), bc);
    for (const s of [-1, 1]) { bronze.add(P.phiale, f(0.45 + s * 0.2, 1.02, 1.45, 0, 0, 0, 0.55), bc); for (const d of [-1, 1]) bronze.add(new THREE.CylinderGeometry(0.003, 0.003, 0.22, 3), f(0.45 + s * 0.2 + d * 0.05, 1.13, 1.45), bc); }
    if (side) {   // the strongbox beside the stool: dark planks, a lid, two bronze bands, a bag of coin on top
      const sx = side * 0.76; B.woodDark.add(box(0.66, 0.4, 0.46), f(sx, 0.2, 0.45)); B.wood.add(box(0.7, 0.05, 0.5), f(sx, 0.425, 0.45));
      for (const t of [-0.2, 0.2]) bronze.add(box(0.035, 0.46, 0.52), f(sx + t, 0.225, 0.45), bc);
      cloth.add(P.sack, f(sx + rr(-0.1, 0.1), 0.45, 0.45, 0, R() * TAU, 0, 0.32), pick([0x7a3a4a, 0x8a6a48, 0x9c3f2c]));
      collide(wrect(x, zb, ry, sx - 0.35, sx + 0.35, 0.21, 0.69));
    } else B.woodDark.add(box(0.36, 0.22, 0.26), f(0.5, 0.11, 0.6));
    if (!sheltered && R() < 0.6) { const cols = awningCols(); for (const s of [-1, 1]) { post(f, s * 0.95, 0.1, 2.3, 0.04); post(f, s * 0.95, 1.9, 2.05, 0.04); } awning(f, -1.05, 1.05, 0.1, 2.3, 1.9, 2.05, cols); }
    collide(wrect(x, zb, ry, -0.75, 0.75, 0.85, 1.6));
    const v = wrect(x, zb, ry, 0, 0, 0.45, 0.45), q = wrect(x, zb, ry, 0.15, 0.15, 2.2, 2.2);
    layout.addPoi({ type: 'stall', x: v.minX, z: v.minZ, y: Y0, ry, r: 1.4, owner: 'agora', note: 'money-changer' });
    layout.addPoi({ type: 'gather', x: q.minX, z: q.minZ, y: Y0, r: 0.9, owner: 'agora', note: 'waiting to change coin' });
    stats.stalls++;
  }
  for (const x of [-27, -19.5, -12, 16, 23.5, 31]) changer(x, 429.9, S, bankSail[x < 0 ? 0 : 1]);
  for (const x of [-23.6, -15.4, 19.4, 27.6]) changer(x, 434.3, N, bankSail[x < 0 ? 0 : 1]);
  for (const x of [-23.25, -15.75, 19.75, 27.25]) if (bankSail[x < 0 ? 0 : 1]) woodBench(x, 428.45, S, 2.0, 'waiting at the bankers');
  // loads waiting for the ships at the lane mouths: amphorae stacked on their sides, sacks, crates
  function cargo(x0, x1, z0, z1) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = x1 - x0, d = z1 - z0, f = frame(cx, cz, S);
    if (!free({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, false)) return;
    const n = Math.min(5, Math.floor((w - 0.2) / 0.38));
    for (let layer = 0; layer < 3; layer++) for (let i = 0; i < n - layer; i++) amph(f, -w / 2 + 0.29 + (i + layer * 0.5) * 0.38, -d / 2 + 0.1 + (layer % 2) * 0.9, 0.19 + layer * 0.33, layer % 2 ? -Math.PI / 2 : Math.PI / 2, 1, undefined, true);
    for (let i = 0; i < 4; i++) cloth.add(P.sack, f(-w / 2 + 0.4 + i * 0.62 + rr(-0.05, 0.05), 0, 0.3 + rr(-0.1, 0.1), rr(-0.15, 0.15), R() * TAU, rr(-0.15, 0.15)), pick(UNDYED));
    for (let i = 0; i < 3; i++) B.wood.add(box(0.7, 0.5, 0.55), f(-w / 2 + 0.5 + (i === 2 ? 0.35 : i * 0.75), i === 2 ? 0.75 : 0.25, d / 2 - 0.45, 0, rr(-0.1, 0.1)));
    B.woodDark.add(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4, 1, true), f(w / 2 - 0.3, 0.55, d / 2 - 1.3, 0.25, 0, 0.1));
    collide({ minX: x0 + 0.05, maxX: x1 - 0.05, minZ: z0 + 0.05, maxZ: z1 - 0.05 });
    layout.addPoi({ type: 'work', x: cx, z: z0 - 0.6, y: Y0, ry: S, owner: 'agora', note: 'porters loading' });
  }
  cargo(-32.3, -29.1, 428.4, 434.2); cargo(33.4, 37.3, 428.4, 434.2);

  // ---------- the civic centre round the monument ----------
  // bema: a speaker's platform with two steps at the back, walkable
  if (clearOf({ minX: -20.7, maxX: -15.3, minZ: 393, maxZ: 398.2 })) {
    const bx = -18, bz = 396, w = 5, d = 3.6, h = 1.08, top = h + 0.14, st = top / 3;
    B.ashlar.add(box(w, h, d), mat(bx, Y0 + h / 2, bz));
    B.marble.add(box(w + 0.24, 0.14, d + 0.24), mat(bx, Y0 + h + 0.07, bz));
    for (let i = 0; i < 2; i++) B.grey.add(box(2.4, (i + 1) * st, 0.42), mat(bx, Y0 + (i + 1) * st / 2, bz - d / 2 - 0.21 - (1 - i) * 0.42));
    world.extraGround.push((x, z) => (x > bx - w / 2 - 0.12 && x < bx + w / 2 + 0.12 && z > bz - d / 2 - 0.84 && z < bz + d / 2 + 0.12) ? (z > bz - d / 2 - 0.08 ? Y0 + top : (Math.abs(x - bx) < 1.2 ? Y0 + (z > bz - d / 2 - 0.42 ? 2 : 1) * st : -Infinity)) : -Infinity);
    for (const r of [{ minX: bx - w / 2 - 0.12, maxX: bx - w / 2 + 0.25, minZ: bz - d / 2 - 0.12, maxZ: bz + d / 2 + 0.12 }, { minX: bx + w / 2 - 0.25, maxX: bx + w / 2 + 0.12, minZ: bz - d / 2 - 0.12, maxZ: bz + d / 2 + 0.12 }, { minX: bx - w / 2 - 0.12, maxX: bx + w / 2 + 0.12, minZ: bz + d / 2 - 0.25, maxZ: bz + d / 2 + 0.12 }]) collide(r);
    layout.addPoi({ type: 'view', x: bx, z: bz + 0.6, y: Y0 + top, ry: S, owner: 'agora', note: 'speaker on the bema' });
    layout.addPoi({ type: 'gather', x: bx + 1, z: bz + 7, y: Y0, r: 4.5, owner: 'agora', note: 'listening to the speaker' });
  }
  // two bronze honorific statues on marble bases
  for (const [sx, opt] of [[-25, { seed: 61, draped: 'full' }], [25, { seed: 62, draped: 'short', spear: true, shield: true }]]) {
    if (!clearOf({ minX: sx - 1.05, maxX: sx + 1.05, minZ: 407.95, maxZ: 410.05 })) continue;
    B.marble.add(rectSweep(1.6, 1.6, [{ o: 0.22, y: 0 }, { o: 0.22, y: 0.22, hard: true }, { o: 0.06, y: 0.36 }, { o: 0, y: 0.46, hard: true }, { o: 0, y: 2.0, hard: true }, { o: 0.1, y: 2.1 }, { o: 0.2, y: 2.24, hard: true }], { top: true }), mat(sx, Y0, 409));
    B.grey.add(box(1.0, 0.4, 0.04), mat(sx, Y0 + 1.45, 409.82)); for (let k = 0; k < 4; k++) terra.add(box(0.8, 0.018, 0.004), mat(sx, Y0 + 1.58 - k * 0.085, 409.843), 0x5e554c);
    bronze.add(figureGeometry(opt), mat(sx, Y0 + 2.24, 409, 0, sx < 0 ? 0.25 : -0.25, 0, 1.12), sx < 0 ? 0x8a5a30 : 0x80542e);
    { const c = bronze.list[bronze.list.length - 1], nn = c.attributes.normal, cc = c.attributes.color, pat = new THREE.Color(0x4f5236);   // green-brown patina under the folds
      for (let i = 0; i < cc.count; i++) { const t = clamp(-nn.getY(i) * 0.8 + 0.1, 0, 0.7); cc.setXYZ(i, lerp(cc.getX(i), pat.r, t), lerp(cc.getY(i), pat.g, t), lerp(cc.getZ(i), pat.b, t)); } }
    collide({ minX: sx - 1.05, maxX: sx + 1.05, minZ: 407.95, maxZ: 410.05 });
  }
  // honorific monuments along the promenade: groups of inscribed stelai and bronze tripods on tall bases
  function stelai(x0, z0, ry, n) {
    const r = wrect(x0, z0, ry, -(n - 1) * 0.55 - 0.4, (n - 1) * 0.55 + 0.4, -0.25, 0.25), f = frame(x0, z0, ry);
    if (!clearOf(r)) return;
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 1.1, h = rr(1.35, 1.75);
      B.grey.add(box(0.72, 0.26, 0.38), f(x, 0.13, 0));
      B.marble.add(box(0.5, h, 0.14), f(x, 0.26 + h / 2, 0)); B.marble.add(box(0.58, 0.12, 0.18), f(x, 0.32 + h, 0));
      for (let k = 0; k < 7; k++) terra.add(box(0.36, 0.014, 0.004), f(x, 0.26 + h - 0.22 - k * 0.07, 0.071), 0x6d6258);
    }
    collide(r);
  }
  function tripodBase(x, z) {
    const r = { minX: x - 0.72, maxX: x + 0.72, minZ: z - 0.72, maxZ: z + 0.72 };
    if (!clearOf(r)) return;
    B.marble.add(rectSweep(1.1, 1.1, [{ o: 0.18, y: 0 }, { o: 0.18, y: 0.2, hard: true }, { o: 0, y: 0.34, hard: true }, { o: 0, y: 1.72, hard: true }, { o: 0.08, y: 1.8 }, { o: 0.14, y: 1.92, hard: true }], { top: true }), mat(x, Y0, z));
    B.grey.add(box(0.8, 0.32, 0.03), mat(x, Y0 + 1.3, z + 0.565)); for (let k = 0; k < 3; k++) terra.add(box(0.62, 0.016, 0.004), mat(x, Y0 + 1.4 - k * 0.09, z + 0.582), 0x5e554c);
    const ty = Y0 + 1.92, bc = bronze.def(), leg = new THREE.Color(bc).multiplyScalar(0.72).getHex();
    for (let k = 0; k < 3; k++) { const a = k / 3 * TAU + 0.5; bronze.add(new THREE.CylinderGeometry(0.018, 0.024, 1.12, 6), mat(x + Math.cos(a) * 0.27, ty + 0.55, z + Math.sin(a) * 0.27, -Math.sin(a) * 0.1, 0, Math.cos(a) * 0.1), leg); }
    bronze.add(P.cauldron, mat(x, ty + 0.98, z, 0, 0, 0, 1.15), bc);
    for (const s of [-1, 1]) bronze.add(new THREE.TorusGeometry(0.1, 0.014, 3, 8), mat(x + s * 0.2, ty + 1.39, z), bc);
    collide(r);
  }
  stelai(-24, 391, S, 3); stelai(24, 391, S, 3); tripodBase(-10.5, 391.2); tripodBase(16.2, 391.2); tripodBase(34.4, 391.2);
  // sundial: a stone hemicyclium — a hollowed quarter-sphere opening to the south, hour lines inside, a bronze pin gnomon over it
  if (clearOf({ minX: 18.55, maxX: 19.45, minZ: 395.55, maxZ: 396.45 })) {
    const f = frame(19, 396, S), rs = 0.26, yt = 1.66, zs = 0.28;
    B.grey.add(box(0.8, 0.14, 0.8), f(0, 0.07, 0)); B.ashlar.add(box(0.5, 1.0, 0.5), f(0, 0.64, 0));
    B.marble.add(box(0.74, 0.24, 0.6), f(0, 1.26, 0));
    B.marble.add(box(0.7, yt - 1.38, zs), f(0, (yt + 1.38) / 2, -zs / 2));
    for (const s of [-1, 1]) B.marble.add(box(0.35 - rs, yt - 1.38, zs), f(s * (0.35 + rs) / 2, (yt + 1.38) / 2, zs / 2));
    const top = new THREE.Shape(); top.moveTo(-rs, -zs); top.lineTo(-rs, 0); top.lineTo(rs, 0); top.lineTo(rs, -zs); top.absarc(0, -zs, rs, 0, Math.PI, false);
    B.marble.add(new THREE.ShapeGeometry(top, 6).rotateX(-Math.PI / 2), f(0, yt, 0));
    const face = new THREE.Shape(); face.moveTo(-rs, 0); face.lineTo(-rs, -(yt - 1.38)); face.lineTo(rs, -(yt - 1.38)); face.lineTo(rs, 0); face.absarc(0, 0, rs, 0, -Math.PI, true);
    B.marble.add(new THREE.ShapeGeometry(face, 6), f(0, yt, zs));
    B.marble.add(flipped(new THREE.SphereGeometry(rs, 10, 5, Math.PI, Math.PI, Math.PI / 2, Math.PI / 2)), f(0, yt, zs));
    const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), pt = (th, ps) => new THREE.Vector3(Math.sin(th) * Math.sin(ps), Math.cos(th), -Math.sin(th) * Math.cos(ps)).multiplyScalar(rs - 0.004);
    for (let k = -3; k <= 3; k++) for (const [t0, t1] of [[1.85, 2.3], [2.3, 2.85]]) {
      const a = pt(t0, k * 0.36), b = pt(t1, k * 0.36), dir = b.clone().sub(a), mid = a.clone().add(b).multiplyScalar(0.5);
      q.setFromUnitVectors(up, dir.clone().normalize());
      terra.add(new THREE.CylinderGeometry(0.004, 0.004, dir.length(), 3, 1, true), f(mid.x, yt + mid.y, zs + mid.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(q)), 0x3a322a);
    }
    bronze.add(new THREE.CylinderGeometry(0.006, 0.006, zs, 4).rotateX(Math.PI / 2), f(0, yt + 0.004, zs / 2));
    collide(wrect(19, 396, S, -0.45, 0.45, -0.45, 0.45));
  }
  // the fountain: a long basin fed by two bronze lion-head spouts from a pier at its west end
  if (clearOf({ minX: -23, maxX: -14.9, minZ: 416, maxZ: 419.6 })) {
    const fx = -18.5, fz = 417.8, bw = 7, bd = 3.2, t = 0.34, h = 0.78, wy = Y0 + 0.62;
    B.grey.add(rectSweep(bw + 0.2, bd + 0.2, [{ o: 0.08, y: 0 }, { o: 0.08, y: 0.14, hard: true }, { o: 0, y: 0.2, hard: true }], {}), mat(fx, Y0, fz));
    for (const s of [-1, 1]) { B.grey.add(box(bw, h, t), mat(fx, Y0 + h / 2, fz + s * (bd / 2 - t / 2))); B.grey.add(box(t, h, bd - 2 * t), mat(fx + s * (bw / 2 - t / 2), Y0 + h / 2, fz)); }
    B.grey.add(box(bw - 2 * t, 0.1, bd - 2 * t), mat(fx, Y0 + 0.1, fz));
    const wg = new THREE.PlaneGeometry(bw - 2 * t, bd - 2 * t).rotateX(-Math.PI / 2); scaleUV(wg, (bw - 2 * t) / 6, (bd - 2 * t) / 6); water.add(wg, mat(fx, wy, fz));
    const px = fx - bw / 2 - 0.45;
    B.ashlar.add(box(0.9, 2.3, 2.2), mat(px, Y0 + 1.15, fz)); B.marble.add(box(1.1, 0.18, 2.4), mat(px, Y0 + 2.39, fz)); B.marble.add(box(0.95, 0.5, 0.95), mat(px, Y0 + 2.73, fz));
    const JET = 0xcfe0e6;
    for (const s of [-1, 1]) {
      const hx = px + 0.5, hy = Y0 + 1.52, sz = fz + s * 0.6, bc = bronze.def();
      bronze.add(new THREE.TorusGeometry(0.13, 0.06, 4, 10).rotateY(Math.PI / 2), mat(hx, hy, sz), bc);                       // mane
      bronze.add(ellipsoid(0.1, 0.12, 0.11, 7, 5), mat(hx + 0.05, hy, sz), bc);                                                 // face
      bronze.add(ellipsoid(0.085, 0.06, 0.07, 6, 4), mat(hx + 0.14, hy - 0.045, sz), bc);                                       // muzzle
      for (const e of [-1, 1]) bronze.add(new THREE.ConeGeometry(0.035, 0.08, 4), mat(hx + 0.02, hy + 0.13, sz + e * 0.08, e * 0.45, 0, 0), bc);
      bronze.add(new THREE.CylinderGeometry(0.02, 0.026, 0.12, 6, 1, true).rotateZ(Math.PI / 2), mat(hx + 0.24, hy - 0.07, sz), bc);  // spout
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(hx + 0.3, hy - 0.07, sz), new THREE.Vector3(hx + 0.62, hy - 0.1, sz), new THREE.Vector3(hx + 0.78, wy, sz));
      terra.add(new THREE.TubeGeometry(curve, 5, 0.011, 3, false), null, JET);
      terra.add(new THREE.TorusGeometry(0.11, 0.012, 2, 10).rotateX(Math.PI / 2), mat(hx + 0.78, wy + 0.004, sz), JET);
    }
    for (let k = 0; k < 3; k++) terra.add(P.hydria, mat(fx - 1.5 + k * 1.3 + rr(-0.2, 0.2), Y0, fz + bd / 2 + 0.45, 0, R() * TAU, 0, 1.15), clay());
    collide({ minX: px - 0.45, maxX: fx + bw / 2 + 0.1, minZ: fz - bd / 2 - 0.1, maxZ: fz + bd / 2 + 0.1 });
    layout.addPoi({ type: 'fountain', x: fx, z: fz, y: Y0, r: 3.2, owner: 'agora' });
    layout.addPoi({ type: 'gather', x: fx + 1, z: fz - 3.2, y: Y0, r: 2.5, owner: 'agora', note: 'by the fountain' });
  }
  // a well-head east of the monument, with a lifting frame
  if (clearOf({ minX: 16.95, maxX: 19.05, minZ: 406.5, maxZ: 408.1 })) {
    const wx = 18, wz = 407.3;
    B.marble.add(lth([[0.6, 0], [0.6, 0.12], [0.53, 0.2], [0.53, 0.68], [0.58, 0.76], [0.58, 0.84], [0.44, 0.84], [0.44, 0.32]], 14), mat(wx, Y0, wz));
    water.add(new THREE.CircleGeometry(0.45, 12).rotateX(-Math.PI / 2), mat(wx, Y0 + 0.34, wz));
    for (const s of [-1, 1]) B.woodDark.add(box(0.1, 2.1, 0.1), mat(wx + s * 0.78, Y0 + 1.05, wz));
    B.woodDark.add(box(1.76, 0.1, 0.1), mat(wx, Y0 + 2.08, wz)); B.woodDark.add(new THREE.CylinderGeometry(0.13, 0.13, 0.05, 8).rotateX(Math.PI / 2), mat(wx, Y0 + 1.9, wz));
    terra.add(new THREE.CylinderGeometry(0.008, 0.008, 1.45, 3, 1, true), mat(wx + 0.12, Y0 + 1.16, wz), ROPE[0]);
    terra.add(P.hydria, mat(wx + 0.12, Y0 + 0.36, wz, 0, 0.5, 0, 0.9), clay());
    terra.add(P.hydria, mat(wx - 0.25, Y0, wz + 0.82, 0, 2, 0, 1.1), clay());
    collide({ minX: wx - 0.9, maxX: wx + 0.9, minZ: wz - 0.65, maxZ: wz + 0.65 });
    layout.addPoi({ type: 'well', x: wx, z: wz, y: Y0, r: 1.5, owner: 'agora' });
  }
  // an altar of the agora gods, garlanded
  if (clearOf({ minX: 17.45, maxX: 20.55, minZ: 416.85, maxZ: 418.75 })) {
    const ax = 19, az = 417.8;
    B.marble.add(rectSweep(2.4, 1.2, [{ o: 0.3, y: 0 }, { o: 0.3, y: 0.2, hard: true }, { o: 0, y: 0.34, hard: true }, { o: 0, y: 0.98, hard: true }, { o: 0.12, y: 1.06 }, { o: 0.2, y: 1.18, hard: true }], { top: true }), mat(ax, Y0, az));
    for (const s of [-1, 1]) B.marble.add(new THREE.CylinderGeometry(0.14, 0.14, 1.6, 8).rotateX(Math.PI / 2), mat(ax + s * 1.12, Y0 + 1.3, az));
    for (let k = 0; k < 3; k++) terra.add(P.wreath, mat(ax - 0.6 + k * 0.6, Y0 + 0.72, az + 0.62, Math.PI / 2, 0, 0, 1.6), 0x55703a);
    terra.add(P.lowMound, mat(ax, Y0 + 1.2, az, 0, 0, 0, 0.9), 0x4a4038);
    collide({ minX: ax - 1.55, maxX: ax + 1.55, minZ: az - 0.95, maxZ: az + 0.95 });
    layout.addPoi({ type: 'altar', x: ax, z: az + 1.6, y: Y0, ry: N, r: 2.5, owner: 'agora' });
  }
  // a grove of plane trees with stone benches in the four quarters round the monument, and two by the quay
  {
    const TR = rng(77);
    for (const [x, z, benches] of [[-29, 395, [[0, -2.1, S], [2.1, 0, E]]], [29, 395, [[0, -2.1, S], [-2.1, 0, Wd]]], [-29.5, 418.5, [[0, -2.1, S], [0, 2.1, N]]], [29.5, 418.5, [[0, -2.1, S], [-2.1, 0, Wd]]],
      [-11.5, 400, [[0, 2.1, S]]], [15, 400.5, [[0, 2.1, S]]], [-11, 414.2, [[0, -2.1, N]]], [14.5, 414, [[0, -2.1, N]]], [-5, 431, [[0, 2.2, S]]], [5, 431, [[0, 2.2, S]]],
      [-57.5, 406.5, []], [77.5, 405.3, []]]) {
      const r = { minX: x - 0.7, maxX: x + 0.7, minZ: z - 0.7, maxZ: z + 0.7 };
      const g = planeTree(TR, 5.4 + TR() * 0.8);
      if (!clearOf(r)) continue;
      const m = mat(x, Y0 - 0.05, z, 0, TR() * TAU, 0);
      terra.add(g.trunk, m, 0x7d6a52); leaves.add(g.leaves, m);
      { const c = terra.list[terra.list.length - 1], pp = c.attributes.position, cc = c.attributes.color, pale = warm(0xb9ad8e), ph = TR() * TAU;   // plane bark: pale patches flaking off the brown
        for (let i = 0; i < pp.count; i++) { const px = pp.getX(i) - x, py = pp.getY(i) - Y0, pz = pp.getZ(i) - z, a = Math.atan2(pz, px), k = Math.sin(a + py * 0.9 + ph) + Math.sin(2 * a - py * 0.7 + ph * 2) + 0.5 * Math.sin(py * 1.3 + ph);
          const t = py > 0.3 && Math.hypot(px, pz) > 0.25 ? clamp((k + 0.2) * 0.9, 0, 0.8) : 0, d = 1 - 0.18 * clamp(-k * 0.6, 0, 1); cc.setXYZ(i, lerp(cc.getX(i) * d, pale.r, t), lerp(cc.getY(i) * d, pale.g, t), lerp(cc.getZ(i) * d, pale.b, t)); } }
      collide({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6 });
      for (const [dx, dz, ry] of benches) bench(x + dx, z + dz, ry, 2.4);
      if (benches.length) layout.addPoi({ type: 'gather', x: x + 2.4, z: z + 2.4, y: Y0, r: 2, owner: 'agora', note: 'in the shade of the plane tree' });
    }
  }
  layout.addPoi({ type: 'gather', x: -14, z: 426.2, y: Y0, r: 3, owner: 'agora', note: 'news from the ships' });
  layout.addPoi({ type: 'gather', x: 26, z: 402, y: Y0, r: 3, owner: 'agora', note: 'before the statues' });
  // an exedra (semicircular bench) facing the monument
  if (clearOf({ minX: -4.3, maxX: 4.3, minZ: 390.4, maxZ: 395.5 })) {
    const cx = 0, cz = 394.6, r = 3.4, n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * Math.PI, x = cx + Math.cos(a) * r, z = cz - Math.sin(a) * r, ry = a + Math.PI / 2, sl = Math.PI * r / n + 0.06;
      B.marble.add(box(sl, 0.44, 0.56), mat(x, Y0 + 0.22, z, 0, ry, 0));
      const bx = cx + Math.cos(a) * (r + 0.42), bz = cz - Math.sin(a) * (r + 0.42);
      B.marble.add(box(sl * (r + 0.42) / r, 0.95, 0.22), mat(bx, Y0 + 0.475, bz, 0, ry, 0));
      // two small boxes along the curve instead of one loose box, so the front of every seat stays reachable
      for (const da of [-0.25, 0.25]) { const aa = a + da * Math.PI / n, qx = cx + Math.cos(aa) * (r + 0.15), qz = cz - Math.sin(aa) * (r + 0.15); collide({ minX: qx - 0.27, maxX: qx + 0.27, minZ: qz - 0.27, maxZ: qz + 0.27 }); }
      layout.addPoi({ type: 'seat', x, z, y: Y0 + 0.45, ry: Math.atan2(-Math.cos(a), Math.sin(a)), owner: 'agora', note: 'exedra' });
    }
    B.grey.add(box(2 * r + 1.6, 0.08, 0.9), mat(cx, Y0 + 0.04, cz + 0.2));
  }
  // booths round the square: a row along the lane to the west, two by the east–west lane
  stallRow(-29.6, 396.3, -29.6, 415.8, Wd, ['wine', 'barber', 'water', 'scribe', 'garlands'], { gapP: 0, widths: [2.8, 3.0, 3.2], cycle: true });
  stall(-11, 418.6, S, 3.2, 'wine'); stall(24, 418.6, S, 3.0, 'scribe');
  // a wine garden under a sail east of the monument (benches face the open middle), barbers and a scribe under one to the west
  function woodBench(x, z, ry, len, note) {
    const f = frame(x, z, ry), r = wrect(x, z, ry, -len / 2, len / 2, -0.2, 0.2); if (!free(r, false)) return;
    B.wood.add(box(len, 0.05, 0.34), f(0, 0.43, 0)); for (const s of [-1, 1]) B.woodDark.add(box(0.05, 0.41, 0.3), f(s * (len / 2 - 0.15), 0.205, 0));
    collide(r); for (let t = -len / 2 + 0.4; t <= len / 2 - 0.39; t += 0.75) { const p = wrect(x, z, ry, t, t, 0.02, 0.02); layout.addPoi({ type: 'seat', x: p.minX, z: p.minZ, y: Y0 + 0.45, ry, owner: 'agora', note }); }
  }
  function sideTable(x, z) {
    const r = { minX: x - 0.32, maxX: x + 0.32, minZ: z - 0.27, maxZ: z + 0.27 }; if (!free(r, false)) return;
    const f = frame(x, z, 0); B.wood.add(box(0.6, 0.04, 0.5), f(0, 0.52, 0)); for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.woodDark.add(box(0.035, 0.5, 0.035), f(u * 0.26, 0.25, v * 0.21));
    terra.add(P.jug, f(rr(-0.15, 0.15), 0.54, rr(-0.1, 0.1), 0, R() * TAU), R() < 0.5 ? BLACK : clay()); for (let k = 0; k < 2; k++) terra.add(P.phiale, f(rr(-0.2, 0.2), 0.54, rr(-0.15, 0.15), 0, 0, 0, 0.6), BLACK);
    collide(r);
  }
  if (sail(22.4, 34.8, 399.4, 405.6, 3.1)) {
    for (const [z, ry] of [[400.1, S], [404.9, N]]) { woodBench(24.7, z, ry, 2.4, 'wine garden'); sideTable(26.9, z); woodBench(29.1, z, ry, 2.4, 'wine garden'); }
    stall(34.72, 402.5, Wd, 3.2, 'wine', { awning: false, keep: false });
    for (const z of [399.95, 405.05]) for (let k = 0; k < 3; k++) amph(frame(33.5 + k * 0.42, z, 0), 0, 0, 0.04, 0, rr(0.9, 1));
    collide({ minX: 33.2, maxX: 34.6, minZ: 399.7, maxZ: 400.2 }); collide({ minX: 33.2, maxX: 34.6, minZ: 404.8, maxZ: 405.3 });
    layout.addPoi({ type: 'gather', x: 27, z: 402.5, y: Y0, r: 2.2, owner: 'agora', note: 'drinking in the wine garden' });
  }
  if (sail(-28.9, -22.1, 399.2, 406.8, 3.1)) { stall(-28.72, 401.1, E, 3.0, 'barber', { awning: false, keep: false }); stall(-28.72, 404.8, E, 3.0, 'scribe', { awning: false, keep: false }); }
  for (const [a, b] of [[390.6, 404.4], [408.6, 420.9]]) { sail(-60.55, -54.45, a, b); sail(-74.5, -69.0, a, b); sail(-46.0, -40.5, a, b); sail(40.5, 44.2, a, b); }
  for (const [a, b] of [[394.8, 406.2], [409.8, 421]]) sail(-96.75, -90.65, a, b);
  for (const [a, b] of [[59.5, 75], [80.5, 96]]) { sail(a, b, 402.25, 408.35); sail(a, b, 416.0, 421.2); }
  // herms at the corner passages and where the lanes meet the quay
  for (const [x, z, ry] of [[-111.4, 388.2, S], [-105.8, 388.2, S], [105.8, 388.2, S], [111.4, 388.2, S], [-38.3, 436.6, S], [-31.7, 436.6, S], [51.7, 436.6, S], [58.3, 436.6, S]]) herm(x, z, ry);
  // donkeys tethered in the wider aisles
  donkey(-107, 399, E, true); donkey(-107, 415.5, Wd, false); donkey(106.2, 403, E, true); donkey(106.2, 432, Wd, true);
  // a stone water trough for the animals
  function trough(x, z, ry) {
    const r = wrect(x, z, ry, -1.0, 1.0, -0.35, 0.35), f = frame(x, z, ry), h = 0.55, t = 0.1;
    if (!free(r, false)) return;
    for (const s of [-1, 1]) { B.grey.add(box(2.0, h, t), f(0, h / 2, s * 0.3)); B.grey.add(box(t, h, 0.5), f(s * 0.95, h / 2, 0)); }
    B.grey.add(box(1.8, 0.14, 0.5), f(0, 0.07, 0));
    water.add(new THREE.PlaneGeometry(1.8, 0.5).rotateX(-Math.PI / 2), f(0, h - 0.09, 0));
    terra.add(P.hydria, f(pick([-1.2, 1.2]), 0, rr(-0.15, 0.15), 0, R() * TAU), clay());
    collide(r); const p = wrect(x, z, ry, 0, 0, -0.75, -0.75); layout.addPoi({ type: 'work', x: p.minX, z: p.minZ, y: Y0, ry: ry, owner: 'agora', note: 'watering the donkeys' });
  }
  // the bands before the side colonnades: troughs by the donkeys, benches and stelai facing the colonnade, 3 m kept clear along its steps
  trough(-108.2, 397.4, E); bench(-108.4, 404.5, Wd, 2.4); stelai(-108.3, 408.3, Wd, 2); bench(-108.4, 412.1, Wd, 2.4); trough(-108.2, 418.6, E);
  bench(108.0, 396.8, E, 2.4); trough(107.5, 402.8, Wd); trough(104.9, 432.3, E); bench(108.0, 429.5, E, 2.4);

  // ---------- inside the stoas: one continuous run along the back wall — benches under painted panels, shop counters,
  // amphora racks, looms, scribes' desks, stacked amphorae, pithoi ----------
  const pmat = pinakesMaterial(ctx);
  let lastPinax = -1;
  function pinakes(f, c, w, y0 = 2.25) {
    const n = Math.max(1, Math.floor(w / 1.7));
    for (let i = 0; i < n; i++) {
      let k = Math.floor(R() * (lastPinax < 0 ? 8 : 7)); if (lastPinax >= 0 && k >= lastPinax) k++; lastPinax = k;
      const x = c + (i - (n - 1) / 2) * (w / n), y = y0 + rr(0, 0.3), u0 = (k % 4) / 4, v1 = 1 - Math.floor(k / 4) / 2;
      B.woodDark.add(box(1.32, 1.0, 0.05), f(x, y, 0.025));
      const g = new THREE.PlaneGeometry(1.2, 0.9), uv = g.attributes.uv;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + uv.getX(j) * 0.25, v1 - 0.5 + uv.getY(j) * 0.5);
      pinax.add(g, f(x, y, 0.052));
      terra.add(P.nail, f(x, y + 0.78, 0.058), 0x2e2824);   // the nail, and a cord to both top corners
      for (const s of [-1, 1]) terra.add(P.cord, f(x + s * 0.31, y + 0.64, 0.056, 0, 0, -s * 0.424), 0x4e3c2a);
    }
  }
  const STOA_KINDS = ['bench', 'bench', 'bench', 'bench', 'counter', 'counter', 'rack', 'rack', 'loom', 'scribe', 'stack', 'pithoi'];
  const STOA_W = { bench: [3.0, 4.4], counter: [3.0, 3.8], rack: [2.2, 3.2], loom: [1.8, 2.2], scribe: [1.7, 2.1], stack: [1.8, 2.3], pithoi: [1.6, 2.2] };
  function stoaRun(ox, oz, ry, a, b, y, skip = []) {
    const f = frame(ox, oz, ry, y), rect = (c0, c1, z0, z1) => wrect(ox, oz, ry, c0, c1, z0, z1);
    const okR = r => clearOf({ minX: r.minX + 0.02, maxX: r.maxX - 0.02, minZ: r.minZ + 0.02, maxZ: r.maxZ - 0.02 });
    const at = p => rect(p[0], p[0], p[1], p[1]);
    let s = a + rrL(0.3, 0.8), prev = '';
    while (s < b - 1.6) {
      let kind = pickL(STOA_KINDS);
      if (kind === prev) kind = prev === 'bench' ? 'counter' : 'bench';
      const w = Math.min(b - s, rrL(...STOA_W[kind])), c = s + w / 2;
      if (w < STOA_W[kind][0] - 0.3) break;
      prev = kind; s += w + rrL(0.2, 0.45);
      if (skip.some(t => c - w / 2 < t + 1.4 && c + w / 2 > t - 1.4)) continue;
      if (kind === 'bench') {
        const r = rect(c - w / 2, c + w / 2, 0, 0.56); if (!okR(r)) continue;
        B.grey.add(box(w, 0.1, 0.5), f(c, 0.42, 0.29)); for (const t of [-1, 0, 1]) B.grey.add(box(0.16, 0.37, 0.42), f(c + t * (w / 2 - 0.3), 0.185, 0.29));
        collide(r); pinakes(f, c, w);
        for (let t = c - w / 2 + 0.45; t <= c + w / 2 - 0.44; t += 0.8) { const p = at([t, 0.3]); layout.addPoi({ type: 'bench', x: p.minX, z: p.minZ, y: y + 0.47, ry, owner: 'agora', note: 'stoa bench' }); }
      } else if (kind === 'counter') {
        const r1 = rect(c - w / 2, c + w / 2, 2.05, 2.78), r2 = rect(c - w / 2, c + w / 2, 0, 0.38); if (!okR(r1) || !okR(r2)) continue;
        B.wood.add(box(w, 0.06, 0.74), f(c, 0.95, 2.41)); B.woodDark.add(box(w - 0.08, 0.9, 0.6), f(c, 0.46, 2.4));
        terra.add(box(w - 0.3, 0.46, 0.02), f(c, 0.55, 2.715), pick([0x9c3f2c, 0x3a4c72, 0xb48a45, 0x7a3a4a, 0x6f7a4c]));
        B.wood.add(box(w - 0.2, 0.04, 0.32), f(c, 1.35, 0.17)); for (const t of [-1, 1]) B.woodDark.add(box(0.05, 0.22, 0.26), f(c + t * (w / 2 - 0.4), 1.22, 0.14));
        spread(w - 0.3, 0.9, x => terra.add(R() < 0.5 ? P.jug : pick(P.bowls), f(c + x, 1.37, 0.17, 0, R() * TAU, 0, rr(0.7, 0.9)), R() < 0.35 ? BLACK : clay()));
        const kind2 = pickL(['spices', 'bronze', 'pottery', 'leather', 'textiles', 'garlands', 'dairy', 'wine']);
        if (kind2 === 'textiles' || kind2 === 'leather') { pole(f, w - 0.4, 2.45, 0.1, 0.025, c); spread(w - 0.4, 0.62, x => sheet(cloth, f, c + x - 0.26, c + x + 0.26, 0.1, 2.44, 0.12, rr(1.5, 1.62), kind2 === 'leather' ? pick([0x9a6a44, 0x8e6a48, 0xa87a50]) : pick([...DYES, ...UNDYED]), 1, 0)); }
        else if (kind2 !== 'bronze' && kind2 !== 'garlands') { if (R() < 0.7) pinakes(f, c, w, 2.35); }
        else spread(w - 0.4, 0.7, x => kind2 === 'bronze' ? bronze.add(P.phiale, f(c + x, 2.1, 0.03, Math.PI / 2 - 0.08, 0, 0, 0.9)) : terra.add(P.wreath, f(c + x, 2.1, 0.06, Math.PI / 2), pick([0x55703a, 0x6a7a44])));
        GOODS[kind2]((lx, ly, lz, rx, ry2, rz, sc) => f(c + (lx || 0), (ly || 0) + 0.155, (lz || 0) + 0.93, rx, ry2, rz, sc), w - 0.1, 0.825, false, true);
        collide(r1); collide(r2);
        const p = at([c, 1.25]); layout.addPoi({ type: 'stall', x: p.minX, z: p.minZ, y, ry, r: 1.6, owner: 'agora', note: 'stoa shop: ' + kind2 });
        stats.stalls++;
      } else if (kind === 'rack') {
        const r = rect(c - w / 2, c + w / 2, 0, 1.05); if (!okR(r)) continue;
        for (const [yy, zz] of [[0.35, 0.95], [0.75, 0.75]]) B.woodDark.add(box(w, 0.06, 0.06), f(c, yy, zz));
        for (const t of [-1, 1]) B.woodDark.add(box(0.06, 0.8, 0.7), f(c + t * (w / 2 - 0.05), 0.4, 0.62));
        for (let t = c - w / 2 + 0.32; t <= c + w / 2 - 0.3; t += 0.72) amph(f, t, 0.55, 0.02, -0.26, rr(0.95, 1.05), undefined, true);
        collide(r); if (R() < 0.4) pinakes(f, c, w, 2.35);
      } else if (kind === 'loom') {
        const r = rect(c - w / 2, c + w / 2, 0, 0.62); if (!okR(r) || !okR(rect(c - 0.3, c + 0.3, 0.8, 1.2))) continue;
        for (const t of [-1, 1]) B.wood.add(box(0.08, 2.05, 0.08), f(c + t * (w / 2 - 0.1), 1.0, 0.32, -0.18));
        B.wood.add(box(w, 0.08, 0.1), f(c, 1.96, 0.15));
        sheet(cloth, f, c - w / 2 + 0.2, c + w / 2 - 0.2, 0.17, 1.9, 0.29, 1.2, pick(DYES), 1, 0);
        sheet(cloth, f, c - w / 2 + 0.2, c + w / 2 - 0.2, 0.29, 1.2, 0.38, 0.52, pick(UNDYED), 1, 0);
        B.woodDark.add(box(w - 0.3, 0.04, 0.04), f(c, 1.2, 0.31));
        for (let x = c - w / 2 + 0.28; x < c + w / 2 - 0.24; x += 0.15) terra.add(new THREE.ConeGeometry(0.035, 0.1, 4), f(x, 0.46, 0.4), clay());
        terra.add(P.stool, f(c + rr(-0.2, 0.2), 0, 1.0, 0, rr(-0.3, 0.3)), 0x7a5a3a);
        basketOf(f, c + w / 2 - 0.2, 0, 1.05, pick(UNDYED), 0.8, true);
        collide(r);
        const p = at([c, 1.0]); layout.addPoi({ type: 'work', x: p.minX, z: p.minZ, y, ry: ry + Math.PI, owner: 'agora', note: 'loom' });
      } else if (kind === 'scribe') {
        const r = rect(c - w / 2 + 0.1, c + w / 2 - 0.1, 1.72, 2.38), r0 = rect(c - w / 2, c + w / 2, 0, 0.5); if (!okR(r) || !okR(r0)) continue;
        B.wood.add(box(w - 0.2, 0.05, 0.62), f(c, 0.72, 2.05));
        for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.woodDark.add(box(0.04, 0.7, 0.04), f(c + u * (w / 2 - 0.2), 0.35, 2.05 + v * 0.26));
        GOODS.scribe((lx, ly, lz, rx, ry2, rz, sc) => f(c + (lx || 0), ly || 0, (lz || 0) + 0.6, rx, ry2, rz, sc), w - 0.4, 0.745, false, true);
        terra.add(P.stool, f(c, 0, 1.4, 0, R()), 0x7a5a3a); terra.add(P.stool, f(c + rr(-0.3, 0.3), 0, 2.8, 0, R()), 0x6a4a30);
        B.woodDark.add(box(0.6, 0.45, 0.4), f(c - w / 2 + 0.4, 0.225, 0.22)); B.woodDark.add(box(0.5, 0.35, 0.36), f(c + w / 2 - 0.35, 0.175, 0.2));
        collide(r); collide(r0); pinakes(f, c, w); s += 0.8;   // a gap beside the desk: the scribe's way in to his seat
        const p = at([c, 1.4]); layout.addPoi({ type: 'work', x: p.minX, z: p.minZ, y, ry, owner: 'agora', note: 'scribe' });
      } else if (kind === 'stack') {
        const r = rect(c - w / 2, c + w / 2, 0, 1.0); if (!okR(r)) continue;
        const n = Math.floor((w - 0.1) / 0.38);
        for (let layer = 0; layer < 2; layer++) for (let i = 0; i < n - layer; i++) amph(f, c - w / 2 + 0.24 + (i + layer * 0.5) * 0.38, 0.06, 0.19 + layer * 0.33, Math.PI / 2, 1, undefined, true);
        collide(r); if (R() < 0.5) pinakes(f, c, w, 2.4);
      } else {
        const r = rect(c - w / 2, c + w / 2, 0, 1.05); if (!okR(r)) continue;
        for (let i = 0, n = w > 1.9 ? 2 : 1; i < n; i++) {
          const x = c + (n > 1 ? (i - 0.5) * 0.9 : 0), sc = rr(0.6, 0.72);
          terra.add(P.pithos, f(x, 0.02, 0.55, 0, R() * TAU, 0, sc), clay());
          if (R() < 0.6) B.woodDark.add(new THREE.CylinderGeometry(0.24 * sc / 0.66, 0.24 * sc / 0.66, 0.03, 8), f(x, 0.02 + 1.3 * sc + 0.012, 0.55));
        }
        collide(r);
      }
    }
  }
  stoaRun(0, 371.9, S, -103.6, 103.6, YS, [-80, -35, 10, 55, 100]);
  for (const st of [westStoa, eastStoa]) if (st) stoaRun(st.face, 408, st.ry, -29.9, 29.9, YS, [(424 - 408) / -Math.sin(st.ry)]);

  // ---------- open ground people use (only where it really is open) ----------
  const openArea = (name, minX, maxX, minZ, maxZ, note) => {
    let n = 0, b = 0; for (let x = minX + 0.25; x < maxX; x += 0.5) for (let z = minZ + 0.25; z < maxZ; z += 0.5) { n++; if (world.blocked(x, z)) b++; }
    if (b / n <= 0.02) layout.addArea({ name, minX, maxX, minZ, maxZ, y: Y0, owner: 'agora', note }); else stats.areasDropped = (stats.areasDropped || 0) + 1;
  };
  for (const a of aisles) openArea('market aisle', ...a);
  for (const x of LANES_X) openArea('market lane', x - 2.2, x + 2.2, 389.5, 435.5);
  openArea('market lane', -112, 112, 421.8, 426.2); openArea('market lane', -99, 99, 385.2, 389.3, 'before the north stoa');
  openArea('civic square', -8, 8, 397.5, 401.5, 'before the exedra'); openArea('civic square', -21.8, -12.8, 401.6, 406.8, 'before the bema');
  openArea('civic square', 16.5, 20.8, 398.5, 405.8); openArea('civic square', -8, 7, 418.8, 421.3); openArea('civic square', -26.5, -13, 410.5, 415.2);

  // ---------- meshes ----------
  const own = (b, material, name, shadow = true) => { const m = b.mesh(material, shadow); if (m) { m.name = name; G.add(m); } };
  // every cloth surface exists from both sides, so a single-sided copy of the cloth material shades each side on its own
  const clothMat = M.cloth.clone(); clothMat.side = THREE.FrontSide; delete clothMat.userData.csm;
  // bronze: metal reflecting the sky (the scene's environment is only reachable once the city joins the scene).
  // The CSM lighting chunk main.js installs predates three's multi-scattering setup and never fills material.dfg /
  // multiScatteringCompensation, which zeroes every specular term; this material puts those lines back, or metal renders black.
  const DFG = `#ifdef STANDARD
  float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
  material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
  #if ( NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
    material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / ( material.dfg.x + material.dfg.y ) - 1.0 );
  #endif
#endif
`;
  const bronzeMat = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xffffff, metalness: 0.95, roughness: 0.32 });
  bronzeMat.onBeforeCompile = sh => { const ch = THREE.ShaderChunk.lights_fragment_begin; if (!ch.includes('material.dfg =') && ch.includes('IncidentLight directLight;')) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_begin>', ch.replace('IncidentLight directLight;', DFG + 'IncidentLight directLight;')); };
  bronzeMat.customProgramCacheKey = () => 'agora bronze with dfg';
  ctx.setupMaterial(bronzeMat);
  G.addEventListener('added', () => { const env = G.parent && G.parent.environment; if (env && !bronzeMat.envMap) { bronzeMat.envMap = env; bronzeMat.envMapIntensity = 0.34; bronzeMat.needsUpdate = true; } });
  own(cloth, ctx.setupMaterial(clothMat), 'agora cloth'); own(terra, M.terracotta, 'agora pots'); own(bronze, bronzeMat, 'agora bronze');
  own(leaves, M.leafPlane, 'agora trees'); own(water, M.sea, 'agora water', false); own(pinax, pmat, 'agora pinakes', false);
  layout.stats.agora = stats;
}
