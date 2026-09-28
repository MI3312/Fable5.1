// The Librarian: three metres of stooped black robe, a long pale face in a deep hood, wire
// spectacles over nothing, arms that are too long and fingers that are longer. It carries a
// lantern (a real light: the pocket lends it a point light) and a tome against its chest, and a
// chain of books and a ring of keys hang from its belt. Sculpted from signed distance fields and
// voxelised like the wildlife, in jointed parts so it can walk, listen, search and shelve.
import * as THREE from 'three';
import { voxelize, sphere, ellipsoid, capsule, box, smin, smax, fbm3, noise3 } from './sdfModel.js';
import { propLitMaterial } from './propLight.js';
import { GeoBuilder } from './propGeo.js';

const ROBE = [0.1, 0.083, 0.072], ROBE_HI = [0.16, 0.13, 0.11], SKIN = [0.6, 0.57, 0.5], SKIN_DK = [0.46, 0.42, 0.37];
const BELT = [0.3, 0.23, 0.14], BRASS = [0.72, 0.56, 0.26], WIRE = [0.62, 0.52, 0.3];
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ringXY = (p, cx, cy, cz, R, r) => { const q = Math.hypot(p[0] - cx, p[1] - cy) - R; return Math.hypot(q, p[2] - cz) - r; };

let parts = null;
const STEP = 0.034;

// the robe's surface around the stoop: centre line leans forward toward the shoulders
const robeZ = (y) => 0.24 * smooth(1.0, 2.25, y);
const robeR = (y) => 0.25 + 0.27 * Math.pow(Math.max(0, 1 - y / 2.25), 1.25);
function robeD(p) {
  const [x, y, z] = p;
  const r = robeR(y), rx = r * 1.1, rz = r * 0.84, zc = robeZ(y);
  let d = (Math.hypot(x / rx, (z - zc) / rz) - 1) * Math.min(rx, rz);
  const ang = Math.atan2(x, z - zc);
  d -= 0.02 * Math.sin(ang * 9 + y * 1.4) * smooth(0, 1.8, 2.2 - y);
  return d;
}
// what hangs from the belt: a chain of two books and a ring of keys
const beltD = (p) => Math.max(Math.abs(p[1] - 1.36) - 0.035, robeD(p) - 0.028);
const book1D = (p) => box(p, 0.34, 1.06, 0.2, 0.035, 0.11, 0.08, 0.01);
const book2D = (p) => box(p, 0.39, 0.86, 0.16, 0.03, 0.09, 0.07, 0.01);
const chainD = (p) => Math.min(capsule(p, 0.3, 1.34, 0.14, 0.33, 1.17, 0.19, 0.012), capsule(p, 0.35, 0.97, 0.18, 0.38, 0.95, 0.16, 0.01));
function keysD(p) {
  const [x, y, z] = p;
  let d = Math.hypot(Math.hypot(x + 0.33, z - 0.14) - 0.055, y - 1.22) - 0.01;
  for (let k = 0; k < 3; k++) d = Math.min(d, capsule(p, -0.36 + k * 0.03, 1.2, 0.14, -0.38 + k * 0.04, 1.08, 0.16 + k * 0.01, 0.012));
  return d;
}
function robeBody(p) {
  const [x, y, z] = p;
  let d = robeD(p);
  d = smax(d, y - 2.24, 0.12);
  // a ragged hem
  const hem = 0.03 + 0.13 * Math.max(0, fbm3(x * 4.2, 0.5, z * 4.2, 2));
  d = Math.max(d, hem - y);
  // shoulders, the hump of the stoop, a collar
  d = smin(d, capsule(p, -0.34, 2.2, 0.2, 0.34, 2.2, 0.2, 0.12), 0.12);
  d = smin(d, ellipsoid(p, 0, 2.16, 0.0, 0.3, 0.24, 0.24), 0.14);
  d = smin(d, ellipsoid(p, 0, 2.28, 0.26, 0.19, 0.1, 0.16), 0.08);
  return d;
}
function bodySDF(p) {
  return Math.min(robeBody(p), beltD(p), book1D(p), book2D(p), chainD(p), keysD(p));
}
function bodyCol(p) {
  const [x, y, z] = p;
  const r = robeBody(p);
  const hit = (d) => d < 0.004 && d <= r + 0.002;
  if (hit(book1D(p))) return Math.abs(y - 1.06) > 0.09 ? BRASS : [0.34, 0.07, 0.05];
  if (hit(book2D(p))) return Math.abs(y - 0.86) > 0.07 ? BRASS : [0.08, 0.2, 0.12];
  if (hit(chainD(p))) return [0.36, 0.33, 0.28];
  if (hit(keysD(p))) return BRASS;
  if (hit(beltD(p))) return BELT;
  const f = 1 + 0.18 * Math.sin(Math.atan2(x, z - robeZ(y)) * 9 + y * 1.4) + (noise3(x * 9, y * 9, z * 9) - 0.5) * 0.12;
  // grime toward the hem
  const g = smooth(0.7, 0.0, y);
  return [ROBE[0] * f + g * 0.05, ROBE[1] * f + g * 0.035, ROBE[2] * f + g * 0.02];
}

