// The controller page of the Controls screen: a drawing of the pad with every button labelled,
// in the Xbox or PlayStation layout. Pressing a button on a connected pad lights it up here.
import { input, BTN, padGlyph } from './input.js';

const OX = 40; // the pad is drawn in its own coordinates, shifted right to leave room for labels
const VW = 1000, VH = 470;
const BODY = 'M335 135C380 122 540 122 585 135C640 142 670 170 685 220C705 285 720 360 690 390C665 415 628 405 610 380C590 350 570 320 540 315L380 315C350 320 330 350 310 380C292 405 255 415 230 390C200 360 215 285 235 220C250 170 280 142 335 135Z';

// where each control sits on the two layouts
const LAYOUT = {
  xbox: { ls: [345, 195], rs: [530, 270], dpad: [390, 270], face: [580, 195], view: [425, 195], menu: [495, 195], home: [460, 162] },
  ps: { ls: [400, 275], rs: [520, 275], dpad: [340, 200], face: [580, 200], view: [385, 150], menu: [535, 150], home: [460, 238], touch: [405, 140, 110, 64] },
};

const LABELS = (ps) => ({
  left: [
    [BTN.LT, [312, 100], 'Run (hold) · in a locker: hold your breath'],
    [BTN.LB, [300, 126], 'Previous item'],
    [BTN.VIEW, null, ps ? 'Notebook (hold, or hold the touchpad)' : 'Notebook (hold)'],
    ['LSTICK', null, 'Move · press in to run'],
    [BTN.UP, null, 'Up: ping · down: hold breath · left: mute'],
  ],
  right: [
    [BTN.RT, [608, 100], 'Use the item you hold'],
    [BTN.RB, [620, 126], 'Next item'],
    [BTN.MENU, null, 'Pause'],
    [BTN.Y, null, 'Torch on or off'],
    [BTN.B, null, 'Crouch'],
    [BTN.X, null, 'Drop · hold, let go: toss'],
    [BTN.A, null, 'Interact · revive'],
    ['RSTICK', null, 'Look · press in to crouch'],
  ],
});

function anchorOf(b, L) {
  const [fx, fy] = L.face;
  switch (b) {
    case BTN.A: return [fx, fy + 27]; case BTN.B: return [fx + 27, fy]; case BTN.X: return [fx - 27, fy]; case BTN.Y: return [fx, fy - 27];
    case BTN.VIEW: return L.view; case BTN.MENU: return L.menu;
    case 'LSTICK': return L.ls; case 'RSTICK': return L.rs;
    case BTN.UP: return [L.dpad[0], L.dpad[1] - 16];
    default: return null;
  }
}

/** the drawing itself (SVG) */
function padSvg(kind) {
  const ps = kind !== 'xbox', L = LAYOUT[ps ? 'ps' : 'xbox'], [fx, fy] = L.face;
  const face = [[BTN.Y, 0, -27], [BTN.X, -27, 0], [BTN.B, 27, 0], [BTN.A, 0, 27]].map(([b, dx, dy]) => {
    const x = fx + dx, y = fy + dy;
    const sym = ps
      ? { [BTN.A]: `<path d="M${x - 5} ${y - 5}l10 10M${x + 5} ${y - 5}l-10 10" class="sy"/>`, [BTN.B]: `<circle cx="${x}" cy="${y}" r="5.5" class="sy"/>`, [BTN.X]: `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" class="sy"/>`, [BTN.Y]: `<path d="M${x} ${y - 6}l6 10h-12z" class="sy"/>` }[b]
      : `<text x="${x}" y="${y + 5}" class="lt">${'ABXY'[b]}</text>`;
    return `<g class="btn f${b}" data-b="${b}"><circle cx="${x}" cy="${y}" r="13"/>${sym}</g>`;
  }).join('');
  const stick = (b, [x, y]) => `<g class="btn stick" data-b="${b}"><circle cx="${x}" cy="${y}" r="34" class="well"/><g class="cap" data-cap="${b}"><circle cx="${x}" cy="${y}" r="24"/><circle cx="${x}" cy="${y}" r="16" class="dimple"/></g></g>`;
  const [dx, dy] = L.dpad;
  const arm = (b, x, y, w, h) => `<rect class="btn arm" data-b="${b}" x="${x}" y="${y}" width="${w}" height="${h}" rx="3"/>`;
  const dpad = arm(BTN.UP, dx - 8, dy - 26, 16, 20) + arm(BTN.DOWN, dx - 8, dy + 6, 16, 20) + arm(BTN.LEFT, dx - 26, dy - 8, 20, 16) + arm(BTN.RIGHT, dx + 6, dy - 8, 20, 16) + `<rect x="${dx - 8}" y="${dy - 8}" width="16" height="16" class="hub"/>`;
  const small = (b, [x, y]) => `<rect class="btn small" data-b="${b}" x="${x - 10}" y="${y - 6}" width="20" height="12" rx="6"/>`;
  const touch = ps ? `<rect class="btn touch" data-b="${BTN.PAD}" x="${L.touch[0]}" y="${L.touch[1]}" width="${L.touch[2]}" height="${L.touch[3]}" rx="10"/>` : '';
  return `<svg viewBox="0 0 ${VW} ${VH}" aria-hidden="true"><g transform="translate(${OX} 0)">
    <rect class="btn trig" data-b="${BTN.LT}" x="280" y="90" width="66" height="34" rx="12"/><rect class="btn trig" data-b="${BTN.RT}" x="574" y="90" width="66" height="34" rx="12"/>
    <rect class="btn bump" data-b="${BTN.LB}" x="262" y="116" width="96" height="20" rx="9"/><rect class="btn bump" data-b="${BTN.RB}" x="562" y="116" width="96" height="20" rx="9"/>
    <path d="${BODY}" class="body"/><path d="${BODY}" class="rim"/>
    ${touch}${stick(BTN.LS, L.ls)}${stick(BTN.RS, L.rs)}${dpad}${face}${small(BTN.VIEW, L.view)}${small(BTN.MENU, L.menu)}
    <circle cx="${L.home[0]}" cy="${L.home[1]}" r="${ps ? 8 : 11}" class="home"/>
  </g><g class="leads"></g></svg>`;
}

