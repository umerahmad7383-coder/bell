// One match on the client: rendering, local first-person controller, interpolation of
// everyone else, interaction, effects and HUD. All game rules live on the server.
import * as THREE from 'three';
import { MAP, floorY, lineOfSight, roomNameAt } from '../shared/map.js';
import { buildTextures } from './textures.js';
import { buildWorld } from './world.js';
import { buildPhysics, EYE_STAND, EYE_CROUCH, EYE_DOWNED } from './physics.js';
import { MonsterModel, PlayerModel, PLAYER_COLORS } from './entities.js';
import { ViewModel } from './viewmodel.js';
import { ITEM_TYPES, DIFFICULTY } from '../shared/defs.js';

export const QUALITY = {
  // lights = ceiling lights that are real light sources once the power is on; darkLights = while it is off
  low: { maxDpr: 1, scale: 0.75, shadows: false, shadowSize: 0, lights: 2, darkLights: 1, spots: 1, gloss: false },
  medium: { maxDpr: 1, scale: 1, shadows: true, shadowSize: 1024, lights: 4, darkLights: 2, spots: 2, gloss: false },
  high: { maxDpr: 1.5, scale: 1, shadows: true, shadowSize: 2048, lights: 6, darkLights: 2, spots: 3, gloss: true },
};
export const ITEM_INFO = {
  fuse: ['Fuse', '⚡'], key_principal: ['Office Key', '🗝️'], key_gate: ['Gate Key', '🔑'], battery: ['Battery', '🔋'],
  medkit: ['Med Kit', '⛑️'], lockpick: ['Lockpick', '📎'], bottle: ['Bottle', '🍾'], bell: ['Hand Bell', '🔔'], note: ['Note', '📄'],
};
const SEND_HZ = 15;
const INTERP_DELAY = 120; // ms behind the server; hides network jitter
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * t; };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Game {
  constructor({ renderer, socket, init, settings, audio, RAPIER, ui }) {
    this.r = renderer; this.s = socket; this.set = settings; this.audio = audio; this.ui = ui;
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
    scene.fog = new THREE.FogExp2(0x020305, 0.052);
    this.cam = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.06, 90);
    this.cam.rotation.order = 'YXZ';
    scene.add(this.cam);
    this.amb = new THREE.AmbientLight(0x7486a8, 0.5); scene.add(this.amb); this.ambBase = 0.5;

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
    for (let i = 0; i < Math.min(Q.spots, init.players.length - 1); i++) { const s = new THREE.SpotLight(0xfff1d6, 0, 26, 0.5, 0.6, 1.05); scene.add(s, s.target); this.spots.push(s); }

    this.monster = new MonsterModel(this.T); scene.add(this.monster.group);
    this.mbuf = [{ t: 0, x: init.monster[0], z: init.monster[1], ry: init.monster[2], st: init.monster[3], crawl: init.monster[4] }];
    this.m = { x: init.monster[0], y: 0, z: init.monster[1], ry: 0, state: 0, speed: 0, crawl: 0, stepD: 0 };

    // players
    this.id = init.you;
    this.roster = new Map(); this.remotes = new Map();
    init.players.forEach((p, i) => {
      this.roster.set(p.id, { id: p.id, name: p.name, state: p.state, hp: p.hp, hidden: -1, color: i });
      if (p.id !== this.id) {
        const model = new PlayerModel(p.name, i, p.look); model.group.position.set(p.x, p.y, p.z); scene.add(model.group);
        this.remotes.set(p.id, { id: p.id, model, buf: [], cur: { x: p.x, y: p.y, z: p.z, ry: 0, rx: 0, f: 0, h: 0 }, speed: 0, stepD: 0, lastSnap: 0 });
      } else {
        this.ph.teleport(p.x, p.y, p.z);
        // your own body (headless, so the camera is not inside a skull) and first-person hands
        this.body = new PlayerModel(p.name, i, p.look, { firstPerson: true }); scene.add(this.body.group);
        this.vm = new ViewModel(p.look);
      }
    });
    this.me = this.roster.get(this.id);
    this.maxHp = init.maxHp || 2; this.difficulty = init.difficulty || 'intermediate';
    this.frame = 0; this.prevYaw = -Math.PI / 2; this.prevPitch = 0;
    if (Q.shadows) renderer.shadowMap.autoUpdate = false; // refreshed every second frame in the loop: halves the shadow cost

    // world state
    init.doors.forEach(([open, locked], i) => { this.world.setDoor(i, open, locked, true); this.ph.setDoor(i, !!open); });
    init.items.forEach((it) => this.world.addItem(it));
    this.obj = init.obj; this.notes = [...init.notes];
    this.world.setFuses(this.obj.fuses); this.world.setPower(this.obj.power);
    this.inv = [null, null, null, null]; this.sel = 0;

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
    $('hud').hidden = false;
    this.resize();
    this.clock = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    window.__lb = this; // handy for debugging / automated tests
  }

  // ------------------------------------------------------------------ input & network wiring
  bind() {
    const L = (this.listeners = []);
    const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); L.push([el, ev, fn, opt]); };
    const canvas = this.r.domElement;
    on(window, 'resize', () => this.resize());
    on(document, 'keydown', (e) => this.onKey(e, true));
    on(document, 'keyup', (e) => this.onKey(e, false));
    on(window, 'blur', () => { this.keys = {}; $('notebook').hidden = true; });
    on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      const k = 0.0022 * this.set.sens;
      this.yaw -= e.movementX * k; this.pitch = clamp(this.pitch - e.movementY * k, -1.45, 1.45);
    });
    on(canvas, 'mousedown', (e) => {
      this.audio.init();
      if (!this.locked) { this.lock(); return; }
      if (e.button === 0) this.primary();
    });
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

    const S = (this.socketHandlers = { 'g:snap': (sn) => this.onSnap(sn), 'g:ev': (e) => this.onEvent(e), 'g:correct': (p) => this.ph.teleport(p[0], p[1], p[2]), chat: (c) => this.chatLine(c) });
    for (const k in S) this.s.on(k, S[k]);
  }
  lock() { if (this.ended) return; try { const p = this.r.domElement.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
  openChat() { this.chatOpen = true; this.keys = {}; const i = $('chatinput'); i.hidden = false; i.value = ''; i.focus(); }
  closeChat() { this.chatOpen = false; const i = $('chatinput'); i.hidden = true; i.blur(); }

  onKey(e, down) {
    if (this.chatOpen || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (this.ui.blocked()) return;
    const c = e.code;
    if (c === 'Tab') { e.preventDefault(); $('notebook').hidden = !down; return; }
    if (e.ctrlKey && ['KeyS', 'KeyD', 'KeyA', 'KeyE', 'KeyF', 'KeyG'].includes(c)) e.preventDefault(); // keep browser shortcuts out of the way while crouching
    this.keys[c] = down;
    if (!down || e.repeat) return;
    if (c === 'Enter') { e.preventDefault(); this.openChat(); }
    else if (c === 'KeyE') this.interact();
    else if (c === 'KeyF') this.toggleFlash();
    else if (c === 'KeyG') { if (this.inv[this.sel]) this.s.emit('g:drop', this.sel); }
    else if (/^Digit[1-4]$/.test(c)) this.select(Number(c[5]) - 1);
  }
  select(i) { this.sel = i; this.renderInv(); this.audio.ui(); }
  toggleFlash() {
    if (this.me.state !== 'alive' && this.me.state !== 'downed') return;
    if (this.battery <= 0) { this.toast('Your torch is dead. Find a battery.', 'warn'); this.audio.deny(); return; }
    this.flashOn = !this.flashOn; this.audio.click();
  }
  primary() {
    if (this.me.state === 'dead' || this.me.state === 'escaped') return this.cycleSpectate();
    if (this.me.state !== 'alive' || this.me.hidden >= 0) return;
    const it = this.inv[this.sel];
    if (!it) return;
    if (it.type === 'bottle') this.audio.throwWhoosh();
    if (['bottle', 'bell', 'battery', 'medkit'].includes(it.type)) this.vm.useItem(it.type);
    this.s.emit('g:use', { slot: this.sel, ry: this.yaw, rx: this.pitch });
  }
  interact() {
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
      case 'item+': W.addItem(e.item); break;
      case 'item-': W.removeItem(e.id); if (e.by === this.id) A.pickup(); break;
      case 'inv': this.inv = e.inv; this.renderInv(); break;
      case 'obj': this.obj = e.obj; W.setFuses(e.obj.fuses); this.renderNotebook(); break;
      case 'msg': this.toast(e.text, e.kind); if (e.kind === 'warn') A.deny(); break;
      case 'note': this.notes.push(e.text); this.renderNotebook(); break;
      case 'pstate': this.onPlayerState(e); break;
      case 'pleave': {
        const r = this.remotes.get(e.id);
        if (r) { this.scene.remove(r.model.group); r.model.dispose(); this.remotes.delete(e.id); }
        this.roster.delete(e.id); if (this.spec === e.id) this.spec = null; this.renderTeam(); break;
      }
      case 'hit':
        if (e.id === this.id) { A.hit(); this.shake = 1; this.hurtFlash = 1; }
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
      case 'lockerinspect': { const L = MAP.lockers[e.id]; A.rattle([L.x + 0.5, L.y + 1, L.z + 0.5]); if (this.me.hidden === e.id) this.shake = 0.6; break; }
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
    }
  }

  onPlayerState(e) {
    const p = this.roster.get(e.id); if (!p) return;
    const prev = p.state;
    p.state = e.state; p.hp = e.hp; if (e.state !== 'alive') p.hidden = -1;
    if (e.id === this.id) {
      if (e.state === 'downed') { this.bleed = e.bleed || 80; }
      if (e.state === 'alive' && prev === 'downed') { this.audio.heal(); }
      if (e.state === 'alive' && e.hp === this.maxHp && prev === 'alive') this.audio.heal();
      if (e.state === 'dead' || e.state === 'escaped') { $('fx-locker').classList.remove('on'); this.cycleSpectate(); }
    } else if (this.spec === e.id && e.state !== 'alive' && e.state !== 'downed') this.cycleSpectate();
    this.renderTeam();
  }

  onMonsterState(s) {
    const d = Math.hypot(this.m.x - this.cam.position.x, this.m.z - this.cam.position.z);
    if (s === 3 && d < 24 && this.time - this.stingT > 9) { this.audio.stinger('chase'); this.stingT = this.time; }
    if (s === 6 && d < 30) this.audio.stinger('stalk');
    if (s === 2 && this.m.state === 3 && d < 24) this.audio.stinger('lost');
  }

  paranormal(e) {
    const A = this.audio, p = e.p;
    switch (e.type) {
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
    this.updateLocal(dt);
    this.updateRemotes(dt, now);
    this.updateMonster(dt, now);
    this.updateEffects(dt);
    this.targetT -= dt; if (this.targetT <= 0) { this.targetT = 0.07; this.updateTarget(); }
    for (let i = this.fx.length - 1; i >= 0; i--) if (this.fx[i](dt)) this.fx.splice(i, 1);
    this.world.update(dt, this.time, this.cam.position);
    this.audio.setListener(this.cam.position, this.cam.rotation.y);
    this.audio.update(dt, this.ended ? 0 : this.threat, this.ended ? null : this.m, this.world.power);
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
    const wantCrouch = downed || K.ControlLeft || K.ControlRight || K.KeyC;
    const crouch = controllable && (wantCrouch || (ph.isCrouched() && ph.lowCeiling()));
    if (controllable) ph.setCrouch(!!crouch);
    const moving = fwd !== 0 || strafe !== 0;
    const sprint = !crouch && !downed && (K.ShiftLeft || K.ShiftRight) && fwd > 0 && !this.exhausted && this.stamina > 0;
    if (sprint && moving) { this.stamina = Math.max(0, this.stamina - 19 * dt); this.regenDelay = 0.9; if (this.stamina <= 0) this.exhausted = true; }
    else { this.regenDelay -= dt; if (this.regenDelay <= 0) this.stamina = Math.min(100, this.stamina + 13 * dt); if (this.exhausted && this.stamina > 30) this.exhausted = false; }
    let speed = downed ? 0.75 : crouch ? 1.45 : sprint ? 5.3 : 2.75;
    if (me.hp === 1 && !downed) speed *= 0.9;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * strafe, wz = -cy * fwd - sy * strafe;
    const wl = Math.hypot(wx, wz); if (wl > 0) { wx = (wx / wl) * speed; wz = (wz / wl) * speed; }
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
    if (this.sendT <= 0 && controllable) {
      this.sendT = 1 / SEND_HZ;
      const lit = this.flashOn && this.battery > 0;
      const flags = (crouch ? 1 : 0) | (lit ? 2 : 0) | (this.sprinting ? 4 : 0) | (real > 0.5 ? 8 : 0);
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
    this.vmActive = firstPerson;
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
      r.model.tag.material.opacity = d < 14 ? 0.85 : Math.max(0, 0.85 - (d - 14) * 0.2);
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
    const m = this.m, c = this.cam.position, me = this.me;
    const d = Math.hypot(m.x - c.x, m.z - c.z);
    const sameFloor = Math.abs(m.y + 1.6 - c.y) < 2.4;
    const los = sameFloor && d < 30 && lineOfSight(c.x, c.z, m.x, m.z, (cell) => { const di = MAP.doorAt[cell]; return di >= 0 && !this.world.doors[di].open; });
    const base = clamp(1 - d / 16, 0, 1);
    let th = los ? base : base * 0.4;
    if ((m.state === 3 || m.state === 4) && d < 26) th = Math.max(th, 0.5 + 0.5 * base);
    if (me.state === 'dead' || me.state === 'escaped' || this.ended) th = 0;
    this.threat = lerp(this.threat, th, Math.min(1, dt * 3));

    // torch
    const canLight = (me.state === 'alive' || me.state === 'downed') && me.hidden < 0;
    if (this.flashOn && canLight && this.battery > 0) {
      this.battery = Math.max(0, this.battery - (100 / 360) * dt);
      if (this.battery <= 0) { this.toast('Your torch is dead. Find a battery.', 'warn'); this.audio.click(); }
    }
    let fi = this.flashOn && canLight && this.battery > 0 ? 1 : 0;
    if (fi) {
      if (this.battery < 14 && Math.sin(this.time * 31) * Math.sin(this.time * 7.3) > 0.2) fi *= 0.35;
      if (this.threat > 0.45 && Math.random() < this.threat * 0.25) fi *= 0.25; // it gutters when he is close
      if (this.flickerOwn > 0) { this.flickerOwn -= dt; if (Math.sin(this.time * 45) > 0) fi *= 0.1; }
    }
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
    this.amb.intensity = amb;

    // screen distortion
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 0.8);
    const hurt = me.state === 'downed' ? 0.85 + Math.sin(this.time * 3) * 0.1 : me.state === 'alive' && me.hp < this.maxHp ? (me.hp === 1 ? 0.35 : 0.16) + Math.sin(this.time * 2.2) * 0.06 : 0;
    const st = clamp(this.threat * this.threat * 0.42 + this.hurtFlash * 0.6, 0, 0.7);
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
      for (const L of MAP.lockers) consider('locker', L.id, L.x + 0.5, L.y + 1.2, L.z + 0.5, 2.1, 'Hide in locker');
      const fb = MAP.fuseBox; if (!this.obj.power) consider('fusebox', 0, fb.x, fb.y, fb.z - 0.1, 2.7, `Fuse box (${this.obj.fuses}/3)${this.inv.some((i) => i && i.type === 'fuse') ? ' — fit a fuse' : ''}`);
      const sc = MAP.securityConsole; if (!this.obj.security) consider('console', 0, sc.x, sc.y, sc.z, 2.7, this.obj.power ? 'Disarm the gate lock' : 'Security console (no power)');
      for (const r of this.remotes.values()) { const p = this.roster.get(r.id); if (p && p.state === 'downed' && r.visible) consider('revive', r.id, r.cur.x, r.cur.y + 0.3, r.cur.z, 2.5, `Revive ${p.name}`); }
    }
    this.target = best;
    const text = me.hidden >= 0 && me.state === 'alive' ? '<kbd>E</kbd> Climb out' : best ? `<kbd>E</kbd> ${esc(best.label)}` : '';
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
    $('inv').innerHTML = this.inv.map((it, i) => `<div class="slot${i === this.sel ? ' sel' : ''}"><span class="num">${i + 1}</span>${it ? `<span class="ico">${ITEM_INFO[it.type][1]}</span>${ITEM_INFO[it.type][0]}` : ''}</div>`).join('');
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
    $('objectives').innerHTML = list.map(([t, done], i) => `<li class="${done ? 'done' : i === cur ? 'cur' : ''}">${esc(t)}</li>`).join('');
    $('notes').innerHTML = this.notes.length ? this.notes.map((n) => `<p>${esc(n)}</p>`).join('') : '<p class="dim">Nothing yet. Notes are shared with everyone when picked up.</p>';
  }
  renderTeam() {
    $('teamlist').innerHTML = [...this.roster.values()].map((p) => `<div class="${p.state}">${esc(p.name)}${p.id === this.id ? ' (you)' : ''}${p.state === 'downed' ? ' — DOWN' : p.state === 'escaped' ? ' — OUT' : p.state === 'alive' && p.hp < this.maxHp ? ' — hurt' : ''}</div>`).join('');
  }
  updateHud() {
    const me = this.me;
    const st = $('bar-stamina'), bt = $('bar-battery');
    st.querySelector('i').style.width = `${this.stamina}%`; st.classList.toggle('low', this.exhausted);
    bt.querySelector('i').style.width = `${this.battery}%`; bt.classList.toggle('low', this.battery < 14);
    const h = $('health'); h.textContent = me.state === 'alive' ? (me.hp >= this.maxHp ? (this.maxHp === 1 ? 'One hit and you fall' : 'Unhurt') : me.hp === 1 ? 'Wounded — one more and you fall' : 'Hurt') : ''; h.classList.toggle('hurt', me.hp < this.maxHp);
    let status = '';
    if (this.ended) status = '';
    else if (me.state === 'downed') status = `You are down<small>bleeding out in ${Math.ceil(this.bleed || 0)}s — a teammate can revive you with E</small>`;
    else if (me.state === 'dead') { const p = this.roster.get(this.spec); status = `You did not make it<small>${p ? `watching ${esc(p.name)} — click to switch` : 'nobody left to watch'}</small>`; }
    else if (me.state === 'escaped') { const p = this.roster.get(this.spec); status = `You are out<small>${p ? `watching ${esc(p.name)} — click to switch` : ''}</small>`; }
    if (status !== this._status) { this._status = status; $('status').innerHTML = status; }
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
    $('hud').hidden = true; $('fx-locker').classList.remove('on'); $('fx-static').style.display = 'none'; $('fx-hurt').style.display = 'none'; $('fps').hidden = true; $('toasts').innerHTML = ''; $('chatlog').innerHTML = ''; $('status').innerHTML = ''; $('notebook').hidden = true;
    if (window.__lb === this) window.__lb = null;
  }
}
