// Lighting for modelled props inside the pockets. Their colours carry baked face shading and
// corner occlusion (vertex colours); this lights them the way the voxel shader lights blocks:
// the room's ambient, the fluorescent/lamp level of the air they stand in, lamps and lanterns
// nearby (the same point lights the blocks use), your headlamp, and the same thick fog.
//
// How lit the air is comes from the instance colour (batched and instanced meshes, .r = level,
// .g = how much the piece glows by itself) or from the material's uArt uniform (single meshes).
import * as THREE from 'three';
import { voxelUniforms, MAX_POINT_LIGHTS } from '../world/voxelMaterial.js';

// the glowing parts of props (lamp glass, bulbs) dim with the power; one knob for all of them
export const propGlowK = { value: 1 };
const SHARED = ['uAmbient', 'uArtificial', 'uTorch', 'uTorchOn', 'uTorchDir', 'uPL', 'uPLCol', 'uPLStrength',
  'uFogDensity', 'uFogNear', 'uFogFar', 'uCaveCol'];

function patch(mat, art) {
  mat.userData.uArt = { value: new THREE.Vector2(art, 0) };
  mat.onBeforeCompile = (sh) => {
    for (const k of SHARED) sh.uniforms[k] = voxelUniforms[k];
    sh.uniforms.uArt = mat.userData.uArt;
    sh.uniforms.uGlowK = propGlowK;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPW;\nvarying vec2 vArtK;\nuniform vec2 uArt;')
      .replace('#include <color_vertex>', `
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
          vColor = vec4( 1.0 );
        #endif
        #ifdef USE_COLOR
          vColor.rgb *= color;
        #endif
        vArtK = uArt;
        #ifdef USE_INSTANCING_COLOR
          vArtK = instanceColor.rg;
        #endif
        #ifdef USE_BATCHING_COLOR
          vArtK = getBatchingColor( getIndirectIndex( gl_DrawID ) ).rg;
        #endif`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 pw4 = vec4( transformed, 1.0 );
        #ifdef USE_BATCHING
          pw4 = batchingMatrix * pw4;
        #endif
        #ifdef USE_INSTANCING
          pw4 = instanceMatrix * pw4;
        #endif
        vPW = ( modelMatrix * pw4 ).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPW;
        varying vec2 vArtK;
        uniform vec3 uAmbient;
        uniform vec3 uArtificial;
        uniform vec3 uTorch;
        uniform float uTorchOn;
        uniform vec3 uTorchDir;
        uniform vec3 uPL[${MAX_POINT_LIGHTS}];
        uniform vec3 uPLCol[${MAX_POINT_LIGHTS}];
        uniform float uPLStrength;
        uniform float uFogDensity;
        uniform float uFogNear;
        uniform float uFogFar;
        uniform vec3 uCaveCol;
        uniform float uGlowK;
        vec3 propGlow;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 lc = uAmbient + uArtificial * vArtK.x;
          vec3 tv = vPW - uTorch;
          float td = length(tv);
          float cone = smoothstep(0.8, 0.94, dot(tv / max(td, 0.001), uTorchDir));
          lc += vec3(1.0, 0.93, 0.82) * uTorchOn * (cone * pow(clamp(1.0 - td / 38.0, 0.0, 1.0), 1.3) * 1.7 + pow(clamp(1.0 - td / 6.0, 0.0, 1.0), 2.0) * 0.45);
          propGlow = vec3(0.0);
          for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
            float d = distance(vPW, uPL[i]);
            float a = clamp(1.0 - d / 10.0, 0.0, 1.0);
            a *= a;
            lc += uPLCol[i] * a * uPLStrength * 1.3;
            propGlow += uPLCol[i] * a * a;
          }
          vec3 over = max(lc - 1.0, 0.0);
          lc = min(lc, vec3(1.0)) + over / (1.0 + over * 2.5);
          diffuseColor.rgb *= mix(lc, vec3(uGlowK), vArtK.y);
        }`)
      .replace('#include <fog_fragment>', `{
          float pd = distance(vPW, cameraPosition);
          float fd = pd * uFogDensity;
          float f = max(1.0 - exp(-fd * fd), smoothstep(uFogNear, uFogFar, length(vPW.xz - cameraPosition.xz)));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uCaveCol + propGlow * uPLStrength * 0.7, clamp(f, 0.0, 1.0));
        }`);
  };
  mat.customProgramCacheKey = () => 'propLit';
  return mat;
}

// A lit material for props. Batched/instanced meshes take their light level per instance.
export function propLitMaterial(art = 0.5, opts = {}) {
  return patch(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, ...opts }), art);
}
// set how lit the air around a single-mesh prop is (0 dark .. 1 under the lights), and how much it glows
export function setPropArt(mat, art, glow = 0) { mat.userData.uArt.value.set(art, glow); }
