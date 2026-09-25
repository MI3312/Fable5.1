// Procedural fauna: species generation per planet, voxel-toy models, simple AI.
import * as THREE from 'three';
import { RNG, hash32, hsl } from '../core/rng.js';
import { creatureName, latinName } from '../core/names.js';
import { applyCurvature } from '../core/shaderlib.js';
import { IS_LIQUID, IS_SOLID } from '../world/blocks.js';

const PLANS = [['quad', 5], ['biped', 3], ['hopper', 2], ['flyer', 2], ['floater', 2], ['crawler', 2]];
const TEMPERS = [['Passive', 4], ['Skittish', 3], ['Curious', 2], ['Aggressive', 1.4]];
const DIETS = ['Grazing', 'Absorbic', 'Lithovore', 'Photosynthetic', 'Oneirovore', 'Carnivore', 'Omnivore', 'Dream-eater'];
const NOTES = ['Hums at night', 'Dreams in colour', 'Afraid of corners', 'Sleeps standing up', 'Remembers faces', 'Leaves pastel footprints', 'Mimics footsteps', 'Stares at the sun', 'Hoards shiny things', 'Sings in minor keys', 'Walks in perfect circles', 'Only seen at dusk'];

export function generateSpecies(planet, index, forcePlan) {
  const seed = hash32(planet.seed, index, 7331);
  const rng = new RNG(seed);
  let plan = forcePlan || rng.weighted(PLANS);
  if (planet.biome === 'liminal' && rng.chance(0.3)) plan = 'floater';
  const baseHue = rng.next();
  const pal = planet.biome === 'liminal' ? [0.78, 0.86] : [0.6, 0.75];
  const sp = {
    id: `${planet.id}#${index}`,
    index,
    seed,
    plan,
    name: creatureName(seed),
    latin: latinName(seed),
    size: plan === 'crawler' ? rng.range(0.4, 0.9) : rng.chance(0.08) ? rng.range(2.5, 4.2) : rng.range(0.6, 1.8),
    c1: hsl(baseHue, rng.range(0.35, 0.8), rng.range(pal[0] - 0.2, pal[1] - 0.1)),
    c2: hsl(baseHue + rng.range(0.1, 0.5), rng.range(0.4, 0.9), rng.range(0.4, 0.75)),
    c3: hsl(rng.next(), 0.9, 0.6),
    temper: rng.weighted(TEMPERS),
    diet: rng.pick(DIETS),
    note: rng.pick(NOTES),
    horns: rng.chance(0.4),
    tail: rng.chance(0.6),
    crest: rng.chance(0.3),
    bigEye: rng.chance(0.35),
    longNeck: plan === 'quad' && rng.chance(0.3),
    legLen: rng.range(0.6, 1.3),
    bodyLen: rng.range(0.9, 1.8),
    speed: rng.range(2.2, 4.8),
    rarity: rng.weighted([['Common', 5], ['Uncommon', 3], ['Rare', 1]]),
    produce: rng.pick(['carbon', 'oxygen', 'sodium', 'dihydrogen', 'ferrite', 'chroma_shard', 'mordite']),
  };
  if (plan === 'flyer') sp.size = Math.min(sp.size, 1.4);
  if (plan === 'manikin') {
    Object.assign(sp, {
      name: rng.pick(['Manikin', 'Pale Manikin', 'Hollow Manikin', 'Display Manikin']), size: rng.range(1.0, 1.15), temper: 'Watching', diet: 'Unknown',
      note: 'Only moves when unobserved', speed: 6.8, rarity: 'Uncommon', c1: [0.93, 0.89, 0.84], c2: [0.8, 0.76, 0.72], c3: [0.3, 0.28, 0.3], produce: 'memory_fragment',
      horns: false, tail: false, crest: false, bigEye: false,
    });
  }
  if (plan === 'spider') {
    Object.assign(sp, {
      name: 'Colossal ' + rng.pick(['Weaver', 'Spinner', 'Longlegs', 'Loomer']), size: rng.range(2.2, 3.4), temper: 'Aggressive', diet: 'Carnivore',
      note: 'Its legs are longer than they should be', speed: 4.8, rarity: 'Rare', c1: hsl(rng.next(), 0.25, 0.22), c2: hsl(rng.next(), 0.3, 0.14), c3: [1, 0.2, 0.25], produce: 'mordite',
    });
  }
  sp.health = Math.round(30 + sp.size * 40);
  sp.height = plan === 'flyer' ? 0 : plan === 'floater' ? 0 : 1;
  return sp;
}

