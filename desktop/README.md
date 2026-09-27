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
   npm start          # builds ../dist/lucid-sky.html, then launches the game
   ```

3. In game: **Esc → Multiplayer → Host · friends only** (or **public**). Friends can join from your
   Steam profile (*Join Game*), from an invite (**Invite friends**), or from **Multiplayer → Find
   dreams** on the title screen.

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
