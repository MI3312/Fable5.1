// LUCID SKY - core game controller: renderer, modes (title / surface / space),
// transitions, save/load, economy and the glue between UI and simulation.
import * as THREE from 'three';
import { Input } from '../core/input.js';
import { hashString, RNG, hash32 } from '../core/rng.js';
import { curvatureUniforms } from '../core/shaderlib.js';
import { CURVATURE } from '../config.js';
import { AudioSystem } from '../audio/audio.js';
import { PostFX } from '../post/post.js';
import { Universe, CORE } from '../universe/universe.js';
import { Inventory } from './inventory.js';
import { QUESTS } from './quests.js';
import { HUD } from '../ui/hud.js';
import { Menus } from '../ui/menus.js';
import { GalaxyMap } from '../ui/galaxyMap.js';
import { ITEMS } from '../data/items.js';
import { ALCHEMY, UPGRADES } from '../data/recipes.js';
import { MEMORIES, STATION_CHATTER, ENDING } from '../data/lore.js';
import { B, BLOCKS } from '../world/blocks.js';
import { Ship } from '../entities/ship.js';
import { Player } from '../entities/player.js';
import { Missions } from './missions.js';
import { Corruption } from './corruption.js';
import { SurfaceMode } from './surfaceMode.js';
import { SpaceMode } from './spaceMode.js';
import { floraName } from '../core/names.js';

const SAVE_KEY = 'lucidsky.save.v1';
const SETTINGS_KEY = 'lucidsky.settings.v1';

const DEFAULT_SETTINGS = {
  sensitivity: 1, renderDist: 7, fov: 75, renderScale: 1, master: 0.8, music: 0.55, sfx: 0.8, invertY: false, dreamFx: 0.7, hudFade: true, fear: 1, gfx: 2,
};

function safeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function safeSet(key, v) { try { localStorage.setItem(key, v); return true; } catch (e) { return false; } }

