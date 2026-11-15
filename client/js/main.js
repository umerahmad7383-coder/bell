// Entry point: connection, main menu, lobby, settings, and starting/stopping matches.
import * as THREE from 'three';
import RAPIER from '../vendor/rapier.es.js';
import { io } from '../vendor/socket.io.esm.min.js';
import { Game } from './game.js';
import { AudioSys } from './audio.js';
import { PLAYER_COLORS, PlayerModel } from './entities.js';
import { DIFFICULTY, DIFFICULTY_ORDER, LOOKS, LOOK_KEYS, LOOK_LABELS, cleanLook, randomLook } from '../shared/defs.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const qs = new URLSearchParams(location.search);
const SERVER = (qs.get('server') || window.LAST_BELL_SERVER || '').replace(/\/$/, '') || location.origin;

function fatal(msg) { const f = $('fatal'); f.hidden = false; f.textContent = msg; }
window.addEventListener('error', (e) => console.error('[last-bell]', e.message, e.filename, e.lineno));

// ---------------------------------------------------------------- settings
const store = { get(k, d) { try { const v = localStorage.getItem('lastbell.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('lastbell.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
const settings = { sens: 1, vol: 0.8, fov: 75, bright: 1, quality: 'medium', dynres: true, showfps: false, ...store.get('settings', {}) };
const audio = new AudioSys(); audio.volume = settings.vol;
for (const [id, key, num] of [['set-sens', 'sens', 1], ['set-vol', 'vol', 1], ['set-fov', 'fov', 1], ['set-bright', 'bright', 1], ['set-quality', 'quality', 0]]) {
  const el = $(id); el.value = settings[key];
  el.addEventListener('input', () => { settings[key] = num ? Number(el.value) : el.value; store.set('settings', settings); audio.setVolume(settings.vol); if (game) game.applySettings(); });
}

for (const [id, key] of [['set-dynres', 'dynres'], ['set-showfps', 'showfps']]) {
  const el = $(id); el.checked = !!settings[key];
  el.addEventListener('change', () => { settings[key] = el.checked; store.set('settings', settings); });
}

// ---------------------------------------------------------------- renderer (one WebGL context for the whole session)
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: settings.quality !== 'low', powerPreference: 'high-performance', stencil: false });
  renderer.setSize(innerWidth, innerHeight, false);
  // If the browser is drawing with the CPU instead of the graphics card, nothing in the game can make it smooth: say so.
  const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) { const w = $('gpu-warn'); w.hidden = false; w.textContent = 'Your browser is rendering without the graphics card, so the game will be slow. Turn on "Use graphics acceleration when available" in the browser settings and restart it.'; }
} catch (err) { fatal('This browser could not start WebGL, which the game needs.\n\nTry a current version of Chrome, Edge or Firefox with hardware acceleration enabled.\n\n' + err.message); throw err; }
{ // TV-static overlay texture
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'); const d = x.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) { const v = 120 + Math.random() * 135; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = Math.random() < 0.55 ? Math.random() * 255 : 0; }
  x.putImageData(d, 0, 0); $('fx-static').style.backgroundImage = `url(${c.toDataURL()})`;
}

// ---------------------------------------------------------------- screens
const MAIN = ['s-menu', 's-lobby', 's-loading'];
const OVER = ['s-join', 's-settings', 's-controls', 's-pause', 's-end', 's-character'];
function show(id) { for (const s of MAIN) $(s).hidden = s !== id; }
function overlay(id, on = true) { $(id).hidden = !on; }
const closeOverlays = () => OVER.forEach((o) => ($(o).hidden = true));
// Settings / Controls can be opened from the main menu or from the in-game pause panel. They replace
// the panel they were opened from (instead of stacking on top of it) and return to it when closed.
let subFrom = null;
function openSub(id) {
  subFrom = !$('s-pause').hidden ? 's-pause' : null;
  if (subFrom) overlay(subFrom, false);
  overlay('s-settings', false); overlay('s-controls', false);
  overlay(id);
}
function closeSub(el) {
  el.hidden = true;
  if ((el.id === 's-settings' || el.id === 's-controls') && subFrom && game && !game.ended) overlay(subFrom);
  subFrom = null;
  if (el.id === 's-character') closePreview();
}
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeSub(b.closest('.screen'))));
document.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; for (const id of ['s-settings', 's-controls', 's-join', 's-character']) if (!$(id).hidden) { closeSub($(id)); e.preventDefault(); return; } });
document.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') { audio.init(); audio.ui(); } });

// ---------------------------------------------------------------- state
let game = null, lobby = null, myId = null, rapierReady = null, starting = false;
const nameInput = $('name');
nameInput.value = store.get('name', '');
nameInput.addEventListener('input', () => store.set('name', nameInput.value));
const myName = () => nameInput.value.trim() || 'Student';

