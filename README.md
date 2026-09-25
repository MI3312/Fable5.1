# LUCID SKY

*An infinite dream of blocks and stars.*

LUCID SKY is a browser game built with **three.js + WebGL2** that mixes **No Man's Sky**
(procedural galaxy, planets, starships, scanning, survival, crafting, a journey to the
galactic centre) with **Lucid Blocks** (dreamlike voxel worlds, liminal architecture,
block-by-block building and dream alchemy).

Every star system, planet, creature and building is generated from a single seed.

## Running it

The game is plain ES modules with no build step. It must be served over HTTP, because
browsers block ES modules and module workers on `file://` URLs.

```bash
npm install     # only needed for the optional build/vendor tools
npm start       # serves the folder at http://localhost:8080
# or: python3 -m http.server 8080
```

Then open <http://localhost:8080>.

**Single-file build:** `npm run build` writes `dist/lucid-sky.html`, a single HTML file
with the game, three.js, the terrain worker and all CSS inlined. It runs by
double-clicking it, with no server.

Requirements: a WebGL2 browser (current Chrome, Edge, Firefox or Safari). A GPU is
strongly recommended.

## What's in the dream

**Universe**
- A galaxy of seeded star systems (8 star classes), each with 2 to 5 planets, a space station and an asteroid field.
- Nine planet biomes: Lush, Frozen, Scorched, Toxic, Irradiated, Barren, Exotic, **Liminal** and Dead. Each has its own palette, sky, terrain shape, flora, fauna, weather, hazards and Sentinel level.
- Planets are infinite voxel worlds, streamed in 16×16×128 chunks by Web Workers. Terrain includes rolling hills, ridged mountains, mesas, overhangs, caves, floating islands, spires and craters. Fake planetary curvature makes each world feel like a small sphere.
- From orbit, planets are voxel-shaded spheres with oceans, ice caps, atmospheres and rings. Where you enter a planet decides where you land and what time of day it is there.

**Lucid Blocks side**
- Liminal structures generated on every world: **Poolrooms** (tiled halls with still water), **The Backrooms** (maze generator, damp carpet, humming lights), **Endless Hallways**, **Plastic Cities**, **Abandoned Warehouses**, **Reverie Arches**, **Stairways to Nowhere** and **Watcher Shrines**.
- **Dream Doors** stand in liminal places. Step through one and you come out somewhere else on the planet.
- Dream-horror fauna: **Manikins** only move while you aren't looking at them, and **Colossal Spiders** have legs longer than they should be. Feed a creature and it becomes a **companion** that follows you.
- Builder mode: break any block to carry it in your block bag, then place it anywhere in the galaxy. Placed blocks take on the colours of whichever world they are placed in.
- **Apotheosis (dream alchemy)**: fuse any two items to discover 26 hidden recipes, such as Liquid Light, Somnium Sand, Echo Shells, Dream Lenses and Lucid Cores. Some recipes make blocks or bring back memories.
- A pastel dream filter (chromatic fringe, grain, vignette), dream aurora skies, whispers on liminal worlds, and a generative ambient score.

**No Man's Sky side**
- Multi-tool with three modes: **Mining Beam** (with overheating), **Builder** and **Boltcaster**. The **Scanner** pulse (F) and the **Analysis Visor** (V) catalogue fauna and flora for units and nanites.
- Survival: health, shield, hazard protection (heat, cold, toxic, radiation, vacuum), life support and jetpack. Storms and shelter both matter.
- Procedural creatures with six body plans and passive, skittish, curious or aggressive temperaments. You can feed them, and they will give you resources in return.
- Sentinel drones get suspicious of heavy mining. They attack when provoked and follow a 3-star wanted system.
- Your starship lands, takes off, flies in atmosphere, leaves the planet and uses a pulse drive in space. Its cannons break asteroids for Tritium.
- **Walkable space stations**: dock, land in the hangar and walk through a liminal lobby with a pool, marble columns, fluorescent ceilings, windows onto space and NPC travellers. Terminals handle trade, supplies, a tech merchant, services and the save archive.
- **Nightmares**: hostile dream-ships ambush you in space and block your pulse drive. Shoot them down, or lose your hull and get towed back to the station.
- A refiner and fabricator with more than 40 recipes, plus technology upgrades for the exosuit and ship.
- Galaxy map with hyperdrive warps powered by Warp Cells (or dreamed Lucid Cores).
- Points of interest: monoliths with lore, terminals, drop pods (inventory slots), dream caches and Sentinel pillars.
- **The Lucid Path** questline takes you from repairing your crashed ship to reaching the **Dream Core** at the centre of the galaxy.
- Autosave and manual save to `localStorage`, including every block you change on every planet.

## Controls

| Key | Action |
|---|---|
| WASD | Move / throttle and roll the ship |
| Mouse | Look / steer the ship |
| Space | Jump · hold for jetpack · take off · hold in space for the pulse drive |
| Shift | Sprint / boost |
| LMB | Use tool (mine, collect block, fire) · ship cannons |
| RMB | Place block (Builder) |
| Q | Cycle multi-tool mode |
| 1–9, Wheel | Select hotbar block |
| F | Scanner pulse |
| V | Analysis visor (hold LMB on creatures or plants) |
| E | Interact · board or exit ship · land · dock |
| R | Quick-recharge life support and hazard protection |
| T | Headlamp |
| Tab / I | Inventory, fabrication, alchemy, technology, discoveries, journey |
| M | Galaxy map |
| F2 | Hide HUD |
| Esc | Pause |

## Project layout

```
index.html, css/            page shell and UI styles
lib/three.module.min.js     vendored three.js r186 (npm run vendor regenerates it)
src/core/                   seeded RNG, simplex noise, names, input, shader helpers
src/data/                   items, biomes, recipes and alchemy, lore
src/universe/               galaxy, star system and planet generation
src/world/                  blocks, texture atlas, terrain and structures, mesher, worker, chunk manager
src/surface/                sky, clouds, weather, effects
src/entities/               player, ship, creatures, sentinels, models
src/space/                  space scene, planet shaders
src/game/                   game controller, surface and space modes, inventory, quests
src/ui/                     HUD, menus, galaxy map
src/audio/                  procedural WebAudio music and SFX
src/post/                   post-processing
tools/                      single-file build and three.js vendoring
```
