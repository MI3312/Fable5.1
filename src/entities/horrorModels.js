// Models for the things in the fog. Signed distance fields, voxelised (see sdfModel.js).
import * as THREE from 'three';
import { SKY_GLSL, applyCurvature } from '../core/shaderlib.js';
import { voxelUniforms } from '../world/voxelMaterial.js';
import { sdfMesh, voxelLitMaterial, sphere, ellipsoid, capsule, box, torus, smin, noise3, fbm3 } from './sdfModel.js';

const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
function group(parent, x, y, z) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

// ------------------------------------------------------------------------------------------
// The Hollow: pale, too tall, too thin. It crawls when it thinks you are not looking.
const PALE = [0.8, 0.78, 0.74];
// faintly self-lit, so it shows as a pale shape in the dark
let hollowMat = null;
const HM = () => hollowMat || (hollowMat = applyCurvature(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: new THREE.Color(0.1, 0.1, 0.095) })));
const paleSkin = (p) => shade(PALE, 0.82 + fbm3(p[0] * 9, p[1] * 9, p[2] * 9, 2) * 0.3);

export function buildHollow() {
  const root = new THREE.Group();
  const body = group(root, 0, 1.45, 0);
  body.add(sdfMesh('hollow-torso', {
    min: [-0.3, -0.12, -0.24], max: [0.3, 1.24, 0.24], step: 0.028,
    sdf: (p) => {
      let d = capsule(p, 0, 0, 0.02, 0, 1.08, 0.04, 0.1, 0.15);
      d = smin(d, capsule(p, -0.22, 1.02, 0.03, 0.22, 1.02, 0.03, 0.055), 0.06);
      // ribs pressing through the skin
      for (let i = 0; i < 5; i++) {
        const y = 0.5 + i * 0.1;
        d = smin(d, torus([p[0], p[1] - y, (p[2] - 0.03) * 1.3], 0, 0, 0, 0.12 - i * 0.004, 0.018), 0.02);
      }
      // spine
      for (let i = 0; i < 9; i++) d = smin(d, sphere(p, 0, 0.1 + i * 0.11, 0.15, 0.03), 0.02);
      return d;
    },
    color: (p) => (p[1] > 0.45 && p[1] < 1.0 && Math.abs(p[0]) < 0.1 && p[2] < -0.06 ? shade(PALE, 0.6) : paleSkin(p)),
  }, HM()));
  const neck = group(body, 0, 1.1, 0.03);
  neck.add(sdfMesh('hollow-neck', {
    min: [-0.08, -0.04, -0.12], max: [0.08, 0.44, 0.08], step: 0.022,
    sdf: (p) => capsule(p, 0, 0, 0, 0, 0.38, -0.05, 0.045, 0.038),
    color: paleSkin,
  }, HM()));
  const head = group(neck, 0, 0.4, -0.05);
  const mouth = (p) => ellipsoid(p, 0, -0.03, -0.13, 0.065, 0.11, 0.07);
  head.add(sdfMesh('hollow-head', {
    min: [-0.16, -0.2, -0.22], max: [0.16, 0.34, 0.18], step: 0.018,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0.1, -0.02, 0.11, 0.18, 0.14);
      d = smin(d, ellipsoid(p, 0, -0.04, -0.06, 0.085, 0.12, 0.09), 0.04);
      // shallow sockets where eyes should be
      const sockets = Math.min(sphere(p, -0.045, 0.1, -0.15, 0.028), sphere(p, 0.045, 0.1, -0.15, 0.028));
      return Math.max(d, -Math.min(mouth(p), sockets));
    },
    color: (p) => {
      const m = mouth(p);
      if (m < 0.012) {
        // teeth rim, then darkness
        const rim = Math.abs(Math.atan2(p[1] + 0.03, p[0]) * 7) % 1;
        return m > 0.0 && rim < 0.5 ? [0.86, 0.84, 0.72] : [0.02, 0.0, 0.01];
      }
      if (Math.abs(Math.abs(p[0]) - 0.045) < 0.035 && Math.abs(p[1] - 0.1) < 0.035 && p[2] < -0.1) return [0.12, 0.1, 0.1];
      return paleSkin(p);
    },
  }, HM()));
  const limbs = [];
  const limb = (key, len, r0, r1, extra) => sdfMesh(key, {
    min: [-r0 - 0.03, -len - r1 - 0.04, -r0 - 0.03], max: [r0 + 0.03, r0 + 0.02, r0 + 0.03], step: 0.022,
    sdf: (p) => {
      let d = capsule(p, 0, 0, 0, 0, -len, 0, r0, r1);
      d = smin(d, sphere(p, 0, 0, 0, r0 * 1.25), 0.02);
      return extra ? Math.min(d, extra(p)) : d;
    },
    color: paleSkin,
  }, HM());
  const fingers = (p) => {
    let d = 9;
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.028;
      d = Math.min(d, capsule(p, x, -0.7, 0, x * 1.6, -1.0, -0.03 - Math.abs(i - 1.5) * 0.02, 0.014, 0.01));
    }
    return d;
  };
  for (const s of [-1, 1]) {
    const shoulder = group(body, s * 0.22, 1.02, 0.03);
    shoulder.add(limb('hollow-upperarm', 0.62, 0.045, 0.035));
    const fore = group(shoulder, 0, -0.62, 0);
    fore.add(limb('hollow-forearm', 0.7, 0.04, 0.03, fingers));
    const hip = group(body, s * 0.1, 0, 0.02);
    hip.add(limb('hollow-thigh', 0.72, 0.06, 0.045));
    const shin = group(hip, 0, -0.72, 0);
    shin.add(limb('hollow-shin', 0.7, 0.045, 0.035, (p) => ellipsoid(p, 0, -0.71, -0.06, 0.04, 0.025, 0.1)));
    limbs.push({ side: s, shoulder, fore, hip, shin });
  }
  root.userData = { body, neck, head, limbs };
  return root;
}