// ---------------------------------------------------------------- character creator
let look = cleanLook(store.get('look', null) || randomLook());
store.set('look', look);
let preview = null;
function renderLookOptions() {
  $('char-options').innerHTML = LOOK_KEYS.map((k) => {
    const isColor = LOOKS[k][0][0] === '#';
    const inner = LOOKS[k].map((v, i) => isColor
      ? `<button data-k="${k}" data-i="${i}" class="${look[k] === i ? 'sel' : ''}" style="background:${v}" title="${LOOK_LABELS[k]} ${i + 1}" aria-label="${LOOK_LABELS[k]} ${i + 1}"></button>`
      : `<button data-k="${k}" data-i="${i}" class="${look[k] === i ? 'sel' : ''}">${v}</button>`).join('');
    return `<div class="opt"><span>${LOOK_LABELS[k]}</span><div class="${isColor ? 'sw' : 'pick'}">${inner}</div></div>`;
  }).join('');
}
function setLook(next) {
  look = cleanLook(next); store.set('look', look);
  renderLookOptions();
  if (preview) preview.rebuild();
  if (lobby) socket.emit('lobby:look', look);
}
$('char-options').addEventListener('click', (e) => { const b = e.target.closest('button[data-k]'); if (b) setLook({ ...look, [b.dataset.k]: Number(b.dataset.i) }); });
$('btn-char-random').onclick = () => setLook(randomLook());
function openCharacter() {
  renderLookOptions(); overlay('s-character');
  if (preview) return;
  // a small second renderer, alive only while this panel is open
  const canvas = $('char-canvas');
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); r.setSize(300, 420, false);
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(32, 300 / 420, 0.1, 20);
  cam.position.set(0, 1.05, 3.9); cam.lookAt(0, 0.92, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.2); key.position.set(1.5, 3, 2.5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fa0ff, 1.2); rim.position.set(-2, 2, -2); scene.add(rim);
  let model = null, t = 0, last = performance.now(), raf = 0;
  const rebuild = () => { if (model) { scene.remove(model.group); model.dispose(); } model = new PlayerModel('', 0, look, { noTag: true }); scene.add(model.group); };
  rebuild();
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    const cyc = t % 16; // stand, walk, run, crouch — so you can see how the body moves
    const speed = cyc < 3 ? 0 : cyc < 8 ? 2.75 : cyc < 12 ? 5.3 : 1.2;
    model.group.rotation.y = t * 0.6;
    model.update(dt, { speed, crouch: cyc >= 12, downed: false, pitch: 0, flash: false, hurt: false });
    r.render(scene, cam);
  };
  tick();
  preview = { rebuild, close() { cancelAnimationFrame(raf); if (model) model.dispose(); r.dispose(); r.forceContextLoss(); } };
}
function closePreview() { if (preview) { preview.close(); preview = null; } }
$('btn-character').onclick = openCharacter;
$('btn-lobby-character').onclick = openCharacter;

// ---------------------------------------------------------------- connection
const socket = io(SERVER, { transports: ['websocket', 'polling'] });
const conn = $('conn');
const setConn = (text, cls) => { conn.textContent = text; conn.className = 'conn ' + cls; for (const b of ['btn-create', 'btn-join', 'btn-solo']) $(b).disabled = cls !== 'ok'; };
setConn('Connecting to server…', '');
socket.on('connect', () => setConn('Connected to server', 'ok'));
socket.on('connect_error', () => setConn(`Cannot reach the game server (${SERVER.replace(/^https?:\/\//, '')}). Retrying…`, 'bad'));
socket.on('disconnect', () => {
  setConn('Connection lost. Reconnecting…', 'bad');
  if (lobby) { // the server drops you from the lobby on disconnect, so go back to the menu
    lobby = null; stopGame(); closeOverlays(); show('s-menu');
    $('conn').textContent = 'Connection to the server was lost. Reconnecting…';
  }
});

