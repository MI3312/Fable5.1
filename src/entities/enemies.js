// Hostile fauna: things that hunt you. Modelled as signed distance fields and voxelised like the
// vermin, each rig exposing the parts its behaviour animates (see behaviours.js).
import * as THREE from 'three';
import { hash32 } from '../core/rng.js';
import { applyCurvature } from '../core/shaderlib.js';
import {
  sdfMesh, voxelGlowMaterial, voxelLitMaterial,
  sphere, ellipsoid, capsule, box, torus, smin, smax, noise3, fbm3,
} from './sdfModel.js';

const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function group(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
const glowMats = new Map();
function glowMat(rgb, additive = false) {
  const k = rgb.join(',') + additive;
  if (!glowMats.has(k)) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]) });
    if (additive) { m.transparent = true; m.blending = THREE.AdditiveBlending; m.depthWrite = false; }
    glowMats.set(k, applyCurvature(m));
  }
  return glowMats.get(k);
}

// ------------------------------------------------------------------------------------------
// Sandmaw: a burrowing worm that follows footsteps under the ground and comes up through them.
function buildSandmaw(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0); // raised/lowered by the behaviour
  const hide = sp.c1, gum = [0.45, 0.06, 0.08], bone = [0.92, 0.88, 0.76];
  const segs = [];
  for (let i = 0; i < 4; i++) {
    const seg = group(body, 0, -1.1 - i * 1.25, 0);
    seg.add(sdfMesh('maw-seg' + (sp.seed % 7) + i, {
      min: [-1.05, -0.8, -1.05], max: [1.05, 0.8, 1.05], step: 0.09,
      sdf: (p) => {
        let d = ellipsoid(p, 0, 0, 0, 0.82 - i * 0.04, 0.72, 0.82 - i * 0.04);
        d = smin(d, torus(p, 0, 0.25, 0, 0.8 - i * 0.04, 0.12), 0.1);
        return d + fbm3(p[0] * 3, p[1] * 3 + i, p[2] * 3, 2) * 0.05;
      },
      color: (p) => shade(p[1] > 0.15 ? mix(hide, [0.2, 0.17, 0.14], 0.4) : hide, 0.75 + fbm3(p[0] * 5, p[1] * 5, p[2] * 5, 2) * 0.35),
    }));
    segs.push(seg);
  }
  const head = group(body, 0, 0, 0);
  const mouth = (p) => ellipsoid(p, 0, 0.75, 0, 0.62, 0.8, 0.62);
  head.add(sdfMesh('maw-head' + (sp.seed % 7), {
    min: [-1.15, -0.9, -1.15], max: [1.15, 1.2, 1.15], step: 0.08,
    sdf: (p) => {
      let d = smin(ellipsoid(p, 0, 0, 0, 0.95, 0.85, 0.95), torus(p, 0, 0.55, 0, 0.78, 0.2), 0.2);
      d = smax(d, -mouth(p), 0.06);
      return d + fbm3(p[0] * 3.5, p[1] * 3.5, p[2] * 3.5, 2) * 0.04;
    },
    color: (p) => (mouth(p) < 0.1 ? mix(gum, [0.12, 0.01, 0.02], Math.max(0, 0.7 - p[1])) : shade(hide, 0.8 + fbm3(p[0] * 4, p[1] * 4, p[2] * 4, 2) * 0.35)),
  }));
  // three hinged jaws of teeth that splay open when it strikes
  const jaws = [];
  for (let j = 0; j < 3; j++) {
    const a = (j / 3) * Math.PI * 2;
    const jaw = group(head, Math.cos(a) * 0.62, 0.95, Math.sin(a) * 0.62);
    jaw.rotation.y = -a;
    jaw.add(sdfMesh('maw-jaw' + (sp.seed % 3), {
      min: [-0.35, -0.1, -0.55], max: [0.35, 1.25, 0.55], step: 0.05,
      sdf: (p) => {
        let d = capsule(p, 0, 0, 0, -0.18, 1.0, 0, 0.17, 0.05);
        for (let t = -2; t <= 2; t++) d = Math.min(d, capsule(p, -0.05, 0.25 + Math.abs(t) * 0.1, t * 0.17, -0.34, 0.45 + Math.abs(t) * 0.12, t * 0.2, 0.05, 0.012));
        return d;
      },
      color: (p) => (p[0] < -0.1 ? bone : mix(hide, gum, 0.5)),
    }));
    jaws.push(jaw);
  }
  // pit of small eyes around the rim
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), glowMat(sp.c3));
    e.position.set(Math.cos(a) * 0.9, 0.35, Math.sin(a) * 0.9);
    head.add(e);
  }
  root.userData = { body, legs: [], wings: [], baseY: 0, head, jaws, segs };
  return root;
}

