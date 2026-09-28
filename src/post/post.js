// Render pipeline, all on the GPU:
//   world -> HDR MSAA target (+ depth)
//   -> SSAO from the depth buffer (normals reconstructed per pixel, rotated hemisphere kernel,
//      depth-aware blur + upsample) multiplied into the world before the viewmodel is drawn
//   -> HDR bloom (soft-knee bright pass, 6-level mip chain, tent-filtered upsample)
//   -> volumetric light: shadow-mapped in-scattering marched through the haze (+ headlamp beam)
//   -> composite: depth-masked god rays, filmic shoulder, grading, vignette, chromatic
//      aberration, grain, fades, damage flash, warp streaks, underwater wobble, dread.
import * as THREE from 'three';
import { voxelUniforms } from '../world/voxelMaterial.js';

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

// Volumetric light: march each view ray through the haze, sampling the sun's shadow map, so shafts
// pour through canopies and gaps; the headlamp gets a beam of its own.
const VOL_FRAG = /* glsl */`
  uniform sampler2D tDepth, uShadowMap;
  uniform mat4 uShadowMatrix, uInvProj, uCamWorld;
  uniform vec3 uCam, uSunDir, uSunColor, uTorch, uTorchDir;
  uniform float uShadowOn, uDaylight, uDensity, uMistBase, uMistFalloff, uTorchOn, uTime, uSteps, uMaxDist;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float d = texture2D(tDepth, vUv).x;
    vec4 vp = uInvProj * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    vp /= vp.w;
    vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 rd = wp - uCam;
    float dist = min(length(rd), uMaxDist);
    rd = normalize(rd);
    float steps = uSteps;
    float stepLen = dist / steps;
    float t = stepLen * hash(gl_FragCoord.xy + fract(uTime * 7.1) * 31.0);
    float cosT = dot(rd, uSunDir);
    float g = 0.55;
    float phase = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.08 + 0.02;
    vec3 sun = vec3(0.0), lamp = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < 32; i++) {
      if (float(i) >= steps) break;
      vec3 p = uCam + rd * t;
      float dens = uDensity * (0.35 + exp(-max(p.y - uMistBase, 0.0) / max(uMistFalloff, 1.0)));
      if (uShadowOn > 0.0) {
        vec4 sc = uShadowMatrix * vec4(p, 1.0);
        vec3 c = sc.xyz / sc.w;
        float lit = 1.0;
        if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) lit = step(c.z - 0.002, texture2D(uShadowMap, c.xy).x);
        sun += lit * dens * T * stepLen;
      }
      if (uTorchOn > 0.0) {
        vec3 tv = p - uTorch;
        float td = length(tv);
        float cone = smoothstep(0.86, 0.97, dot(tv / max(td, 0.001), uTorchDir)) * pow(clamp(1.0 - td / 30.0, 0.0, 1.0), 1.5);
        lamp += cone * dens * T * stepLen;
      }
      T *= exp(-dens * stepLen * 0.35);
      t += stepLen;
    }
    vec3 col = sun * uSunColor * phase * uShadowOn * (0.4 + 0.6 * uDaylight) * 0.42 + lamp * vec3(1.0, 0.93, 0.82) * uTorchOn * 0.5;
    col = col / (1.0 + col * 0.8);
    gl_FragColor = vec4(col, 1.0);
  }`;

const VOLBLUR_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
    c += (texture2D(tSrc, vUv + uDir * 1.385).rgb + texture2D(tSrc, vUv - uDir * 1.385).rgb) * 0.316;
    c += (texture2D(tSrc, vUv + uDir * 3.231).rgb + texture2D(tSrc, vUv - uDir * 3.231).rgb) * 0.070;
    gl_FragColor = vec4(c, 1.0);
  }`;

// last frame, kept for reflections: colour + linear view depth
const HIST_FRAG = /* glsl */`
  uniform sampler2D tSrc, tDepth;
  uniform float uNear, uFar;
  varying vec2 vUv;
  float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb;
    gl_FragColor = vec4(min(c, vec3(16.0)), lin(texture2D(tDepth, vUv).x));
  }`;

// eye adaptation: the average brightness of the scene (weighted to the centre), reduced to one texel
const LUM_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uCell;
  varying vec2 vUv;
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    float s = 0.0;
    for (int j = 0; j < 3; j++) for (int i = 0; i < 3; i++) {
      vec2 o = (vec2(float(i), float(j)) - 1.0) * uCell * 0.33;
      s += min(lum(texture2D(tSrc, vUv + o).rgb), 4.0);
    }
    // the middle of the screen counts for more: that's where you are looking
    float w = 1.0 + 1.5 * (1.0 - smoothstep(0.1, 0.5, length(vUv - 0.5)));
    gl_FragColor = vec4(s / 9.0 * w, w, 0.0, 1.0);
  }`;
