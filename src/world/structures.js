// Deterministic structures stamped into terrain: liminal dream architecture
// (poolrooms, backrooms, hallways, arches, stairways to nowhere) and NMS-style
// points of interest (monoliths, outposts, drop pods, sentinel pillars).
import { hash32, RNG } from '../core/rng.js';
import { B, IS_SOLID } from './blocks.js';

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
  monolith: { name: 'Ancient Monolith', icon: '▮', liminal: false },
  outpost: { name: 'Abandoned Outpost', icon: '⌂', liminal: false },
  pod: { name: 'Drop Pod', icon: '◈', liminal: false },
  sentinel: { name: 'Sentinel Pillar', icon: '▲', liminal: false },
};

const SIZES = {
  poolrooms: () => [0, 0], backrooms: () => [25, 25], hallway: () => [0, 0], arches: () => [17, 17],
  stairs: () => [16, 6], watcher: () => [11, 11], plastic_city: () => [34, 34], warehouse: () => [30, 22], monolith: () => [13, 13], outpost: () => [9, 9], pod: () => [5, 5], sentinel: () => [5, 5],
};

// Decide which structure (if any) lives in region (rx, rz)
export function planStructure(seed, params, terrain, rx, rz) {
  const h = hash32(seed, rx, rz, 4242);
  const rng = new RNG(h);
  const st = params.structures;
  const p = Math.min(0.85, st.liminal + st.nms);
  if (rng.next() > p) return null;
  let type;
  if (rng.next() < st.liminal / (st.liminal + st.nms)) {
    type = rng.weighted([['poolrooms', 3], ['backrooms', 3], ['hallway', 2], ['arches', 2], ['stairs', 2], ['watcher', 1], ['plastic_city', 2], ['warehouse', 2]]);
  } else {
    const opts = [['monolith', 2], ['outpost', 3], ['pod', 2]];
    if (params.sentinels > 0) opts.push(['sentinel', 1.2]);
    type = rng.weighted(opts);
  }
  let [w, d] = SIZES[type]();
  if (type === 'poolrooms') { w = rng.int(17, 27); d = rng.int(17, 27); }
  if (type === 'hallway') {
    if (rng.chance(0.5)) { w = rng.int(30, 48); d = 5; } else { w = 5; d = rng.int(30, 48); }
  }
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
    if (type === 'pod' || type === 'monolith' || type === 'sentinel' || type === 'watcher') return null;
    ground = sea + 2;
  }
  if (ground > 112) return null;
  return { type, x, z, w, d, y: ground + 1, seed: h, name: STRUCTURE_INFO[type].name };
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
const STAMPERS = {
  poolrooms(ctx, s, rng) {
    const { x: X, z: Z, w: W, d: D } = s;
    const F = s.y; // floor level (air starts here)
    const H = rng.int(6, 8);
    const ceiling = rng.chance(0.7);
    const wallTile = rng.chance(0.8) ? B.POOL_TILE : B.DREAM_TILE;
    // pools
    const pools = [];
    const np = rng.int(1, 3);
    for (let i = 0; i < np; i++) {
      const pw = rng.int(4, Math.max(5, W - 8)), pd = rng.int(4, Math.max(5, D - 8));
      const px = X + rng.int(2, Math.max(2, W - pw - 2)), pz = Z + rng.int(2, Math.max(2, D - pd - 2));
      pools.push([px, pz, pw, pd, rng.int(1, 3)]);
    }
    const inPool = (x, z) => {
      for (const p of pools) if (x >= p[0] && x < p[0] + p[2] && z >= p[1] && z < p[1] + p[3]) return p[4];
      return 0;
    };
    const pillarStep = rng.int(5, 7);
    const doorAxis = rng.int(0, 3);
    for (let z = Z - 1; z <= Z + D; z++) for (let x = X - 1; x <= X + W; x++) {
      const edge = x === X - 1 || z === Z - 1 || x === X + W || z === Z + D;
      if (edge) { // walkway ring around outside
        foundation(ctx, x, F - 1, z, B.STONE, 12);
        ctx.set(x, F - 1, z, wallTile);
        clearAbove(ctx, x, F, z, 4, B.AIR);
        continue;
      }
      const wall = x === X || z === Z || x === X + W - 1 || z === Z + D - 1;
      foundation(ctx, x, F - 2, z, B.STONE, 12);
      const depth = inPool(x, z);
      if (depth && !wall) {
        for (let k = 1; k <= depth; k++) ctx.set(x, F - k, z, B.WATER);
        ctx.set(x, F - depth - 1, z, B.POOL_DEEP);
      } else {
        ctx.set(x, F - 1, z, wallTile);
      }
      for (let y = F; y < F + H - 1; y++) {
        let id = B.LIT_AIR;
        if (wall) {
          id = wallTile;
          // doorways in middle of each wall
          const mx = X + (W >> 1), mz = Z + (D >> 1);
          const isDoorX = (z === Z || z === Z + D - 1) && Math.abs(x - mx) <= 1;
          const isDoorZ = (x === X || x === X + W - 1) && Math.abs(z - mz) <= 1;
          const arch = (isDoorX && y < F + 3 + (Math.abs(x - mx) === 0 ? 1 : 0)) || (isDoorZ && y < F + 3 + (Math.abs(z - mz) === 0 ? 1 : 0));
          if (arch && (doorAxis !== 0 || isDoorX)) id = B.LIT_AIR;
          // windows band
          if (!arch && y === F + 2 && ((x + z) % 4 === 0) && ceiling) id = B.GLASS;
        } else if (((x - X) % pillarStep === 0) && ((z - Z) % pillarStep === 0) && !depth) {
          id = wallTile;
        }
        ctx.set(x, y, z, id);
      }
      if (ceiling) {
        const lamp = ((x - X) % 4 === 2) && ((z - Z) % 4 === 2);
        ctx.set(x, F + H - 1, z, lamp ? B.LIGHT_PANEL : wallTile);
        clearAbove(ctx, x, F + H, z, 3, B.AIR);
      } else {
        const post = wall && ((x - X) % 4 === 0 || (z - Z) % 4 === 0);
        if (wall) { for (let y = F + 2; y < F + H - 1; y++) ctx.set(x, y, z, post ? wallTile : B.AIR); }
        if (wall && post) ctx.set(x, F + 2, z, B.LAMP);
        clearAbove(ctx, x, F + H - 1, z, 4, B.AIR);
      }
    }
    // a lone door standing in the room, leading somewhere else
    if (rng.chance(0.6)) {
      const lx = X + rng.int(3, W - 4), lz = Z + rng.int(3, D - 4);
      if (!inPool(lx, lz)) { ctx.set(lx, F, lz, B.DREAM_DOOR); ctx.set(lx, F + 1, lz, B.DREAM_DOOR); ctx.set(lx, F + 2, lz, wallTile); }
    }
    // loot
    ctx.set(X + 2, F, Z + 2, B.CHEST);
    if (rng.chance(0.5)) ctx.set(X + W - 3, F, Z + D - 3, B.CHEST);
    // strange floating tile cube over the pool
    if (rng.chance(0.4) && pools.length) {
      const p = pools[0];
      ctx.set(p[0] + (p[2] >> 1), F + 1, p[1] + (p[3] >> 1), B.EYE);
    }
  },

  backrooms(ctx, s, rng) {
    const { x: X, z: Z } = s;
    const F = s.y;
    const NC = 6, CELL = 4, W = NC * CELL + 1;
    // maze via DFS
    const vis = new Uint8Array(NC * NC);
    const walls = { h: new Uint8Array((NC + 1) * NC).fill(1), v: new Uint8Array(NC * (NC + 1)).fill(1) };
    // h[x + NC*z]: wall on north side of cell (x,z) at line z;   v[x + (NC+1)*z]: wall on west side at line x
    const stack = [[rng.int(0, NC - 1), rng.int(0, NC - 1)]];
    vis[stack[0][0] + NC * stack[0][1]] = 1;
    while (stack.length) {
      const [cx, cz] = stack[stack.length - 1];
      const n = [];
      if (cx > 0 && !vis[cx - 1 + NC * cz]) n.push([cx - 1, cz, 'w']);
      if (cx < NC - 1 && !vis[cx + 1 + NC * cz]) n.push([cx + 1, cz, 'e']);
      if (cz > 0 && !vis[cx + NC * (cz - 1)]) n.push([cx, cz - 1, 'n']);
      if (cz < NC - 1 && !vis[cx + NC * (cz + 1)]) n.push([cx, cz + 1, 's']);
      if (!n.length) { stack.pop(); continue; }
      const [nx, nz, dir] = rng.pick(n);
      if (dir === 'w') walls.v[cx + (NC + 1) * cz] = 0;
      if (dir === 'e') walls.v[cx + 1 + (NC + 1) * cz] = 0;
      if (dir === 'n') walls.h[cx + NC * cz] = 0;
      if (dir === 's') walls.h[cx + NC * (cz + 1)] = 0;
      vis[nx + NC * nz] = 1;
      stack.push([nx, nz]);
    }
    // knock out extra walls for open liminal rooms
    for (let i = 0; i < 14; i++) {
      const a = rng.int(1, NC - 1), b = rng.int(0, NC - 1);
      if (rng.chance(0.5)) walls.v[a + (NC + 1) * b] = 0; else walls.h[b + NC * a] = 0;
    }
    // entrances
    walls.v[0 + (NC + 1) * rng.int(0, NC - 1)] = 0;
    walls.v[NC + (NC + 1) * rng.int(0, NC - 1)] = 0;
    const isWall = (lx, lz) => {
      const onX = lx % CELL === 0, onZ = lz % CELL === 0;
      if (onX && onZ) return true; // corner posts
      if (onX) { const gx = lx / CELL, gz = Math.floor(lz / CELL); return walls.v[gx + (NC + 1) * gz] === 1; }
      if (onZ) { const gz = lz / CELL, gx = Math.floor(lx / CELL); return walls.h[gx + NC * gz] === 1; }
      return false;
    };
    const H = 5;
    for (let lz = -1; lz <= W; lz++) for (let lx = -1; lx <= W; lx++) {
      const x = X + lx, z = Z + lz;
      if (lx < 0 || lz < 0 || lx >= W || lz >= W) {
        foundation(ctx, x, F - 1, z, B.STONE, 10);
        ctx.set(x, F - 1, z, B.CARPET);
        clearAbove(ctx, x, F, z, 4);
        continue;
      }
      foundation(ctx, x, F - 2, z, B.STONE, 12);
      ctx.set(x, F - 1, z, B.CARPET);
      const wall = isWall(lx, lz);
      const perim = lx === 0 || lz === 0 || lx === W - 1 || lz === W - 1;
      for (let y = F; y < F + H - 2; y++) ctx.set(x, y, z, wall ? B.WALLPAPER : B.LIT_AIR);
      const light = (lx % CELL === 2) && (lz % CELL === 2) && ((lx + lz) % 8 === 4 || rng.chance(0.4));
      ctx.set(x, F + H - 2, z, light ? B.LIGHT_PANEL : B.CEILING_TILE);
      ctx.set(x, F + H - 1, z, perim ? B.WALLPAPER : B.CEILING_TILE);
      clearAbove(ctx, x, F + H, z, 3);
    }
    // a dream door somewhere on an inner wall line
    {
      const gx = rng.int(1, NC - 1), gz = rng.int(0, NC - 1);
      const dx = X + gx * CELL, dz = Z + gz * CELL + 2;
      ctx.set(dx, F, dz, B.DREAM_DOOR); ctx.set(dx, F + 1, dz, B.DREAM_DOOR);
    }
    // chests in random cells
    for (let i = 0; i < 2; i++) {
      const cx = rng.int(0, NC - 1), cz = rng.int(0, NC - 1);
      ctx.set(X + cx * CELL + 2, F, Z + cz * CELL + 2, B.CHEST);
    }
  },

  hallway(ctx, s, rng) {
    const { x: X, z: Z, w: W, d: D } = s;
    const F = s.y;
    const alongX = W > D;
    const wallB = rng.pick([B.WALLPAPER, B.DREAM_TILE, B.MARBLE, B.POOL_TILE]);
    const floorB = rng.pick([B.CARPET, B.CHECKER, B.PLANKS, B.POOL_TILE]);
    const H = 5;
    for (let z = Z; z < Z + D; z++) for (let x = X; x < X + W; x++) {
      const across = alongX ? z - Z : x - X; // 0..4
      const along = alongX ? x - X : z - Z;
      const side = across === 0 || across === 4;
      foundation(ctx, x, F - 2, z, B.STONE, 14);
      ctx.set(x, F - 1, z, floorB);
      for (let y = F; y < F + H - 1; y++) {
        let id = side ? wallB : B.LIT_AIR;
        // doors to nowhere along the walls
        if (side && along % 6 === 3 && y < F + 3) id = (across === 4 && Math.abs(along - (alongX ? W : D) / 2) < 3 && y < F + 2) ? B.DREAM_DOOR : B.PLANKS;
        if (side && along % 6 === 3 && y === F + 1 && across === 0) id = B.LAMP;
        ctx.set(x, y, z, id);
      }
      const lamp = !side && across === 2 && along % 4 === 1;
      ctx.set(x, F + H - 1, z, lamp ? B.LIGHT_PANEL : (side ? wallB : B.CEILING_TILE));
      clearAbove(ctx, x, F + H, z, 3);
    }
    ctx.set(alongX ? X + (W >> 1) : X + 2, F, alongX ? Z + 2 : Z + (D >> 1), B.CHEST);
  },

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

  warehouse(ctx, s, rng) {
    const { x: X, z: Z, w: W, d: D } = s;
    const F = s.y;
    const H = 11;
    const doorSide = rng.chance(0.5) ? 0 : 1;
    for (let z = Z - 1; z <= Z + D; z++) for (let x = X - 1; x <= X + W; x++) {
      const out = x < X || z < Z || x >= X + W || z >= Z + D;
      foundation(ctx, x, F - 2, z, B.STONE, 12);
      ctx.set(x, F - 1, z, B.CONCRETE);
      if (out) { clearAbove(ctx, x, F, z, 6); continue; }
      const lx = x - X, lz = z - Z;
      const wall = lx === 0 || lz === 0 || lx === W - 1 || lz === D - 1;
      for (let y = F; y < F + H - 1; y++) {
        let id = B.LIT_AIR;
        if (wall) {
          id = y >= F + H - 4 && y < F + H - 2 && (lx + lz) % 4 !== 0 ? B.GLASS : B.METAL_PANEL;
          const doorway = (doorSide === 0 ? lx === 0 : lx === W - 1) && lz >= D / 2 - 3 && lz <= D / 2 + 2 && y < F + 6;
          if (doorway) id = B.LIT_AIR;
        } else {
          // shelving rows running along x, aisles every 5 blocks
          const row = lz % 5 === 2 && lz > 1 && lz < D - 2;
          const inRow = lx > 3 && lx < W - 4 && lx !== Math.floor(W / 2);
          if (row && inRow && y < F + 4) id = B.SHELF;
          if (!row && lz % 5 === 0 && lx % 7 === 3 && y < F + 1 + ((lx + lz) % 3)) id = B.PLANKS;
        }
        ctx.set(x, y, z, id);
      }
      ctx.set(x, F + H - 1, z, (lz % 5 === 0 && lx % 3 === 1) ? B.LIGHT_PANEL : B.CONCRETE);
      clearAbove(ctx, x, F + H, z, 3);
    }
    ctx.set(X + W - 3, F, Z + 2, B.CHEST);
    ctx.set(X + 2, F, Z + D - 3, B.CHEST);
    if (rng.chance(0.5)) {
      const dx = doorSide === 0 ? X + W - 2 : X + 1;
      ctx.set(dx, F, Z + Math.floor(D / 2), B.DREAM_DOOR); ctx.set(dx, F + 1, Z + Math.floor(D / 2), B.DREAM_DOOR);
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
};
