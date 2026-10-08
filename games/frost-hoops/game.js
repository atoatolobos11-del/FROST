/**
 * Frost Hoops — arcade 1v1 basketball vs the AI.
 * You (blue) attack the RIGHT hoop, AI (red) attacks the LEFT hoop.
 * Move: ←/→ or A/D · Jump: ↑/W · Shoot/steal: Space · P: pause.
 * Most points when the buzzer sounds wins. 3-pointers beyond the arc.
 * Exports: { init(canvas, shared), destroy(), togglePause(), onTouchControl() }
 */

let shared = null;
let canvas = null;
let ctx = null;
let animationId = null;
let running = false;
let lastTs = 0;

const W = 960, H = 540;
const FLOOR = H - 64;
const GRAV = 1600;
const BALL_R = 12;
const GAME_TIME = 120;
const ARC_X = 300; // 3pt line distance from each baseline area

const C = {
  bg: '#030710', ice: '#e8faff', ice2: '#bae6fd', ice3: '#38bdf8',
  orange: '#ff9a3c', deep: '#c22e12', red: '#ef4444', gold: '#ffd479',
  blue: '#38bdf8', violet: '#c084fc', stroke: 'rgba(90,210,255,.35)',
};

/* global arcade settings */
function diffMult() { try { return (shared && shared.difficultyMult) ? shared.difficultyMult() : 1; } catch (e) { return 1; } }
function kick(v) { if (shared && shared.fxOn && !shared.fxOn('shake')) return; shake = Math.max(shake, v); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/* state */
let state = 'menu'; // menu | playing | paused | gameover
let pausedFrom = 'playing';
let p1 = null, ai = null, ball = null, holder = null;
let hoops = [];
let pScore = 0, aScore = 0, best = 0;
let timeLeft = GAME_TIME;
let shake = 0;
let popups = [];
let shotLock = 0;   // no instant re-pickup after a shot
let stealCd = 0;
let aiThink = 0, aiMove = 0, aiWantShoot = false;
let keys = {};
let touch = { left: false, right: false };
let diffCache = 1;

function makeHoop(x, side) {
  // side: +1 attacks right (rim opens left), -1 attacks left
  return { x: x, y: 170, rimHalf: 30 / diffCache, side: side };
}

function reset() {
  diffCache = diffMult();
  hoops = [makeHoop(70, -1), makeHoop(W - 70, 1)];
  p1 = { x: 300, y: FLOOR, vx: 0, vy: 0, onFloor: true, face: 1, touchJump: false };
  ai = { x: 660, y: FLOOR, vx: 0, vy: 0, onFloor: true, face: -1 };
  ball = { x: W / 2, y: FLOOR - 200, vx: 0, vy: 0 };
  holder = null;
  pScore = 0; aScore = 0;
  timeLeft = GAME_TIME;
  popups = [];
  shotLock = 0; stealCd = 0;
  state = 'menu';
}

function tipoff() {
  ball = { x: W / 2, y: FLOOR - 200, vx: 0, vy: 0 };
  holder = null;
  state = 'playing';
  shared.tone({ f0: 440, f1: 880, dur: 0.2, vol: 0.25, type: 'triangle' });
}

/* ---- audio ---- */
function bounceSnd(hard) { shared.tone({ f0: hard ? 170 : 130, f1: 90, dur: 0.07, vol: 0.18, type: 'sine' }); }
function swishSnd() { shared.noiseBurst({ hpf: 2500, dur: 0.25, vol: 0.3 }); }
function scoreJingle() {
  [523, 659, 784].forEach(function (f, i) {
    shared.tone({ f0: f, type: 'triangle', dur: 0.16, vol: 0.22, delay: i * 0.07 });
  });
}
function stealSnd() { shared.tone({ f0: 700, f1: 1000, dur: 0.1, vol: 0.2, type: 'square' }); }
function buzzer() { shared.tone({ f0: 196, f1: 150, dur: 0.8, vol: 0.35, type: 'sawtooth' }); }

/* ---- actions ---- */
function tryJump(p) {
  if (p.onFloor && (state === 'playing')) { p.vy = -680; p.onFloor = false; }
}

function shootAt(p, hoop, err) {
  const sx = ball.x, sy = ball.y;
  const tx = hoop.x + (Math.random() - 0.5) * err;
  const ty = hoop.y - 6;
  const T = 0.6 + Math.hypot(tx - sx, ty - sy) / 2200;
  ball.vx = (tx - sx) / T;
  ball.vy = (ty - sy - 0.5 * GRAV * T * T) / T;
  holder = null;
  shotLock = 0.45;
}

function p1Action() {
  if (state !== 'playing') return;
  if (holder === 'p1') {
    shootAt(p1, hoops[1], 8);
    shared.tone({ f0: 300, f1: 600, dur: 0.1, vol: 0.2, type: 'triangle' });
  } else if (holder === 'ai' && stealCd <= 0) {
    stealCd = 1.0;
    if (Math.hypot(ball.x - p1.x, ball.y - (p1.y - 30)) < 52 && Math.random() < 0.4) {
      holder = 'p1';
      popups.push({ x: p1.x, y: p1.y - 90, str: 'STEAL!', life: 0, max: 0.9 });
      stealSnd();
    }
  }
}

function aiShoot() {
  const err = diffCache > 1.1 ? 26 : diffCache < 0.95 ? 110 : 64;
  shootAt(ai, hoops[0], err);
}

/* ---- scoring ---- */
function onBasket(hoop, shooter) {
  const attackingRight = hoop.side === 1;
  const three = attackingRight ? ball.x < W - ARC_X - 140 : ball.x > ARC_X + 140;
  const pts = three ? 3 : 2;
  if (attackingRight) pScore += pts; else aScore += pts;
  popups.push({ x: hoop.x, y: hoop.y + 34, str: '+' + pts, life: 0, max: 1 });
  swishSnd(); scoreJingle();
  shared.spawnParticles({ x: hoop.x, y: hoop.y, count: 24, color: C.gold, speed: 230, life: 0.7, size: 4 });
  kick(5);
  if (pScore > best) { best = pScore; shared.saveScore('hoops', best); }
  // possession to the team that was scored on
  const receiver = attackingRight ? ai : p1;
  ball.x = clamp(receiver.x, 80, W - 80);
  ball.y = FLOOR - BALL_R;
  ball.vx = 0; ball.vy = 0;
  holder = attackingRight ? 'ai' : 'p1';
}

/* ---- physics helpers ---- */
function collideCirclePost(b, px, py, pr, rest) {
  const dx = b.x - px, dy = b.y - py;
  const d = Math.hypot(dx, dy), min = BALL_R + pr;
  if (d >= min || d < 0.001) return false;
  const nx = dx / d, ny = dy / d;
  b.x = px + nx * min; b.y = py + ny * min;
  const dot = b.vx * nx + b.vy * ny;
  if (dot < 0) { b.vx -= (1 + rest) * dot * nx; b.vy -= (1 + rest) * dot * ny; return true; }
  return false;
}

function movePlayer(p, dir, dt) {
  const SPEED = 330;
  const want = dir * SPEED;
  p.vx += (want - p.vx) * Math.min(1, dt * 12);
  if (dir !== 0) p.face = dir > 0 ? 1 : -1;
  p.vy += GRAV * dt;
  p.x = clamp(p.x + p.vx * dt, 24, W - 24);
  p.y += p.vy * dt;
  if (p.y >= FLOOR) { p.y = FLOOR; p.vy = 0; p.onFloor = true; }
  else p.onFloor = false;
}

/* ---- AI ---- */
function aiUpdate(dt) {
  aiThink -= dt;
  const spd = 300 * diffCache;
  if (aiThink <= 0) {
    aiThink = 0.15;
    aiMove = 0; aiWantShoot = false;
    if (holder === 'ai') {
      // attack left hoop
      if (ai.x > 330) aiMove = -1;
      else aiWantShoot = true;
      if (!ai.onFloor) aiMove = 0;
    } else if (holder === 'p1') {
      aiMove = Math.sign(p1.x - ai.x);
    } else if (ball) {
      aiMove = Math.sign(ball.x - ai.x);
      if (Math.abs(ball.x - ai.x) < 12) aiMove = 0;
    }
    // jump if ball is high above and close, or to block
    if (ai.onFloor && ball && ball.y < ai.y - 130 && Math.abs(ball.x - ai.x) < 90 && Math.random() < 0.6) {
      ai.vy = -660; ai.onFloor = false;
    }
    // steal when close to p1 carrier
    if (holder === 'p1' && stealCd <= 0) {
      const d = Math.hypot(ball.x - ai.x, ball.y - (ai.y - 30));
      if (d < 50) {
        stealCd = 1.0;
        const ch = diffCache > 1.1 ? 0.5 : diffCache < 0.95 ? 0.18 : 0.32;
        if (Math.random() < ch) {
          holder = 'ai';
          popups.push({ x: ai.x, y: ai.y - 90, str: 'STOLEN!', life: 0, max: 0.9 });
          stealSnd();
        }
      }
    }
  }
  const want = aiMove * spd;
  ai.vx += (want - ai.vx) * Math.min(1, dt * 10);
  if (aiMove !== 0) ai.face = aiMove > 0 ? 1 : -1;
  ai.vy += GRAV * dt;
  ai.x = clamp(ai.x + ai.vx * dt, 24, W - 24);
  ai.y += ai.vy * dt;
  if (ai.y >= FLOOR) { ai.y = FLOOR; ai.vy = 0; ai.onFloor = true; }
  else ai.onFloor = false;
  if (aiWantShoot && holder === 'ai') { aiWantShoot = false; aiShoot(); }
}

/* ---- update ---- */
function update(dt) {
  if (state !== 'playing') return;

  /* clock */
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    state = 'gameover';
    buzzer();
    return;
  }
  shotLock = Math.max(0, shotLock - dt);
  stealCd = Math.max(0, stealCd - dt);

  /* player 1 */
  let dir = 0;
  if (keys.ArrowLeft || keys.KeyA || touch.left) dir -= 1;
  if (keys.ArrowRight || keys.KeyD || touch.right) dir += 1;
  movePlayer(p1, dir, dt);
  if (p1.touchJump) { p1.touchJump = false; tryJump(p1); }

  aiUpdate(dt);

  /* ball follows holder (dribble) */
  if (holder === 'p1' || holder === 'ai') {
    const c = holder === 'p1' ? p1 : ai;
    const t = performance.now() / 1000;
    ball.x = c.x + c.face * 20;
    ball.y = (c.y - 26) - Math.abs(Math.sin(t * 10)) * 20;
    ball.vx = 0; ball.vy = 0;
  } else {
    const prevY = ball.y;
    ball.vy += GRAV * dt;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    /* hoops: posts, backboards, score */
    hoops.forEach(function (hp) {
      if (collideCirclePost(ball, hp.x - hp.rimHalf, hp.y, 5, 0.55)) bounceSnd(true);
      if (collideCirclePost(ball, hp.x + hp.rimHalf, hp.y, 5, 0.55)) bounceSnd(true);
      // backboard on the outer side of each rim
      const bx = hp.side === 1 ? hp.x + hp.rimHalf : hp.x - hp.rimHalf - 12;
      if (ball.x + BALL_R > bx && ball.x - BALL_R < bx + 12 && ball.y > hp.y - 86 && ball.y < hp.y) {
        if (hp.side === 1 && ball.vx > 0) { ball.x = bx - BALL_R; ball.vx = -ball.vx * 0.55; bounceSnd(true); }
        if (hp.side === -1 && ball.vx < 0) { ball.x = bx + 12 + BALL_R; ball.vx = -ball.vx * 0.55; bounceSnd(true); }
      }
      if (ball.vy > 0 && prevY < hp.y && ball.y >= hp.y && Math.abs(ball.x - hp.x) < hp.rimHalf - 5) {
        onBasket(hp);
      }
    });

    /* walls + floor */
    if (ball.x - BALL_R < 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx) * 0.6; bounceSnd(false); }
    if (ball.x + BALL_R > W) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.6; bounceSnd(false); }
    if (ball.y + BALL_R > FLOOR) {
      ball.y = FLOOR - BALL_R;
      if (Math.abs(ball.vy) > 130) { ball.vy = -ball.vy * 0.55; ball.vx *= 0.85; bounceSnd(false); }
      else { ball.vy = 0; ball.vx *= (1 - Math.min(1, 3 * dt)); }
    }

    /* pickup */
    if (shotLock <= 0) {
      if (Math.hypot(ball.x - p1.x, ball.y - (p1.y - 30)) < 34) holder = 'p1';
      else if (Math.hypot(ball.x - ai.x, ball.y - (ai.y - 30)) < 34) holder = 'ai';
    }
  }

  /* popups */
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].life += dt;
    if (popups[i].life >= popups[i].max) popups.splice(i, 1);
  }

  shake = Math.max(0, shake - dt * 8);
  shared.updateParticles(dt);
}

