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
  backrooms: { floor: B.CARPET, wall: B.WALLPAPER, ceil: B.CEILING_TILE, light: B.LIGHT_PANEL, air: B.LIT_AIR, out: B.CONCRETE, trim: B.WALLPAPER, roof: B.CONCRETE, H: 8, name: 'The Backrooms', sub: 'Level 0' },
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
// Level 0 has three doors out, in three different directions, some nearer than others
export function backroomsExits(d) {
  const E = backroomsExit(d), a = Math.atan2(E.v - 14, E.u - 6.5);
  const out = [E];
  for (const [k, da, r0, r1] of [[1, 2.1, 65, 95], [2, -2.1, 110, 150]]) {
    const [u0, v0] = ring(d, 71 + k * 7, r0, r1, a + da + (hf(d.seed, 72, k) - 0.5) * 0.6);
    out.push({ u: 4 * Math.round(u0 / 4), v: 4 * Math.floor(v0 / 4) + 2 });
  }
  return out;
}
// The Poolrooms go down before they come up: one long stair from the tiled rooms into the Lower
// Baths, and somewhere across the baths a well of daylight with a stair up its wall to the grass.
export const PR = { LF: -22, CEIL: -9, R: 11, LOOPS: 1.25, TOP: 7 };
export function poolStair(d) {
  const [u0, v0] = ring(d, 73, 18, 30);
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
// Nine books with your name, scattered further and further out; any three will do. Each sits in
// a shelf with a lamp over the aisle in front of it.
export function libraryBooks(d) {
  const a0 = hf(d.seed, 75, 0) * Math.PI * 2;
  const out = [];
  for (let k = 0; k < 9; k++) {
    const r0 = 18 + k * 9 + hf(d.seed, 77, k) * 6;
    const [u0, v0] = ring(d, 76 + k, r0, r0 + 1, a0 + k * 2.39996);
    const u = 11 * Math.floor(u0 / 11) + 5, v = 5 * Math.floor(v0 / 5) + 3;
    if (out.some((b) => Math.abs(b.u - u) < 8 && Math.abs(b.v - v) < 8)) continue;
    out.push({ u, v, y: 1 + (k % 2) });
  }
  return out;
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
// walls come and go, in 16-block regions of their own: the plain maze, halls of pillars, stretches
// where the lights are dead, dense tangles, regions that have come apart (missing textures,
// things that shouldn't be there), cubicle offices, tall halls of an older wallpaper, and wings
// where the roof has leaked for years. Concrete stairwells lead down to Level 1: a car park of
// cinder block and pillars, pipes along its roof, with a maintenance door of its own.
export const BR = { L1F: -12, L1C: -5, TALL: 8 };
export const BRZ = { NORMAL: 0, PILLARS: 1, DARK: 2, DENSE: 3, GLITCH: 4, OFFICE: 5, TALL: 6, WET: 7 };
const BR_P = [0.42, 0.1, 0.4, 0.58, 0.45, 0.0, 0.16, 0.4];
export function brZone(d, u, v) {
  const mx = Math.floor(u / 16), mz = Math.floor(v / 16);
  if (mx >= -1 && mx <= 1 && mz >= -1 && mz <= 1) return 0;
  const r = hf(d.seed, mx, mz, 21);
  if (r < 0.3) return 0;
  if (r < 0.38) return 1;
  if (r < 0.46) return 2;
  if (r < 0.53) return 3;
  if (r < 0.67) return 5;
  if (r < 0.78) return 6;
  if (r < 0.89) return 7;
  return Math.abs(mx) + Math.abs(mz) > 3 ? 4 : 7;
}
const brSegV = (d, a, b) => hf(d.seed, a, b, 11) < BR_P[brZone(d, a * 4, b * 4 + 2)];
const brSegH = (d, a, b) => hf(d.seed, a, b, 12) < BR_P[brZone(d, a * 4 + 2, b * 4)];
// ---- stairwells: 8 x 8 rooms (two maze cells square). One is always near the way in; beyond
// it about a third of the 32-block regions have one.
export function brStair0(d) {
  const [u0, v0] = ring(d, 93, 22, 34);
  return [Math.floor(u0 / 8), Math.max(3, Math.floor(v0 / 8))];
}
export const brHasL1 = (d) => d.F + BR.L1F >= 3;
export function brStairAt(d, a, b) {
  if (!brHasL1(d)) return false;
  const G = d._st0 || (d._st0 = brStair0(d));
  if (a === G[0] && b === G[1]) return true;
  const ra = Math.floor(a / 4), rb = Math.floor(b / 4);
  if (ra === Math.floor(G[0] / 4) && rb === Math.floor(G[1] / 4)) return false;
  const h = hash32(d.seed, ra, rb, 61);
  if ((h & 255) > 86) return false;
  if (a !== ra * 4 + ((h >>> 8) & 3) || b !== rb * 4 + ((h >>> 12) & 3)) return false;
  if (b * 8 < 28 && Math.abs(a * 8 + 4 - 6) < 28) return false;
  const X = d._exits || (d._exits = backroomsExits(d));
  if (X.some((E) => Math.abs(E.u - (a * 8 + 4)) < 10 && Math.abs(E.v - (b * 8 + 4)) < 10)) return false;
  return true;
}
// the stairwell room (a, b) covering (u, v), with (u, v) in its frame (0..8 each way, walls on 0 and 8)
export function brStairLocal(d, u, v) {
  const a = Math.floor(u / 8), b = Math.floor(v / 8), lu = u - a * 8, lv = v - b * 8;
  if (brStairAt(d, a, b)) return [lu, lv, a, b];
  if (lu === 0 && brStairAt(d, a - 1, b)) return [8, lv, a - 1, b];
  if (lv === 0 && brStairAt(d, a, b - 1)) return [lu, 8, a, b - 1];
  if (lu === 0 && lv === 0 && brStairAt(d, a - 1, b - 1)) return [8, 8, a - 1, b - 1];
  return null;
}
// Down one lane, round the landing, down the other: from the floor of Level 0 to Level 1.
// Where you stand in the stairwell at (lu, lv), and how high its roof is there.
export function brStairStand(lu, lv) {
  if (lu >= 1 && lu <= 3 && lv >= 1 && lv <= 5) return [-lv, 3];
  if (lu >= 1 && lu <= 7 && lv >= 6 && lv <= 7) return [-6, -2];
  if (lu >= 5 && lu <= 7 && lv >= 1 && lv <= 5) return [BR.L1F + lv, -2];
  return null;
}
function brStairBlock(lu, lv, y) {
  if (y > 4) return B.CONCRETE;
  const edge = lu === 0 || lu === 8 || lv === 0 || lv === 8;
  if (edge) {
    if (y === 4) return B.CEILING_TILE;
    if (y === -1) return B.CONCRETE;
    // the way in from Level 0, and the way out at the bottom
    if (lv === 0 && lu >= 1 && lu <= 3 && y >= 0 && y <= 2) return B.LIT_AIR;
    if (lv === 0 && lu >= 5 && lu <= 7 && y >= BR.L1F + 1 && y <= BR.L1F + 3) return B.LIT_DIM;
    if (y === BR.L1F) return B.CONCRETE;
    return y <= BR.L1C ? B.CINDER : B.CONCRETE;
  }
  const S = brStairStand(lu, lv);
  if (!S) return B.CONCRETE; // the wall between the lanes
  const [st, top] = S;
  if (y < st) return B.CONCRETE;
  if (y <= top) return top === 3 ? B.LIT_AIR : B.LIT_DIM;
  if (y === top + 1) {
    if (top === 3) return lu === 2 && lv === 3 ? B.LIGHT_PANEL : B.CEILING_TILE;
    return (lu === 4 && lv === 7) || (lu === 6 && lv === 2) ? B.LIGHT_PANEL : B.CONCRETE;
  }
  return B.CONCRETE;
}
// ---- Level 1: a pillar every 8 blocks, cinder walls between some of them, sparse tubes of
// light, crates and drums, and the maintenance exit somewhere out in it
export function brL1Exit(d) {
  const G = d._st0 || (d._st0 = brStair0(d));
  const a = hf(d.seed, 95, 1) * Math.PI * 2, r = 36 + hf(d.seed, 95, 2) * 20;
  const u0 = G[0] * 8 + 6 + Math.cos(a) * r, v0 = G[1] * 8 - 1 + Math.sin(a) * r;
  return { u: 8 * Math.round(u0 / 8) + 4, v: 8 * Math.round(v0 / 8) + 5 };
}
const l1Lit = (d, u, v) => hf(d.seed, Math.floor(u / 8), Math.floor(v / 8), 63) < 0.42;
const l1SegV = (d, a, b) => hf(d.seed, a, b, 64) < 0.28;
const l1SegH = (d, a, b) => hf(d.seed, a, b, 65) < 0.28;
// what stands on the floor of Level 1 at (u, v): 'crate' | 'crate2' | 'drum' | null
export function brL1Prop(d, u, v) {
  const pu = fm(u, 8), pv = fm(v, 8);
  if (pu <= 1 || pv <= 1) return null;
  const E = d._l1e || (d._l1e = brL1Exit(d));
  if (Math.abs(u - E.u) <= 4 && v >= E.v - 4 && v <= E.v) return null;
  const h = hf(d.seed, u, v, 66);
  if (h > 0.03) return null;
  return h < 0.012 ? 'crate' : h < 0.02 ? 'crate2' : 'drum';
}
function brLevel1(d, u, y, v) {
  if (y === BR.L1F) return B.CONCRETE;
  if (y > BR.L1C) return B.CONCRETE;
  const pu = fm(u, 8), pv = fm(v, 8);
  const lit = l1Lit(d, u, v);
  const E = d._l1e || (d._l1e = brL1Exit(d));
  const eu = u - E.u, ev = v - E.v;
  if (y === BR.L1C) return (lit && pv === 4 && (pu === 4 || pu === 5)) || (eu >= -1 && eu <= 0 && ev === -2) ? B.LIGHT_PANEL : B.CONCRETE;
  const air = lit && pu >= 2 && pv >= 2 ? B.LIT_DIM : B.LIT_DARK;
  // the maintenance exit: a short wall with a door in it, lit
  if (ev === 0 && Math.abs(eu) <= 2) {
    if (eu === 0) return y === BR.L1F + 1 ? B.EXIT_DOOR : y === BR.L1F + 2 ? B.EXIT_DOOR_TOP : y === BR.L1F + 3 ? B.EXIT_SIGN : B.CINDER;
    return B.CINDER;
  }
  if (Math.abs(eu) <= 3 && ev < 0 && ev >= -4) return B.LIT_AIR;
  // the foot of the stairs is kept clear
  for (const [db, dl] of [[0, 1], [0, 2]]) {
    const b = Math.floor((v + dl) / 8) + db, a = Math.floor(u / 8);
    if (brStairAt(d, a, b) && fm(v + dl, 8) === 0 && pu >= 4 && pu <= 7) return air;
  }
  if (pu <= 1 && pv <= 1) return y === BR.L1F + 1 ? B.HAZARD : B.CONCRETE;
  let wall = false;
  if (pu <= 1) wall = l1SegV(d, Math.floor(u / 8), Math.floor(v / 8)) && !(pv >= 4 && pv <= 5 && y <= BR.L1F + 3);
  else if (pv <= 1) wall = l1SegH(d, Math.floor(u / 8), Math.floor(v / 8)) && !(pu >= 4 && pu <= 5 && y <= BR.L1F + 3);
  if (wall) return B.CINDER;
  if (y <= BR.L1F + 2) {
    const pr = brL1Prop(d, u, v);
    if (pr && (y === BR.L1F + 1 || pr === 'crate2')) return B.PROP;
  }
  return air;
}
// ---- the offices: rows of cubicles back to back, aisles between, a cross aisle every fourth
// column. What stands at (u, v): 'part' (a partition), 'desk' (+ a = the desk's first cell),
// 'chair', 'cab', 'cooler', 'copier'; with the way it faces (fu, fv).
export function brOfficeAt(d, u, v) {
  const lv = fm(v, 12), lu = fm(u, 4), col = Math.floor(u / 4);
  if (lv <= 3) return null;
  if (fm(col, 4) === 3) {
    if (lu === 1 && lv === 6) { const h = hf(d.seed, col, Math.floor(v / 12), 67); return h < 0.3 ? { t: 'cooler', fu: 1, fv: 0 } : h < 0.55 ? { t: 'copier', fu: 1, fv: 0 } : null; }
    return null;
  }
  if (lv === 8) return { t: 'part', ax: 'u' };
  if (lu === 0) return { t: 'part', ax: 'v' };
  const row1 = lv <= 7, back = row1 ? 7 : 9, seat = row1 ? 6 : 10, fv = row1 ? 1 : -1;
  if (lv === back) return lu === 3 ? { t: 'cab', fu: 0, fv: -fv } : { t: 'desk', a: lu === 1, fu: 0, fv: -fv };
  if (lv === seat && lu === 2 && hf(d.seed, u, v, 68) < 0.85) return { t: 'chair', fu: 0, fv };
  return null;
}
function backrooms(d, u, y, v) {
  if (y < BR.L1F) return B.STONE;
  const st = brHasL1(d) ? brStairLocal(d, u, v) : null;
  if (st) return brStairBlock(st[0], st[1], y);
  if (y < -1) return brHasL1(d) ? brLevel1(d, u, y, v) : B.STONE;
  const zone = brZone(d, u, v);
  const tall = zone === 6, H = tall ? BR.TALL : 4;
  const cu = Math.floor(u / 4), cv = Math.floor(v / 4);
  if (y === -1) {
    if (zone === 5) return B.OFFICE_CARPET;
    if (zone === 7) return B.WET_CARPET;
    if (zone === 4 && hf(d.seed, u, v, 73) < 0.06) return B.MISSING;
    return B.CARPET;
  }
  if (y > H) return y <= BR.TALL ? (zone === 7 && y === 5 ? B.PLENUM : B.WALLPAPER_B) : B.AIR;
  const lightMissing = zone === 2 || hf(d.seed, cu, cv, 17) >= (zone === 7 ? 0.62 : 0.85);
  const panel = fm(v, 4) === 2 && (fm(u, 4) === 1 || fm(u, 4) === 2);
  if (y === H) {
    if (!lightMissing && panel) return B.LIGHT_PANEL;
    // where a lower ceiling meets a tall hall, the hall's wall carries on up past it
    if (!tall && (brZone(d, u + 1, v) === 6 || brZone(d, u - 1, v) === 6 || brZone(d, u, v + 1) === 6 || brZone(d, u, v - 1) === 6)) return B.CEILING_EDGE;
    if (zone === 7) return hf(d.seed, u, v, 71) < 0.13 ? B.LIT_DIM : hf(d.seed, u, v, 72) < 0.45 ? B.CEILING_STAIN : B.CEILING_TILE;
    return B.CEILING_TILE;
  }
  const air = zone === 2 ? B.LIT_DARK : lightMissing ? B.LIT_DIM : B.LIT_AIR;
  const paper = tall ? (y === 0 ? B.WAINSCOT : B.WALLPAPER_B) : B.WALLPAPER;
  if (clearing(u, v)) return air;
  // the ways out
  for (const E of d._exits || (d._exits = backroomsExits(d))) {
    if (u === E.u && Math.abs(v - E.v) <= 1) {
      if (v === E.v && y <= 2) return y === 0 ? B.EXIT_DOOR : y === 1 ? B.EXIT_DOOR_TOP : B.EXIT_SIGN;
      return paper;
    }
  }
  // the way into a stairwell is kept clear
  if (brHasL1(d)) for (let k = 1; k <= 2; k++) if (fm(v + k, 8) === 0 && fm(u, 8) >= 1 && fm(u, 8) <= 3 && brStairAt(d, Math.floor(u / 8), (v + k) / 8)) return air;
  if (zone === 5) {
    const o = y <= 1 ? brOfficeAt(d, u, v) : null;
    if (o && (y === 0 || o.t === 'part' || o.t === 'cab' || o.t === 'copier')) return B.PROP;
    // the offices keep the maze's outer walls where they meet other regions
  }
  const ou = fm(u, 4) === 0, ov = fm(v, 4) === 0;
  if (!ou && !ov) {
    if (tall && fm(u, 8) >= 3 && fm(u, 8) <= 4 && fm(v, 8) >= 3 && fm(v, 8) <= 4) return paper; // the great pillars
    if (y === 0 && fm(u, 4) === 2 && fm(v, 4) === 2 && zone !== 5 && hf(d.seed, cu, cv, 19) < 0.025) return B.CHEST;
    return air;
  }
  let wall;
  if (ou && ov) {
    const a = u / 4, b = v / 4;
    wall = zone === 1 ? ((a & 1) === 0 && (b & 1) === 0)
      : zone === 5 ? false
        : brSegV(d, a, b - 1) || brSegV(d, a, b) || brSegH(d, a - 1, b) || brSegH(d, a, b) || (zone !== 6 && hf(d.seed, a, b, 15) < 0.25);
  } else if (ou) {
    const a = u / 4, b = cv;
    wall = brSegV(d, a, b) && !(fm(v, 4) === 2 && y <= 2 && hf(d.seed, a, b, 13) < 0.28);
  } else {
    const a = cu, b = v / 4;
    wall = brSegH(d, a, b) && !(fm(u, 4) === 2 && y <= 2 && hf(d.seed, a, b, 16) < 0.28);
  }
  if (!wall) return air;
  if (zone === 4 && hf(d.seed, u, v, y + 40) < 0.18) return B.MISSING;
  return paper;
}

// The Poolrooms: white tile rooms, twelve blocks across, joined by wide arches. Some rooms are
// dry halls of pillars, some are shallow, some are deep, some are open to a sky that isn't there.
// The way to the stair: along the entrance row of rooms (j = 1) to the stair's column, then up
// that column to the stair room. Every wall on it has an arch, and every room on it a floor you
// can walk.
function prOnRoute(d, i, j) {
  const S = d._pstair || (d._pstair = poolStair(d));
  const lo = Math.min(0, S.i), hi = Math.max(0, S.i);
  return (j === 1 && i >= lo && i <= hi) || (i === S.i && j >= 1 && j <= S.j);
}
function prRouteWall(d, line, cell, axis) {
  // axis 1: the wall at u = line * 12 between rooms (line - 1, cell) and (line, cell);
  // axis 2: the wall at v = line * 12 between rooms (cell, line - 1) and (cell, line)
  const S = d._pstair || (d._pstair = poolStair(d));
  if (axis === 1) return cell === 1 && prOnRoute(d, line - 1, 1) && prOnRoute(d, line, 1);
  return cell === S.i && line - 1 >= 1 && line <= S.j;
}
export function prArch(d, line, cell, axis) {
  const h = hash32(d.seed, line, cell, axis);
  const route = prRouteWall(d, line, cell, axis);
  if (!route && (h & 255) < 36) return null; // a solid wall
  // the arch into the stair room lines up with the stair
  if (route && axis === 2 && line === (d._pstair || poolStair(d)).j) return [4, 7];
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
  if (prOnRoute(d, i, j)) return r < 0.45 ? 'pillars' : r < 0.8 ? 'dry' : 'sky';
  return r < 0.38 ? 'shallow' : r < 0.6 ? 'pillars' : r < 0.76 ? 'deep' : r < 0.9 ? 'flooded' : 'sky';
}
// The footprints' trail from the entrance to the well, as points { u, v, y } (y: the floor you
// stand on, relative to the pocket floor): through the middle of each arch on the route, down the
// long stair, and across the baths.
export function poolTrail(d) {
  if (d._ptrail) return d._ptrail;
  const S = d._pstair || (d._pstair = poolStair(d));
  const W = d._pwell || (d._pwell = poolWell(d));
  const way = [[6.5, 15.5, 0]];
  const di = Math.sign(S.i);
  for (let i = 0; i !== S.i; i += di) {
    const wall = di > 0 ? (i + 1) * 12 : i * 12;
    const a = prArch(d, di > 0 ? i + 1 : i, 1, 1);
    const v = 12 + (a[0] + a[1]) / 2 + 0.5;
    way.push([wall - di * 2.5, v, 0], [wall + 0.5 + di * 2.5, v, 0]);
  }
  for (let j = 1; j < S.j; j++) {
    const a = prArch(d, j + 1, S.i, 2);
    const u = S.i * 12 + (a[0] + a[1]) / 2 + 0.5;
    way.push([u, (j + 1) * 12 - 2.5, 0], [u, (j + 1) * 12 + 3, 0]);
  }
  way.push([S.bu, S.v0 - 0.5, 0], [S.bu, S.v1 + 3, PR.LF + 1]);
  const dw = Math.hypot(W.u + 0.5 - S.bu, W.v + 0.5 - (S.v1 + 3));
  const k = (dw - PR.R - 1.5) / dw;
  way.push([S.bu + (W.u + 0.5 - S.bu) * k, S.v1 + 3 + (W.v + 0.5 - S.v1 - 3) * k, PR.LF + 1]);
  // sample it
  const pts = [];
  let n = 0;
  for (let q = 0; q + 1 < way.length; q++) {
    const [u0, v0] = way[q], [u1, v1] = way[q + 1];
    const len = Math.hypot(u1 - u0, v1 - v0);
    const du = (u1 - u0) / len, dv = (v1 - v0) / len;
    for (let s = 0; s < len; s += 0.72) {
      const side = (n++ & 1 ? 1 : -1) * 0.13;
      const u = u0 + du * s - dv * side, v = v0 + dv * s + du * side;
      const st = prStep(S, Math.floor(u), Math.floor(v));
      const y = st !== null ? st + 1 : (q >= way.length - 3 && v > S.v1 ? PR.LF + 1 : 0);
      pts.push({ u, v, y, du, dv, left: !!(n & 1) });
    }
  }
  return (d._ptrail = pts);
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

// The Hallway: the underground passage you walk again and again. A short passage with the exit
// sign opens into a long, tall concourse (tiled walls, pilasters, a vending alcove, a seating
// recess, doors that stay shut), which narrows again into a second passage. Its end turns into a
// Z-shaped bend (left, a shaft to the right, left again) that leads into the start of the same
// passage, so the space repeats every HALL.P blocks along u. The bend is point-symmetric about the
// middle of its shaft: walking on through the middle moves you back one repeat; turning back and
// walking the other way through the middle turns the whole place half round, so both ways out
// bring you, facing the same way, to the start. You can't see either end from the shaft, so
// neither move shows. The pocket's entrance comes in through the side of the first concourse.
export const HALL = { L: 52, P: 68, u0: -8, cv: 17.5, hall0: 6, hall1: 45 };
export const hallT = (u) => fm(u - HALL.u0, HALL.P);
// the middle of the turn after corridor k, in local coordinates
export const hallTurn = (k) => HALL.u0 + k * HALL.P + HALL.L + 8;
// alcoves off the concourse: vending machines to the north, a seating recess to the south
export const HALL_ALCOVES = { north: [36, 39], south: [36, 39] };
const inHall = (t) => t >= HALL.hall0 && t <= HALL.hall1;
export function hallOpen(u, v) {
  const t = hallT(u);
  if (t < HALL.L) {
    if (!inHall(t)) return v >= 16 && v <= 18;
    if (v >= 14 && v <= 20) return !hallPilaster(t, v);
    if (t >= HALL_ALCOVES.north[0] && t <= HALL_ALCOVES.north[1] && v >= 21 && v <= 22) return true;
    if (t >= HALL_ALCOVES.south[0] && t <= HALL_ALCOVES.south[1] && v >= 12 && v <= 13) return true;
    return false;
  }
  const D = t - HALL.L;
  return (D <= 2 && v >= 16 && v <= 24) || (D <= 9 && v >= 22 && v <= 24) || (D >= 6 && D <= 9 && v >= 10 && v <= 24)
    || (D >= 6 && v >= 10 && v <= 12) || (D >= 13 && v >= 10 && v <= 18);
}
// square pilasters standing out from both walls every eight blocks
export function hallPilaster(t, v) { return inHall(t) && fm(t, 8) === 2 && t > HALL.hall0 && t < HALL.hall1 && (v === 14 || v === 20); }
export const hallHeight = (t) => (t < HALL.L && inHall(t) ? 5 : 4);
// the decor of an ordinary lap at position t, on the wall side v, at height y
export const HALL_DOORS = [16, 20, 30], HALL_POSTERS_N = [12, 23], HALL_POSTERS_S = [8, 21, 29];
export function hallDecor(t, v, y) {
  if (!inHall(t)) return -1;
  if (v === 21 && HALL_DOORS.includes(t) && y <= 1) return y === 0 ? B.OFFICE_DOOR : B.OFFICE_DOOR_TOP;
  if (y === 0 || y === 3) return B.POOL_DEEP;                    // bands of dark tile along the walls
  if (v === 21) {
    if (HALL_POSTERS_N.includes(t) && y === 1) return B.POSTER;
    if (t === 28 && y === 4) return B.GRATE;
  } else if (v === 13) {
    if (HALL_POSTERS_S.includes(t) && y === 1) return B.POSTER;
    if (t === 35 && y === 4) return B.EMERGENCY;
  }
  return -1;
}
// ceiling lights: in the passages every fourth tile; in the concourse two rows of them; and in the
// turn, in point-symmetric pairs
const TURN_LIGHTS = [[1, 20], [4, 23], [7, 19]];
export function hallCeiling(t, v) {
  if (t < HALL.L) {
    if (!inHall(t)) return v === 17 && fm(t, 4) === 1 ? B.LIGHT_PANEL : B.CEILING_TILE;
    if (v >= 21 || v <= 13) return fm(t, 2) === 0 ? B.LIGHT_PANEL : B.CEILING_TILE;   // the alcoves are lit
    return (v === 16 || v === 18) && fm(t, 4) === 1 ? B.LIGHT_PANEL : B.CEILING_TILE;
  }
  const D = t - HALL.L;
  for (const [a, b] of TURN_LIGHTS) if ((D === a && v === b) || (D === 15 - a && v === 34 - b)) return B.LIGHT_PANEL;
  return B.CEILING_TILE;
}
function hallway(d, u, y, v) {
  if (y < -1) return B.STONE;
  if (y > 5) return B.AIR;
  const t = hallT(u);
  const H = hallHeight(t);
  const entry = (u === 6 || u === 7) && v === 13 && y >= -1 && y <= 2;
  const open = hallOpen(u, v) || entry;
  if (y === -1) {
    if (!open) return B.STONE;
    // a darker border of tiles round the concourse floor
    return inHall(t) && t < HALL.L && (v === 14 || v === 20) ? B.POOL_DEEP : B.CHECKER;
  }
  if (y === H) return open ? hallCeiling(t, v) : B.STONE;
  if (y > H) return B.STONE;
  if (open) return B.LIT_AIR;
  if (t < HALL.L) {
    if (hallPilaster(t, v)) return y === 0 || y === 3 ? B.POOL_DEEP : B.CONCRETE;
    if (v === 13 || v === 21) {
      const dec = hallDecor(t, v, y);
      if (dec >= 0) return dec;
    }
  }
  return B.POOL_TILE;
}

// The Endless Library: ranges of bookcases six blocks tall with narrow aisles between, pendant
// lamps over the aisles, reading rooms with tables and green-shaded lamps, card catalogue halls,
// and stacks where the lamps have gone out and the books lie where they fell. The shelving is
// LIB_SHELF blocks; the bookcases themselves are modelled on their faces (libraryProps.js), and
// the furniture stands in PROP blocks that are there only to be bumped into.
function libZone(d, u, v) {
  const mx = Math.floor(u / 24), mz = Math.floor(v / 24);
  if (mx >= -1 && mx <= 0 && mz >= 0 && mz <= 1) return 0;
  const r = hf(d.seed, mx, mz, 41);
  return r < 0.58 ? 0 : r < 0.73 ? 1 : r < 0.87 ? 2 : 3;
}
export const libZoneAt = libZone;
const libGap = (d, u, v) => fm(u, 11) <= 1 && hf(d.seed, Math.floor(u / 11), Math.floor(v / 5), 42) < 0.75;
// a room's walls of shelving, with doorways
const libWall = (lu, lv) => (lu === 0 || lv === 0) && !(fm(lu + lv, 12) >= 5 && fm(lu + lv, 12) <= 7);
// What stands on the floor at (u, v) besides shelving: { t, a (the cell the piece is placed
// from), ... } or null. Pure, so the prop manager models exactly what was placed here.
export function libFloorProp(d, u, v) {
  if (clearing(u, v) || inBuilding(u, v)) return null;
  const zone = libZone(d, u, v);
  const lu = fm(u, 24), lv = fm(v, 24);
  if (zone === 1) {
    if (lu === 0 || lv === 0) return null;
    const tu = fm(u, 6), tv = fm(v, 6);
    if ((tu === 2 || tu === 3) && (tv === 2 || tv === 3)) return { t: 'table', a: tu === 2 && tv === 2 };
    if (tu === 1 && tv === 2) return { t: 'chair', a: true, fu: 1, fv: 0 };
    if (tu === 4 && tv === 3) return { t: 'chair', a: true, fu: -1, fv: 0 };
    return null;
  }
  if (zone === 3) {
    if (lu < 3 || lu > 20 || lv < 3 || lv > 21 || fm(lv, 4) !== 2) return null;
    const k = fm(lu - 3, 3);
    return k === 2 ? null : { t: 'cabinet', a: k === 0, two: true };
  }
  const av = fm(v, 5);
  if ((av === 0 || av === 2) && fm(u, 11) > 1) {
    const books = d._books || (d._books = libraryBooks(d));
    if (books.some((b) => Math.abs(u - b.u) <= 3 && Math.abs(v - b.v) <= 4)) return null;
    const h = hf(d.seed, u, v, 43);
    if (h < 0.01) return { t: 'cart', a: true };
    if (zone === 2 && h < 0.05) return { t: 'pile', a: true };
  }
  return null;
}
function library(d, u, y, v) {
  if (y < -1) return B.STONE;
  if (y === -1) return fm(v, 5) === 1 ? B.PLANKS : B.DARK_WOOD;
  if (y > 7) return B.AIR;
  if (y === 7) return B.DARK_WOOD;
  const zone = libZone(d, u, v);
  const books = d._books || (d._books = libraryBooks(d));
  // a warmer pool of light in the aisle by each book, under a lamp of its own
  let near = false;
  for (const b of books) if (Math.abs(u - b.u) <= 2 && v >= b.v - 3 && v <= b.v) near = true;
  const air = near || zone === 1 || zone === 3 ? B.LIT_AIR : zone === 2 ? B.LIT_DARK : B.LIT_DIM;
  if (y === 6) {
    // pendant lamps hang from the ceiling into the air over the shelves
    for (const b of books) if (u === b.u && v === b.v - 2) return B.PROP_LAMP;
    if (zone === 2) return air;
    if (zone === 1 || zone === 3) return fm(u, 6) === 3 && fm(v, 6) === (zone === 1 ? 3 : 0) ? B.PROP_LAMP : air;
    return fm(v, 5) === 1 && fm(u, 6) === 3 ? B.PROP_LAMP : air;
  }
  for (const b of books) if (b.u === u && b.v === v) return y === b.y ? B.GLOW_BOOK : y <= 5 ? B.LIB_SHELF : air;
  if (clearing(u, v)) return air;
  if (zone === 1 || zone === 3) {
    const lu = fm(u, 24), lv = fm(v, 24);
    if (libWall(lu, lv) && y <= 5) return B.LIB_SHELF;
  }
  const fp = y <= 1 ? libFloorProp(d, u, v) : null;
  if (fp) {
    if (y === 0) return B.PROP;
    if (fp.t === 'cabinet') return B.PROP;
    if (fp.t === 'table' && fp.a) return B.PROP_LAMP;
    return air;
  }
  if (zone === 1 || zone === 3) return air;
  if (fm(v, 5) >= 3 && !libGap(d, u, v) && y <= 5) return B.LIB_SHELF;
  return air;
}

// The Warehouse: pallet racking in long runs under a roof you can't see, high-bay lamps making
// pools of light, open floors of pallets and forklifts, a floor of mannequins waiting to be
// shipped, and three ways out: the loading dock (no power until the breaker in the office is
// thrown), a fire exit chained shut (the bolt cutters are in the maintenance cage), and a freight
// lift that takes its time coming down.
const whAngle = (d) => { const e = d._wexit || (d._wexit = warehouseExit(d)); return Math.atan2(e.v - 14, e.u - 6.5); };
export function warehouseFire(d) {
  const [u, v] = ring(d, 86, 55, 72, whAngle(d) + 2.1 + hf(d.seed, 85, 0) * 0.4);
  return { u, v: Math.max(v, 30) };
}
export function warehouseLift(d) {
  const [u, v] = ring(d, 88, 44, 60, whAngle(d) - 2.1 - hf(d.seed, 87, 0) * 0.4);
  const F = warehouseFire(d);
  return Math.hypot(u - F.u, v - F.v) < 24 ? { u: u + (u < F.u ? -24 : 24), v: Math.max(v, 30) } : { u, v: Math.max(v, 30) };
}
export function warehouseCage(d) {
  const [u, v] = ring(d, 90, 24, 34, whAngle(d) + Math.PI + (hf(d.seed, 89, 0) - 0.5) * 0.8);
  return { u, v: Math.max(v, 22) };
}
function whZone(d, u, v) {
  const mx = Math.floor(u / 28), mz = Math.floor(v / 28);
  if (mx >= -1 && mx <= 0 && mz >= 0 && mz <= 1) return 0;
  const bk = d._brk || (d._brk = warehouseBreaker(d));
  if (mx === Math.floor(bk.u / 28) && mz === Math.floor(bk.v / 28)) return 2;
  const r = hf(d.seed, mx, mz, 51);
  return r < 0.52 ? 0 : r < 0.7 ? 1 : r < 0.85 ? 3 : 4;
}
export const whZoneAt = whZone;
const whAisleGap = (d, u, v) => fm(v, 18) <= 2 && hf(d.seed, Math.floor(u / 7), Math.floor(v / 18), 54) < 0.85;
export const whRackAt = (d, u, v) => { const z = whZone(d, u, v); return (z === 0 || z === 3) && (fm(u, 7) === 2 || fm(u, 7) === 3) && !whAisleGap(d, u, v); };
// the special places, and the ground kept clear in front of each: [what, du, dv] relative to it
function whSite(d, u, v) {
  const E = d._wexit || (d._wexit = warehouseExit(d)), F = d._wfire || (d._wfire = warehouseFire(d));
  const T = d._wlift || (d._wlift = warehouseLift(d)), C = d._wcage || (d._wcage = warehouseCage(d));
  if (u - E.u >= -6 && u - E.u <= 5 && v - E.v >= -5 && v - E.v <= 3) return ['dock', u - E.u, v - E.v];
  if (Math.abs(u - F.u) <= 5 && v - F.v >= -5 && v - F.v <= 2) return ['fire', u - F.u, v - F.v];
  if (Math.abs(u - T.u) <= 4 && v - T.v >= -5 && v - T.v <= 4) return ['lift', u - T.u, v - T.v];
  if (Math.abs(u - C.u) <= 4 && v - C.v >= -3 && v - C.v <= 7) return ['cage', u - C.u, v - C.v];
  return null;
}
export const whSiteAt = whSite;
// a battery lying in the light of a lamp, now and then
export function whBattery(d, u, v) {
  const cu = Math.floor(u / 12), cv = Math.floor(v / 12);
  const h = hash32(d.seed, cu, cv, 57);
  if ((h & 255) > 110) return false;
  const bu = cu * 12 + 3 + ((h >>> 8) % 7), bv = cv * 12 + 3 + ((h >>> 12) % 7);
  if (u !== bu || v !== bv) return false;
  return !whRackAt(d, u, v) && !whSite(d, u, v) && !clearing(u, v) && !inBuilding(u, v) && whZone(d, u, v) !== 2;
}
// what stands on the floor at (u, v): { t, a (the cell it's placed from), fu, fv, tall, solid }
export function whFloorProp(d, u, v) {
  if (clearing(u, v) || inBuilding(u, v) || whSite(d, u, v) || whRackAt(d, u, v)) return null;
  const zone = whZone(d, u, v);
  const h = hf(d.seed, u, v, 58);
  if (zone === 2) {
    const ou = fm(u, 28), ov = fm(v, 28);
    if (ov === 16 && (ou === 10 || ou === 11)) return { t: 'desk', a: ou === 10, fu: 0, fv: -1, solid: true };
    if (ov === 15 && ou === 11) return { t: 'chair', a: true, fu: 0, fv: 1, solid: true };
    if (ov === 16 && ou === 13) return { t: 'cab', a: true, fu: 0, fv: -1, solid: true, tall: true };
    return null;
  }
  if (zone === 1) {
    // an open floor: pallets, wrapped loads, heaps of cartons, a forklift or two
    const bu = Math.floor(u / 4), bv = Math.floor(v / 4), lu = fm(u, 4), lv = fm(v, 4);
    const k = hf(d.seed, bu, bv, 59);
    if (k < 0.12 && lu === 1 && (lv === 1 || lv === 2)) return { t: 'forklift', a: lv === 1, fu: 0, fv: 1, solid: true, tall: true };
    if (lu === 3 || lv === 3) return null;
    if (k < 0.3) return { t: 'pallets', a: true, solid: true };
    if (k < 0.45) return { t: 'wrapped', a: true, solid: true, tall: true };
    if (k < 0.55) return { t: 'heap', a: true, solid: true };
    if (k < 0.6 && lu === 0 && lv === 0) return { t: 'cone', a: true, solid: true };
    return null;
  }
  if (zone === 4) {
    // mannequins waiting in rows to be shipped, on pallets
    if (fm(u, 4) === 2 && fm(v, 3) === 1) return { t: 'display', a: true, fu: 0, fv: h < 0.5 ? -1 : 1, solid: true, tall: true };
    if (fm(u, 4) === 0 && fm(v, 9) === 4 && h < 0.4) return { t: 'wrapped', a: true, solid: true, tall: true };
    return null;
  }
  // in the aisles between the racks: a pallet left out, a jack, a forklift parked
  const au = fm(u, 7);
  if ((au === 4 || au === 1) && h < 0.012) return { t: h < 0.006 ? 'wrapped' : 'pallets', a: true, solid: true, tall: h < 0.006 };
  if (au === 5 && h < 0.004) return { t: 'jack', a: true, fu: 0, fv: 1, solid: false };
  if (au === 6 && fm(v, 18) >= 4 && fm(v, 18) <= 5 && hf(d.seed, Math.floor(u / 7), Math.floor(v / 18), 60) < 0.08) return { t: 'forklift', a: fm(v, 18) === 4, fu: 0, fv: 1, solid: true, tall: true };
  return null;
}
function warehouse(d, u, y, v) {
  if (y < -1) return B.STONE;
  if (y > 10) return B.AIR;
  const zone = whZone(d, u, v);
  const lu = fm(u, 12), lv = fm(v, 12);
  const lampHere = zone !== 3 && hf(d.seed, Math.floor(u / 12), Math.floor(v / 12), 52) < 0.7;
  const site = y >= -1 ? whSite(d, u, v) : null;
  if (y === -1) {
    if (site && site[0] === 'lift' && Math.abs(site[1]) <= 1 && site[2] >= 1 && site[2] <= 3) return B.METAL_PLATE;
    return (fm(u, 7) === 1 || fm(u, 7) === 4) && (zone === 0 || zone === 3) ? B.PLASTIC_Y : B.CONCRETE;
  }
  if (y === 10) return B.METAL_PANEL;
  if (y === 9) {
    if (site && site[1] === 0 && site[2] === (site[0] === 'cage' ? 3 : -3) && site[0] !== 'dock') return B.PROP_LAMP;
    return lampHere && lu === 6 && lv === 6 ? B.PROP_LAMP : B.LIT_DARK;
  }
  const pool = lampHere && lu >= 3 && lu <= 9 && lv >= 3 && lv <= 9;
  const air = pool ? (lu >= 5 && lu <= 7 && lv >= 5 && lv <= 7 ? B.LIT_AIR : B.LIT_DIM) : B.LIT_DARK;
  if (site) {
    const [what, a, b] = site;
    if (what === 'dock') {
      // the loading dock: a thick wall with a shutter, and the light that leaks under it
      if (b >= 0) {
        if (b === 0 && a >= -2 && a <= 1 && y <= 3) return B.ROLLER;
        return b === 0 && y === 4 && a >= -2 && a <= 1 ? B.EMERGENCY : B.METAL_PANEL;
      }
      return b >= -4 && a >= -4 && a <= 3 && y <= 3 ? B.LIT_AIR : air;
    }
    if (what === 'fire') {
      // a fire door in a block wall, its sign lit
      if (b >= 0) {
        if (a === 0 && b === 0 && y <= 2) return y === 0 ? B.EXIT_DOOR : y === 1 ? B.EXIT_DOOR_TOP : B.EXIT_SIGN;
        return B.CINDER;
      }
      return y <= 4 && Math.abs(a) <= 3 ? B.LIT_DIM : air;
    }
    if (what === 'lift') {
      // the freight lift: a steel shaft, doors, a call button, the car inside
      if (b >= 0) {
        const edge = Math.abs(a) === 2 || b === 0 || b === 4;
        if (Math.abs(a) >= 3) return air;
        if (!edge) return y <= 2 ? B.LIT_DIM : y === 3 ? B.LIGHT_PANEL : B.METAL_PANEL;
        if (b === 0 && Math.abs(a) <= 1 && y <= 2) return B.ROLLER;
        if (b === 0 && a === 0 && y === 3) return B.EMERGENCY;
        if (b === 0 && a === 2 && y === 1) return B.LIFT_BTN;
        return B.METAL_PANEL;
      }
      return y <= 4 ? B.LIT_DIM : air;
    }
    if (what === 'cage') {
      // the maintenance cage: wire mesh, a bench with the bolt cutters, a lamp over it
      if (b >= 0 && b <= 6 && Math.abs(a) <= 3) {
        const edge = Math.abs(a) === 3 || b === 0 || b === 6;
        if (edge) return y <= 2 && !(b === 0 && (a === 0 || a === -1)) ? B.FENCE : (y === 9 ? B.LIT_DARK : B.LIT_AIR);
        if (b === 5 && (a === -1 || a === 0) && y === 0) return B.PROP;
        if (b === 5 && a === -1 && y === 1) return B.PICKUP;
        if (y === 9 && a === 0 && b === 3) return B.PROP_LAMP;
        return B.LIT_AIR;
      }
      return y <= 3 ? B.LIT_DIM : air;
    }
  }
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
      if (y === 0 && ou === 16 && ov === 10) return B.PICKUP;
      const fp = y <= 1 ? whFloorProp(d, u, v) : null;
      if (fp && fp.solid && (y === 0 || fp.tall)) return B.PROP;
      return B.LIT_AIR;
    }
    return air;
  }
  if (y <= 1) {
    const fp = whFloorProp(d, u, v);
    if (fp && fp.solid && (y === 0 || fp.tall)) return B.PROP;
    if (y === 0 && whBattery(d, u, v)) return B.PICKUP;
  }
  if (whRackAt(d, u, v) && y <= 5) return B.WH_RACK;
  return air;
}

const SPACES = { backrooms, poolrooms, hallway, library, warehouse };

// the pocket: the building without its door, and the space around it
export function pocketBlockAt(d, x, y, z) {
  const [u, v] = toLocal(d, x, z);
  const ly = y - d.F;
  if (inBuilding(u, v) && !(d.kind === 'poolrooms' && ly <= PR.CEIL) && !(d.kind === 'backrooms' && ly < -1)) {
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
