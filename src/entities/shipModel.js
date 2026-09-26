// Procedural starship + multi-tool models, assembled from boxes (a voxel-toy aesthetic).
import * as THREE from 'three';
import { RNG, hsl } from '../core/rng.js';
import { applyCurvature } from '../core/shaderlib.js';
import { voxelize, ellipsoid, sphere, capsule, smin, fbm3 } from './sdfModel.js';

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
  const glow = new THREE.MeshBasicMaterial({ color: 0xffa060, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  applyCurvature(glow);
  const flameGeo = new THREE.ConeGeometry(1, 1, 10, 1, true);
  flameGeo.translate(0, 0.5, 0);
  flameGeo.rotateX(-Math.PI / 2);
  flameGeo.rotateX(Math.PI);
  const nozzle = new THREE.MeshBasicMaterial({ color: 0xffd0a0 });
  applyCurvature(nozzle);
  const addFlame = (x, y, z, r) => {
    const f = new THREE.Mesh(flameGeo, glow);
    f.position.set(x, y, z);
    f.scale.set(r, r, 1);
    f.name = 'flame';
    f.userData.baseZ = z;
    f.renderOrder = 9;
    g.add(f);
    box(r * 1.5, r * 1.5, 0.08, nozzle, x, y, z - 0.03, g);
    return f;
  };
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
    addFlame(s * 1.15, 0.1, 4.12, 0.32);
  }
  box(1.0, 1.0, 1.0, dark, 0, 0.1, 3.6, g);
  addFlame(0, 0.1, 4.12, 0.36);
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
  // panel lines, an antenna and blinking navigation lights
  const seam = mat(0x1d2027);
  for (const z of [-2.2, -0.2, 1.8]) box(1.84, 0.04, 0.05, seam, 0, 0.6, z, g);
  box(0.05, 0.05, 5.8, seam, 0.91, 0.1, 0, g);
  box(0.05, 0.05, 5.8, seam, -0.91, 0.1, 0, g);
  box(0.06, 0.9, 0.06, dark, 0.5, 0.95, 0.9, g);
  const nav = [];
  const navLight = (color, x, y, z, phase) => {
    const m = applyCurvature(new THREE.MeshBasicMaterial({ color }));
    nav.push({ l: box(0.22, 0.22, 0.22, m, x, y, z, g), phase });
  };
  const tipY = -0.1 + (wingStyle === 1 ? 0.6 : wingStyle === 2 ? -0.5 : 0);
  navLight(0xff2a2a, -(0.9 + wingSpan), tipY + 0.05, 0.1, 0);
  navLight(0x2aff5a, 0.9 + wingSpan, tipY + 0.05, 0.1, 0);
  navLight(0xffffff, 0, 2.25, 3.2, 0.5);
  g.userData.nav = nav;
  g.userData.flames = g.children.filter((c) => c.name === 'flame');
  g.userData.gear = gear;
  g.userData.colors = { hull: c1, trim: c2, accent: c3 };
  return g;
}

export function buildSentinelDrone() {
  const g = new THREE.Group();
  const shell = mat(0xc3c9d3);
  const dark = mat(0x363b46);
  const brass = mat(0xb08a52);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3322 });
  applyCurvature(eyeMat);
  // faceted core
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), shell);
  core.scale.set(1, 0.78, 1);
  g.add(core);
  box(1.35, 0.16, 1.35, dark, 0, 0, 0, g); // armour band
  box(0.7, 0.26, 0.7, shell, 0, 0.5, 0, g); // crown
  box(0.18, 0.4, 0.18, dark, 0, 0.78, 0, g); // antenna mast
  box(0.06, 0.3, 0.06, brass, 0.12, 0.95, 0, g);
  // visor slit with the eye behind it
  box(0.7, 0.3, 0.2, dark, 0, 0.04, -0.55, g);
  const eye = box(0.48, 0.12, 0.08, eyeMat, 0, 0.04, -0.66, g);
  // side fins
  for (const s of [-1, 1]) {
    const fin = box(0.12, 0.6, 0.8, dark, s * 0.78, -0.05, 0.1, g);
    fin.rotation.z = s * 0.2;
    box(0.14, 0.12, 0.3, brass, s * 0.86, -0.36, 0.1, g);
  }
  // a slowly turning ring with lit studs
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.045, 4, 20), dark);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * Math.PI * 2;
    box(0.12, 0.12, 0.12, eyeMat, Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0, ring);
  }
  // thruster glow underneath
  const thr = new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  applyCurvature(thr);
  box(0.3, 0.06, 0.3, thr, 0, -0.52, 0, g);
  g.userData.eye = eye;
  g.userData.eyeMat = eyeMat;
  g.userData.ring = ring;
  return g;
}

