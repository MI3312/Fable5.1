// Planet sky: gradient dome with sun, moons/planets in the sky, stars, dream aurora;
// blocky voxel clouds; weather particles.
import * as THREE from 'three';
import { SKY_GLSL, curvatureUniforms } from '../core/shaderlib.js';
import { voxelUniforms } from '../world/voxelMaterial.js';

const MAX_BODIES = 4;

export class Sky {
  constructor(scene) {
    this.uniforms = {
      uZenith: voxelUniforms.uZenith,
      uHorizon: voxelUniforms.uHorizon,
      uGroundCol: voxelUniforms.uGroundCol,
      uSunDir: voxelUniforms.uSunDir,
      uSunColor: voxelUniforms.uSunColor,
      uDaylight: voxelUniforms.uDaylight,
      uSunset: voxelUniforms.uSunset,
      uSunsetCol: voxelUniforms.uSunsetCol,
      uTime: voxelUniforms.uTime,
      uStars: { value: 0 },
      uDream: { value: 0 },
      uDreamCol: { value: new THREE.Color(1, 0.6, 0.9) },
      uBodyDir: { value: Array.from({ length: MAX_BODIES }, () => new THREE.Vector3(0, -1, 0)) },
      uBodyCol: { value: Array.from({ length: MAX_BODIES }, () => new THREE.Color()) },
      uBodySize: { value: new Array(MAX_BODIES).fill(0) },
      uStorm: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w * 0.99999;
        }`,
      fragmentShader: /* glsl */`
        ${SKY_GLSL}
        uniform float uTime;
        uniform float uStars;
        uniform float uDream;
        uniform vec3 uDreamCol;
        uniform vec3 uBodyDir[${MAX_BODIES}];
        uniform vec3 uBodyCol[${MAX_BODIES}];
        uniform float uBodySize[${MAX_BODIES}];
        uniform float uStorm;
        varying vec3 vDir;
        float hash13(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.zyx + 31.32);
          return fract((p.x + p.y) * p.z);
        }
        float vnoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
          float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
          return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
        }
        void main() {
          vec3 dir = normalize(vDir);
          vec3 col = skyGradient(dir);
          float night = 1.0 - uDaylight;
          // stars
          float starVis = max(night, uStars) * smoothstep(-0.05, 0.15, dir.y) * (1.0 - uStorm);
          if (starVis > 0.01) {
            vec3 p = dir * 260.0;
            vec3 cell = floor(p);
            float h = hash13(cell);
            if (h > 0.9965) {
              vec3 f = fract(p) - 0.5;
              float d = length(f);
              float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h * 400.0);
              float s = smoothstep(0.35, 0.0, d) * tw;
              vec3 sc = mix(vec3(1.0, 0.85, 0.7), vec3(0.7, 0.8, 1.0), fract(h * 91.0));
              col += sc * s * starVis * 1.4;
            }
            // milky band
            float band = exp(-pow(dot(dir, normalize(vec3(0.3, 0.2, 1.0))) * 3.0, 2.0));
            col += vec3(0.25, 0.2, 0.35) * band * vnoise(dir * 12.0) * starVis * 0.35;
          }
          // dream aurora: slow pastel ribbons
          if (uDream > 0.0) {
            float a = sin(dir.x * 3.0 + uTime * 0.05 + sin(dir.z * 4.0 + uTime * 0.07) * 1.5);
            float rib = smoothstep(0.75, 1.0, a) * smoothstep(0.05, 0.4, dir.y) * smoothstep(0.95, 0.5, dir.y);
            vec3 dc = mix(uDreamCol, uDreamCol.bgr, 0.5 + 0.5 * sin(uTime * 0.1 + dir.x * 2.0));
            col += dc * rib * 0.35 * uDream * (0.5 + 0.5 * night + 0.3);
          }
          // celestial bodies
          for (int i = 0; i < ${MAX_BODIES}; i++) {
            float sz = uBodySize[i];
            if (sz <= 0.0) continue;
            vec3 c = uBodyDir[i];
            float cosT = dot(dir, c);
            float th = acos(clamp(cosT, -1.0, 1.0));
            if (th < sz * 1.25) {
              float t = th / sz;
              vec3 dperp = normalize(dir - c * cosT + 1e-5);
              if (t < 1.0) {
                vec3 n = dperp * t - c * sqrt(1.0 - t * t);
                float lit = clamp(dot(-n, uSunDir) * 0.9 + 0.1, 0.03, 1.0);
                float tex = 0.75 + 0.25 * vnoise(vec3(dperp.xy * t * 6.0 + float(i) * 10.0, float(i)));
                vec3 bc = uBodyCol[i] * tex * lit;
                float edge = smoothstep(1.0, 0.97, t);
                col = mix(col, bc + col * 0.1, edge);
              } else {
                float glow = (1.0 - (t - 1.0) / 0.25);
                col += uBodyCol[i] * glow * glow * 0.12;
              }
            }
          }
          // sun disc
          float sd = dot(dir, uSunDir);
          col += uSunColor * smoothstep(0.9993, 0.9997, sd) * 3.0;
          col += uSunColor * pow(max(sd, 0.0), 300.0) * 0.8;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  setBodies(bodies) {
    for (let i = 0; i < MAX_BODIES; i++) {
      const b = bodies[i];
      if (b) {
        this.uniforms.uBodyDir.value[i].set(b.dir[0], b.dir[1], b.dir[2]).normalize();
        this.uniforms.uBodyCol.value[i].setRGB(b.color[0], b.color[1], b.color[2]);
        this.uniforms.uBodySize.value[i] = b.size;
      } else {
        this.uniforms.uBodySize.value[i] = 0;
      }
    }
  }

  update(camera) {
    this.mesh.position.copy(camera.position);
  }
}