// ------------------------------------------------------------------------------------------
// Spitter: a rooted, bulbous pod that swells and lobs caustic globs.
function buildSpitter(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const skin = sp.c1, vein = sp.c2, acid = sp.c3;
  body.add(sdfMesh('spit-base' + (sp.seed % 5), {
    min: [-1.1, -0.1, -1.1], max: [1.1, 1.3, 1.1], step: 0.07,
    sdf: (p) => {
      let d = capsule(p, 0, 0, 0, 0.05, 1.2, 0, 0.26, 0.17);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        d = smin(d, capsule(p, 0, 0.05, 0, Math.cos(a) * 0.95, 0.12 + (i % 2) * 0.2, Math.sin(a) * 0.95, 0.12, 0.03), 0.12);
      }
      return d;
    },
    color: (p) => shade(mix(skin, vein, Math.max(0, 0.6 - p[1] * 0.4)), 0.8 + noise3(p[0] * 6, p[1] * 6, p[2] * 6) * 0.2),
  }));
  const head = group(body, 0, 1.35, 0);
  const pod = group(head, 0, 0, 0);
  const lip = (p) => ellipsoid(p, 0, 0.1, -0.52, 0.2, 0.2, 0.2);
  pod.add(sdfMesh('spit-pod' + (sp.seed % 5), {
    min: [-0.7, -0.6, -0.8], max: [0.7, 0.8, 0.7], step: 0.06,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0.1, 0, 0.55, 0.6, 0.55);
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; d = smin(d, capsule(p, Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5, Math.cos(a) * 0.58, 0.55, Math.sin(a) * 0.5, 0.09, 0.02), 0.08); }
      d = smin(d, ellipsoid(p, 0, 0.1, -0.5, 0.3, 0.3, 0.16), 0.08);
      return smax(d, -lip(p), 0.04);
    },
    color: (p) => {
      if (lip(p) < 0.12) return mix(acid, [0.1, 0.1, 0.02], 0.3);
      const v = Math.abs(noise3(p[0] * 7, p[1] * 7, p[2] * 7));
      return v < 0.06 ? mix(acid, vein, 0.4) : shade(skin, 0.85 + p[1] * 0.2);
    },
  }));
  // glowing acid sac visible through the skin
  const sac = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glowMat(shade(acid, 0.9), true));
  sac.position.set(0, 0.1, 0);
  pod.add(sac);
  root.userData = { body, legs: [], wings: [], baseY: 0, head, pod, sac };
  return root;
}

