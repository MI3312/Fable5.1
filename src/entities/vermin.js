// Lucid vermin: the strange residents of dream worlds, modelled as signed distance fields
// and voxelised (see sdfModel.js). Each builder returns a rig compatible with CreatureManager:
// root.userData = { body, legs, wings, baseY, head }.
import * as THREE from 'three';
import { hash32 } from '../core/rng.js';
import { applyCurvature } from '../core/shaderlib.js';
import {
  sdfMesh, voxelGlowMaterial, voxelGelMaterial,
  sphere, ellipsoid, capsule, box, smin, noise3, fbm3,
} from './sdfModel.js';

const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function group(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

const eyeGeo = new THREE.BoxGeometry(1, 1, 1);
const eyeMats = new Map();
function glowBox(parent, rgb, w, h, d, x, y, z) {
  const k = rgb.join(',');
  if (!eyeMats.has(k)) eyeMats.set(k, applyCurvature(new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) })));
  const mat = eyeMats.get(k);
  const m = new THREE.Mesh(eyeGeo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------------------------------
// Kodama: small pale spirits with hollow faces. Their heads rattle when you come close.
function buildKodama(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0.45, 0);
  const pale = [1.08, 1.12, 1.16], dark = [0.05, 0.06, 0.07];
  const variant = sp.seed % 3;
  body.add(sdfMesh('kodama-body', {
    min: [-0.28, -0.14, -0.18], max: [0.28, 0.38, 0.18], step: 0.035,
    sdf: (p) => {
      let d = capsule(p, 0, -0.04, 0, 0, 0.26, 0, 0.1, 0.125);
      for (const s of [-1, 1]) d = smin(d, capsule(p, s * 0.1, 0.22, 0, s * 0.21, 0.02, -0.04, 0.042, 0.036), 0.05);
      return d;
    },
    color: (p) => shade(pale, 0.9 + noise3(p[0] * 9, p[1] * 9, p[2] * 9) * 0.06),
  }, voxelGlowMaterial()));
  const head = group(body, 0, 0.5, 0);
  const eyeY = variant === 1 ? 0.2 : 0.15;
  const carve = (p) => {
    const e = Math.min(sphere(p, -0.105, eyeY, -0.26, 0.058), sphere(p, 0.105, eyeY, -0.26, 0.058));
    const m = variant === 2 ? sphere(p, 0, 0.0, -0.26, 0.042) : ellipsoid(p, 0, 0.0, -0.25, 0.055, 0.032, 0.07);
    return Math.min(e, m);
  };
  head.add(sdfMesh('kodama-head' + variant, {
    min: [-0.32, -0.24, -0.32], max: [0.32, 0.5, 0.32], step: 0.035,
    sdf: (p) => {
      let d = variant === 1
        ? ellipsoid(p, 0, 0.14, 0, 0.24, 0.34, 0.23)
        : ellipsoid(p, 0, 0.12, 0, 0.28, 0.28, 0.25);
      d = smin(d, ellipsoid(p, 0, 0.0, -0.02, 0.21, 0.2, 0.21), 0.08);
      return Math.max(d, -carve(p));
    },
    color: (p) => (carve(p) < 0.022 ? dark : shade(pale, 0.92 + noise3(p[0] * 7, p[1] * 7, p[2] * 7) * 0.08)),
  }, voxelGlowMaterial()));
  root.userData = { body, legs: [], wings: [], baseY: body.position.y, head };
  return root;
}

