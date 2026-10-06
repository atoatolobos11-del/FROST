/**
 * Shared utilities for Frost Arcade games — ES Module.
 * Provides: single AudioContext, particle pool, high-score storage, input helpers.
 */
 
/* ─── AudioContext singleton ─── */
let AudioCtx = null;
let MasterGain = null;
let Compressor = null;
let NoiseBuffer = null;
const buffers = {};
let muted = false;
let volume = 0.8;

/* ─── Global settings (shared by every game in the system) ───
 * Single source of truth: `frost-arcade:settings`.
 * The legacy main-game key `frost-breakout:settings` is read as a fallback
 * so existing players keep their choices; new writes go to the global key. */
const SETTINGS_KEY = 'frost-arcade:settings';
const LEGACY_SETTINGS_KEY = 'frost-breakout:settings';
const SETTINGS_DEFAULTS = { difficulty: 'normal', volume: 0.8, shake: true, particles: true, flash: true, muted: false };

function readJSON(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}

export function getSettings() {
  const g = readJSON(SETTINGS_KEY) || {};
  const l = readJSON(LEGACY_SETTINGS_KEY) || {};
  const v = (x) => (typeof x === 'number' && !isNaN(x) ? Math.min(1, Math.max(0, x)) : null);
  return {
    difficulty: g.difficulty || l.difficulty || SETTINGS_DEFAULTS.difficulty,
    volume: v(g.volume) ?? v(l.volume) ?? SETTINGS_DEFAULTS.volume,
    shake: (g.shake ?? l.shake ?? SETTINGS_DEFAULTS.shake) !== false,
    particles: (g.particles ?? l.particles ?? SETTINGS_DEFAULTS.particles) !== false,
    flash: (g.flash ?? l.flash ?? SETTINGS_DEFAULTS.flash) !== false,
    muted: !!(g.muted ?? (l.muted === true) ?? SETTINGS_DEFAULTS.muted),
  };
}

export function saveSettings(patch) {
  const next = Object.assign(getSettings(), patch || {});
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* private mode */ }
  volume = next.volume;
  muted = !!next.muted;
  if (MasterGain) MasterGain.gain.value = muted ? 0 : 0.7 * volume;
  return next;
}

export function difficultyMult() {
  const d = getSettings().difficulty;
  return d === 'chill' ? 0.85 : d === 'blizzard' ? 1.18 : 1;
}

export function fxOn(kind) {
  const s = getSettings();
  return kind === 'shake' ? !!s.shake : kind === 'particles' ? !!s.particles : kind === 'flash' ? !!s.flash : true;
}

/* Apply stored volume/mute at boot (before any AudioContext exists). */
try {
  const s = getSettings();
  volume = s.volume;
  muted = !!s.muted;
} catch (e) { /* ignore */ }

function getAudioContext() {
  if (AudioCtx) return AudioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  AudioCtx = new AC();
  MasterGain = AudioCtx.createGain();
  MasterGain.gain.value = muted ? 0 : 0.7 * volume;
  Compressor = AudioCtx.createDynamicsCompressor();
  Compressor.threshold.value = -18;
  Compressor.knee.value = 12;
  Compressor.ratio.value = 4;
  Compressor.attack.value = 0.003;
  Compressor.release.value = 0.1;
  MasterGain.connect(Compressor);
  Compressor.connect(AudioCtx.destination);
  const len = Math.floor(AudioCtx.sampleRate * 0.7);
  NoiseBuffer = AudioCtx.createBuffer(1, len, AudioCtx.sampleRate);
  const d = NoiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return AudioCtx;
}

export function unlockAudio() {
  const ac = getAudioContext();
  if (ac && ac.state === 'suspended') ac.resume();
}

export function tone(opts) {
  const ac = getAudioContext();
  if (!ac) return;
  const t0 = ac.currentTime + (opts.delay || 0);
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(opts.f0, t0);
  if (opts.f1 && opts.f1 !== opts.f0) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t0 + opts.dur);
  }
  if (opts.detune) osc.detune.value = opts.detune;
  const peak = opts.vol ?? 0.3;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + (opts.atk || 0.006));
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(gain);
  gain.connect(MasterGain);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.02);
}

export function noiseBurst(opts) {
  const ac = getAudioContext();
  if (!ac || !NoiseBuffer) return;
  const t0 = ac.currentTime + (opts.delay || 0);
  const src = ac.createBufferSource();
  const gain = ac.createGain();
  src.buffer = NoiseBuffer;
  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = opts.hpf || 800;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(opts.vol || 0.25, t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(hp);
  hp.connect(gain);
  gain.connect(MasterGain);
  src.start(t0);
  src.stop(t0 + opts.dur + 0.02);
}

export function playSample(name) {
  const ac = getAudioContext();
  if (!ac || !buffers[name]) return;
  const src = ac.createBufferSource();
  src.buffer = buffers[name];
  src.connect(MasterGain);
  src.start(ac.currentTime);
}

export function loadSamples(manifest) {
  const ac = getAudioContext();
  if (!ac) return;
  Object.entries(manifest).forEach(([name, url]) => {
    fetch(url)
      .then(r => r.ok ? r.arrayBuffer() : Promise.reject())
      .then(buf => ac.decodeAudioData(buf))
      .then(decoded => { buffers[name] = decoded; })
      .catch(() => { /* synth fallback */ });
  });
}

export function setMuted(v) {
  muted = v;
  if (MasterGain) MasterGain.gain.value = v ? 0 : 0.7 * volume;
  try {
    const cur = readJSON(SETTINGS_KEY) || {};
    cur.muted = !!v;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(getSettings(), cur)));
  } catch (e) { /* private mode */ }
}

