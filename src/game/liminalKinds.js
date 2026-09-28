// What each liminal pocket asks of you once you're inside. Every place has its own way out and
// its own reason not to linger:
//   Backrooms - follow the hum to the exit; when the lights go out, keep your torch on the dark.
//   Poolrooms - follow the wet footprints down the long stair, across the flooded baths, to the
//               well of daylight, and climb out. Something else swims there.
//   Hallway   - the same corridor, again and again. Anything wrong: turn back. Nothing wrong:
//               keep going. Eight in a row and there's a door.
//   Library   - find the three books with your name on them, and walk softly. The Librarian
//               hears running, and walks through shelves.
//   Warehouse - find the breaker, then the loading door. The mannequins only move in the dark.
import * as THREE from 'three';
import { B, IS_AIRLIKE, IS_SOLID } from '../world/blocks.js';
import { clamp, lerp } from '../core/rng.js';
import {
  backroomsExit, poolStair, poolWell, poolTrail, PR, libraryBooks, warehouseExit, warehouseBreaker, prArch, STYLE,
  HALL, hallT, hallTurn, hallOpen, hallHeight, hallCeiling, HALL_DOORS, HALL_POSTERS_N, HALL_POSTERS_S, HALL_ALCOVES,
} from '../world/liminalGen.js';
import { buildNullFigure } from '../entities/horrorModels.js';
import * as HP from '../entities/hallProps.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const fm = (a, n) => ((a % n) + n) % n;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Vector3(), _c = new THREE.Color();
const box = new THREE.BoxGeometry(1, 1, 1);
function blk(parent, mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(box, mat);
  m.scale.set(w, h, d); m.position.set(x, y, z);
  parent.add(m);
  return m;
}
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

class Kind {
  constructor(L) {
    this.L = L; this.d = L.d; this.g = L.g; this.t = 0; this.dread = 0.2;
    this.goneLine = 'The door is gone.';
    this.exitLine = 'Outside.';
  }
  start() {}
  update(dt) { this.t += dt; }
  stop() {}
  objective() { return []; }
  get P() { return this.g.player; }
  get W() { return this.L.world; }
  // is this entity seen: in view, nothing in the way, and light enough to make it out
  seen(pos, h, needLight = true) {
    const L = this.L, cam = this.g.camera;
    _q.copy(pos); _q.y += h;
    const dist = cam.position.distanceTo(_q);
    if (!L.visible(_q, L.world, 1.05)) return false;
    if (!needLight || dist < 3) return true;
    const m = L.mode;
    if (m.torchK > 0.5 && dist < 34) {
      cam.getWorldDirection(_w);
      _v.copy(_q).sub(cam.position).normalize();
      if (_v.dot(_w) > 0.9) return true;
    }
    const air = this.W.getBlock(_q.x, _q.y, _q.z);
    const lit = air === B.LIT_AIR ? 1 : air === B.LIT_DIM ? 0.6 : air === B.LIT_DARK ? 0.15 : 0.5;
    return lit * L.powerK > 0.3;
  }
  // an open floor cell for something to stand in (local coords)
  standable(u, v) {
    const L = this.L;
    const a = L.get(u, 0, v), b = L.get(u, 1, v), f = L.get(u, -1, v);
    return a >= 0 && IS_AIRLIKE[a] && b >= 0 && IS_AIRLIKE[b] && f >= 0 && IS_SOLID[f];
  }
  // a hidden spot at a distance from the player to put something
  hiddenSpot(rMin, rMax, tries = 40, h = 1.2) {
    const L = this.L, p = this.P.pos;
    const [pu, pv] = L.local(p.x, p.z);
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2, r = rnd(rMin, rMax);
      const u = Math.floor(pu + Math.cos(a) * r), v = Math.floor(pv + Math.sin(a) * r);
      if (!this.standable(u, v)) continue;
      L.point(u + 0.5, h, v + 0.5, _v);
      if (L.visible(_v, L.world, 1.2)) continue;
      return [u, v];
    }
    return null;
  }
  // walk toward a point, sliding along walls; returns false if stuck
  step(obj, tx, tz, speed, dt, solidCheck = true) {
    const dx = tx - obj.position.x, dz = tz - obj.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.01) return true;
    const s = Math.min(dist, speed * dt);
    const nx = obj.position.x + dx / dist * s, nz = obj.position.z + dz / dist * s;
    if (!solidCheck) { obj.position.x = nx; obj.position.z = nz; return true; }
    const y = obj.position.y;
    const free = (x, z) => !this.L.isSolidAt(x, y + 0.2, z) && !this.L.isSolidAt(x, y + 1.2, z);
    if (free(nx, nz)) { obj.position.x = nx; obj.position.z = nz; return true; }
    if (free(nx, obj.position.z)) { obj.position.x = nx; return true; }
    if (free(obj.position.x, nz)) { obj.position.z = nz; return true; }
    return false;
  }
  face(obj, x, z, k = 1) {
    const want = Math.atan2(x - obj.position.x, z - obj.position.z);
    obj.rotation.y += wrapA(want - obj.rotation.y) * k;
  }
  // a panned whisper of a sound from a direction
  pan(x, z) {
    const cam = this.g.camera;
    cam.getWorldDirection(_w);
    const a = Math.atan2(x - cam.position.x, z - cam.position.z), yaw = Math.atan2(_w.x, _w.z);
    return clamp(Math.sin(wrapA(yaw - a)), -1, 1);
  }
}

// ======================================================================================= Backrooms
class Backrooms extends Kind {
  start() {
    this.goneLine = 'Where the door was, there is only wallpaper.';
    this.exitLine = 'The bar gives. The hum stops. Wind, grass, sky.';
    this.E = backroomsExit(this.d);
    this.bo = { on: false, t: 0, next: rnd(40, 70) };
    this.stalker = null;
    this.mercy = false;
    this.warned = false;
    this.navT = 0;
    this.g.audio.setLoop('fluoro', true, 0.4);
  }

  objective() {
    return this.bo.on ? ['The lights are out', 'Keep your torch on the dark'] : ['Find the exit', 'The hum is loudest by the door'];
  }

  update(dt) {
    super.update(dt);
    const L = this.L, g = this.g, p = this.P.pos;
    const [u, v] = L.local(p.x, p.z);
    const de = Math.hypot(u - this.E.u, v - this.E.v);
    const near = clamp(1 - de / 140, 0, 1);
    g.audio.setLoop('fluoro', true, (0.3 + near * near * 1.6) * L.powerK);
    // blackouts
    const bo = this.bo;
    if (!bo.on) {
      bo.next -= dt;
      if (bo.next <= 0) this._blackout(true);
      else if (bo.next < 2.5) L.power = Math.random() < 0.25 ? 0.4 : 1; // a stutter first
    } else {
      bo.t -= dt;
      L.power = bo.t < 1.5 ? (Math.random() < 0.5 ? 0.6 : 0.05) : 0.05;
      if (bo.t <= 0) this._blackout(false);
    }
    if (this.stalker) this._stalk(dt);
    // if you've wandered for a long time, the place lets you go
    if (!this.mercy && this.t > 420 && de > 48) this._mercyExit();
    const sd = this.stalker ? this.stalker.position.distanceTo(p) : 99;
    this.dread = 0.22 + (bo.on ? 0.3 : 0) + clamp(1 - sd / 20, 0, 1) * 0.45;
  }

  _blackout(on) {
    const L = this.L, g = this.g, bo = this.bo;
    bo.on = on;
    if (on) {
      bo.t = rnd(13, 19);
      L.power = 0.05;
      g.audio.noiseHit(0.35, 180, 0.3, 'lowpass');
      g.audio.tone(90, 0.8, 'sawtooth', 0.05, 0.4);
      if (!this.warned) { this.warned = true; L.center('The lights go out. Something else is here now.', '#e0d6b0', 4); }
      this._spawnStalker();
    } else {
      bo.next = rnd(55, 95);
      L.power = 1;
      g.audio.tone(120, 0.3, 'square', 0.03, 1.02);
      if (this.stalker) { this.stalker.removeFromParent(); this.stalker = null; }
    }
  }

  _spawnStalker() {
    const L = this.L;
    const spot = this.hiddenSpot(14, 24, 60);
    if (!spot) return;
    const m = buildNullFigure(true);
    m.scale.setScalar(1.22);
    L.point(spot[0] + 0.5, 0, spot[1] + 0.5, m.position);
    L.props.add(m);
    this.stalker = m;
    this.path = null;
  }

  // the stalker walks the grid of cells toward you, and only while it isn't seen
  _stalk(dt) {
    const L = this.L, g = this.g, m = this.stalker, p = this.P.pos;
    this.face(m, p.x, p.z, 1);
    const seen = this.seen(m.position, 2.0);
    if (seen) { m.userData.head.rotation.z = Math.sin(this.t * 30) * 0.08; return; }
    m.userData.head.rotation.z = 0;
    this.navT -= dt;
    if (this.navT <= 0) { this.navT = 0.35; this.next = this._nextCell(); }
    let tx = p.x, tz = p.z;
    if (this.next) [tx, tz] = this.next;
    this.step(m, tx, tz, 4.2, dt, false);
    if (m.position.distanceTo(_v.set(p.x, m.position.y, p.z)) < 1.2) {
      L.scare(1);
      L.hurt(28, 'the dark');
      this._blackout(false);
    }
  }

