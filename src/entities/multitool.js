// The first-person multi-tool: a machined receiver with a coil barrel, an energy cell,
// heat-sink fins and a small tracker display. Rendered in its own overlay pass.
import * as THREE from 'three';

function phong(color, extra = {}) {
  return new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 70, specular: 0x6a6f7a, ...extra });
}

function extrudeProfile(points, depth, bevel = 0.008) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 });
  // profile is drawn in (z, y); extrude along x, centred
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2); // shape x -> model z, extrusion -> model x
  return g;
}

export function buildMultitool() {
  const root = new THREE.Group();
  const g = new THREE.Group();
  const SC = 0.6;
  g.scale.setScalar(SC);
  root.add(g);
  const metal = phong(0x3b404b);
  const plate = phong(0xd9dde4, { shininess: 40 });
  const rubber = phong(0x1b1d22, { shininess: 8, specular: 0x222222 });
  const brass = phong(0xb8864a, { shininess: 90, specular: 0xffe0b0 });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x6ff3ff });
  const coilMat = new THREE.MeshPhongMaterial({ color: 0x223036, emissive: 0x6ff3ff, emissiveIntensity: 0.6, flatShading: true, shininess: 30 });
  const finMat = new THREE.MeshPhongMaterial({ color: 0x4a4f59, emissive: 0x000000, flatShading: true, shininess: 50 });
  const glass = new THREE.MeshPhongMaterial({ color: 0xbfefff, transparent: true, opacity: 0.32, shininess: 120, specular: 0xffffff, depthWrite: false });

  // receiver: a machined side profile (z forward is negative)
  const receiver = new THREE.Mesh(extrudeProfile([
    [0.24, -0.03], [0.24, 0.05], [0.18, 0.085], [0.02, 0.09], [-0.12, 0.075], [-0.2, 0.04], [-0.22, -0.02], [-0.16, -0.05], [0.12, -0.05],
  ], 0.085), metal);
  g.add(receiver);
  // armour plates on both sides
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(extrudeProfile([[0.17, -0.025], [0.17, 0.05], [0.0, 0.068], [-0.1, 0.05], [-0.1, -0.025]], 0.012, 0.005), plate);
    p.position.x = s * 0.05;
    g.add(p);
    // panel line accents
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.006, 0.2), glowMat);
    line.position.set(s * 0.058, 0.018, 0.04);
    g.add(line);
  }
  // top spine with heat-sink fins
  const fins = [];
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.01), finMat);
    f.position.set(0, 0.1, 0.13 - i * 0.03);
    g.add(f);
    fins.push(f);
  }
  // barrel with spinning coils
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.3, 10), metal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.3);
  g.add(barrel);
  const coils = new THREE.Group();
  coils.position.set(0, 0.012, -0.29);
  g.add(coils);
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.011, 5, 12), coilMat);
    c.position.z = -0.05 + i * 0.055;
    coils.add(c);
    // coil struts, so the spin reads
    for (let k = 0; k < 3; k++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.022, 0.03), brass);
      const a = k / 3 * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.045, Math.sin(a) * 0.045, c.position.z);
      s.rotation.z = a;
      coils.add(s);
    }
  }
  // shroud over the barrel
  const shroud = new THREE.Mesh(extrudeProfile([[-0.18, 0.045], [-0.18, 0.07], [-0.4, 0.06], [-0.44, 0.045]], 0.05, 0.004), plate);
  g.add(shroud);
  // three-prong emitter and glowing core
  const emitter = new THREE.Group();
  emitter.position.set(0, 0.012, -0.47);
  g.add(emitter);
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * Math.PI * 2 + Math.PI / 2;
    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.07), metal);
    prong.position.set(Math.cos(a) * 0.036, Math.sin(a) * 0.036, -0.01);
    prong.rotation.set(Math.sin(a) * 0.35, -Math.cos(a) * 0.35, 0);
    emitter.add(prong);
  }
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.02, 0), glowMat);
  emitter.add(core);
  // energy cell on the left: glass capsule with a spinning crystal
  const cell = new THREE.Group();
  cell.position.set(-0.07, 0.03, 0.02);
  g.add(cell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.13, 10), glass);
  cap.rotation.x = Math.PI / 2;
  cell.add(cap);
  for (const z of [-0.07, 0.07]) {
    const endc = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.014, 10), brass);
    endc.rotation.x = Math.PI / 2; endc.position.z = z;
    cell.add(endc);
  }
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.018, 0), glowMat);
  crystal.scale.set(1, 1, 2.6);
  cell.add(crystal);
  // grip, trigger and guard
  const grip = new THREE.Mesh(extrudeProfile([[0.16, -0.04], [0.2, -0.2], [0.14, -0.23], [0.08, -0.2], [0.08, -0.04]], 0.07, 0.01), rubber);
  g.add(grip);
  const guard = new THREE.Mesh(extrudeProfile([[0.08, -0.05], [0.07, -0.1], [-0.03, -0.1], [-0.04, -0.05], [-0.025, -0.05], [-0.018, -0.088], [0.058, -0.088], [0.065, -0.05]], 0.02, 0.003), metal);
  g.add(guard);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.035, 0.012), brass);
  trigger.position.set(0, -0.068, 0.03);
  g.add(trigger);
  // rear tracker display, tilted toward the eye
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 72;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  // mounted on the left flank, where the eye falls
  const mount = new THREE.Group();
  mount.position.set(-0.066, 0.028, 0.15);
  mount.rotation.set(0, -Math.PI / 2, 0);
  mount.rotateX(-0.28);
  g.add(mount);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.118, 0.07, 0.012), rubber);
  mount.add(bezel);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.104, 0.0585), new THREE.MeshBasicMaterial({ map: tex }));
  screen.position.z = 0.0065;
  mount.add(screen);
  // muzzle anchor used for beams and bolts
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012 * SC, -0.5 * SC);
  root.add(muzzle);

  root.userData = {
    muzzle, crystal, tip: core, glowMat, coils, coilMat, fins, finMat, core, screenCtx: canvas.getContext('2d'), screenTex: tex,
    spin: 0, drawT: 0, sweep: 0,
  };
  return root;
}

