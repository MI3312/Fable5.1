// Network transports. Both expose the same small interface:
//
//   await t.init()                      -> { id, name }
//   await t.host({ name, data, max, visibility }) -> lobbyId
//   await t.list()                      -> [{ id, owner, name, members, max, data }]
//   await t.join(lobbyId)               -> { id, owner, members: [id] }
//   t.leave()
//   t.send(to | '*', obj, reliable)
//   t.members                           -> current lobby member ids (including self)
//   callbacks: onMessage(from, obj), onPeerJoined(id), onPeerLeft(id), onInvite(lobbyId)
//
// SteamTransport talks to Steam (lobbies + P2P packets relayed through Steam's network) via the
// desktop shell's preload bridge (window.lucidNet, see desktop/). LocalTransport links browser
// tabs on one machine over a BroadcastChannel: handy for testing without Steam.

const VERSION = 'lucid-sky-mp-1';

class Base {
  constructor() {
    this.id = null; this.name = 'Dreamer';
    this.lobby = null; this.owner = null; this.members = [];
    this.onMessage = () => {}; this.onPeerJoined = () => {}; this.onPeerLeft = () => {}; this.onInvite = () => {};
  }
  get isOwner() { return this.owner === this.id; }
}

// ------------------------------------------------------------------------------------------
export class SteamTransport extends Base {
  static available() { return typeof window !== 'undefined' && !!(window.lucidNet && window.lucidNet.available); }

  get kind() { return 'steam'; }

  async init() {
    const N = window.lucidNet;
    const info = await N.init();
    if (!info || !info.ok) throw new Error(info && info.error ? info.error : 'Steam is not running');
    this.id = info.steamId;
    this.name = info.name || 'Dreamer';
    N.onPacket((from, text) => {
      let m;
      try { m = JSON.parse(text); } catch (e) { return; }
      if (!this.members.includes(from)) return; // only lobby members may talk to us
      this.onMessage(from, m);
    });
    N.onLobbyEvent((e) => {
      if (e.type === 'member') {
        if (e.joined && !this.members.includes(e.id)) { this.members.push(e.id); this.onPeerJoined(e.id); }
        if (!e.joined) { this.members = this.members.filter((q) => q !== e.id); this.onPeerLeft(e.id); }
        if (e.owner) this.owner = e.owner;
      } else if (e.type === 'invite') this.onInvite(e.lobbyId);
    });
    return { id: this.id, name: this.name };
  }

  async host({ name, data = {}, max = 4, visibility = 'friends' }) {
    const r = await window.lucidNet.createLobby(visibility === 'public' ? 2 : 1, max);
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not create a lobby');
    this.lobby = r.lobbyId; this.owner = this.id; this.members = [this.id];
    await window.lucidNet.setLobbyData({ ...data, game: VERSION, name: name || `${this.name}'s dream` });
    return this.lobby;
  }

  async list() {
    const r = await window.lucidNet.listLobbies();
    return (r || []).filter((l) => l.data && l.data.game === VERSION);
  }

  async join(lobbyId) {
    const r = await window.lucidNet.joinLobby(String(lobbyId));
    if (!r || !r.ok) throw new Error((r && r.error) || 'Could not join');
    this.lobby = r.lobbyId; this.owner = r.owner; this.members = r.members.slice();
    return { id: this.lobby, owner: this.owner, members: this.members };
  }

  leave() {
    if (this.lobby) window.lucidNet.leaveLobby();
    this.lobby = null; this.owner = null; this.members = [];
  }

  send(to, obj, reliable = false) {
    if (!this.lobby) return;
    const text = JSON.stringify(obj);
    const targets = to === '*' ? this.members.filter((q) => q !== this.id) : [to];
    if (targets.length) window.lucidNet.send(targets, text, !!reliable);
  }

  invite() { window.lucidNet.openInvite(); }
}

// ------------------------------------------------------------------------------------------
export class LocalTransport extends Base {
  static available() { return typeof BroadcastChannel !== 'undefined'; }

  get kind() { return 'local'; }

