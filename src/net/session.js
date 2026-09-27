// Multiplayer session: shared dreams.
//
// The host's universe is the shared one. Guests load it (their own character, the host's seed),
// arrive next to the host, and from then on everyone streams a small snapshot ~12 times a second:
// where they are, what they're flying or driving. Block edits are batched and sent reliably;
// when you arrive on a planet you ask the host for everything that's been changed there. Chat,
// pings, waves and the time of day ride along. The host keeps the canonical record of edits for
// every planet so late arrivals see the same world.
import { SteamTransport, LocalTransport } from './transport.js';
import { RemotePlayers, peerColor } from './avatars.js';
import { CHUNK } from '../config.js';
import { BUFFS } from '../data/food.js';
import { ITEMS } from '../data/items.js';

const SNAP_HZ = 12;

export class NetSession {
  constructor(game) {
    this.game = game;
    this.t = null;
    this.role = null;          // 'host' | 'guest' | null
    this.peers = new Map();    // id -> { name, color, last }
    this.remote = new RemotePlayers();
    this.sendT = 0;
    this.edits = [];           // pending local edits to broadcast
    this.applying = false;
    this.pings = [];
    this.status = '';
  }

  get active() { return !!this.role; }
  get isHost() { return this.role === 'host'; }
  get transportKind() { return SteamTransport.available() ? 'steam' : 'local'; }

  async _transport() {
    if (this.t) return this.t;
    const name = this.game.settings.playerName || 'Dreamer';
    const T = SteamTransport.available() ? new SteamTransport() : new LocalTransport();
    await T.init(name);
    if (T.kind === 'local') T.name = name;
    T.onMessage = (from, m) => this._onMessage(from, m);
    T.onPeerJoined = (id) => { if (this.isHost) this.status = `${this._name(id)} is joining…`; };
    T.onPeerLeft = (id) => this._peerLeft(id);
    T.onInvite = (lobbyId) => this.join(lobbyId).catch((e) => this.game.hud.notify(e.message));
    this.t = T;
    return T;
  }

  _name(id) { return (this.peers.get(id) || {}).name || 'A dreamer'; }

  // ---------------- lobby ----------------
  async host({ visibility = 'friends', max = 4 } = {}) {
    const g = this.game;
    if (!g.state || !g.isPlaying()) throw new Error('Start or continue a journey first');
    const T = await this._transport();
    await T.host({ name: `${T.name}'s dream`, data: { seed: String(g.state.seed), host: T.name }, max, visibility });
    this.role = 'host';
    this.peers.clear();
    this._hookWorld();
    g.hud.toast('Dream shared', T.kind === 'steam' ? 'Friends can join through Steam' : 'Open another tab to join (local test mode)');
    g.hud.chat(null, `${T.name} opened the dream to others.`, 'system');
    return T.lobby;
  }

  async list() {
    const T = await this._transport();
    return T.list();
  }

  async join(lobbyId) {
    const T = await this._transport();
    if (this.active) this.leave(true);
    await T.join(lobbyId);
    this.role = 'guest';
    this.welcomed = false;
    T.send(T.owner, { k: 'hello', n: T.name }, true);
    // wait for the host's welcome
    return new Promise((resolve, reject) => {
      this.onWelcome = resolve;
      setTimeout(() => { if (!this.welcomed) { this.leave(true); reject(new Error('The host did not answer')); } }, 8000);
    });
  }

  leave(quiet = false) {
    const g = this.game;
    if (this.t && this.t.lobby) {
      this.t.send('*', { k: 'bye' }, true);
      this.t.leave();
    }
    const wasGuest = this.role === 'guest';
    this.role = null;
    this.peers.clear();
    this.remote.clear();
    this._unhookWorld();
    if (!quiet) g.hud.chat(null, 'You are dreaming alone again.', 'system');
    if (wasGuest && !quiet) g.onLeftSharedDream();
  }

  invite() { if (this.t) this.t.invite(); }

  // ---------------- world hooks ----------------
  _hookWorld() {
    const W = this.game.surface.world;
    W.onEdit = (x, y, z, id) => { if (!this.applying && this.active) this.edits.push(x, y, z, id); };
  }

  _unhookWorld() { this.game.surface.world.onEdit = null; }

  _where() {
    const g = this.game, S = g.surface;
    const sys = g.system ? g.system.key : '';
    if (g.mode === 'surface' && S.planet && !S.interior) return { m: 's', s: sys, p: S.planet.id, pi: S.planet.index };
    if (g.mode === 'space') return { m: 'x', s: sys, p: null };
    return { m: 'o', s: sys, p: S.planet ? S.planet.id : null };
  }

