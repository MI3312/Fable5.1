// The Warehouse's furniture, built piece by piece like the Library's (propGeo.js): pallet racking
// with steel uprights every two metres and orange beams, loaded with whatever was never shipped
// (cardboard boxes, shrink-wrapped loads, drums, crates, sacks); braced frames at the ends of the
// runs with guards at their feet; pallets and forklifts on the floor; high-bay lamps and roof
// trusses overhead; a workbench, bolt cutters, batteries, and the chain on the fire door.
//
// A bay stands on the face of a WH_RACK block like a bookcase: one block wide, six tall, reaching
// RACK.D out into the aisle. Local frame: x across the face, y up from the floor, +z out.
import { GeoBuilder, rotY, rotZ, rng, mix3, mul3 } from './propGeo.js';
import { pixelText, textWidth } from './hallProps.js';

export const RACK = { D: 0.36, LEVELS: [0, 1.65, 3.3, 4.95], H: 6.2 };
const { D } = RACK;
const BLUE = [0.15, 0.27, 0.5], BLUE_DK = [0.1, 0.18, 0.34], ORANGE = [0.86, 0.4, 0.08], GALV = [0.55, 0.57, 0.58];
const PALLET = [0.58, 0.46, 0.3], PALLET_DK = [0.42, 0.32, 0.2], CARD = [0.62, 0.47, 0.3], TAPE = [0.74, 0.62, 0.42];
const WRAP = [0.78, 0.8, 0.82], LABEL = [0.88, 0.88, 0.84], YELLOW = [0.9, 0.72, 0.1], DARK = [0.08, 0.08, 0.09];

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const deepAO = (x, y, z) => 0.45 + 0.55 * smooth(-0.1, D * 0.8, z);

// a pallet: deck boards on three stringers
function pallet(G, x0, x1, y, z0, z1) {
  G.box(x0, y, z0, x1, y + 0.1, z1, PALLET_DK, { skip: 'py' });
  const n = 5, w = (x1 - x0) / n;
  for (let i = 0; i < n; i++) G.box(x0 + i * w + 0.01, y + 0.1, z0, x0 + (i + 1) * w - 0.01, y + 0.13, z1, PALLET, { skip: 'ny' });
}
// a cardboard box with a strip of tape over its top and a label on its face
function carton(G, x0, y0, z0, x1, y1, z1, R, simple) {
  const k = 0.85 + R() * 0.25, c = mul3(CARD, k);
  if (simple) { G.box(x0, y0, z0, x1, y1, z1, c, { skip: 'nz ny px nx' }); return; }
  const mx = (x0 + x1) / 2, tw = Math.min(0.06, (x1 - x0) * 0.2);
  G.box(x0, y0, z0, x1, y1, z1, c, { skip: 'nz ny', strips: [[0, 0.88, c], [0.88, 1, mul3(TAPE, k)]] });
  G.quad([mx - tw, y1 + 0.001, z1], [mx + tw, y1 + 0.001, z1], [mx + tw, y1 + 0.001, z0], [mx - tw, y1 + 0.001, z0], mul3(TAPE, k), 1);
  if (R() < 0.6) {
    const lw = Math.min(0.12, (x1 - x0) * 0.3), ly = y0 + (y1 - y0) * (0.3 + R() * 0.3);
    const lx = x0 + 0.03 + R() * Math.max(0, (x1 - x0) - lw - 0.06);
    G.quad([lx, ly, z1 + 0.001], [lx + lw, ly, z1 + 0.001], [lx + lw, ly + lw * 0.7, z1 + 0.001], [lx, ly + lw * 0.7, z1 + 0.001], LABEL, 1);
    G.quad([lx + 0.01, ly + lw * 0.45, z1 + 0.002], [lx + lw - 0.01, ly + lw * 0.45, z1 + 0.002], [lx + lw - 0.01, ly + lw * 0.52, z1 + 0.002], [lx + 0.01, ly + lw * 0.52, z1 + 0.002], DARK, 1);
  }
}
// an eight-sided drum
function drum(G, cx, y0, cz, r, h, col, simple) {
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    G.with(rotY(a, cx, 0, cz), () => G.box(-r * 0.42, y0, r * 0.9, r * 0.42, y0 + h, r, col, {
      skip: simple ? 'ny py nz px nx' : 'ny py nz',
      strips: [[0, 0.08, mul3(col, 0.7)], [0.08, 0.32, col], [0.32, 0.36, mul3(col, 0.7)], [0.36, 0.64, col], [0.64, 0.68, mul3(col, 0.7)], [0.68, 1, col]],
    }));
  }
  G.box(cx - r * 0.95, y0 + h - 0.01, cz - r * 0.95, cx + r * 0.95, y0 + h, cz + r * 0.95, mul3(col, 1.1), { skip: 'ny' });
}

