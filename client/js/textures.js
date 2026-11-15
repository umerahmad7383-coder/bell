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

  return T;
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
