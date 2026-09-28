// Mannequins: two metres of scuffed fibreglass on ball joints, a smooth egg of a head with only
// the suggestion of a face, and a crack across it. Sculpted from signed distance fields and
// voxelised in jointed parts. They are posed rather than animated: whenever you look back at
// one it has struck a new pose, a little nearer.
import * as THREE from 'three';
import { voxelize, sphere, ellipsoid, capsule, smin, smax, noise3 } from './sdfModel.js';
import { propLitMaterial } from './propLight.js';

const SKIN = [0.68, 0.64, 0.58], JOINT = [0.46, 0.43, 0.4];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// scuffs and hairline cracks on the fibreglass
function glass(p, base = SKIN) {
  const n = noise3(p[0] * 14, p[1] * 14, p[2] * 14), c = noise3(p[0] * 38 + 5, p[1] * 38, p[2] * 38);
  const crack = Math.abs(c - 0.5) < 0.018 ? 0.4 : 1;
  const scuff = 0.84 + n * 0.22;
  // grime, worst toward the feet and in blotches
  const g = Math.max(0, noise3(p[0] * 5 + 9, p[1] * 5, p[2] * 5) - 0.55) * 0.9;
  return [base[0] * scuff * crack * (1 - g), base[1] * scuff * crack * (1 - g * 1.1), base[2] * scuff * crack * (1 - g * 1.25)];
}

// pelvis: about the hip joint (y = 0)
const pelvisSDF = (p) => smin(ellipsoid(p, 0, 0.02, 0, 0.19, 0.13, 0.12), sphere(p, 0, 0.16, 0, 0.1), 0.06);
// torso: from the waist up (waist joint at y = 0)
function torsoSDF(p) {
  let d = ellipsoid(p, 0, 0.3, 0, 0.19, 0.3, 0.12);
  d = smin(d, ellipsoid(p, 0, 0.44, 0.0, 0.23, 0.14, 0.13), 0.08);
  d = smin(d, capsule(p, -0.2, 0.52, 0, 0.2, 0.52, 0, 0.07), 0.08);
  d = smin(d, capsule(p, 0, 0.55, 0, 0, 0.68, 0.01, 0.045), 0.03);
  d = smax(d, -p[1] + 0.02, 0.02);
  return d;
}
// head: about the top of the neck
function headSDF(p) {
  let d = ellipsoid(p, 0, 0.13, 0.01, 0.105, 0.145, 0.125);
  // the suggestion of a brow and a nose, nothing else
  d = smin(d, ellipsoid(p, 0, 0.17, 0.1, 0.07, 0.025, 0.03), 0.03);
  d = smin(d, capsule(p, 0, 0.14, 0.12, 0, 0.1, 0.135, 0.014, 0.018), 0.02);
  d = smax(d, -sphere(p, 0.04, 0.135, 0.13, 0.024), 0.015);
  d = smax(d, -sphere(p, -0.04, 0.135, 0.13, 0.024), 0.015);
  // a hole broken through one cheek
  d = Math.max(d, -ellipsoid(p, -0.05, 0.07, 0.11, 0.03, 0.035, 0.05));
  return d;
}
function headCol(p) {
  const [x, y, z] = p;
  // a crack from the crown across the face
  const line = Math.abs(x - (y - 0.13) * 0.55 - Math.sin(y * 40) * 0.008);
  if (line < 0.008 && z > -0.05) return [0.12, 0.1, 0.09];
  if (Math.hypot(Math.abs(x) - 0.04, y - 0.135) < 0.02 && z > 0.1) return [0.1, 0.08, 0.07];
  // the broken hole, black inside
  if (ellipsoid(p, -0.05, 0.07, 0.11, 0.036, 0.042, 0.056) < 0.004) return [0.03, 0.02, 0.02];
  // dark streaks run down from the eye hollows
  if (z > 0.08 && y < 0.13 && y > 0.0 && Math.abs(Math.abs(x) - 0.04 - Math.sin(y * 60 + x * 30) * 0.004) < 0.006) return [0.16, 0.11, 0.09];
  return glass(p);
}
// limbs, along -y from their joint
const upperArm = (p) => smin(capsule(p, 0, -0.03, 0, 0, -0.35, 0, 0.042, 0.034), sphere(p, 0, 0, 0, 0.05), 0.02);
const foreArm = (p) => {
  let d = capsule(p, 0, -0.02, 0, 0, -0.27, 0, 0.038, 0.03);
  d = smin(d, ellipsoid(p, 0, -0.33, 0.005, 0.035, 0.06, 0.015), 0.02);
  for (let i = 0; i < 4; i++) { const x = -0.022 + i * 0.015; d = Math.min(d, capsule(p, x, -0.36, 0.006, x * 1.3, -0.47 - (i === 1 || i === 2 ? 0.02 : 0), 0.02, 0.008, 0.006)); }
  return smin(d, sphere(p, 0, 0, 0, 0.045), 0.015);
};
const thigh = (p) => smin(capsule(p, 0, -0.03, 0, 0, -0.46, 0, 0.075, 0.055), sphere(p, 0, 0, 0, 0.07), 0.03);
const shin = (p) => {
  let d = capsule(p, 0, -0.02, 0, 0, -0.44, 0, 0.052, 0.04);
  d = smin(d, capsule(p, 0, -0.47, -0.01, 0, -0.48, 0.16, 0.035, 0.028), 0.03);
  return smin(d, sphere(p, 0, 0, 0, 0.055), 0.015);
};
const jointCol = (p) => (Math.hypot(p[0], p[1], p[2]) < 0.06 ? glass(p, JOINT) : glass(p));

