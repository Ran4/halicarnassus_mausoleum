// Weathering of the town's tiled roofs (M.roof): see weatherRoofs().
import { chainPatch } from './chain.js';

// Reads the per-vertex `weather` attribute (x = height above ground, y = below the piece's top (ridge), z = above its bottom (eaves),
// w = the house's wear 0..1); geometry without it reads (0,0,0,1) and must be left as it is.
// Per tile (aligned to roof_09's 11 columns × 6 courses per texture repeat): kiln variation, a scatter of darker old tiles, on some
// roofs a patch of newer brighter ones, and on neglected roofs (wear > ~0.75) missing or broken tiles showing the dark bedding and a batten.
// Over the roof (world-space noise): grey and orange lichen, pale dust settling low on the slope, dark runoff streaks down the channels,
// grime at the eaves. Tile-sized detail fades to its mean once a tile is only a few pixels across, so nothing shimmers from the air.
export function weatherRoofs(material, T) {
  return chainPatch(material, 'roofs1', (shader) => {
    shader.uniforms.roofNoise = { value: T.macro };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 weather; varying vec4 vRoofWeather; varying vec3 vRoofW; varying vec3 vRoofN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vRoofWeather = weather; vRoofW = (modelMatrix * vec4(transformed, 1.0)).xyz; vRoofN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D roofNoise; varying vec4 vRoofWeather; varying vec3 vRoofW; varying vec3 vRoofN;
        float roofRough = 0.0, roofFlat = 0.0;
        float roofHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (vRoofWeather.x != 0.0 || vRoofWeather.y != 0.0 || vRoofWeather.z != 0.0) {
          float wear = clamp(vRoofWeather.w, 0.0, 1.0);
          float slope = clamp(vRoofWeather.z / max(vRoofWeather.y + vRoofWeather.z, 0.05), 0.0, 1.0);   // 0 at the eaves .. 1 at the ridge
          // a seed per house (its wear and tile colour) and per slope, so no two roofs share a pattern. Rounded first: interpolating
          // a constant still wobbles in the last bit, and a hash turns that into per-pixel noise.
          vec3 q = floor(vec3(wear, vColor.rg) * 1024.0 + 0.5);
          float hs = roofHash(vec2(q.x * 0.731 + q.y * 0.137, q.z * 0.293 + q.x * 0.071));
          vec2 seed = vec2(hs * 311.0, fract(hs * 7.77) * 173.0) + floor(vRoofN.xz * 2.7 + 0.37) * vec2(57.0, 91.0);   // (+0.37: axis-aligned slopes have n = 0 or ±1, never near a step)

          // ---- the tile grid of the texture: 11 columns × 6 courses per repeat
          vec2 tc = vMapUv * vec2(11.0, 6.0) + vec2(0.484, 0.340);
          vec2 cell = floor(tc), lc = fract(tc), fw = fwidth(tc);
          float tileFade = 1.0 - smoothstep(0.12, 0.4, max(fw.x, fw.y));   // 1 while a tile is ≳ 3 px across
          float h1 = roofHash(cell + seed), h2 = roofHash(cell + seed + 17.3), h3 = roofHash(cell + seed + 41.9), h4 = roofHash(cell + seed + 71.3);
          vec3 col = diffuseColor.rgb;

          // kiln variation: each tile fired a little lighter or darker, more orange or browner
          vec3 fired = col * (0.9 + 0.2 * h1) * mix(vec3(0.95, 1.0, 1.06), vec3(1.06, 0.99, 0.9), h2);
          // darker old tiles, more of them the older the roof
          float isOld = step(h3, 0.05 + 0.12 * wear);
          fired *= mix(vec3(1.0), vec3(0.74, 0.72, 0.74), isOld);
          // some roofs have been patched: newer tiles, cleaner and a brighter orange-red, clustered where the repair was
          float patched = step(fract(hs * 13.1), 0.45) * (0.5 + 0.5 * wear);
          float repairZone = texture2D(roofNoise, vRoofW.xz * 0.05 + seed * 0.01).r;
          float isNew = step(1.0 - 0.1 * patched * smoothstep(0.45, 0.6, repairZone), h3);
          vec3 newTile = vec3(col.r * 1.45, col.r * 0.42, col.r * 0.16);
          fired = mix(fired, newTile, 0.8 * isNew);
          col = mix(col, fired, tileFade);

          // ---- lichen: pale grey-green crust and yellow-orange Xanthoria, blotchy; more on old roofs, never on the new tiles
          // (the noise texture is a narrow fbm, ~0.5 ± 0.05: z-scored below). Up close it is thresholded into blotches; once its texels
          // blur together under the pixel it becomes the blotches' mean coverage instead, so a roof looks equally lichened from the air.
          // Zones (~0.7 m) where it has taken hold, broken into ragged colonies by a fine octave (~0.1 m).
          vec2 lp = vRoofW.xz * 0.35 + seed * 0.013, sp = vRoofW.xz * 2.3 + seed * 0.021;
          float zz = (texture2D(roofNoise, lp).r - 0.5) / 0.052, sz = (texture2D(roofNoise, sp).r - 0.5) / 0.052;
          float n2 = texture2D(roofNoise, vRoofW.xz * 0.8 + 0.37).r, n3 = texture2D(roofNoise, vRoofW.xz * 0.09 + 0.71).r;
          vec2 zfw = fwidth(lp * 512.0), sfw = fwidth(sp * 512.0);
          float zFade = 1.0 - smoothstep(24.0, 64.0, max(zfw.x, zfw.y)), sFade = 1.0 - smoothstep(14.0, 44.0, max(sfw.x, sfw.y));   // the noise's base period is 128 texels
          float lz = zz * 0.75 + sz * 0.66 * sFade;
          float cover = mix(0.06, 0.32, wear);                                   // share of the roof crusted over
          float lth = mix(1.55, 0.47, wear);                                     // z-score giving about that share
          float lsoft = mix(0.9, 0.18, sFade);                                   // softer once the colonies blur away
          float lichen = mix(cover, smoothstep(lth - lsoft, lth + lsoft, lz), zFade) * (1.0 - isNew * tileFade);
          vec3 lichenCol = mix(vec3(0.105, 0.105, 0.09), vec3(0.17, 0.11, 0.045), smoothstep(0.52, 0.58, n3) * 0.7);
          col = mix(col, lichenCol, lichen * (0.35 + 0.2 * wear));

          // ---- dust settles low on the slope and collects at the eaves
          float nd = clamp((texture2D(roofNoise, vRoofW.xz * 0.06 + seed * 0.02).r - 0.5) / 0.12 + 0.5, 0.0, 1.0);
          float dust = (0.12 + 0.3 * wear) * (0.3 + 0.7 * (1.0 - slope)) * (0.4 + 0.6 * nd);
          col = mix(col, vec3(0.3, 0.23, 0.16), dust * 0.45);

          // ---- dark runoff streaks down the channels, from a random start down to the eaves
          float sh = roofHash(vec2(cell.x, seed.x + 3.1)), sStart = 0.35 + 0.65 * roofHash(vec2(cell.x, seed.y + 8.7));
          float pStreak = 0.12 + 0.35 * wear;
          float along = smoothstep(sStart, sStart - 0.35, slope);
          float across = 1.0 - smoothstep(0.08, 0.3 + 0.15 * n2, abs(lc.x - 0.5));
          float streakFine = step(sh, pStreak) * along * across * (0.6 + 0.4 * sh / pStreak);
          float streakMean = pStreak * 0.3 * clamp((0.75 - slope) * 1.5, 0.0, 1.0);
          float streak = mix(streakMean, streakFine, tileFade) * (0.25 + 0.35 * wear);
          col = mix(col * (1.0 - 0.5 * streak), vec3(0.025, 0.024, 0.02), 0.35 * streak);
          // grime along the lowest courses
          col *= 1.0 - (0.06 + 0.14 * wear) * smoothstep(0.14, 0.0, slope);

          // ---- missing and broken tiles on neglected roofs: the clay-and-reed bedding shows, crossed by a batten
          float pMiss = smoothstep(0.72, 0.95, wear) * 0.04;
          if (h4 < pMiss) {
            float kind = h4 / pMiss;
            float hole;
            if (kind < 0.55) hole = step(0.05, lc.x) * step(lc.x, 0.95);   // the whole tile gone
            else {                                                         // a corner broken off, ragged edge
              float edge = lc.y + (lc.x - 0.5) * (kind < 0.78 ? 0.9 : -0.9) + 0.06 * sin(lc.x * 31.0 + h1 * 40.0) + 0.04 * sin(lc.x * 71.0);
              hole = step(0.62, edge) * step(0.05, lc.x) * step(lc.x, 0.95);
            }
            vec3 bed = vec3(0.022, 0.016, 0.012) * (0.7 + 0.6 * n2);
            float batten = smoothstep(0.52, 0.55, lc.y) * smoothstep(0.7, 0.67, lc.y);
            bed = mix(bed, vec3(0.07, 0.045, 0.028), batten);
            vec3 below = diffuseColor.rgb * 0.55;                         // the head of the tile underneath, long covered
            vec3 holeCol = mix(below, bed, smoothstep(0.24, 0.3, lc.y));
            // shadowed rim where the neighbours overhang the gap
            float rim = min(min(lc.x - 0.05, 0.95 - lc.x), 1.0 - lc.y);
            holeCol *= 0.55 + 0.45 * smoothstep(0.0, 0.08, rim);
            hole *= tileFade;
            col = mix(col, holeCol, hole);
            roofRough = max(roofRough, hole);
            roofFlat = hole * 0.8;
          }
          // only on the tiled slopes: the eaves' edges and the undersides keep the plain texture
          float up = smoothstep(0.4, 0.7, normalize(vRoofN).y);
          diffuseColor.rgb = mix(diffuseColor.rgb, col, up);
          // and lose the tiles' relief there: seen edge-on, the normal map glints in vertical stripes like corrugated metal
          roofRough = mix(0.6, max(roofRough, max(lichen * 0.5, dust * 0.6)), up); roofFlat = mix(0.85, roofFlat, up);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 1.0, roofRough);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = normalize(mix(normal, nonPerturbedNormal, roofFlat));`);
  });
}
