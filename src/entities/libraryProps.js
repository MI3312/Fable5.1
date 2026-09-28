// The Endless Library's furniture: bookcases built board by board with every book on them its
// own shape (sets of matching volumes, gilt bands, labels, a book leaning into a gap, a stack
// lying flat), panelled ends with a brass label holder, rolling ladders, reading tables with
// green-shaded lamps, pendant lamps, card catalogues, book carts and the piles of books in the
// dark stacks. All of it is geometry with its colours baked in (propGeo.js), lit by propLight.js.
//
// A bay is one block wide and six tall, standing on the face of a shelf block and reaching
// SHELF.D out into the aisle. Local frame: x across the face, y up from the floor, +z out.
import { GeoBuilder, rotZ, rotY, rng, mix3, mul3 } from './propGeo.js';

export const SHELF = { D: 0.3, LV0: 0.12, LVH: 0.478, N: 12, H: 6.0 };
const { D, LV0, LVH, N, H } = SHELF;
const TOP = LV0 + N * LVH;
// the floor of each level of a bay, and which level holds a book at block height y (1 or 2)
export const levelFloor = (k) => LV0 + k * LVH;
export const bookLevel = (y) => (y <= 1 ? 2 : 4);

const WOOD = [0.25, 0.145, 0.08], WOOD_HI = [0.34, 0.205, 0.115], WOOD_LO = [0.15, 0.09, 0.052], BACK = [0.07, 0.047, 0.033];
const GILT = [0.76, 0.58, 0.25], BRASS = [0.7, 0.53, 0.24], CREAM = [0.72, 0.66, 0.52], PAGES = [0.7, 0.64, 0.5], INK = [0.12, 0.1, 0.08];
const GREEN = [0.1, 0.24, 0.15], LEATHER = [0.3, 0.12, 0.08];
// leather and cloth: oxblood, red, bottle green, olive, navy, slate, brown, tan, vellum, black, plum, ochre, grey
const PAL = [[0.42, 0.1, 0.085], [0.56, 0.15, 0.1], [0.12, 0.27, 0.17], [0.34, 0.33, 0.15], [0.1, 0.14, 0.3], [0.23, 0.3, 0.4],
  [0.36, 0.21, 0.11], [0.62, 0.46, 0.27], [0.78, 0.72, 0.57], [0.08, 0.07, 0.066], [0.3, 0.12, 0.25], [0.64, 0.45, 0.14], [0.42, 0.4, 0.36]];
const WEIGHT = [3, 2, 3, 1, 3, 1, 3, 2, 1, 2, 1, 1, 1];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function pickCol(R) {
  let t = R() * WEIGHT.reduce((a, b) => a + b, 0), i = 0;
  while (t > WEIGHT[i]) { t -= WEIGHT[i]; i++; }
  const k = 0.82 + R() * 0.3, c = PAL[i];
  return [c[0] * k * (0.95 + R() * 0.1), c[1] * k, c[2] * k * (0.95 + R() * 0.1)];
}
function stripsFor(style, col, R) {
  const dk = mul3(col, 0.82), rib = mul3(col, 1.35);
  switch (style) {
    case 1: return [[0, 0.8, col], [0.8, 0.825, GILT], [0.825, 0.87, col], [0.87, 0.895, GILT], [0.895, 1, col]];
    case 2: { const lab = R() < 0.8 ? mul3(CREAM, 0.85) : mul3(col, 0.45); return [[0, 0.6, col], [0.6, 0.72, lab], [0.72, 1, col]]; }
    case 3: return [[0, 0.07, dk], [0.07, 0.095, GILT], [0.095, 0.84, col], [0.84, 0.865, GILT], [0.865, 1, col]];
    case 4: return [[0, 0.14, col], [0.14, 0.17, rib], [0.17, 0.36, col], [0.36, 0.39, rib], [0.39, 0.6, col], [0.6, 0.72, mul3(GILT, 0.8)], [0.72, 0.79, col], [0.79, 0.82, rib], [0.82, 1, col]];
    default: return [[0, 0.5, dk], [0.5, 1, col]];
  }
}

