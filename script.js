/* ============================================================================
 *  FROST BREAKOUT ❄️
 *  A neon-frost reimagining of the classic Breakout arcade game.
 *
 *  Built with:  HTML5 Canvas 2D  ·  CSS3  ·  Vanilla JavaScript
 *  Sections:
 *    00 · Utilities
 *    01 · Canvas / renderer bootstrap
 *    02 · Audio engine  (WebAudio synth + optional WAV samples)
 *    03 · Game data     (brick types, power-ups, level blueprints)
 *    04 · Entities      (Ball, Paddle, Brick, PowerUp, particles)
 *    05 · World state + level generation
 *    06 · Simulation    (update / physics / collisions)
 *    07 · Rendering     (background → arena → entities → effects)
 *    08 · Input         (keyboard, pointer, touch controls)
 *    09 · UI glue + boot
 * ==========================================================================*/

(function () {
  'use strict';

  /* ==========================================================================
   * 00 · UTILITIES
   * ======================================================================== */

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (max = 1, min = 0) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(max + 1, min));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeInCubic = (t) => t * t * t;

  /** Deterministic PRNG — keeps the scenery identical on every resize. */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Rounded-rect path helper (no reliance on ctx.roundRect support). */
  function rrPath(g, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rad, y);
    g.lineTo(x + w - rad, y);
    g.arcTo(x + w, y, x + w, y + rad, rad);
    g.lineTo(x + w, y + h - rad);
    g.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    g.lineTo(x + rad, y + h);
    g.arcTo(x, y + h, x, y + h - rad, rad);
    g.lineTo(x, y + rad);
    g.arcTo(x, y, x + rad, y, rad);
    g.closePath();
  }

  /* Colour shortcuts used all over the renderer */
  const C = {
    ice: [186, 238, 255],
    cyan: [92, 228, 255],
    blue: [58, 158, 232],
    deep: [24, 78, 140],
    violet: [154, 142, 255],
    rose: [255, 132, 194],
    gold: [255, 208, 118],
    mint: [124, 255, 206],
    slate: [118, 146, 182],
    white: [255, 255, 255],
  };

  /* ==========================================================================
   * 01 · CANVAS / RENDERER BOOTSTRAP
   * ======================================================================== */

  const W = 960;             // logical width  (canvas is resolution-independent)
  const H = 640;             // logical height
  const PLAY = { x: 30, y: 34, w: 900, h: 572 };
  PLAY.right = PLAY.x + PLAY.w;
  PLAY.bottom = PLAY.y + PLAY.h;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const stage = document.getElementById('stage');

  let DPR = 1;
  let staticLayer = null;   // pre-rendered background + arena chrome
  let brickGlowLayer = null;
  let brickGlowDirty = true;

  function resize() {
    DPR = clamp(window.devicePixelRatio || 1, 1, 2.5);
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    buildStaticLayer();
    if (G.bricks && G.bricks.length) buildBrickGlowLayer();
  }

  /* --- cached radial glow sprites (cheap alternative to shadowBlur) ------- */
  const glowCache = new Map();
  function glow(rgb, alpha) {
    const a = Math.round(alpha * 20) / 20;
    const key = rgb.join() + '|' + a;
    let spr = glowCache.get(key);
    if (!spr) {
      const s = 128;
      spr = document.createElement('canvas');
      spr.width = spr.height = s;
      const g = spr.getContext('2d');
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grd.addColorStop(0, rgba(rgb, a));
      grd.addColorStop(0.32, rgba(rgb, a * 0.5));
      grd.addColorStop(0.62, rgba(rgb, a * 0.16));
      grd.addColorStop(1, rgba(rgb, 0));
      g.fillStyle = grd;
      g.fillRect(0, 0, s, s);
      glowCache.set(key, spr);
    }
    return spr;
  }

  /** Draw an additive glow blob centred on (x, y) with radius r. */
  function drawGlow(x, y, r, rgb, a) {
    if (a <= 0.004 || r <= 0) return;
    const spr = glow(rgb, a);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(spr, x - r, y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ==========================================================================
   * 02 · AUDIO ENGINE
   * Tiny WebAudio synth. If real samples exist in assets/sounds/*.wav they are
   * used instead; otherwise everything is generated procedurally, so the game
   * never depends on external media loading.
   * ======================================================================== */

  const Sound = (function () {
    const FILES = {
      launch: 'launch', paddle: 'paddle', wall: 'wall', bounce: 'bounce',
      brick: 'brick', powerup: 'powerup', level: 'level',
      gameover: 'gameover', life: 'life', shield: 'shield',
    };

    let ac = null, master = null, noiseBuf = null;
    const buffers = {};
    const lastPlay = {};
    let muted = false;
    let volume = 0.8;
    try {
      const gv = JSON.parse(localStorage.getItem('frost-arcade:settings') || 'null');
      const sv = (gv && typeof gv.volume === 'number') ? gv.volume : parseFloat(localStorage.getItem('frost-breakout:volume'));
      if (!isNaN(sv)) volume = Math.min(1, Math.max(0, sv));
    } catch (e) { /* ignore */ }
    function applyGain() { if (master) master.gain.value = muted ? 0 : 0.55 * volume; }

    function init() {
      if (ac) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 8;
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.55 * volume;
      master.connect(comp);
      comp.connect(ac.destination);

      const len = Math.floor(ac.sampleRate * 0.7);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    }

    function unlock() {
      if (!init()) return;
      if (ac.state === 'suspended') ac.resume();
    }

    /** Try to load authored WAV samples; silently fall back to the synth. */
    function loadSamples() {
      /* Opened straight off disk? Chrome blocks fetch() on file:// (opaque
         origin), so skip it entirely rather than log a wall of CORS errors —
         the synth voices below are the intended fallback anyway. */
      if (location.protocol === 'file:') return;
      if (!init()) return;
      Object.keys(FILES).forEach(function (name) {
        fetch('assets/sounds/' + FILES[name] + '.wav')
          .then(function (r) { return r.ok ? r.arrayBuffer() : Promise.reject(); })
          .then(function (buf) { return ac.decodeAudioData(buf); })
          .then(function (decoded) { buffers[name] = decoded; })
          .catch(function () { /* synth fallback stays active */ });
      });
    }

    function tone(o) {
      if (!ac) return;
      const t0 = ac.currentTime + (o.delay || 0);
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.f0, t0);
      if (o.f1 && o.f1 !== o.f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
      if (o.detune) osc.detune.value = o.detune;
      const peak = (o.vol == null ? 0.3 : o.vol);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + (o.atk || 0.006));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      osc.connect(gain); gain.connect(master);
      osc.start(t0); osc.stop(t0 + o.dur + 0.02);
    }

    function noise(o) {
      if (!ac) return;
      const t0 = ac.currentTime + (o.delay || 0);
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const filt = ac.createBiquadFilter();
      filt.type = o.filter || 'bandpass';
      filt.frequency.value = o.freq || 1600;
      filt.Q.value = o.q == null ? 1 : o.q;
      const gain = ac.createGain();
      const peak = o.vol == null ? 0.25 : o.vol;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + (o.atk || 0.004));
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
      src.connect(filt); filt.connect(gain); gain.connect(master);
      src.start(t0); src.stop(t0 + o.dur + 0.02);
    }

    /* --- procedural recipes (used when no sample file is present) --------- */
    const SYNTH = {
      launch: function () {
        tone({ f0: 320, f1: 900, type: 'sine', dur: 0.13, vol: 0.26 });
        noise({ dur: 0.09, vol: 0.10, freq: 2400, q: 0.8 });
      },
      paddle: function () {
        tone({ f0: 480, f1: 760, type: 'triangle', dur: 0.10, vol: 0.30 });
        noise({ dur: 0.05, vol: 0.10, freq: 2200, q: 1.4 });
      },
      wall: function () {
        tone({ f0: 1500, f1: 1150, type: 'sine', dur: 0.055, vol: 0.13 });
      },
      bounce: function () {
        tone({ f0: 700, f1: 980, type: 'sine', dur: 0.07, vol: 0.16 });
      },
      brick: function () {
        noise({ dur: 0.17, vol: 0.30, freq: 2800, q: 1.1 });
        tone({ f0: 880, f1: 400, type: 'square', dur: 0.10, vol: 0.13 });
      },
      powerup: function () {
        [660, 880, 1320].forEach(function (f, i) {
          tone({ f0: f, type: 'triangle', dur: 0.16, vol: 0.22, delay: i * 0.055 });
        });
      },
      level: function () {
        [523, 659, 784, 1047].forEach(function (f, i) {
          tone({ f0: f, type: 'triangle', dur: 0.26, vol: 0.20, delay: i * 0.085 });
          tone({ f0: f * 2, type: 'sine', dur: 0.20, vol: 0.07, delay: i * 0.085 });
        });
      },
      shield: function () {
        [880, 1174, 1568].forEach(function (f, i) {
          tone({ f0: f, type: 'sine', dur: 0.34, vol: 0.16, delay: i * 0.04 });
        });
      },
      life: function () {
        tone({ f0: 300, f1: 70, type: 'sawtooth', dur: 0.42, vol: 0.24 });
        noise({ dur: 0.30, vol: 0.14, freq: 500, filter: 'lowpass' });
      },
      gameover: function () {
        [392, 330, 262, 196].forEach(function (f, i) {
          tone({ f0: f, type: 'triangle', dur: 0.42, vol: 0.22, delay: i * 0.15 });
        });
      },
    };

    function play(name, vol) {
      if (muted || !ac) return;
      const now = performance.now();
      const gap = name === 'wall' ? 28 : name === 'brick' ? 16 : 0;
      if (gap && lastPlay[name] && now - lastPlay[name] < gap) return;
      lastPlay[name] = now;

      if (buffers[name]) {
        const src = ac.createBufferSource();
        const g = ac.createGain();
        src.buffer = buffers[name];
        g.gain.value = vol == null ? 0.8 : vol;
        src.connect(g); g.connect(master);
        src.start();
        return;
      }
      const recipe = SYNTH[name];
      if (recipe) recipe();
    }

    return {
      unlock: unlock,
      loadSamples: loadSamples,
      play: play,
      sampleNames: function () { return Object.keys(buffers); },
      setMuted: function (v) {
        muted = v;
        applyGain();
      },
      isMuted: function () { return muted; },
      setVolume: function (v) {
        volume = Math.min(1, Math.max(0, Number(v) || 0));
        try {
          localStorage.setItem('frost-breakout:volume', String(volume));
          const g = loadJSON('frost-arcade:settings', {});
          g.volume = volume;
          localStorage.setItem('frost-arcade:settings', JSON.stringify(Object.assign(loadJSON('frost-breakout:settings', {}), g)));
        } catch (e) { /* ignore */ }
        applyGain();
      },
      getVolume: function () { return volume; },
    };
  })();

  /* ==========================================================================
   * 03 · GAME DATA
   * ======================================================================== */

  /* --- brick / crystal types --------------------------------------------- */
  const BT = {
    glacier: { label: 'Glacier', hp: 1, score: 10, top: C.ice,   bot: [34, 108, 170], edge: [205, 244, 255], aura: C.cyan },
    frost:   { label: 'Frost',   hp: 2, score: 25, top: [138, 208, 255], bot: [30, 86, 160],  edge: [160, 220, 255], aura: C.blue },
    pack:    { label: 'Pack Ice',hp: 3, score: 55, top: [120, 172, 250], bot: [24, 62, 138],  edge: [140, 196, 255], aura: [96, 152, 255] },
    ember:   { label: 'Ember',   hp: 2, score: 40, top: [216, 170, 255], bot: [88, 50, 152],  edge: [232, 198, 255], aura: C.violet, crack: [255, 196, 255] },
    bedrock: { label: 'Bedrock', hp: Infinity, score: 0, top: [96, 118, 150], bot: [26, 40, 62], edge: [140, 165, 195], aura: C.slate },
  };

  /* --- power-ups ---------------------------------------------------------- */
  const PU = {
    multi:   { key: 'multi',   glyph: '❄️', label: 'MULTI BALL',  color: C.cyan,   tag: 'x3' },
    wide:    { key: 'wide',    glyph: '🧊', label: 'WIDE PADDLE', color: [150, 220, 255], tag: 'WIDE' },
    fast:    { key: 'fast',    glyph: '⚡', label: 'FROST DASH',  color: C.gold,   tag: 'FAST' },
    diamond: { key: 'diamond', glyph: '💎', label: 'BONUS',       color: C.mint,   tag: '+$' },
    shield:  { key: 'shield',  glyph: '🛡️', label: 'FROST SHIELD', color: [190, 200, 255], tag: 'SHIELD' },
  };
  const PU_ORDER = ['multi', 'wide', 'fast', 'diamond', 'shield'];

  /* --- level blueprints --------------------------------------------------- */
  const LEVELS = [
    { name: 'GLACIER SHELF',   pattern: 'solid',     rows: 5, speed: 330, drop: 0.085 },
    { name: 'FROST PYRAMID',   pattern: 'pyramid',   rows: 6, speed: 344, drop: 0.090 },
    { name: 'CRYSTAL TIDES',   pattern: 'waves',     rows: 7, speed: 358, drop: 0.095 },
    { name: 'FROZEN FORTRESS', pattern: 'fortress',  rows: 7, speed: 374, drop: 0.100 },
    { name: 'DIAMOND CORE',    pattern: 'diamond',   rows: 8, speed: 392, drop: 0.105 },
    { name: 'AURORA CROSS',    pattern: 'cross',     rows: 8, speed: 408, drop: 0.110 },
    { name: 'ICE CATHEDRAL',   pattern: 'cathedral', rows: 9, speed: 426, drop: 0.118 },
    { name: 'HEART OF WINTER', pattern: 'chevron',   rows: 9, speed: 448, drop: 0.130 },
  ];

  /* --- layout masks: (c, r, cols, rows) → boolean ------------------------- */
  const PATTERNS = {
    solid: function () { return true; },
    pyramid: function (c, r, cols) { return Math.abs(c - (cols - 1) / 2) <= r + 0.4; },
    diamond: function (c, r, cols, rows) {
      const dc = Math.abs(c - (cols - 1) / 2) / ((cols - 1) / 2 || 1);
      const dr = Math.abs(r - (rows - 1) / 2) / ((rows - 1) / 2 || 1);
      return dc + dr <= 1.02;
    },
    waves: function (c, r) { return Math.sin(c * 0.9 + r * 1.35) * 0.5 + 0.5 > 0.26; },
    fortress: function (c, r, cols, rows) {
      const gate = r >= Math.floor(rows * 0.4) && r <= Math.floor(rows * 0.72) && c >= 3 && c <= cols - 4;
      const wallGap = (c === 1 || c === cols - 2) && (r % 3 === 1);
      return !gate && !wallGap;
    },
    cross: function (c, r, cols, rows) {
      const dc = Math.abs(c - (cols - 1) / 2), dr = Math.abs(r - (rows - 1) / 2);
      return dc <= cols * 0.15 || dr <= rows * 0.16;
    },
    cathedral: function (c, r, cols, rows) {
      const dc = Math.abs(c - (cols - 1) / 2) / ((cols - 1) / 2 || 1);
      const dr = Math.abs(r - (rows - 1) / 2) / ((rows - 1) / 2 || 1);
      const ring = Math.max(dc, dr), hole = Math.min(dc, dr);
      return ring > 0.34 && ring < 0.95 && hole > 0.32;
    },
    chevron: function (c, r) {
      return Math.abs(((c + r) % 9) - 4) <= 1.6 || Math.abs(((c - r) % 9) - 4) <= 1.2;
    },
  };

  const MAX_BALLS = 9;
  const MAX_PARTICLES = 460;   // ceiling so heavy multi-ball moments stay smooth
  const START_LIVES = 3;

  /* ==========================================================================
   * 04 · ENTITIES
   * ======================================================================== */

  /* -------------------------------------------------------------- Ball ---- */
  function Ball(x, y, speed, angle) {
    this.x = x; this.y = y;
    this.r = 8;
    this.speed = speed;
    this.baseSpeed = speed;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.trail = [];
    this.stuck = true;
    this.dx = 0;              // horizontal offset from paddle while stuck
    this.spin = rand(TAU);
    this.spinRate = rand(1.6, -1.6);
    this.dead = false;
    this.hitFlash = 0;
  }

  Ball.prototype.followPaddle = function (p) {
    this.x = p.x + this.dx;
    this.y = p.y - p.h / 2 - this.r - 2;
  };

  Ball.prototype.launch = function (spread) {
    this.stuck = false;
    const a = -Math.PI / 2 + rand(spread == null ? 0.55 : spread, spread == null ? -0.55 : -spread);
    this.speed = this.baseSpeed;
    this.vx = Math.cos(a) * this.speed;
    this.vy = Math.sin(a) * this.speed;
  };

  Ball.prototype.setSpeed = function (s) {
    const sp = Math.hypot(this.vx, this.vy) || 1;
    this.vx = (this.vx / sp) * s;
    this.vy = (this.vy / sp) * s;
    this.speed = s;
  };

  /* ------------------------------------------------------------ Paddle ---- */
  function Paddle() {
    this.baseW = 126;
    this.w = this.baseW;
    this.h = 17;
    this.x = W / 2;
    this.y = PLAY.bottom - 40;
    this.tx = this.x;
    this.targetX = this.x;
    this.prevX = this.x;
    this.power = 0;
    this.glowPulse = 0;
  }

  Paddle.prototype.update = function (dt, input) {
    this.prevX = this.x;
    const speed = 760;

    if (input.pointerActive) {
      this.tx = lerp(this.tx, input.pointerX, clamp(dt * 26, 0, 1));
      this.x += clamp(this.tx - this.x, -speed * dt, speed * dt);
    } else {
      this.tx = this.x;
      this.x += input.axis * speed * dt;
    }

    const half = this.w / 2;
    this.x = clamp(this.x, PLAY.x + half, PLAY.right - half);
    this.glowPulse += dt;
  };

  /* ------------------------------------------------------------- Brick ---- */
  function Brick(x, y, w, h, type) {
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.type = type;
    this.maxHp = type.hp;
    this.hp = type.hp;
    this.indestructible = type.hp === Infinity;
    this.alive = true;
    this.hit = 0;             // hit flash 0→1
    this.pop = 0;             // impact scale pop
    this.sheen = rand(TAU);
    this.cracks = null;
    this.seed = Math.random();
  }

  /* ----------------------------------------------------------- PowerUp ---- */
  function PowerUp(x, y, def) {
    this.x = x; this.y = y;
    this.def = def;
    this.w = 32; this.h = 32;
    this.vy = 152;
    this.spin = 0;
    this.life = 0;
    this.magnet = 0;
  }

  PowerUp.prototype.update = function (dt, paddle) {
    this.life += dt;
    this.spin += dt * 2.4;

    const near = Math.abs(this.x - paddle.x) < 96 && this.y > paddle.y - 130;
    this.magnet = lerp(this.magnet, near ? 1 : 0, clamp(dt * 6, 0, 1));
    if (this.magnet > 0.02) {
      const dx = paddle.x - this.x, dy = (paddle.y - this.h / 2) - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.x += (dx / d) * 460 * dt * this.magnet;
      this.y += (dy / d) * 460 * dt * this.magnet;
    } else {
      this.y += this.vy * dt;
    }
  };

  /* --------------------------------------------------------- Particles ---- */
  function spawnShatter(b, hx, hy, nx, ny, amount) {
    if (!fxOn('particles')) return;
    const a = b.type.aura;
    for (let i = 0; i < amount; i++) {
      const ang = rand(TAU);
      const sp = rand(280, 60);
      G.particles.push({
        kind: 'shard',
        x: hx + rand(b.w * 0.5, -b.w * 0.5),
        y: hy + rand(b.h * 0.5, -b.h * 0.5),
        vx: Math.cos(ang) * sp + nx * rand(150, 40),
        vy: Math.sin(ang) * sp + ny * rand(150, 40),
        rot: rand(TAU), vr: rand(9, -9),
        size: rand(9, 3),
        life: 0, max: rand(0.95, 0.45),
        color: Math.random() < 0.3 ? C.ice : a,
      });
    }
    for (let i = 0; i < Math.ceil(amount * 0.7); i++) {
      const ang = rand(TAU);
      const sp = rand(340, 90);
      G.particles.push({
        kind: 'spark',
        x: hx, y: hy,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 0, max: rand(0.5, 0.22),
        color: Math.random() < 0.5 ? C.white : C.ice,
      });
    }
    for (let i = 0; i < 4; i++) {
      G.particles.push({
        kind: 'mist',
        x: hx + rand(10, -10), y: hy + rand(8, -8),
        vx: rand(30, -30), vy: rand(-6, -34),
        r0: rand(9, 3), r1: rand(46, 22),
        life: 0, max: rand(0.85, 0.45),
        color: a,
      });
    }
    if (Math.random() < 0.5) {
      G.particles.push({
        kind: 'glint', x: hx, y: hy,
        rot: rand(TAU), vr: rand(2.4, -2.4),
        size: rand(20, 10), life: 0, max: 0.4, color: C.white,
      });
    }
  }

  function spawnRing(x, y, rgb, r0, r1, dur, width) {
    G.rings.push({ x: x, y: y, r0: r0, r1: r1, life: 0, max: dur, color: rgb, w: width || 3 });
  }

  function spawnText(x, y, str, rgb, size, rise) {
    G.texts.push({
      x: x, y: y, str: str, color: rgb,
      size: size || 18, life: 0, max: 0.95, rise: rise || 46,
    });
  }

  function spawnBurst(x, y, rgb, amount, power) {
    if (!fxOn('particles')) amount = Math.min(amount, 4);
    for (let i = 0; i < amount; i++) {
      const ang = rand(TAU), sp = rand(1, 0.25) * (power || 300);
      G.particles.push({
        kind: 'spark',
        x: x, y: y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        life: 0, max: rand(0.7, 0.3), color: Math.random() < 0.4 ? C.white : rgb,
      });
    }
    for (let i = 0; i < Math.ceil(amount * 0.5); i++) {
      const ang = rand(TAU), sp = rand(1, 0.3) * (power || 260);
      G.particles.push({
        kind: 'shard',
        x: x, y: y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        rot: rand(TAU), vr: rand(10, -10), size: rand(8, 3),
        life: 0, max: rand(0.8, 0.4),
        color: Math.random() < 0.4 ? C.white : rgb,
      });
    }
  }

  /* ==========================================================================
   * 05 · WORLD STATE + LEVEL GENERATION
   * ======================================================================== */

  const BEST_KEY = 'frost-breakout:best';
  const MUTED_KEY = 'frost-breakout:muted';

  function loadBest() {
    try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) { /* private mode */ }
  }
  function loadMuted() {
    try {
      const g = JSON.parse(localStorage.getItem('frost-arcade:settings') || 'null');
      if (g && typeof g.muted === 'boolean') return g.muted;
      return localStorage.getItem(MUTED_KEY) === '1';
    } catch (e) { return false; }
  }
  function saveMuted(v) {
    try {
      localStorage.setItem(MUTED_KEY, v ? '1' : '0');
      const g = loadJSON('frost-arcade:settings', {});
      g.muted = !!v;
      localStorage.setItem('frost-arcade:settings', JSON.stringify(Object.assign(loadJSON('frost-breakout:settings', {}), g)));
    } catch (e) { /* private mode */ }
  }

  /* --- extended settings / event bus (added for extras: settings, achievements) --- */
  function loadJSON(key, fb) {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fb; } catch (e) { return fb; }
  }
  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent('fb:' + name, { detail: detail || {} })); } catch (e) { /* ignore */ }
  }
  /* Global arcade settings win; legacy per-game key is a fallback so existing
     players keep their choices. */
  function getSettings() {
    const s = loadJSON('frost-breakout:settings', {});
    const g = loadJSON('frost-arcade:settings', {});
    const m = Object.assign({}, s, g);
    return {
      difficulty: m.difficulty || 'normal',
      volume: (typeof m.volume === 'number' ? m.volume : Sound.getVolume()),
      shake: (m.shake !== false),
      particles: (m.particles !== false),
      flash: (m.flash !== false),
    };
  }
  function difficultyMult() {
    const d = getSettings().difficulty;
    return d === 'chill' ? 0.85 : d === 'blizzard' ? 1.18 : 1;
  }
  function fxOn(kind) { return getSettings()[kind] !== false; }
  function guardedShake(v) { if (fxOn('shake')) G.shake = Math.max(G.shake, v); }
  function effectiveSpeed(base) { return base * difficultyMult(); }

  const G = {
    state: 'menu',            // menu | serve | play | levelclear | dying | gameover | victory
    stateT: 0,
    time: 0,                  // global animation clock
    score: 0,
    best: loadBest(),
    lives: START_LIVES,
    level: 1,
    bricksTotal: 0,
    bricksBroken: 0,
    combo: 0,
    bestCombo: 0,
    shield: 0,               // frost shield seconds remaining
    shieldMax: 18,
    flash: 0,
    flashColor: C.ice,
    shake: 0,
    mode: 'classic',        // classic | daily | endless | custom
    endlessDepth: 0,
    paddle: new Paddle(),
    balls: [],
    bricks: [],
    powerups: [],
    particles: [],
    rings: [],
    texts: [],
    snow: [],
    bgCrystals: [],
  };

  function makeSnow() {
    G.snow.length = 0;
    for (let i = 0; i < 70; i++) {
      const near = i % 5 === 0;
      G.snow.push({
        x: rand(W), y: rand(H),
        r: near ? rand(2.6, 1.4) : rand(1.5, 0.6),
        vx: near ? rand(-14, -34) : rand(-6, -18),
        vy: near ? rand(30, 64) : rand(12, 30),
        a: near ? rand(0.5, 0.22) : rand(0.34, 0.1),
        ph: rand(TAU),
        near: near,
      });
    }
    G.bgCrystals.length = 0;
    const rng = mulberry32(20240);
    for (let i = 0; i < 5; i++) {
      G.bgCrystals.push({
        x: rng() * W, y: 60 + rng() * (H - 220),
        r: 40 + rng() * 90,
        rot: rng() * TAU,
        vr: (rng() < 0.5 ? -1 : 1) * (0.05 + rng() * 0.08),
        a: 0.05 + rng() * 0.05,
        sides: 6,
      });
    }
  }

  /* --- choose a brick type for a grid cell ------------------------------- */
  function pickType(level, c, r, cols, rows) {
    const dc = Math.abs(c - (cols - 1) / 2) / ((cols - 1) / 2 || 1);
    const dr = Math.abs(r - (rows - 1) / 2) / ((rows - 1) / 2 || 1);
    const core = 1 - (dc + dr) / 2;            // 1 = centre, 0 = corners
    const roll = Math.random();
    const tier = level >= 5 ? 3 : level >= 3 ? 2 : 1;

    if (tier === 1) {
      return roll < 0.15 ? BT.frost : roll < 0.20 ? BT.pack : BT.glacier;
    }
    if (tier === 2) {
      if (core > 0.55) return roll < 0.34 ? BT.frost : BT.pack;
      return roll < 0.13 ? BT.pack : roll < 0.24 ? BT.frost : BT.glacier;
    }
    if (core > 0.62) return roll < 0.30 ? BT.pack : BT.frost;
    if (roll < 0.16) return BT.frost;
    if (roll < 0.24) return BT.pack;
    if (level >= 4 && roll < 0.30) return BT.ember;
    return BT.glacier;
  }

  function buildLevel(level) {
    const cfg = LEVELS[level - 1];
    const cols = level >= 5 ? 13 : level >= 3 ? 12 : 11;
    const rows = cfg.rows;
    const padX = 16, gapX = 6, gapY = 7;
    const cw = (PLAY.w - padX * 2 - gapX * (cols - 1)) / cols;
    const ch = 24;
    const top = PLAY.y + 54;
    const mask = PATTERNS[cfg.pattern];
    const bricks = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!mask(c, r, cols, rows)) continue;
        const type = pickType(level, c, r, cols, rows);
        bricks.push(new Brick(PLAY.x + padX + c * (cw + gapX), top + r * (ch + gapY), cw, ch, type));
      }
    }

    /* Structural indestructible accents give each level its own silhouette. */
    if (cfg.pattern === 'fortress') {
      const colXs = [];
      for (let c = 0; c < cols; c++) colXs.push(PLAY.x + padX + c * (cw + gapX));
      const bedrockCells = [];
      [1, cols - 2].forEach(function (ci) {
        for (let r = 1; r < rows; r += 2) {
          bedrockCells.push({ x: colXs[ci], y: top + r * (ch + gapY), w: cw, h: ch });
        }
      });
      const midC = Math.floor(cols / 2);
      bedrockCells.push({ x: colXs[midC], y: top + (rows - 1) * (ch + gapY), w: cw * 2 + gapX, h: ch });
      /* replace (not stack onto) any destructible brick sharing the cell */
      const filtered = bricks.filter(function (b) {
        return !bedrockCells.some(function (bc) {
          return Math.abs(b.x - bc.x) < 1 && Math.abs(b.y - bc.y) < 1;
        });
      });
      bricks.length = 0;
      filtered.forEach(function (b) { bricks.push(b); });
      bedrockCells.forEach(function (bc) {
        bricks.push(new Brick(bc.x, bc.y, bc.w, bc.h, BT.bedrock));
      });
    }
    if (cfg.pattern === 'cathedral') {
      bricks.forEach(function (b) {
        const onEdge = b.y <= top + 0.5 || b.y >= top + (rows - 1) * (ch + gapY) - 0.5 ||
          b.x <= PLAY.x + padX + 0.5 || b.x >= PLAY.x + padX + (cols - 1) * (cw + gapX) - 0.5;
        if (onEdge) { b.type = BT.bedrock; b.maxHp = Infinity; b.hp = Infinity; b.indestructible = true; }
      });
    }
    if (level === LEVELS.length) {
      /* Finale: a couple of ember cores hidden in the field */
      const spots = bricks.filter(function (b) { return b.type === BT.glacier; });
      shuffle(spots);
      spots.slice(0, 4).forEach(function (b) {
        b.type = BT.ember; b.maxHp = 2; b.hp = 2; b.indestructible = false;
      });
    }

    G.bricks = bricks;
    G.bricksTotal = bricks.filter(function (b) { return !b.indestructible; }).length;
    brickGlowDirty = true;
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
  }

  /* --- level / game flow -------------------------------------------------- */

  function setState(s) {
    G.state = s;
    G.stateT = 0;
    syncUI();
  }

  function newBallOnPaddle() {
    const p = G.paddle;
    const base = (G.customSpeed || LEVELS[G.level - 1].speed);
    const b = new Ball(p.x, p.y, effectiveSpeed(base), -Math.PI / 2);
    b.dx = 0;
    b.followPaddle(p);
    G.balls = [b];
  }

  function startGame(opts) {
    opts = opts || {};
    G.mode = opts.mode || 'classic';
    G.endlessDepth = 0;
    G.customSpeed = opts.speed || null;
    G.customBricks = opts.bricks || null;
    G.score = (opts.score || 0);
    G.lives = (opts.lives != null ? opts.lives : START_LIVES);
    G.level = (opts.level || 1);
    G.bricksBroken = (opts.bricksBroken || 0);
    G.combo = 0;
    G.bestCombo = (opts.bestCombo || 0);
    G.dryCounter = 0;
    G.powerups.length = 0;
    G.particles.length = 0;
    G.rings.length = 0;
    G.texts.length = 0;
    G.paddle = new Paddle();
    emit('runstart', { mode: G.mode, level: G.level });
    loadLevel(G.level, { keepMode: true });
  }

  function buildEndlessLevel(depth) {
    const names = ['ENDLESS DRIFT', 'GLACIER MAZE', 'FROST SURGE', 'DEEP WINTER'];
    const patterns = Object.keys(PATTERNS);
    const pat = patterns[(depth + ((Math.random() * patterns.length) | 0)) % patterns.length];
    const lvl = Math.min(LEVELS.length, 3 + Math.floor(depth / 2));
    const cfg = LEVELS[lvl - 1];
    const cols = 11 + (depth % 3);
    const rows = Math.min(9, cfg.rows + Math.floor(depth / 3));
    const padX = 16, gapX = 6, gapY = 7;
    const cw = (PLAY.w - padX * 2 - gapX * (cols - 1)) / cols;
    const ch = 24;
    const top = PLAY.y + 54;
    const mask = PATTERNS[pat];
    const bricks = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!mask(c, r, cols, rows)) continue;
        const type = pickType(Math.min(8, 2 + depth), c, r, cols, rows);
        bricks.push(new Brick(PLAY.x + padX + c * (cw + gapX), top + r * (ch + gapY), cw, ch, type));
      }
    }
    G.bricks = bricks;
    G.bricksTotal = bricks.filter(function (b) { return !b.indestructible; }).length;
    brickGlowDirty = true;
    return names[depth % names.length] + ' · ' + (depth + 1);
  }

  function loadLevel(level, opts) {
    opts = opts || {};
    if (!opts.keepMode && !G.mode) G.mode = 'classic';
    if (G.mode === 'endless' && !opts.keepMode) { /* endless advances via depth */ }
    G.level = level;
    if (G.customBricks && G.mode === 'custom') {
      const padX = 16, gapX = 6, gapY = 7;
      const cols = G.customBricks.cols, rows = G.customBricks.rows;
      const cw = (PLAY.w - padX * 2 - gapX * (cols - 1)) / cols;
      const ch = 24;
      const top = PLAY.y + 54;
      G.bricks = [];
      G.customBricks.cells.forEach(function (cell) {
        const t = BT[cell.t] || BT.glacier;
        G.bricks.push(new Brick(PLAY.x + padX + cell.c * (cw + gapX), top + cell.r * (ch + gapY), cw, ch, t));
      });
      G.bricksTotal = G.bricks.filter(function (b) { return !b.indestructible; }).length;
      brickGlowDirty = true;
    } else if (G.mode === 'endless' && opts.endless) {
      const label = buildEndlessLevel(G.endlessDepth);
      G.paddle.power = 0;
      G.paddle.w = G.paddle.baseW;
      G.shield = 0;
      G.combo = 0;
      G.powerups.length = 0;
      newBallOnPaddle();
      showBanner('ENDLESS ' + (G.endlessDepth + 1), label);
      setState('serve');
      emit('level', { level: G.level, endless: G.endlessDepth, mode: G.mode });
      autosave();
      return;
    } else if (G.mode === 'daily' && G.dailySeed) {
      buildLevel(((G.dailySeed % LEVELS.length) + LEVELS.length) % LEVELS.length + 1);
      // daily = fixed layout + slightly faster ball for challenge
      G.bricksTotal = G.bricks.filter(function (b) { return !b.indestructible; }).length;
    } else {
      buildLevel(level);
    }
    G.paddle.power = 0;
    G.paddle.w = G.paddle.baseW;
    G.shield = 0;
    G.combo = 0;
    G.powerups.length = 0;
    newBallOnPaddle();
    const lname = (G.mode === 'custom' && G.customName) ? G.customName : LEVELS[Math.min(level, LEVELS.length) - 1].name;
    showBanner((G.mode === 'classic' ? 'LEVEL ' + level : G.mode.toUpperCase() + ' · ' + level), lname);
    setState('serve');
    emit('level', { level: level, mode: G.mode });
    autosave();
  }

  function saveRun() {
    try {
      const data = { mode: G.mode, level: G.level, score: G.score, lives: G.lives, bricksBroken: G.bricksBroken, bestCombo: G.bestCombo, endlessDepth: G.endlessDepth, t: Date.now() };
      localStorage.setItem('frost-breakout:run', JSON.stringify(data));
      return data;
    } catch (e) { return null; }
  }
  function loadRun() {
    return loadJSON('frost-breakout:run', null);
  }
  function clearRun() { try { localStorage.removeItem('frost-breakout:run'); } catch (e) { /* ignore */ } }
  function autosave() {
    if (G.state === 'menu') return;
    if (G.mode === 'classic' || G.mode === 'endless') saveRun();
  }

  function showBanner(title, sub, hold) {
    clearTimeout(ui.bannerTid);
    ui.bannerTitle.textContent = title;
    ui.bannerSub.textContent = sub || '';
    ui.banner.hidden = false;
    ui.banner.classList.remove('out');
    G.bannerTimer = hold || 1.5;
  }

  function hideBanner() {
    if (ui.banner.hidden) return;
    ui.banner.classList.add('out');
    clearTimeout(ui.bannerTid);
    ui.bannerTid = setTimeout(function () { ui.banner.hidden = true; }, 320);
  }

  function addScore(n) {
    G.score += Math.max(0, Math.round(n));
    if (G.score > G.best) { G.best = G.score; saveBest(G.best); }
    syncUI();
  }

  function comboMult() {
    return clamp(1 + Math.floor(G.combo / 6), 1, 5);
  }

  /* ==========================================================================
   * 06 · SIMULATION
   * ======================================================================== */

  /* --- ball vs brick ------------------------------------------------------ */
  function circleVsRect(bx, by, br, r) {
    const nx = clamp(bx, r.x, r.x + r.w);
    const ny = clamp(by, r.y, r.y + r.h);
    const dx = bx - nx, dy = by - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 > br * br) return null;
    const d = Math.sqrt(d2);
    if (d > 0.0001) return { nx: dx / d, ny: dy / d };
    /* centre inside → escape along the shallowest axis */
    const left = bx - r.x, right = r.x + r.w - bx, top = by - r.y, bot = r.y + r.h - by;
    const m = Math.min(left, right, top, bot);
    if (m === left) return { nx: -1, ny: 0 };
    if (m === right) return { nx: 1, ny: 0 };
    if (m === top) return { nx: 0, ny: -1 };
    return { nx: 0, ny: 1 };
  }

  function hitBrick(b, ball, n) {
    if (b.indestructible) {
      b.hit = 1;
      spawnShatter(b, ball.x - n.nx * ball.r * 0.4, ball.y - n.ny * ball.r * 0.4, -n.nx, -n.ny, 5);
      return;
    }

    b.hp -= 1;
    b.hit = 1;
    b.pop = 1;
    if (!b.cracks) b.cracks = makeCracks(b, 1 - b.hp / b.maxHp);
    else if (b.hp < b.maxHp - 1) b.cracks = makeCracks(b, 1 - b.hp / b.maxHp);

    const hx = ball.x - n.nx * ball.r * 0.5;
    const hy = ball.y - n.ny * ball.r * 0.5;

    if (b.hp <= 0) {
      b.alive = false;
      brickGlowDirty = true;
      G.bricksBroken++;
      spawnShatter(b, b.x + b.w / 2, b.y + b.h / 2, n.nx, n.ny, 16);
      spawnRing(b.x + b.w / 2, b.y + b.h / 2, b.type.aura, 4, b.w * 1.5, 0.45, 3);
      guardedShake(4);
      emit('brick', { type: b.type.label, score: b.type.score, combo: G.combo, level: G.level });

      const mult = comboMult();
      addScore(b.type.score * mult);
      if (mult > 1) {
        spawnText(b.x + b.w / 2, b.y + b.h / 2, '+' + b.type.score * mult + '  x' + mult, C.gold, 15);
      }

      /* chance to drop a power-up */
      const cfg = LEVELS[G.level - 1];
      if (Math.random() < cfg.drop) { G.dryCounter = 0; dropPowerUp(b.x + b.w / 2, b.y + b.h / 2); }
      else {
        G.dryCounter = (G.dryCounter || 0) + 1;
        if (G.dryCounter >= 11) { G.dryCounter = 0; dropPowerUp(b.x + b.w / 2, b.y + b.h / 2); }
      }
      Sound.play('brick');
      checkLevelCleared();
    } else {
      spawnShatter(b, hx, hy, n.nx, n.ny, 6);
      spawnRing(hx, hy, b.type.aura, 2, 26, 0.28, 2);
      addScore(Math.round(b.type.score * 0.15));
      Sound.play('bounce');
    }
  }

  function makeCracks(b, severity) {
    const rng = mulberry32(Math.floor(b.seed * 1e6) + b.maxHp * 31);
    const branches = [];
    const count = severity > 0.6 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      let x = 0.2 + rng() * 0.6, y = 0.2 + rng() * 0.6;
      const pts = [[x, y]];
      let ang = rng() * TAU;
      const segs = 2 + ((rng() * 2) | 0);
      for (let s = 0; s < segs; s++) {
        ang += (rng() - 0.5) * 1.5;
        const len = 0.16 + rng() * 0.2;
        x = clamp(x + Math.cos(ang) * len, 0.04, 0.96);
        y = clamp(y + Math.sin(ang) * len * 0.9, 0.08, 0.92);
        pts.push([x, y]);
      }
      branches.push(pts);
    }
    return branches;
  }

  function dropPowerUp(x, y) {
    const def = PU[pick(PU_ORDER)];
    const p = new PowerUp(clamp(x, PLAY.x + 20, PLAY.right - 20), y, def);
    G.powerups.push(p);
  }

  function checkLevelCleared() {
    const left = G.bricks.some(function (b) { return b.alive && !b.indestructible; });
    if (left) return;
    if (G.state === 'play' || G.state === 'serve') beginLevelClear();
  }

  function beginLevelClear() {
    const bonus = 400 * G.level + (G.mode === 'endless' ? 200 * G.endlessDepth : 0);
    addScore(bonus);
    spawnText(W / 2, PLAY.y + PLAY.h * 0.62, '+' + bonus, C.ice, 30, 70);
    Sound.play('level');
    if (fxOn('flash')) { G.flash = 0.55; G.flashColor = C.ice; }
    guardedShake(6);
    emit('levelclear', { level: G.level, mode: G.mode, endlessDepth: G.endlessDepth, score: G.score });
    /* celebratory ice storm */
    for (let i = 0; i < 26; i++) {
      const x = rand(PLAY.right - 10, PLAY.x + 10), y = rand(PLAY.bottom - 20, PLAY.y + 10);
      spawnBurst(x, y, C.cyan, 4, 240);
    }
    setState('levelclear');
  }

  /* --- paddle collision --------------------------------------------------- */
  function bounceOffPaddle(ball, p) {
    const rel = clamp((ball.x - p.x) / (p.w / 2), -1, 1);
    const MAXA = (62 * Math.PI) / 180;
    const angle = rel * MAXA;
    const sp = Math.hypot(ball.vx, ball.vy) || ball.speed;
    ball.vx = Math.sin(angle) * sp;
    ball.vy = -Math.abs(Math.cos(angle)) * sp;
    if (Math.abs(ball.vy) < sp * 0.3) ball.vy = -sp * 0.3;
    if (Math.abs(ball.vx) < sp * 0.18) ball.vx = (ball.vx >= 0 ? 1 : -1) * sp * 0.18;
    ball.y = p.y - p.h / 2 - ball.r - 0.5;
  }

  /* --- the workhorse: move one ball and resolve contacts ------------------ */
  function moveBall(ball, dt) {
    const p = G.paddle;
    let remaining = dt;

    while (remaining > 0.0001 && !ball.dead) {
      const sp = Math.hypot(ball.vx, ball.vy);
      if (sp < 1) { remaining = 0; break; }
      const maxStep = ball.r * 0.72;
      const need = sp * remaining;
      const step = need > maxStep ? maxStep / sp : remaining;
      ball.x += ball.vx * step;
      ball.y += ball.vy * step;
      remaining -= step;

      /* walls */
      if (ball.x - ball.r < PLAY.x) {
        ball.x = PLAY.x + ball.r;
        ball.vx = Math.abs(ball.vx);
        Sound.play('wall');
        spawnIceChips(ball.x, ball.y, -1, 0);
      } else if (ball.x + ball.r > PLAY.right) {
        ball.x = PLAY.right - ball.r;
        ball.vx = -Math.abs(ball.vx);
        Sound.play('wall');
        spawnIceChips(ball.x, ball.y, 1, 0);
      }
      if (ball.y - ball.r < PLAY.y) {
        ball.y = PLAY.y + ball.r;
        ball.vy = Math.abs(ball.vy);
        Sound.play('wall');
        spawnIceChips(ball.x, ball.y, 0, 1);
      }

      /* bricks */
      for (let i = 0; i < G.bricks.length; i++) {
        const b = G.bricks[i];
        if (!b.alive) continue;
        const n = circleVsRect(ball.x, ball.y, ball.r, b);
        if (!n) continue;

        if (ball.vx * n.nx + ball.vy * n.ny < 0) {
          const d = ball.vx * n.nx + ball.vy * n.ny;
          ball.vx -= 2 * d * n.nx;
          ball.vy -= 2 * d * n.ny;
          ball.vx += rand(30, -30);
          ball.vy += rand(24, -24);
          const sp2 = Math.hypot(ball.vx, ball.vy) || ball.speed;
          ball.vx = (ball.vx / sp2) * ball.speed;
          ball.vy = (ball.vy / sp2) * ball.speed;
          if (ball.vy > -ball.speed * 0.14) ball.vy = -ball.speed * 0.14;
        }
        ball.x += n.nx * 0.5;
        ball.y += n.ny * 0.5;

        if (!b.indestructible) {
          G.combo++;
          if (G.combo > G.bestCombo) G.bestCombo = G.combo;
        }
        ball.hitFlash = 1;
        hitBrick(b, ball, n);
        break;
      }

      /* paddle */
      if (!ball.dead &&
          ball.vy > 0 &&
          ball.y + ball.r >= p.y - p.h / 2 &&
          ball.y - ball.r <= p.y + p.h / 2 + 4 &&
          ball.x >= p.x - p.w / 2 - ball.r &&
          ball.x <= p.x + p.w / 2 + ball.r) {
        bounceOffPaddle(ball, p);
        G.combo = 0;
        syncUI();
        ball.dx = 0;
        Sound.play('paddle');
        spawnIceChips(ball.x, p.y - p.h / 2, 0, -1, C.cyan, 7);
        spawnRing(ball.x, p.y - p.h / 2, C.cyan, 3, 30, 0.3, 2);
        guardedShake(2);
      }

      /* power-ups */
      for (let i = 0; i < G.powerups.length; i++) {
        const pu = G.powerups[i];
        if (pu.dead) continue;
        const n2 = circleVsRect(ball.x, ball.y, ball.r + pu.w * 0.32, { x: pu.x - pu.w / 2, y: pu.y - pu.h / 2, w: pu.w, h: pu.h });
        if (n2) { pu.dead = true; collectPowerUp(pu); }
      }

      /* fell out */
      if (ball.y - ball.r > PLAY.bottom + 8) { ball.dead = true; }
    }
  }

  function spawnIceChips(x, y, nx, ny, color, amount) {
    if (!fxOn('particles')) return;
    color = color || C.ice;
    for (let i = 0; i < (amount || 4); i++) {
      const ang = Math.atan2(ny || rand(1, -1), nx || rand(1, -1));
      const a = ang + rand(1.1, -1.1);
      const sp = rand(210, 50);
      G.particles.push({
        kind: 'spark',
        x: x, y: y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0, max: rand(0.42, 0.2), color: Math.random() < 0.4 ? C.white : color,
      });
    }
  }

  /* --- power-up application ---------------------------------------------- */
  function collectPowerUp(pu) {
    const k = pu.def.key;
    addScore(150);
    spawnText(pu.x, pu.y - 10, '+150', pu.def.color, 18);
    spawnRing(pu.x, pu.y, pu.def.color, 6, 78, 0.5, 3);
    spawnBurst(pu.x, pu.y, pu.def.color, 16, 320);
    if (fxOn('flash')) { G.flash = Math.max(G.flash, 0.28); G.flashColor = pu.def.color; }
    guardedShake(4);
    Sound.play('powerup');
    emit('powerup', { key: k, x: pu.x, y: pu.y });

    if (k === 'multi') {
      const src = G.balls.filter(function (b) { return !b.stuck; });
      src.forEach(function (b) {
        [-1, 1].forEach(function (dir) {
          if (G.balls.length >= MAX_BALLS) return;
          const a = Math.atan2(b.vy, b.vx) + dir * rand(0.42, 0.26);
          const nb = new Ball(b.x, b.y, b.baseSpeed * 1.02, a);
          nb.stuck = false;
          nb.trail = b.trail.slice(0, 4);
          G.balls.push(nb);
        });
      });
    } else if (k === 'wide') {
      G.paddle.w = G.paddle.baseW * 1.45;
      G.paddle.power = Math.max(G.paddle.power, 11);
      addScore(60);
    } else if (k === 'fast') {
      G.balls.forEach(function (b) {
        const cap = effectiveSpeed(LEVELS[Math.min(G.level, LEVELS.length) - 1].speed * 1.75);
        b.baseSpeed = Math.min(b.baseSpeed * 1.16, cap);
        if (!b.stuck) b.setSpeed(b.baseSpeed);
      });
      addScore(60);
    } else if (k === 'diamond') {
      addScore(250 + 60 * G.level);
      spawnText(pu.x, pu.y - 34, 'BONUS ' + (250 + 60 * G.level), pu.def.color, 20);
    } else if (k === 'shield') {
      G.shield = G.shieldMax;
      Sound.play('shield');
      showBanner('FROST SHIELD', 'One fall absorbed', 1.4);
    }
    syncUI();
  }

  /* --- life lost ---------------------------------------------------------- */
  function loseLife() {
    G.combo = 0;
    G.lives -= 1;
    syncUI();
    emit('lifelost', { lives: G.lives, level: G.level, mode: G.mode });
    if (G.lives <= 0) {
      Sound.play('gameover');
      spawnBurst(W / 2, PLAY.bottom - 30, C.blue, 26, 380);
      setState('gameover');
      if (fxOn('flash')) { G.flash = 0.4; G.flashColor = [40, 90, 160]; }
      clearRun();
      emit('gameover', { score: G.score, level: G.level, bricksBroken: G.bricksBroken, bestCombo: G.bestCombo, mode: G.mode });
    } else {
      Sound.play('life');
      newBallOnPaddle();
      setState('serve');
      autosave();
    }
  }

  /* --- main update -------------------------------------------------------- */
  function update(dt) {
    G.time += dt;
    G.stateT += dt;
    const playing = G.state === 'play' || G.state === 'serve';

    /* effects always animate */
    updateParticles(dt);
    updateSnow(dt);
    G.flash = Math.max(0, G.flash - dt * 1.6);
    G.shake = Math.max(0, G.shake - dt * 26);
    if (G.bannerTimer > 0) {
      G.bannerTimer -= dt;
      if (G.bannerTimer <= 0) hideBanner();
    }

    if (playing) {
      if (G.autoplay) autoPaddle(dt);
      G.paddle.update(dt, input);
      G.powerups.forEach(function (p) {
        if (!p.dead) p.update(dt, G.paddle);
      });
      /* paddle catch — capsules are meant to be caught, not just touched by a ball */
      (function () {
        const p = G.paddle;
        const x0 = p.x - p.w / 2 - 8, x1 = p.x + p.w / 2 + 8;
        const y0 = p.y - p.h / 2 - 10, y1 = p.y + p.h / 2 + 6;
        G.powerups.forEach(function (pu) {
          if (pu.dead) return;
          if (pu.x >= x0 && pu.x <= x1 && pu.y >= y0 && pu.y <= y1) {
            pu.dead = true;
            collectPowerUp(pu);
          }
        });
      })();
      G.powerups = G.powerups.filter(function (p) {
        if (p.dead) return false;
        if (p.y - p.h / 2 > PLAY.bottom + 20) return false;
        return true;
      });
      if (G.paddle.power > 0) {
        G.paddle.power -= dt;
        if (G.paddle.power <= 0) { G.paddle.w = G.paddle.baseW; G.paddle.power = 0; }
      }
    }

    /* power-up timers */
    if (G.shield > 0) G.shield = Math.max(0, G.shield - dt);

    for (let i = 0; i < G.bricks.length; i++) {
      const b = G.bricks[i];
      if (b.hit > 0) b.hit = Math.max(0, b.hit - dt * 4);
      if (b.pop > 0) b.pop = Math.max(0, b.pop - dt * 5);
    }

    switch (G.state) {
      case 'serve': updateServe(); break;
      case 'play': updatePlay(dt); break;
      case 'levelclear':
        if (G.stateT > 2.1) {
          if (G.mode === 'endless') {
            G.endlessDepth++;
            addScore(250);
            loadLevel(G.level, { keepMode: true, endless: true });
          } else if (G.mode === 'daily') {
            setState('victory');
            emit('victory', { score: G.score, mode: G.mode, level: G.level, bricksBroken: G.bricksBroken, bestCombo: G.bestCombo });
            clearRun();
          } else if (G.mode === 'custom') {
            setState('victory');
            emit('victory', { score: G.score, mode: G.mode, level: G.level, bricksBroken: G.bricksBroken, bestCombo: G.bestCombo });
          } else if (G.level >= LEVELS.length) { setState('victory'); emit('victory', { score: G.score, mode: G.mode, level: G.level, bricksBroken: G.bricksBroken, bestCombo: G.bestCombo }); clearRun(); }
          else loadLevel(G.level + 1);
        }
        break;
      case 'gameover':
      case 'victory':
      case 'menu':
      case 'paused':
      default:
        break;
    }
  }

  function updateServe() {
    G.balls.forEach(function (b) { b.followPaddle(G.paddle); });
    if (G.stateT > 3.4) launchBalls();     // auto-serve so play never stalls
  }

  function launchBalls() {
    if (G.state !== 'serve') return;
    G.balls.forEach(function (b) { b.launch(); });
    setState('play');
    Sound.play('launch');
    spawnRing(G.paddle.x, G.paddle.y - 10, C.cyan, 8, 120, 0.5, 3);
    spawnBurst(G.paddle.x, G.paddle.y - 14, C.ice, 12, 260);
  }

  function updatePlay(dt) {
    const p = G.paddle;

    G.balls.forEach(function (b) {
      if (b.stuck) { b.followPaddle(p); return; }
      b.spin += b.spinRate * dt;
      if (b.hitFlash > 0) b.hitFlash = Math.max(0, b.hitFlash - dt * 5);
      moveBall(b, dt);
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > 16) b.trail.shift();
    });

    /* did any ball slip past the paddle? */
    const fallen = G.balls.filter(function (b) { return b.dead; });
    if (fallen.length) {
      const survivor = G.balls.filter(function (b) { return !b.dead; });
      fallen.forEach(function (b) { spawnBurst(b.x, PLAY.bottom - 4, C.blue, 10, 280); });

      if (G.shield > 0) {
        /* the frost shield catches the fall */
        G.shield = 0;
        Sound.play('shield');
        if (fxOn('flash')) { G.flash = 0.5; G.flashColor = [190, 215, 255]; }
        guardedShake(9);
        emit('shield', { level: G.level });
        spawnRing(p.x, PLAY.bottom - 6, [200, 225, 255], 10, 260, 0.6, 4);
        spawnBurst(p.x, PLAY.bottom - 6, [200, 225, 255], 30, 420);
        showBanner('SHIELD ABSORBED', 'The ice bought you a life', 1.4);
        if (!survivor.length) newBallOnPaddle();
        else survivor.forEach(function (b, i) {
          b.stuck = true;
          b.dx = (i - (survivor.length - 1) / 2) * 44;
          b.trail.length = 0;
        });
        setState('serve');
        return;
      }

      G.balls = survivor;
      if (G.balls.length === 0) { loseLife(); return; }
    }

    /* prune spent bricks */
    if (G.bricks.some(function (b) { return !b.alive; })) {
      G.bricks = G.bricks.filter(function (b) { return b.alive; });
    }
  }

  /* --- particles / ambience ---------------------------------------------- */
  function autoPaddle(dt) {
    /* demo/attract-mode pilot: chase the lowest live ball */
    let target = null, best = -Infinity;
    G.balls.forEach(function (b) {
      if (b.stuck) return;
      if (b.y > best) { best = b.y; target = b; }
    });
    input.pointerActive = true;
    const want = target ? target.x : G.paddle.x;
    input.pointerX = lerp(input.pointerX, want, clamp(dt * 9, 0, 1));
    input.pointerY = G.paddle.y - 40;
  }

  function updateParticles(dt) {
    let i;
    for (i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.life += dt;
      if (p.life >= p.max) { G.particles.splice(i, 1); continue; }
      if (p.kind === 'mist') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 0.98;
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 1 - 2.2 * dt; p.vy = p.vy * (1 - 2.2 * dt) + 260 * dt;
        p.rot += p.vr * dt;
      }
    }
    for (i = G.rings.length - 1; i >= 0; i--) {
      const r = G.rings[i]; r.life += dt;
      if (r.life >= r.max) G.rings.splice(i, 1);
    }
    for (i = G.texts.length - 1; i >= 0; i--) {
      const t = G.texts[i]; t.life += dt;
      if (t.life >= t.max) G.texts.splice(i, 1);
    }
    /* cursor sparks while the pointer is active */
    if (input.pointerActive && !G.autoplay && (G.state === 'play' || G.state === 'serve')) {
      if (Math.random() < 0.4) {
        G.particles.push({
          kind: 'spark',
          x: input.pointerX + rand(6, -6), y: input.pointerY + rand(6, -6),
          vx: rand(20, -20), vy: rand(-6, -26),
          life: 0, max: rand(0.5, 0.25), color: C.ice,
        });
      }
    }

    /* hard ceiling on particle count keeps the worst case cheap */
    if (G.particles.length > MAX_PARTICLES) {
      G.particles.splice(0, G.particles.length - MAX_PARTICLES);
    }
  }

  function updateSnow(dt) {
    for (let i = 0; i < G.snow.length; i++) {
      const s = G.snow[i];
      s.ph += dt;
      s.x += (s.vx + Math.sin(s.ph * 0.8) * (s.near ? 16 : 7)) * dt;
      s.y += s.vy * dt;
      if (s.y > H + 6) { s.y = -6; s.x = rand(W); }
      if (s.x < -10) s.x = W + 8;
      if (s.x > W + 10) s.x = -8;
    }
    for (let i = 0; i < G.bgCrystals.length; i++) {
      const c = G.bgCrystals[i];
      c.rot += c.vr * dt;
    }
  }

  /* ==========================================================================
   * 07 · RENDERING
   * ======================================================================== */

  /* --- static background (redrawn only on resize) ------------------------- */
  function buildStaticLayer() {
    const s = document.createElement('canvas');
    s.width = Math.round(W * DPR);
    s.height = Math.round(H * DPR);
    const g = s.getContext('2d');
    g.scale(DPR, DPR);
    const rng = mulberry32(90210);

    /* base gradient */
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#050f1d');
    grd.addColorStop(0.38, '#07203a');
    grd.addColorStop(0.78, '#051729');
    grd.addColorStop(1, '#030d18');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    /* aurora blooms */
    const blooms = [
      [W * 0.20, H * 0.06, 380, [46, 150, 220], 0.22],
      [W * 0.84, H * 0.02, 340, [116, 118, 250], 0.17],
      [W * 0.52, H * 1.02, 460, [22, 108, 178], 0.16],
    ];
    blooms.forEach(function (b) {
      const rg = g.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
      rg.addColorStop(0, rgba(b[3], b[4]));
      rg.addColorStop(1, rgba(b[3], 0));
      g.fillStyle = rg;
      g.fillRect(0, 0, W, H);
    });

    /* starfield */
    for (let i = 0; i < 130; i++) {
      const x = rng() * W, y = rng() * H * 0.8;
      const r = 0.4 + rng() * 1.5;
      g.fillStyle = rgba([200, 235, 255], 0.10 + rng() * 0.45);
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }

    /* faint hexagonal frost lattice */
    g.save();
    g.globalAlpha = 0.5;
    g.strokeStyle = 'rgba(120,190,240,0.035)';
    g.lineWidth = 1;
    const hs = 46;
    for (let row = -1; row * hs * 1.5 < H + hs; row++) {
      for (let col = -1; col * hs * 1.732 < W + hs; col++) {
        const cx = col * hs * 1.732 + (row % 2 ? hs * 0.866 : 0);
        const cy = row * hs * 1.5;
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = cx + Math.cos(a) * hs, py = cy + Math.sin(a) * hs;
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath(); g.stroke();
      }
    }
    g.restore();

    /* distant ice ridges along the floor */
    drawRidge(g, H - 96, 74, '#071a2e', 'rgba(120,200,255,0.16)', 7, rng);
    drawRidge(g, H - 66, 52, '#04121f', 'rgba(120,200,255,0.12)', 5, rng);

    /* ---- arena chrome, baked into this same layer --------------------------
     * The playfield tint, side walls, glowing frame and ceiling icicles never
     * move, so they are painted once here instead of every frame. Only the
     * shimmer is animated live on top.                                      */
    const ig = g.createLinearGradient(0, PLAY.y, 0, PLAY.bottom);
    ig.addColorStop(0, 'rgba(10,32,58,0.35)');
    ig.addColorStop(1, 'rgba(2,10,22,0.45)');
    g.fillStyle = ig;
    g.fillRect(PLAY.x, PLAY.y, PLAY.w, PLAY.h);

    [PLAY.x, PLAY.right].forEach(function (x) {
      const wg = g.createLinearGradient(x - 7, 0, x + 7, 0);
      wg.addColorStop(0, 'rgba(90,180,240,0)');
      wg.addColorStop(0.5, 'rgba(120,205,255,0.20)');
      wg.addColorStop(1, 'rgba(90,180,240,0)');
      g.fillStyle = wg;
      g.fillRect(x - 7, PLAY.y, 14, PLAY.h);
    });

    g.lineWidth = 8;
    g.strokeStyle = 'rgba(80,180,240,0.10)';
    g.strokeRect(PLAY.x - 2, PLAY.y - 2, PLAY.w + 4, PLAY.h + 4);
    g.lineWidth = 1.6;
    g.strokeStyle = 'rgba(170,230,255,0.55)';
    g.shadowColor = 'rgba(120,215,255,0.7)';
    g.shadowBlur = 12;
    g.strokeRect(PLAY.x - 0.5, PLAY.y - 0.5, PLAY.w + 1, PLAY.h + 1);
    g.shadowBlur = 0;

    /* ceiling icicles (the glints are animated live on top) */
    for (let i = 0; i < 34; i++) {
      const x = PLAY.x + ((i + 0.5) / 34) * PLAY.w;
      const r2 = mulberry32(i * 977 + 13);
      const len = 10 + r2() * 26;
      const w = 5 + r2() * 5;
      const gr = g.createLinearGradient(0, PLAY.y, 0, PLAY.y + len);
      gr.addColorStop(0, 'rgba(206,244,255,0.75)');
      gr.addColorStop(0.55, 'rgba(150,215,255,0.30)');
      gr.addColorStop(1, 'rgba(120,190,255,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x - w / 2, PLAY.y);
      g.lineTo(x + w / 2, PLAY.y);
      g.lineTo(x, PLAY.y + len);
      g.closePath();
      g.fill();
    }

    /* vignette + edge frost (both static → baked in) */
    const vg = g.createRadialGradient(W / 2, H * 0.44, H * 0.24, W / 2, H * 0.5, H * 1.08);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,4,12,0.75)');
    g.fillStyle = vg;
    g.fillRect(0, 0, W, H);

    const eg = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.92);
    eg.addColorStop(0, 'rgba(0,0,0,0)');
    eg.addColorStop(1, 'rgba(0,6,14,0.55)');
    g.fillStyle = eg;
    g.fillRect(0, 0, W, H);

    staticLayer = s;
    brickGlowDirty = true;
  }

  /* --- cached additive glow layer for the blocks ---------------------------
   * Redrawing 50+ scaled glow sprites every frame is the most expensive thing
   * this renderer could do. The auras only change when a block takes a hit, so
   * they are baked into one layer, cropped to the band the blocks occupy, and
   * composited with a single blit.                                        */
  const glowBand = { top: 0, h: 0 };

  function buildBrickGlowLayer() {
    let top = H, bottom = 0;
    G.bricks.forEach(function (b) {
      if (b.y < top) top = b.y;
      if (b.y + b.h > bottom) bottom = b.y + b.h;
    });
    if (bottom <= top) { glowBand.h = 0; brickGlowDirty = false; return; }

    glowBand.top = Math.max(0, Math.floor(top) - 30);
    glowBand.h = Math.min(H - glowBand.top, Math.ceil(bottom) - Math.floor(top) + 60);

    if (!brickGlowLayer) brickGlowLayer = document.createElement('canvas');
    brickGlowLayer.width = Math.round(W * DPR);
    brickGlowLayer.height = Math.max(1, Math.round(glowBand.h * DPR));
    const g = brickGlowLayer.getContext('2d');
    g.setTransform(DPR, 0, 0, DPR, 0, -glowBand.top * DPR);
    g.globalCompositeOperation = 'lighter';
    G.bricks.forEach(function (b) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const r = b.w * 0.95;
      g.drawImage(glow(b.type.aura, b.indestructible ? 0.06 : 0.11), cx - r, cy - r, r * 2, r * 2);
    });
    g.globalCompositeOperation = 'source-over';
    brickGlowDirty = false;
  }

  function drawRidge(g, baseY, height, fill, rim, peaks, rng) {
    g.beginPath();
    g.moveTo(-10, H);
    let x = -10;
    g.lineTo(x, baseY);
    while (x < W + 20) {
      const w = W / peaks * (0.7 + rng() * 0.7);
      const peak = baseY - height * (0.35 + rng() * 0.65);
      g.lineTo(x + w * 0.5, peak);
      g.lineTo(x + w, baseY - height * 0.12 * rng());
      x += w;
    }
    g.lineTo(W + 10, H);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = rim;
    g.lineWidth = 1.2;
    g.stroke();
  }

  /* --- per-frame background extras --------------------------------------- */
  function drawBackdrop() {
    ctx.drawImage(staticLayer, 0, 0, W, H);

    /* slow breathing aurora (single additive blob) */
    const t = G.time;
    const bx = (Math.sin(t * 0.11) * 90) - 190 + W * 0.22;
    const by = -230 + Math.cos(t * 0.13) * 26;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + Math.sin(t * 0.5) * 0.14;
    ctx.drawImage(glow(C.cyan, 0.14), bx, by, 620, 620);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* slowly rotating background crystals */
    G.bgCrystals.forEach(function (cr) {
      ctx.save();
      ctx.translate(cr.x, cr.y);
      ctx.rotate(cr.rot);
      ctx.globalAlpha = cr.a;
      ctx.strokeStyle = rgba(C.ice, 0.5);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < cr.sides; i++) {
        const a = (TAU / cr.sides) * i;
        const px = Math.cos(a) * cr.r, py = Math.sin(a) * cr.r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = cr.a * 0.7;
      for (let i = 0; i < cr.sides; i += 2) {
        const a = (TAU / cr.sides) * i;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * cr.r, Math.sin(a) * cr.r);
        ctx.stroke();
      }
      ctx.restore();
    });
    ctx.globalAlpha = 1;

    /* snow */
    G.snow.forEach(function (s) {
      ctx.fillStyle = rgba(C.ice, s.a);
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
      if (s.near && s.r > 1.9) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgba(C.cyan, s.a * 0.5);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.6, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
    });
  }

  /* --- icicle shimmer, frost corners, floor mist -------------------------- */
  function drawArena() {
    const t = G.time;

    /* icicle glints — a handful of moving highlights instead of 34 redraws */
    for (let i = 0; i < 9; i++) {
      const x = PLAY.x + ((i * 4 + 0.5) / 34) * PLAY.w;
      const a = 0.18 + Math.abs(Math.sin(t * 1.9 + i * 0.8)) * 0.5;
      ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, PLAY.y + 3, 1.3, 0, TAU); ctx.fill();
    }

    /* frost crystals in the corners */
    [[PLAY.x, PLAY.y, 1, 1], [PLAY.right, PLAY.y, -1, 1],
     [PLAY.x, PLAY.bottom, 1, -1], [PLAY.right, PLAY.bottom, -1, -1]].forEach(function (k) {
      const pulse = 0.55 + Math.sin(t * 1.6 + k[0] * 0.01 + k[1] * 0.02) * 0.25;
      drawGlow(k[0], k[1], 54, C.cyan, 0.16 * pulse);
      ctx.save();
      ctx.translate(k[0], k[1]);
      ctx.scale(k[2], k[3]);
      ctx.rotate(t * 0.25);
      ctx.strokeStyle = rgba(C.ice, 0.55);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (TAU / 6) * i;
        const px = Math.cos(a) * 15, py = Math.sin(a) * 15;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (TAU / 6) * i;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
        ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
        ctx.stroke();
      }
      ctx.restore();
    });

    /* cold mist creeping along the floor */
    const mistA = 0.10 + Math.sin(t * 0.9) * 0.04;
    const mg = ctx.createLinearGradient(0, PLAY.bottom - 70, 0, PLAY.bottom);
    mg.addColorStop(0, 'rgba(120,200,255,0)');
    mg.addColorStop(1, rgba(C.ice, mistA));
    ctx.fillStyle = mg;
    ctx.fillRect(PLAY.x, PLAY.bottom - 70, PLAY.w, 70);
  }

  /* --- bricks -------------------------------------------------------------- */
  function drawBrick(b) {
    const t = b.hit;
    const sc = 1 + b.pop * 0.07;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const w = b.w * sc, h = b.h * sc;
    const x = cx - w / 2, y = cy - h / 2;
    const tp = b.type;

    /* body (the soft aura behind every block is baked into brickGlowLayer) */
    const grd = ctx.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, rgba(tp.top, 0.86));
    grd.addColorStop(0.42, rgba(tp.top, 0.46));
    grd.addColorStop(1, rgba(tp.bot, 0.72));
    rrPath(ctx, x, y, w, h, 5);
    ctx.fillStyle = grd;
    ctx.fill();

    /* facets */
    ctx.save();
    rrPath(ctx, x, y, w, h, 5);
    ctx.clip();
    ctx.fillStyle = rgba(C.white, 0.10);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + w * 0.42, y); ctx.lineTo(x, y + h * 0.85);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgba(tp.bot, 0.35);
    ctx.beginPath();
    ctx.moveTo(x + w, y + h); ctx.lineTo(x + w * 0.55, y + h); ctx.lineTo(x + w, y + h * 0.35);
    ctx.closePath(); ctx.fill();
    /* animated sheen sweep */
    const sweep = ((G.time * 0.22 + b.sheen) % 2.4) - 0.6;
    if (sweep > -0.3 && sweep < 0.55) {
      const sg = ctx.createLinearGradient(x + w * sweep - w * 0.3, y, x + w * sweep + w * 0.3, y + h);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,0.16)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();

    /* glowing edges */
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = rgba(tp.edge, 0.85 + t * 0.15);
    rrPath(ctx, x, y, w, h, 5);
    ctx.stroke();

    /* top highlight */
    ctx.beginPath();
    ctx.moveTo(x + 5, y + 1.2);
    ctx.lineTo(x + w - 5, y + 1.2);
    ctx.strokeStyle = rgba(C.white, 0.35 + t * 0.5);
    ctx.lineWidth = 1.1;
    ctx.stroke();

    /* cracks */
    if (b.cracks) {
      ctx.strokeStyle = rgba(tp.crack || C.white, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      b.cracks.forEach(function (branch) {
        branch.forEach(function (pt, i) {
          const px = x + pt[0] * w, py = y + pt[1] * h;
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
      });
      ctx.stroke();
    }

    /* rivets for bedrock */
    if (b.indestructible) {
      ctx.fillStyle = rgba(C.slate, 0.5);
      for (let i = 0; i < 4; i++) {
        const rx = x + 8 + i * ((w - 16) / 3);
        ctx.beginPath(); ctx.arc(rx, cy, 1.6, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = rgba(C.white, 0.10);
      rrPath(ctx, x + 2, y + 2, w - 4, h * 0.4, 3); ctx.fill();
    }

    /* durability pips */
    if (!b.indestructible && b.maxHp > 1 && b.hp > 0) {
      const n = b.hp;
      const gap = 6;
      const startX = cx - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = rgba(tp.edge, 0.95);
        ctx.beginPath(); ctx.arc(startX + i * gap, y + h - 5, 1.7, 0, TAU); ctx.fill();
      }
    }

    /* hit flash */
    if (t > 0) {
      ctx.fillStyle = rgba(C.white, t * 0.5);
      rrPath(ctx, x, y, w, h, 5);
      ctx.fill();
    }
  }

  /* --- paddle -------------------------------------------------------------- */
  function drawPaddle() {
    const p = G.paddle;
    const hw = p.w / 2, hh = p.h / 2;
    const t = G.time;
    const pulse = 0.55 + Math.sin(t * 2.4) * 0.12 + (p.power > 0 ? 0.25 : 0);

    drawGlow(p.x, p.y, p.w * 0.85, C.cyan, 0.30 * pulse);

    /* main crystal slab */
    const grd = ctx.createLinearGradient(0, p.y - hh, 0, p.y + hh);
    grd.addColorStop(0, 'rgba(232,252,255,0.96)');
    grd.addColorStop(0.35, 'rgba(150,220,255,0.80)');
    grd.addColorStop(1, 'rgba(30,96,164,0.88)');
    rrPath(ctx, p.x - hw, p.y - hh, p.w, p.h, p.h / 2);
    ctx.fillStyle = grd;
    ctx.fill();

    /* internal facets */
    ctx.save();
    rrPath(ctx, p.x - hw, p.y - hh, p.w, p.h, p.h / 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.beginPath();
    ctx.moveTo(p.x - hw, p.y - hh); ctx.lineTo(p.x - hw + p.w * 0.3, p.y - hh);
    ctx.lineTo(p.x - hw + p.w * 0.12, p.y + hh); ctx.lineTo(p.x - hw, p.y + hh);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(10,50,100,0.22)';
    ctx.beginPath();
    ctx.moveTo(p.x + hw, p.y + hh); ctx.lineTo(p.x + hw - p.w * 0.26, p.y + hh);
    ctx.lineTo(p.x + hw - p.w * 0.1, p.y - hh); ctx.lineTo(p.x + hw, p.y - hh);
    ctx.closePath(); ctx.fill();
    /* travelling energy line */
    const lp = ((t * 0.6) % 2) - 0.5;
    const lg = ctx.createLinearGradient(p.x - hw + lp * p.w - 26, 0, p.x - hw + lp * p.w + 26, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(p.x - hw, p.y - hh, p.w, p.h);
    ctx.restore();

    /* rim + ridge */
    rrPath(ctx, p.x - hw + 0.5, p.y - hh + 0.5, p.w - 1, p.h - 1, p.h / 2);
    ctx.strokeStyle = 'rgba(226,250,255,0.9)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(p.x - hw + 12, p.y - hh + 1);
    ctx.lineTo(p.x + hw - 12, p.y - hh + 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* end caps */
    [p.x - hw + 9, p.x + hw - 9].forEach(function (x) {
      drawGlow(x, p.y, 15, C.white, 0.45);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(x, p.y, 2.4, 0, TAU); ctx.fill();
    });

    /* frost spikes */
    for (let i = -1; i <= 1; i++) {
      const x = p.x + i * (p.w * 0.26);
      const h = 6 + Math.abs(Math.sin(t * 2 + i)) * 3;
      ctx.fillStyle = 'rgba(215,245,255,0.75)';
      ctx.beginPath();
      ctx.moveTo(x - 3, p.y - hh);
      ctx.lineTo(x + 3, p.y - hh);
      ctx.lineTo(x, p.y - hh - h);
      ctx.closePath();
      ctx.fill();
    }

    /* active wide-paddle indicator */
    if (p.power > 0) {
      ctx.strokeStyle = rgba(C.mint, 0.5 + Math.sin(t * 8) * 0.2);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - hw, p.y + hh + 4);
      ctx.lineTo(p.x + hw, p.y + hh + 4);
      ctx.stroke();
    }

    /* frost shield: an active ice ward that will absorb one fall */
    if (G.shield > 0) {
      const k = clamp(G.shield / G.shieldMax, 0, 1);
      const sw = p.w / 2 + 18 + Math.sin(t * 3) * 2;
      const sy = p.y - p.h / 2 - 12;
      const pulse = 0.45 + Math.abs(Math.sin(t * 3.2)) * 0.35 + k * 0.2;

      drawGlow(p.x, sy, sw * 1.5, [190, 215, 255], 0.22 * pulse);

      ctx.save();
      const wg = ctx.createLinearGradient(p.x - sw, 0, p.x + sw, 0);
      wg.addColorStop(0, 'rgba(200,225,255,0)');
      wg.addColorStop(0.5, 'rgba(225,242,255,' + pulse + ')');
      wg.addColorStop(1, 'rgba(200,225,255,0)');
      ctx.strokeStyle = wg;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(p.x - sw, sy + 4);
      ctx.quadraticCurveTo(p.x, sy - 12 - k * 4, p.x + sw, sy + 4);
      ctx.stroke();

      /* crystal nodes along the ward */
      ctx.fillStyle = 'rgba(240,250,255,' + (pulse * 0.9) + ')';
      for (let i = -2; i <= 2; i++) {
        const nx = p.x + i * (sw / 2.4);
        const ny = sy + 4 - Math.cos((i / 2.4) * 1.5) * (10 + k * 3);
        ctx.beginPath();
        ctx.moveTo(nx, ny - 3.4); ctx.lineTo(nx + 2.4, ny); ctx.lineTo(nx, ny + 3.4); ctx.lineTo(nx - 2.4, ny);
        ctx.closePath(); ctx.fill();
      }

      /* depletion bar */
      ctx.fillStyle = 'rgba(150,190,255,0.28)';
      ctx.fillRect(p.x - 34, sy - 24, 68, 3);
      ctx.fillStyle = 'rgba(226,244,255,0.95)';
      ctx.fillRect(p.x - 34, sy - 24, 68 * k, 3);
      ctx.restore();
    }
  }

  /* --- ball ---------------------------------------------------------------- */
  function drawBall(b) {
    /* frost trail */
    if (b.trail.length > 1) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < b.trail.length; i++) {
        const k = i / b.trail.length;
        const a = Math.pow(k, 1.7) * 0.42;
        const r = b.r * (0.28 + k * 0.78);
        ctx.fillStyle = rgba(C.cyan, a);
        ctx.beginPath();
        ctx.arc(b.trail[i].x, b.trail[i].y, r, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    drawGlow(b.x, b.y, b.r * 6.2, C.cyan, 0.34);
    if (b.hitFlash > 0) drawGlow(b.x, b.y, b.r * 9, C.white, b.hitFlash * 0.4);

    /* core sphere */
    const grd = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.34, '#e2f8ff');
    grd.addColorStop(0.72, '#7fd4ff');
    grd.addColorStop(1, '#2f8fd8');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fill();

    /* faceted shell */
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.spin);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = (Math.PI / 3) * i;
      ctx.moveTo(Math.cos(a) * b.r, Math.sin(a) * b.r);
      ctx.arc(0, 0, b.r, a, a + 1.9);
    }
    ctx.stroke();
    ctx.restore();

    /* specular */
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(b.x - b.r * 0.34, b.y - b.r * 0.4, b.r * 0.22, 0, TAU); ctx.fill();
  }

  /* --- power-ups ----------------------------------------------------------- */
  function drawPowerUp(p) {
    const def = p.def;
    const bob = Math.sin(p.life * 3.4) * 3;
    const y = p.y + bob;
    const w = p.w, h = p.h;
    const spin = Math.sin(p.spin) * 0.12;

    drawGlow(p.x, y, 40, def.color, 0.3 + p.magnet * 0.3);

    ctx.save();
    ctx.translate(p.x, y);
    ctx.rotate(spin);

    /* capsule */
    const grd = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.95)');
    grd.addColorStop(0.4, rgba(def.color, 0.55));
    grd.addColorStop(1, 'rgba(8,30,58,0.85)');
    rrPath(ctx, -w / 2, -h / 2, w, h, 9);
    ctx.fillStyle = grd;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = rgba(def.color, 0.95);
    ctx.stroke();
    ctx.restore();

    /* glyph */
    ctx.font = '18px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, p.x, y + 1);

    /* orbiting spark */
    const a = p.life * 2.6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgba(def.color, 0.9);
    ctx.beginPath();
    ctx.arc(p.x + Math.cos(a) * (w * 0.62), y + Math.sin(a) * (h * 0.42), 2, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    /* magnet ring */
    if (p.magnet > 0.05) {
      ctx.strokeStyle = rgba(def.color, p.magnet * 0.6);
      ctx.lineWidth = 1.4;
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -p.life * 30;
      ctx.beginPath(); ctx.arc(p.x, y, 22 + Math.sin(p.life * 8) * 3, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }

    /* label */
    ctx.font = '700 9px "Segoe UI",system-ui,sans-serif';
    ctx.fillStyle = rgba(def.color, 0.85);
    ctx.fillText(def.label, p.x, y + h / 2 + 11);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /* --- particles, rings, floating text ------------------------------------- */
  function drawEffects() {
    /* rings */
    G.rings.forEach(function (r) {
      const k = r.life / r.max;
      ctx.strokeStyle = rgba(r.color, (1 - k) * 0.8);
      ctx.lineWidth = r.w * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * easeOutCubic(k), 0, TAU);
      ctx.stroke();
    });

    /* mist */
    ctx.globalCompositeOperation = 'lighter';
    G.particles.forEach(function (p) {
      if (p.kind !== 'mist') return;
      const k = p.life / p.max;
      const r = lerp(p.r0, p.r1, easeOutCubic(k));
      ctx.fillStyle = rgba(p.color, (1 - k) * 0.16);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
    });
    ctx.globalCompositeOperation = 'source-over';

    /* shards + sparks + glints */
    G.particles.forEach(function (p) {
      const k = p.life / p.max;
      if (p.kind === 'shard') {
        const a = 1 - k * k;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        const s = p.size * (1 - k * 0.35);
        ctx.fillStyle = rgba(p.color, a * 0.72);
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.8, s * 0.6);
        ctx.lineTo(-s * 0.7, s * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(C.white, a * 0.75);
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'spark') {
        const a = 1 - k;
        const len = clamp(Math.hypot(p.vx, p.vy) * 0.022, 2, 16);
        const m = Math.hypot(p.vx, p.vy) || 1;
        ctx.strokeStyle = rgba(p.color, a * 0.9);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - (p.vx / m) * len, p.y - (p.vy / m) * len);
        ctx.stroke();
      } else if (p.kind === 'glint') {
        const a = 1 - k;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.strokeStyle = rgba(p.color, a);
        ctx.lineWidth = 1.4;
        const s = p.size * (0.4 + k);
        ctx.beginPath();
        ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
        ctx.moveTo(0, -s * 0.7); ctx.lineTo(0, s * 0.7);
        ctx.stroke();
        ctx.restore();
      }
    });

    /* floating score text */
    G.texts.forEach(function (t) {
      const k = t.life / t.max;
      const a = 1 - k * k;
      const y = t.y - t.rise * easeOutCubic(k);
      ctx.font = '800 ' + t.size + 'px "Segoe UI",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = rgba(t.color, 0.9);
      ctx.shadowBlur = 12;
      ctx.fillStyle = rgba(t.color, a);
      ctx.fillText(t.str, t.x, y);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
    });
  }

  /* --- frost shield field --------------------------------------------------- */
  function drawShieldField() {
    if (G.shield <= 0) return;
    const k = clamp(G.shield / G.shieldMax, 0, 1);
    const t = G.time;

    ctx.save();
    /* cold haze rising from the floor */
    const fg = ctx.createLinearGradient(0, PLAY.bottom - 190, 0, PLAY.bottom);
    fg.addColorStop(0, 'rgba(160,200,255,0)');
    fg.addColorStop(1, 'rgba(150,195,255,' + (0.05 + k * 0.06) + ')');
    ctx.fillStyle = fg;
    ctx.fillRect(PLAY.x, PLAY.bottom - 190, PLAY.w, 190);

    /* ice crystals creeping in along the borders */
    const rng = mulberry32(4242);
    ctx.strokeStyle = 'rgba(205,232,255,' + (0.14 + k * 0.16) + ')';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 22; i++) {
      const edge = i % 3;
      const along = rng();
      const grow = (0.3 + rng() * 0.5) * k;
      let x, y, ang;
      if (edge === 0) { x = along * PLAY.w + PLAY.x; y = PLAY.bottom; ang = -Math.PI / 2; }
      else if (edge === 1) { x = PLAY.right; y = PLAY.y + along * PLAY.h; ang = Math.PI; }
      else { x = PLAY.x; y = PLAY.y + along * PLAY.h; ang = 0; }
      const len = 30 + rng() * 110 * grow;
      ctx.beginPath();
      ctx.moveTo(x, y);
      let cx = x, cy = y, a = ang;
      const segs = 3;
      for (let s = 0; s < segs; s++) {
        a += (rng() - 0.5) * 0.5;
        cx += Math.cos(a) * (len / segs);
        cy += Math.sin(a) * (len / segs);
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.font = '800 12px "Segoe UI",system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(210,236,255,' + (0.4 + Math.sin(t * 4) * 0.2) + ')';
    ctx.fillText('🛡  FROST SHIELD ACTIVE — ' + Math.ceil(G.shield) + 's', W / 2, PLAY.bottom - 92);
    ctx.textAlign = 'left';
  }

  /* --- prompts ------------------------------------------------------------- */
  function drawPrompts() {
    if (G.state !== 'serve') return;
    const t = G.time;
    const y = G.paddle.y - 74;
    const a = 0.55 + Math.sin(t * 3.4) * 0.28;
    ctx.font = '800 15px "Segoe UI",system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(120,210,255,0.9)';
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(226,246,255,' + a + ')';
    ctx.fillText(isTouch() ? 'TAP ❄️ OR PRESS SPACE TO LAUNCH' : 'PRESS SPACE OR CLICK TO LAUNCH', W / 2, y);
    ctx.shadowBlur = 0;

    /* aiming guide */
    const k = (G.stateT % 2) / 2;
    ctx.strokeStyle = 'rgba(150,220,255,' + (0.34 - k * 0.3) + ')';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -G.stateT * 26;
    ctx.beginPath();
    ctx.moveTo(G.paddle.x, G.paddle.y - 22);
    ctx.lineTo(G.paddle.x, G.paddle.y - 104);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'left';
  }

  /* --- custom cursor ------------------------------------------------------- */
  function drawCursor() {
    if (!input.pointerActive) return;
    if (G.state !== 'play' && G.state !== 'serve') return;
    const x = input.pointerX, y = input.pointerY;
    const t = G.time;
    drawGlow(x, y, 26, C.cyan, 0.22);
    ctx.strokeStyle = 'rgba(190,240,255,0.65)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(x, y, 7 + Math.sin(t * 6) * 1.2, 0, TAU); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 13, y); ctx.lineTo(x - 9, y);
    ctx.moveTo(x + 9, y); ctx.lineTo(x + 13, y);
    ctx.moveTo(x, y - 13); ctx.lineTo(x, y - 9);
    ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 13);
    ctx.stroke();
  }

  /* --- main render --------------------------------------------------------- */
  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);

    drawBackdrop();

    /* camera shake for the gameplay layer */
    let sx = 0, sy = 0;
    if (G.shake > 0.05) {
      sx = rand(G.shake, -G.shake);
      sy = rand(G.shake, -G.shake);
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawArena();

    if (brickGlowDirty) buildBrickGlowLayer();
    if (glowBand.h > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(brickGlowLayer, 0, glowBand.top, W, glowBand.h);
      ctx.globalCompositeOperation = 'source-over';
    }

    G.bricks.forEach(drawBrick);
    G.powerups.forEach(drawPowerUp);
    drawPaddle();
    G.balls.forEach(drawBall);
    drawEffects();
    drawPrompts();
    drawCursor();

    ctx.restore();

    drawShieldField();

    /* full-screen flash */
    if (G.flash > 0.01 && fxOn('flash')) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(G.flashColor, G.flash * 0.22);
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* ==========================================================================
   * 08 · INPUT
   * ======================================================================== */

  const input = {
    left: false, right: false, axis: 0,
    pointerActive: false, pointerX: W / 2, pointerY: PLAY.bottom,
  };

  function updateAxis() {
    input.axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  }

  function toLogical(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return {
      x: clamp(((clientX - r.left) / r.width) * W, 0, W),
      y: clamp(((clientY - r.top) / r.height) * H, 0, H),
    };
  }

  window.addEventListener('keydown', function (e) {
    const k = e.code;
    if (k === 'ArrowLeft' || k === 'KeyA') { input.left = true; updateAxis(); e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'KeyD') { input.right = true; updateAxis(); e.preventDefault(); }
    else if (k === 'Space' || k === 'Enter' || k === 'NumpadEnter') {
      e.preventDefault();
      Sound.unlock();
      primaryAction();
    } else if (k === 'KeyP' || k === 'Escape') {
      e.preventDefault();
      togglePause();
    } else if (k === 'KeyR') {
      Sound.unlock();
      if (G.state !== 'menu') restart();
      else primaryAction();
    } else if (k === 'KeyM') {
      Sound.unlock();
      toggleMute();
    } else if (k === 'KeyF') {
      Sound.unlock();
      toggleFullscreen();
    }
  });

  window.addEventListener('keyup', function (e) {
    const k = e.code;
    if (k === 'ArrowLeft' || k === 'KeyA') { input.left = false; updateAxis(); }
    else if (k === 'ArrowRight' || k === 'KeyD') { input.right = false; updateAxis(); }
  });

  /* pointer / mouse on the arena — hover must not hijack keyboard control */
  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse' && !input.pointerDown) return;
    const p = toLogical(e.clientX, e.clientY);
    input.pointerX = p.x;
    input.pointerY = p.y;
    input.pointerActive = true;
  });

  canvas.addEventListener('pointerdown', function (e) {
    const p = toLogical(e.clientX, e.clientY);
    input.pointerX = p.x;
    input.pointerY = p.y;
    input.pointerActive = true;
    input.pointerDown = true;
    Sound.unlock();
    if (canvas.setPointerCapture && e.pointerId != null) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    primaryAction();
    e.preventDefault();
  });

  canvas.addEventListener('pointerup', function () { input.pointerDown = false; });
  canvas.addEventListener('pointercancel', function () {
    input.pointerDown = false;
    input.pointerActive = false;
  });
  canvas.addEventListener('pointerleave', function () {
    input.pointerActive = false;
    input.pointerDown = false;
  });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* on-screen touch controls */
  function bindTouchButton(el, dir) {
    const down = function (e) {
      e.preventDefault();
      el.classList.add('held');
      if (dir < 0) { input.left = true; updateAxis(); }
      else if (dir > 0) { input.right = true; updateAxis(); }
      else { Sound.unlock(); primaryAction(); }
    };
    const up = function (e) {
      e.preventDefault();
      el.classList.remove('held');
      if (dir < 0) { input.left = false; updateAxis(); }
      else if (dir > 0) { input.right = false; updateAxis(); }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  /** Single "confirm" entry point for space / enter / click / ❄️ button. */
  function primaryAction() {
    switch (G.state) {
      case 'menu':
      case 'gameover':
      case 'victory':
        startGame();
        break;
      case 'paused':
        togglePause();
        break;
      case 'serve':
        launchBalls();
        break;
      default:
        break;
    }
  }

  function togglePause() {
    if (G.state === 'play' || G.state === 'serve') {
      G.pausedFrom = G.state;
      setState('paused');
    } else if (G.state === 'paused') {
      setState(G.pausedFrom || 'play');
    }
  }

  function restart() {
    Sound.unlock();
    startGame();
  }

  function toggleMute() {
    const next = !Sound.isMuted();
    Sound.setMuted(next);
    saveMuted(next);
    ui.btnSound.classList.toggle('off', next);
    ui.btnSound.querySelector('.ico-sound').textContent = next ? '🔇' : '🔊';
    ui.btnSound.setAttribute('aria-pressed', String(next));
  }

  function toggleFullscreen() {
    const shell = document.getElementById('shell');
    if (!document.fullscreenElement) {
      const rq = shell && (shell.requestFullscreen || shell.webkitRequestFullscreen);
      if (!rq) return;
      try {
        const ret = rq.call(shell);
        if (ret && ret.catch) ret.catch(function () { /* denied */ });
      } catch (e) { /* unsupported */ }
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  }

  /* Update icon when fullscreen changes (button click, ESC key, browser UI) */
  document.addEventListener('fullscreenchange', function () {
    if (!ui.btnFullscreen) return;
    const isFs = !!document.fullscreenElement;
    ui.btnFullscreen.querySelector('.ico-fullscreen').textContent = isFs ? '↙' : '↗';
    ui.btnFullscreen.setAttribute('aria-pressed', String(isFs));
  });

  function isTouch() {
    if (isTouch.cached == null) {
      isTouch.cached = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }
    return isTouch.cached;
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && (G.state === 'play' || G.state === 'serve')) togglePause();
  });

  /* ==========================================================================
   * 09 · UI GLUE + BOOT
   * ======================================================================== */

  const ui = {
    score: document.getElementById('uiScore'),
    level: document.getElementById('uiLevel'),
    levelNum: document.getElementById('uiLevelNum'),
    levelMax: document.getElementById('uiLevelMax'),
    lives: document.getElementById('uiLives'),
    comboChip: document.getElementById('uiComboChip'),
    combo: document.getElementById('uiCombo'),
    banner: document.getElementById('banner'),
    bannerTitle: document.getElementById('bannerTitle'),
    bannerSub: document.getElementById('bannerSub'),
    btnSound: document.getElementById('btnSound'),
    btnPause: document.getElementById('btnPause'),
    btnRestart: document.getElementById('btnRestart'),
    btnFullscreen: document.getElementById('btnFullscreen'),
    btnArcade: document.getElementById('btnArcade'),
    ovMenu: document.getElementById('ovMenu'),
    ovPause: document.getElementById('ovPause'),
    ovOver: document.getElementById('ovOver'),
    ovWin: document.getElementById('ovWin'),
  };

  function show(node, on) {
    node.classList.toggle('hidden', !on);
  }

  function syncUI() {
    ui.score.textContent = G.score.toLocaleString('en-US');
    if (ui.levelNum) ui.levelNum.textContent = String(G.level);
    else ui.level.textContent = String(G.level);
    ui.levelMax.textContent = '/' + LEVELS.length;

    let hearts = '';
    for (let i = 0; i < START_LIVES; i++) {
      hearts += '<b class="' + (i < G.lives ? '' : 'spent') + '">♥</b>';
    }
    ui.lives.innerHTML = hearts;

    const m = comboMult();
    ui.combo.textContent = 'x' + m;
    ui.comboChip.hidden = G.combo < 2;

    show(ui.ovMenu, G.state === 'menu');
    show(ui.ovPause, G.state === 'paused');
    show(ui.ovOver, G.state === 'gameover');
    show(ui.ovWin, G.state === 'victory');

    const canPause = G.state === 'play' || G.state === 'serve' || G.state === 'paused';
    ui.btnPause.disabled = !canPause;
    ui.btnPause.classList.toggle('off', !canPause);
    ui.btnPause.setAttribute('aria-pressed', String(G.state === 'paused'));
    ui.btnPause.querySelector('.ico-pause').textContent = G.state === 'paused' ? '▶' : '❚❚';

    stage.classList.toggle('menu-open', G.state === 'menu' || G.state === 'gameover' || G.state === 'victory');
  }

  function fillEndScreen() {
    document.getElementById('ovOverScore').textContent = G.score.toLocaleString('en-US');
    document.getElementById('ovOverLevel').textContent = G.level + ' / ' + LEVELS.length;
    document.getElementById('ovOverBricks').textContent = G.bricksBroken;
    document.getElementById('ovOverCombo').textContent = G.bestCombo + ' hits';
    document.getElementById('ovOverBest').textContent = G.best.toLocaleString('en-US');
    document.getElementById('ovWinScore').textContent = G.score.toLocaleString('en-US');
    document.getElementById('ovWinBricks').textContent = G.bricksBroken;
    document.getElementById('ovWinCombo').textContent = G.bestCombo + ' hits';
    document.getElementById('ovWinLives').textContent = G.lives;
    document.getElementById('ovWinBest').textContent = G.best.toLocaleString('en-US');
  }

  /* --- wire up DOM controls ------------------------------------------------ */
  /* Space/Enter also clicks a focused button natively — drop button focus on
     activation so game keys never double-fire a menu action. */
  document.addEventListener('click', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (btn && btn.blur) btn.blur();
  });

  document.getElementById('btnStart').addEventListener('click', function () { Sound.unlock(); startGame(); });
  document.getElementById('btnResume').addEventListener('click', function () { togglePause(); });
  document.getElementById('btnRetry').addEventListener('click', function () { Sound.unlock(); startGame(); });
  document.getElementById('btnPlayAgain').addEventListener('click', function () { Sound.unlock(); startGame(); });
  ui.btnPause.addEventListener('click', function () { Sound.unlock(); togglePause(); });
  ui.btnRestart.addEventListener('click', function () { restart(); });
  ui.btnSound.addEventListener('click', function () { Sound.unlock(); toggleMute(); });
  ui.btnFullscreen.addEventListener('click', function () { Sound.unlock(); toggleFullscreen(); });
  if (ui.btnArcade) ui.btnArcade.addEventListener('click', function () { window.location.href = 'games/shell.html'; });

  ['btnMenu2', 'btnMenu3'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function () {
      document.getElementById('btnQuit').click();
    });
  });
  document.getElementById('btnQuit').addEventListener('click', function () {
    G.balls = []; G.powerups = []; G.particles = []; G.rings = []; G.texts = [];
    G.shield = 0; G.paddle = new Paddle();
    setState('menu');
  });

  function quitGame() {
    /* back to the menu — scores/best are already persisted via addScore */
    G.balls = []; G.powerups = []; G.particles = []; G.rings = []; G.texts = [];
    G.shield = 0; G.paddle = new Paddle();
    setState('menu');
  }

  ['btnQuitGame', 'btnQuitGameOver', 'btnQuitGameWin'].forEach(function (id) {
    document.getElementById(id).addEventListener('click', function () {
      quitGame();
    });
  });

  bindTouchButton(document.getElementById('btnLeft'), -1);
  bindTouchButton(document.getElementById('btnRight'), 1);
  bindTouchButton(document.getElementById('btnFire'), 0);

  /* --- end-screen population hook ---------------------------------------- */
  const _setState = setState;
  setState = function (s) {
    _setState(s);
    if (s === 'gameover' || s === 'victory') fillEndScreen();
    emit('state', { state: s, level: G.level, score: G.score, mode: G.mode });
  };

  /* --- game loop ----------------------------------------------------------- */
  let last = 0;
  function frame(ts) {
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    dt = clamp(dt, 0, 1 / 20);        // clamp to survive tab stalls

    if (G.state !== 'paused') update(dt);
    else { G.time += dt * 0.15; updateParticles(dt * 0.4); }   // gentle idle motion while paused

    render();
    requestAnimationFrame(frame);
  }

  /* --- boot ---------------------------------------------------------------- */
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () { setTimeout(resize, 120); });

  /* --- debug / automation handle -----------------------------------------
   * Handy while tinkering: open the console and call
   *   frostBreakout.goto(5) · frostBreakout.give('shield') · frostBreakout.stats()
   * Not required by the game in any way.                                     */
  window.frostBreakout = {
    game: G,
    levels: LEVELS,
    brickTypes: BT,
    state: function () { return G.state; },
    stats: function () {
      const types = {};
      G.bricks.forEach(function (b) { types[b.type.label] = (types[b.type.label] || 0) + 1; });
      return {
        state: G.state, level: G.level, levelName: LEVELS[G.level - 1].name,
        score: G.score, lives: G.lives, bricks: G.bricks.length, solid: G.bricksTotal,
        balls: G.balls.length, particles: G.particles.length,
        shield: Math.round(G.shield * 10) / 10, paddleW: Math.round(G.paddle.w),
        ballSpeed: G.balls.length ? Math.round(Math.hypot(G.balls[0].vx, G.balls[0].vy)) : 0,
        types: types,
        mode: G.mode, endlessDepth: G.endlessDepth,
      };
    },
    samples: function () { return Sound.sampleNames(); },
    muted: function () { return Sound.isMuted(); },
    setVolume: function (v) { Sound.setVolume(v); },
    getVolume: function () { return Sound.getVolume(); },
    getSettings: function () { return getSettings(); },
    start: function (opts) { startGame(opts); },
    startMode: function (mode, extra) {
      extra = extra || {};
      if (mode === 'daily') {
        const d = new Date(); const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        G.dailySeed = seed;
        startGame({ mode: 'daily', level: 1 });
        return seed;
      }
      if (mode === 'endless') { G.endlessDepth = 0; startGame({ mode: 'endless', level: 1 }); loadLevel(1, { keepMode: true, endless: true }); return 0; }
      if (mode === 'custom' && extra.bricks) {
        G.customBricks = extra.bricks; G.customName = extra.name || 'CUSTOM'; G.customSpeed = extra.speed || null;
        startGame({ mode: 'custom', level: 1, speed: G.customSpeed, bricks: G.customBricks });
        return 0;
      }
      startGame({ mode: 'classic' });
    },
    restart: function () { restart(); },
    launch: function () { launchBalls(); },
    goto: function (n) { G.balls = []; G.mode = G.mode || 'classic'; loadLevel(clamp(n | 0, 1, LEVELS.length)); },
    saveRun: saveRun, loadRun: loadRun, clearRun: clearRun,
    continueRun: function () {
      const r = loadRun();
      if (!r) return false;
      G.mode = r.mode || 'classic'; G.endlessDepth = r.endlessDepth || 0;
      startGame({ mode: G.mode, level: r.level, score: r.score, lives: r.lives, bricksBroken: r.bricksBroken, bestCombo: r.bestCombo });
      if (G.mode === 'endless') loadLevel(r.level, { keepMode: true, endless: true });
      return true;
    },
    clearLevel: function () {
      G.bricks = G.bricks.filter(function (b) { return b.indestructible; });
      checkLevelCleared();
    },
    killBalls: function () {
      if (G.state === 'serve') launchBalls();
      if (!G.balls.length) newBallOnPaddle();
      G.balls.forEach(function (b) { b.dead = true; });
    },
    give: function (key) {
      if (G.state !== 'play' && G.state !== 'serve') return;
      const def = PU[key] || PU[pick(PU_ORDER)];
      collectPowerUp(new PowerUp(G.paddle.x, G.paddle.y - 90, def));
    },
    autoplay: function (on) {
      G.autoplay = !!on;
      if (!on) { input.pointerActive = false; return; }
      input.pointerActive = true;
    },
  };

  resize();
  makeSnow();
  buildLevel(1);
  G.balls = [];
  syncUI();
  if (loadMuted()) toggleMute();
  Sound.loadSamples();
  requestAnimationFrame(frame);
})();