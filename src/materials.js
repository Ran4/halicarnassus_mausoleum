// All materials, built from Polyhaven PBR sets + procedural maps.
import * as THREE from 'three';
import { loadSet, makeMarble, makeFrieze, makeCoffer, makeMeander, makeLeafCard, makePalmette, makeCloud, makeMacroNoise, makeEggDart, makeCypressBody } from './textures.js';

export function createMaterials(loader) {
  const T = {};
  T.pave = loadSet(loader, 'granite_tile_04', '2k', 2.0);
  T.ashlar = loadSet(loader, 'medieval_blocks_03', '2k', 2.0);
  T.sandstone = loadSet(loader, 'large_sandstone_blocks_01', '1k', 3.0);
  T.plaster = loadSet(loader, 'painted_plaster_wall', '1k', 2.5);
  T.plasterGrey = loadSet(loader, 'plaster_grey_04', '1k', 2.0);
  T.dirt = loadSet(loader, 'dry_ground_rocks', '2k', 5.0);
  T.grass = loadSet(loader, 'aerial_grass_rock', '2k', 9.0);
  T.cliff = loadSet(loader, 'cliff_side', '1k', 7.0);
  T.roof = loadSet(loader, 'roof_09', '1k', 3.0);
  T.barkOlive = loadSet(loader, 'jolcham_oak_bark_01', '1k', 1.0, { aspect: 0.5 });
  T.barkPine = loadSet(loader, 'pine_bark', '1k', 1.5);
  T.wood = loadSet(loader, 'oak_wood_planks', '1k', 1.2);
  T.gravel = loadSet(loader, 'gravel_floor_02', '1k', 2.0);
  T.rubble = loadSet(loader, 'castle_wall_slates', '1k', 2.5);
  T.water = loader.load('textures/waternormals.jpg'); T.water.wrapS = T.water.wrapT = THREE.RepeatWrapping;

  T.marble = makeMarble({ size: 1024, seed: 7, tileM: 3.2, veinStrength: 0.7 });
  T.marbleStatue = makeMarble({ size: 512, seed: 19, tileM: 1.4, veinStrength: 0.25 });
  T.friezeRed = makeFrieze({ seed: 3, bg: '#742c22', tileM: 3.6, heightM: 0.9 });
  T.friezeBlue = makeFrieze({ seed: 8, bg: '#2f4a7a', tileM: 3.6, heightM: 0.75, density: 0.9 });
  T.coffer = makeCoffer({ tileM: 1.0 });
  T.meander = makeMeander();
  T.eggDart = makeEggDart();
  T.macro = makeMacroNoise();
  T.leafOlive = makeLeafCard('olive'); T.leafCypress = makeLeafCard('cypress'); T.leafPine = makeLeafCard('pine'); T.leafPlane = makeLeafCard('plane');
  T.palmette = makePalmette(); T.cloud = makeCloud(); T.cypressBody = makeCypressBody();

  const std = (t, extra = {}) => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap || null, roughness: 1, metalness: 0, ...extra });
  const M = { T };

  M.marble = std(T.marble, { color: 0xe9e5dd, envMapIntensity: 0.8, normalScale: new THREE.Vector2(0.45, 0.45) });
  M.marbleGrey = std(T.marble, { color: 0xc4c6c2, envMapIntensity: 0.7, normalScale: new THREE.Vector2(0.45, 0.45) });
  M.marbleStatue = std(T.marbleStatue, { color: 0xeee6d8, envMapIntensity: 0.8, normalScale: new THREE.Vector2(0.3, 0.3) });
  M.friezeRed = std(T.friezeRed, { normalScale: new THREE.Vector2(1, 1), envMapIntensity: 0.6 });
  M.friezeBlue = std(T.friezeBlue, { normalScale: new THREE.Vector2(1, 1), envMapIntensity: 0.6 });
  M.coffer = std(T.coffer, { roughness: 0.6, envMapIntensity: 0.5 });
  M.meander = new THREE.MeshStandardMaterial({ map: T.meander.map, roughness: 0.6 });
  M.eggDart = new THREE.MeshStandardMaterial({ map: T.marble.map, roughnessMap: T.marble.roughnessMap, normalMap: T.eggDart.normalMap, roughness: 1, normalScale: new THREE.Vector2(1, 1) });
  M.bronze = new THREE.MeshStandardMaterial({ color: 0x5e4327, metalness: 0.95, roughness: 0.4, envMapIntensity: 1.2 });
  M.gold = new THREE.MeshStandardMaterial({ color: 0xd9b34a, metalness: 1.0, roughness: 0.28, envMapIntensity: 1.4 });
  M.paintRed = new THREE.MeshStandardMaterial({ color: 0x8a3324, roughness: 0.75 });
  M.paintBlue = new THREE.MeshStandardMaterial({ color: 0x2f4f8f, roughness: 0.75 });
  M.pave = std(T.pave, { color: 0xf3ede0, envMapIntensity: 0.5 });
  M.ashlar = std(T.ashlar, { color: 0xd6cdbb, envMapIntensity: 0.4 });
  M.sandstone = std(T.sandstone, { color: 0xd8c9ad, envMapIntensity: 0.4 });
  M.plaster = std(T.plaster, { vertexColors: true, envMapIntensity: 0.4 });
  M.plasterGrey = std(T.plasterGrey, { color: 0xe8e2d4, envMapIntensity: 0.4 });
  M.roof = std(T.roof, { vertexColors: true, color: 0xffffff, envMapIntensity: 0.4 });
  M.wood = std(T.wood, { color: 0x9a7a55, envMapIntensity: 0.3 });
  M.woodDark = std(T.wood, { color: 0x5a3f28, envMapIntensity: 0.3 });
  M.gravel = std(T.gravel, { color: 0xcfc4b0, envMapIntensity: 0.3 });
  M.rubble = std(T.rubble, { color: 0xd0c6b2, envMapIntensity: 0.3 });
  M.barkOlive = std(T.barkOlive, { color: 0xb9b0a0 });
  M.barkPine = std(T.barkPine, { color: 0xa8875f });
  M.doorDark = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.9 });
  M.sand = std(T.gravel, { color: 0xe0d2b4, envMapIntensity: 0.3 });
  M.roadEarth = std(T.dirt, { color: 0xcbbba4, normalScale: new THREE.Vector2(0.45, 0.45), envMapIntensity: 0.35 });   // the country roads: trodden terrain dirt
  // vertex-coloured generics for the town's clutter (use with ColorBucket)
  M.cloth = std(T.plasterGrey, { vertexColors: true, color: 0xffffff, side: THREE.DoubleSide, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.3 });  // awnings, sails, laundry
  M.terracotta = std(T.plasterGrey, { vertexColors: true, color: 0xffffff, normalScale: new THREE.Vector2(0.5, 0.5), envMapIntensity: 0.35 });                  // pots, amphorae, tiles, brick
  M.painted = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0, envMapIntensity: 0.4 });                                       // painted wood, produce, anything plain
  M.foliage = new THREE.MeshStandardMaterial({ map: T.leafOlive, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true, envMapIntensity: 0.3 }); // leaf cards tinted per vertex

  const leaf = (t, color) => new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, color, envMapIntensity: 0.3 });
  M.leafOlive = leaf(T.leafOlive, 0xffffff); M.leafCypress = leaf(T.leafCypress, 0xffffff); M.leafPine = leaf(T.leafPine, 0xffffff); M.leafPlane = leaf(T.leafPlane, 0xffffff);
  M.cypressBody = new THREE.MeshStandardMaterial({ map: T.cypressBody, color: 0xffffff, roughness: 0.95, envMapIntensity: 0.3 });
  T.cypressBody.repeat.set(3, 1);
  M.palmette = new THREE.MeshStandardMaterial({ map: T.palmette, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
  M.cloud = new THREE.SpriteMaterial({ map: T.cloud, transparent: true, depthWrite: false, fog: false, opacity: 0.95 });

  addMacroVariation(M.pave, T.macro, 1 / 90, 0.22);
  addMacroVariation(M.ashlar, T.macro, 1 / 40, 0.15);
  addMacroVariation(M.plaster, T.macro, 1 / 25, 0.18);
  addMacroVariation(M.roof, T.macro, 1 / 30, 0.2);
  addMacroVariation(M.roadEarth, T.macro, 1 / 45, 0.22);

  M.terrain = makeTerrainMaterial(T);
  M.sea = makeSeaMaterial(T);
  return M;
}

// Multiplies the diffuse map by a low-frequency world-space noise, hiding texture tiling on big surfaces.
export function addMacroVariation(material, macroTex, scale, amount) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.macroMap = { value: macroTex };
    shader.uniforms.macroScale = { value: scale };
    shader.uniforms.macroAmount = { value: amount };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMacroPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMacroPos; uniform sampler2D macroMap; uniform float macroScale; uniform float macroAmount;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float macroV = texture2D(macroMap, vMacroPos.xz * macroScale).r;
        float macroV2 = texture2D(macroMap, vMacroPos.xz * macroScale * 3.7 + 0.31).r;
        diffuseColor.rgb *= (1.0 - macroAmount) + 2.0 * macroAmount * (macroV * 0.65 + macroV2 * 0.35);`);
  };
  material.customProgramCacheKey = () => 'macro' + scale + amount;
  return material;
}

// Three-way splat (dirt / grass / cliff) driven by a per-vertex `splat` attribute; UVs in world XZ.
function makeTerrainMaterial(T) {
  const m = new THREE.MeshStandardMaterial({ map: T.dirt.map, normalMap: T.dirt.normalMap, roughnessMap: T.dirt.roughnessMap, roughness: 1, metalness: 0, color: 0xffffff, envMapIntensity: 0.35, normalScale: new THREE.Vector2(0.8, 0.8) });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      grassMap: { value: T.grass.map }, grassNormal: { value: T.grass.normalMap },
      cliffMap: { value: T.cliff.map }, cliffNormal: { value: T.cliff.normalMap },
      macroMap: { value: T.macro },
      uvDirt: { value: 1 / T.dirt.sizeM }, uvGrass: { value: 1 / T.grass.sizeM }, uvCliff: { value: 1 / T.cliff.sizeM },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 splat; varying vec3 vSplat; varying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSplat = splat; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSplat; varying vec3 vWPos;
        uniform sampler2D grassMap, grassNormal, cliffMap, cliffNormal, macroMap; uniform float uvDirt, uvGrass, uvCliff;
        vec2 uvD, uvG, uvC;`)
      .replace('#include <map_fragment>', `
        uvD = vWPos.xz * uvDirt; uvG = vWPos.xz * uvGrass; uvC = vWPos.xz * uvCliff;
        vec4 cD = texture2D(map, uvD); vec4 cG = texture2D(grassMap, uvG); vec4 cC = texture2D(cliffMap, uvC);
        // detail layer breaks up the ground close to the camera
        vec4 cD2 = texture2D(map, uvD * 4.3 + 0.17);
        cD.rgb = mix(cD.rgb, cD.rgb * (0.6 + 0.8 * cD2.rgb), 0.35);
        cD.rgb *= vec3(0.93, 0.86, 0.76);
        cG.rgb *= vec3(0.9, 1.0, 0.8);
        vec4 c = cD * vSplat.x + cG * vSplat.y + cC * vSplat.z;
        float macroV = texture2D(macroMap, vWPos.xz * 0.0035).r;
        float macroV2 = texture2D(macroMap, vWPos.xz * 0.02 + 0.5).r;
        c.rgb *= 0.6 + 0.5 * macroV + 0.32 * macroV2;
        diffuseColor *= c;`)
      .replace('vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );', 'vec4 texelRoughness = texture2D( roughnessMap, uvD );')
      .replace('#include <normal_fragment_maps>', `
        vec3 nD = texture2D(normalMap, uvD).xyz; vec3 nG = texture2D(grassNormal, uvG).xyz; vec3 nC = texture2D(cliffNormal, uvC).xyz;
        vec3 mapN = (nD * vSplat.x + nG * vSplat.y + nC * vSplat.z) * 2.0 - 1.0;
        mapN.xy *= normalScale;
        normal = normalize( tbn * mapN );`);
  };
  m.customProgramCacheKey = () => 'terrain';
  return m;
}