export class Game {
  constructor(canvas, uiRoot) {
    THREE.ColorManagement.enabled = false;
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.renderer.setClearColor(0x000000, 1);
    this.settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(safeGet(SETTINGS_KEY) || '{}')) };
    this.input = new Input(canvas);
    this.audio = new AudioSystem();
    this.post = new PostFX(this.renderer);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.08, 2600);
    this.spaceCamera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.5, 900000);

    this.player = new Player();
    this.inventory = new Inventory(24);
    this.inventory.onChange = () => { this.invDirty = true; };
    this.ship = new Ship(1);
    this.corruption = new Corruption(this);
    this.missions = new Missions(this);
    this.surface = new SurfaceMode(this);
    this.space = new SpaceMode(this);

    this.hud = new HUD(uiRoot);
    this.menus = new Menus(uiRoot, this);
    this.galaxy = new GalaxyMap(uiRoot, this);

    this.mode = 'title';
    this.inShip = false;
    this.time = 0;
    this.transition = null;
    this.state = null;
    this.universe = null;
    this.system = null;
    this.planet = null;
    this.hudHidden = false;
    this.autosaveTimer = 60;
    this.questIndex = 0;

    this.input.onLockChange = (locked) => {
      if (!locked && this.isPlaying() && !this.menus.anyOpen() && !this.galaxy.isOpen() && !this.transition && !this.chatOpen && !this.crashing) {
        this.openPause();
      }
      this.menus.showClickToPlay(false);
    };
    canvas.addEventListener('click', () => {
      this.audio.init();
      if (this.isPlaying() && !this.menus.anyOpen() && !this.galaxy.isOpen()) this.input.lock();
    });
    window.addEventListener('pointerdown', () => this.audio.init(), { once: false });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => { if (this.isPlaying()) this.saveGame(false); });
    this.applySettings();
    this.resize();

    // title backdrop: a random system seen from orbit
    this.titleUniverse = new Universe(Math.floor(Math.random() * 1e9));
    this.titleSystem = this.titleUniverse.getSystem(0, 0, 0);
    this.space.buildScene(this.titleSystem);
    this.menus.showTitle(!!safeGet(SAVE_KEY), this._lastSeed());
    this.audio.setMood('title');
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  _lastSeed() {
    try { return JSON.parse(safeGet(SAVE_KEY)).seed; } catch (e) { return null; }
  }

  isPlaying() { return this.mode === 'surface' || this.mode === 'space'; }

  // ---------------- settings ----------------
  applySettings() {
    const s = this.settings;
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.camera.fov = s.fov; this.camera.updateProjectionMatrix();
    this.spaceCamera.fov = s.fov; this.spaceCamera.updateProjectionMatrix();
    this.surface.setRenderDistance(s.renderDist);
    this.audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    if (this.post.scale !== s.renderScale) { this.post.scale = s.renderScale; this.resize(); }
    this.post.quality = s.gfx ?? 2;
  }

  saveSettings() { safeSet(SETTINGS_KEY, JSON.stringify(this.settings)); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.spaceCamera.aspect = w / h; this.spaceCamera.updateProjectionMatrix();
    this.surface.viewCamera.aspect = w / h; this.surface.viewCamera.updateProjectionMatrix();
    this.post.resize(w, h, pr);
    this.width = w; this.height = h;
  }

  // ---------------- new / continue ----------------
  freshState(seed) {
    return {
      v: 1, seed, playTime: 0, jumps: 0,
      system: { gx: 0, gy: 0, gz: 0 },
      mode: 'surface', planetIndex: 0,
      player: null, inShip: false,
      shipSurface: null, shipSpace: null,
      stats: null, playerUpgrades: null,
      shipData: null,
      inventory: null,
      discoveries: { planets: {}, creatures: {}, flora: {}, systems: {}, structures: {}, zones: {} },
      used: {},
      names: {},
      edits: {},
      alchemyKnown: [],
      lore: [],
      quest: 0,
      flags: {},
      upgrades: {},
      dayTime: {},
    };
  }

  newGame(seedStr) {
    this.audio.init();
    let seed = Number(seedStr);
    if (!seedStr || !Number.isFinite(seed)) seed = hashString(seedStr || String(Math.random()));
    seed = Math.floor(Math.abs(seed)) >>> 0;
    this.state = this.freshState(seed);
    this.universe = new Universe(seed);
    this.inventory = new Inventory(24);
    this.inventory.onChange = () => { this.invDirty = true; };
    this.inventory.add('carbon', 30);
    this.inventory.add('oxygen', 15);
    this.inventory.add('sodium', 10);
    this.inventory.addBlock(B.POOL_TILE, 24);
    this.inventory.addBlock(B.LAMP, 6);
    this.inventory.addBlock(B.DREAM_BLOCK, 8);
    this.player = new Player();
    if (this.ship) this.ship.model.removeFromParent();
    this.ship = new Ship(seed);
    this.ship.fuel.launch = 40;
    this.ship.fuel.pulse = 70;
    this.ship.thrustersRepaired = false;
    this.system = this.universe.getSystem(0, 0, 0);
    this.state.discoveries.systems[this.system.key] = { name: this.system.name };
    this.menus.closeAll(true);
    this.enterSurface(0, { spawn: 'crash' });
  }

  continueGame() {
    this.audio.init();
    let st;
    try { st = JSON.parse(safeGet(SAVE_KEY)); } catch (e) { st = null; }
    if (!st) { this.menus.showTitle(false); return; }
    this.state = { ...this.freshState(st.seed), ...st };
    this.universe = new Universe(st.seed);
    this.inventory = new Inventory(24);
    this.inventory.onChange = () => { this.invDirty = true; };
    this.inventory.load(st.inventory);
    this.player = new Player();
    if (st.stats) Object.assign(this.player.stats, st.stats);
    if (st.playerUpgrades) Object.assign(this.player.upgrades, st.playerUpgrades);
    if (this.ship) this.ship.model.removeFromParent();
    this.ship = new Ship(st.seed);
    if (st.shipData) {
      Object.assign(this.ship.fuel, st.shipData.fuel);
      this.ship.shield = st.shipData.shield;
      this.ship.hull = st.shipData.hull ?? 100;
      this.ship.thrustersRepaired = st.shipData.thrustersRepaired;
      Object.assign(this.ship.upgrades, st.shipData.upgrades || {});
    }
    const s = st.system;
    this.system = this.universe.getSystem(s.gx, s.gy, s.gz);
    this.menus.closeAll(true);
    if (st.mode === 'space') this.enterSpace({ restore: true });
    else if (st.mode === 'station') this.enterStation();
    else this.enterSurface(st.planetIndex, { spawn: 'restore' });
  }

  // ---------------- mode switching ----------------
  enterSurface(planetIndex, opts) {
    this.mode = 'loading';
    this.planet = this.system.planets[planetIndex];
    this.state.planetIndex = planetIndex;
    this.state.mode = 'surface';
    curvatureUniforms.uCurve.value = CURVATURE;
    this.menus.showLoading(opts.spawn === 'entry' ? 'Entering atmosphere' : 'Dreaming', `${this.planet.name} · ${this.planet.params.adjective} ${this.planet.biomeLabel} world`);
    this.hud.show(false);
    this.galaxy.close();
    this.surface.enter(this.planet, opts);
  }

  onSurfaceReady() {
    this.menus.hideLoading();
    this.mode = 'surface';
    this.hud.show(!this.hudHidden);
    const p = this.planet;
    if (p.isStation) {
      this.hud.toast(p.name, 'Docked · Walk to the terminals to trade, upgrade and rest');
      this.audio.setMood('station', this.system.seed);
    } else if (!this.state.discoveries.planets[p.id]) {
      this.state.discoveries.planets[p.id] = { name: p.name, biome: p.biomeLabel, system: this.system.name };
      this.inventory.add('units', 1500);
      this.hud.toast('Planet Discovered', `${p.name} · ${p.params.adjective} ${p.biomeLabel} · +1,500 units`);
      this.audio.discover();
    } else {
      this.hud.toast(p.name, `${p.params.adjective} ${p.biomeLabel} · ${this.system.name}`);
    }
    if (!this.state.flags.intro && !p.isStation) {
      this.state.flags.intro = true;
      this.input.unlock();
      setTimeout(() => this.menus.dialog('You wake up',
        `The ground is warm. The sky is the wrong colour. Your starship lies a few steps away, its launch thrusters crushed.\n\n` +
        `WASD move · Mouse look · Space jump / jetpack · Shift sprint\n` +
        `LMB use multi-tool · Q switch Mining Beam / Builder / Boltcaster\n` +
        `F scanner · V analysis visor · E interact · R recharge · Tab inventory · M galaxy map\n\n` +
        `Follow the objective on the left. Mine, build, dream - and find your way to the Dream Core.`,
        [{ label: 'Begin', primary: true, action: () => this.resume() }]), 600);
      return;
    }
    if (!this.input.locked) this.resume();
  }

  enterSpace(opts = {}) {
    this.mode = 'space';
    this.state.mode = 'space';
    curvatureUniforms.uCurve.value = 0;
    this.menus.hideLoading();
    this.hud.show(!this.hudHidden);
    this.space.enter(this.system, opts);
    this.inShip = true;
    if (!this.state.flags.reachedSpace && opts.fromPlanet != null) {
      this.state.flags.reachedSpace = true;
    }
    if (!this.input.locked) this.resume();
  }

  // Dock: walk around the station interior
  enterStation() {
    this.inStation = true;
    const sp = this.universe.stationPlanet(this.system);
    this.mode = 'loading';
    this.planet = sp;
    this.state.mode = 'station';
    curvatureUniforms.uCurve.value = 0;
    this.menus.showLoading('Docking', `${sp.name} · ${this.system.name}`);
    this.hud.show(false);
    this.galaxy.close();
    this.surface.enter(sp, { spawn: 'dock' });
    curvatureUniforms.uCurve.value = 0;
  }

  // ---------------- pocket spaces ----------------
  _enterPocket(pl, spawn, title, sub, color) {
    this.mode = 'loading';
    this.planet = pl;
    curvatureUniforms.uCurve.value = 0;
    this.menus.showLoading(title, sub);
    this.hud.show(false);
    this.galaxy.close();
    this.surface.enter(pl, { spawn });
    curvatureUniforms.uCurve.value = 0;
    void color;
  }

  // The Void: touched through a void block, left the same way. Your ship stays behind.
  enterVoid() {
    if (this.inPocket || this.transition) return;
    const p = this.player, sh = this.ship;
    this.pocketReturn = {
      planetIndex: this.state.planetIndex, pos: p.pos.clone(), yaw: p.yaw,
      ship: { x: sh.pos.x, y: sh.pos.y, z: sh.pos.z, yaw: sh.yaw(), state: sh.state },
    };
    this.surface.exportEdits();
    this.state.flags.voidVisits = (this.state.flags.voidVisits || 0) + 1;
    this.fade(0.25, () => {
      this.surface.leave();
      this.inPocket = 'void';
      this.ship.model.visible = false;
      this._enterPocket(this.universe.pocketPlanet('void', this.system, 404), 'void', '', '');
    }, 0x000000);
  }

  exitVoid() {
    if (this.inPocket !== 'void' || this.transition) return;
    const R = this.pocketReturn;
    this.fade(0.25, () => {
      this.surface.exportEdits();
      this.surface.leave();
      this.inPocket = null;
      this.ship.model.visible = true;
      this.state.player = { x: R.pos.x, y: R.pos.y, z: R.pos.z, yaw: R.yaw + Math.PI, pitch: 0 };
      this.state.inShip = false;
      this.state.shipSurface = R.ship;
      this.enterSurface(R.planetIndex, { spawn: 'restore' });
    }, 0x000000);
  }

  // Derelict freighters: docked from space, like a station
  enterDerelict(seed) {
    if (this.inPocket) return;
    this.inPocket = 'derelict';
    this.derelictSeed = seed;
    const dp = this.universe.pocketPlanet('derelict', this.system, seed);
    this._enterPocket(dp, 'derelict', 'Docking', `${dp.name} · no life signs`);
  }

  leaveDerelict() {
    this.fade(0.5, () => {
      this.surface.exportEdits();
      this.surface.leave();
      this.inPocket = null;
      this.planet = null;
      this.enterSpace({ fromDerelict: true });
      this.saveGame(false);
    });
  }

  shipDestroyed() {
    const lostU = Math.floor(this.inventory.units * 0.15);
    this.inventory.remove('units', lostU);
    const tr = this.inventory.count('tritium');
    if (tr) this.inventory.remove('tritium', tr);
    this.fade(1.2, () => {
      this.space.leave();
      this.ship.shield = 60;
      this.ship.hull = 60;
      this.enterStation();
      setTimeout(() => this.menus.dialog('Rescued', `Your starship was torn apart by the Nightmares. Station drones towed what was left of you back to the hangar.\n\nLost ${lostU.toLocaleString()} units${tr ? ' and your Tritium' : ''}.`), 2500);
    }, 0x300010);
  }

  launchFromStation() {
    this.fade(0.5, () => {
      this.surface.leave();
      this.inStation = false;
      this.planet = null;
      this.enterSpace({ fromStation: true });
      this.saveGame(false);
    });
  }

  // Leave planet -> space (called by surface mode)
  leavePlanet() {
    const idx = this.state.planetIndex;
    this.surface.exportEdits();
    const dir = this.surface.exitDirection();
    this.fade(0.6, () => {
      this.surface.leave();
      this.enterSpace({ fromPlanet: idx, dir });
      this.hud.toast('Space', `${this.system.name} system`);
    });
  }

  // Approach planet from space
  enterPlanetFromSpace(idx, dir, worldDir) {
    this.fade(0.8, () => {
      this.space.leave();
      this.enterSurface(idx, { spawn: 'entry', dir, worldDir });
    }, 0xffd8b0);
  }

  fade(dur, mid, color = 0x000000) {
    this.transition = { t: 0, dur, mid, phase: 0, color };
    this.post.uniforms.uFadeColor.value.set(color);
  }

  _updateTransition(dt) {
    const tr = this.transition;
    if (!tr) return;
    tr.t += dt;
    if (tr.phase === 0) {
      this.post.uniforms.uFade.value = Math.min(1, tr.t / tr.dur);
      if (tr.t >= tr.dur) {
        tr.phase = 1; tr.t = 0;
        try { tr.mid(); } catch (e) { console.error(e); }
      }
    } else {
      if (this.mode === 'loading') { tr.t = 0; this.post.uniforms.uFade.value = 1; return; }
      this.post.uniforms.uFade.value = Math.max(0, 1 - tr.t / tr.dur);
      if (tr.t >= tr.dur) { this.transition = null; this.post.uniforms.uFade.value = 0; }
    }
  }

  // ---------------- warp ----------------
  hyperdriveRange() { return 5 + (this.upgradeCount('hyperdrive') * 3); }

  startWarp(gx, gy, gz) {
    if (this.mode !== 'space') return;
    const useCore = this.inventory.count('warp_cell') <= 0;
    if (!this.inventory.remove(useCore ? 'lucid_core' : 'warp_cell', 1)) return;
    this.resume();
    this.space.beginWarp(() => {
      this.system = this.universe.getSystem(gx, gy, gz);
      this.state.system = { gx, gy, gz };
      this.state.jumps++;
      const first = !this.state.discoveries.systems[this.system.key];
      this.state.discoveries.systems[this.system.key] = { name: this.system.name };
      this.space.enter(this.system, { arrival: true });
      if (this.system.isCore) {
        this.state.flags.reachedCore = true;
        this.hud.toast('The Dream Core', 'You have arrived at the heart of the galaxy.');
        setTimeout(() => this.showEnding(), 6000);
      } else {
        this.hud.toast(this.system.name, `${this.system.star.label} star · ${this.system.planets.length} planets${first ? ' · New system discovered' : ''}`);
        if (first) { this.inventory.add('units', 2500); this.inventory.add('nanites', 10); }
      }
      this.saveGame(false);
    });
  }

  showEnding() {
    this.input.unlock();
    this.menus.showEnding(ENDING, () => {
      this.inventory.add('nanites', 500);
      this.inventory.add('units', 100000);
      this.hud.toast('Lucid', 'The galaxy is yours to dream. +100,000 units, +500 nanites');
      this.resume();
    });
  }

  coreDistanceLabel() {
    if (!this.state) return '';
    const s = this.state.system;
    const d = this.universe.distanceToCore(s.gx, s.gy, s.gz);
    return d < 0.01 ? 'Arrived' : `${Math.round(d * 100)} ly`;
  }

  locationLabel() {
    if (this.mode === 'space') return `${this.system.name} system · Space`;
    if (this.inStation) return `${this.system.station.name} · ${this.system.name}`;
    if (this.planet) return `${this.planet.name} · ${this.system.name}`;
    return '';
  }

  // ---------------- menus ----------------
  openPause() {
    this.pauseOpenedAt = this.time;
    this.input.unlock();
    this.menus.openPause();
  }

  openInventory(tab) {
    this.input.unlock();
    this.menus.openInventory(tab);
    this.audio.ui();
  }

  resume() {
    this.menus.closeAll(true);
    this.galaxy.close();
    this.menus.showClickToPlay(false);
    this.input.lock();
    setTimeout(() => {
      if (!this.input.locked && this.isPlaying() && !this.menus.anyOpen() && !this.galaxy.isOpen()) this.menus.showClickToPlay(true);
    }, 400);
  }

  onMenuClosed(which) {
    if (which === 'inventory' || which === 'dialog' || which === 'pause') this.resume();
  }

  quitToTitle() {
    this.menus.closeAll(true);
    this.galaxy.close();
    this.input.unlock();
    this.surface.leave();
    this.space.leave();
    this.hud.show(false);
    this.mode = 'title';
    curvatureUniforms.uCurve.value = 0;
    this.audio.stopAllLoops();
    this.space.buildScene(this.titleSystem);
    this.menus.showTitle(!!safeGet(SAVE_KEY), this.state ? this.state.seed : null);
    this.audio.setMood('title');
  }

  // ---------------- saving ----------------
  saveGame(announce) {
    if (!this.state || !this.isPlaying()) return false;
    const st = this.state;
    st.inventory = this.inventory.serialize();
    st.stats = { ...this.player.stats };
    st.playerUpgrades = { ...this.player.upgrades };
    st.shipData = { fuel: { ...this.ship.fuel }, shield: this.ship.shield, hull: this.ship.hull, thrustersRepaired: this.ship.thrustersRepaired, upgrades: { ...this.ship.upgrades } };
    if (this.mode === 'surface') this.surface.writeState(st);
    else this.space.writeState(st);
    const ok = safeSet(SAVE_KEY, JSON.stringify(st));
    if (announce) {
      this.hud.notify(ok ? 'Journey recorded' : 'Save failed (storage full?)');
      this.audio.ui();
    }
    return ok;
  }

  // ---------------- economy / items ----------------
  sellPrice(id) {
    const it = ITEMS[id];
    const mod = 0.75 + (hash32(this.system.seed, hashString(id)) % 100) / 400;
    return Math.max(1, Math.round(it.value * mod));
  }

  stationStock() {
    const rng = new RNG(this.system.seed ^ 0x5707);
    const pool = ['dihydrogen_jelly', 'launch_fuel', 'tritium', 'metal_plating', 'chromatic_metal', 'microprocessor', 'antimatter', 'antimatter_housing', 'ion_battery', 'life_support_gel', 'starshield_battery', 'sodium_nitrate', 'cobalt', 'copper', 'carbon_nanotubes', 'chroma_shard', 'somnium'];
    const picks = rng.shuffle(pool.slice()).slice(0, 9);
    if (!picks.includes('warp_cell')) picks.push('warp_cell');
    return picks.map((id) => [id, Math.round(ITEMS[id].value * (1.15 + rng.next() * 0.3))]);
  }

  sell(id, n) {
    n = Math.min(n, this.inventory.count(id));
    if (n <= 0) return;
    const p = this.sellPrice(id) * n;
    this.inventory.remove(id, n);
    this.inventory.add('units', p);
    this.audio.pickup();
  }

  buy(id, n, price) {
    const space = this.inventory.spaceFor(id);
    n = Math.min(n, space, Math.floor(this.inventory.units / price));
    if (n <= 0) { this.hud.notify('Not enough units or cargo space'); return; }
    this.inventory.remove('units', n * price);
    this.inventory.add(id, n);
    this.audio.pickup();
  }

  stationService(kind, cost) {
    if (!this.inventory.remove('units', cost) && cost > 0) return;
    if (kind === 'pulse') this.ship.fuel.pulse = 100;
    if (kind === 'launch') this.ship.fuel.launch = 100;
    if (kind === 'shield') this.ship.shield = 100;
    if (kind === 'hull') this.ship.hull = 100;
    if (kind === 'suit') Object.assign(this.player.stats, { health: 100, shield: 100, hazard: 100, life: 100, jet: 100 });
    this.audio.craft();
  }

  stationChatter() {
    return STATION_CHATTER[Math.floor(this.time / 20) % STATION_CHATTER.length];
  }

  naniteCost(u) { return { jetpack: 120, hazard: 140, life: 110, mining: 180, scanner: 260, slots: 150, pulse: 220, hyperdrive: 300, deflector: 200 }[u.id] || 200; }

  buyUpgrade(u, cost) {
    if (!this.inventory.remove('nanites', cost)) return;
    this._applyUpgrade(u);
  }

  upgradeCount(id) { return (this.state && this.state.upgrades[id]) || 0; }

  installUpgrade(u) {
    const n = this.upgradeCount(u.id);
    if ((u.once && n > 0) || (u.max && n >= u.max)) return;
    if (!this.inventory.consume(u.cost)) { this.hud.notify('Missing materials'); return; }
    this._applyUpgrade(u);
  }

  _applyUpgrade(u) {
    this.state.upgrades[u.id] = this.upgradeCount(u.id) + 1;
    switch (u.id) {
      case 'repair_thrusters': this.ship.thrustersRepaired = true; break;
      case 'jetpack': this.player.upgrades.jet = 1.5; break;
      case 'hazard': this.player.upgrades.hazard = 1.6; break;
      case 'life': this.player.upgrades.life = 1.5; break;
      case 'mining': this.player.upgrades.mining = 1.6; break;
      case 'scanner': this.player.upgrades.scanner = 2; break;
      case 'slots': this.inventory.expand(6); break;
      case 'pulse': this.ship.upgrades.pulse = 1.4; break;
      case 'deflector': this.ship.upgrades.shield = 1.5; break;
      default: break;
    }
    this.hud.toast('Technology Installed', u.name);
    this.audio.craft();
  }

  craft(recipe, times) {
    times = Math.max(1, Math.floor(times));
    const [outId, outN] = recipe.out;
    if (!outId.startsWith('block:') && outId !== 'nanites') {
      const space = this.inventory.spaceFor(outId);
      times = Math.min(times, Math.floor(space / outN));
      if (times <= 0) { this.hud.notify('Not enough cargo space'); return false; }
    }
    if (!this.inventory.consume(recipe.in, times)) return false;
    this.inventory.add(outId, outN * times);
    this.audio.craft();
    this.hud.notify(`Fabricated ${outN * times}× ${outId.startsWith('block:') ? BLOCKS[Number(outId.slice(6))].name : outId === 'nanites' ? 'Nanites' : ITEMS[outId].name}`);
    return true;
  }

  alchemy(a, b) {
    const inv = this.inventory;
    const need = a === b ? [[a, 2]] : [[a, 1], [b, 1]];
    if (!inv.has(need)) return;
    const idx = ALCHEMY.findIndex((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    if (idx < 0) {
      // failed dream: lose one of the ingredients, gain somnium sometimes
      inv.remove(a, 1);
      this.audio.alchemy(false);
      const msg = ['The dream dissolves.', 'Nothing remembers this combination.', 'It fades like a word on waking.'][Math.floor(Math.random() * 3)];
      this.hud.notify(msg);
      return;
    }
    inv.consume(need);
    const r = ALCHEMY[idx];
    const [id, n] = r.out;
    if (id === 'lore') {
      const m = MEMORIES[Math.floor(Math.random() * MEMORIES.length)];
      this.addLore(m);
      this.menus.dialog('A Memory Surfaces', m);
    } else inv.add(id, n);
    const first = !this.state.alchemyKnown.includes(idx);
    if (first) {
      this.state.alchemyKnown.push(idx);
      this.hud.toast('Dream Remembered', `${a === b ? ITEMS[a].name + ' ×2' : ITEMS[a].name + ' + ' + ITEMS[b].name}`);
      inv.add('nanites', 5);
    }
    this.audio.alchemy(true);
  }

  nameOf(obj) {
    return (this.state && this.state.names && this.state.names[obj.id]) || obj.name;
  }

  rename(obj, name) {
    if (!this.state.names) this.state.names = {};
    this.state.names[obj.id] = name.slice(0, 28);
    const d = this.state.discoveries;
    if (d.planets[obj.id]) d.planets[obj.id].custom = this.state.names[obj.id];
    if (d.creatures[obj.id]) d.creatures[obj.id].custom = this.state.names[obj.id];
    this.inventory.add('units', 250);
    this.hud.notify(`Discovery uploaded as "${this.state.names[obj.id]}" (+250 units)`);
    this.audio.discover();
  }

  addLore(text) {
    if (!this.state.lore.includes(text)) this.state.lore.push(text);
  }

  itemUse(id) {
    return {
      oxygen: 'Recharge life support', life_support_gel: 'Recharge life support', sodium: 'Recharge hazard protection',
      sodium_nitrate: 'Recharge hazard protection', ion_battery: 'Recharge hazard protection', dihydrogen_jelly: 'Fuel launch thrusters',
      launch_fuel: 'Fuel launch thrusters', uranium: 'Fuel launch thrusters', tritium: 'Fuel pulse engine', starshield_battery: 'Recharge ship shields',
      memory_fragment: 'Remember', carbon: 'Recharge exosuit shield',
    }[id] || null;
  }

  useItem(id) {
    switch (id) {
      case 'oxygen': case 'life_support_gel': return this.rechargeStat('life', id);
      case 'sodium': case 'sodium_nitrate': case 'ion_battery': return this.rechargeStat('hazard', id);
      case 'carbon': return this.rechargeStat('shield', id);
      case 'dihydrogen_jelly': case 'launch_fuel': case 'uranium': return this.refuelShip('launch', id);
      case 'tritium': return this.refuelShip('pulse', id);
      case 'starshield_battery': return this.refuelShip('shield', id);
      case 'memory_fragment': {
        if (!this.inventory.remove(id, 1)) return;
        const m = MEMORIES[(this.state.lore.length + Math.floor(Math.random() * 3)) % MEMORIES.length];
        this.addLore(m);
        this.menus.dialog('A Memory Surfaces', m, [{ label: 'Close', primary: true, action: () => this.openInventory() }]);
        return;
      }
      default: return;
    }
  }

  rechargeStat(stat, item) {
    const per = { oxygen: 3, life_support_gel: 100, sodium: 3, sodium_nitrate: 8, ion_battery: 100, carbon: 2 }[item];
    const st = this.player.stats;
    const missing = 100 - st[stat];
    if (missing < 1) { this.hud.notify('Already full'); return false; }
    const need = Math.min(this.inventory.count(item), Math.ceil(missing / per));
    if (need <= 0) return false;
    this.inventory.remove(item, need);
    st[stat] = Math.min(100, st[stat] + need * per);
    this.hud.notify(`Recharged ${stat === 'life' ? 'life support' : stat === 'hazard' ? 'hazard protection' : 'shield'} (-${need} ${ITEMS[item].name})`);
    this.audio.craft();
    return true;
  }

  refuelShip(kind, item) {
    const ship = this.ship;
    const per = { dihydrogen_jelly: 50, launch_fuel: 100, uranium: 2, tritium: 1, starshield_battery: 100, ferrite: 0.5, metal_plating: 50 }[item];
    const cur = kind === 'shield' ? ship.shield : kind === 'hull' ? ship.hull : ship.fuel[kind];
    const missing = 100 - cur;
    if (missing < 1) { this.hud.notify('Already full'); return false; }
    const need = Math.min(this.inventory.count(item), Math.ceil(missing / per));
    if (need <= 0) return false;
    this.inventory.remove(item, need);
    const v = Math.min(100, cur + need * per);
    if (kind === 'shield') ship.shield = v; else if (kind === 'hull') ship.hull = v; else ship.fuel[kind] = v;
    this.hud.notify(`${{ shield: 'Shields', hull: 'Hull', launch: 'Launch thrusters', pulse: 'Pulse engine' }[kind]} at ${Math.round(v)}%`);
    this.audio.craft();
    return true;
  }

  discoveryInfo() {
    if (this.mode !== 'surface' || !this.planet) return { planet: null };
    const d = this.state.discoveries;
    const fauna = this.surface.creatures.species.map((sp) => ({ sp, found: !!d.creatures[sp.id] }));
    const floraIds = [...new Set(this.planet.params.flora.plants.map((p) => p[0]))];
    const flora = floraIds.map((bid) => {
      const key = `${this.planet.id}:${bid}`;
      return { name: floraName(hash32(this.planet.seed, bid)), kind: BLOCKS[bid].name, found: !!d.flora[key] };
    });
    return { planet: this.planet, fauna, flora };
  }

  questLog() {
    const qi = this.state.quest;
    return QUESTS.map((q, i) => ({ title: q.title, desc: q.desc, done: i < qi, current: i === qi }));
  }

  _updateQuests(dt) {
    this.questTimer = (this.questTimer || 0) - dt;
    if (this.questTimer > 0) return;
    this.questTimer = 0.5;
    let qi = this.state.quest;
    while (qi < QUESTS.length - 1 && QUESTS[qi].check(this)) {
      qi++;
      this.state.quest = qi;
      this.hud.toast('Objective Complete', QUESTS[qi - 1].title);
      this.audio.discover();
      this.inventory.add('units', 500);
    }
    const q = QUESTS[qi];
    this.hud.setQuest(q.title, q.desc, q.progress ? q.progress(this) : '');
    this.hud.setMission(this.missions.hudLine());
  }

  // ---------------- main loop ----------------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    if (this.debugHold) { this.render(); return; }
    this.tick(dt);
    this.render();
  }

  // One simulation step (also used by automated tests)
  tick(dt) {
    this.frames = (this.frames || 0) + 1;
    this.time += dt;
    const input = this.input;
    this.audio.update(dt);

    // global hotkeys
    if (this.isPlaying() && !this.transition) {
      if (input.rawHit('Escape') && this.time - (this.pauseOpenedAt || -9) > 0.35) {
        if (this.galaxy.isOpen()) { this.galaxy.close(); this.resume(); }
        else if (this.menus.anyOpen()) { this.menus.closeAll(true); this.resume(); }
        else this.openPause();
      }
      if (input.rawHit('Tab') || input.rawHit('KeyI')) {
        if (this.menus.open === 'inventory') { this.menus.closeAll(true); this.resume(); }
        else if (!this.menus.anyOpen() && !this.galaxy.isOpen()) this.openInventory();
      }
      if (input.rawHit('KeyM') && this.menus.open !== 'station') {
        if (this.galaxy.isOpen()) { this.galaxy.close(); this.resume(); }
        else if (!this.menus.anyOpen()) { this.input.unlock(); this.galaxy.open(); this.audio.ui(); }
      }
      if (input.rawHit('F2')) { this.hudHidden = !this.hudHidden; this.hud.show(!this.hudHidden); }
      // chat: somebody might answer
      if ((input.rawHit('Enter') || input.rawHit('Slash')) && this.mode === 'surface' && !this.menus.anyOpen() && !this.galaxy.isOpen() && !this.chatOpen && !this.crashing) {
        this.chatOpen = true;
        this.input.unlock();
        this.hud.openChat((text) => this.corruption.onChat(text), () => { this.chatOpen = false; this.resume(); });
      }
    }
    // a crash that is not a crash
    if (this.crashT > 0) {
      this.crashing = true;
      this.crashT -= dt;
      if (this.crashT <= 0) {
        this.crashing = false;
        const f = this.onCrashEnd; this.onCrashEnd = null;
        if (f) f();
        this.resume();
      }
    }
    const paused = this.menus.anyOpen() || this.galaxy.isOpen() || this.crashing;
    // Input is only live while pointer-locked and nothing is open
    input.enabled = !paused && !this.chatOpen;

    if (this.mode === 'title') {
      this.space.updateTitle(dt);
    } else if (this.mode === 'loading') {
      this.surface.updateLoading(dt);
    } else if (this.mode === 'surface') {
      this.state.playTime += paused ? 0 : dt;
      this.surface.update(paused ? 0 : dt, paused);
      if (!paused) this._updateQuests(dt);
    } else if (this.mode === 'space') {
      this.state.playTime += paused ? 0 : dt;
      this.space.update(paused ? 0 : dt, paused);
      if (!paused) this._updateQuests(dt);
    }
    if (this.galaxy.isOpen()) this.galaxy.draw();
    if (this.invDirty && this.menus.open === 'inventory') { this.invDirty = false; }
    this._updateTransition(dt);
    if (this.mode !== 'surface') this.hud.setCalm(0, dt);
    this.hud.update(dt);

    if (this.isPlaying() && !paused) {
      this.autosaveTimer -= dt;
      if (this.autosaveTimer <= 0) { this.autosaveTimer = 90; this.saveGame(false); }
    }

    // post uniforms
    const pu = this.post.uniforms;
    pu.uTime.value = this.time;
    pu.uDamage.value = Math.max(0, pu.uDamage.value - dt * 1.5);
    input.endFrame();
  }

  render() {
    // sometimes the picture simply stops
    const C = this.corruption;
    if (C && C.freezeT > 0) { C.freezeT -= 1 / 60; return; }
    if (this.mode === 'surface' || (this.mode === 'loading' && this.surface.active)) {
      this.surface.preRender();
      this.post.render(this.surface.renderPasses());
    } else {
      this.post.render([{ scene: this.space.scene, camera: this.spaceCamera }], { ao: false, bloom: 0.8 });
    }
  }

  closeStationMenu() {
    this.menus.closeAll(true);
    this.resume();
  }
}
