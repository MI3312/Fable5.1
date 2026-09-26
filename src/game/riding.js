// Riding tamed creatures. Ground mounts run and jump, striders step over walls, hoppers bound,
// and flyers go wherever you look. Feed a creature to tame it, then press E beside it.
import * as THREE from 'three';
import { IS_SOLID, IS_LIQUID } from '../world/blocks.js';
import { clamp } from '../core/rng.js';

const _f = new THREE.Vector3();

export class Riding {
  constructor(mode) {
    this.mode = mode;
    this.c = null;
    this.v = new THREE.Vector3();
    this.onGround = false;
  }

  get active() { return !!this.c; }
  get creature() { return this.c; }
  canRide(c) { return !!(c && c.companion && c.sp.ride && !c.dead && !this.c); }

  mount(c) {
    const g = this.mode.game;
    this.c = c;
    c.ridden = true;
    c.state = 'idle';
    this.v.set(0, 0, 0);
    this.onGround = false;
    g.player.vel.set(0, 0, 0);
    g.player.yaw = c.yaw + Math.PI;
    g.player.pitch = -0.05;
    g.hud.notify(`Riding ${g.nameOf(c.sp)}`);
    g.hud.setCenter(c.sp.ride.kind === 'flyer' ? 'W fly where you look · Space rise · C sink · Shift fast · E dismount' : 'WASD ride · Space jump · Shift gallop · E dismount', '#e8f4ff');
    this.mode.centerT = 3;
    g.audio.tone(520, 0.2, 'sine', 0.07, 1.5);
  }

  dismount() {
    const g = this.mode.game, c = this.c, W = this.mode.world;
    if (!c) return;
    c.ridden = false; c.rideBoost = false; c.bank = 0; c.tilt = 0;
    this.c = null;
    const p = g.player.pos;
    const side = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    const off = 1.2 + c.sp.size;
    for (const s of [1, -1, 0]) {
      const x = c.pos.x + side.x * off * s, z = c.pos.z + side.z * off * s;
      const gy = W.groundBelow(x, c.pos.y + 3, z);
      if (gy < 1) continue;
      p.set(x, gy + 1.01, z);
      let guard = 0;
      while (g.player.collides(W, p.x, p.y, p.z) && guard++ < 20) p.y += 1;
      break;
    }
    g.player.vel.set(0, 0, 0);
    g.audio.tone(380, 0.15, 'sine', 0.06, 0.8);
  }

