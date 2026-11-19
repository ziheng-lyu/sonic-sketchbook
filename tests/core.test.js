import test from 'node:test';
import assert from 'node:assert/strict';
import { circleEntry, crossings, nearestPath, keepOnCanvas, soundPosition } from '../src/geometry.js';
import { initialState, reducer } from '../src/model.js';
import { AudioEngine, seedSamples } from '../src/audio.js';
import { Microphone } from '../src/recorder.js';

test('fast outside-to-outside segments catch all circles in gesture order and interpolate timing', () => {
  const sounds = [{ id: 'right', x: .8, y: .5 }, { id: 'left', x: .2, y: .5 }];
  const forward = crossings({ x: 0, y: .5, t: 100 }, { x: 1, y: .5, t: 1100 }, sounds, { width: 1000, height: 600 });
  assert.deepEqual(forward.map(event => event.soundId), ['left', 'right']);
  assert.deepEqual(forward.map(event => Math.round(event.at)), [278, 878]);
  const reverse = crossings({ x: 1, y: .5, t: 1500 }, { x: 0, y: .5, t: 2500 }, sounds, { width: 1000, height: 600 });
  assert.deepEqual(reverse.map(event => event.soundId), ['right', 'left']);
});

test('staying inside or exiting is silent; leaving then revisiting triggers again', () => {
  const center = { x: 50, y: 50 };
  assert.equal(circleEntry({ x: 50, y: 50 }, { x: 55, y: 50 }, center), null);
  assert.equal(circleEntry({ x: 55, y: 50 }, { x: 90, y: 50 }, center), null);
  assert.notEqual(circleEntry({ x: 90, y: 50 }, { x: 50, y: 50 }, center), null);
  assert.equal(circleEntry({ x: 50, y: 80 }, { x: 90, y: 80 }, center), null);
  assert.equal(circleEntry({ x: 90, y: 50 }, { x: 90, y: 50 }, center), null);
});

test('crossing geometry holds for narrow touch screens and diagonal gestures', () => {
  const hits = crossings({ x: 0, y: 0, t: 0 }, { x: 1, y: 1, t: 900 }, [{ id: 'a', x: .5, y: .5 }], { width: 390, height: 844 });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].at > 415 && hits[0].at < 450);
  assert.deepEqual(keepOnCanvas({ x: -1, y: 2 }, { width: 400, height: 800 }), { x: .1, y: .95 });
});

test('path selection measures the full polyline and prefers the latest overlapping mark', () => {
  const first = { id: 'first', points: [{ x: .1, y: .5 }, { x: .9, y: .5 }] };
  const next = { ...first, id: 'next' };
  assert.equal(nearestPath({ x: 500, y: 303 }, [first, next], { width: 1000, height: 600 }), 'next');
  assert.equal(nearestPath({ x: 500, y: 330 }, [first], { width: 1000, height: 600 }), null);
});

test('move/add/undo preserve original path events and duration, including pauses and repeated sounds', () => {
  const path = { id: 'p', points: [{ x: .1, y: .2 }, { x: .8, y: .7 }], duration: 4100, events: [{ soundId: 'seed-0', at: 270 }, { soundId: 'seed-1', at: 1250 }, { soundId: 'seed-0', at: 3800 }] };
  let state = reducer(initialState(), { type: 'path', path });
  const original = JSON.stringify(state.paths);
  state = reducer(state, { type: 'move', id: 'seed-0', position: { x: .9, y: .1 } });
  state = reducer(state, { type: 'add', sounds: [{ id: 'new', x: .3, y: .4 }] });
  assert.equal(JSON.stringify(state.paths), original);
  state = reducer(state, { type: 'undo' });
  assert.equal(state.sounds.length, 5);
  state = reducer(state, { type: 'undo' });
  assert.deepEqual(state.sounds[0], initialState().sounds[0]);
  assert.equal(JSON.stringify(state.paths), original);
  state = reducer(state, { type: 'undo' });
  assert.equal(state.paths.length, 0);
  assert.equal(state.selected, null);
});

test('five starting sounds have distinct finite, non-silent PCM with quiet boundaries', () => {
  const samples = Array.from({ length: 5 }, (_, kind) => seedSamples(kind));
  const peaks = samples.map(buffer => Math.max(...buffer.map(Math.abs)));
  assert.equal(new Set(samples.map(buffer => buffer.length)).size, 5);
  assert.equal(new Set(peaks).size, 5);
  for (const buffer of samples) {
    assert.ok(buffer.every(value => Number.isFinite(value) && Math.abs(value) < 1));
    assert.ok(buffer.some(value => Math.abs(value) > .05));
    assert.ok(buffer[0] === 0);
    assert.ok(Math.abs(buffer.at(-1)) === 0);
  }
});

