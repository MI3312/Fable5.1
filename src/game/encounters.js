// Encounters: something to do right now. Every couple of minutes on a planet, one of these turns up
// nearby with a marker, a clock and a reward:
//   Supply Drop   a pod falls out of the sky. Get there and open it before it dissolves (and
//                 sometimes something is waiting beside it).
//   Wisp Chase    bright wisps scatter when you come close. Dash, grapple and jet to catch them.
//   Rift Surge    a tear opens and things climb out of it, in waves. Close it.
//   Ore Geyser    a vein erupts from the ground. Mine what you can before it sinks back;
//                 the multi-tool never overheats near it.
// In a shared dream the host's encounters are shared: everyone sees the same thing at the same place.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { B, IS_LIQUID, BLOCKS } from '../world/blocks.js';
import { ITEMS } from '../data/items.js';
import { generateSpecies } from '../entities/creatures.js';
import { castShadows } from '../world/shadows.js';
import { h } from '../ui/dom.js';

const TYPES = [['drop', 3], ['wisps', 2.2], ['rift', 2], ['geyser', 2]];
const INFO = {
  drop: { icon: '⬇', name: 'Supply Drop', color: '#ffb35a' },
  wisps: { icon: '✧', name: 'Wisp Chase', color: '#aef6ff' },
  rift: { icon: '◈', name: 'Rift Surge', color: '#e08aff' },
  geyser: { icon: '◆', name: 'Ore Geyser', color: '#ffd46a' },
};
const LOOT = [
  ['chromatic_metal', 25, 50, 3], ['metal_plating', 1, 2, 2], ['microprocessor', 1, 1, 1.2], ['carbon_nanotubes', 1, 2, 1.5],
  ['ion_battery', 1, 2, 1.5], ['life_support_gel', 1, 1, 1.5], ['sodium_nitrate', 10, 20, 2], ['chroma_shard', 2, 4, 2],
  ['koi_sashimi', 1, 1, 0.8], ['ember_stew', 1, 1, 0.6], ['dihydrogen_jelly', 1, 2, 1.5], ['warp_cell', 1, 1, 0.25], ['lucid_core', 1, 1, 0.08],
];
const ORES = () => [B.GOLD_ORE, B.COBALT_ORE, B.COPPER_ORE, B.URANIUM_ORE, B.CRYSTAL].filter((x) => x != null);
const _v = new THREE.Vector3();

// ---------------------------------------------------------------- models
function podModel() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.5, metalness: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.7, metalness: 0.3 });
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.2, 0.35) });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.95, 2.0, 12), hull); body.position.y = 1.2;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.9, 12), hull); cap.position.y = 2.65;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 0.16, 12), glow); band.position.y = 1.55;
  const band2 = band.clone(); band2.position.y = 0.75;
  const lid = new THREE.Group(); lid.add(cap); lid.position.y = 0;
  g.add(body, band, band2, lid);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.16), dark);
    leg.position.set(Math.cos(a) * 0.95, 0.35, Math.sin(a) * 0.95);
    leg.rotation.z = Math.cos(a) * 0.35; leg.rotation.x = -Math.sin(a) * 0.35;
    g.add(leg);
  }
  castShadows(g);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 90, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.7, 0.25), transparent: true, opacity: 0.32, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  beam.position.y = 46;
  g.add(beam);
  g.userData = { lid, beam, bands: [band, band2] };
  return g;
}

function wispModel(hue) {
  const g = new THREE.Group();
  const c = new THREE.Color().setHSL(hue, 0.9, 0.7);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.6) }));
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 10), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
  g.add(core, halo);
  g.userData = { color: [c.r, c.g, c.b], halo };
  return g;
}

