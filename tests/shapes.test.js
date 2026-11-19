import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, TRIGGER_RADIUS, FIELD_RADIUS, shapeIntervals, shapeDistance, shapePath, soundMode, soundShape } from '../src/shapes.js';
import { ListeningGesture } from '../src/listening.js';
import { initialState, reducer } from '../src/model.js';
import { createProjectBundle, openProjectBundle } from '../src/bundle.js';
import { packState, unpackState } from '../src/snapshot.js';
import { AudioEngine } from '../src/audio.js';

test('new and legacy materials default to outlined circle playback', () => {
  for (const sound of initialState().sounds) { assert.equal(soundMode(sound), 'trigger'); assert.equal(soundShape(sound), 'circle'); }
  assert.ok(TRIGGER_RADIUS > 16 && FIELD_RADIUS > 28);
});
test('rendered shape boundaries and segment collision agree for every offered geometry', () => {
  for (const shape of SHAPES) {
    assert.ok(shapePath(shape, 22).endsWith('Z')); assert.equal(shapeDistance({ x: 0, y: 0 }, shape, 22), 0);
    for (let y = -27; y <= 27; y += 3) {
      const a = { x: -40, y }, b = { x: 40, y }, ranges = shapeIntervals(a, b, shape, 22);
      for (let i = 0; i < 160; i++) {
        const t = (i + .5) / 160, point = { x: -40 + t * 80, y };
        const d = shapeDistance(point, shape, 22);
        if (Math.abs(d - 1) < 1e-7) continue;
        assert.equal(ranges.some(([lo, hi]) => t > lo && t < hi), d < 1, `${shape} at ${point.x},${y}`);
      }
    }
  }
});
test('star gaps are silent and separate arms can create separate visits on a fast stroke', () => {
  let separated;
  for (let y = -30; y <= 30; y++) {
    const intervals = shapeIntervals({ x: -50, y }, { x: 50, y }, 'star', FIELD_RADIUS);
    if (intervals.length > 1) { separated = { y, intervals }; break; }
  }
  assert.ok(separated);
  const g = new ListeningGesture([{ id: 'seed-0', shape: 'star', mode: 'proximity', x: .5, y: .5 }], { width: 1000, height: 600 });
  g.advance({ x: .45, y: (300 + separated.y) / 600, t: 0 }, { x: .55, y: (300 + separated.y) / 600, t: 1000 });
  assert.equal(g.events.length, separated.intervals.length);
  assert.ok(g.events.every(e => e.envelope.at(-1).gain === 0));
});
test('every geometry supports full-clip crossings and continuous proximity independently', () => {
  for (const shape of SHAPES) for (const mode of ['trigger', 'proximity']) {
    const g = new ListeningGesture([{ id: 'seed-0', shape, mode, x: .5, y: .5 }], { width: 1000, height: 600 });
    g.advance({ x: .4, y: .5, t: 0 }, { x: .6, y: .5, t: 1000 });
    assert.equal(g.events.length, 1, `${shape}/${mode}`);
    if (mode === 'trigger') assert.equal(g.events[0].envelope, undefined);
    else { assert.equal(Math.max(...g.events[0].envelope.map(p => p.gain)), 1); assert.equal(g.events[0].envelope.at(-1).gain, 0); }
  }
});
test('shape and mode changes are undoable and portable without changing earlier listening', async () => {
  let state = initialState();
  assert.equal(reducer(state, { type: 'configure', id: 'seed-0', mode: 'trigger', shape: 'circle' }), state);
  state = reducer(state, { type: 'path', path: { id: 'p', points: [{ x: .1, y: .5, t: 0 }, { x: .9, y: .5, t: 1000 }], duration: 1000, events: [{ soundId: 'seed-0', at: 400 }] } });
  const before = state;
  state = reducer(state, { type: 'configure', id: 'seed-0', mode: 'proximity', shape: 'organic' });
  assert.equal(state.paths, before.paths); assert.equal(state.sounds[0].shape, 'organic');
  assert.deepEqual(reducer(state, { type: 'undo' }), before);
  const restored = await openProjectBundle(await createProjectBundle(state, new Map()));
  assert.deepEqual(restored.state, state);
  assert.deepEqual(reducer(restored.state, { type: 'undo' }), before);
  for (const field of ['shape', 'mode']) {
    const bad = structuredClone(packState(state, new Map())); bad.frames.at(-1).sounds[0][field] = 'invalid';
    assert.throws(() => unpackState(bad));
  }
});
test('whole-clip mode does not fade or stop a voice when its region is exited', () => {
  const voices = [], ctx = {
    currentTime: 0, sampleRate: 8000, destination: {},
    createGain: () => ({ gain: { value: 0 }, connect() {} }),
    createDynamicsCompressor: () => ({ threshold: {}, knee: {}, ratio: {}, connect() {} }),
    createBuffer: (_, length, rate) => ({ length, duration: length / rate, copyToChannel() {} }),
    createBufferSource() { const voice = { connect() {}, disconnect() {}, start() {}, stop() { this.stopped = true; } }; voices.push(voice); return voice; },
  };
  const engine = new AudioEngine(() => ctx);
  const g = new ListeningGesture([{ id: 'seed-0', shape: 'square', x: .5, y: .5 }], { width: 1000, height: 600 });
  g.advance({ x: .4, y: .5, t: 0 }, { x: .6, y: .5, t: 1000 }).forEach(update => engine.listen(update));
  g.finish(1000).forEach(update => engine.listen(update));
  assert.equal(voices.length, 1); assert.equal(voices[0].stopped, undefined); assert.equal(voices[0].level, undefined);
});
