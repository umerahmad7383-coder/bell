// First-person hands. Drawn in their own tiny scene on top of the world (after clearing depth),
// so they never poke through walls and are lit consistently however dark the room is.
// Left hand: the torch. Right hand: whatever inventory slot is selected.
import * as THREE from 'three';
import { LOOKS, cleanLook } from '../shared/defs.js';
import { buildItemMesh } from './items.js';

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// how each item sits in the right hand: [x, y, z, rotX, rotY, scale]
const POSE = {
  fuse: [0, 0.045, -0.03, 0, 0, 1.4], key_principal: [0, 0.05, -0.06, 0, 1.57, 1.5], key_gate: [0, 0.05, -0.06, 0, 1.57, 1.3], battery: [0, 0.045, -0.03, 0, 0, 1.4],
  medkit: [0, 0.03, -0.05, 0, 0.3, 0.62], lockpick: [0, 0.05, -0.07, 0, 1.57, 1.4], bottle: [0, 0.01, -0.03, 0, 0, 1], bell: [0, -0.07, -0.03, 0, 0, 1],
};

export class ViewModel {
  constructor(look, T) {
    look = cleanLook(look);
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 4);
    this.amb = new THREE.AmbientLight(0xffffff, 0.5);
    this.key = new THREE.DirectionalLight(0xfff1d6, 0.6); this.key.position.set(-0.4, 0.8, 0.6);
    this.scene.add(this.amb, this.key);
    const sleeve = new THREE.MeshLambertMaterial({ color: LOOKS.top[look.top] });
    const skin = new THREE.MeshLambertMaterial({ color: LOOKS.skin[look.skin] });
    const dark = new THREE.MeshLambertMaterial({ color: 0x24262c });

    const arm = (side) => {
      const g = new THREE.Group();
      const wrist = new THREE.Vector3(0, -0.005, 0.03), elbow = new THREE.Vector3(side * 0.11, -0.24, 0.5);
      const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.052, wrist.distanceTo(elbow), 10), sleeve);
      fore.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), wrist.clone().sub(elbow).normalize());
      fore.position.copy(wrist).add(elbow).multiplyScalar(0.5);
      g.add(fore);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.035, 10), sleeve); cuff.quaternion.copy(fore.quaternion); cuff.position.copy(wrist); g.add(cuff);
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.05, 0.095), skin); palm.position.set(0, 0, -0.03); g.add(palm);
      const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.05), skin); fingers.position.set(0, -0.022, -0.085); fingers.rotation.x = 0.9; g.add(fingers);
      const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.03, 0.065), skin); thumb.position.set(-side * 0.048, 0.012, -0.055); thumb.rotation.y = side * 0.35; g.add(thumb);
      this.scene.add(g);
      return g;
    };
    this.L = arm(-1); this.R = arm(1);
    // torch
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.17, 10), dark); body.rotation.x = Math.PI / 2; body.position.set(0, 0.048, -0.045);
    const headM = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.022, 0.05, 12), dark); headM.rotation.x = -Math.PI / 2; headM.position.set(0, 0.048, -0.15);
    this.lens = new THREE.Mesh(new THREE.CircleGeometry(0.027, 14), new THREE.MeshBasicMaterial({ color: 0xfff2c0 })); this.lens.rotation.y = Math.PI; this.lens.position.set(0, 0.048, -0.176);
    this.L.add(body, headM, this.lens);
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
      this.lens.material.color.setHex(s.flash ? 0xfff2c0 : 0x2a2a26);
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
  }
  resize() { this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); }
  dispose() { this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
}
