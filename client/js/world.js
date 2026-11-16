// Builds the abandoned school (visuals) from the shared map.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { MAP, W, H, WALL, ROOMS, CEIL_Y, BASEMENT_Y, BASEMENT_CEIL, STAIRS, STAGE_Y, ceilY, levelY } from '../shared/map.js';
import { writingTexture, signTexture, exitTexture } from './textures.js';
import { buildItemMesh } from './items.js';

// deterministic decoration so every client sees the same clutter
function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry(1987);
const R = (a, b) => a + rng() * (b - a);

function colored(g, color) {
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function bx(w, h, d, x, y, z, color, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return colored(g, color);
}
function cy(rt, rb, h, x, y, z, color, seg = 10, axis = 'y') {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  if (axis === 'z') g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return colored(g, color);
}
const merge = (parts) => mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));

class Quads {
  constructor() { this.p = []; this.n = []; this.uv = []; this.i = []; }
  // horizontal quad; up=true faces +y
  flat(x0, z0, x1, z1, y, up, s) {
    const b = this.p.length / 3;
    this.p.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
    const ny = up ? 1 : -1;
    this.n.push(0, ny, 0, 0, ny, 0, 0, ny, 0, 0, ny, 0);
    this.uv.push(x0 * s, z0 * s, x1 * s, z0 * s, x1 * s, z1 * s, x0 * s, z1 * s);
    if (up) this.i.push(b, b + 2, b + 1, b, b + 3, b + 2); else this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  // vertical 1 m wide quad centred on (cx, cz), facing (nx, nz)
  wall(cx, cz, nx, nz, y0, y1) {
    const b = this.p.length / 3, ex = nz * 0.5, ez = -nx * 0.5;
    const x0 = cx - ex, z0 = cz - ez, x1 = cx + ex, z1 = cz + ez;
    this.p.push(x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0);
    this.n.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
    const u0 = nz !== 0 ? x0 : z0, u1 = nz !== 0 ? x1 : z1;
    this.uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
    this.i.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    return g;
  }
}

export function buildWorld(scene, T, Q) {
  const world = { doors: [], items: new Map(), power: false };
  // PERFORMANCE: every light is evaluated for every pixel, so the shading model matters a lot.
  // Lambert (diffuse only) is several times cheaper than the physically based Standard material
  // and looks the same on matte plaster, concrete and wood. Only High keeps glossy floors.
  const pbr = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  const std = (o) => { const { roughness, metalness, ...rest } = o; return new THREE.MeshLambertMaterial(rest); };
  const gloss = Q.gloss ? pbr : std;
  const M = {
    wall: std({ map: T.wall }),
    concrete: std({ map: T.concrete }),
    lino: gloss({ map: T.lino, roughness: 0.55 }),
    wood: gloss({ map: T.wood, roughness: 0.6 }),
    ceiling: std({ map: T.ceiling }),
    prop: std({ map: T.grime, vertexColors: true }),
    door: std({ map: T.door }),
    locker: std({ map: T.locker }),
    iron: std({ color: 0x1b1c1e }),
    trim: std({ color: 0x5d5a4c, map: T.grime }),
    tile: gloss({ map: T.tile, roughness: 0.35 }),
    curtain: std({ map: T.curtain, side: THREE.DoubleSide }),
  };
  const add = (mesh, cast = true, recv = true) => { mesh.castShadow = cast && Q.shadows; mesh.receiveShadow = recv && Q.shadows; scene.add(mesh); return mesh; };
  const walkable = (x, z) => x >= 0 && z >= 0 && x < W && z < H && MAP.grid[z * W + x] !== WALL;
  const dummy = new THREE.Object3D();
  const instanced = (geo, mat, list, colorFn) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => {
      dummy.position.set(t.x, t.y || 0, t.z); dummy.rotation.set(0, t.ry || 0, 0); dummy.scale.set(t.sx || 1, t.sy || 1, t.sz || 1); dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      if (colorFn) m.setColorAt(i, colorFn(t, i));
    });
    m.instanceMatrix.needsUpdate = true;
    return add(m);
  };

  // ------------------------------------------------------------ walls
  // PERFORMANCE: only the wall faces that actually border a walkable cell are built, merged into two
  // meshes. (Drawing every wall cell as a full box meant ~10x the triangles, most of them buried.)
  {
    const upper = new Quads(), lower = new Quads();
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (MAP.grid[z * W + x] !== WALL) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!walkable(x + dx, z + dz)) continue;
        const lv = MAP.level[(z + dz) * W + x + dx];
        const cx = x + 0.5 + dx * 0.5, cz = z + 0.5 + dz * 0.5;
        if (lv !== 2) upper.wall(cx, cz, dx, dz, 0, CEIL_Y);
        if (lv === 1 || lv === 2) lower.wall(cx, cz, dx, dz, BASEMENT_Y, 0);
      }
    }
    add(new THREE.Mesh(upper.build(), M.wall));
    add(new THREE.Mesh(lower.build(), M.concrete));
  }

  // ------------------------------------------------------------ floors & ceilings
  {
    const fl = { lino: new Quads(), wood: new Quads(), concrete: new Quads(), tile: new Quads() };
    const ce = { ceiling: new Quads(), concrete: new Quads() };
    const woodRooms = new Set(['Gymnasium', 'Library', "Principal's Office", 'Hidden Archive', 'Stage', 'Music Room', 'Auditorium']);
    const tileRooms = new Set(['Bathroom', 'Locker Room', "Nurse's Office"]);
    const risers = new Quads();
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const c = z * W + x;
      if (MAP.grid[c] === WALL) continue;
      const lv = MAP.level[c], room = MAP.roomOf[c] >= 0 ? ROOMS[MAP.roomOf[c]] : null;
      if (lv !== 1) {
        const mat = lv === 2 || (room && room.outside) ? 'concrete' : room && woodRooms.has(room.name) ? 'wood' : room && tileRooms.has(room.name) ? 'tile' : 'lino';
        fl[mat].flat(x, z, x + 1, z + 1, levelY(lv), true, 0.5);
      }
      if (lv === 3) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { // the stage's front edge
        const n = (z + dz) * W + x + dx;
        if (walkable(x + dx, z + dz) && MAP.level[n] !== 3) risers.wall(x + 0.5 + dx * 0.5, z + 0.5 + dz * 0.5, dx, dz, 0, STAGE_Y);
      }
      if (!(room && room.outside)) (lv === 2 ? ce.concrete : ce.ceiling).flat(x, z, x + 1, z + 1, ceilY(x, z), false, 1 / 1.2);
    }
    for (const k in fl) add(new THREE.Mesh(fl[k].build(), M[k]), false, true);
    add(new THREE.Mesh(risers.build(), M.wood), false, true);
    for (const k in ce) add(new THREE.Mesh(ce[k].build(), M[k]), false, false);

    // stairs: visual steps over the collision ramp
    const n = 18, run = (STAIRS.x1 - STAIRS.x0) / n, rise = -BASEMENT_Y / n, steps = [];
    for (let i = 0; i < n; i++) steps.push({ x: STAIRS.x0 + (i + 0.5) * run, y: -(i + 0.5) * rise - rise * 0.5, z: (STAIRS.z0 + STAIRS.z1) / 2 });
    instanced(new THREE.BoxGeometry(run, rise * 2, STAIRS.z1 - STAIRS.z0), M.concrete, steps);
    // header wall where the tall stairwell meets the low basement ceiling
    const hdr = new THREE.Mesh(new THREE.BoxGeometry(0.2, CEIL_Y - BASEMENT_CEIL, STAIRS.z1 - STAIRS.z0), M.concrete);
    hdr.position.set(STAIRS.x1 + 0.1, (CEIL_Y + BASEMENT_CEIL) / 2, (STAIRS.z0 + STAIRS.z1) / 2); add(hdr);
    // handrail
    const len = Math.hypot(STAIRS.x1 - STAIRS.x0, BASEMENT_Y);
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), M.iron);
    rail.rotation.z = Math.PI / 2 - Math.atan2(-BASEMENT_Y, STAIRS.x1 - STAIRS.x0) + Math.PI; rail.position.set((STAIRS.x0 + STAIRS.x1) / 2, BASEMENT_Y / 2 + 0.95, STAIRS.z0 + 0.08); add(rail);
  }

  // ------------------------------------------------------------ doors
  const shelfGeo = bookshelfGeo('#3a2a1a');
  for (const d of MAP.doors) {
    const y = MAP.level[d.cells[0]] === 2 ? BASEMENT_Y : 0;
    const top = (MAP.level[d.cells[0]] === 2 ? BASEMENT_CEIL : CEIL_Y);
    const pivot = new THREE.Group();
    const D = { def: d, pivot, open: false, locked: d.locked, t: 0 };
    if (d.kind === 'gate') {
      // two barred leaves
      const bars = [];
      for (let i = 0; i <= 12; i++) bars.push(new THREE.CylinderGeometry(0.02, 0.02, 2.5, 5).translate(0, 1.25, 0.06 + i * 0.115));
      bars.push(new THREE.BoxGeometry(0.05, 0.06, 1.46).translate(0, 0.15, 0.75), new THREE.BoxGeometry(0.05, 0.06, 1.46).translate(0, 2.4, 0.75), new THREE.BoxGeometry(0.05, 0.06, 1.46).translate(0, 1.3, 0.75));
      const geo = mergeGeometries(bars.map((g) => g.toNonIndexed()));
      const a = new THREE.Group(), b = new THREE.Group();
      a.position.set(4.5, 0, 21); b.position.set(4.5, 0, 24);
      const ma = new THREE.Mesh(geo, M.iron), mb = new THREE.Mesh(geo, M.iron); b.rotation.y = Math.PI;
      a.add(ma); b.add(mb); ma.castShadow = mb.castShadow = Q.shadows;
      scene.add(a, b);
      D.apply = (t) => { a.rotation.y = -t * 1.75; b.rotation.y = Math.PI + t * 1.75; }; // swings outward
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1, CEIL_Y - 2.55, 3), M.trim); lintel.position.set(4.5, (CEIL_Y + 2.55) / 2, 22.5); add(lintel);
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.3, 0.22), new THREE.MeshBasicMaterial({ color: 0x550000 })); lock.position.set(4.62, 1.3, 22.5); scene.add(lock);
      D.lockLamp = lock;
    } else if (d.kind === 'shelf') {
      const m = new THREE.Mesh(shelfGeo, M.prop); m.castShadow = Q.shadows;
      pivot.position.set(d.x + 0.5, y, d.z + 0.5); pivot.add(m); scene.add(pivot);
      if (d.axis === 'x') m.rotation.y = Math.PI / 2;
      D.apply = (t) => { if (d.axis === 'z') pivot.position.x = d.x + 0.5 + t * 0.97; else pivot.position.z = d.z + 0.5 + t * 0.97; };
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1, top - y - 2.25, 1), M.trim); lintel.position.set(d.x + 0.5, (top + y + 2.25) / 2, d.z + 0.5); add(lintel);
    } else {
      const alongZ = d.axis === 'x'; // passage runs along x -> the panel spans z
      const panel = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 0.07 : 0.98, 2.2, alongZ ? 0.98 : 0.07), M.door);
      panel.castShadow = Q.shadows; panel.receiveShadow = Q.shadows;
      if (alongZ) { pivot.position.set(d.x + 0.5, y, d.z + 0.01); panel.position.set(0, 1.1, 0.49); }
      else { pivot.position.set(d.x + 0.01, y, d.z + 0.5); panel.position.set(0.49, 1.1, 0); }
      pivot.add(panel); scene.add(pivot);
      const dir = (d.id % 2 ? 1 : -1);
      D.apply = (t) => { pivot.rotation.y = t * 1.5 * dir * (alongZ ? 1 : -1); };
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(1, top - y - 2.2, 1), M.trim); lintel.position.set(d.x + 0.5, (top + y + 2.2) / 2, d.z + 0.5); add(lintel);
    }
    world.doors.push(D);
  }
  world.setDoor = (id, open, locked, instant) => {
    const D = world.doors[id]; D.open = !!open; D.locked = !!locked;
    if (instant) { D.t = open ? 1 : 0; D.apply(D.t); }
    if (D.lockLamp) D.lockLamp.material.color.set(open ? 0x003300 : 0x550000);
  };

  // ------------------------------------------------------------ furniture
  function bookshelfGeo(frame, metal = false) {
    const parts = [bx(1, 2.25, 0.04, 0, 1.125, -0.23, frame), bx(0.04, 2.25, 0.5, -0.48, 1.125, 0, frame), bx(0.04, 2.25, 0.5, 0.48, 1.125, 0, frame)];
    const palette = metal ? ['#6b6f5e', '#4f5a5a', '#77705a', '#3f4448', '#5d6b4d'] : ['#5b2b24', '#263b4a', '#3f4a2b', '#5a4a2a', '#2e2a3c', '#6a5d4a', '#40221c'];
    for (let s = 0; s < 5; s++) {
      const y = 0.08 + s * 0.45;
      parts.push(bx(0.92, 0.03, 0.46, 0, y, 0, frame));
      let x = -0.43;
      while (x < 0.4) {
        if (rng() < 0.18) { x += R(0.06, 0.2); continue; } // gaps where books were pulled out
        const w = metal ? R(0.1, 0.22) : R(0.035, 0.085), h = metal ? R(0.12, 0.3) : R(0.2, 0.36);
        if (x + w > 0.44) break;
        parts.push(bx(w, h, metal ? 0.24 : 0.3, x + w / 2, y + 0.015 + h / 2, 0.02, palette[(rng() * palette.length) | 0], 0, rng() < 0.08 ? 0.25 : 0));
        x += w + 0.004;
      }
    }
    return merge(parts);
  }
  const deskGeo = merge([
    bx(0.7, 0.04, 0.48, 0, 0.74, -0.15, '#7a6142'), bx(0.6, 0.1, 0.4, 0, 0.66, -0.15, '#3d3d40'),
    ...[[-0.32, -0.36], [0.32, -0.36], [-0.32, 0.06], [0.32, 0.06]].map(([x, z]) => bx(0.03, 0.74, 0.03, x, 0.37, z, '#2b2b2d')),
    bx(0.38, 0.03, 0.38, 0, 0.44, 0.32, '#5e4a33'), bx(0.38, 0.3, 0.03, 0, 0.78, 0.49, '#5e4a33'),
    ...[[-0.17, 0.15], [0.17, 0.15]].map(([x, z]) => bx(0.025, 0.44, 0.025, x, 0.22, z, '#2b2b2d')),
    ...[[-0.17, 0.49], [0.17, 0.49]].map(([x, z]) => bx(0.025, 0.92, 0.025, x, 0.46, z, '#2b2b2d')),
  ]);
  const tableGeo = (w, top, extra = []) => merge([
    bx(w - 0.1, 0.08, 0.9, 0, 1.02, 0, top),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => bx(0.07, 0.98, 0.07, sx * (w / 2 - 0.12), 0.49, sz * 0.38, '#2b2b2d')),
    bx(w - 0.3, 0.05, 0.05, 0, 0.93, -0.38, '#2b2b2d'), bx(w - 0.3, 0.05, 0.05, 0, 0.93, 0.38, '#2b2b2d'),
    ...extra,
  ]);
  const tableGeos = {
    teacher: tableGeo(2, '#5b4630', [bx(0.3, 0.05, 0.22, -0.5, 1.085, 0.1, '#b8b29c', 0.3), bx(0.08, 0.12, 0.08, 0.6, 1.12, -0.2, '#7a2b22')]),
    lab: tableGeo(3, '#1d1f22', [cy(0.04, 0.05, 0.16, -0.9, 1.14, 0.1, '#51634a'), cy(0.03, 0.03, 0.22, -0.7, 1.17, -0.15, '#6a6f73'), bx(0.4, 0.03, 0.3, 0.7, 1.075, 0, '#4a4d50'), cy(0.05, 0.03, 0.12, 0.2, 1.12, 0.2, '#5a4a3a')]),
    caf: tableGeo(3, '#7d827c', [bx(0.34, 0.03, 0.24, 0.6, 1.075, 0.1, '#8a4a3a', 0.4)]),
    plain2: tableGeo(2, '#5b4630'), plain3: tableGeo(3, '#5b4630'),
    art: tableGeo(2, '#6d6a5e', [bx(0.3, 0.012, 0.25, -0.4, 1.065, 0.1, '#b0381f', 0.5), bx(0.22, 0.012, 0.3, 0.3, 1.065, -0.1, '#2f5fa0', -0.3), bx(0.18, 0.012, 0.18, 0.55, 1.065, 0.25, '#d2a341'), cy(0.05, 0.05, 0.12, -0.7, 1.12, -0.2, '#5a5a5a'), bx(0.4, 0.01, 0.3, 0, 1.064, 0.2, '#e3dccb', 0.2)]),
    nurse: tableGeo(2, '#cfcdc4', [bx(0.32, 0.05, 0.24, -0.4, 1.085, 0.05, '#b8b29c', 0.2), cy(0.04, 0.04, 0.1, 0.5, 1.11, -0.15, '#a33', 8), cy(0.03, 0.03, 0.14, 0.62, 1.13, 0.1, '#ddd', 8)]),
  };
  const lists = { desk: [], teacher: [], lab: [], caf: [], plain2: [], plain3: [], art: [], nurse: [], bookshelf: [], cabinet: [], crate: [] };
  const single = (parts, p, ry = 0) => { const m = new THREE.Mesh(merge(parts), M.prop); m.position.set(p.x, p.y, p.z); m.rotation.y = ry; return add(m); };
  const faceOff = { w: [0.2, 0], e: [-0.2, 0], s: [0, -0.2], n: [0, 0.2] };
  const faceRy = { w: -Math.PI / 2, e: Math.PI / 2, s: 0, n: Math.PI };
  const unlit = [];  // things that glow only when the power is on
  const lureFx = {}; // lure id -> visual state (radio lamp, the swinging great bell)
  world.mannequins = [];

  /** Furniture of the South Wing (v0.9). p = prop from the shared map. */
  function southWingProp(p) {
    const ry = faceRy[p.face] || 0;
    switch (p.t) {
      case 'seats': { // a row of folding theatre seats facing the stage (+z)
        const parts = [bx(p.w, 0.06, 0.08, 0, 0.12, -0.25, '#2b2b2d'), bx(p.w, 0.05, 0.05, 0, 0.42, -0.32, '#2b2b2d')];
        const n = Math.round(p.w / 0.62), sp = p.w / n;
        for (let i = 0; i < n; i++) {
          const x = -p.w / 2 + sp * (i + 0.5), up = rng() < 0.25; // some seats are folded up
          parts.push(bx(0.5, 0.62, 0.07, x, 0.75, -0.32, '#5a1418', 0.05 * (rng() - 0.5)));
          parts.push(up ? bx(0.48, 0.42, 0.06, x, 0.62, -0.2, '#4a1012') : bx(0.48, 0.07, 0.42, x, 0.46, -0.06, '#6a1a1c'));
          parts.push(bx(0.04, 0.5, 0.04, x - sp / 2 + 0.02, 0.25, -0.15, '#222'), bx(0.06, 0.04, 0.4, x - sp / 2 + 0.02, 0.62, -0.08, '#3a2a1e'));
        }
        single(parts, p); break;
      }
      case 'lectern':
        single([bx(0.5, 1.05, 0.38, 0, 0.525, 0, '#4a3220'), bx(0.62, 0.05, 0.48, 0, 1.12, 0.03, '#3a2616', 0, 0), bx(0.3, 0.01, 0.22, 0, 1.15, 0.04, '#d8d0b8', 0.1), cy(0.012, 0.012, 0.3, 0.18, 1.3, -0.1, '#333', 5)], p, ry);
        break;
      case 'greatbell': { // THE last bell: a huge cracked bronze bell in a timber frame
        single([bx(0.16, 2.7, 0.16, -0.9, 1.35, 0, '#3a2818'), bx(0.16, 2.7, 0.16, 0.9, 1.35, 0, '#3a2818'), bx(2.1, 0.18, 0.2, 0, 2.62, 0, '#3a2818'), bx(0.12, 0.12, 0.9, -0.9, 0.06, 0, '#2a1c10'), bx(0.12, 0.12, 0.9, 0.9, 0.06, 0, '#2a1c10')], p);
        const bell = new THREE.Group(); bell.position.set(p.x, p.y + 2.5, p.z);
        const bronze = gloss({ color: 0x5e4520, map: T.grime, roughness: 0.45, metalness: 0.6 });
        const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.52, 0.85, 18, 1, true), bronze); shell.position.y = -0.62; shell.material.side = THREE.DoubleSide;
        const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), bronze); crown.position.y = -0.2;
        const lip = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.035, 6, 20), bronze); lip.rotation.x = Math.PI / 2; lip.position.y = -1.04;
        const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.iron); clapper.position.y = -0.95;
        const crack = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.6), new THREE.MeshBasicMaterial({ color: 0x050302 })); crack.position.set(0.05, -0.7, 0.37); crack.rotation.set(-0.43, 0, 0.12);
        bell.add(shell, crown, lip, clapper, crack); shell.castShadow = Q.shadows; scene.add(bell);
        lureFx[2] = { bell, t: 0 };
        break;
      }
      case 'curtain': { // back wall of the stage + the valance above the stage front
        const back = new THREE.Mesh(new THREE.PlaneGeometry(p.w, CEIL_Y - STAGE_Y), M.curtain); back.position.set(p.x, STAGE_Y + (CEIL_Y - STAGE_Y) / 2, p.z + 0.42); back.rotation.y = Math.PI; scene.add(back);
        const val = new THREE.Mesh(new THREE.PlaneGeometry(p.w, 0.7), M.curtain); val.position.set(p.x, CEIL_Y - 0.35, 52.02); scene.add(val);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(p.w, 0.06, 0.06), M.iron); rail.position.set(p.x, CEIL_Y - 0.72, 52.05); scene.add(rail);
        break;
      }
      case 'drape': { // side wings: crouch behind them
        for (const dz of [0.05, 1.35]) {
          const m = new THREE.Mesh(new THREE.BoxGeometry(1.7, CEIL_Y - STAGE_Y - 0.1, 0.14), M.curtain); m.castShadow = Q.shadows;
          m.position.set(p.x + (p.face === 'e' ? 0.35 : -0.35), STAGE_Y + (CEIL_Y - STAGE_Y) / 2 - 0.05, 52 + dz); scene.add(m);
        }
        break;
      }
      case 'piano': { // upright piano, keyboard facing north
        const parts = [bx(1.6, 1.3, 0.55, 0, 0.65, 0.12, '#24160e'), bx(1.62, 0.06, 0.6, 0, 1.33, 0.12, '#1a0f09'), bx(1.5, 0.08, 0.32, 0, 0.74, -0.28, '#1a0f09'), bx(1.42, 0.03, 0.18, 0, 0.8, -0.3, '#d8d2bf'),
          bx(0.5, 0.36, 0.02, 0, 1.08, -0.16, '#d8d0b8', 0, 0.06), bx(0.1, 0.7, 0.12, -0.72, 0.35, -0.3, '#1a0f09'), bx(0.1, 0.7, 0.12, 0.72, 0.35, -0.3, '#1a0f09')];
        for (let i = 0; i < 20; i++) if (i % 7 !== 2 && i % 7 !== 6) parts.push(bx(0.035, 0.03, 0.1, -0.68 + i * 0.071 + 0.035, 0.83, -0.27, '#111'));
        single(parts, p, ry === Math.PI ? 0 : ry); break;
      }
      case 'stands': { // chairs with music stands in front of them
        const parts = [];
        for (let i = 0; i < p.w; i++) {
          const x = -p.w / 2 + i + 0.5;
          parts.push(bx(0.42, 0.04, 0.4, x, 0.45, 0.12, '#3a3a3e'), bx(0.42, 0.36, 0.04, x, 0.66, 0.3, '#3a3a3e'));
          for (const [lx, lz] of [[-0.18, -0.05], [0.18, -0.05], [-0.18, 0.28], [0.18, 0.28]]) parts.push(bx(0.025, 0.45, 0.025, x + lx, 0.225, lz, '#222'));
          parts.push(cy(0.01, 0.01, 1.0, x, 0.5, -0.3, '#1d1d1f', 5), bx(0.42, 0.3, 0.02, x, 1.05, -0.32, '#1d1d1f', 0, 0), bx(0.32, 0.22, 0.005, x + R(-0.03, 0.03), 1.06, -0.305, '#d6cfb8'));
        }
        single(parts, p); break;
      }
      case 'drums':
        single([cy(0.28, 0.28, 0.4, -0.35, 0.3, 0, '#6a1a1a', 14, 'z'), cy(0.2, 0.2, 0.16, 0.2, 0.62, -0.1, '#d8d0c0', 12), cy(0.16, 0.16, 0.18, 0.15, 0.85, 0.2, '#6a1a1a', 12), cy(0.17, 0.17, 0.2, 0.6, 0.5, 0.15, '#6a1a1a', 12),
          cy(0.01, 0.01, 1.2, 0.75, 0.6, -0.25, '#888', 5), cy(0.22, 0.2, 0.01, 0.75, 1.2, -0.25, '#b8902a', 14), cy(0.012, 0.012, 0.6, 0.2, 0.3, -0.1, '#888', 5)], p);
        break;
      case 'bed': { // tall hospital bed; one of them has someone under the sheet
        const parts = [bx(p.w - 0.1, 0.14, 0.86, 0, 1.06, 0, '#b9b6a8'), bx(p.w - 0.06, 0.03, 0.9, 0, 0.98, 0, '#6d6f70'), bx(0.06, 0.7, 0.9, -p.w / 2 + 0.05, 1.3, 0, '#5d6062'), bx(0.06, 0.45, 0.9, p.w / 2 - 0.05, 1.2, 0, '#5d6062'),
          bx(0.36, 0.1, 0.5, -p.w / 2 + 0.3, 1.18, 0, '#d4d1c6')];
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push(cy(0.025, 0.025, 1.0, sx * (p.w / 2 - 0.08), 0.5, sz * 0.38, '#5d6062', 6));
        if (p.body) parts.push(bx(1.2, 0.16, 0.42, 0.1, 1.2, 0, '#b4b0a2'), cy(0.13, 0.15, 0.2, -0.62, 1.22, 0, '#b4b0a2', 10, 'x'), bx(0.3, 0.12, 0.2, 0.75, 1.17, 0.08, '#8a1a14')); // a shape under the sheet... and a stain
        single(parts, p); break;
      }
      case 'medcab': {
        const parts = [bx(p.w, 0.8, 0.42, 0, 0.4, 0, '#c6c4b8'), bx(p.w, 0.06, 0.42, 0, 1.97, 0, '#c6c4b8'), bx(0.05, 1.2, 0.42, -p.w / 2 + 0.025, 1.4, 0, '#c6c4b8'), bx(0.05, 1.2, 0.42, p.w / 2 - 0.025, 1.4, 0, '#c6c4b8'), bx(p.w, 1.2, 0.03, 0, 1.4, -0.2, '#8f8d84'), bx(p.w - 0.1, 0.02, 0.38, 0, 1.2, 0, '#9a988e'), bx(p.w - 0.1, 0.02, 0.38, 0, 1.6, 0, '#9a988e'), bx(0.04, 1.2, 0.03, 0, 1.4, 0.2, '#c6c4b8')];
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.1, 1.15), gloss({ color: 0x9fb4b8, transparent: true, opacity: 0.18, roughness: 0.1 }));
        glass.position.set(p.x + faceOff[p.face][0], p.y + 1.4, p.z + faceOff[p.face][1] + 0.215); scene.add(glass);
        for (let i = 0; i < 14; i++) parts.push(cy(0.03, 0.03, R(0.08, 0.18), R(-p.w / 2 + 0.2, p.w / 2 - 0.2), [0.95, 1.35, 1.72][i % 3] + 0.06, 0.08, ['#7a3a2a', '#c9c2a8', '#3a5a4a', '#e8e8e0'][i % 4], 6));
        single(parts, { x: p.x + faceOff[p.face][0], y: p.y, z: p.z + faceOff[p.face][1] }, ry); break;
      }
      case 'screen': { // folding privacy screen
        const parts = [];
        for (let i = 0; i < 3; i++) parts.push(bx(0.42, 1.55, 0.02, -0.44 + i * 0.44, 0.95, (i % 2) * 0.12, '#7d9184', 0, 0), bx(0.03, 1.75, 0.03, -0.66 + i * 0.44, 0.88, (i % 2) * 0.06, '#555'));
        single(parts, p, 0.35); break;
      }
      case 'iv': single([cy(0.012, 0.012, 1.9, 0, 0.95, 0, '#999', 5), cy(0.25, 0.25, 0.03, 0, 0.03, 0, '#555', 5), bx(0.12, 0.2, 0.05, 0.08, 1.75, 0, '#c8d0c8'), cy(0.004, 0.004, 0.9, 0.08, 1.2, 0, '#c8d0c8', 4)], p); break;
      case 'easel': {
        const g = single([bx(0.04, 1.75, 0.04, -0.3, 0.86, 0.12, '#6b4a2a', 0, 0.12), bx(0.04, 1.75, 0.04, 0.3, 0.86, 0.12, '#6b4a2a', 0, -0.12), bx(0.04, 1.6, 0.04, 0, 0.8, -0.3, '#6b4a2a'), bx(0.7, 0.04, 0.08, 0, 0.72, 0.16, '#6b4a2a')], p, ry);
        const cv = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.66), std({ map: T.canvas })); cv.position.set(0, 1.1, 0.19); cv.rotation.x = -0.12; g.add(cv);
        break;
      }
      case 'kiln': single([cy(0.4, 0.42, 1.05, 0, 0.53, 0, '#5a5c5e', 12), cy(0.42, 0.42, 0.06, 0, 1.08, 0, '#3a3c3e', 12), bx(0.16, 0.2, 0.04, 0, 0.75, 0.42, '#222'), cy(0.03, 0.03, 0.03, 0, 0.78, 0.45, '#a33', 8, 'z')], p); break;
      case 'mannequin': { // a wooden artist's mannequin. Its head follows you when you are not looking.
        single([cy(0.16, 0.2, 0.04, 0, 0.02, 0, '#3a2a1a', 10), cy(0.02, 0.02, 0.7, 0, 0.37, 0, '#3a2a1a', 6), bx(0.26, 0.44, 0.16, 0, 0.98, 0, '#b38a5a'), bx(0.2, 0.2, 0.14, 0, 0.7, 0, '#b38a5a'),
          cy(0.035, 0.03, 0.55, -0.17, 0.95, 0.02, '#b38a5a', 6), cy(0.035, 0.03, 0.55, 0.17, 0.95, 0.02, '#b38a5a', 6), cy(0.04, 0.035, 0.75, -0.07, 0.37, 0, '#b38a5a', 6), cy(0.04, 0.035, 0.75, 0.07, 0.37, 0, '#b38a5a', 6), cy(0.03, 0.03, 0.1, 0, 1.25, 0, '#b38a5a', 6)], p);
        const head = new THREE.Group(); head.position.set(p.x, p.y + 1.42, p.z);
        const hm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), std({ color: 0xb38a5a })); hm.scale.set(0.9, 1.15, 1);
        const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: 0x0a0505 })); eyes.position.set(0, 0.02, 0.11);
        head.add(hm, eyes); scene.add(head); head.rotation.y = Math.PI / 2;
        world.mannequins.push({ head, x: p.x, y: p.y + 1.42, z: p.z });
        break;
      }
      case 'bucket': single([cy(0.17, 0.14, 0.3, 0, 0.15, 0, '#c9a21e', 10), cy(0.012, 0.012, 1.3, 0.05, 0.75, 0.05, '#7a5a3a', 5), cy(0.07, 0.02, 0.2, 0.08, 0.12, 0.08, '#cfc8b0', 6)], p); break;
      case 'bench': {
        const parts = [bx(p.w - 0.1, 0.06, 0.38, 0, 0.46, 0, '#7a5a38')];
        for (let i = 0; i <= p.w / 2; i++) parts.push(bx(0.06, 0.44, 0.3, -p.w / 2 + 0.2 + i * ((p.w - 0.4) / Math.floor(p.w / 2)), 0.22, 0, '#2b2b2d'));
        single(parts, p);
        const towels = []; for (let i = 0; i < 4; i++) if (rng() < 0.6) towels.push(bx(0.4, 0.04, 0.3, R(-p.w / 2 + 0.4, p.w / 2 - 0.4), 0.51, R(-0.04, 0.04), ['#c8c2b0', '#7a8a9a', '#9a4a3a'][i % 3], R(0, 3)));
        if (towels.length) single(towels, p);
        break;
      }
      case 'showers': {
        const parts = [];
        for (let i = 0; i < 4; i++) { const z = -p.d / 2 + 0.9 + i * 1.7; parts.push(cy(0.02, 0.02, 2.1, 0.92, 1.05, z, '#8a8d8f', 6), cy(0.02, 0.02, 0.3, 0.78, 2.1, z, '#8a8d8f', 6, 'x'), cy(0.08, 0.05, 0.06, 0.64, 2.06, z, '#8a8d8f', 10), bx(0.04, 1.9, 0.9, 0.2, 0.95, z + 0.85, '#7b8a80')); }
        parts.push(cy(0.08, 0.08, 0.01, 0.3, 0.005, 0, '#222', 10));
        single(parts, p); break;
      }
      case 'trophy': {
        const parts = [bx(p.w, 0.9, 0.45, 0, 0.45, 0, '#3a2a1a'), bx(p.w, 0.05, 0.47, 0, 1.92, 0, '#3a2a1a'), bx(0.04, 1.05, 0.45, -p.w / 2 + 0.02, 1.4, 0, '#3a2a1a'), bx(0.04, 1.05, 0.45, p.w / 2 - 0.02, 1.4, 0, '#3a2a1a'), bx(p.w - 0.1, 0.02, 0.4, 0, 1.4, 0, '#5a4a3a')];
        for (let i = 0; i < p.w * 3; i++) { const x = -p.w / 2 + 0.25 + i * 0.32, y = i % 2 ? 1.41 : 0.91; parts.push(cy(0.05, 0.03, 0.14, x, y + 0.2, 0, '#b8902a', 8), cy(0.02, 0.05, 0.06, x, y + 0.04, 0, '#b8902a', 8)); }
        const o = faceOff[p.face] || [0, 0];
        single(parts, { x: p.x + o[0], y: p.y, z: p.z + o[1] }, ry);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.08, 1.0), gloss({ color: 0x1a2226, transparent: true, opacity: 0.35, roughness: 0.1 }));
        glass.position.set(p.x, p.y + 1.4, p.z + o[1] - 0.235); glass.rotation.y = Math.PI; scene.add(glass);
        break;
      }
    }
  }

  for (const p of MAP.props) {
    switch (p.t) {
      case 'desk': lists.desk.push({ x: p.x + R(-0.06, 0.06), y: p.y, z: p.z + R(-0.06, 0.06), ry: (p.r === 2 ? Math.PI : 0) + R(-0.18, 0.18) }); break;
      case 'table': lists[p.teacher ? 'teacher' : p.lab ? 'lab' : p.caf ? 'caf' : p.art ? 'art' : p.nurse ? 'nurse' : p.w === 2 ? 'plain2' : 'plain3'].push({ x: p.x, y: p.y, z: p.z }); break;
      case 'bookshelf': case 'cabinet': {
        const off = faceOff[p.face] || [0, 0];
        const alongZ = p.face ? p.face === 'w' || p.face === 'e' : p.d > p.w;
        const n = alongZ ? p.d : p.w;
        for (let i = 0; i < n; i++) lists[p.t].push({
          x: (alongZ ? p.x : p.x - p.w / 2 + i + 0.5) + off[0], y: p.y, z: (alongZ ? p.z - p.d / 2 + i + 0.5 : p.z) + off[1],
          ry: p.face ? faceRy[p.face] : alongZ ? Math.PI / 2 : 0,
        });
        break;
      }
      case 'crate': {
        lists.crate.push({ x: p.x, y: p.y, z: p.z, ry: p.radio ? 0 : R(-0.2, 0.2), sx: p.w > 1 ? 1.9 : 1 });
        if (p.radio) { // the janitor's old valve radio (a lure)
          single([bx(0.5, 0.3, 0.24, 0, 1.05, 0, '#4a3220'), bx(0.36, 0.2, 0.02, -0.04, 1.06, -0.125, '#c9b98a'), cy(0.03, 0.03, 0.03, 0.17, 1.05, -0.13, '#2a2a2a', 8, 'z'), cy(0.03, 0.03, 0.03, 0.17, 0.97, -0.13, '#2a2a2a', 8, 'z'), cy(0.006, 0.006, 0.55, 0.15, 1.45, 0.05, '#888', 4)], p);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.01), new THREE.MeshBasicMaterial({ color: 0x220000 })); lamp.position.set(p.x + 0.17, p.y + 1.13, p.z - 0.13); scene.add(lamp);
          lureFx[1] = { lamp, t: 0 };
        }
        break;
      }
      case 'counter': single([bx(p.w - 0.08, 1.0, p.d - 0.08, 0, 0.5, 0, '#5f5c52'), bx(p.w, 0.05, p.d, 0, 1.02, 0, '#34352f'), bx(0.3, 0.12, 0.3, -p.w / 4, 1.1, 0, '#6c6f72')], p); break;
      case 'vending': {
        single([bx(0.85, 1.9, 0.85, 0.05, 0.95, 0, '#262b36')], p);
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.1), new THREE.MeshBasicMaterial({ color: 0x000000 }));
        panel.position.set(p.x - 0.385, p.y + 1.15, p.z); panel.rotation.y = -Math.PI / 2; scene.add(panel);
        unlit.push({ mat: panel.material, on: 0x3a5a70 });
        break;
      }
      case 'bleachers': {
        const parts = [];
        for (let k = 0; k < 3; k++) { const h = (k + 1) * 0.3, dpt = p.w / 3; parts.push(bx(dpt, 0.05, p.d, p.w / 2 - dpt * (k + 0.5), h, 0, '#5e4a33'), bx(dpt - 0.02, h - 0.04, p.d - 0.1, p.w / 2 - dpt * (k + 0.5), (h - 0.04) / 2, 0, '#26272a')); }
        single(parts, p); break;
      }
      case 'hoop': {
        const s = p.face === 'n' ? 1 : -1;
        const zw = p.z - s * 0.48;
        single([bx(1.3, 0.85, 0.05, 0, 2.55, 0, '#a8a89c'), bx(0.06, 0.06, 0.35, 0, 2.3, s * 0.18, '#6b2b12')], { x: p.x, y: 0, z: zw });
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.015, 6, 14), std({ color: 0x8a3a12 })); rim.rotation.x = Math.PI / 2; rim.position.set(p.x, 2.3, zw + s * 0.55); scene.add(rim);
        break;
      }
      case 'stalls': {
        const parts = [];
        for (let i = 0; i <= 4; i++) parts.push(bx(0.05, 1.9, 1.6, -3 + i * 1.5, 1.1, -0.2, '#4d6157'));
        for (let i = 0; i < 4; i++) {
          const cx = -2.25 + i * 1.5;
          parts.push(bx(0.38, 0.4, 0.5, cx, 0.2, -0.65, '#b5b8b0'), bx(0.42, 0.4, 0.16, cx, 0.6, -0.9, '#b5b8b0'));
          const a = [0.1, 1.2, 0.5, 1.45][i]; // doors left ajar at different angles
          parts.push(bx(0.72, 1.7, 0.04, cx - 0.37 + Math.cos(a) * 0.36, 1.1, 0.6 + Math.sin(a) * 0.36, '#4d6157', -a));
        }
        single(parts, p); break;
      }
      case 'sinks': {
        const parts = [bx(p.w, 0.12, 0.5, 0, 0.82, 0.22, '#b5b8b0'), bx(p.w - 0.2, 0.7, 0.08, 0, 0.4, 0.42, '#4d4f4c')];
        for (let i = 0; i < p.w; i++) parts.push(bx(0.5, 0.02, 0.3, -p.w / 2 + i + 0.5, 0.885, 0.2, '#2a2c2b'), cy(0.012, 0.012, 0.16, -p.w / 2 + i + 0.5, 0.96, 0.4, '#8a8d8f', 6));
        single(parts, p);
        const mirror = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.2, 0.9), gloss({ color: 0x1a2226, metalness: 0.95, roughness: 0.18 }));
        mirror.position.set(p.x, 1.6, p.z + 0.485); mirror.rotation.y = Math.PI; scene.add(mirror);
        writing("DON'T LOOK BEHIND YOU", p.x, 1.6, p.z + 0.47, Math.PI, 2.6, 0.5, '#3a0606');
        break;
      }
      case 'console': {
        const parts = [bx(0.8, 0.75, p.d - 0.1, 0.1, 0.375, 0, '#303336'), bx(0.9, 0.04, p.d, 0.08, 0.77, 0, '#1c1d1f'), bx(0.3, 0.05, 0.5, -0.1, 0.81, 0, '#101113')];
        for (const zi of [-1.2, 0, 1.2]) parts.push(bx(0.34, 0.5, 0.62, 0.3, 1.07, zi, '#161618'));
        single(parts, p);
        const cv = document.createElement('canvas'); cv.width = 252; cv.height = 192;
        const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
        const smat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000 });
        for (const zi of [-1.2, 0, 1.2]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.4), smat); s.position.set(p.x + 0.125, 1.07, p.z + zi); s.rotation.y = -Math.PI / 2; scene.add(s); }
        world.cam = { cv, ctx: cv.getContext('2d'), tex, mat: smat };
        break;
      }
      case 'bigdesk': single([bx(1.9, 0.74, 0.85, 0, 0.37, 0, '#34241a'), bx(2.0, 0.05, 0.95, 0, 0.765, 0, '#281a12'), bx(0.4, 0.02, 0.3, -0.5, 0.8, 0.1, '#b8b29c', 0.2), cy(0.06, 0.09, 0.3, 0.75, 0.94, -0.2, '#2f4a3a')], p); break;
      case 'portrait': { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.12), std({ map: T.portrait })); m.position.set(p.x, 1.85, p.z - 0.48); scene.add(m); break; }
      case 'board': {
        const s = p.face === 'n' ? 1 : -1;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.15), std({ map: T.board, roughness: 0.95 }));
        m.position.set(p.x, 1.55, p.z - s * 0.47); if (s < 0) m.rotation.y = Math.PI; scene.add(m); break;
      }
      case 'boiler': {
        single([cy(0.85, 0.85, 1.9, 0, 0.95, 0, '#43382f', 14), cy(0.5, 0.85, 0.35, 0, 2.05, 0, '#43382f', 14), cy(0.12, 0.12, 0.9, 0.3, 2.3, 0.2, '#5a3a22'), cy(0.09, 0.09, 1.4, -0.5, 2.0, -0.5, '#4f4f52'), bx(0.9, 0.2, 0.9, 0, 0.1, 0, '#232326')], p);
        const grate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), new THREE.MeshBasicMaterial({ color: 0xff5a14 }));
        grate.position.set(p.x + 0.86, p.y + 0.6, p.z); grate.rotation.y = Math.PI / 2; scene.add(grate);
        world.boiler = { x: p.x + 1.3, y: p.y + 0.95, z: p.z, grate };
        break;
      }
      case 'pipes': {
        const parts = [];
        for (const [dz, r, col] of [[-0.25, 0.07, '#5a3a22'], [0.0, 0.05, '#4f4f52'], [0.2, 0.09, '#3b3d3a']]) parts.push(cy(r, r, p.w, 0, -BASEMENT_Y + BASEMENT_CEIL - 0.25, dz, col, 8, 'x'));
        single(parts, p); break;
      }
      default: southWingProp(p);
    }
  }
  instanced(deskGeo, M.prop, lists.desk);
  for (const k of ['teacher', 'lab', 'caf', 'plain2', 'plain3', 'art', 'nurse']) if (lists[k].length) instanced(tableGeos[k], M.prop, lists[k]);
  instanced(shelfGeo, M.prop, lists.bookshelf);
  instanced(bookshelfGeo('#44484b', true), M.prop, lists.cabinet);
  instanced(merge([bx(0.9, 0.9, 0.9, 0, 0.45, 0, '#5c4a30'), bx(0.94, 0.08, 0.94, 0, 0.1, 0, '#3f321f'), bx(0.94, 0.08, 0.94, 0, 0.8, 0, '#3f321f'), bx(0.08, 0.9, 0.94, 0, 0.45, 0, '#3f321f')]), M.prop, lists.crate);

  // lockers
  {
    const tints = ['#5f7480', '#4f6a63', '#6b5a4d', '#55627a'].map((c) => new THREE.Color(c));
    instanced(new THREE.BoxGeometry(0.9, 1.95, 0.5), M.locker,
      MAP.lockers.map((L) => ({ x: L.x + 0.5 - L.dx * 0.23, y: L.y + 0.975, z: L.z + 0.5 - L.dz * 0.23, ry: Math.atan2(L.dx, L.dz) })),
      (_t, i) => tints[Math.floor(i / 2) % tints.length]);
  }

  // fuse box
  {
    const f = MAP.fuseBox;
    const m = single([bx(0.7, 0.9, 0.14, 0, 0, 0, '#3c4144'), bx(0.6, 0.8, 0.04, 0.02, 0, -0.08, '#555b5e'), bx(0.05, 0.9, 0.2, -0.36, 0, 0, '#2b2e30')], { x: f.x, y: f.y, z: f.z + 0.02 });
    m.rotation.y = 0;
    world.fuseLamps = [0, 1, 2].map((i) => { const l = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.03), new THREE.MeshBasicMaterial({ color: 0x660000 })); l.position.set(f.x - 0.16 + i * 0.16, f.y + 0.18, f.z - 0.09); scene.add(l); return l; });
  }
  world.setFuses = (n) => world.fuseLamps.forEach((l, i) => l.material.color.set(i < n ? 0x22ff44 : 0x660000));

  // ------------------------------------------------------------ windows, writing, stains
  const windowMat = new THREE.MeshBasicMaterial({ map: T.window });
  world.windowMat = windowMat; windowMat.color.setScalar(0.5);
  for (const w of MAP.windows) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 1.4), windowMat);
    m.position.set(w.x + 0.5 + w.nx * 0.505, 1.75, w.z + 0.5 + w.nz * 0.505); m.rotation.y = Math.atan2(w.nx, w.nz); scene.add(m);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.12), M.trim); sill.position.set(w.x + 0.5 + w.nx * 0.55, 1.03, w.z + 0.5 + w.nz * 0.55); sill.rotation.y = m.rotation.y; scene.add(sill);
  }
  function writing(text, x, y, z, ry, w = 3.4, h = 0.85, color) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: writingTexture(text, color), transparent: true, depthWrite: false }));
    m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
  }
  writing('HE STILL TAKES ATTENDANCE', 27, 1.7, 21.012, 0, 3.8);
  writing('CLASS IS NOT DISMISSED', 9.5, 1.75, 23.988, Math.PI, 3.6);
  writing('DO NOT RUN', 47.988, 1.7, 27.5, -Math.PI / 2, 2.4);
  writing('HIDE', 14.012, 1.6, 30, Math.PI / 2, 1.5);
  writing('THE BELL NEVER RANG', 42, 2.0, 25.012, 0, 3.4);
  writing('HE IS ALREADY DOWN HERE', 54, BASEMENT_Y + 1.5, 38.012, 0, 3.6, 0.8, '#5a0a0a');
  writing('QUIET', 40.5, 1.9, 19.988, Math.PI, 1.8);
  // South Wing
  writing('STAY IN YOUR SEATS', 24.5, 2.2, 42.012, 0, 3.6);
  writing('SING FOR HIM', 38.5, 2.1, 42.012, 0, 2.8);
  writing('WHERE IS THOMAS', 54.5, 2.3, 55.988, Math.PI, 3.2);
  writing('THE NURSE IS IN', 39, 2.15, 55.988, Math.PI, 3);
  writing('NO TALKING IN THE HALLS', 31, 1.9, 58.988, Math.PI, 4.2);
  writing('HE CONDUCTS', 14.012, 1.8, 54, Math.PI / 2, 2.2);
  {
    const art = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), std({ map: T.art })); art.position.set(8.5, 1.8, 49.985); art.rotation.y = Math.PI; scene.add(art);
  }

  // ------------------------------------------------------------ decoration: signs, exit signs, clocks, posters, papers, cobwebs
  {
    const isCorr = (x, z) => { const ri = MAP.roomOf[z * W + x]; return ri >= 0 && !!ROOMS[ri].corridor; };
    const nameAt = (x, z) => { const ri = MAP.roomOf[z * W + x]; return ri >= 0 ? ROOMS[ri].name : ''; };
    // brass name plaques above doors, on the side you approach from
    for (const d of MAP.doors) {
      if (d.kind !== 'door') continue;
      const sides = d.axis === 'x' ? [[d.x - 1, d.z, -1, 0], [d.x + 1, d.z, 1, 0]] : [[d.x, d.z - 1, 0, -1], [d.x, d.z + 1, 0, 1]];
      const y = (MAP.level[d.cells[0]] === 2 ? BASEMENT_Y : 0) + (MAP.level[d.cells[0]] === 2 ? 2.42 : 2.62);
      for (const [sx, sz, nx, nz] of sides) {
        const other = sides.find((q) => q[0] !== sx || q[1] !== sz);
        const label = nameAt(other[0], other[1]);
        if (!label || isCorr(other[0], other[1]) || label === nameAt(sx, sz)) continue;
        const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.24), std({ map: signTexture(label === 'Stage' ? 'Backstage' : label) }));
        m.position.set(d.x + 0.5 + nx * 0.515, y, d.z + 0.5 + nz * 0.515); m.rotation.y = Math.atan2(nx, nz); scene.add(m);
      }
    }
    // emergency exit signs: battery-powered, so they glow even in a blackout
    const exitMat = (dir) => new THREE.MeshBasicMaterial({ map: exitTexture(dir), color: 0x9a9a9a });
    const hang = (x, z, ry, dir) => {
      const g = new THREE.Group(); g.position.set(x, CEIL_Y - 0.42, z); g.rotation.y = ry;
      const a = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), exitMat(dir)); a.position.z = 0.012;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), exitMat(-dir)); b.rotation.y = Math.PI; b.position.z = -0.012;
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.27, 0.02), M.iron);
      const wire = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.3, 0.01), M.iron); wire.position.y = 0.28;
      g.add(box, a, b, wire); scene.add(g);
    };
    for (const x of [12, 22, 32, 42]) hang(x, 22.5, Math.PI / 2, 0); // main hall
    hang(14.9, 30, 0, 0); hang(14.9, 14, 0, 0); hang(46.9, 30, 0, 0); hang(46.9, 14, 0, 0); // corridors
    hang(14.9, 48, 0, 0); hang(46.9, 48, 0, 0); hang(30, 57.9, Math.PI / 2, 0);              // south wing
    { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.3), exitMat(0)); m.position.set(5.01, 2.85, 22.5); m.rotation.y = Math.PI / 2; scene.add(m); } // above the gate
    // stopped clocks
    const clockGeo = new THREE.CircleGeometry(0.26, 20), clockMat = std({ map: T.clock });
    const clock = (x, y, z, ry) => { const m = new THREE.Mesh(clockGeo, clockMat); m.position.set(x, y, z); m.rotation.y = ry; scene.add(m); };
    for (const p of MAP.props) if (p.t === 'board') clock(p.x + 2.65, 2.55, p.z - (p.face === 'n' ? 0.475 : -0.475), p.face === 'n' ? 0 : Math.PI);
    clock(26, 2.7, 21.012, 0); clock(24.5, 2.8, 42.012, 0); clock(23.5, 2.6, 24.988, Math.PI); clock(40, 2.6, 25.012, 0);
    // posters and notices on corridor walls (one atlas, four designs)
    const posterSpots = [];
    for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
      if (MAP.grid[z * W + x] !== WALL) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const fx = x + dx, fz = z + dz;
        if (!walkable(fx, fz) || MAP.level[fz * W + fx] !== 0 || !isCorr(fx, fz) || MAP.blocked[fz * W + fx]) continue;
        const along = [[dz, dx], [-dz, -dx]];
        if (along.some(([ax, az]) => MAP.grid[(z + az) * W + x + ax] === 2 || MAP.grid[(fz + az) * W + fx + ax] === 2)) continue; // not next to doors
        if (MAP.lockers.some((L) => Math.abs(L.x - fx) + Math.abs(L.z - fz) <= 1)) continue;
        posterSpots.push({ x: x + 0.5 + dx * 0.505, z: z + 0.5 + dz * 0.505, ry: Math.atan2(dx, dz) });
      }
    }
    const pick4 = [[], [], [], []];
    for (const sp of posterSpots) if (rng() < 0.085) pick4[(rng() * 4) | 0].push({ ...sp, y: R(1.45, 1.75), ry: sp.ry + R(-0.04, 0.04) });
    pick4.forEach((list, i) => {
      if (!list.length) return;
      const g = new THREE.PlaneGeometry(0.55, 0.75); const uv = g.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setX(k, (i + uv.getX(k)) / 4);
      const im = instanced(g, std({ map: T.posters }), list); im.castShadow = false;
    });
    // loose papers on the floors, cobwebs in the corners
    const papers = [];
    for (let i = 0; i < 260; i++) {
      const x = (rng() * W) | 0, z = (rng() * H) | 0, c = z * W + x;
      if (MAP.grid[c] !== 1 || MAP.blocked[c] || MAP.level[c] === 1) continue;
      const room = MAP.roomOf[c] >= 0 ? ROOMS[MAP.roomOf[c]] : null; if (room && room.outside) continue;
      papers.push({ x: x + R(0.15, 0.85), y: levelY(MAP.level[c]) + 0.006 + rng() * 0.004, z: z + R(0.15, 0.85), ry: R(0, 6.28), sx: R(0.7, 1.1), sz: R(0.7, 1.1) });
    }
    const paperMat = std({ map: T.paper, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const pim = instanced(new THREE.PlaneGeometry(0.24, 0.3).rotateX(-Math.PI / 2), paperMat, papers); pim.castShadow = false;
    const webs = [];
    for (const r of ROOMS) {
      if (r.outside || r.stairs || r.secret) continue;
      for (const [cx, cz, a] of [[r.x0, r.z0, 0], [r.x1 + 1, r.z0, -Math.PI / 2], [r.x1 + 1, r.z1 + 1, Math.PI], [r.x0, r.z1 + 1, Math.PI / 2]]) {
        if (rng() > 0.45) continue;
        const top = r.basement ? BASEMENT_CEIL : CEIL_Y;
        webs.push({ x: cx, y: top - 0.02, z: cz, ry: a });
      }
    }
    // flat in the ceiling corner, radiating out from it
    const webGeo = new THREE.PlaneGeometry(0.9, 0.9).translate(0.45, -0.45, 0).rotateX(-Math.PI / 2);
    const wim = instanced(webGeo, new THREE.MeshBasicMaterial({ map: T.web, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, color: 0x8a8a84 }), webs);
    wim.castShadow = false;
  }
  {
    const mat = new THREE.MeshLambertMaterial({ map: T.blood, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const list = [];
    for (let i = 0; i < 26; i++) { const s = MAP.spots[(rng() * MAP.spots.length) | 0]; if (!s.top) list.push({ x: s.x + R(-0.3, 0.3), y: s.y - 0.105, z: s.z + R(-0.3, 0.3), ry: R(0, 6.28), sx: R(0.8, 2.2), sz: R(0.8, 2.2) }); }
    for (const x of [16, 30, 44]) list.push({ x, y: 0.016, z: 22.5 + R(-0.6, 0.6), ry: R(0, 6.28), sx: 2.4, sz: 1.6 });
    const im = instanced(geo, mat, list); im.castShadow = false;
  }

  // ------------------------------------------------------------ ceiling lights (emissive fixtures + a small pool of real lights)
  const fixtures = MAP.lights.map((l) => ({ ...l, lit: false, faulty: rng() < 0.3, phase: R(0, 100), cur: 0 }));
  const fixMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, 0.05, 0.26), new THREE.MeshBasicMaterial({ color: 0xffffff }), fixtures.length);
  const OFF = new THREE.Color(0.035, 0.037, 0.035), ON = new THREE.Color(0.8, 0.95, 0.82), RED = new THREE.Color(0.55, 0.03, 0.02), tmpC = new THREE.Color();
  fixtures.forEach((f, i) => { dummy.position.set(f.x, f.y, f.z); dummy.rotation.set(0, f.alongX ? 0 : Math.PI / 2, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); fixMesh.setMatrixAt(i, dummy.matrix); fixMesh.setColorAt(i, OFF); });
  scene.add(fixMesh);
  const fixCount = fixtures.length, FIRE = new THREE.Color(1, 0.35, 0.12);
  if (world.boiler) fixtures.push({ ...world.boiler, boiler: true, lit: true, phase: 0, cur: 0 });
  // PERFORMANCE: a light costs GPU time on every pixel even at zero brightness. While the power is
  // off only a couple of emergency lamps can be near you, so the rest of the pool is switched off
  // entirely (not just dimmed) until the power comes back.
  const pool = [];
  for (let i = 0; i < Q.lights; i++) { const l = new THREE.PointLight(0xffffff, 0, 11, 2); l.visible = i < Q.darkLights; scene.add(l); pool.push(l); }
  let activeLights = Q.darkLights;
  let flickerT = 0, assignT = 0, nearest = [];
  world.setPower = (on) => { world.power = on; activeLights = on ? Q.lights : Q.darkLights; pool.forEach((l, i) => { l.visible = i < activeLights; }); for (const u of unlit) u.mat.color.set(on ? u.on : 0x000000); if (world.cam) world.cam.mat.color.set(on ? 0xffffff : 0x000000); refreshFixtures(); };
  world.flicker = (secs) => { flickerT = Math.max(flickerT, secs); };
  function refreshFixtures() {
    fixtures.forEach((f, i) => {
      if (f.boiler) return;
      f.lit = f.emergency ? true : world.power && !f.dead;
      fixMesh.setColorAt(i, f.lit ? (f.emergency && !world.power ? RED : ON) : OFF);
    });
    fixMesh.instanceColor.needsUpdate = true;
  }
  refreshFixtures();

  // ------------------------------------------------------------ items
  const glowMat = (color) => new THREE.SpriteMaterial({ map: T.glow, color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  /** from = [x, y, z] it was dropped or tossed from (animated as a short arc), toss = thrown further */
  world.addItem = (it, from = null, toss = false) => {
    if (world.items.has(it.id)) return;
    const g = new THREE.Group();
    const { group: g0, glowColor } = buildItemMesh(it.type);
    g.add(g0);
    const glow = new THREE.Sprite(glowMat(glowColor)); glow.scale.setScalar(0.55); glow.position.y = 0.05; g.add(glow);
    g.position.set(it.x, it.y, it.z); g.rotation.y = (it.id * 2.399) % 6.28;
    scene.add(g);
    const anim = from ? { from, t: 0, dur: toss ? 0.45 : 0.3, h: toss ? 0.9 : 0.15, spin: R(-9, 9) } : null;
    if (anim) g.position.set(from[0], from[1], from[2]);
    world.items.set(it.id, { ...it, mesh: g, glow, anim });
  };
  /** a lure was set off: swing the great bell, light the radio */
  world.lureFx = (id, delay, dur) => { const f = lureFx[id]; if (f) { f.t = -delay; f.dur = dur; } };
  world.removeItem = (id) => {
    const it = world.items.get(id); if (!it) return;
    scene.remove(it.mesh);
    it.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    world.items.delete(id);
  };
  world.clearItems = () => { for (const id of [...world.items.keys()]) world.removeItem(id); };

  // ------------------------------------------------------------ rain in the courtyard
  const RN = 500, rainPos = new Float32Array(RN * 3);
  for (let i = 0; i < RN; i++) { rainPos[i * 3] = R(0.5, 4); rainPos[i * 3 + 1] = R(0, 8); rainPos[i * 3 + 2] = R(18.5, 26.5); }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  scene.add(new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: 0x8fa0b5, size: 0.05, transparent: true, opacity: 0.5 })));

  // ------------------------------------------------------------ security monitors: live floor plan with the Headmaster's position
  const planBg = document.createElement('canvas'); planBg.width = 252; planBg.height = 192;
  const CAM_S = Math.min(252 / W, 178 / H), CAM_OX = (252 - W * CAM_S) / 2, CAM_OY = 2; // the whole school fits on the screen
  {
    const c = planBg.getContext('2d'); c.fillStyle = '#020604'; c.fillRect(0, 0, 252, 192);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (MAP.grid[z * W + x] !== WALL) { c.fillStyle = MAP.grid[z * W + x] === 2 ? '#3a6a3a' : MAP.level[z * W + x] === 2 ? '#0d2a22' : '#123a1c'; c.fillRect(CAM_OX + x * CAM_S, CAM_OY + z * CAM_S, CAM_S + 0.3, CAM_S + 0.3); }
  }
  world.drawCams = (monster, players, t) => {
    const cam = world.cam; if (!cam || !world.power) return;
    const c = cam.ctx; c.drawImage(planBg, 0, 0);
    c.fillStyle = '#7dff9a'; for (const p of players) c.fillRect(CAM_OX + p.x * CAM_S - 2, CAM_OY + p.z * CAM_S - 2, 4, 4);
    if (monster && Math.sin(t * 9) > -0.3) { c.fillStyle = '#ff2a2a'; c.beginPath(); c.arc(CAM_OX + monster.x * CAM_S, CAM_OY + monster.z * CAM_S, 4, 0, 6.28); c.fill(); }
    c.fillStyle = 'rgba(120,255,150,0.08)'; for (let y = (t * 40) % 6; y < 192; y += 6) c.fillRect(0, y, 252, 1.5);
    c.fillStyle = '#7dff9a'; c.font = '10px monospace'; c.fillText('CAM SYS  ●REC   MOTION: ' + (monster ? 'DETECTED' : '----'), 6, 189);
    cam.tex.needsUpdate = true;
  };

  // ------------------------------------------------------------ per-frame
  world.update = (dt, t, cam, camYaw) => {
    for (const D of world.doors) {
      const target = D.open ? 1 : 0;
      if (D.t !== target) { const sp = D.def.kind === 'door' ? 3.2 : 1.1; D.t += Math.sign(target - D.t) * Math.min(Math.abs(target - D.t), dt * sp); D.apply(D.t); }
    }
    // re-pick which fixtures get real lights a few times a second
    assignT -= dt;
    if (assignT <= 0) {
      assignT = 0.3;
      const camBase = cam.y < -1.2;
      nearest.length = 0;
      for (let i = 0; i < fixtures.length; i++) {
        const f = fixtures[i];
        if (!f.lit || (f.y < -0.2) !== camBase) continue;
        const d = (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2;
        if (d < 500) nearest.push({ f, i, d });
      }
      nearest.sort((a, b) => a.d - b.d);
      nearest.length = Math.min(nearest.length, activeLights);
    }
    if (flickerT > 0) flickerT -= dt;
    let dirty = false;
    pool.forEach((l, k) => {
      const o = nearest[k];
      if (!o || !l.visible) { l.intensity = 0; return; }
      const f = o.f;
      if (f.boiler) { l.position.set(f.x, f.y, f.z); l.color.copy(FIRE); l.intensity = 3.5 + Math.sin(t * 9) * 0.6 + Math.sin(t * 23) * 0.4; return; }
      let v = 1;
      if (f.emergency && !world.power) v = 0.75 + 0.25 * Math.sin(t * 2 + f.phase);
      else if (f.faulty) { const n = Math.sin(t * 13 + f.phase) * Math.sin(t * 7.3 + f.phase * 2) * Math.sin(t * 1.7 + f.phase); v = n > 0.25 ? 0.05 : n > 0.1 ? 0.5 : 1; }
      if (flickerT > 0) v *= Math.sin(t * 40 + f.phase) > 0 ? 0.03 : 0.8;
      const red = f.emergency && !world.power;
      l.position.set(f.x, f.y - 0.25, f.z);
      l.color.copy(red ? RED : ON);
      l.intensity = (red ? 7 : 9) * v;
      if (o.i < fixCount && Math.abs(v - f.cur) > 0.02) { f.cur = v; tmpC.copy(red ? RED : ON).multiplyScalar(0.15 + 0.85 * v); fixMesh.setColorAt(o.i, tmpC); dirty = true; }
    });
    if (dirty) fixMesh.instanceColor.needsUpdate = true;
    // items pulse softly so they can be found in the dark; dropped ones arc down to the floor
    for (const it of world.items.values()) {
      it.glow.material.opacity = 0.16 + 0.12 * Math.sin(t * 2.5 + it.id);
      const a = it.anim;
      if (a) {
        a.t += dt; const k = Math.min(1, a.t / a.dur);
        it.mesh.position.set(a.from[0] + (it.x - a.from[0]) * k, a.from[1] + (it.y - a.from[1]) * k + Math.sin(k * Math.PI) * a.h, a.from[2] + (it.z - a.from[2]) * k);
        it.mesh.rotation.x = (1 - k) * a.spin; it.mesh.rotation.z = (1 - k) * a.spin * 0.5;
        if (k >= 1) { it.mesh.rotation.x = 0; it.mesh.rotation.z = 0; it.anim = null; }
      }
    }
    // lures: the great bell swings, the radio lamp glows while it plays
    for (const id in lureFx) {
      const f = lureFx[id]; if (f.dur === undefined) continue;
      f.t += dt; const on = f.t >= 0 && f.t < f.dur;
      if (f.bell) f.bell.rotation.z = on ? Math.sin(f.t * 5.2) * 0.42 * Math.min(1, (f.dur - f.t) / 1.5) : f.bell.rotation.z * 0.9;
      if (f.lamp) f.lamp.material.color.setHex(on ? (Math.sin(t * 30) > -0.6 ? 0xff7a2a : 0x7a2a0a) : f.t < 0 ? (Math.sin(t * 6) > 0 ? 0x661100 : 0x220000) : 0x220000);
      if (f.t > f.dur + 2) f.dur = undefined;
    }
    // the mannequin's head turns to face you whenever you are not looking at it
    if (camYaw !== undefined) for (const mq of world.mannequins) {
      const dx = cam.x - mq.x, dz = cam.z - mq.z, d = Math.hypot(dx, dz);
      if (d > 12 || Math.abs(cam.y - mq.y) > 2.5) continue;
      const look = (-Math.sin(camYaw) * -dx + -Math.cos(camYaw) * -dz) / (d || 1);
      if (look > 0.55 && d > 1.2) continue; // being watched: perfectly still
      const want = Math.atan2(dx, dz); let diff = want - mq.head.rotation.y; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
      mq.head.rotation.y += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.4);
    }
    // rain
    if (cam.x < 16 && cam.y > -1) { // only simulated when the courtyard can actually be seen
      for (let i = 0; i < RN; i++) { rainPos[i * 3 + 1] -= dt * 14; if (rainPos[i * 3 + 1] < 0) rainPos[i * 3 + 1] = 8; }
      rainGeo.attributes.position.needsUpdate = true;
    }
  };

  return world;
}
