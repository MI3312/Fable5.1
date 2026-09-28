// Furniture for the Hallway, voxelised from signed distance fields like the creatures are, and a
// tiny bitmap font so its signs, plaque and clock read as pixel art rather than smooth print.
import * as THREE from 'three';
import { sdfMesh, sphere, capsule, box, torus, noise3 } from './sdfModel.js';

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const grain = (p, k = 0.06) => 1 - k + noise3(p[0] * 40, p[1] * 40, p[2] * 40) * k;

// one flat-lit material for all of it: the voxeliser bakes face shading and corner occlusion into
// the vertex colours, and the hallway dims it with its lights
let mat = null;
export function hallPropMaterial() {
  if (!mat) mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  return mat;
}
const mesh = (key, spec) => sdfMesh('hall:' + key, spec, hallPropMaterial());

// ------------------------------------------------------------------ a 5 x 7 bitmap font
const GLYPHS = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14], 2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14], 6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
  '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8], "'": [4, 4, 8, 0, 0, 0, 0], '-': [0, 0, 0, 31, 0, 0, 0],
  '!': [4, 4, 4, 4, 4, 0, 4], '?': [14, 17, 1, 2, 4, 0, 4], ':': [0, 12, 12, 0, 12, 12, 0], '^': [4, 14, 21, 4, 4, 4, 4], ' ': [0, 0, 0, 0, 0, 0, 0],
};
export function pixelText(x, text, px, py, color, k = 1) {
  x.fillStyle = color;
  let cx = px;
  for (const ch of String(text).toUpperCase()) {
    const g = GLYPHS[ch] || GLYPHS['?'];
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r] & (16 >> c)) x.fillRect(cx + c * k, py + r * k, k, k);
    cx += 6 * k;
  }
  return cx;
}
export const textWidth = (text, k = 1) => String(text).length * 6 * k - k;

// a canvas texture with crisp, unsmoothed pixels
export function pixelCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  draw(x, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  return tex;
}

// ------------------------------------------------------------------ the signs, plaque, clock
export function drawExitSign(x, n) {
  x.fillStyle = '#e3b429'; x.fillRect(0, 0, 64, 24);
  x.fillStyle = '#c99c1c'; for (let i = 0; i < 64; i += 2) x.fillRect(i, 23, 1, 1);
  x.fillStyle = '#1b1508'; x.fillRect(1, 1, 62, 1); x.fillRect(1, 22, 62, 1); x.fillRect(1, 1, 1, 22); x.fillRect(62, 1, 1, 22);
  pixelText(x, 'EXIT', 5, 4, '#1b1508');
  pixelText(x, '^', 14, 13, '#1b1508');
  x.fillStyle = '#1b1508'; x.fillRect(31, 4, 1, 16);
  const s = String(n);
  pixelText(x, s, 47 - textWidth(s, 2) / 2, 5, '#1b1508', 2);
}
export function drawPlaque(x, lines) {
  x.fillStyle = '#ebe7dc'; x.fillRect(0, 0, 192, 56);
  x.fillStyle = '#d6d1c4'; for (let i = 0; i < 192; i += 3) x.fillRect(i, 54, 2, 1);
  x.fillStyle = '#2a2826'; x.fillRect(0, 0, 192, 2); x.fillRect(0, 54, 192, 2); x.fillRect(0, 0, 2, 56); x.fillRect(190, 0, 2, 56);
  lines.forEach((l, i) => pixelText(x, l, 96 - textWidth(l) / 2, 8 + i * 11, '#2a2826'));
}
function line(x, x0, y0, x1, y1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
  for (let i = 0; i <= n; i++) x.fillRect(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), 1, 1);
}
export function drawClockFace(x, h, m, s) {
  x.clearRect(0, 0, 32, 32);
  x.fillStyle = '#e8e4da';
  for (let y = 0; y < 32; y++) for (let c = 0; c < 32; c++) if (Math.hypot(c - 15.5, y - 15.5) < 14.5) x.fillRect(c, y, 1, 1);
  x.fillStyle = '#2c2a28';
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; x.fillRect(Math.round(15.5 + Math.sin(a) * 12.5 - 0.5), Math.round(15.5 - Math.cos(a) * 12.5 - 0.5), i % 3 ? 1 : 2, i % 3 ? 1 : 2); }
  const hand = (a, len) => line(x, 15.5, 15.5, 15.5 + Math.sin(a) * len, 15.5 - Math.cos(a) * len);
  hand((h % 12 + m / 60) / 12 * Math.PI * 2, 7);
  x.fillRect(15, 15, 2, 2);
  hand((m + s / 60) / 60 * Math.PI * 2, 11);
  x.fillStyle = '#a3261b'; hand(s / 60 * Math.PI * 2, 12);
}
export function drawHandprints(x) {
  x.clearRect(0, 0, 64, 40);
  const hand = (cx, cy, drag) => {
    x.fillStyle = 'rgba(112, 38, 28, 0.85)';
    x.fillRect(cx - 3, cy, 7, 6); x.fillRect(cx - 2, cy + 6, 5, 1);
    [[-3, 4], [-1, 5], [1, 5], [3, 4]].forEach(([fx, fl]) => x.fillRect(cx + fx, cy - fl, 1, fl));
    x.fillRect(cx + 4, cy + 2, 2, 1); x.fillRect(cx + 5, cy + 1, 1, 1);
    x.fillStyle = 'rgba(112, 38, 28, 0.4)';
    [-3, -1, 1, 3].forEach((fx, i) => x.fillRect(cx + fx, cy + 7, 1, drag - i * 2));
  };
  [[9, 12, 10], [22, 8, 16], [35, 14, 8], [48, 9, 18], [57, 20, 6], [28, 25, 7]].forEach((h) => hand(...h));
}
export function drawShadow(x) {
  x.clearRect(0, 0, 16, 40);
  x.fillStyle = 'rgba(0, 0, 0, 0.62)';
  for (let y = 0; y < 40; y++) for (let c = 0; c < 16; c++) {
    const head = Math.hypot(c - 7.5, y - 5) < 4.2;
    const body = y >= 9 && y < 25 && c >= 3 && c <= 12;
    const arms = y >= 10 && y < 24 && (c === 1 || c === 2 || c === 13 || c === 14);
    const legs = y >= 25 && ((c >= 4 && c <= 6) || (c >= 9 && c <= 11));
    if (head || body || arms || legs) x.fillRect(c, y, 1, 1);
  }
}

