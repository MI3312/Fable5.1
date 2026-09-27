// What every item is for and where it comes from, worked out from the game's own tables (block
// drops, recipes, upgrades, biome flora, fish, creature drops) plus a few hand-written notes for
// the things that come from events. The Tab screen uses this so nothing is a mystery by accident.
// Dream alchemy is the exception: its recipes only show once you've found them yourself.
import { ITEMS } from './items.js';
import { BLOCKS, B } from '../world/blocks.js';
import { RECIPES, ALCHEMY, UPGRADES } from './recipes.js';
import { BIOMES } from './biomes.js';
import { FISH, DISHES, FOOD } from './food.js';

// ------------------------------------------------------------------ sources
const EXTRA = {
  tritium: ['Shoot asteroids in space'],
  gold: ['Shoot rare asteroids in space'],
  copper: ['Shoot rare asteroids in space'],
  cobalt: ['Shoot rare asteroids in space', 'Cave walls'],
  chroma_shard: ['Rare asteroids', 'Dream caches in liminal places', 'Catching wisps'],
  mordite: ['Left behind by creatures you kill'],
  pugneum: ['Destroyed Sentinel drones'],
  salvage: ['Crates and hull on derelict freighters', 'Salvage contracts'],
  crew_tag: ['Crew lockers on derelict freighters'],
  null_shard: ['The chest in the Void'],
  almond_water: ['Boxes in the Backrooms'],
  memory_fragment: ['Dream caches in liminal places', 'Mannequins', 'Endless shelves'],
  kodama_rattle: ['A gift from the Kodama: stand still among them'],
  gel_core: ['Gels (hunt or feed them)'],
  bubble_foam: ['BubbleBears (hunt or feed them)'],
  table_hide: ['Wildebeest (hunt or feed them)'],
  maw_tooth: ['Sandmaws'],
  acid_gland: ['Spitters'],
  mote_dust: ['Swarms'],
  carapace_plate: ['Brutes'],
  lurker_heart: ['Lurkers (the ore that moves)'],
  oxygen: ['Feed creatures: some produce it'],
  sodium: ['Feed creatures: some produce it'],
  carbon: ['Feed creatures: some produce it'],
  dihydrogen: ['Feed creatures: some produce it'],
  warp_cell: ['Station traders', 'Salvage fused with Chroma Shards (a dream)'],
  launch_fuel: ['Station traders'],
  antimatter: ['Station traders'],
  microprocessor: ['Station traders'],
};

let _sources = null;
function buildSources() {
  const S = {};
  const add = (id, kind, text, extra) => { (S[id] = S[id] || []).push({ kind, text, ...extra }); };
  // mining and harvesting
  // natural terrain and plants first (they carry a planet tint), then things built by someone
  const mined = {};
  BLOCKS.forEach((b, i) => {
    if (!b) return;
    for (const [id] of b.drops || []) {
      if (id === '@special' || b.name === '?') continue;
      (mined[id] = mined[id] || []).push({ name: b.name, natural: b.tint !== 0 || /Deposit|Pod|Crystal|Bulb|Salt|Ice|Snow|Cloud/.test(b.name) });
    }
  });
  for (const [id, list] of Object.entries(mined)) {
    const nat = list.filter((q) => q.natural).map((q) => q.name);
    const built = list.filter((q) => !q.natural).map((q) => q.name);
    if (nat.length) add(id, 'mine', `Mine or harvest: ${nat.slice(0, 5).join(', ')}${nat.length > 5 ? '…' : ''}`);
    if (built.length) add(id, 'salvage', `Break down: ${built.slice(0, 4).join(', ')}${built.length > 4 ? '…' : ''}`);
  }
  // each biome's native flora
  for (const [bid, bm] of Object.entries(BIOMES)) {
    if (bm.special && ITEMS[bm.special]) add(bm.special, 'flora', `Native flora on ${bm.label} worlds`);
  }
  // refining and crafting
  for (const r of RECIPES) {
    const [id, n] = r.out;
    if (id.startsWith('block:')) continue;
    add(id, r.type === 'refine' ? 'refine' : 'craft', `${r.type === 'refine' ? 'Refine' : 'Craft'} from ${r.in.map(([i, k]) => `${k} ${ITEMS[i] ? ITEMS[i].name : i}`).join(' + ')}${n > 1 ? ` (makes ${n})` : ''}`, { recipe: r.id });
  }
  // fishing and cooking
  for (const [id, f] of Object.entries(FISH)) {
    const where = { water: 'water', dream: 'dreaming water', lava: 'magma', acid: 'acid' }[f.liquid];
    add(id, 'fish', `Fish in ${where}${f.when !== 'any' ? ` by ${f.when}` : ''}${f.deep ? ', far from shore' : ''}`);
  }
  for (const d of DISHES) {
    if (d.alt || !d.in.length) continue;
    add(d.id, 'cook', `Cook in a Nutrient Processor: ${d.in.map(([i, k]) => `${k} ${ITEMS[i].name}`).join(' + ')}`);
  }
  for (const [id, list] of Object.entries(EXTRA)) for (const t of list) add(id, 'event', t);
  return S;
}
export function sourcesOf(id) {
  if (!_sources) _sources = buildSources();
  return _sources[id] || [];
}

