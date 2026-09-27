// The Dream Line: a luminous tether the multi-tool casts into water, magma, acid or dreaming pools.
// Cast (LMB), wait for the bobber to dip, hook it (LMB within a second), then reel: hold LMB to
// pull, ease off when the fish surges or the line snaps. What bites depends on the liquid, the hour,
// the weather and how far out you cast.
import * as THREE from 'three';
import { FISH } from '../data/food.js';
import { ITEMS } from '../data/items.js';
import { B, IS_LIQUID } from '../world/blocks.js';
import { voxelUniforms } from '../world/voxelMaterial.js';
import { castShadows } from '../world/shadows.js';
import { h } from '../ui/dom.js';

const LIQ = { [B.WATER]: 'water', [B.DREAM_WATER]: 'dream', [B.LAVA]: 'lava', [B.ACID]: 'acid' };
const LIQ_COL = { water: [0.7, 0.85, 1], dream: [1, 0.7, 0.9], lava: [1, 0.55, 0.2], acid: [0.7, 1, 0.3] };
const RANGE = 22;
const SEG = 28, RAD = 3;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _t = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3();

// A thin glowing tube along a sagging curve (WebGL lines are always 1px, which vanishes at distance)
function makeLine() {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array((SEG + 1) * RAD * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const idx = [];
  for (let i = 0; i < SEG; i++) for (let r = 0; r < RAD; r++) {
    const a = i * RAD + r, b = i * RAD + (r + 1) % RAD, c = a + RAD, d = b + RAD;
    idx.push(a, c, b, b, c, d);
  }
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 2.2, 1.9), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.visible = false;
  return mesh;
}

function makeBobber() {
  const g = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.4, 2.2) }));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.5, 0.7) }));
  cap.position.y = 0.01;
  g.add(orb, cap);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 32), new THREE.MeshBasicMaterial({ color: 0xcffff4, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 2;
  g.visible = ring.visible = false;
  return { g, ring };
}

// a small procedural catch to fling back at you
function buildCatch(id) {
  const f = FISH[id] || { size: 0.4, shape: 'slim' };
  const col = new THREE.Color(ITEMS[id] ? ITEMS[id].color : '#aaccff');
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, metalness: 0.2, emissive: col.clone().multiplyScalar(0.18) });
  const g = new THREE.Group();
  const s = f.size;
  if (f.shape === 'doll') {
    const pale = new THREE.MeshStandardMaterial({ color: 0xd8cfc4, roughness: 0.9 });
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), pale); head.position.y = 0.22;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.26, 8), new THREE.MeshStandardMaterial({ color: 0x5a4e58, roughness: 1 }));
    body.position.y = 0.05;
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x050505 });
    for (const x of [-0.04, 0.04]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), eyeM); e.position.set(x, 0.24, 0.095); g.add(e); }
    g.add(head, body);
    return g;
  }
  if (f.shape === 'junk') {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.5, 1), mat);
    m.scale.set(1, 0.6, 0.8);
    g.add(m);
    return g;
  }
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), mat);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.4, 4), mat);
  tail.rotation.z = Math.PI / 2;
  if (f.shape === 'eel') { body.scale.set(2.4 * s, 0.22 * s, 0.22 * s); tail.position.x = -1.3 * s; tail.scale.setScalar(s * 0.6); }
  else if (f.shape === 'ray') { body.scale.set(0.9 * s, 0.14 * s, 1.1 * s); tail.position.x = -0.55 * s; tail.scale.set(s * 0.4, s * 1.6, s * 0.4); }
  else { body.scale.set(1.1 * s, 0.5 * s, 0.3 * s); tail.position.x = -0.7 * s; tail.scale.set(s, s, s * 0.4); }
  g.add(body, tail);
  if (f.shape === 'angler') {
    const lure = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2.4, 3) }));
    lure.position.set(0.55 * s, 0.45 * s, 0);
    g.add(lure);
  }
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04 * Math.max(0.6, s), 8, 6), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
  eye.position.set(0.38 * s, 0.08 * s, 0.1 * s);
  g.add(eye);
  return g;
}

export class Fishing {
  constructor(surface) {
    this.S = surface;
    this.state = 'idle';
    this.line = makeLine();
    const bob = makeBobber();
    this.bobber = bob.g;
    this.ring = bob.ring;
    surface.scene.add(this.line, this.bobber, this.ring);
    this.pos = new THREE.Vector3();     // bobber
    this.cast = new THREE.Vector3();    // where it landed
    this.from = new THREE.Vector3();    // muzzle at cast time
    this.surfaceY = 0;
    this.liquid = 'water';
    this.t = 0;
    this.tension = 0;
    this.progress = 0;
    this.surge = 0;
    this.fish = null;
    this.flying = null;
    this.ui = null;
  }