// head, about the top of the neck (it hangs forward from there)
function headSDF(p) {
  const [x, y, z] = p;
  let face = ellipsoid(p, 0, 0.3, 0.24, 0.125, 0.2, 0.14);
  face = smin(face, ellipsoid(p, 0, 0.15, 0.27, 0.07, 0.09, 0.08), 0.06);
  face = smin(face, capsule(p, 0, 0.35, 0.36, 0, 0.26, 0.4, 0.02, 0.016), 0.03);
  face = smax(face, -sphere(p, 0.052, 0.345, 0.355, 0.043), 0.02);
  face = smax(face, -sphere(p, -0.052, 0.345, 0.355, 0.043), 0.02);
  face = smax(face, -box(p, 0, 0.19, 0.38, 0.04, 0.005, 0.06), 0.01);
  let d = smin(face, capsule(p, 0, -0.02, 0, 0, 0.2, 0.15, 0.06, 0.055), 0.05);
  // the hood: a deep shell open at the front, drawn up to a point behind
  let shell = Math.max(ellipsoid(p, 0, 0.33, 0.17, 0.22, 0.3, 0.27), -ellipsoid(p, 0, 0.31, 0.23, 0.175, 0.255, 0.26));
  shell = smin(shell, capsule(p, 0, 0.52, 0.06, 0, 0.66, -0.12, 0.08, 0.02), 0.07);
  shell = Math.max(shell, z - 0.3 + 0.12 * Math.max(0, 0.34 - y));
  shell = Math.max(shell, -(y + 0.06));
  d = Math.min(d, shell);
  // wire spectacles over the empty sockets
  d = Math.min(d, ringXY(p, 0.054, 0.345, 0.405, 0.042, 0.0075), ringXY(p, -0.054, 0.345, 0.405, 0.042, 0.0075));
  d = Math.min(d, capsule(p, -0.014, 0.35, 0.405, 0.014, 0.35, 0.405, 0.006));
  d = Math.min(d, capsule(p, 0.095, 0.35, 0.4, 0.125, 0.36, 0.26, 0.006), capsule(p, -0.095, 0.35, 0.4, -0.125, 0.36, 0.26, 0.006));
  return d;
}
function headCol(p) {
  const [x, y, z] = p;
  const onRing = Math.abs(Math.hypot(Math.abs(x) - 0.054, y - 0.345) - 0.042) < 0.02 && z > 0.39;
  if (onRing || (Math.abs(y - 0.35) < 0.02 && z > 0.38 && Math.abs(x) < 0.02) || (Math.abs(x) > 0.09 && z > 0.25 && Math.abs(y - 0.355) < 0.02 && z < 0.41)) return WIRE;
  const inFace = ellipsoid(p, 0, 0.3, 0.24, 0.13, 0.205, 0.145) < 0.012 || ellipsoid(p, 0, 0.15, 0.27, 0.075, 0.095, 0.085) < 0.01;
  if (!inFace && !(y < 0.16 && Math.hypot(x, z - 0.1) < 0.08)) {
    const f = 0.95 + (noise3(x * 12, y * 12, z * 12) - 0.5) * 0.14;
    return [ROBE[0] * f, ROBE[1] * f, ROBE[2] * f];
  }
  const sock = Math.min(Math.hypot(x - 0.052, y - 0.345, z - 0.355), Math.hypot(x + 0.052, y - 0.345, z - 0.355));
  if (sock < 0.058) return [0.03, 0.02, 0.02];
  if (Math.abs(y - 0.19) < 0.012 && Math.abs(x) < 0.045 && z > 0.33) return [0.12, 0.05, 0.05];
  let k = 0.92 + (noise3(x * 20, y * 20, z * 20) - 0.5) * 0.12 - smooth(0.26, 0.1, y) * 0.1;
  const hollow = smooth(0.07, 0.11, Math.abs(x)) * smooth(0.36, 0.26, y) * 0.18; // sunken cheeks
  // the hood throws its shadow over the brow and down the sides
  k *= (0.45 + 0.55 * smooth(0.27, 0.38, z)) * (1 - 0.45 * smooth(0.36, 0.48, y));
  return [SKIN[0] * (k - hollow), SKIN[1] * (k - hollow), SKIN[2] * (k - hollow * 0.8)];
}

