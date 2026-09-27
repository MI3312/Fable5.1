// Planet surface generator. Runs in the worker (chunk generation) and on the main
// thread (height queries for spawning, scanner, structure listing).
import { Noise } from '../core/noise.js';
import { hash32, RNG, smoothstep } from '../core/rng.js';
import { B, IS_SOLID, IS_AIRLIKE, IS_LIQUID } from './blocks.js';
import { CHUNK, HEIGHT, PW, MARGIN, GW } from '../config.js';
import { stampStructures } from './structures.js';
import { stationBlockAt } from './station.js';
import { voidBlockAt, derelictBlockAt } from './pockets.js';
import { zoneAt, zoneFloor, writeZoneColumn, writeUnderlayer, writeManhole, stampProp, PROP_KINDS } from './zones.js';

const CS = 4; // coarse sampling step for 3D noise
const CGX = GW / CS + 1; // 7
const CGY = HEIGHT / CS + 1; // 33

const SOIL = new Uint8Array(256);
[B.GRASS, B.SNOW_GRASS, B.SAND, B.ASH, B.RUST, B.GRAVEL, B.DIRT, B.SNOW, B.SALT, B.STONE].forEach((b) => (SOIL[b] = 1));

export class TerrainGen {
  constructor(params) {
    this.p = params;
    this.seed = params.seed >>> 0;
    const s = this.seed;
    this.nHill = new Noise(s + 11);
    this.nMount = new Noise(s + 23);
    this.nMask = new Noise(s + 37);
    this.nWarp = new Noise(s + 41);
    this.nCont = new Noise(s + 53);
    this.n3a = new Noise(s + 67);
    this.n3b = new Noise(s + 71);
    this.n3c = new Noise(s + 83);
    this.nSpike = new Noise(s + 97);
    this.nRiver = new Noise(s + 131);
    this.nReg = new Noise(s + 137);
    this.nRock = new Noise(s + 139);
    this.nPatch = new Noise(s + 149);
    this.gen = new Uint8Array(GW * GW * HEIGHT);
    this.hf = new Float32Array(GW * GW);
    this.top = new Int16Array(GW * GW);
    this.fOver = new Float32Array(CGX * CGX * CGY);
    this.fCave = new Float32Array(CGX * CGX * CGY);
    this.fIsle = new Float32Array(CGX * CGX * CGY);
    this.zoneCache = new Map();
    this.zType = new Array(GW * GW).fill('natural');
    this.zBlend = new Float32Array(GW * GW);
    this.zFloor = new Float32Array(GW * GW);
    this.treeWeights = params.flora.trees;
    this.plantWeights = params.flora.plants;
    this.oreWeights = params.ores;
  }

