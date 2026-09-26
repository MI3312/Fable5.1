// The broken dream. Something else is playing on your save.
// A hidden, persistent corruption level rises the longer you dream. As it climbs, the world
// and the game itself stop behaving: someone joins the chat, structures appear where you are
// not looking, the interface lies, the game pretends to crash - and null watches.
import * as THREE from 'three';
import { clamp } from '../core/rng.js';
import { B, IS_SOLID, IS_LIQUID } from '../world/blocks.js';
import { buildNullFigure, buildFilament, buildSign } from '../entities/horrorModels.js';
import { buildCreatureModel } from '../entities/creatures.js';
import { VOID_NULL } from '../world/pockets.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const OBF = (n) => '§k' + 'x'.repeat(n) + '§r';
const _v = new THREE.Vector3();

const SIGNS = [
  'go back', 'he is here', 'you should not\nbe here', 'null', 'i was here\nfirst', 'this is not\nyour world', 'home',
  'it was all\nmy fault', 'the bridge goes\nnowhere', 'leave the\nlight on', 'they can hear\nyou mining', 'do not\nlook up',
  'wake up', 'everyone stays', 'turn around',
];
const SAY = {
  greet: ['hello', 'hi', 'i see you', 'you found it', 'there you are'],
  watch: ['turn around', 'behind you', 'i can see you', 'look up', 'why are you running', 'stop'],
  deep: ['this is my world', 'you should not have come back', 'everyone stays', 'the bridge goes nowhere', 'it was not my fault', 'wake up', 'you are not the first'],
  spam: ['i am here', 'I AM HERE', 'here', 'i am here'],
};
const TYPED = [
  [/^(hello|hi|hey|hallo|yo)\b/, () => pick(['hello', '...', 'hi', 'hello again'])],
  [/who (are|r) (you|u)|what are you/, () => pick(['you know who i am', 'i was here before you', 'null'])],
  [/\bnull\b/, (c) => (c.stage >= 2 ? '!DO NOT SAY MY NAME' : 'yes')],
  [/\bhelp\b/, () => pick(['no one is coming', 'help who', 'no'])],
  [/\bhome\b/, () => 'home'],
  [/leave|go away|stop|get out/, () => pick(["i can't", 'this is my world', 'you leave'])],
  [/sorry/, () => pick(["it wasn't your fault", 'it was mine'])],
  [/where/, () => pick(['closer than you think', 'behind you', 'here'])],
  [/\bwhy\b/, () => 'you keep dreaming'],
  [/wake/, () => 'i tried'],
];

export class Corruption {
  constructor(game) {
    this.g = game;
    this.group = new THREE.Group();
    this.watchers = [];   // null figures
    this.signMeshes = [];
    this.filament = null;
    this.eventT = 60;
    this.figureT = 45;
    this.pending = [];    // delayed chat lines
    this.freezeT = 0;
    this.missingT = 0;
    this.chunkHideT = 0;
  }

  get st() {
    const s = this.g.state;
    if (!s.corruption) s.corruption = { level: 0, signs: {}, said: {} };
    return s.corruption;
  }
  get stage() { return Math.min(4, Math.floor(this.st.level * 4 + 1e-6)); }
  get active() { return (this.g.settings.fear ?? 1) > 0.05; }

  attach(scene) { scene.add(this.group); }

  setPlanet(planet) {
    this.clear();
    this.planet = planet;
    this.pocket = planet.params.interior || null;
    // signs somebody left here before
    const list = this.st.signs[planet.id] || [];
    for (const s of list) this._placeSignMesh(s);
    if (this.pocket === 'void') {
      const f = buildNullFigure(this.stage >= 3);
      f.position.set(VOID_NULL.x, VOID_NULL.y, VOID_NULL.z);
      this.group.add(f);
      this.watchers.push({ mesh: f, kind: 'bridge', life: 1e9, seenT: 0 });
    }
  }

  clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
    this.watchers = []; this.signMeshes = []; this.filament = null;
  }

  // ---------------------------------------------------------------- chat
  say(text, delay = 0, name = 'null', kind = 'null') { this.pending.push({ t: delay, text, name, kind }); }
  system(text, delay = 0) { this.pending.push({ t: delay, text, name: '', kind: 'system' }); }

  onChat(text) {
    const g = this.g;
    g.hud.chat('you', text, 'you');
    if (!this.active || this.stage < 1) return;
    const t = text.toLowerCase();
    for (const [re, fn] of TYPED) {
      if (re.test(t)) {
        let r = fn(this);
        const loud = r.startsWith('!');
        if (loud) r = r.slice(1);
        this.say(r, rnd(2, 6));
        if (loud) this.pending.push({ t: 6.5, fx: 'screw' });
        this.st.level = Math.min(1, this.st.level + 0.01);
        return;
      }
    }
    if (Math.random() < 0.15 + this.stage * 0.1) this.say(this.stage >= 3 ? text.toUpperCase() : '...', rnd(4, 9));
  }

  _personal() {
    const g = this.g, p = g.player.pos;
    const out = [`${g.nameOf(this.planet)} is mine`, `${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`, `you have been here ${Math.round((g.state.playTime || 0) / 60)} minutes`];
    if (g.ship && g.ship.state === 'landed' && !g.inShip) {
      const a = Math.atan2(g.ship.pos.x - p.x, g.ship.pos.z - p.z);
      out.push(`your ship is ${['south', 'south east', 'east', 'north east', 'north', 'north west', 'west', 'south west'][((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]} of you`);
    }
    const names = Object.values(g.state.names || {});
    if (names.length) out.push(`${pick(names)} is a nice name`);
    out.push(`seed ${g.state.seed}`);
    return pick(out);
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    const g = this.g;
    // pending messages and effects
    for (const m of this.pending) m.t -= dt;
    const due = this.pending.filter((m) => m.t <= 0);
    this.pending = this.pending.filter((m) => m.t > 0);
    for (const m of due) {
      if (m.fx === 'screw') this._screw(ctx, 1.5);
      else if (m.fx === 'left') g.hud.chat('', 'null left the dream', 'system');
      else g.hud.chat(m.name, m.text, m.kind);
    }
    this._timers(dt, ctx);
    if (!this.active) return;
    // the corruption rises while you dream
    const dream = ctx.dreamWorld || this.pocket === 'void' || this.pocket === 'derelict';
    const rate = (dream ? 1 / 2400 : 1 / 4400) * (ctx.daylight < 0.3 ? 1.6 : 1) * (g.settings.fear ?? 1);
    if (this.pocket !== 'station') this.st.level = Math.min(1, this.st.level + dt * rate);
    const stage = this.stage;
    this._updateWatchers(dt, ctx);
    this._updateFilament(dt, ctx);
    if (this.pocket === 'station' || stage < 1) return;
    this.eventT -= dt;
    if (this.eventT <= 0) {
      this.eventT = rnd(45, 120) * (1.35 - stage * 0.2);
      this._event(ctx, stage);
    }
    this.figureT -= dt;
    if (this.figureT <= 0) {
      this.figureT = rnd(70, 160) * (1.3 - stage * 0.18);
      if (!ctx.inShip && this.pocket !== 'void') this._spawnWatcher(ctx, stage >= 2 && Math.random() < 0.35 ? 'behind' : 'far');
    }
  }

  _timers(dt, ctx) {
    const g = this.g;
    if (this.missingT > 0) { this.missingT -= dt; if (this.missingT <= 0) ctx.setMissing(false); }
    if (this.chunkHideT > 0) { this.chunkHideT -= dt; if (this.chunkHideT <= 0) ctx.hideChunks(false); }
    if (this.titleT > 0) { this.titleT -= dt; if (this.titleT <= 0) document.title = this.oldTitle || 'LUCID SKY'; }
    if (this.silenceT > 0) { this.silenceT -= dt; if (this.silenceT <= 0 && g.audio.master) g.audio.master.gain.setTargetAtTime(g.audio.volumes.master, g.audio.ctx.currentTime, 0.02); }
  }

  // ---------------------------------------------------------------- events
  _event(ctx, stage) {
    const inPocket = !!this.pocket;
    const ev = [];
    const add = (name, w, min = 1, world = false) => { if (stage >= min && !(world && inPocket)) ev.push([name, w]); };
    add('join', 3); add('leafless', 2, 1, true); add('sign', 3, 1, true);
    add('chat', 3, 2); add('tunnel', 1.5, 2, true); add('hut', 1.2, 2, true); add('hud', 2, 2); add('missing', 1.5, 2);
    add('silence', 1, 2); add('title', 1, 2);
    add('spam', 1.2, 3); add('freeze', 1, 3); add('chunks', 1, 3, true); add('you', 1, 3); add('text', 1, 3, true); add('crash', 0.6, 3); add('filament', 1.4, 3, true);
    let total = 0; for (const e of ev) total += e[1];
    let r = Math.random() * total, name = ev[0][0];
    for (const e of ev) { r -= e[1]; if (r <= 0) { name = e[0]; break; } }
    this[`_ev_${name}`](ctx, stage);
  }

  _ev_join(ctx, stage) {
    const g = this.g;
    g.hud.chat('', 'null joined the dream', 'system');
    if (stage >= 2 && Math.random() < 0.5) this.say(pick(SAY.greet), rnd(3, 8));
    this.pending.push({ t: rnd(6, 22), fx: 'left' });
  }

  _ev_chat() { this.say(Math.random() < 0.5 ? this._personal() : pick(SAY.deep), rnd(0, 3)); }

  _ev_you() { this.say(pick(['i am still here', 'help', 'it is behind me', 'i can not wake up', 'who is typing this']), 0, 'you', 'you'); }

  _ev_spam(ctx) {
    const n = 5 + Math.floor(Math.random() * 7);
    for (let i = 0; i < n; i++) this.say(Math.random() < 0.3 ? OBF(10 + Math.floor(Math.random() * 12)) : pick(SAY.spam), i * 0.18);
    this.pending.push({ t: n * 0.18, fx: 'screw' });
  }

  _ev_hud() { this.g.hud.glitch(rnd(1.5, 3.5)); this.g.audio.noiseHit(0.3, 3000, 0.05, 'highpass'); }

  _ev_missing(ctx) { ctx.setMissing(true); this.missingT = rnd(0.35, 1.2); }

  _ev_silence() {
    const A = this.g.audio;
    if (!A.master) return;
    A.master.gain.setTargetAtTime(0, A.ctx.currentTime, 0.01);
    this.silenceT = rnd(3, 6);
  }

  _ev_title() { this.oldTitle = this.oldTitle || document.title; document.title = pick(['null', 'LUCID SKY - null', 'LUCID SKY - it sees you', 'wake up']); this.titleT = rnd(20, 40); }

  _ev_freeze() { this.freezeT = rnd(0.8, 1.6); }

  _ev_chunks(ctx) { ctx.hideChunks(true); this.chunkHideT = rnd(2, 4); this.g.audio.noiseHit(0.2, 200, 0.12, 'lowpass'); }

  _ev_crash(ctx) {
    const g = this.g;
    if ((this.st.lastCrash || -1e9) > (g.state.playTime || 0) - 900) { this._ev_hud(); return; }
    this.st.lastCrash = g.state.playTime || 0;
    this.fakeCrash(ctx, 'null', () => {
      ctx.skipTime(0.3);
      this._spawnWatcher(ctx, 'front');
    });
  }

  fakeCrash(ctx, who, after) {
    const g = this.g;
    const pl = g.player.pos;
    g.audio.setDread(0);
    if (g.audio.master) g.audio.master.gain.setTargetAtTime(0, g.audio.ctx.currentTime, 0.005);
    g.input.unlock();
    g.hud.showCrash([
      '---- Dream Crash Report ----',
      '// This dream was closed.',
      '',
      `Time: ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`,
      `Description: Dreaming world ${who === 'null' ? '' : 'by ' + who}`,
      '',
      `TypeError: Cannot read properties of null (reading '${pick(['self', 'waking', 'exit', 'you'])}')`,
      '    at Dreamer.wake (dream.js:404:11)',
      '    at World.tick (world.js:0:0)',
      `    at ${who}.${pick(['watch', 'follow', 'stay', 'keep'])} (${who}.js:1:1)`,
      '    at <anonymous>',
      '',
      '-- Affected dreamer --',
      `  Position: ${pl.x.toFixed(1)}, ${pl.y.toFixed(1)}, ${pl.z.toFixed(1)}`,
      `  World: ${this.planet ? this.planet.id : '?'}`,
      `  Seed: ${g.state.seed}`,
      `  Also present: ${who}`,
      '',
      'The dream will attempt to resume.',
    ]);
    g.crashT = rnd(4.5, 6.5);
    g.onCrashEnd = () => {
      g.hud.hideCrash();
      if (g.audio.master) g.audio.master.gain.setTargetAtTime(g.audio.volumes.master, g.audio.ctx.currentTime, 0.05);
      g.hud.chat('', 'The dream has resumed.', 'system');
      if (after) after();
    };
  }

  // interface screw: what happens when you look at it for too long
  _screw(ctx, strength = 1) {
    const g = this.g;
    g.hud.glitch(1.2 * strength);
    if (ctx.horror) { ctx.horror.glitch = Math.max(ctx.horror.glitch, 0.8 * strength); ctx.horror.shake = Math.max(ctx.horror.shake, 0.4 * strength); }
    g.audio.screech(0.08 * strength);
    if (Math.random() < 0.5) { ctx.setMissing(true); this.missingT = 0.3; }
  }

  // ---------------------------------------------------------------- world edits
  // somewhere near the player, preferably where they are not looking
  _findSpot(ctx, rMin, rMax, inView = false) {
    const W = ctx.world, p = this.g.player.pos;
    const yaw = Math.atan2(ctx.camDir.x, ctx.camDir.z);
    for (let t = 0; t < 14; t++) {
      const a = yaw + (inView ? rnd(-0.4, 0.4) : Math.PI + rnd(-1.5, 1.5));
      const r = rnd(rMin, rMax);
      const x = Math.floor(p.x + Math.sin(a) * r), z = Math.floor(p.z + Math.cos(a) * r);
      if (!W.isLoaded(x, z)) continue;
      const gy = W.groundBelow(x + 0.5, p.y + 10, z + 0.5);
      if (gy < 2 || Math.abs(gy + 1 - p.y) > 12) continue;
      if (IS_LIQUID[W.getBlock(x, gy, z)] || !IS_SOLID[W.getBlock(x, gy, z)]) continue;
      if (IS_SOLID[W.getBlock(x, gy + 1, z)] || IS_SOLID[W.getBlock(x, gy + 2, z)]) continue;
      return { x, y: gy + 1, z };
    }
    return null;
  }

  _ev_sign(ctx) {
    const s = this._findSpot(ctx, 14, 30, this.stage >= 3 && Math.random() < 0.3);
    if (!s) return;
    const text = Math.random() < 0.25 ? this._personal().replace(/(.{1,13})(\s|$)/g, '$1\n').trim() : pick(SIGNS);
    this._addSign({ x: s.x + 0.5, y: s.y, z: s.z + 0.5, yaw: Math.atan2(this.g.player.pos.x - s.x, this.g.player.pos.z - s.z), text });
  }

  _addSign(sign) {
    const list = this.st.signs[this.planet.id] || (this.st.signs[this.planet.id] = []);
    list.push(sign);
    if (list.length > 40) list.shift();
    this._placeSignMesh(sign);
  }

  _placeSignMesh(s) {
    const m = buildSign(s.text);
    m.position.set(s.x, s.y, s.z);
    m.rotation.y = s.yaw + Math.PI;
    this.group.add(m);
    this.signMeshes.push(m);
  }

  _ev_leafless(ctx) {
    const W = ctx.world, p = this.g.player.pos;
    for (let t = 0; t < 40; t++) {
      const a = Math.atan2(ctx.camDir.x, ctx.camDir.z) + Math.PI + rnd(-1.4, 1.4), r = rnd(16, 40);
      const x = Math.floor(p.x + Math.sin(a) * r), z = Math.floor(p.z + Math.cos(a) * r);
      for (let y = Math.floor(p.y) + 14; y > Math.floor(p.y) - 6; y--) {
        if (W.getBlock(x, y, z) !== B.LEAVES) continue;
        // strip the whole crown
        const stack = [[x, y, z]], seen = new Set();
        let n = 0;
        while (stack.length && n < 320) {
          const [cx, cy, cz] = stack.pop();
          const k = cx + ',' + cy + ',' + cz;
          if (seen.has(k)) continue;
          seen.add(k);
          if (W.getBlock(cx, cy, cz) !== B.LEAVES) continue;
          W.setBlock(cx, cy, cz, B.AIR); n++;
          stack.push([cx + 1, cy, cz], [cx - 1, cy, cz], [cx, cy + 1, cz], [cx, cy - 1, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]);
        }
        return;
      }
    }
  }

  _ev_tunnel(ctx) {
    const s = this._findSpot(ctx, 12, 26);
    if (!s) return;
    const W = ctx.world;
    const dx = Math.random() < 0.5 ? 1 : 0, dz = 1 - dx, sg = Math.random() < 0.5 ? 1 : -1;
    // a neat 1x2 tunnel dug straight into the ground and down
    for (let i = 0; i < 14; i++) {
      const x = s.x + dx * sg * i, z = s.z + dz * sg * i, y = s.y - Math.floor(i / 2);
      W.setBlock(x, y, z, B.AIR); W.setBlock(x, y + 1, z, B.AIR);
    }
  }

  _ev_hut(ctx) {
    const s = this._findSpot(ctx, 24, 40);
    if (!s) return;
    const W = ctx.world;
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      W.setBlock(s.x + x, s.y - 1, s.z + z, B.OBSIDIAN);
      for (let y = 0; y < 4; y++) {
        const wall = Math.abs(x) === 2 || Math.abs(z) === 2;
        const door = z === -2 && x === 0 && y < 2;
        W.setBlock(s.x + x, s.y + y, s.z + z, y === 3 ? B.ONYX : wall && !door ? B.ONYX : B.AIR);
      }
    }
    W.setBlock(s.x, s.y, s.z + 1, B.VOID);
    W.setBlock(s.x, s.y + 1, s.z + 1, B.VOID);
    this._addSign({ x: s.x + 1.5, y: s.y, z: s.z - 2.6, yaw: 0, text: pick(['home', 'come in', 'do not', 'null']) });
  }

  _ev_text(ctx) {
    const W = ctx.world, p = this.g.player.pos;
    const word = pick(['NULL', 'WAKE', 'HOME']);
    const FONT = {
      N: ['101', '111', '111', '111', '101'], U: ['101', '101', '101', '101', '111'], L: ['100', '100', '100', '100', '111'],
      W: ['101', '101', '111', '111', '101'], A: ['010', '101', '111', '101', '101'], K: ['101', '110', '100', '110', '101'],
      E: ['111', '100', '111', '100', '111'], H: ['101', '101', '111', '101', '101'], O: ['111', '101', '101', '101', '111'], M: ['101', '111', '111', '101', '101'],
    };
    // written into the ground ahead, while you watch
    const yaw = Math.atan2(ctx.camDir.x, ctx.camDir.z);
    const cx = p.x + Math.sin(yaw) * 16, cz = p.z + Math.cos(yaw) * 16;
    const alongX = Math.abs(Math.cos(yaw)) > 0.7;
    const len = word.length * 4 - 1;
    for (let gi = 0; gi < word.length; gi++) {
      const glyph = FONT[word[gi]];
      for (let row = 0; row < 5; row++) for (let col = 0; col < 3; col++) {
        if (glyph[row][col] !== '1') continue;
        const u = gi * 4 + col - len / 2, v = row - 2;
        const x = Math.floor(alongX ? cx + u : cx + v), z = Math.floor(alongX ? cz + v : cz - u);
        const gy = W.groundBelow(x + 0.5, p.y + 8, z + 0.5);
        if (gy > 1) W.setBlock(x, gy, z, B.OBSIDIAN);
      }
    }
    this.g.hud.glitch(0.6);
  }

  // ---------------------------------------------------------------- null
  _spawnWatcher(ctx, kind) {
    const W = ctx.world, p = this.g.player.pos;
    const yaw = Math.atan2(ctx.camDir.x, ctx.camDir.z);
    let s = null;
    if (kind === 'front') {
      const x = Math.floor(p.x + Math.sin(yaw) * 6), z = Math.floor(p.z + Math.cos(yaw) * 6);
      const gy = W.groundBelow(x + 0.5, p.y + 4, z + 0.5);
      if (gy > 1) s = { x, y: gy + 1, z };
    } else if (kind === 'behind') s = this._findSpot(ctx, 9, 14);
    else {
      for (let t = 0; t < 10 && !s; t++) {
        const a = yaw + rnd(-0.9, 0.9), r = rnd(38, 56);
        const x = Math.floor(p.x + Math.sin(a) * r), z = Math.floor(p.z + Math.cos(a) * r);
        if (!W.isLoaded(x, z)) continue;
        const gy = W.groundBelow(x + 0.5, p.y + 14, z + 0.5);
        if (gy > 1 && !IS_LIQUID[W.getBlock(x, gy, z)]) s = { x, y: gy + 1, z };
      }
    }
    if (!s) return;
    const mesh = buildNullFigure(this.stage >= 3);
    mesh.position.set(s.x + 0.5, s.y, s.z + 0.5);
    mesh.rotation.y = Math.atan2(p.x - s.x, p.z - s.z) + Math.PI;
    this.group.add(mesh);
    this.watchers.push({ mesh, kind, life: kind === 'front' ? 2.5 : 45, seenT: 0, awayT: 0, wasSeen: false });
    if (kind === 'front') { this.g.audio.screech(0.12); if (ctx.horror) ctx.horror.glitch = 1; }
  }

  _updateWatchers(dt, ctx) {
    const p = this.g.player.pos, cam = ctx.cam;
    for (const w of this.watchers) {
      w.life -= dt;
      const m = w.mesh;
      const dx = p.x - m.position.x, dz = p.z - m.position.z, dist = Math.hypot(dx, dz);
      m.rotation.y = Math.atan2(dx, dz) + Math.PI;
      _v.set(m.position.x - cam.position.x, m.position.y + 1.6 - cam.position.y, m.position.z - cam.position.z);
      const d3 = _v.length();
      const seen = _v.dot(ctx.camDir) / d3 > 0.94 && d3 < 90;
      if (seen) { w.seenT += dt; w.wasSeen = true; w.awayT = 0; } else w.awayT += dt;
      let gone = w.life <= 0;
      if (w.kind === 'bridge') {
        // at the end of the bridge in the Void. It does not like you coming closer.
        if (dist < 10 && !w.fired) {
          w.fired = true; gone = true;
          this.say(pick(['you came back', 'you should not have come', 'home', 'stay']), 1.5);
          this.g.state.flags.metNull = true;
          this.st.level = Math.min(1, this.st.level + 0.05);
        }
      } else if (w.kind === 'behind') {
        if (seen) { gone = true; this._screw(ctx, 1.2); this._ev_spam(ctx); }
      } else {
        if (w.seenT > 2.4) { gone = true; this._screw(ctx, 1); this.say(pick(SAY.watch), 0.5); }
        else if (dist < 22 || (w.wasSeen && w.awayT > 1.5)) gone = true;
      }
      if (gone) { this.group.remove(m); w.dead = true; }
    }
    this.watchers = this.watchers.filter((w) => !w.dead);
  }

  // ---------------------------------------------------------------- the Filament
  // It wears the shape of an animal that belongs here. It stands too still.
  _ev_filament(ctx) {
    if (this.filament || ctx.inShip) return;
    const sp = ctx.species && ctx.species.filter((q) => !q.watcher && q.plan !== 'flyer' && q.plan !== 'manikin');
    if (!sp || !sp.length) return;
    const s = this._findSpot(ctx, 24, 34, true) || this._findSpot(ctx, 24, 34);
    if (!s) return;
    const disguise = buildCreatureModel(pick(sp));
    disguise.position.set(s.x + 0.5, s.y, s.z + 0.5);
    this.group.add(disguise);
    const real = buildFilament();
    real.position.copy(disguise.position);
    real.scale.set(1, 0.001, 1);
    real.visible = false;
    this.group.add(real);
    this.filament = { disguise, real, pos: new THREE.Vector3(s.x + 0.5, s.y, s.z + 0.5), state: 'disguised', t: 0, life: 110 };
  }

  _updateFilament(dt, ctx) {
    const F = this.filament;
    if (!F) return;
    const g = this.g, p = g.player.pos;
    F.t += dt; F.life -= dt;
    const dx = p.x - F.pos.x, dz = p.z - F.pos.z, dist = Math.hypot(dx, dz);
    const face = Math.atan2(dx, dz) + Math.PI;
    _v.set(F.pos.x - ctx.cam.position.x, F.pos.y + 3 - ctx.cam.position.y, F.pos.z - ctx.cam.position.z);
    const seen = _v.dot(ctx.camDir) / _v.length() > 0.9;
    const end = () => { this.group.remove(F.disguise); this.group.remove(F.real); this.filament = null; };
    if (F.life <= 0 || ctx.inShip) { end(); return; }
    if (F.state === 'disguised') {
      F.disguise.rotation.y = face; // it always faces you. animals do not do that.
      if (dist < 12 || (seen && ctx.visorOn && dist < 40)) {
        F.state = 'unfold'; F.t = 0;
        g.audio.screech(0.1); g.audio.noiseHit(0.8, 180, 0.2, 'lowpass');
        if (ctx.horror) ctx.horror.glitch = 0.8;
        F.real.visible = true;
      }
    } else if (F.state === 'unfold') {
      const k = clamp(F.t / 0.7, 0, 1);
      F.disguise.scale.set(1 + k * 0.6, Math.max(0.001, 1 - k), 1 + k * 0.6);
      F.real.scale.set(1, Math.max(0.001, k), 1);
      F.real.rotation.y = face;
      if (k >= 1) { this.group.remove(F.disguise); F.state = 'hunt'; F.t = 0; this.say(pick(['found you', 'hello', OBF(8)]), 0.4, 'null', 'null'); }
    } else if (F.state === 'hunt') {
      const U = F.real.userData;
      // it only moves when you are not watching, and its head keeps tilting when you are
      if (!seen) {
        const sp = 6.5;
        F.pos.x += (dx / dist) * sp * dt; F.pos.z += (dz / dist) * sp * dt;
        const gy = ctx.world.groundBelow(F.pos.x, F.pos.y + 3, F.pos.z);
        if (gy > 1) F.pos.y = gy + 1;
        for (const L of U.limbs) { L.leg.rotation.x = Math.sin(F.t * 5 + L.side) * 0.35; L.arm.rotation.x = Math.sin(F.t * 4 - L.side) * 0.3; }
      } else {
        U.neck.rotation.z = Math.min(1.5, U.neck.rotation.z + dt * 0.25);
      }
      F.real.position.copy(F.pos);
      F.real.rotation.y = face;
      if (dist < 2.4) {
        end();
        g.state.corruption.caught = (g.state.corruption.caught || 0) + 1;
        this.fakeCrash(ctx, 'filament', () => { ctx.hurt(55, 'filament'); });
      }
    }
  }
}
