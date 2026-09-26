// Shared GLSL snippets: planetary curvature and sky gradient (so fog matches the sky exactly).
import { CURVATURE } from '../config.js';

export const curvatureUniforms = {
  uCurve: { value: CURVATURE },
};

export const SKY_GLSL = /* glsl */`
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGroundCol;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uDaylight;
uniform float uSunset;
uniform vec3 uSunsetCol;
vec3 skyGradient(vec3 dir) {
  float h = dir.y;
  float t = pow(clamp(h, 0.0, 1.0), 0.55);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uGroundCol, smoothstep(0.0, -0.25, h));
  float sd = max(dot(dir, uSunDir), 0.0);
  col += uSunColor * pow(sd, 6.0) * 0.35 * (0.3 + 0.7 * uDaylight);
  // sunset / sunrise glow hugging the horizon around the sun
  float band = 1.0 - smoothstep(0.0, 0.45, abs(h));
  col = mix(col, uSunsetCol, uSunset * band * (0.25 + 0.75 * pow(sd, 3.0)) * 0.85);
  return col;
}
`;

// Atmosphere: exponential-squared haze + analytic height mist with drifting noise banks,
// fully fogged at the chunk-streaming edge, glowing halos around lights.
export const FOG_GLSL = /* glsl */`
uniform float uTime;
uniform float uFogNear;
uniform float uFogFar;
uniform float uFogDensity;
uniform float uMistBase;
uniform float uMistFalloff;
uniform float uMistDensity;
uniform vec3 uMistCol;
uniform float uEnclosed;
uniform vec3 uCaveCol;
float fogHash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float fogNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(fogHash(i), fogHash(i + vec3(1,0,0)), f.x), mix(fogHash(i + vec3(0,1,0)), fogHash(i + vec3(1,1,0)), f.x), f.y);
  float b = mix(mix(fogHash(i + vec3(0,0,1)), fogHash(i + vec3(1,0,1)), f.x), mix(fogHash(i + vec3(0,1,1)), fogHash(i + vec3(1,1,1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fogAmount(vec3 wpos, float distH, float dist3, out float mistPart) {
  float fd = dist3 * uFogDensity;
  float haze = 1.0 - exp(-fd * fd);
  float camY = cameraPosition.y;
  float h0 = (camY - uMistBase) / uMistFalloff;
  float k = (wpos.y - camY) / uMistFalloff;
  float integ = abs(k) > 0.001 ? exp(-h0) * (1.0 - exp(-k)) / k : exp(-h0);
  integ = min(integ, 30.0);
  float drift = fogNoise(wpos * 0.03 + vec3(uTime * 0.04, uTime * 0.01, uTime * 0.025)) * 0.9 + 0.55;
  float mist = 1.0 - exp(-dist3 * uMistDensity * integ * drift);
  float edge = smoothstep(uFogNear, uFogFar, distH);
  mistPart = mist;
  return clamp(max(max(haze, edge), mist), 0.0, 1.0);
}
vec3 applyFog(vec3 col, vec3 wpos, vec3 viewDir, float distH, float dist3, vec3 glow) {
  float mistPart;
  float f = fogAmount(wpos, distH, dist3, mistPart);
  vec3 fogDir = normalize(vec3(viewDir.x, max(viewDir.y, 0.02), viewDir.z));
  vec3 fogCol = mix(skyGradient(fogDir), uMistCol, clamp(mistPart / max(f, 0.001), 0.0, 1.0) * 0.75);
  // forward scattering: the mist lights up looking toward the sun
  float sunScat = pow(max(dot(viewDir, uSunDir), 0.0), 5.0) * uDaylight;
  fogCol += uSunColor * sunScat * 0.35 * clamp(mistPart / max(f, 0.001), 0.0, 1.0);
  fogCol = mix(fogCol, uCaveCol, uEnclosed);
  fogCol += glow * 0.7;
  return mix(col, fogCol, f);
}
`;

// Inject world-bending into any built-in three.js material
export function applyCurvature(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCurve = curvatureUniforms.uCurve;
    shader.vertexShader = 'uniform float uCurve;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 wPos = modelMatrix * mvPosition;
      vec2 cd = wPos.xz - cameraPosition.xz;
      wPos.y -= dot(cd, cd) * uCurve;
      mvPosition = viewMatrix * wPos;
      gl_Position = projectionMatrix * mvPosition;`,
    );
  };
  material.customProgramCacheKey = () => 'curved';
  return material;
}
