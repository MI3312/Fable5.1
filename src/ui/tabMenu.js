// The Tab screen: everything you carry, everything you can make, and what it's all for.
// A rail of pages down the left; each page explains itself in one line at the top, and every
// item can be clicked to see what it's for and where to find more.
import { h, clear, fmt } from './dom.js';
import { ITEMS } from '../data/items.js';
import { BLOCKS } from '../world/blocks.js';
import { getBlockIcon } from '../world/atlas.js';
import { RECIPES, ALCHEMY, UPGRADES } from '../data/recipes.js';
import { FOOD } from '../data/food.js';
import { shipName, specLabel } from '../data/ships.js';
import {
  sourcesOf, usesOf, outName, CRAFT_GROUPS, recipeGroup, recipePurpose, planRecipe,
} from '../data/itemInfo.js';

const PAGES = [
  { id: 'inventory', label: 'Inventory', icon: '▦', sub: 'What you carry. Select anything to see what it is for and where to find more.' },
  { id: 'crafting', label: 'Crafting', icon: '⚒', sub: 'Make materials, parts, fuel and base pieces. Green means you can make it now.' },
  { id: 'tech', label: 'Technology', icon: '⚙', sub: 'Upgrades for your exosuit and starship, and your ship\'s fuel and repairs.' },
  { id: 'alchemy', label: 'Apotheosis', icon: '✧', sub: 'Fuse two things and see what the dream makes of them. There is no book: you remember what works.' },
  { id: 'blocks', label: 'Blocks', icon: '▣', sub: 'Blocks you have collected for building, and the hotbar they sit in.' },
  { id: 'codex', label: 'Codex', icon: '☰', sub: 'Everything you have ever carried: what it is for, and where it comes from.' },
  { id: 'discoveries', label: 'Discoveries', icon: '◎', sub: 'The creatures and plants of this world, and every place you have been.' },
  { id: 'journey', label: 'Journey', icon: '➶', sub: 'Where you are going, what to do next, and what you have remembered.' },
];
// old tab names still open the right page
const ALIAS = { exosuit: 'inventory', fabricate: 'crafting', technology: 'tech' };
const CATS = [['all', 'All'], ['element', 'Elements'], ['product', 'Products'], ['dream', 'Dream'], ['food', 'Food'], ['fish', 'Fish']];
const CAT_LABEL = { element: 'Element', product: 'Product', dream: 'Dream material', food: 'Food', fish: 'Fish' };
const KIND_ICON = { mine: '⛏', salvage: '⚒', flora: '❀', refine: '⇄', craft: '⚒', fish: '≈', cook: '♨', event: '✦', use: '▸', tech: '⚙', dream: '✧', 'dream-unknown': '?' };
const WHISPER_COST = 30;

function tinted(size, color, text) {
  const el = h('div', { class: `tm-ico ${size}` }, text);
  el.style.setProperty('--c', color);
  return el;
}
function icon(id, size = 'md') {
  if (typeof id === 'string' && id.startsWith('block:')) {
    const bid = Number(id.slice(6));
    return h('div', { class: `tm-ico ${size} blk` }, h('img', { src: getBlockIcon(bid), alt: '' }));
  }
  if (id === 'nanites') return tinted(size, '#7ef0ff', 'Nn');
  if (id === 'lore') return tinted(size, '#ffd9a8', '✧');
  const it = ITEMS[id];
  return tinted(size, it ? it.color : '#555', it ? it.symbol : '?');
}
const nameOf = (id) => (id.startsWith('block:') ? BLOCKS[Number(id.slice(6))].name : id === 'nanites' ? 'Nanites' : ITEMS[id] ? ITEMS[id].name : id);
const bar = (v, cls) => h('div', { class: 'tm-bar ' + (cls || '') }, h('i', { style: { width: Math.max(0, Math.min(100, v)) + '%' } }));

export class TabMenu {
  constructor(menus, game) {
    this.menus = menus;
    this.game = game;
    this.page = 'inventory';
    this.sel = null;          // selected cargo slot
    this.codexSel = null;
    this.cat = 'all';
    this.craftGroup = 'ready';
    this.craftSel = null;
    this.craftQuery = '';
    this.alch = [null, null];
    this.hotSel = 0;
    this.blockSel = null;
  }

  get g() { return this.game; }
  get inv() { return this.game.inventory; }

  open(page) {
    if (page) this.page = ALIAS[page] || page;
    if (!PAGES.some((p) => p.id === this.page)) this.page = 'inventory';
    this.rail = h('nav', { class: 'tm-rail' });
    this.top = h('header', { class: 'tm-top' });
    this.body = h('div', { class: 'tm-body' });
    const root = h('div', { class: 'tm interactive' }, this.rail, h('main', { class: 'tm-main' }, this.top, this.body));
    this.menus._overlay(root);
    this.menus.open = 'inventory';
    this.render();
  }

  go(page, opts = {}) {
    this.page = page;
    Object.assign(this, opts);
    this.game.audio.ui();
    this.render();
  }

  render() {
    if (!this.body) return;
    // keep scroll positions across re-renders
    const keep = {};
    this.body.querySelectorAll('[data-scroll]').forEach((e) => { keep[e.dataset.scroll] = e.scrollTop; });
    this._rail();
    const P = PAGES.find((p) => p.id === this.page);
    clear(this.top).append(
      h('div', { class: 'tm-title' }, h('span', { class: 'tm-title-ico' }, P.icon), P.label),
      h('div', { class: 'tm-sub' }, P.sub),
      h('div', { class: 'tm-close', onclick: () => { this.menus.closeAll(true); this.game.resume(); } }, 'Close', h('span', { class: 'key' }, 'Tab')));
    clear(this.body);
    this.body.className = 'tm-body tm-page-' + this.page;
    ({
      inventory: () => this._inventory(), crafting: () => this._crafting(), tech: () => this._tech(), alchemy: () => this._alchemy(),
      blocks: () => this._blocks(), codex: () => this._codex(), discoveries: () => this._discoveries(), journey: () => this._journey(),
    })[this.page]();
    this.body.querySelectorAll('[data-scroll]').forEach((e) => { if (keep[e.dataset.scroll]) e.scrollTop = keep[e.dataset.scroll]; });
  }

