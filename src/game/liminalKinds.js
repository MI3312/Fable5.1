// What each liminal pocket asks of you once you're inside. Every place has its own way out and
// its own reason not to linger:
//   Backrooms - follow the hum to the exit; when the lights go out, keep your torch on the dark.
//   Poolrooms - follow the wet footprints down the long stair, across the flooded baths, to the
//               well of daylight, and climb out. Something else swims there.
//   Hallway   - the same corridor, again and again. Anything wrong: turn back. Nothing wrong:
//               keep going. Eight in a row and there's a door.
//   Library   - find the three books with your name on them, and walk softly. The Librarian
//               hears running, and walks through shelves.
//   Warehouse - three ways out: the loading dock (throw the breaker), the fire exit (find the
//               bolt cutters), the freight lift (call it and hold out). The mannequins only move
//               when unseen, and the torch runs down.
import * as THREE from 'three';
import { B, IS_AIRLIKE, IS_SOLID, ART_LEVEL } from '../world/blocks.js';
import { clamp, lerp } from '../core/rng.js';
import {
  backroomsExit, backroomsExits, poolStair, poolWell, poolTrail, PR, libraryBooks, warehouseExit, warehouseBreaker, prArch, STYLE,
  HALL, hallT, hallTurn, hallOpen, hallHeight, hallCeiling, HALL_DOORS, HALL_POSTERS_N, HALL_POSTERS_S, HALL_ALCOVES,
  libFloorProp, libZoneAt, BR, brZone, brOfficeAt, brL1Prop, brL1Exit, brHasL1, brStairAt,
  warehouseFire, warehouseLift, warehouseCage, whFloorProp, whSiteAt,
} from '../world/liminalGen.js';
import { buildNullFigure } from '../entities/horrorModels.js';
import * as HP from '../entities/hallProps.js';
import * as LP from '../entities/libraryProps.js';
import * as BP from '../entities/backroomsProps.js';
import * as GP from '../entities/glitchProps.js';
import * as WP from '../entities/warehouseProps.js';
import * as MQ from '../entities/mannequin.js';
import { buildLibrarian, poseLibrarian, warmLibrarian } from '../entities/librarian.js';
import { propGlowK, setPropArt, propLitMaterial } from '../entities/propLight.js';
import { PropField } from './propField.js';

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
// a quick hash of integer cells to 0..1
const hq = (a, b, c = 0) => { let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
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
  // keep the player out of the furniture modelled on the faces of blocks of a kind (bookcases,
  // racking) which stands `depth` out from them
  keepOut(id, depth) {
    const P = this.P, p = P.pos, F = this.d.F, W = this.W;
    if (p.y > F + 6.5 || p.y < F - 1.5) return;
    const R = depth + 0.3;
    const x0 = Math.floor(p.x), z0 = Math.floor(p.z);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = x0 + dx, cz = z0 + dz;
      if (W.getBlock(cx, F + 3, cz) !== id) continue;
      const ax = cx - R, bx = cx + 1 + R, az = cz - R, bz = cz + 1 + R;
      if (p.x <= ax || p.x >= bx || p.z <= az || p.z >= bz) continue;
      const pen = [p.x - ax, bx - p.x, p.z - az, bz - p.z];
      const k = pen.indexOf(Math.min(...pen));
      if (k === 0) { p.x = ax; P.vel.x = Math.min(P.vel.x, 0); }
      else if (k === 1) { p.x = bx; P.vel.x = Math.max(P.vel.x, 0); }
      else if (k === 2) { p.z = az; P.vel.z = Math.min(P.vel.z, 0); }
      else { p.z = bz; P.vel.z = Math.max(P.vel.z, 0); }
    }
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
let BR_GEOS = null;
function brGeos() {
  if (BR_GEOS) return BR_GEOS;
  const G = {};
  G.part = BP.partitionGeometry();
  for (let i = 0; i < 3; i++) { G['desk' + i] = BP.deskGeometry(i * 7 + 1); G['screen' + i] = BP.screenGeometry(i * 7 + 1); }
  G.chair = BP.officeChairGeometry();
  G.cab = BP.cabinetGeometry();
  G.cooler = BP.coolerGeometry();
  G.copier = BP.copierGeometry();
  for (let i = 0; i < 3; i++) G['wires' + i] = BP.wiresGeometry(i + 1);
  for (let i = 0; i < 2; i++) G['tile' + i] = BP.fallenTileGeometry(i + 1);
  G.crate = BP.crateGeometry(false); G.crate2 = BP.crateGeometry(true); G.drum = BP.drumGeometry();
  G.pipes = BP.pipesGeometry();
  for (let i = 0; i < 5; i++) G['spike' + i] = BP.spikeGeometry(i * 11 + 3);
  G.chairUp = BP.upsideDown(() => BP.officeChairGeometry());
  G.deskUp = BP.upsideDown(() => BP.deskGeometry(40));
  for (const a of ['<', '>', '^', 'v']) {
    G['graf' + a] = BP.graffitiGeometry(a, 'EXIT', [0.5, 0.07, 0.05], a.charCodeAt(0));
    G['grafL1' + a] = BP.graffitiGeometry(a, 'OUT', [0.08, 0.08, 0.09], a.charCodeAt(0) + 5);
  }
  BR_GEOS = G;
  return G;
}
const BR_WALL = new Set([B.WALLPAPER, B.WALLPAPER_B, B.MISSING]);
const ARROWS = ['<', '>', '^', 'v'];

class Backrooms extends Kind {
  static warm() { brGeos(); }

  start() {
    const L = this.L, d = this.d;
    this.goneLine = 'Where the door was, there is only wallpaper.';
    this.exitLine = 'The bar gives. The hum stops. Wind, grass, sky.';
    this.minY = BR.L1F - 6;
    this.exits = backroomsExits(d);
    this.E = this.exits[0];
    this.L1E = brHasL1(d) ? brL1Exit(d) : null;
    this.bo = { on: false, t: 0, next: rnd(40, 70) };
    this.stalker = null;
    this.mercy = false;
    this.warned = false;
    this.navT = 0;
    this.level = 0;
    this.l1k = 0;
    this.saidL1 = false;
    this.knockT = rnd(8, 16);
    this.watcher = null;
    this.watchT = rnd(20, 40);
    this.field = new PropField(L, brGeos(), (c) => this._scan(c), { nearR: 16, farR: 34, yR: 7.5, max: 3000 });
    this.gl = new Map();
    this.glT = 0;
    this.signs = new Map();
    this.g.audio.setLoop('fluoro', true, 0.4);
  }

  stop() {
    if (this.field) this.field.dispose();
    for (const o of this.gl.values()) { o.removeFromParent(); GP.disposeGlitch(o); }
    for (const o of this.signs.values()) o.removeFromParent();
    this.gl.clear(); this.signs.clear();
    propGlowK.value = 1;
    this.g.audio.setLoop('wind', false);
  }

  sub() { return this.level === 1 ? 'Level 1' : 'Level 0'; }

  objective() {
    if (this.level === 1) return ['Find the maintenance exit', 'Listen for the fan: it blows by the door', 'The stairs lead back up'];
    return this.bo.on ? ['The lights are out', 'Keep your torch on the dark']
      : ['Find a way out: there are three doors', 'The hum is loudest near one; arrows on the walls point the way', this.L1E ? 'Or take a concrete stairwell down' : 'Keep moving'];
  }

  // what to model in a chunk: the offices' furniture, the wet wings' wires and fallen tiles, the
  // broken regions' spikes and upturned chairs, and Level 1's crates, drums and pipes
  _scan(c) {
    const d = this.d, F = d.F, data = c.data, L = this.L;
    const S = 18;
    const at = (px, pz, y) => data[px + S * (pz + S * (F + y))];
    const out = [];
    const X0 = c.cx * 16, Z0 = c.cz * 16;
    const yaw = (fu, fv, j = 0) => { const [dx, dz] = L.dir(fu, fv); return Math.atan2(dx, dz) + j; };
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const px = lx + 1, pz = lz + 1, x = X0 + lx, z = Z0 + lz;
      const [u, v] = L.cellLocal(x, z);
      const h = hq(u, v, d.seed & 1023);
      const b0 = at(px, pz, 0);
      // ---- Level 0
      if (b0 === B.PROP) {
        const o = brOfficeAt(d, u, v);
        const art = ART_LEVEL[at(px, pz, 2)] || 0.5;
        if (o) {
          if (o.t === 'part') out.push({ g: 'part', x: x + 0.5, y: F, z: z + 0.5, ry: o.ax === 'u' ? yaw(0, 1) : yaw(1, 0), art });
          else if (o.t === 'desk') {
            if (o.a) {
              const k = Math.floor(h * 3), [wx, wz] = L.worldAt(u + 1, v + 0.5), ry = yaw(o.fu, o.fv);
              out.push({ g: 'desk' + k, x: wx, y: F, z: wz, ry, art });
              out.push({ g: 'screen' + k, x: wx, y: F, z: wz, ry, art: 1, glow: 1 });
            }
          } else out.push({ g: o.t, x: x + 0.5, y: F, z: z + 0.5, ry: yaw(o.fu, o.fv, o.t === 'chair' ? (h - 0.5) * 1.4 : 0), art });
        }
      } else if (IS_AIRLIKE[b0]) {
        const zone = brZone(d, u, v);
        if (zone === 7 && IS_AIRLIKE[at(px, pz, 4)]) {
          const art = ART_LEVEL[at(px, pz, 1)] || 0.4;
          out.push({ g: 'wires' + Math.floor(h * 3), x: x + 0.5, y: F, z: z + 0.5, ry: h * 6.28, art });
          if (h < 0.6) out.push({ g: 'tile' + (h < 0.3 ? 0 : 1), x: x + 0.5, y: F, z: z + 0.5, ry: h * 9, art });
        }
        if (zone === 4 && h < 0.014 && IS_AIRLIKE[at(px, pz, 3)]) out.push({ g: h < 0.008 ? 'chairUp' : 'deskUp', x: x + 0.5, y: F, z: z + 0.5, ry: h * 700, art: ART_LEVEL[at(px, pz, 2)] || 0.5 });
      } else if (BR_WALL.has(at(px, pz, 1)) && hq(x, z, 77) < 0.035) {
        // an arrow in marker, pointing to the nearest door (or anywhere at all, where things have come apart)
        for (const [dx, dz] of DIRS4) {
          if (!IS_AIRLIKE[at(px + dx, pz + dz, 1)] || !IS_AIRLIKE[at(px + dx, pz + dz, 2)]) continue;
          const fx = x + 0.5 + dx * 0.5, fz = z + 0.5 + dz * 0.5;
          out.push({ g: 'graf' + (brZone(d, u, v) === 4 ? ARROWS[Math.floor(h * 97) % 4] : this._arrow(fx, fz, dx, dz, 0)), x: fx, y: F, z: fz, ry: Math.atan2(dx, dz), art: ART_LEVEL[at(px + dx, pz + dz, 1)] || 0.5, face: [dx, dz] });
          break;
        }
      }
      if (BR_WALL.has(at(px, pz, 1)) && brZone(d, u, v) === 4) {
        for (const [dx, dz] of DIRS4) {
          if (!IS_AIRLIKE[at(px + dx, pz + dz, 1)] || hq(x, z, dx * 3 + dz + 50) > 0.05) continue;
          out.push({ g: 'spike' + Math.floor(hq(x, z, dx + 70) * 5), x: x + 0.5 + dx * 0.5, y: F, z: z + 0.5 + dz * 0.5, ry: Math.atan2(dx, dz), art: ART_LEVEL[at(px + dx, pz + dz, 1)] || 0.5, face: [dx, dz] });
        }
      }
      // ---- Level 1
      if (!this.L1E) continue;
      const b1 = at(px, pz, BR.L1F + 1);
      if (b1 === B.PROP) {
        const t = brL1Prop(d, u, v);
        if (t) out.push({ g: t, x: x + 0.5, y: F + BR.L1F + 1, z: z + 0.5, ry: h * 6.28, art: ART_LEVEL[at(px, pz, BR.L1F + 4)] || 0.2 });
      }
      if (at(px, pz, BR.L1F + 2) === B.CINDER && hq(x, z, 79) < 0.05) {
        for (const [dx, dz] of DIRS4) {
          if (!IS_AIRLIKE[at(px + dx, pz + dz, BR.L1F + 2)]) continue;
          const fx = x + 0.5 + dx * 0.5, fz = z + 0.5 + dz * 0.5;
          out.push({ g: 'grafL1' + this._arrow(fx, fz, dx, dz, 1), x: fx, y: F + BR.L1F + 1, z: fz, ry: Math.atan2(dx, dz), art: ART_LEVEL[at(px + dx, pz + dz, BR.L1F + 2)] || 0.3, face: [dx, dz] });
          break;
        }
      }
      const top = at(px, pz, BR.L1C - 1);
      if (IS_AIRLIKE[top] && at(px, pz, BR.L1C) !== B.LIGHT_PANEL && !brStairAt(d, Math.floor(u / 8), Math.floor(v / 8))) {
        const pu = fm(u, 8), pv = fm(v, 8);
        if (pv === 3 || pu === 6) out.push({ g: 'pipes', x: x + 0.5, y: F + BR.L1C, z: z + 0.5, ry: pv === 3 ? yaw(0, 1) : yaw(1, 0), art: ART_LEVEL[top] || 0.2 });
      }
    }
    return out;
  }

  // which way a mark on a wall facing (dx, dz) at (x, z) should point to reach the nearest door
  _arrow(x, z, dx, dz, level) {
    const L = this.L;
    const [u, v] = L.local(x, z);
    let best = null, bd = 1e9;
    for (const E of level === 1 ? [this.L1E] : this.exits) { const dd = Math.hypot(E.u - u, E.v - v); if (dd < bd) { bd = dd; best = E; } }
    const [wx, wz] = L.worldAt(best.u + 0.5, best.v + 0.5);
    let ddx = wx - x, ddz = wz - z;
    const dl = Math.hypot(ddx, ddz) || 1; ddx /= dl; ddz /= dl;
    const r = ddx * dz - ddz * dx, a = -(ddx * dx + ddz * dz);
    return Math.abs(r) > 0.38 ? (r > 0 ? '>' : '<') : a > 0 ? '^' : 'v';
  }

  // the regions that have come apart: tears, cubes, fragments and loose lights around you
  _glitch(dt) {
    const L = this.L, d = this.d, p = this.P.pos, g = this.g;
    this.glT -= dt;
    if (this.glT <= 0) {
      this.glT = 0.5;
      const want = new Set();
      if (this.level === 0) {
        const [pu, pv] = L.local(p.x, p.z);
        const cu = Math.floor(pu), cv = Math.floor(pv);
        for (let du = -24; du <= 24; du++) for (let dv = -24; dv <= 24; dv++) {
          if (du * du + dv * dv > 576) continue;
          const u = cu + du, v = cv + dv;
          if (brZone(d, u, v) !== 4) continue;
          const h = hq(u, v, (d.seed & 1023) + 7);
          const kind = h < 0.006 ? 'tear' : h < 0.016 ? 'cube' : h < 0.021 ? 'frag' : h < 0.026 ? 'ghost' : null;
          if (!kind) continue;
          const key = `${u},${v}`;
          want.add(key);
          if (this.gl.has(key)) continue;
          if (!IS_AIRLIKE[L.get(u, 1, v)] || !IS_AIRLIKE[L.get(u, 2, v)]) continue;
          const seed = Math.floor(h * 1e6);
          const o = kind === 'tear' ? GP.buildTear(seed, 0.6 + (h * 997 % 1) * 0.9, 1.8 + (h * 331 % 1) * 1.4)
            : kind === 'cube' ? GP.buildErrorCube(seed) : kind === 'frag' ? GP.buildFragments(seed) : GP.buildGhostPanel(seed);
          L.point(u + 0.5, kind === 'tear' ? 1.5 : 0, v + 0.5, o.position);
          o.userData.base = o.position.clone();
          if (kind === 'tear') o.rotation.y = h * 9000;
          L.props.add(o);
          this.gl.set(key, o);
        }
      }
      for (const [k, o] of this.gl) if (!want.has(k)) { o.removeFromParent(); GP.disposeGlitch(o); this.gl.delete(k); }
    }
    let near = 99;
    for (const o of this.gl.values()) {
      const u = o.userData;
      u.tick(this.t, dt);
      if (u.dy !== undefined) o.position.set(u.base.x + (u.dx || 0), u.base.y + u.dy, u.base.z + (u.dz || 0));
      if (u.tear) near = Math.min(near, o.position.distanceTo(p) - 1);
    }
    // close to a tear, the picture tears too, and there's static on the air
    if (near < 6) {
      const k = clamp(1 - near / 6, 0, 1);
      const H = L.mode.horror;
      H.glitch = Math.max(H.glitch, k * 0.35 * (0.5 + 0.5 * Math.sin(this.t * 11)));
      if (Math.random() < dt * (0.6 + k * 3)) g.audio.noiseHit(0.05 + Math.random() * 0.1, 3000 + Math.random() * 3000, 0.02 + k * 0.05, 'highpass');
    }
  }

  // signs over the stairwells near you
  _signs() {
    const L = this.L, d = this.d, p = this.P.pos;
    if (!this.L1E) return;
    const [pu, pv] = L.local(p.x, p.z);
    const a0 = Math.floor(pu / 8), b0 = Math.floor(pv / 8);
    const want = new Set();
    for (let da = -4; da <= 4; da++) for (let db = -4; db <= 4; db++) {
      const a = a0 + da, b = b0 + db;
      if (!brStairAt(d, a, b)) continue;
      for (const top of [true, false]) {
        const key = `${a},${b},${top}`;
        want.add(key);
        if (this.signs.has(key)) continue;
        const s = GP.buildSign(top ? 'STAIRS' : 'UP', top);
        L.point(a * 8 + (top ? 2.5 : 6.5), top ? 3.45 : BR.L1F + 4.45, b * 8 - 0.04, s.position);
        s.rotation.y = L.yaw(0, 1);
        L.props.add(s);
        this.signs.set(key, s);
      }
    }
    for (const [k, o] of this.signs) if (!want.has(k)) { o.removeFromParent(); this.signs.delete(k); }
  }

  atmos(u, s) {
    const m = this.L.mode, k = this.l1k * s;
    if (k < 0.001) return;
    // Level 1: colder, greyer, darker, the air thicker
    u.uAmbient.value.lerp(_c.setRGB(0.07, 0.08, 0.09), k * 0.7);
    u.uArtificial.value.lerp(_c.setRGB(0.72, 0.8, 0.86).multiplyScalar(this.L.powerK), k * 0.6);
    u.uCaveCol.value.lerp(_c.setRGB(0.05, 0.055, 0.06), k);
    m.scene.fog.color.lerp(_c, k);
    u.uFogDensity.value = lerp(u.uFogDensity.value, 1 / 30, k);
  }

  update(dt) {
    super.update(dt);
    const L = this.L, g = this.g, p = this.P.pos, d = this.d;
    const ly = p.y - d.F;
    this.level = ly < -4 ? 1 : 0;
    this.l1k += ((this.level === 1 ? 1 : 0) - this.l1k) * Math.min(1, dt * 1.5);
    this.field.update(dt, g.camera.position);
    this._glitch(dt);
    this._signs();
    propGlowK.value = clamp(L.powerK, 0.15, 1.2);
    const [u, v] = L.local(p.x, p.z);
    const bo = this.bo;
    if (this.level === 1) {
      if (bo.on) this._blackout(false);
      if (!this.saidL1) { this.saidL1 = true; L.center('Level 1. Concrete, and the drip of water somewhere, and something knocking on the pipes.', '#c8d0d4', 4.5); }
      // the fan by the maintenance door
      const de = this.L1E ? Math.hypot(u - this.L1E.u, v - this.L1E.v) : 99;
      const near = clamp(1 - de / 60, 0, 1);
      g.audio.setLoop('fluoro', true, 0.12 * L.powerK);
      g.audio.setLoop('wind', true, 0.08 + near * near * 0.9);
      // knocking along the pipes, never where you are
      this.knockT -= dt;
      if (this.knockT <= 0) {
        this.knockT = rnd(7, 18);
        const pan = rnd(-1, 1);
        for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) setTimeout(() => { g.audio.distant('thud', { pan, gain: 0.5 }); g.audio.tone(170 + Math.random() * 40, 0.25, 'triangle', 0.015, 0.92); }, i * rnd(280, 420));
      }
      this._watch(dt);
      this.dread = 0.28 + (this.watcher ? 0.2 : 0);
      return;
    }
    g.audio.setLoop('wind', false);
    let de = 1e9;
    for (const E of this.exits) { const dd = Math.hypot(u - E.u, v - E.v); if (dd < de) { de = dd; this.E = E; } }
    const near = clamp(1 - de / 140, 0, 1);
    g.audio.setLoop('fluoro', true, (0.3 + near * near * 1.6) * L.powerK);
    // blackouts
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

  // Level 1: a figure at the far end of the pillars, there when you look, gone when you come
  _watch(dt) {
    const L = this.L, p = this.P.pos, d = this.d;
    if (!this.watcher) {
      this.watchT -= dt;
      if (this.watchT > 0) return;
      this.watchT = rnd(25, 50);
      const [pu, pv] = L.local(p.x, p.z);
      for (let i = 0; i < 30; i++) {
        const a = Math.random() * Math.PI * 2, r = rnd(16, 26);
        const u = Math.floor(pu + Math.cos(a) * r), v = Math.floor(pv + Math.sin(a) * r);
        const y0 = BR.L1F + 1;
        if (!IS_AIRLIKE[L.get(u, y0, v)] || !IS_AIRLIKE[L.get(u, y0 + 1, v)] || !IS_SOLID[L.get(u, y0 - 1, v)]) continue;
        const m = buildNullFigure(false);
        L.point(u + 0.5, y0, v + 0.5, m.position);
        L.props.add(m);
        this.watcher = { m, seenT: 0, life: 20 };
        return;
      }
      return;
    }
    const w = this.watcher, m = w.m;
    this.face(m, p.x, p.z, 1);
    w.life -= dt;
    const dist = m.position.distanceTo(p);
    if (this.seen(m.position, 1.6, false)) w.seenT += dt;
    if (w.seenT > 1.4 || dist < 9 || w.life <= 0) {
      if (w.seenT > 0 || dist < 9) this.g.audio.distant('thud', { pan: this.pan(m.position.x, m.position.z), gain: 0.5 });
      m.removeFromParent();
      this.watcher = null;
    }
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
      this.exits.push(this.E);
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
let LIB_GEOS = null;
function libGeos() {
  if (LIB_GEOS) return LIB_GEOS;
  const G = {};
  for (let i = 0; i < 10; i++) G['bay' + i] = LP.bayGeometry(i + 1);
  G.gap2 = LP.bayGeometry(31, { gap: 2 });
  G.gap4 = LP.bayGeometry(37, { gap: 4 });
  G.door = LP.bayGeometry(41, { door: true });
  G.end = LP.endPanelGeometry(false, false); G.endL = LP.endPanelGeometry(true, false);
  G.endR = LP.endPanelGeometry(false, true); G.endLR = LP.endPanelGeometry(true, true);
  G.ladder = LP.ladderGeometry();
  G.table0 = LP.tableGeometry(1); G.table1 = LP.tableGeometry(2);
  G.chair = LP.chairGeometry();
  G.banker = LP.bankerLampGeometry(); G.bankerGlow = LP.bankerGlowGeometry();
  G.pendant = LP.pendantGeometry(); G.pendantGlow = LP.pendantGlowGeometry();
  G.cabinet0 = LP.catalogueGeometry(1); G.cabinet1 = LP.catalogueGeometry(2);
  G.cart0 = LP.cartGeometry(1); G.cart1 = LP.cartGeometry(2);
  G.pile0 = LP.pileGeometry(1); G.pile1 = LP.pileGeometry(2); G.pile2 = LP.pileGeometry(3);
  G.name = LP.nameBookGeometry();
  LIB_GEOS = G;
  return G;
}
// a soft gold glow around a book with your name
let haloTex = null;
function bookHalo() {
  if (!haloTex && typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,214,140,0.9)'); gr.addColorStop(0.35, 'rgba(255,176,80,0.35)'); gr.addColorStop(1, 'rgba(255,150,60,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    haloTex = new THREE.CanvasTexture(c);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  s.scale.set(1.35, 1.35, 1);
  return s;
}
const LIB_SAY = {
  listen: 'It is listening', investigate: 'It heard something', search: 'It is searching', hunt: 'It sees you - get out of its sight',
};

class Library extends Kind {
  // shapes that take a moment to build are made while the building is still ahead of you
  static warm() { warmLibrarian(); libGeos(); }

  start() {
    const L = this.L;
    this.goneLine = 'Where the door was, there is a shelf. None of the books have titles.';
    this.exitLine = 'You step out into the air. You can\'t remember what the books were called.';
    this.books = libraryBooks(this.d).map((b) => ({ ...b, got: false }));
    const [fx, fz] = L.dir(0, -1);
    this.bookCells = new Map();
    for (const b of this.books) {
      const [x, z] = L.cellWorld(b.u, b.v);
      this.bookCells.set(`${x},${z}`, { b, fx, fz });
      b.halo = bookHalo();
      b.halo.position.set(x + 0.5 + fx * 0.88, this.d.F + LP.levelFloor(LP.bookLevel(b.y)) + 0.22, z + 0.5 + fz * 0.88);
      L.props.add(b.halo);
    }
    this.have = 0;
    this.noise = 0;
    this.shiftT = rnd(12, 18);
    this.rustleT = 6;
    this.exitOpen = false;
    this.hintT = 5;
    this.field = new PropField(L, libGeos(), (c) => this._scan(c), { nearR: 13, farR: 40, max: 6000 });
    const m = buildLibrarian();
    const [x, z] = L.worldAt(6.5 + rnd(-30, 30), 50 + rnd(0, 20));
    m.position.set(x, this.d.F, z);
    L.props.add(m);
    this.lib = { m, state: 'wander', a: 0, target: null, heard: null, lastSeen: null, lost: 0, stepT: 0, creakT: 3, shelveT: rnd(12, 22), hearCd: 0, sawT: 0, react: 0, face: null };
    this.lantern = { pos: new THREE.Vector3(), col: [0, 0, 0] };
    this.lights = [this.lantern];
    this.wasGround = true;
  }

  stop() {
    if (this.field) this.field.dispose();
    propGlowK.value = 1;
    this.lights = null;
  }

  objective() {
    const q = clamp(this.noise, 0, 1);
    const bar = '▮'.repeat(Math.round(q * 4)) + '▯'.repeat(4 - Math.round(q * 4));
    const lb = this.lib, dl = lb.m.position.distanceTo(this.P.pos);
    const say = LIB_SAY[lb.state] || (dl < 22 ? 'It is close - hold C to creep' : null);
    if (this.exitOpen) return ['A door has opened somewhere near', say || 'Find it before it finds you', `Noise ${bar}`];
    return [`Books with your name: ${this.have}/3`, say || 'Look for a lamp over an aisle; listen for pages turning', `Noise ${bar}`];
  }

  interact(hit) {
    if (hit.id !== B.GLOW_BOOK) return null;
    return { prompt: '<span class="key">E</span>Take the book', action: () => this._take(hit) };
  }

  onNoise(a) { this.noise += a; }

  // what to model in a chunk: a bookcase on every open face of the shelving (panelled ends
  // where a range stops), ladders, lamps, and the furniture the generator stood in PROP blocks
  _scan(c) {
    const d = this.d, F = d.F, data = c.data, W = this.W, L = this.L;
    const S = 18;
    const at = (px, pz, y) => data[px + S * (pz + S * (F + y))];
    const shelf = (px, pz) => at(px, pz, 3) === B.LIB_SHELF;
    const shelfW = (x, z) => (W.getBlock(x, F + 3, z) === B.LIB_SHELF ? 1 : 0);
    const open = (px, pz) => IS_AIRLIKE[at(px, pz, 2)] === 1;
    const out = [];
    const X0 = c.cx * 16, Z0 = c.cz * 16;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const px = lx + 1, pz = lz + 1, x = X0 + lx, z = Z0 + lz;
      if (shelf(px, pz)) {
        // which way the range runs: the way the shelving goes on further
        const sx = shelf(px - 1, pz) + shelf(px + 1, pz), sz = shelf(px, pz - 1) + shelf(px, pz + 1);
        const alongX = sx !== sz ? sx > sz : shelfW(x - 2, z) + shelfW(x + 2, z) >= shelfW(x, z - 2) + shelfW(x, z + 2);
        const bk = this.bookCells.get(`${x},${z}`);
        const door = at(px, pz, 0) === B.EXIT_DOOR;
        for (const [dx, dz] of DIRS4) {
          if (!open(px + dx, pz + dz)) continue;
          const ry = Math.atan2(dx, dz), fx = x + 0.5 + dx * 0.5, fz = z + 0.5 + dz * 0.5;
          const art = ART_LEVEL[at(px + dx, pz + dz, 2)] || 0.2;
          const end = alongX ? dx !== 0 : dz !== 0;
          if (end && !door) {
            const tx = dz, tz = -dx; // the bay's +x, in the world
            const g = 'end' + (open(px - tx, pz - tz) ? 'L' : '') + (open(px + tx, pz + tz) ? 'R' : '');
            out.push({ g, x: fx, y: F, z: fz, ry, art, face: [dx, dz] });
            continue;
          }
          let g;
          if (door) g = 'door';
          else if (bk && bk.fx === dx && bk.fz === dz) {
            g = bk.b.y <= 1 ? 'gap2' : 'gap4';
            if (at(px, pz, bk.b.y) === B.GLOW_BOOK) out.push({ g: 'name', x: fx, y: F + LP.levelFloor(LP.bookLevel(bk.b.y)), z: fz, ry, art: 1, glow: 1, face: [dx, dz] });
          } else g = 'bay' + Math.floor(hq(x, z, dx * 3 + dz) * 10);
          out.push({ g, x: fx, y: F, z: fz, ry, art, face: [dx, dz] });
          if (!door && !bk && hq(x, z, 91 + dx * 3 + dz) < 0.035) out.push({ g: 'ladder', x: fx, y: F, z: fz, ry, art, face: [dx, dz] });
        }
        continue;
      }
      if (at(px, pz, 6) === B.PROP_LAMP) {
        out.push({ g: 'pendant', x: x + 0.5, y: F, z: z + 0.5, art: 1 });
        out.push({ g: 'pendantGlow', x: x + 0.5, y: F, z: z + 0.5, art: 1, glow: 1 });
      }
      if (at(px, pz, 1) === B.PROP_LAMP) {
        out.push({ g: 'banker', x: x + 0.5, y: F, z: z + 0.5, ry: hq(x, z, 5) * 0.6 - 0.3, art: 1 });
        out.push({ g: 'bankerGlow', x: x + 0.5, y: F, z: z + 0.5, ry: hq(x, z, 5) * 0.6 - 0.3, art: 1, glow: 1 });
      }
      if (at(px, pz, 0) !== B.PROP) continue;
      const [u, v] = L.cellLocal(x, z);
      const fp = libFloorProp(d, u, v);
      if (!fp || !fp.a) continue;
      const h = hq(x, z, 7);
      let ou = 0.5, ov = 0.5, fu = 0, fv = 1, g, jit = 0;
      if (fp.t === 'table') { ou = 1; ov = 1; g = 'table' + (h < 0.5 ? 0 : 1); jit = (h - 0.5) * 0.05; }
      else if (fp.t === 'chair') { fu = fp.fu; fv = fp.fv; g = 'chair'; jit = (h - 0.5) * 0.6; ou += (h - 0.5) * 0.2; }
      else if (fp.t === 'cabinet') { ou = 1; g = 'cabinet' + (h < 0.5 ? 0 : 1); }
      else if (fp.t === 'cart') { ov += fm(v, 5) === 2 ? -0.1 : 0.1; fu = 1; fv = 0; g = 'cart' + (h < 0.5 ? 0 : 1); jit = (h - 0.5) * 0.4; }
      else { g = 'pile' + Math.floor(h * 3); jit = h * 6.28; }
      const [wx, wz] = L.worldAt(u + ou, v + ov), [ddx, ddz] = L.dir(fu, fv);
      out.push({ g, x: wx, y: F, z: wz, ry: Math.atan2(ddx, ddz) + jit, art: ART_LEVEL[at(px, pz, 2)] || 0.3 });
    }
    return out;
  }

  _take(hit) {
    const L = this.L, g = this.g;
    this.W.setBlock(hit.x, hit.y, hit.z, B.LIB_SHELF);
    const [u, v] = L.cellLocal(hit.x, hit.z);
    const b = this.books.find((q) => q.u === u && q.v === v) || this.books.find((q) => !q.got);
    if (b) b.got = true;
    this.have = this.books.filter((q) => q.got).length;
    this.noise += 0.2;
    g.audio.distant('chime');
    g.audio.distant('page', { pan: 0, gain: 1.5 });
    L.center(`"${TITLES[Math.floor(Math.random() * TITLES.length)]}" - the name on the spine is yours.`, '#f4dca0', 3.5);
    if (this.have >= 3 && !this.exitOpen) this._openExit();
  }

  _openExit() {
    const L = this.L, p = this.P.pos;
    const [pu, pv] = L.local(p.x, p.z);
    for (let i = 0; i < 160; i++) {
      const u = Math.floor(pu + rnd(-16, 16)), r = Math.floor(pv / 5) + Math.floor(rnd(-3, 3));
      const v = r * 5 + 3;
      if (Math.hypot(u - pu, v - pv) < 7) continue;
      if (L.get(u, 0, v) !== B.LIB_SHELF || L.get(u, 1, v) !== B.LIB_SHELF || L.get(u, 3, v) !== B.LIB_SHELF || !IS_AIRLIKE[L.get(u, 0, v - 1)] || !IS_AIRLIKE[L.get(u, 1, v - 1)]) continue;
      if (L.get(u - 1, 3, v) !== B.LIB_SHELF || L.get(u + 1, 3, v) !== B.LIB_SHELF) continue;
      L.point(u + 0.5, 1, v + 0.5, _v);
      if (L.visible(_v, L.world, 1.2)) continue;
      L.set(u, 0, v, B.EXIT_DOOR); L.set(u, 1, v, B.EXIT_DOOR_TOP); L.set(u, 2, v, B.EXIT_SIGN);
      this.exitOpen = true;
      this.g.audio.distant('door');
      L.center('Somewhere near, a door creaks open. Something heard it too.', '#f0e0c0', 4);
      const lb = this.lib;
      lb.heard = [p.x, p.z];
      this._setState('investigate');
      lb.target = [p.x, p.z];
      return;
    }
  }

  _setState(s) {
    const lb = this.lib;
    if (lb.state === s) return;
    lb.state = s; lb.a = 0;
    if (s === 'hunt') {
      const g = this.g;
      g.audio.noiseHit(0.5, 220, 0.18, 'lowpass');
      g.audio.tone(70, 1.2, 'sawtooth', 0.04, 0.8);
      if (this.t - (lb.sawT || -99) > 12) this.L.center('It has seen you.', '#e8c8b0', 2.5);
      lb.sawT = this.t;
    }
  }

  // how far it can make you out: further if you're in the light, or your lamp is on
  _sees(dl) {
    const L = this.L, P = this.P, p = P.pos, lb = this.lib, m = lb.m;
    if (dl > 26) return false;
    const lit = ART_LEVEL[this.W.getBlock(p.x, p.y + 1, p.z)] * L.powerK;
    let range = 4 + 10 * lit + (L.mode.torchK > 0.5 ? 9 : 0);
    if (P.sneaking) range *= 0.72;
    range = Math.max(range, 5.5); // its own lantern
    if (dl > range) return false;
    const fx = Math.sin(m.rotation.y), fz = Math.cos(m.rotation.y);
    const dot = ((p.x - m.position.x) * fx + (p.z - m.position.z) * fz) / Math.max(dl, 0.01);
    if (dl > 2.2 && dot < (lb.state === 'hunt' ? -0.1 : lb.state === 'search' ? 0.1 : 0.35)) return false;
    _v.set(m.position.x, m.position.y + 2.5, m.position.z);
    _w.set(p.x, p.y + 1.3, p.z).sub(_v);
    const dd = _w.length();
    if (this.W.isSolid(_v.x, _v.y, _v.z)) return dl < 2.5;
    return !this.W.raycast(_v, _w.normalize(), Math.max(0, dd - 0.4));
  }

  // a shelf face near it to put a book back on
  _shelfFace() {
    const m = this.lib.m, W = this.W, F = this.d.F;
    const x0 = Math.floor(m.position.x), z0 = Math.floor(m.position.z);
    if (W.isSolid(x0, F + 1, z0)) return null;
    for (const [dx, dz] of DIRS4) for (let r = 1; r <= 2; r++) {
      if (W.getBlock(x0 + dx * r, F + 3, z0 + dz * r) === B.LIB_SHELF) return [x0 + 0.5 + dx * (r - 0.3), z0 + 0.5 + dz * (r - 0.3)];
    }
    return null;
  }

  update(dt) {
    super.update(dt);
    const L = this.L, g = this.g, P = this.P, p = P.pos;
    this.keepOut(B.LIB_SHELF, LP.SHELF.D);
    this.field.update(dt, g.camera.position);
    // how much noise you're making: running is loud, walking a little, creeping nothing
    const hs = Math.hypot(P.vel.x, P.vel.z), moving = hs > 0.6 && P.onGround;
    const loud = moving ? (P.sprinting ? 1.3 : P.sneaking ? 0 : 0.26) : 0;
    if (loud > this.noise) this.noise = Math.min(loud, this.noise + dt * (P.sprinting ? 1.1 : 0.5));
    else this.noise = Math.max(0, this.noise - dt * 0.32);
    if (this.wasGround && !P.onGround && P.vel.y > 2) this.noise += 0.3;
    this.wasGround = P.onGround;
    this.hintT -= dt;
    if (this.hintT < 0 && this.hintT > -1) { this.hintT = -9; L.center('Quiet, please. Hold C to creep between the shelves.', '#d8ccb0', 4); }

    const lb = this.lib, m = lb.m;
    lb.a += dt;
    lb.hearCd -= dt;
    const dl = Math.hypot(m.position.x - p.x, m.position.z - p.z);
    // it hears you further the louder you are
    const hearR = 2.5 + this.noise * 30;
    if (this.noise > 0.12 && dl < hearR && lb.state !== 'hunt' && lb.hearCd <= 0) {
      lb.hearCd = 0.6;
      const err = dl * (this.noise >= 1 ? 0.04 : 0.2);
      lb.heard = [p.x + rnd(-err, err), p.z + rnd(-err, err)];
      if (lb.state === 'wander' || lb.state === 'shelve') {
        this._setState('listen');
        lb.listenT = this.noise >= 1 ? 0.4 : 1.4;
        g.audio.whisper(0.06, this.pan(m.position.x, m.position.z));
        if (this.noise >= 1) L.center('Shhh.', '#c8b8a0', 1.5);
      } else if (lb.state === 'search' || lb.state === 'investigate') { this._setState('investigate'); lb.target = lb.heard; }
    }
    const sees = this._sees(dl);
    if (sees) { lb.lastSeen = [p.x, p.z]; lb.lost = 0; }
    if (sees && lb.state !== 'hunt') {
      lb.react += dt;
      if (lb.react > (lb.state === 'search' || lb.state === 'investigate' ? 0.15 : 0.45)) this._setState('hunt');
    } else if (!sees) lb.react = 0;
    let speed = 0, tx = null, tz = null;
    switch (lb.state) {
      case 'wander': {
        if (!lb.target || Math.hypot(m.position.x - lb.target[0], m.position.z - lb.target[1]) < 1.2) {
          // drift about, more often than not somewhere near you
          const [pu, pv] = L.local(p.x, p.z), [mu, mv] = L.local(m.position.x, m.position.z);
          const near = Math.random() < 0.6;
          const [wx, wz] = near ? L.worldAt(pu + rnd(-24, 24), pv + rnd(-24, 24)) : L.worldAt(mu + rnd(-30, 30), mv + rnd(-30, 30));
          lb.target = [wx, wz];
        }
        [tx, tz] = lb.target; speed = 1.2;
        lb.shelveT -= dt;
        if (lb.shelveT <= 0) {
          const f = this._shelfFace();
          lb.shelveT = f ? rnd(18, 32) : 2;
          if (f) { lb.face = f; this._setState('shelve'); }
        }
        break;
      }
      case 'shelve':
        this.face(m, lb.face[0], lb.face[1], Math.min(1, dt * 3));
        if (lb.a > 0.95 && lb.a - dt <= 0.95 && dl < 34) g.audio.distant('shelve', { pan: this.pan(m.position.x, m.position.z), gain: Math.pow(clamp(1 - dl / 34, 0, 1), 1.5) * 1.6 });
        if (lb.a > 2.6) { this._setState('wander'); lb.target = null; }
        break;
      case 'listen':
        if (lb.heard) this.face(m, lb.heard[0], lb.heard[1], Math.min(1, dt * 1.5));
        if (lb.a > (lb.listenT || 1)) { this._setState('investigate'); lb.target = lb.heard; }
        break;
      case 'investigate':
        if (!lb.target) lb.target = lb.heard || [p.x, p.z];
        [tx, tz] = lb.target; speed = 2.4;
        if (Math.hypot(m.position.x - tx, m.position.z - tz) < 1.2) this._setState('search');
        break;
      case 'search':
        if (lb.a > 6.5) { this._setState('wander'); lb.target = null; }
        break;
      case 'hunt':
        [tx, tz] = sees ? [p.x, p.z] : lb.lastSeen || [p.x, p.z]; speed = this.exitOpen ? 4.7 : 4.15;
        if (!sees) {
          lb.lost += dt;
          if (lb.lost > 1.2) { this._setState('investigate'); lb.target = lb.lastSeen || lb.heard; }
        }
        break;
    }
    let mv = 0;
    if (tx !== null && speed > 0) {
      const ox = m.position.x, oz = m.position.z;
      this.step(m, tx, tz, speed, dt, false);
      this.face(m, tx, tz, Math.min(1, dt * 3.5));
      mv = clamp(Math.hypot(m.position.x - ox, m.position.z - oz) / Math.max(dt, 1e-3) / 2.4, 0, 1);
    }
    const fl = poseLibrarian(m, dt, this.t, lb.state, mv, lb.a);
    // its steps, heavy and slow; the ring of the lantern
    if (mv > 0.1) {
      lb.stepT -= dt * (0.6 + mv);
      if (lb.stepT <= 0) {
        lb.stepT = 1.0;
        const k = Math.pow(clamp(1 - dl / 30, 0, 1), 1.4) * 1.5;
        if (k > 0.02) g.audio.distant('step', { pan: this.pan(m.position.x, m.position.z), gain: k });
      }
      lb.creakT -= dt;
      if (lb.creakT <= 0) {
        lb.creakT = rnd(2.2, 5);
        const k = Math.pow(clamp(1 - dl / 22, 0, 1), 1.5) * 1.4;
        if (k > 0.02) g.audio.distant('creak', { pan: this.pan(m.position.x, m.position.z), gain: k });
      }
    }
    // its lantern lights the shelves around it (and it)
    const u = m.userData;
    u.lightPt.getWorldPosition(this.lantern.pos);
    const lk = fl * 1.25 / Math.max(0.3, Math.min(1.4, L.powerK));
    this.lantern.col[0] = 1.15 * lk; this.lantern.col[1] = 0.74 * lk; this.lantern.col[2] = 0.36 * lk;
    setPropArt(u.mat, (ART_LEVEL[this.W.getBlock(m.position.x, m.position.y + 1.5, m.position.z)] || 0.2) * 0.8, 0);
    if (dl < 1.25 && (lb.state === 'hunt' || lb.state === 'investigate')) this._caught();
    // the lamps gutter as it passes
    L.power = dl < 15 ? (Math.random() < 0.15 ? 0.3 : 0.55 + 0.45 * dl / 15) : 1;
    propGlowK.value = clamp(L.powerK, 0.2, 1.2);
    // shelves move when nobody is looking
    this.shiftT -= dt;
    if (this.shiftT <= 0) { this.shiftT = rnd(12, 20); this._shift(); }
    // the books with your name glow, and brighter as you come near
    for (const q of this.books) {
      const h = q.halo;
      h.visible = !q.got;
      if (!h.visible) continue;
      const dq = h.position.distanceTo(g.camera.position);
      h.material.opacity = (0.8 + 0.2 * Math.sin(this.t * 2.2 + q.u)) * clamp(1.4 - dq / 30, 0.3, 1);
    }
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
      g.audio.whisper(0.02 + clamp(1 - nd / 60, 0, 1) * 0.05, this.pan(next[0], next[1]));
      g.audio.distant('page', { pan: this.pan(next[0], next[1]), gain: 0.3 + clamp(1 - nd / 50, 0, 1) * 1.4 });
    }
    this.dread = 0.24 + clamp(1 - dl / 30, 0, 1) * 0.45 + (lb.state === 'hunt' ? 0.25 : lb.state === 'investigate' || lb.state === 'search' ? 0.1 : 0);
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
    this._setState('wander'); lb.target = null; lb.heard = null; lb.lastSeen = null;
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
      const z0 = libZoneAt(this.d, u0, v0);
      if (z0 !== 0 && z0 !== 2) continue;
      const cells = [[u0, v0], [u0 + 1, v0], [u0, v0 + 1], [u0 + 1, v0 + 1]];
      if (cells.some(([u, v]) => { const id = L.get(u, 1, v); return id < 0 || id === B.GLOW_BOOK || id === B.EXIT_DOOR || id === B.EXIT_DOOR_TOP || L.get(u, 0, v) === B.PROP; })) continue;
      if (cells.some(([u, v]) => { L.point(u + 0.5, 1, v + 0.5, _v); if (L.visible(_v, L.world, 1.3)) return true; L.point(u + 0.5, 4, v + 0.5, _v); return L.visible(_v, L.world, 1.3); })) continue;
      const open = IS_AIRLIKE[L.get(u0, 1, v0)];
      const air = L.get(u0, 1, v0 - 1);
      for (const [u, v] of cells) for (let y = 0; y <= 5; y++) L.set(u, y, v, open ? B.LIB_SHELF : (IS_AIRLIKE[air] ? air : B.LIT_DIM));
      this.g.audio.distant('thud');
      return;
    }
  }
}