  // one step along a breadth-first path over the 4x4 cells of the maze
  _nextCell() {
    const L = this.L, p = this.P.pos, m = this.stalker;
    const [pu, pv] = L.local(p.x, p.z), [su, sv] = L.local(m.position.x, m.position.z);
    const pa = Math.floor(pu / 4), pb = Math.floor(pv / 4), sa = Math.floor(su / 4), sb = Math.floor(sv / 4);
    if (pa === sa && pb === sb) return null;
    const R = 9, N = R * 2 + 1;
    const dist = new Int16Array(N * N).fill(-1);
    const idx = (a, b) => (a - pa + R) + N * (b - pb + R);
    const open = (u, v) => { const id = L.get(u, 0, v), id2 = L.get(u, 1, v); return id >= 0 && IS_AIRLIKE[id] && id2 >= 0 && IS_AIRLIKE[id2]; };
    const pass = (a, b, da, db) => {
      if (da) { const u = 4 * (da > 0 ? a + 1 : a); for (let k = 1; k <= 3; k++) if (open(u, 4 * b + k)) return true; return false; }
      const v = 4 * (db > 0 ? b + 1 : b); for (let k = 1; k <= 3; k++) if (open(4 * a + k, v)) return true; return false;
    };
    const q = [[pa, pb]];
    dist[idx(pa, pb)] = 0;
    while (q.length) {
      const [a, b] = q.shift();
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const na = a + da, nb = b + db;
        if (Math.abs(na - pa) > R || Math.abs(nb - pb) > R || dist[idx(na, nb)] >= 0) continue;
        if (!pass(a, b, da, db)) continue;
        dist[idx(na, nb)] = dist[idx(a, b)] + 1;
        q.push([na, nb]);
      }
    }
    if (Math.abs(sa - pa) > R || Math.abs(sb - pb) > R || dist[idx(sa, sb)] < 0) {
      // lost: come in straight, through the walls
      return null;
    }
    let best = null, bd = dist[idx(sa, sb)];
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const na = sa + da, nb = sb + db;
      if (Math.abs(na - pa) > R || Math.abs(nb - pb) > R) continue;
      const dd = dist[idx(na, nb)];
      if (dd >= 0 && dd < bd && pass(sa, sb, da, db)) { bd = dd; best = [na, nb, da, db]; }
    }
    if (!best) return null;
    // aim at the opening in the wall, then the middle of the next cell
    const [na, nb, da, db] = best;
    let gu, gv;
    if (da) { gu = 4 * (da > 0 ? sa + 1 : sa); gv = 4 * sb + 2; for (let k = 1; k <= 3; k++) if (open(gu, 4 * sb + k)) { gv = 4 * sb + k; break; } }
    else { gv = 4 * (db > 0 ? sb + 1 : sb); gu = 4 * sa + 2; for (let k = 1; k <= 3; k++) if (open(4 * sa + k, gv)) { gu = 4 * sa + k; break; } }
    const close = Math.hypot(su - (gu + 0.5), sv - (gv + 0.5)) < 0.6;
    const [x, z] = close ? L.worldAt(na * 4 + 2.5, nb * 4 + 2.5) : L.worldAt(gu + 0.5, gv + 0.5);
    return [x, z];
  }

  _mercyExit() {
    const L = this.L;
    const p = this.P.pos;
    const [pu, pv] = L.local(p.x, p.z);
    for (let i = 0; i < 80; i++) {
      const a = Math.round(pu / 4 + rnd(-4, 4)), b = Math.round(pv / 4 + rnd(-4, 4));
      const u = a * 4, v = b * 4 + 2;
      if (Math.hypot(u - pu, v - pv) < 9) continue;
      if (L.get(u, 0, v) !== B.WALLPAPER || L.get(u, 1, v) !== B.WALLPAPER) continue;
      if (!IS_AIRLIKE[L.get(u - 1, 0, v)] || !IS_AIRLIKE[L.get(u + 1, 0, v)]) continue;
      L.point(u + 0.5, 1, v + 0.5, _v);
      if (L.visible(_v, L.world, 1.2)) continue;
      L.set(u, 0, v, B.EXIT_DOOR); L.set(u, 1, v, B.EXIT_DOOR_TOP); L.set(u, 2, v, B.EXIT_SIGN);
      this.E = { u, v };
      this.mercy = true;
      this.g.audio.distant('door');
      L.center('Somewhere close, a door clicks open.', '#d8f0d0', 3.5);
      return;
    }
  }
}

// ======================================================================================= Poolrooms
// a bare wet footprint, soft at the edges, toes forward (+z once laid flat)
const printTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.shadowColor = '#fff'; x.shadowBlur = 6;
  const e = (px, py, rx, ry) => { x.beginPath(); x.ellipse(px, py, rx, ry, 0, 0, Math.PI * 2); x.fill(); };
  // drawn toes-down so the flat plane's far end is the toes
  e(33, 26, 14, 17);                                   // heel
  e(24, 56, 7, 20);                                    // the outer edge of the arch
  e(32, 84, 17, 20);                                   // ball
  e(40, 112, 7, 8); e(29, 117, 5, 6); e(20, 115, 4.2, 5); e(13, 110, 3.8, 4.2); e(8, 102, 3.4, 3.6); // toes
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
})();
const printMat = new THREE.MeshBasicMaterial({ color: 0x3d5867, alphaMap: printTex, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const printGeo = new THREE.PlaneGeometry(0.15, 0.3).rotateX(-Math.PI / 2);

// the thing in the water: long, thin, and never quite at the surface
function buildSwimmer() {
  const mat = new THREE.MeshBasicMaterial({ color: 0x03080b, transparent: true, opacity: 0.8, depthWrite: false });
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.3, 4, 10).rotateX(Math.PI / 2), mat);
  body.scale.set(1.15, 0.7, 1);
  root.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8), mat);
  head.scale.set(0.9, 0.8, 1.25); head.position.set(0, 0.03, 1.02);
  root.add(head);
  const limb = (len, r) => new THREE.CapsuleGeometry(r, len, 3, 6).rotateX(Math.PI / 2).translate(0, 0, len / 2 + r);
  const arms = [], legs = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group(); a.position.set(s * 0.24, 0, 0.62);
    const upper = new THREE.Mesh(limb(0.7, 0.05), mat); a.add(upper);
    const fore = new THREE.Group(); fore.position.z = 0.8; a.add(fore);
    fore.add(new THREE.Mesh(limb(0.75, 0.04), mat));
    for (let f = -1; f <= 1; f++) {
      const fin = new THREE.Mesh(limb(0.28, 0.012), mat);
      fin.position.set(f * 0.03, 0, 0.84); fin.rotation.y = f * 0.18;
      fore.add(fin);
    }
    a.userData.fore = fore;
    root.add(a); arms.push(a);
    const l = new THREE.Group(); l.position.set(s * 0.12, 0, -0.72); l.rotation.y = Math.PI;
    l.add(new THREE.Mesh(limb(1.05, 0.06), mat));
    root.add(l); legs.push(l);
  }
  root.userData = { arms, legs, mat };
  return root;
}

class Poolrooms extends Kind {
  start() {
    this.goneLine = 'Behind you there is only tile, and the sound of water.';
    this.exitLine = 'You climb out into long grass under a real sky. Your clothes are dry.';
    this.S = poolStair(this.d);
    this.well = poolWell(this.d);
    this.minY = PR.LF - 7;
    this.trail = poolTrail(this.d);
    this.shown = new Map();     // trail index -> print mesh
    this.printT = 0;
    this.rushT = 2;
    this.said = {};
    this.grabT = 0;
    this.grabbed = false;
    this.ang = Math.random() * 6;
    this.level = 0;       // 0 rooms, 1 baths, 2 the well
    this.lowK = 0;        // how far the light has turned to the baths'
    this.wellK = 0;       // and to daylight
    this.glimpse = null;
    this.glimpseT = rnd(18, 30);
    this.shape = buildSwimmer();
    this.L.props.add(this.shape);
    this.g.audio.setLoop('fluoro', true, 0.18);
    this.g.audio.setLoop('water', true, 0.6);
  }

  sub() { return ['Level 37', 'The Lower Baths', 'The Well'][this.level]; }
  veilOpen() { return this.wellK; }
  objective() {
    if (this.level === 2) return ['Climb the stair up the wall', 'Stay out of the water'];
    if (this.level === 1) return ['Cross the baths toward the daylight', 'The footprints know the way'];
    return ['Follow the wet footprints', 'Listen for falling water'];
  }

