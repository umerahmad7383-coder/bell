// The Headmaster and the other students — built from primitives and animated in code.
import * as THREE from 'three';
import { nameTexture } from './textures.js';

const lerp = (a, b, t) => a + (b - a) * t;
const limb = (r1, r2, len, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, 7), mat); m.position.y = -len / 2; m.castShadow = true; return m; };

export const PLAYER_COLORS = ['#c9584c', '#4c8fc9', '#5fb86a', '#d2a341', '#9a66c9', '#4cc3b8', '#d27a9e', '#b9b9b0'];

/** Extremely tall, long-limbed figure in a ruined uniform. Model faces +Z. */
export class MonsterModel {
  constructor(T) {
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a877a, roughness: 0.75 });
    const cloth = new THREE.MeshStandardMaterial({ map: T.uniform, color: 0x9a9a9a, roughness: 0.95 });
    const g = (this.group = new THREE.Group());
    const hips = (this.hips = new THREE.Group()); hips.position.y = 1.2; g.add(hips);
    const spine = (this.spine = new THREE.Group()); hips.add(spine);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.86, 0.22), cloth); torso.position.y = 0.43; torso.castShadow = true; spine.add(torso);
    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.13, 0.25), cloth); shoulders.position.y = 0.82; shoulders.castShadow = true; spine.add(shoulders);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.02), new THREE.MeshStandardMaterial({ color: 0x3a0a0a, roughness: 0.8 })); tie.position.set(0, 0.52, 0.118); tie.rotation.z = 0.08; spine.add(tie);
    for (const sx of [-1, 1]) { const tail = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.4, 0.03), cloth); tail.position.set(sx * 0.11, -0.16, -0.1); tail.rotation.x = 0.12; tail.rotation.z = sx * 0.05; spine.add(tail); }
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.26, 7), skin); neck.position.y = 0.99; spine.add(neck);
    const head = (this.head = new THREE.Group()); head.position.y = 1.1; spine.add(head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 14), new THREE.MeshStandardMaterial({ map: T.face, roughness: 0.8 }));
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
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.26), new THREE.MeshStandardMaterial({ color: 0x0c0c0c })); foot.position.set(0, -0.57, 0.08); knee.add(foot);
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

/** Another player. Model faces +Z. */
export class PlayerModel {
  constructor(name, colorIndex) {
    const color = PLAYER_COLORS[colorIndex % PLAYER_COLORS.length];
    const top = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xb08a6e, roughness: 0.8 });
    const g = (this.group = new THREE.Group());
    const root = (this.root = new THREE.Group()); g.add(root);
    const hips = (this.hips = new THREE.Group()); hips.position.y = 0.86; root.add(hips);
    const spine = (this.spine = new THREE.Group()); hips.add(spine);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.56, 0.22), top); torso.position.y = 0.3; torso.castShadow = true; spine.add(torso);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.12), dark); pack.position.set(0, 0.32, -0.17); spine.add(pack);
    const head = (this.head = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10), skin)); head.position.y = 0.72; head.castShadow = true; spine.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.132, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark); hair.position.y = 0.73; hair.rotation.x = -0.25; spine.add(hair);
    this.arms = [-1, 1].map((sx) => { const sh = new THREE.Group(); sh.position.set(sx * 0.25, 0.54, 0); spine.add(sh); sh.add(limb(0.05, 0.042, 0.56, top)); return { sh, sx }; });
    this.legs = [-1, 1].map((sx) => { const hip = new THREE.Group(); hip.position.set(sx * 0.1, 0, 0); hips.add(hip); hip.add(limb(0.07, 0.055, 0.84, dark)); return { hip, sx }; });
    // the torch in their right hand
    const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.16, 6), dark); torch.rotation.x = Math.PI / 2; torch.position.set(0, -0.56, 0.06); this.arms[1].sh.add(torch);
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0 })); this.lens.position.set(0, -0.56, 0.141); this.arms[1].sh.add(this.lens);

    const tag = (this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTexture(name, color), transparent: true, opacity: 0.85, depthWrite: false })));
    tag.scale.set(1.3, 0.325, 1); tag.position.y = 1.95; g.add(tag);
    this.phase = 0; this.crouchK = 0; this.downK = 0;
  }
  update(dt, speed, crouch, downed, pitch, flash) {
    this.phase += speed * dt * 3.4;
    const s = Math.sin(this.phase), mv = Math.min(1, speed / 1.5);
    this.crouchK = lerp(this.crouchK, crouch ? 1 : 0, Math.min(1, dt * 10));
    this.downK = lerp(this.downK, downed ? 1 : 0, Math.min(1, dt * 6));
    const ck = this.crouchK, dk = this.downK;
    this.hips.position.y = lerp(0.86, 0.46, ck);
    this.spine.rotation.x = lerp(0.04 + mv * 0.08, 0.55, ck);
    this.root.rotation.x = -dk * 1.5; this.root.position.y = dk * 0.18; this.root.position.z = dk * 0.5;
    for (const L of this.legs) { const sw = L.sx > 0 ? s : -s; L.hip.rotation.x = lerp(-sw * 0.6 * mv, -1.1 - sw * 0.3 * mv, ck); }
    this.arms[0].sh.rotation.x = s * 0.5 * mv;
    this.arms[1].sh.rotation.x = flash ? -1.25 + pitch * 0.8 : -s * 0.5 * mv; // torch arm points where they look
    this.head.rotation.x = -pitch * 0.6;
    this.lens.visible = flash;
    this.tag.position.y = lerp(lerp(1.95, 1.4, ck), 0.7, dk);
  }
  dispose() { this.tag.material.map.dispose(); this.tag.material.dispose(); }
}
