// Every texture in the game is painted procedurally on a canvas at load time:
// no image downloads, so the client stays tiny and has no asset licensing issues.
import * as THREE from 'three';

function make(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
const R = (a, b) => a + Math.random() * (b - a);

function speckle(ctx, w, h, n, dark = 0.25, light = 0.08) {
  for (let i = 0; i < n; i++) {
    const d = Math.random() < 0.7;
    ctx.fillStyle = d ? `rgba(0,0,0,${R(0, dark)})` : `rgba(255,255,255,${R(0, light)})`;
    const s = R(1, 3);
    ctx.fillRect(R(0, w), R(0, h), s, s);
  }
}
function stains(ctx, w, h, n, color = '20,16,10', maxA = 0.25, maxR = 60) {
  for (let i = 0; i < n; i++) {
    const x = R(0, w), y = R(0, h), r = R(10, maxR);
    for (const ox of [-w, 0, w]) { // wrap horizontally so the texture tiles
      const g = ctx.createRadialGradient(x + ox, y, 0, x + ox, y, r);
      g.addColorStop(0, `rgba(${color},${R(0.05, maxA)})`); g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g; ctx.fillRect(x + ox - r, y - r, r * 2, r * 2);
    }
  }
}
function streaks(ctx, w, h, n) {
  for (let i = 0; i < n; i++) {
    const x = R(0, w), y0 = R(0, h * 0.6), len = R(30, h * 0.5), ww = R(2, 9);
    const g = ctx.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, `rgba(25,20,12,${R(0.08, 0.3)})`); g.addColorStop(1, 'rgba(25,20,12,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y0, ww, len);
  }
}

export function buildTextures() {
  const T = {};

  // 1 m wide x 3.2 m tall institutional wall: grimy plaster above a painted dado band
  T.wall = make(256, 512, (c, w, h) => {
    c.fillStyle = '#8f8b76'; c.fillRect(0, 0, w, h);
    const band = h * 0.36;
    c.fillStyle = '#4a5c50'; c.fillRect(0, h - band, w, band);
    c.fillStyle = '#2b3530'; c.fillRect(0, h - band - 5, w, 6);
    c.fillStyle = '#2a2a24'; c.fillRect(0, h - 16, w, 16); // skirting board
    stains(c, w, h, 16, '30,24,14', 0.3, 80);
    streaks(c, w, h, 14);
    speckle(c, w, h, 2500);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(0.12, 'rgba(0,0,0,0)'); g.addColorStop(0.8, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  });

  T.concrete = make(256, 256, (c, w, h) => {
    c.fillStyle = '#5b5a56'; c.fillRect(0, 0, w, h);
    stains(c, w, h, 22, '15,15,18', 0.35, 70);
    stains(c, w, h, 6, '60,40,20', 0.2, 50);
    speckle(c, w, h, 5000, 0.3, 0.12);
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 1;
    for (let i = 0; i < 5; i++) { c.beginPath(); let x = R(0, w), y = R(0, h); c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += R(-25, 25); y += R(5, 30); c.lineTo(x, y); } c.stroke(); }
  });

  // 2 m x 2 m of checkered linoleum
  T.lino = make(256, 256, (c, w, h) => {
    const n = 4, s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      c.fillStyle = (x + y) % 2 ? '#6d6a58' : '#4c5046';
      c.fillRect(x * s, y * s, s, s);
      c.strokeStyle = 'rgba(0,0,0,0.35)'; c.strokeRect(x * s + 0.5, y * s + 0.5, s - 1, s - 1);
    }
    stains(c, w, h, 14, '10,8,5', 0.4, 60);
    speckle(c, w, h, 3000);
    c.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 12; i++) { c.beginPath(); const x = R(0, w), y = R(0, h); c.moveTo(x, y); c.lineTo(x + R(-40, 40), y + R(-40, 40)); c.stroke(); }
  });

  T.wood = make(256, 256, (c, w, h) => {
    c.fillStyle = '#5a4630'; c.fillRect(0, 0, w, h);
    const pw = w / 6;
    for (let i = 0; i < 6; i++) {
      c.fillStyle = `rgba(${R(0, 40)},${R(0, 25)},0,${R(0.05, 0.3)})`; c.fillRect(i * pw, 0, pw, h);
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(i * pw, 0, 1.5, h);
      for (let k = 0; k < 3; k++) c.fillRect(i * pw, R(0, h), pw, 1.2);
    }
    for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(20,10,0,${R(0.03, 0.15)})`; c.fillRect(R(0, w), R(0, h), R(1, 2), R(20, 90)); }
    stains(c, w, h, 8, '10,6,2', 0.35, 60);
    speckle(c, w, h, 1500);
  });

  T.ceiling = make(256, 256, (c, w, h) => {
    c.fillStyle = '#6f6e66'; c.fillRect(0, 0, w, h);
    speckle(c, w, h, 4000, 0.2, 0.1);
    stains(c, w, h, 8, '60,45,20', 0.3, 70);
    c.strokeStyle = '#2f2f2b'; c.lineWidth = 3;
    for (let i = 0; i <= 2; i++) { c.beginPath(); c.moveTo(i * w / 2, 0); c.lineTo(i * w / 2, h); c.moveTo(0, i * h / 2); c.lineTo(w, i * h / 2); c.stroke(); }
  });

  // generic grime, multiplied over vertex-coloured props
  T.grime = make(128, 128, (c, w, h) => {
    c.fillStyle = '#c9c9c9'; c.fillRect(0, 0, w, h);
    stains(c, w, h, 14, '20,18,14', 0.4, 40);
    speckle(c, w, h, 1500, 0.3, 0.15);
  });

  T.door = make(128, 256, (c, w, h) => {
    c.fillStyle = '#4b3a28'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(15,8,0,${R(0.04, 0.18)})`; c.fillRect(R(0, w), 0, R(1, 3), h); }
    c.strokeStyle = 'rgba(0,0,0,0.5)'; c.lineWidth = 3;
    c.strokeRect(14, 150, w - 28, 92); c.strokeRect(14, 14, w - 28, 120);
    c.fillStyle = '#0b0f12'; c.fillRect(38, 34, w - 76, 70);           // wired-glass window
    c.strokeStyle = 'rgba(160,180,190,0.18)'; c.lineWidth = 1;
    for (let i = 0; i < 7; i++) { c.beginPath(); c.moveTo(38 + i * 8, 34); c.lineTo(38 + i * 8, 104); c.stroke(); c.beginPath(); c.moveTo(38, 34 + i * 10); c.lineTo(w - 38, 34 + i * 10); c.stroke(); }
    c.fillStyle = '#77715f'; c.fillRect(0, h - 26, w, 26);              // kick plate
    c.fillStyle = '#9a927a'; c.fillRect(w - 24, 128, 14, 8);            // handle
    stains(c, w, h, 8, '0,0,0', 0.35, 50); speckle(c, w, h, 900);
  }, false);

  T.locker = make(128, 256, (c, w, h) => {
    c.fillStyle = '#b9bcc0'; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = 'rgba(0,0,0,0.75)';
    for (let i = 0; i < 6; i++) c.fillRect(26, 26 + i * 9, w - 52, 4);
    for (let i = 0; i < 4; i++) c.fillRect(26, h - 60 + i * 9, w - 52, 4);
    c.fillStyle = '#33363a'; c.fillRect(w - 26, 120, 9, 24);
    stains(c, w, h, 10, '70,35,10', 0.35, 40); speckle(c, w, h, 900, 0.3, 0.1);
    c.strokeStyle = 'rgba(40,20,5,0.4)'; c.lineWidth = 1;
    for (let i = 0; i < 6; i++) { c.beginPath(); const x = R(10, w - 10), y = R(10, h - 10); c.moveTo(x, y); c.lineTo(x + R(-20, 20), y + R(-20, 20)); c.stroke(); }
  }, false);

  T.board = make(512, 128, (c, w, h) => {
    c.fillStyle = '#16211b'; c.fillRect(0, 0, w, h);
    stains(c, w, h, 30, '200,200,190', 0.1, 70);
    c.fillStyle = 'rgba(225,225,210,0.55)'; c.font = '17px "Comic Sans MS", "Segoe Print", cursive';
    for (let i = 0; i < 6; i++) { c.globalAlpha = R(0.25, 0.8); c.fillText('I will not leave my seat.  I will not leave my seat.  I will not leave', 12 + R(-4, 4), 22 + i * 19); }
    c.globalAlpha = 1;
    stains(c, w, h, 8, '22,33,27', 0.9, 50); // half-erased patches
    c.strokeStyle = '#3b2c1b'; c.lineWidth = 8; c.strokeRect(0, 0, w, h);
  }, false);

  T.window = make(128, 192, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2c3a4e'); g.addColorStop(1, '#131a26');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(190,210,230,0.16)'; c.lineWidth = 1;
    for (let i = 0; i < 70; i++) { const x = R(0, w), y = R(0, h); c.beginPath(); c.moveTo(x, y); c.lineTo(x - 5, y + R(12, 30)); c.stroke(); } // rain streaks
    stains(c, w, h, 10, '0,0,0', 0.5, 40);
    c.strokeStyle = 'rgba(210,225,240,0.5)';
    const cx = R(30, w - 30), cy = R(40, h - 40);
    for (let i = 0; i < 9; i++) { c.beginPath(); c.moveTo(cx, cy); let x = cx, y = cy; const a = R(0, 6.28); for (let k = 0; k < 4; k++) { x += Math.cos(a + R(-0.4, 0.4)) * R(8, 22); y += Math.sin(a + R(-0.4, 0.4)) * R(8, 22); c.lineTo(x, y); } c.stroke(); }
    c.fillStyle = '#05070a'; c.beginPath(); c.arc(cx, cy, 7, 0, 6.28); c.fill();  // the hole
    c.fillStyle = '#1a1c1c'; c.fillRect(w / 2 - 3, 0, 6, h); c.fillRect(0, h / 2 - 3, w, 6);
    c.strokeStyle = '#1a1c1c'; c.lineWidth = 10; c.strokeRect(0, 0, w, h);
  }, false);

  T.face = make(256, 256, (c, w, h) => {
    c.fillStyle = '#9d9a8c'; c.fillRect(0, 0, w, h);
    stains(c, w, h, 20, '40,35,30', 0.35, 60);
    // SphereGeometry puts +Z (the model's front) at u = 0.25
    const fx = w * 0.25, fy = h * 0.5;
    const eye = (x, y, rx, ry) => { const g = c.createRadialGradient(x, y, 1, x, y, ry); g.addColorStop(0, '#000'); g.addColorStop(0.7, '#050303'); g.addColorStop(1, 'rgba(20,10,10,0)'); c.fillStyle = g; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 6.28); c.fill(); };
    eye(fx - 17, fy - 26, 9, 22); eye(fx + 15, fy - 20, 8, 27);
    c.fillStyle = '#050202'; c.beginPath(); c.ellipse(fx, fy + 42, 13, 34, 0, 0, 6.28); c.fill(); // mouth pulled far too long
    c.strokeStyle = 'rgba(30,10,10,0.7)'; c.lineWidth = 1.5;
    for (let i = 0; i < 12; i++) { c.beginPath(); c.moveTo(fx + R(-12, 12), fy + R(12, 20)); c.lineTo(fx + R(-16, 16), fy + R(70, 92)); c.stroke(); }
    c.fillStyle = 'rgba(230,230,215,0.9)'; c.fillRect(fx - 18, fy - 27, 2.5, 2.5); c.fillRect(fx + 15, fy - 21, 2.5, 2.5);
    speckle(c, w, h, 1200, 0.3, 0.05);
  }, false);

  // Close-up face used only for the jumpscare (laid out for a sphere: the front is at u = 0.25).
  T.scare = make(1024, 512, (c, w, h) => {
    c.fillStyle = '#a9a595'; c.fillRect(0, 0, w, h);
    stains(c, w, h, 60, '50,40,35', 0.35, 90);
    const fx = w * 0.25, fy = h * 0.5;
    const hollow = (x, y, rx, ry, rot = 0) => { c.save(); c.translate(x, y); c.rotate(rot); const g = c.createRadialGradient(0, 0, 2, 0, 0, Math.max(rx, ry)); g.addColorStop(0, '#000'); g.addColorStop(0.55, '#020101'); g.addColorStop(0.8, 'rgba(25,8,8,0.9)'); g.addColorStop(1, 'rgba(40,15,12,0)'); c.fillStyle = g; c.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); c.beginPath(); c.arc(0, 0, Math.max(rx, ry), 0, 6.28); c.fill(); c.restore(); };
    // dark bruising around everything
    const sh = c.createRadialGradient(fx, fy, 30, fx, fy, 230); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.75)'); c.fillStyle = sh; c.fillRect(0, 0, w / 2, h);
    hollow(fx - 66, fy - 62, 44, 70, 0.12); hollow(fx + 60, fy - 50, 38, 82, -0.08);       // eye sockets, uneven
    c.fillStyle = '#f4f2e6'; c.beginPath(); c.arc(fx - 68, fy - 60, 5, 0, 6.28); c.fill(); c.beginPath(); c.arc(fx + 60, fy - 46, 4, 0, 6.28); c.fill(); // pin-prick pupils
    hollow(fx - 4, fy + 6, 12, 24);                                                           // nose cavity
    hollow(fx, fy + 128, 70, 118);                                                            // the mouth, unhinged
    c.fillStyle = '#d9d2b8';
    for (let i = 0; i < 9; i++) { const tx = fx - 52 + i * 13 + R(-2, 2), th = R(16, 34); c.beginPath(); c.moveTo(tx, fy + 44 + Math.abs(i - 4) * 5); c.lineTo(tx + 9, fy + 44 + Math.abs(i - 4) * 5); c.lineTo(tx + 4.5 + R(-2, 2), fy + 44 + Math.abs(i - 4) * 5 + th); c.fill(); }
    for (let i = 0; i < 8; i++) { const tx = fx - 44 + i * 12 + R(-2, 2), th = R(12, 26), by = fy + 226 - Math.abs(i - 3.5) * 9; c.beginPath(); c.moveTo(tx, by); c.lineTo(tx + 8, by); c.lineTo(tx + 4 + R(-2, 2), by - th); c.fill(); }
    c.strokeStyle = 'rgba(50,10,10,0.75)'; c.lineWidth = 2;
    for (let i = 0; i < 40; i++) { c.beginPath(); let x = fx + R(-150, 150), y = fy + R(-200, 220); c.moveTo(x, y); for (let k = 0; k < 5; k++) { x += R(-16, 16); y += R(6, 26); c.lineTo(x, y); } c.stroke(); } // veins and cracks
    c.strokeStyle = 'rgba(20,0,0,0.85)'; c.lineWidth = 3;
    for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) { c.beginPath(); const x = fx + sx * 62 + R(-22, 22); c.moveTo(x, fy + R(0, 20)); c.lineTo(x + R(-8, 8), fy + R(60, 150)); c.stroke(); } // tracks running down from the eyes
    speckle(c, w / 2, h, 5000, 0.3, 0.05);
  }, false);

  T.uniform = make(128, 128, (c, w, h) => {
    c.fillStyle = '#17171b'; c.fillRect(0, 0, w, h);
    stains(c, w, h, 14, '70,60,45', 0.25, 40);
    speckle(c, w, h, 1500, 0.4, 0.06);
    c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 2;
    for (let i = 0; i < 9; i++) { c.beginPath(); const x = R(0, w), y = R(0, h); c.moveTo(x, y); c.lineTo(x + R(-8, 8), y + R(10, 40)); c.stroke(); } // tears
  });

  T.portrait = make(128, 160, (c, w, h) => {
    c.fillStyle = '#1b1510'; c.fillRect(0, 0, w, h);
    const g = c.createRadialGradient(w / 2, 60, 5, w / 2, 70, 90); g.addColorStop(0, '#4a3b2a'); g.addColorStop(1, '#120d09');
    c.fillStyle = g; c.fillRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#0d0d10'; c.beginPath(); c.moveTo(30, h - 8); c.lineTo(44, 86); c.lineTo(84, 86); c.lineTo(98, h - 8); c.fill();
    c.fillStyle = '#8f8a78'; c.beginPath(); c.ellipse(w / 2, 58, 15, 26, 0, 0, 6.28); c.fill();
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(w / 2 - 16, 44, 32, 10); // eyes scratched out
    c.strokeStyle = '#6b5a2e'; c.lineWidth = 8; c.strokeRect(4, 4, w - 8, h - 8);
    stains(c, w, h, 8, '0,0,0', 0.4, 40);
  }, false);

  T.glow = make(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }, false);

  T.blood = make(128, 128, (c, w, h) => {
    stains(c, w, h, 0);
    for (let i = 0; i < 9; i++) { const x = R(30, 98), y = R(30, 98), r = R(8, 30); const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(38,4,4,0.85)'); g.addColorStop(0.7, 'rgba(30,3,3,0.6)'); g.addColorStop(1, 'rgba(30,3,3,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }
  }, false);

  // ---------------------------------------------------------------- South Wing (v0.9)
  // small white wall/floor tiles, grimy grout
  T.tile = make(256, 256, (c, w, h) => {
    c.fillStyle = '#5e605a'; c.fillRect(0, 0, w, h);
    const n = 8, s = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const v = 150 + R(-18, 12);
      c.fillStyle = `rgb(${v},${v + 2},${v - 6})`; c.fillRect(x * s + 1.5, y * s + 1.5, s - 3, s - 3);
      if (Math.random() < 0.06) { c.strokeStyle = 'rgba(0,0,0,0.5)'; c.beginPath(); c.moveTo(x * s + R(0, s), y * s); c.lineTo(x * s + R(0, s), y * s + s); c.stroke(); } // cracked
    }
    stains(c, w, h, 16, '40,32,18', 0.35, 60); speckle(c, w, h, 2500, 0.25, 0.08);
  });
  // heavy stage curtain: red velvet folds
  T.curtain = make(256, 256, (c, w, h) => {
    for (let x = 0; x < w; x++) { const f = 0.55 + 0.45 * Math.sin(x / w * Math.PI * 10); c.fillStyle = `rgb(${Math.round(70 + 60 * f)},${Math.round(8 + 10 * f)},${Math.round(12 + 10 * f)})`; c.fillRect(x, 0, 1, h); }
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.3, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    stains(c, w, h, 10, '10,0,0', 0.4, 50); speckle(c, w, h, 1500, 0.3, 0.03);
  });
  // corridor posters / notices (several on one atlas, picked by UV offset)
  T.posters = make(512, 256, (c, w, h) => {
    const pw = w / 4;
    const drawPoster = (i, bg, title, lines, accent) => {
      const x0 = i * pw + 10, y0 = 12, pw2 = pw - 20, ph = h - 24;
      c.fillStyle = bg; c.fillRect(x0, y0, pw2, ph);
      c.fillStyle = accent; c.fillRect(x0, y0, pw2, 30);
      c.fillStyle = '#f4efe0'; c.font = 'bold 15px Georgia, serif'; c.textAlign = 'center'; c.fillText(title, x0 + pw2 / 2, y0 + 21);
      c.fillStyle = 'rgba(30,24,16,0.85)'; c.font = '11px Georgia, serif';
      lines.forEach((ln, k) => c.fillText(ln, x0 + pw2 / 2, y0 + 56 + k * 17));
      stains(c, w, h, 0); c.save(); c.globalAlpha = 0.4; c.fillStyle = '#3a2a14'; c.fillRect(x0 + R(0, pw2 - 30), y0 + R(60, ph - 40), R(10, 30), R(10, 40)); c.restore();
      c.fillStyle = '#8a8a86'; c.beginPath(); c.arc(x0 + pw2 / 2, y0 + 4, 3, 0, 6.28); c.fill(); // pin
      if (i === 2) { c.strokeStyle = '#2a0202'; c.lineWidth = 4; c.beginPath(); c.moveTo(x0 + 10, y0 + 40); c.lineTo(x0 + pw2 - 10, y0 + ph - 20); c.moveTo(x0 + pw2 - 10, y0 + 40); c.lineTo(x0 + 10, y0 + ph - 20); c.stroke(); }
    };
    drawPoster(0, '#d8cfb4', 'SCHOOL PLAY', ['"The Last Bell"', 'Friday 7 pm', 'Auditorium', '', 'All pupils attend.', 'No exceptions.'], '#6a1a14');
    drawPoster(1, '#c9d2c0', 'RULES', ['1. Walk, never run', '2. Silence in halls', '3. Stay in your seat', '4. Obey the bell', '5. Never be late', '6. Never leave'], '#24402e');
    drawPoster(2, '#d6c9a8', 'MISSING', ['Have you seen', 'THOMAS PETERS', 'Year 4', '', 'Last seen in', 'the locker room'], '#2b2b30');
    drawPoster(3, '#cdbfa2', 'CHOIR', ['Practice daily', 'Music Room', '', '"He likes to hear', 'you sing."', ''], '#3a2a5a');
  }, false);
  T.clock = make(128, 128, (c, w, h) => {
    c.fillStyle = '#1b1b1a'; c.beginPath(); c.arc(64, 64, 62, 0, 6.28); c.fill();
    c.fillStyle = '#d9d3bf'; c.beginPath(); c.arc(64, 64, 55, 0, 6.28); c.fill();
    c.fillStyle = '#222'; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; c.fillRect(64 + Math.sin(a) * 46 - 2, 64 - Math.cos(a) * 46 - 2, 4, 4); }
    c.strokeStyle = '#111'; c.lineCap = 'round';
    const hand = (a, len, wd) => { c.lineWidth = wd; c.beginPath(); c.moveTo(64, 64); c.lineTo(64 + Math.sin(a) * len, 64 - Math.cos(a) * len); c.stroke(); };
    hand((3 + 15 / 60) / 12 * 6.283, 28, 5); hand(15 / 60 * 6.283, 42, 3); // stopped at 3:15
    c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(30, 30); c.lineTo(80, 92); c.stroke(); // cracked glass
    stains(c, w, h, 6, '40,30,10', 0.35, 30);
  }, false);
  // loose papers on the floor
  T.paper = make(64, 64, (c, w, h) => {
    c.fillStyle = '#cfc8b2'; c.fillRect(4, 4, w - 8, h - 8);
    c.fillStyle = 'rgba(40,40,60,0.45)'; for (let i = 0; i < 9; i++) c.fillRect(10, 12 + i * 5, R(20, 42), 1.2);
    stains(c, w, h, 4, '60,40,10', 0.4, 20);
  }, false);
  T.web = make(128, 128, (c, w, h) => {
    c.strokeStyle = 'rgba(220,220,210,0.55)'; c.lineWidth = 1;
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 128, Math.sin(a) * 128); c.stroke(); }
    for (let r = 14; r < 128; r += R(10, 18)) { c.beginPath(); for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2), rr = r * R(0.9, 1.05); const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (!i) c.moveTo(x, y); else c.quadraticCurveTo(Math.cos(a - 0.1) * rr * 0.92, Math.sin(a - 0.1) * rr * 0.92, x, y); } c.stroke(); }
  }, false);
  // paintings on the art room walls: children's drawings of HIM
  T.art = make(256, 128, (c, w, h) => {
    for (let k = 0; k < 2; k++) {
      const x0 = k * 128 + 8; c.fillStyle = '#e3dccb'; c.fillRect(x0, 8, 112, 112);
      c.fillStyle = '#3d6a2a'; c.fillRect(x0, 100, 112, 20);
      c.fillStyle = '#111'; c.fillRect(x0 + 46 + k * 10, 34, 16, 66); c.beginPath(); c.arc(x0 + 54 + k * 10, 30, 10, 0, 6.28); c.fill(); // tall black figure
      c.fillStyle = '#c21010'; c.fillRect(x0 + 49 + k * 10, 27, 3, 3); c.fillRect(x0 + 56 + k * 10, 27, 3, 3); // red eyes
      c.fillStyle = '#e8b04a'; c.beginPath(); c.arc(x0 + 18, 22, 9, 0, 6.28); c.fill();
      c.fillStyle = '#3a5ac2'; c.fillRect(x0 + 20, 70, 8, 30); c.fillRect(x0 + 84, 74, 8, 26); // small children
      c.fillStyle = '#222'; c.font = '11px "Comic Sans MS", cursive'; c.fillText(k ? 'MY TEECHER' : 'HE WATCHES', x0 + 14, 116);
    }
  }, false);
  T.canvas = make(128, 128, (c, w, h) => {
    c.fillStyle = '#ddd5c2'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { c.fillStyle = `hsla(${R(0, 360)},45%,${R(25, 55)}%,0.55)`; c.beginPath(); c.arc(R(10, 118), R(10, 118), R(4, 22), 0, 6.28); c.fill(); }
    c.fillStyle = '#0c0c0c'; c.fillRect(56, 30, 14, 80); c.beginPath(); c.arc(63, 26, 10, 0, 6.28); c.fill();
  }, false);
  return T;
}

