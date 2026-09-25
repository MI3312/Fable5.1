// Procedural starship + multi-tool models, assembled from boxes (a voxel-toy aesthetic).
import * as THREE from 'three';
import { RNG, hsl } from '../core/rng.js';
import { applyCurvature } from '../core/shaderlib.js';

function mat(color, opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts });
  return applyCurvature(m);
}

function box(w, h, d, material, x = 0, y = 0, z = 0, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  if (parent) parent.add(m);
  return m;
}

// Ship faces -Z (forward), +Y up. Roughly 9 units long.
export function buildShip(seed = 1) {
  const rng = new RNG(seed);
  const g = new THREE.Group();
  const hue = rng.next();
  const c1 = new THREE.Color().setRGB(...hsl(hue, 0.35, 0.72));
  const c2 = new THREE.Color().setRGB(...hsl(hue + 0.5, 0.55, 0.5));
  const c3 = new THREE.Color().setRGB(...hsl(hue + rng.range(0.1, 0.3), 0.7, 0.6));
  const hull = mat(c1);
  const trim = mat(c2);
  const dark = mat(0x2a2d36);
  const glass = mat(0x9ff3ff, { emissive: 0x2a8fa8, emissiveIntensity: 0.7 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffa060 });
  applyCurvature(glow);
  const accent = mat(c3, { emissive: c3, emissiveIntensity: 0.35 });

  // fuselage
  box(1.8, 1.2, 6.5, hull, 0, 0, 0, g);
  box(1.4, 0.9, 2.0, hull, 0, -0.05, -4.1, g);
  box(0.9, 0.6, 1.2, trim, 0, -0.1, -5.5, g);
  box(1.2, 0.7, 2.2, glass, 0, 0.75, -1.4, g); // cockpit canopy
  box(1.9, 0.4, 3.0, trim, 0, 0.8, 1.2, g);
  box(2.0, 0.25, 6.0, dark, 0, -0.65, 0.2, g);
  // wings
  const wingSpan = rng.range(3.5, 5.0);
  const wingStyle = rng.int(0, 2);
  for (const s of [-1, 1]) {
    const w = box(wingSpan, 0.22, 2.4, hull, s * (0.9 + wingSpan / 2), -0.1, 1.2, g);
    if (wingStyle === 1) w.rotation.z = s * 0.25;
    if (wingStyle === 2) w.rotation.z = -s * 0.18;
    box(0.4, 0.3, 2.6, trim, s * (0.9 + wingSpan), -0.1 + (wingStyle === 1 ? 0.6 : wingStyle === 2 ? -0.5 : 0), 1.2, g);
    box(0.25, 0.9, 1.0, accent, s * (0.9 + wingSpan), 0.4 + (wingStyle === 1 ? 0.6 : wingStyle === 2 ? -0.5 : 0), 1.8, g);
    // wing cannons
    box(0.18, 0.18, 1.6, dark, s * (0.9 + wingSpan * 0.6), -0.3, -0.4, g);
    // engines
    box(0.9, 0.9, 2.2, dark, s * 1.15, 0.1, 3.0, g);
    const flame = box(0.6, 0.6, 0.3, glow, s * 1.15, 0.1, 4.15, g);
    flame.name = 'flame';
  }
  box(1.0, 1.0, 1.0, dark, 0, 0.1, 3.6, g);
  const cflame = box(0.7, 0.7, 0.3, glow, 0, 0.1, 4.15, g);
  cflame.name = 'flame';
  // tail fin
  box(0.2, 1.4, 1.6, trim, 0, 1.3, 2.4, g);
  box(0.25, 0.3, 1.2, accent, 0, 2.0, 2.6, g);
  // landing gear
  const gear = new THREE.Group();
  gear.name = 'gear';
  for (const [x, z] of [[-1.3, 1.8], [1.3, 1.8], [0, -3.4]]) {
    box(0.18, 1.1, 0.18, dark, x, -1.1, z, gear);
    box(0.6, 0.12, 0.6, dark, x, -1.65, z, gear);
  }
  g.add(gear);
  g.userData.flames = g.children.filter((c) => c.name === 'flame');
  g.userData.gear = gear;
  g.userData.colors = { hull: c1, trim: c2, accent: c3 };
  return g;
}

// First-person multi-tool (rendered in a separate overlay pass)
export function buildMultitool() {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: 0xe4e8ef, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c3039, flatShading: true });
  const accent = new THREE.MeshLambertMaterial({ color: 0xff9a4d, emissive: 0x5a1c00, flatShading: true });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x6ff3ff });
  const s = 0.55;
  const add = (w, h, d, m, x, y, z) => box(w * s, h * s, d * s, m, x * s, y * s, z * s, g);
  add(0.11, 0.12, 0.5, body, 0, 0, 0);          // main body
  add(0.13, 0.05, 0.22, accent, 0, 0.08, 0.02);  // top accent plate
  add(0.08, 0.08, 0.22, dark, 0, -0.01, -0.34);  // barrel
  add(0.1, 0.1, 0.04, dark, 0, -0.01, -0.46);    // muzzle ring
  add(0.07, 0.2, 0.09, dark, 0, -0.15, 0.12);    // grip
  add(0.03, 0.03, 0.16, dark, 0.07, 0.02, -0.1); // side rail
  const crystal = add(0.04, 0.04, 0.2, glowMat, -0.065, 0.02, 0.02);
  const tip = add(0.05, 0.05, 0.03, glowMat, 0, -0.01, -0.485);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.5 * s);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  g.userData.crystal = crystal;
  g.userData.tip = tip;
  g.userData.glowMat = glowMat;
  return g;
}

export function buildSentinelDrone() {
  const g = new THREE.Group();
  const shell = mat(0xb9c0cc);
  const dark = mat(0x3a3f4a);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
  applyCurvature(eyeMat);
  box(1.3, 0.9, 1.3, shell, 0, 0, 0, g);
  box(1.5, 0.3, 1.0, dark, 0, -0.1, 0, g);
  box(0.9, 0.3, 0.9, shell, 0, 0.55, 0, g);
  const eye = box(0.5, 0.35, 0.2, eyeMat, 0, 0.05, -0.68, g);
  for (const s of [-1, 1]) box(0.2, 0.5, 0.9, dark, s * 0.95, 0, 0.1, g);
  g.userData.eye = eye;
  g.userData.eyeMat = eyeMat;
  return g;
}