// ------------------------------------------------------------------ uses
const DIRECT_USE = {
  oxygen: 'Recharges life support', life_support_gel: 'Fully recharges life support',
  sodium: 'Recharges hazard protection', sodium_nitrate: 'Recharges hazard protection', ion_battery: 'Fully recharges hazard protection',
  carbon: 'Recharges your exosuit shield', dihydrogen_jelly: 'Fuels launch thrusters', launch_fuel: 'Fully fuels launch thrusters',
  uranium: 'Fuels launch thrusters', tritium: 'Fuels the pulse engine', starshield_battery: 'Fully recharges starship shields',
  ferrite: 'Patches starship shields', metal_plating: 'Repairs the starship hull', warp_cell: 'Powers one hyperdrive jump',
  lucid_core: 'Powers one hyperdrive jump', memory_fragment: 'Use it to remember something', almond_water: 'Drink: heals and calms you',
};
export function usesOf(id, knownAlchemy) {
  const out = [];
  if (DIRECT_USE[id]) out.push({ kind: 'use', text: DIRECT_USE[id] });
  if (FOOD[id] && !DIRECT_USE[id]) out.push({ kind: 'use', text: FOOD[id].buff ? 'Eat: heals and gives a buff' : 'Eat: heals you' });
  for (const r of RECIPES) {
    if (!r.in.some(([i]) => i === id)) continue;
    out.push({ kind: r.type === 'refine' ? 'refine' : 'craft', text: `${r.type === 'refine' ? 'Refines into' : 'Crafts'} ${outName(r.out)}`, recipe: r.id });
  }
  for (const u of UPGRADES) if (u.cost.some(([i]) => i === id)) out.push({ kind: 'tech', text: `Installs ${u.name}`, upgrade: u.id });
  for (const d of DISHES) if (!d.alt && d.in.some(([i]) => i === id)) out.push({ kind: 'cook', text: `Cooks into ${ITEMS[d.id].name}` });
  const known = new Set(knownAlchemy || []);
  let secret = false;
  ALCHEMY.forEach((r, i) => {
    if (r.a !== id && r.b !== id) return;
    if (known.has(i)) out.push({ kind: 'dream', text: `Dreams with ${ITEMS[r.a === id ? r.b : r.a].name} into ${outName(r.out)}`, alchemy: i });
    else secret = true;
  });
  if (secret) out.push({ kind: 'dream-unknown', text: 'Something in the dream still reacts to it' });
  return out;
}

export function outName(out) {
  const [id, n] = out;
  if (id.startsWith('block:')) return `${n > 1 ? n + '× ' : ''}${BLOCKS[Number(id.slice(6))].name}`;
  if (id === 'nanites') return `${n} Nanites`;
  if (id === 'lore') return 'a forgotten memory';
  return `${n > 1 ? n + '× ' : ''}${ITEMS[id] ? ITEMS[id].name : id}`;
}

