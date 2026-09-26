// Pocket spaces presented to the voxel engine as tiny "planets":
//   the Void - a black nowhere with a broken platform, a hut and a bridge to someone;
//   derelict freighters - dead ships in orbit, generated room by room from a seed.
// Pure functions of (x, y, z[, seed]) so the terrain worker can build them too.
import { B } from './blocks.js';
import { hash32 } from '../core/rng.js';

// ------------------------------------------------------------------------------------------
// The Void
export const VOID_FLOOR = 40;
export const VOID_SPAWN = { x: 0.5, y: VOID_FLOOR, z: -5.5, yaw: Math.PI };
export const VOID_NULL = { x: 0.5, y: VOID_FLOOR, z: -51.5 };

// 3x5 letters for writing in the floor
const FONT = {
  H: ['101', '101', '111', '101', '101'], O: ['111', '101', '101', '101', '111'],
  M: ['101', '111', '111', '101', '101'], E: ['111', '100', '111', '100', '111'],
};
function letterAt(word, x0, z0, x, z) {
  // word runs along +x; each glyph 3 wide + 1 gap; rows along -z
  const lx = x - x0, row = z0 - z;
  if (row < 0 || row > 4 || lx < 0) return false;
  const gi = Math.floor(lx / 4), gx = lx % 4;
  if (gi >= word.length || gx > 2) return false;
  return FONT[word[gi]][row][gx] === '1';
}

export function voidBlockAt(x, y, z) {
  const F = VOID_FLOOR;
  if (Math.abs(x) > 70 || Math.abs(z) > 70 || y < 8 || y > 90) return B.AIR;
  const r = Math.hypot(x + 0.5, z + 0.5);
  const h = hash32(x, z, 4404);
  // the island: a broken floor with a tapering underside
  if (r < 12.5 && y < F) {
    const depth = Math.floor((12.5 - r) * 0.9) + (h % 3);
    if (y < F - 1 - depth) return B.AIR;
    if (y === F - 1) {
      if (r > 10.5 && (h % 5) === 0) return B.AIR;
      if (letterAt('HOME', -8, -7, x, z)) return B.CONCRETE;
      return ((x + z) & 1) ? B.OBSIDIAN : B.ONYX;
    }
    return (h >>> 8) % 7 === 0 ? B.MISSING : B.ONYX;
  }
  // the hut: onyx walls, a doorway facing the island, the way back inside
  if (x >= -4 && x <= 4 && z >= 3 && z <= 10 && y >= F && y <= F + 4) {
    const wall = x === -4 || x === 4 || z === 3 || z === 10;
    if (y === F + 4) return B.DARK_WOOD;
    if (x === 0 && z === 9 && y <= F + 2) return B.VOID;
    if (x === 0 && z === 3 && y <= F + 1) return B.AIR;
    if (wall) return (y === F + 2 && (x === -4 || x === 4) && z === 6) ? B.GLASS : B.ONYX;
    if (x === -3 && z === 9 && y === F) return B.CHEST;
    if (x === 3 && z === 4 && y === F) return B.TV;
    return B.AIR;
  }
  // a tree with no leaves
  if (x === 8 && z === -6 && y >= F && y <= F + 5) return B.LOG;
  // the bridge out into nothing
  if (x === 0 && z < -12 && z >= -50 && y === F - 1) return (hash32(z, 11) % 9 === 0) ? B.AIR : B.DARK_WOOD;
  if (Math.abs(x) <= 1 && z <= -50 && z >= -53 && y === F - 1) return B.OBSIDIAN;
  // pieces of other worlds, drifting
  const cx = Math.floor(x / 9), cy = Math.floor(y / 9), cz = Math.floor(z / 9);
  const ch = hash32(cx, cy, cz, 4411);
  if ((ch % 23) === 0 && Math.abs(cz) > 1) {
    const ox = cx * 9 + 2 + (ch >>> 5) % 5, oy = cy * 9 + 2 + (ch >>> 9) % 5, oz = cz * 9 + 2 + (ch >>> 13) % 5;
    const s = 1 + ((ch >>> 17) % 2);
    if (Math.abs(x - ox) < s && Math.abs(y - oy) < s && Math.abs(z - oz) < s) {
      return [B.GRASS, B.MISSING, B.POOL_TILE, B.CARPET, B.STONE, B.WALLPAPER][(ch >>> 20) % 6];
    }
  }
  return B.AIR;
}

