# LUCID SKY desktop (Steam multiplayer)

The browser build shares dreams between tabs of one browser (local test mode). For real online
play, run the game in this Electron shell: it talks to Steam through
[steamworks.js](https://github.com/ceifa/steamworks.js), so you get Steam lobbies (friends-only or
public), Steam invites through the overlay, and P2P packets carried over Steam's relay network.
No port forwarding is needed.

It uses **app ID 480** (Valve's public *Spacewar* test app) while in development. Everyone who
plays together needs to run it with the same app ID.

## Run it

1. Install and start the Steam client, and log in.
2. From this folder:

   ```
   npm install
   npm start
   ```

   `npm start` uses the game build in `../dist/lucid-sky.html`, which comes with the release zip.
   It only rebuilds when that file is missing or older than the source. When it does rebuild, it
   first runs `npm install` in the project root to get the build tools (esbuild, three). To force a
   rebuild after changing the game, run `npm run start:fresh`.

3. In game: **Esc → Multiplayer → Host · friends only** (or **public**). Friends can join from your
   Steam profile (*Join Game*), from **Multiplayer → Find dreams** on the title screen, or from an
   invite when the Steam overlay is on (see below).

## Performance and graphics card

On laptops with two GPUs, Windows gives an unrecognised program like `electron.exe` the
power-saving integrated GPU. Your browser was assigned the dedicated one long ago, which is why
the game can run well in the browser and badly here. The shell fixes this itself:

- **Windows:** on first launch it registers its `electron.exe` for the **high-performance GPU**.
  This is the same entry that *Settings > System > Display > Graphics* writes, under
  `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`. If you've deliberately chosen *Power
  saving* for it there, that choice is left alone.
- **Chromium:** it asks for the discrete GPU (`force_high_performance_gpu`), and it ignores the
  GPU blocklist so WebGL never falls back to slow software rendering.
- **Checking it:** *Settings* in the game shows the GPU that WebGL is actually running on, and the
  console lists the adapters with the active one starred.

If it still picks the wrong GPU, add
`desktop\node_modules\electron\dist\electron.exe` under *Settings > System > Display >
Graphics* and choose *High performance* (or use the NVIDIA / AMD control panel). Then restart the
game. To make the shell leave GPU selection alone, set `LUCID_GPU=default`.

**Steam overlay:** it's off by default. The overlay needs Chromium to run the GPU inside the main
process with DirectComposition disabled, which costs frame rate. Friends can still join from the
Steam friends list (*Join Game*) or *Multiplayer > Find dreams*. To turn the overlay and the in-game
*Invite friends* dialog on, set `LUCID_STEAM_OVERLAY=1` before `npm start`
(`set LUCID_STEAM_OVERLAY=1` in cmd, `$env:LUCID_STEAM_OVERLAY=1` in PowerShell).

`steam_appid.txt` holds the app ID for launches outside Steam. To use your own app, set
`LUCID_STEAM_APP_ID` or edit `STEAM_APP_ID` in `main.cjs` and `steam_appid.txt`.

## How the sharing works

- **Host:** the host's universe is the shared one. It keeps the canonical record of every block
  change on every planet.
- **Guests:** each guest keeps their own character in a save slot for that host's seed, and arrives
  beside the host.
- **Snapshots:** every player streams a small snapshot ~12×/s: position, ship, Roamer and the time
  of day on a shared planet. These are interpolated on the other end.
- **Edits:** block edits are batched and sent reliably. On landing on a planet, you ask the host for
  everything that has changed there.
- **Social:** chat (Enter), pings (Z), waves (B), and *Travel to* a friend from the Multiplayer menu.
- **Encounters:** the host's supply drops, wisp chases, rifts and ore geysers happen for everyone on that planet.

Note that `steamworks.js` ships native binaries for Windows x64, Linux x64 and macOS.
