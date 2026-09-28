// Liminal pockets: small buildings on the surface that are far bigger on the inside.
//
// Every pocket building is the same solid block (12 x 13) with an S-bend passage carved through
// it. On the surface the passage ends in a blank wall. The pocket is a second copy of the world
// in which the same passage has no door behind you and opens, at the far end, onto a space that
// goes on forever. While you're inside the bend and can't see either end, the game swaps one copy
// for the other. Everything here is a pure function of (descriptor, x, y, z) so the terrain
// worker can build the pocket chunk by chunk.
//
// Local frame: u runs across the building, v runs from the door (v = 0) inwards, y is measured
// from the floor (the floor block is y = -1). The descriptor carries the rotation and the world
// position of local (0, 0).
import { B } from './blocks.js';
import { hash32 } from '../core/rng.js';

export const POCKET_KINDS = ['backrooms', 'poolrooms', 'hallway', 'library', 'warehouse'];
export const isPocketKind = (t) => POCKET_KINDS.includes(t);

const fm = (a, n) => ((a % n) + n) % n;
const hf = (s, a, b, c = 0) => hash32(s, a, b, c) / 4294967296;

// building footprint in local cells
export const BU0 = -2, BU1 = 9, BV0 = 0, BV1 = 12;
export const BLD_W = BU1 - BU0 + 1, BLD_D = BV1 - BV0 + 1;

// ------------------------------------------------------------------ frames
export function toWorld(d, u, v) {
  switch (d.rot & 3) {
    case 0: return [d.ox + u, d.oz + v];
    case 1: return [d.ox - v, d.oz + u];
    case 2: return [d.ox - u, d.oz - v];
    default: return [d.ox + v, d.oz - u];
  }
}
export function toLocal(d, x, z) {
  switch (d.rot & 3) {
    case 0: return [x - d.ox, z - d.oz];
    case 1: return [z - d.oz, d.ox - x];
    case 2: return [d.ox - x, d.oz - z];
    default: return [d.oz - z, x - d.ox];
  }
}
// continuous versions for positions (cell (u, v) spans [u, u + 1) x [v, v + 1))
export function localPt(d, x, z) {
  switch (d.rot & 3) {
    case 0: return [x - d.ox, z - d.oz];
    case 1: return [z - d.oz, d.ox + 1 - x];
    case 2: return [d.ox + 1 - x, d.oz + 1 - z];
    default: return [d.oz + 1 - z, x - d.ox];
  }
}
export function worldPt(d, u, v) {
  switch (d.rot & 3) {
    case 0: return [d.ox + u, d.oz + v];
    case 1: return [d.ox + 1 - v, d.oz + u];
    case 2: return [d.ox + 1 - u, d.oz + 1 - v];
    default: return [d.ox + v, d.oz + 1 - u];
  }
}
// a local direction (du, dv) in world space
export function worldDir(d, du, dv) {
  switch (d.rot & 3) {
    case 0: return [du, dv];
    case 1: return [-dv, du];
    case 2: return [-du, -dv];
    default: return [dv, -du];
  }
}
// yaw that looks along local (du, dv); the camera looks down -z at yaw 0
export function worldYaw(d, du, dv) {
  const [x, z] = worldDir(d, du, dv);
  return Math.atan2(-x, -z);
}

// the descriptor for a planned structure ({ type, x, z, y, seed, rot })
export function frameOf(s) {
  const d = { kind: s.type, seed: s.seed >>> 0, rot: s.rot & 3, F: s.y, ox: 0, oz: 0 };
  let mx = Infinity, mz = Infinity;
  for (const [u, v] of [[BU0, BV0], [BU1, BV0], [BU0, BV1], [BU1, BV1]]) {
    const [x, z] = toWorld(d, u, v);
    mx = Math.min(mx, x); mz = Math.min(mz, z);
  }
  d.ox = s.x - mx; d.oz = s.z - mz;
  d.key = `${s.type}:${d.ox}:${d.oz}`;
  return d;
}

