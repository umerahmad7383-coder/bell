// Hunt Mode rules, tested against the real Game with a simulated human Headmaster.
import { Game } from '../server/game.js';
import { HUNT } from '../server/hunter.js';
import { MAP, idx } from '../client/shared/map.js';

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('  ok  -', m); };
function mk(n = 3) {
  const evs = [], toHunter = [];
  const g = new Game({ mode: 'hunt', hunterPid: 1, players: Array.from({ length: n }, (_, i) => ({ pid: i + 1, name: 'P' + (i + 1) })),
    send: (e, d) => e === 'g:ev' && evs.push(d), sendTo: (pid, e, d) => { if (pid === 1) toHunter.push([e, d]); else if (e === 'g:ev') evs.push(d); }, onEnd: (s) => (g.summary = s) });
  return { g, evs, toHunter, m: g.monster };
}
const run = (g, secs, each) => { for (let t = 0; t < Math.round(secs * 15) && !g.over; t++) { each && each(); g.tick(1 / 15); } };
const place = (m, x, z, ry = 0) => { m.x = x; m.z = z; m.ry = ry; m.lastT = m.g.time; };

console.log('SETUP');
{
  const { g, m } = mk(3);
  assert(g.mode === 'hunt' && m.human && g.hunter === 1, 'one player is the Headmaster');
  assert(g.players.size === 2 && !g.players.has(1), 'he is not one of the survivors');
  assert(g.maxHp === 3 && mk(5).g.maxHp === 2, 'one or two survivors get 3 hits, bigger groups get 2');
  assert(g.initPayload(1).role === 'monster' && g.initPayload(2).role === 'survivor', 'each client is told its role');
  assert(new Game({ mode: 'hunt', hunterPid: 1, players: [{ pid: 1, name: 'solo' }], send() {}, sendTo() {}, onEnd() {} }).mode === 'coop', 'Hunt with a single player falls back to the AI');
}
console.log('MOVEMENT');
{
  const { g, m, toHunter } = mk(3);
  const x0 = m.x;
  g.tick(1 / 15); m.onMove([m.x + 0.3, m.z, 0, 0]);
  assert(m.x === x0 && toHunter.some(([e]) => e === 'g:mcorrect'), `frozen for the first ${HUNT.grace} s so survivors can scatter`);
  m.grace = 0; place(m, 20.5, 22.5);
  let walked = 0, lx = m.x;
  run(g, 2, () => { m.onMove([m.x + HUNT.walk / 15, m.z, Math.PI / 2, 0]); }); walked = m.x - lx;
  assert(Math.abs(walked - HUNT.walk * 2) < 0.6, `walks at ${HUNT.walk} m/s (covered ${walked.toFixed(1)} m in 2 s)`);
  lx = m.x; run(g, 2, () => { m.onMove([m.x + 12 / 15, m.z, Math.PI / 2, 0]); });
  assert(m.x - lx < HUNT.walk * 2 * 1.2 + 0.6, `a client claiming 12 m/s still only gets walking speed from the server (${(m.x - lx).toFixed(1)} m in 2 s)`);
  place(m, 12.5, 22.5); lx = m.x; let rageSecs = 0;
  run(g, 8, () => { m.onMove([m.x + (m.sprinting || m.rage > 0.1 ? HUNT.rage : HUNT.walk) / 15, m.z, Math.PI / 2, 1]); if (m.sprinting) rageSecs += 1 / 15; });
  assert(rageSecs > 3.3 && rageSecs < 4.8, `rage (faster than a sprinting survivor) lasts about ${HUNT.rageMax} s, then runs out (${rageSecs.toFixed(1)} s)`);
  // closed door
  const di = MAP.doorAt[idx(13, 14)]; place(m, 14.5, 14.5);
  run(g, 1, () => m.onMove([m.x - 0.2, m.z, -Math.PI / 2, 0]));
  assert(m.x > 14, 'cannot walk through a closed door');
  m.act({ k: 'door', id: di }); run(g, 0.3); assert(!g.doors[di].open, 'opening a door takes him a moment'); run(g, 0.5); assert(g.doors[di].open, '...then it opens');
}
console.log('ATTACK');
{
  const { g, m, evs } = mk(3); m.grace = 0;
  const p = g.players.get(2), q = g.players.get(3); q.x = 2; q.z = 22;
  place(m, 20.5, 22.5, Math.PI / 2); p.x = 22; p.z = 22.5;
  m.act({ k: 'attack' });
  assert(p.hp === 3 && evs.some((e) => e.e === 'mwind'), 'an attack starts with a wind-up everyone can hear');
  run(g, 0.7);
  assert(p.hp === 2 && m.attackCd > 4 && m.slowT > 2, `it lands if the survivor is still in reach; then he cannot attack for ${HUNT.hitLock} s and is slowed for ${HUNT.hitSlow} s`);
  m.act({ k: 'attack' }); run(g, 1); assert(p.hp === 2, 'no second swing during the lock-out');
  m.attackCd = 0; m.slowT = 0; p.x = 19; // behind him
  m.act({ k: 'attack' }); run(g, 0.7); assert(p.hp === 2 && m.attackCd > 1, 'a survivor behind him is missed');
  m.attackCd = 0; p.x = 22; m.act({ k: 'attack' }); p.x = 25; run(g, 0.7); assert(p.hp === 2, 'running out of reach during the wind-up dodges the hit');
  // downed players cannot be attacked again
  m.attackCd = 0; p.x = 22; p.hp = 1; m.act({ k: 'attack' }); run(g, 0.7); assert(p.state === 'downed', 'last hit puts the survivor down');
  m.attackCd = 0; m.act({ k: 'attack' }); run(g, 0.7); assert(p.state === 'downed', 'he cannot finish off a downed survivor (teammates can still revive)');
}
console.log('ABILITIES');
{
  const { g, m, evs } = mk(3); m.grace = 0; m.cd = { tp: 0, trap: 0, lights: 0 };
  const p = g.players.get(2), q = g.players.get(3); q.x = 2; q.z = 22; p.x = 40; p.z = 30;
  place(m, 20.5, 22.5, Math.PI / 2);
  m.act({ k: 'tp' });
  assert(Math.abs(m.x - 28.5) < 0.6 && m.cd.tp > 20 && m.attackCd >= 1, `teleport: ${HUNT.tpRange} m forward, ${HUNT.tpCd} s cooldown, and no instant strike after it`);
  m.cd.tp = 0; place(m, 20.5, 21.5, Math.PI); m.act({ k: 'tp' }); assert(m.z > 21, 'teleport does not pass through walls');
  place(m, 30.5, 22.5); m.act({ k: 'trap' });
  assert(m.traps.length === 1 && evs.some((e) => e.e === 'trap+'), 'places a trap');
  p.x = 30.5; p.z = 22.5; p.flags = 8; run(g, 1); assert(!(p.rootT > 0), 'a fresh trap is not armed yet');
  run(g, 1); assert(p.rootT > 1.5 && m.traps.length === 0, `walking over an armed trap holds the survivor for ${HUNT.trapRoot} s`);
  const x0 = p.x; g.onState(2, [p.x + 0.3, 0, p.z, 0, 0, 8]); assert(p.x === x0, 'a trapped survivor cannot move');
  m.cd.trap = 0; place(m, 34.5, 22.5); m.act({ k: 'trap' }); g.time += 3; q.x = 34.5; q.z = 22.5; q.flags = 1 | 8; run(g, 1);
  assert(!(q.rootT > 0) && m.traps.length === 1, 'crouch-walking over a trap does not set it off');
  m.cd.trap = 0; place(m, 7.5, 22.5); m.act({ k: 'trap' }); assert(m.traps.length === 1, 'traps cannot be placed across the exit');
  m.act({ k: 'lights' }); assert(evs.some((e) => e.e === 'sabotage') && m.cd.lights > 40, 'sabotages the lights on a long cooldown');
}
console.log('SURVIVOR COUNTERPLAY');
{
  const { g, m, evs, toHunter } = mk(3); m.grace = 0;
  const p = g.players.get(2), q = g.players.get(3); q.x = 2; q.z = 22;
  place(m, 20.5, 22.5, -Math.PI / 2); p.x = 16; p.z = 22.5; p.ry = -Math.PI / 2; p.flags = 2; // torch on, aimed at him (player forward = -sin, -cos)
  run(g, 0.8); assert(m.stunT <= 0, 'a quick flash of torchlight does nothing');
  run(g, 0.7); assert(m.stunT > 0 && evs.some((e) => e.e === 'mstun' && e.kind === 'torch'), 'holding the beam on his face blinds him');
  m.stunT = 0; run(g, 3); assert(m.stunT <= 0, 'then he is immune to it for a while');
  p.inv[0] = { id: 999, type: 'bell' }; g.onUse(2, { slot: 0 });
  assert(m.stunT >= HUNT.bellStun - 0.1, `the hand bell stuns him for ${HUNT.bellStun} s`);
  const x0 = m.x; run(g, 1, () => m.onMove([m.x + HUNT.walk / 15, m.z, 0, 0])); assert(m.x - x0 < 2.1, `a stunned Headmaster can barely move (${(m.x - x0).toFixed(1)} m in 1 s instead of ${HUNT.walk})`);
  // hearing
  toHunter.length = 0; m.stunT = 0; p.x = 28; p.flags = 8 | 4; run(g, 1.2);
  assert(toHunter.some(([e, d]) => e === 'g:ev' && d.e === 'heard'), 'he hears a survivor sprinting nearby (shown to him as a pulse)');
  toHunter.length = 0; p.flags = 1 | 8; run(g, 1.5);
  assert(!toHunter.some(([e, d]) => e === 'g:ev' && d.e === 'heard'), 'but not one crouch-walking 7 m away');
  toHunter.length = 0; p.flags = 0; g.onVoice(2, 0.9);
  assert(toHunter.some(([e, d]) => e === 'g:ev' && d.e === 'heard' && d.k === 'voice'), 'talking loudly on voice chat gives your position away');
  toHunter.length = 0; g.time += 1; g.onVoice(2, 0.1);
  assert(!toHunter.some(([e, d]) => e === 'g:ev' && d.e === 'heard'), 'a quiet murmur at 7 m does not');
  toHunter.length = 0; g.noise(24, 22.5, 26, null, { kind: 'bottle', origin: { x: 40, z: 22 } });
  assert(toHunter.some(([e, d]) => e === 'g:ev' && d.e === 'heard' && d.k === 'bottle'), 'a thrown bottle shows up as a sound too (a decoy)');
}
console.log('DISCONNECT');
{
  const { g, m, evs } = mk(3); m.grace = 0; m.cd.trap = 0; place(m, 30.5, 22.5); m.act({ k: 'trap' });
  g.removePlayer(1);
  assert(!g.monster.human && Math.abs(g.monster.x - 30.5) < 0.1 && !g.over, 'if the Headmaster player leaves, the AI takes over where he stood');
  assert(evs.some((e) => e.e === 'trap-'), 'his traps are cleared');
  run(g, 5); assert(!g.over, 'and the match carries on');
}
console.log(process.exitCode ? '\nSOME HUNT TESTS FAILED' : '\nALL HUNT TESTS PASSED');
