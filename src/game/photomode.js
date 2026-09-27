// Photo mode: the dream holds still while you walk a free camera through it. Depth of field,
// film filters, time of day, field of view and roll, and a PNG of what you frame.
import * as THREE from 'three';
import { clamp } from '../core/rng.js';

export const FILTERS = ['None', 'Noir', 'Vivid', 'Pastel Dream', 'Film', 'Lucid', 'Sepia'];
const _f = new THREE.Vector3(), _r = new THREE.Vector3();

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.pos = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.fov = 70;
    this.focus = 12; this.aperture = 0; this.filter = 0;
    this.el = null;
  }

  toggle() { if (this.active) this.exit(); else this.enter(); }

  enter() {
    const g = this.game, S = g.surface;
    if (g.mode !== 'surface' || !S.active || S.loading) return;
    this.active = true;
    this.pos.copy(g.camera.position);
    const d = g.camera.getWorldDirection(_f);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(clamp(d.y, -1, 1));
    this.roll = 0; this.fov = g.camera.fov;
    this.origin = this.pos.clone();
    this.dayT0 = S.dayT;
    g.hud.show(false);
    S.tool.visible = false;
    g.audio.stopAllLoops();
    g.audio.tone(1200, 0.08, 'square', 0.04);
    this._overlay();
  }

  exit() {
    const g = this.game, S = g.surface, pu = g.post.uniforms;
    this.active = false;
    pu.uDof.value = 0; pu.uFilter.value = 0;
    g.camera.fov = g.settings.fov; g.camera.updateProjectionMatrix();
    g.camera.up.set(0, 1, 0);
    g.hud.show(!g.hudHidden);
    if (this.el) { this.el.remove(); this.el = null; }
    S.camInitAfterPhoto = true;
  }

  _overlay() {
    if (this.el) this.el.remove();
    const el = document.createElement('div');
    el.className = 'photo-ui';
    el.innerHTML = `<div class="pt">PHOTO MODE</div><div class="pv"></div>
      <div class="ph">WASD fly · Space/C up/down · Shift fast · Mouse look · Wheel zoom · Q/E roll<br>
      [ ] time of day · , . focus · ; ' aperture · 1-7 filter · Enter save PNG · H hide this · P exit</div>`;
    document.body.appendChild(el);
    this.el = el;
    this.pv = el.querySelector('.pv');
  }

  update(dt) {
    const g = this.game, S = g.surface, input = g.input, cam = g.camera, pu = g.post.uniforms;
    if (input.rawHit('KeyP') || input.rawHit('Escape')) { this.exit(); return; }
    const locked = input.locked;
    if (locked) {
      const [dx, dy] = input.consumeMouse();
      this.yaw -= dx * 0.002;
      this.pitch = clamp(this.pitch - dy * 0.002, -1.5, 1.5);
    }
    const k = (n) => input.keys.has(n);
    const hit = (n) => input.pressed.has(n);
    const sp = (k('ShiftLeft') || k('ShiftRight') ? 26 : 7) * dt;
    _f.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (k('KeyW')) this.pos.addScaledVector(_f, sp);
    if (k('KeyS')) this.pos.addScaledVector(_f, -sp);
    if (k('KeyA')) this.pos.addScaledVector(_r, -sp);
    if (k('KeyD')) this.pos.addScaledVector(_r, sp);
    if (k('Space')) this.pos.y += sp;
    if (k('KeyC')) this.pos.y -= sp;
    if (k('KeyQ')) this.roll += dt * 0.8;
    if (k('KeyE')) this.roll -= dt * 0.8;
    // stay within a tether of where you stood, and out of the ground
    const off = this.pos.clone().sub(this.origin);
    if (off.length() > 80) this.pos.copy(this.origin).addScaledVector(off.normalize(), 80);
    const gy = S.world.groundAt(this.pos.x, this.pos.z) + 0.6;
    if (this.pos.y < gy && S.world.isSolid(this.pos.x, this.pos.y, this.pos.z)) this.pos.y = gy;
    const wheel = input.consumeWheel();
    if (wheel) this.fov = clamp(this.fov + wheel * 4, 15, 110);
    if (k('BracketLeft')) S.dayT = (S.dayT - dt * 0.05 + 1) % 1;
    if (k('BracketRight')) S.dayT = (S.dayT + dt * 0.05) % 1;
    if (k('Comma')) this.focus = Math.max(0.5, this.focus * (1 - dt * 1.5));
    if (k('Period')) this.focus = Math.min(400, this.focus * (1 + dt * 1.5));
    if (k('Semicolon')) this.aperture = Math.max(0, this.aperture - dt * 1.2);
    if (k('Quote')) this.aperture = Math.min(3, this.aperture + dt * 1.2);
    for (let i = 1; i <= 7; i++) if (hit('Digit' + i)) this.filter = i - 1;
    if (hit('KeyH') && this.el) this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
    if (hit('Enter')) this._save();
    // apply
    cam.position.copy(this.pos);
    cam.fov = this.fov; cam.updateProjectionMatrix();
    cam.up.set(0, 1, 0);
    cam.lookAt(_f.add(this.pos));
    cam.rotateZ(this.roll);
    cam.updateMatrixWorld();
    pu.uDof.value = this.aperture > 0.02 ? 1 : 0;
    pu.uFocus.value = this.focus;
    pu.uAperture.value = this.aperture;
    pu.uFilter.value = this.filter;
    if (this.pv) this.pv.textContent = `${FILTERS[this.filter]} · FOV ${Math.round(this.fov)}° · focus ${this.focus.toFixed(1)}u · aperture ${this.aperture.toFixed(2)} · ${String(Math.floor(S.dayT * 24)).padStart(2, '0')}:${String(Math.floor((S.dayT * 24 % 1) * 60)).padStart(2, '0')}`;
  }

  _save() {
    const g = this.game;
    if (this.el) this.el.style.visibility = 'hidden';
    g.render();
    try {
      const url = g.renderer.domElement.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `lucid-sky-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      g.audio.tone(1800, 0.05, 'square', 0.05);
      g.audio.noiseHit(0.12, 3000, 0.08, 'highpass');
    } catch (e) { console.warn('photo save failed', e); }
    if (this.el) this.el.style.visibility = '';
  }
}