// ------------------------------------------------------------------------------------------
// Preta: impossibly tall, thin black figures that stand at the edge of the fog.
function buildPreta(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 1.72, 0);
  const black = [0.035, 0.03, 0.045];
  const skin = (p) => shade(black, 0.8 + fbm3(p[0] * 4, p[1] * 4, p[2] * 4, 2) * 0.5);
  body.add(sdfMesh('preta-torso', {
    min: [-0.36, -0.14, -0.28], max: [0.36, 1.7, 0.26], step: 0.055,
    sdf: (p) => {
      let d = capsule(p, 0, 0, 0, 0, 1.0, 0.03, 0.12, 0.19);
      d = smin(d, capsule(p, -0.25, 1.0, 0.02, 0.25, 1.0, 0.02, 0.075), 0.08);
      d = smin(d, capsule(p, 0, 1.05, 0.02, 0, 1.32, -0.07, 0.05), 0.05);
      d = smin(d, ellipsoid(p, 0, 1.46, -0.08, 0.12, 0.19, 0.13), 0.05);
      return d;
    },
    color: skin,
  }));
  const head = group(body, 0, 1.46, -0.08);
  for (const s of [-1, 1]) glowBox(head, [0.92, 0.9, 0.86], 0.035, 0.03, 0.02, s * 0.045, 0.02, -0.13);
  const legs = [];
  for (const s of [-1, 1]) {
    const arm = group(body, s * 0.28, 1.0, 0.02);
    arm.add(sdfMesh('preta-arm' + s, {
      min: [-0.16, -1.72, -0.2], max: [0.16, 0.1, 0.12], step: 0.045,
      sdf: (p) => {
        let d = capsule(p, 0, 0, 0, s * 0.05, -1.2, -0.04, 0.06, 0.045);
        d = smin(d, ellipsoid(p, s * 0.06, -1.38, -0.06, 0.05, 0.2, 0.07), 0.04);
        for (let i = 0; i < 3; i++) d = Math.min(d, capsule(p, s * 0.06, -1.5, -0.06 + (i - 1) * 0.04, s * (0.06 + i * 0.015), -1.66, -0.08 + (i - 1) * 0.05, 0.026));
        return d;
      },
      color: skin,
    }));
    arm.userData.phase = s > 0 ? 0 : Math.PI;
    arm.userData.arm = true;
    legs.push(arm);
    const leg = group(body, s * 0.1, 0, 0);
    leg.add(sdfMesh('preta-leg', {
      min: [-0.12, -1.8, -0.22], max: [0.12, 0.1, 0.1], step: 0.05,
      sdf: (p) => Math.min(capsule(p, 0, 0, 0, 0, -1.66, 0, 0.085, 0.055), ellipsoid(p, 0, -1.69, -0.06, 0.065, 0.04, 0.13)),
      color: skin,
    }));
    leg.userData.phase = s > 0 ? Math.PI : 0;
    legs.push(leg);
  }
  root.userData = { body, legs, wings: [], baseY: body.position.y, head };
  return root;
}