function fakeContext() {
  const sources = [];
  const ctx = {
    currentTime: 12, state: 'suspended', sampleRate: 8000, destination: {},
    resume: async () => { ctx.state = 'running'; },
    createGain: () => ({ gain: { value: 0 }, connect() {} }),
    createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, connect() {} }),
    createBuffer: (channels, length, sampleRate) => ({ length, duration: length / sampleRate, copyToChannel() {} }),
    createBufferSource: () => {
      const source = { connect() {}, disconnect() {}, start(time) { this.when = time; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    },
    decodeAudioData: async data => { if (!data.byteLength) throw Error('invalid'); return { duration: .5, length: 4000 }; },
  };
  return { ctx, sources };
}

test('replay schedules original timing on the audio clock, preserves overlaps, and stops every voice', async () => {
  const { ctx, sources } = fakeContext();
  const audio = new AudioEngine(() => ctx);
  await audio.unlock();
  const path = { duration: 3000, events: [{ soundId: 'seed-1', at: 100 }, { soundId: 'seed-0', at: 170 }, { soundId: 'seed-1', at: 2500 }] };
  const end = audio.replay(path);
  assert.deepEqual(sources.map(source => Math.round(source.when * 1000)), [12125, 12195, 14525]);
  assert.equal(sources[0].buffer, sources[2].buffer);
  assert.ok(end >= 3600);
  audio.stop(); assert.ok(sources.every(source => source.stopped));
  assert.equal(audio.voices.size, 0);
  const silentEnd = audio.replay({ duration: 5000, events: [] });
  assert.equal(silentEnd, 5025);
});

test('decoded additions remain available for audition and recorded paths', async () => {
  const { ctx, sources } = fakeContext();
  const audio = new AudioEngine(() => ctx);
  await audio.import('uploaded', new ArrayBuffer(40));
  await audio.audition('uploaded');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].buffer, audio.buffers.get('uploaded'));
  await assert.rejects(audio.import('bad', new ArrayBuffer(0)));
});

class FakeRecorder {
  constructor(stream) { this.stream = stream; this.state = 'inactive'; this.mimeType = 'audio/webm'; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    queueMicrotask(() => { this.ondataavailable({ data: new Blob(['audio']) }); this.onstop(); });
  }
}

test('recording asks the browser for audio only, returns data, and releases every microphone track', async () => {
  let constraints, stopped = 0;
  const track = { stop() { stopped++; }, addEventListener() {} };
  const mic = new Microphone({ getUserMedia: async requested => {
    constraints = requested;
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } }, FakeRecorder);
  await mic.start();
  assert.deepEqual(constraints, { audio: true });
  assert.equal(mic.recorder.state, 'recording');
  const blob = await mic.finish();
  assert.ok(blob.size > 0); assert.equal(stopped, 1);
});

test('microphone denial and construction failure are recoverable and release acquired tracks', async () => {
  const denied = new Microphone({ getUserMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); } }, FakeRecorder);
  await assert.rejects(denied.start(), { name: 'NotAllowedError' });
  let stopped = false;
  const broken = new Microphone({ getUserMedia: async () => ({ getTracks: () => [{ stop() { stopped = true; } }] }) }, class { constructor() { throw Error('failed'); } });
  await assert.rejects(broken.start()); assert.equal(stopped, true);
});

test('a permission grant arriving after teardown releases its stream immediately', async () => {
  let resolve, stopped = false;
  const mic = new Microphone({ getUserMedia: () => new Promise(done => { resolve = done; }) }, FakeRecorder);
  const pending = mic.start(); mic.dispose();
  resolve({ getTracks: () => [{ stop() { stopped = true; } }] });
  await pending; assert.equal(stopped, true);
});

test('unused defaults stay spaced in the top-right corner on desktop and narrow screens', () => {
  for (const size of [{ width: 1280, height: 720 }, { width: 320, height: 640 }]) {
    const positions = initialState().sounds.map(sound => soundPosition(sound, size));
    const xs = positions.map(p => p.x * size.width);
    assert.ok(positions.every(p => p.y * size.height <= (size.width <= 600 ? 104 : 44)));
    assert.ok(xs[0] >= size.width - 328);
    assert.equal(xs.at(-1), size.width - 40);
    if (size.width <= 600) assert.ok(positions.every(p => p.y * size.height - 34 > 60));
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 44);
  }
});

test('moving a default makes its position editable; undo returns it to the corner row', () => {
  const original = initialState();
  const moved = reducer(original, { type: 'move', id: 'seed-2', position: { x: .4, y: .5 } });
  assert.equal(moved.sounds[2].parked, false);
  assert.deepEqual(soundPosition(moved.sounds[2], { width: 390, height: 844 }), { x: .4, y: .5 });
  assert.equal(moved.sounds[0].parked, true);
  const undone = reducer(moved, { type: 'undo' });
  assert.deepEqual(undone, original);
});

test('legacy sounds without a corner-row flag preserve their saved positions', () => {
  assert.deepEqual(soundPosition({ id: 'seed-0', x: .25, y: .31 }, { width: 1280, height: 720 }), { x: .25, y: .31 });
});
