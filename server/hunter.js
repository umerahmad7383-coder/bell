// HUNT MODE — the Headmaster controlled by a player.
// Drop-in replacement for the AI Monster (same fields and methods the Game uses), but every
// decision comes from the hunter's client. The server still decides what is allowed:
// speed, cooldowns, hits, teleports, traps. Numbers live in HUNT so balance is one edit away.
import { MAP, W, FLOOR, idx, inBounds, lineOfSight, floorY } from '../client/shared/map.js';
import { MSTATE } from './monster.js';

// v0.9 rebalance: the player Headmaster was far too strong (he out-walked survivors, out-raged
// sprinters, teleported every 25 s and saw 12 m in the dark). He now has to out-think them.
export const HUNT = {
  grace: 20,        // seconds he is frozen at the start while survivors scatter
  walk: 3.05,       // m/s. Survivors walk 2.75 (1.9 backwards) and sprint 5.3
  rage: 5.4,        // m/s while raging (Shift): barely faster than a sprinting survivor...
  rageMax: 3,       // ...and only for this many seconds
  rageRegen: 0.3,   // rage seconds regained per second (10 s for a full bar)
  windup: 0.6,      // attack wind-up: he growls and slows a little, survivors get a moment to break away
  reach: 1.95,
  missCd: 2.0,      // can't swing again for this long after a miss
  hitLock: 8,       // ...or this long after a hit
  hitSlow: 4.5,     // and he is slowed for this long after a hit, so the wounded can run
  downLock: 3,      // ...but a hit that puts someone DOWN only locks him out this long, unslowed, so he can go for the rescuer
  adrenaline: 2.5,  // a survivor who takes a hit (and stays up) runs 25 % faster for this long
  tpRange: 6, tpCd: 40, tpLock: 2,
  trapCd: 30, trapMax: 2, trapArm: 2, trapRoot: 1.8,
  lightsCd: 70, lightsDur: 6, blackout: 1.6, // survivors' torches near him die for `blackout` s
  bellStun: 7,      // hand bell
  torchStun: 3, torchTime: 0.8, torchRange: 9, torchImmune: 10, // hold a torch beam on his face
  lockerTime: 1.8,  // ripping a locker open leaves him standing still
  breath: 0.5,      // chance that a survivor holding their breath in it is not noticed
  doorTime: 0.75,
  hearing: 0.75,    // sounds reach him over 75 % of the distance they would reach the AI...
  fuzz: 1.5,        // ...and the pulse he sees is up to this many metres off where the sound was
  nightFog: 0.165,  // his night vision fades out after roughly 6 m
  cameraStun: 2, cameraImmune: 8, // a survivor's Polaroid flash in his face
};

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const r2 = (v) => Math.round(v * 100) / 100;

/** HUNT with the host's lobby tuning applied (see TUNE in client/shared/defs.js). */
export function tunedHunt(tune) {
  const H = { ...HUNT };
  if (!tune) return H;
  const sp = tune.speed / 100, cd = tune.cooldowns / 100;
  H.walk *= sp; H.rage *= sp;
  H.nightFog = 1 / tune.vision; // fog this dense leaves about `vision` metres readable
  H.hearing = tune.hearing / 100;
  H.tpCd *= cd; H.trapCd *= cd; H.lightsCd *= cd;
  return H;
}

export class HumanMonster {
  constructor(game, pid, name) {
    this.g = game; this.pid = pid; this.name = name; this.human = true;
    this.H = tunedHunt(game.tune); // the host can rebalance him from the lobby
    const start = MAP.waypoints.find((w) => w.room === 'Gymnasium') || MAP.waypoints[0];
    this.x = start.x + 0.5; this.z = start.z + 0.5; this.ry = 0;
    this.state = 'patrol'; this.crawl = false;
    this.grace = this.H.grace;
    this.rage = this.H.rageMax; this.sprinting = false; this.rageRest = 0;
    this.windup = 0; this.attackCd = 0; this.slowT = 0; this.stunT = 0;
    this.busy = 0; this.busyFn = null;
    this.cd = { tp: 10, trap: 6, lights: 20 };
    this.traps = []; this.nextTrap = 1;
    this.torchT = 0; this.torchImmune = 0;
    this.lastT = 0; this.hudT = 0; this.heardAt = new Map();
    this.stats = { hits: 0, traps: 0 };
  }
  get y() { return floorY(this.x, this.z); }
  get aggr() { return 0; }
  opaque = (c) => { const di = MAP.doorAt[c]; return di >= 0 && !this.g.doors[di].open; };
  send(ev, data) { this.g.sendTo(this.pid, ev, data); }
  setState(s) { if (this.state !== s) { this.state = s; this.g.emit({ e: 'mstate', s: MSTATE[s] }); } }
  /** forward vector for the model's rotation (same convention as the AI: 0 = +Z) */
  fwd() { return [Math.sin(this.ry), Math.cos(this.ry)]; }
  locked() { return this.grace > 0 || this.stunT > 0 || this.busy > 0; }

