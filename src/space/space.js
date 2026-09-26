// Star system in space: nebula skybox, star, voxel-shaded planets with atmospheres
// and rings, a liminal space station, and a mineable asteroid field.
import * as THREE from 'three';
import { RNG, hsl } from '../core/rng.js';
import { NOISE_GLSL, createPlanetMaterial, createAtmosphereMaterial, createRingMaterial } from './planetMaterial.js';

const _v = new THREE.Vector3();

function nebulaMaterial(system) {
  const rng = new RNG(system.seed ^ 0xbeef);
  const c1 = new THREE.Color(...hsl(rng.next(), 0.6, 0.35));
  const c2 = new THREE.Color(...hsl(rng.next(), 0.7, 0.45));
  const c3 = new THREE.Color(...hsl(rng.next(), 0.5, 0.15));
  return new THREE.ShaderMaterial({
    uniforms: { uC1: { value: c1 }, uC2: { value: c2 }, uC3: { value: c3 }, uSeed: { value: rng.range(0, 100) }, uDensity: { value: rng.range(0.4, 1.0) } },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uC1, uC2, uC3; uniform float uSeed, uDensity;
      varying vec3 vDir;
      ${NOISE_GLSL}
      float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
      void main() {
        vec3 d = normalize(vDir);
        float n = fbm(d * 2.0 + uSeed);
        float n2 = fbm(d * 4.0 - uSeed * 0.5);
        vec3 col = uC3 * 0.35;
        col += uC1 * smoothstep(0.0, 0.7, n) * 0.55 * uDensity;
        col += uC2 * smoothstep(0.2, 0.8, n2 * n + 0.2) * 0.45 * uDensity;
        // stars
        vec3 p = d * 400.0;
        vec3 cell = floor(p);
        float h = hash13(cell);
        if (h > 0.993) {
          float s = smoothstep(0.4, 0.0, length(fract(p) - 0.5));
          col += mix(vec3(1.0, 0.8, 0.7), vec3(0.7, 0.85, 1.0), fract(h * 71.0)) * s * (0.6 + fract(h * 13.0) * 1.2);
        }
        vec3 p2 = d * 1200.0;
        float h2 = hash13(floor(p2));
        if (h2 > 0.996) col += vec3(0.8) * smoothstep(0.4, 0.0, length(fract(p2) - 0.5)) * 0.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
}

function starMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(...color) }, uTime: { value: 0 } },
    vertexShader: /* glsl */`
      varying vec3 vObj; varying vec3 vN; varying vec3 vW;
      void main() {
        vObj = position; vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; uniform float uTime;
      varying vec3 vObj; varying vec3 vN; varying vec3 vW;
      ${NOISE_GLSL}
      void main() {
        vec3 p = normalize(vObj);
        float n = fbm(p * 4.0 + vec3(uTime * 0.02));
        vec3 v = normalize(cameraPosition - vW);
        float limb = pow(max(dot(normalize(vN), v), 0.0), 0.5);
        vec3 col = uCol * (1.4 + n * 0.6) * (0.6 + 0.4 * limb) + vec3(0.3) * limb;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function glowSprite(color, size) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const col = new THREE.Color(...color);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  g.addColorStop(0, `rgba(255,255,255,1)`);
  g.addColorStop(0.15, `rgba(${rgb},0.8)`);
  g.addColorStop(0.4, `rgba(${rgb},0.2)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(size, size, 1);
  return s;
}

