// The Headmaster and the other students — built from primitives and animated in code.
import * as THREE from 'three';
import { nameTexture } from './textures.js';
import { LOOKS, ITEM_TYPES, cleanLook } from '../shared/defs.js';
import { buildItemMesh } from './items.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const limb = (r1, r2, len, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 7), mat); m.position.y = -len / 2; m.castShadow = true; return m; };

export const PLAYER_COLORS = ['#c9584c', '#4c8fc9', '#5fb86a', '#d2a341', '#9a66c9', '#4cc3b8', '#d27a9e', '#b9b9b0'];

/** Extremely tall, long-limbed figure in a ruined uniform. Model faces +Z. */
export class MonsterModel {
  constructor(T) {
    const skin = new THREE.MeshLambertMaterial({ color: 0x8a877a });
    const cloth = new THREE.MeshLambertMaterial({ map: T.uniform, color: 0x9a9a9a });
    const g = (this.group = new THREE.Group());
    const hips = (this.hips = new THREE.Group()); hips.position.y = 1.2; g.add(hips);
    const spine = (this.spine = new THREE.Group()); hips.add(spine);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.86, 0.22), cloth); torso.position.y = 0.43; torso.castShadow = true; spine.add(torso);
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.13, 0.25), cloth); shoulders.position.y = 0.82; shoulders.castShadow = true; spine.add(shoulders);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.02), new THREE.MeshLambertMaterial({ color: 0x3a0a0a })); tie.position.set(0, 0.52, 0.118); tie.rotation.z = 0.08; spine.add(tie);
    for (const sx of [-1, 1]) { const tail = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.4, 0.03), cloth); tail.position.set(sx * 0.11, -0.16, -0.1); tail.rotation.x = 0.12; tail.rotation.z = sx * 0.05; spine.add(tail); }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.26, 7), skin); neck.position.y = 0.99; spine.add(neck);
    const head = (this.head = new THREE.Group()); head.position.y = 1.1; spine.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), new THREE.MeshLambertMaterial({ map: T.face }));
    skull.scale.set(0.17, 0.27, 0.19); skull.position.y = 0.2; skull.castShadow = true; head.add(skull);
    // two faint glints so you sometimes see it watching from the dark before you see anything else
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xcfd0c0, fog: false });
    this.eyes = [-1, 1].map((sx) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 6), eyeMat); e.position.set(sx > 0 ? 0.059 : -0.066, sx > 0 ? 0.265 : 0.283, sx > 0 ? 0.177 : 0.171); head.add(e); return e; });

    this.arms = [-1, 1].map((sx) => {
      const sh = new THREE.Group(); sh.position.set(sx * 0.31, 0.8, 0); spine.add(sh);
      sh.add(limb(0.045, 0.036, 0.66, cloth));
      const el = new THREE.Group(); el.position.y = -0.66; sh.add(el);
      el.add(limb(0.034, 0.026, 0.7, skin));
      const hand = new THREE.Group(); hand.position.y = -0.7; el.add(hand);
      for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.27, 4), skin); f.position.set((i - 1.5) * 0.022, -0.14, 0); f.rotation.x = Math.PI; f.rotation.z = (i - 1.5) * 0.09; hand.add(f); }
      return { sh, el, sx };
    });
    this.legs = [-1, 1].map((sx) => {
      const hip = new THREE.Group(); hip.position.set(sx * 0.11, 0, 0); hips.add(hip);
      hip.add(limb(0.065, 0.05, 0.62, cloth));
      const knee = new THREE.Group(); knee.position.y = -0.62; hip.add(knee);
      knee.add(limb(0.048, 0.036, 0.56, cloth));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.26), new THREE.MeshLambertMaterial({ color: 0x0c0c0c })); foot.position.set(0, -0.57, 0.08); knee.add(foot);
      return { hip, knee, sx };
    });
    this.phase = 0; this.twitchT = 1; this.twitch = new THREE.Vector3(); this.pose = 0; this.crawlK = 0; this.attackK = 0;
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  }

  /** state: server monster state code, speed: m/s over ground, crawl: bool */
  update(dt, t, state, speed, crawl) {
    const chase = state === 3, attack = state === 4, stalk = state === 6;
    this.phase += speed * dt * (crawl ? 3.2 : 2.0);
    const ph = this.phase, s = Math.sin(ph), c = Math.cos(ph);
    const k = Math.min(1, dt * 7);
    this.crawlK = lerp(this.crawlK, crawl ? 1 : 0, Math.min(1, dt * 3));
    this.pose = lerp(this.pose, chase ? 1 : 0, k);
    this.attackK = lerp(this.attackK, attack ? 1 : 0, Math.min(1, dt * 12));
    const ck = this.crawlK, pk = this.pose, ak = this.attackK;
    const moving = Math.min(1, speed / 1.2);

    this.hips.position.y = lerp(1.2 - Math.abs(s) * 0.035 * moving, 0.46 + Math.abs(s) * 0.03, ck);
    this.spine.rotation.x = lerp(0.16 + pk * 0.32 + ak * 0.2, 1.42, ck);
    this.spine.rotation.z = s * 0.04 * moving;
    this.spine.rotation.y = lerp(0, s * 0.25, ck);

    for (const L of this.legs) {
      const sw = L.sx > 0 ? s : -s, cw = L.sx > 0 ? c : -c;
      L.hip.rotation.x = lerp(-sw * 0.5 * moving, -1.25 + sw * 0.55, ck);
      L.hip.rotation.z = lerp(0, L.sx * 0.75, ck);
      L.knee.rotation.x = lerp(Math.max(0, cw) * 0.75 * moving + 0.05, 2.0 - sw * 0.4, ck);
    }
    for (const A of this.arms) {
      const sw = A.sx > 0 ? -s : s;
      const walkX = sw * 0.28 * moving + 0.06;
      const chaseX = -1.25 + sw * 0.22;
      const atkX = -2.5 + Math.sin(t * 30) * 0.05;
      const crawlX = -1.7 + sw * 0.6;
      A.sh.rotation.x = lerp(lerp(lerp(walkX, chaseX, pk), atkX, ak), crawlX, ck);
      A.sh.rotation.z = lerp(A.sx * (0.07 + pk * 0.18), A.sx * 0.65, ck);
      A.el.rotation.x = lerp(lerp(-0.12 - pk * 0.5, -0.9, ak), -0.5 - Math.max(0, sw) * 0.5, ck);
    }
    // head: mostly still, with sudden wrong-looking snaps
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      const big = Math.random() < (chase ? 0.6 : 0.3);
      this.twitch.set((Math.random() - 0.5) * (big ? 0.7 : 0.15), (Math.random() - 0.5) * (big ? 1.0 : 0.2), (Math.random() - 0.5) * (big ? 1.1 : 0.2));
      this.twitchT = big ? 0.12 + Math.random() * 0.2 : chase ? 0.2 + Math.random() * 0.5 : 0.8 + Math.random() * 3;
    }
    const hk = Math.min(1, dt * 25);
    this.head.rotation.x = lerp(this.head.rotation.x, this.twitch.x + lerp(-0.1, -1.25, ck), hk);
    this.head.rotation.y = lerp(this.head.rotation.y, this.twitch.y, hk);
    this.head.rotation.z = lerp(this.head.rotation.z, this.twitch.z + (stalk ? 0.45 : 0), hk);
  }
}