// upper arm: a sleeve hanging from the shoulder, widening to the elbow (along -y)
function sleeveSDF(p) {
  let d = capsule(p, 0, 0, 0, 0, -0.62, 0.04, 0.075, 0.13);
  d = smax(d, p[1] - 0.06, 0.04);
  return d;
}
function sleeveCol(p) {
  const f = 0.95 + Math.sin(Math.atan2(p[0], p[2]) * 7 + p[1] * 3) * 0.12;
  return [ROBE_HI[0] * f * 0.8, ROBE_HI[1] * f * 0.8, ROBE_HI[2] * f * 0.8];
}
// forearm, hand and five long fingers (along -y from the elbow)
function forearmSDF(p) {
  let d = capsule(p, 0, 0, 0, 0, -0.5, 0.0, 0.04, 0.03);
  const cuff = capsule(p, 0, 0.04, 0, 0, -0.16, 0.01, 0.12, 0.09);
  d = Math.min(d, Math.max(cuff, -capsule(p, 0, 0.2, 0, 0, -0.3, 0.01, 0.08, 0.06)));
  d = smin(d, ellipsoid(p, 0, -0.6, 0.0, 0.05, 0.075, 0.024), 0.03);
  for (let i = 0; i < 4; i++) {
    const x = -0.033 + i * 0.022, len = 0.2 + (i === 1 || i === 2 ? 0.04 : 0);
    const kx = x * 1.2, ky = -0.66 - len * 0.62, kz = 0.03;
    d = Math.min(d, capsule(p, x, -0.64, 0.005, kx, ky, kz, 0.011, 0.009));
    d = Math.min(d, capsule(p, kx, ky, kz, kx * 1.1, ky - len * 0.38, 0.08, 0.009, 0.005));
  }
  d = Math.min(d, capsule(p, 0.045, -0.58, 0.01, 0.07, -0.7, 0.07, 0.012, 0.008));
  return d;
}
function forearmCol(p) {
  if (p[1] > -0.2 && Math.hypot(p[0], p[2]) > 0.05) return sleeveCol(p);
  const k = 0.9 + (noise3(p[0] * 30, p[1] * 30, p[2] * 30) - 0.5) * 0.15;
  const knuckle = p[1] < -0.62 ? 0.9 : 1;
  return [SKIN_DK[0] * k * knuckle * 1.25, SKIN_DK[1] * k * knuckle * 1.25, SKIN_DK[2] * k * knuckle * 1.2];
}

