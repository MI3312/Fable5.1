// Volumetric clouds, raymarched on the GPU.
// A tiling 3D noise texture (low-frequency Perlin-Worley shape in R, Worley detail in G) is baked
// once. Each frame a reduced-resolution pass marches every sky ray through a cloud shell that bends
// with the planet, lighting each sample by marching toward the sun (Beer-Lambert, powder, and a
// two-lobe Henyey-Greenstein phase for silver linings). The sky dome composites the result; the
// same noise throws moving cloud shadows across the terrain.
import * as THREE from 'three';
import { voxelUniforms } from '../world/voxelMaterial.js';
import { CURVATURE } from '../config.js';
import { cloudUniforms } from '../core/shaderlib.js';
export { cloudUniforms };

const N = 48;
const FREQ = 0.0028;      // world units -> noise texture coordinates for the cloud shapes
export const CLOUD_BASE = 175; // keep in step with cloudUniforms.uCloudBase
export const CLOUD_TOP = 300;

function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// periodic value noise
function vnoise(x, y, z, P, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const m = (a) => ((a % P) + P) % P;
  let r = 0;
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1;
    const h = hash3(m(xi + dx), m(yi + dy), m(zi + dz), s);
    r += h * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return r;
}

// periodic Worley (distance to the nearest jittered point), inverted to 1 at the points
function worley(x, y, z, P, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let best = 9;
  const m = (a) => ((a % P) + P) % P;
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz;
    const px = cx + hash3(m(cx), m(cy), m(cz), s), py = cy + hash3(m(cx), m(cy), m(cz), s + 1), pz = cz + hash3(m(cx), m(cy), m(cz), s + 2);
    const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
    if (d < best) best = d;
  }
  return 1 - Math.min(1, Math.sqrt(best));
}

let noiseTex = null, noiseData = null;
export function cloudNoise() {
  if (noiseTex) return noiseTex;
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const X = x / N, Y = y / N, Z = z / N;
    // shape: billowy fbm remapped by inverted Worley
    let f = 0, a = 0.5, t = 0;
    for (let o = 0; o < 4; o++) { const P = 4 << o; f += vnoise(X * P, Y * P, Z * P, P, 11 + o) * a; t += a; a *= 0.5; }
    f /= t;
    const wo = worley(X * 4, Y * 4, Z * 4, 4, 91) * 0.625 + worley(X * 8, Y * 8, Z * 8, 8, 93) * 0.375;
    const shape = Math.min(1, Math.max(0, (f - (1 - wo) * 0.55) / 0.55 + 0.3));
    // detail: finer Worley fbm
    const det = worley(X * 8, Y * 8, Z * 8, 8, 71) * 0.55 + worley(X * 16, Y * 16, Z * 16, 16, 73) * 0.3 + worley(X * 24, Y * 24, Z * 24, 24, 75) * 0.15;
    const i = (x + N * (y + N * z)) * 4;
    data[i] = shape * 255; data[i + 1] = det * 255; data[i + 2] = f * 255; data[i + 3] = 255;
  }
  noiseData = data;
  noiseTex = new THREE.Data3DTexture(data, N, N, N);
  noiseTex.format = THREE.RGBAFormat;
  noiseTex.type = THREE.UnsignedByteType;
  noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = THREE.RepeatWrapping;
  noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.unpackAlignment = 1;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

