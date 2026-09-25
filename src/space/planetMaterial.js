// Planet rendering from orbit: voxel-quantised noise continents, oceans, ice caps,
// sun lighting with soft terminator and an additive atmosphere shell.
import * as THREE from 'three';
import { B } from '../world/blocks.js';

export const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * snoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
`;

function tint(P, i) { return new THREE.Color(P.tints[i * 3], P.tints[i * 3 + 1], P.tints[i * 3 + 2]); }

export function createPlanetMaterial(planet) {
  const P = planet.params;
  const hasLiquid = !!P.liquid;
  const liquidCol = P.liquid === B.LAVA ? new THREE.Color(1.0, 0.4, 0.1) : P.liquid === B.ACID ? new THREE.Color(0.5, 1.0, 0.2) : P.liquid === B.DREAM_WATER ? new THREE.Color(1.0, 0.65, 0.88) : tint(P, 5);
  const land = tint(P, 1);
  if (P.surface.top === B.SAND) land.copy(tint(P, 6));
  if (P.surface.top === B.SNOW_GRASS || P.surface.top === B.SNOW) land.setRGB(0.92, 0.95, 1.0);
  if (P.surface.top === B.ASH) land.setRGB(0.4, 0.36, 0.36);
  if (P.surface.top === B.GRAVEL) land.copy(tint(P, 3)).multiplyScalar(1.05);
  const high = tint(P, 3);
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uSeed: { value: (planet.seed % 1000) / 10 },
    uLand: { value: land },
    uLand2: { value: tint(P, 2) },
    uHigh: { value: high },
    uSand: { value: tint(P, 6) },
    uWater: { value: liquidCol },
    uHasWater: { value: hasLiquid ? 1 : 0 },
    uWaterLevel: { value: hasLiquid ? (P.biome === 'lush' ? 0.02 : -0.05) : -9 },
    uIce: { value: P.biome === 'frozen' ? 0.35 : P.biome === 'lush' || P.biome === 'liminal' ? 0.82 : 0.95 },
    uEmissiveWater: { value: P.liquid === B.LAVA ? 1 : 0 },
    uQuant: { value: 72 },
    uAtmo: { value: new THREE.Color(...P.sky.horizon) },
    uCraters: { value: P.terrain.craters ? 1 : 0 },
    uDream: { value: P.sky.dream || 0 },
    uTime: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vObj;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      void main() {
        vObj = normalize(position);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uLand, uLand2, uHigh, uSand, uWater, uAtmo;
      uniform float uSeed, uHasWater, uWaterLevel, uIce, uEmissiveWater, uQuant, uCraters, uDream, uTime;
      varying vec3 vObj;
      varying vec3 vNormalW;
      varying vec3 vWorld;
      ${NOISE_GLSL}
      void main() {
        vec3 p = normalize(floor(vObj * uQuant) / uQuant + 0.5 / uQuant);
        float h = fbm(p * 2.2 + uSeed);
        float detail = snoise(p * 18.0 + uSeed) * 0.08;
        float lat = abs(p.y);
        vec3 col;
        bool water = uHasWater > 0.5 && h < uWaterLevel;
        if (water) {
          col = uWater * (0.75 + 0.25 * smoothstep(uWaterLevel - 0.4, uWaterLevel, h));
        } else {
          float t = smoothstep(uWaterLevel, 0.55, h + detail);
          col = mix(uLand, uLand2, smoothstep(0.1, 0.3, snoise(p * 5.0 + uSeed * 2.0) * 0.5 + 0.5) * 0.5);
          col = mix(col, uHigh, smoothstep(0.25, 0.6, t));
          if (uHasWater > 0.5) col = mix(uSand, col, smoothstep(uWaterLevel, uWaterLevel + 0.04, h));
          if (uCraters > 0.5) {
            float cr = snoise(p * 9.0 + uSeed);
            col *= 0.8 + 0.25 * smoothstep(0.4, 0.6, abs(cr));
          }
        }
        float ice = smoothstep(uIce, uIce + 0.04, lat + detail * 0.5 + h * 0.1);
        col = mix(col, vec3(0.93, 0.96, 1.0), ice);
        if (uDream > 0.0) col = mix(col, col * vec3(1.1, 0.95, 1.12) + 0.05 * sin(p * 10.0 + uTime * 0.2), uDream * 0.3);
        vec3 n = normalize(vNormalW);
        float diff = dot(n, uSunDir);
        float lit = smoothstep(-0.15, 0.35, diff);
        vec3 lighting = vec3(0.04) + vec3(1.0, 0.97, 0.92) * lit * 1.05;
        vec3 outc = col * lighting;
        if (water) {
          vec3 v = normalize(cameraPosition - vWorld);
          vec3 r = reflect(-uSunDir, n);
          outc += pow(max(dot(r, v), 0.0), 30.0) * 0.5 * lit;
          if (uEmissiveWater > 0.5) outc = mix(outc, uWater * 1.2, 0.6);
        }
        // atmospheric rim tint
        vec3 v = normalize(cameraPosition - vWorld);
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        outc += uAtmo * rim * 0.6 * (0.2 + lit);
        gl_FragColor = vec4(outc, 1.0);
      }`,
  });
  return mat;
}

export function createAtmosphereMaterial(planet) {
  const P = planet.params;
  const col = new THREE.Color(...P.sky.horizon).lerp(new THREE.Color(...P.sky.zenith), 0.4);
  const strength = P.biome === 'dead' ? 0.15 : 1.0;
  return new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uCol: { value: col }, uStrength: { value: strength } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uCol; uniform float uStrength;
      varying vec3 vN; varying vec3 vW;
      void main() {
        vec3 v = normalize(cameraPosition - vW);
        vec3 n = normalize(vN);
        float fres = 1.0 - abs(dot(n, v));
        float a = pow(fres, 2.2);
        float lit = smoothstep(-0.4, 0.6, dot(-n, uSunDir) * -1.0 + 0.0);
        lit = smoothstep(-0.3, 0.5, dot(n, uSunDir));
        gl_FragColor = vec4(uCol * (0.25 + lit * 1.2), a * uStrength * (0.3 + lit));
      }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

export function createRingMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(...color) }, uSeed: { value: Math.random() * 10 } },
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vPos;
      void main() { vUv = uv; vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; uniform float uSeed;
      varying vec2 vUv; varying vec3 vPos;
      void main() {
        float r = length(vPos.xy);
        float band = 0.5 + 0.5 * sin(r * 0.02 + uSeed) * sin(r * 0.071 + uSeed * 2.0);
        float a = smoothstep(0.2, 0.8, band) * 0.55;
        gl_FragColor = vec4(uCol * (0.6 + band * 0.5), a);
      }`,
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
  });
}
