/**
 * Frost Snake — enhanced grid arena with frost trails, power-ups, obstacles.
 * Exports: { init(canvas, shared), destroy() }
 */

  let shared = null;
  let canvas = null;
  let ctx = null;
  let animationId = null;
  let running = false;

  // Game config
  const W = 960, H = 540, GRID = 24;
  const COLS = W / GRID, ROWS = H / GRID;
  const INITIAL_SPEED = 8, MAX_SPEED = 22;

  // Colors
  const C = {
    bg: '#030710',
    ice: '#e8faff', ice2: '#bae6fd', ice3: '#38bdf8', ice4: '#0ea5e9',
    violet: '#c084fc', gold: '#ffd479', red: '#ef4444',
    mint: '#7df9d6', amber: '#fbbf24',
    stroke: 'rgba(90,210,255,.08)', stroke2: 'rgba(90,210,255,.15)'
  };

  // State
  let snake = [], food = null, powerUps = [], obstacles = [];
  let dir = { x: 1, y: 0 }, nextDir = { x: 1, y: 0 };
  let score = 0, highScore = 0, speed = INITIAL_SPEED;
  let state = 'menu'; // menu, playing, paused, gameover
  let shake = 0;
  let combo = 0, lastFoodTime = 0;
  let shieldT = 0; // shield power-up invincibility timer
  let trail = []; // visual trail particles
  let touchStart = null; // swipe start for touch steering

export function init(c, sh) {
    if (running) { try { destroy(); } catch (e) { /* ignore */ } }
    canvas = c; shared = sh; ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('pointerdown', onTouchStart);
    canvas.addEventListener('pointermove', onTouchMove);
    canvas.addEventListener('pointerup', onTouchEnd);
    canvas.addEventListener('pointercancel', onTouchEnd);
    highScore = shared.getBestScore('snake') || 0;
    reset();
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
    if (canvas) {
      canvas.removeEventListener('pointerdown', onTouchStart);
      canvas.removeEventListener('pointermove', onTouchMove);
      canvas.removeEventListener('pointerup', onTouchEnd);
      canvas.removeEventListener('pointercancel', onTouchEnd);
    }
    shared.clearParticles();
  }

export function togglePause() {
  if (state === 'playing') state = 'paused';
  else if (state === 'paused') state = 'playing';
}