// ======================================================================================= Warehouse
let WH_GEOS = null;
const WH_SIGNS = [['dock', 'DOCK'], ['fire', 'FIRE'], ['lift', 'LIFT'], ['office', 'OFFICE'], ['cage', 'TOOLS']];
function whGeos() {
  if (WH_GEOS) return WH_GEOS;
  const G = {};
  for (let i = 0; i < 6; i++) { G['rackL' + i] = WP.rackBayGeometry(i + 1, 'L'); G['rackR' + i] = WP.rackBayGeometry(i + 11, 'R'); }
  G.end = WP.rackEndGeometry(false, false); G.endL = WP.rackEndGeometry(true, false);
  G.endR = WP.rackEndGeometry(false, true); G.endLR = WP.rackEndGeometry(true, true);
  for (let i = 0; i < 3; i++) G['pallets' + i] = WP.palletStackGeometry(i + 1);
  for (let i = 0; i < 2; i++) { G['wrapped' + i] = WP.wrappedGeometry(i + 1); G['heap' + i] = WP.cartonHeapGeometry(i + 1); }
  G.forklift = WP.forkliftGeometry(); G.jack = WP.jackGeometry(); G.cone = WP.coneGeometry();
  G.highbay = WP.highBayGeometry(); G.highbayGlow = WP.highBayGlowGeometry(); G.truss = WP.trussGeometry();
  G.bench = WP.benchGeometry(); G.cutters = WP.cuttersGeometry();
  G.battery = WP.batteryGeometry(); G.batteryGlow = WP.batteryGlowGeometry(); G.chain = WP.chainGeometry();
  G.desk = BP.deskGeometry(5); G.screen = BP.screenGeometry(5); G.chair = BP.officeChairGeometry(); G.cab = BP.cabinetGeometry();
  [0, 2, 5, 7].forEach((p, i) => { G['display' + i] = { near: MQ.bakedMannequin(p, 0, 1.1), mid: MQ.bakedMannequin(p, 0, 1.7) }; });
  for (const [key, text] of WH_SIGNS) for (const a of ['<', '>', '^', 'v']) G[`sign_${key}_${a}`] = WP.signGeometry(text, a, key === 'fire' ? [0.1, 0.45, 0.2] : undefined, key === 'fire' ? [0.9, 0.95, 0.88] : undefined);
  WH_GEOS = G;
  return G;
}

