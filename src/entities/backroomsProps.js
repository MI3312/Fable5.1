// Furniture for the Backrooms, built board by board like the Library's (propGeo.js): cubicle
// partitions, desks with beige CRT monitors, office chairs, filing cabinets, water coolers and a
// copier; wires hanging through missing ceiling tiles and the tiles that fell; crates, drums and
// pipe runs for Level 1; and the broken things of the regions that have come apart - geometry
// stretched out of the walls in spikes, furniture stuck to the ceiling.
import { GeoBuilder, rotY, rng, mix3, mul3 } from './propGeo.js';
import { pixelText, textWidth } from './hallProps.js';

const FABRIC = [0.46, 0.47, 0.5], FABRIC_DK = [0.38, 0.39, 0.42], TRIM = [0.58, 0.58, 0.56], METAL = [0.5, 0.51, 0.52];
const LAMINATE = [0.7, 0.66, 0.58], BEIGE = [0.78, 0.74, 0.64], BEIGE_DK = [0.62, 0.58, 0.5], DARK = [0.1, 0.1, 0.11];
const PAPER = [0.86, 0.85, 0.8], WOOD = [0.56, 0.42, 0.26], WALLP = [0.86, 0.78, 0.45], WALLP_DK = [0.72, 0.64, 0.34];

// a cubicle partition: 1.5 tall, a block wide along x, thin, fabric in a metal frame
export function partitionGeometry() {
  const G = new GeoBuilder();
  G.box(-0.5, 0.05, -0.04, 0.5, 1.46, 0.04, FABRIC, { skip: 'px nx', strips: [[0, 0.04, FABRIC_DK], [0.04, 1, FABRIC]], cols: { nz: FABRIC } });
  G.box(-0.5, 0, -0.045, 0.5, 0.05, 0.045, DARK, { skip: 'px nx ny' });
  G.box(-0.5, 1.46, -0.05, 0.5, 1.52, 0.05, TRIM, { skip: 'px nx ny' });
  G.box(-0.04, 0, -0.055, 0.04, 1.54, 0.055, TRIM, { skip: 'ny' });
  return G.build();
}

// a desk two blocks long; the sitter is on the +z side, the monitor faces them
export function deskGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 3);
  const T = 0.74;
  G.box(-0.98, T - 0.035, -0.36, 0.98, T, 0.36, LAMINATE, { cols: { pz: mul3(LAMINATE, 0.8), nz: mul3(LAMINATE, 0.8) } });
  G.box(-0.96, 0.1, -0.34, -0.93, T - 0.035, 0.34, METAL, {});
  G.box(-0.9, 0.2, -0.33, 0.5, T - 0.035, -0.3, mul3(LAMINATE, 0.85), {});
  // a pedestal of drawers
  G.box(0.52, 0, -0.34, 0.96, T - 0.035, 0.32, BEIGE_DK, { skip: 'ny', strips: [[0, 0.05, DARK], [0.05, 0.36, BEIGE_DK], [0.36, 0.38, DARK], [0.38, 0.68, BEIGE_DK], [0.68, 0.7, DARK], [0.7, 1, BEIGE_DK]] });
  for (const y of [0.2, 0.44, 0.64]) G.box(0.68, y, 0.32, 0.8, y + 0.02, 0.35, METAL, { skip: 'nz' });
  // the monitor: a beige box with a dark screen (the screen's glow is a piece of its own)
  const mx = -0.35 + R() * 0.2, mz = -0.12;
  G.box(mx - 0.2, T, mz - 0.2, mx + 0.2, T + 0.03, mz + 0.14, BEIGE, {});
  G.box(mx - 0.06, T + 0.03, mz - 0.06, mx + 0.06, T + 0.08, mz + 0.06, BEIGE_DK, {});
  G.box(mx - 0.21, T + 0.08, mz - 0.26, mx + 0.21, T + 0.46, mz + 0.14, BEIGE, { cols: { py: mul3(BEIGE, 0.95) } });
  G.box(mx - 0.15, T + 0.12, mz - 0.36, mx + 0.15, T + 0.4, mz - 0.26, BEIGE_DK, { skip: 'pz' });
  G.box(mx - 0.18, T + 0.11, mz + 0.14, mx + 0.18, T + 0.43, mz + 0.16, BEIGE_DK, { skip: 'nz' });
  // keyboard, papers, a mug
  G.box(mx - 0.22, T, mz + 0.22, mx + 0.2, T + 0.025, mz + 0.34, BEIGE, { skip: 'ny', cols: { py: mix3(BEIGE, DARK, 0.25) } });
  for (let i = 0; i < 3; i++) {
    const x = 0.2 + R() * 0.5, z = -0.1 + R() * 0.3, a = R() * 0.8 - 0.4;
    G.with(rotY(a, x, T + 0.001 + i * 0.002, z), () => G.box(-0.1, 0, -0.14, 0.1, 0.002, 0.14, PAPER, { skip: 'ny nz pz px nx' }));
  }
  if (R() < 0.6) { const x = 0.55 + R() * 0.3, z = -0.2 + R() * 0.2; G.box(x - 0.035, T, z - 0.035, x + 0.035, T + 0.1, z + 0.035, R() < 0.5 ? [0.7, 0.2, 0.15] : [0.85, 0.84, 0.8], { skip: 'ny' }); }
  return G.build();
}
// the glow of a CRT: faint blue-green, a little brighter in the middle
export function screenGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 3);
  const T = 0.74, mx = -0.35 + R() * 0.2, mz = -0.12;
  G.box(mx - 0.14, T + 0.13, mz + 0.14, mx + 0.14, T + 0.39, mz + 0.145, [0.2, 0.42, 0.4], { skip: 'nz px nx py ny', strips: [[0, 0.2, [0.12, 0.3, 0.28]], [0.2, 0.8, [0.26, 0.5, 0.46]], [0.8, 1, [0.12, 0.3, 0.28]]] });
  return G.build();
}