// A dead freighter: a long broken hull tumbling slowly, with a few red lights still blinking
function buildDerelict(seed) {
  const rng = new RNG(seed);
  const g = new THREE.Group();
  const hull = new THREE.MeshLambertMaterial({ color: 0x3a3a40, flatShading: true });
  const rust = new THREE.MeshLambertMaterial({ color: 0x5a3a2a, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x15161a, flatShading: true });
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a18 });
  const add = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    g.add(m); return m;
  };
  // spine, split in the middle as if something broke its back
  add(150, 90, 330, hull, 0, 0, -180);
  add(150, 90, 300, hull, 0, -14, 190, 0.08, 0.05, 0.04);
  add(40, 40, 60, dark, 0, 0, 0);
  // bridge tower at the bow
  add(90, 70, 90, hull, 0, 80, 290, 0.08, 0.05, 0.04);
  add(70, 12, 8, dark, 0, 95, 244);
  // cargo pods hanging off both flanks, some missing
  for (let i = 0; i < 9; i++) {
    for (const s of [-1, 1]) {
      if (rng.chance(0.3)) continue;
      const z = -300 + i * 70;
      add(60, 60, 55, rng.chance(0.4) ? rust : hull, s * 108, rng.range(-12, 12), z, rng.range(-0.1, 0.1), 0, rng.range(-0.1, 0.1));
    }
  }
  // engines at the stern, cold
  for (const x of [-45, 0, 45]) add(36, 36, 50, dark, x, 0, -370);
  // the hangar mouth at the stern
  add(110, 60, 10, dark, 0, -22, -346);
  // drifting debris
  for (let i = 0; i < 26; i++) add(rng.range(8, 34), rng.range(6, 24), rng.range(8, 40), rng.chance(0.5) ? hull : rust, rng.range(-260, 260), rng.range(-140, 140), rng.range(-420, 420), rng.next() * 6, rng.next() * 6, 0);
  // emergency lights
  const lights = [];
  for (let i = 0; i < 10; i++) lights.push(add(6, 6, 6, red, rng.chance(0.5) ? -78 : 78, rng.range(-40, 50), rng.range(-330, 320)));
  g.userData.lights = lights;
  g.userData.spin = rng.range(0.004, 0.012) * (rng.chance(0.5) ? 1 : -1);
  return g;
}

function buildStation(seed) {
  const rng = new RNG(seed);
  const g = new THREE.Group();
  const hullCol = new THREE.Color(...hsl(rng.next(), 0.15, 0.75));
  const hull = new THREE.MeshLambertMaterial({ color: hullCol, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c2f3a, flatShading: true });
  const tile = new THREE.MeshLambertMaterial({ color: 0xf2f6f8, flatShading: true });
  const lights = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
  const neon = new THREE.MeshBasicMaterial({ color: new THREE.Color(...hsl(rng.next(), 0.8, 0.65)) });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    g.add(m); return m;
  };
  // core: stacked voxel cubes
  add(new THREE.BoxGeometry(260, 180, 260), hull, 0, 0, 0);
  add(new THREE.BoxGeometry(200, 60, 200), tile, 0, 120, 0);
  add(new THREE.BoxGeometry(200, 60, 200), tile, 0, -120, 0);
  add(new THREE.BoxGeometry(120, 80, 120), hull, 0, 190, 0);
  add(new THREE.BoxGeometry(120, 80, 120), hull, 0, -190, 0);
  add(new THREE.BoxGeometry(30, 200, 30), dark, 0, 330, 0);
  add(new THREE.BoxGeometry(30, 200, 30), dark, 0, -330, 0);
  // docking bay (front, -Z face): a dark opening with light strips
  add(new THREE.BoxGeometry(150, 80, 20), dark, 0, 0, -131);
  for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(8, 8, 4), lights, i * 30, -44, -142);
  for (let i = -2; i <= 2; i++) add(new THREE.BoxGeometry(8, 8, 4), lights, i * 30, 44, -142);
  add(new THREE.BoxGeometry(160, 4, 6), neon, 0, 52, -142);
  // ring
  const ring = new THREE.Group();
  const seg = 16;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(120, 30, 40), i % 2 ? hull : tile);
    m.position.set(Math.cos(a) * 380, 0, Math.sin(a) * 380);
    m.rotation.y = -a + Math.PI / 2;
    ring.add(m);
    if (i % 2 === 0) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(20, 6, 42), lights);
      l.position.copy(m.position); l.position.y = 16; l.rotation.copy(m.rotation);
      ring.add(l);
    }
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(250, 14, 14), dark);
    spoke.position.set(Math.cos(a) * 250, 0, Math.sin(a) * 250);
    spoke.rotation.y = -a;
    ring.add(spoke);
  }
  g.add(ring);
  g.userData.ring = ring;
  // windows - little liminal pool-tile squares glowing
  for (let i = 0; i < 40; i++) {
    const side = rng.int(0, 3);
    const w = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 2), rng.chance(0.3) ? neon : lights);
    const u = rng.range(-110, 110), v = rng.range(-70, 70);
    if (side === 0) { w.position.set(u, v, 131); }
    else if (side === 1) { w.position.set(131, v, u); w.rotation.y = Math.PI / 2; }
    else if (side === 2) { w.position.set(-131, v, u); w.rotation.y = Math.PI / 2; }
    else { w.position.set(u, v, 131); }
    g.add(w);
  }
  return g;
}

