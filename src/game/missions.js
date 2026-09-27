// Station mission boards. Every system posts a handful of contracts that refresh as you play:
// bounties on the things that hunt, fauna/flora surveys, expeditions into dream zones, cache hunts
// and deliveries. Completing them pays units and nanites and raises your Dreamwalker rank, which
// sweetens later rewards.
import { RNG, hash32 } from '../core/rng.js';
import { speciesForPlanet } from '../entities/creatures.js';
import { ZONE_INFO } from '../world/zones.js';
import { ITEMS } from '../data/items.js';
import { FISH } from '../data/food.js';

export const RANKS = [
  [0, 'Drifter'], [3, 'Wayfarer'], [7, 'Pathfinder'], [12, 'Lucid Warden'], [20, 'Keeper of the Fog'], [32, 'Architect of Sleep'],
];

const DELIVERIES = [
  ['ferrite', 200, 3], ['carbon', 150, 3], ['chromatic_metal', 40, 6], ['sodium', 60, 5], ['dihydrogen_jelly', 3, 40],
  ['gel_core', 3, 80], ['maw_tooth', 2, 160], ['mote_dust', 10, 40], ['acid_gland', 3, 90], ['carapace_plate', 2, 140],
  ['salvage', 3, 200], ['liquid_light', 2, 120], ['bubble_foam', 6, 50],
  ['dream_minnow', 5, 90], ['lucid_eel', 2, 260], ['star_koi', 1, 900], ['grilled_fish', 3, 220],
];

export class Missions {
  constructor(game) { this.game = game; this.hudKey = ''; }

  get S() {
    const st = this.game.state;
    if (!st.missions) st.missions = { active: [], done: 0, taken: {} };
    return st.missions;
  }

  rank() {
    const n = this.S.done;
    let r = RANKS[0];
    for (const q of RANKS) if (n >= q[0]) r = q;
    const next = RANKS.find((q) => q[0] > n);
    return { title: r[1], done: n, next: next ? next[0] : null };
  }

  _mult() { return 1 + Math.min(1.5, this.S.done * 0.05); }

  // contracts posted in the current system right now
  offers() {
    const g = this.game, sys = g.system;
    if (!sys) return [];
    const epoch = Math.floor((g.state.playTime || 0) / 900);
    const planets = sys.planets.filter((p) => !p.isStation);
    const out = [];
    const key = (i) => `${sys.key}:${epoch}:${i}`;
    const m = this._mult();
    for (let i = 0; i < 12 && out.length < 5; i++) {
      const k = key(i);
      if (this.S.taken[k]) continue;
      const rng = new RNG(hash32(sys.seed || 1, epoch, 4242 + i)); // one stream per board slot
      const kind = rng.weighted([['bounty', 3], ['survey', 2], ['zone', 2], ['cache', 1.2], ['deliver', 2], ['angler', 1.4]]);
      const planet = planets[rng.int(0, planets.length - 1)];
      if (!planet) continue;
      let o = null;
      if (kind === 'bounty') {
        const hunters = speciesForPlanet(planet).filter((s) => s.hostile);
        if (!hunters.length) continue;
        const sp = rng.pick(hunters);
        const need = sp.plan === 'sandmaw' || sp.plan === 'brute' ? 1 : rng.int(1, 3);
        o = { type: 'bounty', plan: sp.plan, what: sp.name, need, title: `Bounty: ${sp.name}`, desc: `Put down ${need > 1 ? need + ' ' : 'a '}${sp.name}${need > 1 ? 's' : ''} on ${planet.name}. ${sp.note}.`, units: Math.round((9000 + need * 4000) * m), nanites: Math.round((25 + need * 10) * m) };
      } else if (kind === 'survey') {
        if (planet.params.fauna <= 0 && planet.biome === 'dead') continue;
        const need = rng.int(2, 4);
        o = { type: 'survey', need, title: `Survey ${planet.name}`, desc: `Analyse ${need} new species of fauna or flora on ${planet.name} with your visor (V).`, units: Math.round(6000 * m + need * 1500), nanites: Math.round(15 * m) };
      } else if (kind === 'zone') {
        const zones = (planet.params.zones || []).map((z) => z[0]).filter((z) => z !== 'natural' && ZONE_INFO[z]);
        if (!zones.length) continue;
        const z = rng.pick(zones);
        o = { type: 'zone', zone: z, need: 1, title: `Expedition: ${ZONE_INFO[z].name}`, desc: `Find ${ZONE_INFO[z].name} on ${planet.name} and step inside. ${ZONE_INFO[z].text}`, units: Math.round(8000 * m), nanites: Math.round(30 * m), bonus: ['memory_fragment', 1] };
      } else if (kind === 'cache') {
        const need = rng.int(1, 2);
        o = { type: 'cache', need, title: `Cache run: ${planet.name}`, desc: `Open ${need} dream cache${need > 1 ? 's' : ''} on ${planet.name}. Your scanner (F) and ruins are a good start.`, units: Math.round(7000 * m + need * 2000), nanites: Math.round(20 * m) };
      } else if (kind === 'angler') {
        const need = rng.int(2, 5);
        o = { type: 'angler', need, title: `Angler: ${planet.name}`, desc: `Land ${need} catches in the waters of ${planet.name}. You will need the Dream Line (Technology tab). Casting further out finds bigger fish.`, units: Math.round(5000 * m + need * 1800), nanites: Math.round(18 * m), bonus: ['koi_sashimi', 1] };
      } else {
        const [item, n, unit] = rng.pick(DELIVERIES);
        const need = Math.max(1, Math.round(n * (0.6 + rng.next() * 0.8)));
        o = { type: 'deliver', item, need, title: `Supply: ${ITEMS[item].name}`, desc: `Bring ${need} ${ITEMS[item].name} to any station's mission board.`, units: Math.round(need * unit * 3 * m + 2000), nanites: Math.round(10 * m) };
      }
      if (o.type !== 'deliver') { o.planet = planet.id; o.planetName = planet.name; }
      o.key = k;
      o.have = 0;
      out.push(o);
    }
    return out;
  }

