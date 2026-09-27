// Liminal pockets, the running half: arms the pocket building you're walking up to, streams the
// pocket in behind the scenes, swaps it in while you're inside the bend with neither end of the
// passage in view, and brings you back out through whatever exit you find. Each kind of place
// brings its own rules (liminalKinds.js).
import * as THREE from 'three';
import { World } from '../world/world.js';
import { voxelUniforms } from '../world/voxelMaterial.js';
import { curvatureUniforms } from '../core/shaderlib.js';
import { B, IS_AIRLIKE, IS_SOLID } from '../world/blocks.js';
import { hash32, clamp, lerp } from '../core/rng.js';
import {
  frameOf, localPt, worldPt, worldDir, worldYaw, toWorld, toLocal, inBend, SEAM_CELLS, STYLE,
} from '../world/liminalGen.js';
import { KINDS } from './liminalKinds.js';

// what each place does to the light and the air once you're properly inside
const ATMOS = {
  backrooms: { amb: [0.3, 0.27, 0.17], art: [1.05, 0.95, 0.66], fog: [0.36, 0.32, 0.18], dens: 1 / 36, sun: 0.1, hemi: 0.45 },
  poolrooms: { amb: [0.4, 0.48, 0.54], art: [0.95, 1.0, 1.06], fog: [0.7, 0.8, 0.88], dens: 1 / 64, sun: 0.4, hemi: 0.7 },
  hallway: { amb: [0.38, 0.38, 0.4], art: [1.0, 1.0, 0.97], fog: [0.75, 0.75, 0.76], dens: 1 / 150, sun: 0.1, hemi: 0.6 },
  library: { amb: [0.12, 0.09, 0.065], art: [1.0, 0.68, 0.38], fog: [0.09, 0.066, 0.045], dens: 1 / 30, sun: 0.05, hemi: 0.22 },
  warehouse: { amb: [0.035, 0.04, 0.05], art: [0.8, 0.88, 1.0], fog: [0.012, 0.014, 0.018], dens: 1 / 26, sun: 0.02, hemi: 0.08 },
};
const SURF_ART = [0.62, 0.6, 0.57];
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();

export class Liminal {
  constructor(mode) {
    this.mode = mode;
    this.world = null;
    this.d = null;
    this.inside = false;
    this.K = 0;
    this.power = 1;      // the kinds dim this for blackouts
    this.powerK = 1;
    this.dread = 0;
    this.props = new THREE.Group();
    this.props.name = 'liminal-props';
    mode.scene.add(this.props);
    this.kind = null;
    this.hidden = [];
    this.fadeT = 0; this.fadeDur = 0;
    this.goneSeen = false;
    this.enteredAt = 0;
  }

  get g() { return this.mode.game; }
  get W() { return this.world; }
  get ground() { return this.mode.ground; }

  _ensureWorld() {
    if (!this.world) {
      this.world = new World(this.mode.scene, this.mode.materials, { workers: 2 });
      this.world.group.visible = false;
      this.world.setRenderDistance(5);
    }
    return this.world;
  }

  // ------------------------------------------------------------------ arming
  _visits(key) { const f = this.g.state.flags; return (f.pocketVisits && f.pocketVisits[key]) || 0; }

  _arm(s) {
    const d = frameOf(s);
    // every visit is a different night in the same place: the passage is the same, the rest isn't
    d.baseSeed = d.seed;
    d.seed = hash32(d.seed, this._visits(d.key), 1717);
    if (this.d && this.d.key === d.key && this.d.seed === d.seed) return;
    this.d = d;
    const W = this._ensureWorld();
    W.setPlanet({ ...this.mode.P, interior: 'liminal', pocket: d }, null);
    W.group.visible = false;
  }

  disarm() {
    if (this.inside) return;
    this.d = null;
    if (this.world) this.world.clear();
  }

  // local <-> world helpers for the kinds
  local(x, z) { return localPt(this.d, x, z); }
  worldAt(u, v) { return worldPt(this.d, u, v); }
  cellWorld(u, v) { return toWorld(this.d, u, v); }
  cellLocal(x, z) { return toLocal(this.d, Math.floor(x), Math.floor(z)); }
  set(u, y, v, id) { const [x, z] = toWorld(this.d, u, v); this.world.editBlock(x, this.d.F + y, z, id); }
  get(u, y, v) { const [x, z] = toWorld(this.d, u, v); return this.world.getBlock(x, this.d.F + y, z); }
  yaw(du, dv) { return worldYaw(this.d, du, dv); }
  dir(du, dv) { return worldDir(this.d, du, dv); }
  // a world-space point at local (u, v) and height y above the floor
  point(u, y, v, out = new THREE.Vector3()) { const [x, z] = worldPt(this.d, u, v); return out.set(x, this.d.F + y, z); }

