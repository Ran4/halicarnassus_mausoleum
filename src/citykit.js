// Small building-kit pieces shared by city.js and the town feature modules in src/cityfeatures/.
import * as THREE from 'three';
import { Bucket, box, rectSweep, tx, mat, lerp } from './util.js';
import { terrainHeight, inTerrace } from './terrain.js';

// hipped roof over a w×d footprint, eaves at y=0
export function hipRoof(w, d, overhang = 0.45, pitch = 0.3) {
  const s = Math.min(w, d) / 2;
  return rectSweep(w, d, [{ o: overhang, y: 0 }, { o: overhang, y: 0.1, hard: true }, { o: -s + 0.01, y: 0.1 + (s + overhang) * pitch }]);
}
export function gableRoof(w, d, overhang = 0.45, pitch = 0.3) { // ridge along the longer axis
  const along = w >= d ? w : d, across = w >= d ? d : w;
  const half = across / 2 + overhang, apex = half * pitch, L = Math.hypot(half, apex);
  const parts = [];
  for (const s of [-1, 1]) {
    const slab = box(along + 2 * overhang, 0.14, L + 0.1);
    parts.push(tx(slab, 0, apex / 2 + 0.07, s * half / 2, s * Math.atan2(apex, half), 0, 0));
  }
  const g = new Bucket(); for (const p of parts) g.add(p);
  let out = g.build();
  if (w < d) out.rotateY(Math.PI / 2);
  return out;
}
export function gableEnds(w, d, pitch = 0.3) {
  const along = w >= d ? w : d, across = w >= d ? d : w;
  const half = across / 2, apex = (half + 0.45) * pitch;
  const sh = new THREE.Shape([new THREE.Vector2(-half, 0), new THREE.Vector2(half, 0), new THREE.Vector2(0, apex)]);
  const b = new Bucket();
  for (const s of [-1, 1]) { const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false }); b.add(g, mat(s * along / 2 - s * 0.15, 0, 0, 0, Math.PI / 2, 0)); }
  let out = b.build(); if (w < d) out.rotateY(Math.PI / 2); return out;
}

// A strip following the terrain along a polyline (3 vertices across), UVs in metres.
// ground(x, z) defaults to the terrain (0 on the precinct terrace); lift raises it off the ground.
export function roadGeometry(pts, width, { lift = 0.07, step = 5, ground } = {}) {
  const gy = ground || ((x, z) => inTerrace(x, z) ? 0 : terrainHeight(x, z));
  const pos = [], uv = [], idx = [];
  let along = 0, row = 0;
  const addRow = (x, z, nx, nz) => {
    for (let c = 0; c < 3; c++) {
      const t = (c - 1) * width / 2, px = x + nx * t, pz = z + nz * t;
      pos.push(px, gy(px, pz) + lift, pz); uv.push(along, c * width / 2);
    }
    if (row > 0) { const a = (row - 1) * 3, b = row * 3; idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1); }   // counter-clockwise seen from above
    row++;
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(len / step), nx = -(z1 - z0) / len, nz = (x1 - x0) / len;
    for (let k = (i === 0 ? 0 : 1); k <= n; k++) { const t = k / n; addRow(lerp(x0, x1, t), lerp(z0, z1, t), nx, nz); along += len / n; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