// ------------------------------------------------------------------------------------------
// Wildebeest: a shaggy table-backed beast on stilt legs, with a long skull face and curled horns.
function buildWildebeest(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 2.3, 0);
  const fur = sp.c1, fur2 = sp.c2, bone = [0.88, 0.85, 0.76];
  const k = 'wb' + sp.seed;
  body.add(sdfMesh(k + 'body', {
    min: [-0.6, -0.72, -1.05], max: [0.6, 0.32, 1.05], step: 0.07,
    sdf: (p) => {
      let d = box(p, 0, 0, 0, 0.42, 0.16, 0.86, 0.1);
      d = smin(d, ellipsoid(p, 0, -0.12, 0.08, 0.38, 0.24, 0.72), 0.12);
      // shaggy skirt of fur hanging from the table-top
      const skirt = box(p, 0, -0.28, 0, 0.47, 0.26, 0.9, 0.05) + (noise3(p[0] * 11, 0, p[2] * 11) * 0.5 + 0.5) * Math.max(0, -p[1] - 0.1) * 0.9;
      d = Math.min(d, skirt);
      return d + fbm3(p[0] * 7, p[1] * 7, p[2] * 7, 2) * 0.035;
    },
    color: (p) => {
      const n = fbm3(p[0] * 5, p[1] * 5, p[2] * 5, 2);
      const stripe = Math.abs(p[0]) < 0.12 && p[1] > 0.05 ? 0.25 : 0;
      return mix(shade(fur, 0.75 + n * 0.4), fur2, stripe + Math.max(0, -p[1] - 0.3) * 0.5);
    },
  }));
  const head = group(body, 0, 0.05, -0.85);
  head.add(sdfMesh(k + 'head', {
    min: [-0.5, -0.25, -1.02], max: [0.5, 0.95, 0.18], step: 0.045,
    sdf: (p) => {
      let d = capsule(p, 0, 0, 0, 0, 0.36, -0.36, 0.13, 0.1);
      d = smin(d, ellipsoid(p, 0, 0.32, -0.64, 0.13, 0.15, 0.3), 0.06);
      d = smin(d, box(p, 0, 0.22, -0.88, 0.08, 0.08, 0.08, 0.04), 0.05);
      for (const s of [-1, 1]) {
        let h = capsule(p, s * 0.08, 0.42, -0.5, s * 0.28, 0.54, -0.42, 0.05, 0.042);
        h = Math.min(h, capsule(p, s * 0.28, 0.54, -0.42, s * 0.36, 0.76, -0.5, 0.042, 0.03));
        h = Math.min(h, capsule(p, s * 0.36, 0.76, -0.5, s * 0.3, 0.86, -0.62, 0.03, 0.022));
        d = Math.min(d, h);
      }
      const eyes = Math.min(sphere(p, -0.12, 0.38, -0.66, 0.045), sphere(p, 0.12, 0.38, -0.66, 0.045));
      return Math.max(d, -eyes);
    },
    color: (p) => {
      if (Math.abs(Math.abs(p[0]) - 0.12) < 0.06 && Math.abs(p[1] - 0.38) < 0.06 && p[2] < -0.58) return [0.03, 0.02, 0.02];
      if (p[1] > 0.45 && Math.abs(p[0]) > 0.1) return shade(bone, 0.95 + noise3(p[0] * 20, p[1] * 20, p[2] * 20) * 0.05);
      if (p[2] < -0.45) return shade(bone, 0.8 + fbm3(p[0] * 8, p[1] * 8, p[2] * 8, 2) * 0.3);
      return shade(fur, 0.7 + fbm3(p[0] * 6, p[1] * 6, p[2] * 6, 2) * 0.4);
    },
  }));
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const s = i % 2 ? 1 : -1, f = i < 2 ? -1 : 1;
    const leg = group(body, s * 0.32, -0.12, f * 0.68);
    leg.add(sdfMesh('wb-leg' + (sp.seed % 7), {
      min: [-0.13, -2.3, -0.13], max: [0.13, 0.08, 0.13], step: 0.05,
      sdf: (p) => {
        let d = capsule(p, 0, 0, 0, 0, -2.1, 0, 0.075, 0.05);
        d = smin(d, sphere(p, 0, -1.08, 0, 0.085), 0.05);
        return Math.min(d, box(p, 0, -2.15, -0.01, 0.07, 0.06, 0.08, 0.02));
      },
      color: (p) => (p[1] < -2.05 ? [0.08, 0.07, 0.06] : shade(fur2, 0.7 + noise3(0, p[1] * 6, 0) * 0.2)),
    }));
    leg.userData.phase = (f > 0 ? Math.PI : 0) + (s > 0 ? Math.PI : 0);
    legs.push(leg);
  }
  root.userData = { body, legs, wings: [], baseY: body.position.y, head };
  return root;
}

// ------------------------------------------------------------------------------------------
// Gel: a wobbling translucent cube with a glowing heart.
function buildGel(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0.46, 0);
  const c = sp.c1;
  const wob = (p) => noise3(p[0] * 3.5 + sp.seed % 13, p[1] * 3.5, p[2] * 3.5) * 0.045;
  body.add(sdfMesh('gel' + sp.seed, {
    min: [-0.52, -0.5, -0.52], max: [0.52, 0.5, 0.52], step: 0.06,
    sdf: (p) => box(p, 0, 0, 0, 0.42, 0.4, 0.42, 0.17) + wob(p),
    color: (p) => mix(c, [1, 1, 1], Math.max(0, p[1] - 0.2) * 0.9),
  }, voxelGelMaterial()));
  body.add(sdfMesh('gel-core' + (sp.seed % 5), {
    min: [-0.2, -0.26, -0.2], max: [0.2, 0.16, 0.2], step: 0.05,
    sdf: (p) => sphere(p, 0, -0.05, 0, 0.15 + noise3(p[0] * 8, p[1] * 8, p[2] * 8) * 0.03),
    color: () => sp.c3,
  }, voxelGlowMaterial()));
  const head = group(body, 0, 0.08, -0.42);
  for (const s of [-1, 1]) glowBox(head, [0.02, 0.02, 0.03], 0.08, 0.12, 0.03, s * 0.13, 0, -0.02);
  root.userData = { body, legs: [], wings: [], baseY: body.position.y, head, squash: true };
  return root;
}