const BUILDS = [{ w: 1, h: 1 }, { w: 0.88, h: 1 }, { w: 1.15, h: 1 }, { w: 1, h: 0.92 }, { w: 1, h: 1.07 }];
const HELD_POSE = { // how each item sits in a closed right hand: [x, y, z, rotX, rotZ, scale]
  fuse: [0, -0.02, 0.05, 0, 0, 1], key_principal: [0, -0.02, 0.06, 0, 0, 1.2], key_gate: [0, -0.02, 0.06, 0, 0, 1.1], battery: [0, -0.02, 0.05, 0, 0, 1],
  medkit: [0, -0.1, 0.05, 0, 0, 0.75], lockpick: [0, -0.02, 0.07, 0, 0, 1], bottle: [0, -0.06, 0.03, -1.3, 0, 1], bell: [0, -0.12, 0.04, 3.14, 0, 1],
};

/**
 * A student. Fully procedural: two-segment arms and legs, pelvis/shoulder counter-rotation,
 * knee flex on the swing leg, and separate poses for crouching, sprinting, limping and crawling.
 * Appearance comes from a "look" (see shared/defs.js). Model faces +Z.
 *   opts.firstPerson  no head or name tag: used for your own body
 *   opts.noTag        no floating name (character creator preview)
 */
