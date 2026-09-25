// Voxel chunk mesher: face culling + per-vertex ambient occlusion + smooth sky light.
// Works on a padded chunk (1-block border) so it never needs neighbour chunks.
import { CHUNK, HEIGHT, PW } from '../config.js';
import {
  BLOCKS, B, IS_OPAQUE, BLOCK_PASS, IS_CROSS, IS_LIQUID, BLOCK_EMIT, IS_AIRLIKE, TINT,
} from './blocks.js';
import { hash32 } from '../core/rng.js';

// Which blocks stop sky light (used for the heightmap)
export const BLOCKS_SKY = new Uint8Array(256);
for (let i = 0; i < BLOCKS.length; i++) {
  if (!BLOCKS[i]) continue;
  BLOCKS_SKY[i] = (IS_AIRLIKE[i] || IS_CROSS[i] || i === B.GLASS) ? 0 : 1;
}

// Per-face tint channel for each block: [top, bottom, side]
const FACE_TINT = [];
for (let i = 0; i < BLOCKS.length; i++) {
  const b = BLOCKS[i];
  if (!b) continue;
  FACE_TINT[i] = [b.tint, b.tint, b.sideTint ?? b.tint];
}
FACE_TINT[B.GRASS] = [TINT.grass, TINT.dirt, TINT.grass];
FACE_TINT[B.SNOW_GRASS] = [TINT.none, TINT.dirt, TINT.dirt];

const NATURAL = new Uint8Array(256);
for (let i = 0; i < BLOCKS.length; i++) if (BLOCKS[i] && BLOCKS[i].tint !== TINT.none) NATURAL[i] = 1;

// Face table: normal, 4 corners, uvs, shade, tile slot (0 top,1 bottom,2 side)
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], shade: 0.8, slot: 2 },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], shade: 0.8, slot: 2 },
  { n: [0, 1, 0], c: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], uv: [[0, 0], [0, 1], [1, 1], [1, 0]], shade: 1.0, slot: 0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], shade: 0.5, slot: 1 },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], shade: 0.65, slot: 2 },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uv: [[0, 0], [1, 0], [1, 1], [0, 1]], shade: 0.65, slot: 2 },
];
// Precompute AO neighbour offsets per face corner: [side1, side2, corner]
for (const f of FACES) {
  const axis = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2;
  const tangents = [0, 1, 2].filter((a) => a !== axis);
  f.ao = f.c.map((corner) => {
    const s1 = [0, 0, 0], s2 = [0, 0, 0], cc = [0, 0, 0];
    const t1 = tangents[0], t2 = tangents[1];
    s1[t1] = corner[t1] ? 1 : -1;
    s2[t2] = corner[t2] ? 1 : -1;
    cc[t1] = s1[t1]; cc[t2] = s2[t2];
    return [s1, s2, cc];
  });
}

const AO_CURVE = [0.42, 0.62, 0.8, 1.0];

class Buf {
  constructor(quads = 8192) { this.alloc(quads); }
  alloc(q) {
    this.cap = q;
    this.pos = new Float32Array(q * 12);
    this.uvl = new Float32Array(q * 12);
    this.tint = new Uint8Array(q * 12);
    this.light = new Uint8Array(q * 12);
    this.idx = new Uint32Array(q * 6);
    this.q = 0;
  }
  reset() { this.q = 0; }
  grow() {
    const o = this;
    const n = new Buf(0);
    n.alloc(this.cap * 2);
    n.pos.set(o.pos); n.uvl.set(o.uvl); n.tint.set(o.tint); n.light.set(o.light); n.idx.set(o.idx);
    n.q = o.q;
    Object.assign(this, n);
  }
  result() {
    const q = this.q;
    return {
      pos: this.pos.slice(0, q * 12),
      uvl: this.uvl.slice(0, q * 12),
      tint: this.tint.slice(0, q * 12),
      light: this.light.slice(0, q * 12),
      idx: this.idx.slice(0, q * 6),
    };
  }
}

const bufs = [new Buf(), new Buf(2048), new Buf(2048)];