// ------------------------------------------------------------------ styles
export const STYLE = {
  backrooms: { floor: B.CARPET, wall: B.WALLPAPER, ceil: B.CEILING_TILE, light: B.LIGHT_PANEL, air: B.LIT_AIR, out: B.CONCRETE, trim: B.WALLPAPER, roof: B.CONCRETE, H: 4, name: 'The Backrooms', sub: 'Level 0' },
  poolrooms: { floor: B.POOL_TILE, wall: B.POOL_TILE, ceil: B.POOL_TILE, light: B.LIGHT_PANEL, air: B.LIT_AIR, out: B.POOL_TILE, trim: B.POOL_DEEP, roof: B.POOL_TILE, H: 6, name: 'The Poolrooms', sub: 'Level 37' },
  hallway: { floor: B.CHECKER, wall: B.POOL_TILE, ceil: B.CEILING_TILE, light: B.LIGHT_PANEL, air: B.LIT_AIR, out: B.BRICK, trim: B.CONCRETE, roof: B.CONCRETE, H: 4, name: 'The Hallway', sub: 'Exit 0' },
  library: { floor: B.DARK_WOOD, wall: B.BOOKSHELF, ceil: B.DARK_WOOD, light: B.LAMP, air: B.LIT_DIM, out: B.MARBLE, trim: B.DARK_WOOD, roof: B.MARBLE, H: 7, name: 'The Endless Library', sub: 'Quiet, please' },
  warehouse: { floor: B.CONCRETE, wall: B.METAL_PANEL, ceil: B.METAL_PANEL, light: B.LAMP, air: B.LIT_DIM, out: B.METAL_PANEL, trim: B.RUST, roof: B.METAL_PLATE, H: 10, name: 'The Warehouse', sub: 'After hours' },
};

// ------------------------------------------------------------------ the building
function throatAir(u, v) {
  return (u >= 0 && u <= 1 && v >= 0 && v <= 5) || (v >= 4 && v <= 5 && u >= 0 && u <= 7) || (u >= 6 && u <= 7 && v >= 4 && v <= 10);
}
export const isDoorCell = (u, v) => v === 0 && (u === 0 || u === 1);
export const isBackCut = (u, v) => (u === 6 || u === 7) && (v === 11 || v === 12);
export const inBuilding = (u, v) => u >= BU0 && u <= BU1 && v >= BV0 && v <= BV1;
const openIn = (u, v, pocket) => (pocket ? (throatAir(u, v) && !isDoorCell(u, v)) || isBackCut(u, v) : throatAir(u, v));
const THROAT_LIGHTS = new Set(['0,2', '1,2', '4,4', '4,5', '6,8', '7,8']);

// the cells that differ between the surface and the pocket: the doorway and the far end
export const SEAM_CELLS = [[0, 0], [1, 0], [6, 11], [7, 11]];
// the passage cells from which the swap may happen (inside the bend)
export const inBend = (u, v) => (v >= 4 && v <= 5 && u >= 2 && u <= 5) || (u >= 6 && u <= 7 && v >= 4 && v <= 7);
export const inThroat = (u, v) => throatAir(u, v) || isBackCut(u, v);

export function buildingBlock(d, u, y, v, pocket) {
  const st = STYLE[d.kind];
  if (y < -1) return B.STONE;
  const open = openIn(u, v, pocket);
  if (y === -1) return open || isDoorCell(u, v) ? st.floor : st.out;
  if (y <= 2) {
    if (open) return st.air;
    if (openIn(u - 1, v, pocket) || openIn(u + 1, v, pocket) || openIn(u, v - 1, pocket) || openIn(u, v + 1, pocket)) return st.wall;
    // the outside: trim bands, corner pillars, a light over the door, a roller shutter on the warehouse
    const corner = (u === BU0 || u === BU1) && (v === BV0 || v === BV1);
    if (d.kind === 'warehouse' && v === BV0 && u >= 4 && u <= 7) return B.ROLLER;
    if (d.kind === 'library' && v === BV0 && (u === -2 || u === 3) && !pocket) return B.MARBLE;
    if (corner) return st.trim;
    if (y === 2) return st.trim;
    return st.out;
  }
  if (y === 3) {
    if (open) return THROAT_LIGHTS.has(`${u},${v}`) ? st.light : st.ceil;
    if (!pocket && v === BV0 && (u === 0 || u === 1)) return d.kind === 'backrooms' || d.kind === 'hallway' ? B.LIGHT_PANEL : B.LAMP;
    if (d.kind === 'warehouse' && v === BV0 && u >= 4 && u <= 7) return B.ROLLER;
    return st.out;
  }
  if (y === 4) return st.roof;
  if (pocket) return y <= st.H ? st.out : B.AIR;
  // a parapet around the roof
  if (y === 5 && (u === BU0 || u === BU1 || v === BV0 || v === BV1)) return d.kind === 'library' ? B.MARBLE : st.trim;
  return B.AIR;
}