// what sits on one level of a bay
function load(G, R, y0, room, simple) {
  const z0 = -0.2, z1 = D - 0.07;
  const r = R();
  if (r < 0.12) return; // empty
  pallet(G, -0.47, 0.47, y0, z0, z1);
  const y = y0 + 0.13, top = Math.min(room - 0.18, 1.35);
  if (r < 0.46) {
    // stacked cartons of a few sizes
    let x = -0.46;
    while (x < 0.4) {
      const w = Math.min(0.46 - x, 0.2 + R() * 0.28);
      let yy = y;
      const n = 1 + Math.floor(R() * 4);
      const h = Math.min(top / n, 0.22 + R() * 0.3);
      for (let i = 0; i < n && yy + h <= y + top; i++) {
        const inset = R() * 0.03;
        carton(G, x + inset, yy, z0, x + w - inset - 0.01, yy + h, z1 - R() * 0.05, R, simple);
        yy += h;
      }
      x += w;
    }
  } else if (r < 0.66) {
    // a shrink-wrapped load
    const h = top * (0.6 + R() * 0.4);
    G.box(-0.45, y, z0, 0.45, y + h, z1, WRAP, simple ? { skip: 'nz ny px nx' } : { skip: 'nz ny', strips: [[0, 0.3, mul3(WRAP, 0.92)], [0.3, 0.34, [0.6, 0.62, 0.66]], [0.34, 0.7, WRAP], [0.7, 0.74, [0.6, 0.62, 0.66]], [0.74, 1, mul3(WRAP, 1.04)]] });
    if (!simple) G.quad([-0.1, y + h * 0.45, z1 + 0.002], [0.12, y + h * 0.45, z1 + 0.002], [0.12, y + h * 0.6, z1 + 0.002], [-0.1, y + h * 0.6, z1 + 0.002], [0.85, 0.2, 0.15], 1);
  } else if (r < 0.8) {
    // drums
    const col = R() < 0.5 ? [0.2, 0.3, 0.56] : R() < 0.5 ? [0.55, 0.14, 0.1] : [0.3, 0.36, 0.3];
    for (const cx of [-0.24, 0.24]) if (R() < 0.85) drum(G, cx, y, D * 0.35, 0.2, Math.min(top, 0.88), col, simple);
  } else if (r < 0.9) {
    // a wooden crate
    const h = Math.min(top, 0.6 + R() * 0.5);
    G.box(-0.44, y, z0, 0.44, y + h, z1, [0.56, 0.42, 0.26], simple ? { skip: 'nz ny px nx' } : { skip: 'nz ny', strips: [[0, 0.1, [0.44, 0.32, 0.2]], [0.1, 0.9, [0.56, 0.42, 0.26]], [0.9, 1, [0.44, 0.32, 0.2]]] });
  } else {
    // sacks, slumped
    for (let i = 0; i < 3; i++) {
      const x = -0.3 + i * 0.3, h = 0.18 + R() * 0.08;
      G.box(x - 0.15, y + (i % 2) * 0.05, z0, x + 0.15, y + h + (i % 2) * 0.05, z1 - 0.02, [0.72, 0.66, 0.5], { skip: simple ? 'nz ny px nx' : 'nz ny' });
    }
  }
}