// ------------------------------------------------------------------------------------------
// Mote swarm: a cloud of tiny glowing biters that hunts light.
function buildSwarm(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0, 0);
  const n = 22;
  const geo = new THREE.OctahedronGeometry(0.055, 0);
  const mat = applyCurvature(new THREE.MeshBasicMaterial({ color: new THREE.Color(sp.c3[0], sp.c3[1], sp.c3[2]), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const motes = new THREE.InstancedMesh(geo, mat, n);
  motes.frustumCulled = false;
  body.add(motes);
  const seeds = [];
  for (let i = 0; i < n; i++) {
    const h = hash32(sp.seed, i, 31);
    seeds.push({ a: (h & 1023) / 1023 * 6.28, b: ((h >>> 10) & 1023) / 1023 * 6.28, r: 0.4 + ((h >>> 20) & 255) / 255 * 1.1, w: 1.5 + ((h >>> 5) & 255) / 255 * 3, alive: true });
  }
  root.userData = { body, legs: [], wings: [], baseY: 0, motes, seeds, alive: n };
  return root;
}

// ------------------------------------------------------------------------------------------
// Carapace: a low armoured charger. Its front shrugs off bolts; its back does not.
function buildBrute(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 1.15, 0);
  const shell = sp.c1, hide = sp.c2, weak = sp.c3;
  const plate = (p) => {
    // overlapping plates across the front and back
    let d = ellipsoid(p, 0, 0.25, -0.35, 1.05, 0.85, 1.1);
    d = smin(d, ellipsoid(p, 0, 0.15, 0.55, 0.9, 0.7, 0.8), 0.15);
    return d;
  };
  body.add(sdfMesh('brute-body' + (sp.seed % 5), {
    min: [-1.2, -0.9, -1.6], max: [1.2, 1.2, 1.6], step: 0.08,
    sdf: (p) => {
      let d = plate(p);
      d = smin(d, ellipsoid(p, 0, -0.35, 0, 0.8, 0.55, 1.2), 0.2);
      // ridges between plates
      d -= Math.max(0, Math.sin(p[2] * 7) * 0.04);
      // cut a socket for the weak spot on the back
      d = smax(d, -sphere(p, 0, 0.62, 0.85, 0.3), 0.05);
      return d + fbm3(p[0] * 3, p[1] * 3, p[2] * 3, 2) * 0.03;
    },
    color: (p) => {
      const top = p[1] > -0.1 && plate(p) < 0.1;
      const n = 0.8 + fbm3(p[0] * 4, p[1] * 4, p[2] * 4, 2) * 0.3;
      return top ? shade(mix(shell, [0.9, 0.9, 0.95], Math.max(0, Math.sin(p[2] * 7)) * 0.15), n) : shade(hide, n);
    },
  }));
  const sac = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), glowMat(weak));
  sac.position.set(0, 0.6, 0.85);
  body.add(sac);
  const head = group(body, 0, -0.15, -1.35);
  head.add(sdfMesh('brute-head' + (sp.seed % 5), {
    min: [-0.8, -0.6, -0.9], max: [0.8, 0.6, 0.5], step: 0.06,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0, -0.1, 0.55, 0.42, 0.5);
      for (const s of [-1, 1]) d = smin(d, capsule(p, s * 0.35, -0.12, -0.35, s * 0.62, 0.25, -0.78, 0.1, 0.03), 0.05);
      return d;
    },
    color: (p) => (Math.abs(p[0]) > 0.4 && p[2] < -0.3 ? [0.9, 0.86, 0.76] : shade(shell, 0.7)),
  }));
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), glowMat([1, 0.35, 0.15]));
    e.position.set(s * 0.25, 0.1, -0.58);
    head.add(e);
  }
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1, row = Math.floor(i / 2);
    const leg = group(body, s * 0.72, -0.5, -0.7 + row * 0.7);
    leg.add(sdfMesh('brute-leg', {
      min: [-0.25, -0.75, -0.25], max: [0.25, 0.15, 0.25], step: 0.05,
      sdf: (p) => capsule(p, 0, 0, 0, 0, -0.6, 0, 0.18, 0.11),
      color: (p) => (p[1] < -0.5 ? [0.12, 0.1, 0.1] : hide),
    }));
    leg.userData.phase = (row % 2 ? Math.PI : 0) + (s > 0 ? Math.PI : 0);
    legs.push(leg);
  }
  root.userData = { body, legs, wings: [], baseY: body.position.y, head, sac };
  return root;
}