class Warehouse extends Kind {
  static warm() { whGeos(); MQ.warmMannequin(); }

  start() {
    const d = this.d;
    this.goneLine = 'The door is a sheet of metal now. Out in the dark, something plastic clicks.';
    this.exitLine = 'Daylight. The shutter rattles down behind you. The shed is locked again.';
    this.E = warehouseExit(d);
    this.K = warehouseBreaker(d);
    this.F = warehouseFire(d);
    this.T = warehouseLift(d);
    this.C = warehouseCage(d);
    this.dest = { dock: [this.E.u - 0.5, this.E.v - 1], fire: [this.F.u + 0.5, this.F.v - 1], lift: [this.T.u + 0.5, this.T.v - 1], office: [this.K.u + 0.5, this.K.v - 2], cage: [this.C.u, this.C.v - 1] };
    this.powered = false;
    this.seq = -1;
    this.roll = -1;
    this.open = false;
    this.cutters = false;
    this.chainCut = false;
    this.lift = { called: false, t: 0, here: false };
    this.battery = 100;
    this.deadSaid = false;
    this.man = [];
    this.spawnT = 3;
    this.clickT = 0;
    this.creakT = 0;
    this.mat = propLitMaterial(0.4);
    this.field = new PropField(this.L, whGeos(), (c) => this._scan(c), { nearR: 16, farR: 40, max: 5000 });
    this.g.audio.setLoop('fluoro', true, 0.12);
    this.hintT = 4;
  }

