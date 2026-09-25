// Liminal terrain zones. Instead of isolated buildings, whole regions of a world turn
// into dream-spaces: fog meadows, endless poolscapes, platforms over a void, grids of
// silver memory, the infinite library, plastic districts, and floating lines.
// Liminal worlds also hide an endless Backrooms layer beneath their surface.
import { hash32, smoothstep } from '../core/rng.js';
import { B } from './blocks.js';
import { HEIGHT, GW } from '../config.js';

export const ZONE_SIZE = 150;
const NAT = { type: 'natural', blend: 0 };
const mod = (a, n) => ((a % n) + n) % n;

export const ZONE_INFO = {
  meadow: { name: 'Fog Meadow', text: 'Grass to the end of the world, and the world ends very close.' },
  poolscape: { name: 'The Poolscape', text: 'Tiles and still water, forever. Someone left the lights on.' },
  tilevoid: { name: 'Tile Void', text: 'Floor tiles float over nothing. Do not look down for too long.' },
  memory: { name: 'Memory', text: 'A lattice of silver. Each block is something you forgot.' },
  library: { name: 'The Infinite Library', text: 'Every book that could be written. Most of them are about you.' },
  plasticity: { name: 'Plastic District', text: 'Bright, hollow, perfectly clean. Nobody has ever lived here.' },
  lines: { name: 'The Lines', text: 'Straight lines drawn across the sky by something very patient.' },
  backrooms: { name: 'Underground Eden', text: 'Beneath the world: damp carpet, humming lights, no exits.' },
};

function cellType(tg, cx, cz) {
  const key = cx * 73856093 ^ cz * 19349663;
  let t = tg.zoneCache.get(key);
  if (t) return t;
  const zones = tg.p.zones;
  if (cx === 0 && cz === 0) t = tg.p.biome === 'liminal' ? 'meadow' : 'natural';
  else {
    const h = hash32(tg.seed, cx, cz, 91);
    let total = 0;
    for (const z of zones) total += z[1];
    let r = (h / 4294967296) * total;
    t = zones[0][0];
    for (const z of zones) { r -= z[1]; if (r <= 0) { t = z[0]; break; } }
  }
  if (tg.zoneCache.size > 4096) tg.zoneCache.clear();
  tg.zoneCache.set(key, t);
  return t;
}

export function zoneAt(tg, x, z) {
  if (!tg.p.zones) return NAT;
  const cx = Math.floor(x / ZONE_SIZE), cz = Math.floor(z / ZONE_SIZE);
  let d1 = 1e18, d2 = 1e18, t1 = 'natural', t2 = 'natural';
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const gx = cx + dx, gz = cz + dz;
    const h = hash32(tg.seed, gx, gz, 77);
    const fx = (gx + 0.15 + ((h & 1023) / 1023) * 0.7) * ZONE_SIZE;
    const fz = (gz + 0.15 + (((h >>> 10) & 1023) / 1023) * 0.7) * ZONE_SIZE;
    const d = (x - fx) * (x - fx) + (z - fz) * (z - fz);
    if (d < d1) { d2 = d1; t2 = t1; d1 = d; t1 = cellType(tg, gx, gz); }
    else if (d < d2) { d2 = d; t2 = cellType(tg, gx, gz); }
  }
  if (t1 === 'natural') return NAT;
  const border = (Math.sqrt(d2) - Math.sqrt(d1)) * 0.5;
  const blend = t2 === t1 ? 1 : smoothstep(3, 26, border);
  return { type: t1, blend };
}

export function zoneFloor(tg, type, x, z) {
  const P = tg.p;
  const sea = P.liquid ? P.seaLevel : 0;
  let f = P.terrain.base + 2;
  if (type === 'meadow') f += tg.nHill.fbm2(x * 0.012, z * 0.012, 2) * 3;
  if (type === 'tilevoid') f += 5;
  return Math.max(sea + 3, Math.min(HEIGHT - 30, f));
}

// ------------------------------------------------------------------------------------------------
// Column writers. `S` is a setter for the current column: S(y, id). `top` is the natural top.
const PL = [B.PLASTIC_R, B.PLASTIC_Y, B.PLASTIC_B, B.PLASTIC_W];
const LINE_BLOCKS = [B.PLASTIC_R, B.PLASTIC_B, B.MARBLE, B.NEON, B.CHECKER, B.PLASTIC_Y, B.SILVER];

function clearRange(S, y0, y1, id = B.AIR) {
  for (let y = y0; y <= y1 && y < HEIGHT; y++) S(y, id);
}

