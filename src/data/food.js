// Fishing and cooking: what bites where, what it becomes in a Nutrient Processor, and what eating
// it does to you.

// Catch table. liquid: which liquid it lives in. when: 'day' | 'night' | 'any'. w: weight.
// pull: how hard it fights (0..1). deep: prefers casts far from shore.
export const FISH = {
  dream_minnow: { liquid: 'water', when: 'any', w: 10, pull: 0.25, size: 0.35, shape: 'slim' },
  lucid_eel: { liquid: 'water', when: 'any', w: 4, pull: 0.55, size: 0.9, shape: 'eel', deep: true },
  star_koi: { liquid: 'water', when: 'day', w: 2.2, pull: 0.5, size: 0.55, shape: 'koi', dusk: 3 },
  abyss_lantern: { liquid: 'water', when: 'night', w: 2.4, pull: 0.7, size: 0.6, shape: 'angler', deep: true },
  kelp_tangle: { liquid: 'water', when: 'any', w: 3, pull: 0.1, size: 0.4, shape: 'junk' },
  reverie_carp: { liquid: 'dream', when: 'any', w: 8, pull: 0.4, size: 0.6, shape: 'koi' },
  echo_shell: { liquid: 'dream', when: 'any', w: 2, pull: 0.2, size: 0.3, shape: 'junk' },
  magma_ray: { liquid: 'lava', when: 'any', w: 6, pull: 0.8, size: 0.8, shape: 'ray' },
  bile_koi: { liquid: 'acid', when: 'any', w: 6, pull: 0.6, size: 0.5, shape: 'koi' },
  drowned_doll: { liquid: 'water', when: 'night', w: 0.35, pull: 0.05, size: 0.35, shape: 'doll', dread: true },
};

// Items for the catch and the kitchen (merged into ITEMS)
export const FOOD_ITEMS = {
  dream_minnow: { name: 'Dream Minnow', symbol: 'Dm', color: '#9fd6ff', cat: 'fish', value: 140, stack: 20, desc: 'A little silver thing that swims the same way in every ocean of every world.' },
  lucid_eel: { name: 'Lucid Eel', symbol: 'Le', color: '#7de0c8', cat: 'fish', value: 420, stack: 10, desc: 'Long, cold, and faintly luminous. It keeps swimming for a while after you catch it.' },
  star_koi: { name: 'Star Koi', symbol: 'Sk', color: '#ffb35a', cat: 'fish', value: 900, stack: 10, desc: 'Its scales hold the colour of whichever sky it last saw. Bites at dawn and dusk.' },
  abyss_lantern: { name: 'Abyss Lantern', symbol: 'Al', color: '#3a4ec8', cat: 'fish', value: 1300, stack: 10, desc: 'A deep-water angler. The light on its head is still on.' },
  kelp_tangle: { name: 'Kelp Tangle', symbol: 'Kt', color: '#4f8a3a', cat: 'fish', value: 20, stack: 30, desc: 'Not a fish. Rich in carbon, if you are not fussy.' },
  reverie_carp: { name: 'Reverie Carp', symbol: 'Rc', color: '#ffb0e0', cat: 'fish', value: 700, stack: 10, desc: 'Only lives in water that is dreaming. Tastes like a half-remembered holiday.' },
  magma_ray: { name: 'Magma Ray', symbol: 'Mr', color: '#ff6a2a', cat: 'fish', value: 1600, stack: 10, desc: 'It glides through molten rock. Handle quickly.' },
  bile_koi: { name: 'Bile Koi', symbol: 'Bk', color: '#b8ff3a', cat: 'fish', value: 800, stack: 10, desc: 'Thrives in acid. Somehow, it is delicious.' },
  drowned_doll: { name: 'Drowned Doll', symbol: '◉', color: '#d8cfc4', cat: 'dream', value: 0, stack: 5, desc: 'It was on the end of your line. Its eyes are wet. It was not there when you cast.' },
  // dishes
  grilled_fish: { name: 'Grilled Fish', symbol: 'Gf', color: '#e0a060', cat: 'food', value: 320, stack: 10, desc: 'Simple and hot. Restores health.' },
  koi_sashimi: { name: 'Starlight Sashimi', symbol: 'Ss', color: '#ffc27a', cat: 'food', value: 1400, stack: 10, desc: 'You feel light on your feet for a while.' },
  eel_broth: { name: 'Deep Eel Broth', symbol: 'Eb', color: '#7ad8c0', cat: 'food', value: 900, stack: 10, desc: 'Warm all the way down. You breathe slower.' },
  ember_stew: { name: 'Ember Stew', symbol: 'Es', color: '#ff7a3a', cat: 'food', value: 2200, stack: 10, desc: 'Too hot to taste. The weather stops bothering you.' },
  cloud_cake: { name: 'Cloud Cake', symbol: 'Cc', color: '#f2f4ff', cat: 'food', value: 1100, stack: 10, desc: 'Mostly air. Your jetpack agrees.' },
  lantern_soup: { name: 'Lantern Soup', symbol: 'Ls', color: '#8fa2ff', cat: 'food', value: 2400, stack: 10, desc: 'The soup glows. So, for a while, do you.' },
  lullaby_soup: { name: 'Lullaby Soup', symbol: 'Lu', color: '#e6c8ff', cat: 'food', value: 1800, stack: 10, desc: 'Somebody used to make this for you. The dark feels further away.' },
  acid_ceviche: { name: 'Acid Ceviche', symbol: 'Ac', color: '#c8ff5a', cat: 'food', value: 1500, stack: 10, desc: 'Cured in its own sea. Toxic air cannot touch you.' },
};

