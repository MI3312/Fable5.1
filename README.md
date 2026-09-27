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

**Single-file build:** `npm install` (once, for esbuild and three), then `npm run build`, writes `dist/lucid-sky.html`, a single HTML file
with the game, three.js, the terrain worker and all CSS inlined. It runs by
double-clicking it, with no server.

Requirements: a WebGL2 browser (current Chrome, Edge, Firefox or Safari). A GPU is
strongly recommended.

## Multiplayer

Dreams can be shared. One player hosts their universe and others join it as guests. Everyone
walks, builds, flies, drives and fishes in the same world, and sees each other's block edits.

**How to play together**

1. Every player runs the desktop app (below) on their own computer, signed in to their own Steam
   account, with Steam open.
2. The host starts or continues a game, then opens **Esc → Multiplayer → Host this dream**.
   A short **dream code** appears (for example `HNC4R`), with a Copy button.
3. Friends open **Multiplayer** (on the title screen or in the pause menu), type the code under
   **Join with a code**, and press **Join**. They arrive next to the host as their own character.
   On Steam they can also use *Join Game* on the host's profile.

The code matters because Steam's test app 480 is shared by thousands of games, so a lobby list
rarely shows your friend's dream. Nobody can pause a shared dream: the inventory, terminals and
menus all keep the world running (only single-player pauses).

