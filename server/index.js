// THE LAST BELL — multiplayer server.
// Serves the static client AND hosts the Socket.IO game backend on one port,
// so a single web service gives you https:// + wss:// on the same URL.
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Game, TICK_HZ } from './game.js';

const PORT = Number(process.env.PORT) || 3000;
// Comma-separated list of allowed browser origins when the client is hosted
// elsewhere (e.g. https://my-game.netlify.app). "*" allows any origin.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';
const MAX_PLAYERS = Math.min(8, Number(process.env.MAX_PLAYERS) || 8);
const MIN_PLAYERS = Math.max(1, Number(process.env.MIN_PLAYERS) || 1); // 1 lets you test solo

const app = express();
const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'client');
app.get('/health', (_req, res) => res.json({ ok: true, lobbies: lobbies.size, uptime: Math.round(process.uptime()) }));
app.use(express.static(clientDir, { maxAge: '5m' }));

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
    code: l.code, hostId: l.hostPid, mode: l.mode, state: l.state, max: MAX_PLAYERS, min: MIN_PLAYERS,
    players: [...l.members.values()].map((m) => ({ id: m.pid, name: m.name, ready: m.ready, inGame: !!(l.game && l.game.players.has(m.pid)) })),
    last: l.last || null,
  };
}
const pushLobby = (l) => io.to(l.code).emit('lobby:update', lobbyView(l));

function uniqueName(l, name) {
  const taken = new Set([...l.members.values()].map((m) => m.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 99; i++) { const n = `${name.slice(0, 13)} ${i}`; if (!taken.has(n.toLowerCase())) return n; }
  return name;
}

function joinLobby(socket, l, name) {
  const pid = l.nextPid++;
  l.members.set(socket.id, { pid, name: uniqueName(l, cleanName(name)), ready: false, sid: socket.id });
  socket.join(l.code);
  socket.data.code = l.code; socket.data.pid = pid;
  if (!l.hostPid) l.hostPid = pid;
  pushLobby(l);
  return pid;
}

function leaveLobby(socket) {
  const code = socket.data.code;
  const l = code && lobbies.get(code);
  socket.data.code = null;
  if (!l) return;
  const m = l.members.get(socket.id);
  l.members.delete(socket.id);
  socket.leave(code);
  if (m && l.game) l.game.removePlayer(m.pid);
  if (l.members.size === 0) { stopGame(l); lobbies.delete(code); return; }
  if (m && l.hostPid === m.pid) l.hostPid = [...l.members.values()][0].pid; // host migration
  pushLobby(l);
}

function stopGame(l) {
  if (l.timer) clearInterval(l.timer);
  l.timer = null; l.game = null;
}

function startGame(l) {
  const members = [...l.members.values()];
  const sidOf = new Map(members.map((m) => [m.pid, m.sid]));
  l.state = 'playing';
  l.game = new Game({
    mode: l.mode,
    players: members.map((m) => ({ pid: m.pid, name: m.name })),
    send: (ev, data) => io.to(l.code).emit(ev, data),
    sendTo: (pid, ev, data) => { const sid = sidOf.get(pid); if (sid) io.to(sid).emit(ev, data); },
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
    const l = { code: makeCode(), members: new Map(), hostPid: 0, nextPid: 1, mode: 'coop', state: 'lobby', game: null, timer: null };
    lobbies.set(l.code, l);
    const pid = joinLobby(socket, l, d?.name);
    ack(cb, { ok: true, code: l.code, you: pid });
  });

  socket.on('lobby:join', (d, cb) => {
    const code = String(d?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const l = lobbies.get(code);
    if (!l) return ack(cb, { ok: false, error: 'No lobby with that code. Check the six characters and try again.' });
    if (l.members.size >= MAX_PLAYERS) return ack(cb, { ok: false, error: 'That lobby is full (8 players).' });
    leaveLobby(socket);
    const pid = joinLobby(socket, l, d?.name);
    ack(cb, { ok: true, code: l.code, you: pid, inProgress: l.state === 'playing' });
  });

  socket.on('lobby:leave', () => leaveLobby(socket));
  socket.on('lobby:ready', (v) => { const l = lobbyOf(), m = member(); if (l && m) { m.ready = !!v; pushLobby(l); } });
  socket.on('lobby:mode', (v) => {
    const l = lobbyOf(), m = member();
    if (l && m && m.pid === l.hostPid && l.state !== 'playing' && v === 'coop') { l.mode = v; pushLobby(l); }
  });
  socket.on('lobby:start', (_d, cb) => {
    const l = lobbyOf(), m = member();
    if (!l || !m) return ack(cb, { ok: false, error: 'Not in a lobby.' });
    if (m.pid !== l.hostPid) return ack(cb, { ok: false, error: 'Only the host can start the match.' });
    if (l.state === 'playing') return ack(cb, { ok: false, error: 'Match already running.' });
    if (l.members.size < MIN_PLAYERS) return ack(cb, { ok: false, error: `Need at least ${MIN_PLAYERS} players.` });
    const notReady = [...l.members.values()].filter((x) => x.pid !== l.hostPid && !x.ready);
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
  socket.on('g:drop', (slot) => game()?.onDrop(socket.data.pid, slot));

  socket.on('disconnect', () => leaveLobby(socket));
});

server.listen(PORT, () => console.log(`THE LAST BELL listening on :${PORT}  (client origin: ${CLIENT_ORIGIN})`));
