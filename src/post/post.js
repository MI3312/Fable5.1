// Render pipeline, all on the GPU:
//   world -> HDR MSAA target (+ depth)
//   -> SSAO from the depth buffer (normals reconstructed per pixel, rotated hemisphere kernel,
//      depth-aware blur + upsample) multiplied into the world before the viewmodel is drawn
//   -> HDR bloom (soft-knee bright pass, 6-level mip chain, tent-filtered upsample)
//   -> composite: depth-masked god rays, filmic shoulder, grading, vignette, chromatic
//      aberration, grain, fades, damage flash, warp streaks, underwater wobble, dread.
import * as THREE from 'three';

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Screen-space ambient occlusion. r = occlusion, g = open sky (for light shafts).
const SSAO_FRAG = /* glsl */`
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform mat4 uProj, uInvProj;
  uniform float uRadius, uPower, uFadeNear, uFadeFar;
  varying vec2 vUv;
  #ifndef SAMPLES
  #define SAMPLES 12
  #endif
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return p.xyz / p.w;
  }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    if (d >= 0.99999) { gl_FragColor = vec4(1.0, 1.0, 0.0, 1.0); return; }
    vec3 P = viewPos(vUv);
    vec2 px = 1.0 / uRes;
    vec3 pr = viewPos(vUv + vec2(px.x, 0.0)), pl = viewPos(vUv - vec2(px.x, 0.0));
    vec3 pu = viewPos(vUv + vec2(0.0, px.y)), pd = viewPos(vUv - vec2(0.0, px.y));
    // take the flatter side so silhouettes don't smear
    vec3 dx = abs(pr.z - P.z) < abs(pl.z - P.z) ? pr - P : P - pl;
    vec3 dy = abs(pu.z - P.z) < abs(pd.z - P.z) ? pu - P : P - pd;
    vec3 N = normalize(cross(dx, dy));
    vec3 T = normalize(cross(abs(N.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), N));
    vec3 B = cross(N, T);
    float rot = hash(gl_FragCoord.xy) * 6.2831853;
    float radius = uRadius * clamp(-P.z * 0.08, 0.6, 2.2);
    float occ = 0.0;
    for (int i = 0; i < SAMPLES; i++) {
      float fi = (float(i) + 0.5) / float(SAMPLES);
      float z = sqrt(fi);
      float r = sqrt(1.0 - z * z);
      float a = float(i) * 2.39996323 + rot;
      vec3 h = vec3(cos(a) * r, sin(a) * r, z);
      float sc = mix(0.15, 1.0, fi * fi);
      vec3 S = P + (T * h.x + B * h.y + N * h.z) * radius * sc;
      vec4 clip = uProj * vec4(S, 1.0);
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      vec3 Q = viewPos(suv);
      float range = smoothstep(0.0, 1.0, radius / max(abs(P.z - Q.z), 1e-3));
      occ += step(S.z + 0.04, Q.z) * range;
    }
    float ao = 1.0 - occ / float(SAMPLES);
    float fade = 1.0 - smoothstep(uFadeNear, uFadeFar, -P.z);
    gl_FragColor = vec4(mix(1.0, pow(clamp(ao, 0.0, 1.0), uPower), fade), 0.0, 0.0, 1.0);
  }`;

// separable, depth-aware blur of the AO (sky mask rides along untouched-ish)
const BLUR_FRAG = /* glsl */`
  uniform sampler2D tAO, tDepth;
  uniform vec2 uDir;
  uniform float uNear, uFar;
  varying vec2 vUv;
  float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
  void main() {
    float d0 = lin(texture2D(tDepth, vUv).x);
    vec2 c = texture2D(tAO, vUv).rg;
    float sum = c.r, wsum = 1.0, sky = c.g;
    for (int i = -3; i <= 3; i++) {
      if (i == 0) continue;
      vec2 uv = vUv + uDir * float(i);
      float di = lin(texture2D(tDepth, uv).x);
      float w = exp(-float(i * i) / 8.0) * (1.0 - smoothstep(0.02, 0.12, abs(di - d0) / d0));
      vec2 s = texture2D(tAO, uv).rg;
      sum += s.r * w; wsum += w;
      sky += s.g;
    }
    gl_FragColor = vec4(sum / wsum, sky / 7.0, 0.0, 1.0);
  }`;

// multiply the AO into the lit world
const APPLY_FRAG = /* glsl */`
  uniform sampler2D tAO;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    float ao = texture2D(tAO, vUv).r;
    gl_FragColor = vec4(vec3(mix(1.0, ao, uStrength)), 1.0);
  }`;