// a bay of racking: which side carries the upright (uprights stand every two blocks)
export function rackBayGeometry(seed, side) {
  const out = {};
  for (const simple of [false, true]) {
    const G = new GeoBuilder(), R = rng(seed * 131 + 7);
    G.ao = deepAO;
    const ux = side === 'L' ? -0.5 : side === 'R' ? 0.5 : null;
    if (ux !== null) {
      const x0 = ux - 0.045, x1 = ux + 0.045;
      G.box(x0, 0, D - 0.12, x1, RACK.H, D - 0.02, BLUE, { skip: simple ? 'nz ny' : 'ny', strips: simple ? null : Array.from({ length: 24 }, (_, i) => [i / 24, (i + 0.5) / 24, i % 2 ? BLUE_DK : BLUE]) });
      G.box(x0 - 0.03, 0, D - 0.15, x1 + 0.03, 0.02, D + 0.01, GALV, { skip: 'ny' });
    }
    for (const y of RACK.LEVELS.slice(1)) G.box(-0.5, y - 0.12, D - 0.11, 0.5, y, D - 0.03, ORANGE, { skip: 'nz px nx' });
    RACK.LEVELS.forEach((y, i) => {
      const room = (RACK.LEVELS[i + 1] ?? RACK.H + 0.4) - y;
      load(G, R, y, room, simple);
    });
    G.ao = null;
    out[simple ? 'mid' : 'near'] = G.build();
  }
  return out;
}

// the braced frame at the end of a run, reaching over the corners beside it, with a guard
export function rackEndGeometry(extL, extR) {
  const G = new GeoBuilder();
  const xa = -0.5 - (extL ? D : 0), xb = 0.5 + (extR ? D : 0);
  const posts = [xa + 0.05, xb - 0.05];
  for (const x of posts) G.box(x - 0.05, 0, 0.0, x + 0.05, RACK.H, 0.1, BLUE, { skip: 'nz ny', strips: Array.from({ length: 24 }, (_, i) => [i / 24, (i + 0.5) / 24, i % 2 ? BLUE_DK : BLUE]) });
  // zig-zag bracing between the posts
  let y = 0.25, left = true;
  while (y < RACK.H - 0.6) {
    const a = [left ? posts[0] : posts[1], y, 0.05], b = [left ? posts[1] : posts[0], y + 0.75, 0.05];
    G.beam(a, b, 0.045, BLUE_DK);
    G.box(posts[0], y - 0.02, 0.02, posts[1], y + 0.02, 0.08, BLUE_DK, { skip: 'px nx' });
    y += 0.75; left = !left;
  }
  // a yellow and black guard at its foot
  G.box(xa - 0.04, 0, 0.1, xb + 0.04, 0.42, 0.24, YELLOW, { skip: 'ny', strips: [[0, 0.2, DARK], [0.2, 0.4, YELLOW], [0.4, 0.6, DARK], [0.6, 0.8, YELLOW], [0.8, 1, DARK]] });
  return G.build();
}