const FRAG = /* glsl */`
  precision highp sampler3D;
  uniform sampler3D uCloudNoise;
  uniform vec3 uCloudWind;
  uniform float uCloudCover, uDensity, uTime, uR, uBase, uTop, uSteps, uStorm;
  uniform vec3 uCam, uSunDir, uSunColor, uZenith, uHorizon, uCloudCol;
  uniform float uDaylight;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  // distance along the ray to leave (sign=1) / reach (sign=-1) a sphere of radius r centred at c
  vec2 sphere(vec3 ro, vec3 rd, vec3 c, float r) {
    vec3 oc = ro - c;
    float b = dot(oc, rd), q = dot(oc, oc) - r * r, h = b * b - q;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }
  float density(vec3 p, float h01, bool cheap) {
    vec3 q = p * ${FREQ} + uCloudWind;
    float s = texture(uCloudNoise, q).r;
    float cov = uCloudCover;
    float shape = smoothstep(1.0 - cov, 1.0 - cov + 0.28, s);
    // rounded bases, towering tops that thin out
    float prof = smoothstep(0.0, 0.12, h01) * (1.0 - smoothstep(0.45 + cov * 0.3, 1.0, h01));
    float d = shape * prof;
    if (d <= 0.001 || cheap) return d;
    float det = texture(uCloudNoise, p * ${FREQ * 5.5} + uCloudWind * 3.0 + vec3(0.0, uTime * 0.002, 0.0)).g;
    return clamp(d - (1.0 - det) * (0.3 + 0.25 * h01), 0.0, 1.0);
  }
  float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
  void main() {
    vec3 rd = normalize(vDir);
    vec3 ro = uCam;
    vec3 C = vec3(ro.x, -uR, ro.z);
    float rc = length(ro - C);
    float rb = uR + uBase, rt = uR + uTop;
    vec2 ib = sphere(ro, rd, C, rb), it = sphere(ro, rd, C, rt);
    float t0, t1;
    if (rc < rb) { t0 = ib.y; t1 = it.y; }
    else if (rc < rt) { t0 = 0.0; t1 = (ib.x > 0.0) ? ib.x : it.y; }
    else { if (it.x < 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } t0 = it.x; t1 = (ib.x > 0.0) ? ib.x : it.y; }
    t1 = min(t1, t0 + 2600.0);
    if (t1 <= t0 || t0 > 5200.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
    float steps = uSteps;
    float stepLen = (t1 - t0) / steps;
    float t = t0 + stepLen * hash(gl_FragCoord.xy + fract(uTime) * 17.0);
    float cosT = dot(rd, uSunDir);
    float phase = mix(hg(cosT, 0.6), hg(cosT, -0.25), 0.3) * 4.0 * 3.14159;
    vec3 sun = uSunColor * (0.15 + 0.85 * uDaylight);
    vec3 col = vec3(0.0);
    float T = 1.0;
    float ext = 0.045 * uDensity;
    float tHit = -1.0;
    for (int i = 0; i < 48; i++) {
      if (float(i) >= steps) break;
      vec3 p = ro + rd * t;
      float h01 = clamp((length(p - C) - rb) / (rt - rb), 0.0, 1.0);
      float d = density(p, h01, false);
      if (d > 0.002) {
        if (tHit < 0.0) tHit = t;
        // light: march toward the sun through the cloud
        float ld = 0.0;
        for (int j = 1; j <= 4; j++) {
          vec3 lp = p + uSunDir * (float(j) * float(j) * 9.0);
          float lh = clamp((length(lp - C) - rb) / (rt - rb), 0.0, 1.0);
          ld += density(lp, lh, j > 2) * float(j) * 9.0;
        }
        float beer = exp(-ld * ext * 0.9);
        float powder = 1.0 - exp(-d * 6.0);
        vec3 amb = mix(uHorizon, uZenith, 0.35 + h01 * 0.5) * (0.35 + 0.65 * uDaylight) * (0.55 + 0.45 * h01);
        vec3 L = sun * beer * phase * mix(1.0, powder, 0.6) * 2.4 + amb * 0.75;
        L *= uCloudCol * (1.0 - uStorm * 0.55);
        float a = 1.0 - exp(-d * stepLen * ext);
        col += T * L * a;
        T *= 1.0 - a;
        if (T < 0.015) break;
      }
      t += stepLen;
    }
    // far clouds melt into the sky
    float dist = tHit > 0.0 ? tHit : t1;
    float fade = exp(-max(dist - 400.0, 0.0) * 0.00055) * smoothstep(-0.02, 0.06, rd.y + (rc > rb ? 0.3 : 0.0));
    gl_FragColor = vec4(col * fade, mix(1.0, T, fade));
  }`;

