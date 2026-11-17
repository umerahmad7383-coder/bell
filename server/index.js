// THE LAST BELL — multiplayer server.
// Serves the static client AND hosts the Socket.IO game backend on one port,
// so a single web service gives you https:// + wss:// on the same URL.
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Game, TICK_HZ } from './game.js';
import { DIFFICULTY, MODIFIERS, TUNE, cleanLook, cleanClass, cleanTune } from '../client/shared/defs.js';

const PORT = Number(process.env.PORT) || 3000;
// Comma-separated list of allowed browser origins when the client is hosted
// elsewhere (e.g. https://my-game.netlify.app). "*" allows any origin.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const MAX_PLAYERS = Math.min(8, Number(process.env.MAX_PLAYERS) || 8);
const MIN_PLAYERS = Math.max(1, Number(process.env.MIN_PLAYERS) || 1); // 1 lets you test solo
// A player whose connection drops (Wi-Fi blip, phone hotspot, an accidental refresh) keeps their place
// in the lobby and the match for this long, and is put straight back in when they reconnect.
const RESUME_SECS = Math.max(1, Number(process.env.RESUME_SECS) || 45);
// Voice chat connects players directly (WebRTC). STUN servers let them find a route through home
// routers. Some strict networks also need a TURN relay: put one here as JSON, e.g.
//   ICE_SERVERS=[{"urls":"turn:turn.example.com:3478","username":"u","credential":"p"}]
let ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
try { if (process.env.ICE_SERVERS) ICE_SERVERS = ICE_SERVERS.concat(JSON.parse(process.env.ICE_SERVERS)); } catch { console.error('ICE_SERVERS is not valid JSON; ignoring it'); }

const app = express();
const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');
app.get('/health', (_req, res) => res.json({ ok: true, lobbies: lobbies.size, uptime: Math.round(process.uptime()) }));
// "no-cache" = the browser may keep files but must ask whether they changed before using them,
// so a redeploy reaches every player on their next page load (no stale game code).
app.use(express.static(clientDir, { etag: true, lastModified: true, setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN === '*' ? true : CLIENT_ORIGIN.split(',').map((s) => s.trim()) },
  pingInterval: 10000, pingTimeout: 20000,
});

/** code -> lobby */
const lobbies = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid misreads

function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!lobbies.has(c)) return c;
  }
}
const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Student';

function lobbyView(l) {
  return {
    code: l.code, hostId: l.hostPid, mode: l.mode, difficulty: l.difficulty, mods: [...l.mods], tune: l.tune, state: l.state, max: MAX_PLAYERS, min: MIN_PLAYERS,
    players: [...l.members.values()].map((m) => ({ id: m.pid, name: m.name, look: m.look, cls: m.cls, ready: m.ready, voice: !!m.voice, away: !!m.away, inGame: inGame(l, m.pid) })),
    last: l.last || null,
  };
}
const pushLobby = (l) => io.to(l.code).emit('lobby:update', lobbyView(l));
const inGame = (l, pid) => !!(l.game && l.state === 'playing' && (l.game.players.has(pid) || l.game.hunter === pid));
const memberByPid = (l, pid) => { for (const m of l.members.values()) if (m.pid === pid) return m; return null; };

