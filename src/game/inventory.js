// Exosuit inventory (stacked item slots), block bag (Lucid building), currencies.
import { ITEMS, itemStackLimit } from '../data/items.js';

export class Inventory {
  constructor(capacity = 24) {
    this.capacity = capacity;
    this.slots = new Array(capacity).fill(null);
    this.blocks = {};
    this.hotbar = new Array(9).fill(0);
    this.units = 0;
    this.nanites = 0;
    this.onChange = null;
  }

  changed() { if (this.onChange) this.onChange(); }

  count(id) {
    if (id === 'units') return this.units;
    if (id === 'nanites') return this.nanites;
    if (id.startsWith('block:')) return this.blocks[id.slice(6)] || 0;
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  // Returns number actually added
  add(id, n = 1) {
    if (n <= 0) return 0;
    if (id === 'units') { this.units += n; this.changed(); return n; }
    if (id === 'nanites') { this.nanites += n; this.changed(); return n; }
    if (id.startsWith('block:')) { this.addBlock(Number(id.slice(6)), n); return n; }
    if (!ITEMS[id]) return 0;
    const lim = itemStackLimit(id);
    let left = n;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.n < lim) {
        const k = Math.min(lim - s.n, left);
        s.n += k; left -= k;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const k = Math.min(lim, left);
        this.slots[i] = { id, n: k };
        left -= k;
      }
    }
    this.changed();
    return n - left;
  }

  spaceFor(id) {
    if (id === 'units' || id === 'nanites' || id.startsWith('block:')) return Infinity;
    const lim = itemStackLimit(id);
    let space = 0;
    for (const s of this.slots) {
      if (!s) space += lim;
      else if (s.id === id) space += lim - s.n;
    }
    return space;
  }

  remove(id, n = 1) {
    if (this.count(id) < n) return false;
    if (id === 'units') { this.units -= n; this.changed(); return true; }
    if (id === 'nanites') { this.nanites -= n; this.changed(); return true; }
    if (id.startsWith('block:')) return this.removeBlock(Number(id.slice(6)), n);
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(s.n, left);
        s.n -= k; left -= k;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  has(list, times = 1) {
    for (const [id, n] of list) if (this.count(id) < n * times) return false;
    return true;
  }

  consume(list, times = 1) {
    if (!this.has(list, times)) return false;
    for (const [id, n] of list) this.remove(id, n * times);
    return true;
  }

  maxCraftable(list) {
    let m = Infinity;
    for (const [id, n] of list) m = Math.min(m, Math.floor(this.count(id) / n));
    return m === Infinity ? 0 : m;
  }

  addBlock(id, n = 1) {
    const k = String(id);
    this.blocks[k] = (this.blocks[k] || 0) + n;
    if (!this.hotbar.includes(id)) {
      const i = this.hotbar.indexOf(0);
      if (i >= 0) this.hotbar[i] = id;
    }
    this.changed();
  }

  removeBlock(id, n = 1) {
    const k = String(id);
    if ((this.blocks[k] || 0) < n) return false;
    this.blocks[k] -= n;
    if (this.blocks[k] <= 0) delete this.blocks[k];
    this.changed();
    return true;
  }

  blockCount(id) { return this.blocks[String(id)] || 0; }

  expand(n) {
    this.capacity += n;
    while (this.slots.length < this.capacity) this.slots.push(null);
    this.changed();
  }

  sortSlots() {
    const items = this.slots.filter(Boolean);
    items.sort((a, b) => (ITEMS[a.id].cat + a.id).localeCompare(ITEMS[b.id].cat + b.id));
    // merge
    const merged = [];
    for (const s of items) {
      const last = merged[merged.length - 1];
      const lim = itemStackLimit(s.id);
      if (last && last.id === s.id && last.n < lim) {
        const k = Math.min(lim - last.n, s.n);
        last.n += k; s.n -= k;
        if (s.n > 0) merged.push({ ...s });
      } else merged.push({ ...s });
    }
    this.slots = new Array(this.capacity).fill(null);
    merged.forEach((s, i) => { if (i < this.capacity) this.slots[i] = s; });
    this.changed();
  }

  serialize() {
    return { capacity: this.capacity, slots: this.slots, blocks: this.blocks, hotbar: this.hotbar, units: this.units, nanites: this.nanites };
  }

  load(o) {
    this.capacity = o.capacity;
    this.slots = o.slots.map((s) => (s && ITEMS[s.id] ? { id: s.id, n: s.n } : null));
    while (this.slots.length < this.capacity) this.slots.push(null);
    this.blocks = { ...o.blocks };
    this.hotbar = o.hotbar.slice(0, 9);
    while (this.hotbar.length < 9) this.hotbar.push(0);
    this.units = o.units || 0;
    this.nanites = o.nanites || 0;
    this.changed();
  }
}
