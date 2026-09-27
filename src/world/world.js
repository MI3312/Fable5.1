// Main-thread chunk manager: streams chunks from the worker pool, owns voxel data,
// applies player edits (with padded-border sync) and re-meshes locally.
import * as THREE from 'three';
import { CHUNK, HEIGHT, PW, chunkKey } from '../config.js';
import { meshChunk, computeHeights, computeColumnHeight } from './mesher.js';
import { TerrainGen } from './terrain.js';
import { B, IS_SOLID, IS_AIRLIKE, IS_LIQUID, BLOCKS } from './blocks.js';

function makeWorker() {
  if (globalThis.__LUCID_WORKER_SRC__) {
    const blob = new Blob([globalThis.__LUCID_WORKER_SRC__], { type: 'text/javascript' });
    return new Worker(URL.createObjectURL(blob));
  }
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

class Chunk {
  constructor(cx, cz) {
    this.cx = cx; this.cz = cz;
    this.data = null;
    this.heights = null;
    this.meshes = [null, null, null];
    this.dirty = false;
  }
}

const SPHERE_CENTER = new THREE.Vector3(8, 56, 8);

export class World {
  constructor(scene, materials, opts = {}) {
    this.scene = scene;
    this.materials = [materials.opaque, materials.cutout, materials.translucent];
    this.group = new THREE.Group();
    this.group.name = 'chunks';
    scene.add(this.group);
    this.chunks = new Map();
    this.pending = new Map();
    this.renderDist = 7;
    this.planetKey = 0;
    this.params = null;
    this.terrain = null;
    this.edits = new Map(); // chunkKey -> Map(localIndex -> id)
    this.jobId = 1;
    const n = opts.workers || Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = makeWorker();
      w.busy = 0;
      w.onmessage = (e) => this._onWorkerMessage(w, e.data);
      w.onerror = (e) => console.error('Worker error', e.message || e);
      this.workers.push(w);
    }
    this.results = [];
    this.loadedCount = 0;
  }

  setRenderDistance(d) { this.renderDist = d; }

  setPlanet(params, editsObj) {
    this.clear();
    this.planetKey++;
    this.params = params;
    this.terrain = new TerrainGen(params);
    this.tints = new Float32Array(params.tints);
    this.edits = new Map();
    if (editsObj) this.importEdits(editsObj);
    for (const w of this.workers) {
      w.postMessage({ type: 'planet', key: this.planetKey, params });
      w.busy = 0;
    }
  }

  clear() {
    for (const c of this.chunks.values()) this._disposeChunk(c);
    this.chunks.clear();
    this.pending.clear();
    this.results.length = 0;
  }

  _disposeChunk(c) {
    for (let i = 0; i < 3; i++) {
      const m = c.meshes[i];
      if (m) { this.group.remove(m); m.geometry.dispose(); c.meshes[i] = null; }
    }
  }

  _onWorkerMessage(w, msg) {
    w.busy = Math.max(0, w.busy - 1);
    if (msg.key !== this.planetKey) return;
    const k = chunkKey(msg.cx, msg.cz);
    this.pending.delete(k);
    if (msg.type === 'chunk') this.results.push(msg);
  }

  _editsForChunk(cx, cz) {
    const out = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const m = this.edits.get(chunkKey(cx + dx, cz + dz));
      if (!m) continue;
      for (const [li, id] of m) {
        const lx = li & 15, lz = (li >> 4) & 15, y = li >> 8;
        const px = lx + dx * CHUNK + 1, pz = lz + dz * CHUNK + 1;
        if (px < 0 || pz < 0 || px >= PW || pz >= PW) continue;
        out.push(px, y, pz, id);
      }
    }
    return out.length ? out : null;
  }

  update(px, pz, budgetMs = 6) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.renderDist;
    // unload far chunks
    for (const [k, c] of this.chunks) {
      if (Math.abs(c.cx - pcx) > R + 2 || Math.abs(c.cz - pcz) > R + 2) {
        this._disposeChunk(c);
        this.chunks.delete(k);
      }
    }
    // request missing chunks, nearest first
    const want = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > (R + 0.5) * (R + 0.5)) continue;
      const cx = pcx + dx, cz = pcz + dz;
      const k = chunkKey(cx, cz);
      if (this.chunks.has(k) || this.pending.has(k)) continue;
      want.push([d2, cx, cz, k]);
    }
    if (want.length) {
      want.sort((a, b) => a[0] - b[0]);
      let wi = 0;
      for (const w of this.workers) {
        while (w.busy < 2 && wi < want.length) {
          const [, cx, cz, k] = want[wi++];
          this.pending.set(k, true);
          w.busy++;
          w.postMessage({ type: 'gen', id: this.jobId++, key: this.planetKey, cx, cz, edits: this._editsForChunk(cx, cz) });
        }
      }
    }
    // integrate results within budget
    const t0 = performance.now();
    while (this.results.length && performance.now() - t0 < budgetMs) {
      const msg = this.results.shift();
      const k = chunkKey(msg.cx, msg.cz);
      if (Math.abs(msg.cx - pcx) > R + 1 || Math.abs(msg.cz - pcz) > R + 1) continue;
      let c = this.chunks.get(k);
      if (c) this._disposeChunk(c);
      c = new Chunk(msg.cx, msg.cz);
      c.data = msg.data;
      c.heights = msg.heights;
      this.chunks.set(k, c);
      // re-apply edits made while this chunk was being generated
      const ed = this._editsForChunk(msg.cx, msg.cz);
      let changed = false;
      if (ed) {
        for (let i = 0; i < ed.length; i += 4) {
          const idx = ed[i] + PW * (ed[i + 2] + PW * ed[i + 1]);
          if (c.data[idx] !== ed[i + 3]) { c.data[idx] = ed[i + 3]; changed = true; }
        }
      }
      if (changed) { computeHeights(c.data, c.heights); c.dirty = true; }
      else this._applyMesh(c, msg.mesh);
      this.loadedCount++;
    }
    // re-mesh edited chunks
    for (const c of this.chunks.values()) {
      if (c.dirty) {
        c.dirty = false;
        this._applyMesh(c, meshChunk(c.data, c.heights, this.tints, c.cx * CHUNK, c.cz * CHUNK));
      }
    }
  }

  _applyMesh(c, mesh) {
    c.lights = mesh.lights || c.lights;
    const parts = [mesh.opaque, mesh.cutout, mesh.translucent];
    for (let i = 0; i < 3; i++) {
      const m = parts[i];
      const old = c.meshes[i];
      if (old) { this.group.remove(old); old.geometry.dispose(); c.meshes[i] = null; }
      if (!m || m.idx.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
      g.setAttribute('uvl', new THREE.BufferAttribute(m.uvl, 3));
      g.setAttribute('tint', new THREE.BufferAttribute(m.tint, 3, true));
      g.setAttribute('light', new THREE.BufferAttribute(m.light, 4, true));
      if (m.sway) g.setAttribute('sway', new THREE.BufferAttribute(m.sway, 1, true));
      g.setIndex(new THREE.BufferAttribute(m.idx, 1));
      g.boundingSphere = new THREE.Sphere(SPHERE_CENTER, 92);
      const mesh3 = new THREE.Mesh(g, this.materials[i]);
      mesh3.position.set(c.cx * CHUNK, 0, c.cz * CHUNK);
      mesh3.matrixAutoUpdate = false;
      mesh3.updateMatrix();
      if (i === 2) mesh3.renderOrder = 2;
      else mesh3.layers.enable(i === 0 ? 1 : 2); // shadow casters (solid / alpha-tested)
      this.group.add(mesh3);
      c.meshes[i] = mesh3;
    }
  }

  getChunkAt(x, z) {
    return this.chunks.get(chunkKey(Math.floor(x / CHUNK), Math.floor(z / CHUNK)));
  }

  isLoaded(x, z) {
    const c = this.getChunkAt(x, z);
    return !!(c && c.data);
  }

  getBlock(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.data) return -1;
    const px = x - cx * CHUNK + 1, pz = z - cz * CHUNK + 1;
    return c.data[px + PW * (pz + PW * y)];
  }

  isSolid(x, y, z) {
    const b = this.getBlock(x, y, z);
    if (b < 0) return y < this.fallbackHeight(x, z);
    return IS_SOLID[b] === 1;
  }

  fallbackHeight(x, z) {
    return this.terrain ? this.terrain.heightAt(Math.floor(x), Math.floor(z)) : 0;
  }

  // Highest solid block y at column (or terrain estimate if not loaded)
  groundAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const c = this.getChunkAt(x, z);
    if (!c || !c.data) return Math.floor(this.fallbackHeight(x, z));
    const px = x - c.cx * CHUNK + 1, pz = z - c.cz * CHUNK + 1;
    for (let y = HEIGHT - 1; y >= 0; y--) {
      const id = c.data[px + PW * (pz + PW * y)];
      if (IS_SOLID[id] || IS_LIQUID[id]) return y;
    }
    return 0;
  }

  // First solid (or liquid) block at or below y in a column; falls back to the column top
  groundBelow(x, y, z) {
    x = Math.floor(x); z = Math.floor(z);
    const c = this.getChunkAt(x, z);
    if (!c || !c.data) return Math.floor(this.fallbackHeight(x, z));
    const px = x - c.cx * CHUNK + 1, pz = z - c.cz * CHUNK + 1;
    const y0 = Math.min(HEIGHT - 1, Math.floor(y));
    for (let yy = y0; yy >= 0 && yy > y0 - 24; yy--) {
      const id = c.data[px + PW * (pz + PW * yy)];
      if (IS_SOLID[id] || IS_LIQUID[id]) return yy;
    }
    return this.groundAt(x, z);
  }

  // Top of any non-air block (incl. water), used for ship altitude
  surfaceAt(x, z) { return this.groundAt(x, z); }

  // Height of the highest sky-blocking block in a column (for shelter checks)
  skyHeightAt(x, z) {
    x = Math.floor(x); z = Math.floor(z);
    const c = this.getChunkAt(x, z);
    if (!c || !c.heights) return -1;
    return c.heights[(x - c.cx * CHUNK + 1) + PW * (z - c.cz * CHUNK + 1)];
  }

  // Number of loaded chunks within a radius (in chunks) of a point
  loadedAround(x, z, r) {
    const pcx = Math.floor(x / CHUNK), pcz = Math.floor(z / CHUNK);
    let n = 0, total = 0;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      total++;
      const c = this.chunks.get(chunkKey(pcx + dx, pcz + dz));
      if (c && c.data) n++;
    }
    return n / total;
  }

  setBlock(x, y, z, id, record = true) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 1 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c || !c.data) return false;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    // write into this chunk and any neighbour whose padding contains the cell
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const n = dx === 0 && dz === 0 ? c : this.chunks.get(chunkKey(cx + dx, cz + dz));
      if (!n || !n.data) continue;
      const px = lx + 1 - dx * CHUNK, pz = lz + 1 - dz * CHUNK;
      if (px < 0 || pz < 0 || px >= PW || pz >= PW) continue;
      n.data[px + PW * (pz + PW * y)] = id;
      n.heights[px + PW * pz] = computeColumnHeight(n.data, px, pz);
      n.dirty = true;
      // neighbouring columns' light may change for AO/sky: mark adjacent chunks dirty too
    }
    if (record) {
      const k = chunkKey(cx, cz);
      let m = this.edits.get(k);
      if (!m) { m = new Map(); this.edits.set(k, m); }
      m.set(lx + 16 * (lz + 16 * y), id);
      if (this.onEdit) this.onEdit(x, y, z, id);
    }
    return true;
  }

  // Like setBlock, but when the chunk isn't loaded yet the change is recorded and applied on generation
  editBlock(x, y, z, id) {
    if (this.setBlock(x, y, z, id)) return;
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 1 || y >= HEIGHT) return;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const k = chunkKey(cx, cz);
    let m = this.edits.get(k);
    if (!m) { m = new Map(); this.edits.set(k, m); }
    m.set((x - cx * CHUNK) + 16 * ((z - cz * CHUNK) + 16 * y), id);
    if (this.onEdit) this.onEdit(x, y, z, id);
  }

  exportEdits() {
    const out = {};
    for (const [k, m] of this.edits) {
      if (!m.size) continue;
      const arr = [];
      for (const [li, id] of m) arr.push(li, id);
      out[k] = arr;
    }
    return out;
  }

  importEdits(obj) {
    for (const k of Object.keys(obj)) {
      const arr = obj[k];
      const m = new Map();
      for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
      this.edits.set(k, m);
    }
  }

  // Voxel DDA raycast. Returns hit info or null.
  raycast(origin, dir, maxDist, opts = {}) {
    const ignoreLiquid = opts.ignoreLiquid !== false;
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const stepX = dir.x > 0 ? 1 : -1, stepY = dir.y > 0 ? 1 : -1, stepZ = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(1 / (dir.x || 1e-9)), tDeltaY = Math.abs(1 / (dir.y || 1e-9)), tDeltaZ = Math.abs(1 / (dir.z || 1e-9));
    let tMaxX = (stepX > 0 ? x + 1 - origin.x : origin.x - x) * tDeltaX;
    let tMaxY = (stepY > 0 ? y + 1 - origin.y : origin.y - y) * tDeltaY;
    let tMaxZ = (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tDeltaZ;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 512; i++) {
      const id = this.getBlock(x, y, z);
      if (id > 0 && !IS_AIRLIKE[id] && !(ignoreLiquid && IS_LIQUID[id])) {
        return { x, y, z, id, nx, ny, nz, dist: t, point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t) };
      }
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        t = tMaxX; x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
      } else if (tMaxY < tMaxZ) {
        t = tMaxY; y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
      } else {
        t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
      }
      if (t > maxDist) return null;
      if (y < 0 || y >= HEIGHT + 64) return null;
    }
    return null;
  }

  // Count blocks of given ids near a position (for scanner). Returns [{x,y,z,id}]
  scanBlocks(cx, cy, cz, radius, ids, limit = 40) {
    const found = [];
    const r = Math.floor(radius);
    const want = new Uint8Array(256);
    for (const i of ids) want[i] = 1;
    const x0 = Math.floor(cx) - r, x1 = Math.floor(cx) + r;
    const z0 = Math.floor(cz) - r, z1 = Math.floor(cz) + r;
    const y0 = Math.max(1, Math.floor(cy) - 24), y1 = Math.min(HEIGHT - 1, Math.floor(cy) + 24);
    for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) {
      const c = this.getChunkAt(x, z);
      if (!c || !c.data) continue;
      const px = x - c.cx * CHUNK + 1, pz = z - c.cz * CHUNK + 1;
      for (let y = y0; y <= y1; y++) {
        const id = c.data[px + PW * (pz + PW * y)];
        if (want[id]) {
          const d = Math.hypot(x - cx, y - cy, z - cz);
          if (d <= radius) found.push({ x, y, z, id, d });
        }
      }
    }
    found.sort((a, b) => a.d - b.d);
    return found.slice(0, limit);
  }

  dispose() {
    this.clear();
    for (const w of this.workers) w.terminate();
    this.scene.remove(this.group);
  }
}

export { BLOCKS };