// a swivel chair: five-star base, gas lift, seat and back (the sitter faces +z)
export function officeChairGeometry() {
  const G = new GeoBuilder();
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2;
    G.with(rotY(a), () => { G.box(-0.025, 0.04, 0, 0.025, 0.08, 0.3, DARK, {}); G.box(-0.03, 0, 0.26, 0.03, 0.05, 0.32, [0.2, 0.2, 0.2], {}); });
  }
  G.box(-0.03, 0.08, -0.03, 0.03, 0.42, 0.03, METAL, {});
  G.box(-0.24, 0.42, -0.22, 0.24, 0.5, 0.24, [0.22, 0.24, 0.3], { cols: { py: [0.26, 0.28, 0.35] } });
  G.box(-0.04, 0.5, -0.26, 0.04, 0.62, -0.2, DARK, {});
  G.box(-0.22, 0.6, -0.3, 0.22, 1.02, -0.22, [0.22, 0.24, 0.3], { cols: { pz: [0.26, 0.28, 0.35] } });
  return G.build();
}

// a grey four-drawer filing cabinet (drawers to +z)
export function cabinetGeometry() {
  const G = new GeoBuilder();
  G.box(-0.23, 0, -0.32, 0.23, 1.32, 0.3, [0.55, 0.56, 0.55], { skip: 'ny' });
  for (let k = 0; k < 4; k++) {
    const y = 0.04 + k * 0.32;
    G.box(-0.21, y, 0.3, 0.21, y + 0.29, 0.32, [0.6, 0.61, 0.6], { skip: 'nz' });
    G.box(-0.07, y + 0.19, 0.32, 0.07, y + 0.22, 0.35, METAL, { skip: 'nz' });
    G.box(-0.05, y + 0.23, 0.32, 0.05, y + 0.26, 0.322, PAPER, { skip: 'nz ny py px nx' });
  }
  return G.build();
}

// a water cooler with its blue bottle
export function coolerGeometry() {
  const G = new GeoBuilder();
  G.box(-0.17, 0, -0.17, 0.17, 0.95, 0.17, [0.84, 0.83, 0.8], { skip: 'ny' });
  G.box(-0.06, 0.62, 0.17, 0.06, 0.7, 0.2, [0.3, 0.4, 0.8], { skip: 'nz' });
  G.box(-0.14, 0.95, -0.14, 0.14, 1.36, 0.14, [0.35, 0.55, 0.78], { cols: { py: [0.45, 0.65, 0.85] } });
  G.box(-0.06, 1.36, -0.06, 0.06, 1.42, 0.06, [0.3, 0.5, 0.72], {});
  return G.build();
}
// a big beige copier, lid and paper trays
export function copierGeometry() {
  const G = new GeoBuilder();
  G.box(-0.4, 0, -0.32, 0.4, 0.95, 0.32, BEIGE, { skip: 'ny', strips: [[0, 0.08, DARK], [0.08, 0.3, BEIGE_DK], [0.3, 0.32, DARK], [0.32, 0.55, BEIGE_DK], [0.55, 1, BEIGE]] });
  G.box(-0.38, 0.95, -0.3, 0.38, 1.02, 0.3, [0.35, 0.35, 0.36], {});
  G.box(0.4, 0.55, -0.2, 0.62, 0.58, 0.2, BEIGE_DK, {});
  G.box(0.42, 0.58, -0.18, 0.6, 0.6, 0.18, PAPER, { skip: 'ny' });
  G.box(0.1, 1.02, 0.18, 0.34, 1.05, 0.3, [0.25, 0.4, 0.3], { skip: 'ny' });
  return G.build();
}