  // the light turns bluer and dimmer in the baths, and warm and open in the well
  atmos(u, s) {
    const m = this.L.mode, lo = this.lowK * s, we = this.wellK * s;
    if (lo > 0.001) {
      u.uAmbient.value.lerp(_c.setRGB(0.2, 0.29, 0.36), lo * 0.6);
      u.uArtificial.value.lerp(_c.setRGB(0.72, 0.9, 1.08), lo * 0.5);
      u.uCaveCol.value.lerp(_c.setRGB(0.2, 0.33, 0.42), lo);
      m.scene.fog.color.lerp(_c, lo);
    }
    if (we > 0.001) {
      u.uAmbient.value.lerp(_c.setRGB(0.6, 0.6, 0.56), we * 0.7);
      u.uArtificial.value.lerp(_c.setRGB(1.1, 1.04, 0.92), we * 0.6);
      u.uFogDensity.value = lerp(u.uFogDensity.value, 1 / 220, we);
      u.uEnclosed.value = lerp(u.uEnclosed.value, 0.2, we);
      u.uCaveCol.value.lerp(_c.setRGB(0.86, 0.87, 0.82), we);
      m.scene.fog.color.lerp(_c, we);
      m.scene.fog.density = lerp(m.scene.fog.density, 1 / 200, we);
      m.sunLight.intensity = lerp(m.sunLight.intensity, 1.6 * Math.PI, we);
      m.hemi.intensity = lerp(m.hemi.intensity, 1.0 * Math.PI, we);
    }
  }

  say(key, text, t = 4) {
    if (this.said[key]) return;
    this.said[key] = true;
    this.L.center(text, '#cfe8f4', t);
  }

  update(dt) {
    super.update(dt);
    const L = this.L, g = this.g, p = this.P.pos, S = this.S, W = this.well, F = this.d.F;
    const [u, v] = L.local(p.x, p.z);
    const ly = p.y - F;
    const wr = Math.hypot(u - (W.u + 0.5), v - (W.v + 0.5));
    const i = Math.floor(u / 12), j = Math.floor(v / 12);
    const onStair = u >= S.u0 && u < S.u1 + 1 && v >= S.v0 && v < S.v1 + 1;
    this.level = wr < PR.R + 0.5 ? 2 : ly < PR.CEIL - 1 ? 1 : 0;
    this.lowK += ((this.level === 1 ? 1 : ly < -3 && onStair ? 0.5 : 0) - this.lowK) * Math.min(1, dt * 0.8);
    this.wellK += ((this.level === 2 ? clamp((PR.R + 0.5 - wr) / 3, 0, 1) : 0) - this.wellK) * Math.min(1, dt * 0.7);
    // what you notice on the way
    if (i === S.i && (j === S.j || j === S.j + 1) && ly > -1) this.say('stair', 'The stairs go down further than the floor is thick.');
    if (this.level === 1) this.say('baths', 'Under the rooms, more water. Very still. Far off, daylight.', 4.5);
    if (this.level === 2) { this.say('well', 'Real daylight. A stair climbs the wall. Stay out of the water.', 4.5); g.audio.swell(0.02); }
    // the footprints near you, all one trail, all going the same way
    this.printT -= dt;
    if (this.printT <= 0) { this.printT = 0.25; this._prints(u, v, ly); }
    // and somewhere ahead, water falling
    this.rushT -= dt;
    if (this.rushT <= 0 && this.level < 2) {
      this.rushT = rnd(3.5, 5.5);
      const [tu, tv] = this.level === 0 ? [S.bu, S.v0 + 6] : [W.u + 0.5, W.v + 0.5];
      const [tx, tz] = L.worldAt(tu, tv);
      const dd = Math.hypot(tu - u, tv - v);
      g.audio.distant('rush', { pan: this.pan(tx, tz), gain: 0.35 + clamp(1 - dd / 60, 0, 1) * 0.9 });
    }
    // the swimmer
    this._swim(dt, u, v, ly, wr);
    // out: up the last step and onto the grass
    if (ly > PR.TOP + 0.6 && wr < PR.R + 6) { L.exit(this.exitLine); return; }
    g.audio.setLoop('water', true, this.level === 1 ? 1.0 : this.level === 2 ? 0.8 * (1 - clamp((ly - PR.CEIL) / 16, 0, 0.8)) : 0.55);
    g.audio.setLoop('fluoro', true, this.level === 0 ? 0.18 : 0.04);
    g.audio.setLoop('wind', this.level === 2, 0.15 + clamp((ly - PR.LF) / 30, 0, 1) * 0.35);
  }

  _swim(dt, u, v, ly, wr) {
    const L = this.L, p = this.P.pos, W = this.well, F = this.d.F, sw = this.shape, ud = sw.userData;
    const [cx, cz] = L.worldAt(W.u + 0.5, W.v + 0.5);
    const inPool = this.level === 2 && wr < PR.R - 3.3 && ly < PR.LF + 1;
    let tx, ty, tz, speed = 1.5;
    this.grabT -= dt;
    if (inPool) {
      // it comes for you
      tx = p.x; ty = p.y + 0.5; tz = p.z; speed = 3.6;
    } else if (this.glimpse) {
      // passing under one of the baths' pools, once, far off
      const G = this.glimpse;
      G.t += dt;
      const k = G.t / G.dur;
      tx = lerp(G.a[0], G.b[0], k); tz = lerp(G.a[1], G.b[1], k); ty = G.y;
      sw.position.set(tx, ty, tz);
      speed = 0;
      if (k >= 1) this.glimpse = null;
    } else {
      this.ang += dt * 0.3;
      tx = cx + Math.cos(this.ang) * 4.3; tz = cz + Math.sin(this.ang) * 4.3; ty = F + PR.LF - 2.2 + Math.sin(this.t * 0.5) * 0.8;
    }
    if (speed > 0) {
      _v.set(tx - sw.position.x, ty - sw.position.y, tz - sw.position.z);
      const d = _v.length();
      if (d > 30) sw.position.set(tx, ty, tz);
      else if (d > 0.01) sw.position.addScaledVector(_v, Math.min(1, speed * dt / d));
    }
    // it can't leave the water
    sw.position.y = Math.min(sw.position.y, F + PR.LF + 0.35);
    _w.set(tx - sw.position.x, 0, tz - sw.position.z);
    if (_w.lengthSq() > 1e-4) {
      const want = Math.atan2(_w.x, _w.z);
      sw.rotation.y += wrapA(want - sw.rotation.y) * Math.min(1, dt * 3);
    }
    // a slow breaststroke; faster when it's coming
    const st = this.t * (inPool ? 3.2 : 1.4);
    ud.arms.forEach((a, k) => {
      const s = k ? 1 : -1;
      a.rotation.y = s * (0.35 + Math.sin(st) * 0.55);
      a.rotation.x = Math.cos(st) * 0.2;
      a.userData.fore.rotation.y = -s * (0.3 + Math.max(0, Math.sin(st + 0.8)) * 0.6);
    });
    ud.legs.forEach((l, k) => { l.rotation.x = Math.sin(st * 2 + k * Math.PI) * 0.25; });
    sw.visible = this.level === 2 || !!this.glimpse;
    ud.mat.opacity = this.glimpse ? 0.55 * Math.sin(Math.PI * clamp(this.glimpse.t / this.glimpse.dur, 0, 1)) : 0.8;
    // a glimpse in the baths now and then
    if (this.level === 1 && !this.glimpse) {
      this.glimpseT -= dt;
      if (this.glimpseT <= 0) { this.glimpseT = rnd(22, 40); this._glimpse(u, v); }
    }
    // the grab
    const ds = sw.position.distanceTo(_q.set(p.x, p.y + 0.8, p.z));
    if (inPool && ds < 1.9) {
      if (!this.grabbed) { this.grabbed = true; L.scare(0.7); L.center('Something has you.', '#e8c0c0', 2); }
      if (this.grabT <= 0) { this.grabT = 0.7; L.hurt(8, 'the deep end'); }
      // it pulls you down, then lets you go at the edge
      _w.set(p.x - cx, 0, p.z - cz).normalize();
      this.P.vel.x += _w.x * dt * 10; this.P.vel.z += _w.z * dt * 10;
      this.P.vel.y = Math.min(this.P.vel.y, -1.5);
      L.power = Math.random() < 0.5 ? 0.4 : 1;
    } else {
      if (this.grabbed) L.power = 1;
      this.grabbed = false;
    }
    this.dread = this.level === 2 ? (inPool ? 0.3 + clamp(1 - ds / 8, 0, 1) * 0.5 : 0.06) : this.level === 1 ? 0.22 : 0.14;
  }

