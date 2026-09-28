// The ordinary wildlife of every world, sculpted rather than stacked: each species is a set of
// signed distance fields (bodies, skulls, jointed limbs) voxelised into fine blocky meshes, in
// damp, muted colours with a pattern of its own. Rigs are jointed (hips, knees, ankles, wing
// wrists, tail segments) and animated by animFauna(); the fields CreatureManager expects
// (body, legs, wings, head, neck, baseY) are all still there.
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';
import {
  sdfMesh, voxelLitMaterial, voxelGlowMaterial, voxelGelMaterial,
  sphere, ellipsoid, capsule, smin, smax, noise3, fbm3,
} from './sdfModel.js';

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const sat = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const sstep = (a, b, t) => { const x = sat((t - a) / (b - a)); return x * x * (3 - 2 * x); };
const grey = (c) => (c[0] + c[1] + c[2]) / 3;
const mute = (c, k, d) => [0, 1, 2].map((i) => (c[i] + (grey(c) - c[i]) * k) * d);

const EYE = [0.025, 0.022, 0.026], BONE = [0.74, 0.7, 0.6], HOOF = [0.13, 0.11, 0.1];

function group(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// ------------------------------------------------------------------ skin
// Countershaded (dark back, pale belly), mottled, and marked with one pattern per species.
function makeSkin(sp, rng) {
  const top = mute(sp.c1, 0.36, 0.84);
  const side = mute(sp.c1, 0.28, 1.06);
  const belly = mix(mute(sp.c2, 0.5, 1.05), [0.88, 0.84, 0.76], 0.5);
  const mark = mute(sp.c2, 0.28, 0.5);
  return {
    top, side, belly, mark,
    pattern: rng.weighted([['plain', 1.5], ['spots', 2], ['stripes', 2], ['dapple', 1.5], ['saddle', 1.4], ['bands', 1], ['rosette', 1]]),
    freq: rng.range(6, 11),
    accent: sp.c3,
    glowEyes: sp.temper === 'Aggressive' || rng.chance(0.22),
    glowSpots: rng.chance(0.28),
    shag: rng.chance(0.35) ? rng.range(0.012, 0.03) : 0,
  };
}
// colour at a point, given how far up the body it is (-1 belly .. 1 back)
function skinAt(S, p, up) {
  let c = mix(S.belly, S.side, sstep(-0.45, 0.1, up));
  c = mix(c, S.top, sstep(0.3, 0.95, up));
  const f = S.freq, x = p[0] * f, y = p[1] * f, z = p[2] * f;
  if (up > -0.25) {
    switch (S.pattern) {
      case 'spots': if (noise3(x * 1.3, y * 1.3, z * 1.3) > 0.42) c = mix(c, S.mark, 0.85); break;
      case 'stripes': if (Math.sin(z * 1.4 + noise3(x * 0.5, y * 0.5, z * 0.5) * 2.2) > 0.55) c = mix(c, S.mark, 0.8); break;
      case 'dapple': if (noise3(x, y, z) > 0.3) c = mix(c, S.belly, 0.45); break;
      case 'saddle': if (up > 0.45) c = mix(c, S.mark, 0.75); break;
      case 'bands': if (Math.sin(z * 0.9) > 0.35) c = mix(c, S.mark, 0.55); break;
      case 'rosette': { const n = noise3(x * 1.1, y * 1.1, z * 1.1); if (n > 0.38) c = mix(c, S.mark, 0.9); else if (n > 0.26) c = mix(c, S.top, 0.6); break; }
      default: break;
    }
  }
  const m = 0.9 + fbm3(p[0] * 7, p[1] * 7, p[2] * 7, 2) * 0.22;
  return shade(c, m);
}

// ------------------------------------------------------------------ shared parts
// A limb segment hanging from its joint at the origin toward (0, -len, dz), thick to thin.
function limbSpec(len, r0, r1, dz = 0, dx = 0, colorFn) {
  const pad = Math.max(r0, r1) + 0.04;
  return {
    min: [Math.min(0, dx) - pad, -len - pad, Math.min(0, dz) - pad], max: [Math.max(0, dx) + pad, pad, Math.max(0, dz) + pad], step: 0.028,
    sdf: (p) => capsule(p, 0, 0, 0, dx, -len, dz, r0, r1),
    color: colorFn,
  };
}
// eyes: small, dark and wet, set into the skull (or glowing, for the ones that hunt at night)
function eyeSdf(p, ex, ey, ez, r) { return Math.min(sphere(p, ex, ey, ez, r), sphere(p, -ex, ey, ez, r)); }
function glowEyes(parent, key, ex, ey, ez, r, col) {
  parent.add(sdfMesh(key, {
    min: [-ex - r - 0.03, ey - r - 0.03, ez - r - 0.03], max: [ex + r + 0.03, ey + r + 0.03, ez + r + 0.03], step: Math.max(0.012, r * 0.55),
    sdf: (p) => eyeSdf(p, ex, ey, ez, r),
    color: () => mix(col, [1, 1, 1], 0.25),
  }, voxelGlowMaterial()));
}
// a tail (or a thread) as a chain of groups, each holding one tapered segment along dir
function tailChain(parent, key, n, segLen, r0, r1, dir, colorFn) {
  const k = segLen / Math.hypot(dir[0], dir[1], dir[2]);
  const [dx, dy, dz] = [dir[0] * k, dir[1] * k, dir[2] * k];
  const segs = [];
  let g = parent;
  for (let i = 0; i < n; i++) {
    const a = r0 + (r1 - r0) * (i / n), b = r0 + (r1 - r0) * ((i + 1) / n);
    const seg = i === 0 ? g : group(g, dx, dy, dz);
    const pad = a + 0.03;
    seg.add(sdfMesh(`${key}:t${i}`, {
      min: [Math.min(0, dx) - pad, Math.min(0, dy) - pad, Math.min(0, dz) - pad], max: [Math.max(0, dx) + pad, Math.max(0, dy) + pad, Math.max(0, dz) + pad],
      step: Math.max(0.012, Math.min(0.028, a * 0.7)),
      sdf: (p) => capsule(p, 0, 0, 0, dx, dy, dz, a, b),
      color: (p) => colorFn(p, i / n),
    }, voxelLitMaterial()));
    segs.push(seg);
    g = seg;
  }
  return segs;
}

// ------------------------------------------------------------------ four legs
function buildQuad(sp, rng, S, K) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const L = sp.bodyLen, hl = L * 0.45;
  const build = rng.next();
  const lh = sp.legLen * 0.7;
  const bR = 0.25 + build * 0.12;
  const by = lh + bR * 0.55;
  const neckR = 0.11 + build * 0.05;
  const longNeck = sp.longNeck;
  const neckTop = longNeck ? [0, by + 0.95, -hl - 0.3] : [0, by + 0.22, -hl - 0.26];
  const hump = rng.chance(0.3) ? rng.range(0.06, 0.14) : 0;
  const plates = sp.crest;
  body.add(sdfMesh(`${K}:body`, {
    min: [-bR - 0.2, lh - 0.2, -hl - 0.45], max: [bR + 0.2, by + bR + 0.25, hl + 0.3], step: 0.042,
    sdf: (p) => {
      let d = ellipsoid(p, 0, by + 0.03, -hl * 0.35, bR * 0.98, bR * 1.06, hl * 0.66);
      d = smin(d, ellipsoid(p, 0, by, hl * 0.42, bR * 0.9, bR * 0.96, hl * 0.6), 0.2);
      // shoulders and haunches for the legs to grow out of
      for (const s of [-1, 1]) {
        d = smin(d, ellipsoid(p, s * bR * 0.58, by - bR * 0.28, -hl * 0.62, 0.13 + build * 0.04, 0.22, 0.17), 0.1);
        d = smin(d, ellipsoid(p, s * bR * 0.55, by - bR * 0.2, hl * 0.6, 0.15 + build * 0.05, 0.25, 0.2), 0.1);
      }
      if (hump) d = smin(d, ellipsoid(p, 0, by + bR * 0.8, -hl * 0.35, bR * 0.5, hump + 0.08, hl * 0.35), 0.12);
      // neck base, up into the shoulders
      d = smin(d, capsule(p, 0, by + bR * 0.25, -hl * 0.78, 0, by + bR * 0.55, -hl - 0.05, neckR * 1.25, neckR * 1.1), 0.12);
      if (plates) for (let i = 0; i < 6; i++) {
        const z = -hl * 0.7 + i * hl * 0.3;
        d = Math.min(d, ellipsoid(p, 0, by + bR * 0.95 + 0.05, z, 0.022, 0.09 - Math.abs(i - 2.5) * 0.012, 0.07));
      }
      if (S.shag) d += fbm3(p[0] * 9, p[1] * 9, p[2] * 9, 2) * S.shag;
      return d;
    },
    color: (p) => {
      if (plates && p[1] > by + bR * 0.9 && Math.abs(p[0]) < 0.04) return mix(S.mark, S.accent, 0.25);
      const c = skinAt(S, p, (p[1] - by) / bR);
      if (S.glowSpots && Math.abs(p[0]) > bR * 0.7 && noise3(p[0] * 11, p[1] * 11, p[2] * 11) > 0.55) return mix(c, S.accent, 0.8);
      return c;
    },
  }, voxelLitMaterial()));
  if (S.glowSpots) {
    // the spots along the flanks glow faintly, a separate unlit shell so they read in the dark
    body.add(sdfMesh(`${K}:spots`, {
      min: [-bR - 0.1, by - bR * 0.7, -hl * 0.9], max: [bR + 0.1, by + bR * 0.7, hl * 0.9], step: 0.042,
      sdf: (p) => {
        const d = Math.abs(ellipsoid(p, 0, by, 0, bR * 1.02, bR * 1.02, hl * 1.05)) - 0.02;
        return noise3(p[0] * 11, p[1] * 11, p[2] * 11) > 0.62 && Math.abs(p[0]) > bR * 0.6 ? d : 1;
      },
      color: () => S.accent,
    }, voxelGlowMaterial()));
  }
  // neck and head
  const neck = group(body, 0, by + bR * 0.5, -hl - 0.02);
  const nt = [neckTop[0], neckTop[1] - (by + bR * 0.5), neckTop[2] + hl + 0.02];
  neck.add(sdfMesh(`${K}:neck`, {
    min: [-neckR - 0.05, -neckR - 0.05, nt[2] - neckR - 0.05], max: [neckR + 0.05, nt[1] + neckR + 0.05, neckR + 0.05], step: 0.036,
    sdf: (p) => capsule(p, 0, 0, 0, 0, nt[1], nt[2], neckR * 1.05, neckR * 0.8) + (S.shag ? fbm3(p[0] * 9, p[1] * 9, p[2] * 9, 2) * S.shag : 0),
    color: (p) => skinAt(S, p, 0.2 + (p[1] > nt[1] * 0.5 ? 0.3 : 0) - (p[2] < nt[2] * 0.6 ? 0.2 : 0)),
  }, voxelLitMaterial()));
  const head = group(neck, 0, nt[1], nt[2]);
  const hs = 0.9 + build * 0.35, sn = rng.range(0.8, 1.35);
  const ears = !sp.horns || rng.chance(0.4);
  const antlers = sp.horns && build < 0.45;
  const ex = 0.1 * hs, ey = 0.07 * hs, ez = -0.12 * hs;
  head.add(sdfMesh(`${K}:head`, {
    min: [-0.3 * hs, -0.2 * hs, -0.48 * hs * sn], max: [0.3 * hs, 0.3 * hs, 0.2 * hs], step: 0.024,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0.05 * hs, -0.06 * hs, 0.13 * hs, 0.12 * hs, 0.16 * hs);
      d = smin(d, capsule(p, 0, 0.03 * hs, -0.14 * hs, 0, -0.03 * hs, -0.36 * hs * sn, 0.085 * hs, 0.055 * hs), 0.06);
      d = smin(d, ellipsoid(p, 0, -0.05 * hs, -0.18 * hs, 0.08 * hs, 0.05 * hs, 0.14 * hs), 0.04);
      // brow over the eyes, nostrils in the nose
      d = smin(d, ellipsoid(p, 0, 0.1 * hs, -0.11 * hs, 0.12 * hs, 0.04 * hs, 0.06 * hs), 0.04);
      d = smax(d, -eyeSdf(p, 0.024 * hs, -0.01 * hs, -0.39 * hs * sn, 0.018 * hs), 0.01);
      if (ears) for (const s of [-1, 1]) d = smin(d, capsule(p, s * 0.08 * hs, 0.13 * hs, 0, s * 0.17 * hs, 0.26 * hs, 0.05 * hs, 0.035 * hs, 0.012 * hs), 0.03);
      d = smax(d, -eyeSdf(p, ex, ey, ez, 0.034 * hs), 0.012);
      d = Math.min(d, eyeSdf(p, ex * 0.96, ey, ez, 0.026 * hs));
      return d;
    },
    color: (p) => {
      if (eyeSdf(p, ex * 0.96, ey, ez, 0.028 * hs) < 0.004) return EYE;
      if (p[1] < -0.04 * hs && p[2] < -0.28 * hs * sn) return mix(S.belly, S.mark, 0.5);
      return skinAt(S, p, (p[1] - 0.02) / (0.13 * hs));
    },
  }, voxelLitMaterial()));
  if (S.glowEyes) glowEyes(head, `${K}:eyes`, ex * 1.02, ey, ez - 0.004, 0.02 * hs, S.accent);
  if (sp.horns) {
    head.add(sdfMesh(`${K}:horns`, {
      min: [-0.45 * hs, 0, -0.2 * hs], max: [0.45 * hs, 0.62 * hs, 0.45 * hs], step: 0.022,
      sdf: (p) => {
        let d = 1;
        for (const s of [-1, 1]) {
          if (antlers) {
            d = Math.min(d, capsule(p, s * 0.07 * hs, 0.13 * hs, -0.03 * hs, s * 0.18 * hs, 0.4 * hs, 0.05 * hs, 0.022 * hs, 0.014 * hs));
            d = Math.min(d, capsule(p, s * 0.18 * hs, 0.4 * hs, 0.05 * hs, s * 0.3 * hs, 0.58 * hs, 0.14 * hs, 0.014 * hs, 0.008 * hs));
            d = Math.min(d, capsule(p, s * 0.14 * hs, 0.3 * hs, 0.02 * hs, s * 0.06 * hs, 0.46 * hs, -0.1 * hs, 0.012 * hs, 0.007 * hs));
            d = Math.min(d, capsule(p, s * 0.24 * hs, 0.49 * hs, 0.09 * hs, s * 0.38 * hs, 0.52 * hs, 0.0, 0.011 * hs, 0.006 * hs));
          } else {
            d = Math.min(d, capsule(p, s * 0.07 * hs, 0.13 * hs, -0.03 * hs, s * 0.16 * hs, 0.26 * hs, 0.04 * hs, 0.038 * hs, 0.028 * hs));
            d = Math.min(d, capsule(p, s * 0.16 * hs, 0.26 * hs, 0.04 * hs, s * 0.2 * hs, 0.33 * hs, 0.18 * hs, 0.028 * hs, 0.018 * hs));
            d = Math.min(d, capsule(p, s * 0.2 * hs, 0.33 * hs, 0.18 * hs, s * 0.15 * hs, 0.3 * hs, 0.32 * hs, 0.018 * hs, 0.006 * hs));
          }
        }
        return d;
      },
      color: (p) => shade(BONE, 0.62 + sat(p[1] / (0.5 * hs)) * 0.45 + (noise3(p[0] * 40, p[1] * 40, p[2] * 40) > 0.3 ? -0.08 : 0)),
    }, voxelLitMaterial()));
  }
  // legs: hip, knee, hoof
  const legs = [];
  const hipY = by - bR * 0.35;
  const up = hipY * 0.5, lo = hipY * 0.5;
  const tR = 0.09 + build * 0.05;
  const legCol = (p, k) => mix(skinAt(S, p, -0.1), shade(S.top, 0.5), sat(k));
  for (let i = 0; i < 4; i++) {
    const s = i % 2 === 0 ? -1 : 1, hind = i >= 2;
    const hip = group(body, s * bR * 0.6, hipY, hind ? hl * 0.6 : -hl * 0.62);
    hip.add(sdfMesh(`${K}:thigh${hind ? 'H' : 'F'}`, limbSpec(up, hind ? tR * 1.25 : tR, tR * 0.6, hind ? -0.06 : 0.03, 0, (p) => legCol(p, -p[1] / up * 0.3)), voxelLitMaterial()));
    const knee = group(hip, 0, -up, hind ? -0.06 : 0.03);
    knee.add(sdfMesh(`${K}:shin${hind ? 'H' : 'F'}`, {
      min: [-0.1, -lo - 0.08, -0.14], max: [0.1, 0.08, 0.1], step: 0.026,
      sdf: (p) => {
        let d = capsule(p, 0, 0, 0, 0, -lo + 0.05, hind ? 0.05 : -0.03, tR * 0.55, tR * 0.42);
        d = smin(d, ellipsoid(p, 0, -lo + 0.035, (hind ? 0.05 : -0.03) - 0.025, tR * 0.62, 0.042, tR * 0.8), 0.03);
        return d;
      },
      color: (p) => (p[1] < -lo + 0.07 ? HOOF : legCol(p, 0.3 + (-p[1] / lo) * 0.7)),
    }, voxelLitMaterial()));
    hip.userData = { phase: (hind ? Math.PI : 0) + (s > 0 ? Math.PI : 0) + (hind ? 0.5 : 0), knee, hind, side: s };
    legs.push(hip);
  }
  // tail
  let tail = [];
  if (sp.tail) {
    const tb = group(body, 0, by + bR * 0.35, hl + 0.12);
    const n = 4, tl = rng.range(0.14, 0.24);
    tail = tailChain(tb, K, n, tl, 0.07, 0.025, [0, -0.35, 1], (p, k) => (k > 0.7 ? shade(S.top, 0.5) : skinAt(S, p, 0.5)));
    tail[0].rotation.x = -0.25;
  }
  // riders sit on the back, not above it
  if (sp.ride) sp.ride.seat = by + bR - 0.12;
  return { root, body, legs, head, neck, tail, baseY: 0 };
}

