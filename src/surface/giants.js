// Horizon giants: colossal shapes standing in the haze at the edge of the world.
// They are drawn just after the sky, travel with the camera and so can never be reached.
// Shapes are signed distance fields voxelised into blocky silhouettes.
import * as THREE from 'three';
import { SKY_GLSL } from '../core/shaderlib.js';
import { voxelUniforms } from '../world/voxelMaterial.js';
import { RNG, hash32 } from '../core/rng.js';
import { voxelize, capsule, ellipsoid, sphere, box, torus, smin, noise3 } from '../entities/sdfModel.js';

const WHITE = () => [1, 1, 1];

const SHAPES = {
  // a Preta the size of a mountain
  preta: {
    min: [-0.5, 0, -0.32], max: [0.5, 3.4, 0.3], step: 0.055, height: 3.3,
    sdf: (p) => {
      let d = capsule(p, 0, 1.7, 0, 0, 2.7, 0.03, 0.12, 0.19);
      d = smin(d, capsule(p, -0.25, 2.7, 0.02, 0.25, 2.7, 0.02, 0.075), 0.08);
      d = smin(d, capsule(p, 0, 2.75, 0.02, 0, 3.02, -0.07, 0.05), 0.05);
      d = smin(d, ellipsoid(p, 0, 3.16, -0.08, 0.12, 0.19, 0.13), 0.05);
      for (const s of [-1, 1]) {
        d = smin(d, capsule(p, s * 0.28, 2.7, 0.02, s * 0.33, 1.45, -0.02, 0.06, 0.045), 0.04);
        d = smin(d, ellipsoid(p, s * 0.34, 1.26, -0.03, 0.05, 0.2, 0.07), 0.04);
        d = Math.min(d, capsule(p, s * 0.1, 1.7, 0, s * 0.1, 0.04, 0, 0.085, 0.055));
      }
      return d;
    },
  },
  // a hand reaching up out of the ground
  hand: {
    min: [-1.3, -0.2, -0.55], max: [1.3, 3.9, 0.6], step: 0.08, height: 3.8,
    sdf: (p) => {
      let d = capsule(p, 0, -0.2, 0, 0, 0.9, 0, 0.34, 0.3);
      d = smin(d, ellipsoid(p, 0, 1.35, 0, 0.5, 0.62, 0.2), 0.2);
      const fingers = [[-0.33, 2.55, 0.12], [-0.11, 2.95, 0.02], [0.11, 3.1, 0.0], [0.32, 2.75, 0.08]];
      for (const [x, top, z] of fingers) {
        const mid = 1.9 + (top - 1.9) * 0.55;
        d = smin(d, capsule(p, x, 1.8, 0, x * 1.1, mid, z * 0.5, 0.11, 0.1), 0.05);
        d = smin(d, capsule(p, x * 1.1, mid, z * 0.5, x * 1.18, top, z + 0.15, 0.1, 0.085), 0.04);
      }
      d = smin(d, capsule(p, 0.45, 1.05, 0, 0.95, 1.75, 0.1, 0.13, 0.1), 0.08);
      return d;
    },
  },
  // a needle with a ring and a moon on top
  spire: {
    min: [-1.1, 0, -1.1], max: [1.1, 8.1, 1.1], step: 0.085, height: 8,
    sdf: (p) => {
      let d = capsule(p, 0, 0, 0, 0, 7.0, 0, 0.38, 0.06);
      d = Math.min(d, sphere(p, 0, 7.45, 0, 0.5));
      d = Math.min(d, torus(p, 0, 5.1, 0, 0.9, 0.07));
      return d;
    },
  },
  // a lollipop tree, perfectly round
  tree: {
    min: [-1.7, 0, -1.7], max: [1.7, 6.6, 1.7], step: 0.1, height: 6.4,
    sdf: (p) => Math.min(capsule(p, 0, 0, 0, 0, 4.2, 0, 0.14, 0.1), sphere(p, 0, 5.0, 0, 1.3) + noise3(p[0] * 2, p[1] * 2, p[2] * 2) * 0.12),
  },
  // a floating cube with a doorway
  cube: {
    min: [-1.15, 1.8, -1.15], max: [1.15, 4.2, 1.15], step: 0.09, height: 4.2,
    sdf: (p) => Math.max(box(p, 0, 3, 0, 1, 1, 1, 0.04), -box(p, 0, 2.55, -1, 0.28, 0.55, 0.3)),
  },
  // a kodama head the size of a hill, half buried
  kodama: {
    min: [-1.4, -0.2, -1.4], max: [1.4, 2.3, 1.4], step: 0.08, height: 2.2,
    sdf: (p) => {
      const d = ellipsoid(p, 0, 0.9, 0, 1.2, 1.3, 1.1);
      const holes = Math.min(sphere(p, -0.45, 1.25, -1.05, 0.28), sphere(p, 0.45, 1.25, -1.05, 0.28), ellipsoid(p, 0, 0.6, -1.05, 0.26, 0.15, 0.3));
      return Math.max(d, -holes);
    },
  },
};

