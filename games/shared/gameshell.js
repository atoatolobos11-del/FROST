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
  { id: 'pong', name: 'Frost Pong', desc: 'Neon paddle duel — local 2P or vs AI', icon: '🏓', path: 'games/frost-pong/game.js' },
  { id: 'snake', name: 'Frost Snake', desc: 'Grid arena, frost trails, power-ups, obstacles', icon: '🐍', path: 'games/frost-snake/game.js' },
  { id: 'asteroids', name: 'Frost Asteroids', desc: 'Twin-stick shooter, bosses, power-ups', icon: '☄️', path: 'games/frost-asteroids/game.js' },
  { id: 'pinball', name: 'Frost Pinball', desc: 'Full table — flippers, bumpers, ramps, multiball', icon: '🎱', path: 'games/frost-pinball/game.js' },
];

let currentGame = null;
let currentGameModule = null;
let fullscreen = false;

const shell = document.getElementById('shell');
const selector = document.getElementById('game-selector');
const gameHost = document.getElementById('game-host');
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

/* ─── Load a game module ─── */
async function loadGame(id) {
  const meta = GAMES.find(g => g.id === id);
  if (!meta) return;

  /* unload previous */
  if (currentGameModule && currentGameModule.destroy) {
    currentGameModule.destroy();
    currentGameModule = null;
  }
  currentGame = id;

  if (meta.standalone) {
    window.location.href = meta.path;
    return;
  }

  gameHost.innerHTML = '<div class="loading">Loading ' + meta.name + '…</div>';
  selector.hidden = true;
  gameHost.hidden = false;
  shell.classList.add('game-active');

  try {
    const mod = await import(meta.path + '?v=' + Date.now());
    currentGameModule = mod.default || mod;
    const canvas = document.createElement('canvas');
    canvas.id = 'game-canvas';
    gameHost.innerHTML = '';
    gameHost.appendChild(canvas);
    currentGameModule.init(canvas, FrostShared);
  } catch (e) {
    console.error('Failed to load ' + id, e);
    gameHost.innerHTML = `<div class="load-error">Failed to load ${meta.name}<br><button onclick="location.reload()">Reload</button></div>`;
  }
}

/* ─── Global controls ─── */
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    shell.requestFullscreen().catch(() => {});
  } else {
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
  FrostShared.unlockAudio();
  renderSelector();
  selector.hidden = false;
  gameHost.hidden = true;
  shell.classList.remove('game-active');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { GAMES, loadGame };