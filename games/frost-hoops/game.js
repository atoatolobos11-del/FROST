/**
 * Frost Hoops — Messenger-style solo basketball.
 * Front-view hoop sways side to side. Swipe UP fast to shoot.
 * 3 misses and the run ends. Hoop gets quicker every basket.
 * Exports: { init(canvas, shared), destroy(), togglePause() }
 */

let shared = null;
let canvas = null;
let ctx = null;
let animationId = null;
let running = false;
let lastTs = 0;

const W = 960, H = 540;
const GRAV = 1500;
const LAUNCH_BOOST = 1.3; // comfortable flicks still reach the rim
const BALL_R = 16;
const FLOOR = H - 30;
const GAME_TIME = 60;

const C = {
  bg: '#030710', ice: '#e8faff', ice2: '#bae6fd', ice3: '#38bdf8',
  orange: '#ff9a3c', deep: '#c22e12', red: '#ef4444', gold: '#ffd479',
  stroke: 'rgba(90,210,255,.35)',
};

/* global arcade settings */
function diffMult() { try { return (shared && shared.difficultyMult) ? shared.difficultyMult() : 1; } catch (e) { return 1; } }
function kick(v) { if (shared && shared.fxOn && !shared.fxOn('shake')) return; shake = Math.max(shake, v); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* state */
let state = 'menu'; // menu | ready | aiming | flying | paused | gameover
let pausedFrom = 'ready';
let ball = null;
let hoopX = W / 2;
let score = 0, best = 0, streak = 0, bestStreak = 0, timeLeft = GAME_TIME;
let swayT = 0;
let netAnim = 0;
let shake = 0;
let popups = [];
let rimQuietUntil = 0;
let dragTrail = null; // [{x,y,t}] while aiming
let flightMinY = 0;
let resolved = true;

function rimRx() { return 72 / diffMult(); }
function swaySpeed() { return (0.5 + score * 0.05) * diffMult(); }
function swayAmp() { return Math.min(220, 110 + score * 8); }
function hoopY() { return 150; }

function reset() {
  score = 0; streak = 0; bestStreak = 0; timeLeft = GAME_TIME;
  swayT = 0; netAnim = 0;
  popups = [];
  spawnBall();
}

function spawnBall() {
  ball = {
    x: W / 2 + (Math.random() - 0.5) * 320,
    y: FLOOR - BALL_R,
    vx: 0, vy: 0,
  };
  flightMinY = ball.y;
  resolved = true;
  state = 'ready';
}

function toGame(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H, t: performance.now() };
}

/* gentle aim assist: bend the flick toward a makeable arc so mouse
   shots forgive small direction errors. Preview uses the same math. */
const ASSIST = 0.65;
function predictHoopX(tau) {
  // exact copy of update()'s sway math: hoopX(t) = W/2 + sin(swayT + w*tau) * amp
  return W / 2 + Math.sin(swayT + swaySpeed() * tau) * swayAmp();
}
/* launch pipeline: compress wild flicks into a consistent power band,
   then bend toward the exact intercept. Preview and release share it. */
function bandVelocity(raw) {
  if (!raw) return null;
  const s = 1100 + Math.min(1, (raw.sp - 450) / 1300) * 400;
  const rl = Math.hypot(raw.vx, raw.vy) || 1;
  return assistedVelocity({ vx: raw.vx / rl * s, vy: raw.vy / rl * s, sp: s });
}
/* exact intercept: velocity with speed s from (sx,sy) through (tx,ty).
   Scans flight time for the best fit; null when physically unreachable. */
