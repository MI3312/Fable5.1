// Starship controller: landing, take-off, atmospheric + space flight, pulse drive, chase camera.
import * as THREE from 'three';
import { buildShip } from './shipModel.js';
import { normSpec, shipStats } from '../data/ships.js';
import { ATMOSPHERE_EXIT } from '../config.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

export class Ship {
  constructor(spec = 7) {
    this.spec = normSpec(spec);
    this.stats = shipStats(this.spec);
    this.model = buildShip(this.spec);
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.speed = 0;
    this.targetSpeed = 25;
    this.stick = new THREE.Vector2();
    this.roll = 0;
    this.state = 'landed';
    this.fuel = { launch: 0, pulse: 60 };
    this.shield = 100;
    this.hull = 100;
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

  // a different ship (bought, claimed or repainted): same place, new hull
  rebuild(spec) {
    const parent = this.model.parent;
    this.model.removeFromParent();
    this.spec = normSpec(spec);
    this.stats = shipStats(this.spec);
    this.model = buildShip(this.spec);
    if (parent) parent.add(this.model);
    this.syncModel();
    return this.model;
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
    for (const n of this.model.userData.nav || []) n.l.visible = ((t * 0.8 + n.phase) % 1) < 0.12;
    const flames = this.model.userData.flames || [];
    const flying = this.state !== 'landed';
    const k = !flying ? 0.05 : this.pulsing ? 5 : this.boosting ? 3 : 0.8 + this.speed / 120;
    for (const f of flames) {
      f.scale.z = k * (0.85 + Math.sin(t * 43 + f.position.x * 7) * 0.15) * 2.2;
      f.visible = f.scale.z > 0.2;
      f.material.color.setHex(this.pulsing ? 0x8fc8ff : this.boosting ? 0xffc080 : 0xff9050);
    }
  }

  // Beginning take-off (returns message string on failure). The ship spools up, lifts clear of the
  // ground while levelling out, then eases forward so it leaves the animation already flying.
  tryTakeoff() {
    if (!this.thrustersRepaired) return 'Launch thrusters are damaged. Repair them from the Ship tab of your inventory.';
    if (this.fuel.launch < 20) return 'Launch thrusters need fuel. Refuel with Di-hydrogen Jelly, Uranium or Launch Fuel.';
    this.fuel.launch -= 20;
    this.state = 'takeoff';
    const yaw = this.yaw();
    const f = _v.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const from = this.pos.clone();
    this.anim = {
      kind: 'takeoff', t: 0, dur: 3.2, spool: 0.7, from,
      rise: 17, fwd: f.clone(), fwdDist: 24,
      qFrom: this.quat.clone(), qTo: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.14, yaw, 0, 'YXZ')),
    };
    return null;
  }

  // site: { x, y (ground), z, yaw }. Glides over, flares, then settles straight down onto the gear.
  beginLanding(site, liquid) {
    if (liquid) return 'Cannot land on liquid.';
    const from = this.pos.clone();
    const to = new THREE.Vector3(site.x, site.y + 1.75, site.z);
    const hd = Math.hypot(to.x - from.x, to.z - from.z), vd = Math.max(0, from.y - to.y);
    const dur = Math.min(6.5, Math.max(2.6, 1.4 + hd / 14 + vd / 18));
    const f = this.forward(_v).setY(0);
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1);
    f.normalize();
    const lead = Math.min(Math.max(this.speed, 8), 45) * dur / (3 * Math.PI / 2);
    const c1 = from.clone().addScaledVector(f, Math.min(lead, hd * 0.7 + 2));
    const c2 = to.clone(); c2.y += Math.min(10, 3 + vd * 0.3);
    let yaw = site.yaw ?? this.yaw();
    this.state = 'landing';
    this.anim = {
      kind: 'landing', t: 0, dur, from, c1, c2, to,
      qFrom: this.quat.clone(), qTo: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')),
    };
    return null;
  }

  // Atmospheric entry: a long burning dive from orbit altitude down to a cruising height over `to`.
  beginEntry(from, to, yaw) {
    this.pos.copy(from);
    const d = new THREE.Vector3().subVectors(to, from);
    const hd = Math.hypot(d.x, d.z);
    const h = _v.set(d.x / hd, 0, d.z / hd);
    const c1 = from.clone().addScaledVector(h, hd * 0.35); c1.y -= (from.y - to.y) * 0.55;
    const c2 = to.clone().addScaledVector(h, -hd * 0.5);
    this.state = 'entry';
    this.speed = 90; this.targetSpeed = 36;
    this.anim = {
      kind: 'entry', t: 0, dur: 7.5, from: from.clone(), c1, c2, to: to.clone(),
      qTo: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')),
    };
    this._bez(this.anim, 0.02, _v2);
    this._faceAlong(_v2.sub(from), 0);
    return null;
  }

  _bez(a, u, out) {
    const iu = 1 - u;
    return out.copy(a.from).multiplyScalar(iu * iu * iu)
      .addScaledVector(a.c1, 3 * iu * iu * u)
      .addScaledVector(a.c2, 3 * iu * u * u)
      .addScaledVector(a.to, u * u * u);
  }

  _faceAlong(dir, bank) {
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    const yaw = Math.atan2(-dir.x, -dir.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.quat.setFromEuler(_e.set(pitch, yaw, bank, 'YXZ'));
  }

  // Heat of the entry burn, 0..1 (drives plasma sheath, shake and audio)
  get entryHeat() {
    if (this.state !== 'entry' || !this.anim) return 0;
    const k = this.anim.t / this.anim.dur;
    return Math.max(0, Math.min(1, 1.2 - k * 1.6)) * Math.min(1, k * 8);
  }

  // env: { mode: 'surface'|'space', groundAt(x,z), ctl: bool }
  update(dt, input, env) {
    const events = [];
    this.fireCooldown -= dt;
    this.shake = Math.max(0, this.shake - dt * 2);
    if (this.state === 'landed') { this.speed = 0; this.syncModel(); return events; }
    if (this.state === 'takeoff' || this.state === 'landing' || this.state === 'entry') {
      const a = this.anim;
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      if (a.kind === 'takeoff') {
        const kk = Math.max(0, (a.t - a.spool) / (a.dur - a.spool));
        const up = kk * kk * (3 - 2 * kk);
        this.pos.copy(a.from);
        this.pos.y += a.rise * up;
        this.pos.addScaledVector(a.fwd, a.fwdDist * kk * kk * kk);
        this.pos.y += Math.sin(a.t * 30) * 0.03 * (1 - kk);
        this.quat.slerpQuaternions(a.qFrom, a.qTo, Math.min(1, kk * 1.4));
        this.shake = Math.max(this.shake, a.t < a.spool ? 0.25 : 0.12 * (1 - kk));
        this.speed = 3 * a.fwdDist * kk * kk / (a.dur - a.spool);
      } else if (a.kind === 'landing') {
        const u = Math.sin(k * Math.PI / 2);
        const prev = _v2.copy(this.pos);
        this._bez(a, u, this.pos);
        const e = k * k * (3 - 2 * k);
        this.quat.slerpQuaternions(a.qFrom, a.qTo, e);
        // nose-up flare mid-way, a little bank into the turn
        _q.setFromAxisAngle(_v.set(1, 0, 0), Math.sin(k * Math.PI) * 0.16);
        this.quat.multiply(_q);
        this.speed = prev.distanceTo(this.pos) / Math.max(dt, 1e-4);
        if (k > 0.85) this.shake = Math.max(this.shake, 0.1);
      } else {
        // entry: fall along the curve, nose follows the motion, speed bleeds off
        const uu = 0.7 * k + 0.3 * (1 - (1 - k) * (1 - k));
        const prev = _v2.copy(this.pos);
        this._bez(a, uu, this.pos);
        const vel = _v.subVectors(this.pos, prev);
        this.speed = vel.length() / Math.max(dt, 1e-4);
        const g = env.groundAt ? env.groundAt(this.pos.x, this.pos.z) : -1e9;
        if (this.pos.y < g + 10) this.pos.y = g + 10;
        if (k < 0.97) this._faceAlong(vel, Math.sin(a.t * 1.7) * 0.08 * (1 - k));
        else this.quat.slerp(a.qTo, Math.min(1, dt * 6));
        this.shake = Math.max(this.shake, this.entryHeat * 0.7);
      }
      if (k >= 1) {
        if (a.kind === 'takeoff') {
          this.state = 'flying';
          this.speed = 3 * a.fwdDist / (a.dur - a.spool); this.targetSpeed = 32;
          events.push('tookoff');
        } else if (a.kind === 'entry') {
          this.state = 'flying';
          this.speed = 38; this.targetSpeed = 34;
          this.stick.set(0, 0);
          events.push('entered');
        } else {
          this.pos.copy(a.to);
          this.quat.copy(a.qTo);
          this.state = 'landed';
          this.speed = 0;
          events.push('landed');
        }
        this.anim = null;
      }
      if (env.ctl && env.mode !== 'space') input.consumeMouse();
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
    const ag = this.stats.agility;
    const pitchRate = (space ? 1.3 : 1.5) * (this.pulsing ? 0.25 : 1) * ag;
    const yawRate = (space ? 1.0 : 1.2) * (this.pulsing ? 0.25 : 1) * ag;
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
    const minS = space ? 20 : 10, maxS = (space ? 190 : 62) * this.stats.speed;
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
    // never behind a wall or inside a ceiling: pull in toward the ship when something is in the way
    if (env && env.raycast) {
      const from = _c1.copy(this.pos).addScaledVector(up, 1.8);
      const to = _c2.subVectors(camera.position, from);
      const len = to.length();
      if (len > 0.5) {
        to.divideScalar(len);
        const hit = env.raycast(from, to, len + 0.6);
        if (hit) camera.position.copy(from).addScaledVector(to, Math.max(1.5, hit.dist - 0.6));
      }
    }
    if (this.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
    }
    camera.up.copy(this.state === 'flying' || this.state === 'space' || this.state === 'entry' ? up : UP);
    camera.lookAt(this.camLook);
  }
}