  async init(name) {
    this.id = 'L' + Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
    this.name = name || 'Dreamer';
    this.adverts = new Map();
    this.ch = new BroadcastChannel('lucid-sky-net-v1');
    this.ch.onmessage = (ev) => this._recv(ev.data);
    this.advertT = setInterval(() => this._advertise(), 700);
    return { id: this.id, name: this.name };
  }

  _post(o) { this.ch.postMessage({ ...o, from: this.id }); }

  _advertise() {
    if (this.lobby && this.isOwner) this._post({ k: 'lobby', lobby: this.lobby, owner: this.id, members: this.members, data: this.data, max: this.max });
    // forget lobbies that stopped advertising
    const now = performance.now();
    for (const [id, a] of this.adverts) if (now - a.seen > 3000) this.adverts.delete(id);
  }

  _recv(o) {
    if (!o || o.from === this.id) return;
    switch (o.k) {
      case 'lobby':
        this.adverts.set(o.lobby, { id: o.lobby, owner: o.owner, members: o.members.length, max: o.max, data: o.data, name: o.data && o.data.name, seen: performance.now() });
        if (o.lobby === this.lobby) {
          // track membership from the owner's adverts
          for (const m of o.members) if (!this.members.includes(m)) { this.members.push(m); if (m !== this.id) this.onPeerJoined(m); }
          for (const m of [...this.members]) if (!o.members.includes(m)) { this.members = this.members.filter((q) => q !== m); this.onPeerLeft(m); }
        }
        break;
      case 'join':
        if (o.lobby !== this.lobby || !this.isOwner) break;
        if (this.members.length >= this.max) { this._post({ k: 'full', to: o.from, lobby: this.lobby }); break; }
        if (!this.members.includes(o.from)) { this.members.push(o.from); this.onPeerJoined(o.from); }
        this._post({ k: 'joined', to: o.from, lobby: this.lobby, owner: this.id, members: this.members });
        this._advertise();
        break;
      case 'joined':
        if (o.to === this.id && this.pendingJoin) { this.pendingJoin.resolve(o); this.pendingJoin = null; }
        break;
      case 'full':
        if (o.to === this.id && this.pendingJoin) { this.pendingJoin.reject(new Error('That dream is full')); this.pendingJoin = null; }
        break;
      case 'leave':
        if (o.lobby !== this.lobby) break;
        if (this.members.includes(o.from)) { this.members = this.members.filter((q) => q !== o.from); this.onPeerLeft(o.from); }
        if (o.from === this.owner) { this.onPeerLeft(o.from); }
        break;
      case 'msg':
        if (o.lobby !== this.lobby || (o.to !== '*' && o.to !== this.id)) break;
        if (!this.members.includes(o.from)) break;
        this.onMessage(o.from, o.m);
        break;
    }
  }

  async host({ name, data = {}, max = 4 }) {
    this.lobby = 'LB' + this.id.slice(1);
    this.owner = this.id; this.members = [this.id]; this.max = max;
    this.data = { ...data, game: VERSION, name: name || `${this.name}'s dream` };
    this._advertise();
    return this.lobby;
  }

  async list() {
    this._advertise();
    await new Promise((r) => setTimeout(r, 900));
    return [...this.adverts.values()].filter((l) => l.data && l.data.game === VERSION);
  }

  async join(lobbyId) {
    this.lobby = lobbyId;
    const res = await new Promise((resolve, reject) => {
      this.pendingJoin = { resolve, reject };
      this._post({ k: 'join', lobby: lobbyId });
      setTimeout(() => { if (this.pendingJoin) { this.pendingJoin = null; reject(new Error('No answer from that dream')); } }, 5000);
    }).catch((e) => { this.lobby = null; throw e; });
    this.owner = res.owner; this.members = res.members.slice();
    return { id: this.lobby, owner: this.owner, members: this.members };
  }

  leave() {
    if (this.lobby) this._post({ k: 'leave', lobby: this.lobby });
    this.lobby = null; this.owner = null; this.members = [];
  }

  send(to, obj) {
    if (!this.lobby) return;
    this._post({ k: 'msg', lobby: this.lobby, to, m: obj });
  }

  invite() {}
}

export { VERSION };
