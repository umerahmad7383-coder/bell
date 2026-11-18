// Item meshes, shared by the world (items lying around), the first-person hands
// and other players' hands. Turned (lathe) and rounded shapes so nothing reads as a plain box up close;
// every item keeps a faint glow so it can be spotted in the dark.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/jsm/geometries/RoundedBoxGeometry.js';

const em = (color, emissive, o = {}) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.5, roughness: 0.6, metalness: 0, ...o, metalness: Math.min(0.5, o.metalness || 0) });
const V2 = (pts) => pts.map(([r, y]) => new THREE.Vector2(r, y));
const lathe = (pts, seg = 20) => new THREE.LatheGeometry(V2(pts), seg);
const rbox = (w, h, d, r) => new RoundedBoxGeometry(w, h, d, 3, r);

/** a key: ring bow, round shaft, a bit with teeth */
const key = (s, metal, glow) => {
  const m = em(metal[0], metal[1], { metalness: 0.5, roughness: 0.35 });
  const parts = [[new THREE.TorusGeometry(0.035 * s, 0.01 * s, 8, 20).rotateX(Math.PI / 2), m],
    [new THREE.CylinderGeometry(0.0065 * s, 0.0065 * s, 0.1 * s, 10).rotateZ(Math.PI / 2).translate(0.085 * s, 0, 0), m],
    [new THREE.CylinderGeometry(0.011 * s, 0.011 * s, 0.008 * s, 12).rotateZ(Math.PI / 2).translate(0.04 * s, 0, 0), m]];
  for (let i = 0; i < 3; i++) parts.push([new THREE.BoxGeometry(0.011 * s, 0.006 * s, (0.018 + (i % 2) * 0.01) * s).translate((0.105 + i * 0.012) * s, 0, (0.012 + (i % 2) * 0.005) * s), m]);
  parts.push(glow);
  return parts;
};

