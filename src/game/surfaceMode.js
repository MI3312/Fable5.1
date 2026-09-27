// Planet surface gameplay: exploration on foot, multi-tool (mining / building / combat),
// scanning & discovery, survival hazards, weather, day/night, ship landing & take-off.
import * as THREE from 'three';
import { RNG, hash32, lerp, smoothstep, clamp } from '../core/rng.js';
import { floraName } from '../core/names.js';
import { createAtlasTexture } from '../world/atlas.js';
import { createVoxelMaterials, voxelUniforms } from '../world/voxelMaterial.js';
import { World } from '../world/world.js';
import { B, BLOCKS, IS_LIQUID, IS_CROSS, IS_AIRLIKE, IS_SOLID, isPlaceable } from '../world/blocks.js';
import { planStructure, REGION, STRUCTURE_INFO } from '../world/structures.js';
import { ZONE_INFO, ZONE_ATMOS } from '../world/zones.js';
import { Sky, Clouds, Weather } from '../surface/sky.js';
import { Giants } from '../surface/giants.js';
import { Horror } from './horror.js';
import { Riding } from './riding.js';
import { SunShadows, castShadows } from '../world/shadows.js';
import { VolumetricClouds } from '../surface/volclouds.js';
import { Exocraft } from './exocraft.js';
import { SkyEvents } from '../surface/skyevents.js';
import { Fishing } from './fishing.js';
import { shipName, specLabel, tradeIn } from '../data/ships.js';
import { Moves } from './moves.js';
import { Grenades } from './grenades.js';
import { Encounters } from './encounters.js';
import { DamageNumbers } from '../ui/damageNumbers.js';
import { CROPS, BASE_RADIUS } from './bases.js';
import { Debris, Beam, ScanPulse, Bolts, makeSelectionBox } from '../surface/effects.js';
import { CreatureManager } from '../entities/creatures.js';
import { SentinelManager } from '../entities/sentinels.js';
import { buildTraveller } from '../entities/shipModel.js';
import { buildMultitool, animateMultitool } from '../entities/multitool.js';
import { STATION_FLOOR, STATION_PADS, STATION_TERMINALS, STATION_NPCS } from '../world/station.js';
import { STATION_CHATTER, DERELICT_LOGS, VOID_TV } from '../data/lore.js';
import { VOID_SPAWN, VOID_FLOOR, DERELICT_PAD, DERELICT_FLOOR, derelictTerminals } from '../world/pockets.js';
import { Universe } from '../universe/universe.js';
import { ITEMS } from '../data/items.js';
import { MONOLITH, TERMINAL, DREAM_WHISPERS } from '../data/lore.js';
import { SURFACE_ENTRY_ALT } from '../config.js';

const TOOL_MODES = ['Mining Beam', 'Builder', 'Boltcaster', 'Dream Line'];
const TOOL_COLORS = [0x6ff3ff, 0xffa6ec, 0xffa45a, 0x9ff0c8];
const RESOURCE_BLOCKS = [B.FERRITE_ORE, B.COPPER_ORE, B.GOLD_ORE, B.URANIUM_ORE, B.COBALT_ORE, B.SODIUM_PLANT, B.OXYGEN_PLANT, B.DIHYDRO, B.SPECIAL_PLANT, B.CRYSTAL, B.CHEST, B.POD];
const RESOURCE_ICON = {
  [B.FERRITE_ORE]: ['Fe', '#c6ccd4'], [B.COPPER_ORE]: ['Cu', '#e88a3c'], [B.GOLD_ORE]: ['Au', '#f7d046'], [B.URANIUM_ORE]: ['U', '#6be05a'],
  [B.COBALT_ORE]: ['Co', '#6c8dff'], [B.SODIUM_PLANT]: ['Na', '#f1b637'], [B.OXYGEN_PLANT]: ['O2', '#ff6060'], [B.DIHYDRO]: ['H', '#5aa7ff'],
  [B.SPECIAL_PLANT]: ['✿', '#9cff6b'], [B.CRYSTAL]: ['Cr', '#e07bff'], [B.CHEST]: ['▣', '#ffd9a8'], [B.POD]: ['◈', '#7ef0ff'],
};
const HAZARD_COLORS = { heat: [1, 0.45, 0.1], cold: [0.5, 0.8, 1], toxic: [0.6, 1, 0.2], radiation: [0.4, 1, 0.5], vacuum: [0.6, 0.6, 0.8], none: [1, 1, 1] };
const LOOT_DREAM = ['chroma_shard', 'somnium', 'liquid_light', 'echo_shell', 'memory_fragment', 'static_bloom'];
const LOOT_TECH = ['metal_plating', 'dihydrogen_jelly', 'carbon_nanotubes', 'ion_battery', 'chromatic_metal', 'gold', 'cobalt', 'microprocessor', 'antimatter'];

const POINT_LIGHT_COLORS = {
  [B.LIGHT_PANEL]: [0.72, 0.76, 0.8], [B.LAMP]: [1.0, 0.78, 0.5], [B.NEON]: [1.0, 0.35, 0.85], [B.SODIUM_PLANT]: [0.9, 0.65, 0.2],
  [B.DIHYDRO]: [0.3, 0.55, 1.0], [B.STARRY]: [0.4, 0.3, 0.9], [B.POD]: [0.35, 0.85, 1.0], [B.SENTINEL_PILLAR]: [1.0, 0.18, 0.12],
  [B.EMERGENCY]: [1.0, 0.1, 0.06], [B.MISSING]: [0.9, 0.0, 0.9], [B.TV]: [0.7, 0.75, 0.85],
};