// ---------------------------------------------------------------- menu
$('btn-create').onclick = () => socket.emit('lobby:create', { name: myName(), look }, (r) => { if (r && r.ok) enterLobby(r); });
$('btn-solo').onclick = () => socket.emit('lobby:create', { name: myName(), look }, (r) => { if (r && r.ok) { enterLobby(r); socket.emit('lobby:start', null, () => {}); } });
$('btn-join').onclick = () => { $('join-error').textContent = ''; overlay('s-join'); $('code').focus(); };
$('btn-settings').onclick = () => openSub('s-settings');
$('btn-controls').onclick = () => openSub('s-controls');
$('btn-pause-settings').onclick = () => openSub('s-settings');
$('btn-pause-controls').onclick = () => openSub('s-controls');
$('btn-fullscreen').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else { await document.documentElement.requestFullscreen(); if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyT', 'KeyN', 'Tab']).catch(() => {}); }
  } catch { /* user denied */ }
};
const codeInput = $('code');
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join-go').click(); });
$('btn-join-go').onclick = () => {
  if (codeInput.value.length !== 6) { $('join-error').textContent = 'Room codes are six characters.'; return; }
  socket.emit('lobby:join', { code: codeInput.value, name: myName(), look }, (r) => {
    if (!r || !r.ok) { $('join-error').textContent = (r && r.error) || 'Could not join.'; return; }
    overlay('s-join', false); enterLobby(r);
  });
};
if (qs.get('room')) { codeInput.value = qs.get('room').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); overlay('s-join'); }

// ---------------------------------------------------------------- lobby
function enterLobby(r) { myId = r.you; $('lobby-chatlog').innerHTML = ''; $('lobby-error').textContent = ''; sysLine('Share the room code or the invite link with your friends.'); show('s-lobby'); }
function inviteLink() {
  const u = new URL(location.href); u.search = ''; u.hash = '';
  u.searchParams.set('room', lobby.code);
  if (qs.get('server')) u.searchParams.set('server', qs.get('server'));
  return u.toString();
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  const old = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = old), 1400);
}
$('btn-copy-link').onclick = (e) => lobby && copy(inviteLink(), e.currentTarget);
$('btn-copy-code').onclick = (e) => lobby && copy(lobby.code, e.currentTarget);
$('btn-leave').onclick = leave;
$('btn-end-leave').onclick = leave;
$('btn-quit').onclick = leave;
function leave() { socket.emit('lobby:leave'); lobby = null; stopGame(); closeOverlays(); show('s-menu'); }
$('difficulties').addEventListener('click', (e) => { const el = e.target.closest('[data-diff]'); if (el && lobby && lobby.hostId === myId) socket.emit('lobby:difficulty', el.dataset.diff); });
$('btn-ready').onclick = () => { const me = lobby && lobby.players.find((p) => p.id === myId); if (me) socket.emit('lobby:ready', !me.ready); };
$('btn-start').onclick = () => socket.emit('lobby:start', null, (r) => { $('lobby-error').textContent = r && !r.ok ? r.error : ''; });
$('btn-rematch').onclick = () => socket.emit('lobby:return');
$('btn-resume').onclick = () => { overlay('s-pause', false); if (game) game.lock(); };
$('lobby-chatinput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) { socket.emit('chat', e.target.value.trim()); e.target.value = ''; } });
function sysLine(text) { const log = $('lobby-chatlog'); const d = document.createElement('div'); d.className = 'dim'; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; }
socket.on('chat', (c) => {
  const log = $('lobby-chatlog'); const i = lobby ? lobby.players.findIndex((p) => p.id === c.id) : 0;
  const d = document.createElement('div'); d.innerHTML = `<b style="color:${PLAYER_COLORS[Math.max(0, i) % 8]}">${esc(c.name)}</b>: ${esc(c.text)}`;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
});

socket.on('lobby:update', (l) => {
  const prev = lobby; lobby = l;
  if (prev) {
    for (const p of l.players) if (!prev.players.some((q) => q.id === p.id)) sysLine(`${p.name} joined.`);
    for (const p of prev.players) if (!l.players.some((q) => q.id === p.id)) sysLine(`${p.name} left.`);
  }
  const amHost = l.hostId === myId, me = l.players.find((p) => p.id === myId);
  $('lobby-code').textContent = l.code;
  $('lobby-count').textContent = `${l.players.length} / ${l.max}`;
  $('lobby-players').innerHTML = l.players.map((p, i) => `<li class="${p.id === myId ? 'me' : ''}"><span class="dot" style="background:${LOOKS.top[cleanLook(p.look, i).top]}"></span><span class="nm">${esc(p.name)}${p.id === myId ? ' <span class="dim">(you)</span>' : ''}</span>${p.id === l.hostId ? '<span class="tag host">Host</span>' : p.ready ? '<span class="tag ready">Ready</span>' : '<span class="tag">Not ready</span>'}</li>`).join('');
  $('btn-start').hidden = !amHost; $('btn-ready').hidden = amHost;
  $('btn-ready').textContent = me && me.ready ? 'Ready ✓ (click to cancel)' : 'Ready up';
  $('btn-ready').classList.toggle('on', !!(me && me.ready));
  const waiting = l.players.filter((p) => p.id !== l.hostId && !p.ready).length;
  $('btn-start').disabled = l.state === 'playing' || waiting > 0;
  $('lobby-note').textContent = l.state === 'playing' ? (me && me.inGame ? '' : 'A match is in progress. You will join the next round when it ends.')
    : amHost ? (waiting ? `Waiting for ${waiting} player${waiting > 1 ? 's' : ''} to ready up.` : l.players.length < 2 ? 'You can start alone to practise, or wait for friends to join.' : 'Everyone is ready.') : 'The host starts the match once everyone is ready.';
  // difficulty: the host picks, everyone sees it
  $('diff-note').textContent = amHost ? '' : '(the host chooses)';
  $('difficulties').innerHTML = DIFFICULTY_ORDER.map((k) => `<div class="mode${k === l.difficulty ? ' sel' : ''}${amHost && l.state !== 'playing' ? '' : ' locked'}" data-diff="${k}"><b>${DIFFICULTY[k].label}</b><span>${DIFFICULTY[k].blurb}</span></div>`).join('');
  $('btn-rematch').hidden = !amHost;
  $('end-note').textContent = amHost ? '' : 'Waiting for the host to start a rematch…';
  // rematch: host sent everyone back to the lobby
  if (l.state === 'lobby' && (game || !$('s-end').hidden)) { stopGame(); closeOverlays(); show('s-lobby'); }
});

// ---------------------------------------------------------------- match lifecycle
const TIPS = [
  'He hears you run. Walk when you can; crouch when he is close.',
  'Your torch makes you easy to see. Turn it off (F) and hold still if he has not noticed you.',
  'Lockers hide you — unless he watched you climb in.',
  'Throw a bottle (left click) to pull him away from where you need to go.',
  'The hand bell drives him off for a few seconds. It only works once.',
  'Close doors behind you. He has to stop to open them.',
  'Drop items with G to hand them to a teammate.',
  'When the power comes back on, he comes to the basement. Do not be there.',
  'Someone watching the monitors in the Security Office can call out where he is.',
];
socket.on('game:start', async (init) => {
  if (starting) return; starting = true;
  stopGame(); closeOverlays(); show('s-loading');
  $('loading-tip').textContent = TIPS[(Math.random() * TIPS.length) | 0];
  const step = async (pct, text) => { $('loading-bar').style.width = pct + '%'; $('loading-text').textContent = text; await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30))); };
  try {
    await step(15, 'Unlocking the front doors…');
    rapierReady ||= RAPIER.init();
    await rapierReady;
    await step(45, 'Finding the light switches…');
    audio.init(); audio.resumeAmbience();
    game = new Game({ renderer, socket, init, settings, audio, RAPIER, ui: { onPause: () => { if (game && !game.ended) overlay('s-pause'); }, blocked: () => OVER.some((o) => !$(o).hidden) } });
    await step(100, 'Something is already inside.');
    show(null);
  } catch (err) {
    console.error(err);
    fatal('The game failed to start:\n\n' + (err && err.stack ? err.stack : err));
  } finally { starting = false; }
});

