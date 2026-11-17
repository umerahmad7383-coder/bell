// Controllers (Xbox, PlayStation and other "standard" gamepads) and the button names shown on screen.
//
// The browser's Gamepad API has no events for buttons, so it is polled once per frame. Everything that
// shows a key or button on screen goes through glyph()/label() below, so prompts switch between the
// keyboard, Xbox and PlayStation layouts depending on what the player last touched.

/** Button indices in the standard gamepad mapping (the same for Xbox and PlayStation pads). */
export const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, HOME: 16, PAD: 17 };
const NBTN = 18;
const DEAD = 0.16; // stick dead zone (radial)

/** 'xbox' | 'ps4' | 'ps5' from a gamepad's id string (vendor 054c is Sony, 045e is Microsoft). */
export function padKind(id = '') {
  const s = id.toLowerCase();
  if (/xbox|xinput|045e|microsoft/.test(s)) return 'xbox'; // first: "Xbox Wireless Controller" must not match Sony's "Wireless Controller"
  if (/dualsense|0ce6|0df2|ps5/.test(s)) return 'ps5';
  if (/054c|playstation|dualshock|wireless controller|ps4|ps3|sony/.test(s)) return 'ps4';
  return 'xbox'; // Xbox pads, and any other standard pad (most third-party controllers copy the Xbox layout)
}
/** a friendly name for the connected pad */
export function padName(id = '') {
  const k = padKind(id);
  if (k === 'ps5') return 'PlayStation 5 controller (DualSense)';
  if (k === 'ps4') return 'PlayStation 4 controller (DualShock 4)';
  if (/xbox|xinput|045e|microsoft/i.test(id)) return 'Xbox controller';
  return (id.replace(/\(.*\)/, '').trim() || 'Controller') + ' (Xbox layout)';
}

const radial = (x, y) => {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD)) / m;
  return [x * k, y * k];
};

class Input {
  constructor() {
    this.mode = 'kbm';      // what the player last used: 'kbm' (keyboard and mouse) or 'pad'
    this.kind = 'xbox';     // which button names to show for a pad: 'xbox' | 'ps4' | 'ps5'
    this.connected = false; this.id = ''; this.index = -1;
    this.down = new Array(NBTN).fill(false); this.prev = new Array(NBTN).fill(false);
    this.axes = [0, 0, 0, 0]; // left x, left y, right x, right y (after the dead zone)
    this.vibrate = true;
    this.lastPoll = -1;
    this.subs = new Set();
    if (typeof window !== 'undefined') {
      const kbm = () => this.setMode('kbm');
      window.addEventListener('keydown', kbm, true);
      window.addEventListener('mousedown', kbm, true);
      let mx = 0; window.addEventListener('mousemove', (e) => { mx += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); if (mx > 40) { mx = 0; kbm(); } }, true);
      window.addEventListener('gamepadconnected', () => this.poll(true));
      window.addEventListener('gamepaddisconnected', () => this.poll(true));
    }
  }
  /** call fn() whenever the input mode, pad kind or connection changes */
  onChange(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { for (const fn of this.subs) { try { fn(this); } catch (e) { console.error(e); } } }
  setMode(m) { if (m === this.mode) return; this.mode = m; this.emit(); }
  /** layout to draw for a pad: the connected one, or what the player chose to look at */
  get ps() { return this.kind === 'ps4' || this.kind === 'ps5'; }

  pad() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let best = null;
    for (const p of pads) if (p && p.connected && (!best || p.index === this.index)) best = p;
    return best;
  }
  /** read the pad (at most once per frame, however many places ask) */
  poll(force = false) {
    const now = performance.now();
    if (!force && now - this.lastPoll < 4) return;
    this.lastPoll = now;
    const gp = this.pad();
    for (let i = 0; i < NBTN; i++) this.prev[i] = this.down[i];
    if (!gp) {
      this.down.fill(false); this.axes = [0, 0, 0, 0];
      if (this.connected) { this.connected = false; this.index = -1; if (this.mode === 'pad') this.mode = 'kbm'; this.emit(); }
      return;
    }
    if (!this.connected || gp.index !== this.index || gp.id !== this.id) {
      this.connected = true; this.index = gp.index; this.id = gp.id; this.kind = padKind(gp.id);
      this.emit();
    }
    let active = false;
    for (let i = 0; i < NBTN; i++) {
      const b = gp.buttons[i];
      const v = b ? (typeof b === 'object' ? (b.value || (b.pressed ? 1 : 0)) : b) : 0;
      this.down[i] = !!(b && b.pressed && (i !== BTN.LT && i !== BTN.RT)) || v > 0.35; // triggers count from a third of the way down
      if (this.down[i] && !this.prev[i]) active = true;
    }
    const a = gp.axes;
    const [lx, ly] = radial(a[0] || 0, a[1] || 0), [rx, ry] = radial(a[2] || 0, a[3] || 0);
    this.axes = [lx, ly, rx, ry];
    if (Math.hypot(lx, ly) > 0.5 || Math.hypot(rx, ry) > 0.5) active = true;
    if (active) this.setMode('pad');
  }
  held(b) { return this.down[b]; }
  pressed(b) { return this.down[b] && !this.prev[b]; }
  released(b) { return !this.down[b] && this.prev[b]; }
  /** a press has been dealt with: nothing else sees it this frame (menus and the match share the pad) */
  consume(b) { if (this.down[b]) this.prev[b] = true; }
  /** a short shake: strong = the big motor, weak = the small one (0..1) */
  rumble(strong, weak, ms) {
    if (!this.vibrate || !this.connected) return;
    const gp = this.pad(), act = gp && gp.vibrationActuator;
    try { if (act && act.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {}); } catch { /* not supported */ }
  }
}
export const input = new Input();