/** draw the labelled controller into `el` for 'xbox' | 'ps4' | 'ps5' */
export function renderPadDiagram(el, kind) {
  const ps = kind !== 'xbox', L = LAYOUT[ps ? 'ps' : 'xbox'], lab = LABELS(ps);
  let html = padSvg(kind), leads = '';
  const labels = [];
  for (const side of ['left', 'right']) {
    const list = lab[side].map(([b, a, text]) => ({ b, a: a || anchorOf(b, L), text })).sort((p, q) => p.a[1] - q.a[1]);
    const n = list.length, y0 = 50, y1 = VH - 40;
    list.forEach((it, i) => {
      const y = n > 1 ? y0 + (i * (y1 - y0)) / (n - 1) : VH / 2;
      const ax = it.a[0] + OX, ay = it.a[1];
      const colX = side === 'left' ? 222 : VW - 222, elbow = side === 'left' ? 238 : VW - 238;
      leads += `<polyline class="lead" data-lead="${it.b}" points="${ax},${ay} ${elbow},${y} ${colX},${y}"/><circle class="dot" cx="${ax}" cy="${ay}" r="3"/>`;
      const glyphs = it.b === 'LSTICK' ? padGlyph('LSTICK', kind) : it.b === 'RSTICK' ? padGlyph('RSTICK', kind) : padGlyph(it.b, kind);
      const pos = side === 'left' ? `right:${((VW - colX + 8) / VW) * 100}%` : `left:${((colX + 8) / VW) * 100}%`;
      labels.push(`<div class="plabel ${side}" data-lab="${it.b}" style="${pos};top:${(y / VH) * 100}%">${glyphs}<span>${it.text}</span></div>`);
    });
  }
  el.innerHTML = html.replace('<g class="leads"></g>', `<g class="leads">${leads}</g>`) + labels.join('')
    // narrow screens: the same thing as a plain list
    + `<ul class="plist">${[...lab.left, ...lab.right].map(([b, , t]) => `<li>${padGlyph(b, kind)}<span>${t}</span></li>`).join('')}</ul>`;
}

/** rows for the Headmaster and menu tables */
export function padTables(kind) {
  const g = (b) => padGlyph(b, kind);
  const hunter = [
    [g(BTN.RT), 'Attack'], [g(BTN.LT), 'Rage (hold): fast, but it runs out'], [g(BTN.A), 'Force doors, rip lockers open'],
    [g(BTN.X), 'Teleport forward'], [g(BTN.Y), 'Set a trap'], [g(BTN.B), 'Kill the lights'], [g('LSTICK') + g('RSTICK'), 'Move and look'],
  ];
  const menus = [
    [g(BTN.UP) + g('LSTICK'), 'Move between buttons; left and right change sliders'], [g(BTN.A), 'Choose'], [g(BTN.B), 'Back, or close a panel'],
    [g('RSTICK'), 'Scroll a long panel'], [g(BTN.MENU), 'Pause, and resume'], [g(BTN.LB) + g(BTN.RB), 'Switch tabs on this screen'],
  ];
  const rows = (r) => r.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  return { hunter: rows(hunter), menus: rows(menus) };
}

/** light up whatever is pressed on the connected pad (call every frame while the page is open) */
export function livePadDiagram(el) {
  if (!input.connected) return;
  for (const n of el.querySelectorAll('[data-b]')) {
    const b = Number(n.dataset.b), on = input.held(b);
    n.classList.toggle('on', on);
  }
  for (const n of el.querySelectorAll('.plabel')) {
    const b = n.dataset.lab, on = b === 'LSTICK' ? Math.hypot(input.axes[0], input.axes[1]) > 0.3 || input.held(BTN.LS) : b === 'RSTICK' ? Math.hypot(input.axes[2], input.axes[3]) > 0.3 || input.held(BTN.RS)
      : Number(b) === BTN.UP ? input.held(BTN.UP) || input.held(BTN.DOWN) || input.held(BTN.LEFT) : Number(b) === BTN.VIEW ? input.held(BTN.VIEW) || input.held(BTN.PAD) : input.held(Number(b));
    n.classList.toggle('on', on);
  }
  for (const [b, i] of [[BTN.LS, 0], [BTN.RS, 2]]) {
    const cap = el.querySelector(`[data-cap="${b}"]`);
    if (cap) cap.setAttribute('transform', `translate(${(input.axes[i] * 9).toFixed(1)} ${(input.axes[i + 1] * 9).toFixed(1)})`);
  }
}