// ------------------------------------------------------------------------------------------
// Lurker: a boulder flecked with ore. It isn't a boulder.
function buildLurker(sp) {
  const root = new THREE.Group();
  const body = group(root, 0, 0.62, 0);
  const rock = sp.c1, ore = sp.c3, gum = [0.35, 0.05, 0.1], tooth = [0.9, 0.87, 0.8];
  const rockSdf = (p) => ellipsoid(p, 0, 0, 0, 0.78, 0.62, 0.72) + fbm3(p[0] * 2.6 + sp.seed % 7, p[1] * 2.6, p[2] * 2.6, 3) * 0.16;
  const rockCol = (p) => {
    const f = noise3(p[0] * 6, p[1] * 6, p[2] * 6);
    if (f > 0.42) return ore;
    return shade(rock, 0.72 + fbm3(p[0] * 5, p[1] * 5, p[2] * 5, 2) * 0.4);
  };
  // bottom half (with the lower teeth), top half on a hinge at the back
  body.add(sdfMesh('lurk-bot' + (sp.seed % 5), {
    min: [-0.95, -0.8, -0.95], max: [0.95, 0.08, 0.95], step: 0.06,
    sdf: (p) => {
      let d = smax(rockSdf(p), p[1] - 0.02, 0.02);
      d = smax(d, -ellipsoid(p, 0, 0.02, -0.08, 0.55, 0.28, 0.52), 0.04);
      for (let i = 0; i < 7; i++) { const a = (i / 6 - 0.5) * 2.4; d = Math.min(d, capsule(p, Math.sin(a) * 0.55, -0.05, -Math.cos(a) * 0.5 - 0.08, Math.sin(a) * 0.5, 0.12, -Math.cos(a) * 0.46 - 0.08, 0.05, 0.01)); }
      return d;
    },
    color: (p) => (p[1] > -0.12 ? (Math.hypot(p[0], p[2] + 0.08) > 0.4 && p[1] > -0.02 ? tooth : gum) : rockCol(p)),
  }));
  const hinge = group(body, 0, 0.02, 0.6);
  const top = group(hinge, 0, 0, -0.6);
  top.add(sdfMesh('lurk-top' + (sp.seed % 5), {
    min: [-0.95, -0.05, -0.95], max: [0.95, 0.85, 0.95], step: 0.06,
    sdf: (p) => {
      let d = smax(rockSdf(p), -(p[1] - 0.02), 0.02);
      d = smax(d, -ellipsoid(p, 0, 0.02, -0.08, 0.52, 0.22, 0.5), 0.04);
      for (let i = 0; i < 6; i++) { const a = (i / 5 - 0.5) * 2.3; d = Math.min(d, capsule(p, Math.sin(a) * 0.53, 0.08, -Math.cos(a) * 0.48 - 0.08, Math.sin(a) * 0.48, -0.08, -Math.cos(a) * 0.44 - 0.08, 0.05, 0.01)); }
      return d;
    },
    color: (p) => (p[1] < 0.1 ? (Math.hypot(p[0], p[2] + 0.08) > 0.4 ? tooth : gum) : rockCol(p)),
  }));
  const eyes = [];
  for (let i = 0; i < 4; i++) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.04), glowMat([1, 0.85, 0.2]));
    e.position.set((i - 1.5) * 0.14, 0.12 + (i % 2) * 0.05, -0.6);
    e.visible = false;
    top.add(e);
    eyes.push(e);
  }
  // spindly legs folded underneath
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const s = i % 2 ? 1 : -1, row = Math.floor(i / 2);
    const leg = group(body, s * 0.5, -0.2, -0.35 + row * 0.35);
    leg.add(sdfMesh('lurk-leg', {
      min: [-0.08, -0.9, -0.08], max: [0.08, 0.05, 0.08], step: 0.035,
      sdf: (p) => capsule(p, 0, 0, 0, 0, -0.8, 0, 0.05, 0.02),
      color: () => [0.18, 0.14, 0.14],
    }));
    leg.rotation.z = s * 1.35;
    leg.userData.phase = (row % 2 ? Math.PI : 0) + (s > 0 ? Math.PI : 0);
    leg.userData.side = s;
    legs.push(leg);
  }
  root.userData = { body, legs, wings: [], baseY: body.position.y, head: top, hinge, eyes };
  return root;
}

export const ENEMY_BUILDERS = {
  sandmaw: buildSandmaw,
  spitter: buildSpitter,
  swarm: buildSwarm,
  brute: buildBrute,
  lurker: buildLurker,
};

export const ENEMIES = {
  sandmaw: {
    names: ['Sandmaw', 'Hollow Worm', 'Deep Mouth'], size: [1.0, 1.3], temper: 'Hunting', diet: 'Footsteps',
    note: 'It listens for walking', speed: 7, rarity: 'Rare', produce: 'maw_tooth',
    hitY: 1.0, hitR: 1.2, health: 260, hostile: true,
  },
  spitter: {
    names: ['Spitter', 'Bile Pod', 'Caustic Bloom'], size: [0.9, 1.25], temper: 'Territorial', diet: 'Absorbic',
    note: 'It aims where you are going', speed: 0, rarity: 'Uncommon', produce: 'acid_gland',
    hitY: 1.4, hitR: 0.75, health: 90, hostile: true,
  },
  swarm: {
    names: ['Mote Swarm', 'Lampbiter Cloud', 'Glimmer Swarm'], size: [1, 1], temper: 'Hunting', diet: 'Light',
    note: 'Put out your light', speed: 5.6, rarity: 'Uncommon', produce: 'mote_dust',
    hitY: 0, hitR: 1.3, health: 22, hostile: true, flies: true,
  },
  brute: {
    names: ['Carapace', 'Ironback', 'Plated Charger'], size: [1.0, 1.25], temper: 'Aggressive', diet: 'Lithovore',
    note: 'Nothing gets through the front', speed: 2.4, rarity: 'Rare', produce: 'carapace_plate',
    hitY: 1.1, hitR: 1.3, health: 320, hostile: true,
  },
  lurker: {
    names: ['Lurker', 'Stone Mouth', 'Glitter Rock'], size: [0.9, 1.3], temper: 'Waiting', diet: 'Miners',
    note: 'The ore is bait', speed: 6.5, rarity: 'Uncommon', produce: 'lurker_heart',
    hitY: 0.6, hitR: 0.8, health: 140, hostile: true,
  },
};
