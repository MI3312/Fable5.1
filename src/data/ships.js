// Starship classes, grades, names, prices, and what each station's hangar has for sale.
import { RNG, hash32 } from '../core/rng.js';

// speed: flight speed · agility: turning · shield: shield strength · damage: cannon damage ·
// jump: extra hyperdrive range (in the galaxy map's units of 100 ly)
export const SHIP_CLASSES = {
  shuttle: { name: 'Shuttle', desc: 'Cheap, honest and easy to fly. Four thrusters and a big window.', speed: 0.95, agility: 1.05, shield: 1.0, damage: 0.9, jump: 1, price: 0.55 },
  fighter: { name: 'Fighter', desc: 'Fast, nimble and hits hard. Swept wings and a narrow cockpit.', speed: 1.12, agility: 1.25, shield: 0.95, damage: 1.4, jump: 0, price: 1.0 },
  hauler: { name: 'Hauler', desc: 'Slow to turn and almost impossible to kill. Cargo pods down both flanks.', speed: 0.86, agility: 0.72, shield: 1.75, damage: 1.0, jump: 1, price: 1.15 },
  explorer: { name: 'Explorer', desc: 'A long hull around a big hyperdrive ring. Reaches stars the others cannot.', speed: 1.02, agility: 0.95, shield: 0.9, damage: 0.8, jump: 4, price: 1.1 },
  exotic: { name: 'Exotic', desc: 'A pod inside a ring, grown more than built. The fastest thing in the sky.', speed: 1.32, agility: 1.35, shield: 1.15, damage: 1.15, jump: 2, price: 2.6 },
};
export const CLASS_IDS = Object.keys(SHIP_CLASSES);

// grade: [stat multiplier, price multiplier]
export const GRADES = { C: [1.0, 1], B: [1.08, 1.7], A: [1.17, 2.8], S: [1.28, 4.6] };

const ADJ = ['Quiet', 'Patient', 'Lucid', 'Pale', 'Wandering', 'Hollow', 'Bright', 'Drowsy', 'Last', 'Faithful', 'Velvet', 'Silver', 'Crooked', 'Gentle', 'Restless', 'Distant', 'Sleepless', 'Borrowed'];
const NOUN = ['Heron', 'Lantern', 'Tide', 'Moth', 'Promise', 'Echo', 'Harbour', 'Kite', 'Reverie', 'Comet', 'Sparrow', 'Cradle', 'Anthem', 'Wanderer', 'Hymn', 'Ember', 'Orchard', 'Lullaby'];

export function shipName(seed) {
  const r = new RNG(hash32(seed, 3131));
  return `The ${r.pick(ADJ)} ${r.pick(NOUN)}`;
}

// a spec is everything needed to build and price a ship: { cls, grade, seed, hue }
export function normSpec(spec) {
  if (typeof spec === 'number') return { cls: 'fighter', grade: 'C', seed: spec >>> 0, hue: null };
  return { cls: SHIP_CLASSES[spec.cls] ? spec.cls : 'fighter', grade: GRADES[spec.grade] ? spec.grade : 'C', seed: (spec.seed >>> 0) || 1, hue: spec.hue ?? null };
}

export function shipStats(spec) {
  const s = normSpec(spec), C = SHIP_CLASSES[s.cls], k = GRADES[s.grade][0];
  return { speed: C.speed * (1 + (k - 1) * 0.6), agility: C.agility * (1 + (k - 1) * 0.5), shield: C.shield * k, damage: C.damage * k, jump: C.jump + (s.grade === 'S' ? 1 : 0) };
}

export function shipPrice(spec) {
  const s = normSpec(spec);
  return Math.round(60000 * SHIP_CLASSES[s.cls].price * GRADES[s.grade][1] / 100) * 100;
}

export function tradeIn(spec) { return Math.round(shipPrice(spec) * 0.55 / 100) * 100; }

// a random ship; `start` limits it to what you might wake up next to
export function randomSpec(rng, opts = {}) {
  const cls = opts.start
    ? rng.weighted([['shuttle', 3], ['fighter', 3], ['explorer', 2], ['hauler', 2]])
    : rng.weighted([['shuttle', 2.5], ['fighter', 3], ['hauler', 2.5], ['explorer', 2.2], ['exotic', 0.6]]);
  const grade = opts.start ? 'C' : rng.weighted([['C', 5], ['B', 3.5], ['A', 1.6], ['S', cls === 'exotic' ? 0.9 : 0.4]]);
  return { cls, grade, seed: rng.int(1, 2 ** 30), hue: null };
}

// what a station has parked in its showroom right now (it changes every half hour of play)
export function marketSpecs(sysSeed, epoch) {
  const rng = new RNG(hash32(sysSeed, epoch, 7070));
  return [0, 1, 2, 3].map(() => randomSpec(rng));
}

export function specLabel(spec) {
  const s = normSpec(spec);
  return `${SHIP_CLASSES[s.cls].name} · ${s.grade}-class`;
}

// liveries for the paint shop: hues (0-1), or null for the ship's own
export const PAINTS = [null, 0.0, 0.07, 0.13, 0.33, 0.5, 0.58, 0.68, 0.8, 0.92];
