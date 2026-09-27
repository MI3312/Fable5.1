// Menus: title, loading, inventory (exosuit / blocks / fabricate / alchemy / tech /
// discoveries / journey), pause, settings, dialogs, space station, death, ending.
import { h, clear, fmt } from './dom.js';
import { ITEMS } from '../data/items.js';
import { BLOCKS, isPlaceable } from '../world/blocks.js';
import { getBlockIcon } from '../world/atlas.js';
import { RECIPES, ALCHEMY, UPGRADES, outLabel } from '../data/recipes.js';

const TABS = [
  ['exosuit', 'Exosuit'], ['blocks', 'Blocks'], ['fabricate', 'Fabricate'], ['alchemy', 'Apotheosis'],
  ['tech', 'Technology'], ['discoveries', 'Discoveries'], ['journey', 'Journey'],
];

function itemTile(id, n, onClick, selected) {
  const it = ITEMS[id];
  const el = h('div', { class: 'slot' + (selected ? ' sel' : ''), onclick: onClick, title: it ? it.name : id },
    h('div', { class: 'sym', style: { background: it ? it.color : '#555' } }, it ? it.symbol : '?'),
    n != null ? h('span', { class: 'n' }, fmt(n)) : null);
  return el;
}

function blockTile(id, n, onClick, selected) {
  return h('div', { class: 'slot' + (selected ? ' sel' : ''), onclick: onClick, title: BLOCKS[id].name },
    h('img', { src: getBlockIcon(id), alt: '' }), n != null ? h('span', { class: 'n' }, fmt(n)) : null);
}

function outTile(out, onClick) {
  const [id, n] = out;
  if (id.startsWith('block:')) return blockTile(Number(id.slice(6)), n, onClick);
  if (id === 'nanites') return h('div', { class: 'slot' }, h('div', { class: 'sym', style: { background: '#7ef0ff' } }, 'Nn'), h('span', { class: 'n' }, n));
  if (id === 'lore') return h('div', { class: 'slot' }, h('div', { class: 'sym', style: { background: '#ffd9a8' } }, '✧'));
  return itemTile(id, n, onClick);
}

