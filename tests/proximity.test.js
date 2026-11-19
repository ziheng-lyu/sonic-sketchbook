import test from 'node:test';
import assert from 'node:assert/strict';
import { ListeningGesture, proximityGain } from '../src/listening.js';
import { SOUND_RADIUS } from '../src/geometry.js';
import { AudioEngine } from '../src/audio.js';
import { initialState, reducer } from '../src/model.js';
import { packState, unpackState } from '../src/snapshot.js';
import { createProjectBundle, openProjectBundle } from '../src/bundle.js';

const size = { width: 1000, height: 600 }, sounds = [{ id: 'seed-0', x: .5, y: .5 }];
const point = (x, y, t) => ({ x: x / size.width, y: y / size.height, t });
const peak = event => Math.max(...event.envelope.map(p => p.gain));

test('proximity gain is continuous, symmetric, quiet at the edge, and loudest at the center', () => {
  assert.equal(proximityGain(0), 1); assert.equal(proximityGain(SOUND_RADIUS), 0);
  assert.equal(proximityGain(1000), 0); assert.equal(proximityGain(SOUND_RADIUS / 2), .5);
  assert.ok(proximityGain(4) > proximityGain(12) && proximityGain(12) > proximityGain(24));
  assert.ok(proximityGain(27.99) < .00001);
});

test('fast full-field crossing captures entry, central peak, and quiet exit without a sample inside', () => {
  const g = new ListeningGesture(sounds, size);
  const updates = g.advance(point(400, 300, 0), point(600, 300, 1000));
  assert.equal(updates.length, 1); assert.equal(g.events.length, 1);
  assert.equal(updates[0].fresh, true); assert.equal(updates[0].closed, true);
  assert.equal(g.events[0].at, 360); assert.equal(peak(g.events[0]), 1);
  assert.equal(g.events[0].envelope.at(-1).at, 280); assert.equal(g.events[0].envelope.at(-1).gain, 0);
});

test('near-edge passes stay quieter and tangent or outside passes do not trigger', () => {
  const center = new ListeningGesture(sounds, size), edge = new ListeningGesture(sounds, size), outside = new ListeningGesture(sounds, size);
  center.advance(point(400, 300, 0), point(600, 300, 1000));
  edge.advance(point(400, 324, 0), point(600, 324, 1000));
  outside.advance(point(400, 328, 0), point(600, 328, 1000));
  assert.ok(peak(edge.events[0]) > 0 && peak(edge.events[0]) < .1);
  assert.equal(outside.events.length, 0); assert.ok(peak(center.events[0]) > peak(edge.events[0]));
});

test('slow approach, pause and retreat update one visit; leaving and returning starts a new visit', () => {
  const g = new ListeningGesture(sounds, size);
  g.advance(point(460, 300, 0), point(478, 300, 200));
  const soft = peak(g.events[0]);
  g.advance(point(478, 300, 200), point(500, 300, 500));
  g.advance(point(500, 300, 500), point(500, 300, 1500));
  assert.equal(g.events.length, 1); assert.equal(peak(g.events[0]), 1); assert.ok(soft < 1);
  g.advance(point(500, 300, 1500), point(540, 300, 1800));
  assert.equal(g.active.size, 0); assert.equal(g.events[0].envelope.at(-1).gain, 0);
  g.advance(point(540, 300, 1800), point(500, 300, 2000));
  g.finish(2300);
  assert.equal(g.events.length, 2); assert.equal(g.active.size, 0);
  assert.equal(g.events[1].envelope.at(-1).at + g.events[1].at, 2312);
});

test('starting a stroke in the outer field and overlapping fields have independent envelopes', () => {
  const g = new ListeningGesture([...sounds, { id: 'seed-1', x: .52, y: .5 }], size);
  g.advance(point(480, 300, 0), point(510, 300, 300));
  g.finish(500);
  assert.deepEqual(g.events.map(e => e.soundId), ['seed-0', 'seed-1']);
  assert.equal(g.events[0].at, 0); assert.ok(g.events[0].envelope[0].gain > 0);
  assert.notDeepEqual(g.events[0].envelope, g.events[1].envelope);
});

