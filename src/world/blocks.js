// Block registry. Pure data (no DOM) so it can be shared with the terrain worker.
// Texture tile indices refer to the procedurally painted atlas (see atlas.js).

export const TILE = {
  stone: 0, dirt: 1, grass_top: 2, grass_side: 3, sand: 4, water: 5, ice: 6, snow: 7,
  snow_side: 8, log_side: 9, log_top: 10, leaves: 11, ore_ferrite: 12, ore_copper: 13,
  ore_gold: 14, ore_uranium: 15, ore_cobalt: 16, crystal: 17, pool_tile: 18, wallpaper: 19,
  carpet: 20, ceiling_tile: 21, light_panel: 22, checker: 23, glass: 24, lava: 25,
  bedrock: 26, dream: 27, metal_plate: 28, metal_panel: 29, brick: 30, planks: 31,
  tallgrass: 32, flower: 33, sodium_plant: 34, oxygen_plant: 35, special_plant: 36,
  dihydro: 37, cactus_side: 38, cactus_top: 39, mushroom_stem: 40, mushroom_cap: 41,
  cloud: 42, chest_side: 43, chest_top: 44, chest_front: 45, monolith: 46, terminal: 47,
  obsidian: 48, ash: 49, rust: 50, salt: 51, gravel: 52, pod: 53, lamp: 54,
  dream_tile: 55, marble: 56, neon: 57, coral: 58, pool_deep: 59, eye: 60,
  sentinel: 61, starry: 62, chest_open: 63, pod_open: 64, acid: 65, dream_water: 66, door: 67,
  plastic_r: 68, plastic_y: 69, plastic_b: 70, plastic_w: 71, concrete: 72, shelf: 73,
  bookshelf: 74, silver: 75, tv: 76, dark_wood: 77, flesh: 78, onyx: 79,
  void: 80, emergency: 81, hull: 82, grate: 83, missing: 84,
  base_side: 85, base_top: 86, tele_side: 87, tele_top: 88, planter_side: 89, planter_top: 90, crate_side: 91, crate_top: 92,
  cook_side: 93, cook_top: 94,
};

// Tint channels. The palette of each planet supplies an RGB colour per channel.
export const TINT = {
  none: 0, grass: 1, leaf: 2, stone: 3, dirt: 4, water: 5, sand: 6, wood: 7,
  flora: 8, special: 9, crystal: 10, cap: 11,
};
export const TINT_COUNT = 12;

// Render passes
export const PASS = { opaque: 0, cutout: 1, translucent: 2 };

export const B = {
  AIR: 0, STONE: 1, DIRT: 2, GRASS: 3, SAND: 4, WATER: 5, ICE: 6, SNOW: 7, LOG: 8, LEAVES: 9,
  FERRITE_ORE: 10, COPPER_ORE: 11, GOLD_ORE: 12, URANIUM_ORE: 13, COBALT_ORE: 14, CRYSTAL: 15,
  POOL_TILE: 16, WALLPAPER: 17, CARPET: 18, CEILING_TILE: 19, LIGHT_PANEL: 20, CHECKER: 21,
  GLASS: 22, LAVA: 23, BEDROCK: 24, DREAM_BLOCK: 25, METAL_PLATE: 26, METAL_PANEL: 27,
  BRICK: 28, PLANKS: 29, TALLGRASS: 30, FLOWER: 31, SODIUM_PLANT: 32, OXYGEN_PLANT: 33,
  SPECIAL_PLANT: 34, DIHYDRO: 35, CACTUS: 36, MUSHROOM_STEM: 37, MUSHROOM_CAP: 38, CLOUD: 39,
  CHEST: 40, MONOLITH: 41, TERMINAL: 42, OBSIDIAN: 43, ASH: 44, RUST: 45, SALT: 46, GRAVEL: 47,
  POD: 48, LAMP: 49, DREAM_TILE: 50, MARBLE: 51, NEON: 52, CORAL: 53, POOL_DEEP: 54, EYE: 55,
  LIT_AIR: 56, SENTINEL_PILLAR: 57, SNOW_GRASS: 58, STARRY: 59, CHEST_OPEN: 60, POD_OPEN: 61,
  ACID: 62, DREAM_WATER: 63, DREAM_DOOR: 64,
  PLASTIC_R: 65, PLASTIC_Y: 66, PLASTIC_B: 67, PLASTIC_W: 68, CONCRETE: 69, SHELF: 70,
  BOOKSHELF: 71, SILVER: 72, TV: 73, DARK_WOOD: 74, FLESH: 75, ONYX: 76,
  VOID: 77, EMERGENCY: 78, HULL: 79, GRATE: 80, MISSING: 81,
  BASE_CORE: 82, TELEPORTER: 83, PLANTER: 84, STORAGE: 85, NUTRIENT: 86,
};

