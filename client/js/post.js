// Post-processing: what turns the raw render into the final picture.
//   Medium  bloom (lamps, exit signs and eyes glow) + FXAA anti-aliasing
//   High    + SMAA anti-aliasing (sharper edges)
//   Ultra   + GTAO ambient occlusion (soft contact shadows in corners and under furniture) + 4x MSAA
// Low skips all of it and draws straight to the screen, as before.
import * as THREE from 'three';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from '../vendor/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from '../vendor/jsm/postprocessing/GTAOPass.js';
import { Pass } from '../vendor/jsm/postprocessing/Pass.js';
import { FXAAShader } from '../vendor/jsm/shaders/FXAAShader.js';

/** draws the first-person hands on top of the finished scene, with depth cleared so they never clip into walls */
class OverlayPass extends Pass {
  constructor(scene, camera) { super(); this.scene = scene; this.camera = camera; this.needsSwap = false; }
  render(renderer, writeBuffer, readBuffer) {
    const ac = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clearDepth(); renderer.render(this.scene, this.camera);
    renderer.autoClear = ac;
  }
}

/** a last touch of film: vignette, a hint of lens fringing at the edges, and grain that moves */
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 1 }, hurt: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount; uniform float hurt; varying vec2 vUv;
    float rnd(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5; float r2 = dot(c, c);
      vec2 off = c * r2 * 0.009 * amount * (1.0 + hurt * 3.0);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= mix(1.0, smoothstep(0.85, 0.18, r2 * 1.6), 0.32 * amount);
      col += (rnd(vUv * 731.0 + fract(time * 13.7)) - 0.5) * 0.008 * amount; // just enough to break up banding (the screen grain does the rest)
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, overlay, Q) {
    this.r = renderer; this.Q = Q; this.scene = scene; this.camera = camera;
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * pr), Math.max(1, size.y * pr), { type: THREE.HalfFloatType, samples: Q.aa === 'msaa' ? 4 : 0 });
    const c = (this.composer = new EffectComposer(renderer, rt));
    c.addPass(new RenderPass(scene, camera));
    if (Q.ao) {
      const ao = (this.ao = new GTAOPass(scene, camera, size.x, size.y));
      ao.output = GTAOPass.OUTPUT.Default; ao.blendIntensity = 0.85;
      ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.1, samples: 12 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      // see-through effects (torch beams, dust) must not count as surfaces for the occlusion
      const ro = ao.renderOverride.bind(ao);
      ao.renderOverride = (...a) => {
        const hid = []; scene.traverse((o) => { if (o.userData.noAO && o.visible) { o.visible = false; hid.push(o); } });
        ro(...a); for (const o of hid) o.visible = true;
      };
      c.addPass(ao);
    }
    this.overlay = new OverlayPass(overlay.scene, overlay.camera); c.addPass(this.overlay);
    if (Q.bloom) { this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.55, 0.92); c.addPass(this.bloom); }
    c.addPass(new OutputPass()); // tone mapping (ACES) and sRGB, from the renderer's settings
    this.film = new ShaderPass(FilmShader); c.addPass(this.film);
    if (Q.aa === 'fxaa') { this.fxaa = new ShaderPass(FXAAShader); c.addPass(this.fxaa); }
    if (Q.aa === 'smaa') { this.smaa = new SMAAPass(size.x * pr, size.y * pr); c.addPass(this.smaa); }
    this.setSize(size.x, size.y, pr);
  }
  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
    if (this.bloom) this.bloom.resolution.set(w / 2, h / 2);
  }
  render(dt, t, showOverlay, hurt = 0) {
    this.overlay.enabled = showOverlay;
    this.film.uniforms.time.value = t; this.film.uniforms.hurt.value = hurt;
    this.composer.render(dt);
  }
  dispose() {
    this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose();
    for (const p of this.composer.passes) if (p.dispose) p.dispose();
  }
}
