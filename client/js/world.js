// Builds the abandoned school (visuals) from the shared map.
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { MAP, W, H, WALL, ROOMS, CEIL_Y, BASEMENT_Y, BASEMENT_CEIL, STAIRS, ceilY } from '../shared/map.js';
import { writingTexture } from './textures.js';

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
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  const M = {
    wall: std({ map: T.wall }),
    concrete: std({ map: T.concrete }),
    lino: std({ map: T.lino, roughness: 0.55 }),
    wood: std({ map: T.wood, roughness: 0.6 }),
    ceiling: std({ map: T.ceiling }),
    prop: std({ map: T.grime, vertexColors: true, roughness: 0.8 }),
    door: std({ map: T.door, roughness: 0.7 }),
    locker: std({ map: T.locker, roughness: 0.55, metalness: 0.45 }),
    iron: std({ color: 0x1b1c1e, roughness: 0.5, metalness: 0.7 }),
    trim: std({ color: 0x5d5a4c, map: T.grime }),
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
  {
    const upper = [], lower = [];
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (MAP.grid[z * W + x] !== WALL) continue;
      let up = false, low = false;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!walkable(x + dx, z + dz)) continue;
        const lv = MAP.level[(z + dz) * W + x + dx];
        if (lv < 2) up = true;
        if (lv >= 1) low = true;
      }
      if (up) upper.push({ x: x + 0.5, y: CEIL_Y / 2, z: z + 0.5 });
      if (low) lower.push({ x: x + 0.5, y: BASEMENT_Y / 2, z: z + 0.5 });
    }
    const tint = () => { const v = R(0.88, 1); return new THREE.Color(v, v * R(0.97, 1), v * R(0.94, 1)); };
    instanced(new THREE.BoxGeometry(1, CEIL_Y, 1), M.wall, upper, tint);
    instanced(new THREE.BoxGeometry(1, -BASEMENT_Y, 1), M.concrete, lower, tint);
  }

  // ------------------------------------------------------------ floors & ceilings
  {
    const fl = { lino: new Quads(), wood: new Quads(), concrete: new Quads() };
    const ce = { ceiling: new Quads(), concrete: new Quads() };
    const woodRooms = new Set(['Gymnasium', 'Library', "Principal's Office", 'Hidden Archive']);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      const c = z * W + x;
      if (MAP.grid[c] === WALL) continue;
      const lv = MAP.level[c], room = MAP.roomOf[c] >= 0 ? ROOMS[MAP.roomOf[c]] : null;
      if (lv !== 1) {
        const mat = lv === 2 || (room && room.outside) ? 'concrete' : room && woodRooms.has(room.name) ? 'wood' : 'lino';
        fl[mat].flat(x, z, x + 1, z + 1, lv === 2 ? BASEMENT_Y : 0, true, 0.5);
      }
      if (!(room && room.outside)) (lv === 2 ? ce.concrete : ce.ceiling).flat(x, z, x + 1, z + 1, ceilY(x, z), false, 1 / 1.2);
    }
    for (const k in fl) add(new THREE.Mesh(fl[k].build(), M[k]), false, true);
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
  };
  const lists = { desk: [], teacher: [], lab: [], caf: [], plain2: [], plain3: [], bookshelf: [], cabinet: [], crate: [] };
  const single = (parts, p, ry = 0) => { const m = new THREE.Mesh(merge(parts), M.prop); m.position.set(p.x, p.y, p.z); m.rotation.y = ry; return add(m); };
  const faceOff = { w: [0.2, 0], e: [-0.2, 0], s: [0, -0.2], n: [0, 0.2] };
  const faceRy = { w: -Math.PI / 2, e: Math.PI / 2, s: 0, n: Math.PI };
  const unlit = [];  // things that glow only when the power is on

  for (const p of MAP.props) {
    switch (p.t) {
      case 'desk': lists.desk.push({ x: p.x + R(-0.06, 0.06), y: p.y, z: p.z + R(-0.06, 0.06), ry: (p.r === 2 ? Math.PI : 0) + R(-0.18, 0.18) }); break;
      case 'table': lists[p.teacher ? 'teacher' : p.lab ? 'lab' : p.caf ? 'caf' : p.w === 2 ? 'plain2' : 'plain3'].push({ x: p.x, y: p.y, z: p.z }); break;
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
      case 'crate': lists.crate.push({ x: p.x, y: p.y, z: p.z, ry: R(-0.2, 0.2), sx: p.w > 1 ? 1.9 : 1 }); break;
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
        const mirror = new THREE.Mesh(new THREE.PlaneGeometry(p.w - 0.2, 0.9), std({ color: 0x1a2226, metalness: 0.95, roughness: 0.18 }));
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
        const l = new THREE.PointLight(0xff5a1e, 4, 8, 2); l.position.set(p.x + 1.3, p.y + 0.7, p.z); scene.add(l);
        world.boiler = { light: l, grate };
        break;
      }
      case 'pipes': {
        const parts = [];
        for (const [dz, r, col] of [[-0.25, 0.07, '#5a3a22'], [0.0, 0.05, '#4f4f52'], [0.2, 0.09, '#3b3d3a']]) parts.push(cy(r, r, p.w, 0, -BASEMENT_Y + BASEMENT_CEIL - 0.25, dz, col, 8, 'x'));
        single(parts, p); break;
      }
    }
  }
  instanced(deskGeo, M.prop, lists.desk);
  for (const k of ['teacher', 'lab', 'caf', 'plain2', 'plain3']) if (lists[k].length) instanced(tableGeos[k], M.prop, lists[k]);
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
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: writingTexture(text, color), transparent: true, roughness: 1, depthWrite: false }));
    m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
  }
  writing('HE STILL TAKES ATTENDANCE', 27, 1.7, 21.012, 0, 3.8);
  writing('CLASS IS NOT DISMISSED', 9.5, 1.75, 23.988, Math.PI, 3.6);
  writing('DO NOT RUN', 47.988, 1.7, 27.5, -Math.PI / 2, 2.4);
  writing('HIDE', 14.012, 1.6, 30, Math.PI / 2, 1.5);
  writing('THE BELL NEVER RANG', 42, 2.0, 25.012, 0, 3.4);
  writing('HE IS ALREADY DOWN HERE', 54, BASEMENT_Y + 1.5, 38.012, 0, 3.6, 0.8, '#5a0a0a');
  writing('QUIET', 40.5, 1.9, 19.988, Math.PI, 1.8);
  {
    const mat = new THREE.MeshStandardMaterial({ map: T.blood, transparent: true, roughness: 0.35, depthWrite: false });
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
  const pool = [];
  for (let i = 0; i < Q.lights; i++) { const l = new THREE.PointLight(0xffffff, 0, 11, 2); scene.add(l); pool.push(l); }
  let flickerT = 0, assignT = 0, nearest = [];
  world.setPower = (on) => { world.power = on; for (const u of unlit) u.mat.color.set(on ? u.on : 0x000000); if (world.cam) world.cam.mat.color.set(on ? 0xffffff : 0x000000); refreshFixtures(); };
  world.flicker = (secs) => { flickerT = Math.max(flickerT, secs); };
  function refreshFixtures() {
    fixtures.forEach((f, i) => {
      f.lit = f.emergency ? true : world.power && !f.dead;
      fixMesh.setColorAt(i, f.lit ? (f.emergency && !world.power ? RED : f.emergency ? ON : ON) : OFF);
    });
    fixMesh.instanceColor.needsUpdate = true;
  }
  refreshFixtures();

  // ------------------------------------------------------------ items
  const glowMat = (color) => new THREE.SpriteMaterial({ map: T.glow, color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending });
  const em = (color, emissive, o = {}) => std({ color, emissive, emissiveIntensity: 0.5, roughness: 0.5, ...o });
  const itemBuilders = {
    fuse: () => [[new THREE.CylinderGeometry(0.035, 0.035, 0.12, 8).rotateZ(Math.PI / 2), em(0xd9a441, 0x8a4a00, { transparent: true, opacity: 0.85 })], [new THREE.CylinderGeometry(0.038, 0.038, 0.03, 8).rotateZ(Math.PI / 2).translate(0.07, 0, 0), em(0x9a9a9a, 0x222222)], [new THREE.CylinderGeometry(0.038, 0.038, 0.03, 8).rotateZ(Math.PI / 2).translate(-0.07, 0, 0), em(0x9a9a9a, 0x222222)], 0xffa030],
    key_principal: () => [[new THREE.TorusGeometry(0.035, 0.01, 6, 12).rotateX(Math.PI / 2), em(0xc9a23a, 0x5a4200)], [new THREE.BoxGeometry(0.1, 0.012, 0.015).translate(0.085, 0, 0), em(0xc9a23a, 0x5a4200)], [new THREE.BoxGeometry(0.015, 0.012, 0.03).translate(0.12, 0, 0.02), em(0xc9a23a, 0x5a4200)], 0xffd060],
    key_gate: () => [[new THREE.TorusGeometry(0.05, 0.014, 6, 12).rotateX(Math.PI / 2), em(0x8fa3b5, 0x1d3550)], [new THREE.BoxGeometry(0.16, 0.016, 0.02).translate(0.13, 0, 0), em(0x8fa3b5, 0x1d3550)], [new THREE.BoxGeometry(0.02, 0.016, 0.05).translate(0.19, 0, 0.03), em(0x8fa3b5, 0x1d3550)], 0x60b0ff],
    battery: () => [[new THREE.CylinderGeometry(0.03, 0.03, 0.11, 8).rotateZ(Math.PI / 2), em(0x2f8d3a, 0x0c3a10)], [new THREE.CylinderGeometry(0.012, 0.012, 0.02, 6).rotateZ(Math.PI / 2).translate(0.065, 0, 0), em(0xbba040, 0x332200)], 0x60ff80],
    medkit: () => [[new THREE.BoxGeometry(0.26, 0.14, 0.2).translate(0, 0.05, 0), em(0xd8d8d0, 0x333333)], [new THREE.BoxGeometry(0.12, 0.004, 0.04).translate(0, 0.123, 0), em(0xb01010, 0x700000)], [new THREE.BoxGeometry(0.04, 0.004, 0.12).translate(0, 0.123, 0), em(0xb01010, 0x700000)], 0xff7070],
    lockpick: () => [[new THREE.BoxGeometry(0.16, 0.006, 0.012).rotateY(0.3), em(0xb8bcc0, 0x333333, { metalness: 0.8 })], [new THREE.BoxGeometry(0.16, 0.006, 0.012).rotateY(-0.4), em(0xb8bcc0, 0x333333, { metalness: 0.8 })], 0xd0d0ff],
    bottle: () => [[new THREE.CylinderGeometry(0.038, 0.038, 0.18, 8).translate(0, 0.04, 0), em(0x2f5a3a, 0x0a2010, { transparent: true, opacity: 0.8, roughness: 0.15 })], [new THREE.CylinderGeometry(0.014, 0.03, 0.09, 8).translate(0, 0.175, 0), em(0x2f5a3a, 0x0a2010, { transparent: true, opacity: 0.8, roughness: 0.15 })], 0x70c090],
    bell: () => [[new THREE.CylinderGeometry(0.025, 0.07, 0.1, 10).translate(0, 0.0, 0), em(0xb8902a, 0x4a3500, { metalness: 0.7, roughness: 0.3 })], [new THREE.CylinderGeometry(0.014, 0.014, 0.1, 6).translate(0, 0.1, 0), em(0x3a2a1a, 0x000000)], 0xffc040],
    note: () => [[new THREE.BoxGeometry(0.2, 0.004, 0.27), em(0xcfc8b0, 0x55523f)], 0xfff0c0],
  };
  world.addItem = (it) => {
    if (world.items.has(it.id)) return;
    const g = new THREE.Group();
    const def = itemBuilders[it.type]();
    const glowColor = def.pop();
    for (const [geo, mat] of def) g.add(new THREE.Mesh(geo, mat));
    const glow = new THREE.Sprite(glowMat(glowColor)); glow.scale.setScalar(0.55); glow.position.y = 0.05; g.add(glow);
    g.position.set(it.x, it.y, it.z); g.rotation.y = (it.id * 2.399) % 6.28;
    scene.add(g);
    world.items.set(it.id, { ...it, mesh: g, glow });
  };
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
  {
    const c = planBg.getContext('2d'); c.fillStyle = '#020604'; c.fillRect(0, 0, 252, 192);
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (MAP.grid[z * W + x] !== WALL) { c.fillStyle = MAP.grid[z * W + x] === 2 ? '#3a6a3a' : MAP.level[z * W + x] === 2 ? '#0d2a22' : '#123a1c'; c.fillRect(x * 4, z * 4, 4, 4); }
  }
  world.drawCams = (monster, players, t) => {
    const cam = world.cam; if (!cam || !world.power) return;
    const c = cam.ctx; c.drawImage(planBg, 0, 0);
    c.fillStyle = '#7dff9a'; for (const p of players) c.fillRect(p.x * 4 - 2, p.z * 4 - 2, 4, 4);
    if (monster && Math.sin(t * 9) > -0.3) { c.fillStyle = '#ff2a2a'; c.beginPath(); c.arc(monster.x * 4, monster.z * 4, 4, 0, 6.28); c.fill(); }
    c.fillStyle = 'rgba(120,255,150,0.08)'; for (let y = (t * 40) % 6; y < 192; y += 6) c.fillRect(0, y, 252, 1.5);
    c.fillStyle = '#7dff9a'; c.font = '10px monospace'; c.fillText('CAM SYS  ●REC   MOTION: ' + (monster ? 'DETECTED' : '----'), 6, 186);
    cam.tex.needsUpdate = true;
  };

  // ------------------------------------------------------------ per-frame
  world.update = (dt, t, cam) => {
    for (const D of world.doors) {
      const target = D.open ? 1 : 0;
      if (D.t !== target) { const sp = D.def.kind === 'door' ? 3.2 : 1.1; D.t += Math.sign(target - D.t) * Math.min(Math.abs(target - D.t), dt * sp); D.apply(D.t); }
    }
    // re-pick which fixtures get real lights a few times a second
    assignT -= dt;
    if (assignT <= 0) {
      assignT = 0.3;
      const camBase = cam.y < -1.2;
      nearest = fixtures.map((f, i) => ({ f, i, d: f.lit && (f.y < -0.2) === camBase ? (f.x - cam.x) ** 2 + (f.z - cam.z) ** 2 : 1e9 })).filter((o) => o.d < 600).sort((a, b) => a.d - b.d).slice(0, pool.length);
    }
    if (flickerT > 0) flickerT -= dt;
    let dirty = false;
    pool.forEach((l, k) => {
      const o = nearest[k];
      if (!o) { l.intensity = 0; return; }
      const f = o.f;
      let v = 1;
      if (f.emergency && !world.power) v = 0.75 + 0.25 * Math.sin(t * 2 + f.phase);
      else if (f.faulty) { const n = Math.sin(t * 13 + f.phase) * Math.sin(t * 7.3 + f.phase * 2) * Math.sin(t * 1.7 + f.phase); v = n > 0.25 ? 0.05 : n > 0.1 ? 0.5 : 1; }
      if (flickerT > 0) v *= Math.sin(t * 40 + f.phase) > 0 ? 0.03 : 0.8;
      const red = f.emergency && !world.power;
      l.position.set(f.x, f.y - 0.25, f.z);
      l.color.copy(red ? RED : ON);
      l.intensity = (red ? 7 : 9) * v;
      if (Math.abs(v - f.cur) > 0.02) { f.cur = v; tmpC.copy(red ? RED : ON).multiplyScalar(0.15 + 0.85 * v); fixMesh.setColorAt(o.i, tmpC); dirty = true; }
    });
    if (dirty) fixMesh.instanceColor.needsUpdate = true;
    if (world.boiler) world.boiler.light.intensity = 3.5 + Math.sin(t * 9) * 0.6 + Math.sin(t * 23) * 0.4;
    // items pulse softly so they can be found in the dark
    for (const it of world.items.values()) it.glow.material.opacity = 0.16 + 0.12 * Math.sin(t * 2.5 + it.id);
    // rain
    for (let i = 0; i < RN; i++) { rainPos[i * 3 + 1] -= dt * 14; if (rainPos[i * 3 + 1] < 0) rainPos[i * 3 + 1] = 8; }
    rainGeo.attributes.position.needsUpdate = true;
  };

  return world;
}
