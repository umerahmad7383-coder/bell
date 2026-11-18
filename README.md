# THE LAST BELL

An online co-op horror game for 2–8 players. You and your friends are locked in an abandoned school at night. Restore the power, get the gate key, and escape before the Headmaster catches everyone.

- **Client:** Three.js (rendering), Rapier (collision), Web Audio (all sound is synthesised), no build step.
- **Server:** Node.js + Express + Socket.IO. Server-authoritative for items, doors, objectives, the monster, health and win/loss.
- **One process serves both** the web page and the WebSocket backend, so one deployment gives you one HTTPS link to send to friends.

## Status — read this first

| | |
|---|---|
| Runs and was tested locally | Yes: 4 automated suites plus a two-browser end-to-end run (see [Testing](#testing)) |
| Deployed to a public URL | **No.** It was built in a sandbox with no hosting account. Follow [Deploy](#deploy-get-a-public-link) to put it online (about 5 minutes). |
| Tested between two physically separate PCs over the internet | **No.** Tested with separate browser processes and separate Socket.IO clients against one local server. The networking does not depend on being local, but nobody has yet played it across two networks. [Do that test](#test-between-two-separate-pcs) after deploying. |
| Frame rate on a real GPU | **Not measured.** The sandbox has no GPU, only a software renderer. In that renderer the optimised build takes about half the time per frame that the first version did on High, but real numbers depend on your graphics card. See [Performance](#performance). |
| Windows app | Built and run here under Linux, both from source and as a packaged build: window, splash, server connection, display modes, quitting, a full match. The Windows app folder (`The Last Bell.exe` and its files) was packaged here. The last step, wrapping it into the Setup .exe, needs Windows, so GitHub Actions does it ([The Windows app](#the-windows-app)). **Not yet installed on a real Windows PC**: do that first. |
| Hunt Mode (player-controlled Headmaster) | Built. Rules are covered by `test/hunt.js`; balance has not been played by real groups yet. |
| Voice chat | Built. Connection and audio flow were tested between two browsers on one machine with a fake microphone. **Not tested between real networks or by ear.** |

## What is new in 2.0

**A Windows app.** `desktop/` packages the game as a normal Windows program: a Setup .exe with a desktop and Start menu shortcut, the game's own icon, an uninstaller, a splash screen, fullscreen by default (F11 or Alt+Enter for a window), a Quit button, and automatic updates from GitHub Releases. It plays online through the same Render server as the website, so app players and browser players share lobbies. How to build and publish it: [The Windows app](#the-windows-app).

**Graphics, rebuilt.**
- **Baked lighting from Blender.** The whole school was lit offline in Blender Cycles, a path tracer. Light bounces between walls, floors and ceilings, corners and the gaps under desks go dark, moonlight spills in through the windows and the red emergency lamps bleed down the corridors. There are two bakes, power off and power on, and the game blends between them as the power comes back, flickers or turns red for the final bell. The tools are in `tools/bake/` if the map ever changes.
- **Four quality levels: Low, Medium, High and Ultra.** Every surface has relief (normal) maps and roughness. On top of that come bloom on the lights, film-style tone mapping, anti-aliasing (FXAA, SMAA or 4× MSAA), soft reflections (High and up) and ambient occlusion (Ultra).
- **Atmosphere.** Your torch now throws a visible beam through the dust, with drifting dust motes. Your friends' torches cut beams through the dark too.
- **Detailed models.** The first-person hands have real fingers wrapped round a turned metal torch with a lens and reflector. The items (med kit, bell, bottle, can, camera, keys, battery, fuse) were rebuilt with rounded and turned shapes.

**Physics you can feel.** About 80 loose props lie around the school: bins, buckets, chairs, cardboard boxes, books, cans, paint tins, lunch trays, paper and basketballs in the gym. They are real rigid bodies, so you, your friends and the Headmaster knock them over and send them rolling, each with its own impact sound (metal, plastic, wood, cardboard, a bouncing ball). You hear him crash through a corridor before you see him.

**Settings, like a PC game.** Settings is split into Display, Sound, Controls and Gameplay. New:
- **Resolution** scale.
- **Window mode and size** (in the app).
- **Change any keyboard key** (Controls → Keyboard and mouse: click a key, press the new one). On-screen prompts follow your keys.

## What is new in 1.3.1

- **No more sleeping server on Render's free plan (for most of the day).** Render puts a free web service to sleep after 15 minutes without visitors, and waking it takes about a minute, so new players clicking your link thought the game was broken. The server now visits its own address every 10 minutes to stay awake, with nothing to set up (Render tells the server its own address).
  - Render gives each account **750 free hours a month, shared by all its free services**, and if they run out, every free service on the account is switched off until the next month. So by default the game stays awake **18 hours a day, 10:00 to 04:00 UTC** (2 pm to 8 am in the Gulf, evenings in Europe and the Americas): about 540–560 hours a month, leaving about 200 for your other free services. Outside those hours it sleeps when nobody is playing and wakes for the next visitor, as before.
  - Change it with the `KEEP_AWAKE` environment variable on Render: another window in UTC hours such as `14-2`, `on` for all day (only if this is your only free service), or `off`.
- **Version on the main menu**, and if the game was updated while your page was open, the menu says so and offers a **Reload** button.
- **Link previews.** Paste your game's link into Discord, WhatsApp, X or Reddit and it shows a picture of the school, the title and a one-line pitch. Invite links say "You're invited: room ABC123".
- **Press kit** in the `press/` folder: six screenshots, plus ready-to-paste descriptions for itch.io and CrazyGames, Reddit posts, a message for YouTubers and ideas for short videos.

## What is new in 1.3

- **Play with an Xbox or PlayStation controller.** Plug one in or pair it with Bluetooth and press any button. Everything works with the pad:
  - the main menu, the lobby, settings and the pause menu (the D-pad or left stick moves a highlight, A / ✕ chooses, B / ○ goes back);
  - playing as a survivor, with analog movement: how far you push the stick is how fast you walk;
  - playing as the Headmaster in Hunt Mode;
  - spectating after you die.
- **On-screen buttons follow what you are holding.** Prompts, the key strip in the corner, tips and item hints show keyboard keys, Xbox buttons (A B X Y in their colours, LB, RT, View, Menu) or PlayStation buttons (✕ ○ □ △, L1, R2, Create or Share, Options). They switch the moment you touch the other device.
- **Controls screen: a separate Controller section.** Menu → Controls opens straight on the controller page when one is connected. It shows a drawing of the pad with every button labelled, for Xbox or PlayStation (it picks the one you have connected, or choose either). Press a button on your controller and it lights up on the drawing. The Headmaster's buttons and the menu buttons are listed underneath.
- **Settings:** controller look speed, invert look up and down, and vibration (the controller shakes when he hits you and when the gate slams).
- The main menu says when a controller is connected and which one.

## What is new in 1.2

- **Fixed: two friends could not lose.** The Headmaster walked away after every hit, even the one that put someone down, so the friend could always pick them up and the two of you could loop forever (in a simulation, a pair standing still and reviving each other survived 15 minutes on every difficulty, Nightmare included). Now:
  - **He does not walk away from a witness.** If he puts someone down while a classmate is close by or in sight, he stands over the body for a moment and then goes for the classmate. With nobody around he still leaves, briefly, and comes back to check on the one he left behind.
  - **Reviving is noisy.** Picking someone up makes a sound he can hear about 9 m away (a player Headmaster sees it as a red pulse).
  - **Every fall costs more.** The second time you go down you bleed out twice as fast, and there is a limit: you can be picked up 3 times on Beginner, 2 on Intermediate, Hard and in Hunt Mode, and once on Nightmare. The next fall after that is final. The team list shows a dot per fall, and the screen says when you are on your last chance. Returning Thomas's teddy forgives one fall each.
  - A hit that only wounds still sends him away, so the wounded get their chance to run. A player Headmaster who puts someone down is locked out for 3 s instead of 8, with no slowdown, so he can go for the rescuer.
- **Dropped connection? You are put straight back in.** If your Wi-Fi blips, your hotspot drops or you refresh the page by accident, the game shows "Connection lost" and your place is held for 45 seconds. When you reconnect you are back in the match where you were standing, with your items. Everyone else sees that you lost your connection and when you are back. Leaving on purpose still leaves.
- **Fixed: players 3 and 4 started inside the Main Hall lockers.** Everyone now starts side by side across the hall, so nobody begins the match staring at a classmate's back.
- **Fixed: the room code was cut off at 720p.** Panels taller than the window used to lose their top edge (the room code and invite buttons in the lobby). Every screen now scrolls properly, and the main menu tightens up on short screens such as laptops.
- **Name tags** keep a steady size up close instead of filling the screen when a teammate stands next to you, and fade when they are right beside you.
- **The gate's electric lock** is now a steel magnet housing under the lintel with striker plates on the leaves, a hazard label and a status light (red locked, amber unlocked, green open). It used to be a flat red box that floated in mid-air once the gate opened.
- **Easier to read when you are down:** the text sits on a dark backdrop, and it tells you that `Q` calls for help.
- Smaller fixes: the Medic's revive bar now matches the Medic's faster revive; spectators switch to someone else when the player they were watching leaves; if a player Headmaster disconnects during the final bell, the AI that takes over is enraged too; the end screen says "You got out" or "They got out without you" instead of a plain "Escaped".

## What is new in 1.1

- **Fixed: the basketball hoops.** The gym doorways sat in the middle of the north and south walls, so both hoops hung over a door. The doorways have moved toward the corners and each hoop now has a solid wall to itself. Every other room was checked from the inside for the same kind of mistake.
- **Smoother.** Static furniture and decoration are merged into one mesh per 12 m block of the school, clocks and exit signs share one material, and nothing beyond the fog (about 34 m) is drawn at all. The busiest view, down the Main Hall, went from 373 draw calls to 221.
- **Rain** now falls as streaks instead of little squares.
- **Survivor classes.** Each survivor picks one in the lobby; the rest of the lobby sees your choice next to your name.
  - **Athlete:** sprints a third longer and gets their breath back faster.
  - **Medic:** revives teammates twice as fast and starts with a med kit.
  - **Mechanic:** sees fuses glowing through walls within 12 m, and opens doors without a sound.
  - **Sneak:** footsteps carry half as far, and holds their breath 50% longer in a locker.
- **Headmaster tuning (Hunt Mode).** The host gets five sliders in the lobby: his speed (80–120%), how far he sees in the dark (4–10 m), how far he hears (50–125% of the AI's range), his teleport, trap and lights cooldowns (50–200%), and how many hits put a survivor down (1–4, or automatic). Everyone in the lobby sees the settings; **Reset to the defaults** puts them back.
- **The final bell.** Opening the main gate no longer ends the tension: every light in the school turns red, a siren starts, the bell rings three times, he becomes enraged (15% faster as the AI, 10% faster as a player, and the AI always has a rough idea where the nearest survivor is), and the gate slams shut again after 2 minutes. Anyone still inside, standing or downed, is lost. The countdown sits at the top of the screen.

## What is new in 1.0

- **Hunt Mode: the Headmaster sees less.** His night vision now fades out after about 6 m (it was 9 m, and 12 m before that), so survivors who keep their distance are hard to spot.
- **New items:**
  - **Polaroid camera:** flash it in his face from up to 8 m and he reels back. 3 shots. Against a player Headmaster it stuns him for 2 s, then he is dazzle-proof for 8 s.
  - **Energy drink:** 12 seconds of unlimited stamina.
  - **Alarm clock:** wind it up and set it down. It rings 8 seconds later and he comes to it, so you can be somewhere else by then.
  - **Chalk:** mark the wall in front of you so your team knows what you have searched. Click for an X; hold A or D for an arrow, or S for a warning. Each mark takes your colour.
- **Roll call (Escape Mode):** every few minutes the PA crackles and a voice calls someone's name. For 30 seconds he has a rough idea where that player is. Hiding in a locker or crouching under cover keeps you off his mind, and surviving it counts on your report card.
- **Side quest: Thomas's teddy.** A teddy bear is hidden somewhere in the school. Put it back in Thomas's locker in the Locker Room (it has his name on it). Thomas thanks you: everyone hurt is patched up, every objective item glows through the walls for 30 seconds, and the Headmaster is driven off.
- **Detention rules:** optional match modifiers the host can mix and match in the lobby.
  - **One strike:** everyone goes down in one hit.
  - **Lights out:** torches drain twice as fast, but there are extra batteries.
  - **Restless school:** twice the ghostly happenings, roll call comes sooner, and he is 8% faster.
  - **Sports day:** nobody runs out of stamina, but he is 12% faster.
- **Report cards:** the end screen gives every player a graded school report (A+ to F) with what they did and a teacher's comment.

## What is new in 0.9

- **Fixed: walking backwards no longer dodges him.** He used to stand still for his whole swing, so anyone walking away (even backwards) was always out of reach when it landed. He now keeps lunging while the swing winds up, the wind-up is shorter on harder difficulties, and walking backwards is slower than walking forwards (sideways a little slower too).
- **Hunt Mode rebalanced.** The player Headmaster was far too strong. He now walks barely faster than survivors walk, rages barely faster than they sprint (and for less time), teleports less far and less often, has fewer traps, sees less far in the dark and hears less precisely. Survivors who take a hit get a short burst of adrenaline. All numbers are in `HUNT` at the top of `server/hunter.js`.
- **A bigger school: the South Wing.** A second loop of corridors (West Wing, East Wing, Lower Hall) and seven new rooms: the Auditorium (crouch between the seat rows to hide), the Stage, the Music Room, the Nurse's Office (crawl under the hospital beds), the Art Room, the Janitor's Closet and the Locker Room. 17 more lockers, 9 more doors.
- **Lures.** The piano (pulls him to the Music Room), the janitor's radio (starts blaring six seconds after you switch it on, so you can get away first) and the great bell on the stage (once per match, the whole school hears it).
- **Hold your breath.** Hiding in a locker he is checking? Hold Space. It often makes him walk on, unless he watched you climb in. Run out of air and you gasp.
- **Dropping and tossing.** Tap G to drop what you hold; hold G and let go to toss it a few metres to a teammate. Dropped items fall from your hand to the floor.
- **More detail everywhere:** brass name plaques over doors, glowing exit signs, stopped clocks, posters, loose papers, cobwebs, tiled washrooms, and an art-room mannequin that turns its head when you are not looking.
- **New interface:** a live night-time scene of the school behind the menu, hall-pass buttons, chalkboard panels, a class register in the lobby, switches and sliders in Settings, and a cleaner HUD. Fonts are bundled in `client/assets/fonts` (open licences, see `LICENSES.txt`).

## Run it on your own PC

Needs [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm start
```

Open <http://localhost:3000>. Choose **Play (solo practice)** to walk around alone, or **Create Private Lobby** and open the invite link in a second browser window.

## The Windows app

The app is the game client wrapped in [Electron](https://www.electronjs.org/). Its code is in `desktop/`, and it copies `client/` into the installer when it is built. It connects to `https://bell-en9a.onrender.com`; to use another server, change `SERVER` at the top of `desktop/main.js`.

### Publish it (no tools needed on your PC)

GitHub builds the installer on a Windows machine and publishes it as a release:

1. Upload the files to the repo (including `.github/workflows/windows-app.yml`; see the note below).
2. The first time, open the **Actions** tab and press **Run workflow** on "Windows app". After that, it runs by itself whenever you change `desktop/package.json` on `main`.
3. After about 10 minutes, **Releases** has a new release with `The-Last-Bell-Setup.exe`. The download page on your site (`/download`) and the menu link point to it automatically.

To ship an update, raise `"version"` in `desktop/package.json` (for example `2.0.0` → `2.0.1`), and the same in `package.json` and `client/js/version.js`, then upload. GitHub builds the new release. Installed copies download it in the background and install it the next time they start; the menu shows a **Restart now** button once it is ready.

Note: GitHub's drag-and-drop upload skips folders whose names start with a dot. Create the workflow file with **Add file → Create new file**, type `.github/workflows/windows-app.yml` as the name, and paste the file's contents.

### Build it on your own PC instead

Needs [Node.js](https://nodejs.org/) 20 or newer.

```
cd desktop
npm install
npm start            # try the app without installing it
npm run dist         # makes desktop/dist/The-Last-Bell-Setup.exe
```

To publish from your PC instead of GitHub Actions, create a GitHub token with "repo" access, then run `set GH_TOKEN=your-token` followed by `npm run release`.

### Windows SmartScreen

The installer is not code-signed (a certificate costs money every year), so the first time someone runs it, Windows says "Windows protected your PC". Click **More info → Run anyway**. Once enough people have installed it, the warning becomes rarer. Signing it later removes the warning entirely.

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
| `ICE_SERVERS` | *(none)* | Extra WebRTC servers for voice chat, as JSON. Only needed if some players cannot hear each other: add a TURN relay, e.g. `[{"urls":"turn:host:3478","username":"u","credential":"p"}]`. |
| `MONSTER_SPEED` | `1` | Extra multiplier on his movement (0.5–1.5), applied on top of the chosen difficulty. |
| `KEEP_AWAKE` | `10-4` | On a free host the server visits its own address every 10 minutes so it does not fall asleep, during these UTC hours (default 10:00–04:00, 18 hours a day). Any other window such as `14-2`, `on` for all day (only if this is the only free service on your Render account: they share 750 hours a month), or `off`. |
| `KEEP_AWAKE_URL` | *(Render sets it)* | The address to visit. Render provides it automatically; set it yourself on other hosts. |
| `RESUME_SECS` | `45` | How long a player whose connection dropped keeps their place before they are removed from the lobby and the match. |

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
7. Opening the gate rings **the final bell**: everyone has 2 minutes to get through it before it slams shut for good, and he is enraged the whole time. Go back for downed teammates only if there is time.

**Classes.** Before the match, each survivor picks Athlete, Medic, Mechanic or Sneak in the lobby (see [What is new in 1.1](#what-is-new-in-11)). The Headmaster in Hunt Mode has no class.

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
| `G` | Tap: drop held item. Hold and release: toss it a few metres (how you hand things to teammates) |
| `Space` | In a locker: hold your breath |
| `Tab` | Notebook: objectives and found notes |
| `Enter` | Text chat |
| `Esc` | Release the mouse / menu |

**Controllers (Xbox, PlayStation 4 and 5, and most others that copy the Xbox layout).** Connect it, press any button, and play. Menu → Controls → Controller shows the same layout drawn out, with the buttons of the pad you have.

| Xbox | PlayStation | Survivor | Headmaster (Hunt) |
|---|---|---|---|
| Left stick | Left stick | Move (push gently to walk slowly); press in to run | Move |
| Right stick | Right stick | Look; press in to crouch | Look |
| `LT` | `L2` | Run (hold). In a locker: hold your breath | Rage (hold) |
| `RT` | `R2` | Use the item you hold | Attack |
| `A` | `✕` | Doors, items, lockers, revive; switch who you watch after you die | Force doors, rip lockers open |
| `B` | `○` | Crouch (press again to stand) | Kill the lights |
| `X` | `□` | Tap: drop. Hold and let go: toss | Teleport |
| `Y` | `△` | Torch on or off | Set a trap |
| `LB` / `RB` | `L1` / `R1` | Previous / next item | |
| D-pad up / down / left | D-pad up / down / left | Ping (when down: call for help) / hold your breath / mute your mic | |
| `View` (hold) | `Share` or `Create` (hold), or the touchpad | Notebook | |
| `Menu` | `Options` | Pause | Pause |

In menus: the D-pad or left stick moves between buttons (left and right change sliders), `A` / `✕` chooses, `B` / `○` goes back, the right stick scrolls, and `LB` / `RB` switch tabs on the Controls screen. Typing (your name, chat) still needs a keyboard. Browsers only start sound after a click or a key press, so if you play with a controller only, click once on the page.

> Browsers reserve `Ctrl`+`W` for "close tab" and pages cannot override it. Crouch with `C`, or use Settings → Toggle Fullscreen (Chrome and Edge let the game lock those keys in fullscreen). The game also asks for confirmation before a tab closes mid-match.

**Voice chat.** In the lobby click **Enable Voice Chat** and allow the microphone. It needs `https://` (the deployed site) or `localhost`.

- In the lobby everyone with voice on hears everyone.
- In a match it is by proximity: voices come from where the player is standing, fade to nothing at about 22 m, and are quieter and muffled through walls and closed doors.
- The dead and the escaped hear everybody; the living cannot hear them.
- **He hears you.** How loudly you speak is reported to the server as noise: a murmur carries about 4 m, a shout about 14 m, even from inside a locker. The AI comes to investigate; a human Headmaster sees a pulse where the voice came from.
- `M` mutes your microphone. Settings has a push-to-talk option (hold `V`).
- Audio goes directly between players' browsers; the game server only introduces them. On most home networks that just works. On strict ones (some universities, offices, mobile carriers) two players may fail to connect; that needs a TURN relay set in `ICE_SERVERS`, which this project does not provide.

**Hunt Mode.** The host picks it in the lobby (2+ players). One random player is the Headmaster, never the same person twice running when avoidable; everyone else plays the normal escape. If his player disconnects, the AI takes over.

| The Headmaster can | Limits that keep it fair |
|---|---|
| See in the dark (red night vision) | Only about 6 m, and no name tags over survivors |
| Walk at 3.05 m/s (survivors walk 2.75, sprint 5.3) | Frozen for the first 20 s |
| Rage: 5.4 m/s while holding `Shift` | Lasts 3 s, 10 s to recharge |
| Attack with left click | 0.6 s wind-up everyone hears; a miss costs 2 s; after a hit that wounds he cannot attack for 8 s and is slowed for 4.5 s, and the survivor gets 2.5 s of adrenaline; after a hit that puts someone down, 3 s and no slowdown; he cannot hit downed players |
| Hear footsteps, doors, voices, bottles as pulses through walls | Over 75 % of the AI's hearing range, and the pulse is up to 1.5 m off; crouch-walking is silent beyond about a metre; bottles and lures make decoy pulses |
| Teleport 6 m forward (`R`) | 40 s cooldown, not through walls or closed doors, no strike for 2 s after |
| Set traps (`T`), up to 2 | Arm after 2 s; hold for 1.8 s and do no damage; crouch-walking over one is safe; not allowed near the exit |
| Kill the lights (`Q`): torches near him die for a moment | 70 s cooldown, torches out for 1.6 s |
| Force doors and rip open lockers (`E`) | Doors take 0.75 s and he cannot close them; a locker takes 1.8 s standing still, and a survivor holding their breath inside goes unnoticed half the time |

Survivors can blind him for 3 s by holding a torch beam on his face for 0.8 s (then he is immune for 10 s), the hand bell stuns him for 7 s, and a camera flash stuns him for 2 s (then he is dazzle-proof for 8 s). With one or two survivors, they get three hits instead of two. All of these numbers are in one block at the top of `server/hunter.js`.

The table shows the defaults. The host can change five of them in the lobby without touching code (**Headmaster tuning**): his walk and rage speed, how far his night vision reaches, how far he hears, his three cooldowns, and how many hits put a survivor down. When the gate opens he is enraged until the final bell ends: he moves 10% faster, his rage refills at once and it recharges twice as fast.

**Difficulty** is chosen by the host in the lobby (Escape mode only):

| | Beginner | Intermediate | Hard | Nightmare |
|---|---|---|---|---|
| His chase speed at the start (you sprint at 5.3 m/s) | 3.9 | 4.6 | 4.9 | 5.3 |
| Hits before you go down | 3 | 2 | 2 | 1 |
| Time to revive a downed player | 110 s | 80 s | 60 s | 45 s |
| Times you can be picked up (every fall after the first bleeds out twice as fast) | 3 | 2 | 2 | 1 |
| Supplies | more | normal | fewer | scarce |
| Predicts where you ran; patrols near your current objective | – | yes | yes | yes |
| Cuts you off in long chases, looks under tables, guards downed players, returns to where he lost you, learns which lockers you use, targets the wounded | – | – | yes | yes |
| Thrown bottles | always fooled | always fooled | fooled once, then often walks to the thrower | walks straight to the thrower |

**The Headmaster** patrols unpredictably, hears footsteps (running carries far, crouching barely at all), doors, dropped and thrown objects, and investigates. He sees further when your torch is on or the lights are powered, and poorly if you crouch in the dark or under a table. He opens doors (which slows him), searches after losing you, sometimes checks lockers — and always checks the one he watched you climb into. He gets faster and more persistent with every objective you complete. One hit wounds you, a second puts you down; teammates have 80 seconds to revive you with `E` (4 seconds, and noisy) or a med kit (instant). If he puts you down while a teammate is nearby, he goes for them next. Each fall after the first bleeds out twice as fast, and past the difficulty's limit you do not get up.

**Items:** fuses, office key, gate key, batteries (torch lasts ~6 minutes each), med kit (the Nurse's Office always has one), lockpick, glass bottles (throw to make noise somewhere else), hand bell (drives him off for a few seconds, one use), notes (clues to where things are and how to survive; shared with the whole team). Tap `G` to drop the item in your hand, hold `G` and let go to toss it.

**Lures** (press `E` on them): the piano in the Music Room (45 s cooldown), the radio in the Janitor's Closet (blares for 12 s, six seconds after you switch it on; 75 s cooldown), and the great bell on the Auditorium stage (once per match, heard everywhere). He comes to the noise.

**Hiding:** lockers (hold `Space` to hold your breath when he checks yours), crouching under tables and hospital beds, and crouching between the Auditorium seat rows or behind the stage drapes.

**Your character.** Menu → **Character** (or **Edit Character** in the lobby) sets skin, clothes, shoes, hair, headwear, extras and build, with a live preview. Other players see that character. In first person you see your own body when you look down, your left hand holding the torch, and your right hand holding whichever inventory slot is selected; other players see what you are holding too.

**Horror.** These are the same on every difficulty; difficulty only changes how dangerous the Headmaster is.

- *Jumpscares.* The scream is as loud as the browser can play it: it bypasses the game's limiter and ducks everything else (the volume slider still scales it). When he hits you, your light dies, your view is wrenched round to him and a face fills the screen with a scream (longer on the hit that puts you down). Half the time it is the second face, `client/assets/scareface.png`; replace or delete that file to change or remove it. Roughly every few minutes the school also plays a fake one on a single player when he is nowhere near.
- *Apparitions.* He appears standing still at a distance, visible only to you. Look at him too long or walk closer and he either vanishes with the lights, or runs at you.
- *Blackouts.* Your torch dies for a few seconds while something breathes behind you. Sometimes he is there for a blink when it comes back.
- *Sound.* A constant bed of rumble and dissonant voices; something distant every few seconds (pipes, hinges, moans, doors); a music box; a warped school bell; whispering; your own name spoken (uses the browser's speech voice, where available); lockers banging; clicking in his throat when he is near; a roar and pounding chase music when he sees you; everything goes muffled when you are hurt.
- *Picture.* Darker, thicker fog, heavier vignette, film grain; ceiling lights fail around him; his eyes turn red when he hunts.

Settings → Jumpscares switches off the face-on-screen scares (including the rushing apparition). The flash is a single brief pulse, not a strobe.

Text chat (`Enter`) works alongside voice.

## What is and is not in this version

Built: four difficulty levels; jumpscares; team pings; an on-screen current objective and item hints; start-of-match control tips; optional toggle-crouch; per-player stats on the end screen; a character creator; first-person body and hands; private lobbies with six-character codes, invite links, ready states, host start, host migration, rematch in the same lobby, disconnect handling, spectating after death or escape; the full school on one connected map (main hall, seven corridors, three classrooms, science lab, library with a hidden room behind a loose bookshelf, cafeteria, gym, bathroom, storage, security office with a live monitor map, staff room, locked principal's office, stairwell, basement, cellar, boiler room, courtyard and exit gate, plus the South Wing: auditorium and stage, music room, nurse's office, art room, janitor's closet, locker room); 29 doors plus the bookshelf and the gate; 37 lockers; three lures; holding your breath in lockers; the six-state monster AI plus a "stalk" behaviour; randomised item placement; inventory with drop/share; hiding, wounding, downing, reviving; power and lighting states; randomised paranormal events; procedural 3D audio; text chat; settings.

Not built, or simplified:

- **Reconnecting is limited to 45 seconds** (`RESUME_SECS`), and only in the same browser tab (the seat is remembered in that tab). After that, your items fall where you stood and you can rejoin the lobby with the code for the next round. A server restart still ends every match.
- **No touch controls.** Controllers work (see above); phones and tablets do not. A controller with a non-standard button layout in an unusual browser may have its buttons in the wrong places.
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
npm test                # the four suites below (needs dev dependencies)
```

- `test/smoke.js` — starts the real server and drives three real Socket.IO clients through a whole match: lobby rules, movement sync, teleport rejection, door sync, two players grabbing the same item, dropping and sharing, locked doors, the stairs, all six objectives, escape, disconnect during a match, host migration, rematch with re-randomised items, and dropping out and coming back (right token, wrong token, staying away too long).
- `test/ai.js` — runs the real game simulation headlessly and checks patrol, door opening, chase, attack, retreat, noise investigation, search, hiding rules, the bell, aggression scaling, the four difficulty levels, and the smarter behaviours (prediction, bottle origin, looking under tables, guarding the downed), plus walking away from his swing, the end of the endless revive loop (a pair who keep reviving each other on the spot now lose; before 1.2 they survived 15 minutes on every difficulty), holding your breath, lures, dropping and tossing, the 1.0 items, Thomas's teddy, roll call, detention rules, survivor classes and the final bell.
- `test/hunt.js` — Hunt Mode rules: the head start, speed limits and anti-cheat, rage, attack wind-up/dodge/lock-out, teleport, traps, light sabotage, torch, bell and camera stuns, hearing (including voice), the host's tuning sliders, and the AI taking over if the Headmaster's player leaves.
- `test/physics.js` — runs the real Rapier character controller against the real school colliders: walls, the gate, stairs down and up, crawling under tables, lockers.
- `test/browser-e2e.js` — optional; two real Chrome windows with real key presses (needs Playwright; instructions are at the top of the file).

## Project layout

```
server/index.js      lobbies, room codes, Socket.IO wiring, static file serving
server/game.js       one match: items, doors, objectives, health, win/loss
server/monster.js    the Headmaster's state machine (AI)
server/hunter.js     the Headmaster when a player controls him (Hunt Mode) and its balance numbers
client/shared/map.js the school layout, pathfinding and line of sight (used by server AND client)
client/js/main.js    menu, lobby, settings, match start/stop
client/js/input.js   controllers (Gamepad API): Xbox / PlayStation detection, sticks, buttons, vibration, on-screen button names
client/js/padnav.js  moving around menus with a controller
client/js/paddiagram.js  the controller drawing on the Controls screen
client/js/game.js    rendering loop, first-person controller, interpolation, HUD
client/js/world.js   builds the school geometry, lights, props, items
client/js/physics.js Rapier world and character controller
client/js/entities.js  monster and player models and animation
client/js/viewmodel.js first-person hands and the jumpscare
client/js/voice.js   proximity voice chat (WebRTC)
client/js/items.js   item meshes (world, hands)
client/shared/defs.js  difficulty levels, item codes, character options
scripts/floorplan.js   map generator (not served to players)
client/js/audio.js   synthesised sound
client/js/textures.js  procedurally painted textures
client/js/menubg.js    the animated school-at-night behind the menu
client/js/lightmap.js  baked lighting: loads the Blender lightmaps and blends power off / on / alarm
client/js/props.js     loose physics props (bins, chairs, cans…) and their impact sounds
client/js/post.js      post-processing: bloom, ambient occlusion, anti-aliasing, film look
client/js/atmos.js     torch beams and dust
client/js/keys.js      rebindable keyboard controls
client/assets/lightmap/  the baked lighting (from tools/bake)
client/download.html   the Windows download page (/download)
client/vendor/       three.js, Rapier, Socket.IO client (copied from npm by `npm run vendor`)
desktop/             the Windows app (Electron): main.js, preload.js, splash.html, build/ (icon, installer art)
tools/bake/          the lighting bake: export.mjs (game -> Blender) and bake.py (Blender Cycles)
.github/workflows/   builds and publishes the Windows installer
```

Libraries: three.js (MIT), Rapier (Apache-2.0), Socket.IO (MIT), Express (MIT).