  get bobberOut() { return this.state !== 'idle' && this.bobber.visible ? this.pos : null; }

  _ui() {
    if (this.ui) return this.ui;
    const hud = this.S.game.hud;
    const title = h('div', { class: 'fish-title' }, 'Something is on the line');
    const tfill = h('div', { class: 'fill' }), pfill = h('div', { class: 'fill' });
    const el = h('div', { class: 'fish-ui' }, title,
      h('div', { class: 'fish-row' }, h('span', {}, 'Tension'), h('div', { class: 'fish-bar tension' }, tfill)),
      h('div', { class: 'fish-row' }, h('span', {}, 'Reel'), h('div', { class: 'fish-bar reel' }, pfill)),
      h('div', { class: 'fish-hint' }, 'Hold LMB to reel · ease off when it pulls'));
    el.style.display = 'none';
    (hud.root || document.body).appendChild(el);
    this.ui = { el, title, tfill, pfill };
    return this.ui;
  }

  _roll() {
    const S = this.S, g = S.game;
    const night = (S.daylight ?? 1) < 0.25;
    const dusk = !night && (S.daylight ?? 1) < 0.7;
    const far = Math.hypot(this.cast.x - g.player.pos.x, this.cast.z - g.player.pos.z) > 12;
    const pool = [];
    for (const [id, f] of Object.entries(FISH)) {
      if (f.liquid !== this.liquid) continue;
      if (f.when === 'day' && night) continue;
      if (f.when === 'night' && !night) continue;
      if (f.dread && (S.interior || S.pocket)) continue;
      let w = f.w;
      if (f.deep && far) w *= 2.2;
      if (f.dusk && dusk) w *= f.dusk;
      if (f.shape === 'junk' && far) w *= 0.5;
      if (f.dread && g.state.flags.dollCaught) w *= 0.4;
      pool.push([id, w]);
    }
    if (!pool.length) return 'dream_minnow';
    let sum = 0;
    for (const p of pool) sum += p[1];
    let r = Math.random() * sum;
    for (const p of pool) { r -= p[1]; if (r <= 0) return p[0]; }
    return pool[0][0];
  }

  // ctx: { lmbHit, lmbDown, origin, dir, muzzle }
  update(dt, ctx) {
    const S = this.S, g = S.game;
    this.t += dt;
    const ui = this._ui();
    ui.el.style.display = this.state === 'reel' && !g.menus.open ? '' : 'none';
    switch (this.state) {
      case 'idle':
        if (ctx.lmbHit) this._tryCast(ctx);
        break;
      case 'cast': {
        const k = Math.min(1, this.t / this.castDur);
        this.pos.lerpVectors(this.from, this.cast, k);
        this.pos.y += Math.sin(k * Math.PI) * (2 + this.castDur * 3);
        if (k >= 1) this._land();
        break;
      }
      case 'wait': {
        this.pos.copy(this.cast);
        this.pos.y = this.surfaceY + Math.sin(this.t * 2.2) * 0.035;
        // a couple of teasing nibbles before the real bite
        if (this.waitT < 2.2 && !this.nibbled && Math.random() < dt * 1.2) {
          this.nibbled = true; this.dip = 0.08;
          g.audio.tone(900, 0.04, 'sine', 0.03);
        }
        this.waitT -= dt;
        if (ctx.lmbHit) { this._reelIn('You reel the line in.'); break; }
        if (this.waitT <= 0) this._bite();
        break;
      }
      case 'bite': {
        this.pos.copy(this.cast);
        this.pos.y = this.surfaceY - 0.22 + Math.sin(this.t * 30) * 0.05;
        this.biteT -= dt;
        if (Math.random() < dt * 12) S.debris.spawn(this.pos.clone().add(_v.set(0, 0.2, 0)), LIQ_COL[this.liquid], 1, 1.4, 0.4, this.liquid !== 'water');
        if (ctx.lmbHit) this._hook();
        else if (this.biteT <= 0) {
          g.hud.setCenter('It slipped the hook', '#bfe8ff'); S.centerT = 1.4;
          this.state = 'wait'; this.t = 0; this.waitT = 3 + Math.random() * 6; this.nibbled = false;
        }
        break;
      }
      case 'reel': this._reel(dt, ctx); break;
      case 'retract': {
        const k = Math.min(1, this.t / 0.35);
        this.pos.lerpVectors(this.cast, ctx.muzzle, k * k);
        if (k >= 1) this._idle();
        break;
      }
      default: break;
    }
    // a line that goes too far snaps
    if (this.state === 'wait' || this.state === 'bite' || this.state === 'reel') {
      if (g.player.pos.distanceTo(this.pos) > RANGE + 6 || g.inShip) this._snap('The line pulled taut and snapped.');
    }
    this.dip = Math.max(0, (this.dip || 0) - dt * 0.4);
    this._draw(dt, ctx);
    this._updateCatch(dt);
  }

