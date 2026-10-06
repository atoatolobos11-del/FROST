/**
 * Frost Pong — two-player paddle duel with frost neon styling.
 * Exports: { init(canvas, shared), destroy(), togglePause() }
 */
 
// Game config
const W = 960, H = 540;
const PADDLE_W = 16, PADDLE_H = 110;
const BALL_SIZE = 12;
const PADDLE_SPEED = 520;
const BALL_BASE_SPEED = 380;
const MAX_SPEED = 720;
const WIN_SCORE = 7;

// Colors
const C = {
  bg: '#030710', ice: '#e8faff', ice2: '#bae6fd', ice3: '#38bdf8',
  ice4: '#0ea5e9', violet: '#c084fc', gold: '#ffd479',
  red: '#ef4444', stroke: 'rgba(90,210,255,.35)'
};

// State
let shared = null;
let canvas = null;
let ctx = null;
let animationId = null;
let running = false;
let left = { y: 0, score: 0, ai: false };
let right = { y: 0, score: 0, ai: false };
let ball = { x: 0, y: 0, vx: 0, vy: 0, speed: BALL_BASE_SPEED };
let state = 'menu';
let winner = null;
let shake = 0;
const keys = { w: false, s: false, ArrowUp: false, ArrowDown: false };

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function rrPath(g, x, y, w, h, r) {
  const rad = Math.min(r, w/2, h/2);
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

function hitPaddle(side) {
  const paddle = side === 'left' ? left : right;
  const paddleCenter = paddle.y + PADDLE_H / 2;
  const offset = (ball.y - paddleCenter) / (PADDLE_H / 2);
  const angle = offset * Math.PI / 3;
  const dir = side === 'left' ? 1 : -1;
  ball.vx = Math.cos(angle) * ball.speed * dir;
  ball.vy = Math.sin(angle) * ball.speed;
  ball.x = side === 'left' ? PADDLE_W + 20 + BALL_SIZE : W - PADDLE_W - 20 - BALL_SIZE;
  shared.tone({ f0: 220, f1: 180, dur: 0.08, vol: 0.25, type: 'square' });
  shared.spawnParticles({
    x: ball.x, y: ball.y, count: 12,
    color: C.ice2, speed: 180, life: 0.4, size: 3,
    angle: side === 'left' ? 0 : Math.PI, cone: Math.PI / 2
  });
  shake = 3;
}

function hitWall(x, y) {
  shared.tone({ f0: 440, f1: 380, dur: 0.06, vol: 0.15, type: 'triangle' });
  shared.spawnParticles({ x, y, count: 8, color: C.ice3, speed: 120, life: 0.3, size: 2 });
}

function scorePoint(side) {
  if (side === 'left') left.score++; else right.score++;
  shared.tone({ f0: 180, f1: 120, dur: 0.3, vol: 0.3, type: 'sawtooth' });
  shared.spawnParticles({
    x: W/2, y: H/2, count: 30,
    color: side === 'left' ? C.ice : C.violet,
    speed: 250, life: 0.8, size: 4, gravity: 80
  });
  shake = 12;
  if (left.score >= WIN_SCORE) { winner = 'left'; state = 'gameover'; }
  else if (right.score >= WIN_SCORE) { winner = 'right'; state = 'gameover'; }
  else { resetBall(); }
}

function resetBall() {
  ball.x = W / 2; ball.y = H / 2;
  const angle = (Math.random() - 0.5) * Math.PI / 2;
  const dir = Math.random() < 0.5 ? 1 : -1;
  ball.vx = Math.cos(angle) * BALL_BASE_SPEED * dir;
  ball.vy = Math.sin(angle) * BALL_BASE_SPEED;
  ball.speed = BALL_BASE_SPEED;
}

function resetMatch() {
  left.y = (H - PADDLE_H) / 2;
  right.y = (H - PADDLE_H) / 2;
  left.score = 0; right.score = 0;
  winner = null;
  state = 'menu';
  resetBall();
}

function drawPaddle(x, y) {
  const g = ctx;
  const r = 8;
  g.fillStyle = C.ice;
  g.shadowColor = C.ice4;
  g.shadowBlur = 20;
  rrPath(g, x, y, PADDLE_W, PADDLE_H, r);
  g.fill();
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(232,250,255,0.3)';
  rrPath(g, x + 2, y + 2, PADDLE_W - 4, PADDLE_H - 4, r - 2);
  g.fill();
}

function drawOverlay(title, subtitle) {
  ctx.fillStyle = 'rgba(3,7,16,0.85)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = 'bold 48px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = C.ice;
  ctx.fillText(title, W/2, H/2 - 20);
  ctx.font = '18px Segoe UI, sans-serif';
  ctx.fillStyle = C.ice3;
  ctx.fillText(subtitle, W/2, H/2 + 30);
}

export function init(c, sh) {
  canvas = c; shared = sh; ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  resetMatch();
  running = true;
  animationId = requestAnimationFrame(gameLoop);
  shared.unlockAudio();
}

export function destroy() {
  running = false;
  if (animationId) cancelAnimationFrame(animationId);
  window.removeEventListener('resize', resize);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  canvas = null; ctx = null;
}

export function togglePause() {
  if (state === 'playing') state = 'paused';
  else if (state === 'paused') state = 'playing';
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function onKeyDown(e) {
  if (e.key in keys) keys[e.key] = true;
  if (e.key === ' ' || e.key === 'Enter') {
    if (state === 'menu') startGame();
    else if (state === 'gameover') resetMatch();
    else if (state === 'playing') togglePause();
  }
  if (e.key === 'p' || e.key === 'P') togglePause();
  if (e.key === '1') { left.ai = !left.ai; }
  if (e.key === '2') { right.ai = !right.ai; }
}

function onKeyUp(e) { if (e.key in keys) keys[e.key] = false; }

function startGame() { state = 'playing'; resetBall(); }

function gameLoop(ts) {
  if (!running) return;
  const dt = 1/60;
  update(dt);
  render();
  animationId = requestAnimationFrame(gameLoop);
}

function update(dt) {
  if (state !== 'playing') return;
  const move = PADDLE_SPEED * dt;
  if (keys.w) left.y = Math.max(0, left.y - move);
  if (keys.s) left.y = Math.min(H - PADDLE_H, left.y + move);
  if (keys.ArrowUp) right.y = Math.max(0, right.y - move);
  if (keys.ArrowDown) right.y = Math.min(H - PADDLE_H, right.y + move);
  if (left.ai) {
    const target = ball.y - PADDLE_H / 2;
    left.y += Math.sign(target - left.y) * move * 0.7;
    left.y = clamp(left.y, 0, H - PADDLE_H);
  }
  if (right.ai) {
    const target = ball.y - PADDLE_H / 2;
    right.y += Math.sign(target - right.y) * move * 0.7;
    right.y = clamp(right.y, 0, H - PADDLE_H);
  }
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  if (ball.y <= BALL_SIZE) { ball.y = BALL_SIZE; ball.vy = Math.abs(ball.vy); hitWall(ball.x, ball.y); }
  else if (ball.y >= H - BALL_SIZE) { ball.y = H - BALL_SIZE; ball.vy = -Math.abs(ball.vy); hitWall(ball.x, ball.y); }
  if (ball.x - BALL_SIZE <= PADDLE_W + 20) {
    if (ball.y >= left.y && ball.y <= left.y + PADDLE_H) hitPaddle('left');
    else if (ball.x < -50) scorePoint('right');
  }
  if (ball.x + BALL_SIZE >= W - PADDLE_W - 20) {
    if (ball.y >= right.y && ball.y <= right.y + PADDLE_H) hitPaddle('right');
    else if (ball.x > W + 50) scorePoint('left');
  }
  ball.speed = Math.min(ball.speed * 1.008, MAX_SPEED);
  const sp = Math.hypot(ball.vx, ball.vy) || ball.speed;
  ball.vx = (ball.vx / sp) * ball.speed;
  ball.vy = (ball.vy / sp) * ball.speed;
  shake = Math.max(0, shake - dt * 8);
  shared.updateParticles(dt);
}

function render() {
  if (!ctx) return;
  ctx.save();
  if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.stroke; ctx.setLineDash([16, 16]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke(); ctx.setLineDash([]);
  drawPaddle(20, left.y);
  drawPaddle(W - 20 - PADDLE_W, right.y);
  ctx.fillStyle = C.ice; ctx.shadowColor = C.ice3; ctx.shadowBlur = 16;
  ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_SIZE, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.font = 'bold 72px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = C.ice2;
  ctx.fillText(left.score, W/2 - 80, 90); ctx.fillText(right.score, W/2 + 80, 90);
  ctx.font = '12px monospace'; ctx.fillStyle = left.ai ? C.violet : C.stroke;
  ctx.fillText(left.ai ? 'AI' : '1P', 40, 30);
  ctx.fillStyle = right.ai ? C.violet : C.stroke;
  ctx.fillText(right.ai ? 'AI' : '2P', W - 40, 30);
  if (state === 'menu') drawOverlay('PRESS SPACE TO START', 'W/S or \u2191/\u2193 to move \u00b7 1/2 toggles AI');
  else if (state === 'paused') drawOverlay('PAUSED', 'Press SPACE to resume');
  else if (state === 'gameover') drawOverlay(`${winner === 'left' ? 'LEFT' : 'RIGHT'} WINS!`, `Final: ${left.score} - ${right.score} \u00b7 Space to replay`);
  shared.drawParticles(ctx);
  ctx.restore();
}