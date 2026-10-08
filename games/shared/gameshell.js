/**
 * Frost Arcade GameShell — ES Module
 * - Presents a game selector on load
 * - Manages fullscreen, mute, pause globally
 * - Lazy-loads game modules
 * - Uses FrostShared for audio, particles, storage
 */
import * as FrostShared from './frost-shared.js';

const GAMES = [
  { id: 'breakout', name: 'Frost Breakout', desc: 'Classic brick-breaker — 8 levels, 5 power-ups, frost shield', icon: '❄️', path: '../index.html', standalone: true },
  { id: 'pong', name: 'Frost Pong', desc: 'Neon paddle duel — local 2P or vs AI', icon: '🏓', path: '../frost-pong/game.js' },
  { id: 'snake', name: 'Frost Snake', desc: 'Grid arena, frost trails, power-ups, obstacles', icon: '🐍', path: '../frost-snake/game.js' },
  { id: 'asteroids', name: 'Frost Asteroids', desc: 'Twin-stick shooter, bosses, power-ups', icon: '☄️', path: '../frost-asteroids/game.js' },
  { id: 'pinball', name: 'Frost Pinball', desc: 'Full table — flippers, bumpers, ramps, multiball', icon: '🎱', path: '../frost-pinball/game.js' },
  { id: 'hoops', name: 'Frost Hoops', desc: 'Messenger-style solo hoops — 60s shootout', icon: '🏀', path: '../frost-hoops/game.js' },
];

let currentGame = null;
let currentGameModule = null;
let fullscreen = false;
let loadToken = 0; // guards against overlapping loads resolving out of order

const shell = document.getElementById('shell');
const selector = document.getElementById('game-selector');
const gameHost = document.getElementById('game-host');
const touchControls = document.getElementById('touchControls');
const btnBack = document.getElementById('btnBack');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnSound = document.getElementById('btnSound');
const btnPause = document.getElementById('btnPause');

const coarsePointer = window.matchMedia('(pointer: coarse)').matches;

/* Per-game on-screen controllers. Groups align left/center/right; a `dpad`
   group renders Up/Left/Right/Down in a cross layout. */
const TOUCH_LAYOUTS = {
  pong: [
    { align: 'left', buttons: [
      { name: 'p1up', label: '▲', sub: 'P1' },
      { name: 'p1down', label: '▼', sub: 'P1' },
    ]},
    { align: 'right', buttons: [
      { name: 'p2up', label: '▲', sub: 'P2' },
      { name: 'p2down', label: '▼', sub: 'P2' },
    ]},
  ],
  snake: [
    { align: 'center', dpad: true, buttons: [
      { name: 'up', label: '▲', cls: 'd-up' },
      { name: 'left', label: '◀', cls: 'd-left' },
      { name: 'right', label: '▶', cls: 'd-right' },
      { name: 'down', label: '▼', cls: 'd-down' },
    ]},
  ],
  asteroids: [
    { align: 'left', buttons: [
      { name: 'left', label: '◀' },
      { name: 'right', label: '▶' },
    ]},
    { align: 'right', buttons: [
      { name: 'thrust', label: '▲', sub: 'THRUST' },
      { name: 'fire', label: '●', sub: 'FIRE' },
    ]},
  ],
  pinball: [
    { align: 'left', buttons: [{ name: 'left', label: '◀ FLIPPER', cls: 'wide' }]},
    { align: 'right', buttons: [{ name: 'plunge', label: '●', sub: 'PLUNGE' }]},
    { align: 'right', buttons: [{ name: 'right', label: 'FLIPPER ▶', cls: 'wide' }]},
  ],
  /* hoops needs no buttons — swipe up on the ball to shoot */
};

function pressControl(name, on) {
  if (currentGameModule && currentGameModule.onTouchControl) {
    try { currentGameModule.onTouchControl(name, on); } catch (e) { /* ignore */ }
  }
  window.FrostShell.lastTouch = { game: currentGame, name, on, t: Date.now() };
}