  // ------------------------------------------------------------------ rail
  _rail() {
    const g = this.game, inv = this.inv;
    const ready = RECIPES.filter((r) => inv.maxCraftable(r.in) >= 1).length;
    const techReady = UPGRADES.filter((u) => this._upgradeState(u).state === 'ready').length;
    const known = (g.state.alchemyKnown || []).length;
    const badges = { crafting: ready ? `${ready}` : null, tech: techReady ? `${techReady}` : null, alchemy: `${known}/${ALCHEMY.length}` };
    const used = inv.slots.filter(Boolean).length;
    clear(this.rail).append(
      h('div', { class: 'tm-brand' }, 'EXOSUIT'),
      ...PAGES.map((p) => h('div', { class: 'tm-nav' + (p.id === this.page ? ' on' : ''), onclick: () => this.go(p.id) },
        h('span', { class: 'tm-nav-ico' }, p.icon), h('span', { class: 'tm-nav-label' }, p.label),
        badges[p.id] ? h('span', { class: 'tm-badge' + (p.id === 'alchemy' ? ' dim' : '') }, badges[p.id]) : null)),
      h('div', { class: 'tm-rail-foot' },
        h('div', { class: 'tm-money' }, h('span', {}, 'Units'), h('b', {}, fmt(inv.units))),
        h('div', { class: 'tm-money nan' }, h('span', {}, 'Nanites'), h('b', {}, fmt(inv.nanites))),
        h('div', { class: 'tm-money' }, h('span', {}, 'Cargo'), h('b', {}, `${used}/${inv.capacity}`)),
        bar(used / inv.capacity * 100, used >= inv.capacity ? 'bad' : '')));
  }

  // ------------------------------------------------------------------ inventory
  _lifeCards() {
    const g = this.game, st = g.player.stats, inv = this.inv;
    const pick = (opts, missing) => {
      const held = opts.filter(([id]) => inv.count(id) > 0);
      if (!held.length) return null;
      const big = held.find(([, per]) => per >= 100 && missing >= 55);
      return big || held.find(([, per]) => per < 100) || held[0];
    };
    const card = (label, cls, v, opts, stat, note) => {
      const missing = 100 - v;
      const p = opts ? pick(opts, missing) : null;
      const btn = !opts ? h('span', { class: 'tm-mini muted' }, note)
        : missing < 1 ? h('span', { class: 'tm-mini muted' }, 'Full')
          : p ? h('button', { class: 'tm-btn tiny', onclick: () => { g.rechargeStat(stat, p[0]); this.render(); } }, `Recharge · ${ITEMS[p[0]].name}`)
            : h('span', { class: 'tm-mini bad', title: `Recharge with ${opts.map(([id]) => ITEMS[id].name).join(', ')}` }, `Need ${opts.map(([id]) => ITEMS[id].name).slice(0, 2).join(' or ')}`);
      return h('div', { class: 'tm-life' }, h('div', { class: 'tm-life-top' }, h('span', {}, label), h('b', {}, Math.round(v) + '%')), bar(v, cls), btn);
    };
    return h('div', { class: 'tm-lifes' },
      card('Health', 'health', st.health, null, null, 'Eat food to heal (H)'),
      card('Shield', 'shield', st.shield, [['carbon', 2]], 'shield'),
      card('Hazard protection', 'hazard', st.hazard, [['ion_battery', 100], ['sodium_nitrate', 8], ['sodium', 3]], 'hazard'),
      card('Life support', 'life', st.life, [['life_support_gel', 100], ['oxygen', 3]], 'life'),
      card('Jetpack', 'jet', st.jet, null, null, 'Refills on its own'));
  }

  _inventory() {
    const inv = this.inv;
    const grid = h('div', { class: 'tm-grid', 'data-scroll': 'cargo' });
    const match = (id) => {
      if (this.cat === 'all') return true;
      const c = ITEMS[id].cat;
      return this.cat === 'food' ? c === 'food' || !!FOOD[id] : c === this.cat;
    };
    inv.slots.forEach((s, i) => {
      if (!s) { grid.appendChild(h('div', { class: 'tm-slot empty' })); return; }
      const dim = !match(s.id);
      grid.appendChild(h('div', { class: 'tm-slot' + (this.sel === i ? ' sel' : '') + (dim ? ' dim' : ''), title: ITEMS[s.id].name,
        onclick: () => { this.sel = this.sel === i ? null : i; this.game.audio.ui(); this.render(); } },
      icon(s.id), h('span', { class: 'tm-n' }, fmt(s.n))));
    });
    const chips = h('div', { class: 'tm-chips' }, CATS.map(([id, l]) => h('span', { class: 'tm-chip' + (this.cat === id ? ' on' : ''), onclick: () => { this.cat = id; this.render(); } }, l)),
      h('span', { class: 'tm-spacer' }),
      h('button', { class: 'tm-btn tiny', onclick: () => { inv.sortSlots(); this.sel = null; this.render(); } }, 'Sort & stack'));
    const left = h('div', { class: 'tm-col grow' }, this._lifeCards(), chips, grid);
    const s = this.sel != null ? inv.slots[this.sel] : null;
    const right = s ? this._itemCard(s.id, { held: s.n, slot: this.sel }) : h('div', { class: 'tm-card tm-detail empty' },
      h('div', { class: 'tm-empty-ico' }, '▦'),
      h('div', { class: 'tm-h' }, 'Select an item'),
      h('p', { class: 'muted' }, 'Every item says what it is for and where to find more. Anything with a use (fuel, a recharge, food) can be used from here.'),
      h('div', { class: 'tm-tip' }, h('b', {}, 'Tip'), ' The Crafting page shows what you can make with what you carry, and makes missing parts for you.'));
    this.body.append(left, right);
  }

