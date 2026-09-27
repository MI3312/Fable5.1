// Bases: a Base Computer claims land (mining inside your base doesn't bother the Sentinels),
// teleporters link every base you own across planets and systems, planters grow crops while you
// are away, and storage crates hold what your exosuit can't.
import { B } from '../world/blocks.js';
import { ITEMS } from '../data/items.js';

export const BASE_RADIUS = 48;
export const CROPS = [
  [B.SODIUM_PLANT, 'Sodium Bulb'], [B.OXYGEN_PLANT, 'Oxygen Pod'], [B.DIHYDRO, 'Di-hydrogen Crystal'],
  [B.SPECIAL_PLANT, 'Native Flora'], [B.FLOWER, 'Bloom'],
];
export const GROW_TIME = 120; // seconds of play for a crop to come up

export class Bases {
  constructor(game) { this.game = game; }

  get st() { return this.game.state; }
  get list() { return this.st.bases || (this.st.bases = []); }
  planters(pid) { const P = this.st.planters || (this.st.planters = {}); return P[pid] || (P[pid] = []); }
  storageKey(pid, x, y, z) { return `${pid}:${x},${y},${z}`; }
  storage(key) { const S = this.st.storage || (this.st.storage = {}); return S[key] || (S[key] = []); }

  baseAt(pid, x, z) {
    return this.list.find((b) => b.planet === pid && Math.hypot(b.x - x, b.z - z) < BASE_RADIUS) || null;
  }

  placed(id, x, y, z, planet) {
    const g = this.game, pid = planet.id;
    if (id === B.BASE_CORE) {
      if (this.baseAt(pid, x, z)) { g.hud.notify('This land is already part of a base'); return; }
      const n = this.list.filter((b) => b.planet === pid).length + 1;
      const base = {
        id: `${pid}#${Date.now() % 1e9}`, planet: pid, planetIndex: planet.index, planetName: planet.name,
        system: { ...this.st.system }, systemName: g.system.name, x, y, z, name: `${planet.name} Base${n > 1 ? ' ' + n : ''}`, pads: [],
      };
      this.list.push(base);
      g.hud.toast('Base claimed', `${base.name} · Sentinels ignore mining within ${BASE_RADIUS}u`);
      g.audio.discover();
    } else if (id === B.TELEPORTER) {
      const b = this.baseAt(pid, x, z);
      if (!b) { g.hud.notify('A teleporter only links up inside a base (place a Base Computer)'); return; }
      b.pads.push({ x, y, z });
      g.hud.notify(`Teleporter linked to ${b.name}`);
    } else if (id === B.PLANTER) {
      this.planters(pid).push({ x, y, z, crop: 0, since: this.st.playTime || 0 });
      g.hud.notify('Planter ready · [E] to choose a crop');
    }
  }

  broken(id, x, y, z, planet) {
    const pid = planet.id;
    if (id === B.BASE_CORE) {
      const b = this.list.find((q) => q.planet === pid && q.x === x && q.y === y && q.z === z);
      if (b) { this.st.bases = this.list.filter((q) => q !== b); this.game.hud.notify(`${b.name} dismantled`); }
    } else if (id === B.TELEPORTER) {
      for (const b of this.list) if (b.planet === pid) b.pads = b.pads.filter((q) => !(q.x === x && q.y === y && q.z === z));
    } else if (id === B.PLANTER) {
      const P = this.planters(pid);
      const i = P.findIndex((q) => q.x === x && q.y === y && q.z === z);
      if (i >= 0) P.splice(i, 1);
    } else if (id === B.STORAGE) {
      // spill the contents into your pockets rather than losing them
      const key = this.storageKey(pid, x, y, z);
      const items = this.storage(key);
      for (const it of items) this.game.inventory.add(it.id, it.n);
      if (items.length) this.game.hud.notify('The crate\'s contents are back in your exosuit');
      delete this.st.storage[key];
    }
  }

  // grow crops on the planters of this planet
  tick(world, planet) {
    if (!planet) return;
    const now = this.st.playTime || 0;
    for (const pl of this.planters(planet.id)) {
      if (!world.isLoaded(pl.x, pl.z)) continue;
      if (world.getBlock(pl.x, pl.y, pl.z) !== B.PLANTER) continue;
      const above = world.getBlock(pl.x, pl.y + 1, pl.z);
      if (above > 0) { pl.since = now; continue; }
      if (now - pl.since >= GROW_TIME) {
        world.setBlock(pl.x, pl.y + 1, pl.z, CROPS[pl.crop][0]);
        pl.since = now;
      }
    }
  }

  planterAt(pid, x, y, z) { return this.planters(pid).find((q) => q.x === x && q.y === y && q.z === z); }

  cycleCrop(pl) {
    pl.crop = (pl.crop + 1) % CROPS.length;
    pl.since = this.st.playTime || 0;
    return CROPS[pl.crop][1];
  }

  growth(pl) { return Math.min(1, ((this.st.playTime || 0) - pl.since) / GROW_TIME); }

  // move every raw resource (not products, not blocks) from the exosuit into a crate
  stash(key) {
    const inv = this.game.inventory, box = this.storage(key);
    let moved = 0;
    for (const s of [...inv.slots]) {
      if (!s || !ITEMS[s.id] || ITEMS[s.id].cat === 'product') continue;
      const n = inv.count(s.id);
      if (n <= 0) continue;
      inv.remove(s.id, n);
      const e = box.find((q) => q.id === s.id);
      if (e) e.n += n; else box.push({ id: s.id, n });
      moved += n;
    }
    return moved;
  }

  take(key, id, n) {
    const box = this.storage(key);
    const e = box.find((q) => q.id === id);
    if (!e) return;
    const k = Math.min(n, e.n);
    this.game.inventory.add(id, k);
    e.n -= k;
    if (e.n <= 0) box.splice(box.indexOf(e), 1);
  }
}
