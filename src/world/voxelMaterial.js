// Shader materials for voxel chunks: texture-array atlas, planet tints, baked AO,
// sky light + artificial (liminal) light + emissive, dynamic point lights, headlamp,
// dense sky-matched exponential fog with drifting ground mist, and fake planetary curvature.
import * as THREE from 'three';
import { SKY_GLSL, FOG_GLSL, curvatureUniforms } from '../core/shaderlib.js';

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
};

const vert = /* glsl */`
attribute vec3 uvl;
attribute vec3 tint;
attribute vec4 light;
uniform float uCurve;
uniform float uTime;
uniform float uWave;
varying vec3 vUvl;
varying vec3 vTint;
varying vec4 vLight;
varying vec3 vWorld;
varying float vDist;
varying float vDist3;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  if (uWave > 0.0) {
    wp.y += (sin(wp.x * 0.7 + uTime * 1.6) * sin(wp.z * 0.6 + uTime * 1.3)) * 0.05 * uWave;
  }
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
${SKY_GLSL}
${FOG_GLSL}
varying vec3 vUvl;
varying vec3 vTint;
varying vec4 vLight;
varying vec3 vWorld;
varying float vDist;
varying float vDist3;
void main() {
  vec3 uvl = vUvl;
  if (uLiquid > 0.0) uvl.xy += vec2(uTime * 0.04, uTime * 0.025);
  vec4 tex = texture(uAtlas, uvl);
  if (tex.a < 0.3) discard;
  float mask = smoothstep(0.82, 0.96, tex.a);
  vec3 base = tex.rgb * mix(vec3(1.0), vTint, mask);
  float ao = vLight.r;
  float sky = vLight.g;
  float emit = vLight.b;
  float art = vLight.a;
  vec3 viewDir = normalize(vWorld - cameraPosition);
  // true face normal from screen-space derivatives, turned to face the eye (plants are two-sided)
  vec3 fn = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  fn = faceforward(fn, viewDir, fn);
  // the sun rakes across faces that turn toward it; the far sides fall into shade
  float ndl = dot(fn, uSunDir);
  float sunTerm = mix(1.0, 0.7 + 0.55 * max(ndl, 0.0) - 0.08 * max(-ndl, 0.0), uDaylight * 0.9);
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
  vec3 col = base * lightCol * ao;
  col = mix(col, base * (0.85 + 0.25 * ao), emit);
  float alpha = uAlpha;
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
    vec3 h = normalize(uSunDir - viewDir);
    float nh = max(dot(n, h), 0.0);
    float spec = (pow(nh, 260.0) * 4.0 + pow(nh, 30.0) * 0.1) * uDaylight;
    col = mix(col, refl, clamp(fres * 1.15, 0.0, 0.88) * (1.0 - emit));
    col += uSunColor * spec * (1.0 - emit);
    alpha = mix(clamp(uAlpha + fres * 0.4, 0.0, 0.97), 1.0, emit);
  }
  col = applyFog(col, vWorld, viewDir, vDist, vDist3, plGlow * uPLStrength);
  gl_FragColor = vec4(col, alpha);
}
`;

export function createVoxelMaterials(atlas) {
  voxelUniforms.uAtlas.value = atlas;
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