  // a dark shape under a pool in the baths, in view, crossing and gone
  _glimpse(pu, pv) {
    const L = this.L, F = this.d.F;
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2, r = rnd(9, 22);
      const u = Math.floor(pu + Math.cos(a) * r), v = Math.floor(pv + Math.sin(a) * r);
      const du = Math.random() < 0.5 ? 1 : 0, dv = 1 - du;
      let n = 0;
      while (n < 7 && L.get(u + du * n, PR.LF - 1, v + dv * n) === B.WATER && L.get(u + du * n, PR.LF, v + dv * n) === B.WATER) n++;
      if (n < 5) continue;
      L.point(u + 0.5, PR.LF - 0.55, v + 0.5, _v);
      if (!L.visible(_v, L.world, 1.1)) continue;
      const [ax, az] = L.worldAt(u + 0.5, v + 0.5), [bx, bz] = L.worldAt(u + du * (n - 1) + 0.5, v + dv * (n - 1) + 0.5);
      this.glimpse = { a: [ax, az], b: [bx, bz], y: F + PR.LF - 0.55, t: 0, dur: 3.2 };
      this.shape.position.set(ax, F + PR.LF - 0.55, az);
      this.shape.rotation.y = Math.atan2(bx - ax, bz - az);
      this.g.audio.distant('splash');
      return;
    }
  }

  // show the stretch of the trail around you: prints fade in as you come near and out behind
  _prints(u, v, ly) {
    const L = this.L, T = this.trail, near = new Set();
    for (let k = 0; k < T.length; k++) {
      const q = T[k];
      if (Math.abs(q.y - ly) > 6) continue;
      const dd = Math.hypot(q.u - u, q.v - v);
      if (dd > 12) continue;
      near.add(k);
      let m = this.shown.get(k);
      if (m === undefined) {
        // only on dry tile
        const fu = Math.floor(q.u), fv = Math.floor(q.v);
        const a = L.get(fu, q.y, fv), f = L.get(fu, q.y - 1, fv);
        m = null;
        if (a >= 0 && IS_AIRLIKE[a] && (f === B.POOL_TILE || f === B.POOL_DEEP)) {
          m = new THREE.Mesh(printGeo, printMat.clone());
          m.scale.x = q.left ? 1 : -1;
          L.point(q.u, q.y + 0.012, q.v, m.position);
          const [wx, wz] = L.dir(q.du, q.dv);
          m.rotation.y = Math.atan2(wx, wz);
          L.props.add(m);
        }
        this.shown.set(k, m);
      }
      if (m) m.material.opacity = 0.5 * clamp((12 - dd) / 4, 0, 1);
    }
    for (const [k, m] of this.shown) {
      if (near.has(k)) continue;
      if (m) { m.removeFromParent(); m.material.dispose(); }
      this.shown.delete(k);
    }
  }

  stop() {
    for (const m of this.shown.values()) if (m) m.material.dispose();
    this.g.audio.setLoop('wind', false);
  }
}

// ======================================================================================= Hallway
// The passage you walk eight times. Every lap is the same place, and about half the time
// something in it is wrong. See something: turn back. See nothing: keep going. Either way the turn
// at the end brings you to the start of it again, and the sign says how far you've got.
const ut = (t) => HALL.u0 + t;
const PLAQUE = ['DO NOT OVERLOOK ANY ANOMALIES.', 'IF YOU SEE ONE, TURN BACK.', 'IF YOU DO NOT, KEEP GOING.', 'TO LEAVE, GO TO EXIT 8.'];
const PLAQUE_ODD = ['DO NOT OVERLOOK ANY ANOMALIES.', 'IF YOU SEE ONE, KEEP GOING.', 'IF YOU DO NOT, TURN BACK.', 'TO LEAVE, GO TO EXIT 8.'];

// the figures are modelled facing -z; this turns one round inside a holder that faces +z, which is
// what place() and face() point at things
function faceForward(f) {
  const w = new THREE.Group();
  f.rotation.y = Math.PI;
  w.add(f);
  w.userData.head = f.userData.head;
  return w;
}

// Every way a lap can be wrong. Most change a block or two; some change the furniture or the
// building itself; a few move, or can only be heard.
const HALL_ANOMS = [
  ['poster', 1], ['poster_gone', 1], ['poster_extra', 0.8], ['door', 1], ['extra_door', 1], ['doors_open', 1], ['door_ajar', 0.9],
  ['lights', 1], ['red', 0.9], ['ceiling', 1], ['water', 0.9], ['vent', 1], ['missing', 0.8], ['tv', 0.8], ['floor_hole', 0.9],
  ['mirror', 0.9], ['exit_early', 0.9], ['pilaster_gone', 0.9], ['pillar', 0.9], ['alcove_shut', 0.9], ['alcove_dark', 0.8], ['dim_passage', 0.8],
  ['sign', 1], ['plaque', 1], ['rail_gone', 0.9], ['extinguisher', 1], ['handprints', 0.9], ['clock', 0.9], ['camera', 1],
  ['poster_eyes', 1], ['vending_gone', 0.8], ['bench_moved', 0.8], ['figure', 0.9], ['still_figure', 0.9], ['knocking', 0.7],
  ['footsteps', 0.6], ['flicker', 0.8], ['long_shadow', 0.7],
];