  // the item card: what it is, what it's for, where to find more
  _itemCard(id, opts = {}) {
    const g = this.game, inv = this.inv, it = ITEMS[id];
    const held = inv.count(id);
    const card = h('div', { class: 'tm-card tm-detail', 'data-scroll': 'detail' });
    card.append(
      h('div', { class: 'tm-dhead' }, icon(id, 'lg'), h('div', {},
        h('div', { class: 'tm-cat' }, CAT_LABEL[it.cat] || it.cat),
        h('div', { class: 'tm-h' }, it.name),
        h('div', { class: 'muted small' }, `Carrying ${fmt(held)} · worth ${fmt(it.value)}u each`))),
      h('p', { class: 'tm-desc' }, it.desc));
    const acts = h('div', { class: 'tm-acts' });
    const use = g.itemUse(id);
    if (use && held > 0) acts.appendChild(h('button', { class: 'tm-btn primary', onclick: () => { g.useItem(id); this.render(); } }, use));
    if (opts.slot != null && held > 0) {
      acts.appendChild(h('button', { class: 'tm-btn', onclick: () => { inv.remove(id, 1); this.render(); } }, 'Drop 1'));
      acts.appendChild(h('button', { class: 'tm-btn', onclick: () => {
        this.menus.dialog('Drop them all?', `Throw away all ${fmt(held)} ${it.name}?`, [
          { label: 'Keep them', action: () => this.open() },
          { label: 'Drop all', primary: true, action: () => { inv.remove(id, held); this.sel = null; this.open(); } }]);
      } }, 'Drop all'));
    }
    if (acts.childNodes.length) card.appendChild(acts);
    card.appendChild(this._infoLists(id));
    return card;
  }

  _infoLists(id) {
    const uses = usesOf(id, this.game.state.alchemyKnown);
    const srcs = sourcesOf(id);
    const wrap = h('div', {});
    wrap.appendChild(h('div', { class: 'tm-sec' }, 'What it is for'));
    if (!uses.length) wrap.appendChild(h('div', { class: 'muted small' }, 'Nothing but selling it at a station.'));
    for (const u of uses) {
      const link = u.recipe ? () => this.go('crafting', { craftSel: u.recipe, craftGroup: recipeGroup(RECIPES.find((r) => r.id === u.recipe)), craftQuery: '' })
        : u.upgrade ? () => this.go('tech') : u.alchemy != null ? () => { const r = ALCHEMY[u.alchemy]; this.alch = [r.a, r.b]; this.go('alchemy'); } : null;
      wrap.appendChild(h('div', { class: 'tm-line' + (link ? ' link' : '') + (u.kind === 'dream-unknown' ? ' dreamy' : ''), onclick: link },
        h('span', { class: 'tm-k' }, KIND_ICON[u.kind] || '·'), h('span', {}, u.text), link ? h('span', { class: 'tm-go' }, '›') : null));
    }
    wrap.appendChild(h('div', { class: 'tm-sec' }, 'Where to find more'));
    if (!srcs.length) wrap.appendChild(h('div', { class: 'muted small' }, 'Somewhere in the dream. Keep looking.'));
    for (const s of srcs) {
      const link = s.recipe ? () => this.go('crafting', { craftSel: s.recipe, craftGroup: recipeGroup(RECIPES.find((r) => r.id === s.recipe)), craftQuery: '' }) : null;
      wrap.appendChild(h('div', { class: 'tm-line' + (link ? ' link' : ''), onclick: link }, h('span', { class: 'tm-k' }, KIND_ICON[s.kind] || '·'), h('span', {}, s.text), link ? h('span', { class: 'tm-go' }, '›') : null));
    }
    return wrap;
  }

  // ------------------------------------------------------------------ crafting
  _recipeState(r) {
    const max = this.inv.maxCraftable(r.in);
    if (max >= 1) return { state: 'ready', max };
    const plan = planRecipe(this.inv, r, 1);
    if (plan.steps) return { state: 'steps', plan, max: 0 };
    return { state: 'missing', plan, max: 0 };
  }

  _crafting() {
    const states = new Map(RECIPES.map((r) => [r.id, this._recipeState(r)]));
    const inGroup = (r, grp) => (grp === 'ready' ? states.get(r.id).state === 'ready' : recipeGroup(r) === grp);
    const q = this.craftQuery.trim().toLowerCase();
    const groups = h('div', { class: 'tm-col tm-groups' },
      h('input', { class: 'tm-search', type: 'search', placeholder: 'Search…', value: this.craftQuery,
        oninput: (e) => { this.craftQuery = e.target.value; this._craftList(listWrap, states); } }),
      ...CRAFT_GROUPS.map((G) => {
        const n = RECIPES.filter((r) => inGroup(r, G.id)).length;
        const ready = RECIPES.filter((r) => recipeGroup(r) === G.id && states.get(r.id).state === 'ready').length;
        return h('div', { class: 'tm-group' + (this.craftGroup === G.id && !q ? ' on' : ''), onclick: () => { this.craftGroup = G.id; this.craftQuery = ''; this.render(); } },
          h('span', {}, G.label), h('span', { class: 'tm-count' + (G.id === 'ready' && n ? ' good' : '') }, G.id === 'ready' ? String(n) : ready ? `${ready}/${n}` : String(n)));
      }),
      h('div', { class: 'tm-tip' }, h('b', {}, 'How it works'), ' Pick a recipe to see exactly what it needs. ', h('span', { class: 'good' }, 'Green'), ' means you have it. If a part is missing but you can make it, the ', h('b', {}, 'Make it all'), ' button does every step for you.'));
    const listWrap = h('div', { class: 'tm-col grow tm-list', 'data-scroll': 'recipes' });
    this._craftList(listWrap, states);
    const sel = RECIPES.find((r) => r.id === this.craftSel);
    const right = sel ? this._recipeCard(sel, states.get(sel.id)) : h('div', { class: 'tm-card tm-detail empty' },
      h('div', { class: 'tm-empty-ico' }, '⚒'), h('div', { class: 'tm-h' }, 'Pick a recipe'),
      h('p', { class: 'muted' }, CRAFT_GROUPS.find((G) => G.id === this.craftGroup).desc));
    this.body.append(groups, listWrap, right);
  }

