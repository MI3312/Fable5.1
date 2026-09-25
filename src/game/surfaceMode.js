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
import { ZONE_INFO } from '../world/zones.js';
import { Sky, Clouds, Weather } from '../surface/sky.js';
import { Debris, Beam, ScanPulse, Bolts, makeSelectionBox } from '../surface/effects.js';
import { CreatureManager } from '../entities/creatures.js';
import { SentinelManager } from '../entities/sentinels.js';
import { buildMultitool, buildTraveller } from '../entities/shipModel.js';
import { STATION_FLOOR, STATION_PAD, STATION_TERMINALS, STATION_NPCS } from '../world/station.js';
import { STATION_CHATTER } from '../data/lore.js';
import { Universe } from '../universe/universe.js';
import { ITEMS } from '../data/items.js';
import { MONOLITH, TERMINAL, DREAM_WHISPERS } from '../data/lore.js';
import { SURFACE_ENTRY_ALT } from '../config.js';

const TOOL_MODES = ['Mining Beam', 'Builder', 'Boltcaster'];
const TOOL_COLORS = [0x6ff3ff, 0xffa6ec, 0xffa45a];
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
};

const ENC_OFFS = [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [7, 7], [-7, -7], [7, -7], [-7, 7]];
const _v = new THREE.Vector3();
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
    this.active = true;
    this.loading = true;
    this.loadTime = 0;
    this.leaving = false;
    this.structCache.clear();
    this.markers = [];
    this.world.setPlanet(this.P, g.state.edits[planet.id]);
    this.setRenderDistance(g.settings.renderDist);
    this.creatures.setPlanet(planet);
    this.sentinels.setPlanet(this.P.sentinels);
    this.weather.setType(this.P.weather);
    this.clouds.uniforms.uCloudCol.value.setRGB(...this.P.sky.cloud);
    this.clouds.uniforms.uCover.value = this.P.sky.cloudCover;
    this.clouds.mesh.visible = this.P.sky.cloudCover > 0.01;
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
    g.ship.camInit = false;

    const st = g.state;
    this.dayT = st.dayTime[planet.id] ?? 0.32;
    this.spawnMode = opts.spawn;
    const player = g.player;
    this._clearNPCs();
    if (this.interior) {
      STATION_NPCS.forEach((n, i) => {
        const m = buildTraveller(hash32(planet.seed, i));
        m.position.set(n.x + 0.5, STATION_FLOOR, n.z + 0.5);
        m.rotation.y = n.face;
        m.userData.face = n.face;
        m.userData.line = STATION_CHATTER[(i + (planet.seed % 5)) % STATION_CHATTER.length];
        this.scene.add(m);
        this.npcs.push(m);
      });
    }
    if (opts.spawn === 'dock') {
      this.target = { x: STATION_PAD.x, z: STATION_PAD.z };
      g.inShip = true;
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
    if (mode === 'dock') {
      ship.pos.set(STATION_PAD.x + 0.5, STATION_FLOOR + 1.7, STATION_PAD.z + 0.5);
      ship.setLevel(0);
      ship.state = 'landed';
      ship.speed = 0;
      g.inShip = true;
      player.pos.copy(ship.pos);
    } else if (mode === 'crash') {
      const s = this._settle(this.target.x, this.target.z);
      player.pos.set(s.x + 0.5, s.y, s.z + 0.5);
      player.yaw = Math.PI * 0.25;
      this._placeShipNear(player.pos, 7);
      ship.state = 'landed';
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
      // atmospheric entry: ship arrives high above the surface
      ship.pos.set(this.target.x, SURFACE_ENTRY_ALT, this.target.z);
      const yaw = Math.random() * Math.PI * 2;
      ship.quat.setFromEuler(new THREE.Euler(-0.28, yaw, 0, 'YXZ'));
      ship.state = 'flying';
      ship.speed = 60; ship.targetSpeed = 40;
      g.inShip = true;
      player.pos.copy(ship.pos);
    }
    ship.syncModel();
    ship.camInit = false;
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

  leave() {
    if (!this.active) return;
    this.active = false;
    this._clearNPCs();
    this.world.clear();
    this.creatures.clear();
    this.sentinels.clear();
    this.bolts.clear();
    this.debris.clear();
    this.beam.hide();
    this.game.audio.stopAllLoops();
    this.game.post.uniforms.uUnderwater.value = 0;
    this.game.post.uniforms.uHazard.value = 0;
    this.game.post.uniforms.uVisor.value = 0;
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
    const p = this.game.player, s = this.game.ship;
    st.mode = this.interior ? 'station' : 'surface';
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

  _applySky(dt) {
    const P = this.P;
    const u = voxelUniforms;
    const rate = 1 / (P.biome === 'liminal' ? 2400 : 1200);
    this.dayT = (this.dayT + dt * rate) % 1;
    const a = (this.dayT - 0.25) * Math.PI * 2;
    const sunDir = _v.set(Math.cos(a), Math.sin(a), 0.35).normalize();
    u.uSunDir.value.copy(sunDir);
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
    const far = this.fogFar || 110;
    u.uFogFar.value = far;
    u.uFogNear.value = far * 0.6;
    const FG = P.fog;
    const fogK = (1 + storm * 1.6) * (this.game.inShip && this.game.ship.state === 'flying' ? 0.6 : 1);
    u.uFogDensity.value = FG.density * fogK;
    u.uMistDensity.value = FG.mistDensity * (1 + storm);
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
    this.sky.uniforms.uSkyFog.value = FG.skyFog * (1 - (P.sky.stars >= 1 ? 1 : 0)) + storm * 0.3;
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
      u.uSunDir.value.copy(this.starDir);
      this.sunLight.position.copy(this.starDir).multiplyScalar(100);
      this.sunLight.intensity = 0.9 * Math.PI;
      this.hemi.intensity = 0.9 * Math.PI;
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
    this.sky.uniforms.uStorm.value = storm;
  }

  _updateWeather(dt) {
    const P = this.P;
    const s = this.storm;
    if (P.stormChance <= 0 || P.weather === 'none') { this.stormK = 0; this.weather.update(dt, this.game.camera, 0, this.game.time); return; }
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
    const base = ['snow', 'dream', 'sparkle', 'dust', 'ash'].includes(P.weather) ? 0.25 : 0.0;
    const underCover = this.game.inShip ? 0.6 : 1;
    this.weather.update(dt, this.game.camera, (base + this.stormK * 0.75) * underCover, this.game.time);
    this.game.audio.setLoop('wind', this.stormK > 0.05, this.stormK);
  }

  // ---------------- main update ----------------
  update(dt, paused) {
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
    const ctl = input.locked;
    // ------- ship or foot -------
    let focus;
    if (g.inShip) {
      this._updateShip(dt, ctl);
      focus = ship.pos;
      player.pos.copy(ship.pos);
    } else if (this.teleport) {
      focus = player.pos;
      this.teleport.t += dt;
      if (this.world.loadedAround(player.pos.x, player.pos.z, 1) >= 1 || this.teleport.t > 15) this._finishTeleport();
    } else {
      const grav = this.P.gravity;
      const ev = player.update(dt, input, this.world, grav, ctl);
      this._footEvents(ev);
      focus = player.pos;
      this._updateTool(dt, ctl);
      if (player.pos.y < -20) { player.pos.y = this.world.groundAt(player.pos.x, player.pos.z) + 2; player.vel.set(0, 0, 0); }
    }
    this.world.update(focus.x, focus.z, 5);
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
      camPos: g.camera.position, camDir: g.camera.getWorldDirection(new THREE.Vector3()), night: this.daylight < 0.3,
      onAttack: (dmg, c) => { this._hurtPlayer(dmg); g.hud.notify(`${c.sp.name} attacks!`); },
      onCreep: () => { g.audio.tone(90, 0.6, 'sawtooth', 0.05, 0.7); g.audio.noiseHit(0.3, 300, 0.08, 'lowpass'); },
    });
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
    this._updateHUD(dt);
  }

  _updatePointLights(dt) {
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
    const u = voxelUniforms;
    const T = this.P.tints;
    for (let i = 0; i < u.uPL.value.length; i++) {
      const c = cand[i];
      if (!c) { u.uPL.value[i].set(0, -9999, 0); u.uPLCol.value[i].setRGB(0, 0, 0); continue; }
      u.uPL.value[i].set(c[1], c[2], c[3]);
      const col = POINT_LIGHT_COLORS[c[4]] || [0.6, 0.6, 0.6];
      if (c[4] === B.CRYSTAL) u.uPLCol.value[i].setRGB(T[30] * 0.7, T[31] * 0.7, T[32] * 0.7);
      else u.uPLCol.value[i].setRGB(col[0], col[1], col[2]);
    }
    u.uPLStrength.value = this.interior ? 0.5 : lerp(1.0, 0.3, this.daylight ?? 1);
  }

  _footEvents(ev) {
    const g = this.game;
    if (ev.footstep) {
      const below = this.world.getBlock(g.player.pos.x, g.player.pos.y - 0.5, g.player.pos.z);
      g.audio.footstep([B.POOL_TILE, B.METAL_PLATE, B.MARBLE, B.CHECKER, B.STONE, B.DREAM_TILE, B.METAL_PANEL].includes(below) ? 'hard' : 'soft');
    }
    if (ev.landed) {
      g.audio.land();
      if (ev.landed > 20) this._hurtPlayer((ev.landed - 20) * 2.5);
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
      g.ship.updateCamera(g.camera, dt || 0.016, { groundAt: (x, z) => this.world.groundAt(x, z) });
      this.tool.visible = false;
    } else {
      g.player.applyCamera(g.camera);
      this.tool.visible = !this.visor;
    }
    g.camera.updateMatrixWorld();
    const lf = this.interior ? 1 : 0.3 + 0.7 * (this.daylight ?? 1);
    this.viewScene.children[1].intensity = 0.6 * Math.PI * lf;
    this.viewLight.intensity = 0.9 * Math.PI * lf;
    this.sky.update(g.camera);
    this.clouds.update(g.camera);
    voxelUniforms.uTime.value = g.time;
    voxelUniforms.uTorch.value.copy(g.camera.position);
    const ambientDark = 1 - this.daylight;
    voxelUniforms.uTorchOn.value += (((this.torch && !g.inShip) ? 1 : 0) - voxelUniforms.uTorchOn.value) * Math.min(1, (dt || 0) * 8);
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
    void ambientDark;
  }

  // ---------------- ship on the surface ----------------
  _updateShip(dt, ctl) {
    const g = this.game, ship = g.ship, input = g.input;
    const W = this.world;
    const groundAt = (x, z) => W.groundAt(x, z);
    if (ship.state === 'landed' && this.interior) {
      if (input.hit('Space') || (input.hit('KeyW') && ctl)) { if (!this.leaving) { this.leaving = true; g.launchFromStation(); } }
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
      if (input.hit('KeyE')) {
        if (alt < 55) {
          const f = ship.forward(_v2).setY(0).normalize();
          const lx = ship.pos.x + f.x * 8, lz = ship.pos.z + f.z * 8;
          const gy = this._shipGround(lx, lz, ship.yaw());
          const top = W.getBlock(lx, W.groundAt(lx, lz), lz);
          const err = ship.beginLanding(gy, IS_LIQUID[top] === 1);
          if (err) g.hud.notify(err);
        } else g.hud.notify('Too high to land - descend below 55u');
      }
      if (input.mouseDown(0) && ship.fireCooldown <= 0) {
        ship.fireCooldown = 0.12;
        const fwd = ship.forward(new THREE.Vector3());
        const right = ship.right(new THREE.Vector3());
        for (const s of [-1, 1]) {
          const from = ship.pos.clone().addScaledVector(right, s * 3).addScaledVector(fwd, 2);
          this.bolts.fire(from, fwd, 260 + ship.speed, 'ship', 30, 0x9ff6ff, 1.2, 1.6);
        }
        g.audio.shipShoot();
      }
    }
    const events = ship.update(dt, input, { mode: 'surface', groundAt, ctl });
    for (const e of events) {
      if (e === 'exitAtmosphere' && !this.leaving) { this.leaving = true; g.leavePlanet(); }
      if (e === 'landed') { g.audio.land(); g.hud.notify('Landed. [E] to exit'); }
      if (e === 'tookoff') g.hud.notify('Airborne - climb to leave the atmosphere');
    }
    g.audio.setLoop('engine', ship.state !== 'landed', ship.speed / 120);
    g.audio.setLoop('laser', false);
    g.audio.setLoop('jetpack', false);
    ship.updateFlames(g.time);
    this.beam.hide();
    this.selection.visible = false;
  }

  _boardShip() {
    const g = this.game;
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
    const gy = this.world.groundAt(x, z);
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
    if (input.hit('KeyQ')) { this.toolMode = (this.toolMode + 1) % 3; g.audio.ui(); this.mine.key = null; }
    for (let i = 0; i < 9; i++) {
      if (input.hit('Digit' + (i + 1))) { g.selectedHot = i; this.toolMode = 1; }
    }
    const wheel = input.consumeWheel();
    if (wheel && this.toolMode === 1) g.selectedHot = ((g.selectedHot || 0) + wheel + 9) % 9;
    if (input.hit('KeyV')) { this.visor = !this.visor; g.audio.tone(this.visor ? 900 : 600, 0.1, 'sine', 0.06); this.scanProgress = 0; }
    if (input.hit('KeyT')) { this.torch = !this.torch; g.audio.ui(); }
    if (input.hit('KeyF')) this._scan();
    if (input.hit('KeyR')) this._quickRecharge();
    g.post.uniforms.uVisor.value += ((this.visor ? 1 : 0) - g.post.uniforms.uVisor.value) * Math.min(1, dt * 8);
    hud.setVisor(this.visor);

    const cam = g.camera;
    const origin = cam.position.clone();
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const mode = this.toolMode;
    const range = this.visor ? 60 : mode === 0 ? 24 : mode === 1 ? 7.5 : 70;
    const hit = this.world.raycast(origin, dir, range);
    const cHit = this.creatures.raycast(origin, dir, range);
    const dHit = this.sentinels.raycast(origin, dir, range);
    let target = null;
    if (hit) target = { kind: 'block', dist: hit.dist, hit };
    if (cHit && (!target || cHit.dist < target.dist)) target = { kind: 'creature', dist: cHit.dist, c: cHit.creature };
    if (dHit && (!target || dHit.dist < target.dist)) target = { kind: 'drone', dist: dHit.dist, d: dHit.drone };
    this.target = target;

    // selection box
    if (hit && !this.visor && (mode !== 2) && (!target || target.kind === 'block')) {
      this.selection.visible = true;
      this.selection.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.selection.material.color.set(TOOL_COLORS[mode]);
    } else this.selection.visible = false;

    // interaction prompt
    this._interaction(target);

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
        this.heat += dt / 7;
        if (this.heat >= 1) { this.overheated = true; g.hud.notify('Mining beam overheated'); g.audio.tone(300, 0.4, 'square', 0.06, 0.5); }
        const end = target ? origin.clone().addScaledVector(dir, target.dist) : origin.clone().addScaledVector(dir, range);
        this.beam.show(muzzle, end, TOOL_COLORS[0], g.time, 0.03);
        if (target && target.kind === 'block') this._mineBlock(target.hit, dt, 'mine');
        else if (target && target.kind === 'creature') this._damageCreature(target.c, 24 * dt);
        else if (target && target.kind === 'drone') this._damageDrone(target.d, 24 * dt);
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
    } else {
      hud.setCrosshair('');
      hud.showScan(null);
      hud.setProgress(null);
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
    t.position.set(0.3 + Math.cos(bob * 0.5) * 0.01, -0.25 + Math.sin(bob) * 0.012 - this.recoil * 0.015, -0.72 + this.recoil * 0.05);
    t.rotation.set(0.03 + this.recoil * 0.2, 0.08, 0);
    t.userData.glowMat.color.set(this.overheated ? 0xff4020 : TOOL_COLORS[mode]);
    if (beamOn) t.position.x += (Math.random() - 0.5) * 0.004;
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
    if (this.interior) { g.hud.setCenter('Station hull is protected', '#9fd8ff'); this.centerT = 1; return; }
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
    if (above > 0 && IS_CROSS[above]) { W.setBlock(x, y + 1, z, B.AIR); this._drops(above, how); }
    this.debris.spawn(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), def.color, 14, 4, 1.1);
    g.audio.breakBlock();
    this._drops(id, how);
    if (how === 'mine') {
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
    if (how === 'build') {
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
    if (this.interior) { g.hud.setCenter('Building is not permitted aboard the station', '#9fd8ff'); this.centerT = 1; return; }
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
      g.audio.place();
      this.debris.spawn(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5), BLOCKS[id].color, 4, 1.5, 0.4);
    }
  }

  _damageCreature(c, dmg) {
    const g = this.game;
    if (this.creatures.damage(c, dmg)) {
      this.debris.spawn(c.pos.clone().add(new THREE.Vector3(0, c.sp.size * 0.6, 0)), c.sp.c1, 24, 5, 1.4);
      const n = 2 + Math.floor(Math.random() * 4);
      g.inventory.add('mordite', n);
      g.hud.notify(null, 'mordite', n);
      g.audio.explosion(0.5);
      if (this.sentinels.raise(1)) { g.hud.toast('Sentinels Alerted', 'Fauna harmed'); g.audio.alert(); }
    }
  }

  _damageDrone(d, dmg) {
    const g = this.game;
    if (this.sentinels.damage(d, dmg)) {
      this.debris.spawn(d.pos, [0.8, 0.8, 0.85], 30, 7, 1.5);
      this.debris.spawn(d.pos, [1, 0.3, 0.2], 12, 5, 1, true);
      g.audio.explosion(1);
      const n = 4 + Math.floor(Math.random() * 6);
      g.inventory.add('pugneum', n);
      g.inventory.add('nanites', 6 + Math.floor(Math.random() * 8));
      g.hud.notify(null, 'pugneum', n);
    }
  }

  _hurtPlayer(dmg) {
    const g = this.game;
    if (g.inShip) { g.ship.shield = Math.max(0, g.ship.shield - dmg * 0.5 / g.ship.upgrades.shield); return; }
    g.player.damage(dmg);
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
    return false;
  }

  // ---------------- interaction ----------------
  _interaction(target) {
    const g = this.game, input = g.input, ship = g.ship, p = g.player, hud = g.hud;
    let prompt = null, action = null;
    const dShip = Math.hypot(ship.pos.x - p.pos.x, ship.pos.z - p.pos.z);
    if (dShip < 6.5 && Math.abs(ship.pos.y - p.pos.y) < 5 && ship.state === 'landed') {
      prompt = '<span class="key">E</span>Board starship';
      action = () => this._boardShip();
    } else if (target && target.dist < 5.5) {
      if (target.kind === 'block') {
        const def = BLOCKS[target.hit.id];
        if (def.interact === 'chest') { prompt = '<span class="key">E</span>Open dream cache'; action = () => this._openChest(target.hit); }
        else if (def.interact === 'monolith') { prompt = '<span class="key">E</span>Touch the monolith'; action = () => this._monolith(target.hit); }
        else if (def.interact === 'terminal') {
          const t = this.interior ? STATION_TERMINALS.find((q) => q.x === target.hit.x && q.z === target.hit.z) : null;
          prompt = `<span class="key">E</span>${t ? t.label : 'Access terminal'}`;
          action = () => this._terminal(target.hit);
        }
        else if (def.interact === 'pod') { prompt = '<span class="key">E</span>Open exosuit pod'; action = () => this._pod(target.hit); }
        else if (def.interact === 'door') { prompt = '<span class="key">E</span>Open the dream door'; action = () => this._dreamDoor(target.hit); }
      } else if (target.kind === 'creature') {
        const c = target.c;
        prompt = `<span class="key">E</span>Feed ${g.state.discoveries.creatures[c.sp.id] ? c.sp.name : 'creature'} (5 Carbon)`;
        action = () => this._feed(c);
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
    for (const [id, n] of this._lootFor(hit.x, hit.y, hit.z)) {
      g.inventory.add(id, n);
      if (id === 'units' || id === 'nanites') g.hud.notify(`+${n} ${id === 'units' ? 'Units' : 'Nanites'}`);
      else g.hud.notify(null, id, n);
    }
    this.world.setBlock(hit.x, hit.y, hit.z, B.CHEST_OPEN);
    this.debris.spawn(new THREE.Vector3(hit.x + 0.5, hit.y + 1, hit.z + 0.5), [1, 0.85, 0.6], 16, 3, 1.2, true);
    g.audio.discover();
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
    if (this.interior) {
      const t = STATION_TERMINALS.find((q) => q.x === hit.x && q.z === hit.z);
      g.input.unlock();
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
    if (this.interior) {
      st.hazard = Math.min(100, st.hazard + dt * 20);
      st.life = Math.min(100, st.life + dt * 10);
      st.shield = Math.min(100, st.shield + dt * 10);
      g.post.uniforms.uHazard.value = 0;
      if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) g.hud.setCenter(''); }
      return;
    }
    const lvl = P.hazard.level;
    const storm = this.stormK || 0;
    if (lvl > 0 && !sheltered) {
      const rate = [0, 100 / 240, 100 / 150, 100 / 90][lvl] * (1 + storm * 2) / pl.upgrades.hazard;
      st.hazard = Math.max(0, st.hazard - rate * dt);
    } else st.hazard = Math.min(100, st.hazard + dt * (inShip ? 15 : 6));
    if (!inShip) {
      const lrate = 100 / 420 * (P.hazard.type === 'vacuum' ? 1.5 : 1) * (pl.jetting ? 1.4 : 1) / pl.upgrades.life;
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
    });
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
    if (this.interior) hud.setLocation(this.planet.name, `${g.system.name} system · Docked`, ['Pressurised', 'Sentinels: None', 'Trade · Tech · Services']);
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
    for (const m of this.markers) addM(m.pos, m.icon, m.label, m.color);
    for (const c of this.creatures.list) if (c.companion) addM(c.pos.clone().add(new THREE.Vector3(0, c.sp.size * 1.6 + 0.6, 0)), '♥', '', '#ff9bd6');
    hud.updateMarkers(cam, list, g.width, g.height);
    const f = cam.getWorldDirection(_v);
    const heading = (Math.atan2(f.x, -f.z) * 180 / Math.PI + 360) % 360;
    hud.updateCompass(heading, compass);
    // tool & hotbar
    if (!g.inShip) {
      const hints = [
        this.overheated ? 'Overheated - cooling' : 'LMB mine · harvest resources',
        'LMB collect block · RMB place · 1-9 / wheel select',
        'LMB fire bolts',
      ];
      hud.setTool(this.visor ? 'Analysis Visor' : TOOL_MODES[this.toolMode], this.visor ? ['Analysis Visor'] : TOOL_MODES, this.visor ? 'Hold LMB on fauna & flora to discover · V to close' : hints[this.toolMode]);
      hud.toolEl.style.display = '';
    } else hud.toolEl.style.display = 'none';
    hud.updateHotbar(g.inventory, g.selectedHot || 0, !g.inShip, this.toolMode === 1 && !this.visor);
    hud.showShip(g.inShip);
    if (g.inShip) {
      hud.updateShip(ship, ship.pos.y - this.world.groundAt(ship.pos.x, ship.pos.z), false);
      hud.setCrosshair('dot');
      if (ship.state === 'landed') hud.setPrompt(this.interior ? '<span class="key">SPACE</span>Launch  <span class="key">E</span>Exit ship' : '<span class="key">SPACE</span>Take off  <span class="key">E</span>Exit ship');
      else if (ship.state === 'flying') {
        const alt = ship.pos.y - this.world.groundAt(ship.pos.x, ship.pos.z);
        hud.setPrompt(alt < 55 ? '<span class="key">E</span>Land' : null);
      } else hud.setPrompt(null);
      hud.setHelp('W/S throttle · A/D roll · Shift boost · LMB fire\nClimb above 300u to leave the atmosphere');
      hud.setProgress(null);
      hud.showScan(null);
    } else {
      hud.setHelp('Q tool · F scan · V visor · T lamp · R recharge\nTab inventory · M galaxy map · Esc menu');
    }
  }
}