class Hallway extends Kind {
  start() {
    this.goneLine = 'There was a door here. There is a wall.';
    this.exitLine = 'Exit 8. The door opens onto open air. Behind you, the building is small again.';
    this.count = 0;
    this.first = true;
    this.anomaly = null;
    this.lastAnom = null;
    this.edits = [];
    this.undo = [];
    this.aprops = [];
    this.dyn = null;
    this.sideClosed = false;
    this.zone = null;
    this.dip = 0;
    this.best = 0;
    this.laps = 0;
    const L = this.L;
    const place = (obj, t, y, v, du, dv) => {
      L.point(ut(t), y, v, obj.position);
      const [nx, nz] = L.dir(du, dv);
      obj.rotation.y = Math.atan2(nx, nz);
      if (!obj.parent) L.props.add(obj);
      return obj;
    };
    this.place = place;
    const face = (tex, w, h, z = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true })); m.position.z = z; return m; };
    // the signs, over each end of the passage
    this.signs = [];
    for (const t of [2, HALL.L - 3]) {
      const g = new THREE.Group();
      g.add(HP.signHousing());
      const tex = HP.pixelCanvas(64, 24, (x) => HP.drawExitSign(x, 0));
      for (const sd of [0, 1]) {
        const pl = face(tex, 1.54, 0.58, sd ? -0.058 : 0.058);
        pl.rotation.y = sd * Math.PI;
        g.add(pl);
      }
      place(g, t + 0.5, 3.28, 17.5, -1, 0);
      this.signs.push({ g, tex });
    }
    // the rules, opposite where you come in
    this.plaqueTex = HP.pixelCanvas(192, 56, (x) => HP.drawPlaque(x, PLAQUE));
    this.plaqueOdd = HP.pixelCanvas(192, 56, (x) => HP.drawPlaque(x, PLAQUE_ODD));
    this.plaque = new THREE.Group();
    this.plaque.add(HP.plaqueFrame());
    this.plaqueFace = face(this.plaqueTex, 1.92, 0.56, 0.005);
    this.plaque.add(this.plaqueFace);
    place(this.plaque, 15, 2.0, 20.96, 0, -1);
    // a clock that keeps real time
    this.clockCanvas = document.createElement('canvas'); this.clockCanvas.width = 32; this.clockCanvas.height = 32;
    this.clockTex = new THREE.CanvasTexture(this.clockCanvas);
    this.clockTex.colorSpace = THREE.SRGBColorSpace; this.clockTex.magFilter = THREE.NearestFilter;
    this.clock = new THREE.Group();
    this.clock.add(HP.clockFrame());
    this.clock.add(face(this.clockTex, 0.58, 0.58, 0.005));
    place(this.clock, 44.5, 3.0, 20.94, 0, -1);
    this.clockT = 0; this.clockSpin = 0;
    this._drawClock();
    // handrails in the bays along the south wall
    this.rails = new THREE.Group();
    L.props.add(this.rails);
    for (const t of [22.5, 30.5]) this.rails.add(place(HP.handrail(6.6), t, 0, 14.12, 1, 0));
    // a fire extinguisher by the far end, with its sign
    this.ext = new THREE.Group();
    this.ext.add(HP.extinguisher());
    const fire = face(HP.fireSign(), 0.36, 0.18, -0.12); fire.position.y = 1.25;
    this.ext.add(fire);
    this.extHome = [44.5, 14.14, 0, 1];
    this._putExt(...this.extHome);
    // a camera at the far end of the concourse, watching it
    const cam = HP.cctv();
    this.cam = new THREE.Group();
    this.cam.add(cam.arm);
    this.camHead = new THREE.Group(); this.camHead.position.y = -0.02; this.cam.add(this.camHead);
    this.camHead.add(cam.head);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.025, 0.025), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    led.position.set(0.06, 0.05, 0.2); this.camHead.add(led);
    place(this.cam, 45.4, 4.38, 19.4, 0, 1);
    this._aimCam(null);
    // a bench in a bay, drinks machines in the north alcove, a seat and a plant in the south one
    this.bench = place(HP.bench(2.4), 22.5, 0, 14.42, 0, 1);
    this.bench.rotation.y += 0;
    this.benchHome = [22.5, 14.42];
    this.vend = [place(HP.vending(0), 37.5, 0, 22.55, 0, -1), place(HP.vending(1), 38.5 + 0.05, 0, 22.55, 0, -1)];
    place(HP.bench(1.8), 38, 0, 12.4, 0, 1);
    place(HP.plant(), 36.45, 0, 12.5, 0, 1);
    place(HP.bin(), 33.2, 0, 14.3, 0, 1);
    this.g.audio.setLoop('fluoro', true, 0.35);
    this._setSigns(0);
  }

  sub() { return `Exit ${this.count}`; }
  objective() {
    const lines = [`Exit ${this.count} of 8`, 'Anything unusual: turn back', 'Nothing unusual: keep going'];
    if (this.best > 0) lines.push(`Furthest: Exit ${this.best}`);
    return lines;
  }

  _setSigns(n) {
    for (const s of this.signs) { HP.drawExitSign(s.tex.image.getContext('2d'), n); s.tex.needsUpdate = true; }
  }
  _drawClock() {
    const d = new Date();
    let h = d.getHours(), m = d.getMinutes(), sec = d.getSeconds();
    if (this.clockSpin) { const k = -this.t * 1400; m = ((k / 60) % 60 + 60) % 60; h = ((k / 3600) % 12 + 12) % 12; sec = ((k % 60) + 60) % 60; }
    HP.drawClockFace(this.clockCanvas.getContext('2d'), h, m, sec);
    this.clockTex.needsUpdate = true;
  }
  _putExt(t, v, du, dv) { this.place(this.ext, t, 0, v, du, dv); }
  _aimCam(target) {
    // it normally looks back down the concourse at whoever's coming
    this.camHead.lookAt(target || this.L.point(ut(12), 0.8, 17.5, _q));
  }

  edit(u, y, v, id) {
    const old = this.L.get(u, y, v);
    if (old < 0) return;
    this.edits.push([u, y, v, old]);
    this.L.set(u, y, v, id);
  }
  e(t, y, v, id) { this.edit(ut(t), y, v, id); }
  prop(obj) { if (!obj.parent) this.L.props.add(obj); this.aprops.push(obj); return obj; }
  hide(obj) { obj.visible = false; this.undo.push(() => { obj.visible = true; }); }

  _revert() {
    for (let i = this.edits.length - 1; i >= 0; i--) { const [u, y, v, id] = this.edits[i]; this.L.set(u, y, v, id); }
    this.edits = [];
    for (const f of this.undo) f();
    this.undo = [];
    for (const o of this.aprops) o.removeFromParent();
    this.aprops = [];
    this.dyn = null;
    this.figure = null;
    this.L.power = 1;
  }

  _apply(kind) {
    const e = (t, y, v, id) => this.e(t, y, v, id);
    const L = this.L, g = this.g;
    const hallAir = (t, fn) => { for (let v = 12; v <= 22; v++) if (hallOpen(ut(t), v)) fn(v); };
    switch (kind) {
      // ---- the blocks
      case 'poster': e(21, 1, 13, B.POSTER_ODD); break;
      case 'poster_gone': e(23, 1, 21, B.POOL_TILE); break;
      case 'poster_extra': e(24, 1, 13, B.POSTER); break;
      case 'door': e(20, 0, 21, B.DREAM_DOOR); e(20, 1, 21, B.DREAM_DOOR); break;
      case 'extra_door': e(24, 0, 21, B.OFFICE_DOOR); e(24, 1, 21, B.OFFICE_DOOR_TOP); break;
      case 'doors_open': for (const t of HALL_DOORS) { e(t, 0, 21, B.LIT_DARK); e(t, 1, 21, B.LIT_DARK); } break;
      case 'door_ajar': e(30, 0, 21, B.LIT_DARK); e(30, 1, 21, B.LIT_DARK); break;
      case 'lights':
        for (let t = 26; t < HALL.L; t++) {
          const H = hallHeight(t);
          hallAir(t, (v) => { if (hallCeiling(t, v) === B.LIGHT_PANEL) e(t, H, v, B.CEILING_TILE); for (let y = 0; y < H; y++) e(t, y, v, B.LIT_DARK); });
        }
        break;
      case 'red': for (let t = 0; t < HALL.L; t++) { const H = hallHeight(t); hallAir(t, (v) => { if (hallCeiling(t, v) === B.LIGHT_PANEL) e(t, H, v, B.EMERGENCY); }); } break;
      case 'ceiling': for (let t = 12; t <= 34; t++) hallAir(t, (v) => e(t, 4, v, B.CEILING_TILE)); break;
      case 'water': for (let t = 11; t <= 40; t++) for (let v = 14; v <= 20; v++) if (hallOpen(ut(t), v)) e(t, -1, v, B.WATER); break;
      case 'vent': e(28, 4, 21, B.EYE); break;
      case 'missing': for (let t = 27; t <= 28; t++) for (let y = 1; y <= 2; y++) e(t, y, 13, B.MISSING); break;
      case 'tv': e(31, 0, 19, B.TV); break;
      case 'floor_hole': e(24, -1, 17, B.VOID); break;
      case 'mirror':
        // the doors and posters have swapped walls
        for (const t of HALL_DOORS) { e(t, 0, 21, B.POOL_DEEP); e(t, 1, 21, B.POOL_TILE); e(t, 0, 13, B.OFFICE_DOOR); e(t, 1, 13, B.OFFICE_DOOR_TOP); }
        for (const t of HALL_POSTERS_N) { e(t, 1, 21, B.POOL_TILE); e(t, 1, 13, B.POSTER); }
        for (const t of HALL_POSTERS_S) { e(t, 1, 13, B.POOL_TILE); e(t, 1, 21, B.POSTER); }
        break;
      case 'exit_early': e(30, 0, 21, B.EXIT_DOOR); e(30, 1, 21, B.EXIT_DOOR_TOP); e(30, 2, 21, B.EXIT_SIGN); break;
      // ---- the building
      case 'pilaster_gone': for (let y = 0; y <= 4; y++) e(26, y, 14, B.LIT_AIR); break;
      case 'pillar': for (let y = 0; y <= 4; y++) e(29, y, 17, y === 0 || y === 3 ? B.POOL_DEEP : B.CONCRETE); break;
      case 'alcove_shut':
        for (let t = HALL_ALCOVES.north[0]; t <= HALL_ALCOVES.north[1]; t++) for (let y = 0; y <= 4; y++) e(t, y, 21, y === 0 || y === 3 ? B.POOL_DEEP : B.POOL_TILE);
        for (const m of this.vend) this.hide(m);
        break;
      case 'alcove_dark':
        for (let t = HALL_ALCOVES.north[0]; t <= HALL_ALCOVES.north[1]; t++) { e(t, 5, 21, B.CEILING_TILE); e(t, 5, 22, B.CEILING_TILE); for (let y = 0; y <= 4; y++) { e(t, y, 21, B.LIT_DARK); e(t, y, 22, B.LIT_DARK); } }
        break;
      case 'dim_passage':
        // the far passage has lost its lights
        for (let t = HALL.hall1 + 1; t < HALL.L; t++) for (let v = 16; v <= 18; v++) for (let y = 0; y <= 3; y++) e(t, y, v, B.LIT_DIM);
        for (let t = HALL.hall1 + 1; t < HALL.L; t++) if (fm(t, 4) === 1) e(t, 4, 17, B.CEILING_TILE);
        break;
      // ---- the furniture
      case 'sign': break; // handled with the signs
      case 'plaque': this.plaqueFace.material.map = this.plaqueOdd; this.plaqueFace.material.needsUpdate = true; this.undo.push(() => { this.plaqueFace.material.map = this.plaqueTex; this.plaqueFace.material.needsUpdate = true; }); break;
      case 'rail_gone': this.hide(this.rails); break;
      case 'extinguisher': this._putExt(44.5, 20.85, 0, -1); this.undo.push(() => this._putExt(...this.extHome)); break;
      case 'vending_gone': this.hide(this.vend[1]); break;
      case 'bench_moved': this.place(this.bench, 22.5, 0, 20.58, 0, -1); this.undo.push(() => this.place(this.bench, this.benchHome[0], 0, this.benchHome[1], 0, 1)); break;
      case 'handprints': {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.25), new THREE.MeshBasicMaterial({ map: HP.pixelCanvas(64, 40, HP.drawHandprints), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
        this.prop(this.place(m, 30.5, 1.55, 14.02, 0, 1));
        break;
      }
      case 'clock': this.clockSpin = 1; this.undo.push(() => { this.clockSpin = 0; this._drawClock(); }); break;
      case 'camera': this.dyn = () => this._aimCam(_w.copy(g.camera.position)); this.undo.push(() => this._aimCam(null)); break;
      case 'poster_eyes': {
        // the sun on the poster by the door has eyes, and they follow you
        const eyes = new THREE.Group();
        const white = new THREE.MeshBasicMaterial({ color: 0xf2eee4 }), dark = new THREE.MeshBasicMaterial({ color: 0x0a0806 });
        const list = [];
        for (const s of [-1, 1]) {
          const eg = new THREE.Group(); eg.position.set(s * 0.12, 0, 0);
          eg.add(new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.06), white));
          const pu = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), dark); pu.position.z = 0.035; eg.add(pu);
          eyes.add(eg); list.push(eg);
        }
        this.prop(this.place(eyes, 12.4, 1.66, 20.97, 0, -1));
        this.dyn = () => { for (const eg of list) eg.lookAt(g.camera.position); };
        break;
      }
      case 'long_shadow': {
        // a shadow on the wall with nobody to cast it
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 2.4), new THREE.MeshBasicMaterial({ map: HP.pixelCanvas(16, 40, HP.drawShadow), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
        this.prop(this.place(m, 32.5, 1.2, 20.97, 0, -1));
        break;
      }
      // ---- the things that move, or that you only hear
      case 'figure': {
        const f = faceForward(buildNullFigure(true));
        this.prop(this.place(f, HALL.hall1 - 1.5, 0, 17.5, -1, 0));
        this.figure = f;
        break;
      }
      case 'still_figure': {
        // someone standing with their face to the wall; it turns its head as you pass
        const f = faceForward(buildNullFigure(false));
        this.prop(this.place(f, 29.5, 0, 20.3, 0, 1));
        const head = f.userData.head;
        this.dyn = () => {
          const d = f.position.distanceTo(g.camera.position);
          if (d < 4.5) head.rotation.y += (Math.PI - head.rotation.y) * 0.04;
        };
        break;
      }
      case 'knocking': {
        let done = false;
        this.dyn = () => {
          const [u] = L.local(this.P.pos.x, this.P.pos.z);
          const t = u - HALL.u0;
          if (!done && t > 17 && t < 24) {
            done = true;
            for (let k = 0; k < 3; k++) setTimeout(() => { g.audio.noiseHit(0.12, 180, 0.35, 'lowpass', 1); g.audio.noiseHit(0.05, 900, 0.05, 'bandpass', 2); }, 200 + k * 330);
            this.L.mode.horror.shake = Math.max(this.L.mode.horror.shake, 0.12);
          }
        };
        break;
      }
      case 'footsteps': {
        // someone walks when you walk, a step behind
        let acc = 0;
        this.dyn = (dt) => {
          const sp = Math.hypot(this.P.vel.x, this.P.vel.z);
          if (sp < 1 || !this.P.onGround) return;
          acc += sp * dt;
          if (acc > 1.35) { acc = 0; setTimeout(() => g.audio.footstep('hard'), 240); }
        };
        break;
      }
      case 'flicker': this.dyn = () => { L.power = Math.random() < 0.08 ? 0.12 : Math.random() < 0.05 ? 0.5 : 1; }; break;
      default: break;
    }
  }

  // came through the middle of the turn: judge the lap you just walked, and change the next one
  _cross(dir) {
    const L = this.L;
    if (this.first) this.first = false;
    else {
      this.laps++;
      const correct = this.anomaly ? dir < 0 : dir > 0;
      if (correct) {
        this.count = Math.min(8, this.count + 1);
        this.g.audio.distant('chime');
      } else {
        // wrong: back to the beginning, and the lights know it
        if (this.count > 0) this.L.center(this.anomaly ? 'You walked past something.' : 'There was nothing there.', '#d8c8b8', 2.2);
        this.count = 0;
        this.dip = 0.45;
        this.g.audio.distant('thud');
      }
      this.best = Math.max(this.best, this.count);
    }
    if (!this.sideClosed) {
      this.sideClosed = true;
      for (const u of [6, 7]) for (let y = 0; y <= 2; y++) L.set(u, y, 13, y === 0 ? B.POOL_DEEP : B.POOL_TILE);
    }
    this._revert();
    let sign = this.count;
    if (this.count >= 8) {
      // the end of the passage is a door
      this.anomaly = null;
      for (let v = 16; v <= 18; v++) for (let y = 0; y <= 3; y++) {
        const id = v === 17 ? (y === 0 ? B.EXIT_DOOR : y === 1 ? B.EXIT_DOOR_TOP : y === 2 ? B.EXIT_SIGN : B.POOL_TILE) : B.POOL_TILE;
        this.e(HALL.L, y, v, id);
      }
    } else {
      // Exit 0 is always the passage as it should be, so you can learn what normal looks like
      const clean = this.count === 0;
      const pool = HALL_ANOMS.filter(([a]) => a !== this.lastAnom);
      let total = 0; for (const [, w] of pool) total += w;
      let r = Math.random() * total, pick = pool[0][0];
      for (const [a, w] of pool) { r -= w; if (r <= 0) { pick = a; break; } }
      this.anomaly = !clean && Math.random() < 0.58 ? pick : null;
      if (this.anomaly) { this.lastAnom = this.anomaly; this._apply(this.anomaly); }
      if (this.anomaly === 'sign') sign = (this.count + 2 + Math.floor(Math.random() * 6)) % 10;
    }
    this._setSigns(sign);
  }

  onExitDoor(hit) {
    const [u] = this.L.cellLocal(hit.x, hit.z);
    if (this.count >= 8 && hallT(u) === HALL.L) { this.L.exit(this.exitLine); return; }
    this.L.center('The handle turns, but the door will not open. Something on the other side is holding it.', '#e8c0c0', 3.5);
    this.g.audio.distant('thud');
    this.L.scare(0.35);
  }

  update(dt) {
    super.update(dt);
    const L = this.L, p = this.P.pos;
    const [u, v] = L.local(p.x, p.z);
    const t = hallT(u);
    // In the shaft of the turn. Its top half leads back to the passage you came from, its bottom
    // half on to the next. Come down through the middle: one lap on. Go up through it (you turned
    // back): half round about the middle, and you're on your way to the start again.
    const inShaft = t >= HALL.L + 6 && t < HALL.L + 10 && v >= 10 && v < 25;
    if (!inShaft) this.zone = null;
    else {
      const side = v >= 19.5 ? 'top' : v < 15.5 ? 'bottom' : null;
      if (side && this.zone && side !== this.zone) {
        const k = Math.floor((u - HALL.u0) / HALL.P);
        if (side === 'bottom') {
          L.shift(-(k + 1) * HALL.P, 0);
          this._cross(1);
        } else {
          L.turn(hallTurn(k), HALL.cv);
          if (k !== -1) L.shift(-(k + 1) * HALL.P, 0);
          this._cross(-1);
        }
        this.zone = 'bottom';
      } else if (side) this.zone = side;
    }
    if (this.dyn) this.dyn(dt);
    // the clock
    this.clockT -= dt;
    if (this.clockT <= 0) { this.clockT = this.clockSpin ? 0.05 : 1; this._drawClock(); }
    // lights: a dip when you get it wrong; the furniture dims with them
    if (this.dip > 0) { this.dip -= dt; L.power = this.dip > 0.15 ? 0.1 : 1; }
    HP.hallPropMaterial().color.setScalar(clamp(L.powerK, 0.12, 1));
    // the man at the end of the concourse comes closer when you look away
    const f = this.figure;
    let fd = 99;
    if (f) {
      this.face(f, p.x, p.z, 1);
      fd = Math.hypot(f.position.x - p.x, f.position.z - p.z);
      if (!this.seen(f.position, 1.8, false)) {
        const [, fv] = L.local(f.position.x, f.position.z);
        const [tx, tz] = L.worldAt(u, fv);
        this.step(f, tx, tz, 2.6, dt, false);
        if (Math.random() < dt * 0.6) this.g.audio.footstep('hard');
      }
      if (fd < 1.3) {
        L.scare(1);
        L.hurt(22, 'the man in the hallway');
        this.count = 0;
        this._setSigns(0);
        f.removeFromParent(); this.figure = null;
      }
    }
    this.dread = 0.16 + (this.anomaly ? 0.08 : 0) + (f ? clamp(1 - fd / 30, 0, 1) * 0.55 : 0);
  }

  stop() { HP.hallPropMaterial().color.setScalar(1); }
}

