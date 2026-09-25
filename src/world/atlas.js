// Procedurally painted block textures, packed into a WebGL2 texture array.
// Alpha channel encodes: 255 = tinted by planet palette, ~200 = untinted, 0 = transparent (cutout).
import * as THREE from 'three';
import { TILE, BLOCKS, B } from './blocks.js';
import { RNG } from '../core/rng.js';

export const TILE_SIZE = 16;
const S = TILE_SIZE;
const UNT = 200; // alpha for untinted opaque pixels

class Tile {
  constructor(seed) {
    this.d = new Uint8ClampedArray(S * S * 4);
    this.rng = new RNG(seed * 7919 + 13);
  }
  set(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    this.d[i] = r * 255; this.d[i + 1] = g * 255; this.d[i + 2] = b * 255; this.d[i + 3] = a;
  }
  get(x, y) {
    const i = (((y + S) % S) * S + ((x + S) % S)) * 4;
    return [this.d[i] / 255, this.d[i + 1] / 255, this.d[i + 2] / 255, this.d[i + 3]];
  }
  fill(fn) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const c = fn(x, y, this.rng);
      if (c) this.set(x, y, c[0], c[1], c[2], c[3] ?? 255);
    }
    return this;
  }
  noise(base, v, a = 255) {
    return this.fill((x, y, r) => {
      const n = (r.next() - 0.5) * v;
      return [base[0] + n, base[1] + n, base[2] + n, a];
    });
  }
  speckle(color, p, a = UNT) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (this.rng.next() < p) {
        const n = (this.rng.next() - 0.5) * 0.15;
        this.set(x, y, color[0] + n, color[1] + n, color[2] + n, a);
      }
    }
    return this;
  }
  blobs(color, count, rmin, rmax, a = UNT, glow = 0) {
    for (let i = 0; i < count; i++) {
      const cx = this.rng.range(1, S - 1), cy = this.rng.range(1, S - 1);
      const rad = this.rng.range(rmin, rmax);
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        const dd = Math.hypot(x - cx, y - cy);
        if (dd <= rad) {
          const k = 1 - dd / (rad + 0.5) * 0.35 + glow;
          const n = (this.rng.next() - 0.5) * 0.12;
          this.set(x, y, color[0] * k + n, color[1] * k + n, color[2] * k + n, a);
        }
      }
    }
    return this;
  }
  border(color, a = UNT, width = 1) {
    for (let i = 0; i < S; i++) for (let w = 0; w < width; w++) {
      this.set(i, w, ...color, a); this.set(i, S - 1 - w, ...color, a);
      this.set(w, i, ...color, a); this.set(S - 1 - w, i, ...color, a);
    }
    return this;
  }
}

function gray(v) { return [v, v, v]; }