// ------------------------------------------------------------------ where the important things are
// (deterministic from the descriptor, so the manager and the generator agree)
function ring(d, salt, rMin, rMax, a0 = null) {
  const a = a0 ?? hf(d.seed, salt, 1) * Math.PI * 2;
  const r = rMin + hf(d.seed, salt, 2) * (rMax - rMin);
  // centred on the passage's far end, and never behind the building
  let u = 6.5 + Math.cos(a) * r, v = 14 + Math.sin(a) * r;
  if (v < 16) v = 16 + (16 - v);
  return [Math.round(u), Math.round(v)];
}
export function backroomsExit(d) {
  const [u0, v0] = ring(d, 71, 95, 135);
  return { u: 4 * Math.round(u0 / 4), v: 4 * Math.floor(v0 / 4) + 2 };
}
// The Poolrooms go down before they come up: one long stair from the tiled rooms into the Lower
// Baths, and somewhere across the baths a well of daylight with a stair up its wall to the grass.
export const PR = { LF: -22, CEIL: -9, R: 11, LOOPS: 1.25, TOP: 7 };
export function poolStair(d) {
  const [u0, v0] = ring(d, 73, 30, 46);
  const i = Math.floor(u0 / 12), j = Math.max(2, Math.floor(v0 / 12));
  // four wide down the middle of rooms (i, j) and (i, j + 1), one step per block, running +v
  return { i, j, u0: i * 12 + 4, u1: i * 12 + 7, v0: j * 12 + 2, v1: j * 12 + 21, bu: i * 12 + 6, bv: j * 12 + 23 };
}
export function poolWell(d) {
  const S = d._pstair || (d._pstair = poolStair(d));
  const a = Math.PI / 2 + (hf(d.seed, 74, 1) - 0.5) * 2.0;
  const r = 44 + hf(d.seed, 74, 2) * 18;
  return { u: Math.round(S.bu + Math.cos(a) * r), v: Math.round(S.bv + Math.sin(a) * r), a0: hf(d.seed, 74, 3) * Math.PI * 2 };
}
// the stair up the well: where on it a cell at angle a is, as the heights of the steps there
export function wellSteps(W, a) {
  const t = fm(a - W.a0, Math.PI * 2) / (Math.PI * 2);
  const out = [];
  for (let k = 0; k < 2; k++) {
    const T = (t + k) / PR.LOOPS;
    if (T <= 1) out.push(PR.LF + Math.round(T * (PR.TOP - PR.LF)));
  }
  return out;
}
export function libraryBooks(d) {
  const a0 = hf(d.seed, 75, 0) * Math.PI * 2;
  return [0, 1, 2].map((k) => {
    const [u0, v0] = ring(d, 76 + k, 34, 62, a0 + k * 2.1);
    const u = 11 * Math.floor(u0 / 11) + 5, v = 5 * Math.floor(v0 / 5) + 3;
    return { u, v, y: 1 + (k % 2) };
  });
}
export function warehouseExit(d) {
  const [u0, v0] = ring(d, 81, 80, 110);
  return { u: u0, v: v0 };
}
export function warehouseBreaker(d) {
  const e = warehouseExit(d);
  const a = Math.atan2(e.v - 14, e.u - 6.5) + Math.PI * (0.55 + hf(d.seed, 83, 0) * 0.9);
  const [u, v] = ring(d, 84, 45, 70, a);
  return { u, v };
}

// ------------------------------------------------------------------ the spaces
const clearing = (u, v) => u >= 4 && u <= 9 && v >= 13 && v <= 16;

