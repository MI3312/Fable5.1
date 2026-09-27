// Deterministic structures stamped into terrain: liminal dream architecture
// (poolrooms, backrooms, hallways, arches, stairways to nowhere) and NMS-style
// points of interest (monoliths, outposts, drop pods, sentinel pillars).
import { hash32, RNG } from '../core/rng.js';
import { B, IS_SOLID } from './blocks.js';
import { isPocketKind, frameOf, toWorld, inBuilding, buildingBlock, BU0, BU1, BV0, BV1, BLD_W, BLD_D } from './liminalGen.js';

export const REGION = 64;

export const STRUCTURE_INFO = {
  poolrooms: { name: 'Poolrooms', icon: '◇', liminal: true },
  backrooms: { name: 'The Backrooms', icon: '▦', liminal: true },
  hallway: { name: 'Endless Hallway', icon: '═', liminal: true },
  arches: { name: 'Reverie Arches', icon: '∩', liminal: true },
  stairs: { name: 'Stairway to Nowhere', icon: '⌂', liminal: true },
  watcher: { name: 'Watcher Shrine', icon: '◉', liminal: true },
  plastic_city: { name: 'Plastic City', icon: '▣', liminal: true },
  warehouse: { name: 'Abandoned Warehouse', icon: '▤', liminal: true },
  library: { name: 'The Endless Library', icon: '▥', liminal: true },
  monolith: { name: 'Ancient Monolith', icon: '▮', liminal: false },
  outpost: { name: 'Abandoned Outpost', icon: '⌂', liminal: false },
  pod: { name: 'Drop Pod', icon: '◈', liminal: false },
  sentinel: { name: 'Sentinel Pillar', icon: '▲', liminal: false },
  wreck: { name: 'Crashed Starship', icon: '✈', liminal: false },
  watchtower: { name: 'Ruined Watchtower', icon: '♜', liminal: false },
  observatory: { name: 'Old Observatory', icon: '◓', liminal: false },
  bones: { name: 'Giant Bones', icon: '☠', liminal: false },
  crystal_grove: { name: 'Crystal Grove', icon: '✦', liminal: false },
  henge: { name: 'Standing Stones', icon: '◯', liminal: false },
  mining_rig: { name: 'Abandoned Mining Rig', icon: '⛏', liminal: false },
};

// default palettes; each planet normally brings its own (params.structPalette)
const DEFAULT_LIMINAL = [['poolrooms', 3], ['backrooms', 3], ['hallway', 2], ['library', 2], ['arches', 2], ['stairs', 2], ['watcher', 1], ['plastic_city', 2], ['warehouse', 2]];
const DEFAULT_NMS = [['monolith', 2], ['outpost', 3], ['pod', 2], ['wreck', 1.2], ['watchtower', 1], ['henge', 0.8], ['observatory', 0.6]];

const SIZES = {
  poolrooms: () => [BLD_W, BLD_D], backrooms: () => [BLD_W, BLD_D], hallway: () => [BLD_W, BLD_D], library: () => [BLD_W, BLD_D], arches: () => [17, 17],
  stairs: () => [16, 6], watcher: () => [11, 11], plastic_city: () => [34, 34], warehouse: () => [BLD_W, BLD_D], monolith: () => [13, 13], outpost: () => [9, 9], pod: () => [5, 5], sentinel: () => [5, 5],
  wreck: () => [24, 14], watchtower: () => [9, 9], observatory: () => [15, 15], bones: () => [26, 15], crystal_grove: () => [15, 15], henge: () => [17, 17], mining_rig: () => [13, 13],
};