function paintTiles() {
  const tiles = [];
  const t = (name, fn) => {
    const tile = new Tile(TILE[name] + 1);
    fn(tile, tile.rng);
    tiles[TILE[name]] = tile;
  };

  t('stone', (p) => {
    p.noise(gray(0.82), 0.16);
    for (let i = 0; i < 5; i++) {
      let x = p.rng.int(0, 15), y = p.rng.int(0, 15);
      for (let k = 0; k < 5; k++) { p.set(x, y, 0.62, 0.62, 0.62); x += p.rng.int(-1, 1); y += p.rng.int(0, 1); }
    }
    p.fill((x, y) => { const c = p.get(x, y); if ((x + y * 3) % 7 === 0) return [c[0] + 0.06, c[1] + 0.06, c[2] + 0.06]; return null; });
  });
  t('dirt', (p) => { p.noise(gray(0.85), 0.2); p.speckle(gray(0.62), 0.12, 255); p.speckle(gray(1.0), 0.05, 255); });
  t('grass_top', (p) => {
    p.noise(gray(0.88), 0.18);
    p.speckle(gray(1.0), 0.1, 255); p.speckle(gray(0.7), 0.1, 255);
  });
  t('grass_side', (p) => {
    p.fill((x, y, r) => { const n = (r.next() - 0.5) * 0.12; return [0.52 + n, 0.38 + n, 0.26 + n, UNT]; });
    p.speckle([0.4, 0.3, 0.2], 0.12);
    for (let x = 0; x < S; x++) {
      const h = 3 + p.rng.int(0, 3);
      for (let y = 0; y < h; y++) { const n = (p.rng.next() - 0.5) * 0.15; p.set(x, y, 0.9 + n, 0.9 + n, 0.9 + n, 255); }
    }
  });
  t('sand', (p) => { p.noise(gray(0.9), 0.1); p.speckle(gray(0.75), 0.1, 255); p.speckle(gray(1.0), 0.08, 255); });
  t('water', (p) => {
    p.fill((x, y, r) => {
      const w = Math.sin((x + y * 0.5) * 0.8) * 0.06 + Math.sin(y * 1.3) * 0.04;
      const n = (r.next() - 0.5) * 0.05;
      return [0.85 + w + n, 0.85 + w + n, 0.9 + w + n, 255];
    });
  });
  t('ice', (p) => {
    p.noise([0.72, 0.86, 0.98], 0.06, UNT);
    for (let i = 0; i < 4; i++) {
      let x = p.rng.int(0, 15), y = p.rng.int(0, 15);
      for (let k = 0; k < 7; k++) { p.set(x, y, 0.92, 0.97, 1, UNT); x += 1; y += p.rng.int(-1, 1); }
    }
  });
  t('snow', (p) => { p.noise([0.95, 0.97, 1.0], 0.06, UNT); p.speckle([0.85, 0.9, 1.0], 0.1); });
  t('snow_side', (p) => {
    p.fill((x, y, r) => { const n = (r.next() - 0.5) * 0.12; return [0.52 + n, 0.38 + n, 0.26 + n, UNT]; });
    p.speckle([0.4, 0.3, 0.2], 0.12);
    for (let x = 0; x < S; x++) {
      const h = 3 + p.rng.int(0, 3);
      for (let y = 0; y < h; y++) { const n = (p.rng.next() - 0.5) * 0.06; p.set(x, y, 0.95 + n, 0.97 + n, 1, UNT); }
    }
  });
  t('log_side', (p) => {
    p.fill((x, y, r) => {
      const stripe = (x % 4 === 0) ? -0.18 : (x % 4 === 2 ? 0.05 : 0);
      const n = (r.next() - 0.5) * 0.1;
      return [0.8 + stripe + n, 0.8 + stripe + n, 0.8 + stripe + n, 255];
    });
  });
  t('log_top', (p) => {
    p.fill((x, y, r) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      const ring = Math.sin(d * 1.6) * 0.08;
      const n = (r.next() - 0.5) * 0.06;
      if (d > 7) return [0.6 + n, 0.6 + n, 0.6 + n, 255];
      return [0.9 + ring + n, 0.9 + ring + n, 0.88 + ring + n, 255];
    });
  });
  t('leaves', (p) => {
    p.fill((x, y, r) => {
      if (r.next() < 0.07) return [0, 0, 0, 0];
      const n = (r.next() - 0.5) * 0.22;
      const cl = ((x * 7 + y * 3) % 5 === 0) ? 0.12 : 0;
      return [0.84 + n + cl, 0.84 + n + cl, 0.84 + n + cl, 255];
    });
  });
  const ore = (name, color, glow = 0) => t(name, (p) => {
    p.noise(gray(0.8), 0.14);
    p.blobs(color, 5, 1.0, 2.2, UNT, glow);
  });
  ore('ore_ferrite', [0.82, 0.84, 0.9]);
  ore('ore_copper', [0.95, 0.55, 0.25]);
  ore('ore_gold', [1.0, 0.85, 0.3]);
  ore('ore_uranium', [0.45, 1.0, 0.4], 0.2);
  ore('ore_cobalt', [0.3, 0.5, 1.0], 0.1);
  t('crystal', (p) => {
    p.fill((x, y, r) => {
      const f = ((x + y) % 6 < 2) ? 0.12 : 0;
      const g = ((x - y + 16) % 5 === 0) ? 0.1 : 0;
      const n = (r.next() - 0.5) * 0.08;
      return [0.8 + f + g + n, 0.8 + f + g + n, 0.85 + f + g + n, 255];
    });
  });
  t('pool_tile', (p) => {
    p.fill((x, y, r) => {
      const grout = (x % 4 === 0) || (y % 4 === 0);
      const n = (r.next() - 0.5) * 0.03;
      return grout ? [0.72, 0.78, 0.8, UNT] : [0.93 + n, 0.97 + n, 0.98 + n, UNT];
    });
  });
  t('wallpaper', (p) => {
    p.fill((x, y, r) => {
      const n = (r.next() - 0.5) * 0.04;
      const stripe = (x % 5 === 0) ? -0.06 : 0;
      const dot = ((x % 5 === 2) && (y % 4 === 1)) ? -0.1 : 0;
      return [0.86 + n + stripe + dot, 0.78 + n + stripe + dot, 0.45 + n + stripe, UNT];
    });
  });
  t('carpet', (p) => {
    p.fill((x, y, r) => {
      const n = (r.next() - 0.5) * 0.12;
      return [0.66 + n, 0.58 + n, 0.38 + n, UNT];
    });
    p.speckle([0.5, 0.44, 0.3], 0.15);
  });
  t('ceiling_tile', (p) => {
    p.fill((x, y, r) => {
      const edge = x === 0 || y === 0;
      const hole = r.next() < 0.1;
      const n = (r.next() - 0.5) * 0.03;
      if (edge) return [0.62, 0.6, 0.55, UNT];
      if (hole) return [0.7, 0.68, 0.62, UNT];
      return [0.88 + n, 0.86 + n, 0.8 + n, UNT];
    });
  });
  t('light_panel', (p) => {
    p.fill((x, y) => {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      const grid = (x % 5 === 0) || (y % 8 === 0);
      if (edge) return [0.75, 0.75, 0.72, UNT];
      if (grid) return [0.93, 0.95, 0.9, UNT];
      return [1.0, 1.0, 0.97, UNT];
    });
  });
  t('checker', (p) => {
    p.fill((x, y, r) => {
      const c = ((x >> 3) + (y >> 3)) % 2 === 0;
      const n = (r.next() - 0.5) * 0.03;
      return c ? [0.95 + n, 0.94 + n, 0.92 + n, UNT] : [0.12 + n, 0.11 + n, 0.14 + n, UNT];
    });
  });
  t('glass', (p) => {
    p.fill((x, y) => {
      const edge = x === 0 || y === 0;
      if (edge) return [0.82, 0.9, 0.97, UNT];
      if ((x === 3 && y >= 3 && y <= 5) || (y === 3 && x >= 3 && x <= 5)) return [0.95, 0.98, 1.0, UNT];
      return [0, 0, 0, 0];
    });
  });
  t('lava', (p) => {
    p.fill((x, y, r) => {
      const w = Math.sin(x * 0.9 + Math.sin(y * 0.7) * 2) * 0.5 + 0.5;
      const n = (r.next() - 0.5) * 0.1;
      return [1.0, 0.35 + w * 0.4 + n, 0.05 + w * 0.1, UNT];
    });
  });
  t('bedrock', (p) => { p.noise([0.16, 0.12, 0.22], 0.1, UNT); p.speckle([0.35, 0.25, 0.5], 0.08); });
  t('dream', (p) => {
    p.fill((x, y, r) => {
      const t0 = (x + y) / 30;
      const n = (r.next() - 0.5) * 0.03;
      return [0.98 - t0 * 0.2 + n, 0.72 + t0 * 0.1 + n, 0.88 + t0 * 0.12 + n, UNT];
    });
    p.border([1, 0.92, 0.98]);
  });
  t('metal_plate', (p) => {
    p.noise([0.64, 0.66, 0.7], 0.05, UNT);
    p.border([0.5, 0.52, 0.56]);
    [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([x, y]) => p.set(x, y, 0.85, 0.86, 0.9, UNT));
  });
  t('metal_panel', (p) => {
    p.noise([0.34, 0.36, 0.42], 0.05, UNT);
    p.fill((x, y) => (y === 5 || y === 10) ? [0.24, 0.25, 0.3, UNT] : null);
    p.fill((x, y) => (x === 12 && y > 1 && y < 4) ? [1.0, 0.55, 0.2, UNT] : null);
  });
  t('brick', (p) => {
    p.fill((x, y, r) => {
      const row = y >> 2;
      const off = (row % 2) * 4;
      const mortar = (y % 4 === 0) || ((x + off) % 8 === 0);
      const n = (r.next() - 0.5) * 0.08;
      return mortar ? [0.8, 0.75, 0.7, UNT] : [0.72 + n, 0.36 + n, 0.28 + n, UNT];
    });
  });
  t('planks', (p) => {
    p.fill((x, y, r) => {
      const seam = y % 4 === 0;
      const n = (r.next() - 0.5) * 0.08;
      const grain = Math.sin(x * 0.8 + y) * 0.03;
      return seam ? [0.45, 0.33, 0.2, UNT] : [0.72 + n + grain, 0.55 + n + grain, 0.35 + n, UNT];
    });
  });
  const cross = (name, stemColor, headColor, headAlpha, headShape) => t(name, (p) => {
    p.fill(() => [0, 0, 0, 0]);
    headShape(p, stemColor, headColor, headAlpha);
  });
  cross('tallgrass', null, null, 255, (p) => {
    for (let i = 0; i < 9; i++) {
      let x = p.rng.int(1, 14);
      const h = p.rng.int(5, 13);
      for (let y = 15; y > 15 - h; y--) {
        const n = (p.rng.next() - 0.5) * 0.2;
        p.set(x, y, 0.85 + n, 0.85 + n, 0.85 + n, 255);
        if (p.rng.next() < 0.2) x += p.rng.pick([-1, 1]);
      }
    }
  });
  cross('flower', null, null, 255, (p) => {
    for (let y = 7; y < 16; y++) p.set(7, y, 0.3, 0.6, 0.25, UNT);
    p.set(6, 11, 0.3, 0.6, 0.25, UNT); p.set(8, 12, 0.3, 0.6, 0.25, UNT);
    for (let y = 1; y < 8; y++) for (let x = 3; x < 12; x++) {
      const d = Math.hypot(x - 7, y - 4.5);
      if (d < 3.6) { const n = (p.rng.next() - 0.5) * 0.15; p.set(x, y, 0.95 + n, 0.95 + n, 0.95 + n, 255); }
    }
    p.set(7, 4, 1.0, 0.9, 0.3, UNT); p.set(7, 5, 1.0, 0.9, 0.3, UNT);
  });
  cross('sodium_plant', null, null, 255, (p) => {
    for (let y = 9; y < 16; y++) { p.set(7, y, 0.35, 0.5, 0.2, UNT); p.set(8, y, 0.3, 0.45, 0.2, UNT); }
    for (let y = 1; y < 10; y++) for (let x = 3; x < 13; x++) {
      const d = Math.hypot(x - 7.5, y - 5);
      if (d < 4.3) { const g = 1 - d / 6; p.set(x, y, 1.0, 0.75 + g * 0.2, 0.15 + g * 0.3, UNT); }
    }
  });
  cross('oxygen_plant', null, null, 255, (p) => {
    for (let x = 2; x < 14; x++) for (let y = 6; y < 16; y++) {
      const leaf = Math.abs(x - 7.5) < (16 - y) * 0.45 && (x + y) % 3 !== 0;
      if (leaf && y > 10) p.set(x, y, 0.25, 0.55, 0.25, UNT);
    }
    for (let y = 3; y < 11; y++) for (let x = 4; x < 12; x++) {
      const d = Math.hypot(x - 7.5, y - 7);
      if (d < 3.6) p.set(x, y, 0.95 - d * 0.05, 0.2, 0.22, UNT);
    }
    p.set(6, 5, 1, 0.7, 0.7, UNT);
  });
  cross('special_plant', null, null, 255, (p) => {
    for (let y = 6; y < 16; y++) p.set(7 + (y % 3 === 0 ? 1 : 0), y, 0.4, 0.4, 0.4, UNT);
    for (let i = 0; i < 4; i++) {
      const cx = p.rng.range(3, 12), cy = p.rng.range(2, 9);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d < 2.4) p.set(x, y, 1 - d * 0.1, 1 - d * 0.1, 1 - d * 0.1, 255);
      }
    }
  });
  cross('dihydro', null, null, 255, (p) => {
    const shard = (x0, h, w) => {
      for (let y = 15; y > 15 - h; y--) {
        const ww = Math.max(0, Math.round(w * (y - (15 - h)) / h));
        for (let x = x0 - ww; x <= x0 + ww; x++) p.set(x, y, 0.35 + (x === x0 ? 0.3 : 0), 0.65 + (x === x0 ? 0.2 : 0), 1.0, UNT);
      }
    };
    shard(7, 14, 2); shard(3, 8, 1); shard(12, 10, 1.5);
  });
  t('cactus_side', (p) => {
    p.fill((x, y, r) => {
      const rib = x % 4 === 1;
      const n = (r.next() - 0.5) * 0.1;
      return [0.75 + n + (rib ? 0.15 : 0), 0.75 + n + (rib ? 0.15 : 0), 0.75 + n + (rib ? 0.15 : 0), 255];
    });
    p.speckle([0.95, 0.95, 0.85], 0.05);
  });
  t('cactus_top', (p) => { p.noise(gray(0.8), 0.1); p.border(gray(0.6), 255); p.set(7, 7, 0.95, 0.4, 0.6, UNT); p.set(8, 8, 0.95, 0.4, 0.6, UNT); });
  t('mushroom_stem', (p) => { p.noise([0.9, 0.88, 0.8], 0.06, UNT); p.fill((x, y) => (x % 5 === 0) ? [0.82, 0.8, 0.72, UNT] : null); });
  t('mushroom_cap', (p) => {
    p.noise(gray(0.85), 0.1);
    for (let i = 0; i < 6; i++) {
      const cx = p.rng.int(1, 14), cy = p.rng.int(1, 14);
      for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (Math.abs(x - cx) + Math.abs(y - cy) < 2) p.set(x, y, 1, 0.98, 0.9, UNT);
    }
  });
  t('cloud', (p) => { p.noise([0.97, 0.97, 1.0], 0.04, UNT); p.speckle([0.9, 0.92, 1.0], 0.15); });
  t('chest_side', (p) => {
    p.noise([0.62, 0.45, 0.26], 0.08, UNT);
    p.border([0.35, 0.25, 0.15]);
    p.fill((x, y) => (y === 5) ? [0.9, 0.75, 0.3, UNT] : null);
  });
  t('chest_top', (p) => {
    p.noise([0.66, 0.48, 0.28], 0.08, UNT);
    p.border([0.35, 0.25, 0.15]);
    p.fill((x, y) => ((x === 7 || x === 8) ? [0.9, 0.75, 0.3, UNT] : null));
  });
  t('chest_front', (p) => {
    p.noise([0.62, 0.45, 0.26], 0.08, UNT);
    p.border([0.35, 0.25, 0.15]);
    p.fill((x, y) => (y === 5) ? [0.9, 0.75, 0.3, UNT] : null);
    p.fill((x, y) => (x >= 6 && x <= 9 && y >= 4 && y <= 8) ? [0.6, 0.95, 1.0, UNT] : null);
  });
  t('chest_open', (p) => {
    p.noise([0.3, 0.2, 0.12], 0.08, UNT);
    p.border([0.62, 0.45, 0.26], UNT, 2);
  });
  t('monolith', (p) => {
    p.noise([0.08, 0.07, 0.11], 0.04, UNT);
    for (let i = 0; i < 7; i++) {
      const x = p.rng.int(2, 12), y = p.rng.int(1, 13);
      const g = p.rng.int(0, 3);
      for (let k = 0; k < 3; k++) {
        if (g === 0) p.set(x + k, y, 0.4, 0.95, 1.0, UNT);
        else if (g === 1) p.set(x, y + k, 0.4, 0.95, 1.0, UNT);
        else if (g === 2) p.set(x + k, y + k, 0.9, 0.5, 1.0, UNT);
        else { p.set(x + 1, y, 0.4, 0.95, 1.0, UNT); p.set(x, y + 1, 0.4, 0.95, 1.0, UNT); p.set(x + 2, y + 1, 0.4, 0.95, 1.0, UNT); }
      }
    }
  });
  t('terminal', (p) => {
    p.noise([0.5, 0.52, 0.56], 0.04, UNT);
    p.fill((x, y) => (x >= 2 && x <= 13 && y >= 2 && y <= 10) ? [0.05, 0.2, 0.2, UNT] : null);
    p.fill((x, y, r) => (x >= 3 && x <= 12 && y >= 3 && y <= 9 && (y % 2 === 1) && r.next() < 0.7) ? [0.3, 1.0, 0.85, UNT] : null);
    p.fill((x, y) => (y === 13 && x > 3 && x < 12 && x % 2 === 0) ? [1.0, 0.6, 0.2, UNT] : null);
  });
  t('obsidian', (p) => { p.noise([0.12, 0.08, 0.18], 0.06, UNT); p.speckle([0.35, 0.2, 0.5], 0.06); });
  t('ash', (p) => { p.noise([0.38, 0.36, 0.36], 0.1, UNT); p.speckle([0.55, 0.3, 0.2], 0.04); p.speckle([0.2, 0.2, 0.2], 0.1); });
  t('rust', (p) => { p.noise([0.62, 0.32, 0.2], 0.12, UNT); p.speckle([0.45, 0.22, 0.14], 0.15); p.speckle([0.8, 0.5, 0.3], 0.05); });
  t('salt', (p) => {
    p.noise([0.95, 0.93, 0.9], 0.05, UNT);
    p.fill((x, y) => ((x * 3 + y * 5) % 11 === 0) ? [0.8, 0.78, 0.75, UNT] : null);
  });
  t('gravel', (p) => {
    p.noise(gray(0.75), 0.1);
    p.blobs(gray(0.95), 10, 0.8, 1.6, 255);
    p.blobs(gray(0.55), 6, 0.6, 1.2, 255);
  });
  t('pod', (p) => {
    p.noise([0.64, 0.66, 0.7], 0.05, UNT);
    p.fill((x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 5.5 && d > 4) return [0.35, 0.95, 1.0, UNT];
      if (d < 3) return [0.8, 1.0, 1.0, UNT];
      return null;
    });
  });
  t('pod_open', (p) => {
    p.noise([0.5, 0.52, 0.56], 0.05, UNT);
    p.fill((x, y) => (Math.hypot(x - 7.5, y - 7.5) < 5.5) ? [0.1, 0.1, 0.12, UNT] : null);
  });
  t('lamp', (p) => {
    p.fill((x, y) => {
      const d = Math.hypot(x - 7.5, y - 7.5);
      return [1.0, 0.92 - d * 0.02, 0.7 - d * 0.02, UNT];
    });
    p.border([0.9, 0.75, 0.5]);
  });
  t('dream_tile', (p) => {
    p.fill((x, y, r) => {
      const grout = (x % 8 === 0) || (y % 8 === 0);
      const n = (r.next() - 0.5) * 0.03;
      const q = ((x >> 3) + (y >> 3)) % 2;
      if (grout) return [1.0, 0.92, 0.96, UNT];
      return q ? [0.98 + n, 0.75 + n, 0.85 + n, UNT] : [0.75 + n, 0.85 + n, 1.0 + n, UNT];
    });
  });
  t('marble', (p) => {
    p.noise([0.93, 0.93, 0.95], 0.04, UNT);
    for (let i = 0; i < 3; i++) {
      let x = p.rng.int(0, 15), y = 0;
      for (let k = 0; k < 18; k++) { p.set(x, y, 0.7, 0.7, 0.76, UNT); y++; x += p.rng.int(-1, 1); }
    }
  });
  t('neon', (p) => {
    p.fill((x, y) => {
      const band = Math.floor(y / 4) % 2;
      return band ? [1.0, 0.35, 0.85, UNT] : [0.35, 0.95, 1.0, UNT];
    });
  });
  t('coral', (p) => {
    p.noise(gray(0.82), 0.12);
    p.fill((x, y, r) => (((x * 7 + y * 3) % 5 === 0) && r.next() < 0.8) ? [0.98, 0.98, 0.98, 255] : null);
    p.speckle(gray(0.6), 0.12, 255);
  });
  t('pool_deep', (p) => {
    p.fill((x, y, r) => {
      const grout = (x % 4 === 0) || (y % 4 === 0);
      const n = (r.next() - 0.5) * 0.04;
      return grout ? [0.45, 0.65, 0.8, UNT] : [0.25 + n, 0.55 + n, 0.85 + n, UNT];
    });
  });
  t('eye', (p) => {
    p.noise([0.9, 0.86, 0.84], 0.04, UNT);
    p.fill((x, y) => {
      const dx = (x - 7.5) / 7, dy = (y - 7.5) / 4;
      const e = dx * dx + dy * dy;
      if (e > 1) return null;
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d < 1.5) return [0.02, 0.02, 0.05, UNT];
      if (d < 3.4) return [0.35, 0.2 + d * 0.08, 0.7, UNT];
      return [1, 1, 1, UNT];
    });
    p.set(6, 6, 1, 1, 1, UNT);
  });
  t('sentinel', (p) => {
    p.noise([0.55, 0.58, 0.62], 0.04, UNT);
    p.fill((x, y) => (x >= 6 && x <= 9) ? [0.95, 0.2, 0.15, UNT] : null);
    p.fill((x, y) => (y % 5 === 0) ? [0.35, 0.37, 0.4, UNT] : null);
  });
  t('starry', (p) => {
    p.fill((x, y, r) => {
      const n = (r.next() - 0.5) * 0.04;
      return [0.1 + n + y * 0.005, 0.07 + n, 0.22 + n + x * 0.004, UNT];
    });
    p.speckle([1, 1, 0.95], 0.06);
    p.speckle([0.7, 0.8, 1.0], 0.04);
  });
  t('acid', (p) => {
    p.fill((x, y, r) => {
      const w = Math.sin((x + y * 0.5) * 0.8) * 0.08;
      const n = (r.next() - 0.5) * 0.06;
      return [0.55 + w + n, 1.0, 0.25 + w, UNT];
    });
  });
  t('door', (p) => {
    p.fill((x, y, r) => {
      const n = (r.next() - 0.5) * 0.03;
      const frame = x <= 1 || x >= 14;
      const panel = (x >= 4 && x <= 11) && (y >= 2 && y <= 13);
      const inset = panel && (x === 4 || x === 11 || y === 2 || y === 13);
      if (frame) return [0.98, 0.9, 0.95, UNT];
      if (inset) return [0.82 + n, 0.62 + n, 0.78 + n, UNT];
      return [0.92 + n, 0.74 + n, 0.88 + n, UNT];
    });
    p.set(12, 1, 1.0, 0.85, 0.35, UNT);
  });
  const plastic = (name, c) => t(name, (p) => {
    p.fill((x, y, r) => {
      const n = (r.next() - 0.5) * 0.02;
      const hl = (x + y === 5 || x + y === 6) && x < 6 ? 0.25 : 0;
      const edge = x === 15 || y === 15 ? -0.08 : 0;
      return [c[0] + n + hl + edge, c[1] + n + hl + edge, c[2] + n + hl + edge, UNT];
    });
  });
  plastic('plastic_r', [0.88, 0.18, 0.2]);
  plastic('plastic_y', [0.97, 0.8, 0.18]);
  plastic('plastic_b', [0.2, 0.42, 0.92]);
  plastic('plastic_w', [0.93, 0.93, 0.95]);
  t('concrete', (p) => {
    p.noise([0.62, 0.62, 0.6], 0.05, UNT);
    p.speckle([0.52, 0.52, 0.5], 0.08);
    p.fill((x, y) => (y === 0 && x % 8 < 7) ? [0.56, 0.56, 0.54, UNT] : null);
  });
  t('shelf', (p) => {
    p.fill((x, y, r) => {
      const post = x <= 1 || x >= 14;
      const board = y % 8 === 0 || y % 8 === 1;
      const n = (r.next() - 0.5) * 0.05;
      if (post) return [0.35, 0.37, 0.42, UNT];
      if (board) return [0.7 + n, 0.55 + n, 0.35 + n, UNT];
      // boxes on the shelf
      const bx = Math.floor(x / 4), by = Math.floor(y / 8);
      if ((bx + by) % 3 === 0) return [0.1, 0.09, 0.08, UNT];
      return [0.72 + n, 0.6 + n, 0.42 + n, UNT];
    });
  });
  t('dream_water', (p) => {
    p.fill((x, y, r) => {
      const w = Math.sin((x - y * 0.5) * 0.7) * 0.06;
      const n = (r.next() - 0.5) * 0.04;
      return [0.98 + n, 0.7 + w + n, 0.9 + w, UNT];
    });
  });

  return tiles;
}

