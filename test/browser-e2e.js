// Optional two-browser end-to-end test (real Chrome, real keyboard input, real server).
// Needs Playwright, which is NOT a dependency of the game:
//     npm i -D playwright && npx playwright install chromium
//     npm start            (in another terminal)
//     npm run test:browser
// Env: GAME_URL (default http://localhost:3000), CHROME_PATH (optional), SHOTS (screenshot dir, optional)
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_PATH || 'playwright');
const URL = (process.env.GAME_URL || 'http://localhost:3000').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || './test-shots';
mkdirSync(SHOTS, { recursive: true });
const args = ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox','--autoplay-policy=no-user-gesture-required'];
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args });
const logs = [];
async function mk(name) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type()==='error') logs.push(name+' console: '+m.text()); }); page.on('pageerror', e => logs.push(name+' PAGEERROR: '+e.message+'\n'+e.stack));
  await page.addInitScript(() => localStorage.setItem('lastbell.settings', JSON.stringify({ quality: 'low' })));
  return page;
}
const ok = (c, m) => { console.log((c ? '  ok  - ' : 'FAIL: ') + m); if (!c) process.exitCode = 1; };
const A = await mk('A'), B = await mk('B');
await A.goto(URL + '/'); await A.fill('#name', 'Mira'); await A.waitForSelector('#btn-create:not([disabled])'); await A.click('#btn-create');
await A.waitForSelector('#s-lobby:not([hidden])');
const code = await A.textContent('#lobby-code');
ok(/^[A-Z2-9]{6}$/.test(code), 'browser A created lobby ' + code);
await B.goto(URL + '/?room=' + code);
ok(await B.inputValue('#code') === code, 'invite link pre-fills the room code for browser B');
await B.fill('#name', 'Jonas'); await B.click('#btn-join-go');
await B.waitForSelector('#s-lobby:not([hidden])');
await A.waitForFunction(() => document.querySelectorAll('#lobby-players li').length === 2);
ok(true, 'both browsers show 2 players in the lobby');
ok(await A.isDisabled('#btn-start'), 'start disabled until guest is ready');
await B.click('#btn-ready');
await A.waitForFunction(() => !document.querySelector('#btn-start').disabled);
await A.screenshot({ path: SHOTS + '/e_lobby.png' });
await A.click('#btn-start');
await Promise.all([A.waitForFunction(() => window.__lb, null, { timeout: 40000 }), B.waitForFunction(() => window.__lb, null, { timeout: 40000 })]);
ok(true, 'both browsers loaded into the match');
await A.waitForTimeout(1500);

// B walks forward with the real keyboard; A must see B move
const b0 = await B.evaluate(() => __lb.ph.getFeet());
await B.keyboard.down('KeyW'); await B.waitForTimeout(2500); await B.keyboard.up('KeyW');
const b1 = await B.evaluate(() => __lb.ph.getFeet());
ok(b1.x - b0.x > 1.5, `W key moves the local player (${b0.x.toFixed(1)} -> ${b1.x.toFixed(1)})`);
await A.waitForTimeout(800);
const seen = await A.evaluate(() => { const r = [...__lb.remotes.values()][0]; return { x: r.cur.x, z: r.cur.z, vis: r.visible }; });
ok(seen.vis && Math.abs(seen.x - b1.x) < 0.5, `browser A sees B at the same place via the server (${seen.x.toFixed(2)} vs ${b1.x.toFixed(2)})`);
await A.screenshot({ path: SHOTS + '/e_remote.png' });