// floor pieces: empty pallets stacked, a wrapped load, a heap of cartons, a forklift, a pallet
// jack, a traffic cone
export function palletStackGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 41);
  const n = 2 + Math.floor(R() * 7);
  for (let i = 0; i < n; i++) G.with(rotY((R() - 0.5) * 0.12), () => pallet(G, -0.5, 0.5, i * 0.13, -0.42, 0.42));
  return G.build();
}
export function wrappedGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 43);
  pallet(G, -0.5, 0.5, 0, -0.45, 0.45);
  const h = 0.8 + R() * 0.6;
  G.box(-0.48, 0.13, -0.43, 0.48, 0.13 + h, 0.43, WRAP, { skip: 'ny', strips: [[0, 0.3, mul3(WRAP, 0.92)], [0.3, 0.34, [0.6, 0.62, 0.66]], [0.34, 0.7, WRAP], [0.7, 0.74, [0.6, 0.62, 0.66]], [0.74, 1, mul3(WRAP, 1.04)]] });
  return G.build();
}
export function cartonHeapGeometry(seed) {
  const G = new GeoBuilder(), R = rng(seed + 47);
  for (let i = 0; i < 6; i++) {
    const s = 0.18 + R() * 0.16, x = (R() - 0.5) * 0.6, z = (R() - 0.5) * 0.6, y = i < 4 ? 0 : s * 1.6;
    G.with(rotY(R() * 1.5, x, y, z), () => carton(G, -s, 0, -s, s, s * 1.5, s, R, false));
  }
  return G.build();
}
export function forkliftGeometry() {
  const G = new GeoBuilder();
  const Y = [0.9, 0.7, 0.1], YD = [0.7, 0.52, 0.06];
  // body, counterweight, seat, overhead guard, mast and forks (forks toward +z)
  G.box(-0.55, 0.25, -1.1, 0.55, 1.0, 0.45, Y, { skip: 'ny' });
  G.box(-0.55, 0.25, -1.3, 0.55, 0.95, -1.1, [0.2, 0.2, 0.2], { skip: 'ny' });
  G.box(-0.3, 1.0, -0.6, 0.3, 1.12, -0.1, DARK, {});
  G.box(-0.3, 1.12, -0.62, 0.3, 1.6, -0.52, DARK, {});
  for (const x of [-0.5, 0.5]) for (const z of [-0.9, 0.3]) G.box(x - 0.03, 1.0, z - 0.03, x + 0.03, 2.1, z + 0.03, YD, {});
  G.box(-0.55, 2.1, -0.95, 0.55, 2.16, 0.35, YD, {});
  for (const x of [-0.38, 0.38]) G.box(x - 0.05, 0.05, 0.5, x + 0.05, 2.4, 0.6, [0.25, 0.25, 0.26], {});
  G.box(-0.4, 0.4, 0.6, 0.4, 0.5, 0.64, [0.25, 0.25, 0.26], {});
  for (const x of [-0.25, 0.25]) G.box(x - 0.05, 0.05, 0.64, x + 0.05, 0.1, 1.6, [0.3, 0.3, 0.32], {});
  G.box(-0.05, 1.0, 0.1, 0.05, 1.3, 0.2, DARK, {});
  for (const [x, z, r] of [[-0.55, 0.15, 0.25], [0.55, 0.15, 0.25], [-0.55, -0.9, 0.22], [0.55, -0.9, 0.22]]) G.box(x - 0.1, 0, z - r, x + 0.1, r * 2, z + r, DARK, {});
  return G.build();
}
export function jackGeometry() {
  const G = new GeoBuilder();
  for (const x of [-0.18, 0.18]) G.box(x - 0.08, 0.02, -0.6, x + 0.08, 0.09, 0.55, [0.2, 0.3, 0.6], {});
  G.box(-0.25, 0.02, -0.75, 0.25, 0.3, -0.58, [0.2, 0.3, 0.6], {});
  G.beam([0, 0.3, -0.68], [0, 1.2, -0.95], 0.04, [0.2, 0.2, 0.22]);
  G.box(-0.14, 1.18, -0.99, 0.14, 1.23, -0.92, DARK, {});
  return G.build();
}
export function coneGeometry() {
  const G = new GeoBuilder();
  G.box(-0.18, 0, -0.18, 0.18, 0.04, 0.18, DARK, { skip: 'ny' });
  for (let i = 0; i < 6; i++) {
    const r = 0.13 - i * 0.02, y = 0.04 + i * 0.1;
    G.box(-r, y, -r, r, y + 0.1, r, i === 2 || i === 3 ? [0.9, 0.9, 0.88] : [0.95, 0.35, 0.08], { skip: 'ny' });
  }
  return G.build();
}