  // can the camera see this point? (in the view, and nothing solid in the way in the given world)
  visible(p, world = this.mode.world, margin = 1.25) {
    const cam = this.g.camera;
    _v.copy(p).project(cam);
    if (_v.z > 1 || _v.z < -1 || Math.abs(_v.x) > margin || Math.abs(_v.y) > margin) {
      // behind the camera or well outside the frame; still count it if it's right next to us
      if (cam.position.distanceTo(p) > 1.2) return false;
    }
    _w.copy(p).sub(cam.position);
    const dist = _w.length();
    if (dist < 0.05) return true;
    _w.multiplyScalar(1 / dist);
    return !world.raycast(cam.position, _w, Math.max(0, dist - 0.72), { ignoreLiquid: true });
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const m = this.mode, g = this.g;
    if (!m.planet || m.interior) return;
    this._fade(dt);
    if (this.inside) { this._updateInside(dt); return; }
    // look for a pocket building close by
    const p = g.player.pos;
    const near = (m.nearStructures || []).find((s) => s.pocket && s.dist < 56);
    if (near && !g.inShip) this._arm(near);
    else if (this.d && (!near || g.inShip)) { this.disarm(); return; }
    if (!this.d) return;
    const W = this.world;
    const [du, dv] = [3.5, 6];
    const [fx, fz] = this.worldAt(du, dv);
    W.update(fx, fz, 2.5);
    if (g.inShip || m.rover.driving || m.riding.active || m.teleport) return;
    // inside the bend, with the pocket ready and neither end of the passage in sight: swap
    const [lu, lv] = this.local(p.x, p.z);
    const cu = Math.floor(lu), cv = Math.floor(lv);
    if (!inBend(cu, cv) || Math.abs(p.y - this.d.F) > 1.2) return;
    if (W.loadedAround(p.x, p.z, 2) < 1 || W.results.length) return;
    if (this._seamVisible()) return;
    this._enter();
  }

  _seamVisible() {
    for (const [u, v] of SEAM_CELLS) {
      for (const [ou, oy] of [[0.5, 0.5], [0.5, 1.5], [0.5, 2.5], [0.1, 1.0], [0.9, 1.0], [0.1, 2.2], [0.9, 2.2]]) {
        this.point(u + ou, oy, v + 0.5, _p);
        if (this.visible(_p, this.ground, 1.35)) return true;
      }
    }
    return false;
  }

  // ------------------------------------------------------------------ in
  _enter() {
    const m = this.mode, g = this.g;
    this.inside = true;
    this.K = 0;
    this.power = 1; this.powerK = 1;
    this.goneSeen = false;
    this.enteredAt = g.time;
    m.world = this.world;
    this.ground.group.visible = false;
    this.world.group.visible = true;
    this.world.setRenderDistance(this.ground.renderDist);
    // the outside world's things stay outside
    const hide = [g.ship.model, m.rover.model, m.creatures.group, m.sentinels.group, m.giants.group, m.encounters.group,
      m.skyEvents.group, m.horror.group, m.clouds.mesh, m.weather.points, g.corruption.group];
    m.fishing.cancel();
    this.hidden = hide.filter(Boolean).map((o) => [o, o.visible]);
    for (const [o] of this.hidden) o.visible = false;
    this.curve = curvatureUniforms.uCurve.value;
    curvatureUniforms.uCurve.value = 0;
    voxelUniforms.uSeaLevel.value = -999;
    const st = g.state.flags;
    st.pocketsEntered = (st.pocketsEntered || 0) + 1;
    g.audio.setLoop('hum', false);
    this.kind = new KINDS[this.d.kind](this);
    this.kind.start();
    if (g.net.active) g.net.snapNow?.();
  }

  _updateInside(dt) {
    const m = this.mode, g = this.g;
    this.K = Math.min(1, this.K + dt / 5);
    this.powerK += (this.power - this.powerK) * Math.min(1, dt * 6);
    for (const [o] of this.hidden) o.visible = false;
    const p = g.player.pos;
    // whatever happens, don't fall out of the world
    if (p.y < this.d.F - 20) {
      const [x, z] = this.worldAt(6.5, 14.5);
      p.set(x, this.d.F + 0.1, z); g.player.vel.set(0, 0, 0);
    }
    // the moment you notice the way you came in is gone
    if (!this.goneSeen && g.time - this.enteredAt > 0.6) {
      this.point(1, 1.2, 0.5, _p);
      if (_p.distanceTo(g.camera.position) < 9 && this.visible(_p, this.world, 0.6)) {
        this.goneSeen = true;
        g.audio.swell(0.06);
        g.audio.distant('thud');
        m.horror.shake = Math.max(m.horror.shake, 0.25);
        this.center(this.kind.goneLine || 'The door is gone.', '#e8e2d0', 3.5);
      }
    }
    this.kind.update(dt);
    if (!this.inside) return;
    this.dread = this.kind.dread ?? 0.2;
  }

