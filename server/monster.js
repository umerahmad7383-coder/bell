// The Headmaster — server-side AI.
// State machine: patrol -> investigate -> search -> chase -> attack -> retreat (+ stalk).
// Difficulty (client/shared/defs.js) scales his senses and speed, and its `smart` level
// switches on the behaviours marked [smart N] below.
import { MAP, W, FLOOR, idx, inBounds, findPath, lineOfSight, nearestFreeCell, floorY } from '../client/shared/map.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// Server-wide tuning knobs on top of the chosen difficulty.
const SPEED = Math.max(0.5, Math.min(1.5, Number(process.env.MONSTER_SPEED) || 1));
const GRACE = process.env.MONSTER_GRACE !== undefined && process.env.MONSTER_GRACE !== '' ? Number(process.env.MONSTER_GRACE) : null;

export const MSTATE = { patrol: 0, investigate: 1, search: 2, chase: 3, attack: 4, retreat: 5, stalk: 6 };
const ATTACK_START = 1.75; // he starts swinging this close...
const ATTACK_REACH = 2.15; // ...and the swing connects with anyone still this close when it lands
const LUNGE = 0.95;        // fraction of his chase speed he keeps while the swing winds up

// free cells next to a table: where he stands to look underneath it
const COVER_SPOTS = [];
for (let z = 1; z < MAP.grid.length / W - 1; z++) for (let x = 1; x < W - 1; x++) {
  const c = idx(x, z);
  if (MAP.grid[c] !== FLOOR || MAP.blocked[c]) continue;
  if (MAP.cover[c + 1] || MAP.cover[c - 1] || MAP.cover[c + W] || MAP.cover[c - W]) COVER_SPOTS.push({ x, z });
}

export class Monster {
  constructor(game) {
    this.g = game;
    this.D = game.D;
    this.smart = this.D.smart;
    const start = MAP.waypoints.find((w) => w.room === 'Gymnasium') || MAP.waypoints[0];
    this.x = start.x + 0.5; this.z = start.z + 0.5; this.ry = 0;
    this.state = 'patrol';
    this.path = [];
    this.timer = rand(4, 8);      // generic state timer (starts with a pause)
    this.targetId = null;
    this.awareness = new Map();
    this.lastSeen = null;         // {x, z, vx, vz}
    this.lostT = 0;
    this.repathT = 0;
    this.doorWait = 0;
    this.pendingDoor = -1;
    this.crawl = false;
    this.sawHide = null;
    this.inspect = null;
    this.inspected = new Set();
    this.searchCenter = null;
    this.noiseTarget = null;
    this.stalkCd = rand(50, 80) * this.D.stalk;
    this.stalkTarget = null;
    this.grace = GRACE !== null && Number.isFinite(GRACE) ? GRACE : this.D.grace;
    // --- memory used by the smarter behaviours ---
    this.fooled = 0;              // how many bottles he has chased
    this.throwOrigin = null;      // where the last bottle was thrown FROM
    this.lockerUses = new Map();  // locker id -> times a player hid there
    this.memory = null;           // {x, z, t} where he last lost someone
    this.chaseT = 0; this.chaseD0 = 0; this.interceptT = 0; this.chaseCheck = 0;
    this.checkingCover = false;
    this.guardCd = 0;
  }

  get aggr() { return this.g.aggression(); } // 0..~6, rises as objectives are completed
  get y() { return floorY(this.x, this.z); }

