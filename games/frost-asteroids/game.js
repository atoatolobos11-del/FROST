/**
 * Frost Asteroids — enhanced twin-stick shooter with waves, bosses, power-ups.
 * Exports: { init(canvas, shared), destroy() }
 */

  let shared = null, canvas = null, ctx = null, animationId = null, running = false;
  const W = 960, H = 540;
  const C = {
    bg: '#030710', ice: '#e8faff', ice2: '#bae6fd', ice3: '#38bdf8', ice4: '#0ea5e9',
    violet: '#c084fc', red: '#ef4444', gold: '#ffd479', mint: '#7df9d6', amber: '#fbbf24',
    stroke: 'rgba(90,210,255,.06)'
  };

  // Entity pools
  let ship = null, bullets = [], enemies = [], particles = [], pickups = [];
  const BULLET_CAP = 100, ENEMY_CAP = 80, PARTICLE_CAP = 500;
  let score = 0, highScore = 0, lives = 3, wave = 1, waveTimer = 0;
  let state = 'menu', shake = 0, screenFlash = 0;
  let shipInvuln = 0, rapidFire = 0, spreadShot = 0, shield = 0;
  let boss = null, bossActive = false;

  // Input
  const keys = {};
  let touchMove = { left: false, right: false, thrust: false, fire: false };

export function init(c, sh) { canvas = c; shared = sh; ctx = canvas.getContext('2d');
    if (running) { try { destroy(); } catch (e) { /* ignore */ } }
    resize(); window.addEventListener('resize', resize);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    canvas.addEventListener('pointerdown', onTouchDown);
    canvas.addEventListener('pointermove', onTouchMove);
    canvas.addEventListener('pointerup', onTouchUp);
    canvas.addEventListener('pointercancel', onTouchUp);
    highScore = shared.getBestScore('asteroids') || 0;
    reset(); running = true; lastTs = 0; animationId = requestAnimationFrame(loop); shared.unlockAudio(); }