function buildTouchControls(id) {
  touchControls.innerHTML = '';
  const layout = TOUCH_LAYOUTS[id];
  if (!layout || !coarsePointer) { touchControls.hidden = true; return; }
  layout.forEach(group => {
    const g = document.createElement('div');
    g.className = 'touch-group' + (group.align === 'center' ? ' center' : '') + (group.dpad ? ' tctl-dpad' : '');
    group.buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tctl' + (b.cls ? ' ' + b.cls : '');
      btn.setAttribute('aria-label', b.name);
      btn.innerHTML = b.label + (b.sub ? '<span class="sub">' + b.sub + '</span>' : '');
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        btn.classList.add('held');
        pressControl(b.name, true);
      });
      const release = e => {
        if (!btn.classList.contains('held')) return;
        e.preventDefault();
        btn.classList.remove('held');
        pressControl(b.name, false);
      };
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', e => e.preventDefault());
      g.appendChild(btn);
    });
    touchControls.appendChild(g);
  });
  touchControls.hidden = false;
}

function clearTouchControls() {
  touchControls.innerHTML = '';
  touchControls.hidden = true;
}

/* ─── Build selector UI (search + favorites + recent + unified bests) ─── */
function getFavs() { try { return JSON.parse(localStorage.getItem('frost-arcade:favs') || '[]'); } catch (e) { return []; } }
function toggleFav(id) {
  let f = getFavs();
  f = f.includes(id) ? f.filter((x) => x !== id) : f.concat([id]);
  try { localStorage.setItem('frost-arcade:favs', JSON.stringify(f)); } catch (e) { /* ignore */ }
  renderSelector();
}
function getRecent() { try { return JSON.parse(localStorage.getItem('frost-arcade:recent') || '[]'); } catch (e) { return []; } }
function pushRecent(id) {
  try {
    let r = getRecent().filter((x) => x !== id);
    r.unshift(id); r = r.slice(0, 5);
    localStorage.setItem('frost-arcade:recent', JSON.stringify(r));
  } catch (e) { /* ignore */ }
}
function getBest(id) {
  try {
    if (id === 'breakout') {
      const a = parseInt(localStorage.getItem('frost-arcade:breakout:best'), 10) || 0;
      const b = parseInt(localStorage.getItem('frost-breakout:best'), 10) || 0;
      let meta = 0;
      try { const m = JSON.parse(localStorage.getItem('frost-breakout:meta') || '{}'); meta = m.bestScore || 0; } catch (e) { /* ignore */ }
      return Math.max(a, b, meta);
    }
    return FrostShared.getBestScore(id) || 0;
  } catch (e) { return 0; }
}
let arcadeFilter = 'all';
let arcadeQuery = '';
function renderSelector() {
  const favs = getFavs();
  const recent = getRecent();
  const grid = selector.querySelector('.selector-grid');
  let list = GAMES.slice();
  if (arcadeQuery) {
    const q = arcadeQuery.toLowerCase();
    list = list.filter((g) => (g.name + ' ' + g.desc).toLowerCase().includes(q));
  }
  if (arcadeFilter === 'fav') list = list.filter((g) => favs.includes(g.id));
  if (arcadeFilter === 'recent') list = list.slice().sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id)).filter((g) => recent.includes(g.id));
  grid.innerHTML = list.length ? list.map((g) => {
    const best = getBest(g.id);
    const isFav = favs.includes(g.id);
    const ri = recent.indexOf(g.id);
    return '<button class="game-card" data-id="' + g.id + '" tabindex="0">'
      + '<span class="fav' + (isFav ? ' on' : '') + '" data-fav="' + g.id + '" title="Favorite">★</span>'
      + '<span class="game-icon">' + g.icon + '</span>'
      + '<span class="game-name">' + g.name + '</span>'
      + '<span class="game-desc">' + g.desc + '</span>'
      + (best ? '<span class="game-best">BEST ' + best.toLocaleString() + '</span>' : '')
      + (ri >= 0 ? '<span class="game-recent">recently played</span>' : '')
      + '</button>';
  }).join('') : '<p class="arcade-meta">No games match.</p>';

  grid.querySelectorAll('.game-card').forEach((card) => {
    card.addEventListener('click', (e) => {
      const f = e.target.closest('[data-fav]');
      if (f) { e.stopPropagation(); toggleFav(f.dataset.fav); return; }
      pushRecent(card.dataset.id);
      loadGame(card.dataset.id);
    });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { pushRecent(card.dataset.id); loadGame(card.dataset.id); } });
  });
  const meta = document.getElementById('arcadeMeta');
  if (meta) {
    const totalBest = GAMES.reduce((s, g) => s + getBest(g.id), 0);
    meta.textContent = GAMES.length + ' games · ' + favs.length + ' favorites · combined best ' + totalBest.toLocaleString();
  }
}