/** Engraved brass plaque with a room name (signs above doors). */
export function signTexture(text) {
  return make(256, 64, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#8d7a4c'); g.addColorStop(0.5, '#5e5031'); g.addColorStop(1, '#3d331e');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 4; c.strokeRect(3, 3, w - 6, h - 6);
    c.fillStyle = '#1d170c'; c.font = `bold ${text.length > 16 ? 22 : 27}px Georgia, "Times New Roman", serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text.toUpperCase(), w / 2, h / 2 + 2);
    c.fillStyle = 'rgba(255,240,200,0.18)'; c.fillText(text.toUpperCase(), w / 2 - 1, h / 2 + 1);
    stains(c, w, h, 8, '20,30,10', 0.4, 30);
  }, false);
}
/** Emergency exit sign: works without power. */
export function exitTexture(dir) {
  return make(256, 96, (c, w, h) => {
    c.fillStyle = '#0b3a1c'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#4dff8a'; c.font = 'bold 54px system-ui, Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('EXIT', w / 2 - (dir ? 22 * dir : 0), h / 2 + 2);
    if (dir) { c.beginPath(); const ax = dir < 0 ? 22 : w - 22; c.moveTo(ax, h / 2); c.lineTo(ax - dir * 30, h / 2 - 22); c.lineTo(ax - dir * 30, h / 2 + 22); c.fill(); }
    c.strokeStyle = '#4dff8a'; c.lineWidth = 3; c.strokeRect(5, 5, w - 10, h - 10);
  }, false);
}

/** Scrawled wall writing on a transparent background. */
export function writingTexture(text, color = '#4d0808') {
  return make(512, 128, (c, w, h) => {
    c.fillStyle = color; c.textBaseline = 'middle';
    const size = Math.min(60, (w - 30) / (text.length * 0.6));
    let x = 16;
    for (const ch of text) {
      c.save();
      c.font = `bold ${size * R(0.85, 1.15)}px "Courier New", monospace`;
      c.translate(x, h / 2 + R(-9, 9)); c.rotate(R(-0.12, 0.12));
      c.globalAlpha = R(0.65, 0.95);
      c.fillText(ch, 0, 0);
      if (ch !== ' ' && Math.random() < 0.3) { c.globalAlpha = 0.5; c.fillRect(R(2, size * 0.4), size * 0.25, 2.2, R(10, 44)); } // drips
      c.restore();
      x += size * 0.6;
    }
  }, false);
}

/** Floating player name tag. */
export function nameTexture(name, color) {
  return make(256, 64, (c, w, h) => {
    c.font = 'bold 30px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 6; c.strokeStyle = 'rgba(0,0,0,0.85)'; c.strokeText(name, w / 2, h / 2);
    c.fillStyle = color; c.fillText(name, w / 2, h / 2);
  }, false);
}