  _craftList(wrap, states) {
    clear(wrap);
    const q = this.craftQuery.trim().toLowerCase();
    let list = RECIPES.filter((r) => {
      if (q) return nameOf(r.out[0]).toLowerCase().includes(q) || r.in.some(([i]) => nameOf(i).toLowerCase().includes(q));
      return this.craftGroup === 'ready' ? states.get(r.id).state === 'ready' : recipeGroup(r) === this.craftGroup;
    });
    const order = { ready: 0, steps: 1, missing: 2 };
    list = list.slice().sort((a, b) => order[states.get(a.id).state] - order[states.get(b.id).state]);
    const G = CRAFT_GROUPS.find((x) => x.id === this.craftGroup);
    if (!q) wrap.appendChild(h('div', { class: 'tm-groupdesc' }, G.desc));
    if (!list.length) wrap.appendChild(h('div', { class: 'tm-empty-line' }, q ? 'Nothing matches that.' : this.craftGroup === 'ready' ? 'Nothing is ready to make yet. Browse the groups on the left to see what each thing needs.' : 'Nothing here.'));
    for (const r of list) {
      const st = states.get(r.id);
      const tag = st.state === 'ready' ? h('span', { class: 'tm-tag good' }, `Ready · ${fmt(st.max)}`)
        : st.state === 'steps' ? h('span', { class: 'tm-tag warn' }, `${st.plan.steps.length - 1} step${st.plan.steps.length > 2 ? 's' : ''} first`)
          : h('span', { class: 'tm-tag bad' }, 'Missing');
      wrap.appendChild(h('div', { class: 'tm-row ' + st.state + (this.craftSel === r.id ? ' sel' : ''), onclick: () => { this.craftSel = r.id; this.game.audio.ui(); this.render(); } },
        icon(r.out[0]),
        h('div', { class: 'tm-row-main' },
          h('div', { class: 'tm-row-name' }, outName(r.out)),
          h('div', { class: 'tm-ings' }, r.in.map(([id, n]) => this._chip(id, n)))),
        tag));
    }
  }

  _chip(id, n, times = 1) {
    const have = this.inv.count(id);
    const ok = have >= n * times;
    return h('span', { class: 'tm-ing ' + (ok ? 'ok' : 'no'), title: `${nameOf(id)}: you have ${fmt(have)}` }, icon(id, 'xs'), h('span', {}, `${fmt(n * times)} ${nameOf(id)}`), h('small', {}, fmt(have)));
  }

  _recipeCard(r, st) {
    const g = this.game, inv = this.inv;
    const card = h('div', { class: 'tm-card tm-detail', 'data-scroll': 'rdetail' });
    card.append(
      h('div', { class: 'tm-dhead' }, icon(r.out[0], 'lg'), h('div', {},
        h('div', { class: 'tm-cat' }, CRAFT_GROUPS.find((G) => G.id === recipeGroup(r)).label),
        h('div', { class: 'tm-h' }, nameOf(r.out[0])),
        h('div', { class: 'muted small' }, `Makes ${r.out[1]} · you have ${fmt(inv.count(r.out[0]))}`))),
      h('p', { class: 'tm-desc' }, recipePurpose(r)),
      h('div', { class: 'tm-sec' }, 'Needs'));
    for (const [id, n] of r.in) {
      const have = inv.count(id), ok = have >= n;
      const src = sourcesOf(id)[0];
      card.appendChild(h('div', { class: 'tm-need ' + (ok ? 'ok' : 'no') },
        icon(id, 'sm'),
        h('div', { class: 'grow' }, h('div', {}, h('b', {}, `${n} ${nameOf(id)}`), h('span', { class: 'muted' }, ` · you have ${fmt(have)}`)),
          !ok && src ? h('div', { class: 'small muted' }, (KIND_ICON[src.kind] || '') + ' ' + src.text) : null),
        h('span', { class: 'tm-mark' }, ok ? '✓' : `-${fmt(n - have)}`)));
    }
    const acts = h('div', { class: 'tm-acts' });
    if (st.state === 'ready') {
      const mk = (label, n) => h('button', { class: 'tm-btn' + (n === 1 ? ' primary' : ''), onclick: () => { g.craft(r, n); this.render(); } }, label);
      acts.append(mk('Make 1', 1));
      if (st.max >= 5) acts.append(mk('Make 5', 5));
      if (st.max > 1) acts.append(mk(`Make all (${fmt(st.max)})`, st.max));
    } else if (st.state === 'steps') {
      card.appendChild(h('div', { class: 'tm-sec' }, 'You can make the missing parts'));
      const ol = h('ol', { class: 'tm-steps' });
      for (const s of st.plan.steps) ol.appendChild(h('li', {}, `${s.recipe.type === 'refine' ? 'Refine' : 'Make'} ${outName([s.recipe.out[0], s.recipe.out[1] * s.times])}`));
      card.appendChild(ol);
      acts.append(h('button', { class: 'tm-btn primary', onclick: () => { this._runPlan(st.plan.steps); this.render(); } }, `Make it all (${st.plan.steps.length} steps)`));
    } else {
      card.appendChild(h('div', { class: 'tm-warnbox' }, 'Not enough materials yet. The missing ones are marked in red, with where to find them.'));
    }
    card.appendChild(acts);
    return card;
  }

  _runPlan(steps) {
    const g = this.game;
    for (const s of steps) if (!g.craft(s.recipe, s.times)) { g.hud.notify('Stopped: not enough materials or cargo space'); return false; }
    return true;
  }

  // ------------------------------------------------------------------ technology
  _upgradeState(u) {
    const g = this.game, inv = this.inv;
    const n = g.upgradeCount(u.id);
    if ((u.once && n > 0) || (u.max && n >= u.max)) return { state: 'done', n };
    if (inv.has(u.cost)) return { state: 'ready', n };
    // can the missing parts be made? plan them together so shared materials aren't counted twice
    const p = planRecipe(inv, { id: '__upgrade', type: 'craft', in: u.cost, out: ['__upgrade', 1] }, 1);
    if (!p.steps) return { state: 'missing', n };
    return { state: 'parts', n, plans: p.steps.slice(0, -1) };
  }

