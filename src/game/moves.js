// The movement kit: the things you can do right now, with no menu in the way.
//   X or double-tap a direction  dash (two charges; one in the air; a perfect dodge while it lasts)
//   C while sprinting            slide (jump out of it to keep the speed)
//   C in the air                 ground pound (a shockwave that hurts what is under you)
//   Space at a ledge             vault up to two blocks
//   RMB (Mining Beam, Dream Line) grapple: a tether that hauls you to where it bites
import * as THREE from 'three';
import { BLOCKS, IS_LIQUID, IS_CROSS, B } from '../world/blocks.js';
import { h } from '../ui/dom.js';

const DASH_SPEED = 26, DASH_TIME = 0.16, DASH_CHARGES = 2, DASH_RECHARGE = 1.2;
const GRAPPLE_RANGE = 50, GRAPPLE_PULL = 58, GRAPPLE_MAX = 30;
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Moves {
  constructor(mode) {
    this.mode = mode;
    this.charges = DASH_CHARGES;
    this.rechargeT = 0;
    this.dashT = 0;
    this.dashDir = new THREE.Vector3();
    this.airDash = false;
    this.slideT = 0;
    this.slideDir = new THREE.Vector3();
    this.pounding = false;
    this.vault = null;
    this.grapple = null;          // { state: 'fly'|'pull', anchor, tip, t }
    this.fov = 0;                 // extra field of view for speed
    this.lastTap = {};
    this.shocks = [];
    // tether and hook
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.4, 2.6) });
    this.tether = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 5, 1, true), tm);
    this.hook = new THREE.Mesh(new THREE.OctahedronGeometry(0.14), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.6, 2.8) }));
    this.tether.visible = this.hook.visible = false;
    this.tether.frustumCulled = false;
    mode.scene.add(this.tether, this.hook);
  }

  get invulnerable() { return this.dashT > 0; }
  get busy() { return this.dashT > 0 || this.slideT > 0 || this.pounding || !!this.vault || (this.grapple && this.grapple.state === 'pull'); }

  reset() {
    const p = this.mode.game.player;
    this.dashT = 0; this.slideT = 0; this.pounding = false; this.vault = null;
    this._release(true);
    p.control = 1; p.gravMul = 1; p.crouch = 0; p.noJet = false; p.frozen = false;
    this.fov = 0;
  }

  // while in the ship, on a mount or in the Roamer: nothing in progress, effects wind down
  off(dt) {
    if (this.busy || this.grapple || this.vault) this.reset();
    const p = this.mode.game.player;
    p.crouch = 0;
    this.fov += (0 - this.fov) * Math.min(1, dt * 5);
    if (this.charges < DASH_CHARGES) { this.rechargeT += dt; if (this.rechargeT >= DASH_RECHARGE) { this.rechargeT = 0; this.charges++; } }
    this._updateShocks(dt);
    this._drawTether();
  }

  // called before the player integrates this frame
  pre(dt, ctl) {
    const g = this.mode.game, p = g.player, input = g.input, W = this.mode.world;
    // charges
    if (this.charges < DASH_CHARGES) {
      this.rechargeT += dt;
      if (this.rechargeT >= DASH_RECHARGE) { this.rechargeT = 0; this.charges++; }
    }
    if (p.onGround) this.airDash = false;
    p.control = 1; p.gravMul = 1; p.noJet = false;
    const wish = this._wish(ctl);

    if (ctl && !this.vault) {
      // dash: X, or a quick double tap of a movement key
      let dashNow = input.hit('KeyX');
      for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD']) {
        if (!input.hit(k)) continue;
        if (g.time - (this.lastTap[k] || -9) < 0.24) dashNow = true;
        this.lastTap[k] = g.time;
      }
      if (dashNow) this._dash(wish);
      // C: slide on the ground at speed, ground pound in the air
      if (input.hit('KeyC')) {
        const hs = Math.hypot(p.vel.x, p.vel.z);
        if (!p.onGround && !p.inWater && this._heightAbove() > 2.2) this._pound();
        else if (p.onGround && hs > 5.2 && this.slideT <= 0) this._slide();
      }
      // grapple: RMB in the Mining Beam or on an idle Dream Line
      const mode = this.mode.toolMode;
      const lineIdle = mode === 3 && this.mode.fishing.state === 'idle';
      if ((mode === 0 || lineIdle) && !this.mode.visor && input.mouseHit(2) && !this.grapple) this._fire();
      if (this.grapple && !input.mouseDown(2) && this.grapple.state === 'pull') this._release();
      // vault: Space against a ledge
      if (!p.inWater && input.down('Space') && wish.lengthSq() > 0 && (p.onGround ? input.hit('Space') : p.vel.y < 6)) this._tryVault(wish);
    }

    // --- dash in progress
    if (this.dashT > 0) {
      this.dashT -= dt;
      p.vel.x = this.dashDir.x * DASH_SPEED; p.vel.z = this.dashDir.z * DASH_SPEED;
      if (p.vel.y < 0) p.vel.y *= 0.5;
      p.control = 0; p.gravMul = 0.15; p.noJet = true;
      if (Math.random() < 0.6) this.mode.debris.spawn(p.pos.clone().add(_v.set(0, 0.9, 0)), [0.6, 0.95, 1], 1, 1, 0.35, true);
      if (this.dashT <= 0) { p.vel.x = this.dashDir.x * 10; p.vel.z = this.dashDir.z * 10; }
    }
    // --- slide
    if (this.slideT > 0) {
      this.slideT -= dt;
      p.control = 0.05;
      const hs = Math.hypot(p.vel.x, p.vel.z);
      const f = Math.pow(0.55, dt);
      p.vel.x *= f; p.vel.z *= f;
      if ((!input.down('KeyC') && this.slideT < 0.55) || hs < 3.5 || (!p.onGround && p.vel.y > 1)) this.slideT = 0;
      if (Math.random() < dt * 30) this.mode.debris.spawn(p.pos.clone().add(this.slideDir.clone().multiplyScalar(0.6)), this._groundColor(), 1, 1.6, 0.4);
    }
    p.crouch += ((this.slideT > 0 ? 1 : 0) - p.crouch) * Math.min(1, dt * 14);
    // --- pound
    if (this.pounding) { p.control = 0; p.noJet = true; p.vel.x *= 0.9; p.vel.z *= 0.9; p.vel.y = -38; }
    // --- vault: a short scripted climb
    if (this.vault) {
      const V = this.vault;
      V.t += dt;
      const k = Math.min(1, V.t / V.dur);
      p.frozen = true;
      p.pos.y = V.from.y + (V.to.y - V.from.y) * Math.sqrt(k);
      const kk = k * k;
      p.pos.x = V.from.x + (V.to.x - V.from.x) * kk;
      p.pos.z = V.from.z + (V.to.z - V.from.z) * kk;
      if (k >= 1) {
        this.vault = null;
        p.frozen = false;
        p.vel.set(V.dir.x * 4.5, 0, V.dir.z * 4.5);
        p.onGround = true;
      }
    }
    // --- grapple
    this._updateGrapple(dt, ctl);
  }

  // called after the player has moved; returns true if a hard landing was absorbed
  post(dt, ev) {
    const g = this.mode.game, p = g.player;
    let absorbed = false;
    if (this.pounding && (p.onGround || p.inWater)) {
      this.pounding = false;
      absorbed = true;
      this._impact();
    }
    const target = (this.dashT > 0 ? 12 : 0) + (this.slideT > 0 ? 7 : 0) + (this.grapple && this.grapple.state === 'pull' ? 9 : 0) + (this.pounding ? 6 : 0);
    this.fov += (target - this.fov) * Math.min(1, dt * (target > this.fov ? 14 : 5));
    this._updateShocks(dt);
    this._drawTether();
    return absorbed;
  }

  // ------------------------------------------------------------------ helpers
  _wish(ctl) {
    const g = this.mode.game, p = g.player, input = g.input;
    let mx = 0, mz = 0;
    if (ctl) {
      if (input.down('KeyW')) mz -= 1;
      if (input.down('KeyS')) mz += 1;
      if (input.down('KeyA')) mx -= 1;
      if (input.down('KeyD')) mx += 1;
    }
    const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
    const v = _d.set(mx * cos + mz * sin, 0, -mx * sin + mz * cos);
    if (v.lengthSq() > 0) v.normalize();
    return v;
  }

  _heightAbove() {
    const p = this.mode.game.player;
    return p.pos.y - this.mode.world.groundBelow(p.pos.x, p.pos.y, p.pos.z) - 1;
  }

  _groundColor() {
    const p = this.mode.game.player;
    const id = this.mode.world.getBlock(p.pos.x, p.pos.y - 0.5, p.pos.z);
    return id > 0 && BLOCKS[id] ? BLOCKS[id].color : [0.6, 0.55, 0.5];
  }

  _dash(wish) {
    const g = this.mode.game, p = g.player;
    if (this.charges <= 0 || this.dashT > 0 || this.vault) return;
    if (!p.onGround) { if (this.airDash) return; this.airDash = true; }
    this.charges--;
    if (this.charges === DASH_CHARGES - 1) this.rechargeT = 0;
    const d = wish.lengthSq() > 0 ? wish : _v.set(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    this.dashDir.copy(d).setY(0).normalize();
    this.dashT = DASH_TIME;
    this.slideT = 0;
    if (!p.onGround) p.vel.y = Math.max(p.vel.y, 1.5);
    g.audio.noiseHit(0.22, 1700, 0.13, 'bandpass', 0.7);
    g.audio.tone(520, 0.14, 'sine', 0.035, 1.8);
  }

  _slide() {
    const g = this.mode.game, p = g.player;
    const hs = Math.hypot(p.vel.x, p.vel.z);
    this.slideDir.set(p.vel.x / hs, 0, p.vel.z / hs);
    const sp = Math.max(hs * 1.35, 11.5);
    p.vel.x = this.slideDir.x * sp; p.vel.z = this.slideDir.z * sp;
    this.slideT = 0.95;
    g.audio.noiseHit(0.55, 450, 0.16, 'lowpass', 0.8);
  }

  _pound() {
    const g = this.mode.game;
    this.pounding = true;
    this.dashT = 0;
    this._release(true);
    g.audio.tone(300, 0.35, 'sawtooth', 0.04, 0.4);
  }

  // Ground pound landing: a shockwave that hurts, throws and breaks soft ground
  _impact() {
    const m = this.mode, g = m.game, p = g.player, W = m.world;
    const c = p.pos.clone();
    m.debris.spawn(c.clone().add(_v.set(0, 0.3, 0)), this._groundColor(), 30, 7, 0.9);
    m.debris.spawn(c.clone().add(_v.set(0, 0.4, 0)), [0.8, 0.95, 1], 14, 5, 0.5, true);
    this.shock(c, 6, [0.75, 0.95, 1]);
    m.flashAt(c.clone().add(_v.set(0, 1, 0)), [0.6, 0.85, 1.2], 0.3);
    m.horror.shake = Math.max(m.horror.shake, 0.45);
    g.audio.explosion(0.55);
    // creatures and drones
    for (const cr of m.creatures.list) {
      if (cr.dead || cr.hidden || cr.companion || cr.ridden) continue;
      const d = cr.pos.distanceTo(c);
      if (d < 5.5) m._damageCreature(cr, 50 * (1 - d / 6.5));
    }
    for (const dr of m.sentinels.list) {
      const d = dr.pos.distanceTo(c);
      if (d < 5.5) m._damageDrone(dr, 40 * (1 - d / 6.5));
    }
    // soft ground gives way
    const home = m.planet && g.bases.baseAt(m.planet.id, c.x, c.z);
    if (home || m.pocket || m.interior) return;
    const cx = Math.floor(c.x), cy = Math.floor(c.y) - 1, cz = Math.floor(c.z);
    let n = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dz * dz > 5 || (dx === 0 && dz === 0)) continue;
      const x = cx + dx, z = cz + dz;
      const id = W.getBlock(x, cy, z);
      const def = BLOCKS[id];
      if (id <= 0 || !def || def.unbreakable || def.interact || IS_LIQUID[id] || def.restricted || def.hardness > 0.6) continue;
      if (Math.random() < 0.45) continue;
      const above = W.getBlock(x, cy + 1, z);
      if (above > 0 && IS_CROSS[above]) W.setBlock(x, cy + 1, z, B.AIR);
      W.setBlock(x, cy, z, B.AIR);
      if (++n >= 7) return;
    }
  }

  _tryVault(dir) {
    const m = this.mode, W = m.world, p = m.game.player;
    if (this.dashT > 0 || this.pounding || this.grapple) return;
    const fx = p.pos.x + dir.x * 0.85, fz = p.pos.z + dir.z * 0.85;
    const by = Math.floor(p.pos.y);
    for (let dy = 0; dy <= 2; dy++) {
      const y = by + dy;
      if (!W.isSolid(fx, y, fz)) continue;
      if (W.isSolid(fx, y + 1, fz) || W.isSolid(fx, y + 2, fz)) return; // the wall goes on up
      const top = y + 1;
      const rise = top - p.pos.y;
      if (rise < 0.45 || rise > 2.6) return;
      // headroom above where we stand, all the way up to the ledge
      for (let yy = Math.floor(p.pos.y) + 2; yy <= top + 1; yy++) if (W.isSolid(p.pos.x, yy, p.pos.z)) return;
      const to = new THREE.Vector3(p.pos.x + dir.x * 1.0, top + 0.02, p.pos.z + dir.z * 1.0);
      if (p.collides(W, to.x, to.y, to.z)) return;
      this.vault = { from: p.pos.clone(), to, t: 0, dur: 0.16 + rise * 0.07, dir: dir.clone() };
      p.vel.set(0, 0, 0);
      m.game.audio.noiseHit(0.14, 520, 0.1, 'lowpass', 1);
      return;
    }
  }

  // ------------------------------------------------------------------ grapple
  _fire() {
    const m = this.mode, g = m.game, cam = g.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const hit = m.world.raycast(cam.position, dir, GRAPPLE_RANGE);
    const from = m._muzzleWorld(cam);
    this.grapple = {
      state: 'fly', t: 0,
      tip: from.clone(),
      anchor: hit ? hit.point.clone().addScaledVector(dir, -0.05) : cam.position.clone().addScaledVector(dir, GRAPPLE_RANGE),
      hit: !!hit,
    };
    g.audio.tone(1500, 0.12, 'square', 0.03, 0.5);
    m.recoil = Math.max(m.recoil, 0.5);
  }

  _release(silent) {
    const G = this.grapple;
    if (!G) return;
    if (G.state === 'pull' && !silent) this.mode.game.audio.tone(700, 0.08, 'triangle', 0.03, 0.6);
    this.grapple = null;
  }

  _updateGrapple(dt, ctl) {
    const G = this.grapple;
    if (!G) return;
    const m = this.mode, g = m.game, p = g.player;
    G.t += dt;
    if (G.state === 'fly') {
      const to = _v.subVectors(G.anchor, G.tip);
      const step = 170 * dt;
      if (to.length() <= step) {
        G.tip.copy(G.anchor);
        if (!G.hit || !g.input.mouseDown(2)) { this._release(true); return; }
        G.state = 'pull'; G.t = 0;
        m.debris.spawn(G.anchor.clone(), [0.7, 1, 1], 6, 2.5, 0.4, true);
        g.audio.tone(900, 0.06, 'square', 0.04, 1.4);
        this.slideT = 0;
      } else G.tip.addScaledVector(to.normalize(), step);
      return;
    }
    // hauling in
    const eye = p.eye;
    const d = _v.subVectors(G.anchor, eye);
    const dist = d.length();
    if (dist < 1.8 || G.t > 3.2 || (ctl && g.input.hit('Space'))) {
      if (ctl && g.input.hit('Space')) p.vel.y = Math.max(p.vel.y, 8);
      else p.vel.y = Math.max(p.vel.y, 5);
      this._release();
      return;
    }
    d.divideScalar(dist);
    p.vel.addScaledVector(d, GRAPPLE_PULL * dt);
    // damp the part of the velocity that isn't taking us there, so it swings in rather than orbiting
    const along = p.vel.dot(d);
    _d.copy(p.vel).addScaledVector(d, -along).multiplyScalar(Math.pow(0.3, dt));
    p.vel.copy(_d).addScaledVector(d, along);
    const sp = p.vel.length();
    if (sp > GRAPPLE_MAX) p.vel.multiplyScalar(GRAPPLE_MAX / sp);
    p.control = 0.3; p.gravMul = 0.25; p.noJet = true;
    p.onGround = false;
  }

  _drawTether() {
    const G = this.grapple;
    this.tether.visible = this.hook.visible = !!G;
    if (!G) return;
    const m = this.mode;
    const from = m._muzzleWorld(m.game.camera);
    const to = G.tip;
    const d = _v.subVectors(to, from);
    const len = d.length();
    this.tether.position.copy(from).addScaledVector(d, 0.5);
    this.tether.scale.set(1, Math.max(0.01, len), 1);
    this.tether.quaternion.setFromUnitVectors(_up, d.normalize());
    this.hook.position.copy(to);
    this.hook.rotation.y += 0.3;
  }

  // ------------------------------------------------------------------ shockwaves (shared with grenades)
  shock(pos, radius, color) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color[0] * 2, color[1] * 2, color[2] * 2), transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 48), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos); ring.position.y += 0.15;
    ring.renderOrder = 4;
    this.mode.scene.add(ring);
    this.shocks.push({ ring, t: 0, radius });
  }

  _updateShocks(dt) {
    this.shocks = this.shocks.filter((s) => {
      s.t += dt / 0.45;
      const k = Math.min(1, s.t);
      s.ring.scale.setScalar(0.3 + s.radius * (1 - (1 - k) * (1 - k)));
      s.ring.material.opacity = 0.8 * (1 - k);
      if (k >= 1) { s.ring.removeFromParent(); s.ring.geometry.dispose(); s.ring.material.dispose(); return false; }
      return true;
    });
  }

  // ------------------------------------------------------------------ HUD: dash charges and grenades
  drawHud(grenades) {
    const g = this.mode.game;
    if (!this.ui) {
      this.ui = h('div', { class: 'moves-ui' });
      (g.hud.root || document.body).appendChild(this.ui);
      this.uiKey = '';
    }
    const show = g.mode === 'surface' && !g.inShip && !this.mode.rover.driving && !g.menus.open && !g.hudHidden && !g.photo.active;
    this.ui.style.display = show ? '' : 'none';
    if (!show) return;
    const partial = this.charges < DASH_CHARGES ? Math.round((this.rechargeT / DASH_RECHARGE) * 10) : 10;
    const gr = grenades ? `${grenades.charges}:${Math.round(grenades.progress * 10)}` : '';
    const key = `${this.charges}:${partial}|${gr}|${this.mode.toolMode}`;
    if (key === this.uiKey) return;
    this.uiKey = key;
    let html = '<span class="mv-dash">';
    for (let i = 0; i < DASH_CHARGES; i++) {
      const fill = i < this.charges ? 1 : i === this.charges ? partial / 10 : 0;
      html += `<i style="--f:${fill}"></i>`;
    }
    html += '</span>';
    if (grenades && this.mode.toolMode === 2) {
      html += '<span class="mv-gren">';
      for (let i = 0; i < grenades.max; i++) html += `<b class="${i < grenades.charges ? 'on' : ''}"></b>`;
      html += '</span>';
    }
    this.ui.innerHTML = html;
  }
}
