// "The Lucid Path" - a guided journey from crash site to the Dream Core.

export const QUESTS = [
  {
    id: 'awaken', title: 'Awaken',
    desc: 'You wake beside your crashed starship. Mine rocks with the Mining Beam (hold LMB) to gather 50 Ferrite Dust.',
    check: (g) => g.inventory.count('ferrite') >= 50 || g.inventory.count('metal_plating') > 0 || g.ship.thrustersRepaired,
    progress: (g) => `Ferrite Dust ${Math.min(50, g.inventory.count('ferrite'))}/50`,
  },
  {
    id: 'plating', title: 'Metal Plating',
    desc: 'Open your inventory (Tab) → Fabricate → Products, and craft Metal Plating from 50 Ferrite Dust.',
    check: (g) => g.inventory.count('metal_plating') > 0 || g.ship.thrustersRepaired,
  },
  {
    id: 'hydrogen', title: 'Blue Crystals',
    desc: 'Press F to pulse your scanner. Harvest 40 Di-hydrogen from blue crystals, then fabricate Di-hydrogen Jelly.',
    check: (g) => g.inventory.count('dihydrogen_jelly') > 0 || g.ship.thrustersRepaired,
    progress: (g) => `Di-hydrogen ${Math.min(40, g.inventory.count('dihydrogen'))}/40`,
  },
  {
    id: 'repair', title: 'Repair the Thrusters',
    desc: 'Inventory (Tab) → Technology → Repair Launch Thrusters.',
    check: (g) => g.ship.thrustersRepaired,
  },
  {
    id: 'takeoff', title: 'Leave the Ground',
    desc: 'Walk to your ship and board it (E). Press Space to take off, then climb (mouse, W) until you break through the atmosphere.',
    check: (g) => !!g.state.flags.reachedSpace,
  },
  {
    id: 'station', title: 'The Station',
    desc: 'Hold Space in space to engage the Pulse Drive. Fly to the Space Station and press E near its glowing bay to dock.',
    check: (g) => !!g.state.flags.docked,
  },
  {
    id: 'warpcell', title: 'A Way Between Stars',
    desc: 'Fabricate a Warp Cell (Antimatter + Antimatter Housing), buy one at a station - or dream a Lucid Core through Apotheosis (Tab).',
    check: (g) => g.inventory.count('warp_cell') + g.inventory.count('lucid_core') > 0 || g.state.jumps > 0,
  },
  {
    id: 'jump', title: 'The First Jump',
    desc: 'In space, open the Galaxy Map (M), select a star within range and initiate a warp.',
    check: (g) => g.state.jumps > 0,
  },
  {
    id: 'core', title: 'Toward the Dream Core',
    desc: 'The Dream Core waits at the heart of the galaxy. Keep jumping toward it. Explore, trade and dream along the way.',
    check: (g) => !!g.state.flags.reachedCore,
    progress: (g) => `Distance: ${g.coreDistanceLabel()}`,
  },
  {
    id: 'free', title: 'Lucid',
    desc: 'You have reached the heart of the dream. The galaxy is yours - keep exploring, building and dreaming.',
    check: () => false,
  },
];