function makeSeaMaterial(T) {
  const m = new THREE.MeshStandardMaterial({ color: 0x0d3550, roughness: 0.16, metalness: 0.0, normalMap: T.water, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.0 });
  m.userData.time = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = m.userData.time;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <normal_fragment_maps>', `
        vec2 uv1 = vNormalMapUv * 1.0 + vec2(uTime * 0.018, uTime * 0.011);
        vec2 uv2 = vNormalMapUv * 0.31 + vec2(-uTime * 0.009, uTime * 0.014);
        vec2 uv3 = vNormalMapUv * 3.1 + vec2(uTime * 0.03, -uTime * 0.02);
        vec3 n1 = texture2D(normalMap, uv1).xyz * 2.0 - 1.0; vec3 n2 = texture2D(normalMap, uv2).xyz * 2.0 - 1.0; vec3 n3 = texture2D(normalMap, uv3).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(vec3(n1.xy + n2.xy * 1.2 + n3.xy * 0.5, n1.z + n2.z + n3.z));
        float dist = length(vViewPosition);
        mapN.xy *= normalScale * clamp(1.4 - dist / 1800.0, 0.08, 1.0);
        normal = normalize( tbn * mapN );`);
  };
  m.customProgramCacheKey = () => 'sea';
  return m;
}