export class Clouds {
  constructor(scene) {
    this.uniforms = {
      uTime: voxelUniforms.uTime,
      uCloudCol: { value: new THREE.Color(1, 1, 1) },
      uCover: { value: 0.45 },
      uDaylight: voxelUniforms.uDaylight,
      uHorizon: voxelUniforms.uHorizon,
      uCurve: curvatureUniforms.uCurve,
      uOffset: { value: new THREE.Vector2() },
      uHeight: { value: 150 },
    };
    const geo = new THREE.PlaneGeometry(1400, 1400, 80, 80);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        uniform float uCurve;
        varying vec3 vWorld;
        varying float vDist;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec2 cd = wp.xz - cameraPosition.xz;
          wp.y -= dot(cd, cd) * uCurve;
          vec4 mv = viewMatrix * wp;
          vDist = length(cd);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uCloudCol;
        uniform float uCover;
        uniform float uDaylight;
        uniform vec3 uHorizon;
        uniform vec2 uOffset;
        varying vec3 vWorld;
        varying float vDist;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }
        float occ(vec2 cell) {
          float n = noise(cell * 0.18) * 0.65 + noise(cell * 0.5) * 0.35;
          return step(1.0 - uCover, n);
        }
        void main() {
          vec2 p = vWorld.xz + vec2(uTime * 2.0, uTime * 0.7);
          vec2 cell = floor(p / 12.0);
          if (occ(cell) < 0.5) discard;
          vec2 f = fract(p / 12.0);
          float e = 1.0;
          if (occ(cell + vec2(1.0, 0.0)) < 0.5) e = min(e, 1.0 - f.x);
          if (occ(cell - vec2(1.0, 0.0)) < 0.5) e = min(e, f.x);
          if (occ(cell + vec2(0.0, 1.0)) < 0.5) e = min(e, 1.0 - f.y);
          if (occ(cell - vec2(0.0, 1.0)) < 0.5) e = min(e, f.y);
          float shade = 0.8 + 0.2 * smoothstep(0.0, 0.12, e);
          if (cameraPosition.y < vWorld.y) shade *= 0.86;
          vec3 col = uCloudCol * shade * (0.25 + 0.75 * uDaylight);
          float fade = 1.0 - smoothstep(350.0, 680.0, vDist);
          col = mix(uHorizon, col, 0.6 + 0.4 * fade);
          gl_FragColor = vec4(col, 0.82 * fade);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  update(camera) {
    // snap to 12-block grid so the cloud cells don't swim
    this.mesh.position.set(Math.round(camera.position.x / 12) * 12, this.uniforms.uHeight.value, Math.round(camera.position.z / 12) * 12);
  }
}

const WEATHER_TYPES = {
  none: { color: [1, 1, 1], speed: 0, size: 0, streak: 0 },
  rain: { color: [0.7, 0.8, 1.0], speed: 28, size: 7, streak: 1 },
  snow: { color: [1, 1, 1], speed: 3, size: 5, streak: 0 },
  ash: { color: [0.35, 0.3, 0.3], speed: 2.5, size: 4, streak: 0, ember: 1 },
  toxic: { color: [0.7, 1.0, 0.3], speed: 14, size: 6, streak: 1 },
  dust: { color: [0.85, 0.75, 0.55], speed: 1.5, size: 3.5, streak: 0, wind: 10 },
  sparkle: { color: [1.0, 0.7, 1.0], speed: 0.8, size: 4, streak: 0, glow: 1 },
  dream: { color: [1.0, 0.85, 0.95], speed: -0.6, size: 4.5, streak: 0, glow: 1 },
};

export class Weather {
  constructor(scene) {
    const N = 2400;
    const base = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      base[i * 3] = Math.random(); base[i * 3 + 1] = Math.random(); base[i * 3 + 2] = Math.random();
      seed[i] = i / N;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(56, 36, 56) },
      uSpeed: { value: 10 },
      uWind: { value: 0 },
      uSize: { value: 5 },
      uColor: { value: new THREE.Color(1, 1, 1) },
      uIntensity: { value: 0 },
      uStreak: { value: 0 },
      uGlow: { value: 0 },
      uDaylight: voxelUniforms.uDaylight,
      uPixelRatio: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        attribute float aSeed;
        uniform float uTime, uSpeed, uWind, uSize, uIntensity, uPixelRatio;
        uniform vec3 uCam, uBox;
        varying float vAlpha;
        void main() {
          vec3 b = position;
          vec3 off = vec3(uWind * uTime / uBox.x + sin(uTime * 0.5 + aSeed * 30.0) * 0.01, -uSpeed * uTime / uBox.y, uTime * 0.013);
          vec3 p = fract(b + off - uCam / uBox) - 0.5;
          vec3 wp = uCam + p * uBox;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          vAlpha = aSeed < uIntensity ? 1.0 : 0.0;
          float edge = 1.0 - smoothstep(0.35, 0.5, max(abs(p.x), max(abs(p.y), abs(p.z))));
          vAlpha *= edge;
          gl_PointSize = uSize * uPixelRatio * (40.0 / max(1.0, -mv.z));
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        uniform float uStreak, uGlow, uDaylight;
        varying float vAlpha;
        void main() {
          if (vAlpha <= 0.01) discard;
          vec2 pc = gl_PointCoord - 0.5;
          float a;
          if (uStreak > 0.5) a = (1.0 - smoothstep(0.02, 0.08, abs(pc.x))) * (1.0 - smoothstep(0.3, 0.5, abs(pc.y)));
          else a = 1.0 - smoothstep(0.2, 0.5, length(pc));
          vec3 c = uColor * (uGlow > 0.5 ? 1.2 : (0.35 + 0.65 * uDaylight));
          gl_FragColor = vec4(c, a * vAlpha * 0.75);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    scene.add(this.points);
    this.type = 'none';
    this.target = 0;
  }

  setType(type) {
    this.type = type in WEATHER_TYPES ? type : 'none';
    const w = WEATHER_TYPES[this.type];
    this.uniforms.uColor.value.setRGB(w.color[0], w.color[1], w.color[2]);
    this.uniforms.uSpeed.value = w.speed;
    this.uniforms.uSize.value = w.size;
    this.uniforms.uStreak.value = w.streak;
    this.uniforms.uGlow.value = w.glow || 0;
    this.uniforms.uWind.value = w.wind || 2;
  }

  update(dt, camera, intensity, time) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uIntensity.value += (intensity - u.uIntensity.value) * Math.min(1, dt * 0.5);
    this.points.visible = this.type !== 'none' && u.uIntensity.value > 0.01;
  }
}