  _tech() {
    const g = this.game, inv = this.inv, ship = g.ship;
    const gauge = (label, v, cls, fuels, kind, extra) => {
      const held = (fuels || []).filter((id) => inv.count(id) > 0);
      const btns = h('div', { class: 'tm-acts tight' });
      if (fuels && v < 99.5) {
        if (held.length) for (const id of held) btns.appendChild(h('button', { class: 'tm-btn tiny', onclick: () => { g.refuelShip(kind, id); this.render(); } }, `+ ${ITEMS[id].name} (${fmt(inv.count(id))})`));
        else btns.appendChild(h('span', { class: 'tm-mini bad' }, `Needs ${fuels.map((id) => ITEMS[id].name).join(', ')}`));
      }
      return h('div', { class: 'tm-gauge' }, h('div', { class: 'tm-life-top' }, h('span', {}, label), h('b', {}, extra || Math.round(v) + '%')), bar(v, cls), btns);
    };
    const shipCol = h('div', { class: 'tm-col tm-shipcol' },
      h('div', { class: 'tm-card' },
        h('div', { class: 'tm-cat' }, `Starship · ${specLabel(ship.spec)}`), h('div', { class: 'tm-h' }, shipName(ship.spec.seed)),
        ship.thrustersRepaired ? gauge('Launch thrusters', ship.fuel.launch, 'warn', ['launch_fuel', 'dihydrogen_jelly', 'uranium'], 'launch')
          : h('div', { class: 'tm-warnbox' }, 'Launch thrusters are damaged. Install "Repair Launch Thrusters" below to fly again.'),
        gauge('Pulse engine', ship.fuel.pulse, 'jet', ['tritium'], 'pulse'),
        gauge('Shields', ship.shield, 'shield', ['starshield_battery', 'ferrite'], 'shield'),
        gauge('Hull', ship.hull, 'health', ['metal_plating'], 'hull'),
        h('div', { class: 'tm-life-top' }, h('span', {}, 'Hyperdrive range'), h('b', {}, `${g.hyperdriveRange()} ly`)),
        h('div', { class: 'muted small' }, `Each jump uses a Warp Cell (you have ${inv.count('warp_cell')}) or a Lucid Core (${inv.count('lucid_core')}).`)));
    const groups = [['suit', 'Exosuit & multi-tool'], ['ship', 'Starship']];
    const list = h('div', { class: 'tm-col grow tm-list', 'data-scroll': 'tech' });
    for (const [target, label] of groups) {
      list.appendChild(h('div', { class: 'tm-sec big' }, label));
      const ups = UPGRADES.filter((u) => u.target === target).map((u) => [u, this._upgradeState(u)]);
      const order = { ready: 0, parts: 1, missing: 2, done: 3 };
      ups.sort((a, b) => order[a[1].state] - order[b[1].state]);
      for (const [u, st] of ups) {
        const tag = { done: h('span', { class: 'tm-tag done' }, 'Installed'), ready: h('span', { class: 'tm-tag good' }, 'Ready to install'),
          parts: h('span', { class: 'tm-tag warn' }, 'Parts can be made'), missing: h('span', { class: 'tm-tag bad' }, 'Missing materials') }[st.state];
        const acts = h('div', { class: 'tm-acts tight' });
        if (st.state === 'ready') acts.appendChild(h('button', { class: 'tm-btn primary', onclick: () => { g.installUpgrade(u); this.render(); } }, 'Install'));
        if (st.state === 'parts') acts.appendChild(h('button', { class: 'tm-btn primary', onclick: () => { if (this._runPlan(st.plans) && inv.has(u.cost)) g.installUpgrade(u); this.render(); } }, `Make parts & install (${st.plans.length} steps)`));
        list.appendChild(h('div', { class: 'tm-card tm-up ' + st.state },
          h('div', { class: 'tm-up-head' }, h('div', { class: 'tm-row-name' }, u.name + (st.n && !u.once ? ` · ${st.n}${u.max ? '/' + u.max : ''} installed` : '')), tag),
          h('div', { class: 'muted' }, u.desc),
          st.state === 'done' ? null : h('div', { class: 'tm-ings' }, u.cost.map(([id, n]) => this._chip(id, n))),
          acts));
      }
    }
    this.body.append(shipCol, list);
  }

