/**
 * Frost Breakout — sound asset generator
 * --------------------------------------
 * Renders every sound effect as a 16-bit PCM mono WAV into assets/sounds/.
 * Zero dependencies: run `node tools/generate-sounds.mjs` and the files appear.
 *
 * These are optional. The game synthesises equivalent sounds with the WebAudio
 * API at runtime, and automatically prefers these WAVs when they are present.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'assets/sounds');
const RATE = 44100;

/* ---------- helpers ------------------------------------------------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function buffer(seconds) {
  return new Float32Array(Math.max(1, Math.round(seconds * RATE)));
}

function add(buf, offset, samples) {
  for (let i = 0; i < samples.length; i++) {
    const j = offset + i;
    if (j >= 0 && j < buf.length) buf[j] += samples[i];
  }
}

/** Exponential attack/decay envelope. */
function env(n, { a = 0.004, d = 1, curve = 3 } = {}) {
  const out = new Float32Array(n);
  const at = Math.max(1, Math.round(a * RATE));
  for (let i = 0; i < n; i++) {
    if (i < at) out[i] = i / at;
    else {
      const t = (i - at) / Math.max(1, n - at);
      out[i] = Math.pow(1 - t, curve) * d;
    }
  }
  return out;
}

/** Oscillator with a frequency glide (Hz, Hz). */
function osc(seconds, f0, f1, type = 'sine', e = {}) {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  const shape = {
    sine: (p) => Math.sin(p),
    tri: (p) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1,
    square: (p) => (p % 1 < 0.5 ? 1 : -1),
    saw: (p) => 2 * (p - Math.floor(p + 0.5)),
  }[type];
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const f = f1 === undefined ? f0 : f0 * Math.pow(f1 / f0, t);
    phase += f / RATE;
    out[i] = shape(phase);
  }
  const g = env(n, e);
  for (let i = 0; i < n; i++) out[i] *= g[i];
  return out;
}

function noise(seconds, seed = 1) {
  const n = Math.round(seconds * RATE);
  const out = new Float32Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out[i] = (s / 0xffffffff) * 2 - 1;
  }
  return out;
}