  // ----- helpers -----
  cost = (c) => {
    const di = MAP.doorAt[c];
    if (di < 0) return 0;
    const d = this.g.doors[di];
    if (d.open) return 0;
    if (d.locked || d.kind !== 'door') return -1;
    return 5; // closed doors slow him down, so he prefers open routes
  };
  opaque = (c) => { const di = MAP.doorAt[c]; return di >= 0 && !this.g.doors[di].open; };

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.g.emit({ e: 'mstate', s: MSTATE[s] });
  }
  pathTo(tx, tz) {
    this.path = findPath(this.x, this.z, tx, tz, this.cost) || [];
    return this.path.length > 0;
  }
  canSee(p, maxD = 24) {
    const d = dist(this.x, this.z, p.x, p.z);
    if (d > maxD) return false;
    if (Math.abs(p.y - this.y) > 2.2) return false;
    return lineOfSight(this.x, this.z, p.x, p.z, this.opaque);
  }
  face(tx, tz, dt, rate = 8) {
    const want = Math.atan2(tx - this.x, tz - this.z);
    this.ry += angDiff(want, this.ry) * Math.min(1, dt * rate);
  }
  alive() { return [...this.g.players.values()].filter((p) => p.state === 'alive'); }

  /** Follow the current path. Returns true when there is nothing left to walk. */
  move(dt, speed) {
    if (this.doorWait > 0) {
      this.doorWait -= dt;
      if (this.doorWait <= 0 && this.pendingDoor >= 0) {
        const d = this.g.doors[this.pendingDoor];
        if (!d.open && !d.locked) this.g.setDoor(d, true, 'monster');
        this.pendingDoor = -1;
      }
      return false;
    }
    let budget = speed * dt;
    while (budget > 0 && this.path.length) {
      const next = this.path[0];
      const di = MAP.doorAt[idx(Math.floor(next.x), Math.floor(next.z))];
      if (di >= 0 && !this.g.doors[di].open) {
        const d = this.g.doors[di];
        if (d.locked || d.kind !== 'door') { this.path = []; return true; }
        this.doorWait = (this.state === 'chase' ? 0.5 : 1.1) * this.D.doorWait;
        this.pendingDoor = di;
        return false;
      }
      const dx = next.x - this.x, dz = next.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d <= budget) { this.x = next.x; this.z = next.z; this.path.shift(); budget -= d; }
      else { this.x += (dx / d) * budget; this.z += (dz / d) * budget; budget = 0; }
      if (d > 0.01) this.face(this.x + dx, this.z + dz, dt, 10);
    }
    return this.path.length === 0;
  }

  /** Vision. Returns the player he has become fully aware of and most wants, or null. */
  sense(dt) {
    if (this.grace > 0) { this.grace -= dt; return null; }
    const D = this.D;
    let best = null, bestS = 1e9;
    for (const p of this.g.players.values()) {
      if (p.state !== 'alive' || p.hidden >= 0) { this.awareness.delete(p.id); continue; }
      const d = dist(this.x, this.z, p.x, p.z);
      let aw = this.awareness.get(p.id) || 0;
      let seen = false;
      if (d < 30 && this.canSee(p, 30)) {
        const crouch = p.flags & 1, flash = p.flags & 2, sprint = p.flags & 4;
        let range = (8 + (flash ? 7 : 0) + (this.g.obj.power ? 3 : 0) + (sprint ? 2 : 0) + this.aggr * 0.5) * D.vision;
        if (crouch) range *= 0.6;
        if (crouch && MAP.cover[idx(Math.floor(p.x), Math.floor(p.z))]) range *= 0.3;
        else if (crouch && MAP.shade[idx(Math.floor(p.x), Math.floor(p.z))]) range *= 0.45; // between seat rows, behind a drape
        const ang = Math.abs(angDiff(Math.atan2(p.x - this.x, p.z - this.z), this.ry));
        const inFov = ang < 1.05 || d < (crouch ? 1.3 : 2.4);
        if (d < range && inFov) seen = true;
        // being lit up by a flashlight beam gets his attention from any angle
        if (!seen && flash && d < 15 * D.vision) {
          const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
          const tx = (this.x - p.x) / (d || 1), tz = (this.z - p.z) / (d || 1);
          if (fx * tx + fz * tz > 0.96) seen = true;
        }
      }
      if (seen) aw += dt * (d < 4 ? 5 : 1.5 + 0.25 * this.aggr) * D.detect;
      else aw = Math.max(0, aw - dt * 0.5);
      this.awareness.set(p.id, Math.min(aw, 1.5));
      if (aw >= 1) {
        // [smart 2] goes for the weakest: wounded players and whoever carries an objective item
        let s = d;
        if (this.smart >= 2) { if (p.hp < this.g.maxHp) s -= 4; if (p.inv.some((it) => it && (it.type === 'fuse' || it.type === 'key_gate' || it.type === 'key_principal'))) s -= 2; }
        if (s < bestS) { best = p; bestS = s; }
      }
    }
    return best;
  }

  /** Called by the game whenever something makes a sound. n = {x, z, r, kind?, origin?} */
  onNoise(n) {
    if (this.grace > 0) return;
    if (!['patrol', 'search', 'investigate', 'stalk'].includes(this.state)) return;
    const d = dist(this.x, this.z, n.x, n.z);
    let r = n.r * (1 + 0.08 * this.aggr) * this.D.hearing;
    if (!lineOfSight(this.x, this.z, n.x, n.z, this.opaque)) r *= 0.65; // walls and doors muffle sound
    if (d > r) return;
    const loud = r - d;
    if (this.state === 'investigate' && this.noiseTarget && this.noiseTarget.loud > loud + 2) return;
    let tx = n.x, tz = n.z;
    if (n.kind === 'bottle') {
      this.fooled++;
      this.throwOrigin = n.origin || null;
      // [smart 3] a bottle only tells him where the thrower is standing
      // [smart 2] ...after he has fallen for it once
      if (n.origin && (this.smart >= 3 || (this.smart >= 2 && this.fooled >= 2 && Math.random() < 0.65))) { tx = n.origin.x; tz = n.origin.z; this.throwOrigin = null; }
    }
    const c = nearestFreeCell(tx, tz, 3);
    if (!c) return;
    if (this.pathTo(c.x + 0.5, c.z + 0.5) || dist(this.x, this.z, tx, tz) < 1.5) {
      this.noiseTarget = { x: tx, z: tz, loud };
      this.crawl = false;
      this.setState('investigate');
    }
  }

  onPlayerHid(p) {
    this.lockerUses.set(p.hidden, (this.lockerUses.get(p.hidden) || 0) + 1);
    if (this.state === 'chase' && this.targetId === p.id && this.lostT < 1.2 && dist(this.x, this.z, p.x, p.z) < 14) this.sawHide = p.id;
  }

  repel(seconds) {
    this.targetId = null; this.inspect = null;
    this.startRetreat(seconds);
  }

  startChase(p) {
    this.targetId = p.id;
    this.lastSeen = { x: p.x, z: p.z, vx: p.vx, vz: p.vz };
    this.lostT = 0; this.repathT = 0; this.crawl = false; this.sawHide = null; this.inspect = null;
    this.chaseT = 0; this.chaseCheck = 0; this.chaseD0 = dist(this.x, this.z, p.x, p.z); this.interceptT = 0;
    this.setState('chase');
  }
  startSearch(x, z) {
    this.searchCenter = { x, z };
    this.timer = (9 + this.aggr * 1.5 + rand(0, 4)) * this.D.search;
    this.inspected.clear(); this.inspect = null; this.path = []; this.checkingCover = false;
    this.setState('search');
  }
  startRetreat(seconds) {
    // run to the waypoint farthest from every living player (that he can actually reach)
    const live = this.alive();
    const scored = MAP.waypoints.map((w) => {
      let near = 1e9;
      for (const p of live) near = Math.min(near, dist(w.x, w.z, p.x, p.z));
      return { w, s: Math.min(near, 40) - dist(w.x, w.z, this.x, this.z) * 0.2 };
    }).sort((a, b) => b.s - a.s);
    this.path = [];
    for (let i = 0; i < Math.min(8, scored.length); i++) if (this.pathTo(scored[i].w.x + 0.5, scored[i].w.z + 0.5)) break;
    this.timer = seconds;
    this.setState('retreat');
  }

  /** Where the players currently need to go, given what is still to do. */
  hotspot() {
    const o = this.g.obj;
    if (o.gateOpen || (o.security && o.gateKey)) return { x: 8, z: 22 };                     // the gate
    if (o.power && !o.security) return { x: MAP.securityConsole.cellX, z: MAP.securityConsole.cellZ };
    if (o.officeOpen && !o.gateKey) return { x: 52, z: 15 };                                  // principal's office
    if (!o.power && o.fusesFound >= 2) return { x: 47, z: 31 };                               // top of the basement stairs
    if (o.power && !o.officeOpen) return { x: 47, z: 15 };                                    // outside the office door
    return null;
  }

  nextPatrolPoint() {
    const alive = this.alive();
    let cands = MAP.waypoints.filter((w) => dist(w.x, w.z, this.x, this.z) > 6);
    const roll = Math.random();
    const hs = this.smart >= 1 ? this.hotspot() : null;
    if (this.smart >= 2 && this.memory && this.g.time - this.memory.t < 90 && roll < 0.3) {
      // [smart 2] comes back to where he last lost someone
      const near = cands.filter((w) => dist(w.x, w.z, this.memory.x, this.memory.z) < 10);
      if (near.length) cands = near;
      this.memory = null;
    } else if (hs && roll < 0.14 + 0.12 * this.smart) {
      // [smart 1] drifts toward whatever the players have to do next
      const near = cands.filter((w) => dist(w.x, w.z, hs.x, hs.z) < 12);
      if (near.length) cands = near;
    } else if (alive.length && roll > 1 - (0.3 + 0.1 * this.aggr)) { // (a bigger school since v0.9: he drifts toward people a bit more)
      const p = pick(alive);
      const near = cands.filter((w) => dist(w.x, w.z, p.x, p.z) < 16);
      if (near.length) cands = near;
    }
    for (let i = 0; i < 6; i++) {
      const w = pick(cands);
      if (w && this.pathTo(w.x + 0.5, w.z + 0.5)) break;
    }
    this.crawl = Math.random() < 0.22;
  }

  /** "Suddenly appears at the end of a corridor" — only ever when nobody is looking at him. */
  tryStalk() {
    const alive = this.alive().filter((p) => p.hidden < 0);
    if (!alive.length) return false;
    for (const p of alive) if (dist(this.x, this.z, p.x, p.z) < 26 && lineOfSight(this.x, this.z, p.x, p.z, this.opaque)) return false;
    const p = pick(alive);
    const cands = MAP.waypoints.filter((w) => {
      if (!w.corridor) return false;
      const d = dist(w.x + 0.5, w.z + 0.5, p.x, p.z);
      if (d < 15 || d > 26) return false;
      if (Math.abs(floorY(w.x + 0.5, w.z + 0.5) - p.y) > 1) return false;
      if (!lineOfSight(w.x + 0.5, w.z + 0.5, p.x, p.z, this.opaque)) return false;
      return alive.every((q) => dist(w.x, w.z, q.x, q.z) > 13);
    });
    if (!cands.length) return false;
    const w = pick(cands);
    this.x = w.x + 0.5; this.z = w.z + 0.5; this.path = [];
    this.ry = Math.atan2(p.x - this.x, p.z - this.z);
    this.stalkTarget = p.id; this.timer = rand(3, 4.5); this.crawl = false;
    this.setState('stalk');
    return true;
  }

  /** Walk a straight line from (x,z) along (vx,vz) for up to `secs` of travel, stopping at walls. */
  project(x, z, vx, vz, secs) {
    const sp = Math.hypot(vx, vz);
    if (sp < 0.5) return { x, z };
    const dx = vx / sp, dz = vz / sp, len = Math.min(sp * secs, 12);
    let bx = x, bz = z;
    for (let t = 0.5; t <= len; t += 0.5) {
      const nx = x + dx * t, nz = z + dz * t, cx = Math.floor(nx), cz = Math.floor(nz);
      if (!inBounds(cx, cz) || MAP.grid[idx(cx, cz)] === 0) break;
      bx = nx; bz = nz;
    }
    return { x: bx, z: bz };
  }

  // ----- main update -----
  tick(dt) {
    const g = this.g, D = this.D;
    const mult = SPEED * D.speed;
    const speedPatrol = (1.7 + 0.14 * this.aggr) * mult;
    const speedInvest = (2.7 + 0.15 * this.aggr) * mult;
    const speedChase = (4.55 + 0.17 * this.aggr) * mult;
    const seen = this.state === 'retreat' || this.state === 'attack' || this.state === 'stalk' ? null : this.sense(dt);
    if (this.guardCd > 0) this.guardCd -= dt;

    switch (this.state) {
      case 'patrol': {
        if (seen) { this.startChase(seen); break; }
        this.stalkCd -= dt;
        if (this.stalkCd <= 0) {
          this.stalkCd = (rand(45, 80) - this.aggr * 5) * D.stalk;
          if (this.tryStalk()) break;
        }
        if (this.move(dt, speedPatrol * (this.crawl ? 0.8 : 1))) {
          this.timer -= dt;
          if (this.timer <= 0) { this.nextPatrolPoint(); this.timer = rand(0.8, Math.max(1, 3.2 - this.aggr * 0.3)); }
        }
        break;
      }
      case 'stalk': {
        // stands perfectly still and watches; then walks away. Detection resumes afterwards.
        const p = g.players.get(this.stalkTarget);
        if (p) this.face(p.x, p.z, dt, 3);
        this.timer -= dt;
        const tooClose = p && p.state === 'alive' && dist(this.x, this.z, p.x, p.z) < 8;
        if (tooClose && this.canSee(p)) { this.startChase(p); break; }
        if (this.timer <= 0) { this.nextPatrolPoint(); this.timer = 0; this.setState('patrol'); }
        break;
      }
      case 'investigate': {
        if (seen) { this.startChase(seen); break; }
        if (this.move(dt, speedInvest)) {
          const n = this.noiseTarget || { x: this.x, z: this.z };
          this.noiseTarget = null;
          this.startSearch(n.x, n.z);
        }
        break;
      }
      case 'search': {
        if (seen) { this.startChase(seen); break; }
        this.timer -= dt;
        if (this.inspect) {
          const L = MAP.lockers[this.inspect.id];
          if (this.inspect.t === null) {
            if (this.move(dt, speedInvest)) { this.inspect.t = 1.5; g.emit({ e: 'lockerinspect', id: L.id }); }
          } else {
            this.face(L.x + 0.5, L.z + 0.5, dt);
            this.inspect.t -= dt;
            if (this.inspect.t <= 0) {
              const occ = [...g.players.values()].find((p) => p.hidden === L.id && p.state === 'alive');
              this.inspect = null;
              if (occ && this.holdsBreath(occ, L)) { occ.stats.breath++; g.emit({ e: 'lockerpass', id: L.id }); g.emitTo(occ, { e: 'msg', text: 'He listens... and moves on. Breathe. Quietly.', kind: 'good' }); break; }
              if (occ) { g.pullFromLocker(occ); g.hitPlayer(occ); this.afterHit(); break; }
            }
          }
          break;
        }
        if (this.timer <= 0) {
          this.sawHide = null;
          if (this.searchCenter) this.memory = { x: this.searchCenter.x, z: this.searchCenter.z, t: g.time };
          // [smart 2] the bottle came from somewhere: go and look there next
          if (this.smart >= 2 && this.throwOrigin) {
            const o = this.throwOrigin; this.throwOrigin = null;
            const c = nearestFreeCell(o.x, o.z, 3);
            if (c && this.pathTo(c.x + 0.5, c.z + 0.5)) { this.noiseTarget = { x: o.x, z: o.z, loud: 99 }; this.setState('investigate'); break; }
          }
          this.nextPatrolPoint(); this.timer = 1; this.setState('patrol'); break;
        }
        if (this.move(dt, speedInvest * 0.85)) {
          const c = this.searchCenter;
          // [smart 2] just arrived beside a table: look underneath
          if (this.checkingCover) {
            this.checkingCover = false;
            for (const p of g.players.values()) if (p.state === 'alive' && p.hidden < 0 && dist(p.x, p.z, this.x, this.z) < 2.8 && this.canSee(p, 3)) this.awareness.set(p.id, 1.5);
          }
          // sometimes checks a nearby locker (always, if he watched someone climb in)
          const near = MAP.lockers.filter((L) => !this.inspected.has(L.id) && dist(L.x, L.z, this.x, this.z) < 8);
          const known = this.sawHide != null ? near.find((L) => { const p = g.players.get(this.sawHide); return p && p.hidden === L.id; }) : null;
          // [smart 2] lockers the players like get checked more often
          const learned = this.smart >= 2 ? near.reduce((m, L) => Math.max(m, this.lockerUses.get(L.id) || 0), 0) : 0;
          if (known || (near.length && Math.random() < (0.28 + 0.08 * this.aggr) * D.locker * (1 + 0.35 * learned))) {
            let L = known;
            if (!L) { const fav = this.smart >= 2 ? near.filter((l) => this.lockerUses.get(l.id)) : []; L = fav.length ? pick(fav) : pick(near); }
            this.inspected.add(L.id);
            if (this.pathTo(L.x + L.dx + 0.5, L.z + L.dz + 0.5) || dist(L.x + L.dx + 0.5, L.z + L.dz + 0.5, this.x, this.z) < 1) { this.inspect = { id: L.id, t: null }; break; }
          }
          if (this.smart >= 2 && Math.random() < 0.3 + 0.15 * (this.smart - 2)) {
            const spots = COVER_SPOTS.filter((s) => dist(s.x, s.z, c.x, c.z) < 9 && dist(s.x, s.z, this.x, this.z) > 1.5);
            if (spots.length) { const s = pick(spots); if (this.pathTo(s.x + 0.5, s.z + 0.5) && this.path.length < 24) { this.checkingCover = true; break; } this.path = []; }
          }
          for (let i = 0; i < 5; i++) {
            const cell = nearestFreeCell(c.x + rand(-7, 7), c.z + rand(-7, 7), 2);
            if (cell && this.pathTo(cell.x + 0.5, cell.z + 0.5) && this.path.length < 22) break;
            this.path = [];
          }
        }
        break;
      }
      case 'chase': {
        const p = g.players.get(this.targetId);
        if (!p || p.state !== 'alive') {
          if (seen) { this.startChase(seen); break; }
          this.startSearch(this.x, this.z); break;
        }
        if (p.hidden >= 0) {
          // target vanished into a locker
          const L = MAP.lockers[p.hidden];
          if (this.sawHide === p.id) {
            const fx = L.x + L.dx + 0.5, fz = L.z + L.dz + 0.5;
            if (dist(this.x, this.z, fx, fz) < 1.3) {
              g.emit({ e: 'lockerinspect', id: L.id });
              g.pullFromLocker(p); g.hitPlayer(p);
              this.sawHide = null;
              this.afterHit();
            } else {
              this.repathT -= dt;
              if (this.repathT <= 0) { this.pathTo(fx, fz); this.repathT = 0.4; }
              this.move(dt, speedChase);
            }
          } else {
            this.startSearch(this.lastSeen.x, this.lastSeen.z);
          }
          break;
        }
        const d = dist(this.x, this.z, p.x, p.z);
        const sees = this.canSee(p, 22 * Math.max(1, D.vision));
        if (sees) { this.lastSeen = { x: p.x, z: p.z, vx: p.vx, vz: p.vz }; this.lostT = 0; }
        else this.lostT += dt;
        if (this.lostT > (3 + 0.4 * this.aggr) * (D.lost / 3)) {
          // [smart 1] searches where you were heading, not where you were
          const ls = this.lastSeen;
          const guess = this.smart >= 1 ? this.project(ls.x, ls.z, ls.vx, ls.vz, 1.2 + 0.6 * this.smart) : ls;
          this.startSearch(guess.x, guess.z); break;
        }
        if (seen && seen !== p && dist(this.x, this.z, seen.x, seen.z) < d - 3) { this.startChase(seen); break; }
        if (sees && d < ATTACK_START) { this.startAttack(); break; }

        // [smart 2] a chase that is not closing turns into an interception
        this.chaseT += dt; this.chaseCheck += dt;
        if (this.interceptT > 0) this.interceptT -= dt;
        if (this.smart >= 2 && this.chaseCheck > 3.5) {
          if (d > 5 && d > this.chaseD0 - 1) this.interceptT = 2.5 + (this.smart - 2);
          this.chaseCheck = 0; this.chaseD0 = d;
        }
        this.repathT -= dt;
        if (this.repathT <= 0) {
          let t;
          if (sees && this.interceptT > 0) t = this.project(p.x, p.z, p.vx, p.vz, 1.6);
          else if (sees || this.lostT < 1.2) t = p;                                  // for a moment after losing sight he still "tracks" you
          else if (this.smart >= 1) t = this.project(this.lastSeen.x, this.lastSeen.z, this.lastSeen.vx, this.lastSeen.vz, 1 + 0.5 * this.smart);
          else t = this.lastSeen;
          if (!this.pathTo(t.x, t.z) && t !== p) this.pathTo(p.x, p.z);
          this.repathT = 0.25;
        }
        this.move(dt, speedChase);
        break;
      }
      case 'attack': {
        const p = g.players.get(this.targetId);
        if (p) this.face(p.x, p.z, dt, 14);
        // He does NOT stand still while the swing winds up: he lunges after you. (Standing still was
        // the bug that let anyone dodge every swing just by walking backwards.)
        if (p && p.state === 'alive' && p.hidden < 0) {
          const d = dist(this.x, this.z, p.x, p.z);
          if (d > 0.95) {
            this.repathT -= dt;
            if (this.repathT <= 0 || !this.path.length) { this.pathTo(p.x, p.z); this.repathT = 0.15; }
            this.move(dt, speedChase * LUNGE);
          }
        }
        this.timer -= dt;
        if (this.timer <= 0) {
          if (p && p.state === 'alive' && p.hidden < 0 && dist(this.x, this.z, p.x, p.z) < ATTACK_REACH && this.canSee(p)) {
            g.hitPlayer(p);
            this.afterHit();
          } else if (p && p.state === 'alive') { this.lostT = 0; this.repathT = 0; this.setState('chase'); }
          else this.startSearch(this.x, this.z);
        }
        break;
      }
      case 'retreat': {
        this.move(dt, 4.2 * mult);
        this.timer -= dt;
        if (this.timer <= 0) {
          this.awareness.clear();
          // [smart 2] a downed player is bait: he comes back for whoever tries the rescue
          const downed = [...g.players.values()].filter((p) => p.state === 'downed');
          if (this.smart >= 2 && downed.length && this.guardCd <= 0 && Math.random() < (this.smart >= 3 ? 0.9 : 0.6)) {
            const t = pick(downed), c = nearestFreeCell(t.x, t.z, 3);
            this.guardCd = 25;
            if (c && this.pathTo(c.x + 0.5, c.z + 0.5)) { this.noiseTarget = { x: t.x, z: t.z, loud: 99 }; this.setState('investigate'); break; }
          }
          this.timer = 1.5; this.setState('patrol');
        }
        break;
      }
    }
  }

  /** A player holding their breath in the locker he is checking may get away with it (never if he watched them get in). */
  holdsBreath(p, L) {
    if (!(p.flags & 16) || this.sawHide === p.id) return false;
    const learned = this.smart >= 2 ? Math.max(0, (this.lockerUses.get(L.id) || 0) - 1) * 0.08 : 0;
    return Math.random() < Math.max(0.1, (this.D.breath ?? 0.6) - learned);
  }

  startAttack() {
    this.timer = this.D.windup ?? 0.52; this.repathT = 0;
    this.setState('attack');
  }

  afterHit() { this.startRetreat(Math.max(2, this.D.retreat - 0.6 * this.aggr)); }

  snap() {
    return [round2(this.x), round2(this.z), round2(this.ry), MSTATE[this.state], this.crawl ? 1 : 0];
  }
}

function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
const round2 = (v) => Math.round(v * 100) / 100;