/* ---- render ---- */
function drawPlayer(p, color, dark, label) {
  ctx.save();
  ctx.translate(p.x, p.y);
  /* shadow */
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 2, 20, 5, 0, 0, Math.PI * 2); ctx.fill();
  /* legs */
  ctx.strokeStyle = dark;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  const run = Math.abs(p.vx) > 40 && p.onFloor ? Math.sin(performance.now() / 90) * 8 : 0;
  ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(-7, 0 - run); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(7, 0 + run); ctx.stroke();
  /* body */
  ctx.fillStyle = color;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-11, -52, 22, 30, 7);
  else ctx.rect(-11, -52, 22, 30);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, 0, -31);
  /* head */
  ctx.fillStyle = '#ffd9b3';
  ctx.beginPath(); ctx.arc(p.face * 3, -60, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(p.face * 3, -63, 9, Math.PI, 0); ctx.fill();
  /* arms toward ball when holding */
  const holding = (holder === 'p1' && label === '1') || (holder === 'ai' && label === 'AI');
  ctx.strokeStyle = '#ffd9b3';
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, -44);
  ctx.lineTo(p.face * (holding ? 20 : 10), holding ? -30 : -38);
  ctx.stroke();
  ctx.restore();
}

function drawHoopStick(hp, t) {
  const hx = hp.x, hy = hp.y, rh = hp.rimHalf;
  /* mount: ceiling pole on outer side */
  const px = hp.side === 1 ? hx + rh + 6 : hx - rh - 6;
  ctx.strokeStyle = 'rgba(120,180,220,0.5)';
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(px, hy - 86); ctx.lineTo(px, 0); ctx.stroke();
  /* backboard */
  const bx = hp.side === 1 ? hx + rh : hx - rh - 12;
  ctx.fillStyle = 'rgba(150,220,255,0.25)';
  ctx.fillRect(bx, hy - 86, 12, 86);
  ctx.strokeStyle = C.ice2;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, hy - 86, 12, 86);
  /* net */
  ctx.strokeStyle = 'rgba(240,250,255,0.55)';
  ctx.lineWidth = 1.5;
  const sway = Math.sin(t * 3 + hx) * 3;
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
  [hx - rh, hx + rh].forEach(function (qx) {
    ctx.fillStyle = '#ffd0a8';
    ctx.beginPath(); ctx.arc(qx, hy, 5, 0, Math.PI * 2); ctx.fill();
  });
}

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
  ctx.restore();
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

  /* court */
  ctx.fillStyle = 'rgba(16,34,60,0.9)';
  ctx.fillRect(0, FLOOR, W, H - FLOOR);
  ctx.fillStyle = 'rgba(24,52,88,0.9)';
  ctx.fillRect(0, 0, W, FLOOR);
  ctx.strokeStyle = C.stroke;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, FLOOR); ctx.lineTo(W, FLOOR); ctx.stroke();
  /* center circle + arcs */
  ctx.strokeStyle = 'rgba(120,200,250,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(W / 2, FLOOR, 70, Math.PI, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(W / 2, FLOOR - 70); ctx.lineTo(W / 2, FLOOR); ctx.stroke();
  /* 3pt arcs */
  ctx.setLineDash([10, 8]);
  ctx.beginPath(); ctx.arc(70, 170, W - ARC_X - 140 - 70 + 30, -0.5, 0.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(W - 70, 170, W - ARC_X - 140 - 70 + 30, Math.PI - 0.5, Math.PI + 0.5); ctx.stroke();
  ctx.setLineDash([]);

  hoops.forEach(function (hp) { drawHoopStick(hp, t); });

  if (state !== 'menu') {
    drawPlayer(p1, C.blue, '#123a5c', '1');
    drawPlayer(ai, C.red, '#5c1212', 'AI');
    drawBallShape();
    /* carrier marker */
    const c = holder === 'p1' ? p1 : holder === 'ai' ? ai : null;
    if (c) {
      ctx.fillStyle = 'rgba(255,212,121,' + (0.6 + Math.sin(t * 6) * 0.3) + ')';
      ctx.beginPath();
      ctx.moveTo(c.x - 8, c.y - 84); ctx.lineTo(c.x + 8, c.y - 84); ctx.lineTo(c.x, c.y - 74);
      ctx.closePath(); ctx.fill();
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
  ctx.font = 'bold 26px monospace';
  ctx.fillStyle = C.blue;
  ctx.fillText('YOU ' + pScore, 20, 36);
  ctx.textAlign = 'right';
  ctx.fillStyle = C.red;
  ctx.fillText(aScore + ' CPU', W - 20, 36);
  ctx.textAlign = 'center';
  ctx.font = 'bold 26px monospace';
  ctx.fillStyle = timeLeft <= 10 ? C.red : C.ice;
  const mm = Math.floor(timeLeft / 60), ss = Math.floor(timeLeft % 60);
  ctx.fillText(mm + ':' + (ss < 10 ? '0' : '') + ss, W / 2, 36);
  ctx.font = '14px monospace';
  ctx.fillStyle = C.gold;
  ctx.fillText('BEST ' + best, W / 2, 60);

  if (state === 'menu') drawOverlay('FROST HOOPS 🏀', 'You attack the RIGHT hoop · first to the buzzer wins\n←/→ move · ↑ jump · Space shoot / steal\nSpace to tip off');
  else if (state === 'paused') drawOverlay('PAUSED', 'Space to resume');
  else if (state === 'gameover') {
    const res = pScore > aScore ? 'YOU WIN! 🏆' : pScore < aScore ? 'CPU WINS' : 'DRAW';
    drawOverlay(res, 'Final: YOU ' + pScore + ' — ' + aScore + ' CPU\nSpace to play again');
  }

  shared.drawParticles(ctx);
  ctx.restore();
}

/* ---- input ---- */
function onPointerDown(e) {
  if (state === 'menu') { tipoff(); e.preventDefault(); return; }
  if (state === 'gameover') { reset(); tipoff(); e.preventDefault(); return; }
}
function onKeyDown(e) {
  const c = e.code;
  if (c === 'ArrowLeft' || c === 'ArrowRight' || c === 'KeyA' || c === 'KeyD' || c === 'ArrowUp' || c === 'ArrowDown') {
    keys[c] = true; e.preventDefault();
  }
  if (c === 'ArrowUp' || c === 'KeyW') { tryJump(p1); e.preventDefault(); }
  if (c === 'Space' || c === 'Enter') {
    e.preventDefault();
    if (state === 'menu') tipoff();
    else if (state === 'gameover') { reset(); tipoff(); }
    else if (state === 'playing') p1Action();
    else if (state === 'paused') togglePause();
  }
  if (c === 'KeyP') togglePause();
}
function onKeyUp(e) { if (e.code in keys) keys[e.code] = false; }
function onBlur() { keys = {}; touch.left = touch.right = false; }

/* on-screen buttons (built by the arcade shell) */
export function onTouchControl(name, on) {
  if (name === 'left') touch.left = on;
  else if (name === 'right') touch.right = on;
  else if (name === 'jump') { if (on && state === 'playing') tryJump(p1); }
  else if (name === 'shoot') {
    if (!on) return;
    if (state === 'menu') tipoff();
    else if (state === 'gameover') { reset(); tipoff(); }
    else if (state === 'playing') p1Action();
  }
  if (state === 'menu' && on && (name === 'left' || name === 'right')) tipoff();
}

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
  keys = {};
  touch.left = touch.right = false;
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointerdown', onPointerDown);
  best = shared.getBestScore('hoops') || 0;
  reset();
  best = shared.getBestScore('hoops') || 0;
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
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onBlur);
  if (canvas) canvas.removeEventListener('pointerdown', onPointerDown);
  if (shared) shared.clearParticles();
  canvas = null; ctx = null;
}

export function togglePause() {
  if (state === 'playing') { pausedFrom = state; state = 'paused'; }
  else if (state === 'paused') state = pausedFrom;
}