const VERMIN_DROPS = {
  kodama: ['kodama_rattle', 1, 1], gel: ['gel_core', 1, 2], bubblebear: ['bubble_foam', 2, 4], wildebeest: ['table_hide', 1, 3], manikin: ['memory_fragment', 1, 1],
  sandmaw: ['maw_tooth', 2, 4], spitter: ['acid_gland', 1, 2], swarm: ['mote_dust', 2, 5], brute: ['carapace_plate', 2, 3], lurker: ['lurker_heart', 1, 1],
};
const ENC_OFFS = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [7, 7], [-7, -7], [7, -7], [-7, 7]];
const _v = new THREE.Vector3();
// blocks a ship can't set down on (trees, plants, furniture of the world)
const LAND_ALT = 70;
const FUNCTIONAL = new Set([B.BASE_CORE, B.TELEPORTER, B.PLANTER, B.STORAGE, B.NUTRIENT]);
const W_above = (W, h) => W.getBlock(h.x, h.y + 1, h.z);
const SITE_OBSTACLE = new Set([B.LOG, B.LEAVES, B.MUSHROOM_STEM, B.MUSHROOM_CAP, B.CACTUS, B.CORAL, B.CLOUD, B.CRYSTAL, B.MONOLITH, B.SENTINEL_PILLAR, B.CHEST, B.CHEST_OPEN, B.POD, B.POD_OPEN, B.LAMP, B.TERMINAL, B.EYE, B.GLASS, B.HULL]);
const _c = new THREE.Color();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class SurfaceMode {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xffffff, 0.01);
    this.atlas = createAtlasTexture();
    this.materials = createVoxelMaterials(this.atlas);
    this.world = new World(this.scene, this.materials);
    this.sky = new Sky(this.scene);
    this.giants = new Giants(this.scene);
    this.horror = new Horror(this.scene);
    this.riding = new Riding(this);
    game.corruption.attach(this.scene);
    this.torchSpot = new THREE.SpotLight(0xfff0dd, 0, 40, 0.42, 0.55, 1.1);
    this.scene.add(this.torchSpot);
    this.scene.add(this.torchSpot.target);
    this.clouds = new Clouds(this.scene);
    this.weather = new Weather(this.scene);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.6);
    this.scene.add(this.sunLight, this.sunLight.target, this.hemi);
    this.debris = new Debris(this.scene);
    this.beam = new Beam(this.scene);
    this.pulse = new ScanPulse(this.scene);
    this.bolts = new Bolts(this.scene);
    this.selection = makeSelectionBox();
    this.scene.add(this.selection);
    this.creatures = new CreatureManager(this.scene);
    this.shadows = new SunShadows(this.game.renderer);
    this.volClouds = new VolumetricClouds();
    this.rover = new Exocraft(this);
    this.skyEvents = new SkyEvents(this);
    this.fishing = new Fishing(this);
    this.moves = new Moves(this);
    this.grenades = new Grenades(this);
    this.encounters = new Encounters(this);
    this.cloudIn = 0;
    // what creatures can do to the world and to you
    this.cfx = {
      get player() { return game.player; },
      debris: (pos, col, n, speed, life, glow) => this.debris.spawn(pos.clone(), col, n, speed, life, glow),
      sound: (kind, pos) => this._critterSound(kind, pos),
      hurt: (dmg, why, kx, ky, kz) => {
        this._hurtPlayer(dmg, why);
        if (kx !== undefined && !game.inShip && !this.riding.active) { game.player.vel.x += kx; game.player.vel.y = Math.max(game.player.vel.y, ky); game.player.vel.z += kz; game.player.onGround = false; }
      },
      shake: (k) => { this.horror.shake = Math.max(this.horror.shake, k); },
      heal: (n) => { const st = game.player.stats; st.health = Math.min(100, st.health + n); game.audio.tone(660, 0.4, 'sine', 0.06, 1.5); },
      give: (item, n) => { game.inventory.add(item, n); game.hud.notify(null, item, n); },
      hint: (key, text, color) => {
        const f = game.state.flags;
        if (f['hint_' + key]) return;
        f['hint_' + key] = true;
        game.hud.setCenter(text, color || '#e8f4ff');
        this.centerT = 3.2;
      },
      bubblePopped: (b) => {
        const st = game.player.stats;
        st.life = Math.min(100, st.life + 6);
        st.hazard = Math.min(100, st.hazard + 4);
        game.audio.tone(880 + Math.random() * 400, 0.12, 'sine', 0.05, 1.6);
        if (b.owner) b.owner.joy = (b.owner.joy || 0) + 1;
        this.cfx.hint('bubble', 'The bubble was full of clean air.', '#ffe0f6');
      },
      speedMul: (k) => { game.player.speedMul = k; },
      blockColor: (id) => (id > 0 && BLOCKS[id] ? BLOCKS[id].color : null),
    };
    this.sentinels = new SentinelManager(this.scene);
    // first-person multi-tool
    this.viewScene = new THREE.Scene();
    this.viewCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 20);
    this.tool = buildMultitool();
    this.viewScene.add(this.tool);
    this.viewScene.add(new THREE.AmbientLight(0xffffff, 0.6 * Math.PI));
    this.viewLight = new THREE.DirectionalLight(0xffffff, 0.9 * Math.PI);
    this.viewLight.position.set(0.5, 1, 0.8);
    this.viewScene.add(this.viewLight);

    this.active = false;
    this.toolMode = 0;
    this.visor = false;
    this.torch = false;
    this.mine = { key: null, progress: 0 };
    this.heat = 0;
    this.overheated = false;
    this.fireCd = 0;
    this.placeCd = 0;
    this.scanCd = 0;
    this.scanProgress = 0;
    this.scanKey = null;
    this.markers = [];
    this.structCache = new Map();
    this.nearStructures = [];
    this.structTimer = 0;
    this.recoil = 0;
    this.lastDamage = 99;
    this.warnTimer = 0;
    this.storm = { on: false, t: 0, next: 200 };
    this.whisperTimer = 30;
    this.smokeTimer = 0;
    this.landScan = 0; this.landSite = null; this.dustT = 0; this.entryShown = true;
    this.dayT = 0.35;
    this.leaving = false;
    this.feeding = [];
    this.npcs = [];
    this.interior = false;
  }

  setRenderDistance(d) {
    this.world.setRenderDistance(d);
    const far = d * 16;
    voxelUniforms.uFogNear.value = far * 0.6;
    voxelUniforms.uFogFar.value = far - 6;
    this.fogFar = far - 6;
  }

  get g() { return this.game; }

  // ---------------- enter / leave ----------------
  enter(planet, opts) {
    const g = this.game;
    this.planet = planet;
    this.P = planet.params;
    this.interior = !!this.P.interior;
    this.pocket = this.P.interior || null; // 'station' | 'void' | 'derelict'
    this.active = true;
    this.loading = true;
    this.loadTime = 0;
    this.leaving = false;
    this.structCache.clear();
    this.markers = [];
    this.zoneCur = undefined;
    this.zAtm = null;
    this.encK = 0;
    this.world.setPlanet(this.P, g.state.edits[planet.id]);
    // caustics dance on the sea floor of water worlds
    voxelUniforms.uSeaLevel.value = !this.interior && (this.P.liquid === B.WATER || this.P.liquid === B.DREAM_WATER) ? this.P.seaLevel : -999;
    this.setRenderDistance(g.settings.renderDist);
    this.creatures.setPlanet(planet);
    this.giants.setPlanet(planet);
    this.horror.setPlanet(planet);
    this._setMissing(false);
    g.corruption.setPlanet(planet);
    this.sentinels.setPlanet(this.P.sentinels);
    this.weather.setType(this.P.weather);
    this.clouds.uniforms.uCloudCol.value.setRGB(...this.P.sky.cloud);
    this.clouds.uniforms.uCover.value = this.P.sky.cloudCover;
    this.clouds.mesh.visible = this.P.sky.cloudCover > 0.01;
    this.volClouds.setPlanet(this.P, this.P.seed);
    this.skyEvents.setPlanet(this.P);
    this.sky.uniforms.uStars.value = this.P.sky.stars || 0;
    this.sky.uniforms.uDream.value = this.P.sky.dream || 0;
    this.sky.uniforms.uDreamCol.value.setRGB(...this.P.accent);
    this.storm = { on: false, t: 0, next: 120 + Math.random() * 240 };
    this.bolts.clear();
    this.debris.clear();
    // other bodies in this system as they appear in the sky
    const sys = g.system;
    const me = new THREE.Vector3(...planet.position);
    this.starDir = me.clone().negate().normalize();
    this.bodies = [];
    for (const p of sys.planets) {
      if (p === planet) continue;
      const d = new THREE.Vector3(...p.position).sub(me);
      const dist = d.length();
      const size = clamp(Math.atan(p.radius / dist) * 9, 0.025, 0.2);
      const t = p.params.tints;
      this.bodies.push({ dir: d.normalize(), size, color: [t[3] * 0.6 + 0.3, t[4] * 0.6 + 0.3, t[5] * 0.6 + 0.35] });
    }
    // a big dreamy moon for liminal worlds
    if (this.P.biome === 'liminal' || this.P.biome === 'exotic') {
      this.bodies.unshift({ dir: new THREE.Vector3(0.3, 0.5, -0.8).normalize(), size: 0.16, color: [1, 0.85, 0.95] });
    }
    this.bodies = this.bodies.slice(0, 4);

    // ship model belongs to this scene now
    g.ship.model.removeFromParent();
    this.scene.add(g.ship.model);
    this._prepShip();
    g.ship.camInit = false;

    const st = g.state;
    this.dayT = st.dayTime[planet.id] ?? 0.32;
    this.spawnMode = opts.spawn;
    const player = g.player;
    this._clearNPCs();
    if (this.pocket === 'station') {
      STATION_NPCS.forEach((n, i) => {
        const m = buildTraveller(hash32(planet.seed, i));
        m.position.set(n.x + 0.5, STATION_FLOOR, n.z + 0.5);
        m.rotation.y = n.face;
        m.userData.face = n.face;
        m.userData.line = STATION_CHATTER[(i + (planet.seed % 5)) % STATION_CHATTER.length];
        this.scene.add(m);
        this.npcs.push(m);
      });
      g.shipyard.spawn(this);
    }
    if (opts.spawn === 'dock') {
      this.pad = STATION_PADS[g.net.padIndex()] || STATION_PADS[0];
      this.target = { x: this.pad.x, z: this.pad.z };
      g.inShip = true;
    } else if (opts.spawn === 'derelict') {
      this.target = { x: DERELICT_PAD.x, z: DERELICT_PAD.z };
      g.inShip = true;
    } else if (opts.spawn === 'void') {
      this.target = { x: VOID_SPAWN.x, z: VOID_SPAWN.z };
      g.inShip = false;
    } else if (opts.spawn === 'near' && opts.near) {
      this.target = { x: opts.near.x, z: opts.near.z };
      this.nearSpot = opts.near;
      g.inShip = false;
    } else if (opts.spawn === 'base' && opts.base) {
      this.target = { x: opts.base.x, z: opts.base.z };
      this.arriveBase = opts.base;
      g.inShip = false;
    } else if (opts.spawn === 'crash') {
      const sp = this._findSpawn(0, 0);
      this.target = { x: sp.x, z: sp.z };
      g.inShip = false;
    } else if (opts.spawn === 'restore' && st.player) {
      this.target = { x: st.player.x, z: st.player.z };
      g.inShip = !!st.inShip;
    } else if (opts.spawn === 'entry' || opts.spawn === 'restore') {
      let x = 0, z = 0;
      if (opts.dir) ({ x, z } = Universe.dirToSurface(opts.dir));
      this.target = { x, z };
      g.inShip = true;
      // time of day from where we came in relative to the star
      if (opts.worldDir || opts.dir) {
        const worldDir = new THREE.Vector3(...(opts.worldDir || opts.dir));
        const cosA = worldDir.dot(this.starDir);
        this.dayT = 0.5 - Math.acos(clamp(cosA, -1, 1)) / (Math.PI * 2) * (Math.random() < 0.5 ? 1 : -1);
        this.dayT = ((this.dayT % 1) + 1) % 1;
      }
    }
    player.vel.set(0, 0, 0);
    player.frozen = true;
    this.world.update(this.target.x, this.target.z, 0);
  }

  _clearNPCs() {
    for (const n of this.npcs) this.scene.remove(n);
    this.npcs = [];
    this.game.shipyard.clear();
  }

  _findSpawn(x0, z0) {
    const T = this.world.terrain;
    const sea = this.P.liquid ? this.P.seaLevel : -99;
    let best = { x: x0, z: z0 }, bestScore = -1e9;
    for (let r = 0; r < 260; r += 12) {
      const steps = Math.max(1, Math.floor(r / 6));
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(x0 + Math.cos(a) * r), z = Math.round(z0 + Math.sin(a) * r);
        const h = T.heightAt(x, z);
        if (h < sea + 3) continue;
        const slope = Math.abs(T.heightAt(x + 4, z) - h) + Math.abs(T.heightAt(x, z + 4) - h) + Math.abs(T.heightAt(x - 6, z) - h);
        const score = -slope * 3 - r * 0.02;
        if (score > bestScore) { bestScore = score; best = { x, z }; }
      }
      if (bestScore > -4) break;
    }
    return best;
  }

  updateLoading(dt) {
    const g = this.game;
    this.loadTime += dt;
    this.world.update(this.target.x, this.target.z, 16);
    const p = this.world.loadedAround(this.target.x, this.target.z, 2);
    g.menus.setLoading(p);
    if ((p >= 1 && this.loadTime > 0.3) || this.loadTime > 30) this._finishLoading();
    this._applySky(0);
  }

  _finishLoading() {
    const g = this.game, st = g.state, player = g.player, ship = g.ship, W = this.world;
    this.loading = false;
    player.frozen = false;
    const mode = this.spawnMode;
    if (mode === 'void') {
      player.pos.set(VOID_SPAWN.x, VOID_FLOOR + 0.02, VOID_SPAWN.z);
      player.yaw = VOID_SPAWN.yaw; player.pitch = 0;
      player.vel.set(0, 0, 0);
      g.inShip = false;
      ship.state = 'landed';
      ship.pos.set(0, -500, 0);
    } else if (mode === 'derelict') {
      ship.pos.set(DERELICT_PAD.x + 0.5, DERELICT_FLOOR + 1.7, DERELICT_PAD.z + 0.5);
      ship.setLevel(Math.PI);
      ship.state = 'landed';
      ship.speed = 0;
      g.inShip = true;
      player.pos.copy(ship.pos);
    } else if (mode === 'dock') {
      const pad = this.pad || STATION_PADS[0];
      ship.pos.set(pad.x + 0.5, STATION_FLOOR + 1.7, pad.z + 0.5);
      ship.setLevel(Math.PI); // nose to the lobby, so the camera has the hangar behind it
      ship.state = 'landed';
      ship.speed = 0;
      g.inShip = true;
      player.pos.copy(ship.pos);
    } else if (mode === 'near' && this.nearSpot) {
      // beside a friend: find standing room a few steps from them, ship parked nearby
      const n = this.nearSpot;
      const a = Math.random() * Math.PI * 2;
      const s = this._settle(Math.floor(n.x + Math.cos(a) * 3), Math.floor(n.z + Math.sin(a) * 3));
      player.pos.set(s.x + 0.5, s.y, s.z + 0.5);
      let guard = 0;
      while (player.collides(W, player.pos.x, player.pos.y, player.pos.z) && guard++ < 30) player.pos.y += 1;
      player.yaw = Math.atan2(-(n.x - player.pos.x), -(n.z - player.pos.z));
      this._placeShipNear(player.pos, 14);
      ship.state = 'landed';
      g.inShip = false;
      this.nearSpot = null;
    } else if (mode === 'base' && this.arriveBase) {
      this._arriveAtBase(this.arriveBase);
      this.arriveBase = null;
      g.inShip = false;
    } else if (mode === 'crash') {
      this._crashSite(this.target.x, this.target.z);
      g.inShip = false;
    } else if (mode === 'restore' && st.player) {
      player.pos.set(st.player.x, st.player.y, st.player.z);
      player.yaw = st.player.yaw || 0; player.pitch = st.player.pitch || 0;
      let guard = 0;
      while (player.collides(W, player.pos.x, player.pos.y, player.pos.z) && guard++ < 80) player.pos.y += 1;
      if (st.shipSurface) {
        ship.pos.set(st.shipSurface.x, st.shipSurface.y, st.shipSurface.z);
        ship.setLevel(st.shipSurface.yaw || 0);
        ship.state = st.shipSurface.state === 'flying' && g.inShip ? 'flying' : 'landed';
        if (ship.state === 'landed') {
          const gy = this._shipGround(ship.pos.x, ship.pos.z, ship.yaw());
          ship.pos.y = gy + 1.75;
        }
      } else this._placeShipNear(player.pos, 7);
      if (g.inShip) ship.speed = ship.state === 'flying' ? 30 : 0;
    } else {
      // atmospheric entry: a burning dive from high altitude that levels out over the loaded ground
      const yaw = Math.random() * Math.PI * 2;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let top = 0;
      for (let i = -2; i <= 2; i++) top = Math.max(top, W.groundAt(this.target.x + fx * i * 20, this.target.z + fz * i * 20));
      const to = new THREE.Vector3(this.target.x, Math.min(SURFACE_ENTRY_ALT - 60, top + 62), this.target.z);
      const from = new THREE.Vector3(this.target.x - fx * 320, SURFACE_ENTRY_ALT, this.target.z - fz * 320);
      ship.beginEntry(from, to, yaw);
      g.inShip = true;
      player.pos.copy(ship.pos);
      this.entryShown = false;
    }
    ship.syncModel();
    ship.camInit = false;
    if (st.rover && this.planet && st.rover.planet === this.planet.id && !this.interior) this.rover.restore(st.rover);
    g.onSurfaceReady();
    this.game.audio.setMood(this.P.biome, this.P.seed);
  }

  _settle(x, z) {
    const W = this.world;
    const soil = new Set([B.GRASS, B.SNOW_GRASS, B.SAND, B.ASH, B.RUST, B.GRAVEL, B.DIRT, B.SNOW, B.SALT, B.STONE]);
    for (let r = 0; r < 12; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const gy = W.groundBelow(x + dx, W.terrain.heightAt(x + dx, z + dz) + 7, z + dz);
        const top = W.getBlock(x + dx, gy, z + dz);
        if (soil.has(top) && W.getBlock(x + dx, gy + 1, z + dz) <= 0 || (soil.has(top) && IS_AIRLIKE[W.getBlock(x + dx, gy + 1, z + dz)])) {
          return { x: x + dx, y: gy + 1, z: z + dz };
        }
      }
    }
    return { x, y: W.groundAt(x, z) + 1, z };
  }

  _shipGround(x, z, yaw, refY) {
    const W = this.world;
    let maxG = -1;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (const [a, b] of [[0, 0], [3, 0], [-3, 0], [0, 2], [0, -2], [2.5, 1.5], [-2.5, 1.5]]) {
      const px = x + fx * a + fz * b, pz = z + fz * a - fx * b;
      maxG = Math.max(maxG, refY != null ? W.groundBelow(px, refY, pz) : W.groundAt(px, pz));
    }
    return maxG;
  }

  _placeShipNear(pos, dist) {
    const ship = this.game.ship;
    const site = this._findLandingSite(pos.x, pos.z, Math.random() * 6.28, dist + 8, dist);
    if (site) {
      ship.pos.set(site.x, site.y + 1.75, site.z);
      ship.setLevel(site.yaw);
      ship.syncModel();
      return;
    }
    let best = null;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = pos.x + Math.cos(a) * dist, z = pos.z + Math.sin(a) * dist;
      const yaw = a + Math.PI / 2;
      const g = this._shipGround(x, z, yaw, pos.y + 5);
      const top = this.world.getBlock(x, g, z);
      if (IS_LIQUID[top]) continue;
      const d = Math.abs(g - pos.y);
      if (!best || d < best.d) best = { x, z, g, yaw, d };
    }
    if (!best) best = { x: pos.x + dist, z: pos.z, g: this.world.groundAt(pos.x + dist, pos.z), yaw: 0 };
    ship.pos.set(best.x, best.g + 1.75, best.z);
    ship.setLevel(best.yaw);
    ship.syncModel();
  }

  // Samples the ship's footprint (wings included) at a spot. Returns the ground heights and what's in
  // the way, or null when it's over liquid / unloaded ground.
  _siteAt(x, z, yaw) {
    const W = this.world;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const hs = [];
    let obstacles = 0;
    for (const a of [-6, -3, 0, 3, 5]) for (const b of [-5.5, -2.7, 0, 2.7, 5.5]) {
      const px = x + fx * a + fz * b, pz = z + fz * a - fx * b;
      if (!W.isLoaded(px, pz)) return null;
      let gy = W.groundAt(px, pz);
      let top = W.getBlock(px, gy, pz);
      if (IS_LIQUID[top]) return null;
      // look through trees and plants to the ground they stand on
      let guard = 0;
      while (SITE_OBSTACLE.has(top) && guard++ < 30) { gy--; top = W.getBlock(px, gy, pz); obstacles++; }
      if (IS_LIQUID[top]) return null;
      hs.push(gy);
    }
    hs.sort((p, q) => p - q);
    return { lo: hs[0], hi: hs[hs.length - 1], med: hs[hs.length >> 1], spread: hs[hs.length - 1] - hs[0], obstacles };
  }

  // Flat, open ground for a landing around (x, z). Prefers spots close to the centre and headings
  // near `yaw`.
  _findLandingSite(x, z, yaw, maxR = 18, minR = 0, rough = false) {
    const sea = this.P.liquid ? this.P.seaLevel : -99;
    let best = null;
    for (let r = minR; r <= maxR; r += 3) {
      const n = r === 0 ? 1 : Math.max(6, Math.floor(r * 0.9));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const px = Math.floor(x + Math.cos(a) * r) + 0.5, pz = Math.floor(z + Math.sin(a) * r) + 0.5;
        for (const dy of [0, 0.5, -0.5, Math.PI / 2]) {
          const s = this._siteAt(px, pz, yaw + dy);
          if (!s || s.hi <= sea || (!rough && (s.obstacles > 22 || s.spread > 3)) || s.spread > 7) continue;
          const score = s.spread * 3 + r * 0.12 + Math.abs(dy) * 0.6 + s.obstacles * 0.3;
          if (!best || score < best.score) best = { x: px, z: pz, y: s.hi, yaw: yaw + dy, score, obstacles: s.obstacles };
        }
      }
      if (best && best.score < r * 0.12 + 1) break;
    }
    return best;
  }

  // First arrival: pick open ground, gouge a scorched skid behind the wreck and wake the player
  // a little way off with the ship in view.
  _crashSite(x0, z0) {
    const g = this.game, W = this.world, ship = g.ship, player = g.player;
    const sea = this.P.liquid ? this.P.seaLevel : -99;
    const rng = new RNG(hash32(this.P.seed, 991));
    let best = null;
    for (let r = 0; r <= 26; r += 3) {
      const n = r === 0 ? 1 : Math.max(6, Math.floor(r * 0.8));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r;
        const x = Math.floor(x0 + Math.cos(a) * r) + 0.5, z = Math.floor(z0 + Math.sin(a) * r) + 0.5;
        for (let k = 0; k < 4; k++) {
          const yaw = k * Math.PI / 2 + 0.4;
          const s = this._siteAt(x, z, yaw);
          if (!s || s.med <= sea + 1) continue;
          // the skid behind the ship shouldn't run into a cliff or the sea
          const bx = x + Math.sin(yaw) * 16, bz = z + Math.cos(yaw) * 16;
          const bh = W.groundAt(bx, bz);
          const score = s.spread * 2 + s.obstacles * 0.15 + r * 0.08 + Math.max(0, Math.abs(bh - s.med) - 3) * 0.8;
          if (!best || score < best.score) best = { x, z, yaw, s, score };
        }
      }
      if (best && best.score < 3) break;
    }
    if (!best) {
      const s = this._settle(x0, z0);
      player.pos.set(s.x + 0.5, s.y, s.z + 0.5);
      this._placeShipNear(player.pos, 10);
      ship.state = 'landed';
      return;
    }
    const { x, z, yaw } = best;
    const gy = best.s.med;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const scorch = (px, py, pz) => W.editBlock(px, py, pz, rng.next() < 0.6 ? B.ASH : B.GRAVEL);
    const clearTree = (px, py, pz) => {
      for (let dy = 0; dy < 16; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const id = W.getBlock(px + dx, py + dy, pz + dz);
        if (id === B.LOG || id === B.LEAVES || id === B.MUSHROOM_STEM || id === B.MUSHROOM_CAP || id === B.CACTUS) W.editBlock(px + dx, py + dy, pz + dz, B.AIR);
      }
    };
    // bed: level the footprint, clear anything the hull would clip
    for (let a = -8; a <= 6; a++) for (let b = -8; b <= 8; b++) {
      const e = (a / (a < 0 ? 8 : 6)) ** 2 + (b / 8) ** 2;
      if (e > 1.05) continue;
      const px = Math.floor(x + fx * a + fz * b), pz = Math.floor(z + fz * a - fx * b);
      for (let y = gy + 1; y <= gy + 9; y++) {
        const id = W.getBlock(px, y, pz);
        if (id === B.LOG || id === B.MUSHROOM_STEM) clearTree(px, gy, pz);
        if (id > 0) W.editBlock(px, y, pz, B.AIR);
      }
      let cy = W.groundAt(px, pz);
      if (cy > gy) cy = gy;
      for (let y = cy + 1; y <= gy; y++) W.editBlock(px, y, pz, B.DIRT);
      if (e < 0.55) scorch(px, gy, pz);
    }
    // skid furrow behind the wreck, with heaped berms and torn-off plating
    const side = rng.next() < 0.5 ? -1 : 1;
    for (let t = 5; t <= 26; t++) {
      const bend = Math.sin(t * 0.18) * 1.2 * side;
      const w = t < 14 ? 2 : 1.4;
      const deep = t < 16 ? 1 : 0;
      for (let b = -w - 1; b <= w + 1; b++) {
        const px = Math.floor(x - fx * t + fz * (b + bend)), pz = Math.floor(z - fz * t - fx * (b + bend));
        let cy = W.groundAt(px, pz);
        let top = W.getBlock(px, cy, pz);
        let guard = 0;
        while (SITE_OBSTACLE.has(top) && guard++ < 30) { if (top === B.LOG || top === B.MUSHROOM_STEM) clearTree(px, cy - 4, pz); cy--; top = W.getBlock(px, cy, pz); }
        if (IS_LIQUID[top] || cy < 2) continue;
        for (let y = cy + 1; y <= cy + 6; y++) if (W.getBlock(px, y, pz) > 0) W.editBlock(px, y, pz, B.AIR);
        if (Math.abs(b) <= w) {
          for (let d = 0; d < deep; d++) W.editBlock(px, cy - d, pz, B.AIR);
          scorch(px, cy - deep, pz);
        } else if (rng.next() < 0.7) W.editBlock(px, cy + 1, pz, rng.next() < 0.5 ? B.DIRT : B.GRAVEL);
      }
      if (t % 5 === 3 && rng.next() < 0.8) {
        const b = (w + 2.5) * (rng.next() < 0.5 ? -1 : 1);
        const px = Math.floor(x - fx * t + fz * (b + bend)), pz = Math.floor(z - fz * t - fx * (b + bend));
        const cy = W.groundAt(px, pz);
        W.editBlock(px, cy + 1, pz, B.HULL);
        if (rng.next() < 0.4) W.editBlock(px, cy + 2, pz, B.HULL);
      }
    }
    // ship nosed into the end of its skid, canted
    ship.pos.set(x, gy + 1.75 - 0.3, z);
    ship.quat.setFromEuler(new THREE.Euler(-0.07, yaw, 0.08 * side, 'YXZ'));
    ship.state = 'landed';
    ship.syncModel();
    // wake up off to one side, looking at the ship from the front quarter, with a clear view of it
    const cands = [];
    for (const d of [11, 13, 9, 15, 17]) for (const ang of [0.9, -0.9, 1.3, -1.3, 0.5, -0.5, 1.8, -1.8, 2.4, -2.4]) cands.push([d, ang]);
    const hull = [[0, 0, 1.0], [5, 0, 1.2], [-5, 0, 1.4], [0, 5, 1.3], [0, -5, 1.3]];
    let placed = false;
    const eye = new THREE.Vector3(), to = new THREE.Vector3();
    for (const tol of [1, 3]) {
      for (const [d, ang] of cands) {
        const dx = fx * Math.cos(ang) - fz * Math.sin(ang), dz = fz * Math.cos(ang) + fx * Math.sin(ang);
        const px = Math.floor(x + dx * d) + 0.5, pz = Math.floor(z + dz * d) + 0.5;
        const py = W.groundBelow(px, gy + 8, pz);
        const top = W.getBlock(px, py, pz);
        if (IS_LIQUID[top] || SITE_OBSTACLE.has(top) || Math.abs(py - gy) > tol) continue;
        if (W.isSolid(px, py + 1, pz) || W.isSolid(px, py + 2, pz)) continue;
        eye.set(px, py + 2.62, pz);
        let seen = 0;
        for (const [a, b, h] of hull) {
          to.set(x + fx * a + fz * b, gy + h, z + fz * a - fx * b).sub(eye);
          const dist = to.length();
          if (!W.raycast(eye, to.normalize(), dist - 1.5)) seen++;
        }
        if (seen < 5) continue;
        player.pos.set(px, py + 1.01, pz);
        player.yaw = Math.atan2(-(x - px), -(z - pz)) + 0.2 * Math.sign(ang);
        player.pitch = -0.14;
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      const s = this._settle(Math.floor(x + fz * 11), Math.floor(z - fx * 11));
      player.pos.set(s.x + 0.5, s.y, s.z + 0.5);
      player.yaw = Math.atan2(-(x - player.pos.x), -(z - player.pos.z));
    }
    let guard = 0;
    while (player.collides(W, player.pos.x, player.pos.y, player.pos.z) && guard++ < 20) player.pos.y += 1;
    this.smokeTimer = 0;
  }

  // shadows for the ship model (once per model: a new ship gets a new model)
  _prepShip() {
    const m = this.game.ship.model;
    if (m.userData.shadowed) return;
    m.userData.shadowed = true;
    castShadows(m);
    for (const f of m.userData.flames || []) f.layers.disable(1);
    if (m.userData.plasma) castShadows(m.userData.plasma.group, false);
  }

  leave() {
    if (!this.active) return;
    this.active = false;
    if (this.riding.c) { this.riding.c.ridden = false; this.riding.c = null; }
    if (this.rover.driving) this.rover.exit();
    this.game.state.rover = this.rover.present && this.planet ? { planet: this.planet.id, ...this.rover.save() } : this.game.state.rover;
    this.rover.clear();
    this.skyEvents.clear();
    this.fishing.cancel();
    this.moves.reset();
    this.grenades.clear();
    this.encounters.clear();
    if (this.dmg) this.dmg.clear();
    this._clearNPCs();
    this.world.clear();
    this.creatures.clear();
    this.horror.clear();
    this._setMissing(false);
    this._hideChunks(false);
    this.game.corruption.clear();
    this.sentinels.clear();
    this.bolts.clear();
    this.debris.clear();
    this.beam.hide();
    this.game.audio.stopAllLoops();
    const pu = this.game.post.uniforms;
    pu.uUnderwater.value = 0;
    pu.uHazard.value = 0;
    pu.uVisor.value = 0;
    pu.uDread.value = 0; pu.uPulse.value = 0; pu.uGlitch.value = 0; pu.uFlash.value = 0; pu.uRays.value = 0; pu.uFlare.value = 0; pu.uVol.value = 0;
    voxelUniforms.uWet.value = 0;
    this.game.audio.setDread(0);
    this.game.hud.setVisor(false);
    this.visor = false;
  }

  exportEdits() {
    if (this.planet) this.game.state.edits[this.planet.id] = this.world.exportEdits();
  }

  exitDirection() {
    const s = this.game.ship.pos;
    return Universe.surfaceToDir(s.x, s.z);
  }

  writeState(st) {
    const p = this.game.player, s = this.game.ship, g = this.game;
    if (this.pocket === 'void' && g.pocketReturn) {
      // waking up puts you back where you touched it
      const R = g.pocketReturn;
      st.mode = 'surface'; st.planetIndex = R.planetIndex;
      st.player = { x: R.pos.x, y: R.pos.y, z: R.pos.z, yaw: R.yaw, pitch: 0 };
      st.inShip = false; st.shipSurface = R.ship;
      return;
    }
    if (this.pocket === 'derelict') { st.mode = 'space'; st.edits[this.planet.id] = this.world.exportEdits(); return; }
    st.mode = this.interior ? 'station' : 'surface';
    if (this.rover.driving) this.rover.exit();
    if (this.rover.present) st.rover = { planet: this.planet.id, ...this.rover.save() };
    st.player = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch };
    st.inShip = this.game.inShip;
    st.shipSurface = { x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw(), state: s.state === 'landed' ? 'landed' : 'flying' };
    st.edits[this.planet.id] = this.world.exportEdits();
    st.dayTime[this.planet.id] = this.dayT;
  }

  renderPasses() {
    const passes = [{ scene: this.scene, camera: this.game.camera }];
    if (!this.game.inShip && this.tool.visible && !this.loading) passes.push({ scene: this.viewScene, camera: this.viewCamera, clearDepth: true });
    return passes;
  }

  // ---------------- sky / time ----------------
  // 0 = open sky, 1 = well under a roof. Samples the sky-height map around the camera.
  _enclosure(dt) {
    const c = this.game.camera.position;
    let cover = 0;
    for (const [dx, dz] of ENC_OFFS) {
      const sh = this.world.skyHeightAt(c.x + dx, c.z + dz);
      if (sh > c.y + 1.5) cover++;
    }
    const target = this.game.inShip || this.interior ? 0 : clamp((cover - 1) / (ENC_OFFS.length - 2), 0, 1);
    this.encK = (this.encK ?? target) + (target - (this.encK ?? target)) * Math.min(1, dt * 1.5);
    return this.encK;
  }

  // Smoothly blended atmosphere of the dream zone around the camera
  _zoneAtmos(dt) {
    const za = this.zAtm || (this.zAtm = { k: 0, fog: [1, 1, 1], dens: 1, mist: 1, light: [1, 1, 1], sky: 0 });
    let tk = 0, A = null;
    if (!this.interior && this.world && this.world.terrain) {
      const c = this.game.camera.position;
      const zi = this.world.terrain.zoneAt(c.x, c.z);
      A = ZONE_ATMOS[zi.type];
      if (A) tk = zi.blend;
    }
    const r = Math.min(1, dt * 1.2);
    za.k += (tk - za.k) * r;
    if (A) {
      for (let i = 0; i < 3; i++) { za.fog[i] += (A.fog[i] - za.fog[i]) * r; za.light[i] += (A.light[i] - za.light[i]) * r; }
      za.dens += (A.dens - za.dens) * r; za.mist += (A.mist - za.mist) * r; za.sky += (A.sky - za.sky) * r;
    }
    return za;
  }

  _applySky(dt) {
    const P = this.P;
    const u = voxelUniforms;
    const rate = 1 / (P.biome === 'liminal' ? 2400 : 1200);
    this.dayT = (this.dayT + dt * rate) % 1;
    const a = (this.dayT - 0.25) * Math.PI * 2;
    const sunDir = _v.set(Math.cos(a), Math.sin(a), 0.35).normalize();
    u.uSunDir.value.copy(sunDir);
    this.sunY = sunDir.y;
    const daylight = smoothstep(-0.14, 0.2, sunDir.y);
    this.daylight = daylight;
    u.uDaylight.value = daylight;
    const sunset = clamp(1 - Math.abs(sunDir.y) / 0.3, 0, 1) * (sunDir.y > -0.25 ? 1 : 0);
    const storm = this.stormK || 0;
    const S = P.sky;
    const zen = [lerp(S.nightZenith[0], S.zenith[0], daylight), lerp(S.nightZenith[1], S.zenith[1], daylight), lerp(S.nightZenith[2], S.zenith[2], daylight)];
    const hor = [lerp(S.nightHorizon[0], S.horizon[0], daylight), lerp(S.nightHorizon[1], S.horizon[1], daylight), lerp(S.nightHorizon[2], S.horizon[2], daylight)];
    const sc = P.biome === 'liminal' ? [1.0, 0.6, 0.75] : [1.0, 0.55, 0.3];
    for (let i = 0; i < 3; i++) {
      hor[i] = lerp(hor[i], sc[i], sunset * 0.45);
      const gray = (zen[0] + zen[1] + zen[2]) / 3;
      zen[i] = lerp(zen[i], gray * 0.6, storm * 0.6);
      hor[i] = lerp(hor[i], (hor[0] + hor[1] + hor[2]) / 3 * 0.75, storm * 0.5);
    }
    const ZA = this._zoneAtmos(dt);
    // a wrong night: the sky bleeds
    const LN = this.horror ? this.horror.longNightK * (1 - daylight) : 0;
    if (LN > 0.001) {
      const zr = [0.035, 0.0, 0.006], hr = [0.2, 0.025, 0.035];
      for (let i = 0; i < 3; i++) { zen[i] = lerp(zen[i], zr[i], LN); hor[i] = lerp(hor[i], hr[i], LN); }
    }
    if (ZA.k > 0.001) {
      const nk = lerp(0.25, 1, daylight);
      for (let i = 0; i < 3; i++) {
        hor[i] = lerp(hor[i], ZA.fog[i] * nk, ZA.k * ZA.sky);
        zen[i] = lerp(zen[i], ZA.fog[i] * 0.5 * nk, ZA.k * ZA.sky * 0.85);
      }
    }
    u.uZenith.value.setRGB(zen[0], zen[1], zen[2]);
    u.uHorizon.value.setRGB(hor[0], hor[1], hor[2]);
    u.uSunset.value = P.sky.stars >= 1 ? 0 : sunset * (1 - storm * 0.7);
    if (P.biome === 'liminal') u.uSunsetCol.value.setRGB(1.0, 0.55, 0.78);
    else if (P.biome === 'toxic' || P.biome === 'radioactive') u.uSunsetCol.value.setRGB(1.0, 0.75, 0.3);
    else u.uSunsetCol.value.setRGB(1.0, 0.48, 0.28);
    u.uGroundCol.value.setRGB(hor[0] * 0.55, hor[1] * 0.55, hor[2] * 0.6);
    u.uSunColor.value.setRGB(S.sun[0], S.sun[1] * (1 - sunset * 0.3), S.sun[2] * (1 - sunset * 0.5));
    // lighting for voxels
    const dream = P.biome === 'liminal' ? 1 : 0;
    const amb = lerp(0.15, 0.4, daylight);
    u.uAmbient.value.setRGB(amb * (1 + dream * 0.1) + hor[0] * 0.08, amb + hor[1] * 0.08, amb * (1 + dream * 0.15) + hor[2] * 0.1 + (1 - daylight) * 0.05);
    const sk = lerp(0.2, 0.78, daylight) * (1 - storm * 0.3);
    const moon = 1 - daylight;
    u.uSkyLight.value.setRGB(sk * lerp(1, 1.1, sunset) * (1 - moon * 0.25), sk * lerp(1, 0.85, sunset) * (1 - moon * 0.1), sk * lerp(1.05, 0.75, sunset) * (1 + moon * 0.25));
    if (ZA.k > 0.001) {
      u.uSkyLight.value.r *= lerp(1, ZA.light[0], ZA.k); u.uSkyLight.value.g *= lerp(1, ZA.light[1], ZA.k); u.uSkyLight.value.b *= lerp(1, ZA.light[2], ZA.k);
      u.uAmbient.value.r *= lerp(1, ZA.light[0], ZA.k); u.uAmbient.value.g *= lerp(1, ZA.light[1], ZA.k); u.uAmbient.value.b *= lerp(1, ZA.light[2], ZA.k);
    }
    const far = this.fogFar || 110;
    u.uFogFar.value = far;
    u.uFogNear.value = far * 0.6;
    const FG = P.fog;
    const fogK = (1 + storm * 1.6) * (this.game.inShip && (this.game.ship.state === 'flying' || this.game.ship.state === 'entry') ? 0.6 : 1);
    const HM = this.horror || { fogMul: 1, mistMul: 1, longNightK: 0 };
    u.uFogDensity.value = FG.density * fogK * lerp(1, ZA.dens, ZA.k) * HM.fogMul;
    u.uMistDensity.value = FG.mistDensity * (1 + storm) * lerp(1, ZA.mist, ZA.k) * HM.mistMul;
    u.uMistBase.value = FG.mistBase;
    u.uMistFalloff.value = FG.mistFalloff;
    // mist glows softly in daylight, turns to deep velvet at night
    const mc = FG.mistColor;
    const ml = lerp(0.16, 1, daylight);
    u.uMistCol.value.setRGB(
      lerp(mc[0] * ml, u.uSunsetCol.value.r, sunset * 0.35) + (1 - daylight) * 0.02,
      lerp(mc[1] * ml, u.uSunsetCol.value.g, sunset * 0.35) + (1 - daylight) * 0.02,
      lerp(mc[2] * ml, u.uSunsetCol.value.b, sunset * 0.35) + (1 - daylight) * 0.05,
    );
    if (LN > 0.001) u.uMistCol.value.lerp(_c.setRGB(0.16, 0.02, 0.03), LN * 0.85);
    if (ZA.k > 0.001) {
      const mk = ZA.k * ZA.sky;
      u.uMistCol.value.setRGB(lerp(u.uMistCol.value.r, ZA.fog[0] * ml, mk), lerp(u.uMistCol.value.g, ZA.fog[1] * ml, mk), lerp(u.uMistCol.value.b, ZA.fog[2] * ml, mk));
    }
    // lightning / impact flash
    const fl = this.skyEvents.flash;
    if (fl > 0.001) { u.uSkyLight.value.multiplyScalar(1 + fl * 2.2); u.uAmbient.value.addScalar(fl * 0.25); }
    this.sky.uniforms.uFlash.value = fl;
    this.sky.uniforms.uAurora.value = this.skyEvents.aurora;
    this.sky.uniforms.uRainbow.value = this.skyEvents.rainbow;
    // flying through a cloud: the world whites out
    const cin = this.volClouds.densityAt(this.game.camera.position);
    this.cloudIn += (Math.min(1, cin * 2.2) - this.cloudIn) * Math.min(1, dt * 3);
    if (this.cloudIn > 0.01) {
      u.uFogDensity.value = lerp(u.uFogDensity.value, 1 / 9, this.cloudIn);
      u.uMistCol.value.lerp(_c.setRGB(0.85 * ml + 0.05, 0.86 * ml + 0.05, 0.9 * ml + 0.06), this.cloudIn * 0.8);
      u.uSkyLight.value.multiplyScalar(1 - this.cloudIn * 0.25);
    }
    this.sky.uniforms.uSkyFog.value = Math.min(1, FG.skyFog * (1 - (P.sky.stars >= 1 ? 1 : 0)) + storm * 0.3 + ZA.k * ZA.sky * 0.5);
    // enclosure: under a roof (caves, backrooms, libraries) the open-air mist gives way to a dim indoor haze
    const enc = this._enclosure(dt);
    u.uEnclosed.value = enc;
    if (enc > 0.001) {
      u.uMistDensity.value *= 1 - enc;
      u.uFogDensity.value = lerp(u.uFogDensity.value, dream ? 1 / 42 : 1 / 34, enc);
      const A = u.uArtificial.value, am = u.uAmbient.value;
      if (dream) u.uCaveCol.value.setRGB(A.r * 0.42 + am.r * 0.15, A.g * 0.4 + am.g * 0.15, A.b * 0.3 + am.b * 0.15);
      else u.uCaveCol.value.setRGB(am.r * 0.12, am.g * 0.12, am.b * 0.14);
    }
    this.scene.fog.color.setRGB((hor[0] + u.uMistCol.value.r) * 0.5, (hor[1] + u.uMistCol.value.g) * 0.5, (hor[2] + u.uMistCol.value.b) * 0.5);
    this.scene.fog.color.lerp(u.uCaveCol.value, enc);
    this.scene.fog.density = u.uFogDensity.value * 1.25;
    if (this.interior) {
      u.uDaylight.value = 0;
      u.uSunset.value = 0;
      this.daylight = 1;
      u.uAmbient.value.setRGB(0.5, 0.48, 0.55);
      u.uSkyLight.value.setRGB(0.62, 0.6, 0.64);
      u.uFogFar.value = 400; u.uFogNear.value = 300; u.uFogDensity.value = 0.002; u.uMistDensity.value = 0; u.uEnclosed.value = 0;
      this.scene.fog.density = 0.002;
      this.sky.uniforms.uSkyFog.value = 0;
      u.uZenith.value.setRGB(0, 0, 0.01); u.uHorizon.value.setRGB(0.03, 0.02, 0.06);
      if (this.pocket !== 'station') {
        // dead ships and nowhere: dark, still, and the fog is close
        const V = this.pocket === 'void';
        this.daylight = 0;
        u.uAmbient.value.setRGB(V ? 0.1 : 0.07, V ? 0.1 : 0.065, V ? 0.13 : 0.08);
        u.uSkyLight.value.setRGB(V ? 0.05 : 0.1, V ? 0.05 : 0.1, V ? 0.07 : 0.13);
        u.uArtificial.value.setRGB(0.2, 0.18, 0.2);
        u.uFogDensity.value = this.P.fog.density * (this.horror ? this.horror.fogMul : 1);
        u.uMistDensity.value = this.P.fog.mistDensity; u.uMistBase.value = this.P.fog.mistBase; u.uMistFalloff.value = this.P.fog.mistFalloff;
        u.uMistCol.value.setRGB(...this.P.fog.mistColor);
        u.uEnclosed.value = V ? 0 : 0.6;
        u.uCaveCol.value.setRGB(0.02, 0.015, 0.02);
        this.scene.fog.density = u.uFogDensity.value * 1.2;
        this.scene.fog.color.setRGB(0.01, 0.01, 0.015);
        if (V) { u.uZenith.value.setRGB(0, 0, 0); u.uHorizon.value.setRGB(0.004, 0.004, 0.006); }
      }
      u.uSunDir.value.copy(this.starDir);
      this.sunLight.position.copy(this.starDir).multiplyScalar(100);
      this.sunLight.intensity = (this.pocket === 'station' ? 0.9 : 0.12) * Math.PI;
      this.hemi.intensity = (this.pocket === 'station' ? 0.9 : 0.15) * Math.PI;
      this.hemi.color.setRGB(1, 0.95, 1); this.hemi.groundColor.setRGB(0.5, 0.5, 0.6);
      this.sky.setBodies(this.bodies.map((b) => ({ dir: [b.dir.x, b.dir.y, b.dir.z], size: b.size, color: b.color })));
      return;
    }
    // three.js lights (ship, creatures, drones)
    this.sunLight.position.copy(sunDir).multiplyScalar(100);
    this.sunLight.intensity = (0.15 + daylight * 0.95) * Math.PI;
    this.sunLight.color.setRGB(S.sun[0], S.sun[1], S.sun[2]);
    this.hemi.color.setRGB(zen[0] * 0.6 + 0.3, zen[1] * 0.6 + 0.3, zen[2] * 0.6 + 0.3);
    this.hemi.groundColor.setRGB(hor[0] * 0.4, hor[1] * 0.4, hor[2] * 0.4);
    this.hemi.intensity = (0.3 + daylight * 0.45) * Math.PI;
    // bodies rotate with the fake sun
    _q.setFromUnitVectors(this.starDir, sunDir);
    this.sky.setBodies(this.bodies.map((b) => {
      const d = b.dir.clone().applyQuaternion(_q);
      return { dir: [d.x, d.y, d.z], size: b.size, color: b.color };
    }));
    this.sky.uniforms.uStorm.value = Math.max(storm, this.horror ? this.horror.longNightK : 0);
  }

  // Dream zones bring their own weather; roofs keep it out.
  _zoneWeather() {
    const z = this.zoneCur;
    const W = { naraka: ['ash', 0.5], tilevoid: ['sparkle', 0.35], memory: ['dream', 0.3], meadow: ['dream', 0.2] }[z];
    let type = W ? W[0] : this.P.weather;
    if (this.horror && this.horror.longNightK > 0.5) type = 'ash';
    if (this.weather.type !== type) this.weather.setType(type);
    return { zoneBase: W ? W[1] : 0, cover: 1 - (this.encK || 0) };
  }

  _updateWeather(dt) {
    const P = this.P;
    const s = this.storm;
    const zw = this._zoneWeather();
    const wd = this.creatures.wind;
    voxelUniforms.uWindDir.value.set(wd.x, wd.z).normalize();
    voxelUniforms.uWindK.value = 0.55 + (this.stormK || 0) * 1.7;
    if (P.stormChance <= 0 || P.weather === 'none') { this.stormK = 0; voxelUniforms.uWet.value = 0; this.weather.update(dt, this.game.camera, zw.zoneBase * zw.cover, this.game.time); return; }
    if (s.on) {
      s.t -= dt;
      if (s.t <= 0) { s.on = false; s.next = 150 + Math.random() * 300; this.game.hud.notify('The storm is passing'); }
    } else {
      s.next -= dt;
      if (s.next <= 0) {
        if (Math.random() < P.stormChance * 2) {
          s.on = true; s.t = 60 + Math.random() * 60;
          const label = P.hazard.level > 0 ? 'Extreme weather' : 'Storm approaching';
          this.game.hud.toast(label, P.hazard.level > 0 ? 'Hazard protection will drain faster - find shelter' : 'The sky is changing');
          this.game.audio.warning();
        } else s.next = 120 + Math.random() * 200;
      }
    }
    this.stormK = clamp((this.stormK || 0) + (s.on ? dt * 0.2 : -dt * 0.15), 0, 1);
    // soaked by rain, drying slowly afterwards; wind picks up with the storm
    const rains = P.weather === 'rain' || P.weather === 'toxic';
    const wu = voxelUniforms.uWet;
    wu.value = rains && this.stormK > 0.2 ? Math.min(1, wu.value + dt * 0.08) : Math.max(0, wu.value - dt * 0.012);
    voxelUniforms.uWindK.value = 0.55 + this.stormK * 1.7;
    const base = ['snow', 'dream', 'sparkle', 'dust', 'ash'].includes(P.weather) ? 0.25 : 0.0;
    const underCover = (this.game.inShip ? 0.6 : 1) * zw.cover;
    this.weather.update(dt, this.game.camera, (Math.max(base, zw.zoneBase) + this.stormK * 0.75) * underCover, this.game.time);
    this.game.audio.setLoop('wind', this.stormK > 0.05, this.stormK);
  }

  // photo mode: the world holds still, but the sky, light and streaming keep up with the camera
  photoFrame(dt) {
    const g = this.game, cam = g.camera;
    this._applySky(0.0001);
    this.world.update(cam.position.x, cam.position.z, 5);
    this.sky.update(cam);
    this.clouds.update(cam);
    voxelUniforms.uTime.value = g.time;
    voxelUniforms.uTorchOn.value = 0;
    this._updatePointLights(0);
    this.beam.hide();
  }

  // ---------------- main update ----------------
  // sun shadow map, rendered just before the frame
  preRender() {
    if (!this.active || this.loading) return;
    const g = this.game;
    const focus = g.inShip ? g.ship.pos : g.player.pos;
    const d = g.camera.getWorldDirection(_v2).setY(0);
    if (d.lengthSq() > 1e-4) d.normalize();
    const center = _v.copy(focus).addScaledVector(d, 18);
    const sun = voxelUniforms.uSunDir.value;
    const gfx = g.settings.gfx ?? 2;
    this.shadows.update(this.scene, center, sun, !this.interior && gfx > 0, gfx, this.lastDt || 1 / 60);
    // volumetric clouds, marched at reduced resolution and composited by the sky
    const pr = g.post.rt;
    this.volClouds.clearSky = this.skyEvents.aurora;
    const tex = this.volClouds.render(g.renderer, g.camera, pr.width, pr.height, gfx, g.time, this.stormK || 0, !this.interior);
    const su = this.sky.uniforms;
    su.uClouds.value = tex;
    su.uCloudOn.value = tex ? 1 : 0;
    su.uScreen.value.set(pr.width, pr.height);
    this.clouds.mesh.visible = !tex && this.P.sky.cloudCover > 0.01 && !this.interior;
  }

  update(dt, paused) {
    this.lastDt = dt;
    const g = this.game;
    if (!this.active) return;
    const input = g.input;
    const player = g.player;
    const ship = g.ship;
    this._applySky(dt);
    if (paused) {
      g.audio.setLoop('laser', false); g.audio.setLoop('jetpack', false); g.audio.setLoop('engine', false);
      this.beam.hide();
      this._updateCamera(0);
      return;
    }
    this._updateWeather(dt);
    this.skyEvents.update(dt);
    const ctl = input.locked;
    // ------- ship or foot -------
    let focus;
    if (g.inShip) {
      this.moves.off(dt);
      this._updateShip(dt, ctl);
      focus = ship.pos;
      player.pos.copy(ship.pos);
    } else if (this.teleport) {
      const d = this.teleport.base ? this.teleport.dest : null;
      focus = d ? { x: d.cx, z: d.cz } : player.pos;
      this.teleport.t += dt;
      if (this.world.loadedAround(focus.x, focus.z, 1) >= 1 || this.teleport.t > 15) this._finishTeleport();
    } else if (this.riding.active) {
      this.moves.off(dt);
      this.riding.update(dt, ctl);
      focus = player.pos;
      this._updateTool(dt, ctl);
    } else if (this.rover.driving) {
      this.moves.off(dt);
      this.rover.update(dt, ctl);
      focus = this.rover.pos;
      this.tool.visible = false;
      g.audio.setLoop('laser', false); g.audio.setLoop('jetpack', false);
      g.hud.setPrompt('<span class="key">E</span>Exit the Roamer');
      if (input.hit('KeyE')) this.rover.exit();
    } else {
      const grav = this.P.gravity;
      this.moves.pre(dt, ctl);
      const ev = player.update(dt, input, this.world, grav, ctl);
      if (this.moves.post(dt, ev)) ev.landed = 0;
      this._footEvents(ev);
      focus = player.pos;
      this._updateTool(dt, ctl);
      if (player.pos.y < -20) { player.pos.y = this.world.groundAt(player.pos.x, player.pos.z) + 2; player.vel.set(0, 0, 0); }
    }
    if (this.rover.present && !this.rover.driving) this.rover.update(dt, false);
    this._missionGuide(dt);
    this.baseT = (this.baseT || 0) - dt;
    if (this.baseT <= 0 && !this.interior) { this.baseT = 1; g.bases.tick(this.world, this.planet); }
    if (!g.inShip && !this.rover.driving && ctl && input.hit('KeyG') && !this.interior) {
      if (this.rover.unlocked) this.rover.summon();
      else g.hud.notify('Install the Roamer Geobay (Tech) to summon an exocraft');
    }
    this.world.update(focus.x, focus.z, 5);
    this.grenades.update(dt);
    this.encounters.update(dt);
    if (this.pocket === 'station') g.shipyard.update(g.time);
    this._updateCamera(dt);
    this._updatePointLights(dt);
    // crashed ship smoke
    if (!ship.thrustersRepaired && ship.state === 'landed') {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = 0.12;
        const p = ship.pos.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(ship.forward(_v2), -3.6);
        this.debris.spawn(p, [0.25, 0.25, 0.28], 1, 0.6, 2.5, true);
      }
    }
    // creatures & sentinels
    const pc = g.inShip ? ship.pos : player.pos;
    this.creatures.update(dt, {
      world: this.world, player: pc, fauna: this.P.fauna, time: g.time, playerInShip: g.inShip,
      camPos: g.camera.position, camDir: g.camera.getWorldDirection(new THREE.Vector3()), night: this.daylight < 0.3, zone: this.zoneCur, torch: this.torch && !g.inShip,
      fx: this.cfx, riding: this.riding.active || this.rover.driving,
      onAttack: (dmg, c) => { this._hurtPlayer(dmg); g.hud.notify(`${c.sp.name} attacks!`); },
      onCreep: () => { g.audio.tone(90, 0.6, 'sawtooth', 0.05, 0.7); g.audio.noiseHit(0.3, 300, 0.08, 'lowpass'); },
      onRattle: () => g.audio.rattle(),
      onGift: (c, item) => {
        g.inventory.add(item, 1); g.hud.notify(null, item, 1); g.audio.rattle(); g.audio.zoneEnter(false);
        this.debris.spawn(c.pos.clone().add(new THREE.Vector3(0, 1, 0)), [0.95, 1, 0.95], 10, 1.5, 1.2, true);
        if (!g.state.flags.kodamaGift) { g.state.flags.kodamaGift = true; g.hud.setCenter('The Kodama left you something.', '#eef8ea'); this.centerT = 3.5; }
      },
      onVanish: (c, seen) => {
        if (!seen) return;
        g.audio.distant('thud');
        if (!g.state.flags.pretaSeen) { g.state.flags.pretaSeen = true; g.hud.setCenter('Was something standing there?', '#d8d0e8'); this.centerT = 3.5; }
      },
    });
    this.horror.update(dt, {
      world: this.world, P: this.P, cam: g.camera, player: pc, daylight: this.daylight ?? 1, torch: this.torch && !g.inShip,
      inShip: g.inShip, interior: this.interior, zone: this.zoneCur, enc: this.encK || 0, time: g.time, fogFar: this.fogFar || 100,
      playTime: g.state.playTime || 0, audio: g.audio, hud: g.hud, toolOut: this.tool.visible, fear: g.settings.fear ?? 1, calm: g.buffs.mul('dread'),
      centerT: (t) => { this.centerT = t; },
      extraBlips: this.creatures.list.filter((c) => c.sp.watcher || c.sp.plan === 'manikin').map((c) => c.pos),
      onHurt: (dmg, why) => { this._hurtPlayer(dmg, why); },
    });
    g.corruption.update(dt, {
      world: this.world, cam: g.camera, camDir: g.camera.getWorldDirection(new THREE.Vector3()), daylight: this.pocket && this.pocket !== 'station' ? 0 : this.daylight ?? 1,
      inShip: g.inShip, dreamWorld: this.horror.dreamWorld, species: this.creatures.species, visorOn: this.visor, horror: this.horror,
      setMissing: (on) => this._setMissing(on), hideChunks: (on) => this._hideChunks(on),
      skipTime: (d) => { this.dayT = (this.dayT + d) % 1; },
      hurt: (dmg, why) => this._hurtPlayer(dmg, why),
    });
    if (!g.inShip && !this.teleport) this._voidTouch(dt);
    this.sentinels.update(dt, {
      world: this.world, player: pc, inShip: g.inShip, time: g.time,
      fire: (from, dir) => { this.bolts.fire(from, dir, 70, 'sentinel', 7, 0xff3020, 2); g.audio.enemyShoot(); },
      onEvent: (e) => {
        if (e === 'lost') { g.hud.toast('Sentinels', 'They have lost track of you'); }
      },
    });
    g.hud.setWanted(this.sentinels.wanted, this.sentinels.heat);
    for (const n of this.npcs) {
      const d = n.position.distanceTo(pc);
      const want = d < 7 ? Math.atan2(-(pc.x - n.position.x), -(pc.z - n.position.z)) : n.userData.face;
      let dy = want - n.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      n.rotation.y += dy * Math.min(1, dt * 3);
      n.userData.body.position.y = Math.sin(g.time * 1.5 + n.position.x) * 0.02;
      for (const a of n.userData.arms) a.rotation.x = Math.sin(g.time * 1.2 + n.position.z + a.userData.side) * 0.08;
    }
    // projectiles
    this.bolts.update(dt, (b, prev) => this._boltHit(b, prev));
    this.debris.update(dt);
    this.pulse.update(dt);
    // feeding produce
    for (const f of this.feeding) {
      f.t -= dt;
      if (f.t <= 0 && !f.done) {
        f.done = true;
        const n = 3 + Math.floor(Math.random() * 5);
        g.inventory.add(f.item, n);
        g.hud.notify(null, f.item, n);
        g.hud.notify(`${f.name} produced something for you`);
        g.audio.pickup();
      }
    }
    this.feeding = this.feeding.filter((f) => !f.done);
    this._survival(dt);
    this._structures(dt);
    this._whispers(dt);
    this._doorsBehind(dt);
    this._updateHUD(dt);
  }

  // The atlas swapped for the texture of a missing texture
  _setMissing(on) {
    const u = voxelUniforms.uAtlas;
    if (!this.realAtlas) this.realAtlas = u.value;
    if (on) {
      if (!this.missingAtlas) {
        const src = this.realAtlas.image;
        const d = new Uint8Array(src.data.length);
        const per = src.width * src.height * 4;
        for (let i = 0; i < d.length; i += 4) {
          const px = (i % per) / 4, x = px % src.width, y = Math.floor(px / src.width);
          const m = ((x >> 3) + (y >> 3)) & 1;
          d[i] = m ? 250 : 8; d[i + 1] = 0; d[i + 2] = m ? 250 : 8; d[i + 3] = 200;
        }
        this.missingAtlas = new THREE.DataArrayTexture(d, src.width, src.height, src.depth);
        this.missingAtlas.magFilter = THREE.NearestFilter;
        this.missingAtlas.minFilter = THREE.NearestFilter;
        this.missingAtlas.colorSpace = THREE.NoColorSpace;
        this.missingAtlas.needsUpdate = true;
      }
      u.value = this.missingAtlas;
    } else u.value = this.realAtlas;
  }

  // Pieces of the world briefly stop existing
  _hideChunks(on) {
    const W = this.world;
    for (const c of W.chunks.values()) {
      if (!c.meshes) continue;
      const d = Math.hypot(c.cx * 16 + 8 - this.game.player.pos.x, c.cz * 16 + 8 - this.game.player.pos.z);
      const hide = on && d > 24 && (((c.cx * 7 + c.cz * 13) & 3) === 0);
      for (const m of c.meshes) if (m) m.visible = !hide;
    }
  }

  // Touching a void block takes you somewhere else
  _voidTouch(dt) {
    const g = this.game, p = g.player.pos, W = this.world;
    this.voidCd = Math.max(0, (this.voidCd || 0) - dt);
    if (this.voidCd > 0 || this.loading) return;
    for (const [ox, oz] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
      for (const oy of [0.1, 1.0, 1.7]) {
        if (W.getBlock(p.x + ox, p.y + oy, p.z + oz) === B.VOID) {
          this.voidCd = 3;
          g.audio.swell(0.1);
          if (this.pocket === 'void') g.exitVoid(); else if (!this.interior) g.enterVoid();
          return;
        }
      }
    }
  }

  _updatePointLights(dt) {
    const glow = this.game.buffs.has('glow') && !this.game.inShip;
    if (glow && this.glowSlot != null) {
      const p = this.game.player.pos;
      voxelUniforms.uPL.value[this.glowSlot].set(p.x, p.y + 1.3, p.z);
    }
    // an explosion's flare borrows the next free light for a moment
    if (this.flash) {
      const F = this.flash, i = this.glowSlot === 0 ? 1 : 0;
      F.t -= dt;
      const k = Math.max(0, F.t / F.dur) * 2.2;
      voxelUniforms.uPL.value[i].copy(F.pos);
      voxelUniforms.uPLCol.value[i].setRGB(F.color[0] * k, F.color[1] * k, F.color[2] * k);
      voxelUniforms.uPLStrength.value = Math.max(voxelUniforms.uPLStrength.value, 1);
      if (F.t <= 0) { this.flash = null; this.plTimer = 0; }
      else return;
    }
    this.plTimer = (this.plTimer || 0) - dt;
    if (this.plTimer > 0) return;
    this.plTimer = 0.2;
    const W = this.world, cam = this.game.camera.position;
    const pcx = Math.floor(cam.x / 16), pcz = Math.floor(cam.z / 16);
    const cand = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = W.chunks.get((pcx + dx) + ',' + (pcz + dz));
      if (!c || !c.lights) continue;
      const L = c.lights;
      for (let i = 0; i < L.length; i += 4) {
        const x = c.cx * 16 + L[i] + 0.5, y = L[i + 1] + 0.5, z = c.cz * 16 + L[i + 2] + 0.5;
        const d = (x - cam.x) ** 2 + (y - cam.y) ** 2 + (z - cam.z) ** 2;
        if (d < 34 * 34) cand.push([d, x, y, z, L[i + 3]]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    this.glowSlot = null;
    if (glow) {
      const p = this.game.player.pos;
      cand.unshift([0, p.x, p.y + 1.3, p.z, -1]);
      this.glowSlot = 0;
    }
    const u = voxelUniforms;
    const T = this.P.tints;
    for (let i = 0; i < u.uPL.value.length; i++) {
      const c = cand[i];
      if (!c) { u.uPL.value[i].set(0, -9999, 0); u.uPLCol.value[i].setRGB(0, 0, 0); continue; }
      u.uPL.value[i].set(c[1], c[2], c[3]);
      const col = c[4] === -1 ? [0.55, 0.62, 1.4] : POINT_LIGHT_COLORS[c[4]] || [0.6, 0.6, 0.6];
      if (c[4] === B.CRYSTAL) u.uPLCol.value[i].setRGB(T[30] * 0.7, T[31] * 0.7, T[32] * 0.7);
      else u.uPLCol.value[i].setRGB(col[0], col[1], col[2]);
    }
    u.uPLStrength.value = (this.pocket === 'station' ? 0.5 : this.interior ? 1.1 : lerp(1.0, 0.3, this.daylight ?? 1)) * this.horror.flicker;
  }

  _footEvents(ev) {
    const g = this.game;
    if (ev.footstep) {
      const below = this.world.getBlock(g.player.pos.x, g.player.pos.y - 0.5, g.player.pos.z);
      g.audio.footstep([B.POOL_TILE, B.METAL_PLATE, B.MARBLE, B.CHECKER, B.STONE, B.DREAM_TILE, B.METAL_PANEL].includes(below) ? 'hard' : 'soft');
    }
    if (ev.landed) {
      g.audio.land();
      if (ev.landed > 20) this._hurtPlayer((ev.landed - 20) * 2.5, 'fall');
    }
    if (ev.splash) g.audio.splash();
    g.audio.setLoop('jetpack', ev.jetting);
    if (ev.jetting && Math.random() < 0.5) {
      const p = g.player.pos.clone();
      p.y += 0.6;
      this.debris.spawn(p, [0.75, 0.65, 1.0], 1, 1.2, 0.35);
    }
  }

  _updateCamera(dt) {
    const g = this.game;
    if (g.inShip) {
      g.ship.updateCamera(g.camera, dt || 0.016, { groundAt: (x, z) => this.world.groundAt(x, z), raycast: (o, d, n) => this.world.raycast(o, d, n) });
      this.tool.visible = false;
    } else if (this.rover.driving) {
      this.rover.updateCamera(g.camera, dt || 0.016);
      this.tool.visible = false;
    } else {
      g.player.applyCamera(g.camera);
      this.tool.visible = !this.visor;
    }
    const fov = g.settings.fov + (g.inShip || this.rover.driving ? 0 : this.moves.fov);
    if (Math.abs(g.camera.fov - fov) > 0.01) { g.camera.fov = fov; g.camera.updateProjectionMatrix(); }
    g.camera.updateMatrixWorld();
    const lf = this.pocket === 'station' ? 1 : this.interior ? 0.35 : 0.3 + 0.7 * (this.daylight ?? 1);
    this.viewScene.children[1].intensity = 0.6 * Math.PI * lf;
    this.viewLight.intensity = 0.9 * Math.PI * lf;
    this.sky.update(g.camera);
    this.giants.update(g.camera, this.sky.uniforms.uSkyFog.value, this.daylight ?? 1);
    this.clouds.update(g.camera);
    voxelUniforms.uTime.value = g.time;
    voxelUniforms.uTorch.value.copy(g.camera.position);
    g.camera.getWorldDirection(voxelUniforms.uTorchDir.value);
    if (this.rover.driving) this.rover.headlight(voxelUniforms.uTorch.value, voxelUniforms.uTorchDir.value);
    // the same beam for creatures and horrors (always present, so materials never recompile)
    this.torchSpot.position.copy(voxelUniforms.uTorch.value);
    this.torchSpot.target.position.copy(voxelUniforms.uTorch.value).add(voxelUniforms.uTorchDir.value);
    this.torchSpot.target.updateMatrixWorld();
    const ambientDark = 1 - this.daylight;
    const lampOn = this.rover.driving ? this.rover.lights : this.torch && !g.inShip;
    this.torchK = (this.torchK || 0) + ((lampOn ? 1 : 0) - (this.torchK || 0)) * Math.min(1, (dt || 0) * 8);
    voxelUniforms.uTorchOn.value = this.torchK * lerp(1, this.horror.flicker, 0.85);
    this.torchSpot.intensity = voxelUniforms.uTorchOn.value * 70;
    // underwater post effect
    const camBlock = this.world.getBlock(g.camera.position.x, g.camera.position.y, g.camera.position.z);
    const pu = g.post.uniforms;
    pu.uUnderwater.value = camBlock > 0 && IS_LIQUID[camBlock] ? 1 : 0;
    if (pu.uUnderwater.value) {
      const t = this.P.tints;
      if (camBlock === B.LAVA) pu.uWaterColor.value.setRGB(1, 0.4, 0.1);
      else if (camBlock === B.ACID) pu.uWaterColor.value.setRGB(0.5, 1, 0.2);
      else if (camBlock === B.DREAM_WATER) pu.uWaterColor.value.setRGB(1, 0.6, 0.85);
      else pu.uWaterColor.value.setRGB(t[15], t[16], t[17]);
    }
    pu.uDream.value = (this.P.sky.dream || 0) * g.settings.dreamFx;
    pu.uVignette.value = 0.3 + 0.15 * g.settings.dreamFx;
    pu.uCA.value = 0.001 + 0.0025 * g.settings.dreamFx;
    pu.uGrain.value = 0.02 + 0.03 * g.settings.dreamFx;
    // sun shafts through the fog
    {
      const u = voxelUniforms;
      _v.copy(u.uSunDir.value).multiplyScalar(500).add(g.camera.position).project(g.camera);
      const facing = g.camera.getWorldDirection(_v2).dot(u.uSunDir.value);
      const on = !this.interior && _v.z < 1 && facing > 0.1 ? smoothstep(0.1, 0.5, facing) : 0;
      pu.uSunPos.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
      const fogginess = clamp(u.uFogDensity.value * 60 + (this.sky.uniforms.uSkyFog.value || 0) * 0.5, 0, 1.4);
      pu.uRays.value = on * (this.daylight ?? 1) * (1 - (this.stormK || 0) * 0.7) * 0.55 * fogginess * (1 - (this.encK || 0));
      pu.uRayCol.value.copy(u.uSunColor.value).lerp(u.uSunsetCol.value, u.uSunset.value * 0.6);
      pu.uFlare.value = (g.settings.gfx ?? 2) > 0 ? on * (this.daylight ?? 1) * (1 - (this.stormK || 0)) * (1 - (this.encK || 0)) * 0.9 : 0;
    }
    // fear: shaking, swaying, a picture that will not hold still, lights that stutter
    const H = this.horror;
    const fear = g.settings.fear ?? 1;
    pu.uDread.value = H.dread * fear;
    pu.uPulse.value = H.pulse * fear;
    pu.uGlitch.value = H.glitch * fear;
    pu.uFlash.value = H.flash * fear;
    const sh = H.shake * fear;
    if (sh > 0.001 || H.dread > 0.3) {
      const t = g.time;
      g.camera.position.x += (Math.random() - 0.5) * sh * 0.22;
      g.camera.position.y += (Math.random() - 0.5) * sh * 0.22;
      g.camera.rotation.z += (Math.random() - 0.5) * sh * 0.03 + Math.sin(t * 0.63) * 0.012 * Math.max(0, H.dread - 0.3) * fear;
      g.camera.rotation.x += Math.sin(t * 0.41) * 0.006 * Math.max(0, H.dread - 0.3) * fear;
      g.camera.updateMatrixWorld();
    }

    void ambientDark;
  }

  // ---------------- ship on the surface ----------------
  _updateShip(dt, ctl) {
    const g = this.game, ship = g.ship, input = g.input;
    const W = this.world;
    const groundAt = (x, z) => W.groundAt(x, z);
    if (ship.state === 'landed' && this.interior) {
      if (input.hit('Space') || (input.hit('KeyW') && ctl)) { if (!this.leaving) { this.leaving = true; if (this.pocket === 'derelict') g.leaveDerelict(); else g.launchFromStation(); } }
      else if (input.hit('KeyE')) { this._exitShip(); return; }
    } else if (ship.state === 'landed') {
      if (input.hit('Space') || (input.hit('KeyW') && ctl)) {
        const err = ship.tryTakeoff();
        if (err) { g.hud.notify(err); g.audio.warning(); }
        else g.audio.tone(200, 1.2, 'sawtooth', 0.08, 3);
      } else if (input.hit('KeyE')) {
        this._exitShip();
        return;
      }
    } else if (ship.state === 'flying') {
      const alt = ship.pos.y - groundAt(ship.pos.x, ship.pos.z);
      // keep a landing zone picked out ahead while low enough to use it
      this.landScan -= dt;
      if (alt < LAND_ALT && this.landScan <= 0) {
        this.landScan = 0.35;
        const f = ship.forward(_v2).setY(0);
        if (f.lengthSq() > 1e-4) f.normalize();
        const lead = 10 + Math.min(ship.speed, 50) * 0.35;
        this.landSite = this._findLandingSite(ship.pos.x + f.x * lead, ship.pos.z + f.z * lead, ship.yaw(), 18);
      } else if (alt >= LAND_ALT) this.landSite = null;
      if (input.hit('KeyE')) {
        if (alt < LAND_ALT) {
          const site = this.landSite || this._findLandingSite(ship.pos.x, ship.pos.z, ship.yaw(), 24)
            || this._findLandingSite(ship.pos.x, ship.pos.z, ship.yaw(), 42, 0, true);
          if (site) { ship.beginLanding(site, false); this.landSite = null; g.audio.tone(300, 0.5, 'sine', 0.05, 0.6); }
          else g.hud.notify('Nowhere to set down - there is only water below');
        } else g.hud.notify(`Too high to land - descend below ${LAND_ALT}u`);
      }
      if (input.mouseDown(0) && ship.fireCooldown <= 0) {
        ship.fireCooldown = 0.12;
        const fwd = ship.forward(new THREE.Vector3());
        const right = ship.right(new THREE.Vector3());
        for (const s of [-1, 1]) {
          const from = ship.pos.clone().addScaledVector(right, s * 3).addScaledVector(fwd, 2);
          this.bolts.fire(from, fwd, 260 + ship.speed, 'ship', 30 * ship.stats.damage, 0x9ff6ff, 1.2, 1.6);
        }
        g.audio.shipShoot();
      }
    }
    const events = ship.update(dt, input, { mode: 'surface', groundAt, ctl });
    for (const e of events) {
      if (e === 'exitAtmosphere' && !this.leaving) { this.leaving = true; g.leavePlanet(); }
      if (e === 'landed') {
        g.audio.land(); g.hud.notify('Landed. [E] to exit');
        ship.shake = 0.45;
        this._clearFootprint(ship.pos.x, ship.pos.z, ship.yaw(), Math.round(ship.pos.y - 1.75));
        this._shipDust(14, 5);
      }
      if (e === 'tookoff') g.hud.notify('Airborne - climb to leave the atmosphere');
      if (e === 'entered') {
        g.hud.notify(`Atmosphere entered · [E] to land below ${LAND_ALT}u`);
        g.audio.setLoop('reentry', false);
      }
    }
    // re-entry burn: plasma over the nose, roar, buffeting; landing and take-off kick up the ground
    const heat = ship.entryHeat;
    const pl = ship.model.userData.plasma;
    if (pl) {
      pl.group.visible = heat > 0.01;
      pl.shells.forEach((m, i) => {
        m.material.opacity = heat * (0.36 - i * 0.09) * (0.75 + Math.random() * 0.5);
        m.scale.z = (4.5 + i * 3.2) * (0.85 + heat * 0.5 + Math.random() * 0.12);
      });
    }
    if (ship.state === 'entry') {
      g.audio.setLoop('reentry', true, heat);
      if (!this.entryShown && ship.anim && ship.anim.t > 0.4) {
        this.entryShown = true;
        g.hud.setCenter('ATMOSPHERIC ENTRY', '#ffc89a');
        this.centerT = 2.4;
      }
      if (Math.random() < heat * dt * 30) this.debris.spawn(ship.pos.clone().addScaledVector(ship.forward(_v2), -4 - Math.random() * 3), [1, 0.55 + Math.random() * 0.3, 0.25], 2, 3, 0.7, true);
    }
    if (ship.state === 'takeoff' && ship.anim && ship.anim.t < 1.8) {
      this.dustT -= dt;
      if (this.dustT <= 0) { this.dustT = 0.09; this._shipDust(4, 3.5); }
    } else if (ship.state === 'landing' && ship.anim && ship.anim.t > ship.anim.dur * 0.7) {
      this.dustT -= dt;
      if (this.dustT <= 0) { this.dustT = 0.1; this._shipDust(3, 3); }
    }
    g.audio.setLoop('engine', ship.state !== 'landed', ship.speed / 120);
    g.audio.setLoop('laser', false);
    g.audio.setLoop('jetpack', false);
    ship.updateFlames(g.time);
    this.beam.hide();
    this.selection.visible = false;
  }

  // A landing ship flattens the plants and snaps the trees it comes down on
  _clearFootprint(x, z, yaw, gy) {
    const W = this.world;
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let broke = 0;
    for (let a = -7; a <= 6; a++) for (let b = -7; b <= 7; b++) {
      const px = Math.floor(x + fx * a + fz * b), pz = Math.floor(z + fz * a - fx * b);
      for (let y = gy + 1; y <= gy + 7; y++) {
        const id = W.getBlock(px, y, pz);
        if (id <= 0) continue;
        if (SITE_OBSTACLE.has(id) && id !== B.CHEST && id !== B.POD && id !== B.TERMINAL && id !== B.MONOLITH && id !== B.SENTINEL_PILLAR) {
          W.editBlock(px, y, pz, B.AIR); broke++;
          if (broke % 6 === 0) this.debris.spawn(new THREE.Vector3(px + 0.5, y + 0.5, pz + 0.5), BLOCKS[id].color || [0.3, 0.6, 0.3], 4, 3, 0.8);
        } else if (IS_CROSS[id]) W.editBlock(px, y, pz, B.AIR);
      }
    }
    // anything left hanging above the cleared hull (tree crowns) comes down too
    for (let a = -8; a <= 7; a++) for (let b = -8; b <= 8; b++) {
      const px = Math.floor(x + fx * a + fz * b), pz = Math.floor(z + fz * a - fx * b);
      for (let y = gy + 8; y <= gy + 16; y++) {
        const id = W.getBlock(px, y, pz);
        if ((id === B.LEAVES || id === B.LOG || id === B.MUSHROOM_CAP || id === B.MUSHROOM_STEM) && !W.isSolid(px, gy + 7, pz)) W.editBlock(px, y, pz, B.AIR);
      }
    }
    if (broke > 3) this.game.audio.noiseHit(0.4, 700, 0.12, 'lowpass');
  }

  // contracts on this world: hunters you're paid to find show up more, zones get a waypoint
  _missionGuide(dt) {
    this.guideT = (this.guideT || 0) - dt;
    if (this.guideT > 0 || !this.planet || this.interior) return;
    this.guideT = 4;
    const g = this.game, here = this.planet.id;
    const act = g.missions.S.active.filter((m) => m.planet === here);
    this.creatures.bounties = new Set(act.filter((m) => m.type === 'bounty').map((m) => m.plan));
    const T = this.world.terrain, p = g.player.pos;
    for (const m of act) {
      if (m.type !== 'zone') continue;
      let best = null;
      for (let r = 24; r <= 640 && !best; r += 24) {
        const n = Math.max(12, Math.floor(r / 10));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
          const zi = T.zoneAt(x, z);
          if (zi.type === m.zone && zi.blend > 0.7) { best = { x, z }; break; }
        }
      }
      if (best) this._addMarker(new THREE.Vector3(best.x, T.heightAt(Math.floor(best.x), Math.floor(best.z)) + 4, best.z), '◈', ZONE_INFO[m.zone].name, '#ffc46b', 4.5, 'mz:' + m.zone);
    }
  }

  // a ring of dust thrown out from under the ship
  _shipDust(n, speed) {
    const W = this.world, ship = this.game.ship;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 4;
      const x = ship.pos.x + Math.cos(a) * r, z = ship.pos.z + Math.sin(a) * r;
      const gy = W.groundBelow(x, ship.pos.y, z);
      const id = W.getBlock(x, gy, z);
      const col = id > 0 && BLOCKS[id] && BLOCKS[id].color ? BLOCKS[id].color : [0.6, 0.55, 0.5];
      if (ship.pos.y - gy > 14) continue;
      this.debris.spawn(new THREE.Vector3(x, gy + 1.2, z), [col[0] * 0.9 + 0.08, col[1] * 0.9 + 0.08, col[2] * 0.9 + 0.08], 3, speed, 1.1);
    }
  }

  // ---------------- bases ----------------
  _baseMenu(hit) {
    const g = this.game, bases = g.bases;
    const b = bases.baseAt(this.planet.id, hit.x, hit.z);
    g.input.unlock();
    if (!b) { g.menus.dialog('Base Computer', 'This computer has not claimed any land. Break it and place it again away from other bases.'); return; }
    const pl = bases.planters(this.planet.id).filter((q) => Math.hypot(q.x - b.x, q.z - b.z) < BASE_RADIUS).length;
    const all = bases.list.map((q) => `• ${q.name} — ${q.planetName}, ${q.systemName}`).join('\n');
    g.menus.dialog(b.name, `${b.planetName} · ${b.systemName}\nTeleporters: ${b.pads.length} · Planters: ${pl}\nMining within ${BASE_RADIUS}u of this computer never alerts the Sentinels.\n\nYour bases:\n${all}`);
  }

  _teleportMenu(hit) {
    const g = this.game, bases = g.bases;
    const here = bases.baseAt(this.planet.id, hit.x, hit.z);
    const dests = bases.list.filter((b) => b !== here && b.pads.length);
    g.input.unlock();
    if (!dests.length) { g.menus.dialog('Teleporter', 'No other linked bases yet. Build a Base Computer and a Teleporter somewhere else, and this pad will reach it.'); return; }
    g.menus.dialog('Teleporter', 'Where to? Your starship follows you.', [
      ...dests.slice(0, 6).map((b) => ({ label: `${b.name} · ${b.planetName}`, action: () => g.teleportToBase(b) })),
      { label: 'Stay', primary: true },
    ]);
  }

  _storageMenu(hit) {
    const g = this.game, bases = g.bases;
    const key = bases.storageKey(this.planet.id, hit.x, hit.y, hit.z);
    g.input.unlock();
    const show = () => {
      const box = bases.storage(key);
      const lines = box.length ? box.map((q) => `• ${ITEMS[q.id] ? ITEMS[q.id].name : q.id} ×${q.n}`).join('\n') : 'Empty.';
      g.menus.dialog('Storage Crate', lines, [
        { label: 'Stash resources', keepOpen: true, action: () => { const n = bases.stash(key); g.hud.notify(n ? `Stashed ${n} resources` : 'Nothing to stash'); g.menus.closeAll(); show(); } },
        { label: 'Take all', keepOpen: true, action: () => { for (const q of [...bases.storage(key)]) bases.take(key, q.id, q.n); g.menus.closeAll(); show(); } },
        { label: 'Close', primary: true },
      ]);
    };
    show();
  }

  // a crashed ship on a planet: repair it and it's yours
  _wreckMenu(hit) {
    const g = this.game, Y = g.shipyard;
    const key = `${this.planet.id}:wreck:${hit.x},${hit.z}`;
    g.input.unlock();
    if (g.state.used[key]) { g.menus.dialog('Distress Beacon', 'The beacon is quiet now. This ship already flew away with you.'); return; }
    const spec = Y.wreckSpec(this.planet.seed, hit.x, hit.z);
    const cost = Y.wreckCost(spec);
    const scrap = Math.round(tradeIn(g.ship.spec) * 0.5 / 100) * 100;
    g.menus.showWreckOffer(spec, cost, scrap, () => {
      if (!g.inventory.consume(cost)) { g.hud.notify('Missing repair materials'); return false; }
      g.inventory.add('units', scrap);
      g.state.used[key] = 1;
      g.setShip(spec);
      g.ship.shield = 60; g.ship.hull = 70; g.ship.thrustersRepaired = true;
      g.ship.fuel.launch = Math.max(g.ship.fuel.launch, 40);
      this._placeShipNear(g.player.pos, 12);
      g.ship.state = 'landed';
      this.debris.spawn(g.ship.pos.clone(), [0.8, 0.9, 1], 30, 4, 1.2, true);
      g.hud.toast('Starship claimed', `${shipName(spec.seed)} · ${specLabel(spec)} · +${scrap.toLocaleString()} units for the old one`);
      g.audio.discover();
      return true;
    });
  }

  // arrive at a base pad (called after a teleport loads this planet, or for a same-planet hop)
  _arriveAtBase(b) {
    const g = this.game, W = this.world, p = g.player;
    const pad = b.pads[0] || b;
    p.pos.set(pad.x + 0.5, pad.y + 1.02, pad.z + 0.5);
    let guard = 0;
    while (p.collides(W, p.pos.x, p.pos.y, p.pos.z) && guard++ < 30) p.pos.y += 1;
    p.vel.set(0, 0, 0);
    this._placeShipNear(p.pos, 12);
    g.ship.state = 'landed';
    this.debris.spawn(p.pos.clone().add(new THREE.Vector3(0, 1, 0)), [0.75, 0.55, 1], 30, 3, 1.2, true);
    g.audio.tone(420, 0.8, 'sine', 0.07, 2);
  }

  _boardShip() {
    const g = this.game;
    if (this.riding.active) this.riding.dismount();
    g.inShip = true;
    g.ship.camInit = false;
    g.ship.stick.set(0, 0);
    g.audio.tone(330, 0.3, 'triangle', 0.08, 1.5);
    this.beam.hide();
    g.audio.setLoop('laser', false);
    g.audio.setLoop('jetpack', false);
  }

  _exitShip() {
    const g = this.game, ship = g.ship, p = g.player;
    const r = ship.right(new THREE.Vector3()).setY(0).normalize();
    let x = ship.pos.x + r.x * 5, z = ship.pos.z + r.z * 5;
    const gy = this.world.groundBelow(x, ship.pos.y + 1, z);
    p.pos.set(x, gy + 1, z);
    let guard = 0;
    while (p.collides(this.world, p.pos.x, p.pos.y, p.pos.z) && guard++ < 40) p.pos.y += 1;
    p.vel.set(0, 0, 0);
    p.yaw = ship.yaw() + Math.PI / 2;
    p.pitch = -0.1;
    g.inShip = false;
    g.audio.setLoop('engine', false);
    g.audio.tone(250, 0.25, 'triangle', 0.08, 0.7);
  }

  // ---------------- multi-tool ----------------
  _updateTool(dt, ctl) {
    const g = this.game, input = g.input, inv = g.inventory, player = g.player;
    const hud = g.hud;
    this.fireCd -= dt; this.placeCd -= dt; this.scanCd -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 6);
    // mode switching
    const nModes = g.upgradeCount('dream_line') ? 4 : 3;
    if (input.hit('KeyQ')) { this.toolMode = (this.toolMode + 1) % nModes; g.audio.ui(); this.mine.key = null; }
    if (this.toolMode >= nModes) this.toolMode = 0;
    if (this.toolMode !== 3 && this.fishing.state !== 'idle') this.fishing.cancel();
    for (let i = 0; i < 9; i++) {
      if (input.hit('Digit' + (i + 1))) { g.selectedHot = i; this.toolMode = 1; }
    }
    const wheel = input.consumeWheel();
    if (wheel && this.toolMode === 1) g.selectedHot = ((g.selectedHot || 0) + wheel + 9) % 9;
    if (input.hit('KeyV')) { this.visor = !this.visor; g.audio.tone(this.visor ? 900 : 600, 0.1, 'sine', 0.06); this.scanProgress = 0; }
    if (input.hit('KeyT')) { this.torch = !this.torch; g.audio.ui(); }
    if (input.hit('KeyF')) this._scan();
    if (input.hit('KeyR')) this._quickRecharge();
    if (input.hit('KeyH')) g.buffs.quickEat();
    g.post.uniforms.uVisor.value += ((this.visor ? 1 : 0) - g.post.uniforms.uVisor.value) * Math.min(1, dt * 8);
    hud.setVisor(this.visor);

    const cam = g.camera;
    const origin = cam.position.clone();
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const mode = this.toolMode;
    const range = this.visor ? 60 : mode === 0 ? 24 : mode === 1 ? 7.5 : mode === 3 ? 22 : 70;
    const hit = this.world.raycast(origin, dir, range);
    const cHit = this.creatures.raycast(origin, dir, range);
    const dHit = this.sentinels.raycast(origin, dir, range);
    const hHit = this.visor ? null : this.horror.raycast(origin, dir, range);
    let target = null;
    if (hit) target = { kind: 'block', dist: hit.dist, hit };
    if (cHit && (!target || cHit.dist < target.dist)) target = { kind: 'creature', dist: cHit.dist, c: cHit.creature };
    if (dHit && (!target || dHit.dist < target.dist)) target = { kind: 'drone', dist: dHit.dist, d: dHit.drone };
    if (hHit && (!target || hHit.dist < target.dist)) target = { kind: 'hollow', dist: hHit.dist };
    this.target = target;

    // selection box
    if (hit && !this.visor && mode < 2 && (!target || target.kind === 'block')) {
      this.selection.visible = true;
      this.selection.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.selection.material.color.set(TOOL_COLORS[mode]);
    } else this.selection.visible = false;

    // interaction prompt
    this._interaction(target, dt);

    const muzzle = this._muzzleWorld(cam);
    const lmb = ctl && input.mouseDown(0);
    let beamOn = false;
    if (this.visor) {
      this._visorScan(dt, target, lmb);
      hud.setCrosshair('ring');
    } else if (mode === 0) {
      hud.setCrosshair('');
      hud.showScan(null);
      // heat
      if (lmb && !this.overheated) {
        beamOn = true;
        if (!this.encounters.overcharge) this.heat += dt / 7;
        if (this.heat >= 1) { this.overheated = true; g.hud.notify('Mining beam overheated'); g.audio.tone(300, 0.4, 'square', 0.06, 0.5); }
        const end = target ? origin.clone().addScaledVector(dir, target.dist) : origin.clone().addScaledVector(dir, range);
        this.beam.show(muzzle, end, TOOL_COLORS[0], g.time, 0.03);
        if (target && target.kind === 'block') this._mineBlock(target.hit, dt, 'mine');
        else if (target && target.kind === 'creature') this._damageCreature(target.c, 24 * dt);
        else if (target && target.kind === 'drone') this._damageDrone(target.d, 24 * dt);
        else if (target && target.kind === 'hollow') this._damageHollow(30 * dt);
        if (target && Math.random() < 0.4) this.debris.spawn(end, [0.7, 1, 1], 1, 2, 0.3, true);
      } else {
        this.heat = Math.max(0, this.heat - dt / (this.overheated ? 2.5 : 1.5));
        if (this.overheated && this.heat <= 0.05) this.overheated = false;
        this.mine.progress = Math.max(0, this.mine.progress - dt * 2);
      }
      hud.setProgress(beamOn && this.mine.key ? this.mine.progress : (this.heat > 0.02 ? null : null));
    } else if (mode === 1) {
      hud.setCrosshair('dot');
      hud.showScan(null);
      if (lmb && hit) {
        beamOn = true;
        this.beam.show(muzzle, hit.point, TOOL_COLORS[1], g.time, 0.02);
        this._mineBlock(hit, dt, 'build');
      } else this.mine.progress = Math.max(0, this.mine.progress - dt * 3);
      hud.setProgress(lmb && this.mine.key ? this.mine.progress : null);
      if (ctl && input.mouseDown(2) && hit && this.placeCd <= 0) {
        this.placeCd = 0.2;
        this._placeBlock(hit);
      }
      if (!input.mouseDown(2)) this.placeCd = Math.min(this.placeCd, 0);
    } else if (mode === 3) {
      hud.setCrosshair('ring');
      hud.showScan(null);
      hud.setProgress(null);
      this.fishing.update(dt, { lmbHit: ctl && input.mouseHit(0), lmbDown: lmb, origin, dir, muzzle });
    } else {
      hud.setCrosshair('');
      hud.showScan(null);
      hud.setProgress(null);
      if (ctl && input.mouseHit(2)) this.grenades.throw(muzzle, dir, player.vel);
      if (lmb && this.fireCd <= 0) {
        this.fireCd = 0.16;
        const spread = new THREE.Vector3((Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02, (Math.random() - 0.5) * 0.02);
        this.bolts.fire(muzzle, dir.clone().add(spread), 150, 'player', 14, 0xffa45a, 1.5);
        this.recoil = 1;
        g.audio.shoot();
      }
    }
    if (!beamOn) this.beam.hide();
    g.audio.setLoop('laser', beamOn && mode === 0);
    // viewmodel animation
    const t = this.tool;
    const bob = player.bob;
    // idle sway, breathing, and a little tremble when afraid
    const tr = this.horror.dread > 0.5 ? (this.horror.dread - 0.5) * 0.006 : 0;
    const br = Math.sin(g.time * 1.3) * 0.004;
    t.position.set(0.27 + Math.cos(bob * 0.5) * 0.01 + (Math.random() - 0.5) * tr, -0.235 + Math.sin(bob) * 0.012 - this.recoil * 0.02 + br + (Math.random() - 0.5) * tr, -0.6 + this.recoil * 0.06);
    t.rotation.set(0.04 + this.recoil * 0.22 + br * 0.5, 0.1, Math.sin(g.time * 0.9) * 0.01);
    if (beamOn) t.position.x += (Math.random() - 0.5) * 0.004;
    animateMultitool(t, dt, {
      mode, color: this.overheated ? 0xff4020 : TOOL_COLORS[mode], heat: this.heat || 0, overheated: this.overheated,
      active: beamOn || this.recoil > 0.3, time: g.time, blips: this.horror.blips, dread: this.horror.dread, ping: this.horror.trackerPing || 0,
    });
  }

  // Where the view-model's muzzle appears on screen, pushed into the world along that pixel's ray
  _muzzleWorld(cam) {
    this.tool.updateMatrixWorld(true);
    const ndc = this.tool.userData.muzzle.getWorldPosition(new THREE.Vector3()).project(this.viewCamera);
    const dir = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(cam).sub(cam.position).normalize();
    return cam.position.clone().addScaledVector(dir, 0.9);
  }

  _mineBlock(hit, dt, how) {
    const g = this.game;
    if (this.pocket === 'station') { g.hud.setCenter('Station hull is protected', '#9fd8ff'); this.centerT = 1; return; }
    const def = BLOCKS[hit.id];
    if (!def || def.unbreakable || hit.id === B.BEDROCK) {
      this.game.hud.setCenter(def && def.interact ? '' : 'This will not break', '#ff9f9f');
      this.centerT = 1;
      return;
    }
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (this.mine.key !== key) { this.mine.key = key; this.mine.progress = 0; }
    const speed = how === 'mine' ? 1.5 * g.player.upgrades.mining : 3.2;
    this.mine.progress += dt * speed / Math.max(0.12, def.hardness);
    if (Math.random() < dt * 20) this.debris.spawn(new THREE.Vector3(hit.x + 0.5 + hit.nx * 0.5, hit.y + 0.5 + hit.ny * 0.5, hit.z + 0.5 + hit.nz * 0.5), def.color, 1, 2.5, 0.5);
    if (this.mine.progress >= 1) {
      this.mine.key = null;
      this.mine.progress = 0;
      this._breakBlock(hit.x, hit.y, hit.z, how);
    }
  }

  _breakBlock(x, y, z, how) {
    const g = this.game, W = this.world;
    const id = W.getBlock(x, y, z);
    const def = BLOCKS[id];
    if (!def || id <= 0) return;
    // above cross plant falls too
    const above = W.getBlock(x, y + 1, z);
    W.setBlock(x, y, z, B.AIR);
    if (FUNCTIONAL.has(id) && this.planet) g.bases.broken(id, x, y, z, this.planet);
    if (above > 0 && IS_CROSS[above]) { W.setBlock(x, y + 1, z, B.AIR); this._drops(above, how); }
    this.debris.spawn(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), def.color, 14, 4, 1.1);
    g.audio.breakBlock();
    this._drops(id, how);
    const home = this.planet && g.bases.baseAt(this.planet.id, x, z);
    if (how === 'mine' && !home) {
      if (def.restricted) {
        if (this.sentinels.raise(1)) { g.hud.toast('Sentinels Alerted', 'Restricted structure damaged'); g.audio.alert(); }
      } else if (this.sentinels.addHeat(1.5 + def.hardness * 1.5)) {
        g.hud.toast('Sentinels Alerted', 'Excessive mining detected'); g.audio.alert();
      }
    }
  }

  _drops(id, how) {
    const g = this.game, inv = g.inventory;
    const def = BLOCKS[id];
    if (how === 'build' || FUNCTIONAL.has(id)) {
      if (def.collect) { inv.addBlock(id, 1); g.audio.pickup(); }
      return;
    }
    for (const [item, mn, mx] of def.drops) {
      const n = mn + Math.floor(Math.random() * (mx - mn + 1));
      if (n <= 0) continue;
      const it = item === '@special' ? this.P.special : item;
      if (!ITEMS[it]) continue;
      const added = inv.add(it, n);
      if (added > 0) g.hud.notify(null, it, added);
      if (added < n) g.hud.setCenter('Exosuit inventory full', '#ff9f9f');
    }
    g.audio.pickup();
  }

  _placeBlock(hit) {
    const g = this.game, W = this.world, inv = g.inventory, p = g.player;
    if (this.pocket === 'station') { g.hud.setCenter('Building is not permitted aboard the station', '#9fd8ff'); this.centerT = 1; return; }
    if (this.pocket === 'void') { g.hud.setCenter('Nothing you place here will stay.', '#b8b8c8'); this.centerT = 1.5; return; }
    const id = inv.hotbar[g.selectedHot || 0];
    if (!id || !isPlaceable(id)) { g.hud.notify('Select a block (1-9)'); return; }
    if (inv.blockCount(id) <= 0) { g.hud.notify(`No ${BLOCKS[id].name} left - collect or fabricate more`); return; }
    let x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
    if (IS_CROSS[hit.id]) { x = hit.x; y = hit.y; z = hit.z; }
    const cur = W.getBlock(x, y, z);
    if (cur < 0 || !(IS_AIRLIKE[cur] || IS_LIQUID[cur] || IS_CROSS[cur])) return;
    // don't place inside the player
    if (BLOCKS[id].solid) {
      const minX = p.pos.x - 0.3, maxX = p.pos.x + 0.3, minY = p.pos.y, maxY = p.pos.y + 1.8, minZ = p.pos.z - 0.3, maxZ = p.pos.z + 0.3;
      if (x + 1 > minX && x < maxX && y + 1 > minY && y < maxY && z + 1 > minZ && z < maxZ) return;
    }
    if (W.setBlock(x, y, z, id)) {
      inv.removeBlock(id, 1);
      if (FUNCTIONAL.has(id) && this.planet && !this.interior) g.bases.placed(id, x, y, z, this.planet);
      g.audio.place();
      this.debris.spawn(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), BLOCKS[id].color, 4, 1.5, 0.4);
    }
  }

  _dmgNums() {
    if (!this.dmg) this.dmg = new DamageNumbers(this.game.hud.root);
    return this.dmg;
  }

  // a light that flares for a moment (explosions, impacts)
  flashAt(pos, color, dur) {
    this.flash = { pos: pos.clone(), color, t: dur, dur };
  }

  _damageCreature(c, dmg) {
    const g = this.game;
    const wasDead = c.dead;
    const died = this.creatures.damage(c, dmg, g.player.pos);
    if (!wasDead && !c.hidden && !c.vanished) {
      _v.copy(c.pos); _v.y += (c.sp.hitY ? c.sp.hitY : 1) * c.sp.size + 0.6;
      this._dmgNums().add(c, _v, c.lastHit ?? dmg, died ? 'kill' : c.glance ? 'glance' : 'hit');
    }
    if (c.glance) {
      // armour: sparks and a ring instead of a wound
      this.glanceCd = (this.glanceCd || 0) - 1;
      if (this.glanceCd <= 0) {
        this.glanceCd = 6;
        this.debris.spawn(c.pos.clone().add(new THREE.Vector3(0, c.sp.size, 0)), [1, 0.85, 0.5], 6, 4, 0.3, true);
        g.audio.tone(1900, 0.08, 'square', 0.04, 0.7);
      }
      if (c.sp.plan === 'brute') this.cfx.hint('brute', 'Your shots glance off its front.', '#ffcf9a');
    }
    if (died) {
      this.debris.spawn(c.pos.clone().add(new THREE.Vector3(0, c.sp.size * 0.6, 0)), c.sp.plan === 'swarm' ? c.sp.c3 : c.sp.c1, 24, 5, 1.4, c.sp.plan === 'swarm');
      const n = 2 + Math.floor(Math.random() * 4);
      g.inventory.add('mordite', n);
      g.hud.notify(null, 'mordite', n);
      const drop = VERMIN_DROPS[c.sp.plan];
      if (drop) { const k = drop[1] + Math.floor(Math.random() * (drop[2] - drop[1] + 1)); g.inventory.add(drop[0], k); g.hud.notify(null, drop[0], k); }
      if (c.sp.plan === 'lurker') { const k = 12 + Math.floor(Math.random() * 14); g.inventory.add('ferrite', k); g.hud.notify(null, 'ferrite', k); }
      g.audio.explosion(0.5);
      g.missions.event('kill', { plan: c.sp.plan, planet: this.planet.id });
      if (c.sp.hostile) {
        if (!g.state.flags['slain_' + c.sp.plan]) { g.state.flags['slain_' + c.sp.plan] = true; g.hud.toast(`${c.sp.name} slain`, c.sp.note); }
      } else if (this.sentinels.raise(1)) { g.hud.toast('Sentinels Alerted', 'Fauna harmed'); g.audio.alert(); }
    }
  }

  // creature sounds, quieter with distance
  _critterSound(kind, pos) {
    const g = this.game, a = g.audio;
    const p = g.inShip ? g.ship.pos : g.player.pos;
    const d = pos ? Math.hypot(pos.x - p.x, pos.y - p.y, pos.z - p.z) : 0;
    const v = Math.max(0, 1 - d / 60);
    if (v <= 0.03) return;
    switch (kind) {
      case 'pop': a.tone(900 + Math.random() * 500, 0.06, 'sine', 0.05 * v, 2.2); break;
      case 'splat': a.noiseHit(0.25, 700, 0.18 * v, 'lowpass'); break;
      case 'roar': a.tone(70, 0.9, 'sawtooth', 0.12 * v, 0.6); a.noiseHit(0.8, 300, 0.2 * v, 'lowpass'); break;
      case 'snort': a.noiseHit(0.3, 500, 0.14 * v, 'bandpass'); break;
      case 'thud': a.noiseHit(0.35, 160, 0.3 * v, 'lowpass'); break;
      case 'squeak': a.tone(1300, 0.12, 'triangle', 0.05 * v, 1.6); break;
      case 'dig': a.noiseHit(0.5, 400, 0.12 * v, 'lowpass'); break;
      case 'flutter': a.noiseHit(0.25, 2200, 0.06 * v, 'bandpass', 3); break;
      case 'screech': a.tone(2200, 0.6, 'sawtooth', 0.06 * v, 0.35); break;
      case 'hiss': a.noiseHit(0.5, 4000, 0.1 * v, 'highpass'); break;
      case 'rumble': a.noiseHit(1.1, 90, 0.35 * v, 'lowpass'); break;
      case 'boing': a.tone(260, 0.18, 'sine', 0.05 * v, 2.4); break;
      case 'squelch': a.noiseHit(0.2, 600, 0.12 * v, 'lowpass'); a.tone(180, 0.15, 'sine', 0.05 * v, 0.5); break;
      case 'song': [220, 277, 330].forEach((f, i) => a.tone(f, 2.6 + i * 0.4, 'sine', 0.045 * v, 1.02)); break;
      case 'tuck': a.tone(420, 0.1, 'triangle', 0.05 * v, 0.6); break;
      case 'chomp': a.noiseHit(0.12, 900, 0.22 * v, 'bandpass'); a.tone(110, 0.1, 'square', 0.05 * v, 0.7); break;
      case 'spit': a.noiseHit(0.25, 1400, 0.14 * v, 'bandpass'); a.tone(300, 0.2, 'sine', 0.05 * v, 0.4); break;
      case 'gurgle': a.tone(140, 0.6, 'sine', 0.06 * v, 1.5); a.noiseHit(0.5, 350, 0.08 * v, 'lowpass'); break;
      case 'buzz': a.tone(340 + Math.random() * 80, 0.12, 'sawtooth', 0.02 * v, 1.05); break;
      case 'shriek': a.tone(1600, 0.7, 'sawtooth', 0.1 * v, 0.4); a.noiseHit(0.6, 2500, 0.12 * v, 'bandpass'); break;
    }
  }

  _damageDrone(d, dmg) {
    const g = this.game;
    const killed = this.sentinels.damage(d, dmg);
    _v.copy(d.pos); _v.y += 0.8;
    this._dmgNums().add(d, _v, dmg, killed ? 'kill' : 'hit');
    if (killed) {
      this.debris.spawn(d.pos, [0.8, 0.8, 0.85], 30, 7, 1.5);
      this.debris.spawn(d.pos, [1, 0.3, 0.2], 12, 5, 1, true);
      g.audio.explosion(1);
      const n = 4 + Math.floor(Math.random() * 6);
      g.inventory.add('pugneum', n);
      g.inventory.add('nanites', 6 + Math.floor(Math.random() * 8));
      g.hud.notify(null, 'pugneum', n);
    }
  }

  // Fade the HUD after a quiet spell; any activity, danger or need brings it back.
  _calm(dt, busy) {
    const g = this.game, st = g.player.stats, input = g.input;
    const active = busy || g.inShip || this.visor || input.mouse.buttons || input.pressed.size > 0 && [...input.pressed].some((k) => !/^Key[WASD]$|^Space$|^Shift/.test(k))
      || this.lastDamage < 6 || st.health < 60 || st.hazard < 35 || st.life < 30 || (this.mine && this.mine.progress > 0) || this.centerT > 0;
    this.calmT = active ? 0 : (this.calmT || 0) + dt;
    g.hud.setCalm(g.settings.hudFade !== false && this.calmT > 10 ? 1 : 0, dt);
  }

  _hurtPlayer(dmg, why) {
    const g = this.game;
    if (g.inShip) { g.ship.shield = Math.max(0, g.ship.shield - dmg * 0.5 / (g.ship.upgrades.shield * g.ship.stats.shield)); return; }
    if (this.moves.invulnerable && why !== 'fall') {
      // a perfect dodge
      if ((this.dodgeCd || 0) < g.time) {
        this.dodgeCd = g.time + 0.3;
        this._dmgNums().text(g.player.eye.add(g.camera.getWorldDirection(_v).multiplyScalar(2.5)), 'DODGE');
        g.audio.tone(1300, 0.1, 'sine', 0.05, 1.6);
      }
      return;
    }
    g.player.damage(dmg);
    this.lastHurtBy = why || null;
    this.lastDamage = 0;
    g.post.uniforms.uDamage.value = Math.min(1, g.post.uniforms.uDamage.value + dmg / 25);
    g.audio.hurt();
  }

  _boltHit(b, prev) {
    const g = this.game;
    // terrain
    const steps = Math.ceil(prev.distanceTo(b.p) / 0.8);
    for (let i = 1; i <= steps; i++) {
      _v.lerpVectors(prev, b.p, i / steps);
      if (this.world.isSolid(_v.x, _v.y, _v.z)) {
        this.debris.spawn(_v, [b.color.r, b.color.g, b.color.b], 4, 3, 0.4, true);
        return true;
      }
    }
    if (b.owner === 'sentinel') {
      if (g.inShip) {
        if (b.p.distanceTo(g.ship.pos) < 3) { this._hurtPlayer(b.damage); return true; }
        return false;
      }
      _v.copy(g.player.pos); _v.y += 0.9;
      if (b.p.distanceTo(_v) < 0.9) { this._hurtPlayer(b.damage); return true; }
      return false;
    }
    const d = this.sentinels.hitSphere(b.p, 0.3);
    if (d) { this._damageDrone(d, b.damage); this.debris.spawn(b.p, [1, 0.8, 0.5], 5, 3, 0.4, true); return true; }
    const c = this.creatures.hitSphere(b.p, 0.3);
    if (c) { this._damageCreature(c, b.damage); this.debris.spawn(b.p, c.sp.c1, 5, 3, 0.4); return true; }
    if (this.horror.hitSphere(b.p, 0.3)) { this._damageHollow(b.damage); this.debris.spawn(b.p, [0.8, 0.78, 0.74], 6, 3, 0.5); return true; }
    return false;
  }

  _damageHollow(dmg) {
    const g = this.game;
    if (this.horror.damageHollow(dmg, { audio: g.audio })) {
      g.inventory.add('memory_fragment', 3); g.hud.notify(null, 'memory_fragment', 3);
      if (Math.random() < 0.35) { g.inventory.add('void_egg', 1); g.hud.notify(null, 'void_egg', 1); }
      g.hud.setCenter('It will be back.', '#d8d0e8'); this.centerT = 3;
    }
  }

  // ---------------- interaction ----------------
  _interaction(target, dt = 1 / 60) {
    const g = this.game, input = g.input, ship = g.ship, p = g.player, hud = g.hud;
    let prompt = null, action = null;
    const dShip = Math.hypot(ship.pos.x - p.pos.x, ship.pos.z - p.pos.z);
    if (this.riding.active) {
      prompt = '<span class="key">E</span>Dismount';
      action = () => this.riding.dismount();
    } else if (this.rover.canBoard(p.pos)) {
      prompt = '<span class="key">E</span>Drive the Roamer';
      action = () => this.rover.board();
    } else if (!g.inShip && this.encounters.interaction(p.pos)) {
      ({ prompt, action } = this.encounters.interaction(p.pos));
    } else if (dShip < 6.5 && Math.abs(ship.pos.y - p.pos.y) < 5 && ship.state === 'landed') {
      prompt = '<span class="key">E</span>Board starship';
      action = () => this._boardShip();
    } else if (target && target.dist < 5.5) {
      if (target.kind === 'block') {
        const def = BLOCKS[target.hit.id];
        if (def.interact === 'chest') { prompt = '<span class="key">E</span>Open dream cache'; action = () => this._openChest(target.hit); }
        else if (def.interact === 'monolith') { prompt = '<span class="key">E</span>Touch the monolith'; action = () => this._monolith(target.hit); }
        else if (def.interact === 'terminal') {
          const t = this.pocket === 'station' ? STATION_TERMINALS.find((q) => q.x === target.hit.x && q.z === target.hit.z) : null;
          const o = t && t.kind === 'ship' ? g.shipyard.offer(t.bay) : null;
          prompt = `<span class="key">E</span>${o ? `${o.name} · ${o.label} · ${o.price.toLocaleString()}u` : t ? t.label : this.pocket === 'derelict' ? 'Read the crew log' : 'Access terminal'}`;
          action = () => this._terminal(target.hit);
        }
        else if (def.interact === 'pod') { prompt = '<span class="key">E</span>Open exosuit pod'; action = () => this._pod(target.hit); }
        else if (def.interact === 'door') { prompt = '<span class="key">E</span>Open the dream door'; action = () => this._dreamDoor(target.hit); }
        else if (def.interact === 'basecore') { prompt = '<span class="key">E</span>Base Computer'; action = () => this._baseMenu(target.hit); }
        else if (def.interact === 'teleporter') { prompt = '<span class="key">E</span>Teleport'; action = () => this._teleportMenu(target.hit); }
        else if (def.interact === 'storage') { prompt = '<span class="key">E</span>Open storage crate'; action = () => this._storageMenu(target.hit); }
        else if (def.interact === 'wreck') { prompt = '<span class="key">E</span>Inspect the crashed starship'; action = () => this._wreckMenu(target.hit); }
        else if (def.interact === 'cook') { prompt = '<span class="key">E</span>Nutrient Processor'; action = () => { g.input.unlock(); g.menus.showCooking(); g.audio.ui(); }; }
        else if (def.interact === 'planter') {
          const pl = g.bases.planterAt(this.planet.id, target.hit.x, target.hit.y, target.hit.z);
          if (pl) {
            const grown = W_above(this.world, target.hit) > 0;
            prompt = `<span class="key">E</span>Crop: ${CROPS[pl.crop][1]} · ${grown ? 'ready to harvest' : Math.round(g.bases.growth(pl) * 100) + '% grown'} (E to change)`;
            action = () => { g.hud.notify(`Planter will grow ${g.bases.cycleCrop(pl)}`); g.audio.ui(); };
          }
        }
        else if (target.hit.id === B.TV && this.pocket === 'void') { prompt = '<span class="key">E</span>Watch'; action = () => { g.input.unlock(); g.menus.dialog('', VOID_TV[(g.state.flags.voidVisits || 0) % VOID_TV.length]); }; }
      } else if (target.kind === 'creature') {
        const c = target.c;
        if (this.riding.canRide(c)) {
          prompt = `<span class="key">E</span>Ride ${g.nameOf(c.sp)}`;
          action = () => this.riding.mount(c);
        } else if (!c.sp.hostile && (c.sp.temper !== 'Watching' || c.sp.plan === 'moth')) {
          prompt = `<span class="key">E</span>Feed ${g.state.discoveries.creatures[c.sp.id] ? c.sp.name : 'creature'} (5 Carbon)`;
          action = () => this._feed(c);
        }
      }
    }
    if (!prompt && this.npcs.length) {
      const cam = g.camera;
      const dir = cam.getWorldDirection(new THREE.Vector3());
      for (const n of this.npcs) {
        const c = n.position.clone().add(new THREE.Vector3(0, 1.4, 0));
        const toN = c.clone().sub(cam.position);
        const d = toN.length();
        if (d < 4.5 && toN.normalize().dot(dir) > 0.93) {
          prompt = '<span class="key">E</span>Talk to traveller';
          action = () => { g.input.unlock(); g.menus.dialog('Traveller', n.userData.line); g.audio.ui(); };
          break;
        }
      }
    }
    if (this.toolMode === 0 && this.overheated) prompt = prompt || 'Mining beam cooling…';
    hud.setPrompt(prompt);
    this._calm(dt, !!prompt);
    if (action && input.hit('KeyE')) action();
  }

  _lootFor(x, y, z) {
    const rng = new RNG(hash32(this.planet.seed, x, y, z));
    const out = [];
    const liminal = this.nearStructures.some((s) => s.liminal && Math.hypot(s.cx - x, s.cz - z) < 40);
    const pool = liminal ? LOOT_DREAM : LOOT_TECH;
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const id = rng.pick(pool);
      const cnt = ITEMS[id].stack ? rng.int(1, 2) : rng.int(3, 12);
      out.push([id, cnt]);
    }
    if (rng.chance(0.5)) out.push(['units', rng.int(300, 1500)]);
    if (rng.chance(0.35)) out.push(['nanites', rng.int(5, 25)]);
    if (rng.chance(liminal ? 0.12 : 0.06)) out.push([liminal ? 'lucid_core' : 'warp_cell', 1]);
    if (liminal && rng.chance(0.4)) out.push(['chroma_shard', rng.int(2, 5)]);
    return out;
  }

  _openChest(hit) {
    const g = this.game;
    const loot = this.pocket === 'derelict' ? this._derelictLoot(hit) : this.pocket === 'void' ? [['null_shard', 1], ['memory_fragment', 2]] : this._lootFor(hit.x, hit.y, hit.z);
    for (const [id, n] of loot) {
      g.inventory.add(id, n);
      if (id === 'units' || id === 'nanites') g.hud.notify(`+${n} ${id === 'units' ? 'Units' : 'Nanites'}`);
      else g.hud.notify(null, id, n);
    }
    this.world.setBlock(hit.x, hit.y, hit.z, B.CHEST_OPEN);
    if (this.planet && !this.interior) g.missions.event('cache', { planet: this.planet.id });
    this.debris.spawn(new THREE.Vector3(hit.x + 0.5, hit.y + 1, hit.z + 0.5), [1, 0.85, 0.6], 16, 3, 1.2, true);
    g.audio.discover();
  }

  _derelictLoot(hit) {
    const r = new RNG(hash32(this.P.derelictSeed, hit.x, hit.z, 77));
    const out = [['salvage', r.int(1, 3)], ['units', r.int(900, 3200)]];
    if (r.chance(0.5)) out.push(['crew_tag', 1]);
    if (r.chance(0.35)) out.push(['ferrite', r.int(20, 60)]);
    if (r.chance(0.18)) out.push(['warp_cell', 1]);
    if (r.chance(0.25)) out.push(['antimatter', r.int(1, 2)]);
    return out;
  }

  _usedKey(x, z) { return `${this.planet.id}:${x >> 3},${z >> 3}`; }

  _monolith(hit) {
    const g = this.game, key = this._usedKey(hit.x, hit.z);
    if (g.state.used[key]) {
      g.menus.dialog('Monolith', 'The stone is quiet now. It remembers you.');
      g.input.unlock();
      return;
    }
    g.state.used[key] = 1;
    const text = MONOLITH[hash32(this.planet.seed, hit.x >> 3, hit.z >> 3) % MONOLITH.length];
    const nan = 20 + (hash32(hit.x, hit.z) % 25);
    g.inventory.add('nanites', nan);
    g.inventory.add('units', 1200);
    g.addLore(text);
    g.input.unlock();
    g.menus.dialog('Ancient Monolith', `${text}\n\n+${nan} nanites · +1,200 units`);
    g.audio.discover();
  }

  _terminal(hit) {
    const g = this.game, key = this._usedKey(hit.x, hit.z) + 't';
    if (this.pocket === 'derelict') {
      const terms = derelictTerminals(this.P.derelictSeed);
      const idx = terms.findIndex((t) => t.x === hit.x && t.z === hit.z);
      const log = DERELICT_LOGS[(Math.max(0, idx) + this.P.derelictSeed) % DERELICT_LOGS.length];
      g.input.unlock();
      const k = `${this.planet.id}:log:${hit.x},${hit.z}`;
      let extra = '';
      if (!g.state.used[k]) { g.state.used[k] = 1; g.inventory.add('salvage', 1); extra = '\n\n+1 Salvaged Data'; }
      g.menus.dialog(`Crew log · ${log[0]}`, log[1] + extra);
      g.audio.ui();
      return;
    }
    if (this.interior) {
      const t = STATION_TERMINALS.find((q) => q.x === hit.x && q.z === hit.z);
      g.input.unlock();
      if (t && t.kind === 'ship') { g.menus.showShipOffer(t.bay); g.audio.ui(); return; }
      if (!t || t.kind === 'archive') {
        g.saveGame(true);
        g.menus.dialog('Dream Archive', 'Your journey has been recorded in the station archive.\nThe archive hums, pleased.');
      } else g.menus.openStation(t.kind);
      g.audio.ui();
      return;
    }
    const text = TERMINAL[hash32(this.planet.seed, hit.x, hit.z) % TERMINAL.length];
    let extra = '';
    if (!g.state.used[key]) {
      g.state.used[key] = 1;
      g.inventory.add('units', 600);
      const list = this._listStructures(hit.x, hit.z, 700).filter((s) => !g.state.discoveries.structures[this._structKey(s)] && Math.hypot(s.cx - hit.x, s.cz - hit.z) > 30);
      if (list.length) {
        const s = list[0];
        this._addMarker(new THREE.Vector3(s.cx, s.y + 2, s.cz), STRUCTURE_INFO[s.type].icon, s.name, '#ffb6ec', 600, 'struct:' + this._structKey(s));
        extra = `\n\nCoordinates recovered: ${s.name}, ${Math.round(s.dist)}u away. Marked on your compass.`;
      }
      extra += '\n+600 units';
    }
    g.addLore(text);
    g.input.unlock();
    g.menus.dialog('Terminal', text + extra);
    g.audio.ui();
  }

  _pod(hit) {
    const g = this.game;
    g.inventory.expand(2);
    this.world.setBlock(hit.x, hit.y, hit.z, B.POD_OPEN);
    g.hud.toast('Exosuit Upgraded', `Cargo capacity increased to ${g.inventory.capacity} slots`);
    g.audio.discover();
  }

  _dreamDoor(hit) {
    const g = this.game;
    const list = this._listStructures(hit.x, hit.z, 1400).filter((s) => s.liminal && s.dist > 150);
    if (!list.length) { g.hud.notify('The door opens onto a wall. It closes again.'); return; }
    const dest = list[hash32(this.planet.seed, hit.x, hit.y, hit.z) % list.length];
    g.audio.tone(220, 1.5, 'sine', 0.1, 3);
    g.fade(0.6, () => {
      const p = g.player;
      p.pos.set(dest.cx + 0.5, dest.y + 1, dest.cz + 0.5);
      p.vel.set(0, 0, 0);
      this.teleport = { dest, t: 0 };
      g.hud.toast(dest.name, 'You step through, and the door is gone behind you.');
    }, 0xfff0fa);
  }

  _finishTeleport() {
    const tp = this.teleport, W = this.world, p = this.game.player;
    if (tp.base) { this.teleport = null; this._arriveAtBase(tp.base); return; }
    const s = tp.dest;
    // find standing room inside the structure
    for (let r = 0; r < 14; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = Math.floor(s.cx) + dx, z = Math.floor(s.cz) + dz;
        for (let y = s.y - 1; y <= s.y + 16; y++) {
          const b0 = W.getBlock(x, y, z), b1 = W.getBlock(x, y + 1, z), below = W.getBlock(x, y - 1, z);
          if (IS_AIRLIKE[b0] && IS_AIRLIKE[b1] && below > 0 && IS_SOLID[below]) {
            p.pos.set(x + 0.5, y, z + 0.5);
            this.teleport = null;
            return;
          }
        }
      }
    }
    p.pos.y = W.groundAt(p.pos.x, p.pos.z) + 1;
    this.teleport = null;
  }

  _feed(c) {
    const g = this.game;
    if (c.fed > 0) { g.hud.notify(`${c.sp.name} is content`); return; }
    if (!g.inventory.remove('carbon', 5)) { g.hud.notify('Need 5 Carbon to feed'); return; }
    c.fed = 90;
    c.provoked = false;
    c.state = 'follow'; c.timer = 8;
    if (c.sp.plan !== 'manikin') {
      const comps = this.creatures.list.filter((q) => q.companion);
      if (comps.length >= 3) comps[0].companion = false;
      c.companion = true;
      g.hud.notify(`${g.state.discoveries.creatures[c.sp.id] ? c.sp.name : 'The creature'} will follow you now`);
      if (c.sp.ride) { g.hud.setCenter('It trusts you. Look at it and press E to ride.', '#e8f4ff'); this.centerT = 3.5; }
    }
    this.debris.spawn(c.pos.clone().add(new THREE.Vector3(0, c.sp.size + 0.5, 0)), [1, 0.5, 0.8], 10, 1.5, 1.2, true);
    this.feeding.push({ t: 2.5, item: c.sp.produce, name: c.sp.name });
    g.audio.tone(700, 0.2, 'sine', 0.08, 1.4);
  }

  // ---------------- scanning ----------------
  _scan() {
    const g = this.game;
    if (this.scanCd > 0) { g.hud.notify(`Scanner recharging (${Math.ceil(this.scanCd)}s)`); return; }
    this.scanCd = 6;
    const p = g.player.pos;
    const radius = 60 * g.player.upgrades.scanner;
    this.pulse.fire(p.clone().add(new THREE.Vector3(0, 1, 0)), radius, 0x66ffff);
    g.audio.scan();
    this.markers = this.markers.filter((m) => !m.scan);
    const found = this.world.scanBlocks(p.x, p.y, p.z, Math.min(radius, 70), RESOURCE_BLOCKS, 400);
    const byType = new Map();
    for (const f of found) {
      const arr = byType.get(f.id) || [];
      if (arr.length < 3 && !arr.some((o) => Math.abs(o.x - f.x) + Math.abs(o.z - f.z) < 6)) { arr.push(f); byType.set(f.id, arr); }
    }
    let count = 0;
    for (const [id, arr] of byType) for (const f of arr) {
      const [icon, color] = RESOURCE_ICON[id];
      this._addMarker(new THREE.Vector3(f.x + 0.5, f.y + 1, f.z + 0.5), icon, '', color, 30, null, true);
      count++;
    }
    const structs = this._listStructures(p.x, p.z, radius * 4).slice(0, 5);
    for (const s of structs) {
      const known = g.state.discoveries.structures[this._structKey(s)];
      this._addMarker(new THREE.Vector3(s.cx, s.y + 3, s.cz), STRUCTURE_INFO[s.type].icon, known ? s.name : '?', s.liminal ? '#ffb6ec' : '#ffd35a', 90, 'struct:' + this._structKey(s), true);
    }
    g.hud.notify(`Scanner: ${count} resources, ${structs.length} signals`);
  }

  _visorScan(dt, target, lmb) {
    const g = this.game, hud = g.hud, d = g.state.discoveries;
    let info = null, key = null, onDone = null;
    if (target && target.kind === 'creature') {
      const sp = target.c.sp;
      const known = !!d.creatures[sp.id];
      key = 'c:' + sp.id;
      info = known ? { title: g.nameOf(sp), latin: sp.latin, rows: [['Temperament', sp.temper], ['Diet', sp.diet], ['Height', (sp.size * 1.3).toFixed(1) + 'm'], ['Rarity', sp.rarity], ['Notes', sp.note]] }
        : { title: 'Unknown Fauna', rows: [['Status', 'Hold LMB to analyse'], ['Distance', Math.round(target.dist) + 'u']] };
      if (!known) onDone = () => {
        d.creatures[sp.id] = { name: sp.name, planet: this.planet.name };
        g.missions.event('scan', { planet: this.planet.id });
        const units = sp.rarity === 'Rare' ? 5000 : sp.rarity === 'Uncommon' ? 2500 : 1200;
        g.inventory.add('units', units); g.inventory.add('nanites', 8);
        g.hud.toast('Fauna Discovered', `${sp.name} · +${units} units · +8 nanites`);
        g.audio.discover();
      };
    } else if (target && target.kind === 'block') {
      const id = target.hit.id;
      const def = BLOCKS[id];
      const isFlora = IS_CROSS[id] || [B.LEAVES, B.LOG, B.CACTUS, B.MUSHROOM_CAP, B.MUSHROOM_STEM, B.CORAL].includes(id);
      if (isFlora && IS_CROSS[id]) {
        const fk = `${this.planet.id}:${id}`;
        const name = floraName(hash32(this.planet.seed, id));
        const known = !!d.flora[fk];
        key = 'f:' + fk;
        const res = def.drops.map(([it]) => (it === '@special' ? ITEMS[this.P.special].name : ITEMS[it]?.name)).filter(Boolean).join(', ');
        info = known ? { title: name, latin: def.name, rows: [['Resources', res], ['Age', `${(hash32(target.hit.x, target.hit.z) % 900) + 12} cycles`], ['Roots', ['Shallow', 'Deep', 'Dreaming'][id % 3]]] }
          : { title: 'Unknown Flora', rows: [['Status', 'Hold LMB to analyse']] };
        if (!known) onDone = () => {
          d.flora[fk] = { name, planet: this.planet.name };
          g.missions.event('scan', { planet: this.planet.id });
          g.inventory.add('units', 600);
          g.hud.toast('Flora Discovered', `${name} · +600 units`);
          g.audio.discover();
        };
      } else {
        const res = def.drops.map(([it]) => (it === '@special' ? ITEMS[this.P.special].name : ITEMS[it]?.name)).filter(Boolean).join(', ');
        info = { title: def.name, rows: [['Yields', res || '—'], ['Hardness', def.unbreakable ? '∞' : def.hardness.toFixed(1)], ['Distance', Math.round(target.dist) + 'u']] };
      }
    } else if (target && target.kind === 'drone') {
      info = { title: 'Sentinel Drone', rows: [['Integrity', Math.round(target.d.health) + '%'], ['Status', this.sentinels.wanted ? 'HOSTILE' : 'Patrolling']] };
    }
    hud.showScan(info);
    if (onDone && lmb) {
      if (this.scanKey !== key) { this.scanKey = key; this.scanProgress = 0; }
      this.scanProgress += dt / 1.3;
      hud.setProgress(this.scanProgress);
      if (Math.random() < 0.2) g.audio.tone(800 + this.scanProgress * 800, 0.05, 'sine', 0.03);
      if (this.scanProgress >= 1) { onDone(); this.scanProgress = 0; this.scanKey = null; }
    } else {
      this.scanProgress = Math.max(0, this.scanProgress - dt);
      hud.setProgress(null);
    }
  }

  _quickRecharge() {
    const g = this.game, st = g.player.stats;
    let did = false;
    if (st.life < 85) did = g.rechargeStat('life', g.inventory.count('oxygen') ? 'oxygen' : 'life_support_gel') || did;
    if (st.hazard < 85) {
      const it = g.inventory.count('sodium') ? 'sodium' : g.inventory.count('sodium_nitrate') ? 'sodium_nitrate' : 'ion_battery';
      did = g.rechargeStat('hazard', it) || did;
    }
    if (st.shield < 60 && g.inventory.count('carbon') > 5) did = g.rechargeStat('shield', 'carbon') || did;
    if (!did) g.hud.notify('Nothing to recharge (or missing Oxygen / Sodium)');
  }

  // ---------------- structures ----------------
  _structKey(s) { return `${this.planet.id}:${s.x},${s.z}`; }

  _listStructures(x, z, radius) {
    const out = [];
    const rx0 = Math.floor((x - radius) / REGION), rx1 = Math.floor((x + radius) / REGION);
    const rz0 = Math.floor((z - radius) / REGION), rz1 = Math.floor((z + radius) / REGION);
    for (let rx = rx0; rx <= rx1; rx++) for (let rz = rz0; rz <= rz1; rz++) {
      const k = rx + ',' + rz;
      let s = this.structCache.get(k);
      if (s === undefined) {
        s = planStructure(this.planet.seed >>> 0, this.P, this.world.terrain, rx, rz);
        this.structCache.set(k, s);
      }
      if (!s) continue;
      const cx = s.x + s.w / 2, cz = s.z + s.d / 2;
      const dist = Math.hypot(cx - x, cz - z);
      if (dist <= radius) out.push({ ...s, cx, cz, dist, liminal: STRUCTURE_INFO[s.type].liminal });
    }
    out.sort((a, b) => a.dist - b.dist);
    return out;
  }

  _structures(dt) {
    const g = this.game;
    this.structTimer -= dt;
    if (this.structTimer > 0) return;
    this.structTimer = 0.8;
    const p = g.inShip ? g.ship.pos : g.player.pos;
    this.nearStructures = this._listStructures(p.x, p.z, 90);
    let hum = false;
    for (const s of this.nearStructures) {
      const inside = Math.abs(p.x - s.cx) < s.w / 2 + 4 && Math.abs(p.z - s.cz) < s.d / 2 + 4;
      if (s.liminal && s.dist < 30) hum = true;
      if (inside && !g.inShip) {
        const k = this._structKey(s);
        if (!g.state.discoveries.structures[k]) {
          g.state.discoveries.structures[k] = { name: s.name, planet: this.planet.name };
          const flavour = {
            poolrooms: 'The water is perfectly still. The tiles go on forever.',
            backrooms: 'The carpet is damp. The lights hum at 60 hertz.',
            hallway: 'Every door leads back to this hallway.',
            arches: 'Arches that frame nothing, and everything.',
            stairs: 'It leads up. That is all it does.',
            watcher: 'It has been watching the horizon for a very long time.',
            plastic_city: 'Everything is smooth, bright and hollow. Nobody has ever lived here.',
            warehouse: 'Rows of shelves vanish into fluorescent haze. Something was stored here once.',
            monolith: 'An ancient stone, humming with memory.',
            outpost: 'Someone left in a hurry. The terminal is still on.',
            pod: 'A drop pod. Something useful inside.',
            sentinel: 'The Sentinels guard this place. Mining it will anger them.',
          }[s.type];
          g.inventory.add('units', 800);
          if (s.liminal) { g.inventory.add('chroma_shard', 2); g.hud.notify(null, 'chroma_shard', 2); }
          g.hud.toast(s.name, flavour);
          g.audio.discover();
          this.markers = this.markers.filter((m) => m.id !== 'struct:' + k);
        }
      }
    }
    const zone = this._zoneCheck(p);
    if (zone === 'poolscape' || zone === 'backrooms' || zone === 'plasticity') hum = true;
    g.audio.setLoop('hum', hum && !g.inShip);
  }

  // Which liminal zone the player stands in; announces each zone as it is entered.
  _zoneCheck(p) {
    const g = this.game;
    if (this.interior) return null;
    let zone = null;
    if (this.P.underlayer && p.y > 6 && p.y < 16 && (this.encK || 0) > 0.5) zone = 'backrooms';
    else {
      const zi = this.world.terrain.zoneAt(p.x, p.z);
      if (zi.type !== 'natural' && zi.blend > 0.6) zone = zi.type;
    }
    if (zone === this.zoneCur) return zone;
    this.zoneCur = zone;
    const mood = { naraka: 'naraka', tilevoid: 'void', library: 'library' }[zone];
    g.audio.setMood(mood || this.P.biome, this.P.seed);
    if (zone && this.planet) g.missions.event('zone', { zone, planet: this.planet.id });
    if (!zone || g.inShip) return zone;
    const info = ZONE_INFO[zone];
    const d = g.state.discoveries;
    d.zones = d.zones || {};
    const k = `${this.planet.id}:${zone}`;
    if (!d.zones[k]) {
      d.zones[k] = { name: info.name, planet: this.planet.name };
      g.inventory.add('units', 500);
      g.inventory.add('chroma_shard', 1);
      g.hud.notify(null, 'chroma_shard', 1);
      g.hud.toast(info.name, info.text, '#f3c6ff');
      g.audio.zoneEnter(true);
    } else {
      g.hud.toast(info.name, null, '#d9c9ef');
      g.audio.zoneEnter(false);
    }
    return zone;
  }

  _whispers(dt) {
    const dreamy = this.P.biome === 'liminal' || this.P.biome === 'exotic' || !!this.zoneCur;
    if (!dreamy || this.interior) return;
    // distant, unexplained sounds
    this.eerieTimer = (this.eerieTimer ?? 25) - dt;
    if (this.eerieTimer <= 0 && !this.game.inShip) {
      this.eerieTimer = 28 + Math.random() * 50;
      const z = this.zoneCur;
      const kinds = z === 'backrooms' || z === 'plasticity' ? ['door', 'steps', 'hum', 'thud'] : z === 'library' ? ['steps', 'door', 'chime'] : ['thud', 'chime', 'door', 'steps'];
      this.game.audio.distant(kinds[Math.floor(Math.random() * kinds.length)]);
    }
    if (this.P.biome !== 'liminal' && this.P.biome !== 'exotic') return;
    this.whisperTimer -= dt;
    if (this.whisperTimer <= 0) {
      this.whisperTimer = 60 + Math.random() * 90;
      this.game.hud.setCenter(DREAM_WHISPERS[Math.floor(Math.random() * DREAM_WHISPERS.length)], '#ffd6f4');
      this.centerT = 5;
    }
  }

  // Now and then, on dream worlds, a door is standing behind you that was not there before.
  _doorsBehind(dt) {
    const g = this.game, P = this.P;
    const dreamy = P.biome === 'liminal' || P.biome === 'exotic' || !!this.zoneCur;
    if (!dreamy || this.interior || g.inShip || this.teleport) return;
    this.doorT = (this.doorT ?? 150 + Math.random() * 120) - dt;
    if (this.doorT > 0) return;
    this.doorT = 60;
    const W = this.world, pl = g.player.pos;
    const dir = g.camera.getWorldDirection(_v);
    const behind = Math.atan2(dir.x, dir.z) + Math.PI;
    const free = (id) => IS_AIRLIKE[id] || IS_CROSS[id];
    for (let t = 0; t < 10; t++) {
      const a = behind + (Math.random() - 0.5) * 1.4, r = 9 + Math.random() * 5;
      const x = Math.floor(pl.x + Math.sin(a) * r), z = Math.floor(pl.z + Math.cos(a) * r);
      const y = W.groundBelow(x + 0.5, pl.y + 4, z + 0.5) + 1;
      if (Math.abs(y - pl.y) > 2.5) continue;
      let ok = true;
      for (let dx = -1; dx <= 1 && ok; dx++) {
        if (!IS_SOLID[W.getBlock(x + dx, y - 1, z)] || IS_LIQUID[W.getBlock(x + dx, y - 1, z)]) ok = false;
        for (let dy = 0; dy < 3 && ok; dy++) if (!free(W.getBlock(x + dx, y + dy, z))) ok = false;
      }
      if (!ok) continue;
      for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy < 3; dy++) {
        W.setBlock(x + dx, y + dy, z, dx === 0 && dy < 2 ? B.DREAM_DOOR : B.DREAM_TILE);
      }
      g.audio.distant('door');
      this.doorT = 200 + Math.random() * 220;
      return;
    }
  }

  _addMarker(pos, icon, label, color, ttl, id, scan = false) {
    if (id) this.markers = this.markers.filter((m) => m.id !== id);
    this.markers.push({ pos, icon, label, color, t: ttl, id, scan });
  }

  // ---------------- survival ----------------
  _survival(dt) {
    const g = this.game, pl = g.player, st = pl.stats, P = this.P;
    this.lastDamage += dt;
    const inShip = g.inShip;
    let sheltered = inShip;
    if (!inShip) {
      const sh = this.world.skyHeightAt(pl.pos.x, pl.pos.z);
      sheltered = sh > pl.pos.y + 1.7;
    }
    if (this.pocket === 'station') {
      st.hazard = Math.min(100, st.hazard + dt * 20);
      st.life = Math.min(100, st.life + dt * 10);
      st.shield = Math.min(100, st.shield + dt * 10);
      g.post.uniforms.uHazard.value = 0;
      if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) g.hud.setCenter(''); }
      return;
    }
    const lvl = P.hazard.level;
    const storm = this.stormK || 0;
    if (lvl > 0 && (!sheltered || this.pocket === 'derelict') && !inShip) {
      const rate = [0, 100 / 240, 100 / 150, 100 / 90][lvl] * (1 + storm * 2) / pl.upgrades.hazard * g.buffs.mul('hazard');
      st.hazard = Math.max(0, st.hazard - rate * dt);
    } else st.hazard = Math.min(100, st.hazard + dt * (inShip ? 15 : 6));
    if (!inShip) {
      const lrate = 100 / 420 * (P.hazard.type === 'vacuum' ? 1.5 : 1) * (pl.jetting ? 1.4 : 1) / pl.upgrades.life * g.buffs.mul('life');
      st.life = Math.max(0, st.life - lrate * dt);
    } else st.life = Math.min(100, st.life + dt * 4);
    let hurting = false;
    if (st.hazard <= 0 && lvl > 0 && !sheltered) { pl.damage(4 * dt); hurting = true; }
    if (st.life <= 0) { pl.damage(3 * dt); hurting = true; }
    if (!inShip && pl.inWater) {
      const hz = BLOCKS[pl.inLiquidId].hazard;
      if (hz) { pl.damage(hz * dt); hurting = true; this.lastDamage = 0; g.post.uniforms.uDamage.value = Math.max(g.post.uniforms.uDamage.value, 0.5); }
    }
    if (hurting) { this.lastDamage = Math.min(this.lastDamage, 0); g.post.uniforms.uDamage.value = Math.max(g.post.uniforms.uDamage.value, 0.25); }
    if (st.health <= 0) { this._die(); return; }
    if (this.lastDamage > 5) st.shield = Math.min(100, st.shield + dt * 12);
    if (this.lastDamage > 9 && st.hazard > 0 && st.life > 0) st.health = Math.min(100, st.health + dt * 1.5);
    // warnings
    this.warnTimer -= dt;
    let warn = null;
    if (!inShip && lvl > 0 && st.hazard < 25) warn = st.hazard <= 0 ? 'HAZARD PROTECTION FAILED' : 'Hazard protection low - [R] recharge with Sodium';
    else if (!inShip && st.life < 20) warn = st.life <= 0 ? 'LIFE SUPPORT FAILED' : 'Life support low - [R] recharge with Oxygen';
    if (warn) {
      g.hud.setCenter(warn, '#ffd35a'); this.centerT = 0.5;
      if (this.warnTimer <= 0) { this.warnTimer = 6; g.audio.warning(); }
    }
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) g.hud.setCenter(''); }
    const hc = HAZARD_COLORS[P.hazard.type] || HAZARD_COLORS.none;
    g.post.uniforms.uHazardColor.value.setRGB(hc[0], hc[1], hc[2]);
    g.post.uniforms.uHazard.value = !inShip && lvl > 0 && st.hazard < 35 ? (1 - st.hazard / 35) : 0;
    if (st.health <= 0) this._die();
  }

  _die() {
    const g = this.game;
    g.player.stats.health = 0;
    g.input.unlock();
    g.audio.stopAllLoops();
    this.beam.hide();
    const why = this.lastDamage < 2 ? this.lastHurtBy : null;
    if (this.riding.active) this.riding.dismount();
    if (this.rover.driving) this.rover.exit();
    this.horror.clear();
    this.horror.setPlanet(this.planet);
    g.menus.showDeath(() => {
      const p = g.player;
      Object.assign(p.stats, { health: 100, shield: 60, hazard: 100, life: 100, jet: 100 });
      this.sentinels.wanted = 0;
      this.sentinels.clear();
      if (g.ship.state === 'landed') {
        this._exitShip();
      } else {
        const s = this._settle(Math.floor(p.pos.x), Math.floor(p.pos.z));
        p.pos.set(s.x + 0.5, s.y, s.z + 0.5);
      }
      const lost = Math.floor(g.inventory.units * 0.1);
      g.inventory.remove('units', lost);
      g.hud.notify(`Lost ${lost} units in the dream`);
      g.resume();
    }, why);
  }

  // ---------------- HUD ----------------
  _updateHUD(dt) {
    const g = this.game, hud = g.hud, P = this.P, ship = g.ship;
    hud.updateStats(g.player.stats, P.hazard.type, !g.inShip);
    const hours = Math.floor(this.dayT * 24), mins = Math.floor((this.dayT * 24 - hours) * 60);
    const conds = [`${P.temperature}°C`];
    if (P.hazard.level > 0) conds.push(`${['', 'Mild', 'Severe', 'Extreme'][P.hazard.level]} ${P.hazard.type}`);
    if (this.storm.on) conds.push('⚡ Storm');
    conds.push(`Sentinels: ${['None', 'Low', 'Standard', 'Aggressive'][P.sentinels]}`);
    conds.push(`${this.daylight > 0.5 ? '☀' : '☾'} ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`);
    if (this.pocket === 'void') hud.setLocation('null', '', []);
    else if (this.pocket === 'derelict') hud.setLocation(this.planet.name, `Derelict freighter · ${g.system.name}`, ['No atmosphere', 'Life signs: none', 'Power: failing']);
    else if (this.interior) hud.setLocation(this.planet.name, `${g.system.name} system · Docked`, ['Pressurised', 'Sentinels: None', 'Trade · Tech · Services']);
    else hud.setLocation(g.nameOf(this.planet), `${P.adjective} ${this.planet.biomeLabel} · ${g.system.name}`, conds);
    // markers
    for (const m of this.markers) m.t -= dt;
    this.markers = this.markers.filter((m) => m.t > 0);
    const cam = g.camera;
    const list = [];
    const compass = [];
    const cp = cam.position;
    const addM = (pos, icon, label, color) => {
      const dist = Math.hypot(pos.x - cp.x, pos.y - cp.y, pos.z - cp.z);
      list.push({ pos, icon, label, color, dist });
      compass.push({ bearing: (Math.atan2(pos.x - cp.x, -(pos.z - cp.z)) * 180 / Math.PI + 360) % 360, icon, color });
    };
    if (!g.inShip) addM(ship.pos.clone().add(new THREE.Vector3(0, 3, 0)), '▲', 'Starship', '#ff9f5a');
    if (this.rover.present && !this.rover.driving) addM(this.rover.pos.clone().add(new THREE.Vector3(0, 3, 0)), '◆', 'Roamer', '#ffc46b');
    if (g.net.active) {
      for (const m of g.net.markers || []) addM(m.pos, '●', m.name, m.color);
      for (const q of g.net.pings) addM(new THREE.Vector3(q.x, q.y, q.z), '◎', q.name, q.color);
    }
    if (this.planet && !this.interior) for (const b of g.bases.list) if (b.planet === this.planet.id) addM(new THREE.Vector3(b.x + 0.5, b.y + 3, b.z + 0.5), '⌂', b.name, '#8fe6ff');
    else if (ship.state === 'flying' && this.landSite) addM(new THREE.Vector3(this.landSite.x, this.landSite.y + 1.5, this.landSite.z), '▼', 'Landing zone', '#9fffd0');
    for (const m of this.markers) addM(m.pos, m.icon, m.label, m.color);
    const em = this.encounters.marker();
    if (em) addM(em.pos, em.icon, em.label, em.color);
    for (const c of this.creatures.list) if (c.companion) addM(c.pos.clone().add(new THREE.Vector3(0, c.sp.size * 1.6 + 0.6, 0)), '♥', '', '#ff9bd6');
    hud.updateMarkers(cam, list, g.width, g.height);
    const f = cam.getWorldDirection(_v);
    const heading = (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360;
    hud.updateCompass(heading, compass);
    this.moves.drawHud(this.grenades);
    if (this.dmg) this.dmg.update(dt, cam, g.width, g.height);
    // tool & hotbar
    if (!g.inShip) {
      const hints = [
        this.overheated ? 'Overheated - cooling' : 'LMB mine · RMB grapple',
        'LMB collect block · RMB place · 1-9 / wheel select',
        'LMB fire bolts · RMB plasma grenade',
        { idle: 'LMB cast into water, magma or acid · RMB grapple', cast: 'Casting…', wait: 'Wait for a bite · LMB reel in', bite: 'NOW - LMB to hook it!', reel: 'Hold LMB to reel · ease off when it pulls', retract: '' }[this.fishing.state],
      ];
      if (this.rover.driving) hud.setTool('Roamer', ['Roamer'], `${Math.round(Math.abs(this.rover.speed) * 3.6)} km/h · LMB cannon · Space hop · L lights · E exit`);
      else hud.setTool(this.visor ? 'Analysis Visor' : TOOL_MODES[this.toolMode], this.visor ? ['Analysis Visor'] : TOOL_MODES.slice(0, g.upgradeCount('dream_line') ? 4 : 3), this.visor ? 'Hold LMB on fauna & flora to discover · V to close' : hints[this.toolMode]);
      hud.toolEl.style.display = '';
    } else hud.toolEl.style.display = 'none';
    hud.updateHotbar(g.inventory, g.selectedHot || 0, !g.inShip, this.toolMode === 1 && !this.visor);
    hud.showShip(g.inShip);
    if (g.inShip) {
      hud.updateShip(ship, ship.pos.y - this.world.groundAt(ship.pos.x, ship.pos.z), false);
      hud.setCrosshair('dot');
      if (ship.state === 'landed') hud.setPrompt(this.interior ? (this.pocket === 'derelict' ? '<span class="key">SPACE</span>Undock  <span class="key">E</span>Exit ship' : '<span class="key">SPACE</span>Launch  <span class="key">E</span>Exit ship') : '<span class="key">SPACE</span>Take off  <span class="key">E</span>Exit ship');
      else if (ship.state === 'flying') {
        const alt = ship.pos.y - this.world.groundAt(ship.pos.x, ship.pos.z);
        hud.setPrompt(alt < LAND_ALT ? (this.landSite ? '<span class="key">E</span>Land' : 'No landing zone - look for open ground') : null);
      } else hud.setPrompt(null);
      hud.setHelp('W/S throttle · A/D roll · Shift boost · LMB fire\nClimb above 300u to leave the atmosphere');
      hud.setProgress(null);
      hud.showScan(null);
    } else {
      hud.setHelp('Q tool · F scan · V visor · T lamp\nX dash · C slide/pound · H eat · R recharge\nTab inventory · M map · Esc menu');
    }
  }
}