export class SpaceScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.system = null;
    this.planets = [];
    this.asteroids = null;
    this.asteroidData = [];
    this.ambient = new THREE.AmbientLight(0x505068, 1.3 * Math.PI);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5 * Math.PI);
    this.scene.add(this.ambient, this.sunLight, this.sunLight.target);
    this.time = 0;
    this.dust = this._makeDust();
    this.scene.add(this.dust);
  }

  _makeDust() {
    const N = 900;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N * 3; i++) pos[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustUniforms = { uCam: { value: new THREE.Vector3() }, uVel: { value: new THREE.Vector3() }, uBox: { value: 220 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      vertexShader: /* glsl */`
        uniform vec3 uCam; uniform float uBox;
        varying float vA;
        void main() {
          vec3 p = fract(position - uCam / uBox) - 0.5;
          vec3 wp = uCam + p * uBox;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          vA = 1.0 - smoothstep(0.3, 0.5, length(p));
          gl_PointSize = 2.0 * (60.0 / max(1.0, -mv.z)) + 1.0;
        }`,
      fragmentShader: /* glsl */`
        varying float vA;
        void main() { gl_FragColor = vec4(vec3(0.8, 0.85, 1.0), vA * 0.6); }`,
      transparent: true, depthWrite: false,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    return pts;
  }

  build(system) {
    // dispose old
    const keep = new Set([this.ambient, this.sunLight, this.sunLight.target, this.dust]);
    for (const c of [...this.scene.children]) {
      if (keep.has(c) || c.userData.keep) continue;
      this.scene.remove(c);
      c.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
    }
    this.system = system;
    this.planets = [];
    // skybox
    this.nebula = new THREE.Mesh(new THREE.SphereGeometry(500000, 32, 16), nebulaMaterial(system));
    this.nebula.frustumCulled = false;
    this.nebula.renderOrder = -100;
    this.scene.add(this.nebula);
    // star
    const sr = system.star.radius;
    this.star = new THREE.Mesh(new THREE.SphereGeometry(sr, 48, 32), starMaterial(system.star.color));
    this.scene.add(this.star);
    this.starGlow = glowSprite(system.star.color, sr * 9);
    this.scene.add(this.starGlow);
    this.sunLight.color.setRGB(...system.star.color);
    // planets
    for (const pl of system.planets) {
      const grp = new THREE.Group();
      grp.position.set(...pl.position);
      const mat = createPlanetMaterial(pl);
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(pl.radius, 96, 64), mat);
      mesh.rotation.z = pl.axialTilt;
      grp.add(mesh);
      const atmo = new THREE.Mesh(new THREE.SphereGeometry(pl.radius * 1.12, 64, 48), createAtmosphereMaterial(pl));
      grp.add(atmo);
      if (pl.rings) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(pl.radius * 1.5, pl.radius * 2.4, 96, 1), createRingMaterial(pl.ringColor));
        ring.rotation.x = Math.PI / 2 + pl.axialTilt;
        ring.rotation.y = 0.2;
        grp.add(ring);
      }
      this.scene.add(grp);
      this.planets.push({ data: pl, group: grp, mesh, mat, atmo });
    }
    // station
    this.station = buildStation(system.seed);
    this.station.position.set(...system.station.position);
    // face docking bay toward the star-ish
    this.station.lookAt(0, system.station.position[1], 0);
    this.station.rotateY(Math.PI);
    this.scene.add(this.station);
    // a derelict, if this system has one
    this.derelict = null;
    if (system.derelict) {
      this.derelict = buildDerelict(system.derelict.seed);
      this.derelict.position.set(...system.derelict.position);
      this.derelict.rotation.set(0.3, (system.derelict.seed % 628) / 100, 0.15);
      this.scene.add(this.derelict);
    }
    // asteroid field
    this._buildAsteroids(system);
  }

  _buildAsteroids(system) {
    const rng = new RNG(system.asteroidSeed);
    const N = 420;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x8a8580, flatShading: true });
    this.asteroids = new THREE.InstancedMesh(geo, mat, N);
    this.asteroidData = [];
    const center = new THREE.Vector3(...system.arrival).add(new THREE.Vector3(rng.range(-3000, 3000), rng.range(-800, 800), rng.range(-3000, 3000)));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const r = Math.pow(rng.next(), 0.6) * 6000;
      const a = rng.next() * Math.PI * 2;
      const p = new THREE.Vector3(center.x + Math.cos(a) * r, center.y + rng.range(-700, 700), center.z + Math.sin(a) * r);
      const s = rng.chance(0.1) ? rng.range(40, 90) : rng.range(6, 32);
      q.setFromEuler(new THREE.Euler(rng.next() * 6, rng.next() * 6, rng.next() * 6));
      m.compose(p, q, new THREE.Vector3(s, s * rng.range(0.6, 1), s * rng.range(0.7, 1.2)));
      this.asteroids.setMatrixAt(i, m);
      const rich = rng.chance(0.08);
      col.setHSL(rich ? rng.range(0.08, 0.14) : rng.range(0.05, 0.12), rich ? 0.6 : 0.08, rich ? 0.55 : rng.range(0.35, 0.5));
      this.asteroids.setColorAt(i, col);
      this.asteroidData.push({ p, s, alive: true, rich, q: q.clone(), hp: s * 2 });
    }
    this.asteroids.instanceMatrix.needsUpdate = true;
    this.scene.add(this.asteroids);
  }

  destroyAsteroid(i) {
    const a = this.asteroidData[i];
    a.alive = false;
    const m = new THREE.Matrix4().compose(a.p, a.q, new THREE.Vector3(0.0001, 0.0001, 0.0001));
    this.asteroids.setMatrixAt(i, m);
    this.asteroids.instanceMatrix.needsUpdate = true;
  }

  // Ray vs asteroid spheres
  raycastAsteroid(origin, dir, maxDist) {
    let best = -1, bestT = maxDist;
    for (let i = 0; i < this.asteroidData.length; i++) {
      const a = this.asteroidData[i];
      if (!a.alive) continue;
      const oc = _v.copy(origin).sub(a.p);
      const b = oc.dot(dir);
      const c = oc.lengthSq() - a.s * a.s;
      const h = b * b - c;
      if (h < 0) continue;
      const t = -b - Math.sqrt(h);
      if (t > 0 && t < bestT) { bestT = t; best = i; }
    }
    return best >= 0 ? { index: best, dist: bestT } : null;
  }

  asteroidHit(p, r) {
    for (let i = 0; i < this.asteroidData.length; i++) {
      const a = this.asteroidData[i];
      if (!a.alive) continue;
      if (a.p.distanceToSquared(p) < (a.s + r) * (a.s + r)) return i;
    }
    return -1;
  }

  planetWorldQuat(i) {
    return this.planets[i].mesh.getWorldQuaternion(new THREE.Quaternion());
  }

  update(dt, camera, shipPos, shipVel) {
    this.time += dt;
    this.nebula.position.copy(camera.position);
    this.star.material.uniforms.uTime.value = this.time;
    this.dustUniforms.uCam.value.copy(camera.position);
    // sun light points from star toward the ship
    const toShip = _v.copy(shipPos).normalize();
    this.sunLight.position.copy(shipPos).addScaledVector(toShip, -1000);
    this.sunLight.target.position.copy(shipPos);
    for (const p of this.planets) {
      p.mesh.rotation.y += p.data.rotationSpeed * dt;
      const sd = new THREE.Vector3().copy(p.group.position).negate().normalize();
      p.mat.uniforms.uSunDir.value.copy(sd);
      p.mat.uniforms.uTime.value = this.time;
      p.atmo.material.uniforms.uSunDir.value.copy(sd);
    }
    if (this.station) this.station.userData.ring.rotation.y += dt * 0.05;
  }
}