// a high-bay lamp: a steel reflector hanging from the roof (y = 10) on a rod; the glow apart
export function highBayGeometry() {
  const G = new GeoBuilder();
  G.box(-0.02, 9.3, -0.02, 0.02, 10, 0.02, [0.25, 0.25, 0.26], { skip: 'py ny' });
  G.box(-0.12, 9.2, -0.12, 0.12, 9.32, 0.12, [0.35, 0.36, 0.38], {});
  for (let i = 0; i < 3; i++) { const r = 0.2 + i * 0.12; G.box(-r, 9.08 - i * 0.07, -r, r, 9.15 - i * 0.07, r, [0.48, 0.5, 0.52], { skip: 'ny' }); }
  return G.build();
}
export function highBayGlowGeometry() {
  const G = new GeoBuilder();
  G.quad([-0.42, 8.93, 0.42], [-0.42, 8.93, -0.42], [0.42, 8.93, -0.42], [0.42, 8.93, 0.42], [1.4, 1.45, 1.5], 1);
  return G.build();
}
// a roof truss, one block of it, running along x just under the roof
export function trussGeometry() {
  const G = new GeoBuilder();
  const c = [0.3, 0.31, 0.33];
  G.box(-0.5, 9.85, -0.06, 0.5, 9.95, 0.06, c, { skip: 'px nx py' });
  G.box(-0.5, 9.2, -0.06, 0.5, 9.3, 0.06, c, { skip: 'px nx' });
  G.beam([-0.5, 9.3, 0], [0.5, 9.85, 0], 0.05, c);
  return G.build();
}

// the maintenance cage's bench, with a vice and a rack of tools
export function benchGeometry() {
  const G = new GeoBuilder();
  const S = [0.4, 0.42, 0.45];
  G.box(-0.95, 0.85, -0.35, 0.95, 0.92, 0.35, [0.5, 0.38, 0.24], {});
  for (const x of [-0.9, 0.9]) for (const z of [-0.3, 0.3]) G.box(x - 0.03, 0, z - 0.03, x + 0.03, 0.85, z + 0.03, S, { skip: 'ny' });
  G.box(-0.9, 0.2, -0.3, 0.9, 0.24, 0.3, S, {});
  G.box(0.55, 0.92, -0.1, 0.8, 1.05, 0.1, [0.25, 0.35, 0.55], {});
  G.box(-0.95, 0.92, -0.37, 0.95, 1.9, -0.33, [0.55, 0.45, 0.3], { strips: Array.from({ length: 10 }, (_, i) => [i / 10, (i + 0.5) / 10, i % 2 ? [0.5, 0.4, 0.26] : [0.58, 0.47, 0.32]]) });
  for (let i = 0; i < 7; i++) { const x = -0.8 + i * 0.22, h = 0.15 + (i * 37 % 10) / 40; G.box(x - 0.015, 1.4 - h, -0.33, x + 0.015, 1.45, -0.3, i % 3 ? [0.6, 0.15, 0.1] : [0.3, 0.3, 0.32], {}); }
  return G.build();
}
// bolt cutters: long red handles, black jaws (lying on the bench, y = bench top)
export function cuttersGeometry() {
  const G = new GeoBuilder();
  G.beam([-0.35, 0.94, -0.05], [0.2, 0.94, 0.0], 0.035, [0.75, 0.1, 0.08]);
  G.beam([-0.35, 0.94, 0.08], [0.2, 0.94, 0.02], 0.035, [0.75, 0.1, 0.08]);
  G.box(0.2, 0.92, -0.04, 0.42, 0.97, 0.05, [0.12, 0.12, 0.13], {});
  return G.build();
}
// a heavy battery with a green charge light (on the floor)
export function batteryGeometry() {
  const G = new GeoBuilder();
  G.box(-0.14, 0, -0.1, 0.14, 0.22, 0.1, [0.16, 0.17, 0.2], { skip: 'ny', strips: [[0, 0.7, [0.16, 0.17, 0.2]], [0.7, 0.85, [0.9, 0.7, 0.1]], [0.85, 1, [0.16, 0.17, 0.2]]] });
  for (const x of [-0.08, 0.08]) G.box(x - 0.025, 0.22, -0.025, x + 0.025, 0.26, 0.025, x < 0 ? [0.8, 0.2, 0.15] : [0.5, 0.5, 0.52], {});
  G.beam([-0.1, 0.24, 0], [0.1, 0.24, 0], 0.02, [0.2, 0.2, 0.2]);
  return G.build();
}
export function batteryGlowGeometry() {
  const G = new GeoBuilder();
  G.box(0.07, 0.15, 0.1, 0.12, 0.19, 0.105, [0.4, 2.2, 0.6], { skip: 'nz' });
  return G.build();
}
// a chain across the fire door and a padlock (door face at z = 0, +z out)
export function chainGeometry() {
  const G = new GeoBuilder();
  const c = [0.45, 0.46, 0.48];
  for (const [a, b] of [[[-0.5, 1.3, 0.06], [0.5, 0.8, 0.06]], [[-0.5, 0.8, 0.07], [0.5, 1.3, 0.07]]]) {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, sag = (t) => Math.sin(t * Math.PI) * -0.08;
      G.beam([a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0 + sag(t0), a[2]], [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1 + sag(t1), a[2]], i % 2 ? 0.035 : 0.025, c);
    }
  }
  G.box(-0.06, 0.9, 0.06, 0.06, 1.05, 0.11, [0.7, 0.55, 0.2], {});
  G.box(-0.04, 1.05, 0.075, 0.04, 1.12, 0.095, c, {});
  return G.build();
}

