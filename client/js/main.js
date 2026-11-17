// Entry point: connection, main menu, lobby, settings, and starting/stopping matches.
import * as THREE from 'three';
import RAPIER from '../vendor/rapier.es.js';
import { io } from '../vendor/socket.io.esm.min.js';
import { Game } from './game.js';
import { AudioSys } from './audio.js';
import { Voice } from './voice.js';
import { MenuScene } from './menubg.js';
import { input, padGlyph, padName, BTN } from './input.js';
import { startPadNav } from './padnav.js';
import { renderPadDiagram, padTables, livePadDiagram } from './paddiagram.js';
import { PLAYER_COLORS, PlayerModel } from './entities.js';
import { DIFFICULTY, DIFFICULTY_ORDER, MODIFIERS, MODIFIER_ORDER, CLASSES, CLASS_ORDER, TUNE, TUNE_ORDER, LOOKS, LOOK_KEYS, LOOK_LABELS, cleanLook, randomLook } from '../shared/defs.js';

const $ = (id) => document.getElementById(id);
/** set a button's text without wiping its icon */
const setLabel = (btn, text) => { const l = btn.querySelector('.lbl'); if (l) l.textContent = text; else btn.textContent = text; };
const labelOf = (btn) => { const l = btn.querySelector('.lbl'); return (l || btn).textContent; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const qs = new URLSearchParams(location.search);
const SERVER = (qs.get('server') || window.LAST_BELL_SERVER || '').replace(/\/$/, '') || location.origin;

function fatal(msg) { const f = $('fatal'); f.hidden = false; f.textContent = msg; }
window.addEventListener('error', (e) => console.error('[last-bell]', e.message, e.filename, e.lineno));

// ---------------------------------------------------------------- settings
const store = { get(k, d) { try { const v = localStorage.getItem('lastbell.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('lastbell.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
const settings = { sens: 1, vol: 0.8, fov: 75, bright: 1, quality: 'medium', dynres: true, showfps: false, togglecrouch: false, tips: true, jumpscares: true, ptt: false, padsens: 1, padinvert: false, vibrate: true, ...store.get('settings', {}) };
input.vibrate = settings.vibrate;
const audio = new AudioSys(); audio.volume = settings.vol;
for (const [id, key, num] of [['set-sens', 'sens', 1], ['set-vol', 'vol', 1], ['set-fov', 'fov', 1], ['set-bright', 'bright', 1], ['set-padsens', 'padsens', 1], ['set-quality', 'quality', 0]]) {
  const el = $(id); el.value = settings[key];
  const fill = () => { if (el.type === 'range') el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`); };
  fill();
  el.addEventListener('input', () => { fill(); settings[key] = num ? Number(el.value) : el.value; store.set('settings', settings); audio.setVolume(settings.vol); if (game) game.applySettings(); });
}

for (const [id, key] of [['set-dynres', 'dynres'], ['set-showfps', 'showfps'], ['set-togglecrouch', 'togglecrouch'], ['set-tips', 'tips'], ['set-jumpscares', 'jumpscares'], ['set-ptt', 'ptt'], ['set-padinvert', 'padinvert'], ['set-vibrate', 'vibrate']]) {
  const el = $(id); el.checked = !!settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked; store.set('settings', settings);
    if (key === 'ptt' && voice) voice.setPtt(el.checked);
    if (key === 'vibrate') { input.vibrate = el.checked; if (el.checked) input.rumble(0.5, 0.5, 220); }
  });
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
  x.putImageData(d, 0, 0); const noise = `url(${c.toDataURL()})`; $('fx-static').style.backgroundImage = noise; $('fx-grain').style.backgroundImage = noise;
}

// ---------------------------------------------------------------- screens
const MAIN = ['s-menu', 's-lobby', 's-loading'];
const OVER = ['s-join', 's-settings', 's-controls', 's-pause', 's-end', 's-character'];
const scene = new MenuScene($('menubg'));
function show(id) {
  for (const s of MAIN) $(s).hidden = s !== id;
  // the night-time school behind the menu and the lobby; switched off while a match renders
  if (id === 's-menu' || id === 's-lobby') scene.start(); else scene.stop();
}
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

// ---------------------------------------------------------------- controls screen: keyboard, or the controller that is connected
let ctlTab = 'kbm', ctlKind = null; // ctlKind: the layout chosen on the page (null = follow the connected pad)
function openControls() { ctlTab = input.connected || input.mode === 'pad' ? 'pad' : 'kbm'; ctlKind = null; renderControls(); openSub('s-controls'); }
function renderControls() {
  const kind = ctlKind || (input.connected ? input.kind : 'xbox');
  document.querySelectorAll('#s-controls .tab').forEach((t) => { const on = t.dataset.tab === ctlTab; t.classList.toggle('on', on); t.setAttribute('aria-selected', on); });
  document.querySelectorAll('#s-controls .ctab').forEach((c) => (c.hidden = c.dataset.tab !== ctlTab));
  document.querySelectorAll('#s-controls .seg button').forEach((b) => { const on = b.dataset.kind === (kind === 'xbox' ? 'xbox' : 'ps'); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  $('pad-conn').innerHTML = input.connected ? `<span class="live"></span>Connected: ${esc(padName(input.id))}. Press any button to see it light up.` : 'No controller connected. Plug one in or pair it, then press any button.';
  if (ctlTab === 'pad') { renderPadDiagram($('pad-diagram'), kind); const t = padTables(kind); $('pad-hunter').innerHTML = t.hunter; $('pad-menus').innerHTML = t.menus; }
}
document.querySelectorAll('#s-controls .tab').forEach((t) => t.addEventListener('click', () => { ctlTab = t.dataset.tab; renderControls(); }));
document.querySelectorAll('#s-controls .seg button').forEach((b) => b.addEventListener('click', () => { ctlKind = b.dataset.kind === 'ps' ? (input.connected && input.ps ? input.kind : 'ps5') : 'xbox'; renderControls(); }));
// main menu: say when a controller is connected
function padStatus() {
  const el = $('pad-status');
  el.hidden = !input.connected;
  const quiet = !audio.ctx || audio.ctx.state !== 'running'; // browsers only allow sound after a click or a key press, and a controller button does not count
  if (input.connected) el.innerHTML = `<svg><use href="#i-pad"/></svg>${esc(padName(input.id))} connected · ${padGlyph(BTN.A)} to choose, ${padGlyph(BTN.B)} to go back${quiet ? '<br><span class="dim">Click once or press any key to turn the sound on.</span>' : ''}`;
}
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { audio.init(); setTimeout(padStatus, 60); }, true);
input.onChange(() => { padStatus(); if (!$('s-controls').hidden) renderControls(); });
padStatus();
// menus with the controller
startPadNav({
  container() {
    for (const id of ['s-settings', 's-controls', 's-character', 's-join', 's-pause', 's-end']) if (!$(id).hidden) return $(id);
    if (game && !game.ended) return null; // the match has the controller
    if (!$('s-lobby').hidden) return $('s-lobby');
    if (!$('s-menu').hidden) return $('s-menu');
    return null;
  },
  preferred(c) {
    const vis = (id) => (!$(id).hidden ? $(id) : null);
    return { 's-menu': $('btn-create'), 's-lobby': vis('btn-start') || vis('btn-ready'), 's-pause': $('btn-resume'), 's-end': vis('btn-rematch') || $('btn-end-leave'), 's-join': $('btn-join-go'), 's-controls': c.querySelector('.tab.on') }[c.id] || null; // other panels start at their first control
  },
  back(c) {
    if (['s-settings', 's-controls', 's-character', 's-join'].includes(c.id)) closeSub(c);
    else if (c.id === 's-pause') $('btn-resume').click();
  },
  menu(c) {
    if (c.id === 's-pause') $('btn-resume').click();
    else if (['s-settings', 's-controls'].includes(c.id) && game && !game.ended) closeSub(c);
  },
  tab(c, d) { if (c.id === 's-controls') { ctlTab = ctlTab === 'kbm' ? 'pad' : 'kbm'; renderControls(); } },
});
// the controller page lights up what you press
(function liveTick() { requestAnimationFrame(liveTick); if (!$('s-controls').hidden && ctlTab === 'pad') livePadDiagram($('pad-diagram')); })();

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
setConn('Connecting to the server…', '');
// Your seat in a lobby (code + a private token) lives in this tab's sessionStorage, so a dropped
// connection or a refresh can put you straight back where you were (the server holds it ~45 s).
const seat = {
  get() { try { return JSON.parse(sessionStorage.getItem('lastbell.seat')); } catch { return null; } },
  set(v) { try { if (v) sessionStorage.setItem('lastbell.seat', JSON.stringify(v)); else sessionStorage.removeItem('lastbell.seat'); } catch { /* private mode */ } },
};
let offline = false;
function lostSeat(msg) {
  seat.set(null); offline = false;
  if (lobby || game) { lobby = null; stopGame(); closeOverlays(); show('s-menu'); }
  if (msg) { $('conn').textContent = msg; $('conn').className = 'conn bad'; }
}
socket.on('connect', () => {
  setConn('Connected to the server', 'ok');
  const sv = seat.get();
  if (!sv) { if (offline) lostSeat('You were disconnected from the lobby.'); return; }
  socket.emit('lobby:resume', sv, (r) => {
    if (!r || !r.ok) { lostSeat(offline ? 'You were away too long and lost your place. Ask for the room code to join again.' : ''); return; }
    offline = false; myId = r.you; seat.set({ code: r.code, token: r.token });
    if (game && r.inGame) { game.setOffline(false); return; } // the match is rebuilt from the server's state in a moment (game:start)
    if (game && r.ended) { game.setOffline(false); return; } // it finished while we were away: the report card arrives next (game:over)
    if (game) { stopGame(); closeOverlays(); }
    overlay('s-join', false); enterLobby(r);
  });
});
socket.on('connect_error', () => setConn(`Cannot reach the game server (${SERVER.replace(/^https?:\/\//, '')}). Retrying…`, 'bad'));
socket.on('disconnect', (reason) => {
  setConn('Connection lost. Reconnecting…', 'bad');
  if (!lobby) return;
  if (reason === 'io server disconnect') { lostSeat('You were disconnected from the lobby.'); return; } // the server closed it on purpose (e.g. the same seat was taken up in another tab)
  // keep everything on screen and try to get back in
  offline = true;
  if (voice.enabled) voice.disable();
  if (game) game.setOffline(true);
  else $('lobby-note').textContent = 'Connection lost. Getting you back in…';
});

// ---------------------------------------------------------------- voice chat
const voice = new Voice(socket, audio);
voice.setPtt(settings.ptt);
function voiceUi() {
  const b = $('btn-voice');
  setLabel(b, voice.enabled ? (voice.muted ? 'Voice muted (click to turn off)' : 'Voice on (click to turn off)') : 'Turn on voice chat');
  b.classList.toggle('on', voice.enabled);
  $('voice-note').textContent = voice.enabled ? `Voice: connected to ${voice.connected()} of ${voice.peers.size} other player${voice.peers.size === 1 ? '' : 's'} with voice on. In the match it is proximity-based: people fade with distance and walls, and the Headmaster hears you too. ${settings.ptt ? 'Hold V to talk.' : 'M mutes your mic.'}` : '';
}
voice.onChange = voiceUi;
$('btn-voice').onclick = async () => {
  if (voice.enabled) { voice.disable(); return; }
  try { $('voice-note').textContent = 'Asking for the microphone…'; await voice.enable(); }
  catch (err) { $('voice-note').textContent = err && err.name === 'NotAllowedError' ? 'Microphone permission was refused. Allow it for this site (the padlock icon in the address bar) and try again.' : `Voice chat could not start: ${err.message || err}`; }
};
// in the lobby (no match running) everyone with voice on simply hears everyone
setInterval(() => { if (!game && voice.enabled) voice.frame(0.25, null, null); if (voice.enabled && !$('s-lobby').hidden) voiceUi(); }, 250);

// ---------------------------------------------------------------- menu
$('btn-create').onclick = () => socket.emit('lobby:create', { name: myName(), look }, (r) => { if (r && r.ok) enterLobby(r); });
$('btn-solo').onclick = () => socket.emit('lobby:create', { name: myName(), look }, (r) => { if (r && r.ok) { enterLobby(r); socket.emit('lobby:start', null, () => {}); } });
$('btn-join').onclick = () => { $('join-error').textContent = ''; overlay('s-join'); $('code').focus(); };
$('btn-settings').onclick = () => openSub('s-settings');
$('btn-controls').onclick = () => openControls();
$('btn-pause-settings').onclick = () => openSub('s-settings');
$('btn-pause-controls').onclick = () => openControls();
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
function enterLobby(r) { myId = r.you; if (r.token) seat.set({ code: r.code, token: r.token }); $('lobby-chatlog').innerHTML = ''; $('lobby-error').textContent = ''; sysLine('Share the room code or the invite link with your friends.'); if (lobby) renderLobby(lobby); show('s-lobby'); }
function inviteLink() {
  const u = new URL(location.href); u.search = ''; u.hash = '';
  u.searchParams.set('room', lobby.code);
  if (qs.get('server')) u.searchParams.set('server', qs.get('server'));
  return u.toString();
}
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  if (btn.dataset.busy) return; btn.dataset.busy = 1;
  const old = labelOf(btn); setLabel(btn, 'Copied'); setTimeout(() => { setLabel(btn, old); delete btn.dataset.busy; }, 1400);
}
$('btn-copy-link').onclick = (e) => lobby && copy(inviteLink(), e.currentTarget);
$('btn-copy-code').onclick = (e) => lobby && copy(lobby.code, e.currentTarget);
$('btn-leave').onclick = leave;
$('btn-end-leave').onclick = leave;
$('btn-quit').onclick = leave;
function leave() { voice.disable(); socket.emit('lobby:leave'); seat.set(null); lobby = null; stopGame(); closeOverlays(); show('s-menu'); }
document.querySelectorAll('.mode[data-mode] input').forEach((inp) => inp.addEventListener('change', () => { if (lobby && lobby.hostId === myId) socket.emit('lobby:mode', inp.value); }));
$('classes').addEventListener('click', (e) => { const el = e.target.closest('[data-cls]'); if (el && lobby) { socket.emit('lobby:class', el.dataset.cls); audio.ui(); } });
const tuneText = (k, v) => (k === 'hits' && !v ? 'Automatic' : `${v}${TUNE[k].unit}`);
/** draw the tuning sliders, updating in place so a slider being dragged is never yanked away */
function renderTune(t, canEdit) {
  $('tune-note').textContent = canEdit ? '(changes apply to the next match)' : '(the host chooses)';
  $('btn-tune-reset').hidden = !canEdit;
  if (!$('tune').children.length) {
    $('tune').innerHTML = TUNE_ORDER.map((k) => `<label class="tune-row">${TUNE[k].label}<output data-out="${k}"></output><input type="range" data-tune="${k}" min="${TUNE[k].min}" max="${TUNE[k].max}" step="${TUNE[k].step}"></label>`).join('');
  }
  for (const k of TUNE_ORDER) {
    const el = $('tune').querySelector(`[data-tune="${k}"]`), v = t[k] ?? TUNE[k].def;
    el.disabled = !canEdit;
    if (document.activeElement !== el) { el.value = v; $('tune').querySelector(`[data-out="${k}"]`).textContent = tuneText(k, v); }
    el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
  }
}
$('tune').addEventListener('input', (e) => { const el = e.target.closest('[data-tune]'); if (!el) return; const k = el.dataset.tune; $('tune').querySelector(`[data-out="${k}"]`).textContent = tuneText(k, Number(el.value)); el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`); });
$('tune').addEventListener('change', (e) => { const el = e.target.closest('[data-tune]'); if (el && lobby && lobby.hostId === myId) socket.emit('lobby:tune', { key: el.dataset.tune, value: Number(el.value) }); });
$('btn-tune-reset').addEventListener('click', () => { if (lobby && lobby.hostId === myId) socket.emit('lobby:tune', 'reset'); });
$('mods').addEventListener('click', (e) => { const el = e.target.closest('[data-mod]'); if (el && !el.disabled && lobby && lobby.hostId === myId) socket.emit('lobby:mod', el.dataset.mod); });
$('difficulties').addEventListener('click', (e) => { const el = e.target.closest('[data-diff]'); if (el && lobby && lobby.hostId === myId) socket.emit('lobby:difficulty', el.dataset.diff); });
$('difficulties').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { const el = e.target.closest('[data-diff]'); if (el && lobby && lobby.hostId === myId) { e.preventDefault(); socket.emit('lobby:difficulty', el.dataset.diff); } } });
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

// The first update can arrive before we know our own id (it is sent just before the reply to
// create/join), so entering the lobby draws it again once the id is known.
socket.on('lobby:update', (l) => renderLobby(l));
function renderLobby(l) {
  const prev = lobby; lobby = l;
  if (prev) {
    for (const p of l.players) if (!prev.players.some((q) => q.id === p.id)) sysLine(`${p.name} joined.`);
    for (const p of prev.players) if (!l.players.some((q) => q.id === p.id)) sysLine(`${p.name} left.`);
  }
  const amHost = l.hostId === myId, me = l.players.find((p) => p.id === myId);
  $('lobby-code').textContent = l.code;
  $('lobby-count').textContent = `${l.players.length} / ${l.max}`;
  $('lobby-players').innerHTML = l.players.map((p, i) => `<li class="${p.id === myId ? 'me' : ''}"><span class="dot" style="background:${LOOKS.top[cleanLook(p.look, i).top]}"></span><span class="nm">${CLASSES[p.cls] ? `<span class="ci" title="${CLASSES[p.cls].label}">${CLASSES[p.cls].icon}</span>` : ''}${esc(p.name)}${p.id === myId ? ' <span class="dim">(you)</span>' : ''}</span>${p.voice ? '<svg class="v" aria-label="voice chat on"><use href="#i-mic"/></svg>' : '<span></span>'}${p.away ? '<span class="tag away">Reconnecting…</span>' : p.id === l.hostId ? '<span class="tag host">Host</span>' : p.ready ? '<span class="tag ready">Present</span>' : '<span class="tag">Not ready</span>'}</li>`).join('');
  $('btn-start').hidden = !amHost; $('btn-ready').hidden = amHost;
  setLabel($('btn-ready'), me && me.ready ? 'You are ready (click to cancel)' : 'Ready up');
  $('btn-ready').classList.toggle('on', !!(me && me.ready));
  const waiting = l.players.filter((p) => p.id !== l.hostId && !p.ready && !p.away).length;
  $('btn-start').disabled = l.state === 'playing' || waiting > 0;
  $('lobby-note').textContent = l.state === 'playing' ? (me && me.inGame ? '' : 'A match is in progress. You will join the next round when it ends.')
    : amHost ? (waiting ? `Waiting for ${waiting} player${waiting > 1 ? 's' : ''} to ready up.` : l.players.length < 2 ? 'You can start alone to practise, or wait for friends to join.' : 'Everyone is ready.') : 'The host starts the match once everyone is ready.';
  // game mode: the host picks
  document.querySelectorAll('.mode[data-mode]').forEach((el) => { const on = el.dataset.mode === l.mode; el.classList.toggle('on', on); el.querySelector('input').checked = on; el.querySelector('input').disabled = !amHost || l.state === 'playing'; });
  $('difficulties').style.opacity = l.mode === 'hunt' ? 0.35 : 1;
  // Hunt Mode: the difficulty picker gives way to the Headmaster tuning sliders
  $('diff-block').hidden = l.mode === 'hunt'; $('tune-block').hidden = l.mode !== 'hunt';
  renderTune(l.tune || {}, amHost && l.state !== 'playing');
  const meP = l.players.find((p) => p.id === myId), myCls = meP ? meP.cls : 'athlete';
  $('classes').innerHTML = CLASS_ORDER.map((k) => `<button class="cls${k === myCls ? ' on' : ''}" data-cls="${k}" aria-pressed="${k === myCls}"><span class="ic">${CLASSES[k].icon}</span><b>${CLASSES[k].label}</b><span>${CLASSES[k].blurb}</span></button>`).join('');
  const mods = new Set(l.mods || []), canMod = amHost && l.state !== 'playing';
  $('mods-note').textContent = canMod ? '(optional, any mix)' : '(the host chooses)';
  $('mods').innerHTML = MODIFIER_ORDER.map((k) => `<button class="modchip${mods.has(k) ? ' on' : ''}" data-mod="${k}" aria-pressed="${mods.has(k)}"${canMod ? '' : ' disabled'}><span class="sw"></span><b>${MODIFIERS[k].label}</b><span>${MODIFIERS[k].blurb}</span></button>`).join('');
  // difficulty: the host picks, everyone sees it
  $('diff-note').textContent = l.mode === 'hunt' ? '(Escape only. Hunt has its own balance)' : amHost ? '' : '(the host chooses)';
  const bells = (n) => [0, 1, 2, 3].map((i) => `<svg class="${i < n ? '' : 'off'}"><use href="#i-bell"/></svg>`).join('');
  $('difficulties').innerHTML = DIFFICULTY_ORDER.map((k, n) => `<div class="diff${k === l.difficulty ? ' sel' : ''}${amHost && l.state !== 'playing' ? '' : ' locked'}" data-diff="${k}" role="button" tabindex="0" aria-pressed="${k === l.difficulty}"><div class="dh"><b>${DIFFICULTY[k].label}</b><i class="pips" aria-label="${n + 1} of 4">${bells(n + 1)}</i></div><span>${DIFFICULTY[k].blurb}</span></div>`).join('');
  $('btn-rematch').hidden = !amHost;
  $('end-note').textContent = amHost ? '' : 'Waiting for the host to start a rematch…';
  // rematch: host sent everyone back to the lobby
  if (l.state === 'lobby' && (game || !$('s-end').hidden)) { stopGame(); closeOverlays(); show('s-lobby'); }
}

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
    game = new Game({ renderer, socket, init, settings, audio, RAPIER, voice, ui: { onPause: () => { if (game && !game.ended) overlay('s-pause'); }, blocked: () => OVER.some((o) => !$(o).hidden) } });
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
  audio.endJingle(sum.hunter && sum.hunter.id === myId ? !sum.win : sum.win);
  overlay('s-pause', false);
  const mins = Math.floor(sum.time / 60), secs = String(sum.time % 60).padStart(2, '0');
  const escaped = sum.players.filter((p) => p.state === 'escaped').length;
  const iAmHunter = sum.hunter && sum.hunter.id === myId;
  const mine = sum.players.find((p) => p.id === myId);
  $('end-title').textContent = iAmHunter ? (sum.win ? 'They got away' : 'Class is not dismissed')
    : !sum.win ? 'Class is not dismissed' : escaped === sum.players.length ? 'Everyone escaped' : mine && mine.state === 'escaped' ? 'You got out' : 'They got out without you';
  $('end-title').classList.toggle('lose', iAmHunter ? sum.win : !sum.win);
  const diff = sum.mode === 'hunt' ? ' Hunt Mode.' : DIFFICULTY[sum.difficulty] ? ` Difficulty: ${DIFFICULTY[sum.difficulty].label}.` : '';
  const rules = (sum.mods || []).map((k) => MODIFIERS[k] && MODIFIERS[k].label).filter(Boolean);
  $('end-sub').textContent = (sum.win ? `${escaped} of ${sum.players.length} made it out in ${mins}:${secs}.` : `Nobody left the school. You lasted ${mins}:${secs} and completed ${sum.stage} of 6 steps.`) + diff + (rules.length ? ` Rules: ${rules.join(', ')}.` : '');
  $('end-table').innerHTML = (sum.hunter ? hunterCard(sum, iAmHunter) : '') + sum.players.map((p) => reportCard(p, p.id === myId)).join('');
  setTimeout(() => overlay('s-end'), 1200);
});

/** End of match: a school report card for each pupil, graded on what they actually did. */
const clock = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
function grade(score) {
  const g = score >= 75 ? 'A+' : score >= 58 ? 'A' : score >= 44 ? 'B' : score >= 30 ? 'C' : score >= 16 ? 'D' : 'F';
  return { g, cls: score >= 44 ? '' : score >= 16 ? 'mid' : 'low' };
}
function reportCard(p, me) {
  const st = p.stats || {}, out = p.state === 'escaped';
  const score = (out ? 40 : 0) + (st.fuses || 0) * 8 + (st.revives || 0) * 12 + (st.photos || 0) * 8 + (st.rolls || 0) * 10 + (st.teddy || 0) * 15
    + (st.breath || 0) * 6 + (st.lures || 0) * 3 + Math.min(5, st.marks || 0) + (st.thrown || 0) * 2 - (st.hits || 0) * 7;
  const { g, cls } = grade(score);
  const rows = [['Attendance', out ? `out at ${clock(p.t)}` : 'did not leave']];
  if (st.fuses) rows.push(['Fuses found', st.fuses]);
  if (st.revives) rows.push(['Classmates revived', st.revives]);
  if (st.photos) rows.push(['Flashed him', `${st.photos}×`]);
  if (st.breath) rows.push(['Held their breath', `${st.breath}×`]);
  if (st.rolls) rows.push(['Survived roll call', `${st.rolls}×`]);
  if (st.lures || st.thrown) rows.push(['Distractions', (st.lures || 0) + (st.thrown || 0)]);
  if (st.teddy) rows.push(["Returned Thomas's bear", '✓']);
  rows.push(['Times hit', st.hits || 0]);
  const comment = st.teddy ? 'Kind to the youngest pupil. Thomas sends his thanks.'
    : (st.revives || 0) >= 2 ? 'Never leaves a classmate behind.'
    : st.photos ? 'Looked him right in the eye. Remarkable nerve.'
    : (st.fuses || 0) >= 2 ? 'Did the real work while others hid.'
    : st.breath ? 'Holds their breath like a champion.'
    : out && !st.hits ? 'Untouched. Suspiciously so.'
    : out ? 'Made it out. That is what counts.'
    : 'Must try harder. Must try to live.';
  return `<div class="card"><div class="who">${esc(p.name)}<small>${me ? 'You' : out ? 'Survived' : 'Did not survive'}</small></div><div class="grade ${cls}">${g}</div><ul>${rows.map(([a, v]) => `<li><span>${a}</span><span>${v}</span></li>`).join('')}</ul><div class="comment">${comment}</div></div>`;
}
function hunterCard(sum, me) {
  const h = sum.hunter, won = !sum.win, { g, cls } = grade((won ? 50 : 0) + h.hits * 9);
  return `<div class="card hunter"><div class="who">${esc(h.name)}<small>${me ? 'You, ' : ''}the Headmaster</small></div><div class="grade ${cls}">${g}</div><ul><li><span>Hits landed</span><span>${h.hits}</span></li><li><span>Pupils kept in</span><span>${sum.players.filter((p) => p.state !== 'escaped').length} of ${sum.players.length}</span></li></ul><div class="comment">${won ? 'Nobody leaves early.' : 'Too soft on them this term.'}</div></div>`;
}
function statLine(st) {
  if (!st) return '';
  const parts = [];
  if (st.fuses) parts.push(`${st.fuses} fuse${st.fuses > 1 ? 's' : ''} found`);
  if (st.revives) parts.push(`${st.revives} revive${st.revives > 1 ? 's' : ''}`);
  if (st.thrown) parts.push(`${st.thrown} bottle${st.thrown > 1 ? 's' : ''} thrown`);
  parts.push(st.hits ? `hit ${st.hits}×` : 'never hit');
  return parts.join(' · ');
}
function stopGame() { if (game) { game.dispose(); game = null; } audio.stopAmbience(); }

show('s-menu');