// Per-frame animation. s: { mode, color (int), heat, overheated, active, time, blips, dread, ping }
const MODE_NAMES = ['MINE', 'BUILD', 'BOLT'];
const _col = new THREE.Color();
export function animateMultitool(tool, dt, s) {
  const U = tool.userData;
  _col.set(s.color);
  U.glowMat.color.copy(_col);
  U.coilMat.emissive.copy(_col);
  U.coilMat.emissiveIntensity = 0.35 + (s.active ? 0.9 : 0.2) + Math.sin(s.time * 3) * 0.08;
  U.spin += dt * (s.active ? 22 : 1.2);
  U.coils.rotation.z = U.spin;
  U.crystal.rotation.z += dt * (s.active ? 6 : 0.8);
  U.crystal.scale.x = U.crystal.scale.y = 1 + Math.sin(s.time * 4) * 0.1 + (s.active ? 0.25 : 0);
  U.core.scale.setScalar(s.active ? 1.2 + Math.random() * 0.5 : 0.9 + Math.sin(s.time * 2) * 0.1);
  const h = Math.min(1, s.heat);
  U.finMat.emissive.setRGB(h * 1.0, h * 0.35, h * 0.08);
  U.drawT -= dt;
  U.sweep += dt * 2.4;
  if (U.drawT <= 0) { U.drawT = 1 / 12; drawScreen(U, s); }
}

function drawScreen(U, s) {
  const c = U.screenCtx, W = 128, H = 72;
  c.fillStyle = '#04070a';
  c.fillRect(0, 0, W, H);
  const hex = '#' + _col.getHexString();
  // radar
  const cx = 36, cy = 38, r = 30;
  c.strokeStyle = 'rgba(120,200,220,0.35)';
  c.lineWidth = 1;
  for (const k of [1, 0.66, 0.33]) { c.beginPath(); c.arc(cx, cy, r * k, 0, Math.PI * 2); c.stroke(); }
  c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.stroke();
  // sweep
  const sw = U.sweep % (Math.PI * 2);
  const grad = c.createLinearGradient(cx, cy, cx + Math.sin(sw) * r, cy - Math.cos(sw) * r);
  grad.addColorStop(0, 'rgba(120,255,230,0)'); grad.addColorStop(1, 'rgba(120,255,230,0.5)');
  c.strokeStyle = grad; c.lineWidth = 2;
  c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.sin(sw) * r, cy - Math.cos(sw) * r); c.stroke();
  // blips: forward is up
  for (const b of s.blips || []) {
    const x = cx + Math.sin(b.a) * b.d * r, y = cy - Math.cos(b.a) * b.d * r;
    const big = b.kind === 'walker';
    const flick = 0.55 + 0.45 * Math.sin(s.time * (b.kind === 'hollow' ? 17 : 6) + b.a * 5);
    c.fillStyle = b.kind === 'hollow' ? `rgba(255,70,60,${flick})` : big ? `rgba(255,220,200,${0.35 * flick})` : `rgba(240,240,220,${flick})`;
    c.beginPath(); c.arc(x, y, big ? 5 : 2.2, 0, Math.PI * 2); c.fill();
  }
  // self
  c.fillStyle = hex; c.fillRect(cx - 1.5, cy - 1.5, 3, 3);
  // right panel: mode, heat, signal
  c.fillStyle = hex;
  c.font = 'bold 12px monospace';
  c.fillText(MODE_NAMES[s.mode] || '', 74, 16);
  c.fillStyle = 'rgba(255,255,255,0.15)'; c.fillRect(74, 22, 48, 5);
  c.fillStyle = s.overheated ? '#ff5030' : hex; c.fillRect(74, 22, 48 * Math.min(1, s.heat), 5);
  // signal: a waveform that grows ragged with dread
  c.strokeStyle = s.dread > 0.5 ? 'rgba(255,90,80,0.9)' : 'rgba(150,255,220,0.8)';
  c.lineWidth = 1;
  c.beginPath();
  for (let x = 0; x <= 48; x++) {
    const t = s.time * 6 + x * 0.35;
    const y = 50 + Math.sin(t) * (2 + s.dread * 6) + (Math.random() - 0.5) * s.dread * 10 + (s.ping > 0.5 && x > 20 && x < 28 ? -8 * Math.sin((x - 20) / 8 * Math.PI) : 0);
    if (x === 0) c.moveTo(74 + x, y); else c.lineTo(74 + x, y);
  }
  c.stroke();
  c.fillStyle = 'rgba(200,230,240,0.5)';
  c.font = '8px monospace';
  c.fillText(s.blips && s.blips.some((b) => b.kind !== 'walker' && b.d < 0.5) ? 'CONTACT' : 'SCAN', 74, 67);
  U.screenTex.needsUpdate = true;
}