// bloom: soft-knee bright pass (+ 13-tap downsample to kill fireflies)
const BRIGHT_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uThreshold, uKnee;
  varying vec2 vUv;
  vec3 prefilter(vec3 c) {
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    rq = rq * rq / (4.0 * uKnee + 1e-4);
    return c * max(rq, br - uThreshold) / max(br, 1e-4);
  }
  void main() {
    vec2 t = uTexel;
    vec3 a = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
    vec3 b = texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
    vec3 c = texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
    vec3 d = texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
    vec3 e = texture2D(tSrc, vUv).rgb;
    vec3 col = e * 0.5 + (a + b + c + d) * 0.125;
    gl_FragColor = vec4(prefilter(min(col, vec3(12.0))), 1.0);
  }`;

const DOWN_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 t = uTexel;
    vec3 c = texture2D(tSrc, vUv).rgb * 0.125;
    c += (texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb
        + texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb) * 0.125;
    c += (texture2D(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb + texture2D(tSrc, vUv + t * vec2(2.0, 0.0)).rgb
        + texture2D(tSrc, vUv + t * vec2(0.0, -2.0)).rgb + texture2D(tSrc, vUv + t * vec2(0.0, 2.0)).rgb) * 0.0625;
    c += (texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb + texture2D(tSrc, vUv + t * vec2(2.0, -2.0)).rgb
        + texture2D(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb + texture2D(tSrc, vUv + t * vec2(2.0, 2.0)).rgb) * 0.03125;
    gl_FragColor = vec4(c, 1.0);
  }`;