// ------------------------------------------------------------------------------------------
// The Choir: robed figures with smooth, featureless heads.
export function buildChoirFigure(dark) {
  const root = new THREE.Group();
  const robe = dark ? [0.07, 0.065, 0.075] : [0.86, 0.85, 0.8];
  root.add(sdfMesh('choir-robe' + (dark ? 'd' : 'w'), {
    min: [-0.55, 0, -0.55], max: [0.55, 1.95, 0.55], step: 0.05,
    sdf: (p) => {
      let d = capsule(p, 0, 0.1, 0, 0, 1.75, 0, 0.46, 0.17);
      d = smin(d, capsule(p, -0.2, 1.6, 0, 0.2, 1.6, 0, 0.1), 0.1);
      // folds
      d += Math.sin(Math.atan2(p[2], p[0]) * 9) * 0.02 * (1 - p[1] / 2);
      return Math.max(d, -p[1]);
    },
    color: (p) => shade(robe, 0.85 + fbm3(p[0] * 5, p[1] * 5, p[2] * 5, 2) * 0.3),
  }));
  const head = group(root, 0, 1.92, 0);
  head.add(sdfMesh('choir-head', {
    min: [-0.22, -0.3, -0.24], max: [0.22, 0.32, 0.24], step: 0.03,
    sdf: (p) => smin(ellipsoid(p, 0, 0.02, 0, 0.17, 0.24, 0.19), capsule(p, 0, -0.28, 0, 0, -0.1, 0, 0.07), 0.05),
    color: () => [0.93, 0.91, 0.88],
  }));
  root.userData = { head };
  return root;
}

