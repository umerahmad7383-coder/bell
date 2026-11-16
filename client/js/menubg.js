// The main-menu backdrop: the school at night, drawn live on a 2D canvas (no image files).
// One orchestrated moment on load (the scene fades up and the windows light one by one),
// then it simply lives: rain, drifting fog, a swaying bell, flickering windows, lightning,
// and now and then something tall standing in a window. Stopped while a match is running.
const R = (a, b) => a + Math.random() * (b - a);

export class MenuScene {
  constructor(canvas) {
    this.c = canvas; this.x = canvas.getContext('2d');
    this.raf = 0; this.t = 0; this.mx = 0.5; this.my = 0.5; this.pmx = 0.5; this.pmy = 0.5;
    this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.flash = 0; this.nextFlash = R(5, 9); this.figure = null; this.nextFigure = R(7, 11);
    this.stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random() * 0.55, r: R(0.3, 1.2), p: R(0, 6) }));
    this.rain = Array.from({ length: 220 }, () => ({ x: Math.random(), y: Math.random(), l: R(0.012, 0.03), s: R(0.9, 1.4) }));
    this.fog = Array.from({ length: 7 }, (_, i) => ({ x: Math.random(), y: R(0.62, 0.9), w: R(0.35, 0.7), s: R(0.004, 0.012) * (i % 2 ? 1 : -1), a: R(0.05, 0.11) }));
    this.clouds = Array.from({ length: 6 }, () => ({ x: Math.random(), y: R(0.06, 0.3), w: R(0.18, 0.4), s: R(0.003, 0.008) }));
    this.onMove = (e) => { this.mx = e.clientX / innerWidth; this.my = e.clientY / innerHeight; };
    this.onResize = () => this.resize();
    this.build();
  }

  /** Window layout of the school (in 0..1 building space), lit in a sequence on load. */
  build() {
    this.wins = [];
    const rows = [0.38, 0.62];
    for (const [ri, ry] of rows.entries()) for (let i = 0; i < 13; i++) {
      if (i === 6) continue; // the tower sits here
      this.wins.push({ u: 0.05 + i * 0.072, v: ry, row: ri, lit: 0, on: Math.random() < 0.34, warm: Math.random() < 0.8, at: 1.2 + Math.random() * 2.2, ph: R(0, 10), fl: Math.random() < 0.35 });
    }
    // the wing on the left
    for (let i = 0; i < 3; i++) this.wins.push({ u: -0.2 + i * 0.07, v: 0.55, row: 2, lit: 0, on: Math.random() < 0.3, warm: true, at: 1.6 + Math.random() * 2, ph: R(0, 10), fl: true });
  }

  start() {
    if (this.raf) return;
    this.resize(); this.last = performance.now();
    addEventListener('mousemove', this.onMove); addEventListener('resize', this.onResize);
    this.c.hidden = false;
    const loop = (now) => { this.raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now; this.frame(dt); };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf); this.raf = 0;
    removeEventListener('mousemove', this.onMove); removeEventListener('resize', this.onResize);
    this.c.hidden = true;
  }
  resize() {
    const k = Math.min(window.devicePixelRatio || 1, 1.5);
    this.c.width = Math.round(innerWidth * k); this.c.height = Math.round(innerHeight * k);
    this.k = k;
  }

  frame(dt) {
    const { x: g, c } = this, W = c.width, H = c.height;
    this.t += dt; const t = this.t;
    this.pmx += (this.mx - this.pmx) * Math.min(1, dt * 2); this.pmy += (this.my - this.pmy) * Math.min(1, dt * 2);
    const px = (f) => (this.pmx - 0.5) * f * W * 0.04, py = (f) => (this.pmy - 0.5) * f * H * 0.02;
    const intro = Math.min(1, t / 1.6); // the scene fades up from black

    // lightning: two quick flashes, every so often
    if (!this.reduced) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.nextFlash = R(7, 15); this.flashSeq = [0, 0.12, 0.26]; this.flashT = 0; }
      if (this.flashSeq) { this.flashT += dt; this.flash = this.flashSeq.some((s) => this.flashT > s && this.flashT < s + 0.07) ? 1 : Math.max(0, this.flash - dt * 4); if (this.flashT > 0.6) this.flashSeq = null; }
      else this.flash = Math.max(0, this.flash - dt * 3);
    }
    const fl = this.flash;

    // sky
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, mix('#05090a', '#3b4a4e', fl * 0.6)); sky.addColorStop(0.55, mix('#0c1614', '#52625f', fl * 0.6)); sky.addColorStop(0.8, mix('#16211d', '#6a7a74', fl * 0.5)); sky.addColorStop(1, '#0a100e');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);

    // stars and the moon behind moving cloud
    for (const s of this.stars) { g.globalAlpha = (0.35 + 0.35 * Math.sin(t * 1.3 + s.p)) * intro; g.fillStyle = '#d8dccf'; g.fillRect(s.x * W + px(0.2), s.y * H + py(0.2), s.r * this.k, s.r * this.k); }
    g.globalAlpha = intro;
    const mxp = W * 0.86 + px(0.3), myp = H * 0.17 + py(0.3), mr = Math.min(W, H) * 0.055;
    const glow = g.createRadialGradient(mxp, myp, mr * 0.6, mxp, myp, mr * 5); glow.addColorStop(0, 'rgba(216,214,196,0.22)'); glow.addColorStop(1, 'rgba(216,214,196,0)');
    g.fillStyle = glow; g.fillRect(mxp - mr * 5, myp - mr * 5, mr * 10, mr * 10);
    g.fillStyle = '#d8d5c2'; g.beginPath(); g.arc(mxp, myp, mr, 0, 6.283); g.fill();
    g.fillStyle = 'rgba(160,160,140,0.25)'; for (const [dx, dy, rr] of [[-0.3, -0.2, 0.22], [0.25, 0.15, 0.16], [0.05, 0.4, 0.12]]) { g.beginPath(); g.arc(mxp + dx * mr, myp + dy * mr, rr * mr, 0, 6.283); g.fill(); }
    for (const cl of this.clouds) {
      cl.x += cl.s * dt * (this.reduced ? 0 : 1); if (cl.x > 1.3) cl.x = -0.4;
      const cx = cl.x * W + px(0.35), cy = cl.y * H + py(0.35), cw = cl.w * W;
      const cg = g.createRadialGradient(cx, cy, 0, cx, cy, cw * 0.5); cg.addColorStop(0, `rgba(${fl ? '90,104,100' : '8,13,12'},0.75)`); cg.addColorStop(1, 'rgba(8,13,12,0)');
      g.fillStyle = cg; g.save(); g.translate(cx, cy); g.scale(1, 0.28); g.beginPath(); g.arc(0, 0, cw * 0.5, 0, 6.283); g.fill(); g.restore();
    }

    // moonlit haze low in the sky, so the school stands out against it
    const ground = H * 0.8;
    const haze = g.createRadialGradient(W * 0.74 + px(0.4), ground - H * 0.18, 0, W * 0.74 + px(0.4), ground - H * 0.18, W * 0.55);
    haze.addColorStop(0, `rgba(96,120,110,${0.32 + fl * 0.3})`); haze.addColorStop(0.5, 'rgba(60,80,72,0.14)'); haze.addColorStop(1, 'rgba(40,55,50,0)');
    g.fillStyle = haze; g.fillRect(0, 0, W, H);
    // far tree line
    g.fillStyle = mix('#08100d', '#2a3632', fl * 0.5);
    g.beginPath(); g.moveTo(0, ground);
    for (let i = 0; i <= 60; i++) { const xx = (i / 60) * W; g.lineTo(xx + px(0.5), ground - H * (0.06 + 0.035 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)))); }
    g.lineTo(W, ground); g.closePath(); g.fill();

    this.drawSchool(g, W, H, ground, px(0.8), py(0.6), t, fl, intro);

    // ground, fog, rain, fence
    g.fillStyle = '#060a09'; g.fillRect(0, ground + py(0.8), W, H - ground);
    for (const f of this.fog) {
      f.x += f.s * dt * (this.reduced ? 0 : 1); if (f.x > 1.5) f.x = -0.5; if (f.x < -0.5) f.x = 1.5;
      const fx = f.x * W + px(1.1), fy = f.y * H, fw = f.w * W;
      const fg = g.createRadialGradient(fx, fy, 0, fx, fy, fw * 0.5); fg.addColorStop(0, `rgba(150,170,160,${f.a * (1 + fl)})`); fg.addColorStop(1, 'rgba(150,170,160,0)');
      g.fillStyle = fg; g.save(); g.translate(fx, fy); g.scale(1, 0.22); g.beginPath(); g.arc(0, 0, fw * 0.5, 0, 6.283); g.fill(); g.restore();
    }
    if (!this.reduced) {
      g.strokeStyle = `rgba(170,190,185,${0.18 + fl * 0.3})`; g.lineWidth = this.k; g.beginPath();
      for (const r of this.rain) {
        r.y += dt * r.s * 1.1; r.x -= dt * r.s * 0.12; if (r.y > 1) { r.y = -0.05; r.x = Math.random() * 1.1; }
        const rx = r.x * W, ry = r.y * H; g.moveTo(rx, ry); g.lineTo(rx - r.l * W * 0.12, ry + r.l * H);
      }
      g.stroke();
    }
    this.drawFence(g, W, H, px(1.6), fl);
    g.globalAlpha = 1;
    // vignette darkening toward the left, so the menu always reads
    const vg = g.createLinearGradient(0, 0, W * 0.6, 0); vg.addColorStop(0, 'rgba(5,8,7,0.82)'); vg.addColorStop(1, 'rgba(5,8,7,0)');
    g.fillStyle = vg; g.fillRect(0, 0, W * 0.6, H);
    if (intro < 1) { g.fillStyle = `rgba(0,0,0,${1 - intro})`; g.fillRect(0, 0, W, H); }
  }

  drawSchool(g, W, H, ground, ox, oy, t, fl, intro) {
    const narrow = W / H < 1.1;
    const x0 = W * (narrow ? 0.18 : 0.44) + ox, x1 = W * (narrow ? 1.05 : 1.02) + ox, top = H * 0.5 + oy, bw = x1 - x0, bh = ground - top;
    const sil = mix('#040706', '#34433e', fl * 0.7), rim = fl > 0.05 ? '#a9bcb4' : 'rgba(150,175,165,0.55)';
    // left wing
    g.fillStyle = sil; g.fillRect(x0 - bw * 0.22, top + bh * 0.25, bw * 0.24, bh * 0.75 + 2);
    g.beginPath(); g.moveTo(x0 - bw * 0.24, top + bh * 0.27); g.lineTo(x0 - bw * 0.1, top + bh * 0.1); g.lineTo(x0 + bw * 0.02, top + bh * 0.27); g.fill();
    // main block + roof
    g.fillRect(x0, top, bw, bh + 2);
    g.beginPath(); g.moveTo(x0 - bw * 0.02, top + 2); g.lineTo(x0 + bw * 0.12, top - bh * 0.22); g.lineTo(x1 - bw * 0.1, top - bh * 0.22); g.lineTo(x1 + bw * 0.02, top + 2); g.fill();
    // moonlight catching the roof edges (the moon is up and to the right)
    g.strokeStyle = rim; g.lineWidth = 1.6 * this.k; g.lineJoin = 'round';
    g.beginPath(); g.moveTo(x0 + bw * 0.12, top - bh * 0.22); g.lineTo(x1 - bw * 0.1, top - bh * 0.22); g.lineTo(x1 + bw * 0.02, top + 2); g.stroke();
    g.beginPath(); g.moveTo(x0 - bw * 0.1, top + bh * 0.1); g.lineTo(x0 + bw * 0.02, top + bh * 0.27); g.stroke();
    // the bell tower
    const tx = x0 + bw * 0.5, tw = bw * 0.085, tTop = top - bh * 1.05;
    g.fillStyle = sil; g.fillRect(tx - tw / 2, tTop, tw, top - tTop + 2);
    g.beginPath(); g.moveTo(tx - tw * 0.62, tTop + 2); g.lineTo(tx, tTop - bh * 0.42); g.lineTo(tx + tw * 0.62, tTop + 2); g.fill();
    g.beginPath(); g.moveTo(tx, tTop - bh * 0.42); g.lineTo(tx + tw * 0.62, tTop + 2); g.lineTo(tx + tw / 2, tTop + 2); g.lineTo(tx + tw / 2, top - bh * 0.22); g.stroke();
    // belfry opening with the bell swaying in it
    const ay = tTop + bh * 0.08, ah = bh * 0.34, aw = tw * 0.62;
    g.fillStyle = mix('#0d1714', '#53635e', fl); g.beginPath(); g.moveTo(tx - aw / 2, ay + ah); g.lineTo(tx - aw / 2, ay + aw / 2); g.arc(tx, ay + aw / 2, aw / 2, Math.PI, 0); g.lineTo(tx + aw / 2, ay + ah); g.fill();
    const sw = this.reduced ? 0 : Math.sin(t * 1.15) * 0.22;
    g.save(); g.translate(tx, ay + aw * 0.28); g.rotate(sw);
    const bwid = aw * 0.42, bht = ah * 0.5;
    g.fillStyle = mix('#5a4318', '#c9a24a', 0.25 + fl * 0.6);
    g.beginPath(); g.moveTo(-bwid * 0.35, 0); g.quadraticCurveTo(-bwid * 0.45, bht * 0.6, -bwid, bht); g.lineTo(bwid, bht); g.quadraticCurveTo(bwid * 0.45, bht * 0.6, bwid * 0.35, 0); g.closePath(); g.fill();
    g.fillStyle = 'rgba(201,162,74,0.55)'; g.fillRect(-bwid * 0.08, bht * 0.15, bwid * 0.06, bht * 0.7);
    g.restore();
    // the clock below the belfry, stopped at a quarter past three
    const cy = ay + ah + bh * 0.16, cr = tw * 0.3;
    g.fillStyle = mix('#c8c2a8', '#f0ead2', fl); g.globalAlpha = intro * 0.85; g.beginPath(); g.arc(tx, cy, cr, 0, 6.283); g.fill();
    g.strokeStyle = '#0a0d0c'; g.lineWidth = Math.max(1, cr * 0.12); g.beginPath(); g.moveTo(tx, cy); g.lineTo(tx + cr * 0.55, cy + cr * 0.05); g.moveTo(tx, cy); g.lineTo(tx + cr * 0.8, cy); g.stroke(); g.globalAlpha = intro;

    // windows light up one by one on load, then flicker
    const ww = bw * 0.034, wh = bh * 0.17;
    for (const w of this.wins) {
      const wx = x0 + bw * w.u, wy = top + bh * w.v - wh / 2;
      if (w.row === 2 && wx > x0) continue;
      w.lit += ((t > w.at && w.on ? 1 : 0) - w.lit) * Math.min(1, 0.016 * 6);
      let k = w.lit;
      if (w.fl && k > 0.5 && !this.reduced) { const n = Math.sin(t * 9 + w.ph) * Math.sin(t * 3.7 + w.ph * 2); if (n > 0.55) k *= 0.25; }
      g.fillStyle = mix('#0b1311', '#2a3834', fl);
      g.fillRect(wx, wy, ww, wh);
      if (k > 0.02) {
        g.fillStyle = w.warm ? `rgba(226,170,80,${0.85 * k})` : `rgba(140,180,190,${0.55 * k})`;
        g.fillRect(wx, wy, ww, wh);
        const halo = g.createRadialGradient(wx + ww / 2, wy + wh / 2, 0, wx + ww / 2, wy + wh / 2, ww * 2.2); halo.addColorStop(0, w.warm ? `rgba(226,170,80,${0.18 * k})` : `rgba(140,180,190,${0.12 * k})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = halo; g.fillRect(wx - ww * 2, wy - ww * 2, ww * 5, wh + ww * 4);
      }
      g.fillStyle = sil; g.fillRect(wx + ww / 2 - this.k, wy, 2 * this.k, wh); g.fillRect(wx, wy + wh * 0.45, ww, 2 * this.k); // window bars
    }
    // sometimes he is standing in one of the lit windows
    if (!this.reduced) {
      this.nextFigure -= 0.016;
      if (!this.figure && this.nextFigure <= 0 && t > 4) {
        const lit = this.wins.filter((w) => w.on && w.lit > 0.9 && w.row < 2);
        if (lit.length) this.figure = { w: lit[(Math.random() * lit.length) | 0], t: 0 };
        this.nextFigure = R(10, 18);
      }
      if (this.figure) {
        const f = this.figure; f.t += 0.016;
        const wx = x0 + bw * f.w.u, wy = top + bh * f.w.v - wh / 2, a = Math.min(1, f.t * 3, (1.8 - f.t) * 3);
        g.globalAlpha = Math.max(0, a) * intro; g.fillStyle = '#030404';
        g.fillRect(wx + ww * 0.32, wy + wh * 0.28, ww * 0.36, wh * 0.72); g.beginPath(); g.arc(wx + ww / 2, wy + wh * 0.22, ww * 0.16, 0, 6.283); g.fill();
        g.fillStyle = '#d0281c'; g.fillRect(wx + ww * 0.4, wy + wh * 0.2, ww * 0.06, ww * 0.06); g.fillRect(wx + ww * 0.54, wy + wh * 0.2, ww * 0.06, ww * 0.06);
        g.globalAlpha = intro;
        if (f.t > 1.8) this.figure = null;
      }
    }
    // the front gate
    const gx = x0 + bw * 0.42, gw = bw * 0.16, gh = bh * 0.34;
    g.fillStyle = '#030605'; g.fillRect(gx, ground - gh, gw, gh);
    g.strokeStyle = mix('#1a2622', '#53635e', fl); g.lineWidth = 1.5 * this.k; g.beginPath();
    for (let i = 0; i <= 10; i++) { const bx = gx + (gw * i) / 10; g.moveTo(bx, ground); g.lineTo(bx, ground - gh); }
    g.moveTo(gx, ground - gh * 0.55); g.lineTo(gx + gw, ground - gh * 0.55); g.stroke();
  }

  drawFence(g, W, H, ox, fl) {
    const base = H * 1.0, ht = H * 0.15, step = Math.max(14, W * 0.018);
    g.fillStyle = mix('#020303', '#1d2624', fl * 0.6); g.strokeStyle = g.fillStyle; g.lineWidth = Math.max(2, step * 0.14);
    g.fillRect(0, base - ht * 0.82, W, step * 0.18); g.fillRect(0, base - ht * 0.28, W, step * 0.18);
    for (let x = ((ox % step) + step) % step - step; x < W + step; x += step) {
      g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - ht); g.stroke();
      g.beginPath(); g.moveTo(x - step * 0.16, base - ht); g.lineTo(x, base - ht - step * 0.45); g.lineTo(x + step * 0.16, base - ht); g.fill();
    }
  }
}

function mix(a, b, k) {
  if (k <= 0) return a; if (k >= 1) return b;
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = ((pa >> 16) & 255) + ((((pb >> 16) & 255) - ((pa >> 16) & 255)) * k);
  const gg = ((pa >> 8) & 255) + ((((pb >> 8) & 255) - ((pa >> 8) & 255)) * k);
  const bl = (pa & 255) + (((pb & 255) - (pa & 255)) * k);
  return `rgb(${r | 0},${gg | 0},${bl | 0})`;
}