// ------------------------------------------------------------------ voxel furniture
// a hanging sign's housing: a shallow box with two faces, on two rods up to the ceiling
export function signHousing() {
  return mesh('signbox', {
    min: [-0.82, -0.34, -0.08], max: [0.82, 0.72, 0.08], step: 0.022,
    sdf: (p) => {
      const frame = box(p, 0, 0, 0, 0.8, 0.31, 0.055, 0.015);
      let d = Math.min(frame, capsule(p, -0.52, 0.25, 0, -0.52, 0.72, 0, 0.02), capsule(p, 0.52, 0.25, 0, 0.52, 0.72, 0, 0.02));
      return d;
    },
    color: (p) => (Math.abs(p[1]) > 0.3 ? [0.22, 0.22, 0.21] : shade([0.26, 0.25, 0.24], grain(p))),
  });
}
export function plaqueFrame() {
  return mesh('plaque', {
    min: [-1.02, -0.36, -0.06], max: [1.02, 0.36, 0.02], step: 0.02,
    sdf: (p) => Math.max(box(p, 0, 0, -0.02, 1.0, 0.34, 0.03, 0.01), -box(p, 0, 0, 0.02, 0.96, 0.3, 0.03)),
    color: (p) => shade([0.62, 0.56, 0.46], grain(p, 0.1)),
  });
}
export function clockFrame() {
  return mesh('clock', {
    min: [-0.36, -0.36, -0.08], max: [0.36, 0.36, 0.06], step: 0.018,
    sdf: (p) => {
      const q = [p[0], p[2], p[1]];
      return Math.min(torus(q, 0, 0, 0, 0.3, 0.04), Math.max(Math.hypot(p[0], p[1]) - 0.3, Math.abs(p[2] + 0.03) - 0.02));
    },
    color: (p) => (Math.hypot(p[0], p[1]) > 0.27 ? shade([0.2, 0.19, 0.18], grain(p)) : [0.78, 0.76, 0.7]),
  });
}
export function extinguisher() {
  const red = [0.62, 0.11, 0.08], black = [0.08, 0.08, 0.08];
  return mesh('ext', {
    min: [-0.16, 0, -0.16], max: [0.2, 0.7, 0.2], step: 0.016,
    sdf: (p) => {
      const r = Math.hypot(p[0], p[2]);
      let d = Math.max(r - 0.095, Math.abs(p[1] - 0.27) - 0.25);
      d = Math.min(d, sphere(p, 0, 0.5, 0, 0.09));
      d = Math.min(d, box(p, 0, 0.6, 0, 0.028, 0.035, 0.028));
      d = Math.min(d, box(p, 0, 0.645, 0.04, 0.012, 0.01, 0.075));
      d = Math.min(d, capsule(p, 0.02, 0.6, 0.02, 0.1, 0.52, 0.09, 0.013), capsule(p, 0.1, 0.52, 0.09, 0.11, 0.25, 0.1, 0.013));
      return d;
    },
    color: (p) => {
      const r = Math.hypot(p[0], p[2]);
      if (p[1] > 0.56 || r < 0.08 && p[1] > 0.5) return black;
      if (r > 0.1) return black;
      if (p[1] > 0.2 && p[1] < 0.36 && p[2] > 0.04) return p[1] > 0.33 || p[1] < 0.23 ? [0.1, 0.1, 0.1] : [0.9, 0.88, 0.82];
      return shade(red, grain(p, 0.1) * (p[1] < 0.04 ? 0.6 : 1));
    },
  });
}
export function fireSign() {
  return pixelCanvas(24, 12, (x) => {
    x.fillStyle = '#b8231a'; x.fillRect(0, 0, 24, 12);
    pixelText(x, 'FIRE', 1, 3, '#f4efe6');
  });
}
export function cctv() {
  const grey = [0.8, 0.79, 0.75];
  return {
    arm: mesh('cctv-arm', {
      min: [-0.06, -0.06, -0.06], max: [0.06, 0.62, 0.06], step: 0.016,
      sdf: (p) => Math.min(capsule(p, 0, 0, 0, 0, 0.55, 0, 0.024), box(p, 0, 0.58, 0, 0.05, 0.02, 0.05)),
      color: (p) => shade(grey, grain(p)),
    }),
    head: mesh('cctv-head', {
      min: [-0.14, -0.13, -0.26], max: [0.14, 0.14, 0.28], step: 0.014,
      sdf: (p) => {
        let d = box(p, 0, 0, 0, 0.09, 0.08, 0.21, 0.03);
        d = Math.min(d, box(p, 0, 0.1, 0.03, 0.115, 0.012, 0.24, 0.004));
        return Math.max(d, -box(p, 0, 0, 0.24, 0.055, 0.055, 0.04));
      },
      color: (p) => (p[2] > 0.18 && Math.abs(p[0]) < 0.06 && Math.abs(p[1]) < 0.06 ? [0.05, 0.05, 0.06] : shade(grey, grain(p))),
    }),
  };
}
export function bench(len = 2.2) {
  const wood = [0.52, 0.36, 0.22], metal = [0.22, 0.22, 0.23];
  return mesh('bench' + len, {
    min: [-len / 2 - 0.05, 0, -0.3], max: [len / 2 + 0.05, 0.9, 0.3], step: 0.025,
    sdf: (p) => {
      let d = 1;
      for (const z of [-0.16, 0, 0.16]) d = Math.min(d, box(p, 0, 0.44, z, len / 2, 0.022, 0.06, 0.01));
      for (const y of [0.62, 0.76]) d = Math.min(d, box(p, 0, y, -0.25, len / 2, 0.05, 0.02, 0.01));
      for (const x of [-len / 2 + 0.15, 0, len / 2 - 0.15]) {
        d = Math.min(d, box(p, x, 0.21, 0.12, 0.025, 0.21, 0.025), box(p, x, 0.21, -0.16, 0.025, 0.21, 0.025));
        d = Math.min(d, box(p, x, 0.4, -0.02, 0.025, 0.02, 0.2), box(p, x, 0.62, -0.26, 0.025, 0.2, 0.02));
      }
      return d;
    },
    color: (p) => {
      const slat = p[1] > 0.4 && p[1] < 0.48 || p[1] > 0.55 && p[2] < -0.22;
      if (!slat) return shade(metal, grain(p));
      return shade(wood, 0.85 + Math.sin(p[0] * 38 + noise3(p[0] * 3, p[1] * 9, p[2] * 9) * 3) * 0.08);
    },
  });
}
// a drinks machine; its front faces +z
export function vending(seed = 0) {
  const body = seed % 2 ? [0.72, 0.16, 0.14] : [0.18, 0.34, 0.6];
  const cans = [[0.85, 0.2, 0.18], [0.95, 0.75, 0.2], [0.2, 0.55, 0.85], [0.92, 0.92, 0.9], [0.3, 0.7, 0.35], [0.9, 0.45, 0.15]];
  return mesh('vend' + (seed % 2), {
    min: [-0.47, 0, -0.4], max: [0.47, 1.98, 0.4], step: 0.02,
    sdf: (p) => {
      let d = box(p, 0, 0.975, 0, 0.45, 0.975, 0.37, 0.02);
      d = Math.max(d, -box(p, -0.1, 1.25, 0.38, 0.27, 0.46, 0.05));   // the window
      d = Math.max(d, -box(p, -0.05, 0.28, 0.38, 0.28, 0.1, 0.08));    // where the can drops
      return d;
    },
    color: (p) => {
      if (p[2] > 0.3) {
        if (p[0] > -0.37 && p[0] < 0.17 && p[1] > 0.79 && p[1] < 1.71) {
          // rows of cans behind the glass
          const col = Math.floor((p[0] + 0.37) / 0.09), row = Math.floor((p[1] - 0.79) / 0.18);
          const fy = ((p[1] - 0.79) % 0.18) / 0.18;
          if (fy < 0.15) return [0.12, 0.13, 0.15];
          const c = cans[(col * 7 + row * 3 + seed) % cans.length];
          return shade(c, 0.75 + 0.25 * Math.sin(((p[0] + 0.37) % 0.09) / 0.09 * Math.PI));
        }
        if (p[0] > 0.22 && p[0] < 0.38 && p[1] > 1.1 && p[1] < 1.62) return Math.floor(p[1] * 22) % 2 ? [0.9, 0.9, 0.8] : [0.15, 0.15, 0.16];
        if (p[1] > 0.16 && p[1] < 0.4 && Math.abs(p[0] + 0.05) < 0.3) return [0.05, 0.05, 0.06];
        if (p[1] > 1.78) return [0.95, 0.94, 0.9];
      }
      return shade(body, grain(p, 0.08));
    },
  });
}
export function bin() {
  return mesh('bin', {
    min: [-0.24, 0, -0.24], max: [0.24, 0.76, 0.24], step: 0.018,
    sdf: (p) => {
      const r = Math.hypot(p[0], p[2]);
      let d = Math.max(r - 0.2, Math.abs(p[1] - 0.35) - 0.35);
      d = Math.min(d, Math.max(Math.abs(r - 0.2) - 0.02, Math.abs(p[1] - 0.71) - 0.03));
      return Math.max(d, -Math.max(r - 0.17, 0.68 - p[1]));
    },
    color: (p) => (p[1] > 0.66 ? [0.12, 0.12, 0.12] : shade([0.3, 0.36, 0.32], grain(p, 0.1) * (Math.sin(Math.atan2(p[2], p[0]) * 24) > 0.7 ? 0.85 : 1))),
  });
}
export function plant() {
  return mesh('plant', {
    min: [-0.4, 0, -0.4], max: [0.4, 1.5, 0.4], step: 0.022,
    sdf: (p) => {
      const r = Math.hypot(p[0], p[2]);
      let d = Math.max(r - 0.2 + p[1] * 0.08, Math.abs(p[1] - 0.22) - 0.22);
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4, rr = 0.24 + (i % 3) * 0.06, h = 0.7 + (i % 4) * 0.16;
        d = Math.min(d, capsule(p, 0, 0.4, 0, Math.cos(a) * rr * 0.4, h * 0.8, Math.sin(a) * rr * 0.4, 0.012), capsule(p, Math.cos(a) * rr * 0.4, h * 0.8, Math.sin(a) * rr * 0.4, Math.cos(a) * rr, h, Math.sin(a) * rr, 0.05, 0.015));
      }
      return d;
    },
    color: (p) => (p[1] < 0.45 ? shade([0.55, 0.52, 0.48], grain(p, 0.1)) : shade([0.26, 0.4, 0.22], 0.8 + noise3(p[0] * 20, p[1] * 20, p[2] * 20) * 0.25)),
  });
}
// a length of handrail with a bracket at each end; it runs along +z
export function handrail(len) {
  const steel = [0.62, 0.61, 0.58];
  return mesh('rail' + len, {
    min: [-0.12, 0.8, -len / 2 - 0.06], max: [0.06, 1.02, len / 2 + 0.06], step: 0.016,
    sdf: (p) => {
      let d = capsule(p, 0, 0.95, -len / 2, 0, 0.95, len / 2, 0.024);
      for (const z of [-len / 2 + 0.25, len / 2 - 0.25]) d = Math.min(d, capsule(p, 0, 0.95, z, -0.1, 0.88, z, 0.014), box(p, -0.1, 0.88, z, 0.012, 0.04, 0.03));
      return d;
    },
    color: (p) => shade(steel, 0.9 + Math.sin(p[2] * 3) * 0.04 + (p[1] > 0.96 ? 0.1 : 0)),
  });
}