/** Two-pole state-variable filter → { lp, bp } arrays. */
function svf(input, freq, q = 1) {
  const n = input.length;
  const lp = new Float32Array(n), bp = new Float32Array(n);
  const g = Math.tan((Math.PI * clamp(freq, 20, 18000)) / RATE);
  const k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1, a3 = g * a2;
  let ic1 = 0, ic2 = 0;
  for (let i = 0; i < n; i++) {
    const v3 = input[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    lp[i] = v2;
    bp[i] = v1;
  }
  return { lp, bp };
}

function applyEnv(buf, e, gain = 1) {
  const g = env(buf.length, e);
  for (let i = 0; i < buf.length; i++) buf[i] *= g[i] * gain;
  return buf;
}

/* ---------- WAV encoder --------------------------------------------------- */
function toWav(samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);          // PCM
  buf.writeUInt16LE(1, 22);          // mono
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const norm = peak > 0 ? 0.86 / peak : 1;
  for (let i = 0; i < n; i++) {
    const v = clamp(samples[i] * norm, -1, 1);
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

/* ---------- the sound design --------------------------------------------- */
const sounds = {
  launch() {
    const b = buffer(0.24);
    add(b, 0, osc(0.2, 300, 1050, 'sine', { a: 0.006, curve: 3 }));
    add(b, 0, osc(0.16, 600, 1500, 'tri', { a: 0.004, curve: 4 }));
    const bp = svf(noise(0.1, 7), 2600, 0.9).bp;
    applyEnv(bp, { a: 0.002, curve: 3 }, 0.5);
    add(b, 0, bp);
    return b;
  },

  paddle() {
    const b = buffer(0.16);
    add(b, 0, osc(0.13, 470, 790, 'tri', { a: 0.003, curve: 3.4 }));
    add(b, 0, osc(0.07, 940, 1500, 'sine', { a: 0.002, curve: 4 }));
    const hp = svf(noise(0.04, 3), 3200, 0.8).bp;
    applyEnv(hp, { a: 0.001, curve: 3 }, 0.55);
    add(b, 0, hp);
    return b;
  },

  wall() {
    const b = buffer(0.1);
    add(b, 0, osc(0.08, 1450, 1120, 'sine', { a: 0.002, curve: 4 }));
    return b;
  },

  bounce() {
    const b = buffer(0.12);
    add(b, 0, osc(0.1, 690, 1010, 'sine', { a: 0.003, curve: 3.2 }));
    return b;
  },

  brick() {
    const b = buffer(0.3);
    const bp = svf(noise(0.26, 11), 2900, 1.1).bp;
    applyEnv(bp, { a: 0.002, curve: 3.2 }, 1);
    add(b, 0, bp);
    add(b, 0, osc(0.11, 900, 420, 'square', { a: 0.002, curve: 3.5 }));
    add(b, 0, osc(0.18, 2100, 1400, 'sine', { a: 0.001, curve: 5 }));
    return b;
  },

  powerup() {
    const b = buffer(0.42);
    [660, 880, 1320].forEach((f, i) => {
      add(b, Math.round(i * 0.055 * RATE), osc(0.18, f, f, 'tri', { a: 0.003, curve: 3 }));
      add(b, Math.round(i * 0.055 * RATE), osc(0.12, f * 2, f * 2, 'sine', { a: 0.002, curve: 4 }));
    });
    return b;
  },

  shield() {
    const b = buffer(0.5);
    [880, 1174, 1568].forEach((f, i) => {
      const off = Math.round(i * 0.045 * RATE);
      add(b, off, osc(0.36, f, f * 1.02, 'sine', { a: 0.01, curve: 2.4 }));
      add(b, off, osc(0.36, f, f, 'sine', { a: 0.01, curve: 2.4 }));
    });
    const hp = svf(noise(0.3, 23), 4200, 0.7).bp;
    applyEnv(hp, { a: 0.02, curve: 2 }, 0.35);
    add(b, 0, hp);
    return b;
  },

  level() {
    const b = buffer(0.75);
    [523, 659, 784, 1047].forEach((f, i) => {
      const off = Math.round(i * 0.09 * RATE);
      add(b, off, osc(0.3, f, f, 'tri', { a: 0.005, curve: 2.6 }));
      add(b, off, osc(0.22, f * 2, f * 2, 'sine', { a: 0.004, curve: 3 }));
      add(b, off, osc(0.18, f / 2, f / 2, 'sine', { a: 0.006, curve: 2.6 }));
    });
    return b;
  },

  life() {
    const b = buffer(0.6);
    add(b, 0, osc(0.5, 320, 70, 'saw', { a: 0.006, curve: 2.2 }));
    const lp = svf(noise(0.45, 31), 900, 0.9).lp;
    applyEnv(lp, { a: 0.004, curve: 2 }, 0.5);
    add(b, 0, lp);
    return b;
  },

  gameover() {
    const b = buffer(1.5);
    [392, 330, 262, 196].forEach((f, i) => {
      const off = Math.round(i * 0.17 * RATE);
      add(b, off, osc(0.55, f, f * 0.995, 'tri', { a: 0.008, curve: 2.2 }));
      add(b, off, osc(0.4, f * 1.5, f * 1.49, 'sine', { a: 0.008, curve: 2.4 }));
    });
    return b;
  },
};

/* ---------- write them out ------------------------------------------------ */
mkdirSync(OUT, { recursive: true });
let total = 0;
for (const [name, fn] of Object.entries(sounds)) {
  const wav = toWav(fn());
  writeFileSync(resolve(OUT, `${name}.wav`), wav);
  total += wav.length;
  console.log(`  ✓ ${name}.wav  (${(wav.length / 1024).toFixed(1)} KB)`);
}
console.log(`\n${Object.keys(sounds).length} sounds written to assets/sounds (${(total / 1024).toFixed(0)} KB total)`);