// A station traveller NPC: a boxy humanoid in a pastel suit with a glowing visor
export function buildTraveller(seed = 1) {
  const rng = new RNG(seed);
  const g = new THREE.Group();
  const suit = mat(new THREE.Color().setRGB(...hsl(rng.next(), rng.range(0.3, 0.6), rng.range(0.55, 0.75))));
  const trim = mat(new THREE.Color().setRGB(...hsl(rng.next(), 0.5, 0.35)));
  const skin = mat(new THREE.Color().setRGB(...hsl(rng.next(), rng.range(0.2, 0.6), rng.range(0.45, 0.7))));
  const visorCol = new THREE.Color().setRGB(...hsl(rng.next(), 0.9, 0.65));
  const visor = applyCurvature(new THREE.MeshBasicMaterial({ color: visorCol }));
  const body = new THREE.Group();
  g.add(body);
  box(0.55, 0.75, 0.32, suit, 0, 1.25, 0, body);
  box(0.58, 0.14, 0.34, trim, 0, 0.92, 0, body);
  const head = new THREE.Group();
  head.position.set(0, 1.85, 0);
  body.add(head);
  const hs = rng.range(0.38, 0.5);
  box(hs, hs * rng.range(0.9, 1.3), hs, skin, 0, 0, 0, head);
  box(hs * 0.8, 0.12, 0.05, visor, 0, 0.02, -hs / 2 - 0.02, head);
  if (rng.chance(0.5)) box(0.08, 0.3, 0.08, trim, hs * 0.3, hs * 0.7, 0, head);
  if (rng.chance(0.4)) box(hs * 1.3, 0.08, hs * 1.3, trim, 0, hs * 0.55, 0, head);
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.36, 1.58, 0);
    body.add(arm);
    box(0.16, 0.62, 0.16, suit, 0, -0.3, 0, arm);
    box(0.17, 0.12, 0.17, skin, 0, -0.64, 0, arm);
    arm.userData.side = s;
    const leg = box(0.2, 0.86, 0.22, trim, s * 0.14, 0.43, 0, g);
    leg.userData.side = s;
  }
  box(0.5, 0.5, 0.18, trim, 0, 1.3, 0.24, body); // backpack
  g.userData.head = head;
  g.userData.body = body;
  g.userData.arms = body.children.filter((c) => c.userData.side);
  return g;
}

// Hostile "Nightmare": a living ship, an eye in a carapace, trailing tendrils.
// Plain materials: it lives in space, where the world does not bend.
let nightmareGeo = null;
export function buildNightmare(seed = 1) {
  const rng = new RNG(seed);
  const g = new THREE.Group();
  if (!nightmareGeo) {
    nightmareGeo = voxelize({
      min: [-5.2, -1.8, -5], max: [5.2, 1.8, 7.2], step: 0.17,
      sdf: (p) => {
        let d = ellipsoid(p, 0, 0, 0, 1.3, 0.85, 3.2) + fbm3(p[0] * 0.8, p[1] * 0.8, p[2] * 0.8, 2) * 0.18;
        for (let i = 0; i < 6; i++) d = smin(d, sphere(p, 0, 0.7, -1.6 + i * 0.7, 0.32 - i * 0.03), 0.25);
        d = Math.max(d, -sphere(p, 0, 0.08, -3.05, 0.62));
        for (const s of [-1, 1]) {
          d = smin(d, capsule(p, s * 0.6, -0.3, -2.4, s * 0.38, -0.7, -4.4, 0.2, 0.05), 0.12);
          d = Math.min(d, ellipsoid(p, s * 2.9, 0.15, 0.7, 2.2, 0.12, 1.0));
          d = smin(d, capsule(p, s * 1.0, 0.1, 0.2, s * 4.8, 0.35, 1.2, 0.14, 0.05), 0.1);
        }
        for (let i = 0; i < 5; i++) {
          const a = i / 5 * Math.PI * 2;
          const x = Math.cos(a) * 0.55, y = Math.sin(a) * 0.4;
          d = smin(d, capsule(p, x, y, 2.6, x * 2.2, y * 2.2 - 0.3, 6.8, 0.22, 0.04), 0.2);
        }
        return d;
      },
      color: (p) => {
        if (Math.abs(p[0]) > 1.5 && Math.abs(p[1]) < 0.3) return [0.18, 0.1, 0.22];
        if (p[2] < -2.3 && p[1] < -0.2) return [0.62, 0.57, 0.52];
        const n = fbm3(p[0] * 1.5, p[1] * 1.5, p[2] * 1.5, 2);
        return p[1] > 0.55 ? [0.22 + n * 0.1, 0.12, 0.26] : [0.07 + n * 0.08, 0.05 + n * 0.04, 0.1 + n * 0.1];
      },
    });
  }
  const body = new THREE.Mesh(nightmareGeo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  g.add(body);
  const eyeCol = new THREE.Color().setRGB(...hsl(rng.range(0.8, 0.98), 0.95, 0.6));
  const eye = new THREE.MeshBasicMaterial({ color: eyeCol });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), eye);
  ball.position.set(0, 0.08, -2.95);
  g.add(ball);
  const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.62, 0.08), new THREE.MeshBasicMaterial({ color: 0x050008 }));
  pupil.position.set(0, 0.08, -3.42);
  g.add(pupil);
  const glow = new THREE.MeshBasicMaterial({ color: eyeCol, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  for (const s of [-1, 1]) box(0.45, 0.45, 0.2, glow, s * 0.55, 0, 3.0, g);
  g.scale.setScalar(1.3);
  g.userData.eyeMat = eye;
  g.userData.pupil = pupil;
  return g;
}
