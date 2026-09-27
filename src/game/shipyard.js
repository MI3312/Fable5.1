// The ship market: what's parked in a station's showroom bays, buying one (your old ship is taken in
// trade and ends up in that bay), repainting, and claiming crashed ships found on planets.
import * as THREE from 'three';
import { buildShip } from '../entities/shipModel.js';
import { castShadows } from '../world/shadows.js';
import { SHIP_BAYS, STATION_FLOOR } from '../world/station.js';
import { RNG, hash32 } from '../core/rng.js';
import { marketSpecs, normSpec, shipPrice, tradeIn, shipName, specLabel, randomSpec } from '../data/ships.js';

const EPOCH = 1800; // the showroom changes every half hour of play

export class Shipyard {
  constructor(game) {
    this.game = game;
    this.models = [];
  }

  _market() {
    const g = this.game, st = g.state, sys = g.system;
    if (!st.market) st.market = {};
    const epoch = Math.floor((st.playTime || 0) / EPOCH);
    let m = st.market[sys.key];
    if (!m || m.epoch !== epoch) {
      m = { epoch, bays: marketSpecs(sys.seed, epoch) };
      st.market[sys.key] = m;
    }
    return m;
  }

  bays() { return this._market().bays; }

  offer(i) {
    const spec = this.bays()[i];
    if (!spec) return null;
    const cur = this.game.ship.spec;
    const price = shipPrice(spec), credit = tradeIn(cur);
    return { spec, name: shipName(spec.seed), label: specLabel(spec), price, credit, cost: Math.max(0, price - credit) };
  }

  buy(i) {
    const g = this.game, o = this.offer(i);
    if (!o) return false;
    if (g.inventory.units < o.cost) { g.hud.notify(`You need ${o.cost.toLocaleString()} units`); return false; }
    g.inventory.remove('units', o.cost);
    const old = { ...g.ship.spec };
    this._market().bays[i] = old; // the dealer parks your old ship in the bay
    g.setShip(o.spec);
    g.ship.shield = 100; g.ship.hull = 100;
    g.hud.toast('New starship', `${o.name} · ${o.label}`);
    g.audio.discover();
    if (g.surface.pocket === 'station') this.spawn(g.surface);
    return true;
  }

  paintCost() { return 4000; }

  paint(hue) {
    const g = this.game, cost = this.paintCost();
    if (g.inventory.units < cost) { g.hud.notify(`A paint job costs ${cost.toLocaleString()} units`); return false; }
    g.inventory.remove('units', cost);
    g.setShip({ ...g.ship.spec, hue });
    g.hud.notify('Your ship has a new coat of paint');
    g.audio.craft();
    return true;
  }

  // the crashed ship at a wreck beacon: always the same ship for the same wreck
  wreckSpec(planetSeed, x, z) {
    const rng = new RNG(hash32(planetSeed, x, z, 6161));
    const s = randomSpec(rng);
    if (s.grade === 'S') s.grade = 'A';
    return s;
  }

  wreckCost(spec) {
    const k = { C: 1, B: 2, A: 3, S: 4 }[normSpec(spec).grade];
    return [['metal_plating', 1 + k], ['carbon_nanotubes', k], ['ferrite', 40 * k]];
  }

  // showroom models, parked nose-out in each bay
  spawn(mode) {
    this.clear();
    const bays = this.bays();
    SHIP_BAYS.forEach((b, i) => {
      const spec = bays[i];
      if (!spec) return;
      const m = buildShip(spec, { detail: 0.12 });
      m.position.set(b.x + 0.5, STATION_FLOOR + 1.72, b.z + 0.5);
      m.rotation.set(0, Math.PI, 0);
      if (m.userData.gear) m.userData.gear.visible = true;
      for (const f of m.userData.flames || []) f.visible = false;
      castShadows(m);
      mode.scene.add(m);
      this.models.push(m);
    });
  }

  clear() {
    for (const m of this.models) m.removeFromParent();
    this.models = [];
  }

  update(t) {
    // a slow pulse on the nav lights so the showroom feels alive
    for (const m of this.models) for (const n of m.userData.nav || []) n.l.visible = ((t * 0.5 + n.phase) % 1) < 0.2;
  }
}

export { EPOCH };