// light falls off into the back of the shelf and under the board above
const bookAO = (x, y, z) => {
  const t = (((y - LV0) % LVH) + LVH) % LVH / LVH;
  return (0.36 + 0.64 * smooth(0.0, 0.27, z)) * (1 - 0.3 * smooth(0.74, 1.0, t));
};
const frameAO = (x, y, z) => 0.5 + 0.5 * smooth(0.0, 0.25, z);

// one level of books between x0 and x1 standing on y0; `simple` keeps only the spines (for bays
// further off); `gap` is an [a, b] range to leave empty (where a book with your name sits)
function bookRow(G, R, y0, x0, x1, clear, simple, gap = null, front = D, ao = bookAO) {
  let x = x0 + R() * 0.012;
  let set = null;
  G.ao = ao;
  const zf0 = front - 0.012;
  // further off, runs of neighbouring books merge into one face of their average colour
  const runs = [];
  const far = (a, b, y, h, z, col) => runs.push([a, b, y, h, z, col]);
  while (x < x1 - 0.022) {
    const lim = gap && x < gap[0] ? gap[0] : x1;
    if (gap && x >= gap[0] - 0.004 && x < gap[1]) { x = gap[1] + 0.004; continue; }
    const room = lim - x;
    if (room < 0.024) { if (gap && lim === gap[0]) { x = gap[1] + 0.004; continue; } break; }
    const r = R();
    if (!set && r < 0.035 && room > 0.3) {
      // a few lying flat
      const n = 2 + Math.floor(R() * 3);
      let y = y0, wmax = 0;
      for (let i = 0; i < n && y < y0 + clear - 0.09; i++) {
        const L = 0.2 + R() * 0.08, t = 0.03 + R() * 0.026, dep = 0.15 + R() * 0.06, col = pickCol(R);
        const ox = x + R() * 0.02, zf = zf0 - R() * 0.03;
        if (simple) far(ox, ox + L, y, t, zf, col);
        else G.box(ox, y, zf - dep, ox + L, y + t, zf, col, { skip: 'nz ny', cols: { py: mul3(col, 1.08) }, strips: [[0, 0.35, col], [0.35, 0.5, GILT], [0.5, 1, col]] });
        y += t; wmax = Math.max(wmax, L + (ox - x));
      }
      x += wmax + 0.01;
      continue;
    }
    if (!set && r < 0.075 && room > 0.1) {
      // one leaning into a gap
      const w = 0.03 + R() * 0.03, h = clear * (0.62 + R() * 0.26), a = 0.14 + R() * 0.26;
      const need = w * Math.cos(a) + h * Math.sin(a) + 0.006;
      if (need < room) {
        const xr = x + need, col = pickCol(R), dep = 0.16 + R() * 0.07, zf = zf0 - R() * 0.02;
        if (simple) far(x + need - w - h * Math.sin(a), xr, y0, h * Math.cos(a) * 0.8, zf, mul3(col, 0.8));
        else G.with(rotZ(a, xr, y0), () => G.box(xr - w, y0, zf - dep, xr, y0 + h, zf, col, { skip: 'nz', strips: stripsFor(Math.floor(R() * 5), col, R), cols: { py: mix3(PAGES, col, 0.35) } }));
        x = xr + 0.003;
        continue;
      }
    }
    if (!set && r < 0.11) { x += 0.02 + R() * 0.07; continue; } // a book missing
    if (!set && r < 0.2) {
      // a set: several matching volumes
      set = { n: 3 + Math.floor(R() * 7), w: 0.034 + R() * 0.03, h: clear * (0.66 + R() * 0.26), col: pickCol(R), style: [1, 3, 4][Math.floor(R() * 3)], dep: 0.17 + R() * 0.06 };
    }
    const w = Math.min(room, set ? set.w : (R() < 0.12 ? 0.07 + R() * 0.035 : 0.026 + R() * 0.044));
    const h = set ? set.h * (0.99 + R() * 0.02) : clear * (0.56 + R() * 0.38);
    const dep = set ? set.dep : 0.15 + R() * 0.09;
    const zf = zf0 - (set ? 0.004 : R() * 0.026);
    const col = set ? mul3(set.col, 0.96 + R() * 0.08) : pickCol(R);
    if (simple) far(x, x + w, y0, h, zf, col);
    else G.box(x, y0, zf - dep, x + w, y0 + h, zf, col, { skip: 'nz ny', strips: stripsFor(set ? set.style : Math.floor(R() * 6), col, R), cols: { py: mix3(PAGES, col, 0.3) } });
    x += w + (R() < 0.3 ? 0.002 : 0);
    if (set && --set.n <= 0) set = null;
  }
  for (let i = 0; i < runs.length;) {
    let j = i, h = 0, c = [0, 0, 0], z = 0;
    while (j < runs.length && (j === i || (runs[j][0] - runs[j - 1][1] < 0.01 && runs[j][1] - runs[i][0] < 0.17))) j++;
    for (let k = i; k < j; k++) { h += runs[k][3]; z += runs[k][4]; for (let q = 0; q < 3; q++) c[q] += runs[k][5][q]; }
    const n = j - i;
    h /= n; z /= n;
    const a = runs[i][0], b = runs[j - 1][1], y = runs[i][2];
    G.quad([a, y, z], [b, y, z], [b, y + h, z], [a, y + h, z], mul3(c, 1 / n), 0.9);
    i = j;
  }
  G.ao = null;
}