  // lights, fog and air: a slow turn from the planet's to the pocket's, so the swap itself is invisible
  applyAtmos() {
    const m = this.mode, u = voxelUniforms;
    if (!this.inside) { u.uArtificial.value.setRGB(...SURF_ART); u.uPanelK.value = 1; return; }
    u.uPanelK.value = clamp(this.powerK, 0.04, 1.6);
    const A = ATMOS[this.d.kind], K = this.K, pw = this.powerK;
    const s = K * K * (3 - 2 * K);
    u.uArtificial.value.setRGB(lerp(SURF_ART[0], A.art[0], s) * pw, lerp(SURF_ART[1], A.art[1], s) * pw, lerp(SURF_ART[2], A.art[2], s) * pw);
    const am = u.uAmbient.value;
    am.setRGB(lerp(am.r, A.amb[0] * (0.35 + 0.65 * pw), s), lerp(am.g, A.amb[1] * (0.35 + 0.65 * pw), s), lerp(am.b, A.amb[2] * (0.35 + 0.65 * pw), s));
    u.uFogDensity.value = lerp(u.uFogDensity.value, A.dens * (1.6 - 0.6 * pw), s);
    u.uMistDensity.value *= 1 - s;
    u.uEnclosed.value = lerp(u.uEnclosed.value, 1, s);
    _c.setRGB(A.fog[0] * pw, A.fog[1] * pw, A.fog[2] * pw);
    u.uCaveCol.value.lerp(_c, s);
    m.scene.fog.color.lerp(_c, s);
    m.scene.fog.density = lerp(m.scene.fog.density, A.dens * 1.25, s);
    m.sunLight.intensity = lerp(m.sunLight.intensity, A.sun * Math.PI, s);
    m.hemi.intensity = lerp(m.hemi.intensity, A.hemi * Math.PI * pw, s);
    if (this.kind && this.kind.atmos) this.kind.atmos(u, s);
  }

  // ------------------------------------------------------------------ out
  // through an exit: out into the open, in front of the little building, a while later
  exit(line) {
    const m = this.mode, g = this.g;
    if (!this.inside) return;
    const d = this.d;
    const flags = g.state.flags;
    flags.pocketVisits = flags.pocketVisits || {};
    flags.pocketVisits[d.key] = (flags.pocketVisits[d.key] || 0) + 1;
    flags.pocketsEscaped = flags.pocketsEscaped || {};
    const first = !flags.pocketsEscaped[d.kind];
    flags.pocketsEscaped[d.kind] = (flags.pocketsEscaped[d.kind] || 0) + 1;
    this._leave();
    this._placeOutside();
    // time kept passing out here
    const lost = 0.06 + Math.random() * 0.22;
    m.dayT = (m.dayT + lost) % 1;
    this.flashWhite(1.6);
    g.audio.distant('door');
    g.audio.swell(0.05);
    const hours = Math.round(lost * 24);
    this.center(line || 'Outside.', '#fff6e0', 4.5);
    const reward = first ? 5000 : 1500;
    g.inventory.add('units', reward);
    g.inventory.add('memory_fragment', first ? 3 : 1);
    g.hud.toast(`Escaped ${STYLE[d.kind].name}`, `You were gone for ${hours <= 1 ? 'about an hour' : `about ${hours} hours`}. +${reward.toLocaleString()} units, ${first ? 3 : 1} Memory Fragment${first ? 's' : ''}`);
    g.audio.discover();
    this.disarm();
  }

  // dying, leaving the planet, saving: back to the real world without ceremony
  bail(place = true) {
    if (!this.inside) return;
    this._leave();
    if (place) this._placeOutside();
    this.disarm();
  }

  _leave() {
    const m = this.mode, g = this.g;
    if (this.kind) { this.kind.stop(); this.kind = null; }
    for (const c of [...this.props.children]) this.props.remove(c);
    this.inside = false;
    m.world = this.ground;
    this.ground.group.visible = true;
    this.world.group.visible = false;
    for (const [o, vis] of this.hidden) o.visible = vis;
    this.hidden = [];
    this.world.setRenderDistance(5);
    curvatureUniforms.uCurve.value = this.curve ?? curvatureUniforms.uCurve.value;
    const P = m.P;
    voxelUniforms.uSeaLevel.value = P.liquid === B.WATER || P.liquid === B.DREAM_WATER ? P.seaLevel : -999;
    voxelUniforms.uArtificial.value.setRGB(...SURF_ART);
    this.power = this.powerK = 1;
    g.audio.setLoop('fluoro', false); g.audio.setLoop('water', false);
    g.post.histValid = false;
  }