  _tryCast(ctx) {
    const S = this.S, g = S.game, W = S.world;
    const hit = W.raycast(ctx.origin, ctx.dir, RANGE, { ignoreLiquid: false });
    if (!hit || !IS_LIQUID[hit.id]) {
      g.hud.setCenter(hit ? 'Cast into water, magma or acid' : 'Too far to cast', '#bfe8ff'); S.centerT = 1.2;
      return;
    }
    // the top of this body of liquid
    let y = hit.y;
    while (IS_LIQUID[W.getBlock(hit.x, y + 1, hit.z)] && y < hit.y + 16) y++;
    this.liquid = LIQ[hit.id] || 'water';
    this.surfaceY = y + 0.9;
    this.cast.set(hit.point.x, this.surfaceY, hit.point.z);
    this.from.copy(ctx.muzzle);
    this.castDur = 0.35 + Math.min(0.6, this.from.distanceTo(this.cast) / 30);
    this.state = 'cast'; this.t = 0;
    this.bobber.visible = true;
    g.audio.tone(1300, 0.18, 'sine', 0.05, 0.4);
    S.recoil = 0.6;
  }

  _land() {
    const S = this.S, g = S.game;
    this.state = 'wait'; this.t = 0; this.nibbled = false;
    const wet = voxelUniforms.uWet.value;
    const base = this.liquid === 'dream' ? 0.8 : this.liquid === 'lava' ? 1.25 : 1;
    this.waitT = (3 + Math.random() * 7) * base * (1 - wet * 0.35);
    this.fish = this._roll();
    S.debris.spawn(this.cast.clone(), LIQ_COL[this.liquid], 10, 2.2, 0.7, this.liquid !== 'water');
    g.audio.splash();
    this.ringT = 0;
  }

  _bite() {
    const S = this.S, g = S.game;
    this.state = 'bite'; this.t = 0;
    this.biteT = 1.15;
    const f = FISH[this.fish];
    g.hud.setCenter(f.dread ? '·' : '!', f.dread ? '#b8b0b0' : '#fff2a0'); S.centerT = 0.9;
    if (f.dread) g.audio.tone(140, 0.5, 'sine', 0.05, 0.8);
    else { g.audio.splash(); g.audio.tone(700, 0.08, 'square', 0.05, 1.4); }
    S.debris.spawn(this.cast.clone(), LIQ_COL[this.liquid], 14, 3, 0.8, this.liquid !== 'water');
    this.ringT = 0;
    S.recoil = 0.5;
  }

  _hook() {
    const f = FISH[this.fish];
    this.state = 'reel'; this.t = 0;
    this.tension = 0.2; this.progress = 0.22; this.surge = 0; this.surgeT = 0.8 + Math.random();
    this.pull = f.pull;
    this.S.game.audio.tone(420, 0.12, 'triangle', 0.07, 1.6);
    this._ui().title.textContent = f.dread ? 'It is very light' : f.pull > 0.65 ? 'Something heavy is on the line' : 'Something is on the line';
  }

