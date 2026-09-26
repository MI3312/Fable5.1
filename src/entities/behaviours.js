// What makes each creature itself. Herds graze and stampede, kodama walk single file toward
// forgotten things, gels split and merge, bears blow bubbles, snails leave glowing trails, flyers
// roost and scatter... and some things hunt.
//
// A behaviour's think(c, M, dt, ctx, dist, dx, dz) returns:
//   null                      fall back to the generic wander / flee / chase logic
//   { tx, tz, speed, vert }   walk toward (tx, tz) with the shared mover
//   { done: true, vert }      it moved the creature itself
// `vert: false` skips the shared ground / altitude settling.
import * as THREE from 'three';
import { B, IS_LIQUID, IS_SOLID } from '../world/blocks.js';
import { applyCurvature, curvatureUniforms } from '../core/shaderlib.js';

const TAU = Math.PI * 2;
export const wrapA = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const turnTo = (c, x, z, dt, k = 5) => { c.yaw += wrapA(Math.atan2(x - c.pos.x, z - c.pos.z) - c.yaw) * Math.min(1, dt * k); };
const rand = (a, b) => a + Math.random() * (b - a);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const _v = new THREE.Vector3();
const DONE = { done: true };
const DONE_FREE = { done: true, vert: false };

// ------------------------------------------------------------------------------------------
export function assignBehaviour(sp, rng) {
  const fixed = {
    kodama: 'procession', wildebeest: 'herd', gel: 'gel', bubblebear: 'bubbles', manta: 'school', moth: 'moth', snail: 'snail',
    spider: 'ambush', sandmaw: 'sandmaw', spitter: 'spitter', swarm: 'swarm', brute: 'brute', lurker: 'lurker',
  };
  if (fixed[sp.plan]) return fixed[sp.plan];
  switch (sp.plan) {
    case 'quad': return sp.temper === 'Aggressive' ? 'charger' : 'grazer';
    case 'biped': return sp.temper === 'Aggressive' ? null : 'mimic';
    case 'hopper': return sp.temper === 'Skittish' || rng.chance(0.5) ? 'burrower' : 'bouncer';
    case 'flyer': return sp.temper === 'Aggressive' ? 'diver' : 'percher';
    case 'floater': return 'drifter';
    case 'crawler': return 'skitter';
  }
  return null;
}

export const HABITS = {
  grazer: 'Grazes in loose herds',
  charger: 'Paws the ground before it charges',
  mimic: 'Copies whatever you do',
  burrower: 'Dives underground when startled',
  bouncer: 'Bounces higher than it should',
  percher: 'Roosts on the tallest thing around',
  diver: 'Circles high, then dives',
  drifter: 'Its falling pollen mends wounds',
  skitter: 'Moves only in bursts',
  ambush: 'Waits perfectly still',
};

// ------------------------------------------------------------------------------------------
// Short-lived things creatures leave in the world: bubbles, slime trails, caustic globs and puddles.
const bubbleMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uCurve: curvatureUniforms.uCurve },
  vertexShader: /* glsl */`
    uniform float uCurve;
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vec2 cd = w.xz - cameraPosition.xz;
      w.y -= dot(cd, cd) * uCurve;
      vN = normalize(mat3(modelMatrix) * normal);
      vV = normalize(cameraPosition - w.xyz);
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime;
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec3 n = normalize(vN), v = normalize(vV);
      float f = 1.0 - abs(dot(n, v));
      // thin-film interference: hue shifts with the film thickness seen at this angle
      float film = f * 2.6 + n.y * 0.9 + uTime * 0.15;
      vec3 irid = 0.5 + 0.5 * cos(6.2831 * (film + vec3(0.0, 0.33, 0.67)));
      float spec = pow(max(dot(reflect(-v, n), normalize(vec3(0.35, 0.9, 0.25))), 0.0), 60.0);
      vec3 col = irid * (0.25 + f * 0.9) + spec * 1.6;
      gl_FragColor = vec4(col, 0.05 + pow(f, 2.2) * 0.75 + spec);
    }`,
  transparent: true, depthWrite: false,
});
const BUBBLE_GEO = new THREE.SphereGeometry(1, 16, 12);
const GLOB_GEO = new THREE.IcosahedronGeometry(0.22, 1);
const DISC_GEO = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);

