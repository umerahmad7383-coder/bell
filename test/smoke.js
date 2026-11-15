// End-to-end network test: boots the real server, connects three real Socket.IO
// clients, and plays a whole match (lobby -> fuses -> power -> office -> gate key
// -> security -> gate -> escape -> rematch). Run with:  npm test
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { MAP, findPath, idx } from '../client/shared/map.js';

const PORT = 3999;
const URL = process.env.TEST_URL || `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; throw new Error(m); } console.log('  ok  -', m); };

let child = null;
process.on('uncaughtException', (err) => { console.error('FAIL (crash):', err); if (child) child.kill(); process.exit(1); });
if (!process.env.TEST_URL) {
  child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), MONSTER_GRACE: '900' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => child.stdout.on('data', (d) => String(d).includes('listening') && res()));
}

class Bot {
  constructor(name) {
    this.name = name; this.s = io(URL, { transports: ['websocket'] });
    this.items = new Map(); this.doors = []; this.inv = []; this.msgs = []; this.obj = null; this.lobby = null;
    this.snaps = 0; this.over = null; this.states = new Map();
    this.s.on('lobby:update', (l) => (this.lobby = l));
    this.s.on('game:start', (g) => {
      this.g = g; this.id = g.you; this.over = null;
      const me = g.players.find((p) => p.id === g.you) || { x: g.monster[0], y: 0, z: g.monster[1] }; // in Hunt mode the Headmaster is not in the survivor list
      this.x = me.x; this.y = me.y; this.z = me.z;
      this.items = new Map(g.items.map((i) => [i.id, i]));
      this.doors = g.doors.map(([open, locked]) => ({ open: !!open, locked: !!locked }));
      this.obj = g.obj;
    });
    this.s.on('g:snap', (sn) => { this.snaps++; this.lastSnap = sn; });
    this.s.on('g:correct', (p) => { this.corrected = (this.corrected || 0) + 1; [this.x, this.y, this.z] = p; });
    this.s.on('game:over', (sum) => (this.over = sum));
    this.s.on('g:ev', (e) => {
      if (e.e === 'door') { this.doors[e.id].open = !!e.open; this.doors[e.id].locked = !!e.locked; }
      else if (e.e === 'item-') this.items.delete(e.id);
      else if (e.e === 'item+') this.items.set(e.item.id, e.item);
      else if (e.e === 'inv') this.inv = e.inv;
      else if (e.e === 'obj') this.obj = e.obj;
      else if (e.e === 'msg') this.msgs.push(e.text);
      else if (e.e === 'pstate') this.states.set(e.id, e.state);
      else if (e.e === 'ping') (this.pings ||= []).push(e);
    });
  }
  call(ev, data) { return new Promise((res) => this.s.emit(ev, data, res)); }
  send() { this.s.emit('g:state', [this.x, this.y, this.z, 0, 0, 0]); }
  cost = (c) => { const d = MAP.doorAt[c]; return d >= 0 && this.doors[d].locked && !this.doors[d].open ? -1 : 0; };
  /** walk (quickly, but within the server's speed limit) to a cell next to the target */
  async goto(tx, tz, stopDist = 1.2) {
    const path = findPath(this.x, this.z, tx, tz, this.cost);
    if (!path) throw new Error(`${this.name}: no path to ${tx},${tz}`);
    for (const n of path) {
      if (Math.hypot(this.x - tx, this.z - tz) <= stopDist) break;
      const di = MAP.doorAt[idx(Math.floor(n.x), Math.floor(n.z))];
      if (di >= 0 && !this.doors[di].open) {
        this.s.emit('g:interact', { k: 'door', id: di });
        for (let i = 0; i < 50 && !this.doors[di].open; i++) await sleep(10);
        if (!this.doors[di].open) throw new Error(`${this.name}: door ${di} would not open`);
      }
      // step in two halves to stay under the per-message movement cap
      const mx = (this.x + n.x) / 2, mz = (this.z + n.z) / 2;
      this.x = mx; this.z = mz; this.y = yAt(mx, mz); this.send(); await sleep(22);
      this.x = n.x; this.z = n.z; this.y = yAt(n.x, n.z); this.send(); await sleep(22);
    }
  }
  async pickup(type) {
    const it = [...this.items.values()].find((i) => i.type === type);
    if (!it) throw new Error(`no ${type} left in the world`);
    await this.goto(it.x, it.z, 1.6);
    this.s.emit('g:interact', { k: 'item', id: it.id });
    for (let i = 0; i < 50 && this.items.has(it.id); i++) await sleep(10);
    if (this.items.has(it.id)) throw new Error(`${this.name}: could not pick up ${type} at ${it.x},${it.z} (me ${this.x},${this.z})`);
  }
}
import { floorY } from '../client/shared/map.js';
const yAt = (x, z) => floorY(x, z);

try {
  console.log('LOBBY');
  const a = new Bot('Ana'), b = new Bot('Ben'), c = new Bot('Cy');
  await sleep(300);
  const created = await a.call('lobby:create', { name: 'Ana', look: { top: 3, hair: 1, build: 99, skin: 'x' } });
  assert(created.ok && /^[A-Z2-9]{6}$/.test(created.code), `host created lobby with 6-char code ${created.code}`);
  const bad = await b.call('lobby:join', { code: 'ZZZZZZ', name: 'Ben' });
  assert(!bad.ok, 'joining a wrong code is rejected');
  assert((await b.call('lobby:join', { code: created.code.toLowerCase(), name: 'Ben' })).ok, 'second player joined by code (case-insensitive)');
  assert((await c.call('lobby:join', { code: created.code, name: 'Ben' })).ok, 'third player joined');
  await sleep(150);
  assert(a.lobby.players.length === 3 && b.lobby.players.length === 3, 'all clients see 3 players in the lobby');
  assert(new Set(a.lobby.players.map((p) => p.name)).size === 3, `duplicate names are made unique (${a.lobby.players.map((p) => p.name).join(', ')})`);
  const anaLook = a.lobby.players[0].look;
  assert(anaLook.top === 3 && anaLook.hair === 1 && anaLook.build === 0 && anaLook.skin === 0, 'character look is stored, and invalid values are sanitised by the server');
  b.s.emit('lobby:difficulty', 'nightmare'); await sleep(100);
  assert(a.lobby.difficulty === 'intermediate', 'a guest cannot change the difficulty');
  a.s.emit('lobby:difficulty', 'beginner'); await sleep(100);
  assert(b.lobby.difficulty === 'beginner', 'the host can, and everyone sees it');
  assert(!(await b.call('lobby:start')).ok, 'non-host cannot start');
  assert(!(await a.call('lobby:start')).ok, 'host cannot start until everyone is ready');
  b.s.emit('lobby:ready', true); c.s.emit('lobby:ready', true);
  await sleep(100);
  assert((await a.call('lobby:start')).ok, 'host started the match');
  await sleep(300);
  assert(a.g && b.g && c.g, 'every client received game:start');
  assert(a.g.items.length === b.g.items.length && a.g.items.length > 15, `item list is synchronised (${a.g.items.length} items)`);
  assert(a.g.items.filter((i) => i.type === 'fuse').length === 3, 'three fuses spawned');
  assert(b.g.difficulty === 'beginner' && b.g.maxHp === 3 && b.g.players.find((p) => p.id === a.id).look.top === 3, 'match starts on the chosen difficulty (3 hits on Beginner) with every player\'s look');

  console.log('SYNC');
  await sleep(400);
  assert(a.snaps > 3 && b.snaps > 3, 'snapshots are streaming to all clients');
  await a.goto(12.5, 22.5, 0.3);
  await sleep(200);
  const seenByB = b.lastSnap.p.find((p) => p[0] === a.id);
  assert(seenByB && Math.abs(seenByB[1] - a.x) < 0.6 && Math.abs(seenByB[3] - a.z) < 0.6, `Ben sees Ana's movement (${seenByB?.[1]}, ${seenByB?.[3]})`);
  // cheating check: teleport across the map must be rejected
  const before = { x: a.x, z: a.z };
  a.s.emit('g:state', [40.5, 0, 22.5, 0, 0, 0]);
  await sleep(150);
  assert(a.corrected >= 1 && Math.abs(a.x - before.x) < 0.01, 'server rejects teleporting (authoritative correction)');
  // door sync
  await a.goto(14.5, 14.5, 0.3);
  a.s.emit('g:interact', { k: 'door', id: MAP.doorAt[idx(13, 14)] });
  await sleep(120);
  assert(b.doors[MAP.doorAt[idx(13, 14)]].open && c.doors[MAP.doorAt[idx(13, 14)]].open, 'a door opened by Ana is open for everyone');

  // pings
  a.s.emit('g:ping', { x: a.x + 3, y: 1, z: a.z }); a.s.emit('g:ping', { x: a.x + 4, y: 1, z: a.z }); await sleep(150);
  assert(b.pings && b.pings.length === 1 && b.pings[0].by === a.id, 'a ping reaches teammates, and spamming is rate-limited');
  a.s.emit('g:ping', { x: 9999, y: 0, z: 0 }); await sleep(1400); a.s.emit('g:ping', { x: 9999, y: 0, z: 0 }); await sleep(150);
  assert(b.pings.length === 1, 'a ping far outside the map is rejected');

  console.log('OBJECTIVES');
  // pick-up race: two players grab the same item, only one may get it
  const fuse0 = [...a.items.values()].find((i) => i.type === 'fuse');
  await a.goto(fuse0.x, fuse0.z, 1.5); await b.goto(fuse0.x, fuse0.z, 1.5);
  a.s.emit('g:interact', { k: 'item', id: fuse0.id }); b.s.emit('g:interact', { k: 'item', id: fuse0.id });
  await sleep(200);
  const holders = [a, b].filter((bot) => bot.inv.some((s) => s && s.type === 'fuse')).length;
  assert(holders === 1, 'two players grabbing the same fuse: exactly one gets it');
  const carrier = a.inv.some((s) => s && s.type === 'fuse') ? a : b;
  const other = carrier === a ? b : a;
  await carrier.pickup('fuse'); await carrier.pickup('fuse');
  assert(carrier.inv.filter((s) => s && s.type === 'fuse').length === 3, 'carrier holds 3 fuses');
  carrier.send(); await sleep(200);
  assert(other.lastSnap.p.find((p) => p[0] === carrier.id)[7] === 1, 'other players are told what the carrier is holding (so they can see it in their hand)');
  // drop & share
  carrier.s.emit('g:drop', carrier.inv.findIndex((s) => s && s.type === 'fuse'));
  await sleep(150);
  assert([...other.items.values()].some((i) => i.type === 'fuse'), 'dropped fuse reappears in the world for other players');
  await carrier.pickup('fuse');

  // locked office
  const office = MAP.doors.find((d) => d.lock === 'principal');
  await other.goto(47.5, 15.5, 0.3);
  other.s.emit('g:interact', { k: 'door', id: office.id });
  await sleep(120);
  assert(!other.doors[office.id].open, "Principal's office stays locked without the key");
  const gateId = MAP.gate.id;
  await c.goto(6.5, 22.5, 0.3);
  c.s.emit('g:interact', { k: 'door', id: gateId });
  await sleep(120);
  assert(!c.doors[gateId].open, 'gate refuses to open before the objectives are done');

  await carrier.goto(MAP.fuseBox.cellX + 0.5, MAP.fuseBox.cellZ + 0.5, 1.0);
  assert(carrier.y < -2.5, `carrier walked down the stairs into the basement (y=${carrier.y})`);
  for (let i = 0; i < 3; i++) { carrier.s.emit('g:interact', { k: 'fusebox' }); await sleep(120); }
  assert(carrier.obj.power && c.obj.power, 'three fuses restore power for everyone');

  await other.pickup('key_principal');
  await other.goto(47.5, 15.5, 0.3);
  other.s.emit('g:interact', { k: 'door', id: office.id });
  await sleep(150);
  assert(other.doors[office.id].open && other.obj.officeOpen, "key opens the Principal's office");
  await other.pickup('key_gate');
  assert(other.obj.gateKey, 'gate key taken');
  await other.goto(MAP.securityConsole.cellX + 0.5, MAP.securityConsole.cellZ + 0.5, 0.8);
  other.s.emit('g:interact', { k: 'console' });
  await sleep(150);
  assert(other.obj.security, 'security console disarms the gate lock');

  console.log('ESCAPE');
  await other.goto(6.5, 22.5, 0.4);
  other.s.emit('g:interact', { k: 'door', id: gateId });
  await sleep(200);
  assert(a.doors[gateId].open && a.obj.gateOpen, 'gate opens with power + security + key');
  await Promise.all([other.goto(2.5, 22.5, 0.2), c.goto(2.5, 22.5, 0.2)]);
  await sleep(400);
  assert(a.states.get(other.id) === 'escaped' && a.states.get(c.id) === 'escaped', 'two players escaped through the gate');
  assert(!a.over, 'match continues while a player is still inside');
  // the last player leaves the game by disconnecting -> match must end gracefully as a win
  carrier.s.disconnect();
  await sleep(500);
  assert(other.over && other.over.win === true, 'disconnect handled: match ends, summary says the survivors won');
  assert(other.over.players.filter((p) => p.state === 'escaped').length === 2, 'summary lists who survived');
  assert(other.over.players.every((p) => p.stats && typeof p.stats.hits === 'number'), 'summary includes per-player stats');
  await sleep(100);
  assert(other.lobby.players.length === 2 && other.lobby.state === 'ended', 'lobby survives the disconnect with 2 players');

  console.log('REMATCH');
  const host = [other, c].find((bot) => bot.id === other.lobby.hostId);
  const guest = host === other ? c : other;
  assert(!!host, 'host role migrated to a remaining player');
  host.s.emit('lobby:return'); await sleep(150);
  assert(guest.lobby.state === 'lobby' && guest.lobby.code === created.code, 'rematch returns everyone to the same lobby code');
  guest.s.emit('lobby:ready', true); await sleep(100);
  const firstItems = JSON.stringify(a.g.items.filter((i) => i.type === 'fuse').map((i) => [i.x, i.z]));
  assert((await host.call('lobby:start')).ok, 'second match starts in the same lobby');
  await sleep(300);
  const secondItems = JSON.stringify(host.g.items.filter((i) => i.type === 'fuse').map((i) => [i.x, i.z]));
  assert(firstItems !== secondItems, 'item locations are re-randomised for the rematch');
  other.s.disconnect(); c.s.disconnect();

  console.log('VOICE SIGNALLING + HUNT MODE');
  const d = new Bot('Dee'), e = new Bot('Eli'), f = new Bot('Fay');
  await sleep(300);
  const lob = await d.call('lobby:create', { name: 'Dee' });
  await e.call('lobby:join', { code: lob.code, name: 'Eli' }); await f.call('lobby:join', { code: lob.code, name: 'Fay' });
  const vj = await d.call('voice:join', null); const vj2 = await e.call('voice:join', null);
  assert(vj.ok && Array.isArray(vj.ice) && vj.ice.length >= 1 && vj.peers.length === 0 && vj2.peers.length === 1 && vj2.peers[0] === lob.you, 'voice: the server hands out connection servers and tells a newcomer who is already talking');
  let got = null, leaked = false; d.s.on('rtc', (m) => (got = m)); f.s.on('rtc', () => (leaked = true));
  e.s.emit('rtc', { to: lob.you, data: { sdp: { type: 'offer', sdp: 'test' } } }); await sleep(150);
  assert(got && got.data.sdp.type === 'offer' && !leaked, 'voice: handshakes are relayed only to the player they are addressed to');
  e.s.emit('lobby:mode', 'hunt'); await sleep(100);
  assert(d.lobby.mode === 'coop', 'a guest cannot change the game mode');
  d.s.emit('lobby:mode', 'hunt'); await sleep(100);
  assert(f.lobby.mode === 'hunt', 'the host switches the lobby to Hunt Mode');
  e.s.emit('lobby:ready', true); f.s.emit('lobby:ready', true); await sleep(100);
  assert((await d.call('lobby:start')).ok, 'Hunt match starts');
  await sleep(300);
  const bots = [d, e, f], hunters = bots.filter((b) => b.g.role === 'monster'), surv = bots.filter((b) => b.g.role === 'survivor');
  assert(hunters.length === 1 && surv.length === 2 && surv.every((b) => b.g.players.length === 2 && b.g.hunter.id === hunters[0].g.you), 'exactly one player is the Headmaster; the other two are the survivors');
  const hb = hunters[0]; let hud = null; hb.s.on('g:mhud', (h) => (hud = h)); await sleep(400);
  assert(hud && hud.grace > 10, `the Headmaster's client receives his status (frozen for ${hud && Math.ceil(hud.grace)} more seconds)`);
  surv[0].s.emit('g:mstate', [20, 22, 0, 0]); surv[0].s.emit('g:mact', { k: 'tp' }); await sleep(200);
  const m0 = surv[1].lastSnap.m;
  assert(Math.abs(m0[0] - 20) > 5, 'a survivor cannot send Headmaster commands');
  d.s.disconnect(); e.s.disconnect(); f.s.disconnect();
  console.log(process.exitCode ? '\nSOME TESTS FAILED' : '\nALL NETWORK TESTS PASSED');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  if (child) child.kill();
  setTimeout(() => process.exit(), 200);
}
