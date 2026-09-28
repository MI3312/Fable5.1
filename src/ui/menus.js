// Menus: title, loading, the Tab screen (tabMenu.js), pause, settings, dialogs, space station,
// death, ending.
import { h, clear, fmt } from './dom.js';
import { ITEMS } from '../data/items.js';
import { BLOCKS } from '../world/blocks.js';
import { getBlockIcon } from '../world/atlas.js';
import { UPGRADES } from '../data/recipes.js';
import { DISHES, BUFFS, FISH } from '../data/food.js';
import { SHIP_CLASSES, shipStats, shipName, specLabel, PAINTS } from '../data/ships.js';
import { TabMenu } from './tabMenu.js';

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


export class Menus {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.layer = h('div', {});
    root.appendChild(this.layer);
    this.open = null; // 'inventory' | 'pause' | 'dialog' | 'station' | 'galaxy' | ...
    this.tabs = new TabMenu(this, game);
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
      h('button', { class: 'btn', onclick: () => this.showMultiplayer(() => this.showTitle(hasSave, seedInput.value), true) }, '⚯ Multiplayer'),
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

  // ---------------- Nutrient Processor ----------------
  showCooking() {
    const g = this.game, inv = g.inventory;
    const list = h('div', { class: 'recipes' });
    for (const d of DISHES) {
      const it = ITEMS[d.id];
      const max = inv.maxCraftable(d.in);
      const buff = d.buff ? BUFFS[d.buff[0]] : null;
      const cook = (eat) => {
        if (!g.cook(d)) return;
        if (eat) g.buffs.eat(d.id);
        this.showCooking();
      };
      list.appendChild(h('div', { class: 'recipe' + (max < 1 ? ' locked' : '') },
        h('div', { class: 'row-flex' }, itemTile(d.id, inv.count(d.id) || null),
          h('div', {}, h('div', { class: 'rn' }, it.name),
            h('div', { class: 'muted' }, `${d.heal ? `+${d.heal} health` : ''}${buff ? ` · ${buff.name}: ${buff.desc} for ${Math.round(d.buff[1] / 60)} min` : ''}`),
            this._ingredients(d.in))),
        h('div', { class: 'row-flex' },
          h('button', { class: 'btn small', disabled: max < 1 ? true : null, onclick: () => cook(false) }, 'Cook'),
          h('button', { class: 'btn small primary', disabled: max < 1 ? true : null, onclick: () => cook(true) }, 'Cook & eat'))));
    }
    // the angler's log
    const log = g.state.fishLog || {};
    const species = Object.keys(FISH).filter((id) => !FISH[id].dread || log[id]);
    const caught = species.filter((id) => log[id]);
    const logEl = h('div', { class: 'fishlog' });
    for (const id of species) {
      const r = log[id];
      logEl.appendChild(h('div', { class: 'list-row' + (r ? '' : ' muted') },
        h('span', {}, r ? ITEMS[id].name : '???'),
        h('span', { class: 'muted' }, r ? `${r.n} caught${FISH[id].shape === 'junk' || FISH[id].dread ? '' : ` · best ${r.best} cm`}` : { water: 'water', dream: 'dreaming pools', lava: 'magma', acid: 'acid' }[FISH[id].liquid] + (FISH[id].when !== 'any' ? ` · ${FISH[id].when}` : ''))));
    }
    const el = h('div', { class: 'dialog wide interactive cooking' },
      h('div', { class: 'dh' }, 'Nutrient Processor'),
      h('div', { class: 'db' },
        h('div', { class: 'lore' }, 'Hot food, far from home. Every dish restores health, and most leave something behind in you for a while.'),
        list,
        h('div', { class: 'section-title' }, `Angler's log · ${caught.length}/${species.length}`), logEl),
      h('div', { class: 'dbtns' }, h('button', { class: 'btn small center primary', onclick: () => { this.game.audio.ui(); this.closeAll(); } }, 'Close')));
    this._overlay(el);
    this.open = 'dialog';
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
        h('button', { class: 'btn', onclick: () => this.showMultiplayer(() => this.openPause(), false) }, g.net.active ? `⚯ Multiplayer (${g.net.players().length})` : '⚯ Multiplayer'),
        h('button', { class: 'btn', onclick: () => this.showSettings(() => this.openPause()) }, '⚙ Settings'),
        h('button', { class: 'btn', onclick: () => this.showControls(() => this.openPause()) }, '⌨ Controls'),
        h('button', { class: 'btn', onclick: () => { g.saveGame(false); g.quitToTitle(); } }, '⏏ Save & Quit to Title'),
      ));
    this._overlay(el);
    this.open = 'pause';
  }

  // ---------------- multiplayer ----------------
  showMultiplayer(back, fromTitle) {
    const g = this.game, N = g.net;
    this.closeAll(true);
    const body = h('div', { class: 'mp' });
    const steam = N.transportKind === 'steam';
    const again = () => this.showMultiplayer(back, fromTitle);
    const msg = h('div', { class: 'mp-msg' }, N.status || '');
    const run = async (fn) => {
      try { msg.textContent = ''; await fn(); } catch (e) { msg.textContent = e.message || String(e); g.hud.notify(e.message || String(e)); }
    };
    // where we are, in one line
    const who = N.t ? N.t.name : (g.settings.playerName || 'Dreamer');
    body.appendChild(h('div', { class: 'mp-status' }, steam
      ? (N.t ? `● Online through Steam as ${who} · traffic goes over Steam's relay network` : N.status ? `○ Steam: ${N.status}` : '○ Connecting to Steam…')
      : '○ Browser test mode: shares a dream between tabs of this browser on this computer only. For online play with friends, use the desktop app (desktop/ folder) with Steam.'));
    if (!steam) {
      const nameIn = h('input', { type: 'text', value: g.settings.playerName || 'Dreamer', maxlength: '20', spellcheck: 'false', onchange: (e) => { g.settings.playerName = e.target.value.trim().slice(0, 20) || 'Dreamer'; g.saveSettings(); } });
      body.appendChild(h('div', { class: 'seed-row' }, 'NAME', nameIn));
    }
    body.appendChild(msg);
    if (N.active) {
      // the code, front and centre
      const code = N.code;
      const codeIn = h('input', { type: 'text', value: code, readonly: true, class: 'mp-code-in' });
      const copy = h('button', { class: 'btn small', onclick: async () => {
        try { await navigator.clipboard.writeText(code); copy.textContent = 'Copied'; } catch (e) { codeIn.select(); copy.textContent = 'Press Ctrl+C'; }
      } }, 'Copy');
      body.appendChild(h('div', { class: 'mp-code' }, h('div', { class: 'mp-code-l' }, N.isHost ? 'Your dream code' : 'This dream\'s code'), codeIn, copy));
      body.appendChild(h('div', { class: 'muted' }, 'Friends open Multiplayer (title screen or pause menu), type this code under "Join with a code" and press Join.' + (steam ? ' On Steam they can also use Join Game on your profile.' : '')));
      body.appendChild(h('div', { class: 'section-title' }, `In this dream · ${N.players().length}`));
      for (const p of N.players()) {
        const w = p.where;
        const where = p.you ? 'you' : !w ? 'arriving…' : w.m === 'x' ? 'flying in space' : w.m === 'i' ? (w.st ? 'docked at the station' : 'indoors') : w.p === (g.surface.planet && g.surface.planet.id) ? 'on this world' : 'on another world';
        body.appendChild(h('div', { class: 'recipe' },
          h('div', {}, h('div', { class: 'rn' }, `${p.name}${p.you ? ' (you)' : ''}${p.host ? ' · host' : ''}`), h('div', { class: 'ri muted' }, where)),
          !p.you && !fromTitle ? h('button', { class: 'btn small', onclick: () => N.travelTo(p.id) }, 'Travel to') : null));
      }
      body.appendChild(h('div', { class: 'row-flex' },
        steam && N.t && N.t.overlay ? h('button', { class: 'btn small', onclick: () => N.invite() }, 'Invite friends') : null,
        h('button', { class: 'btn small', onclick: () => { N.leave(); again(); } }, N.isHost ? 'Stop sharing' : 'Leave and go home')));
      body.appendChild(h('div', { class: 'muted' }, 'Z ping a spot · B wave · Enter chat'));
    } else {
      // host
      body.appendChild(h('div', { class: 'section-title' }, 'Share your dream'));
      if (!fromTitle) {
        body.appendChild(h('div', { class: 'row-flex' },
          h('button', { class: 'btn small primary', onclick: () => run(async () => { await N.host({ visibility: 'friends' }); again(); }) }, 'Host this dream'),
          steam ? h('button', { class: 'btn small', onclick: () => run(async () => { await N.host({ visibility: 'public' }); again(); }) }, 'Host · public') : null));
        body.appendChild(h('div', { class: 'muted' }, 'You get a short code to give your friends. Your world becomes the shared one; up to 4 dreamers.'));
      } else body.appendChild(h('div', { class: 'muted' }, 'To host: start or continue a dream, then press Esc → Multiplayer → Host this dream.'));
      // join
      body.appendChild(h('div', { class: 'section-title' }, 'Join with a code'));
      const codeIn = h('input', { type: 'text', placeholder: steam ? 'e.g. HNC4R' : 'e.g. 3F9A01C2', maxlength: '24', spellcheck: 'false', class: 'mp-code-in' });
      const joinBtn = h('button', { class: 'btn small primary', onclick: () => run(async () => { msg.textContent = 'Joining… (this can take a few seconds)'; joinBtn.disabled = true; try { await N.joinCode(codeIn.value); } finally { joinBtn.disabled = false; } }) }, 'Join');
      codeIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') joinBtn.click(); });
      body.appendChild(h('div', { class: 'mp-code' }, codeIn, joinBtn));
      body.appendChild(h('div', { class: 'muted' }, 'You join as your own character in your friend\'s universe; your own journey is saved and waits for you.'));
      // browse
      const list = h('div', { class: 'mp-list' });
      const refresh = () => run(async () => {
        list.textContent = 'Looking…';
        const lobbies = await N.list();
        list.textContent = '';
        if (!lobbies.length) list.textContent = steam ? 'Nothing found. Steam\'s test app 480 is shared by thousands of games, so friends\' dreams rarely show up here - use a code.' : 'Nothing found. Host from another tab of this browser first.';
        for (const l of lobbies) {
          list.appendChild(h('div', { class: 'recipe' },
            h('div', {}, h('div', { class: 'rn' }, l.name || 'A dream'), h('div', { class: 'ri muted' }, `${l.members}${l.max ? '/' + l.max : ''} dreaming · seed ${l.data && l.data.seed}`)),
            h('button', { class: 'btn small', onclick: () => run(async () => { msg.textContent = 'Joining…'; await N.join(l.id); }) }, 'Join')));
        }
      });
      body.appendChild(h('details', { class: 'mp-browse' }, h('summary', {}, 'Browse open dreams'), list, h('div', { class: 'row-flex' }, h('button', { class: 'btn small', onclick: refresh }, 'Refresh'))));
      if (!steam) refresh();
    }
    body.appendChild(h('details', { class: 'mp-how', open: N.active ? null : true }, h('summary', {}, 'How multiplayer works'),
      h('ul', {},
        h('li', {}, 'One player hosts: their universe becomes the shared one. Everyone else joins it with a code.'),
        h('li', {}, 'Online: every player runs the desktop app (desktop/ folder, npm install then npm start) on their own computer, signed in to their own Steam account, with Steam open. No port forwarding is needed.'),
        h('li', {}, 'In a browser, sharing only works between tabs of the same browser on one computer - it is for trying things out.'),
        h('li', {}, 'Shared: the world and every block you break or place, where everyone is, ships, Roamers, fishing lines, chat, pings, the time of day and the host\'s encounters. Creatures are still separate on each machine.'),
        h('li', {}, 'Nobody can pause a shared dream: menus and the inventory keep the world running.'))));
    const el = h('div', { class: 'dialog interactive', style: { width: 'min(720px, 94vw)' } },
      h('div', { class: 'dh' }, 'Multiplayer'),
      h('div', { class: 'db' }, body),
      h('div', { class: 'dbtns' }, h('button', { class: 'btn small center primary', onclick: () => back() }, 'Back')));
    this._overlay(el);
    this.open = fromTitle ? 'title' : 'multiplayer';
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
    slider('Colour mood', 'mood', 0, 1, 0.05, (v) => `${['Vivid', 'Natural', 'Muted', 'Damp', 'Bleak'][Math.min(4, Math.floor(Number(v) * 5))]} · ${Math.round(v * 100)}%`);
    slider('Dream filter', 'dreamFx', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    slider('Fear intensity', 'fear', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
    const inv = h('input', { type: 'checkbox', checked: s.invertY ? true : null, onchange: (e) => { s.invertY = e.target.checked; g.applySettings(); } });
    rows.push(h('span', {}, 'Invert mouse Y'), inv, h('span'));
    const fade = h('input', { type: 'checkbox', checked: s.hudFade !== false ? true : null, onchange: (e) => { s.hudFade = e.target.checked; g.applySettings(); } });
    rows.push(h('span', {}, 'Fade HUD when idle'), fade, h('span'));
    const dyn = h('input', { type: 'checkbox', checked: s.dynRes !== false ? true : null, onchange: (e) => { s.dynRes = e.target.checked; g.applySettings(); } });
    rows.push(h('span', {}, 'Dynamic resolution'), dyn, h('span', { class: 'muted' }, 'drops the resolution a little when frames run slow'));
    const sharp = h('input', { type: 'checkbox', checked: s.sharp ? true : null, onchange: (e) => { s.sharp = e.target.checked; g.applySettings(); } });
    rows.push(h('span', {}, 'Full high-DPI resolution'), sharp, h('span', { class: 'muted' }, 'sharper on scaled screens, much slower'));
    const el = h('div', { class: 'dialog interactive', style: { width: 'min(720px, 94vw)' } },
      h('div', { class: 'dh' }, 'Settings'),
      h('div', { class: 'db' }, h('div', { class: 'settings-grid' }, rows),
        h('div', { class: 'muted gpu-line' }, `GPU: ${g.gpuName()}`)),
      h('div', { class: 'dbtns' }, h('button', { class: 'btn small center primary', onclick: () => { g.saveSettings(); back(); } }, 'Done')));
    this._overlay(el);
    this.open = this.open || 'settings';
  }

  showControls(back) {
    const C = [
      ['WASD', 'Move / ship throttle & roll'], ['Mouse', 'Look / steer ship'], ['Space', 'Jump · hold for jetpack · ship: take off / pulse drive (space)'],
      ['Shift', 'Sprint / ship boost'], ['LMB', 'Use tool: mine · collect block · fire · cast / hook / reel'],
      ['RMB', 'Grapple (Mining Beam, Dream Line) · plasma grenade (Boltcaster) · place block (Builder)'],
      ['X · double-tap', 'Dash (dodges while it lasts; once in the air)'], ['C', 'Hold to creep · slide while sprinting · ground pound in the air'],
      ['Space at a ledge', 'Vault up to two blocks'], ['H', 'Eat the most useful food you carry'],
      ['Q', 'Cycle multi-tool mode (Mining / Builder / Boltcaster / Dream Line)'], ['1–9 · Wheel', 'Select hotbar block'],
      ['F', 'Scanner pulse (resources, points of interest)'], ['V', 'Analysis visor (hold LMB on creatures/flora to discover)'],
      ['E', 'Interact · board / exit ship · land · dock'], ['R', 'Quick recharge life support & hazard protection'],
      ['T', 'Toggle headlamp'], ['G', 'Summon the Roamer exocraft (once installed)'], ['L', 'Roamer headlights'], ['P', 'Photo mode'], ['Tab / I', 'Exosuit screen: inventory, crafting, technology, alchemy, codex'], ['M', 'Galaxy map'], ['Esc', 'Pause menu'],
      ['F2', 'Hide HUD (photo mode)'], ['Enter or /', 'Chat'], ['Z / B', 'Ping where you look / wave (multiplayer)'],
    ];
    const el = h('div', { class: 'dialog interactive', style: { width: 'min(720px, 94vw)' } },
      h('div', { class: 'dh' }, 'Controls'),
      h('div', { class: 'db', style: { maxHeight: '62vh', overflowY: 'auto' } }, h('div', { class: 'controls-table' }, C.flatMap(([k, d]) => [h('span', { class: 'k' }, k), h('span', {}, d)]))),
      h('div', { class: 'dbtns' }, h('button', { class: 'btn small center primary', onclick: back }, 'Back')));
    this._overlay(el);
    this.open = this.open || 'controls';
  }

  // ---------------- inventory ----------------
  openInventory(tab) { this.tabs.open(tab); }

  refresh() { if (this.open === 'inventory') this.tabs.render(); else if (this.open === 'station') this.renderStation(); }

  _ingredients(list, times = 1) {
    const inv = this.game.inventory;
    return h('div', { class: 'ri' }, list.map(([id, n], i) => {
      const have = inv.count(id);
      const name = ITEMS[id] ? ITEMS[id].name : id;
      return h('span', {}, i ? ' + ' : '', h('span', { class: have >= n * times ? 'ok' : 'no' }, `${n * times} ${name}`), h('span', { class: 'muted' }, ` (${fmt(have)})`));
    }));
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
      // your ship, and the paint shop
      const sp = g.ship.spec;
      col.appendChild(h('div', { class: 'section-title' }, `Your ship · ${shipName(sp.seed)} · ${specLabel(sp)}`));
      col.appendChild(this._shipCompare(sp, null));
      col.appendChild(h('div', { class: 'muted' }, `Ships for sale are parked in the hangar: walk up to a kiosk. A paint job costs ${fmt(g.shipyard.paintCost())}u.`));
      const sw = h('div', { class: 'row-flex swatches' });
      for (const hue of PAINTS) {
        const bg = hue == null ? 'linear-gradient(135deg, #888, #ddd)' : `hsl(${Math.round(hue * 360)}, 45%, 62%)`;
        sw.appendChild(h('button', { class: 'swatch' + ((sp.hue ?? null) === hue ? ' on' : ''), title: hue == null ? 'Original livery' : 'Repaint', style: { background: bg }, disabled: inv.units >= g.shipyard.paintCost() ? null : true, onclick: () => { g.shipyard.paint(hue); this.renderStation(); } }));
      }
      col.appendChild(sw);
      col.appendChild(h('div', { class: 'lore' }, g.stationChatter()));
    }
  }

  // ---------------- ship market ----------------
  _shipCompare(cur, next) {
    const a = shipStats(cur), b = next ? shipStats(next) : null;
    const rows = [['Speed', 'speed', 1.7], ['Handling', 'agility', 1.8], ['Shields', 'shield', 2.3], ['Firepower', 'damage', 1.9], ['Hyperdrive', 'jump', 5.5]];
    const t = h('div', { class: 'ship-stats' });
    for (const [label, k, max] of rows) {
      const v = b ? b[k] : a[k];
      const w = Math.min(100, ((k === 'jump' ? v + 0.5 : v) / max) * 100);
      let delta = '';
      if (b) {
        const d = k === 'jump' ? b[k] - a[k] : Math.round((b[k] / a[k] - 1) * 100);
        if (d) delta = k === 'jump' ? `${d > 0 ? '+' : ''}${d * 100} ly` : `${d > 0 ? '+' : ''}${d}%`;
      }
      t.append(h('span', {}, label), h('div', { class: 'ship-bar' }, h('i', { style: { width: w + '%' } })),
        h('span', { class: delta.startsWith('+') ? 'good' : delta ? 'bad' : 'muted' }, delta || (k === 'jump' ? `+${v * 100} ly` : `×${v.toFixed(2)}`)));
    }
    return t;
  }

  showShipOffer(i) {
    const g = this.game, Y = g.shipyard, o = Y.offer(i);
    if (!o) return;
    const cur = g.ship.spec;
    const canBuy = g.inventory.units >= o.cost;
    const el = h('div', { class: 'dialog interactive', style: { width: 'min(640px, 94vw)' } },
      h('div', { class: 'dh' }, o.name),
      h('div', { class: 'db', style: { whiteSpace: 'normal' } },
        h('div', { class: 'muted' }, o.label),
        h('div', {}, SHIP_CLASSES[o.spec.cls].desc),
        h('div', { class: 'section-title' }, `Compared with ${shipName(cur.seed)} (${specLabel(cur)})`),
        this._shipCompare(cur, o.spec),
        h('div', { class: 'ship-price' },
          h('div', {}, `Price ${o.price.toLocaleString()}u`),
          h('div', { class: 'muted' }, `Trade-in for your ship −${o.credit.toLocaleString()}u`),
          h('div', { class: 'rn' }, `You pay ${o.cost.toLocaleString()}u`),
          h('div', { class: 'muted' }, `You have ${fmt(g.inventory.units)}u. Your technology upgrades move to the new ship.`))),
      h('div', { class: 'dbtns' },
        h('button', { class: 'btn small center', onclick: () => { g.audio.ui(); this.closeAll(); g.resume(); } }, 'Not now'),
        h('button', { class: 'btn small center primary', disabled: canBuy ? null : true, onclick: () => { if (Y.buy(i)) { this.closeAll(); g.resume(); } } }, canBuy ? 'Buy this ship' : 'Not enough units')));
    this._overlay(el);
    this.open = 'dialog';
  }

  showWreckOffer(spec, cost, scrap, onClaim) {
    const g = this.game, inv = g.inventory;
    const has = inv.has(cost);
    const el = h('div', { class: 'dialog interactive', style: { width: 'min(640px, 94vw)' } },
      h('div', { class: 'dh' }, 'Crashed starship'),
      h('div', { class: 'db', style: { whiteSpace: 'normal' } },
        h('div', { class: 'rn' }, `${shipName(spec.seed)} · ${specLabel(spec)}`),
        h('div', {}, `${SHIP_CLASSES[spec.cls].desc} It came down hard, but the frame is sound. With some repairs it would fly again.`),
        h('div', { class: 'section-title' }, `Compared with ${shipName(g.ship.spec.seed)} (${specLabel(g.ship.spec)})`),
        this._shipCompare(g.ship.spec, spec),
        h('div', { class: 'section-title' }, 'Repairs'),
        this._ingredients(cost),
        h('div', { class: 'muted' }, `Your current ship is left here and salvaged for ${scrap.toLocaleString()} units. Your technology upgrades move over.`)),
      h('div', { class: 'dbtns' },
        h('button', { class: 'btn small center', onclick: () => { g.audio.ui(); this.closeAll(); g.resume(); } }, 'Leave it'),
        h('button', { class: 'btn small center primary', disabled: has ? null : true, onclick: () => { if (onClaim()) { this.closeAll(); g.resume(); } } }, has ? 'Repair and claim' : 'Missing materials')));
    this._overlay(el);
    this.open = 'dialog';
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