// autopilot helper: real physics + real server validation, steering by setting yaw and holding W
const pilot = `async (tx, tz, stop) => {
  const { findPath, MAP, idx } = await import('/shared/map.js'); const g = __lb;
  const cost = (c) => { const d = MAP.doorAt[c]; return d >= 0 && g.world.doors[d].locked && !g.world.doors[d].open ? -1 : 0; };
  const f0 = g.ph.getFeet(); const path = findPath(f0.x, f0.z, tx, tz, cost); if (!path) return 'nopath';
  return await new Promise((res) => { let i = 0, t0 = performance.now(); const iv = setInterval(() => {
    const f = g.ph.getFeet();
    if (Math.hypot(f.x - tx, f.z - tz) < stop || i >= path.length) { g.keys.KeyW = false; g.keys.ShiftLeft = false; clearInterval(iv); return res('ok'); }
    if (performance.now() - t0 > 90000) { g.keys.KeyW = false; clearInterval(iv); return res('timeout at ' + f.x.toFixed(1) + ',' + f.z.toFixed(1)); }
    const n = path[i]; const dx = n.x - f.x, dz = n.z - f.z;
    if (Math.hypot(dx, dz) < 0.3) { i++; return; }
    const di = MAP.doorAt[idx(Math.floor(n.x), Math.floor(n.z))];
    if (di >= 0 && !g.world.doors[di].open) { if (!g._asked || performance.now() - g._asked > 800) { g._asked = performance.now(); g.s.emit('g:interact', { k: 'door', id: di }); } g.keys.KeyW = false; return; }
    g.yaw = Math.atan2(-dx, -dz); g.pitch = 0; g.keys.KeyW = true; g.keys.ShiftLeft = true;
  }, 16); });
}`;
// A: hide in the nearest locker using the real look-at + E flow
let r = await A.evaluate(`(${pilot})(8.5, 22.6, 0.25)`);
await A.evaluate(() => { const g = __lb, f = g.ph.getFeet(); g.yaw = Math.atan2(-(8.5 - f.x), -(21.5 - f.z)); g.pitch = -0.1; });
await A.waitForTimeout(500);
const prompt = await A.textContent('#prompt');
ok(/Hide in locker/.test(prompt), `looking at a locker shows the prompt ("${prompt.trim()}")`);
await A.keyboard.press('KeyE'); await A.waitForTimeout(700);
ok(await A.evaluate(() => __lb.me.hidden >= 0), 'E hides the player in the locker');
await A.screenshot({ path: SHOTS + '/e_locker.png' });
ok(await B.evaluate(() => { const r = [...__lb.remotes.values()][0]; return !r.visible; }), 'a hidden player disappears for the other browser');
await A.keyboard.press('KeyE'); await A.waitForTimeout(700);
ok(await A.evaluate(() => __lb.me.hidden < 0), 'E climbs back out');

// A: walk across the school to the nearest fuse and pick it up by looking at it
const fuse = await A.evaluate(() => { const g = __lb, f = g.ph.getFeet(); return [...g.world.items.values()].filter(i => i.type === 'fuse').map(i => ({ id: i.id, x: i.x, y: i.y, z: i.z })).sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z))[0]; });
r = await A.evaluate(`(${pilot})(${fuse.x}, ${fuse.z}, 1.3)`);
ok(r === 'ok', `autopilot walked through doors to the fuse at (${fuse.x}, ${fuse.z}) [${r}]`);
await A.evaluate((it) => { const g = __lb, c = g.cam.position; const dx = it.x - c.x, dy = it.y - c.y, dz = it.z - c.z; g.yaw = Math.atan2(-dx, -dz); g.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }, fuse);
await A.waitForTimeout(500);
await A.screenshot({ path: SHOTS + '/e_fuse.png' });
const p2 = await A.textContent('#prompt');
ok(/Pick up Fuse/.test(p2), `looking at the fuse shows "${p2.trim()}"`);
await A.keyboard.press('KeyE'); await A.waitForTimeout(700);
ok(await A.evaluate(() => __lb.inv.some(i => i && i.type === 'fuse')), 'fuse is in the inventory after pressing E');
ok(await B.evaluate((id) => !__lb.world.items.has(id), fuse.id), 'the fuse disappeared from the world in browser B');
ok(/1\/3/.test(await B.evaluate(() => document.querySelector('#objectives').textContent)), "browser B's notebook shows 1/3 fuses");
await A.keyboard.press('KeyG'); await A.waitForTimeout(600);
ok(await B.evaluate(() => [...__lb.world.items.values()].filter(i => i.type === 'fuse').length === 3), 'G drops it and it reappears for B (sharing works)');
await A.keyboard.down('Tab'); await A.waitForTimeout(300); await A.screenshot({ path: SHOTS + '/e_notebook.png' }); await A.keyboard.up('Tab');
// chat
await B.keyboard.press('Enter'); await B.keyboard.type('where are you?'); await B.keyboard.press('Enter'); await A.waitForTimeout(500);
ok(/where are you\?/.test(await A.textContent('#chatlog')), 'text chat reaches the other browser in-game');
const fps = await A.evaluate(() => new Promise(res => { let n = 0; const t = performance.now(); const f = () => { n++; if (performance.now() - t > 2000) res(n / 2); else requestAnimationFrame(f); }; f(); }));
console.log('  info - software-rendered fps in this sandbox (no GPU): ' + fps.toFixed(0) + ', draw calls ' + await A.evaluate(() => __lb.r.info.render.calls));
console.log(logs.join('\n') || '  ok  - no console errors in either browser');
if (logs.length) process.exitCode = 1;
await browser.close();
