// One match on the client: rendering, local first-person controller, interpolation of
// everyone else, interaction, effects and HUD. All game rules live on the server.
import * as THREE from 'three';
import { MAP, W, floorY, ceilY, inBounds, lineOfSight, roomNameAt } from '../shared/map.js';
import { buildTextures, nameTexture } from './textures.js';
import { buildWorld } from './world.js';
import { buildPhysics, EYE_STAND, EYE_CROUCH, EYE_DOWNED } from './physics.js';
import { MonsterModel, PlayerModel, PLAYER_COLORS } from './entities.js';
import { ViewModel } from './viewmodel.js';
import { ITEM_TYPES, DIFFICULTY, CLASSES } from '../shared/defs.js';
import { input, BTN, glyph, label, fill } from './input.js';

export const QUALITY = {
  // lights = ceiling lights that are real light sources once the power is on; darkLights = while it is off
  low: { maxDpr: 1, scale: 0.75, shadows: false, shadowSize: 0, lights: 2, darkLights: 1, spots: 1, gloss: false },
  medium: { maxDpr: 1, scale: 1, shadows: true, shadowSize: 1024, lights: 4, darkLights: 2, spots: 2, gloss: false },
  high: { maxDpr: 1.5, scale: 1, shadows: true, shadowSize: 2048, lights: 6, darkLights: 2, spots: 3, gloss: true },
};
export const ITEM_HINT = {
  fuse: 'Fuse — carry it to the fuse box in the Boiler Room and press {interact}',
  key_principal: "Office Key — press {interact} on the Principal's Office door",
  key_gate: 'Gate Key — press {interact} on the main gate once its lock is disarmed',
  battery: 'Battery — {use} to recharge your torch',
  medkit: 'Med Kit — {use} to heal yourself, or next to a downed teammate to revive them at once',
  lockpick: 'Lockpick — press {interact} on a locked door to pick it (one use)',
  bottle: 'Bottle — {use} to throw it; he goes to the noise',
  bell: 'Hand Bell — {use} to ring it; drives him off once',
  camera: 'Camera — {use} to flash it in his face (within 8 m); he reels back',
  soda: 'Energy Drink — {use}: unlimited stamina for 12 seconds',
  alarm: 'Alarm Clock — {use} to wind it and set it down; it rings in 8 s and he comes to it',
  chalk: 'Chalk — {use} marks the wall you face: X. Hold A or D for an arrow, S for a warning',
  teddy: "Thomas's Teddy — put it back in his locker in the Locker Room (press {interact} there)",
};
const DROP_HINT = ' · {drop} drop · hold {drop} to toss';
const CHALK_PAD = 'Chalk — {use} marks the wall you face: X. Hold the left stick left or right for an arrow, down for a warning';
export const ITEM_INFO = {
  fuse: ['Fuse', '⚡'], key_principal: ['Office Key', '🗝️'], key_gate: ['Gate Key', '🔑'], battery: ['Battery', '🔋'],
  medkit: ['Med Kit', '⛑️'], lockpick: ['Lockpick', '📎'], bottle: ['Bottle', '🍾'], bell: ['Hand Bell', '🔔'], note: ['Note', '📄'],
  camera: ['Camera', '📷'], soda: ['Energy Drink', '🥤'], alarm: ['Alarm Clock', '⏰'], chalk: ['Chalk', '🖍️'], teddy: ['Teddy Bear', '🧸'],
};
const MOD_LABEL = { onehit: 'One strike', blackout: 'Lights out', restless: 'Restless school', sportsday: 'Sports day' };
const SEND_HZ = 15;
export const BACKPEDAL = 0.7, STRAFE = 0.88; // movement speed multipliers (walking backwards / sideways)
const BREATH_SECS = 7; // how long you can hold your breath in a locker
const LURE_LABEL = { piano: 'Play the piano — he will come to the noise', radio: 'Switch on the radio — it blares after 6 s', greatbell: 'Ring the great bell — once, and the whole school hears it' };
const INTERP_DELAY = 120; // ms behind the server; hides network jitter
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Game {
  constructor({ renderer, socket, init, settings, audio, RAPIER, ui, voice }) {
    this.r = renderer; this.s = socket; this.set = settings; this.audio = audio; this.ui = ui; this.voice = voice || null;
    this.role = init.role || 'survivor'; this.mode = init.mode || 'coop'; this.hunt = init.hunt || {}; this.hunterId = init.hunter ? init.hunter.id : null;
    const Q = (this.Q = QUALITY[settings.quality] || QUALITY.medium);
    // resolution: starts at the quality preset and is then tuned automatically to hold a smooth frame rate
    this.basePR = Math.min(window.devicePixelRatio || 1, Q.maxDpr) * Q.scale;
    this.res = { scale: 1, ceil: 1, ceilUntil: 0, acc: 0, n: 0, good: 0, raisedAt: -99 }; this.fps = 0;
    renderer.setPixelRatio(this.basePR);
    renderer.shadowMap.enabled = Q.shadows;
    renderer.shadowMap.type = THREE.PCFShadowMap; // the soft variant costs several times more per pixel
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = settings.bright;

    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color(0x020305);
    scene.fog = new THREE.FogExp2(0x020305, 0.062);
    // the fog swallows everything past ~28 m, so nothing beyond 34 m is drawn at all (smoother, looks identical)
    this.cam = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.06, 34);
    this.cam.rotation.order = 'YXZ';
    scene.add(this.cam);
    this.amb = new THREE.AmbientLight(0x7486a8, 0.36); scene.add(this.amb); this.ambBase = 0.36;

    this.T = buildTextures();
    this.world = buildWorld(scene, this.T, Q);
    this.ph = buildPhysics(RAPIER);

    // own flashlight, held slightly right of the eye so it throws visible shadows
    const fl = (this.flash = new THREE.SpotLight(0xfff1d6, 0, 32, 0.52, 0.6, 1.05));
    fl.position.set(-0.2, -0.2, 0.02); fl.target.position.set(-0.03, -0.04, -6); // it is in your left hand
    this.cam.add(fl, fl.target);
    if (Q.shadows) { fl.castShadow = true; fl.shadow.mapSize.setScalar(Q.shadowSize); fl.shadow.camera.near = 0.3; fl.shadow.camera.far = 30; fl.shadow.bias = -0.0015; fl.shadow.normalBias = 0.03; }
    this.spots = [];
    // teammates' torches: no point paying for spotlights nobody can be holding
    for (let i = 0; i < Math.min(Q.spots, init.players.filter((p) => p.id !== init.you).length); i++) { const s = new THREE.SpotLight(0xfff1d6, 0, 26, 0.5, 0.6, 1.05); scene.add(s, s.target); this.spots.push(s); }

    this.monster = new MonsterModel(this.T); scene.add(this.monster.group);
    // a second copy of him for things that are not really there
    this.ghost = new MonsterModel(this.T); this.ghost.group.visible = false; scene.add(this.ghost.group); this.ghostS = null; this.blackout = 0;
    this.mbuf = [{ t: 0, x: init.monster[0], z: init.monster[1], ry: init.monster[2], st: init.monster[3], crawl: init.monster[4] }];
    this.m = { x: init.monster[0], y: 0, z: init.monster[1], ry: 0, state: 0, speed: 0, crawl: 0, stepD: 0 };

    // players
    this.id = init.you;
    this.roster = new Map(); this.remotes = new Map();
    init.players.forEach((p, i) => {
      this.roster.set(p.id, { id: p.id, name: p.name, state: p.state, hp: p.hp, downs: p.downs || 0, away: !!p.away, hidden: -1, color: i, cls: p.cls || 'athlete' });
      if (p.id !== this.id) {
        const model = new PlayerModel(p.name, i, p.look); model.group.position.set(p.x, p.y, p.z); scene.add(model.group);
        this.remotes.set(p.id, { id: p.id, model, buf: [], cur: { x: p.x, y: p.y, z: p.z, ry: 0, rx: 0, f: 0, h: 0 }, speed: 0, stepD: 0, lastSnap: 0 });
      } else {
        this.ph.teleport(p.x, p.y, p.z);
        // your own body (headless, so the camera is not inside a skull) and first-person hands
        this.body = new PlayerModel(p.name, i, p.look, { firstPerson: true }); scene.add(this.body.group);
        this.vm = new ViewModel(p.look, this.T);
      }
    });
    this.me = this.roster.get(this.id);
    if (this.role === 'monster') {
      // Hunt mode and you are the Headmaster: no body, no torch, his hands, his eyes
      this.me = { id: this.id, name: init.hunter.name, state: 'alive', hp: 99, hidden: -1, color: 7 };
      this.ph.teleport(init.monster[0], floorY(init.monster[0], init.monster[1]), init.monster[1]);
      this.body = null; this.vm = new ViewModel(null, this.T); this.vm.enableClaws();
      this.monster.group.visible = false;
      scene.fog.density = this.hunt.nightFog || 0.1; // he sees in the dark, but not far
      this.cam.far = Math.min(34, 2.6 / scene.fog.density); this.cam.updateProjectionMatrix();
      this.mh = { rage: 1, grace: this.hunt.grace, tp: 0, trap: 0, lights: 0, atk: 0, slow: 0, stun: 0, traps: 0 }; this.mbusy = 0; this.mwind = 0; this.mstep = 0;
    }
    this.traps = new Map(); (init.traps || []).forEach((t) => this.addTrap(t.id, t.p));
    this.rootT = 0;
    this.maxHp = init.maxHp || 2; this.maxDowns = init.maxDowns ?? 2; this.difficulty = init.difficulty || 'intermediate';
    this.crouchLatch = false;
    this.tips = settings.tips ? [
      [4, '{torch} switches your torch on and off. It makes you much easier to see.'],
      [13, 'Hold {notebook} for the notebook. Crouch with {crouch} to move quietly. He hears running.'],
      [22, '{ping} pings whatever you are looking at so your team can find it.'],
      [31, '{interact} opens doors, picks things up and hides you in lockers.'],
      [42, 'Tap {drop} to drop what you are holding. Hold {drop} and let go to toss it to a teammate.'],
      [53, 'In a locker and he is checking it? Hold {breath} to hold your breath.'],
    ] : [];
    this.frame = 0; this.prevYaw = -Math.PI / 2; this.prevPitch = 0;
    if (Q.shadows) renderer.shadowMap.autoUpdate = false; // refreshed every second frame in the loop: halves the shadow cost

    // world state
    init.doors.forEach(([open, locked], i) => { this.world.setDoor(i, open, locked, true); this.ph.setDoor(i, !!open); });
    init.items.forEach((it) => this.world.addItem(it));
    this.obj = init.obj; this.notes = [...init.notes];
    this.lureState = (init.lures || []).map(([used, ready]) => ({ used: !!used, readyAt: ready || 0 }));
    this.breath = 1; this.holding = false; this.gaspLock = false; this.hbT2 = 0; this.inspectMine = 0; this.gHeld = null; this.boostT = 0;
    this.mods = new Set(init.mods || []); this.sodaT = 0; this.teddyDone = !!init.teddy;
    const meR = this.roster.get(this.id); this.cls = this.role === 'monster' ? null : meR ? meR.cls : 'athlete';
    this.final = init.final != null ? { until: init.final } : null; if (this.final) this.world.setAlarm(true);
    this.senseT = 0;
    this.roll = init.roll ? { id: init.roll.id, until: init.roll.t } : null; // (the local clock starts at 0)
    for (const m of init.marks || []) this.world.addMark(m, this.markColor(m.by));
    this.world.setFuses(this.obj.fuses); this.world.setPower(this.obj.power);
    this.inv = init.inv || [null, null, null, null]; this.sel = 0;

    // local player state
    this.yaw = -Math.PI / 2; this.pitch = 0; this.vx = 0; this.vz = 0;
    this.eye = EYE_STAND; this.bobT = 0; this.stepN = 0; this.stamina = 100; this.exhausted = false; this.regenDelay = 0;
    this.battery = 100; this.flashOn = true; this.threat = 0; this.shake = 0; this.hurtFlash = 0;
    this.keys = {}; this.chatOpen = false; this.locked = false; this.everLocked = false; this.ended = false;
    this.sendT = 0; this.hudT = 0; this.offset = null; this.lastSnapT = 0; this.time = 0; this.fx = [];
    this.targetT = 0; this.target = null; this.spec = null; this.revive = null; this.stingT = 0; this.camT = 0; this.lightningT = 0; this.roomShown = ''; this.roomT = 0;
    this.lastFeet = this.ph.getFeet();

    this.bind();
    this.renderInv(); this.renderNotebook(); this.renderTeam();
    $('hud').hidden = false; $('hud').classList.toggle('monster', this.role === 'monster'); $('mhud').hidden = this.role !== 'monster';
    this.renderHints();
    // on-screen keys follow whatever the player last touched: keyboard, Xbox pad or PlayStation pad
    this.unsubInput = input.onChange(() => { this.renderHints(); this._prompt = null; this._status = null; this.renderInv(); });
    if (this.role === 'monster') this.tips = [[1, `You are the Headmaster. You are frozen for ${this.hunt.grace} seconds while they scatter.`], [8, '{attack} attacks. Hold {rage} to rage (fast, but it runs out). You see in the dark; sounds they make appear as pulses.'], [16, '{teleport} teleports forward. {trap} sets a trap. {lights} kills the lights. {force} opens doors and rips open lockers.'], [24, 'Torch beams held on your face and the hand bell will stun you. Stop them reaching the gate.']];
    else if (this.mode === 'hunt' && this.tips.length) this.tips.unshift([2, `${init.hunter.name} is the Headmaster this round. Hold a torch beam on his face to blind him; crouch over his traps.`]);
    // back from a dropped connection into a match already under way
    const meNow = this.me;
    if (meNow && meNow.state === 'downed') { const ip = init.players.find((q) => q.id === this.id); this.bleed = ip && ip.bleed ? ip.bleed : 30; }
    if (meNow && (meNow.state === 'dead' || meNow.state === 'escaped')) this.cycleSpectate();
    this.resize();
    this.clock = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    window.__lb = this; this.__fy = floorY; // handy for debugging / automated tests
  }

  // ------------------------------------------------------------------ input & network wiring
  bind() {
    const L = (this.listeners = []);
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); L.push([el, ev, fn, opt]); };
    const canvas = this.r.domElement;
    on(window, 'resize', () => this.resize());
    on(document, 'keydown', (e) => this.onKey(e, true));
    on(document, 'keyup', (e) => this.onKey(e, false));
    on(window, 'blur', () => { this.keys = {}; this.gHeld = null; $('notebook').hidden = true; });
    on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      const k = 0.0022 * this.set.sens;
      this.yaw -= e.movementX * k; this.pitch = clamp(this.pitch - e.movementY * k, -1.45, 1.45);
    });
    on(canvas, 'mousedown', (e) => {
      this.audio.init();
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) this.primary();
      else if (e.button === 2) this.toggleFlash();
      else if (e.button === 1) { e.preventDefault(); this.ping(); }
    });
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(document, 'wheel', (e) => { if (this.locked) this.select((this.sel + (e.deltaY > 0 ? 1 : 3)) % 4); }, { passive: true });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.everLocked = true;
      else if (this.everLocked && !this.chatOpen && !this.ended) this.ui.onPause();
    });
    on($('chatinput'), 'keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = $('chatinput').value.trim(); if (v) this.s.emit('chat', v); this.closeChat(); }
      else if (e.key === 'Escape') this.closeChat();
    });
    // a stray Ctrl+W must not silently drop you out of a match
    on(window, 'beforeunload', (e) => { if (!this.ended) { e.preventDefault(); e.returnValue = ''; } });

    const S = (this.socketHandlers = { 'g:mcorrect': (p) => { if (this.role === 'monster') this.ph.teleport(p[0], floorY(p[0], p[1]), p[1]); }, 'g:mhud': (h) => { this.mh = h; }, 'g:snap': (sn) => this.onSnap(sn), 'g:ev': (e) => this.onEvent(e), 'g:correct': (p) => this.ph.teleport(p[0], p[1], p[2]), chat: (c) => this.chatLine(c) });
    for (const k in S) this.s.on(k, S[k]);
  }
  lock() { if (this.ended) return; try { const p = this.r.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  /** the key strip in the corner, in keyboard or controller buttons */
  renderHints() {
    const pad = input.mode === 'pad';
    const keys = this.role === 'monster' ? [['attack', 'attack'], ['rage', 'rage'], ['teleport', 'teleport'], ['trap', 'trap'], ['lights', 'lights'], ['force', 'doors and lockers'], ['pause', 'menu']]
      : [['torch', 'torch'], ['ping', 'ping'], ['drop', 'drop'], ['crouch', 'crouch'], ['notebook', 'notebook'], ['mute', 'mute'], ...(pad ? [] : [['chat', 'chat']]), ['pause', 'menu']];
    $('hint').innerHTML = keys.filter(([k]) => pad || k !== 'crouch').map(([k, v]) => `<span>${glyph(k)}${v}</span>`).join('');
    $('bar-stamina').querySelector('span').textContent = this.role === 'monster' ? `Rage (hold ${label('rage')})` : 'Stamina';
  }
  /**
   * Controller, once per frame (Xbox, PlayStation or any standard pad). Movement is read in
   * updateLocal/updateHunter from input.axes; this does the look and the button presses.
   */
  padFrame(dt) {
    const P = input;
    if (!P.connected) return;
    const live = !this.ended && !this.chatOpen && !this.offline && !this.ui.blocked();
    if (P.pressed(BTN.MENU) && !this.ended && !this.ui.blocked()) { P.consume(BTN.MENU); this.keys = {}; if (document.pointerLockElement) document.exitPointerLock(); this.ui.onPause(); return; }
    // notebook while View / Share (or the PlayStation touchpad) is held
    const note = live && this.role !== 'monster' && (P.held(BTN.VIEW) || P.held(BTN.PAD));
    if (note !== !!this.padNote) { this.padNote = note; $('notebook').hidden = !note; }
    if (!live) { this.gHeldPad = null; return; }
    // look: a curve gives fine aim near the centre and fast turns at full tilt
    const curve = (v) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);
    const rate = 3.3 * (this.set.padsens || 1), inv = this.set.padinvert ? -1 : 1;
    this.yaw -= curve(P.axes[2]) * rate * dt;
    this.pitch = clamp(this.pitch - curve(P.axes[3]) * rate * 0.72 * dt * inv, -1.45, 1.45);
    if (this.role === 'monster') {
      if (P.pressed(BTN.RT)) this.primary();
      if (P.pressed(BTN.A)) this.interact();
      if (P.pressed(BTN.X)) this.s.emit('g:mact', { k: 'tp' });
      if (P.pressed(BTN.Y)) this.s.emit('g:mact', { k: 'trap' });
      if (P.pressed(BTN.B)) this.s.emit('g:mact', { k: 'lights' });
      return;
    }
    const me = this.me, out = me.state === 'dead' || me.state === 'escaped';
    if (out) { if (P.pressed(BTN.A) || P.pressed(BTN.RT)) this.cycleSpectate(); return; }
    if (P.pressed(BTN.A)) this.interact();
    if (P.pressed(BTN.RT)) this.primary();
    if (P.pressed(BTN.Y)) this.toggleFlash();
    if (P.pressed(BTN.UP)) this.ping();
    if (P.pressed(BTN.LB)) this.select((this.sel + 3) % 4);
    if (P.pressed(BTN.RB)) this.select((this.sel + 1) % 4);
    if (P.pressed(BTN.B) || P.pressed(BTN.RS)) this.padCrouch = !this.padCrouch;
    if (P.pressed(BTN.LS)) this.padSprint = true; // click the left stick to run; it stops when you stop pushing forward
    if (P.pressed(BTN.LEFT) && this.voice && this.voice.enabled) { this.voice.setMuted(!this.voice.muted); this.audio.click(); }
    // tap to drop, hold and let go to toss (like G)
    if (P.pressed(BTN.X) && this.inv[this.sel]) this.gHeldPad = this.time;
    if (P.released(BTN.X) && this.gHeldPad != null) { const held = this.time - this.gHeldPad; this.gHeldPad = null; this.dropSelected(held); }
  }
  /** movement from the left stick: [forward, strafe] */
  padMove() {
    if (!input.connected || this.chatOpen || this.offline || this.ui.blocked()) return [0, 0];
    return [-input.axes[1], input.axes[0]];
  }
  /** the connection dropped (on) or came back (off): say so, and stop taking input meanwhile */
  setOffline(on) {
    this.offline = !!on; this.keys = {};
    $('netwarn').hidden = !on;
    if (on && document.pointerLockElement) document.exitPointerLock();
  }
  openChat() { this.chatOpen = true; this.keys = {}; const i = $('chatinput'); i.hidden = false; i.value = ''; i.focus(); }
  closeChat() { this.chatOpen = false; const i = $('chatinput'); i.hidden = true; i.blur(); }

  onKey(e, down) {
    if (this.chatOpen || this.offline || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (this.ui.blocked()) return;
    const c = e.code;
    if (c === 'Tab') { e.preventDefault(); $('notebook').hidden = !down; return; }
    if (e.ctrlKey && ['KeyS', 'KeyD', 'KeyA', 'KeyE', 'KeyF', 'KeyG'].includes(c)) e.preventDefault(); // keep browser shortcuts out of the way while crouching
    this.keys[c] = down;
    if (this.voice) { if (c === 'KeyV') this.voice.setPttDown(down); else if (c === 'KeyM' && down && !e.repeat && this.voice.enabled) { this.voice.setMuted(!this.voice.muted); this.audio.click(); } }
    if (c === 'Space') e.preventDefault();
    if (c === 'KeyG' && this.role !== 'monster') { // tap = drop, hold and release = toss
      if (down && !e.repeat && this.gHeld === null && this.inv[this.sel]) this.gHeld = this.time;
      else if (!down && this.gHeld !== null) { const held = this.time - this.gHeld; this.gHeld = null; this.dropSelected(held); }
      return;
    }
    if (!down || e.repeat) return;
    if (this.role === 'monster') {
      if (c === 'Enter') { e.preventDefault(); this.openChat(); }
      else if (c === 'KeyE') this.interact();
      else if (c === 'KeyQ') this.s.emit('g:mact', { k: 'lights' });
      else if (c === 'KeyR') this.s.emit('g:mact', { k: 'tp' });
      else if (c === 'KeyT') this.s.emit('g:mact', { k: 'trap' });
      return;
    }
    if (c === 'Enter') { e.preventDefault(); this.openChat(); }
    else if (c === 'KeyE') this.interact();
    else if (c === 'KeyF') this.toggleFlash();
    else if (c === 'KeyQ') this.ping();
    else if ((c === 'KeyC' || c === 'ControlLeft' || c === 'ControlRight') && this.set.togglecrouch) this.crouchLatch = !this.crouchLatch;
    else if (/^Digit[1-4]$/.test(c)) this.select(Number(c[5]) - 1);
  }
  select(i) { this.sel = i; this.gHeld = null; this.renderInv(); this.audio.ui(); }
  /** G was tapped (drop at your feet) or held for `held` seconds (toss it further) */
  dropSelected(held) {
    const me = this.me;
    if (!this.inv[this.sel] || this.ended || (me.state !== 'alive' && me.state !== 'downed') || me.hidden >= 0) return;
    const toss = me.state === 'alive' && held > 0.25 ? Math.min(1, (held - 0.25) / 0.8) : 0;
    if (toss) { this.s.emit('g:drop', { slot: this.sel, toss: +toss.toFixed(2), ry: +this.yaw.toFixed(3) }); this.audio.throwWhoosh(); this.vm.useItem('bottle'); }
    else { this.s.emit('g:drop', this.sel); this.vm.reach(); }
  }
  toggleFlash() {
    if (this.role === 'monster') return;
    if (this.me.state !== 'alive' && this.me.state !== 'downed') return;
    if (this.battery <= 0) { this.toast('Your torch is dead. Find a battery.', 'warn'); this.audio.deny(); return; }
    this.flashOn = !this.flashOn; this.audio.click();
    this.updateHud();
  }
  /**
   * The Headmaster's face fills the screen with a scream. `real` = he actually hit you (the view
   * snaps round to him); otherwise it is one of the school's rare tricks. Can be switched off in Settings.
   */
  jumpscare(long, real) {
    if (!this.set.jumpscares) return;
    const dur = long ? 1.15 : 0.75;
    this.vm.startScare(dur, Math.random() < 0.5); // half the time it is the other face
    this.audio.jumpscare(long);
    this.shake = Math.max(this.shake, 1.6); this.scareFlash = 0.16; this.scareStatic = dur;
    if (real) { const f = this.lastFeet; this.snapYaw = { to: Math.atan2(-(this.m.x - f.x), -(this.m.z - f.z)), t: 0.14 }; }
  }
  /** It knows who you are: the browser's own voice, slowed and dropped as low as it goes, plus whispering. */
  whisperName() {
    const c = this.cam.position, back = [c.x + Math.sin(this.yaw) * 0.6, c.y, c.z + Math.cos(this.yaw) * 0.6];
    this.audio.whisper(back);
    try {
      const u = new SpeechSynthesisUtterance(this.me.name);
      u.rate = 0.5; u.pitch = 0; u.volume = Math.min(1, 0.55 * this.set.vol);
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch { /* no speech synthesis in this browser: the whispering alone will do */ }
  }
  /** An apparition of the Headmaster that only you can see. mode: 'stand' (waits to be noticed) or 'flash'. */
  spawnGhost(x, y, z, mode) {
    this.ghostS = { x, y, z, mode, t: 0, seen: 0 };
    const g = this.ghost.group; g.position.set(x, y, z); g.visible = true;
  }
  endGhost(sting) {
    this.ghostS = null; this.ghost.group.visible = false;
    if (sting) { this.world.flicker(1.0); this.flickerOwn = 0.6; this.audio.stinger('stalk'); this.audio.noise({ dur: 0.3, type: 'highpass', freq: 3000, gain: 0.3, wet: 0.5 }); }
  }
  updateGhost(dt) {
    const G = this.ghostS; if (!G) return;
    const me = this.me;
    if (this.ended || me.state === 'dead' || me.state === 'escaped') return this.endGhost(false);
    G.t += dt;
    const c = this.cam.position, g = this.ghost.group;
    const dx = G.x - c.x, dz = G.z - c.z, d = Math.hypot(dx, dz) || 0.01;
    g.rotation.y = Math.atan2(-dx, -dz); // always facing you
    if (G.mode === 'flash') { // there for a blink when the light comes back
      this.ghost.update(dt, this.time, 4, 0, false);
      if (G.t > 0.4) this.endGhost(true);
    } else if (G.mode === 'stand') {
      this.ghost.update(dt, this.time, 6, 0, false); // dead still, head tilted
      const dot = (dx * -Math.sin(this.yaw) + dz * -Math.cos(this.yaw)) / d;
      if (dot > 0.92 && d < 22 && lineOfSight(c.x, c.z, G.x, G.z, null)) G.seen += dt;
      if (G.t > 18 && G.seen === 0) return this.endGhost(false);               // you never looked: he just leaves
      if (G.seen > 0.75 || d < 4.5) {
        if (this.set.jumpscares && d > 5.5 && Math.random() < 0.45) { G.mode = 'rush'; this.audio.roar([G.x, G.y + 1.8, G.z]); } // ...or he comes
        else this.endGhost(true);
      }
    } else { // rush: straight at you, far too fast
      const sp = 17 * dt;
      G.x -= (dx / d) * sp; G.z -= (dz / d) * sp; G.y = floorY(G.x, G.z);
      g.position.set(G.x, G.y, G.z);
      this.ghost.update(dt, this.time, 3, 7, false);
      if (d < 1.8) { this.endGhost(false); this.jumpscare(false, false); }
    }
  }
  // ------------------------------------------------------------------ Hunt mode
  addTrap(id, p) {
    if (this.traps.has(id)) return;
    const g = new THREE.Group(), iron = new THREE.MeshLambertMaterial({ color: 0x2a2623 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.025, 5, 14), iron); ring.rotation.x = Math.PI / 2; g.add(ring);
    for (let i = 0; i < 10; i++) { const t = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.1, 4), iron); const a = (i / 10) * Math.PI * 2; t.position.set(Math.cos(a) * 0.27, 0.05, Math.sin(a) * 0.27); g.add(t); }
    if (this.role === 'monster') { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.glow, color: 0xff3020, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false })); s.scale.setScalar(0.7); g.add(s); } // he can always find his own
    g.position.set(p[0], p[1] + 0.03, p[2]); this.scene.add(g);
    this.traps.set(id, { mesh: g, pos: p });
  }
  /** As the Headmaster: a sound someone made, shown as a pulse you can see through walls. */
  showHeard(e) {
    const col = { voice: 0xffe070, bottle: 0xffa040, trap: 0xff3020, revive: 0xff6050 }[e.k] || 0xdfe6ff;
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.glow, color: col, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    dot.position.set(e.p[0], e.p[1] + 0.9, e.p[2]); dot.renderOrder = 20; this.scene.add(dot);
    let t = 0; const life = e.k === 'trap' ? 4 : 2.2;
    this.fx.push((dt) => { t += dt; const d = this.cam.position.distanceTo(dot.position); dot.scale.setScalar((0.3 + d * 0.05) * (0.6 + t * 0.9)); dot.material.opacity = Math.max(0, 1 - t / life) * (0.35 + 0.65 * e.loud); if (t > life) { this.scene.remove(dot); dot.material.dispose(); return true; } });
    this.audio.tone({ freq: e.k === 'voice' ? 660 : 330, dur: 0.12, gain: 0.06 + 0.08 * e.loud, pos: [e.p[0], e.p[1] + 1, e.p[2]], wet: 0.6 });
  }
  /** Movement, camera and HUD state when YOU are the Headmaster. */
  updateHunter(dt) {
    const K = this.keys, ph = this.ph, h = this.mh, H = this.hunt;
    if (this.mbusy > 0) this.mbusy -= dt;
    if (this.mwind > 0) this.mwind -= dt;
    const frozen = this.ended || h.grace > 0 || this.mbusy > 0;
    let fwd = 0, strafe = 0;
    if (!frozen && !this.chatOpen && !this.ui.blocked()) { fwd = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0); strafe = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0); }
    let mag = 1;
    if (!frozen) { const [pf, ps] = this.padMove(); const pm = Math.hypot(pf, ps); if (pm > Math.hypot(fwd, strafe) * 0.5 && pm > 0) { fwd = pf; strafe = ps; mag = Math.min(1, pm); } }
    const rage = (K.ShiftLeft || K.ShiftRight || (input.connected && input.held(BTN.LT))) && fwd > 0.35 && h.rage > 0.03 && !(h.slow > 0) && !(h.stun > 0);
    let speed = rage ? H.rage : H.walk;
    if (h.stun > 0) speed = H.walk * 0.3; else if (this.mwind > 0) speed *= 0.8; else if (h.slow > 0) speed = H.walk * 0.5;
    if (fwd < 0) speed *= BACKPEDAL; else if (Math.abs(strafe) > fwd) speed *= STRAFE;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * strafe, wz = -cy * fwd - sy * strafe;
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx = (wx / wl) * speed * mag; wz = (wz / wl) * speed * mag; }
    const acc = Math.min(1, dt * 11);
    this.vx += (wx - this.vx) * acc; this.vz += (wz - this.vz) * acc;
    ph.setCrouch(false);
    const n = Math.ceil(dt / 0.034); for (let i = 0; i < n; i++) ph.move(this.vx, this.vz, dt / n);
    const f = ph.getFeet();
    const real = Math.hypot(f.x - this.lastFeet.x, f.z - this.lastFeet.z) / dt;
    this.lastFeet = f; this.speed = real;
    this.bobT += real * dt;
    const stride = rage ? 1.7 : 1.25, phase = (this.bobT / stride) * Math.PI;
    const by = real > 0.4 ? -Math.abs(Math.sin(phase)) * (rage ? 0.09 : 0.06) : 0;
    this.mstep += real * dt; if (this.mstep > stride) { this.mstep = 0; this.audio.footstep(rage ? 0.8 : 0.5, null, true); }
    const sh = this.shake; this.shake = Math.max(0, this.shake - dt * 1.6);
    const cam = this.cam;
    cam.position.set(f.x, f.y + 2.02 + by + (Math.random() - 0.5) * sh * 0.03, f.z); // he is tall
    cam.rotation.set(this.pitch, this.yaw, Math.sin(phase) * 0.012 * Math.min(1, real / 3));
    const m = this.m; m.x = f.x; m.y = f.y; m.z = f.z; m.d = 0; m.state = h.stun > 0 ? 5 : this.mwind > 0 ? 4 : rage ? 3 : 0;
    this.sendT -= dt;
    if (this.sendT <= 0 && !this.ended) { this.sendT = 1 / SEND_HZ; this.s.volatile.emit('g:mstate', [+f.x.toFixed(3), +f.z.toFixed(3), +(this.yaw + Math.PI).toFixed(3), rage ? 1 : 0]); }
    this.vmActive = !this.ended;
    this.vm.update(dt, { speed: real, bob: phase, light: 1.2 });
  }
  updateHunterFx(dt) {
    // night vision: a cold red wash instead of a torch
    this.flash.intensity = 0; this.threat = 0;
    this.amb.color.setHex(0xc79090);
    let amb = 1.8;
    if (this.lightningT > 0) { this.lightningT -= dt; this.world.windowMat.color.setScalar(this.lightningT > 0.4 ? 7 : 0.5); } else this.world.windowMat.color.setScalar(0.5);
    const fl = $('fx-flash');
    if (this.stunFx) { // blinded: bell = white-out, torch = glare
      this.stunFx.t -= dt;
      const k = Math.max(0, this.stunFx.t / this.stunFx.dur);
      fl.style.opacity = (this.stunFx.kind === 'bell' ? 0.92 : 0.75) * Math.min(1, k * 1.6);
      amb *= 0.3;
      if (this.stunFx.t <= 0) { this.stunFx = null; fl.style.opacity = 0; }
    }
    this.amb.intensity = amb;
    const hq = Math.round((this.mh.slow > 0 ? 0.25 : 0) * 30) / 30;
    if (hq !== this._hq) { this._hq = hq; const el = $('fx-hurt'); el.style.display = hq > 0.01 ? 'block' : 'none'; el.style.opacity = hq; }
  }
  /** Where a voice-chat peer should be heard from (see voice.js). */
  voiceWhere(id) {
    if (this.ended) return null;
    const me = this.me, living = this.role === 'monster' || me.state === 'alive' || me.state === 'downed';
    const c = this.cam.position;
    const closed = (cell) => { const di = MAP.doorAt[cell]; return di >= 0 && !this.world.doors[di].open; };
    if (id === this.hunterId) return living ? { mode: 'spatial', x: this.m.x, y: this.m.y + 1.9, z: this.m.z, clear: lineOfSight(c.x, c.z, this.m.x, this.m.z, closed) } : { mode: 'flat' };
    const p = this.roster.get(id), r = this.remotes.get(id);
    if (!living) return { mode: 'flat' };                                          // spectators hear everybody
    if (!p || !r || (p.state !== 'alive' && p.state !== 'downed')) return { mode: 'mute' }; // the living cannot hear the dead
    const L = p.hidden >= 0 ? MAP.lockers[p.hidden] : null;
    const x = L ? L.x + 0.5 : r.cur.x, y = (L ? L.y : r.cur.y) + 1.5, z = L ? L.z + 0.5 : r.cur.z;
    return { mode: 'spatial', x, y, z, clear: lineOfSight(c.x, c.z, x, z, closed) };
  }

  /** Mark what you are looking at for the whole team. Downed: call for help instead. */
  ping() {
    const me = this.me;
    if (this.ended || this.role === 'monster') return;
    if (me.state === 'downed') { this.s.emit('g:ping', {}); return; }
    if (me.state !== 'alive' || me.hidden >= 0) return;
    if (this.target && this.target.k === 'item') { this.s.emit('g:ping', { item: this.target.id }); return; }
    const c = this.cam.position, cp = Math.cos(this.pitch);
    const fx = -Math.sin(this.yaw) * cp, fy = Math.sin(this.pitch), fz = -Math.cos(this.yaw) * cp;
    let x = c.x, y = c.y, z = c.z;
    for (let t = 0.4; t <= 26; t += 0.25) { // walk along the view ray until it meets a wall, a closed door, the floor or the ceiling
      const nx = c.x + fx * t, ny = c.y + fy * t, nz = c.z + fz * t, cx = Math.floor(nx), cz = Math.floor(nz);
      if (!inBounds(cx, cz) || MAP.grid[cz * W + cx] === 0) break;
      const di = MAP.doorAt[cz * W + cx];
      if (di >= 0 && !this.world.doors[di].open) break;
      if (ny < floorY(nx, nz) + 0.05 || ny > ceilY(cx, cz) - 0.05) break;
      x = nx; y = ny; z = nz;
    }
    this.s.emit('g:ping', { x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) });
  }
  markColor(by) { const p = this.roster.get(by); return PLAYER_COLORS[(p ? p.color : 7) % 8]; }
  /** Thomas's thanks: every objective item lying around glows through the walls for a while */
  reveal(items, secs) {
    for (const [type, x, y, z] of items) {
      const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.glow, color: 0xbfe8ff, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
      const tex = nameTexture(ITEM_INFO[type][0], '#bfe8ff');
      const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      dot.position.set(x, y, z); label.position.set(x, y, z); dot.renderOrder = 20; label.renderOrder = 21;
      this.scene.add(dot, label);
      let t = 0;
      this.fx.push((dt) => {
        t += dt;
        const d = this.cam.position.distanceTo(dot.position), sc = 0.22 + d * 0.04, fade = Math.min(1, (secs - t) * 0.8, t * 2);
        dot.scale.setScalar(sc * (1 + Math.sin(t * 4) * 0.2)); dot.material.opacity = 0.75 * fade;
        label.scale.set(sc * 3.2, sc * 0.8, 1); label.position.y = y + sc * 0.85; label.material.opacity = 0.9 * fade;
        if (t > secs) { this.scene.remove(dot, label); dot.material.dispose(); tex.dispose(); label.material.dispose(); return true; }
      });
    }
    this.toast(`For ${secs} seconds you can see where the objective items are.`, 'good');
  }
  /** the school's public-address system, in a voice nobody should have */
  speakPA(text) {
    try {
      if (!('speechSynthesis' in window) || this.audio.muted) return;
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = 0.1; u.rate = 0.78; u.volume = Math.min(1, (this.set.vol ?? 0.8) * 0.9);
      setTimeout(() => { try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } catch { /* no voice: the text toast is enough */ } }, 1300);
    } catch { /* ignore */ }
  }
  showPing(e) {
    const p = this.roster.get(e.by), name = p ? p.name : '?';
    const color = PLAYER_COLORS[(p ? p.color : 7) % 8];
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.T.glow, color, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    const tex = nameTexture(e.help ? `${name}: HELP!` : e.item ? `${name}: ${ITEM_INFO[e.item][0]}` : name, e.help ? '#ff6a5e' : color);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
    dot.position.set(e.p[0], e.p[1], e.p[2]); label.position.set(e.p[0], e.p[1], e.p[2]);
    dot.renderOrder = 20; label.renderOrder = 21;
    this.scene.add(dot, label);
    let t = 0;
    this.fx.push((dt) => { // visible through walls for a few seconds, sized so it reads at any distance
      t += dt;
      const d = this.cam.position.distanceTo(dot.position), s = 0.25 + d * 0.045, fade = Math.min(1, (6.5 - t) * 1.2);
      dot.scale.setScalar(s * (1.2 + Math.sin(t * 7) * 0.25)); dot.material.opacity = 0.9 * fade;
      label.scale.set(s * 3.4, s * 0.85, 1); label.position.y = e.p[1] + s * 0.9; label.material.opacity = fade;
      if (t > 6.5) { this.scene.remove(dot, label); dot.material.dispose(); tex.dispose(); label.material.dispose(); return true; }
    });
    this.audio.ping(e.p, !!e.help);
    if (e.help && e.by !== this.id) this.toast(`${name} is calling for help!`, 'bad');
  }
  primary() {
    if (this.role === 'monster') { // the Headmaster swings
      const h = this.mh;
      if (this.ended || h.grace > 0 || h.stun > 0 || h.atk > 0 || this.mwind > 0 || this.mbusy > 0) { this.audio.deny(); return; }
      this.mwind = this.hunt.windup; this.vm.swipe(); this.s.emit('g:mact', { k: 'attack' });
      return;
    }
    if (this.me.state === 'dead' || this.me.state === 'escaped') return this.cycleSpectate();
    if (this.me.state !== 'alive' || this.me.hidden >= 0) return;
    const it = this.inv[this.sel];
    if (!it) return;
    if (it.type === 'bottle') this.audio.throwWhoosh();
    if (['bottle', 'bell', 'battery', 'medkit', 'camera', 'soda', 'chalk'].includes(it.type)) this.vm.useItem(it.type === 'camera' ? 'bell' : it.type);
    if (it.type === 'alarm') this.vm.reach();
    const K = this.keys, [plx, ply] = input.connected ? input.axes : [0, 0];
    const sym = K.KeyA || plx < -0.5 ? 1 : K.KeyD || plx > 0.5 ? 2 : K.KeyS || ply > 0.5 ? 3 : 0; // chalk: X, or an arrow, or a warning
    this.s.emit('g:use', { slot: this.sel, ry: this.yaw, rx: this.pitch, sym });
  }
  interact() {
    if (this.role === 'monster') {
      const t = this.target;
      if (!t || this.mbusy > 0 || this.mh.grace > 0 || this.mh.stun > 0) return;
      this.mbusy = t.k === 'locker' ? this.hunt.lockerTime : this.hunt.doorTime;
      this.s.emit('g:mact', { k: t.k, id: t.id }); this.vm.swipe();
      return;
    }
    if (this.me.state !== 'alive') return;
    if (this.me.hidden >= 0) return this.s.emit('g:interact', { k: 'exit' });
    const t = this.target;
    if (!t) return;
    this.s.emit('g:interact', { k: t.k, id: t.id });
    if (t.k !== 'item') this.audio.click();
    this.vm.reach();
  }

  // ------------------------------------------------------------------ network in
  onSnap(sn) {
    const now = performance.now();
    const off = sn.t - now;
    this.offset = this.offset === null ? off : this.offset + (off - this.offset) * 0.1;
    this.lastSnapT = sn.t;
    for (const e of sn.p) {
      if (e[0] === this.id) continue;
      const r = this.remotes.get(e[0]); if (!r) continue;
      r.buf.push({ t: sn.t, x: e[1], y: e[2], z: e[3], ry: e[4], rx: e[5], f: e[6], h: e[7] || 0 });
      if (r.buf.length > 30) r.buf.shift();
      r.lastSnap = sn.t;
    }
    this.mbuf.push({ t: sn.t, x: sn.m[0], z: sn.m[1], ry: sn.m[2], st: sn.m[3], crawl: sn.m[4] });
    if (this.mbuf.length > 30) this.mbuf.shift();
  }

  onEvent(e) {
    const A = this.audio, W = this.world;
    switch (e.e) {
      case 'door': {
        const D = W.doors[e.id], d = D.def;
        const was = D.open;
        W.setDoor(e.id, e.open, e.locked); this.ph.setDoor(e.id, !!e.open);
        const pos = d.kind === 'gate' ? [4.5, 1.2, 22.5] : [d.x + 0.5, floorY(d.x + 0.5, d.z + 0.5) + 1.2, d.z + 0.5];
        if (was === !!e.open) break;
        if (d.kind === 'gate') A.gate(pos);
        else if (d.kind === 'shelf') A.shelf(pos);
        else if (e.open) { A.doorOpen(pos); if (e.by === 'monster') A.doorClose(pos, true); }
        else A.doorClose(pos, e.by === 'ghost');
        break;
      }
      case 'item+': {
        W.addItem(e.item, e.from, !!e.toss);
        if (e.from) { let t = 0; const at = [e.item.x, e.item.y, e.item.z], dur = e.toss ? 0.45 : 0.3; this.fx.push((dt) => { t += dt; if (t >= dur) { A.thud(at, e.item.type === 'note'); return true; } }); }
        break;
      }
      case 'item-': W.removeItem(e.id); if (e.by === this.id) A.pickup(); break;
      case 'inv': this.inv = e.inv; this.renderInv(); break;
      case 'obj': this.obj = e.obj; W.setFuses(e.obj.fuses); this.renderNotebook(); break;
      case 'msg': this.toast(e.text, e.kind); if (e.kind === 'warn') A.deny(); break;
      case 'note': this.notes.push(e.text); this.renderNotebook(); break;
      case 'pstate': this.onPlayerState(e); break;
      case 'away': { const p = this.roster.get(e.id); if (p) { p.away = !!e.on; this.renderTeam(); } break; }
      case 'pleave': {
        const r = this.remotes.get(e.id);
        if (r) { this.scene.remove(r.model.group); r.model.dispose(); this.remotes.delete(e.id); }
        this.roster.delete(e.id); if (this.spec === e.id) { this.spec = null; if (this.me.state === 'dead' || this.me.state === 'escaped') this.cycleSpectate(); } this.renderTeam(); break;
      }
      case 'hit':
        if (e.id === this.id) { A.hit(); this.shake = 1; this.hurtFlash = 1; this.jumpscare(this.me.hp <= 1, true); input.rumble(1, 0.8, this.me.hp <= 1 ? 700 : 420); }
        else { const r = this.remotes.get(e.id); if (r) { A.noise({ dur: 0.3, freq: 400, gain: 1.4, pos: [r.cur.x, r.cur.y + 1, r.cur.z] }); A.tone({ freq: 520, to: 300, dur: 0.5, type: 'sawtooth', gain: 0.2, pos: [r.cur.x, r.cur.y + 1.5, r.cur.z], vibrato: 30 }); } }
        break;
      case 'hide': {
        const p = this.roster.get(e.id); if (!p) break;
        const L = MAP.lockers[e.locker >= 0 ? e.locker : p.hidden];
        p.hidden = e.locker;
        if (L) A.doorClose([L.x + 0.5, L.y + 1, L.z + 0.5], !!e.pulled);
        if (e.id === this.id) { $('fx-locker').classList.toggle('on', e.locker >= 0); if (e.locker >= 0) { this.yaw = Math.atan2(-L.dx, -L.dz); this.pitch = 0; } if (e.pulled) this.shake = 1; }
        break;
      }
      case 'lockerinspect': { const L = MAP.lockers[e.id]; A.rattle([L.x + 0.5, L.y + 1, L.z + 0.5]); if (this.me.hidden === e.id) { this.shake = 0.6; this.inspectMine = 1.8; } break; }
      case 'lockerpass': { const L = MAP.lockers[e.id]; A.moan([L.x + 0.5 + L.dx * 1.5, L.y + 1.8, L.z + 0.5 + L.dz * 1.5]); if (this.me.hidden === e.id) this.inspectMine = 0; break; }
      case 'gasp': if (e.id !== this.id) { const L = MAP.lockers[e.locker]; if (L) A.gasp([L.x + 0.5, L.y + 1.5, L.z + 0.5]); } break;
      case 'lure': {
        const L = MAP.lures[e.id], pos = [L.x, L.y, L.z];
        this.lureState[e.id] = { used: !!e.used, readyAt: this.time + (e.ready || 0) };
        W.lureFx(e.id, e.delay, e.dur);
        if (L.kind === 'piano') A.piano(pos, e.dur);
        else if (L.kind === 'radio') A.radio(pos, e.delay, e.dur);
        else { A.greatBell(pos); this.shake = Math.max(this.shake, 0.5); W.flicker(1.2); }
        break;
      }
      case 'fuse': A.fuse([MAP.fuseBox.x, MAP.fuseBox.y, MAP.fuseBox.z]); W.setFuses(e.n); break;
      case 'power': W.setPower(true); A.powerUp(); W.flicker(1.8); break;
      case 'security': A.security(); break;
      case 'revive':
        if (e.by === this.id || e.target === this.id) this.revive = e.on ? { t: 0, dur: e.dur } : null;
        break;
      case 'throw': this.spawnThrow(e); break;
      case 'smash': A.smash(e.p); break;
      case 'bell': A.bell(e.p); break;
      case 'battery': this.battery = 100; this.flashOn = true; A.click(); this.toast('Fresh battery fitted.', 'good'); break;
      case 'mstate': this.onMonsterState(e.s); break;
      case 'para': this.paranormal(e); break;
      case 'ping': this.showPing(e); break;
      // ---- Hunt mode ----
      case 'heard': this.showHeard(e); break;
      case 'trap+': this.addTrap(e.id, e.p); A.noise({ dur: 0.08, type: 'bandpass', freq: 1800, q: 4, gain: 0.5, pos: e.p }); break;
      case 'trap-': {
        const t = this.traps.get(e.id);
        if (t) { if (e.by) { A.clang(t.pos, 1.2); A.noise({ dur: 0.1, type: 'highpass', freq: 2500, gain: 1.4, pos: t.pos }); } this.scene.remove(t.mesh); this.traps.delete(e.id); }
        break;
      }
      case 'photo': {
        A.photo(e.by === this.id ? null : e.p); W.flashAt(e.p);
        if (e.by === this.id) { const fl = $('fx-flash'); fl.style.transition = 'none'; fl.style.opacity = 0.35; requestAnimationFrame(() => { fl.style.transition = 'opacity 0.4s'; fl.style.opacity = 0; }); }
        break;
      }
      case 'soda': this.sodaT = e.t; this.toast(`Sugar rush: you can sprint as long as you like for ${e.t} seconds.`, 'good'); break;
      case 'sfx': if (e.k === 'can') A.can(e.p); break;
      case 'alarm': W.addAlarm(e); A.alarm(e.p, e.delay, e.dur); break;
      case 'chalk': W.addMark(e, this.markColor(e.by)); A.chalk(e.p); break;
      case 'chalk-': W.removeMark(e.id); break;
      case 'ghost': this.teddyDone = true; W.ghost(e.p); A.ghostThanks(e.p); this.renderNotebook(); break;
      case 'reveal': this.reveal(e.items, e.t); break;
      case 'rollcall': {
        this.roll = { id: e.id, until: this.time + e.t };
        A.pa(); this.speakPA(`${e.name}. Report to the Principal's office. Immediately.`);
        if (e.id === this.id) this.toast('The Headmaster has called your name. For 30 seconds he has a rough idea where you are. Hide, or keep moving.', 'bad');
        else this.toast(`Roll call: the Headmaster wants ${e.name}. Stay away from them, or help them hide.`, 'warn');
        break;
      }
      case 'rollend': this.roll = null; break;
      case 'finalbell': {
        this.final = { until: this.time + e.t }; this.roll = null;
        W.setAlarm(true); this.shake = Math.max(this.shake, 0.6);
        for (let i = 0; i < 3; i++) setTimeout(() => A.schoolBell(null), i * 1600);
        A.siren(e.t);
        break;
      }
      case 'gateslam': input.rumble(0.7, 0.5, 600); this.final = null; A.stopSiren(); A.gate([4.5, 1.2, 22.5]); A.stinger(); this.shake = 1; W.setAlarm(false); break;
      case 'adrenaline': this.boostT = e.t; this.stamina = Math.max(this.stamina, 60); this.exhausted = false; this.toast('Adrenaline. RUN.', 'bad'); break;
      case 'rooted': this.rootT = e.t; this.shake = 1; this.hurtFlash = 0.5; this.toast('A trap! You are held fast.', 'bad'); break;
      case 'sabotage': {
        const c = this.cam.position, d = Math.hypot(e.p[0] - c.x, e.p[1] - c.z);
        if (d < 26) { W.flicker(e.t); A.noise({ dur: 0.6, type: 'highpass', freq: 3500, gain: 0.25, wet: 0.3 }); A.tone({ freq: 50, dur: 1.5, gain: 0.6, wet: 0.3 }); }
        if (this.role !== 'monster' && d < 14) this.blackout = this.hunt.blackout || 1.6; // torches near him die for a moment
        break;
      }
      case 'mtp': A.noise({ dur: 0.5, type: 'bandpass', freq: 400, q: 2, gain: 0.9, pos: e.to, sweep: 5 }); A.tone({ freq: 90, to: 40, dur: 0.6, gain: 0.8, pos: e.to }); W.flicker(0.8); break;
      case 'mwind': if (this.role !== 'monster') A.roar([this.m.x, this.m.y + 1.8, this.m.z]); else A.tone({ freq: 70, to: 45, dur: 0.5, type: 'sawtooth', gain: 0.25, wet: 0.3 }); break;
      case 'mstun':
        if (this.role === 'monster') { this.stunFx = { t: e.t, dur: e.t, kind: e.kind }; A.tone({ freq: 2800, dur: e.t, gain: 0.06, wet: 0 }); if (e.kind === 'bell') A.bell(null); }
        else { A.moan([this.m.x, this.m.y + 1.8, this.m.z]); if (e.kind === 'torch') this.toast('The light blinds him. Run.', 'good'); }
        break;
      case 'hunterleft': this.hunterId = null; break;
    }
  }

  onPlayerState(e) {
    const p = this.roster.get(e.id); if (!p) return;
    const prev = p.state;
    p.state = e.state; p.hp = e.hp; if (e.state !== 'alive') p.hidden = -1;
    if (e.downs !== undefined) p.downs = e.downs;
    if (e.id === this.id) {
      if (e.state === 'downed') { this.bleed = e.bleed || 80; }
      if (e.state === 'alive' && prev === 'downed') {
        this.audio.heal();
        const left = this.maxDowns - (p.downs || 0);
        this.toast(left <= 0 ? 'Back on your feet, barely. If you go down again, you will not get up.' : `Back on your feet. Next time you go down you bleed out twice as fast${left === 1 ? ', and after that there is no getting up' : ''}.`, left <= 0 ? 'bad' : 'warn');
      }
      if (e.state === 'alive' && e.hp === this.maxHp && prev === 'alive') this.audio.heal();
      if (e.state === 'dead' || e.state === 'escaped') { $('fx-locker').classList.remove('on'); this.cycleSpectate(); }
    } else if (this.spec === e.id && e.state !== 'alive' && e.state !== 'downed') this.cycleSpectate();
    this.renderTeam();
  }

  onMonsterState(s) {
    const d = Math.hypot(this.m.x - this.cam.position.x, this.m.z - this.cam.position.z);
    if (s === 3 && d < 24 && this.time - this.stingT > 9) { this.audio.stinger('chase'); this.audio.roar([this.m.x, this.m.y + 1.8, this.m.z]); this.stingT = this.time; }
    if (s === 6 && d < 30) this.audio.stinger('stalk');
    if (s === 2 && this.m.state === 3 && d < 24) this.audio.stinger('lost');
  }

  paranormal(e) {
    const A = this.audio, p = e.p;
    switch (e.type) {
      case 'apparition': this.spawnGhost(p[0], p[1], p[2], 'stand'); break;
      case 'blackout': this.blackout = 2.8; A.blackoutHit(); A.breathBehind(); this.world.flicker(2.8); break; // your light dies. Something breathes.
      case 'breath': A.breathBehind(); break;
      case 'name': this.whisperName(); break;
      case 'lockerbang': { const L = MAP.lockers[e.id]; A.lockerBang([L.x + 0.5, L.y + 1, L.z + 0.5]); break; }
      case 'bell': A.schoolBell([p[0], p[1] + 2.5, p[2]]); break;
      case 'musicbox': A.musicBox([p[0], p[1] + 0.6, p[2]]); break;
      case 'croak': A.croak([p[0], p[1] + 1.8, p[2]]); break;
      case 'jump': this.world.flicker(1.5); this.flickerOwn = 0.9; this.jumpscare(false, false); break; // not really there. Probably.
      case 'flicker': this.world.flicker(2.2); this.flickerOwn = 1.2; A.noise({ dur: 0.5, type: 'highpass', freq: 4000, gain: 0.08, wet: 0 }); break;
      case 'whisper': A.whisper([p[0], p[1] + 1.5, p[2]]); break;
      case 'scream': A.scream([p[0], p[1] + 1.5, p[2]]); break;
      case 'steps': A.steps([p[0], p[1], p[2]]); break;
      case 'knock': A.knock([p[0], p[1] + 1, p[2]]); break;
      case 'clang': A.clang([p[0], p[1] + 1, p[2]]); break;
      case 'thunder': this.lightning(); break;
      case 'fall': {
        A.fall([p[0], p[1], p[2]]);
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.3), new THREE.MeshLambertMaterial({ color: 0x5a2b24 }));
        m.position.set(p[0], p[1] + 2.2, p[2]); this.scene.add(m);
        let t = 0;
        this.fx.push((dt) => { t += dt; if (t < 0.6) { m.position.y = p[1] + 2.2 - 2.15 * (t / 0.6) ** 2; m.rotation.x += dt * 9; m.rotation.z += dt * 5; } else { m.position.y = p[1] + 0.03; m.rotation.x = 0; m.rotation.z = 0; } if (t > 40) { this.scene.remove(m); return true; } });
        break;
      }
      case 'shadow': {
        // something crosses the far end of your view and is gone
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 2.5), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
        const c = this.cam.position, dx = p[0] - c.x, dz = p[2] - c.z, d = Math.hypot(dx, dz) || 1;
        const px = -dz / d, pz = dx / d;
        m.rotation.y = Math.atan2(dx, dz); this.scene.add(m);
        let t = 0;
        this.fx.push((dt) => { t += dt; const k = t / 0.7 - 0.5; m.position.set(p[0] + px * k * 3.5, p[1] + 1.25, p[2] + pz * k * 3.5); m.material.opacity = 0.9 * Math.sin(Math.min(1, t / 0.7) * Math.PI); if (t > 0.7) { this.scene.remove(m); return true; } });
        this.audio.tone({ freq: 55, dur: 1.2, gain: 0.3, attack: 0.2, wet: 0.4 });
        break;
      }
    }
  }
  lightning() {
    this.lightningT = 0.5;
    const near = MAP.windows.some((w) => Math.hypot(w.x - this.cam.position.x, w.z - this.cam.position.z) < 12) || this.cam.position.x < 5;
    this.lightningNear = near;
    this.audio.thunder(Math.random());
  }
  spawnThrow(e) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 6), new THREE.MeshLambertMaterial({ color: 0x2f5a3a, emissive: 0x0a2010 }));
    this.scene.add(m);
    const a = e.from, b = e.to; let t = 0;
    this.fx.push((dt) => { t += dt / 0.75; const k = Math.min(1, t); m.position.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k) + Math.sin(k * Math.PI) * 1.4, lerp(a[2], b[2], k)); m.rotation.x += dt * 14; if (t >= 1) { this.scene.remove(m); return true; } });
  }

  cycleSpectate() {
    const live = [...this.remotes.values()].filter((r) => { const p = this.roster.get(r.id); return p && (p.state === 'alive' || p.state === 'downed'); });
    if (!live.length) { this.spec = null; return; }
    const i = live.findIndex((r) => r.id === this.spec);
    this.spec = live[(i + 1) % live.length].id;
  }

  // ------------------------------------------------------------------ main loop
  loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const raw = (now - this.clock) / 1000;
    this.tunePerformance(raw);
    const dt = Math.min(0.2, raw); // long frames are sub-stepped in the physics below, so low FPS never means slow motion
    this.clock = now; this.time += dt;
    if (dt <= 0) return;
    input.poll(); this.padFrame(dt);
    if (this.role === 'monster') this.updateHunter(dt); else this.updateLocal(dt);
    this.updateRemotes(dt, now);
    this.updateMonster(dt, now);
    this.updateGhost(dt);
    this.updateEffects(dt);
    this.targetT -= dt; if (this.targetT <= 0) { this.targetT = 0.07; this.updateTarget(); }
    for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i](dt)) this.fx.splice(i, 1);
    this.world.update(dt, this.time, this.cam.position, this.cam.rotation.y);
    this.audio.setListener(this.cam.position, this.cam.rotation.y);
    if (this.voice && this.voice.enabled) this.voice.frame(dt, (id) => this.voiceWhere(id), this.role === 'survivor' && this.me.state === 'alive' && !this.ended ? (lvl) => this.s.emit('g:voice', +lvl.toFixed(2)) : null);
    this.audio.update(dt, this.ended ? 0 : this.threat, this.ended ? null : this.m, this.world.power, this.ended ? 20000 : this.me.state === 'downed' ? 520 : this.me.state === 'alive' && this.me.hp < this.maxHp ? 4200 : 20000);
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.1; this.updateHud(); }
    // shadows are re-rendered every second frame (the one-frame lag is invisible, the saving is not)
    if (this.Q.shadows) this.r.shadowMap.needsUpdate = (this.frame++ & 1) === 0;
    this.r.render(this.scene, this.cam);
    // first-person hands: second tiny pass on top, with depth cleared so they never clip into walls
    if (this.vmActive) { this.r.autoClear = false; this.r.clearDepth(); this.r.render(this.vm.scene, this.vm.cam); this.r.autoClear = true; }
  };

  /**
   * Keeps the game smooth on any GPU: measures the real frame rate once a second and lowers the
   * internal render resolution when it drops below ~50 fps, raising it again when there is headroom.
   */
  tunePerformance(raw) {
    const r = this.res;
    if (raw > 0.5 || document.hidden) { r.acc = 0; r.n = 0; return; } // tab was in the background
    r.acc += raw; r.n++;
    if (r.acc < 1) return;
    const fps = r.n / r.acc; r.acc = 0; r.n = 0; this.fps = fps;
    const el = $('fps');
    if (this.set.showfps) { el.hidden = false; el.textContent = `${Math.round(fps)} fps · ${Math.round(r.scale * 100)}% res`; } else el.hidden = true;
    if (!this.set.dynres) { if (r.scale !== 1) this.setResScale(1); return; }
    if (this.time < 4) return; // ignore start-up hitches (shader compilation)
    if (this.time > r.ceilUntil) r.ceil = 1;
    if (fps < 48 && r.scale > 0.5) {
      const next = Math.max(0.5, r.scale * (fps < 34 ? 0.78 : 0.88));
      if (this.time - r.raisedAt < 6) { r.ceil = next; r.ceilUntil = this.time + 60; } // the last increase was too much: stay below it for a while
      r.good = 0; this.setResScale(next);
    } else if (fps > 56 && r.scale < r.ceil) {
      if (++r.good >= 4) { r.good = 0; r.raisedAt = this.time; this.setResScale(Math.min(r.ceil, r.scale * 1.12)); }
    } else r.good = 0;
  }
  setResScale(v) {
    this.res.scale = v;
    this.r.setPixelRatio(this.basePR * v);
    this.r.setSize(innerWidth, innerHeight, false);
  }

  updateLocal(dt) {
    const me = this.me, K = this.keys, ph = this.ph;
    const controllable = (me.state === 'alive' || me.state === 'downed') && me.hidden < 0 && !this.ended;
    const downed = me.state === 'downed';
    let fwd = 0, strafe = 0;
    if (controllable && !this.chatOpen && !this.ui.blocked()) { fwd = (K.KeyW || K.ArrowUp ? 1 : 0) - (K.KeyS || K.ArrowDown ? 1 : 0); strafe = (K.KeyD || K.ArrowRight ? 1 : 0) - (K.KeyA || K.ArrowLeft ? 1 : 0); }
    // the left stick: how far you push it is how fast you walk
    let mag = 1;
    if (controllable) { const [pf, ps] = this.padMove(); const pm = Math.hypot(pf, ps); if (pm > Math.hypot(fwd, strafe) * 0.5 && pm > 0) { fwd = pf; strafe = ps; mag = Math.min(1, pm); } }
    if (fwd < 0.3) this.padSprint = false;
    if (this.rootT > 0) { this.rootT -= dt; fwd = 0; strafe = 0; } // caught in one of his traps
    if (downed) this.padCrouch = false;
    const wantCrouch = downed || this.padCrouch || (this.set.togglecrouch ? this.crouchLatch : K.ControlLeft || K.ControlRight || K.KeyC);
    if (this.exhausted && !downed) { this.pantT = (this.pantT || 0) - dt; if (this.pantT <= 0) { this.pantT = 0.62; this.audio.pant(); } }
    const crouch = controllable && (wantCrouch || (ph.isCrouched() && ph.lowCeiling()));
    if (controllable) ph.setCrouch(!!crouch);
    const moving = fwd !== 0 || strafe !== 0;
    const padRun = input.connected && (input.held(BTN.LT) || this.padSprint) && me.hidden < 0;
    const sprint = !crouch && !downed && (K.ShiftLeft || K.ShiftRight || padRun) && fwd > 0.35 && !this.exhausted && this.stamina > 0;
    const tireless = this.mods.has('sportsday') || this.sodaT > 0;
    if (this.sodaT > 0) this.sodaT -= dt;
    const ath = this.cls === 'athlete';
    if (sprint && moving && !tireless) { this.stamina = Math.max(0, this.stamina - (ath ? 14.3 : 19) * dt); this.regenDelay = ath ? 0.7 : 0.9; if (this.stamina <= 0) this.exhausted = true; }
    else if (tireless) { this.stamina = 100; this.exhausted = false; }
    else { this.regenDelay -= dt; if (this.regenDelay <= 0) this.stamina = Math.min(100, this.stamina + 13 * dt); if (this.exhausted && this.stamina > 30) this.exhausted = false; }
    let speed = downed ? 0.75 : crouch ? 1.45 : sprint ? 5.3 : 2.75;
    if (me.hp === 1 && !downed) speed *= 0.9;
    // you cannot walk backwards (or crab sideways) as fast as you walk forwards
    if (!downed) { if (fwd < 0) speed *= BACKPEDAL; else if (Math.abs(strafe) > fwd) speed *= STRAFE; }
    if (this.boostT > 0) { this.boostT -= dt; if (!downed) speed *= 1.25; } // adrenaline after a hit (Hunt Mode)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * strafe, wz = -cy * fwd - sy * strafe;
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx = (wx / wl) * speed * mag; wz = (wz / wl) * speed * mag; }
    const acc = Math.min(1, dt * 11);
    this.vx += (wx - this.vx) * acc; this.vz += (wz - this.vz) * acc;
    if (controllable) { const n = Math.ceil(dt / 0.034); for (let i = 0; i < n; i++) ph.move(this.vx, this.vz, dt / n); }
    const f = ph.getFeet();
    const real = Math.hypot(f.x - this.lastFeet.x, f.z - this.lastFeet.z) / dt;
    this.lastFeet = f; this.speed = real; this.crouching = !!crouch; this.sprinting = !!sprint && real > 3.2;

    // camera
    const cam = this.cam;
    if (me.hidden >= 0) {
      const L = MAP.lockers[me.hidden], base = Math.atan2(-L.dx, -L.dz);
      let d = this.yaw - base; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      this.yaw = base + clamp(d, -0.5, 0.5); this.pitch = clamp(this.pitch, -0.4, 0.4);
      cam.position.set(L.x + 0.5 - L.dx * 0.1, L.y + 1.5, L.z + 0.5 - L.dz * 0.1);
      cam.rotation.set(this.pitch, this.yaw, 0);
    } else if (me.state === 'dead' || me.state === 'escaped') {
      const r = this.remotes.get(this.spec);
      for (const o of this.remotes.values()) o.model.group.visible = o.visible && o.id !== this.spec;
      if (r) { cam.position.set(r.cur.x, r.cur.y + (r.cur.f & 1 ? EYE_CROUCH : EYE_STAND), r.cur.z); cam.rotation.set(r.cur.rx, r.cur.ry, 0); }
      else { cam.position.set(2.5, 2.2, 22.5); cam.rotation.set(-0.1, -Math.PI / 2, 0); }
    } else {
      this.eye = lerp(this.eye, downed ? EYE_DOWNED : crouch ? EYE_CROUCH : EYE_STAND, Math.min(1, dt * 9));
      // head bob + footsteps
      let by = 0, bx = 0;
      if (real > 0.4) {
        this.bobT += real * dt;
        const stride = crouch ? 1.0 : sprint ? 2.1 : 1.5;
        const phase = (this.bobT / stride) * Math.PI, amp = crouch ? 0.018 : sprint ? 0.065 : 0.04;
        by = -Math.abs(Math.sin(phase)) * amp; bx = Math.cos(phase) * amp * 0.5;
        const n = Math.floor(this.bobT / stride);
        if (n !== this.stepN) { this.stepN = n; this.audio.footstep(downed ? 0.3 : crouch ? 0.25 : sprint ? 1.5 : 0.8); }
      }
      const sh = this.shake + this.threat * 0.35;
      const jx = (Math.random() - 0.5) * sh * 0.03, jy = (Math.random() - 0.5) * sh * 0.03;
      cam.position.set(f.x + cy * bx, f.y + this.eye + by + jy, f.z - sy * bx);
      cam.rotation.set(this.pitch + jy, this.yaw + jx, clamp(-strafe * 0.012 * (real / 3), -0.02, 0.02) + jx * 2 + (downed ? 0.35 : 0));
    }
    this.shake = Math.max(0, this.shake - dt * 1.6);

    // tell the server where we are
    this.sendT -= dt;
    const inLocker = me.hidden >= 0 && me.state === 'alive' && !this.ended;
    if (inLocker) {
      // hold SPACE to hold your breath while he checks your locker
      if ((K.Space || (input.connected && (input.held(BTN.LT) || input.held(BTN.DOWN)))) && !this.gaspLock && this.breath > 0) {
        this.holding = true; this.breath = Math.max(0, this.breath - dt / (BREATH_SECS * (this.cls === 'sneak' ? 1.5 : 1)));
        this.hbT2 -= dt; if (this.hbT2 <= 0) { this.hbT2 = 0.78 - (1 - this.breath) * 0.38; this.audio.heartbeat(0.5 + (1 - this.breath) * 0.7); }
        if (this.breath <= 0) { this.holding = false; this.gaspLock = true; this.audio.gasp(null); this.s.emit('g:gasp'); this.toast('You gasp for air.', 'bad'); this.shake = 0.5; }
      } else { this.holding = false; this.breath = Math.min(1, this.breath + dt / 5); if (this.gaspLock && this.breath > 0.4) this.gaspLock = false; }
    } else { this.holding = false; this.gaspLock = false; this.breath = Math.min(1, this.breath + dt / 3); }
    if (this.inspectMine > 0) this.inspectMine -= dt;
    if (this.sendT <= 0 && (controllable || inLocker)) {
      this.sendT = 1 / SEND_HZ;
      const lit = this.flashOn && this.battery > 0;
      const flags = (crouch ? 1 : 0) | (lit ? 2 : 0) | (this.sprinting ? 4 : 0) | (real > 0.5 ? 8 : 0) | (this.holding ? 16 : 0);
      this.s.volatile.emit('g:state', [+f.x.toFixed(3), +f.y.toFixed(3), +f.z.toFixed(3), +this.yaw.toFixed(3), +this.pitch.toFixed(3), flags, this.sel]);
    }
    // ---- your own body and hands ----
    const firstPerson = (me.state === 'alive' || me.state === 'downed') && me.hidden < 0 && !this.ended;
    const lit = this.flashOn && this.battery > 0;
    const body = this.body.group;
    body.visible = firstPerson && !downed;
    if (body.visible) {
      const back = 0.16 + this.body.crouchK * 0.2; // stand just behind the camera so you see chest, legs and feet when you look down
      body.position.set(f.x + sy * back, f.y, f.z + cy * back);
      body.rotation.y = this.yaw + Math.PI;
      this.body.setArmVisible(0, !lit); this.body.setArmVisible(1, !this.vm.held);
      this.body.update(dt, { speed: real, crouch, downed: false, pitch: 0, flash: false, hurt: me.hp < this.maxHp });
    }
    const held = this.inv[this.sel];
    this.vm.setHeld(firstPerson && !downed && held ? held.type : null);
    this.vmActive = firstPerson || this.vm.scaring;
    const dyaw = this.yaw - this.prevYaw, dpitch = this.pitch - this.prevPitch; this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.vm.update(dt, {
      active: firstPerson, flash: lit, speed: real, sprint: this.sprinting, crouch, bob: (this.bobT / (crouch ? 1.0 : sprint ? 2.1 : 1.5)) * Math.PI,
      dyaw: dyaw / Math.max(dt, 0.001) * 0.016, dpitch: dpitch / Math.max(dt, 0.001) * 0.016, time: this.time,
      light: 0.3 + (lit ? 0.75 : 0) + (this.world.power ? 0.45 : 0) + (this.lightningT > 0.3 ? 1 : 0),
    });

    if (downed) this.bleed = Math.max(0, (this.bleed || 0) - dt);
    if (this.revive) this.revive.t += dt;
  }

  updateRemotes(dt, now) {
    const rt = this.offset === null ? 0 : now + this.offset - INTERP_DELAY;
    const lit = [];
    for (const r of this.remotes.values()) {
      const p = this.roster.get(r.id);
      const buf = r.buf;
      while (buf.length > 2 && buf[1].t <= rt) buf.shift();
      if (buf.length) {
        const a = buf[0], b = buf[1] || a;
        const k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
        const c = r.cur, ox = c.x, oz = c.z;
        c.x = lerp(a.x, b.x, k); c.y = lerp(a.y, b.y, k); c.z = lerp(a.z, b.z, k);
        c.ry = lerpAngle(a.ry, b.ry, k); c.rx = lerp(a.rx, b.rx, k); c.f = b.f; c.h = b.h;
        const sp = Math.hypot(c.x - ox, c.z - oz) / dt;
        r.speed = lerp(r.speed, Math.min(sp, 8), Math.min(1, dt * 10));
      }
      r.visible = !!p && (p.state === 'alive' || p.state === 'downed') && p.hidden < 0 && this.lastSnapT - r.lastSnap < 600;
      const g = r.model.group;
      g.visible = r.visible && !(this.spec === r.id && (this.me.state === 'dead' || this.me.state === 'escaped'));
      if (!r.visible) continue;
      const c = r.cur;
      g.position.set(c.x, c.y, c.z); g.rotation.y = c.ry + Math.PI;
      const flash = !!(c.f & 2);
      r.model.setHeld(c.h);
      r.model.update(dt, { speed: r.speed, crouch: !!(c.f & 1), downed: p.state === 'downed', pitch: c.rx, flash, hurt: p.hp < this.maxHp && p.state === 'alive' });
      const d = Math.hypot(c.x - this.cam.position.x, c.z - this.cam.position.z);
      // the tag keeps a steady on-screen size up close (instead of filling the view) and fades when they are right next to you
      const ts = clamp(d / 4.5, 0.3, 1); r.model.tag.scale.set(1.3 * ts, 0.325 * ts, 1);
      r.model.tag.material.opacity = d < 1.4 ? 0.85 * clamp((d - 0.6) / 0.8, 0, 1) : d < 14 ? 0.85 : Math.max(0, 0.85 - (d - 14) * 0.2);
      r.model.tag.visible = this.role !== 'monster'; // no name tags floating over his prey
      if (flash) lit.push({ r, d });
      // their footsteps
      if (r.speed > 0.6 && d < 16 && !(c.f & 1)) { r.stepD += r.speed * dt; if (r.stepD > (c.f & 4 ? 2.1 : 1.5)) { r.stepD = 0; this.audio.footstep(c.f & 4 ? 1.6 : 0.9, [c.x, c.y, c.z]); } }
    }
    // a limited pool of real spotlights goes to the nearest teammates with torches on
    lit.sort((a, b) => a.d - b.d);
    this.spots.forEach((s, i) => {
      const o = lit[i];
      if (!o) { s.intensity = 0; return; }
      const c = o.r.cur, ey = c.y + (c.f & 1 ? 0.75 : 1.35);
      const fx = -Math.sin(c.ry) * Math.cos(c.rx), fy = Math.sin(c.rx), fz = -Math.cos(c.ry) * Math.cos(c.rx);
      s.position.set(c.x + fx * 0.35, ey, c.z + fz * 0.35);
      s.target.position.set(c.x + fx * 6, ey + fy * 6, c.z + fz * 6);
      s.intensity = 20;
    });
  }

  updateMonster(dt, now) {
    if (this.role === 'monster') return; // you ARE him: position comes from your own movement
    const rt = this.offset === null ? 0 : now + this.offset - INTERP_DELAY;
    const buf = this.mbuf, m = this.m;
    while (buf.length > 2 && buf[1].t <= rt) buf.shift();
    const a = buf[0], b = buf[1] || a;
    const k = b.t > a.t ? clamp((rt - a.t) / (b.t - a.t), 0, 1) : 1;
    const ox = m.x, oz = m.z;
    // a jump of many metres between snapshots is a relocation, not a sprint: don't slide it across the map
    const jump = Math.hypot(b.x - a.x, b.z - a.z) > 4;
    m.x = jump ? (k > 0.5 ? b.x : a.x) : lerp(a.x, b.x, k); m.z = jump ? (k > 0.5 ? b.z : a.z) : lerp(a.z, b.z, k);
    m.ry = lerpAngle(a.ry, b.ry, k); m.y = floorY(m.x, m.z);
    if (m.state !== b.st) m.state = b.st;
    m.crawl = b.crawl;
    const moved = Math.hypot(m.x - ox, m.z - oz);
    m.speed = lerp(m.speed, jump ? 0 : Math.min(moved / dt, 7), Math.min(1, dt * 8));
    const g = this.monster.group;
    g.position.set(m.x, m.y, m.z); g.rotation.y = m.ry;
    this.monster.update(dt, this.time, m.state, m.speed, !!m.crawl);
    if (!jump) m.stepD += moved;
    const stride = m.crawl ? 0.7 : m.state === 3 ? 1.5 : 1.15;
    if (m.stepD > stride) { m.stepD = 0; if (!this.ended) this.audio.footstep(m.crawl ? 0.35 : m.state === 3 ? 1.1 : 0.7, [m.x, m.y, m.z], true); }
  }

  updateEffects(dt) {
    if (this.role === 'monster') return this.updateHunterFx(dt);
    const m = this.m, c = this.cam.position, me = this.me;
    const d = Math.hypot(m.x - c.x, m.z - c.z);
    const sameFloor = Math.abs(m.y + 1.6 - c.y) < 2.4;
    const los = sameFloor && d < 30 && lineOfSight(c.x, c.z, m.x, m.z, (cell) => { const di = MAP.doorAt[cell]; return di >= 0 && !this.world.doors[di].open; });
    const base = clamp(1 - d / 16, 0, 1);
    m.d = d;
    if (los && d < 11 && !this.ended) this.world.flicker(0.25); // the lights fail around him
    let th = los ? base : base * 0.4;
    if ((m.state === 3 || m.state === 4) && d < 26) th = Math.max(th, 0.5 + 0.5 * base);
    if (me.state === 'dead' || me.state === 'escaped' || this.ended) th = 0;
    this.threat = lerp(this.threat, th, Math.min(1, dt * 3));

    // torch
    const canLight = (me.state === 'alive' || me.state === 'downed') && me.hidden < 0;
    if (this.flashOn && canLight && this.battery > 0) {
      const before = this.battery;
      this.battery = Math.max(0, this.battery - (100 / 360) * dt * (this.mods.has('blackout') ? 2 : 1));
      if (before >= 15 && this.battery < 15) { this.toast('Torch battery is low.', 'warn'); this.audio.beep(); }
      if (this.battery <= 0) { this.toast('Your torch is dead. Find a battery.', 'warn'); this.audio.click(); }
    }
    let fi = this.flashOn && canLight && this.battery > 0 ? 1 : 0;
    if (fi) {
      if (this.battery < 14 && Math.sin(this.time * 31) * Math.sin(this.time * 7.3) > 0.2) fi *= 0.35;
      if (this.threat > 0.45 && Math.random() < this.threat * 0.25) fi *= 0.25; // it gutters when he is close
      if (this.flickerOwn > 0) { this.flickerOwn -= dt; if (Math.sin(this.time * 45) > 0) fi *= 0.1; }
    }
    // blackout: the torch simply dies for a few seconds; sometimes he is there when it comes back
    if (this.blackout > 0) {
      this.blackout -= dt;
      fi = this.blackout < 0.35 && Math.sin(this.time * 70) > 0 ? fi : 0;
      if (this.blackout <= 0 && canLight && Math.random() < 0.45) {
        const f = this.lastFeet, gx = f.x - Math.sin(this.yaw) * 2.3, gz = f.z - Math.cos(this.yaw) * 2.3;
        if (MAP.grid[Math.floor(gz) * W + Math.floor(gx)] === 1 && lineOfSight(f.x, f.z, gx, gz, null)) this.spawnGhost(gx, floorY(gx, gz), gz, 'flash');
      }
    }
    if (this.vm.scaring) fi = 0; // during a jumpscare there is nothing in the world but the face
    this.flash.intensity = lerp(this.flash.intensity, fi * 30, Math.min(1, dt * 30));

    // lightning: windows flare, the whole building is lit for an instant
    let amb = this.ambBase + (this.world.power ? 0.06 : 0) + (me.hidden >= 0 ? 0.9 : 0); // eyes adjust inside a locker
    if (this.lightningT > 0) {
      this.lightningT -= dt;
      const t = this.lightningT, on = (t > 0.42 || (t > 0.2 && t < 0.3)) ? 1 : 0;
      this.world.windowMat.color.setScalar(0.5 + on * 7);
      amb += on * (this.lightningNear ? 1.6 : 0.5);
      $('fx-flash').style.opacity = on && this.lightningNear ? 0.07 : 0;
    } else this.world.windowMat.color.setScalar(0.5);
    if (this.blackout > 0) amb *= 0.08;
    if (this.vm.scaring) amb = 0;
    this.amb.intensity = amb;

    // screen distortion
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 0.8);
    const hurt = me.state === 'downed' ? 0.85 + Math.sin(this.time * 3) * 0.1 : me.state === 'alive' && me.hp < this.maxHp ? (me.hp === 1 ? 0.35 : 0.16) + Math.sin(this.time * 2.2) * 0.06 : 0;
    if (this.vm.scaring !== this._scaring) { this._scaring = this.vm.scaring; $('hud').classList.toggle('scare', this._scaring); } // nothing on screen but him
    if (this.scareStatic > 0) this.scareStatic -= dt;
    if (this.scareFlash > 0) { this.scareFlash -= dt; $('fx-flash').style.opacity = Math.max(0, this.scareFlash / 0.16) * 0.3; } // one brief flash, not a strobe
    if (this.snapYaw) { // a real hit wrenches your view round to face him
      const sn = this.snapYaw; sn.t -= dt;
      this.yaw = lerpAngle(this.yaw, sn.to, Math.min(1, dt * 22)); this.pitch = lerp(this.pitch, 0.12, Math.min(1, dt * 22));
      if (sn.t <= 0) this.snapYaw = null;
    }
    const st = clamp(this.threat * this.threat * 0.42 + this.hurtFlash * 0.6 + (this.scareStatic > 0 ? 0.5 : 0), 0, 0.7);
    const q = Math.round(st * 40) / 40, hq = Math.round(Math.max(hurt, this.hurtFlash) * 30) / 30;
    // PERFORMANCE: these overlays only ever change `opacity`, which the browser composites on the GPU
    // without repainting. (CSS filters / blend modes on top of a WebGL canvas cost a full-screen pass.)
    if (q !== this._st) { this._st = q; const el = $('fx-static'); el.style.display = q > 0.01 ? 'block' : 'none'; el.style.opacity = q; }
    if (hq !== this._hq) { this._hq = hq; const el = $('fx-hurt'); el.style.display = hq > 0.01 ? 'block' : 'none'; el.style.opacity = hq; }

    // security monitors
    this.camT -= dt;
    if (this.camT <= 0) {
      this.camT = 0.25;
      if (this.world.power && Math.hypot(c.x - 52, c.z - 8) < 10) {
        const dots = [{ x: this.lastFeet.x, z: this.lastFeet.z }];
        for (const r of this.remotes.values()) if (r.visible) dots.push(r.cur);
        this.world.drawCams(m, dots, this.time);
      }
    }
  }

  // ------------------------------------------------------------------ what am I looking at?
  updateTarget() {
    const me = this.me;
    let best = null;
    if (this.role === 'monster') { // he can only force doors and tear open lockers
      if (!this.ended) {
        const c = this.cam.position, cp = Math.cos(this.pitch), fx = -Math.sin(this.yaw) * cp, fy = Math.sin(this.pitch), fz = -Math.cos(this.yaw) * cp;
        let bs = -1e9;
        const consider = (k, id, x, y, z, maxD, label) => { const dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.hypot(dx, dy, dz); if (d > maxD) return; const dot = (dx * fx + dy * fy + dz * fz) / (d || 1); if (dot < 0.6 && d > 0.9) return; const s2 = dot * 2 - d * 0.25; if (s2 > bs) { bs = s2; best = { k, id, label }; } };
        for (const D of this.world.doors) { const d = D.def; if (d.kind === 'door' && !D.open && !D.locked) consider('door', d.id, d.x + 0.5, floorY(d.x + 0.5, d.z + 0.5) + 1.2, d.z + 0.5, 2.6, 'Force the door'); }
        for (const L of MAP.lockers) consider('locker', L.id, L.x + 0.5, L.y + 1.2, L.z + 0.5, 2.4, 'Rip the locker open');
      }
      this.target = best;
      const text = best ? `${glyph('force')} ${esc(best.label)}` : '';
      if (text !== this._prompt) { this._prompt = text; $('prompt').innerHTML = text; }
      return;
    }
    if (me.state === 'alive' && me.hidden < 0 && !this.ended) {
      const c = this.cam.position, cp = Math.cos(this.pitch);
      const fx = -Math.sin(this.yaw) * cp, fy = Math.sin(this.pitch), fz = -Math.cos(this.yaw) * cp;
      const closed = (cell) => { const di = MAP.doorAt[cell]; return di >= 0 && !this.world.doors[di].open; };
      let bs = -1e9;
      const consider = (k, id, x, y, z, maxD, label, throughDoors) => {
        const dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.hypot(dx, dy, dz);
        if (d > maxD) return;
        const dot = d > 0.01 ? (dx * fx + dy * fy + dz * fz) / d : 1;
        if (dot < 0.6 && d > 0.9) return;
        if (!lineOfSight(c.x, c.z, x, z, throughDoors ? null : closed)) return;
        const s = dot * 2 - d * 0.25;
        if (s > bs) { bs = s; best = { k, id, label }; }
      };
      for (const D of this.world.doors) {
        const d = D.def;
        if (d.kind === 'gate') { if (!D.open) consider('door', d.id, 4.5, 1.3, 22.5, 3.2, this.obj.security && this.inv.some((i) => i && i.type === 'key_gate') ? 'Unlock the main gate' : 'Main gate (locked)', true); continue; }
        const y = floorY(d.x + 0.5, d.z + 0.5) + 1.1;
        const label = d.kind === 'shelf' ? (D.open ? 'Slide the bookshelf back' : 'This bookshelf is loose… push it') : D.locked ? (this.inv.some((i) => i && (i.type === 'key_principal' || i.type === 'lockpick')) ? 'Unlock door' : 'Locked') : D.open ? 'Close door' : 'Open door';
        consider('door', d.id, d.x + 0.5, y, d.z + 0.5, 2.5, label, true);
      }
      for (const it of this.world.items.values()) consider('item', it.id, it.x, it.y, it.z, 2.4, `Pick up ${ITEM_INFO[it.type][0]}`);
      const holdsTeddy = !this.teddyDone && this.inv.some((it) => it && it.type === 'teddy');
      for (const L of MAP.lockers) {
        if (L.id === MAP.thomasLocker && holdsTeddy) { consider('teddy', L.id, L.x + 0.5, L.y + 1.2, L.z + 0.5, 2.3, "Put Thomas's teddy back in his locker"); continue; }
        consider('locker', L.id, L.x + 0.5, L.y + 1.2, L.z + 0.5, 2.1, L.id === MAP.thomasLocker && !this.teddyDone ? 'Hide in locker (T. PETERS)' : 'Hide in locker');
      }
      const fb = MAP.fuseBox; if (!this.obj.power) consider('fusebox', 0, fb.x, fb.y, fb.z - 0.1, 2.7, `Fuse box (${this.obj.fuses}/3)${this.inv.some((i) => i && i.type === 'fuse') ? ' — fit a fuse' : ''}`);
      const sc = MAP.securityConsole; if (!this.obj.security) consider('console', 0, sc.x, sc.y, sc.z, 2.7, this.obj.power ? 'Disarm the gate lock' : 'Security console (no power)');
      for (const r of this.remotes.values()) { const p = this.roster.get(r.id); if (p && p.state === 'downed' && r.visible) consider('revive', r.id, r.cur.x, r.cur.y + 0.3, r.cur.z, 2.5, `Revive ${p.name}`); }
      for (const L of MAP.lures) {
        const st = this.lureState[L.id] || { used: false, readyAt: 0 }, left = Math.max(0, st.readyAt - this.time);
        consider('lure', L.id, L.x, L.y, L.z, 2.6, st.used ? 'The great bell is cracked right through' : left > 0 ? `${LURE_LABEL[L.kind].split(' —')[0]} (ready in ${Math.ceil(left)} s)` : LURE_LABEL[L.kind]);
      }
    }
    this.target = best;
    const text = me.hidden >= 0 && me.state === 'alive' ? (this.inspectMine > 0 && !this.holding ? `<b class="urgent">He is checking this locker. HOLD ${glyph('breath')}</b>` : this.holding ? '<b class="urgent">Holding your breath…</b>' : `${glyph('interact')} Climb out · hold ${glyph('breath')} to hold your breath`) : best ? `${glyph('interact')} ${esc(best.label)}` : '';
    if (text !== this._prompt) { this._prompt = text; $('prompt').innerHTML = text; }
  }

  // ------------------------------------------------------------------ HUD
  toast(text, kind = 'info') {
    const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = text;
    const box = $('toasts'); box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 6100);
  }
  chatLine(c) {
    const p = this.roster.get(c.id);
    const el = document.createElement('div');
    el.innerHTML = `<b style="color:${PLAYER_COLORS[(p ? p.color : 7) % 8]}">${esc(c.name)}</b>: ${esc(c.text)}`;
    const box = $('chatlog'); box.appendChild(el);
    while (box.children.length > 7) box.firstChild.remove();
    setTimeout(() => el.remove(), 12100);
  }
  renderInv() {
    $('inv').innerHTML = this.inv.map((it, i) => `<div class="slot${i === this.sel ? ' sel' : ''}"><span class="num">${i + 1}</span>${it ? `<span class="ico">${ITEM_INFO[it.type][1]}</span>${ITEM_INFO[it.type][0]}${it.n !== undefined && it.n !== null ? ` <b class="charges">${it.n}</b>` : ''}` : ''}</div>`).join('');
    const cur = this.inv[this.sel];
    $('itemhint').textContent = cur ? fill((cur.type === 'chalk' && input.mode === 'pad' ? CHALK_PAD : ITEM_HINT[cur.type] || ITEM_INFO[cur.type][0]) + DROP_HINT) : '';
  }
  renderNotebook() {
    const o = this.obj;
    const list = [
      [`Find three electrical fuses (${Math.min(3, o.fusesFound)}/3)`, o.fusesFound >= 3],
      [`Fit them in the fuse box — Boiler Room, down the east stairs (${o.fuses}/3)`, o.power],
      ["Get into the Principal's Office: find its key, or pick the lock", o.officeOpen],
      ["Take the gate key from the Principal's desk", o.gateKey],
      ['Disarm the gate lock from the Security Office (needs power)', o.security],
      ['Unlock the main gate at the west end of the Main Hall — and run', o.gateOpen],
    ];
    const cur = list.findIndex((l) => !l[1]);
    const now = cur >= 0 ? `▸ ${list[cur][0]}` : '▸ The gate is open. Get out.';
    const on = $('objnow');
    if (on.textContent !== now) { on.textContent = now; on.classList.add('new'); setTimeout(() => on.classList.remove('new'), 3000); }
    $('objectives').innerHTML = list.map(([t, done], i) => `<li class="${done ? 'done' : i === cur ? 'cur' : ''}">${esc(t)}</li>`).join('')
      + `<li class="side${this.teddyDone ? ' done' : ''}">Optional: find Thomas's teddy bear and put it back in his locker (Locker Room)</li>`
      + (this.mods.size ? `<li class="side rules">Detention rules: ${[...this.mods].map((k) => MOD_LABEL[k]).join(', ')}</li>` : '');
    $('notes').innerHTML = this.notes.length ? this.notes.map((n) => `<p>${esc(n)}</p>`).join('') : '<p class="dim">Nothing yet. Notes are shared with everyone when picked up.</p>';
  }
  renderTeam() {
    $('teamlist').innerHTML = [...this.roster.values()].map((p) => `<div class="${p.state}">${this.voice && this.voice.enabled && this.voice.speakers(this.id).has(p.id) ? '🎙 ' : ''}<span title="${CLASSES[p.cls] ? CLASSES[p.cls].label : ''}">${CLASSES[p.cls] ? CLASSES[p.cls].icon : ''}</span> ${esc(p.name)}${p.id === this.id ? ' (you)' : ''}${p.away && (p.state === 'alive' || p.state === 'downed') ? ' — connection lost' : p.state === 'downed' ? ' — DOWN' : p.state === 'escaped' ? ' — OUT' : p.state === 'alive' && p.hp < this.maxHp ? ' — hurt' : ''}${(p.state === 'alive' || p.state === 'downed') && p.downs ? ` <i class="falls" title="Fallen ${p.downs} of ${this.maxDowns + 1}">${'●'.repeat(p.downs)}${'○'.repeat(Math.max(0, this.maxDowns - p.downs))}</i>` : ''}</div>`).join('');
  }
  updateHud() {
    // class perks the HUD has to show: a reminder at the start, and the Mechanic's feel for fuses through walls
    if (this.cls && !this.clsShown && this.time > 2.5) { this.clsShown = true; const c = CLASSES[this.cls]; this.toast(`${c.icon} You are the ${c.label}. ${c.blurb}`, 'info'); }
    if (this.cls === 'mechanic') for (const it of this.world.items.values()) {
      if (it.type !== 'fuse') continue;
      const near = this.cam.position.distanceTo(it.mesh.position) < 12;
      if (it.glow.material.depthTest === near) { it.glow.material.depthTest = !near; it.glow.renderOrder = near ? 15 : 0; it.glow.scale.setScalar(near ? 1.1 : 0.55); }
    }
    const me = this.me;
    // voice: microphone state, and who is talking
    if (this.voice) {
      const v = this.voice, mic = $('mic');
      mic.hidden = !v.enabled;
      if (v.enabled) { mic.textContent = v.muted ? '🎙 muted (M)' : v.ptt ? (v.pttDown ? '🎙 talking' : '🎙 hold V to talk') : v.speaking ? '🎙 talking' : '🎙 on (M mutes)'; mic.classList.toggle('hot', v.live && v.speaking); mic.classList.toggle('off', !v.live); }
      const sp = v.enabled ? [...v.speakers(this.id)].sort().join(',') : '';
      if (sp !== this._sp) { this._sp = sp; this.renderTeam(); }
    }
    while (this.tips.length && this.time >= this.tips[0][0]) this.toast(fill(this.tips.shift()[1]));
    if (this.role === 'monster') {
      const h = this.mh, cd = (v) => (v > 0 ? `${Math.ceil(v)}s` : 'READY');
      $('bar-stamina').querySelector('i').style.width = `${h.rage * 100}%`;
      $('mhud').innerHTML = `<div class="mstat">${h.grace > 0 ? `FROZEN ${Math.ceil(h.grace)}s` : h.stun > 0 ? 'BLINDED' : h.slow > 0 ? 'SLOWED' : 'HUNTING'}</div>`
        + `<div>${glyph('attack')} Attack <b>${cd(h.atk)}</b></div><div>${glyph('teleport')} Teleport <b>${cd(h.tp)}</b></div><div>${glyph('trap')} Trap ${h.traps}/${this.hunt.trapMax} <b>${cd(h.trap)}</b></div><div>${glyph('lights')} Kill lights <b>${cd(h.lights)}</b></div>`
        + (h.torch > 0.15 ? '<div class="mstat">A torch is on your face!</div>' : '');
      return;
    }
    const st = $('bar-stamina'), bt = $('bar-battery');
    const ts = $('torch-state'), lit = this.flashOn && this.battery > 0;
    ts.textContent = lit ? 'ON' : this.battery <= 0 ? 'DEAD' : 'OFF'; ts.classList.toggle('off', !lit);
    st.querySelector('i').style.width = `${this.stamina}%`; st.classList.toggle('low', this.exhausted);
    bt.querySelector('i').style.width = `${this.battery}%`; bt.classList.toggle('low', this.battery < 14);
    const h = $('health'), falls = me.downs || 0;
    h.textContent = me.state === 'alive' ? (me.hp >= this.maxHp ? (this.maxHp === 1 ? 'One hit and you fall' : 'Unhurt') : me.hp === 1 ? 'Wounded — one more and you fall' : 'Hurt')
      + (falls >= this.maxDowns ? ' · no more chances' : falls ? ` · ${falls === 1 ? 'fallen once' : `fallen ${falls}×`}` : '') : '';
    h.classList.toggle('hurt', me.hp < this.maxHp || falls >= this.maxDowns);
    let status = '';
    if (this.ended) status = '';
    else if (me.state === 'downed') status = `${(me.downs || 0) >= this.maxDowns ? 'Last chance' : 'You are down'}<small>Bleeding out: ${Math.ceil(this.bleed || 0)} s. A teammate can revive you with ${glyph('interact')}.<br>${(me.downs || 0) >= this.maxDowns ? 'Go down again after this and you will not get up.' : `${glyph('ping')} calls for help, but he hears it too.`}</small>`;
    else if (me.state === 'dead') { const p = this.roster.get(this.spec); status = `You did not make it<small>${p ? `watching ${esc(p.name)} — ${input.mode === 'pad' ? `${glyph('switch')} to switch` : 'click to switch'}` : 'nobody left to watch'}</small>`; }
    else if (me.state === 'escaped') { const p = this.roster.get(this.spec); status = `You are out<small>${p ? `watching ${esc(p.name)} — ${input.mode === 'pad' ? `${glyph('switch')} to switch` : 'click to switch'}` : ''}</small>`; }
    if (status !== this._status) { this._status = status; $('status').innerHTML = status; }
    if (me.state === 'downed' && (me.downs || 0) >= this.maxDowns) $('status').classList.add('last'); else $('status').classList.remove('last');
    const rc = $('rollcall');
    if (this.final && this.me.state !== 'escaped') {
      const left = Math.max(0, Math.ceil(this.final.until - this.time));
      rc.hidden = false; rc.classList.add('mine');
      rc.innerHTML = this.role === 'monster' ? `<b>The final bell</b><span>stop them reaching the gate · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>` : `<b>The final bell</b><span>get out before the gate shuts · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}</span>`;
    } else if (this.roll && this.role !== 'monster') {
      const left = Math.max(0, Math.ceil(this.roll.until - this.time)), mine = this.roll.id === this.id, who = this.roster.get(this.roll.id);
      rc.hidden = false; rc.classList.toggle('mine', mine);
      rc.innerHTML = mine ? `<b>Roll call: you</b><span>hide, or keep moving · ${left} s</span>` : `<b>Roll call: ${esc(who ? who.name : '?')}</b><span>${left} s</span>`;
    } else rc.hidden = true;
    $('toasts').classList.toggle('below-roll', !rc.hidden);
    const br = $('bar-breath'), inL = me.hidden >= 0 && me.state === 'alive';
    br.hidden = !inL; if (inL) { br.querySelector('i').style.width = `${this.breath * 100}%`; br.classList.toggle('low', this.breath < 0.3 || this.gaspLock); }
    const tb = $('tossbar'), th = this.gHeld !== null ? this.time - this.gHeld : 0;
    if (th > 0.25 && this.inv[this.sel]) { tb.style.opacity = 1; tb.firstElementChild.style.width = `${Math.min(1, (th - 0.25) / 0.8) * 100}%`; } else tb.style.opacity = 0;
    const rb = $('revivebar');
    if (this.revive) { rb.style.opacity = 1; rb.firstElementChild.style.width = `${clamp(this.revive.t / this.revive.dur, 0, 1) * 100}%`; } else rb.style.opacity = 0;
    const f = this.lastFeet, room = me.state === 'alive' || me.state === 'downed' ? roomNameAt(f.x, f.z) : '';
    if (room && room !== 'Doorway' && room !== this.roomShown) { this.roomShown = room; const el = $('roomname'); el.textContent = room; el.style.opacity = 1; this.roomT = 3.5; }
    if (this.roomT > 0) { this.roomT -= 0.1; if (this.roomT <= 0) $('roomname').style.opacity = 0; }
  }

  resize() {
    this.r.setSize(innerWidth, innerHeight, false);
    this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix();
    if (this.vm) this.vm.resize();
  }
  applySettings() {
    this.cam.fov = this.set.fov; this.cam.updateProjectionMatrix();
    this.r.toneMappingExposure = this.set.bright;
  }
  /** Match is over: keep rendering as a backdrop but stop playing. */
  end() {
    this.ended = true; this.keys = {};
    if (document.pointerLockElement) document.exitPointerLock();
    $('prompt').innerHTML = ''; this._prompt = '';
    this.audio.stopAmbience();
  }
  dispose() {
    cancelAnimationFrame(this.raf);
    if (this.unsubInput) this.unsubInput();
    for (const [el, ev, fn, opt] of this.listeners) el.removeEventListener(ev, fn, opt);
    for (const k in this.socketHandlers) this.s.off(k, this.socketHandlers[k]);
    if (document.pointerLockElement) document.exitPointerLock();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
      if (o.isLight && o.shadow && o.shadow.map) o.shadow.map.dispose();
    });
    for (const k in this.T) this.T[k].dispose();
    this.vm.dispose(); this.r.shadowMap.autoUpdate = true;
    this.r.renderLists.dispose();
    try { this.ph.world.free(); } catch { /* already freed */ }
    $('hud').hidden = true; $('netwarn').hidden = true; $('fx-locker').classList.remove('on'); $('fx-static').style.display = 'none'; $('fx-hurt').style.display = 'none'; $('fps').hidden = true; $('toasts').innerHTML = ''; $('chatlog').innerHTML = ''; $('status').innerHTML = ''; $('notebook').hidden = true; $('hud').classList.remove('monster'); $('mhud').hidden = true; $('mic').hidden = true; this.amb.color.setHex(0x7486a8); $('hud').classList.remove('scare'); $('fx-flash').style.opacity = 0; $('objnow').textContent = ''; $('itemhint').textContent = '';
    if (window.__lb === this) window.__lb = null;
  }
}