const RIFT_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RIFT_FRAG = `
varying vec2 vUv;
uniform float uTime, uOpen;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= 1.7;
  float r = length(p);
  float a = atan(p.y, p.x);
  float o = max(uOpen, 0.001);
  float swirl = 0.5 + 0.5 * sin(a * 5.0 + r * 14.0 / o - uTime * 4.0);
  float jag = 0.06 * sin(a * 11.0 + uTime * 3.0) + 0.04 * sin(a * 23.0 - uTime * 5.0);
  float R = 0.8 * o + jag * o;
  float inside = smoothstep(R, R - 0.12, r);
  float rim = smoothstep(0.1, 0.0, abs(r - R));
  vec3 col = mix(vec3(0.02, 0.0, 0.05), vec3(0.55, 0.12, 0.9), swirl * 0.5 * (1.0 - r / (R + 0.001))) * inside + vec3(1.8, 0.7, 2.6) * rim;
  float alpha = max(inside * 0.92, rim);
  if (alpha < 0.02) discard;
  gl_FragColor = vec4(col, alpha);
}`;

function riftModel() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: RIFT_VERT, fragmentShader: RIFT_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 } },
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 6.4), mat);
  m.renderOrder = 5;
  return m;
}

// ---------------------------------------------------------------- the director
export class Encounters {
  constructor(mode) {
    this.mode = mode;
    this.active = null;
    this.timer = 45;
    this.group = new THREE.Group();
    mode.scene.add(this.group);
    this.lastType = null;
    this.ui = null;
  }

  get S() {
    const st = this.mode.game.state;
    if (!st.encounters) st.encounters = { done: 0, streak: 0 };
    return st.encounters;
  }

  get overcharge() {
    const A = this.active;
    return !!(A && A.type === 'geyser' && A.phase === 'live' && this.mode.game.player.pos.distanceTo(A.pos) < 14);
  }

  clear() {
    if (this.active) this._cleanup(this.active, true);
    this.active = null;
    this.timer = 40 + Math.random() * 25;
    if (this.ui) this.ui.el.style.display = 'none';
  }

  _allowed() {
    const m = this.mode, g = m.game;
    return m.planet && !m.interior && !m.pocket && !m.teleport && g.state && !(g.inShip && g.ship.state !== 'landed');
  }

  update(dt) {
    const m = this.mode, g = m.game;
    if (!this._allowed()) { if (this.active) { this._cleanup(this.active, true); this.active = null; } this._drawHud(); return; }
    const guest = g.net.active && !g.net.isHost;
    if (!this.active && !guest) {
      this.timer -= dt;
      if (this.timer <= 0) {
        const types = TYPES.filter(([t]) => t !== this.lastType && (t !== 'geyser' || ORES().length));
        const rng = new RNG((Math.random() * 1e9) >>> 0);
        this.start(rng.weighted(types), null);
      }
    }
    if (this.active) {
      const A = this.active;
      A.t += dt;
      const res = this['_' + A.type](A, dt);
      if (res) this._finish(A, res);
    }
    this._drawHud();
  }

  // opts from the network: { type, x, y, z, seed }
  start(type, opts) {
    const m = this.mode, g = m.game, W = m.world, P = g.player.pos;
    const seed = opts ? opts.seed : (Math.random() * 1e9) >>> 0;
    const rng = new RNG(seed);
    let pos = null;
    if (opts) pos = new THREE.Vector3(opts.x, opts.y, opts.z);
    else {
      const [r0, r1] = { drop: [55, 95], wisps: [22, 36], rift: [22, 34], geyser: [24, 44] }[type];
      for (let tries = 0; tries < 14 && !pos; tries++) {
        const a = rng.next() * Math.PI * 2, r = rng.range(r0, r1);
        const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
        if (!W.isLoaded(x, z)) continue;
        const gy = W.groundAt(x, z);
        if (gy < 3 || IS_LIQUID[W.getBlock(x, gy, z)] || Math.abs(gy - P.y) > 30) continue;
        if (g.bases.baseAt(m.planet.id, x, z)) continue;
        pos = new THREE.Vector3(Math.floor(x) + 0.5, gy + 1, Math.floor(z) + 0.5);
      }
      if (!pos) { this.timer = 12; return; }
    }
    const A = { type, pos, seed, rng, t: 0, phase: 'start', info: INFO[type] };
    this.active = A;
    this.lastType = type;
    this['_init_' + type](A);
    g.hud.toast(`${A.info.icon} ${A.info.name}`, A.hint);
    g.audio.tone(660, 0.18, 'triangle', 0.06, 1.5);
    setTimeout(() => g.audio.tone(990, 0.2, 'triangle', 0.05, 1.2), 140);
    if (!opts && g.net.active && g.net.isHost) g.net.sendEncounter({ type, x: pos.x, y: pos.y, z: pos.z, seed });
  }