function lanternGeos() {
  const G = new GeoBuilder(), L = new GeoBuilder(), F = new GeoBuilder();
  const w = 0.075, y0 = -0.36, y1 = -0.14, ym = (y0 + y1) / 2;
  const DK = [0.22, 0.17, 0.1];
  G.box(-w - 0.02, y0 - 0.035, -w - 0.02, w + 0.02, y0, w + 0.02, DK);
  G.box(-w - 0.012, y0 - 0.05, -w - 0.012, w + 0.012, y0 - 0.035, w + 0.012, BRASS);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) G.box(sx * w - 0.011, y0, sz * w - 0.011, sx * w + 0.011, y1, sz * w + 0.011, DK);
  for (const [a, b] of [[-1, 0], [1, 0]]) {
    G.box(-w, ym - 0.006, a * w - 0.008, w, ym + 0.006, a * w + 0.008, DK);
    G.box(a * w - 0.008, ym - 0.006, -w, a * w + 0.008, ym + 0.006, w, DK);
    void b;
  }
  G.box(-w - 0.022, y1, -w - 0.022, w + 0.022, y1 + 0.022, w + 0.022, DK);
  G.box(-w * 0.72, y1 + 0.022, -w * 0.72, w * 0.72, y1 + 0.05, w * 0.72, BRASS);
  G.box(-w * 0.35, y1 + 0.05, -w * 0.35, w * 0.35, y1 + 0.075, w * 0.35, DK);
  G.box(-0.008, y1 + 0.075, -0.03, 0.008, y1 + 0.12, 0.03, BRASS);
  G.beam([0, y1 + 0.11, 0], [0, 0.02, 0], 0.01, [0.3, 0.26, 0.2]);
  // the glass, lit from within (amber, darker toward its edges), and the flame
  const gl = [0.95, 0.52, 0.18], ge = [0.55, 0.25, 0.08];
  L.box(-w + 0.004, y0 + 0.004, -w + 0.004, w - 0.004, y1 - 0.004, w - 0.004, gl, { cols: { py: ge, ny: ge }, strips: [[0, 0.15, ge], [0.15, 0.85, gl], [0.85, 1, ge]] });
  F.box(-0.016, y0 + 0.004, -0.016, 0.016, y0 + 0.06, 0.016, [0.85, 0.8, 0.7]);
  F.box(-0.012, y0 + 0.06, -0.012, 0.012, y0 + 0.12, 0.012, [2.2, 1.5, 0.6]);
  F.box(-0.006, y0 + 0.12, -0.006, 0.006, y0 + 0.15, 0.006, [2.6, 2.0, 1.0]);
  return { frame: G.build(), glass: L.build(), flame: F.build() };
}

function tomeGeo() {
  const G = new GeoBuilder();
  G.box(-0.13, -0.17, -0.05, 0.13, 0.17, 0.05, [0.28, 0.07, 0.05], {
    cols: { px: [0.7, 0.64, 0.5], nx: [0.3, 0.08, 0.05] },
    strips: [[0, 0.1, [0.28, 0.07, 0.05]], [0.1, 0.13, BRASS], [0.13, 0.87, [0.3, 0.075, 0.055]], [0.87, 0.9, BRASS], [0.9, 1, [0.28, 0.07, 0.05]]],
  });
  return G.build();
}

function build() {
  if (parts) return parts;
  parts = {
    body: voxelize({ sdf: bodySDF, color: bodyCol, min: [-0.62, 0, -0.5], max: [0.62, 2.45, 0.62], step: STEP }),
    head: voxelize({ sdf: headSDF, color: headCol, min: [-0.26, -0.1, -0.22], max: [0.26, 0.72, 0.46], step: STEP * 0.62 }),
    sleeve: voxelize({ sdf: sleeveSDF, color: sleeveCol, min: [-0.16, -0.78, -0.16], max: [0.16, 0.1, 0.2], step: STEP * 0.8 }),
    forearm: voxelize({ sdf: forearmSDF, color: forearmCol, min: [-0.14, -0.95, -0.14], max: [0.14, 0.1, 0.16], step: STEP * 0.42 }),
    ...lanternGeos(),
    tome: tomeGeo(),
  };
  return parts;
}

// the figure faces +z; userData holds the joints and the lantern's light point
// build the shapes ahead of time (they take a moment)
export function warmLibrarian() { build(); }

export function buildLibrarian() {
  const P = build();
  const mat = propLitMaterial(0.5);
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  body.add(new THREE.Mesh(P.body, mat));
  const neck = new THREE.Group(); neck.position.set(0, 2.26, 0.3); body.add(neck);
  const head = new THREE.Group(); neck.add(head);
  head.add(new THREE.Mesh(P.head, mat));
  // two sparks deep in the sockets, lit only when it has seen you
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const eyes = new THREE.Group();
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.014, 0.01), eyeMat); e.position.set(s * 0.052, 0.345, 0.37); eyes.add(e); }
  eyes.visible = false;
  head.add(eyes);
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.4, 2.2, 0.2); body.add(sh);
    sh.add(new THREE.Mesh(P.sleeve, mat));
    const el = new THREE.Group(); el.position.set(0, -0.62, 0.04); sh.add(el);
    el.add(new THREE.Mesh(P.forearm, mat));
    const hand = new THREE.Group(); hand.position.set(0, -0.62, 0.02); el.add(hand);
    arms.push({ sh, el, hand, side: s });
  }
  // the lantern hangs from the right hand, the tome sits in the left
  const R = arms[1], Lh = arms[0];
  const lantern = new THREE.Group(); lantern.position.set(0, -0.06, 0.03); R.hand.add(lantern);
  lantern.add(new THREE.Mesh(P.frame, mat));
  const glass = new THREE.Mesh(P.glass, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false })); lantern.add(glass);
  const flame = new THREE.Mesh(P.flame, glow); lantern.add(flame);
  const lightPt = new THREE.Object3D(); lightPt.position.set(0, -0.26, 0); lantern.add(lightPt);
  const tome = new THREE.Mesh(P.tome, mat); tome.position.set(0.02, -0.06, 0.06); tome.rotation.set(0.2, 0.3, 0.1); Lh.hand.add(tome);
  root.userData = { body, neck, head, eyes, arms, lantern, glass, flame, lightPt, tome, mat, glowMat: glow, swing: new THREE.Vector2(), swingV: new THREE.Vector2() };
  root.scale.setScalar(1.0);
  return root;
}