  speedCap() { return this.baseCap() * (this.g.speedMul || 1) * (this.enraged ? 1.1 : 1); }
  /** the final bell: 10% faster, a full rage bar, and it refills twice as fast */
  enrage() { this.enraged = true; this.rage = this.H.rageMax; this.g.sendTo(this.pid, 'g:ev', { e: 'msg', text: 'The final bell. They are running for the gate. Do not let them leave.', kind: 'bad' }); }
  baseCap() {
    if (this.grace > 0 || this.busy > 0) return 0;
    if (this.stunT > 0) return this.H.walk * 0.3;
    if (this.windup > 0) return (this.sprinting ? this.H.rage : this.H.walk) * 0.8; // he lunges, a little slower than he runs
    if (this.slowT > 0) return this.H.walk * 0.5;
    return this.sprinting ? this.H.rage : this.H.walk;
  }

  /** movement from the hunter's client: [x, z, ry, wantsRage] */
  onMove(s) {
    if (!Array.isArray(s) || s.length < 3) return;
    const [x, z, ry] = s.map(Number);
    if (![x, z, ry].every(Number.isFinite)) return;
    this.ry = ry;
    this.sprinting = !!s[3] && this.rage > 0.05 && this.slowT <= 0 && this.stunT <= 0;
    const now = this.g.time, dt = Math.max(0.02, now - this.lastT);
    this.lastT = now;
    const d = dist(x, z, this.x, this.z);
    const cx = Math.floor(x), cz = Math.floor(z);
    // movement budget: he earns distance at his current speed limit and spends it by moving, so the
    // limit holds on average and a little network jitter is forgiven without letting him exceed it
    const cap = this.speedCap();
    this.allow = Math.min((this.allow || 0) + cap * dt * 1.15, cap * 0.6 + 0.1);
    let ok = inBounds(cx, cz) && MAP.grid[idx(cx, cz)] !== 0 && d <= this.allow + 0.03;
    if (ok) { const di = MAP.doorAt[idx(cx, cz)]; if (di >= 0 && !this.g.doors[di].open) ok = false; } // no walking through closed doors
    if (!ok) { this.send('g:mcorrect', [r2(this.x), r2(this.z)]); return; }
    this.allow -= d;
    this.moved = d > 0.02;
    this.x = x; this.z = z;
  }

