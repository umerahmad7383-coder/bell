// The Headmaster — server-side AI.
// State machine: patrol -> investigate -> search -> chase -> attack -> retreat
import { MAP, W, idx, findPath, lineOfSight, nearestFreeCell, floorY } from '../client/shared/map.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// Difficulty knob: MONSTER_SPEED=0.9 makes every movement 10% slower, 1.1 faster.
const SPEED = Math.max(0.5, Math.min(1.5, Number(process.env.MONSTER_SPEED) || 1));
export const MSTATE = { patrol: 0, investigate: 1, search: 2, chase: 3, attack: 4, retreat: 5, stalk: 6 };

export class Monster {
  constructor(game) {
    this.g = game;
    const start = MAP.waypoints.find((w) => w.room === 'Gymnasium') || MAP.waypoints[0];
    this.x = start.x + 0.5; this.z = start.z + 0.5; this.ry = 0;
    this.state = 'patrol';
    this.path = [];
    this.timer = rand(4, 8);      // generic state timer (starts with a grace pause)
    this.targetId = null;
    this.awareness = new Map();
    this.lastSeen = null;
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
    this.stalkCd = rand(50, 80);
    this.stalkTarget = null;
    this.grace = Number(process.env.MONSTER_GRACE) || 12; // seconds at match start before it can detect anyone
  }

  get aggr() { return this.g.stage(); } // 0..5, rises as objectives are completed
  get y() { return floorY(this.x, this.z); }

  // ----- helpers -----
  cost = (c) => {
    const di = MAP.doorAt[c];
    if (di < 0) return 0;
    const d = this.g.doors[di];
    if (d.open) return 0;
    if (d.locked || d.kind !== 'door') return -1;
    return 5; // closed doors slow it down, so it prefers open routes
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
    let diff = want - this.ry;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.ry += diff * Math.min(1, dt * rate);
  }

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
        this.doorWait = this.state === 'chase' ? 0.5 : 1.1;
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