// ======================================================================================= Library
const TITLES = ['The Book of Your Name', 'Everything You Forgot, Volume II', 'Where You Were Going', 'Your Handwriting', 'A Map of This Room', 'The Last Page Is Blank'];
function buildLibrarian() {
  const g = new THREE.Group();
  const robe = new THREE.MeshLambertMaterial({ color: 0x14100d });
  const skin = new THREE.MeshLambertMaterial({ color: 0xd8d0c4, emissive: 0x151412 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffc070 });
  const body = new THREE.Group(); g.add(body);
  blk(body, robe, 0.9, 2.0, 0.6, 0, 1.0, 0);
  blk(body, robe, 0.62, 0.5, 0.45, 0, 2.2, 0);
  const head = new THREE.Group(); head.position.set(0, 2.62, 0); body.add(head);
  blk(head, skin, 0.34, 0.5, 0.36, 0, 0, 0);
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.42, 2.35, 0); body.add(arm);
    blk(arm, robe, 0.16, 1.5, 0.16, 0, -0.75, 0);
    blk(arm, skin, 0.1, 0.45, 0.1, 0, -1.65, 0);
    if (s > 0) { blk(arm, glow, 0.18, 0.24, 0.18, 0, -2.0, 0.05); }
    arm.rotation.x = -0.15;
  }
  g.userData = { head, body };
  return g;
}

