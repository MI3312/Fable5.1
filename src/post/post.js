// Render pipeline: scene -> MSAA target -> dreamy composite (vignette, chromatic
// aberration, grain, grading, fades, damage flash, warp streaks, underwater wobble).
import * as THREE from 'three';

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.scale = 1;
    this.rt = null;
    this.uniforms = {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uVignette: { value: 0.35 },
      uCA: { value: 0.0015 },
      uGrain: { value: 0.035 },
      uSat: { value: 1.12 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uFade: { value: 0 },
      uFadeColor: { value: new THREE.Color(0, 0, 0) },
      uDamage: { value: 0 },
      uWarp: { value: 0 },
      uUnderwater: { value: 0 },
      uWaterColor: { value: new THREE.Color(0.2, 0.45, 0.8) },
      uDream: { value: 0 },
      uHazard: { value: 0 },
      uHazardColor: { value: new THREE.Color(1, 0.5, 0.1) },
      uVisor: { value: 0 },
      uPixel: { value: 0 },
      uDread: { value: 0 },
      uPulse: { value: 0 },
      uGlitch: { value: 0 },
      uFlash: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uTime, uVignette, uCA, uGrain, uSat, uFade, uDamage, uWarp, uUnderwater, uDream, uHazard, uVisor, uPixel;
        uniform float uDread, uPulse, uGlitch, uFlash;
        uniform vec2 uRes;
        uniform vec3 uTint, uFadeColor, uWaterColor, uHazardColor;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 sampleCA(vec2 uv, float amt) {
          vec2 d = (uv - 0.5) * amt;
          return vec3(texture2D(tDiffuse, uv - d).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + d).b);
        }
        void main() {
          vec2 uv = vUv;
          if (uUnderwater > 0.0) {
            uv.x += sin(uv.y * 20.0 + uTime * 2.0) * 0.004 * uUnderwater;
            uv.y += cos(uv.x * 18.0 + uTime * 1.7) * 0.003 * uUnderwater;
          }
          // something is wrong with the picture: torn scanlines and jitter
          if (uGlitch > 0.0) {
            float band = floor(uv.y * 38.0 + floor(uTime * 17.0) * 7.0);
            float tear = step(1.0 - uGlitch * 0.35, hash(vec2(band, floor(uTime * 23.0))));
            uv.x += (hash(vec2(band, uTime)) - 0.5) * 0.06 * tear * uGlitch;
            uv.y += (hash(vec2(floor(uTime * 31.0), 3.0)) - 0.5) * 0.004 * uGlitch;
          }
          // dread breathes at the edge of vision
          if (uDread > 0.0) {
            vec2 cc = uv - 0.5;
            uv = 0.5 + cc * (1.0 - uDread * 0.012 * (0.5 + 0.5 * sin(uTime * 0.9)));
          }
          vec2 c = uv - 0.5;
          float r = length(c);
          float ca = uCA * (1.0 + r * 2.0) + uWarp * 0.02 + uDamage * 0.01 + uDread * 0.0025 * r + uGlitch * 0.012;
          vec3 col = sampleCA(uv, ca);
          if (uWarp > 0.0) {
            vec3 acc = col;
            for (int i = 1; i < 10; i++) {
              float k = float(i) / 10.0;
              acc += sampleCA(0.5 + c * (1.0 - k * 0.22 * uWarp), ca);
            }
            col = mix(col, acc / 10.0, clamp(uWarp, 0.0, 1.0));
            col += vec3(0.6, 0.5, 1.0) * uWarp * 0.25 * smoothstep(0.2, 0.9, r);
          }
          // grading: dread drains the colour out of the world
          float l = dot(col, vec3(0.299, 0.587, 0.114));
          col = mix(vec3(l), col, uSat * (1.0 - uDread * 0.55));
          col = mix(col, col * vec3(0.92, 0.96, 1.04), uDread * 0.6);
          col *= uTint;
          if (uDream > 0.0) {
            col += vec3(0.05, 0.0, 0.07) * uDream * (0.5 + 0.5 * sin(uTime * 0.3 + uv.x * 3.0));
            col = mix(col, col * vec3(1.05, 0.97, 1.08), uDream * 0.5);
          }
          if (uUnderwater > 0.0) {
            col = mix(col, col * uWaterColor * 1.6 + uWaterColor * 0.12, 0.65 * uUnderwater);
          }
          if (uVisor > 0.0) {
            float scan = 0.5 + 0.5 * sin(uv.y * uRes.y * 0.8 + uTime * 6.0);
            col = mix(col, vec3(dot(col, vec3(0.3, 0.55, 0.15))) * vec3(0.55, 1.0, 1.1), 0.55 * uVisor);
            col += vec3(0.0, 0.05, 0.06) * scan * uVisor;
          }
          // hazard / damage vignette
          float edge = smoothstep(0.3, 0.75, r);
          col = mix(col, uHazardColor, edge * uHazard * 0.45);
          col = mix(col, vec3(0.9, 0.05, 0.08), edge * uDamage * 0.7);
          // vignette, tightening with dread and throbbing with the heart
          float vig = uVignette + uDread * 0.45 + uPulse * 0.12;
          col *= 1.0 - clamp(vig, 0.0, 0.95) * smoothstep(0.35 - uDread * 0.15, 0.85, r + uPulse * 0.03);
          // grain
          float g = hash(uv * uRes + fract(uTime * 7.13) * 100.0) - 0.5;
          col += g * (uGrain + uDread * 0.06 + uGlitch * 0.12);
          if (uGlitch > 0.0) col *= 1.0 - 0.25 * uGlitch * step(0.5, fract(uv.y * uRes.y * 0.25 + uTime * 40.0));
          col = mix(col, vec3(1.0), clamp(uFlash, 0.0, 1.0));
          col = mix(col, uFadeColor, clamp(uFade, 0.0, 1.0));
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  resize(w, h, pixelRatio) {
    const s = this.scale;
    const rw = Math.max(1, Math.floor(w * pixelRatio * s));
    const rh = Math.max(1, Math.floor(h * pixelRatio * s));
    if (this.rt) this.rt.dispose();
    this.rt = new THREE.WebGLRenderTarget(rw, rh, {
      samples: s >= 0.99 ? 4 : 0,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    const filter = s < 0.99 ? THREE.NearestFilter : THREE.LinearFilter;
    this.rt.texture.minFilter = filter;
    this.rt.texture.magFilter = filter;
    this.uniforms.tDiffuse.value = this.rt.texture;
    this.uniforms.uRes.value.set(rw, rh);
  }

  // passes: [{scene, camera, clearDepth}]
  render(passes) {
    const r = this.renderer;
    r.setRenderTarget(this.rt);
    r.clear(true, true, true);
    for (const p of passes) {
      if (p.clearDepth) r.clearDepth();
      r.render(p.scene, p.camera);
    }
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