  outsidePos() {
    const [x, z] = this.worldAt(1, -2.5);
    return { x, y: this.d.F + 0.02, z, yaw: this.yaw(0, -1) };
  }

  _placeOutside() {
    const g = this.g, o = this.outsidePos();
    const p = g.player;
    const gy = this.ground.groundBelow(o.x, o.y + 2, o.z);
    p.pos.set(o.x, Math.max(o.y, gy + 1.02), o.z);
    p.vel.set(0, 0, 0);
    p.yaw = o.yaw; p.pitch = 0.05;
    g.post.histValid = false;
  }

  // move the player (and anything the kind is carrying along) by a local offset, invisibly
  shift(du, dv) {
    const [dx, dz] = this.dir(du, dv);
    const g = this.g;
    g.player.pos.x += dx; g.player.pos.z += dz;
    for (const c of this.props.children) if (c.userData.follow) { c.position.x += dx; c.position.z += dz; }
    g.post.histValid = false;
    this.mode.debris.clear?.();
  }

  // ------------------------------------------------------------------ small conveniences
  center(text, color = '#e8e2d0', t = 3) { this.g.hud.setCenter(text, color); this.mode.centerT = t; }
  hurt(dmg, why) { this.mode._hurtPlayer(dmg, why); }
  scare(k = 1) {
    const H = this.mode.horror;
    H.flash = Math.max(H.flash, 0.8 * k); H.shake = Math.max(H.shake, 0.9 * k); H.glitch = Math.max(H.glitch, 0.6 * k);
    this.g.audio.screech(0.28 * k);
  }
  flashWhite(dur) { this.fadeT = dur; this.fadeDur = dur; this.g.post.uniforms.uFadeColor.value.set(0xfff8ea); }
  _fade(dt) {
    if (this.fadeT <= 0 || this.g.transition) return;
    this.fadeT = Math.max(0, this.fadeT - dt);
    this.g.post.uniforms.uFade.value = Math.pow(this.fadeT / this.fadeDur, 1.6);
    if (this.fadeT <= 0) { this.g.post.uniforms.uFade.value = 0; this.g.post.uniforms.uFadeColor.value.set(0x000000); }
  }
  // HUD location while inside
  hud() {
    const st = STYLE[this.d.kind];
    const lines = this.kind && this.kind.objective ? this.kind.objective() : [];
    this.g.hud.setLocation(st.name, this.kind && this.kind.sub ? this.kind.sub() : st.sub, lines);
  }

  // block interactions the kinds own (exit doors, books, drains, breakers...)
  interaction(target) {
    if (!this.inside || !target || target.kind !== 'block') return null;
    const id = target.hit.id;
    if (id === B.EXIT_DOOR || id === B.EXIT_DOOR_TOP) {
      return { prompt: '<span class="key">E</span>Push the door', action: () => this.kind.onExitDoor ? this.kind.onExitDoor(target.hit) : this.exit(this.kind.exitLine) };
    }
    const r = this.kind && this.kind.interact ? this.kind.interact(target.hit) : null;
    if (r) return r;
    if (id === B.DREAM_DOOR || id === B.OFFICE_DOOR || id === B.OFFICE_DOOR_TOP) return { prompt: '<span class="key">E</span>Try the door', action: () => { this.g.audio.noiseHit(0.12, 700, 0.12, 'bandpass', 2); this.center('Locked.', '#d8d0c8', 1.5); } };
    if (id === B.CHEST) return { prompt: '<span class="key">E</span>Look inside', action: () => this._box(target.hit) };
    return null;
  }

  _box(hit) {
    const g = this.g;
    this.world.setBlock(hit.x, hit.y, hit.z, B.CHEST_OPEN);
    const n = 1 + (Math.random() < 0.35 ? 1 : 0);
    g.inventory.add('almond_water', n);
    g.hud.notify(null, 'almond_water', n);
    g.audio.pickup();
  }

  // noise the player makes (shots, grenades, landings) - the library listens
  noise(amount) { if (this.inside && this.kind && this.kind.onNoise) this.kind.onNoise(amount); }

  // the edits of the planet stay the planet's
  reset() { this.bail(false); this.d = null; if (this.world) this.world.clear(); }

  isSolidAt(x, y, z) { const b = this.world.getBlock(x, y, z); return b < 0 ? true : IS_SOLID[b] === 1; }
  isOpenAt(x, y, z) { const b = this.world.getBlock(x, y, z); return b >= 0 && (IS_AIRLIKE[b] === 1); }
}

export { clamp };