class Library extends Kind {
  start() {
    this.goneLine = 'Where the door was, there is a shelf. None of the books have titles.';
    this.exitLine = 'You step out into the air. You can\'t remember what the books were called.';
    this.books = libraryBooks(this.d).map((b) => ({ ...b, got: false }));
    this.have = 0;
    this.noise = 0;
    this.shiftT = rnd(12, 18);
    this.rustleT = 6;
    this.exitOpen = false;
    const lib = buildLibrarian();
    const [x, z] = this.L.worldAt(6.5 + rnd(-30, 30), 50 + rnd(0, 20));
    lib.position.set(x, this.d.F, z);
    this.L.props.add(lib);
    this.lib = { m: lib, state: 'wander', target: null, lost: 0 };
    this.wasGround = true;
  }

  objective() {
    const q = clamp(this.noise, 0, 1);
    const bar = '▮'.repeat(Math.round(q * 4)) + '▯'.repeat(4 - Math.round(q * 4));
    if (this.exitOpen) return ['A door has opened somewhere near', `Noise ${bar}`];
    return [`Books with your name: ${this.have}/3`, 'Listen for pages turning; look for a lamp over an aisle', `Noise ${bar}`];
  }

  interact(hit) {
    if (hit.id !== B.GLOW_BOOK) return null;
    return { prompt: '<span class="key">E</span>Take the book', action: () => this._take(hit) };
  }

  onNoise(a) { this.noise += a; }

  _take(hit) {
    const L = this.L, g = this.g;
    this.W.setBlock(hit.x, hit.y, hit.z, B.BOOKSHELF);
    const [u, v] = L.cellLocal(hit.x, hit.z);
    const b = this.books.find((q) => q.u === u && q.v === v) || this.books.find((q) => !q.got);
    if (b) b.got = true;
    this.have = this.books.filter((q) => q.got).length;
    g.audio.distant('chime');
    L.center(`"${TITLES[Math.floor(Math.random() * TITLES.length)]}" - the name on the spine is yours.`, '#f4dca0', 3.5);
    if (this.have >= 3 && !this.exitOpen) this._openExit();
  }

  _openExit() {
    const L = this.L, p = this.P.pos;
    const [pu, pv] = L.local(p.x, p.z);
    for (let i = 0; i < 120; i++) {
      const u = Math.floor(pu + rnd(-16, 16)), r = Math.floor(pv / 5) + Math.floor(rnd(-3, 3));
      const v = r * 5 + 3;
      if (Math.hypot(u - pu, v - pv) < 7) continue;
      if (L.get(u, 0, v) !== B.BOOKSHELF || L.get(u, 1, v) !== B.BOOKSHELF || !IS_AIRLIKE[L.get(u, 0, v - 1)]) continue;
      L.point(u + 0.5, 1, v + 0.5, _v);
      if (L.visible(_v, L.world, 1.2)) continue;
      L.set(u, 0, v, B.EXIT_DOOR); L.set(u, 1, v, B.EXIT_DOOR_TOP); L.set(u, 2, v, B.EXIT_SIGN);
      this.exitOpen = true;
      this.g.audio.distant('door');
      L.center('Somewhere near, a door creaks open. Something heard it too.', '#f0e0c0', 4);
      this.lib.state = 'hunt'; this.lib.lost = 0;
      return;
    }
  }

  update(dt) {
    super.update(dt);
    const L = this.L, g = this.g, P = this.P, p = P.pos;
    // how much noise you're making
    const moving = Math.hypot(P.vel.x, P.vel.z) > 0.5;
    if (P.sprinting && moving) this.noise += dt * 1.15;
    if (this.wasGround && !P.onGround && P.vel.y > 2) this.noise += 0.3;
    this.wasGround = P.onGround;
    this.noise = Math.max(0, this.noise - dt * 0.3);
    const lb = this.lib, m = lb.m;
    const dl = Math.hypot(m.position.x - p.x, m.position.z - p.z);
    if (this.noise >= 1) {
      this.noise = 0.35;
      if (dl < 48) { lb.state = lb.state === 'hunt' ? 'hunt' : 'listen'; lb.target = [p.x, p.z]; lb.lost = 0; g.audio.whisper(0.06, this.pan(m.position.x, m.position.z)); L.center('Shhh.', '#c8b8a0', 1.5); }
    }
    // it sees you if it's close, faces you and nothing's in the way
    _v.set(m.position.x, m.position.y + 2.6, m.position.z);
    _w.set(p.x, p.y + 1.5, p.z).sub(_v);
    const dd = _w.length();
    const sees = dd < 13 && !this.W.raycast(_v, _w.normalize(), dd - 0.5);
    if (sees && (lb.state === 'listen' || P.sprinting || lb.state === 'hunt')) { lb.state = 'hunt'; lb.lost = 0; }
    if (lb.state === 'hunt') { lb.target = [p.x, p.z]; if (!sees) { lb.lost += dt; if (lb.lost > (this.exitOpen ? 20 : 8)) lb.state = 'wander'; } }
    if (!lb.target || (lb.state === 'wander' && Math.hypot(m.position.x - lb.target[0], m.position.z - lb.target[1]) < 1)) {
      const [x, z] = L.worldAt(L.local(p.x, p.z)[0] + rnd(-30, 30), L.local(p.x, p.z)[1] + rnd(-30, 30));
      lb.target = [x, z];
    }
    const speed = lb.state === 'hunt' ? (this.exitOpen ? 4.6 : 4.1) : lb.state === 'listen' ? 3.0 : 1.4;
    this.step(m, lb.target[0], lb.target[1], speed, dt, false);
    this.face(m, lb.target[0], lb.target[1], Math.min(1, dt * 4));
    m.userData.body.position.y = Math.sin(this.t * 1.3) * 0.05;
    if (lb.state === 'listen' && Math.hypot(m.position.x - lb.target[0], m.position.z - lb.target[1]) < 1) lb.state = 'wander';
    // the lamps gutter as it passes
    L.power = dl < 16 ? (Math.random() < 0.2 ? 0.25 : 0.55 + 0.45 * dl / 16) : 1;
    if (dl < 1.3) this._caught();
    // shelves move when nobody is looking
    this.shiftT -= dt;
    if (this.shiftT <= 0) { this.shiftT = rnd(12, 20); this._shift(); }
    // pages turning, from the nearest book you haven't found
    this.rustleT -= dt;
    let next = null, nd = 1e9;
    for (const q of this.books) {
      if (q.got) continue;
      const [bx, bz] = L.worldAt(q.u + 0.5, q.v + 0.5);
      const db = Math.hypot(bx - p.x, bz - p.z);
      if (db < nd) { nd = db; next = [bx, bz]; }
    }
    if (next && this.rustleT <= 0 && !this.exitOpen) {
      this.rustleT = rnd(4.5, 7);
      g.audio.whisper(0.025 + clamp(1 - nd / 60, 0, 1) * 0.06, this.pan(next[0], next[1]));
      if (nd < 14) g.audio.distant('steps', { pan: this.pan(next[0], next[1]), gain: 0.4 });
    }
    this.dread = 0.24 + clamp(1 - dl / 30, 0, 1) * 0.45 + (lb.state === 'hunt' ? 0.25 : 0);
  }

  _caught() {
    const L = this.L;
    L.scare(1);
    L.hurt(30, 'the Librarian');
    const got = this.books.filter((q) => q.got);
    if (got.length && !this.exitOpen) {
      const b = got[Math.floor(Math.random() * got.length)];
      b.got = false;
      L.set(b.u, b.y, b.v, B.GLOW_BOOK);
      this.have = this.books.filter((q) => q.got).length;
      L.center('It takes a book back and puts it on a shelf, somewhere.', '#e0c8c8', 4);
    }
    const lb = this.lib;
    const [pu, pv] = L.local(this.P.pos.x, this.P.pos.z);
    const a = Math.random() * Math.PI * 2;
    const [x, z] = L.worldAt(pu + Math.cos(a) * 40, pv + Math.sin(a) * 40);
    lb.m.position.set(x, this.d.F, z);
    lb.state = 'wander'; lb.target = null;
    this.noise = 0;
  }