  // ------------------------------------------------------------------ apotheosis
  _alchemy() {
    const g = this.game, inv = this.inv, S = g.state;
    const known = new Set(S.alchemyKnown || []);
    const tried = new Set(S.alchemyTried || []);
    const reveal = S.whispers || (S.whispers = {});
    const [a, b] = this.alch;
    const slot = (id, k) => h('div', { class: 'tm-bench-slot' + (id ? ' full' : ''), onclick: () => { this.alch[k] = null; this.render(); } },
      id ? icon(id, 'lg') : h('span', { class: 'muted' }, k ? 'second' : 'first'), id ? h('div', { class: 'small' }, ITEMS[id].name) : null);
    const idx = a && b ? ALCHEMY.findIndex((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a)) : -1;
    const key = a && b ? [a, b].sort().join('|') : null;
    let result, verdict;
    if (!a || !b) { result = h('span', { class: 'muted' }, '?'); verdict = 'Pick two things from your cargo below.'; }
    else if (idx >= 0 && known.has(idx)) { result = icon(ALCHEMY[idx].out[0], 'lg'); verdict = `You remember this one: it makes ${outName(ALCHEMY[idx].out)}.`; }
    else if (tried.has(key)) { result = h('span', { class: 'bad' }, '✕'); verdict = 'You have tried this pair. Nothing happened.'; }
    else { result = h('span', { class: 'dreamy' }, '?'); verdict = `An untried pair. If the dream doesn't know it, you lose 1 ${ITEMS[a].name}.`; }
    const need = a && b ? (a === b ? [[a, 2]] : [[a, 1], [b, 1]]) : null;
    const can = need && inv.has(need);
    const bench = h('div', { class: 'tm-card tm-bench' },
      h('div', { class: 'tm-bench-row' }, slot(a, 0), h('span', { class: 'tm-op' }, '+'), slot(b, 1), h('span', { class: 'tm-op' }, '→'),
        h('div', { class: 'tm-bench-slot result' }, result)),
      h('div', { class: 'tm-verdict' }, verdict),
      h('div', { class: 'tm-acts' },
        h('button', { class: 'tm-btn primary big', disabled: can ? null : true, onclick: () => { g.alchemy(a, b); if (!inv.has(need)) this.alch = [null, null]; this.render(); } }, 'Dream it'),
        h('button', { class: 'tm-btn', onclick: () => { this.alch = [null, null]; this.render(); } }, 'Clear')));
    // ingredients: dream materials first, known ingredients marked
    const inKnown = new Set();
    ALCHEMY.forEach((r, i) => { if (known.has(i)) { inKnown.add(r.a); inKnown.add(r.b); } });
    const ids = [...new Set(inv.slots.filter(Boolean).map((s) => s.id))];
    ids.sort((x, y) => (ITEMS[y].cat === 'dream') - (ITEMS[x].cat === 'dream') || ITEMS[x].name.localeCompare(ITEMS[y].name));
    const pick = h('div', { class: 'tm-grid small', 'data-scroll': 'alchpick' }, ids.map((id) => h('div', { class: 'tm-slot' + (id === a || id === b ? ' sel' : ''), title: ITEMS[id].name,
      onclick: () => { if (!this.alch[0]) this.alch[0] = id; else if (!this.alch[1]) this.alch[1] = id; else this.alch = [id, null]; g.audio.ui(); this.render(); } },
    icon(id), h('span', { class: 'tm-n' }, fmt(inv.count(id))), inKnown.has(id) ? h('span', { class: 'tm-dot', title: 'Part of a recipe you know' }) : null)));
    const left = h('div', { class: 'tm-col grow' }, bench, h('div', { class: 'tm-sec' }, 'Your cargo · click to place · ', h('span', { class: 'tm-dot inline' }), ' part of a recipe you know'), pick);
    // the book of what you've remembered, the pairs that failed, and the whispers
    const book = h('div', { class: 'tm-card tm-detail', 'data-scroll': 'book' }, h('div', { class: 'tm-cat' }, `Remembered ${known.size} of ${ALCHEMY.length}`), h('div', { class: 'tm-h' }, 'Dream book'));
    if (!known.size) book.appendChild(h('p', { class: 'muted' }, 'Nothing remembered yet. Chroma Shards react with almost everything - try one with the most common things you carry.'));
    ALCHEMY.forEach((r, i) => {
      if (!known.has(i)) return;
      const have = inv.has(r.a === r.b ? [[r.a, 2]] : [[r.a, 1], [r.b, 1]]);
      book.appendChild(h('div', { class: 'tm-line link' + (have ? '' : ' faded'), onclick: () => { this.alch = [r.a, r.b]; this.render(); } },
        icon(r.a, 'xs'), h('span', {}, ITEMS[r.a].name), h('span', { class: 'muted' }, '+'), icon(r.b, 'xs'), h('span', {}, ITEMS[r.b].name), h('span', { class: 'muted' }, '→'), h('span', { class: 'dreamy' }, outName(r.out))));
    });
    book.appendChild(h('div', { class: 'tm-sec' }, 'Whispers'));
    book.appendChild(h('div', { class: 'muted small' }, `Riddles for pairs you haven't found. Listen closer (${WHISPER_COST} Nanites) to hear one of the two ingredients.`));
    const unknown = ALCHEMY.map((r, i) => i).filter((i) => !known.has(i));
    const day = Math.floor((S.playTime || 0) / 180);
    const shown = [...new Set([...Object.keys(reveal).map(Number).filter((i) => !known.has(i)), ...[0, 1, 2].map((k) => unknown[(day + k * 7) % Math.max(1, unknown.length)])])].filter((i) => i != null && !known.has(i)).slice(0, 4);
    for (const i of shown) {
      const r = ALCHEMY[i];
      const rev = reveal[i];
      book.appendChild(h('div', { class: 'tm-whisper' }, h('div', { class: 'lore' }, '“' + r.hint + '”'),
        rev ? h('div', { class: 'small' }, 'One of them is ', h('b', { class: 'dreamy' }, ITEMS[r.a].name), '.')
          : h('button', { class: 'tm-btn tiny', disabled: inv.nanites >= WHISPER_COST ? null : true, onclick: () => { inv.remove('nanites', WHISPER_COST); reveal[i] = true; g.audio.tone(880, 0.3, 'sine', 0.05, 0.7); this.render(); } }, `Listen closer · ${WHISPER_COST} Nanites`)));
    }
    if (tried.size) {
      book.appendChild(h('div', { class: 'tm-sec' }, 'Tried, and nothing happened'));
      book.appendChild(h('div', { class: 'small muted' }, [...tried].slice(-12).reverse().map((k) => k.split('|').map((id) => (ITEMS[id] ? ITEMS[id].name : id)).join(' + ')).join(' · ')));
    }
    this.body.append(left, book);
  }