// A direction sign on the end of a run: pixel letters and an arrow, drawn as runs of coloured
// quads so it batches with everything else. arrow: '<' '>' '^' 'v'. Faces +z, centred on x = 0.
export function signGeometry(text, arrow, bg = [0.86, 0.68, 0.1], fg = [0.07, 0.06, 0.05]) {
  const W = 48, H = 11;
  const px = Array.from({ length: H }, () => new Array(W).fill(0));
  const ctx = { fillStyle: 1, fillRect(x, y, w, h) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (j >= 0 && j < H && i >= 0 && i < W) px[j][i] = this.fillStyle; } };
  ctx.fillStyle = 2; ctx.fillRect(0, 0, W, 1); ctx.fillRect(0, H - 1, W, 1); ctx.fillRect(0, 0, 1, H); ctx.fillRect(W - 1, 0, 1, H);
  // the arrow, in a 7x7 box at the left
  ctx.fillStyle = 2;
  const ax = 3, ay = 2;
  for (let i = 0; i < 7; i++) {
    const half = i < 4 ? i : 6 - i;
    if (arrow === '>') ctx.fillRect(ax + 6 - Math.abs(3 - i) * 1, ay + i, 1, 1), ctx.fillRect(ax, ay + 3, 6, 1);
    if (arrow === '<') ctx.fillRect(ax + Math.abs(3 - i), ay + i, 1, 1), ctx.fillRect(ax + 1, ay + 3, 6, 1);
    if (arrow === '^') ctx.fillRect(ax + 3 - half, ay + half, 1, 1), ctx.fillRect(ax + 3 + half, ay + half, 1, 1), ctx.fillRect(ax + 3, ay, 1, 7);
    if (arrow === 'v') ctx.fillRect(ax + 3 - half, ay + 6 - half, 1, 1), ctx.fillRect(ax + 3 + half, ay + 6 - half, 1, 1), ctx.fillRect(ax + 3, ay, 1, 7);
  }
  const t = String(text).toUpperCase();
  pixelText(ctx, t, 12 + Math.max(0, Math.floor((W - 14 - textWidth(t)) / 2)), 2, 2);
  const G = new GeoBuilder();
  const S = 0.95 / W, x0 = -0.475, y0 = 2.55, z = 0.13;
  G.box(-0.5, y0 - H * S - 0.02, 0.1, 0.5, y0 + 0.02, 0.125, [0.2, 0.2, 0.2], { skip: 'nz' });
  for (let j = 0; j < H; j++) {
    let i = 0;
    while (i < W) {
      const c = px[j][i];
      let k = i;
      while (k < W && px[j][k] === c) k++;
      const col = c === 2 ? fg : bg;
      const ya = y0 - (j + 1) * S, yb = y0 - j * S;
      G.quad([x0 + i * S, ya, z], [x0 + k * S, ya, z], [x0 + k * S, yb, z], [x0 + i * S, yb, z], col, 1);
      i = k;
    }
  }
  return G.build();
}