  stop() {
    this.g.audio.setLoop('wind', false);
    this.g.audio.setLoop('hum', false);
    if (this.field) this.field.dispose();
    propGlowK.value = 1;
    this.L.mode.torchMul = 1;
  }

  objective() {
    const b = Math.round(clamp(this.battery / 25, 0, 4));
    const bar = '▮'.repeat(b) + '▯'.repeat(4 - b);
    const dock = this.open ? 'open - go!' : this.powered ? 'opening' : 'no power (breaker: OFFICE)';
    const fire = this.chainCut ? 'open' : this.cutters ? 'chained - you have the cutters' : 'chained (bolt cutters: TOOLS)';
    const L = this.lift, lift = L.here ? 'here - get in' : L.called ? `coming (${Math.ceil(L.t)}s) - hold out` : 'call it, then hold out';
    return [`Dock: ${dock}`, `Fire exit: ${fire}`, `Freight lift: ${lift}`, `Torch ${bar} · they move in the dark`];
  }

  interact(hit) {
    if (hit.id === B.BREAKER) return { prompt: this.powered ? 'The breaker is thrown' : '<span class="key">E</span>Throw the breaker', action: () => this._power() };
    if (hit.id === B.ROLLER) {
      const [u, v] = this.L.cellLocal(hit.x, hit.z);
      if (Math.abs(u - this.T.u) <= 1 && v === this.T.v) return { prompt: this.lift.here ? '' : 'The lift doors', action: () => this.L.center(this.lift.called ? 'Not yet. Listen: it\'s still coming down.' : 'Shut. There\'s a call button beside it.', '#d0d4dc', 2) };
      return { prompt: '<span class="key">E</span>Try the loading door', action: () => { if (!this.powered) { this.L.center('It won\'t move. There\'s no power: the breaker is in the office.', '#d0d4dc', 2.5); this.g.audio.noiseHit(0.3, 300, 0.2, 'lowpass'); } } };
    }
    if (hit.id === B.LIFT_BTN) return { prompt: this.lift.called ? 'Called' : '<span class="key">E</span>Call the freight lift', action: () => this._callLift() };
    if (hit.id === B.PICKUP || hit.id === B.PROP) {
      const [u, v] = this.L.cellLocal(hit.x, hit.z);
      const cut = Math.abs(u - (this.C.u - 1)) <= 1 && v === this.C.v + 5;
      if (cut && !this.cutters) return { prompt: '<span class="key">E</span>Take the bolt cutters', action: () => this._take(hit, 'cutters') };
      if (hit.id === B.PICKUP && !cut) return { prompt: '<span class="key">E</span>Take the battery', action: () => this._take(hit, 'battery') };
    }
    return null;
  }