// Level 0: yellow wallpaper, damp carpet, the hum of the lights. A grid of 4-block cells whose
// walls come and go; regions of it have lost their lights, or their walls, or their textures.
const BR_P = [0.42, 0.1, 0.4, 0.58, 0.45];
function brZone(d, u, v) {
  const mx = Math.floor(u / 16), mz = Math.floor(v / 16);
  if (mx >= -1 && mx <= 1 && mz >= -1 && mz <= 1) return 0;
  const r = hf(d.seed, mx, mz, 21);
  if (r < 0.56) return 0;
  if (r < 0.71) return 1;
  if (r < 0.86) return 2;
  if (r < 0.95) return 3;
  return Math.abs(mx) + Math.abs(mz) > 4 ? 4 : 0;
}
const brSegV = (d, a, b) => hf(d.seed, a, b, 11) < BR_P[brZone(d, a * 4, b * 4 + 2)];
const brSegH = (d, a, b) => hf(d.seed, a, b, 12) < BR_P[brZone(d, a * 4 + 2, b * 4)];
function backrooms(d, u, y, v) {
  if (y < -1) return B.STONE;
  if (y === -1) return B.CARPET;
  if (y > 4) return B.AIR;
  const zone = brZone(d, u, v);
  const cu = Math.floor(u / 4), cv = Math.floor(v / 4);
  const lightMissing = zone === 2 || hf(d.seed, cu, cv, 17) >= 0.85;
  if (y === 4) return !lightMissing && fm(v, 4) === 2 && (fm(u, 4) === 1 || fm(u, 4) === 2) ? B.LIGHT_PANEL : B.CEILING_TILE;
  const air = zone === 2 ? B.LIT_DARK : lightMissing ? B.LIT_DIM : B.LIT_AIR;
  if (clearing(u, v)) return air;
  // the way out
  const E = d._exit || (d._exit = backroomsExit(d));
  if (u === E.u && Math.abs(v - E.v) <= 1) {
    if (v === E.v) return y === 0 ? B.EXIT_DOOR : y === 1 ? B.EXIT_DOOR_TOP : y === 2 ? B.EXIT_SIGN : B.WALLPAPER;
    return B.WALLPAPER;
  }
  const ou = fm(u, 4) === 0, ov = fm(v, 4) === 0;
  if (!ou && !ov) {
    if (y === 0 && fm(u, 4) === 2 && fm(v, 4) === 2 && hf(d.seed, cu, cv, 19) < 0.025) return B.CHEST;
    return air;
  }
  let wall;
  if (ou && ov) {
    const a = u / 4, b = v / 4;
    wall = zone === 1 ? ((a & 1) === 0 && (b & 1) === 0)
      : brSegV(d, a, b - 1) || brSegV(d, a, b) || brSegH(d, a - 1, b) || brSegH(d, a, b) || hf(d.seed, a, b, 15) < 0.25;
  } else if (ou) {
    const a = u / 4, b = cv;
    wall = brSegV(d, a, b) && !(fm(v, 4) === 2 && y <= 2 && hf(d.seed, a, b, 13) < 0.28);
  } else {
    const a = cu, b = v / 4;
    wall = brSegH(d, a, b) && !(fm(u, 4) === 2 && y <= 2 && hf(d.seed, a, b, 16) < 0.28);
  }
  if (!wall) return air;
  if (zone === 4 && hf(d.seed, u, v, y + 40) < 0.18) return B.MISSING;
  return B.WALLPAPER;
}