const T = TILE;
// def(name, tiles[top,bottom,side,front?], opts)
function def(name, tiles, o = {}) {
  return {
    name,
    tiles: Array.isArray(tiles) ? tiles : [tiles, tiles, tiles],
    pass: o.pass ?? PASS.opaque,
    solid: o.solid ?? true,
    tint: o.tint ?? TINT.none,
    sideTint: o.sideTint, // optional different tint for side faces
    emissive: o.emissive ?? 0,
    hardness: o.hardness ?? 0.6,
    drops: o.drops ?? [],
    shape: o.shape ?? 'cube',
    liquid: o.liquid ?? false,
    collect: o.collect ?? true,
    interact: o.interact ?? null,
    color: o.color ?? [0.6, 0.6, 0.6], // representative colour for particles/UI
    hazard: o.hazard ?? 0,
    unbreakable: o.unbreakable ?? false,
    restricted: o.restricted ?? false, // sentinels dislike it being mined
  };
}

export const BLOCKS = [];
BLOCKS[B.AIR] = def('Air', T.stone, { solid: false, collect: false, hardness: 0 });
BLOCKS[B.STONE] = def('Stone', T.stone, { tint: TINT.stone, drops: [['ferrite', 2, 3]], color: [0.5, 0.5, 0.52] });
BLOCKS[B.DIRT] = def('Soil', T.dirt, { tint: TINT.dirt, hardness: 0.35, drops: [['silicate', 1, 2]], color: [0.45, 0.33, 0.22] });
BLOCKS[B.GRASS] = def('Turf', [T.grass_top, T.dirt, T.grass_side], { tint: TINT.grass, hardness: 0.4, drops: [['silicate', 1, 1], ['carbon', 0, 1]], color: [0.35, 0.6, 0.3] });
BLOCKS[B.SAND] = def('Sand', T.sand, { tint: TINT.sand, hardness: 0.3, drops: [['silicate', 2, 3]], color: [0.85, 0.78, 0.55] });
BLOCKS[B.WATER] = def('Water', T.water, { pass: PASS.translucent, solid: false, liquid: true, tint: TINT.water, collect: false, hardness: 0, color: [0.2, 0.45, 0.8] });
BLOCKS[B.ICE] = def('Ice', T.ice, { hardness: 0.5, drops: [['dihydrogen', 1, 2]], color: [0.7, 0.85, 1.0], emissive: 0.05 });
BLOCKS[B.SNOW] = def('Snow', T.snow, { hardness: 0.25, drops: [['dihydrogen', 0, 1]], color: [0.95, 0.97, 1.0] });
BLOCKS[B.LOG] = def('Stem', [T.log_top, T.log_top, T.log_side], { tint: TINT.wood, hardness: 0.8, drops: [['carbon', 3, 5]], color: [0.45, 0.3, 0.2] });
BLOCKS[B.LEAVES] = def('Foliage', T.leaves, { pass: PASS.cutout, tint: TINT.leaf, hardness: 0.15, drops: [['carbon', 1, 2]], color: [0.3, 0.7, 0.3] });
BLOCKS[B.FERRITE_ORE] = def('Ferrite Deposit', T.ore_ferrite, { tint: TINT.stone, hardness: 1.0, drops: [['pure_ferrite', 3, 5]], color: [0.7, 0.7, 0.75] });
BLOCKS[B.COPPER_ORE] = def('Copper Deposit', T.ore_copper, { tint: TINT.stone, hardness: 1.1, drops: [['copper', 3, 5]], color: [0.85, 0.5, 0.25] });
BLOCKS[B.GOLD_ORE] = def('Gold Deposit', T.ore_gold, { tint: TINT.stone, hardness: 1.2, drops: [['gold', 2, 4]], color: [0.95, 0.8, 0.3] });
BLOCKS[B.URANIUM_ORE] = def('Uranium Deposit', T.ore_uranium, { tint: TINT.stone, hardness: 1.2, emissive: 0.25, drops: [['uranium', 3, 5]], color: [0.4, 0.95, 0.35] });
BLOCKS[B.COBALT_ORE] = def('Cobalt Deposit', T.ore_cobalt, { tint: TINT.stone, hardness: 1.1, drops: [['cobalt', 3, 5]], color: [0.3, 0.45, 0.95] });
BLOCKS[B.CRYSTAL] = def('Chroma Crystal', T.crystal, { tint: TINT.crystal, hardness: 0.9, emissive: 0.55, drops: [['chroma_shard', 1, 2], ['silicate', 1, 2]], color: [0.8, 0.5, 1.0] });
BLOCKS[B.POOL_TILE] = def('Pool Tile', T.pool_tile, { hardness: 1.0, drops: [['silicate', 1, 1]], color: [0.92, 0.95, 0.97] });
BLOCKS[B.WALLPAPER] = def('Yellow Wallpaper', T.wallpaper, { hardness: 0.8, drops: [['carbon', 1, 1]], color: [0.85, 0.78, 0.45] });
BLOCKS[B.CARPET] = def('Damp Carpet', T.carpet, { hardness: 0.5, drops: [['carbon', 1, 1]], color: [0.7, 0.62, 0.42] });
BLOCKS[B.CEILING_TILE] = def('Ceiling Tile', T.ceiling_tile, { hardness: 0.5, drops: [['silicate', 1, 1]], color: [0.88, 0.86, 0.8] });
BLOCKS[B.LIGHT_PANEL] = def('Fluorescent Panel', T.light_panel, { hardness: 0.6, emissive: 1.0, drops: [['sodium', 1, 2]], color: [1.0, 1.0, 0.92] });
BLOCKS[B.CHECKER] = def('Checker Tile', T.checker, { hardness: 0.9, drops: [['silicate', 1, 1]], color: [0.5, 0.5, 0.5] });
BLOCKS[B.GLASS] = def('Glass', T.glass, { pass: PASS.cutout, hardness: 0.4, drops: [['silicate', 1, 1]], color: [0.8, 0.9, 1.0] });
BLOCKS[B.LAVA] = def('Magma', T.lava, { pass: PASS.translucent, solid: false, liquid: true, emissive: 1.0, collect: false, hardness: 0, hazard: 30, color: [1.0, 0.45, 0.1] });
BLOCKS[B.BEDROCK] = def('Dream Floor', T.bedrock, { hardness: 999, unbreakable: true, collect: false, color: [0.15, 0.12, 0.2] });
BLOCKS[B.DREAM_BLOCK] = def('Reverie Block', T.dream, { hardness: 0.7, emissive: 0.35, drops: [['chroma_shard', 0, 1]], color: [0.95, 0.7, 0.9] });
BLOCKS[B.METAL_PLATE] = def('Metal Plating', T.metal_plate, { hardness: 1.5, drops: [['ferrite', 2, 3]], color: [0.62, 0.64, 0.68] });
BLOCKS[B.METAL_PANEL] = def('Hull Panel', T.metal_panel, { hardness: 1.5, drops: [['ferrite', 2, 3]], color: [0.35, 0.37, 0.42] });
BLOCKS[B.BRICK] = def('Terracotta Brick', T.brick, { hardness: 1.0, drops: [['silicate', 1, 2]], color: [0.7, 0.35, 0.28] });
BLOCKS[B.PLANKS] = def('Planks', T.planks, { hardness: 0.6, drops: [['carbon', 1, 2]], color: [0.7, 0.55, 0.35] });
BLOCKS[B.TALLGRASS] = def('Grass Tuft', T.tallgrass, { pass: PASS.cutout, solid: false, shape: 'cross', tint: TINT.grass, hardness: 0.05, drops: [['carbon', 1, 1]], color: [0.35, 0.65, 0.3] });
BLOCKS[B.FLOWER] = def('Bloom', T.flower, { pass: PASS.cutout, solid: false, shape: 'cross', tint: TINT.flora, hardness: 0.05, drops: [['carbon', 1, 2]], color: [0.9, 0.4, 0.7] });
BLOCKS[B.SODIUM_PLANT] = def('Sodium Bulb', T.sodium_plant, { pass: PASS.cutout, solid: false, shape: 'cross', emissive: 0.8, hardness: 0.1, drops: [['sodium', 4, 7]], color: [1.0, 0.85, 0.2] });
BLOCKS[B.OXYGEN_PLANT] = def('Oxygen Pod', T.oxygen_plant, { pass: PASS.cutout, solid: false, shape: 'cross', emissive: 0.2, hardness: 0.1, drops: [['oxygen', 4, 7]], color: [0.95, 0.25, 0.25] });
BLOCKS[B.SPECIAL_PLANT] = def('Native Flora', T.special_plant, { pass: PASS.cutout, solid: false, shape: 'cross', tint: TINT.special, emissive: 0.35, hardness: 0.1, drops: [['@special', 3, 6]], color: [0.9, 0.9, 0.4] });
BLOCKS[B.DIHYDRO] = def('Di-hydrogen Crystal', T.dihydro, { pass: PASS.cutout, solid: false, shape: 'cross', emissive: 0.6, hardness: 0.15, drops: [['dihydrogen', 5, 8]], color: [0.3, 0.6, 1.0] });
BLOCKS[B.CACTUS] = def('Cactus', [T.cactus_top, T.cactus_top, T.cactus_side], { tint: TINT.leaf, hardness: 0.4, drops: [['carbon', 2, 3]], color: [0.3, 0.6, 0.3] });
BLOCKS[B.MUSHROOM_STEM] = def('Fungal Stalk', T.mushroom_stem, { hardness: 0.5, drops: [['carbon', 2, 3]], color: [0.9, 0.88, 0.8] });
BLOCKS[B.MUSHROOM_CAP] = def('Fungal Cap', T.mushroom_cap, { tint: TINT.cap, hardness: 0.3, emissive: 0.15, drops: [['carbon', 2, 3]], color: [0.8, 0.3, 0.5] });
BLOCKS[B.CLOUD] = def('Cloud', T.cloud, { hardness: 0.2, drops: [['oxygen', 1, 2]], color: [1, 1, 1] });
BLOCKS[B.CHEST] = def('Dream Cache', [T.chest_top, T.chest_top, T.chest_front], { hardness: 999, unbreakable: true, collect: false, interact: 'chest', emissive: 0.2, color: [0.8, 0.6, 0.3] });
BLOCKS[B.MONOLITH] = def('Monolith', T.monolith, { hardness: 999, unbreakable: true, collect: false, interact: 'monolith', emissive: 0.3, color: [0.1, 0.1, 0.15] });
BLOCKS[B.TERMINAL] = def('Terminal', [T.metal_plate, T.metal_plate, T.terminal], { hardness: 999, unbreakable: true, collect: false, interact: 'terminal', emissive: 0.4, color: [0.3, 0.9, 0.8] });
BLOCKS[B.OBSIDIAN] = def('Obsidian', T.obsidian, { hardness: 1.6, drops: [['ferrite', 1, 2], ['silicate', 1, 2]], color: [0.12, 0.08, 0.18] });
BLOCKS[B.ASH] = def('Ash', T.ash, { hardness: 0.3, drops: [['silicate', 1, 1], ['carbon', 0, 1]], color: [0.4, 0.38, 0.38] });
BLOCKS[B.RUST] = def('Rust Soil', T.rust, { hardness: 0.4, drops: [['ferrite', 1, 2]], color: [0.6, 0.3, 0.2] });
BLOCKS[B.SALT] = def('Salt Flat', T.salt, { hardness: 0.4, drops: [['sodium', 1, 3]], color: [0.95, 0.93, 0.9] });
BLOCKS[B.GRAVEL] = def('Gravel', T.gravel, { tint: TINT.stone, hardness: 0.4, drops: [['ferrite', 1, 2]], color: [0.5, 0.48, 0.47] });
BLOCKS[B.POD] = def('Exosuit Pod', [T.metal_plate, T.metal_plate, T.pod], { hardness: 999, unbreakable: true, collect: false, interact: 'pod', emissive: 0.5, color: [0.4, 0.9, 1.0] });
BLOCKS[B.LAMP] = def('Dream Lamp', T.lamp, { hardness: 0.4, emissive: 1.0, drops: [['sodium', 1, 1]], color: [1.0, 0.9, 0.7] });
BLOCKS[B.DREAM_TILE] = def('Pastel Tile', T.dream_tile, { hardness: 0.8, drops: [['silicate', 1, 1]], color: [0.98, 0.78, 0.86] });
BLOCKS[B.MARBLE] = def('Marble', T.marble, { hardness: 1.0, drops: [['silicate', 1, 2]], color: [0.93, 0.93, 0.95] });
BLOCKS[B.NEON] = def('Neon Strip', T.neon, { hardness: 0.6, emissive: 1.0, drops: [['chroma_shard', 0, 1]], color: [1.0, 0.4, 0.9] });
BLOCKS[B.CORAL] = def('Coral Growth', T.coral, { tint: TINT.flora, hardness: 0.5, emissive: 0.15, drops: [['carbon', 1, 2], ['sodium', 0, 1]], color: [0.95, 0.5, 0.6] });
BLOCKS[B.POOL_DEEP] = def('Deep Tile', T.pool_deep, { hardness: 1.0, drops: [['silicate', 1, 1]], color: [0.3, 0.55, 0.8] });
BLOCKS[B.EYE] = def('Watcher', T.eye, { hardness: 1.0, emissive: 0.4, drops: [['chroma_shard', 1, 2]], color: [0.95, 0.95, 0.9] });
BLOCKS[B.LIT_AIR] = def('Air', T.stone, { solid: false, collect: false, hardness: 0 });
BLOCKS[B.SENTINEL_PILLAR] = def('Sentinel Pillar', [T.metal_plate, T.metal_plate, T.sentinel], { hardness: 2.0, emissive: 0.5, restricted: true, drops: [['pugneum', 3, 6]], color: [0.9, 0.2, 0.2] });
BLOCKS[B.SNOW_GRASS] = def('Snowy Turf', [T.snow, T.dirt, T.snow_side], { hardness: 0.4, drops: [['silicate', 1, 1]], color: [0.95, 0.97, 1.0] });
BLOCKS[B.STARRY] = def('Night Fragment', T.starry, { hardness: 0.8, emissive: 0.6, drops: [['chroma_shard', 1, 1]], color: [0.2, 0.15, 0.4] });
BLOCKS[B.CHEST_OPEN] = def('Empty Cache', [T.chest_open, T.chest_top, T.chest_side], { hardness: 0.8, drops: [['carbon', 2, 3]], color: [0.7, 0.55, 0.3] });
BLOCKS[B.POD_OPEN] = def('Spent Pod', [T.metal_plate, T.metal_plate, T.pod_open], { hardness: 1.2, drops: [['ferrite', 2, 4]], color: [0.5, 0.55, 0.6] });
BLOCKS[B.ACID] = def('Acid', T.acid, { pass: PASS.translucent, solid: false, liquid: true, emissive: 0.4, collect: false, hardness: 0, hazard: 12, color: [0.5, 1.0, 0.2] });
BLOCKS[B.DREAM_DOOR] = def('Dream Door', [T.dream_tile, T.dream_tile, T.door], { hardness: 999, unbreakable: true, collect: false, interact: 'door', emissive: 0.35, color: [1.0, 0.8, 0.9] });
BLOCKS[B.PLASTIC_R] = def('Red Plastic', T.plastic_r, { hardness: 0.5, drops: [['carbon', 1, 2]], color: [0.9, 0.2, 0.22] });
BLOCKS[B.PLASTIC_Y] = def('Yellow Plastic', T.plastic_y, { hardness: 0.5, drops: [['carbon', 1, 2]], color: [0.98, 0.82, 0.2] });
BLOCKS[B.PLASTIC_B] = def('Blue Plastic', T.plastic_b, { hardness: 0.5, drops: [['carbon', 1, 2]], color: [0.2, 0.45, 0.95] });
BLOCKS[B.PLASTIC_W] = def('White Plastic', T.plastic_w, { hardness: 0.5, drops: [['carbon', 1, 2]], color: [0.95, 0.95, 0.95] });
BLOCKS[B.CONCRETE] = def('Concrete', T.concrete, { hardness: 1.1, drops: [['silicate', 1, 2], ['ferrite', 0, 1]], color: [0.62, 0.62, 0.6] });
BLOCKS[B.SHELF] = def('Warehouse Shelf', [T.planks, T.planks, T.shelf], { hardness: 0.6, drops: [['carbon', 1, 2], ['ferrite', 0, 1]], color: [0.6, 0.5, 0.35] });
BLOCKS[B.BOOKSHELF] = def('Endless Shelf', [T.dark_wood, T.dark_wood, T.bookshelf], { hardness: 0.7, drops: [['carbon', 2, 3], ['memory_fragment', 0, 1]], color: [0.45, 0.3, 0.22] });
BLOCKS[B.SILVER] = def('Memory Silver', T.silver, { hardness: 1.2, emissive: 0.15, drops: [['ferrite', 1, 2], ['chroma_shard', 0, 1]], color: [0.85, 0.87, 0.9] });
BLOCKS[B.TV] = def('Static Television', [T.dark_wood, T.dark_wood, T.tv], { hardness: 0.8, emissive: 0.6, drops: [['static_bloom', 0, 1], ['silicate', 1, 2]], color: [0.7, 0.7, 0.72] });
BLOCKS[B.DARK_WOOD] = def('Dark Wood', T.dark_wood, { hardness: 0.7, drops: [['carbon', 2, 3]], color: [0.3, 0.2, 0.15] });
BLOCKS[B.FLESH] = def('Flesh', T.flesh, { hardness: 0.4, drops: [['mordite', 1, 2]], color: [0.75, 0.4, 0.42] });
BLOCKS[B.ONYX] = def('Onyx', T.onyx, { hardness: 1.4, drops: [['ferrite', 1, 2], ['cobalt', 0, 1]], color: [0.08, 0.07, 0.1] });
BLOCKS[B.DREAM_WATER] = def('Dream Water', T.dream_water, { pass: PASS.translucent, solid: false, liquid: true, emissive: 0.15, collect: false, hardness: 0, color: [0.95, 0.6, 0.85] });
BLOCKS[B.VOID] = def('Void', T.void, { emissive: 1, unbreakable: true, hardness: 99, color: [0.01, 0.01, 0.02] });
BLOCKS[B.EMERGENCY] = def('Emergency Light', T.emergency, { emissive: 1, hardness: 0.5, drops: [['sodium', 1, 2]], color: [1, 0.15, 0.1] });
BLOCKS[B.HULL] = def('Derelict Hull', T.hull, { hardness: 1.3, drops: [['ferrite', 1, 3], ['salvage', 0, 1]], color: [0.25, 0.24, 0.26] });
BLOCKS[B.GRATE] = def('Floor Grating', T.grate, { hardness: 0.9, drops: [['ferrite', 1, 2]], color: [0.3, 0.31, 0.33] });
BLOCKS[B.MISSING] = def('?', T.missing, { emissive: 0.4, hardness: 0.3, drops: [['memory_fragment', 0, 1]], color: [1, 0, 1] });
// base building
BLOCKS[B.BASE_CORE] = def('Base Computer', [T.base_top, T.metal_plate, T.base_side], { hardness: 1.2, emissive: 0.45, interact: 'basecore', drops: [['ferrite', 2, 4]], color: [0.3, 0.85, 1.0] });
BLOCKS[B.TELEPORTER] = def('Teleporter', [T.tele_top, T.metal_plate, T.tele_side], { hardness: 1.2, emissive: 0.6, interact: 'teleporter', drops: [['ferrite', 2, 4]], color: [0.7, 0.5, 1.0] });
BLOCKS[B.PLANTER] = def('Dream Planter', [T.planter_top, T.metal_plate, T.planter_side], { hardness: 0.9, emissive: 0.15, interact: 'planter', drops: [['ferrite', 1, 2]], color: [0.35, 0.6, 0.3] });
BLOCKS[B.STORAGE] = def('Storage Crate', [T.crate_top, T.crate_top, T.crate_side], { hardness: 0.9, interact: 'storage', drops: [['ferrite', 1, 2]], color: [0.9, 0.6, 0.2] });
BLOCKS[B.NUTRIENT] = def('Nutrient Processor', [T.cook_top, T.metal_plate, T.cook_side], { hardness: 0.9, emissive: 0.35, interact: 'cook', drops: [['ferrite', 1, 2]], color: [1.0, 0.55, 0.3] });

