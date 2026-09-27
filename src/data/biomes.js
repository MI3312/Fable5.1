// Planet biome archetypes and the per-planet parameter generator.
// The result is a plain, structured-cloneable object shared with the terrain worker.
import { RNG, hsl, mixColor, hash32 } from '../core/rng.js';
import { B, TINT_COUNT } from '../world/blocks.js';

export const BIOMES = {
  lush: { label: 'Lush', adjectives: ['Verdant', 'Paradise', 'Temperate', 'Flourishing', 'Humid'], special: 'star_bulb', hazard: 'none', weather: 'rain' },
  frozen: { label: 'Frozen', adjectives: ['Glacial', 'Icebound', 'Frostbitten', 'Freezing', 'Hailstorm'], special: 'frost_crystal', hazard: 'cold', weather: 'snow' },
  scorched: { label: 'Scorched', adjectives: ['Charred', 'Incandescent', 'Boiling', 'Torrid', 'Arid'], special: 'solanium', hazard: 'heat', weather: 'ash' },
  toxic: { label: 'Toxic', adjectives: ['Caustic', 'Poisonous', 'Noxious', 'Corrosive', 'Acidic'], special: 'fungal_mould', hazard: 'toxic', weather: 'toxic' },
  radioactive: { label: 'Irradiated', adjectives: ['Nuclear', 'Radioactive', 'Contaminated', 'Isotopic', 'Gamma-drenched'], special: 'gamma_root', hazard: 'radiation', weather: 'dust' },
  barren: { label: 'Barren', adjectives: ['Desert', 'Dusty', 'Desolate', 'Parched', 'Rocky'], special: 'cactus_flesh', hazard: 'heat', weather: 'dust' },
  exotic: { label: 'Exotic', adjectives: ['Anomalous', 'Bizarre', 'Fractured', 'Hexagonal', 'Glitched'], special: 'hexite', hazard: 'none', weather: 'sparkle' },
  liminal: { label: 'Liminal', adjectives: ['Dreaming', 'Liminal', 'Half-remembered', 'Vaporous', 'Somnolent'], special: 'reverie_bloom', hazard: 'none', weather: 'dream' },
  dead: { label: 'Dead', adjectives: ['Airless', 'Lifeless', 'Cratered', 'Silent', 'Dead'], special: 'pugneum', hazard: 'vacuum', weather: 'none' },
};

export const BIOME_IDS = Object.keys(BIOMES);

function jitter(rng, c, a = 0.06) {
  return [c[0] + rng.range(-a, a), c[1] + rng.range(-a, a), c[2] + rng.range(-a, a)];
}

