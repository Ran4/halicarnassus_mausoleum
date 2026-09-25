// Town features plug into buildCity() (src/city.js) in two stages:
//
//   plan(ctx)   runs before any house is placed. Claim ground with ctx.layout.reserve(rect, name);
//               houses touching a reservation are simply not built. Nothing else should happen here.
//   build(ctx)  runs after the houses, stoas, harbour, theatre, temple, palace, walls and roads exist.
//
// ctx = {
//   M          materials (src/materials.js) — already set up for the cascaded shadow maps
//   world      { colliders: [{minX,maxX,minZ,maxZ}], extraGround: [fn(x,z)→y|-Infinity], groundHeight(x,z), blocked(x,z) }
//   layout     src/layout.js — blocks, lots, houses, reserved, roads, areas, pois, updaters
//   B          the city's shared buckets (merged into one mesh per material at the end — cheapest to draw):
//              walls (ColorBucket, M.plaster), roofs (ColorBucket, M.roof), socles (M.sandstone), doors (M.doorDark: openings, voids),
//              doorWood (ColorBucket, M.doorWood: plank door leaves — plankUV() and doorColor() in city.js),
//              marble, grey (M.marbleGrey), ashlar, pave, wood, woodDark, canvas (M.sand), egg (M.eggDart),
//              statue (M.marbleStatue), gravel
//   G          the city THREE.Group — add your own meshes here when a shared bucket does not fit
//   setupMaterial(material)  call on any material you create yourself (patches it for the CSM shadows)
//   kit        { stoa, ship, hipRoof, gableRoof, gableEnds, roadGeometry }
// }
//
// Animated things push fn(dt, t, camera) onto ctx.layout.updaters.
// Each feature uses its own rng(seed) from util.js — never Math.random() — so the town is the same every load.
import * as civic from './civic.js';
import * as agora from './agora.js';
import * as harbour from './harbour.js';
import * as industry from './industry.js';
import * as outskirts from './outskirts.js';
import * as residential from './residential.js';
import * as streets from './streets.js';
import * as disrepair from './disrepair.js';

export const FEATURES = [civic, agora, harbour, industry, outskirts, residential, streets, disrepair];
