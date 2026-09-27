// Other dreamers, drawn in your world: their bodies, their starships and their Roamers, smoothed
// between network snapshots and labelled on your HUD.
import * as THREE from 'three';
import { buildTraveller, buildShip } from '../entities/shipModel.js';
import { buildRover, WHEEL_R } from '../entities/roverModel.js';
import { castShadows } from '../world/shadows.js';
import { hash32 } from '../core/rng.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };

export function peerSeed(id) { let h = 7; for (const ch of String(id)) h = hash32(h, ch.charCodeAt(0)); return h >>> 0; }
export function peerColor(id) { const h = (peerSeed(id) % 360) / 360; return `hsl(${Math.round(h * 360)}, 85%, 70%)`; }

export class RemotePlayers {
  constructor() {
    this.ents = new Map();
    this.scene = null;
  }

  // entities live in whichever scene is active (surface or space)
  attach(scene) {
    if (this.scene === scene) return;
    this.scene = scene;
    for (const e of this.ents.values()) for (const o of [e.body, e.ship, e.rover, e.line]) if (o) { o.removeFromParent(); scene.add(o); }
  }

  _ent(id) {
    let e = this.ents.get(id);
    if (e) return e;
    const seed = peerSeed(id);
    e = { id, snaps: [], body: buildTraveller(seed), ship: buildShip(seed), rover: null, walk: 0, wave: 0 };
    castShadows(e.body); castShadows(e.ship);
    for (const f of e.ship.userData.flames || []) f.layers.disable(1);
    if (e.ship.userData.plasma) e.ship.userData.plasma.group.visible = false;
    e.body.visible = e.ship.visible = false;
    if (this.scene) { this.scene.add(e.body); this.scene.add(e.ship); }
    this.ents.set(id, e);
    return e;
  }

  remove(id) {
    const e = this.ents.get(id);
    if (!e) return;
    for (const o of [e.body, e.ship, e.rover, e.line]) if (o) o.removeFromParent();
    this.ents.delete(id);
  }

  clear() { for (const id of [...this.ents.keys()]) this.remove(id); }

  push(id, snap, now) {
    const e = this._ent(id);
    snap.at = now;
    e.snaps.push(snap);
    if (e.snaps.length > 6) e.snaps.shift();
    e.last = snap;
  }

  wave(id) { const e = this.ents.get(id); if (e) e.wave = 2.2; }

  // sample a peer ~120 ms in the past, between the two snapshots that bracket that moment
  _sample(e, now) {
    const t = now - 120;
    const S = e.snaps;
    let a = S[0], b = S[S.length - 1];
    for (let i = 0; i < S.length - 1; i++) if (S[i].at <= t && S[i + 1].at >= t) { a = S[i]; b = S[i + 1]; break; }
    const span = Math.max(1, b.at - a.at);
    const k = Math.min(1, Math.max(0, (t - a.at) / span));
    return { a, b, k };
  }

