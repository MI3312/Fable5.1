// In-game heads-up display: vitals, compass, markers, notifications, ship gauges.
import * as THREE from 'three';
import { h, clear } from './dom.js';
import { ITEMS } from '../data/items.js';
import { BLOCKS } from '../world/blocks.js';
import { getBlockIcon } from '../world/atlas.js';

const HAZARD_ICON = { heat: '🔥', cold: '❄', toxic: '☣', radiation: '☢', vacuum: '◌', none: '✦' };
const _v = new THREE.Vector3();

function bar(color, segmented = true) {
  const fill = h('i', { style: { background: color } });
  const b = h('div', { class: 'bar' + (segmented ? ' segmented' : '') }, fill);
  b.fill = fill;
  return b;
}

export class HUD {
  constructor(root) {
    this.root = h('div', { id: 'hud', class: 'hidden' });
    root.appendChild(this.root);
    this.cache = {};
    this._build();
    this.notes = [];
  }

  _build() {
    const R = this.root;
    this.markersEl = h('div', { class: 'markers' });
    R.appendChild(this.markersEl);
    this.visorFrame = h('div', { class: 'visor-frame hidden' });
    R.appendChild(this.visorFrame);
    this.crosshair = h('div', { class: 'crosshair' });
    R.appendChild(this.crosshair);
    // progress ring
    const svgNS = 'http://www.w3.org/2000/svg';
    this.ring = document.createElementNS(svgNS, 'svg');
    this.ring.setAttribute('class', 'progress-ring');
    this.ring.setAttribute('viewBox', '0 0 54 54');
    const bg = document.createElementNS(svgNS, 'circle');
    bg.setAttribute('cx', '27'); bg.setAttribute('cy', '27'); bg.setAttribute('r', '22');
    bg.setAttribute('stroke', 'rgba(255,255,255,0.15)');
    this.ringFg = document.createElementNS(svgNS, 'circle');
    this.ringFg.setAttribute('cx', '27'); this.ringFg.setAttribute('cy', '27'); this.ringFg.setAttribute('r', '22');
    this.ringFg.setAttribute('stroke', '#7ef0ff');
    this.ringFg.setAttribute('stroke-dasharray', String(2 * Math.PI * 22));
    this.ring.append(bg, this.ringFg);
    this.ring.style.display = 'none';
    R.appendChild(this.ring);

    // vitals
    this.stats = {};
    const statsEl = h('div', { class: 'stats' });
    const mk = (key, icon, color) => {
      const b = bar(color);
      const iconEl = h('span', { class: 'icon' }, icon);
      const val = h('span', { class: 'val' }, '100');
      const row = h('div', { class: 'stat' }, iconEl, b, val);
      statsEl.appendChild(row);
      this.stats[key] = { row, bar: b, val, icon: iconEl };
    };
    mk('health', '♥', 'var(--health)');
    mk('shield', '⬡', 'var(--shield)');
    mk('hazard', '✦', 'var(--hazard)');
    mk('life', '❍', 'var(--life)');
    mk('jet', '⇮', 'var(--jet)');
    R.appendChild(statsEl);
    this.statsEl = statsEl;

    // location
    this.locName = h('div', { class: 'name' });
    this.locSub = h('div', { class: 'sub' });
    this.locCond = h('div', { class: 'conditions' });
    this.locationEl = h('div', { class: 'location' }, this.locName, this.locSub, this.locCond);
    R.appendChild(this.locationEl);

    // compass
    this.compassTrack = h('div', { class: 'track' });
    this.compass = h('div', { class: 'compass' }, this.compassTrack);
    R.appendChild(this.compass);
    R.appendChild(h('div', { class: 'compass-center' }));
    this.wanted = h('div', { class: 'wanted' });
    R.appendChild(this.wanted);

    // quest
    this.questTitle = h('div', { class: 'qt' });
    this.questDesc = h('div', { class: 'qd' });
    this.questProg = h('div', { class: 'qp' });
    this.questEl = h('div', { class: 'quest' }, this.questTitle, this.questDesc, this.questProg);
    R.appendChild(this.questEl);
    this.missionEl = h('div', { class: 'mission' });
    R.appendChild(this.missionEl);

    // tool
    this.toolModes = h('div', { class: 'modes' });
    this.toolName = h('div', { class: 'name' });
    this.toolHint = h('div', { class: 'hint' });
    this.toolEl = h('div', { class: 'tool' }, this.toolModes, this.toolName, this.toolHint);
    R.appendChild(this.toolEl);

    // hotbar
    this.hotbar = h('div', { class: 'hotbar' });
    this.hslots = [];
    for (let i = 0; i < 9; i++) {
      const img = h('img', { alt: '' });
      const n = h('span', { class: 'n' });
      const s = h('div', { class: 'hslot' }, h('span', { class: 'k' }, String(i + 1)), img, n);
      s.img = img; s.n = n;
      this.hotbar.appendChild(s);
      this.hslots.push(s);
    }
    R.appendChild(this.hotbar);
    this.blockName = h('div', { class: 'block-name' });
    R.appendChild(this.blockName);

    // ship hud
    this.shipSpeed = h('div', { class: 'speed' }, '0');
    this.shipGauges = {};
    const gauges = h('div', { class: 'gauges' });
    const g = (key, label, color) => {
      const b = bar(color, false);
      gauges.appendChild(h('div', { class: 'row' }, h('span', {}, label), b));
      this.shipGauges[key] = b;
    };
    g('shield', 'SHIELD', 'var(--shield)');
    g('hull', 'HULL', 'var(--health)');
    g('launch', 'LAUNCH', 'var(--accent)');
    g('pulse', 'PULSE', 'var(--jet)');
    this.shipAlt = h('div', { class: 'speed', style: { fontSize: '22px' } }, '0');
    this.shipHud = h('div', { class: 'ship-hud hidden' }, gauges, h('div', {}, this.shipSpeed, h('small', {}, 'U / SEC')), h('div', {}, this.shipAlt, h('small', {}, 'ALTITUDE')));
    R.appendChild(this.shipHud);
    this.stickDot = h('i');
    this.stick = h('div', { class: 'stick hidden' }, this.stickDot);
    R.appendChild(this.stick);
    this.pulseBar = bar('var(--jet)', false);
    this.pulseWrap = h('div', { class: 'pulse-bar hidden' }, this.pulseBar);
    R.appendChild(this.pulseWrap);

    // interact, notifications, toast, center msg
    this.interact = h('div', { class: 'interact hidden' });
    R.appendChild(this.interact);
    this.notesEl = h('div', { class: 'notifications' });
    R.appendChild(this.notesEl);
    this.toastEl = h('div');
    R.appendChild(this.toastEl);
    this.centerMsg = h('div', { class: 'center-msg' });
    R.appendChild(this.centerMsg);
    this.scanPanel = h('div', { class: 'scan-panel hidden' });
    R.appendChild(this.scanPanel);
    this.helpHint = h('div', { class: 'help-hint' });
    R.appendChild(this.helpHint);
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  // ---------------- chat ----------------
  _buildChat() {
    this.chatLog = h('div', { class: 'chat-log' });
    this.chatInput = h('input', { class: 'chat-input hidden', type: 'text', maxlength: '80', spellcheck: 'false', autocomplete: 'off' });
    this.chatEl = h('div', { class: 'chat' }, this.chatLog, this.chatInput);
    this.root.appendChild(this.chatEl);
    this.chatLines = [];
    this.chatOpen = false;
  }

  // text may contain §k...§r (scrambled) segments. kind: 'player' | 'system' | 'null' | 'you'
  chat(name, text, kind = 'player') {
    if (!this.chatLog) this._buildChat();
    const line = h('div', { class: 'chat-line ' + kind });
    if (name) line.appendChild(h('span', { class: 'who' }, kind === 'system' ? '' : `<${name}> `));
    const parts = String(text).split(/(§k[^§]*§r)/);
    for (const part of parts) {
      if (!part) continue;
      if (part.startsWith('§k')) {
        const n = part.length - 4;
        const sp = h('span', { class: 'obf' }, 'x'.repeat(Math.max(1, n)));
        sp.dataset.n = String(Math.max(1, n));
        line.appendChild(sp);
      } else line.appendChild(document.createTextNode(part));
    }
    this.chatLog.appendChild(line);
    this.chatLines.push({ el: line, t: 12 });
    while (this.chatLines.length > 14) this.chatLines.shift().el.remove();
  }

  openChat(onSend, onClose) {
    if (!this.chatLog) this._buildChat();
    this.chatOpen = true;
    this.chatEl.classList.add('open');
    const inp = this.chatInput;
    inp.classList.remove('hidden');
    inp.value = '';
    setTimeout(() => inp.focus(), 0);
    inp.onkeydown = (e) => {
      if (e.code === 'Enter') { const v = inp.value.trim(); this.closeChat(); if (v) onSend(v); onClose(); e.preventDefault(); }
      else if (e.code === 'Escape') { this.closeChat(); onClose(); e.preventDefault(); }
      e.stopPropagation();
    };
  }

  closeChat() {
    if (!this.chatLog) return;
    this.chatOpen = false;
    this.chatEl.classList.remove('open');
    this.chatInput.classList.add('hidden');
    this.chatInput.blur();
  }

  // ---------------- the interface does not behave ----------------
  glitch(t) { this.glitchT = Math.max(this.glitchT || 0, t); }

  showCrash(lines) {
    if (!this.crashEl) {
      this.crashEl = h('div', { class: 'fake-crash hidden' });
      (this.root.parentNode || document.body).appendChild(this.crashEl);
    }
    clear(this.crashEl);
    this.crashEl.appendChild(h('pre', {}, lines.join('\n')));
    this.crashEl.classList.remove('hidden');
  }

  hideCrash() { if (this.crashEl) this.crashEl.classList.add('hidden'); }

  set(el, key, text) {
    if (this.cache[key] !== text) { this.cache[key] = text; el.textContent = text; }
  }

  setBar(b, key, v) {
    const pct = Math.max(0, Math.min(100, v));
    const r = Math.round(pct * 2) / 2;
    if (this.cache[key] !== r) { this.cache[key] = r; b.fill.style.width = r + '%'; }
  }

  updateStats(stats, hazardType, onFoot) {
    for (const k of ['health', 'shield', 'hazard', 'life', 'jet']) {
      const s = this.stats[k];
      this.setBar(s.bar, 'bar_' + k, stats[k]);
      this.set(s.val, 'val_' + k, String(Math.round(stats[k])));
      const low = stats[k] < 20 && k !== 'jet';
      if (this.cache['low_' + k] !== low) { this.cache['low_' + k] = low; s.row.classList.toggle('low', low); }
    }
    this.set(this.stats.hazard.icon, 'hzicon', HAZARD_ICON[hazardType] || '✦');
    this.stats.jet.row.style.display = onFoot ? '' : 'none';
  }

  setLocation(name, sub, conds) {
    this.set(this.locName, 'locName', name);
    this.set(this.locSub, 'locSub', sub);
    const key = conds.join('|');
    if (this.cache.cond !== key) {
      this.cache.cond = key;
      clear(this.locCond);
      for (const c of conds) this.locCond.appendChild(h('span', { class: 'pill' }, c));
    }
  }

  // heading in degrees (0 = north), markers: [{bearing, icon, color}]
  updateCompass(heading, markers) {
    const W = this.compass.clientWidth || 500;
    const parts = [];
    const labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    let html = '';
    for (let a = 0; a < 360; a += 15) {
      let off = ((a - heading + 540) % 360) - 180;
      if (Math.abs(off) > 95) continue;
      const x = W / 2 + (off / 90) * (W / 2);
      if (labels[a] !== undefined) html += `<span class="tick" style="left:${x.toFixed(1)}px">${labels[a]}</span>`;
      else html += `<span class="tick minor" style="left:${x.toFixed(1)}px">|</span>`;
    }
    for (const m of markers) {
      let off = ((m.bearing - heading + 540) % 360) - 180;
      off = Math.max(-90, Math.min(90, off));
      const x = W / 2 + (off / 90) * (W / 2);
      html += `<span class="mk" style="left:${x.toFixed(1)}px;color:${m.color || '#fff'}">${m.icon}</span>`;
    }
    parts.push(html);
    if (this.cache.compass !== html) { this.cache.compass = html; this.compassTrack.innerHTML = html; }
  }

  // markers: [{pos: Vector3, icon, label, color, dist}]
  updateMarkers(camera, markers, w, hgt) {
    let html = '';
    for (const m of markers) {
      _v.copy(m.pos).project(camera);
      if (_v.z > 1) continue;
      const x = (_v.x * 0.5 + 0.5) * w, y = (-_v.y * 0.5 + 0.5) * hgt;
      if (x < -40 || y < -40 || x > w + 40 || y > hgt + 40) continue;
      const d = m.dist != null ? `<span class="d">${m.dist < 1000 ? Math.round(m.dist) + 'u' : (m.dist / 1000).toFixed(1) + 'ku'}</span>` : '';
      html += `<div class="marker" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;color:${m.color || '#fff'}"><span class="ic">${m.icon}</span>${m.label ? `<span>${m.label}</span><br>` : ''}${d}</div>`;
    }
    if (this.cache.markers !== html) { this.cache.markers = html; this.markersEl.innerHTML = html; }
  }

  setQuest(title, desc, prog) {
    this.questEl.style.display = title ? '' : 'none';
    this.set(this.questTitle, 'qt', title || '');
    this.set(this.questDesc, 'qd', desc || '');
    this.set(this.questProg, 'qp', prog || '');
  }

  setMission(text) {
    if (this.cache.mission === text) return;
    this.cache.mission = text;
    this.missionEl.textContent = text ? '◈ ' + text : '';
    this.missionEl.style.display = text ? '' : 'none';
  }

  setTool(mode, modes, hint) {
    const key = mode + '|' + hint;
    if (this.cache.tool === key) return;
    this.cache.tool = key;
    clear(this.toolModes);
    for (const m of modes) this.toolModes.appendChild(h('span', { class: m === mode ? 'on' : '' }, m));
    this.toolName.textContent = mode;
    this.toolHint.textContent = hint;
  }

  setCrosshair(kind) {
    const cls = 'crosshair' + (kind ? ' ' + kind : '');
    if (this.crosshair.className !== cls) this.crosshair.className = cls;
  }

  setProgress(v) {
    if (v == null || v <= 0) { if (this.ring.style.display !== 'none') this.ring.style.display = 'none'; return; }
    this.ring.style.display = '';
    const c = 2 * Math.PI * 22;
    this.ringFg.setAttribute('stroke-dashoffset', String(c * (1 - Math.min(1, v))));
  }

  updateHotbar(inv, selected, visible, active) {
    this.hotbar.style.display = visible ? '' : 'none';
    this.blockName.style.display = visible && active ? '' : 'none';
    if (!visible) return;
    this.hotbar.classList.toggle('dim', !active);
    for (let i = 0; i < 9; i++) {
      const id = inv.hotbar[i];
      const s = this.hslots[i];
      const count = id ? inv.blockCount(id) : 0;
      const key = `${id}:${count}:${i === selected}`;
      if (this.cache['hs' + i] === key) continue;
      this.cache['hs' + i] = key;
      s.classList.toggle('sel', i === selected);
      if (id && BLOCKS[id]) {
        s.img.src = getBlockIcon(id);
        s.img.style.visibility = 'visible';
        s.img.style.opacity = count > 0 ? '1' : '0.3';
        s.n.textContent = count > 0 ? String(count) : '';
      } else {
        s.img.style.visibility = 'hidden';
        s.n.textContent = '';
      }
    }
    const id = inv.hotbar[selected];
    this.set(this.blockName, 'bname', id && BLOCKS[id] ? BLOCKS[id].name : '');
  }

  showShip(v) {
    this.shipHud.classList.toggle('hidden', !v);
    this.stick.classList.toggle('hidden', !v);
  }

  updateShip(ship, altitude, space) {
    this.set(this.shipSpeed, 'sspeed', String(Math.round(ship.speed)));
    this.set(this.shipAlt, 'salt', space ? '—' : String(Math.round(altitude)));
    this.setBar(this.shipGauges.shield, 'sg_shield', ship.shield);
    this.setBar(this.shipGauges.hull, 'sg_hull', ship.hull);
    this.setBar(this.shipGauges.launch, 'sg_launch', ship.fuel.launch);
    this.setBar(this.shipGauges.pulse, 'sg_pulse', ship.fuel.pulse);
    const sx = ship.stick.x * 50, sy = ship.stick.y * 50;
    this.stickDot.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
    const charging = ship.pulseCharge > 0 && !ship.pulsing;
    this.pulseWrap.classList.toggle('hidden', !charging);
    if (charging) this.setBar(this.pulseBar, 'pulse', ship.pulseCharge * 100);
  }

  setPrompt(html) {
    if (!html) { if (!this.interact.classList.contains('hidden')) this.interact.classList.add('hidden'); this.cache.prompt = ''; return; }
    this.interact.classList.remove('hidden');
    if (this.cache.prompt !== html) { this.cache.prompt = html; this.interact.innerHTML = html; }
  }

  setCenter(text, color) {
    this.set(this.centerMsg, 'center', text || '');
    this.centerMsg.style.color = color || '';
  }

  setWanted(n, heat) {
    const s = n > 0 ? '★'.repeat(n) + '☆'.repeat(3 - n) : heat > 50 ? '◉' : '';
    this.set(this.wanted, 'wanted', s);
    this.wanted.style.color = n > 0 ? 'var(--bad)' : 'var(--warn)';
  }

  setHelp(text) { this.set(this.helpHint, 'help', text); }

  notify(text, itemId, n) {
    const it = itemId ? ITEMS[itemId] : null;
    let el;
    const existing = this.notes.find((x) => x.itemId && x.itemId === itemId && !x.dying);
    if (existing && it) {
      existing.n += n;
      existing.label.textContent = `+${existing.n} ${it.name}`;
      existing.t = 3.5;
      return;
    }
    const label = h('span', {}, it ? `+${n} ${it.name}` : text);
    if (it) el = h('div', { class: 'note' }, h('span', { class: 'sym', style: { background: it.color } }, it.symbol), label);
    else el = h('div', { class: 'note' }, label);
    this.notesEl.prepend(el);
    this.notes.push({ el, t: 3.5, itemId, n, label });
    if (this.notes.length > 7) {
      const old = this.notes.shift();
      old.el.remove();
    }
  }

  toast(t1, t2, color) {
    clear(this.toastEl);
    const el = h('div', { class: 'toast' }, h('div', { class: 't1', style: { color: color || '' } }, t1), h('div', { class: 'line' }), t2 ? h('div', { class: 't2' }, t2) : null);
    this.toastEl.appendChild(el);
    this.toastTimer = 4.5;
  }

  showScan(info) {
    if (!info) { this.scanPanel.classList.add('hidden'); this.cache.scan = ''; return; }
    const key = JSON.stringify(info);
    this.scanPanel.classList.remove('hidden');
    if (this.cache.scan === key) return;
    this.cache.scan = key;
    clear(this.scanPanel);
    this.scanPanel.appendChild(h('div', { class: 'h' }, info.title));
    if (info.latin) this.scanPanel.appendChild(h('div', { class: 'l' }, info.latin));
    for (const [k, v] of info.rows || []) this.scanPanel.appendChild(h('div', { class: 'row' }, h('span', {}, k), h('b', {}, v)));
  }

  setVisor(on) { this.visorFrame.classList.toggle('hidden', !on); }

  // 0 = fully visible, 1 = faded back so the world can breathe
  setCalm(target, dt) {
    this.calm = (this.calm || 0) + (target - (this.calm || 0)) * Math.min(1, dt * (target > (this.calm || 0) ? 0.5 : 6));
    const v = Math.round(this.calm * 100) / 100;
    if (v !== this.cache.calm) { this.cache.calm = v; this.root.style.setProperty('--calm', v); }
  }

  update(dt) {
    // chat lines fade unless the chat is open; scrambled text keeps scrambling
    if (this.chatLines) {
      for (const l of this.chatLines) {
        l.t -= dt;
        l.el.classList.toggle('faded', !this.chatOpen && l.t <= 0);
      }
      const G = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#%&@$';
      for (const sp of this.chatLog.querySelectorAll('.obf')) {
        let o = '';
        for (let i = 0; i < Number(sp.dataset.n); i++) o += G[Math.floor(Math.random() * G.length)];
        sp.textContent = o;
      }
    }
    if (this.glitchT > 0) {
      this.glitchT -= dt;
      const on = this.glitchT > 0;
      this.root.classList.toggle('corrupt', on);
      if (on) {
        const G = '∅█▓▒░#?!';
        this.locName.textContent = Math.random() < 0.5 ? 'null' : Array.from({ length: 8 }, () => G[Math.floor(Math.random() * G.length)]).join('');
        for (const k of Object.keys(this.stats)) this.stats[k].val.textContent = String(Math.floor(Math.random() * 999));
      } else { this.cache.locName = null; for (const k of Object.keys(this.stats)) this.cache['val_' + k] = null; }
    }
    for (const n of this.notes) {
      n.t -= dt;
      if (n.t < 0.6 && !n.dying) { n.dying = true; n.el.classList.add('fade'); }
    }
    this.notes = this.notes.filter((n) => { if (n.t <= 0) { n.el.remove(); return false; } return true; });
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) clear(this.toastEl);
    }
  }
}