export class PlayerModel {
  constructor(name, colorIndex, look, opts = {}) {
    look = cleanLook(look, colorIndex);
    this.fp = !!opts.firstPerson;
    const M = (color) => new THREE.MeshLambertMaterial({ color });
    const top = M(LOOKS.top[look.top]), pants = M(LOOKS.pants[look.pants]), skin = M(LOOKS.skin[look.skin]);
    const shoes = M(LOOKS.shoes[look.shoes]), hairM = M(LOOKS.hairColor[look.hairColor]), dark = M(0x1c1e24);
    const mesh = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = !this.fp; return m; };
    const seg = (r1, r2, len, mat) => mesh(new THREE.CylinderGeometry(r1, r2, len, 8), mat, 0, -len / 2, 0);

    const g = (this.group = new THREE.Group());
    const root = (this.root = new THREE.Group()); g.add(root);
    const b = BUILDS[look.build]; root.scale.set(b.w, b.h, b.w);
    const hips = (this.hips = new THREE.Group()); hips.position.y = 0.91; root.add(hips);
    hips.add(mesh(new THREE.BoxGeometry(0.33, 0.17, 0.2), pants, 0, -0.03, 0));
    const spine = (this.spine = new THREE.Group()); spine.position.y = 0.05; hips.add(spine);
    spine.add(mesh(new THREE.BoxGeometry(0.38, 0.46, 0.21), top, 0, 0.23, 0));
    spine.add(mesh(new THREE.BoxGeometry(0.42, 0.1, 0.22), top, 0, 0.42, 0)); // shoulders
    if (look.extra === 0 || look.extra === 2) {
      spine.add(mesh(new THREE.BoxGeometry(0.3, 0.36, 0.13), dark, 0, 0.26, -0.17));
      for (const sx of [-1, 1]) spine.add(mesh(new THREE.BoxGeometry(0.045, 0.4, 0.23), dark, sx * 0.13, 0.28, -0.005));
    }

