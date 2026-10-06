/* Frost Breakout extras — settings, stats, levels, achievements, modes, share, PWA */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const loadJSON = (k, fb) => { try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : fb; } catch (e) { return fb; } };
  const saveJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };
  const FB = () => window.frostBreakout;

  /* ---------- settings (global arcade store; legacy key mirrored) ---------- */
  const SET_KEY = 'frost-breakout:settings';
  const GLOBAL_SET_KEY = 'frost-arcade:settings';
  function getSettings() {
    const s = loadJSON(SET_KEY, {});
    const g = loadJSON(GLOBAL_SET_KEY, {});
    const m = Object.assign({}, s, g);
    return {
      difficulty: m.difficulty || 'normal',
      volume: (typeof m.volume === 'number' ? m.volume : 0.8),
      shake: (m.shake !== false),
      particles: (m.particles !== false),
      flash: (m.flash !== false),
    };
  }
  function setSettings(patch) {
    const s = Object.assign(getSettings(), patch);
    saveJSON(SET_KEY, s);
    saveJSON(GLOBAL_SET_KEY, s);
    applySettings(s);
    return s;
  }
  function applySettings(s) {
    s = s || getSettings();
    try { if (FB() && FB().setVolume) FB().setVolume(s.volume); } catch (e) { /* ignore */ }
    document.body.classList.toggle('no-shake', !s.shake);
  }

  /* ---------- meta / stats ---------- */
  const META_KEY = 'frost-breakout:meta';
  function getMeta() {
    const m = loadJSON(META_KEY, {});
    return {
      maxLevel: m.maxLevel || 1,
      totalRuns: m.totalRuns || 0,
      totalBricks: m.totalBricks || 0,
      totalPowerups: m.totalPowerups || 0,
      wins: m.wins || 0,
      bestComboEver: m.bestComboEver || 0,
      bestScore: m.bestScore || 0,
      perLevelBest: m.perLevelBest || {},
      perModeBest: m.perModeBest || {},
      lastDaily: m.lastDaily || null,
      plays: m.plays || {},
    };
  }
  function setMeta(m) { saveJSON(META_KEY, m); return m; }
  function bumpMeta(fn) { const m = getMeta(); fn(m); return setMeta(m); }

  /* ---------- achievements ---------- */
  const ACH_KEY = 'frost-breakout:ach';
  const ACH = [
    { id: 'first-shard', ico: '❄️', name: 'First Shard', desc: 'Shatter your first block' },
    { id: 'brick100', ico: '🧊', name: 'Icebreaker', desc: 'Shatter 100 blocks total' },
    { id: 'brick1000', ico: '🏔️', name: 'Glacier Cleaver', desc: 'Shatter 1,000 blocks total' },
    { id: 'combo12', ico: '✧', name: 'Frost Chain', desc: 'Reach a 12-hit combo' },
    { id: 'combo30', ico: '🌟', name: 'Blizzard Chain', desc: 'Reach a 30-hit combo' },
    { id: 'power5', ico: '⚡', name: 'Charged', desc: 'Catch 5 power-ups in one run' },
    { id: 'shield-save', ico: '🛡️', name: 'Wardkeeper', desc: 'Let the frost shield absorb a fall' },
    { id: 'explorer', ico: '🧭', name: 'Explorer', desc: 'Reach level 4' },
    { id: 'veteran', ico: '💠', name: 'Veteran', desc: 'Reach level 8' },
    { id: 'champion', ico: '🏆', name: 'Glacier Champion', desc: 'Clear all 8 levels in Classic' },
    { id: 'endless5', ico: '♾️', name: 'Deep Winter', desc: 'Survive 5 Endless stages' },
    { id: 'daily', ico: '📅', name: 'Daily Frost', desc: 'Play the daily challenge' },
    { id: 'creator', ico: '🧱', name: 'Architect', desc: 'Play a custom level' },
    { id: 'sharer', ico: '📣', name: 'Herald', desc: 'Share your score' },
  ];
  function getAch() { return loadJSON(ACH_KEY, { unlocked: {} }); }
  function unlock(id) {
    const a = getAch();
    if (a.unlocked[id]) return false;
    a.unlocked[id] = Date.now();
    saveJSON(ACH_KEY, a);
    const def = ACH.find((d) => d.id === id);
    if (def) toast('🏆 ' + def.name, def.desc);
    renderAch();
    return true;
  }
  function toast(title, sub) {
    const host = $('toasts');
    if (!host) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span style="font-size:20px">🏆</span><span>' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span>';
    host.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, 3400);
  }

  /* run-local counters */
  let runBricks = 0, runPowerups = 0;

  function recordBrick(d) {
    runBricks++;
    bumpMeta((m) => {
      m.totalBricks++;
      if (d && d.combo) m.bestComboEver = Math.max(m.bestComboEver, d.combo);
      const g = FB() ? FB().game : null;
      if (g) m.bestComboEver = Math.max(m.bestComboEver, g.bestCombo || 0);
    });
    unlock('first-shard');
    const m = getMeta();
    if (m.totalBricks >= 100) unlock('brick100');
    if (m.totalBricks >= 1000) unlock('brick1000');
    if (d && d.combo >= 12) unlock('combo12');
    if (d && d.combo >= 30) unlock('combo30');
  }
  function recordPowerup() {
    runPowerups++;
    bumpMeta((m) => { m.totalPowerups++; });
    if (runPowerups >= 5) unlock('power5');
  }

  /* ---------- overlays ---------- */
  function openOv(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
  function closeOv(id) { const el = $(id); if (el) el.classList.add('hidden'); }
  function closeAllExtra() { ['ovSettings', 'ovLevels', 'ovStats', 'ovAch', 'ovHowto'].forEach(closeOv); }

  function renderSettings() {
    const s = getSettings();
    const dif = $('setDifficulty'); if (dif) dif.value = s.difficulty;
    const vol = $('setVolume'); if (vol) vol.value = s.volume;
    const vv = $('setVolumeVal'); if (vv) vv.textContent = Math.round(s.volume * 100) + '%';
    const sh = $('setShake'); if (sh) sh.checked = !!s.shake;
    const pa = $('setParticles'); if (pa) pa.checked = !!s.particles;
    const fl = $('setFlash'); if (fl) fl.checked = !!s.flash;
  }
  function renderLevels() {
    const host = $('levelGrid');
    if (!host) return;
    const m = getMeta();
    host.innerHTML = '';
    for (let i = 1; i <= 8; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      const locked = i > (m.maxLevel || 1);
      b.className = 'lvl' + (locked ? ' locked' : '');
      const best = m.perLevelBest[i] || 0;
      b.innerHTML = '<b>' + i + '</b><span>Lvl ' + i + '</span><small>' + (locked ? 'locked' : (best ? best.toLocaleString() : '—')) + '</small>';
      if (!locked) b.addEventListener('click', () => { closeAllExtra(); if (FB()) FB().start({ mode: 'classic', level: i }); });
      host.appendChild(b);
    }
  }
  function renderStats() {
    const m = getMeta();
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('stBest', (m.bestScore || 0).toLocaleString());
    set('stWins', m.wins);
    set('stRuns', m.totalRuns);
    set('stBricks', m.totalBricks);
    set('stCombo', m.bestComboEver);
    set('stPower', m.totalPowerups);
    set('stClassic', (m.perModeBest.classic || 0).toLocaleString());
    set('stDaily', (m.perModeBest.daily || 0).toLocaleString());
    set('stEndless', (m.perModeBest.endless || 0).toLocaleString());
    set('stCustom', (m.perModeBest.custom || 0).toLocaleString());
  }
  function renderAch() {
    const host = $('achList');
    if (!host) return;
    const a = getAch();
    host.innerHTML = '';
    ACH.forEach((d) => {
      const un = !!a.unlocked[d.id];
      const el = document.createElement('div');
      el.className = 'ach' + (un ? ' unlocked' : '');
      el.innerHTML = '<span class="ico">' + d.ico + '</span><span><b>' + d.name + '</b><small>' + d.desc + (un ? ' · ✓' : '') + '</small></span>';
      host.appendChild(el);
    });
    const c = $('achCount');
    if (c) c.textContent = Object.keys(a.unlocked).length + '/' + ACH.length + ' unlocked';
  }
  function renderMenu() {
    const run = FB() && FB().loadRun ? FB().loadRun() : null;
    const cb = $('btnContinue');
    if (cb) {
      if (run) { cb.style.display = ''; cb.textContent = '▶ Continue · ' + (run.mode || 'classic') + ' L' + run.level + ' · ' + (run.score || 0).toLocaleString(); }
      else cb.style.display = 'none';
    }
    const dl = $('dailyLine');
    if (dl) {
      const d = new Date();
      const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      const lvl = (seed % 8) + 1;
      dl.innerHTML = '📅 Daily <b>' + d.toISOString().slice(0, 10) + '</b> · starts at level <b>' + lvl + '</b>';
    }
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.classList.toggle('active', (b.dataset.mode || 'classic') === (window.__fbMode || 'classic'));
    });
  }

  /* ---------- share ---------- */
  function currentShareText() {
    const g = FB() ? FB().game : null;
    const score = g ? g.score : 0;
    const lvl = g ? g.level : 1;
    const mode = g ? (g.mode || 'classic') : 'classic';
    return 'I scored ' + score.toLocaleString() + ' in Frost Breakout (' + mode + ', level ' + lvl + ')! ❄️ Can you beat me?';
  }
  async function shareScore() {
    const text = currentShareText();
    const url = location.href;
    try {
      if (navigator.share) { await navigator.share({ title: 'Frost Breakout', text, url }); unlock('sharer'); return; }
    } catch (e) { /* user cancelled */ return; }
    try {
      await navigator.clipboard.writeText(text + ' ' + url);
      toast('📋 Score copied', 'Paste it anywhere to share');
      unlock('sharer');
    } catch (e) {
      try { window.prompt('Copy your score:', text + ' ' + url); unlock('sharer'); } catch (err) { /* ignore */ }
    }
  }
  function downloadShot() {
    try {
      const c = $('game');
      if (!c) return;
      const a = document.createElement('a');
      a.download = 'frost-breakout-' + Date.now() + '.png';
      a.href = c.toDataURL('image/png');
      a.click();
    } catch (e) { /* tainted? ignore */ }
  }

  /* ---------- events from core ---------- */
  function bindCoreEvents() {
    window.addEventListener('fb:runstart', () => {
      runBricks = 0; runPowerups = 0;
      bumpMeta((m) => { m.totalRuns++; });
      renderMenu();
    });
    window.addEventListener('fb:brick', (e) => recordBrick(e.detail));
    window.addEventListener('fb:powerup', () => recordPowerup());
    window.addEventListener('fb:shield', () => unlock('shield-save'));
    window.addEventListener('fb:level', (e) => {
      const d = e.detail || {};
      const lvl = d.level || 1;
      if (lvl >= 4) unlock('explorer');
      if (lvl >= 8) unlock('veteran');
      bumpMeta((m) => { m.maxLevel = Math.max(m.maxLevel || 1, Math.min(8, lvl)); });
      renderLevels(); renderMenu();
    });
    window.addEventListener('fb:levelclear', (e) => {
      const d = e.detail || {};
      const g = FB() ? FB().game : null;
      const score = g ? g.score : (d.score || 0);
      bumpMeta((m) => {
        m.maxLevel = Math.max(m.maxLevel || 1, Math.min(8, (d.level || 1) + 1));
        m.bestScore = Math.max(m.bestScore || 0, score);
        const mode = (d.mode || 'classic');
        m.perModeBest[mode] = Math.max(m.perModeBest[mode] || 0, score);
        m.perLevelBest[d.level || 1] = Math.max(m.perLevelBest[d.level || 1] || 0, score);
        if (mode === 'daily') m.lastDaily = new Date().toISOString().slice(0, 10);
      });
      try {
        const key = 'frost-arcade:breakout:best';
        const cur = parseInt(localStorage.getItem(key), 10) || 0;
        if (score > cur) localStorage.setItem(key, String(score));
      } catch (err) { /* ignore */ }
      if ((d.mode || 'classic') === 'daily') unlock('daily');
      if ((d.mode || 'classic') === 'endless' && (d.endlessDepth || 0) + 1 >= 5) unlock('endless5');
      renderLevels(); renderStats(); renderMenu();
    });
    const endRun = (d) => {
      d = d || {};
      const g = FB() ? FB().game : null;
      const score = g ? g.score : (d.score || 0);
      const mode = (d.mode || (g && g.mode) || 'classic');
      bumpMeta((m) => {
        m.bestScore = Math.max(m.bestScore || 0, score);
        m.perModeBest[mode] = Math.max(m.perModeBest[mode] || 0, score);
        if (g) m.bestComboEver = Math.max(m.bestComboEver || 0, g.bestCombo || 0);
        if (mode === 'daily') m.lastDaily = new Date().toISOString().slice(0, 10);
      });
      if (mode === 'classic' && d.level >= 8) { /* victory path handles champion */ }
      try {
        const key = 'frost-arcade:breakout:best';
        const cur = parseInt(localStorage.getItem(key), 10) || 0;
        if (score > cur) localStorage.setItem(key, String(score));
      } catch (err) { /* ignore */ }
      renderStats(); renderMenu();
    };
    window.addEventListener('fb:gameover', (e) => endRun(e.detail));
    window.addEventListener('fb:victory', (e) => {
      const d = e.detail || {};
      endRun(d);
      bumpMeta((m) => { m.wins++; });
      if ((d.mode || 'classic') === 'classic') unlock('champion');
      if ((d.mode || 'classic') === 'daily') unlock('daily');
      renderStats();
    });
  }

  /* ---------- boot / wiring ---------- */
  function setMode(m) {
    window.__fbMode = m;
    renderMenu();
    if (!FB()) return;
    if (m === 'daily') FB().startMode('daily');
    else if (m === 'endless') FB().startMode('endless');
    else if (m === 'custom') {
      const c = loadJSON('frost-breakout:custom', null);
      if (!c) { window.location.href = 'editor.html'; return; }
      unlock('creator');
      FB().startMode('custom', { bricks: c, name: c.name || 'CUSTOM', speed: c.speed });
    } else FB().start({ mode: 'classic', level: 1 });
  }

  function wire() {
    document.querySelectorAll('.mode-btn').forEach((b) => {
      b.addEventListener('click', () => { try { FB().game && null; } catch (e) {} setMode(b.dataset.mode || 'classic'); });
    });
    const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    bind('btnContinue', () => { if (FB() && FB().continueRun && FB().continueRun()) { window.__fbMode = (FB().game && FB().game.mode) || 'classic'; renderMenu(); } });
    bind('btnLevels', () => { renderLevels(); openOv('ovLevels'); });
    bind('btnSettings', () => { renderSettings(); openOv('ovSettings'); });
    bind('btnSettingsHud', () => { renderSettings(); openOv('ovSettings'); });
    bind('btnStats', () => { renderStats(); openOv('ovStats'); });
    bind('btnAch', () => { renderAch(); openOv('ovAch'); });
    bind('btnHow', () => openOv('ovHowto'));
    bind('btnEditor', () => { window.location.href = 'editor.html'; });
    ['ovSettingsX', 'ovLevelsX', 'ovStatsX', 'ovAchX', 'ovHowtoX'].forEach((id) => bind(id, closeAllExtra));
    bind('btnShareOver', shareScore);
    bind('btnShareWin', shareScore);
    bind('btnShotOver', downloadShot);
    bind('btnShotWin', downloadShot);
    const dif = $('setDifficulty');
    if (dif) dif.addEventListener('change', () => setSettings({ difficulty: dif.value }));
    const vol = $('setVolume');
    if (vol) vol.addEventListener('input', () => { setSettings({ volume: parseFloat(vol.value) }); const vv = $('setVolumeVal'); if (vv) vv.textContent = Math.round(parseFloat(vol.value) * 100) + '%'; });
    const sh = $('setShake'); if (sh) sh.addEventListener('change', () => setSettings({ shake: sh.checked }));
    const pa = $('setParticles'); if (pa) pa.addEventListener('change', () => setSettings({ particles: pa.checked }));
    const fl = $('setFlash'); if (fl) fl.addEventListener('change', () => setSettings({ flash: fl.checked }));
    bind('btnWipe', () => {
      if (!window.confirm('Reset bests, stats and achievements?')) return;
      ['frost-breakout:best', 'frost-breakout:meta', 'frost-breakout:ach', 'frost-breakout:run'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
      renderLevels(); renderStats(); renderAch(); renderMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.code === 'Escape') closeAllExtra(); });
    // Start button respects chosen mode
    const bs = $('btnStart');
    if (bs) bs.addEventListener('click', () => {
      const m = window.__fbMode || 'classic';
      setTimeout(() => {
        if (!FB()) return;
        if (FB().game.state !== 'serve' && FB().game.state !== 'play') return;
        // startGame already called by core btnStart handler; re-route to mode
        if (m !== 'classic') setMode(m);
      }, 0);
    }, true);
  }

  function registerSW() {
    if ('serviceWorker' in navigator && (location.protocol === 'http:' || location.protocol === 'https:')) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline not critical */ });
      });
    }
  }

  function boot() {
    window.__fbMode = 'classic';
    applySettings();
    bindCoreEvents();
    wire();
    renderSettings(); renderLevels(); renderStats(); renderAch(); renderMenu();
    registerSW();
    // custom via ?custom=1 or ?play=custom
    try {
      const q = new URLSearchParams(location.search);
      if (q.get('play') === 'custom' || q.get('custom') === '1') {
        const c = loadJSON('frost-breakout:custom', null);
        if (c && FB()) { window.__fbMode = 'custom'; setTimeout(() => setMode('custom'), 300); }
      }
      if (q.get('mode') === 'daily' && FB()) setTimeout(() => setMode('daily'), 300);
      if (q.get('mode') === 'endless' && FB()) setTimeout(() => setMode('endless'), 300);
    } catch (e) { /* ignore */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