const geoCache = new Map();
function shapeGeo(kind) {
  if (!geoCache.has(kind)) {
    const S = SHAPES[kind];
    geoCache.set(kind, voxelize({ sdf: S.sdf, color: WHITE, min: S.min, max: S.max, step: S.step }));
  }
  return geoCache.get(kind);
}

export class Giants {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uniforms = {
      uZenith: voxelUniforms.uZenith, uHorizon: voxelUniforms.uHorizon, uGroundCol: voxelUniforms.uGroundCol,
      uSunDir: voxelUniforms.uSunDir, uSunColor: voxelUniforms.uSunColor, uDaylight: voxelUniforms.uDaylight,
      uSunset: voxelUniforms.uSunset, uSunsetCol: voxelUniforms.uSunsetCol, uMistCol: voxelUniforms.uMistCol,
      uSkyFog: { value: 0 }, uAlpha: { value: 0.3 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute vec3 color;
        varying vec3 vWorld;
        varying float vShade;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vShade = color.r;
          gl_Position = projectionMatrix * viewMatrix * wp;
          gl_Position.z = gl_Position.w * 0.99998;
        }`,
      fragmentShader: /* glsl */`
        ${SKY_GLSL}
        uniform vec3 uMistCol;
        uniform float uSkyFog;
        uniform float uAlpha;
        varying vec3 vWorld;
        varying float vShade;
        void main() {
          vec3 dir = normalize(vWorld - cameraPosition);
          vec3 sky = skyGradient(dir);
          float hz = 1.0 - smoothstep(-0.1, 0.55, dir.y);
          sky = mix(sky, mix(sky, uMistCol, 0.8), uSkyFog * hz);
          // the lower it is, the deeper in the ground mist it stands
          float k = uAlpha * (0.4 + 0.6 * smoothstep(-0.02, 0.28, dir.y));
          vec3 shadow = sky * mix(0.28, 0.62, vShade);
          gl_FragColor = vec4(mix(sky, shadow, k), 1.0);
        }`,
      depthWrite: false,
      depthTest: false,
    });
    this.items = [];
  }

  setPlanet(planet) {
    for (const m of this.items) this.group.remove(m);
    this.items = [];
    const P = planet.params;
    if (P.interior) return;
    const rng = new RNG(hash32(planet.seed, 4242));
    const b = planet.biome;
    const zones = P.zones ? P.zones.map((z) => z[0]) : [];
    let n = 0;
    if (b === 'liminal') n = rng.int(2, 3);
    else if (b === 'exotic' || b === 'dead') n = rng.int(1, 2);
    else if (zones.length && rng.chance(0.3)) n = 1;
    const kinds = zones.includes('naraka') ? ['preta', 'hand', 'preta', 'spire'] : b === 'liminal' ? ['tree', 'cube', 'kodama', 'preta', 'spire', 'hand'] : ['spire', 'cube', 'preta', 'tree'];
    let az = rng.range(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const kind = rng.pick(kinds);
      const S = SHAPES[kind];
      const dist = rng.range(760, 900);
      const elev = rng.range(0.24, 0.42); // apparent height in radians
      const scale = Math.tan(elev) * dist / S.height;
      const m = new THREE.Mesh(shapeGeo(kind), this.material);
      m.frustumCulled = false;
      m.renderOrder = -9;
      m.position.set(Math.sin(az) * dist, -dist * 0.035, Math.cos(az) * dist);
      m.rotation.y = Math.atan2(-m.position.x, -m.position.z) + Math.PI + rng.range(-0.3, 0.3);
      m.scale.setScalar(scale);
      this.group.add(m);
      this.items.push(m);
      az += rng.range(1.2, 2.6);
    }
    this.baseAlpha = b === 'liminal' ? 0.42 : 0.32;
  }

  update(camera, skyFog, daylight) {
    this.group.position.copy(camera.position);
    this.uniforms.uSkyFog.value = skyFog;
    this.uniforms.uAlpha.value = (this.baseAlpha || 0.3) * (0.55 + 0.45 * daylight);
  }
}