export function speciesForPlanet(planet) {
  const P = planet.params;
  if (P.fauna <= 0) return [];
  const rng = new RNG(hash32(planet.seed, 55));
  const n = rng.int(3, 6);
  const out = [];
  for (let i = 0; i < n; i++) out.push(generateSpecies(planet, i));
  if (planet.biome === 'liminal' || (planet.biome === 'exotic' && rng.chance(0.4))) out.push(generateSpecies(planet, 50, 'manikin'));
  if (['exotic', 'toxic', 'liminal', 'radioactive'].includes(planet.biome) && rng.chance(0.55)) out.push(generateSpecies(planet, 51, 'spider'));
  return out;
}

const matCache = new Map();
function lam(rgb, emissive = 0) {
  const key = rgb.join(',') + ':' + emissive;
  if (matCache.has(key)) return matCache.get(key);
  const c = new THREE.Color(rgb[0], rgb[1], rgb[2]);
  const m = applyCurvature(new THREE.MeshLambertMaterial({ color: c, flatShading: true, emissive: emissive ? c : 0x000000, emissiveIntensity: emissive }));
  matCache.set(key, m);
  return m;
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
function part(parent, mat, w, h, d, x, y, z) {
  const m = new THREE.Mesh(BOX, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function buildCreatureModel(sp) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const m1 = lam(sp.c1), m2 = lam(sp.c2), m3 = lam(sp.c3, 0.4);
  const white = lam([0.95, 0.95, 0.95]), black = lam([0.05, 0.05, 0.08]);
  const legs = [];
  const wings = [];
  const s = 1;
  const L = sp.bodyLen;
  const legH = sp.legLen * 0.7;
  const addEyes = (head, hw, hh, hd) => {
    const er = sp.bigEye ? 0.34 : 0.2;
    for (const side of [-1, 1]) {
      part(head, white, er, er, 0.06, side * hw * 0.28, hh * 0.15, -hd / 2 - 0.02);
      part(head, black, er * 0.5, er * 0.5, 0.07, side * hw * 0.28, hh * 0.15, -hd / 2 - 0.05);
    }
  };
  switch (sp.plan) {
    case 'quad': case 'crawler': {
      const nLegs = sp.plan === 'crawler' ? 6 : 4;
      const bh = sp.plan === 'crawler' ? 0.45 : 0.7;
      const lh = sp.plan === 'crawler' ? 0.35 : legH;
      body.position.y = lh + bh / 2;
      part(body, m1, 0.9, bh, L, 0, 0, 0);
      part(body, m2, 0.92, bh * 0.3, L * 0.6, 0, bh * 0.4, 0);
      const neck = new THREE.Group();
      neck.position.set(0, bh * 0.2, -L / 2);
      body.add(neck);
      let hy = 0.15, hz = -0.3;
      if (sp.longNeck) { part(neck, m1, 0.3, 1.1, 0.3, 0, 0.5, -0.1); hy = 1.1; hz = -0.2; }
      const head = new THREE.Group();
      head.position.set(0, hy, hz);
      neck.add(head);
      part(head, m1, 0.6, 0.5, 0.6, 0, 0, 0);
      part(head, m2, 0.4, 0.2, 0.3, 0, -0.15, -0.35);
      addEyes(head, 0.6, 0.5, 0.6);
      if (sp.horns) { part(head, m3, 0.1, 0.4, 0.1, -0.2, 0.4, 0.05); part(head, m3, 0.1, 0.4, 0.1, 0.2, 0.4, 0.05); }
      if (sp.crest) part(body, m3, 0.1, 0.35, L * 0.8, 0, bh * 0.6, 0);
      if (sp.tail) { const t = part(body, m2, 0.18, 0.18, 0.9, 0, 0.1, L / 2 + 0.4); t.rotation.x = 0.4; }
      for (let i = 0; i < nLegs; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const row = Math.floor(i / 2);
        const rows = nLegs / 2;
        const z = -L / 2 + 0.2 + (L - 0.4) * (rows === 1 ? 0.5 : row / (rows - 1));
        const leg = new THREE.Group();
        leg.position.set(side * 0.38, -bh / 2, z);
        body.add(leg);
        part(leg, m2, 0.2, lh, 0.2, 0, -lh / 2, 0);
        part(leg, black, 0.24, 0.1, 0.26, 0, -lh, -0.02);
        leg.userData.phase = (row % 2 === 0 ? 0 : Math.PI) + (side > 0 ? Math.PI : 0);
        legs.push(leg);
      }
      break;
    }
    case 'biped': {
      const lh = legH * 1.1;
      body.position.y = lh + 0.5;
      part(body, m1, 0.8, 1.0, 0.6, 0, 0, 0);
      part(body, m2, 0.82, 0.3, 0.62, 0, -0.3, 0);
      const head = new THREE.Group();
      head.position.set(0, 0.8, -0.1);
      body.add(head);
      part(head, m1, 0.65, 0.55, 0.6, 0, 0, 0);
      addEyes(head, 0.65, 0.55, 0.6);
      if (sp.horns) part(head, m3, 0.12, 0.5, 0.12, 0, 0.45, 0);
      if (sp.crest) part(head, m3, 0.1, 0.3, 0.5, 0, 0.35, 0.1);
      for (const side of [-1, 1]) {
        const arm = part(body, m2, 0.15, 0.6, 0.15, side * 0.5, -0.05, 0);
        arm.rotation.z = side * 0.2;
        const leg = new THREE.Group();
        leg.position.set(side * 0.22, -0.5, 0);
        body.add(leg);
        part(leg, m2, 0.24, lh, 0.24, 0, -lh / 2, 0);
        part(leg, black, 0.3, 0.1, 0.4, 0, -lh, -0.05);
        leg.userData.phase = side > 0 ? Math.PI : 0;
        legs.push(leg);
      }
      if (sp.tail) { const t = part(body, m2, 0.15, 0.15, 0.8, 0, -0.3, 0.6); t.rotation.x = 0.6; }
      break;
    }
    case 'hopper': {
      body.position.y = 0.5;
      part(body, m1, 0.9, 0.8, 0.9, 0, 0, 0);
      part(body, m2, 0.6, 0.3, 0.3, 0, 0.1, -0.5);
      const head = new THREE.Group();
      head.position.set(0, 0.2, -0.1);
      body.add(head);
      addEyes(head, 0.9, 0.8, 0.9);
      part(body, m3, 0.12, 0.6, 0.12, -0.25, 0.65, 0);
      part(body, m3, 0.12, 0.6, 0.12, 0.25, 0.65, 0);
      break;
    }
    case 'flyer': {
      body.position.y = 0;
      part(body, m1, 0.5, 0.4, 1.2, 0, 0, 0);
      const head = new THREE.Group();
      head.position.set(0, 0.05, -0.75);
      body.add(head);
      part(head, m1, 0.4, 0.35, 0.35, 0, 0, 0);
      part(head, m3, 0.12, 0.12, 0.35, 0, -0.05, -0.3);
      addEyes(head, 0.4, 0.35, 0.35);
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.position.set(side * 0.25, 0.1, 0);
        body.add(wing);
        part(wing, m2, 1.4, 0.06, 0.7, side * 0.7, 0, 0);
        part(wing, m3, 0.5, 0.07, 0.4, side * 1.3, 0, 0.1);
        wing.userData.side = side;
        wings.push(wing);
      }
      part(body, m2, 0.6, 0.05, 0.5, 0, 0, 0.75);
      break;
    }
    case 'manikin': {
      const lh = 0.95;
      body.position.y = lh + 0.45;
      const joint = lam([0.55, 0.52, 0.5]);
      part(body, m1, 0.55, 0.9, 0.3, 0, 0, 0);
      part(body, m2, 0.5, 0.12, 0.28, 0, -0.35, 0);
      part(body, joint, 0.14, 0.14, 0.14, 0, 0.52, 0);
      const head = new THREE.Group();
      head.position.set(0, 0.85, 0);
      body.add(head);
      part(head, m1, 0.36, 0.46, 0.38, 0, 0, 0);
      part(head, m2, 0.3, 0.02, 0.02, 0, -0.02, -0.2);
      for (const side of [-1, 1]) {
        const arm = new THREE.Group();
        arm.position.set(side * 0.36, 0.38, 0);
        body.add(arm);
        part(arm, joint, 0.12, 0.12, 0.12, 0, 0, 0);
        part(arm, m1, 0.12, 0.8, 0.12, 0, -0.45, 0);
        arm.userData.phase = side > 0 ? 0 : Math.PI;
        arm.userData.arm = true;
        legs.push(arm);
        const leg = new THREE.Group();
        leg.position.set(side * 0.15, -0.45, 0);
        body.add(leg);
        part(leg, m1, 0.16, lh, 0.16, 0, -lh / 2, 0);
        part(leg, joint, 0.13, 0.13, 0.13, 0, -lh * 0.5, 0);
        leg.userData.phase = side > 0 ? Math.PI : 0;
        legs.push(leg);
      }
      break;
    }
    case 'spider': {
      body.position.y = 1.1;
      part(body, m1, 1.3, 0.9, 1.6, 0, 0.1, 0.9);
      part(body, m2, 0.9, 0.6, 0.9, 0, 0, -0.35);
      const head = new THREE.Group();
      head.position.set(0, 0.05, -0.85);
      body.add(head);
      const eyeMat = lam(sp.c3, 0.9);
      for (let i = 0; i < 6; i++) part(head, eyeMat, 0.1, 0.1, 0.05, (i % 3 - 1) * 0.18, (i < 3 ? 0.1 : -0.05), -0.05);
      for (let i = 0; i < 8; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const row = Math.floor(i / 2);
        const leg = new THREE.Group();
        leg.position.set(side * 0.4, 0.05, -0.55 + row * 0.35);
        leg.rotation.y = side * (0.2 - row * 0.25);
        body.add(leg);
        const upper = part(leg, m2, 1.2, 0.12, 0.12, side * 0.55, 0.35, 0);
        upper.rotation.z = side * 0.6;
        const lower = part(leg, m2, 0.1, 1.5, 0.1, side * 1.1, -0.25, 0);
        lower.rotation.z = -side * 0.15;
        leg.userData.phase = (row % 2 === 0 ? 0 : Math.PI) + (side > 0 ? Math.PI : 0);
        leg.userData.spider = true;
        legs.push(leg);
      }
      break;
    }
    case 'floater': {
      body.position.y = 0;
      const eyeball = sp.bigEye;
      part(body, eyeball ? white : m1, 1.0, 1.0, 1.0, 0, 0, 0);
      if (eyeball) {
        part(body, lam(sp.c1), 0.6, 0.6, 0.06, 0, 0, -0.52);
        part(body, black, 0.28, 0.28, 0.07, 0, 0, -0.55);
      } else {
        part(body, m2, 1.1, 0.3, 1.1, 0, -0.35, 0);
        addEyes(body, 1.0, 1.0, 1.0);
      }
      for (let i = 0; i < 4; i++) {
        const t = new THREE.Group();
        t.position.set((i % 2 ? 1 : -1) * 0.3, -0.5, (i < 2 ? 1 : -1) * 0.3);
        body.add(t);
        part(t, m3, 0.1, 0.9, 0.1, 0, -0.45, 0);
        t.userData.phase = i * 1.3;
        legs.push(t);
      }
      break;
    }
  }
  root.scale.setScalar(sp.size);
  root.userData = { body, legs, wings, baseY: body.position.y };
  return root;
}

export class CreatureManager {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.list = [];
    this.species = [];
    this.planet = null;
    this.spawnTimer = 0;
  }

  setPlanet(planet) {
    this.clear();
    this.planet = planet;
    this.species = speciesForPlanet(planet);
  }

  clear() {
    for (const c of this.list) this.group.remove(c.model);
    this.list = [];
  }

  spawn(sp, x, y, z) {
    const model = buildCreatureModel(sp);
    const c = {
      sp, model,
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      state: 'idle', timer: Math.random() * 3,
      target: null, phase: Math.random() * 10,
      health: sp.health, hurt: 0, attackCd: 0,
      fed: 0, flyAlt: 10 + Math.random() * 14, hop: 0,
      radius: 0.6 * sp.size,
    };
    model.position.copy(c.pos);
    this.group.add(model);
    this.list.push(c);
    return c;
  }

  update(dt, ctx) {
    // ctx: { world, player (pos), fauna, time, onAttack(dmg), sea, liquid }
    const P = ctx.player;
    // spawn
    this.spawnTimer -= dt;
    const maxCount = Math.round(4 + ctx.fauna * 12);
    if (this.spawnTimer <= 0 && this.species.length && this.list.length < maxCount) {
      this.spawnTimer = 0.6;
      const a = Math.random() * Math.PI * 2;
      const r = 28 + Math.random() * 45;
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      if (ctx.world.isLoaded(x, z)) {
        const gy = ctx.world.groundAt(x, z);
        const top = ctx.world.getBlock(x, gy, z);
        if (gy > 2 && !IS_LIQUID[top]) {
          const rng = Math.random();
          let sp = this.species[Math.floor(rng * this.species.length)];
          if (sp.rarity === 'Rare' && Math.random() < 0.6) sp = this.species[0];
          if (sp.plan === 'manikin' && (this.list.filter((q) => q.sp.plan === 'manikin').length >= 2 || Math.random() > (ctx.night ? 0.8 : 0.35))) sp = this.species[0];
          if (sp.plan === 'spider' && this.list.some((q) => q.sp.plan === 'spider')) sp = this.species[0];
          const y = sp.plan === 'flyer' ? gy + 12 : gy + 1;
          const n = sp.plan === 'flyer' || sp.plan === 'manikin' || sp.plan === 'spider' ? 1 : 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n && this.list.length < maxCount; i++) {
            this.spawn(sp, x + (Math.random() - 0.5) * 4, y, z + (Math.random() - 0.5) * 4);
          }
        }
      }
    }
    const keep = [];
    for (const c of this.list) {
      const dx = c.pos.x - P.x, dz = c.pos.z - P.z;
      const dist = Math.hypot(dx, dz);
      if (c.companion && dist > 60 && !c.dead) {
        const gy = ctx.world.groundAt(P.x + 3, P.z + 3);
        c.pos.set(P.x + 3, gy + 1, P.z + 3);
      } else if (dist > 120 || c.dead) { this.group.remove(c.model); continue; }
      keep.push(c);
      this._think(c, dt, ctx, dist, dx, dz);
      this._animate(c, dt, ctx.time);
    }
    this.list = keep;
  }

  _think(c, dt, ctx, dist, dx, dz) {
    const sp = c.sp;
    const world = ctx.world;
    c.timer -= dt;
    c.attackCd -= dt;
    c.hurt = Math.max(0, c.hurt - dt);
    if (c.fed > 0) c.fed -= dt;
    const temper = sp.temper;
    if (c.companion) {
      c.state = dist > 5 && !ctx.playerInShip ? 'follow' : 'idle';
      c.timer = 1;
    } else if (sp.plan === 'manikin') {
      const tx0 = c.pos.x - ctx.camPos.x, ty0 = c.pos.y + 1.2 - ctx.camPos.y, tz0 = c.pos.z - ctx.camPos.z;
      const d3 = Math.hypot(tx0, ty0, tz0) || 1;
      const looked = d3 < 90 && (tx0 * ctx.camDir.x + ty0 * ctx.camDir.y + tz0 * ctx.camDir.z) / d3 > 0.7;
      c.frozen = looked;
      if (looked || ctx.playerInShip || dist > 70) c.state = 'frozen';
      else {
        c.state = 'chase';
        c.creepCd = (c.creepCd || 0) - dt;
        if (dist < 14 && c.creepCd <= 0 && ctx.onCreep) { c.creepCd = 6; ctx.onCreep(c); }
      }
    }
    // reactions
    if (c.state !== 'dying' && !c.companion && sp.plan !== 'manikin') {
      if (c.provoked || (temper === 'Aggressive' && dist < 14 && !ctx.playerInShip)) {
        if (c.fed <= 0) c.state = 'chase';
      } else if (temper === 'Skittish' && dist < 9 && c.state !== 'flee') {
        c.state = 'flee'; c.timer = 3;
      } else if (temper === 'Curious' && dist < 20 && dist > 4 && c.state === 'idle' && Math.random() < dt * 0.3) {
        c.state = 'follow'; c.timer = 6;
      }
    }
    let speed = 0;
    let tx = c.pos.x, tz = c.pos.z;
    switch (c.state) {
      case 'idle':
        if (c.timer <= 0) {
          c.state = 'wander';
          const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 14;
          c.target = new THREE.Vector3(c.pos.x + Math.cos(a) * r, 0, c.pos.z + Math.sin(a) * r);
          c.timer = 8;
        }
        break;
      case 'wander':
        if (!c.target || c.timer <= 0) { c.state = 'idle'; c.timer = 1 + Math.random() * 4; break; }
        tx = c.target.x; tz = c.target.z;
        speed = sp.speed * 0.45;
        if (Math.hypot(tx - c.pos.x, tz - c.pos.z) < 1) { c.state = 'idle'; c.timer = 1 + Math.random() * 4; }
        break;
      case 'flee':
        tx = c.pos.x + dx; tz = c.pos.z + dz;
        speed = sp.speed * 1.4;
        if (c.timer <= 0 && dist > 14) { c.state = 'idle'; c.timer = 2; }
        break;
      case 'follow':
        tx = ctx.player.x; tz = ctx.player.z;
        speed = dist > 4 ? sp.speed * (c.companion && dist > 14 ? 1.4 : 0.7) : 0;
        if (c.timer <= 0) { c.state = 'idle'; c.timer = 3; }
        break;
      case 'frozen':
        speed = 0;
        break;
      case 'chase':
        tx = ctx.player.x; tz = ctx.player.z;
        speed = sp.speed * (sp.plan === 'manikin' ? 1 : 1.25);
        if (dist < 1.2 + c.radius && c.attackCd <= 0 && Math.abs(c.pos.y - ctx.player.y) < 3) {
          c.attackCd = 1.2;
          ctx.onAttack(6 + sp.size * 5, c);
        }
        if (dist > 30 && sp.plan !== 'manikin') { c.state = 'idle'; c.provoked = false; }
        break;
    }
    // move
    if (speed > 0) {
      const ang = Math.atan2(tx - c.pos.x, tz - c.pos.z);
      let dy = ang - c.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      c.yaw += dy * Math.min(1, dt * 5);
      const nx = c.pos.x + Math.sin(c.yaw) * speed * dt;
      const nz = c.pos.z + Math.cos(c.yaw) * speed * dt;
      if (sp.plan === 'flyer' || sp.plan === 'floater') {
        c.pos.x = nx; c.pos.z = nz;
      } else {
        const gy = world.groundBelow(nx, c.pos.y + 1.4, nz);
        const top = world.getBlock(nx, gy, nz);
        const head = world.getBlock(nx, gy + 1 + Math.min(2, Math.ceil(sp.size * 1.2)), nz);
        if (gy + 1 - c.pos.y <= 1.2 && !IS_LIQUID[top] && gy > 0 && !(head > 0 && IS_SOLID[head] && sp.plan !== 'crawler')) {
          c.pos.x = nx; c.pos.z = nz;
        } else if (c.state === 'wander') { c.state = 'idle'; c.timer = 1; }
      }
      c.moving = true;
    } else c.moving = false;
    // vertical
    const gy = (sp.plan === 'flyer' || sp.plan === 'floater') ? world.groundAt(c.pos.x, c.pos.z) : world.groundBelow(c.pos.x, c.pos.y + 1.4, c.pos.z);
    if (sp.plan === 'flyer') {
      const ty = gy + c.flyAlt + Math.sin(ctx.time * 0.5 + c.phase) * 2;
      c.pos.y += (ty - c.pos.y) * Math.min(1, dt * 1.5);
      if (c.state === 'chase') c.pos.y += (ctx.player.y + 1.5 - c.pos.y) * Math.min(1, dt * 2);
    } else if (sp.plan === 'floater') {
      const ty = gy + 2.2 + sp.size * 0.5 + Math.sin(ctx.time * 1.2 + c.phase) * 0.5;
      c.pos.y += (ty - c.pos.y) * Math.min(1, dt * 2);
    } else {
      const ty = gy + 1;
      if (c.pos.y > ty + 0.05) c.pos.y = Math.max(ty, c.pos.y - dt * 12);
      else c.pos.y += (ty - c.pos.y) * Math.min(1, dt * 12);
    }
  }

  _animate(c, dt, time) {
    const m = c.model;
    const ud = m.userData;
    if (c.frozen && !c.moving) { m.position.copy(c.pos); return; }
    c.phase += dt * (c.moving ? c.sp.speed * 2.2 : 1);
    m.position.copy(c.pos);
    m.rotation.y = c.yaw + Math.PI; // models face -Z
    const swing = c.moving ? 0.7 : 0.05;
    for (const leg of ud.legs) {
      if (c.sp.plan === 'floater') {
        leg.rotation.x = Math.sin(time * 2 + leg.userData.phase) * 0.3;
        leg.rotation.z = Math.cos(time * 1.7 + leg.userData.phase) * 0.3;
      } else if (leg.userData.spider) {
        leg.rotation.x = Math.sin(c.phase * 1.3 + leg.userData.phase) * swing * 0.35;
      } else {
        leg.rotation.x = Math.sin(c.phase + leg.userData.phase) * swing * (leg.userData.arm ? 0.6 : 1);
      }
    }
    for (const w of ud.wings) w.rotation.z = Math.sin(time * 9 + c.phase) * 0.6 * w.userData.side;
    let bodyY = ud.baseY;
    if (c.sp.plan === 'hopper' && c.moving) bodyY += Math.abs(Math.sin(c.phase * 0.8)) * 0.8;
    else if (c.moving) bodyY += Math.abs(Math.sin(c.phase)) * 0.05;
    else bodyY += Math.sin(time * 1.5 + c.phase) * 0.02;
    ud.body.position.y = bodyY;
    if (c.hurt > 0) ud.body.rotation.z = Math.sin(time * 40) * 0.15 * c.hurt;
    else ud.body.rotation.z = 0;
    if (c.state === 'dying') {
      m.rotation.z = Math.min(Math.PI / 2, (m.rotation.z || 0) + dt * 4);
    }
  }

  // Ray vs creature spheres
  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    const tmp = new THREE.Vector3();
    for (const c of this.list) {
      if (c.dead) continue;
      const center = tmp.copy(c.pos);
      center.y += (c.sp.plan === 'flyer' || c.sp.plan === 'floater') ? 0 : 0.8 * c.sp.size;
      const r = Math.max(0.7, c.sp.size * 0.9);
      const oc = origin.clone().sub(center);
      const b = oc.dot(dir);
      const cc = oc.lengthSq() - r * r;
      const h = b * b - cc;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t > 0 && t < bestT) { bestT = t; best = c; }
    }
    return best ? { creature: best, dist: bestT } : null;
  }

  damage(c, amount) {
    c.health -= amount;
    c.hurt = 0.5;
    c.provoked = c.sp.temper !== 'Skittish';
    if (c.sp.temper === 'Skittish' || c.sp.temper === 'Passive') { c.state = 'flee'; c.timer = 5; c.provoked = false; }
    if (c.health <= 0) { c.dead = true; return true; }
    return false;
  }

  hitSphere(p, radius) {
    for (const c of this.list) {
      if (c.dead) continue;
      const cy = c.pos.y + ((c.sp.plan === 'flyer' || c.sp.plan === 'floater') ? 0 : 0.8 * c.sp.size);
      const r = Math.max(0.7, c.sp.size * 0.9) + radius;
      if ((p.x - c.pos.x) ** 2 + (p.y - cy) ** 2 + (p.z - c.pos.z) ** 2 < r * r) return c;
    }
    return null;
  }
}