// ------------------------------------------------------------------------------------------
// BubbleBear: a round pastel bear made of fused bubbles.
function buildBubbleBear(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0.68, 0);
  const c = sp.c1;
  const bub = [];
  for (let i = 0; i < 7; i++) {
    const h = hash32(sp.seed, i, 99);
    const a = (h & 1023) / 1023 * Math.PI * 2, b = ((h >>> 10) & 1023) / 1023 * 1.2 - 0.2;
    bub.push([Math.cos(a) * Math.cos(b) * 0.4, Math.sin(b) * 0.4, Math.sin(a) * Math.cos(b) * 0.4 + 0.05, 0.1 + ((h >>> 20) & 63) / 63 * 0.07]);
  }
  body.add(sdfMesh('bb-body' + sp.seed, {
    min: [-0.6, -0.5, -0.6], max: [0.6, 0.58, 0.62], step: 0.05,
    sdf: (p) => {
      let d = smin(sphere(p, 0, 0, 0.1, 0.42), sphere(p, 0, 0.05, -0.2, 0.36), 0.15);
      for (const q of bub) d = smin(d, sphere(p, q[0], q[1], q[2], q[3]), 0.06);
      return d;
    },
    color: (p) => {
      let hi = 0;
      for (const q of bub) { const r = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (r < q[3]) hi = Math.max(hi, 1 - r / q[3]); }
      return mix(shade(c, 0.9 + Math.max(0, p[1]) * 0.3), [1, 1, 1], hi * 0.55);
    },
  }));
  const head = group(body, 0, 0.36, -0.46);
  const face = (p) => Math.min(sphere(p, -0.11, 0.06, -0.26, 0.05), sphere(p, 0.11, 0.06, -0.26, 0.05), sphere(p, 0, -0.03, -0.37, 0.05));
  head.add(sdfMesh('bb-head' + (sp.seed % 11), {
    min: [-0.4, -0.35, -0.44], max: [0.4, 0.4, 0.34], step: 0.04,
    sdf: (p) => {
      let d = sphere(p, 0, 0, 0, 0.3);
      for (const s of [-1, 1]) d = smin(d, sphere(p, s * 0.21, 0.23, 0.02, 0.1), 0.05);
      return smin(d, ellipsoid(p, 0, -0.07, -0.26, 0.13, 0.1, 0.1), 0.06);
    },
    color: (p) => {
      if (face(p) < 0.015) return [0.05, 0.04, 0.06];
      if (p[2] < -0.22 && p[1] < 0) return mix(c, [1, 1, 1], 0.5);
      if (Math.abs(p[0]) > 0.16 && p[1] > 0.18) return mix(c, sp.c2, 0.6);
      return shade(c, 0.95 + noise3(p[0] * 10, p[1] * 10, p[2] * 10) * 0.05);
    },
  }));
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const s = i % 2 ? 1 : -1, f = i < 2 ? -1 : 1;
    const leg = group(body, s * 0.24, -0.25, f * 0.2 - 0.05);
    leg.add(sdfMesh('bb-leg' + (sp.seed % 11), {
      min: [-0.17, -0.46, -0.17], max: [0.17, 0.1, 0.17], step: 0.05,
      sdf: (p) => capsule(p, 0, 0, 0, 0, -0.3, 0, 0.12, 0.135),
      color: (p) => (p[1] < -0.36 ? shade(sp.c2, 0.8) : c),
    }));
    leg.userData.phase = (f > 0 ? Math.PI : 0) + (s > 0 ? Math.PI : 0);
    legs.push(leg);
  }
  root.userData = { body, legs, wings: [], baseY: body.position.y, head };
  return root;
}