  // ---------------- per-frame ----------------
  update(dt) {
    if (!this.active) return;
    const g = this.game, S = g.surface;
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = 1 / SNAP_HZ;
      this.t.send('*', this._snapshot(), false);
    }
    if (this.edits.length) {
      const w = this._where();
      if (w.p) this.t.send('*', { k: 'ed', p: w.p, e: this.edits }, true);
      if (this.isHost && w.p) this._storeEdits(w.p, this.edits, true);
      this.edits = [];
    }
    // draw the others
    const scene = g.mode === 'space' ? g.space.scene : S.scene;
    this.remote.attach(scene);
    const here = this._where();
    const now = performance.now();
    this.markers = [];
    this.remote.update({
      here: { mode: here.m === 'x' ? 'space' : 'surface', sys: here.s, planet: here.p },
      now, dt,
      markers: (pos, name, color) => this.markers.push({ pos, name, color }),
    });
    this.pings = this.pings.filter((p) => (p.t -= dt) > 0);
  }

  _snapshot() {
    const g = this.game, S = g.surface, p = g.player, sh = g.ship, w = this._where();
    const o = { k: 'st', s: w.s, m: w.m, p: w.p, pi: w.pi, x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2), yw: +p.yaw.toFixed(3), pt: +p.pitch.toFixed(2) };
    o.mv = Math.hypot(p.vel.x, p.vel.z) > 0.5 ? 1 : 0;
    o.sh = g.inShip ? 1 : 0;
    const sp = sh.pos;
    o.sx = +sp.x.toFixed(2); o.sy = +sp.y.toFixed(2); o.sz = +sp.z.toFixed(2);
    o.sq = [sh.quat.x, sh.quat.y, sh.quat.z, sh.quat.w].map((v) => +v.toFixed(4));
    o.ss = sh.state === 'landed' ? 0 : 1;
    o.spd = Math.round(sh.speed);
    const R = S.rover;
    if (R && R.driving) { o.rv = 1; o.rx = +R.pos.x.toFixed(2); o.ry = +R.pos.y.toFixed(2); o.rz = +R.pos.z.toFixed(2); o.ryw = +R.yaw.toFixed(3); o.rp = +R.pitch.toFixed(3); o.rr = +R.roll.toFixed(3); o.rsp = +R.speed.toFixed(1); o.rl = R.lights ? 1 : 0; }
    const fb = S.fishing && w.m === 's' ? S.fishing.bobberOut : null;
    if (fb) { o.fb = [fb.x, fb.y, fb.z].map((v) => +v.toFixed(2)); if (S.fishing.state === 'reel') o.fr = 1; }
    if (this.isHost && w.m === 's') o.d = +S.dayT.toFixed(4);
    return o;
  }

  // ---------------- messages ----------------
  _onMessage(from, m) {
    const g = this.game, T = this.t;
    switch (m.k) {
      case 'hello': {
        const peer = { name: String(m.n || 'Dreamer').slice(0, 24), color: peerColor(from) };
        const isNew = !this.peers.has(from);
        this.peers.set(from, peer);
        const ent = this.remote._ent(from); ent.name = peer.name; ent.color = peer.color;
        if (this.isHost) {
          const w = this._where();
          T.send(from, {
            k: 'welcome', seed: String(g.state.seed), sys: { ...g.state.system }, w,
            x: g.player.pos.x, y: g.player.pos.y, z: g.player.pos.z, d: g.surface.dayT,
            players: [{ id: T.id, n: T.name }, ...[...this.peers].filter(([id]) => id !== from).map(([id, q]) => ({ id, n: q.name }))],
          }, true);
          // everyone else learns the newcomer's name
          T.send('*', { k: 'hi', id: from, n: peer.name }, true);
        }
        if (isNew) { g.hud.chat(null, `${peer.name} joined the dream.`, 'system'); g.audio.tone(660, 0.3, 'sine', 0.06, 1.5); }
        break;
      }
      case 'hi': {
        if (m.id === T.id) break;
        const peer = { name: String(m.n || 'Dreamer').slice(0, 24), color: peerColor(m.id) };
        if (!this.peers.has(m.id)) g.hud.chat(null, `${peer.name} joined the dream.`, 'system');
        this.peers.set(m.id, peer);
        const ent = this.remote._ent(m.id); ent.name = peer.name; ent.color = peer.color;
        break;
      }
      case 'welcome': {
        if (this.role !== 'guest' || this.welcomed) break;
        this.welcomed = true;
        this.peers.set(from, { name: m.players[0].n, color: peerColor(from) });
        for (const q of m.players) {
          if (q.id === T.id) continue;
          this.peers.set(q.id, { name: q.n, color: peerColor(q.id) });
          const ent = this.remote._ent(q.id); ent.name = q.n; ent.color = peerColor(q.id);
        }
        // introduce ourselves to everybody else too
        T.send('*', { k: 'hello', n: T.name }, true);
        g.startGuest(m, () => { this._hookWorld(); this.requestEdits(); });
        if (this.onWelcome) { this.onWelcome(m); this.onWelcome = null; }
        break;
      }
      case 'st': {
        const peer = this.peers.get(from);
        if (!peer) break;
        peer.last = m;
        this.remote.push(from, m, performance.now());
        // the host keeps the clock for the planet you share
        const w = this._where();
        if (m.d !== undefined && from === T.owner && w.m === 's' && m.p === w.p) {
          const S = g.surface;
          let d = m.d - S.dayT;
          if (d > 0.5) d -= 1; if (d < -0.5) d += 1;
          S.dayT = (S.dayT + d * 0.2 + 1) % 1;
        }
        break;
      }
      case 'ed': {
        const w = this._where();
        if (this.isHost) this._storeEdits(m.p, m.e, m.p === w.p);
        if (m.p === w.p && w.m === 's') this._apply(m.e);
        break;
      }
      case 'req': {
        if (!this.isHost || m.what !== 'edits') break;
        const w = this._where();
        const S = g.surface;
        const data = w.p === m.p && w.m === 's' ? S.world.exportEdits() : (g.state.edits[m.p] || {});
        T.send(from, { k: 'eds', p: m.p, d: data }, true);
        break;
      }
      case 'eds': {
        const w = this._where();
        if (m.p !== w.p) break;
        const flat = [];
        for (const key of Object.keys(m.d || {})) {
          const [cx, cz] = key.split(',').map(Number);
          const arr = m.d[key];
          for (let i = 0; i < arr.length; i += 2) {
            const li = arr[i], lx = li % 16, lz = Math.floor(li / 16) % 16, y = Math.floor(li / 256);
            flat.push(cx * CHUNK + lx, y, cz * CHUNK + lz, arr[i + 1]);
          }
        }
        this._apply(flat);
        break;
      }
      case 'chat':
        g.hud.chat(this._name(from), String(m.t || '').slice(0, 200), 'player');
        g.audio.tone(900, 0.06, 'sine', 0.04);
        break;
      case 'ping': {
        const w = this._where();
        if (m.p !== w.p) { g.hud.notify(`${this._name(from)} pinged something on another world`); break; }
        this.pings.push({ x: m.x, y: m.y, z: m.z, name: this._name(from), color: peerColor(from), t: 20 });
        g.audio.tone(1200, 0.12, 'triangle', 0.06, 0.7);
        break;
      }
      case 'enc': {
        const w = this._where(), S = g.surface;
        if (from !== T.owner || m.p !== w.p || w.m !== 's' || S.encounters.active) break;
        S.encounters.start(m.type, { x: m.x, y: m.y, z: m.z, seed: m.seed });
        break;
      }
      case 'meal': {
        const w = this._where(), p = g.player.pos;
        if (m.p !== w.p || w.m !== 's' || Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z) > 12) break;
        if (!BUFFS[m.b]) break;
        g.buffs.add(m.b, Math.min(600, Number(m.sec) || 0));
        g.hud.toast(`${this._name(from)} shared a meal`, `${ITEMS[m.dish] ? ITEMS[m.dish].name : 'Something warm'} · ${BUFFS[m.b].name}`);
        g.audio.tone(620, 0.2, 'sine', 0.05, 1.3);
        break;
      }
      case 'emote':
        this.remote.wave(from);
        g.hud.notify(`${this._name(from)} waves`);
        break;
      case 'bye':
        this._peerLeft(from);
        break;
    }
  }

  _peerLeft(id) {
    const g = this.game;
    if (!this.peers.has(id) && !this.remote.ents.has(id)) return;
    const name = this._name(id);
    this.peers.delete(id);
    this.remote.remove(id);
    g.hud.chat(null, `${name} woke up.`, 'system');
    if (this.role === 'guest' && this.t && id === this.t.owner) {
      g.hud.toast('The host woke up', 'The shared dream is over');
      this.leave(true);
      g.onLeftSharedDream();
    }
  }

  // apply a flat [x,y,z,id,...] list without echoing it back out
  _apply(e) {
    const W = this.game.surface.world;
    this.applying = true;
    for (let i = 0; i + 3 < e.length; i += 4) W.editBlock(e[i], e[i + 1], e[i + 2], e[i + 3]);
    this.applying = false;
  }

  // the host's record of edits on planets it isn't standing on (same packed format as saves)
  _storeEdits(pid, e, live) {
    if (live) return; // the live world already holds them and exports them on leave
    const st = this.game.state;
    const obj = st.edits[pid] || (st.edits[pid] = {});
    for (let i = 0; i < e.length; i += 4) {
      const x = e[i], y = e[i + 1], z = e[i + 2], id = e[i + 3];
      const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
      const key = cx + ',' + cz;
      (obj[key] || (obj[key] = [])).push((x - cx * CHUNK) + 16 * ((z - cz * CHUNK) + 16 * y), id);
    }
  }

  requestEdits() {
    const w = this._where();
    if (this.role !== 'guest' || !w.p) return;
    this.t.send(this.t.owner, { k: 'req', what: 'edits', p: w.p }, true);
  }

  // go to where a friend is: same planet (a short hop), another planet in this system, or another system
  travelTo(id) {
    const g = this.game, peer = this.peers.get(id);
    const L = peer && peer.last;
    if (!L) { g.hud.notify('Not sure where they are yet'); return; }
    if (L.m !== 's' || L.pi === undefined) { g.hud.notify(`${peer.name} is in space or indoors - try again when they land`); return; }
    const S = g.surface;
    g.menus.closeAll(true);
    g.fade(0.6, () => {
      const here = this._where();
      if (here.m === 's' && here.p === L.p) {
        const p = g.player.pos;
        const gy = S.world.groundBelow(L.x + 2, L.y + 4, L.z + 2);
        p.set(L.x + 2, gy + 1.02, L.z + 2);
        g.player.vel.set(0, 0, 0);
        g.resume();
        return;
      }
      if (g.mode === 'surface') { S.exportEdits(); S.leave(); } else if (g.mode === 'space') g.space.leave();
      const key = L.s;
      if (g.system.key !== key) {
        const [gx, gy, gz] = key.split(',').map(Number);
        g.system = g.universe.getSystem(gx, gy, gz);
        g.state.system = { gx, gy, gz };
      }
      g.enterSurface(L.pi, { spawn: 'near', near: { x: L.x, y: L.y, z: L.z } });
    }, 0x9fd8ff);
  }

  // ---------------- social ----------------
  chat(text) { if (this.active) this.t.send('*', { k: 'chat', t: text }, true); }

  ping() {
    const g = this.game, S = g.surface, cam = g.camera;
    if (!this.active || g.mode !== 'surface') return;
    const dir = cam.getWorldDirection(cam.position.clone().set(0, 0, 0));
    const hit = S.world.raycast(cam.position, dir, 200);
    const pt = hit ? hit.point : cam.position.clone().addScaledVector(dir, 60);
    const w = this._where();
    this.t.send('*', { k: 'ping', p: w.p, x: pt.x, y: pt.y + 0.5, z: pt.z }, true);
    this.pings.push({ x: pt.x, y: pt.y + 0.5, z: pt.z, name: 'You', color: '#ffffff', t: 20 });
    g.audio.tone(1200, 0.12, 'triangle', 0.06, 0.7);
  }

  // the host's encounters happen for everyone on that planet
  sendEncounter(e) {
    const w = this._where();
    if (!this.active || !this.isHost || w.m !== 's') return;
    this.t.send('*', { k: 'enc', p: w.p, ...e }, true);
  }

  shareMeal(dish, buff, sec) {
    const w = this._where();
    if (!this.active || w.m !== 's') return;
    const p = this.game.player.pos;
    this.t.send('*', { k: 'meal', dish, b: buff, sec, p: w.p, x: p.x, y: p.y, z: p.z }, true);
  }

  wave() { if (this.active) { this.t.send('*', { k: 'emote', e: 'wave' }, true); this.game.hud.notify('You wave'); } }

  players() {
    const out = [];
    if (this.t && this.active) out.push({ id: this.t.id, name: this.t.name, you: true, host: this.isHost });
    for (const [id, p] of this.peers) out.push({ id, name: p.name, host: this.t && id === this.t.owner, where: p.last });
    return out;
  }
}
