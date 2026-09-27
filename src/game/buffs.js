// What you ate, and what it is still doing to you. Buffs tick down in real play time, are saved
// with the journey, and show as a row of chips under the stat bars.
import { BUFFS, FOOD } from '../data/food.js';
import { ITEMS } from '../data/items.js';
import { h, clear } from '../ui/dom.js';

export class Buffs {
  constructor(game) {
    this.game = game;
    this.el = null;
    this.drawKey = '';
  }

  get S() {
    const st = this.game.state;
    if (!st) return {};
    if (!st.buffs) st.buffs = {};
    return st.buffs;
  }

  has(k) { return (this.S[k] || 0) > 0; }

  // product of every active buff's multiplier for one system ('speed', 'life', 'hazard', 'jet', 'dread')
  mul(what) {
    let m = 1;
    for (const [k, t] of Object.entries(this.S)) {
      if (t <= 0) continue;
      const b = BUFFS[k];
      if (b && b.mul[what]) m *= b.mul[what];
    }
    return m;
  }

  add(k, seconds) { this.S[k] = Math.max(this.S[k] || 0, seconds); this.drawKey = ''; }

  // can this item be eaten? returns the verb for the inventory button
  verb(id) {
    if (FOOD[id]) return 'Eat';
    const it = ITEMS[id];
    if (it && it.cat === 'fish' && id !== 'kelp_tangle') return 'Eat raw';
    return null;
  }

  eat(id) {
    const g = this.game, inv = g.inventory, st = g.player.stats;
    if (!this.verb(id) || !inv.remove(id, 1)) return false;
    const dish = FOOD[id];
    const heal = dish ? dish.heal || 0 : 8;
    st.health = Math.min(100, st.health + heal);
    if (dish && dish.buff) {
      const [k, sec] = dish.buff;
      this.add(k, sec);
      g.hud.toast(ITEMS[id].name, `${BUFFS[k].name} · ${BUFFS[k].desc} (${Math.round(sec / 60)} min)`);
      // a meal shared: friends standing nearby get the buff too
      if (g.net.active) g.net.shareMeal(id, k, sec);
    } else g.hud.notify(`Ate ${ITEMS[id].name}${heal ? ` · +${heal} health` : ''}`);
    if (!dish && Math.random() < 0.25) { st.life = Math.max(0, st.life - 6); g.hud.notify('That was not entirely cooked.'); }
    g.audio.tone(520, 0.12, 'sine', 0.06, 1.4);
    setTimeout(() => g.audio.tone(700, 0.1, 'sine', 0.05, 1.2), 90);
    return true;
  }

  // H: eat the most useful thing you're carrying. Hurt: the best heal. Healthy: a buff you don't have.
  quickEat() {
    const g = this.game, inv = g.inventory, st = g.player.stats;
    const have = Object.keys(ITEMS).filter((id) => this.verb(id) && inv.count(id) > 0);
    if (!have.length) { g.hud.notify('Nothing to eat - fish, or cook something'); return false; }
    const heal = (id) => (FOOD[id] ? FOOD[id].heal || 0 : 8);
    let pick = null;
    if (st.health < 90) pick = have.slice().sort((a, b) => heal(b) - heal(a))[0];
    else pick = have.find((id) => FOOD[id] && FOOD[id].buff && !this.has(FOOD[id].buff[0]));
    if (!pick) { g.hud.notify('Not hungry'); return false; }
    return this.eat(pick);
  }

  hide() { if (this.el) this.el.style.display = 'none'; }

  update(dt) {
    const S = this.S, g = this.game;
    for (const k of Object.keys(S)) {
      S[k] -= dt;
      if (S[k] <= 0) {
        delete S[k];
        this.drawKey = '';
        if (BUFFS[k]) this.game.hud.notify(`${BUFFS[k].name} wore off`);
      }
    }
    g.player.buffSpeed = this.mul('speed');
    g.player.jetMul = this.mul('jet');
    this._draw();
  }

  _draw() {
    const g = this.game;
    if (!this.el) {
      this.el = h('div', { class: 'buffs' });
      (g.hud.root || document.body).appendChild(this.el);
    }
    const visible = g.mode === 'surface' && !g.menus.open && !g.photo.active && !g.hudHidden;
    this.el.style.display = visible ? '' : 'none';
    const S = this.S;
    // redraw once a second (or when the set changes)
    const key = Object.keys(S).map((k) => k + Math.ceil(S[k])).join('|');
    if (key === this.drawKey) return;
    this.drawKey = key;
    clear(this.el);
    for (const [k, t] of Object.entries(S)) {
      const b = BUFFS[k];
      if (!b) continue;
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      this.el.appendChild(h('div', { class: 'buff' + (t < 20 ? ' fading' : ''), title: `${b.name}: ${b.desc}`, style: { borderColor: b.color } },
        h('span', { class: 'bi', style: { color: b.color } }, b.icon), h('span', { class: 'bt' }, `${m}:${String(s).padStart(2, '0')}`)));
    }
  }
}
