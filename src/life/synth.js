// The sound bank: every sound in the town is computed here, sample by sample, into Float32Arrays — no sound files.
// Pure functions of (sample rate, rng): audio.js wraps the results in AudioBuffers, tools can write them to WAV.
//
// Voices are a formant synthesizer (Klatt-style cascade of resonators over a band-limited glottal saw) that reads
// transliterated Greek — "khaire, ō xene" — so the talk in the streets has the phonotactics of Attic/Ionic Greek:
// aspirated stops, trilled r, long ē and ō, and a pitch accent on each word. Music: a lyre by Karplus–Strong in the
// Dorian harmonia, an aulos (a double-reed pipe with a drone) in the Phrygian. The rest are modal (sums of decaying
// partials: anvil, chisel, bells) or shaped noise (surf, wind-driven waves, cicadas, footsteps, wings).
const TAU = Math.PI * 2;

// ---------- DSP pieces ----------
class Res {   // Klatt resonator: unity gain at DC, so a cascade of them is a natural all-pole vocal tract
  constructor() { this.y1 = 0; this.y2 = 0; this.A = 1; this.B = 0; this.C = 0; }
  set(f, bw, sr) { const T = 1 / sr; this.C = -Math.exp(-TAU * bw * T); this.B = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(TAU * Math.min(f, sr * 0.45) * T); this.A = 1 - this.B - this.C; return this; }
  run(x) { const y = this.A * x + this.B * this.y1 + this.C * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
class BQ {    // RBJ biquad, direct form I
  constructor() { this.b0 = 1; this.b1 = this.b2 = this.a1 = this.a2 = 0; this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  _w(f, q, sr) { const w = TAU * Math.min(f, sr * 0.45) / sr; return [Math.cos(w), Math.sin(w) / (2 * q)]; }
  bp(f, q, sr) { const [c, al] = this._w(f, q, sr), a0 = 1 + al; this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this; }
  lp(f, q, sr) { const [c, al] = this._w(f, q, sr), a0 = 1 + al; this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this; }
  hp(f, q, sr) { const [c, al] = this._w(f, q, sr), a0 = 1 + al; this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this; }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
}
const blep = (t, dt) => t < dt ? (t /= dt, t + t - t * t - 1) : t > 1 - dt ? (t = (t - 1) / dt, t * t + t + t + 1) : 0;
class Saw { constructor(ph = 0) { this.ph = ph; } run(f, sr) { const dt = f / sr; this.ph += dt; if (this.ph >= 1) this.ph -= 1; return 2 * this.ph - 1 - blep(this.ph, dt); } }
export function normalize(a, peak = 0.9) { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); if (m > 0) { const k = peak / m; for (let i = 0; i < a.length; i++) a[i] *= k; } return a; }
function fades(a, sr, inS = 0.002, outS = 0.01) { const ni = Math.floor(inS * sr), no = Math.floor(outS * sr); for (let i = 0; i < ni && i < a.length; i++) a[i] *= i / ni; for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= i / no; return a; }
// a loop that never clicks: render xf seconds more than the loop and fold the tail over the head with an equal-power fade
function looped(sr, sec, xf, fn) {
  const L = Math.floor(sec * sr), X = Math.floor(xf * sr), a = new Float32Array(L + X); fn(a);
  const out = a.slice(0, L); for (let i = 0; i < X; i++) { const u = i / X; out[i] = a[i] * Math.sin(u * Math.PI / 2) + a[L + i] * Math.cos(u * Math.PI / 2); }
  return out;
}
// modal: partials [freq, amp, tau] from a strike, plus a click of noise
function modal(sr, dur, modes, R, click = 0.3, clickMs = 3, clickHz = 4000) {
  const n = Math.floor(dur * sr), a = new Float32Array(n), bq = new BQ().hp(clickHz, 0.7, sr), cn = clickMs * sr / 1000;
  for (const [f, amp, tau] of modes) { const w = TAU * f / sr, ph = R() * TAU; for (let i = 0; i < n; i++) a[i] += amp * Math.exp(-i / sr / tau) * Math.sin(ph + w * i); }
  for (let i = 0; i < cn * 4 && i < n; i++) a[i] += click * bq.run(R() * 2 - 1) * Math.exp(-i / cn);
  return fades(normalize(a), sr, 0.0005, 0.02);
}

// ---------- speech ----------
// vowel formants (F1, F2, F3) for a man; women ×1.16, children ×1.3
const VOW = { a: [760, 1250, 2550], e: [540, 1800, 2550], 'ē': [440, 2020, 2650], i: [300, 2250, 3000], o: [520, 920, 2450], 'ō': [470, 780, 2400], y: [300, 1700, 2200], u: [330, 820, 2300] };
const DIPH = ['ai', 'ei', 'oi', 'au', 'eu', 'ou', 'ui'], CONS2 = ['kh', 'th', 'ph', 'ps', 'rh'];
const ACC = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'y', 'ḗ': 'ē', 'ṓ': 'ō' };
function parse(text) {
  const s = text.toLowerCase().normalize('NFC'), segs = [];
  for (let i = 0; i < s.length;) {
    const c = s[i], two = s.slice(i, i + 2);
    if ('.!?'.includes(c)) { segs.push({ k: 'end', q: c }); i++; continue; }
    if (',;:—–'.includes(c)) { segs.push({ k: 'pause' }); i++; continue; }
    if (/\s/.test(c) || c === '-') { segs.push({ k: 'gap' }); i++; continue; }
    if (DIPH.includes(two)) { segs.push(two === 'ou' ? { k: 'v', a: 'u', long: true } : { k: 'v', a: two[0] === 'u' ? 'y' : two[0], b: two[1] === 'u' ? 'u' : 'i', long: true }); i += 2; continue; }
    if (ACC[c]) { segs.push({ k: 'v', a: ACC[c], long: ACC[c] === 'ē' || ACC[c] === 'ō', acc: true }); i++; continue; }
    if (VOW[c] || c === 'u') { segs.push({ k: 'v', a: c === 'u' ? 'y' : c, long: c === 'ē' || c === 'ō' }); i++; continue; }
    if (CONS2.includes(two)) { segs.push({ k: 'c', c: two === 'rh' ? 'r' : two }); i += 2; continue; }
    if ('ptkbdgmnlrszxh'.includes(c)) { if (c === 'x') segs.push({ k: 'c', c: 'k' }, { k: 'c', c: 's' }); else if (c === 'z') segs.push({ k: 'c', c: 'z' }, { k: 'c', c: 'd' }); else segs.push({ k: 'c', c }); i++; continue; }
    i++;
  }
  // a pitch accent on each word that has none marked: the penult, or the only vowel
  let w0 = 0;
  const closeWord = end => { const vs = []; for (let j = w0; j < end; j++) if (segs[j].k === 'v') vs.push(segs[j]); if (vs.length && !vs.some(v => v.acc)) vs[Math.max(0, vs.length - 2)].acc = true; };
  for (let j = 0; j < segs.length; j++) if (segs[j].k !== 'v' && segs[j].k !== 'c') { closeWord(j); w0 = j + 1; }
  closeWord(segs.length);
  return segs;
}
// voice: { f0, fs (formant scale), rate, range, breath, sing, rough }
export function speech(text, voice, sr, R) {
  const V = { f0: 118, fs: 1, rate: 1, range: 1, breath: 0.04, sing: 0, rough: 0, ...voice };
  const segs = parse(text), ev = [];
  const nextV = j => { for (let q = j; q < segs.length; q++) if (segs[q].k === 'v') return VOW[segs[q].a]; return VOW.e; };
  // ---- segments → timed events {d, vo, asp, fr, fc, fq, F, W, acc, mul} ----
  let sylls = 0;
  for (let j = 0; j < segs.length; j++) {
    const g = segs[j], r = 1 / V.rate;
    if (g.k === 'gap') { if (R() < 0.3) ev.push({ d: 0.03 * r, vo: 0 }); continue; }
    if (g.k === 'pause') { ev.push({ d: (0.14 + R() * 0.1) * r, vo: 0, reset: 0.5 }); continue; }
    if (g.k === 'end') { ev.push({ d: (0.28 + R() * 0.2) * r, vo: 0, reset: 1, q: g.q }); continue; }
    if (g.k === 'v') {
      const last = !segs.slice(j + 1).some(s => s.k === 'v');
      let d = (g.long ? 0.17 : 0.105) * (g.acc ? 1.18 : 1) * (0.85 + R() * 0.3) * r;
      const wordEnd = !segs[j + 1] || segs[j + 1].k !== 'v' && segs[j + 1].k !== 'c' || (segs[j + 1].k === 'c' && (!segs[j + 2] || segs[j + 2].k !== 'v' && segs[j + 2].k !== 'c'));
      if (V.sing && wordEnd) d *= 2.6;
      if (last) d *= 1.3;
      ev.push({ d, vo: 1, F: VOW[g.a], F2: g.b ? VOW[g.b] : null, acc: g.acc, syl: sylls++, wordEnd });
      continue;
    }
    const F = nextV(j), c = g.c;
    if ('ptk'.includes(c) || c === 'ph' || c === 'th' || c === 'kh') {
      const fc = c[0] === 'p' ? 900 : c[0] === 't' ? 3900 : 1900;
      ev.push({ d: 0.05 * r, vo: 0 });
      ev.push({ d: 0.012, vo: 0, fr: 1, fc, fq: 1.2 });
      ev.push({ d: (c.length === 2 ? 0.06 : 0.015) * r, vo: 0, asp: c.length === 2 ? 0.9 : 0.4, F });
    } else if ('bdg'.includes(c)) {
      ev.push({ d: 0.045 * r, vo: 0.22, F: [220, 900, 2300], W: 1 });
      ev.push({ d: 0.01, vo: 0.3, fr: 0.35, fc: c === 'b' ? 800 : c === 'd' ? 3600 : 1800, fq: 1.2, F });
    } else if (c === 's') ev.push({ d: 0.09 * r, vo: 0, fr: 0.75, fc: 5600, fq: 1.6 });
    else if (c === 'z') ev.push({ d: 0.05 * r, vo: 0.3, fr: 0.5, fc: 5200, fq: 1.6, F });
    else if (c === 'm' || c === 'n') ev.push({ d: 0.065 * r, vo: 0.55, F: [260, c === 'm' ? 1100 : 1500, 2400], nasal: 1 });
    else if (c === 'l') ev.push({ d: 0.055 * r, vo: 0.75, F: [360, 1350, 2700] });
    else if (c === 'r') ev.push({ d: 0.06 * r, vo: 0.8, F: [470, 1300, 1900], trill: 1 });
    else if (c === 'h') ev.push({ d: 0.065 * r, vo: 0, asp: 0.8, F });
  }
  ev.push({ d: 0.12, vo: 0 });
  // the melody: a declining line, a rise on each accent; vendors hold level notes and drop at the end of a call
  const tot = ev.reduce((s, e) => s + e.d, 0), n = Math.ceil(tot * sr), out = new Float32Array(n);
  const R1 = new Res(), R2 = new Res(), R3 = new Res(), R4 = new Res().set(3500 * V.fs, 250, sr), fric = new BQ(), saw = new Saw(R()), singPat = [1, 1.19, 1.19, 1.12, 0.89, 1.0, 1.26, 0.84];
  let f1 = VOW.e[0] * V.fs, f2 = VOW.e[1] * V.fs, f3 = VOW.e[2] * V.fs, vo = 0, asp = 0, fr = 0, gl = 0, rad = 0, t = 0, jit = 0, reset = 0, accE = 0, nas = 0;
  let e = 0, eT = 0, sylStart = 0;
  const BLK = 32, kS = 1 - Math.exp(-1 / (0.006 * sr)), kF = 1 - Math.exp(-1 / (0.018 * sr)), kG = 1 - Math.exp(-TAU * Math.max(160, V.f0 * 1.6) / sr);
  let decl = 1;
  for (let i0 = 0; i0 < n; i0 += BLK) {
    t = i0 / sr;
    while (e < ev.length - 1 && t >= eT + ev[e].d) { eT += ev[e].d; e++; if (ev[e].reset) decl = Math.min(1.12, decl + 0.12 * ev[e].reset); if (ev[e].syl !== undefined) sylStart = eT; }
    const E = ev[e], u = (t - eT) / E.d;
    const F = E.F ? (E.F2 ? E.F.map((v, q) => v + (E.F2[q] - v) * Math.min(1, Math.max(0, (u - 0.3) / 0.6))) : E.F) : null;
    if (F) { f1 += (F[0] * V.fs - f1) * 0.1; f2 += (F[1] * V.fs - f2) * 0.1; f3 += (F[2] * V.fs - f3) * 0.1; }   // (~8 ms: the tongue does not jump)
    R1.set(f1, 80 + (E.nasal ? 60 : 0), sr); R2.set(f2, 110 + (E.nasal ? 300 : 0), sr); R3.set(f3, 170 + (E.nasal ? 400 : 0), sr);
    if (E.fr) fric.bp(E.fc, E.fq, sr);
    decl += (0.8 - decl) * (BLK / sr) * 0.35 / V.rate;   // declination: the voice sinks through a phrase
    accE += ((E.acc ? 1 : 0) - accE) * 0.08;
    jit += ((R() - 0.5) * 0.04 - jit) * 0.2;
    let mul = decl * (1 + 0.24 * V.range * accE) + jit;
    if (E.q === '?') mul *= 1.2;
    if (V.sing && E.syl !== undefined) mul = singPat[E.syl % singPat.length] * (E.wordEnd ? 1 - 0.18 * Math.min(1, u * 1.4) : 1) * (1 + 0.012 * Math.sin(t * TAU * 5.5));
    const f0 = V.f0 * mul;
    const trill = E.trill ? 0.35 + 0.65 * Math.abs(Math.sin(TAU * 26 * (t - eT))) : 1;
    const tV = (E.vo || 0) * trill, tA = E.asp || 0, tF = E.fr || 0, tN = E.nasal ? 1 : 0;
    for (let i = i0; i < Math.min(n, i0 + BLK); i++) {
      vo += (tV - vo) * kS; asp += (tA - asp) * kS; fr += (tF - fr) * kS * 2; nas += (tN - nas) * kS;
      const noise = Math.random() * 2 - 1;
      gl += (saw.run(f0 * (1 + V.rough * 0.3 * Math.sin(i * 0.37)), sr) - gl) * kG;   // band-limited saw, softened: a glottal pulse train
      const src = gl * vo * (1 + 0.2 * V.rough * noise) + noise * (asp * 0.35 + V.breath * vo);
      let y = R4.run(R3.run(R2.run(R1.run(src))));
      if (nas > 0.01) y = y * (1 - 0.6 * nas);
      const o = (y - rad) * 7 + fric.run(noise) * fr * 0.22; rad = y;   // (y - rad): lip radiation, +6 dB/octave (and ~17 dB down at F1, hence the 7)
      out[i] = o;
    }
  }
  return fades(normalize(out, 0.85), sr, 0.004, 0.03);
}
// words to fill a phrase no one needs to understand: the everyday Greek of the town
const WORDS = ('kai de men gar oun alla ou ouk mē ti tis pōs pou pothen nai egō sy autos houtos ekeinos hēmeis hymeis estin ēn einai legei legō eipen oida horō akouō erkhetai ēlthen pōlei ōneitai didōmi labe kalos kakos megas mikros polys oligos sophos deinos philos xenos polis agora limēn naus ploion thalatta oikos gynē anēr pais doulos despotēs basileus satrapēs theos oinos artos elaion sitos krithai ikhthys obolos drakhmē statēr hēmera hēlios anemos ergon lithos andrias taphos aei nyn tote auriōn khthes entautha ekei mala panu dēta toinun ara isōs houtōs hōsper metrios khrēmata agathos alēthōs').split(' ');
const PHR = ['nē ton Dia', 'ma Dia', 'eu ge', 'ō phile', 'ō tan', 'ō gynai', 'pany men oun', 'ti legeis', 'ouk oida', 'kalōs legeis', 'Mausōlos', 'Artemisia', 'Idrieus', 'hoi Rhodioi', 'Halikarnassos', 'Knidos', 'Kōs', 'Myndos', 'Zeus Labraundos', 'ho basileus'];
export function babbleText(R, words = 6 + Math.floor(R() * 10)) {
  let s = '', k = 0;
  while (k < words) {
    if (R() < 0.12) { s += PHR[Math.floor(R() * PHR.length)]; k += 2; } else { s += WORDS[Math.floor(R() * WORDS.length)]; k++; }
    s += k < words ? (R() < 0.12 ? ', ' : ' ') : R() < 0.2 ? '?' : R() < 0.3 ? '!' : '.';
  }
  return s;
}
export const VOICES = {
  man: R => ({ f0: 98 + R() * 36, fs: 0.96 + R() * 0.08, rate: 0.9 + R() * 0.25, range: 0.8 + R() * 0.5, breath: 0.03 + R() * 0.03 }),
  old: R => ({ f0: 92 + R() * 24, fs: 0.95 + R() * 0.06, rate: 0.78 + R() * 0.15, range: 0.6 + R() * 0.3, breath: 0.07, rough: 0.35 }),
  woman: R => ({ f0: 180 + R() * 50, fs: 1.13 + R() * 0.07, rate: 0.95 + R() * 0.25, range: 0.9 + R() * 0.5, breath: 0.06 + R() * 0.04 }),
  child: R => ({ f0: 250 + R() * 60, fs: 1.28 + R() * 0.08, rate: 1.05 + R() * 0.2, range: 1.2 + R() * 0.4, breath: 0.05 }),
  orator: R => ({ f0: 108 + R() * 18, fs: 0.98 + R() * 0.04, rate: 0.72 + R() * 0.12, range: 1.7 + R() * 0.4, breath: 0.03 }),
};

// ---------- craft ----------
export const anvil = (sr, R) => { const f = 1050 + R() * 250; return modal(sr, 1.4, [[f, 1, 0.8], [f * 2.71, 0.6, 0.5], [f * 4.33, 0.35, 0.3], [f * 6.1, 0.2, 0.18], [f * 0.53, 0.25, 0.25]], R, 0.5, 2, 3000); };
export const chisel = (sr, R) => { const f = 2600 + R() * 900; const a = modal(sr, 0.35, [[f, 1, 0.06], [f * 1.53, 0.7, 0.045], [f * 2.4, 0.4, 0.03], [460 + R() * 120, 0.9, 0.02]], R, 1.2, 4, 1500); return a; };   // mallet on chisel on marble: a bright tick over a stony knock
export const knock = (sr, R) => { const f = 170 + R() * 160; return modal(sr, 0.3, [[f, 1, 0.05], [f * 2.3, 0.5, 0.03], [f * 3.9, 0.25, 0.02]], R, 0.8, 5, 700); };
// ---------- footsteps: sandal on paving (heel, toe, a little scuff) or on beaten earth and gravel (a crunch of grains) ----------
export function stepStone(sr, R) {
  const n = Math.floor(0.16 * sr), a = new Float32Array(n), hp = new BQ().bp(1400 + R() * 900, 0.9, sr), lp = new BQ().lp(240, 0.9, sr), toe = Math.floor((0.025 + R() * 0.02) * sr);
  for (let i = 0; i < n; i++) { const t = i / sr, x = R() * 2 - 1, h = Math.exp(-t / 0.012), s = i >= toe ? 0.55 * Math.exp(-(i - toe) / sr / 0.02) : 0, sc = 0.25 * Math.exp(-t / 0.06); a[i] = hp.run(x) * (h + s + sc) + lp.run(x) * (h * 2.5 + s); }
  return fades(normalize(a), sr);
}
export function stepDirt(sr, R) {
  const n = Math.floor(0.2 * sr), a = new Float32Array(n), bp = new BQ().bp(2600 + R() * 1500, 0.8, sr), lp = new BQ().lp(300, 0.8, sr);
  for (let i = 0; i < n; i++) { const t = i / sr, x = R() * 2 - 1, g = R() < 0.012 * Math.exp(-t / 0.07) ? (R() * 2 - 1) * 6 : 0; a[i] = bp.run(x * 0.35 * Math.exp(-t / 0.05) + g) + lp.run(x) * 2.2 * Math.exp(-t / 0.018); }
  return fades(normalize(a), sr);
}
// ---------- animals ----------
function voiced(sr, dur, f0fn, formants, R, { noise = 0, env, rough = 0 } = {}) {
  const n = Math.floor(dur * sr), a = new Float32Array(n), rs = formants.map(([f, bw]) => new Res().set(f, bw, sr)), saw = new Saw(R()); let rad = 0;
  for (let i = 0; i < n; i++) { const t = i / sr, u = t / dur, f0 = f0fn(u, t) * (1 + rough * 0.25 * Math.sin(i * 0.61)), x = saw.run(f0, sr) * (1 + rough * (R() - 0.5)) + noise * (R() * 2 - 1); let y = x; for (const r of rs) y = r.run(y); a[i] = (y - rad) * env(u, t); rad = y; }
  return a;
}
const env3 = (a, d) => (u, t) => Math.min(1, t / a) * Math.pow(1 - u, d);
function concat(sr, parts, gaps) { const L = parts.reduce((s, p, i) => s + p.length + Math.floor((gaps[i] || 0) * sr), 0), o = new Float32Array(L); let k = 0; parts.forEach((p, i) => { o.set(p, k); k += p.length + Math.floor((gaps[i] || 0) * sr); }); return o; }
export function bark(sr, R, size = 1) {   // size 0.6 (a little Melitan) … 1.4 (a Molossian)
  const s = size, one = () => voiced(sr, 0.13 + 0.06 * s + R() * 0.03, u => (560 - 110 * s) * (u < 0.15 ? 0.85 + u : 1 - 0.45 * (u - 0.15)), [[700 / Math.sqrt(s), 160], [1450 / Math.sqrt(s), 220], [2700 / Math.sqrt(s), 350]], R, { noise: 0.35, rough: 0.5, env: env3(0.006, 1.5) });
  const k = 1 + Math.floor(R() * 3), parts = [], gaps = []; for (let i = 0; i < k; i++) { parts.push(one()); gaps.push(0.18 + R() * 0.2); }
  return fades(normalize(concat(sr, parts, gaps)), sr);
}
export function bleat(sr, R) {
  const f = 330 + R() * 120, d = 0.6 + R() * 0.4;
  return fades(normalize(voiced(sr, d, (u, t) => f * (1.08 - 0.2 * u) * (1 + 0.1 * Math.sin(TAU * 8 * t)), [[620, 120], [1850, 180], [2650, 260]], R, { noise: 0.15, rough: 0.35, env: (u, t) => Math.min(1, t / 0.03) * (1 - u) * (0.7 + 0.3 * Math.sin(TAU * 8 * t)) })), sr);
}
export function bray(sr, R) {
  const parts = [];
  for (let k = 0; k < 3 + Math.floor(R() * 2); k++) {
    parts.push(voiced(sr, 0.32, u => 1050 - 250 * u, [[900, 200], [2100, 260], [3000, 300]], R, { noise: 0.9, rough: 0.6, env: env3(0.04, 0.6) }));
    parts.push(voiced(sr, 0.42, u => (380 - 90 * u) * (1 + 0.5 * (Math.sin(u * 900) > 0 ? 1 : 0)), [[700, 150], [1150, 200], [2500, 300]], R, { noise: 0.25, rough: 0.9, env: env3(0.03, 0.8) }));
  }
  return fades(normalize(concat(sr, parts, parts.map(() => 0.03))), sr);
}
export function cluck(sr, R) {
  const parts = [], gaps = [], k = 2 + Math.floor(R() * 4);
  for (let i = 0; i < k; i++) { const last = i === k - 1 && R() < 0.5, f = 330 + R() * 90; parts.push(voiced(sr, last ? 0.32 : 0.07, u => f * (last ? 1.5 - 0.4 * u : 1 - 0.2 * u), [[720, 150], [1500, 250], [2900, 350]], R, { noise: 0.2, rough: 0.4, env: env3(0.004, 1.2) })); gaps.push(0.08 + R() * 0.12); }
  return fades(normalize(concat(sr, parts, gaps)), sr);
}
export function gull(sr, R) {   // the yellow-legged gull: a long "kyaaow", then a laughing run of shorter notes
  const parts = [], gaps = [], k = 2 + Math.floor(R() * 5);
  for (let i = 0; i < k; i++) {
    const long = i === 0 && R() < 0.7, d = long ? 0.38 : 0.13 + R() * 0.05, top = (long ? 1350 : 1150) * (0.95 + R() * 0.1);
    parts.push(voiced(sr, d, u => u < 0.3 ? top * (0.55 + 1.5 * u) : top * (1.0 - 0.35 * (u - 0.3)), [[1700, 300], [3100, 400], [4600, 500]], R, { noise: 0.25, rough: 0.35, env: env3(0.015, 0.9) }));
    gaps.push(long ? 0.12 : 0.05 + R() * 0.05);
  }
  return fades(normalize(concat(sr, parts, gaps)), sr);
}
export function coo(sr, R) {   // a rock dove: a rolling "hrooo-hoo-hoo", low and soft
  const parts = [], gaps = [], k = 2 + Math.floor(R() * 2), f = 300 + R() * 60;
  for (let i = 0; i < k; i++) { const d = i === 0 ? 0.55 : 0.22 + R() * 0.1; parts.push(voiced(sr, d, (u, t) => f * (i === 0 ? 0.9 + 0.2 * Math.sin(u * Math.PI) : 1.05 - 0.1 * u) * (1 + 0.04 * Math.sin(TAU * 28 * t)), [[420, 90], [900, 200], [2200, 400]], R, { noise: 0.05, env: (u, t) => Math.min(1, t / 0.05) * Math.sin(Math.PI * Math.min(1, u * 1.05)) })); gaps.push(0.08 + R() * 0.08); }
  return fades(normalize(concat(sr, parts, gaps)), sr);
}
export function sparrow(sr, R) {   // a house sparrow's "chirrup" repeated
  const n = Math.floor((0.4 + R() * 0.6) * sr), a = new Float32Array(n), f0 = 3300 + R() * 1400; let t = 0.01;
  while (t < n / sr - 0.08) { const d = 0.05 + R() * 0.04, i0 = Math.floor(t * sr), L = Math.floor(d * sr), g = 0.5 + R() * 0.5; let ph = 0; for (let i = 0; i < L && i0 + i < n; i++) { const u = i / L; ph += TAU * f0 * (1.25 - 0.45 * u + 0.1 * Math.sin(u * 30)) / sr; a[i0 + i] += g * Math.sin(ph) * Math.sin(u * Math.PI) ** 2; } t += d + 0.04 + R() * 0.12; }
  return fades(normalize(a), sr);
}
export function swallow(sr, R) {   // a swallow's twitter: quick liquid warbles, high
  const n = Math.floor(0.9 * sr), a = new Float32Array(n); let t = 0.01;
  while (t < 0.82) { const d = 0.025 + R() * 0.05, i0 = Math.floor(t * sr), L = Math.floor(d * sr), f0 = 3800 + R() * 3000, dir = R() < 0.5 ? 1 : -1; let ph = 0; for (let i = 0; i < L && i0 + i < n; i++) { const u = i / L; ph += TAU * f0 * (1 + dir * 0.35 * u + 0.08 * Math.sin(u * 40)) / sr; a[i0 + i] += Math.sin(ph) * Math.sin(u * Math.PI); } t += d + 0.01 + R() * 0.05; }
  return fades(normalize(a), sr);
}
export function crow(sr, R) {   // a cock crowing: kik-e-riki-kiiii, the last note long and falling
  const f = 520 + R() * 120, notes = [[0.12, 1.0], [0.1, 1.15], [0.14, 1.3], [0.75, 1.25]], parts = [];
  for (const [d, m] of notes) parts.push(voiced(sr, d, u => f * m * (d > 0.5 ? 1.08 - 0.3 * u * u : 1), [[850, 180], [1750, 260], [2900, 350]], R, { noise: 0.2, rough: 0.55, env: env3(0.01, d > 0.5 ? 0.9 : 0.4) }));
  return fades(normalize(concat(sr, parts, [0.02, 0.02, 0.03])), sr);
}
export function growl(sr, R) { return fades(normalize(voiced(sr, 0.8 + R() * 0.5, (u, t) => (85 + R() * 3) * (1 + 0.15 * Math.sin(TAU * 3 * t)), [[420, 160], [1000, 250], [2300, 400]], R, { noise: 0.6, rough: 1, env: (u, t) => Math.min(1, t / 0.08) * (1 - u) * (0.7 + 0.3 * Math.sin(TAU * 7 * t)) })), sr); }
export function whine(sr, R) { const f = 800 + R() * 300; return fades(normalize(voiced(sr, 0.5 + R() * 0.4, (u, t) => f * (1 + 0.35 * Math.sin(u * Math.PI)) * (1 + 0.02 * Math.sin(TAU * 9 * t)), [[1100, 200], [2600, 400]], R, { noise: 0.05, env: (u, t) => Math.min(1, t / 0.03) * Math.sin(Math.PI * u) })), sr); }
export function flutter(sr, R, birds = 8) {   // pigeons taking off: the first beats clap, the rest whirr away
  const n = Math.floor(1.8 * sr), a = new Float32Array(n), bp = new BQ().bp(1100, 0.7, sr), lp = new BQ().lp(500, 0.7, sr);
  const imp = new Float32Array(n);
  for (let b = 0; b < birds; b++) { let t = R() * 0.35; const rate = 8 + R() * 3; for (let k = 0; t < 1.7; k++, t += 1 / rate * (0.9 + R() * 0.2)) { const i = Math.floor(t * sr); if (i < n) imp[i] += (k < 3 ? 1 : 0.35) * Math.exp(-t / 0.7) * (0.6 + R() * 0.4); } }
  let e = 0; for (let i = 0; i < n; i++) { e = Math.max(e * Math.exp(-1 / (0.012 * sr)), imp[i]); const x = R() * 2 - 1; a[i] = bp.run(x) * e + lp.run(x) * e * 0.6; }
  return fades(normalize(a), sr);
}
export function bell(sr, R, f = 700) {   // a copper goat bell: dull, inharmonic, the clapper striking once to three times
  const one = modal(sr, 0.9, [[f, 1, 0.32], [f * 2.08, 0.55, 0.2], [f * 3.37, 0.3, 0.13], [f * 4.8, 0.15, 0.08]], R, 0.35, 1.5, 2500);
  const k = 1 + Math.floor(R() * 3), o = new Float32Array(Math.floor((0.9 + (k - 1) * 0.22) * sr)); let pos = 0;
  for (let i = 0; i < k; i++) { for (let j = 0; j < one.length && pos + j < o.length; j++) o[pos + j] += one[j] * (1 - 0.25 * i); pos += Math.floor((0.1 + R() * 0.12) * sr); }
  return fades(normalize(o), sr);
}
// ---------- fire and cloth ----------
// a wood fire: a low breathy roar, a patter of crackles and now and then the pop of a resinous knot
export function crackle(sr, R) {
  return looped(sr, 8, 1, a => {
    const lp = new BQ().lp(480, 0.7, sr), bp = new BQ().bp(2600, 0.8, sr);
    for (let i = 0; i < a.length; i++) a[i] = lp.run(R() * 2 - 1) * 0.35 * (0.75 + 0.25 * Math.sin(i / sr * 2.3) * Math.sin(i / sr * 0.7));
    for (let t = 0; t < 9; t += 0.008 + R() * 0.11) { const i0 = Math.floor(t * sr), big = R() < 0.07, L = Math.floor((big ? 0.018 : 0.004) * sr), g = big ? 1 : 0.12 + R() * 0.35; for (let i = 0; i < L && i0 + i < a.length; i++) a[i0 + i] += bp.run(R() * 2 - 1) * g * Math.exp(-i / (L * 0.3)); }
    normalize(a, 0.8);
  });
}
// a gust through the leaves: a swell of fine rustling grains
export function rustle(sr, R) {
  const dur = 2.6 + R() * 1.2, n = Math.floor(dur * sr), a = new Float32Array(n), bp = new BQ().bp(4200 + R() * 1500, 0.6, sr), lo = new BQ().bp(1300, 0.7, sr);
  for (let i = 0; i < n; i++) { const u = i / n, sw = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 1.5, x = R() * 2 - 1, grain = R() < 0.06 * sw ? (R() * 2 - 1) * 3 : 0; a[i] = (bp.run(x * 0.5 + grain) + lo.run(x) * 0.35) * sw; }
  return fades(normalize(a), sr, 0.05, 0.2);
}
// washing snapping in a gust
export function cloth(sr, R) {
  const n = Math.floor(0.7 * sr), a = new Float32Array(n), bp = new BQ().bp(650 + R() * 500, 0.7, sr), lp = new BQ().lp(240, 0.7, sr), f = 13 + R() * 10;
  for (let i = 0; i < n; i++) { const t = i / sr, e = Math.min(1, t / 0.03) * Math.exp(-t / 0.22), am = Math.pow(0.5 + 0.5 * Math.sin(TAU * f * t), 4), x = R() * 2 - 1; a[i] = (bp.run(x) + lp.run(x)) * 0.8 * e * (0.3 + 0.7 * am); }
  return fades(normalize(a), sr);
}
// ---------- water ----------
export function splash(sr, R) {   // a trireme's stroke: a hundred and seventy blades entering the water at once, the oars knocking in their tholes
  const n = Math.floor(1.0 * sr), a = new Float32Array(n), lp = new BQ().lp(1300, 0.7, sr), bp = new BQ().bp(2600, 0.6, sr), th = knock(sr, R);
  for (let i = 0; i < n; i++) { const t = i / sr, e = Math.min(1, t / 0.04) * Math.exp(-t / 0.28), x = R() * 2 - 1; a[i] = lp.run(x) * e * 1.4 + bp.run(x) * e * 0.4; }
  for (let b = 0; b < 26; b++) { const t0 = 0.03 + R() * 0.5, f = 350 + R() * 700, i0 = Math.floor(t0 * sr); for (let i = 0; i < 0.04 * sr && i0 + i < n; i++) a[i0 + i] += 0.25 * Math.sin(TAU * f * (i / sr) * (1 + 3 * i / sr)) * Math.exp(-i / sr / 0.012); }
  for (let i = 0; i < th.length && i < n; i++) a[i] += th[i] * 0.3;
  return fades(normalize(a), sr);
}
// breaking waves on the open shore: swell, a hissing break, the wash running back
export function surf(sr, R) {
  return looped(sr, 24, 2, a => {
    const lp = new BQ().lp(420, 0.7, sr), hs = new BQ().bp(1900, 0.5, sr), ws = new BQ().lp(1100, 0.7, sr), top = new BQ().lp(5000, 0.7, sr); let br = 0;
    const waves = []; for (let t = R() * 2; t < 26; t += 5 + R() * 3.5) waves.push([t, 0.6 + R() * 0.5]);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr, x = R() * 2 - 1; br += (x - br) * 0.02;
      let sw = 0, bk = 0, wa = 0;
      for (const [t0, g] of waves) { const u = t - t0; if (u < -2 || u > 7) continue; sw += g * Math.exp(-((u + 0.3) ** 2) / 1.2); if (u > -0.4) { const v = u + 0.4; bk += g * Math.min(1, (v / 0.55) ** 2) * Math.exp(-Math.max(0, u) / 0.9); if (u > 0) wa += g * Math.exp(-u / 2.6) * Math.min(1, u / 0.6); } }
      a[i] = lp.run(br) * (0.8 + 1.6 * sw) + top.run(hs.run(x) * bk * 0.9 + ws.run(x) * wa * 0.45);
    }
    normalize(a, 0.8);
  });
}
// harbour water slapping the quay stones and the hulls
export function lap(sr, R) {
  return looped(sr, 16, 1.5, a => {
    const lp = new BQ().lp(700, 0.8, sr), low = new BQ().lp(200, 0.7, sr); const ev = []; for (let t = 0; t < 17.5; t += 0.5 + R() * 1.6) ev.push([t, 0.4 + R() * 0.6]);
    const blips = []; for (let t = 0; t < 17.5; t += 0.04 + R() * 0.25) blips.push([t, 300 + R() * 900, R()]);
    for (let i = 0; i < a.length; i++) {
      const t = i / sr, x = R() * 2 - 1; let e = 0;
      for (const [t0, g] of ev) { const u = t - t0; if (u > 0 && u < 1.2) e += g * Math.min(1, u / 0.05) * Math.exp(-u / 0.18); }
      a[i] = lp.run(x) * e + low.run(x) * 0.5;
    }
    for (const [t0, f, g] of blips) { const i0 = Math.floor(t0 * sr); for (let i = 0; i < 0.03 * sr && i0 + i < a.length; i++) a[i0 + i] += 0.12 * g * Math.sin(TAU * f * (i / sr) * (1 + 4 * i / sr)) * Math.exp(-i / sr / 0.008); }
    normalize(a, 0.8);
  });
}
export function trickle(sr, R) {   // a spout running into a fountain basin
  return looped(sr, 6, 0.8, a => {
    const bp = new BQ().bp(2400, 0.6, sr), lp = new BQ().lp(600, 0.7, sr);
    for (let i = 0; i < a.length; i++) { const x = R() * 2 - 1; a[i] = bp.run(x) * 0.35 + lp.run(x) * 0.3; }
    for (let t = 0; t < 6.8; t += 0.006 + R() * 0.03) { const i0 = Math.floor(t * sr), f = 700 + R() * 1400, g = 0.1 + R() * 0.25; for (let i = 0; i < 0.025 * sr && i0 + i < a.length; i++) a[i0 + i] += g * Math.sin(TAU * f * (i / sr) * (1 + 6 * i / sr)) * Math.exp(-i / sr / 0.007); }
    normalize(a, 0.8);
  });
}
// ---------- cicadas: a chorus of Lyristes plebejus (a continuous, pulsed rasp) and Cicada orni (a rhythmic ticking) ----------
export function cicadas(sr, R) {
  return looped(sr, 20, 2, a => {
    const singers = [];
    for (let k = 0; k < 6; k++) singers.push({ bp: new BQ().bp((k % 2 ? 4300 : 5400) * (0.92 + R() * 0.16), 3 + R() * 2, sr), pr: k % 2 ? 11 + R() * 4 : 170 + R() * 60, orni: k % 2 === 1, t0: R() * 20, len: 5 + R() * 9, gap: 1 + R() * 4, g: 0.5 + R() * 0.5, ph: R() });
    for (let i = 0; i < a.length; i++) {
      const t = i / sr, x = R() * 2 - 1; let o = 0;
      for (const s of singers) {
        const cyc = s.len + s.gap, u = ((t - s.t0) % cyc + cyc) % cyc, sw = u < s.len ? Math.min(1, u / 1.5) * Math.min(1, (s.len - u) / 0.8) : 0;
        if (sw <= 0) { s.bp.run(x); continue; }
        const p = (t * s.pr + s.ph) % 1, am = s.orni ? (p < 0.35 ? Math.sin(p / 0.35 * Math.PI) : 0) : Math.pow(0.5 + 0.5 * Math.sin(TAU * p), 3);
        o += s.bp.run(x) * am * sw * s.g;
      }
      a[i] = o;
    }
    normalize(a, 0.8);
  });
}
// the wind's raw material: brownish noise the audio graph filters live as the gusts come and go
export function windNoise(sr, R) { const n = Math.floor(sr * 6), a = new Float32Array(n); let b = 0; for (let i = 0; i < n; i++) { b += ((R() * 2 - 1) - b) * 0.06; a[i] = b * 3 + (R() * 2 - 1) * 0.08; } return normalize(a, 0.8); }
// house sparrows and finches in the eaves and the vines: clusters of short cheeps and trills
export function chirps(sr, R) {
  return looped(sr, 16, 1, a => {
    for (let t = R(); t < 17; t += 0.6 + R() * 2.4) {
      const n = 2 + Math.floor(R() * 6), f0 = 3000 + R() * 2000, kind = R(), g0 = 0.3 + R() * 0.7;
      for (let k = 0; k < n; k++) {
        const t0 = t + k * (kind < 0.3 ? 0.06 : 0.11 + R() * 0.08), d = kind < 0.3 ? 0.035 : 0.045 + R() * 0.05, i0 = Math.floor(t0 * sr), L = Math.floor(d * sr), g = g0 * (0.6 + R() * 0.4); let ph = 0;
        for (let i = 0; i < L && i0 + i < a.length; i++) { const u = i / L, f = kind < 0.6 ? f0 * (1 + 0.3 * Math.sin(u * Math.PI)) : f0 * (1.35 - 0.55 * u); ph += TAU * f / sr; a[i0 + i] += g * Math.sin(ph) * Math.sin(u * Math.PI) ** 2; }
      }
    }
    normalize(a, 0.8);
  });
}
// many voices far off: the murmur of a crowd
export function walla(sr, R, voices = 40, sec = 18) {
  return looped(sr, sec, 1.5, a => {
    const lp = new BQ().lp(2600, 0.7, sr);
    for (let k = 0; k < voices; k++) {
      const kinds = ['man', 'man', 'woman', 'woman', 'old', 'child'], v = VOICES[kinds[Math.floor(R() * kinds.length)]](R), p = speech(babbleText(R, 4 + Math.floor(R() * 8)), v, sr, R), g = 0.25 + R() * 0.75, i0 = Math.floor(R() * (a.length - p.length));
      for (let i = 0; i < p.length && i0 + i < a.length; i++) a[i0 + i] += p[i] * g;
    }
    for (let i = 0; i < a.length; i++) a[i] = lp.run(a[i]);
    normalize(a, 0.8);
  });
}
// ---------- music ----------
// a pluck by Karplus–Strong: a noise burst circulating in a delay line that averages itself away
function pluck(out, i0, f, sr, R, g = 1, bright = 0.5) {
  const N = Math.max(2, Math.round(sr / f)), buf = new Float32Array(N); let p = 0;
  for (let i = 0; i < N; i++) buf[i] = (R() * 2 - 1);
  for (let k = 0; k < 2 - bright; k++) for (let i = 1; i < N; i++) buf[i] = 0.5 * (buf[i] + buf[i - 1]);   // a softer finger: a duller burst
  const L = Math.min(out.length - i0, Math.floor(3.2 * sr)), decay = 0.9965 + 0.002 * Math.min(1, 200 / f);
  for (let i = 0; i < L; i++) { const a = buf[p], b = buf[(p + 1) % N]; out[i0 + i] += a * g; buf[p] = decay * 0.5 * (a + b); p = (p + 1) % N; }
}
// the lyre in the Dorian harmonia (E–E on the white keys), wandering phrases that come home to E or A
export function lyrePiece(sr, R, sec = 48) {
  const sc = [164.8, 174.6, 196.0, 220.0, 246.9, 261.6, 293.7, 329.6, 349.2, 392.0];
  return looped(sr, sec, 2.5, a => {
    let t = 0.5, deg = 7;
    while (t < sec + 1.5) {
      const len = 5 + Math.floor(R() * 8);
      for (let k = 0; k < len && t < sec + 1.5; k++) {
        const step = [-2, -1, -1, 1, 1, 2, -3, 3, 0][Math.floor(R() * 9)]; deg = Math.max(0, Math.min(sc.length - 1, deg + step));
        if (k === len - 1) deg = R() < 0.6 ? 0 : 3;
        pluck(a, Math.floor(t * sr), sc[deg], sr, R, 0.8, 0.5 + R() * 0.4);
        if (R() < 0.18 && deg >= 4) pluck(a, Math.floor((t + 0.015) * sr), sc[deg - 4] || sc[0], sr, R, 0.5, 0.3);   // a fifth struck with it
        t += [0.3, 0.45, 0.45, 0.6, 0.9][Math.floor(R() * 5)] * (k === len - 1 ? 2.2 : 1);
      }
      t += 1 + R() * 2.5;
    }
    // the tortoise-shell sound box
    const b1 = new BQ().bp(230, 1.5, sr), b2 = new BQ().bp(700, 1.2, sr), hp = new BQ().hp(90, 0.7, sr);
    for (let i = 0; i < a.length; i++) { const x = hp.run(a[i]); a[i] = x * 0.6 + b1.run(x) * 0.9 + b2.run(x) * 0.5; }
    normalize(a, 0.8);
  });
}
// a chorus of citizens rehearsing in the theatre: the parodos of Euripides' Bacchae (64–71), sung in unison
// (each voice a little off the others in pitch and time, as a chorus is), over an aulos
export function chorusPiece(sr, R, sec = 42) {
  const lines = ['Asias apo gaias hieron Tmōlon ameipsasa thoazō,', 'Bromiōi ponon hēdyn, kamaton t eukamaton, Bakkhion euazomena.', 'tis hodōi, tis hodōi? tis melathrois? ektopos estō!', 'stoma t euphēmon hapas exosiousthō.'];
  const au = aulosPiece(sr, R, sec);
  return looped(sr, sec, 2, a => {
    let t = 1.2;
    for (const [li, ln] of lines.entries()) {
      let longest = 0;
      for (let v = 0; v < 9; v++) {
        const r = mulberry(777 + li), p = speech(ln, { f0: 124 * (1 + (R() - 0.5) * 0.03), fs: 0.97 + R() * 0.06, rate: 0.62, range: 0.4, breath: 0.05, sing: 1 }, sr, r), i0 = Math.floor((t + (R() - 0.5) * 0.05) * sr), g = 0.7 + R() * 0.3;
        for (let i = 0; i < p.length && i0 + i < a.length; i++) a[i0 + i] += p[i] * g;
        longest = Math.max(longest, p.length / sr);
      }
      t += longest + 1.2 + R() * 1.5; if (t > sec - 3) break;
    }
    normalize(a, 0.8);
    for (let i = 0; i < a.length; i++) a[i] += au[i % au.length] * 0.35;
    normalize(a, 0.8);
  });
}
// every singer draws the same syllable timings from the same stream: they keep together; only pitch and onset differ
export function mulberry(seed) { let s = seed | 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// the aulos: two reed pipes, one holding a drone, the other a slow, ornamented line in the Phrygian (D–D)
export function aulosPiece(sr, R, sec = 40) {
  const sc = [293.7, 329.6, 349.2, 392.0, 440.0, 493.9, 523.3, 587.3], drone = 146.8;
  const notes = []; let t = 0.4, deg = 4;
  while (t < sec + 2) {
    const len = 4 + Math.floor(R() * 6);
    for (let k = 0; k < len; k++) { const step = [-1, -1, 1, 1, -2, 2, 0][Math.floor(R() * 7)]; deg = Math.max(0, Math.min(7, deg + step)); if (k === len - 1) deg = R() < 0.5 ? 0 : 4; const d = [0.35, 0.5, 0.7, 1.0][Math.floor(R() * 4)] * (k === len - 1 ? 2.5 : 1); notes.push([t, d, sc[deg], R() < 0.3]); t += d; }
    notes.push([t, 1.2 + R() * 1.5, 0, false]); t += notes[notes.length - 1][1];   // a breath
  }
  return looped(sr, sec, 2, a => {
    const s1 = new Saw(R()), s2 = new Saw(R()), f1 = new Res().set(1150, 400, sr), f2 = new Res().set(2600, 700, sr), g1 = new Res().set(900, 500, sr), lp = new BQ().lp(4200, 0.7, sr);
    let ni = 0, f = sc[4], amp = 0, rad1 = 0, rad2 = 0;
    for (let i = 0; i < a.length; i++) {
      const tt = i / sr; while (ni < notes.length - 1 && tt >= notes[ni + 1][0]) ni++;
      const [t0, d, nf, orn] = notes[ni], u = tt - t0;
      const target = nf ? (orn && u < 0.08 ? nf * 1.122 : nf) : f;
      f += (target - f) * 0.004;   // a slide between notes
      const on = nf ? Math.min(1, u / 0.05) * Math.min(1, (d - u) / 0.06 + 0.2) : 0; amp += (on - amp) * 0.002;
      const vib = 1 + 0.006 * Math.sin(TAU * 5.2 * tt), x1 = s1.run(f * vib, sr) + 0.05 * (R() - 0.5), x2 = s2.run(drone * (1 + 0.003 * Math.sin(TAU * 0.3 * tt)), sr);
      const y1 = f2.run(f1.run(x1)), y2 = g1.run(x2);
      a[i] = lp.run((y1 - rad1) * amp + (y2 - rad2) * 0.45 * amp); rad1 = y1; rad2 = y2;
    }
    normalize(a, 0.8);
  });
}