// ------------------------------------------------------------------------------------------
// Lumen Manta: a wide, slow flyer with glowing freckles. Big enough to ride.
// The shapes here only need to know inside from outside, so the wings are planforms with a
// thickness profile rather than true distance fields.
function buildManta(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const top = mix(shade(sp.c1, 0.8), [0.24, 0.26, 0.3], 0.3), belly = mix(sp.c2, [0.92, 0.92, 0.9], 0.62);
  const key = 'manta2:' + (sp.seed % 9);
  const skin = (p) => {
    if (p[1] < -0.01) {
      const gill = Math.abs(p[0]) > 0.2 && Math.abs(p[0]) < 0.42 && p[2] < -0.45 && p[2] > -0.9 && Math.sin(p[2] * 48) > 0.55;
      return gill ? shade(belly, 0.55) : shade(belly, 0.94 + fbm3(p[0] * 4, 0, p[2] * 4, 2) * 0.12);
    }
    if (noise3(p[0] * 5, 0, p[2] * 5) > 0.45 && noise3(p[0] * 19, p[1] * 19, p[2] * 19) > 0.15) return sp.c3;
    return shade(top, 0.82 + fbm3(p[0] * 2.5, 0, p[2] * 2.5, 2) * 0.38);
  };
  body.add(sdfMesh(key + 'body', {
    min: [-1.0, -0.36, -1.95], max: [1.0, 0.42, 3.4], step: 0.05,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0, 0.1, 0.95, 0.27, 1.2);
      d = smin(d, ellipsoid(p, 0, 0.02, -0.95, 0.56, 0.19, 0.42), 0.15);
      d = smin(d, ellipsoid(p, 0, 0.17, 0.95, 0.03, 0.12, 0.16), 0.05);
      // the cephalic fins, curled forward under the mouth
      for (const s of [-1, 1]) {
        d = smin(d, capsule(p, s * 0.42, 0, -1.2, s * 0.36, -0.06, -1.62, 0.09, 0.055), 0.06);
        d = smin(d, capsule(p, s * 0.36, -0.06, -1.62, s * 0.26, -0.16, -1.8, 0.055, 0.03), 0.03);
      }
      return Math.min(d, capsule(p, 0, 0.02, 1.2, 0, 0.08, 3.3, 0.07, 0.012));
    },
    color: skin,
  }));
  const wings = [];
  const tipX = 1.95;
  for (const s of [-1, 1]) {
    const w = group(body, s * 0.72, 0, 0.05);
    w.add(sdfMesh(key + 'wing' + s, {
      min: s < 0 ? [-tipX - 0.1, -0.2, -1.05] : [-0.12, -0.2, -1.05], max: s < 0 ? [0.12, 0.45, 1.0] : [tipX + 0.1, 0.45, 1.0], step: 0.05,
      sdf: (p) => {
        const x = p[0] * s;
        if (x < -0.1 || x > tipX) return 1;
        const k = Math.max(0, x) / tipX;
        // swept leading edge, a trailing edge that curves back to the tip
        const zLe = -0.95 + 1.25 * Math.pow(k, 1.25), zTe = 0.85 - 0.45 * k * k;
        const hc = (zTe - zLe) / 2, zc = (zLe + zTe) / 2;
        if (hc <= 0.01) return 1;
        const q = (p[2] - zc) / hc;
        if (Math.abs(q) >= 1) return 1;
        const th = (0.22 * (1 - k) + 0.018) * Math.sqrt(1 - q * q);
        const camber = 0.18 * k * k;
        return Math.abs(p[1] - camber) - th;
      },
      color: (p) => skin([p[0] + s * 0.72, p[1] - 0.18 * Math.pow(Math.abs(p[0]) / tipX, 2), p[2]]),
    }));
    w.userData.side = s;
    wings.push(w);
  }
  const head = group(body, 0, 0.05, -1.3);
  for (const s of [-1, 1]) glowBox(head, sp.c3, 0.07, 0.05, 0.04, s * 0.32, 0.1, 0.0);
  root.userData = { body, legs: [], wings, baseY: 0, head, slowWings: true };
  return root;
}

