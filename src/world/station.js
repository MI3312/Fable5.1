// Voxel interior of a space station: a hangar with a landing pad and a liminal
// lobby (pool, marble, neon, windows onto space) with trade / tech / service terminals.
import { B } from './blocks.js';

export const STATION_FLOOR = 40;
const F = STATION_FLOOR;
const X0 = -26, X1 = 26, Z0 = -40, Z1 = 40;
const Y0 = F - 2, Y1 = F + 18;
const CEIL = F + 7;

export const STATION_PAD = { x: 0, z: -18 };

export const STATION_TERMINALS = [
  { x: -9, z: 2, kind: 'sell', label: 'Trade Terminal' },
  { x: 9, z: 2, kind: 'buy', label: 'Supply Terminal' },
  { x: -20, z: 32, kind: 'tech', label: 'Tech Merchant' },
  { x: 20, z: 32, kind: 'services', label: 'Station Services' },
  { x: 0, z: 38, kind: 'archive', label: 'Dream Archive' },
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
      if (ax <= 7 && z >= -26 && z <= -10) return ((x + z) & 1) ? B.DREAM_TILE : B.POOL_TILE;
      if ((ax === 8 && z >= -27 && z <= -9) || ((z === -27 || z === -9) && ax <= 8)) return B.NEON;
      return B.METAL_PLATE;
    }
    if (y === Y1) return (x % 5 === 0 && z % 5 === 0) ? B.LIGHT_PANEL : B.METAL_PANEL;
    if (z === Z0) {
      if (ax <= 16 && y <= F + 13) return B.GLASS;
      return B.METAL_PANEL;
    }
    if (x === X0 || x === X1) {
      if (z % 6 === 0 && y > F && y < F + 12) return B.LIGHT_PANEL;
      if (y >= F + 3 && y <= F + 6 && z % 6 !== 0) return B.GLASS;
      return B.METAL_PANEL;
    }
    if (ax === 18 && z % 10 === 0) return B.METAL_PANEL;
    if ((ax === 17 || ax === 19) && z % 10 === 0 && y === F + 8) return B.LAMP;
    // cargo crates along the walls
    if (ax >= 22 && ax <= 24 && z >= -36 && z <= -30 && y <= F + ((x + z) & 1)) return (z & 1) ? B.METAL_PLATE : B.PLANKS;
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
  if (y > CEIL) return B.AIR;
  const pool = ax <= 7 && z >= 12 && z <= 26;
  const poolEdge = !pool && ax <= 8 && z >= 11 && z <= 27;
  if (y === Y0) return pool ? B.POOL_DEEP : B.METAL_PANEL;
  if (y === CEIL) return (x % 4 === 0 && z % 4 === 2) ? B.LIGHT_PANEL : B.CEILING_TILE;
  if (x === X0 || x === X1 || z === Z1) {
    const along = (x === X0 || x === X1) ? z : x;
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