export class VolumetricClouds {
  constructor() {
    this.uniforms = {
      ...cloudUniforms,
      uDensity: { value: 1 },
      uTime: voxelUniforms.uTime,
      uR: { value: 1 / (2 * CURVATURE) },
      uBase: { value: CLOUD_BASE },
      uTop: { value: CLOUD_TOP },
      uSteps: { value: 32 },
      uStorm: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uSunDir: voxelUniforms.uSunDir,
      uSunColor: voxelUniforms.uSunColor,
      uZenith: voxelUniforms.uZenith,
      uHorizon: voxelUniforms.uHorizon,
      uDaylight: voxelUniforms.uDaylight,
      uCloudCol: { value: new THREE.Color(1, 1, 1) },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        uniform mat4 uInvProj, uCamWorld;
        varying vec3 vDir;
        void main() {
          vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
          vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.rt = null;
    this.enabled = false;
    this.wind = new THREE.Vector3(0.9, 0, 0.35).normalize();
  }

  setPlanet(P, seed) {
    cloudUniforms.uCloudNoise.value = cloudNoise();
    this.uniforms.uCloudNoise = cloudUniforms.uCloudNoise;
    const cover = P.sky.cloudCover ?? 0.4;
    this.cover = cover;
    this.uniforms.uCloudCol.value.setRGB(...(P.sky.cloud || [1, 1, 1]));
    const a = ((seed || 0) % 628) / 100;
    this.wind.set(Math.cos(a), 0, Math.sin(a) * 0.4).normalize();
  }

  // returns the texture to composite (or null when off)
  render(renderer, camera, w, h, quality, time, storm, on) {
    this.enabled = on && quality > 0 && this.cover > 0.01;
    cloudUniforms.uCloudShadow.value = this.enabled ? 1 : 0;
    if (!this.enabled) return null;
    const div = quality >= 2 ? 2.5 : 3.5;
    const rw = Math.max(1, Math.ceil(w / div)), rh = Math.max(1, Math.ceil(h / div));
    if (!this.rt || this.rt.width !== rw || this.rt.height !== rh) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, depthBuffer: false });
      this.rt.texture.minFilter = this.rt.texture.magFilter = THREE.LinearFilter;
    }
    const U = this.uniforms;
    const cover = Math.min(0.92, this.cover + storm * 0.35) * (1 - (this.clearSky || 0) * 0.75);
    cloudUniforms.uCloudCover.value = cover;
    U.uDensity.value = 1 + storm * 1.5;
    U.uStorm.value = storm;
    U.uSteps.value = quality >= 2 ? 30 : 20;
    cloudUniforms.uCloudWind.value.copy(this.wind).multiplyScalar(time * 0.0035);
    U.uCam.value.copy(camera.position);
    U.uInvProj.value.copy(camera.projectionMatrixInverse);
    U.uCamWorld.value.copy(camera.matrixWorld);
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(null);
    return this.rt.texture;
  }

  // how deep inside a cloud a world point is (CPU side, for flying through them)
  densityAt(p) {
    if (!noiseData || !this.enabled) return 0;
    const drop = 0; // camera-relative: the shell sits at its true height right above the camera
    const h01 = (p.y - drop - CLOUD_BASE) / (CLOUD_TOP - CLOUD_BASE);
    if (h01 <= 0 || h01 >= 1) return 0;
    const W = cloudUniforms.uCloudWind.value;
    const q = (v, o) => ((Math.floor((v * FREQ + o) * N) % N) + N) % N;
    const i = (q(p.x, W.x) + N * (q(p.y, W.y) + N * q(p.z, W.z))) * 4;
    const s = noiseData[i] / 255;
    const cov = cloudUniforms.uCloudCover.value;
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    return sm(1 - cov, 1 - cov + 0.28, s) * sm(0, 0.12, h01) * sm(1, 0.45 + cov * 0.3, h01);
  }
}