// The Poolrooms: white tile rooms, twelve blocks across, joined by wide arches. Some rooms are
// dry halls of pillars, some are shallow, some are deep, some are open to a sky that isn't there.
export function prArch(d, line, cell, axis) {
  const h = hash32(d.seed, line, cell, axis);
  if ((h & 255) < 36) return null; // a solid wall
  const w = 3 + ((h >>> 8) % 3);
  const c = 2 + ((h >>> 12) % (10 - w));
  return [c, c + w - 1];
}
export function prRoomType(d, i, j) {
  const S = d._pstair || (d._pstair = poolStair(d));
  if (i === S.i && j === S.j) return 'stair';
  if (i === S.i && j === S.j + 1) return 'stair2';
  if (i >= -1 && i <= 0 && j >= 0 && j <= 1) return 'dry';
  const r = hf(d.seed, i, j, 31);
  return r < 0.38 ? 'shallow' : r < 0.6 ? 'pillars' : r < 0.76 ? 'deep' : r < 0.9 ? 'flooded' : 'sky';
}
// the long stair: its step height at a cell, or null if the cell isn't on it
function prStep(S, u, v) {
  if (u < S.u0 || u > S.u1 || v < S.v0 || v > S.v1) return null;
  return -2 - (v - S.v0);
}
function poolrooms(d, u, y, v) {
  if (y > PR.TOP + 1) return B.AIR;
  if (y < PR.LF - 6) return B.STONE;
  const S = d._pstair || (d._pstair = poolStair(d));
  const W = d._pwell || (d._pwell = poolWell(d));
  const wr = Math.hypot(u - W.u, v - W.v);
  if (wr < PR.R + 6) {
    const b = prWell(d, W, u, y, v, wr);
    if (b >= 0) return b;
  }
  if (y <= PR.CEIL + 1) {
    // the stair comes down through the ceiling of the baths
    const st = prStep(S, u, v);
    if (st !== null) {
      if (y > st) return B.LIT_AIR;
      if (y === st) return fm(v - S.v0, 2) === 0 ? B.POOL_TILE : B.POOL_DEEP;
      if (y === st - 1 || y >= PR.CEIL) return B.POOL_TILE;
    }
    return baths(d, S, u, y, v);
  }
  if (y > 6) return B.AIR;
  const i = Math.floor(u / 12), j = Math.floor(v / 12);
  const iu = fm(u, 12), iv = fm(v, 12);
  const type = prRoomType(d, i, j);
  const st = prStep(S, u, v);
  // the stair trench, open down to the steps
  if (st !== null && y < 0) {
    if (y > st) return B.LIT_AIR;
    if (y === st) return fm(v - S.v0, 2) === 0 ? B.POOL_TILE : B.POOL_DEEP;
    return B.POOL_TILE;
  }
  // walls and arches
  if (iu === 0 || iv === 0) {
    if (y < -1) return B.POOL_TILE;
    if (y === -1) return B.POOL_TILE;
    if (y === 7) return B.AIR;
    if (y === 6) return B.POOL_TILE;
    if (iu === 0 && iv === 0) return B.POOL_TILE;
    // the two stair rooms are one long hall
    if (iv === 0 && type === 'stair2' && y <= 5) return y === 5 || (y === 0 && (u === S.u0 - 1 || u === S.u1 + 1)) ? B.POOL_DEEP : B.LIT_AIR;
    const arch = iu === 0 ? prArch(d, i, j, 1) : prArch(d, j, i, 2);
    const k = iu === 0 ? iv : iu;
    if (arch && k >= arch[0] && k <= arch[1] && y <= 3) return B.LIT_AIR;
    if (clearing(u, v)) return B.LIT_AIR;
    return y === 1 ? B.POOL_DEEP : B.POOL_TILE;
  }
  const stairRoom = type === 'stair' || type === 'stair2';
  // how deep the floor is here
  let depth = 0;
  const inner = (a, b) => iu >= a && iu <= b && iv >= a && iv <= b;
  if (type === 'shallow' && inner(3, 9)) depth = 1;
  else if (type === 'deep' && inner(2, 10)) depth = inner(4, 8) ? 5 : 2;
  else if (type === 'flooded') depth = 1;
  if (clearing(u, v)) depth = 0;
  if (y === 7) return B.AIR;
  if (y === 6) {
    if ((type === 'sky' && inner(3, 9)) || (stairRoom && u >= S.u0 - 1 && u <= S.u1 + 1 && fm(iv, 4) !== 0)) return B.GLASS;
    return fm(iu, 3) === 1 && fm(iv, 3) === 1 ? B.LIGHT_PANEL : B.POOL_TILE;
  }
  if (y >= 0) {
    // a low tiled rail along the sides and the far end of the stair
    if (y === 0 && stairRoom && v >= S.v0 && v <= S.v1 + 1 && (u === S.u0 - 1 || u === S.u1 + 1 || (v === S.v1 + 1 && u >= S.u0 && u <= S.u1))) return B.POOL_DEEP;
    if (type === 'pillars' && fm(iu, 4) === 2 && fm(iv, 4) === 2 && !clearing(u, v)) return B.POOL_TILE;
    return B.LIT_AIR;
  }
  // y < 0: water, then the pool floor
  const floorY = -1 - depth;
  if (y > floorY) return B.WATER;
  if (y === floorY) return depth === 0 ? B.POOL_TILE : B.POOL_DEEP;
  return B.POOL_TILE;
}

// The Lower Baths: a hall of square columns ten blocks apart under a coffered ceiling, most of its
// floor a still, flush pool you can see the columns in. Dimmer and bluer than the rooms above.
function bathType(d, bi, bj) {
  const r = hf(d.seed, bi, bj, 37);
  return r < 0.42 ? 'still' : r < 0.7 ? 'dry' : r < 0.86 ? 'deep' : 'dark';
}
function baths(d, S, u, y, v) {
  const { LF, CEIL } = PR;
  if (y < LF - 6) return B.STONE;
  const bi = Math.floor(u / 10), bj = Math.floor(v / 10);
  const bu = fm(u, 10), bv = fm(v, 10);
  // the stair's footprint and landing stay clear, and the water under it is shallow and still
  const nearStair = u >= S.u0 - 3 && u <= S.u1 + 3 && v >= S.v0 + 5 && v <= S.v1 + 5;
  const landing = nearStair && v > S.v1 - 1;
  const column = bu <= 1 && bv <= 1 && !nearStair;
  let type = bathType(d, bi, bj);
  if (nearStair) type = landing ? 'dry' : 'still';
  if (column) {
    if (y === LF + 1 || y === CEIL - 1) return B.POOL_DEEP;
    return B.POOL_TILE;
  }
  // the ceiling: coffers between the columns, a panel in each
  if (y >= CEIL) {
    const inCoffer = bu >= 3 && bu <= 8 && bv >= 3 && bv <= 8;
    if (y === CEIL && inCoffer) return type === 'dark' ? B.LIT_DARK : B.LIT_DIM;
    if (y === CEIL + 1 && inCoffer && type !== 'dark' && bu >= 5 && bu <= 6 && bv >= 5 && bv <= 6) return B.LIGHT_PANEL;
    return B.POOL_TILE;
  }
  const air = type === 'dark' ? B.LIT_DARK : landing ? B.LIT_AIR : B.LIT_DIM;
  if (y > LF) return air;
  // the floor and the water in it
  const grid = bu <= 1 || bv <= 1;
  let depth = 0;
  if (type === 'still' && !grid) depth = 2;
  else if (type === 'deep' && bu >= 3 && bu <= 8 && bv >= 3 && bv <= 8) depth = bu >= 4 && bu <= 7 && bv >= 4 && bv <= 7 ? 5 : 3;
  if (depth) {
    if (y > LF - depth) return B.WATER;
    if (y === LF - depth) return (bu === 4 || bu === 7) && (bv === 4 || bv === 7) && type === 'deep' ? B.LIGHT_PANEL : B.POOL_DEEP;
    return B.STONE;
  }
  if (y === LF) return grid ? B.POOL_DEEP : B.POOL_TILE;
  return B.STONE;
}

