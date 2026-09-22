import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSM } from 'three/addons/csm/CSM.js';
import { createMaterials } from './materials.js';
import { buildMausoleum, mausoleumGround, mausoleumColliders, MZ } from './mausoleum.js';
import { buildTerrainMesh, terrainHeight, inTerrace } from './terrain.js';
import { buildSky, buildSea, buildClouds, buildTemenos, buildVegetation, buildSmoke } from './environment.js';
import { buildCity } from './city.js';
import { Player } from './player.js';
import { buildPeople } from './people.js';

const overlay = document.getElementById('overlay'), startEl = document.getElementById('start'), bar = document.querySelector('#progress > div'), hud = document.getElementById('hud');
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
const status = (t, p) => { startEl.textContent = t; if (p !== undefined) bar.style.width = (p * 100).toFixed(0) + '%'; };

// ---------- renderer / scene ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  status('WebGL is not available in this browser. Enable hardware acceleration (chrome://settings/system, chrome://flags) or open the page in another browser.', 1);
  document.querySelector('.keys').style.display = 'none';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.64;
renderer.info.autoReset = false;   // __stats reports the whole frame (shadow cascades + main + GTAO), reset in animate()
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc5d3e2, 0.00040);
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.25, 16000);

// sun from the south-east, mid-morning; cascaded shadow maps so the whole city is shadowed
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 38), THREE.MathUtils.degToRad(52));
const csm = new CSM({ maxFar: 1500, cascades: 3, mode: 'practical', parent: scene, shadowMapSize: 4096, lightDirection: sunDir.clone().negate(), camera, lightIntensity: 4.4, lightNear: 1, lightFar: 4000, lightMargin: 300, shadowBias: -0.00015 });
csm.fade = true;
// CSM replaces the lights chunk with a copy older than r186 that never sets material.dfg / multiScatteringCompensation,
// which zeroes every standard material's specular (no sun highlights, no environment reflection, black metals).
// Put r186's block back in. ?legacyspec=1 renders the old way for comparison.
if (!new URLSearchParams(location.search).has('legacyspec') && !THREE.ShaderChunk.lights_fragment_begin.includes('material.dfg')) {
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace('IncidentLight directLight;', `#ifdef STANDARD
	float dotNVms = saturate( dot( geometryNormal, geometryViewDir ) );
	material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms ) ).rg;
	#if ( NUM_SUN_LIGHTS > 0 || NUM_DIR_LIGHTS > 0 || NUM_POINT_LIGHTS > 0 || NUM_SPOT_LIGHTS > 0 )
		float EssMs = material.dfg.x + material.dfg.y;
		material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs - 1.0 );
	#endif
#endif
IncidentLight directLight;`);
}
for (const l of csm.lights) { l.color.set(0xfff2e0); l.shadow.normalBias = 0.05; l.shadow.radius = 2; }
const hemi = new THREE.HemisphereLight(0xa9c4ea, 0x8c7a5e, 0.36);
scene.add(hemi);

// ---------- world (collision / ground) ----------
const world = {
  colliders: [], extraGround: [],
  groundHeight(x, z) {
    let h = inTerrace(x, z) ? mausoleumGround(x, z) : terrainHeight(x, z);
    for (const f of this.extraGround) { const v = f(x, z); if (v > h) h = v; }
    return h;
  },
  // colliders are indexed in a 16 m grid, rebuilt whenever the list has grown (people query this a lot)
  _grid: null, _gridN: -1,
  blocked(x, z) {
    if (this._gridN !== this.colliders.length) {
      this._grid = new Map(); this._gridN = this.colliders.length;
      for (const c of this.colliders) for (let i = Math.floor(c.minX / 16); i <= Math.floor(c.maxX / 16); i++) for (let j = Math.floor(c.minZ / 16); j <= Math.floor(c.maxZ / 16); j++) {
        const k = i * 4096 + j; let l = this._grid.get(k); if (!l) this._grid.set(k, l = []); l.push(c);
      }
    }
    const l = this._grid.get(Math.floor(x / 16) * 4096 + Math.floor(z / 16));
    if (l) for (const c of l) if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
    return false;
  },
};
world.colliders.push(...mausoleumColliders);

