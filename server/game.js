// One running match. The server owns: items, doors, objectives, the monster,
// player health/states and win/loss. Clients own only their own movement
// (which is sanity-checked here).
import { MAP, W, WALL, idx, floorY, inBounds, lineOfSight, ROOMS } from '../client/shared/map.js';
import { Monster } from './monster.js';
import { HumanMonster, HUNT } from './hunter.js';
import { DIFFICULTY, ITEM_TYPES, MODIFIERS, cleanLook, cleanMods, cleanClass, cleanTune } from '../client/shared/defs.js';

export const TICK_HZ = 15;
const INV_SLOTS = 4;
const REACH = 2.8;
const REVIVE_TIME = 4;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const r2 = (v) => Math.round(v * 100) / 100;
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

export const ITEM_NAMES = {
  fuse: 'Fuse', key_principal: "Principal's Office Key", key_gate: 'Gate Key', battery: 'Battery',
  medkit: 'Medical Kit', lockpick: 'Lockpick', bottle: 'Glass Bottle', bell: 'Hand Bell', note: 'Note',
  camera: 'Polaroid Camera', soda: 'Energy Drink', alarm: 'Alarm Clock', chalk: 'Chalk', teddy: "Thomas's Teddy Bear",
};
const ROLL_SECS = 30;   // how long roll call lasts
const CHALK_MAX = 10;   // marks per player (the oldest is wiped when you draw another)
const ALARM_DELAY = 8, ALARM_DUR = 7;
const FINAL_SECS = 120; // the final bell: once the gate is open, this long to get out before it slams shut again

export class Game {
  /** players: [{pid, name, look}], send(ev, data), sendTo(pid, ev, data), onEnd(summary) */
  constructor({ players, send, sendTo, onEnd, mode = 'coop', difficulty = 'intermediate', hunterPid = null, mods = [], tune = null }) {
    this.send = send; this.sendTo = sendTo; this.onEnd = onEnd;
    // Hunt mode: one player is the Headmaster. Needs at least one survivor besides him.
    const hunter = mode === 'hunt' && players.length >= 2 ? players.find((p) => p.pid === hunterPid) || players[0] : null;
    this.mode = hunter ? 'hunt' : 'coop';
    this.hunter = hunter ? hunter.pid : null; this.hunterName = hunter ? hunter.name : null;
    if (hunter) { players = players.filter((p) => p !== hunter); difficulty = 'intermediate'; } // Hunt has its own fixed balance
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'intermediate';
    this.D = DIFFICULTY[this.difficulty];
    this.mods = Object.fromEntries(cleanMods(mods).map((k) => [k, true]));
    this.tune = hunter ? cleanTune(tune) : null; // Hunt Mode balance, set by the host in the lobby
    this.maxHp = this.mods.onehit ? 1 : hunter ? (this.tune.hits || (players.length <= 2 ? 3 : 2)) : this.D.hp; // one or two survivors get an extra hit
    this.speedMul = (this.mods.restless ? 1.08 : 1) * (this.mods.sportsday ? 1.12 : 1); // how much faster the Headmaster is
    this.time = 0; this.over = false;
    this.doors = MAP.doors.map((d) => ({ ...d, open: false }));
    this.obj = { fusesFound: 0, fuses: 0, power: false, officeOpen: false, gateKey: false, security: false, gateOpen: false };
    this.items = new Map(); this.nextItem = 1;
    this.notes = [];
    this.players = new Map();
    players.forEach((pl, i) => {
      const s = MAP.playerSpawns[i % MAP.playerSpawns.length];
      this.players.set(pl.pid, {
        id: pl.pid, name: pl.name, look: cleanLook(pl.look, i), cls: cleanClass(pl.cls), x: s.x, y: 0, z: s.z, ry: Math.PI / 2 * -1, rx: 0, flags: 0,
        hp: this.maxHp, state: 'alive', inv: new Array(INV_SLOTS).fill(null), hidden: -1, bleed: 0, downs: 0,
        lastT: 0, stepT: 0, reviving: null, vx: 0, vz: 0, sel: 0, pingT: -9, rootT: 0, voiceT: -9,
        stats: { fuses: 0, revives: 0, hits: 0, thrown: 0, lures: 0, breath: 0, photos: 0, rolls: 0, teddy: 0, marks: 0 },
      });
    });
    this.lures = MAP.lures.map((l) => ({ ...l, readyAt: 0, used: false }));
    this.spawnItems();
    // class kit: the Medic starts with a Med Kit
    for (const p of this.players.values()) if (p.cls === 'medic') p.inv[0] = { id: this.nextItem++, type: 'medkit' };
    this.final = null; // the final bell
    this.monster = hunter ? new HumanMonster(this, hunter.pid, hunter.name) : new Monster(this);
    this.paraT = rand(14, 22);
    this.pending = []; // delayed actions {t, fn}
    this.marks = []; this.nextMark = 1; this.nextAlarm = 1; // chalk marks on the walls, wound-up alarm clocks
    this.teddyDone = false;
    this.roll = null; this.rollT = rand(130, 170) * (this.mods.restless ? 0.7 : 1); // roll call (Escape mode)
  }