export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.layer = h('div', {});
    root.appendChild(this.layer);
    this.open = null; // 'inventory' | 'pause' | 'dialog' | 'station' | 'galaxy' | ...
    this.tab = 'exosuit';
    this.sel = null;
    this.hotSel = 0;
    this.alch = [null, null];
    this.fabFilter = 'craft';
  }

  anyOpen() { return !!this.open; }

  _overlay(content, cls = 'overlay') {
    this.closeAll(true);
    const o = h('div', { class: cls }, content);
    this.layer.appendChild(o);
    this.current = o;
    return o;
  }

  closeAll(silent) {
    clear(this.layer);
    this.current = null;
    const was = this.open;
    this.open = null;
    if (!silent && was && this.game.onMenuClosed) this.game.onMenuClosed(was);
  }

  // ---------------- title ----------------
  showTitle(hasSave, lastSeed) {
    this.closeAll(true);
    const seedInput = h('input', { type: 'text', value: String(lastSeed || Math.floor(Math.random() * 1e9)), maxlength: '12', spellcheck: 'false' });
    const menu = h('div', { class: 'title-menu interactive' },
      hasSave ? h('button', { class: 'btn primary', onclick: () => { this.game.audio.ui(); this.game.continueGame(); } }, '▸ Continue Dream') : null,
      h('button', { class: 'btn' + (hasSave ? '' : ' primary'), onclick: () => {
        const go = () => { this.game.audio.ui(); this.game.newGame(seedInput.value.trim()); };
        if (hasSave) this.dialog('Begin a new dream?', 'Your current journey will be overwritten.', [{ label: 'Cancel', action: () => this.showTitle(hasSave, seedInput.value) }, { label: 'New Dream', primary: true, action: go }]);
        else go();
      } }, '✦ New Dream'),
      h('div', { class: 'seed-row' }, 'SEED', seedInput, h('button', { class: 'btn small', onclick: () => { seedInput.value = String(Math.floor(Math.random() * 1e9)); } }, '⟳')),
      h('button', { class: 'btn', onclick: () => this.showSettings(() => this.showTitle(hasSave, seedInput.value)) }, '⚙ Settings'),
      h('button', { class: 'btn', onclick: () => this.showControls(() => this.showTitle(hasSave, seedInput.value)) }, '⌨ Controls'),
    );
    // now and then the subtitle says something else
    const subtitle = h('div', { class: 'subtitle' }, 'an infinite dream of blocks and stars');
    const WRONG = ['something is standing in the fog', 'do not look behind you', 'it was waving at you', 'the night is wrong', 'you are not the only one dreaming', 'it knows where the light is'];
    clearInterval(this.titleTimer);
    this.titleTimer = setInterval(() => {
      if (!subtitle.isConnected) { clearInterval(this.titleTimer); return; }
      if (Math.random() > 0.35) return;
      subtitle.textContent = WRONG[Math.floor(Math.random() * WRONG.length)];
      subtitle.classList.add('wrong');
      setTimeout(() => { subtitle.textContent = 'an infinite dream of blocks and stars'; subtitle.classList.remove('wrong'); }, 380);
    }, 3500);
    const el = h('div', { id: 'title-screen' },
      h('div', { class: 'logo' }, 'LUCID SKY'),
      subtitle,
      menu,
      h('div', { class: 'title-foot' }, 'Explore procedurally generated voxel worlds · Mine · Build · Dream · Travel to the Dream Core'),
    );
    this.layer.appendChild(el);
    this.open = 'title';
  }

  // ---------------- loading ----------------
  showLoading(text, sub) {
    if (!this.loadingEl) {
      this.loadingBar = h('i');
      this.loadingText = h('div', { class: 'lt' });
      this.loadingSub = h('div', { class: 'ls' });
      this.loadingHint = h('div', { class: 'lh' });
      this.loadingEl = h('div', { class: 'loading' }, this.loadingText, h('div', { class: 'lb' }, this.loadingBar), this.loadingSub, this.loadingHint);
      this.root.appendChild(this.loadingEl);
    }
    this.loadingEl.classList.remove('hidden');
    this.loadingText.textContent = text;
    this.loadingSub.textContent = sub || '';
    this.loadingBar.style.width = '0%';
    const HINTS = [
      'Light keeps some things away. Not all of them.',
      'If something waves at you from the fog, do not go to it.',
      'Your tool listens. When it starts to beep, stop and look around.',
      'Some things only move when you are not looking. Others only when you are.',
      'The fog does not always stay where it is.',
      'Stand still among the Kodama. They are shy, not unkind.',
      'Your ship is the one place they will not follow.',
      'The ground in Naraka is soft for a reason. Keep moving.',
      'If the sky turns the wrong colour, it may be time to leave.',
      'Something very large is walking out there. It is not interested in you. Probably.',
    ];
    this.loadingHint.textContent = HINTS[Math.floor(Math.random() * HINTS.length)];
  }
  setLoading(p) { if (this.loadingBar) this.loadingBar.style.width = Math.round(p * 100) + '%'; }
  hideLoading() { if (this.loadingEl) this.loadingEl.classList.add('hidden'); }

  showClickToPlay(v) {
    if (!this.ctp) {
      this.ctp = h('div', { class: 'click-to-play interactive', onclick: () => this.game.resume() },
        h('div', { class: 'big' }, 'CLICK TO RETURN TO THE DREAM'), h('div', { class: 'small' }, 'Esc: menu · Tab: inventory · M: galaxy map'));
      this.root.appendChild(this.ctp);
    }
    this.ctp.classList.toggle('hidden', !v);
  }

  // ---------------- generic dialog ----------------
  dialog(title, body, buttons = [{ label: 'Close', primary: true }], onClose) {
    const btns = h('div', { class: 'dbtns' });
    const el = h('div', { class: 'dialog interactive' }, h('div', { class: 'dh' }, title), h('div', { class: 'db' }, body), btns);
    this._overlay(el);
    this.open = 'dialog';
    for (const b of buttons) {
      btns.appendChild(h('button', { class: 'btn small center' + (b.primary ? ' primary' : ''), onclick: () => {
        this.game.audio.ui();
        if (!b.keepOpen) this.closeAll();
        if (b.action) b.action();
        if (onClose && !b.keepOpen) onClose();
      } }, b.label));
    }
  }

  prompt(title, value, onOk, back) {
    const inp = h('input', { type: 'text', value: value || '', maxlength: '28', spellcheck: 'false', style: { width: '100%', background: 'rgba(0,0,0,0.35)', color: 'var(--text)', border: '1px solid var(--line)', padding: '10px', fontFamily: 'var(--font)', fontSize: '18px' } });
    const done = (ok) => { const v = inp.value.trim(); this.closeAll(true); if (ok && v) onOk(v); if (back) back(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); e.stopPropagation(); });
    const el = h('div', { class: 'dialog interactive' }, h('div', { class: 'dh' }, title), h('div', { class: 'db' }, inp),
      h('div', { class: 'dbtns' }, h('button', { class: 'btn small center', onclick: () => done(false) }, 'Cancel'), h('button', { class: 'btn small center primary', onclick: () => done(true) }, 'Upload name')));
    this._overlay(el);
    this.open = 'dialog';
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
  }

  // ---------------- pause ----------------
  openPause() {
    const g = this.game;
    const el = h('div', { class: 'dialog interactive' },
      h('div', { class: 'dh' }, 'Paused'),
      h('div', { class: 'db' }, `${g.locationLabel()}\nSeed ${g.state.seed} · ${g.state.jumps} warps · ${fmt(g.inventory.units)} units`),
      h('div', { class: 'title-menu', style: { marginTop: '0' } },
        h('button', { class: 'btn primary', onclick: () => { g.audio.ui(); this.closeAll(); g.resume(); } }, '▸ Resume'),
        h('button', { class: 'btn', onclick: () => { g.saveGame(true); } }, '⇩ Save'),
        h('button', { class: 'btn', onclick: () => this.showSettings(() => this.openPause()) }, '⚙ Settings'),
        h('button', { class: 'btn', onclick: () => this.showControls(() => this.openPause()) }, '⌨ Controls'),
        h('button', { class: 'btn', onclick: () => { g.saveGame(false); g.quitToTitle(); } }, '⏏ Save & Quit to Title'),
      ));
    this._overlay(el);
    this.open = 'pause';
  }

  showSettings(back) {
    const g = this.game;
    const s = g.settings;
    const rows = [];
    const slider = (label, key, min, max, step, fmtFn = (v) => v) => {
      const val = h('span', { class: 'muted' }, fmtFn(s[key]));
      const inp = h('input', { type: 'range', min, max, step, value: s[key], oninput: (e) => { s[key] = Number(e.target.value); val.textContent = fmtFn(s[key]); g.applySettings(); } });
      rows.push(h('span', {}, label), inp, val);
    };
    slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => Number(v).toFixed(2));
    slider('Render distance', 'renderDist', 3, 12, 1, (v) => v + ' ch');
    slider('Field of view', 'fov', 55, 100, 1, (v) => v + '°');
    slider('Render scale', 'renderScale', 0.35, 1, 0.05, (v) => Math.round(v * 100) + '%');
    slider('Graphics', 'gfx', 0, 2, 1, (v) => ['Low', 'High (AO + bloom)', 'Ultra'][Number(v)] || 'Ultra');
    slider('Master volume', 'master', 0, 1, 0.05, (v) => Math.round(v * 100));
    slider('Music volume', 'music', 0, 1, 0.05, (v) => Math.round(v * 100));
    slider('Effects volume', 'sfx', 0, 1, 0.05, (v) => Math.round(v * 100));
    slider('Dream filter', 'dreamFx', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    slider('Fear intensity', 'fear', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    const inv = h('input', { type: 'checkbox', checked: s.invertY ? true : null, onchange: (e) => { s.invertY = e.target.checked; g.applySettings(); } });
    rows.push(h('span', {}, 'Invert mouse Y'), inv, h('span'));
    const fade = h('input', { type: 'checkbox', checked: s.hudFade !== false ? true : null, onchange: (e) => { s.hudFade = e.target.checked; g.applySettings(); } });
    rows.push(h('span', {}, 'Fade HUD when idle'), fade, h('span'));
    const el = h('div', { class: 'dialog interactive', style: { width: 'min(720px, 94vw)' } },
      h('div', { class: 'dh' }, 'Settings'),
      h('div', { class: 'db' }, h('div', { class: 'settings-grid' }, rows)),
      h('div', { class: 'dbtns' }, h('button', { class: 'btn small center primary', onclick: () => { g.saveSettings(); back(); } }, 'Done')));
    this._overlay(el);
    this.open = this.open || 'settings';
  }

  showControls(back) {
    const C = [
      ['WASD', 'Move / ship throttle & roll'], ['Mouse', 'Look / steer ship'], ['Space', 'Jump · hold for jetpack · ship: take off / pulse drive (space)'],
      ['Shift', 'Sprint / ship boost'], ['LMB', 'Use tool: mine · collect block · fire'], ['RMB', 'Place block (Builder)'],
      ['Q', 'Cycle multi-tool mode (Mining / Builder / Boltcaster)'], ['1–9 · Wheel', 'Select hotbar block'],
      ['F', 'Scanner pulse (resources, points of interest)'], ['V', 'Analysis visor (hold LMB on creatures/flora to discover)'],
      ['E', 'Interact · board / exit ship · land · dock'], ['R', 'Quick recharge life support & hazard protection'],
      ['T', 'Toggle headlamp'], ['G', 'Summon the Roamer exocraft (once installed)'], ['L', 'Roamer headlights'], ['Tab / I', 'Inventory, fabrication, alchemy, tech'], ['M', 'Galaxy map'], ['Esc', 'Pause menu'],
      ['F2', 'Hide HUD (photo mode)'],
    ];
    const el = h('div', { class: 'dialog interactive', style: { width: 'min(720px, 94vw)' } },
      h('div', { class: 'dh' }, 'Controls'),
      h('div', { class: 'db' }, h('div', { class: 'controls-table' }, C.flatMap(([k, d]) => [h('span', { class: 'k' }, k), h('span', {}, d)]))),
      h('div', { class: 'dbtns' }, h('button', { class: 'btn small center primary', onclick: back }, 'Back')));
    this._overlay(el);
    this.open = this.open || 'controls';
  }

  // ---------------- inventory ----------------
  openInventory(tab) {
    if (tab) this.tab = tab;
    this.sel = null;
    const head = h('div', { class: 'panel-head' }, h('div', { class: 'ptitle' }, 'EXOSUIT'));
    for (const [id, label] of TABS) {
      head.appendChild(h('div', { class: 'tab' + (this.tab === id ? ' on' : ''), onclick: () => { this.game.audio.ui(); this.tab = id; this.sel = null; this.openInventory(); } }, label));
    }
    head.appendChild(h('div', { class: 'panel-close', onclick: () => { this.closeAll(); } }, 'CLOSE [TAB]'));
    this.body = h('div', { class: 'panel-body' });
    const panel = h('div', { class: 'panel interactive' }, head, this.body);
    this._overlay(panel);
    this.open = 'inventory';
    this.renderTab();
  }

  refresh() { if (this.open === 'inventory') this.renderTab(); else if (this.open === 'station') this.renderStation(); }

  renderTab() {
    const b = clear(this.body);
    const g = this.game;
    const inv = g.inventory;
    const currency = h('div', { class: 'currency' }, h('span', {}, 'Units ', h('b', {}, fmt(inv.units))), h('span', {}, 'Nanites ', h('b', { class: 'nan' }, fmt(inv.nanites))));
    switch (this.tab) {
      case 'exosuit': {
        const grid = h('div', { class: 'grid' });
        inv.slots.forEach((s, i) => {
          if (s) grid.appendChild(itemTile(s.id, s.n, () => { this.sel = i; this.renderTab(); }, this.sel === i));
          else grid.appendChild(h('div', { class: 'slot empty' }));
        });
        const left = h('div', { class: 'col grow' }, currency,
          h('div', { class: 'section-title' }, `Cargo · ${inv.slots.filter(Boolean).length}/${inv.capacity} slots`), grid,
          h('div', { class: 'row-flex' }, h('button', { class: 'btn small', onclick: () => { inv.sortSlots(); this.renderTab(); } }, 'Sort')));
        b.appendChild(left);
        b.appendChild(this._exoDetail());
        break;
      }
      case 'blocks': {
        const hot = h('div', { class: 'grid' });
        inv.hotbar.forEach((id, i) => {
          const el = id ? blockTile(id, inv.blockCount(id), () => { this.hotSel = i; this.renderTab(); }, this.hotSel === i)
            : h('div', { class: 'slot' + (this.hotSel === i ? ' sel' : ''), onclick: () => { this.hotSel = i; this.renderTab(); } }, h('span', { class: 'muted' }, String(i + 1)));
          hot.appendChild(el);
        });
        const bag = h('div', { class: 'grid' });
        const ids = Object.keys(inv.blocks).map(Number).filter((id) => inv.blocks[id] > 0).sort((a, c) => a - c);
        for (const id of ids) {
          bag.appendChild(blockTile(id, inv.blocks[id], () => {
            inv.hotbar[this.hotSel] = id;
            g.selectedHot = this.hotSel;
            g.audio.ui();
            inv.changed();
            this.renderTab();
          }));
        }
        if (!ids.length) bag.appendChild(h('div', { class: 'muted' }, 'Your block bag is empty. Switch the multi-tool to BUILDER (Q) and break blocks to collect them - every block of every world can be carried and placed.'));
        b.appendChild(h('div', { class: 'col grow' },
          h('div', { class: 'section-title' }, 'Hotbar - select a slot, then click a block to assign'), hot,
          h('div', { class: 'section-title' }, `Block Bag · ${ids.length} kinds`), bag,
          h('div', { class: 'lore' }, 'Blocks take on the dream-colours of whatever world they are placed in. Build a poolroom on a toxic moon; it will remember being somewhere else.')));
        break;
      }
      case 'fabricate': {
        const filters = [['refine', 'Refiner'], ['craft', 'Products'], ['block', 'Block Fabricator']];
        const bar = h('div', { class: 'row-flex' }, filters.map(([f, l]) => h('button', { class: 'btn small' + (this.fabFilter === f ? ' primary' : ''), onclick: () => { this.fabFilter = f; this.renderTab(); } }, l)));
        const list = h('div', { class: 'recipes' });
        for (const r of RECIPES.filter((x) => x.type === this.fabFilter)) list.appendChild(this._recipeRow(r));
        b.appendChild(h('div', { class: 'col grow' }, currency, bar, list));
        break;
      }
      case 'alchemy': this._renderAlchemy(b); break;
      case 'tech': this._renderTech(b); break;
      case 'discoveries': this._renderDiscoveries(b); break;
      case 'journey': this._renderJourney(b); break;
    }
  }

  _exoDetail() {
    const g = this.game, inv = g.inventory;
    const d = h('div', { class: 'detail' });
    const s = this.sel != null ? inv.slots[this.sel] : null;
    if (s) {
      const it = ITEMS[s.id];
      d.append(h('div', { class: 'dc' }, it.cat), h('div', { class: 'dn' }, it.name), h('div', { class: 'dd' }, it.desc),
        h('div', { class: 'muted' }, `Held: ${s.n} · Value ${fmt(it.value)}u each`));
      const acts = h('div', { class: 'row-flex' });
      const use = g.itemUse(s.id);
      if (use) acts.appendChild(h('button', { class: 'btn small primary', onclick: () => { g.useItem(s.id); this.renderTab(); } }, use));
      acts.appendChild(h('button', { class: 'btn small', onclick: () => { inv.remove(s.id, 1); this.renderTab(); } }, 'Discard 1'));
      acts.appendChild(h('button', { class: 'btn small', onclick: () => { this.dialog('Discard all?', `Throw away ${s.n} ${it.name}?`, [{ label: 'Cancel', action: () => this.openInventory() }, { label: 'Discard', primary: true, action: () => { inv.remove(s.id, s.n); this.sel = null; this.openInventory(); } }]); } }, 'Discard all'));
      d.appendChild(acts);
    } else {
      const st = g.player.stats;
      d.append(h('div', { class: 'dc' }, 'Exosuit'), h('div', { class: 'dn' }, 'Life Systems'));
      const rows = [
        ['Health', st.health], ['Shield', st.shield], ['Hazard Protection', st.hazard], ['Life Support', st.life], ['Jetpack', st.jet],
      ];
      for (const [k, v] of rows) d.appendChild(h('div', { class: 'list-row' }, h('span', {}, k), h('span', { class: 'muted' }, Math.round(v) + '%')));
      d.appendChild(h('div', { class: 'section-title' }, 'Recharge'));
      const rc = (label, stat, item) => {
        const has = inv.count(item);
        return h('button', { class: 'btn small', disabled: has <= 0 ? true : null, onclick: () => { g.rechargeStat(stat, item); this.renderTab(); } }, `${label} · ${ITEMS[item].name} (${has})`);
      };
      d.append(rc('Life Support', 'life', 'oxygen'), rc('Life Support', 'life', 'life_support_gel'),
        rc('Hazard', 'hazard', 'sodium'), rc('Hazard', 'hazard', 'sodium_nitrate'), rc('Hazard', 'hazard', 'ion_battery'));
      d.appendChild(h('div', { class: 'dd' }, 'Select an item to inspect it.'));
    }
    return d;
  }

  _ingredients(list, times = 1) {
    const inv = this.game.inventory;
    return h('div', { class: 'ri' }, list.map(([id, n], i) => {
      const have = inv.count(id);
      const name = ITEMS[id] ? ITEMS[id].name : id;
      return h('span', {}, i ? ' + ' : '', h('span', { class: have >= n * times ? 'ok' : 'no' }, `${n * times} ${name}`), h('span', { class: 'muted' }, ` (${fmt(have)})`));
    }));
  }

  _recipeRow(r) {
    const g = this.game, inv = g.inventory;
    const max = inv.maxCraftable(r.in);
    const btns = h('div', { class: 'row-flex' });
    const mk = (label, n) => h('button', { class: 'btn small', disabled: max < n || n <= 0 ? true : null, onclick: () => { g.craft(r, n); this.renderTab(); } }, label);
    btns.append(mk('×1', 1), mk('×10', 10), mk('Max', max));
    return h('div', { class: 'recipe' + (max < 1 ? ' locked' : '') },
      h('div', {}, h('div', { class: 'rn' }, outLabel(r.out, ITEMS, BLOCKS)), this._ingredients(r.in)),
      btns);
  }

  _renderAlchemy(b) {
    const g = this.game, inv = g.inventory;
    const known = new Set(g.state.alchemyKnown);
    const [a, c] = this.alch;
    const slotA = a ? itemTile(a, null, () => { this.alch[0] = null; this.renderTab(); }) : h('div', { class: 'slot' }, h('span', { class: 'muted' }, 'A'));
    const slotB = c ? itemTile(c, null, () => { this.alch[1] = null; this.renderTab(); }) : h('div', { class: 'slot' }, h('span', { class: 'muted' }, 'B'));
    let preview = h('div', { class: 'slot' }, h('span', { class: 'muted' }, '?'));
    const idx = a && c ? ALCHEMY.findIndex((r) => (r.a === a && r.b === c) || (r.a === c && r.b === a)) : -1;
    if (idx >= 0 && known.has(idx)) preview = outTile(ALCHEMY[idx].out);
    const canTry = a && c && inv.count(a) >= (a === c ? 2 : 1) && inv.count(c) >= 1;
    const bench = h('div', { class: 'alchemy-bench' }, slotA, h('span', { class: 'plus' }, '+'), slotB, h('span', { class: 'arrow' }, '→'), preview,
      h('button', { class: 'btn primary', disabled: canTry ? null : true, onclick: () => { g.alchemy(a, c); this.renderTab(); } }, 'Dream it'));
    const pick = h('div', { class: 'grid' });
    inv.slots.forEach((s) => {
      if (!s) return;
      if (pick.querySelector(`[data-id="${s.id}"]`)) return;
      const t = itemTile(s.id, inv.count(s.id), () => {
        if (!this.alch[0]) this.alch[0] = s.id; else this.alch[1] = s.id;
        g.audio.ui();
        this.renderTab();
      });
      t.dataset.id = s.id;
      pick.appendChild(t);
    });
    const disc = h('div', { class: 'col' });
    ALCHEMY.forEach((r, i) => {
      if (!known.has(i)) return;
      disc.appendChild(h('div', { class: 'list-row' }, h('span', {}, `${ITEMS[r.a].name} + ${ITEMS[r.b].name}`), h('span', { class: 'muted' }, '→ ' + outLabel(r.out, ITEMS, BLOCKS))));
    });
    if (!known.size) disc.appendChild(h('div', { class: 'muted' }, 'No dream recipes remembered yet.'));
    const hints = h('div', { class: 'col' });
    const unknown = ALCHEMY.map((r, i) => i).filter((i) => !known.has(i));
    const day = Math.floor(g.state.playTime / 120);
    for (let k = 0; k < Math.min(3, unknown.length); k++) {
      const r = ALCHEMY[unknown[(day + k * 7) % unknown.length]];
      hints.appendChild(h('div', { class: 'lore' }, '“' + r.hint + '”'));
    }
    b.appendChild(h('div', { class: 'col grow' },
      h('div', { class: 'section-title' }, 'Apotheosis - fuse any two things and see what they become. No recipe book: just dream.'), bench,
      h('div', { class: 'section-title' }, 'Your ingredients (click to place)'), pick));
    b.appendChild(h('div', { class: 'detail' }, h('div', { class: 'dc' }, `Remembered ${known.size}/${ALCHEMY.length}`), disc, h('div', { class: 'section-title' }, 'Whispers'), hints));
  }

  _renderTech(b) {
    const g = this.game, inv = g.inventory, ship = g.ship;
    const shipCol = h('div', { class: 'col grow' });
    shipCol.appendChild(h('div', { class: 'section-title' }, 'Starship'));
    const stat = (k, v) => h('div', { class: 'list-row' }, h('span', {}, k), h('span', { class: 'muted' }, v));
    shipCol.append(
      stat('Launch thrusters', ship.thrustersRepaired ? `${Math.round(ship.fuel.launch)}% fuel` : 'DAMAGED'),
      stat('Pulse engine', `${Math.round(ship.fuel.pulse)}% fuel`),
      stat('Shields', `${Math.round(ship.shield)}%`),
      stat('Hull integrity', `${Math.round(ship.hull)}%`),
      stat('Hyperdrive range', `${g.hyperdriveRange()} ly · ${inv.count('warp_cell')} warp cells · ${inv.count('lucid_core')} lucid cores`),
    );
    const fuelBtns = h('div', { class: 'row-flex' });
    const fb = (label, kind, item) => h('button', { class: 'btn small', disabled: inv.count(item) > 0 ? null : true, onclick: () => { g.refuelShip(kind, item); this.renderTab(); } }, `${label} · ${ITEMS[item].name} (${inv.count(item)})`);
    fuelBtns.append(fb('Launch', 'launch', 'dihydrogen_jelly'), fb('Launch', 'launch', 'launch_fuel'), fb('Launch', 'launch', 'uranium'),
      fb('Pulse', 'pulse', 'tritium'), fb('Shield', 'shield', 'starshield_battery'), fb('Shield', 'shield', 'ferrite'), fb('Hull', 'hull', 'metal_plating'));
    shipCol.appendChild(fuelBtns);
    const upCol = h('div', { class: 'col grow' }, h('div', { class: 'section-title' }, 'Technology upgrades'));
    const list = h('div', { class: 'recipes' });
    for (const u of UPGRADES) {
      const n = g.upgradeCount(u.id);
      const done = (u.once && n > 0) || (u.max && n >= u.max);
      const can = !done && inv.has(u.cost);
      list.appendChild(h('div', { class: 'recipe' + (done ? '' : can ? '' : ' locked') },
        h('div', {}, h('div', { class: 'rn' }, `${u.name}${n && !u.once ? ` (${n})` : ''}`), h('div', { class: 'ri muted' }, u.desc), done ? h('div', { class: 'ri ok' }, 'Installed') : this._ingredients(u.cost)),
        done ? h('span', { class: 'muted' }, '✓') : h('button', { class: 'btn small', disabled: can ? null : true, onclick: () => { g.installUpgrade(u); this.renderTab(); } }, 'Install')));
    }
    upCol.appendChild(list);
    b.append(h('div', { class: 'col', style: { width: '380px', flexShrink: 0 } }, shipCol), upCol);
  }

  _renderDiscoveries(b) {
    const g = this.game;
    const info = g.discoveryInfo();
    const left = h('div', { class: 'col grow' });
    if (info.planet) {
      const back = () => this.openInventory('discoveries');
      left.appendChild(h('div', { class: 'row-flex' }, h('div', { class: 'section-title grow' }, `${g.nameOf(info.planet)} · ${info.planet.params.adjective} ${info.planet.biomeLabel}`),
        info.planet.isStation ? null : h('button', { class: 'btn small', onclick: () => this.prompt('Rename planet', g.nameOf(info.planet), (v) => g.rename(info.planet, v), back) }, 'Rename')));
      left.appendChild(h('div', { class: 'list-row' }, h('span', {}, 'Fauna'), h('span', { class: 'muted' }, `${info.fauna.filter((f) => f.found).length}/${info.fauna.length}`)));
      for (const f of info.fauna) {
        const back = () => this.openInventory('discoveries');
        left.appendChild(h('div', { class: 'list-row' }, h('span', {}, f.found ? g.nameOf(f.sp) : '??????'),
          h('span', { class: 'row-flex' }, h('span', { class: 'muted' }, f.found ? `${f.sp.temper} · ${f.sp.diet} · ${f.sp.rarity}` : 'Undiscovered'),
            f.found ? h('button', { class: 'btn small', onclick: () => this.prompt('Rename species', g.nameOf(f.sp), (v) => g.rename(f.sp, v), back) }, '✎') : null)));
      }
      left.appendChild(h('div', { class: 'list-row' }, h('span', {}, 'Flora'), h('span', { class: 'muted' }, `${info.flora.filter((f) => f.found).length}/${info.flora.length}`)));
      for (const f of info.flora) left.appendChild(h('div', { class: 'list-row' }, h('span', {}, f.found ? f.name : '??????'), h('span', { class: 'muted' }, f.found ? f.kind : 'Undiscovered')));
    } else {
      left.appendChild(h('div', { class: 'muted' }, 'You are not on a planet.'));
    }
    const right = h('div', { class: 'detail' }, h('div', { class: 'dc' }, 'Atlas of the Dream'));
    right.appendChild(h('div', { class: 'list-row' }, h('span', {}, 'Systems visited'), h('span', { class: 'muted' }, String(Object.keys(g.state.discoveries.systems).length))));
    right.appendChild(h('div', { class: 'list-row' }, h('span', {}, 'Planets discovered'), h('span', { class: 'muted' }, String(Object.keys(g.state.discoveries.planets).length))));
    right.appendChild(h('div', { class: 'list-row' }, h('span', {}, 'Species catalogued'), h('span', { class: 'muted' }, String(Object.keys(g.state.discoveries.creatures).length))));
    right.appendChild(h('div', { class: 'list-row' }, h('span', {}, 'Flora catalogued'), h('span', { class: 'muted' }, String(Object.keys(g.state.discoveries.flora).length))));
    right.appendChild(h('div', { class: 'list-row' }, h('span', {}, 'Distance to Dream Core'), h('span', { class: 'muted' }, g.coreDistanceLabel())));
    // the dream places you have wandered into
    const zones = Object.values(g.state.discoveries.zones || {});
    right.appendChild(h('div', { class: 'list-row' }, h('span', {}, 'Dream places entered'), h('span', { class: 'muted' }, String(zones.length))));
    if (zones.length) {
      right.appendChild(h('div', { class: 'section-title' }, 'Dream Journal'));
      for (const z of zones.slice(-8).reverse()) right.appendChild(h('div', { class: 'list-row' }, h('span', {}, z.name), h('span', { class: 'muted' }, z.planet)));
    }
    right.appendChild(h('div', { class: 'section-title' }, 'Planets'));
    const planets = Object.values(g.state.discoveries.planets).slice(-12).reverse();
    for (const p of planets) right.appendChild(h('div', { class: 'list-row' }, h('span', {}, p.custom || p.name), h('span', { class: 'muted' }, p.biome)));
    b.append(left, right);
  }

  _renderJourney(b) {
    const g = this.game;
    const rk = g.missions.rank();
    const left = h('div', { class: 'col grow' }, h('div', { class: 'section-title' }, `Dreamwalker rank: ${rk.title} (${rk.done} contracts)`), h('div', { class: 'section-title' }, 'The Lucid Path'));
    for (const q of g.questLog()) {
      left.appendChild(h('div', { class: 'recipe' + (q.done ? '' : q.current ? '' : ' locked') },
        h('div', {}, h('div', { class: 'rn' }, (q.done ? '✓ ' : q.current ? '▸ ' : '· ') + q.title), h('div', { class: 'ri muted' }, q.desc))));
    }
    const right = h('div', { class: 'col grow' }, h('div', { class: 'section-title' }, 'Remembered fragments'));
    const lore = g.state.lore.slice().reverse();
    if (!lore.length) right.appendChild(h('div', { class: 'muted' }, 'Touch monoliths, read terminals and dream memories to remember.'));
    for (const l of lore) right.appendChild(h('div', { class: 'lore' }, l));
    b.append(left, right);
  }

  // ---------------- station ----------------
  openStation(tab) {
    if (tab) this.stationTab = tab;
    this.stationTab = this.stationTab || 'sell';
    const head = h('div', { class: 'panel-head' }, h('div', { class: 'ptitle' }, this.game.system.station.name.toUpperCase()));
    for (const [id, label] of [['sell', 'Sell'], ['buy', 'Buy'], ['missions', 'Missions'], ['tech', 'Tech Merchant'], ['services', 'Services']]) {
      head.appendChild(h('div', { class: 'tab' + (this.stationTab === id ? ' on' : ''), onclick: () => { this.stationTab = id; this.openStation(); } }, label));
    }
    head.appendChild(h('div', { class: 'panel-close', onclick: () => { this.game.closeStationMenu(); } }, 'CLOSE [ESC]'));
    this.body = h('div', { class: 'panel-body' });
    this._overlay(h('div', { class: 'panel interactive' }, head, this.body));
    this.open = 'station';
    this.renderStation();
  }

  renderStation() {
    const b = clear(this.body);
    const g = this.game, inv = g.inventory;
    const currency = h('div', { class: 'currency' }, h('span', {}, 'Units ', h('b', {}, fmt(inv.units))), h('span', {}, 'Nanites ', h('b', { class: 'nan' }, fmt(inv.nanites))));
    const col = h('div', { class: 'col grow' }, currency);
    b.appendChild(col);
    if (this.stationTab === 'sell') {
      col.appendChild(h('div', { class: 'section-title' }, 'Sell from exosuit'));
      const seen = new Set();
      for (const s of inv.slots) {
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        const it = ITEMS[s.id];
        const n = inv.count(s.id);
        const price = g.sellPrice(s.id);
        col.appendChild(h('div', { class: 'recipe' },
          h('div', {}, h('div', { class: 'rn' }, `${it.name} ×${fmt(n)}`), h('div', { class: 'ri muted' }, `${fmt(price)}u each · ${fmt(price * n)}u total`)),
          h('div', { class: 'row-flex' },
            h('button', { class: 'btn small', onclick: () => { g.sell(s.id, 1); this.renderStation(); } }, 'Sell 1'),
            h('button', { class: 'btn small primary', onclick: () => { g.sell(s.id, n); this.renderStation(); } }, 'Sell all'))));
      }
      if (!seen.size) col.appendChild(h('div', { class: 'muted' }, 'Nothing to sell.'));
    } else if (this.stationTab === 'buy') {
      col.appendChild(h('div', { class: 'section-title' }, 'Station stock'));
      for (const [id, price] of g.stationStock()) {
        const it = ITEMS[id];
        col.appendChild(h('div', { class: 'recipe' },
          h('div', {}, h('div', { class: 'rn' }, it.name), h('div', { class: 'ri muted' }, `${fmt(price)}u · ${it.desc}`)),
          h('div', { class: 'row-flex' },
            h('button', { class: 'btn small', disabled: inv.units >= price ? null : true, onclick: () => { g.buy(id, 1, price); this.renderStation(); } }, 'Buy 1'),
            h('button', { class: 'btn small', disabled: inv.units >= price * 10 ? null : true, onclick: () => { g.buy(id, 10, price); this.renderStation(); } }, 'Buy 10'))));
      }
    } else if (this.stationTab === 'missions') {
      const M = g.missions, rk = M.rank();
      col.appendChild(h('div', { class: 'section-title' }, `Dreamwalker rank: ${rk.title} · ${rk.done} contracts${rk.next ? ` · next rank at ${rk.next}` : ''}`));
      if (M.S.active.length) {
        col.appendChild(h('div', { class: 'section-title' }, 'Your contracts'));
        for (const m of M.S.active) {
          const prog = m.type === 'deliver' ? `${Math.min(inv.count(m.item), m.need)}/${m.need}` : `${m.have}/${m.need}`;
          col.appendChild(h('div', { class: 'recipe' },
            h('div', {}, h('div', { class: 'rn' }, `${m.title} · ${prog}`), h('div', { class: 'ri muted' }, `${m.desc} Reward ${fmt(m.units)}u + ${m.nanites} nanites.`)),
            h('div', { class: 'row-flex' },
              m.type === 'deliver' ? h('button', { class: 'btn small primary', disabled: M.canDeliver(m) ? null : true, onclick: () => { M.deliver(m); this.renderStation(); } }, 'Deliver') : null,
              h('button', { class: 'btn small', onclick: () => { M.abandon(m); this.renderStation(); } }, 'Abandon'))));
        }
      }
      col.appendChild(h('div', { class: 'section-title' }, 'Contracts posted in this system'));
      const offers = M.offers();
      if (!offers.length) col.appendChild(h('div', { class: 'muted' }, 'The board is empty. New contracts are posted as time passes.'));
      for (const o of offers) {
        col.appendChild(h('div', { class: 'recipe' },
          h('div', {}, h('div', { class: 'rn' }, o.title), h('div', { class: 'ri muted' }, `${o.desc} Reward ${fmt(o.units)}u + ${o.nanites} nanites${o.bonus ? ' + ' + ITEMS[o.bonus[0]].name : ''}.`)),
          h('button', { class: 'btn small primary', disabled: M.S.active.length < 3 ? null : true, onclick: () => { M.accept(o); this.renderStation(); } }, 'Accept')));
      }
    } else if (this.stationTab === 'tech') {
      col.appendChild(h('div', { class: 'section-title' }, 'Upgrades for nanites'));
      for (const u of UPGRADES) {
        if (u.id === 'repair_thrusters') continue;
        const n = g.upgradeCount(u.id);
        const done = (u.once && n > 0) || (u.max && n >= u.max);
        const cost = g.naniteCost(u);
        col.appendChild(h('div', { class: 'recipe' + (done ? '' : inv.nanites >= cost ? '' : ' locked') },
          h('div', {}, h('div', { class: 'rn' }, u.name), h('div', { class: 'ri muted' }, u.desc)),
          done ? h('span', { class: 'muted' }, 'Installed ✓') : h('button', { class: 'btn small', disabled: inv.nanites >= cost ? null : true, onclick: () => { g.buyUpgrade(u, cost); this.renderStation(); } }, `${cost} nanites`)));
      }
    } else {
      col.appendChild(h('div', { class: 'section-title' }, 'Services'));
      const srv = (label, desc, cost, fn) => h('div', { class: 'recipe' }, h('div', {}, h('div', { class: 'rn' }, label), h('div', { class: 'ri muted' }, desc)),
        h('button', { class: 'btn small', disabled: inv.units >= cost ? null : true, onclick: () => { fn(); this.renderStation(); } }, cost ? `${fmt(cost)}u` : 'Free'));
      col.append(
        srv('Refill pulse engine', 'Station technicians top up your pulse drive.', 2500, () => g.stationService('pulse', 2500)),
        srv('Refill launch thrusters', 'Fuel the launch thrusters to 100%.', 3000, () => g.stationService('launch', 3000)),
        srv('Recharge starship shields', 'Restore shields to full.', 1500, () => g.stationService('shield', 1500)),
        srv('Repair starship hull', 'Patch every scorch mark the Nightmares left.', 2000, () => g.stationService('hull', 2000)),
        srv('Restore exosuit', 'Health, shield, hazard protection and life support to full.', 800, () => g.stationService('suit', 800)),
        srv('Record journey', 'Save your progress in the station archive.', 0, () => g.saveGame(true)),
      );
      col.appendChild(h('div', { class: 'lore' }, g.stationChatter()));
    }
  }

  // ---------------- death / ending ----------------
  showDeath(onRespawn, why) {
    const T = {
      hollow: ['IT FOUND YOU', 'Something pale was kneeling over you when you woke. Its mouth was open. It is still out there.'],
      walker: ['THE SKY CAME DOWN', 'Something very large passed over you. It did not notice you at all.'],
      maw: ['THE GROUND WAS HUNGRY', 'You woke far from where it closed. Your legs remember.'],
      visitor: ['IT WAS WAVING', 'It looked like someone you knew. It still does, from far enough away.'],
      filament: ['DREAM CLOSED', 'It wore the shape of something harmless. It was waiting for you to come closer.'],
    }[why];
    const beast = {
      sandmaw: ['SWALLOWED', 'It heard you walking. Next time, stand still - or keep running.'],
      spitter: ['DISSOLVED', 'It aimed where you were going. Change direction.'],
      acid: ['DISSOLVED', 'The ground itself was burning.'],
      swarm: ['EATEN BY LIGHT', 'They wanted your lamp. You were holding it.'],
      charge: ['TRAMPLED', 'It pawed the ground first. It always does.'],
      brute: ['TRAMPLED', 'Nothing gets through the front. Make it hit a wall.'],
      stampede: ['STAMPEDE', 'The herd did not see you. There were a great many of them.'],
      diver: ['TAKEN FROM ABOVE', 'Listen for the screech.'],
      lurker: ['IT WAS NOT A ROCK', 'The ore was bait. It usually is.'],
      lightning: ['STRUCK', 'Stay off the high ground when the sky turns white.'],
      meteor: ['THE SKY FELL', 'You were standing exactly where it wanted to land.'],
    }[why];
    const text = T || beast || ['YOU WOKE UP', 'The dream loosened its grip. You drift back to your starship, lighter than before.'];
    const el = h('div', { class: 'death' + (T ? ' horror' : '') }, h('div', { class: 't' }, text[0]),
      h('div', { class: 'muted', style: { fontFamily: 'var(--font-dream)', fontSize: '17px' } }, text[1]),
      h('button', { class: 'btn primary center', onclick: () => { this.closeAll(true); onRespawn(); } }, 'Dream again'));
    this._overlay(el, 'overlay');
    this.open = 'death';
  }

  showEnding(lines, onDone) {
    const el = h('div', { class: 'ending' });
    lines.forEach((l, i) => {
      const p = h('p', { style: { animationDelay: (i * 2.2) + 's' } }, l);
      el.appendChild(p);
    });
    el.appendChild(h('button', { class: 'btn center', style: { opacity: 0, animation: `endFade 2s ${lines.length * 2.2}s forwards` }, onclick: () => { this.closeAll(true); onDone(); } }, 'Keep dreaming'));
    this._overlay(el, 'overlay');
    this.open = 'ending';
  }
}
