// First-person exosuit controller: voxel AABB collision, auto step-up, jetpack, swimming.
import * as THREE from 'three';
import { IS_LIQUID, B } from '../world/blocks.js';

const HALF_W = 0.3;
const HEIGHT = 1.8;
const EYE = 1.62;

export class Player {
  constructor() {
    this.pos = new THREE.Vector3(0, 80, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.inWater = false;
    this.headInWater = false;
    this.inLiquidId = 0;
    this.stepSmooth = 0;
    this.bob = 0;
    this.jetting = false;
    this.jetCooldown = 0;
    this.fallStart = null;
    this.lastLandSpeed = 0;
    this.footstepTimer = 0;
    this.stats = { health: 100, shield: 100, hazard: 100, life: 100, jet: 100 };
    this.upgrades = { jet: 1, hazard: 1, life: 1, mining: 1, scanner: 1 };
    this.frozen = false;
    this.noclip = false;
    // hooks for the movement kit (dash, slide, grapple, ground pound)
    this.control = 1;     // how much WASD steers velocity (0 = momentum only)
    this.gravMul = 1;
    this.crouch = 0;      // lowers the eye while sliding
    this.noJet = false;   // a move is using Space
  }

  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE - this.stepSmooth - this.crouch * 0.7, this.pos.z); }

  forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  collides(world, px, py, pz) {
    const x0 = Math.floor(px - HALF_W), x1 = Math.floor(px + HALF_W);
    const y0 = Math.floor(py), y1 = Math.floor(py + HEIGHT - 0.01);
    const z0 = Math.floor(pz - HALF_W), z1 = Math.floor(pz + HALF_W);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (world.isSolid(x, y, z)) return true;
    }
    return false;
  }

  // returns events: { landed: speed, stepped: bool, footstep: bool }
  update(dt, input, world, gravityScale, controlsEnabled) {
    const ev = { footstep: false, landed: 0, jetting: false, splash: false };
    if (this.frozen) return ev;
    // look
    if (controlsEnabled) {
      const [dx, dy] = input.consumeMouse();
      this.yaw -= dx * 0.0022;
      this.pitch -= dy * 0.0022;
      this.pitch = Math.max(-1.55, Math.min(1.55, this.pitch));
    }
    // liquid state
    const feetId = world.getBlock(this.pos.x, this.pos.y + 0.3, this.pos.z);
    const headId = world.getBlock(this.pos.x, this.pos.y + EYE, this.pos.z);
    const wasInWater = this.inWater;
    this.inWater = feetId > 0 && IS_LIQUID[feetId] === 1;
    this.inLiquidId = this.inWater ? feetId : 0;
    this.headInWater = headId > 0 && IS_LIQUID[headId] === 1;
    if (this.inWater && !wasInWater && this.vel.y < -5) ev.splash = true;

    // movement intent
    let mx = 0, mz = 0;
    if (controlsEnabled) {
      if (input.down('KeyW')) mz -= 1;
      if (input.down('KeyS')) mz += 1;
      if (input.down('KeyA')) mx -= 1;
      if (input.down('KeyD')) mx += 1;
    }
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    const sprint = controlsEnabled && (input.down('ShiftLeft') || input.down('ShiftRight'));
    let speed = (sprint ? 7.6 : 4.6) * (this.speedMul || 1) * (this.buffSpeed || 1);
    this.sprinting = sprint && len > 0;
    if (this.inWater) speed *= 0.6;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wishX = (mx * cos + mz * sin) * speed;
    const wishZ = (-mx * sin + mz * cos) * speed;
    const accel = (this.onGround ? 14 : (this.jetting ? 5 : 2.5)) * this.control;
    this.vel.x += (wishX - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wishZ - this.vel.z) * Math.min(1, accel * dt);

    // gravity / jump / jetpack
    const g = 26 * gravityScale * this.gravMul;
    const space = controlsEnabled && input.down('Space');
    this.jetting = false;
    if (this.inWater) {
      this.vel.y -= g * 0.25 * dt;
      this.vel.y *= Math.pow(0.2, dt);
      if (space) this.vel.y += 22 * dt;
      if (this.vel.y < -4) this.vel.y = -4;
    } else {
      this.vel.y -= g * dt;
      if (space && this.onGround && controlsEnabled && input.hit('Space')) {
        this.vel.y = 8.2;
        this.onGround = false;
        this.jetCooldown = 0.18;
      } else if (space && !this.onGround && !this.noJet && this.jetCooldown <= 0 && this.stats.jet > 0) {
        this.jetting = true;
        ev.jetting = true;
        const thrust = 42 * (0.8 + 0.2 * this.upgrades.jet);
        this.vel.y += thrust * dt;
        if (this.vel.y > 10) this.vel.y = 10;
        // forward boost while jetting
        this.vel.x += wishX * 0.9 * dt;
        this.vel.z += wishZ * 0.9 * dt;
        this.stats.jet = Math.max(0, this.stats.jet - dt * 30 / this.upgrades.jet * (this.jetMul || 1));
      }
    }
    this.jetCooldown -= dt;
    if (this.onGround) this.stats.jet = Math.min(100, this.stats.jet + dt * 45);
    if (this.vel.y < -55) this.vel.y = -55;

    if (this.noclip) {
      this.pos.addScaledVector(this.vel, dt);
      return ev;
    }

    // integrate with collision, axis separated
    const steps = Math.ceil(Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt / 0.4) || 1;
    const sdt = dt / steps;
    const wasGround = this.onGround;
    this.onGround = false;
    for (let s = 0; s < steps; s++) {
      // Y
      let ny = this.pos.y + this.vel.y * sdt;
      if (this.collides(world, this.pos.x, ny, this.pos.z)) {
        if (this.vel.y < 0) {
          ny = Math.floor(ny) + 1;
          if (this.collides(world, this.pos.x, ny, this.pos.z)) ny = this.pos.y;
          if (this.vel.y < -12) ev.landed = -this.vel.y;
          this.onGround = true;
        } else {
          ny = Math.floor(ny + HEIGHT) - HEIGHT - 0.001;
          if (this.collides(world, this.pos.x, ny, this.pos.z)) ny = this.pos.y;
        }
        this.vel.y = 0;
      }
      this.pos.y = ny;
      // X
      const nx = this.pos.x + this.vel.x * sdt;
      if (this.collides(world, nx, this.pos.y, this.pos.z)) {
        if (!this._tryStep(world, nx, this.pos.z, wasGround || this.onGround)) {
          this.pos.x = this.vel.x > 0 ? Math.floor(nx + HALF_W) - HALF_W - 0.001 : Math.floor(nx - HALF_W) + 1 + HALF_W + 0.001;
          if (this.collides(world, this.pos.x, this.pos.y, this.pos.z)) this.pos.x -= this.vel.x * sdt;
          this.vel.x = 0;
        }
      } else this.pos.x = nx;
      // Z
      const nz = this.pos.z + this.vel.z * sdt;
      if (this.collides(world, this.pos.x, this.pos.y, nz)) {
        if (!this._tryStep(world, this.pos.x, nz, wasGround || this.onGround)) {
          this.pos.z = this.vel.z > 0 ? Math.floor(nz + HALF_W) - HALF_W - 0.001 : Math.floor(nz - HALF_W) + 1 + HALF_W + 0.001;
          if (this.collides(world, this.pos.x, this.pos.y, this.pos.z)) this.pos.z -= this.vel.z * sdt;
          this.vel.z = 0;
        }
      } else this.pos.z = nz;
    }
    // ground probe for standing still
    if (!this.onGround && this.vel.y <= 0 && this.collides(world, this.pos.x, this.pos.y - 0.05, this.pos.z)) this.onGround = true;

    this.stepSmooth = Math.max(0, this.stepSmooth - dt * 6);
    // view bob / footsteps
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      this.bob += dt * hs * 1.6;
      this.footstepTimer -= dt * hs;
      if (this.footstepTimer <= 0) { this.footstepTimer = 2.2; ev.footstep = true; }
    } else {
      this.bob *= 0.9;
    }
    return ev;
  }

  _tryStep(world, nx, nz, grounded) {
    if (!grounded) return false;
    const up = this.pos.y + 1.0;
    if (this.collides(world, nx, up, nz)) return false;
    if (this.collides(world, this.pos.x, up, this.pos.z)) return false;
    // step up
    this.pos.y = Math.floor(this.pos.y) + 1 + 0.0001;
    this.pos.x = nx; this.pos.z = nz;
    this.stepSmooth = Math.min(1, this.stepSmooth + 1);
    return true;
  }

  applyCamera(camera) {
    const e = this.eye;
    const bobY = Math.sin(this.bob) * 0.05;
    const bobX = Math.cos(this.bob * 0.5) * 0.03;
    camera.position.set(e.x + bobX * Math.cos(this.yaw), e.y + bobY, e.z - bobX * Math.sin(this.yaw));
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }

  damage(amount) {
    let rest = amount;
    if (this.stats.shield > 0) {
      const s = Math.min(this.stats.shield, rest * 0.8);
      this.stats.shield -= s;
      rest -= s;
    }
    this.stats.health = Math.max(0, this.stats.health - rest);
  }
}

export { EYE, HEIGHT as PLAYER_HEIGHT, HALF_W };