  _finish(A, res) {
    const g = this.mode.game, S = this.S;
    if (res === 'done') {
      S.done++; S.streak++;
      g.audio.discover();
    } else {
      S.streak = 0;
      g.hud.toast(`${A.info.icon} ${A.info.name}`, A.failText || 'It slipped away.');
    }
    this._cleanup(A, false);
    this.active = null;
    this.timer = 70 + Math.random() * 60;
  }

  // rewards grow with a streak of encounters completed back to back
  _mult() { return 1 + Math.min(1, this.S.streak * 0.15); }

  _give(title, units, nanites, items) {
    const g = this.mode.game, k = this._mult();
    units = Math.round(units * k); nanites = Math.round(nanites * k);
    if (units) g.inventory.add('units', units);
    if (nanites) g.inventory.add('nanites', nanites);
    for (const [id, n] of items) { const a = g.inventory.add(id, n); if (a > 0) g.hud.notify(null, id, a); }
    const streak = this.S.streak >= 1 ? ` · streak ×${this.S.streak + 1}` : '';
    g.hud.toast(title, `${units ? `+${units.toLocaleString()} units` : ''}${nanites ? ` · +${nanites} nanites` : ''}${streak}`);
  }

  _cleanup(A, abort) {
    if (A.cleanup) A.cleanup(abort);
    for (const o of [...this.group.children]) this.group.remove(o);
  }

  marker() {
    const A = this.active;
    if (!A || !A.markPos) return null;
    return { pos: A.markPos, icon: A.info.icon, label: A.info.name, color: A.info.color };
  }

  // E prompts near an encounter (the pod)
  interaction(p) {
    const A = this.active;
    if (!A || A.type !== 'drop' || A.phase !== 'landed') return null;
    if (p.distanceTo(A.pos) > 4.2) return null;
    return { prompt: '<span class="key">E</span>Open the supply pod', action: () => this._openPod(A) };
  }

  // ---------------------------------------------------------------- Supply Drop
  _init_drop(A) {
    const m = this.mode;
    A.limit = 150;
    A.hint = 'A pod is falling. Reach it before it dissolves.';
    A.model = podModel();
    A.from = A.pos.clone().add(new THREE.Vector3(A.rng.range(-60, 60), 190, A.rng.range(-60, 60)));
    A.model.position.copy(A.from);
    this.group.add(A.model);
    A.phase = 'falling';
    A.markPos = A.pos.clone().add(new THREE.Vector3(0, 4, 0));
    A.guarded = A.rng.chance(0.4);
    A.failText = 'The pod dissolved into the fog.';
    m.game.audio.tone(1100, 3.2, 'sine', 0.04, 0.3);
  }