  /** Vision. Returns the nearest player it has become fully aware of, or null. */
  sense(dt) {
    if (this.grace > 0) { this.grace -= dt; return null; }
    let best = null, bestD = 1e9;
    for (const p of this.g.players.values()) {
      if (p.state !== 'alive' || p.hidden >= 0) { this.awareness.delete(p.id); continue; }
      const d = dist(this.x, this.z, p.x, p.z);
      let aw = this.awareness.get(p.id) || 0;
      let seen = false;
      if (d < 26 && this.canSee(p, 26)) {
        const crouch = p.flags & 1, flash = p.flags & 2, sprint = p.flags & 4;
        let range = 8 + (flash ? 7 : 0) + (this.g.obj.power ? 3 : 0) + (sprint ? 2 : 0) + this.aggr * 0.5;
        if (crouch) range *= 0.6;
        if (crouch && MAP.cover[idx(Math.floor(p.x), Math.floor(p.z))]) range *= 0.3;
        const ang = Math.abs(angDiff(Math.atan2(p.x - this.x, p.z - this.z), this.ry));
        const inFov = ang < 1.05 || d < (crouch ? 1.3 : 2.4);
        if (d < range && inFov) seen = true;
        // being lit up by a flashlight beam gets its attention from any angle
        if (!seen && flash && d < 15) {
          const fx = -Math.sin(p.ry), fz = -Math.cos(p.ry);
          const tx = (this.x - p.x) / (d || 1), tz = (this.z - p.z) / (d || 1);
          if (fx * tx + fz * tz > 0.96) seen = true;
        }
      }
      if (seen) aw += dt * (d < 4 ? 5 : 1.5 + 0.25 * this.aggr);
      else aw = Math.max(0, aw - dt * 0.5);
      this.awareness.set(p.id, Math.min(aw, 1.5));
      if (aw >= 1 && d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  /** Called by the game whenever something makes a sound. */
  onNoise(n) {
    if (this.grace > 0) return;
    if (!['patrol', 'search', 'investigate', 'stalk'].includes(this.state)) return;
    const d = dist(this.x, this.z, n.x, n.z);
    let r = n.r * (1 + 0.08 * this.aggr);
    if (!lineOfSight(this.x, this.z, n.x, n.z, this.opaque)) r *= 0.65; // walls and doors muffle sound
    if (d > r) return;
    const loud = r - d;
    if (this.state === 'investigate' && this.noiseTarget && this.noiseTarget.loud > loud + 2) return;
    const c = nearestFreeCell(n.x, n.z, 3);
    if (!c) return;
    if (this.pathTo(c.x + 0.5, c.z + 0.5) || d < 1.5) {
      this.noiseTarget = { x: n.x, z: n.z, loud };
      this.crawl = false;
      this.setState('investigate');
    }
  }

  onPlayerHid(p) {
    if (this.state === 'chase' && this.targetId === p.id && this.lostT < 1.2 && dist(this.x, this.z, p.x, p.z) < 14) this.sawHide = p.id;
  }

  repel(seconds) {
    this.targetId = null; this.inspect = null;
    this.startRetreat(seconds);
  }

  startChase(p) {
    this.targetId = p.id;
    this.lastSeen = { x: p.x, z: p.z };
    this.lostT = 0; this.repathT = 0; this.crawl = false; this.sawHide = null; this.inspect = null;
    this.setState('chase');
  }
  startSearch(x, z) {
    this.searchCenter = { x, z };
    this.timer = 9 + this.aggr * 1.5 + rand(0, 4);
    this.inspected.clear(); this.inspect = null; this.path = [];
    this.setState('search');
  }
  startRetreat(seconds) {
    // run to the waypoint farthest from every living player (that it can actually reach)
    const scored = MAP.waypoints.map((w) => {
      let near = 1e9;
      for (const p of this.g.players.values()) if (p.state === 'alive') near = Math.min(near, dist(w.x, w.z, p.x, p.z));
      return { w, s: Math.min(near, 40) - dist(w.x, w.z, this.x, this.z) * 0.2 };
    }).sort((a, b) => b.s - a.s);
    this.path = [];
    for (let i = 0; i < Math.min(8, scored.length); i++) if (this.pathTo(scored[i].w.x + 0.5, scored[i].w.z + 0.5)) break;
    this.timer = seconds;
    this.setState('retreat');
  }
  nextPatrolPoint() {
    // unpredictable route: random waypoint, biased toward players as aggression rises
    const alive = [...this.g.players.values()].filter((p) => p.state === 'alive');
    let cands = MAP.waypoints.filter((w) => dist(w.x, w.z, this.x, this.z) > 6);
    if (alive.length && Math.random() < 0.25 + 0.1 * this.aggr) {
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

  /** "Suddenly appears at the end of a corridor" — only ever when nobody is looking at it. */
  tryStalk() {
    const alive = [...this.g.players.values()].filter((p) => p.state === 'alive' && p.hidden < 0);
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

  // ----- main update -----
  tick(dt) {
    const g = this.g;
    const speedPatrol = (1.7 + 0.14 * this.aggr) * SPEED;
    const speedInvest = (2.7 + 0.15 * this.aggr) * SPEED;
    const speedChase = (4.55 + 0.17 * this.aggr) * SPEED;
    const seen = this.state === 'retreat' || this.state === 'attack' || this.state === 'stalk' ? null : this.sense(dt);

    switch (this.state) {
      case 'patrol': {
        if (seen) { this.startChase(seen); break; }
        this.stalkCd -= dt;
        if (this.stalkCd <= 0) {
          this.stalkCd = rand(45, 80) - this.aggr * 5;
          if (this.tryStalk()) break;
        }
        if (this.move(dt, speedPatrol * (this.crawl ? 0.8 : 1))) {
          this.timer -= dt;
          if (this.timer <= 0) { this.nextPatrolPoint(); this.timer = rand(0.8, 3.2 - this.aggr * 0.3); }
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
              if (occ) { g.pullFromLocker(occ); g.hitPlayer(occ); this.startRetreat(7 - 0.6 * this.aggr); break; }
            }
          }
          break;
        }
        if (this.timer <= 0) { this.sawHide = null; this.nextPatrolPoint(); this.timer = 1; this.setState('patrol'); break; }
        if (this.move(dt, speedInvest * 0.85)) {
          // sometimes checks a nearby hiding spot (always, if it watched someone climb in)
          const c = this.searchCenter;
          const near = MAP.lockers.filter((L) => !this.inspected.has(L.id) && dist(L.x, L.z, this.x, this.z) < 8);
          const known = this.sawHide != null ? near.find((L) => { const p = g.players.get(this.sawHide); return p && p.hidden === L.id; }) : null;
          if (known || (near.length && Math.random() < 0.28 + 0.08 * this.aggr)) {
            const L = known || pick(near);
            this.inspected.add(L.id);
            if (this.pathTo(L.x + L.dx + 0.5, L.z + L.dz + 0.5) || dist(L.x + L.dx + 0.5, L.z + L.dz + 0.5, this.x, this.z) < 1) { this.inspect = { id: L.id, t: null }; break; }
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
          const other = seen;
          if (other) { this.startChase(other); break; }
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
              this.startRetreat(7 - 0.6 * this.aggr);
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
        const sees = this.canSee(p, 22);
        if (sees) { this.lastSeen = { x: p.x, z: p.z }; this.lostT = 0; }
        else this.lostT += dt;
        if (this.lostT > 3 + 0.4 * this.aggr) { this.startSearch(this.lastSeen.x, this.lastSeen.z); break; }
        if (seen && seen !== p && dist(this.x, this.z, seen.x, seen.z) < d - 3) { this.startChase(seen); break; }
        if (sees && d < 1.55) { this.timer = 0.55; this.setState('attack'); break; }
        this.repathT -= dt;
        if (this.repathT <= 0) {
          // for a short while after losing sight it "tracks" the player, then only the last seen spot
          const t = sees || this.lostT < 1.2 ? p : this.lastSeen;
          this.pathTo(t.x, t.z);
          this.repathT = 0.25;
        }
        this.move(dt, speedChase);
        break;
      }
      case 'attack': {
        const p = g.players.get(this.targetId);
        if (p) this.face(p.x, p.z, dt, 14);
        this.timer -= dt;
        if (this.timer <= 0) {
          if (p && p.state === 'alive' && p.hidden < 0 && dist(this.x, this.z, p.x, p.z) < 2.2 && this.canSee(p)) {
            g.hitPlayer(p);
            this.startRetreat(7 - 0.6 * this.aggr);
          } else if (p && p.state === 'alive') { this.lostT = 0; this.repathT = 0; this.setState('chase'); }
          else this.startSearch(this.x, this.z);
        }
        break;
      }
      case 'retreat': {
        this.move(dt, 4.2);
        this.timer -= dt;
        if (this.timer <= 0) { this.awareness.clear(); this.timer = 1.5; this.setState('patrol'); }
        break;
      }
    }
  }

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
export { W };