  // Terrain surface height (float) at a world column, ignoring 3D features
  heightAt(x, z) {
    if (this.p.interior) return 39;
    const t = this.p.terrain;
    const warp = t.warp;
    const wx = x + this.nWarp.n2(x * 0.004, z * 0.004) * warp;
    const wz = z + this.nWarp.n2(x * 0.004 + 91.3, z * 0.004 + 17.7) * warp;
    let h = t.base;
    h += this.nHill.fbm2(wx * t.hillScale, wz * t.hillScale, 4) * t.hillAmp;
    const maskN = this.nMask.fbm2(wx * 0.0022, wz * 0.0022, 2) * 0.5 + 0.5;
    const m = smoothstep(t.mountMask - 0.12, t.mountMask + 0.22, maskN);
    if (m > 0) h += this.nMount.ridged2(wx * t.mountScale, wz * t.mountScale, 4) * t.mountAmp * m;
    h += this.nCont.fbm2(x * 0.0013, z * 0.0013, 2) * 12;
    if (t.terrace > 0) {
      const step = t.terrace;
      const k = h / step;
      const fl = Math.floor(k);
      h = step * (fl + smoothstep(0.3, 0.7, k - fl));
    }
    if (t.spikes > 0) {
      const sn = this.nSpike.n2(x * 0.045, z * 0.045);
      const thr = 1 - t.spikes * 0.28;
      if (sn > thr) h += Math.sqrt((sn - thr) / (1 - thr)) * 45;
    }
    if (t.craters) {
      const cs = 72;
      const gx = Math.floor(x / cs), gz = Math.floor(z / cs);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const hh = hash32(this.seed, gx + dx, gz + dz, 3);
        if ((hh & 255) > 150) continue;
        const cx = (gx + dx) * cs + ((hh >> 8) & 63) + 4;
        const cz = (gz + dz) * cs + ((hh >> 14) & 63) + 4;
        const r = 8 + ((hh >> 20) & 15) * 1.4;
        const d = Math.hypot(x - cx, z - cz) / r;
        if (d < 1) h -= (1 - d * d) * r * 0.45;
        else if (d < 1.4) h += (1 - Math.abs(d - 1.15) / 0.25) * r * 0.08;
      }
    }
    // rivers: a warped noise line carved down to the sea (or into a dry canyon)
    if (this.p.rivers) {
      const rv = Math.abs(this.nRiver.fbm2(wx * 0.0019 + 17.3, wz * 0.0019 - 41.9, 3));
      const Wd = 0.04;
      if (rv < Wd * 2.4) {
        const sea = this.p.seaLevel;
        const dry = this.p.rivers === 'dry';
        const bed = dry ? h - 10 : sea - 2.5;
        let k = 1 - smoothstep(Wd * 0.45, Wd * 2.4, rv);
        if (!dry) k *= smoothstep(sea + 70, sea + 34, h);
        if (k > 0 && bed < h) h += (bed - h) * k * k * (3 - 2 * k);
      }
    }
    const zi = zoneAt(this, x, z);
    if (zi.blend > 0) h += (zoneFloor(this, zi.type, x, z) - h) * zi.blend;
    return Math.max(4, Math.min(HEIGHT - 8, h));
  }

  zoneAt(x, z) { return zoneAt(this, x, z); }

  // Approximate integer surface y for spawning (ignores overhangs)
  surfaceY(x, z) {
    return Math.floor(this.heightAt(x, z));
  }

  _fillCoarse(field, wx0, wz0, fn) {
    let i = 0;
    for (let cy = 0; cy < CGY; cy++) for (let cz = 0; cz < CGX; cz++) for (let cx = 0; cx < CGX; cx++) {
      field[i++] = fn(wx0 + cx * CS, cy * CS, wz0 + cz * CS);
    }
  }

  _interp(field, gx, y, gz) {
    const fx = gx / CS, fy = y / CS, fz = gz / CS;
    const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0;
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const x1 = x0 < CGX - 1 ? x0 + 1 : x0, y1 = y0 < CGY - 1 ? y0 + 1 : y0, z1 = z0 < CGX - 1 ? z0 + 1 : z0;
    const i000 = x0 + CGX * (z0 + CGX * y0), i100 = x1 + CGX * (z0 + CGX * y0);
    const i010 = x0 + CGX * (z0 + CGX * y1), i110 = x1 + CGX * (z0 + CGX * y1);
    const i001 = x0 + CGX * (z1 + CGX * y0), i101 = x1 + CGX * (z1 + CGX * y0);
    const i011 = x0 + CGX * (z1 + CGX * y1), i111 = x1 + CGX * (z1 + CGX * y1);
    const a = field[i000] + (field[i100] - field[i000]) * tx;
    const b = field[i001] + (field[i101] - field[i001]) * tx;
    const c = field[i010] + (field[i110] - field[i010]) * tx;
    const d = field[i011] + (field[i111] - field[i011]) * tx;
    const e = a + (b - a) * tz;
    const f = c + (d - c) * tz;
    return e + (f - e) * ty;
  }

  generate(cx, cz, edits) {
    if (this.p.interior === 'station') return this._generateInterior(cx, cz, edits, stationBlockAt, 46, 50, 30, 64);
    if (this.p.interior === 'void') return this._generateInterior(cx, cz, edits, voidBlockAt, 72, 72, 8, 92);
    if (this.p.interior === 'derelict') {
      const seed = this.p.derelictSeed;
      return this._generateInterior(cx, cz, edits, (x, y, z) => derelictBlockAt(x, y, z, seed), 26, 64, 36, 54);
    }
    const P = this.p;
    const T = P.terrain;
    const S = P.surface;
    const gen = this.gen;
    gen.fill(0);
    const wx0 = cx * CHUNK - MARGIN;
    const wz0 = cz * CHUNK - MARGIN;
    const sea = P.seaLevel;
    const liquid = P.liquid;

    // 1. heights + dream zones
    for (let gz = 0; gz < GW; gz++) for (let gx = 0; gx < GW; gx++) {
      const col = gx + GW * gz;
      const wx = wx0 + gx, wz = wz0 + gz;
      this.hf[col] = this.heightAt(wx, wz);
      const zi = zoneAt(this, wx, wz);
      this.zType[col] = zi.type;
      this.zBlend[col] = zi.blend;
      this.zFloor[col] = zi.blend > 0 ? Math.round(zoneFloor(this, zi.type, wx, wz)) : 0;
    }
    // 2. coarse 3D fields
    const useOver = T.overhang > 0;
    const useCave = T.caves > 0;
    const useIsle = T.islands > 0;
    if (useOver) {
      const sc = T.overhangScale;
      this._fillCoarse(this.fOver, wx0, wz0, (x, y, z) => this.n3a.fbm3(x * sc, y * sc * 1.4, z * sc, 2));
    }
    if (useCave) {
      this._fillCoarse(this.fCave, wx0, wz0, (x, y, z) => {
        const a = this.n3b.n3(x * 0.03, y * 0.045, z * 0.03);
        const b = this.n3c.n3(x * 0.03 + 50, y * 0.045, z * 0.03 + 50);
        return a * a + b * b;
      });
    }
    const isleMin = 72, isleMax = 118, isleMid = 94;
    if (useIsle) {
      this._fillCoarse(this.fIsle, wx0, wz0, (x, y, z) => {
        if (y < isleMin - 4 || y > isleMax + 4) return -1;
        return this.n3a.fbm3(x * 0.022 + 300, y * 0.05, z * 0.022 - 200, 3);
      });
    }
    const caveThr = 0.012 * T.caves;
    const isleThr = 0.95 - T.islands * 0.35;

    // 3. density fill
    for (let gz = 0; gz < GW; gz++) for (let gx = 0; gx < GW; gx++) {
      const col = gx + GW * gz;
      const h = this.hf[col];
      const plain = this.zBlend[col] > 0.2;
      let groundTop = 0;
      const ymax = Math.min(HEIGHT - 1, Math.max(Math.ceil(h + T.overhang * 1.4) + 1, useIsle ? isleMax + 2 : 0));
      for (let y = 0; y <= ymax; y++) {
        let d = h - y;
        if (useOver && !plain && d > -T.overhang * 1.4 && d < T.overhang * 1.4) {
          d += this._interp(this.fOver, gx, y, gz) * T.overhang;
        }
        let solid = d > 0;
        if (solid && useCave && !plain && y > 3 && y < h - 3) {
          if (this._interp(this.fCave, gx, y, gz) < caveThr) solid = false;
        }
        if (solid) { groundTop = y; gen[col + GW * GW * y] = 1; continue; }
        if (useIsle && !plain && y > isleMin && y < isleMax) {
          const band = 1 - Math.abs(y - isleMid) / ((isleMax - isleMin) * 0.5);
          const v = this._interp(this.fIsle, gx, y, gz) + band * 0.55;
          if (v > isleThr) gen[col + GW * GW * y] = 2;
        }
      }
      // liquid
      if (liquid) {
        for (let y = groundTop + 1; y <= sea; y++) {
          const i = col + GW * GW * y;
          if (gen[i] === 0) gen[i] = (P.iceSea && y === sea) ? B.ICE : liquid;
        }
      }
      gen[col] = B.BEDROCK;
    }

    // 4. surface layering + ores
    const snowLine = S.snowLine;
    const oreW = this.oreWeights;
    let oreTotal = 0;
    for (const o of oreW) oreTotal += o[1];
    for (let gz = 0; gz < GW; gz++) for (let gx = 0; gx < GW; gx++) {
      const col = gx + GW * gz;
      let depth = 0;
      let top = -1;
      const wx = wx0 + gx, wz = wz0 + gz;
      const snowJ = (hash32(wx, wz, 1) & 7);
      for (let y = HEIGHT - 1; y >= 1; y--) {
        const i = col + GW * GW * y;
        const v = gen[i];
        if (v === 1 || v === 2) {
          if (top < 0) top = y;
          let block;
          const above = y + 1 < HEIGHT ? gen[i + GW * GW] : 0;
          const underLiquid = above !== 0 && above !== 1 && above !== 2 && (IS_LIQUID[above] || above === B.ICE);
          if (depth === 0) {
            if (underLiquid || y < sea - 1) block = S.underwater;
            else if (liquid && y <= sea + 1 && v === 1) block = S.beach;
            else if (y + snowJ > snowLine) block = S.snowBlock;
            else {
              // patches: bare earth and rock breaking through the ground cover
              const pn = this.nPatch.n2(wx * 0.06, wz * 0.06) + this.nRock.n2(wx * 0.004, wz * 0.004) * 0.45;
              block = pn > 0.78 ? S.sub : pn < -0.82 ? S.stone : S.top;
            }
          } else if (depth <= S.subDepth) {
            block = (underLiquid || y < sea - 1) && depth < 2 ? S.underwater : S.sub;
          } else {
            block = S.stone;
            const hh = hash32(this.seed, wx >> 1, y >> 1, wz >> 1);
            if ((hh & 1023) < 9 && y < 100) {
              let r = ((hh >>> 10) & 1023) / 1024 * oreTotal;
              block = oreW[0][0];
              for (const o of oreW) { r -= o[1]; if (r <= 0) { block = o[0]; break; } }
            }
          }
          gen[i] = block;
          depth++;
        } else {
          depth = 0;
        }
      }
      this.top[col] = top;
    }

    // 5. features: trees, plants, boulders, deposits, dream props
    this._features(wx0, wz0);

    // 5b. dream zones, the backrooms beneath, and the manholes that lead down to them
    for (let gz = 0; gz < GW; gz++) for (let gx = 0; gx < GW; gx++) {
      const col = gx + GW * gz;
      const wx = wx0 + gx, wz = wz0 + gz;
      const S = (y, id) => { if (y >= 1 && y < HEIGHT) gen[col + GW * GW * y] = id; };
      if (P.underlayer && this.top[col] > 18) writeUnderlayer(this, S, wx, wz);
      const t = this.zType[col], b = this.zBlend[col];
      if (b >= 0.5 && t !== 'natural' && t !== 'meadow') writeZoneColumn(this, t, S, wx, wz, this.zFloor[col]);
      else if (P.underlayer && b < 0.2 || (P.underlayer && t === 'meadow')) writeManhole(this, S, wx, wz, this.top[col]);
    }

    // 6. structures (liminal rooms, monoliths, outposts...)
    const ctx = {
      gen, wx0, wz0, seed: this.seed, params: P, terrain: this,
      set: (x, y, z, id) => {
        const gx = x - wx0, gz = z - wz0;
        if (gx < 0 || gz < 0 || gx >= GW || gz >= GW || y < 1 || y >= HEIGHT) return;
        gen[gx + GW * (gz + GW * y)] = id;
      },
      get: (x, y, z) => {
        const gx = x - wx0, gz = z - wz0;
        if (gx < 0 || gz < 0 || gx >= GW || gz >= GW || y < 0 || y >= HEIGHT) return -1;
        return gen[gx + GW * (gz + GW * y)];
      },
    };
    stampStructures(ctx, wx0, wz0, GW);

    // 7. copy padded region
    const data = new Uint8Array(PW * PW * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) for (let pz = 0; pz < PW; pz++) {
      const gRow = (MARGIN - 1) + GW * ((pz + MARGIN - 1) + GW * y);
      const pRow = PW * (pz + PW * y);
      for (let px = 0; px < PW; px++) data[pRow + px] = gen[gRow + px];
    }
    // 8. player edits
    if (edits) {
      for (let i = 0; i < edits.length; i += 4) {
        data[edits[i] + PW * (edits[i + 2] + PW * edits[i + 1])] = edits[i + 3];
      }
    }
    return data;
  }

  // Bounded interiors: fill from a block function inside |x| <= rx, |z| <= rz, y0 <= y < y1
  _generateInterior(cx, cz, edits, blockAt, rx, rz, y0, y1) {
    const data = new Uint8Array(PW * PW * HEIGHT);
    const ox = cx * CHUNK - 1, oz = cz * CHUNK - 1;
    if (ox + PW < -rx || ox > rx || oz + PW < -rz || oz > rz) return data;
    for (let y = y0; y < y1; y++) for (let pz = 0; pz < PW; pz++) for (let px = 0; px < PW; px++) {
      data[px + PW * (pz + PW * y)] = blockAt(ox + px, y, oz + pz);
    }
    if (edits) for (let i = 0; i < edits.length; i += 4) data[edits[i] + PW * (edits[i + 2] + PW * edits[i + 1])] = edits[i + 3];
    return data;
  }

  _features(wx0, wz0) {
    const P = this.p;
    const F = P.flora;
    const gen = this.gen;
    const sea = P.seaLevel;
    const tw = this.treeWeights;
    let treeTotal = 0;
    for (const t of tw) treeTotal += t[1];
    const pw = this.plantWeights;
    let plantTotal = 0;
    for (const t of pw) plantTotal += t[1];
    const setIfFree = (gx, y, gz, id) => {
      if (gx < 0 || gz < 0 || gx >= GW || gz >= GW || y < 1 || y >= HEIGHT) return;
      const i = gx + GW * (gz + GW * y);
      const cur = gen[i];
      if (cur === 0 || cur === B.LEAVES || IS_AIRLIKE[cur] || (!IS_SOLID[cur] && !IS_LIQUID[cur])) gen[i] = id;
    };
    const setAny = (gx, y, gz, id) => {
      if (gx < 0 || gz < 0 || gx >= GW || gz >= GW || y < 1 || y >= HEIGHT) return;
      gen[gx + GW * (gz + GW * y)] = id;
    };
    const dens = [F.treeDensity, F.boulders, P.depositDensity, F.crystals];
    const densSum = dens[0] + dens[1] + dens[2] + dens[3];

    for (let gz = 0; gz < GW; gz++) for (let gx = 0; gx < GW; gx++) {
      const col = gx + GW * gz;
      const top = this.top[col];
      if (top < 1 || top >= HEIGHT - 12) continue;
      const ground = gen[col + GW * GW * top];
      if (!SOIL[ground]) continue;
      const zb = this.zBlend[col], zt = this.zType[col];
      if (zb > 0.2) {
        if (zt !== 'meadow' || gen[col + GW * GW * (top + 1)] !== 0) continue;
        // fog meadow: endless tall grass, and now and then something that should not be there
        const wxm = wx0 + gx, wzm = wz0 + gz;
        const hm = hash32(this.seed, wxm, wzm, 1231);
        if ((hm & 0xffff) < 0xffff * 0.0022) {
          const rng = new RNG(hm);
          stampProp(rng.weighted(PROP_KINDS), gx, top + 1, gz, setIfFree, rng);
        } else if (gx >= MARGIN - 1 && gx <= MARGIN + CHUNK && gz >= MARGIN - 1 && gz <= MARGIN + CHUNK && ((hm >>> 16) & 1023) < 470) {
          setAny(gx, top + 1, gz, ((hm >>> 26) & 31) === 0 ? B.FLOWER : B.TALLGRASS);
        }
        continue;
      }
      if (P.biome === 'liminal') {
        const hm = hash32(this.seed, wx0 + gx, wz0 + gz, 1237);
        if ((hm & 0xffff) < 0xffff * 0.0005 && gen[col + GW * GW * (top + 1)] === 0) {
          const rng = new RNG(hm);
          stampProp(rng.weighted(PROP_KINDS), gx, top + 1, gz, setIfFree, rng);
          continue;
        }
      }
      const above = gen[col + GW * GW * (top + 1)];
      if (above !== 0) continue; // underwater or covered
      const wx = wx0 + gx, wz = wz0 + gz;
      const h = hash32(this.seed, wx, wz, 5);
      // ruins of something older, now and then
      if (P.ruins && (h >>> 20) === 0 && ground !== B.SAND) {
        this._ruin(gx, top, gz, new RNG(h ^ 0x5ee), setAny, setIfFree);
        continue;
      }
      // regions: forests, clearings, rocky badlands
      const reg = this.nReg.fbm2(wx * 0.0055, wz * 0.0055, 2);
      const rock = this.nRock.n2(wx * 0.009 + 33, wz * 0.009 - 12);
      const treeK = reg > 0.28 ? 2.8 : reg < -0.3 ? 0.12 : 1;
      const rockK = rock > 0.45 ? 4.5 : 1;
      let r = (h & 0xffffff) / 0x1000000;
      // rescale the roll so the region multipliers apply to trees and boulders
      if (r < densSum * 3) {
        const td = dens[0] * treeK * (rock > 0.45 ? 0.3 : 1), bd = dens[1] * rockK;
        if (r < td) r = r / td * dens[0] * 0.999;
        else if (r < td + bd) r = dens[0] + (r - td) / bd * dens[1] * 0.999;
        else if (r < td + bd + dens[2] + dens[3]) r = dens[0] + dens[1] + (r - td - bd);
        else r = densSum + (r - td - bd - dens[2] - dens[3]);
      }
      const rng = r < densSum ? new RNG(h) : null;
      const y = top + 1;
      // trees
      if (r < dens[0] && treeTotal > 0 && ground !== B.STONE) {
        let pick = rng.next() * treeTotal;
        let style = tw[0][0];
        for (const t of tw) { pick -= t[1]; if (pick <= 0) { style = t[0]; break; } }
        this._tree(style, gx, y, gz, rng, setIfFree, setAny);
        continue;
      }
      r -= dens[0];
      if (r < dens[1]) { // boulder
        const rad = rng.range(1.0, 2.2);
        const blk = rng.chance(0.3) ? B.GRAVEL : P.surface.stone;
        this._blob(gx, y - 1, gz, rad, blk, setAny, rng);
        continue;
      }
      r -= dens[1];
      if (r < dens[2]) { // ore deposit (NMS-style resource rock)
        let total = 0; for (const o of this.oreWeights) total += o[1];
        let pick = rng.next() * total; let ore = this.oreWeights[0][0];
        for (const o of this.oreWeights) { pick -= o[1]; if (pick <= 0) { ore = o[0]; break; } }
        this._blob(gx, y, gz, rng.range(1.3, 2.4), ore, setAny, rng);
        continue;
      }
      r -= dens[2];
      if (r < dens[3]) { // crystal cluster
        const n = rng.int(2, 4);
        for (let k = 0; k < n; k++) {
          const ox = rng.int(-1, 1), oz = rng.int(-1, 1);
          const hh = rng.int(2, 5);
          for (let j = 0; j < hh; j++) setIfFree(gx + ox, y + j, gz + oz, B.CRYSTAL);
        }
        continue;
      }
      // plants (single block)
      if (gx >= MARGIN - 1 && gx <= MARGIN + CHUNK && gz >= MARGIN - 1 && gz <= MARGIN + CHUNK) {
        const h2 = hash32(this.seed, wx, wz, 9);
        if ((h2 & 0xffff) / 0x10000 < F.plantDensity && plantTotal > 0) {
          let pick = ((h2 >>> 16) / 0x10000) * plantTotal;
          let pl = pw[0][0];
          for (const t of pw) { pick -= t[1]; if (pick <= 0) { pl = t[0]; break; } }
          if (pl === B.DIHYDRO || ground !== B.STONE) setAny(gx, y, gz, pl);
        }
      }
    }
  }

  _blob(gx, gy, gz, rad, id, set, rng) {
    const r = Math.ceil(rad);
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy * 1.3 + dz * dz);
      if (d <= rad - rng.next() * 0.35) set(gx + dx, gy + dy, gz + dz, id);
    }
  }

  // An old building: broken walls, a doorway, sometimes something left inside
  _ruin(gx, top, gz, rng, setAny, setIfFree) {
    const rx = rng.int(2, 3), rz = rng.int(2, 3);
    const wall = rng.chance(0.5) ? B.BRICK : this.p.surface.stone;
    const door = rng.int(0, 3);
    for (let dz = -rz; dz <= rz; dz++) for (let dx = -rx; dx <= rx; dx++) {
      const edge = Math.abs(dx) === rx || Math.abs(dz) === rz;
      setAny(gx + dx, top, gz + dz, rng.chance(0.2) ? B.GRAVEL : wall);
      if (!edge) continue;
      const isDoor = (door === 0 && dz === -rz && dx === 0) || (door === 1 && dz === rz && dx === 0) || (door === 2 && dx === -rx && dz === 0) || (door === 3 && dx === rx && dz === 0);
      if (isDoor) continue;
      const hgt = rng.chance(0.25) ? 0 : rng.int(1, 3);
      for (let y = 1; y <= hgt; y++) setAny(gx + dx, top + y, gz + dz, y === hgt && rng.chance(0.4) ? B.LEAVES : wall);
    }
    if (rng.chance(0.3)) setIfFree(gx, top + 1, gz, B.CHEST);
    else if (rng.chance(0.3)) setIfFree(gx, top + 1, gz, B.LAMP);
  }

  _tree(style, gx, y, gz, rng, setF, setA) {
    const LOG = B.LOG, LEAF = B.LEAVES;
    switch (style) {
      case 'round': case 'tall': {
        const h = style === 'tall' ? rng.int(7, 9) : rng.int(4, 6);
        for (let i = 0; i < h; i++) setA(gx, y + i, gz, LOG);
        const cr = style === 'tall' ? 2.2 : rng.range(2.0, 2.9);
        const cy = y + h - 1;
        this._leafBall(gx, cy, gz, cr, LEAF, setF, rng);
        if (style === 'tall') this._leafBall(gx, cy - 3, gz, 1.6, LEAF, setF, rng);
        break;
      }
      case 'pine': {
        const h = rng.int(6, 10);
        for (let i = 0; i < h; i++) setA(gx, y + i, gz, LOG);
        for (let i = 2; i <= h; i++) {
          const t = (i - 2) / (h - 1);
          const rr = (1 - t) * 2.8 + 0.3;
          if ((i % 2 === 0) || rr < 1) {
            for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
              if (dx * dx + dz * dz <= rr * rr) setF(gx + dx, y + i, gz + dz, LEAF);
            }
          }
        }
        setF(gx, y + h, gz, LEAF);
        break;
      }
      case 'palm': {
        const h = rng.int(5, 8);
        let x = gx, z = gz;
        const lx = rng.int(-1, 1), lz = rng.int(-1, 1);
        for (let i = 0; i < h; i++) {
          if (i === Math.floor(h / 2)) { x += lx; z += lz; }
          setA(x, y + i, z, LOG);
        }
        const ty = y + h;
        setF(x, ty, z, LEAF);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          setF(x + dx, ty, z + dz, LEAF);
          if (Math.abs(dx) + Math.abs(dz) === 1) {
            setF(x + dx * 2, ty, z + dz * 2, LEAF);
            setF(x + dx * 3, ty - 1, z + dz * 3, LEAF);
          } else {
            setF(x + dx * 2, ty - 1, z + dz * 2, LEAF);
          }
        }
        break;
      }
      case 'mushroom': {
        const h = rng.int(4, 8);
        for (let i = 0; i < h; i++) setA(gx, y + i, gz, B.MUSHROOM_STEM);
        const cr = rng.range(2.2, 3.2);
        const ty = y + h;
        for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dz);
          if (d <= cr) {
            setF(gx + dx, ty - (d > cr - 1 ? 1 : 0), gz + dz, B.MUSHROOM_CAP);
            if (d < cr - 1.3) setF(gx + dx, ty + 1, gz + dz, B.MUSHROOM_CAP);
          }
        }
        break;
      }
      case 'dead': {
        const h = rng.int(3, 6);
        for (let i = 0; i < h; i++) setA(gx, y + i, gz, LOG);
        const nb = rng.int(1, 3);
        for (let b = 0; b < nb; b++) {
          const dx = rng.int(-1, 1), dz = dx === 0 ? rng.pick([-1, 1]) : 0;
          const by = y + rng.int(2, h - 1);
          setF(gx + dx, by, gz + dz, LOG);
          setF(gx + dx * 2, by + 1, gz + dz * 2, LOG);
        }
        break;
      }
      case 'cactus': {
        const h = rng.int(2, 4);
        for (let i = 0; i < h; i++) setA(gx, y + i, gz, B.CACTUS);
        if (h >= 3 && rng.chance(0.6)) {
          const dx = rng.pick([-1, 1]);
          setF(gx + dx, y + 1, gz, B.CACTUS);
          setF(gx + dx, y + 2, gz, B.CACTUS);
        }
        if (rng.chance(0.4)) setF(gx, y + h, gz, B.FLOWER);
        break;
      }
      case 'crystal': {
        const h = rng.int(4, 8);
        for (let i = 0; i < h; i++) {
          const r = (1 - i / h) * 1.6;
          for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if (dx * dx + dz * dz <= r * r) setA(gx + dx, y + i, gz + dz, B.CRYSTAL);
          }
        }
        break;
      }
      case 'coral': {
        const branches = rng.int(2, 4);
        for (let b = 0; b < branches; b++) {
          let x = gx, z = gz, yy = y;
          const len = rng.int(4, 8);
          for (let i = 0; i < len; i++) {
            setA(x, yy, z, B.CORAL);
            yy++;
            if (rng.chance(0.4)) x += rng.int(-1, 1);
            if (rng.chance(0.4)) z += rng.int(-1, 1);
            x = Math.max(gx - 3, Math.min(gx + 3, x));
            z = Math.max(gz - 3, Math.min(gz + 3, z));
          }
          setF(x, yy, z, B.LAMP);
        }
        break;
      }
      case 'lollipop': {
        const h = rng.int(4, 7);
        for (let i = 0; i < h; i++) setA(gx, y + i, gz, LOG);
        const cr = rng.range(1.8, 2.6);
        const blk = rng.chance(0.3) ? B.DREAM_BLOCK : LEAF;
        for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
          if (dx * dx + dy * dy + dz * dz <= cr * cr) setF(gx + dx, y + h + 1 + dy, gz + dz, blk);
        }
        break;
      }
      case 'cloudtree': {
        const h = rng.int(3, 6);
        for (let i = 0; i < h; i++) setA(gx, y + i, gz, LOG);
        for (let k = 0; k < 4; k++) {
          this._leafBall(gx + rng.int(-1, 1), y + h + rng.int(-1, 1), gz + rng.int(-1, 1), rng.range(1.2, 2.0), B.CLOUD, setF, rng);
        }
        break;
      }
      case 'spiral': {
        const h = rng.int(7, 11);
        for (let i = 0; i < h; i++) {
          setA(gx, y + i, gz, B.CORAL);
          const a = i * 0.9;
          setF(gx + Math.round(Math.cos(a) * 2), y + i, gz + Math.round(Math.sin(a) * 2), B.CRYSTAL);
        }
        setF(gx, y + h, gz, B.LAMP);
        break;
      }
      default: break;
    }
  }

  _leafBall(gx, cy, gz, r, id, set, rng) {
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
      const d = dx * dx + dy * dy * 1.4 + dz * dz;
      if (d <= r * r && !(d > (r - 0.7) * (r - 0.7) && rng.next() < 0.3)) set(gx + dx, cy + dy, gz + dz, id);
    }
  }
}
