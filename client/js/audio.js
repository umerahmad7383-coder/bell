// All sound is synthesised live with the Web Audio API (no audio files).
// Positional sounds go through HRTF panners, so headphones tell you where things are.
const R = (a, b) => a + Math.random() * (b - a);

export class AudioSys {
  constructor() { this.ctx = null; this.volume = 0.8; this.threat = 0; this.hbT = 0; this.monsterGain = null; this.lpos = { x: 0, y: 0, z: 0 }; this.lyaw = 0; this.ambT = 6; this.chaseK = 0; this.chaseT = 0; this.beat = 0; this.croakT = 5; }

  /** Must be called from a user gesture (browser autoplay rules). */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    // everything passes through one low-pass, closed down when you are hurt so the world goes muffled
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000;
    this.master.connect(this.lp); this.lp.connect(comp); comp.connect(ctx.destination);
    // cheap "empty building" reverb: two feedback delays behind a low-pass
    this.wet = ctx.createGain(); this.wet.gain.value = 0.35;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    this.wet.connect(lp);
    for (const [time, fb] of [[0.113, 0.42], [0.187, 0.36], [0.271, 0.3]]) {
      const d = ctx.createDelay(1); d.delayTime.value = time; const g = ctx.createGain(); g.gain.value = fb;
      lp.connect(d); d.connect(g); g.connect(d); d.connect(this.master);
    }
    // noise sources
    const len = ctx.sampleRate * 2;
    this.white = ctx.createBuffer(1, len, ctx.sampleRate); this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
    this.loops = {};
  }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  get ok() { return !!this.ctx; }
  get now() { return this.ctx.currentTime; }

  setListener(p, yaw) {
    if (!this.ctx) return;
    this.lpos = { x: p.x, y: p.y, z: p.z }; this.lyaw = yaw;
    const l = this.ctx.listener, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (l.positionX) { l.positionX.value = p.x; l.positionY.value = p.y; l.positionZ.value = p.z; l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0; }
    else { l.setPosition(p.x, p.y, p.z); l.setOrientation(fx, 0, fz, 0, 1, 0); }
  }

  // ---- building blocks ----
  out(pos, wet = 0.5) {
    const ctx = this.ctx, g = ctx.createGain();
    if (pos) {
      const p = ctx.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 2.2; p.rolloffFactor = 1.5; p.maxDistance = 60;
      const a = Array.isArray(pos) ? pos : [pos.x, pos.y, pos.z];
      if (p.positionX) { p.positionX.value = a[0]; p.positionY.value = a[1]; p.positionZ.value = a[2]; } else p.setPosition(a[0], a[1], a[2]);
      g.connect(p); p.connect(this.master);
      if (wet) { const s = ctx.createGain(); s.gain.value = wet; p.connect(s); s.connect(this.wet); }
      g._panner = p;
    } else g.connect(this.master);
    return g;
  }
  noise({ dur = 0.2, type = 'lowpass', freq = 800, q = 1, gain = 0.5, attack = 0.005, pos = null, brown = false, when = 0, rate = 1, sweep = 0, wet = 0.5 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = brown ? this.brown : this.white; src.playbackRate.value = rate; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, freq * sweep), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out(pos, wet));
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }
  tone({ freq = 220, to = 0, dur = 0.3, type = 'sine', gain = 0.3, attack = 0.005, pos = null, when = 0, wet = 0.5, vibrato = 0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    if (vibrato) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 6 + Math.random() * 3; lg.gain.value = vibrato; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.1); }
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.out(pos, wet));
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---- continuous beds ----
  startAmbience() {
    if (!this.ctx || this.loops.rain) return;
    const ctx = this.ctx;
    const loop = (buf, type, freq, q, gain) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = ctx.createGain(); g.gain.value = gain; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { s, f, g }; };
    this.loops.rain = loop(this.white, 'bandpass', 1400, 0.4, 0.035);
    this.loops.wind = loop(this.brown, 'lowpass', 300, 0.5, 0.12);
    const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 0.07; lfo.connect(lg); lg.connect(this.loops.wind.g.gain); lfo.start();
    // low, slightly detuned drone
    const dg = ctx.createGain(); dg.gain.value = 0.05; dg.connect(this.master);
    const df = ctx.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 160; df.connect(dg);
    this.loops.drone = [43.6, 46.2, 65.1].map((fq) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq; o.connect(df); o.start(); return o; });
    this.loops.droneGain = dg;
    // sub-bass rumble you feel more than hear, and a cold, slowly beating cluster of voices over it
    this.loops.rumble = loop(this.brown, 'lowpass', 55, 0.7, 0.5);
    const pg = ctx.createGain(); pg.gain.value = 0.5; pg.connect(this.wet); const pd = ctx.createGain(); pd.gain.value = 0.25; pg.connect(pd); pd.connect(this.master);
    for (const [fq, rate] of [[110, 0.05], [116.5, 0.07], [164.8, 0.043], [174.6, 0.061], [233.1, 0.036], [329.6, 0.029]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = fq;
      const g = ctx.createGain(); g.gain.value = 0.012;
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = rate; lg.gain.value = 0.012; l.connect(lg); lg.connect(g.gain); l.start();
      o.connect(g); g.connect(pg); o.start();
    }
    this.loops.pad = pg;
    // static that rises when the Headmaster is close
    this.loops.static = loop(this.white, 'highpass', 2500, 0.5, 0);
    // mains hum once the power is on
    const hg = ctx.createGain(); hg.gain.value = 0; hg.connect(this.master);
    for (const fq of [100, 200.5]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq; const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400; o.connect(f); f.connect(hg); o.start(); }
    this.loops.hum = hg;
    // the monster: breathing (filtered noise) + a throat growl, positioned in 3D
    const mg = (this.monsterGain = this.out([0, 0, 0], 0.6)); mg.gain.value = 0;
    const br = ctx.createBufferSource(); br.buffer = this.brown; br.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 420; bf.Q.value = 1.6;
    const bg = ctx.createGain(); bg.gain.value = 0.5;
    const bl = ctx.createOscillator(), blg = ctx.createGain(); bl.frequency.value = 0.38; blg.gain.value = 0.45; bl.connect(blg); blg.connect(bg.gain); bl.start();
    br.connect(bf); bf.connect(bg); bg.connect(mg); br.start();
    const gr = ctx.createOscillator(); gr.type = 'sawtooth'; gr.frequency.value = 41;
    const gf = ctx.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 240;
    const gg = ctx.createGain(); gg.gain.value = 0.35;
    const gl = ctx.createOscillator(), glg = ctx.createGain(); gl.frequency.value = 11; glg.gain.value = 0.3; gl.connect(glg); glg.connect(gg.gain); gl.start();
    gr.connect(gf); gf.connect(gg); gg.connect(mg); gr.start();
    this.loops.growl = gr; this.loops.breathRate = bl;
  }
  stopAmbience() {
    if (!this.ctx) return;
    for (const k of ['rain', 'wind', 'static', 'rumble']) if (this.loops[k]) this.loops[k].g.gain.value = 0;
    if (this.loops.pad) this.loops.pad.gain.value = 0;
    if (this.lp) this.lp.frequency.value = 20000;
    if (this.loops.droneGain) this.loops.droneGain.gain.value = 0;
    if (this.loops.hum) this.loops.hum.gain.value = 0;
    if (this.monsterGain) this.monsterGain.gain.value = 0;
    this.muted = true;
  }
  resumeAmbience() {
    if (!this.ctx || !this.loops.rain) return this.startAmbience();
    this.loops.rain.g.gain.value = 0.035; this.loops.wind.g.gain.value = 0.12; this.loops.droneGain.gain.value = 0.05; this.loops.rumble.g.gain.value = 0.5; this.loops.pad.gain.value = 0.5; this.muted = false;
  }

  /** Called every frame. threat 0..1, monster {x,y,z,state,speed,d} or null, muffle = low-pass cutoff in Hz. */
  update(dt, threat, monster, power, muffle = 20000) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    this.lp.frequency.setTargetAtTime(muffle, t, 0.25);
    // the building is never quiet: something far off every few seconds
    this.ambT -= dt;
    if (this.ambT <= 0) { this.ambT = 5 + Math.random() * 11; this.randomAmbient(); }
    // chase: a pounding pulse with shrill stabs over it, fading in and out with the pursuit
    const chasing = !!monster && (monster.state === 3 || monster.state === 4) && monster.d < 34;
    this.chaseK += ((chasing ? 1 : 0) - this.chaseK) * Math.min(1, dt * (chasing ? 5 : 0.7));
    if (this.chaseK > 0.08) {
      this.chaseT -= dt;
      if (this.chaseT <= 0) {
        this.chaseT = 0.34; this.beat++;
        const g = this.chaseK;
        this.tone({ freq: 60, to: 34, dur: 0.24, gain: 0.85 * g, wet: 0.1 }); this.noise({ dur: 0.05, freq: 220, gain: 0.55 * g, wet: 0 });
        if (this.beat % 2 === 0) for (const f of [932, 988, 1397]) this.tone({ freq: f, to: f * 1.03, dur: 0.17, type: 'sawtooth', gain: 0.04 * g, wet: 0.9 });
        if (this.beat % 8 === 7) this.noise({ dur: 0.6, type: 'bandpass', freq: 500, q: 1, gain: 0.35 * g, sweep: 5, attack: 0.5, wet: 0.6 });
      }
    }
    // close, but not hunting yet: that clicking in its throat
    if (monster && monster.d < 11 && monster.state !== 3 && monster.state !== 4 && monster.state !== 6) {
      this.croakT -= dt;
      if (this.croakT <= 0) { this.croakT = 3.5 + Math.random() * 4; this.croak([monster.x, monster.y + 1.9, monster.z]); }
    }
    this.loops.static.g.gain.setTargetAtTime(threat * threat * 0.07, t, 0.1);
    this.loops.droneGain.gain.setTargetAtTime(0.045 + threat * 0.07, t, 0.5);
    this.loops.hum.gain.setTargetAtTime(power ? 0.006 : 0, t, 0.5);
    if (monster && this.monsterGain) {
      const p = this.monsterGain._panner;
      if (p.positionX) { p.positionX.setTargetAtTime(monster.x, t, 0.05); p.positionY.setTargetAtTime(monster.y + 1.8, t, 0.05); p.positionZ.setTargetAtTime(monster.z, t, 0.05); } else p.setPosition(monster.x, monster.y + 1.8, monster.z);
      const chase = monster.state === 3 || monster.state === 4;
      this.monsterGain.gain.setTargetAtTime(monster.state === 6 ? 0.05 : chase ? 1.5 : 0.75, t, 0.3);
      this.loops.growl.frequency.setTargetAtTime(chase ? 58 : 41, t, 0.3);
      this.loops.breathRate.frequency.setTargetAtTime(chase ? 1.3 : 0.38, t, 0.3);
    }
    // heartbeat speeds up with threat
    if (threat > 0.12) {
      this.hbT -= dt;
      if (this.hbT <= 0) {
        this.hbT = 1.05 - threat * 0.62;
        const g = 0.25 + threat * 0.45;
        this.tone({ freq: 62, to: 38, dur: 0.16, gain: g, wet: 0 }); this.tone({ freq: 55, to: 34, dur: 0.18, gain: g * 0.7, when: 0.17, wet: 0 });
      }
    }
  }

  /** a point `d` metres from the listener in a random direction */
  near(min, max) { const a = Math.random() * 6.283, d = R(min, max); return [this.lpos.x + Math.cos(a) * d, this.lpos.y, this.lpos.z + Math.sin(a) * d]; }
  randomAmbient() {
    const p = this.near(9, 24);
    switch ((Math.random() * 7) | 0) {
      case 0: this.groan(p); break;
      case 1: for (let i = 0; i < (2 + Math.random() * 3 | 0); i++) { this.tone({ freq: R(140, 200), dur: 0.25, gain: 0.5, pos: p, when: i * R(0.35, 0.7), wet: 1.2 }); this.noise({ dur: 0.04, type: 'bandpass', freq: 1500, q: 3, gain: 0.4, pos: p, when: i * 0.5 }); } break; // pipes knocking
      case 2: this.tone({ freq: R(210, 320), to: R(330, 520), dur: R(0.9, 1.8), type: 'sawtooth', gain: 0.035, pos: p, vibrato: 22, wet: 1.2 }); break;  // a hinge somewhere
      case 3: for (let i = 0; i < 4; i++) this.tone({ freq: 1900, to: 700, dur: 0.07, gain: 0.12, pos: this.near(3, 8), when: i * R(0.6, 1.1), wet: 1.3 }); break; // dripping
      case 4: this.moan(p); break;
      case 5: this.noise({ dur: 2.6, type: 'bandpass', freq: 380, q: 0.7, gain: 0.25, pos: p, attack: 1.2, sweep: 1.8, wet: 1 }); break;                       // a draught moving through
      default: this.noise({ dur: 0.5, freq: 260, gain: 0.7, pos: p, wet: 1.4 }); this.tone({ freq: 62, to: 40, dur: 0.4, gain: 0.5, pos: p, wet: 1 });         // a door, far away
    }
  }
  groan(pos) {
    this.tone({ freq: R(52, 64), to: R(40, 47), dur: 3, type: 'sawtooth', gain: 0.22, pos, vibrato: 3, attack: 0.8, wet: 1.3 });
    this.tone({ freq: R(170, 200), to: R(140, 160), dur: 2.2, type: 'sawtooth', gain: 0.03, pos, vibrato: 45, attack: 0.5, wet: 1.3 });
  }
  /** something that used to be a voice */
  moan(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = R(2.2, 3.4), f0 = R(92, 130);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.12, t + dur * 0.4); o.frequency.linearRampToValueAtTime(f0 * 0.8, t + dur);
    const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5; lg.gain.value = 3; l.connect(lg); lg.connect(o.frequency);
    const out = this.out(pos, 1.4);
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.5, t + dur * 0.35); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [ff, q, g] of [[520, 6, 1], [1150, 8, 0.45], [2500, 9, 0.15]]) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = ff; f.Q.value = q; const fg = ctx.createGain(); fg.gain.value = g; o.connect(f); f.connect(fg); fg.connect(env); }
    env.connect(out); o.start(t); l.start(t); o.stop(t + dur + 0.1); l.stop(t + dur + 0.1);
  }
  /** dry clicks in a throat, speeding up and slowing down */
  croak(pos) {
    let when = 0;
    const n = 12 + (Math.random() * 8 | 0);
    for (let i = 0; i < n; i++) {
      const k = Math.sin((i / n) * Math.PI);
      this.noise({ dur: 0.028, type: 'bandpass', freq: R(900, 1500), q: 7, gain: 0.9, pos, when, wet: 0.9 });
      this.tone({ freq: R(80, 110), dur: 0.03, gain: 0.5, pos, when, wet: 0.5 });
      when += 0.13 - k * 0.085;
    }
  }
  /** a child's music box winding down, somewhere close */
  musicBox(pos) {
    const scale = [659.3, 587.3, 523.3, 493.9, 440, 392, 349.2, 329.6]; // descending minor
    const motif = [0, 2, 4, 2, 0, 2, 4, 7, 5, 4, 2, 4, 0];
    let when = 0, gap = 0.34;
    for (let i = 0; i < motif.length; i++) {
      const f = scale[motif[i]] * (1 + R(-0.012, 0.012)) * (i > 8 ? 1 - (i - 8) * 0.012 : 1); // goes flat as the spring runs out
      this.tone({ freq: f, dur: 1.5, gain: 0.16, pos, when, attack: 0.003, wet: 1.4 }); this.tone({ freq: f * 3.01, dur: 0.5, gain: 0.04, pos, when, attack: 0.003, wet: 1.4 });
      when += gap; gap *= i > 7 ? 1.22 : 1.0;
    }
  }
  /** the school bell, far off and wrong */
  schoolBell(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 3.2;
    const out = this.out(pos, 1.6);
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.5, t + 0.05); env.gain.setValueAtTime(0.5, t + dur * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const am = ctx.createGain(); am.gain.value = 0.5; const hammer = ctx.createOscillator(); hammer.type = 'square'; hammer.frequency.setValueAtTime(15, t); hammer.frequency.linearRampToValueAtTime(7, t + dur);
    const hg = ctx.createGain(); hg.gain.value = 0.5; hammer.connect(hg); hg.connect(am.gain);
    for (const f of [690, 1105, 1760, 2390]) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.86, t + dur); const g = ctx.createGain(); g.gain.value = 0.2; o.connect(g); g.connect(am); o.start(t); o.stop(t + dur + 0.1); }
    am.connect(env); env.connect(out); hammer.start(t); hammer.stop(t + dur + 0.1);
  }
  /** breathing, directly behind your head */
  breathBehind() {
    const fx = -Math.sin(this.lyaw), fz = -Math.cos(this.lyaw);
    const pos = [this.lpos.x - fx * 0.45, this.lpos.y - 0.05, this.lpos.z - fz * 0.45];
    for (let i = 0; i < 3; i++) {
      this.noise({ dur: 1.0, type: 'bandpass', freq: 620, q: 1.4, gain: 0.5, pos, when: i * 1.9, attack: 0.45, wet: 0.2 });        // in
      this.noise({ dur: 1.2, type: 'bandpass', freq: 900, q: 1.1, gain: 0.7, pos, when: i * 1.9 + 0.85, attack: 0.3, wet: 0.2 });  // out, on your neck
    }
  }
  /** what he does when he sees you */
  roar(pos) {
    if (!this.ctx) return;
    this.ensureShaper();
    const ctx = this.ctx, t = ctx.currentTime, dur = 1.5;
    const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(0.7, t + 0.06); env.gain.exponentialRampToValueAtTime(0.0001, t + dur); env.connect(this.shaper);
    for (const f of [74, 111, 149]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 1.5, t); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + dur); const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 27; lg.gain.value = f * 0.2; l.connect(lg); lg.connect(o.frequency); const g = ctx.createGain(); g.gain.value = 0.3; o.connect(g); g.connect(env); o.start(t); l.start(t); o.stop(t + dur + 0.1); l.stop(t + dur + 0.1); }
    this.noise({ dur: 1.2, type: 'bandpass', freq: 700, q: 0.8, gain: 0.8, pos, sweep: 0.4, wet: 0.8 });
  }
  lockerBang(pos) { for (let i = 0; i < 4; i++) { const w = i * R(0.22, 0.4); this.noise({ dur: 0.16, type: 'bandpass', freq: R(500, 900), q: 2, gain: 1.6, pos, when: w, wet: 1 }); this.tone({ freq: 95, to: 50, dur: 0.18, gain: 1.1, pos, when: w }); } }
  blackoutHit() { this.tone({ freq: 46, dur: 2.6, gain: 0.9, attack: 0.02, wet: 0.2 }); this.noise({ dur: 0.25, type: 'highpass', freq: 3500, gain: 0.3, wet: 0 }); this.tone({ freq: 2793, to: 2850, dur: 2.4, gain: 0.025, attack: 0.6, wet: 1 }); }
  ensureShaper() {
    if (this.shaper) return;
    const ctx = this.ctx; // hard clipping makes it harsh instead of merely loud
    this.shaper = ctx.createWaveShaper();
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 6); }
    this.shaper.curve = curve; this.shaper.oversample = '2x';
    const g = ctx.createGain(); g.gain.value = 0.8; this.shaper.connect(g); g.connect(this.master);
    const w = ctx.createGain(); w.gain.value = 0.3; g.connect(w); w.connect(this.wet);
  }

  // ---- one-shots ----
  footstep(vol = 1, pos = null, heavy = false) {
    this.noise({ dur: heavy ? 0.22 : 0.09, freq: heavy ? 260 : R(380, 620), gain: (heavy ? 0.9 : 0.16) * vol, pos, wet: heavy ? 0.7 : 0.3 });
    this.tone({ freq: heavy ? 52 : 85, to: 35, dur: heavy ? 0.22 : 0.07, gain: (heavy ? 0.8 : 0.12) * vol, pos, wet: 0.2 });
  }
  click() { this.noise({ dur: 0.03, type: 'highpass', freq: 2500, gain: 0.25, wet: 0 }); }
  ui() { this.tone({ freq: 520, dur: 0.05, gain: 0.08, wet: 0 }); }
  pickup() { this.tone({ freq: 740, dur: 0.07, gain: 0.14, wet: 0 }); this.tone({ freq: 1110, dur: 0.1, gain: 0.12, when: 0.06, wet: 0 }); }
  deny() { this.tone({ freq: 150, dur: 0.14, type: 'square', gain: 0.06, wet: 0 }); }
  doorOpen(pos) { this.tone({ freq: R(170, 230), to: R(300, 420), dur: 0.55, type: 'sawtooth', gain: 0.06, pos, vibrato: 14 }); this.noise({ dur: 0.12, freq: 900, gain: 0.25, pos }); }
  doorClose(pos, slam = false) {
    this.noise({ dur: slam ? 0.6 : 0.22, freq: slam ? 320 : 500, gain: slam ? 1.6 : 0.5, pos, wet: slam ? 1 : 0.5 });
    this.tone({ freq: slam ? 70 : 95, to: 38, dur: slam ? 0.5 : 0.15, gain: slam ? 1.2 : 0.35, pos });
  }
  shelf(pos) { this.noise({ dur: 1.3, freq: 180, gain: 0.9, brown: true, pos, attack: 0.2 }); this.tone({ freq: 48, dur: 1.2, gain: 0.5, pos, attack: 0.2 }); }
  gate(pos) { this.tone({ freq: 140, to: 420, dur: 1.6, type: 'sawtooth', gain: 0.1, pos, vibrato: 30 }); this.noise({ dur: 1.4, type: 'bandpass', freq: 900, q: 3, gain: 0.3, pos }); this.clang(pos, 0.6); }
  thunder(dist = 0.5) {
    const d = 0.3 + dist * 2.2;
    if (dist < 0.4) this.noise({ dur: 0.25, type: 'highpass', freq: 1200, gain: 0.5, when: d, wet: 0.6 });
    this.noise({ dur: 4.5, freq: 220, gain: 1.4 - dist * 0.6, brown: true, when: d, attack: 0.08, sweep: 0.3, wet: 0.4 });
    this.noise({ dur: 3, freq: 90, gain: 1.2, brown: true, when: d + 0.6, attack: 0.4, wet: 0.2 });
  }
  whisper(pos) {
    for (let i = 0; i < 9; i++) this.noise({ dur: R(0.08, 0.22), type: 'bandpass', freq: R(1800, 3600), q: 5, gain: R(0.25, 0.6), pos, when: i * R(0.13, 0.2), attack: 0.03, wet: 0.9 });
  }
  scream(pos) {
    this.tone({ freq: R(520, 640), to: R(820, 980), dur: 0.5, type: 'sawtooth', gain: 0.22, pos, vibrato: 25, wet: 1.2 });
    this.tone({ freq: 900, to: 380, dur: 1.4, type: 'sawtooth', gain: 0.2, pos, when: 0.45, vibrato: 40, wet: 1.2 });
    this.noise({ dur: 1.6, type: 'bandpass', freq: 1500, q: 2, gain: 0.25, pos, attack: 0.3, wet: 1.2 });
  }
  clang(pos, vol = 1) { for (const f of [311, 523, 811, 1234, 1687]) this.tone({ freq: f * R(0.98, 1.02), dur: R(0.8, 1.8), gain: 0.16 * vol, pos, wet: 1 }); this.noise({ dur: 0.08, type: 'highpass', freq: 2000, gain: 0.5 * vol, pos }); }
  knock(pos) { for (let i = 0; i < 3; i++) { this.tone({ freq: 110, to: 60, dur: 0.12, gain: 0.9, pos, when: i * 0.32 }); this.noise({ dur: 0.07, freq: 500, gain: 0.5, pos, when: i * 0.32 }); } }
  steps(pos) { for (let i = 0; i < 6; i++) this.noise({ dur: 0.16, freq: 300, gain: 0.9, pos, when: i * 0.47, wet: 1 }); }
  fall(pos) { for (let i = 0; i < 5; i++) { this.noise({ dur: 0.07, type: 'bandpass', freq: R(900, 2400), q: 2, gain: 1.0 / (i + 1), pos, when: i * R(0.09, 0.16) + i * 0.05 }); this.tone({ freq: R(300, 700), dur: 0.08, gain: 0.3 / (i + 1), pos, when: i * 0.14 }); } }
  bell(pos) { for (const w of [0, 0.38]) for (const [f, g, d] of [[1046, 0.35, 2.2], [2637, 0.18, 1.4], [4186, 0.1, 0.9], [1568, 0.12, 1.8]]) this.tone({ freq: f, dur: d, gain: g, pos, when: w, wet: 1 }); }
  smash(pos) { this.noise({ dur: 0.35, type: 'highpass', freq: 3200, gain: 1.4, pos, wet: 0.9 }); for (let i = 0; i < 7; i++) this.tone({ freq: R(2200, 6500), dur: R(0.05, 0.3), gain: 0.14, pos, when: R(0, 0.25) }); }
  throwWhoosh() { this.noise({ dur: 0.3, type: 'bandpass', freq: 700, q: 1.5, gain: 0.2, sweep: 2.5, attack: 0.1, wet: 0 }); }
  fuse(pos) { this.noise({ dur: 0.12, type: 'highpass', freq: 4000, gain: 0.7, pos }); this.tone({ freq: 90, dur: 0.12, gain: 0.5, pos }); this.tone({ freq: 2400, to: 300, dur: 0.1, type: 'square', gain: 0.1, pos, when: 0.03 }); }
  powerUp() {
    this.tone({ freq: 48, dur: 0.9, gain: 1.0, wet: 0.8 }); this.noise({ dur: 0.3, freq: 300, gain: 1.2, wet: 1 });
    this.tone({ freq: 60, to: 120, dur: 2.4, type: 'sawtooth', gain: 0.12, attack: 1.2, when: 0.2, wet: 0.5 });
    for (let i = 0; i < 10; i++) this.noise({ dur: 0.05, type: 'highpass', freq: 5000, gain: 0.3, when: 0.4 + i * R(0.08, 0.2), wet: 0.3 });
  }
  security() { for (let i = 0; i < 3; i++) this.tone({ freq: 880, dur: 0.12, type: 'square', gain: 0.07, when: i * 0.18, wet: 0.3 }); this.tone({ freq: 1320, dur: 0.4, type: 'square', gain: 0.07, when: 0.6, wet: 0.3 }); }
  rattle(pos) { for (let i = 0; i < 9; i++) this.noise({ dur: 0.07, type: 'bandpass', freq: R(600, 1100), q: 3, gain: 1.1, pos, when: i * R(0.07, 0.12) }); }
  hit() {
    this.noise({ dur: 0.3, freq: 400, gain: 1.6, wet: 0.3 }); this.tone({ freq: 70, to: 30, dur: 0.4, gain: 1.2, wet: 0 });
    this.tone({ freq: 3300, dur: 2.6, gain: 0.05, attack: 0.1, wet: 0 });
  }
  stinger(kind) {
    if (kind === 'chase') {
      for (const f of [110, 116.5, 155.6, 233]) this.tone({ freq: f, to: f * 1.06, dur: 2.6, type: 'sawtooth', gain: 0.085, attack: 0.03, wet: 0.8 });
      this.noise({ dur: 1.8, type: 'bandpass', freq: 500, q: 0.8, gain: 0.4, attack: 0.02, sweep: 3, wet: 0.6 });
    } else if (kind === 'stalk') {
      this.tone({ freq: 36, dur: 3.5, gain: 0.8, attack: 1.2, wet: 0.3 });
      this.tone({ freq: 2093, to: 2140, dur: 3, gain: 0.02, attack: 1.5, wet: 1 });
    } else if (kind === 'lost') {
      this.tone({ freq: 196, to: 98, dur: 2, type: 'triangle', gain: 0.08, attack: 0.3, wet: 1 });
    }
  }
  ping(pos, help) {
    if (help) { this.tone({ freq: 620, to: 380, dur: 0.7, type: 'sawtooth', gain: 0.22, pos, vibrato: 28, wet: 1 }); this.noise({ dur: 0.6, type: 'bandpass', freq: 1300, q: 2, gain: 0.2, pos, attack: 0.1 }); return; }
    this.tone({ freq: 1320, dur: 0.09, gain: 0.16, pos, wet: 0.4 }); this.tone({ freq: 1760, dur: 0.16, gain: 0.14, pos, when: 0.09, wet: 0.4 });
  }
  pant() { this.noise({ dur: 0.28, type: 'bandpass', freq: 900, q: 1.2, gain: 0.11, attack: 0.09, wet: 0 }); this.noise({ dur: 0.22, type: 'bandpass', freq: 600, q: 1.2, gain: 0.07, attack: 0.08, when: 0.3, wet: 0 }); }
  beep() { this.tone({ freq: 980, dur: 0.08, type: 'square', gain: 0.05, wet: 0 }); this.tone({ freq: 980, dur: 0.08, type: 'square', gain: 0.05, when: 0.16, wet: 0 }); }
  /** Jumpscare: silence for a heartbeat, then a human scream torn apart by distortion. long = the hit that puts you down. */
  jumpscare(long = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.02, dur = long ? 1.6 : 1.05;
    // LOUDNESS: the scream has its own path straight to the speakers. It skips the master volume
    // stage and the compressor (which exists precisely to stop things being this loud), is clipped
    // to full scale, and everything else is ducked underneath it. The volume slider still scales it.
    if (!this.scareBus) {
      const sh = ctx.createWaveShaper(); const n = 2048, curve = new Float32Array(n);
      for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 9); }
      sh.curve = curve; sh.oversample = '2x';
      this.scareOut = ctx.createGain(); sh.connect(this.scareOut); this.scareOut.connect(ctx.destination);
      this.scareBus = sh;
    }
    this.scareOut.gain.value = Math.min(1, 0.3 + this.volume * 0.9);
    this.master.gain.cancelScheduledValues(t); this.master.gain.setValueAtTime(this.volume * 0.2, t); this.master.gain.setValueAtTime(this.volume * 0.2, t + dur * 0.8); this.master.gain.linearRampToValueAtTime(this.volume, t + dur + 0.6);
    const env = ctx.createGain(); env.connect(this.scareBus);
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(2.2, t + 0.008); env.gain.setValueAtTime(2.2, t + dur * 0.65); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    // a full-scale sub drop on the same loud path
    const sub = ctx.createOscillator(), sg = ctx.createGain(); sub.frequency.setValueAtTime(72, t); sub.frequency.exponentialRampToValueAtTime(30, t + 0.5); sg.gain.setValueAtTime(1.2, t); sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6); sub.connect(sg); sg.connect(env); sub.start(t); sub.stop(t + 0.65);
    // 1) the scream itself: a voice (sawtooth through vowel formants) that cracks upward and breaks
    const v = ctx.createOscillator(); v.type = 'sawtooth';
    v.frequency.setValueAtTime(520, t); v.frequency.exponentialRampToValueAtTime(1180, t + 0.09); v.frequency.setValueAtTime(1180, t + dur * 0.45); v.frequency.exponentialRampToValueAtTime(640, t + dur);
    const vl = ctx.createOscillator(), vlg = ctx.createGain(); vl.frequency.value = 31; vlg.gain.value = 140; vl.connect(vlg); vlg.connect(v.frequency);
    for (const [ff, q, g] of [[1050, 4, 1.0], [1750, 5, 0.8], [3100, 6, 0.6]]) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = ff; f.Q.value = q; const fg = ctx.createGain(); fg.gain.value = g; v.connect(f); f.connect(fg); fg.connect(env); }
    v.start(t); vl.start(t); v.stop(t + dur + 0.05); vl.stop(t + dur + 0.05);
    // 2) a dissonant cluster under it that jumps up, then sags
    for (const f of [392, 421, 587, 803, 1190]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; g.gain.value = 0.2;
      o.frequency.setValueAtTime(f * 0.6, t); o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.07); o.frequency.exponentialRampToValueAtTime(f * 1.2, t + dur);
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 19 + Math.random() * 14; lg.gain.value = f * 0.09; l.connect(lg); lg.connect(o.frequency);
      o.connect(g); g.connect(env); o.start(t); l.start(t); o.stop(t + dur + 0.05); l.stop(t + dur + 0.05);
    }
    // 3) breath and tearing noise
    const n = ctx.createBufferSource(); n.buffer = this.white; n.loop = true;
    const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.setValueAtTime(900, t); nf.frequency.exponentialRampToValueAtTime(4200, t + 0.1); nf.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.9; n.connect(nf); nf.connect(ng); ng.connect(env); n.start(t); n.stop(t + dur + 0.05);
    // 4) the blow to the chest, and the ringing afterwards
    this.tone({ freq: 64, to: 26, dur: 0.7, gain: 1.6, wet: 0 }); this.noise({ dur: 0.14, freq: 300, gain: 1.6, wet: 0.2 });
    this.tone({ freq: 3400, dur: 3.5, gain: 0.045, attack: 0.3, when: dur * 0.7, wet: 0 });
  }
  heal() { this.tone({ freq: 440, to: 660, dur: 0.5, type: 'triangle', gain: 0.12, wet: 0.4 }); }
  endJingle(win) {
    const notes = win ? [392, 494, 587, 784] : [220, 208, 185, 147];
    notes.forEach((f, i) => this.tone({ freq: f, dur: win ? 0.9 : 1.6, type: 'triangle', gain: 0.14, when: i * (win ? 0.22 : 0.5), wet: 1 }));
    if (win) this.bell(null); else this.tone({ freq: 41, dur: 4, gain: 0.7, attack: 0.5, wet: 0.3 });
  }
}
