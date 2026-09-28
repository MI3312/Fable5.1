// The things in the regions of the Backrooms that have come apart. They move, so they're meshes
// of their own rather than batched furniture:
//   tears     - a jagged rip in the air, pixel-coarse, full of static, its edges magenta and cyan
//   cubes     - the missing-texture checker, hanging in the air, turning, now and then jumping
//   fragments - a swarm of wallpaper chips frozen mid-burst, drifting, snapping to new places
//   ghosts    - a light panel that came loose from the ceiling, flickering where it hangs
// and the signs over the stairwells.
import * as THREE from 'three';
import { GeoBuilder, rng, mul3 } from './propGeo.js';
import { propLitMaterial } from './propLight.js';
import { pixelCanvas, pixelText, textWidth } from './hallProps.js';

const TEAR_VS = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TEAR_FS = /* glsl */`
uniform float uTime;
uniform float uSeed;
uniform float uOpen;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  // coarse pixels, like everything else here
  vec2 px = floor(vUv * vec2(18.0, 48.0));
  vec2 uv = (px + 0.5) / vec2(18.0, 48.0);
  float tick = floor(uTime * 10.0);
  float row = px.y + floor(tick / 3.0) * 7.0;
  float mid = 1.0 - abs(uv.y * 2.0 - 1.0);
  float w = (0.12 + 0.34 * h(vec2(row, uSeed)) * mid + 0.1 * mid) * uOpen;
  float off = (h(vec2(row * 1.7, uSeed + 1.0)) - 0.5) * 0.3 * mid;
  float d = abs(uv.x - 0.5 - off) - w * 0.5;
  if (d > 0.0) discard;
  float edge = step(-0.06, d);
  vec3 col = vec3(0.0);
  float band = step(0.62, h(vec2(floor(uv.y * 24.0), tick + uSeed)));
  vec3 stat = vec3(h(px + tick), h(px * 1.3 + tick + 3.0), h(px * 0.7 + tick + 7.0));
  col += stat * (0.15 + band * 0.85);
  float flip = step(0.5, h(vec2(row, floor(uTime * 6.0) + uSeed)));
  col = mix(col, mix(vec3(1.4, 0.0, 1.3), vec3(0.0, 1.3, 1.4), flip), edge);
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildTear(seed, w = 0.9, h = 2.4) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uSeed: { value: (seed % 997) + 0.5 }, uOpen: { value: 1 } },
    vertexShader: TEAR_VS, fragmentShader: TEAR_FS, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  const R = rng(seed);
  const ph = R() * 10;
  m.userData.tick = (t) => {
    mat.uniforms.uTime.value = t + ph;
    // it breathes: wider, narrower, sometimes nearly shut
    mat.uniforms.uOpen.value = 0.55 + 0.45 * Math.sin(t * 0.7 + ph) * Math.sin(t * 1.9 + ph * 2);
  };
  m.userData.tear = true;
  return m;
}

let checker = null;
function checkerTex() {
  if (!checker) {
    checker = pixelCanvas(16, 16, (x) => {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { x.fillStyle = ((i >> 3) + (j >> 3)) & 1 ? '#f0f' : '#000'; x.fillRect(i, j, 1, 1); }
    });
    checker.minFilter = THREE.NearestFilter;
  }
  return checker;
}
export function buildErrorCube(seed) {
  const R = rng(seed);
  const s = 0.35 + R() * 0.55;
  const mat = new THREE.MeshBasicMaterial({ map: checkerTex(), color: 0xbbbbbb });
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat);
  const sp = new THREE.Vector3((R() - 0.5) * 0.8, (R() - 0.5) * 1.2, (R() - 0.5) * 0.8);
  const base = 0.6 + R() * 2.2, ph = R() * 10;
  let jumpT = 1 + R() * 3, jx = 0, jz = 0;
  m.userData.tick = (t, dt) => {
    m.rotation.x += sp.x * dt; m.rotation.y += sp.y * dt; m.rotation.z += sp.z * dt;
    m.userData.dy = base + Math.sin(t * 0.8 + ph) * 0.12;
    jumpT -= dt;
    if (jumpT <= 0) {
      jumpT = 0.4 + R() * 3;
      // a jump: somewhere a little off, a size a little wrong, a face the wrong way
      jx = (R() - 0.5) * 0.6; jz = (R() - 0.5) * 0.6;
      m.scale.setScalar(R() < 0.3 ? 0.6 + R() * 0.9 : 1);
      m.rotation.set(Math.round(R() * 4) * Math.PI / 2, m.rotation.y, 0);
    }
    m.userData.dx = jx; m.userData.dz = jz;
  };
  return m;
}

// a burst of wallpaper chips, frozen mid-flight
let fragGeo = null;
export function buildFragments(seed, n = 26) {
  if (!fragGeo) {
    const G = new GeoBuilder();
    G.box(-0.12, -0.09, -0.012, 0.12, 0.09, 0.012, [0.86, 0.78, 0.45], { cols: { nz: [0.72, 0.62, 0.4] }, strips: [[0, 0.3, [0.86, 0.78, 0.45]], [0.3, 0.38, [0.74, 0.66, 0.36]], [0.38, 1, [0.86, 0.78, 0.45]]] });
    fragGeo = G.build();
  }
  const R = rng(seed);
  const mat = propLitMaterial(1);
  const m = new THREE.InstancedMesh(fragGeo, mat, n);
  const P = [], _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = R() * Math.PI * 2, r = 0.2 + R() * 1.4, y = 0.4 + R() * 2.6;
    P.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r, rx: R() * 6, ry: R() * 6, sp: (R() - 0.5) * 0.8, s: 0.5 + R() * 1.4, ph: R() * 6 });
  }
  let snapT = 0.5;
  m.userData.tick = (t, dt) => {
    snapT -= dt;
    if (snapT <= 0) {
      snapT = 0.15 + R() * 0.6;
      const q = P[Math.floor(R() * n)];
      q.x += (R() - 0.5) * 0.5; q.z += (R() - 0.5) * 0.5; q.y = Math.min(3.3, Math.max(0.2, q.y + (R() - 0.5) * 0.5));
    }
    for (let i = 0; i < n; i++) {
      const q = P[i];
      _e.set(q.rx + t * q.sp, q.ry + t * q.sp * 0.7, 0);
      _q.setFromEuler(_e);
      _p.set(q.x, q.y + Math.sin(t * 0.6 + q.ph) * 0.05, q.z);
      _m.compose(_p, _q, _s.setScalar(q.s));
      m.setMatrixAt(i, _m);
    }
    m.instanceMatrix.needsUpdate = true;
  };
  m.userData.dispose = () => mat.dispose();
  return m;
}

// a panel of light hanging where it shouldn't, twisted, flickering
export function buildGhostPanel(seed) {
  const R = rng(seed);
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
  const frame = new THREE.MeshBasicMaterial({ color: 0x8a8a84 });
  const p = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.5), mat); g.add(p);
  const f = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.04, 0.56), frame); f.position.y = 0.035; g.add(f);
  g.rotation.set((R() - 0.5) * 0.6, R() * 6, (R() - 0.5) * 0.9);
  const base = 2.2 + R() * 1.2;
  g.userData.tick = (t) => {
    g.userData.dy = base + Math.sin(t * 0.5) * 0.04;
    const on = Math.sin(t * 23 + seed) > -0.2 && Math.sin(t * 3.1 + seed) > -0.7;
    mat.color.setScalar(on ? 1.6 : 0.2);
  };
  return g;
}

// the sign over a stairwell's door
const signTex = new Map();
export function buildSign(text, down = true) {
  const key = text + down;
  if (!signTex.has(key)) {
    signTex.set(key, pixelCanvas(64, 20, (x) => {
      x.fillStyle = '#123d22'; x.fillRect(0, 0, 64, 20);
      x.fillStyle = '#0a2414'; x.fillRect(0, 19, 64, 1);
      x.fillStyle = '#cfe8d0'; x.fillRect(1, 1, 62, 1); x.fillRect(1, 18, 62, 1); x.fillRect(1, 1, 1, 18); x.fillRect(62, 1, 1, 18);
      const tw = textWidth(text);
      pixelText(x, text, 5, 7, '#e8f4e0');
      // an arrow, down or up
      const ax = 5 + tw + 6;
      for (let i = 0; i < 5; i++) {
        const yy = down ? 6 + i : 13 - i, half = down ? 4 - i : i;
        x.fillRect(ax + 4 - half, yy, half * 2 + 1, 1);
      }
      x.fillRect(ax + 3, down ? 3 : 13, 3, 4);
    }));
  }
  const tex = signTex.get(key);
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), new THREE.MeshBasicMaterial({ map: tex, color: 0xc8c8c8 }));
  face.position.z = 0.035;
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.46, 0.06), new THREE.MeshBasicMaterial({ color: 0x2a2a28 }));
  g.add(box, face);
  return g;
}

export function disposeGlitch(o) {
  o.traverse((c) => {
    if (c.isMesh) {
      c.geometry !== fragGeo && c.geometry.dispose();
      if (c.material && c.material.map !== checker && !Array.from(signTex.values()).includes(c.material.map)) c.material.dispose();
    }
  });
  if (o.userData.dispose) o.userData.dispose();
}
export { mul3 };