export function destroy() { running = false; if (animationId) cancelAnimationFrame(animationId);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (canvas) {
      canvas.removeEventListener('pointerdown', onTouchDown);
      canvas.removeEventListener('pointermove', onTouchMove);
      canvas.removeEventListener('pointerup', onTouchUp);
      canvas.removeEventListener('pointercancel', onTouchUp);
    }
    Object.keys(keys).forEach(k => { keys[k] = false; });
    touchMove.left = touchMove.right = touchMove.thrust = touchMove.fire = false;
    touchTarget = null;
    shared.clearParticles(); }

  function onKeyDown(e) {
    keys[e.code] = true;
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight') e.preventDefault();
    if (e.code === 'Space') {
      if (state === 'menu') state = 'playing';
      else if (state === 'gameover') { reset(); state = 'playing'; }
    }
    if (e.code === 'KeyP') {
      if (state === 'playing') state = 'paused';
      else if (state === 'paused') state = 'playing';
    }
  }
  function onKeyUp(e) { keys[e.code] = false; }
  function onBlur() { Object.keys(keys).forEach(k => { keys[k] = false; }); touchTarget = null;
    touchMove.left = touchMove.right = touchMove.thrust = touchMove.fire = false; }

  /* on-screen flight buttons (built by the arcade shell) */
  export function onTouchControl(name, on) {
    if (state === 'menu' && on) { state = 'playing'; return; }
    if (state === 'gameover' && on) { reset(); state = 'playing'; return; }
    if (name === 'left') touchMove.left = on;
    else if (name === 'right') touchMove.right = on;
    else if (name === 'thrust') touchMove.thrust = on;
    else if (name === 'fire') touchMove.fire = on;
  }

  /* touch: ship steers toward the touch point and auto-fires while touching */
  let touchTarget = null;
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  function onTouchDown(e) {
    touchTarget = canvasPos(e);
    if (state === 'menu') state = 'playing';
    else if (state === 'gameover') { reset(); state = 'playing'; }
    e.preventDefault();
  }
  function onTouchMove(e) { if (touchTarget) touchTarget = canvasPos(e); }
  function onTouchUp() { touchTarget = null; }

  function resize() { const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

  function reset() {
    ship = { x: W/2, y: H/2, vx: 0, vy: 0, angle: -Math.PI/2, radius: 14, cooldown: 0, blink: 0 };
    bullets = []; enemies = []; pickups = []; boss = null; bossActive = false;
    score = 0; lives = 3; wave = 1; waveTimer = 0; state = 'menu';
    shake = 0; screenFlash = 0; shipInvuln = 0; rapidFire = 0; spreadShot = 0; shield = 0;
    spawnWave();
  }

  let lastTs = 0;
  function loop(ts) { if (!running) return;
    if (!ts) ts = performance.now();
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 1 / 20) : 1 / 60;
    lastTs = ts;
    update(dt); render(); animationId = requestAnimationFrame(loop); }

  function update(dt) {
    if (state !== 'playing') return;

    // Ship controls
    if (keys.ArrowLeft || keys.KeyA || touchMove.left) ship.angle -= 3.5 * dt;
    if (keys.ArrowRight || keys.KeyD || touchMove.right) ship.angle += 3.5 * dt;
    if (keys.ArrowUp || keys.KeyW || touchMove.thrust) {
      const a = ship.angle; ship.vx += Math.cos(a) * 280 * dt; ship.vy += Math.sin(a) * 280 * dt;
      shared.spawnParticles({ x: ship.x - Math.cos(a)*16, y: ship.y - Math.sin(a)*16, count: 2, color: C.ice2, speed: 30, life: 0.15, size: 2 });
    }
    if (touchTarget) {
      const want = Math.atan2(touchTarget.y - ship.y, touchTarget.x - ship.x);
      let diff = want - ship.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ship.angle += Math.max(-3.5 * dt, Math.min(3.5 * dt, diff));
      if (Math.abs(diff) < 0.6) {
        ship.vx += Math.cos(ship.angle) * 280 * dt;
        ship.vy += Math.sin(ship.angle) * 280 * dt;
      }
      shoot();
    }
    if (keys.Space || touchMove.fire) shoot();

    ship.vx *= 0.985; ship.vy *= 0.985;
    ship.x += ship.vx * dt; ship.y += ship.vy * dt; wrap(ship);
    ship.cooldown = Math.max(0, ship.cooldown - dt);
    ship.blink = Math.max(0, ship.blink - dt);
    shipInvuln = Math.max(0, shipInvuln - dt);
    rapidFire = Math.max(0, rapidFire - dt);
    spreadShot = Math.max(0, spreadShot - dt);
    shield = Math.max(0, shield - dt);

    // Bullets
    bullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; wrap(b); });
    bullets = bullets.filter(b => b.life > 0);

    // Enemy / boss bullets
    bossBullets.forEach(b => { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; wrap(b); });
    bossBullets = bossBullets.filter(b => b.life > 0);

    // Enemies
    enemies.forEach(e => {
      e.x += e.vx * dt; e.y += e.vy * dt; e.angle += e.spin * dt;
      if (e.ai) e.ai(e, dt);
      wrap(e);
    });

    // Boss
    if (bossActive && boss) {
      boss.x += boss.vx * dt; boss.y += boss.vy * dt; boss.angle += boss.spin * dt;
      boss.cooldown = Math.max(0, boss.cooldown - dt);
      boss.patternTimer -= dt;
      if (boss.patternTimer <= 0) { bossPattern(); boss.patternTimer = boss.patternInterval; }
      if (boss.health <= 0) { defeatBoss(); }
      wrap(boss);
    }

    // Pickups
    pickups.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.bob += dt * 4; wrap(p); });
    pickups = pickups.filter(p => p.life > 0);

    // Collisions
    checkCollisions();

    // Wave progression
    if (!bossActive && enemies.length === 0) {
      waveTimer -= dt;
      if (waveTimer <= 0) { wave++; if (wave % 5 === 0) spawnBoss(); else { spawnWave(); shared.tone({ f0: 440, f1: 660, f2: 880, dur: 0.5, vol: 0.25, type: 'sine' }); } }
    }

    shake = Math.max(0, shake - dt * 10);
    screenFlash = Math.max(0, screenFlash - dt * 3);
    shared.updateParticles(dt);
  }

  function shoot() {
    const cd = rapidFire > 0 ? 0.06 : 0.14;
    if (ship.cooldown > 0) return;
    ship.cooldown = cd;

    const baseAngle = ship.angle;
    const spread = spreadShot > 0 ? 0.35 : 0;
    const angles = spread > 0 ? [baseAngle - spread, baseAngle, baseAngle + spread] : [baseAngle];

    angles.forEach(a => {
      const bx = ship.x + Math.cos(a) * 22, by = ship.y + Math.sin(a) * 22;
      const bvx = Math.cos(a) * 700, bvy = Math.sin(a) * 700;
      bullets.push({ x: bx, y: by, vx: bvx, vy: bvy, life: 1.2, dmg: 1 });
    });

    shared.tone({ f0: 660, f1: 440, dur: 0.05, vol: 0.12, type: 'square' });
  }

  function wrap(obj) { if (obj.x < 0) obj.x = W; else if (obj.x > W) obj.x = 0; if (obj.y < 0) obj.y = H; else if (obj.y > H) obj.y = 0; }

  function spawnWave() {
    const count = Math.min(6 + wave * 1.2, 30);
    for (let i = 0; i < count; i++) spawnEnemy();
    waveTimer = 2;
  }

  function spawnEnemy() {
    if (enemies.length >= ENEMY_CAP) return;
    const side = randInt(0, 3);
    let x, y; if (side === 0) { x = randInt(0, W); y = -40; } else if (side === 1) { x = W + 40; y = randInt(0, H); } else if (side === 2) { x = randInt(0, W); y = H + 40; } else { x = -40; y = randInt(0, H); }

    const types = ['basic', 'fast', 'tank', 'splitter', 'shooter'];
    const weights = [40, 20, 15, 15, 10];
    const type = weightedPick(types, weights);

    let size, health, speed, color, spin, ai = null;
    switch (type) {
      case 'basic': size = 22; health = 1; speed = 35; color = C.ice2; spin = (Math.random()-0.5)*1.5; break;
      case 'fast': size = 16; health = 1; speed = 70; color = C.mint; spin = (Math.random()-0.5)*3; break;
      case 'tank': size = 36; health = 4; speed = 20; color = C.violet; spin = (Math.random()-0.5)*0.8; break;
      case 'splitter': size = 28; health = 2; speed = 30; color = C.amber; spin = (Math.random()-0.5)*2; break;
      case 'shooter': size = 24; health = 2; speed = 25; color = C.red; spin = 0;
        ai = (e, dt) => { e.cooldown = Math.max(0, e.cooldown - dt); if (e.cooldown <= 0 && dist(e, ship) < 400) { enemyShoot(e); e.cooldown = 1.5; } };
        break;
    }
    enemies.push({ x, y, vx: (Math.random()-0.5)*speed, vy: (Math.random()-0.5)*speed, size, health, maxHealth: health, color, spin, type, ai, cooldown: Math.random()*1.5 });
  }

  function spawnBoss() {
    bossActive = true;
    boss = { x: W/2, y: -80, vx: 0, vy: 30, size: 80, health: 30 + wave * 4, maxHealth: 30 + wave * 4, angle: 0, spin: 0.15, cooldown: 2, patternTimer: 0, patternInterval: 3, pattern: 0, color: C.violet };
    shared.tone({ f0: 100, f1: 60, f2: 40, dur: 1.5, vol: 0.5, type: 'sawtooth' });
  }

  function bossPattern() {
    boss.pattern = (boss.pattern + 1) % 4;
    const cx = boss.x, cy = boss.y;
    switch (boss.pattern) {
      case 0: // Spiral
        for (let i = 0; i < 12; i++) { const a = i * Math.PI/6 + Date.now()/1000; bossBullets.push({ x: cx, y: cy, vx: Math.cos(a)*200, vy: Math.sin(a)*200, life: 3, color: C.violet }); }
        break;
      case 1: // Aimed burst
        for (let i = 0; i < 5; i++) { const a = Math.atan2(ship.y-cy, ship.x-cx) + (i-2)*0.15; bossBullets.push({ x: cx, y: cy, vx: Math.cos(a)*280, vy: Math.sin(a)*280, life: 2.5, color: C.red }); }
        break;
      case 2: // Ring
        for (let i = 0; i < 16; i++) { const a = i * Math.PI/8; bossBullets.push({ x: cx, y: cy, vx: Math.cos(a)*180, vy: Math.sin(a)*180, life: 3, color: C.ice3 }); }
        break;
      case 3: // Fast aimed
        for (let i = 0; i < 3; i++) { const a = Math.atan2(ship.y-cy, ship.x-cx); bossBullets.push({ x: cx, y: cy, vx: Math.cos(a)*350, vy: Math.sin(a)*350, life: 2, color: C.amber }); }
        break;
    }
    shared.tone({ f0: 200, f1: 150, dur: 0.15, vol: 0.2, type: 'square' });
  }

  let bossBullets = [];

  function defeatBoss() {
    score += 500 * wave;
    if (score > highScore) { highScore = score; shared.saveScore('asteroids', highScore); }
    bossActive = false; boss = null; bossBullets = [];
    waveTimer = 3;
    shared.tone({ f0: 440, f1: 660, f2: 880, f3: 1320, dur: 1, vol: 0.4, type: 'sine' });
    shared.spawnParticles({ x: W/2, y: H/2, count: 60, color: C.gold, speed: 300, life: 1.5, size: 6, gravity: 50 });
    shake = 20; screenFlash = 1;
    spawnPickup(W/2, H/2, 'gold');
  }

  function spawnPickup(x, y, type) {
    const types = type === 'gold' ? ['gold'] : ['rapid', 'spread', 'shield', 'life', 'score'];
    const t = type === 'gold' ? 'gold' : pick(types);
    const colors = { rapid: C.ice3, spread: C.violet, shield: C.mint, life: C.red, score: C.gold, gold: C.gold };
    pickups.push({ x, y, vx: (Math.random()-0.5)*40, vy: (Math.random()-0.5)*40, type: t, color: colors[t], life: 12, bob: 0, size: 16 });
  }

  function checkCollisions() {
    // Bullets vs enemies
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      for (let j = enemies.length - 1; j >= 0; j--) {
        const e = enemies[j];
        if (Math.hypot(b.x - e.x, b.y - e.y) < e.size + 4) {
          bullets.splice(i, 1); e.health -= b.dmg;
          shared.spawnParticles({ x: e.x, y: e.y, count: 6, color: e.color, speed: 80, life: 0.3, size: 2 });
          shared.tone({ f0: 300, f1: 200, dur: 0.08, vol: 0.15, type: 'sine' });
          if (e.health <= 0) {
            score += 10 * (e.maxHealth);
            if (score > highScore) { highScore = score; shared.saveScore('asteroids', highScore); }
            shared.spawnParticles({ x: e.x, y: e.y, count: 18, color: e.color, speed: 150, life: 0.6, size: 3 });
            shared.tone({ f0: 200, f1: 100, dur: 0.15, vol: 0.2, type: 'sawtooth' });
            if (e.type === 'splitter') { for (let k=0;k<3;k++) spawnSplitter(e.x, e.y); }
            else if (Math.random() < 0.15) spawnPickup(e.x, e.y);
            enemies.splice(j, 1);
          }
          break;
        }
      }
    }

    // Bullets vs boss
    if (bossActive && boss) {
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (Math.hypot(b.x - boss.x, b.y - boss.y) < boss.size) {
          bullets.splice(i, 1); boss.health -= b.dmg;
          shared.spawnParticles({ x: boss.x, y: boss.y, count: 4, color: C.violet, speed: 60, life: 0.2, size: 2 });
          shake = 2;
        }
      }
    }

    // Boss bullets vs ship
    if (!shipInvuln && shield <= 0) {
      for (let i = bossBullets.length - 1; i >= 0; i--) {
        const b = bossBullets[i];
        if (Math.hypot(b.x - ship.x, b.y - ship.y) < ship.radius + 4) {
          bossBullets.splice(i, 1); hitShip();
        }
      }
    }

    // Enemies vs ship
    if (!shipInvuln && shield <= 0) {
      for (const e of enemies) {
        if (Math.hypot(ship.x - e.x, ship.y - e.y) < ship.radius + e.size) { hitShip(); break; }
      }
    }
    if (bossActive && boss && !shipInvuln && shield <= 0) {
      if (Math.hypot(ship.x - boss.x, ship.y - boss.y) < ship.radius + boss.size) { hitShip(); }
    }

    // Pickups
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (Math.hypot(ship.x - p.x, ship.y - p.y) < ship.radius + p.size) {
        pickups.splice(i, 1); applyPickup(p);
      }
    }
  }

  function hitShip() {
    lives--; shipInvuln = 2; ship.blink = 2; shake = 12; screenFlash = 0.5;
    shared.tone({ f0: 100, f1: 60, dur: 0.4, vol: 0.4, type: 'sawtooth' });
    shared.spawnParticles({ x: ship.x, y: ship.y, count: 30, color: C.red, speed: 250, life: 0.8, size: 5 });
    if (lives <= 0) { state = 'gameover'; shared.tone({ f0: 120, f1: 50, dur: 0.8, vol: 0.5, type: 'sawtooth' }); }
    else { ship.x = W/2; ship.y = H/2; ship.vx = ship.vy = 0; }
  }

  function applyPickup(p) {
    shared.tone({ f0: 520, f1: 780, dur: 0.2, vol: 0.25, type: 'sine' });
    shared.spawnParticles({ x: p.x, y: p.y, count: 15, color: p.color, speed: 150, life: 0.5, size: 3 });
    switch (p.type) {
      case 'rapid': rapidFire = 8; break;
      case 'spread': spreadShot = 8; break;
      case 'shield': shield = 10; break;
      case 'life': lives = Math.min(5, lives + 1); break;
      case 'score': score += 200; if (score > highScore) { highScore = score; shared.saveScore('asteroids', highScore); } break;
      case 'gold': score += 1000; if (score > highScore) { highScore = score; shared.saveScore('asteroids', highScore); } break;
    }
  }

  function spawnSplitter(x, y) {
    for (let k = 0; k < 3; k++) {
      enemies.push({ x, y, vx: (Math.random()-0.5)*60, vy: (Math.random()-0.5)*60, size: 14, health: 1, maxHealth: 1, color: C.amber, spin: (Math.random()-0.5)*3, type: 'splitter' });
    }
  }

  function render() {
    if (!ctx) return;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random()-0.5)*shake, (Math.random()-0.5)*shake);
    if (screenFlash > 0) { ctx.fillStyle = `rgba(255,255,255,${screenFlash*0.3})`; ctx.fillRect(0,0,W,H); }

    // Background grid
    ctx.fillStyle = C.bg; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = C.stroke; ctx.lineWidth = 1;
    for (let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for (let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}

    // Boss warning
    if (bossActive && boss) {
      ctx.strokeStyle = C.red; ctx.lineWidth = 3; ctx.setLineDash([20,10]);
      ctx.strokeRect(10,10,W-20,H-20); ctx.setLineDash([]);
      // Health bar
      const bw = 400, bh = 12;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(W/2-bw/2, 30, bw, bh);
      ctx.fillStyle = C.red; ctx.fillRect(W/2-bw/2, 30, bw * (boss.health/boss.maxHealth), bh);
      ctx.strokeStyle = C.ice2; ctx.strokeRect(W/2-bw/2, 30, bw, bh);
      ctx.font = 'bold 16px monospace'; ctx.fillStyle = C.red; ctx.textAlign = 'center';
      ctx.fillText('BOSS - WAVE ' + wave, W/2, 26);
    }

    // Entities
    drawShip();
    bullets.forEach(b => { ctx.fillStyle = C.ice; ctx.beginPath(); ctx.arc(b.x,b.y,3,0,Math.PI*2); ctx.fill(); });
    bossBullets.forEach(b => { ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x,b.y,5,0,Math.PI*2); ctx.fill(); });
    enemies.forEach(e => drawEnemy(e));
    if (bossActive && boss) drawBoss();
    pickups.forEach(p => drawPickup(p));

    // UI
    ctx.font = 'bold 20px monospace'; ctx.fillStyle = C.ice2; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('Score: ' + score, 20, 20);
    ctx.fillStyle = C.gold; ctx.fillText('Best: ' + highScore, 20, 45);
    ctx.fillStyle = C.ice3; ctx.fillText('Wave: ' + wave, 20, 70);
    if (rapidFire > 0) { ctx.fillStyle = C.ice3; ctx.fillText('RAPID FIRE: ' + rapidFire.toFixed(1), 20, 95); }
    if (spreadShot > 0) { ctx.fillStyle = C.violet; ctx.fillText('SPREAD: ' + spreadShot.toFixed(1), 20, 120); }
    if (shield > 0) { ctx.fillStyle = C.mint; ctx.fillText('SHIELD: ' + shield.toFixed(1), 20, 145); }

    // Lives
    for (let i = 0; i < lives; i++) {
      ctx.fillStyle = C.ice; ctx.beginPath();
      ctx.moveTo(W - 30 + i * 24, H - 30);
      ctx.lineTo(W - 22 + i * 24, H - 42);
      ctx.lineTo(W - 14 + i * 24, H - 30); ctx.closePath(); ctx.fill();
    }

    // State overlays
    if (state === 'menu') drawOverlay('FROST ASTEROIDS', 'Arrows/WASD move/rotate · Space shoot\nSurvive waves · Boss every 5 waves\nPickups: ⚡ rapid · ⬡ spread · 🛡 shield · ♥ life');
    else if (state === 'paused') drawOverlay('PAUSED', 'P to resume');
    else if (state === 'gameover') drawOverlay('GAME OVER', `Score: ${score}  Best: ${highScore}\nWave reached: ${wave}\nSpace to restart`);

    shared.drawParticles(ctx);
    ctx.restore();
  }

  function drawShip() {
    if (ship.blink > 0 && Math.floor(ship.blink * 10) % 2 === 0) return;
    ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle);
    ctx.fillStyle = C.ice; ctx.shadowColor = shield > 0 ? C.mint : C.ice3; ctx.shadowBlur = shield > 0 ? 20 : 12;
    ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-12, -10); ctx.lineTo(-6, 0); ctx.lineTo(-12, 10); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(232,250,255,0.4)';
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -5); ctx.lineTo(-2, 0); ctx.lineTo(-6, 5); ctx.closePath(); ctx.fill();
    if (shield > 0) { ctx.strokeStyle = C.mint; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI*2); ctx.stroke(); }
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.angle);
    ctx.strokeStyle = e.color; ctx.lineWidth = 2;
    ctx.beginPath();
    const verts = e.type === 'tank' ? 10 : e.type === 'fast' ? 6 : 8;
    for (let i = 0; i < verts; i++) { const a = (i/verts)*Math.PI*2; const r = e.size*(0.7+Math.random()*0.3); ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r); }
    ctx.closePath(); ctx.stroke();
    if (e.type === 'shooter') { ctx.fillStyle = C.red; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI*2); ctx.fill(); }
    // Health indicator for tank
    if (e.maxHealth > 1) { ctx.fillStyle = 'rgba(255,0,0,0.6)'; ctx.fillRect(-e.size, -e.size-6, e.size*2*(e.health/e.maxHealth), 4); }
    ctx.restore();
  }

  function drawBoss() {
    if (!boss) return;
    ctx.save(); ctx.translate(boss.x, boss.y); ctx.rotate(boss.angle);
    ctx.strokeStyle = boss.color; ctx.lineWidth = 3; ctx.shadowColor = boss.color; ctx.shadowBlur = 20;
    ctx.beginPath();
    for (let i = 0; i < 12; i++) { const a = (i/12)*Math.PI*2; const r = boss.size*(0.8+Math.sin(Date.now()/200 + i)*0.2); ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r); }
    ctx.closePath(); ctx.stroke(); ctx.shadowBlur = 0;
    // Core
    ctx.fillStyle = 'rgba(192,132,255,0.3)'; ctx.beginPath(); ctx.arc(0, 0, boss.size*0.4, 0, Math.PI*2); ctx.fill();
    // Turrets
    for (let i = 0; i < 4; i++) { const a = i*Math.PI/2 + Date.now()/3000; const tx = Math.cos(a)*boss.size*0.7, ty = Math.sin(a)*boss.size*0.7; ctx.fillStyle = C.violet; ctx.beginPath(); ctx.arc(tx, ty, 8, 0, Math.PI*2); ctx.fill(); }
    ctx.restore();
  }

  function drawPickup(p) {
    ctx.save(); ctx.translate(p.x, p.y);
    const bob = Math.sin(p.bob) * 3;
    ctx.translate(0, bob);
    ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(0, 0, p.size, 0, Math.PI*2); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sym = { rapid: '⚡', spread: '⬡', shield: '🛡', life: '♥', score: '★', gold: '◆' }[p.type];
    ctx.fillText(sym, 0, 2); ctx.restore();
  }

  function drawOverlay(t, s) {
    ctx.fillStyle = 'rgba(3,7,16,0.9)'; ctx.fillRect(0,0,W,H);
    ctx.font = 'bold 48px Segoe UI, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = C.ice; ctx.fillText(t, W/2, H/2 - 30);
    ctx.font = '18px Segoe UI, sans-serif'; ctx.fillStyle = C.ice3;
    s.split('\n').forEach((l,i) => ctx.fillText(l, W/2, H/2 + 20 + i*26));
  }

  function dist(a, b) { return Math.hypot(a.x-b.x, a.y-b.y); }
  function randInt(a,b){ return Math.floor(Math.random()*(b-a+1))+a; }
  function pick(a){ return a[Math.floor(Math.random()*a.length)]; }
  function weightedPick(arr, weights) { const total = weights.reduce((a,b)=>a+b,0); let r = Math.random()*total; for(let i=0;i<arr.length;i++){ r-=weights[i]; if(r<=0) return arr[i]; } return arr[arr.length-1]; }
export function togglePause() {
  if (state === 'playing') state = 'paused';
  else if (state === 'paused') state = 'playing';
}

function enemyShoot(e) {
  const a = Math.atan2(ship.y - e.y, ship.x - e.x);
  bossBullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 220, vy: Math.sin(a) * 220, life: 2.5, color: C.red });
}