// ------------------------------------------------------------------------------------- glyphs
// Each action: keyboard label, then the pad button(s) for survivors.
const ACTIONS = {
  move: ['W A S D', 'LSTICK'], look: ['Mouse', 'RSTICK'],
  interact: ['E', BTN.A], use: ['Left click', BTN.RT], torch: ['F', BTN.Y], drop: ['G', BTN.X],
  crouch: ['C', BTN.B], sprint: ['Shift', BTN.LT], breath: ['Space', BTN.LT], ping: ['Q', BTN.UP], mute: ['M', BTN.LEFT],
  notebook: ['Tab', BTN.VIEW], prev: ['Wheel', BTN.LB], next: ['Wheel', BTN.RB], slots: ['1–4', 'SLOTS'],
  chat: ['Enter', null], pause: ['Esc', BTN.MENU], switch: ['Click', BTN.A],
  // the Headmaster
  attack: ['Left click', BTN.RT], rage: ['Shift', BTN.LT], teleport: ['R', BTN.X], trap: ['T', BTN.Y], lights: ['Q', BTN.B], force: ['E', BTN.A],
};
const XB = { [BTN.A]: 'A', [BTN.B]: 'B', [BTN.X]: 'X', [BTN.Y]: 'Y', [BTN.LB]: 'LB', [BTN.RB]: 'RB', [BTN.LT]: 'LT', [BTN.RT]: 'RT', [BTN.VIEW]: 'View', [BTN.MENU]: 'Menu', [BTN.LS]: 'LS', [BTN.RS]: 'RS', [BTN.UP]: 'D-pad up', [BTN.DOWN]: 'D-pad down', [BTN.LEFT]: 'D-pad left', [BTN.RIGHT]: 'D-pad right', LSTICK: 'Left stick', RSTICK: 'Right stick', SLOTS: 'LB / RB' };
const PS = { [BTN.A]: '✕', [BTN.B]: '○', [BTN.X]: '□', [BTN.Y]: '△', [BTN.LB]: 'L1', [BTN.RB]: 'R1', [BTN.LT]: 'L2', [BTN.RT]: 'R2', [BTN.VIEW]: 'Share', [BTN.MENU]: 'Options', [BTN.LS]: 'L3', [BTN.RS]: 'R3', [BTN.UP]: 'D-pad up', [BTN.DOWN]: 'D-pad down', [BTN.LEFT]: 'D-pad left', [BTN.RIGHT]: 'D-pad right', LSTICK: 'Left stick', RSTICK: 'Right stick', SLOTS: 'L1 / R1' };
const PS_SHAPE = {
  [BTN.A]: '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>',
  [BTN.B]: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.6" stroke="currentColor" stroke-width="2.1" fill="none"/></svg>',
  [BTN.X]: '<svg viewBox="0 0 16 16"><rect x="3.6" y="3.6" width="8.8" height="8.8" rx="0.6" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  [BTN.Y]: '<svg viewBox="0 0 16 16"><path d="M8 3.2L13 12H3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/></svg>',
};
const DPAD = (dir) => `<svg viewBox="0 0 16 16"><path d="M6 1h4v5h5v4h-5v5H6v-5H1V6h5z" fill="currentColor" opacity="0.35"/><path d="${{ up: 'M6 1h4v5H6z', down: 'M6 10h4v5H6z', left: 'M1 6h5v4H1z', right: 'M10 6h5v4h-5z' }[dir]}" fill="currentColor"/></svg>`;

