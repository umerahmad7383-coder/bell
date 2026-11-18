// The Last Bell, the Windows app. The game itself is the same client as the website (../client, copied into
// the installer); this shell gives it a proper window, a splash screen, display modes, Quit, and updates
// itself from GitHub Releases. It always plays online through the same server as the website.
const { app, BrowserWindow, protocol, net, ipcMain, shell, session, screen, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const DEV = process.argv.includes('--dev') || !app.isPackaged;
const SERVER = (arg('server') || process.env.LAST_BELL_SERVER || 'https://bell-en9a.onrender.com').replace(/\/$/, '');
const CLIENT = app.isPackaged ? path.join(process.resourcesPath, 'client') : path.join(__dirname, '..', 'client');
const ICON = path.join(__dirname, 'build', 'icon.png');

// one copy at a time: a second launch just brings the running game to the front
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// laptops with two graphics chips: use the fast one
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// the game is served from app://game/ (ES modules and fetch() do not work from file://)
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

// ------------------------------------------------------------------ display settings (saved next to the game's other data)
const DISPLAY_FILE = () => path.join(app.getPath('userData'), 'display.json');
const SIZES = ['1280x720', '1600x900', '1920x1080', '2560x1440'];
function readDisplay() {
  try { const d = JSON.parse(fs.readFileSync(DISPLAY_FILE(), 'utf8')); return { mode: ['fullscreen', 'windowed', 'maximized'].includes(d.mode) ? d.mode : 'fullscreen', size: SIZES.includes(d.size) ? d.size : '1600x900' }; }
  catch { return { mode: 'fullscreen', size: '1600x900' }; }
}
function saveDisplay(d) { try { fs.mkdirSync(path.dirname(DISPLAY_FILE()), { recursive: true }); fs.writeFileSync(DISPLAY_FILE(), JSON.stringify(d)); } catch { /* read-only profile */ } }
let display = { mode: 'fullscreen', size: '1600x900' };

let win = null, splash = null, quitting = false;
function applyDisplay(d) {
  if (!win) return;
  display = d; saveDisplay(d);
  if (d.mode === 'fullscreen') { win.setFullScreen(true); return; }
  win.setFullScreen(false);
  if (d.mode === 'maximized') { win.maximize(); return; }
  if (win.isMaximized()) win.unmaximize();
  const [w, h] = d.size.split('x').map(Number);
  const area = screen.getDisplayMatching(win.getBounds()).workAreaSize;
  win.setContentSize(Math.min(w, area.width), Math.min(h, area.height - 30));
  win.center();
}

// ------------------------------------------------------------------ windows
function createSplash() {
  splash = new BrowserWindow({ width: 560, height: 320, frame: false, resizable: false, movable: true, show: false, center: true, transparent: false, backgroundColor: '#0d1311', alwaysOnTop: true, skipTaskbar: false, icon: ICON, title: 'The Last Bell', webPreferences: { sandbox: true, contextIsolation: true } });
  splash.loadURL(`app://game/__splash.html?v=${encodeURIComponent(app.getVersion())}`); // same origin as the game's fonts
  splash.once('ready-to-show', () => splash && splash.show());
  splash.on('closed', () => { splash = null; });
}
const splashStatus = (text) => { if (splash) splash.webContents.executeJavaScript(`window.setStatus && window.setStatus(${JSON.stringify(text)})`).catch(() => {}); };

function createGame() {
  display = readDisplay();
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540, show: false, backgroundColor: '#0b0f0e', title: 'The Last Bell', icon: ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, devTools: DEV },
  });
  Menu.setApplicationMenu(null);
  win.loadURL('app://game/index.html');
  const started = Date.now();
  win.once('ready-to-show', () => {
    // keep the splash up for a moment so it does not just flash
    setTimeout(() => {
      applyDisplay(display);
      win.show(); win.focus();
      if (splash) splash.close();
    }, Math.max(0, 1800 - (Date.now() - started)));
  });
  // F11 or Alt+Enter: fullscreen on and off, like any PC game
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      e.preventDefault();
      applyDisplay({ ...display, mode: win.isFullScreen() ? 'windowed' : 'fullscreen' });
      win.webContents.send('display', display);
    }
    if (!DEV && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) e.preventDefault();
    if (!DEV && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) e.preventDefault(); // a refresh would drop you from the match
  });
  // links (the download page, GitHub) open in the normal browser; the game window never navigates away
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://game/')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('enter-full-screen', () => win.webContents.send('display', { ...display, mode: 'fullscreen' }));
  win.on('leave-full-screen', () => { if (display.mode === 'fullscreen') { display = { ...display, mode: 'windowed' }; saveDisplay(display); } win.webContents.send('display', display); });
  // closing mid-match: the page asks to stay (beforeunload); ask the player properly instead of silently refusing
  win.webContents.on('will-prevent-unload', (e) => {
    if (quitting) { e.preventDefault(); return; }
    const { dialog } = require('electron');
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['Quit', 'Keep playing'], defaultId: 1, cancelId: 1, title: 'The Last Bell', message: 'Leave the match and quit?', detail: 'Your friends can carry on without you.' });
    if (r === 0) { quitting = true; e.preventDefault(); }
  });
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', (_e, d) => { console.error('renderer gone', d); if (win && d.reason !== 'clean-exit') win.reload(); });
}

// ------------------------------------------------------------------ automatic updates (GitHub Releases)
let updateState = { state: 'none' };
function sendUpdate(s) { updateState = s; if (win) win.webContents.send('update', s); }
function startUpdater() {
  if (DEV) return;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (err) { console.error('no updater', err); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => sendUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ ...updateState, state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (err) => { console.error('update error', err && err.message); if (updateState.state === 'downloading') sendUpdate({ state: 'error' }); });
  ipcMain.handle('update:install', () => { setImmediate(() => autoUpdater.quitAndInstall(false, true)); });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, 30 * 60 * 1000); // and every half hour, for long sessions
}

// ------------------------------------------------------------------ bridge to the page (preload.js)
ipcMain.on('lb:config', (e) => { e.returnValue = { server: SERVER, version: app.getVersion(), platform: process.platform }; });
ipcMain.handle('display:get', () => display);
ipcMain.handle('display:set', (_e, d) => { applyDisplay({ mode: d && d.mode || display.mode, size: SIZES.includes(d && d.size) ? d.size : display.size }); return display; });
ipcMain.handle('update:get', () => updateState);
ipcMain.on('quit', () => { quitting = true; app.quit(); });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    if (p === '/__splash.html') return net.fetch(pathToFileURL(path.join(__dirname, 'splash.html')).toString());
    const file = path.normalize(path.join(CLIENT, p));
    if (!file.startsWith(CLIENT)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  // microphone for proximity voice chat, pointer lock and fullscreen for playing; nothing else
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write'].includes(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => ['media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write'].includes(perm));
  createSplash();
  createGame();
  // the free server sleeps when nobody plays: knock while the splash is up, so it is awake by the menu
  splashStatus('Waking up the school…');
  net.fetch(SERVER + '/health').then((r) => r.json()).then((h) => splashStatus(`Server ready · version ${h.version || '?'}`)).catch(() => splashStatus('The server is starting up. The menu will connect when it is ready.'));
  startUpdater();
});