export function makePlanetParams(seed, biome, opts = {}) {
  const rng = new RNG(seed);
  const baseHue = rng.next();
  const P = {
    seed, biome,
    seaLevel: 40,
    liquid: B.WATER,
    iceSea: false,
    terrain: {
      base: 46, hillAmp: 10, hillScale: 1 / 90, mountAmp: 30, mountScale: 1 / 260, mountMask: 0.45,
      overhang: 0, overhangScale: 1 / 40, caves: 0.6, islands: 0, terrace: 0, spikes: 0, warp: 20, craters: 0,
    },
    surface: { top: B.GRASS, sub: B.DIRT, subDepth: 3, stone: B.STONE, beach: B.SAND, underwater: B.SAND, snowLine: 999, snowBlock: B.SNOW_GRASS },
    flora: { trees: [['round', 1]], treeDensity: 0.012, plants: [[B.TALLGRASS, 1]], plantDensity: 0.12, boulders: 0.002, crystals: 0 },
    ores: [[B.FERRITE_ORE, 3], [B.COPPER_ORE, 1]],
    depositDensity: 0.0012,
    structures: { liminal: 0.13, nms: 0.55 },
    tints: new Array(TINT_COUNT * 3).fill(1),
    sky: { zenith: [0.25, 0.5, 0.95], horizon: [0.7, 0.85, 1.0], sun: [1.0, 0.95, 0.85], cloud: [1, 1, 1], nightZenith: [0.01, 0.015, 0.05], nightHorizon: [0.05, 0.06, 0.12], cloudCover: 0.45, fogDensity: 1.0, stars: 0.0, dream: 0 },
    gravity: rng.range(0.8, 1.15),
    hazard: { type: BIOMES[biome].hazard, level: 0 },
    temperature: 22,
    special: BIOMES[biome].special,
    sentinels: rng.weighted([[0, 2], [1, 5], [2, 3], [3, 1]]),
    fauna: rng.range(0.4, 1.0),
    weather: BIOMES[biome].weather,
    stormChance: 0.2,
    adjective: rng.pick(BIOMES[biome].adjectives),
  };
  const setTint = (i, c) => { P.tints[i * 3] = c[0]; P.tints[i * 3 + 1] = c[1]; P.tints[i * 3 + 2] = c[2]; };
  const T = { grass: 1, leaf: 2, stone: 3, dirt: 4, water: 5, sand: 6, wood: 7, flora: 8, special: 9, crystal: 10, cap: 11 };

  // default tints
  setTint(T.stone, jitter(rng, [0.62, 0.6, 0.62], 0.05));
  setTint(T.dirt, jitter(rng, [0.62, 0.46, 0.34], 0.04));
  setTint(T.sand, jitter(rng, [0.93, 0.84, 0.62], 0.04));
  setTint(T.wood, jitter(rng, [0.6, 0.42, 0.28], 0.05));
  setTint(T.water, [0.25, 0.5, 0.9]);
  setTint(T.flora, hsl(rng.next(), 0.8, 0.65));
  setTint(T.special, hsl(rng.next(), 0.9, 0.6));
  setTint(T.crystal, hsl(rng.next(), 0.7, 0.7));
  setTint(T.cap, hsl(rng.next(), 0.7, 0.55));

  switch (biome) {
    case 'lush': {
      const gh = rng.chance(0.75) ? rng.range(0.22, 0.4) : rng.pick([rng.range(0.45, 0.55), rng.range(0.1, 0.16), rng.range(0.8, 0.95)]);
      setTint(T.grass, hsl(gh, rng.range(0.45, 0.7), rng.range(0.42, 0.55)));
      setTint(T.leaf, hsl(gh + rng.range(-0.06, 0.06), rng.range(0.45, 0.7), rng.range(0.35, 0.48)));
      const wh = rng.range(0.5, 0.62);
      setTint(T.water, hsl(wh, 0.65, 0.45));
      const sky = hsl(rng.range(0.53, 0.62) + (rng.chance(0.2) ? rng.range(-0.3, 0.3) : 0), 0.6, 0.55);
      P.sky.zenith = sky; P.sky.horizon = mixColor(sky, [1, 1, 1], 0.55);
      P.flora = { trees: [['round', 3], ['pine', 1], ['palm', 1], ['tall', 1]], treeDensity: rng.range(0.008, 0.025), plants: [[B.TALLGRASS, 10], [B.FLOWER, 3], [B.OXYGEN_PLANT, 1], [B.SODIUM_PLANT, 0.7], [B.SPECIAL_PLANT, 0.6], [B.DIHYDRO, 0.6]], plantDensity: rng.range(0.12, 0.3), boulders: 0.0035, crystals: 0 };
      P.terrain.hillAmp = rng.range(6, 16); P.terrain.mountAmp = rng.range(15, 45); P.terrain.overhang = rng.chance(0.3) ? rng.range(4, 10) : 0;
      P.temperature = rng.int(12, 32); P.hazard.level = 0;
      P.stormChance = 0.15;
      break;
    }
    case 'frozen': {
      setTint(T.grass, hsl(rng.range(0.45, 0.6), 0.25, 0.75));
      setTint(T.leaf, hsl(rng.range(0.45, 0.6), 0.3, 0.55));
      setTint(T.water, hsl(0.55, 0.5, 0.55));
      setTint(T.stone, jitter(rng, [0.6, 0.64, 0.72], 0.04));
      const sky = hsl(rng.range(0.52, 0.66), 0.35, 0.72);
      P.sky.zenith = sky; P.sky.horizon = mixColor(sky, [1, 1, 1], 0.7);
      P.sky.cloudCover = 0.65;
      P.surface = { top: B.SNOW_GRASS, sub: B.DIRT, subDepth: 2, stone: B.STONE, beach: B.SNOW, underwater: B.GRAVEL, snowLine: 0, snowBlock: B.SNOW };
      P.iceSea = true;
      P.flora = { trees: [['pine', 4], ['dead', 1]], treeDensity: rng.range(0.004, 0.012), plants: [[B.TALLGRASS, 3], [B.SPECIAL_PLANT, 1.2], [B.DIHYDRO, 1], [B.OXYGEN_PLANT, 0.3], [B.SODIUM_PLANT, 0.8]], plantDensity: rng.range(0.03, 0.08), boulders: 0.002, crystals: 0.0008 };
      P.ores = [[B.FERRITE_ORE, 3], [B.COBALT_ORE, 2], [B.COPPER_ORE, 1]];
      P.terrain.mountAmp = rng.range(30, 55); P.terrain.overhang = rng.range(0, 8);
      P.temperature = rng.int(-110, -30); P.hazard.level = rng.int(1, 3);
      P.stormChance = 0.35;
      break;
    }
    case 'scorched': {
      setTint(T.grass, hsl(rng.range(0.02, 0.1), 0.35, 0.35));
      setTint(T.leaf, hsl(rng.range(0.0, 0.08), 0.5, 0.3));
      setTint(T.stone, jitter(rng, [0.45, 0.35, 0.32], 0.05));
      setTint(T.sand, jitter(rng, [0.85, 0.55, 0.35], 0.05));
      const sky = hsl(rng.range(0.0, 0.08), 0.65, 0.5);
      P.sky.zenith = mixColor(sky, [0.2, 0.05, 0.05], 0.3); P.sky.horizon = hsl(rng.range(0.05, 0.1), 0.8, 0.65);
      P.sky.cloud = [1, 0.7, 0.5]; P.sky.cloudCover = 0.25;
      P.liquid = B.LAVA; P.seaLevel = rng.int(28, 36);
      P.surface = { top: B.ASH, sub: B.RUST, subDepth: 3, stone: B.STONE, beach: B.OBSIDIAN, underwater: B.OBSIDIAN, snowLine: 999, snowBlock: B.ASH };
      P.flora = { trees: [['dead', 3], ['cactus', 1]], treeDensity: rng.range(0.002, 0.006), plants: [[B.SPECIAL_PLANT, 2], [B.SODIUM_PLANT, 1], [B.TALLGRASS, 1]], plantDensity: rng.range(0.02, 0.05), boulders: 0.003, crystals: 0.0004 };
      P.ores = [[B.FERRITE_ORE, 2], [B.COPPER_ORE, 2], [B.GOLD_ORE, 1]];
      P.terrain.terrace = rng.chance(0.5) ? rng.int(4, 7) : 0; P.terrain.mountAmp = rng.range(20, 50);
      P.temperature = rng.int(70, 180); P.hazard.level = rng.int(1, 3);
      P.stormChance = 0.35;
      break;
    }
    case 'toxic': {
      const gh = rng.range(0.14, 0.3);
      setTint(T.grass, hsl(gh, 0.55, 0.42));
      setTint(T.leaf, hsl(gh + 0.05, 0.5, 0.4));
      setTint(T.cap, hsl(rng.pick([rng.range(0.75, 0.95), rng.range(0.08, 0.16)]), 0.7, 0.55));
      setTint(T.stone, jitter(rng, [0.5, 0.52, 0.4], 0.05));
      setTint(T.dirt, jitter(rng, [0.45, 0.42, 0.28], 0.04));
      const sky = hsl(rng.range(0.14, 0.24), 0.55, 0.55);
      P.sky.zenith = sky; P.sky.horizon = mixColor(sky, [1, 1, 0.8], 0.45);
      P.sky.cloud = [0.85, 1, 0.6]; P.sky.cloudCover = 0.55;
      P.liquid = B.ACID; P.seaLevel = rng.int(34, 42);
      P.flora = { trees: [['mushroom', 4], ['dead', 1]], treeDensity: rng.range(0.006, 0.016), plants: [[B.TALLGRASS, 4], [B.SPECIAL_PLANT, 2], [B.OXYGEN_PLANT, 0.6], [B.SODIUM_PLANT, 0.5], [B.FLOWER, 1]], plantDensity: rng.range(0.08, 0.18), boulders: 0.0015, crystals: 0 };
      P.ores = [[B.FERRITE_ORE, 3], [B.COPPER_ORE, 1], [B.URANIUM_ORE, 1]];
      P.terrain.overhang = rng.range(0, 7);
      P.temperature = rng.int(20, 60); P.hazard.level = rng.int(1, 3);
      P.stormChance = 0.3;
      break;
    }
    case 'radioactive': {
      setTint(T.grass, hsl(rng.range(0.25, 0.42), 0.45, 0.45));
      setTint(T.leaf, hsl(rng.range(0.3, 0.45), 0.6, 0.45));
      setTint(T.crystal, hsl(rng.range(0.25, 0.4), 0.9, 0.65));
      setTint(T.stone, jitter(rng, [0.45, 0.5, 0.45], 0.05));
      const sky = hsl(rng.range(0.28, 0.45), 0.5, 0.5);
      P.sky.zenith = mixColor(sky, [0.05, 0.1, 0.05], 0.3); P.sky.horizon = mixColor(sky, [0.9, 1, 0.8], 0.4);
      P.sky.cloud = [0.8, 1, 0.8];
      P.flora = { trees: [['crystal', 2], ['dead', 2], ['round', 1]], treeDensity: rng.range(0.003, 0.009), plants: [[B.TALLGRASS, 4], [B.SPECIAL_PLANT, 2], [B.DIHYDRO, 0.6], [B.SODIUM_PLANT, 0.6], [B.OXYGEN_PLANT, 0.3]], plantDensity: rng.range(0.05, 0.12), boulders: 0.002, crystals: 0.002 };
      P.ores = [[B.URANIUM_ORE, 4], [B.FERRITE_ORE, 2], [B.COBALT_ORE, 1]];
      P.depositDensity = 0.0018;
      P.temperature = rng.int(-10, 50); P.hazard.level = rng.int(1, 3);
      P.stormChance = 0.3;
      break;
    }
    case 'barren': {
      setTint(T.grass, hsl(rng.range(0.08, 0.14), 0.3, 0.55));
      setTint(T.leaf, hsl(rng.range(0.22, 0.32), 0.35, 0.4));
      setTint(T.sand, jitter(rng, [0.9, 0.75, 0.52], 0.06));
      setTint(T.stone, jitter(rng, [0.7, 0.55, 0.42], 0.06));
      const sky = hsl(rng.range(0.06, 0.12), 0.35, 0.72);
      P.sky.zenith = hsl(rng.range(0.55, 0.62), 0.35, 0.6); P.sky.horizon = sky;
      P.sky.cloudCover = 0.12;
      P.liquid = rng.chance(0.3) ? B.WATER : 0; P.seaLevel = 30;
      P.surface = { top: B.SAND, sub: B.SAND, subDepth: 4, stone: B.STONE, beach: B.SALT, underwater: B.SAND, snowLine: 999, snowBlock: B.SAND };
      P.flora = { trees: [['cactus', 4], ['dead', 1]], treeDensity: rng.range(0.002, 0.006), plants: [[B.SPECIAL_PLANT, 1], [B.TALLGRASS, 2], [B.SODIUM_PLANT, 0.5], [B.OXYGEN_PLANT, 0.3]], plantDensity: rng.range(0.015, 0.04), boulders: 0.004, crystals: 0 };
      P.ores = [[B.FERRITE_ORE, 2], [B.COPPER_ORE, 1], [B.GOLD_ORE, 1]];
      P.terrain.terrace = rng.int(3, 6); P.terrain.mountAmp = rng.range(25, 50); P.terrain.hillAmp = rng.range(3, 8);
      P.temperature = rng.int(35, 65); P.hazard.level = rng.int(0, 1);
      P.stormChance = 0.3;
      break;
    }
    case 'exotic': {
      const h = rng.next();
      setTint(T.grass, hsl(h, rng.range(0.5, 0.9), rng.range(0.5, 0.65)));
      setTint(T.leaf, hsl(h + rng.range(0.2, 0.5), 0.8, 0.55));
      setTint(T.stone, hsl(h + 0.5, 0.25, 0.6));
      setTint(T.dirt, hsl(h + 0.1, 0.3, 0.45));
      setTint(T.water, hsl(h + rng.range(0.3, 0.7), 0.8, 0.55));
      setTint(T.crystal, hsl(h + 0.33, 0.9, 0.7));
      setTint(T.flora, hsl(h + 0.6, 0.9, 0.65));
      const sky = hsl(h + rng.range(0.4, 0.6), 0.6, 0.5);
      P.sky.zenith = sky; P.sky.horizon = hsl(h + rng.range(-0.1, 0.1), 0.7, 0.75);
      P.sky.cloud = hsl(h, 0.6, 0.9); P.sky.dream = 0.5;
      P.flora = { trees: [['crystal', 2], ['coral', 3], ['lollipop', 1], ['spiral', 2]], treeDensity: rng.range(0.004, 0.012), plants: [[B.SPECIAL_PLANT, 2], [B.FLOWER, 3], [B.DIHYDRO, 1], [B.SODIUM_PLANT, 0.6], [B.OXYGEN_PLANT, 0.6]], plantDensity: rng.range(0.04, 0.12), boulders: 0.001, crystals: 0.003 };
      P.ores = [[B.COBALT_ORE, 1], [B.GOLD_ORE, 1], [B.FERRITE_ORE, 2]];
      P.terrain.islands = rng.range(0.3, 0.8); P.terrain.spikes = rng.range(0.2, 0.7); P.terrain.overhang = rng.range(4, 12); P.terrain.warp = 50;
      P.structures = { liminal: 0.5, nms: 0.3 };
      P.temperature = rng.int(-20, 60); P.hazard.level = 0;
      P.sentinels = rng.weighted([[0, 1], [3, 1]]);
      P.stormChance = 0.1;
      break;
    }
    case 'liminal': {
      const h = rng.pick([0.92, 0.58, 0.78, 0.5, 0.12]) + rng.range(-0.04, 0.04);
      setTint(T.grass, hsl(h, 0.55, 0.78));
      setTint(T.leaf, hsl(h + rng.range(0.1, 0.3), 0.6, 0.8));
      setTint(T.stone, hsl(h + 0.5, 0.15, 0.8));
      setTint(T.dirt, hsl(h + 0.05, 0.25, 0.7));
      setTint(T.sand, hsl(h - 0.1, 0.4, 0.88));
      setTint(T.water, hsl(0.52, 0.55, 0.72));
      setTint(T.wood, hsl(h, 0.2, 0.9));
      setTint(T.flora, hsl(h + 0.4, 0.6, 0.8));
      setTint(T.crystal, hsl(h + 0.2, 0.6, 0.85));
      P.sky.zenith = hsl(rng.range(0.55, 0.65), 0.55, 0.72); P.sky.horizon = hsl(h, 0.6, 0.86);
      P.sky.cloud = [1, 0.96, 1]; P.sky.cloudCover = 0.55; P.sky.dream = 1;
      P.sky.nightZenith = [0.06, 0.03, 0.12]; P.sky.nightHorizon = [0.25, 0.12, 0.3];
      P.liquid = rng.chance(0.5) ? B.DREAM_WATER : B.WATER;
      P.surface = { top: B.GRASS, sub: B.DIRT, subDepth: 3, stone: B.STONE, beach: B.POOL_TILE, underwater: B.POOL_DEEP, snowLine: 999, snowBlock: B.SNOW };
      P.flora = { trees: [['lollipop', 3], ['cloudtree', 2], ['round', 1]], treeDensity: rng.range(0.004, 0.01), plants: [[B.TALLGRASS, 6], [B.FLOWER, 3], [B.SPECIAL_PLANT, 1], [B.OXYGEN_PLANT, 0.6], [B.SODIUM_PLANT, 0.6], [B.DIHYDRO, 0.2]], plantDensity: rng.range(0.08, 0.2), boulders: 0, crystals: 0.0005 };
      P.terrain.hillAmp = rng.range(3, 8); P.terrain.mountAmp = rng.range(5, 18); P.terrain.islands = rng.range(0.2, 0.5); P.terrain.terrace = rng.chance(0.3) ? 2 : 0;
      P.structures = { liminal: 1.4, nms: 0.1 };
      P.temperature = 21; P.hazard.level = 0;
      P.sentinels = 0; P.fauna = rng.range(0.3, 0.7);
      P.stormChance = 0.05;
      break;
    }
    case 'dead': {
      setTint(T.stone, jitter(rng, [0.55, 0.55, 0.57], 0.05));
      setTint(T.grass, jitter(rng, [0.62, 0.61, 0.6], 0.04));
      P.sky.zenith = [0.0, 0.0, 0.01]; P.sky.horizon = [0.06, 0.06, 0.08]; P.sky.stars = 1; P.sky.cloudCover = 0;
      P.sky.nightZenith = [0, 0, 0]; P.sky.nightHorizon = [0.02, 0.02, 0.03];
      P.liquid = 0;
      P.surface = { top: B.GRAVEL, sub: B.GRAVEL, subDepth: 2, stone: B.STONE, beach: B.GRAVEL, underwater: B.GRAVEL, snowLine: 999, snowBlock: B.GRAVEL };
      P.flora = { trees: [], treeDensity: 0, plants: [[B.DIHYDRO, 1], [B.SODIUM_PLANT, 0.2]], plantDensity: 0.004, boulders: 0.003, crystals: 0.0005 };
      P.ores = [[B.FERRITE_ORE, 2], [B.COBALT_ORE, 1], [B.GOLD_ORE, 1], [B.URANIUM_ORE, 1]];
      P.depositDensity = 0.002;
      P.terrain.craters = 1; P.terrain.hillAmp = rng.range(4, 9); P.terrain.mountAmp = rng.range(10, 25); P.terrain.caves = 0.2;
      P.gravity = rng.range(0.45, 0.7);
      P.temperature = rng.int(-150, 100); P.hazard.level = 1;
      P.sentinels = rng.chance(0.5) ? 0 : 1; P.fauna = 0;
      P.structures = { liminal: 0.3, nms: 0.2 };
      P.stormChance = 0;
      break;
    }
  }

  // Atmosphere: every world is misty; liminal worlds are drowned in dream-fog
  const FOG = {
    lush: [1 / 108, 0.02, 3, 10, 0.5], frozen: [1 / 78, 0.03, 4, 13, 0.62], scorched: [1 / 90, 0.015, 2, 9, 0.52],
    toxic: [1 / 60, 0.044, 4, 12, 0.72], radioactive: [1 / 66, 0.034, 3, 11, 0.66], barren: [1 / 96, 0.013, 2, 8, 0.48],
    exotic: [1 / 68, 0.032, 5, 13, 0.68], liminal: [1 / 44, 0.052, 8, 15, 0.9], dead: [1 / 170, 0.009, 1, 6, 0.25],
  }[biome] || [1 / 108, 0.015, 2, 9, 0.42];
  const foggy = rng.chance(0.35) ? rng.range(1.3, 2.0) : rng.range(0.85, 1.15);
  P.fog = {
    density: FOG[0] * foggy,
    mistDensity: FOG[1] * foggy,
    mistBase: P.terrain.base + FOG[2],
    mistFalloff: FOG[3],
    skyFog: Math.min(0.95, FOG[4] * foggy),
    mistColor: mixColor(P.sky.horizon, biome === 'toxic' ? [0.85, 0.95, 0.55] : biome === 'scorched' ? [0.75, 0.6, 0.55] : [0.92, 0.9, 0.96], 0.55),
  };
  // Dream zones: regions of the world that have slipped into liminal space. Each world gets its
  // own few kinds (not all of them), so no two feel the same. A separate stream keeps the
  // terrain of existing seeds unchanged.
  const zr = new RNG(hash32(seed, 919));
  const pickZones = (pool, n, lo, hi) => zr.shuffle(pool.slice()).slice(0, n).map((z) => [z, zr.range(lo, hi)]);
  const DREAM = ['meadow', 'poolscape', 'tilevoid', 'memory', 'library', 'plasticity', 'lines'];
  const scorchedHell = rng.chance(0.4);
  const ZONES = {
    liminal: [['natural', 1.5], ...pickZones([...DREAM, 'naraka'], zr.int(4, 5), 0.8, 3)],
    exotic: [['natural', 6], ...pickZones(['memory', 'tilevoid', 'lines', 'meadow', 'naraka'], zr.int(2, 3), 0.7, 1.3)],
    dead: [['natural', 8], ...pickZones(['memory', 'library', 'tilevoid', 'naraka'], zr.int(1, 2), 0.6, 1.2)],
    scorched: scorchedHell ? [['natural', 9], ['naraka', 1.5]] : null,
  }[biome];
  if (ZONES) P.zones = ZONES;
  else if (rng.chance(0.55) && zr.chance(0.7)) {
    // ordinary worlds sometimes hold an intrusion or two of the dream
    P.zones = [['natural', 16], ...pickZones(DREAM, zr.int(1, 2), 0.5, 1.2)];
  }
  P.underlayer = biome === 'liminal' || (biome === 'exotic' && rng.chance(0.5));
  // rivers wind across most worlds with a liquid; drier worlds keep their empty canyons
  P.rivers = P.liquid ? rng.chance(0.8) : (['barren', 'dead', 'scorched'].includes(biome) && rng.chance(0.45)) ? 'dry' : false;
  P.ruins = biome !== 'dead' && rng.chance(0.75);
  if (P.liquid === B.LAVA) setTint(T.water, [1, 1, 1]);
  if (!P.sky.cloudCover && P.sky.cloudCover !== 0) P.sky.cloudCover = 0.4;
  // sun tint shifts slightly with sky
  P.sky.sun = mixColor([1, 0.96, 0.88], P.sky.horizon, 0.25);
  P.sky.fog = P.sky.horizon.slice();
  if (opts.sunColor) P.sky.sun = mixColor(P.sky.sun, opts.sunColor, 0.4);
  // A base hue used for UI accents
  P.accent = hsl(baseHue, 0.7, 0.6);
  // What gets built on this world: a few liminal kinds and a biome-flavoured set of ruins and
  // landmarks, picked per planet so each one has its own character
  const sr = new RNG(hash32(seed, 929));
  const LIM = ['poolrooms', 'backrooms', 'hallway', 'arches', 'stairs', 'watcher', 'plastic_city', 'warehouse'];
  P.structPalette = {
    liminal: sr.shuffle(LIM.slice()).slice(0, biome === 'liminal' ? 5 : sr.int(2, 3)).map((t) => [t, sr.range(0.6, 2)]),
    nms: [],
  };
  const boost = {
    crystal_grove: ['frozen', 'exotic', 'radioactive'], bones: ['barren', 'scorched', 'dead', 'toxic'], mining_rig: ['barren', 'radioactive', 'scorched'],
    watchtower: ['lush', 'frozen', 'toxic'], henge: ['lush', 'frozen', 'exotic'], observatory: ['barren', 'frozen', 'dead'], wreck: ['barren', 'dead', 'scorched', 'frozen'],
  };
  const extras = ['wreck', 'watchtower', 'observatory', 'bones', 'crystal_grove', 'henge', 'mining_rig', 'monolith']
    .map((t) => [t, (boost[t] && boost[t].includes(biome) ? 2.4 : 1) * sr.range(0.5, 1.5)])
    .sort((a, b) => b[1] - a[1]).slice(0, sr.int(3, 5));
  P.structPalette.nms = [['outpost', 2.5], ['pod', 1.6], ...extras.map(([t, w]) => [t, w * 1.4])];
  return P;
}