  /** abilities from the hunter's client */
  act(m) {
    if (!m || this.g.over) return;
    const g = this.g;
    switch (m.k) {
      case 'attack':
        if (this.locked() || this.windup > 0 || this.attackCd > 0) return;
        this.windup = this.H.windup;
        g.emit({ e: 'mwind' }); // everyone nearby hears it coming
        return;
      case 'tp': {
        if (this.locked() || this.cd.tp > 0 || this.windup > 0) return;
        const [fx, fz] = this.fwd();
        let bx = this.x, bz = this.z;
        for (let t = 0.5; t <= this.H.tpRange; t += 0.25) {
          const nx = this.x + fx * t, nz = this.z + fz * t, c = idx(Math.floor(nx), Math.floor(nz));
          if (!inBounds(Math.floor(nx), Math.floor(nz)) || MAP.grid[c] === 0 || this.opaque(c)) break;
          if (MAP.grid[c] === FLOOR && !MAP.blocked[c]) { bx = nx; bz = nz; }
        }
        if (dist(bx, bz, this.x, this.z) < 2) return; // nowhere to go
        const from = [r2(this.x), r2(this.y), r2(this.z)];
        this.x = bx; this.z = bz;
        this.cd.tp = this.H.tpCd; this.attackCd = Math.max(this.attackCd, this.H.tpLock); // no teleport-and-strike
        g.emit({ e: 'mtp', from, to: [r2(bx), r2(this.y), r2(bz)] });
        this.send('g:mcorrect', [r2(bx), r2(bz)]);
        return;
      }
      case 'trap': {
        if (this.locked() || this.cd.trap > 0) return;
        const cx = Math.floor(this.x), cz = Math.floor(this.z), c = idx(cx, cz);
        // not in doorways, not on the stairs, and never across the way out
        if (MAP.grid[c] !== FLOOR || MAP.level[c] === 1 || this.x < 10 || this.traps.some((t) => dist(t.x, t.z, this.x, this.z) < 2.5)) { this.send('g:ev', { e: 'msg', text: 'A trap cannot go here.', kind: 'warn' }); return; }
        if (this.traps.length >= this.H.trapMax) { const old = this.traps.shift(); g.emit({ e: 'trap-', id: old.id }); }
        const t = { id: this.nextTrap++, x: r2(this.x), z: r2(this.z), y: r2(this.y), arm: g.time + this.H.trapArm };
        this.traps.push(t); this.cd.trap = this.H.trapCd; this.stats.traps++;
        g.emit({ e: 'trap+', id: t.id, p: [t.x, t.y, t.z] });
        return;
      }
      case 'lights':
        if (this.locked() || this.cd.lights > 0) return;
        this.cd.lights = this.H.lightsCd;
        g.emit({ e: 'sabotage', p: [r2(this.x), r2(this.z)], t: this.H.lightsDur });
        return;
      case 'door': {
        const d = g.doors[m.id | 0];
        if (!d || this.locked() || d.open || d.locked || d.kind !== 'door' || dist(d.x + 0.5, d.z + 0.5, this.x, this.z) > 2.8) return;
        this.busy = this.H.doorTime; this.busyFn = () => { if (!d.open && !d.locked) g.setDoor(d, true, 'monster'); };
        return;
      }
      case 'locker': {
        const L = MAP.lockers[m.id | 0];
        if (!L || this.locked() || this.attackCd > 0 || dist(L.x + 0.5, L.z + 0.5, this.x, this.z) > 2.6) return;
        this.busy = this.H.lockerTime;
        g.emit({ e: 'lockerinspect', id: L.id });
        this.busyFn = () => {
          const occ = [...g.players.values()].find((p) => p.hidden === L.id && p.state === 'alive');
          if (occ && (occ.flags & 16) && Math.random() < this.H.breath) { // pressed into the dark corner, not breathing
            occ.stats.breath++; g.emit({ e: 'lockerpass', id: L.id }); this.attackCd = Math.max(this.attackCd, 1);
            this.send('g:ev', { e: 'msg', text: 'Empty. ...Is it?', kind: 'info' });
          } else if (occ) { g.pullFromLocker(occ); this.landHit(occ); } else this.attackCd = Math.max(this.attackCd, 1);
        };
        return;
      }
    }
  }

  landHit(p) {
    this.g.hitPlayer(p);
    this.stats.hits++;
    if (p.state === 'alive') { this.attackCd = this.H.hitLock; this.slowT = this.H.hitSlow; this.sprinting = false; } // they are wounded: let them run
    else this.attackCd = this.H.downLock; // they are down: their friend is next
  }
  stun(t, kind) {
    this.stunT = Math.max(this.stunT, t); this.windup = 0; this.busy = 0; this.busyFn = null; this.sprinting = false;
    this.g.emit({ e: 'mstun', t, kind });
  }
  /** hand bell */
  repel() { this.stun(this.H.bellStun, 'bell'); }
  /** camera flash; returns false while he is still dazzled from the last one */
  flashed() {
    if (this.flashImmune > 0) return false;
    this.flashImmune = this.H.cameraImmune; this.stun(this.H.cameraStun, 'camera');
    return true;
  }
  onPlayerHid() { /* a human sees it for himself */ }

  /** Sounds within earshot show up on the hunter's screen as a pulse he can walk toward. */
  onNoise(n) {
    if (this.grace > 0) return;
    const d = dist(this.x, this.z, n.x, n.z);
    let r = n.r * (n.kind === 'lure' || n.kind === 'trap' ? 1 : this.H.hearing);
    if (!lineOfSight(this.x, this.z, n.x, n.z, this.opaque)) r *= 0.65;
    if (d > r) return;
    const key = n.src ?? `${n.kind || 'x'}:${Math.round(n.x)}:${Math.round(n.z)}`;
    if (this.g.time - (this.heardAt.get(key) ?? -9) < 0.45) return;
    this.heardAt.set(key, this.g.time);
    // he knows roughly where a sound came from, not exactly (quieter = vaguer)
    const loud = Math.min(1, (r - d) / 8 + 0.2), f = this.H.fuzz * (1.2 - loud), a = Math.random() * Math.PI * 2;
    const px = n.x + Math.cos(a) * f * Math.random(), pz = n.z + Math.sin(a) * f * Math.random();
    this.send('g:ev', { e: 'heard', p: [r2(px), r2(floorY(n.x, n.z)), r2(pz)], k: n.kind || 'step', loud: r2(loud) });
  }

