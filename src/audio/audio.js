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
      } else if (name === 'hum') {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 240; f.Q.value = 6;
        o.connect(f); f.connect(g); o.start();
      }
      return nodes;
    });
    if (!L) return;
    const t = c.currentTime;
    const vols = { laser: 0.09, jetpack: 0.1, engine: 0.14, wind: 0.08, hum: 0.025 };
    L.g.gain.setTargetAtTime(on ? vols[name] * (name === 'wind' ? param : 1) : 0, t, on ? 0.05 : 0.12);
    if (name === 'laser' && L.o) L.o.frequency.setTargetAtTime(170 + Math.sin(t * 30) * 12, t, 0.02);
    if (name === 'engine' && on) {
      const k = Math.min(1, param);
      L.o.frequency.setTargetAtTime(45 + k * 70, t, 0.2);
      L.o2.frequency.setTargetAtTime(90.5 + k * 140, t, 0.2);
      L.f.frequency.setTargetAtTime(250 + k * 1400, t, 0.2);
      L.nf.frequency.setTargetAtTime(400 + k * 2400, t, 0.2);
    }
    if (name === 'wind' && L.f) L.f.frequency.setTargetAtTime(300 + param * 500, t, 0.5);
  }

  stopAllLoops() {
    for (const k of Object.keys(this.loops)) this.setLoop(k, false);
  }
}
