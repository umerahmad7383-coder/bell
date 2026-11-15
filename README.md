# THE LAST BELL

An online co-op horror game for 2–8 players. You and your friends are locked in an abandoned school at night. Restore the power, get the gate key, and escape before the Headmaster catches everyone.

- **Client:** Three.js (rendering), Rapier (collision), Web Audio (all sound is synthesised), no build step.
- **Server:** Node.js + Express + Socket.IO. Server-authoritative for items, doors, objectives, the monster, health and win/loss.
- **One process serves both** the web page and the WebSocket backend, so one deployment gives you one HTTPS link to send to friends.

## Status — read this first

| | |
|---|---|
| Runs and was tested locally | Yes: 3 automated suites plus a two-browser end-to-end run (see [Testing](#testing)) |
| Deployed to a public URL | **No.** It was built in a sandbox with no hosting account. Follow [Deploy](#deploy-get-a-public-link) to put it online (about 5 minutes). |
| Tested between two physically separate PCs over the internet | **No.** Tested with separate browser processes and separate Socket.IO clients against one local server. The networking does not depend on being local, but nobody has yet played it across two networks. [Do that test](#test-between-two-separate-pcs) after deploying. |
| Frame rate on a real GPU | **Not measured.** The sandbox has no GPU, only a software renderer. In that renderer the optimised build takes about half the time per frame that the first version did on High, but real numbers depend on your graphics card. See [Performance](#performance). |
| Hunt Mode (player-controlled Headmaster) | **Not built.** The lobby shows it as unavailable. |

## Run it on your own PC

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>. Choose **Play (solo practice)** to walk around alone, or **Create Private Lobby** and open the invite link in a second browser window.

## Deploy: get a public link

The server must run as a long-lived process (it holds lobbies in memory and keeps WebSockets open), so serverless hosts such as Vercel Functions or Netlify Functions will not work for it. Any host that runs a Node process will.

### Option A — one service for everything (recommended)

**Render** (has a free tier):

1. Put this folder in a GitHub repository.
2. In Render: **New → Blueprint**, pick the repo. `render.yaml` configures everything.
   (Or **New → Web Service** by hand: build command `npm install --omit=dev`, start command `npm start`.)
3. When it finishes you get `https://<name>.onrender.com`. That is the link to send to friends. HTTPS and secure WebSockets (`wss://`) are automatic.

Free-tier caveat: Render spins a free web service down after 15 minutes with no traffic and takes about a minute to wake up again, and open lobbies are lost when it sleeps. During a match the WebSocket traffic keeps it awake. A paid instance never sleeps.

**Railway, Fly.io, a VPS, or anything that runs Docker:** a `Dockerfile` is included. The container listens on `$PORT` (default 3000). Put it behind HTTPS (these platforms do this for you).

```bash
docker build -t the-last-bell .
docker run -p 3000:3000 the-last-bell
```

### Option B — static frontend + separate backend

Only worth it if you specifically want the page on a static host or CDN.

1. **Backend:** deploy this repo as in Option A. Set `CLIENT_ORIGIN` to your frontend's address, for example `https://last-bell.netlify.app`.
2. **Frontend:** edit `client/config.js`:
   ```js
   window.LAST_BELL_SERVER = "https://<your-backend>.onrender.com";
   ```
   then publish the `client/` folder as-is to Netlify, Vercel, Cloudflare Pages or GitHub Pages. It is fully static: no build command, publish directory `client`.
3. The page must be served over HTTPS and the backend address must be `https://` too, otherwise browsers block the connection.

### Option C — a temporary public link from your own PC (no account)

Good for a quick session without deploying anything:

```bash
npm start
cloudflared tunnel --url http://localhost:3000
```

[cloudflared](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) prints a random `https://….trycloudflare.com` address. Send that to your friends. It works until you close the terminal, and the address changes each time.

## Updating a game you already deployed

Replace the files in your GitHub repository with the new ones (on the repository page: **Add file → Upload files**, drag in the contents of the new folder, commit). Render rebuilds and redeploys by itself within a couple of minutes. Players should then reload the page with `Ctrl`+`F5` so the browser does not keep old files.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on. Hosting platforms set it for you. |
| `CLIENT_ORIGIN` | `*` | Websites allowed to connect. Set to your frontend URL(s), comma-separated, when using Option B. |
| `MAX_PLAYERS` | `8` | Lobby size limit (max 8). |
| `MIN_PLAYERS` | `1` | Players needed to start. `1` allows solo practice; set `2` to force co-op. |
| `MONSTER_GRACE` | *(from difficulty)* | Seconds at match start before the Headmaster can notice anyone. Overrides the difficulty's own value. |
| `MONSTER_SPEED` | `1` | Extra multiplier on his movement (0.5–1.5), applied on top of the chosen difficulty. |

See `.env.example`. The only client-side setting is `client/config.js`.

## Test between two separate PCs

1. Deploy (Option A or C) and open the public `https://` link on PC 1. The menu should say **Connected to server**.
2. Enter a name, click **Create Private Lobby**, then **Copy Invite Link**.
3. Send the link to PC 2 (ideally on a different network — a phone hotspot works). Opening it pre-fills the room code; enter a name and click **Join**.
4. Both screens should now list both players. PC 2 clicks **Ready up**, PC 1 clicks **Start Match**.
5. You spawn side by side in the Main Hall. Walk around: each player should see the other move, see their torch beam, and see doors they open.
6. If PC 2 shows "Cannot reach the game server", check `https://<your-link>/health` in a browser. It should return `{"ok":true,…}`.

Same-network check without deploying: run `npm start` on one PC, find its local IP (`ipconfig` / `ifconfig`), and open `http://<that-ip>:3000` on another PC on the same Wi-Fi.

## How to play

**Goal** (also in the in-game notebook, hold `Tab`):

1. Find three fuses. They are in different rooms every match.
2. Fit them in the fuse box in the Boiler Room (down the east stairs). Power comes back — and he comes to look.
3. Get into the Principal's Office: find its key, or use the lockpick.
4. Take the gate key from the desk.
5. Disarm the gate's electric lock at the Security Office console (needs power).
6. Unlock the main gate at the west end of the Main Hall and get out. The match is won if anyone escapes.

| Key | Action |
|---|---|
| `W` `A` `S` `D` / mouse | Move / look |
| `Shift` | Sprint (drains stamina; loud) |
| `Ctrl` or `C` | Crouch (quiet, harder to see, fits under tables) |
| `E` | Interact: doors, items, lockers, fuse box, console, revive |
| `F` or right click | Flashlight on / off (the HUD shows ON / OFF) |
| `Q` or middle click | Ping what you are looking at for your team; when downed, call for help (he can hear it) |
| `1`–`4`, mouse wheel | Select inventory slot |
| Left click | Use held item |
| `G` | Drop held item (how you hand things to teammates) |
| `Tab` | Notebook: objectives and found notes |
| `Enter` | Text chat |
| `Esc` | Release the mouse / menu |

> Browsers reserve `Ctrl`+`W` for "close tab" and pages cannot override it. Crouch with `C`, or use Settings → Toggle Fullscreen (Chrome and Edge let the game lock those keys in fullscreen). The game also asks for confirmation before a tab closes mid-match.

**Difficulty** is chosen by the host in the lobby:

| | Beginner | Intermediate | Hard | Nightmare |
|---|---|---|---|---|
| His chase speed at the start (you sprint at 5.3 m/s) | 3.9 | 4.6 | 4.9 | 5.3 |
| Hits before you go down | 3 | 2 | 2 | 1 |
| Time to revive a downed player | 110 s | 80 s | 60 s | 45 s |
| Supplies | more | normal | fewer | scarce |
| Predicts where you ran; patrols near your current objective | – | yes | yes | yes |
| Cuts you off in long chases, looks under tables, guards downed players, returns to where he lost you, learns which lockers you use, targets the wounded | – | – | yes | yes |
| Thrown bottles | always fooled | always fooled | fooled once, then often walks to the thrower | walks straight to the thrower |

**The Headmaster** patrols unpredictably, hears footsteps (running carries far, crouching barely at all), doors, dropped and thrown objects, and investigates. He sees further when your torch is on or the lights are powered, and poorly if you crouch in the dark or under a table. He opens doors (which slows him), searches after losing you, sometimes checks lockers — and always checks the one he watched you climb into. He gets faster and more persistent with every objective you complete. One hit wounds you, a second puts you down; teammates have 80 seconds to revive you with `E` (4 seconds) or a med kit (instant).

**Items:** fuses, office key, gate key, batteries (torch lasts ~6 minutes each), med kit, lockpick, glass bottles (throw to make noise somewhere else), hand bell (drives him off for a few seconds, one use), notes (clues to where things are; shared with the whole team).

**Your character.** Menu → **Character** (or **Edit Character** in the lobby) sets skin, clothes, shoes, hair, headwear, extras and build, with a live preview. Other players see that character. In first person you see your own body when you look down, your left hand holding the torch, and your right hand holding whichever inventory slot is selected; other players see what you are holding too.

**Jumpscares.** When the Headmaster hits you, your view is wrenched round to him and his face fills the screen with a scream (longer on the hit that puts you down). Every few minutes the school may also play a fake one on a single player when he is nowhere near. Settings → Jumpscares turns both off; the flash is a single brief pulse, not a strobe.

There is no voice chat. Use Discord or similar alongside the built-in text chat.

## What is and is not in this version

Built: four difficulty levels; jumpscares; team pings; an on-screen current objective and item hints; start-of-match control tips; optional toggle-crouch; per-player stats on the end screen; a character creator; first-person body and hands; private lobbies with six-character codes, invite links, ready states, host start, host migration, rematch in the same lobby, disconnect handling, spectating after death or escape; the full school on one connected map (main hall, four corridors, three classrooms, science lab, library with a hidden room behind a loose bookshelf, cafeteria, gym, bathroom, storage, security office with a live monitor map, staff room, locked principal's office, stairwell, basement, cellar, boiler room, courtyard and exit gate); 20 doors plus the bookshelf and the gate; 20 lockers; the six-state monster AI plus a "stalk" behaviour; randomised item placement; inventory with drop/share; hiding, wounding, downing, reviving; power and lighting states; randomised paranormal events; procedural 3D audio; text chat; settings.

Not built, or simplified:

- **Hunt Mode** is not implemented.
- **No reconnecting into a running match.** If you drop, your items fall where you stood and you can rejoin the lobby for the next round.
- **No voice chat**, no gamepad or touch controls (keyboard and mouse only).
- **Characters are built from primitive shapes** and animated in code; there are no modelled or motion-captured assets. Textures are painted procedurally at load time.
- **Basement is reached by stairs but the map is one navigation layer** (no rooms stacked on top of each other).
- **Movement is client-side with server sanity checks** (speed and wall checks), which is normal for co-op but is not cheat-proof.
- **Lobbies live in server memory.** A server restart ends all matches. One server process handles all lobbies; there is no multi-instance scaling.
- **Balance is untested with real groups.** Pick a difficulty in the lobby; fine-tune with `MONSTER_SPEED` and `MONSTER_GRACE`.
- **No in-game map**, on purpose. See [The map](#the-map-for-you-only).

## Performance

Settings → Graphics has Low, Medium and High, plus two switches:

- **Keep it smooth** (on by default): the game measures its frame rate once a second and lowers the internal render resolution when it falls under about 50 fps, then raises it again when there is headroom. This is what stops High from stuttering on weaker graphics cards.
- **Show frame rate**: prints the fps and the current resolution percentage in the top-left corner.

What each level costs: Low has no shadows, 75% resolution, no anti-aliasing and 2 real ceiling lights. Medium adds torch shadows and 4 lights. High adds glossy floors, sharper shadows, 6 lights and up to 1.5× resolution on high-density screens.

If the menu shows a red warning that the browser is rendering without the graphics card, no setting will help: enable hardware acceleration in the browser's settings and restart it.

## The map (for you only)

Players get no map in the game. To make one for yourself:

```bash
npm run map -- --secret     # writes docs/school-map.svg, including the hidden room
npm run map                 # same, without the hidden room
```

Open the SVG in any browser. The generator lives in `scripts/`, and neither `scripts/` nor `docs/` is served by the game server, so players cannot download it from your site. If your GitHub repository is public, people could still read those files there; make the repository private, or do not upload `docs/` and `scripts/floorplan.js`.

## Testing

```bash
npm test                # all three suites below (needs dev dependencies)
```

- `test/smoke.js` — starts the real server and drives three real Socket.IO clients through a whole match: lobby rules, movement sync, teleport rejection, door sync, two players grabbing the same item, dropping and sharing, locked doors, the stairs, all six objectives, escape, disconnect during a match, host migration, rematch with re-randomised items.
- `test/ai.js` — runs the real game simulation headlessly and checks patrol, door opening, chase, attack, retreat, noise investigation, search, hiding rules, the bell, aggression scaling, the four difficulty levels, and the smarter behaviours (prediction, bottle origin, looking under tables, guarding the downed).
- `test/physics.js` — runs the real Rapier character controller against the real school colliders: walls, the gate, stairs down and up, crawling under tables, lockers.
- `test/browser-e2e.js` — optional; two real Chrome windows with real key presses (needs Playwright; instructions are at the top of the file).

## Project layout

```
server/index.js      lobbies, room codes, Socket.IO wiring, static file serving
server/game.js       one match: items, doors, objectives, health, win/loss
server/monster.js    the Headmaster's state machine
client/shared/map.js the school layout, pathfinding and line of sight (used by server AND client)
client/js/main.js    menu, lobby, settings, match start/stop
client/js/game.js    rendering loop, first-person controller, interpolation, HUD
client/js/world.js   builds the school geometry, lights, props, items
client/js/physics.js Rapier world and character controller
client/js/entities.js  monster and player models and animation
client/js/viewmodel.js first-person hands
client/js/items.js   item meshes (world, hands)
client/shared/defs.js  difficulty levels, item codes, character options
scripts/floorplan.js   map generator (not served to players)
client/js/audio.js   synthesised sound
client/js/textures.js  procedurally painted textures
client/vendor/       three.js, Rapier, Socket.IO client (copied from npm by `npm run vendor`)
```

Libraries: three.js (MIT), Rapier (Apache-2.0), Socket.IO (MIT), Express (MIT).