// ------------------------------------------------------------------ two legs: long-necked striders
function buildBiped(sp, rng, S, K) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const lh = sp.legLen * 0.85 + 0.35;
  const tR = rng.range(0.2, 0.28);
  const ty = lh + 0.1;
  const beak = rng.chance(0.55);
  const mane = rng.chance(0.4);
  body.add(sdfMesh(`${K}:body`, {
    min: [-tR - 0.15, ty - tR - 0.15, -0.72], max: [tR + 0.15, ty + tR + 0.72, 0.6], step: 0.036,
    sdf: (p) => {
      let d = ellipsoid(p, 0, ty, 0.04, tR, tR * 1.05, tR * 1.6);
      d = smin(d, ellipsoid(p, 0, ty + 0.1, -0.22, tR * 0.9, tR, tR * 1.1), 0.12);
      for (const s of [-1, 1]) d = smin(d, ellipsoid(p, s * tR * 0.55, ty - 0.08, 0.08, 0.12, 0.2, 0.16), 0.08);
      // the neck rises in an S from the chest
      d = smin(d, capsule(p, 0, ty + 0.15, -0.3, 0, ty + 0.42, -0.4, 0.085, 0.07), 0.08);
      d = smin(d, capsule(p, 0, ty + 0.42, -0.4, 0, ty + 0.68, -0.34, 0.07, 0.06), 0.05);
      if (mane) d = smin(d, ellipsoid(p, 0, ty + 0.45, -0.32, 0.05, 0.28, 0.1), 0.04);
      if (S.shag) d += fbm3(p[0] * 10, p[1] * 10, p[2] * 10, 2) * S.shag;
      return d;
    },
    color: (p) => (mane && p[1] > ty + 0.2 && p[2] > -0.42 && Math.abs(p[0]) < 0.06 ? S.mark : skinAt(S, p, (p[1] - ty) / tR)),
  }, voxelLitMaterial()));
  const neck = group(body, 0, ty + 0.68, -0.34);
  const head = neck;
  const ex = 0.065, ey = 0.05, ez = -0.06;
  head.add(sdfMesh(`${K}:head`, {
    min: [-0.16, -0.12, -0.46], max: [0.16, 0.3, 0.14], step: 0.02,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0.04, -0.04, 0.09, 0.085, 0.11);
      d = beak
        ? smin(d, capsule(p, 0, 0.02, -0.1, 0, -0.03, -0.38, 0.05, 0.008), 0.03)
        : smin(d, capsule(p, 0, 0.02, -0.08, 0, -0.01, -0.24, 0.06, 0.04), 0.04);
      if (sp.crest) for (let i = 0; i < 4; i++) d = Math.min(d, capsule(p, 0, 0.1, -0.02 + i * 0.03, 0, 0.2 + i * 0.03, 0.06 + i * 0.05, 0.012, 0.004));
      if (sp.horns) for (const s of [-1, 1]) d = Math.min(d, capsule(p, s * 0.05, 0.1, 0.0, s * 0.1, 0.24, 0.08, 0.02, 0.006));
      d = smax(d, -eyeSdf(p, ex, ey, ez, 0.026), 0.01);
      return Math.min(d, eyeSdf(p, ex * 0.95, ey, ez, 0.02));
    },
    color: (p) => {
      if (eyeSdf(p, ex * 0.95, ey, ez, 0.022) < 0.004) return EYE;
      if (p[2] < -0.13) return beak ? mix(BONE, S.mark, 0.5) : skinAt(S, p, -0.2);
      if (p[1] > 0.12) return mix(S.accent, S.mark, 0.35);
      return skinAt(S, p, (p[1] - 0.02) / 0.09);
    },
  }, voxelLitMaterial()));
  if (S.glowEyes) glowEyes(head, `${K}:eyes`, ex, ey, ez - 0.004, 0.016, S.accent);
  // small forelimbs
  for (const s of [-1, 1]) {
    const arm = group(body, s * tR * 0.7, ty + 0.02, -0.3);
    arm.add(sdfMesh(`${K}:arm`, limbSpec(0.24, 0.035, 0.018, -0.1, 0, (p) => skinAt(S, p, -0.3)), voxelLitMaterial()));
    arm.rotation.x = 0.4;
  }
  // digitigrade legs: thigh forward, shin back, then the long foot bone to the toes
  const legs = [];
  const tl = lh * 0.35, sl = lh * 0.38, fl = lh * 0.27;
  for (const s of [-1, 1]) {
    const hip = group(body, s * tR * 0.6, lh, 0.08);
    hip.add(sdfMesh(`${K}:thigh`, limbSpec(tl, 0.1, 0.055, -0.12, 0, (p) => skinAt(S, p, -0.1)), voxelLitMaterial()));
    const knee = group(hip, 0, -tl, -0.12);
    knee.add(sdfMesh(`${K}:shin`, limbSpec(sl, 0.05, 0.032, 0.2, 0, (p) => mix(skinAt(S, p, -0.2), S.mark, 0.4)), voxelLitMaterial()));
    const ankle = group(knee, 0, -sl, 0.2);
    ankle.add(sdfMesh(`${K}:foot`, {
      min: [-0.12, -fl - 0.06, -0.24], max: [0.12, 0.05, 0.1], step: 0.02,
      sdf: (p) => {
        let d = capsule(p, 0, 0, 0, 0, -fl + 0.03, -0.04, 0.03, 0.025);
        for (const a of [-0.4, 0, 0.4]) d = smin(d, capsule(p, 0, -fl + 0.025, -0.04, Math.sin(a) * 0.14, -fl + 0.015, -0.04 - Math.cos(a) * 0.15, 0.022, 0.01), 0.02);
        return d;
      },
      color: (p) => (p[1] < -fl + 0.05 ? HOOF : mix(S.mark, HOOF, 0.4)),
    }, voxelLitMaterial()));
    hip.userData = { phase: s > 0 ? Math.PI : 0, knee, ankle, side: s, biped: true };
    legs.push(hip);
  }
  const tb = group(body, 0, ty + 0.05, 0.5);
  const tail = tailChain(tb, K, 5, rng.range(0.14, 0.2), 0.08, 0.02, [0, -0.1, 1], (p, k) => (k > 0.75 && sp.tail ? S.accent : skinAt(S, p, 0.4)));
  return { root, body, legs, head, neck, tail, baseY: 0 };
}

