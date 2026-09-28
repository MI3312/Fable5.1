// Directional sun shadows for the voxel world.
// A 2048² depth map rendered from an orthographic camera that follows the player along the sun
// direction, snapped to whole texels so edges don't crawl as you move. Two caster passes: solid
// geometry (terrain, creatures, the ship), then foliage alpha-tested against the atlas so grass
// and leaves cast their real shapes. Receivers sample it with a rotated Poisson PCF kernel.
import * as THREE from 'three';
import { voxelUniforms, WIND_GLSL } from './voxelMaterial.js';

export const LAYER_SOLID = 1;
export const LAYER_CUTOUT = 2;

const _v = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const BIAS = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);

export function castShadows(obj, on = true) {
  obj.traverse((o) => { if (o.isMesh) { if (on) o.layers.enable(LAYER_SOLID); else o.layers.disable(LAYER_SOLID); } });
}

export class SunShadows {
  constructor(renderer) {
    this.renderer = renderer;
    this.size = 2048;
    this.extent = 70;
    this.depth = 520;
    this.rt = new THREE.WebGLRenderTarget(this.size, this.size, { depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(this.size, this.size);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.rt.texture.generateMipmaps = false;
    const E = this.extent;
    this.cam = new THREE.OrthographicCamera(-E, E, E, -E, 1, this.depth);
    this.solidMat = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide });
    this.cutoutMat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: voxelUniforms.uAtlas, uTime: voxelUniforms.uTime, uWindDir: voxelUniforms.uWindDir, uWindK: voxelUniforms.uWindK },
      vertexShader: /* glsl */`
        attribute vec3 uvl;
        attribute float sway;
        uniform float uTime;
        varying vec3 vUvl;
        ${WIND_GLSL}
        void main() {
          vUvl = uvl;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          wp.xyz += windOffset(wp.xyz, sway);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        precision highp sampler2DArray;
        uniform sampler2DArray uAtlas;
        varying vec3 vUvl;
        void main() { if (texture(uAtlas, vUvl).a < 0.5) discard; gl_FragColor = vec4(1.0); }`,
      side: THREE.DoubleSide,
    });
    this.frame = 0;
    this.fade = 0;
    // far cascade: covers the whole view distance at a coarser resolution, refreshed less often
    this.size2 = 1536;
    this.extent2 = 150;
    this.rt2 = new THREE.WebGLRenderTarget(this.size2, this.size2, { depthBuffer: true });
    this.rt2.depthTexture = new THREE.DepthTexture(this.size2, this.size2);
    this.rt2.depthTexture.type = THREE.UnsignedIntType;
    this.rt2.texture.generateMipmaps = false;
    this.cam2 = new THREE.OrthographicCamera(-this.extent2, this.extent2, this.extent2, -this.extent2, 1, this.depth);
    const U = voxelUniforms;
    U.uShadowMap2.value = this.rt2.depthTexture;
    U.uShadowTexel2.value = 1 / this.size2;
    U.uShadowDepth2.value = 1 / (this.depth - 1);
    U.uShadowMap.value = this.rt.depthTexture;
    U.uShadowTexel.value = 1 / this.size;
    U.uShadowDepth.value = 1 / (this.depth - 1);
  }

  // enabled: outdoors in daylight. quality: 0 off, 1 every other frame, 2 every frame
  update(scene, center, sunDir, enabled, quality, dt) {
    const U = voxelUniforms;
    const want = enabled && quality > 0 && sunDir.y > 0.02 ? 1 : 0;
    this.fade += (want - this.fade) * Math.min(1, dt * 3);
    U.uShadowOn.value = this.fade * Math.min(1, sunDir.y / 0.12);
    if (U.uShadowOn.value < 0.01) { U.uShadowOn.value = 0; U.uShadowOn2.value = 0; return; }
    this.frame++;
    U.uShadowTaps.value = quality >= 2 ? 8 : 6;
    // the far cascade, every third frame (Ultra) or every sixth (High)
    if (this.frame % (quality >= 2 ? 3 : 6) === 0) {
      this._render(scene, this.cam2, this.rt2, center, sunDir, this.extent2, this.size2, false);
      U.uShadowMatrix2.value.copy(BIAS).multiply(this.cam2.projectionMatrix).multiply(this.cam2.matrixWorldInverse);
      U.uShadowOn2.value = 1;
    }
    if (quality < 2 && (this.frame & 1)) return;
    this._render(scene, this.cam, this.rt, center, sunDir, this.extent, this.size, true);
    U.uShadowMatrix.value.copy(BIAS).multiply(this.cam.projectionMatrix).multiply(this.cam.matrixWorldInverse);
  }

  _render(scene, cam, rt, center, sunDir, E, size, cutouts) {
    cam.position.copy(center).addScaledVector(sunDir, this.depth * 0.5);
    cam.up.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.98) cam.up.set(1, 0, 0);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    // snap the centre to whole shadow texels in light space
    const texel = (2 * E) / size;
    _v.copy(center).applyMatrix4(cam.matrixWorldInverse);
    const sx = Math.round(_v.x / texel) * texel - _v.x, sy = Math.round(_v.y / texel) * texel - _v.y;
    _r.setFromMatrixColumn(cam.matrixWorld, 0);
    _u.setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(_r, -sx).addScaledVector(_u, -sy);
    cam.updateMatrixWorld();
    const r = this.renderer;
    const prevOverride = scene.overrideMaterial;
    r.setRenderTarget(rt);
    r.clear(true, true, true);
    scene.overrideMaterial = this.solidMat;
    cam.layers.set(LAYER_SOLID);
    r.render(scene, cam);
    if (cutouts) {
      scene.overrideMaterial = this.cutoutMat;
      cam.layers.set(LAYER_CUTOUT);
      r.render(scene, cam);
    }
    scene.overrideMaterial = prevOverride;
    r.setRenderTarget(null);
  }
}