test('new envelopes survive project bundles, undo and circle movement; old paths remain unchanged', async () => {
  const g = new ListeningGesture(sounds, size);
  g.advance(point(400, 300, 0), point(600, 300, 1000));
  let state = reducer(initialState(), { type: 'path', path: { id: 'proximity', points: [point(400, 300, 0), point(600, 300, 1000)], duration: 1000, events: g.events } });
  state = reducer(state, { type: 'move', id: 'seed-0', position: { x: .2, y: .2 } });
  const loaded = await openProjectBundle(await createProjectBundle(state, new Map()));
  assert.deepEqual(loaded.state, state); assert.deepEqual(reducer(loaded.state, { type: 'undo' }).paths[0].events, g.events);
  const legacy = structuredClone(state); delete legacy.paths[0].events[0].envelope;
  assert.deepEqual(unpackState(packState(legacy, new Map())).state, legacy);
});

test('corrupt gain automation is rejected before playing', () => {
  const g = new ListeningGesture(sounds, size); g.advance(point(400, 300, 0), point(600, 300, 1000));
  const state = reducer(initialState(), { type: 'path', path: { id: 'p', points: [point(400, 300, 0), point(600, 300, 1000)], duration: 1000, events: g.events } });
  for (const bad of [[], [{ at: 0, gain: 2 }, { at: 1, gain: 0 }], [{ at: 0, gain: 1 }, { at: -1, gain: 0 }], [{ at: 0, gain: 1 }, { at: 10000, gain: 0 }], [{ at: 0, gain: 1 }, { at: 20, gain: 1 }]]) {
    const data = structuredClone(packState(state, new Map())); data.paths[0].events[0].envelope = bad;
    assert.throws(() => unpackState(data));
  }
});

test('live gain nodes are independent and replay uses the stored automation on the audio clock', () => {
  const sources = [], gains = [];
  const ctx = {
    currentTime: 10, state: 'running', sampleRate: 8000, destination: {},
    createGain() { const node = { gain: { value: 0, calls: [], setValueAtTime(v,t) { this.calls.push(['set',v,t]); }, linearRampToValueAtTime(v,t) { this.calls.push(['ramp',v,t]); }, cancelAndHoldAtTime(t) { this.calls.push(['hold',t]); } }, connect() {}, disconnect() {} }; gains.push(node); return node; },
    createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, connect() {} }),
    createBuffer: (_, length, rate) => ({ length, duration: length / rate, copyToChannel() {} }),
    createBufferSource() { const source = { connect() {}, disconnect() {}, start(t) { this.startTime = t; }, stop(t) { this.stopTime = t; } }; sources.push(source); return source; },
  };
  const engine = new AudioEngine(() => ctx), g = new ListeningGesture(sounds, size);
  const update = g.advance(point(460, 300, 0), point(500, 300, 200))[0];
  const live = engine.listen(update);
  assert.ok(live.level.gain.calls.some(c => c[0] === 'ramp' && c[1] === 1));
  g.finish(400).forEach(u => engine.listen(u));
  assert.ok(live.stopTime > ctx.currentTime && live.stopTime < ctx.currentTime + .1);
  engine.replay({ duration: 400, events: g.events });
  const replay = sources.at(-1), event = g.events[0];
  assert.notEqual(replay.level, live.level);
  assert.equal(replay.startTime, 10.025 + event.at / 1000);
  const last = event.envelope.at(-1);
  assert.deepEqual(replay.level.gain.calls.at(-1), ['ramp', 0, replay.startTime + last.at / 1000]);
  assert.equal(replay.stopTime, replay.startTime + last.at / 1000 + .005);
});