// pose the figure: s = state ('wander'|'shelve'|'listen'|'investigate'|'search'|'hunt'), t = time,
// moving = speed 0..1, a = a per-state clock
export function poseLibrarian(m, dt, t, s, moving, a) {
  const u = m.userData, [L, R] = u.arms;
  const k = Math.min(1, dt * 5);
  const lerp = (o, key, v) => { o[key] += (v - o[key]) * k; };
  // gliding: a slow rise and fall, a slight roll
  u.body.position.y = Math.sin(t * 2.6) * 0.035 * moving;
  u.body.rotation.z = Math.sin(t * 1.3) * 0.03 * moving;
  lerp(u.body.rotation, 'x', s === 'hunt' ? 0.16 : s === 'search' ? -0.04 : 0.05);
  // the lantern arm: held out, raised to search, thrust forward to hunt
  const lr = s === 'search' ? -1.25 : s === 'hunt' ? -0.95 : s === 'listen' ? -0.7 : -0.55;
  lerp(R.sh.rotation, 'x', lr + Math.sin(t * 1.3) * 0.04 * moving);
  lerp(R.sh.rotation, 'z', 0.12);
  lerp(R.el.rotation, 'x', s === 'search' ? -0.3 : -0.55);
  // the other arm: the tome against its chest, reaching up to a shelf, or reaching for you
  let ls = -0.35, le = -1.45, lz = -0.25;
  if (s === 'shelve') { const q = Math.sin(Math.min(1, a / 1.2) * Math.PI); ls = -0.35 - q * 1.9; le = -1.45 + q * 1.2; lz = -0.1; }
  if (s === 'hunt') { ls = -1.35 + Math.sin(t * 3) * 0.08; le = -0.25; lz = -0.05; }
  lerp(L.sh.rotation, 'x', ls); lerp(L.el.rotation, 'x', le); lerp(L.sh.rotation, 'z', lz);
  u.tome.visible = s !== 'hunt';
  // the head: cocked to listen, turning to search, hung forward otherwise
  const hy = s === 'search' ? Math.sin(a * 0.9) * 0.95 : s === 'listen' ? 0.25 : Math.sin(t * 0.4) * 0.2;
  const hz = s === 'listen' ? 0.42 : s === 'search' ? Math.sin(a * 0.9 + 1) * 0.12 : 0.05;
  lerp(u.neck.rotation, 'y', hy); lerp(u.neck.rotation, 'z', hz);
  lerp(u.neck.rotation, 'x', s === 'hunt' ? -0.15 : s === 'listen' ? 0.05 : 0.22);
  u.eyes.visible = s === 'hunt';
  // the lantern swings on its ring
  const sw = u.swing, sv = u.swingV;
  sv.x += (-sw.x * 26 - sv.x * 1.6 + (moving > 0.2 ? Math.sin(t * 2.6) * 1.4 : 0)) * dt;
  sv.y += (-sw.y * 26 - sv.y * 1.6 + (moving > 0.2 ? Math.cos(t * 1.3) * 0.8 : 0)) * dt;
  sw.x += sv.x * dt; sw.y += sv.y * dt;
  // hang straight down whatever the arm is doing
  u.lantern.rotation.x = -(R.sh.rotation.x + R.el.rotation.x + u.body.rotation.x) + sw.x;
  u.lantern.rotation.z = -R.sh.rotation.z + sw.y;
  const fl = 0.85 + Math.sin(t * 17) * 0.06 + Math.sin(t * 29.3) * 0.05;
  u.flame.scale.set(1, fl, 1);
  u.glowMat.color.setScalar(0.8 + fl * 0.2);
  return fl;
}
