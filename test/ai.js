// Headless simulation of the Headmaster AI (no network): runs the real Game
// class at accelerated speed and checks every state of the state machine fires.
import { Game } from '../server/game.js';
import { MAP } from '../client/shared/map.js';

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('  ok  -', m); };
function mk(n = 1) {
  const evs = [];
  const g = new Game({ players: Array.from({ length: n }, (_, i) => ({ pid: i + 1, name: 'P' + (i + 1) })), send: (e, d) => e === 'g:ev' && evs.push(d), sendTo: (_p, e, d) => e === 'g:ev' && evs.push(d), onEnd: (s) => (g.summary = s) });
  g.monster.grace = 0;
  return { g, evs };
}
const run = (g, secs, each) => { for (let t = 0; t < secs * 15 && !g.over; t++) { each && each(t / 15); g.tick(1 / 15); } };
const states = (evs) => evs.filter((e) => e.e === 'mstate').map((e) => ['patrol', 'investigate', 'search', 'chase', 'attack', 'retreat', 'stalk'][e.s]);

console.log('PATROL');
{
  const { g } = mk();
  const p = g.players.get(1); p.x = 2; p.z = 22; p.hidden = 0; // out of the way
  const rooms = new Set(); let moved = 0, lx = g.monster.x, lz = g.monster.z, doorsOpened = 0;
  const send = g.send; g.send = (e, d) => { if (e === 'g:ev' && d.e === 'door' && d.by === 'monster') doorsOpened++; send(e, d); };
  run(g, 600, () => { moved += Math.hypot(g.monster.x - lx, g.monster.z - lz); lx = g.monster.x; lz = g.monster.z; rooms.add(MAP.roomOf[Math.floor(lz) * 63 + Math.floor(lx)]); });
  assert(moved > 300, `patrols the school (walked ${moved.toFixed(0)} m in 10 min)`);
  assert(rooms.size >= 8, `visits many areas unpredictably (${rooms.size} distinct rooms/corridors)`);
  assert(doorsOpened > 0, `opens closed doors on its route (${doorsOpened})`);
}
console.log('CHASE / ATTACK / RETREAT');
{
  const { g, evs } = mk();
  const p = g.players.get(1);
  p.x = 38.5; p.z = 30.5; p.flags = 2; p.lastT = 0; // standing in the gym with the torch on, right next to it
  run(g, 40);
  const st = states(evs);
  assert(st.includes('chase'), 'spots a player and chases');
  assert(st.includes('attack'), 'attacks when in reach');
  assert(st.includes('retreat'), 'retreats after landing a hit');
  assert(evs.some((e) => e.e === 'hit'), 'hit is server-authoritative (hit event broadcast)');
  run(g, 900);
  assert(g.over && g.summary && g.summary.win === false, `a lone player who never moves is eventually caught -> defeat (t=${g.summary?.time}s)`);
}
console.log('NOISE -> INVESTIGATE -> SEARCH');
{
  const { g, evs } = mk();
  const p = g.players.get(1); p.x = 2; p.z = 22; p.hidden = 0;
  g.noise(40.5, 22.5, 26); // bottle smash in the main hall
  const st0 = states(evs);
  assert(st0.includes('investigate'), 'a loud noise sends it to investigate');
  run(g, 25);
  const st = states(evs);
  assert(st.includes('search'), 'searches the area after arriving');
  run(g, 40);
  assert(states(evs).lastIndexOf('patrol') > st.lastIndexOf('search'), 'gives up and returns to patrol');
}
console.log('HIDING');
{
  const { g, evs } = mk();
  const p = g.players.get(1);
  // crouched under a cafeteria table in the dark vs standing in the open, monster walks past at 6 m
  const m = g.monster; m.x = 24.5; m.z = 36.5; m.path = []; m.ry = Math.PI; m.timer = 99;
  p.x = 20.5; p.z = 33.5; p.flags = 1;
  run(g, 6);
  assert(!states(evs).includes('chase'), 'crouching under a table in the dark is not detected at 5 m');
  p.flags = 2; m.ry = Math.atan2(p.x - m.x, p.z - m.z);
  run(g, 3);
  assert(states(evs).includes('chase'), 'standing up with the flashlight on is detected');
}
{
  const { g, evs } = mk(2);
  const p = g.players.get(1), q = g.players.get(2); q.x = 2; q.z = 22; q.hidden = 1;
  const m = g.monster; m.x = 20.5; m.z = 22.5; m.path = []; m.ry = -Math.PI / 2; m.timer = 99;
  p.x = 12.5; p.z = 22.5; p.flags = 2;
  run(g, 1.2);
  assert(m.state === 'chase', 'chasing a visible player');
  g.onInteract(1, { k: 'locker', id: 2 }); // dives into a locker in plain view
  run(g, 12);
  assert(evs.some((e) => e.e === 'hide' && e.pulled), 'if it watches you climb into a locker, it drags you out');
}
console.log('BELL');
{
  const { g, evs } = mk();
  const p = g.players.get(1); const m = g.monster;
  m.x = 20.5; m.z = 22.5; p.x = 12.5; p.z = 22.5; p.flags = 2; m.ry = -Math.PI / 2; m.timer = 99;
  run(g, 1.2);
  p.inv[0] = { id: 999, type: 'bell' };
  g.onUse(1, { slot: 0 });
  assert(m.state === 'retreat', 'ringing the hand bell forces a retreat');
  const d0 = Math.hypot(m.x - p.x, m.z - p.z); run(g, 5);
  assert(Math.hypot(m.x - p.x, m.z - p.z) > d0 + 8, 'it actually flees');
}
console.log('AGGRESSION');
{
  const { g } = mk();
  const a0 = g.monster.aggr; g.obj.power = true; g.obj.fusesFound = 3; g.obj.officeOpen = true;
  assert(g.monster.aggr === a0 + 3, `aggression scales with completed objectives (${a0} -> ${g.monster.aggr})`);
}
console.log(process.exitCode ? '\nSOME AI TESTS FAILED' : '\nALL AI TESTS PASSED');
