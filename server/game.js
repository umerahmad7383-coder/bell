// One running match. The server owns: items, doors, objectives, the monster,
// player health/states and win/loss. Clients own only their own movement
// (which is sanity-checked here).
import { MAP, W, WALL, idx, floorY, inBounds, lineOfSight, ROOMS } from '../client/shared/map.js';
import { Monster } from './monster.js';
import { DIFFICULTY, ITEM_TYPES, cleanLook } from '../client/shared/defs.js';

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
};

export class Game {
  /** players: [{pid, name, look}], send(ev, data), sendTo(pid, ev, data), onEnd(summary) */
  constructor({ players, send, sendTo, onEnd, mode = 'coop', difficulty = 'intermediate' }) {
    this.send = send; this.sendTo = sendTo; this.onEnd = onEnd; this.mode = mode;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'intermediate';
    this.D = DIFFICULTY[this.difficulty];
    this.maxHp = this.D.hp;
    this.time = 0; this.over = false;
    this.doors = MAP.doors.map((d) => ({ ...d, open: false }));
    this.obj = { fusesFound: 0, fuses: 0, power: false, officeOpen: false, gateKey: false, security: false, gateOpen: false };
    this.items = new Map(); this.nextItem = 1;
    this.notes = [];
    this.players = new Map();
    players.forEach((pl, i) => {
      const s = MAP.playerSpawns[i % MAP.playerSpawns.length];
      this.players.set(pl.pid, {
        id: pl.pid, name: pl.name, look: cleanLook(pl.look, i), x: s.x, y: 0, z: s.z, ry: Math.PI / 2 * -1, rx: 0, flags: 0,
        hp: this.maxHp, state: 'alive', inv: new Array(INV_SLOTS).fill(null), hidden: -1, bleed: 0,
        lastT: 0, stepT: 0, reviving: null, vx: 0, vz: 0, sel: 0, pingT: -9,
        stats: { fuses: 0, revives: 0, hits: 0, thrown: 0 },
      });
    });
    this.spawnItems();
    this.monster = new Monster(this);
    this.paraT = rand(20, 35);
    this.pending = []; // delayed actions {t, fn}
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
    const noteRooms = shuffled.filter((r) => r !== keyRoom).slice(3, 6);
    const texts = [
      `Caretaker's log — "Locked the Principal's office after what happened. I'm not carrying that key around any more. Left it in the ${keyRoom.toUpperCase()}. If he wants it, let him look."`,
      `Maintenance memo — "Somebody keeps pulling the fuses. Found one in the ${fuseRooms[0].toUpperCase()} of all places. The box is in the boiler room, bottom of the east stairs. Three fuses or nothing works — not the lights, not the gate."`,
      `Torn page, a child's handwriting — "He hears you when you run. He does not see well if you stay low and keep the torch off. He checks the lockers when he is sure. He hates the bell. He ALWAYS comes when the lights come back."`,
    ];
    texts.forEach((text, i) => place('note', noteRooms[i] || pick(general), { text }));

    // supplies (deliberately scarce)
    const k = this.D.supplies;
    for (let i = 0; i < Math.round(5 * k); i++) place('battery', pick(general));
    for (let i = 0; i < Math.round(5 * k); i++) place('bottle', pick(general));
    for (let i = 0; i < Math.max(1, Math.round(1.4 * k)); i++) place('medkit', pick(general));
    place('lockpick', pick(general.filter((r) => r !== keyRoom)));
    place('bell', pick(general));
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
      you: pid, mode: this.mode, difficulty: this.difficulty, maxHp: this.maxHp,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, look: p.look, x: p.x, y: p.y, z: p.z, state: p.state, hp: p.hp })),
      items: [...this.items.values()].map(pubItem),
      doors: this.doors.map((d) => [d.open ? 1 : 0, d.locked ? 1 : 0]),
      obj: this.obj, notes: this.notes,
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
  sendInv(p) { this.emitTo(p, { e: 'inv', inv: p.inv.map((it) => (it ? { type: it.type, text: it.text } : null)) }); }
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
      case 'revive': {
        const t = this.players.get(id);
        if (!t || t.state !== 'downed' || !this.playerNear(p, t.x, t.z, 2.6)) return;
        p.reviving = { target: id, t: 0 };
        this.emit({ e: 'revive', by: p.id, target: id, on: 1, dur: REVIVE_TIME });
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
        this.pending.push({ t: this.time + 0.75, fn: () => { this.emit({ e: 'smash', p: to }); this.noise(lx, lz, 26, null, { kind: 'bottle', origin }); } });
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
      case 'fuse': this.msg(p, 'Take it to the fuse box in the Boiler Room (basement).', 'info'); break;
      case 'key_principal': this.msg(p, "Use it on the Principal's Office door (east corridor).", 'info'); break;
      case 'key_gate': this.msg(p, 'Use it on the main gate at the west end of the Main Hall.', 'info'); break;
      case 'lockpick': this.msg(p, 'Use it on a locked door.', 'info'); break;
    }
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

  onDrop(pid, slot) {
    const p = this.players.get(pid);
    if (!p || this.over || p.hidden >= 0 || (p.state !== 'alive' && p.state !== 'downed')) return;
    slot |= 0;
    const it = p.inv[slot];
    if (!it) return;
    p.inv[slot] = null;
    this.dropItem(p, it);
    this.sendInv(p);
    this.noise(p.x, p.z, 3.5, p.id);
  }
  dropItem(p, it) {
    const fx = -Math.sin(p.ry) * 0.6, fz = -Math.cos(p.ry) * 0.6;
    let x = p.x + fx, z = p.z + fz;
    if (!inBounds(Math.floor(x), Math.floor(z)) || MAP.grid[idx(Math.floor(x), Math.floor(z))] !== 1) { x = p.x; z = p.z; }
    it.x = r2(x + rand(-0.15, 0.15)); it.z = r2(z + rand(-0.15, 0.15)); it.y = r2(floorY(x, z) + 0.12);
    this.items.set(it.id, it);
    this.emit({ e: 'item+', item: pubItem(it) });
  }

  // ---------- doors ----------
  setDoor(d, open, by) {
    if (d.open === open) return;
    d.open = open;
    this.emit({ e: 'door', id: d.id, open: open ? 1 : 0, locked: d.locked ? 1 : 0, by });
    const cx = d.x + 0.5, cz = d.z + 0.5;
    if (by !== 'monster') this.noise(cx, cz, d.kind === 'shelf' ? 13 : open ? 9 : 7);
  }

  // ---------- health ----------
  hitPlayer(p) {
    if (p.state !== 'alive') return;
    p.stats.hits++;
    p.hp -= 1;
    p.reviving = null;
    if (p.hp <= 0) {
      p.state = 'downed'; p.bleed = this.D.bleed; p.hp = 0;
      this.announce(`${p.name} is down! Reach them and hold your ground — press E to revive.`, 'bad');
    }
    this.emit({ e: 'hit', id: p.id });
    this.emit({ e: 'pstate', id: p.id, state: p.state, hp: p.hp, bleed: p.bleed });
    this.checkEnd();
  }
  revive(t, hp, by) {
    by.stats.revives++;
    t.state = 'alive'; t.hp = hp; t.bleed = 0;
    this.emit({ e: 'pstate', id: t.id, state: 'alive', hp });
    this.announce(`${by.name} got ${t.name} back on their feet.`, 'good');
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
    const p = this.players.get(pid);
    if (!p) return;
    for (const it of p.inv) if (it) this.dropItem(p, it); // never lose objective items to a disconnect
    this.players.delete(pid);
    this.emit({ e: 'pleave', id: pid });
    this.announce(`${p.name} disconnected.`, 'bad');
    this.checkEnd();
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
      win, time: Math.round(this.time), stage: this.stage(), obj: this.obj, difficulty: this.difficulty,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, state: p.state, t: p.escapedAt || null, stats: p.stats })),
    };
    this.onEnd(summary);
  }

  // ---------- simulation ----------
  tick(dt) {
    if (this.over) return;
    this.time += dt;

    while (this.pending.length && this.pending[0].t <= this.time) this.pending.shift().fn();

    const ez = MAP.escapeZone;
    for (const p of this.players.values()) {
      if (p.state === 'alive') {
        // footsteps the monster can hear (bit0 crouch, bit2 sprint, bit3 moving)
        if (p.hidden < 0 && p.flags & 8) {
          p.stepT -= dt;
          if (p.stepT <= 0) {
            p.stepT = 0.5;
            const r = p.flags & 1 ? 1.3 : p.flags & 4 ? 13 : 5;
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
            if (p.reviving.t >= REVIVE_TIME) { p.reviving = null; this.emit({ e: 'revive', by: p.id, target: t.id, on: 0 }); this.revive(t, 1, p); }
          }
        }
      } else if (p.state === 'downed') {
        p.bleed -= dt;
        if (p.bleed <= 0) { this.kill(p, 'bled out'); this.checkEnd(); if (this.over) return; }
      }
    }

    this.monster.tick(dt);

    // randomised paranormal events (purely atmospheric, except falling objects make real noise)
    this.paraT -= dt;
    if (this.paraT <= 0) { this.paraT = rand(22, 50) - this.stage() * 2; this.paranormal(); }
    for (const p of this.players.values()) if (this.time - p.lastT > 0.4) { p.vx *= 0.8; p.vz *= 0.8; } // stale velocity decays

    const snap = { t: Math.round(this.time * 1000), p: [], m: this.monster.snap() };
    for (const p of this.players.values()) {
      if ((p.state === 'alive' || p.state === 'downed') && p.hidden < 0) snap.p.push([p.id, r2(p.x), r2(p.y), r2(p.z), r2(p.ry), r2(p.rx), p.flags, p.inv[p.sel] ? ITEM_TYPES.indexOf(p.inv[p.sel].type) : 0]);
    }
    this.send('g:snap', snap);
  }

  paranormal() {
    const alive = [...this.players.values()].filter((p) => p.state === 'alive');
    if (!alive.length) return;
    const p = pick(alive);
    // Rarely, the school plays a trick on ONE player: a jumpscare with nothing actually there.
    // Never when he is genuinely close (that would muddle the real warning signs), never twice in quick succession.
    if (this.time > 60 && Math.random() < 0.14) {
      const m = this.monster;
      const marks = alive.filter((q) => q.hidden < 0 && this.time - (q.jumpT ?? -999) > 150 && dist(q.x, q.z, m.x, m.z) > 18);
      if (marks.length) { const q = pick(marks); q.jumpT = this.time; this.emitTo(q, { e: 'para', type: 'jump' }); return; }
    }
    const type = pick(['flicker', 'slam', 'whisper', 'scream', 'fall', 'thunder', 'thunder', 'steps', 'knock', 'shadow', 'clang']);
    const around = (min, max) => {
      for (let i = 0; i < 12; i++) {
        const a = rand(0, Math.PI * 2), d = rand(min, max);
        const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
        const cx = Math.floor(x), cz = Math.floor(z);
        if (inBounds(cx, cz) && MAP.grid[idx(cx, cz)] === 1 && !MAP.blocked[idx(cx, cz)]) return [r2(x), r2(floorY(x, z)), r2(z)];
      }
      return [r2(p.x), r2(p.y), r2(p.z)];
    };
    if (type === 'slam') {
      // an open door near the players slams shut on its own
      const d = this.doors.find((d) => d.open && d.kind === 'door' && dist(d.x, d.z, p.x, p.z) < 18 && dist(d.x, d.z, p.x, p.z) > 2.5
        && ![...this.players.values()].some((q) => dist(q.x, q.z, d.x + 0.5, d.z + 0.5) < 1.2) && dist(this.monster.x, this.monster.z, d.x + 0.5, d.z + 0.5) > 1.5);
      if (d) { d.open = false; this.emit({ e: 'door', id: d.id, open: 0, locked: 0, by: 'ghost' }); return; }
      return this.emit({ e: 'para', type: 'knock', p: around(5, 12) });
    }
    if (type === 'fall') {
      const pos = around(5, 10);
      this.emit({ e: 'para', type, p: pos });
      this.noise(pos[0], pos[2], 11);
      return;
    }
    if (type === 'shadow') return this.emitTo(p, { e: 'para', type, p: around(8, 14) });
    this.emit({ e: 'para', type, p: type === 'scream' || type === 'steps' || type === 'clang' ? around(14, 26) : around(3, 8) });
  }
}

function pubItem(it) { return { id: it.id, type: it.type, x: it.x, y: it.y, z: it.z }; }
export { W, lineOfSight };