function solveIntercept(sx, sy, tx, ty, s) {
  const dx = tx - sx, dy = ty - sy;
  let bestT = 0, bestErr = Infinity;
  for (let T = 0.2; T <= 2.5; T += 0.02) {
    const ex = dx, ey = dy - 0.5 * GRAV * T * T;
    const err = Math.abs(Math.hypot(ex, ey) - s * T);
    if (err < bestErr) { bestErr = err; bestT = T; }
  }
  if (bestErr > 40) return null;
  const T = bestT;
  return { vx: dx / T, vy: (dy - 0.5 * GRAV * T * T) / T, T: T };
}
function assistedVelocity(v) {
  if (!v) return null;
  const s = Math.min(v.sp, 2300);
  // iterate twice: hoop prediction <-> intercept solution converge
  let T = 0.7, hx = hoopX;
  for (let k = 0; k < 2; k++) {
    hx = clamp(predictHoopX(T), 90, W - 90);
    const sol = solveIntercept(ball.x, ball.y, hx, hoopY() - 6, s);
    if (!sol) return v; // too weak to reach — honest miss, no fake help
    T = sol.T;
  }
  const sol = solveIntercept(ball.x, ball.y, hx, hoopY() - 6, s);
  if (!sol) return v;
  let vx = v.vx * (1 - ASSIST) + sol.vx * ASSIST;
  let vy = v.vy * (1 - ASSIST) + sol.vy * ASSIST;
  const sp = Math.hypot(vx, vy);
  const MAXV = 2300;
  if (sp > MAXV) { vx = vx / sp * MAXV; vy = vy / sp * MAXV; }
  return { vx: vx, vy: vy, sp: Math.min(sp, MAXV) };
}

/* flick velocity from the last ~100ms of the drag */
function flickVelocity() {
  if (!dragTrail || dragTrail.length < 2) return null;
  const last = dragTrail[dragTrail.length - 1];
  let first = dragTrail[0];
  for (let i = dragTrail.length - 1; i >= 0; i--) {
    if (last.t - dragTrail[i].t <= 110) first = dragTrail[i];
    else break;
  }
  const dt = Math.max(16, last.t - first.t) / 1000;
  let vx = (last.x - first.x) / dt * LAUNCH_BOOST;
  let vy = (last.y - first.y) / dt * LAUNCH_BOOST;
  const sp = Math.hypot(vx, vy);
  const MAXV = 2300;
  if (sp > MAXV) { vx = vx / sp * MAXV; vy = vy / sp * MAXV; }
  return { vx: vx, vy: vy, sp: Math.min(sp, MAXV) };
}

/* ---- audio ---- */
function thud(hard) { shared.tone({ f0: hard ? 170 : 130, f1: 90, dur: 0.07, vol: 0.18, type: 'sine' }); }
function clank() {
  const now = performance.now();
  if (now < rimQuietUntil) return;
  rimQuietUntil = now + 90;
  shared.tone({ f0: 520, f1: 470, dur: 0.07, vol: 0.18, type: 'square' });
}
function swishSnd() { shared.noiseBurst({ hpf: 2500, dur: 0.25, vol: 0.3 }); }
function cheer() {
  [660, 880, 1174].forEach(function (f, i) {
    shared.tone({ f0: f, type: 'triangle', dur: 0.14, vol: 0.2, delay: i * 0.06 });
  });
}
function buzzerSnd() { shared.tone({ f0: 196, f1: 140, dur: 0.7, vol: 0.32, type: 'sawtooth' }); }

/* ---- scoring ---- */
function onBasket() {
  resolved = true;
  score++;
  streak++;
  bestStreak = Math.max(bestStreak, streak);
  popups.push({ x: hoopX, y: hoopY() + 60, str: streak >= 3 ? '+' + 1 + '  🔥x' + streak : '+1', life: 0, max: 1 });
  netAnim = 0.6;
  swishSnd(); cheer();
  shared.spawnParticles({ x: hoopX, y: hoopY(), count: 22, color: C.gold, speed: 220, life: 0.7, size: 4 });
  kick(4);
  if (score > best) { best = score; shared.saveScore('hoops', best); }
}

function onMiss() {
  resolved = true;
  streak = 0;
  popups.push({ x: ball.x, y: 300, str: 'MISS', life: 0, max: 0.8 });
  shared.tone({ f0: 220, f1: 140, dur: 0.2, vol: 0.2, type: 'square' });
  spawnBall();
}

