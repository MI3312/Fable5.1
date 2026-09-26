// The Roamer: a summonable planetary rover.
// Four-point raycast suspension on voxel ground (spring-damper toward the mean wheel height, the
// chassis pitched and rolled to fit), grip that bleeds into slides when boosting, 1-block
// step climbing, wall stops, airtime off ledges, wading through liquid, headlights, a chase
// camera you can swing with the mouse, and a roof cannon that blasts terrain into your cargo.
import * as THREE from 'three';
import { buildRover, WHEELS, WHEEL_R } from '../entities/roverModel.js';
import { BLOCKS, IS_LIQUID, IS_SOLID } from '../world/blocks.js';
import { castShadows } from '../world/shadows.js';
import { clamp } from '../core/rng.js';

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Exocraft {
  constructor(mode) {
    this.mode = mode;
    this.model = null;
    this.present = false;
    this.driving = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.speed = 0; this.steer = 0;
    this.grounded = false;
    this.camYaw = 0; this.camPitch = 0.3; this.camIdle = 0;
    this.camPos = new THREE.Vector3(); this.camInit = false;
    this.lights = false;
    this.fireCd = 0; this.beamT = 0;
    this.spawnT = 0;
    this.hs = [0, 0, 0, 0];
  }

  get unlocked() { return this.mode.game.upgradeCount('roamer') > 0; }

  _ensureModel() {
    if (!this.model) {
      this.model = buildRover();
      castShadows(this.model);
      for (const b of this.model.userData.beams) b.layers.disable(1);
    }
    if (this.model.parent !== this.mode.scene) this.mode.scene.add(this.model);
  }

  clear() {
    if (this.driving) this.exit();
    this.present = false;
    if (this.model) this.model.removeFromParent();
  }

  // bring the Roamer to a clear patch of ground in front of you
  summon() {
    const g = this.mode.game, W = this.mode.world, p = g.player.pos;
    if (this.mode.interior) { g.hud.notify('The Roamer cannot deploy indoors'); return false; }
    const fx = -Math.sin(g.player.yaw), fz = -Math.cos(g.player.yaw);
    for (const d of [7, 9, 5, 11]) for (const side of [0, 3, -3]) {
      const x = p.x + fx * d - fz * side, z = p.z + fz * d + fx * side;
      const gy = W.groundBelow(x, p.y + 6, z);
      if (IS_LIQUID[W.getBlock(x, gy, z)]) continue;
      let clear = true;
      for (let y = gy + 1; y <= gy + 3 && clear; y++) for (const [ox, oz] of [[0, 0], [1.4, 1.6], [-1.4, -1.6], [1.4, -1.6], [-1.4, 1.6]]) if (IS_SOLID[W.getBlock(x + ox, y, z + oz)]) clear = false;
      if (!clear) continue;
      this._ensureModel();
      this.present = true;
      this.pos.set(x, gy + 1 + 1.2, z);
      this.vel.set(0, 0, 0); this.speed = 0;
      this.yaw = g.player.yaw + Math.PI / 2;
      this.spawnT = 0.8;
      this.started = false;
      this.mode.debris.spawn(new THREE.Vector3(x, gy + 1.5, z), [0.5, 0.95, 1], 30, 3, 1.1, true);
      g.audio.tone(300, 0.5, 'sine', 0.07, 2.5);
      g.audio.tone(600, 0.35, 'triangle', 0.05, 1.5);
      g.hud.notify('Roamer deployed · [E] to drive');
      return true;
    }
    g.hud.notify('No room to deploy the Roamer here');
    return false;
  }

  canBoard(p) { return this.present && !this.driving && this.pos.distanceTo(p) < 4.2; }

  board() {
    const g = this.mode.game;
    this.driving = true;
    this.camInit = false; this.camYaw = 0;
    g.player.vel.set(0, 0, 0);
    g.audio.tone(140, 0.4, 'sawtooth', 0.06, 1.8);
    g.hud.setCenter('W/S drive · A/D steer · Shift boost · LMB cannon · L lights · E exit', '#ffe2b0');
    this.mode.centerT = 3;
  }

  exit() {
    const g = this.mode.game, W = this.mode.world, p = g.player.pos;
    this.driving = false;
    this.mode.beam.hide();
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    for (const s of [-1, 1]) {
      const x = this.pos.x + rx * 2.4 * s, z = this.pos.z + rz * 2.4 * s;
      const gy = W.groundBelow(x, this.pos.y + 3, z);
      if (IS_SOLID[W.getBlock(x, gy + 1, z)] || IS_SOLID[W.getBlock(x, gy + 2, z)]) continue;
      p.set(x, gy + 1.01, z);
      break;
    }
    let guard = 0;
    while (g.player.collides(W, p.x, p.y, p.z) && guard++ < 20) p.y += 1;
    g.player.vel.set(0, 0, 0);
    g.player.yaw = this.yaw;
    g.player.pitch = -0.1;
    g.audio.setLoop('rover', false);
  }

  // ground height under each wheel (liquid counts as a shallow ford). With `ref` (the wheels' current
  // heights) each wheel may climb one block from where it is; anything taller is a wall.
  _wheelHeights(px, py, pz, yaw, out, ref = null) {
    const W = this.mode.world;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    let wet = false, wall = false;
    for (let i = 0; i < 4; i++) {
      const [x, z] = WHEELS[i];
      const wx = px + rx * x - fx * z, wz = pz + rz * x - fz * z;
      const base = ref ? Math.max(ref[i], py - 0.5) : py;
      const top = W.groundBelow(wx, base + 1.6, wz);
      const id = W.getBlock(wx, top, wz);
      let h = top + 1;
      if (IS_LIQUID[id]) { h = top + 0.55; wet = true; }
      if (h > base + 1.35) wall = true;
      out[i] = h;
    }
    return { wet, wall };
  }

  update(dt, ctl) {
    if (!this.present) return;
    const g = this.mode.game, input = g.input, W = this.mode.world;
    this.fireCd -= dt; this.beamT -= dt;
    if (this.beamT <= 0 && this.driving) this.mode.beam.hide();
    let throttle = 0, steer = 0, boost = false;
    if (this.driving && ctl) {
      if (input.down('KeyW')) throttle += 1;
      if (input.down('KeyS')) throttle -= 1;
      if (input.down('KeyA')) steer += 1;
      if (input.down('KeyD')) steer -= 1;
      boost = input.down('ShiftLeft') || input.down('ShiftRight');
      const [dx, dy] = input.consumeMouse();
      if (dx || dy) this.camIdle = 0;
      this.camYaw -= dx * 0.003;
      this.camPitch = clamp(this.camPitch + dy * 0.002, -0.15, 1.0);
      if (input.hit('KeyL')) { this.lights = !this.lights; g.audio.ui(); }
      if (input.mouseDown(0) && this.fireCd <= 0) this._fire();
      if (input.hit('Space') && this.grounded) { this.vel.y = 7.5; this.grounded = false; g.audio.noiseHit(0.2, 300, 0.15, 'lowpass'); }
    }
    this.camIdle += dt;
    if (this.camIdle > 1.5 && Math.abs(this.speed) > 3) this.camYaw *= 1 - Math.min(1, dt * 1.5);
    this.steer += (steer - this.steer) * Math.min(1, dt * 6);
    const hs = this.hs;
    const prev = this.prevHs || (this.prevHs = [this.pos.y, this.pos.y, this.pos.y, this.pos.y]);
    const { wet } = this._wheelHeights(this.pos.x, this.pos.y, this.pos.z, this.yaw, hs, this.started ? prev : null);
    for (let i = 0; i < 4; i++) prev[i] = hs[i];
    this.started = true;
    const target = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
    this.grounded = this.pos.y - target < 0.25;
    // drive
    const P = this.mode.P;
    const maxF = boost ? 30 : 17;
    if (this.grounded) {
      if (throttle > 0) this.speed += (boost ? 24 : 13) * dt * (this.speed < 0 ? 2.2 : 1);
      else if (throttle < 0) this.speed -= (this.speed > 0.5 ? 30 : 9) * dt;
      else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 5 * dt);
      this.speed -= Math.sin(this.pitch) * 12 * P.gravity * dt;
      this.speed = clamp(this.speed, -7, maxF);
      if (wet) this.speed = clamp(this.speed, -4, 8);
      const sf = clamp(Math.abs(this.speed) / 3, 0, 1) * (1.6 - Math.min(0.9, Math.abs(this.speed) / 32));
      this.yaw += this.steer * sf * dt * (this.speed < -0.2 ? -1 : 1);
    }
    const fwd = _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const grip = this.grounded ? (boost && Math.abs(this.steer) > 0.3 ? 2.5 : 9) : 0.2;
    this.vel.x += (fwd.x * this.speed - this.vel.x) * Math.min(1, dt * grip);
    this.vel.z += (fwd.z * this.speed - this.vel.z) * Math.min(1, dt * grip);
    // horizontal move with wall stops
    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    const test = [0, 0, 0, 0];
    const { wall } = this._wheelHeights(nx, this.pos.y, nz, this.yaw, test, hs);
    if (wall) {
      if (Math.abs(this.speed) > 8) { g.audio.noiseHit(0.3, 200, 0.25, 'lowpass'); this.mode.horror.shake = Math.max(this.mode.horror.shake, 0.4); }
      this.speed *= -0.2; this.vel.x *= -0.2; this.vel.z *= -0.2;
    } else { this.pos.x = nx; this.pos.z = nz; }
    // suspension
    if (this.pos.y > target + 0.06 && !this.grounded) this.vel.y -= 24 * P.gravity * dt;
    else {
      this.vel.y += ((target - this.pos.y) * 70 - this.vel.y * 10) * dt;
      if (this.vel.y < -10) { g.audio.noiseHit(0.25, 260, 0.2, 'lowpass'); this.mode.debris.spawn(this.pos.clone(), [0.55, 0.5, 0.45], 12, 3, 0.8); }
    }
    this.pos.y += this.vel.y * dt;
    if (this.pos.y < target - 0.3) { this.pos.y = target - 0.3; if (this.vel.y < 0) this.vel.y = 0; }
    // lean the chassis to the ground (or toward the flight path in the air)
    const tp = Math.atan2((hs[0] + hs[1]) / 2 - (hs[2] + hs[3]) / 2, 3.05);
    const tr = Math.atan2((hs[0] + hs[2]) / 2 - (hs[1] + hs[3]) / 2, 2.6);
    if (this.grounded) {
      this.pitch += (tp - this.pitch) * Math.min(1, dt * 9);
      this.roll += (-tr - this.roll + this.steer * Math.min(1, Math.abs(this.speed) / 25) * 0.06) * Math.min(1, dt * 9);
    } else this.pitch += (clamp(this.vel.y * 0.03, -0.4, 0.3) - this.pitch) * Math.min(1, dt * 2);
    // dust and spray
    if (this.grounded && Math.abs(this.speed) > 5 && Math.random() < dt * 14) {
      const i = 2 + Math.floor(Math.random() * 2);
      const [x, z] = WHEELS[i];
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      _v.set(this.pos.x + rx * x - fwd.x * z, hs[i] + 0.2, this.pos.z + rz * x - fwd.z * z);
      const top = W.getBlock(_v.x, hs[i] - 0.5, _v.z);
      const col = wet ? [0.75, 0.85, 1] : (BLOCKS[top] && BLOCKS[top].color) || [0.5, 0.45, 0.4];
      this.mode.debris.spawn(_v.clone(), col, 2, 2 + Math.abs(this.speed) * 0.1, 0.7);
    }
    // the rider sits in the cab
    if (this.driving) {
      const p = g.player.pos;
      p.set(this.pos.x + fwd.x * 0.3, this.pos.y + 0.9, this.pos.z + fwd.z * 0.3);
      g.player.vel.set(0, 0, 0);
      g.player.yaw = this.yaw;
    }
    g.audio.setLoop('rover', this.driving, Math.abs(this.speed) / 30 + (boost ? 0.25 : 0));
    this._animate(dt);
  }

  _animate(dt) {
    const m = this.model, ud = m.userData;
    this.spawnT = Math.max(0, this.spawnT - dt);
    const s = 1 - this.spawnT / 0.8;
    m.scale.set(1, Math.max(0.02, s * s * (3 - 2 * s)), 1);
    m.position.copy(this.pos);
    m.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    const hs = this.hs, target = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
    ud.wheels.forEach((w, i) => {
      w.pivot.position.y = WHEEL_R + clamp((hs[i] - target) * 0.8, -0.35, 0.35) * (this.grounded ? 1 : 0) - (this.grounded ? 0 : 0.2);
      w.mesh.rotation.x -= this.speed * dt / WHEEL_R;
      if (i < 2) w.pivot.rotation.y = this.steer * 0.42;
    });
    ud.body.position.y = this.driving ? Math.sin(this.mode.game.time * 38) * 0.012 : 0;
    // turret follows the camera
    if (this.driving) ud.turret.rotation.y = this.camYaw;
    for (const l of ud.lights) l.visible = this.lights || !this.driving;
    for (const b of ud.beams) b.visible = this.lights && this.driving;
  }

  // roof cannon: a hitscan blast that breaks terrain and hauls in what it breaks
  _fire() {
    const g = this.mode.game, W = this.mode.world, cam = g.camera;
    this.fireCd = 0.45;
    const dir = cam.getWorldDirection(_w);
    const hit = W.raycast(cam.position, dir, 70);
    const from = this.model.userData.turret.getWorldPosition(_v).clone();
    const to = hit ? hit.point.clone() : cam.position.clone().addScaledVector(dir, 70);
    this.mode.beam.show(from, to, 0x7ff6ff, g.time, 0.12);
    this.beamT = 0.12;
    g.audio.shipShoot();
    if (!hit || hit.dist < 3.5) return;
    let n = 0;
    const R = 1.6;
    for (let dz = -2; dz <= 2; dz++) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy + dz * dz > R * R + 0.4) continue;
      const x = hit.x + dx, y = hit.y + dy, z = hit.z + dz;
      const id = W.getBlock(x, y, z);
      const def = BLOCKS[id];
      if (id <= 0 || !def || def.unbreakable || def.interact || IS_LIQUID[id] || def.restricted) continue;
      this.mode._breakBlock(x, y, z, 'rover');
      if (++n >= 12) break;
    }
    this.mode.debris.spawn(to, [0.6, 0.95, 1], 18, 5, 0.6, true);
    this.mode.horror.shake = Math.max(this.mode.horror.shake, 0.15);
  }

  updateCamera(camera, dt) {
    const a = this.yaw + this.camYaw;
    const dist = 8.5 + Math.abs(this.speed) * 0.09;
    const W = this.mode.world;
    const desired = _v.set(this.pos.x + Math.sin(a) * dist * Math.cos(this.camPitch), this.pos.y + 2.2 + Math.sin(this.camPitch) * dist, this.pos.z + Math.cos(a) * dist * Math.cos(this.camPitch));
    if (!this.camInit) { this.camPos.copy(desired); this.camInit = true; }
    this.camPos.lerp(desired, Math.min(1, dt * 7));
    const gy = W.groundAt(this.camPos.x, this.camPos.z) + 1.3;
    if (this.camPos.y < gy) this.camPos.y = gy;
    camera.position.copy(this.camPos);
    camera.up.copy(UP);
    camera.lookAt(this.pos.x - Math.sin(a) * 3, this.pos.y + 1.6, this.pos.z - Math.cos(a) * 3);
  }

  headlight(outPos, outDir) {
    const fwd = _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    outPos.set(this.pos.x + fwd.x * 2.3, this.pos.y + 1.3, this.pos.z + fwd.z * 2.3);
    outDir.set(fwd.x, -0.12 + Math.sin(this.pitch), fwd.z).normalize();
  }

  save() {
    if (!this.present) return null;
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw };
  }

  restore(s) {
    if (!s) return;
    this._ensureModel();
    this.present = true;
    this.pos.set(s.x, s.y, s.z);
    this.yaw = s.yaw || 0;
    this.vel.set(0, 0, 0); this.speed = 0;
    this.spawnT = 0;
    this.started = false;
  }
}
