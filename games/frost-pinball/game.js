/**
 * Frost Pinball — single table with flippers, bumpers, ramps, multiball.
 * Exports: { init(canvas, shared), destroy() }
 */

  let shared = null, canvas = null, ctx = null, animationId = null, running = false;
  const W = 720, H = 1080; // Portrait table
  const GRAVITY = 900;
  const C = {
    bg: '#02060d', ice: '#e8faff', ice2: '#bae6fd', ice3: '#38bdf8', ice4: '#0ea5e9',
    violet: '#c084fc', gold: '#ffd479', red: '#ef4444', amber: '#fbbf24', mint: '#7df9d6',
    flipper: '#1e3a5f', flipperGlow: '#38bdf8', bumper: '#0ea5e9', metal: '#4a5a6a'
  };

  // Physics
  let balls = [], flippers = { left: { angle: -0.5, target: -0.5, up: false }, right: { angle: 0.5, target: 0.5, up: false } };
  let bumpers = [], walls = [], ramps = [], targets = [], lanes = [];
  let score = 0, highScore = 0, ballsInPlay = 0, maxBalls = 3, multiball = false;
  let state = 'menu', shake = 0, plunger = { pulled: 0, charging: false };
  let bonuses = { leftLane: false, rightLane: false, centerTarget: 0, spinner: 0 };

  let bumperTimers = [];

export function init(c, sh) { canvas = c; shared = sh; ctx = canvas.getContext('2d');
    if (running) { try { destroy(); } catch (e) { /* ignore */ } }
    resize(); window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onTouchDown);
    canvas.addEventListener('pointerup', onTouchUp);
    canvas.addEventListener('pointercancel', onTouchUp);
    highScore = shared.getBestScore('pinball') || 0;
    buildTable(); reset(); running = true; lastTs = 0; animationId = requestAnimationFrame(loop); shared.unlockAudio(); }