/* ---- update ---- */
function update(dt) {
  if (state !== 'ready' && state !== 'aiming' && state !== 'flying') return;

  /* clock — the run ends at zero */
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    state = 'gameover';
    buzzerSnd();
    return;
  }

  /* hoop sway */
  swayT += dt * swaySpeed();
  hoopX = W / 2 + Math.sin(swayT) * swayAmp();
  netAnim = Math.max(0, netAnim - dt);

  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].life += dt;
    if (popups[i].life >= popups[i].max) popups.splice(i, 1);
  }

  if (state !== 'flying') {
    shake = Math.max(0, shake - dt * 8);
    shared.updateParticles(dt);
    return;
  }

  const rx = rimRx(), hy = hoopY();
  const prevY = ball.y;
  ball.vy += GRAV * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  ball.rot = (ball.rot || 0) + dt * (3 + ball.vx * 0.004);
  if (ball.y < flightMinY) flightMinY = ball.y;

  shared.spawnParticles({ x: ball.x, y: ball.y, count: 2, color: C.orange, speed: 30, life: 0.3, size: 3 });

  /* rim posts */
  [[hoopX - rx, hy], [hoopX + rx, hy]].forEach(function (pt) {
    const dx = ball.x - pt[0], dy = ball.y - pt[1];
    const d = Math.hypot(dx, dy), min = BALL_R + 5;
    if (d < min && d > 0.001) {
      const nx = dx / d, ny = dy / d;
      ball.x = pt[0] + nx * min; ball.y = pt[1] + ny * min;
      const dot = ball.vx * nx + ball.vy * ny;
      if (dot < 0) {
        ball.vx -= 1.55 * dot * nx;
        ball.vy -= 1.55 * dot * ny;
        if (Math.hypot(ball.vx, ball.vy) > 180) clank();
      }
    }
  });

  /* backboard: solid only where it really is (min-axis resolution) */
  const bw = 230, bh = 150;
  const bx0 = hoopX - bw / 2, bx1 = hoopX + bw / 2;
  const by0 = hy - 40 - bh, by1 = hy - 40;
  const ex0 = bx0 - BALL_R, ex1 = bx1 + BALL_R;
  const ey0 = by0 - BALL_R, ey1 = by1 + BALL_R;
  if (ball.x > ex0 && ball.x < ex1 && ball.y > ey0 && ball.y < ey1) {
    const pl = ball.x - ex0, pr = ex1 - ball.x;
    const pt = ball.y - ey0, pb = ey1 - ball.y;
    const m = Math.min(pl, pr, pt, pb);
    if (m === pb) { ball.y = ey1; if (ball.vy < 0) { ball.vy = -ball.vy * 0.45; thud(true); } }
    else if (m === pt) { ball.y = ey0; if (ball.vy > 0) { ball.vy = -ball.vy * 0.45; thud(true); } }
    else if (m === pl) { ball.x = ex0; if (ball.vx > 0) { ball.vx = -ball.vx * 0.5; thud(true); } }
    else { ball.x = ex1; if (ball.vx < 0) { ball.vx = -ball.vx * 0.5; thud(true); } }
  }

  /* basket: clean downward entry through the mouth */
  if (!resolved && ball.vy > 0 && prevY < hy && ball.y >= hy &&
      Math.abs(ball.x - hoopX) < rx - 8) {
    onBasket();
  }

  /* walls + floor */
  if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx) * 0.55; thud(false); }
  if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.55; thud(false); }
  if (ball.y + BALL_R > FLOOR) {
    ball.y = FLOOR - BALL_R;
    if (Math.abs(ball.vy) > 140) { ball.vy = -ball.vy * 0.5; ball.vx *= 0.85; thud(false); }
    else { ball.vy = 0; ball.vx *= (1 - Math.min(1, 3 * dt)); }
  }

  /* resolve flight: miss, or new ball after a basket */
  const speed = Math.hypot(ball.vx, ball.vy);
  if (ball.y > H + 60 || (ball.y + BALL_R >= FLOOR - 1 && speed < 70)) {
    ball.settle = (ball.settle || 0) + dt;
    if (ball.settle > 0.5 || ball.y > H + 60) {
      ball.settle = 0;
      if (!resolved) onMiss();
      else spawnBall();
    }
  } else {
    ball.settle = 0;
  }

  shake = Math.max(0, shake - dt * 8);
  shared.updateParticles(dt);
}