  update(dt, ctl) {
    const g = this.mode.game, c = this.c, sp = c.sp, R = sp.ride, input = g.input, pl = g.player, W = this.mode.world;
    if (c.dead) { this.dismount(); return; }
    // look
    if (ctl) {
      const [dx, dy] = input.consumeMouse();
      pl.yaw -= dx * 0.0022;
      pl.pitch = clamp(pl.pitch - dy * 0.0022, -1.45, 1.45);
    }
    let mx = 0, mz = 0;
    if (ctl) {
      if (input.down('KeyW')) mz -= 1;
      if (input.down('KeyS')) mz += 1;
      if (input.down('KeyA')) mx -= 1;
      if (input.down('KeyD')) mx += 1;
    }
    const boost = ctl && (input.down('ShiftLeft') || input.down('ShiftRight'));
    const spd = boost ? R.boost : R.speed;
    c.rideBoost = boost;
    const sin = Math.sin(pl.yaw), cos = Math.cos(pl.yaw);
    const len = Math.hypot(mx, mz) || 1;
    const wx = ((mx * cos + mz * sin) / len) * spd, wz = ((-mx * sin + mz * cos) / len) * spd;
    const moving = mx !== 0 || mz !== 0;

    if (R.kind === 'flyer') {
      // fly where you look
      _f.set(-Math.sin(pl.yaw) * Math.cos(pl.pitch), Math.sin(pl.pitch), -Math.cos(pl.yaw) * Math.cos(pl.pitch));
      const tv = _f.multiplyScalar(-mz * spd);
      tv.x += (mx * cos) * spd * 0.55; tv.z += (-mx * sin) * spd * 0.55;
      if (ctl && input.down('Space')) tv.y += 9;
      if (ctl && (input.down('KeyC') || input.down('ControlLeft'))) tv.y -= 9;
      this.v.lerp(tv, Math.min(1, dt * 2.2));
      const nx = c.pos.x + this.v.x * dt, ny = c.pos.y + this.v.y * dt, nz = c.pos.z + this.v.z * dt;
      if (!W.isSolid(nx, ny, nz) && !W.isSolid(nx, ny + 1, nz)) c.pos.set(nx, ny, nz);
      else this.v.multiplyScalar(0.3);
      const gy = W.groundAt(c.pos.x, c.pos.z);
      if (c.pos.y < gy + 1.8) { c.pos.y = gy + 1.8; if (this.v.y < 0) this.v.y = 0; }
      if (c.pos.y > 150) c.pos.y = 150;
      const hs = Math.hypot(this.v.x, this.v.z);
      if (hs > 0.5) {
        let d = Math.atan2(this.v.x, this.v.z) - c.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        c.yaw += d * Math.min(1, dt * 3);
        c.bank += (clamp(-d * 1.2, -0.6, 0.6) - (c.bank || 0)) * Math.min(1, dt * 3);
      } else c.bank = (c.bank || 0) * (1 - Math.min(1, dt * 3));
      c.tilt = clamp(-this.v.y * 0.03, -0.35, 0.35);
      c.moving = hs > 0.5;
    } else {
      // ground, strider, hopper
      const step = R.step || 1.2;
      if (R.kind === 'hopper') {
        if (this.onGround && moving) { this.v.x = wx; this.v.z = wz; this.v.y = boost ? 11 : 8.5; this.onGround = false; g.audio.noiseHit(0.12, 500, 0.06, 'lowpass'); }
        else if (this.onGround) { this.v.x *= 0.8; this.v.z *= 0.8; }
        if (ctl && input.hit('Space') && this.onGround) { this.v.y = 15; this.onGround = false; }
      } else {
        const acc = this.onGround ? 8 : 2;
        this.v.x += (wx * (moving ? 1 : 0) - this.v.x) * Math.min(1, dt * acc);
        this.v.z += (wz * (moving ? 1 : 0) - this.v.z) * Math.min(1, dt * acc);
        if (ctl && input.hit('Space') && this.onGround) { this.v.y = R.kind === 'strider' ? 8 : 9.5; this.onGround = false; }
      }
      this.v.y -= 26 * this.mode.P.gravity * dt;
      // horizontal, with step-up and no walking into liquid
      const tryMove = (nx, nz) => {
        const gy = W.groundBelow(nx, c.pos.y + step + 0.5, nz);
        if (gy < 1) return false;
        if (gy + 1 - c.pos.y > step) return false;
        if (IS_LIQUID[W.getBlock(nx, gy, nz)] && !IS_LIQUID[W.getBlock(c.pos.x, c.pos.y - 1, c.pos.z)]) return false;
        const clear = R.kind === 'strider' ? 1 : Math.min(3, Math.ceil(sp.size * 1.3));
        for (let k = 1; k <= clear; k++) if (IS_SOLID[W.getBlock(nx, Math.max(gy + 1, c.pos.y) + k - 0.5, nz)] && R.kind !== 'strider') return false;
        c.pos.x = nx; c.pos.z = nz;
        if (gy + 1 > c.pos.y && this.onGround) c.pos.y = gy + 1;
        return true;
      };
      const nx = c.pos.x + this.v.x * dt, nz = c.pos.z + this.v.z * dt;
      if (!tryMove(nx, nz)) {
        if (!tryMove(nx, c.pos.z)) this.v.x = 0;
        if (!tryMove(c.pos.x, nz)) this.v.z = 0;
      }
      // vertical
      c.pos.y += this.v.y * dt;
      const floor = W.groundBelow(c.pos.x, c.pos.y + 0.6, c.pos.z) + 1;
      if (c.pos.y <= floor) { c.pos.y = floor; if (this.v.y < 0) this.v.y = 0; this.onGround = true; }
      else this.onGround = false;
      const hs = Math.hypot(this.v.x, this.v.z);
      c.moving = hs > 0.6;
      if (c.moving) {
        let d = Math.atan2(this.v.x, this.v.z) - c.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        c.yaw += d * Math.min(1, dt * 6);
      }
    }
    // sit on its back
    const seat = c.pos.y + R.seat * sp.size;
    pl.pos.set(c.pos.x, seat - 0.9, c.pos.z);
    pl.vel.set(0, 0, 0);
    pl.bob += dt * (c.moving && R.kind !== 'flyer' ? 5 + spd * 0.3 : 0.6);
  }
}
