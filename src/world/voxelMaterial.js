// Shader materials for voxel chunks: texture-array atlas, planet tints, baked AO,
// sky light + artificial (liminal) light + emissive, dynamic point lights, headlamp,
// dense sky-matched exponential fog with drifting ground mist, and fake planetary curvature.
import * as THREE from 'three';
import { SKY_GLSL, FOG_GLSL, curvatureUniforms, cloudUniforms } from '../core/shaderlib.js';
import { TILE } from './blocks.js';

export const MAX_POINT_LIGHTS = 8;

export const voxelUniforms = {
  uAtlas: { value: null },
  uTime: { value: 0 },
  uAmbient: { value: new THREE.Color(0.2, 0.2, 0.25) },
  uSkyLight: { value: new THREE.Color(1, 1, 1) },
  uArtificial: { value: new THREE.Color(0.62, 0.6, 0.57) },
  uFogNear: { value: 40 },
  uFogFar: { value: 120 },
  uFogDensity: { value: 0.012 },
  uMistBase: { value: 44 },
  uMistFalloff: { value: 10 },
  uMistDensity: { value: 0.02 },
  uMistCol: { value: new THREE.Color(0.85, 0.85, 0.9) },
  uEnclosed: { value: 0 },
  uCaveCol: { value: new THREE.Color(0.05, 0.05, 0.06) },
  uTorch: { value: new THREE.Vector3() },
  uTorchOn: { value: 0 },
  uTorchDir: { value: new THREE.Vector3(0, 0, -1) },
  uZenith: { value: new THREE.Color(0.3, 0.5, 0.9) },
  uHorizon: { value: new THREE.Color(0.7, 0.8, 1.0) },
  uGroundCol: { value: new THREE.Color(0.2, 0.2, 0.2) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uDaylight: { value: 1 },
  uSunset: { value: 0 },
  uSunsetCol: { value: new THREE.Color(1, 0.5, 0.3) },
  uPL: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Vector3(0, -9999, 0)) },
  uPLCol: { value: Array.from({ length: MAX_POINT_LIGHTS }, () => new THREE.Color(0, 0, 0)) },
  uPLStrength: { value: 1 },
  uCurve: curvatureUniforms.uCurve,
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowTexel: { value: 1 / 2048 },
  uShadowTaps: { value: 8 },
  uShadowDepth: { value: 1 / 500 },
  // a second, coarser cascade that reaches the horizon
  uShadowMap2: { value: null },
  uShadowMatrix2: { value: new THREE.Matrix4() },
  uShadowOn2: { value: 0 },
  uShadowTexel2: { value: 1 / 1536 },
  uShadowDepth2: { value: 1 / 500 },
  uSeaLevel: { value: -999 },
  uPanelK: { value: 1 },
  uMood: { value: 0.8 }, // 0 = the old bright look, 1 = damp, grey and cold // ceiling panels and lamps: 1 = on, near 0 = the power's out
  uCloudNoise: cloudUniforms.uCloudNoise,
  uCloudCover: cloudUniforms.uCloudCover,
  uCloudWind: cloudUniforms.uCloudWind,
  uCloudShadow: cloudUniforms.uCloudShadow,
  uCloudBase: cloudUniforms.uCloudBase,
  uWindDir: { value: new THREE.Vector2(0.8, 0.6) },
  uWindK: { value: 1 },
  uWet: { value: 0 },
  // screen-space reflections: last frame's colour (rgb) + linear view depth (a), and its camera
  uHist: { value: null },
  uHistVP: { value: new THREE.Matrix4() },
  uSSR: { value: 0 },
  uSSRSteps: { value: 20 },
  uGloss: { value: null },
};

