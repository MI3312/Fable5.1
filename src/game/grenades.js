// Plasma grenades: the Boltcaster's secondary fire (RMB). They arc, bounce, stick to nothing, and
// go off after a short fuse or on contact with something alive. The blast carves a crater and hauls
// the resources it breaks into your cargo, hurts what's nearby, and throws you if you're too close
// (which is also how you grenade-jump).
import * as THREE from 'three';
import { BLOCKS, IS_LIQUID, IS_CROSS, B } from '../world/blocks.js';
import { ITEMS } from '../data/items.js';

const MAX = 3, REGEN = 6, FUSE = 1.7, RADIUS = 2.7, HURT_R = 4.6;
const GEO = new THREE.IcosahedronGeometry(0.13, 1);
const _v = new THREE.Vector3(), _n = new THREE.Vector3();

export class Grenades {
  constructor(mode) {
    this.mode = mode;
    this.max = MAX;
    this.charges = MAX;
    this.regenT = 0;
    this.list = [];
    this.cd = 0;
  }

  get progress() { return this.charges >= MAX ? 1 : this.regenT / REGEN; }

  clear() {
    for (const q of this.list) q.mesh.removeFromParent();
    this.list = [];
  }

  throw(origin, dir, carry) {
    const g = this.mode.game;
    if (this.cd > 0) return false;
    if (this.charges <= 0) { g.hud.setCenter('Plasma grenades recharging', '#ffcf9a'); this.mode.centerT = 0.8; return false; }
    this.charges--;
    this.cd = 0.35;
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, 0.5) });
    const mesh = new THREE.Mesh(GEO, mat);
    mesh.position.copy(origin);
    this.mode.scene.add(mesh);
    const vel = dir.clone().multiplyScalar(21).add(_v.set(0, 3.5, 0));
    if (carry) vel.addScaledVector(carry, 0.6);
    this.list.push({ mesh, pos: origin.clone(), vel, fuse: FUSE, blink: 0 });
    g.audio.tone(640, 0.12, 'triangle', 0.05, 0.6);
    return true;
  }

  update(dt) {
    const m = this.mode, W = m.world;
    this.cd -= dt;
    if (this.charges < MAX) {
      this.regenT += dt;
      if (this.regenT >= REGEN) { this.regenT = 0; this.charges++; }
    }
    this.list = this.list.filter((q) => {
      q.fuse -= dt;
      // integrate in small steps, bouncing off blocks one axis at a time
      const steps = Math.max(1, Math.ceil(q.vel.length() * dt / 0.2));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        const wet = IS_LIQUID[W.getBlock(q.pos.x, q.pos.y, q.pos.z)];
        q.vel.y -= (wet ? 4 : 22) * h;
        if (wet) q.vel.multiplyScalar(Math.pow(0.08, h));
        for (const ax of ['x', 'y', 'z']) {
          const before = q.pos[ax];
          q.pos[ax] += q.vel[ax] * h;
          if (W.isSolid(q.pos.x, q.pos.y, q.pos.z)) {
            q.pos[ax] = before;
            q.vel[ax] *= -0.42;
            const o = ax === 'x' ? 'z' : 'x';
            q.vel[o] *= 0.75;
            if (ax === 'y') q.vel.z *= 0.75;
            if (Math.abs(q.vel[ax]) > 2.5) m.game.audio.tone(900, 0.03, 'square', 0.02, 0.8);
          }
        }
        // anything alive sets it off
        if (m.creatures.hitSphere(q.pos, 0.2) || m.sentinels.hitSphere(q.pos, 0.3)) { q.fuse = 0; break; }
      }
      q.mesh.position.copy(q.pos);
      q.blink += dt * (q.fuse < 0.6 ? 26 : 10);
      const k = 1.6 + Math.sin(q.blink) * 1.0;
      q.mesh.material.color.setRGB(k * 1.6, k * 0.8, k * 0.3);
      if (Math.random() < dt * 30) m.debris.spawn(q.pos.clone(), [1.4, 0.7, 0.3], 1, 0.4, 0.3, true);
      if (q.fuse <= 0) { this._explode(q.pos); q.mesh.removeFromParent(); q.mesh.material.dispose(); return false; }
      return true;
    });
  }

  _explode(c) {
    const m = this.mode, g = m.game, W = m.world, p = g.player;
    const pd = c.distanceTo(p.eye);
    // light, sound, shake
    m.debris.spawn(c.clone(), [1.6, 0.75, 0.25], 34, 9, 0.8, true);
    m.debris.spawn(c.clone(), [0.3, 0.28, 0.27], 26, 6, 1.6);
    m.moves.shock(c.clone().setY(c.y - 0.6), 7, [1, 0.6, 0.3]);
    m.flashAt(c.clone(), [1.8, 0.9, 0.4], 0.35);
    g.audio.explosion(0.9);
    m.horror.shake = Math.max(m.horror.shake, Math.max(0.1, 0.9 - pd / 30));
    // hurt what's near
    for (const cr of m.creatures.list) {
      if (cr.dead || cr.hidden || cr.companion || cr.ridden) continue;
      _v.copy(cr.pos); _v.y += cr.sp.size * 0.8;
      const d = _v.distanceTo(c);
      if (d < HURT_R) m._damageCreature(cr, 75 * Math.pow(1 - d / (HURT_R + 0.4), 0.7));
    }
    for (const dr of m.sentinels.list) {
      const d = dr.pos.distanceTo(c);
      if (d < HURT_R) m._damageDrone(dr, 60 * (1 - d / (HURT_R + 0.4)));
    }
    if (m.horror.hitSphere(c, HURT_R * 0.8)) m._damageHollow(40);
    // and you: a shove, and a little damage
    if (pd < HURT_R && !g.inShip) {
      const k = 1 - pd / HURT_R;
      _n.subVectors(p.eye, c);
      if (_n.lengthSq() < 1e-4) _n.set(0, 1, 0);
      _n.normalize();
      _n.y = Math.max(_n.y, 0.35);
      p.vel.addScaledVector(_n.normalize(), 22 * k);
      p.onGround = false;
      if (k > 0.25 && !m.moves.invulnerable) m._hurtPlayer(14 * k, 'grenade');
    }
    // the crater, and what was in it
    const home = m.planet && g.bases.baseAt(m.planet.id, c.x, c.z);
    if (home || m.pocket === 'station' || m.pocket === 'void') return;
    const got = {};
    let broken = 0;
    const cx = Math.floor(c.x), cy = Math.floor(c.y), cz = Math.floor(c.z);
    const R = Math.ceil(RADIUS);
    for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d = Math.hypot(dx, dy, dz);
      if (d > RADIUS + (Math.random() - 0.5) * 0.8) continue;
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const id = W.getBlock(x, y, z);
      const def = BLOCKS[id];
      if (id <= 0 || !def || def.unbreakable || def.interact || IS_LIQUID[id] || def.restricted || id === B.BEDROCK) continue;
      const above = W.getBlock(x, y + 1, z);
      if (above > 0 && IS_CROSS[above]) W.setBlock(x, y + 1, z, B.AIR);
      if (!W.setBlock(x, y, z, B.AIR)) continue;
      broken++;
      // about half of what breaks is recovered
      if (Math.random() < 0.5) for (const [item, mn, mx] of def.drops || []) {
        const it = item === '@special' ? m.P.special : item;
        if (!ITEMS[it]) continue;
        const n = mn + Math.floor(Math.random() * (mx - mn + 1));
        if (n > 0) got[it] = (got[it] || 0) + n;
      }
    }
    for (const [it, n] of Object.entries(got)) {
      const added = g.inventory.add(it, n);
      if (added > 0) g.hud.notify(null, it, added);
    }
    if (broken > 6 && !m.interior && m.sentinels.addHeat(broken * 0.35)) { g.hud.toast('Sentinels Alerted', 'Explosives detected'); g.audio.alert(); }
  }
}