// the carcass of a bay: sides, plinth, boards, cornice, the brass ladder rail, the back
function bayFrame(G, from = 0) {
  G.ao = frameAO;
  G.box(-0.5, 0, 0, -0.465, H, D, WOOD, { skip: 'nz' });
  G.box(0.465, 0, 0, 0.5, H, D, WOOD, { skip: 'nz' });
  if (from === 0) G.box(-0.465, 0, 0, 0.465, LV0, D - 0.006, WOOD_LO, { skip: 'nz ny px nx' });
  for (let k = Math.max(1, from); k < N; k++) {
    const y = levelFloor(k);
    G.box(-0.465, y - 0.032, 0, 0.465, y, D - 0.01, k === from ? WOOD_HI : WOOD, { skip: 'nz px nx' });
  }
  G.box(-0.5, TOP, 0, 0.5, TOP + 0.06, D + 0.012, WOOD_HI, { skip: 'nz' });
  G.box(-0.5, TOP + 0.06, 0, 0.5, H, D + 0.045, WOOD, { skip: 'nz' });
  G.box(-0.5, TOP - 0.045, 0, 0.5, TOP, D + 0.004, WOOD_LO, { skip: 'nz py' });
  G.box(-0.5, 5.2, D + 0.05, 0.5, 5.235, D + 0.085, BRASS, { skip: 'nz px nx' });
  for (const x of [-0.25, 0.25]) G.box(x - 0.012, 5.19, D - 0.01, x + 0.012, 5.245, D + 0.05, mul3(BRASS, 0.8), { skip: 'nz' });
  G.ao = null;
  const y0 = from === 0 ? LV0 : levelFloor(from);
  G.quad([-0.465, y0, 0.004], [0.465, y0, 0.004], [0.465, TOP, 0.004], [-0.465, TOP, 0.004], BACK, 1);
}

// a bay of books. o.gap: level holding a gap in the middle; o.door: no shelves below the lintel
export function bayGeometry(seed, o = {}) {
  const out = {};
  for (const simple of [false, true]) {
    const G = new GeoBuilder(), R = rng(seed * 7919 + 17);
    const from = o.door ? 6 : 0;
    bayFrame(G, from);
    for (let k = from; k < N; k++) {
      const y0 = levelFloor(k);
      const gap = o.gap === k ? [-0.06, 0.06] : null;
      bookRow(G, R, y0, -0.462, 0.462, LVH - 0.036, simple, gap);
    }
    out[simple ? 'mid' : 'near'] = G.build();
  }
  return out;
}