  // ---------- setup ----------
  spawnItems() {
    const used = new Set();
    const byRoom = {};
    MAP.spots.forEach((s, i) => { (byRoom[s.room] ||= []).push(i); });
    const take = (room) => {
      const list = (byRoom[room] || []).filter((i) => !used.has(i));
      if (!list.length) return null;
      const i = pick(list); used.add(i); return MAP.spots[i];
    };
    const place = (type, room, extra = {}) => {
      const s = take(room); if (!s) return null;
      return this.addItem(type, s.x + rand(-0.15, 0.15), s.y, s.z + rand(-0.15, 0.15), extra);
    };
    const general = ROOMS.filter((r) => !r.corridor && !r.outside && !r.secret && !r.locked).map((r) => r.name);
    const shuffled = [...general].sort(() => Math.random() - 0.5);

    // objective items — different rooms every match
    const fuseRooms = shuffled.filter((r) => r !== 'Boiler Room').slice(0, 3);
    fuseRooms.forEach((r) => place('fuse', r));
    const keyRoom = pick(general.filter((r) => !fuseRooms.includes(r) && r !== 'Security Office'));
    place('key_principal', keyRoom);
    const gk = MAP.gateKeySpot;
    this.addItem('key_gate', gk.x, gk.y + 0.13, gk.z);

    // notes double as clues, so reading them out loud to the team matters
    const noteRooms = shuffled.filter((r) => r !== keyRoom).slice(3, 9);
    const texts = [
      `Caretaker's log — "Locked the Principal's office after what happened. I'm not carrying that key around any more. Left it in the ${keyRoom.toUpperCase()}. If he wants it, let him look."`,
      `Maintenance memo — "Somebody keeps pulling the fuses. Found one in the ${fuseRooms[0].toUpperCase()} of all places. The box is in the boiler room, bottom of the east stairs. Three fuses or nothing works — not the lights, not the gate."`,
      `Torn page, a child's handwriting — "He hears you when you run. He does not see well if you stay low and keep the torch off. He checks the lockers when he is sure. He hates the bell. He ALWAYS comes when the lights come back."`,
      `Nurse's log, last entry — "The Peters boy swears he held his breath in a locker and the Headmaster walked right past him. Hold SPACE in there. Don't move. Don't breathe. It does not always work."`,
      `Music teacher's note — "He can't abide noise he didn't make. The piano brings him running, so does the old radio in the janitor's closet. And the great bell on the stage... ring that and the whole school hears it. Once. It cracked the last time."`,
      `Letter from Mrs Peters, pinned under the MISSING poster — "Thomas never went anywhere without his teddy bear. If anyone finds it, please put it back in his locker in the Locker Room, the one with his name on it. I think it would help him rest."`,
    ];
    texts.forEach((text, i) => place('note', noteRooms[i] || pick(general), { text }));

    // supplies (deliberately scarce)
    const k = this.D.supplies;
    // (the school is bigger since v0.9, so there is a little more lying around)
    for (let i = 0; i < Math.round(6 * k); i++) place('battery', pick(general));
    for (let i = 0; i < Math.round(6 * k); i++) place('bottle', pick(general));
    for (let i = 0; i < Math.max(1, Math.round(1.4 * k)); i++) place('medkit', pick(general));
    place('medkit', "Nurse's Office"); // the nurse always kept one
    place('lockpick', pick(general.filter((r) => r !== keyRoom)));
    place('bell', pick(general));
    // v1.0 items: a camera whose flash blinds him, energy drinks, wind-up alarm clocks (decoys), chalk to mark walls
    place('camera', pick(['Art Room', 'Library', 'Music Room', 'Classroom 1B'].filter((r) => general.includes(r))), { charges: 3 });
    if (k > 1.2) place('camera', pick(general), { charges: 3 });
    place('soda', 'Cafeteria'); for (let i = 0; i < Math.round(1.4 * k); i++) place('soda', pick(general));
    for (let i = 0; i < 2; i++) place('alarm', pick(general));
    place('chalk', pick(['Classroom 1A', 'Classroom 1B', 'Classroom 1C'])); place('chalk', pick(general));
    if (this.mods.blackout) for (let i = 0; i < 3; i++) place('battery', pick(general));
    // the side quest: Thomas's lost teddy bear, somewhere far from his locker
    place('teddy', pick(general.filter((r) => r !== 'Locker Room' && r !== 'Boiler Room')));
    // the hidden archive behind the library bookshelf always rewards whoever finds it
    place('bell', 'Hidden Archive'); place('medkit', 'Hidden Archive'); place('battery', 'Hidden Archive');
  }

  addItem(type, x, y, z, extra = {}) {
    const it = { id: this.nextItem++, type, x: r2(x), y: r2(y), z: r2(z), ...extra };
    this.items.set(it.id, it);
    return it;
  }

