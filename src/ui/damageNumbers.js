// Floating damage numbers and a hit marker on the crosshair. Continuous damage (the mining beam)
// is gathered per target and shown a few times a second instead of every frame.
import * as THREE from 'three';
import { h } from './dom.js';

const _p = new THREE.Vector3();
const COLORS = { hit: '#ffffff', big: '#ffd36a', kill: '#ff7a6a', glance: '#9aa6b4', heal: '#8fffb0' };

export class DamageNumbers {
  constructor(root) {
    this.root = root;
    this.layer = h('div', { class: 'dmg-layer' });
    this.mark = h('div', { class: 'hitmark' });
    root.appendChild(this.layer);
    root.appendChild(this.mark);
    this.live = [];
    this.pending = new Map(); // target -> { pos, amount, t, kind }
    this.markT = 0;
  }

  // target: any object used as a key; pos: world position (copied)
  add(target, pos, amount, kind = 'hit') {
    if (!(amount > 0.05) && kind !== 'kill') return;
    let q = this.pending.get(target);
    if (!q) { q = { pos: new THREE.Vector3(), amount: 0, t: 0.22, kind: 'hit' }; this.pending.set(target, q); }
    q.pos.copy(pos);
    q.amount += amount;
    if (kind === 'kill' || kind === 'glance') q.kind = kind;
    // a single big blow shows at once
    if (amount >= 8 || kind === 'kill') q.t = 0;
    this.markT = kind === 'kill' ? 0.35 : Math.max(this.markT, 0.12);
    if (kind === 'kill') this.mark.classList.add('kill');
  }

  // a word instead of a number (DODGE, CRIT...)
  text(pos, word, color = '#bff6ff') {
    const el = h('div', { class: 'dmg word', style: { color } }, word);
    this.layer.appendChild(el);
    this.live.push({ el, pos: pos.clone(), t: 0, vx: 0, life: 0.9 });
  }

  _spawn(q) {
    const n = Math.round(q.amount);
    const kind = q.kind === 'hit' && n >= 40 ? 'big' : q.kind;
    const el = h('div', { class: 'dmg ' + kind, style: { color: COLORS[kind] } }, kind === 'glance' && n < 1 ? '✕' : String(Math.max(1, n)));
    this.layer.appendChild(el);
    this.live.push({ el, pos: q.pos.clone(), t: 0, vx: (Math.random() - 0.5) * 1.2, life: kind === 'kill' ? 1.2 : 0.85 });
  }

  update(dt, camera, w, h2) {
    for (const [target, q] of this.pending) {
      q.t -= dt;
      if (q.t <= 0) { this._spawn(q); this.pending.delete(target); }
    }
    this.live = this.live.filter((d) => {
      d.t += dt;
      d.pos.y += dt * (1.6 - d.t * 1.2);
      d.pos.x += d.vx * dt;
      _p.copy(d.pos).project(camera);
      const k = d.t / d.life;
      if (k >= 1 || _p.z > 1) { d.el.remove(); return false; }
      const x = (_p.x * 0.5 + 0.5) * w, y = (-_p.y * 0.5 + 0.5) * h2;
      const s = k < 0.12 ? 1.4 - k * 3.3 : 1;
      d.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${s})`;
      d.el.style.opacity = String(1 - Math.max(0, k - 0.6) / 0.4);
      return true;
    });
    this.markT -= dt;
    this.mark.style.opacity = this.markT > 0 ? '1' : '0';
    if (this.markT <= 0) this.mark.classList.remove('kill');
  }

  clear() {
    for (const d of this.live) d.el.remove();
    this.live = [];
    this.pending.clear();
  }
}
