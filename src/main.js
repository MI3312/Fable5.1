// Entry point
import { Game } from './game/game.js';

function fail(msg) {
  const ui = document.getElementById('ui');
  ui.innerHTML = `<div class="overlay" style="pointer-events:auto"><div class="dialog"><div class="dh">Cannot start the dream</div><div class="db">${msg}</div></div></div>`;
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch (e) { return false; }
}

if (!hasWebGL2()) {
  fail('LUCID SKY needs a browser with WebGL2 support (a recent Chrome, Edge, Firefox or Safari).');
} else {
  try {
    const game = new Game(document.getElementById('game'), document.getElementById('ui'));
    window.__game = game;
  } catch (e) {
    console.error(e);
    fail('Something went wrong while starting: ' + (e && e.message ? e.message : e));
  }
}
