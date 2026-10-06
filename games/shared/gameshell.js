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
];

let currentGame = null;
let currentGameModule = null;
let fullscreen = false;
let loadToken = 0; // guards against overlapping loads resolving out of order

const shell = document.getElementById('shell');
const selector = document.getElementById('game-selector');
const gameHost = document.getElementById('game-host');
const btnBack = document.getElementById('btnBack');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnSound = document.getElementById('btnSound');
const btnPause = document.getElementById('btnPause');

/* ─── Build selector UI ─── */
function renderSelector() {
  selector.querySelector('.selector-grid').innerHTML = GAMES.map(g => `
    <button class="game-card" data-id="${g.id}" tabindex="0">
      <span class="game-icon">${g.icon}</span>
      <span class="game-name">${g.name}</span>
      <span class="game-desc">${g.desc}</span>
    </button>
  `).join('');

  selector.querySelectorAll('.game-card').forEach(card => {
    card.addEventListener('click', () => loadGame(card.dataset.id));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') loadGame(card.dataset.id); });
  });
}

function showSelector() {
  loadToken++; // invalidate any in-flight load
  if (currentGameModule && currentGameModule.destroy) {
    try { currentGameModule.destroy(); } catch (e) { /* ignore */ }
    currentGameModule = null;
  }
  currentGame = null;
  gameHost.innerHTML = '';
  gameHost.hidden = true;
  selector.hidden = false;
  shell.classList.remove('game-active');
  if (btnBack) btnBack.hidden = true;
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