  _reel(dt, ctx) {
    const S = this.S, g = S.game, ui = this._ui();
    // the fish surges in bursts; stronger fish surge harder and more often
    this.surgeT -= dt;
    if (this.surgeT <= 0) {
      if (this.surge > 0.5) { this.surge = 0; this.surgeT = 0.8 + Math.random() * (2.4 - this.pull * 1.4); }
      else { this.surge = 0.6 + this.pull * 0.5 + Math.random() * 0.2; this.surgeT = 0.5 + Math.random() * 0.9 * (0.5 + this.pull); g.audio.splash(); }
    }
    const surging = this.surge > 0.5;
    if (ctx.lmbDown) {
      this.progress += dt * (0.2 - (surging ? 0.14 : 0) + (1 - this.pull) * 0.08);
      this.tension += dt * (0.18 + (surging ? this.surge * this.pull * 1.25 : 0));
      if (Math.random() < dt * 8) g.audio.tone(200 + this.tension * 300, 0.04, 'triangle', 0.02);
    } else {
      this.tension -= dt * 0.55;
      this.progress -= dt * (surging ? 0.1 : 0.03) * (0.4 + this.pull);
    }
    this.tension = Math.max(0, this.tension);
    // the fish ploughs toward you across the surface, thrashing side to side when it surges
    const home = _v.set(g.player.pos.x, this.surfaceY, g.player.pos.z);
    this.pos.lerpVectors(this.cast, home, Math.min(0.85, this.progress * 0.85));
    _w.subVectors(home, this.cast).setY(0).normalize();
    const side = Math.sin(this.t * (surging ? 9 : 2.5)) * (surging ? 1.1 : 0.3);
    this.pos.x += -_w.z * side; this.pos.z += _w.x * side;
    this.pos.y = this.surfaceY - 0.1 + Math.sin(this.t * 14) * 0.05 * (surging ? 1 : 0.3);
    // keep the fish in the liquid: if it would come out onto land, hold it at the shore
    const W = S.world;
    if (!IS_LIQUID[W.getBlock(this.pos.x, this.surfaceY - 0.5, this.pos.z)] && this.progress < 0.99) {
      this.pos.copy(this.lastWet || this.cast);
    } else this.lastWet = (this.lastWet || new THREE.Vector3()).copy(this.pos);
    if (surging && Math.random() < dt * 14) S.debris.spawn(this.pos.clone().add(_n.set(0, 0.15, 0)), LIQ_COL[this.liquid], 2, 2, 0.5, this.liquid !== 'water');
    S.recoil = Math.max(S.recoil, this.tension * 0.35 + (surging && ctx.lmbDown ? 0.25 : 0));
    ui.tfill.style.width = `${Math.min(100, this.tension * 100)}%`;
    ui.tfill.style.background = this.tension > 0.75 ? '#ff5a4a' : this.tension > 0.5 ? '#ffc05a' : '#8fffd0';
    ui.pfill.style.width = `${Math.max(0, Math.min(100, this.progress * 100))}%`;
    ui.el.classList.toggle('surge', surging);
    if (this.tension >= 1) this._snap('The line snapped!');
    else if (this.progress <= 0) { g.hud.setCenter('It got away', '#bfe8ff'); S.centerT = 1.4; this._reelIn(); }
    else if (this.progress >= 1) this._caught();
  }

  _caught() {
    const S = this.S, g = S.game;
    const id = this.fish, f = FISH[id], it = ITEMS[id];
    const cm = Math.round(f.size * 60 * (0.7 + Math.random() * 0.6));
    const added = g.inventory.add(id, 1);
    // throw it to the angler
    const mesh = buildCatch(id);
    castShadows(mesh);
    mesh.position.copy(this.pos);
    S.scene.add(mesh);
    this.flying = { mesh, from: this.pos.clone(), t: 0 };
    S.debris.spawn(this.pos.clone(), LIQ_COL[this.liquid], 22, 3.5, 0.9, this.liquid !== 'water');
    g.audio.splash();
    const log = g.state.fishLog || (g.state.fishLog = {});
    const rec = log[id] || (log[id] = { n: 0, best: 0 });
    rec.n++;
    const best = cm > rec.best;
    rec.best = Math.max(rec.best, cm);
    if (f.dread) {
      g.state.flags.dollCaught = (g.state.flags.dollCaught || 0) + 1;
      g.hud.setCenter('It was not there when you cast.', '#cfc6c0'); S.centerT = 3;
      g.audio.whisper(0.06, 0);
      if (S.horror) S.horror.dread = Math.min(1, S.horror.dread + 0.25);
    } else {
      g.hud.toast(`Caught: ${it.name}`, `${f.shape === 'junk' ? '' : cm + ' cm · '}${rec.n === 1 ? 'first catch!' : best ? 'personal best!' : `${rec.n} caught`}`);
      g.audio.discover();
    }
    if (added < 1) g.hud.notify('Exosuit inventory full');
    if (S.planet) g.missions.event('fish', { planet: S.planet.id, id });
    this.bobber.visible = false;
    this._idle(true);
  }

  _snap(msg) {
    const S = this.S, g = S.game;
    g.hud.setCenter(msg, '#ff9f9f'); S.centerT = 1.4;
    g.audio.tone(1800, 0.12, 'square', 0.05, 0.3);
    this._idle();
  }

