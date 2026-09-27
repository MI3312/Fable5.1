// LUCID SKY desktop shell: Electron + Steamworks (steamworks.js).
//
// The game itself is the single-file build (dist/lucid-sky.html). This process owns the Steam
// client and exposes a small bridge to the page (see preload.cjs):
//   - lobbies through ISteamMatchmaking (create / list / join / leave / data / invite overlay)
//   - P2P messages through ISteamNetworking, which Steam routes over its relay network when a
//     direct connection isn't possible
// App ID 480 is Valve's public "Spacewar" test app; swap STEAM_APP_ID for a real one when shipping.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { app, BrowserWindow, ipcMain } = require('electron');

const STEAM_APP_ID = Number(process.env.LUCID_STEAM_APP_ID || 480);
const LOBBY_TAG = 'lucid-sky-mp-1';

let steamworks = null;  // the module
let steam = null;       // the steamworks.js client
let steamError = null;
let lobby = null;       // current matchmaking.Lobby
let win = null;
const members = new Set();

// ---------------------------------------------------------------- GPU
// Laptops with two GPUs give an unknown program like electron.exe the power-saving integrated one,
// while the browser has long since been assigned the dedicated one. So, before Chromium starts its
// GPU process: on Windows, register this executable for the high-performance GPU (the same entry
// Settings > System > Display > Graphics writes), and ask Chromium for the discrete GPU and never
// a software fallback. Set LUCID_GPU=default to leave the system's choice alone.
function preferDiscreteGpu() {
  if (process.env.LUCID_GPU === 'default') return;
  app.commandLine.appendSwitch('force_high_performance_gpu');
  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  if (process.platform !== 'win32') return;
  const key = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
  const exe = process.execPath;
  let cur = '';
  try {
    const out = execFileSync('reg', ['query', key, '/v', exe], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = out.match(/REG_SZ\s+(.*)$/m);
    cur = m ? m[1].trim() : '';
  } catch (e) { /* no entry yet */ }
  if (/GpuPreference=2;/.test(cur)) return;
  if (/GpuPreference=1;/.test(cur)) { console.log('[lucid-sky] Windows is set to run this app on the power-saving GPU; leaving that choice alone.'); return; }
  const value = cur.replace(/GpuPreference=\d;/, '') + 'GpuPreference=2;';
  try {
    execFileSync('reg', ['add', key, '/v', exe, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, stdio: 'ignore' });
    console.log(`[lucid-sky] registered ${exe} for the high-performance GPU`);
  } catch (e) {
    console.warn('[lucid-sky] could not set the GPU preference automatically:', e.message);
  }
}
preferDiscreteGpu();

// ---------------------------------------------------------------- Steam
// The Steam overlay (Shift+Tab, the invite dialog) is opt-in: it needs Chromium to run the GPU
// inside the main process with DirectComposition off, which costs frame rate. Friends can still
// join from the Steam friends list or Multiplayer > Find dreams without it.
// Set LUCID_STEAM_OVERLAY=1 to turn it on. Its switches only take effect before the app is ready.
const OVERLAY = process.env.LUCID_STEAM_OVERLAY === '1';
try {
  steamworks = require('steamworks.js');
  // the game redraws every frame anyway, so skip the helper's forced 60 Hz window invalidation
  if (OVERLAY) { try { steamworks.electronEnableSteamOverlay(true); } catch (e) { /* overlay is optional */ } }
} catch (e) {
  steamError = 'steamworks.js is not installed (run npm install in desktop/)';
}

function initSteam() {
  if (!steamworks) return false;
  try {
    steam = steamworks.init(STEAM_APP_ID);
    const SC = steamworks.SteamCallback;
    // accept P2P sessions only from people in our lobby
    steam.callback.register(SC.P2PSessionRequest, (v) => {
      const id = String(v.remote);
      if (isMember(id)) steam.networking.acceptP2PSession(BigInt(id));
    });
    steam.callback.register(SC.LobbyChatUpdate, (v) => {
      if (!lobby || String(v.lobby) !== String(lobby.id)) return;
      const id = String(v.user_changed);
      const joined = v.member_state_change === 0; // Entered
      if (joined) members.add(id); else members.delete(id);
      let owner = null;
      try { owner = String(lobby.getOwner().steamId64); } catch (e) { /* ignore */ }
      send('net:lobby', { type: 'member', id, joined, owner });
    });
    // "Join game" from a friend's invite or the friends list
    steam.callback.register(SC.GameLobbyJoinRequested, (v) => send('net:lobby', { type: 'invite', lobbyId: String(v.lobby_steam_id) }));
    return true;
  } catch (e) {
    steamError = String(e && e.message ? e.message : e);
    steam = null;
    return false;
  }
}

// the roster can lag the first packet from a newcomer, so re-read it before turning anyone away
function isMember(id) {
  if (members.has(id)) return true;
  if (!lobby) return false;
  try { for (const m of lobby.getMembers()) members.add(String(m.steamId64)); } catch (e) { /* ignore */ }
  return members.has(id);
}

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

// drain incoming P2P packets every frame
function pumpPackets() {
  if (!steam) return;
  try {
    let size = steam.networking.isP2PPacketAvailable();
    let guard = 0;
    while (size > 0 && guard++ < 256) {
      const pkt = steam.networking.readP2PPacket(size);
      const from = String(pkt.steamId.steamId64);
      if (isMember(from)) send('net:packet', { from, text: pkt.data.toString('utf8') });
      size = steam.networking.isP2PPacketAvailable();
    }
  } catch (e) { /* a bad packet should never take the game down */ }
}

function lobbyInfo(l) {
  let data = {};
  try { data = l.getFullData(); } catch (e) { /* ignore */ }
  return {
    id: String(l.id),
    owner: String(l.getOwner().steamId64),
    members: Number(l.getMemberCount()),
    max: l.getMemberLimit() != null ? Number(l.getMemberLimit()) : null,
    name: data.name || 'A dream',
    data,
  };
}

function adoptLobby(l) {
  lobby = l;
  members.clear();
  for (const m of l.getMembers()) members.add(String(m.steamId64));
}

ipcMain.handle('net:init', () => {
  if (!steam && !initSteam()) return { ok: false, error: steamError || 'Steam is not running' };
  const id = steam.localplayer.getSteamId();
  return { ok: true, steamId: String(id.steamId64), name: steam.localplayer.getName(), appId: STEAM_APP_ID, overlay: OVERLAY };
});

ipcMain.handle('net:createLobby', async (_e, type, max) => {
  try {
    const l = await steam.matchmaking.createLobby(type, max);
    adoptLobby(l);
    return { ok: true, lobbyId: String(l.id) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('net:setLobbyData', (_e, data) => {
  if (!lobby) return false;
  const flat = {};
  for (const [k, v] of Object.entries(data || {})) flat[k] = String(v);
  flat.game = LOBBY_TAG;
  return lobby.mergeFullData(flat);
});

ipcMain.handle('net:listLobbies', async () => {
  try {
    const all = await steam.matchmaking.getLobbies();
    return all.map(lobbyInfo).filter((l) => l.data && l.data.game === LOBBY_TAG);
  } catch (e) { return []; }
});

ipcMain.handle('net:joinLobby', async (_e, id) => {
  try {
    const l = await steam.matchmaking.joinLobby(BigInt(id));
    adoptLobby(l);
    return { ok: true, lobbyId: String(l.id), owner: String(l.getOwner().steamId64), members: [...members] };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

ipcMain.handle('net:leaveLobby', () => {
  if (lobby) { try { lobby.leave(); } catch (e) { /* ignore */ } }
  lobby = null;
  members.clear();
  return true;
});

// targets: array of steamId64 strings; reliable -> SendType.Reliable (2), else Unreliable (0)
ipcMain.on('net:send', (_e, targets, text, reliable) => {
  if (!steam || !lobby) return;
  const buf = Buffer.from(text, 'utf8');
  const type = reliable || buf.length > 1100 ? 2 : 0;
  for (const t of targets) {
    if (!isMember(t)) continue;
    try { steam.networking.sendP2PPacket(BigInt(t), type, buf); } catch (e) { /* peer may have just left */ }
  }
});

ipcMain.on('net:invite', () => {
  if (steam && lobby) { try { steam.overlay.activateInviteDialog(lobby.id); } catch (e) { /* overlay unavailable */ } }
});

ipcMain.on('net:presence', (_e, text) => {
  if (steam) { try { steam.localplayer.setRichPresence('status', String(text).slice(0, 60)); } catch (e) { /* ignore */ } }
});

// ---------------------------------------------------------------- window
function gamePage() {
  const candidates = [
    path.join(__dirname, 'app', 'lucid-sky.html'),          // packaged
    path.join(__dirname, '..', 'dist', 'lucid-sky.html'),   // from the repo after `npm run build`
  ];
  return candidates.find((p) => fs.existsSync(p));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, backgroundColor: '#07060d', title: 'LUCID SKY',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  });
  const page = gamePage();
  if (page) win.loadFile(page);
  else win.loadURL('data:text/html,<body style="background:#111;color:#eee;font:16px sans-serif;padding:40px">The game has not been built yet. In the <code>desktop</code> folder run <code>npm run start:fresh</code>, or in the project root run <code>npm install</code> then <code>npm run build</code>.</body>');
  win.on('closed', () => { win = null; });
}

// which GPU Chromium actually picked, and whether WebGL is hardware accelerated
async function logGpu() {
  try {
    const status = app.getGPUFeatureStatus();
    const info = await app.getGPUInfo('basic');
    const devs = (info.gpuDevice || []).map((d) => `${d.active ? '*' : ' '} vendor 0x${(d.vendorId || 0).toString(16)} device 0x${(d.deviceId || 0).toString(16)}${d.driverVersion ? ' driver ' + d.driverVersion : ''}`);
    console.log(`[lucid-sky] WebGL2: ${status.webgl2} · GPUs (* = in use):\n  ${devs.join('\n  ')}`);
  } catch (e) { /* diagnostics only */ }
}

app.whenReady().then(() => {
  initSteam();
  createWindow();
  logGpu();
  setInterval(pumpPackets, 1000 / 60);
});

app.on('window-all-closed', () => {
  if (lobby) { try { lobby.leave(); } catch (e) { /* ignore */ } }
  app.quit();
});
