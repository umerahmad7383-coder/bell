// First-person hands. Drawn in their own tiny scene on top of the world (after clearing depth),
// so they never poke through walls and are lit consistently however dark the room is.
// Left hand: the torch. Right hand: whatever inventory slot is selected.
import * as THREE from 'three';
import { LOOKS, cleanLook } from '../shared/defs.js';
import { buildItemMesh } from './items.js';
import { RoundedBoxGeometry } from '../vendor/jsm/geometries/RoundedBoxGeometry.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// how each item sits in the right hand: [x, y, z, rotX, rotY, scale]
const POSE = {
  fuse: [0, 0.045, -0.03, 0, 0, 1.4], key_principal: [0, 0.05, -0.06, 0, 1.57, 1.5], key_gate: [0, 0.05, -0.06, 0, 1.57, 1.3], battery: [0, 0.045, -0.03, 0, 0, 1.4],
  medkit: [0, 0.03, -0.05, 0, 0.3, 0.62], lockpick: [0, 0.05, -0.07, 0, 1.57, 1.4], bottle: [0, 0.01, -0.03, 0, 0, 1], bell: [0, -0.07, -0.03, 0, 0, 1],
  camera: [0, 0.0, -0.05, 0, 0.15, 0.62], soda: [0, -0.02, -0.03, 0, 0, 0.8], alarm: [0, -0.02, -0.04, 0, 0.3, 0.7], chalk: [0, 0.05, -0.05, 0, 1.2, 0.85], teddy: [0, -0.05, -0.05, 0, 0.5, 0.38],
};

export class ViewModel {
  constructor(look, T) {
    look = cleanLook(look);
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 4);
    this.amb = new THREE.AmbientLight(0xffffff, 0.5);
    this.key = new THREE.DirectionalLight(0xfff1d6, 0.6); this.key.position.set(-0.4, 0.8, 0.6);
    this.scene.add(this.amb, this.key);
    // the hands are close to the lens, so they get real shading (and a soft reflection on Medium and up)
    const sleeve = new THREE.MeshStandardMaterial({ color: LOOKS.top[look.top], roughness: 0.95 });
    const cn = T.uniform && T.uniform.userData.normal;
    if (cn) { sleeve.normalMap = cn; sleeve.normalScale.set(0.8, 0.8); }
    const skin = new THREE.MeshStandardMaterial({ color: LOOKS.skin[look.skin], roughness: 0.7 });
    const nail = new THREE.MeshStandardMaterial({ color: new THREE.Color(LOOKS.skin[look.skin]).lerp(new THREE.Color(0xf4d6cc), 0.55), roughness: 0.3 });
    this.metal = new THREE.MeshStandardMaterial({ color: 0x23262d, roughness: 0.36, metalness: 0.35 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.85 });
    this.mats = { sleeve, skin, metal: this.metal };

