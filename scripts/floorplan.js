// Draws the school floor plan as an SVG string from the same map data the game runs on,
// so it can never drift out of date. Used only by `npm run map`.
// This file is deliberately NOT inside client/: the web server never sends it to players.
import { MAP, W, H, WALL, ROOMS, STAIRS } from '../client/shared/map.js';

const LABELS = {
  'Main Hall': 'MAIN HALL', 'West Corridor': 'WEST CORRIDOR', 'East Corridor': 'EAST CORRIDOR', 'North Corridor': 'NORTH CORRIDOR', 'South Corridor': 'SOUTH CORRIDOR',
  'Basement Stairs': 'STAIRS ↓', Stairwell: '', Courtyard: 'EXIT', 'Hidden Archive': 'HIDDEN ROOM',
};

/**
 * opts.cell     pixel size of one metre (default 14)
 * opts.secret   also show the hidden room behind the library bookshelf
 * opts.legend   draw title + legend (for the printable version)
 */
export function floorPlanSVG(opts = {}) {
  const c = opts.cell || 14, secret = !!opts.secret, legend = !!opts.legend;
  const out = [];
  const rect = (x, z, w, h, fill, extra = '') => out.push(`<rect x="${(x * c).toFixed(1)}" y="${(z * c).toFixed(1)}" width="${(w * c).toFixed(1)}" height="${(h * c).toFixed(1)}" fill="${fill}" ${extra}/>`);
  const text = (x, z, str, size, fill = '#cfd6cc', extra = '') => out.push(`<text x="${(x * c).toFixed(1)}" y="${(z * c).toFixed(1)}" font-size="${(size * c).toFixed(1)}" fill="${fill}" text-anchor="middle" dominant-baseline="middle" ${extra}>${str}</text>`);
  const hidden = (r) => r.secret && !secret;

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * c} ${H * c}" font-family="system-ui, 'Segoe UI', Arial, sans-serif" font-weight="600">`);
  rect(0, 0, W, H, '#0a0d0c');

  // floors: every walkable cell, so the outline is exactly what you can walk on
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x;
    if (MAP.grid[i] === WALL) continue;
    const ri = MAP.roomOf[i], room = ri >= 0 ? ROOMS[ri] : null;
    if (room && hidden(room)) continue;
    const di = MAP.doorAt[i];
    if (di >= 0 && MAP.doors[di].kind === 'shelf' && !secret) continue;
    const lv = MAP.level[i];
    const fill = room && room.outside ? '#16301f' : lv === 2 ? '#1b2a44' : lv === 1 ? '#2a3350' : room && room.corridor ? '#2b332d' : '#394239';
    rect(x - 0.02, z - 0.02, 1.04, 1.04, fill);
  }
  // stairs treads
  for (let x = STAIRS.x0; x < STAIRS.x1; x += 0.5) out.push(`<line x1="${x * c}" y1="${STAIRS.z0 * c}" x2="${x * c}" y2="${STAIRS.z1 * c}" stroke="#6f7fae" stroke-width="${c * 0.06}"/>`);
  // furniture (faint), so rooms are recognisable
  for (const p of MAP.props) {
    if (['board', 'hoop', 'portrait', 'pipes'].includes(p.t)) continue;
    const ri = MAP.roomOf[Math.floor(p.z) * W + Math.floor(p.x)];
    if (ri >= 0 && hidden(ROOMS[ri])) continue;
    const pad = p.t === 'desk' ? 0.22 : 0.08;
    rect(p.x - p.w / 2 + pad, p.z - p.d / 2 + pad, p.w - pad * 2, p.d - pad * 2, p.t === 'table' ? '#566153' : '#4a5449', `rx="${c * 0.08}"`);
  }
  // lockers
  for (const L of MAP.lockers) rect(L.x + 0.12, L.z + 0.12, 0.76, 0.76, '#c98a2b', `rx="${c * 0.1}"`);
  // doors
  for (const d of MAP.doors) {
    if (d.kind === 'gate') { rect(4.3, 21, 0.4, 3, '#e04a3a'); continue; }
    if (d.kind === 'shelf') { if (secret) rect(d.x + 0.05, d.z + 0.3, 0.9, 0.4, '#b06ad6'); continue; }
    const col = d.lock ? '#e04a3a' : '#d9d4c7';
    if (d.axis === 'x') rect(d.x + 0.32, d.z + 0.04, 0.36, 0.92, col); else rect(d.x + 0.04, d.z + 0.32, 0.92, 0.36, col);
  }
  // key places
  const mark = (x, z, col, label) => { out.push(`<circle cx="${x * c}" cy="${z * c}" r="${c * 0.62}" fill="${col}" stroke="#0a0d0c" stroke-width="${c * 0.12}"/>`); text(x, z + 0.04, label, 0.72, '#0a0d0c', 'font-weight="800"'); };
  mark(MAP.fuseBox.x, MAP.fuseBox.z - 0.9, '#f2c94c', 'F');
  mark(54.1, 9.7, '#5ad1e6', 'S');
  mark(56.1, 13.2, '#f2c94c', 'K');
  mark(7.2, 22.5, '#7fc58a', '▶');

  // room names
  for (const r of ROOMS) {
    if (hidden(r)) continue;
    const name = r.name in LABELS ? LABELS[r.name] : r.name.toUpperCase();
    if (!name) continue;
    const w = r.x1 - r.x0 + 1, h = r.z1 - r.z0 + 1, cx = r.x0 + w / 2, cz = r.z0 + h / 2;
    const col = r.basement ? '#b9c8f0' : r.outside ? '#9fe0ae' : r.secret ? '#d9b3ee' : r.corridor ? '#8f998d' : '#e8ece4';
    if (r.corridor && h > w * 2) { text(cx, cz + (r.name === 'West Corridor' ? 5 : -4), name, 0.78, col, `transform="rotate(-90 ${cx * c} ${(cz + (r.name === 'West Corridor' ? 5 : -4)) * c})" letter-spacing="${c * 0.08}"`); continue; }
    if (r.corridor && r.name !== 'Main Hall') { text(cx, cz, name, 0.78, col, `letter-spacing="${c * 0.08}"`); continue; }
    if (r.name === 'Main Hall') { text(26, 22.5, name, 0.95, col, `letter-spacing="${c * 0.2}"`); continue; }
    const size = r.outside || w < 5 ? 0.7 : 0.9;
    const words = name.split(' ');
    const lines = name.length * size * 0.62 > w - 0.6 && words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [name];
    lines.forEach((ln, i) => text(cx, cz + (i - (lines.length - 1) / 2) * size * 1.2, ln, size, col, `paint-order="stroke" stroke="#0a0d0c" stroke-width="${c * 0.22}" stroke-linejoin="round"`));
  }

  if (legend) {
    text(31.5, 1.7, 'THE LAST BELL — SCHOOL FLOOR PLAN', 1.25, '#e8ece4', `letter-spacing="${c * 0.2}"`);
    const items = [
      ['#d9d4c7', 'Door'], ['#e04a3a', 'Locked door / main gate'], ['#c98a2b', 'Locker (hide inside)'], ['#566153', 'Table (crouch under it)'],
      ['#f2c94c', 'F  Fuse box   ·   K  Gate key (on the desk)'], ['#5ad1e6', 'S  Security console'], ['#7fc58a', '▶  Where you start'], ['#1b2a44', 'Basement level (down the stairs)'],
    ];
    if (secret) items.push(['#b06ad6', 'Loose bookshelf → hidden room']);
    items.forEach(([col, label], i) => {
      const x = 15.5 + (i % 2) * 16, z = 42.5 + Math.floor(i / 2) * 1.12;
      rect(x, z - 0.36, 0.72, 0.72, col, `rx="${c * 0.1}"`);
      out.push(`<text x="${(x + 1.1) * c}" y="${z * c}" font-size="${0.7 * c}" fill="#cfd6cc" dominant-baseline="middle">${label}</text>`);
    });
    out.push(`<text x="${1 * c}" y="${44 * c}" font-size="${0.72 * c}" fill="#8f998d"><tspan x="${1 * c}" dy="0">Fuses, the office key, batteries,</tspan><tspan x="${1 * c}" dy="${c}">bottles and the rest are in</tspan><tspan x="${1 * c}" dy="${c}">different rooms every match.</tspan></text>`);
  }
  out.push('</svg>');
  return out.join('');
}
