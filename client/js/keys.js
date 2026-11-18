// Rebindable keyboard controls. Bindings are KeyboardEvent.code values, so they follow the physical key
// (the key where W sits on a US keyboard is 'KeyW' on AZERTY too). Saved in localStorage 'lastbell.binds'.
export const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', sprint: 'ShiftLeft', crouch: 'KeyC',
  interact: 'KeyE', torch: 'KeyF', drop: 'KeyG', breath: 'Space', ping: 'KeyQ', notebook: 'Tab',
  chat: 'Enter', mute: 'KeyM', talk: 'KeyV', teleport: 'KeyR', trap: 'KeyT',
};
/** keys that also work for an action, as long as you have not bound them to something else */
const ALT = { forward: ['ArrowUp'], back: ['ArrowDown'], left: ['ArrowLeft'], right: ['ArrowRight'], sprint: ['ShiftRight'], crouch: ['ControlLeft', 'ControlRight'] };
/** keys that cannot be bound: Esc pauses, 1–4 pick inventory slots, the rest belong to the system */
export const RESERVED = new Set(['Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'F11', 'F12', 'MetaLeft', 'MetaRight', 'ContextMenu', 'OSLeft', 'OSRight']);

export const binds = { ...DEFAULT_BINDS };
const KEY = 'lastbell.binds';
export function loadBinds() {
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* none */ }
  for (const k of Object.keys(DEFAULT_BINDS)) binds[k] = saved && typeof saved[k] === 'string' && !RESERVED.has(saved[k]) ? saved[k] : DEFAULT_BINDS[k];
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch { /* private mode */ } };
loadBinds();

const boundTo = (code) => Object.keys(binds).find((k) => binds[k] === code);
/** was this key (a KeyboardEvent.code) pressed for the action? */
export function is(action, code) {
  if (binds[action] === code) return true;
  const a = ALT[action]; return !!a && a.includes(code) && !boundTo(code);
}
/** is the action held, given the map of keys currently down? */
export function held(K, action) {
  if (K[binds[action]]) return true;
  const a = ALT[action]; if (!a) return false;
  for (const c of a) if (K[c] && !boundTo(c)) return true;
  return false;
}
/** bind a key; if another action had it, that action takes this one's old key. Returns the action swapped with, if any. */
export function rebind(action, code) {
  if (RESERVED.has(code) || !(action in binds)) return null;
  const other = Object.keys(binds).find((k) => k !== action && binds[k] === code);
  if (other) binds[other] = binds[action];
  binds[action] = code; save();
  return other || null;
}
export function resetBinds() { Object.assign(binds, DEFAULT_BINDS); save(); }

const NAMES = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', CapsLock: 'Caps Lock', Escape: 'Esc',
  ShiftLeft: 'Shift', ShiftRight: 'Right Shift', ControlLeft: 'Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Alt', AltRight: 'Right Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', IntlBackslash: '\\', Insert: 'Insert', Delete: 'Delete',
  Home: 'Home', End: 'End', PageUp: 'Page Up', PageDown: 'Page Down', NumpadEnter: 'Num Enter', NumpadAdd: 'Num +', NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
};
/** a key's name as printed on the keyboard */
export function keyName(code) {
  if (!code) return '—';
  if (NAMES[code]) return NAMES[code];
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^Numpad(\d)$/.exec(code))) return `Num ${m[1]}`;
  return code.replace(/([a-z])([A-Z])/g, '$1 $2');
}
/** the key for an action, by name */
export const keyOf = (action) => keyName(binds[action]);
