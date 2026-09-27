// Bridge between the game page and the Steam client in the main process. Everything crossing the
// bridge is plain strings/numbers (Steam IDs travel as decimal strings, not BigInt).
const { contextBridge, ipcRenderer } = require('electron');

const packetHandlers = [];
const lobbyHandlers = [];
ipcRenderer.on('net:packet', (_e, p) => { for (const h of packetHandlers) h(p.from, p.text); });
ipcRenderer.on('net:lobby', (_e, ev) => { for (const h of lobbyHandlers) h(ev); });

contextBridge.exposeInMainWorld('lucidNet', {
  available: true,
  init: () => ipcRenderer.invoke('net:init'),
  createLobby: (type, max) => ipcRenderer.invoke('net:createLobby', type, max),
  setLobbyData: (data) => ipcRenderer.invoke('net:setLobbyData', data),
  listLobbies: () => ipcRenderer.invoke('net:listLobbies'),
  joinLobby: (id) => ipcRenderer.invoke('net:joinLobby', String(id)),
  leaveLobby: () => ipcRenderer.invoke('net:leaveLobby'),
  send: (targets, text, reliable) => ipcRenderer.send('net:send', targets.map(String), String(text), !!reliable),
  openInvite: () => ipcRenderer.send('net:invite'),
  setPresence: (text) => ipcRenderer.send('net:presence', String(text)),
  onPacket: (fn) => { packetHandlers.push(fn); },
  onLobbyEvent: (fn) => { lobbyHandlers.push(fn); },
});