// ---------- build ----------
let composer, gtao, player, seaMat, smoke, clouds, city, people;
const timer = new THREE.Timer();
let useAO = true;

async function build() {
  status('preparing textures…', 0.02);
  const manager = new THREE.LoadingManager();
  let texDone = 0, texTotal = 1;
  manager.onProgress = (url, loaded, total) => { texDone = loaded; texTotal = total; };
  const loader = new THREE.TextureLoader(manager);
  await nextFrame();
  const M = createMaterials(loader);
  // CSM patches the shader; keep any onBeforeCompile the material already has
  world.setupMaterial = (m) => {
    if (!m || !m.isMeshStandardMaterial || m.userData.csm) return m;
    const prev = m.onBeforeCompile; csm.setupMaterial(m); const hook = m.onBeforeCompile;
    m.onBeforeCompile = (shader, r) => { if (prev) prev(shader, r); hook(shader, r); };
    m.userData.csm = true;
    return m;
  };
  for (const m of Object.values(M)) world.setupMaterial(m);
  seaMat = M.sea;
  await nextFrame();

  status('lighting the sky…', 0.12);
  const { envMap } = buildSky(renderer, scene, sunDir);
  scene.environment = envMap;
  scene.environmentIntensity = 0.32;
  await nextFrame();

  status('raising the Mausoleum…', 0.2);
  const mausoleum = buildMausoleum(M);
  scene.add(mausoleum);
  await nextFrame();

  status('shaping the land…', 0.42);
  scene.add(buildTerrainMesh(M.terrain));
  scene.add(buildSea(M));
  clouds = buildClouds(M); scene.add(clouds);
  await nextFrame();

  status('laying out the precinct…', 0.55);
  scene.add(buildTemenos(M, world));
  smoke = buildSmoke(M, world.altar); scene.add(smoke);
  await nextFrame();

  status('building Halicarnassus…', 0.68);
  city = buildCity(M, world);
  scene.add(city);
  window.__layout = world.layout;
  await nextFrame();

  status('planting the groves…', 0.84);
  scene.add(buildVegetation(M, world));
  await nextFrame();

  // people: buildPeople(ctx) → { group, count, update(dt, t, camera, player) }.
  // It may set world.dynamicBlocked(x, z, fromX, fromZ) → bool to stop the player walking through someone.
  status('filling the streets…', 0.88);
  // ?people=0 leaves the town empty (performance A/B)
  people = new URLSearchParams(location.search).get('people') === '0' ? { group: null, count: 0, update() {}, debug: () => ({ count: 0 }) }
    : buildPeople({ M, world, layout: world.layout, scene, camera, renderer, setupMaterial: world.setupMaterial });
  if (people.group) scene.add(people.group);
  await nextFrame();

  // wait for texture files
  status('loading textures…', 0.92);
  while (texDone < texTotal) { await nextFrame(); status(`loading textures… ${texDone}/${texTotal}`, 0.92 + 0.07 * texDone / texTotal); }

  // post-processing (MSAA target + GTAO)
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { samples: 4, type: THREE.HalfFloatType });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  gtao = new GTAOPass(scene, camera, size.x, size.y);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.2, thickness: 1.0, scale: 1.1, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.9;
  // GTAO renders the scene with an override material that ignores alphaTest: sprites (clouds, smoke) and leaf cards would be
  // drawn as solid quads there (pale halos around foliage), so they stay out of its pre-pass
  const origOverride = gtao._overrideVisibility.bind(gtao);
  gtao._overrideVisibility = function () { origOverride(); this.scene.traverse(o => { if (o.visible && (o.isSprite || (o.isMesh && o.material && o.material.alphaTest > 0))) { o.visible = false; this._visibilityCache.push(o); } }); people.gtaoBegin?.(); };
  // the people animate in their vertex shader: they draw the normal pass with their own (animated) normal material
  const origRestore = gtao._restoreVisibility.bind(gtao);
  gtao._restoreVisibility = function () { origRestore(); people.gtaoEnd?.(); };
  gtao.enabled = useAO;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());

  // player: spawn at the east propylon, facing the tomb
  camera.position.set(112, 1.7, 0);
  camera.rotation.set(0.1, Math.PI / 2, 0, 'YXZ');
  player = new Player(camera, renderer.domElement, world);
  player.onFlyChange = f => { hud.dataset.mode = f ? 'flying' : 'walking'; };

  // ?shot=1&pos=x,y,z&yaw=deg&pitch=deg&noao=1 → automated screenshots without pointer lock
  const q = new URLSearchParams(location.search);
  if (q.has('pos')) { const [x, y, z] = q.get('pos').split(',').map(Number); camera.position.set(x, y, z); }
  if (q.has('yaw')) camera.rotation.y = THREE.MathUtils.degToRad(Number(q.get('yaw')));
  if (q.has('pitch')) camera.rotation.x = THREE.MathUtils.degToRad(Number(q.get('pitch')));
  if (q.has('noao')) { useAO = false; gtao.enabled = false; }
  if (q.has('shot')) { overlay.classList.add('hidden'); hud.style.display = 'none'; document.getElementById('crosshair').style.display = 'none'; player.fly = true; }
  window.__setView = (x, y, z, yawDeg, pitchDeg) => { camera.position.set(x, y, z); camera.rotation.set(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ'); };
  let sceneTris = 0; scene.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; sceneTris += o.isInstancedMesh ? n * o.count : n; } });
  window.__stats = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, sceneTris, geoms: renderer.info.memory.geometries, tex: renderer.info.memory.textures, colliders: world.colliders.length, houses: city.userData.houseCount, pois: world.layout.pois.length, openEdges: world.layout.stats.openEdges, people: people ? people.count : 0 });
  status('compiling shaders…', 0.99);
  try { await renderer.compileAsync(scene, camera); } catch (e) { console.warn('compileAsync', e); }
  status('click to enter', 1);
  overlay.addEventListener('click', () => player.lock());
  player.controls.addEventListener('lock', () => overlay.classList.add('hidden'));
  player.controls.addEventListener('unlock', () => { overlay.classList.remove('hidden'); status('click to continue', 1); });
  document.addEventListener('keydown', e => { if (e.code === 'KeyO') { useAO = !useAO; gtao.enabled = useAO; } });
  window.__people = people; window.__world = world;
  window.__csm = csm; window.__scene = scene; window.__camera = camera; window.__player = player; window.__renderer = renderer;
  renderer.setAnimationLoop(animate);
}