// Buffs. mul: multipliers the systems read through game.buffs.mul(key).
export const BUFFS = {
  swift: { name: 'Swift', icon: '»', color: '#ffc27a', desc: 'Move 25% faster', mul: { speed: 1.25 } },
  breath: { name: 'Slow breath', icon: 'O₂', color: '#7ad8c0', desc: 'Life support lasts twice as long', mul: { life: 0.5 } },
  warm: { name: 'Weatherproof', icon: '☀', color: '#ff7a3a', desc: 'Hazard protection drains at half speed', mul: { hazard: 0.5 } },
  buoyant: { name: 'Buoyant', icon: '☁', color: '#f2f4ff', desc: 'Jetpack burns 40% less fuel', mul: { jet: 0.6 } },
  glow: { name: 'Glowing', icon: '✺', color: '#8fa2ff', desc: 'You shed light in the dark', mul: {} },
  calm: { name: 'Calm', icon: '♪', color: '#e6c8ff', desc: 'Fear takes hold half as fast', mul: { dread: 0.5 } },
  sealed: { name: 'Sealed', icon: '⬡', color: '#c8ff5a', desc: 'Hazard protection drains at half speed', mul: { hazard: 0.5 } },
};

// Nutrient Processor recipes. heal: instant health. buff: [key, seconds].
export const DISHES = [
  { id: 'grilled_fish', in: [['dream_minnow', 2]], heal: 60 },
  { id: 'grilled_fish', in: [['reverie_carp', 1]], heal: 60, alt: true },
  { id: 'koi_sashimi', in: [['star_koi', 1], ['sodium', 5]], heal: 20, buff: ['swift', 240] },
  { id: 'eel_broth', in: [['lucid_eel', 1], ['oxygen', 10]], heal: 30, buff: ['breath', 300] },
  { id: 'ember_stew', in: [['magma_ray', 1], ['carbon', 10]], heal: 40, buff: ['warm', 300] },
  { id: 'cloud_cake', in: [['bubble_foam', 3], ['dream_minnow', 1]], heal: 15, buff: ['buoyant', 240] },
  { id: 'lantern_soup', in: [['abyss_lantern', 1], ['dihydrogen', 10]], heal: 30, buff: ['glow', 420] },
  { id: 'lullaby_soup', in: [['reverie_carp', 1], ['somnium', 1]], heal: 30, buff: ['calm', 360] },
  { id: 'acid_ceviche', in: [['bile_koi', 1], ['sodium', 5]], heal: 25, buff: ['sealed', 300] },
];

export const FOOD = Object.fromEntries(DISHES.filter((d) => !d.alt).map((d) => [d.id, d]));
