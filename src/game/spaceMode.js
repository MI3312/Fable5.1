// Space flight: pulse drive between planets, asteroid mining, station docking,
// atmospheric entry and hyperspace warps.
import * as THREE from 'three';
import { SpaceScene } from '../space/space.js';
import { Bolts, Debris } from '../surface/effects.js';

const _v = new THREE.Vector3();

export class SpaceMode {
  constructor(game) {
    this.game = game;
    this.space = new SpaceScene();
    this.scene = this.space.scene;
    this.bolts = new Bolts(this.scene, 80);
    this.debris = new Debris(this.scene, 300, 3.5);
    this.bolts.mesh.userData.keep = true;
    this.debris.mesh.userData.keep = true;
    this.builtKey = null;
    this.titleT = 0;
    this.docked = false;
    this.warp = null;
    this.entering = false;
  }

  buildScene(system) {
    if (this.builtSystem === system) return;
    this.game.ship.model.userData.keep = true;
    this.space.build(system);
    this.builtSystem = system;
  }

  updateTitle(dt) {
    this.titleT += dt;
    const cam = this.game.spaceCamera;
    const sys = this.space.system;
    if (!sys) return;
    const p = sys.planets[0];
    const c = new THREE.Vector3(...p.position);
    const r = p.radius;
    // orbit on the sunlit side of the planet
    const sunA = Math.atan2(-c.z, -c.x);
    const a = sunA + 0.9 + Math.sin(this.titleT * 0.03) * 0.5;
    cam.position.set(c.x + Math.cos(a) * r * 2.5, c.y + r * 0.3, c.z + Math.sin(a) * r * 2.5);
    cam.up.set(0, 1, 0);
    cam.lookAt(c.x + Math.cos(a + 1.4) * r * 1.0, c.y + r * 0.05, c.z + Math.sin(a + 1.4) * r * 1.0);
    cam.updateMatrixWorld();
    this.space.update(dt, cam, cam.position);
    const pu = this.game.post.uniforms;
    pu.uDream.value = 0.4; pu.uVignette.value = 0.45; pu.uCA.value = 0.005; pu.uGrain.value = 0.04;
    pu.uUnderwater.value = 0; pu.uHazard.value = 0; pu.uVisor.value = 0; pu.uWarp.value = 0;
  }