export class CreatureFX {
  constructor(group) {
    this.group = group;
    this.bubbles = []; this.globs = []; this.puddles = [];
    const n = 200;
    const geo = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2);
    this.slimeMat = applyCurvature(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.slime = new THREE.InstancedMesh(geo, this.slimeMat, n);
    this.slime.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.slime.count = 0;
    this.slime.frustumCulled = false;
    group.add(this.slime);
    this.slimeData = [];
    this.slimeNext = 0;
    this.globMat = new Map();
    this.boostT = 0;
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  clear() {
    for (const b of this.bubbles) this.group.remove(b.mesh);
    for (const b of this.globs) this.group.remove(b.mesh);
    for (const b of this.puddles) this.group.remove(b.mesh);
    this.bubbles = []; this.globs = []; this.puddles = [];
    this.slimeData = []; this.slime.count = 0;
  }

  bubble(pos, vel, r = rand(0.22, 0.42), owner = null) {
    if (this.bubbles.length > 28) return;
    const mesh = new THREE.Mesh(BUBBLE_GEO, bubbleMat);
    mesh.renderOrder = 8;
    mesh.position.copy(pos);
    mesh.scale.setScalar(0.01);
    this.group.add(mesh);
    this.bubbles.push({ mesh, pos: pos.clone(), vel: vel.clone(), r, t: 0, life: rand(9, 14), owner, ph: Math.random() * 6 });
  }

  slimeAt(x, y, z, rgb, life = 50) {
    const d = { x, y, z, rgb, life, t: 0, rot: Math.random() * 3 };
    if (this.slimeData.length < 200) this.slimeData.push(d);
    else { this.slimeData[this.slimeNext] = d; this.slimeNext = (this.slimeNext + 1) % 200; }
  }

  glob(from, vel, dmg, rgb) {
    const k = rgb.join(',');
    if (!this.globMat.has(k)) this.globMat.set(k, applyCurvature(new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) })));
    const mesh = new THREE.Mesh(GLOB_GEO, this.globMat.get(k));
    mesh.position.copy(from);
    this.group.add(mesh);
    this.globs.push({ mesh, pos: from.clone(), vel: vel.clone(), dmg, rgb, t: 0 });
  }

  puddle(x, y, z, rgb) {
    const mat = applyCurvature(new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    const mesh = new THREE.Mesh(DISC_GEO, mat);
    mesh.position.set(x, y + 0.03, z);
    mesh.scale.setScalar(1.3);
    this.group.add(mesh);
    this.puddles.push({ mesh, x, y, z, t: 0, life: 6, tick: 0 });
  }

  // returns nothing; talks to the game through ctx.fx
  update(dt, ctx) {
    const P = ctx.player, fx = ctx.fx, W = ctx.world;
    bubbleMat.uniforms.uTime.value = ctx.time;
    const pcx = P.x, pcy = P.y + 0.9, pcz = P.z;
    // bubbles drift up and pop, on you if you walk into them
    this.bubbles = this.bubbles.filter((b) => {
      b.t += dt;
      b.vel.y = Math.min(1.4, b.vel.y + dt * 0.5);
      b.vel.x += Math.sin(ctx.time * 0.9 + b.ph) * dt * 0.6;
      b.vel.z += Math.cos(ctx.time * 0.7 + b.ph) * dt * 0.6;
      b.vel.multiplyScalar(1 - dt * 0.4);
      b.pos.addScaledVector(b.vel, dt);
      const grow = Math.min(1, b.t * 3);
      const wob = 1 + Math.sin(ctx.time * 7 + b.ph) * 0.05;
      b.mesh.position.copy(b.pos);
      b.mesh.scale.set(b.r * grow * wob, b.r * grow / wob, b.r * grow * wob);
      const touch = !ctx.playerInShip && (b.pos.x - pcx) ** 2 + (b.pos.y - pcy) ** 2 + (b.pos.z - pcz) ** 2 < (b.r + 0.7) ** 2;
      if (touch || b.t > b.life || W.isSolid(b.pos.x, b.pos.y + b.r, b.pos.z)) {
        this.group.remove(b.mesh);
        fx.debris(b.pos, [0.95, 0.9, 1], 6, 1.6, 0.4, true);
        fx.sound('pop', b.pos);
        if (touch) fx.bubblePopped(b);
        return false;
      }
      return true;
    });
    // caustic globs arc through the air and burst
    this.globs = this.globs.filter((g) => {
      g.t += dt;
      g.vel.y -= 18 * dt;
      const prev = _v.copy(g.pos);
      g.pos.addScaledVector(g.vel, dt);
      g.mesh.position.copy(g.pos);
      g.mesh.rotation.x += dt * 9; g.mesh.rotation.y += dt * 7;
      if (Math.random() < dt * 30) fx.debris(prev, g.rgb, 1, 0.4, 0.5, true);
      const hitP = !ctx.playerInShip && (g.pos.x - pcx) ** 2 + (g.pos.y - pcy) ** 2 + (g.pos.z - pcz) ** 2 < 1.0;
      const hitW = W.isSolid(g.pos.x, g.pos.y, g.pos.z) || IS_LIQUID[W.getBlock(g.pos.x, g.pos.y, g.pos.z)];
      if (hitP || hitW || g.t > 5) {
        this.group.remove(g.mesh);
        fx.debris(g.pos, g.rgb, 14, 3.5, 0.7, true);
        fx.sound('splat', g.pos);
        const d2 = (g.pos.x - pcx) ** 2 + (g.pos.z - pcz) ** 2;
        if (!ctx.playerInShip && d2 < 1.9 * 1.9 && Math.abs(g.pos.y - pcy) < 2.2) fx.hurt(g.dmg, 'spitter');
        if (hitW && !hitP) {
          const gy = W.groundBelow(g.pos.x, g.pos.y + 0.5, g.pos.z);
          if (!IS_LIQUID[W.getBlock(g.pos.x, gy, g.pos.z)]) this.puddle(g.pos.x, gy + 1, g.pos.z, g.rgb);
        }
        return false;
      }
      return true;
    });
    // puddles sting while you stand in them
    this.puddles = this.puddles.filter((p) => {
      p.t += dt;
      const k = 1 - p.t / p.life;
      p.mesh.material.opacity = Math.max(0, k) * (0.6 + Math.sin(ctx.time * 6 + p.x) * 0.2);
      p.mesh.scale.setScalar(1.3 + p.t * 0.08);
      if (!ctx.playerInShip && Math.hypot(P.x - p.x, P.z - p.z) < 1.3 && Math.abs(P.y - p.y) < 1.2) {
        p.tick -= dt;
        if (p.tick <= 0) { p.tick = 0.5; fx.hurt(2.5, 'acid'); }
      }
      if (p.t >= p.life) { this.group.remove(p.mesh); p.mesh.material.dispose(); return false; }
      return true;
    });
    // slime: glows at night, quickens your step
    const m = this._m, col = this._c;
    let i = 0, onSlime = false;
    const glow = ctx.night ? 1 : 0.35;
    for (const s of this.slimeData) {
      s.t += dt;
      const k = Math.max(0, 1 - s.t / s.life);
      if (k <= 0) continue;
      m.makeRotationY(s.rot);
      m.setPosition(s.x, s.y + 0.02, s.z);
      this.slime.setMatrixAt(i, m);
      col.setRGB(s.rgb[0] * k * glow, s.rgb[1] * k * glow, s.rgb[2] * k * glow);
      this.slime.setColorAt(i, col);
      if (!onSlime && Math.abs(s.x - P.x) < 0.55 && Math.abs(s.z - P.z) < 0.55 && Math.abs(s.y - P.y) < 0.8) onSlime = true;
      i++;
    }
    this.slimeData = this.slimeData.filter((s) => s.t < s.life);
    this.slimeNext = Math.min(this.slimeNext, Math.max(0, this.slimeData.length - 1));
    this.slime.count = i;
    this.slime.instanceMatrix.needsUpdate = true;
    if (this.slime.instanceColor) this.slime.instanceColor.needsUpdate = true;
    if (onSlime) { if (this.boostT <= 0) fx.hint('slime', 'Snail slime. Your feet feel quicker.', '#d8ffe8'); this.boostT = 1.2; }
    this.boostT -= dt;
    fx.speedMul(this.boostT > 0 ? 1.4 : 1);
  }
}

// ------------------------------------------------------------------------------------------
// helpers shared by behaviours
function sameKind(M, c, r) {
  const out = [];
  for (const q of M.list) if (q !== c && !q.dead && q.sp === c.sp && flat(q.pos, c.pos) < r) out.push(q);
  return out;
}
function centroid(list, fallback) {
  if (!list.length) return fallback;
  let x = 0, z = 0;
  for (const q of list) { x += q.pos.x; z += q.pos.z; }
  return { x: x / list.length, z: z / list.length };
}
const _los = new THREE.Vector3();
function los(W, from, to) {
  _los.subVectors(to, from);
  const d = _los.length();
  return !W.raycast(from, _los.normalize(), d - 0.8);
}
function wanderNear(c, base, r, speedK = 0.45) {
  if (!c.target || c.timer <= 0 || flat(c.pos, c.target) < 1) {
    c.target = new THREE.Vector3(base.x + rand(-r, r), 0, base.z + rand(-r, r));
    c.timer = rand(5, 10);
  }
  return { tx: c.target.x, tz: c.target.z, speed: c.sp.speed * speedK };
}
const calm = (c) => c.state === 'idle' || c.state === 'wander';