// ---------- frame ----------
let hudT = 0, frames = 0, fps = 0;
function animate() {
  timer.update(); const dt = timer.getDelta(), t = timer.getElapsed();
  if (player) player.update(dt);
  camera.updateMatrixWorld();
  csm.update();
  if (seaMat) seaMat.userData.time.value = t;
  if (smoke) smoke.userData.update(t);
  if (city) city.userData.update(dt, t, camera);
  if (people) people.update(dt, t, camera, player);
  if (clouds) for (const c of clouds.children) c.position.x += c.userData.drift * dt * 0.8;
  renderer.info.reset();
  if (composer) { gtao.enabled = useAO; composer.render(); }
  window.__frame = (window.__frame || 0) + 1; if (window.__frame > 3) window.__ready = true;
  frames++; hudT += dt;
  if (hudT > 0.5) {
    fps = Math.round(frames / hudT); frames = 0; hudT = 0;
    const p = camera.position;
    hud.innerHTML = `<b>${player && player.fly ? 'flying' : 'walking'}</b> · ${fps} fps · x ${p.x.toFixed(0)} y ${p.y.toFixed(1)} z ${p.z.toFixed(0)} · AO ${useAO ? 'on' : 'off'} · <b>F</b> fly · <b>O</b> ambient occlusion`;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); csm.updateFrustums();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (composer) { const s = renderer.getDrawingBufferSize(new THREE.Vector2()); composer.setSize(s.x, s.y); gtao.setSize(s.x, s.y); }
});

build().catch(err => { console.error(err); status('error: ' + err.message, 1); });
