// Signed-distance-field modelling: creatures are described as maths (smooth unions of
// ellipsoids, capsules, tori, displaced by noise), then voxelised into blocky meshes with
// per-vertex ambient occlusion so they sit naturally in the voxel world.
import * as THREE from 'three';
import { Noise } from '../core/noise.js';
import { applyCurvature } from '../core/shaderlib.js';

// ---------------------------------------------------------------- SDF primitives
export const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

export function sphere(p, cx, cy, cz, r) { return len3(p[0] - cx, p[1] - cy, p[2] - cz) - r; }

export function ellipsoid(p, cx, cy, cz, rx, ry, rz) {
  const x = p[0] - cx, y = p[1] - cy, z = p[2] - cz;
  const k0 = len3(x / rx, y / ry, z / rz);
  const k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
  return k1 > 1e-9 ? k0 * (k0 - 1) / k1 : -Math.min(rx, ry, rz);
}

// capsule between a and b with radius ra at a tapering to rb at b
export function capsule(p, ax, ay, az, bx, by, bz, ra, rb = ra) {
  const pax = p[0] - ax, pay = p[1] - ay, paz = p[2] - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const bb = bax * bax + bay * bay + baz * baz;
  let h = bb > 0 ? (pax * bax + pay * bay + paz * baz) / bb : 0;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h);
}

export function box(p, cx, cy, cz, bx, by, bz, r = 0) {
  const qx = Math.abs(p[0] - cx) - bx + r, qy = Math.abs(p[1] - cy) - by + r, qz = Math.abs(p[2] - cz) - bz + r;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

export function torus(p, cx, cy, cz, R, r) {
  const x = p[0] - cx, y = p[1] - cy, z = p[2] - cz;
  const q = Math.sqrt(x * x + z * z) - R;
  return Math.sqrt(q * q + y * y) - r;
}

// polynomial smooth min / max
export function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

const _noise = new Noise(9173);
export const noise3 = (x, y, z) => _noise.n3(x, y, z);
export const fbm3 = (x, y, z, o = 3) => _noise.fbm3(x, y, z, o);

// ---------------------------------------------------------------- voxeliser
const DIRS = [
  // normal, u axis, v axis (quad corners = origin + {0,u,v,u+v} in CCW order seen from outside)
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], shade: 0.86 },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.86 },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0], shade: 1.0 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.62 },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.78 },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], shade: 0.78 },
];

/**
 * Voxelise a signed distance field.
 * @param {object} o
 * @param {(p:number[])=>number} o.sdf     negative inside
 * @param {(p:number[])=>number[]} o.color rgb 0..1 at a point inside the shape
 * @param {number[]} o.min, o.max          bounds in model space
 * @param {number} o.step                  voxel edge length
 * @returns {THREE.BufferGeometry}
 */
export function voxelize({ sdf, color, min, max, step }) {
  const nx = Math.max(1, Math.ceil((max[0] - min[0]) / step));
  const ny = Math.max(1, Math.ceil((max[1] - min[1]) / step));
  const nz = Math.max(1, Math.ceil((max[2] - min[2]) / step));
  const N = nx * ny * nz;
  const solid = new Uint8Array(N);
  const cols = new Float32Array(N * 3);
  const p = [0, 0, 0];
  const idx = (x, y, z) => x + nx * (y + ny * z);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    p[0] = min[0] + (x + 0.5) * step; p[1] = min[1] + (y + 0.5) * step; p[2] = min[2] + (z + 0.5) * step;
    if (sdf(p) <= 0) {
      const i = idx(x, y, z);
      solid[i] = 1;
      const c = color(p);
      cols[i * 3] = c[0]; cols[i * 3 + 1] = c[1]; cols[i * 3 + 2] = c[2];
    }
  }
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) ? 0 : solid[idx(x, y, z)];
  const pos = [], nor = [], col = [], ind = [];
  let vc = 0;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = idx(x, y, z);
    if (!solid[i]) continue;
    const r = cols[i * 3], g = cols[i * 3 + 1], b = cols[i * 3 + 2];
    for (const D of DIRS) {
      const ox = x + D.n[0], oy = y + D.n[1], oz = z + D.n[2];
      if (at(ox, oy, oz)) continue;
      // face origin corner
      const fx = x + (D.n[0] > 0 ? 1 : 0), fy = y + (D.n[1] > 0 ? 1 : 0), fz = z + (D.n[2] > 0 ? 1 : 0);
      const aos = [];
      for (let k = 0; k < 4; k++) {
        const su = k & 1 ? 1 : 0, sv = k & 2 ? 1 : 0;
        const cx = fx + D.u[0] * su + D.v[0] * sv;
        const cy = fy + D.u[1] * su + D.v[1] * sv;
        const cz = fz + D.u[2] * su + D.v[2] * sv;
        // AO: sample the 3 voxels touching this corner in the layer in front of the face
        const du = su ? 1 : -1, dv = sv ? 1 : -1;
        const side1 = at(ox + D.u[0] * du, oy + D.u[1] * du, oz + D.u[2] * du);
        const side2 = at(ox + D.v[0] * dv, oy + D.v[1] * dv, oz + D.v[2] * dv);
        const corner = at(ox + D.u[0] * du + D.v[0] * dv, oy + D.u[1] * du + D.v[1] * dv, oz + D.u[2] * du + D.v[2] * dv);
        const occ = side1 && side2 ? 3 : side1 + side2 + corner;
        const ao = 1 - occ * 0.17;
        aos.push(ao);
        pos.push(min[0] + cx * step, min[1] + cy * step, min[2] + cz * step);
        nor.push(D.n[0], D.n[1], D.n[2]);
        const s = D.shade * ao;
        col.push(r * s, g * s, b * s);
      }
      // corners: 0=(0,0) 1=(u) 2=(v) 3=(u+v); flip the diagonal to avoid AO artefacts
      if (aos[0] + aos[3] >= aos[1] + aos[2]) ind.push(vc, vc + 1, vc + 3, vc, vc + 3, vc + 2);
      else ind.push(vc, vc + 1, vc + 2, vc + 1, vc + 3, vc + 2);
      vc += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(vc > 65535 ? new THREE.Uint32BufferAttribute(ind, 1) : new THREE.Uint16BufferAttribute(ind, 1));
  geo.computeBoundingSphere();
  return geo;
}

// ---------------------------------------------------------------- materials
let litMat = null, glowMat = null, gelMat = null;
export function voxelLitMaterial() {
  if (!litMat) litMat = applyCurvature(new THREE.MeshLambertMaterial({ vertexColors: true }));
  return litMat;
}
// full-bright (spirits, eyes): ignores lighting but still fogs
export function voxelGlowMaterial() {
  if (!glowMat) glowMat = applyCurvature(new THREE.MeshBasicMaterial({ vertexColors: true }));
  return glowMat;
}
export function voxelGelMaterial() {
  if (!gelMat) gelMat = applyCurvature(new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.72, depthWrite: false, emissive: 0x223322 }));
  return gelMat;
}

const geoCache = new Map();
// Free every cached shape whose key starts with a prefix (species of a world left behind)
export function dropCached(prefix) {
  for (const [k, g] of geoCache) if (k.startsWith(prefix)) { g.dispose(); geoCache.delete(k); }
}
// Build (or reuse) a voxel mesh for a keyed shape
export function sdfMesh(key, spec, material) {
  let geo = geoCache.get(key);
  if (!geo) { geo = voxelize(spec); geoCache.set(key, geo); }
  const m = new THREE.Mesh(geo, material || voxelLitMaterial());
  return m;
}
