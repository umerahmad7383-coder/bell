// THE LAST BELL — shared school layout.
// Loaded by BOTH the browser (geometry, collision) and the Node server
// (monster pathfinding, line of sight, validation). 1 grid cell = 1 metre.

export const W = 63;
export const H = 61;
export const WALL = 0, FLOOR = 1, DOOR = 2;
export const CEIL_Y = 3.2;          // ground-floor ceiling height
export const STAGE_Y = 0.3;         // the auditorium stage is a step up (level 3)
export const BASEMENT_Y = -3;       // basement floor height
export const BASEMENT_CEIL = -0.35; // basement ceiling height
export const STAIRS = { x0: 51, x1: 57, z0: 30, z1: 32 }; // x1/z1 exclusive, descends toward +x

const R = (name, x0, z0, x1, z1, o = {}) => ({ name, x0, z0, x1, z1, ...o });
/** floor height of a map level */
export const levelY = (lv) => (lv === 2 ? BASEMENT_Y : lv === 3 ? STAGE_Y : 0);

export const ROOMS = [
  R('Courtyard', 1, 19, 3, 25, { outside: true }),
  R('Main Hall', 5, 21, 47, 23, { corridor: true }),
  R('West Corridor', 14, 5, 15, 40, { corridor: true }),
  R('East Corridor', 46, 5, 47, 40, { corridor: true }),
  R('North Corridor', 14, 5, 47, 6, { corridor: true }),
  R('South Corridor', 14, 39, 47, 40, { corridor: true }),
  R('Classroom 1A', 17, 8, 25, 19),
  R('Science Lab', 27, 8, 35, 19),
  R('Library', 37, 11, 44, 19),
  R('Hidden Archive', 40, 8, 43, 9, { secret: true }),
  R('Cafeteria', 17, 25, 30, 37),
  R('Gymnasium', 32, 25, 44, 37),
  R('Classroom 1B', 5, 8, 12, 19),
  R('Bathroom', 5, 25, 12, 30),
  R('Classroom 1C', 5, 32, 12, 40),
  R('Storage Room', 8, 3, 12, 6),
  R('Security Office', 49, 5, 55, 10),
  R("Principal's Office", 49, 12, 57, 18, { locked: true }),
  R('Staff Room', 49, 20, 55, 26),
  R('Stairwell', 49, 30, 50, 31, { corridor: true }),
  R('Basement Stairs', 51, 30, 56, 31, { stairs: true, corridor: true }),
  R('Basement', 57, 28, 60, 36, { basement: true }),
  R('Cellar', 57, 20, 61, 26, { basement: true }),
  R('Boiler Room', 50, 38, 60, 45, { basement: true }),
  // ---- South Wing (v0.9) ----
  R('West Wing', 14, 41, 15, 58, { corridor: true }),
  R('East Wing', 46, 41, 47, 58, { corridor: true }),
  R('Lower Hall', 14, 57, 47, 58, { corridor: true }),
  R('Auditorium', 17, 42, 31, 51),
  R('Stage', 17, 52, 31, 55, { stage: true }),
  R('Music Room', 33, 42, 44, 48),
  R("Nurse's Office", 33, 50, 44, 55),
  R('Art Room', 5, 42, 12, 49),
  R("Janitor's Closet", 8, 51, 12, 55),
  R('Locker Room', 49, 48, 60, 55),
];

// [x, z, options]
const DOOR_DEFS = [
  [16, 12], [21, 20], [31, 20], [31, 7], [45, 12], [40, 20], [16, 31], [24, 38],
  [45, 31], [38, 38], [13, 14], [13, 27], [13, 36], [13, 5], [48, 8],
  [48, 15, { locked: true, lock: 'principal' }],
  [48, 22], [48, 31], [59, 27, { basement: true }], [58, 37, { basement: true }],
  [42, 10, { kind: 'shelf' }],
  // South Wing
  [13, 45], [13, 53], [16, 46], [32, 44], [45, 45], [45, 52], [38, 56], [24, 56], [48, 51],
];
const OPENINGS = [[22, 24], [23, 24], [38, 24], [39, 24]];
const GATE_CELLS = [[4, 21], [4, 22], [4, 23]];