// Decide which structure (if any) lives in region (rx, rz)
export function planStructure(seed, params, terrain, rx, rz) {
  const h = hash32(seed, rx, rz, 4242);
  const rng = new RNG(h);
  const st = params.structures;
  const p = Math.min(0.85, st.liminal + st.nms);
  if (rng.next() > p) return null;
  let type;
  const pal = params.structPalette;
  if (rng.next() < st.liminal / (st.liminal + st.nms)) {
    type = rng.weighted(pal && pal.liminal.length ? pal.liminal : DEFAULT_LIMINAL);
  } else {
    const opts = (pal && pal.nms.length ? pal.nms : DEFAULT_NMS).slice();
    if (params.sentinels > 0) opts.push(['sentinel', 1.2]);
    type = rng.weighted(opts);
  }
  let [w, d] = SIZES[type]();
  // pocket buildings face any of four ways
  const rot = isPocketKind(type) ? rng.int(0, 3) : 0;
  if (rot & 1) [w, d] = [d, w];
  const margin = 4;
  const x = rx * REGION + margin + rng.int(0, Math.max(0, REGION - margin * 2 - w));
  const z = rz * REGION + margin + rng.int(0, Math.max(0, REGION - margin * 2 - d));
  const cx = x + (w >> 1), cz = z + (d >> 1);
  if (terrain.zoneAt) {
    const zc = terrain.zoneAt(cx, cz);
    if (zc.blend > 0.05) return null;
    const zs = [terrain.zoneAt(x, z), terrain.zoneAt(x + w, z), terrain.zoneAt(x, z + d), terrain.zoneAt(x + w, z + d)];
    if (zs.some((q) => q.blend > 0.05)) return null;
  }
  let ground = Math.round(terrain.heightAt(cx, cz));
  // Sample corners to settle on a sensible floor level
  const hs = [ground, terrain.heightAt(x, z), terrain.heightAt(x + w - 1, z), terrain.heightAt(x, z + d - 1), terrain.heightAt(x + w - 1, z + d - 1)];
  const avg = Math.round(hs.reduce((a, b) => a + b, 0) / hs.length);
  ground = avg;
  const sea = params.liquid ? params.seaLevel : -99;
  if (ground <= sea + 1) {
    if (['pod', 'monolith', 'sentinel', 'watcher', 'wreck', 'bones', 'crystal_grove', 'henge'].includes(type)) return null;
    ground = sea + 2;
  }
  if (ground > 112) return null;
  return { type, x, z, w, d, rot, y: ground + 1, seed: h, name: STRUCTURE_INFO[type].name, pocket: isPocketKind(type) };
}

export function stampStructures(ctx, wx0, wz0, gw) {
  const pad = 2;
  const rx0 = Math.floor((wx0 - pad) / REGION), rx1 = Math.floor((wx0 + gw + pad) / REGION);
  const rz0 = Math.floor((wz0 - pad) / REGION), rz1 = Math.floor((wz0 + gw + pad) / REGION);
  for (let rx = rx0; rx <= rx1; rx++) for (let rz = rz0; rz <= rz1; rz++) {
    const s = planStructure(ctx.seed, ctx.params, ctx.terrain, rx, rz);
    if (!s) continue;
    // bounding overlap test (with generous vertical-free margin)
    if (s.x + s.w + 6 < wx0 || s.x - 6 > wx0 + gw || s.z + s.d + 6 < wz0 || s.z - 6 > wz0 + gw) continue;
    STAMPERS[s.type](ctx, s, new RNG(s.seed ^ 0x5eed));
  }
}