// The well: a round shaft of daylight from the baths to the roof, a pool at its foot with something
// in it, a waterfall, and a stair that climbs the wall all the way up to a lawn in the tiles.
function prWell(d, W, u, y, v, r) {
  const { LF, CEIL, R, TOP } = PR;
  if (r >= R + 1.3) {
    // a lawn around the opening, on the roof of the rooms
    if (r < R + 5 && y === TOP) return B.GRASS;
    if (r < R + 4.5 && y === TOP + 1) {
      const h = hash32(d.seed, u, v, 91) & 255;
      return h < 70 ? B.TALLGRASS : h < 80 ? B.FLOWER : B.AIR;
    }
    return -1;
  }
  if (r >= R) {
    // the wall hangs down to six blocks above the baths' floor; below that the baths run in
    if (y === TOP) return B.GRASS;
    if (y > TOP) return B.AIR;
    if (y >= LF + 7) return y === LF + 7 || y === CEIL || y === -1 ? B.POOL_DEEP : B.POOL_TILE;
    return -1;
  }
  const a = Math.atan2(v - W.v, u - W.u);
  // the waterfall, pouring from a beam at the top into the pool
  const wa = fm(a - W.a0 - Math.PI * 0.8, Math.PI * 2);
  if (wa < 0.2 && r >= 6.6 && r < 8.2 && y > LF && y < TOP - 1) return B.WATER;
  if (wa < 0.24 && r >= 6.2 && y >= TOP - 1 && y <= TOP) return y === TOP ? B.GRASS : B.POOL_DEEP;
  // the stair up the wall
  if (r >= R - 2.5) {
    for (const s of wellSteps(W, a)) {
      if (y === s) return s === TOP ? B.GRASS : fm(Math.round(a * 20), 2) ? B.POOL_TILE : B.POOL_DEEP;
      if (y === s - 1 && s > LF + 1) return B.POOL_TILE;
    }
    if (y === LF) return B.POOL_TILE;
    if (y < LF) return B.STONE;
    return y < CEIL ? B.LIT_AIR : B.AIR;
  }
  // the pool: flush with the floor, five deep, a ring of lights at the bottom
  if (y > LF) return y < CEIL ? B.LIT_AIR : B.AIR;
  if (r >= R - 3.3) return y === LF ? B.POOL_DEEP : B.STONE;
  if (y > LF - 5) return B.WATER;
  if (y === LF - 5) return r >= 3 && r < 4.2 && fm(Math.round(a * 4 / Math.PI), 2) === 0 ? B.LIGHT_PANEL : B.POOL_DEEP;
  return B.STONE;
}