// Moth: soft, dusty, with eyes on its wings. It loves your headlamp.
function buildMoth(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const key = 'moth2:' + (sp.seed % 7);
  const base = mix(sp.c1, [0.62, 0.56, 0.48], 0.35);
  const dust = (p) => shade(base, 0.72 + fbm3(p[0] * 9, p[1] * 9, p[2] * 9, 2) * 0.45);
  body.add(sdfMesh(key + 'body', {
    min: [-0.2, -0.2, -0.36], max: [0.2, 0.22, 0.66], step: 0.022,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0.02, -0.08, 0.12, 0.12, 0.14);                       // the furry thorax
      d = smin(d, sphere(p, 0, 0.0, -0.24, 0.08), 0.04);                          // head
      for (let i = 0; i < 5; i++) d = smin(d, ellipsoid(p, 0, -0.01 - i * 0.008, 0.1 + i * 0.1, 0.085 - i * 0.012, 0.075 - i * 0.01, 0.07), 0.03);
      return d + noise3(p[0] * 30, p[1] * 30, p[2] * 30) * 0.012;
    },
    color: (p) => (p[2] > 0.06 && Math.sin(p[2] * 62) > 0.4 ? shade(base, 0.5) : p[2] < -0.28 ? [0.08, 0.07, 0.06] : dust(p)),
  }));
  // feathery antennae
  for (const s of [-1, 1]) {
    body.add(sdfMesh('moth2-feeler' + s, {
      min: [Math.min(0, s * 0.3) - 0.06, -0.04, -0.62], max: [Math.max(0, s * 0.3) + 0.06, 0.34, -0.2], step: 0.016,
      sdf: (p) => {
        let d = capsule(p, s * 0.03, 0.06, -0.28, s * 0.2, 0.26, -0.52, 0.012, 0.008);
        for (let i = 1; i < 7; i++) {
          const t = i / 7, x = s * (0.03 + 0.17 * t), y = 0.06 + 0.2 * t, z = -0.28 - 0.24 * t;
          d = Math.min(d, capsule(p, x, y, z, x + s * 0.05 * (1 - t), y - 0.02, z + 0.03, 0.006, 0.004), capsule(p, x, y, z, x - s * 0.02, y + 0.03, z + 0.04, 0.006, 0.004));
        }
        return d;
      },
      color: () => [0.3, 0.26, 0.2],
    }));
  }
  const wings = [];
  for (const s of [-1, 1]) {
    const w = group(body, s * 0.06, 0.05, -0.05);
    const eye = (p) => Math.hypot(p[0] - s * 0.46, p[2] + 0.05);
    w.add(sdfMesh(key + 'wing' + s, {
      min: s < 0 ? [-0.98, -0.05, -0.5] : [-0.05, -0.05, -0.5], max: s < 0 ? [0.05, 0.05, 0.72] : [0.98, 0.05, 0.72], step: 0.022,
      sdf: (p) => {
        const slab = Math.abs(p[1]) - 0.014;
        const fore = ellipsoid([p[0], 0, p[2]], s * 0.46, 0, -0.1, 0.48, 1, 0.3);
        const hind = ellipsoid([p[0], 0, p[2]], s * 0.3, 0, 0.36, 0.3, 1, 0.3);
        // scalloped hem
        const hem = Math.abs(Math.sin(Math.atan2(p[2], p[0] * s) * 11)) * 0.025;
        return Math.max(slab, Math.min(fore, hind) + hem);
      },
      color: (p) => {
        const e = eye(p);
        if (e < 0.05) return [0.04, 0.03, 0.03];
        if (e < 0.1) return sp.c3;
        if (e < 0.13) return [0.92, 0.88, 0.8];
        const band = Math.abs(Math.hypot(p[0], p[2] + 0.1) - 0.62) < 0.04;
        const vein = Math.abs(Math.sin(Math.atan2(p[2] + 0.1, p[0] * s) * 9)) < 0.08;
        return band ? shade(base, 0.45) : vein ? shade(base, 0.6) : dust(p);
      },
    }));
    w.userData.side = s;
    wings.push(w);
  }
  root.userData = { body, legs: [], wings, baseY: 0, head: body };
  return root;
}

// Lantern Snail: slow, patient, and its shell is a lamp.
function buildSnail(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0.1, 0);
  const key = 'snail' + (sp.seed % 7);
  body.add(sdfMesh(key + 'foot', {
    min: [-0.3, -0.15, -1.15], max: [0.3, 0.5, 0.55], step: 0.04,
    sdf: (p) => {
      let d = capsule(p, 0, 0.04, 0.4, 0, 0.08, -0.75, 0.16, 0.13);
      d = smin(d, sphere(p, 0, 0.18, -0.85, 0.14), 0.06);
      for (const s of [-1, 1]) d = Math.min(d, capsule(p, s * 0.07, 0.22, -0.88, s * 0.12, 0.45, -1.0, 0.025, 0.02), sphere(p, s * 0.12, 0.46, -1.0, 0.04));
      return Math.max(d, -p[1] - 0.12);
    },
    color: (p) => shade(sp.c2, 0.8 + noise3(p[0] * 10, p[1] * 10, p[2] * 10) * 0.2),
  }));
  body.add(sdfMesh(key + 'shell', {
    min: [-0.45, 0.0, -0.45], max: [0.45, 0.95, 0.55], step: 0.04,
    sdf: (p) => {
      let d = 9;
      for (let i = 0; i < 14; i++) {
        const t = i / 13, a = t * Math.PI * 3.2, r = 0.32 * (1 - t * 0.75);
        d = smin(d, sphere(p, Math.cos(a) * r * 0.25, 0.42 + Math.sin(a) * r, 0.05 + Math.cos(a) * r * 0.9, 0.24 * (1 - t * 0.7)), 0.08);
      }
      return d;
    },
    color: (p) => mix(sp.c3, [1, 1, 0.9], Math.max(0, Math.sin((p[1] + p[2]) * 30)) * 0.35),
  }, voxelGlowMaterial()));
  root.userData = { body, legs: [], wings: [], baseY: 0.1, head: body };
  return root;
}