const WRITERS = {
  poolscape(tg, S, wx, wz, F) {
    const lx = mod(wx, 8), lz = mod(wz, 8);
    const h = hash32(tg.seed, Math.floor(wx / 8), Math.floor(wz / 8), 313);
    const pool = (h % 100) < 30;
    const roof = ((h >>> 8) % 100) < 55;
    const wallX = ((h >>> 16) % 100) < 25, wallZ = ((h >>> 22) % 100) < 25;
    const liquid = tg.p.liquid === B.DREAM_WATER ? B.DREAM_WATER : B.WATER;
    clearRange(S, F, F + 14);
    S(F - 3, B.POOL_TILE); S(F - 2, B.POOL_TILE); S(F - 1, B.POOL_TILE);
    if (pool && lx >= 1 && lx <= 6 && lz >= 1 && lz <= 6) {
      S(F - 1, liquid); S(F - 2, liquid); S(F - 3, B.POOL_DEEP);
    }
    const inside = roof ? B.LIT_AIR : B.AIR;
    let solid = false;
    if (lx === 0 && lz === 0) solid = true;
    if (wallX && lx === 0 && !(lz >= 3 && lz <= 4)) solid = true;
    if (wallZ && lz === 0 && !(lx >= 3 && lx <= 4)) solid = true;
    for (let y = F; y < F + 6; y++) S(y, solid ? B.POOL_TILE : inside);
    if (solid && !roof && lx === 0 && lz === 0) { S(F + 6, B.POOL_TILE); S(F + 7, B.LAMP); }
    if (roof) S(F + 6, ((lx === 2 || lx === 6) && (lz === 2 || lz === 6)) ? B.LIGHT_PANEL : B.POOL_TILE);
  },

  library(tg, S, wx, wz, F) {
    const lx = mod(wx, 7), lz = mod(wz, 7);
    const h = hash32(tg.seed, Math.floor(wx / 7), Math.floor(wz / 7), 419);
    clearRange(S, F, F + 10);
    S(F - 1, B.CARPET); S(F - 2, B.DARK_WOOD);
    const door = (lx === 0 && lz === 3) || (lz === 0 && lx === 3);
    const wall = (lx === 0 || lz === 0);
    for (let y = F; y < F + 6; y++) {
      if (wall && !(door && y < F + 3)) S(y, (lx === 0 && lz === 0) ? B.DARK_WOOD : B.BOOKSHELF);
      else S(y, B.AIR);
    }
    S(F + 6, B.DARK_WOOD);
    S(F + 7, tg.p.surface.top === B.SAND ? B.SAND : B.GRASS);
    if ((h % 100) < 38 && lx === 3 && lz === 3) S(F + 5, B.LAMP);
    // skylights through the lawn above
    if (((h >>> 16) % 100) < 9 && lx === 3 && lz === 3) { S(F + 6, B.AIR); S(F + 7, B.AIR); }
    // endless pits into the void
    if (((h >>> 8) % 100) < 12 && lx >= 2 && lx <= 4 && lz >= 2 && lz <= 4) {
      clearRange(S, 3, F - 1);
      S(1, B.STARRY); S(2, B.STARRY);
    }
  },

  memory(tg, S, wx, wz, F) {
    clearRange(S, F, Math.min(HEIGHT - 1, F + 70));
    S(F - 1, B.CONCRETE);
    if (mod(wx, 4) === 0 && mod(wz, 4) === 0) {
      for (let y = F + 2; y < Math.min(HEIGHT - 2, F + 66); y += 4) S(y, B.SILVER);
    }
  },

  tilevoid(tg, S, wx, wz, F) {
    clearRange(S, 3, HEIGHT - 1);
    S(1, B.STARRY); S(2, B.STARRY);
    const lx = mod(wx, 5), lz = mod(wz, 5);
    const cx = Math.floor(wx / 5), cz = Math.floor(wz / 5);
    const h = hash32(tg.seed, cx, cz, 521);
    const missing = (h % 100) < 16;
    const dy = ((h >>> 8) % 7) === 0 ? ((h >>> 12) % 5) - 2 : 0;
    const top = F - 1 + dy;
    let tile = -1;
    if (!missing && lx < 4 && lz < 4) tile = ((cx + cz) & 1) ? B.GRASS : (((h >>> 16) % 3) === 0 ? B.CHECKER : B.POOL_TILE);
    if (!missing && lx === 4 && (lz === 1 || lz === 2) && ((h >>> 18) & 1)) tile = B.POOL_TILE;
    if (!missing && lz === 4 && (lx === 1 || lx === 2) && ((h >>> 19) & 1)) tile = B.POOL_TILE;
    if (tile >= 0) {
      S(top, tile);
      if (tile === B.GRASS && (hash32(wx, wz, 3) % 4) === 0) S(top + 1, B.TALLGRASS);
      if (((h >>> 20) % 19) === 0 && lx === 1 && lz === 1) { S(top + 1, B.PLASTIC_W); S(top + 2, B.PLASTIC_W); S(top + 3, B.LAMP); }
    }
  },

  plasticity(tg, S, wx, wz, F) {
    const lx = mod(wx, 12), lz = mod(wz, 12);
    const h = hash32(tg.seed, Math.floor(wx / 12), Math.floor(wz / 12), 617);
    clearRange(S, F, F + 18);
    const street = lx < 2 || lz < 2;
    S(F - 1, street ? ((lx === 0 && mod(wz, 3) === 0) || (lz === 0 && mod(wx, 3) === 0) ? B.PLASTIC_Y : B.CONCRETE) : B.CONCRETE);
    if (lx === 1 && lz === 1) { S(F, B.PLASTIC_W); S(F + 1, B.PLASTIC_W); S(F + 2, B.PLASTIC_W); S(F + 3, B.LAMP); return; }
    if (street) return;
    if ((h % 100) < 14) { // plaza with a strange sphere
      const d = Math.hypot(lx - 6.5, lz - 6.5);
      const col = PL[(h >>> 4) % 4];
      for (let y = F; y < F + 5; y++) if (Math.hypot(lx - 6.5, y - F - 2, lz - 6.5) < 2.6) S(y, col);
      void d;
      return;
    }
    if (lx < 3 || lx > 10 || lz < 3 || lz > 10) return;
    const H = 4 + ((h >>> 4) % 11);
    const wall = PL[(h >>> 8) % 4], trim = PL[(h >>> 10) % 4];
    const edge = lx === 3 || lx === 10 || lz === 3 || lz === 10;
    const doorSide = (h >>> 12) % 4;
    for (let y = F; y < F + H; y++) {
      const top = y === F + H - 1;
      let id = B.LIT_AIR;
      if (top) id = ((lx === 5 || lx === 8) && (lz === 5 || lz === 8)) ? B.LIGHT_PANEL : trim;
      else if (edge) {
        id = wall;
        const along = (lx === 3 || lx === 10) ? lz : lx;
        if ((y - F) % 3 === 1 && along % 2 === 0 && along > 3 && along < 10) id = B.GLASS;
        const isDoor = (doorSide === 0 && lz === 3 && (lx === 6 || lx === 7)) || (doorSide === 1 && lz === 10 && (lx === 6 || lx === 7)) ||
          (doorSide === 2 && lx === 3 && (lz === 6 || lz === 7)) || (doorSide === 3 && lx === 10 && (lz === 6 || lz === 7));
        if (isDoor && y < F + 2) id = B.LIT_AIR;
      }
      S(y, id);
    }
  },

  lines(tg, S, wx, wz, F) {
    clearRange(S, F, Math.min(HEIGHT - 1, F + 64));
    if (mod(wz, 13) === 0) {
      for (let j = 0; j < 5; j++) S(F + 4 + 9 * j, LINE_BLOCKS[hash32(tg.seed, wz, j) % LINE_BLOCKS.length]);
    }
    if (mod(wx, 17) === 0) {
      for (let j = 0; j < 5; j++) S(F + 8 + 9 * j, LINE_BLOCKS[hash32(tg.seed, wx, j, 1) % LINE_BLOCKS.length]);
    }
    if (mod(wx, 13) === 0 && mod(wz, 17) === 0) {
      for (let y = F; y < Math.min(HEIGHT - 2, F + 50); y++) S(y, B.MARBLE);
    }
  },
};