// ------------------------------------------------------------------ hoppers
function buildHopper(sp, rng, S, K) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const longEars = rng.chance(0.6);
  body.add(sdfMesh(`${K}:body`, {
    min: [-0.42, 0.02, -0.52], max: [0.42, 0.8, 0.56], step: 0.03,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0.38, 0.08, 0.28, 0.3, 0.36);
      d = smin(d, ellipsoid(p, 0, 0.48, -0.16, 0.22, 0.25, 0.22), 0.12);
      // the big folded haunches
      for (const s of [-1, 1]) d = smin(d, ellipsoid(p, s * 0.2, 0.26, 0.16, 0.13, 0.2, 0.24), 0.08);
      d = smin(d, sphere(p, 0, 0.4, 0.46, 0.09), 0.05);
      if (S.shag) d += fbm3(p[0] * 12, p[1] * 12, p[2] * 12, 2) * S.shag;
      return d;
    },
    color: (p) => (p[2] > 0.4 ? S.belly : skinAt(S, p, (p[1] - 0.38) / 0.3)),
  }, voxelLitMaterial()));
  const head = group(body, 0, 0.68, -0.26);
  const ex = 0.1, ey = 0.04, ez = -0.1;
  head.add(sdfMesh(`${K}:head`, {
    min: [-0.26, -0.18, -0.3], max: [0.26, longEars ? 0.62 : 0.34, 0.24], step: 0.02,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0, -0.02, 0.15, 0.14, 0.16);
      d = smin(d, ellipsoid(p, 0, -0.04, -0.14, 0.09, 0.07, 0.08), 0.05);
      for (const s of [-1, 1]) {
        d = longEars
          ? smin(d, capsule(p, s * 0.07, 0.1, 0.03, s * 0.13, 0.5, 0.12, 0.045, 0.025), 0.03)
          : smin(d, capsule(p, s * 0.1, 0.08, 0.0, s * 0.2, 0.22, 0.04, 0.05, 0.02), 0.03);
      }
      d = smax(d, -eyeSdf(p, ex, ey, ez, 0.035), 0.01);
      return Math.min(d, eyeSdf(p, ex * 0.96, ey, ez, 0.03));
    },
    color: (p) => {
      if (eyeSdf(p, ex * 0.96, ey, ez, 0.032) < 0.004) return EYE;
      if (p[1] > 0.12 && Math.abs(p[0]) < 0.2) return mix(skinAt(S, p, 0.6), S.belly, p[2] < 0.04 ? 0.5 : 0);
      return skinAt(S, p, p[1] / 0.14);
    },
  }, voxelLitMaterial()));
  if (S.glowEyes) glowEyes(head, `${K}:eyes`, ex, ey, ez - 0.004, 0.022, S.accent);
  const legs = [];
  for (const s of [-1, 1]) {
    // hind foot: long, flat on the ground, kicks back on a hop
    const hip = group(body, s * 0.2, 0.16, 0.16);
    hip.add(sdfMesh(`${K}:foot`, {
      min: [-0.1, -0.2, -0.42], max: [0.1, 0.06, 0.1], step: 0.022,
      sdf: (p) => smin(capsule(p, 0, 0, 0.02, 0, -0.13, -0.05, 0.07, 0.05), capsule(p, 0, -0.13, 0.02, 0, -0.14, -0.34, 0.05, 0.035), 0.04),
      color: (p) => (p[1] < -0.16 ? shade(S.belly, 0.7) : skinAt(S, p, -0.2)),
    }, voxelLitMaterial()));
    hip.userData = { phase: 0, hop: true, side: s };
    legs.push(hip);
    const fore = group(body, s * 0.14, 0.38, -0.26);
    fore.add(sdfMesh(`${K}:fore`, limbSpec(0.34, 0.04, 0.03, -0.03, 0, (p) => skinAt(S, p, -0.3)), voxelLitMaterial()));
    fore.userData = { phase: Math.PI * 0.5, fore: true, side: s };
    legs.push(fore);
  }
  if (sp.horns || sp.crest) {
    // two feelers with lights at the tips
    for (const s of [-1, 1]) {
      const a = group(head, s * 0.05, 0.12, -0.08);
      a.add(sdfMesh(`${K}:feeler`, limbSpec(0.3, 0.012, 0.008, 0.06, 0, () => S.mark), voxelLitMaterial()));
      a.rotation.x = Math.PI; a.rotation.z = s * 0.3;
      glowEyes(a, `${K}:tip`, 0.0001, -0.31, 0.06, 0.03, S.accent);
    }
  }
  return { root, body, legs, head, neck: null, tail: [], baseY: 0, hopper: true };
}

