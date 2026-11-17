// Menus with a controller: the D-pad or left stick moves a highlight between buttons, sliders and
// switches; A / ✕ presses, B / ○ goes back, the right stick scrolls long panels.
import { input, BTN } from './input.js';

const FOCUSABLE = 'button, input[type=range], input[type=checkbox], input[type=text], select, label.mode, [role=button][tabindex]';
const visible = (el) => !el.disabled && el.getClientRects().length > 0 && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden';

/**
 * opts.container()  -> the element holding the menu the player is looking at, or null when a match has the controls
 * opts.back(c)      -> B / ○ was pressed on that menu
 * opts.menu(c)      -> Menu / Options was pressed on that menu
 * opts.preferred(c) -> the element to highlight first on that menu
 */
export function startPadNav(opts) {
  let lastC = null, cur = null, repT = 0, repDir = null, last = performance.now();
  const ring = (el) => (el && (el.matches('input[type=checkbox]') ? el.closest('label') || el : el));
  const clear = () => { document.querySelectorAll('.pad-focus').forEach((e) => e.classList.remove('pad-focus')); };
  const focus = (el) => {
    clear(); cur = el;
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch { /* not focusable */ }
    ring(el).classList.add('pad-focus');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };
  const cands = (c) => [...c.querySelectorAll(FOCUSABLE)].filter((el) => visible(el) && !el.matches('.mode input, .close'));  // the corner X: B does that
  const pick = (c) => { const p = opts.preferred && opts.preferred(c); return p && visible(p) ? p : cands(c)[0] || null; };

  function move(c, dir) {
    const list = cands(c);
    if (!cur || !list.includes(cur)) return focus(pick(c));
    const a = cur.getBoundingClientRect();
    let best = null, bs = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      let main, cross;
      if (dir === 'down') { if (r.top < a.bottom - 4) continue; main = r.top - a.bottom; cross = Math.max(0, r.left - a.right, a.left - r.right); }
      else if (dir === 'up') { if (r.bottom > a.top + 4) continue; main = a.top - r.bottom; cross = Math.max(0, r.left - a.right, a.left - r.right); }
      else if (dir === 'right') { if (r.left < a.right - 4) continue; main = r.left - a.right; cross = Math.max(0, r.top - a.bottom, a.top - r.bottom); }
      else { if (r.right > a.left + 4) continue; main = a.left - r.right; cross = Math.max(0, r.top - a.bottom, a.top - r.bottom); }
      const sc = main + cross * 2.5;
      if (sc < bs) { bs = sc; best = el; }
    }
    if (best) focus(best);
  }
  function nudge(el, sign) { // sliders and drop-downs: left and right change the value
    if (el.matches('input[type=range]')) {
      const st = Number(el.step) || 1, v = Math.min(Number(el.max), Math.max(Number(el.min), Number(el.value) + sign * st));
      el.value = String(Math.round(v / st) * st);
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.matches('select')) {
      el.selectedIndex = (el.selectedIndex + sign + el.options.length) % el.options.length;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }
  function press(el) {
    if (!el) return;
    if (el.matches('input[type=text]')) { el.focus(); return; } // type with a keyboard; B leaves the box
    if (el.matches('select')) { nudge(el, 1); return; }
    if (el.matches('input[type=range]')) return;
    el.click();
  }

  input.onChange(() => { if (input.mode !== 'pad') clear(); else if (cur) ring(cur).classList.add('pad-focus'); });

  const tick = () => {
    requestAnimationFrame(tick);
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    input.poll();
    const c = opts.container();
    if (c !== lastC) { lastC = c; cur = null; clear(); if (c && input.mode === 'pad') focus(pick(c)); }
    if (!c || !input.connected) return;
    if (cur && (!c.contains(cur) || !visible(cur))) { cur = null; clear(); }
    const P = input;
    // directions, with a key-repeat when held
    const [lx, ly] = P.axes;
    const dir = P.held(BTN.UP) || ly < -0.6 ? 'up' : P.held(BTN.DOWN) || ly > 0.6 ? 'down' : P.held(BTN.LEFT) || lx < -0.6 ? 'left' : P.held(BTN.RIGHT) || lx > 0.6 ? 'right' : null;
    if (dir !== repDir) { repDir = dir; repT = 0.38; if (dir) step(c, dir); }
    else if (dir && (repT -= dt) <= 0) { repT = 0.1; step(c, dir); }
    if (P.pressed(BTN.A)) { P.consume(BTN.A); if (!cur) focus(pick(c)); else press(cur); }
    if (P.pressed(BTN.B)) { P.consume(BTN.B); if (document.activeElement && document.activeElement.matches('input[type=text]')) document.activeElement.blur(); else opts.back(c); }
    if (P.pressed(BTN.MENU)) { P.consume(BTN.MENU); opts.menu(c); }
    if (P.pressed(BTN.LB) || P.pressed(BTN.RB)) opts.tab && opts.tab(c, P.pressed(BTN.RB) ? 1 : -1);
    for (const b of [BTN.X, BTN.Y, BTN.RT, BTN.LT, BTN.UP, BTN.DOWN, BTN.LB, BTN.RB, BTN.VIEW]) P.consume(b); // nothing leaks into the match underneath
    // the right stick scrolls a long panel
    const ry = P.axes[3];
    if (Math.abs(ry) > 0.2) { const sc = c.querySelector('.board') && c.querySelector('.board').scrollHeight > c.querySelector('.board').clientHeight ? c.querySelector('.board') : c; sc.scrollTop += ry * 900 * dt; }
  };
  function step(c, dir) {
    if (input.mode !== 'pad') input.setMode('pad');
    if (cur && (dir === 'left' || dir === 'right') && nudge(cur, dir === 'right' ? 1 : -1)) return;
    move(c, dir);
  }
  requestAnimationFrame(tick);
}
