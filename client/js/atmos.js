// Atmosphere you can see: the torch's beam in the dusty air, and dust that drifts everywhere and only
// shows up properly when it floats through the beam. Both are drawn additively and cost very little.
import * as THREE from 'three';

/**
 * Your own torch's beam in the dusty air. Seen from right behind the torch a cone mesh collapses into a thin ring,
 * so this is drawn as a stack of soft discs across the beam instead: walls hide the discs behind them, so the haze
 * fills a long corridor and stops at the wall in front of you, like real light in dust.
 */
export class TorchBeam {
  constructor(camera, flash, len = 9, angle = 0.4, slices = 16) {
    const plane = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = plane.index; geo.setAttribute('position', plane.getAttribute('position')); geo.setAttribute('uv', plane.getAttribute('uv'));
    const d = new Float32Array(slices);
    for (let i = 0; i < slices; i++) { const t = (i + 0.5) / slices; d[i] = 0.7 + Math.pow(t, 1.35) * (len - 0.7); }
    geo.setAttribute('dist', new THREE.InstancedBufferAttribute(d, 1));
    geo.instanceCount = slices;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { strength: { value: 0 }, len: { value: len }, tanA: { value: Math.tan(angle) }, n: { value: slices }, time: { value: 0 }, color: { value: new THREE.Color(1, 0.93, 0.8) } },
      vertexShader: `
        attribute float dist; uniform float len; uniform float tanA; varying vec2 vP; varying float vT;
        void main() {
          vP = position.xy; vT = dist / len;
          vec3 p = vec3(position.xy * tanA * dist, -dist);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `
        uniform float strength; uniform float n; uniform float time; uniform vec3 color; varying vec2 vP; varying float vT;
        void main() {
          float r = length(vP);
          float core = smoothstep(1.0, 0.15, r);
          float a = strength * core * core * pow(1.0 - vT, 1.5) * smoothstep(0.0, 0.08, vT) * (16.0 / n);
          // a slow shimmer so it reads as air, not a sticker
          a *= 0.85 + 0.15 * sin(vP.x * 5.0 + vP.y * 3.0 + time * 0.7 + vT * 9.0);
          gl_FragColor = vec4(color * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.copy(flash.position);
    const dir = flash.target.position.clone().sub(flash.position).normalize();
    this.mesh.quaternion.setFromUnitVectors(TorchBeam.FWD, dir);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.userData.noAO = true;
    camera.add(this.mesh);
    this.cur = 0; this.max = 0.035; this.t = 0;
  }
  update(dt, on, intensity) {
    const want = on ? Math.min(1, intensity / 9) * this.max : 0;
    this.cur += (want - this.cur) * Math.min(1, dt * 12);
    this.t += dt; this.mat.uniforms.time.value = this.t;
    this.mat.uniforms.strength.value = this.cur;
    this.mesh.visible = this.cur > 0.001;
  }
}

/** a teammate's torch seen from outside: a soft cone, brightest down its middle where you look through the most dust */
export class WorldBeam {
  constructor(scene, len = 9, angle = 0.34) {
    this.len = len;
    const r = Math.tan(angle) * len;
    const geo = new THREE.ConeGeometry(r, len, 32, 8, true);
    geo.translate(0, -len / 2, 0); geo.rotateX(Math.PI / 2);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { strength: { value: 0 }, len: { value: len }, color: { value: new THREE.Color(1, 0.93, 0.8) } },
      vertexShader: `
        uniform float len; varying float vAlong; varying vec3 vN; varying vec3 vView;
        void main() {
          vAlong = clamp(-position.z / len, 0.0, 1.0);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float strength; uniform vec3 color; varying float vAlong; varying vec3 vN; varying vec3 vView;
        void main() {
          float facing = abs(dot(normalize(vN), normalize(vView)));
          float a = strength * pow(facing, 1.6) * smoothstep(0.0, 0.06, vAlong) * pow(1.0 - vAlong, 1.7);
          gl_FragColor = vec4(color * a, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 2; this.mesh.userData.noAO = true; this.mesh.visible = false;
    scene.add(this.mesh);
    this.cur = 0; this._d = new THREE.Vector3();
  }
  aim(pos, target) {
    this.mesh.position.copy(pos);
    this._d.copy(target).sub(pos).normalize();
    this.mesh.quaternion.setFromUnitVectors(TorchBeam.FWD, this._d);
  }
  update(dt, on) {
    this.cur += ((on ? 0.09 : 0) - this.cur) * Math.min(1, dt * 10);
    this.mat.uniforms.strength.value = this.cur;
    this.mesh.visible = this.cur > 0.002;
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/** dust motes in a box that travels with the camera (so there is always dust around you) */
export class Dust {
  constructor(scene, count) {
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 3));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        camPos: { value: new THREE.Vector3() }, time: { value: 0 }, box: { value: new THREE.Vector3(7, 3.2, 7) }, scale: { value: 600 },
        tPos: { value: new THREE.Vector3() }, tDir: { value: new THREE.Vector3(0, 0, -1) }, tCos: { value: Math.cos(0.42) }, tOn: { value: 0 },
      },
      vertexShader: `
        attribute vec3 seed; uniform vec3 camPos; uniform float time; uniform vec3 box; uniform float scale;
        uniform vec3 tPos; uniform vec3 tDir; uniform float tCos; uniform float tOn; varying float vA;
        void main() {
          vec3 drift = vec3(0.011, -0.004, 0.008) * time + 0.025 * vec3(sin(time * 0.31 + seed.x * 40.0), cos(time * 0.23 + seed.y * 31.0), sin(time * 0.27 + seed.z * 23.0));
          vec3 rel = (fract(seed + drift / box - camPos / box) - 0.5) * box;
          vec3 wp = camPos + rel;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          vec3 tv = wp - tPos; float d = length(tv);
          float lit = smoothstep(tCos, tCos + 0.05, dot(tv / max(d, 0.001), tDir)) * smoothstep(8.5, 0.6, d) * tOn;
          vA = 0.035 + lit;
          gl_PointSize = (0.0025 + seed.z * 0.004) * scale / max(-mv.z, 0.05);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying float vA;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, r) * vA;
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a * 0.75, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 3; this.points.userData.noAO = true;
    scene.add(this.points);
    this.t = 0; this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
  }
  update(dt, cam, flash, on, renderer) {
    const u = this.mat.uniforms;
    this.t += dt; u.time.value = this.t;
    cam.getWorldPosition(u.camPos.value);
    const h = renderer.getDrawingBufferSize(this._q).y;
    u.scale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    if (flash) {
      flash.getWorldPosition(u.tPos.value);
      flash.target.getWorldPosition(this._p);
      u.tDir.value.copy(this._p).sub(u.tPos.value).normalize();
    }
    u.tOn.value += ((on ? 1 : 0) - u.tOn.value) * Math.min(1, dt * 12);
  }
}

TorchBeam.FWD = new THREE.Vector3(0, 0, -1);