function showSelector() {
  loadToken++; // invalidate any in-flight load
  if (currentGameModule && currentGameModule.destroy) {
    try { currentGameModule.destroy(); } catch (e) { /* ignore */ }
    currentGameModule = null;
  }
  currentGame = null;
  clearTouchControls();
  gameHost.innerHTML = '';
  gameHost.hidden = true;
  selector.hidden = false;
  shell.classList.remove('game-active');
  if (btnBack) btnBack.hidden = true;
  renderSelector();
}

/* ─── Load a game module ─── */
async function loadGame(id) {
  const meta = GAMES.find(g => g.id === id);
  if (!meta) return;

  if (meta.standalone) {
    window.location.href = meta.path;
    return;
  }

  const token = ++loadToken;
  /* unload previous */
  if (currentGameModule && currentGameModule.destroy) {
    try { currentGameModule.destroy(); } catch (e) { /* ignore */ }
    currentGameModule = null;
  }
  currentGame = id;

  gameHost.innerHTML = '<div class="loading">Loading ' + meta.name + '…</div>';
  selector.hidden = true;
  gameHost.hidden = false;
  shell.classList.add('game-active');
  if (btnBack) btnBack.hidden = false;

  try {
    const mod = await import(meta.path + '?v=' + Date.now());
    if (token !== loadToken) return; // a newer load (or back) superseded this one
    currentGameModule = mod.default || mod;
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    gameHost.innerHTML = '';
    gameHost.appendChild(canvas);
    currentGameModule.init(canvas, FrostShared);
    buildTouchControls(id);
    /* Space/arrows must reach the game, not re-trigger the focused card */
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  } catch (e) {
    if (token !== loadToken) return;
    console.error('Failed to load ' + id, e);
    gameHost.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'load-error';
    err.textContent = 'Failed to load ' + meta.name + ': ' + e.message;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Back to games';
    btn.addEventListener('click', showSelector);
    err.appendChild(document.createElement('br'));
    err.appendChild(btn);
    gameHost.appendChild(err);
  }
}

/* ─── Global controls ─── */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    const rq = shell && (shell.requestFullscreen || shell.webkitRequestFullscreen);
    if (rq) {
      try {
        const ret = rq.call(shell);
        if (ret && ret.catch) ret.catch(() => {});
      } catch (e) { /* unsupported */ }
    }
  } else if (document.exitFullscreen) {
    document.exitFullscreen();
  }
}

function toggleMute() {
  const next = !FrostShared.isMuted();
  FrostShared.setMuted(next);
  btnSound.querySelector('.ico-sound').textContent = next ? '🔇' : '🔊';
  btnSound.setAttribute('aria-pressed', next);
}

function togglePause() {
  if (currentGameModule && currentGameModule.togglePause) {
    currentGameModule.togglePause();
  }
}

if (btnBack) btnBack.addEventListener('click', showSelector);
btnFullscreen.addEventListener('click', toggleFullscreen);
btnSound.addEventListener('click', toggleMute);
btnPause.addEventListener('click', togglePause);