// the panelled end of a range, reaching over the corners where the bays stick out beside it
export function endPanelGeometry(extL, extR) {
  const G = new GeoBuilder();
  const xa = -0.5 - (extL ? D : 0), xb = 0.5 + (extR ? D : 0);
  G.ao = frameAO;
  G.box(xa, 0, 0, xb, H, D - 0.02, WOOD, { skip: 'nz' });
  for (const [y0, y1] of [[0.34, 2.95], [3.15, 5.55]]) {
    G.box(xa + 0.07, y0, D - 0.02, xa + 0.13, y1, D, WOOD_HI, { skip: 'nz' });
    G.box(xb - 0.13, y0, D - 0.02, xb - 0.07, y1, D, WOOD_HI, { skip: 'nz' });
    G.box(xa + 0.13, y0, D - 0.02, xb - 0.13, y0 + 0.07, D, WOOD_HI, { skip: 'nz' });
    G.box(xa + 0.13, y1 - 0.07, D - 0.02, xb - 0.13, y1, D, WOOD_HI, { skip: 'nz' });
    G.box(xa + 0.17, y0 + 0.11, D - 0.02, xb - 0.17, y1 - 0.11, D - 0.008, mul3(WOOD, 1.1), { skip: 'nz' });
  }
  G.box(xa - 0.01, 0, 0, xb + 0.01, 0.17, D + 0.016, WOOD_LO, { skip: 'nz ny' });
  G.box(xa, TOP, 0, xb, TOP + 0.06, D + 0.012, WOOD_HI, { skip: 'nz' });
  G.box(xa - 0.02, TOP + 0.06, 0, xb + 0.02, H, D + 0.045, WOOD, { skip: 'nz' });
  // a brass label holder with a card in it
  const cx = (xa + xb) / 2;
  G.box(cx - 0.14, 1.52, D - 0.008, cx + 0.14, 1.7, D + 0.012, BRASS, { skip: 'nz' });
  G.box(cx - 0.115, 1.545, D + 0.012, cx + 0.115, 1.675, D + 0.016, CREAM, { skip: 'nz ny', strips: [[0, 0.22, CREAM], [0.22, 0.34, INK], [0.34, 0.56, CREAM], [0.56, 0.7, INK], [0.7, 1, CREAM]] });
  G.ao = null;
  return G.build();
}

// a rolling ladder hooked on the rail, leaning out into the aisle
export function ladderGeometry() {
  const G = new GeoBuilder();
  const za = 1.02, zb = D + 0.1, ya = 0.06, yb = 5.3;
  for (const x of [-0.22, 0.22]) {
    G.beam([x, ya, za], [x, yb, zb], 0.055, WOOD_HI);
    G.box(x - 0.03, 0, za - 0.06, x + 0.03, 0.09, za + 0.06, [0.08, 0.07, 0.06]);
    G.beam([x, yb - 0.05, zb], [x, 5.27, D + 0.045], 0.03, BRASS);
  }
  for (let t = 0.07; t < 0.99; t += 0.062) {
    const y = ya + (yb - ya) * t, z = za + (zb - za) * t;
    G.box(-0.22, y - 0.018, z - 0.03, 0.22, y + 0.018, z + 0.03, WOOD, { skip: 'px nx' });
  }
  return G.build();
}

