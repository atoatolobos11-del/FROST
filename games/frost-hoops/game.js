/**
 * Frost Hoops — Y8-style flick basketball shootout.
 * Drag back and release to shoot the fireball into the moving hoop.
 * 60 seconds, streaks multiply points, swishes add bonus time.
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
const BALL_R = 14;
const FLOOR = H - 24;
const GAME_TIME = 60;

const C = {
  bg: '#030710', ice: '#e8faff', ice2: '#bae6fd', ice3: '#38bdf8',
  orange: '#ff9a3c', deep: '#c22e12', red: '#ef4444', gold: '#ffd479',
  violet: '#c084fc', stroke: 'rgba(90,210,255,.35)',
};

/* state */
let state = 'menu'; // menu | ready | aiming | flying | paused | gameover
let pausedFrom = 'ready';
let ball = null;
let hoop = null;
let score = 0, best = 0, streak = 0, bestStreak = 0, timeLeft = GAME_TIME;
let makes = 0, attempts = 0;
let shake = 0;
let drag = null; // { sx, sy, cx, cy }
let popups = [];
let settleT = 0;
let rimQuietUntil = 0;

/* global arcade settings */
function diffMult() { try { return (shared && shared.difficultyMult) ? shared.difficultyMult() : 1; } catch (e) { return 1; } }
function kick(v) { if (shared && shared.fxOn && !shared.fxOn('shake')) return; shake = Math.max(shake, v); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function newHoopTarget() {
  return { x: 480 + Math.random() * 380, y: 110 + Math.random() * 190 };
}

function reset(newBest) {
  const dm = diffMult();
  hoop = {
    x: 700, y: 180,
    rimHalf: 34 / dm,
    target: newHoopTarget(),
    speed: 90 * dm,
  };
  spawnBall();
  score = 0; streak = 0; bestStreak = 0; makes = 0; attempts = 0;
  timeLeft = GAME_TIME;
  popups = [];
  if (newBest !== undefined) best = newBest;
}

function spawnBall() {
  ball = {
    x: 120 + Math.random() * 300, y: FLOOR - BALL_R,
    vx: 0, vy: 0, scored: false, settleT: 0,
  };
  state = 'ready';
}

function toGame(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
}

function launchVelocity() {
  if (!drag) return null;
  let vx = (drag.sx - drag.cx) * 7;
  let vy = (drag.sy - drag.cy) * 7;
  const sp = Math.hypot(vx, vy);
  const MAXV = 1050;
  if (sp > MAXV) { vx = vx / sp * MAXV; vy = vy / sp * MAXV; }
  return { vx: vx, vy: vy, sp: Math.min(sp, MAXV) };
}

/* ---- audio helpers ---- */
function thud() { shared.tone({ f0: 150, f1: 90, dur: 0.08, vol: 0.2, type: 'sine' }); }
function clank() {
  const now = performance.now();
  if (now < rimQuietUntil) return;
  rimQuietUntil = now + 90;
  shared.tone({ f0: 520, f1: 480, dur: 0.07, vol: 0.18, type: 'square' });
}
function swish() { shared.noiseBurst({ hpf: 2500, dur: 0.25, vol: 0.3 }); }
function jingle() {
  [660, 880, 1320].forEach(function (f, i) {
    shared.tone({ f0: f, type: 'triangle', dur: 0.14, vol: 0.2, delay: i * 0.06 });
  });
}

/* ---- scoring ---- */
function onBasket() {
  ball.scored = true;
  makes++;
  streak++;
  bestStreak = Math.max(bestStreak, streak);
  const mult = Math.min(streak, 5);
  const pts = 100 * mult;
  score += pts;
  timeLeft = Math.min(99, timeLeft + 2);
  popups.push({ x: hoop.x, y: hoop.y + 30, str: '+' + pts + (mult > 1 ? '  x' + mult : ''), life: 0, max: 1 });
  if (streak >= 3) popups.push({ x: hoop.x, y: hoop.y + 56, str: streak + ' STREAK 🔥', life: 0, max: 1.2 });
  swish(); jingle();
  shared.spawnParticles({ x: hoop.x, y: hoop.y, count: 22, color: C.gold, speed: 220, life: 0.7, size: 4 });
  kick(4);
  if (score > best) { best = score; shared.saveScore('hoops', best); }
  hoop.target = newHoopTarget();
}

/* ---- physics ---- */
function collideCircle(ball, px, py, pr, rest) {
  const dx = ball.x - px, dy = ball.y - py;
  const d = Math.hypot(dx, dy), min = BALL_R + pr;
  if (d >= min || d < 0.001) return false;
  const nx = dx / d, ny = dy / d;
  ball.x = px + nx * min; ball.y = py + ny * min;
  const dot = ball.vx * nx + ball.vy * ny;
  if (dot < 0) {
    ball.vx -= (1 + rest) * dot * nx;
    ball.vy -= (1 + rest) * dot * ny;
    return true;
  }
  return false;
}

function update(dt) {
  if (state !== 'flying' && state !== 'aiming' && state !== 'ready') return;

  /* hoop drift */
  const dx = hoop.target.x - hoop.x, dy = hoop.target.y - hoop.y;
  const d = Math.hypot(dx, dy);
  if (d < 8) hoop.target = newHoopTarget();
  else {
    const step = Math.min(d, hoop.speed * dt);
    hoop.x += dx / d * step;
    hoop.y += dy / d * step;
  }

  /* popups */
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].life += dt;
    if (popups[i].life >= popups[i].max) popups.splice(i, 1);
  }

  if (state !== 'flying') {
    /* clock runs while play is live, not just mid-flight */
    if ((state === 'aiming' || (state === 'ready' && attempts > 0)) && timeLeft > 0) {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        state = 'gameover';
        shared.tone({ f0: 392, f1: 196, dur: 0.5, vol: 0.3, type: 'triangle' });
      }
    }
    shake = Math.max(0, shake - dt * 8);
    shared.updateParticles(dt);
    return;
  }

  const prevY = ball.y;
  ball.vy += GRAV * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  /* trail */
  shared.spawnParticles({ x: ball.x, y: ball.y, count: 2, color: C.orange, speed: 30, life: 0.3, size: 3 });

  /* rim posts */
  if (collideCircle(ball, hoop.x - hoop.rimHalf, hoop.y, 5, 0.55)) clank();
  if (collideCircle(ball, hoop.x + hoop.rimHalf, hoop.y, 5, 0.55)) clank();

  /* backboard */
  const bx = hoop.x + hoop.rimHalf, bw = 12, by0 = hoop.y - 86, by1 = hoop.y;
  if (ball.x + BALL_R > bx && ball.x - BALL_R < bx + bw && ball.y > by0 && ball.y < by1) {
    if (ball.vx > 0) { ball.x = bx - BALL_R; ball.vx = -ball.vx * 0.55; thud(); }
  }

  /* basket detection: downward through the rim plane */
  if (!ball.scored && ball.vy > 0 && prevY < hoop.y && ball.y >= hoop.y &&
      Math.abs(ball.x - hoop.x) < hoop.rimHalf - 6) {
    onBasket();
  }

  /* walls + floor */
  if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx) * 0.6; thud(); }
  if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.6; thud(); }
  if (ball.y + BALL_R > FLOOR) {
    ball.y = FLOOR - BALL_R;
    if (Math.abs(ball.vy) > 120) { ball.vy = -ball.vy * 0.55; ball.vx *= 0.85; thud(); }
    else {
      ball.vy = 0;
      ball.vx *= (1 - Math.min(1, 3 * dt));
    }
  }

  /* miss / settle → next ball */
  const speed = Math.hypot(ball.vx, ball.vy);
  if (ball.y > H + 60 || ball.x < -60 || ball.x > W + 60) {
    if (!ball.scored) streak = 0;
    spawnBall();
  } else if (ball.y + BALL_R >= FLOOR - 1 && speed < 60) {
    ball.settleT += dt;
    if (ball.settleT > 0.6) {
      if (!ball.scored) streak = 0;
      spawnBall();
    }
  } else {
    ball.settleT = 0;
  }

  /* clock */
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    state = 'gameover';
    shared.tone({ f0: 392, f1: 196, dur: 0.5, vol: 0.3, type: 'triangle' });
  }

  shake = Math.max(0, shake - dt * 8);
  shared.updateParticles(dt);
}

