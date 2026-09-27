// Weather you stop and watch: lightning storms, meteor showers with fireball impacts, aurora nights
// and rainbows after the rain.
import * as THREE from 'three';
import { applyCurvature } from '../core/shaderlib.js';
import { B, IS_LIQUID, IS_SOLID } from '../world/blocks.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _u = new THREE.Vector3(), _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// two crossed quads per segment, so the bolt reads from any angle
function ribbon(points, width) {
  const pos = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    _d.subVectors(b, a).normalize();
    _u.crossVectors(_d, Math.abs(_d.y) > 0.95 ? _v.set(1, 0, 0) : UP).normalize().multiplyScalar(width);
    _v.crossVectors(_d, _u).normalize().multiplyScalar(width);
    for (const o of [_u, _v]) {
      pos.push(a.x - o.x, a.y - o.y, a.z - o.z, a.x + o.x, a.y + o.y, a.z + o.z, b.x + o.x, b.y + o.y, b.z + o.z);
      pos.push(a.x - o.x, a.y - o.y, a.z - o.z, b.x + o.x, b.y + o.y, b.z + o.z, b.x - o.x, b.y - o.y, b.z - o.z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// jagged path by midpoint displacement
function jag(from, to, depth, amp) {
  let pts = [from.clone(), to.clone()];
  for (let d = 0; d < depth; d++) {
    const next = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const m = pts[i].clone().lerp(pts[i + 1], 0.5);
      const len = pts[i].distanceTo(pts[i + 1]);
      m.x += (Math.random() - 0.5) * len * amp; m.z += (Math.random() - 0.5) * len * amp; m.y += (Math.random() - 0.5) * len * amp * 0.3;
      next.push(m, pts[i + 1]);
    }
    pts = next;
  }
  return pts;
}

const boltCore = applyCurvature(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 3.3, 4.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
const boltGlow = applyCurvature(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.55, 1.2), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
const meteorMat = new THREE.LineBasicMaterial({ color: new THREE.Color(2.2, 2.0, 1.7), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const fireMat = applyCurvature(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.6, 0.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
const FIRE_GEO = new THREE.SphereGeometry(1, 12, 10);

export class SkyEvents {
  constructor(mode) {
    this.mode = mode;
    this.group = new THREE.Group();
    mode.scene.add(this.group);
    this.bolts = []; this.meteors = []; this.fireballs = []; this.thunder = [];
    this.flash = 0;
    this.aurora = 0; this.auroraOn = false;
    this.rainbow = 0; this.rainbowT = 0;
    this.shower = 0;
    this.strikeT = 5;
    this.wasNight = true;
  }

  clear() {
    for (const o of [...this.bolts, ...this.meteors, ...this.fireballs]) { this.group.remove(o.mesh); o.mesh.geometry?.dispose?.(); if (o.glow) { this.group.remove(o.glow); o.glow.geometry.dispose(); } }
    this.bolts = []; this.meteors = []; this.fireballs = []; this.thunder = [];
    this.flash = 0; this.aurora = 0; this.rainbow = 0; this.shower = 0; this.auroraOn = false;
  }

  setPlanet(P) {
    this.clear();
    this.P = P;
    this.wasNight = true; // arriving at night doesn't count as nightfall
    this.storms = P.weather === 'rain' || P.weather === 'toxic' || P.weather === 'dust' || P.weather === 'ash' || P.weather === 'snow';
    this.airless = P.biome === 'dead';
  }

  update(dt) {
    const m = this.mode, g = m.game, W = m.world, P = this.P;
    if (!P || m.interior) { this.flash = 0; return; }
    const cam = g.camera.position;
    const storm = m.stormK || 0;
    const day = m.daylight ?? 1;
    const night = day < 0.25;
    // ---------------- lightning ----------------
    if (this.storms && storm > 0.55 && !this.airless) {
      this.strikeT -= dt * storm;
      if (this.strikeT <= 0) { this.strikeT = 2.5 + Math.random() * 7; this._strike(); }
    }
    for (const b of this.bolts) {
      b.t += dt;
      const k = Math.max(0, 1 - b.t / b.life);
      const flick = b.t < 0.08 ? 1 : (Math.sin(b.t * 90) > 0 ? 1 : 0.25);
      b.mesh.material.opacity = k * flick;
      if (b.glow) b.glow.material.opacity = 0.35 * k * flick;
    }
    this.bolts = this.bolts.filter((b) => {
      if (b.t < b.life) return true;
      this.group.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose();
      if (b.glow) { this.group.remove(b.glow); b.glow.geometry.dispose(); b.glow.material.dispose(); }
      return false;
    });
    this.flash = Math.max(0, this.flash - dt * 4);
    this.thunder = this.thunder.filter((t) => {
      t.t -= dt;
      if (t.t > 0) return true;
      const a = g.audio, v = t.vol;
      a.noiseHit(2.8, 110, 0.55 * v, 'lowpass');
      a.noiseHit(1.4, 60, 0.4 * v, 'lowpass');
      if (t.near) a.noiseHit(0.35, 2600, 0.35 * v, 'bandpass');
      return false;
    });
    // ---------------- night events: rolled once per night ----------------
    if (night && !this.wasNight) {
      const cold = P.biome === 'frozen';
      this.auroraOn = !this.airless && P.biome !== 'liminal' && Math.random() < (cold ? 0.75 : 0.22);
      this.aurora = 0;
      if (!this.airless && P.sky.cloudCover < 0.6 && Math.random() < 0.4) {
        this.shower = 70 + Math.random() * 50; this.nextFire = 8 + Math.random() * 10;
        g.hud.toast('Meteor shower', 'Look up. Some of them will land.');
      }
      if (this.auroraOn) g.hud.notify('The sky is moving');
    }
    this.wasNight = night;
    if (!night) { this.auroraOn = false; this.shower = 0; }
    this.aurora += ((this.auroraOn ? 1 : 0) - this.aurora) * Math.min(1, dt * 0.25);
    // ---------------- meteors ----------------
    if (this.shower > 0) {
      this.shower -= dt;
      if (Math.random() < dt * 2.2) this._meteor(cam);
      this.nextFire -= dt;
      if (this.nextFire <= 0 && !g.inShip) { this.nextFire = 14 + Math.random() * 16; this._fireball(); }
    }
    this.meteors = this.meteors.filter((s) => {
      s.t += dt;
      s.head.addScaledVector(s.vel, dt);
      const tail = _a.copy(s.head).addScaledVector(s.vel, -0.12);
      const arr = s.mesh.geometry.attributes.position.array;
      arr[0] = s.head.x; arr[1] = s.head.y; arr[2] = s.head.z; arr[3] = tail.x; arr[4] = tail.y; arr[5] = tail.z;
      s.mesh.geometry.attributes.position.needsUpdate = true;
      s.mesh.material.opacity = Math.sin(Math.min(1, s.t / s.life) * Math.PI);
      if (s.t < s.life) return true;
      this.group.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose();
      return false;
    });
    this.fireballs = this.fireballs.filter((f) => this._updateFireball(f, dt));
    // ---------------- rainbow after rain ----------------
    if (this.lastStorm > 0.4 && storm < 0.4 && day > 0.6 && P.weather === 'rain') this.rainbowT = 70;
    this.lastStorm = storm;
    this.rainbowT -= dt;
    const sunY = m.sunY ?? 0.5;
    const want = this.rainbowT > 0 && sunY < 0.6 && sunY > 0.02 ? 1 : 0;
    this.rainbow += (want - this.rainbow) * Math.min(1, dt * 0.3);
  }

  // pick somewhere to hit: tall things, sometimes near you, now and then you
  _strike(forced = null) {
    const m = this.mode, g = m.game, W = m.world;
    const p = g.inShip ? g.ship.pos : g.player.pos;
    let best = forced ? { x: Math.floor(forced.x) + 0.5, y: W.groundAt(forced.x, forced.z), z: Math.floor(forced.z) + 0.5 } : null;
    for (let i = 0; i < 6 && !forced; i++) {
      const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 90;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (!W.isLoaded(x, z)) continue;
      const y = W.groundAt(x, z);
      if (!best || y > best.y) best = { x: Math.floor(x) + 0.5, y, z: Math.floor(z) + 0.5 };
    }
    // exposed on high ground? it may come for you
    const exposed = !g.inShip && !m.rover.driving && (m.encK || 0) < 0.2 && W.skyHeightAt(p.x, p.z) <= p.y + 0.5;
    const pg = W.groundAt(p.x, p.z);
    if (!forced && exposed && Math.random() < 0.12 + Math.max(0, (pg - W.terrain.heightAt(Math.floor(p.x + 20), Math.floor(p.z))) * 0.01)) best = { x: p.x + (Math.random() - 0.5) * 3, y: pg, z: p.z + (Math.random() - 0.5) * 3 };
    if (!best) return;
    const ground = new THREE.Vector3(best.x, best.y + 1, best.z);
    const top = new THREE.Vector3(best.x + (Math.random() - 0.5) * 40, best.y + 130, best.z + (Math.random() - 0.5) * 40);
    const main = jag(top, ground, 6, 0.5);
    this._addBolt(main, 0.16, 0.55);
    // branches
    for (let i = 0; i < 3; i++) {
      const s = main[4 + Math.floor(Math.random() * (main.length - 12))];
      const end = s.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, -15 - Math.random() * 30, (Math.random() - 0.5) * 40));
      this._addBolt(jag(s, end, 4, 0.55), 0.07, 0.35);
    }
    const dist = ground.distanceTo(p);
    this.flash = Math.min(1.4, this.flash + 1.3 * Math.max(0.3, 1 - dist / 160));
    this.thunder.push({ t: dist / 340 * 3, vol: Math.max(0.25, 1 - dist / 200), near: dist < 50 });
    m.debris.spawn(ground.clone(), [0.8, 0.9, 1.2], 26, 6, 0.8, true);
    m.horror.shake = Math.max(m.horror.shake, Math.max(0, 0.8 - dist / 80));
    // fulgurite: the strike fuses what it hits
    const id = W.getBlock(best.x, best.y, best.z);
    if (id === B.SAND || id === B.SALT) W.setBlock(best.x, best.y, best.z, B.GLASS);
    else if (id === B.GRASS || id === B.SNOW_GRASS || id === B.DIRT || id === B.LEAVES) W.setBlock(best.x, best.y, best.z, B.ASH);
    if (dist < 3.2 && !g.inShip) {
      m._hurtPlayer(38, 'lightning');
      m.cfx.hint('lightning', 'Get off the high ground in a storm.', '#cfe0ff');
    }
    for (const c of m.creatures.list) if (!c.dead && Math.hypot(c.pos.x - ground.x, c.pos.z - ground.z) < 3) m.creatures.damage(c, 120, ground);
  }

  _addBolt(points, width, life) {
    const core = new THREE.Mesh(ribbon(points, width), boltCore.clone());
    const glow = new THREE.Mesh(ribbon(points, width * 7), boltGlow.clone());
    core.frustumCulled = glow.frustumCulled = false;
    core.renderOrder = glow.renderOrder = 11;
    this.group.add(core, glow);
    this.bolts.push({ mesh: core, glow, t: 0, life });
  }

  _meteor(cam) {
    const a = Math.random() * Math.PI * 2;
    const head = new THREE.Vector3(cam.x + Math.cos(a) * 500, cam.y + 260 + Math.random() * 180, cam.z + Math.sin(a) * 500);
    const dir = new THREE.Vector3(Math.cos(a + 2 + Math.random()), -0.25 - Math.random() * 0.3, Math.sin(a + 2 + Math.random())).normalize();
    const vel = dir.multiplyScalar(420 + Math.random() * 260);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
    const mesh = new THREE.Line(geo, meteorMat.clone());
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    this.group.add(mesh);
    this.meteors.push({ mesh, head, vel, t: 0, life: 0.6 + Math.random() * 0.8 });
  }

  _fireball(near = null) {
    const m = this.mode, g = m.game, W = m.world, p = g.player.pos;
    let x, z, gy, a, ok = false;
    for (let tries = 0; tries < 10 && !ok; tries++) {
      a = Math.random() * Math.PI * 2;
      const r = near ? 30 + Math.random() * 15 : 50 + Math.random() * 60;
      x = (near || p).x + Math.cos(a) * r; z = (near || p).z + Math.sin(a) * r;
      if (!W.isLoaded(x, z)) continue;
      gy = W.groundAt(x, z);
      ok = !IS_LIQUID[W.getBlock(x, gy, z)];
    }
    if (!ok) return;
    const target = new THREE.Vector3(x, gy + 1, z);
    const from = target.clone().add(new THREE.Vector3(Math.cos(a + 1.3) * 260, 300, Math.sin(a + 1.3) * 260));
    const mesh = new THREE.Mesh(FIRE_GEO, fireMat);
    mesh.scale.setScalar(2.2);
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    this.group.add(mesh);
    this.fireballs.push({ mesh, from, target, t: 0, dur: 3.4, whistle: false });
    g.audio.tone(900, 3.2, 'sine', 0.05, 0.25);
  }

  _updateFireball(f, dt) {
    const m = this.mode, g = m.game, W = m.world;
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    f.mesh.position.lerpVectors(f.from, f.target, k * k);
    f.mesh.scale.setScalar(2.2 + Math.sin(f.t * 40) * 0.3);
    if (Math.random() < dt * 60) m.debris.spawn(f.mesh.position.clone(), [1.2, 0.6 + Math.random() * 0.3, 0.2], 3, 2, 1.2, true);
    if (k < 1) return true;
    // impact: crater, ore, a new landmark
    this.group.remove(f.mesh);
    const c = f.target;
    const pd = c.distanceTo(g.player.pos);
    this.flash = Math.min(1.4, this.flash + Math.max(0.2, 1 - pd / 200));
    m.horror.shake = Math.max(m.horror.shake, Math.max(0.2, 1.4 - pd / 80));
    g.audio.explosion(1.5);
    this.thunder.push({ t: pd / 340, vol: Math.max(0.3, 1 - pd / 250), near: pd < 60 });
    m.debris.spawn(c.clone(), [1.2, 0.55, 0.2], 60, 12, 1.6, true);
    m.debris.spawn(c.clone(), [0.35, 0.3, 0.28], 50, 9, 2.2);
    const R = 3.6, cx = Math.floor(c.x), cy = Math.floor(c.y) - 1, cz = Math.floor(c.z);
    for (let dz = -5; dz <= 5; dz++) for (let dx = -5; dx <= 5; dx++) for (let dy = -4; dy <= 6; dy++) {
      const d = Math.hypot(dx, dy * 1.2, dz);
      const x = cx + dx, y = cy + dy, z = cz + dz;
      const id = W.getBlock(x, y, z);
      if (id <= 0 || IS_LIQUID[id]) continue;
      if (d < R) W.editBlock(x, y, z, B.AIR);
      else if (d < R + 1.1 && dy <= 0 && IS_SOLID[id]) W.editBlock(x, y, z, Math.random() < 0.5 ? B.OBSIDIAN : B.ASH);
    }
    const ores = [B.GOLD_ORE, B.COBALT_ORE, B.URANIUM_ORE, B.CRYSTAL, B.COPPER_ORE];
    for (let i = 0; i < 6; i++) {
      const x = cx + Math.round((Math.random() - 0.5) * 3), z = cz + Math.round((Math.random() - 0.5) * 3);
      const y = W.groundBelow(x, cy + 2, z);
      W.editBlock(x, y + 1, z, ores[Math.floor(Math.random() * ores.length)]);
    }
    m._addMarker(new THREE.Vector3(c.x, c.y + 3, c.z), '☄', 'Impact site', '#ffb070', 90);
    if (pd < 6) m._hurtPlayer(45, 'meteor');
    m.cfx.hint('impact', 'Something landed. Go and see.', '#ffd2a0');
    return false;
  }
}