// ------------------------------------------------------------------------------------------
// Derelict freighters
export const DERELICT_FLOOR = 40;
export const DERELICT_PAD = { x: 0, z: -49 };
const DX = 23, DZ0 = -62, DZ1 = 60;
const ROOMS = 8;
const ROOM_Z0 = -38, ROOM_LEN = 11;
export const ROOM_TYPES = ['quarters', 'cargo', 'medbay', 'mess', 'lab', 'breach', 'dark', 'cargo'];

export function derelictRoom(seed, side, i) {
  const h = hash32(seed, side + 5, i, 919);
  return { type: ROOM_TYPES[h % ROOM_TYPES.length], lit: (h >>> 8) % 100 < 55, h };
}

// every place in the ship where someone left a message
export function derelictTerminals(seed) {
  const out = [];
  for (const side of [-1, 1]) for (let i = 0; i < ROOMS; i++) {
    const r = derelictRoom(seed, side, i);
    if (r.type === 'lab' || r.type === 'quarters') out.push({ x: side * 20, z: ROOM_Z0 + i * ROOM_LEN + 5, room: r.type });
  }
  out.push({ x: -6, z: 55, room: 'bridge' }, { x: 6, z: 55, room: 'bridge' }, { x: 0, z: 57, room: 'bridge' });
  return out;
}

