// Dresses a pocket's blocks with modelled props around the player: one BatchedMesh holding every
// kind of piece, filled from what each loaded chunk contains. A chunk is read once (and again
// whenever it's edited); every few frames the pieces within reach are placed, the detailed
// versions close by and the plain ones further out, pieces facing away left out, and each one
// lit by the air it stands in.
import * as THREE from 'three';
import { CHUNK } from '../config.js';
import { propLitMaterial } from '../entities/propLight.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

export class PropField {
  // geos: { name: BufferGeometry | { near, mid } }; scan(chunk) -> items
  //   item: { g: name, x, y, z, ry, art, glow, face: [nx, nz] (optional, for back-face skipping) }
  constructor(L, geos, scan, o = {}) {
    this.L = L;
    this.scan = scan;
    this.nearR = o.nearR ?? 12;
    this.farR = o.farR ?? 36;
    this.yR = o.yR ?? Infinity; // pieces further above or below than this aren't drawn
    this.cache = new Map();
    let verts = 0, inds = 0;
    const all = [];
    for (const [k, g] of Object.entries(geos)) {
      if (g.isBufferGeometry) all.push([k, g]);
      else { all.push([k + ':near', g.near]); if (g.mid) all.push([k + ':mid', g.mid]); }
    }
    for (const [, g] of all) { verts += g.attributes.position.count; inds += g.index.count; }
    this.mat = propLitMaterial(0.5);
    this.mesh = new THREE.BatchedMesh(o.max ?? 4096, verts, inds, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = true;
    this.mesh.name = 'prop-field';
    this.gid = {};
    for (const [k, g] of all) this.gid[k] = this.mesh.addGeometry(g);
    this.hasMid = new Set(Object.entries(geos).filter(([, g]) => !g.isBufferGeometry && g.mid).map(([k]) => k));
    this.ids = [];
    this.used = 0;
    this.t = 0;
    this.last = new THREE.Vector3(1e9, 0, 0);
    this.count = 0;
    L.props.add(this.mesh);
  }

  dirty() { this.t = 0; this.last.set(1e9, 0, 0); }
  forget() { this.cache.clear(); this.dirty(); }

  _items(c) {
    let e = this.cache.get(c);
    if (!e || e.rev !== c.rev) {
      e = { rev: c.rev, items: this.scan(c) };
      this.cache.set(c, e);
    }
    return e.items;
  }

  update(dt, cam) {
    this.t -= dt;
    const moved = Math.hypot(cam.x - this.last.x, cam.z - this.last.z);
    if (this.t > 0 && moved < 1.2 && Math.abs(cam.y - this.last.y) < 1.5) return;
    this.t = 0.3;
    this.last.copy(cam);
    const W = this.L.world;
    const R = this.farR, nr2 = this.nearR * this.nearR, fr2 = R * R;
    const pcx = Math.floor(cam.x / CHUNK), pcz = Math.floor(cam.z / CHUNK), cr = Math.ceil(R / CHUNK);
    const live = new Set();
    let n = 0;
    const M = this.mesh;
    for (let dz = -cr; dz <= cr; dz++) for (let dx = -cr; dx <= cr; dx++) {
      const c = W.chunks.get(`${pcx + dx},${pcz + dz}`);
      if (!c || !c.data) continue;
      live.add(c);
      for (const it of this._items(c)) {
        const ddx = it.x - cam.x, ddz = it.z - cam.z, d2 = ddx * ddx + ddz * ddz;
        if (d2 > fr2 || Math.abs(it.y - cam.y) > this.yR) continue;
        // a piece on a wall facing away from us can't be seen
        if (it.face && it.face[0] * -ddx + it.face[1] * -ddz < -1.6) continue;
        let key = it.g;
        if (this.hasMid.has(key)) key += d2 < nr2 ? ':near' : ':mid';
        const gid = this.gid[key];
        if (gid === undefined) continue;
        let id = this.ids[n];
        if (id === undefined) {
          if (M.instanceCount >= M.maxInstanceCount) break;
          id = M.addInstance(gid);
          this.ids[n] = id;
        } else M.setGeometryIdAt(id, gid);
        _q.setFromAxisAngle(_up, it.ry || 0);
        _m.compose(_p.set(it.x, it.y, it.z), _q, it.s ? _s.set(it.s, it.s, it.s) : _s.set(1, 1, 1));
        M.setMatrixAt(id, _m);
        M.setColorAt(id, _c.setRGB(it.art ?? 0.5, it.glow ?? 0, 0));
        M.setVisibleAt(id, true);
        n++;
      }
    }
    for (let i = n; i < this.used; i++) M.setVisibleAt(this.ids[i], false);
    this.used = n;
    this.count = n;
    // forget chunks that have gone
    for (const c of this.cache.keys()) if (!live.has(c) && !W.chunks.has(`${c.cx},${c.cz}`)) this.cache.delete(c);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mat.dispose();
    this.cache.clear();
  }
}