const REDUCE_FRAG = /* glsl */`
  uniform sampler2D tSrc;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 acc = vec2(0.0);
    for (int j = 0; j < 4; j++) for (int i = 0; i < 4; i++) acc += texture2D(tSrc, vUv + (vec2(float(i), float(j)) - 1.5) * uTexel).rg;
    gl_FragColor = vec4(acc / 16.0, 0.0, 1.0);
  }`;
const ADAPT_FRAG = /* glsl */`
  uniform sampler2D tLum, tPrev;
  uniform float uDt, uKey, uMin, uMax, uUp, uDown, uReset;
  varying vec2 vUv;
  void main() {
    vec2 l = texture2D(tLum, vec2(0.5)).rg;
    float avg = l.x / max(l.y, 1e-3);
    // eyes adapt only part of the way: dark stays dark, glare is tamed
    float target = clamp(pow(uKey / max(avg, 1e-3), 0.55), uMin, uMax);
    float prev = texture2D(tPrev, vec2(0.5)).r;
    if (uReset > 0.5 || prev <= 0.0) prev = target;
    float k = 1.0 - exp(-uDt * (target > prev ? uUp : uDown));
    gl_FragColor = vec4(prev + (target - prev) * k, avg, 0.0, 1.0);
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
    this.dyn = 1;      // dynamic resolution, on top of the chosen render scale
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
      tVol: { value: null },
      uVol: { value: 0 },
      uFlare: { value: 0 },
      tExposure: { value: null },
      uAutoExp: { value: 0 },
      uMood: { value: 0.8 },
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
        uniform sampler2D tBloom, tMask, tDepth, tVol;
        uniform float uVol, uFlare, uAutoExp, uMood;
        uniform sampler2D tExposure;
        // hue-preserving highlight compression (Khronos PBR Neutral)
        vec3 neutralTone(vec3 c) {
          float x = min(c.r, min(c.g, c.b));
          float off = x < 0.08 ? x - 6.25 * x * x : 0.04;
          c -= off;
          float peak = max(c.r, max(c.g, c.b));
          const float start = 0.76;
          if (peak < start) return c + off * 0.0;
          const float d = 1.0 - start;
          float np = 1.0 - d * d / (peak + d - start);
          c *= np / peak;
          float g = 1.0 - 1.0 / (0.15 * (peak - np) + 1.0);
          return mix(c, vec3(np), g);
        }
        uniform float uNear, uFar, uDof, uFocus, uAperture, uFilter;
        float linDepth(vec2 p) { float z = texture2D(tDepth, p).x * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float coc(float d) { return clamp(abs(d - uFocus) / max(d, 0.01) * uAperture, 0.0, 1.0); }
        uniform vec2 uSunPos;
        uniform vec3 uRayCol;
        uniform vec2 uRes;
        uniform vec3 uTint, uFadeColor, uWaterColor, uHazardColor;
        varying vec2 vUv;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        vec3 rgb2hsv(vec3 c) {
          vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
          vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
          float d = q.x - min(q.w, q.y);
          return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
        }
        vec3 hsv2rgb(vec3 c) {
          vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
          return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
        }
        float bump(float x, float c, float w) { float d = (x - c) / w; return exp(-d * d); }
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
            vec2 delta = (uSunPos - uv) / 14.0;
            // half the taps, each started a random fraction along so the steps don't band
            float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            vec2 suv = uv + delta * (jit - 0.5);
            float acc = 0.0, w = 1.0;
            for (int i = 0; i < 14; i++) {
              suv += delta;
              vec2 cuv = clamp(suv, 0.001, 0.999);
              vec3 sc = texture2D(tDiffuse, cuv).rgb;
              // with depth we know exactly which pixels are open sky: shafts get cut by every leaf
              float lit = uHasMask > 0.5 ? texture2D(tMask, cuv).g * smoothstep(0.35, 1.0, dot(sc, vec3(0.33)))
                                         : smoothstep(0.62, 1.1, dot(sc, vec3(0.33)));
              acc += lit * w;
              w *= 0.912;
            }
            float fall = 1.0 - smoothstep(0.0, 0.9, length((uv - uSunPos) * vec2(uRes.x / uRes.y, 1.0)));
            col += uRayCol * acc / 14.0 * uRays * (0.35 + 0.65 * fall) * (1.0 - min(uVol, 1.0) * 0.75);
          }
          // volumetric light shafts
          if (uVol > 0.0) col += texture2D(tVol, uv).rgb * uVol;
          // lens flare: ghosts strung along the line through the sun and the centre, plus a streak
          if (uFlare > 0.0) {
            float vis = uHasMask > 0.5 ? texture2D(tMask, clamp(uSunPos, 0.001, 0.999)).g : 1.0;
            float fl = uFlare * vis;
            if (fl > 0.001) {
              vec2 asp = vec2(uRes.x / uRes.y, 1.0);
              vec2 axis = vec2(0.5) - uSunPos;
              vec3 fc = vec3(0.0);
              for (int i = 0; i < 5; i++) {
                float k = float(i);
                float pos = 0.4 + k * 0.38;
                vec2 gp = uSunPos + axis * pos * 2.0;
                float sz = 0.025 + fract(k * 0.618) * 0.06;
                float dd = length((uv - gp) * asp);
                float disc = smoothstep(sz, sz * 0.6, dd) * 0.5 + smoothstep(sz * 1.02, sz * 0.97, dd) * 0.25;
                fc += disc * mix(vec3(0.5, 0.8, 1.0), vec3(1.0, 0.6, 0.9), fract(k * 0.37)) * 0.1;
              }
              vec2 sd = (uv - uSunPos) * asp;
              fc += uRayCol * exp(-abs(sd.y) * 90.0) * exp(-abs(sd.x) * 3.0) * 0.35;
              fc += uRayCol * pow(max(0.0, 1.0 - length(sd) * 3.0), 3.0) * 0.25;
              col += fc * fl * (1.0 - 0.45 * uMood);
            }
          }
          // HDR bloom, then a filmic shoulder so bright things roll off instead of clipping
          if (uBloom > 0.0) col += texture2D(tBloom, uv).rgb * uBloom;
          // eye adaptation
          if (uAutoExp > 0.0) col *= mix(1.0, texture2D(tExposure, vec2(0.5)).r, uAutoExp);
          if (uFilmic > 0.0) col = neutralTone(max(col, 0.0));
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
          // grading. The mood: a damp, overcast film stock. Greens sink to olive and moss, pinks and
          // violets to dusty mauve, blues to slate; warm light (fire, lamps, a low sun) keeps most
          // of its colour, so it's what draws the eye. Shadows go cold, the curve gets weight, the
          // blacks lift into a soft matte. Dread drains whatever colour is left.
          float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          if (uMood > 0.0) {
            vec3 hsv = rgb2hsv(max(col, 0.0));
            float hh = hsv.x;
            float wGreen = bump(hh, 0.27, 0.13), wCyan = bump(hh, 0.54, 0.1), wViolet = bump(hh, 0.8, 0.13), wWarm = max(bump(hh, 0.05, 0.08), bump(hh, 1.05, 0.08));
            float satMul = 1.0 - uMood * (0.34 + wGreen * 0.3 + wCyan * 0.24 + wViolet * 0.4 - wWarm * 0.14);
            hsv.x = mix(hh, 0.2, wGreen * 0.28 * uMood);          // lime and emerald lean olive
            hsv.y *= clamp(satMul, 0.0, 1.2);
            hsv.y *= 1.0 - uMood * 0.25 * (smoothstep(0.55, 1.0, hsv.z) + smoothstep(0.25, 0.0, hsv.z));
            hsv.z *= 1.0 - uMood * wGreen * 0.12;
            col = hsv2rgb(hsv);
            l = dot(col, vec3(0.2126, 0.7152, 0.0722));
          }
          col = mix(vec3(l), col, uSat * mix(1.0, 0.94, uMood) * (1.0 - uDread * 0.55));
          vec3 split = mix(vec3(0.82, 0.93, 1.07), vec3(1.06, 1.0, 0.88), smoothstep(0.03, 0.72, l));
          float mid = clamp(1.0 - abs(l * 2.2 - 0.9), 0.0, 1.0);
          split *= mix(vec3(1.0), vec3(0.97, 1.01, 0.96), mid);
          col = mix(col, col * split, uMood);
          vec3 cc = clamp(col, 0.0, 1.0);
          col = mix(col, cc * cc * (3.0 - 2.0 * cc), 0.34 * uMood);
          col = mix(col, col * 0.95 + vec3(0.014, 0.019, 0.025), uMood);
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
          col += g * (uGrain + uDread * 0.06 + uGlitch * 0.12) * mix(1.0, 1.5 - l, uMood);
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
    const V = voxelUniforms;
    this.vol = this._fs(VOL_FRAG, {
      tDepth: { value: null }, uShadowMap: V.uShadowMap, uShadowMatrix: V.uShadowMatrix, uShadowOn: V.uShadowOn,
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCam: { value: new THREE.Vector3() },
      uSunDir: V.uSunDir, uSunColor: V.uSunColor, uDaylight: V.uDaylight, uTorch: V.uTorch, uTorchDir: V.uTorchDir, uTorchOn: V.uTorchOn,
      uDensity: { value: 0.02 }, uMistBase: V.uMistBase, uMistFalloff: V.uMistFalloff, uTime: V.uTime, uSteps: { value: 24 }, uMaxDist: { value: 80 },
    });
    this.volBlur = this._fs(VOLBLUR_FRAG, { tSrc: { value: null }, uDir: V2() });
    this.lumPass = this._fs(LUM_FRAG, { tSrc: { value: null }, uCell: V2() });
    this.reducePass = this._fs(REDUCE_FRAG, { tSrc: { value: null }, uTexel: V2() });
    this.adaptPass = this._fs(ADAPT_FRAG, {
      tLum: { value: null }, tPrev: { value: null }, uDt: { value: 1 / 60 }, uKey: { value: 0.72 }, uMin: { value: 0.7 }, uMax: { value: 1.3 },
      uUp: { value: 0.7 }, uDown: { value: 2.2 }, uReset: { value: 1 },
    });
    this.lumChain = [this._target(32, 32), this._target(8, 8), this._target(2, 2), this._target(1, 1)];
    this.expA = this._target(1, 1); this.expB = this._target(1, 1);
    for (const t of [...this.lumChain, this.expA, this.expB]) t.texture.minFilter = t.texture.magFilter = THREE.NearestFilter;
    this.histPass = this._fs(HIST_FRAG, { tSrc: { value: null }, tDepth: { value: null }, uNear: { value: 0.1 }, uFar: { value: 1000 } });
    this.up = this._fs(UP_FRAG, { tSrc: { value: null }, uTexel: V2(), uScatter: { value: 0.85 } }, {
      blending: THREE.AdditiveBlending, transparent: true,
    });
  }

  resize(w, h, pixelRatio, keepExposure = false) {
    this._build();
    const s = this.scale * (this.dyn || 1);
    const rw = Math.max(1, Math.floor(w * pixelRatio * s));
    const rh = Math.max(1, Math.floor(h * pixelRatio * s));
    if (this.rt) { this.rt.depthTexture?.dispose(); this.rt.dispose(); }
    // multisampling a big half-float target is a lot of memory traffic: 4x only on Ultra at
    // ordinary resolutions, 2x otherwise, none when the picture is deliberately coarse
    const px = rw * rh;
    this.rt = new THREE.WebGLRenderTarget(rw, rh, {
      samples: this.scale < 0.99 ? 0 : this.quality >= 2 && px <= 2.4e6 ? 4 : 2,
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    this.rt.depthTexture = new THREE.DepthTexture(rw, rh);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    // a chosen low render scale is meant to look pixelated; dynamic resolution isn't
    const filter = this.scale < 0.99 ? THREE.NearestFilter : THREE.LinearFilter;
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
    for (const t of [this.volA, this.volB]) t?.dispose();
    this.volA = this._target(aw, ah);
    this.volB = this._target(aw, ah);
    if (!keepExposure) this.expReset = true;
    this.hist?.dispose();
    this.hist = this._target(aw, ah);
    this.hist.texture.minFilter = this.hist.texture.magFilter = THREE.NearestFilter;
    this.histValid = false;
    this.uniforms.tVol.value = this.volA.texture;
    this.uniforms.tDepth.value = this.rt.depthTexture;
  }

  _pass(fs, target) {
    const r = this.renderer;
    r.setRenderTarget(target);
    r.render(fs.scene, this.camera);
  }

  _ambientOcclusion(camera) {
    const U = this.ssao.u, w = this.aoA.width, h = this.aoA.height;
    this.ssao.m.defines.SAMPLES = this.quality >= 2 ? 12 : 8;
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

  _volumetric(camera, strength) {
    const U = this.vol.u, w = this.volA.width, h = this.volA.height;
    U.tDepth.value = this.rt.depthTexture;
    U.uInvProj.value.copy(camera.projectionMatrixInverse);
    U.uCamWorld.value.copy(camera.matrixWorld);
    U.uCam.value.copy(camera.position);
    U.uSteps.value = this.quality >= 2 ? 16 : 10;
    // thicker air, stronger shafts
    U.uDensity.value = Math.min(0.08, voxelUniforms.uFogDensity.value * 2.2 + voxelUniforms.uMistDensity.value * 0.8);
    this._pass(this.vol, this.volA);
    const B = this.volBlur.u;
    B.tSrc.value = this.volA.texture; B.uDir.value.set(1 / w, 0);
    this._pass(this.volBlur, this.volB);
    B.tSrc.value = this.volB.texture; B.uDir.value.set(0, 1 / h);
    this._pass(this.volBlur, this.volA);
    this.uniforms.uVol.value = strength;
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

  // eye adaptation: measure, reduce to one texel, then ease the exposure toward it
  _adapt(dt) {
    const L = this.lumChain;
    this.lumPass.u.tSrc.value = this.rt.texture;
    this.lumPass.u.uCell.value.set(1 / 32, 1 / 32);
    this._pass(this.lumPass, L[0]);
    for (let i = 1; i < L.length; i++) {
      this.reducePass.u.tSrc.value = L[i - 1].texture;
      this.reducePass.u.uTexel.value.set(1 / L[i - 1].width, 1 / L[i - 1].height);
      this._pass(this.reducePass, L[i]);
    }
    const A = this.adaptPass.u;
    A.tLum.value = L[L.length - 1].texture;
    A.tPrev.value = this.expA.texture;
    A.uDt.value = Math.min(0.25, dt);
    // the mood exposes a little darker and won't open up as far in the gloom
    const mood = this.uniforms.uMood.value;
    A.uKey.value = 0.72 - 0.13 * mood;
    A.uMax.value = 1.3 - 0.12 * mood;
    A.uReset.value = this.expReset ? 1 : 0;
    this.expReset = false;
    this._pass(this.adaptPass, this.expB);
    [this.expA, this.expB] = [this.expB, this.expA];
    this.uniforms.tExposure.value = this.expA.texture;
    this.uniforms.uAutoExp.value = 1;
  }

  // for tests and tuning: [exposure, measured average luminance]
  readExposure() {
    const buf = new Uint16Array(4);
    this.renderer.readRenderTargetPixels(this.expA, 0, 0, 1, 1, buf);
    return [THREE.DataUtils.fromHalfFloat(buf[0]), THREE.DataUtils.fromHalfFloat(buf[1])];
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
    const useVol = useAO && opts.volumetric !== false && (voxelUniforms.uShadowOn.value > 0.01 || voxelUniforms.uTorchOn.value > 0.01);
    if (useVol) this._volumetric(passes[0].camera, opts.volumetric ?? 1);
    else this.uniforms.uVol.value = 0;
    // keep this frame for next frame's reflections
    const V = voxelUniforms;
    if (useAO && opts.reflections !== false && !this.noSSR) {
      const cam = passes[0].camera;
      const H = this.histPass.u;
      H.tSrc.value = this.rt.texture; H.tDepth.value = this.rt.depthTexture;
      H.uNear.value = cam.near; H.uFar.value = cam.far;
      this._pass(this.histPass, this.hist);
      V.uHist.value = this.hist.texture;
      V.uHistVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      V.uSSR.value = this.histValid ? 1 : 0;
      V.uSSRSteps.value = q >= 2 ? 20 : 14;
      this.histValid = true;
    } else { V.uSSR.value = 0; this.histValid = false; }
    this.uniforms.uHasMask.value = useAO ? 1 : 0;
    r.setRenderTarget(this.rt);
    for (; i < passes.length; i++) {
      if (passes[i].clearDepth) r.clearDepth();
      r.render(passes[i].scene, passes[i].camera);
    }
    if (q >= 1) this._bloom();
    this.uniforms.uBloom.value = q >= 1 ? (opts.bloom ?? 0.42) * (1 - 0.4 * this.uniforms.uMood.value) : 0;
    if (opts.exposure !== false && !this.noAutoExp) this._adapt(opts.dt ?? 1 / 60);
    else this.uniforms.uAutoExp.value = 0;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