export function writeZoneColumn(tg, type, S, wx, wz, F) {
  const w = WRITERS[type];
  if (w) w(tg, S, wx, wz, F);
}

// Endless backrooms beneath liminal worlds (y 9..13)
export function writeUnderlayer(tg, S, wx, wz) {
  const lx = mod(wx, 6), lz = mod(wz, 6);
  const h = hash32(tg.seed, Math.floor(wx / 6), Math.floor(wz / 6), 733);
  S(8, B.CONCRETE);
  S(9, B.CARPET);
  const wallX = (h % 100) < 55 && lx === 0 && !(lz === 2 || lz === 3);
  const wallZ = ((h >>> 8) % 100) < 55 && lz === 0 && !(lx === 2 || lx === 3);
  const post = lx === 0 && lz === 0;
  for (let y = 10; y <= 12; y++) S(y, (wallX || wallZ || post) ? B.WALLPAPER : B.LIT_AIR);
  const light = lx === 3 && lz === 3 && ((h >>> 16) % 100) < 70;
  S(13, light ? B.LIGHT_PANEL : B.CEILING_TILE);
  S(14, B.CONCRETE);
}

// Spiral manholes: 4x4 cells with a 2x2 shaft down to the backrooms
export function writeManhole(tg, S, wx, wz, top) {
  const cx = Math.floor(wx / 4), cz = Math.floor(wz / 4);
  const h = hash32(tg.seed, cx, cz, 887);
  if ((h % 1000) >= 5) return false;
  const lx = mod(wx, 4), lz = mod(wz, 4);
  if (top < 20) return false;
  if (lx >= 1 && lx <= 2 && lz >= 1 && lz <= 2) {
    const order = [[1, 1], [2, 1], [2, 2], [1, 2]].findIndex(([a, b]) => a === lx && b === lz);
    for (let y = 10; y <= top + 3 && y < HEIGHT; y++) {
      S(y, (y % 4 === order && y <= top) ? B.CONCRETE : (y <= 12 ? B.LIT_AIR : B.AIR));
    }
    return true;
  }
  S(top, B.CONCRETE);
  if (lx === 0 && lz === 0) { S(top + 1, B.CONCRETE); S(top + 2, B.CONCRETE); S(top + 3, B.LAMP); }
  return true;
}