  _shift() {
    const L = this.L, p = this.P.pos;
    const [pu, pv] = L.local(p.x, p.z);
    for (let i = 0; i < 12; i++) {
      const r = Math.floor(pv / 5) + Math.floor(rnd(-4, 5));
      const s = Math.floor(pu / 11) + Math.floor(rnd(-2, 3));
      const u0 = s * 11, v0 = r * 5 + 3;
      if (Math.abs(v0 + 1 - pv) < 3 && Math.abs(u0 + 1 - pu) < 3) continue;
      const cells = [[u0, v0], [u0 + 1, v0], [u0, v0 + 1], [u0 + 1, v0 + 1]];
      if (cells.some(([u, v]) => { const id = L.get(u, 1, v); return id < 0 || id === B.GLOW_BOOK || id === B.EXIT_DOOR || id === B.EXIT_DOOR_TOP; })) continue;
      if (cells.some(([u, v]) => { L.point(u + 0.5, 1, v + 0.5, _v); if (L.visible(_v, L.world, 1.3)) return true; L.point(u + 0.5, 4, v + 0.5, _v); return L.visible(_v, L.world, 1.3); })) continue;
      const open = IS_AIRLIKE[L.get(u0, 1, v0)];
      const air = L.get(u0, 1, v0 - 1);
      for (const [u, v] of cells) for (let y = 0; y <= 5; y++) L.set(u, y, v, open ? B.BOOKSHELF : (IS_AIRLIKE[air] ? air : B.LIT_DIM));
      this.g.audio.distant('thud');
      return;
    }
  }
}

// ======================================================================================= Warehouse
function buildMannequin() {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xdcd6cc, emissive: 0x050505 });
  const joint = new THREE.MeshLambertMaterial({ color: 0x9a948a });
  const hips = new THREE.Group(); hips.position.y = 0.95; g.add(hips);
  blk(hips, mat, 0.5, 0.75, 0.28, 0, 0.45, 0);
  blk(hips, mat, 0.42, 0.18, 0.26, 0, 0.02, 0);
  const head = new THREE.Group(); head.position.set(0, 1.08, 0); hips.add(head);
  blk(head, mat, 0.3, 0.38, 0.32, 0, 0.12, 0);
  blk(head, joint, 0.1, 0.12, 0.1, 0, -0.12, 0);
  const limbs = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group(); arm.position.set(s * 0.34, 0.78, 0); hips.add(arm);
    blk(arm, joint, 0.11, 0.11, 0.11, 0, 0, 0);
    blk(arm, mat, 0.11, 0.75, 0.11, 0, -0.42, 0);
    const leg = new THREE.Group(); leg.position.set(s * 0.13, -0.05, 0); hips.add(leg);
    blk(leg, mat, 0.15, 0.9, 0.15, 0, -0.45, 0);
    limbs.push(arm, leg);
  }
  g.userData = { head, limbs };
  return g;
}

class Warehouse extends Kind {
  start() {
    this.goneLine = 'The door is a sheet of metal now. Out in the dark, something plastic clicks.';
    this.exitLine = 'Daylight. The shutter rattles down behind you. The shed is locked again.';
    this.E = warehouseExit(this.d);
    this.K = warehouseBreaker(this.d);
    this.powered = false;
    this.seq = -1;
    this.roll = -1;
    this.open = false;
    this.man = [];
    this.spawnT = 3;
    this.clickT = 0;
    this.g.audio.setLoop('fluoro', true, 0.12);
  }

  objective() {
    return this.open ? ['The loading door is open', 'Get to the daylight'] : this.powered ? ['The loading door is opening', 'Keep your torch on them'] : ['Find the breaker in the office', 'They only move in the dark'];
  }

  interact(hit) {
    if (hit.id === B.BREAKER) return { prompt: this.powered ? 'The breaker is thrown' : '<span class="key">E</span>Throw the breaker', action: () => this._power() };
    if (hit.id === B.ROLLER) return { prompt: '<span class="key">E</span>Try the loading door', action: () => { if (!this.powered) { this.L.center('It won\'t move. There\'s no power.', '#d0d4dc', 2); this.g.audio.noiseHit(0.3, 300, 0.2, 'lowpass'); } } };
    return null;
  }

  _power() {
    if (this.powered) return;
    const g = this.g;
    this.powered = true;
    this.seq = 0;
    g.audio.noiseHit(0.4, 200, 0.35, 'lowpass');
    g.audio.alert();
    this.L.center('A heavy clunk. The lights surge.', '#e8ecf4', 3);
    for (let i = 0; i < 3; i++) this._spawn();
  }

  _spawn() {
    const spot = this.hiddenSpot(12, 30, 50);
    if (!spot) return;
    const m = buildMannequin();
    this.L.point(spot[0] + 0.5, 0, spot[1] + 0.5, m.position);
    m.rotation.y = Math.random() * Math.PI * 2;
    this.L.props.add(m);
    this.man.push({ m, stuck: 0, moved: false });
  }

  update(dt) {
    super.update(dt);
    const L = this.L, g = this.g, p = this.P.pos;
    // the breaker sequence: surge, blackout, and the shutter starts to rise
    if (this.seq >= 0) {
      this.seq += dt;
      const s = this.seq;
      L.power = s < 1.2 ? 1.8 : s < 3.8 ? (Math.random() < 0.15 ? 0.5 : 0.03) : 1;
      if (s > 3.8 && this.roll < 0) { this.roll = 0; g.audio.noiseHit(3.5, 260, 0.25, 'lowpass', 0.6); L.center('Far away, a shutter starts to rise.', '#e8ecf4', 3); }
      if (s > 4) this.seq = -1;
    }
    if (this.roll >= 0 && !this.open) {
      this.roll += dt;
      const rows = Math.min(4, Math.floor(this.roll / 1.1));
      for (let y = 0; y < rows; y++) for (let du = -2; du <= 1; du++) {
        if (L.get(this.E.u + du, y, this.E.v) === B.ROLLER) {
          L.set(this.E.u + du, y, this.E.v, B.LIT_AIR);
          for (let dv = 1; dv <= 3; dv++) L.set(this.E.u + du, y, this.E.v + dv, dv === 3 ? B.LIGHT_PANEL : B.LIT_AIR);
        }
      }
      if (rows >= 4) this.open = true;
    }
    if (this.open) {
      const [u, v] = L.local(p.x, p.z);
      if (v >= this.E.v + 0.3 && u >= this.E.u - 2.2 && u <= this.E.u + 2.2) { L.exit(this.exitLine); return; }
    }
    // mannequins
    this.spawnT -= dt;
    const want = this.powered ? 7 : 5;
    if (this.spawnT <= 0) { this.spawnT = 3; if (this.man.length < want) this._spawn(); }
    let nearest = 99;
    const surge = this.seq >= 1.2 && this.seq < 3.8;
    for (const q of this.man) {
      const m = q.m;
      const d = Math.hypot(m.position.x - p.x, m.position.z - p.z);
      nearest = Math.min(nearest, d);
      if (d > 48) { m.removeFromParent(); q.dead = true; continue; }
      const seen = this.seen(m.position, 1.5);
      if (seen) {
        if (q.moved && this.clickT <= 0) { this.clickT = 0.6; g.audio.clicks(0.04, this.pan(m.position.x, m.position.z)); }
        q.moved = false;
        continue;
      }
      q.moved = true;
      this.face(m, p.x, p.z, 1);
      m.userData.head.rotation.y = Math.sin(this.t * 7 + m.position.x) * 0.3;
      const ok = this.step(m, p.x, p.z, surge ? 7 : 4.0, dt, true);
      q.stuck = ok ? 0 : q.stuck + dt;
      if (q.stuck > 1.2) {
        const spot = this.hiddenSpot(Math.max(5, d * 0.6), Math.max(8, d * 0.9), 20);
        if (spot) L.point(spot[0] + 0.5, 0, spot[1] + 0.5, m.position);
        q.stuck = 0;
      }
      if (d < 1.15) {
        L.scare(0.8);
        L.hurt(22, 'a mannequin');
        _w.set(p.x - m.position.x, 0, p.z - m.position.z).normalize();
        this.P.vel.x += _w.x * 9; this.P.vel.z += _w.z * 9; this.P.vel.y = 5;
        const spot = this.hiddenSpot(22, 34, 30);
        if (spot) L.point(spot[0] + 0.5, 0, spot[1] + 0.5, m.position); else { m.removeFromParent(); q.dead = true; }
      }
    }
    this.man = this.man.filter((q) => !q.dead);
    this.clickT -= dt;
    // a hint of daylight from the loading door: the wind outside
    const [ex, ez] = L.worldAt(this.E.u, this.E.v);
    const de = Math.hypot(ex - p.x, ez - p.z);
    g.audio.setLoop('wind', de < 30, clamp(1 - de / 30, 0, 1) * 0.6);
    this.dread = 0.3 + clamp(1 - nearest / 18, 0, 1) * 0.5 + (surge ? 0.2 : 0);
  }

  stop() { this.g.audio.setLoop('wind', false); }
}

export const KINDS = { backrooms: Backrooms, poolrooms: Poolrooms, hallway: Hallway, library: Library, warehouse: Warehouse };
export { STYLE };