// ------------------------------------------------------------------------------------------
// Maw: a ring of wet flesh and inward teeth that opens in the ground.
export function buildMaw() {
  const root = new THREE.Group();
  const flesh = [0.62, 0.2, 0.24];
  root.add(sdfMesh('maw-ring', {
    min: [-1.5, -1.6, -1.5], max: [1.5, 0.7, 1.5], step: 0.07,
    sdf: (p) => {
      let d = torus(p, 0, 0, 0, 1.0, 0.36 + noise3(p[0] * 3, p[1] * 3, p[2] * 3) * 0.06);
      d = smin(d, Math.max(capsule(p, 0, -1.5, 0, 0, -0.1, 0, 1.2), -capsule(p, 0, -1.6, 0, 0, 0.3, 0, 0.8)), 0.2);
      return d;
    },
    color: (p) => (Math.hypot(p[0], p[2]) < 0.85 ? [0.12, 0.02, 0.03] : shade(flesh, 0.75 + fbm3(p[0] * 4, p[1] * 4, p[2] * 4, 2) * 0.5)),
  }));
  const jaw = group(root, 0, 0, 0);
  jaw.add(sdfMesh('maw-teeth', {
    min: [-1.2, -0.3, -1.2], max: [1.2, 0.8, 1.2], step: 0.045,
    sdf: (p) => {
      let d = 9;
      for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2, r0 = 0.95, r1 = 0.45;
        d = Math.min(d, capsule(p, Math.cos(a) * r0, 0.15, Math.sin(a) * r0, Math.cos(a) * r1, 0.6, Math.sin(a) * r1, 0.09, 0.015));
      }
      return d;
    },
    color: (p) => shade([0.9, 0.86, 0.7], 0.8 + p[1] * 0.3),
  }));
  root.userData = { jaw };
  return root;
}

// ------------------------------------------------------------------------------------------
// The Walker: something enormous crossing the land on stilts, seen only as a shape in the fog.
export function silhouetteMaterial() {
  if (silhouetteMaterial.m) return silhouetteMaterial.m;
  const u = voxelUniforms;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: u.uZenith, uHorizon: u.uHorizon, uGroundCol: u.uGroundCol, uSunDir: u.uSunDir, uSunColor: u.uSunColor,
      uDaylight: u.uDaylight, uSunset: u.uSunset, uSunsetCol: u.uSunsetCol, uMistCol: u.uMistCol,
      uFogDensity: u.uFogDensity, uCurve: u.uCurve,
    },
    vertexShader: /* glsl */`
      uniform float uCurve;
      varying vec3 vWorld;
      varying float vShade;
      attribute vec3 color;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vShade = color.r;
        vec2 cd = wp.xz - cameraPosition.xz;
        wp.y -= dot(cd, cd) * uCurve;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${SKY_GLSL}
      uniform vec3 uMistCol;
      uniform float uFogDensity;
      varying vec3 vWorld;
      varying float vShade;
      void main() {
        vec3 dir = normalize(vWorld - cameraPosition);
        vec3 fog = mix(skyGradient(normalize(vec3(dir.x, max(dir.y, 0.02), dir.z))), uMistCol, 0.55);
        float d = length(vWorld - cameraPosition);
        float fd = d * uFogDensity * 0.3;
        float k = exp(-fd * fd);
        // lower parts drown in the ground mist
        k *= 0.35 + 0.65 * smoothstep(-12.0, 18.0, vWorld.y - cameraPosition.y);
        vec3 shadow = fog * mix(0.06, 0.24, vShade);
        gl_FragColor = vec4(mix(fog, shadow, clamp(0.2 + k * 0.8, 0.0, 0.95)), 1.0);
      }`,
  });
  silhouetteMaterial.m = m;
  return m;
}

const legGeo = (() => {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const c = new Float32Array(g.attributes.position.count * 3).fill(0.6);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
})();