// ------------------------------------------------------------------ flyers: birds, bats, pterosaurs
function buildFlyer(sp, rng, S, K) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const membrane = rng.chance(0.45);
  const span = rng.range(0.75, 1.05);
  body.add(sdfMesh(`${K}:body`, {
    min: [-0.22, -0.2, -0.5], max: [0.22, 0.22, 0.62], step: 0.022,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0, 0.02, 0.13, 0.12, 0.34);
      d = smin(d, ellipsoid(p, 0, 0.02, -0.2, 0.12, 0.12, 0.16), 0.08);
      d = smin(d, capsule(p, 0, 0.02, -0.3, 0, 0.05, -0.42, 0.06, 0.05), 0.05);
      // tucked legs
      for (const s of [-1, 1]) d = smin(d, capsule(p, s * 0.06, -0.08, 0.12, s * 0.05, -0.12, 0.3, 0.025, 0.018), 0.03);
      return d;
    },
    color: (p) => skinAt(S, p, p[1] / 0.12),
  }, voxelLitMaterial()));
  const head = group(body, 0, 0.05, -0.44);
  const ex = 0.055, ey = 0.035, ez = -0.04;
  head.add(sdfMesh(`${K}:head`, {
    min: [-0.12, -0.1, -0.4], max: [0.12, 0.22, 0.1], step: 0.016,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0.02, -0.02, 0.075, 0.075, 0.09);
      d = smin(d, capsule(p, 0, 0.0, -0.08, 0, -0.02, membrane ? -0.24 : -0.34, 0.035, membrane ? 0.02 : 0.004), 0.025);
      if (sp.crest) d = Math.min(d, capsule(p, 0, 0.07, -0.02, 0, 0.16, 0.12, 0.012, 0.004));
      d = smax(d, -eyeSdf(p, ex, ey, ez, 0.02), 0.008);
      return Math.min(d, eyeSdf(p, ex * 0.95, ey, ez, 0.016));
    },
    color: (p) => {
      if (eyeSdf(p, ex * 0.95, ey, ez, 0.018) < 0.004) return EYE;
      if (p[2] < -0.09) return membrane ? shade(S.mark, 0.8) : mix(BONE, S.accent, 0.35);
      return skinAt(S, p, p[1] / 0.07);
    },
  }, voxelLitMaterial()));
  if (S.glowEyes) glowEyes(head, `${K}:eyes`, ex, ey, ez - 0.003, 0.013, S.accent);
  // wings: inner at the shoulder, outer at the wrist; feathered edges or a stretched membrane
  const wings = [];
  const inner = 0.42 * span, outer = 0.5 * span;
  const wingCol = (p, tip) => {
    if (membrane) {
      const bone = Math.abs(Math.sin(p[2] * 38 + p[0] * 6)) < 0.18;
      return bone ? shade(S.mark, 0.7) : mix(shade(S.side, 0.75), S.belly, 0.2 + tip * 0.2);
    }
    const feather = Math.sin(p[0] * 60) * 0.5 + 0.5;
    return shade(mix(S.top, S.mark, tip * 0.8 + (p[2] > 0.1 ? 0.3 : 0)), 0.85 + feather * 0.2);
  };
  for (const s of [-1, 1]) {
    const sh = group(body, s * 0.1, 0.06, -0.1);
    sh.add(sdfMesh(`${K}:wingA${s}`, {
      min: [Math.min(0, s * (inner + 0.05)), -0.05, -0.12], max: [Math.max(0, s * (inner + 0.05)), 0.05, 0.36], step: 0.02,
      sdf: (p) => {
        const x = p[0] * s;
        let d = capsule([x, p[1], p[2]], 0, 0, 0, inner, 0.01, -0.03, 0.035, 0.022);
        const chord = 0.3 - x * 0.12;
        const m = Math.max(Math.abs(p[1]) - 0.012, ellipsoid([x, 0, p[2]], inner * 0.5, 0, chord * 0.45, inner * 0.56, 1, chord * 0.62));
        d = Math.min(d, m);
        if (!membrane) d = smax(d, -(Math.abs(Math.sin(x * 55)) * 0.05 - (p[2] - chord * 0.95 - 0.02)), 0.005);
        return d;
      },
      color: (p) => wingCol(p, 0),
    }, voxelLitMaterial()));
    const wrist = group(sh, s * inner, 0.01, -0.03);
    wrist.add(sdfMesh(`${K}:wingB${s}`, {
      min: [Math.min(0, s * (outer + 0.05)), -0.05, -0.12], max: [Math.max(0, s * (outer + 0.05)), 0.05, 0.36], step: 0.02,
      sdf: (p) => {
        const x = p[0] * s;
        let d = capsule([x, p[1], p[2]], 0, 0, 0, outer, 0, 0.12, 0.022, 0.008);
        const chord = 0.26 * (1 - x / outer * 0.85);
        const m = Math.max(Math.abs(p[1]) - 0.01, ellipsoid([x, 0, p[2]], outer * 0.45, 0, chord * 0.55 + x * 0.1, outer * 0.56, 1, chord * 0.7 + 0.02));
        d = Math.min(d, m);
        if (!membrane) d = smax(d, -(Math.abs(Math.sin(x * 50)) * 0.06 - (p[2] - chord - x * 0.1 - 0.01)), 0.005);
        return d;
      },
      color: (p) => wingCol(p, sat(p[0] * s / outer)),
    }, voxelLitMaterial()));
    sh.userData = { side: s, wrist };
    wings.push(sh);
  }
  // tail: a fan of feathers, or a long thin tail with a vane
  const tb = group(body, 0, 0.02, 0.34);
  tb.add(sdfMesh(`${K}:tail`, {
    min: [-0.2, -0.04, -0.02], max: [0.2, 0.04, membrane ? 0.62 : 0.34], step: 0.018,
    sdf: (p) => membrane
      ? Math.min(capsule(p, 0, 0, 0, 0, 0, 0.5, 0.02, 0.008), Math.max(Math.abs(p[1]) - 0.008, ellipsoid(p, 0, 0, 0.52, 0.07, 1, 0.06)))
      : Math.max(Math.abs(p[1]) - 0.012, smax(ellipsoid(p, 0, 0, 0.14, 0.16, 1, 0.18), -(p[2] - 0.3 + Math.abs(Math.sin(p[0] * 40)) * 0.04), 0.01)),
    color: (p) => (p[2] > 0.44 ? S.accent : wingCol(p, 0.6)),
  }, voxelLitMaterial()));
  return { root, body, legs: [], wings, head, neck: null, tail: [tb], baseY: 0 };
}

