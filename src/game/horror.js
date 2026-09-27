// The dread director: a hidden fear level that shapes sound, image and what walks in the fog.
// Owns the horrors: the Hollow (a stalker), the Walker (a colossus crossing the land), the Choir,
// eyes in the dark, and the Maws of Naraka. Also fog surges and wrong nights.
import * as THREE from 'three';
import { clamp, lerp } from '../core/rng.js';
import { B, IS_SOLID, IS_LIQUID } from '../world/blocks.js';
import { buildHollow, buildChoirFigure, buildMaw, buildWalker, buildEyes, placeSegment } from '../entities/horrorModels.js';
import { buildTraveller } from '../entities/shipModel.js';

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Vector3();
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const rnd = (a, b) => a + Math.random() * (b - a);

export class Horror {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.hollowModel = null;
    this.reset();
  }

  reset() {
    this.dread = 0; this.pulse = 0; this.hbT = 0; this.breathT = 6; this.whisperT = 20;
    this.shake = 0; this.glitch = 0; this.flash = 0; this.flicker = 1;
    this.blips = []; this.beepT = 0;
    this.hollow = null; this.walker = null; this.choir = null; this.eyes = []; this.maws = []; this.visitor = null;
    this.surge = { k: 0, phase: 'none', t: 0, next: rnd(300, 600) };
    this.longNight = false; this.longNightK = 0; this.wasDark = false;
    this.timers = { hollow: rnd(40, 90), walker: rnd(70, 160), choir: rnd(140, 280), eyes: 3, visitor: rnd(150, 320) };
    this.cause = null;
  }

  clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.reset();
  }

  setPlanet(planet) {
    this.clear();
    const P = planet.params;
    this.P = P;
    const zones = P.zones ? P.zones.map((z) => z[0]) : [];
    this.pocketKind = P.interior && P.interior !== 'station' ? P.interior : null;
    this.dreamWorld = !!this.pocketKind || (!P.interior && (['liminal', 'exotic', 'dead'].includes(planet.biome) || zones.includes('naraka')));
    this.anyZones = zones.length > 0;
    this.interior = P.interior === 'station';
  }

  get fogMul() { return 1 + this.surge.k * 1.9 + this.longNightK * 0.5; }
  get mistMul() { return 1 + this.surge.k * 2.2 + this.longNightK * 0.6; }

  // ------------------------------------------------------------------ main
  update(dt, ctx) {
    if (this.interior || !this.P) { this._fx(dt, ctx, 0); return; }
    // inside a liminal pocket the place itself decides how afraid you are; the things out in the
    // fog stay out there
    if (ctx.liminal != null) {
      if (!this.inPocket) {
        this.inPocket = true;
        for (const c of [...this.group.children]) this.group.remove(c);
        this.hollow = null; this.walker = null; this.choir = null; this.visitor = null; this.eyes = []; this.maws = [];
      }
      const t = clamp(ctx.liminal * (ctx.calm ?? 1), 0, 1);
      this.dread += (t - this.dread) * Math.min(1, dt * (t > this.dread ? 0.6 : 0.25));
      this._fx(dt, ctx, this.dread);
      return;
    }
    this.inPocket = false;
    this.ctx = ctx;
    const cam = ctx.cam;
    this.camDir = cam.getWorldDirection(this._camDir || (this._camDir = new THREE.Vector3()));
    this.viewYaw = Math.atan2(this.camDir.x, this.camDir.z);
    this._events(dt, ctx);
    this._updateHollow(dt, ctx);
    this._updateWalker(dt, ctx);
    this._updateChoir(dt, ctx);
    this._updateEyes(dt, ctx);
    this._updateMaws(dt, ctx);
    this._updateVisitor(dt, ctx);
    // dread target
    let t = 0;
    const dark = 1 - ctx.daylight;
    t += dark * (this.dreamWorld ? 0.32 : 0.18);
    t += { naraka: 0.4, backrooms: 0.3, tilevoid: 0.18, library: 0.18 }[ctx.zone] || (ctx.zone ? 0.08 : 0);
    t += ctx.enc * 0.1 + this.surge.k * 0.25 + this.longNightK * 0.3;
    if (this.hollow) {
      const h = this.hollow;
      t += h.state === 'lurk' ? 0.18 : h.state === 'stalk' ? 0.42 : h.state === 'rush' || h.state === 'lunge' ? 0.75 : 0.2;
    }
    if (this.walker) t += 0.25 * clamp(1 - this.walker.dist / 160, 0, 1);
    if (this.choir && this.choir.state === 'noticed') t += 0.35;
    if (this.maws.some((m) => m.state !== 'hidden')) t += 0.35;
    if (this.visitor) t += this.visitor.state === 'run' || this.visitor.state === 'turn' ? 0.7 : 0.12;
    if (ctx.inShip) t *= 0.35;
    t *= ctx.calm ?? 1;
    t = clamp(t, 0, 1);
    this.dread += (t - this.dread) * Math.min(1, dt * (t > this.dread ? 0.35 : 0.18));
    this._fx(dt, ctx, this.dread);
    this._tracker(dt, ctx);
  }

  // sound and image of fear
  _fx(dt, ctx, d) {
    const A = ctx.audio;
    d *= ctx.fear ?? 1;
    A.setDread(d);
    this.pulse = Math.max(0, this.pulse - dt * 4);
    if (d > 0.38) {
      this.hbT -= dt;
      if (this.hbT <= 0) {
        const k = (d - 0.38) / 0.62;
        this.hbT = 60 / (58 + 105 * k);
        A.heartbeat(0.07 + 0.2 * k);
        this.pulse = 0.5 + 0.5 * k;
      }
    }
    if (d > 0.68) {
      this.breathT -= dt;
      if (this.breathT <= 0) { this.breathT = rnd(3.2, 4.4); A.breath(0.03 + (d - 0.68) * 0.12); }
    }
    if (d > 0.5 && !ctx.inShip) {
      this.whisperT -= dt;
      if (this.whisperT <= 0) { this.whisperT = rnd(14, 30) * (1.3 - d); A.whisper(0.025 + d * 0.03, rnd(-1, 1)); }
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.glitch = Math.max(0, this.glitch - dt * 1.2);
    this.flash = Math.max(0, this.flash - dt * 3);
    // lights stutter when the Hollow is close
    let fl = 1;
    if (this.hollow && this.hollow.dist < 38) {
      const k = 1 - this.hollow.dist / 38;
      if (Math.random() < 0.15 + k * 0.45) fl = Math.random() < k * 0.6 ? 0.05 : rnd(0.35, 0.9);
    }
    this.flicker += (fl - this.flicker) * Math.min(1, dt * 25);
  }

  // ------------------------------------------------------------------ events: fog surges, wrong nights
  _events(dt, ctx) {
    const S = this.surge;
    const canSurge = !this.pocketKind && (this.dreamWorld || this.anyZones || ctx.daylight < 0.3);
    if (S.phase === 'none') {
      if (canSurge) S.next -= dt;
      if (S.next <= 0 && !ctx.inShip) {
        S.phase = 'rise'; S.t = 0;
        ctx.hud.setCenter('The fog is coming in.', '#cfd3dc'); ctx.centerT(4);
        ctx.audio.swell(0.05);
      }
    } else {
      S.t += dt;
      if (S.phase === 'rise') { S.k = Math.min(1, S.t / 18); if (S.t >= 18) { S.phase = 'hold'; S.t = 0; S.hold = rnd(55, 95); } }
      else if (S.phase === 'hold') { S.k = 1; if (S.t >= S.hold) { S.phase = 'fall'; S.t = 0; } }
      else if (S.phase === 'fall') { S.k = Math.max(0, 1 - S.t / 25); if (S.t >= 25) { S.phase = 'none'; S.k = 0; S.next = this.dreamWorld ? rnd(420, 840) : rnd(900, 1600); } }
    }
    // a wrong night is decided at dusk
    const dark = ctx.daylight < 0.3;
    if (dark && !this.wasDark && ctx.playTime > 600) {
      const chance = this.dreamWorld ? 0.22 : this.anyZones ? 0.1 : 0.05;
      if (Math.random() < chance) {
        this.longNight = true;
        ctx.hud.setCenter('The night is wrong.', '#d98a8a'); ctx.centerT(5);
        ctx.audio.choir(0.035, 0, 6);
      }
    }
    if (ctx.daylight > 0.35) this.longNight = false;
    this.wasDark = dark;
    this.longNightK += ((this.longNight ? 1 : 0) - this.longNightK) * Math.min(1, dt * 0.25);
  }

  // ------------------------------------------------------------------ helpers
  _ground(x, y, z) {
    const W = this.ctx.world;
    if (!W.isLoaded(x, z)) return null;
    const gy = W.groundBelow(x, y, z);
    if (gy < 1) return null;
    if (IS_LIQUID[W.getBlock(x, gy, z)]) return null;
    return gy + 1;
  }

  // how directly the camera looks at a point (cosine), and distance
  _view(p, yOff = 1.5) {
    const c = this.ctx.cam.position;
    _q.set(p.x - c.x, p.y + yOff - c.y, p.z - c.z);
    const d = _q.length() || 1;
    return { dot: _q.dot(this.camDir) / d, d };
  }

  _pan(p) {
    const a = Math.atan2(p.x - this.ctx.cam.position.x, p.z - this.ctx.cam.position.z);
    return clamp(Math.sin(wrapA(this.viewYaw - a)), -1, 1);
  }

  _lineOfSight(p, yOff) {
    const c = this.ctx.cam.position;
    _w.set(p.x - c.x, p.y + yOff - c.y, p.z - c.z);
    const d = _w.length();
    _w.multiplyScalar(1 / d);
    const hit = this.ctx.world.raycast(c, _w, d - 0.8);
    return !hit;
  }

  // ------------------------------------------------------------------ the Hollow
  _hollowActive(ctx) {
    if (ctx.interior) return false;
    const dark = ctx.daylight < 0.35;
    if (this.pocketKind === 'void') return false;
    const deep = ctx.zone === 'backrooms' || ctx.zone === 'naraka' || this.pocketKind === 'derelict';
    if (this.longNight && dark) return true;
    return this.dreamWorld && (dark || deep || this.surge.k > 0.6);
  }

  _spawnHollow(ctx) {
    const pl = ctx.player;
    const D = ctx.zone === 'backrooms' ? 30 : clamp(ctx.fogFar * 0.5, 34, 58);
    for (let i = 0; i < 12; i++) {
      const a = this.viewYaw + Math.PI + rnd(-1.2, 1.2);
      const x = pl.x + Math.sin(a) * D, z = pl.z + Math.cos(a) * D;
      const gy = this._ground(x, pl.y + 6, z);
      if (gy == null || Math.abs(gy - pl.y) > 8) continue;
      if (!this.hollowModel) this.hollowModel = buildHollow();
      const mesh = this.hollowModel;
      mesh.visible = true;
      this.group.add(mesh);
      this.hollow = { mesh, pos: new THREE.Vector3(x, gy, z), yaw: 0, state: 'lurk', D, side: Math.random() < 0.5 ? -1 : 1, health: 320, seenT: 0, awayT: 0, pose: 0, phase: 0, clickT: rnd(4, 8), twitch: 0, twT: 1, dist: D, fleeT: 0, lungeT: 0 };
      return true;
    }
    return false;
  }

  _removeHollow(cooldown) {
    if (this.hollow) { this.group.remove(this.hollow.mesh); this.hollow = null; }
    this.timers.hollow = cooldown;
  }

  _updateHollow(dt, ctx) {
    if (!this.hollow) {
      if (!this._hollowActive(ctx) || ctx.inShip) return;
      this.timers.hollow -= dt * (this.longNight ? 1.6 : 1);
      if (this.timers.hollow <= 0 && !this._spawnHollow(ctx)) this.timers.hollow = 5;
      return;
    }
    const h = this.hollow, pl = ctx.player, W = ctx.world;
    if (h.state !== 'lunge' && h.state !== 'dying' && (!this._hollowActive(ctx) || ctx.inShip)) { this._removeHollow(rnd(60, 120)); return; }
    const dx = pl.x - h.pos.x, dz = pl.z - h.pos.z;
    const dist = Math.hypot(dx, dz);
    h.dist = dist;
    const v = this._view(h.pos, h.pose > 0.5 ? 2.4 : 1.0);
    const seen = v.dot > 0.93 && v.d < 95 && this._lineOfSight(h.pos, h.pose > 0.5 ? 2.4 : 1.0);
    const lit = seen && ctx.torch && v.d < 28;
    let speed = 0, tx = h.pos.x, tz = h.pos.z, wantPose = 0;
    switch (h.state) {
      case 'lurk': {
        // hovers at the edge of vision, drifting with your gaze, closing in when you are not looking
        const a = this.viewYaw + h.side * 1.95;
        tx = pl.x + Math.sin(a) * h.D; tz = pl.z + Math.cos(a) * h.D;
        speed = Math.hypot(tx - h.pos.x, tz - h.pos.z) > 1.5 ? 8.5 : 0;
        if (seen) {
          h.seenT += dt;
          if (h.seenT > 0.35) { h.D = Math.min(70, h.D + 9); h.side *= -1; h.seenT = 0; ctx.audio.clicks(0.05, this._pan(h.pos)); }
        } else {
          h.awayT += dt;
          if (h.awayT > 9) { h.awayT = 0; h.D -= 5; }
        }
        h.clickT -= dt;
        if (h.clickT <= 0) { h.clickT = rnd(6, 13); ctx.audio.clicks(0.035 + (1 - h.D / 70) * 0.04, this._pan(h.pos)); }
        if (h.D <= 24) { h.state = 'stalk'; h.seenT = 0; }
        break;
      }
      case 'stalk':
        if (seen) {
          wantPose = 1; h.seenT += dt;
          if (lit) { this._hollowRecoil(ctx); break; }
          if (h.seenT > 3.5) { tx = pl.x; tz = pl.z; speed = 1.3; }
        } else {
          h.seenT = 0; tx = pl.x; tz = pl.z; speed = 5.2;
          h.clickT -= dt;
          if (h.clickT <= 0) { h.clickT = rnd(3, 6); ctx.audio.clicks(0.08, this._pan(h.pos)); }
        }
        if (dist < 10) { h.state = 'rush'; ctx.audio.clicks(0.12, this._pan(h.pos)); }
        if (dist > 48) { h.state = 'lurk'; h.D = 40; }
        break;
      case 'rush':
        tx = pl.x; tz = pl.z; speed = 12.5;
        if (lit && dist > 3) { this._hollowRecoil(ctx); break; }
        if (dist < 1.8 && Math.abs(h.pos.y - pl.y) < 3) this._hollowLunge(ctx);
        if (dist > 30) h.state = 'stalk';
        break;
      case 'flee':
        tx = h.pos.x - dx; tz = h.pos.z - dz; speed = 13;
        h.fleeT += dt;
        if (dist > 55 || h.fleeT > 5) { this._removeHollow(rnd(35, 80)); return; }
        break;
      case 'lunge':
        this._lungeFrame(dt, ctx);
        return;
      case 'dying':
        h.fleeT += dt;
        h.mesh.position.y = h.pos.y - h.fleeT * 1.6;
        h.mesh.rotation.z = Math.sin(h.fleeT * 30) * 0.15;
        if (h.fleeT > 1.5) this._removeHollow(rnd(500, 800));
        return;
    }
    if (speed > 0) this._moveHollow(h, tx, tz, speed, dt, W);
    else { const want = Math.atan2(dx, dz); h.yaw += wrapA(want - h.yaw) * Math.min(1, dt * 4); }
    h.pose += (wantPose - h.pose) * Math.min(1, dt * 6);
    this._animateHollow(h, dt, ctx, speed);
  }

  _moveHollow(h, tx, tz, speed, dt, W) {
    const want = Math.atan2(tx - h.pos.x, tz - h.pos.z);
    for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
      const a = want + off;
      const nx = h.pos.x + Math.sin(a) * speed * dt, nz = h.pos.z + Math.cos(a) * speed * dt;
      const gy = this._ground(nx, h.pos.y + 3, nz);
      if (gy == null || gy - h.pos.y > 3.2) continue;
      if (IS_SOLID[W.getBlock(nx, gy + 1, nz)]) continue;
      h.pos.x = nx; h.pos.z = nz;
      h.pos.y += (gy - h.pos.y) * Math.min(1, dt * 10);
      h.yaw += wrapA(a - h.yaw) * Math.min(1, dt * 8);
      h.moving = true;
      return;
    }
    h.moving = false;
  }

  _hollowRecoil(ctx) {
    const h = this.hollow;
    h.state = 'flee'; h.fleeT = 0;
    ctx.audio.screech(0.07);
    this.glitch = Math.max(this.glitch, 0.35);
  }

  _hollowLunge(ctx) {
    const h = this.hollow;
    h.state = 'lunge'; h.lungeT = 0;
    ctx.audio.screech(0.34);
    this.glitch = 1; this.flash = 0.35; this.shake = 1.4;
    this.cause = 'hollow';
  }

  _lungeFrame(dt, ctx) {
    const h = this.hollow, cam = ctx.cam;
    h.lungeT += dt;
    // face to face
    const p = _v.copy(cam.position).addScaledVector(this.camDir, 0.95);
    h.mesh.position.set(p.x, p.y - 3.05, p.z);
    h.mesh.rotation.set(0, Math.atan2(this.camDir.x, this.camDir.z), 0);
    const U = h.mesh.userData;
    U.body.position.y = 1.45; U.body.rotation.x = 0.25;
    U.neck.rotation.x = 0.35;
    U.head.rotation.set(Math.sin(h.lungeT * 60) * 0.12, Math.sin(h.lungeT * 47) * 0.2, 0.4 + Math.sin(h.lungeT * 33) * 0.25);
    for (const L of U.limbs) { L.shoulder.rotation.set(-1.2, 0, L.side * -0.5); L.fore.rotation.x = -0.9; }
    if (h.lungeT > 0.12 && !h.hit) { h.hit = true; ctx.onHurt(46, 'hollow'); }
    if (h.lungeT > 0.55) { this._removeHollow(rnd(160, 280)); this.flash = 0.2; this.glitch = 0.6; }
  }

  _animateHollow(h, dt, ctx, speed) {
    const U = h.mesh.userData, m = h.mesh;
    h.phase += dt * (speed > 0 ? 2.2 + speed * 0.9 : 0.6);
    m.position.copy(h.pos);
    m.rotation.set(0, h.yaw + Math.PI, 0);
    const k = h.pose; // 1 standing, 0 crawling
    U.body.position.y = lerp(0.78, 1.45, k);
    U.body.rotation.x = lerp(-1.32, 0.08, k);
    U.neck.rotation.x = lerp(1.25, 0.28, k);
    // twitches
    h.twT -= dt;
    if (h.twT <= 0) { h.twT = rnd(0.25, 1.8); h.tw = [rnd(-0.5, 0.5), rnd(-0.6, 0.6), rnd(-0.5, 0.5)]; }
    const tw = h.tw || [0, 0, 0];
    U.head.rotation.set(tw[0] * 0.6, tw[1], lerp(Math.PI * 0.92, 0.35, k) + tw[2]);
    const g = speed > 0 ? 1 : 0.1;
    for (const L of U.limbs) {
      const ph = h.phase + (L.side > 0 ? Math.PI : 0);
      L.shoulder.rotation.set(lerp(1.3 + Math.sin(ph) * 0.55 * g, 0.12, k), 0, L.side * lerp(-0.35, 0.08, k));
      L.fore.rotation.x = lerp(-1.0 + Math.cos(ph) * 0.4 * g, -0.12, k);
      L.hip.rotation.set(lerp(1.9 + Math.sin(ph + Math.PI) * 0.4 * g, Math.sin(ph) * 0.3 * (speed > 0 ? 1 : 0), k), 0, L.side * lerp(0.35, 0.03, k));
      L.shin.rotation.x = lerp(-2.1 + Math.cos(ph) * 0.3 * g, Math.max(0, -Math.sin(ph)) * 0.4 * (speed > 0 ? 1 : 0), k);
    }
  }

  // ------------------------------------------------------------------ the Walker
  _updateWalker(dt, ctx) {
    const T = ctx.world.terrain;
    const pl = ctx.player;
    if (!this.walker) {
      const can = !ctx.interior && !this.pocketKind && (this.dreamWorld || this.surge.k > 0.4 || this.longNight) && (this.P.fog.density > 1 / 110 || this.surge.k > 0.4);
      if (!can) return;
      this.timers.walker -= dt * (this.surge.k > 0.4 ? 3 : 1);
      if (this.timers.walker > 0) return;
      this.timers.walker = rnd(200, 420);
      const a0 = rnd(0, Math.PI * 2);
      const x = pl.x + Math.sin(a0) * 165, z = pl.z + Math.cos(a0) * 165;
      const side = Math.random() < 0.5 ? -1 : 1;
      const toP = Math.atan2(pl.x - x, pl.z - z);
      const heading = toP + side * rnd(0.38, 0.6);
      const model = buildWalker();
      this.group.add(model);
      for (const L of model.userData.legs) { this.group.add(L.thigh); this.group.add(L.shin); }
      const w = { model, pos: new THREE.Vector3(x, 0, z), dir: new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading)), speed: 3.4, t: 0, dist: 165, noticeT: 0, noticed: false, legs: [] };
      const hips = [[-2.6, 3.8], [2.6, 3.8], [-2.6, -3.8], [2.6, -3.8]];
      for (let i = 0; i < 4; i++) {
        const foot = new THREE.Vector3();
        w.legs.push({ hip: hips[i], foot, from: new THREE.Vector3(), to: new THREE.Vector3(), t: -1, pair: i === 0 || i === 3 ? 0 : 1, init: false });
      }
      this.walker = w;
      return;
    }
    const w = this.walker;
    w.t += dt;
    w.dist = Math.hypot(pl.x - w.pos.x, pl.z - w.pos.z);
    if (w.dist > 240 || ctx.interior) { this._removeWalker(); return; }
    if (!w.noticed && w.dist < 80 && Math.random() < dt * 0.25) { w.noticed = true; w.noticeT = rnd(7, 11); ctx.audio.choir(0.03, this._pan(w.pos), 5); }
    let spd = w.speed;
    if (w.noticeT > 0) { w.noticeT -= dt; spd = 0; }
    w.pos.addScaledVector(w.dir, spd * dt);
    const gh = T.heightAt(w.pos.x, w.pos.z);
    const bodyY = gh + 25 + Math.sin(w.t * 1.2) * 0.6;
    const M = w.model, U = M.userData;
    M.position.set(w.pos.x, bodyY, w.pos.z);
    const yaw = Math.atan2(w.dir.x, w.dir.z) + Math.PI;
    M.rotation.y = yaw;
    // head: hangs low, and turns toward you when it has noticed you
    const want = w.noticeT > 0 ? wrapA(Math.atan2(pl.x - w.pos.x, pl.z - w.pos.z) + Math.PI - yaw) : Math.sin(w.t * 0.3) * 0.25;
    U.neck.rotation.y += (clamp(want, -1.4, 1.4) - U.neck.rotation.y) * Math.min(1, dt * 0.8);
    U.neck.rotation.x = Math.sin(w.t * 0.5) * 0.06 + (w.noticeT > 0 ? -0.15 : 0);
    U.lightMat.opacity = (1 - ctx.daylight) * clamp(1.2 - w.dist / 200, 0, 0.8) * (0.7 + 0.3 * Math.sin(w.t * 2.3));
    M.updateMatrixWorld(true);
    const fwd = w.dir;
    const right = _q.set(fwd.z, 0, -fwd.x);
    const swinging = w.legs.filter((L) => L.t >= 0).map((L) => L.pair);
    for (const L of w.legs) {
      const hip = _v.set(L.hip[0], -0.6, L.hip[1]).applyMatrix4(M.matrixWorld).clone();
      const sx = Math.sign(L.hip[0]), sz = Math.sign(L.hip[1]);
      // resting foot spot: out to the side, a little ahead
      const rx = w.pos.x + right.x * sx * 10 - fwd.x * sz * 7, rz = w.pos.z + right.z * sx * 10 - fwd.z * sz * 7;
      if (!L.init) { L.foot.set(rx, T.heightAt(rx, rz) + 1, rz); L.init = true; }
      if (L.t < 0) {
        const lag = Math.hypot(L.foot.x - rx, L.foot.z - rz);
        if (lag > 7 && !swinging.includes(1 - L.pair) && spd > 0) {
          L.t = 0; L.from.copy(L.foot);
          const nx = rx + fwd.x * 5, nz = rz + fwd.z * 5;
          L.to.set(nx, T.heightAt(nx, nz) + 1, nz);
          swinging.push(L.pair);
        }
      } else {
        L.t += dt / 1.15;
        const k = Math.min(1, L.t);
        L.foot.lerpVectors(L.from, L.to, k);
        L.foot.y += Math.sin(k * Math.PI) * 7;
        if (L.t >= 1) {
          L.t = -1; L.foot.copy(L.to);
          const fd = Math.hypot(pl.x - L.foot.x, pl.z - L.foot.z);
          ctx.audio.boom(clamp(1 - fd / 190, 0.05, 1), this._pan(L.foot));
          this.shake = Math.max(this.shake, clamp(1 - fd / 95, 0, 1) * 0.7);
          if (fd < 4 && Math.abs(pl.y - L.foot.y) < 6) { ctx.onHurt(60, 'walker'); this.shake = 1.5; }
        }
      }
      // two-bone IK, knees up and out
      const dvec = _w.subVectors(L.foot, hip);
      let len = dvec.length();
      const a = 20, b = 20;
      len = clamp(len, 1, a + b - 0.1);
      dvec.normalize();
      const cosA = clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      const bend = new THREE.Vector3(right.x * sx, 1.6, right.z * sx);
      bend.addScaledVector(dvec, -bend.dot(dvec)).normalize();
      const knee = hip.clone().addScaledVector(dvec, a * cosA).addScaledVector(bend, a * sinA);
      const leg = U.legs[w.legs.indexOf(L)];
      placeSegment(leg.thigh, hip, knee);
      placeSegment(leg.shin, knee, L.foot);
    }
  }

  _removeWalker() {
    const w = this.walker;
    if (!w) return;
    this.group.remove(w.model);
    for (const L of w.model.userData.legs) { this.group.remove(L.thigh); this.group.remove(L.shin); }
    this.walker = null;
  }

  // ------------------------------------------------------------------ the Choir
  _updateChoir(dt, ctx) {
    const pl = ctx.player;
    if (!this.choir) {
      if (ctx.inShip || this.pocketKind || !(this.dreamWorld || this.dread > 0.45 || this.longNight)) return;
      this.timers.choir -= dt;
      if (this.timers.choir > 0) return;
      this.timers.choir = rnd(200, 420);
      for (let i = 0; i < 10; i++) {
        const a = this.viewYaw + rnd(-1.0, 1.0), r = rnd(38, 55);
        const cx = pl.x + Math.sin(a) * r, cz = pl.z + Math.cos(a) * r;
        const gy = this._ground(cx, pl.y + 8, cz);
        if (gy == null || Math.abs(gy - pl.y) > 10) continue;
        const figs = [];
        let ok = true;
        const dark = Math.random() < 0.4;
        for (let k = 0; k < 6 && ok; k++) {
          const fa = k / 6 * Math.PI * 2;
          const x = cx + Math.cos(fa) * 2.5, z = cz + Math.sin(fa) * 2.5;
          const fy = this._ground(x, gy + 3, z);
          if (fy == null || Math.abs(fy - gy) > 1.5) ok = false;
          else figs.push({ x, y: fy, z });
        }
        if (!ok) continue;
        const models = figs.map((f) => {
          const m = buildChoirFigure(dark);
          m.position.set(f.x, f.y, f.z);
          m.rotation.y = Math.atan2(-(cx - f.x), -(cz - f.z));
          m.scale.setScalar(rnd(1.05, 1.2));
          this.group.add(m);
          return m;
        });
        this.choir = { models, center: new THREE.Vector3(cx, gy, cz), state: 'idle', life: 150, awayT: 0, moves: 0, snap: 0 };
        return;
      }
      return;
    }
    const C = this.choir;
    C.life -= dt;
    const dist = Math.hypot(pl.x - C.center.x, pl.z - C.center.z);
    const v = this._view(C.center, 2);
    const looking = v.dot > 0.85 && v.d < 70;
    if (C.state === 'idle') {
      for (const m of C.models) m.userData.head.rotation.x = 0.35 + Math.sin(ctx.time * 0.4 + m.position.x) * 0.05;
      if (dist < 20) {
        C.state = 'noticed'; C.snap = 0;
        ctx.audio.choir(0.06, this._pan(C.center), 5);
        this.glitch = Math.max(this.glitch, 0.15);
      }
      if (C.life <= 0) this._removeChoir();
      return;
    }
    // every head turns to you at once
    C.snap = Math.min(1, C.snap + dt * 5);
    for (const m of C.models) {
      const want = wrapA(Math.atan2(pl.x - m.position.x, pl.z - m.position.z) + Math.PI - m.rotation.y);
      m.userData.head.rotation.y = want * C.snap;
      m.userData.head.rotation.x = -0.1 * C.snap;
    }
    if (!looking) C.awayT += dt; else C.awayT = 0;
    if (C.awayT > 2.5 && C.moves < 2 && dist > 15) {
      // when you look back, they are closer
      C.moves++; C.awayT = 0;
      const dx = (pl.x - C.center.x) / dist, dz = (pl.z - C.center.z) / dist;
      const step = Math.min(8, dist - 11);
      const ncx = C.center.x + dx * step, ncz = C.center.z + dz * step;
      const gy = this._ground(ncx, C.center.y + 6, ncz);
      if (gy != null) {
        const ox = ncx - C.center.x, oz = ncz - C.center.z;
        C.center.set(ncx, gy, ncz);
        for (const m of C.models) { m.position.x += ox; m.position.z += oz; const fy = this._ground(m.position.x, gy + 3, m.position.z); if (fy != null) m.position.y = fy; }
        ctx.audio.whisper(0.05, this._pan(C.center));
      }
    }
    if (dist < 9 || C.life <= -60) { ctx.audio.swell(0.1); this.glitch = Math.max(this.glitch, 0.4); this._removeChoir(); }
  }

  _removeChoir() {
    if (!this.choir) return;
    for (const m of this.choir.models) this.group.remove(m);
    this.choir = null;
  }

  // ------------------------------------------------------------------ eyes in the dark
  _updateEyes(dt, ctx) {
    const pl = ctx.player;
    const want = ctx.daylight < 0.28 && !ctx.inShip && (this.dreamWorld || this.anyZones || this.P.fauna > 0) ? Math.floor(2 + this.dread * 7 + this.longNightK * 3) : 0;
    this.timers.eyes -= dt;
    if (this.eyes.length < want && this.timers.eyes <= 0) {
      this.timers.eyes = rnd(1, 3.5);
      const a = this.viewYaw + rnd(-1.3, 1.3), r = rnd(14, 32);
      const x = pl.x + Math.sin(a) * r, z = pl.z + Math.cos(a) * r;
      const gy = this._ground(x, pl.y + 8, z);
      if (gy != null && !IS_SOLID[ctx.world.getBlock(x, gy + 1, z)]) {
        const red = Math.random() < 0.3 + this.longNightK * 0.5;
        const grin = this.dreamWorld && Math.random() < 0.18 + this.dread * 0.15;
        const g = buildEyes(red ? 0xff3a2a : 0xf4f0b0, grin);
        const y = gy + rnd(0.9, 2.2);
        g.position.set(x, y, z);
        this.group.add(g);
        this.eyes.push({ g, life: rnd(14, 38), fade: 0, blinkT: rnd(1, 4), blink: 0, gone: false });
      }
    }
    for (const e of this.eyes) {
      e.life -= dt;
      const v = this._view(e.g.position, 0);
      const lit = ctx.torch && v.dot > 0.96 && v.d < 32;
      if (e.life <= 0 || v.d < 12 || lit || want === 0) e.gone = true;
      e.fade = clamp(e.fade + (e.gone ? -dt * (lit ? 6 : 2) : dt * 0.8), 0, 1);
      e.blinkT -= dt;
      if (e.blinkT <= 0) { e.blinkT = rnd(1.5, 5); e.blink = 0.14; }
      e.blink = Math.max(0, e.blink - dt);
      e.g.lookAt(ctx.cam.position);
      e.g.scale.set(1, e.blink > 0 ? 0.08 : 1, 1);
      e.g.userData.mat.opacity = e.fade * clamp(1.5 - v.d / 45, 0.3, 1);
      e.g.userData.halo.opacity = e.g.userData.mat.opacity * 0.45;
      if (e.g.userData.grin) e.g.userData.grin.opacity = e.g.userData.mat.opacity * 0.85;
    }
    this.eyes = this.eyes.filter((e) => {
      if (e.gone && e.fade <= 0) { this.group.remove(e.g); e.g.userData.mat.dispose(); e.g.userData.halo.dispose(); if (e.g.userData.grin) e.g.userData.grin.dispose(); return false; }
      return true;
    });
  }

  // ------------------------------------------------------------------ the Maws of Naraka
  _updateMaws(dt, ctx) {
    const pl = ctx.player, W = ctx.world;
    const active = ctx.zone === 'naraka' && !ctx.inShip;
    if (!active) {
      if (this.maws.length && this.maws.every((m) => m.state === 'hidden')) { for (const m of this.maws) this.group.remove(m.mesh); this.maws = []; }
      if (!this.maws.length) return;
    }
    while (active && this.maws.length < 4) this.maws.push({ mesh: buildMaw(), pos: null, state: 'hidden', t: 0 });
    for (const m of this.maws) {
      if (m.state === 'hidden') {
        const d = m.pos ? Math.hypot(pl.x - m.pos.x, pl.z - m.pos.z) : 99;
        if (!m.pos || d > 30) {
          // re-hide somewhere near, in the flesh
          const a = rnd(0, Math.PI * 2), r = rnd(7, 22);
          const x = Math.floor(pl.x + Math.sin(a) * r) + 0.5, z = Math.floor(pl.z + Math.cos(a) * r) + 0.5;
          const gy = this._ground(x, pl.y + 5, z);
          if (gy != null && W.getBlock(x, gy - 1, z) === B.FLESH) m.pos = new THREE.Vector3(x, gy, z);
          continue;
        }
        if (d < 3.3 && Math.abs(pl.y - m.pos.y) < 2.5 && active) {
          m.state = 'telegraph'; m.t = 0;
          ctx.audio.wet(0.14); this.shake = Math.max(this.shake, 0.3);
        }
      } else {
        m.t += dt;
        if (m.state === 'telegraph' && m.t > 0.55) {
          m.state = 'bite'; m.t = 0;
          m.mesh.position.copy(m.pos); m.mesh.position.y -= 1.6;
          this.group.add(m.mesh);
          ctx.audio.wet(0.25); ctx.audio.tone(55, 0.5, 'sawtooth', 0.08, 0.6);
          this.shake = Math.max(this.shake, 0.6);
        } else if (m.state === 'bite') {
          const k = Math.min(1, m.t / 0.15);
          m.mesh.position.y = m.pos.y - 1.6 + k * 1.75;
          const jaw = m.mesh.userData.jaw;
          const close = clamp((m.t - 0.18) / 0.12, 0, 1);
          jaw.scale.set(1.25 - close * 0.7, 1, 1.25 - close * 0.7);
          if (m.t > 0.3 && !m.hit) {
            m.hit = true;
            if (Math.hypot(pl.x - m.pos.x, pl.z - m.pos.z) < 2.6) { ctx.onHurt(24, 'maw'); this.flash = 0.15; }
          }
          if (m.t > 0.9) { m.state = 'sink'; m.t = 0; }
        } else if (m.state === 'sink') {
          m.mesh.position.y = m.pos.y + 0.15 - (m.t / 1.4) * 1.9;
          if (m.t > 1.4) { this.group.remove(m.mesh); m.state = 'hidden'; m.pos = null; m.hit = false; }
        }
      }
    }
  }

  // ------------------------------------------------------------------ the Visitor
  // Someone is standing out there, waving. It looks almost like a person.
  _updateVisitor(dt, ctx) {
    const pl = ctx.player;
    if (!this.visitor) {
      if (ctx.inShip || this.pocketKind || !(this.dreamWorld || this.anyZones) || ctx.zone === 'backrooms') return;
      this.timers.visitor -= dt;
      if (this.timers.visitor > 0) return;
      this.timers.visitor = rnd(260, 520);
      for (let i = 0; i < 10; i++) {
        const a = this.viewYaw + rnd(-0.55, 0.55), r = rnd(30, 46);
        const x = pl.x + Math.sin(a) * r, z = pl.z + Math.cos(a) * r;
        const gy = this._ground(x, pl.y + 8, z);
        if (gy == null || Math.abs(gy - pl.y) > 9) continue;
        const model = buildTraveller(Math.floor(Math.random() * 1e6));
        model.position.set(x, gy, z);
        this.group.add(model);
        this.visitor = { model, pos: new THREE.Vector3(x, gy, z), state: 'wave', t: 0, awayT: 0, yaw: 0, spin: 0 };
        return;
      }
      return;
    }
    const V = this.visitor, U = V.model.userData;
    V.t += dt;
    const dx = pl.x - V.pos.x, dz = pl.z - V.pos.z, dist = Math.hypot(dx, dz);
    const v = this._view(V.pos, 1.5);
    const looking = v.dot > 0.8 && v.d < 90;
    const face = Math.atan2(dx, dz);
    if (V.state === 'wave') {
      V.yaw = face;
      const arm = U.arms.find((a) => a.userData.side > 0) || U.arms[0];
      if (arm) { arm.rotation.z = 2.5 + Math.sin(V.t * 7) * 0.45; }
      U.head.rotation.z = Math.sin(V.t * 0.8) * 0.15;
      if (!looking) V.awayT += dt; else V.awayT = 0;
      if (V.awayT > 4 || V.t > 90 || ctx.inShip) { this._removeVisitor(); return; }
      if (dist < 15) { V.state = 'turn'; V.t = 0; ctx.audio.clicks(0.1, this._pan(V.pos)); }
    } else if (V.state === 'turn') {
      // the head keeps turning after it should have stopped
      U.head.rotation.y = Math.min(Math.PI * 2, V.t / 0.6 * Math.PI * 2);
      U.head.rotation.z = Math.sin(V.t * 40) * 0.2;
      V.model.position.x = V.pos.x + (Math.random() - 0.5) * 0.06;
      if (V.t > 0.9) { V.state = 'run'; V.t = 0; ctx.audio.screech(0.12); this.glitch = Math.max(this.glitch, 0.3); }
    } else if (V.state === 'run') {
      V.yaw = face;
      const sp = 13;
      const nx = V.pos.x + (dx / dist) * sp * dt, nz = V.pos.z + (dz / dist) * sp * dt;
      const gy = this._ground(nx, V.pos.y + 3, nz);
      if (gy != null && gy - V.pos.y < 3) { V.pos.x = nx; V.pos.z = nz; V.pos.y += (gy - V.pos.y) * Math.min(1, dt * 10); }
      for (const a of U.arms) a.rotation.x = Math.sin(V.t * 22 + a.userData.side) * 1.4;
      U.body.rotation.x = -0.5;
      if (dist < 1.8 && Math.abs(V.pos.y - pl.y) < 3) {
        ctx.onHurt(24, 'visitor'); ctx.audio.screech(0.3); this.flash = 0.3; this.glitch = 0.9; this.shake = 1;
        this._removeVisitor(); return;
      }
      if (V.t > 6 || (!looking && V.t > 1.5 && Math.random() < dt * 1.5)) { ctx.audio.swell(0.08); this._removeVisitor(); return; }
    }
    V.model.position.set(V.state === 'turn' ? V.model.position.x : V.pos.x, V.pos.y, V.pos.z);
    V.model.rotation.y = V.yaw + Math.PI;
  }

  _removeVisitor() {
    if (!this.visitor) return;
    this.group.remove(this.visitor.model);
    this.visitor = null;
  }

  // ------------------------------------------------------------------ the tool's tracker
  _tracker(dt, ctx) {
    const pl = ctx.player;
    const out = [];
    const add = (p, kind, range) => {
      const d = Math.hypot(p.x - pl.x, p.z - pl.z);
      if (d > range) return;
      const a = wrapA(Math.atan2(p.x - pl.x, p.z - pl.z) - this.viewYaw);
      out.push({ a, d: d / range, kind });
    };
    if (this.hollow && this.hollow.state !== 'dying') add(this.hollow.pos, 'hollow', 60);
    if (this.choir) add(this.choir.center, 'choir', 60);
    if (this.visitor) add(this.visitor.pos, 'other', 60);
    if (this.walker) add(this.walker.pos, 'walker', 180);
    for (const p of ctx.extraBlips || []) add(p, 'other', 60);
    this.blips = out;
    const near = out.filter((b) => b.kind !== 'walker').reduce((m, b) => Math.min(m, b.d), 1);
    if (near < 1 && !ctx.inShip && ctx.toolOut) {
      this.beepT -= dt;
      if (this.beepT <= 0) { this.beepT = 0.22 + near * 1.3; ctx.audio.trackerBeep(1 - near); this.trackerPing = 1; }
    }
    this.trackerPing = Math.max(0, (this.trackerPing || 0) - dt * 3);
  }

  // ------------------------------------------------------------------ being shot at
  raycast(origin, dir, maxDist) {
    const h = this.hollow;
    if (!h || h.state === 'lunge' || h.state === 'dying') return null;
    const c = _v.copy(h.pos); c.y += h.pose > 0.5 ? 1.8 : 0.8;
    const r = h.pose > 0.5 ? 1.1 : 0.9;
    const oc = _w.copy(origin).sub(c);
    const b = oc.dot(dir), cc = oc.lengthSq() - r * r, disc = b * b - cc;
    if (disc < 0) return null;
    const t = -b - Math.sqrt(disc);
    return t > 0 && t < maxDist ? { dist: t } : null;
  }

  hitSphere(p, radius) {
    const h = this.hollow;
    if (!h || h.state === 'lunge' || h.state === 'dying') return false;
    const cy = h.pos.y + (h.pose > 0.5 ? 1.8 : 0.8);
    const r = 1 + radius;
    return (p.x - h.pos.x) ** 2 + (p.y - cy) ** 2 + (p.z - h.pos.z) ** 2 < r * r;
  }

  damageHollow(amount, ctx) {
    const h = this.hollow;
    if (!h || h.state === 'dying' || h.state === 'lunge') return false;
    h.health -= amount;
    this.glitch = Math.max(this.glitch, 0.2);
    if (h.health <= 0) {
      h.state = 'dying'; h.fleeT = 0;
      ctx.audio.screech(0.16); ctx.audio.swell(0.08);
      return true;
    }
    if (h.state !== 'flee') this._hollowRecoil(ctx);
    return false;
  }
}