// Lone dream props (radius <= 2) stamped as features
export function stampProp(kind, gx, y, gz, set, rng) {
  switch (kind) {
    case 'door':
      set(gx, y, gz, B.DREAM_DOOR); set(gx, y + 1, gz, B.DREAM_DOOR);
      set(gx - 1, y, gz, B.DREAM_TILE); set(gx - 1, y + 1, gz, B.DREAM_TILE); set(gx + 1, y, gz, B.DREAM_TILE); set(gx + 1, y + 1, gz, B.DREAM_TILE);
      set(gx - 1, y + 2, gz, B.DREAM_TILE); set(gx, y + 2, gz, B.DREAM_TILE); set(gx + 1, y + 2, gz, B.DREAM_TILE);
      break;
    case 'lamppost':
      for (let i = 0; i < 4; i++) set(gx, y + i, gz, B.PLASTIC_W);
      set(gx, y + 4, gz, B.LAMP);
      break;
    case 'tv':
      set(gx, y, gz, B.DARK_WOOD);
      set(gx, y + 1, gz, B.TV);
      break;
    case 'booth':
      for (let i = 0; i < 3; i++) set(gx, y + i, gz, B.GLASS);
      set(gx, y + 3, gz, B.PLASTIC_R);
      set(gx, y + 2, gz, B.LAMP);
      break;
    case 'window': {
      const alongX = rng.chance(0.5);
      for (let a = -1; a <= 1; a++) for (let b = 0; b < 3; b++) {
        const edge = a !== 0 || b !== 1;
        if (alongX) set(gx + a, y + b, gz, edge ? B.WALLPAPER : B.GLASS);
        else set(gx, y + b, gz + a, edge ? B.WALLPAPER : B.GLASS);
      }
      break;
    }
    case 'ladder':
      for (let i = 0; i < 6; i++) set(gx, y + i, gz, B.PLANKS);
      break;
    case 'watcher':
      for (let i = 0; i < 3; i++) set(gx, y + i, gz, B.MARBLE);
      set(gx, y + 3, gz, B.EYE);
      break;
    case 'groundcloud':
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = 0; dy <= 1; dy++) {
        if (dx * dx + dz * dz + dy * dy * 3 <= 4.5 && rng.next() < 0.85) set(gx + dx, y + dy, gz + dz, B.CLOUD);
      }
      break;
    case 'chair':
      set(gx, y, gz, B.PLANKS); set(gx, y + 1, gz, B.PLANKS);
      set(gx + 1, y, gz, B.PLANKS);
      break;
    default: break;
  }
}

export const PROP_KINDS = [['door', 3], ['lamppost', 4], ['tv', 3], ['booth', 1.5], ['window', 2], ['ladder', 1.5], ['watcher', 1.5], ['groundcloud', 2], ['chair', 2]];

export { GW };