// ------------------------------------------------------------------ floaters: bells and eyes adrift
function buildFloater(sp, rng, S, K) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const legs = [];
  if (sp.bigEye) {
    // an eye the size of a head, with a lid, trailing its nerves
    const iris = mix(sp.c1, [0.5, 0.45, 0.3], 0.3);
    body.add(sdfMesh(`${K}:eye`, {
      min: [-0.52, -0.52, -0.56], max: [0.52, 0.56, 0.52], step: 0.03,
      sdf: (p) => {
        let d = sphere(p, 0, 0, 0, 0.45);
        // the lid, half closed, slightly too thick
        const lid = Math.max(sphere(p, 0, 0.02, 0, 0.49), -(p[1] - 0.08 + p[2] * 0.25));
        return Math.min(d, lid);
      },
      color: (p) => {
        const r = Math.hypot(p[0], p[1]);
        if (p[2] < -0.3 && r < 0.09) return [0.01, 0.01, 0.012];
        if (p[2] < -0.3 && r < 0.22) return shade(iris, 0.7 + noise3(Math.atan2(p[1], p[0]) * 6, r * 20, 0) * 0.3);
        if (Math.hypot(p[0], p[1] - 0.02, p[2]) > 0.465) return skinAt(S, p, 0.6);
        const vein = Math.abs(noise3(p[0] * 9, p[1] * 9, p[2] * 9)) < 0.05;
        return vein ? [0.55, 0.16, 0.14] : [0.86, 0.82, 0.72];
      },
    }, voxelLitMaterial()));
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      const t = group(body, Math.cos(a) * 0.14, -0.1, 0.3 + Math.sin(a) * 0.14);
      const segs = tailChain(t, `${K}:n${i % 2}`, 4, 0.16, 0.035, 0.01, [0, -1, 0.35], () => [0.55, 0.2, 0.2]);
      t.userData = { phase: i * 1.3, floater: true, segs };
      legs.push(t);
    }
    return { root, body, legs, head: body, neck: null, tail: [], baseY: 0, floater: true };
  }
  // a bell of jelly with a glowing heart and long drifting threads
  const R = rng.range(0.42, 0.55), lobes = rng.int(6, 9);
  body.add(sdfMesh(`${K}:bell`, {
    min: [-R - 0.08, -0.2, -R - 0.08], max: [R + 0.08, R * 0.9 + 0.05, R + 0.08], step: 0.03,
    sdf: (p) => {
      const a = Math.atan2(p[2], p[0]);
      const rim = R * (1 + Math.sin(a * lobes) * 0.06);
      let d = ellipsoid(p, 0, 0, 0, rim, R * 0.85, rim);
      d = smax(d, -ellipsoid(p, 0, -0.12, 0, rim * 0.86, R * 0.62, rim * 0.86), 0.04);
      return smax(d, -(p[1] + 0.16), 0.03);
    },
    color: (p) => mix(mix(S.belly, sp.c1, 0.35), [0.9, 0.9, 0.95], sat(p[1] / R) * 0.4),
  }, voxelGelMaterial()));
  body.add(sdfMesh(`${K}:heart`, {
    min: [-0.2, -0.05, -0.2], max: [0.2, 0.3, 0.2], step: 0.025,
    sdf: (p) => smin(ellipsoid(p, 0, 0.12, 0, 0.14, 0.1, 0.14), sphere(p, 0, 0.04, 0, 0.06), 0.05),
    color: () => mix(S.accent, [1, 1, 1], 0.2),
  }, voxelGlowMaterial()));
  const n = rng.int(6, 9);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, r = R * (i % 2 ? 0.55 : 0.8);
    const t = group(body, Math.cos(a) * r, -0.12, Math.sin(a) * r);
    const segs = tailChain(t, `${K}:th${i % 2}`, 5, 0.2, i % 2 ? 0.035 : 0.018, 0.006, [0, -1, 0.12], (p, k) => mix(S.belly, S.accent, k * 0.6));
    t.userData = { phase: i * 1.1, floater: true, segs };
    legs.push(t);
  }
  return { root, body, legs, head: body, neck: null, tail: [], baseY: 0, floater: true };
}