  // a sagging glowing line from their hand to the bobber
  _line(e, snap, ctx) {
    if (!snap) { if (e.line) e.line.visible = false; return; }
    if (!e.line) {
      const N = 16;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(0.9, 2.2, 1.9), transparent: true, opacity: 0.9 }));
      line.frustumCulled = false;
      const bob = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 2.4, 2.2) }));
      line.add(bob);
      line.userData = { N, bob };
      e.line = line;
      if (this.scene) this.scene.add(line);
    }
    const L = e.line, N = L.userData.N;
    L.visible = true;
    // from the right hand, roughly
    const yaw = e.body.rotation.y;
    _a.set(Math.cos(yaw) * -0.35, 1.25, Math.sin(yaw) * 0.35).add(e.body.position);
    _b.set(snap.fb[0], snap.fb[1] + (snap.fr ? Math.sin(ctx.now * 0.03) * 0.06 : Math.sin(ctx.now * 0.002) * 0.03), snap.fb[2]);
    const arr = L.geometry.attributes.position.array;
    const sag = _a.distanceTo(_b) * (snap.fr ? 0.03 : 0.12);
    for (let i = 0; i <= N; i++) {
      const u = i / N;
      arr[i * 3] = _a.x + (_b.x - _a.x) * u;
      arr[i * 3 + 1] = _a.y + (_b.y - _a.y) * u - Math.sin(u * Math.PI) * sag;
      arr[i * 3 + 2] = _a.z + (_b.z - _a.z) * u;
    }
    L.geometry.attributes.position.needsUpdate = true;
    L.userData.bob.position.copy(_b);
  }

  // ctx: { here: { mode: 'surface'|'space', sys, planet }, now, dt, markers(pos, name, color) }
  update(ctx) {
    for (const e of this.ents.values()) {
      const L = e.last;
      const show = L && L.s === ctx.here.sys && (ctx.here.mode === 'space' ? L.m === 'x' : L.m === 's' && L.p === ctx.here.planet);
      if (!show || e.snaps.length === 0) { e.body.visible = e.ship.visible = false; if (e.rover) e.rover.visible = false; if (e.line) e.line.visible = false; continue; }
      const { a, b, k } = this._sample(e, ctx.now);
      // body
      _a.set(a.x, a.y, a.z).lerp(_b.set(b.x, b.y, b.z), k);
      const onFoot = !b.sh && !b.rv && ctx.here.mode === 'surface';
      e.body.visible = onFoot;
      if (onFoot) {
        e.body.position.copy(_a);
        e.body.rotation.y = lerpAngle(a.yw, b.yw, k) + Math.PI;
        const moving = b.mv ? 1 : 0;
        e.walk += ctx.dt * (moving ? 9 : 0);
        const ud = e.body.userData;
        e.wave = Math.max(0, e.wave - ctx.dt);
        for (const arm of ud.arms) {
          if (e.wave > 0 && arm.userData.side > 0) arm.rotation.x = -2.6 + Math.sin(e.wave * 14) * 0.35;
          else arm.rotation.x = Math.sin(e.walk) * 0.6 * moving * arm.userData.side;
        }
        for (const c of e.body.children) if (c.userData.side && !ud.arms.includes(c)) c.rotation.x = Math.sin(e.walk) * 0.7 * moving * c.userData.side;
        ud.head.rotation.x = -(b.pt || 0) * 0.5;
      }
      // ship: wherever they left it (or flying it)
      const hasShip = b.sx !== undefined && (b.sh || ctx.here.mode === 'surface');
      e.ship.visible = !!hasShip;
      if (hasShip) {
        const sa = a.sx !== undefined ? a : b;
        e.ship.position.set(sa.sx, sa.sy, sa.sz).lerp(_b.set(b.sx, b.sy, b.sz), k);
        _qa.set(sa.sq[0], sa.sq[1], sa.sq[2], sa.sq[3]);
        _qb.set(b.sq[0], b.sq[1], b.sq[2], b.sq[3]);
        e.ship.quaternion.slerpQuaternions(_qa, _qb, k);
        const gear = e.ship.userData.gear;
        if (gear) gear.visible = b.ss === 0;
        const flying = b.ss !== 0;
        for (const f of e.ship.userData.flames || []) { f.visible = flying; f.scale.z = (0.8 + (b.spd || 0) / 120) * 2.2 * (0.85 + Math.sin(ctx.now * 0.04 + f.position.x * 7) * 0.15); }
      }
      // Roamer
      if (b.rv && ctx.here.mode === 'surface') {
        if (!e.rover) { e.rover = buildRover(); castShadows(e.rover); for (const bm of e.rover.userData.beams) bm.layers.disable(1); if (this.scene) this.scene.add(e.rover); }
        e.rover.visible = true;
        e.rover.position.set(a.rx ?? b.rx, a.ry ?? b.ry, a.rz ?? b.rz).lerp(_b.set(b.rx, b.ry, b.rz), k);
        e.rover.rotation.set(b.rp || 0, lerpAngle(a.ryw ?? b.ryw, b.ryw, k), b.rr || 0, 'YXZ');
        for (const w of e.rover.userData.wheels) { w.mesh.rotation.x -= (b.rsp || 0) * ctx.dt / WHEEL_R; }
        for (const bm of e.rover.userData.beams) bm.visible = !!b.rl;
      } else if (e.rover) e.rover.visible = false;
      // their Dream Line, if they are fishing
      this._line(e, onFoot && b.fb ? b : null, ctx);
      // name tag
      const tagPos = onFoot ? e.body.position.clone().add(new THREE.Vector3(0, 2.6, 0)) : b.rv && e.rover ? e.rover.position.clone().add(new THREE.Vector3(0, 3.2, 0)) : e.ship.visible ? e.ship.position.clone().add(new THREE.Vector3(0, 3, 0)) : null;
      if (tagPos && ctx.markers) ctx.markers(tagPos, e.name || 'Dreamer', e.color || '#fff');
    }
  }
}