export function isMuted() { return muted; }

export function setVolume(v) {
  saveSettings({ volume: Math.min(1, Math.max(0, Number(v) || 0)) });
}
export function getVolume() { return volume; }

/* ─── Particle pool ─── */
const PARTICLE_CAP = 500;
const particlePool = [];
let particleCount = 0;

function createParticle() {
  return {
    x: 0, y: 0, vx: 0, vy: 0,
    life: 0, maxLife: 1,
    size: 2, color: '#fff',
    gravity: 0, fade: true,
    active: false
  };
}

function getParticle() {
  for (let i = 0; i < particlePool.length; i++) {
    if (!particlePool[i].active) return particlePool[i];
  }
  if (particlePool.length < PARTICLE_CAP) {
    const p = createParticle();
    particlePool.push(p);
    return p;
  }
  let oldest = 0, minLife = Infinity;
  for (let i = 0; i < particlePool.length; i++) {
    if (particlePool[i].life < minLife) { minLife = particlePool[i].life; oldest = i; }
  }
  return particlePool[oldest];
}

export function spawnParticles(opts) {
  if (!fxOn('particles')) return; // global FX toggle — one choke point for all arcade games
  const { x, y, count = 10, color = '#fff', speed = 120, spread = Math.PI * 2,
          life = 0.6, size = 2, gravity = 0, angle = 0, cone = Math.PI * 2 } = opts;
  for (let i = 0; i < count; i++) {
    const p = getParticle();
    const a = angle + (Math.random() - 0.5) * cone;
    const s = speed * (0.5 + Math.random() * 0.8);
    p.x = x; p.y = y;
    p.vx = Math.cos(a) * s;
    p.vy = Math.sin(a) * s;
    p.life = p.maxLife = life * (0.7 + Math.random() * 0.6);
    p.size = size * (0.6 + Math.random() * 0.8);
    p.color = color;
    p.gravity = gravity;
    p.active = true;
    particleCount++;
  }
}

export function updateParticles(dt) {
  for (let i = 0; i < particlePool.length; i++) {
    const p = particlePool[i];
    if (!p.active) continue;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.gravity * dt;
    p.life -= dt;
    if (p.life <= 0) { p.active = false; particleCount--; }
  }
}

export function drawParticles(ctx) {
  for (let i = 0; i < particlePool.length; i++) {
    const p = particlePool[i];
    if (!p.active) continue;
    const alpha = p.life / p.maxLife;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.size * alpha), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function clearParticles() {
  particlePool.forEach(p => p.active = false);
  particleCount = 0;
}

/* ─── High-score storage ─── */
const STORAGE_PREFIX = 'frost-arcade:';

export function saveScore(gameKey, score) {
  try {
    const key = STORAGE_PREFIX + gameKey + ':best';
    const current = parseInt(localStorage.getItem(key), 10) || 0;
    if (score > current) localStorage.setItem(key, String(score));
  } catch (e) { /* private mode */ }
}

export function getBestScore(gameKey) {
  try {
    return parseInt(localStorage.getItem(STORAGE_PREFIX + gameKey + ':best'), 10) || 0;
  } catch (e) { return 0; }
}

export function saveState(gameKey, state) {
  try {
    localStorage.setItem(STORAGE_PREFIX + gameKey + ':state', JSON.stringify(state));
  } catch (e) { /* private mode */ }
}

export function loadState(gameKey) {
  try {
    const s = localStorage.getItem(STORAGE_PREFIX + gameKey + ':state');
    return s ? JSON.parse(s) : null;
  } catch (e) { return null; }
}

/* ─── Input helpers ─── */
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; });
window.addEventListener('keyup', e => { keys[e.code] = false; });

export function keyDown(code) { return !!keys[code]; }
export function keyPressed(code) { const v = keys[code]; keys[code] = false; return v; }

export function createVirtualJoystick(element, opts = {}) {
  const { zone = element, maxRadius = 60, deadzone = 0.15 } = opts;
  let active = false, startX = 0, startY = 0, currentX = 0, currentY = 0;
  const state = { x: 0, y: 0, active: false };

  function update(pos) {
    const dx = pos.x - startX;
    const dy = pos.y - startY;
    const dist = Math.hypot(dx, dy);
    if (dist < deadzone * maxRadius) { state.x = 0; state.y = 0; return; }
    const clamped = Math.min(dist, maxRadius) / maxRadius;
    state.x = Math.cos(Math.atan2(dy, dx)) * clamped;
    state.y = Math.sin(Math.atan2(dy, dx)) * clamped;
  }

  zone.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    active = true;
    const rect = zone.getBoundingClientRect();
    startX = currentX = e.clientX - rect.left;
    startY = currentY = e.clientY - rect.top;
    state.active = true;
    e.preventDefault();
  }, { passive: false });

  window.addEventListener('pointermove', e => {
    if (!active) return;
    const rect = zone.getBoundingClientRect();
    currentX = e.clientX - rect.left;
    currentY = e.clientY - rect.top;
    update({ x: currentX, y: currentY });
  }, { passive: false });

  window.addEventListener('pointerup', e => {
    if (!active) return;
    active = false;
    state.x = 0; state.y = 0; state.active = false;
  });

  return state;
}

/* ─── Constants ─── */
export { PARTICLE_CAP };