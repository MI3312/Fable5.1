// Item registry: raw elements, refined materials, products, dream-alchemy results.
// symbol: short label drawn in the inventory tile; color: tile colour.
import { FOOD_ITEMS } from './food.js';

export const ITEMS = {
  // --- elements (NMS style) ---
  carbon: { name: 'Carbon', symbol: 'C', color: '#d8423c', cat: 'element', value: 7, desc: 'A fundamental element harvested from plant life. Fuels the mining beam.' },
  condensed_carbon: { name: 'Condensed Carbon', symbol: 'C+', color: '#ff5f4f', cat: 'element', value: 24, desc: 'Refined carbon, dense with stored energy.' },
  ferrite: { name: 'Ferrite Dust', symbol: 'Fe', color: '#9aa3ad', cat: 'element', value: 14, desc: 'Metallic dust scattered through planetary rock.' },
  pure_ferrite: { name: 'Pure Ferrite', symbol: 'Fe+', color: '#c6ccd4', cat: 'element', value: 28, desc: 'Refined ferrite, used in most structural products.' },
  magnetised_ferrite: { name: 'Magnetised Ferrite', symbol: 'Fe++', color: '#e8f1ff', cat: 'element', value: 82, desc: 'Ferrite that hums with a latent charge.' },
  sodium: { name: 'Sodium', symbol: 'Na', color: '#f1b637', cat: 'element', value: 41, desc: 'A volatile element. Recharges hazard protection.' },
  sodium_nitrate: { name: 'Sodium Nitrate', symbol: 'Na+', color: '#ffd35a', cat: 'element', value: 82, desc: 'Refined sodium. Powerful hazard protection recharge.' },
  oxygen: { name: 'Oxygen', symbol: 'O2', color: '#e84343', cat: 'element', value: 34, desc: 'Breathable gas harvested from red pods. Refills life support.' },
  dihydrogen: { name: 'Di-hydrogen', symbol: 'H', color: '#3f8fe6', cat: 'element', value: 34, desc: 'Blue crystalline hydrogen. Fuels launch thrusters and jetpacks.' },
  silicate: { name: 'Silicate Powder', symbol: 'Si', color: '#e9e3d4', cat: 'element', value: 1, desc: 'Fine powder from soil and sand. Makes glass.' },
  copper: { name: 'Copper', symbol: 'Cu', color: '#e88a3c', cat: 'element', value: 110, desc: 'A conductive metal from star-touched deposits.' },
  chromatic_metal: { name: 'Chromatic Metal', symbol: 'Ch', color: '#ffae5c', cat: 'element', value: 245, desc: 'A metal whose colour shifts in the dream-light. Refined from copper.' },
  gold: { name: 'Gold', symbol: 'Au', color: '#f7d046', cat: 'element', value: 202, desc: 'Precious metal. Sells well at stations.' },
  uranium: { name: 'Uranium', symbol: 'U', color: '#6be05a', cat: 'element', value: 50, desc: 'Radioactive and warm to the touch. Fuels launch thrusters.' },
  cobalt: { name: 'Cobalt', symbol: 'Co', color: '#4c6de0', cat: 'element', value: 198, desc: 'A deep blue metal found in cave walls.' },
  ionised_cobalt: { name: 'Ionised Cobalt', symbol: 'Co+', color: '#7b96ff', cat: 'element', value: 401, desc: 'Charged cobalt. Powers ship shields.' },
  tritium: { name: 'Tritium', symbol: 'Tr', color: '#b08cf0', cat: 'element', value: 6, desc: 'Harvested from asteroids. Fuels the pulse engine.' },
  pugneum: { name: 'Pugneum', symbol: 'Pg', color: '#ff4b3a', cat: 'element', value: 138, desc: 'Scavenged from Sentinel machinery.' },
  chroma_shard: { name: 'Chroma Shard', symbol: 'Cr', color: '#e07bff', cat: 'element', value: 120, desc: 'A fragment of solidified dream. Essential for alchemy.' },
  mordite: { name: 'Mordite', symbol: 'Mo', color: '#8d3b52', cat: 'element', value: 40, desc: 'Remains left by fallen creatures.' },
  // --- planet specials ---
  star_bulb: { name: 'Star Bulb', symbol: 'Sb', color: '#9cff6b', cat: 'element', value: 32, desc: 'Lush-world flora that glows like a distant star.' },
  frost_crystal: { name: 'Frost Crystal', symbol: 'Fr', color: '#bff3ff', cat: 'element', value: 12, desc: 'Grows only in freezing air.' },
  solanium: { name: 'Solanium', symbol: 'So', color: '#ff7a2e', cat: 'element', value: 70, desc: 'A heat-loving plant from scorched worlds.' },
  fungal_mould: { name: 'Fungal Mould', symbol: 'Fm', color: '#b6d33a', cat: 'element', value: 16, desc: 'Toxic spores that thrive in poisoned air.' },
  gamma_root: { name: 'Gamma Root', symbol: 'Gr', color: '#63ffb4', cat: 'element', value: 16, desc: 'A radiant root from irradiated soil.' },
  cactus_flesh: { name: 'Cactus Flesh', symbol: 'Cf', color: '#8ec96b', cat: 'element', value: 28, desc: 'Moist flesh from barren-world cacti.' },
  hexite: { name: 'Hexite', symbol: 'Hx', color: '#ff66d9', cat: 'element', value: 300, desc: 'An impossible geometry, grown by exotic worlds.' },
  reverie_bloom: { name: 'Reverie Bloom', symbol: 'Rv', color: '#ffc0ea', cat: 'element', value: 90, desc: 'A flower that only blooms in liminal dreams.' },
  // --- products ---
  metal_plating: { name: 'Metal Plating', symbol: 'MP', color: '#7f8b98', cat: 'product', value: 800, stack: 10, desc: 'Sturdy plating. Repairs damaged technology.' },
  carbon_nanotubes: { name: 'Carbon Nanotubes', symbol: 'CN', color: '#c14b4b', cat: 'product', value: 500, stack: 10, desc: 'Lightweight carbon filament.' },
  dihydrogen_jelly: { name: 'Di-hydrogen Jelly', symbol: 'DJ', color: '#5aa7ff', cat: 'product', value: 200, stack: 10, desc: 'Gelatinous fuel. Refills launch thrusters.' },
  launch_fuel: { name: 'Launch Fuel', symbol: 'LF', color: '#ff9e4f', cat: 'product', value: 450, stack: 10, desc: 'Packed fuel for starship launch thrusters.' },
  life_support_gel: { name: 'Life Support Gel', symbol: 'LS', color: '#ff6e6e', cat: 'product', value: 200, stack: 10, desc: 'Fully restores life support.' },
  ion_battery: { name: 'Ion Battery', symbol: 'IB', color: '#6cd3ff', cat: 'product', value: 200, stack: 10, desc: 'Fully restores hazard protection.' },
  starshield_battery: { name: 'Starshield Battery', symbol: 'SS', color: '#7b96ff', cat: 'product', value: 700, stack: 10, desc: 'Fully restores starship shields.' },
  antimatter: { name: 'Antimatter', symbol: 'AM', color: '#ff8af0', cat: 'product', value: 5200, stack: 10, desc: 'Unstable matter. Warp cell component.' },
  antimatter_housing: { name: 'Antimatter Housing', symbol: 'AH', color: '#d2d2ff', cat: 'product', value: 4800, stack: 10, desc: 'A containment shell for antimatter.' },
  warp_cell: { name: 'Warp Cell', symbol: 'WC', color: '#a36bff', cat: 'product', value: 46000, stack: 5, desc: 'Powers a single hyperdrive jump between stars.' },
  microprocessor: { name: 'Microprocessor', symbol: 'µP', color: '#3fe0c5', cat: 'product', value: 2000, stack: 10, desc: 'Logic circuitry for advanced technology.' },
  hermetic_seal: { name: 'Hermetic Seal', symbol: 'HS', color: '#ffb36b', cat: 'product', value: 800, stack: 10, desc: 'Airtight sealant. Repairs hulls.' },
  // --- dream alchemy (Lucid) ---
  somnium: { name: 'Somnium Sand', symbol: 'Zz', color: '#c7b5ff', cat: 'dream', value: 400, stack: 20, desc: 'Sand from the bottom of a sleeping ocean.' },
  liquid_light: { name: 'Liquid Light', symbol: 'LL', color: '#fff6a8', cat: 'dream', value: 650, stack: 20, desc: 'Luminescence that pours like water.' },
  echo_shell: { name: 'Echo Shell', symbol: 'Ec', color: '#9fe8ff', cat: 'dream', value: 900, stack: 20, desc: 'Hold it to your ear: you hear an empty hallway.' },
  dream_lens: { name: 'Dream Lens', symbol: 'DL', color: '#ff9bf2', cat: 'dream', value: 1800, stack: 10, desc: 'Reveals the seams of reality. Upgrades the scanner.' },
  memory_fragment: { name: 'Memory Fragment', symbol: 'Mf', color: '#ffd9a8', cat: 'dream', value: 1200, stack: 20, desc: 'A memory that is not yours. Or is it?' },
  lucid_core: { name: 'Lucid Core', symbol: 'LC', color: '#ffffff', cat: 'dream', value: 25000, stack: 5, desc: 'Pure lucidity. Stabilises hyperdrive jumps - a warp cell of the mind.' },
  void_egg: { name: 'Void Egg', symbol: 'VE', color: '#39204f', cat: 'dream', value: 8000, stack: 5, desc: 'Something is dreaming inside.' },
  static_bloom: { name: 'Static Bloom', symbol: 'St', color: '#d8d8d8', cat: 'dream', value: 700, stack: 20, desc: 'A flower made of television snow.' },
  // --- derelicts and the broken dream ---
  salvage: { name: 'Salvaged Data', symbol: 'SD', color: '#9fd0ff', cat: 'product', value: 3200, stack: 20, desc: 'Encrypted records from a dead ship. Stations pay well and ask no questions.' },
  crew_tag: { name: 'Crew Tag', symbol: 'CT', color: '#d8c9a8', cat: 'dream', value: 1500, stack: 20, desc: 'A name stamped in metal. The name keeps changing when you are not reading it.' },
  null_shard: { name: 'Null Shard', symbol: '∅', color: '#101014', cat: 'dream', value: 0, stack: 10, desc: 'A piece of nothing. It is heavier than it should be. It is warm.' },
  // --- vermin materials ---
  kodama_rattle: { name: 'Kodama Rattle', symbol: 'Kr', color: '#f2f6ee', cat: 'dream', value: 950, stack: 20, desc: 'A small pale thing that rattles only when nobody is near. A gift.' },
  gel_core: { name: 'Gel Core', symbol: 'Gc', color: '#a8ff8a', cat: 'dream', value: 520, stack: 20, desc: 'The glowing heart of a Gel. Still wobbling. Still warm.' },
  bubble_foam: { name: 'Bubble Foam', symbol: 'Bf', color: '#ffc4ea', cat: 'dream', value: 380, stack: 30, desc: 'It pops if you squeeze it too happily.' },
  table_hide: { name: 'Table Hide', symbol: 'Th', color: '#b59a7a', cat: 'dream', value: 460, stack: 20, desc: 'Shaggy fur from a Wildebeest. Perfectly flat on one side.' },
  maw_tooth: { name: 'Maw Tooth', symbol: 'Mt', color: '#efe4c8', cat: 'dream', value: 900, stack: 20, desc: 'Curved inward. Everything about the Sandmaw points inward.' },
  acid_gland: { name: 'Acid Gland', symbol: 'Ag', color: '#c8ff4a', cat: 'dream', value: 480, stack: 20, desc: 'Still sloshing. Handle by the stem.' },
  mote_dust: { name: 'Mote Dust', symbol: 'Md', color: '#ffd27a', cat: 'dream', value: 160, stack: 50, desc: 'Glows faintly in the dark, and more brightly near a lamp.' },
  carapace_plate: { name: 'Carapace Plate', symbol: 'Cp', color: '#6a7282', cat: 'dream', value: 700, stack: 20, desc: 'Scratched by everything it ever ran into.' },
  lurker_heart: { name: 'Lurker Heart', symbol: 'Lh', color: '#ffb347', cat: 'dream', value: 1400, stack: 10, desc: 'A lump of ore that beats, slowly, when held.' },
  // --- fishing and cooking ---
  ...FOOD_ITEMS,
};

export const ITEM_IDS = Object.keys(ITEMS);

export function itemStackLimit(id) {
  const it = ITEMS[id];
  if (!it) return 1;
  if (it.stack) return it.stack;
  return 500;
}