  _reelIn(msg) {
    if (msg) { this.S.game.hud.notify(msg); }
    this.state = 'retract'; this.t = 0;
    this.cast.copy(this.pos);
    this.S.game.audio.tone(900, 0.15, 'sine', 0.04, 0.6);
  }

  _idle(keepLine) {
    this.state = 'idle'; this.t = 0;
    this.bobber.visible = false; this.ring.visible = false;
    if (!keepLine) this.line.visible = false;
    if (this.ui) this.ui.el.style.display = 'none';
    this.tension = 0; this.progress = 0;
  }

  cancel() {
    if (this.state !== 'idle') this._idle();
    if (this.flying) { this.flying.t = 1; this._updateCatch(0); }
  }

  _updateCatch(dt) {
    const F = this.flying;
    if (!F) return;
    const g = this.S.game;
    F.t += dt / 0.7;
    const to = _b.copy(g.player.pos); to.y += 1.3;
    const k = Math.min(1, F.t);
    F.mesh.position.lerpVectors(F.from, to, k);
    F.mesh.position.y += Math.sin(k * Math.PI) * 2.2;
    F.mesh.rotation.z = Math.sin(F.t * 30) * 0.5;
    F.mesh.rotation.y += dt * 6;
    if (k >= 1) {
      F.mesh.removeFromParent();
      F.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      this.flying = null;
      g.audio.pickup();
    }
  }

  // the glowing tether from the multi-tool's muzzle to the bobber, sagging when slack
  _draw(dt, ctx) {
    const out = this.state !== 'idle' || (this.flying && this.flying.t < 1);
    this.line.visible = out && this.state !== 'idle';
    this.bobber.visible = this.state !== 'idle';
    if (!this.line.visible) { this.ring.visible = false; return; }
    const a = ctx.muzzle, b = this.pos;
    const slack = this.state === 'reel' ? (1 - Math.min(1, this.tension * 1.4)) * 0.6 : this.state === 'cast' ? 0.2 : 1;
    const dist = a.distanceTo(b);
    const sag = dist * 0.12 * slack;
    const P = this.line.geometry.attributes.position;
    const arr = P.array;
    const pts = this._pts || (this._pts = Array.from({ length: SEG + 1 }, () => new THREE.Vector3()));
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      const p = pts[i].lerpVectors(a, b, u);
      p.y -= Math.sin(u * Math.PI) * sag;
      if (this.state === 'reel') p.y += Math.sin(u * Math.PI * 3 + this.t * 40) * 0.015 * this.tension;
    }
    const r = 0.012 + (this.state === 'reel' ? this.tension * 0.01 : 0);
    for (let i = 0; i <= SEG; i++) {
      const p = pts[i];
      _t.subVectors(pts[Math.min(SEG, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      _n.set(0, 1, 0).cross(_t);
      if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
      _n.normalize();
      _b.crossVectors(_t, _n);
      for (let k = 0; k < RAD; k++) {
        const ang = (k / RAD) * Math.PI * 2;
        const c = Math.cos(ang) * r, s = Math.sin(ang) * r;
        const o = (i * RAD + k) * 3;
        arr[o] = p.x + _n.x * c + _b.x * s;
        arr[o + 1] = p.y + _n.y * c + _b.y * s;
        arr[o + 2] = p.z + _n.z * c + _b.z * s;
      }
    }
    P.needsUpdate = true;
    const tense = this.state === 'reel' ? this.tension : 0;
    this.line.material.color.setRGB(0.9 + tense * 1.6, 2.2 - tense * 1.4, 1.9 - tense * 1.5);
    this.bobber.position.copy(b);
    this.bobber.position.y -= this.dip || 0;
    // ripples spreading from the bobber
    const onWater = this.state === 'wait' || this.state === 'bite' || this.state === 'reel';
    this.ring.visible = onWater;
    if (onWater) {
      this.ringT = ((this.ringT || 0) + dt * (this.state === 'bite' ? 2.2 : this.state === 'reel' ? 1.6 : 0.7)) % 1;
      this.ring.position.set(b.x, this.surfaceY + 0.02, b.z);
      this.ring.scale.setScalar(0.6 + this.ringT * 3);
      this.ring.material.opacity = 0.55 * (1 - this.ringT);
    }
  }

  dispose() {
    this._idle();
    for (const o of [this.line, this.bobber, this.ring]) o.removeFromParent();
    if (this.flying) this.flying.mesh.removeFromParent();
    if (this.ui) this.ui.el.remove();
    this.ui = null;
  }
}