/* on-screen D-pad (built by the arcade shell) */
export function onTouchControl(name, on) {
  if (!on) return;
  if (state === 'menu') state = 'playing';
  else if (state === 'gameover') { reset(); state = 'playing'; }
  if (name === 'up' && dir.y !== 1) nextDir = { x: 0, y: -1 };
  else if (name === 'down' && dir.y !== -1) nextDir = { x: 0, y: 1 };
  else if (name === 'left' && dir.x !== 1) nextDir = { x: -1, y: 0 };
  else if (name === 'right' && dir.x !== -1) nextDir = { x: 1, y: 0 };
}

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function onKeyDown(e) {
    const k = e.code || e.key;
    if (k === 'ArrowUp' && dir.y !== 1) { nextDir = { x: 0, y: -1 }; e.preventDefault(); }
    else if (k === 'ArrowDown' && dir.y !== -1) { nextDir = { x: 0, y: 1 }; e.preventDefault(); }
    else if (k === 'ArrowLeft' && dir.x !== 1) { nextDir = { x: -1, y: 0 }; e.preventDefault(); }
    else if (k === 'ArrowRight' && dir.x !== -1) { nextDir = { x: 1, y: 0 }; e.preventDefault(); }
    else if (k === 'Space') {
      e.preventDefault();
      if (state === 'menu') state = 'playing';
      else if (state === 'gameover') { reset(); state = 'playing'; }
      else if (state === 'playing') state = 'paused';
      else state = 'playing';
    }
    else if (k === 'KeyP') {
      if (state === 'playing') state = 'paused';
      else if (state === 'paused') state = 'playing';
    }
  }

  /* touch: swipe steers, tap starts/pauses */
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  function onTouchStart(e) { touchStart = canvasPos(e); }
  function onTouchMove(e) {
    if (!touchStart) return;
    const p = canvasPos(e);
    const dx = p.x - touchStart.x, dy = p.y - touchStart.y;
    if (Math.hypot(dx, dy) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) nextDir = dx > 0 ? { x: 1, y: 0 } : { x: -1, y: 0 };
    else nextDir = dy > 0 ? { x: 0, y: 1 } : { x: 0, y: -1 };
    touchStart = p;
  }
  function onTouchEnd(e) {
    if (touchStart) {
      const p = canvasPos(e);
      if (Math.hypot(p.x - touchStart.x, p.y - touchStart.y) < 24) {
        if (state === 'menu') state = 'playing';
        else if (state === 'gameover') { reset(); state = 'playing'; }
        else if (state === 'playing') state = 'paused';
        else if (state === 'paused') state = 'playing';
      }
    }
    touchStart = null;
  }

  function reset() {
    const cx = Math.floor(COLS / 2), cy = Math.floor(ROWS / 2);
    snake = [{ x: cx, y: cy }, { x: cx - 1, y: cy }, { x: cx - 2, y: cy }];
    dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
    score = 0; speed = INITIAL_SPEED; combo = 0; shake = 0; shieldT = 0;
    state = 'menu'; trail = [];
    powerUps = []; obstacles = [];
    spawnFood();
    if (Math.random() < 0.7) spawnObstacles();
  }

  /* random free cell, or null when the board is (nearly) full */
  function freeCell() {
    for (let tries = 0; tries < 400; tries++) {
      const c = { x: randInt(0, COLS - 1), y: randInt(0, ROWS - 1) };
      if (snake.some(s => s.x === c.x && s.y === c.y)) continue;
      if (food && food.x === c.x && food.y === c.y) continue;
      if (powerUps.some(p => p.x === c.x && p.y === c.y)) continue;
      if (obstacles.some(o => o.x === c.x && o.y === c.y)) continue;
      return c;
    }
    return null;
  }

  function spawnFood() {
    const c = freeCell();
    if (!c) { score += 500; if (score > highScore) { highScore = score; shared.saveScore('snake', highScore); } gameOver(); return; }
    food = { x: c.x, y: c.y, type: 'normal' };
    // Rare special food
    if (Math.random() < 0.1) food.type = 'gold';
    else if (Math.random() < 0.15) food.type = 'speed';
  }

  function spawnPowerUp() {
    if (powerUps.length >= 3) return;
    const c = freeCell();
    if (!c) return;
    powerUps.push({ x: c.x, y: c.y, type: pick(['slow', 'shrink', 'score', 'shield']), life: 8 + Math.random() * 7 });
  }

  function spawnObstacles() {
    const count = 3 + Math.floor(score / 50);
    for (let i = 0; i < count; i++) {
      const c = freeCell();
      if (!c) return;
      obstacles.push(c);
    }
  }

  let lastTs = 0;
  function loop(ts) {
    if (!running) return;
    if (!ts) ts = performance.now();
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 20) : 1 / 60;
    lastTs = ts;
    update(dt);
    render();
    animationId = requestAnimationFrame(loop);
  }

  let acc = 0;
  function update(dt) {
    if (state !== 'playing') return;
    if (shieldT > 0) shieldT = Math.max(0, shieldT - dt);
    acc += dt;
    if (acc < 1 / speed) return;
    acc = 0;

    dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    const willGrow = food && head.x === food.x && head.y === food.y;

    // Wall collision
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      gameOver(); return;
    }
    // Self collision — the tail tip vacates this tick unless growing
    const body = willGrow ? snake : snake.slice(0, snake.length - 1);
    if (shieldT <= 0 && body.some(s => s.x === head.x && s.y === head.y)) {
      gameOver(); return;
    }
    // Obstacle collision
    if (shieldT <= 0 && obstacles.some(o => o.x === head.x && o.y === head.y)) {
      gameOver(); return;
    }

    snake.unshift(head);
    trail.push({ x: head.x * GRID + GRID / 2, y: head.y * GRID + GRID / 2, life: 0.3, maxLife: 0.3, color: C.ice2 });

    let ateFood = false;
    let atePowerUp = null;

    // Food collision
    if (food && head.x === food.x && head.y === food.y) {
      ateFood = true;
      const ex = food.x, ey = food.y, etype = food.type;
      const now = Date.now();
      if (now - lastFoodTime < 2000) combo++; else combo = 1;
      lastFoodTime = now;
      const mult = Math.min(1 + combo * 0.5, 5);
      const points = Math.round(10 * mult);
      score += points;
      if (food.type === 'gold') { score += 50; shared.tone({ f0: 880, f1: 1320, dur: 0.3, vol: 0.3, type: 'sine' }); }
      else if (food.type === 'speed') { speed = Math.min(MAX_SPEED, speed + 2); shared.tone({ f0: 660, f1: 880, dur: 0.2, vol: 0.2, type: 'triangle' }); }
      else { shared.tone({ f0: 440, f1: 660, dur: 0.1, vol: 0.2, type: 'triangle' }); }

      if (score > highScore) { highScore = score; shared.saveScore('snake', highScore); }

      speed = Math.min(MAX_SPEED, speed + 0.2);
      spawnFood();
      if (Math.random() < 0.3) spawnPowerUp();
      if (Math.random() < 0.1 && obstacles.length < 15) spawnObstacles();

      shared.spawnParticles({
        x: ex * GRID + GRID / 2, y: ey * GRID + GRID / 2,
        count: 18, color: etype === 'gold' ? C.gold : C.ice,
        speed: 180, life: 0.6, size: 4, gravity: 60
      });
    } else {
      snake.pop();
      combo = 0;
    }

    // Power-up collision
    for (let i = powerUps.length - 1; i >= 0; i--) {
      const p = powerUps[i];
      if (head.x === p.x && head.y === p.y) {
        atePowerUp = p;
        powerUps.splice(i, 1);
        applyPowerUp(p);
        break;
      }
    }

    // Power-up lifetime
    for (let i = powerUps.length - 1; i >= 0; i--) {
      powerUps[i].life -= dt;
      if (powerUps[i].life <= 0) powerUps.splice(i, 1);
    }

    shake = Math.max(0, shake - dt * 8);
    shared.updateParticles(dt);

    // Update trail
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i].life -= dt;
      if (trail[i].life <= 0) trail.splice(i, 1);
    }
  }

  function applyPowerUp(p) {
    shared.tone({ f0: 520, f1: 780, dur: 0.2, vol: 0.25, type: 'sine' });
    shared.spawnParticles({
      x: p.x * GRID + GRID / 2, y: p.y * GRID + GRID / 2,
      count: 15, color: C.violet, speed: 150, life: 0.5, size: 3
    });
    switch (p.type) {
      case 'slow': speed = Math.max(INITIAL_SPEED, speed - 3); break;
      case 'shrink': if (snake.length > 3) snake.length = Math.max(3, snake.length - 2); break;
      case 'score': score += 100; if (score > highScore) { highScore = score; shared.saveScore('snake', highScore); } break;
      case 'shield': shieldT = 8; break;
    }
  }

  function gameOver() {
    state = 'gameover';
    shake = 15;
    shared.tone({ f0: 150, f1: 60, dur: 0.5, vol: 0.4, type: 'sawtooth' });
    shared.spawnParticles({
      x: snake[0].x * GRID + GRID / 2, y: snake[0].y * GRID + GRID / 2,
      count: 40, color: C.red, speed: 250, life: 1, size: 5, gravity: 100
    });
  }

  function render() {
    if (!ctx) return;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);

    // Background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = C.stroke;
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += GRID) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += GRID) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Trail
    trail.forEach(t => {
      const a = t.life / t.maxLife;
      ctx.fillStyle = t.color.replace(')', `, ${a * 0.4})`).replace('rgb', 'rgba').replace('#', '');
      if (t.color.startsWith('#')) {
        const r = parseInt(t.color.slice(1, 3), 16), g = parseInt(t.color.slice(3, 5), 16), b = parseInt(t.color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},${a * 0.4})`;
      }
      ctx.beginPath(); ctx.arc(t.x, t.y, GRID / 2 * a, 0, Math.PI * 2); ctx.fill();
    });

    // Obstacles
    ctx.fillStyle = 'rgba(255, 80, 80, 0.4)';
    obstacles.forEach(o => {
      const x = o.x * GRID, y = o.y * GRID;
      ctx.fillRect(x + 2, y + 2, GRID - 4, GRID - 4);
      ctx.strokeStyle = C.red; ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, y + 2, GRID - 4, GRID - 4);
    });

    // Food
    if (food) {
      const fx = food.x * GRID + GRID / 2, fy = food.y * GRID + GRID / 2;
      const pulse = 1 + Math.sin(Date.now() / 200) * 0.15;
      ctx.fillStyle = food.type === 'gold' ? C.gold : food.type === 'speed' ? C.mint : C.ice;
      ctx.shadowColor = food.type === 'gold' ? C.gold : food.type === 'speed' ? C.mint : C.ice3;
      ctx.shadowBlur = 12 * pulse;
      ctx.beginPath(); ctx.arc(fx, fy, (GRID / 2 - 2) * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Inner glow
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath(); ctx.arc(fx, fy, (GRID / 2 - 6) * pulse, 0, Math.PI * 2); ctx.fill();
    }

    // Power-ups
    powerUps.forEach(p => {
      const px = p.x * GRID + GRID / 2, py = p.y * GRID + GRID / 2;
      const pulse = 1 + Math.sin(Date.now() / 150 + p.x * 10) * 0.1;
      const colors = { slow: C.ice3, shrink: C.red, score: C.gold, shield: C.violet };
      ctx.fillStyle = colors[p.type];
      ctx.shadowColor = colors[p.type];
      ctx.shadowBlur = 10 * pulse;
      ctx.beginPath(); ctx.arc(px, py, (GRID / 2 - 3) * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      // Symbol
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const sym = { slow: '⏱', shrink: '➖', score: '★', shield: '🛡' }[p.type];
      ctx.fillText(sym, px, py + 1);
    });

    // Snake
    snake.forEach((seg, i) => {
      const x = seg.x * GRID, y = seg.y * GRID;
      const a = 1 - i / snake.length * 0.5;
      const r = GRID / 2 - 2;
      const isHead = i === 0;

      ctx.fillStyle = isHead ? C.ice : `rgba(232,250,255,${a})`;
      if (isHead) {
        ctx.shadowColor = C.ice3; ctx.shadowBlur = 14;
      }
      ctx.beginPath();
      const rad = isHead ? 6 : 4;
      rrPath(ctx, x + 2, y + 2, GRID - 4, GRID - 4, rad);
      ctx.fill();
      if (isHead) ctx.shadowBlur = 0;

      // Eyes on head
      if (isHead) {
        ctx.fillStyle = '#030710';
        const ex = dir.x > 0 ? x + GRID - 7 : dir.x < 0 ? x + 7 : x + GRID / 2;
        const ey = dir.y > 0 ? y + GRID - 7 : dir.y < 0 ? y + 7 : y + GRID / 2;
        ctx.beginPath(); ctx.arc(ex - 3, ey, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ex + 3, ey, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    });

    // UI
    ctx.font = 'bold 22px monospace';
    ctx.fillStyle = C.ice2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('Score: ' + score, 20, 20);
    ctx.fillStyle = C.gold; ctx.fillText('Best: ' + highScore, 20, 48);
    ctx.fillStyle = C.ice3; ctx.fillText('Speed: ' + speed.toFixed(1), 20, 76);
    if (combo > 1) { ctx.fillStyle = C.gold; ctx.fillText('Combo x' + combo, 20, 104); }
    if (shieldT > 0) { ctx.fillStyle = C.violet; ctx.fillText('SHIELD ' + Math.ceil(shieldT) + 's', 20, 128); }

    // Length indicator
    ctx.fillStyle = C.ice2; ctx.textAlign = 'right';
    ctx.fillText('Length: ' + snake.length, W - 20, 20);

    // State overlays
    if (state === 'menu') drawOverlay('FROST SNAKE', 'Arrow keys to move · Space to start\nEat ❄️ to grow · ★ gold = bonus · 💎 speed boost\n⏱ slow · ➖ shrink · ★ score · 🛡 shield\nAvoid red blocks and yourself');
    else if (state === 'paused') drawOverlay('PAUSED', 'Space to resume');
    else if (state === 'gameover') drawOverlay('GAME OVER', `Score: ${score}  Best: ${highScore}\nSpace to restart`);

    // Particles
    shared.drawParticles(ctx);
    ctx.restore();
  }

  function drawOverlay(title, subtitle) {
    ctx.fillStyle = 'rgba(3,7,16,0.9)'; ctx.fillRect(0, 0, W, H);
    ctx.font = 'bold 48px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.ice; ctx.fillText(title, W / 2, H / 2 - 30);
    ctx.font = '18px Segoe UI, sans-serif'; ctx.fillStyle = C.ice3;
    subtitle.split('\n').forEach((line, i) => ctx.fillText(line, W / 2, H / 2 + 20 + i * 26));
  }

  function rrPath(g, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + rad, y); g.lineTo(x + w - rad, y);
    g.arcTo(x + w, y, x + w, y + rad, rad); g.lineTo(x + w, y + h - rad);
    g.arcTo(x + w, y + h, x + w - rad, y + h, rad); g.lineTo(x + rad, y + h);
    g.arcTo(x, y + h, x, y + h - rad, rad); g.lineTo(x, y + rad);
    g.arcTo(x, y, x + rad, y, rad); g.closePath();
  }

  function randInt(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