const itemBuilders = {
  fuse: () => {
    const cap = em(0xa8a8a8, 0x222222, { metalness: 0.5, roughness: 0.3 });
    const capG = (x) => lathe([[0, 0], [0.036, 0], [0.039, 0.004], [0.039, 0.026], [0.036, 0.03], [0.0, 0.03]], 18).rotateZ(x > 0 ? -Math.PI / 2 : Math.PI / 2).translate(x, 0, 0);
    return [[new THREE.CylinderGeometry(0.034, 0.034, 0.11, 18, 1, true).rotateZ(Math.PI / 2), em(0xd9a441, 0x8a4a00, { transparent: true, opacity: 0.55, roughness: 0.1, side: THREE.DoubleSide, depthWrite: false })],
      [new THREE.CylinderGeometry(0.003, 0.003, 0.11, 6).rotateZ(Math.PI / 2), em(0xffd27a, 0xffa030)],
      [capG(0.055), cap], [capG(-0.055), cap], 0xffa030];
  },
  key_principal: () => key(1, [0xc9a23a, 0x5a4200], 0xffd060),
  key_gate: () => key(1.4, [0x8fa3b5, 0x1d3550], 0x60b0ff),
  battery: () => {
    const body = lathe([[0, 0], [0.026, 0], [0.03, 0.004], [0.03, 0.106], [0.026, 0.11], [0.012, 0.11], [0.012, 0.122], [0, 0.122]], 20).rotateZ(-Math.PI / 2).translate(-0.055, 0, 0);
    return [[body, em(0x2f8d3a, 0x0c3a10, { roughness: 0.35 })],
      [new THREE.CylinderGeometry(0.0305, 0.0305, 0.025, 20, 1, true).rotateZ(Math.PI / 2).translate(-0.035, 0, 0), em(0x1a1a1a, 0x050505, { roughness: 0.4 })],
      [new THREE.CylinderGeometry(0.0122, 0.0122, 0.013, 12).rotateZ(Math.PI / 2).translate(0.0615, 0, 0), em(0xbba040, 0x332200, { metalness: 0.5, roughness: 0.3 })], 0x60ff80];
  },
  medkit: () => {
    const shell = em(0xd8d8d0, 0x333333, { roughness: 0.45 }), red = em(0xb01010, 0x700000, { roughness: 0.5 }), dark = em(0x55585c, 0x111111, { roughness: 0.6 });
    return [[rbox(0.26, 0.14, 0.2, 0.022).translate(0, 0.05, 0), shell],
      [rbox(0.264, 0.012, 0.204, 0.005).translate(0, 0.085, 0), dark],             // lid seam
      [rbox(0.12, 0.006, 0.04, 0.002).translate(0, 0.121, 0), red], [rbox(0.04, 0.006, 0.12, 0.002).translate(0, 0.121, 0), red],
      [rbox(0.03, 0.03, 0.012, 0.004).translate(-0.07, 0.08, 0.103), dark], [rbox(0.03, 0.03, 0.012, 0.004).translate(0.07, 0.08, 0.103), dark],
      [new THREE.TorusGeometry(0.035, 0.007, 8, 16, Math.PI).rotateX(Math.PI / 2).translate(0, 0.05, 0.1), dark], 0xff7070];
  },
  lockpick: () => {
    const steel = em(0xb8bcc0, 0x333333, { metalness: 0.5, roughness: 0.3 }), grip = em(0x2a2a30, 0x080808, { roughness: 0.8 });
    return [[rbox(0.13, 0.006, 0.01, 0.002).rotateY(0.3), steel], [rbox(0.13, 0.006, 0.01, 0.002).rotateY(-0.4), steel],
      [rbox(0.05, 0.012, 0.018, 0.005).translate(-0.07, 0, 0).rotateY(0.3), grip], [rbox(0.05, 0.012, 0.018, 0.005).translate(-0.07, 0, 0).rotateY(-0.4), grip], 0xd0d0ff];
  },
  bottle: () => {
    const glass = em(0x2f5a3a, 0x0a2010, { transparent: true, opacity: 0.78, roughness: 0.08 });
    return [[lathe([[0, -0.05], [0.034, -0.05], [0.038, -0.044], [0.038, 0.1], [0.034, 0.13], [0.016, 0.16], [0.014, 0.205], [0.017, 0.208], [0.017, 0.218], [0.012, 0.22], [0, 0.22]], 22), glass],
      [new THREE.CylinderGeometry(0.0385, 0.0385, 0.07, 22, 1, true).translate(0, 0.03, 0), em(0xc9b98a, 0x2a2414, { roughness: 0.9 })], 0x70c090];
  },
  bell: () => {
    const brass = em(0xb8902a, 0x4a3500, { metalness: 0.5, roughness: 0.28 }), wood = em(0x4a2c18, 0x0a0400, { roughness: 0.55 });
    return [[lathe([[0.072, -0.05], [0.074, -0.046], [0.066, -0.035], [0.05, -0.01], [0.04, 0.02], [0.034, 0.04], [0.02, 0.05], [0.012, 0.052], [0, 0.052]], 28), brass],
      [lathe([[0, -0.046], [0.066, -0.046], [0.06, -0.034], [0.044, -0.01], [0.034, 0.02], [0.028, 0.038], [0, 0.044]], 24), em(0x5a4410, 0x100800, { side: THREE.BackSide, roughness: 0.5 })],
      [new THREE.SphereGeometry(0.014, 10, 8).translate(0, -0.032, 0), em(0x6a5a30, 0x100800, { metalness: 0.5 })],
      [lathe([[0, 0.05], [0.014, 0.05], [0.011, 0.07], [0.013, 0.11], [0.016, 0.14], [0.012, 0.155], [0, 0.158]], 14), wood], 0xffc040];
  },
  note: () => [[new THREE.BoxGeometry(0.2, 0.004, 0.27), em(0xcfc8b0, 0x55523f, { roughness: 0.95 })], 0xfff0c0],
  // ---- v1.0 ----
  camera: () => {
    const body = em(0xd8d2c0, 0x2a2822, { roughness: 0.5 }), black = em(0x1a1a1c, 0x050505, { roughness: 0.4 });
    return [[rbox(0.17, 0.1, 0.11, 0.018).translate(0, 0.06, 0), body],
      [rbox(0.172, 0.03, 0.112, 0.01).translate(0, 0.016, 0), em(0x3a3a3c, 0x111111, { roughness: 0.7 })],
      [lathe([[0.042, 0], [0.042, 0.012], [0.038, 0.014], [0.036, 0.04], [0.026, 0.042], [0.024, 0.03], [0, 0.03]], 22).rotateX(Math.PI / 2).translate(0, 0.055, 0.05), black],
      [new THREE.CircleGeometry(0.024, 20).translate(0, 0.055, 0.081), em(0x203040, 0x0a1420, { metalness: 0.5, roughness: 0.05 })],
      [rbox(0.04, 0.025, 0.012, 0.003).translate(-0.05, 0.095, 0.056), em(0xeef0ff, 0x8090a0, { roughness: 0.2 })],
      [new THREE.CylinderGeometry(0.009, 0.009, 0.008, 12).translate(0.055, 0.114, 0), black], 0xe0e8ff];
  },
  soda: () => {
    const can = em(0x1fae6a, 0x0a4a2a, { metalness: 0.45, roughness: 0.3 }), alu = em(0xc8c8c8, 0x333333, { metalness: 0.5, roughness: 0.25 });
    return [[lathe([[0, 0], [0.024, 0], [0.03, 0.004], [0.033, 0.014], [0.033, 0.106], [0.029, 0.118], [0.026, 0.122], [0, 0.122]], 24), can],
      [new THREE.CylinderGeometry(0.0335, 0.0335, 0.04, 24, 1, true).translate(0, 0.06, 0), em(0xf2e14a, 0x5a5000, { metalness: 0.3, roughness: 0.35 })],
      [lathe([[0, 0.121], [0.026, 0.121], [0.027, 0.126], [0.025, 0.127], [0.024, 0.123], [0, 0.123]], 24), alu],
      [rbox(0.014, 0.003, 0.022, 0.0012).translate(0, 0.125, 0.006), alu], 0x60ffb0];
  },
  alarm: () => {
    const red = em(0xb0322a, 0x400a08, { metalness: 0.3, roughness: 0.4 }), brass = em(0xc8a040, 0x403000, { metalness: 0.5, roughness: 0.3 });
    return [[lathe([[0, -0.022], [0.056, -0.022], [0.061, -0.018], [0.061, 0.018], [0.056, 0.022], [0, 0.022]], 28).rotateX(Math.PI / 2).translate(0, 0.07, 0), red],
      [new THREE.CircleGeometry(0.052, 28).translate(0, 0.07, 0.0225), em(0xeee6d0, 0x444033, { roughness: 0.3 })],
      [new THREE.BoxGeometry(0.003, 0.034, 0.002).translate(0, 0.082, 0.024), em(0x111111, 0)], [new THREE.BoxGeometry(0.026, 0.003, 0.002).translate(0.011, 0.07, 0.024), em(0x111111, 0)],
      [new THREE.SphereGeometry(0.026, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.04, 0.122, 0), brass], [new THREE.SphereGeometry(0.026, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.04, 0.122, 0), brass],
      [new THREE.CylinderGeometry(0.005, 0.008, 0.04, 8).translate(-0.04, 0.015, 0), em(0x333333, 0, { metalness: 0.4 })], [new THREE.CylinderGeometry(0.005, 0.008, 0.04, 8).translate(0.04, 0.015, 0), em(0x333333, 0, { metalness: 0.4 })], 0xff8060];
  },
  chalk: () => [[new THREE.CylinderGeometry(0.012, 0.012, 0.09, 10).rotateZ(Math.PI / 2).translate(0, 0.012, 0), em(0xf2f2ea, 0x555550, { roughness: 1 })], [new THREE.CylinderGeometry(0.012, 0.012, 0.07, 10).rotateZ(Math.PI / 2).rotateY(0.6).translate(0.01, 0.012, 0.04), em(0xf0c8d8, 0x553040, { roughness: 1 })], 0xffffff],
  teddy: () => {
    const fur = em(0x8a5a32, 0x2a1406, { roughness: 1 }), dark = em(0x5a3418, 0x1a0a02, { roughness: 1 }), eye = em(0x0a0a0a, 0, { roughness: 0.2 });
    return [[new THREE.SphereGeometry(0.075, 18, 14).scale(1, 1.15, 0.9).translate(0, 0.08, 0), fur], [new THREE.SphereGeometry(0.06, 18, 14).translate(0, 0.2, 0), fur], [new THREE.SphereGeometry(0.022, 12, 8).translate(-0.045, 0.25, 0), dark], [new THREE.SphereGeometry(0.022, 12, 8).translate(0.045, 0.25, 0), dark],
      [new THREE.SphereGeometry(0.025, 12, 8).translate(0, 0.19, 0.05), em(0xd8b088, 0x3a2810, { roughness: 1 })], [new THREE.SphereGeometry(0.008, 8, 6).translate(0, 0.198, 0.074), eye],
      [new THREE.SphereGeometry(0.0075, 8, 6).translate(-0.022, 0.215, 0.052), eye], [new THREE.SphereGeometry(0.0075, 8, 6).translate(0.022, 0.215, 0.052), eye],
      [new THREE.SphereGeometry(0.03, 12, 8).translate(-0.07, 0.1, 0.02), fur], [new THREE.SphereGeometry(0.03, 12, 8).translate(0.07, 0.1, 0.02), fur], [new THREE.SphereGeometry(0.032, 12, 8).translate(-0.04, 0.02, 0.04), fur], [new THREE.SphereGeometry(0.032, 12, 8).translate(0.04, 0.02, 0.04), fur], 0xffd0a0];
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