// a reading table, two blocks square, with a green leather top, a couple of books and papers
export function tableGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 5);
  const T = 0.78;
  G.box(-0.92, T - 0.06, -0.92, 0.92, T, 0.92, WOOD_HI);
  G.box(-0.8, T, -0.8, 0.8, T + 0.004, 0.8, GREEN, { skip: 'ny' });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * 0.8, z = sz * 0.8;
    G.box(x - 0.045, 0, z - 0.045, x + 0.045, T - 0.06, z + 0.045, WOOD, { skip: 'ny' });
    G.box(x - 0.065, 0.28, z - 0.065, x + 0.065, 0.4, z + 0.065, WOOD_HI, {});
  }
  G.box(-0.84, T - 0.18, -0.84, 0.84, T - 0.06, -0.78, WOOD, {});
  G.box(-0.84, T - 0.18, 0.78, 0.84, T - 0.06, 0.84, WOOD, {});
  G.box(-0.84, T - 0.18, -0.78, -0.78, T - 0.06, 0.78, WOOD, {});
  G.box(0.78, T - 0.18, -0.78, 0.84, T - 0.06, 0.78, WOOD, {});
  // a closed book or two and an open one
  for (let i = 0; i < 2; i++) {
    const x = -0.5 + R() * 0.7, z = -0.4 + R() * 0.8, a = R() * 3;
    G.with(rotY(a, x, T + 0.004, z), () => G.box(-0.12, 0, -0.08, 0.12, 0.03 + R() * 0.03, 0.08, pickCol(R), { skip: 'ny' }));
  }
  const ox = 0.25 - R() * 0.4, oz = -0.2 + R() * 0.4, oa = R() * 0.8 - 0.4;
  G.with(rotY(oa, ox, T + 0.004, oz), () => {
    G.box(-0.2, 0, -0.14, 0.2, 0.012, 0.14, LEATHER, { skip: 'ny' });
    G.quad([-0.19, 0.03, 0.13], [0, 0.014, 0.13], [0, 0.014, -0.13], [-0.19, 0.03, -0.13], PAGES, 1);
    G.quad([0, 0.014, 0.13], [0.19, 0.03, 0.13], [0.19, 0.03, -0.13], [0, 0.014, -0.13], mul3(PAGES, 1.04), 1);
    G.quad([-0.16, 0.0305, 0.05], [-0.03, 0.0175, 0.05], [-0.03, 0.0175, 0.04], [-0.16, 0.0305, 0.04], INK, 0.9);
  });
  return G.build();
}

export function chairGeometry() {
  const G = new GeoBuilder();
  const S = 0.46;
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) G.box(x - 0.025, 0, z - 0.025, x + 0.025, S - 0.04, z + 0.025, WOOD, { skip: 'ny' });
  G.box(-0.24, S - 0.05, -0.24, 0.24, S, 0.24, WOOD_HI);
  G.box(-0.21, S, -0.21, 0.21, S + 0.025, 0.21, LEATHER, { skip: 'ny' });
  // the back, at -z (the chair faces +z)
  for (const x of [-0.2, 0.2]) G.box(x - 0.025, S, -0.245, x + 0.025, 1.0, -0.2, WOOD, {});
  G.box(-0.225, 0.88, -0.245, 0.225, 1.0, -0.2, WOOD_HI, {});
  for (const x of [-0.1, 0, 0.1]) G.box(x - 0.012, S, -0.235, x + 0.012, 0.88, -0.21, WOOD, { skip: 'py ny' });
  return G.build();
}

// a banker's lamp: brass foot and stem, a green glass shade; the glow is a separate piece
export function bankerLampGeometry() {
  const G = new GeoBuilder(), T = 0.78;
  G.box(-0.1, T, -0.07, 0.1, T + 0.03, 0.07, BRASS, { skip: 'ny' });
  G.box(-0.012, T + 0.03, -0.012, 0.012, T + 0.3, 0.012, BRASS, { skip: 'ny' });
  G.box(-0.17, T + 0.3, -0.07, 0.17, T + 0.34, 0.07, [0.08, 0.3, 0.16], {});
  G.box(-0.16, T + 0.34, -0.055, 0.16, T + 0.37, 0.055, [0.1, 0.36, 0.2], { skip: 'ny' });
  G.box(-0.172, T + 0.28, -0.075, 0.172, T + 0.3, 0.075, BRASS, { skip: 'py' });
  return G.build();
}
export function bankerGlowGeometry() {
  const G = new GeoBuilder(), T = 0.78;
  G.quad([-0.16, T + 0.279, 0.065], [-0.16, T + 0.279, -0.065], [0.16, T + 0.279, -0.065], [0.16, T + 0.279, 0.065], [1.5, 1.2, 0.75], 1);
  G.box(-0.06, T + 0.25, -0.03, 0.06, T + 0.28, 0.03, [1.6, 1.3, 0.8], {});
  return G.build();
}