    // head (left out in first person so the camera is not inside it)
    const head = (this.head = new THREE.Group()); head.position.y = 0.5; spine.add(head);
    if (!this.fp) {
      head.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.08, 8), skin, 0, 0.02, 0));
      head.add(mesh(new THREE.SphereGeometry(0.118, 14, 12), skin, 0, 0.15, 0));
      for (const sx of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.014, 6, 6), dark, sx * 0.042, 0.165, 0.108));
      head.add(mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), skin, 0, 0.14, 0.12));
      const cap = (r, theta, mat, tilt = -0.3) => { const m = mesh(new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI * theta), mat, 0, 0.15, 0); m.rotation.x = tilt; return m; };
      const style = LOOKS.hair[look.hair], hat = LOOKS.hat[look.hat];
      if (hat === 'Hood up') head.add(cap(0.142, 0.72, top, -0.5));
      else {
        if (style !== 'Bald') head.add(cap(0.125, 0.52, hairM));
        if (style === 'Long') head.add(mesh(new THREE.BoxGeometry(0.22, 0.26, 0.07), hairM, 0, 0.06, -0.085));
        if (style === 'Spiky') for (let i = 0; i < 7; i++) { const c = mesh(new THREE.ConeGeometry(0.03, 0.09, 5), hairM, Math.cos(i * 0.9) * 0.06, 0.265, Math.sin(i * 0.9) * 0.06 - 0.02); c.rotation.set(Math.sin(i * 0.9) * 0.5 - 0.2, 0, -Math.cos(i * 0.9) * 0.5); head.add(c); }
        if (style === 'Ponytail') { head.add(mesh(new THREE.SphereGeometry(0.04, 8, 8), hairM, 0, 0.2, -0.125)); const t = mesh(new THREE.CylinderGeometry(0.028, 0.012, 0.2, 6), hairM, 0, 0.1, -0.15); t.rotation.x = -0.35; head.add(t); }
        if (hat === 'Cap') { head.add(mesh(new THREE.CylinderGeometry(0.124, 0.128, 0.075, 14), top, 0, 0.235, 0)); head.add(mesh(new THREE.BoxGeometry(0.17, 0.014, 0.12), top, 0, 0.205, 0.15)); }
        if (hat === 'Beanie') head.add(cap(0.132, 0.46, top, -0.12));
      }
      if (look.extra === 1 || look.extra === 2) {
        for (const sx of [-1, 1]) { const r = mesh(new THREE.TorusGeometry(0.026, 0.005, 5, 12), dark, sx * 0.042, 0.165, 0.118); head.add(r); }
        head.add(mesh(new THREE.BoxGeometry(0.03, 0.006, 0.006), dark, 0, 0.167, 0.12));
      }
    }

    this.arms = [-1, 1].map((sx) => {
      const sh = new THREE.Group(); sh.position.set(sx * 0.235, 0.42, 0); spine.add(sh);
      sh.add(seg(0.052, 0.045, 0.28, top));
      const el = new THREE.Group(); el.position.y = -0.28; sh.add(el);
      el.add(seg(0.043, 0.036, 0.25, top));
      const hand = new THREE.Group(); hand.position.y = -0.27; el.add(hand);
      hand.add(mesh(new THREE.BoxGeometry(0.06, 0.085, 0.07), skin, 0, -0.02, 0.005));
      return { sh, el, hand, sx, x: 0, z: 0, e: 0 };
    });
    this.legs = [-1, 1].map((sx) => {
      const hip = new THREE.Group(); hip.position.set(sx * 0.095, -0.06, 0); hips.add(hip);
      hip.add(seg(0.078, 0.06, 0.42, pants));
      const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee);
      knee.add(seg(0.057, 0.045, 0.4, pants));
      const foot = new THREE.Group(); foot.position.y = -0.39; knee.add(foot);
      foot.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.26), shoes, 0, 0, 0.06));
      return { hip, knee, foot, sx };
    });

    // left hand: torch.  right hand: whatever is selected in the inventory
    const torch = (this.torch = new THREE.Group()); torch.position.set(0, -0.03, 0.03); this.arms[0].hand.add(torch);
    const tb = mesh(new THREE.CylinderGeometry(0.024, 0.02, 0.17, 8), dark); tb.rotation.x = Math.PI / 2; tb.position.z = 0.05; torch.add(tb);
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.023, 10), new THREE.MeshBasicMaterial({ color: 0xfff2c0 })); this.lens.position.z = 0.136; torch.add(this.lens);
    this.holder = new THREE.Group(); this.arms[1].hand.add(this.holder);
    this.heldCode = 0;

    if (!this.fp && !opts.noTag) {
      const tag = (this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name, PLAYER_COLORS[colorIndex % PLAYER_COLORS.length]), transparent: true, opacity: 0.85, depthWrite: false })));
      tag.scale.set(1.3, 0.325, 1); tag.position.y = 1.95; g.add(tag);
    }
    this.phase = 0; this.mv = 0; this.runK = 0; this.crouchK = 0; this.downK = 0; this.hurtK = 0; this.t = Math.random() * 10;
  }

  /** code = index into ITEM_TYPES (0 = empty hand) */
  setHeld(code) {
    if (code === this.heldCode) return;
    this.heldCode = code;
    this.holder.clear();
    const type = ITEM_TYPES[code];
    if (!type) return;
    const { group } = buildItemMesh(type);
    const p = HELD_POSE[type] || [0, 0, 0.05, 0, 0, 1];
    group.position.set(p[0], p[1], p[2]); group.rotation.set(p[3], 0, p[4]); group.scale.setScalar(p[5]);
    this.holder.add(group);
  }
  setArmVisible(i, v) { this.arms[i].sh.visible = v; }

  /** o: { speed, crouch, downed, pitch, flash, hurt } */
  update(dt, o) {
    const k = (r) => Math.min(1, dt * r);
    this.t += dt;
    const sp = o.speed || 0, t = this.t;
    this.mv = lerp(this.mv, clamp(sp / 1.1, 0, 1), k(8));
    this.runK = lerp(this.runK, clamp((sp - 3.2) / 1.8, 0, 1), k(6));
    this.crouchK = lerp(this.crouchK, o.crouch && !o.downed ? 1 : 0, k(9));
    this.downK = lerp(this.downK, o.downed ? 1 : 0, k(5));
    this.hurtK = lerp(this.hurtK, o.hurt ? 1 : 0, k(3));
    const mv = this.mv, run = this.runK, ck = this.crouchK, dk = this.downK, hk = this.hurtK * (1 - run * 0.5);
    // cadence rises with speed: ~1.9 steps/s strolling, ~4 steps/s sprinting
    if (sp > 0.15) this.phase += (2.6 + sp * 1.95) * dt * (1 + ck * 0.3);
    const ph = this.phase, s = Math.sin(ph);
    const amp = lerp(0.42, 0.85, run) * mv * (1 - 0.4 * ck);
    const breathe = Math.sin(t * 1.7) * (1 - mv);

    // pelvis: drops at each footfall, shifts over the standing leg, rotates with the stride
    this.hips.position.y = lerp(0.91 - Math.abs(s) * (0.03 + 0.025 * run) * mv - hk * 0.02, 0.5 - Math.abs(s) * 0.015 * mv, ck);
    this.hips.position.x = s * 0.018 * mv;
    this.hips.rotation.y = s * 0.1 * mv;
    this.hips.rotation.z = -s * 0.03 * mv + hk * 0.05;
    // spine: leans into speed, shoulders counter-rotate against the pelvis, breathes when idle
    this.spine.rotation.x = lerp(0.03 + mv * 0.05 + run * 0.2 + hk * 0.14 + breathe * 0.012, this.fp ? 0.2 : 0.62, ck);
    this.spine.rotation.y = -s * (0.16 + 0.1 * run) * mv;
    this.spine.rotation.z = s * 0.02 * mv - hk * 0.07;

    for (const L of this.legs) {
      const th = ph + (L.sx > 0 ? Math.PI : 0), sn = Math.sin(th), cs = Math.cos(th);
      const limp = L.sx > 0 ? 1 - hk * 0.45 : 1; // favours the right leg when wounded
      let hip = -sn * amp * limp;
      let knee = 0.05 + (0.1 + Math.max(0, cs) * lerp(0.95, 1.55, run)) * mv * limp; // the knee folds while that leg swings forward
      hip = lerp(hip, -1.05 - sn * 0.28 * mv, ck);
      knee = lerp(knee, 1.75 + Math.max(0, cs) * 0.3 * mv, ck);
      hip = lerp(hip, 0.1 + sn * 0.25 * mv, dk); knee = lerp(knee, 0.25 + Math.max(0, cs) * 0.5 * mv, dk);
      L.hip.rotation.x = hip; L.knee.rotation.x = knee;
      L.hip.rotation.z = L.sx * 0.02;
      L.foot.rotation.x = clamp(-(hip + knee) * 0.55, -0.7, 0.45) * (1 - dk); // keeps the sole roughly level with the floor
    }

    const armAmp = lerp(0.32, 0.95, run) * mv;
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i];
      const sw = A.sx < 0 ? s : -s; // each arm swings opposite to the leg on its own side
      let x = sw * armAmp + 0.04, z = A.sx * (0.07 + 0.03 * run), e = -(0.14 + run * 1.15 + Math.max(0, -sw) * 0.35 * mv);
      if (i === 0 && o.flash && !this.fp) { x = -1.0 - (o.pitch || 0) * 0.85 + sw * 0.06 * mv; z = 0.12; e = -0.4; }      // torch arm points where they look
      if (i === 1 && this.heldCode && !this.fp) { x = -0.42 + sw * 0.12 * mv; z = -0.1; e = -1.15; }                      // carrying something in front
      if (ck > 0.5 && !(i === 0 && o.flash) && !(i === 1 && this.heldCode)) { x = lerp(x, -0.5, ck); e = lerp(e, -0.9, ck); }
      if (dk > 0.01) { x = lerp(x, -2.75 + sw * 0.45 * mv, dk); z = lerp(z, A.sx * 0.3, dk); e = lerp(e, -0.5 - Math.max(0, sw) * 0.6 * mv, dk); } // dragging themselves along
      const ak = k(12);
      A.x = lerp(A.x, x, ak); A.z = lerp(A.z, z, ak); A.e = lerp(A.e, e, ak);
      A.sh.rotation.x = A.x; A.sh.rotation.z = A.z; A.el.rotation.x = A.e;
    }
    // prone when downed
    this.root.rotation.x = dk * 1.45; this.root.position.y = dk * 0.17; this.root.position.z = -dk * 0.8;
    this.head.rotation.x = lerp(-(o.pitch || 0) * 0.7, -0.9, dk);
    this.head.rotation.y = this.spine.rotation.y * -0.6; // the head stays facing forward while the shoulders turn
    this.lens.visible = !!o.flash; this.torch.visible = !!o.flash || this.fp === false;
    if (this.tag) this.tag.position.y = lerp(lerp(1.95, 1.3, ck), 0.75, dk);
  }
  dispose() {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
  }
}
