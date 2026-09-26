// The Roamer exocraft: a one-seat planetary rover. Signed-distance chassis and wheels, voxelised
// like everything else. Faces -Z; origin on the ground under the chassis centre.
import * as THREE from 'three';
import { applyCurvature } from '../core/shaderlib.js';
import { sdfMesh, voxelLitMaterial, voxelGlowMaterial, ellipsoid, capsule, box, smin, smax, fbm3 } from './sdfModel.js';

export const WHEELS = [[-1.3, -1.55], [1.3, -1.55], [-1.3, 1.5], [1.3, 1.5]]; // x, z
export const WHEEL_R = 0.72;

const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

export function buildRover() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = [0.95, 0.62, 0.16], dark = [0.16, 0.17, 0.2], steel = [0.55, 0.57, 0.6];
  const tub = (p) => box(p, 0, 1.18, 0.05, 1.0, 0.36, 2.05, 0.22);
  const cab = (p) => box(p, 0, 1.78, -0.35, 0.82, 0.36, 0.85, 0.2);
  const fender = (p, x, z) => smax(ellipsoid(p, x, 1.0, z, 0.42, 0.62, 0.95), -(p[1] - 0.85), 0.05);
  const bumper = (p) => box(p, 0, 0.98, -2.12, 0.95, 0.14, 0.12, 0.06);
  const rack = (p) => box(p, 0, 1.62, 1.35, 0.8, 0.08, 0.62, 0.03);
  body.add(sdfMesh('rover-body', {
    min: [-1.85, 0.55, -2.4], max: [1.85, 2.35, 2.4], step: 0.06,
    sdf: (p) => {
      let d = smin(tub(p), cab(p), 0.2);
      for (const [x, z] of WHEELS) d = smin(d, fender(p, Math.sign(x) * 1.18, z), 0.12);
      d = Math.min(d, bumper(p), rack(p));
      // roll cage
      for (const s of [-1, 1]) {
        d = Math.min(d, capsule(p, s * 0.78, 1.5, 0.55, s * 0.78, 2.3, 0.2, 0.06));
        d = Math.min(d, capsule(p, s * 0.78, 2.3, 0.2, s * 0.78, 2.3, -0.9, 0.06));
      }
      d = Math.min(d, capsule(p, -0.78, 2.3, 0.2, 0.78, 2.3, 0.2, 0.06));
      // cut the windscreen and wheel wells
      d = smax(d, -box(p, 0, 1.86, -1.22, 0.7, 0.24, 0.2, 0.05), 0.04);
      for (const [x, z] of WHEELS) d = smax(d, -capsule(p, x - 0.4, WHEEL_R, z, x + 0.4, WHEEL_R, z, WHEEL_R + 0.12), 0.05);
      return d;
    },
    color: (p) => {
      const n = 0.9 + fbm3(p[0] * 3, p[1] * 3, p[2] * 3, 2) * 0.1;
      if (p[1] < 0.95 || Math.abs(p[2] + 2.12) < 0.14) return shade(dark, n);
      if (p[1] > 2.2 || (Math.abs(Math.abs(p[0]) - 0.78) < 0.08 && p[1] > 1.5)) return shade(steel, n);
      if (rack(p) < 0.02) return shade(dark, n);
      // black stripe along the side, hazard chevrons on the nose
      if (Math.abs(p[1] - 1.2) < 0.06) return shade(dark, n);
      if (p[2] < -1.95 && ((Math.floor((p[0] + p[1]) * 3) & 1) === 0)) return shade(dark, n);
      return shade(paint, n);
    },
  }, voxelLitMaterial()));
  // tinted windscreen / side windows
  const glass = applyCurvature(new THREE.MeshLambertMaterial({ color: 0x6fd7ff, emissive: 0x114455, transparent: true, opacity: 0.75 }));
  const ws = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.44, 0.06), glass);
  ws.position.set(0, 1.86, -1.14); ws.rotation.x = -0.25;
  body.add(ws);
  // headlights
  const lights = [];
  for (const s of [-1, 1]) {
    const l = sdfMesh('rover-lamp', {
      min: [-0.2, -0.14, -0.1], max: [0.2, 0.14, 0.1], step: 0.03,
      sdf: (p) => box(p, 0, 0, 0, 0.17, 0.1, 0.06, 0.03),
      color: () => [1.4, 1.35, 1.2],
    }, voxelGlowMaterial());
    l.position.set(s * 0.62, 1.3, -2.1);
    body.add(l);
    lights.push(l);
  }
  // light cones hanging in the fog in front of each lamp
  const beamMat = applyCurvature(new THREE.MeshBasicMaterial({ color: 0xfff1d6, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  const beamGeo = new THREE.ConeGeometry(2.6, 16, 18, 1, true);
  beamGeo.translate(0, -8, 0);
  beamGeo.rotateX(Math.PI / 2);
  const beams = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(beamGeo, beamMat);
    b.position.set(s * 0.62, 1.3, -2.15);
    b.rotation.x = -0.1;
    b.renderOrder = 9;
    b.visible = false;
    body.add(b);
    beams.push(b);
  }
  // roof turret (mining cannon)
  const turret = new THREE.Group();
  turret.position.set(0, 2.36, 0.9);
  body.add(turret);
  turret.add(sdfMesh('rover-gun', {
    min: [-0.3, -0.1, -1.2], max: [0.3, 0.45, 0.35], step: 0.04,
    sdf: (p) => Math.min(ellipsoid(p, 0, 0.12, 0, 0.26, 0.2, 0.28), capsule(p, 0, 0.18, -0.1, 0, 0.18, -1.05, 0.08, 0.06)),
    color: (p) => (p[2] < -0.9 ? [0.3, 0.95, 1.1] : dark),
  }, voxelLitMaterial()));
  // wheels: rounded tyres with tread and a hub
  const wheelGeoMesh = () => sdfMesh('rover-wheel', {
    min: [-0.36, -0.82, -0.82], max: [0.36, 0.82, 0.82], step: 0.05,
    sdf: (p) => {
      const r = Math.hypot(p[1], p[2]);
      const tread = Math.sin(Math.atan2(p[1], p[2]) * 14) * 0.03;
      return Math.hypot(Math.max(r - (WHEEL_R - 0.18), 0), Math.max(Math.abs(p[0]) - 0.14, 0)) - 0.17 - tread;
    },
    color: (p) => {
      const r = Math.hypot(p[1], p[2]);
      if (r < 0.34) return Math.abs(p[0]) > 0.1 ? [0.75, 0.76, 0.8] : [0.3, 0.3, 0.33];
      return Math.sin(Math.atan2(p[1], p[2]) * 14) > 0.4 ? [0.09, 0.09, 0.1] : [0.14, 0.14, 0.15];
    },
  }, voxelLitMaterial());
  const wheels = [];
  for (const [x, z] of WHEELS) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const w = wheelGeoMesh();
    pivot.add(w);
    // hub cap disc so the wheel isn't hollow-looking from the side
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.3, 12), applyCurvature(new THREE.MeshLambertMaterial({ color: 0x9aa0aa })));
    cap.rotation.z = Math.PI / 2;
    w.add(cap);
    root.add(pivot);
    wheels.push({ pivot, mesh: w, x, z });
  }
  root.userData = { body, wheels, turret, lights, beams };
  return root;
}