  enter(system, opts = {}) {
    const g = this.game, ship = g.ship;
    this.buildScene(system);
    ship.model.removeFromParent();
    this.scene.add(ship.model);
    ship.state = 'flying';
    ship.camInit = false;
    ship.stick.set(0, 0);
    this.docked = false;
    this.entering = false;
    this.bolts.clear();
    this.debris.clear();
    if (opts.fromPlanet != null) {
      const pl = this.space.planets[opts.fromPlanet];
      const q = this.space.planetWorldQuat(opts.fromPlanet);
      const d = new THREE.Vector3(...(opts.dir || [0, 1, 0])).applyQuaternion(q).normalize();
      ship.pos.copy(pl.group.position).addScaledVector(d, pl.data.radius * 1.32);
      // fly off tangentially with the planet below us, climbing slightly
      const ref = Math.abs(d.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const tangent = new THREE.Vector3().crossVectors(d, ref).normalize();
      const fwd = tangent.clone().addScaledVector(d, 0.35).normalize();
      const m = new THREE.Matrix4().lookAt(ship.pos, ship.pos.clone().add(fwd), d);
      ship.quat.setFromRotationMatrix(m);
      // lookAt makes -Z face the target (camera convention)
      ship.speed = 80; ship.targetSpeed = 80;
    } else if (opts.restore && g.state.shipSpace) {
      const s = g.state.shipSpace;
      ship.pos.set(s.x, s.y, s.z);
      ship.quat.set(s.qx, s.qy, s.qz, s.qw).normalize();
      ship.speed = 40; ship.targetSpeed = 40;
    } else {
      ship.pos.set(...system.arrival);
      const target = new THREE.Vector3(...system.station.position);
      const m = new THREE.Matrix4().lookAt(ship.pos, target, new THREE.Vector3(0, 1, 0));
      ship.quat.setFromRotationMatrix(m);
      ship.speed = 60; ship.targetSpeed = 60;
    }
    ship.syncModel();
    g.audio.setMood(system.isCore ? 'liminal' : 'space', system.seed);
    const pu = g.post.uniforms;
    pu.uUnderwater.value = 0; pu.uHazard.value = 0; pu.uVisor.value = 0;
    g.hud.setVisor(false);
    g.hud.showScan(null);
    g.hud.setProgress(null);
    g.hud.setWanted(0, 0);
  }

  leave() {
    this.game.audio.setLoop('engine', false);
    this.bolts.clear();
    this.debris.clear();
  }

  writeState(st) {
    const s = this.game.ship;
    st.mode = 'space';
    st.shipSpace = { x: s.pos.x, y: s.pos.y, z: s.pos.z, qx: s.quat.x, qy: s.quat.y, qz: s.quat.z, qw: s.quat.w };
  }

  // ---------------- warp ----------------
  beginWarp(onArrive) {
    const g = this.game;
    this.warp = { t: 0, onArrive, arrived: false };
    g.audio.warp();
    g.hud.toast('Hyperdrive engaged', 'Hold on to something');
    g.post.uniforms.uFadeColor.value.set(0xffffff);
  }

  _updateWarp(dt) {
    const g = this.game, ship = g.ship, w = this.warp, pu = g.post.uniforms;
    w.t += dt;
    const t = w.t;
    ship.pulsing = true;
    if (t < 1.6) {
      pu.uWarp.value = t / 1.6 * 0.7;
      ship.speed += (3000 - ship.speed) * dt;
    } else if (t < 4.2) {
      pu.uWarp.value = 1;
      ship.speed = 30000;
      pu.uFade.value = Math.max(0, (t - 3.4) / 0.8);
    } else if (!w.arrived) {
      w.arrived = true;
      pu.uFade.value = 1;
      w.onArrive();
      ship.speed = 400;
      ship.pulsing = true;
    } else {
      const k = (t - 4.2) / 1.8;
      pu.uFade.value = Math.max(0, 1 - k);
      pu.uWarp.value = Math.max(0, 1 - k);
      ship.speed += (60 - ship.speed) * Math.min(1, dt * 2);
      if (k >= 1) {
        this.warp = null;
        pu.uWarp.value = 0; pu.uFade.value = 0;
        ship.pulsing = false;
        ship.targetSpeed = 60;
      }
    }
    ship.shake = 0.5 * pu.uWarp.value;
    ship.pos.addScaledVector(ship.forward(_v), ship.speed * dt);
    ship.syncModel();
    ship.updateFlames(g.time);
    ship.updateCamera(g.spaceCamera, dt, null);
    this.space.update(dt, g.spaceCamera, ship.pos);
  }

  // ---------------- docking ----------------
  _bayPoint() {
    return this.space.station.localToWorld(new THREE.Vector3(0, 0, -150));
  }

  dock() {
    const g = this.game;
    this.docked = true;
    g.ship.speed = 0;
    g.state.flags.docked = true;
    g.audio.setMood('station', g.system.seed);
    g.audio.setLoop('engine', false);
    g.fade(0.4, () => {
      g.input.unlock();
      g.menus.openStation();
      g.hud.toast(g.system.station.name, 'Docked · Trade, upgrade and rest');
    });
  }

  undock() {
    const g = this.game, ship = g.ship;
    const bay = this._bayPoint();
    const out = bay.clone().sub(this.space.station.position).normalize();
    ship.pos.copy(bay).addScaledVector(out, 160);
    const m = new THREE.Matrix4().lookAt(ship.pos, ship.pos.clone().add(out), new THREE.Vector3(0, 1, 0));
    ship.quat.setFromRotationMatrix(m);
    ship.speed = 50; ship.targetSpeed = 50;
    ship.camInit = false;
    this.docked = false;
    g.audio.setMood('space', g.system.seed);
    g.saveGame(false);
  }

  // ---------------- update ----------------
  update(dt, paused) {
    const g = this.game, ship = g.ship, input = g.input, hud = g.hud;
    if (this.warp) { if (!paused) this._updateWarp(dt); else this.space.update(0, g.spaceCamera, ship.pos); return; }
    if (paused || this.docked) {
      g.audio.setLoop('engine', false);
      ship.updateCamera(g.spaceCamera, 0.016, null);
      this.space.update(dt, g.spaceCamera, ship.pos);
      return;
    }
    const ctl = input.locked;
    // proximity checks
    let pulseBlocked = false;
    let nearest = null;
    for (let i = 0; i < this.space.planets.length; i++) {
      const p = this.space.planets[i];
      const d = ship.pos.distanceTo(p.group.position);
      if (!nearest || d - p.data.radius < nearest.d - nearest.r) nearest = { i, d, r: p.data.radius, p };
      if (d < p.data.radius * 2.3) pulseBlocked = true;
    }
    const st = this.space.station;
    const dStation = ship.pos.distanceTo(st.position);
    if (dStation < 2500) pulseBlocked = true;
    const events = ship.update(dt, input, { mode: 'space', ctl, pulseBlocked });
    for (const e of events) {
      if (e === 'noPulseFuel') hud.notify('Pulse engine needs Tritium - mine asteroids (fire at them)');
      if (e === 'pulseStart') g.audio.tone(120, 1.2, 'sawtooth', 0.08, 4);
    }
    if (pulseBlocked && ship.pulsing) { ship.pulsing = false; hud.notify('Pulse drive disengaged: gravity well'); }
    // shoot
    if (ctl && input.mouseDown(0) && ship.fireCooldown <= 0 && !ship.pulsing) {
      ship.fireCooldown = 0.11;
      const fwd = ship.forward(new THREE.Vector3());
      const right = ship.right(new THREE.Vector3());
      for (const s of [-1, 1]) {
        const from = ship.pos.clone().addScaledVector(right, s * 3).addScaledVector(fwd, 3);
        this.bolts.fire(from, fwd, 700 + ship.speed, 'ship', 25, 0x9ff6ff, 1.6, 4);
      }
      g.audio.shipShoot();
    }
    this.bolts.update(dt, (b) => {
      const idx = this.space.asteroidHit(b.p, 1);
      if (idx < 0) return false;
      const a = this.space.asteroidData[idx];
      a.hp -= b.damage;
      this.debris.spawn(b.p, [0.7, 0.65, 0.6], 3, 30, 0.8);
      if (a.hp <= 0) {
        this.space.destroyAsteroid(idx);
        this.debris.spawn(a.p, a.rich ? [0.95, 0.75, 0.3] : [0.6, 0.55, 0.5], 30, 60 + a.s, 2.2);
        g.audio.explosion(0.8);
        const n = Math.round(10 + a.s * 1.2);
        g.inventory.add('tritium', n); hud.notify(null, 'tritium', n);
        if (a.rich) {
          const it = ['gold', 'cobalt', 'copper', 'chroma_shard'][idx % 4];
          const k = 5 + (idx % 11);
          g.inventory.add(it, k); hud.notify(null, it, k);
        }
      }
      return true;
    });
    this.debris.update(dt);
    // asteroid collision
    const hitIdx = this.space.asteroidHit(ship.pos, 5);
    if (hitIdx >= 0) {
      const a = this.space.asteroidData[hitIdx];
      const push = ship.pos.clone().sub(a.p).normalize();
      ship.pos.copy(a.p).addScaledVector(push, a.s + 6);
      ship.speed *= 0.3;
      ship.shake = 1;
      ship.shield = Math.max(0, ship.shield - 8 / ship.upgrades.shield);
      g.post.uniforms.uDamage.value = 0.6;
      g.audio.explosion(0.4);
    }
    // station collision + docking
    if (dStation < 200) {
      ship.pos.copy(st.position).addScaledVector(ship.pos.clone().sub(st.position).normalize(), 200);
      ship.speed *= 0.5;
    }
    const bay = this._bayPoint();
    const dBay = ship.pos.distanceTo(bay);
    let prompt = null;
    if (dBay < 260) {
      prompt = '<span class="key">E</span>Dock with station';
      if (input.hit('KeyE')) this.dock();
    }
    // planet entry
    if (nearest && !this.entering) {
      if (nearest.d < nearest.r * 1.16) {
        this.entering = true;
        const q = this.space.planetWorldQuat(nearest.i).invert();
        const worldDir = ship.pos.clone().sub(nearest.p.group.position).normalize();
        const local = worldDir.clone().applyQuaternion(q);
        g.enterPlanetFromSpace(nearest.i, [local.x, local.y, local.z], [worldDir.x, worldDir.y, worldDir.z]);
      } else if (nearest.d < nearest.r * 1.6) {
        prompt = prompt || `Descend to enter ${nearest.p.data.name}'s atmosphere`;
        ship.shake = Math.max(ship.shake, (1 - (nearest.d - nearest.r * 1.16) / (nearest.r * 0.44)) * 0.4);
        g.post.uniforms.uHazardColor.value.setRGB(1, 0.55, 0.25);
        g.post.uniforms.uHazard.value = Math.max(0, 1 - (nearest.d - nearest.r * 1.16) / (nearest.r * 0.44)) * 0.6;
      } else g.post.uniforms.uHazard.value = 0;
    }
    hud.setPrompt(prompt);
    // shield regen
    ship.shield = Math.min(100, ship.shield + dt * 1.5);
    ship.updateFlames(g.time);
    ship.updateCamera(g.spaceCamera, dt, null);
    g.spaceCamera.updateMatrixWorld();
    this.space.update(dt, g.spaceCamera, ship.pos);
    g.audio.setLoop('engine', true, ship.pulsing ? 1.2 : ship.speed / 250);
    g.audio.setLoop('laser', false); g.audio.setLoop('jetpack', false); g.audio.setLoop('wind', false); g.audio.setLoop('hum', false);
    const pu = g.post.uniforms;
    pu.uWarp.value = ship.pulsing ? 0.25 : Math.max(0, pu.uWarp.value - dt);
    pu.uDream.value = (g.system.isCore ? 1 : 0.3) * g.settings.dreamFx;
    pu.uVignette.value = 0.3 + 0.15 * g.settings.dreamFx;
    pu.uCA.value = 0.001 + 0.0025 * g.settings.dreamFx;
    pu.uGrain.value = 0.02 + 0.03 * g.settings.dreamFx;
    this._hud(dt);
  }

  _hud(dt) {
    const g = this.game, hud = g.hud, ship = g.ship, cam = g.spaceCamera;
    const sys = g.system;
    hud.updateStats(g.player.stats, 'none', false);
    hud.setLocation(sys.name, `${sys.star.label} star · ${sys.economy} · ${sys.conflict} conflict`, [`${sys.planets.length} planets`, `Core ${g.coreDistanceLabel()}`]);
    const list = [];
    const compass = [];
    const cp = cam.position;
    const add = (pos, icon, label, color) => {
      const d = pos.distanceTo(cp);
      list.push({ pos, icon, label, color, dist: d });
      compass.push({ bearing: (Math.atan2(pos.x - cp.x, -(pos.z - cp.z)) * 180 / Math.PI + 360) % 360, icon, color });
    };
    for (const p of this.space.planets) {
      const d = p.group.position.distanceTo(ship.pos);
      if (d > p.data.radius * 1.8) add(p.group.position, '◯', `${p.data.name} · ${p.data.biomeLabel}`, g.state.discoveries.planets[p.data.id] ? '#7ef0ff' : '#ffffff');
    }
    add(this.space.station.position, '⌂', 'Space Station', '#ffd35a');
    hud.updateMarkers(cam, list, g.width, g.height);
    const f = cam.getWorldDirection(_v);
    hud.updateCompass((Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360, compass);
    hud.showShip(true);
    hud.updateShip(ship, 0, true);
    hud.setCrosshair('dot');
    hud.updateHotbar(g.inventory, 0, false, false);
    hud.toolEl.style.display = 'none';
    hud.setHelp('W/S throttle · A/D roll · Shift boost · hold Space: pulse drive\nLMB fire (asteroids give Tritium) · M galaxy map · fly into a planet to land');
  }
}
