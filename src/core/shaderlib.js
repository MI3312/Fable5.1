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