function build() {
  const grid = new Uint8Array(W * H);
  const level = new Uint8Array(W * H);   // 0 ground, 1 stairs, 2 basement, 3 stage
  const blocked = new Uint8Array(W * H); // furniture: blocks pathing, not sight
  const cover = new Uint8Array(W * H);   // crouch here = concealed (under a table)
  const shade = new Uint8Array(W * H);   // crouch here = harder to see (between seat rows, behind a drape)
  const roomOf = new Int8Array(W * H).fill(-1);
  const I = (x, z) => z * W + x;

  ROOMS.forEach((r, ri) => {
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      grid[I(x, z)] = FLOOR;
      if (roomOf[I(x, z)] < 0 || !r.corridor) roomOf[I(x, z)] = ri;
      if (r.basement) level[I(x, z)] = 2;
      if (r.stairs) level[I(x, z)] = 1;
      if (r.stage) level[I(x, z)] = 3;
    }
  });
  for (const [x, z] of OPENINGS) grid[I(x, z)] = FLOOR;

  const doors = [];
  for (const [x, z, o = {}] of DOOR_DEFS) {
    grid[I(x, z)] = DOOR;
    if (o.basement) level[I(x, z)] = 2;
    const axis = grid[I(x - 1, z)] !== WALL && grid[I(x + 1, z)] !== WALL ? 'x' : 'z';
    doors.push({ id: doors.length, x, z, axis, kind: o.kind || 'door', locked: !!o.locked, lock: o.lock || null, cells: [I(x, z)] });
  }
  for (const [x, z] of GATE_CELLS) grid[I(x, z)] = DOOR;
  const gate = { id: doors.length, x: 4, z: 22, axis: 'x', kind: 'gate', locked: true, lock: 'gate', cells: GATE_CELLS.map(([x, z]) => I(x, z)) };
  doors.push(gate);
  const doorAt = new Int16Array(W * H).fill(-1);
  for (const d of doors) for (const c of d.cells) doorAt[c] = d.id;

  // ---------- furniture ----------
  const props = [];
  // t: type, (x,z): min cell, w/d: footprint in cells, r: rotation (quarter turns, visual)
  const P = (t, x, z, w = 1, d = 1, o = {}) => {
    const lv = level[I(x, z)];
    const p = { t, x: x + w / 2, z: z + d / 2, w, d, r: 0, y: levelY(lv), ...o };
    props.push(p);
    if (!o.walk) for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) {
      blocked[I(xx, zz)] = 1;
      if (o.cover) cover[I(xx, zz)] = 1;
    }
    if (o.shade) for (let zz = z; zz < z + d; zz++) for (let xx = x; xx < x + w; xx++) shade[I(xx, zz)] = 1;
    return p;
  };
  const table = (x, z, w, d, o = {}) => P('table', x, z, w, d, { cover: true, ...o });

  // Classroom 1A
  table(20, 9, 2, 1, { teacher: true });
  for (const x of [18, 20, 22, 24]) for (const z of [11, 13, 15, 17]) P('desk', x, z, 1, 1, { r: 0 });
  P('board', 19, 8, 5, 1, { walk: true, face: 'n' });
  // Classroom 1B
  table(8, 9, 2, 1, { teacher: true });
  for (const x of [6, 8, 10]) for (const z of [11, 13, 15, 17]) P('desk', x, z, 1, 1, { r: 0 });
  P('board', 6, 8, 5, 1, { walk: true, face: 'n' });
  // Classroom 1C (faces south)
  table(8, 40, 2, 1, { teacher: true });
  for (const x of [6, 8, 10]) for (const z of [33, 35, 37]) P('desk', x, z, 1, 1, { r: 2 });
  P('board', 6, 40, 5, 1, { walk: true, face: 's' });
  // Science lab
  for (const z of [10, 13, 16]) { table(28, z, 3, 1, { lab: true }); table(32, z, 3, 1, { lab: true }); }
  P('cabinet', 35, 9, 1, 4, { face: 'w' });
  P('cabinet', 27, 18, 1, 2, { face: 'e' });
  // Library
  for (const z of [13, 15, 17]) { P('bookshelf', 38, z, 3, 1); P('bookshelf', 42, z, 2, 1); }
  table(38, 19, 2, 1);
  P('bookshelf', 40, 8, 1, 1, { face: 'e' });
  // Cafeteria
  for (const z of [27, 30, 33]) { table(19, z, 3, 1, { caf: true }); table(25, z, 3, 1, { caf: true }); }
  P('counter', 17, 36, 4, 1);
  P('vending', 30, 26, 1, 1, { face: 'w' });
  // Gym
  P('bleachers', 32, 27, 2, 9);
  P('hoop', 38, 25, 1, 1, { walk: true, face: 'n' });
  P('hoop', 38, 37, 1, 1, { walk: true, face: 's' });
  P('crate', 43, 36, 1, 1);
  // Bathroom
  P('stalls', 5, 25, 6, 2);
  P('sinks', 6, 30, 4, 1);
  // Storage
  P('cabinet', 8, 3, 1, 4, { face: 'e' });
  P('crate', 11, 3, 1, 1);
  // Security office
  P('console', 55, 6, 1, 4, { face: 'w' });
  P('cabinet', 50, 5, 2, 1, { face: 's' });
  // Principal's office
  P('bigdesk', 54, 15, 2, 1);
  P('bookshelf', 57, 13, 1, 5, { face: 'w' });
  P('portrait', 52, 12, 1, 1, { walk: true, face: 'n' });
  // Staff room
  table(51, 23, 3, 1);
  P('counter', 55, 21, 1, 4);
  // Basement
  P('crate', 57, 35, 1, 1); P('crate', 57, 36, 1, 1);
  P('cabinet', 61, 21, 1, 5, { face: 'w' });
  P('crate', 57, 20, 1, 1);
  P('boiler', 52, 41, 2, 2);
  P('crate', 50, 45, 2, 1);
  P('pipes', 50, 38, 11, 1, { walk: true });

  // ---- South Wing furniture ----
  // Auditorium: three rows of seats facing the stage. Crouch between the rows and he sees you far later.
  for (const z of [44, 46, 48]) { P('seats', 18, z, 5, 1); P('seats', 26, z, 5, 1); }
  for (const z of [43, 45, 47, 49]) { P('gap', 18, z, 5, 1, { walk: true, shade: true }); P('gap', 26, z, 5, 1, { walk: true, shade: true }); }
  // Stage: lectern, the great bell, curtains (crouch behind the side drapes to hide)
  P('lectern', 24, 53, 1, 1, { face: 'n' });
  P('greatbell', 19, 54, 2, 1);
  P('curtain', 17, 55, 15, 1, { walk: true });
  P('drape', 17, 52, 1, 3, { walk: true, shade: true, face: 'e' });
  P('drape', 31, 52, 1, 3, { walk: true, shade: true, face: 'w' });
  // Music room
  P('piano', 34, 47, 2, 1, { face: 'n' });
  P('stands', 37, 44, 5, 1);
  P('stands', 37, 46, 4, 1);
  P('drums', 42, 47, 2, 1);
  P('cabinet', 34, 42, 3, 1, { face: 's' });
  // Nurse's office: high hospital beds you can crawl under
  P('bed', 34, 51, 2, 1, { cover: true });
  P('bed', 34, 53, 2, 1, { cover: true, body: true });
  P('bed', 41, 54, 2, 1, { cover: true });
  P('medcab', 40, 50, 3, 1, { face: 's' });
  table(37, 53, 2, 1, { nurse: true });
  P('screen', 36, 51, 1, 1);
  P('iv', 36, 54, 1, 1);
  // Art room
  for (const [x, z] of [[6, 44], [9, 44], [6, 47], [9, 47]]) table(x, z, 2, 1, { art: true });
  P('easel', 11, 43, 1, 1, { face: 'w' });
  P('easel', 12, 48, 1, 1, { face: 'w' });
  P('kiln', 5, 42, 1, 1);
  P('cabinet', 7, 42, 3, 1, { face: 's' });
  P('mannequin', 12, 46, 1, 1);
  // Janitor's closet
  P('cabinet', 8, 51, 1, 4, { face: 'e' });
  P('crate', 12, 51, 1, 1, { radio: true });
  P('crate', 11, 55, 1, 1);
  P('bucket', 10, 55, 1, 1, { walk: true });
  // Locker room
  P('bench', 51, 51, 6, 1);
  P('bench', 51, 53, 6, 1);
  P('showers', 59, 49, 2, 7, { walk: true });
  // Lower hall
  P('trophy', 34, 58, 3, 1, { face: 'n' });
  P('trophy', 19, 58, 2, 1, { face: 'n' });

  // Hide-able lockers: [cellX, cellZ, faceDX, faceDZ]
  const LOCKERS = [
    [8, 21, 0, 1], [9, 21, 0, 1], [10, 21, 0, 1],
    [33, 23, 0, -1], [34, 23, 0, -1], [35, 23, 0, -1],
    [14, 9, 1, 0], [14, 10, 1, 0],
    [47, 35, -1, 0], [47, 36, -1, 0],
    [24, 5, 0, 1], [25, 5, 0, 1],
    [30, 40, 0, -1], [31, 40, 0, -1],
    [44, 27, -1, 0], [44, 28, -1, 0],
    [49, 26, 0, -1], [50, 26, 0, -1],
    [60, 33, -1, 0], [60, 34, -1, 0],
    // South Wing
    [14, 49, 1, 0], [14, 50, 1, 0],
    [47, 43, -1, 0], [47, 44, -1, 0],
    [28, 58, 0, -1], [29, 58, 0, -1],
    [44, 42, -1, 0], [44, 43, -1, 0],
    [8, 55, 1, 0],
    ...[50, 51, 52, 53, 54, 55, 56, 57].map((x) => [x, 48, 0, 1]),
  ];
  const lockers = LOCKERS.map(([x, z, dx, dz], id) => {
    blocked[I(x, z)] = 1;
    return { id, x, z, dx, dz, y: levelY(level[I(x, z)]) };
  });

  // Fixed interactables
  const fuseBox = { x: 57.5, z: 45.9, y: BASEMENT_Y + 1.4, cellX: 57, cellZ: 45 };
  const securityConsole = { x: 55.2, z: 8, y: 1.0, cellX: 54, cellZ: 8 };
  const gateKeySpot = { x: 55, z: 15.5, y: 0.95 };
  // Lures: things that make a lot of noise to pull him somewhere (E to use).
  //   r = how far he hears it, delay = seconds before it starts, dur = how long it plays, cd = cooldown (0 = once per match)
  const lures = [
    { id: 0, kind: 'piano', name: 'the piano', x: 35, z: 46.6, y: 1.0, r: 34, delay: 0, dur: 4, cd: 45 },
    { id: 1, kind: 'radio', name: 'the old radio', x: 12.5, z: 51.5, y: 1.02, r: 30, delay: 6, dur: 12, cd: 75 },
    { id: 2, kind: 'greatbell', name: 'the great bell', x: 20, z: 54.5, y: STAGE_Y + 1.6, r: 90, delay: 0, dur: 6, cd: 0 },
  ];

  // ---------- derived data ----------
  const walk = (x, z) => x >= 0 && z >= 0 && x < W && z < H && grid[I(x, z)] !== WALL;
  const free = (x, z) => walk(x, z) && grid[I(x, z)] === FLOOR && !blocked[I(x, z)];
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // Item spawn spots: floor cells hugging a wall / furniture, plus table tops.
  const spots = [];
  ROOMS.forEach((r, ri) => {
    if (r.corridor || r.outside) return;
    for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
      if (!free(x, z) || roomOf[I(x, z)] !== ri) continue;
      let nearEdge = false, nearDoor = false;
      for (const [dx, dz] of N4) {
        const nx = x + dx, nz = z + dz;
        if (!walk(nx, nz) || blocked[I(nx, nz)]) nearEdge = true;
        if (walk(nx, nz) && grid[I(nx, nz)] === DOOR) nearDoor = true;
      }
      if (nearEdge && !nearDoor) spots.push({ x: x + 0.5, z: z + 0.5, y: levelY(level[I(x, z)]) + 0.12, room: r.name });
    }
  });
  for (const p of props) if (p.t === 'table') {
    const ri = roomOf[I(Math.floor(p.x), Math.floor(p.z))];
    spots.push({ x: p.x, z: p.z, y: p.y + 1.13, room: ROOMS[ri].name, top: true });
  }

  // Patrol waypoints
  const waypoints = [];
  ROOMS.forEach((r) => {
    if (r.outside || r.secret || r.stairs) return;
    const push = (cx, cz) => {
      let best = null, bd = 1e9;
      for (let z = r.z0; z <= r.z1; z++) for (let x = r.x0; x <= r.x1; x++) {
        if (!free(x, z)) continue;
        const d = (x - cx) ** 2 + (z - cz) ** 2;
        if (d < bd) { bd = d; best = [x, z]; }
      }
      if (best && !waypoints.some((w) => w.x === best[0] && w.z === best[1])) waypoints.push({ x: best[0], z: best[1], room: r.name, corridor: !!r.corridor });
    };
    const lenX = r.x1 - r.x0, lenZ = r.z1 - r.z0;
    if (r.corridor && Math.max(lenX, lenZ) > 8) {
      const n = Math.ceil(Math.max(lenX, lenZ) / 7);
      for (let i = 0; i <= n; i++) push(r.x0 + (lenX * i) / n, r.z0 + (lenZ * i) / n);
    } else push((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2);
  });

  // Ceiling light fixtures
  const lights = [];
  ROOMS.forEach((r) => {
    if (r.outside || r.stairs) return;
    const y = (r.basement ? BASEMENT_CEIL : CEIL_Y) - 0.06;
    if (r.stage) return; // lit from the auditorium
    const lenX = r.x1 - r.x0 + 1, lenZ = r.z1 - r.z0 + 1;
    const nx = Math.max(1, Math.round(lenX / 5)), nz = Math.max(1, Math.round(lenZ / 5));
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = r.x0 + (lenX * (i + 0.5)) / nx, z = r.z0 + (lenZ * (j + 0.5)) / nz;
      if (lights.some((l) => Math.abs(l.x - x) < 2.5 && Math.abs(l.z - z) < 2.5 && Math.abs(l.y - y) < 1)) continue;
      lights.push({ x, y, z, alongX: lenX >= lenZ, room: r.name });
    }
  });
  // every 6th fixture is a dim red emergency light that works without power
  lights.forEach((l, i) => { l.emergency = i % 6 === 2; l.dead = i % 7 === 5; });

  // Windows: [wall cell x, z, normal x, normal z]
  const windows = [
    [4, 10, 1, 0], [4, 13, 1, 0], [4, 16, 1, 0], [4, 27, 1, 0], [4, 34, 1, 0], [4, 37, 1, 0],
    ...[18, 22, 28, 34, 40, 44].flatMap((x) => [[x, 4, 0, 1], [x, 59, 0, -1]]),
    [56, 7, -1, 0], [58, 14, -1, 0], [58, 16, -1, 0], [10, 2, 0, 1],
    [4, 44, 1, 0], [4, 47, 1, 0], [61, 50, -1, 0], [61, 53, -1, 0],
  ].map(([x, z, nx, nz]) => ({ x, z, nx, nz }));

  const playerSpawns = [];
  for (let i = 0; i < 8; i++) playerSpawns.push({ x: 6.5 + (i % 4) * 0.9, z: 21.9 + Math.floor(i / 4) * 1.2 });
  const escapeZone = { x0: 0.5, x1: 3.6, z0: 19, z1: 26 };

  return { grid, level, blocked, cover, shade, roomOf, doors, doorAt, gate, props, lockers, fuseBox, securityConsole, gateKeySpot, lures, spots, waypoints, lights, windows, playerSpawns, escapeZone };
}

