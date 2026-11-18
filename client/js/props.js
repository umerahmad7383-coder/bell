// Loose clutter that you, your friends and the Headmaster knock around: real rigid bodies in the same Rapier
// world as the walls, so a sprint down a corridor sends bins rolling and cans skittering, and you can hear
// him coming by what he crashes through. Each client simulates its own copy (it is atmosphere, not gameplay),
// seeded from the map so everyone starts with the same mess.
import * as THREE from 'three';
import { MAP } from '../shared/map.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from '../vendor/jsm/geometries/RoundedBoxGeometry.js';

function mulberry(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
const paint = (g, color) => { const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const ni = (g) => (g.index ? g.toNonIndexed() : g);
const join = (parts) => mergeGeometries(parts.map((g) => { g = ni(g); if (g.attributes.uv) g.deleteAttribute('uv'); if (g.attributes.uv1) g.deleteAttribute('uv1'); return g; }));

// geometry is built around the body's centre of mass; collider = what Rapier simulates
const KINDS = {
  bin: { // dented metal waste bin
    geo: () => join([paint(lathe([[0.15, -0.25], [0.18, -0.24], [0.2, 0.22], [0.215, 0.235], [0.215, 0.25], [0.195, 0.25], [0.18, -0.22], [0, -0.22]], 18), '#5c6266')]),
    col: (R) => R.ColliderDesc.cylinder(0.25, 0.2), mass: 2.2, rough: 0.45, metal: 0.6, sound: 'metal', yOff: 0.25,
  },
  bucket: { // a mop bucket's little cousin
    geo: () => join([paint(lathe([[0.11, -0.14], [0.13, -0.135], [0.155, 0.13], [0.162, 0.14], [0.15, 0.14], [0.125, -0.12], [0, -0.12]], 16), '#2f5f9a'),
      paint(new THREE.TorusGeometry(0.15, 0.006, 6, 18, Math.PI).translate(0, 0.14, 0), '#9aa0a4')]),
    col: (R) => R.ColliderDesc.cylinder(0.14, 0.155), mass: 0.7, rough: 0.5, metal: 0, sound: 'plastic', yOff: 0.14,
  },
  box: { // cardboard box, flaps up
    geo: () => join([paint(new RoundedBoxGeometry(0.46, 0.32, 0.36, 2, 0.012), '#9a7a4e'), paint(new THREE.BoxGeometry(0.47, 0.06, 0.02).translate(0, 0.0, 0.181), '#c8b48a')]),
    col: (R) => R.ColliderDesc.cuboid(0.23, 0.16, 0.18), mass: 1.1, rough: 0.95, metal: 0, sound: 'card', yOff: 0.16,
  },
  chair: { // plywood seat and back on a steel frame
    geo: () => {
      const p = [paint(new RoundedBoxGeometry(0.4, 0.025, 0.38, 2, 0.008).translate(0, 0.0, 0.0), '#8a6236'), paint(new RoundedBoxGeometry(0.4, 0.24, 0.022, 2, 0.008).translate(0, 0.3, -0.19).rotateX(-0.08), '#8a6236')];
      for (const [x, z] of [[-0.17, -0.16], [0.17, -0.16], [-0.17, 0.16], [0.17, 0.16]]) p.push(paint(new THREE.CylinderGeometry(0.011, 0.011, 0.44, 6).translate(x, -0.23, z), '#3a3d40'));
      for (const x of [-0.17, 0.17]) p.push(paint(new THREE.CylinderGeometry(0.011, 0.011, 0.42, 6).translate(x, 0.2, -0.185), '#3a3d40'));
      return join(p);
    },
    col: (R) => [R.ColliderDesc.cuboid(0.2, 0.235, 0.19).setTranslation(0, -0.22, 0), R.ColliderDesc.cuboid(0.2, 0.15, 0.02).setTranslation(0, 0.28, -0.19)],
    mass: 3.5, rough: 0.6, metal: 0.2, sound: 'wood', yOff: 0.455,
  },
  can: {
    geo: () => join([paint(lathe([[0, -0.06], [0.024, -0.06], [0.033, -0.05], [0.033, 0.05], [0.026, 0.06], [0, 0.06]], 12), '#b8262a')]),
    col: (R) => R.ColliderDesc.cylinder(0.06, 0.033), mass: 0.04, rough: 0.3, metal: 0.6, sound: 'tin', yOff: 0.06, ccd: true,
  },
  book: {
    geo: () => join([paint(new RoundedBoxGeometry(0.17, 0.035, 0.24, 1, 0.004), '#5a2a22'), paint(new THREE.BoxGeometry(0.155, 0.028, 0.232).translate(0.009, 0, 0), '#e2dbc6')]),
    col: (R) => R.ColliderDesc.cuboid(0.085, 0.0175, 0.12), mass: 0.35, rough: 0.8, metal: 0, sound: 'book', yOff: 0.018,
  },
  ball: { // a gym basketball: bounces
    geo: () => join([paint(new THREE.SphereGeometry(0.12, 20, 14), '#b4561e')]),
    col: (R) => R.ColliderDesc.ball(0.12).setRestitution(0.72), mass: 0.6, rough: 0.7, metal: 0, sound: 'ball', yOff: 0.12, ccd: true, roll: true,
  },
  sign: { // yellow wet-floor sign
    geo: () => { const a = new THREE.BoxGeometry(0.28, 0.6, 0.012); return join([paint(a.clone().rotateX(0.2).translate(0, 0, 0.06), '#e2c21c'), paint(a.clone().rotateX(-0.2).translate(0, 0, -0.06), '#e2c21c')]); },
    col: (R) => R.ColliderDesc.cuboid(0.14, 0.3, 0.11), mass: 0.6, rough: 0.4, metal: 0, sound: 'plastic', yOff: 0.3,
  },
  paint: { // paint tin
    geo: () => join([paint(lathe([[0, -0.07], [0.09, -0.07], [0.092, -0.065], [0.092, 0.065], [0.088, 0.07], [0, 0.07]], 16), '#8d9093'), paint(new THREE.CylinderGeometry(0.0925, 0.0925, 0.07, 16, 1, true), '#d8d2bc')]),
    col: (R) => R.ColliderDesc.cylinder(0.07, 0.092), mass: 1.4, rough: 0.4, metal: 0.5, sound: 'metal', yOff: 0.07,
  },
  tray: {
    geo: () => join([paint(new RoundedBoxGeometry(0.45, 0.022, 0.33, 2, 0.008), '#6c7c62')]),
    col: (R) => R.ColliderDesc.cuboid(0.225, 0.011, 0.165), mass: 0.35, rough: 0.35, metal: 0, sound: 'plastic', yOff: 0.011,
  },
  paper: { // crumpled paper ball
    geo: () => { const g = new THREE.IcosahedronGeometry(0.045, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 0.75 + Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } g.computeVertexNormals(); return join([paint(g, '#dcd6c4')]); },
    col: (R) => R.ColliderDesc.ball(0.042), mass: 0.01, rough: 1, metal: 0, sound: 'paper', yOff: 0.042, ccd: true,
  },
};
// what lies around where
const SETS = {
  corridor: ['bin', 'bin', 'bucket', 'sign', 'box', 'can', 'can', 'paper', 'paper', 'chair'],
  Cafeteria: ['tray', 'tray', 'tray', 'can', 'can', 'can', 'chair', 'chair', 'bin', 'paper'],
  Gymnasium: ['ball', 'ball', 'ball', 'ball', 'ball', 'sign', 'bucket'],
  Library: ['book', 'book', 'book', 'book', 'book', 'book', 'chair', 'paper'],
  'Hidden Archive': ['book', 'book', 'box', 'box'],
  'Storage Room': ['box', 'box', 'box', 'paint', 'bucket'],
  "Janitor's Closet": ['bucket', 'bucket', 'sign', 'paint', 'box'],
  basement: ['paint', 'paint', 'bucket', 'box', 'box', 'can'],
  'Art Room': ['paint', 'paint', 'chair', 'paper', 'paper', 'book'],
  'Locker Room': ['ball', 'can', 'bin', 'paper', 'book'],
  Auditorium: ['paper', 'paper', 'can', 'book'],
  room: ['chair', 'chair', 'book', 'paper', 'paper', 'can', 'bin'],
};
const PER_ROOM = { corridor: 0.06, room: 0.07 };

export class Props {
  constructor(scene, ph, RAPIER, Q, audio) {
    this.ph = ph; this.R = RAPIER; this.audio = audio; this.list = []; this.byHandle = new Map(); this.pushers = new Map();
    const rng = mulberry(424242);
    // pick spots room by room
    const want = [];
    const byRoom = new Map();
    for (const s of MAP.spots) { if (s.top) continue; (byRoom.get(s.room) || byRoom.set(s.room, []).get(s.room)).push(s); }
    for (const [room, spots] of byRoom) {
      const corridor = /Corridor|Hall|Wing|Stairwell/.test(room), base = /Basement|Cellar|Boiler/.test(room);
      if (/Courtyard|Basement Stairs|Stage/.test(room)) continue;
      const set = SETS[room] || (base ? SETS.basement : corridor ? SETS.corridor : SETS.room);
      const n = Math.min(spots.length, Math.max(2, Math.round(spots.length * (corridor ? PER_ROOM.corridor : PER_ROOM.room) * (Q.propScale || 1))));
      for (let i = 0; i < n; i++) {
        const s = spots.splice((rng() * spots.length) | 0, 1)[0];
        const kind = set[(rng() * set.length) | 0];
        const k = KINDS[kind];
        // a tipped-over bin or chair here and there; small things lie however they fell
        const tip = (kind === 'chair' || kind === 'bin' || kind === 'bucket' || kind === 'paint') && rng() < 0.35;
        want.push({ kind, x: s.x + (rng() - 0.5) * 0.4, z: s.z + (rng() - 0.5) * 0.4, y: s.y - 0.12, ry: rng() * 6.283, tip, rz: (rng() - 0.5) * 0.6 });
        // books come in little heaps
        if (kind === 'book' && rng() < 0.6) for (let b = 1; b < 3; b++) want.push({ kind, x: s.x + (rng() - 0.5) * 0.1, z: s.z + (rng() - 0.5) * 0.1, y: s.y - 0.12 + b * 0.04, ry: rng() * 6.283, tip: false });
      }
    }
    // meshes: one instanced mesh per kind (one draw call each, shadows included)
    const counts = {}; for (const w of want) counts[w.kind] = (counts[w.kind] || 0) + 1;
    this.inst = {};
    for (const kind of Object.keys(counts)) {
      const k = KINDS[kind];
      const mat = Q.gloss ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: k.rough, metalness: k.metal }) : new THREE.MeshLambertMaterial({ vertexColors: true });
      const im = new THREE.InstancedMesh(k.geo(), mat, counts[kind]);
      im.castShadow = !!Q.shadows; im.receiveShadow = !!Q.shadows; im.frustumCulled = false; im.count = 0;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(im); this.inst[kind] = im;
    }
    // bodies
    const q = new THREE.Quaternion(), e = new THREE.Euler();
    for (const w of want) {
      const k = KINDS[w.kind];
      if (w.tip) e.set(Math.PI / 2, w.ry, w.rz || 0, 'YXZ'); else e.set(0, w.ry, 0);
      q.setFromEuler(e);
      const lift = w.tip ? { bin: 0.21, bucket: 0.16, paint: 0.095, chair: 0.25 }[w.kind] || 0.1 : k.yOff;
      const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(w.x, w.y + lift + 0.01, w.z).setRotation(q)
        .setLinearDamping(0.25).setAngularDamping(k.roll ? 0.15 : 0.7).setCanSleep(true).setCcdEnabled(!!k.ccd);
      const body = ph.world.createRigidBody(desc);
      const cols = [].concat(k.col(RAPIER));
      const each = k.mass / cols.length;
      for (const cd of cols) {
        cd.setMass(each).setFriction(k.roll ? 0.9 : 0.65).setCollisionGroups(0x0002ffff)
          .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS).setContactForceEventThreshold(Math.max(0.6, k.mass * 6));
        if (!k.roll) cd.setRestitution(0.12);
        const c = ph.world.createCollider(cd, body);
        this.byHandle.set(c.handle, this.list.length);
      }
      const im = this.inst[w.kind];
      this.list.push({ kind: w.kind, k, body, im, slot: im.count++, last: 0 });
    }
    this.events = new RAPIER.EventQueue(true);
    this.m4 = new THREE.Matrix4(); this.p = new THREE.Vector3(); this.qq = new THREE.Quaternion(); this.one = new THREE.Vector3(1, 1, 1);
    this.time = 0; this.settled = false;
    for (const it of this.list) this.write(it);
    for (const im of Object.values(this.inst)) im.instanceMatrix.needsUpdate = true;
  }
  write(it) {
    const t = it.body.translation(), r = it.body.rotation();
    this.p.set(t.x, t.y, t.z); this.qq.set(r.x, r.y, r.z, r.w);
    this.m4.compose(this.p, this.qq, this.one); it.im.setMatrixAt(it.slot, this.m4);
  }
  /** someone else's body (a teammate, the Headmaster) that shoves props aside: a kinematic capsule */
  pusher(id, x, y, z, half = 0.55, r = 0.3) {
    let p = this.pushers.get(id);
    if (!p) {
      const R = this.R;
      const body = this.ph.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + half + r, z));
      // only props feel it: it never blocks you (the character controller ignores everything that moves)
      this.ph.world.createCollider(R.ColliderDesc.capsule(half, r).setCollisionGroups(0x00040002), body);
      p = { body, seen: 0 }; this.pushers.set(id, p);
    }
    p.body.setNextKinematicTranslation({ x, y: y + half + r, z }); p.seen = this.time;
  }
  /** after the physics step: move the meshes of everything awake, and play the knocks */
  update(dt, listener) {
    this.time += dt;
    for (const [id, p] of this.pushers) if (this.time - p.seen > 2) { this.ph.world.removeRigidBody(p.body); this.pushers.delete(id); }
    const dirty = new Set();
    for (const it of this.list) {
      if (it.body.isSleeping()) continue;
      this.write(it); dirty.add(it.im);
      const t = it.body.translation();
      if (t.y < -20) { it.body.setTranslation({ x: t.x, y: 2, z: t.z }, true); it.body.setLinvel({ x: 0, y: 0, z: 0 }, true); } // fell out of the world
    }
    for (const im of dirty) im.instanceMatrix.needsUpdate = true;
    // impacts -> sound, louder for harder hits; a few per frame at most
    let sounds = 0;
    this.events.drainContactForceEvents((ev) => {
      if (sounds >= 3 || !this.settled) return;
      const i = this.byHandle.get(ev.collider1()) ?? this.byHandle.get(ev.collider2());
      if (i === undefined) return;
      const it = this.list[i];
      if (this.time - it.last < 0.14) return;
      const f = ev.totalForceMagnitude() / (it.k.mass * 30);
      if (f < 0.25) return;
      const t = it.body.translation();
      if (listener && (t.x - listener.x) ** 2 + (t.z - listener.z) ** 2 > 400) return;
      it.last = this.time; sounds++;
      if (this.audio && this.audio.impact) this.audio.impact([t.x, t.y, t.z], it.k.sound, Math.min(1.4, f));
    });
    if (!this.settled && this.time > 1.5) this.settled = true; // the first second is everything settling onto the floor: silent
  }
  dispose() {
    for (const im of Object.values(this.inst)) { im.removeFromParent(); im.geometry.dispose(); im.material.dispose(); }
  }
}