export const BLOCK_COUNT = BLOCKS.length;

// Fast lookup tables
export const IS_SOLID = new Uint8Array(256);
export const IS_OPAQUE = new Uint8Array(256); // fully occludes neighbours
export const BLOCK_PASS = new Uint8Array(256);
export const IS_CROSS = new Uint8Array(256);
export const IS_LIQUID = new Uint8Array(256);
export const BLOCK_TINT = new Uint8Array(256);
export const BLOCK_EMIT = new Float32Array(256);
export const IS_AIRLIKE = new Uint8Array(256);

for (let i = 0; i < BLOCKS.length; i++) {
  const b = BLOCKS[i];
  if (!b) continue;
  IS_SOLID[i] = b.solid ? 1 : 0;
  BLOCK_PASS[i] = b.pass;
  IS_CROSS[i] = b.shape === 'cross' ? 1 : 0;
  IS_LIQUID[i] = b.liquid ? 1 : 0;
  BLOCK_TINT[i] = b.tint;
  BLOCK_EMIT[i] = b.emissive;
  IS_OPAQUE[i] = (b.pass === PASS.opaque && b.shape === 'cube' && i !== B.AIR && i !== B.LIT_AIR) ? 1 : 0;
  IS_AIRLIKE[i] = (i === B.AIR || i === B.LIT_AIR) ? 1 : 0;
}

// Blocks that can be placed from the block bag (everything collectible)
export function isPlaceable(id) {
  const b = BLOCKS[id];
  return !!b && b.collect && id !== B.AIR && id !== B.LIT_AIR;
}
