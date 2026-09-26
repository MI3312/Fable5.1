// Procedural WebAudio: generative dream-ambient score + synthesized sound effects.
import { RNG } from '../core/rng.js';

const SCALES = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  whole: [0, 2, 4, 6, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

const MOODS = {
  lush: { scale: 'lydian', root: 50, pad: 'triangle', cutoff: 1400, bellRate: 2.5 },
  liminal: { scale: 'pentatonic', root: 53, pad: 'sine', cutoff: 1100, bellRate: 3.5, dream: true },
  exotic: { scale: 'whole', root: 48, pad: 'sawtooth', cutoff: 900, bellRate: 2.2, dream: true },
  frozen: { scale: 'dorian', root: 55, pad: 'sine', cutoff: 1600, bellRate: 3 },
  scorched: { scale: 'phrygian', root: 45, pad: 'sawtooth', cutoff: 700, bellRate: 4 },
  toxic: { scale: 'minor', root: 47, pad: 'sawtooth', cutoff: 800, bellRate: 3.5 },
  radioactive: { scale: 'minor', root: 46, pad: 'square', cutoff: 700, bellRate: 3.2 },
  barren: { scale: 'dorian', root: 45, pad: 'triangle', cutoff: 900, bellRate: 4 },
  dead: { scale: 'whole', root: 40, pad: 'sine', cutoff: 500, bellRate: 6 },
  space: { scale: 'lydian', root: 38, pad: 'sawtooth', cutoff: 600, bellRate: 3, space: true },
  station: { scale: 'pentatonic', root: 57, pad: 'sine', cutoff: 1200, bellRate: 2 },
  title: { scale: 'lydian', root: 45, pad: 'sawtooth', cutoff: 800, bellRate: 2.6, dream: true },
  naraka: { scale: 'phrygian', root: 38, pad: 'sawtooth', cutoff: 420, bellRate: 7, dream: true },
  void: { scale: 'whole', root: 50, pad: 'sine', cutoff: 900, bellRate: 1.8, dream: true },
  library: { scale: 'dorian', root: 52, pad: 'triangle', cutoff: 700, bellRate: 5 },
};

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.volumes = { master: 0.8, music: 0.55, sfx: 0.8 };
    this.loops = {};
    this.mood = null;
    this.chordTimer = 0;
    this.bellTimer = 0;
    this.padVoices = [];
    this.rng = new RNG(1);
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(c.destination);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.reverb = c.createConvolver();
    this.reverb.buffer = this._impulse(3.2, 2.4);
    this.reverbGain = c.createGain();
    this.reverbGain.gain.value = 0.55;
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.noise = this._noiseBuffer(2);
    this.enabled = true;
    if (this.pendingMood) { this.setMood(this.pendingMood); this.pendingMood = null; }
  }

  _impulse(seconds, decay) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  _noiseBuffer(seconds) {
    const c = this.ctx;
    const buf = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setVolumes(v) {
    Object.assign(this.volumes, v);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.1);
    this.musicBus.gain.setTargetAtTime(this.volumes.music, t, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.1);
  }

  // ---------------- music ----------------
  setMood(name, seed = 1) {
    if (!this.ctx) { this.pendingMood = name; return; }
    const m = MOODS[name] || MOODS.lush;
    if (this.mood === m && this.moodSeed === seed) return;
    this.mood = m;
    this.moodSeed = seed;
    this.rng = new RNG(seed + name.length * 17);
    this.rootShift = this.rng.int(-3, 3);
    this.chordTimer = 0;
    this.bellTimer = 1.5;
    this._releasePad(2.5);
  }

  _releasePad(rel) {
    const t = this.ctx.currentTime;
    for (const v of this.padVoices) {
      try {
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setValueAtTime(v.g.gain.value, t);
        v.g.gain.linearRampToValueAtTime(0, t + rel);
        v.o.stop(t + rel + 0.1);
      } catch (e) { /* ignore */ }
    }
    this.padVoices = [];
  }

  _playChord() {
    const c = this.ctx, m = this.mood;
    const scale = SCALES[m.scale];
    const deg = this.rng.pick([0, 0, 3, 4, 5, 1, 2]);
    const notes = [0, 2, 4, 6].map((k) => {
      const idx = deg + k;
      const oct = Math.floor(idx / scale.length);
      return m.root + this.rootShift + scale[idx % scale.length] + oct * 12;
    });
    this._releasePad(4);
    const t = c.currentTime;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = m.cutoff;
    filter.Q.value = 0.7;
    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    lfo.frequency.value = 0.07;
    lfoG.gain.value = m.cutoff * 0.4;
    lfo.connect(lfoG); lfoG.connect(filter.frequency);
    lfo.start(t); lfo.stop(t + 16);
    filter.connect(this.musicBus);
    // worn-tape warble on dreamlike moods
    let warble = null;
    if (m.dream) {
      const wl = c.createOscillator();
      warble = c.createGain();
      wl.frequency.value = 0.21 + this.rng.range(0, 0.15);
      warble.gain.value = 14;
      wl.connect(warble);
      wl.start(t); wl.stop(t + 30);
    }
    notes.forEach((n, i) => {
      for (const det of [-6, 6]) {
        const o = c.createOscillator();
        o.type = m.pad;
        o.frequency.value = midi(n + (i === 0 ? -12 : 0));
        o.detune.value = det + this.rng.range(-3, 3);
        const g = c.createGain();
        g.gain.value = 0;
        const peak = (m.pad === 'sawtooth' || m.pad === 'square' ? 0.018 : 0.04) * (i === 0 ? 1.2 : 1);
        g.gain.linearRampToValueAtTime(peak, t + 3.5);
        o.connect(g); g.connect(filter);
        if (warble) warble.connect(o.detune);
        o.start(t);
        o.stop(t + 30);
        this.padVoices.push({ o, g });
      }
    });
    this.currentChord = notes;
  }

  _bell() {
    const c = this.ctx, m = this.mood;
    const scale = SCALES[m.scale];
    const n = m.root + this.rootShift + 24 + scale[this.rng.int(0, scale.length - 1)] + (this.rng.chance(0.3) ? 12 : 0);
    const t = c.currentTime;
    const o = c.createOscillator();
    const mod = c.createOscillator();
    const modG = c.createGain();
    o.type = 'sine';
    o.frequency.value = midi(n);
    mod.frequency.value = midi(n) * (m.dream ? 3.5 : 2);
    modG.gain.value = midi(n) * 0.6;
    mod.connect(modG); modG.connect(o.frequency);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
    modG.gain.setValueAtTime(midi(n) * 0.6, t);
    modG.gain.exponentialRampToValueAtTime(1, t + 2);
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) { pan.pan.value = this.rng.range(-0.7, 0.7); o.connect(g); g.connect(pan); pan.connect(this.musicBus); }
    else { o.connect(g); g.connect(this.musicBus); }
    o.start(t); mod.start(t);
    o.stop(t + 3.6); mod.stop(t + 3.6);
  }

  update(dt) {
    if (!this.ctx || !this.mood) return;
    this.chordTimer -= dt;
    if (this.chordTimer <= 0) {
      this.chordTimer = 12 + this.rng.range(0, 6);
      this._playChord();
    }
    this.bellTimer -= dt;
    if (this.bellTimer <= 0) {
      this.bellTimer = this.mood.bellRate * this.rng.range(0.4, 1.6);
      if (this.rng.chance(0.8)) this._bell();
    }
  }

  // ---------------- sfx helpers ----------------
  _env(node, t, a, peak, d) {
    node.gain.setValueAtTime(0, t);
    node.gain.linearRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  _noiseSrc() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  tone(freq, dur = 0.12, type = 'sine', vol = 0.15, slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain();
    this._env(g, t, 0.005, vol, dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noiseHit(dur = 0.15, freq = 1200, vol = 0.2, type = 'bandpass', q = 1) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = this._noiseSrc();
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    this._env(g, t, 0.005, vol, dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  ui() { this.tone(880, 0.06, 'triangle', 0.08); }
  uiBack() { this.tone(520, 0.08, 'triangle', 0.08); }
  pickup() { this.tone(1200, 0.08, 'sine', 0.08, 1.5); }
  place() { this.noiseHit(0.08, 600, 0.25, 'lowpass'); this.tone(180, 0.06, 'square', 0.05, 0.6); }
  breakBlock() { this.noiseHit(0.18, 900, 0.3, 'bandpass', 0.8); this.tone(140, 0.1, 'triangle', 0.08, 0.5); }
  footstep(surface = 'soft') { this.noiseHit(0.07, surface === 'hard' ? 2200 : 700, 0.07, 'bandpass', 1.5); }
  land() { this.noiseHit(0.2, 400, 0.25, 'lowpass'); }
  splash() { this.noiseHit(0.5, 1500, 0.2, 'bandpass', 0.5); }
  hurt() { this.tone(220, 0.25, 'sawtooth', 0.12, 0.5); this.noiseHit(0.15, 500, 0.15); }
  shoot() { this.tone(1400, 0.15, 'square', 0.06, 0.25); this.noiseHit(0.05, 3000, 0.08); }
  shipShoot() { this.tone(900, 0.18, 'sawtooth', 0.05, 0.3); }
  enemyShoot() { this.tone(600, 0.2, 'sawtooth', 0.05, 0.4); }
  explosion(size = 1) { this.noiseHit(0.8 * size, 300, 0.45, 'lowpass', 0.5); this.tone(80, 0.6 * size, 'sine', 0.2, 0.4); }
  scan() {
    if (!this.ctx) return;
    this.tone(300, 1.4, 'sine', 0.12, 4);
    setTimeout(() => this.tone(1200, 0.5, 'sine', 0.05, 1.2), 400);
  }
  discover() { [0, 4, 7, 12].forEach((s, i) => setTimeout(() => this.tone(midi(72 + s), 0.5, 'sine', 0.08), i * 110)); }
  // A slow, detuned music-box phrase drowned in reverb: plays when a liminal zone is entered.
  zoneEnter(first) {
    if (!this.ctx) return;
    const c = this.ctx;
    const base = 64 + (this.rootShift || 0);
    const phrase = first ? [12, 7, 3, 7, 0, -5] : [7, 3, 0];
    phrase.forEach((st, i) => {
      const t = c.currentTime + i * 0.42 + 0.05;
      const f = midi(base + st);
      for (const [mul, v] of [[1, 0.05], [4.01, 0.012], [2.76, 0.008]]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mul;
        o.detune.value = -18 + Math.random() * 10;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(v, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        o.connect(g); g.connect(this.reverb); g.connect(this.sfxBus);
        o.start(t); o.stop(t + 2.5);
      }
    });
  }

  // Distant, unexplained sounds for dream worlds. kind: 'thud' | 'door' | 'hum' | 'chime' | 'steps'
  distant(kind) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const out = c.createGain();
    out.gain.value = 1;
    if (pan) { pan.pan.value = (Math.random() * 2 - 1) * 0.9; out.connect(pan); pan.connect(this.reverb); pan.connect(this.sfxBus); }
    else { out.connect(this.reverb); out.connect(this.sfxBus); }
    const noise = (dur, freq, vol, type = 'lowpass', q = 0.7, at = 0) => {
      const s = this._noiseSrc();
      const f = c.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      this._env(g, t + at, 0.01, vol, dur);
      s.connect(f); f.connect(g); g.connect(out);
      s.start(t + at, Math.random()); s.stop(t + at + dur + 0.1);
    };
    const osc = (freq, dur, vol, type = 'sine', slide = 0, at = 0) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t + at);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + at + dur);
      const g = c.createGain();
      this._env(g, t + at, 0.02, vol, dur);
      o.connect(g); g.connect(out);
      o.start(t + at); o.stop(t + at + dur + 0.1);
    };
    if (kind === 'thud') { noise(1.2, 140, 0.16); osc(48, 1.4, 0.1, 'sine', 0.7); }
    else if (kind === 'door') { noise(0.25, 900, 0.05, 'bandpass', 3); noise(1.4, 220, 0.14, 'lowpass', 0.7, 0.18); osc(70, 1, 0.06, 'sine', 0.6, 0.18); }
    else if (kind === 'hum') { osc(60, 5, 0.025, 'sawtooth'); osc(120.4, 5, 0.012, 'square'); }
    else if (kind === 'chime') { [0, 5, 10].forEach((st, i) => osc(midi(83 + st), 3, 0.018, 'sine', 0, i * 0.9)); }
    else if (kind === 'steps') { for (let i = 0; i < 6; i++) noise(0.09, 500, 0.05, 'bandpass', 1.2, i * 0.55 + Math.random() * 0.05); }
  }

  // ---------------- horror ----------------
  _pannedOut(pan = 0, wet = 0.6) {
    const c = this.ctx;
    const out = c.createGain();
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    const dry = c.createGain(); dry.gain.value = 1;
    const rv = c.createGain(); rv.gain.value = wet;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); out.connect(p); p.connect(dry); p.connect(rv); }
    else { out.connect(dry); out.connect(rv); }
    dry.connect(this.sfxBus); rv.connect(this.reverb);
    return out;
  }

  // one "lub-dub"
  heartbeat(vol = 0.2) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    for (const [at, f, v] of [[0, 58, 1], [0.17, 50, 0.7]]) {
      const o = c.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(f * 1.6, t + at); o.frequency.exponentialRampToValueAtTime(f, t + at + 0.09);
      const g = c.createGain(); this._env(g, t + at, 0.008, vol * v, 0.2);
      o.connect(g); g.connect(this.sfxBus); o.start(t + at); o.stop(t + at + 0.3);
    }
  }

  breath(vol = 0.05, pan = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = this._pannedOut(pan, 0.2);
    for (const [at, dur, f] of [[0, 1.1, 900], [1.3, 1.4, 600]]) {
      const n = this._noiseSrc(); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(f, t + at); bp.frequency.linearRampToValueAtTime(f * 1.4, t + at + dur);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t + at); g.gain.linearRampToValueAtTime(vol, t + at + dur * 0.4); g.gain.linearRampToValueAtTime(0, t + at + dur);
      n.connect(bp); bp.connect(g); g.connect(out); n.start(t + at, Math.random()); n.stop(t + at + dur + 0.1);
    }
  }

  // the jumpscare: a torn, detuned shriek
  screech(vol = 0.32) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 6); }
    shaper.curve = curve;
    const g = c.createGain(); this._env(g, t, 0.005, vol, 1.1);
    shaper.connect(g); g.connect(this.sfxBus); g.connect(this.reverb);
    for (const [f, d] of [[1250, 0], [1310, 13], [620, -9], [1880, 5]]) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.32, t + 1.0);
      o.detune.value = d;
      const lfo = c.createOscillator(); const lg = c.createGain(); lfo.frequency.value = 31; lg.gain.value = f * 0.06;
      lfo.connect(lg); lg.connect(o.frequency);
      o.connect(shaper); o.start(t); o.stop(t + 1.2); lfo.start(t); lfo.stop(t + 1.2);
    }
    this.noiseHit(0.5, 2500, vol * 0.8, 'highpass', 0.5);
  }

  // colossal footfall; k = closeness 0..1
  boom(k = 1, pan = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = this._pannedOut(pan, 0.9);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(52, t); o.frequency.exponentialRampToValueAtTime(24, t + 1.4);
    const g = c.createGain(); this._env(g, t, 0.01, 0.34 * k, 1.8);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 2);
    const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180;
    const ng = c.createGain(); this._env(ng, t, 0.01, 0.3 * k, 1.2);
    n.connect(f); f.connect(ng); ng.connect(out); n.start(t, Math.random()); n.stop(t + 1.4);
  }

  // many voices singing one wrong chord
  choir(vol = 0.05, pan = 0, dur = 4) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = this._pannedOut(pan, 1.2);
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 720; f1.Q.value = 5;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1150; f2.Q.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
    f1.connect(g); f2.connect(g); g.connect(out);
    for (const m of [57, 58, 63, 64, 69]) {
      for (const det of [-9, 7]) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(m); o.detune.value = det;
        o.connect(f1); o.connect(f2); o.start(t); o.stop(t + dur + 0.1);
      }
    }
  }

  // a swell that rises and is cut off dead
  swell(vol = 0.12) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(3000, t + 1.2);
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(420, t + 1.2);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 1.2); g.gain.setValueAtTime(0, t + 1.21);
    n.connect(f); f.connect(g); o.connect(g); g.connect(this.sfxBus); g.connect(this.reverb);
    n.start(t, Math.random()); n.stop(t + 1.3); o.start(t); o.stop(t + 1.3);
  }

  whisper(vol = 0.05, pan = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const out = this._pannedOut(pan, 0.8);
    for (let i = 0; i < 5; i++) {
      const at = i * 0.28 + Math.random() * 0.1, dur = 0.2 + Math.random() * 0.25;
      const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 8;
      f.frequency.setValueAtTime(1400 + Math.random() * 1800, t + at); f.frequency.linearRampToValueAtTime(900 + Math.random() * 2400, t + at + dur);
      const g = c.createGain(); this._env(g, t + at, 0.03, vol, dur);
      n.connect(f); f.connect(g); g.connect(out); n.start(t + at, Math.random()); n.stop(t + at + dur + 0.1);
    }
  }

  // dry clicks from something that should not be making them
  clicks(vol = 0.06, pan = 0) {
    if (!this.ctx) return;
    const out = this._pannedOut(pan, 0.4);
    const c = this.ctx, t = c.currentTime;
    for (let i = 0; i < 7; i++) {
      const at = i * (0.05 + Math.random() * 0.04);
      const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 900; f.Q.value = 9;
      const g = c.createGain(); this._env(g, t + at, 0.002, vol, 0.03);
      n.connect(f); f.connect(g); g.connect(out); n.start(t + at, Math.random()); n.stop(t + at + 0.06);
    }
  }

  wet(vol = 0.2) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 8;
    f.frequency.setValueAtTime(300, t); f.frequency.linearRampToValueAtTime(1400, t + 0.15); f.frequency.linearRampToValueAtTime(200, t + 0.5);
    const g = c.createGain(); this._env(g, t, 0.01, vol, 0.6);
    n.connect(f); f.connect(g); g.connect(this.sfxBus); n.start(t, Math.random()); n.stop(t + 0.7);
    this.tone(70, 0.4, 'sawtooth', vol * 0.3, 0.5);
  }

  trackerBeep(k = 0.5) {
    if (!this.ctx) return;
    this.tone(900 + k * 500, 0.07, 'sine', 0.03 + k * 0.03);
  }

  // continuous dread: a low beating drone, and the music draining away
  setDread(k) {
    if (!this.ctx) return;
    const c = this.ctx;
    const L = this._loop('dread', () => {
      const g = c.createGain(); g.gain.value = 0; g.connect(this.sfxBus); g.connect(this.reverb);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; f.connect(g);
      const oscs = [];
      for (const [fr, ty] of [[41.2, 'sine'], [43.1, 'sine'], [61.7, 'triangle'], [87.3, 'sawtooth']]) {
        const o = c.createOscillator(); o.type = ty; o.frequency.value = fr; o.connect(f); o.start(); oscs.push(o);
      }
      const n = this._noiseSrc(); const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 90; nf.Q.value = 3;
      const ng = c.createGain(); ng.gain.value = 0.6; n.connect(nf); nf.connect(ng); ng.connect(g); n.start();
      return { g, f, oscs };
    });
    if (!L) return;
    const t = c.currentTime;
    const v = Math.max(0, k - 0.18) * 0.16;
    L.g.gain.setTargetAtTime(v, t, 0.8);
    L.f.frequency.setTargetAtTime(160 + k * 420, t, 0.8);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * (1 - Math.min(0.85, k * 0.9)), t, 1.2);
  }

  // dry wooden clicking - a Kodama's head rattling
  rattle() {
    if (!this.ctx) return;
    for (let i = 0; i < 9; i++) setTimeout(() => this.noiseHit(0.025, 2600 + Math.random() * 1400, 0.06, 'bandpass', 6), i * 45 + Math.random() * 20);
  }

  alert() { [0, 1, 0, 1].forEach((s, i) => setTimeout(() => this.tone(s ? 760 : 560, 0.15, 'square', 0.06), i * 180)); }
  warning() { this.tone(440, 0.3, 'square', 0.05); setTimeout(() => this.tone(440, 0.3, 'square', 0.05), 400); }
  craft() { this.tone(660, 0.1, 'triangle', 0.08); setTimeout(() => this.tone(990, 0.15, 'triangle', 0.08), 90); }
  alchemy(success) {
    if (success) [0, 3, 7, 10, 14].forEach((s, i) => setTimeout(() => this.tone(midi(67 + s), 0.7, 'sine', 0.07), i * 90));
    else this.tone(200, 0.4, 'triangle', 0.08, 0.7);
  }
  warp() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(60, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 4);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 1);
    g.gain.linearRampToValueAtTime(0, t + 5);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1500;
    o.connect(f); f.connect(g); g.connect(this.sfxBus); g.connect(this.reverb);
    o.start(t); o.stop(t + 5.2);
    this.noiseHit(5, 800, 0.15, 'bandpass', 0.3);
  }

  // ---------------- continuous loops ----------------
  _loop(name, build) {
    if (!this.ctx) return null;
    if (!this.loops[name]) this.loops[name] = build();
    return this.loops[name];
  }

  setLoop(name, on, param = 0) {
    if (!this.ctx) return;
    const c = this.ctx;
    const L = this._loop(name, () => {
      const g = c.createGain();
      g.gain.value = 0;
      g.connect(this.sfxBus);
      const nodes = { g };
      if (name === 'laser') {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 180;
        const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 363;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 2;
        const n = this._noiseSrc(); const nf = c.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 3000;
        const ng = c.createGain(); ng.gain.value = 0.3;
        o.connect(f); o2.connect(f); f.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g);
        o.start(); o2.start(); n.start();
        nodes.o = o; nodes.f = f;
      } else if (name === 'jetpack') {
        const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
        n.connect(f); f.connect(g); n.start();
      } else if (name === 'engine') {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 55;
        const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 110.5;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
        const n = this._noiseSrc(); const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 600;
        const ng = c.createGain(); ng.gain.value = 0.5;
        o.connect(f); o2.connect(f); f.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g);
        o.start(); o2.start(); n.start();
        nodes.o = o; nodes.o2 = o2; nodes.f = f; nodes.nf = nf;
      } else if (name === 'wind') {
        const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.6;
        n.connect(f); f.connect(g); n.start();
        nodes.f = f;
      } else if (name === 'reentry') {
        const n = this._noiseSrc(); const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 1.4;
        const n2 = this._noiseSrc(); const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 1800; f2.Q.value = 0.8;
        const g2 = c.createGain(); g2.gain.value = 0.25;
        n.connect(f); f.connect(g); n2.connect(f2); f2.connect(g2); g2.connect(g); n.start(); n2.start();
        nodes.f = f;
      } else if (name === 'hum') {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 240; f.Q.value = 6;
        o.connect(f); f.connect(g); o.start();
      }
      return nodes;
    });
    if (!L) return;
    const t = c.currentTime;
    const vols = { laser: 0.09, jetpack: 0.1, engine: 0.14, wind: 0.08, hum: 0.025, reentry: 0.3 };
    L.g.gain.setTargetAtTime(on ? vols[name] * (name === 'wind' || name === 'reentry' ? param : 1) : 0, t, on ? 0.05 : 0.12);
    if (name === 'laser' && L.o) L.o.frequency.setTargetAtTime(170 + Math.sin(t * 30) * 12, t, 0.02);
    if (name === 'engine' && on) {
      const k = Math.min(1, param);
      L.o.frequency.setTargetAtTime(45 + k * 70, t, 0.2);
      L.o2.frequency.setTargetAtTime(90.5 + k * 140, t, 0.2);
      L.f.frequency.setTargetAtTime(250 + k * 1400, t, 0.2);
      L.nf.frequency.setTargetAtTime(400 + k * 2400, t, 0.2);
    }
    if (name === 'wind' && L.f) L.f.frequency.setTargetAtTime(300 + param * 500, t, 0.5);
    if (name === 'reentry' && L.f) L.f.frequency.setTargetAtTime(300 + param * 900, t, 0.1);
  }

  stopAllLoops() {
    for (const k of Object.keys(this.loops)) this.setLoop(k, false);
  }
}