  accept(o) {
    const S = this.S, g = this.game;
    if (S.active.length >= 3) { g.hud.notify('You can carry three contracts at once'); return false; }
    S.taken[o.key] = true;
    S.active.push({ ...o });
    g.hud.toast('Contract accepted', o.title);
    g.audio.ui();
    return true;
  }

  abandon(m) {
    this.S.active = this.S.active.filter((q) => q !== m);
    this.game.audio.uiBack();
  }

  canDeliver(m) { return m.type === 'deliver' && this.game.inventory.count(m.item) >= m.need; }

  deliver(m) {
    if (!this.canDeliver(m)) return;
    this.game.inventory.remove(m.item, m.need);
    m.have = m.need;
    this._complete(m);
  }

  // game events: kill {plan, planet} · scan {planet} · zone {zone, planet} · cache {planet} · fish {planet, id}
  event(type, e) {
    const map = { kill: 'bounty', scan: 'survey', zone: 'zone', cache: 'cache', fish: 'angler' };
    for (const m of [...this.S.active]) {
      if (m.type !== map[type] || (m.planet && e.planet !== m.planet)) continue;
      if (type === 'kill' && e.plan !== m.plan) continue;
      if (type === 'zone' && e.zone !== m.zone) continue;
      if (type === 'fish' && FISH[e.id] && (FISH[e.id].shape === 'junk' || FISH[e.id].dread)) continue;
      m.have = Math.min(m.need, m.have + 1);
      if (m.have >= m.need) this._complete(m);
      else this.game.hud.notify(`${m.title}: ${m.have}/${m.need}`);
    }
  }

  _complete(m) {
    const g = this.game, S = this.S;
    S.active = S.active.filter((q) => q !== m);
    const before = this.rank().title;
    S.done++;
    g.inventory.add('units', m.units);
    g.inventory.add('nanites', m.nanites);
    if (m.bonus) g.inventory.add(m.bonus[0], m.bonus[1]);
    g.hud.toast('Contract complete', `${m.title} · +${m.units.toLocaleString()} units · +${m.nanites} nanites`);
    g.audio.discover();
    const after = this.rank().title;
    if (after !== before) setTimeout(() => g.hud.toast('Dreamwalker rank', after), 1800);
  }

  // one line for the HUD
  hudLine() {
    const a = this.S.active;
    if (!a.length) return '';
    const m = a[0];
    const here = this.game.surface?.planet?.id;
    const where = m.planet ? (m.planet === here ? ' · here' : ` · ${m.planetName}`) : '';
    const prog = m.type === 'deliver' ? `${Math.min(this.game.inventory.count(m.item), m.need)}/${m.need}` : `${m.have}/${m.need}`;
    return `${m.title} ${prog}${where}${a.length > 1 ? ` (+${a.length - 1})` : ''}`;
  }
}