  tick(dt) {
    const g = this.g;
    if (this.grace > 0) { this.grace -= dt; if (this.grace <= 0) g.emit({ e: 'msg', text: 'The Headmaster is loose.', kind: 'bad' }); }
    for (const k in this.cd) if (this.cd[k] > 0) this.cd[k] -= dt;
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    if (this.stunT > 0) this.stunT -= dt;
    if (this.flashImmune > 0) this.flashImmune -= dt;
    if (this.torchImmune > 0) this.torchImmune -= dt;

    // rage drains while he runs, refills after a short rest
    if (this.sprinting && this.moved) { this.rage = Math.max(0, this.rage - dt); this.rageRest = 1.2; if (this.rage <= 0) this.sprinting = false; }
    else { this.rageRest -= dt; if (this.rageRest <= 0) this.rage = Math.min(this.H.rageMax, this.rage + dt * this.H.rageRegen * (this.enraged ? 2 : 1)); }
    if (g.time - this.lastT > 0.4) { this.moved = false; this.sprinting = false; }

    if (this.busy > 0) { this.busy -= dt; if (this.busy <= 0 && this.busyFn) { const fn = this.busyFn; this.busyFn = null; fn(); } }

    // the swing lands (or does not) when the wind-up ends
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        const [fx, fz] = this.fwd();
        let best = null, bd = this.H.reach;
        for (const p of g.players.values()) {
          if (p.state !== 'alive' || p.hidden >= 0 || Math.abs(p.y - this.y) > 2) continue;
          const d = dist(p.x, p.z, this.x, this.z);
          if (d > bd) continue;
          const dot = d > 0.3 ? ((p.x - this.x) * fx + (p.z - this.z) * fz) / d : 1;
          if (dot < 0.25 || !lineOfSight(this.x, this.z, p.x, p.z, this.opaque)) continue;
          best = p; bd = d;
        }
        if (best) this.landHit(best); else this.attackCd = this.H.missCd;
      }
    }

    // traps: snap shut on anyone who walks (not crouch-walks) over them
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const t = this.traps[i];
      if (g.time < t.arm) continue;
      const victim = [...g.players.values()].find((p) => p.state === 'alive' && p.hidden < 0 && !(p.flags & 1) && dist(p.x, p.z, t.x, t.z) < 0.75 && Math.abs(p.y - t.y) < 1);
      if (!victim) continue;
      this.traps.splice(i, 1);
      victim.rootT = this.H.trapRoot;
      g.emit({ e: 'trap-', id: t.id, by: victim.id });
      g.emitTo(victim, { e: 'rooted', t: this.H.trapRoot });
      this.send('g:ev', { e: 'heard', p: [t.x, t.y, t.z], k: 'trap', loud: 1 });
    }

    // a torch held on his face blinds him briefly (then he is immune for a while)
    let lit = false;
    if (this.torchImmune <= 0 && this.stunT <= 0) {
      for (const p of g.players.values()) {
        if (p.state !== 'alive' || p.hidden >= 0 || !(p.flags & 2)) continue;
        const d = dist(p.x, p.z, this.x, this.z);
        if (d > this.H.torchRange || d < 0.3) continue;
        const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
        if (((this.x - p.x) * fx + (this.z - p.z) * fz) / d > 0.97 && lineOfSight(p.x, p.z, this.x, this.z, this.opaque)) { lit = true; break; }
      }
    }
    this.torchT = lit ? this.torchT + dt : Math.max(0, this.torchT - dt * 2);
    if (this.torchT >= this.H.torchTime) { this.torchT = 0; this.torchImmune = this.H.torchImmune; this.stun(this.H.torchStun, 'torch'); }

    this.setState(this.stunT > 0 ? 'retreat' : this.windup > 0 ? 'attack' : this.sprinting ? 'chase' : 'patrol');

    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.2;
      this.send('g:mhud', { rage: r2(this.rage / this.H.rageMax), tp: r2(Math.max(0, this.cd.tp)), trap: r2(Math.max(0, this.cd.trap)), lights: r2(Math.max(0, this.cd.lights)), atk: r2(Math.max(0, this.attackCd)), slow: r2(Math.max(0, this.slowT)), stun: r2(Math.max(0, this.stunT)), grace: r2(Math.max(0, this.grace)), traps: this.traps.length, torch: r2(this.torchT / this.H.torchTime) });
    }
  }

  snap() { return [r2(this.x), r2(this.z), r2(this.ry), MSTATE[this.state], 0]; }
}
export { W };
