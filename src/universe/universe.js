// Galaxy / star system / planet generation. Pure data, fully deterministic from the universe seed.
import { RNG, hash32, hsl } from '../core/rng.js';
import { systemName, planetName } from '../core/names.js';
import { makePlanetParams, BIOMES } from '../data/biomes.js';
import { hash32 as _h } from '../core/rng.js';

export const STAR_CLASSES = [
  { cls: 'M', color: [1.0, 0.55, 0.35], label: 'Red dwarf', w: 4 },
  { cls: 'K', color: [1.0, 0.75, 0.45], label: 'Orange', w: 3 },
  { cls: 'G', color: [1.0, 0.93, 0.75], label: 'Yellow', w: 4 },
  { cls: 'F', color: [1.0, 0.98, 0.92], label: 'White', w: 2 },
  { cls: 'A', color: [0.8, 0.88, 1.0], label: 'Blue-white', w: 1.5 },
  { cls: 'B', color: [0.6, 0.72, 1.0], label: 'Blue', w: 1 },
  { cls: 'L', color: [1.0, 0.7, 0.95], label: 'Lucid', w: 1 },
  { cls: 'E', color: [0.55, 1.0, 0.75], label: 'Emerald', w: 0.8 },
];

// The heart of the galaxy - the ultimate destination.
export const CORE = { gx: 18, gy: 0, gz: 14 };

