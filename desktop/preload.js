// The page's only window into the app: server address, display mode, updates and Quit. Nothing else from
// Node or Electron reaches the game page.
const { contextBridge, ipcRenderer } = require('electron');

const cfg = ipcRenderer.sendSync('lb:config');
const on = (ch, cb) => { const f = (_e, v) => cb(v); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
contextBridge.exposeInMainWorld('lastBell', {
  desktop: true,
  server: cfg.server,
  version: cfg.version,
  platform: cfg.platform,
  getDisplay: () => ipcRenderer.invoke('display:get'),
  setDisplay: (d) => ipcRenderer.invoke('display:set', d),
  onDisplay: (cb) => on('display', cb),
  getUpdate: () => ipcRenderer.invoke('update:get'),
  onUpdate: (cb) => on('update', cb),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  quit: () => ipcRenderer.send('quit'),
});