export function buildWalker() {
  const root = new THREE.Group();
  const mat = silhouetteMaterial();
  const body = new THREE.Mesh(sdfMesh('walker-body', {
    min: [-5, -9, -8], max: [5, 4, 8], step: 0.4,
    sdf: (p) => {
      let d = ellipsoid(p, 0, 0, 0, 4, 2.8, 6.5) + fbm3(p[0] * 0.3, p[1] * 0.3, p[2] * 0.3, 2) * 0.8;
      for (let i = 0; i < 9; i++) {
        const x = Math.sin(i * 2.4) * 3, z = Math.cos(i * 1.7) * 5;
        d = smin(d, capsule(p, x, -1, z, x * 1.1, -4 - (i % 4) * 1.3, z * 1.05, 0.5, 0.15), 0.8);
      }
      return d;
    },
    color: (p) => [0.5 + noise3(p[0] * 0.5, p[1] * 0.5, p[2] * 0.5) * 0.3, 0, 0],
  }).geometry, mat);
  root.add(body);
  const neck = group(root, 0, 0.5, -5.5);
  const head = new THREE.Mesh(sdfMesh('walker-head', {
    min: [-2.4, -13, -14], max: [2.4, 2, 1.5], step: 0.35,
    sdf: (p) => {
      let d = capsule(p, 0, 0, 0, 0, -3, -4.5, 1.1, 0.8);
      d = smin(d, capsule(p, 0, -3, -4.5, 0, -8.5, -8.5, 0.8, 0.6), 0.6);
      d = smin(d, ellipsoid(p, 0, -10.2, -10, 1.3, 2.1, 1.7), 0.6);
      return d;
    },
    color: () => [0.7, 0, 0],
  }).geometry, mat);
  neck.add(head);
  // a row of dim lights where a face should be
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xffe6c0, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const lg = new THREE.SphereGeometry(0.28, 6, 4);
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(lg, lightMat);
    l.position.set((i - 2) * 0.45, -10.2 + Math.abs(i - 2) * 0.25, -11.6);
    neck.add(l);
  }
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const thigh = new THREE.Mesh(legGeo, mat);
    const shin = new THREE.Mesh(legGeo, mat);
    thigh.scale.set(0.7, 1, 0.7);
    shin.scale.set(0.5, 1, 0.5);
    thigh.frustumCulled = false; shin.frustumCulled = false;
    legs.push({ thigh, shin });
  }
  body.frustumCulled = false; head.frustumCulled = false;
  root.userData = { body, neck, head, legs, lightMat };
  return root;
}

// place a unit-height leg box between two points
const _Y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
export function placeSegment(mesh, a, b) {
  _d.subVectors(b, a);
  const len = _d.length();
  mesh.position.copy(a);
  mesh.quaternion.setFromUnitVectors(_Y, _d.multiplyScalar(1 / (len || 1)));
  mesh.scale.y = len;
}

// ------------------------------------------------------------------------------------------
// Eyes in the dark: two small lights, blinking.
let eyeGeo = null, haloGeo = null, haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}
let grinTex = null;
function grinTexture() {
  if (grinTex) return grinTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0)'; x.fillRect(0, 0, 128, 32);
  // a smile far too wide, and far too many teeth
  x.fillStyle = '#ffffff';
  x.beginPath();
  x.moveTo(4, 8);
  x.quadraticCurveTo(64, 40, 124, 8);
  x.quadraticCurveTo(64, 26, 4, 8);
  x.fill();
  x.globalCompositeOperation = 'destination-out';
  x.lineWidth = 1.6;
  for (let i = 1; i < 26; i++) {
    const t = i / 26, px = 4 + t * 120;
    x.beginPath(); x.moveTo(px, 4); x.lineTo(px + (t - 0.5) * 2, 30); x.stroke();
  }
  grinTex = new THREE.CanvasTexture(c);
  return grinTex;
}
export function buildEyes(color, grin = false) {
  if (!eyeGeo) { eyeGeo = new THREE.PlaneGeometry(0.2, 0.1); haloGeo = new THREE.PlaneGeometry(0.9, 0.9); }
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const hm = new THREE.MeshBasicMaterial({ color, map: haloTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, m);
    e.position.x = s * 0.2;
    e.rotation.z = s * 0.22;
    g.add(e);
    const h = new THREE.Mesh(haloGeo, hm);
    h.position.set(s * 0.2, 0, -0.01);
    g.add(h);
  }
  if (grin) {
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshBasicMaterial({ map: grinTexture(), color: 0xfff4e8, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    gm.position.y = -0.32;
    g.add(gm);
    g.userData.grin = gm.material;
  }
  g.userData.mat = m;
  g.userData.halo = hm;
  return g;
}

export { voxelLitMaterial };