/* deterministic leather pebbling, computed once */
const PEBBLES = (function () {
  let seed = 1234567;
  const rnd = function () {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const arr = [];
  for (let i = 0; i < 150; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.15 + rnd() * 0.8;
    arr.push({ a: a, r: r, s: 0.8 + rnd() * 1.1 });
  }
  return arr;
})();
/* ---- render ---- */
function drawBallShape() {
  /* floor shadow shrinks as the ball rises */
  const hgt = clamp(FLOOR - ball.y, 0, 500);
  ctx.fillStyle = 'rgba(0,0,0,' + (0.34 - hgt / 500 * 0.26).toFixed(3) + ')';
  ctx.beginPath();
  ctx.ellipse(ball.x, FLOOR + 8, 30 - hgt / 500 * 14, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(ball.rot || 0);
  /* leather body with darkened edge */
  const grd = ctx.createRadialGradient(-5, -6, 2, 0, 0, BALL_R + 2);
  grd.addColorStop(0, '#f7b25e');
  grd.addColorStop(0.55, '#e07f2e');
  grd.addColorStop(0.85, '#a34a17');
  grd.addColorStop(1, '#6e2c0c');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, Math.PI * 2); ctx.fill();
  /* pebbling */
  ctx.fillStyle = 'rgba(90,35,8,0.35)';
  PEBBLES.forEach(function (p) {
    const px = Math.cos(p.a) * BALL_R * p.r, py = Math.sin(p.a) * BALL_R * p.r;
    if (px * px + py * py > (BALL_R - 1) * (BALL_R - 1)) return;
    ctx.beginPath(); ctx.arc(px, py, p.s, 0, Math.PI * 2); ctx.fill();
  });
  /* seams */
  ctx.strokeStyle = 'rgba(40,14,4,0.9)';
  ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(0, 0, BALL_R - 0.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-BALL_R, 0); ctx.lineTo(BALL_R, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -BALL_R); ctx.lineTo(0, BALL_R); ctx.stroke();
  ctx.beginPath(); ctx.arc(-BALL_R * 1.6, 0, BALL_R * 1.35, -0.7, 0.7); ctx.stroke();
  ctx.beginPath(); ctx.arc(BALL_R * 1.6, 0, BALL_R * 1.35, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
  ctx.restore();
  /* glossy highlight (unrotated light source) */
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(-5, -7, 5, 3.2, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHoopFront(t) {
  const hx = hoopX, hy = hoopY(), rx = rimRx();
  /* ── realistic glass backboard ── */
  const bw = 230, bh = 150;
  const bx = hx - bw / 2, by = hy - 40 - bh;
  const glass = ctx.createLinearGradient(bx, by, bx, by + bh);
  glass.addColorStop(0, 'rgba(205,232,250,0.34)');
  glass.addColorStop(0.55, 'rgba(170,210,240,0.16)');
  glass.addColorStop(1, 'rgba(140,190,230,0.26)');
  ctx.fillStyle = glass;
  ctx.fillRect(bx, by, bw, bh);
  /* diagonal shine streaks */
  ctx.save();
  ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.moveTo(bx + 20, by + bh); ctx.lineTo(bx + 90, by); ctx.lineTo(bx + 130, by); ctx.lineTo(bx + 60, by + bh);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(bx + 110, by + bh); ctx.lineTo(bx + 180, by); ctx.lineTo(bx + 196, by); ctx.lineTo(bx + 126, by + bh);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  /* metal frame */
  const frame = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  frame.addColorStop(0, '#8d99ab');
  frame.addColorStop(0.5, '#4a5465');
  frame.addColorStop(1, '#2c3340');
  ctx.strokeStyle = frame;
  ctx.lineWidth = 9;
  ctx.strokeRect(bx, by, bw, bh);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(bx + 5, by + 5, bw - 10, bh - 10);
  /* shooter square */
  ctx.strokeStyle = 'rgba(220,240,255,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(hx - 32, hy - 40 - 62, 64, 56);
  /* pole */
  const pole = ctx.createLinearGradient(hx - 5, 0, hx + 5, 0);
  pole.addColorStop(0, '#3a4250');
  pole.addColorStop(0.5, '#7c8798');
  pole.addColorStop(1, '#333b47');
  ctx.strokeStyle = pole;
  ctx.lineWidth = 10;
  ctx.beginPath(); ctx.moveTo(hx, by + 4); ctx.lineTo(hx, 0); ctx.stroke();
  /* woven rope net */
  const sway = netAnim > 0 ? Math.sin(t * 30) * 7 * netAnim : Math.sin(t * 2) * 1.5;
  const loops = 8, netH = 54;
  const topAt = function (i) { return hx - rx * 0.92 + (i / (loops - 1)) * rx * 1.84; };
  const botAt = function (i) { return hx + sway - rx * 0.34 + (i / (loops - 1)) * rx * 0.68; };
  ctx.lineWidth = 2;
  for (let i = 0; i < loops; i++) {
    ctx.strokeStyle = 'rgba(242,240,232,0.85)';
    ctx.beginPath();
    ctx.moveTo(topAt(i), hy + 2);
    ctx.lineTo(botAt(i), hy + netH);
    ctx.stroke();
    if (i < loops - 1) {
      ctx.strokeStyle = 'rgba(225,220,210,0.6)';
      ctx.beginPath();
      ctx.moveTo(topAt(i), hy + 2);
      ctx.lineTo(botAt(i + 1), hy + netH);
      ctx.stroke();
    }
  }
  [0.45, 0.8, 1.0].forEach(function (k, ri) {
    ctx.strokeStyle = 'rgba(240,238,230,' + (0.75 - ri * 0.15) + ')';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(hx + sway * k, hy + netH * k, rx * (0.92 - 0.58 * k), 6 + 4 * (1 - k), 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  /* metal rim */
  ctx.fillStyle = '#4a5465';
  ctx.fillRect(hx - rx - 14, hy - 9, 16, 12);
  ctx.fillRect(hx + rx - 2, hy - 9, 16, 12);
  ctx.strokeStyle = '#7e2a0e';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.ellipse(hx, hy + 1, rx, 13, 0, 0, Math.PI * 2);
  ctx.stroke();
  const steel = ctx.createLinearGradient(hx - rx, 0, hx + rx, 0);
  steel.addColorStop(0, '#c33f14');
  steel.addColorStop(0.5, '#ff7a33');
  steel.addColorStop(1, '#c33f14');
  ctx.strokeStyle = steel;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.ellipse(hx, hy, rx, 13, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,205,150,0.85)';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.ellipse(hx, hy - 2, rx - 2, 10, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
}


function drawAim() {
  const raw = flickVelocity();
  if (!raw || raw.sp < 450) return;
  const v = bandVelocity(raw);
  if (!v) return;
  let px = ball.x, py = ball.y, vx = v.vx, vy = v.vy;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  for (let i = 0; i < 20; i++) {
    const step = 1 / 40;
    vy += GRAV * step;
    px += vx * step; py += vy * step;
    if (i % 2 === 0) { ctx.beginPath(); ctx.arc(px, py, 3.5, 0, Math.PI * 2); ctx.fill(); }
    if (py > FLOOR || px < 0 || px > W) break;
  }
}

function drawOverlay(title, subtitle) {
  ctx.fillStyle = 'rgba(3,7,16,0.85)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = 'bold 50px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = C.orange;
  ctx.fillText(title, W / 2, H / 2 - 20);
  ctx.font = '18px Segoe UI, sans-serif';
  ctx.fillStyle = C.ice2;
  subtitle.split('\n').forEach(function (line, i) {
    ctx.fillText(line, W / 2, H / 2 + 24 + i * 28);
  });
}

function render() {
  if (!ctx) return;
  const t = performance.now() / 1000;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

  ctx.fillStyle = C.bg;
  ctx.fillRect(-20, -20, W + 40, H + 40);

  /* floor */
  ctx.fillStyle = 'rgba(20,40,70,0.7)';
  ctx.fillRect(0, FLOOR, W, H - FLOOR);
  ctx.strokeStyle = C.stroke;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, FLOOR); ctx.lineTo(W, FLOOR); ctx.stroke();

  drawHoopFront(t);

  if (ball && state !== 'menu' && state !== 'gameover') {
    if (state === 'aiming') drawAim();
    drawBallShape();
    if (state === 'ready') {
      ctx.font = '15px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(220,240,255,' + (0.5 + Math.sin(t * 4) * 0.3) + ')';
      ctx.fillText('swipe UP fast to shoot!', ball.x, ball.y - 34);
    }
  }

  popups.forEach(function (p) {
    const k = p.life / p.max;
    ctx.font = 'bold 24px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,212,121,' + (1 - k) + ')';
    ctx.fillText(p.str, p.x, p.y - k * 50);
  });

  /* HUD */
  ctx.textAlign = 'left';
  ctx.font = 'bold 26px monospace';
  ctx.fillStyle = C.ice2;
  ctx.fillText('' + score, 20, 36);
  ctx.font = '15px monospace';
  ctx.fillStyle = C.gold;
  ctx.fillText('BEST ' + best, 20, 60);
  if (streak >= 2) {
    ctx.fillStyle = C.orange;
    ctx.font = 'bold 18px monospace';
    ctx.fillText('🔥 x' + streak, 20, 84);
  }
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px monospace';
  ctx.fillStyle = timeLeft <= 10 ? C.red : C.ice;
  ctx.fillText(Math.ceil(timeLeft) + 's', W / 2, 36);

  if (state === 'menu') drawOverlay('FROST HOOPS 🏀', 'Swipe UP fast on the ball to shoot\n60 seconds · most baskets wins\nTap to start');
  else if (state === 'paused') drawOverlay('PAUSED', 'Tap to resume');
  else if (state === 'gameover') drawOverlay('TIME UP!', 'Score: ' + score + '   Best: ' + best + '\nBest streak: ' + bestStreak + '\nTap to play again');

  shared.drawParticles(ctx);
  ctx.restore();
}

/* ---- input ---- */
function onPointerDown(e) {
  const p = toGame(e);
  if (state === 'menu') { reset(); state = 'ready'; e.preventDefault(); return; }
  if (state === 'gameover') { reset(); state = 'ready'; e.preventDefault(); return; }
  if (state === 'paused') { state = pausedFrom; e.preventDefault(); return; }
  if (state !== 'ready') return;
  const nearBall = Math.hypot(p.x - ball.x, p.y - ball.y) <= 130;
  const bottomZone = p.y > H - 170; // forgiving grab area along the floor
  if (!nearBall && !bottomZone) return; // must grab the ball area
  dragTrail = [{ x: p.x, y: p.y, t: p.t }];
  state = 'aiming';
  e.preventDefault();
}
function onPointerMove(e) {
  if (state !== 'aiming' || !dragTrail) return;
  const p = toGame(e);
  dragTrail.push({ x: p.x, y: p.y, t: p.t });
  if (dragTrail.length > 24) dragTrail.shift();
  e.preventDefault();
}
function onPointerUp() {
  if (state !== 'aiming') { dragTrail = null; return; }
  const raw = flickVelocity();
  dragTrail = null;
  if (!raw || raw.sp < 450 || raw.vy > -100) { state = 'ready'; return; } // too soft — no shot
  // compress wild flicks into a consistent power band: direction is yours, pace is tamed
  const v = bandVelocity(raw);
  ball.vx = v.vx; ball.vy = v.vy;
  flightMinY = ball.y;
  resolved = false;
  ball.settle = 0;
  state = 'flying';
  shared.tone({ f0: 300, f1: 600, dur: 0.1, vol: 0.2, type: 'triangle' });
}

function onKeyDown(e) {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (state === 'menu' || state === 'gameover') { reset(); state = 'ready'; }
    else if (state === 'playing') togglePause();
  }
  if (e.code === 'KeyP') togglePause();
}
function onBlur() { dragTrail = null; if (state === 'aiming') state = 'ready'; }

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function loop(ts) {
  if (!running) return;
  if (!ts) ts = performance.now();
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 20) : 1 / 60;
  lastTs = ts;
  update(dt);
  render();
  animationId = requestAnimationFrame(loop);
}

export function init(c, sh) {
  if (running) { try { destroy(); } catch (e) { /* ignore */ } }
  canvas = c; shared = sh; ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  best = shared.getBestScore('hoops') || 0;
  reset();
  state = 'menu';
  running = true;
  lastTs = 0;
  animationId = requestAnimationFrame(loop);
  shared.unlockAudio();
}

export function destroy() {
  running = false;
  if (animationId) cancelAnimationFrame(animationId);
  window.removeEventListener('resize', resize);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('blur', onBlur);
  if (canvas) {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  }
  dragTrail = null;
  if (shared) shared.clearParticles();
  canvas = null; ctx = null;
}

export function togglePause() {
  if (state === 'ready' || state === 'aiming' || state === 'flying') { pausedFrom = state; state = 'paused'; }
  else if (state === 'paused') state = pausedFrom;
}
