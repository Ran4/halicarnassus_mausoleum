// Runs synth.js off the main thread: { id, job, sr, seed, args } → { id, data: Float32Array } (transferred).
// job is a synth.js export called as f(sr, R, ...args); 'speech' takes (text, voice) and 'babble' (kind) instead.
import * as S from './synth.js';

self.onmessage = e => {
  const { id, job, sr, seed, args = [] } = e.data, R = S.mulberry(seed);
  try {
    const out = job === 'speech' ? S.speech(args[0], args[1], sr, R)
      : job === 'babble' ? S.speech(S.babbleText(R), S.VOICES[args[0]](R), sr, R)
      : S[job](sr, R, ...args);
    self.postMessage({ id, data: out }, [out.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.stack || err) }); }
};