// ------------------------------------------------------------------ crawlers: plated, six legs
function buildCrawler(sp, rng, S, K) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const segs = rng.int(3, 5), sl = 0.2, by = 0.3;
  const shell = mix(S.top, S.mark, 0.4);
  body.add(sdfMesh(`${K}:body`, {
    min: [-0.4, by - 0.2, -0.3], max: [0.4, by + 0.32, segs * sl + 0.2], step: 0.024,
    sdf: (p) => {
      let d = 1;
      for (let i = 0; i < segs; i++) {
        const z = i * sl + sl * 0.5, w = 0.28 - Math.abs(i - (segs - 1) * 0.4) * 0.03;
        d = smin(d, ellipsoid(p, 0, by + 0.04, z, w, 0.17, sl * 0.72), 0.03);
      }
      // plates: a ridge down the back
      d = smin(d, ellipsoid(p, 0, by + 0.19, segs * sl * 0.5, 0.05, 0.05, segs * sl * 0.5), 0.05);
      return d;
    },
    color: (p) => {
      const seam = Math.abs(((p[2] / sl) % 1 + 1) % 1 - 1) < 0.1 || ((p[2] / sl) % 1 + 1) % 1 < 0.1;
      const up = (p[1] - by) / 0.17;
      const c = up > -0.2 ? mix(shell, S.side, sstep(0.9, 0.2, up) * 0.3) : S.belly;
      return shade(seam ? shade(c, 0.6) : c, 0.9 + fbm3(p[0] * 14, p[1] * 14, p[2] * 14, 2) * 0.2);
    },
  }, voxelLitMaterial()));
  const head = group(body, 0, by + 0.02, -0.02);
  const ex = 0.09, ey = 0.06, ez = -0.14;
  head.add(sdfMesh(`${K}:head`, {
    min: [-0.22, -0.14, -0.38], max: [0.22, 0.16, 0.1], step: 0.018,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0.0, -0.1, 0.15, 0.11, 0.14);
      for (const s of [-1, 1]) {
        d = smin(d, capsule(p, s * 0.06, -0.04, -0.2, s * 0.1, -0.05, -0.3, 0.025, 0.02), 0.02);
        d = Math.min(d, capsule(p, s * 0.1, -0.05, -0.3, s * 0.03, -0.06, -0.36, 0.02, 0.008));
      }
      return Math.min(d, eyeSdf(p, ex, ey, ez, 0.028));
    },
    color: (p) => (eyeSdf(p, ex, ey, ez, 0.03) < 0.004 ? EYE : p[2] < -0.24 ? HOOF : shade(shell, 0.85)),
  }, voxelLitMaterial()));
  if (S.glowEyes) glowEyes(head, `${K}:eyes`, ex, ey, ez - 0.01, 0.018, S.accent);
  for (const s of [-1, 1]) {
    const a = group(head, s * 0.05, 0.08, -0.2);
    a.add(sdfMesh(`${K}:ant`, limbSpec(0.5, 0.012, 0.006, -0.1, 0, () => S.mark), voxelLitMaterial()));
    a.rotation.x = Math.PI * 0.62; a.rotation.z = -s * 0.35;
  }
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const s = i % 2 === 0 ? -1 : 1, row = Math.floor(i / 2);
    const hip = group(body, s * 0.22, by - 0.02, 0.1 + row * (segs * sl - 0.2) / 2);
    hip.rotation.y = s * (row - 1) * -0.35;
    // femur out and up to a raised knee, tibia down to the ground
    hip.add(sdfMesh(`${K}:femur${s}`, {
      min: [Math.min(0, s * 0.3) - 0.05, -0.05, -0.05], max: [Math.max(0, s * 0.3) + 0.05, 0.22, 0.05], step: 0.02,
      sdf: (p) => capsule(p, 0, 0, 0, s * 0.26, 0.16, 0, 0.035, 0.025),
      color: () => shade(shell, 0.8),
    }, voxelLitMaterial()));
    const knee = group(hip, s * 0.26, 0.16, 0);
    knee.add(sdfMesh(`${K}:tibia${s}`, {
      min: [Math.min(0, s * 0.2) - 0.04, -0.52, -0.04], max: [Math.max(0, s * 0.2) + 0.04, 0.04, 0.04], step: 0.018,
      sdf: (p) => capsule(p, 0, 0, 0, s * 0.16, -0.46, 0, 0.022, 0.01),
      color: (p) => (p[1] < -0.4 ? HOOF : shade(shell, 0.7)),
    }, voxelLitMaterial()));
    hip.userData = { phase: (row % 2 === 0 ? 0 : Math.PI) + (s > 0 ? Math.PI : 0), knee, side: s, insect: true };
    legs.push(hip);
  }
  return { root, body, legs, head, neck: null, tail: [], baseY: 0 };
}

