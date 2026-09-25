// Starship controller: landing, take-off, atmospheric + space flight, pulse drive, chase camera.
import * as THREE from 'three';
import { buildShip } from './shipModel.js';
import { ATMOSPHERE_EXIT } from '../config.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Ship {
  constructor(seed = 7) {
    this.model = buildShip(seed);
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.speed = 0;
    this.targetSpeed = 25;
    this.stick = new THREE.Vector2();
    this.roll = 0;
    this.state = 'landed';
    this.fuel = { launch: 0, pulse: 60 };
    this.shield = 100;
    this.thrustersRepaired = false;
    this.pulsing = false;
    this.pulseCharge = 0;
    this.boosting = false;
    this.anim = null;
    this.camPos = new THREE.Vector3();
    this.camLook = new THREE.Vector3();
    this.camInit = false;
    this.fireCooldown = 0;
    this.shake = 0;
    this.upgrades = { hyperdrive: 1, shield: 1, pulse: 1 };
  }

  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.quat); }
  up(out = new THREE.Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.quat); }
  right(out = new THREE.Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.quat); }

  setLevel(yaw) {
    this.quat.setFromEuler(_e.set(0, yaw, 0, 'YXZ'));
  }

  yaw() {
    const f = this.forward(_v);
    return Math.atan2(-f.x, -f.z);
  }

  syncModel() {
    this.model.position.copy(this.pos);
    this.model.quaternion.copy(this.quat);
    const gear = this.model.userData.gear;
    if (gear) gear.visible = this.state === 'landed' || this.state === 'landing' || this.state === 'takeoff';
  }

  updateFlames(t) {
    const flames = this.model.userData.flames || [];
    const flying = this.state !== 'landed';
    const k = !flying ? 0.05 : this.pulsing ? 5 : this.boosting ? 3 : 0.8 + this.speed / 120;
    for (const f of flames) {
      f.scale.z = k * (0.85 + Math.sin(t * 43 + f.position.x * 7) * 0.15) * 2.2;
      f.visible = f.scale.z > 0.2;
      f.material.color.setHex(this.pulsing ? 0x8fc8ff : this.boosting ? 0xffc080 : 0xff9050);
    }
  }

  // Beginning take-off (returns message string on failure)
  tryTakeoff() {
    if (!this.thrustersRepaired) return 'Launch thrusters are damaged. Repair them from the Ship tab of your inventory.';
    if (this.fuel.launch < 20) return 'Launch thrusters need fuel. Refuel with Di-hydrogen Jelly, Uranium or Launch Fuel.';
    this.fuel.launch -= 20;
    this.state = 'takeoff';
    this.anim = { t: 0, dur: 1.8, from: this.pos.clone(), to: this.pos.clone().add(new THREE.Vector3(0, 16, 0)) };
    return null;
  }

  beginLanding(groundY, liquid) {
    if (liquid) return 'Cannot land on liquid.';
    const f = this.forward(_v).setY(0).normalize();
    const to = new THREE.Vector3(this.pos.x + f.x * 8, groundY + 1.75, this.pos.z + f.z * 8);
    this.state = 'landing';
    const yaw = this.yaw();
    const q2 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    this.anim = { t: 0, dur: 2.4, from: this.pos.clone(), to, qFrom: this.quat.clone(), qTo: q2 };
    return null;
  }

  // env: { mode: 'surface'|'space', groundAt(x,z), ctl: bool }
  update(dt, input, env) {
    const events = [];
    this.fireCooldown -= dt;
    this.shake = Math.max(0, this.shake - dt * 2);
    if (this.state === 'landed') { this.speed = 0; this.syncModel(); return events; }
    if (this.state === 'takeoff' || this.state === 'landing') {
      const a = this.anim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = k * k * (3 - 2 * k);
      this.pos.lerpVectors(a.from, a.to, e);
      if (a.qFrom) this.quat.slerpQuaternions(a.qFrom, a.qTo, e);
      if (k >= 1) {
        if (this.state === 'takeoff') {
          this.state = 'flying';
          this.speed = 20; this.targetSpeed = 30;
          events.push('tookoff');
        } else {
          this.state = 'landed';
          events.push('landed');
        }
        this.anim = null;
      }
      this.syncModel();
      return events;
    }

    const space = env.mode === 'space';
    // stick from mouse
    if (env.ctl) {
      const [dx, dy] = input.consumeMouse();
      this.stick.x += dx * 0.0035;
      this.stick.y += dy * 0.0035;
    }
    const sl = this.stick.length();
    if (sl > 1) this.stick.multiplyScalar(1 / sl);
    this.stick.multiplyScalar(Math.exp(-dt * 1.6));
    const dead = (v) => (Math.abs(v) < 0.03 ? 0 : v);
    const pitchRate = (space ? 1.3 : 1.5) * (this.pulsing ? 0.25 : 1);
    const yawRate = (space ? 1.0 : 1.2) * (this.pulsing ? 0.25 : 1);
    let rollIn = 0;
    if (env.ctl) {
      if (input.down('KeyA')) rollIn += 1;
      if (input.down('KeyD')) rollIn -= 1;
    }
    this.roll += (rollIn * 2.2 - this.roll) * Math.min(1, dt * 5);
    const pitch = -dead(this.stick.y) * pitchRate;
    const yawV = -dead(this.stick.x) * yawRate;
    _q.setFromEuler(_e.set(pitch * dt, yawV * dt, this.roll * dt - dead(this.stick.x) * dt * (space ? 0.3 : 0.9), 'YXZ'));
    this.quat.multiply(_q).normalize();
    // auto-level in atmosphere
    if (!space && Math.abs(rollIn) < 0.1) {
      const right = this.right(_v);
      const bank = right.y;
      _q.setFromAxisAngle(this.forward(_v2), bank * dt * 1.8);
      this.quat.premultiply(_q).normalize();
    }

    // throttle
    const minS = space ? 20 : 10, maxS = space ? 190 : 62;
    if (env.ctl) {
      if (input.down('KeyW')) this.targetSpeed = Math.min(maxS, this.targetSpeed + dt * (space ? 90 : 40));
      if (input.down('KeyS')) this.targetSpeed = Math.max(minS * 0.5, this.targetSpeed - dt * (space ? 110 : 50));
    }
    this.targetSpeed = Math.max(minS * 0.5, Math.min(maxS, this.targetSpeed));
    this.boosting = env.ctl && (input.down('ShiftLeft') || input.down('ShiftRight')) && !this.pulsing;
    let want = this.targetSpeed * (this.boosting ? 2.1 : 1);
    // pulse drive
    const wantPulse = space && env.ctl && input.down('Space');
    if (wantPulse && this.fuel.pulse > 0 && !env.pulseBlocked) {
      this.pulseCharge = Math.min(1, this.pulseCharge + dt * 0.9);
      if (this.pulseCharge >= 1) {
        if (!this.pulsing) events.push('pulseStart');
        this.pulsing = true;
      }
    } else {
      if (this.pulsing) events.push('pulseEnd');
      this.pulsing = false;
      this.pulseCharge = Math.max(0, this.pulseCharge - dt * 2);
      if (wantPulse && this.fuel.pulse <= 0) events.push('noPulseFuel');
    }
    if (this.pulsing) {
      want = 4200 * this.upgrades.pulse;
      this.fuel.pulse = Math.max(0, this.fuel.pulse - dt * 1.6 / this.upgrades.pulse);
      this.shake = Math.max(this.shake, 0.15);
    }
    const accel = this.pulsing ? 1.8 : (want > this.speed ? 1.6 : 2.5);
    this.speed += (want - this.speed) * Math.min(1, dt * accel);
    if (env.pulseBlocked && this.speed > 400) this.speed += (300 - this.speed) * Math.min(1, dt * 4);

    const fwd = this.forward(_v);
    this.pos.addScaledVector(fwd, this.speed * dt);

    if (!space) {
      // keep above terrain
      const g = env.groundAt(this.pos.x, this.pos.z);
      const ahead = env.groundAt(this.pos.x + fwd.x * 12, this.pos.z + fwd.z * 12);
      const minY = Math.max(g, ahead) + 4;
      if (this.pos.y < minY) {
        this.pos.y += (minY - this.pos.y) * Math.min(1, dt * 8);
        if (fwd.y < 0.1) {
          _q.setFromAxisAngle(this.right(_v2), dt * 1.2);
          this.quat.premultiply(_q).normalize();
        }
        if (this.pos.y < g + 2) { this.pos.y = g + 2; this.shake = 0.6; events.push('scrape'); }
      }
      if (this.pos.y > ATMOSPHERE_EXIT) events.push('exitAtmosphere');
    }
    this.syncModel();
    return events;
  }

  updateCamera(camera, dt, env) {
    const fwd = this.forward(new THREE.Vector3());
    const up = this.up(new THREE.Vector3());
    const landed = this.state === 'landed';
    const dist = this.pulsing ? 22 : 15 + this.speed * 0.02;
    const desired = this.pos.clone().addScaledVector(fwd, -dist).addScaledVector(up, landed ? 5 : 4.2);
    const look = this.pos.clone().addScaledVector(fwd, 12).addScaledVector(up, 1.5);
    if (!this.camInit) { this.camPos.copy(desired); this.camLook.copy(look); this.camInit = true; }
    const k = Math.min(1, dt * (this.pulsing ? 10 : 6));
    this.camPos.lerp(desired, k);
    this.camLook.lerp(look, Math.min(1, dt * 10));
    if (env && env.groundAt) {
      const g = env.groundAt(this.camPos.x, this.camPos.z) + 2;
      if (this.camPos.y < g) this.camPos.y = g;
    }
    camera.position.copy(this.camPos);
    if (this.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    camera.up.copy(this.state === 'flying' || this.state === 'space' ? up : UP);
    camera.lookAt(this.camLook);
  }
}