export const MAP = build();
export const idx = (x, z) => z * W + x;
export const inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < H;
export const cellType = (x, z) => (inBounds(x, z) ? MAP.grid[z * W + x] : WALL);
export const isWalkableCell = (x, z) => cellType(x, z) !== WALL;

export function floorY(x, z) {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (!inBounds(cx, cz)) return 0;
  const lv = MAP.level[cz * W + cx];
  if (lv === 2) return BASEMENT_Y;
  if (lv === 3) return STAGE_Y;
  if (lv === 1) return BASEMENT_Y * Math.min(1, Math.max(0, (x - STAIRS.x0) / (STAIRS.x1 - STAIRS.x0)));
  return 0;
}
export function ceilY(cx, cz) {
  return MAP.level[cz * W + cx] === 2 ? BASEMENT_CEIL : CEIL_Y;
}
export function roomNameAt(x, z) {
  const cx = Math.floor(x), cz = Math.floor(z);
  if (!inBounds(cx, cz)) return '';
  const ri = MAP.roomOf[cz * W + cx];
  if (ri >= 0) return ROOMS[ri].name;
  const d = MAP.doorAt[cz * W + cx];
  return d >= 0 ? 'Doorway' : '';
}

/** Line of sight on the grid. opaque(cellIndex) -> true if the cell blocks vision. */
export function lineOfSight(x0, z0, x1, z1, opaque) {
  const dx = x1 - x0, dz = z1 - z0;
  const dist = Math.hypot(dx, dz);
  const steps = Math.ceil(dist / 0.2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const cx = Math.floor(x0 + dx * t), cz = Math.floor(z0 + dz * t);
    if (!inBounds(cx, cz)) return false;
    const c = cz * W + cx;
    if (MAP.grid[c] === WALL || (opaque && opaque(c))) return false;
  }
  return true;
}