const partSets = new Map();
function build(coarse = 1) {
  if (partSets.has(coarse)) return partSets.get(coarse);
  const S = 0.022 * coarse;
  const v = (sdf, color, min, max, step = S) => voxelize({ sdf, color, min, max, step });
  const parts = {
    pelvis: v(pelvisSDF, glass, [-0.22, -0.13, -0.15], [0.22, 0.28, 0.15]),
    torso: v(torsoSDF, glass, [-0.3, 0, -0.16], [0.3, 0.72, 0.16]),
    head: v(headSDF, headCol, [-0.13, -0.04, -0.14], [0.13, 0.3, 0.16], S * 0.7),
    upper: v(upperArm, jointCol, [-0.07, -0.4, -0.07], [0.07, 0.07, 0.07]),
    fore: v(foreArm, jointCol, [-0.06, -0.52, -0.05], [0.06, 0.05, 0.05], S * 0.7),
    thigh: v(thigh, jointCol, [-0.09, -0.52, -0.09], [0.09, 0.08, 0.09]),
    shin: v(shin, jointCol, [-0.07, -0.52, -0.06], [0.07, 0.06, 0.2]),
  };
  partSets.set(coarse, parts);
  return parts;
}
export function warmMannequin() { build(); build(1.1); build(1.7); }

// The jointed figure (faces +z). userData.j holds its joints.
export function buildMannequin(mat, coarse = 1) {
  const P = build(coarse);
  mat = mat || propLitMaterial(0.4);
  const g = new THREE.Group();
  const add = (parent, geo, x, y, z) => { const o = new THREE.Group(); o.position.set(x, y, z); parent.add(o); if (geo) o.add(new THREE.Mesh(geo, mat)); return o; };
  const hips = add(g, P.pelvis, 0, 1.02, 0);
  const waist = add(hips, P.torso, 0, 0.12, 0);
  const neck = add(waist, P.head, 0, 0.66, 0.01);
  const j = { hips, waist, neck };
  for (const s of [-1, 1]) {
    const sh = add(waist, P.upper, s * 0.24, 0.52, 0);
    const el = add(sh, P.fore, 0, -0.38, 0);
    const hip = add(hips, P.thigh, s * 0.11, -0.04, 0);
    const kn = add(hip, P.shin, 0, -0.5, 0);
    const k = s < 0 ? 'L' : 'R';
    j['sh' + k] = sh; j['el' + k] = el; j['hip' + k] = hip; j['kn' + k] = kn;
  }
  g.userData = { j, mat };
  g.scale.set(1.04, 1.1, 1.04);
  return g;
}

