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
console.log('NO DODGING BY WALKING AWAY');
{
  // He used to stop dead for the swing's wind-up, so a player walking (even backwards) away was
  // always out of reach by the time it landed. He now keeps lunging during the wind-up.
  const caught = (diff, speed, flags) => {
    const { g } = mk(1, diff); const m = g.monster, p = g.players.get(1);
    m.x = 18.5; m.z = 22.5; m.ry = Math.PI / 2; p.x = 22.5; p.z = 22.5; p.flags = flags; p.lastT = 0;
    m.startChase(p);
    for (let t = 0; t < 7 * 15; t++) { p.x = Math.min(46.3, p.x + speed / 15); p.lastT = g.time; g.tick(1 / 15); if (p.hp < g.maxHp || p.state !== 'alive') return p.x < 46.2; }
    return false;
  };
  for (const d of ['beginner', 'nightmare']) {
    assert(caught(d, 2.75 * 0.7, 8), `${d}: walking backwards away from him gets you hit`);
    assert(caught(d, 2.75, 8), `${d}: walking away from him gets you hit`);
  }
  assert(!caught('beginner', 5.3, 8 | 4), 'beginner: sprinting still gets away from him');
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
console.log('HOLDING YOUR BREATH (lockers)');
{
  const trial = (flags, watched) => {
    const { g } = mk(1, 'intermediate'); const p = g.players.get(1), m = g.monster, L = MAP.lockers[3];
    p.hidden = 3; p.flags = flags; p.x = L.x + 0.5; p.z = L.z + 0.5;
    m.x = L.x + L.dx + 0.5; m.z = L.z + L.dz + 0.5; m.path = []; m.startSearch(m.x, m.z); m.timer = 30;
    if (watched) m.sawHide = 1;
    m.inspect = { id: 3, t: 0.05 }; m.inspected.add(3);
    run(g, 0.2);
    return p.hidden === 3;
  };
  let held = 0, notHeld = 0, watched = 0;
  for (let i = 0; i < 60; i++) { if (trial(16, false)) held++; if (trial(0, false)) notHeld++; if (trial(16, true)) watched++; }
  assert(held > 25 && held < 58, `holding your breath often makes him walk past the locker (${held}/60 on Intermediate)`);
  assert(notHeld === 0, 'breathing normally in a locker he checks: always found');
  assert(watched === 0, 'if he watched you climb in, holding your breath does not help');
}
console.log('SEAT ROWS');
{
  const { g, evs } = mk(1); const p = g.players.get(1), m = g.monster;
  m.x = 24.5; m.z = 50.5; m.ry = Math.PI; m.path = []; m.timer = 99; // in front of the stage, facing the seats
  p.x = 20.5; p.z = 45.5; p.flags = 1; // crouched between two rows, ~6 m away
  run(g, 4);
  assert(!states(evs).includes('chase'), 'crouching between the auditorium seat rows hides you at 6 m');
  p.flags = 2; run(g, 3);
  assert(states(evs).includes('chase'), '...standing up with the torch on does not');
}
console.log('LURES');
{
  const { g, evs } = mk(1); const p = g.players.get(1), m = g.monster;
  m.x = 30.5; m.z = 39.5; m.path = []; m.timer = 99; m.ry = 0;
  const P = MAP.lures.find((l) => l.kind === 'piano'); p.x = P.x; p.z = P.z - 1.3; p.y = 0; p.hidden = -1;
  g.onInteract(1, { k: 'lure', id: P.id });
  assert(evs.some((e) => e.e === 'lure' && e.id === P.id), 'playing the piano makes a sound everyone hears');
  p.x = 2; p.z = 22; p.hidden = 0; // and you get out of there
  run(g, 0.3);
  assert(m.state === 'investigate' && Math.hypot(m.noiseTarget.x - P.x, m.noiseTarget.z - P.z) < 2, 'he goes to see who is playing');
  evs.length = 0; p.hidden = -1; p.x = P.x; p.z = P.z - 1.3; g.onInteract(1, { k: 'lure', id: P.id });
  assert(!evs.some((e) => e.e === 'lure') && evs.some((e) => e.e === 'msg' && /Not yet/.test(e.text)), 'the piano has a cooldown');
  const B = MAP.lures.find((l) => l.kind === 'greatbell');
  p.x = B.x + 1.5; p.z = B.z - 1.2; p.y = 0.3; evs.length = 0;
  g.onInteract(1, { k: 'lure', id: B.id }); const first = evs.some((e) => e.e === 'lure');
  g.time += 999; evs.length = 0; g.onInteract(1, { k: 'lure', id: B.id });
  assert(first && !evs.some((e) => e.e === 'lure'), 'the great bell rings once per match, never again');
  const R = MAP.lures.find((l) => l.kind === 'radio');
  const { g: g2, evs: e2 } = mk(1); const p2 = g2.players.get(1), m2 = g2.monster;
  m2.x = 14.5; m2.z = 40.5; m2.path = []; m2.timer = 99;
  p2.x = R.x - 1.2; p2.z = R.z + 0.5; g2.onInteract(1, { k: 'lure', id: R.id }); p2.x = 2; p2.z = 22; p2.hidden = 0;
  run(g2, R.delay - 1);
  assert(m2.state !== 'investigate', `the radio stays quiet for ${R.delay} s, so you can get away`);
  run(g2, 2);
  assert(m2.state === 'investigate' && e2.some((e) => e.e === 'lure'), '...then it blares and he comes for it');
}
console.log('DROPPING AND TOSSING');
{
  const { g, evs } = mk(1); const p = g.players.get(1);
  p.x = 20.5; p.z = 22.5; p.y = 0; p.ry = -Math.PI / 2; p.hidden = -1; p.inv[0] = { id: 900, type: 'battery' }; p.inv[1] = { id: 901, type: 'fuse' };
  g.onDrop(1, 0);
  const d = evs.find((e) => e.e === 'item+' && e.item.id === 900);
  assert(d && d.from && Math.abs(d.item.x - 21.1) < 0.3 && !p.inv[0], 'tapping G drops the item just in front of you (animated from your hand)');
  g.onDrop(1, { slot: 1, toss: 1, ry: -Math.PI / 2 });
  const t = evs.find((e) => e.e === 'item+' && e.item.id === 901);
  assert(t && t.toss && t.item.x > 24 && t.item.x < 25.3, `holding G tosses it ~4.5 m ahead (landed at x=${t && t.item.x})`);
  p.inv[2] = { id: 902, type: 'bottle' }; p.x = 20.5; p.z = 21.5; g.onDrop(1, { slot: 2, toss: 1, ry: 0 }); // straight at the wall
  const w = evs.find((e) => e.e === 'item+' && e.item.id === 902);
  assert(w && w.item.z > 21 && w.item.z < 21.6, 'a toss never goes through a wall');
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