// The Hallway: one corridor, forty blocks long, that you walk again and again. Each end turns a
// corner into a short bend and comes back into the start of the same corridor, so the space
// repeats every 48 blocks along u; the pocket manager moves you back one repeat whenever you cross
// the middle of a bend, and changes the corridor while you can't see it.
export const HALL = { P: 48, L: 40, v0: 14, v1: 16, mid: 44 };
export function hallOpen(u, v) {
  const t = fm(u, 48);
  if (t <= 39) return v >= 14 && v <= 16;
  if ((t <= 42 || t >= 45) && v >= 14 && v <= 22) return true;
  return v >= 20 && v <= 22;
}
// the decor of an ordinary corridor at base-period position t on the given wall side
export function hallDecor(t, v, y) {
  if (v === 17) {
    if ((t === 8 || t === 20 || t === 32) && y <= 1) return y === 0 ? B.OFFICE_DOOR : B.OFFICE_DOOR_TOP;
    if ((t === 12 || t === 24) && y === 1) return B.POSTER;
    if (t === 16 && y === 3) return B.GRATE;
  } else if (v === 13) {
    if ((t === 4 || t === 14 || t === 26 || t === 36) && y === 1) return B.POSTER;
    if (t === 30 && y === 1) return B.EMERGENCY;
  }
  return -1;
}
export function hallCeiling(t, v) {
  if (t <= 39) return v === 15 && fm(t, 4) === 1 ? B.LIGHT_PANEL : B.CEILING_TILE;
  if ((t === 41 || t === 46) && v === 18) return B.LIGHT_PANEL;
  if ((t === 43 || t === 44) && v === 21) return B.LIGHT_PANEL;
  return B.CEILING_TILE;
}
function hallway(d, u, y, v) {
  if (y < -1) return B.STONE;
  if (y > 4) return B.AIR;
  const t = fm(u, 48);
  const entry = (u === 6 || u === 7) && v === 13 && y >= -1 && y <= 2;
  const open = hallOpen(u, v) || entry;
  if (y === -1) return open ? B.CHECKER : B.STONE;
  if (y === 4) return open ? hallCeiling(t, v) : B.STONE;
  if (open) return B.LIT_AIR;
  if (t <= 39 && (v === 13 || v === 17)) {
    const dec = hallDecor(t, v, y);
    if (dec >= 0) return dec;
  }
  return B.POOL_TILE;
}

// The Endless Library: rows of shelves to the ceiling with narrow aisles between, reading rooms
// where the lamps are still lit, and stacks where they aren't.
function libZone(d, u, v) {
  const mx = Math.floor(u / 24), mz = Math.floor(v / 24);
  if (mx >= -1 && mx <= 0 && mz >= 0 && mz <= 1) return 0;
  const r = hf(d.seed, mx, mz, 41);
  return r < 0.7 ? 0 : r < 0.85 ? 1 : 2;
}
const libGap = (d, u, v) => fm(u, 11) <= 1 && hf(d.seed, Math.floor(u / 11), Math.floor(v / 5), 42) < 0.75;
function library(d, u, y, v) {
  if (y < -1) return B.STONE;
  if (y === -1) return fm(v, 5) === 1 ? B.PLANKS : B.DARK_WOOD;
  if (y > 7) return B.AIR;
  const zone = libZone(d, u, v);
  if (y === 7) {
    if (zone === 2) return B.DARK_WOOD;
    if (zone === 1) return fm(u, 6) === 3 && fm(v, 6) === 3 ? B.LAMP : B.DARK_WOOD;
    return fm(v, 5) === 1 && fm(u, 6) === 3 ? B.LAMP : B.DARK_WOOD;
  }
  const air = zone === 2 ? B.LIT_DARK : zone === 1 ? B.LIT_AIR : B.LIT_DIM;
  const books = d._books || (d._books = libraryBooks(d));
  for (const b of books) if (b.u === u && b.v === v) return y === b.y ? B.GLOW_BOOK : y <= 5 ? B.BOOKSHELF : air;
  if (clearing(u, v)) return air;
  if (zone === 1) {
    // a reading room: tables with lamps, shelves only around the edge of the room
    const lu = fm(u, 24), lv = fm(v, 24);
    if ((lu === 0 || lv === 0) && y <= 5 && !(fm(lu + lv, 12) >= 5 && fm(lu + lv, 12) <= 7)) return B.BOOKSHELF;
    const tu = fm(u, 6), tv = fm(v, 6);
    if (y === 0 && (tu === 2 || tu === 3) && (tv === 2 || tv === 3)) return B.PLANKS;
    if (y === 1 && tu === 2 && tv === 2) return B.LAMP;
    return air;
  }
  if (fm(v, 5) >= 3 && !libGap(d, u, v) && y <= 5) return B.BOOKSHELF;
  return air;
}

