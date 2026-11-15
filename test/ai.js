// Headless simulation of the Headmaster AI (no network): runs the real Game
// class at accelerated speed and checks every state of the state machine fires.
import { Game } from '../server/game.js';
import { MAP } from '../client/shared/map.js';

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('  ok  -', m); };
function mk(n = 1, difficulty = 'intermediate') {
  const evs = [];
  const g = new Game({ difficulty, players: Array.from({ length: n }, (_, i) => ({ pid: i + 1, name: 'P' + (i + 1) })), send: (e, d) => e === 'g:ev' && evs.push(d), sendTo: (_p, e, d) => e === 'g:ev' && evs.push(d), onEnd: (s) => (g.summary = s) });
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
  run(g, 3000);
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
console.log('DIFFICULTY');
{
  const hits = {}, speeds = {};
  for (const d of ['beginner', 'intermediate', 'hard', 'nightmare']) {
    const { g } = mk(2, d);
    const p = g.players.get(1), q = g.players.get(2), m = g.monster; q.x = 2; q.z = 22; q.hidden = 1;
    let n = 0; while (p.state === 'alive' && n < 9) { g.hitPlayer(p); n++; }
    hits[d] = n;
    // chase speed: target far down the main hall, measure ground covered in 2 s
    const { g: g2 } = mk(1, d); const p2 = g2.players.get(1), m2 = g2.monster;
    m2.x = 10.5; m2.z = 22.5; m2.ry = Math.PI / 2; m2.timer = 99; p2.x = 44.5; p2.z = 22.5; p2.flags = 2;
    m2.startChase(p2); const x0 = m2.x; run(g2, 2); speeds[d] = (m2.x - x0) / 2;
  }
  assert(hits.beginner === 3 && hits.intermediate === 2 && hits.hard === 2 && hits.nightmare === 1, `hits before going down: ${JSON.stringify(hits)}`);
  assert(speeds.beginner < speeds.intermediate && speeds.intermediate < speeds.hard && speeds.hard < speeds.nightmare, `chase speed m/s: ${Object.entries(speeds).map(([k, v]) => k + ' ' + v.toFixed(2)).join(', ')}`);
  assert(speeds.beginner < 4.2 && speeds.nightmare > 5.0, 'beginner is clearly slower than a sprinting player (5.3), nightmare nearly matches it from the start');
}
console.log('SMARTER BEHAVIOUR');
{
  // bottle: beginner walks to the smash, nightmare walks to the thrower
  const dest = {};
  for (const d of ['beginner', 'nightmare']) {
    const { g } = mk(1, d); const p = g.players.get(1), m = g.monster; p.x = 2; p.z = 22; p.hidden = 0;
    m.x = 30.5; m.z = 22.5; m.path = []; m.timer = 99;
    g.noise(40.5, 22.5, 26, null, { kind: 'bottle', origin: { x: 20.5, z: 22.5 } });
    dest[d] = m.noiseTarget ? m.noiseTarget.x : null;
  }
  assert(dest.beginner > 39 && dest.nightmare < 22, `thrown bottle: beginner investigates the smash (x=${dest.beginner}), nightmare goes for the thrower (x=${dest.nightmare})`);
  // prediction: player runs east out of sight; smart AI searches ahead of the last seen point
  const { g } = mk(1, 'hard'); const m = g.monster;
  const guess = m.project(20.5, 22.5, 5, 0, 2.2);
  assert(guess.x > 28 && Math.abs(guess.z - 22.5) < 0.1, `predicts where a fleeing player is heading (${guess.x.toFixed(1)}, ${guess.z.toFixed(1)})`);
  const wall = m.project(20.5, 22.5, 0, -5, 5);
  assert(wall.z >= 21, `prediction stops at walls (z=${wall.z.toFixed(1)})`);
  // looking under tables: player crouched under a cafeteria table, Headmaster 2 m away with his back turned
  const under = {};
  for (const d of ['beginner', 'hard']) {
    const { g, evs } = mk(1, d); const p = g.players.get(1), mm = g.monster;
    p.x = 20.5; p.z = 30.5; p.flags = 1; mm.x = 20.5; mm.z = 28.5; mm.ry = Math.PI; mm.path = [];
    mm.startSearch(20.5, 28.5); mm.timer = 20;
    mm.checkingCover = d === 'hard'; // what the Hard AI sets when it walks up to a table (never set below smart 2)
    run(g, 0.3);
    under[d] = states(evs).includes('chase');
  }
  assert(!under.beginner && under.hard, 'a player under a table is safe from a Beginner Headmaster standing beside it, but Hard bends down and looks');
  // objective awareness
  const { g: g3 } = mk(1, 'intermediate'); g3.obj.power = true;
  const hs = g3.monster.hotspot();
  assert(hs && Math.abs(hs.x - 54) < 2, 'knows the Security Office matters once the power is on');
  // guarding a downed player
  let guarded = 0;
  for (let i = 0; i < 10; i++) {
    const { g, evs } = mk(2, 'nightmare'); const a = g.players.get(1), b = g.players.get(2), mm = g.monster;
    b.x = 2; b.z = 22; b.hidden = 0; a.x = 30.5; a.z = 22.5; mm.x = 31.5; mm.z = 22.5;
    g.hitPlayer(a); mm.afterHit(); run(g, 14);
    if (states(evs).includes('investigate') && Math.hypot(mm.x - a.x, mm.z - a.z) < 12) guarded++;
  }
  assert(guarded >= 6, `comes back to guard a downed player on Nightmare (${guarded}/10 runs)`);
}
console.log(process.exitCode ? '\nSOME AI TESTS FAILED' : '\nALL AI TESTS PASSED');
