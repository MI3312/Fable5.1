// What each liminal pocket asks of you once you're inside. Every place has its own way out and
// its own reason not to linger:
//   Backrooms - follow the hum to the exit; when the lights go out, keep your torch on the dark.
//   Poolrooms - follow the wet footprints to the warm pool and dive for the drain. Something
//               else swims there.
//   Hallway   - the same corridor, again and again. Anything wrong: turn back. Nothing wrong:
//               keep going. Eight in a row and there's a door.
//   Library   - find the three books with your name on them, and walk softly. The Librarian
//               hears running, and walks through shelves.
//   Warehouse - find the breaker, then the loading door. The mannequins only move in the dark.
import * as THREE from 'three';
import { B, IS_AIRLIKE, IS_SOLID } from '../world/blocks.js';
import { clamp, lerp } from '../core/rng.js';
import {
  backroomsExit, poolExit, libraryBooks, warehouseExit, warehouseBreaker, prArch, HALL, STYLE,
} from '../world/liminalGen.js';
import { buildNullFigure } from '../entities/horrorModels.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const fm = (a, n) => ((a % n) + n) % n;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Vector3();
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
const printMat = new THREE.MeshBasicMaterial({ color: 0x223a48, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
// a bare wet footprint: the ball of the foot and a heel
const printGeo = (() => {
  const sh = new THREE.Shape();
  sh.absellipse(0, 0.06, 0.065, 0.11, 0, Math.PI * 2, false, 0);
  const heel = new THREE.Path();
  heel.absellipse(0, -0.12, 0.048, 0.06, 0, Math.PI * 2, false, 0);
  const g = new THREE.ShapeGeometry([sh, new THREE.Shape(heel.getPoints(12))], 10);
  return g.rotateX(-Math.PI / 2);
})();
class Poolrooms extends Kind {
  start() {
    this.goneLine = 'Behind you there is only tile, and the sound of water.';
    this.exitLine = 'You come up gasping in the grass. Your clothes are dry.';
    this.E = poolExit(this.d);
    this.prints = [];
    this.printT = 4;
    this.warmSaid = false;
    this.grabT = 0;
    this.grabbed = false;
    this.ang = 0;
    // the thing in the warm pool
    const mat = new THREE.MeshBasicMaterial({ color: 0x02070a, transparent: true, opacity: 0.82, depthWrite: false });
    const shape = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
    body.scale.set(0.9, 0.55, 2.4);
    shape.add(body);
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), mat);
      arm.scale.set(0.18, 0.12, 1.5); arm.position.set(s * 0.9, 0, 0.8); arm.rotation.y = s * 0.5;
      shape.add(arm);
    }
    this.L.props.add(shape);
    this.shape = shape;
    this.g.audio.setLoop('fluoro', true, 0.18);
    this.g.audio.setLoop('water', true, 0.7);
  }

  objective() { return ['Follow the wet footprints', 'The way out is at the bottom of the warm pool']; }

  update(dt) {
    super.update(dt);
    const L = this.L, g = this.g, p = this.P.pos, E = this.E;
    const [u, v] = L.local(p.x, p.z);
    const i = Math.floor(u / 12), j = Math.floor(v / 12);
    const inExitRoom = i === E.i && j === E.j;
    if (inExitRoom && !this.warmSaid) { this.warmSaid = true; L.center('The water here is warm. The lights are off.', '#cfe8f4', 4); g.audio.swell(0.05); }
    // footprints leading on
    this.printT -= dt;
    if (this.printT <= 0 && !inExitRoom) { this.printT = rnd(6, 9); this._trail(u, v, i, j); }
    for (const pr of this.prints) { pr.t -= dt; pr.m.material.opacity = 0.45 * clamp(pr.t / 4, 0, 1); }
    for (const pr of this.prints.filter((q) => q.t <= 0)) { pr.m.removeFromParent(); }
    this.prints = this.prints.filter((q) => q.t > 0);
    // the swimmer circles the drain
    this.ang += dt * (this.grabbed ? 0 : 0.42);
    const [cx, cz] = L.worldAt(E.u + 0.5, E.v + 0.5);
    const sw = this.shape;
    sw.position.set(cx + Math.cos(this.ang) * 3.1, this.d.F - 6.5 + Math.sin(this.t * 0.6) * 1.8, cz + Math.sin(this.ang) * 3.1);
    sw.rotation.y = -this.ang;
    const inWater = inExitRoom && p.y < this.d.F - 0.4;
    const ds = sw.position.distanceTo(_v.set(p.x, p.y + 0.9, p.z));
    this.grabT -= dt;
    if (inWater && ds < 2.8) {
      if (!this.grabbed) { this.grabbed = true; L.scare(0.7); L.center('Something has you.', '#e8c0c0', 2); }
      if (this.grabT <= 0) { this.grabT = 0.7; L.hurt(9, 'the deep end'); }
      // it drags you up and away from the drain
      _w.set(p.x - cx, 0, p.z - cz).normalize();
      this.P.vel.x += _w.x * dt * 14; this.P.vel.z += _w.z * dt * 14; this.P.vel.y = Math.max(this.P.vel.y, 4.5);
      L.power = Math.random() < 0.5 ? 0.3 : 1;
    } else { this.grabbed = false; L.power = 1; }
    // the drain
    const [dx, dz] = L.worldAt(E.u + 0.5, E.v + 0.5);
    if (Math.hypot(p.x - dx, p.z - dz) < 1.3 && p.y < this.d.F - 9.2) { L.exit(this.exitLine); return; }
    g.audio.setLoop('water', true, inExitRoom ? 1.2 : 0.6);
    this.dread = 0.14 + (inExitRoom ? 0.2 : 0) + (inWater ? clamp(1 - ds / 8, 0, 1) * 0.5 : 0);
  }

  // prints across the floor toward the next arch on the way to the warm pool
  _trail(u, v, i, j) {
    const L = this.L, d = this.d, E = this.E;
    const opts = [];
    const add = (ni, nj, pu, pv) => opts.push({ n: Math.abs(ni - E.i) + Math.abs(nj - E.j), pu, pv });
    let a;
    if ((a = prArch(d, i, j, 1))) add(i - 1, j, i * 12, j * 12 + (a[0] + a[1]) / 2);
    if ((a = prArch(d, i + 1, j, 1))) add(i + 1, j, (i + 1) * 12, j * 12 + (a[0] + a[1]) / 2);
    if ((a = prArch(d, j, i, 2))) add(i, j - 1, i * 12 + (a[0] + a[1]) / 2, j * 12);
    if ((a = prArch(d, j + 1, i, 2))) add(i, j + 1, i * 12 + (a[0] + a[1]) / 2, (j + 1) * 12);
    if (!opts.length) return;
    opts.sort((x, y) => x.n - y.n);
    const o = opts[0];
    const tu = o.pu + 0.5, tv = o.pv + 0.5;
    let du = tu - u, dv = tv - v;
    const len = Math.hypot(du, dv);
    if (len < 2) return;
    du /= len; dv /= len;
    const n = Math.min(24, Math.floor((len + 3) / 0.7));
    for (let k = 3; k < n; k++) {
      const s = k * 0.7, side = (k & 1 ? 1 : -1) * 0.14;
      const pu = u + du * s - dv * side, pv = v + dv * s + du * side;
      const f = L.get(Math.floor(pu), -1, Math.floor(pv)), a0 = L.get(Math.floor(pu), 0, Math.floor(pv));
      if (f !== B.POOL_TILE || !IS_AIRLIKE[a0]) continue;
      const m = new THREE.Mesh(printGeo, printMat.clone());
      m.scale.x = k & 1 ? 1 : -1;
      L.point(pu, 0.012, pv, m.position);
      const [wx, wz] = L.dir(du, dv);
      m.rotation.y = Math.atan2(wx, wz);
      L.props.add(m);
      this.prints.push({ m, t: 16 + k * 0.25 });
    }
    this.g.audio.distant('steps');
  }

  stop() { for (const pr of this.prints) pr.m.material.dispose(); }
}