// Poses, as joint angles. Each figure keeps its own copy and snaps between them.
export const POSES = [
  // standing as displayed
  { y: 0, waist: [0, 0, 0], neck: [0, 0, 0], shL: [0.05, 0, -0.1], shR: [0.05, 0, 0.1], elL: -0.1, elR: -0.1, hipL: [0, 0, 0], hipR: [0, 0, 0], knL: 0, knR: 0 },
  // reaching for you with both hands
  { y: 0, waist: [0.25, 0, 0], neck: [-0.2, 0, 0], shL: [-1.5, 0, -0.1], shR: [-1.4, 0, 0.12], elL: -0.2, elR: -0.3, hipL: [-0.5, 0, 0], hipR: [0.35, 0, 0], knL: 0.4, knR: 0.1 },
  // mid-stride, one arm out
  { y: -0.03, waist: [0.15, 0.3, 0], neck: [0, -0.4, 0], shL: [0.6, 0, -0.1], shR: [-1.7, 0, 0.3], elL: -0.3, elR: -0.1, hipL: [-0.7, 0, 0], hipR: [0.5, 0, 0], knL: 0.6, knR: 0.3 },
  // crouched low, looking up
  { y: -0.42, waist: [0.6, 0, 0], neck: [-0.9, 0, 0], shL: [-0.5, 0, -0.3], shR: [-0.6, 0, 0.3], elL: -1.2, elR: -1.0, hipL: [-1.5, 0, -0.1], hipR: [-1.3, 0, 0.1], knL: 1.9, knR: 1.7 },
  // head turned right round, arms spread
  { y: 0, waist: [0, 0, 0.05], neck: [0.1, 2.6, 0.2], shL: [0, 0, -1.3], shR: [0, 0, 1.4], elL: -0.2, elR: 0.2, hipL: [0, 0, -0.05], hipR: [0, 0, 0.05], knL: 0, knR: 0 },
  // pointing at you
  { y: 0, waist: [0.05, -0.2, 0], neck: [-0.1, 0.2, 0.3], shL: [0.1, 0, -0.05], shR: [-1.55, 0, 0.05], elL: 0, elR: 0, hipL: [0, 0, 0], hipR: [-0.2, 0, 0], knL: 0, knR: 0.1 },
  // hands over its face
  { y: -0.05, waist: [0.35, 0, 0], neck: [0.5, 0, 0], shL: [-1.2, 0, 0.5], shR: [-1.2, 0, -0.5], elL: -2.2, elR: -2.2, hipL: [-0.2, 0, 0], hipR: [0, 0, 0], knL: 0.3, knR: 0.1 },
  // leaning in sideways, head tipped over
  { y: -0.02, waist: [0.2, 0, 0.5], neck: [0, 0.3, 1.0], shL: [-0.3, 0, -0.9], shR: [-0.9, 0, 0.2], elL: -0.6, elR: -0.9, hipL: [0.1, 0, 0.2], hipR: [-0.3, 0, 0.2], knL: 0.2, knR: 0.4 },
];
export function setPose(m, P) {
  const j = m.userData.j;
  j.hips.position.y = 1.02 + P.y;
  j.waist.rotation.set(...P.waist);
  j.neck.rotation.set(...P.neck);
  for (const k of ['L', 'R']) {
    j['sh' + k].rotation.set(...P['sh' + k]);
    j['el' + k].rotation.set(P['el' + k], 0, 0);
    j['hip' + k].rotation.set(...P['hip' + k]);
    j['kn' + k].rotation.set(P['kn' + k], 0, 0);
  }
}
// the stiff, quick walk you never quite see
export function walkPose(m, t) {
  const j = m.userData.j, s = Math.sin(t * 9);
  j.hips.position.y = 1.02 + Math.abs(Math.cos(t * 9)) * 0.03;
  j.waist.rotation.set(0.3, 0, 0);
  j.neck.rotation.set(-0.25, 0, Math.sin(t * 5) * 0.2);
  j.shL.rotation.set(-1.2 + s * 0.3, 0, -0.1); j.shR.rotation.set(-1.2 - s * 0.3, 0, 0.1);
  j.elL.rotation.set(-0.2, 0, 0); j.elR.rotation.set(-0.2, 0, 0);
  j.hipL.rotation.set(s * 0.7, 0, 0); j.hipR.rotation.set(-s * 0.7, 0, 0);
  j.knL.rotation.set(Math.max(0, -s) * 0.9, 0, 0); j.knR.rotation.set(Math.max(0, s) * 0.9, 0, 0);
}

// One merged geometry of a posed figure (position + colour), for the rows of them on display
export function bakedMannequin(poseIndex, extraRot = 0, coarse = 1.7) {
  const m = buildMannequin(new THREE.MeshBasicMaterial(), coarse);
  setPose(m, POSES[poseIndex]);
  m.rotation.y = extraRot;
  m.updateMatrixWorld(true);
  const pos = [], col = [], idx = [];
  const v = new THREE.Vector3();
  m.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, p = g.attributes.position, c = g.attributes.color, base = pos.length / 3;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); col.push(c.getX(i), c.getY(i), c.getZ(i)); }
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx.push(base + ix[i]);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
export { smooth };