  onExitDoor() {
    const L = this.L, g = this.g;
    if (this.chainCut) { L.exit('The fire door bangs open onto a yard, and rain. Behind you it swings shut, and locks.'); return; }
    if (!this.cutters) { L.center('Chained shut. Bolt cutters would do it. There are tools in the maintenance cage.', '#e0d8c8', 3.5); g.audio.noiseHit(0.2, 900, 0.15, 'bandpass', 2); return; }
    this.chainCut = true;
    this.field.forget();
    g.audio.noiseHit(0.1, 3000, 0.3, 'highpass'); g.audio.noiseHit(0.5, 600, 0.2, 'bandpass', 1.5);
    L.center('The chain parts and slithers to the floor. Loud. They heard that.', '#e8e0c8', 3);
    for (const q of this.man) q.frenzy = 6;
  }

  _take(hit, what) {
    const L = this.L, g = this.g;
    if (what === 'cutters') {
      this.cutters = true;
      const [u, v] = L.cellLocal(hit.x, hit.z);
      if (L.get(u, 1, v) === B.PICKUP) L.set(u, 1, v, B.LIT_AIR);
      L.set(this.C.u - 1, 1, this.C.v + 5, B.LIT_AIR);
      this.field.forget();
      g.audio.pickup();
      L.center('Bolt cutters. Heavy. The fire exit, then.', '#e8e0c8', 3);
      return;
    }
    this.W.setBlock(hit.x, hit.y, hit.z, B.LIT_DIM);
    this.battery = Math.min(100, this.battery + 45);
    this.deadSaid = false;
    g.audio.pickup();
    L.center('A battery. The torch steadies.', '#e0e8d0', 2);
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

  _callLift() {
    if (this.lift.called) return;
    const g = this.g;
    this.lift.called = true;
    this.lift.t = 28;
    g.audio.tone(660, 0.12, 'sine', 0.06);
    g.audio.noiseHit(1.5, 120, 0.2, 'lowpass', 0.5);
    this.L.center('Far above, a motor starts. It will take a while. The noise carries.', '#e8e4d8', 3.5);
    for (let i = 0; i < 3; i++) this._spawn(true);
  }

  // what to model in a chunk: racking on every open face of the runs (braced frames at their
  // ends, some with a sign), lamps and trusses overhead, and everything standing on the floor
  _scan(c) {
    const d = this.d, F = d.F, data = c.data, L = this.L, W = this.W;
    const S = 18;
    const at = (px, pz, y) => data[px + S * (pz + S * (F + y))];
    const rack = (px, pz) => (at(px, pz, 3) === B.WH_RACK ? 1 : 0);
    const rackW = (x, z) => (W.getBlock(x, F + 3, z) === B.WH_RACK ? 1 : 0);
    const open = (px, pz) => IS_AIRLIKE[at(px, pz, 2)] === 1;
    const yaw = (fu, fv, j = 0) => { const [dx, dz] = L.dir(fu, fv); return Math.atan2(dx, dz) + j; };
    const out = [];
    const X0 = c.cx * 16, Z0 = c.cz * 16;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const px = lx + 1, pz = lz + 1, x = X0 + lx, z = Z0 + lz;
      if (rack(px, pz)) {
        const sx = rack(px - 1, pz) + rack(px + 1, pz), sz = rack(px, pz - 1) + rack(px, pz + 1);
        const alongX = sx !== sz ? sx > sz : rackW(x - 2, z) + rackW(x + 2, z) >= rackW(x, z - 2) + rackW(x, z + 2);
        for (const [dx, dz] of DIRS4) {
          if (!open(px + dx, pz + dz)) continue;
          const ry = Math.atan2(dx, dz), fx = x + 0.5 + dx * 0.5, fz = z + 0.5 + dz * 0.5;
          const art = ART_LEVEL[at(px + dx, pz + dz, 2)] || 0.2;
          const tx = dz, tz = -dx;
          if (alongX ? dx !== 0 : dz !== 0) {
            out.push({ g: 'end' + (open(px - tx, pz - tz) ? 'L' : '') + (open(px + tx, pz + tz) ? 'R' : ''), x: fx, y: F, z: fz, ry, art, face: [dx, dz] });
            // now and then a sign, pointing the way to somewhere
            const h = hq(x, z, dx * 3 + dz + 30);
            if (h < 0.4 && open(px + tx, pz + tz)) {
              const [key] = WH_SIGNS[Math.floor(h / 0.4 * WH_SIGNS.length)];
              const [du, dv] = this.dest[key], [wx, wz] = L.worldAt(du, dv);
              let ddx = wx - fx, ddz = wz - fz;
              const dl = Math.hypot(ddx, ddz) || 1; ddx /= dl; ddz /= dl;
              const r = ddx * dz - ddz * dx, a = -(ddx * dx + ddz * dz);
              const arrow = Math.abs(r) > 0.38 ? (r > 0 ? '>' : '<') : a > 0 ? '^' : 'v';
              out.push({ g: `sign_${key}_${arrow}`, x: fx, y: F, z: fz, ry, art: Math.max(art, 0.5), glow: 0.35, face: [dx, dz] });
            }
            continue;
          }
          const w = dx !== 0 ? z : x, s2 = tx + tz;
          const side = ((w & 1) === 1) === (s2 > 0) ? 'R' : 'L';
          out.push({ g: 'rack' + side + Math.floor(hq(x, z, dx * 3 + dz) * 6), x: fx, y: F, z: fz, ry, art, face: [dx, dz] });
        }
        continue;
      }
      const [u, v] = L.cellLocal(x, z);
      if (at(px, pz, 9) === B.PROP_LAMP) {
        out.push({ g: 'highbay', x: x + 0.5, y: F, z: z + 0.5, art: 1 });
        out.push({ g: 'highbayGlow', x: x + 0.5, y: F, z: z + 0.5, art: 1, glow: 1 });
      } else if (fm(v, 14) === 0 && at(px, pz, 10) === B.METAL_PANEL) out.push({ g: 'truss', x: x + 0.5, y: F, z: z + 0.5, ry: yaw(0, 1), art: 0.25 });
      const b0 = at(px, pz, 0);
      if (b0 === B.PICKUP) {
        const art = ART_LEVEL[at(px, pz, 2)] || 0.4, ry = hq(x, z, 9) * 6.28;
        out.push({ g: 'battery', x: x + 0.5, y: F, z: z + 0.5, ry, art });
        out.push({ g: 'batteryGlow', x: x + 0.5, y: F, z: z + 0.5, ry, art: 1, glow: 1 });
        continue;
      }
      const site = whSiteAt(d, u, v);
      if (site && site[0] === 'cage' && site[1] === -1 && site[2] === 5) {
        const [wx, wz] = L.worldAt(u + 1, v + 0.5), ry = yaw(0, -1);
        out.push({ g: 'bench', x: wx, y: F, z: wz, ry, art: 1 });
        if (at(px, pz, 1) === B.PICKUP) out.push({ g: 'cutters', x: wx, y: F, z: wz, ry, art: 1 });
        continue;
      }
      if (site && site[0] === 'fire' && site[1] === 0 && site[2] === 0 && !this.chainCut) {
        const [ndx, ndz] = L.dir(0, -1);
        out.push({ g: 'chain', x: x + 0.5 + ndx * 0.5, y: F, z: z + 0.5 + ndz * 0.5, ry: Math.atan2(ndx, ndz), art: 0.6 });
        continue;
      }
      if (b0 !== B.PROP && !IS_AIRLIKE[b0]) continue;
      const fp = whFloorProp(d, u, v);
      if (!fp || !fp.a) continue;
      const h = hq(x, z, 11), art = ART_LEVEL[at(px, pz, 2)] || 0.3;
      let ou = 0.5, ov = 0.5, g = fp.t, jit = (h - 0.5) * 0.5;
      if (fp.t === 'forklift') { ov = 1; jit = (h - 0.5) * 0.2; }
      else if (fp.t === 'desk') { ou = 1; jit = 0; }
      else if (fp.t === 'pallets') g = 'pallets' + Math.floor(h * 3);
      else if (fp.t === 'wrapped') g = 'wrapped' + (h < 0.5 ? 0 : 1);
      else if (fp.t === 'heap') g = 'heap' + (h < 0.5 ? 0 : 1);
      else if (fp.t === 'display') { g = 'display' + Math.floor(h * 4); jit = (h - 0.5) * 0.6; }
      else if (fp.t === 'cab') jit = 0;
      const [wx, wz] = L.worldAt(u + ou, v + ov);
      out.push({ g, x: wx, y: F, z: wz, ry: yaw(fp.fu ?? 0, fp.fv ?? 1, jit), art });
      if (fp.t === 'desk') out.push({ g: 'screen', x: wx, y: F, z: wz, ry: yaw(0, -1), art: 1, glow: 1 });
    }
    return out;
  }