/** the PlayStation share button is called "Create" on a PS5 pad */
const psName = (b) => (b === BTN.VIEW && input.kind === 'ps5' ? 'Create' : PS[b]);

/** HTML for one pad button, in the given layout ('xbox' | 'ps4' | 'ps5') */
export function padGlyph(b, kind = input.kind) {
  const ps = kind !== 'xbox';
  if (b === 'LSTICK' || b === 'RSTICK') return `<kbd class="pb st">${b === 'LSTICK' ? 'L' : 'R'}</kbd>`;
  if (b === 'SLOTS') return padGlyph(BTN.LB, kind) + padGlyph(BTN.RB, kind);
  if (b <= BTN.Y) return ps ? `<kbd class="pb face ps p${b}" aria-label="${PS[b]}">${PS_SHAPE[b]}</kbd>` : `<kbd class="pb face xb x${b}">${XB[b]}</kbd>`;
  if (b >= BTN.UP && b <= BTN.RIGHT) { const d = ['up', 'down', 'left', 'right'][b - BTN.UP]; return `<kbd class="pb dp" aria-label="D-pad ${d}">${DPAD(d)}</kbd>`; }
  if (b === BTN.VIEW || b === BTN.MENU) return `<kbd class="pb sm">${ps ? (b === BTN.VIEW && kind === 'ps5' ? 'Create' : PS[b]) : XB[b]}</kbd>`;
  return `<kbd class="pb sh">${ps ? PS[b] : XB[b]}</kbd>`;
}
/** HTML for an action's key or button, in whatever the player is using right now */
export function glyph(action) {
  const a = ACTIONS[action]; if (!a) return '';
  if (input.mode !== 'pad' || a[1] === null) return a[0] === 'Left click' ? '<kbd>LMB</kbd>' : a[0] === 'Click' ? '<kbd>Click</kbd>' : `<kbd>${a[0]}</kbd>`;
  return padGlyph(a[1]);
}
/** plain-text name of an action's key or button (for toasts and other text-only places) */
export function label(action) {
  const a = ACTIONS[action]; if (!a) return '';
  if (input.mode !== 'pad' || a[1] === null) return a[0];
  const b = a[1];
  return input.kind === 'xbox' ? XB[b] : psName(b);
}
/** "{torch} switches your torch on" -> "F switches…" / "Y switches…" */
export const fill = (text) => text.replace(/\{(\w+)\}/g, (_, k) => label(k));