// 9-tap tent upsample, added onto the finer level
const UP_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  uniform float uScatter;
  varying vec2 vUv;
  void main() {
    vec2 t = uTexel;
    vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
    c += (texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(t.x, 0.0)).rgb
        + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
    c += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb
       + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
    gl_FragColor = vec4(c / 16.0 * uScatter, 1.0);
  }`;

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
      uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
      uRays: { value: 0 },
      uRayCol: { value: new THREE.Color(1, 0.95, 0.85) },
      tBloom: { value: null },
      uBloom: { value: 0 },
      tMask: { value: null },
      uHasMask: { value: 0 },
      uFilmic: { value: 1 },
      tDepth: { value: null },
      uNear: { value: 0.1 },
      uFar: { value: 1000 },
      uDof: { value: 0 },
      uFocus: { value: 12 },
      uAperture: { value: 0 },
      uFilter: { value: 0 },
    };
    this.quality = 2;
    this.levels = [];
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uTime, uVignette, uCA, uGrain, uSat, uFade, uDamage, uWarp, uUnderwater, uDream, uHazard, uVisor, uPixel;
        uniform float uDread, uPulse, uGlitch, uFlash, uRays, uBloom, uHasMask, uFilmic;
        uniform sampler2D tBloom, tMask, tDepth;
        uniform float uNear, uFar, uDof, uFocus, uAperture, uFilter;
        float linDepth(vec2 p) { float z = texture2D(tDepth, p).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float coc(float d) { return clamp(abs(d - uFocus) / max(d, 0.01) * uAperture, 0.0, 1.0); }
        uniform vec2 uSunPos;
        uniform vec3 uRayCol;
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
          // depth of field: golden-angle disc gather sized by the circle of confusion
          if (uDof > 0.5) {
            float d0 = linDepth(uv);
            float c0 = coc(d0);
            vec3 acc = col; float wsum = 1.0;
            vec2 aspect = vec2(uRes.y / uRes.x, 1.0);
            for (int i = 0; i < 32; i++) {
              float fi = float(i) + 0.5;
              float rr = sqrt(fi / 32.0);
              float an = fi * 2.39996323;
              vec2 o = vec2(cos(an), sin(an)) * rr * 0.022 * aspect;
              float ds = linDepth(uv + o * max(c0, 0.001));
              float cs = coc(ds);
              // nearer out-of-focus samples bleed over sharp backgrounds; far ones don't smear forward
              float w = ds < d0 ? cs : min(cs, c0);
              w = smoothstep(rr - 0.1, rr + 0.1, w) + 0.001;
              acc += texture2D(tDiffuse, uv + o * max(max(c0, cs), 0.001)).rgb * w;
              wsum += w;
            }
            col = acc / wsum;
          }
          if (uWarp > 0.0) {
            vec3 acc = col;
            for (int i = 1; i < 10; i++) {
              float k = float(i) / 10.0;
              acc += sampleCA(0.5 + c * (1.0 - k * 0.22 * uWarp), ca);
            }
            col = mix(col, acc / 10.0, clamp(uWarp, 0.0, 1.0));
            col += vec3(0.6, 0.5, 1.0) * uWarp * 0.25 * smoothstep(0.2, 0.9, r);
          }
          // light shafts through the fog: march toward the sun, gathering bright sky
          if (uRays > 0.0) {
            vec2 delta = (uSunPos - uv) / 28.0;
            vec2 suv = uv;
            float acc = 0.0, w = 1.0;
            for (int i = 0; i < 28; i++) {
              suv += delta;
              vec2 cuv = clamp(suv, 0.001, 0.999);
              vec3 sc = texture2D(tDiffuse, cuv).rgb;
              // with depth we know exactly which pixels are open sky: shafts get cut by every leaf
              float lit = uHasMask > 0.5 ? texture2D(tMask, cuv).g * smoothstep(0.35, 1.0, dot(sc, vec3(0.33)))
                                         : smoothstep(0.62, 1.1, dot(sc, vec3(0.33)));
              acc += lit * w;
              w *= 0.955;
            }
            float fall = 1.0 - smoothstep(0.0, 0.9, length((uv - uSunPos) * vec2(uRes.x / uRes.y, 1.0)));
            col += uRayCol * acc / 28.0 * uRays * (0.35 + 0.65 * fall);
          }
          // HDR bloom, then a filmic shoulder so bright things roll off instead of clipping
          if (uBloom > 0.0) col += texture2D(tBloom, uv).rgb * uBloom;
          if (uFilmic > 0.0) {
            vec3 x = max(col - 0.72, 0.0);
            col = min(col, vec3(0.72)) + x / (1.0 + x * 1.15);
          }
          // photo filters
          if (uFilter > 0.5) {
            float lf = dot(col, vec3(0.299, 0.587, 0.114));
            int F = int(uFilter + 0.5);
            if (F == 1) col = vec3(smoothstep(0.05, 0.95, lf));
            else if (F == 2) { col = mix(vec3(lf), col, 1.55); col = (col - 0.5) * 1.12 + 0.5; }
            else if (F == 3) { col = mix(vec3(lf), col, 0.7) * vec3(1.04, 0.96, 1.08) + vec3(0.06, 0.03, 0.08); }
            else if (F == 4) { col = mix(col * vec3(0.85, 1.0, 1.08), col * vec3(1.12, 1.0, 0.82), smoothstep(0.2, 0.8, lf)); col = (col - 0.5) * 1.08 + 0.5; }
            else if (F == 5) { col = vec3(col.g * 0.9 + 0.1, col.b * 0.8 + col.r * 0.3, col.r); col = mix(vec3(lf), col, 1.3); }
            else if (F == 6) col = vec3(lf) * vec3(1.1, 0.92, 0.72) + vec3(0.04, 0.02, 0.0);
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

  _fs(frag, uniforms, opts = {}) {
    const m = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, ...opts });
    const mesh = new THREE.Mesh(this.quad.geometry, m);
    mesh.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(mesh);
    return { m, scene, u: uniforms };
  }

  _target(w, h, type = THREE.HalfFloatType) {
    const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type, depthBuffer: false });
    t.texture.minFilter = THREE.LinearFilter;
    t.texture.magFilter = THREE.LinearFilter;
    t.texture.generateMipmaps = false;
    return t;
  }

  _build() {
    if (this.ssao) return;
    const V2 = () => ({ value: new THREE.Vector2() });
    this.ssao = this._fs(SSAO_FRAG, {
      tDepth: { value: null }, uRes: V2(), uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() },
      uRadius: { value: 0.9 }, uPower: { value: 1.35 }, uFadeNear: { value: 26 }, uFadeFar: { value: 60 },
    });
    this.blur = this._fs(BLUR_FRAG, { tAO: { value: null }, tDepth: { value: null }, uDir: V2(), uNear: { value: 0.1 }, uFar: { value: 1000 } });
    this.apply = this._fs(APPLY_FRAG, { tAO: { value: null }, uStrength: { value: 1 } }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
      transparent: true,
    });
    this.bright = this._fs(BRIGHT_FRAG, { tSrc: { value: null }, uTexel: V2(), uThreshold: { value: 0.9 }, uKnee: { value: 0.35 } });
    this.down = this._fs(DOWN_FRAG, { tSrc: { value: null }, uTexel: V2() });
    this.up = this._fs(UP_FRAG, { tSrc: { value: null }, uTexel: V2(), uScatter: { value: 0.85 } }, {
      blending: THREE.AdditiveBlending, transparent: true,
    });
  }

  resize(w, h, pixelRatio) {
    this._build();
    const s = this.scale;
    const rw = Math.max(1, Math.floor(w * pixelRatio * s));
    const rh = Math.max(1, Math.floor(h * pixelRatio * s));
    if (this.rt) { this.rt.depthTexture?.dispose(); this.rt.dispose(); }
    this.rt = new THREE.WebGLRenderTarget(rw, rh, {
      samples: s >= 0.99 ? 4 : 0,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    this.rt.depthTexture = new THREE.DepthTexture(rw, rh);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    const filter = s < 0.99 ? THREE.NearestFilter : THREE.LinearFilter;
    this.rt.texture.minFilter = filter;
    this.rt.texture.magFilter = filter;
    this.uniforms.tDiffuse.value = this.rt.texture;
    this.uniforms.uRes.value.set(rw, rh);
    // half-resolution AO (ping-pong for the blur)
    for (const t of [this.aoA, this.aoB]) t?.dispose();
    const aw = Math.ceil(rw / 2), ah = Math.ceil(rh / 2);
    this.aoA = this._target(aw, ah, THREE.UnsignedByteType);
    this.aoB = this._target(aw, ah, THREE.UnsignedByteType);
    // bloom mip chain from half resolution down
    for (const t of this.levels) t.dispose();
    this.levels = [];
    let bw = aw, bh = ah;
    for (let i = 0; i < 6 && bw > 2 && bh > 2; i++) { this.levels.push(this._target(bw, bh)); bw = Math.ceil(bw / 2); bh = Math.ceil(bh / 2); }
    this.uniforms.tBloom.value = this.levels[0]?.texture || null;
    this.uniforms.tMask.value = this.aoA.texture;
    this.uniforms.tDepth.value = this.rt.depthTexture;
  }

  _pass(fs, target) {
    const r = this.renderer;
    r.setRenderTarget(target);
    r.render(fs.scene, this.camera);
  }

  _ambientOcclusion(camera) {
    const U = this.ssao.u, w = this.aoA.width, h = this.aoA.height;
    this.ssao.m.defines.SAMPLES = this.quality >= 2 ? 16 : 10;
    if (this.ssao.m.userData.samples !== this.ssao.m.defines.SAMPLES) { this.ssao.m.userData.samples = this.ssao.m.defines.SAMPLES; this.ssao.m.needsUpdate = true; }
    U.tDepth.value = this.rt.depthTexture;
    U.uRes.value.set(w, h);
    U.uProj.value.copy(camera.projectionMatrix);
    U.uInvProj.value.copy(camera.projectionMatrixInverse);
    this._pass(this.ssao, this.aoA);
    const B = this.blur.u;
    B.tDepth.value = this.rt.depthTexture;
    B.uNear.value = camera.near; B.uFar.value = camera.far;
    B.tAO.value = this.aoA.texture; B.uDir.value.set(1 / w, 0);
    this._pass(this.blur, this.aoB);
    B.tAO.value = this.aoB.texture; B.uDir.value.set(0, 1 / h);
    this._pass(this.blur, this.aoA);
    this.apply.u.tAO.value = this.aoA.texture;
    this._pass(this.apply, this.rt);
  }

  _bloom() {
    const L = this.levels;
    if (!L.length) return;
    this.bright.u.tSrc.value = this.rt.texture;
    this.bright.u.uTexel.value.set(1 / this.rt.width, 1 / this.rt.height);
    this._pass(this.bright, L[0]);
    for (let i = 1; i < L.length; i++) {
      this.down.u.tSrc.value = L[i - 1].texture;
      this.down.u.uTexel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height);
      this._pass(this.down, L[i]);
    }
    const r = this.renderer;
    r.autoClear = false;
    for (let i = L.length - 1; i > 0; i--) {
      this.up.u.tSrc.value = L[i].texture;
      this.up.u.uTexel.value.set(1 / L[i].width, 1 / L[i].height);
      this._pass(this.up, L[i - 1]);
    }
  }

  // passes: [{scene, camera, clearDepth}]; opts.ao=false for scenes without a sane depth range
  render(passes, opts = {}) {
    const r = this.renderer;
    const q = this.quality;
    r.setRenderTarget(this.rt);
    r.clear(true, true, true);
    let i = 0;
    for (; i < passes.length && !passes[i].clearDepth; i++) r.render(passes[i].scene, passes[i].camera);
    const useAO = q >= 1 && opts.ao !== false && passes[0] && passes[0].camera.isPerspectiveCamera;
    if (passes[0]) { this.uniforms.uNear.value = passes[0].camera.near; this.uniforms.uFar.value = passes[0].camera.far; }
    if (useAO) this._ambientOcclusion(passes[0].camera);
    this.uniforms.uHasMask.value = useAO ? 1 : 0;
    r.setRenderTarget(this.rt);
    for (; i < passes.length; i++) {
      if (passes[i].clearDepth) r.clearDepth();
      r.render(passes[i].scene, passes[i].camera);
    }
    if (q >= 1) this._bloom();
    this.uniforms.uBloom.value = q >= 1 ? (opts.bloom ?? 0.42) : 0;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