export const VERMIN_BUILDERS = {
  manta: buildManta,
  moth: buildMoth,
  snail: buildSnail,
  kodama: buildKodama,
  preta: buildPreta,
  wildebeest: buildWildebeest,
  gel: buildGel,
  bubblebear: buildBubbleBear,
};

// Species templates. c1..c3 may be overridden by the planet palette.
export const VERMIN = {
  manta: {
    names: ['Lumen Manta', 'Sky Manta', 'Freckled Manta'], size: [1.1, 1.5], temper: 'Curious', diet: 'Photosynthetic',
    note: 'It will carry you if it trusts you', speed: 5.5, rarity: 'Uncommon', produce: 'oxygen',
    hitY: 0, hitR: 2.0, flies: true, ride: { kind: 'flyer', seat: 0.45, speed: 15, boost: 28 },
  },
  moth: {
    names: ['Lamp Moth', 'Dust Moth', 'Night Moth'], size: [0.6, 0.95], temper: 'Watching', diet: 'Light',
    note: 'It will not leave your lamp alone', speed: 4.5, rarity: 'Common', produce: 'carbon',
    hitY: 0, hitR: 0.6, flies: true,
  },
  snail: {
    names: ['Lantern Snail', 'Candle Snail', 'Lamp Snail'], size: [0.8, 1.35], temper: 'Passive', diet: 'Lithovore',
    note: 'Its shell is warm to the touch', speed: 0.7, rarity: 'Uncommon', produce: 'sodium',
    hitY: 0.4, hitR: 0.6,
  },
  kodama: {
    names: ['Kodama', 'Pale Kodama', 'Rattling Kodama'], size: [0.8, 1.05], temper: 'Watching', diet: 'Unknown',
    note: 'Their heads rattle when you come near', speed: 1.6, rarity: 'Uncommon', produce: 'memory_fragment',
    hitY: 0.8, hitR: 0.5, hover: true,
  },
  preta: {
    names: ['Preta', 'Hungry Preta', 'Tall Preta'], size: [1.0, 1.15], temper: 'Watching', diet: 'Hunger',
    note: 'It is never there when you arrive', speed: 1.2, rarity: 'Rare', produce: 'memory_fragment',
    c1: [0.04, 0.035, 0.05], hitY: 2.1, hitR: 1.1, watcher: true,
  },
  wildebeest: {
    names: ['Wildebeest', 'Table Wildebeest', 'Stilt Wildebeest'], size: [0.9, 1.15], temper: 'Passive', diet: 'Grazing',
    note: 'Its back is perfectly flat', speed: 2.0, rarity: 'Common', produce: 'carbon',
    hitY: 2.3, hitR: 1.2, ride: { kind: 'strider', seat: 2.55, speed: 7, boost: 11, step: 2.2 },
  },
  gel: {
    names: ['Gel', 'Lucid Gel', 'Wobbling Gel'], size: [0.7, 1.3], temper: 'Skittish', diet: 'Absorbic',
    note: 'You can see what it ate last', speed: 3.2, rarity: 'Common', produce: 'dihydrogen',
    hitY: 0.5, hitR: 0.6, hops: true, ride: { kind: 'hopper', seat: 0.95, speed: 9, boost: 13, minSize: 0.95 },
  },
  bubblebear: {
    names: ['BubbleBear', 'Soap Bear', 'Foam Bear'], size: [0.9, 1.4], temper: 'Curious', diet: 'Omnivore',
    note: 'It pops if it gets too happy', speed: 2.6, rarity: 'Uncommon', produce: 'oxygen',
    hitY: 0.7, hitR: 0.75, ride: { kind: 'ground', seat: 1.25, speed: 7, boost: 10.5 },
  },
};