  // ------------------------------------------------------------------ blocks
  _blocks() {
    const g = this.game, inv = this.inv;
    const hot = h('div', { class: 'tm-hotbar' });
    inv.hotbar.forEach((id, i) => {
      hot.appendChild(h('div', { class: 'tm-slot' + (this.hotSel === i ? ' sel' : ''), onclick: () => { this.hotSel = i; this.render(); } },
        h('span', { class: 'tm-key' }, String(i + 1)), id ? h('img', { src: getBlockIcon(id), alt: '' }) : null, id ? h('span', { class: 'tm-n' }, fmt(inv.blockCount(id))) : null));
    });
    const ids = Object.keys(inv.blocks).map(Number).filter((id) => inv.blocks[id] > 0).sort((a, b) => BLOCKS[a].name.localeCompare(BLOCKS[b].name));
    const bag = h('div', { class: 'tm-grid', 'data-scroll': 'bag' }, ids.map((id) => h('div', { class: 'tm-slot' + (this.blockSel === id ? ' sel' : ''), title: BLOCKS[id].name,
      onclick: () => { this.blockSel = id; inv.hotbar[this.hotSel] = id; g.selectedHot = this.hotSel; g.audio.ui(); inv.changed(); this.render(); } },
    h('img', { src: getBlockIcon(id), alt: '' }), h('span', { class: 'tm-n' }, fmt(inv.blocks[id])))));
    const left = h('div', { class: 'tm-col grow' },
      h('div', { class: 'tm-sec' }, 'Hotbar · pick a slot, then a block to put in it'), hot,
      h('div', { class: 'tm-sec' }, `Block bag · ${ids.length} kinds`),
      ids.length ? bag : h('div', { class: 'tm-empty-line' }, 'Your block bag is empty. Switch the multi-tool to Builder (Q) and break blocks to collect them - every block of every world can be carried and placed.'));
    const id = this.blockSel ?? inv.hotbar[this.hotSel];
    const right = h('div', { class: 'tm-card tm-detail' });
    if (id) {
      const makers = RECIPES.filter((r) => r.out[0] === 'block:' + id);
      right.append(h('div', { class: 'tm-dhead' }, icon('block:' + id, 'lg'), h('div', {}, h('div', { class: 'tm-cat' }, 'Block'), h('div', { class: 'tm-h' }, BLOCKS[id].name),
        h('div', { class: 'muted small' }, `In your bag: ${fmt(inv.blockCount(id))}`))));
      if (makers.length) {
        right.appendChild(h('div', { class: 'tm-sec' }, 'Make more'));
        for (const r of makers) right.appendChild(h('div', { class: 'tm-line link', onclick: () => this.go('crafting', { craftSel: r.id, craftGroup: recipeGroup(r), craftQuery: '' }) }, h('span', { class: 'tm-k' }, '⚒'), h('span', {}, `${outName(r.out)} from ${r.in.map(([i, n]) => `${n} ${nameOf(i)}`).join(' + ')}`), h('span', { class: 'tm-go' }, '›')));
      }
    } else right.append(h('div', { class: 'tm-empty-ico' }, '▣'), h('div', { class: 'tm-h' }, 'Building'), h('p', { class: 'muted' }, 'Blocks take on the colours of whatever world they are placed in. Build a poolroom on a toxic moon; it will remember being somewhere else.'));
    right.appendChild(h('div', { class: 'tm-tip' }, h('b', {}, 'Controls'), ' Q: Builder mode · Left click: collect a block · Right click: place · 1-9 or wheel: pick a hotbar slot'));
    this.body.append(left, right);
  }

  // ------------------------------------------------------------------ codex
  _codex() {
    const inv = this.inv;
    const seen = new Set([...(inv.seen || []), ...inv.slots.filter(Boolean).map((s) => s.id)]);
    const all = Object.keys(ITEMS);
    const matchCat = (id) => (this.cat === 'all' ? true : this.cat === 'food' ? ITEMS[id].cat === 'food' : ITEMS[id].cat === this.cat);
    const q = (this.codexQuery || '').toLowerCase();
    const list = all.filter((id) => seen.has(id) && matchCat(id) && (!q || ITEMS[id].name.toLowerCase().includes(q)));
    list.sort((a, b) => ITEMS[a].name.localeCompare(ITEMS[b].name));
    const wrap = h('div', { class: 'tm-col grow' },
      h('div', { class: 'tm-chips' }, CATS.map(([id, l]) => h('span', { class: 'tm-chip' + (this.cat === id ? ' on' : ''), onclick: () => { this.cat = id; this.render(); } }, l)),
        h('span', { class: 'tm-spacer' }), h('span', { class: 'muted small' }, `${seen.size} of ${all.length} known`)),
      h('input', { class: 'tm-search', type: 'search', placeholder: 'Search items…', value: this.codexQuery || '', onchange: (e) => { this.codexQuery = e.target.value; this.render(); } }),
      h('div', { class: 'tm-codex', 'data-scroll': 'codex' }, list.map((id) => h('div', { class: 'tm-cx' + (this.codexSel === id ? ' sel' : ''), onclick: () => { this.codexSel = id; this.game.audio.ui(); this.render(); } },
        icon(id, 'sm'), h('div', {}, h('div', {}, ITEMS[id].name), h('div', { class: 'muted small' }, CAT_LABEL[ITEMS[id].cat] || ITEMS[id].cat)), inv.count(id) ? h('span', { class: 'tm-n2' }, fmt(inv.count(id))) : null)),
      all.length - seen.size > 0 ? h('div', { class: 'tm-cx unknown' }, h('div', { class: 'tm-ico sm' }, '?'), h('div', { class: 'muted' }, `${all.length - seen.size} things you haven't found yet`)) : null));
    const right = this.codexSel && ITEMS[this.codexSel] ? this._itemCard(this.codexSel) : h('div', { class: 'tm-card tm-detail empty' }, h('div', { class: 'tm-empty-ico' }, '☰'), h('div', { class: 'tm-h' }, 'The Codex'),
      h('p', { class: 'muted' }, 'Everything you have ever picked up is written down here, even after you have used it or sold it. Select one to see what it is for and where it comes from.'));
    this.body.append(wrap, right);
  }