    // a fist around a bar of radius rb along Z (centre (0, cy)); side -1 = left hand (its outside is -X)
    const fist = (side, rb, cy) => {
      const g = new THREE.Group();
      const ang = (a) => (side < 0 ? a : Math.PI - a);             // mirror an angle for the right hand
      const at = (a, r, z) => new THREE.Vector3(Math.cos(ang(a)) * r, cy + Math.sin(ang(a)) * r, z);
      const D = Math.PI / 180;
      // four fingers: knuckles low on the outside, curling under the bar and up the inside
      const F = [[-0.08, 0.0082, 172], [-0.0605, 0.0086, 178], [-0.041, 0.0081, 172], [-0.0225, 0.0072, 160]];
      for (const [z, tr, sweep] of F) {
        const R = rb + tr;
        const a0 = 228 * D, a1 = a0 + sweep * D;
        const tor = new THREE.Mesh(new THREE.TorusGeometry(R, tr, 8, 20, a1 - a0), skin);
        tor.position.set(0, cy, z);
        if (side < 0) tor.rotation.z = a0; else { tor.rotation.z = -a0; tor.scale.x = -1; } // mirror image for the right hand
        g.add(tor);
        const kn = new THREE.Mesh(new THREE.SphereGeometry(tr * 1.1, 10, 8), skin); kn.position.copy(at(a0, R, z)); g.add(kn);
        for (const f of [0.38, 0.7]) { const j = new THREE.Mesh(new THREE.SphereGeometry(tr * 1.02, 8, 6), skin); j.position.copy(at(a0 + (a1 - a0) * f, R, z)); g.add(j); }
        const tip = new THREE.Mesh(new THREE.SphereGeometry(tr, 10, 8), skin); tip.position.copy(at(a1, R, z)); g.add(tip);
        const nl = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), nail);
        nl.position.copy(at(a1 - 0.22, R + tr * 0.82, z)); nl.scale.set(0.0022, tr * 0.72, tr * 0.7); nl.rotation.z = ang(a1 - 0.22); g.add(nl);
      }
      // back of the hand on the outside, the thumb along the top (resting on the switch)
      const back = new THREE.Mesh(new RoundedBoxGeometry(0.026, 0.062, 0.084, 3, 0.011), skin);
      back.position.copy(at(196 * D, rb + 0.018, -0.05)); back.rotation.z = ang(196 * D); back.rotation.y = side * -0.06; g.add(back);
      const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), skin);
      pad.position.copy(at(140 * D, rb + 0.012, -0.026)); pad.scale.set(0.017, 0.016, 0.03); pad.rotation.z = ang(140 * D); g.add(pad);
      const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0096, 0.03, 4, 10), skin);
      t1.rotation.x = Math.PI / 2 - 0.08; t1.position.copy(at(112 * D, rb + 0.0094, -0.05)); g.add(t1);
      const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0089, 0.018, 4, 10), skin);
      t2.rotation.x = Math.PI / 2 + 0.05; t2.position.copy(at(100 * D, rb + 0.0088, -0.082)); g.add(t2);
      const tn = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6), nail);
      tn.position.copy(at(100 * D, rb + 0.0168, -0.088)); tn.scale.set(0.0072, 0.0022, 0.008); g.add(tn);
      // wrist into the cuff
      const wr = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.03, 4, 12), skin);
      wr.scale.set(1, 0.85, 1); wr.rotation.x = Math.PI / 2 - 0.25; wr.position.copy(at(205 * D, rb + 0.018, 0.012)); g.add(wr);
      return g;
    };

    const arm = (side, rb, cy) => {
      const g = new THREE.Group();
      const wrist = new THREE.Vector3(side * 0.03, cy - 0.022, 0.04), elbow = new THREE.Vector3(side * 0.12, -0.24, 0.5);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.054, wrist.distanceTo(elbow), 16, 1, true), sleeve);
      fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), wrist.clone().sub(elbow).normalize());
      fore.position.copy(wrist).add(elbow).multiplyScalar(0.5);
      g.add(fore);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.039, 0.008, 8, 18), sleeve); cuff.quaternion.copy(fore.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)); cuff.position.copy(wrist); g.add(cuff);
      g.add(fist(side, rb, cy));
      this.scene.add(g);
      return g;
    };
    this.L = arm(-1, 0.0205, 0.048); this.R = arm(1, 0.016, 0.045);

    // torch: a turned aluminium body, knurled grip, flared head, bezel, reflector and lens
    const prof = [[0, 0], [0.017, 0], [0.0205, 0.004], [0.0205, 0.014], [0.0185, 0.016], [0.0185, 0.019], [0.0212, 0.021]];
    for (let y = 0.024; y < 0.104; y += 0.005) prof.push([0.0212, y], [0.0201, y + 0.0025]);
    prof.push([0.0212, 0.106], [0.0212, 0.118], [0.0196, 0.121], [0.0222, 0.13], [0.0292, 0.168], [0.031, 0.172], [0.031, 0.19], [0.0322, 0.192], [0.0322, 0.2], [0.0282, 0.2015], [0.0275, 0.199]);
    const lathe = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28);
    lathe.rotateX(-Math.PI / 2); lathe.translate(0, 0.048, 0.04);   // axis along -Z, tail at z = 0.04
    const body = new THREE.Mesh(lathe, this.metal);
    const refl = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.004, 0), new THREE.Vector2(0.012, 0.004), new THREE.Vector2(0.021, 0.012), new THREE.Vector2(0.0272, 0.02)], 24),
      new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.15, metalness: 1 }));
    refl.geometry.rotateX(-Math.PI / 2); refl.position.set(0, 0.048, -0.139);
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.0272, 24), new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.55, depthWrite: false }));
    this.lens.rotation.y = Math.PI; this.lens.position.set(0, 0.048, -0.1595);
    this.led = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.led.rotation.y = Math.PI; this.led.position.set(0, 0.048, -0.141);
    const sw = new THREE.Mesh(new RoundedBoxGeometry(0.011, 0.005, 0.016, 2, 0.002), rubber); sw.position.set(0, 0.048 + 0.0222, -0.096);
    const lanyard = new THREE.Mesh(new THREE.TorusGeometry(0.006, 0.0014, 6, 12), this.metal); lanyard.position.set(0, 0.048 - 0.02, 0.043); lanyard.rotation.y = Math.PI / 2;
    this.L.add(body, refl, this.lens, this.led, sw, lanyard);
    this.holder = new THREE.Group(); this.R.add(this.holder);

    // --- jumpscare rig: the Headmaster's face and hands, right in yours ---
    const sc = (this.scare = new THREE.Group()); sc.visible = false; this.scene.add(sc);
    this.scareMat = new THREE.MeshBasicMaterial({ map: T.scare });
    this.skull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), this.scareMat); this.skull.scale.set(0.17, 0.27, 0.19); sc.add(this.skull); // the sphere's textured front already faces the camera (+Z)
    // second face (assets/scareface.png), used for one scare in five
    this.photoMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    this.photo = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), this.photoMat); this.photo.position.z = 0.06; this.photo.visible = false; sc.add(this.photo);
    this.photoReady = false;
    new THREE.TextureLoader().load('assets/scareface.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; this.photoMat.map = t; this.photoMat.needsUpdate = true; this.photoReady = true; }, undefined, () => {});
    const cloth = new THREE.MeshBasicMaterial({ color: 0x0b0b0d }), bone = new THREE.MeshBasicMaterial({ color: 0x8f8a7a });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.24), cloth); torso.position.set(0, -0.62, 0.06); sc.add(torso);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.2, 8), bone); neck.position.set(0, -0.3, 0.02); sc.add(neck);
    this.claws = [-1, 1].map((sx) => {
      const g = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.7, 7), bone); arm.rotation.x = Math.PI / 2; arm.position.z = -0.38; g.add(arm);
      for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.3, 5), bone); f.rotation.x = Math.PI / 2 - 0.25; f.rotation.z = (i - 2) * 0.22 * sx; f.position.set((i - 2) * 0.03, 0.02, 0.13); g.add(f); }
      sc.add(g); return { g, sx };
    });
    this.scareT = 0; this.scareDur = 0;

    this.held = null; this.pendingHeld = undefined;
    this.showL = 0; this.showR = 0; this.reachT = 0; this.use = null; this.swayX = 0; this.swayY = 0; this.runK = 0;
  }

  setHeld(type) {
    if (this.use) { this.pendingHeld = type; return; } // let the throw / ring animation finish first
    if (type === this.held) return;
    this.held = type; this.holder.clear(); this.holder.visible = true;
    if (!type) return;
    const { group } = buildItemMesh(type);
    const p = POSE[type] || [0, 0.04, -0.03, 0, 0, 1];
    group.position.set(p[0], p[1], p[2]); group.rotation.set(p[3], p[4], 0); group.scale.setScalar(p[5]);
    this.holder.add(group);
  }
  /** Hunt mode, playing as the Headmaster: his own long hands at the bottom of the view. */
  enableClaws() {
    const bone = new THREE.MeshLambertMaterial({ color: 0x8f8a7a });
    this.mclaws = [-1, 1].map((sx) => {
      const g = new THREE.Group();
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.034, 0.7, 7), bone); arm.rotation.x = Math.PI / 2; arm.position.z = 0.36; g.add(arm);
      for (let i = 0; i < 5; i++) { const f = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.26, 5), bone); f.rotation.x = -Math.PI / 2 + 0.3; f.rotation.z = (i - 2) * 0.2 * sx; f.position.set((i - 2) * 0.028, 0.02, -0.12); g.add(f); }
      this.scene.add(g); return { g, sx };
    });
    this.swipeT = 0;
  }
  swipe() { this.swipeT = 0.55; }
  updateClaws(dt, s) {
    if (this.swipeT > 0) this.swipeT -= dt;
    const k = this.swipeT > 0 ? Math.sin((1 - this.swipeT / 0.55) * Math.PI) : 0;
    const mv = clamp(s.speed / 3, 0, 1.6), bob = Math.sin(s.bob * 2) * 0.012 * mv;
    for (const c of this.mclaws) {
      const sw = Math.sin(s.bob + (c.sx > 0 ? Math.PI : 0)) * 0.03 * mv;
      c.g.position.set(c.sx * (0.36 - 0.2 * k), -0.3 + bob + 0.14 * k, -0.5 - 0.28 * k + sw);
      c.g.rotation.set(-0.15 + 0.5 * k, c.sx * (0.25 + 0.3 * k), c.sx * -0.2);
      c.g.visible = !this.scaring;
    }
    const l = clamp(s.light, 0.3, 2); this.amb.intensity = 0.7 * l; this.key.intensity = 0.9 * l;
  }
  /** The face lunges into the camera for `dur` seconds. */
  startScare(dur, photo = false) { this.scareT = dur; this.scareDur = dur; const usePhoto = photo && this.photoReady; this.photo.visible = usePhoto; this.skull.visible = !usePhoto; }
  get scaring() { return this.scareT > 0; }
  updateScare(dt) {
    const sc = this.scare;
    if (this.scareT <= 0) { sc.visible = false; return; }
    this.scareT -= dt;
    const t = this.scareDur - this.scareT;                       // seconds since it started
    const lunge = 1 - Math.pow(1 - Math.min(1, t / 0.09), 3);      // arrives in under a tenth of a second
    const out = Math.max(0, 1 - this.scareT / 0.08);              // last frames: straight through you
    const j = () => (Math.random() - 0.5);
    sc.visible = true;
    sc.position.set(j() * 0.035, 0.015 + j() * 0.03, lerp(-2.6, -0.6, lunge) + out * 0.45);
    sc.rotation.set(j() * 0.1, j() * 0.12, j() * 0.3 + Math.sin(t * 50) * 0.08);
    const stretch = 1 + Math.abs(Math.sin(t * 34)) * 0.22;        // the jaw keeps opening
    this.skull.scale.set(0.17, 0.27 * stretch, 0.19);
    this.skull.position.y = -0.27 * (stretch - 1) * 0.5;
    const fl = 0.75 + Math.random() * 0.6;                          // flickers like a failing bulb
    this.scareMat.color.setScalar(fl); this.photoMat.color.setRGB(fl, fl * 0.82, fl * 0.8);
    this.photo.scale.set(1 + Math.abs(Math.sin(t * 27)) * 0.08, 1 + (stretch - 1) * 0.6, 1); this.photo.rotation.z = Math.sin(t * 61) * 0.06;
    for (const c of this.claws) {
      c.g.position.set(c.sx * lerp(0.8, 0.36, lunge) + j() * 0.02, -0.16 + j() * 0.02, lerp(0.1, 0.3, lunge));
      c.g.rotation.set(0.25 + j() * 0.1, -c.sx * 0.55, c.sx * 0.3);
    }
  }
  /** the right hand reaches out (doors, pick-ups, switches) */
  reach() { this.reachT = 0.3; }
  /** play the animation for using the held item */
  useItem(type) { this.use = { type, t: 0, dur: type === 'bottle' ? 0.42 : type === 'bell' ? 0.7 : 0.4 }; }

  /** s: { flash, speed, sprint, crouch, bob, dyaw, dpitch, light, active, time } */
  update(dt, s) {
    if (this.mclaws) { this.updateScare(dt); this.L.visible = this.R.visible = false; return this.updateClaws(dt, s); }
    const k = (r) => Math.min(1, dt * r);
    if (this.reachT > 0) this.reachT -= dt;
    if (this.use) { this.use.t += dt; if (this.use.t >= this.use.dur) { this.use = null; if (this.pendingHeld !== undefined) { const h = this.pendingHeld; this.pendingHeld = undefined; this.setHeld(h); } } }
    this.updateScare(dt);
    const hands = s.active && !this.scaring;
    const wantL = hands && s.flash ? 1 : 0;
    const wantR = hands && (this.held || this.reachT > 0 || this.use) ? 1 : 0;
    this.showL = lerp(this.showL, wantL, k(9)); this.showR = lerp(this.showR, wantR, k(11));
    this.runK = lerp(this.runK, s.sprint ? 1 : 0, k(6));
    // the hands lag slightly behind the view when you turn
    this.swayX = lerp(this.swayX, clamp(-s.dyaw * 0.9, -0.05, 0.05), k(7));
    this.swayY = lerp(this.swayY, clamp(s.dpitch * 0.7, -0.04, 0.04), k(7));
    const mv = clamp(s.speed / 2.5, 0, 1.6);
    const bobY = Math.sin(s.bob * 2) * 0.007 * mv, bobX = Math.cos(s.bob) * 0.006 * mv;
    const idle = Math.sin(s.time * 1.6) * 0.0025;
    const run = this.runK;

    // left hand + torch
    {
      const h = 1 - this.showL, g = this.L;
      g.position.set(-0.185 + this.swayX - bobX, -0.2 - h * 0.34 + this.swayY + bobY + idle - run * 0.05 - (s.crouch ? 0.0 : 0), -0.4 + h * 0.08);
      g.rotation.set(h * 0.8 + run * 0.25 + bobY * 2, -0.14 + this.swayX * 2 + Math.sin(s.bob) * 0.03 * run, 0.12 + run * 0.2);
      g.visible = this.showL > 0.02 && !this.scaring;
      this.lens.material.color.setHex(s.flash ? 0xfff2c0 : 0x3a3a36); this.lens.material.opacity = s.flash ? 0.75 : 0.35;
      this.led.material.color.setHex(s.flash ? 0xffffff : 0x2a2a28);
    }
    // right hand + item
    {
      const h = 1 - this.showR, g = this.R;
      let px = 0.2, py = -0.2, pz = -0.4, rx = 0, ry = 0.16, rz = -0.12;
      if (this.reachT > 0) { const r = Math.sin((1 - this.reachT / 0.3) * Math.PI); px -= 0.07 * r; py += 0.05 * r; pz -= 0.17 * r; rx -= 0.25 * r; }
      if (this.use) {
        const f = this.use.t / this.use.dur;
        if (this.use.type === 'bottle') {
          if (f < 0.45) { const a = f / 0.45; rx += 0.85 * a; py += 0.09 * a; pz += 0.09 * a; }
          else { const b = (f - 0.45) / 0.55; rx += 0.85 - 2.3 * b; py += 0.09 - 0.16 * b; pz += 0.09 - 0.34 * b; this.holder.visible = b < 0.25; }
        } else if (this.use.type === 'bell') { py += 0.07; rz += Math.sin(this.use.t * 42) * 0.3 * (1 - f); rx += Math.sin(this.use.t * 42) * 0.12 * (1 - f); }
        else { const a = Math.sin(f * Math.PI); py -= 0.07 * a; rx += 0.5 * a; pz += 0.04 * a; }
      }
      g.position.set(px + this.swayX + bobX, py - h * 0.34 + this.swayY - bobY + idle - run * 0.05, pz + h * 0.08);
      g.rotation.set(rx + h * 0.8 + run * 0.25 - bobY * 2, ry + this.swayX * 2 - Math.sin(s.bob) * 0.03 * run, rz - run * 0.2);
      g.visible = this.showR > 0.02 && !this.scaring;
    }
    // brightness follows the surroundings: your torch spill, powered lights, lightning
    const l = clamp(s.light, 0.12, 2);
    this.amb.intensity = 0.55 * l; this.key.intensity = 0.9 * l;
    this.scene.environmentIntensity = 0.1 * l;
  }
  /** a soft reflection map for the metal and skin (Medium and up) */
  setEnv(tex) { this.scene.environment = tex; this.metal.metalness = tex ? 0.65 : 0.35; this.metal.roughness = tex ? 0.32 : 0.45; }
  resize() { this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); }
  dispose() { this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
}