export class Universe {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.systemCache = new Map();
  }

  key(gx, gy, gz) { return `${gx}:${gy}:${gz}`; }

  parseKey(k) {
    const [gx, gy, gz] = k.split(':').map(Number);
    return { gx, gy, gz };
  }

  hasStar(gx, gy, gz) {
    if (gx === 0 && gy === 0 && gz === 0) return true;
    if (gx === CORE.gx && gy === CORE.gy && gz === CORE.gz) return true;
    if (Math.abs(gy) > 2) return false;
    const h = hash32(this.seed, gx * 7 + 3, gy * 13 + 5, gz * 17 + 11) / 4294967296;
    return h < 0.3 - Math.abs(gy) * 0.06;
  }

  // Visual position within the galaxy map (jittered inside its cell)
  mapPosition(gx, gy, gz) {
    const r = new RNG(hash32(this.seed, gx, gy, gz) ^ 0xabc);
    return [gx + r.range(-0.3, 0.3), gy * 0.8 + r.range(-0.25, 0.25), gz + r.range(-0.3, 0.3)];
  }

  isCore(gx, gy, gz) { return gx === CORE.gx && gy === CORE.gy && gz === CORE.gz; }

  distanceToCore(gx, gy, gz) {
    return Math.hypot(gx - CORE.gx, gy - CORE.gy, gz - CORE.gz);
  }

  neighbors(gx, gy, gz, radius) {
    const out = [];
    const r = Math.ceil(radius);
    for (let x = gx - r; x <= gx + r; x++)
      for (let y = Math.max(-2, gy - r); y <= Math.min(2, gy + r); y++)
        for (let z = gz - r; z <= gz + r; z++) {
          if (Math.hypot(x - gx, y - gy, z - gz) > radius) continue;
          if (this.hasStar(x, y, z)) out.push({ gx: x, gy: y, gz: z });
        }
    return out;
  }

  getSystem(gx, gy, gz) {
    const k = this.key(gx, gy, gz);
    if (this.systemCache.has(k)) return this.systemCache.get(k);
    const sys = this._generateSystem(gx, gy, gz);
    this.systemCache.set(k, sys);
    return sys;
  }

  _generateSystem(gx, gy, gz) {
    const seed = hash32(this.seed, gx, gy, gz);
    const rng = new RNG(seed);
    const isStart = gx === 0 && gy === 0 && gz === 0;
    const isCore = this.isCore(gx, gy, gz);
    const starType = isCore ? { cls: 'Ω', color: [1, 0.92, 1], label: 'Dream Core' } : rng.weighted(STAR_CLASSES.map((s) => [s, s.w]));
    const sys = {
      key: this.key(gx, gy, gz),
      gx, gy, gz, seed,
      name: isCore ? 'The Dream Core' : systemName(seed),
      star: { cls: starType.cls, color: starType.color, label: starType.label, radius: isCore ? 5200 : rng.range(2200, 3800) },
      planets: [],
      station: null,
      asteroidSeed: hash32(seed, 99),
      economy: rng.pick(['Trading', 'Scientific', 'Mining', 'Manufacturing', 'Technology', 'Power Generation', 'Dreaming']),
      conflict: rng.pick(['Peaceful', 'Low', 'Moderate', 'Unstable']),
      isCore,
    };
    const count = isCore ? 3 : rng.int(2, 5);
    let orbit = rng.range(14000, 18000);
    for (let i = 0; i < count; i++) {
      const pseed = hash32(seed, i + 1, 777);
      const prng = new RNG(pseed);
      let biome;
      if (isStart && i === 0) biome = 'lush';
      else if (isStart && i === 1) biome = 'liminal';
      else if (isCore) biome = i === 0 ? 'liminal' : prng.pick(['liminal', 'exotic']);
      else biome = prng.weighted([['lush', 3], ['frozen', 2], ['scorched', 2], ['toxic', 2], ['radioactive', 2], ['barren', 2], ['exotic', 1], ['liminal', 1.6], ['dead', 1.4]]);
      const params = makePlanetParams(pseed, biome, { sunColor: starType.color });
      if (isStart && i === 0) {
        params.sentinels = 1; params.hazard.level = 0; params.fauna = 0.9; params.temperature = 24;
        // the first world has already begun to slip into the dream
        params.zones = [['natural', 5], ['meadow', 2.2], ['poolscape', 1.6], ['library', 1.0], ['plasticity', 0.9], ['memory', 0.6], ['tilevoid', 0.5]];
        params.underlayer = true;
        params.fog.density = 1 / 60;
        params.fog.mistDensity = 0.04;
        params.fog.mistFalloff = 12;
        params.fog.skyFog = 0.8;
      }
      const angle = prng.range(0, Math.PI * 2);
      const radius = biome === 'dead' ? prng.range(700, 1000) : prng.range(1100, 1700);
      const pos = [Math.cos(angle) * orbit, prng.range(-1500, 1500), Math.sin(angle) * orbit];
      const planet = {
        id: `${sys.key}/${i}`,
        index: i,
        seed: pseed,
        name: planetName(pseed),
        biome,
        biomeLabel: BIOMES[biome].label,
        params,
        radius,
        position: pos,
        rings: prng.chance(0.25) && biome !== 'dead',
        ringColor: hsl(prng.next(), 0.4, 0.75),
        rotationSpeed: prng.range(0.002, 0.01) * (prng.chance(0.5) ? 1 : -1),
        axialTilt: prng.range(-0.4, 0.4),
      };
      params.name = planet.name;
      sys.planets.push(planet);
      orbit += prng.range(9000, 16000);
    }
    // Space station orbits near the first planet
    const p0 = sys.planets[0];
    const sa = rng.range(0, Math.PI * 2);
    sys.station = {
      position: [p0.position[0] + Math.cos(sa) * (p0.radius * 3.2), p0.position[1] + 600, p0.position[2] + Math.sin(sa) * (p0.radius * 3.2)],
      name: sys.name + ' Station',
    };
    // Warp arrival point: between the station and the star
    sys.arrival = [sys.station.position[0] * 1.25 + 2500, sys.station.position[1] + 400, sys.station.position[2] * 1.25 + 2500];
    // A dead freighter drifting near the arrival point in many systems (always in the first)
    const dh = hash32(seed, 881);
    if (!isCore && (isStart || (dh % 100) < 45)) {
      const a = ((dh >>> 8) % 628) / 100, r = 1800 + ((dh >>> 16) % 1200);
      sys.derelict = { seed: hash32(seed, 882) % 100000, position: [sys.arrival[0] + Math.cos(a) * r, sys.arrival[1] - 300 + ((dh >>> 4) % 600), sys.arrival[2] + Math.sin(a) * r] };
    }
    return sys;
  }

  // A walkable station interior, presented to the voxel engine as a tiny "planet"
  stationPlanet(sys) {
    const seed = _h(sys.seed, 5150);
    const params = makePlanetParams(seed, 'dead');
    params.interior = 'station';
    params.name = sys.station.name;
    params.gravity = 1;
    params.fauna = 0;
    params.sentinels = 0;
    params.hazard = { type: 'none', level: 0 };
    params.temperature = 21;
    params.weather = 'none';
    params.stormChance = 0;
    params.liquid = 0;
    params.structures = { liminal: 0, nms: 0 };
    params.flora = { trees: [], treeDensity: 0, plants: [], plantDensity: 0, boulders: 0, crystals: 0 };
    params.tints = new Array(36).fill(1);
    params.tints[15] = 0.35; params.tints[16] = 0.75; params.tints[17] = 0.95; // pool water
    params.tints[6] = 0.95; params.tints[7] = 0.8; params.tints[8] = 0.95;    // planter leaves
    params.tints[21] = 0.9; params.tints[22] = 0.85; params.tints[23] = 0.95; // pastel wood
    params.sky.zenith = [0.0, 0.0, 0.01]; params.sky.horizon = [0.03, 0.02, 0.06];
    params.sky.nightZenith = [0, 0, 0]; params.sky.nightHorizon = [0.03, 0.02, 0.06];
    params.sky.stars = 1; params.sky.cloudCover = 0; params.sky.dream = 0.6;
    params.adjective = 'Orbital';
    params.fog = { density: 1 / 400, mistDensity: 0, mistBase: 0, mistFalloff: 5, skyFog: 0, mistColor: [0.1, 0.08, 0.15] };
    return {
      id: `${sys.key}/station`,
      index: -1,
      seed,
      name: sys.station.name,
      biome: 'station',
      biomeLabel: 'Space Station',
      params,
      radius: 200,
      position: sys.station.position,
      isStation: true,
    };
  }

  // Pocket spaces (the Void, derelict freighters) built on the station template
  pocketPlanet(kind, sys, seed) {
    const base = this.stationPlanet(sys);
    const P = base.params;
    P.interior = kind;
    P.derelictSeed = seed;
    P.sky.dream = 0;
    if (kind === 'void') {
      P.name = 'null';
      P.adjective = 'Nowhere';
      P.sky.zenith = [0, 0, 0]; P.sky.horizon = [0, 0, 0]; P.sky.nightZenith = [0, 0, 0]; P.sky.nightHorizon = [0, 0, 0];
      P.sky.stars = 0;
      P.fog = { density: 1 / 55, mistDensity: 0.02, mistBase: 36, mistFalloff: 6, skyFog: 0, mistColor: [0.02, 0.02, 0.03] };
      P.hazard = { type: 'none', level: 0 };
      return { ...base, id: 'void', index: -2, seed: 404, name: 'null', biome: 'void', biomeLabel: 'Void', isStation: false, isPocket: 'void' };
    }
    P.adjective = 'Derelict';
    P.fog = { density: 1 / 70, mistDensity: 0.015, mistBase: 38, mistFalloff: 5, skyFog: 0, mistColor: [0.05, 0.04, 0.05] };
    P.hazard = { type: 'vacuum', level: 2 };
    P.temperature = -170;
    const name = `Derelict ${planetName(seed).split(' ')[0]}`;
    P.name = name;
    return { ...base, id: `${sys.key}/derelict/${seed}`, index: -3, seed, name, biome: 'derelict', biomeLabel: 'Derelict Freighter', isStation: false, isPocket: 'derelict' };
  }

  // Planet surface coordinates <-> direction on the planet sphere
  static SURFACE_SCALE = 1400; // blocks per radian

  static dirToSurface(dir) {
    const lon = Math.atan2(dir[2], dir[0]);
    const lat = Math.asin(Math.max(-1, Math.min(1, dir[1])));
    return { x: Math.round(lon * Universe.SURFACE_SCALE), z: Math.round(-lat * Universe.SURFACE_SCALE) };
  }

  static surfaceToDir(x, z) {
    const lon = x / Universe.SURFACE_SCALE;
    const lat = Math.max(-1.45, Math.min(1.45, -z / Universe.SURFACE_SCALE));
    return [Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)];
  }
}