// Lists structures around a world position (for the scanner / compass)
export function listStructures(seed, params, terrain, wx, wz, radius) {
  const out = [];
  const rx0 = Math.floor((wx - radius) / REGION), rx1 = Math.floor((wx + radius) / REGION);
  const rz0 = Math.floor((wz - radius) / REGION), rz1 = Math.floor((wz + radius) / REGION);
  for (let rx = rx0; rx <= rx1; rx++) for (let rz = rz0; rz <= rz1; rz++) {
    const s = planStructure(seed, params, terrain, rx, rz);
    if (!s) continue;
    const cx = s.x + s.w / 2, cz = s.z + s.d / 2;
    const dist = Math.hypot(cx - wx, cz - wz);
    if (dist <= radius) out.push({ ...s, cx, cz, dist, liminal: STRUCTURE_INFO[s.type].liminal });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

// ---------------- helpers ----------------
function foundation(ctx, x, y, z, block, depth = 10) {
  for (let yy = y; yy > y - depth; yy--) {
    const cur = ctx.get(x, yy, z);
    if (cur < 0) return;
    if (IS_SOLID[cur] && cur !== B.LEAVES) return;
    ctx.set(x, yy, z, block);
  }
}

function clearAbove(ctx, x, y, z, h, fill = B.AIR) {
  for (let yy = y; yy < y + h; yy++) ctx.set(x, yy, z, fill);
}

function box(ctx, x0, y0, z0, w, h, d, fn) {
  for (let y = y0; y < y0 + h; y++) for (let z = z0; z < z0 + d; z++) for (let x = x0; x < x0 + w; x++) {
    const id = fn(x - x0, y - y0, z - z0);
    if (id >= 0) ctx.set(x, y, z, id);
  }
}

// ---------------- stampers ----------------
// A pocket building: a small blank block with one door. The passage inside bends twice and ends in
// a wall - unless you are inside the pocket, where it keeps going (see liminalGen.js).
function pocketBuilding(ctx, s) {
  const d = frameOf(s);
  const F = s.y;
  for (let v = BV0 - 4; v <= BV1 + 1; v++) for (let u = BU0 - 1; u <= BU1 + 1; u++) {
    const [x, z] = toWorld(d, u, v);
    if (inBuilding(u, v)) {
      foundation(ctx, x, F - 2, z, B.STONE, 12);
      for (let y = -1; y <= 5; y++) ctx.set(x, F + y, z, buildingBlock(d, u, y, v, false));
      clearAbove(ctx, x, F + 6, z, 6);
    } else {
      // a clear apron all round, and a path up to the door
      if (v < 0 && u >= -1 && u <= 2) {
        foundation(ctx, x, F - 2, z, B.STONE, 8);
        ctx.set(x, F - 1, z, u === -1 || u === 2 ? B.GRAVEL : B.CONCRETE);
      }
      clearAbove(ctx, x, F, z, 7);
    }
  }
}

const STAMPERS = {
  backrooms: pocketBuilding, poolrooms: pocketBuilding, hallway: pocketBuilding, library: pocketBuilding, warehouse: pocketBuilding,

  arches(ctx, s, rng) {
    const { x: X, z: Z, w: W } = s;
    const F = s.y;
    const cx = X + (W >> 1), cz = Z + (W >> 1);
    const R = W >> 1;
    for (let z = Z; z < Z + W; z++) for (let x = X; x < X + W; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > R) continue;
      foundation(ctx, x, F - 2, z, B.STONE, 10);
      ctx.set(x, F - 1, z, d < 2 ? B.POOL_DEEP : B.CHECKER);
      clearAbove(ctx, x, F, z, 8);
    }
    ctx.set(cx, F - 1, cz, B.WATER); ctx.set(cx + 1, F - 1, cz, B.WATER); ctx.set(cx, F - 1, cz + 1, B.WATER); ctx.set(cx + 1, F - 1, cz + 1, B.WATER);
    const mat = rng.pick([B.MARBLE, B.DREAM_TILE, B.POOL_TILE]);
    const n = rng.int(3, 5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng.range(0, 0.4);
      const ax = Math.round(cx + Math.cos(a) * (R - 2)), az = Math.round(cz + Math.sin(a) * (R - 2));
      const facingX = Math.abs(Math.cos(a)) < 0.7;
      const hgt = rng.int(5, 7);
      for (let k = -2; k <= 2; k++) {
        const px = facingX ? ax + k : ax, pz = facingX ? az : az + k;
        if (Math.abs(k) === 2) for (let y = F; y < F + hgt; y++) ctx.set(px, y, pz, mat);
        ctx.set(px, F + hgt, pz, mat);
        if (k === 0) ctx.set(px, F + hgt + 1, pz, B.LAMP);
      }
    }
    // floating dream cubes
    for (let i = 0; i < 6; i++) {
      const fx = cx + rng.int(-R + 2, R - 2), fz = cz + rng.int(-R + 2, R - 2), fy = F + rng.int(9, 15);
      ctx.set(fx, fy, fz, rng.pick([B.DREAM_BLOCK, B.CLOUD, B.STARRY, B.DREAM_TILE]));
    }
    if (rng.chance(0.6)) ctx.set(cx + 3, F, cz - 3, B.CHEST);
  },

  stairs(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const mat = rng.pick([B.MARBLE, B.DREAM_TILE, B.CHECKER]);
    const N = 13;
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 2; k++) {
        const x = X + i, z = Z + 2 + k;
        for (let y = F - 3; y <= F + i; y++) {
          if (y === F + i) ctx.set(x, y, z, mat);
          else if (i % 4 === 0) ctx.set(x, y, z, B.MARBLE);
        }
        clearAbove(ctx, x, F + i + 1, z, 4);
      }
    }
    // door frame at the top
    const tx = X + N, ty = F + N;
    for (let k = -1; k <= 2; k++) {
      ctx.set(tx, ty - 1, Z + 1 + k, mat);
      for (let y = ty; y < ty + 4; y++) {
        const frame = k === -1 || k === 2 || y === ty + 3;
        ctx.set(tx, y, Z + 1 + k, frame ? B.DREAM_TILE : (y < ty + 2 ? B.DREAM_DOOR : B.STARRY));
      }
    }
    ctx.set(tx, ty + 4, Z + 2, B.LAMP);
    ctx.set(tx - 1, ty + 1, Z + 1, B.CHEST);
  },

  watcher(ctx, s, rng) {
    const { x: X, z: Z, w: W } = s;
    const F = s.y;
    const cx = X + (W >> 1), cz = Z + (W >> 1);
    for (let z = Z; z < Z + W; z++) for (let x = X; x < X + W; x++) {
      if (Math.hypot(x - cx, z - cz) > W / 2) continue;
      foundation(ctx, x, F - 2, z, B.STONE, 8);
      ctx.set(x, F - 1, z, (x + z) % 2 ? B.MARBLE : B.CHECKER);
      clearAbove(ctx, x, F, z, 10);
    }
    const H = rng.int(7, 10);
    for (let y = F; y < F + H; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const eye = y === F + H - 2 && (dx === 0 || dz === 0);
      ctx.set(cx + dx, y, cz + dz, eye ? B.EYE : B.MARBLE);
    }
    ctx.set(cx, F + H, cz, B.LAMP);
    ctx.set(cx + 3, F, cz, B.CHEST);
  },

  plastic_city(ctx, s, rng) {
    const { x: X, z: Z, w: W, d: D } = s;
    const F = s.y;
    const PL = [B.PLASTIC_R, B.PLASTIC_Y, B.PLASTIC_B, B.PLASTIC_W];
    // ground: concrete streets with painted dashes, cleared sky
    for (let z = Z; z < Z + D; z++) for (let x = X; x < X + W; x++) {
      foundation(ctx, x, F - 2, z, B.STONE, 10);
      const lx = x - X, lz = z - Z;
      const dash = ((lx % 12 === 11 || lx % 12 === 0) && lz % 3 === 0) || ((lz % 12 === 11 || lz % 12 === 0) && lx % 3 === 0);
      ctx.set(x, F - 1, z, dash ? B.PLASTIC_Y : B.CONCRETE);
      clearAbove(ctx, x, F, z, 18);
    }
    // 3x3 lots
    for (let gz = 0; gz < 3; gz++) for (let gx = 0; gx < 3; gx++) {
      const lot = rng.next();
      const bx = X + 1 + gx * 12, bz = Z + 1 + gz * 12;
      if (lot < 0.15) { // tiny plaza with a lamp and a strange sphere
        ctx.set(bx + 4, F, bz + 4, B.MARBLE); ctx.set(bx + 4, F + 1, bz + 4, B.LAMP);
        const col = rng.pick(PL);
        for (let dy = 0; dy < 3; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dz) + Math.abs(dy - 1) <= 2) ctx.set(bx + 7 + dx, F + dy, bz + 7 + dz, col);
        }
        continue;
      }
      const w = rng.int(6, 9), d = rng.int(6, 9), h = rng.int(4, 12);
      const wall = rng.pick(PL), trim = rng.pick(PL);
      const door = rng.int(0, 3);
      for (let y = F; y < F + h; y++) for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) {
        const edge = dx === 0 || dz === 0 || dx === w - 1 || dz === d - 1;
        const top = y === F + h - 1;
        let id = B.LIT_AIR;
        if (top) id = (dx % 3 === 1 && dz % 3 === 1) ? B.LIGHT_PANEL : trim;
        else if (edge) {
          id = wall;
          const along = (dx === 0 || dx === w - 1) ? dz : dx;
          if ((y - F) % 3 === 1 && along % 2 === 1 && along > 0 && along < Math.max(w, d) - 1) id = B.GLASS;
          const isDoor = (door === 0 && dz === 0 && (dx === 2 || dx === 3)) || (door === 1 && dz === d - 1 && (dx === 2 || dx === 3)) ||
            (door === 2 && dx === 0 && (dz === 2 || dz === 3)) || (door === 3 && dx === w - 1 && (dz === 2 || dz === 3));
          if (isDoor && y < F + 2) id = B.LIT_AIR;
        }
        ctx.set(bx + dx, y, bz + dz, id);
      }
      if (rng.chance(0.35)) ctx.set(bx + 1, F, bz + 1, B.CHEST);
      if (rng.chance(0.2)) { ctx.set(bx + w - 2, F, bz + d - 2, B.DREAM_DOOR); ctx.set(bx + w - 2, F + 1, bz + d - 2, B.DREAM_DOOR); }
    }
    // street lamps
    for (const lx of [11, 23]) for (const lz of [5, 17, 29]) {
      ctx.set(X + lx, F, Z + lz, B.PLASTIC_W); ctx.set(X + lx, F + 1, Z + lz, B.PLASTIC_W); ctx.set(X + lx, F + 2, Z + lz, B.LAMP);
    }
  },


  monolith(ctx, s, rng) {
    const { x: X, z: Z, w: W } = s;
    const F = s.y;
    const cx = X + (W >> 1), cz = Z + (W >> 1);
    for (let z = Z; z < Z + W; z++) for (let x = X; x < X + W; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > W / 2) continue;
      foundation(ctx, x, F - 2, z, B.STONE, 8);
      ctx.set(x, F - 1, z, d < 3.5 ? B.OBSIDIAN : B.MARBLE);
      clearAbove(ctx, x, F, z, 10);
    }
    const H = rng.int(6, 8);
    for (let y = F; y < F + H; y++) for (let dz = 0; dz <= 1; dz++) for (let dx = 0; dx <= 1; dx++) {
      ctx.set(cx + dx, y, cz + dz, B.MONOLITH);
    }
    for (const [dx, dz] of [[-4, -4], [5, -4], [-4, 5], [5, 5]]) {
      ctx.set(cx + dx, F, cz + dz, B.MARBLE);
      ctx.set(cx + dx, F + 1, cz + dz, B.LAMP);
    }
  },

  outpost(ctx, s, rng) {
    const { x: X, z: Z, w: W, d: D } = s;
    const F = s.y;
    const H = 5;
    const door = rng.int(0, 3);
    for (let z = Z - 1; z <= Z + D; z++) for (let x = X - 1; x <= X + W; x++) {
      const out = x < X || z < Z || x >= X + W || z >= Z + D;
      foundation(ctx, x, F - 1, z, B.STONE, 10);
      ctx.set(x, F - 1, z, out ? B.GRAVEL : B.METAL_PLATE);
      if (out) { clearAbove(ctx, x, F, z, 5); continue; }
      const lx = x - X, lz = z - Z;
      const wall = lx === 0 || lz === 0 || lx === W - 1 || lz === D - 1;
      for (let y = F; y < F + H - 1; y++) {
        let id = wall ? B.METAL_PANEL : B.LIT_AIR;
        if (wall && y === F + 2 && (lx === 4 || lz === 4) && !(lx === 0 && lz === 0)) id = B.GLASS;
        const isDoor = (door === 0 && lz === 0 && lx === 4) || (door === 1 && lz === D - 1 && lx === 4) || (door === 2 && lx === 0 && lz === 4) || (door === 3 && lx === W - 1 && lz === 4);
        if (isDoor && y < F + 2) id = B.LIT_AIR;
        ctx.set(x, y, z, id);
      }
      ctx.set(x, F + H - 1, z, (lx === 4 && lz === 4) ? B.LIGHT_PANEL : B.METAL_PLATE);
      clearAbove(ctx, x, F + H, z, 3);
    }
    const tx = door === 0 ? X + 4 : door === 1 ? X + 4 : door === 2 ? X + W - 2 : X + 1;
    const tz = door === 0 ? Z + D - 2 : door === 1 ? Z + 1 : Z + 4;
    ctx.set(tx, F, tz, B.TERMINAL);
    ctx.set(X + 1 + (door === 3 ? 6 : 0), F, Z + 1 + (door === 1 ? 6 : 0), B.CHEST);
    // antenna
    for (let y = F + H; y < F + H + 4; y++) ctx.set(X + 1, y, Z + D - 2, B.METAL_PANEL);
    ctx.set(X + 1, F + H + 4, Z + D - 2, B.LAMP);
  },

  pod(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const cx = X + 2, cz = Z + 2;
    for (let z = Z; z < Z + 5; z++) for (let x = X; x < X + 5; x++) {
      if (Math.hypot(x - cx, z - cz) > 2.6) continue;
      ctx.set(x, F - 1, z, rng.chance(0.5) ? B.ASH : B.GRAVEL);
      clearAbove(ctx, x, F, z, 3);
    }
    ctx.set(cx, F, cz, B.POD);
    ctx.set(cx + 1, F, cz, B.METAL_PANEL);
    ctx.set(cx - 1, F, cz + 1, B.METAL_PANEL);
    ctx.set(cx, F + 1, cz, B.LAMP);
  },

  sentinel(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const cx = X + 2, cz = Z + 2;
    for (let z = Z; z < Z + 5; z++) for (let x = X; x < X + 5; x++) {
      foundation(ctx, x, F - 1, z, B.STONE, 8);
      ctx.set(x, F - 1, z, B.METAL_PANEL);
      clearAbove(ctx, x, F, z, 12);
    }
    const H = rng.int(8, 12);
    for (let y = F; y < F + H; y++) ctx.set(cx, y, cz, B.SENTINEL_PILLAR);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      ctx.set(cx + dx, F, cz + dz, B.METAL_PANEL);
      if (dx || dz) ctx.set(cx + dx, F + (H >> 1), cz + dz, B.METAL_PLATE);
    }
    ctx.set(cx, F + H, cz, B.LAMP);
  },

  // a starship that came down hard: a scorched furrow, the broken hull at the end of it, a wing
  // torn off and lying on its own, a beacon still calling, and salvage inside
  wreck(ctx, s, rng) {
    const { x: X, z: Z, w: W, d: D } = s;
    const F = s.y;
    const flip = rng.chance(0.5);
    const put = (lx, y, lz, id) => ctx.set(X + (flip ? W - 1 - lx : lx), y, Z + lz, id);
    const L = W, M = D;
    const cz = M >> 1;
    // the furrow
    for (let lx = 0; lx < L - 8; lx++) {
      const half = 1 + Math.floor(lx / (L - 8) * 2.5);
      for (let dz = -half; dz <= half; dz++) {
        put(lx, F - 1, cz + dz, rng.chance(0.55) ? B.ASH : B.GRAVEL);
        for (let y = F; y < F + 6; y++) put(lx, y, cz + dz, B.AIR);
      }
      if (rng.chance(0.18)) put(lx, F, cz + rng.int(-half, half), rng.chance(0.5) ? B.METAL_PLATE : B.GRATE);
    }
    // the hull: a hollow, holed shell, nose down in the dirt
    const hx = L - 6, hy = F + 1;
    for (let lx = L - 12; lx < L; lx++) for (let lz = cz - 3; lz <= cz + 3; lz++) for (let y = F - 1; y <= F + 4; y++) {
      const tilt = (lx - hx) * 0.22;
      const e = ((lx - hx) / 5.5) ** 2 + ((y - hy + tilt) / 2.1) ** 2 + ((lz - cz) / 2.3) ** 2;
      if (e > 1) continue;
      if (e > 0.5) { if (rng.chance(0.14)) continue; put(lx, y, lz, rng.chance(0.2) ? B.METAL_PANEL : B.HULL); }
      else put(lx, y, lz, B.LIT_AIR);
    }
    // a gash in the side to climb in through, and the salvage
    for (let y = F; y <= F + 1; y++) for (let lx = hx - 1; lx <= hx; lx++) put(lx, y, cz + 2, B.LIT_AIR), put(lx, y, cz + 3, B.AIR);
    put(hx, F, cz, B.CHEST);
    put(hx + 2, F, cz - 1, B.EMERGENCY);
    // one wing still on, one lying further back
    for (let lx = hx - 3; lx <= hx; lx++) for (let lz = cz - 7; lz <= cz - 3; lz++) if (!rng.chance(0.15)) put(lx, F + Math.floor((cz - 3 - lz) * 0.3), lz, B.METAL_PANEL);
    for (let lx = 4; lx <= 7; lx++) for (let lz = cz + 3; lz <= cz + 6; lz++) if (!rng.chance(0.2)) put(lx, F, lz, B.GRATE);
    // engines, burnt out
    for (const dz of [-1, 1]) { put(L - 12, F, cz + dz, B.OBSIDIAN); put(L - 12, F + 1, cz + dz, B.OBSIDIAN); }
    // the distress beacon, beside the hull, and a lamp on a pole
    put(hx - 3, F, cz + 3, B.WRECK_BEACON);
    put(hx - 3, F + 1, cz + 3, B.LAMP);
  },

  // a stone tower, falling apart from the top down, with a spiral of planks inside
  watchtower(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const x0 = X + 2, z0 = Z + 2, N = 5;
    const H = rng.int(12, 16);
    for (let z = Z; z < Z + 9; z++) for (let x = X; x < X + 9; x++) {
      foundation(ctx, x, F - 1, z, B.STONE, 8);
      ctx.set(x, F - 1, z, rng.chance(0.3) ? B.GRAVEL : B.STONE);
      clearAbove(ctx, x, F, z, H + 2);
    }
    const ring = [];
    for (let i = 1; i < N - 1; i++) ring.push([i, 1]);
    for (let i = 1; i < N - 1; i++) ring.push([N - 2, i]);
    for (let i = N - 2; i > 0; i--) ring.push([i, N - 2]);
    for (let i = N - 2; i > 0; i--) ring.push([1, i]);
    for (let y = F; y < F + H; y++) {
      const decay = (y - F) / H;
      for (let dz = 0; dz < N; dz++) for (let dx = 0; dx < N; dx++) {
        const wall = dx === 0 || dz === 0 || dx === N - 1 || dz === N - 1;
        if (!wall) continue;
        if (rng.chance(decay * decay * 0.8)) continue; // crumbling towards the top
        const window = (y - F) % 4 === 2 && (dx === 2 || dz === 2);
        const door = y < F + 2 && dz === 0 && dx === 2;
        if (window || door) continue;
        ctx.set(x0 + dx, y, z0 + dz, rng.chance(0.12) ? B.STONE : B.BRICK);
      }
      // the stair winds up the inside walls
      const k = (y - F) % ring.length;
      const [sx, sz] = ring[k];
      ctx.set(x0 + sx, y, z0 + sz, B.PLANKS);
    }
    // a lookout floor with something left on it
    for (let dz = 1; dz < N - 1; dz++) for (let dx = 1; dx < N - 1; dx++) if (!(dx === 1 && dz === 1)) ctx.set(x0 + dx, F + H - 3, z0 + dz, B.PLANKS);
    ctx.set(x0 + 2, F + H - 2, z0 + 2, B.CHEST);
    ctx.set(x0 + 3, F + H - 2, z0 + 3, B.LAMP);
    // rubble at the foot
    for (let i = 0; i < 10; i++) ctx.set(X + rng.int(0, 8), F, Z + rng.int(0, 8), B.BRICK);
    ctx.set(x0 + 2, F, z0 + 2, B.AIR);
  },

  // a marble drum under a glass dome, split open where the telescope looks out
  observatory(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const cx = X + 7, cz = Z + 7, R = 6;
    const face = rng.int(0, 3);
    for (let z = Z; z < Z + 15; z++) for (let x = X; x < X + 15; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > R + 1.2) continue;
      foundation(ctx, x, F - 1, z, B.MARBLE, 10);
      ctx.set(x, F - 1, z, d > R + 0.3 ? B.CONCRETE : ((x + z) & 1) ? B.MARBLE : B.CHECKER);
      clearAbove(ctx, x, F, z, R + 4);
      if (d > R - 0.5 && d <= R + 0.5) {
        const door = Math.abs(x - cx) <= 1 && z > cz;
        for (let y = F; y < F + 2; y++) if (!door) ctx.set(x, y, z, B.CONCRETE);
      }
    }
    // dome
    for (let z = Z; z < Z + 15; z++) for (let x = X; x < X + 15; x++) for (let y = F + 2; y <= F + 2 + R; y++) {
      const d = Math.hypot(x - cx, (y - F - 2) * 1.05, z - cz);
      if (d > R + 0.5 || d < R - 0.5) continue;
      const slit = face % 2 === 0 ? Math.abs(x - cx) <= 1 && (face === 0 ? z < cz : z > cz) : Math.abs(z - cz) <= 1 && (face === 1 ? x < cx : x > cx);
      if (slit && y > F + 3) continue;
      ctx.set(x, y, z, (y - F) % 3 === 0 ? B.METAL_PANEL : B.GLASS);
    }
    // the telescope: a pier and a tube angled out through the slit
    for (let y = F; y < F + 3; y++) ctx.set(cx, y, cz, B.METAL_PANEL);
    const dir = [[0, -1], [-1, 0], [0, 1], [1, 0]][face];
    for (let k = 0; k < 6; k++) ctx.set(cx + dir[0] * k, F + 3 + k, cz + dir[1] * k, B.METAL_PLATE);
    ctx.set(cx + dir[0] * 6, F + 9, cz + dir[1] * 6, B.GLASS);
    ctx.set(cx + 2, F, cz + 2, B.TERMINAL);
    ctx.set(cx - 2, F, cz + 2, B.LAMP);
    ctx.set(cx - 2, F, cz - 2, B.BOOKSHELF);
  },

  // a ribcage the size of a house, half sunk in the ground, and the skull at the end of it
  bones(ctx, s, rng) {
    const { x: X, z: Z, w: W, d: D } = s;
    const F = s.y - 1; // half buried
    const cz = Z + (D >> 1);
    const tail = X + 1, head = X + W - 6;
    for (let x = tail; x < head; x++) {
      const y = F + Math.round(Math.sin((x - tail) / (head - tail) * Math.PI) * 1.5);
      ctx.set(x, y, cz, B.MARBLE);
      if ((x - tail) % 3 === 1) ctx.set(x, y + 1, cz, B.MARBLE);
      // ribs arch over the spine
      if ((x - tail) % 3 === 0 && x > tail + 2 && x < head - 1) {
        const R = 3 + Math.round(Math.sin((x - tail) / (head - tail) * Math.PI) * 3);
        const broken = rng.chance(0.3) ? rng.next() : 2;
        for (let a = 0; a <= Math.PI; a += 0.12) {
          if (a / Math.PI > broken) break;
          const zz = cz + Math.round(Math.cos(a) * R), yy = y + Math.round(Math.sin(a) * R * 0.95);
          ctx.set(x, yy, zz, B.MARBLE);
        }
      }
    }
    // the skull: a hollow block with two dark sockets and a long jaw
    const sx = head, sy = F, sz = cz - 2;
    for (let dx = 0; dx < 5; dx++) for (let dy = 0; dy < 4; dy++) for (let dz = 0; dz < 5; dz++) {
      const shell = dx === 0 || dx === 4 || dy === 0 || dy === 3 || dz === 0 || dz === 4;
      ctx.set(sx + dx, sy + dy, sz + dz, shell ? B.MARBLE : B.AIR);
    }
    ctx.set(sx + 4, sy + 2, sz + 1, B.ONYX); ctx.set(sx + 4, sy + 2, sz + 3, B.ONYX);
    for (let dx = 5; dx < 8; dx++) for (let dz = 1; dz < 4; dz++) ctx.set(sx + dx, sy, sz + dz, B.MARBLE);
    ctx.set(sx + 2, sy + 1, sz + 2, B.CHEST);
    ctx.set(sx + 4, sy + 1, sz + 2, B.AIR);
  },

  // spires of crystal, some leaning, over a floor of ore
  crystal_grove(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const cx = X + 7, cz = Z + 7;
    const ores = [B.COBALT_ORE, B.COPPER_ORE, B.GOLD_ORE, B.FERRITE_ORE].filter((q) => q != null);
    for (let z = Z; z < Z + 15; z++) for (let x = X; x < X + 15; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > 7) continue;
      if (rng.chance(0.35 * (1 - d / 8))) ctx.set(x, F - 1, z, rng.pick(ores));
    }
    const n = rng.int(7, 12);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * Math.PI * 2, r = rng.next() * 5.5;
      let x = cx + Math.round(Math.cos(a) * r), z = cz + Math.round(Math.sin(a) * r);
      const h = rng.int(3, i === 0 ? 11 : 8);
      const lx = rng.range(-0.3, 0.3), lz = rng.range(-0.3, 0.3);
      const thick = i < 2;
      for (let k = 0; k < h; k++) {
        const px = x + Math.round(lx * k), pz = z + Math.round(lz * k);
        ctx.set(px, F + k, pz, B.CRYSTAL);
        if (thick && k < h - 2) { ctx.set(px + 1, F + k, pz, B.CRYSTAL); ctx.set(px, F + k, pz + 1, B.CRYSTAL); }
      }
    }
  },

  // a ring of standing stones, some still capped, around an altar
  henge(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const cx = X + 8, cz = Z + 8, R = 6.5;
    for (let z = Z; z < Z + 17; z++) for (let x = X; x < X + 17; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > R + 1.5) continue;
      if (d < R - 1) { ctx.set(x, F - 1, z, B.GRAVEL); clearAbove(ctx, x, F, z, 7); }
    }
    const n = rng.int(8, 11);
    const stone = rng.chance(0.5) ? B.STONE : B.OBSIDIAN;
    const tops = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.round(Math.cos(a) * R), z = cz + Math.round(Math.sin(a) * R);
      if (rng.chance(0.12)) { ctx.set(x, F, z, stone); continue; } // fallen
      const h = rng.int(3, 5);
      foundation(ctx, x, F - 1, z, stone, 6);
      for (let y = F; y < F + h; y++) ctx.set(x, y, z, stone);
      tops.push([x, z, F + h]);
    }
    for (let i = 0; i + 1 < tops.length; i += 2) {
      const [x1, z1, y1] = tops[i], [x2, z2, y2] = tops[i + 1];
      if (Math.hypot(x2 - x1, z2 - z1) > 5 || !rng.chance(0.6)) continue;
      const y = Math.min(y1, y2);
      const steps = Math.max(Math.abs(x2 - x1), Math.abs(z2 - z1));
      for (let k = 0; k <= steps; k++) ctx.set(Math.round(x1 + (x2 - x1) * k / steps), y, Math.round(z1 + (z2 - z1) * k / steps), stone);
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) ctx.set(cx + dx, F, cz + dz, B.MARBLE);
    ctx.set(cx, F + 1, cz, B.CHEST);
    ctx.set(cx + 1, F + 1, cz + 1, B.LAMP);
  },

  // a lattice tower over a pit, the drill still hanging in it
  mining_rig(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const x0 = X + 4, z0 = Z + 4, N = 5, H = rng.int(10, 14);
    const cx = x0 + 2, cz = z0 + 2;
    for (let z = Z; z < Z + 13; z++) for (let x = X; x < X + 13; x++) {
      foundation(ctx, x, F - 1, z, B.STONE, 8);
      ctx.set(x, F - 1, z, rng.chance(0.5) ? B.GRAVEL : B.CONCRETE);
      clearAbove(ctx, x, F, z, H + 3);
    }
    // the pit, ore in its walls
    const ores = [B.COPPER_ORE, B.FERRITE_ORE, B.GOLD_ORE, B.URANIUM_ORE].filter((q) => q != null);
    for (let y = F - 7; y < F; y++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) ctx.set(cx + dx, y, cz + dz, B.AIR);
    for (let y = F - 7; y < F; y++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
      if (rng.chance(0.3)) ctx.set(cx + dx, y, cz + dz, rng.pick(ores));
    }
    // the frame
    for (let y = F; y < F + H; y++) for (const [dx, dz] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]]) ctx.set(x0 + dx, y, z0 + dz, B.METAL_PANEL);
    for (const py of [F + 4, F + 8, F + H - 1]) for (let dz = 0; dz < N; dz++) for (let dx = 0; dx < N; dx++) {
      if (py < F + H - 1 && dx > 0 && dx < N - 1 && dz > 0 && dz < N - 1) continue; // walkways round the edge
      ctx.set(x0 + dx, py, z0 + dz, B.GRATE);
    }
    for (let y = F - 5; y < F + H - 1; y++) ctx.set(cx, y, cz, B.METAL_PLATE); // the drill string
    // a crane arm and lights
    for (let k = 1; k < 5; k++) ctx.set(x0 + N - 1 + k, F + H - 1, z0 + 2, B.METAL_PANEL);
    for (const [dx, dz] of [[0, 0], [N - 1, N - 1]]) ctx.set(x0 + dx, F + H, z0 + dz, B.EMERGENCY);
    ctx.set(x0 + 1, F + 5, z0 + 1, B.CHEST);
    ctx.set(X + 1, F, Z + 11, B.PLANKS); ctx.set(X + 2, F, Z + 11, B.PLANKS); ctx.set(X + 1, F + 1, Z + 11, B.PLANKS);
  },
};
