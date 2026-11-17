// Item meshes, shared by the world (items lying around), the first-person hands
// and other players' hands.
import * as THREE from 'three';

const em = (color, emissive, o = {}) => { const { roughness, metalness, ...rest } = o; return new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity: 0.5, ...rest }); };
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
  // ---- v1.0 ----
  camera: () => [[new THREE.BoxGeometry(0.17, 0.11, 0.12).translate(0, 0.055, 0), em(0xd8d2c0, 0x2a2822)], [new THREE.CylinderGeometry(0.035, 0.04, 0.04, 14).rotateX(Math.PI / 2).translate(0, 0.05, 0.075), em(0x1a1a1c, 0x050505)], [new THREE.BoxGeometry(0.04, 0.025, 0.012).translate(-0.05, 0.095, 0.062), em(0xeef0ff, 0x8090a0)], [new THREE.BoxGeometry(0.17, 0.02, 0.12).translate(0, 0.005, 0), em(0x3a3a3c, 0x111111)], 0xe0e8ff],
  soda: () => [[new THREE.CylinderGeometry(0.033, 0.033, 0.12, 12).translate(0, 0.06, 0), em(0x1fae6a, 0x0a4a2a, { metalness: 0.6 })], [new THREE.CylinderGeometry(0.03, 0.033, 0.01, 12).translate(0, 0.125, 0), em(0xc8c8c8, 0x333333)], [new THREE.BoxGeometry(0.068, 0.04, 0.069).translate(0, 0.06, 0), em(0xf2e14a, 0x5a5000)], 0x60ffb0],
  alarm: () => [[new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16).rotateX(Math.PI / 2).translate(0, 0.07, 0), em(0xb0322a, 0x400a08)], [new THREE.CircleGeometry(0.05, 16).translate(0, 0.07, 0.021), em(0xeee6d0, 0x444033)], [new THREE.SphereGeometry(0.025, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.04, 0.125, 0), em(0xc8a040, 0x403000)], [new THREE.SphereGeometry(0.025, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.04, 0.125, 0), em(0xc8a040, 0x403000)], [new THREE.BoxGeometry(0.01, 0.04, 0.01).translate(-0.04, 0.015, 0), em(0x333333, 0)], [new THREE.BoxGeometry(0.01, 0.04, 0.01).translate(0.04, 0.015, 0), em(0x333333, 0)], 0xff8060],
  chalk: () => [[new THREE.CylinderGeometry(0.012, 0.012, 0.09, 8).rotateZ(Math.PI / 2).translate(0, 0.012, 0), em(0xf2f2ea, 0x555550)], [new THREE.CylinderGeometry(0.012, 0.012, 0.07, 8).rotateZ(Math.PI / 2).rotateY(0.6).translate(0.01, 0.012, 0.04), em(0xf0c8d8, 0x553040)], 0xffffff],
  teddy: () => {
    const fur = em(0x8a5a32, 0x2a1406), dark = em(0x5a3418, 0x1a0a02);
    return [[new THREE.SphereGeometry(0.075, 10, 8).scale(1, 1.15, 0.9).translate(0, 0.08, 0), fur], [new THREE.SphereGeometry(0.06, 10, 8).translate(0, 0.2, 0), fur], [new THREE.SphereGeometry(0.022, 6, 5).translate(-0.045, 0.25, 0), dark], [new THREE.SphereGeometry(0.022, 6, 5).translate(0.045, 0.25, 0), dark],
      [new THREE.SphereGeometry(0.025, 6, 5).translate(0, 0.19, 0.05), em(0xd8b088, 0x3a2810)], [new THREE.SphereGeometry(0.03, 6, 5).translate(-0.07, 0.1, 0.02), fur], [new THREE.SphereGeometry(0.03, 6, 5).translate(0.07, 0.1, 0.02), fur], [new THREE.SphereGeometry(0.032, 6, 5).translate(-0.04, 0.02, 0.04), fur], [new THREE.SphereGeometry(0.032, 6, 5).translate(0.04, 0.02, 0.04), fur], 0xffd0a0];
  },
};

/** Returns { group, glowColor }. The group's origin is where the item rests on a surface. */
export function buildItemMesh(type) {
  const def = (itemBuilders[type] || itemBuilders.note)();
  const glowColor = def.pop();
  const group = new THREE.Group();
  for (const [geo, mat] of def) group.add(new THREE.Mesh(geo, mat));
  return { group, glowColor };
}
