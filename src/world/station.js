// Voxel interior of a space station: a wide hangar with four landing pads (one per dreamer in a
// shared dream) and four showroom bays where ships are for sale, and a liminal lobby (pool,
// marble, neon, windows onto space) with trade / tech / service terminals.
import { B } from './blocks.js';

export const STATION_FLOOR = 40;
const F = STATION_FLOOR;
const X0 = -44, X1 = 44, Z0 = -48, Z1 = 40;
const LOBBY_X = 26;
const Y0 = F - 2, Y1 = F + 18;
const CEIL = F + 7;

// landing pads, one per player (host first); ships park facing the lobby
export const STATION_PADS = [{ x: -10, z: -34 }, { x: 10, z: -34 }, { x: -30, z: -34 }, { x: 30, z: -34 }];
export const STATION_PAD = STATION_PADS[0];
// showroom bays for ships on sale, each with a kiosk in front
export const SHIP_BAYS = [{ x: -30, z: -17 }, { x: -14, z: -17 }, { x: 14, z: -17 }, { x: 30, z: -17 }];

export const STATION_TERMINALS = [
  { x: -9, z: 2, kind: 'sell', label: 'Trade Terminal' },
  { x: 9, z: 2, kind: 'buy', label: 'Supply Terminal' },
  { x: -20, z: 32, kind: 'tech', label: 'Tech Merchant' },
  { x: 20, z: 32, kind: 'services', label: 'Station Services' },
  { x: 0, z: 38, kind: 'archive', label: 'Dream Archive' },
  ...SHIP_BAYS.map((b, i) => ({ x: b.x, z: -9, kind: 'ship', bay: i, label: 'Ship for sale' })),
];

export const STATION_NPCS = [
  { x: -9, z: 4.5, face: Math.PI },
  { x: 9, z: 4.5, face: Math.PI },
  { x: -18, z: 32, face: -Math.PI / 2 },
  { x: 18, z: 32, face: Math.PI / 2 },
  { x: 3, z: 30, face: Math.PI * 0.8 },
];

function terminalAt(x, z) {
  for (const t of STATION_TERMINALS) if (t.x === x && t.z === z) return t;
  return null;
}

export function stationBlockAt(x, y, z) {
  if (x < X0 || x > X1 || z < Z0 || z > Z1 || y < Y0 || y > Y1) return B.AIR;
  const ax = Math.abs(x);
  // ---------- hangar ----------
  if (z < -6) {
    if (y === Y0) return B.METAL_PANEL;
    if (y === F - 1) {
      for (const p of STATION_PADS) {
        const dx = Math.abs(x - p.x), dz = Math.abs(z - p.z);
        if (dx <= 7 && dz <= 7) return ((x + z) & 1) ? B.DREAM_TILE : B.POOL_TILE;
        if (dx <= 8 && dz <= 8) return B.NEON;
      }
      for (const b of SHIP_BAYS) {
        const dx = Math.abs(x - b.x), dz = Math.abs(z - b.z);
        if (dx <= 5 && dz <= 5) return B.MARBLE;
        if (dx <= 6 && dz <= 6) return B.SILVER;
      }
      // a lit walkway from the lobby door to the pads
      if (ax <= 2 && z > -27) return ax === 2 ? B.LIGHT_PANEL : B.CHECKER;
      return B.METAL_PLATE;
    }
    if (y === Y1) return (x % 6 === 0 && z % 6 === 0) ? B.LIGHT_PANEL : B.METAL_PANEL;
    // the open front of the hangar: a field you can see space through
    if (z === Z0) {
      if (ax <= 40 && y <= F + 14) return B.GLASS;
      return B.METAL_PANEL;
    }
    if (x === X0 || x === X1) {
      if (z % 6 === 0 && y > F && y < F + 12) return B.LIGHT_PANEL;
      if (y >= F + 3 && y <= F + 6 && z % 6 !== 0) return B.GLASS;
      return B.METAL_PANEL;
    }
    // columns between the pads and the showroom, with lamps
    if ((ax === 20 || ax === 40) && z === -25) return y === F + 8 ? B.LAMP : B.METAL_PANEL;
    // kiosks in front of the showroom bays
    if (y <= F + 1 && z === -9) for (const b of SHIP_BAYS) if (x === b.x) return B.TERMINAL;
    // cargo stacked in the corners
    if (ax >= 38 && ax <= 42 && z >= -13 && z <= -8 && y <= F + ((x + z) & 1)) return (z & 1) ? B.METAL_PLATE : B.PLANKS;
    return B.LIT_AIR;
  }
  // ---------- divider wall ----------
  if (z === -6) {
    if (y === Y0) return B.METAL_PANEL;
    if (y === F - 1) return B.METAL_PLATE;
    if (ax <= 3 && y >= F && y <= F + 4) return B.LIT_AIR;
    if (ax <= 4 && y === F + 5) return B.NEON;
    return B.METAL_PANEL;
  }
  // ---------- lobby ----------
  if (ax > LOBBY_X) return B.AIR;
  if (y > CEIL) return B.AIR;
  const pool = ax <= 7 && z >= 12 && z <= 26;
  const poolEdge = !pool && ax <= 8 && z >= 11 && z <= 27;
  if (y === Y0) return pool ? B.POOL_DEEP : B.METAL_PANEL;
  if (y === CEIL) return (x % 4 === 0 && z % 4 === 2) ? B.LIGHT_PANEL : B.CEILING_TILE;
  if (ax === LOBBY_X || z === Z1) {
    const along = ax === LOBBY_X ? z : x;
    if (y >= F + 1 && y <= F + 4 && Math.abs(along) % 7 !== 0) return B.GLASS;
    if (y === F + 5) return B.NEON;
    return B.MARBLE;
  }
  if (y === F - 1) {
    if (pool) return B.WATER;
    if (poolEdge) return B.POOL_TILE;
    if (ax <= 2) return B.CHECKER;
    return ((x >> 1) + (z >> 1)) & 1 ? B.POOL_TILE : B.DREAM_TILE;
  }
  // columns
  if (ax === 12 && ((z - 2) % 8 === 0) && z > -6) return B.MARBLE;
  // terminals (2 tall kiosks)
  if (y <= F + 1) {
    const t = terminalAt(x, z);
    if (t) return B.TERMINAL;
  }
  // planters with little dream trees
  for (const [px, pz] of [[-20, 8], [20, 8], [-20, 20], [20, 20]]) {
    if (x === px && z === pz) {
      if (y === F) return B.DREAM_BLOCK;
      if (y === F + 1 || y === F + 2) return B.LOG;
      if (y === F + 3) return B.LEAVES;
    }
    if (y === F + 3 && Math.abs(x - px) + Math.abs(z - pz) === 1) return B.LEAVES;
  }
  // lamp posts by the pool
  if ((ax === 9) && (z === 11 || z === 27)) {
    if (y === F) return B.MARBLE;
    if (y === F + 1) return B.LAMP;
  }
  return B.LIT_AIR;
}