socket.on('game:over', (sum) => {
  if (!game) return; // joined mid-match: nothing to summarise for this player
  game.end();
  audio.endJingle(sum.win);
  overlay('s-pause', false);
  const mins = Math.floor(sum.time / 60), secs = String(sum.time % 60).padStart(2, '0');
  const escaped = sum.players.filter((p) => p.state === 'escaped').length;
  $('end-title').textContent = sum.win ? (escaped === sum.players.length ? 'EVERYONE ESCAPED' : 'ESCAPED') : 'CLASS IS NOT DISMISSED';
  $('end-title').classList.toggle('lose', !sum.win);
  const diff = DIFFICULTY[sum.difficulty] ? ` Difficulty: ${DIFFICULTY[sum.difficulty].label}.` : '';
  $('end-sub').textContent = (sum.win ? `${escaped} of ${sum.players.length} made it out in ${mins}:${secs}.` : `Nobody left the school. You lasted ${mins}:${secs} and completed ${sum.stage} of 6 steps.`) + diff;
  $('end-table').innerHTML = sum.players.map((p) => `<tr><td>${esc(p.name)}${p.id === myId ? ' <span class="dim">(you)</span>' : ''}</td><td class="st-${p.state === 'escaped' ? 'escaped' : 'dead'}">${p.state === 'escaped' ? `Survived · out at ${Math.floor(p.t / 60)}:${String(p.t % 60).padStart(2, '0')}` : 'Did not survive'}</td></tr>`).join('');
  setTimeout(() => overlay('s-end'), 1200);
});

function stopGame() { if (game) { game.dispose(); game = null; } audio.stopAmbience(); }

show('s-menu');
