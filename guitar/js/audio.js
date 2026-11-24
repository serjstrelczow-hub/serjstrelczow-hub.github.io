// Звук: общий AudioContext (на iOS запускается только после нажатия), эталон струны, тюнер, метроном
import { renderPluck, detectPitch } from './music.js';

let ctx = null;
export function audioCtx() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; ctx = new C(); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
// iOS: разблокировать звук на первом касании
function unlock() {
  const c = audioCtx();
  const b = c.createBuffer(1, 1, 22050); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
  window.removeEventListener('touchend', unlock, true); window.removeEventListener('click', unlock, true);
}
window.addEventListener('touchend', unlock, true); window.addEventListener('click', unlock, true);

// ---- Эталонный звук струны
export class StringPlayer {
  constructor() { this.cache = new Map(); this.src = null; this.timer = null; this.onChange = null; this.playingMidi = null; }
  buffer(freq) {
    const c = audioCtx(); const key = freq.toFixed(2) + '@' + c.sampleRate;
    if (!this.cache.has(key)) {
      const data = renderPluck(freq, c.sampleRate, 2.5);
      const b = c.createBuffer(1, data.length, c.sampleRate); b.copyToChannel(data, 0); this.cache.set(key, b);
    }
    return this.cache.get(key);
  }
  play(midi, freq, repeat) {
    this.stop(false);
    const c = audioCtx(); this.playingMidi = midi;
    const once = () => {
      const s = c.createBufferSource(); s.buffer = this.buffer(freq);
      const g = c.createGain(); g.gain.value = 0.9; s.connect(g).connect(c.destination); s.start();
      this.src = s;
      s.onended = () => { if (this.src === s && !repeat) { this.src = null; this.playingMidi = null; this.onChange?.(); } };
    };
    once();
    if (repeat) this.timer = setInterval(once, 2600);
    this.onChange?.();
  }
  stop(notify = true) {
    clearInterval(this.timer); this.timer = null;
    try { this.src?.stop(); } catch {}
    this.src = null; this.playingMidi = null; if (notify) this.onChange?.();
  }
  get playing() { return this.playingMidi != null; }
}

// ---- Тюнер: микрофон → AnalyserNode → YIN
export class TunerEngine {
  constructor(onPitch) { this.onPitch = onPitch; this.running = false; this.muted = false; this.history = []; }
  async start(testToneHz = 0) {
    const c = audioCtx(); await c.resume();
    this.analyser = c.createAnalyser(); this.analyser.fftSize = 4096;
    if (testToneHz > 0) {
      // Тестовый режим: синтетический щипок по кругу вместо микрофона
      const data = renderPluck(testToneHz, c.sampleRate, 2.5);
      const b = c.createBuffer(1, data.length, c.sampleRate); b.copyToChannel(data, 0);
      const s = c.createBufferSource(); s.buffer = b; s.loop = true; s.loopEnd = 1.2; s.connect(this.analyser); s.start();
      this.source = s;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      this.source = c.createMediaStreamSource(this.stream); this.source.connect(this.analyser);
    }
    this.buf = new Float32Array(this.analyser.fftSize);
    this.running = true; this.loop();
  }
  loop() {
    if (!this.running) return;
    if (!this.muted) {
      this.analyser.getFloatTimeDomainData(this.buf);
      const f = detectPitch(this.buf, this.analyser.context.sampleRate);
      if (f > 0) { this.history.push(f); if (this.history.length > 5) this.history.shift(); }
      else if (this.history.length) this.history.shift();
      const sorted = [...this.history].sort((a, b) => a - b);
      this.onPitch(sorted.length >= 2 ? sorted[sorted.length >> 1] : -1);
    }
    this.timer = setTimeout(() => this.loop(), 60);
  }
  stop() {
    this.running = false; clearTimeout(this.timer);
    try { this.source?.disconnect(); this.source?.stop?.(); } catch {}
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.history = [];
  }
}

// ---- Метроном с планированием на Web Audio
export class Metronome {
  constructor(onBeat) { this.bpm = 100; this.beats = 4; this.accent = true; this.onBeat = onBeat; this.running = false; }
  start() {
    const c = audioCtx(); this.running = true; this.beat = 0; this.next = c.currentTime + 0.08; this.tick();
  }
  tick() {
    if (!this.running) return;
    const c = audioCtx();
    while (this.next < c.currentTime + 0.12) {
      const b = this.beat, t = this.next, strong = this.accent && b === 0;
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = strong ? 1600 : 1000;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(strong ? 0.9 : 0.55, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.07);
      setTimeout(() => this.running && this.onBeat?.(b), Math.max(0, (t - c.currentTime) * 1000));
      this.next += 60 / this.bpm; this.beat = (this.beat + 1) % this.beats;
    }
    this.timer = setTimeout(() => this.tick(), 25);
  }
  stop() { this.running = false; clearTimeout(this.timer); this.onBeat?.(-1); }
}
