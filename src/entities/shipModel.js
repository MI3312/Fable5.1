// Procedural starship (a signed-distance hull, voxelised) and other small machines built from boxes.
import * as THREE from 'three';
import { RNG, hsl } from '../core/rng.js';
import { applyCurvature } from '../core/shaderlib.js';
import { voxelize, voxelLitMaterial, ellipsoid, sphere, capsule, smin, fbm3 } from './sdfModel.js';
import { normSpec } from '../data/ships.js';

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

// Ship faces -Z (forward), +Y up. Roughly 8-13 units long depending on class.
// spec: a seed (legacy: a fighter), or { cls, grade, seed, hue }. opts.detail: voxel size.
export function buildShip(spec = 1, opts = {}) {
  const S = normSpec(spec);
  const seed = S.seed;
  const rng = new RNG(seed);
  const g = new THREE.Group();
  const rolled = rng.next();
  const hue = S.hue ?? rolled;
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
  const gear = new THREE.Group();
  gear.name = 'gear';
  const leg = (x, z, top = -0.55) => {
    const len = Math.max(0.3, top + 1.6);
    box(0.18, len, 0.18, dark, x, top - len / 2, z, gear);
    box(0.6, 0.12, 0.6, dark, x, -1.65, z, gear);
  };
  const nav = [];
  const navLight = (color, x, y, z, phase) => {
    const m = applyCurvature(new THREE.MeshBasicMaterial({ color }));
    nav.push({ l: box(0.16, 0.16, 0.16, m, x, y, z, g), phase });
  };
  const K = {
    g, rng, seed, hue, step: opts.detail || 0.085, key: `${S.cls}:${seed}:${hue.toFixed(3)}:${opts.detail || 0.085}`,
    C1: [c1.r, c1.g, c1.b], C2: [c2.r, c2.g, c2.b], C3: [c3.r, c3.g, c3.b], DK: [0.16, 0.17, 0.2],
    shade: (c, k) => [c[0] * k, c[1] * k, c[2] * k],
    addFlame, dark, gear, leg, navLight,
  };
  (HULLS[S.cls] || hullFighter)(K);
  g.add(gear);
  g.userData.nav = nav;
  g.userData.flames = g.children.filter((c) => c.name === 'flame');
  g.userData.gear = gear;
  g.userData.colors = { hull: c1, trim: c2, accent: c3 };
  g.userData.spec = S;
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

function glass(key, spec) { return new THREE.Mesh(shipGeo(key, spec), canopyMat()); }
const seamsZ = (p, k) => Math.abs(((p[2] + 20) % k) - k / 2) > k / 2 - 0.035;
const grain = (p) => 0.92 + fbm3(p[0] * 3, p[1] * 3, p[2] * 3, 2) * 0.08;
// a torus lying across the ship (ring around the Z axis)
function ringZ(p, cx, cy, cz, R, r) { const x = p[0] - cx, y = p[1] - cy, z = p[2] - cz; const q = Math.hypot(x, y) - R; return Math.hypot(q, z) - r; }

// ---------------------------------------------------------------- fighter: swept wings, nacelles, spine
function hullFighter(K) {
  const { g, rng, C1, C2, C3, DK, shade, step, addFlame, key, navLight } = K;
  // Hull: one signed distance field (fuselage, swept wings, nacelles, spine, fin) voxelised finely
  // with baked occlusion, panel seams and livery painted by the colour function.
  const wingSpan = rng.range(3.5, 5.0);
  const wingStyle = rng.int(0, 2);
  const sweep = rng.range(0.6, 1.8);
  const noseLen = rng.range(2.6, 3.4);
  const tipRise = wingStyle === 1 ? 0.6 : wingStyle === 2 ? -0.5 : 0;
  const trio = rng.chance(0.5);
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
  const hullMesh = new THREE.Mesh(shipGeo(key, {
    min: [-(1.2 + wingSpan), -1.0, -3.4 - noseLen], max: [1.2 + wingSpan, 2.05, 4.7], step,
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

  for (const [x, z] of [[-1.3, 1.8], [1.3, 1.8], [0, -3.4]]) K.leg(x, z);
  const tipY = -0.12 + tipRise;
  navLight(0xff2a2a, -(0.8 + wingSpan), tipY + 0.62, 1.1 + sweep + 0.5, 0);
  navLight(0x2aff5a, 0.8 + wingSpan, tipY + 0.62, 1.1 + sweep + 0.5, 0);
  navLight(0xffffff, 0, 1.9, 3.35, 0.5);
}

// ---------------------------------------------------------------- shuttle: a friendly box with four pods
function hullShuttle(K) {
  const { g, rng, C1, C2, C3, DK, shade, step, key, addFlame, navLight, leg } = K;
  const podX = rng.range(1.8, 2.1), bodyW = rng.range(1.15, 1.35), rack = rng.chance(0.6);
  const parts = (p) => {
    const ax = Math.abs(p[0]);
    const body = smin(sdBox(p, 0, 0.2, 0.3, bodyW, 0.95, 2.6, 0.55), ellipsoid(p, 0, 0.05, -2.3, bodyW * 0.95, 0.8, 1.1), 0.5);
    const pods = Math.min(capsule([ax, p[1], p[2]], podX, -0.3, -1.7, podX, -0.3, -0.4, 0.42), capsule([ax, p[1], p[2]], podX, -0.3, 1.5, podX, -0.3, 2.9, 0.46));
    const struts = Math.min(sdBox([ax, p[1], p[2]], (bodyW + podX) / 2, -0.3, -1.0, (podX - bodyW) / 2 + 0.1, 0.1, 0.22), sdBox([ax, p[1], p[2]], (bodyW + podX) / 2, -0.3, 2.2, (podX - bodyW) / 2 + 0.1, 0.1, 0.26));
    const roof = rack ? Math.min(sdBox(p, 0, 1.22, 0.7, 0.85, 0.06, 1.5), sdBox(p, 0.35, 1.48, 1.0, 0.3, 0.22, 0.35, 0.05), sdBox(p, -0.4, 1.45, 0.2, 0.28, 0.19, 0.28, 0.05)) : 99;
    const fin = Math.max(sdBox(p, 0, 1.3, 2.5 + (p[1] - 1.1) * 0.8, 0.06, 0.45, 0.5, 0.02), -(p[1] - 1.0));
    const podCut = Math.min(capsule([ax, p[1], p[2]], podX, -0.3, 2.95, podX, -0.3, 3.4, 0.3), capsule([ax, p[1], p[2]], podX, -0.3, -1.75, podX, -0.3, -2.2, 0.26));
    return { body, pods, struts, roof, fin, podCut };
  };
  const sdf = (p) => {
    const q = parts(p);
    let d = smin(q.body, q.struts, 0.15);
    d = Math.min(d, q.pods, q.roof, q.fin);
    d = Math.max(d, -q.podCut);
    return Math.max(d, -ellipsoid(p, 0, 0.72, -2.15, bodyW * 0.82, 0.42, 0.9));
  };
  const col = (p) => {
    const q = parts(p);
    const m = Math.min(q.body, q.pods, q.struts, q.roof, q.fin);
    let c = C1;
    if (m === q.pods) c = Math.abs(p[2] - 0.6) > 2.6 || Math.abs(p[2] + 1.05) < 0.12 ? C2 : shade(C1, 0.85);
    else if (m === q.struts || m === q.roof) c = DK;
    else if (m === q.fin) c = C3;
    else { if (Math.abs(p[1] + 0.05) < 0.14) c = C2; if (p[1] < -0.55) c = shade(C1, 0.6); }
    if (seamsZ(p, 1.3) && m === q.body) c = shade(c, 0.75);
    return shade(c, grain(p));
  };
  g.add(new THREE.Mesh(shipGeo(key, { min: [-(podX + 0.6), -1.0, -3.6], max: [podX + 0.6, 1.8, 3.5], step, sdf, color: col }), voxelLitMaterial()));
  g.add(glass('canopy-shuttle' + bodyW.toFixed(2), { min: [-1.3, 0.2, -3.2], max: [1.3, 1.2, -1.1], step: 0.06, sdf: (p) => ellipsoid(p, 0, 0.72, -2.15, bodyW * 0.8, 0.4, 0.85), color: (p) => (Math.abs(p[0] * 0.5 + p[2] + 2.2) < 0.08 ? [0.85, 1, 1] : [0.3, 0.7, 0.85]) }));
  for (const s of [-1, 1]) { addFlame(s * podX, -0.3, 3.2, 0.3); }
  for (const [x, z] of [[-1.1, -1.9], [1.1, -1.9], [-1.1, 1.9], [1.1, 1.9]]) leg(x, z, -0.7);
  navLight(0xff2a2a, -(podX + 0.1), -0.3, -1.9, 0);
  navLight(0x2aff5a, podX + 0.1, -0.3, -1.9, 0);
  navLight(0xffffff, 0, 1.65, 2.8, 0.5);
}

// ---------------------------------------------------------------- hauler: slab hull, cargo pods, twin engines
function hullHauler(K) {
  const { g, rng, C1, C2, C3, DK, shade, step, key, addFlame, navLight, leg } = K;
  const pods = rng.int(2, 3), podLen = pods === 3 ? 0.85 : 1.25, hazard = rng.chance(0.5);
  const podZ = (i) => pods === 3 ? -1.9 + i * 2.1 : -1.3 + i * 2.7;
  const parts = (p) => {
    const ax = Math.abs(p[0]);
    const hull = sdBox(p, 0, 0.3, 0.3, 1.5, 1.15, 3.6, 0.4);
    const cab = sdBox(p, 0, 0.45, -3.9, 1.05, 0.8, 0.9, 0.35);
    let cargo = 99;
    for (let i = 0; i < pods; i++) cargo = Math.min(cargo, sdBox([ax, p[1], p[2]], 2.25, 0.1, podZ(i), 0.62, 0.72, podLen, 0.12));
    const wing = sdBox([ax, p[1], p[2]], 2.7, -0.55, 3.3, 1.05, 0.11, 0.8, 0.05);
    const eng = capsule([ax, p[1], p[2]], 0.85, 0.3, 3.6, 0.85, 0.3, 5.0, 0.72, 0.62);
    const engCut = capsule([ax, p[1], p[2]], 0.85, 0.3, 5.0, 0.85, 0.3, 5.6, 0.48);
    const mast = Math.min(capsule(p, 0.6, 1.4, 1.8, 0.6, 2.1, 1.8, 0.06), sphere(p, 0.6, 2.15, 1.8, 0.12));
    return { hull, cab, cargo, wing, eng, engCut, mast };
  };
  const sdf = (p) => {
    const q = parts(p);
    let d = smin(q.hull, q.cab, 0.3);
    d = Math.min(d, q.cargo, q.wing, q.mast);
    d = smin(d, q.eng, 0.2);
    d = Math.max(d, -q.engCut);
    return Math.max(d, -ellipsoid(p, 0, 0.75, -4.6, 0.85, 0.42, 0.45));
  };
  const col = (p) => {
    const q = parts(p);
    const m = Math.min(q.hull, q.cab, q.cargo, q.wing, q.eng, q.mast);
    let c = shade(C1, 0.85);
    if (m === q.cargo) {
      c = C2;
      if (hazard && Math.abs(p[1] - 0.1) < 0.72 && ((Math.floor((p[2] + p[1]) * 2.2) & 1) === 0) && Math.abs(p[1] + 0.45) < 0.14) c = DK;
      if (!hazard && Math.abs(p[1] - 0.55) < 0.1) c = C3;
    } else if (m === q.eng || m === q.mast) c = DK;
    else if (m === q.wing) c = shade(C1, 0.7);
    else if (m === q.cab) c = C1;
    else { if (Math.abs(p[1] - 1.1) < 0.12) c = C3; if (p[1] < -0.6) c = shade(C1, 0.55); }
    if (seamsZ(p, 1.0) && (m === q.hull)) c = shade(c, 0.72);
    return shade(c, grain(p));
  };
  g.add(new THREE.Mesh(shipGeo(key, { min: [-3.9, -1.1, -5.1], max: [3.9, 2.35, 5.6], step, sdf, color: col }), voxelLitMaterial()));
  g.add(glass('canopy-hauler', { min: [-1.0, 0.2, -5.2], max: [1.0, 1.3, -4.0], step: 0.06, sdf: (p) => ellipsoid(p, 0, 0.75, -4.55, 0.82, 0.4, 0.42), color: () => [0.3, 0.68, 0.82] }));
  for (const s of [-1, 1]) addFlame(s * 0.85, 0.3, 5.2, 0.5);
  for (const [x, z] of [[-1.2, -3.0], [1.2, -3.0], [-1.2, 2.6], [1.2, 2.6]]) leg(x, z, -0.85);
  navLight(0xff2a2a, -3.75, -0.5, 3.3, 0);
  navLight(0x2aff5a, 3.75, -0.5, 3.3, 0);
  navLight(0xffd040, 0.6, 2.3, 1.8, 0.5);
}

// ---------------------------------------------------------------- explorer: long hull, forward-swept wings, drive ring
function hullExplorer(K) {
  const { g, rng, C1, C2, C3, DK, shade, step, key, addFlame, navLight, leg } = K;
  const span = rng.range(2.6, 3.4), dish = rng.chance(0.7), R = rng.range(1.35, 1.6);
  const parts = (p) => {
    const ax = Math.abs(p[0]);
    const fus = capsule(p, 0, 0, -5.0, 0, 0.05, 3.1, 0.42, 0.78);
    const t = Math.min(1, Math.max(0, (ax - 0.5) / span));
    const chord = 1.7 - t * 1.1, zc = 0.6 - t * 1.9;
    const wing = Math.max(Math.abs(p[2] - zc) - chord / 2, Math.abs(p[1] + 0.1 - t * 0.25) - (0.12 - t * 0.05), ax - (0.5 + span), 0.4 - ax) - 0.02;
    const ring = ringZ(p, 0, 0.3, 3.3, R, 0.2);
    const spokes = Math.min(capsule(p, 0, 0.3, 3.3, 0, 0.3 + R, 3.3, 0.1), capsule(p, 0, 0.3, 3.3, 0, 0.3 - R, 3.3, 0.1), capsule([ax, p[1], p[2]], 0, 0.3, 3.3, R, 0.3, 3.3, 0.1));
    const core = capsule(p, 0, 0.1, 2.6, 0, 0.15, 4.3, 0.62, 0.55);
    const coreCut = capsule(p, 0, 0.15, 4.25, 0, 0.15, 4.8, 0.4);
    const sensor = dish ? Math.min(ellipsoid(p, 0, 1.0, -1.0, 0.72, 0.1, 0.72), capsule(p, 0, 0.3, -1.0, 0, 0.95, -1.0, 0.07)) : 99;
    const boom = capsule(p, 0, -0.08, -4.9, 0, -0.08, -6.5, 0.05);
    return { fus, wing, ring, spokes, core, coreCut, sensor, boom };
  };
  const sdf = (p) => {
    const q = parts(p);
    let d = smin(q.fus, q.wing, 0.3);
    d = smin(d, q.core, 0.25);
    d = Math.min(d, q.ring, q.spokes, q.sensor, q.boom);
    d = Math.max(d, -q.coreCut);
    return Math.max(d, -ellipsoid(p, 0, 0.42, -2.6, 0.4, 0.3, 1.0));
  };
  const col = (p) => {
    const q = parts(p);
    const m = Math.min(q.fus, q.wing, q.ring, q.spokes, q.core, q.sensor, q.boom);
    let c = C1;
    if (m === q.ring) c = shade(C3, 1.15);
    else if (m === q.spokes || m === q.core || m === q.boom) c = DK;
    else if (m === q.sensor) c = C2;
    else if (m === q.wing) { const t = (Math.abs(p[0]) - 0.5) / span; c = t > 0.75 ? C2 : shade(C1, 0.9); }
    else { if (p[1] < -0.3) c = shade(C1, 0.65); if (Math.abs(p[1] - 0.02) < 0.07) c = C2; }
    if (seamsZ(p, 1.4) && m === q.fus) c = shade(c, 0.75);
    return shade(c, grain(p));
  };
  g.add(new THREE.Mesh(shipGeo(key, { min: [-(span + 0.7), -1.45, -6.6], max: [span + 0.7, 2.1, 4.8], step, sdf, color: col }), voxelLitMaterial()));
  g.add(glass('canopy-explorer', { min: [-0.5, 0.05, -3.7], max: [0.5, 0.8, -1.5], step: 0.06, sdf: (p) => ellipsoid(p, 0, 0.42, -2.6, 0.38, 0.3, 0.98), color: (p) => (Math.abs(p[2] + 2.3 - p[1]) < 0.06 ? [0.85, 1, 1] : [0.32, 0.7, 0.86]) }));
  addFlame(0, 0.15, 4.5, 0.42);
  for (const [x, z] of [[0, -3.6], [-1.0, 1.8], [1.0, 1.8]]) leg(x, z, -0.55);
  navLight(0xff2a2a, -(span + 0.5), -0.05, -1.2, 0);
  navLight(0x2aff5a, span + 0.5, -0.05, -1.2, 0);
  navLight(0xffffff, 0, 0.3 + R + 0.25, 3.3, 0.5);
}

// ---------------------------------------------------------------- exotic: a pearl pod inside a ring
function hullExotic(K) {
  const { g, rng, C1, C3, shade, step, key, hue, addFlame, navLight, leg } = K;
  const R = rng.range(2.8, 3.4), spikes = rng.int(3, 6), tilt = rng.range(-0.12, 0.12);
  const parts = (p) => {
    const pod = ellipsoid(p, 0, 0.2, -0.4, 1.0, 0.8, 2.6);
    const tail = capsule(p, 0, 0.2, 1.8, 0, 0.45, 4.2, 0.36, 0.06);
    const py = p[1] - p[2] * tilt;
    const ring = Math.hypot(Math.hypot(p[0], p[2] + 0.2) - R, py) - 0.26;
    let spokes = 99;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + i * Math.PI * 2 / 3;
      spokes = Math.min(spokes, capsule(p, 0, 0.1, -0.2, Math.cos(a) * R, (Math.sin(a) * R + 0.2) * tilt * -1 * 0, Math.sin(a) * R - 0.2, 0.09, 0.05));
    }
    let sp = 99;
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + 0.3;
      const x = Math.cos(a) * R, z = Math.sin(a) * R - 0.2;
      sp = Math.min(sp, capsule(p, x, z * tilt, z, x * 1.28, z * tilt + 0.25, z * 1.28 - 0.2, 0.14, 0.02));
    }
    return { pod, tail, ring, spokes, sp };
  };
  const sdf = (p) => {
    const q = parts(p);
    let d = smin(q.pod, q.tail, 0.4);
    d = Math.min(d, q.ring, q.spokes, q.sp);
    return Math.max(d, -ellipsoid(p, 0, 0.55, -1.9, 0.55, 0.35, 0.8));
  };
  const col = (p) => {
    const q = parts(p);
    const m = Math.min(q.pod, q.tail, q.ring, q.spokes, q.sp);
    if (m === q.ring || m === q.sp) {
      // colour that slides around the ring like oil on water
      const a = Math.atan2(p[2] + 0.2, p[0]);
      return hsl(hue + 0.18 * Math.sin(a * 2) + (m === q.sp ? 0.5 : 0), 0.75, m === q.sp ? 0.7 : 0.6);
    }
    if (m === q.spokes) return shade(C3, 0.8);
    const band = Math.abs(p[1] - 0.2 - Math.sin(p[2] * 2.2) * 0.12) < 0.07;
    return shade(band ? C3 : [Math.min(1, C1[0] * 1.15), Math.min(1, C1[1] * 1.15), Math.min(1, C1[2] * 1.15)], grain(p));
  };
  const ext = R * 1.3 + 0.3;
  g.add(new THREE.Mesh(shipGeo(key, { min: [-ext, -1.2, -ext - 0.4], max: [ext, 1.6, Math.max(ext, 4.4)], step, sdf, color: col }), voxelLitMaterial()));
  g.add(glass('canopy-exotic', { min: [-0.7, 0.1, -2.9], max: [0.7, 1.0, -0.9], step: 0.06, sdf: (p) => ellipsoid(p, 0, 0.55, -1.9, 0.52, 0.33, 0.78), color: () => [0.55, 0.4, 0.85] }));
  for (const s of [-1, 1]) addFlame(s * 0.45, 0.2, 2.1, 0.22);
  for (const [x, z] of [[0, -2.2], [-0.8, 1.2], [0.8, 1.2]]) leg(x, z, -0.45);
  navLight(0xff2a2a, -R, 0, -0.2, 0);
  navLight(0x2aff5a, R, 0, -0.2, 0);
  navLight(0xffffff, 0, 0.5, 3.9, 0.5);
}

const HULLS = { fighter: hullFighter, shuttle: hullShuttle, hauler: hullHauler, explorer: hullExplorer, exotic: hullExotic };

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
