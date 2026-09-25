// Shader materials for voxel chunks: texture-array atlas, planet tints, baked AO,
// sky light + emissive, headlamp, sky-matched fog and fake planetary curvature.
import * as THREE from 'three';
import { SKY_GLSL, curvatureUniforms } from '../core/shaderlib.js';

export const voxelUniforms = {
  uAtlas: { value: null },
  uTime: { value: 0 },
  uAmbient: { value: new THREE.Color(0.2, 0.2, 0.25) },
  uSkyLight: { value: new THREE.Color(1, 1, 1) },
  uFogNear: { value: 40 },
  uFogFar: { value: 120 },
  uTorch: { value: new THREE.Vector3() },
  uTorchOn: { value: 0 },
  uZenith: { value: new THREE.Color(0.3, 0.5, 0.9) },
  uHorizon: { value: new THREE.Color(0.7, 0.8, 1.0) },
  uGroundCol: { value: new THREE.Color(0.2, 0.2, 0.2) },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uDaylight: { value: 1 },
  uCurve: curvatureUniforms.uCurve,
};

const vert = /* glsl */`
attribute vec3 uvl;
attribute vec3 tint;
attribute vec3 light;
uniform float uCurve;
uniform float uTime;
uniform float uWave;
varying vec3 vUvl;
varying vec3 vTint;
varying vec3 vLight;
varying vec3 vWorld;
varying float vDist;
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
  vDist = length(mv.xyz);
  vUvl = uvl;
  vTint = tint;
  vLight = light;
}
`;

const frag = /* glsl */`
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uTime;
uniform vec3 uAmbient;
uniform vec3 uSkyLight;
uniform float uFogNear;
uniform float uFogFar;
uniform vec3 uTorch;
uniform float uTorchOn;
uniform float uAlpha;
uniform float uLiquid;
${SKY_GLSL}
varying vec3 vUvl;
varying vec3 vTint;
varying vec3 vLight;
varying vec3 vWorld;
varying float vDist;
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
  vec3 lightCol = uAmbient + uSkyLight * sky;
  float td = distance(vWorld, uTorch);
  lightCol += vec3(1.0, 0.92, 0.8) * uTorchOn * pow(clamp(1.0 - td / 20.0, 0.0, 1.0), 1.5) * 1.2;
  vec3 col = base * lightCol * ao;
  col = mix(col, base * (0.85 + 0.25 * ao), emit);
  vec3 viewDir = normalize(vWorld - cameraPosition);
  float alpha = uAlpha;
  if (uLiquid > 0.0) {
    vec3 r = reflect(viewDir, vec3(0.0, 1.0, 0.0));
    float spec = pow(max(dot(r, uSunDir), 0.0), 80.0) * uDaylight;
    col += uSunColor * spec * 1.5;
    float fres = pow(1.0 - abs(viewDir.y), 3.0);
    col = mix(col, skyGradient(r), fres * 0.35 * (1.0 - emit));
    alpha = mix(uAlpha + fres * 0.2, 1.0, emit);
  }
  vec3 fogDir = normalize(vec3(viewDir.x, max(viewDir.y, 0.02), viewDir.z));
  vec3 fogCol = skyGradient(fogDir);
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  col = mix(col, fogCol, fog);
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