// wires dangling from a missing ceiling tile (ceiling at y = 4)
export function wiresGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 7);
  const cols = [[0.12, 0.12, 0.12], [0.55, 0.12, 0.1], [0.7, 0.66, 0.6], [0.2, 0.25, 0.5]];
  const n = 2 + Math.floor(R() * 3);
  for (let i = 0; i < n; i++) {
    let x = (R() - 0.5) * 0.6, z = (R() - 0.5) * 0.6, y = 4.3;
    const len = 0.6 + R() * 1.6, segs = 5, c = cols[Math.floor(R() * cols.length)];
    for (let k = 0; k < segs; k++) {
      const nx = x + (R() - 0.5) * 0.14, nz = z + (R() - 0.5) * 0.14, ny = y - len / segs;
      G.beam([x, y, z], [nx, ny, nz], 0.02, c);
      x = nx; z = nz; y = ny;
    }
  }
  // the broken edge of the tile grid
  G.box(-0.5, 3.98, -0.5, 0.5, 4.0, -0.47, [0.55, 0.55, 0.52], { skip: 'py' });
  G.box(-0.5, 3.98, 0.47, 0.5, 4.0, 0.5, [0.55, 0.55, 0.52], { skip: 'py' });
  return G.build();
}
// the tile that fell, broken on the carpet
export function fallenTileGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 9);
  for (let i = 0; i < 3; i++) {
    const x = (R() - 0.5) * 0.6, z = (R() - 0.5) * 0.6, s = 0.12 + R() * 0.2;
    G.with(rotY(R() * 6.28, x, 0.005 + i * 0.01, z), () => G.box(-s, 0, -s * 0.8, s, 0.02, s * 0.8, [0.84, 0.82, 0.76], { skip: 'ny', cols: { py: [0.8, 0.76, 0.66] } }));
  }
  return G.build();
}

// Level 1: a wooden crate, a pair stacked, an oil drum
export function crateGeometry(stack) {
  const G = new GeoBuilder();
  const one = (y, a, s) => G.with(rotY(a, 0, y, 0), () => {
    G.box(-s, 0, -s, s, s * 2, s, WOOD, { skip: 'ny' });
    for (const t of [0, 1]) {
      const yy = t ? s * 2 - 0.06 : 0;
      G.box(-s - 0.01, yy, -s - 0.01, s + 0.01, yy + 0.06, s + 0.01, mul3(WOOD, 0.75), {});
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) G.box(sx * s - 0.04, 0, sz * s - 0.04, sx * s + 0.04, s * 2, sz * s + 0.04, mul3(WOOD, 0.8), {});
  });
  one(0, 0, 0.44);
  if (stack) one(0.88, 0.3, 0.36);
  return G.build();
}
export function drumGeometry() {
  const G = new GeoBuilder();
  const R = 0.3, n = 10;
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2;
    G.with(rotY(a), () => G.box(-R * 0.32, 0, R * 0.92, R * 0.32, 0.9, R, [0.2, 0.3, 0.55], { skip: 'ny py', strips: [[0, 0.05, [0.4, 0.3, 0.2]], [0.05, 0.3, [0.2, 0.3, 0.55]], [0.3, 0.34, [0.14, 0.2, 0.4]], [0.34, 0.66, [0.22, 0.32, 0.56]], [0.66, 0.7, [0.14, 0.2, 0.4]], [0.7, 1, [0.2, 0.3, 0.55]]] }));
  }
  G.box(-R * 0.94, 0.88, -R * 0.94, R * 0.94, 0.9, R * 0.94, [0.18, 0.26, 0.48], { skip: 'ny' });
  return G.build();
}
// a run of pipes along x under the roof of Level 1 (roof at y = 0 here; the pipes hang below)
export function pipesGeometry() {
  const G = new GeoBuilder();
  G.box(-0.5, -0.32, -0.16, 0.5, -0.2, -0.04, [0.45, 0.42, 0.38], { skip: 'px nx' });
  G.box(-0.5, -0.26, 0.06, 0.5, -0.18, 0.14, [0.52, 0.28, 0.16], { skip: 'px nx' });
  G.box(-0.5, -0.46, 0.22, 0.5, -0.3, 0.38, [0.34, 0.36, 0.38], { skip: 'px nx' });
  G.box(-0.03, -0.5, -0.2, 0.03, 0, 0.42, [0.3, 0.3, 0.3], {});
  return G.build();
}