// ------------------------------------------------------------------ the manikin
function buildManikin(sp, rng, S, K) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const skin = [0.9, 0.86, 0.8], seam = [0.62, 0.58, 0.54];
  // smooth, pale, a little yellowed; chipped only here and there
  const col = (p) => {
    const n = noise3(p[0] * 26, p[1] * 26, p[2] * 26);
    return n < -0.72 ? [0.56, 0.52, 0.48] : shade(skin, 0.96 + fbm3(p[0] * 4, p[1] * 4, p[2] * 4, 2) * 0.08);
  };
  const hipY = 0.98;
  body.add(sdfMesh(`${K}:torso`, {
    min: [-0.34, hipY - 0.16, -0.2], max: [0.34, hipY + 0.82, 0.2], step: 0.022,
    sdf: (p) => {
      let d = ellipsoid(p, 0, hipY + 0.52, 0, 0.23, 0.2, 0.13);
      d = smin(d, ellipsoid(p, 0, hipY + 0.28, 0, 0.16, 0.16, 0.1), 0.1);
      d = smin(d, ellipsoid(p, 0, hipY + 0.04, 0, 0.2, 0.13, 0.12), 0.08);
      d = smin(d, capsule(p, 0, hipY + 0.66, 0, 0, hipY + 0.76, 0, 0.045, 0.04), 0.03);
      // a seam at the waist where it comes apart
      return smax(d, -(Math.abs(p[1] - hipY - 0.16) - 0.006), 0.004);
    },
    color: (p) => (Math.abs(p[1] - hipY - 0.16) < 0.02 ? seam : col(p)),
  }, voxelLitMaterial()));
  const head = group(body, 0, hipY + 0.78, 0);
  head.add(sdfMesh(`${K}:head`, {
    min: [-0.14, -0.04, -0.16], max: [0.14, 0.34, 0.14], step: 0.016,
    sdf: (p) => smin(ellipsoid(p, 0, 0.15, 0, 0.1, 0.14, 0.11), ellipsoid(p, 0, 0.08, -0.03, 0.07, 0.07, 0.08), 0.05),
    color: col,
  }, voxelLitMaterial()));
  const legs = [];
  const joint = (key) => sdfMesh(key, { min: [-0.06, -0.06, -0.06], max: [0.06, 0.06, 0.06], step: 0.014, sdf: (p) => sphere(p, 0, 0, 0, 0.045), color: () => seam }, voxelLitMaterial());
  for (const s of [-1, 1]) {
    const sh = group(body, s * 0.25, hipY + 0.6, 0);
    sh.add(joint(`${K}:j`));
    sh.add(sdfMesh(`${K}:uarm`, limbSpec(0.3, 0.045, 0.036, 0, 0, col), voxelLitMaterial()));
    const el = group(sh, 0, -0.32, 0);
    el.add(joint(`${K}:j`));
    el.add(sdfMesh(`${K}:farm`, limbSpec(0.3, 0.036, 0.028, -0.02, 0, col), voxelLitMaterial()));
    sh.userData = { phase: s > 0 ? 0 : Math.PI, arm: true, knee: el, side: s };
    legs.push(sh);
    const hip = group(body, s * 0.1, hipY - 0.02, 0);
    hip.add(sdfMesh(`${K}:thigh`, limbSpec(0.46, 0.07, 0.05, 0, 0, col), voxelLitMaterial()));
    const knee = group(hip, 0, -0.48, 0);
    knee.add(joint(`${K}:j`));
    knee.add(sdfMesh(`${K}:shin`, {
      min: [-0.08, -0.52, -0.16], max: [0.08, 0.06, 0.08], step: 0.018,
      sdf: (p) => smin(capsule(p, 0, 0, 0, 0, -0.46, 0, 0.05, 0.036), ellipsoid(p, 0, -0.48, -0.05, 0.045, 0.03, 0.09), 0.02),
      color: col,
    }, voxelLitMaterial()));
    hip.userData = { phase: s > 0 ? Math.PI : 0, knee, side: s };
    legs.push(hip);
  }
  return { root, body, legs, head, neck: null, tail: [], baseY: 0 };
}