export function derelictBlockAt(x, y, z, seed) {
  const F = DERELICT_FLOOR;
  if (Math.abs(x) > DX || z < DZ0 || z > DZ1 || y < F - 2 || y > F + 10) return B.AIR;
  const ax = Math.abs(x);
  const h = hash32(x, y, z, seed);
  // hull shell
  if (y === F - 2) return B.HULL;
  if (y === F + 10) return ((h % 29) === 0) ? B.AIR : B.HULL;
  if (ax === DX) {
    if (y >= F + 2 && y <= F + 3 && (z % 8 === 0 || z % 8 === 1)) return B.GLASS;
    return B.HULL;
  }
  if (z === DZ1) return (ax < 12 && y >= F + 1 && y <= F + 5) ? B.GLASS : B.HULL;
  // ---------- hangar bay (the ship lands here) ----------
  if (z < -40) {
    if (z === DZ0) return (ax <= 14 && y >= F && y <= F + 8) ? B.GLASS : B.HULL;
    if (y === F - 1) {
      if (ax <= 6 && z >= -55 && z <= -43) return ((x + z) & 1) ? B.METAL_PLATE : B.GRATE;
      return B.METAL_PANEL;
    }
    if (y === F + 9) return (ax % 8 === 4 && z % 6 === 0 && (h % 3)) ? B.EMERGENCY : B.HULL;
    // dead cargo tipped over in the corners
    if (ax >= 17 && ax <= 21 && z >= -58 && z <= -52 && y <= F + ((x * 3 + z) & 1)) return (z & 1) ? B.RUST : B.METAL_PLATE;
    if (z === -41 && !(ax <= 2 && y <= F + 3)) return B.HULL; // bulkhead with a door into the ship
    return B.AIR;
  }
  // ---------- bridge ----------
  if (z >= 46) {
    if (z === 46 && !(ax <= 2 && y <= F + 3)) return B.HULL;
    if (y === F - 1) return (ax < 8 && z > 50) ? B.CARPET : B.METAL_PLATE;
    if (y === F + 6) return (ax % 6 === 3 && z === 52) ? B.EMERGENCY : B.HULL;
    if (y > F + 6) return B.HULL;
    const term = derelictTerminals(seed).find((t) => t.room === 'bridge' && t.x === x && t.z === z);
    if (term && y === F) return B.TERMINAL;
    if (y === F && (ax === 6 || x === 0) && z === 54) return B.DARK_WOOD;          // seats
    if (y === F && x === 12 && z === 49) return B.CHEST;
    if (y <= F + 1 && ax >= 18 && (z === 48 || z === 56)) return B.SHELF;
    if (y === F && ax === 3 && z === 58 && (seed & 1)) return B.FLESH;
    return B.AIR;
  }
  // ---------- main deck: a spine corridor with rooms on both sides ----------
  const i = Math.floor((z - ROOM_Z0) / ROOM_LEN);
  const lz = z - ROOM_Z0 - i * ROOM_LEN;
  const inRooms = i >= 0 && i < ROOMS;
  if (ax <= 2) {
    // spine
    if (y === F - 1) return B.GRATE;
    if (y === F + 5) return (x === 0 && z % 8 === 0) ? ((hash32(z, seed, 3) % 4) ? B.EMERGENCY : B.HULL) : B.HULL;
    if (y > F + 5) return B.HULL;
    if (y === F + 4 && ax === 2) return B.METAL_PANEL; // pipes
    return B.AIR;
  }
  if (!inRooms) {
    if (y === F - 1) return B.METAL_PANEL;
    return y > F + 5 ? B.HULL : (ax === 3 ? B.HULL : B.AIR);
  }
  const side = x < 0 ? -1 : 1;
  const room = derelictRoom(seed, side, i);
  const t = room.type;
  const rx = ax - 3; // 0 at the corridor wall, up to 19 at the hull
  // room shell
  if (y === F + 6) return B.HULL;
  if (y > F + 6) return B.HULL;
  if (lz === 0) return B.METAL_PANEL;
  if (rx === 0) return (lz === 5 || lz === 6) && y <= F + 2 ? B.AIR : B.METAL_PANEL; // door to the spine
  // breach: the outer part of the room is simply gone
  if (t === 'breach' && rx > 12 && y >= F - 1 && y <= F + 5 && (hash32(x, z, seed) % 5) !== 0) return B.AIR;
  if (y === F - 1) {
    if (t === 'quarters') return B.CARPET;
    if (t === 'medbay') return B.POOL_TILE;
    if (t === 'mess') return B.CHECKER;
    if (t === 'lab') return B.CONCRETE;
    if (t === 'dark') return (h % 3) ? B.FLESH : B.METAL_PANEL;
    return B.GRATE;
  }
  if (y === F + 5) {
    if (room.lit && rx === 9 && lz === 5) return t === 'medbay' ? B.LIGHT_PANEL : B.EMERGENCY;
    if (t === 'dark' && (h % 4) === 0) return B.FLESH;
    return B.HULL;
  }
  // furniture
  const floor = y === F, low = y <= F + 1;
  switch (t) {
    case 'quarters':
      if (low && (lz === 1 || lz === 9) && rx >= 6 && rx <= 11) return B.PLANKS;          // bunks
      if (y === F + 2 && (lz === 1 || lz === 9) && rx >= 6 && rx <= 11) return B.CARPET;
      if (floor && rx === 17 && lz === 5) return B.TERMINAL;
      if (y === F + 1 && rx === 17 && lz === 3) return B.TV;
      if (low && rx === 15 && lz === 8) return B.SHELF;
      break;
    case 'cargo':
      if (y <= F + ((room.h >>> (lz % 8)) & 3) && rx >= 5 && rx <= 16 && lz % 3 !== 0 && (hash32(rx, lz, seed) % 3) !== 0) return (rx + lz) & 1 ? B.METAL_PLATE : B.PLANKS;
      if (floor && rx === 18 && lz === 5) return B.CHEST;
      break;
    case 'medbay':
      if (floor && (lz === 2 || lz === 8) && rx >= 5 && rx <= 14 && rx % 3 === 2) return B.PLASTIC_W; // beds
      if (low && rx === 18 && (lz === 3 || lz === 7)) return B.GLASS;
      if (floor && rx === 18 && lz === 5) return B.CHEST;
      break;
    case 'mess':
      if (y === F && rx >= 6 && rx <= 14 && (lz === 4 || lz === 6)) return B.DARK_WOOD;   // benches
      if (y === F + 1 && rx >= 6 && rx <= 14 && lz === 5) return B.DARK_WOOD;           // table
      if (floor && rx === 17 && lz === 2) return B.CHEST;
      break;
    case 'lab':
      // specimen tanks: glass with something asleep in them
      if (y <= F + 3 && (lz === 2 || lz === 8) && (rx === 7 || rx === 11 || rx === 15)) return y === F || y === F + 3 ? B.SILVER : B.GLASS;
      if (floor && rx === 17 && lz === 5) return B.TERMINAL;
      if (floor && rx === 10 && lz === 5 && (seed % 3) === 0) return B.MISSING;
      break;
    case 'dark':
      if ((rx === 18 || lz === 1 || lz === 9) && (h % 3) === 0) return B.FLESH;
      if (floor && rx === 12 && lz === 5) return B.CHEST;
      break;
    case 'breach':
      if (floor && rx === 8 && lz === 5) return B.CHEST;
      break;
  }
  return B.AIR;
}
