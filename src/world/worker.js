// Chunk generation worker: terrain + structures + meshing off the main thread.
import { TerrainGen } from './terrain.js';
import { meshChunk, computeHeights } from './mesher.js';
import { PW } from '../config.js';

let gen = null;
let planetKey = -1;
let tints = null;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'planet') {
    gen = new TerrainGen(msg.params);
    planetKey = msg.key;
    tints = new Float32Array(msg.params.tints);
    return;
  }
  if (msg.type === 'gen') {
    if (!gen || msg.key !== planetKey) {
      self.postMessage({ type: 'skip', id: msg.id, key: msg.key });
      return;
    }
    const data = gen.generate(msg.cx, msg.cz, msg.edits);
    const heights = computeHeights(data, new Int16Array(PW * PW));
    const mesh = meshChunk(data, heights, tints, msg.cx * 16, msg.cz * 16);
    const transfer = [data.buffer, heights.buffer];
    for (const k of ['opaque', 'cutout', 'translucent']) {
      const m = mesh[k];
      transfer.push(m.pos.buffer, m.uvl.buffer, m.tint.buffer, m.light.buffer, m.idx.buffer);
    }
    self.postMessage({ type: 'chunk', id: msg.id, key: msg.key, cx: msg.cx, cz: msg.cz, data, heights, mesh }, transfer);
  }
};