  _spawn(near = false) {
    const spot = this.hiddenSpot(near ? 10 : 16, near ? 22 : 32, 50);
    if (!spot) return;
    const m = MQ.buildMannequin(this.mat);
    this.L.point(spot[0] + 0.5, 0, spot[1] + 0.5, m.position);
    m.rotation.y = Math.random() * Math.PI * 2;
    MQ.setPose(m, MQ.POSES[0]);
    this.L.props.add(m);
    this.man.push({ m, stuck: 0, moved: false, pose: 0, head: 0, frenzy: 0, walkT: Math.random() * 10 });
  }

  update(dt) {
    super.update(dt);
    const L = this.L, g = this.g, p = this.P.pos, S = L.mode;
    this.keepOut(B.WH_RACK, WP.RACK.D);
    this.field.update(dt, g.camera.position);
    propGlowK.value = clamp(L.powerK, 0.15, 1.3);
    this.hintT -= dt;
    if (this.hintT < 0 && this.hintT > -1) { this.hintT = -9; L.center('Three ways out of here. Follow the signs on the ends of the racks.', '#d8dce4', 4); }
    // the torch runs down; spare batteries lie about in the light
    if (S.torch) this.battery = Math.max(0, this.battery - dt * 1.05);
    if (this.battery <= 0 && S.torch) {
      S.torch = false;
      g.audio.noiseHit(0.05, 2000, 0.08, 'highpass');
      if (!this.deadSaid) { this.deadSaid = true; L.center('The torch dies. Find a battery - there are some lying in the light.', '#e0c8c0', 3.5); }
    }
    S.torchMul = this.battery < 20 ? (Math.random() < 0.12 ? 0.15 : 0.55 + this.battery / 45) : 1;
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
      const rows = Math.min(4, Math.floor(this.roll / 1.6));
      for (let y = 0; y < rows; y++) for (let du = -2; du <= 1; du++) {
        if (L.get(this.E.u + du, y, this.E.v) === B.ROLLER) {
          L.set(this.E.u + du, y, this.E.v, B.LIT_AIR);
          for (let dv = 1; dv <= 3; dv++) L.set(this.E.u + du, y, this.E.v + dv, dv === 3 ? B.LIGHT_PANEL : B.LIT_AIR);
        }
      }
      if (rows >= 4) this.open = true;
    }
    const [pu, pv] = L.local(p.x, p.z);
    if (this.open && pv >= this.E.v + 0.3 && pu >= this.E.u - 2.2 && pu <= this.E.u + 2.2) { L.exit(this.exitLine); return; }
    // the freight lift, coming down
    const lf = this.lift;
    if (lf.called && !lf.here) {
      lf.t -= dt;
      const dl = Math.hypot(pu - this.T.u, pv - this.T.v);
      g.audio.setLoop('hum', dl < 30, clamp(1 - dl / 30, 0, 1) * 0.5);
      if (lf.t <= 0) {
        lf.here = true;
        g.audio.setLoop('hum', false);
        g.audio.tone(880, 0.4, 'sine', 0.08); setTimeout(() => g.audio.tone(660, 0.6, 'sine', 0.08), 350);
        for (let a = -1; a <= 1; a++) for (let y = 0; y <= 2; y++) L.set(this.T.u + a, y, this.T.v, B.LIT_AIR);
        L.set(this.T.u, 3, this.T.v, B.LIGHT_PANEL);
        L.center('Ding. The lift doors open.', '#f0ecd8', 2.5);
      }
    }
    if (lf.here && Math.abs(pu - (this.T.u + 0.5)) <= 1.6 && pv >= this.T.v + 1 && pv <= this.T.v + 4) {
      L.exit('The doors shut on the dark. The lift climbs for a long, long time, and opens on daylight.');
      return;
    }
    this._mannequins(dt, pu, pv);
    // the wind outside the loading door
    const de = Math.hypot(pu - this.E.u, pv - this.E.v);
    g.audio.setLoop('wind', de < 30, clamp(1 - de / 30, 0, 1) * 0.6);
  }

  _mannequins(dt) {
    const L = this.L, g = this.g, p = this.P.pos;
    this.spawnT -= dt;
    const want = Math.min(12, 4 + Math.floor(this.t / 70) + (this.powered ? 2 : 0) + (this.lift.called && !this.lift.here ? 3 : 0));
    if (this.spawnT <= 0) { this.spawnT = 2.5; if (this.man.length < want) this._spawn(); }
    let nearest = 99;
    const surge = this.seq >= 1.2 && this.seq < 3.8;
    const frenzied = this.lift.called && !this.lift.here;
    this.clickT -= dt; this.creakT -= dt;
    for (const q of this.man) {
      const m = q.m, j = m.userData.j;
      const d = Math.hypot(m.position.x - p.x, m.position.z - p.z);
      nearest = Math.min(nearest, d);
      if (d > 50) { m.removeFromParent(); q.dead = true; continue; }
      q.frenzy = Math.max(0, q.frenzy - dt);
      if (this.seen(m.position, 1.6)) {
        // caught in the light: a new pose each time, and the head turns to follow you
        if (q.moved) {
          q.moved = false;
          let k = q.pose;
          while (k === q.pose) k = 1 + Math.floor(Math.random() * (MQ.POSES.length - 1));
          q.pose = k;
          MQ.setPose(m, MQ.POSES[k]);
          this.face(m, p.x, p.z, 1);
          q.head = 0;
          if (this.clickT <= 0) { this.clickT = 0.35; g.audio.clicks(0.05, this.pan(m.position.x, m.position.z)); g.audio.noiseHit(0.04, 2400, 0.05, 'bandpass', 3); }
        }
        const want = wrapA(Math.atan2(p.x - m.position.x, p.z - m.position.z) - m.rotation.y);
        q.head += (clamp(want, -1.3, 1.3) - q.head) * Math.min(1, dt * 0.8);
        j.neck.rotation.y = MQ.POSES[q.pose].neck[1] + q.head;
        if (Math.abs(want - q.head) > 0.05 && this.creakT <= 0 && d < 14) { this.creakT = 1.4; g.audio.distant('creak', { pan: this.pan(m.position.x, m.position.z), gain: 0.8 }); }
        continue;
      }
      // they give you a little while to find your feet
      if (this.t < 14) continue;
      // unseen: the quick, stiff walk you never quite catch
      q.moved = true;
      q.walkT += dt;
      MQ.walkPose(m, q.walkT);
      this.face(m, p.x, p.z, Math.min(1, dt * 8));
      const speed = surge ? 7 : frenzied || q.frenzy > 0 ? 6.2 : 3.2 + 1.3 * clamp((this.t - 14) / 120, 0, 1);
      const ok = this.step(m, p.x, p.z, speed, dt, true);
      q.stuck = ok ? 0 : q.stuck + dt;
      if (q.stuck > 1.2) {
        const spot = this.hiddenSpot(Math.max(5, d * 0.6), Math.max(8, d * 0.9), 20);
        if (spot) L.point(spot[0] + 0.5, 0, spot[1] + 0.5, m.position);
        q.stuck = 0;
      }
      if (d < 1.2) {
        L.scare(1);
        L.hurt(22, 'a mannequin');
        this.battery = Math.max(0, this.battery - 20);
        L.mode.torch = false;
        L.center('Cold plastic fingers. Your torch goes flying.', '#e8c8c0', 2.5);
        _w.set(p.x - m.position.x, 0, p.z - m.position.z).normalize();
        this.P.vel.x += _w.x * 9; this.P.vel.z += _w.z * 9; this.P.vel.y = 5;
        const spot = this.hiddenSpot(22, 34, 30);
        if (spot) L.point(spot[0] + 0.5, 0, spot[1] + 0.5, m.position); else { m.removeFromParent(); q.dead = true; }
      }
    }
    this.man = this.man.filter((q) => !q.dead);
    this.dread = 0.3 + clamp(1 - nearest / 18, 0, 1) * 0.5 + (surge || frenzied ? 0.2 : 0);
  }
}

export const KINDS = { backrooms: Backrooms, poolrooms: Poolrooms, hallway: Hallway, library: Library, warehouse: Warehouse };
export { STYLE };
