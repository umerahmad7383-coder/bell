// Rapier collision world + first-person kinematic character controller.
// No Three.js in here, so it can also be exercised headlessly in Node (test/physics.js).
import { MAP, W, H, WALL, STAIRS, BASEMENT_Y, STAGE_Y, floorY } from '../shared/map.js';

export const PLAYER_R = 0.3;
export const STAND_HALF = 0.55;   // capsule half-height standing  (total 1.7 m)
export const CROUCH_HALF = 0.15;  // crouching (total 0.9 m — fits under tables)
export const EYE_STAND = 1.6, EYE_CROUCH = 0.72, EYE_DOWNED = 0.4;

export function buildPhysics(RAPIER) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const box = (cx, cy, cz, hx, hy, hz) => world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz));

  // --- walls & floors, merged into runs along x ---
  for (let z = 0; z < H; z++) {
    let x = 0;
    while (x < W) {
      const c = z * W + x;
      const kind = MAP.grid[c] === WALL ? -1 : MAP.level[c];
      let x1 = x + 1;
      while (x1 < W && (MAP.grid[z * W + x1] === WALL ? -1 : MAP.level[z * W + x1]) === kind) x1++;
      const cx = (x + x1) / 2, hx = (x1 - x) / 2;
      if (kind === -1) box(cx, 0.1, z + 0.5, hx, 3.4, 0.5);
      else if (kind === 0) box(cx, -0.25, z + 0.5, hx, 0.25, 0.5);
      else if (kind === 2) box(cx, BASEMENT_Y - 0.25, z + 0.5, hx, 0.25, 0.5);
      else if (kind === 3) box(cx, STAGE_Y - 0.25, z + 0.5, hx, 0.25, 0.5); // the stage: a step up you can walk onto
      x = x1;
    }
  }
  // --- stairs: one smooth ramp (visual steps are drawn on top of it) ---
  {
    const run = STAIRS.x1 - STAIRS.x0, drop = -BASEMENT_Y;
    const len = Math.hypot(run, drop), ang = Math.atan2(drop, run);
    const nx = drop / len, ny = run / len; // surface normal
    const t = 0.2;
    const cx = (STAIRS.x0 + STAIRS.x1) / 2 - nx * t, cy = BASEMENT_Y / 2 - ny * t, cz = (STAIRS.z0 + STAIRS.z1) / 2;
    const q = { x: 0, y: 0, z: Math.sin(-ang / 2), w: Math.cos(-ang / 2) };
    world.createCollider(RAPIER.ColliderDesc.cuboid(len / 2 + 0.05, t, (STAIRS.z1 - STAIRS.z0) / 2).setTranslation(cx, cy, cz).setRotation(q));
  }

  // --- doors (collider is simply switched off while the door is open) ---
  const doorColliders = MAP.doors.map((d) => {
    const y = MAP.level[d.cells[0]] === 2 ? BASEMENT_Y : 0;
    if (d.kind === 'gate') return box(4.5, 1.3, 22.5, 0.1, 1.3, 1.5);
    if (d.kind === 'shelf') return box(d.x + 0.5, y + 1.15, d.z + 0.5, 0.5, 1.15, 0.3);
    return d.axis === 'x' ? box(d.x + 0.5, y + 1.1, d.z + 0.5, 0.07, 1.1, 0.5) : box(d.x + 0.5, y + 1.1, d.z + 0.5, 0.5, 1.1, 0.07);
  });

  // --- furniture ---
  for (const p of MAP.props) {
    const y = p.y;
    const off = { w: [0.2, 0], e: [-0.2, 0], s: [0, -0.2], n: [0, 0.2] }[p.face] || [0, 0];
    switch (p.t) {
      case 'desk': {
        const s = p.r === 2 ? -1 : 1;
        box(p.x, y + 0.38, p.z - 0.15 * s, 0.36, 0.38, 0.25);
        box(p.x, y + 0.24, p.z + 0.3 * s, 0.2, 0.24, 0.18);
        break;
      }
      case 'table': box(p.x, y + 1.02, p.z, p.w / 2 - 0.05, 0.04, 0.45); break;
      case 'bookshelf': case 'cabinet':
        if (p.w >= p.d) box(p.x + off[0], y + 1.1, p.z + off[1], p.w / 2, 1.1, 0.27);
        else box(p.x + off[0], y + 1.1, p.z + off[1], 0.27, 1.1, p.d / 2);
        break;
      case 'counter': box(p.x, y + 0.5, p.z, p.w / 2 - 0.04, 0.5, p.d / 2 - 0.04); break;
      case 'vending': box(p.x + 0.05, y + 0.95, p.z, 0.42, 0.95, 0.44); break;
      case 'crate': box(p.x, y + 0.45, p.z, p.w / 2 - 0.06, 0.45, p.d / 2 - 0.06); break;
      case 'bleachers':
        for (let k = 0; k < 3; k++) {
          const h = (k + 1) * 0.3, dpt = p.w / 3;
          box(p.x + p.w / 2 - dpt * (k + 0.5), y + h / 2, p.z, dpt / 2, h / 2, p.d / 2);
        }
        break;
      case 'stalls': {
        const z0 = p.z - p.d / 2;
        for (let i = 0; i <= 4; i++) box(p.x - 3 + i * 1.5, y + 1.0, z0 + 0.8, 0.03, 1.0, 0.8);
        for (let i = 0; i < 4; i++) box(p.x - 2.25 + i * 1.5, y + 0.22, z0 + 0.35, 0.2, 0.22, 0.3);
        break;
      }
      case 'sinks': box(p.x, y + 0.45, p.z + 0.22, p.w / 2, 0.45, 0.28); break;
      case 'console': box(p.x + 0.1, y + 0.45, p.z, 0.4, 0.45, p.d / 2); break;
      case 'bigdesk': box(p.x, y + 0.4, p.z, 0.95, 0.4, 0.42); break;
      case 'boiler': box(p.x, y + 1.1, p.z, 0.9, 1.1, 0.9); break;
      // ---- South Wing ----
      case 'seats': box(p.x, y + 0.5, p.z, p.w / 2, 0.5, 0.36); break;
      case 'lectern': box(p.x, y + 0.6, p.z, 0.3, 0.6, 0.25); break;
      case 'greatbell': box(p.x, y + 1.2, p.z, p.w / 2 - 0.1, 1.2, 0.4); break;
      case 'piano': box(p.x, y + 0.65, p.z + 0.1, p.w / 2 - 0.05, 0.65, 0.32); break;
      case 'stands': case 'bench': box(p.x, y + 0.25, p.z, p.w / 2 - 0.05, 0.25, 0.3); break;
      case 'drums': box(p.x, y + 0.45, p.z, p.w / 2 - 0.1, 0.45, 0.4); break;
      case 'bed': box(p.x, y + 1.08, p.z, p.w / 2 - 0.02, 0.08, 0.45); break; // high frame: you can crawl underneath
      case 'medcab': box(p.x + off[0], y + 1.0, p.z + off[1], p.w / 2, 1.0, 0.25); break;
      case 'easel': box(p.x, y + 0.8, p.z, 0.3, 0.8, 0.3); break;
      case 'kiln': box(p.x, y + 0.55, p.z, 0.42, 0.55, 0.42); break;
      case 'mannequin': box(p.x, y + 0.9, p.z, 0.22, 0.9, 0.22); break;
      case 'screen': box(p.x, y + 0.9, p.z, 0.45, 0.9, 0.12); break;
      case 'iv': box(p.x, y + 0.95, p.z, 0.12, 0.95, 0.12); break;
      case 'trophy': box(p.x + off[0], y + 1.0, p.z + off[1], p.w / 2, 1.0, 0.27); break;
    }
  }
  for (const L of MAP.lockers) {
    box(L.x + 0.5 - L.dx * 0.22, L.y + 1.0, L.z + 0.5 - L.dz * 0.22, L.dz ? 0.46 : 0.27, 1.0, L.dx ? 0.46 : 0.27);
  }

  // --- the local player ---
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(STAND_HALF, PLAYER_R), body);
  const cc = world.createCharacterController(0.02);
  cc.enableAutostep(0.35, 0.15, false);
  cc.enableSnapToGround(0.45);
  cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  cc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
  cc.setSlideEnabled(true);

  const st = { half: STAND_HALF, vy: 0, grounded: true };
  const api = {
    world, body, collider, cc, doorColliders,
    setDoor(id, open) { doorColliders[id].setEnabled(!open); },
    /** feet position */
    getFeet() { const t = body.translation(); return { x: t.x, y: t.y - st.half - PLAYER_R, z: t.z }; },
    teleport(x, y, z) {
      body.setTranslation({ x, y: y + st.half + PLAYER_R + 0.02, z }, true);
      body.setNextKinematicTranslation({ x, y: y + st.half + PLAYER_R + 0.02, z });
      st.vy = 0;
      world.step(api.events || undefined);
    },
    setCrouch(on) {
      const half = on ? CROUCH_HALF : STAND_HALF;
      if (half === st.half) return;
      const feet = api.getFeet();
      st.half = half;
      if (collider.setHalfHeight) collider.setHalfHeight(half); else collider.setShape(new RAPIER.Capsule(half, PLAYER_R));
      body.setTranslation({ x: feet.x, y: feet.y + half + PLAYER_R, z: feet.z }, true);
    },
    isCrouched() { return st.half === CROUCH_HALF; },
    /** advance the simulation without moving you (spectating, menus, cut-scenes): props keep falling and rolling */
    idle(dt) { world.timestep = dt; world.step(api.events || undefined); },
    /** Is there a table directly overhead (can't stand up)? */
    lowCeiling() {
      const f = api.getFeet();
      for (const [dx, dz] of [[0, 0], [PLAYER_R, 0], [-PLAYER_R, 0], [0, PLAYER_R], [0, -PLAYER_R]]) {
        const cx = Math.floor(f.x + dx), cz = Math.floor(f.z + dz);
        if (cx >= 0 && cz >= 0 && cx < W && cz < H && MAP.cover[cz * W + cx]) return true;
      }
      return false;
    },
    /** Move by a horizontal velocity (m/s) for dt seconds. Gravity handled here. */
    move(vx, vz, dt) {
      world.timestep = dt;
      st.vy = st.grounded ? -2 : Math.max(-20, st.vy - 22 * dt);
      // loose props and other people's bodies never block you (you shove the props instead): only fixed geometry counts
      cc.computeColliderMovement(collider, { x: vx * dt, y: st.vy * dt, z: vz * dt }, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
      const m = cc.computedMovement();
      st.grounded = cc.computedGrounded();
      const t = body.translation();
      const nx = t.x + m.x, ny = t.y + m.y, nz = t.z + m.z;
      body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
      world.step(api.events || undefined);
      // safety net: never fall out of the world
      const fy = floorY(nx, nz);
      if (ny - st.half - PLAYER_R < fy - 1.5) api.teleport(nx, fy, nz);
      return st.grounded;
    },
  };
  return api;
}