/* ---- render ---- */
function drawBallShape() {
  ctx.save();
  ctx.translate(ball.x, ball.y);
  const grd = ctx.createRadialGradient(-4, -5, 2, 0, 0, BALL_R);
  grd.addColorStop(0, '#ffe9a8');
  grd.addColorStop(0.6, C.orange);
  grd.addColorStop(1, C.deep);
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(90,20,5,0.8)';
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(0, 0, BALL_R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-BALL_R, 0); ctx.lineTo(BALL_R, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -BALL_R); ctx.lineTo(0, BALL_R); ctx.stroke();
  ctx.beginPath(); ctx.arc(-BALL_R * 1.6, 0, BALL_R * 1.35, -0.7, 0.7); ctx.stroke();
  ctx.beginPath(); ctx.arc(BALL_R * 1.6, 0, BALL_R * 1.35, Math.PI - 0.7, Math.PI + 0.7); ctx.stroke();
  ctx.restore();
}

function drawHoop(t) {
  const hx = hoop.x, hy = hoop.y, rh = hoop.rimHalf;
  /* arm to the wall */
  ctx.strokeStyle = 'rgba(120,180,220,0.5)';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(hx + rh + 12, hy - 80); ctx.lineTo(W, hy - 80); ctx.stroke();
  /* backboard */
  ctx.fillStyle = 'rgba(150,220,255,0.25)';
  ctx.fillRect(hx + rh, hy - 86, 12, 86);
  ctx.strokeStyle = C.ice2;
  ctx.lineWidth = 2;
  ctx.strokeRect(hx + rh, hy - 86, 12, 86);
  /* net */
  ctx.strokeStyle = 'rgba(240,250,255,0.55)';
  ctx.lineWidth = 1.5;
  const sway = Math.sin(t * 3) * 3;
  for (let i = -2; i <= 2; i++) {
    const tx = hx + (i / 2) * rh;
    ctx.beginPath();
    ctx.moveTo(tx, hy);
    ctx.lineTo(hx + sway + (i / 2) * rh * 0.35, hy + 44);
    ctx.stroke();
  }
  /* rim */
  ctx.strokeStyle = '#ff5a2a';
  ctx.lineWidth = 5;
  ctx.shadowColor = '#ff5a2a'; ctx.shadowBlur = 10;
  ctx.beginPath(); ctx.moveTo(hx - rh, hy); ctx.lineTo(hx + rh, hy); ctx.stroke();
  ctx.shadowBlur = 0;
  [hx - rh, hx + rh].forEach(function (px) {
    ctx.fillStyle = '#ffd0a8';
    ctx.beginPath(); ctx.arc(px, hy, 5, 0, Math.PI * 2); ctx.fill();
  });
}

