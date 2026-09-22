// The town plan, shared by every town builder and by the people who live in it:
// the Hippodamian street grid, its blocks and lots, the houses actually built, sites reserved
// for public buildings, points of interest, open areas, and a street graph to walk on.
//
// Coordinates: metres, +X east, +Z south, y up. Block (k, m) lies between the N–S street
// lines k and k+1 and the E–W street lines m and m+1.
import { terrainHeight, slopeAt, inTerrace, SEA, flats } from './terrain.js';

export const streetX = k => 145 + 45 * k;                          // centre line of N–S street k
export const streetZ = m => 64 + 60 * m;                           // centre line of E–W street m
export const swX = k => (k === 0 ? 12 : 5);                        // its width (k = 0 is the avenue)
export const swZ = m => (m === 0 ? 16 : (m === -2 ? 8 : 5));       // m = 0 is the platea
export const GRID = { k0: -16, k1: 12, m0: -8, m1: 7, lotsX: 2, lotsZ: 3 };

const overlaps = (a, b, m = 0) => a.minX < b.maxX + m && a.maxX > b.minX - m && a.minZ < b.maxZ + m && a.maxZ > b.minZ - m;

export function createLayout() {
  const L = {
    blocks: [],     // {k, m, minX, maxX, minZ, maxZ, lots: [], houses: []}
    lots: [],       // {k, m, i, j, minX, maxX, minZ, maxZ, state: 'empty'|'void'|'house'|'reserved', house}
    houses: [],     // see city.js: {id, x, z, y, w, d, h, ry, two, gable, door:{x,z,nx,nz}, wing, minX..maxZ, lot}
    reserved: [],   // {minX, maxX, minZ, maxZ, owner, note}
    pois: [],       // {type, x, z, y?, ry?, r?, owner?, ...}  — see addPoi
    areas: [],      // {name, minX, maxX, minZ, maxZ, y?, owner?}  open ground people may wander in
    nodes: [],      // street intersections {id, k, m, x, z, y, edges: [edge]}
    edges: [],      // {id, a, b, axis:'x'|'z', line, width, main, open, houses, length}
    updaters: [],   // fn(dt, t, camera) called every frame by main.js
    stats: {},

    // Claim ground before the houses are placed. Houses whose footprint (wing included)
    // comes within 1 m of a reserved rectangle are not built. Call only from a feature's plan().
    reserve(rect, owner = '?', note = '') {
      const r = { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.maxZ, owner, note };
      for (const o of this.reserved) if (o.owner !== owner && overlaps(o, r)) console.warn(`[layout] reservation by ${owner} overlaps ${o.owner}`, r, o);
      this.reserved.push(r);
      return r;
    },
    isReserved(rect, margin = 0) { return this.reserved.some(r => overlaps(r, rect, margin)); },
    blockRect(k, m) {
      return { minX: streetX(k) + swX(k) / 2, maxX: streetX(k + 1) - swX(k + 1) / 2, minZ: streetZ(m) + swZ(m) / 2, maxZ: streetZ(m + 1) - swZ(m + 1) / 2 };
    },
    block(k, m) { return this.blocks.find(b => b.k === k && b.m === m) || null; },
    // Houses whose footprint touches the rectangle (+margin).
    housesIn(rect, margin = 0) { return this.houses.filter(h => overlaps(h, rect, margin)); },

    // Points of interest people can use. Conventional types:
    //  'stall'    vendor stands at (x,z) facing ry; customers gather in front
    //  'fountain' | 'well'   people queue / fill jars around radius r
    //  'bench' | 'seat'      sit at (x, y, z) facing ry
    //  'altar' | 'shrine'    stand facing it and pray
    //  'door'     a house or shop door (x,z) with outward normal (nx,nz)
    //  'work'     a work spot (kiln, loom, crane, net) facing ry
    //  'gather'   a spot where a knot of people stands chatting, radius r
    //  'view'     a spot to stand and look out, facing ry
    addPoi(p) { this.pois.push(p); return p; },
    addArea(a) { this.areas.push(a); return a; },
    nodeAt(k, m) { return this.nodes[this._nodeIndex(k, m)] || null; },
    _nodeIndex(k, m) { return (k - GRID.k0) * (GRID.m1 - GRID.m0 + 2) + (m - GRID.m0); },

    // Build the street graph once everything is placed (needs world.colliders).
    // An edge is closed where it runs into the walled precinct, a theatre/temple/palace terrace,
    // a collider (a stoa, a public building), a reserved site, the sea or a cliff.
    finalizeStreets(world) {
      this.nodes.length = 0; this.edges.length = 0;
      for (let k = GRID.k0; k <= GRID.k1 + 1; k++) for (let m = GRID.m0; m <= GRID.m1 + 1; m++) {
        const x = streetX(k), z = streetZ(m);
        this.nodes.push({ id: this.nodes.length, k, m, x, z, y: terrainHeight(x, z), edges: [] });
      }
      const special = flats.filter((f, i) => i === 1 || i === 3 || i === 4);   // theatre, Temple of Ares, palace
      const inSpecial = (x, z) => special.some(f => f.r ? Math.hypot(x - f.cx, z - f.cz) < f.r + 14 : (Math.abs(x - f.cx) < f.hw + 4 && Math.abs(z - f.cz) < f.hd + 4));
      const addEdge = (na, nb, axis, width, main) => {
        const e = { id: this.edges.length, a: na, b: nb, axis, width, main, open: true, houses: 0, length: Math.hypot(nb.x - na.x, nb.z - na.z) };
        const n = Math.max(2, Math.ceil(e.length / 2));
        for (let s = 0; s <= n; s++) {
          const t = s / n, x = na.x + (nb.x - na.x) * t, z = na.z + (nb.z - na.z) * t;
          if (inTerrace(x, z, 1.5) || inSpecial(x, z) || terrainHeight(x, z) < SEA + 1.5 || slopeAt(x, z) > 0.6 ||
              world.blocked(x, z) || this.isReserved({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5 })) { e.open = false; break; }
        }
        // houses in the blocks on either side
        const bl = axis === 'z'
          ? [this.block(na.k, Math.min(na.m, nb.m)), this.block(na.k - 1, Math.min(na.m, nb.m))]
          : [this.block(Math.min(na.k, nb.k), na.m), this.block(Math.min(na.k, nb.k), na.m - 1)];
        for (const b of bl) if (b) e.houses += b.houses.length;
        this.edges.push(e); na.edges.push(e); nb.edges.push(e);
      };
      for (let k = GRID.k0; k <= GRID.k1 + 1; k++) for (let m = GRID.m0; m <= GRID.m1 + 1; m++) {
        const n = this.nodeAt(k, m);
        if (m <= GRID.m1) addEdge(n, this.nodeAt(k, m + 1), 'z', swX(k), k === 0);   // along a N–S street
        if (k <= GRID.k1) addEdge(n, this.nodeAt(k + 1, m), 'x', swZ(m), m === 0);   // along an E–W street
      }
      this.stats.openEdges = this.edges.filter(e => e.open).length;
    },
  };
  return L;
}