/**
 * A* over the grid (8-way, no corner cutting).
 * cost(cellIndex) -> extra cost (>=0), or -1 if impassable.
 * Returns [{x,z}] cell centres from start (exclusive) to goal, or null.
 */
export function findPath(sx, sz, tx, tz, cost, maxNodes = 6000) {
  sx = Math.floor(sx); sz = Math.floor(sz); tx = Math.floor(tx); tz = Math.floor(tz);
  if (!inBounds(sx, sz) || !inBounds(tx, tz)) return null;
  const start = sz * W + sx, goal = tz * W + tx;
  if (start === goal) return [];
  const g = new Float32Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const open = [start];
  const f = new Float32Array(W * H).fill(Infinity);
  g[start] = 0; f[start] = Math.hypot(tx - sx, tz - sz);
  const pass = (c) => MAP.grid[c] !== WALL && (c === goal || c === start || !MAP.blocked[c]) && (cost ? cost(c) >= 0 : true);
  let n = 0;
  while (open.length && n < maxNodes) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1]; open.pop();
    if (closed[cur]) continue;
    n++;
    if (cur === goal) {
      const path = [];
      for (let c = goal; c !== start; c = from[c]) path.push({ x: (c % W) + 0.5, z: Math.floor(c / W) + 0.5 });
      return path.reverse();
    }
    closed[cur] = 1;
    const cx = cur % W, cz = (cur / W) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (!inBounds(nx, nz)) continue;
      const nc = nz * W + nx;
      if (closed[nc] || !pass(nc)) continue;
      if (dx && dz) { // diagonal: both orthogonal neighbours must be clear, and no doors on diagonals
        if (!pass(cz * W + nx) || !pass(nz * W + cx)) continue;
        if (MAP.grid[nc] === DOOR || MAP.grid[cur] === DOOR) continue;
      }
      const step = (dx && dz ? 1.4142 : 1) + (cost ? cost(nc) : 0);
      const ng = g[cur] + step;
      if (ng < g[nc]) {
        g[nc] = ng; from[nc] = cur;
        f[nc] = ng + Math.hypot(tx - nx, tz - nz);
        open.push(nc);
      }
    }
  }
  return null;
}

/** Nearest free (walkable, unblocked, non-door) cell to a world position. */
export function nearestFreeCell(x, z, maxR = 4) {
  const cx = Math.floor(x), cz = Math.floor(z);
  let best = null, bd = 1e9;
  for (let dz = -maxR; dz <= maxR; dz++) for (let dx = -maxR; dx <= maxR; dx++) {
    const nx = cx + dx, nz = cz + dz;
    if (!inBounds(nx, nz)) continue;
    const c = nz * W + nx;
    if (MAP.grid[c] !== FLOOR || MAP.blocked[c]) continue;
    const d = (nx + 0.5 - x) ** 2 + (nz + 0.5 - z) ** 2;
    if (d < bd) { bd = d; best = { x: nx, z: nz }; }
  }
  return best;
}