- **Online through Steam:** run the game in the desktop shell in [`desktop/`](desktop/README.md).
  It uses Steamworks (app ID **480**, Valve's Spacewar test app) for lobbies and *Join Game*, and
  sends P2P traffic over **Steam Datagram Relay**, so nobody needs to forward ports.

  ```bash
  cd desktop && npm install && npm start   # Steam must be running
  ```

  On Windows laptops the shell registers itself for the dedicated GPU automatically. Settings shows
  which GPU the game is using. See [`desktop/README.md`](desktop/README.md) for details.

  `npm start` launches the prebuilt `dist/lucid-sky.html`. If it's missing or out of date, it
  installs the root build tools and rebuilds it first; `npm run start:fresh` always rebuilds.

- **Browser test mode:** in a plain browser, the Multiplayer menu uses a `BroadcastChannel`. That
  only links tabs of the **same browser on one computer**, which is useful for trying it out alone
  but not for playing with friends.

The Multiplayer menu also shows where everyone is, with **Travel to** for a friend on another
world, in another system or docked at a station. In stations each player docks on their own pad.

The host's world is canonical. The host keeps every block change on every planet and sends it to
anyone who lands there. Guests keep their own character in a save slot for that host's seed, and
their own journey is untouched when they leave. Players stream positions ~12×/s with interpolation.
The time of day follows the host's.

Social keys: **Enter** chat, **Z** ping where you look, **B** wave. Name tags and markers show
where everyone is. Other players' ships (their real class and paint), Roamers and fishing lines
are drawn in your world. Creatures are still simulated separately on each machine.

## What's in the dream

**Universe**
- A galaxy of seeded star systems (8 star classes), each with 2 to 5 planets, a space station and an asteroid field.
- Nine planet biomes: Lush, Frozen, Scorched, Toxic, Irradiated, Barren, Exotic, **Liminal** and Dead. Each has its own palette, sky, terrain shape, flora, fauna, weather, hazards and Sentinel level.
- Planets are infinite voxel worlds, streamed in 16×16×128 chunks by Web Workers. Terrain includes rolling hills, ridged mountains, mesas, overhangs, caves, floating islands, spires and craters. Fake planetary curvature makes each world feel like a small sphere.
- From orbit, planets are voxel-shaded spheres with oceans, ice caps, atmospheres and rings. Where you enter a planet decides where you land and what time of day it is there.

**Liminality, fog and mystery**
- **Atmosphere**: every planet has its own fog profile. There is exponential haze, a low ground mist that drifts on noise and pools in valleys, and a horizon that dissolves into mist instead of ending in a line. Lamps, TVs and light panels glow as dynamic point lights with halos in the fog. Caves and interiors swap the open-air mist for a dim indoor haze.
- **Dream zones**: whole regions of a world have slipped into liminal space, laid out as Worley cells with soft borders. Each zone has its own air: fog colour, density, mist and light.
  - **Fog Meadow**: tall grass to the end of the world.
  - **The Poolscape**: tiles, still water and fluorescent roofs.
  - **Tile Void**: floor tiles floating over a starry abyss.
  - **Memory**: a silver lattice hanging in white.
  - **The Infinite Library**: bookshelf rooms, lamps and pits into the void.
  - **Plastic District**: bright, hollow toy buildings.
  - **The Lines**: beams drawn across the sky.
  - **Naraka**: warm flesh ground, onyx graves and spires under a blood-red fog.
- **Underground Eden**: an endless backrooms layer under liminal worlds, reached by spiral manholes.
- **Horizon giants**: colossal silhouettes stand in the haze at the edge of the world, such as hands, spires, lollipop trees, doorway cubes, Kodama heads and Preta. They move with you, so you can never reach them.
- **Lucid vermin**, modelled with signed distance fields and voxelised:
  - **Kodama**: pale spirits whose heads rattle when you come near.
  - **Preta**: impossibly tall black figures that stand at the edge of the fog and are never there when you arrive.
  - **Wildebeest**: shaggy table-backed stilt beasts.
  - **Gel**: wobbling translucent cubes with a glowing heart.
  - **BubbleBear**: round pastel bears made of fused bubbles.
- Distant, unexplained sounds such as footsteps, doors, hums and chimes. Music-box phrases play when you enter a zone, and dream music has a worn-tape warble.
- The HUD fades back after a quiet spell, so the world has the screen (you can turn this off in Settings).
- Textures are painted from mathematics: tileable fbm, Worley cells and domain-warped veins for stone, marble, onyx, flesh, silver, crystal, wood and dream tiles.

**Things in the fog**
- The dream has started to notice you. Fear is not a number on your HUD: you will hear it, and see it at the edges.
- Something pale keeps its distance. Something very large walks where the fog is thickest. Some nights are wrong.
- Your multi-tool listens. When it starts to beep, stop and look around. Your headlamp helps, sometimes.
- **Fear intensity** in Settings turns the effects down, if the dream becomes too much.

**Something else is playing**
- The longer you dream, the less the dream behaves. Keep an eye on the chat (Enter to talk; someone may answer).
- Things get built where you are not looking. Some of them have doors that are not doors.
- If the game crashes, give it a moment.

**Bigger on the inside**
- Some small buildings on liminal-touched worlds are not what they look like: a beige box with one door, a little tiled pool house, a brick doorway, a marble reading room, a locked metal shed. Walk in and follow the passage round its bend. When you turn around, the way you came in is gone.
- Inside, the space goes on forever and you can't break the walls or build your way out. You have to find the exit, and every place has its own way out and its own rules:
  - **The Backrooms**: a maze of damp carpet and yellow wallpaper. Follow the hum: it's loudest near the exit. Sometimes the lights go out. Keep your headlamp up when they do.
  - **The Poolrooms**: bright tiled halls and still water. Wet footprints lead toward the warm pool, and the way out is the drain at the very bottom. You won't be the only thing swimming.
  - **The Hallway**: one corridor, walked again and again. If anything is different, turn back. If nothing is, keep going. Get it right eight times in a row and there's a door. Get it wrong and you start again.
  - **The Endless Library**: find the three books with your name on the spine. The shelves move when nobody is looking. Walk, don't run: something in there hates noise.
  - **The Warehouse**: dark racks and pools of lamplight. Find the breaker in the office to power the loading door, then get to the daylight. Keep your torch on the mannequins.
- **Almond Water** turns up in boxes in the Backrooms. Drink it to heal and steady your nerves.
- Each visit is different; only the passage stays the same. Escaping pays well the first time. Time passes outside while you're in there.

**Derelict freighters**
- Dead ships drift in many systems (always one in your first). Fly to the hangar mouth at the stern and board.
- Procedural interiors: a grated spine corridor under red emergency lights, crew quarters, cargo holds, a medbay, a mess, labs with specimen tanks, rooms the dream has grown into, hull breaches open to space, and the bridge.
- No atmosphere: hazard protection drains everywhere aboard. Read the crew logs, since together they tell one story. Salvage what you can: Salvaged Data sells well at stations and fuses into Warp Cells.

**Creatures you can ride**
- Feed a creature to tame it, then look at it and press **E** to ride.
  - **Wildebeest** are striders that step right over walls.
  - **Gels** bound in great hops.
  - **BubbleBears** and big four-legged beasts run.
  - The **Lumen Manta** flies wherever you look: Space rises, C sinks, Shift goes fast.
- New creatures: Lumen Mantas, Lamp Moths (they cannot leave your headlamp alone at night) and glowing Lantern Snails.

**Every creature is itself**
- Herds graze together, heads down, and drift back toward each other. Spook one (or sprint through them) and the whole herd stampedes. Don't stand in the way.
- Kodama walk single file toward something forgotten and sit in a ring around it. Follow them.
- Gels hop in real arcs. Kill a big one and it splits; small ones that touch merge back together.
- BubbleBears sit and blow bubbles full of clean air. Pop them to top up life support. Don't make one too happy.
- Mantas fly in formation behind a leader, skim low over water, and sing at night.
- Moths rest flat on walls by day. Snails leave glowing trails that quicken your step, and hide in their shells if you rush them.
- Among the procedural fauna there are grazers, chargers that paw the ground before they come, mimics that walk when you walk and jump when you jump, burrowers that dive underground, flocks that roost on tree tops and scatter together, dive-bombers, pollen drifters whose pollen heals you, skitterers and ambushers.

**Hunters**
- **Sandmaw**: listens for footsteps under the ground. If the ground starts to shake, move.
- **Spitter**: a rooted pod that aims where you are going. Change direction.
- **Mote Swarm**: comes out at night for your lamp. Turn it off.
- **Carapace**: nothing gets through the front. Make it charge into something, then go for its back.
- **Lurker**: there is ore in that boulder. Be careful what you mine.
- Each drops something worth having, and each has its own alchemy.

**Graphics**
- A GPU post pipeline: screen-space ambient occlusion from the depth buffer (normals rebuilt per pixel, depth-aware blur), HDR bloom through a six-level mip chain, and sun shafts that every leaf and ridge cuts, using the depth buffer's open sky.
- **Screen-space reflections**: water, puddles and polished blocks (pool tile, marble, metal, ice, obsidian, neon, screens) reflect the world around them, traced against the last frame at half resolution. Rougher materials give blurrier reflections.
- **Clear water**: you can see the bottom of shallow water, fading to deep colour with depth, with foam where it meets the shore. Sunlight reaches down through the sea and dances as **caustics** across the sea floor and the bottoms of pools.
- **Colour mood**: the whole dream is graded like damp, overcast film. Greens sink to olive and moss, pinks and violets to dusty mauve, blues to slate; shadows go cold, blacks lift into a soft matte, and warm light (lamps, fire, a low sun) keeps its colour so it draws the eye. Surfaces are damp too: water gathers in patches, corners and streaks down walls, darkening and cooling what it soaks into, with a faint sheen on wet ground. Polished blocks and water shine less. **Colour mood** in Settings runs from Vivid (the old look) to Bleak.
- **Eye adaptation**: the exposure follows what you're looking at, so stepping out of a dark cave is briefly blinding and night lets your eyes open up. A neutral tonemapper keeps colours true instead of washing them out.
- Faces are shaded by the sun's real angle. Water has moving wave normals, fresnel sky reflections and sun glints. Ground mist lights up when you look toward the sun. Plasma sheaths, iridescent bubbles and bloom-lit glints finish the look.
- The starship is a signed-distance hull, voxelised finely: swept wings, nacelles, spine, fin, canopy and painted livery.
- **Real-time sun shadows**: a texel-snapped shadow map follows you. Terrain, trees, grass, creatures and your ship cast soft Poisson-filtered shadows that stretch long at dusk. A second, wider cascade carries the shadows of distant hills and forests out to the fog.
- **Volumetric clouds**: raymarched through a curved cloud shell with light marched toward the sun (Beer–Lambert, powder, silver-lining phase). Their shadows drift across the land. Storms thicken them, and flying through one whites out the world.
- **Volumetric light**: a raymarched pass through the shadow map puts real light shafts in the fog and dust (and a cone around your headlamp), blurred at half resolution.
- **Wind**: leaves, grass, flowers, mushroom caps and coral sway in gusts, in their shadows too. Storms make it stronger.
- **Rain**: rain soaks the ground. Surfaces darken and gloss, puddles gather in the low spots with rain rings on them, and everything dries slowly afterwards.
- A lens flare with ghosts and a halo that the depth buffer hides behind hills.
- **Graphics** in Settings chooses Low, High (AO, bloom, shadows, clouds, volumetrics) or Ultra (full-rate everything).

**Sky events**
- Lightning storms: branching bolts, the world lit white, thunder rolling in late. The strikes fuse sand to glass. Don't stand on the highest hill.
- Meteor showers on clear nights. Sometimes one lands nearby and leaves a crater full of ore.
- Aurora nights (most often on frozen worlds), and rainbows after the rain.

**The Roamer**
- Install the **Roamer Geobay** (Tech) and press **G** on any planet to deploy a rover: suspension that climbs block steps, boost slides, hops, headlights with light cones in the fog, and a roof cannon that blasts terrain straight into your cargo. It stays where you park it.

**Moment to moment**
- **Dash** (X, or double-tap a direction): a burst with two charges, one of them usable in the air. You can't be hurt while it lasts, so a well-timed dash dodges a spit or a charge.
- **Slide** (C while sprinting) keeps and boosts your speed; jump out of it to carry the momentum. In the air, C is a **ground pound**: a shockwave that hurts what's under you and breaks soft ground.
- **Vault**: hold Space at a ledge to pull yourself up to two blocks.
- **Grapple** (RMB with the Mining Beam or an idle Dream Line): a tether that bites into anything within 50u and hauls you there. Let go to fling yourself; press Space to hop off.
- **Plasma grenades** (RMB with the Boltcaster, three charges): they bounce, burst on contact with anything alive, carve a crater and haul what they break into your cargo. Stand close and the blast throws you: grenade jumps.
- Damage numbers and a hit marker for everything you hit; **H** eats the most useful thing you carry.

**Encounters**
- Every couple of minutes on a planet, something happens nearby, with a marker and a clock:
  - **Supply Drops**: a pod falls out of the sky. Open it before it dissolves; sometimes something is waiting beside it.
  - **Wisp Chases**: wisps faster than you can run. Dash, grapple and jet to catch them.
  - **Rift Surges**: waves of rift-touched creatures, then something bigger. Seal the rift.
  - **Ore Geysers**: a vein erupts from the ground. Mine it before it sinks back; your beam won't overheat near it.
- Completing them back to back builds a streak that sweetens the rewards. In a shared dream, the host's encounters are everyone's.

**Fishing and cooking**
- Install the **Dream Line** (Tech). It adds a fourth multi-tool mode (Q) that casts a glowing tether into water, dreaming pools, magma or acid.
- Wait for the bobber to dip, hook it (LMB within a second), then reel: hold LMB to pull and ease off when the fish surges, or the line snaps.
- What bites depends on the liquid, the hour, the weather and how far out you cast: Dream Minnows, Lucid Eels, Star Koi at dawn and dusk, deep-water Abyss Lanterns at night, Magma Rays, Bile Koi, Reverie Carp. Some catches are not fish.
- Build a **Nutrient Processor** and cook dishes that heal and leave a buff: *Starlight Sashimi* (swift), *Deep Eel Broth* (slow breath), *Ember Stew* and *Acid Ceviche* (weatherproof), *Cloud Cake* (buoyant jetpack), *Lantern Soup* (you glow in the dark) and *Lullaby Soup* (fear takes longer). In a shared dream, friends standing nearby when you eat get the buff too.
- An angler's log records every species and your personal bests. Missions boards post **Angler** contracts.

**Contracts**
- Station **Missions** boards post bounties on the hunters, visor surveys, expeditions into dream zones, cache runs and supply runs. Carry three at once; completing them raises your **Dreamwalker rank** and the rewards that come with it.

**Bases**
- Fabricate a **Base Computer** to claim land (Sentinels ignore mining there), **Teleporters** to link every base you own across planets and systems (your ship comes along), **Dream Planters** that grow crops while you play, and **Storage Crates**.

**Photo mode**
- Press **P**. The world holds still: fly a free camera, change the time of day, set focus and aperture for real depth of field, pick a film filter and save a PNG.

**Your ship**
- **Five classes**, each with its own hull: the **Shuttle** (a friendly box with four thruster pods), the **Fighter** (swept wings, fastest turns, hits hardest), the **Hauler** (a slab with cargo pods; slow but hard to kill), the **Explorer** (a long hull around a hyperdrive ring; the longest jumps) and the rare **Exotic** (a pearl pod inside a ring; the fastest thing in the sky). Grades C, B, A and S improve speed, handling, shields, firepower and jump range.
- Every new game starts with a different battered ship.
- **Station showroom:** four ships for sale are parked in each station's hangar, and the stock changes every half hour of play. Walk up to a kiosk to compare stats and buy one; your old ship is taken in trade and parked in that bay. Station Services has a **paint shop**.
- **Crashed starships** lie on planets with a distress beacon still calling. Repair one with a few materials and it's yours (your old ship is salvaged for units).
- You wake at a proper crash site: a scorched crater and a skid gouged through the ground, with the ship in view.
- Arriving from space is a burning atmospheric entry that levels out above the ground.
- Below 70u, a landing zone is marked ahead of you. Press E to glide in and settle, flattening whatever is growing there.

**Worlds**
- **Every start is different:** the first planet is picked from lush, frozen, barren, exotic, toxic, scorched and radioactive worlds, each with its own wake-up line and just one or two kinds of dream zone.
- Each planet picks its own few kinds of dream zone and its own set of buildings, so no two feel alike. Among them are **landmarks**: crashed starships, ruined watchtowers with a stair spiralling up inside, old observatories, giant ribcages and skulls, crystal groves over ore, standing stones and abandoned mining rigs over their pits.
- Rivers wind across worlds that have a liquid (lava rivers on scorched worlds), and dry canyons cross barren ones.
- Each planet has regions: dense forests, open clearings, rocky badlands. Bare earth and rock break through the ground cover.
- Ruins of older buildings stand in the wild, sometimes with something left inside.

**Lucid Blocks side**
- Liminal structures generated on every world: the pocket buildings (**Poolrooms**, **The Backrooms**, **Endless Hallways**, **The Endless Library** and **Abandoned Warehouses**, see *Bigger on the inside*), **Plastic Cities**, **Reverie Arches**, **Stairways to Nowhere** and **Watcher Shrines**.
- **Dream Doors** stand in liminal places. Step through one and you come out somewhere else on the planet.
- Dream-horror fauna: **Manikins** only move while you aren't looking at them, and **Colossal Spiders** have legs longer than they should be. Feed a creature and it becomes a **companion** that follows you.
- Builder mode: break any block to carry it in your block bag, then place it anywhere in the galaxy. Placed blocks take on the colours of whichever world they are placed in.
- **Apotheosis (dream alchemy)**: fuse any two items to discover 53 hidden recipes, such as Liquid Light, Somnium Sand, Echo Shells, Dream Lenses and Lucid Cores. Some recipes make liminal building blocks (bookshelves, fluorescent panels, carpet, memory silver, flesh, onyx, static televisions) or bring back memories. Vermin materials feed the dream: Gel Cores, Bubble Foam, Table Hide, and Kodama Rattles, which Kodama leave as gifts if you stand still among them.
- A pastel dream filter (chromatic fringe, grain, vignette), dream aurora skies, whispers on liminal worlds, and a generative ambient score.

**No Man's Sky side**
- Multi-tool with three modes: **Mining Beam** (with overheating), **Builder** and **Boltcaster** (and the **Dream Line**, once installed). The **Scanner** pulse (F) and the **Analysis Visor** (V) catalogue fauna and flora for units and nanites.
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

## The Tab screen

Press **Tab** (or I) for the exosuit screen. A rail down the left holds its pages, and each page says in one line what it's for.
- **Inventory**: your cargo, plus life-system bars with one-click recharges that pick the right item for you. Select anything to see what it's for (every recipe, upgrade and use, each one clickable) and where to find more (which rocks or plants, which worlds, which creatures, what refines into it).
- **Crafting**: every recipe, grouped into *Ready to make*, Refining, Components, Fuel & power, Base parts and Building blocks, with a search box. Each ingredient shows what you need and what you have, in green or red. If a part is missing but you can make it, **Make it all** does every step in order (e.g. a Warp Cell from raw copper, carbon, oxygen and ferrite).
- **Technology**: exosuit and starship upgrades, each marked Ready, Parts can be made, Missing or Installed, with **Make parts & install**. Your ship's fuel, shields and hull sit alongside, each with the fuels you carry.
- **Apotheosis**: the dream alchemy bench. It tells you before you try whether a pair is known, already failed, or untried, and what an untried pair will cost you. Your dream book lets you brew any known recipe again with a click, and failed pairs are remembered. For 30 Nanites a **whisper** will give up one of its two ingredients.
- **Blocks**: your hotbar and block bag, and the recipe to make more of any block.
- **Codex**: everything you've ever carried, searchable, with the same *what it's for / where to find more* card.
- **Discoveries** and **Journey**: this world's fauna and flora, your atlas, the next step on the Lucid Path, contracts and remembered fragments.

## Controls

| Key | Action |
|---|---|
| WASD | Move / throttle and roll the ship |
| Mouse | Look / steer the ship |
| Space | Jump · hold for jetpack · take off · hold in space for the pulse drive |
| Shift | Sprint / boost |
| LMB | Use tool (mine, collect block, fire, cast / hook / reel) · ship cannons |
| RMB | Grapple (Mining Beam, Dream Line) · plasma grenade (Boltcaster) · place block (Builder) |
| X / double-tap WASD | Dash |
| C | Slide while sprinting · ground pound in the air · sink while flying a mount |
| Space at a ledge | Vault |
| H | Eat the most useful food |
| Q | Cycle multi-tool mode |
| 1–9, Wheel | Select hotbar block |
| F | Scanner pulse |
| V | Analysis visor (hold LMB on creatures or plants) |
| E | Interact · board or exit ship · land · dock · ride / dismount a tamed creature |
| Enter or / | Chat |
| Z / B | Ping where you look / wave (multiplayer) |
| G | Deploy the Roamer (once installed) |
| L | Roamer headlights |
| P | Photo mode |
| R | Quick-recharge life support and hazard protection |
| T | Headlamp (a beam; some things do not like it) |
| Tab / I | The exosuit screen: inventory, crafting, technology, alchemy, blocks, codex, discoveries, journey |
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
src/world/                  blocks, texture atlas, terrain, dream zones, pocket spaces (Void, derelicts), liminal pockets, structures, mesher, worker, chunk manager, sun shadows
src/surface/                sky, volumetric clouds, weather, sky events, horizon giants, effects
src/entities/               player, ship, creatures and their behaviours, Lucid vermin, hunters, SDF voxel modelling, sentinels
src/space/                  space scene, planet shaders
src/game/                   game controller, surface and space modes, liminal pockets and their rules, movement kit, grenades, encounters, dread director, corruption, riding, Roamer, missions, bases, fishing, food buffs, photo mode, inventory, quests
src/net/                    multiplayer: Steam and local transports, host-authoritative session, remote avatars
desktop/                    Electron shell with Steamworks (lobbies, invites, relay P2P)
src/ui/                     HUD, menus, galaxy map
src/audio/                  procedural WebAudio music and SFX
src/post/                   GPU post pipeline: SSAO, reflections history, bloom, god rays, eye adaptation, grading
tools/                      single-file build and three.js vendoring
```
