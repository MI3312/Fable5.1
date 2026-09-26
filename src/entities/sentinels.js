// Sentinel drones: planetary guardians that patrol, grow suspicious of heavy mining
// and attack when the wanted level rises.
import * as THREE from 'three';
import { buildSentinelDrone } from './shipModel.js';

const EYE_CALM = new THREE.Color(0x4fb7ff);
const EYE_SUS = new THREE.Color(0xffa020);
const EYE_HOSTILE = new THREE.Color(0xff2a20);

export class SentinelManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.list = [];
    this.level = 0;
    this.wanted = 0;
    this.heat = 0;         // suspicion from mining activity
    this.lostTimer = 0;
    this.spawnTimer = 0;
    this.enabled = true;
  }

  setPlanet(level) {
    this.clear();
    this.level = level;
    this.wanted = 0;
    this.heat = 0;
  }

  clear() {
    for (const d of this.list) this.group.remove(d.model);
    this.list = [];
  }

  addHeat(amount) {
    if (this.level <= 0) return false;
    this.heat += amount * (0.5 + this.level * 0.5);
    if (this.heat > 100) {
      this.heat = 30;
      return this.raise(1);
    }
    return false;
  }

  raise(n = 1) {
    if (this.level <= 0) return false;
    const before = this.wanted;
    this.wanted = Math.min(3, this.wanted + n);
    this.lostTimer = 0;
    return this.wanted > before;
  }

  spawnDrone(pos) {
    const model = buildSentinelDrone();
    const d = {
      model,
      pos: pos.clone(),
      vel: new THREE.Vector3(),
      health: 60,
      fireCd: 1 + Math.random(),
      orbit: Math.random() * Math.PI * 2,
      alt: 6 + Math.random() * 6,
      patrol: null,
      hostile: false,
      bob: Math.random() * 10,
    };
    model.position.copy(d.pos);
    model.scale.setScalar(1.1);
    this.group.add(model);
    this.list.push(d);
    return d;
  }

  // ctx: { world, player: Vector3, inShip, dt, time, fire(pos, dir), onEvent(name) }
  update(dt, ctx) {
    if (!this.enabled || this.level <= 0) {
      if (this.list.length) this.clear();
      return;
    }
    const P = ctx.player;
    this.heat = Math.max(0, this.heat - dt * 4);
    const patrolCount = Math.min(3, this.level);
    const wantCount = this.wanted > 0 && !ctx.inShip ? patrolCount + this.wanted * 2 : patrolCount;
    this.spawnTimer -= dt;
    if (this.list.length < wantCount && this.spawnTimer <= 0) {
      this.spawnTimer = this.wanted > 0 ? 2.5 : 6;
      const a = Math.random() * Math.PI * 2;
      const r = this.wanted > 0 ? 35 : 45 + Math.random() * 20;
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      const gy = ctx.world.groundAt(x, z);
      this.spawnDrone(new THREE.Vector3(x, gy + 10, z));
      if (this.wanted > 0) ctx.onEvent('reinforce');
    }
    // wanted decay
    if (this.wanted > 0) {
      let seen = false;
      for (const d of this.list) if (d.pos.distanceTo(P) < 45) seen = true;
      if (ctx.inShip) this.lostTimer += dt * 3;
      else this.lostTimer += seen ? dt * 0.12 : dt;
      if (this.lostTimer > 22) {
        this.wanted = 0;
        this.lostTimer = 0;
        ctx.onEvent('lost');
      }
    }
    const keep = [];
    for (const d of this.list) {
      const dist = d.pos.distanceTo(P);
      if (d.dead) {
        this.group.remove(d.model);
        continue;
      }
      if (dist > 140) { this.group.remove(d.model); continue; }
      keep.push(d);
      d.hostile = this.wanted > 0 && !ctx.inShip;
      d.bob += dt;
      const gy = ctx.world.groundAt(d.pos.x, d.pos.z);
      let target;
      if (d.hostile) {
        d.orbit += dt * 0.5;
        const R = 11 + Math.sin(d.bob * 0.7) * 3;
        target = new THREE.Vector3(P.x + Math.cos(d.orbit) * R, Math.max(gy + 3, P.y + 4 + Math.sin(d.bob) * 2), P.z + Math.sin(d.orbit) * R);
      } else {
        if (!d.patrol || d.pos.distanceTo(d.patrol) < 3) {
          const a = Math.random() * Math.PI * 2;
          d.patrol = new THREE.Vector3(P.x + Math.cos(a) * 30, 0, P.z + Math.sin(a) * 30);
        }
        target = new THREE.Vector3(d.patrol.x, ctx.world.groundAt(d.patrol.x, d.patrol.z) + d.alt, d.patrol.z);
      }
      const to = target.sub(d.pos);
      const sp = d.hostile ? 9 : 4;
      if (to.length() > 0.1) to.normalize().multiplyScalar(sp);
      d.vel.lerp(to, Math.min(1, dt * 2));
      d.pos.addScaledVector(d.vel, dt);
      if (d.pos.y < gy + 2) d.pos.y = gy + 2;
      d.model.position.copy(d.pos);
      d.model.position.y += Math.sin(d.bob * 2) * 0.2;
      // face player when hostile or suspicious, else movement direction
      const look = (d.hostile || this.heat > 50) && dist < 60 ? P : d.pos.clone().add(d.vel);
      const yaw = Math.atan2(look.x - d.pos.x, look.z - d.pos.z) + Math.PI;
      d.model.rotation.y = yaw;
      if (d.model.userData.ring) { d.model.userData.ring.rotation.z += dt * (d.hostile ? 3 : 0.8); d.model.userData.ring.rotation.x = Math.PI / 2 + Math.sin(d.bob) * 0.25; }
      const eye = d.model.userData.eyeMat;
      eye.color.copy(d.hostile ? EYE_HOSTILE : this.heat > 50 ? EYE_SUS : EYE_CALM);
      if (d.hostile) {
        d.fireCd -= dt;
        if (d.fireCd <= 0 && dist < 50) {
          d.fireCd = 1.3 + Math.random() * 0.8;
          const from = d.pos.clone();
          const aim = P.clone().add(new THREE.Vector3(0, 1.2, 0)).sub(from);
          aim.x += (Math.random() - 0.5) * 1.5; aim.y += (Math.random() - 0.5) * 1.0; aim.z += (Math.random() - 0.5) * 1.5;
          ctx.fire(from, aim.normalize());
        }
      }
    }
    this.list = keep;
  }

  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (const d of this.list) {
      const oc = origin.clone().sub(d.pos);
      const b = oc.dot(dir);
      const c = oc.lengthSq() - 1.1 * 1.1;
      const h = b * b - c;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t > 0 && t < bestT) { bestT = t; best = d; }
    }
    return best ? { drone: best, dist: bestT } : null;
  }

  hitSphere(p, r) {
    for (const d of this.list) if (d.pos.distanceTo(p) < 1.2 + r) return d;
    return null;
  }

  damage(d, amount) {
    d.health -= amount;
    this.raise(1);
    if (d.health <= 0) { d.dead = true; return true; }
    return false;
  }
}