/* ─── Global settings panel (one store for every game) ─── */
const btnSettings = document.getElementById('btnSettings');
const settingsOverlay = document.getElementById('settings-overlay');
function syncMuteIcon() {
  const m = FrostShared.isMuted();
  btnSound.querySelector('.ico-sound').textContent = m ? '🔇' : '🔊';
  btnSound.setAttribute('aria-pressed', String(m));
}
function renderSettingsPanel() {
  const s = FrostShared.getSettings();
  const d = document.getElementById('setDifficulty'); if (d) d.value = s.difficulty;
  const v = document.getElementById('setVolume'); if (v) v.value = s.volume;
  const vv = document.getElementById('setVolumeVal'); if (vv) vv.textContent = Math.round(s.volume * 100) + '%';
  const sh = document.getElementById('setShake'); if (sh) sh.checked = !!s.shake;
  const pa = document.getElementById('setParticles'); if (pa) pa.checked = !!s.particles;
  const fl = document.getElementById('setFlash'); if (fl) fl.checked = !!s.flash;
}
if (btnSettings) btnSettings.addEventListener('click', () => {
  renderSettingsPanel();
  if (settingsOverlay) settingsOverlay.hidden = false;
});
const btnSettingsClose = document.getElementById('btnSettingsClose');
if (btnSettingsClose) btnSettingsClose.addEventListener('click', () => {
  if (settingsOverlay) settingsOverlay.hidden = true;
});
if (settingsOverlay) settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) settingsOverlay.hidden = true;
});
const setDifficulty = document.getElementById('setDifficulty');
if (setDifficulty) setDifficulty.addEventListener('change', () => {
  FrostShared.saveSettings({ difficulty: setDifficulty.value });
});
const setVolume = document.getElementById('setVolume');
if (setVolume) setVolume.addEventListener('input', () => {
  FrostShared.saveSettings({ volume: parseFloat(setVolume.value) });
  const vv = document.getElementById('setVolumeVal');
  if (vv) vv.textContent = Math.round(parseFloat(setVolume.value) * 100) + '%';
});
[['setShake', 'shake'], ['setParticles', 'particles'], ['setFlash', 'flash']].forEach(([id, key]) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    FrostShared.saveSettings({ [key]: el.checked });
  });
});

document.addEventListener('fullscreenchange', () => {
  fullscreen = !!document.fullscreenElement;
  btnFullscreen.querySelector('.ico-fullscreen').textContent = fullscreen ? '↙' : '↗';
  btnFullscreen.setAttribute('aria-pressed', fullscreen);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (fullscreen) { document.exitFullscreen(); return; }
    if (currentGameModule && currentGameModule.togglePause) togglePause();
  }
  if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  if (e.key === 'm' || e.key === 'M') toggleMute();
});

/* ─── Boot ─── */
function boot() {
  /* AudioContext needs a user gesture — arm it on first interaction. */
  const unlock = () => FrostShared.unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  const search = document.getElementById('arcadeSearch');
  if (search) search.addEventListener('input', () => { arcadeQuery = search.value || ''; renderSelector(); });
  syncMuteIcon();
  document.querySelectorAll('.arcade-filters .chip-btn').forEach((b) => {
    b.addEventListener('click', () => {
      arcadeFilter = b.dataset.filter || 'all';
      document.querySelectorAll('.arcade-filters .chip-btn').forEach((x) => x.classList.toggle('active', x === b));
      renderSelector();
    });
  });
  // deep link ?game=pong
  try {
    const q = new URLSearchParams(location.search);
    const g = q.get('game');
    if (g && GAMES.some((x) => x.id === g)) { renderSelector(); pushRecent(g); loadGame(g); return; }
  } catch (e) { /* ignore */ }
  renderSelector();
  selector.hidden = false;
  gameHost.hidden = true;
  shell.classList.remove('game-active');
  if (btnBack) btnBack.hidden = true;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

window.FrostShell = { GAMES, loadGame, showSelector };
export { GAMES, loadGame, showSelector };