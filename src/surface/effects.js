// Visual effects: block debris, mining beam, scanner pulse, projectiles.
import * as THREE from 'three';
import { applyCurvature } from '../core/shaderlib.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

export class Debris {
  constructor(scene, max = 400, size = 0.16) {
    this.max = max;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = applyCurvature(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.parts = [];
  }

  spawn(pos, color, count = 8, speed = 3, life = 1.0, glow = false) {
    for (let i = 0; i < count; i++) {
      if (this.parts.length >= this.max) this.parts.shift();
      this.parts.push({
        p: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.6, pos.y + (Math.random() - 0.5) * 0.6, pos.z + (Math.random() - 0.5) * 0.6),
        v: new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.9 + 1, (Math.random() - 0.5) * speed),
        life: life * (0.6 + Math.random() * 0.6),
        max: life,
        c: color,
        r: Math.random() * 6,
        g: glow ? -0.2 : 1,
      });
    }
  }

  update(dt) {
    let n = 0;
    const out = [];
    for (const p of this.parts) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.v.y -= 16 * dt * p.g;
      p.v.multiplyScalar(Math.pow(0.6, dt));
      p.p.addScaledVector(p.v, dt);
      p.r += dt * 5;
      const s = Math.min(1, p.life / p.max * 1.5);
      _q.setFromAxisAngle(_p.set(0.3, 1, 0.2).normalize(), p.r);
      _m.compose(p.p, _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(n, _m);
      _c.setRGB(p.c[0], p.c[1], p.c[2]);
      this.mesh.setColorAt(n, _c);
      n++;
      out.push(p);
    }
    this.parts = out;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.parts.length = 0; this.mesh.count = 0; }
}

export class Beam {
  constructor(scene) {
    const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2); // along +Z
    this.mat = new THREE.MeshBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    this.core = new THREE.Mesh(geo, this.mat);
    this.core.frustumCulled = false;
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    this.tip = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.glowMat);
    this.tip.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.core, this.tip);
    this.group.visible = false;
    this.group.renderOrder = 8;
    scene.add(this.group);
  }

  show(from, to, color, t, width = 0.035) {
    this.group.visible = true;
    const d = from.distanceTo(to);
    this.core.position.copy(from);
    this.core.lookAt(to);
    const w = width * (0.8 + Math.sin(t * 60) * 0.2);
    this.core.scale.set(w, w, d);
    this.tip.position.copy(to);
    this.tip.scale.setScalar(0.8 + Math.sin(t * 45) * 0.3);
    this.mat.color.set(color);
    this.glowMat.color.set(color).lerp(new THREE.Color(1, 1, 1), 0.5);
  }

  hide() { this.group.visible = false; }
}

export class ScanPulse {
  constructor(scene) {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uR: { value: 0 }, uA: { value: 0 }, uCol: { value: new THREE.Color(0.4, 1.0, 1.0) } },
      vertexShader: /* glsl */`
        varying vec3 vN; varying vec3 vV;
        void main() {
          vN = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform float uA; uniform vec3 uCol;
        varying vec3 vN; varying vec3 vV;
        void main() {
          float f = 1.0 - abs(dot(vN, vV));
          float a = pow(f, 3.0) * uA;
          gl_FragColor = vec4(uCol * (0.6 + f), a);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), this.mat);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
    this.t = -1;
    this.maxR = 90;
  }

  fire(pos, maxR = 90, color = 0x66ffff) {
    this.t = 0;
    this.maxR = maxR;
    this.origin = pos.clone();
    this.mat.uniforms.uCol.value.set(color);
  }

  update(dt) {
    if (this.t < 0) { this.mesh.visible = false; return; }
    this.t += dt;
    const k = this.t / 2.2;
    if (k >= 1) { this.t = -1; this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.mesh.position.copy(this.origin);
    const r = 2 + Math.pow(k, 0.6) * this.maxR;
    this.mesh.scale.setScalar(r);
    this.mat.uniforms.uA.value = (1 - k) * 1.2;
  }
}

// Simple glowing bolt projectiles (player boltcaster, ship cannons, sentinel lasers)
export class Bolts {
  constructor(scene, max = 120) {
    this.max = max;
    const geo = new THREE.BoxGeometry(0.12, 0.12, 1.4);
    this.mat = applyCurvature(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.list = [];
  }

  fire(pos, dir, speed, owner, damage, color, life = 1.6, scale = 1) {
    if (this.list.length >= this.max) this.list.shift();
    this.list.push({ p: pos.clone(), v: dir.clone().normalize().multiplyScalar(speed), owner, damage, color: new THREE.Color(color), life, scale, dead: false });
  }

  // hitFn(bolt, prevPos) -> true if consumed
  update(dt, hitFn) {
    let n = 0;
    const up = new THREE.Vector3(0, 0, 1);
    for (const b of this.list) {
      if (b.dead) continue;
      b.life -= dt;
      if (b.life <= 0) { b.dead = true; continue; }
      const prev = b.p.clone();
      b.p.addScaledVector(b.v, dt);
      if (hitFn && hitFn(b, prev)) { b.dead = true; continue; }
      _q.setFromUnitVectors(up, _p.copy(b.v).normalize());
      _m.compose(b.p, _q, _s.set(b.scale, b.scale, b.scale * 1.5));
      this.mesh.setMatrixAt(n, _m);
      this.mesh.setColorAt(n, b.color);
      n++;
    }
    this.list = this.list.filter((b) => !b.dead);
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.list.length = 0; this.mesh.count = 0; }
}

// Wireframe block selection box
export function makeSelectionBox() {
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
  const mat = applyCurvature(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  const m = new THREE.LineSegments(geo, mat);
  m.visible = false;
  m.renderOrder = 7;
  return m;
}