// how mirror-like each tile is: [reflectivity, roughness]
const GLOSS = {
  pool_tile: [0.55, 0.05], pool_deep: [0.6, 0.04], marble: [0.5, 0.06], dream_tile: [0.4, 0.08], checker: [0.42, 0.06],
  metal_plate: [0.35, 0.18], metal_panel: [0.3, 0.2], silver: [0.7, 0.04], obsidian: [0.45, 0.05], ice: [0.5, 0.05],
  onyx: [0.5, 0.05], plastic_r: [0.3, 0.1], plastic_y: [0.3, 0.1], plastic_b: [0.3, 0.1], plastic_w: [0.32, 0.1],
  concrete: [0.12, 0.3], grate: [0.18, 0.25], hull: [0.2, 0.2], tv: [0.45, 0.03], neon: [0.25, 0.08], salt: [0.18, 0.2],
  base_top: [0.3, 0.1], tele_top: [0.35, 0.08], ceiling_tile: [0.08, 0.3], light_panel: [0.2, 0.05],
  exit_door_lo: [0.28, 0.14], exit_door_hi: [0.32, 0.1], poster: [0.4, 0.02], poster_odd: [0.4, 0.02], roller: [0.22, 0.2],
  breaker: [0.25, 0.12], drain: [0.4, 0.06], exit_sign: [0.3, 0.03],
  dripstone: [0.3, 0.1], moss_top: [0.1, 0.35], wet_carpet: [0.34, 0.1], hazard: [0.14, 0.25],
};
function glossTexture() {
  const data = new Uint8Array(256 * 4);
  for (const [name, [r, g]] of Object.entries(GLOSS)) {
    const i = TILE[name];
    if (i == null) continue;
    data[i * 4] = r * 255; data[i * 4 + 1] = g * 255;
  }
  const t = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

// wind: tips of grass and flowers lean and bob, leaves shiver; gusts roll across the land
export const WIND_GLSL = /* glsl */`
uniform vec2 uWindDir;
uniform float uWindK;
vec3 windOffset(vec3 wp, float s) {
  if (s <= 0.0) return vec3(0.0);
  float ph = dot(wp.xz, vec2(0.37, 0.23)) + uTime * 1.9;
  float gust = 0.55 + 0.45 * sin(uTime * 0.37 + wp.x * 0.045 + wp.z * 0.035);
  float bend = (sin(ph) * 0.5 + 0.55 + sin(ph * 2.7 + wp.y) * 0.18) * gust * uWindK;
  vec2 off = uWindDir * bend * s * 0.24 + vec2(sin(ph * 3.1), cos(ph * 2.3)) * s * 0.03 * uWindK;
  return vec3(off.x, -dot(off, off) * 0.35 * s, off.y);
}
`;

const vert = /* glsl */`
attribute vec3 uvl;
attribute vec3 tint;
attribute vec4 light;
attribute float sway;
uniform float uCurve;
uniform float uTime;
uniform float uWave;
${WIND_GLSL}
varying vec3 vUvl;
varying vec3 vTint;
varying vec4 vLight;
varying vec3 vWorld;
varying float vDist;
varying float vDist3;
varying vec2 vSlow;
// the slow noise that damps the walls and drifts the mist varies over blocks, not pixels:
// worked out at the corners of each face and blended across it
float vHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(vHash(i), vHash(i + vec3(1,0,0)), f.x), mix(vHash(i + vec3(0,1,0)), vHash(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(vHash(i + vec3(0,0,1)), vHash(i + vec3(1,0,1)), f.x), mix(vHash(i + vec3(0,1,1)), vHash(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vSlow = vec2(vNoise(wp.xyz * 0.085 + vec3(3.1, 7.7, 1.3)) * 0.72 + vNoise(wp.xyz * 0.42 + vec3(11.7, 2.9, 5.3)) * 0.36,
               vNoise(wp.xyz * 0.03 + vec3(uTime * 0.04, uTime * 0.01, uTime * 0.025)) * 0.9 + 0.55);
  if (uWave > 0.0) {
    wp.y += (sin(wp.x * 0.7 + uTime * 1.6) * sin(wp.z * 0.6 + uTime * 1.3)) * 0.05 * uWave;
  }
  wp.xyz += windOffset(wp.xyz, sway);
  vec2 cd = wp.xz - cameraPosition.xz;
  wp.y -= dot(cd, cd) * uCurve;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  vDist = length(cd);
  vDist3 = length(mv.xyz);
  vUvl = uvl;
  vTint = tint;
  vLight = light;
}
`;

const frag = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform vec3 uAmbient;
uniform vec3 uSkyLight;
uniform vec3 uArtificial;
uniform vec3 uTorch;
uniform float uTorchOn;
uniform vec3 uTorchDir;
uniform float uAlpha;
uniform float uLiquid;
uniform vec3 uPL[${MAX_POINT_LIGHTS}];
uniform vec3 uPLCol[${MAX_POINT_LIGHTS}];
uniform float uPLStrength;
precision highp sampler3D;
uniform sampler3D uCloudNoise;
uniform float uCloudCover, uCloudShadow, uCloudBase;
uniform vec3 uCloudWind;
uniform float uWet;
uniform sampler2D uHist;
uniform mat4 uHistVP;
uniform float uSSR, uSSRSteps, uCurve;
uniform sampler2D uGloss;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn, uShadowTexel, uShadowDepth, uShadowTaps;
uniform sampler2D uShadowMap2;
uniform mat4 uShadowMatrix2;
uniform float uShadowOn2, uShadowTexel2, uShadowDepth2, uSeaLevel, uPanelK, uMood;
const vec2 POISSON[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
// the far cascade: coarser, a few taps, fading out at its own edge
float farShadow(vec3 wp, vec3 n, float ndl) {
  if (uShadowOn2 <= 0.0) return 1.0;
  vec4 sc = uShadowMatrix2 * vec4(wp + n * 0.3, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return 1.0;
  float bias = (0.12 + 0.5 * (1.0 - clamp(ndl, 0.0, 1.0))) * uShadowDepth2;
  float sum = 0.0;
  for (int i = 0; i < 5; i++) sum += step(c.z - bias, texture(uShadowMap2, c.xy + POISSON[i] * uShadowTexel2 * 1.4).x);
  vec2 e = abs(c.xy - 0.5) * 2.0;
  return mix(mix(sum / 5.0, 1.0, smoothstep(0.85, 1.0, max(e.x, e.y))), 1.0, 1.0 - uShadowOn2);
}
// soft sun shadow: normal-offset lookup, slope-scaled bias, rotated Poisson PCF, handing over to the
// far cascade at its edge
float sunShadow(vec3 wp, vec3 n, float ndl) {
  if (uShadowOn <= 0.0) return 1.0;
  vec4 sc = uShadowMatrix * vec4(wp + n * 0.07, 1.0);
  vec3 c = sc.xyz / sc.w;
  if (c.x <= 0.0 || c.x >= 1.0 || c.y <= 0.0 || c.y >= 1.0 || c.z >= 1.0) return mix(1.0, farShadow(wp, n, ndl), uShadowOn);
  float bias = (0.06 + 0.22 * (1.0 - clamp(ndl, 0.0, 1.0))) * uShadowDepth;
  float a = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  float sum = 0.0, taps = 0.0;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uShadowTaps) break;
    vec2 o = R * POISSON[i] * uShadowTexel * 1.8;
    sum += step(c.z - bias, texture(uShadowMap, c.xy + o).x);
    taps += 1.0;
  }
  vec2 e = abs(c.xy - 0.5) * 2.0;
  float edge = smoothstep(0.82, 1.0, max(e.x, e.y));
  float far = edge > 0.0 ? farShadow(wp, n, ndl) : 1.0;
  return mix(mix(sum / taps, far, edge), 1.0, 1.0 - uShadowOn);
}
// light focused by rippling water onto whatever lies beneath it
float caustics(vec2 uv, float t) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0, inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
${SKY_GLSL}
${FOG_GLSL}
// shadow of the cloud above this point, looking up along the sun
float cloudShade(vec3 wp) {
  if (uCloudShadow <= 0.0) return 1.0;
  vec3 p = wp + uSunDir / max(uSunDir.y, 0.2) * (uCloudBase + 45.0 - wp.y);
  float s = texture(uCloudNoise, p * 0.0028 + uCloudWind).r;
  float c = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.28, s);
  return 1.0 - c * 0.72 * uCloudShadow;
}
varying vec3 vUvl;
varying vec3 vTint;
varying vec4 vLight;
varying vec3 vWorld;
varying float vDist;
varying float vDist3;
varying vec2 vSlow;
// a world point as it was drawn (bent by the planet's curvature), projected into last frame
vec4 histClip(vec3 p) {
  vec2 cd = p.xz - cameraPosition.xz;
  return uHistVP * vec4(p.x, p.y - dot(cd, cd) * uCurve, p.z, 1.0);
}
// march a reflected ray through last frame's picture; rgb = what it hit, a = confidence
vec4 ssrTrace(vec3 wp, vec3 R) {
  float jit = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61.0, vec2(12.9898, 78.233))) * 43758.5453);
  float t = 0.2 + jit * 0.3, prevT = 0.0;
  for (int i = 0; i < 32; i++) {
    if (float(i) >= uSSRSteps) break;
    vec4 c = histClip(wp + R * t);
    if (c.w <= 0.05) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float dz = c.w - texture(uHist, uv).a;
    if (dz > 0.02 && dz < max(0.7, t * 0.2)) {
      float a = prevT, b = t;
      for (int j = 0; j < 5; j++) {
        float m = (a + b) * 0.5;
        vec4 qc = histClip(wp + R * m);
        if (qc.w - texture(uHist, qc.xy / qc.w * 0.5 + 0.5).a > 0.0) b = m; else a = m;
      }
      vec4 qc = histClip(wp + R * b);
      vec2 quv = qc.xy / qc.w * 0.5 + 0.5;
      vec2 e = smoothstep(vec2(0.0), vec2(0.07), quv) * smoothstep(vec2(1.0), vec2(0.93), quv);
      return vec4(texture(uHist, quv).rgb, e.x * e.y * (1.0 - float(i) / uSSRSteps * 0.6));
    }
    prevT = t;
    t = t * 1.2 + 0.1;
    if (t > 110.0) break;
  }
  return vec4(0.0);
}
void main() {
  vec3 uvl = vUvl;
  if (uLiquid > 0.0) uvl.xy += vec2(uTime * 0.04, uTime * 0.025);
  vec4 tex = texture(uAtlas, uvl);
  if (tex.a < 0.3) discard;
  float mask = smoothstep(0.82, 0.96, tex.a);
  vec3 base = tex.rgb * mix(vec3(1.0), vTint, mask);
  float ao = vLight.r;
  float sky = vLight.g;
  // light fades as it goes down through the sea
  float seaDepth = uLiquid <= 0.0 ? max(uSeaLevel - vWorld.y, 0.0) : 0.0;
  sky *= mix(0.3, 1.0, exp(-seaDepth * 0.09));
  float emit = vLight.b;
  float art = vLight.a;
  vec3 viewDir = normalize(vWorld - cameraPosition);
  // true face normal from screen-space derivatives, turned to face the eye (plants are two-sided)
  vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  fn = faceforward(fn, viewDir, fn);
  // everything is a little damp: colour sinks toward grey, and water gathers in patches, in
  // corners and in streaks down the walls, darkening and cooling whatever it soaks into
  float damp = 0.0;
  if (uLiquid <= 0.0 && uMood > 0.0) {
    float live = uMood * (1.0 - emit);
    float bl = dot(base, vec3(0.299, 0.587, 0.114));
    // planet-tinted surfaces (grass, leaves, stone) give up more of their colour
    base = mix(base, vec3(bl), live * (0.24 + 0.2 * mask));
    base *= 1.0 - live * mask * 0.1;
    damp = smoothstep(0.38, 0.8, vSlow.x) + (1.0 - ao) * 0.7;
    if (abs(fn.y) < 0.5) {
      // drip streaks: long in y, narrow across the face
      float st = fogNoise(vec3((vWorld.x + vWorld.z) * 2.6, vWorld.y * 0.32, 4.2));
      damp += smoothstep(0.58, 0.92, st) * 0.4;
    } else if (fn.y < -0.5) damp += 0.25; // undersides stay wet
    damp = clamp(damp, 0.0, 1.0) * live;
    base *= 1.0 - damp * 0.38;
    base = mix(base, base * vec3(0.84, 0.95, 0.88), damp * 0.6);
  }
  // the sun rakes across faces that turn toward it; the far sides fall into shade
  float ndl = dot(fn, uSunDir);
  float direct = max(ndl, 0.0);
  if (direct > 0.0 && sky > 0.05) direct *= sunShadow(vWorld, fn, ndl) * cloudShade(vWorld);
  float sunTerm = mix(1.0, 0.64 + 0.62 * direct - 0.08 * max(-ndl, 0.0), uDaylight * 0.9);
  vec3 lightCol = uAmbient + uSkyLight * sky * sunTerm + uArtificial * art;
  // headlamp: a beam where you look, a little spill around you
  vec3 tv = vWorld - uTorch;
  float td = length(tv);
  float cone = smoothstep(0.8, 0.94, dot(tv / max(td, 0.001), uTorchDir));
  float beam = cone * pow(clamp(1.0 - td / 38.0, 0.0, 1.0), 1.3) * 1.7;
  float spill = pow(clamp(1.0 - td / 6.0, 0.0, 1.0), 2.0) * 0.45;
  lightCol += vec3(1.0, 0.93, 0.82) * uTorchOn * (beam + spill);
  vec3 plGlow = vec3(0.0);
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    float d = distance(vWorld, uPL[i]);
    float a = clamp(1.0 - d / 10.0, 0.0, 1.0);
    a *= a;
    lightCol += uPLCol[i] * a * uPLStrength * 1.3;
    plGlow += uPLCol[i] * a * a;
  }
  // soft knee: stacked lights roll off instead of clipping to white
  vec3 over = max(lightCol - 1.0, 0.0);
  lightCol = min(lightCol, vec3(1.0)) + over / (1.0 + over * 2.5);
  // rain: soaked ground darkens, puddles gather in hollows
  float wet = uLiquid > 0.0 ? 0.0 : uWet * smoothstep(0.4, 0.9, sky) * (1.0 - emit);
  float puddle = 0.0;
  if (wet > 0.01) {
    base *= mix(1.0, 0.68, wet);
    if (fn.y > 0.5) puddle = smoothstep(0.5, 0.62, fogNoise(vec3(vWorld.x * 0.28, 1.7, vWorld.z * 0.28))) * wet;
  }
  vec3 col = base * lightCol * ao;
  // caustics dancing across the sea floor and the bottoms of pools
  bool seaFloor = seaDepth > 0.15 && sky > 0.2;
  if (uLiquid <= 0.0 && (seaFloor || int(uvl.z + 0.5) == ${TILE.pool_deep})) {
    float depthK = seaFloor ? exp(-seaDepth * 0.12) : 0.8;
    float ca = caustics(vWorld.xz * 0.16 + vec2(uTime * 0.012, 0.0), uTime * 0.55);
    col += base * ca * depthK * (0.25 * max(sky, art) + 0.75 * direct * uDaylight * sky + uArtificial.r * art * 0.8) * 2.6 * ao;
  }
  int tileId = int(uvl.z + 0.5);
  float panel = (tileId == ${TILE.light_panel} || tileId == ${TILE.lamp}) ? uPanelK : 1.0;
  col = mix(col, base * (0.85 + 0.25 * ao) * panel, emit * min(1.0, panel * 4.0 + 0.2));
  if (damp > 0.05 && fn.y > 0.5) {
    float gz = pow(1.0 - clamp(dot(-viewDir, fn), 0.0, 1.0), 4.0);
    col += skyGradient(reflect(viewDir, fn)) * gz * damp * 0.1 * sky * (0.3 + 0.7 * uDaylight);
  }
  float alpha = uAlpha;
  // polished tile, stone and metal mirror what's around them
  if (uSSR > 0.0 && uLiquid <= 0.0 && vDist3 < 90.0) {
    vec2 gl = texelFetch(uGloss, ivec2(int(uvl.z + 0.5), 0), 0).rg;
    if (gl.r > 0.01) {
      float jr = fract(sin(dot(gl_FragCoord.xy, vec2(39.3468, 11.1353))) * 24634.6345) - 0.5;
      float jr2 = fract(sin(dot(gl_FragCoord.xy, vec2(73.156, 52.235))) * 13758.5453) - 0.5;
      vec3 n = normalize(fn + vec3(jr, 0.0, jr2) * (gl.g + 0.1 * uMood) * 1.2);
      vec3 r = reflect(viewDir, n);
      float cosT = clamp(dot(-viewDir, fn), 0.0, 1.0);
      float F = gl.r * (0.22 + 0.78 * pow(1.0 - cosT, 4.0)) * (1.0 - 0.55 * uMood);
      vec4 s = ssrTrace(vWorld + fn * 0.02, r);
      col = mix(col, s.rgb * (0.85 + 0.15 * ao), F * s.a * (1.0 - smoothstep(60.0, 90.0, vDist3)));
    }
  }
  if (uLiquid > 0.0) {
    // water: a sum of travelling waves gives the surface normal; fresnel mixes in the sky
    vec3 n = vec3(0.0, 1.0, 0.0);
    if (fn.y > 0.5) {
      vec2 p = vWorld.xz;
      float t = uTime;
      vec2 g = vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 1.3 + t * 1.7) * 0.10;
      g += vec2(-0.5, 0.86) * cos(dot(p, vec2(-0.5, 0.86)) * 2.1 + t * 2.3) * 0.07;
      g += vec2(0.2, -0.98) * cos(dot(p, vec2(0.2, -0.98)) * 3.7 + t * 3.1) * 0.04;
      g += vec2(-0.9, -0.43) * cos(dot(p, vec2(-0.9, -0.43)) * 6.3 + t * 4.2) * 0.025;
      g += (vec2(fogNoise(vec3(p * 3.1, t * 0.7)), fogNoise(vec3(p.yx * 3.1 + 7.0, t * 0.7))) - 0.5) * 0.12;
      n = normalize(vec3(-g.x, 1.0, -g.y));
    } else n = fn;
    vec3 r = reflect(viewDir, n);
    float cosT = clamp(dot(-viewDir, n), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
    vec3 refl = skyGradient(normalize(vec3(r.x, max(r.y, 0.03), r.z))) * (0.55 + 0.45 * uDaylight);
    float clarity = 0.0;
    if (uSSR > 0.0) {
      // the shore, the pool walls, the trees: mirrored in the surface
      vec4 sr = ssrTrace(vWorld + n * 0.05, r);
      refl = mix(refl, sr.rgb, sr.a);
      // how much water lies between the surface and the bottom: shallow water is glass-clear
      vec4 hc = histClip(vWorld);
      float behind = texture(uHist, hc.xy / hc.w * 0.5 + 0.5).a;
      float thick = max(behind - hc.w, 0.0);
      clarity = exp(-thick * (0.2 + 0.14 * uMood)) * (1.0 - emit);
      col = mix(col * mix(vec3(0.55, 0.75, 0.95), vec3(0.4, 0.48, 0.46), uMood), col, clarity * 0.5 + 0.5);
      // a line of foam where the water meets the ground
      float foam = smoothstep(0.35, 0.0, thick) * smoothstep(0.35, 0.75, fogNoise(vec3(vWorld.xz * 2.2, uTime * 0.6)));
      col = mix(col, vec3(0.85, 0.88, 0.87) * (0.35 + 0.65 * uDaylight), foam * (0.6 - 0.2 * uMood) * (1.0 - emit));
    }
    vec3 h = normalize(uSunDir - viewDir);
    float nh = max(dot(n, h), 0.0);
    float spec = (pow(nh, 260.0) * 4.0 + pow(nh, 30.0) * 0.1) * uDaylight * (1.0 - 0.6 * uMood);
    col = mix(col, refl, clamp(fres * 1.15, 0.0, 0.88 - 0.22 * uMood) * (1.0 - emit));
    col += uSunColor * spec * (1.0 - emit);
    alpha = mix(clamp(uAlpha + fres * 0.4 - clarity * 0.5, 0.18, 0.97), 1.0, emit);
    if (abs(fn.y) < 0.5) {
      // water on its way down a cliff: pale streaks falling, breaking white here and there
      vec2 q = vec2(dot(vWorld.xz, vec2(fn.z, -fn.x)) * 2.6, vWorld.y * 0.8 + uTime * 3.4);
      float st = fogNoise(vec3(q.x, q.y, 0.5)) * 0.7 + fogNoise(vec3(q.x * 2.3, q.y * 1.9, 3.1)) * 0.3;
      float streak = smoothstep(0.5, 0.78, st);
      col = mix(col, vec3(0.84, 0.88, 0.9) * (0.3 + 0.7 * uDaylight), streak * 0.6 * (1.0 - emit));
      alpha = max(alpha, 0.5 + streak * 0.4);
    }
  }
  if (wet > 0.01 && fn.y > 0.5) {
    // raindrop rings on the wet surface, then sky and sun reflected in it
    vec2 q = vWorld.xz * 1.6;
    vec2 cell = floor(q), f = fract(q) - 0.5;
    float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
    float tt = fract(uTime * 1.2 + h);
    vec2 c0 = f - (vec2(h, fract(h * 13.1)) - 0.5) * 0.5;
    float ring = sin((length(c0) - tt * 0.55) * 42.0) * (1.0 - tt) * smoothstep(0.0, 0.08, tt) * step(length(c0), tt * 0.55 + 0.05);
    vec3 n = normalize(vec3(c0.x * ring * 0.6, 1.0, c0.y * ring * 0.6));
    vec3 r = reflect(viewDir, n);
    float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(-viewDir, n), 0.0, 1.0), 5.0);
    vec3 refl = skyGradient(normalize(vec3(r.x, max(r.y, 0.03), r.z))) * (0.35 + 0.65 * uDaylight);
    if (uSSR > 0.0 && puddle > 0.3) { vec4 sr = ssrTrace(vWorld + n * 0.02, r); refl = mix(refl, sr.rgb, sr.a); }
    float k = mix(0.35, 1.0, puddle) * wet;
    col = mix(col, refl, clamp(fres * k * 1.5, 0.0, 0.85));
    vec3 hv = normalize(uSunDir - viewDir);
    col += uSunColor * pow(max(dot(n, hv), 0.0), 140.0) * 2.0 * k * uDaylight * (1.0 - 0.6 * uMood);
  }
  col = applyFog(col, vWorld, viewDir, vDist, vDist3, plGlow * uPLStrength, vSlow.y);
  gl_FragColor = vec4(col, alpha);
}
`;

export function createVoxelMaterials(atlas) {
  voxelUniforms.uAtlas.value = atlas;
  if (!voxelUniforms.uGloss.value) voxelUniforms.uGloss.value = glossTexture();
  if (!voxelUniforms.uHist.value) {
    const t = new THREE.DataTexture(new Uint16Array([0, 0, 0, 0x7bff]), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    t.needsUpdate = true;
    voxelUniforms.uHist.value = t;
  }
  const mk = (opts, extra) => new THREE.ShaderMaterial({
    uniforms: { ...voxelUniforms, uAlpha: { value: extra.alpha }, uWave: { value: extra.wave }, uLiquid: { value: extra.liquid } },
    vertexShader: vert,
    fragmentShader: frag,
    ...opts,
  });
  const opaque = mk({ side: THREE.FrontSide }, { alpha: 1, wave: 0, liquid: 0 });
  const cutout = mk({ side: THREE.DoubleSide }, { alpha: 1, wave: 0, liquid: 0 });
  const translucent = mk({ side: THREE.DoubleSide, transparent: true, depthWrite: false }, { alpha: 0.72, wave: 1, liquid: 1 });
  return { opaque, cutout, translucent };
}