// data: padded voxel array, heights: padded top-sky-blocker (Int16, -1 = none),
// tints: flat rgb array per tint channel, ox/oz: world origin of chunk (not padded)
export function meshChunk(data, heights, tints, ox, oz) {
  for (const b of bufs) b.reset();
  const PWW = PW * PW;

  const skyAt = (px, y, pz) => {
    if (y >= HEIGHT) return 1;
    if (y < 0) return 0;
    const id = data[px + PW * (pz + PW * y)];
    if (id === B.LIT_AIR) return 1;
    return y > heights[px + PW * pz] ? 1 : 0;
  };
  const opaqueAt = (px, y, pz) => {
    if (y < 0) return 1;
    if (y >= HEIGHT) return 0;
    return IS_OPAQUE[data[px + PW * (pz + PW * y)]];
  };

  let maxY = 0;
  for (let i = 0; i < PWW; i++) if (heights[i] > maxY) maxY = heights[i];
  // structures (floating islands, lit rooms) can sit above the sky height, scan conservatively
  maxY = HEIGHT - 1;

  for (let y = 0; y <= maxY; y++) {
    for (let pz = 1; pz <= CHUNK; pz++) {
      for (let px = 1; px <= CHUNK; px++) {
        const id = data[px + PW * (pz + PW * y)];
        if (IS_AIRLIKE[id]) continue;
        const def = BLOCKS[id];
        if (!def) continue;
        const pass = BLOCK_PASS[id];
        const buf = bufs[pass];
        const emit = BLOCK_EMIT[id];
        const wx = ox + px - 1, wz = oz + pz - 1;

        if (IS_CROSS[id]) {
          emitCross(buf, def, id, px, y, pz, wx, wz, tints, skyAt(px, y, pz), emit);
          continue;
        }
        const liquid = IS_LIQUID[id];
        const liquidTop = liquid && !(y + 1 < HEIGHT && data[px + PW * (pz + PW * (y + 1))] === id);
        const ft = FACE_TINT[id];
        let vr = 1;
        if (NATURAL[id]) vr = 0.93 + (hash32(wx, y, wz) & 255) / 255 * 0.14;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const nx = px + face.n[0], ny = y + face.n[1], nz = pz + face.n[2];
          let nid;
          if (ny < 0) nid = B.BEDROCK;
          else if (ny >= HEIGHT) nid = B.AIR;
          else nid = data[nx + PW * (nz + PW * ny)];
          // culling rules
          if (liquid) {
            if (nid === id || IS_OPAQUE[nid]) continue;
            if (f === 3 && !IS_AIRLIKE[nid]) continue;
          } else if (pass === 0) {
            if (IS_OPAQUE[nid]) continue;
          } else {
            if (IS_OPAQUE[nid] || nid === id) continue;
          }
          if (buf.q >= buf.cap) buf.grow();
          const q = buf.q++;
          const tile = def.tiles[face.slot];
          const tintCh = ft[face.slot];
          const tr = tints[tintCh * 3] * vr, tg = tints[tintCh * 3 + 1] * vr, tb = tints[tintCh * 3 + 2] * vr;
          const aoVals = [0, 0, 0, 0];
          for (let v = 0; v < 4; v++) {
            const c = face.c[v];
            const o = q * 12 + v * 3;
            let vy = y + c[1];
            if (liquidTop && c[1] === 1) vy -= 0.12;
            buf.pos[o] = px - 1 + c[0];
            buf.pos[o + 1] = vy;
            buf.pos[o + 2] = pz - 1 + c[2];
            buf.uvl[o] = face.uv[v][0];
            buf.uvl[o + 1] = face.uv[v][1];
            buf.uvl[o + 2] = tile;
            buf.tint[o] = Math.min(255, tr * 255);
            buf.tint[o + 1] = Math.min(255, tg * 255);
            buf.tint[o + 2] = Math.min(255, tb * 255);
            // ambient occlusion + light
            let ao = 3, sky;
            const aoo = face.ao[v];
            const s1x = nx + aoo[0][0], s1y = ny + aoo[0][1], s1z = nz + aoo[0][2];
            const s2x = nx + aoo[1][0], s2y = ny + aoo[1][1], s2z = nz + aoo[1][2];
            const ccx = nx + aoo[2][0], ccy = ny + aoo[2][1], ccz = nz + aoo[2][2];
            if (!liquid && emit < 0.9) {
              const a1 = opaqueAt(s1x, s1y, s1z), a2 = opaqueAt(s2x, s2y, s2z), a3 = opaqueAt(ccx, ccy, ccz);
              ao = (a1 && a2) ? 0 : 3 - (a1 + a2 + a3);
              let sum = skyAt(nx, ny, nz), cnt = 1;
              if (!a1) { sum += skyAt(s1x, s1y, s1z); cnt++; }
              if (!a2) { sum += skyAt(s2x, s2y, s2z); cnt++; }
              if (!a3 && !(a1 && a2)) { sum += skyAt(ccx, ccy, ccz); cnt++; }
              sky = sum / cnt;
            } else {
              sky = skyAt(nx, ny, nz);
            }
            aoVals[v] = ao;
            buf.light[o] = AO_CURVE[ao] * face.shade * 255;
            buf.light[o + 1] = sky * 255;
            buf.light[o + 2] = emit * 255;
          }
          const base = q * 4, io = q * 6;
          if (aoVals[0] + aoVals[2] >= aoVals[1] + aoVals[3]) {
            buf.idx[io] = base; buf.idx[io + 1] = base + 1; buf.idx[io + 2] = base + 2;
            buf.idx[io + 3] = base; buf.idx[io + 4] = base + 2; buf.idx[io + 5] = base + 3;
          } else {
            buf.idx[io] = base + 1; buf.idx[io + 1] = base + 2; buf.idx[io + 2] = base + 3;
            buf.idx[io + 3] = base + 1; buf.idx[io + 4] = base + 3; buf.idx[io + 5] = base;
          }
        }
      }
    }
  }
  return { opaque: bufs[0].result(), cutout: bufs[1].result(), translucent: bufs[2].result() };
}