function drawAim() {
  const v = launchVelocity();
  if (!v || v.sp < 60) return;
  let px = ball.x, py = ball.y, vx = v.vx, vy = v.vy;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = 0; i < 22; i++) {
    const step = 1 / 45;
    vy += GRAV * step;
    px += vx * step; py += vy * step;
    if (i % 2 === 0) { ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill(); }
    if (py > FLOOR) break;
  }
}

function drawOverlay(title, subtitle) {
  ctx.fillStyle = 'rgba(3,7,16,0.85)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = 'bold 52px Segoe UI, sans-serif';
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

  /* court floor */
  ctx.fillStyle = 'rgba(20,40,70,0.6)';
  ctx.fillRect(0, FLOOR, W, H - FLOOR);
  ctx.strokeStyle = C.stroke;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, FLOOR); ctx.lineTo(W, FLOOR); ctx.stroke();

  /* distance marker */
  ctx.font = '13px monospace';
  ctx.fillStyle = 'rgba(140,190,230,0.5)';
  ctx.textAlign = 'center';
  ctx.fillText('◀ shoot from here · drag back & release ▶', 240, H - 40);

  drawHoop(t);

  if (ball && (state === 'ready' || state === 'aiming' || state === 'flying')) {
    if (state === 'aiming') drawAim();
    drawBallShape();
    if (state === 'ready') {
      ctx.font = '15px Segoe UI, sans-serif';
      ctx.fillStyle = 'rgba(220,240,255,' + (0.5 + Math.sin(t * 4) * 0.3) + ')';
      ctx.fillText('drag & release!', ball.x, ball.y - 30);
    }
  }

  /* popups */
  popups.forEach(function (p) {
    const k = p.life / p.max;
    ctx.font = 'bold 22px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,212,121,' + (1 - k) + ')';
    ctx.fillText(p.str, p.x, p.y - k * 50);
  });

  /* HUD */
  ctx.textAlign = 'left';
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = C.ice2;
  ctx.fillText('' + score, 20, 34);
  ctx.font = '15px monospace';
  ctx.fillStyle = C.gold;
  ctx.fillText('BEST ' + best, 20, 58);
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px monospace';
  ctx.fillStyle = timeLeft <= 10 ? C.red : C.ice;
  ctx.fillText(Math.ceil(timeLeft) + 's', W / 2, 36);
  if (streak >= 2) {
    ctx.fillStyle = C.orange;
    ctx.font = 'bold 18px monospace';
    ctx.fillText('🔥 x' + Math.min(streak, 5), W / 2, 62);
  }
  ctx.textAlign = 'right';
  ctx.font = '15px monospace';
  ctx.fillStyle = C.ice2;
  ctx.fillText('' + makes + '/' + attempts, W - 20, 34);

  if (state === 'menu') drawOverlay('FROST HOOPS 🏀', 'Drag the ball back & release to shoot\n60 seconds · streaks multiply · swish = +2s\nSpace to start');
  else if (state === 'paused') drawOverlay('PAUSED', 'Space to resume');
  else if (state === 'gameover') drawOverlay('FULL TIME!', 'Score: ' + score + '   Best: ' + best + '\nHoops: ' + makes + '/' + attempts + '   Best streak: ' + bestStreak + '\nSpace to play again');

  shared.drawParticles(ctx);
  ctx.restore();
}

