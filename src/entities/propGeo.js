// A small builder for hard-edged furniture: boxes and quads with their colours baked per vertex
// (face shading, a little occlusion toward the back of recesses), merged into one geometry so a
// whole bookcase of books is one draw. Used where signed-distance voxelising would be too coarse
// (a 3 cm book spine) or too heavy (a thousand of them).
import * as THREE from 'three';

// face shading, matching the voxeliser's: tops brightest, undersides darkest
const SH = { px: 0.76, nx: 0.76, py: 1.0, ny: 0.56, pz: 0.9, nz: 0.62 };

export class GeoBuilder {
  constructor() {
    this.p = []; this.c = []; this.i = [];
    this.ao = null;   // (x, y, z) => multiplier, for darkening into recesses
    this.tf = null;   // optional point transform for the next shapes
  }
  _v(x, y, z, col, k) {
    let q = [x, y, z];
    if (this.tf) q = this.tf(q);
    const a = this.ao ? this.ao(q[0], q[1], q[2]) : 1;
    this.p.push(q[0], q[1], q[2]);
    this.c.push(col[0] * k * a, col[1] * k * a, col[2] * k * a);
  }
  // four corners, counter-clockwise seen from the front
  quad(a, b, c, d, col, k = 1, cols = null) {
    const n = this.p.length / 3;
    this._v(a[0], a[1], a[2], cols ? cols[0] : col, k);
    this._v(b[0], b[1], b[2], cols ? cols[1] : col, k);
    this._v(c[0], c[1], c[2], cols ? cols[2] : col, k);
    this._v(d[0], d[1], d[2], cols ? cols[3] : col, k);
    this.i.push(n, n + 1, n + 2, n, n + 2, n + 3);
  }
  // an axis-aligned box; o.skip: faces to leave out ('nz', 'ny', ...); o.strips: horizontal bands
  // of colour up the front (+z) face as [[t0, t1, col], ...] in 0..1 of the height; o.cols: per-face colours
  box(x0, y0, z0, x1, y1, z1, col, o = {}) {
    const sk = o.skip || '';
    const fc = (f) => (o.cols && o.cols[f]) || col;
    if (!sk.includes('pz')) {
      if (o.strips) {
        for (const [t0, t1, sc] of o.strips) {
          const ya = y0 + (y1 - y0) * t0, yb = y0 + (y1 - y0) * t1;
          this.quad([x0, ya, z1], [x1, ya, z1], [x1, yb, z1], [x0, yb, z1], sc, SH.pz);
        }
      } else this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], fc('pz'), SH.pz);
    }
    if (!sk.includes('nz')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], fc('nz'), SH.nz);
    if (!sk.includes('px')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], fc('px'), SH.px);
    if (!sk.includes('nx')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], fc('nx'), SH.nx);
    if (!sk.includes('py')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], fc('py'), SH.py);
    if (!sk.includes('ny')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], fc('ny'), SH.ny);
  }
  // a box between two points with a square cross-section (rails, legs, chains)
  beam(a, b, w, col, skip = '') {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    const f = new THREE.Vector3(dx / L, dy / L, dz / L);
    const up = Math.abs(f.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const r = new THREE.Vector3().crossVectors(up, f).normalize();
    const u = new THREE.Vector3().crossVectors(f, r);
    const m = new THREE.Matrix4().makeBasis(r, u, f).setPosition(a[0], a[1], a[2]);
    const prev = this.tf;
    const v = new THREE.Vector3();
    this.tf = (q) => { v.set(q[0], q[1], q[2]).applyMatrix4(m); const o = [v.x, v.y, v.z]; return prev ? prev(o) : o; };
    this.box(-w / 2, -w / 2, 0, w / 2, w / 2, L, col, { skip });
    this.tf = prev;
  }
  // run fn with every point transformed (rotation about z around a pivot, then translation)
  with(tf, fn) { const prev = this.tf; this.tf = prev ? (q) => prev(tf(q)) : tf; fn(); this.tf = prev; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    const n = this.p.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// rotate about the z axis around (px, py), then move by (tx, ty, tz)
export const rotZ = (a, px, py, tx = 0, ty = 0, tz = 0) => {
  const c = Math.cos(a), s = Math.sin(a);
  return (q) => [px + (q[0] - px) * c - (q[1] - py) * s + tx, py + (q[0] - px) * s + (q[1] - py) * c + ty, q[2] + tz];
};
// rotate about the y axis around the origin, then move
export const rotY = (a, tx = 0, ty = 0, tz = 0) => {
  const c = Math.cos(a), s = Math.sin(a);
  return (q) => [q[0] * c + q[2] * s + tx, q[1] + ty, -q[0] * s + q[2] * c + tz];
};

// a tiny seeded random stream
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