  initPayload(pid) {
    return {
      you: pid, mode: this.mode, difficulty: this.difficulty, maxHp: this.maxHp, maxDowns: this.D.downs,
      role: pid === this.hunter ? 'monster' : 'survivor', hunter: this.hunter ? { id: this.hunter, name: this.hunterName } : null, hunt: this.monster.H || HUNT,
      final: this.final ? r2(this.final.until - this.time) : null,
      traps: this.monster.human ? this.monster.traps.map((t) => ({ id: t.id, p: [t.x, t.y, t.z] })) : [],
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, look: p.look, cls: p.cls, x: p.x, y: p.y, z: p.z, state: p.state, hp: p.hp, downs: p.downs, bleed: r2(p.bleed), away: p.away ? 1 : 0 })),
      inv: this.players.has(pid) ? this.players.get(pid).inv.map((it) => (it ? { type: it.type, text: it.text, n: it.charges } : null)) : null,
      items: [...this.items.values()].map(pubItem),
      doors: this.doors.map((d) => [d.open ? 1 : 0, d.locked ? 1 : 0]),
      obj: this.obj, notes: this.notes,
      lures: this.lures.map((l) => [l.used ? 1 : 0, r2(Math.max(0, l.readyAt - this.time))]),
      mods: Object.keys(this.mods), marks: this.marks, teddy: this.teddyDone ? 1 : 0,
      roll: this.roll ? { id: this.roll.id, t: r2(this.roll.until - this.time) } : null,
      monster: this.monster.snap(),
      tick: TICK_HZ,
    };
  }

  // ---------- messaging ----------
  emit(ev) { this.send('g:ev', ev); }
  emitTo(p, ev) { this.sendTo(p.id, 'g:ev', ev); }
  msg(p, text, kind = 'info') { this.emitTo(p, { e: 'msg', text, kind }); }
  announce(text, kind = 'info') { this.emit({ e: 'msg', text, kind }); }

  stage() {
    const o = this.obj;
    return Math.min(5, (o.fusesFound >= 3 ? 1 : 0) + (o.power ? 1 : 0) + (o.officeOpen ? 1 : 0) + (o.gateKey ? 1 : 0) + (o.security ? 1 : 0) + (o.gateOpen ? 1 : 0));
  }
  /** How worked-up the Headmaster is: objectives completed, scaled by difficulty. */
  aggression() { return this.stage() * this.D.aggr; }
  objChanged() { this.emit({ e: 'obj', obj: this.obj, stage: this.stage() }); }

  noise(x, z, r, src = null, extra = null) {
    if (this.over) return;
    this.monster.onNoise({ x, z, r, src, ...extra });
  }

  // ---------- player input ----------
  onState(pid, s) {
    const p = this.players.get(pid);
    if (!p || this.over || !Array.isArray(s) || s.length < 6) return;
    if (p.state !== 'alive' && p.state !== 'downed') return;
    const [x, y, z, ry, rx, flags] = s.map(Number);
    if (![x, y, z, ry, rx, flags].every(Number.isFinite)) return;
    p.ry = ry; p.rx = rx; p.flags = flags | 0;
    if (s.length > 6) p.sel = Math.max(0, Math.min(INV_SLOTS - 1, s[6] | 0));
    if (p.hidden >= 0) return;
    if (p.rootT > 0) { this.sendTo(pid, 'g:correct', [p.x, p.y, p.z]); return; } // caught in a trap
    const now = this.time;
    const dt = Math.max(0.02, now - p.lastT);
    const d = dist(x, z, p.x, p.z);
    const cx = Math.floor(x), cz = Math.floor(z);
    const okCell = inBounds(cx, cz) && MAP.grid[idx(cx, cz)] !== WALL;
    const maxD = (p.state === 'downed' ? 2.5 : 9) * dt + 0.8;
    const fy = floorY(x, z);
    if (!okCell || d > maxD || Math.abs(y - fy) > 2.2) {
      this.sendTo(pid, 'g:correct', [p.x, p.y, p.z]); // rejected: snap them back
      p.lastT = now;
      return;
    }
    // velocity estimate: the Headmaster uses it to guess where a fleeing player is heading
    const k = Math.min(1, dt * 6);
    p.vx += ((x - p.x) / dt - p.vx) * k; p.vz += ((z - p.z) / dt - p.vz) * k;
    p.x = x; p.y = y; p.z = z; p.lastT = now;
  }

  playerNear(p, x, z, reach = REACH) { return dist(p.x, p.z, x, z) <= reach; }
  hasItem(p, type) { return p.inv.findIndex((it) => it && it.type === type); }
  sendInv(p) { this.emitTo(p, { e: 'inv', inv: p.inv.map((it) => (it ? { type: it.type, text: it.text, n: it.charges } : null)) }); }
  consume(p, slot) { p.inv[slot] = null; this.sendInv(p); }

  onInteract(pid, m) {
    const p = this.players.get(pid);
    if (!p || this.over || !m || p.state !== 'alive') return;
    if (m.k === 'exit') return this.exitLocker(p);
    if (p.hidden >= 0) return;
    const id = m.id | 0;
    switch (m.k) {
      case 'door': {
        const d = this.doors[id];
        if (!d) return;
        const cx = d.kind === 'gate' ? 4.5 : d.x + 0.5, cz = d.kind === 'gate' ? 22.5 : d.z + 0.5;
        if (!this.playerNear(p, cx, cz, d.kind === 'gate' ? 3.4 : REACH)) return;
        if (d.kind === 'gate') {
          if (d.open) return;
          if (!this.obj.security) return this.msg(p, this.obj.power ? 'The electric lock is still armed. Disarm it from the Security Office.' : 'A heavy electric lock holds the gate. There is no power.', 'warn');
          const s = this.hasItem(p, 'key_gate');
          if (s < 0) return this.msg(p, 'The lock is disarmed, but the gate still needs its key.', 'warn');
          this.consume(p, s);
          d.locked = false; this.obj.gateOpen = true;
          this.setDoor(d, true, p.id);
          this.announce(`${p.name} unlocked the main gate. RUN.`, 'good');
          this.objChanged();
          this.noise(cx, cz, 40);
          this.startFinal();
          return;
        }
        if (d.locked) {
          const k = this.hasItem(p, 'key_principal');
          const lp = this.hasItem(p, 'lockpick');
          if (k >= 0) this.consume(p, k);
          else if (lp >= 0) { this.consume(p, lp); this.noise(cx, cz, 9); }
          else return this.msg(p, "Locked. You need the Principal's office key — or something to pick the lock.", 'warn');
          d.locked = false; this.obj.officeOpen = true;
          this.announce(`${p.name} ${k >= 0 ? 'unlocked' : 'picked the lock of'} the Principal's Office.`, 'good');
          this.objChanged();
          this.setDoor(d, true, p.id);
          return;
        }
        if (d.open) {
          // can't shut a door on somebody standing in it
          const blockedBy = [...this.players.values()].some((q) => q.state !== 'dead' && q.state !== 'escaped' && dist(q.x, q.z, cx, cz) < 0.75)
            || dist(this.monster.x, this.monster.z, cx, cz) < 0.9;
          if (blockedBy) return;
        }
        this.setDoor(d, !d.open, p.id);
        return;
      }
      case 'item': {
        const it = this.items.get(id);
        if (!it || !this.playerNear(p, it.x, it.z) || Math.abs(it.y - p.y) > 2.6) return;
        if (it.type === 'note') {
          this.items.delete(id);
          this.notes.push(it.text);
          this.emit({ e: 'item-', id, by: p.id });
          this.emit({ e: 'note', text: it.text, by: p.id });
          this.announce(`${p.name} found a note. (Open the notebook with TAB)`);
          return;
        }
        const slot = p.inv.indexOf(null);
        if (slot < 0) return this.msg(p, 'Your hands are full. Drop something with G.', 'warn');
        this.items.delete(id);
        p.inv[slot] = it;
        this.emit({ e: 'item-', id, by: p.id });
        this.sendInv(p);
        if (it.type === 'fuse' && !it.counted) {
          it.counted = true; this.obj.fusesFound++; p.stats.fuses++;
          this.announce(`${p.name} found a fuse (${this.obj.fusesFound}/3).`, 'good'); this.objChanged();
        } else if (it.type === 'key_gate' && !this.obj.gateKey) {
          this.obj.gateKey = true; this.announce(`${p.name} took the gate key.`, 'good'); this.objChanged();
        } else if (it.type === 'key_principal' && !it.counted) {
          it.counted = true; this.announce(`${p.name} found the Principal's office key.`, 'good');
        }
        return;
      }
      case 'locker': {
        const L = MAP.lockers[id];
        if (!L || !this.playerNear(p, L.x + 0.5, L.z + 0.5, 2.4)) return;
        if ([...this.players.values()].some((q) => q.hidden === id)) return this.msg(p, 'Someone is already in there.', 'warn');
        p.hidden = id; p.reviving = null;
        this.emit({ e: 'hide', id: p.id, locker: id });
        this.noise(p.x, p.z, 4, p.id);
        this.monster.onPlayerHid(p);
        return;
      }
      case 'fusebox': {
        const f = MAP.fuseBox;
        if (!this.playerNear(p, f.x, f.z, 3)) return;
        if (this.obj.power) return;
        const s = this.hasItem(p, 'fuse');
        if (s < 0) return this.msg(p, `The fuse box is missing ${3 - this.obj.fuses} fuse${3 - this.obj.fuses === 1 ? '' : 's'}.`, 'warn');
        this.consume(p, s);
        this.obj.fuses++;
        this.emit({ e: 'fuse', n: this.obj.fuses });
        if (this.obj.fuses >= 3) {
          this.obj.power = true;
          this.announce('Power restored. Every light in the building just told him where you are.', 'good');
          this.emit({ e: 'power' });
          this.noise(f.x, f.z - 1, 70);
        } else this.announce(`${p.name} fitted a fuse (${this.obj.fuses}/3).`, 'good');
        this.objChanged();
        return;
      }
      case 'console': {
        const c = MAP.securityConsole;
        if (!this.playerNear(p, c.x, c.z, 3)) return;
        if (!this.obj.power) return this.msg(p, 'The console is dead. Restore power first.', 'warn');
        if (this.obj.security) return;
        this.obj.security = true;
        this.announce(`${p.name} disarmed the gate lock from the Security Office.`, 'good');
        this.emit({ e: 'security' });
        this.objChanged();
        this.noise(c.x - 1, c.z, 16);
        return;
      }
      case 'lure': {
        const L = this.lures[id];
        if (!L || !this.playerNear(p, L.x, L.z, 2.7) || Math.abs(floorY(L.x, L.z) - p.y) > 1.5) return;
        if (L.used) return this.msg(p, 'The great bell is cracked right through. It will never ring again.', 'warn');
        if (this.time < L.readyAt) return this.msg(p, `Not yet: ${L.name} needs another ${Math.ceil(L.readyAt - this.time)} s.`, 'warn');
        if (L.cd) L.readyAt = this.time + L.cd + L.delay + L.dur; else L.used = true;
        p.stats.lures++;
        this.emit({ e: 'lure', id: L.id, delay: L.delay, dur: L.dur, by: p.id, used: L.used ? 1 : 0, ready: r2(Math.max(0, L.readyAt - this.time)) });
        // he hears it every second and a half for as long as it plays
        for (let t = 0; t < L.dur; t += 1.5) this.later(L.delay + t, () => this.noise(L.x, L.z, L.r, null, { kind: 'lure' }));
        if (L.kind === 'greatbell') this.announce(`${p.name} rang the great bell. The whole school heard it, and so did he.`, 'bad');
        else if (L.kind === 'radio') this.msg(p, 'You turn the dial. It clicks... six seconds. Get away from it.', 'info');
        return;
      }
      case 'teddy': return this.returnTeddy(p);
      case 'revive': {
        const t = this.players.get(id);
        if (!t || t.state !== 'downed' || !this.playerNear(p, t.x, t.z, 2.6)) return;
        p.reviving = { target: id, t: 0, noiseT: 0 };
        this.emit({ e: 'revive', by: p.id, target: id, on: 1, dur: REVIVE_TIME * (p.cls === 'medic' ? 0.5 : 1) });
        return;
      }
    }
  }

  exitLocker(p) {
    if (p.hidden < 0) return;
    const L = MAP.lockers[p.hidden];
    p.hidden = -1;
    p.x = L.x + L.dx * 0.95 + 0.5; p.z = L.z + L.dz * 0.95 + 0.5; p.y = floorY(p.x, p.z);
    this.sendTo(p.id, 'g:correct', [p.x, p.y, p.z]);
    this.emit({ e: 'hide', id: p.id, locker: -1 });
    this.noise(p.x, p.z, 4, p.id);
  }
  pullFromLocker(p) {
    if (p.hidden < 0) return;
    const L = MAP.lockers[p.hidden];
    p.hidden = -1;
    p.x = L.x + L.dx * 0.95 + 0.5; p.z = L.z + L.dz * 0.95 + 0.5; p.y = floorY(p.x, p.z);
    this.sendTo(p.id, 'g:correct', [p.x, p.y, p.z]);
    this.emit({ e: 'hide', id: p.id, locker: -1, pulled: 1 });
  }

  onUse(pid, m) {
    const p = this.players.get(pid);
    if (!p || this.over || p.state !== 'alive' || p.hidden >= 0 || !m) return;
    const slot = m.slot | 0;
    const it = p.inv[slot];
    if (!it) return;
    switch (it.type) {
      case 'battery':
        this.consume(p, slot); this.emitTo(p, { e: 'battery' }); break;
      case 'medkit': {
        const downed = [...this.players.values()].find((q) => q.state === 'downed' && this.playerNear(p, q.x, q.z, 2.6));
        if (downed) { this.consume(p, slot); this.revive(downed, this.maxHp, p); }
        else if (p.hp < this.maxHp) { this.consume(p, slot); p.hp = this.maxHp; this.emit({ e: 'pstate', id: p.id, state: p.state, hp: p.hp }); this.msg(p, 'You patch yourself up.', 'good'); }
        else this.msg(p, "You're not hurt. Save it — or use it next to a downed teammate.", 'info');
        break;
      }
      case 'bottle': {
        p.stats.thrown++;
        // server decides where it lands
        const ry = Number(m.ry) || p.ry, rx = Math.max(-1, Math.min(1, Number(m.rx) || 0));
        const range = Math.max(3, Math.min(13, 9 + rx * 7));
        const dx = -Math.sin(ry), dz = -Math.cos(ry);
        let lx = p.x, lz = p.z;
        for (let t = 0.3; t <= range; t += 0.25) {
          const nx = p.x + dx * t, nz = p.z + dz * t;
          const c = idx(Math.floor(nx), Math.floor(nz));
          const di = MAP.doorAt[c];
          if (!inBounds(Math.floor(nx), Math.floor(nz)) || MAP.grid[c] === WALL || (di >= 0 && !this.doors[di].open)) break;
          lx = nx; lz = nz;
        }
        this.consume(p, slot);
        const to = [r2(lx), r2(floorY(lx, lz)), r2(lz)];
        this.emit({ e: 'throw', from: [r2(p.x), r2(p.y + 1.4), r2(p.z)], to, by: p.id });
        const origin = { x: p.x, z: p.z };
        this.later(0.75, () => { this.emit({ e: 'smash', p: to }); this.noise(lx, lz, 26, null, { kind: 'bottle', origin }); });
        break;
      }
      case 'bell': {
        this.consume(p, slot);
        this.emit({ e: 'bell', p: [r2(p.x), r2(p.y + 1.2), r2(p.z)], by: p.id });
        const d = dist(p.x, p.z, this.monster.x, this.monster.z);
        if (d < 16) { this.monster.repel(this.D.bell); this.msg(p, 'The bell cracks in your hand. Something recoils from the sound.', 'good'); }
        else this.msg(p, 'The bell cracks in your hand. Nothing was close enough to hear it... you hope.', 'info');
        break;
      }
      case 'camera': return this.usePhoto(p, slot, it, m);
      case 'soda':
        this.consume(p, slot);
        this.emitTo(p, { e: 'soda', t: 12 });
        this.emit({ e: 'sfx', k: 'can', p: [r2(p.x), r2(p.y + 1.4), r2(p.z)] });
        this.noise(p.x, p.z, 4, p.id);
        break;
      case 'alarm': return this.setAlarm(p, slot);
      case 'chalk': return this.drawChalk(p, m);
      case 'teddy': this.msg(p, "Take it to Thomas's locker in the Locker Room (the one with his name on it) and press E.", 'info'); break;
      case 'fuse': this.msg(p, 'Take it to the fuse box in the Boiler Room (basement).', 'info'); break;
      case 'key_principal': this.msg(p, "Use it on the Principal's Office door (east corridor).", 'info'); break;
      case 'key_gate': this.msg(p, 'Use it on the main gate at the west end of the Main Hall.', 'info'); break;
      case 'lockpick': this.msg(p, 'Use it on a locked door.', 'info'); break;
    }
  }

  /** Polaroid camera: a flash in his face (within 8 m, in front of you, in plain sight) drives him back. 3 shots. */
  usePhoto(p, slot, it, m) {
    if (this.time - (p.photoT ?? -9) < 1.2) return;
    p.photoT = this.time;
    it.charges = Math.max(0, (it.charges ?? 3) - 1);
    const ry = Number.isFinite(Number(m.ry)) ? Number(m.ry) : p.ry;
    this.emit({ e: 'photo', by: p.id, p: [r2(p.x), r2(p.y + 1.45), r2(p.z)] });
    this.noise(p.x, p.z, 6, p.id);
    const mo = this.monster, d = dist(p.x, p.z, mo.x, mo.z);
    const fx = -Math.sin(ry), fz = -Math.cos(ry), dot = d > 0.01 ? ((mo.x - p.x) * fx + (mo.z - p.z) * fz) / d : 1;
    const shut = (c) => { const di = MAP.doorAt[c]; return di >= 0 && !this.doors[di].open; };
    if (mo.grace <= 0 && d < 8 && dot > 0.78 && Math.abs(floorY(mo.x, mo.z) - p.y) < 2 && lineOfSight(p.x, p.z, mo.x, mo.z, shut)) {
      if (mo.human ? mo.flashed() : (mo.repel(3), true)) { p.stats.photos++; this.msg(p, 'The flash catches him full in the face. He reels back.', 'good'); }
      else this.msg(p, 'He shields his eyes. Still dazzled from the last one.', 'warn');
    }
    if (it.charges <= 0) { this.consume(p, slot); this.msg(p, 'That was the last of the film.', 'info'); } else this.sendInv(p);
  }
  /** Wind an alarm clock and set it down: it rings a few seconds later and he comes to it. */
  setAlarm(p, slot) {
    this.consume(p, slot);
    let x = p.x - Math.sin(p.ry) * 0.5, z = p.z - Math.cos(p.ry) * 0.5;
    const c = inBounds(Math.floor(x), Math.floor(z)) ? idx(Math.floor(x), Math.floor(z)) : -1;
    if (c < 0 || MAP.grid[c] !== 1 || MAP.blocked[c] || Math.abs(floorY(x, z) - p.y) > 0.5) { x = p.x; z = p.z; }
    const id = this.nextAlarm++;
    this.emit({ e: 'alarm', id, p: [r2(x), r2(floorY(x, z)), r2(z)], delay: ALARM_DELAY, dur: ALARM_DUR, by: p.id });
    for (let t = 0; t < ALARM_DUR; t += 1.2) this.later(ALARM_DELAY + t, () => this.noise(x, z, 28, null, { kind: 'lure' }));
    p.stats.lures++;
    this.msg(p, `Wound up and set down. It goes off in ${ALARM_DELAY} seconds. Get away from it.`, 'info');
  }
  /** Chalk: a mark on the wall you are facing. m.sym: 0 = X, 1 = arrow left, 2 = arrow right, 3 = warning. */
  drawChalk(p, m) {
    if (this.time - (p.chalkT ?? -9) < 0.5) return;
    p.chalkT = this.time;
    const ry = Number.isFinite(Number(m.ry)) ? Number(m.ry) : p.ry, rx = Math.max(-1, Math.min(1, Number(m.rx) || 0));
    const dx = -Math.sin(ry), dz = -Math.cos(ry);
    let px = p.x, pz = p.z, hit = null;
    for (let t = 0.05; t <= 2.6; t += 0.04) {
      const nx = p.x + dx * t, nz = p.z + dz * t, cx = Math.floor(nx), cz = Math.floor(nz);
      if (!inBounds(cx, cz)) break;
      const c = idx(cx, cz);
      if (MAP.doorAt[c] >= 0 || MAP.blocked[c]) break; // not on doors, and furniture or lockers are in the way
      if (MAP.grid[c] === WALL) {
        const pcx = Math.floor(px), pcz = Math.floor(pz);
        if (cx !== pcx) hit = { x: pcx < cx ? cx : cx + 1, z: pz, n: [pcx < cx ? -1 : 1, 0] };
        else hit = { x: px, z: pcz < cz ? cz : cz + 1, n: [0, pcz < cz ? -1 : 1] };
        break;
      }
      px = nx; pz = nz;
    }
    if (!hit) return this.msg(p, 'Face a wall, close up, to draw on it.', 'info');
    const sym = [0, 1, 2, 3].includes(m.sym | 0) ? m.sym | 0 : 0;
    const mark = { id: this.nextMark++, by: p.id, p: [r2(hit.x + hit.n[0] * 0.012), r2(p.y + 1.45 + rx * 0.5), r2(hit.z + hit.n[1] * 0.012)], n: hit.n, sym };
    const mine = this.marks.filter((k) => k.by === p.id);
    if (mine.length >= CHALK_MAX) { const old = mine[0]; this.marks = this.marks.filter((k) => k !== old); this.emit({ e: 'chalk-', id: old.id }); }
    this.marks.push(mark); p.stats.marks++;
    this.emit({ e: 'chalk', ...mark });
    this.noise(p.x, p.z, 2, p.id);
  }
  /** The side quest: put Thomas's teddy back in his locker. Everyone is patched up, the objectives light up, and he is driven off. */
  returnTeddy(p) {
    if (this.teddyDone) return;
    const L = MAP.lockers[MAP.thomasLocker];
    if (!this.playerNear(p, L.x + 0.5 + L.dx * 0.6, L.z + 0.5 + L.dz * 0.6, 2.5)) return;
    const s = this.hasItem(p, 'teddy');
    if (s < 0) return this.msg(p, "A locker with a name taped to it: T. PETERS. Something of his is missing.", 'info');
    this.consume(p, s);
    this.teddyDone = true; p.stats.teddy = 1;
    this.emit({ e: 'ghost', p: [r2(L.x + 0.5 + L.dx * 0.75), 0, r2(L.z + 0.5 + L.dz * 0.75)], by: p.id });
    // Thomas patches everyone up a little, and forgives one fall each
    for (const q of this.players.values()) if (q.state === 'alive' && (q.hp < this.maxHp || q.downs > 0)) { q.hp = Math.min(this.maxHp, q.hp + 1); q.downs = Math.max(0, q.downs - 1); this.emit({ e: 'pstate', id: q.id, state: q.state, hp: q.hp, downs: q.downs }); }
    const show = ['fuse', 'key_principal', 'key_gate', 'lockpick', 'medkit'];
    const items = [...this.items.values()].filter((it) => show.includes(it.type) && !(it.type === 'fuse' && it.counted)).map((it) => [it.type, it.x, it.y + 0.2, it.z]);
    this.emit({ e: 'reveal', items, t: 30 });
    if (this.monster.human) this.monster.stun(4, 'ghost'); else this.monster.repel(8);
    this.announce(`${p.name} gave Thomas his bear back. A small cold hand squeezes yours... and for a while, you can see where everything is.`, 'good');
  }

  /** The final bell: the gate is open, every light turns red, he is enraged, and the gate slams shut again in FINAL_SECS. */
  startFinal() {
    if (this.final) return;
    this.final = { until: this.time + FINAL_SECS, next: this.time + 3 };
    if (this.roll) this.endRoll(false);
    this.monster.enrage?.();
    this.emit({ e: 'finalbell', t: FINAL_SECS });
    this.announce(`The final bell is ringing. The gate shuts again in ${FINAL_SECS / 60} minutes. Get out.`, 'bad');
  }
  tickFinal() {
    const f = this.final;
    if (this.time >= f.until) {
      this.emit({ e: 'gateslam' });
      const gate = this.doors[MAP.gate.id]; if (gate) { gate.open = false; gate.locked = true; this.emit({ e: 'door', id: gate.id, open: 0, locked: 1, by: 'ghost' }); }
      this.obj.gateOpen = false;
      for (const p of this.players.values()) if (p.state === 'alive' || p.state === 'downed') this.kill(p, 'was locked inside when the gate slammed shut');
      this.final = null;
      this.checkEnd();
      return;
    }
    // the AI always has a rough idea where the nearest survivor is
    if (this.time >= f.next && !this.monster.human) {
      f.next = this.time + 4;
      const m = this.monster, prey = [...this.players.values()].filter((q) => q.state === 'alive' && q.hidden < 0)
        .sort((a, b) => dist(a.x, a.z, m.x, m.z) - dist(b.x, b.z, m.x, m.z))[0];
      if (prey) this.noise(prey.x + rand(-2.5, 2.5), prey.z + rand(-2.5, 2.5), 999, null, { kind: 'roll' });
    }
  }

  /** Roll call (Escape mode): the PA calls one student, and for a while he has a rough idea where they are. */
  startRoll() {
    const cands = [...this.players.values()].filter((q) => q.state === 'alive' && q.hidden < 0);
    if (!cands.length || this.monster.state === 'chase' || this.monster.state === 'attack') { this.rollT = 20; return; }
    const p = pick(cands);
    this.roll = { id: p.id, until: this.time + ROLL_SECS, next: this.time + 5 };
    this.emit({ e: 'rollcall', id: p.id, name: p.name, t: ROLL_SECS });
  }
  endRoll(survived) {
    const p = this.players.get(this.roll.id);
    if (survived && p) { p.stats.rolls++; this.msg(p, 'Roll call is over. You were not found.', 'good'); }
    this.emit({ e: 'rollend', id: this.roll.id, ok: survived ? 1 : 0 });
    this.roll = null;
    this.rollT = rand(150, 210) * (this.mods.restless ? 0.7 : 1);
  }
  tickRoll(dt) {
    if (this.mode !== 'coop' || this.final) return;
    if (!this.roll) { if ((this.rollT -= dt) <= 0) this.startRoll(); return; }
    const p = this.players.get(this.roll.id);
    if (!p || p.state !== 'alive') return this.endRoll(false);
    if (this.time >= this.roll.until) return this.endRoll(true);
    if (this.time < this.roll.next) return;
    this.roll.next = this.time + 5;
    // hiding (a locker, or crouched under cover) keeps you off his mind
    if (p.hidden >= 0 || (p.flags & 1 && MAP.cover[idx(Math.floor(p.x), Math.floor(p.z))])) return;
    for (let i = 0; i < 12; i++) { // a rough guess, a few metres off
      const a = rand(0, Math.PI * 2), r = rand(1.5, 4.5), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r, cx = Math.floor(x), cz = Math.floor(z);
      if (!inBounds(cx, cz) || MAP.grid[idx(cx, cz)] !== 1 || MAP.blocked[idx(cx, cz)] || Math.abs(floorY(x, z) - p.y) > 1) continue;
      return this.noise(x, z, 999, null, { kind: 'roll' });
    }
    this.noise(p.x, p.z, 999, null, { kind: 'roll' });
  }

  /** Hunt mode: input from the player who is the Headmaster. */
  onMonsterMove(pid, s) { if (pid === this.hunter && this.monster.human && !this.over) this.monster.onMove(s); }
  onMonsterAct(pid, m) { if (pid === this.hunter && this.monster.human && !this.over) this.monster.act(m); }

  /**
   * Voice chat is peer-to-peer, but each client reports how loudly its player is speaking so that
   * talking has a cost: he can hear you (the AI investigates; a human Headmaster sees where it came from).
   */
  onVoice(pid, level) {
    const p = this.players.get(pid);
    if (!p || this.over || p.state !== 'alive') return;
    level = Math.max(0, Math.min(1, Number(level) || 0));
    if (level < 0.05 || this.time - p.voiceT < 0.3) return;
    p.voiceT = this.time;
    this.noise(p.x, p.z, 3.5 + level * 11, p.id, { kind: 'voice' }); // a murmur carries ~4 m, a shout ~14 m — even from inside a locker
  }

  /** A marker everyone on the team can see. Downed players use it to call for help (which he can hear). */
  onPing(pid, m) {
    const p = this.players.get(pid);
    if (!p || this.over || !m || (p.state !== 'alive' && p.state !== 'downed')) return;
    if (this.time - p.pingT < 1.2) return; // no spamming
    p.pingT = this.time;
    if (p.state === 'downed') {
      this.emit({ e: 'ping', by: p.id, p: [r2(p.x), r2(p.y + 0.4), r2(p.z)], help: 1 });
      this.noise(p.x, p.z, 9, p.id);
      return;
    }
    if (p.hidden >= 0) return;
    const it = m.item ? this.items.get(m.item | 0) : null;
    let x = Number(m.x), y = Number(m.y), z = Number(m.z);
    if (it) { x = it.x; y = it.y + 0.15; z = it.z; }
    if (![x, y, z].every(Number.isFinite) || dist(x, z, p.x, p.z) > 32 || Math.abs(y - p.y) > 6) return;
    this.emit({ e: 'ping', by: p.id, p: [r2(x), r2(y), r2(z)], item: it ? it.type : null });
  }

  /** m = slot number (plain drop), or { slot, toss: 0..1, ry } — a toss lands up to ~4.5 m ahead. */
  onDrop(pid, m) {
    const p = this.players.get(pid);
    if (!p || this.over || p.hidden >= 0 || (p.state !== 'alive' && p.state !== 'downed')) return;
    const slot = (typeof m === 'object' && m ? m.slot : m) | 0;
    const toss = p.state === 'alive' && typeof m === 'object' && m ? Math.max(0, Math.min(1, Number(m.toss) || 0)) : 0;
    const it = p.inv[slot];
    if (!it || slot < 0 || slot >= INV_SLOTS) return;
    p.inv[slot] = null;
    if (toss > 0.05) {
      const ry = Number.isFinite(Number(m.ry)) ? Number(m.ry) : p.ry;
      const dx = -Math.sin(ry), dz = -Math.cos(ry), range = 1.4 + 3.2 * toss;
      let best = 0;
      for (let t = 0.3; t <= range; t += 0.1) {
        const nx = p.x + dx * t, nz = p.z + dz * t, cx = Math.floor(nx), cz = Math.floor(nz);
        if (!inBounds(cx, cz)) break;
        const c = idx(cx, cz), di = MAP.doorAt[c];
        if (MAP.grid[c] === WALL || (di >= 0 && !this.doors[di].open) || MAP.blocked[c] || Math.abs(floorY(nx, nz) - p.y) > 0.5) break;
        best = t;
      }
      const tt = Math.max(0, best - 0.25); // it lands a little short of whatever it hit
      const lx = p.x + dx * tt, lz = p.z + dz * tt;
      const from = [r2(p.x), r2(p.y + 1.3), r2(p.z)];
      it.x = r2(lx); it.z = r2(lz); it.y = r2(floorY(lx, lz) + 0.12);
      this.items.set(it.id, it);
      this.emit({ e: 'item+', item: pubItem(it), from, toss: 1 });
      this.sendInv(p);
      this.later(0.45, () => this.noise(lx, lz, 5, null));
      return;
    }
    this.dropItem(p, it, true);
    this.sendInv(p);
    this.noise(p.x, p.z, 3.5, p.id);
  }
  dropItem(p, it, animate = false) {
    const fx = -Math.sin(p.ry) * 0.6, fz = -Math.cos(p.ry) * 0.6;
    let x = p.x + fx, z = p.z + fz;
    const c = inBounds(Math.floor(x), Math.floor(z)) ? idx(Math.floor(x), Math.floor(z)) : -1;
    if (c < 0 || MAP.grid[c] !== 1 || MAP.blocked[c] || Math.abs(floorY(x, z) - p.y) > 0.5) { x = p.x; z = p.z; }
    it.x = r2(x + rand(-0.15, 0.15)); it.z = r2(z + rand(-0.15, 0.15)); it.y = r2(floorY(x, z) + 0.12);
    this.items.set(it.id, it);
    this.emit({ e: 'item+', item: pubItem(it), ...(animate ? { from: [r2(p.x), r2(p.y + (p.state === 'downed' ? 0.5 : 1.15)), r2(p.z)] } : {}) });
  }
  /** Hold your breath in a locker for too long and you gasp for air. Loud. */
  onGasp(pid) {
    const p = this.players.get(pid);
    if (!p || this.over || p.state !== 'alive' || p.hidden < 0 || this.time - (p.gaspT ?? -9) < 2) return;
    p.gaspT = this.time; p.flags &= ~16;
    this.emit({ e: 'gasp', id: p.id, locker: p.hidden });
    this.noise(p.x, p.z, 6.5, p.id, { kind: 'gasp' });
  }
  /** run fn after `secs` of game time */
  later(secs, fn) { this.pending.push({ t: this.time + secs, fn }); }

  // ---------- doors ----------
  setDoor(d, open, by) {
    if (d.open === open) return;
    d.open = open;
    this.emit({ e: 'door', id: d.id, open: open ? 1 : 0, locked: d.locked ? 1 : 0, by });
    const cx = d.x + 0.5, cz = d.z + 0.5;
    const who = typeof by === 'number' ? this.players.get(by) : null;
    if (by !== 'monster' && !(who && who.cls === 'mechanic' && d.kind === 'door')) this.noise(cx, cz, d.kind === 'shelf' ? 13 : open ? 9 : 7); // a Mechanic's doors make no sound
  }

  // ---------- health ----------
  hitPlayer(p) {
    if (p.state !== 'alive') return;
    p.stats.hits++;
    p.hp -= 1;
    p.reviving = null;
    if (p.hp <= 0) {
      // Each fall costs more, so two friends cannot trade revives forever: every down after the first
      // bleeds out twice as fast, and past the difficulty's limit nobody gets back up.
      p.downs++; p.hp = 0;
      if (p.downs > this.D.downs) {
        this.emit({ e: 'hit', id: p.id });
        this.kill(p, 'went down one time too many. Nobody gets back up from that');
        this.checkEnd();
        return;
      }
      p.state = 'downed'; p.bleed = this.D.bleed * (p.downs > 1 ? 0.5 : 1);
      const last = p.downs === this.D.downs;
      this.announce(last ? `${p.name} is down, and this is their last chance. Another fall and they are gone.` : `${p.name} is down! Reach them and hold your ground — press E to revive.`, 'bad');
    }
    this.emit({ e: 'hit', id: p.id });
    this.emit({ e: 'pstate', id: p.id, state: p.state, hp: p.hp, bleed: p.bleed, downs: p.downs });
    // Hunt Mode: a survivor who survives a hit gets a short burst of speed to break away
    if (this.mode === 'hunt' && p.state === 'alive') this.emitTo(p, { e: 'adrenaline', t: HUNT.adrenaline });
    this.checkEnd();
  }
  revive(t, hp, by) {
    by.stats.revives++;
    t.state = 'alive'; t.hp = hp; t.bleed = 0;
    this.emit({ e: 'pstate', id: t.id, state: 'alive', hp, downs: t.downs });
    this.announce(`${by.name} got ${t.name} back on their feet.${t.downs >= this.D.downs ? ` One more fall and ${t.name} is gone.` : ''}`, 'good');
  }
  kill(p, reason) {
    if (p.state === 'dead') return;
    p.state = 'dead'; p.hidden = -1;
    for (let i = 0; i < p.inv.length; i++) if (p.inv[i]) { this.dropItem(p, p.inv[i]); p.inv[i] = null; }
    this.sendInv(p);
    this.emit({ e: 'pstate', id: p.id, state: 'dead', hp: 0 });
    this.announce(`${p.name} ${reason}.`, 'bad');
  }

  removePlayer(pid) {
    if (pid === this.hunter && this.monster.human) {
      // the Headmaster's player left: the AI takes over where he stood, so the match goes on
      const old = this.monster;
      for (const t of old.traps) this.emit({ e: 'trap-', id: t.id });
      this.hunter = null;
      this.monster = new Monster(this);
      this.monster.x = old.x; this.monster.z = old.z; this.monster.grace = 4;
      if (this.final) this.monster.enrage(); // the final bell is still ringing
      this.emit({ e: 'hunterleft' });
      this.announce(`${this.hunterName} disconnected. The Headmaster is on his own now.`, 'bad');
      return;
    }
    const p = this.players.get(pid);
    if (!p) return;
    for (const it of p.inv) if (it) this.dropItem(p, it); // never lose objective items to a disconnect
    this.players.delete(pid);
    this.emit({ e: 'pleave', id: pid });
    this.announce(`${p.name} disconnected.`, 'bad');
    this.checkEnd();
  }

  /**
   * A player's connection dropped (on) or came back (off). Their character stays where it was;
   * anything that would otherwise carry on by itself (running footsteps, a revive, hiding in a
   * locker) is stopped, so nobody can be "away" to their advantage.
   */
  setAway(pid, on) {
    if (pid === this.hunter && this.monster.human) { const m = this.monster; m.sprinting = false; m.windup = 0; if (m.busyFn) { m.busy = 0; m.busyFn = null; } this.emit({ e: 'away', id: pid, on: on ? 1 : 0 }); return; }
    const p = this.players.get(pid);
    if (!p) return;
    p.away = !!on; p.flags = 0; p.vx = 0; p.vz = 0;
    if (p.reviving) { this.emit({ e: 'revive', by: p.id, target: p.reviving.target, on: 0 }); p.reviving = null; }
    if (!on && p.hidden >= 0) this.exitLocker(p); // back in the match standing in front of the locker, not stuck inside it
    this.emit({ e: 'away', id: pid, on: on ? 1 : 0 });
  }

  checkEnd() {
    if (this.over) return;
    const all = [...this.players.values()];
    if (all.some((p) => p.state === 'alive')) return;
    // nobody left standing: anyone still bleeding out has no one to save them
    for (const p of all) if (p.state === 'downed') this.kill(p, 'was dragged away into the dark');
    this.finish(all.some((p) => p.state === 'escaped'));
  }
  finish(win) {
    if (this.over) return;
    this.over = true;
    const summary = {
      win, time: Math.round(this.time), stage: this.stage(), obj: this.obj, difficulty: this.difficulty, mode: this.mode, mods: Object.keys(this.mods), teddy: this.teddyDone,
      hunter: this.mode === 'hunt' ? { id: this.hunter, name: this.hunterName, hits: this.monster.human ? this.monster.stats.hits : 0 } : null,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, state: p.state, t: p.escapedAt || null, stats: p.stats })),
    };
    this.onEnd(summary);
  }

  // ---------- simulation ----------
  tick(dt) {
    if (this.over) return;
    this.time += dt;

    if (this.pending.length && this.pending.some((a) => a.t <= this.time)) {
      const due = this.pending.filter((a) => a.t <= this.time).sort((a, b) => a.t - b.t);
      this.pending = this.pending.filter((a) => a.t > this.time);
      for (const a of due) { if (this.over) return; a.fn(); }
    }

    const ez = MAP.escapeZone;
    for (const p of this.players.values()) {
      if (p.rootT > 0) p.rootT -= dt;
      if (p.state === 'alive') {
        // footsteps the monster can hear (bit0 crouch, bit2 sprint, bit3 moving)
        if (p.hidden < 0 && p.flags & 8) {
          p.stepT -= dt;
          if (p.stepT <= 0) {
            p.stepT = 0.5;
            const r = (p.flags & 1 ? 1.3 : p.flags & 4 ? 13 : 5) * (p.cls === 'sneak' ? 0.5 : 1);
            this.noise(p.x, p.z, r, p.id);
          }
        }
        if (this.obj.gateOpen && p.x > ez.x0 && p.x < ez.x1 && p.z > ez.z0 && p.z < ez.z1) {
          p.state = 'escaped'; p.escapedAt = Math.round(this.time);
          this.emit({ e: 'pstate', id: p.id, state: 'escaped', hp: p.hp });
          this.announce(`${p.name} made it out.`, 'good');
          this.checkEnd();
          if (this.over) return;
        }
        if (p.reviving) {
          const t = this.players.get(p.reviving.target);
          if (!t || t.state !== 'downed' || !this.playerNear(p, t.x, t.z, 2.9)) {
            this.emit({ e: 'revive', by: p.id, target: p.reviving.target, on: 0 });
            p.reviving = null;
          } else {
            p.reviving.t += dt;
            // dragging someone back to their feet is not quiet: he can hear it from a fair way off
            if ((p.reviving.noiseT -= dt) <= 0) { p.reviving.noiseT = 1.2; this.noise(t.x, t.z, 9, p.id, { kind: 'revive' }); }
            if (p.reviving.t >= REVIVE_TIME * (p.cls === 'medic' ? 0.5 : 1)) { p.reviving = null; this.emit({ e: 'revive', by: p.id, target: t.id, on: 0 }); this.revive(t, 1, p); }
          }
        }
      } else if (p.state === 'downed') {
        p.bleed -= dt;
        if (p.bleed <= 0) { this.kill(p, 'bled out'); this.checkEnd(); if (this.over) return; }
      }
    }

    this.monster.tick(dt);
    this.tickRoll(dt);
    if (this.final) { this.tickFinal(); if (this.over) return; }

    // randomised paranormal events (purely atmospheric, except falling objects make real noise)
    this.paraT -= dt;
    if (this.paraT <= 0) { this.paraT = (rand(11, 24) - this.stage()) * (this.mods.restless ? 0.5 : 1); this.paranormal(); } // something happens roughly every 15 seconds
    for (const p of this.players.values()) if (this.time - p.lastT > 0.4) { p.vx *= 0.8; p.vz *= 0.8; } // stale velocity decays

    const snap = { t: Math.round(this.time * 1000), p: [], m: this.monster.snap() };
    for (const p of this.players.values()) {
      if ((p.state === 'alive' || p.state === 'downed') && p.hidden < 0) snap.p.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), r2(p.rx), p.flags, p.inv[p.sel] ? ITEM_TYPES.indexOf(p.inv[p.sel].type) : 0]);
    }
    this.send('g:snap', snap);
  }

  /**
   * The school's own tricks. These are identical on every difficulty: difficulty changes how
   * dangerous the Headmaster is, never how frightening the building is.
   */
  paranormal() {
    const alive = [...this.players.values()].filter((p) => p.state === 'alive');
    if (!alive.length) return;
    const p = pick(alive), m = this.monster;
    const far = (q) => dist(q.x, q.z, m.x, m.z) > 18;
    const free = (x, z) => { const cx = Math.floor(x), cz = Math.floor(z); return inBounds(cx, cz) && MAP.grid[idx(cx, cz)] === 1 && !MAP.blocked[idx(cx, cz)]; };
    const around = (min, max) => {
      for (let i = 0; i < 12; i++) {
        const a = rand(0, Math.PI * 2), d = rand(min, max);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        if (free(x, z)) return [r2(x), r2(floorY(x, z)), r2(z)];
      }
      return [r2(p.x), r2(p.y), r2(p.z)];
    };
    const sightOpaque = (c) => { const di = MAP.doorAt[c]; return di >= 0 && !this.doors[di].open; };

    // A jumpscare with nothing actually there, for ONE player. Never when he is genuinely close
    // (that would muddle the real warning signs), never twice in quick succession.
    if (this.time > 50 && Math.random() < 0.13) {
      const marks = alive.filter((q) => q.hidden < 0 && this.time - (q.jumpT ?? -999) > 110 && far(q));
      if (marks.length) { const q = pick(marks); q.jumpT = this.time; this.emitTo(q, { e: 'para', type: 'jump' }); return; }
    }
    const type = pick(['flicker', 'slam', 'creak', 'whisper', 'whisper', 'scream', 'fall', 'thunder', 'steps', 'knock', 'shadow', 'clang',
      'apparition', 'apparition', 'apparition', 'blackout', 'blackout', 'lockerbang', 'name', 'bell', 'musicbox', 'breath', 'breath', 'croak']);
    switch (type) {
      case 'slam': {
        // an open door near the players slams shut on its own
        const d = this.doors.find((d) => d.open && d.kind === 'door' && dist(d.x, d.z, p.x, p.z) < 18 && dist(d.x, d.z, p.x, p.z) > 2.5
          && ![...this.players.values()].some((q) => dist(q.x, q.z, d.x + 0.5, d.z + 0.5) < 1.2) && dist(m.x, m.z, d.x + 0.5, d.z + 0.5) > 1.5);
        if (d) { d.open = false; this.emit({ e: 'door', id: d.id, open: 0, locked: 0, by: 'ghost' }); return; }
        return this.emit({ e: 'para', type: 'knock', p: around(5, 12) });
      }
      case 'creak': {
        // ...or a closed one swings open by itself, slowly
        const d = this.doors.find((d) => !d.open && !d.locked && d.kind === 'door' && dist(d.x, d.z, p.x, p.z) < 12 && dist(d.x, d.z, p.x, p.z) > 2);
        if (d) { d.open = true; this.emit({ e: 'door', id: d.id, open: 1, locked: 0, by: 'ghost' }); return; }
        return this.emit({ e: 'para', type: 'whisper', p: around(2, 5) });
      }
      case 'fall': { const pos = around(5, 10); this.emit({ e: 'para', type, p: pos }); this.noise(pos[0], pos[2], 11); return; }
      case 'shadow': return this.emitTo(p, { e: 'para', type, p: around(8, 14) });
      case 'apparition': {
        // he is standing there, perfectly still. Only this player can see him; he is not really there.
        if (!far(p) || p.hidden >= 0) return this.emit({ e: 'para', type: 'whisper', p: around(2, 5) });
        for (let i = 0; i < 30; i++) {
          const a = rand(0, Math.PI * 2), d = rand(7, 15);
          const x = Math.floor(p.x + Math.cos(a) * d) + 0.5, z = Math.floor(p.z + Math.sin(a) * d) + 0.5;
          if (!free(x, z) || Math.abs(floorY(x, z) - p.y) > 0.5 || !lineOfSight(p.x, p.z, x, z, sightOpaque)) continue;
          return this.emitTo(p, { e: 'para', type, p: [x, r2(floorY(x, z)), z] });
        }
        return this.emitTo(p, { e: 'para', type: 'breath' });
      }
      case 'blackout': case 'breath': case 'name': return this.emitTo(p, { e: 'para', type });
      case 'lockerbang': {
        const near = MAP.lockers.filter((L) => dist(L.x, L.z, p.x, p.z) < 14 && ![...this.players.values()].some((q) => q.hidden === L.id));
        if (near.length) return this.emit({ e: 'para', type, id: pick(near).id });
        return this.emit({ e: 'para', type: 'knock', p: around(5, 12) });
      }
      case 'whisper': case 'musicbox': return this.emit({ e: 'para', type, p: around(3, 9) });
      case 'scream': case 'steps': case 'clang': case 'croak': case 'bell': return this.emit({ e: 'para', type, p: around(14, 26) });
      default: return this.emit({ e: 'para', type, p: around(3, 8) });
    }
  }
}

function pubItem(it) { return { id: it.id, type: it.type, x: it.x, y: it.y, z: it.z }; }
export { W, lineOfSight };
