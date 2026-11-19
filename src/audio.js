// All five starting materials are original, deterministic PCM sketches.
// Buffers are retained independently of circle positions and undo history.
export function seedSamples(kind, sampleRate = 44100) {
  const durations = [.24, 1.1, .72, .5, .8];
  const samples = new Float32Array(Math.round(durations[kind] * sampleRate));
  let noiseState = 417 + kind * 103, smooth = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate;
    noiseState = (Math.imul(noiseState, 1664525) + 1013904223) | 0;
    const noise = (noiseState >>> 0) / 2147483648 - 1;
    smooth = smooth * .92 + noise * .08;
    let value = 0;
    if (kind === 0) value = (Math.sin(2 * Math.PI * 178 * t) * .7 + noise * .3) * Math.exp(-t * 32);
    if (kind === 1) value = (Math.sin(2 * Math.PI * 620 * t) + .34 * Math.sin(2 * Math.PI * 1677 * t)) * Math.exp(-t * 5) * .55;
    if (kind === 2) value = smooth * 3 * Math.sin(Math.PI * t / .72) ** 2;
    if (kind === 3) value = Math.sin(2 * Math.PI * (850 * t - 480 * t * t)) * Math.exp(-t * 12) * .8;
    if (kind === 4) value = (noise * .5 + Math.sin(2 * Math.PI * 95 * t) * .5) * Math.sin(Math.PI * t / .8) ** 2 * (.2 + .8 * Math.sin(2 * Math.PI * 7 * t) ** 8) * .7;
    const fadeIn = Math.min(1, i / (sampleRate * .003));
    const fadeOut = Math.min(1, (samples.length - i - 1) / (sampleRate * .015));
    samples[i] = value * fadeIn * fadeOut * .62;
  }
  return samples;
}

export class AudioEngine {
  constructor(contextFactory = () => new (window.AudioContext || window.webkitAudioContext)()) {
    this.contextFactory = contextFactory;
    this.buffers = new Map();
    this.sources = new Map();
    this.voices = new Set();
    this.passages = new Map();
  }
  context() {
    if (!this.ctx) {
      this.ctx = this.contextFactory();
      this.output = this.ctx.createGain();
      this.output.gain.value = .8;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 8;
      limiter.ratio.value = 12;
      this.output.connect(limiter);
      limiter.connect(this.ctx.destination);
      for (let kind = 0; kind < 5; kind++) {
        const samples = seedSamples(kind, this.ctx.sampleRate);
        const buffer = this.ctx.createBuffer(1, samples.length, this.ctx.sampleRate);
        buffer.copyToChannel(samples, 0);
        this.buffers.set(`seed-${kind}`, buffer);
      }
    }
    return this.ctx;
  }
  async unlock() {
    const ctx = this.context();
    if (ctx.state !== 'running') await ctx.resume();
    return ctx;
  }
  play(id, when, envelope = null) {
    const ctx = this.context(), buffer = this.buffers.get(id);
    if (!buffer) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const start = when ?? ctx.currentTime;
    if (envelope) {
      source.level = ctx.createGain();
      source.connect(source.level); source.level.connect(this.output);
      source.level.gain.setValueAtTime(envelope[0].gain, start);
      for (const point of envelope.slice(1)) source.level.gain.linearRampToValueAtTime(point.gain, start + point.at / 1000);
    } else source.connect(this.output);
    this.voices.add(source);
    source.onended = () => {
      this.voices.delete(source); source.disconnect(); source.level?.disconnect();
      if (source.passage) this.passages.delete(source.passage);
    };
    source.start(start);
    if (envelope?.length > 1) source.stop(start + envelope.at(-1).at / 1000 + .005);
    return source;
  }
  listen({ event, fresh, points, closed }) {
    if (!event.envelope) return fresh ? this.play(event.soundId) : undefined;
    let source = this.passages.get(event);
    if (fresh) {
      source = this.play(event.soundId, undefined, [{ at: 0, gain: points[0]?.gain ?? 0 }]);
      if (!source) return;
      source.passage = event; this.passages.set(event, source);
    }
    if (!source || !points.length) return;
    const param = source.level.gain, now = this.context().currentTime;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { const value = param.value; param.cancelScheduledValues(now); param.setValueAtTime(value, now); }
    // Brief smoothing prevents clicks. Sparse samples still produce an audible
    // passage; they never schedule long, delayed playback after the gesture.
    const span = points.at(-1).at - points[0].at;
    const horizon = Math.max(.012, Math.min(.04, span / 1000));
    points.forEach((point, index) => {
      const fraction = span > 0 ? (point.at - points[0].at) / span : (index + 1) / points.length;
      param.linearRampToValueAtTime(point.gain, now + .003 + fraction * horizon);
    });
    if (closed) { source.stop(now + .003 + horizon + .005); this.passages.delete(event); }
    return source;
  }
  async audition(id) { await this.unlock(); this.play(id); }
  async import(id, arrayBuffer) {
    const original = arrayBuffer.slice(0);
    const buffer = await this.context().decodeAudioData(arrayBuffer);
    if (!buffer.length) throw new Error('empty-audio');
    this.buffers.set(id, buffer);
    this.sources.set(id, original);
  }
  async restoreSources(sources, isCurrent = () => true) {
    const prepared = new Map();
    for (const [id, bytes] of sources) {
      if (!isCurrent()) return false;
      const buffer = await this.context().decodeAudioData(bytes.slice(0));
      if (!buffer.length) throw new Error('empty-audio');
      prepared.set(id, { buffer, bytes });
    }
    if (!isCurrent()) return false;
    for (const id of this.buffers.keys()) if (!/^seed-[0-4]$/.test(id)) this.buffers.delete(id);
    this.sources.clear();
    for (const [id, value] of prepared) {
      this.buffers.set(id, value.buffer);
      this.sources.set(id, value.bytes);
    }
    return true;
  }
  stop() {
    for (const source of this.voices) { try { source.stop(); } catch { /* Already ended. */ } }
    this.voices.clear(); this.passages.clear();
  }
  replay(path) {
    const start = this.context().currentTime + .025;
    let end = path.duration / 1000;
    for (const event of path.events) {
      this.play(event.soundId, start + event.at / 1000, event.envelope);
      const length = this.buffers.get(event.soundId)?.duration ?? 0;
      end = Math.max(end, event.at / 1000 + (event.envelope ? Math.min(length, event.envelope.at(-1).at / 1000 + .005) : length));
    }
    return (end + .025) * 1000;
  }
  dispose() { this.stop(); this.ctx?.close(); }
}