let _tiles = null;
function getTiles() {
  if (!_tiles) _tiles = paintTiles();
  return _tiles;
}

export function createAtlasTexture() {
  const tiles = getTiles();
  const layers = tiles.length;
  const data = new Uint8Array(S * S * 4 * layers);
  for (let l = 0; l < layers; l++) {
    const tile = tiles[l];
    if (!tile) continue;
    // flip Y so tile row 0 is at the top of the face
    for (let y = 0; y < S; y++) {
      const src = tile.d.subarray((S - 1 - y) * S * 4, (S - y) * S * 4);
      data.set(src, l * S * S * 4 + y * S * 4);
    }
  }
  const tex = new THREE.DataArrayTexture(data, S, S, layers);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---------- UI icons (isometric cube renders of blocks) ----------
const iconCache = new Map();
const DEFAULT_TINTS = [
  [1, 1, 1], [0.45, 0.75, 0.35], [0.35, 0.65, 0.3], [0.62, 0.6, 0.62], [0.6, 0.45, 0.32],
  [0.3, 0.55, 0.9], [0.92, 0.85, 0.62], [0.55, 0.38, 0.25], [0.95, 0.5, 0.75], [0.95, 0.85, 0.35],
  [0.75, 0.5, 1.0], [0.85, 0.35, 0.5],
];

function tileToCanvas(tileIndex, tint, shade) {
  const tile = getTiles()[tileIndex];
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const a = tile.d[i * 4 + 3];
    const tinted = a > 230;
    for (let k = 0; k < 3; k++) {
      const v = tile.d[i * 4 + k] * (tinted ? tint[k] : 1) * shade;
      img.data[i * 4 + k] = v;
    }
    img.data[i * 4 + 3] = a > 60 ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function getBlockIcon(id, tints = DEFAULT_TINTS) {
  const key = id;
  if (iconCache.has(key)) return iconCache.get(key);
  const def = BLOCKS[id];
  const size = 48;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tint = tints[def.tint] || [1, 1, 1];
  if (def.shape === 'cross') {
    ctx.drawImage(tileToCanvas(def.tiles[2], tint, 1), 4, 4, 40, 40);
  } else {
    const top = tileToCanvas(def.tiles[0], tint, 1.0);
    const sideTint = def.sideTint != null ? tints[def.sideTint] : tint;
    const left = tileToCanvas(def.tiles[2], sideTint, 0.8);
    const right = tileToCanvas(def.tiles[2], sideTint, 0.62);
    const h = size / 2, q = size / 4;
    // top face
    ctx.save();
    ctx.setTransform(1, 0.5, -1, 0.5, h, 1);
    ctx.drawImage(top, 0, 0, S, S, 0, 0, h / 1.0 * 0.96, h / 1.0 * 0.96);
    ctx.restore();
    // left face
    ctx.save();
    ctx.setTransform(1, 0.5, 0, 1, 1 + 0.5, q + 0.5);
    ctx.drawImage(left, 0, 0, S, S, 0, 0, h * 0.96, h * 0.96 * 1.0);
    ctx.restore();
    // right face
    ctx.save();
    ctx.setTransform(1, -0.5, 0, 1, h, h + q * 0.92);
    ctx.drawImage(right, 0, 0, S, S, 0, 0, h * 0.96, h * 0.96);
    ctx.restore();
  }
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

export { DEFAULT_TINTS };