// ------------------------------------------------------------------ the colossal spider
function buildSpider(sp, rng, S, K) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const by = 1.0;
  const dark = mute(sp.c1, 0.3, 0.9), mark = mix(sp.c3, [0.8, 0.2, 0.18], 0.4);
  body.add(sdfMesh(`${K}:body`, {
    min: [-0.72, by - 0.55, -0.72], max: [0.72, by + 0.7, 1.75], step: 0.04,
    sdf: (p) => {
      let d = ellipsoid(p, 0, by + 0.18, 0.9, 0.62, 0.52, 0.78);
      d = smin(d, ellipsoid(p, 0, by, -0.25, 0.4, 0.28, 0.42), 0.1);
      d = smin(d, capsule(p, 0, by + 0.05, 0.1, 0, by + 0.1, 0.3, 0.16, 0.2), 0.08);
      d += fbm3(p[0] * 8, p[1] * 8, p[2] * 8, 2) * 0.03;
      return d;
    },
    color: (p) => {
      const a = [p[0] / 0.62, (p[1] - by - 0.18) / 0.52, (p[2] - 0.9) / 0.78];
      // an hourglass on the back of the abdomen
      if (a[1] > 0.45 && Math.abs(a[0]) < 0.12 + Math.abs(a[2]) * 0.35 && Math.abs(a[2]) < 0.55) return mark;
      const hair = noise3(p[0] * 30, p[1] * 30, p[2] * 30) > 0.35;
      return shade(dark, (hair ? 0.7 : 1) * (0.85 + fbm3(p[0] * 5, p[1] * 5, p[2] * 5, 2) * 0.3));
    },
  }, voxelLitMaterial()));
  const head = group(body, 0, by + 0.02, -0.62);
  head.add(sdfMesh(`${K}:fangs`, {
    min: [-0.2, -0.34, -0.2], max: [0.2, 0.06, 0.08], step: 0.02,
    sdf: (p) => Math.min(capsule(p, -0.08, 0, 0, -0.06, -0.26, -0.1, 0.05, 0.012), capsule(p, 0.08, 0, 0, 0.06, -0.26, -0.1, 0.05, 0.012)),
    color: (p) => (p[1] < -0.16 ? [0.05, 0.03, 0.03] : shade(dark, 0.8)),
  }, voxelLitMaterial()));
  head.add(sdfMesh(`${K}:eyes`, {
    min: [-0.22, 0, 0.0], max: [0.22, 0.22, 0.2], step: 0.016,
    sdf: (p) => {
      let d = 1;
      for (let i = 0; i < 8; i++) {
        const row = i < 4 ? 0 : 1, k = (i % 4) - 1.5;
        d = Math.min(d, sphere(p, k * 0.09 * (row ? 0.7 : 1), 0.08 + row * 0.08, 0.1, row ? 0.035 : 0.045));
      }
      return d;
    },
    color: () => mix(sp.c3, [1, 1, 1], 0.2),
  }, voxelGlowMaterial()));
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const s = i % 2 === 0 ? -1 : 1, row = Math.floor(i / 2);
    const hip = group(body, s * 0.34, by + 0.02, -0.5 + row * 0.2);
    hip.rotation.y = s * (0.55 - row * 0.38);
    // femur rises to a knee well above the body, tibia and tarsus reach down and out
    hip.add(sdfMesh(`${K}:femur${s}`, {
      min: [Math.min(0, s * 0.95) - 0.1, -0.1, -0.1], max: [Math.max(0, s * 0.95) + 0.1, 0.8, 0.1], step: 0.03,
      sdf: (p) => capsule(p, 0, 0, 0, s * 0.85, 0.7, 0, 0.075, 0.05),
      color: (p) => shade(dark, Math.sin(p[0] * s * 18) > 0.7 ? 0.55 : 0.9),
    }, voxelLitMaterial()));
    const knee = group(hip, s * 0.85, 0.7, 0);
    knee.add(sdfMesh(`${K}:tibia${s}`, {
      min: [Math.min(0, s * 0.8) - 0.08, -1.8, -0.08], max: [Math.max(0, s * 0.8) + 0.08, 0.08, 0.08], step: 0.03,
      sdf: (p) => smin(capsule(p, 0, 0, 0, s * 0.55, -1.0, 0, 0.05, 0.035), capsule(p, s * 0.55, -1.0, 0, s * 0.7, -1.7, 0, 0.035, 0.012), 0.03),
      color: (p) => (p[1] < -1.45 ? [0.04, 0.03, 0.03] : shade(dark, Math.sin(p[1] * 16) > 0.75 ? 0.55 : 0.85)),
    }, voxelLitMaterial()));
    hip.userData = { phase: (row % 2 === 0 ? 0 : Math.PI) + (s > 0 ? Math.PI : 0), spider: true, knee, side: s };
    legs.push(hip);
  }
  return { root, body, legs, head, neck: null, tail: [], baseY: 0 };
}

const BUILDERS = { quad: buildQuad, biped: buildBiped, hopper: buildHopper, flyer: buildFlyer, floater: buildFloater, crawler: buildCrawler, manikin: buildManikin, spider: buildSpider };

export function buildFauna(sp) {
  const b = BUILDERS[sp.plan];
  if (!b) return null;
  const rng = new RNG(hash32(sp.seed, 4411));
  const S = makeSkin(sp, rng);
  const K = `fauna:${sp.plan}:${sp.seed}`;
  const r = b(sp, rng, S, K);
  r.root.userData = {
    body: r.body, legs: r.legs, wings: r.wings || [], baseY: r.baseY, head: r.head, neck: r.neck,
    tail: r.tail || [], rig: 'fauna', hopper: !!r.hopper, floater: !!r.floater,
  };
  return r.root;
}

// Walk cycles with knees, tails that follow, heads that look about, wings that fold at the wrist,
// threads that drift. Runs after CreatureManager's base pass (which swings the hips).
export function animFauna(c, dt, time) {
  const ud = c.model.userData, plan = c.sp.plan;
  const mv = c.moving ? 1 : 0;
  c.gait = (c.gait || 0) + (mv - (c.gait || 0)) * Math.min(1, dt * 6);
  const g = c.gait;
  for (const leg of ud.legs) {
    const u = leg.userData;
    const ph = c.phase + (u.phase || 0);
    if (u.floater) {
      // threads drift, each segment a little behind the one above
      u.segs.forEach((s, i) => { s.rotation.x = Math.sin(time * 1.6 + u.phase + i * 0.7) * 0.22; s.rotation.z = Math.cos(time * 1.3 + u.phase + i * 0.6) * 0.18; });
      continue;
    }
    if (u.hop) { leg.rotation.x = -g * Math.max(0, Math.sin(c.phase * 0.8)) * 0.9; continue; }
    if (u.fore) { leg.rotation.x = g * Math.sin(c.phase * 0.8 + 1) * 0.5; continue; }
    if (u.insect) {
      leg.rotation.x *= 0.5;
      leg.rotation.z = u.side * g * Math.max(0, Math.cos(ph)) * 0.25;
      if (u.knee) u.knee.rotation.z = -u.side * g * Math.max(0, Math.cos(ph)) * 0.3;
      continue;
    }
    if (u.spider) {
      if (u.knee) u.knee.rotation.z = -u.side * g * Math.max(0, Math.cos(ph * 1.3)) * 0.25;
      continue;
    }
    // knees fold while the foot swings forward; hind hocks the other way
    const lift = Math.max(0, Math.cos(ph)) * (0.35 + 0.65 * g);
    if (u.knee) u.knee.rotation.x = (u.hind ? 0.9 : u.biped ? 0.9 : u.arm ? -0.3 : -0.9) * lift * (c.moving ? 1 : 0.05);
    if (u.ankle) u.ankle.rotation.x = -u.knee.rotation.x * 0.85;
  }
  // wings: the outer half lags the shoulder
  for (const w of ud.wings) {
    const wr = w.userData.wrist;
    if (wr) wr.rotation.z = Math.sin(time * 9 + c.phase - 0.9) * 0.45 * w.userData.side * (c.folded ? 0 : 1) + (c.folded ? 1.8 * w.userData.side : 0);
  }
  // tails sway and follow the turn
  ud.tail.forEach((s, i) => {
    s.rotation.y = Math.sin(time * (1.4 + g * 2) + c.phase * 0.3 - i * 0.6) * (0.12 + 0.1 * i) * (plan === 'flyer' ? 0.3 : 1);
    if (plan === 'biped' && i === 0) s.rotation.x = -0.05 + Math.sin(c.phase * 2) * 0.05 * g;
  });
  // the head: bobs with the walk, looks about when still, breathes
  if (ud.head && ud.head !== ud.body && plan !== 'manikin') {
    if (!c.headDown) ud.head.rotation.x = Math.sin(c.phase * 2) * 0.06 * g;
    ud.head.rotation.y = (1 - g) * Math.sin(time * 0.37 + c.phase * 0.1) * 0.45 * (Math.sin(time * 0.11 + c.phase) > 0.2 ? 1 : 0.1);
  }
  if (ud.floater) {
    ud.body.rotation.x = Math.sin(time * 0.7 + c.phase) * 0.08;
    ud.body.rotation.z = Math.cos(time * 0.6 + c.phase) * 0.08;
    const pulse = 1 + Math.sin(time * 2.2 + c.phase) * 0.05;
    ud.body.scale.set(pulse, 2 - pulse, pulse);
  } else if (ud.body && !c.sit) {
    ud.body.scale.y = 1 + Math.sin(time * 2.1 + c.phase) * 0.012 * (1 - g);
  }
}
