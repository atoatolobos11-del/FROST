/**
 * Frost Breakout — wrapper for the original game to work in Frost Arcade shell.
 * Loads the original script.js and provides init/destroy interface.
 */
export default (function () {
  'use strict';

  let shared = null;
  let canvas = null;
  let ctx = null;
  let gameInstance = null;
  let originalScriptLoaded = false;
  let originalStylesLoaded = false;

  function injectStyles() {
    if (originalStylesLoaded) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '../../style.css';
    document.head.appendChild(link);
    originalStylesLoaded = true;
  }

  function loadOriginalScript() {
    return new Promise((resolve, reject) => {
      if (originalScriptLoaded && window.FrostBreakoutGame) {
        resolve(window.FrostBreakoutGame);
        return;
      }
      const script = document.createElement('script');
      script.src = '../../script.js';
      script.onload = () => {
        originalScriptLoaded = true;
        // The original script runs immediately and creates the game
        // We need to wait for it to be ready
        setTimeout(() => {
          if (window.FrostBreakoutGame) resolve(window.FrostBreakoutGame);
          else reject(new Error('FrostBreakoutGame not exposed'));
        }, 100);
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function init(c, sh) {
    canvas = c;
    shared = sh;
    ctx = canvas.getContext('2d');

    injectStyles();

    // Replace the canvas in the DOM with our shell canvas
    const oldCanvas = document.getElementById('game');
    if (oldCanvas) oldCanvas.remove();

    canvas.id = 'game';
    // The original script expects canvas in #stage
    let stage = document.getElementById('stage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'stage';
      document.body.appendChild(stage);
    }
    stage.innerHTML = '';
    stage.appendChild(canvas);

    // Add other required DOM elements
    ensureDOM();

    loadOriginalScript()
      .then(() => {
        // The original game auto-starts, we need to hook into it
        // For now, the original script runs on load
        shared.unlockAudio();
      })
      .catch(err => {
        console.error('Failed to load Frost Breakout:', err);
        ctx.fillStyle = '#04080f';
        ctx.fillRect(0, 0, 960, 640);
        ctx.fillStyle = '#bae6fd';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Failed to load Frost Breakout', 480, 320);
      });
  }

  function ensureDOM() {
    // The original script expects certain DOM elements
    const ids = ['ovMenu', 'ovPause', 'ovOver', 'ovWin', 'banner', 'touchBar',
                 'uiScore', 'uiLevel', 'uiLevelMax', 'uiLives', 'uiComboChip', 'uiCombo',
                 'btnStart', 'btnResume', 'btnRetry', 'btnPlayAgain', 'btnQuit',
                 'btnMenu2', 'btnMenu3', 'btnQuitGame', 'btnQuitGameOver', 'btnQuitGameWin',
                 'btnSound', 'btnPause', 'btnRestart', 'btnFullscreen',
                 'btnLeft', 'btnFire', 'btnRight',
                 'ovOverScore', 'ovOverLevel', 'ovOverBricks', 'ovOverCombo', 'ovOverBest',
                 'ovWinScore', 'ovWinBricks', 'ovWinCombo', 'ovWinLives', 'ovWinBest'];

    ids.forEach(id => {
      if (!document.getElementById(id)) {
        const el = document.createElement('div');
        el.id = id;
        el.hidden = true;
        document.body.appendChild(el);
      }
    });
  }

  function destroy() {
    // Clean up
    if (window.FrostBreakoutGame && window.FrostBreakoutGame.destroy) {
      window.FrostBreakoutGame.destroy();
    }
    canvas = null;
    ctx = null;
    shared.clearParticles();
  }

  return { init, destroy };
})();