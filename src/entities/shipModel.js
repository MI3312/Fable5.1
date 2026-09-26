// Procedural starship (a signed-distance hull, voxelised) and other small machines built from boxes.
import * as THREE from 'three';
import { RNG, hsl } from '../core/rng.js';
import { applyCurvature } from '../core/shaderlib.js';
import { voxelize, voxelLitMaterial, ellipsoid, sphere, capsule, smin, fbm3 } from './sdfModel.js';

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

function sdBox(p, cx, cy, cz, bx, by, bz, r = 0) {
  const qx = Math.abs(p[0] - cx) - bx + r, qy = Math.abs(p[1] - cy) - by + r, qz = Math.abs(p[2] - cz) - bz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
const shipGeoCache = new Map();
function shipGeo(key, spec) {
  if (!shipGeoCache.has(key)) shipGeoCache.set(key, voxelize(spec));
  return shipGeoCache.get(key);
}
let _canopyMat = null;
function canopyMat() {
  if (!_canopyMat) _canopyMat = applyCurvature(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x1d6f86, emissiveIntensity: 0.9 }));
  return _canopyMat;
}

// Ship faces -Z (forward), +Y up. Roughly 11 units long.
export function buildShip(seed = 1) {
  const rng = new RNG(seed);
  const g = new THREE.Group();
  const hue = rng.next();
  const c1 = new THREE.Color().setRGB(...hsl(hue, 0.35, 0.72));
  const c2 = new THREE.Color().setRGB(...hsl(hue + 0.5, 0.55, 0.5));
  const c3 = new THREE.Color().setRGB(...hsl(hue + rng.range(0.1, 0.3), 0.7, 0.6));
  const dark = mat(0x2a2d36);
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
  // Hull: one signed distance field (fuselage, swept wings, nacelles, spine, fin) voxelised finely
  // with baked occlusion, panel seams and livery painted by the colour function.
  const wingSpan = rng.range(3.5, 5.0);
  const wingStyle = rng.int(0, 2);
  const sweep = rng.range(0.6, 1.8);
  const noseLen = rng.range(2.6, 3.4);
  const tipRise = wingStyle === 1 ? 0.6 : wingStyle === 2 ? -0.5 : 0;
  const trio = rng.chance(0.5);
  const C1 = [c1.r, c1.g, c1.b], C2 = [c2.r, c2.g, c2.b], C3 = [c3.r, c3.g, c3.b], DK = [0.16, 0.17, 0.2];
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const parts = (p) => {
    const ax = Math.abs(p[0]);
    const body = smin(
      ellipsoid(p, 0, 0.05, -0.4, 1.02, 0.66, 4.6),
      capsule(p, 0, -0.02, -3.2, 0, -0.08, -3.2 - noseLen, 0.62, 0.1), 0.5);
    const tailBlock = sdBox(p, 0, 0.05, 2.5, 0.95, 0.58, 1.3, 0.25);
    const fus = smin(body, tailBlock, 0.4);
    const spine = capsule(p, 0, 0.6, -0.6, 0, 0.72, 3.0, 0.2, 0.28);
    // swept, tapered wing with dihedral / anhedral
    const t = Math.min(1, Math.max(0, (ax - 0.8) / wingSpan));
    const chord = 2.7 - t * 1.6, zc = 1.1 + t * sweep, yc = -0.12 + t * tipRise, th = 0.15 - t * 0.07;
    const wing = Math.max(Math.abs(p[2] - zc) - chord / 2, Math.abs(p[1] - yc) - th, ax - (0.8 + wingSpan), 0.6 - ax) - 0.02;
    const tipX = 0.8 + wingSpan, tipZ = 1.1 + sweep;
    const tip = capsule([ax, p[1], p[2]], tipX, -0.12 + tipRise - 0.1, tipZ - 0.9, tipX, -0.12 + tipRise + 0.55, tipZ + 0.5, 0.14, 0.09);
    const nac = Math.min(
      capsule([ax, p[1], p[2]], 1.2, 0.08, 0.6, 1.2, 0.08, 3.85, 0.46, 0.5),
      trio ? capsule(p, 0, 0.12, 2.2, 0, 0.12, 3.95, 0.5, 0.52) : 99);
    const nozzleCut = Math.min(
      capsule([ax, p[1], p[2]], 1.2, 0.08, 3.9, 1.2, 0.08, 4.6, 0.33),
      trio ? capsule(p, 0, 0.12, 4.0, 0, 0.12, 4.6, 0.36) : 99);
    const fin = Math.max(sdBox(p, 0, 1.25, 2.9 + (p[1] - 0.7) * 0.7, 0.07, 0.62, 0.62, 0.03), -(p[1] - 0.55));
    const gun = capsule([ax, p[1], p[2]], 0.8 + wingSpan * 0.55, -0.3 + t * tipRise * 0, -1.4, 0.8 + wingSpan * 0.55, -0.3, 1.2, 0.09);
    const intake = sdBox([ax, p[1], p[2]], 1.02, -0.02, -0.9, 0.18, 0.28, 0.6, 0.1);
    return { fus, spine, wing, tip, nac, nozzleCut, fin, gun, intake };
  };
  const hullSdf = (p) => {
    const q = parts(p);
    let d = smin(q.fus, q.spine, 0.2);
    d = smin(d, q.wing, 0.35);
    d = smin(d, q.nac, 0.25);
    d = Math.min(d, q.tip, q.fin, q.gun);
    d = smin(d, q.intake, 0.1);
    d = Math.max(d, -q.nozzleCut);
    // cockpit well (the canopy sits in it)
    d = Math.max(d, -ellipsoid(p, 0, 0.58, -1.65, 0.56, 0.36, 1.15));
    return d;
  };
  const hullCol = (p) => {
    const q = parts(p);
    const ax = Math.abs(p[0]);
    let base = C1;
    const m = Math.min(q.fus, q.spine, q.wing, q.tip, q.nac, q.fin, q.gun, q.intake);
    if (m === q.nac || m === q.gun || m === q.intake) base = DK;
    else if (m === q.tip || m === q.fin) base = C3;
    else if (m === q.spine) base = C2;
    else if (m === q.wing) {
      // livery stripe near the tips, dark leading edge
      const t = (ax - 0.8) / wingSpan;
      if (t > 0.62 && t < 0.74) base = C2;
      if (p[2] < 1.1 + t * sweep - (2.7 - t * 1.6) / 2 + 0.18) base = shade(C1, 0.72);
    } else {
      // fuselage: belly darker, side stripe, nose tip in trim
      if (p[1] < -0.35) base = shade(C1, 0.62);
      if (Math.abs(p[1] - 0.05) < 0.08 && ax > 0.7) base = C2;
      if (p[2] < -3.2 - noseLen + 0.9) base = C2;
    }
    // panel seams
    const seamZ = Math.abs(((p[2] + 10) % 1.15) - 0.575) > 0.54;
    const seamX = m === q.wing && Math.abs(((ax + 10) % 1.3) - 0.65) > 0.62;
    if ((seamZ && m !== q.gun) || seamX) base = shade(base, 0.72);
    return shade(base, 0.92 + fbm3(p[0] * 3, p[1] * 3, p[2] * 3, 2) * 0.08);
  };
  const hullMesh = new THREE.Mesh(shipGeo('hull' + seed, {
    min: [-(1.2 + wingSpan), -1.0, -3.4 - noseLen], max: [1.2 + wingSpan, 2.05, 4.7], step: 0.085,
    sdf: hullSdf, color: hullCol,
  }), voxelLitMaterial());
  g.add(hullMesh);
  // glass canopy with a glint band
  const canopy = new THREE.Mesh(shipGeo('canopy', {
    min: [-0.6, 0.2, -2.9], max: [0.6, 1.1, -0.4], step: 0.06,
    sdf: (p) => ellipsoid(p, 0, 0.6, -1.65, 0.52, 0.42, 1.1),
    color: (p) => (Math.abs(p[2] + 1.2 - p[1] * 0.6) < 0.07 ? [0.85, 1.0, 1.0] : [0.32, 0.72, 0.85]),
  }), canopyMat());
  g.add(canopy);
  for (const s of [-1, 1]) addFlame(s * 1.2, 0.08, 4.05, 0.32);
  if (trio) addFlame(0, 0.12, 4.1, 0.34);

  // landing gear
  const gear = new THREE.Group();
  gear.name = 'gear';
  for (const [x, z] of [[-1.3, 1.8], [1.3, 1.8], [0, -3.4]]) {
    box(0.18, 1.1, 0.18, dark, x, -1.1, z, gear);
    box(0.6, 0.12, 0.6, dark, x, -1.65, z, gear);
  }
  g.add(gear);
  // blinking navigation lights
  const nav = [];
  const navLight = (color, x, y, z, phase) => {
    const m = applyCurvature(new THREE.MeshBasicMaterial({ color }));
    nav.push({ l: box(0.16, 0.16, 0.16, m, x, y, z, g), phase });
  };
  const tipY = -0.12 + tipRise;
  navLight(0xff2a2a, -(0.8 + wingSpan), tipY + 0.62, 1.1 + sweep + 0.5, 0);
  navLight(0x2aff5a, 0.8 + wingSpan, tipY + 0.62, 1.1 + sweep + 0.5, 0);
  navLight(0xffffff, 0, 1.9, 3.35, 0.5);
  g.userData.nav = nav;
  g.userData.flames = g.children.filter((c) => c.name === 'flame');
  g.userData.gear = gear;
  g.userData.colors = { hull: c1, trim: c2, accent: c3 };
  // re-entry plasma sheath: nested additive shells wrapped over the nose, hidden until entry
  const plasma = new THREE.Group();
  plasma.name = 'plasma';
  const shells = [];
  for (let i = 0; i < 3; i++) {
    const pm = new THREE.MeshBasicMaterial({ color: [0xffb070, 0xff6a20, 0xff3a10][i], transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    applyCurvature(pm);
    const geo = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, pm);
    m.scale.set(2.6 + i * 1.3, 2.0 + i * 1.1, 4.5 + i * 3.2);
    m.position.z = -3.2 + i * 0.4;
    m.renderOrder = 10;
    plasma.add(m);
    shells.push(m);
  }
  plasma.visible = false;
  g.add(plasma);
  g.userData.plasma = { group: plasma, shells };
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