function uniqueName(l, name) {
  const taken = new Set([...l.members.values()].map((m) => m.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 99; i++) { const n = `${name.slice(0, 13)} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  return name;
}

function joinLobby(socket, l, name, look) {
  const pid = l.nextPid++;
  const m = { pid, name: uniqueName(l, cleanName(name)), look: cleanLook(look, pid - 1), cls: 'athlete', ready: false, sid: socket.id, token: randomUUID(), away: false, awayTimer: null };
  l.members.set(socket.id, m);
  socket.join(l.code);
  socket.data.code = l.code; socket.data.pid = pid;
  if (!l.hostPid) l.hostPid = pid;
  pushLobby(l);
  return m;
}

/** a member really leaves (on purpose, or after being away too long) */
function dropMember(l, sid) {
  const m = l.members.get(sid);
  if (!m) return;
  if (m.awayTimer) clearTimeout(m.awayTimer);
  l.members.delete(sid);
  if (l.game) l.game.removePlayer(m.pid);
  if (m.voice) io.to(l.code).emit('voice:gone', { id: m.pid });
  if (l.members.size === 0) { stopGame(l); lobbies.delete(l.code); return; }
  if (l.hostPid === m.pid) { const all = [...l.members.values()]; l.hostPid = (all.find((x) => !x.away) || all[0]).pid; } // host migration
  pushLobby(l);
}

function leaveLobby(socket) {
  const code = socket.data.code;
  const l = code && lobbies.get(code);
  socket.data.code = null;
  if (!l) return;
  socket.leave(code);
  dropMember(l, socket.id);
}

function stopGame(l) {
  if (l.timer) clearInterval(l.timer);
  l.timer = null; l.game = null;
}

function startGame(l) {
  const members = [...l.members.values()];
  l.state = 'playing';
  // Hunt: a random player is the Headmaster, but never the same person twice running if avoidable
  let hunterPid = null;
  if (l.mode === 'hunt' && members.length >= 2) {
    const pool = members.filter((m) => m.pid !== l.lastHunter);
    hunterPid = (pool.length ? pool : members)[(Math.random() * (pool.length || members.length)) | 0].pid;
    l.lastHunter = hunterPid;
  }
  l.game = new Game({
    mode: l.mode, difficulty: l.difficulty, hunterPid, mods: [...l.mods], tune: l.tune,
    players: members.map((m) => ({ pid: m.pid, name: m.name, look: m.look, cls: m.cls })),
    send: (ev, data) => io.to(l.code).emit(ev, data),
    sendTo: (pid, ev, data) => { const m = memberByPid(l, pid); if (m && !m.away) io.to(m.sid).emit(ev, data); }, // looked up each time: a player who reconnects has a new socket
    onEnd: (summary) => {
      l.state = 'ended'; l.last = summary;
      io.to(l.code).emit('game:over', summary);
      if (l.timer) clearInterval(l.timer);
      l.timer = null;
      for (const m of l.members.values()) m.ready = false;
      pushLobby(l);
    },
  });
  for (const m of members) io.to(m.sid).emit('game:start', l.game.initPayload(m.pid));
  let last = Date.now();
  l.timer = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.25, (now - last) / 1000); last = now;
    try { l.game && l.game.tick(dt); } catch (err) { console.error('tick error', l.code, err); }
  }, 1000 / TICK_HZ);
  pushLobby(l);
}

io.on('connection', (socket) => {
  const lobbyOf = () => lobbies.get(socket.data.code);
  const member = () => lobbyOf()?.members.get(socket.id);
  const ack = (cb, v) => typeof cb === 'function' && cb(v);

  socket.on('lobby:create', (d, cb) => {
    leaveLobby(socket);
    const l = { code: makeCode(), members: new Map(), hostPid: 0, nextPid: 1, mode: 'coop', difficulty: 'intermediate', mods: new Set(), tune: cleanTune(null), state: 'lobby', game: null, timer: null };
    lobbies.set(l.code, l);
    const m = joinLobby(socket, l, d?.name, d?.look);
    ack(cb, { ok: true, code: l.code, you: m.pid, token: m.token });
  });

  socket.on('lobby:join', (d, cb) => {
    const code = String(d?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const l = lobbies.get(code);
    if (!l) return ack(cb, { ok: false, error: 'No lobby with that code. Check the six characters and try again.' });
    if (l.members.size >= MAX_PLAYERS) return ack(cb, { ok: false, error: 'That lobby is full (8 players).' });
    leaveLobby(socket);
    const m = joinLobby(socket, l, d?.name, d?.look);
    ack(cb, { ok: true, code: l.code, you: m.pid, token: m.token, inProgress: l.state === 'playing' });
  });

  // Coming back after a dropped connection (or a page refresh): same seat, same character, and
  // straight back into the match if it is still running.
  socket.on('lobby:resume', (d, cb) => {
    const l = lobbies.get(String(d?.code ?? '').toUpperCase());
    const m = l && [...l.members.values()].find((x) => x.token && x.token === d?.token);
    if (!l || !m) return ack(cb, { ok: false });
    if (socket.data.code && socket.data.code !== l.code) leaveLobby(socket);
    if (m.awayTimer) { clearTimeout(m.awayTimer); m.awayTimer = null; }
    // the old connection may not have noticed it is dead yet (a refreshed page can beat its disconnect)
    const old = m.sid !== socket.id && io.sockets.sockets.get(m.sid);
    if (old) { old.data.code = null; old.leave(l.code); old.disconnect(true); }
    l.members.delete(m.sid); m.sid = socket.id; l.members.set(socket.id, m);
    const wasAway = m.away; m.away = false; m.voice = false;
    socket.join(l.code); socket.data.code = l.code; socket.data.pid = m.pid;
    const playing = inGame(l, m.pid);
    const ended = l.state === 'ended' && !!l.last;
    ack(cb, { ok: true, code: l.code, you: m.pid, token: m.token, inProgress: l.state === 'playing', inGame: playing, ended });
    pushLobby(l);
    if (ended) socket.emit('game:over', l.last); // the match finished while they were away: show them how it went
    if (playing) {
      l.game.setAway(m.pid, false);
      socket.emit('game:start', l.game.initPayload(m.pid));
      if (wasAway) l.game.announce(`${m.name} is back.`, 'good');
    }
  });

  socket.on('lobby:leave', () => leaveLobby(socket));
  socket.on('lobby:ready', (v) => { const l = lobbyOf(), m = member(); if (l && m) { m.ready = !!v; pushLobby(l); } });
  socket.on('lobby:mode', (v) => {
    const l = lobbyOf(), m = member();
    if (l && m && m.pid === l.hostPid && l.state !== 'playing' && (v === 'coop' || v === 'hunt')) { l.mode = v; pushLobby(l); }
  });
  socket.on('lobby:difficulty', (v) => {
    const l = lobbyOf(), m = member();
    if (l && m && m.pid === l.hostPid && l.state !== 'playing' && DIFFICULTY[v]) { l.difficulty = v; pushLobby(l); }
  });
  // detention rules (match modifiers): the host switches each one on or off
  socket.on('lobby:mod', (k) => {
    const l = lobbyOf(), m = member();
    if (l && m && m.pid === l.hostPid && l.state !== 'playing' && MODIFIERS[k]) { if (l.mods.has(k)) l.mods.delete(k); else l.mods.add(k); pushLobby(l); }
  });
  // Hunt Mode tuning (host only): { key, value } for one slider, or 'reset'
  socket.on('lobby:tune', (d) => {
    const l = lobbyOf(), m = member();
    if (!l || !m || m.pid !== l.hostPid || l.state === 'playing') return;
    if (d === 'reset') l.tune = cleanTune(null);
    else if (d && TUNE[d.key]) l.tune = cleanTune({ ...l.tune, [d.key]: d.value });
    else return;
    pushLobby(l);
  });
  // each player picks their own survivor class
  socket.on('lobby:class', (c) => { const l = lobbyOf(), m = member(); if (l && m && l.state !== 'playing') { m.cls = cleanClass(c); pushLobby(l); } });
  // character creator: a player can change their look while waiting in the lobby
  socket.on('lobby:look', (look) => { const l = lobbyOf(), m = member(); if (l && m) { m.look = cleanLook(look, m.pid - 1); if (l.state !== 'playing') pushLobby(l); } });
  socket.on('lobby:start', (_d, cb) => {
    const l = lobbyOf(), m = member();
    if (!l || !m) return ack(cb, { ok: false, error: 'Not in a lobby.' });
    if (m.pid !== l.hostPid) return ack(cb, { ok: false, error: 'Only the host can start the match.' });
    if (l.state === 'playing') return ack(cb, { ok: false, error: 'Match already running.' });
    if (l.members.size < MIN_PLAYERS) return ack(cb, { ok: false, error: `Need at least ${MIN_PLAYERS} players.` });
    if (l.mode === 'hunt' && l.members.size < 2) return ack(cb, { ok: false, error: 'Hunt Mode needs at least two players: one Headmaster and one survivor.' });
    const notReady = [...l.members.values()].filter((x) => x.pid !== l.hostPid && !x.ready && !x.away); // someone reconnecting will be put into the match when they are back
    if (notReady.length) return ack(cb, { ok: false, error: `Waiting for: ${notReady.map((x) => x.name).join(', ')}` });
    stopGame(l);
    startGame(l);
    ack(cb, { ok: true });
  });
  // rematch: host sends everyone back to the same lobby (same code)
  socket.on('lobby:return', () => {
    const l = lobbyOf(), m = member();
    if (!l || !m || m.pid !== l.hostPid || l.state !== 'ended') return;
    stopGame(l); l.state = 'lobby';
    pushLobby(l);
  });

  socket.on('chat', (text) => {
    const l = lobbyOf(), m = member();
    const t = String(text ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 160);
    if (l && m && t) io.to(l.code).emit('chat', { id: m.pid, name: m.name, text: t });
  });

  // in-game (the Game validates everything)
  const game = () => lobbyOf()?.game;
  socket.on('g:state', (s) => game()?.onState(socket.data.pid, s));
  socket.on('g:interact', (m) => game()?.onInteract(socket.data.pid, m));
  socket.on('g:use', (m) => game()?.onUse(socket.data.pid, m));
  socket.on('g:drop', (m) => game()?.onDrop(socket.data.pid, m));
  socket.on('g:gasp', () => game()?.onGasp(socket.data.pid));
  socket.on('g:ping', (m) => game()?.onPing(socket.data.pid, m));
  socket.on('g:voice', (level) => game()?.onVoice(socket.data.pid, level));
  socket.on('g:mstate', (s) => game()?.onMonsterMove(socket.data.pid, s));
  socket.on('g:mact', (m) => game()?.onMonsterAct(socket.data.pid, m));

  // ---- voice chat signalling: the server only introduces players; audio flows directly between them ----
  socket.on('voice:join', (_d, cb) => {
    const l = lobbyOf(), m = member();
    if (!l || !m) return ack(cb, { ok: false });
    m.voice = true;
    ack(cb, { ok: true, ice: ICE_SERVERS, peers: [...l.members.values()].filter((x) => x.voice && x.pid !== m.pid).map((x) => x.pid) });
    pushLobby(l);
  });
  socket.on('voice:leave', () => { const l = lobbyOf(), m = member(); if (l && m && m.voice) { m.voice = false; io.to(l.code).emit('voice:gone', { id: m.pid }); pushLobby(l); } });
  socket.on('rtc', (msg) => {
    const l = lobbyOf(), m = member();
    if (!l || !m || !m.voice || !msg || typeof msg !== 'object') return;
    const target = [...l.members.values()].find((x) => x.pid === (msg.to | 0) && x.voice);
    if (!target || JSON.stringify(msg.data ?? null).length > 20000) return;
    io.to(target.sid).emit('rtc', { from: m.pid, data: msg.data });
  });

  // A dropped connection is not a goodbye: hold their place for RESUME_SECS in case they come back.
  socket.on('disconnect', () => {
    const l = lobbyOf(), m = member();
    if (!l || !m) return;
    m.away = true;
    if (m.voice) { m.voice = false; io.to(l.code).emit('voice:gone', { id: m.pid }); }
    m.awayTimer = setTimeout(() => { if (lobbies.get(l.code) === l && l.members.get(m.sid) === m && m.away) dropMember(l, m.sid); }, RESUME_SECS * 1000);
    if (inGame(l, m.pid)) { l.game.setAway(m.pid, true); l.game.announce(`${m.name} lost their connection. Their place is held for ${RESUME_SECS} seconds.`, 'bad'); }
    pushLobby(l);
  });
});

server.listen(PORT, () => console.log(`THE LAST BELL listening on :${PORT}  (client origin: ${CLIENT_ORIGIN})`));