// a pendant lamp hanging from the ceiling at y = 7 into the air above the shelves
export function pendantGeometry() {
  const G = new GeoBuilder();
  G.box(-0.1, 6.96, -0.1, 0.1, 7.0, 0.1, BRASS, { skip: 'py' });
  G.box(-0.012, 6.52, -0.012, 0.012, 6.96, 0.012, mul3(BRASS, 0.7), { skip: 'py ny' });
  G.box(-0.07, 6.46, -0.07, 0.07, 6.52, 0.07, BRASS, {});
  G.box(-0.14, 6.39, -0.14, 0.14, 6.46, 0.14, [0.46, 0.34, 0.14], { skip: 'ny' });
  G.box(-0.21, 6.32, -0.21, 0.21, 6.39, 0.21, [0.52, 0.38, 0.15], { skip: 'ny' });
  G.box(-0.26, 6.28, -0.26, 0.26, 6.32, 0.26, BRASS, { skip: 'ny' });
  return G.build();
}
export function pendantGlowGeometry() {
  const G = new GeoBuilder();
  G.quad([-0.25, 6.279, 0.25], [-0.25, 6.279, -0.25], [0.25, 6.279, -0.25], [0.25, 6.279, 0.25], [1.4, 1.08, 0.66], 1);
  G.box(-0.07, 6.24, -0.07, 0.07, 6.34, 0.07, [1.7, 1.4, 0.95], {});
  return G.build();
}

// a card catalogue, two blocks long, drawers on both sides
export function catalogueGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 11);
  const L = 0.97, Dp = 0.34, Ht = 1.34;
  G.box(-L, 0, -Dp, L, 0.12, Dp, WOOD_LO, { skip: 'ny' });
  G.box(-L, 0.12, -Dp + 0.02, L, Ht - 0.05, Dp - 0.02, WOOD, { skip: 'ny' });
  G.box(-L - 0.03, Ht - 0.05, -Dp - 0.03, L + 0.03, Ht, Dp + 0.03, WOOD_HI);
  for (const s of [-1, 1]) {
    const z = s * (Dp - 0.02);
    const cols = 10, rows = 6, x0 = -L + 0.08, x1 = L - 0.08, y0 = 0.18, y1 = Ht - 0.1;
    const dw = (x1 - x0) / cols, dh = (y1 - y0) / rows;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const xa = x0 + i * dw + 0.008, xb = xa + dw - 0.016, ya = y0 + j * dh + 0.008, yb = ya + dh - 0.016;
      const out = R() < 0.03 ? 0.12 : 0.012; // a drawer left open
      const c = mul3(WOOD_HI, 0.9 + R() * 0.15);
      if (s > 0) {
        G.box(xa, ya, z, xb, yb, z + out, c, { skip: 'nz' });
        G.box((xa + xb) / 2 - 0.022, ya + 0.02, z + out, (xa + xb) / 2 + 0.022, ya + 0.04, z + out + 0.018, BRASS, { skip: 'nz' });
        G.box((xa + xb) / 2 - 0.03, yb - 0.05, z + out, (xa + xb) / 2 + 0.03, yb - 0.025, z + out + 0.003, CREAM, { skip: 'nz ny py px nx' });
      } else {
        G.box(xa, ya, z - out, xb, yb, z, c, { skip: 'pz' });
        G.box((xa + xb) / 2 - 0.022, ya + 0.02, z - out - 0.018, (xa + xb) / 2 + 0.022, ya + 0.04, z - out, BRASS, { skip: 'pz' });
        G.box((xa + xb) / 2 - 0.03, yb - 0.05, z - out - 0.003, (xa + xb) / 2 + 0.03, yb - 0.025, z - out, CREAM, { skip: 'pz ny py px nx' });
      }
    }
  }
  return G.build();
}