// ------------------------------------------------------------------------------------------
export const BEHAVE = {
  // --- grazing herds: stop to eat, drift back toward the others
  grazer: {
    think(c, M, dt, ctx) {
      if (c.state === 'graze') {
        c.grazeT -= dt; c.headDown = 1;
        if (c.grazeT <= 0 || c.hurt > 0) { c.state = 'idle'; c.timer = rand(0.5, 2); c.headDown = 0; }
        return DONE;
      }
      if (!calm(c)) { c.headDown = 0; return null; }
      if (c.state === 'idle' && c.timer <= 0) {
        if (Math.random() < 0.5) { c.state = 'graze'; c.grazeT = rand(3, 8); return DONE; }
        c.state = 'wander';
        c.target = null;
      }
      if (c.state === 'wander') {
        const herd = centroid(sameKind(M, c, 22), c.pos);
        const r = wanderNear(c, herd, 7, 0.4);
        if (flat(c.pos, c.target) < 1) { c.state = 'idle'; c.timer = rand(1, 3); }
        return r;
      }
      return null;
    },
  },

  // --- chargers: stop, paw, snort, then come straight at you
  charger: {
    noReact: true,
    think(c, M, dt, ctx, dist) {
      const fx = ctx.fx, P = ctx.player;
      c.chargeCd = (c.chargeCd ?? rand(1, 3)) - dt;
      switch (c.state) {
        case 'windup':
          c.t -= dt;
          turnTo(c, P.x, P.z, dt, 6);
          c.paw = (c.paw || 0) + dt * 14;
          if (Math.random() < dt * 8) fx.debris(c.pos, [0.5, 0.42, 0.34], 2, 1.5, 0.6);
          if (c.t <= 0) { c.state = 'charge'; c.t = 2.0; c.dir = c.yaw; fx.sound('roar', c.pos); }
          return DONE;
        case 'charge': {
          c.t -= dt;
          c.yaw = c.dir;
          const sp = c.sp.speed * 3 + 5;
          const moved = M._move(c, dt, ctx, c.pos.x + Math.sin(c.dir) * 5, c.pos.z + Math.cos(c.dir) * 5, sp, 0);
          if (Math.random() < dt * 20) fx.debris(c.pos, [0.55, 0.48, 0.4], 2, 2, 0.6);
          if (dist < c.radius + 1.4 && !ctx.playerInShip && Math.abs(c.pos.y - P.y) < 2.5) {
            fx.hurt(9 + c.sp.size * 6, 'charge', Math.sin(c.dir) * 11, 6, Math.cos(c.dir) * 11);
            c.state = 'recover'; c.t = 1.4; c.chargeCd = rand(3, 5);
          } else if (!moved) {
            c.state = 'stunned'; c.t = 2.4; c.chargeCd = rand(3, 5);
            fx.sound('thud', c.pos); fx.debris(c.pos, [0.6, 0.55, 0.5], 12, 3, 0.8);
          } else if (c.t <= 0) { c.state = 'recover'; c.t = 1; c.chargeCd = rand(2.5, 4); }
          return DONE;
        }
        case 'stunned': case 'recover':
          c.t -= dt;
          c.dizzy = c.state === 'stunned' ? 1 : 0;
          if (c.t <= 0) { c.state = 'idle'; c.timer = 1; c.dizzy = 0; }
          return DONE;
      }
      if (dist < 20 && !ctx.playerInShip && c.chargeCd <= 0 && c.fed <= 0) {
        c.state = 'windup'; c.t = 1.2; c.paw = 0; fx.sound('snort', c.pos);
        return DONE;
      }
      return null;
    },
  },

  // --- mimics: walk when you walk, stop when you stop, jump when you jump
  mimic: {
    think(c, M, dt, ctx, dist) {
      const pl = ctx.fx.player;
      c.hopV = (c.hopV || 0) - 22 * dt;
      c.hopY = Math.max(0, (c.hopY || 0) + c.hopV * dt);
      if (c.hopY === 0) c.hopV = Math.max(c.hopV, 0);
      if (ctx.playerInShip || dist > 16 || !(calm(c) || c.state === 'mimic')) { if (c.state === 'mimic') c.state = 'idle'; return null; }
      c.state = 'mimic';
      turnTo(c, ctx.player.x, ctx.player.z, dt, 4);
      if (pl.vel.y > 3 && !pl.onGround && c.hopY === 0 && !c.jumped) { c.hopV = 6.5; c.jumped = true; }
      if (pl.onGround) c.jumped = false;
      const vx = pl.vel.x, vz = pl.vel.z;
      const s = Math.hypot(vx, vz);
      if (s < 0.4) { c.stillT = (c.stillT || 0) + dt; return DONE; }
      c.stillT = 0;
      const k = Math.min(1, c.sp.speed * 1.6 / s);
      // walks the way you walk, still looking at you
      M._move(c, dt, ctx, c.pos.x + vx, c.pos.z + vz, s * k, 5, true);
      return DONE;
    },
  },

  // --- burrowers: into the ground when startled, up again somewhere else
  burrower: {
    think(c, M, dt, ctx, dist, dx, dz) {
      const fx = ctx.fx, W = ctx.world;
      switch (c.state) {
        case 'dig':
          c.t -= dt; c.sink = Math.min(1, (c.sink || 0) + dt * 1.6);
          if (Math.random() < dt * 25) fx.debris(c.pos, [0.45, 0.36, 0.28], 2, 2.5, 0.6);
          if (c.t <= 0) { c.state = 'buried'; c.t = rand(5, 10); c.hidden = true; }
          return DONE;
        case 'buried': {
          c.t -= dt;
          if (c.t <= 0) {
            const a = Math.atan2(dx, dz) + rand(-1, 1), r = rand(10, 18);
            const x = ctx.player.x + Math.sin(a) * r, z = ctx.player.z + Math.cos(a) * r;
            const gy = W.groundBelow(x, ctx.player.y + 8, z);
            if (gy > 1 && !IS_LIQUID[W.getBlock(x, gy, z)]) c.pos.set(x, gy + 1, z);
            c.state = 'emerge'; c.t = 0.7; c.hidden = false;
            fx.debris(c.pos, [0.45, 0.36, 0.28], 12, 3, 0.8);
            fx.sound('squeak', c.pos);
          }
          return DONE;
        }
        case 'emerge':
          c.t -= dt; c.sink = Math.max(0, c.sink - dt * 1.8);
          if (c.t <= 0) { c.state = 'idle'; c.timer = 1; c.sink = 0; }
          return DONE;
      }
      if ((dist < 7 && !ctx.playerInShip) || c.hurt > 0) { c.state = 'dig'; c.t = 0.9; c.sink = 0; fx.sound('dig', c.pos); return DONE; }
      return null;
    },
  },

  // --- bouncers: everything is a big springy arc
  bouncer: {
    think(c) { c.bounce = true; return null; },
  },

  // --- perchers: roost on tree tops, scatter together when you come close
  percher: {
    think(c, M, dt, ctx, dist) {
      const W = ctx.world, fx = ctx.fx;
      if (!c.home) c.home = c.pos.clone();
      if (c.state === 'perch') {
        c.folded = true; c.moving = false;
        c.t -= dt;
        if ((dist < 9 && !ctx.playerInShip) || c.t <= 0 || c.hurt > 0) {
          for (const q of [c, ...sameKind(M, c, 16)]) if (q.state === 'perch' || q === c) {
            q.state = 'fly'; q.folded = false; q.t = rand(8, 16); q.flyAlt = rand(9, 18); q.scare = 2;
            q.home = q.pos.clone();
          }
          fx.sound('flutter', c.pos);
        }
        return DONE_FREE;
      }
      if (c.state === 'toPerch') {
        const tgt = c.perchAt;
        _v.set(tgt.x - c.pos.x, tgt.y - c.pos.y, tgt.z - c.pos.z);
        const d = _v.length();
        if (d < 0.5) { c.pos.copy(tgt); c.state = 'perch'; c.t = rand(10, 25); return DONE_FREE; }
        const s = Math.min(d / dt, c.sp.speed * 1.5);
        c.pos.addScaledVector(_v.normalize(), s * dt);
        turnTo(c, tgt.x, tgt.z, dt, 5);
        c.moving = true;
        return DONE_FREE;
      }
      if (c.state !== 'fly') { if (calm(c)) { c.state = 'fly'; c.t = rand(6, 14); } else return null; }
      // circle the roost area
      c.t -= dt;
      c.circ = (c.circ || Math.random() * 6) + dt * 0.55;
      let tx = c.home.x + Math.cos(c.circ) * 9, tz = c.home.z + Math.sin(c.circ) * 9;
      if (c.scare > 0) { c.scare -= dt; tx = c.pos.x + (c.pos.x - ctx.player.x); tz = c.pos.z + (c.pos.z - ctx.player.z); }
      const gy = W.groundAt(c.pos.x, c.pos.z);
      c.pos.y += (gy + c.flyAlt - c.pos.y) * Math.min(1, dt * 1.5);
      if (c.t <= 0 && dist > 14) {
        // pick the tallest point nearby to land on
        let best = null;
        for (let i = 0; i < 10; i++) {
          const x = Math.floor(c.pos.x + rand(-14, 14)) + 0.5, z = Math.floor(c.pos.z + rand(-14, 14)) + 0.5;
          const h = W.groundAt(x, z);
          if (IS_LIQUID[W.getBlock(x, h, z)]) continue;
          if (!best || h > best.y - 1) best = new THREE.Vector3(x, h + 1, z);
        }
        if (best) { c.perchAt = best; c.state = 'toPerch'; }
        else c.t = 4;
      }
      return { tx, tz, speed: c.sp.speed * (c.scare > 0 ? 2 : 1), vert: false };
    },
  },

  // --- divers: wheel overhead, then stoop at you
  diver: {
    noReact: true,
    think(c, M, dt, ctx, dist) {
      const P = ctx.player, fx = ctx.fx, W = ctx.world;
      c.diveCd = (c.diveCd ?? rand(3, 6)) - dt;
      if (ctx.playerInShip || dist > 45) {
        if (c.state === 'dive' || c.state === 'circle') c.state = 'idle';
        return null;
      }
      if (c.state === 'dive') {
        _v.set(P.x - c.pos.x, P.y + 1.4 - c.pos.y, P.z - c.pos.z);
        const d = _v.length();
        c.pos.addScaledVector(_v.normalize(), 17 * dt);
        turnTo(c, P.x, P.z, dt, 8);
        c.tilt = 0.6;
        if (d < 1.3) { fx.hurt(7 + c.sp.size * 3, 'diver'); c.state = 'climb'; c.t = 1.6; }
        else if (W.isSolid(c.pos.x, c.pos.y - 0.5, c.pos.z) || c.t < -2.5) { c.state = 'climb'; c.t = 1.6; }
        c.t -= dt;
        return DONE_FREE;
      }
      if (c.state === 'climb') {
        c.t -= dt; c.pos.y += dt * 9; c.tilt = -0.4;
        c.pos.x += Math.sin(c.yaw) * dt * 8; c.pos.z += Math.cos(c.yaw) * dt * 8;
        if (c.t <= 0) { c.state = 'circle'; c.diveCd = rand(4, 7); }
        return DONE_FREE;
      }
      c.state = 'circle'; c.tilt = 0;
      c.circ = (c.circ || 0) + dt * 0.9;
      const tx = P.x + Math.cos(c.circ) * 8, tz = P.z + Math.sin(c.circ) * 8;
      const gy = W.groundAt(c.pos.x, c.pos.z);
      c.pos.y += (Math.max(gy + 6, P.y + 10) - c.pos.y) * Math.min(1, dt * 1.2);
      if (c.diveCd <= 0 && dist < 26) { c.state = 'dive'; c.t = 0; fx.sound('screech', c.pos); }
      return { tx, tz, speed: c.sp.speed * 1.6, vert: false };
    },
  },

  // --- drifters: ride the wind; at night they come down and shed healing pollen over you
  drifter: {
    think(c, M, dt, ctx, dist) {
      const P = ctx.player, fx = ctx.fx, W = ctx.world;
      if (!calm(c) && c.state !== 'drift' && c.state !== 'pollen') return null;
      const wind = M.wind;
      c.pollenCd = (c.pollenCd || 0) - dt;
      const gy = W.groundAt(c.pos.x, c.pos.z);
      if (ctx.night && dist < 26 && !ctx.playerInShip && c.pollenCd <= 0) {
        c.state = 'pollen';
        const ty = Math.max(gy + 2.5, P.y + 3.4);
        c.pos.y += (ty - c.pos.y) * Math.min(1, dt * 1.2);
        const d = flat(c.pos, P);
        if (d > 1) return { tx: P.x, tz: P.z, speed: c.sp.speed * 0.8, vert: false };
        c.under = (c.under || 0) + dt;
        if (Math.random() < dt * 14) fx.debris(_v.set(c.pos.x + rand(-0.6, 0.6), c.pos.y - 0.4, c.pos.z + rand(-0.6, 0.6)), [1, 0.9, 0.5], 1, 0.4, 1.4, true);
        if (c.under > 2.5) { c.under = 0; c.pollenCd = 35; fx.heal(14); fx.hint('pollen', 'The pollen closes your wounds.', '#fff2c0'); c.state = 'drift'; }
        return DONE_FREE;
      }
      c.state = 'drift'; c.under = 0;
      c.pos.x += wind.x * dt * 0.9; c.pos.z += wind.z * dt * 0.9;
      c.pos.y += (gy + 3 + c.sp.size * 0.6 + Math.sin(ctx.time * 0.8 + c.phase) * 0.8 - c.pos.y) * Math.min(1, dt * 1.2);
      c.yaw += dt * 0.15;
      if (dist > 70) { c.pos.x = P.x - wind.x * 30 + rand(-15, 15); c.pos.z = P.z - wind.z * 30 + rand(-15, 15); c.pos.y = W.groundAt(c.pos.x, c.pos.z) + 4; }
      return DONE_FREE;
    },
  },

  // --- skitterers: dash, freeze, dash
  skitter: {
    think(c, M, dt) {
      c.burst = (c.burst ?? 0) - dt;
      if (c.burst <= -rand(0.5, 1.8)) c.burst = rand(0.3, 0.8);
      c.speedMul = c.burst > 0 ? 2.6 : 0;
      return null;
    },
  },

  // --- ambushers: dead still until you're close, then they leap
  ambush: {
    think(c, M, dt, ctx, dist) {
      const P = ctx.player;
      if (c.leap > 0) {
        c.leap -= dt;
        c.hopY = Math.max(0, Math.sin((1 - c.leap / 0.6) * Math.PI) * 1.6);
        return { tx: P.x, tz: P.z, speed: 13 };
      }
      c.hopY = 0;
      if (c.state === 'chase' && !c.leapt && !c.provoked) {
        c.speedMul = 0; c.moving = false;
        turnTo(c, P.x, P.z, dt, 2);
        if (dist < 10) { c.leap = 0.6; c.leapt = true; ctx.fx.sound('hiss', c.pos); }
        return DONE;
      }
      c.speedMul = 1;
      if (dist > 30) c.leapt = false;
      return null;
    },
  },

  // ======================================================================================
  // Vermin

  // --- kodama walk single file toward forgotten things, and sit in a ring around them
  procession: {
    think(c, M, dt, ctx, dist) {
      if (dist < 7 && !ctx.playerInShip) return null;
      const line = M.list.filter((q) => q.sp === c.sp && !q.dead && !q.companion);
      if (line.length < 2) return null;
      const lead = line[0], idx = line.indexOf(c);
      const W = ctx.world;
      if (c === lead) {
        M.poiT = (M.poiT ?? 0) - dt;
        if (M.poiT <= 0) {
          M.poiT = 25;
          const f = W.scanBlocks(c.pos.x, c.pos.y, c.pos.z, 36, [B.CHEST, B.POD, B.MONOLITH, B.TERMINAL, B.EYE], 4);
          M.poi = f.length ? new THREE.Vector3(f[0].x + 0.5, f[0].y, f[0].z + 0.5) : null;
          if (!M.poi) M.walkTo = new THREE.Vector3(c.pos.x + rand(-30, 30), 0, c.pos.z + rand(-30, 30));
        }
        const goal = M.poi || M.walkTo;
        if (!goal) return null;
        if (flat(c.pos, goal) > 3) return { tx: goal.x, tz: goal.z, speed: c.sp.speed * 0.75 };
        if (!M.poi) { M.walkTo = new THREE.Vector3(c.pos.x + rand(-30, 30), 0, c.pos.z + rand(-30, 30)); return DONE; }
      }
      if (M.poi && flat(lead.pos, M.poi) <= 3.2) {
        // the ring
        const a = (idx / line.length) * TAU;
        const tx = M.poi.x + Math.cos(a) * 2.6, tz = M.poi.z + Math.sin(a) * 2.6;
        if (Math.hypot(c.pos.x - tx, c.pos.z - tz) > 0.5) return { tx, tz, speed: c.sp.speed * 0.8 };
        turnTo(c, M.poi.x, M.poi.z, dt, 3);
        if (Math.floor(ctx.time / 3) !== c.lastRing) { c.lastRing = Math.floor(ctx.time / 3); c.rattle = 0.6; }
        if (dist < 30) ctx.fx.hint('kodama-ring', 'The Kodama have gathered around something.', '#eef8ea');
        return DONE;
      }
      if (c === lead) return DONE;
      const ahead = line[idx - 1];
      if (dist < 30 && line.length >= 3) ctx.fx.hint('kodama-line', 'The Kodama walk single file. They are going somewhere.', '#eef8ea');
      if (flat(c.pos, ahead.pos) > 1.5) return { tx: ahead.pos.x, tz: ahead.pos.z, speed: c.sp.speed * (flat(c.pos, ahead.pos) > 4 ? 1.2 : 0.8) };
      turnTo(c, ahead.pos.x, ahead.pos.z, dt, 3);
      return DONE;
    },
  },

  // --- wildebeest herds: graze together; spook one and the whole herd stampedes
  herd: {
    think(c, M, dt, ctx, dist, dx, dz) {
      const fx = ctx.fx, P = ctx.player;
      if (c.state === 'stampede') {
        c.t -= dt;
        c.yaw += wrapA(c.dir - c.yaw) * Math.min(1, dt * 3);
        let ok = M._move(c, dt, ctx, c.pos.x + Math.sin(c.yaw) * 4, c.pos.z + Math.cos(c.yaw) * 4, 8.5, 0);
        if (!ok) { c.dir += (Math.random() < 0.5 ? 1 : -1) * 0.8; }
        c.moving = true;
        if (Math.random() < dt * 12) fx.debris(c.pos, [0.55, 0.47, 0.38], 2, 2, 0.8);
        c.tramCd = (c.tramCd || 0) - dt;
        if (dist < 1.3 + c.sp.size * 0.9 && !ctx.playerInShip && !ctx.riding && Math.abs(c.pos.y - P.y) < 2.5 && c.tramCd <= 0) {
          c.tramCd = 1.2;
          fx.hurt(12, 'stampede', Math.sin(c.yaw) * 9, 5, Math.cos(c.yaw) * 9);
        }
        if (c.t <= 0) { c.state = 'idle'; c.timer = rand(1, 3); }
        return DONE;
      }
      const spooked = c.hurt > 0 || (dist < 11 && fx.player.sprinting && !ctx.riding && !ctx.playerInShip);
      if (spooked && !c.companion) {
        const herd = [c, ...sameKind(M, c, 32)].filter((q) => !q.companion && !q.ridden);
        const cen = centroid(herd, c.pos);
        const dir = Math.atan2(cen.x - P.x, cen.z - P.z);
        for (const q of herd) { q.state = 'stampede'; q.t = rand(4.5, 6.5); q.dir = dir + rand(-0.25, 0.25); }
        fx.sound('rumble', c.pos);
        fx.hint('stampede', 'Stampede!', '#ffd9a8');
        return DONE;
      }
      return BEHAVE.grazer.think(c, M, dt, ctx);
    },
  },

  // --- gels hop in real arcs; hit one hard enough and it splits, two small ones touching merge
  gel: {
    think(c, M, dt, ctx) {
      c.hopV = (c.hopV || 0) - 20 * dt;
      c.hopY = Math.max(0, (c.hopY || 0) + c.hopV * dt);
      if (c.hopY === 0) {
        c.hopV = 0;
        if (c.moving && Math.random() < dt * 3) { c.hopV = rand(4, 6); ctx.fx.sound('boing', c.pos); }
      }
      c.speedMul = c.hopY > 0 ? 1.5 : 0.25;
      // merge with a small neighbour
      if ((c.gscale || 1) < 0.95 && calm(c) && !c.companion) {
        for (const q of M.list) {
          if (q === c || q.dead || q.sp !== c.sp || q.companion || (q.gscale || 1) >= 0.95) continue;
          const d = flat(q.pos, c.pos);
          if (d < 0.9) {
            const a = c.gscale || 1, b = q.gscale || 1;
            c.gscale = Math.min(1.2, Math.cbrt(a * a * a + b * b * b));
            c.health = Math.max(c.health, q.health) + 10;
            q.dead = true; q.vanished = true;
            ctx.fx.sound('squelch', c.pos);
            ctx.fx.debris(c.pos, c.sp.c1, 10, 2, 0.6);
            break;
          }
          if (d < 8) return { tx: q.pos.x, tz: q.pos.z, speed: c.sp.speed * 0.6 };
        }
      }
      return null;
    },
    // called by the manager when a gel dies
    split(c, M) {
      const s = c.gscale || 1;
      if (s < 0.72) return;
      for (const side of [-1, 1]) {
        const q = M.spawn(c.sp, c.pos.x + side * 0.6, c.pos.y + 0.2, c.pos.z);
        q.gscale = s * 0.64;
        q.health = Math.max(10, c.sp.health * 0.4);
        q.state = 'flee'; q.timer = 3; q.hopV = 6;
        q.yaw = c.yaw + side * 1.2;
      }
    },
  },

  // --- bubble bears sit and blow bubbles; pop enough of theirs and they get far too happy
  bubbles: {
    think(c, M, dt, ctx, dist) {
      const fx = ctx.fx;
      c.blowCd = (c.blowCd ?? rand(2, 6)) - dt;
      c.joy = Math.max(0, (c.joy || 0) - dt * 0.03);
      if (c.fed > 88 && !c.danced) { c.danced = true; c.state = 'dance'; c.t = 1.8; }
      if (c.fed <= 0) c.danced = false;
      if (c.state === 'dance') {
        c.t -= dt; c.yaw += dt * 9;
        if (Math.random() < dt * 8) M.blow(c, 1);
        if (c.t <= 0) { c.state = 'idle'; c.timer = 1; }
        return DONE;
      }
      if (c.state === 'blow') {
        c.t -= dt; c.sit = Math.min(1, (c.sit || 0) + dt * 3);
        if (dist < 30) turnTo(c, ctx.player.x, ctx.player.z, dt, 1.5);
        c.puff = (c.puff || 0) - dt;
        if (c.puff <= 0) { c.puff = rand(0.35, 0.6); M.blow(c, 1); }
        if (c.t <= 0) { c.state = 'idle'; c.timer = rand(1, 3); c.blowCd = rand(6, 12); }
        return DONE;
      }
      c.sit = Math.max(0, (c.sit || 0) - dt * 3);
      if (c.joy >= 6 && !c.companion) {
        // too happy
        for (let i = 0; i < 12; i++) M.blow(c, 1, true);
        fx.give('bubble_foam', 4);
        fx.sound('pop', c.pos); fx.sound('boing', c.pos);
        fx.debris(c.pos, c.sp.c1, 30, 5, 1.2, true);
        fx.hint('bearpop', 'It got too happy.', '#ffd0f0');
        c.dead = true; c.vanished = true;
        return DONE;
      }
      if (calm(c) && c.blowCd <= 0 && dist < 45) { c.state = 'blow'; c.t = rand(2, 3.5); c.puff = 0.3; return DONE; }
      return null;
    },
  },

  // --- mantas fly in schools behind a leader; sometimes one skims the ground; at night they sing
  school: {
    think(c, M, dt, ctx, dist) {
      if (c.companion) return null;
      const W = ctx.world, fx = ctx.fx, P = ctx.player;
      const school = M.list.filter((q) => q.sp === c.sp && !q.dead && !q.companion && !q.ridden);
      const lead = school[0], idx = school.indexOf(c);
      const gy = W.groundAt(c.pos.x, c.pos.z);
      if (c === lead) {
        if (!M.mantaHome || flat(M.mantaHome, P) > 60) M.mantaHome = new THREE.Vector3(P.x + rand(-20, 20), 0, P.z + rand(-20, 20));
        c.circ = (c.circ || Math.random() * 6) + dt * 0.12;
        const curious = dist < 26 && !ctx.playerInShip;
        const home = curious ? P : M.mantaHome;
        const R = curious ? 7 : 26;
        const tx = home.x + Math.cos(c.circ) * R, tz = home.z + Math.sin(c.circ) * R;
        c.breachCd = (c.breachCd ?? rand(15, 30)) - dt;
        if (c.breachCd <= 0 && !curious) { c.breach = 3.5; c.breachCd = rand(20, 40); }
        let ty = gy + (curious ? 3 : 9 + (c.flyAlt % 7)) + Math.sin(ctx.time * 0.6) * 1.2;
        if (c.breach > 0) {
          c.breach -= dt;
          ty = gy + 1.4 + (1 - Math.sin((c.breach / 3.5) * Math.PI)) * 7;
          if (IS_LIQUID[W.getBlock(c.pos.x, gy, c.pos.z)] && c.pos.y < gy + 3 && Math.random() < dt * 30) fx.debris(_v.set(c.pos.x, gy + 1, c.pos.z), [0.7, 0.85, 1], 3, 3, 0.8, true);
        }
        c.pos.y += (ty - c.pos.y) * Math.min(1, dt * 1.1);
        c.tilt = (ty - c.pos.y) * -0.04;
        c.bank = -0.25;
        return { tx, tz, speed: c.sp.speed, vert: false };
      }
      // formation slot behind and beside the leader
      const row = Math.ceil(idx / 2), side = idx % 2 ? 1 : -1;
      const back = -row * 4, lat = side * row * 3.2;
      const sy = Math.sin(lead.yaw), cy = Math.cos(lead.yaw);
      const tx = lead.pos.x + sy * back + cy * lat, tz = lead.pos.z + cy * back - sy * lat;
      c.pos.y += (lead.pos.y + row * 0.8 - c.pos.y) * Math.min(1, dt * 1.2);
      c.bank = lead.bank; c.tilt = lead.tilt;
      const d = Math.hypot(tx - c.pos.x, tz - c.pos.z);
      // night song
      if (ctx.night && idx === 1) {
        M.songCd = (M.songCd ?? 10) - dt;
        if (M.songCd <= 0 && dist < 50) { M.songCd = rand(25, 40); fx.sound('song', c.pos); for (const q of school) fx.debris(q.pos, q.sp.c3, 8, 1.2, 1.6, true); }
      }
      return { tx, tz, speed: Math.min(c.sp.speed * 1.6, 1 + d * 1.2), vert: false };
    },
  },

  // --- moths: by day they rest flat on walls; by night your lamp is theirs
  moth: {
    think(c, M, dt, ctx, dist) {
      if (ctx.night || c.hurt > 0 || c.state === 'flee') { c.resting = false; return null; }
      const W = ctx.world;
      if (c.resting) {
        c.moving = false;
        if (dist < 3.5 && !ctx.playerInShip) { c.resting = false; c.state = 'flee'; c.timer = 3; ctx.fx.sound('flutter', c.pos); return null; }
        return DONE_FREE;
      }
      c.restLook = (c.restLook || 0) - dt;
      if (c.restLook > 0) return null;
      c.restLook = 1.5;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let r = 1; r <= 5; r++) {
        const x = c.pos.x + ox * r, z = c.pos.z + oz * r;
        if (IS_SOLID[W.getBlock(x, c.pos.y, z)] && !IS_SOLID[W.getBlock(x - ox, c.pos.y, z - oz)]) {
          c.pos.set(Math.floor(x - ox) + 0.5 + ox * 0.42, c.pos.y, Math.floor(z - oz) + 0.5 + oz * 0.42);
          c.yaw = Math.atan2(ox, oz);
          c.resting = true;
          return DONE_FREE;
        }
      }
      return null;
    },
  },

  // --- snails: glowing trails that quicken your step; they hide in their shells
  snail: {
    think(c, M, dt, ctx, dist) {
      const fx = ctx.fx;
      if (c.shell > 0) {
        c.shell -= dt;
        c.tuck = Math.min(1, (c.tuck || 0) + dt * 4);
        c.moving = false;
        return DONE;
      }
      c.tuck = Math.max(0, (c.tuck || 0) - dt * 1.2);
      if (c.hurt > 0 || (dist < 3.2 && fx.player.sprinting && !ctx.playerInShip)) { c.shell = rand(4, 6); fx.sound('tuck', c.pos); return DONE; }
      if (!c.lastSlime) c.lastSlime = c.pos.clone();
      if (flat(c.pos, c.lastSlime) > 0.45) {
        c.lastSlime.copy(c.pos);
        M.fx.slimeAt(c.pos.x, Math.floor(c.pos.y), c.pos.z, c.sp.c3);
      }
      if (c.state === 'flee') { c.state = 'idle'; c.timer = 2; }
      return null;
    },
  },

  // ======================================================================================
  // Enemies

  // --- the sandmaw follows your footsteps under the ground and comes up through them
  sandmaw: {
    noReact: true,
    think(c, M, dt, ctx, dist) {
      const W = ctx.world, fx = ctx.fx, P = ctx.player, pl = fx.player;
      const ud = c.model.userData;
      c.t = (c.t ?? 0) - dt;
      const onFoot = !ctx.playerInShip && pl.onGround && !ctx.riding;
      switch (c.state) {
        case 'rise': {
          const s = c.strikeAt;
          fx.shake(0.35);
          if (Math.random() < dt * 40) fx.debris(_v.set(s.x + rand(-1.8, 1.8), s.y + 0.2, s.z + rand(-1.8, 1.8)), s.col, 2, 3.5, 0.7);
          if (c.t <= 0) {
            c.state = 'strike'; c.t = 0.4; c.hidden = false; c.bitten = false;
            c.pos.set(s.x, s.y, s.z); c.rise = 0;
            fx.sound('roar', c.pos);
          }
          return DONE_FREE;
        }
        case 'strike': {
          c.rise = Math.min(1, c.rise + dt / 0.35);
          c.jaw = c.rise;
          if (c.rise > 0.55 && !c.bitten) {
            c.bitten = true;
            fx.debris(_v.set(c.pos.x, c.pos.y + 0.5, c.pos.z), c.strikeAt.col, 40, 7, 1.3);
            fx.shake(1.1);
            if (!ctx.playerInShip && flat(P, c.pos) < 2.5 && Math.abs(P.y - c.pos.y) < 3.5) fx.hurt(28, 'sandmaw', (P.x - c.pos.x) * 3, 11, (P.z - c.pos.z) * 3);
          }
          if (c.t <= 0) { c.state = 'exposed'; c.t = 3; c.biteCd = 0.6; }
          return DONE_FREE;
        }
        case 'exposed': {
          c.rise = 1;
          c.jaw = 0.4 + Math.abs(Math.sin(ctx.time * 5)) * 0.6;
          turnTo(c, P.x, P.z, dt, 2);
          c.biteCd -= dt;
          if (c.biteCd <= 0 && flat(P, c.pos) < 3 && !ctx.playerInShip && Math.abs(P.y - c.pos.y - 2) < 3.5) { c.biteCd = 1; c.jaw = 0; fx.hurt(14, 'sandmaw'); fx.sound('chomp', c.pos); }
          if (c.t <= 0) { c.state = 'sink'; c.t = 1.1; fx.sound('rumble', c.pos); }
          return DONE_FREE;
        }
        case 'sink':
          c.rise = Math.max(0, c.t / 1.1);
          c.jaw = c.rise * 0.5;
          if (Math.random() < dt * 20) fx.debris(c.pos, c.strikeAt.col, 2, 3, 0.6);
          if (c.t <= 0) { c.state = 'rest'; c.t = rand(5, 9); c.hidden = true; }
          return DONE_FREE;
        case 'rest':
          if (c.t <= 0) c.state = 'hunt';
          return DONE_FREE;
        default: {
          c.state = 'hunt'; c.hidden = true; c.rise = 0;
          if (!onFoot || dist > 70) return DONE_FREE;
          // tunnel toward you just under the surface
          const sp = dist > 25 ? 11 : c.sp.speed;
          const a = Math.atan2(P.x - c.pos.x, P.z - c.pos.z);
          c.pos.x += Math.sin(a) * sp * dt; c.pos.z += Math.cos(a) * sp * dt;
          const gy = W.groundAt(c.pos.x, c.pos.z);
          c.pos.y = gy + 1;
          c.trail = (c.trail || 0) - dt;
          if (c.trail <= 0 && dist < 45) {
            c.trail = 0.12;
            const id = W.getBlock(c.pos.x, gy, c.pos.z);
            fx.debris(_v.set(c.pos.x, gy + 1.1, c.pos.z), id > 0 && fx.blockColor(id) || [0.5, 0.45, 0.4], 2, 2.2, 0.7);
          }
          c.rumbleCd = (c.rumbleCd || 0) - dt;
          if (dist < 32 && c.rumbleCd <= 0) { c.rumbleCd = 1.1; fx.sound('rumble', c.pos); fx.shake(Math.max(0, 0.3 - dist / 100)); }
          if (dist < 2.2) {
            const gy2 = W.groundBelow(P.x, P.y + 0.5, P.z);
            const id = W.getBlock(P.x, gy2, P.z);
            if (IS_LIQUID[id]) return DONE_FREE;
            c.strikeAt = { x: P.x, y: gy2 + 1, z: P.z, col: fx.blockColor(id) || [0.5, 0.45, 0.4] };
            c.state = 'rise'; c.t = 1.05;
            fx.sound('rumble', c.pos);
            fx.hint('sandmaw', 'The ground under you is moving. MOVE.', '#ffb89a');
          }
          return DONE_FREE;
        }
      }
    },
    anim(c, dt) {
      const ud = c.model.userData;
      c.model.visible = !c.hidden;
      const rise = c.rise || 0;
      ud.body.position.y = -6.8 + rise * 9.2;
      // rears up out of the ground and leans its mouth toward you
      ud.body.rotation.x = -0.55 * rise * (c.state === 'exposed' ? 1 : 0.6) + Math.sin(c.phase * 0.5) * 0.05 * rise;
      ud.body.rotation.z = Math.sin(c.phase * 0.4) * 0.07 * rise;
      const j = c.jaw || 0;
      for (const jaw of ud.jaws) jaw.rotation.z = 0.2 - j * 0.9;
      ud.segs.forEach((s, i) => { s.position.x = Math.sin(c.phase * 0.7 + i) * 0.12; });
      c.phase += dt * 3;
    },
  },

  // --- spitters swell and lob caustic globs where you will be
  spitter: {
    noReact: true,
    think(c, M, dt, ctx, dist) {
      const W = ctx.world, fx = ctx.fx, P = ctx.player;
      c.cd = (c.cd ?? rand(1, 3)) - dt;
      c.moving = false;
      if (c.closed > 0) { c.closed -= dt; c.swell = 0; return DONE; }
      if (dist > 32 || ctx.playerInShip) { c.state = 'idle'; c.swell = Math.max(0, (c.swell || 0) - dt); return DONE; }
      turnTo(c, P.x, P.z, dt, 3);
      const head = new THREE.Vector3(c.pos.x, c.pos.y + 1.4 * c.sp.size, c.pos.z);
      if (c.state === 'swell') {
        c.t -= dt; c.swell = Math.min(1, (c.swell || 0) + dt * 1.6);
        if (c.t <= 0) {
          const from = head.clone();
          const vel = fx.player.vel;
          const T = Math.min(1.5, Math.max(0.6, dist / 15));
          const tx = P.x + vel.x * T * 0.8, tz = P.z + vel.z * T * 0.8, ty = P.y + 0.9;
          const v = new THREE.Vector3((tx - from.x) / T, (ty - from.y) / T + 0.5 * 18 * T, (tz - from.z) / T);
          M.fx.glob(from, v, 11, c.sp.c3);
          fx.sound('spit', from);
          c.state = 'idle'; c.cd = rand(2, 3.2); c.swell = 0;
        }
        return DONE;
      }
      if (c.cd <= 0 && los(W, head, new THREE.Vector3(P.x, P.y + 1.5, P.z))) { c.state = 'swell'; c.t = 0.75; fx.sound('gurgle', c.pos); }
      return DONE;
    },
    anim(c, dt, time) {
      const ud = c.model.userData;
      const sw = c.swell || 0, cl = c.closed > 0 ? 1 : 0;
      const s = 1 + sw * 0.35 + Math.sin(time * 2 + c.phase) * 0.03;
      ud.pod.scale.set(s * (1 - cl * 0.3), s * (1 - cl * 0.4), s * (1 - cl * 0.3));
      ud.head.rotation.x = -0.35 - sw * 0.25 + cl * 0.6;
      ud.sac.scale.setScalar(0.8 + sw * 0.6 + Math.sin(time * 5) * 0.05);
      ud.body.rotation.z = Math.sin(time * 0.9 + c.phase) * 0.05;
    },
  },

  // --- mote swarms hunt light: put your lamp out and they lose you
  swarm: {
    noReact: true,
    think(c, M, dt, ctx, dist) {
      const W = ctx.world, fx = ctx.fx, P = ctx.player;
      if (!ctx.night) { c.fade = (c.fade || 0) + dt; if (c.fade > 3) { c.dead = true; c.vanished = true; } return DONE_FREE; }
      const lit = ctx.torch || ctx.playerInShip;
      const hunting = !ctx.playerInShip && ((lit && dist < 48) || dist < 7);
      let tx, ty, tz, sp;
      if (hunting) { tx = P.x; ty = P.y + 1.3; tz = P.z; sp = lit ? c.sp.speed : 2.2; }
      else {
        if (!c.target || c.timer <= 0) { c.target = new THREE.Vector3(c.pos.x + rand(-10, 10), 0, c.pos.z + rand(-10, 10)); c.timer = rand(3, 6); }
        tx = c.target.x; tz = c.target.z; ty = W.groundAt(tx, tz) + 2.5; sp = 1.5;
        c.lost = (c.lost || 0) + dt;
      }
      _v.set(tx - c.pos.x, ty - c.pos.y, tz - c.pos.z);
      const d = _v.length();
      if (d > 0.3) c.pos.addScaledVector(_v.normalize(), Math.min(d, sp * dt));
      const gy = W.groundAt(c.pos.x, c.pos.z);
      if (c.pos.y < gy + 1.2) c.pos.y = gy + 1.2;
      c.biteCd = (c.biteCd || 0) - dt;
      const d3 = Math.hypot(P.x - c.pos.x, P.y + 1.2 - c.pos.y, P.z - c.pos.z);
      if (d3 < 1.9 && !ctx.playerInShip && c.biteCd <= 0) { c.biteCd = 0.35; fx.hurt(2, 'swarm'); }
      c.buzzCd = (c.buzzCd || 0) - dt;
      if (d3 < 14 && c.buzzCd <= 0) { c.buzzCd = 0.22; fx.sound('buzz', c.pos); }
      if (hunting && lit && dist < 30) fx.hint('swarm', 'They are drawn to your lamp. [T]', '#fff0a0');
      c.moving = true;
      return DONE_FREE;
    },
    anim(c, dt, time) {
      const ud = c.model.userData;
      const m = new THREE.Matrix4();
      const k = Math.min(1, 1 - (c.fade || 0) / 3);
      let i = 0;
      for (const s of ud.seeds) {
        if (!s.alive) { m.makeScale(0, 0, 0); ud.motes.setMatrixAt(i++, m); continue; }
        const a = s.a + time * s.w, b = s.b + time * s.w * 0.7;
        const r = s.r * (1 + Math.sin(time * 1.3 + s.a) * 0.25);
        m.makeScale(k, k, k);
        m.setPosition(Math.cos(a) * Math.cos(b) * r, Math.sin(b) * r * 0.7, Math.sin(a) * Math.cos(b) * r);
        ud.motes.setMatrixAt(i++, m);
      }
      ud.motes.instanceMatrix.needsUpdate = true;
      c.model.position.copy(c.pos);
    },
    damage(c, amount) {
      const ud = c.model.userData;
      c.dmgAcc = (c.dmgAcc || 0) + amount;
      let kill = Math.floor(c.dmgAcc / 4);
      c.dmgAcc -= kill * 4;
      for (const s of ud.seeds) { if (kill <= 0) break; if (s.alive) { s.alive = false; kill--; ud.alive--; } }
      c.health = ud.alive;
      return ud.alive <= 0;
    },
  },

  // --- carapaces: armoured in front; stun one against a wall and go for the back
  brute: {
    noReact: true,
    animAfter(c, dt, time) { BEHAVE.brute.anim2(c, dt, time); },
    think(c, M, dt, ctx, dist) {
      const r = BEHAVE.charger.think(c, M, dt, ctx, dist);
      if (c.state === 'charge') c.stunT = 0;
      if (c.state === 'stunned' && !c.announced) { c.announced = true; ctx.fx.hint('brute-back', 'It is stunned. Its back is exposed.', '#ffcf9a'); }
      if (c.state !== 'stunned') c.announced = false;
      if (r) return r;
      if (dist < 26 && !ctx.playerInShip) return { tx: ctx.player.x, tz: ctx.player.z, speed: c.sp.speed * 0.8 };
      return null;
    },
    anim2(c, dt, time) {
      const ud = c.model.userData;
      const st = c.state === 'stunned';
      ud.sac.scale.setScalar(st ? 1.3 + Math.sin(time * 12) * 0.25 : 0.85 + Math.sin(time * 2) * 0.05);
      if (c.state === 'windup') ud.body.position.y = ud.baseY + Math.abs(Math.sin(c.paw || 0)) * 0.1;
      ud.head.rotation.z = st ? Math.sin(time * 9) * 0.25 : 0;
    },
    // armour: bolts glance off the front unless it's stunned
    armor(c, from) {
      if (c.state === 'stunned') return 2;
      const a = Math.atan2(from.x - c.pos.x, from.z - c.pos.z);
      return Math.abs(wrapA(a - c.yaw)) < 1.2 ? 0.12 : 1.6;
    },
  },

  // --- lurkers sit among the rocks, flecked with ore. They are not rocks.
  lurker: {
    noReact: true,
    think(c, M, dt, ctx, dist) {
      const fx = ctx.fx, P = ctx.player;
      c.t = (c.t ?? 0) - dt;
      switch (c.state) {
        case 'wake':
          c.open = Math.min(1, (c.open || 0) + dt * 3);
          c.unfold = Math.min(1, (c.unfold || 0) + dt * 2.5);
          if (c.t <= 0) { c.state = 'hunt'; c.t = 14; }
          return DONE;
        case 'hunt': {
          c.unfold = 1;
          c.open = 0.3 + Math.abs(Math.sin(ctx.time * 6)) * 0.7;
          c.biteCd = (c.biteCd || 0) - dt;
          if (dist < 1.6 + c.radius && !ctx.playerInShip && c.biteCd <= 0 && Math.abs(c.pos.y - P.y) < 2) { c.biteCd = 1; fx.hurt(13, 'lurker'); fx.sound('chomp', c.pos); c.t = 14; }
          if (dist > 26 || ctx.playerInShip || c.t <= 0) { c.state = 'settle'; c.t = 1.2; }
          return { tx: P.x, tz: P.z, speed: c.sp.speed };
        }
        case 'settle':
          c.open = Math.max(0, (c.open || 0) - dt * 2);
          c.unfold = Math.max(0, (c.unfold || 0) - dt * 1.2);
          if (c.t <= 0) c.state = 'disguise';
          return DONE;
        default:
          c.state = 'disguise'; c.open = 0; c.unfold = 0; c.moving = false;
          if ((dist < 2.8 && !ctx.playerInShip) || c.hurt > 0) {
            c.state = 'wake'; c.t = 0.55;
            fx.sound('shriek', c.pos);
            fx.shake(0.4);
            fx.hint('lurker', 'That was not a rock.', '#ffd0a0');
          }
          return DONE;
      }
    },
    anim(c, dt, time) {
      const ud = c.model.userData;
      const o = c.open || 0, u = c.unfold || 0;
      ud.hinge.rotation.x = -o * 0.75;
      ud.body.position.y = ud.baseY + u * 0.55 + (c.moving ? Math.abs(Math.sin(c.phase * 1.5)) * 0.08 : 0);
      for (const e of ud.eyes) e.visible = o > 0.1;
      for (const leg of ud.legs) {
        leg.rotation.z = leg.userData.side * (1.35 - u * 1.0);
        leg.rotation.x = c.moving ? Math.sin(c.phase * 1.5 + leg.userData.phase) * 0.6 * u : 0;
      }
      c.phase += dt * (c.moving ? 12 : 1);
    },
  },
};