/* ---- input ---- */
function onPointerDown(e) {
  const p = toGame(e);
  if (state === 'menu') { state = 'ready'; return; }
  if (state === 'gameover') { reset(); state = 'ready'; return; }
  if (state !== 'ready') return;
  drag = { sx: p.x, sy: p.y, cx: p.x, cy: p.y };
  state = 'aiming';
  e.preventDefault();
}
function onPointerMove(e) {
  if (state !== 'aiming' || !drag) return;
  const p = toGame(e);
  drag.cx = p.x; drag.cy = p.y;
  e.preventDefault();
}
function onPointerUp(e) {
  if (state !== 'aiming' || !drag) { drag = null; return; }
  const v = launchVelocity();
  drag = null;
  if (!v || v.sp < 60) { state = 'ready'; return; }
  ball.vx = v.vx; ball.vy = v.vy;
  attempts++;
  state = 'flying';
  shared.tone({ f0: 300, f1: 600, dur: 0.1, vol: 0.2, type: 'triangle' });
}

function onKeyDown(e) {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    if (state === 'menu') state = 'ready';
    else if (state === 'gameover') { reset(); state = 'ready'; }
    else togglePause();
  }
  if (e.code === 'KeyP') togglePause();
}
function onBlur() { drag = null; }

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
  reset(best);
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
  drag = null;
  if (shared) shared.clearParticles();
  canvas = null; ctx = null;
}

export function togglePause() {
  if (state === 'ready' || state === 'aiming' || state === 'flying') { pausedFrom = state; state = 'paused'; }
  else if (state === 'paused') state = pausedFrom;
}