  // ------------------------------------------------------------------ discoveries
  _discoveries() {
    const g = this.game, info = g.discoveryInfo(), D = g.state.discoveries;
    const left = h('div', { class: 'tm-col grow', 'data-scroll': 'disc' });
    if (info.planet) {
      const P = info.planet;
      const back = () => this.open('discoveries');
      const fFound = info.fauna.filter((f) => f.found).length, flFound = info.flora.filter((f) => f.found).length;
      left.appendChild(h('div', { class: 'tm-card' },
        h('div', { class: 'tm-up-head' }, h('div', {}, h('div', { class: 'tm-cat' }, `${P.params.adjective} ${P.biomeLabel}`), h('div', { class: 'tm-h' }, g.nameOf(P))),
          P.isStation ? null : h('button', { class: 'tm-btn tiny', onclick: () => this.menus.prompt('Rename planet', g.nameOf(P), (v) => g.rename(P, v), back) }, 'Rename (+250u)')),
        h('div', { class: 'tm-two' },
          h('div', {}, h('div', { class: 'tm-life-top' }, h('span', {}, 'Fauna'), h('b', {}, `${fFound}/${info.fauna.length}`)), bar(fFound / Math.max(1, info.fauna.length) * 100, 'good')),
          h('div', {}, h('div', { class: 'tm-life-top' }, h('span', {}, 'Flora'), h('b', {}, `${flFound}/${info.flora.length}`)), bar(flFound / Math.max(1, info.flora.length) * 100, 'good'))),
        h('div', { class: 'muted small' }, 'Scan creatures and plants with the Analysis Visor (V, then hold left click) to catalogue them.')));
      const fauna = h('div', { class: 'tm-card' }, h('div', { class: 'tm-sec' }, 'Fauna'));
      for (const f of info.fauna) {
        fauna.appendChild(h('div', { class: 'tm-line' }, h('span', { class: 'tm-k' }, f.found ? '●' : '○'), h('span', { class: f.found ? '' : 'muted' }, f.found ? g.nameOf(f.sp) : 'Undiscovered'),
          h('span', { class: 'muted small tm-right' }, f.found ? `${f.sp.temper} · ${f.sp.diet} · ${f.sp.rarity}` : ''),
          f.found ? h('button', { class: 'tm-btn tiny', onclick: () => this.menus.prompt('Rename species', g.nameOf(f.sp), (v) => g.rename(f.sp, v), back) }, '✎') : null));
      }
      const flora = h('div', { class: 'tm-card' }, h('div', { class: 'tm-sec' }, 'Flora'));
      for (const f of info.flora) flora.appendChild(h('div', { class: 'tm-line' }, h('span', { class: 'tm-k' }, f.found ? '●' : '○'), h('span', { class: f.found ? '' : 'muted' }, f.found ? f.name : 'Undiscovered'), h('span', { class: 'muted small tm-right' }, f.found ? f.kind : '')));
      left.append(fauna, flora);
    } else left.appendChild(h('div', { class: 'tm-card' }, h('div', { class: 'tm-h' }, 'In space'), h('p', { class: 'muted' }, 'Land on a planet to see its creatures and plants.')));
    const stat = (k, v) => h('div', { class: 'tm-stat' }, h('b', {}, v), h('span', {}, k));
    const zones = Object.values(D.zones || {});
    const right = h('div', { class: 'tm-card tm-detail', 'data-scroll': 'atlas' },
      h('div', { class: 'tm-cat' }, 'Atlas of the dream'), h('div', { class: 'tm-h' }, 'Everywhere you have been'),
      h('div', { class: 'tm-stats' }, stat('Systems', String(Object.keys(D.systems).length)), stat('Planets', String(Object.keys(D.planets).length)),
        stat('Species', String(Object.keys(D.creatures).length)), stat('Flora', String(Object.keys(D.flora).length)), stat('Dream places', String(zones.length))),
      h('div', { class: 'tm-life-top' }, h('span', {}, 'Distance to the Dream Core'), h('b', {}, g.coreDistanceLabel())));
    if (zones.length) {
      right.appendChild(h('div', { class: 'tm-sec' }, 'Dream journal'));
      for (const z of zones.slice(-8).reverse()) right.appendChild(h('div', { class: 'tm-line' }, h('span', { class: 'tm-k' }, '✧'), h('span', {}, z.name), h('span', { class: 'muted small tm-right' }, z.planet)));
    }
    right.appendChild(h('div', { class: 'tm-sec' }, 'Planets'));
    for (const p of Object.values(D.planets).slice(-12).reverse()) right.appendChild(h('div', { class: 'tm-line' }, h('span', { class: 'tm-k' }, '◎'), h('span', {}, p.custom || p.name), h('span', { class: 'muted small tm-right' }, p.biome)));
    this.body.append(left, right);
  }

  // ------------------------------------------------------------------ journey
  _journey() {
    const g = this.game;
    const log = g.questLog();
    const cur = log.find((q) => q.current);
    const rk = g.missions.rank();
    const left = h('div', { class: 'tm-col grow', 'data-scroll': 'journey' });
    if (cur) left.appendChild(h('div', { class: 'tm-card tm-next' }, h('div', { class: 'tm-cat' }, 'Next step'), h('div', { class: 'tm-h' }, cur.title), h('p', {}, cur.desc)));
    const path = h('div', { class: 'tm-card' }, h('div', { class: 'tm-sec' }, `The Lucid Path · ${log.filter((q) => q.done).length}/${log.length}`));
    for (const q of log) path.appendChild(h('div', { class: 'tm-line' + (q.current ? ' current' : '') + (!q.done && !q.current ? ' faded' : '') },
      h('span', { class: 'tm-k' }, q.done ? '✓' : q.current ? '▸' : '·'), h('span', {}, q.title)));
    left.appendChild(path);
    left.appendChild(h('div', { class: 'tm-card' }, h('div', { class: 'tm-sec' }, 'Contracts'),
      h('div', { class: 'tm-life-top' }, h('span', {}, `Dreamwalker rank: ${rk.title}`), h('b', {}, `${rk.done} done`)),
      rk.next ? bar(rk.done / rk.next * 100, 'warn') : null,
      h('div', { class: 'muted small' }, rk.next ? `${rk.next - rk.done} more for the next rank. Take contracts at a station's mission board.` : 'The highest rank there is.')));
    const lore = g.state.lore.slice().reverse();
    const right = h('div', { class: 'tm-card tm-detail', 'data-scroll': 'lore' }, h('div', { class: 'tm-cat' }, `${lore.length} remembered`), h('div', { class: 'tm-h' }, 'Fragments'));
    if (!lore.length) right.appendChild(h('p', { class: 'muted' }, 'Touch monoliths, read terminals and dream memories to remember.'));
    for (const l of lore) right.appendChild(h('div', { class: 'lore tm-lore' }, l));
    this.body.append(left, right);
  }
}