export function destroy() {
    running = false; if (animationId) cancelAnimationFrame(animationId);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (canvas) {
      canvas.removeEventListener('pointerdown', onTouchDown);
      canvas.removeEventListener('pointerup', onTouchUp);
      canvas.removeEventListener('pointercancel', onTouchUp);
    }
    flippers.left.up = false; flippers.right.up = false;
    bumperTimers.forEach(t => clearTimeout(t)); bumperTimers = [];
    shared.clearParticles(); }

  function onKeyDown(e) {
    const c = e.code;
    if (c === 'ArrowLeft' || c === 'KeyA') flippers.left.up = true;
    if (c === 'ArrowRight' || c === 'KeyD') flippers.right.up = true;
    if (c === 'Space' || c === 'Enter') {
      e.preventDefault();
      if (state === 'menu') launchBall();
      else if (state === 'gameover') reset();
      else plunger.charging = true;
    }
    if (c === 'KeyP') {
      if (state === 'playing') state = 'paused';
      else if (state === 'paused') state = 'playing';
    }
    if (c === 'ArrowUp' || c === 'ArrowDown') e.preventDefault();
  }
  function onKeyUp(e) {
    const c = e.code;
    if (c === 'ArrowLeft' || c === 'KeyA') flippers.left.up = false;
    if (c === 'ArrowRight' || c === 'KeyD') flippers.right.up = false;
    if (c === 'Space' || c === 'Enter') {
      if (plunger.charging) { launchBall(plunger.pulled); plunger.charging = false; plunger.pulled = 0; }
    }
  }
  function onBlur() { flippers.left.up = false; flippers.right.up = false; plunger.charging = false; plunger.pulled = 0; }

  /* touch: left half = left flipper, right half = right flipper.
     Tap the plunger lane (far right) with no ball in play to launch. */
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  function onTouchDown(e) {
    const p = canvasPos(e);
    if (state === 'menu') { launchBall(0.8); return; }
    if (state === 'gameover') { reset(); return; }
    if (p.x > W - 140 && ballsInPlay === 0) { launchBall(0.8); return; }
    if (p.x < W / 2) flippers.left.up = true; else flippers.right.up = true;
    e.preventDefault();
  }
  function onTouchUp(e) {
    flippers.left.up = false; flippers.right.up = false;
  }

  function resize() { const dpr = Math.min(window.devicePixelRatio || 1, 2.5); canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

  function buildTable() {
    bumpers = [
      { x: 180, y: 200, r: 28, hits: 0, color: C.bumper, active: true },
      { x: 360, y: 200, r: 28, hits: 0, color: C.violet, active: true },
      { x: 540, y: 200, r: 28, hits: 0, color: C.amber, active: true },
      { x: 270, y: 350, r: 24, hits: 0, color: C.ice3, active: true },
      { x: 450, y: 350, r: 24, hits: 0, color: C.mint, active: true },
      { x: 360, y: 500, r: 20, hits: 0, color: C.red, active: true },
    ];
    // Walls forming table boundaries
    walls = [
      { x1: 30, y1: 30, x2: 30, y2: H - 30 }, // left
      { x1: W - 30, y1: 30, x2: W - 30, y2: H - 30 }, // right
      { x1: 30, y1: 30, x2: W - 30, y2: 30 }, // top
      { x1: 30, y1: H - 120, x2: 140, y2: H - 30 }, // left outlane
      { x1: W - 30, y1: H - 120, x2: W - 140, y2: H - 30 }, // right outlane
      { x1: 140, y1: H - 120, x2: W/2 - 40, y2: H - 30 }, // left return lane
      { x1: W - 140, y1: H - 120, x2: W/2 + 40, y2: H - 30 }, // right return lane
    ];
    // Ramps
    ramps = [
      { x: 500, y: 300, w: 80, h: 120, angle: -0.3, target: 'top', cd: 0 },
      { x: 140, y: 300, w: 80, h: 120, angle: 0.3, target: 'top', cd: 0 },
    ];
    // Drop targets
    targets = [
      { x: 120, y: 400, w: 30, h: 60, down: false, resetTimer: 0, letter: 'F' },
      { x: 160, y: 400, w: 30, h: 60, down: false, resetTimer: 0, letter: 'R' },
      { x: 200, y: 400, w: 30, h: 60, down: false, resetTimer: 0, letter: 'O' },
      { x: 240, y: 400, w: 30, h: 60, down: false, resetTimer: 0, letter: 'S' },
      { x: 280, y: 400, w: 30, h: 60, down: false, resetTimer: 0, letter: 'T' },
    ];
    // Roll lanes
    lanes = [
      { x: 420, y: 150, w: 60, h: 20, lit: false, letter: 'L' },
      { x: 500, y: 150, w: 60, h: 20, lit: false, letter: 'I' },
      { x: 580, y: 150, w: 60, h: 20, lit: false, letter: 'T' },
    ];
  }

  function reset() {
    balls = []; ballsInPlay = 0; score = 0; multiball = false;
    state = 'menu'; shake = 0;
    bumpers.forEach(b => { b.hits = 0; b.active = true; });
    targets.forEach(t => { t.down = false; t.resetTimer = 0; });
    lanes.forEach(l => l.lit = false);
    bonuses.leftLane = bonuses.rightLane = false; bonuses.centerTarget = 0; bonuses.spinner = 0;
  }

  function launchBall(power = 1) {
    if (ballsInPlay >= maxBalls) return;
    power = Math.max(0.35, Math.min(1, power || 0.35));
    const b = { x: W - 80, y: H - 80, vx: 0, vy: -800 * power, r: 10, trail: [], multiball: false };
    balls.push(b); ballsInPlay++; state = 'playing';
    shared.tone({ f0: 220, f1: 150, dur: 0.15, vol: 0.3, type: 'square' });
  }

  let lastTs = 0;
  function loop(ts) { if (!running) return;
    if (!ts) ts = performance.now();
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 20) : 1 / 60;
    lastTs = ts;
    update(dt); render(); animationId = requestAnimationFrame(loop); }

  function update(dt) {
    if (state !== 'playing') return;

    // Plunger charge
    if (plunger.charging) { plunger.pulled = Math.min(1, plunger.pulled + dt * 0.8); }

    // Flipper physics
    const flipperSpeed = 8;
    flippers.left.target = flippers.left.up ? -1.2 : -0.5;
    flippers.right.target = flippers.right.up ? 1.2 : 0.5;
    flippers.left.angle += (flippers.left.target - flippers.left.angle) * flipperSpeed * dt;
    flippers.right.angle += (flippers.right.target - flippers.right.angle) * flipperSpeed * dt;

    // Ball physics
    balls.forEach(ball => {
      ball.vy += GRAVITY * dt;
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      ball.trail.unshift({ x: ball.x, y: ball.y, life: 0.15 });
      if (ball.trail.length > 8) ball.trail.pop();

      // Wall collisions
      walls.forEach(w => collideLine(ball, w));

      // Bumper collisions
      bumpers.forEach(b => {
        if (!b.active) return;
        const dx = ball.x - b.x, dy = ball.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < b.r + ball.r) {
          const nx = dx / dist, ny = dy / dist;
          ball.x = b.x + nx * (b.r + ball.r); ball.y = b.y + ny * (b.r + ball.r);
          const dot = ball.vx * nx + ball.vy * ny;
          if (dot < 0) { ball.vx -= 2 * dot * nx; ball.vy -= 2 * dot * ny; }
          const speed = Math.hypot(ball.vx, ball.vy);
          if (speed > 1) {
            ball.vx = (ball.vx / speed) * Math.min(speed * 1.1, 900);
            ball.vy = (ball.vy / speed) * Math.min(speed * 1.1, 900);
          } else {
            ball.vx = nx * 200; ball.vy = ny * 200 - 100;
          }
          b.hits++; score += 100; b.active = false;
          bumperTimers.push(setTimeout(() => { b.active = true; }, 300));
          shared.tone({ f0: 660 + b.hits * 50, f1: 440, dur: 0.08, vol: 0.2, type: 'sine' });
          shared.spawnParticles({ x: b.x, y: b.y, count: 12, color: b.color, speed: 150, life: 0.4, size: 4 });
          shake = 3;
        }
      });

      // Target collisions
      targets.forEach(t => {
        if (t.down) { t.resetTimer -= dt; if (t.resetTimer <= 0) t.down = false; return; }
        if (ball.x + ball.r > t.x && ball.x - ball.r < t.x + t.w && ball.y + ball.r > t.y && ball.y - ball.r < t.y + t.h) {
          t.down = true; t.resetTimer = 5; score += 500; bonuses.centerTarget++;
          shared.tone({ f0: 520, f1: 780, dur: 0.15, vol: 0.25, type: 'sine' });
          shared.spawnParticles({ x: t.x + t.w/2, y: t.y + t.h/2, count: 15, color: C.gold, speed: 200, life: 0.5, size: 4 });
        }
      });

      // Lane collisions
      lanes.forEach(l => {
        if (!l.lit && ball.x + ball.r > l.x && ball.x - ball.r < l.x + l.w && ball.y + ball.r > l.y && ball.y - ball.r < l.y + l.h) {
          l.lit = true; score += 1000;
          shared.tone({ f0: 880, f1: 1100, dur: 0.1, vol: 0.2, type: 'triangle' });
        }
      });

      // Flipper collisions
      checkFlipper(ball, flippers.left, true);
      checkFlipper(ball, flippers.right, false);

      // Ramp collisions (per-ramp cooldown so one pass scores once)
      ramps.forEach(r => {
        if (r.cd > 0) r.cd -= dt;
        if (r.cd > 0) return;
        if (ball.x > r.x && ball.x < r.x + r.w && ball.y > r.y && ball.y < r.y + r.h) {
          if (ball.vy < -200) { // Going up ramp
            r.cd = 1.2;
            score += 5000; bonuses.spinner++;
            shared.tone({ f0: 440, f1: 660, dur: 0.5, vol: 0.3, type: 'sine' });
            shared.spawnParticles({ x: ball.x, y: ball.y, count: 25, color: C.gold, speed: 250, life: 1, size: 5 });
            ball.vy = -300; // Pop out
          }
        }
      });

      // Out of bounds (bottom)
      if (ball.y > H + 50) {
        ball.lost = true; ballsInPlay--;
        if (ballsInPlay <= 0) { state = 'gameover'; shared.tone({ f0: 100, f1: 60, dur: 0.5, vol: 0.4, type: 'sawtooth' }); }
      }
    });

    balls = balls.filter(b => !b.lost);

    // Check all targets down -> reset + bonus
    if (targets.every(t => t.down)) {
      targets.forEach(t => { t.down = false; t.resetTimer = 0; });
      score += 10000;
      shared.tone({ f0: 440, f1: 660, f2: 880, f3: 1100, dur: 1, vol: 0.4, type: 'sine' });
      shared.spawnParticles({ x: W/2, y: 300, count: 40, color: C.gold, speed: 300, life: 1.5, size: 6 });
    }

    // Check all lanes lit
    if (lanes.every(l => l.lit)) {
      lanes.forEach(l => l.lit = false);
      score += 20000; launchBall(); launchBall(); multiball = true;
      shared.tone({ f0: 660, f1: 990, dur: 0.5, vol: 0.4, type: 'sine' });
    }

    if (score > highScore) { highScore = score; shared.saveScore('pinball', highScore); }
    shake = Math.max(0, shake - dt * 8);
    shared.updateParticles(dt);
  }

  function checkFlipper(ball, flipper, isLeft) {
    const pivotX = isLeft ? 100 : W - 100;
    const pivotY = H - 80;
    const length = 60;
    const tipX = pivotX + Math.cos(flipper.angle) * length;
    const tipY = pivotY + Math.sin(flipper.angle) * length;

    // Distance from ball to flipper line
    const dx = tipX - pivotX, dy = tipY - pivotY;
    const len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len; // Normal
    const px = ball.x - pivotX, py = ball.y - pivotY;
    const proj = Math.max(0, Math.min(len, px * dx / len + py * dy / len)); // Along flipper, clamped
    const dist = px * nx + py * ny; // Perpendicular

    if (Math.abs(dist) < ball.r + 8) {
      // Push out of penetration first so the ball can't tunnel or jitter
      const push = (ball.r + 8) - Math.abs(dist);
      ball.x += (dist >= 0 ? nx : -nx) * push;
      ball.y += (dist >= 0 ? ny : -ny) * push;
      // Hit flipper
      const flipperVel = (flipper.up ? 1 : 0) * 800; // Simplified
      const vAlong = (ball.vx * dx + ball.vy * dy) / len;
      const vPerp = (ball.vx * nx + ball.vy * ny);
      if (dist * vPerp < 0) { // Approaching
        ball.vx = -nx * Math.abs(vPerp) * 1.2 + dx/len * Math.max(vAlong, flipperVel);
        ball.vy = -ny * Math.abs(vPerp) * 1.2 + dy/len * Math.max(vAlong, flipperVel);
        shared.tone({ f0: 300, f1: 200, dur: 0.08, vol: 0.25, type: 'square' });
        shared.spawnParticles({ x: ball.x, y: ball.y, count: 8, color: C.ice2, speed: 100, life: 0.3, size: 3 });
      }
    }
  }

  function collideLine(ball, w) {
    const x1 = w.x1, y1 = w.y1, x2 = w.x2, y2 = w.y2;
    const lx = x2 - x1, ly = y2 - y1;
    const len = Math.hypot(lx, ly);
    const nx = -ly / len, ny = lx / len;
    const px = ball.x - x1, py = ball.y - y1;
    const proj = px * lx + py * ly;
    if (proj >= 0 && proj <= len * len) {
      const dist = (px * nx + py * ny);
      if (Math.abs(dist) < ball.r && dist * (ball.vx * nx + ball.vy * ny) < 0) {
        ball.vx -= 2 * (ball.vx * nx + ball.vy * ny) * nx;
        ball.vy -= 2 * (ball.vx * nx + ball.vy * ny) * ny;
        shared.tone({ f0: 200, f1: 150, dur: 0.05, vol: 0.1, type: 'square' });
      }
    }
  }

  function render() {
    if (!ctx) return;
    ctx.save(); if (shake > 0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);

    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    // Table background
    drawTable();

    // Walls
    ctx.strokeStyle = C.metal; ctx.lineWidth = 6; ctx.lineCap = 'round';
    walls.forEach(w => { ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke(); });

    // Bumpers
    bumpers.forEach(b => {
      if (!b.active) return;
      ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 16;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = C.ice; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = C.ice; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('100', b.x, b.y + 2);
    });

    // Targets
    targets.forEach(t => {
      ctx.fillStyle = t.down ? 'rgba(100,100,100,0.5)' : C.ice;
      ctx.strokeStyle = t.down ? C.metal : C.ice3; ctx.lineWidth = 2;
      rrPath(ctx, t.x, t.y, t.w, t.h, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.ice2; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.letter, t.x + t.w/2, t.y + t.h/2 + (t.down ? 10 : 0));
    });

    // Lanes
    lanes.forEach(l => {
      ctx.fillStyle = l.lit ? C.gold : C.ice2; ctx.globalAlpha = l.lit ? 1 : 0.4;
      rrPath(ctx, l.x, l.y, l.w, l.h, 4); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = C.bg; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(l.letter, l.x + l.w/2, l.y + l.h/2);
    });

    // Ramps
    ramps.forEach(r => {
      ctx.fillStyle = 'rgba(232,250,255,0.15)'; ctx.strokeStyle = C.ice3; ctx.lineWidth = 2;
      ctx.save(); ctx.translate(r.x + r.w/2, r.y + r.h/2); ctx.rotate(r.angle);
      rrPath(ctx, -r.w/2, -r.h/2, r.w, r.h, 8); ctx.fill(); ctx.stroke(); ctx.restore();
    });

    // Flippers
    drawFlipper(flippers.left, true);
    drawFlipper(flippers.right, false);

    // Balls
    balls.forEach(b => {
      b.trail.forEach((t, i) => { const a = 1 - i/b.trail.length; ctx.fillStyle = `rgba(232,250,255,${a*0.3})`; ctx.beginPath(); ctx.arc(t.x, t.y, b.r * a, 0, Math.PI*2); ctx.fill(); });
      ctx.fillStyle = C.ice; ctx.shadowColor = C.ice3; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.beginPath(); ctx.arc(b.x-2, b.y-2, b.r/2, 0, Math.PI*2); ctx.fill();
    });

    // Plunger indicator
    if (state === 'menu' || (plunger.charging && ballsInPlay === 0)) {
      ctx.fillStyle = 'rgba(232,250,255,0.6)'; ctx.font = '18px monospace'; ctx.textAlign = 'center';
      ctx.fillText(plunger.charging ? 'HOLD SPACE: ' + Math.round(plunger.pulled*100) + '%' : 'PRESS SPACE TO LAUNCH', W - 100, H - 50);
    }

    // UI
    ctx.font = 'bold 28px monospace'; ctx.fillStyle = C.ice2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('Score: ' + score.toLocaleString(), 20, 20);
    ctx.fillStyle = C.gold; ctx.fillText('Best: ' + highScore.toLocaleString(), 20, 55);
    ctx.fillStyle = C.ice3; ctx.fillText('Balls: ' + ballsInPlay + '/' + maxBalls, 20, 90);
    if (multiball) { ctx.fillStyle = C.violet; ctx.fillText('MULTIBALL!', 20, 125); }

    // Spinner bonus
    ctx.fillStyle = C.mint; ctx.fillText('Spinner: ' + bonuses.spinner, 20, 160);
    ctx.fillStyle = C.amber; ctx.fillText('Targets: ' + targets.filter(t=>!t.down).length + '/5', 20, 195);

    // State overlays
    if (state === 'menu') drawOverlay('FROST PINBALL', '←/A = Left flipper · →/D = Right flipper\nHold SPACE to pull plunger · Release to launch\nLight all lanes for MULTIBALL\nComplete FROST targets for bonus');
    else if (state === 'paused') drawOverlay('PAUSED', 'P to resume');
    else if (state === 'gameover') drawOverlay('GAME OVER', `Final Score: ${score.toLocaleString()}\nBest: ${highScore.toLocaleString()}\nSpace for new game`);

    shared.drawParticles(ctx);
    ctx.restore();
  }

  function drawTable() {
    // Playfield gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#041020'); grad.addColorStop(0.5, '#030814'); grad.addColorStop(1, '#02060d');
    ctx.fillStyle = grad; ctx.fillRect(30, 30, W-60, H-60);

    // Decorative lines
    ctx.strokeStyle = 'rgba(90,210,255,0.03)'; ctx.lineWidth = 1;
    for (let x = 40; x < W-40; x += 30) { ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, H-40); ctx.stroke(); }
    for (let y = 40; y < H-40; y += 30) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W-40, y); ctx.stroke(); }
  }

  function drawFlipper(f, isLeft) {
    const pivotX = isLeft ? 100 : W - 100;
    const pivotY = H - 80;
    const length = 60, width = 22;
    ctx.save(); ctx.translate(pivotX, pivotY); ctx.rotate(f.angle);
    ctx.fillStyle = C.flipper; ctx.shadowColor = C.flipperGlow; ctx.shadowBlur = 14;
    rrPath(ctx, 0, -width/2, length, width, 8); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(232,250,255,0.2)'; rrPath(ctx, 2, -width/2+2, length-4, width-4, 6); ctx.fill();
    ctx.restore();
    // Pivot
    ctx.fillStyle = C.metal; ctx.beginPath(); ctx.arc(pivotX, pivotY, 10, 0, Math.PI*2); ctx.fill();
  }

  function drawOverlay(t, s) {
    ctx.fillStyle = 'rgba(2,6,13,0.95)'; ctx.fillRect(0,0,W,H);
    ctx.font = 'bold 42px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.ice; ctx.fillText(t, W/2, H/2 - 40);
    ctx.font = '17px Segoe UI, sans-serif'; ctx.fillStyle = C.ice3;
    s.split('\n').forEach((l,i) => ctx.fillText(l, W/2, H/2 + 10 + i*24));
  }

  function rrPath(g, x, y, w, h, r) {
    const rad = Math.min(r, w/2, h/2);
    g.beginPath(); g.moveTo(x+rad, y); g.lineTo(x+w-rad, y);
    g.arcTo(x+w, y, x+w, y+rad, rad); g.lineTo(x+w, y+h-rad);
    g.arcTo(x+w, y+h, x+w-rad, y+h, rad); g.lineTo(x+rad, y+h);
    g.arcTo(x, y+h, x, y+h-rad, rad); g.lineTo(x, y+rad);
    g.arcTo(x, y, x+rad, y, rad); g.closePath();
  }
export function togglePause() {
  if (state === 'playing') state = 'paused';
  else if (state === 'paused') state = 'playing';
}