// The Warehouse: racks in long rows under a roof you can't see, a few lamps making pools of
// light, and a loading door somewhere with daylight under it.
function whZone(d, u, v) {
  const mx = Math.floor(u / 28), mz = Math.floor(v / 28);
  if (mx >= -1 && mx <= 0 && mz >= 0 && mz <= 1) return 0;
  const bk = d._brk || (d._brk = warehouseBreaker(d));
  if (mx === Math.floor(bk.u / 28) && mz === Math.floor(bk.v / 28)) return 2;
  const r = hf(d.seed, mx, mz, 51);
  return r < 0.62 ? 0 : r < 0.84 ? 1 : r < 0.92 ? 2 : 3;
}
function warehouse(d, u, y, v) {
  if (y < -1) return B.STONE;
  if (y > 10) return B.AIR;
  const zone = whZone(d, u, v);
  const lu = fm(u, 12), lv = fm(v, 12);
  const lampHere = zone !== 3 && hf(d.seed, Math.floor(u / 12), Math.floor(v / 12), 52) < 0.7;
  if (y === -1) return (fm(u, 7) === 1 || fm(u, 7) === 4) && zone === 0 ? B.PLASTIC_Y : B.CONCRETE;
  if (y === 10) return lampHere && lu === 6 && lv === 6 ? B.LAMP : B.METAL_PANEL;
  const pool = lampHere && lu >= 3 && lu <= 9 && lv >= 3 && lv <= 9;
  let air = pool ? (lu >= 5 && lu <= 7 && lv >= 5 && lv <= 7 ? B.LIT_AIR : B.LIT_DIM) : B.LIT_DARK;
  // the loading door: a thick wall with a shutter, and the light that leaks under it
  const E = d._wexit || (d._wexit = warehouseExit(d));
  const eu = u - E.u, ev = v - E.v;
  if (eu >= -6 && eu <= 5 && ev >= 0 && ev <= 3) {
    if (ev === 0 && eu >= -2 && eu <= 1 && y <= 3) return B.ROLLER;
    return ev === 0 && y === 4 && eu >= -2 && eu <= 1 ? B.EMERGENCY : B.METAL_PANEL;
  }
  if (eu >= -4 && eu <= 3 && ev >= -4 && ev < 0) return y <= 3 ? B.LIT_AIR : air;
  if (clearing(u, v)) return air;
  if (zone === 2) {
    // the office: glass-walled, lights on, the breaker on the back wall
    const ou = fm(u, 28), ov = fm(v, 28);
    const inRoom = ou >= 8 && ou <= 19 && ov >= 8 && ov <= 17;
    if (inRoom) {
      const wall = ou === 8 || ou === 19 || ov === 8 || ov === 17;
      const bk = d._brk || (d._brk = warehouseBreaker(d));
      if (wall) {
        if (y > 3) return y === 4 ? B.METAL_PANEL : air;
        if (ov === 8 && (ou === 13 || ou === 14) && y <= 1) return B.LIT_AIR;
        if (ov === 17 && ou === 13 && y === 1 && Math.floor(bk.u / 28) === Math.floor(u / 28) && Math.floor(bk.v / 28) === Math.floor(v / 28)) return B.BREAKER;
        return y === 1 || y === 2 ? B.GLASS : B.METAL_PANEL;
      }
      if (y === 4) return (ou === 11 || ou === 16) && (ov === 11 || ov === 14) ? B.LIGHT_PANEL : B.METAL_PANEL;
      if (y > 4) return air;
      if (y === 0 && ov === 16 && ou >= 10 && ou <= 12) return B.PLANKS;
      return B.LIT_AIR;
    }
    return air;
  }
  if (zone === 1) {
    // open floor with stacks of pallets and crates
    const h = hash32(d.seed, Math.floor(u / 3), Math.floor(v / 3), 53);
    if (fm(u, 3) !== 2 && fm(v, 3) !== 2 && (h & 7) === 0 && y <= ((h >>> 4) & 1)) return y === 0 ? B.PLANKS : B.SHELF;
    return air;
  }
  // rows of racks along v, cross aisles every 18
  if ((fm(u, 7) === 2 || fm(u, 7) === 3) && !(fm(v, 18) <= 2 && hf(d.seed, Math.floor(u / 7), Math.floor(v / 18), 54) < 0.85) && y <= 5) return B.SHELF;
  return air;
}

const SPACES = { backrooms, poolrooms, hallway, library, warehouse };

// the pocket: the building without its door, and the space around it
export function pocketBlockAt(d, x, y, z) {
  const [u, v] = toLocal(d, x, z);
  const ly = y - d.F;
  if (inBuilding(u, v) && !(d.kind === 'poolrooms' && ly <= PR.CEIL)) {
    if (ly > 4 && ly > STYLE[d.kind].H) return B.AIR;
    return buildingBlock(d, u, ly, v, true);
  }
  return SPACES[d.kind](d, u, ly, v);
}

// the vertical band a pocket occupies
export function pocketBand(d) {
  const H = STYLE[d.kind].H;
  if (d.kind === 'poolrooms') return [Math.max(1, d.F + PR.LF - 7), Math.min(127, d.F + PR.TOP + 1)];
  return [Math.max(1, d.F - 14), Math.min(127, d.F + H + 2)];
}
