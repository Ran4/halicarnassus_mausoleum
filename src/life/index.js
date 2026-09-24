// The living world: what moves, sounds and speaks on top of the built town — each in its own module here.
//
// A module exports build(ctx) → { group?, update?(dt, t, camera, player), start?(), debug?() } (build may be async).
// ctx = { M, world, layout, scene, camera, renderer, setupMaterial, people, sunDir, csm } plus, shared by the modules:
//   ctx.wind  { dx, dz: the direction it blows toward (a steady WNW breeze, as the town's smoke already drifts), speed m/s,
//               gust(x, z, t) → 0.4..1.6, a gust field that travels down-wind }
//   ctx.emit(type, x, y, z, data?)  a sound-worthy event (a bark, a gull's cry, an oar stroke, a flock taking off);
//               the audio module drains ctx.events each frame and ignores types it does not know
// start() runs on the first click into the scene (the user gesture WebAudio needs).
// Objects flagged userData.noAO stay out of GTAO's normal pre-pass (use it for vertex-animated meshes).
//
// ?life=birds,ships loads only those modules, ?life=0 none. A module that throws is skipped, not fatal.
export const MODULES = ['wind', 'birds', 'ships', 'fauna', 'hearths', 'chatter', 'audio'];   // (audio last: it hears what the others emitted this frame)

export async function buildLife(ctx) {
  const wd = Math.hypot(0.93, 0.36);
  ctx.wind = {
    dx: 0.93 / wd, dz: 0.36 / wd, speed: 4.5,
    gust(x, z, t) {   // two travelling waves across the land, a slow swell and quicker puffs
      const u = (x * this.dx + z * this.dz) - t * this.speed * 1.6, v = x * this.dz - z * this.dx;
      return 1 + 0.35 * Math.sin(u * 0.021 + Math.sin(v * 0.013) * 1.7) + 0.25 * Math.sin(u * 0.067 + v * 0.021 + t * 0.3);
    },
  };
  ctx.events = [];
  ctx.emit = (type, x, y, z, data) => { if (ctx.events.length < 256) ctx.events.push({ type, x, y, z, data }); };
  const q = new URLSearchParams(location.search).get('life');
  const names = q === null ? MODULES : q === '0' ? [] : q.split(',').filter(Boolean);
  const mods = [];
  for (const nm of names) {
    const t0 = performance.now();
    try {
      const mod = await import(`./${nm}.js`);
      const inst = (await mod.build(ctx)) || {};
      if (inst.group) ctx.scene.add(inst.group);
      mods.push({ name: nm, ms: Math.round(performance.now() - t0), upd: 0, ...inst });
    } catch (e) { console.error(`[life] ${nm} failed:`, e); }
  }
  let started = false;
  return {
    mods,
    update(dt, t, camera, player) {
      for (const m of mods) {
        if (!m.update || m.dead) continue;
        const t0 = performance.now();
        try { m.update(dt, t, camera, player); } catch (e) { console.error(`[life] ${m.name} stopped:`, e); m.dead = true; }   // (one broken module must not stop the frame)
        m.upd += (performance.now() - t0 - m.upd) * 0.02;   // upd: a running mean of its ms per frame
      }
      ctx.events.length = 0;
    },
    start() { if (started) return; started = true; for (const m of mods) if (m.start) try { m.start(); } catch (e) { console.error(`[life] ${m.name} start:`, e); } },
    debug() { const o = {}; for (const m of mods) o[m.name] = { buildMs: m.ms, updateMs: +m.upd.toFixed(3), ...(m.debug ? m.debug() : {}) }; return o; },
  };
}