  _drop(A, dt) {
    const m = this.mode, g = m.game, W = m.world;
    const U = A.model.userData;
    if (A.phase === 'falling') {
      const k = Math.min(1, A.t / 3.6);
      A.model.position.lerpVectors(A.from, A.pos, k * k);
      A.model.rotation.y += dt * 3;
      U.beam.visible = false;
      if (Math.random() < dt * 50) m.debris.spawn(A.model.position.clone(), [1.4, 0.7, 0.3], 2, 1.5, 1, true);
      if (k >= 1) {
        A.phase = 'landed';
        const pd = A.pos.distanceTo(g.player.pos);
        m.debris.spawn(A.pos.clone(), [1.3, 0.65, 0.25], 40, 9, 1.2, true);
        m.debris.spawn(A.pos.clone(), [0.4, 0.36, 0.32], 30, 6, 1.8);
        m.moves.shock(A.pos.clone(), 9, [1, 0.6, 0.3]);
        m.flashAt(A.pos.clone().add(_v.set(0, 2, 0)), [1.6, 0.8, 0.3], 0.5);
        g.audio.explosion(1.2);
        m.horror.shake = Math.max(m.horror.shake, Math.max(0.1, 1.1 - pd / 70));
        // a small scorched crater that the pod sits in
        const cx = Math.floor(A.pos.x), cy = Math.floor(A.pos.y) - 1, cz = Math.floor(A.pos.z);
        for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy <= 3; dy++) {
          const d = Math.hypot(dx, dz);
          if (d > 2.4) continue;
          const id = W.getBlock(cx + dx, cy + dy, cz + dz);
          const def = BLOCKS[id];
          if (id <= 0 || !def || def.unbreakable || def.interact || IS_LIQUID[id]) continue;
          if (dy >= 1) W.setBlock(cx + dx, cy + dy, cz + dz, B.AIR);
          else if (d > 1.2) W.setBlock(cx + dx, cy, cz + dz, Math.random() < 0.5 ? B.ASH : B.OBSIDIAN);
        }
        A.pos.y = W.groundBelow(A.pos.x, A.pos.y + 3, A.pos.z) + 1;
        A.model.position.copy(A.pos);
        A.model.rotation.set(0, A.model.rotation.y, 0);
      }
      return null;
    }
    if (A.phase === 'landed') {
      U.beam.visible = true;
      U.beam.material.opacity = 0.22 + Math.sin(A.t * 3) * 0.08;
      for (const b of U.bands) b.material.color.setRGB(2.4 * (0.7 + 0.3 * Math.sin(A.t * 6)), 1.2, 0.35);
      if (A.guarded && !A.ambushed && g.player.pos.distanceTo(A.pos) < 26) {
        A.ambushed = true;
        A.spawned = this._spawnRiftlings(A, 2, A.pos, 5);
        g.hud.setCenter('Something was waiting by the pod.', '#e0a0ff'); m.centerT = 2;
      }
      if (A.spawned) for (const c of A.spawned) if (!c.dead) c.provoked = true;
      if (A.t > A.limit) return 'fail';
      return null;
    }
    if (A.phase === 'opened') {
      const lid = U.lid;
      lid.position.y += dt * 4; lid.rotation.x += dt * 3;
      U.beam.material.opacity = Math.max(0, U.beam.material.opacity - dt * 0.3);
      return A.t > A.openAt + 1.4 ? 'done' : null;
    }
    return null;
  }

  _openPod(A) {
    const m = this.mode, g = m.game;
    if (A.phase !== 'landed') return;
    A.phase = 'opened'; A.openAt = A.t;
    const items = [];
    const pool = LOOT.slice();
    for (let i = 0; i < 2; i++) {
      let sum = 0; for (const q of pool) sum += q[3];
      let r = Math.random() * sum, pick = pool[0];
      for (const q of pool) { r -= q[3]; if (r <= 0) { pick = q; break; } }
      pool.splice(pool.indexOf(pick), 1);
      if (!ITEMS[pick[0]]) continue;
      items.push([pick[0], pick[1] + Math.floor(Math.random() * (pick[2] - pick[1] + 1))]);
    }
    m.debris.spawn(A.pos.clone().add(_v.set(0, 2, 0)), [1.6, 1.2, 0.5], 30, 5, 1.2, true);
    g.audio.craft();
    this._give('Supply pod opened', 1500 + Math.floor(Math.random() * 2500), 15 + Math.floor(Math.random() * 25), items);
  }

  // ---------------------------------------------------------------- Wisp Chase
  _init_wisps(A) {
    A.limit = 70;
    A.hint = 'Catch the wisps before they fade. They are faster than you: dash (X), grapple (RMB), jet.';
    A.wisps = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const w = { model: wispModel(A.rng.next()), pos: A.pos.clone().add(new THREE.Vector3(A.rng.range(-5, 5), 1.5, A.rng.range(-5, 5))), vel: new THREE.Vector3(), phase: A.rng.next() * 10, fleeT: 0, restT: 0, caught: false };
      w.model.position.copy(w.pos);
      this.group.add(w.model);
      A.wisps.push(w);
    }
    A.caught = 0;
    A.markPos = A.pos.clone().add(new THREE.Vector3(0, 3, 0));
    A.failText = 'The wisps faded.';
  }

  _wisps(A, dt) {
    const m = this.mode, g = m.game, W = m.world, P = g.player.pos;
    let cx = 0, cz = 0, live = 0;
    for (const w of A.wisps) {
      if (w.caught) continue;
      live++;
      w.phase += dt;
      const dx = w.pos.x - P.x, dz = w.pos.z - P.z;
      const d = Math.hypot(dx, dz), dy = w.pos.y - (P.y + 1);
      // caught?
      if (Math.hypot(d, dy) < 1.9 && !g.inShip) {
        w.caught = true; A.caught++;
        this.group.remove(w.model);
        m.debris.spawn(w.pos.clone(), w.model.userData.color, 24, 4, 0.9, true);
        g.audio.tone(660 * Math.pow(1.122, A.caught * 2), 0.25, 'sine', 0.07, 1.5);
        g.inventory.add('chroma_shard', 1);
        g.inventory.add('nanites', 4);
        g.hud.notify(`Wisp caught · ${A.caught}/${A.wisps.length}`);
        continue;
      }
      // flee when you come close; tire after a while
      if (w.restT > 0) w.restT -= dt;
      if (d < 13 && w.restT <= 0) {
        w.fleeT += dt;
        const sp = 9.2;
        const ax = dx / (d || 1), az = dz / (d || 1);
        const jig = Math.sin(w.phase * 3.1) * 0.7;
        w.vel.x += ((ax - az * jig) * sp - w.vel.x) * Math.min(1, dt * 4);
        w.vel.z += ((az + ax * jig) * sp - w.vel.z) * Math.min(1, dt * 4);
        if (w.fleeT > 2.6) { w.fleeT = 0; w.restT = 1.4; }
      } else {
        const slow = w.restT > 0 ? 0.3 : 1;
        w.vel.x += (Math.sin(w.phase * 0.7) * 1.2 * slow - w.vel.x) * Math.min(1, dt * 2);
        w.vel.z += (Math.cos(w.phase * 0.9) * 1.2 * slow - w.vel.z) * Math.min(1, dt * 2);
      }
      // stay near home
      const hx = w.pos.x - A.pos.x, hz = w.pos.z - A.pos.z, hd = Math.hypot(hx, hz);
      if (hd > 40) { w.vel.x -= hx / hd * 14 * dt; w.vel.z -= hz / hd * 14 * dt; }
      w.pos.x += w.vel.x * dt; w.pos.z += w.vel.z * dt;
      const gy = W.groundBelow(w.pos.x, w.pos.y + 6, w.pos.z) + 1;
      const want = gy + 1.4 + Math.sin(w.phase * 2.2) * 0.5;
      w.pos.y += (want - w.pos.y) * Math.min(1, dt * 5);
      w.model.position.copy(w.pos);
      w.model.userData.halo.scale.setScalar(1 + Math.sin(w.phase * 6) * 0.15);
      if (Math.random() < dt * 14) m.debris.spawn(w.pos.clone(), w.model.userData.color, 1, 0.4, 0.6, true);
      cx += w.pos.x; cz += w.pos.z;
    }
    if (live) A.markPos.set(cx / live, W.groundAt(cx / live, cz / live) + 3, cz / live);
    A.detail = `${A.caught}/${A.wisps.length} caught`;
    if (A.caught === A.wisps.length) {
      this._give('Every wisp caught', 1200, 30, [['liquid_light', 2]]);
      return 'done';
    }
    if (A.t > A.limit) {
      if (A.caught >= 3) { this._give(`${A.caught} wisps caught`, 400 * A.caught, 4 * A.caught, []); return 'done'; }
      return 'fail';
    }
    return null;
  }

  // ---------------------------------------------------------------- Rift Surge
  _spawnRiftlings(A, n, at, spread, brute) {
    const m = this.mode, planet = m.planet, out = [];
    for (let i = 0; i < n; i++) {
      const plan = brute && i === 0 ? 'brute' : A.rng.pick(['quad', 'quad', 'biped', 'hopper']);
      const sp = generateSpecies(planet, 90 + A.rng.int(0, 40), plan);
      sp.temper = 'Aggressive';
      if (plan === 'quad') sp.behave = 'charger';
      else if (plan !== 'brute') sp.behave = null;
      sp.name = 'Rift-touched ' + sp.name;
      sp.c1 = [0.16, 0.07, 0.24]; sp.c2 = [0.38, 0.14, 0.52]; sp.c3 = [1.0, 0.35, 1.0];
      if (plan !== 'brute') sp.size = Math.max(0.9, Math.min(1.6, sp.size));
      sp.health = Math.round((plan === 'brute' ? 150 : 45 + sp.size * 25));
      sp.riftling = true;
      sp.hostile = true;
      sp.id = `${planet.id}#rift${plan}`;
      sp.note = 'It came through a rift';
      const a = A.rng.next() * Math.PI * 2;
      const x = at.x + Math.cos(a) * spread * A.rng.next(), z = at.z + Math.sin(a) * spread * A.rng.next();
      const gy = m.world.groundBelow(x, at.y + 6, z);
      const c = m.creatures.spawn(sp, x, gy + 1, z);
      c.provoked = true; c.state = 'chase';
      m.debris.spawn(c.pos.clone().add(_v.set(0, 1, 0)), [0.8, 0.3, 1.2], 20, 4, 1, true);
      out.push(c);
    }
    m.game.audio.tone(90, 0.8, 'sawtooth', 0.07, 1.8);
    return out;
  }

  _init_rift(A) {
    A.limit = 150;
    A.hint = 'A tear has opened. Hold it shut: clear what comes through.';
    A.model = riftModel();
    A.model.position.copy(A.pos).add(new THREE.Vector3(0, 3.4, 0));
    this.group.add(A.model);
    A.wave = 0; A.waves = 2; A.spawned = [];
    A.markPos = A.pos.clone().add(new THREE.Vector3(0, 7.5, 0));
    A.failText = 'The rift closed on its own. Whatever came through stayed.';
    A.cleanup = (abort) => {
      if (!abort && A.won) return;
      for (const c of A.spawned) if (!c.dead) { c.dead = true; c.vanished = true; }
    };
  }

  _rift(A, dt) {
    const m = this.mode, g = m.game;
    const U = A.model.material.uniforms;
    U.uTime.value += dt;
    const open = A.closing ? Math.max(0, 1 - (A.t - A.closing) / 1.2) : Math.min(1, A.t / 1.5);
    U.uOpen.value = open;
    // face the camera around the vertical axis
    const cam = g.camera.position;
    A.model.rotation.y = Math.atan2(cam.x - A.model.position.x, cam.z - A.model.position.z);
    if (Math.random() < dt * 10) m.debris.spawn(A.model.position.clone().add(_v.set((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 3)), [0.9, 0.35, 1.3], 1, 1.5, 0.7, true);
    if (A.closing) {
      if (open <= 0) { this.group.remove(A.model); return 'done'; }
      return null;
    }
    for (const c of A.spawned) if (!c.dead) c.provoked = true;
    const alive = A.spawned.filter((c) => !c.dead && m.creatures.list.includes(c)).length;
    if (A.t > 1.5 && alive === 0) {
      if (A.wave < A.waves) {
        A.wave++;
        const n = A.wave === 1 ? 3 : 3;
        A.spawned = this._spawnRiftlings(A, n, A.pos, 3.5, A.wave === A.waves);
        g.hud.setCenter(A.wave === A.waves ? 'The rift strains. Something big is coming through.' : 'They are coming through.', '#e0a0ff'); m.centerT = 2.2;
        m.horror.shake = Math.max(m.horror.shake, 0.25);
      } else {
        A.won = true;
        A.closing = A.t;
        g.audio.tone(200, 1.2, 'sine', 0.08, 3);
        m.flashAt(A.model.position.clone(), [1.2, 0.5, 1.6], 0.6);
        this._give('Rift sealed', 2500, 45, [['chroma_shard', 3], ['memory_fragment', 1]].concat(Math.random() < 0.15 ? [['lucid_core', 1]] : []));
      }
    }
    A.detail = A.wave ? `wave ${A.wave}/${A.waves} · ${alive} left` : 'opening';
    if (A.t > A.limit) return 'fail';
    return null;
  }

  // ---------------------------------------------------------------- Ore Geyser
  _init_geyser(A) {
    const m = this.mode, W = m.world;
    A.limit = 75;
    A.hint = 'A vein erupted. Mine it before it sinks back - your beam will not overheat near it.';
    A.blocks = [];
    const ores = ORES();
    const main = A.rng.pick(ores);
    const cx = Math.floor(A.pos.x), cz = Math.floor(A.pos.z);
    const put = (x, y, z, id) => {
      const cur = W.getBlock(x, y, z);
      if (cur !== B.AIR && !(BLOCKS[cur] && BLOCKS[cur].shape === 'cross')) return;
      if (W.setBlock(x, y, z, id)) A.blocks.push([x, y, z, id]);
    };
    const gy0 = W.groundBelow(cx, A.pos.y + 4, cz);
    for (let y = 1; y <= 5; y++) put(cx, gy0 + y, cz, y === 5 ? B.CRYSTAL ?? main : main);
    for (let i = 0; i < 16; i++) {
      const x = cx + A.rng.int(-4, 4), z = cz + A.rng.int(-4, 4);
      const gy = W.groundBelow(x, gy0 + 6, z);
      put(x, gy + 1, z, A.rng.chance(0.7) ? main : A.rng.pick(ores));
      if (A.rng.chance(0.35)) put(x, gy + 2, z, main);
    }
    A.total = A.blocks.length;
    A.phase = 'live';
    A.markPos = A.pos.clone().add(new THREE.Vector3(0, 7, 0));
    m.debris.spawn(A.pos.clone().add(_v.set(0, 2, 0)), BLOCKS[main] ? BLOCKS[main].color : [1, 0.8, 0.3], 50, 10, 1.6, true);
    m.moves.shock(A.pos.clone(), 8, [1, 0.85, 0.4]);
    m.game.audio.explosion(0.8);
    A.failText = 'The vein sank back into the ground.';
    A.cleanup = () => {
      for (const [x, y, z, id] of A.blocks) if (W.getBlock(x, y, z) === id) W.setBlock(x, y, z, B.AIR);
    };
  }

  _geyser(A, dt) {
    const m = this.mode, W = m.world;
    let left = 0;
    for (const [x, y, z, id] of A.blocks) if (W.getBlock(x, y, z) === id) left++;
    const mined = A.total - left;
    A.detail = `${mined}/${A.total} mined`;
    if (Math.random() < dt * 8) m.debris.spawn(A.pos.clone().add(_v.set((Math.random() - 0.5) * 2, 0.5, (Math.random() - 0.5) * 2)), [1.4, 1.0, 0.4], 2, 3, 0.9, true);
    if (left === 0 && A.total > 0) { this._give('Vein exhausted', 800, 25, []); return 'done'; }
    if (A.t > A.limit) {
      if (mined >= A.total * 0.5) { this._give(`Vein worked (${mined}/${A.total})`, 500, 15, []); return 'done'; }
      return 'fail';
    }
    return null;
  }

  // ---------------------------------------------------------------- HUD banner
  _drawHud() {
    const g = this.mode.game, A = this.active;
    if (!this.ui) {
      const title = h('div', { class: 'enc-title' }), detail = h('div', { class: 'enc-detail' }), bar = h('div', { class: 'enc-bar' }, h('i'));
      const el = h('div', { class: 'encounter' }, title, detail, bar);
      (g.hud.root || document.body).appendChild(el);
      this.ui = { el, title, detail, bar: bar.firstChild };
    }
    const show = !!A && g.mode === 'surface' && !g.menus.open && !g.hudHidden && !g.photo.active;
    this.ui.el.style.display = show ? '' : 'none';
    if (!show) return;
    const left = Math.max(0, (A.limit || 0) - A.t);
    const dist = A.markPos ? Math.round(A.markPos.distanceTo(g.player.pos)) : 0;
    const title = `${A.info.icon} ${A.info.name}`;
    if (this.ui.title.textContent !== title) { this.ui.title.textContent = title; this.ui.el.style.borderColor = A.info.color; this.ui.title.style.color = A.info.color; }
    const phaseText = A.type === 'drop' ? (A.phase === 'falling' ? 'incoming' : A.phase === 'landed' ? (dist < 5 ? 'open it (E)' : 'reach the pod') : 'opened') : A.detail || '';
    this.ui.detail.textContent = `${phaseText} · ${dist}u · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    this.ui.bar.style.width = `${Math.max(0, Math.min(100, (left / (A.limit || 1)) * 100))}%`;
  }
}