function emitCross(buf, def, id, px, y, pz, wx, wz, tints, sky, emit) {
  const h = hash32(wx, y, wz, 91);
  const jx = ((h & 15) / 15 - 0.5) * 0.4;
  const jz = (((h >> 4) & 15) / 15 - 0.5) * 0.4;
  const scale = 0.8 + ((h >> 8) & 15) / 15 * 0.4;
  const tile = def.tiles[2];
  const tc = def.tint;
  const tr = tints[tc * 3], tg = tints[tc * 3 + 1], tb = tints[tc * 3 + 2];
  const cx = px - 1 + 0.5 + jx, cz = pz - 1 + 0.5 + jz;
  const r = 0.45 * scale;
  const hgt = Math.min(1.0, scale);
  const quads = [
    [[cx - r, cz - r], [cx + r, cz + r]],
    [[cx - r, cz + r], [cx + r, cz - r]],
  ];
  for (const [a, b] of quads) {
    if (buf.q >= buf.cap) buf.grow();
    const q = buf.q++;
    const verts = [[a[0], y, a[1], 0, 0], [b[0], y, b[1], 1, 0], [b[0], y + hgt, b[1], 1, 1], [a[0], y + hgt, a[1], 0, 1]];
    for (let v = 0; v < 4; v++) {
      const o = q * 12 + v * 3;
      buf.pos[o] = verts[v][0]; buf.pos[o + 1] = verts[v][1]; buf.pos[o + 2] = verts[v][2];
      buf.uvl[o] = verts[v][3]; buf.uvl[o + 1] = verts[v][4]; buf.uvl[o + 2] = tile;
      buf.tint[o] = Math.min(255, tr * 255); buf.tint[o + 1] = Math.min(255, tg * 255); buf.tint[o + 2] = Math.min(255, tb * 255);
      buf.light[o] = (v < 2 ? 0.7 : 0.95) * 255;
      buf.light[o + 1] = sky * 255;
      buf.light[o + 2] = emit * 255;
    }
    const base = q * 4, io = q * 6;
    buf.idx[io] = base; buf.idx[io + 1] = base + 1; buf.idx[io + 2] = base + 2;
    buf.idx[io + 3] = base; buf.idx[io + 4] = base + 2; buf.idx[io + 5] = base + 3;
  }
}

// Heightmap of the top sky-blocking block for each padded column
export function computeHeights(data, out) {
  for (let pz = 0; pz < PW; pz++) for (let px = 0; px < PW; px++) {
    let h = -1;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      if (BLOCKS_SKY[data[px + PW * (pz + PW * y)]]) { h = y; break; }
    }
    out[px + PW * pz] = h;
  }
  return out;
}

export function computeColumnHeight(data, px, pz) {
  for (let y = HEIGHT - 1; y >= 0; y--) {
    if (BLOCKS_SKY[data[px + PW * (pz + PW * y)]]) return y;
  }
  return -1;
}