// ------------------------------------------------------------------ crafting groups
const BASE_PARTS = new Set([B.BASE_CORE, B.TELEPORTER, B.PLANTER, B.STORAGE, B.NUTRIENT]);
const POWER = new Set(['dihydrogen_jelly', 'launch_fuel', 'life_support_gel', 'ion_battery', 'starshield_battery', 'warp_cell']);
export const CRAFT_GROUPS = [
  { id: 'ready', label: 'Ready to make', desc: 'Everything you have the materials for right now.' },
  { id: 'refine', label: 'Refining', desc: 'Turn raw elements into purer, denser ones. Most recipes need refined materials.' },
  { id: 'parts', label: 'Components', desc: 'Plating, circuits and seals: the parts that go into technology.' },
  { id: 'power', label: 'Fuel & power', desc: 'Launch fuel, batteries and warp cells. What keeps you and your ship going.' },
  { id: 'base', label: 'Base parts', desc: 'Place these to build a home: a base computer first, then teleporters, planters, storage and a kitchen.' },
  { id: 'build', label: 'Building blocks', desc: 'Blocks for building. Every world colours them differently.' },
];
export function recipeGroup(r) {
  if (r.type === 'refine') return 'refine';
  const [id] = r.out;
  if (id.startsWith('block:')) return BASE_PARTS.has(Number(id.slice(6))) ? 'base' : 'build';
  return POWER.has(id) ? 'power' : 'parts';
}
const BASE_DESC = {
  [B.BASE_CORE]: 'Place it to claim a base. Unlocks teleporters and saves your home on the map.',
  [B.TELEPORTER]: 'Travel instantly between your bases.',
  [B.PLANTER]: 'Grows crops you can harvest.',
  [B.STORAGE]: 'A crate for extra storage at your base.',
  [B.NUTRIENT]: 'Cook fish and ingredients into meals that heal and buff you.',
};
export function recipePurpose(r) {
  const [id] = r.out;
  if (id.startsWith('block:')) {
    const bid = Number(id.slice(6));
    return BASE_DESC[bid] || 'A building block.';
  }
  if (id === 'nanites') return 'Nanites: the currency for technology at stations.';
  return ITEMS[id] ? ITEMS[id].desc : '';
}

// ------------------------------------------------------------------ planning
// Work out how to make `times` of a recipe from what you carry, making any missing parts first.
// Returns { steps: [{ recipe, times }], missing: [[id, n]] } - steps is null if it can't be done.
export function planRecipe(inv, recipe, times = 1) {
  const counts = {};
  const cnt = (id) => (counts[id] ?? (counts[id] = inv.count(id)));
  const steps = [];
  // take `need` of an item out of the pool, making it first if there isn't enough
  const take = (id, need, depth, seen) => {
    if (cnt(id) >= need) { counts[id] -= need; return true; }
    if (depth > 3 || seen.has(id)) return false;
    const short = need - cnt(id);
    for (const r of RECIPES) {
      if (r.out[0] !== id) continue;
      const k = Math.ceil(short / r.out[1]);
      const snap = { ...counts }, len = steps.length;
      const s2 = new Set(seen); s2.add(id);
      if (r.in.every(([i, n]) => take(i, n * k, depth + 1, s2))) {
        counts[id] = cnt(id) + r.out[1] * k - need;
        steps.push({ recipe: r, times: k });
        return true;
      }
      for (const key of Object.keys(counts)) delete counts[key];
      Object.assign(counts, snap);
      steps.length = len;
    }
    return false;
  };
  const ok = recipe.in.every(([i, n]) => take(i, n * times, 1, new Set([recipe.out[0]])));
  if (ok) {
    steps.push({ recipe, times });
    return { steps, missing: [] };
  }
  // what's short, directly
  const missing = recipe.in.filter(([i, n]) => inv.count(i) < n * times).map(([i, n]) => [i, n * times - inv.count(i)]);
  return { steps: null, missing };
}
