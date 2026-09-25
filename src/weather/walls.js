// Weathering of the town's plastered walls (M.plaster): see weatherWalls().
import { chainPatch } from './chain.js';

// Reads the per-vertex `weather` attribute the city's wall bucket carries (see ColorBucket in util.js):
// x = height above the ground, y = below the piece's top (the eaves), z = above its bottom, w = the house's wear 0..1.
// Geometry without it reads (0,0,0,1) and is left as it is.
//
// What a few years of weather do to lime- or clay-plastered mud brick on a stone socle:
//  - rain splashing up off the socle and the street: a dirty, damp band along the foot of the wall with a tide mark
//  - water running off the eaves: grey streaks hanging from the top of the wall
//  - the limewash going yellow-grey in blotches; old repairs left as patches of a different tone
//  - on older walls the plaster cracks and falls away, above all low down, and shows the mud brick beneath
export function weatherWalls(material) {
  return chainPatch(material, 'walls1', (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 weather; varying vec4 vWtr; varying vec3 vWtrPos; varying vec3 vWtrN;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWtr = weather; vWtrPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWtrN = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vWtr; varying vec3 vWtrPos; varying vec3 vWtrN;
        float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float wNoise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y); }
        float wFbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * wNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wRough = 0.0;
        if (vWtr.x != 0.0 || vWtr.y != 0.0 || vWtr.z != 0.0) {
          vec3 wn = normalize(vWtrN);
          float wear = vWtr.w, ag = vWtr.x, bt = vWtr.y;
          float dist = length(vViewPosition);
          // a coordinate running along the wall; opposite faces and the two axes get different patterns
          float side = abs(wn.x) > abs(wn.z) ? sign(wn.x) * 1.0 : sign(wn.z) * 2.0;
          float u = (abs(wn.x) > abs(wn.z) ? vWtrPos.z : vWtrPos.x) + side * 41.3;
          vec2 q = vec2(u, vWtrPos.y);
          float vert = 1.0 - smoothstep(0.5, 0.8, abs(wn.y));          // 0 on tops and undersides
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.3, 0.55, 0.15));

          // limewash yellowing and greying in large blotches
          float blot = wFbm(q * 0.28 + side * 3.1);
          c = mix(c, c * vec3(0.92, 0.87, 0.78), clamp((0.25 + wear) * 1.2 * smoothstep(0.3, 0.75, blot), 0.0, 1.0));
          c *= 1.0 - (0.1 + 0.12 * wear) * wFbm(q * 1.7);                  // uneven coats, brushed on by hand
          // grimy from carts, animals and passers-by up to about head height
          c *= 1.0 - vert * (0.06 + 0.14 * wear) * (1.0 - smoothstep(0.6, 2.6, ag)) * (0.5 + wNoise(q * vec2(0.8, 0.4)));

          // old repairs: patches of a fresher or muddier plaster with trowelled edges
          vec2 pc = floor(vec2(u / 2.3, vWtrPos.y / 1.6)), pf = fract(vec2(u / 2.3, vWtrPos.y / 1.6));
          float ph = wHash(pc + side * 7.0);
          if (ph < 0.06 + 0.22 * wear) {
            vec2 lo = vec2(wHash(pc + 3.1), wHash(pc + 5.7)) * 0.35, hi = 1.0 - vec2(wHash(pc + 8.3), wHash(pc + 2.9)) * 0.35;
            float edge = 0.03 * (wNoise(q * 9.0) - 0.5);
            float inP = step(lo.x + edge, pf.x) * step(pf.x, hi.x + edge) * step(lo.y + edge, pf.y) * step(pf.y, hi.y + edge);
            c = mix(c, c * (wHash(pc + 1.3) < 0.5 ? vec3(1.05, 1.04, 1.02) : vec3(0.9, 0.86, 0.8)), inP * vert);
          }

          // rain run-off from the eaves: streaks hanging down from the top, heaviest right under it
          float streakN = wFbm(vec2(u * 2.6, vWtrPos.y * 0.12) + side);
          float streakLen = 0.6 + 2.6 * wear * (0.5 + streakN);
          float streak = (1.0 - smoothstep(0.0, streakLen, bt)) * smoothstep(0.38, 0.72, streakN);
          float eave = 1.0 - smoothstep(0.0, 0.35, bt);
          c *= 1.0 - vert * (0.3 * streak * (0.35 + wear) + 0.14 * eave);

          // splash and rising damp along the foot, with a tide mark
          float bandN = wFbm(vec2(u * 0.9, 1.7 + side));
          float band = 1.25 + 0.5 * wear + 1.0 * wear * bandN + 0.35 * (wNoise(vec2(u * 3.0, 3.0)) - 0.5);
          float damp = 1.0 - smoothstep(band - 0.45, band, ag);
          float tide = smoothstep(band - 0.2, band - 0.05, ag) * (1.0 - smoothstep(band - 0.05, band + 0.05, ag)) * wNoise(vec2(u * 1.3, 9.0));
          float splash = 1.0 - smoothstep(0.0, 0.55 + 0.4 * bandN, ag - 0.95);
          vec3 mud = vec3(0.6, 0.5, 0.4);
          c = mix(c, c * mud, vert * clamp(damp * (0.55 + 0.4 * wear) * (0.6 + 0.8 * wNoise(q * vec2(3.0, 1.2))), 0.0, 1.0));
          c = mix(c, c * vec3(0.78, 0.72, 0.64), vert * splash * (0.3 + 0.35 * wear) * smoothstep(0.3, 0.7, wNoise(q * 5.0)));
          c *= 1.0 - vert * tide * (0.1 + 0.12 * wear);

          // plaster fallen away to the mud brick: low on the wall above all, only on older houses
          float flakeN = wFbm(q * 0.75 + side * 5.3) + 0.12 * (wNoise(q * 11.0) - 0.5);
          float old = smoothstep(0.3, 1.0, wear);
          float lowBias = old * (0.14 * (1.0 - smoothstep(1.3, 3.0, ag)) + 0.05 * (1.0 - smoothstep(0.0, 1.2, bt)));
          float thr = 1.02 - old * 0.36;
          float fv = flakeN + lowBias;
          float flake = vert * smoothstep(thr, thr + 0.012, fv);
          float rim = vert * (smoothstep(thr - 0.035, thr, fv) - smoothstep(thr, thr + 0.012, fv));
          if (flake > 0.0 || rim > 0.0) {
            // mud-brick courses: bricks 45 cm long, 11 cm courses of clay mortar, every other course offset
            float row = floor(vWtrPos.y / 0.11);
            float bu = u / 0.45 + 0.5 * mod(row, 2.0);
            vec2 cell = vec2(floor(bu), row);
            vec2 f = vec2(fract(bu), fract(vWtrPos.y / 0.11));
            vec2 fw = max(fwidth(vec2(bu, vWtrPos.y / 0.11)), 1e-4);
            float jointU = 1.0 - smoothstep(0.0, 0.05 + fw.x, min(f.x, 1.0 - f.x));
            float jointV = 1.0 - smoothstep(0.0, 0.1 + fw.y, min(f.y, 1.0 - f.y));
            float joint = max(jointU, jointV) * (1.0 - smoothstep(40.0, 120.0, dist));
            float bh = wHash(cell + side * 13.0);
            vec3 brick = vec3(0.21, 0.13, 0.07) * (0.8 + 0.4 * bh) * (0.75 + 0.5 * wNoise(q * 14.0));   // linear: sun-dried clay and straw
            brick = mix(brick, vec3(0.15, 0.105, 0.07), joint * 0.7);
            c = mix(c, brick, flake);
            c *= 1.0 - 0.18 * rim;                                          // the broken edge of the plaster, in shadow
            wRough = flake;
          }

          // hairline cracks on older walls, running from the flakes out into the sound plaster
          float cn = wFbm(q * 0.55 + side * 9.1) + 0.06 * (wNoise(q * 7.0) - 0.5);   // jagged, not a smooth curve
          float cw = fwidth(cn) * 0.7 + 0.0015;
          float crack = (1.0 - smoothstep(0.0, cw, abs(cn - 0.5))) * smoothstep(0.6, 0.85, wear) * smoothstep(0.6, 0.72, wFbm(q * 0.3 + 2.0));
          c *= 1.0 - vert * crack * 0.22 * (1.0 - smoothstep(15.0, 45.0, dist)) * (1.0 - flake);

          diffuseColor.rgb = c;
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n        roughnessFactor = min(1.0, roughnessFactor + 0.2 * wRough);');
  });
}
