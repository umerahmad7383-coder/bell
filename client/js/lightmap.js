// Baked lighting. The school's static surfaces were lit offline in Blender with Cycles (a path tracer: light
// bounces between walls, floors and ceilings, corners darken, moonlight pools under the windows). Two
// lightmaps come out of the bake (tools/bake/):
//   A: the power is off: moonlight through the windows, the night sky over the courtyard, exit signs, red emergency lamps
//   B: the power is on: every working ceiling lamp
// The game blends them at runtime (power coming back, flicker, the red final alarm). Lamps that flicker on
// their own, the boiler fire, torches and camera flashes stay real-time lights on top.
import * as THREE from 'three';

const BASE = 'assets/lightmap/';

/** download the bake; resolves to null if it is missing or broken (the game then lights itself the old way) */
export async function loadLightmaps() {
  try {
    if (localStorage.getItem('lastbell.nolightmap')) return null;
  } catch { /* storage blocked */ }
  try {
    const [meta, uvBuf] = await Promise.all([
      fetch(BASE + 'lm.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch(BASE + 'lm-uv.bin').then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }),
    ]);
    const tex = {};
    await Promise.all(meta.layers.map(async (l) => {
      const blob = await fetch(BASE + `lm-${l}.${meta.format || 'png'}`).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      // RGBM keeps brightness in alpha, so the image must not be premultiplied or colour-managed
      const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const t = new THREE.Texture(bmp);
      t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.channel = 1;
      t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
      t.needsUpdate = true; tex[l] = t;
    }));
    return { meta, uv: new Uint16Array(uvBuf), tex };
  } catch (err) {
    console.warn('[last-bell] no baked lighting:', err && err.message);
    return null;
  }
}

/**
 * Give the world's static meshes their lightmap coordinates and lightmapped materials.
 * Returns a controller, or null if the bake does not match this build of the school.
 */
export function applyLightmaps(world, lm) {
  if (!lm || !lm.tex.a || !lm.tex.b) return null;
  const { meta, uv } = lm, meshes = world.bakeMeshes || [];
  const U = {
    lmB: { value: lm.tex.b }, lmRange: { value: meta.range },
    lmTintA: { value: new THREE.Color(1, 1, 1) }, lmTintB: { value: new THREE.Color(0, 0, 0) },
    lmAmb: { value: 0.6 }, lmMask: { value: new Array(16).fill(1) },
  };
  const clones = new Map();
  const lmMat = (src) => {
    if (clones.has(src)) return clones.get(src);
    const m = src.clone();
    m.lightMap = lm.tex.a; m.lightMapIntensity = Math.PI;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <lightmap_pars_fragment>', `#include <lightmap_pars_fragment>
uniform sampler2D lmB; uniform float lmRange; uniform vec3 lmTintA; uniform vec3 lmTintB; uniform float lmAmb; uniform float lmMask[ 16 ];
float lmDiffK = 1.0; // a baked lamp's real-time light keeps its shine on glossy floors but not its (already baked) diffuse light
vec3 lmDecode( vec4 t ) { vec3 g = t.rgb * t.a * lmRange; return g * g; }`)
        .replace('#include <lights_lambert_pars_fragment>', THREE.ShaderChunk.lights_lambert_pars_fragment.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor ) * lmDiffK;'))
        .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );', 'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor ) * lmDiffK;'))
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin
          .replace('pointLight = pointLights[ i ];', 'pointLight = pointLights[ i ]; lmDiffK = lmMask[ i ];')
          .replace('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', 'lmDiffK = 1.0;\n#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )')
          .replace('vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );', 'vec3 irradiance = getAmbientLightIrradiance( ambientLightColor ) * lmAmb;'))
        .replace('#include <lights_fragment_maps>', THREE.ShaderChunk.lights_fragment_maps
          .replace(/vec4 lightMapTexel = texture2D\( lightMap, vLightMapUv \);\s*vec3 lightMapIrradiance = lightMapTexel.rgb \* lightMapIntensity;/,
            'vec3 lightMapIrradiance = ( lmDecode( texture2D( lightMap, vLightMapUv ) ) * lmTintA + lmDecode( texture2D( lmB, vLightMapUv ) ) * lmTintB ) * lightMapIntensity;'));
    };
    m.customProgramCacheKey = () => 'lastbell-lm2';
    clones.set(src, m);
    return m;
  };
  let ok = 0, bad = 0;
  for (const e of meta.meshes) {
    const m = meshes[e.i];
    const n = m && m.geometry.attributes.position.count;
    if (!m || n !== e.tris * 3 || (e.offset + n) * 2 > uv.length) { bad++; continue; }
    const a = new Float32Array(n * 2), base = e.offset * 2;
    for (let j = 0; j < n * 2; j++) a[j] = uv[base + j] / 65535;
    m.geometry.setAttribute('uv1', new THREE.BufferAttribute(a, 2));
    m.material = lmMat(m.material);
    ok++;
  }
  if (!ok || bad > meta.meshes.length * 0.2) { console.warn('[last-bell] baked lighting does not match this map; skipped', ok, bad); return null; }
  if (bad) console.warn('[last-bell] baked lighting: skipped', bad, 'meshes that changed since the bake');

  // ---- runtime control
  const ctl = {
    U, power: 0, want: 0, flickerT: 0, alarm: false,
    intA: 1, intB: 1, // overall strength of each bake (tuned against the real-time torch)
    setPower(on) { this.want = on ? 1 : 0; },
    setAlarm(on) { this.alarm = on; },
    flicker(secs) { this.flickerT = Math.max(this.flickerT, secs); },
    /** which real-time pool lights also light the static world (the ones whose lamps are not in the bake) */
    setMask(k, v) { U.lmMask.value[k] = v; },
    update(dt, t) {
      this.power += (this.want - this.power) * Math.min(1, dt * 3);
      let b = this.power;
      if (this.flickerT > 0) { this.flickerT -= dt; b *= Math.sin(t * 40) > 0 ? 0.04 : 0.8; }
      if (this.alarm) {
        const p = 0.35 + 0.65 * Math.abs(Math.sin(t * 2.6));
        U.lmTintB.value.setRGB(1.0 * p, 0.07 * p, 0.05 * p).multiplyScalar(this.intB * Math.max(b, 1));
      } else U.lmTintB.value.setScalar(b * this.intB);
      U.lmTintA.value.setScalar(this.intA);
    },
  };
  return ctl;
}
