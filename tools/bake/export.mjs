// Step 1 of the lighting bake: pulls the school's static geometry, surface colours and light sources out of the
// running game, for bake.py (Blender). Needs the game server running (npm start) and Playwright:
//   npm i -D playwright && npx playwright install chromium
//   node tools/bake/export.mjs tools/bake/out/scene            (BAKE_URL=http://localhost:3000 by default)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MAP, W, H, WALL, CEIL_Y, BASEMENT_Y, roomNameAt, ROOMS } from '../../client/shared/map.js';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const OUT = process.argv[2] || 'tools/bake/out/scene';
mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.addInitScript(() => { localStorage.setItem('lastbell.settings', JSON.stringify({ quality: 'low', tips: false, jumpscares: false })); localStorage.setItem('lastbell.nolightmap', '1'); });
await page.goto(process.env.BAKE_URL || 'http://localhost:3000/'); await page.waitForTimeout(800);
await page.fill('#name', 'Bake'); await page.click('#btn-solo');
await page.waitForFunction(() => window.__lb && window.__lb.time > 0.3, null, { timeout: 120000 });
const res = await page.evaluate(() => {
  const g = window.__lb, W = g.world, THREE = g.__THREE;
  const avg = new Map();
  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  function mapAvg(tex) {
    if (!tex || !tex.image) return [1, 1, 1];
    if (avg.has(tex)) return avg.get(tex);
    const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d');
    try { x.drawImage(tex.image, 0, 0, 32, 32); } catch { avg.set(tex, [0.5, 0.5, 0.5]); return [0.5, 0.5, 0.5]; }
    const d = x.getImageData(0, 0, 32, 32).data; let r = 0, gg = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { const w = d[i + 3] / 255; r += s2l(d[i] / 255) * w; gg += s2l(d[i + 1] / 255) * w; b += s2l(d[i + 2] / 255) * w; a += w; }
    const v = a ? [r / a, gg / a, b / a] : [0.5, 0.5, 0.5]; avg.set(tex, v); return v;
  }
  const meshes = [], chunks = [];
  let total = 0;
  W.bakeMeshes.forEach((m, i) => {
    m.updateMatrixWorld(true);
    const geo = m.geometry, pos = geo.attributes.position, nor = geo.attributes.normal, col = geo.attributes.color, n = pos.count;
    const mat = m.material, mc = mat.color || new THREE.Color(1, 1, 1), ma = mapAvg(mat.map);
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld), v = new THREE.Vector3();
    const buf = new Float32Array(n * 9);
    for (let k = 0; k < n; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(m.matrixWorld); buf[k * 9] = v.x; buf[k * 9 + 1] = v.y; buf[k * 9 + 2] = v.z;
      if (nor) { v.fromBufferAttribute(nor, k).applyMatrix3(nm).normalize(); } else v.set(0, 1, 0);
      buf[k * 9 + 3] = v.x; buf[k * 9 + 4] = v.y; buf[k * 9 + 5] = v.z;
      const vc = col && mat.vertexColors ? [col.getX(k), col.getY(k), col.getZ(k)] : [1, 1, 1];
      buf[k * 9 + 6] = Math.min(0.9, mc.r * ma[0] * vc[0]); buf[k * 9 + 7] = Math.min(0.9, mc.g * ma[1] * vc[1]); buf[k * 9 + 8] = Math.min(0.9, mc.b * ma[2] * vc[2]);
    }
    meshes.push({ i, verts: n, tris: n / 3, decal: !!mat.transparent, cast: !!m.castShadow, type: mat.type });
    chunks.push(buf); total += buf.length;
  });
  const all = new Float32Array(total); let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const bytes = new Uint8Array(all.buffer); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const fx = W.fixtures.map((f) => ({ x: f.x, y: f.y, z: f.z, alongX: !!f.alongX, emergency: !!f.emergency, dead: !!f.dead, faulty: !!f.faulty, boiler: !!f.boiler }));
  return { meshes, emitters: W.emitters, fixtures: fx, data: btoa(bin) };
});
writeFileSync(OUT + '.bin', Buffer.from(res.data, 'base64'));
// light-tight shell for the bake: solid blocks inside every wall (inset 2 cm so they never touch the visible
// wall faces), a lid over the roof and a floor under the basement, open only over the courtyard
const outside = new Set(ROOMS.filter((r) => r.outside).map((r) => r.name));
const occ = [];
for (let z = 0; z < H; z++) {
  let x = 0;
  while (x < W) {
    if (MAP.grid[z * W + x] !== WALL) { x++; continue; }
    let x1 = x + 1; while (x1 < W && MAP.grid[z * W + x1] === WALL) x1++;
    occ.push([x + 0.02, BASEMENT_Y - 0.6, z + 0.02, x1 - 0.02, CEIL_Y + 0.6, z + 0.98]);
    x = x1;
  }
}
const lids = [];
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (!outside.has(roomNameAt(x + 0.5, z + 0.5))) lids.push([x, z]);
res.occluders = occ; res.lids = lids; res.ceil = CEIL_Y; res.floor = BASEMENT_Y;
delete res.data;
writeFileSync(OUT + '.json', JSON.stringify(res));
console.log('meshes', res.meshes.length, 'tris', res.meshes.reduce((a, m) => a + m.tris, 0), 'decals', res.meshes.filter((m) => m.decal).length, 'fixtures', res.fixtures.length, 'emitters', res.emitters.length);
await browser.close();
