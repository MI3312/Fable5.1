// Interactive 3D galaxy map drawn on a 2D canvas: nearby stars, warp range, route to the Dream Core.
import { h, clear } from './dom.js';
import { CORE } from '../universe/universe.js';

export class GalaxyMap {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.el = null;
    this.yaw = 0.6;
    this.pitch = 0.55;
    this.zoom = 1;
    this.sel = null;
    this.drag = null;
  }

  isOpen() { return !!this.el; }

  open() {
    const g = this.game;
    const cur = g.state.system;
    this.center = g.universe.mapPosition(cur.gx, cur.gy, cur.gz);
    this.sel = null;
    this.canvas = h('canvas', {});
    this.panel = h('div', { class: 'gpanel interactive' });
    this.el = h('div', { class: 'galaxy interactive' }, this.canvas,
      h('div', { class: 'ghead' }, h('div', { class: 't' }, 'GALAXY MAP'), h('div', { class: 's' }, `Current: ${g.system.name} · Core distance ${g.coreDistanceLabel()}`)),
      this.panel,
      h('div', { class: 'gfoot' }, 'Drag to rotate · Wheel to zoom · Click a star to select · M / Esc to close'));
    this.root.appendChild(this.el);
    this.canvas.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
    window.addEventListener('mousemove', this._mm = (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      this.yaw += dx * 0.006; this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dy * 0.006));
      this.drag.x = e.clientX; this.drag.y = e.clientY;
    });
    window.addEventListener('mouseup', this._mu = (e) => {
      if (this.drag && this.drag.moved < 6) this._click(e.clientX, e.clientY);
      this.drag = null;
    });
    this.canvas.addEventListener('wheel', (e) => { this.zoom = Math.max(0.4, Math.min(3, this.zoom * (e.deltaY > 0 ? 0.9 : 1.1))); e.preventDefault(); }, { passive: false });
    this.stars = g.universe.neighbors(cur.gx, cur.gy, cur.gz, 9).map((s) => ({ ...s, p: g.universe.mapPosition(s.gx, s.gy, s.gz), sys: g.universe.getSystem(s.gx, s.gy, s.gz) }));
    this.renderPanel();
  }

  close() {
    if (!this.el) return;
    window.removeEventListener('mousemove', this._mm);
    window.removeEventListener('mouseup', this._mu);
    this.el.remove();
    this.el = null;
  }

  _project(p, W, H) {
    const c = this.center;
    let x = p[0] - c[0], y = p[1] - c[1], z = p[2] - c[2];
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    [x, z] = [x * cy - z * sy, x * sy + z * cy];
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    [y, z] = [y * cp - z * sp, y * sp + z * cp];
    const dist = 22 / this.zoom;
    const f = Math.min(W, H) * 0.9;
    const s = f / (z + dist);
    return { x: W / 2 + x * s, y: H / 2 - y * s, s, z };
  }

  _click(mx, my) {
    const r = this.canvas.getBoundingClientRect();
    const x = mx - r.left, y = my - r.top;
    let best = null, bd = 18;
    for (const s of this.stars) {
      if (!s.scr) continue;
      const d = Math.hypot(s.scr.x - x, s.scr.y - y);
      if (d < bd) { bd = d; best = s; }
    }
    if (best) { this.sel = best; this.game.audio.ui(); this.renderPanel(); }
  }

  renderPanel() {
    const g = this.game;
    const p = clear(this.panel);
    const cur = g.state.system;
    const s = this.sel;
    if (!s) {
      p.append(h('div', { class: 'dn' }, g.system.name), h('div', { class: 'dc' }, `${g.system.star.label} star · ${g.system.planets.length} planets`),
        h('div', { class: 'muted' }, `Hyperdrive range ${g.hyperdriveRange() * 100} ly`),
        h('div', { class: 'muted' }, `Warp cells: ${g.inventory.count('warp_cell')} · Lucid cores: ${g.inventory.count('lucid_core')}`),
        h('div', { class: 'lore' }, 'The Dream Core glows at the heart of the galaxy. Every jump toward it, the stars grow softer.'));
      return;
    }
    const sys = s.sys;
    const dist = Math.hypot(s.gx - cur.gx, s.gy - cur.gy, s.gz - cur.gz);
    const visited = !!g.state.discoveries.systems[sys.key];
    const inRange = dist <= g.hyperdriveRange() + 0.01;
    const isCur = s.gx === cur.gx && s.gy === cur.gy && s.gz === cur.gz;
    p.append(
      h('div', { class: 'dc' }, isCur ? 'Current system' : visited ? 'Visited' : 'Unexplored'),
      h('div', { class: 'dn' }, sys.name),
      h('div', { class: 'list-row' }, h('span', {}, 'Star'), h('span', { class: 'muted' }, `${sys.star.label} (${sys.star.cls})`)),
      h('div', { class: 'list-row' }, h('span', {}, 'Distance'), h('span', { class: 'muted' }, `${Math.round(dist * 100)} ly`)),
      h('div', { class: 'list-row' }, h('span', {}, 'Planets'), h('span', { class: 'muted' }, String(sys.planets.length))),
      h('div', { class: 'list-row' }, h('span', {}, 'Economy'), h('span', { class: 'muted' }, sys.economy)),
      h('div', { class: 'list-row' }, h('span', {}, 'Conflict'), h('span', { class: 'muted' }, sys.conflict)),
      h('div', { class: 'list-row' }, h('span', {}, 'To Dream Core'), h('span', { class: 'muted' }, `${Math.round(g.universe.distanceToCore(s.gx, s.gy, s.gz) * 100)} ly`)),
    );
    if (visited) for (const pl of sys.planets) p.appendChild(h('div', { class: 'list-row' }, h('span', {}, pl.name), h('span', { class: 'muted' }, pl.biomeLabel)));
    if (!isCur) {
      const canWarp = g.mode === 'space' && inRange && (g.inventory.count('warp_cell') > 0 || g.inventory.count('lucid_core') > 0);
      let why = '';
      if (g.mode !== 'space') why = 'Warp is only possible from space.';
      else if (!inRange) why = 'Out of hyperdrive range.';
      else if (!canWarp) why = 'Requires a Warp Cell (or a Lucid Core).';
      p.appendChild(h('button', { class: 'btn primary center', disabled: canWarp ? null : true, onclick: () => { this.close(); g.startWarp(s.gx, s.gy, s.gz); } }, 'Initiate warp'));
      if (why) p.appendChild(h('div', { class: 'muted' }, why));
    }
  }

  draw() {
    if (!this.el) return;
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#03020a';
    ctx.fillRect(0, 0, W, H);
    const g = this.game;
    const t = performance.now() / 1000;
    const cur = g.state.system;
    // background dust
    ctx.fillStyle = 'rgba(180,160,255,0.05)';
    for (let i = 0; i < 120; i++) {
      const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * W, y = (Math.cos(i * 57.3) * 0.5 + 0.5) * H;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    // warp range ring
    const center = this._project(this.center, W, H);
    ctx.strokeStyle = 'rgba(126,240,255,0.25)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    const rr = g.hyperdriveRange() * center.s;
    ctx.ellipse(center.x, center.y, rr, rr * Math.abs(Math.sin(this.pitch)) + 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    // core direction
    const corePos = g.universe.mapPosition(CORE.gx, CORE.gy, CORE.gz);
    const cp = this._project(corePos, W, H);
    ctx.strokeStyle = 'rgba(255,182,236,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    let ex = cp.x, ey = cp.y;
    if (cp.z < -20 / this.zoom || ex < 0 || ey < 0 || ex > W || ey > H) {
      const dx = cp.x - center.x, dy = cp.y - center.y;
      const L = Math.hypot(dx, dy) || 1;
      ex = center.x + dx / L * Math.min(W, H) * 0.42; ey = center.y + dy / L * Math.min(W, H) * 0.42;
    }
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.fillStyle = '#ffb6ec';
    ctx.font = '600 13px Rajdhani, sans-serif';
    ctx.fillText('◆ DREAM CORE', ex + 8, ey + 4);
    // stars sorted back to front
    const list = this.stars.map((s) => ({ s, pr: this._project(s.p, W, H) })).sort((a, b) => b.pr.z - a.pr.z);
    for (const { s, pr } of list) {
      s.scr = null;
      if (pr.z < -20 / this.zoom + 0.5) continue;
      s.scr = pr;
      const col = s.sys.star.color;
      const rgb = `${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)}`;
      const size = Math.max(1.5, pr.s * 0.09);
      const grd = ctx.createRadialGradient(pr.x, pr.y, 0, pr.x, pr.y, size * 4);
      grd.addColorStop(0, `rgba(${rgb},0.9)`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, size * 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${rgb})`;
      ctx.beginPath(); ctx.arc(pr.x, pr.y, size, 0, Math.PI * 2); ctx.fill();
      const isCur = s.gx === cur.gx && s.gy === cur.gy && s.gz === cur.gz;
      const visited = !!g.state.discoveries.systems[s.sys.key];
      if (visited || isCur) {
        ctx.strokeStyle = isCur ? '#ff9f5a' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(pr.x, pr.y, size + 5 + (isCur ? Math.sin(t * 3) * 2 : 0), 0, Math.PI * 2); ctx.stroke();
      }
      if (this.sel === s) {
        ctx.strokeStyle = '#7ef0ff';
        ctx.lineWidth = 2;
        ctx.strokeRect(pr.x - size - 9, pr.y - size - 9, (size + 9) * 2, (size + 9) * 2);
        ctx.beginPath(); ctx.moveTo(center.x, center.y); ctx.lineTo(pr.x, pr.y); ctx.stroke();
      }
      if (pr.s > 30 || this.sel === s || isCur) {
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '500 12px Rajdhani, sans-serif';
        ctx.fillText(s.sys.name, pr.x + size + 6, pr.y - size - 2);
      }
    }
  }
}
