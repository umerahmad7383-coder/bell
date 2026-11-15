// Proximity voice chat.
// Audio travels directly between players' browsers (WebRTC, peer-to-peer); the game server only
// passes the connection handshakes along. Each remote voice is played through a 3D panner placed
// on that player's body, so you hear people from where they are and lose them with distance.
// In the lobby, and for spectators, voices are plain (non-positional).
//
// Needs a secure page (https:// or localhost) and microphone permission.

const MAX_DIST = 22; // metres at which a voice has faded to nothing

export class Voice {
  constructor(socket, audio) {
    this.s = socket; this.audio = audio;
    this.peers = new Map();          // pid -> { pc, gain, flat, panner, lp, an, level, pending }
    this.enabled = false; this.muted = false; this.ptt = false; this.pttDown = false;
    this.level = 0; this.speaking = false; this.sendT = 0; this.onChange = null;
    socket.on('rtc', ({ from, data }) => this.onSignal(from, data).catch((e) => console.warn('[voice] signalling', e)));
    socket.on('voice:gone', ({ id }) => this.drop(id));
    socket.on('disconnect', () => this.disable(true));
  }

  static supported() { return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection); }

  async enable() {
    if (this.enabled) return;
    if (!Voice.supported()) throw new Error(window.isSecureContext ? 'This browser does not support voice chat.' : 'Voice chat needs a secure page (https://). It works on the deployed site and on localhost.');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    this.audio.init();
    const ctx = this.audio.ctx;
    this.micSrc = ctx.createMediaStreamSource(this.stream);
    this.an = ctx.createAnalyser(); this.an.fftSize = 512; this.buf = new Float32Array(this.an.fftSize);
    this.micSrc.connect(this.an);
    const r = await new Promise((res) => this.s.emit('voice:join', null, res));
    if (!r || !r.ok) { this.stopMic(); throw new Error('Could not join voice chat (not in a lobby?).'); }
    this.ice = r.ice; this.enabled = true;
    this.applyGate();
    for (const id of r.peers) this.connect(id, true); // the newcomer calls everyone already there
    this.onChange && this.onChange();
  }
  disable(silent) {
    if (!this.enabled) return;
    if (!silent) this.s.emit('voice:leave');
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.stopMic(); this.enabled = false; this.level = 0; this.speaking = false;
    this.onChange && this.onChange();
  }
  stopMic() { if (this.stream) for (const t of this.stream.getTracks()) t.stop(); this.stream = null; try { this.micSrc && this.micSrc.disconnect(); } catch { /* already gone */ } }

  /** is the microphone actually being sent right now? */
  get live() { return this.enabled && !this.muted && (!this.ptt || this.pttDown); }
  applyGate() { if (this.stream) for (const t of this.stream.getAudioTracks()) t.enabled = this.live; this.onChange && this.onChange(); }
  setMuted(v) { this.muted = v; this.applyGate(); }
  setPtt(mode) { this.ptt = mode; this.applyGate(); }
  setPttDown(v) { if (this.pttDown !== v) { this.pttDown = v; this.applyGate(); } }

  connect(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer = { id, pc, pending: [], level: 0 };
    this.peers.set(id, peer);
    for (const t of this.stream.getAudioTracks()) pc.addTrack(t, this.stream);
    pc.onicecandidate = (e) => { if (e.candidate) this.s.emit('rtc', { to: id, data: { ice: e.candidate } }); };
    pc.ontrack = (e) => this.attach(peer, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') console.warn('[voice] could not connect to player', id, '(strict network? a TURN server may be needed)'); this.onChange && this.onChange(); };
    if (initiator) (async () => { const offer = await pc.createOffer(); await pc.setLocalDescription(offer); this.s.emit('rtc', { to: id, data: { sdp: pc.localDescription } }); })().catch((e) => console.warn('[voice] offer', e));
    return peer;
  }
  async onSignal(from, data) {
    if (!this.enabled || !data) return;
    const peer = this.peers.get(from) || this.connect(from, false);
    const pc = peer.pc;
    if (data.sdp) {
      await pc.setRemoteDescription(data.sdp);
      for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
      if (data.sdp.type === 'offer') { const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); this.s.emit('rtc', { to: from, data: { sdp: pc.localDescription } }); }
    } else if (data.ice) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.ice).catch(() => {}); else peer.pending.push(data.ice);
    }
  }
  attach(peer, stream) {
    if (peer.src) return;
    const ctx = this.audio.ctx;
    // Chrome only feeds a remote stream into Web Audio if it is also attached to a media element
    peer.el = new Audio(); peer.el.srcObject = stream; peer.el.muted = true; peer.el.play().catch(() => {});
    peer.src = ctx.createMediaStreamSource(stream);
    peer.an = ctx.createAnalyser(); peer.an.fftSize = 256; peer.buf = new Float32Array(256);
    peer.lp = ctx.createBiquadFilter(); peer.lp.type = 'lowpass'; peer.lp.frequency.value = 20000;
    peer.gain = ctx.createGain(); peer.gain.gain.value = 0;   // positional path
    peer.flat = ctx.createGain(); peer.flat.gain.value = 1;   // plain path (lobby, spectators)
    peer.panner = ctx.createPanner(); peer.panner.panningModel = 'HRTF'; peer.panner.distanceModel = 'linear'; peer.panner.refDistance = 2; peer.panner.maxDistance = MAX_DIST; peer.panner.rolloffFactor = 1;
    peer.src.connect(peer.an);
    peer.src.connect(peer.lp); peer.lp.connect(peer.gain); peer.gain.connect(peer.panner); peer.panner.connect(this.audio.voiceOut || this.audio.master);
    peer.src.connect(peer.flat); peer.flat.connect(this.audio.voiceOut || this.audio.master);
    this.onChange && this.onChange();
  }
  drop(id) {
    const p = this.peers.get(id); if (!p) return;
    try { p.pc.close(); } catch { /* already closed */ }
    for (const n of [p.src, p.lp, p.gain, p.flat, p.panner]) try { n && n.disconnect(); } catch { /* fine */ }
    if (p.el) p.el.srcObject = null;
    this.peers.delete(id);
    this.onChange && this.onChange();
  }

  rms(an, buf) { an.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); }

  /**
   * Call every frame (or a few times a second in the lobby).
   * where(pid) -> null / {mode:'flat'}  plain voice
   *               {mode:'mute'}          cannot be heard (e.g. the dead, by the living)
   *               {mode:'spatial', x, y, z, clear}   positional; clear=false means a wall is in the way
   * report(level) is called a few times a second while you are audibly speaking (so the monster can hear).
   */
  frame(dt, where, report) {
    if (!this.enabled) return;
    const t = this.audio.ctx.currentTime;
    for (const p of this.peers.values()) {
      if (!p.src) continue;
      const w = where ? where(p.id) : null;
      const mode = w ? w.mode : 'flat';
      p.flat.gain.setTargetAtTime(mode === 'flat' ? 1 : 0, t, 0.08);
      p.gain.gain.setTargetAtTime(mode === 'spatial' ? (w.clear ? 1.25 : 0.6) : 0, t, 0.08);
      if (mode === 'spatial') {
        p.lp.frequency.setTargetAtTime(w.clear ? 20000 : 850, t, 0.1); // through a wall: quieter and muffled
        const pn = p.panner;
        if (pn.positionX) { pn.positionX.setTargetAtTime(w.x, t, 0.05); pn.positionY.setTargetAtTime(w.y, t, 0.05); pn.positionZ.setTargetAtTime(w.z, t, 0.05); } else pn.setPosition(w.x, w.y, w.z);
      }
      p.level = Math.min(1, this.rms(p.an, p.buf) * 6);
    }
    // your own microphone level
    const lvl = this.live ? Math.max(0, Math.min(1, (this.rms(this.an, this.buf) - 0.015) / 0.2)) : 0;
    this.level += (lvl - this.level) * Math.min(1, dt * 12);
    const speaking = this.level > 0.08;
    if (speaking !== this.speaking) { this.speaking = speaking; this.onChange && this.onChange(); }
    this.sendT -= dt;
    if (speaking && report && this.sendT <= 0) { this.sendT = 0.3; report(this.level); }
  }
  /** pids of everyone (including you as `me`) whose voice is currently audible */
  speakers(me) { const out = new Set(); if (this.speaking) out.add(me); for (const p of this.peers.values()) if (p.level > 0.06) out.add(p.id); return out; }
  connected() { let n = 0; for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++; return n; }
}
