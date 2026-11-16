// Headless test of the Rapier character controller against the real school colliders.
import RAPIER from '@dimforge/rapier3d-compat';
import { buildPhysics } from '../client/js/physics.js';
import { MAP, idx, findPath } from '../client/shared/map.js';

const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('  ok  -', m); };
await RAPIER.init();
const ph = buildPhysics(RAPIER);
const dt = 1 / 60;
const walk = (vx, vz, secs) => { for (let i = 0; i < secs / dt; i++) ph.move(vx, vz, dt); return ph.getFeet(); };

ph.teleport(6.5, 0, 22.5);
let f = walk(0, 0, 0.5);
assert(Math.abs(f.y) < 0.06, `stands on the floor (y=${f.y.toFixed(3)})`);
f = walk(0, -4, 2);
assert(f.z > 21.25 && f.z < 21.4, `walls stop the player (z=${f.z.toFixed(2)}, wall face at 21.0 + radius 0.3)`);
f = walk(-4, 0, 3);
assert(f.x > 4.85 && f.x < 5.05, `closed exit gate is solid (x=${f.x.toFixed(2)})`);
ph.setDoor(MAP.gate.id, true);
f = walk(-4, 0, 1);
assert(f.x < 4, `open gate lets the player through (x=${f.x.toFixed(2)})`);
ph.setDoor(MAP.gate.id, false);

// follow a path into the basement, opening doors on the way
ph.teleport(46.5, 0, 31.5);
ph.setDoor(MAP.doorAt[idx(48, 31)], true);
const path = findPath(46.5, 31.5, 58.5, 31.5, () => 0);
let minY = 0, stuck = 0;
for (const n of path) {
  for (let i = 0; i < 240; i++) {
    const p = ph.getFeet(); const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.15) break;
    ph.move((dx / d) * 4, (dz / d) * 4, dt);
    if (i === 239) stuck++;
  }
  minY = Math.min(minY, ph.getFeet().y);
}
f = ph.getFeet();
assert(stuck === 0, 'never gets stuck walking stairwell door -> stairs -> basement');
assert(Math.abs(f.y + 3) < 0.08, `ends on the basement floor (y=${f.y.toFixed(2)})`);
// and back up
const up = findPath(58.5, 31.5, 46.5, 31.5, () => 0);
for (const n of up) for (let i = 0; i < 240; i++) { const p = ph.getFeet(); const dx = n.x - p.x, dz = n.z - p.z, d = Math.hypot(dx, dz); if (d < 0.15) break; ph.move((dx / d) * 4, (dz / d) * 4, dt); }
f = ph.getFeet();
assert(Math.abs(f.y) < 0.08 && f.x < 47, `climbs back up the stairs (x=${f.x.toFixed(1)}, y=${f.y.toFixed(2)})`);

// tables: blocked standing, passable crouched
ph.teleport(20.5, 0, 26.2); // just north of a cafeteria table (z 27..28)
f = walk(0, 3, 1.5);
assert(f.z < 27.0, `standing player is blocked by a table (z=${f.z.toFixed(2)})`);
ph.setCrouch(true);
f = walk(0, 1.5, 1.0);
assert(f.z > 27.2 && ph.lowCeiling(), `crouching player crawls under it (z=${f.z.toFixed(2)})`);
f = walk(0, 1.5, 1.5);
ph.setCrouch(false);
assert(f.z > 28.3, `and out the other side (z=${f.z.toFixed(2)})`);
// lockers, desks are solid
ph.teleport(9.5, 0, 22.8);
f = walk(0, -3, 1.5);
assert(f.z > 21.7, `lockers are solid (z=${f.z.toFixed(2)})`);
// South Wing: the stage is a step up, seat rows are solid, hospital beds can be crawled under
ph.teleport(24.5, 0, 50.5);
f = walk(0, 3, 1.2);
assert(f.z > 52.3 && Math.abs(f.y - 0.3) < 0.06, `steps up onto the stage (z=${f.z.toFixed(2)}, y=${f.y.toFixed(2)})`);
f = walk(0, -3, 1.6);
assert(f.z < 51.6 && Math.abs(f.y) < 0.06, `and back down (y=${f.y.toFixed(2)})`);
ph.teleport(20.5, 0, 45.5);
f = walk(0, -3, 1.2);
assert(f.z > 44.6, `auditorium seat rows are solid (z=${f.z.toFixed(2)})`);
ph.teleport(34.6, 0, 50.4);
f = walk(0, 3, 1.2);
assert(f.z < 50.75, `a standing player is blocked by a hospital bed (z=${f.z.toFixed(2)})`);
ph.setCrouch(true);
f = walk(0, 1.5, 1.4);
assert(f.z > 51.3 && ph.lowCeiling(), `crouching, you crawl under it (z=${f.z.toFixed(2)})`);
ph.setCrouch(false);
console.log(process.exitCode ? '\nSOME PHYSICS TESTS FAILED' : '\nALL PHYSICS TESTS PASSED');