// the regions that have come apart: a patch of wall pulled out into a spike, as though its
// corners had been flung to a point across the room
export function spikeGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 13);
  const tip = [(R() - 0.5) * 1.6, 1.0 + (R() - 0.5) * 2.2, 1.6 + R() * 2.6];
  const x0 = -0.5 + R() * 0.3, x1 = 0.5 - R() * 0.3, y0 = 0.3 + R() * 1.2, y1 = y0 + 0.4 + R() * 1.4;
  const base = [[x0, y0, 0.01], [x1, y0, 0.01], [x1, y1, 0.01], [x0, y1, 0.01]];
  // smeared wallpaper: stripes run the length of the spike
  for (let i = 0; i < 4; i++) {
    const a = base[i], b = base[(i + 1) % 4];
    const strips = 5;
    for (let k = 0; k < strips; k++) {
      const t0 = k / strips, t1 = (k + 1) / strips;
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2]], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2]];
      const c = k % 2 ? WALLP : WALLP_DK;
      G.quad(p0, p1, tip, tip, c, 0.95, [c, c, mul3(c, 0.55), mul3(c, 0.55)]);
    }
  }
  return G.build();
}

// the same furniture, on the ceiling (ceiling at y = 4)
export function upsideDown(geoFn, H = 4) {
  const g = geoFn();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { p.setY(i, H - p.getY(i)); p.setZ(i, -p.getZ(i)); }
  p.needsUpdate = true;
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

// An arrow and a word scrawled on the wall in marker by somebody who was here before you
// (arrow: '<' '>' '^' 'v'). Only the marker is drawn; faces +z, the wall face at z = 0.
export function graffitiGeometry(arrow, text = 'EXIT', col = [0.5, 0.07, 0.05], seed = 1) {
  const W = 40, H = 18;
  const px = Array.from({ length: H }, () => new Array(W).fill(0));
  const put = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) px[y][x] = 1; };
  const ctx = { fillStyle: 1, fillRect(x, y, w, h) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j); } };
  const R = rng(seed);
  pixelText(ctx, text, Math.floor((W - textWidth(text)) / 2) + Math.round(R() * 2 - 1), 1, 1);
  // a shaky arrow under the word
  const cy = 13, cx = W / 2;
  const wob = () => Math.round((R() - 0.5) * 1.2);
  if (arrow === '<' || arrow === '>') {
    const s = arrow === '>' ? 1 : -1;
    for (let i = -12; i <= 12; i++) { put(cx + i, cy + wob() * 0); put(cx + i, cy + 1); }
    for (let k = 0; k < 5; k++) { put(cx + s * (12 - k), cy - k); put(cx + s * (12 - k), cy + 1 + k); put(cx + s * (11 - k), cy - k); put(cx + s * (11 - k), cy + 1 + k); }
  } else {
    const s = arrow === 'v' ? 1 : -1;
    for (let i = -4; i <= 4; i++) { put(cx, cy + i); put(cx + 1, cy + i); }
    for (let k = 0; k < 4; k++) { put(cx - k, cy + s * (4 - k)); put(cx + 1 + k, cy + s * (4 - k)); }
  }
  const G = new GeoBuilder();
  const S = 0.03, x0 = -W * S / 2, y0 = 1.95, z = 0.012;
  for (let j = 0; j < H; j++) {
    let i = 0;
    while (i < W) {
      if (!px[j][i]) { i++; continue; }
      let k = i;
      while (k < W && px[j][k]) k++;
      const ya = y0 - (j + 1) * S, yb = y0 - j * S;
      G.quad([x0 + i * S, ya, z], [x0 + k * S, ya, z], [x0 + k * S, yb, z], [x0 + i * S, yb, z], mul3(col, 0.85 + R() * 0.3), 1);
      i = k;
    }
  }
  return G.build();
}