// ======================================================================================= Hallway
function signCanvas(text, sub) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#f2c230'; x.fillRect(0, 0, 256, 96);
  x.fillStyle = '#1a1406'; x.fillRect(6, 6, 244, 84);
  x.fillStyle = '#f2c230'; x.fillRect(10, 10, 236, 76);
  x.fillStyle = '#1a1406';
  x.font = 'bold 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 128, 44);
  x.font = 'bold 14px sans-serif';
  x.fillText(sub, 128, 76);
  return c;
}
function plaque(lines) {
  const c = document.createElement('canvas');
  c.width = 384; c.height = 224;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f1ea'; x.fillRect(0, 0, 384, 224);
  x.strokeStyle = '#2a2a2a'; x.lineWidth = 6; x.strokeRect(8, 8, 368, 208);
  x.fillStyle = '#222'; x.font = 'bold 22px sans-serif'; x.textAlign = 'center';
  lines.forEach((l, i) => x.fillText(l, 192, 52 + i * 40));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.1), new THREE.MeshBasicMaterial({ map: tex }));
}

const ANOMALIES = ['poster', 'door', 'lights', 'extra_door', 'missing', 'water', 'vent', 'figure', 'ceiling', 'red', 'tv', 'sign', 'poster_gone', 'doors_open'];