// a wooden book trolley with two tiers of returns
export function cartGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 23);
  const W = 0.42, L = 0.4;
  for (const [x, z] of [[-W, -L], [W, -L], [-W, L], [W, L]]) {
    G.box(x - 0.025, 0.08, z - 0.025, x + 0.025, 0.95, z + 0.025, WOOD, {});
    G.box(x - 0.04, 0, z - 0.04, x + 0.04, 0.08, z + 0.04, [0.06, 0.05, 0.05], {});
  }
  for (const y of [0.2, 0.6]) {
    G.box(-W, y - 0.03, -L, W, y, L, WOOD_HI, {});
    // books both ways along the tier, spines out to +z and -z
    const flat = () => 1;
    bookRow(G, R, y, -W + 0.03, W - 0.03, 0.3, false, null, L, flat);
    G.with((q) => [-q[0], q[1], -q[2]], () => bookRow(G, R, y, -W + 0.03, W - 0.03, 0.3, false, null, L, flat));
  }
  G.box(-W - 0.03, 0.92, -L - 0.03, W + 0.03, 0.97, L + 0.03, WOOD_HI, {});
  return G.build();
}

// books heaped on the floor (dark stacks)
export function pileGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 31);
  const piles = 2 + Math.floor(R() * 2);
  for (let p = 0; p < piles; p++) {
    let y = 0;
    const px = (R() - 0.5) * 0.5, pz = (R() - 0.5) * 0.5, n = 4 + Math.floor(R() * 10);
    for (let i = 0; i < n; i++) {
      const L = 0.2 + R() * 0.1, Wd = 0.14 + R() * 0.06, t = 0.03 + R() * 0.035, a = (R() - 0.5) * 0.9, col = pickCol(R);
      G.with(rotY(a, px + (R() - 0.5) * 0.04, y, pz + (R() - 0.5) * 0.04), () => G.box(-L / 2, 0, -Wd / 2, L / 2, t, Wd / 2, col, {
        skip: 'ny', cols: { px: mix3(PAGES, col, 0.3), nx: col, pz: mix3(PAGES, col, 0.3) },
      }));
      y += t;
    }
  }
  for (let i = 0; i < 4; i++) {
    const col = pickCol(R), x = (R() - 0.5) * 0.8, z = (R() - 0.5) * 0.8;
    G.with(rotY(R() * 6.28, x, 0, z), () => G.box(-0.12, 0, -0.08, 0.12, 0.035, 0.08, col, { skip: 'ny' }));
  }
  return G.build();
}

// a book with your name: pulled out from its shelf and tipped toward you, glowing gold
export function nameBookGeometry() {
  const G = new GeoBuilder();
  const w = 0.09, h = 0.41, dep = 0.25, zf = D + 0.1;
  const C = [1.15, 0.6, 0.13], HI = [1.6, 1.12, 0.42];
  G.with((q) => { const a = 0.2, c = Math.cos(a), s = Math.sin(a), y = q[1], z = q[2] - zf; return [q[0], y * c - z * s, zf + y * s + z * c]; }, () => {
    G.box(-w / 2, 0, zf - dep, w / 2, h, zf, C, {
      skip: 'nz', cols: { py: [1.3, 1.05, 0.6], px: mul3(C, 0.8), nx: mul3(C, 0.8) },
      strips: [[0, 0.07, mul3(C, 0.8)], [0.07, 0.1, HI], [0.1, 0.52, C], [0.52, 0.74, HI], [0.74, 0.84, C], [0.84, 0.87, HI], [0.87, 1, C]],
    });
  });
  return G.build();
}