class Hallway extends Kind {
  start() {
    this.goneLine = 'There was a door here. There is a wall.';
    this.exitLine = 'Exit 8. The door opens onto open air. Behind you, the building is small again.';
    this.count = 0;
    this.first = true;
    this.anomaly = null;
    this.entry = 1;
    this.edits = [];
    this.sideClosed = false;
    this.lastAnom = null;
    this.figure = null;
    this.signs = [];
    for (const su of [4, 35]) {
      const g = new THREE.Group();
      const tex = new THREE.CanvasTexture(signCanvas('EXIT 0', 'KEEP GOING'));
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      for (const s of [0, 1]) {
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.56), mat);
        pl.rotation.y = s * Math.PI;
        pl.position.z = s ? -0.012 : 0.012;
        g.add(pl);
      }
      blk(g, new THREE.MeshBasicMaterial({ color: 0x333333 }), 0.03, 0.4, 0.03, -0.5, 0.45, 0);
      blk(g, new THREE.MeshBasicMaterial({ color: 0x333333 }), 0.03, 0.4, 0.03, 0.5, 0.45, 0);
      this.L.point(su + 0.5, 3.35, 15.5, g.position);
      const [nx, nz] = this.L.dir(1, 0);
      g.rotation.y = Math.atan2(nx, nz);
      this.L.props.add(g);
      this.signs.push({ g, tex, mat });
    }
    const pq = plaque(['IF YOU SEE ANYTHING UNUSUAL,', 'TURN BACK IMMEDIATELY.', 'IF NOTHING IS UNUSUAL, KEEP GOING.', 'EXIT AT 8.']);
    this.L.point(7.0, 1.7, 16.97, pq.position);
    const [nx, nz] = this.L.dir(0, -1);
    pq.rotation.y = Math.atan2(nx, nz);
    this.L.props.add(pq);
    this._setSigns(`EXIT ${this.count}`);
    this.g.audio.setLoop('fluoro', true, 0.35);
  }

  sub() { return `Exit ${this.count}`; }
  objective() { return [`Exit ${this.count} of 8`, 'Something wrong: turn back', 'Nothing wrong: keep going']; }

  _setSigns(text) {
    for (const s of this.signs) {
      const c = signCanvas(text, text.startsWith('EXIT') ? '' : '');
      s.tex.image = c; s.tex.needsUpdate = true;
    }
  }

  edit(u, y, v, id) {
    const old = this.L.get(u, y, v);
    if (old < 0) return;
    this.edits.push([u, y, v, old]);
    this.L.set(u, y, v, id);
  }

  _revert() {
    for (let i = this.edits.length - 1; i >= 0; i--) { const [u, y, v, id] = this.edits[i]; this.L.set(u, y, v, id); }
    this.edits = [];
    if (this.figure) { this.figure.removeFromParent(); this.figure = null; }
  }

  _apply(kind) {
    const e = (u, y, v, id) => this.edit(u, y, v, id);
    switch (kind) {
      case 'poster': e(14, 1, 13, B.POSTER_ODD); break;
      case 'door': e(20, 0, 17, B.DREAM_DOOR); e(20, 1, 17, B.DREAM_DOOR); break;
      case 'lights':
        for (let u = 17; u <= 33; u++) {
          if (fm(u, 4) === 1) e(u, 4, 15, B.CEILING_TILE);
          for (let y = 0; y <= 3; y++) for (let v = 14; v <= 16; v++) e(u, y, v, B.LIT_DARK);
        }
        break;
      case 'extra_door': e(26, 0, 17, B.OFFICE_DOOR); e(26, 1, 17, B.OFFICE_DOOR_TOP); break;
      case 'missing': for (let u = 22; u <= 23; u++) for (let y = 1; y <= 2; y++) e(u, y, 13, B.MISSING); break;
      case 'water': for (let u = 10; u <= 30; u++) for (let v = 14; v <= 16; v++) e(u, -1, v, B.WATER); break;
      case 'vent': e(16, 3, 17, B.EYE); break;
      case 'ceiling': for (let u = 12; u <= 28; u++) for (let v = 14; v <= 16; v++) e(u, 3, v, B.CEILING_TILE); break;
      case 'red': for (let u = 1; u <= 37; u += 4) e(u, 4, 15, B.EMERGENCY); break;
      case 'tv': e(18, 0, 16, B.TV); break;
      case 'poster_gone': e(26, 1, 13, B.POOL_TILE); break;
      case 'doors_open': for (const u of [8, 20, 32]) { e(u, 0, 17, B.LIT_DARK); e(u, 1, 17, B.LIT_DARK); } break;
      case 'figure': {
        const f = buildNullFigure(true);
        const fu = this.entry > 0 ? 33.5 : 6.5;
        this.L.point(fu, 0, 15.5, f.position);
        this.L.props.add(f);
        this.figure = f;
        break;
      }
      default: break;
    }
  }

  // crossed the middle of a bend: judge the corridor you just walked, and change the next one
  _cross(dir) {
    const L = this.L;
    if (this.first) this.first = false;
    else {
      const forward = dir === this.entry;
      const correct = this.anomaly ? !forward : forward;
      this.count = correct ? Math.min(8, this.count + 1) : 0;
    }
    if (!this.sideClosed) {
      this.sideClosed = true;
      for (const u of [6, 7]) for (let y = 0; y <= 2; y++) L.set(u, y, 13, B.POOL_TILE);
    }
    this._revert();
    this.entry = dir;
    let sign = `EXIT ${this.count}`;
    if (this.count >= 8) {
      // the far end becomes a door
      this.anomaly = null;
      const ue = dir > 0 ? 40 : -1;
      for (let v = 14; v <= 16; v++) for (let y = 0; y <= 3; y++) {
        const id = v === 15 ? (y === 0 ? B.EXIT_DOOR : y === 1 ? B.EXIT_DOOR_TOP : y === 2 ? B.EXIT_SIGN : B.POOL_TILE) : B.POOL_TILE;
        this.edit(ue, y, v, id);
      }
    } else {
      const pool = ANOMALIES.filter((a) => a !== this.lastAnom);
      this.anomaly = Math.random() < 0.55 ? pool[Math.floor(Math.random() * pool.length)] : null;
      if (this.anomaly) { this.lastAnom = this.anomaly; this._apply(this.anomaly); }
      if (this.anomaly === 'sign') sign = `EXIT ${(this.count + 1 + Math.floor(Math.random() * 7)) % 10}`;
    }
    this._setSigns(sign);
  }

  update(dt) {
    super.update(dt);
    const L = this.L, p = this.P.pos;
    const [u] = L.local(p.x, p.z);
    const n = Math.floor((u + 4) / HALL.P);
    if (n !== 0) {
      L.shift(-n * HALL.P, 0);
      this._cross(n > 0 ? 1 : -1);
    }
    // the man at the end of the corridor comes closer when you look away
    const f = this.figure;
    let fd = 99;
    if (f) {
      this.face(f, p.x, p.z, 1);
      fd = Math.hypot(f.position.x - p.x, f.position.z - p.z);
      if (!this.seen(f.position, 1.8, false)) {
        const [fu, fv] = L.local(f.position.x, f.position.z);
        const [tx, tz] = L.worldAt(u, fv);
        this.step(f, tx, tz, 2.6, dt, false);
        if (Math.random() < dt * 0.6) this.g.audio.footstep('hard');
      }
      if (fd < 1.3) {
        L.scare(1);
        L.hurt(22, 'the man in the hallway');
        this.count = 0;
        this._setSigns('EXIT 0');
        f.removeFromParent(); this.figure = null;
      }
    }
    this.dread = 0.16 + (this.anomaly ? 0.1 : 0) + (f ? clamp(1 - fd / 30, 0, 1) * 0.55 : 0);
  }
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
    return [this.exitOpen ? 'A door has opened somewhere near' : `Books with your name: ${this.have}/3`, `Noise ${bar}`];
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
    // pages turning somewhere toward the next book
    this.rustleT -= dt;
    const next = this.books.find((q) => !q.got);
    if (next && this.rustleT <= 0) {
      this.rustleT = rnd(8, 12);
      const [bx, bz] = L.worldAt(next.u + 0.5, next.v + 0.5);
      const db = Math.hypot(bx - p.x, bz - p.z);
      g.audio.whisper(0.02 + clamp(1 - db / 70, 0, 1) * 0.05, this.pan(bx, bz));
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
