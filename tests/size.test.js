import test from 'node:test';
import assert from 'node:assert/strict';
import { SHAPES, soundRadius, soundScale, validScale, MIN_SCALE, MAX_SCALE } from '../src/shapes.js';
import { makeOutline } from '../src/custom-shape.js';
import { soundPosition, soundPadding, keepOnCanvas } from '../src/geometry.js';
import { ListeningGesture } from '../src/listening.js';
import { initialState, reducer } from '../src/model.js';
import { createProjectBundle, openProjectBundle } from '../src/bundle.js';
import { packState, unpackState } from '../src/snapshot.js';

const outline = makeOutline([{ x: -60, y: -40 }, { x: 60, y: -40 }, { x: 60, y: 40 }, { x: 15, y: 0 }, { x: -60, y: 40 }]);
test('sizes have safe bounds and older materials retain their original default size', () => {
  assert.equal(soundScale({}), 1); assert.equal(soundRadius({}), 22); assert.equal(soundRadius({ mode: 'proximity' }), 34);
  for (const size of [MIN_SCALE, 1, MAX_SCALE]) assert.ok(validScale(size));
  for (const size of [0, -1, MIN_SCALE - .01, MAX_SCALE + .01, NaN, Infinity, '2', null]) assert.equal(validScale(size), false);
});
test('all preset and freehand shapes resize in both listening modes', () => {
  for (const shape of [...SHAPES, 'custom']) for (const mode of ['trigger', 'proximity']) for (const scale of [.5, 2, 5]) {
    const sound = { id: 'seed-0', shape, mode, scale, outline, x: .5, y: .5 };
    const radius = (mode === 'trigger' ? 22 : 34) * scale;
    assert.equal(soundRadius(sound), radius);
    const g = new ListeningGesture([sound], { width: 1000, height: 600 });
    g.advance({ x: .1, y: .5, t: 0 }, { x: .9, y: .5, t: 1000 });
    assert.ok(g.events.length > 0, `${shape}/${mode}/${scale}`);
    if (mode === 'proximity') assert.ok(g.events.some(e => e.envelope.some(p => p.gain > .9)));
    else assert.ok(g.events.every(e => !e.envelope));
  }
});
test('increasing size changes the actual listening boundary and its entry time', () => {
  const events = [1, 2, 3].map(scale => {
    const g = new ListeningGesture([{ id: 'seed-0', x: .5, y: .5, scale }], { width: 1000, height: 600 });
    g.advance({ x: 0, y: .5, t: 0 }, { x: 1, y: .5, t: 1000 }); return g.events[0];
  });
  assert.deepEqual(events.map(e => Math.round(e.at)), [478, 456, 434]);
});
test('large materials keep their center reachable and fit inside the canvas when possible', () => {
  const sound = { id: 'seed-0', x: 0, y: 0, mode: 'proximity', scale: 3 };
  const size = { width: 1280, height: 720 }, position = soundPosition(sound, size), padding = soundPadding(sound);
  assert.ok(position.x * size.width >= padding - 1e-8); assert.ok(position.y * size.height >= padding - 1e-8);
  const phone = { width: 320, height: 640 }, oversized = { ...sound, scale: 5 };
  assert.equal(soundPosition(oversized, phone).x, .5);
  assert.deepEqual(keepOnCanvas({ x: 0, y: 0 }, size, padding), position);
});
test('a committed size change is undoable and never changes earlier path events or outlines', async () => {
  let state = reducer(initialState(), { type: 'configure', id: 'seed-0', shape: 'custom', outline });
  state = reducer(state, { type: 'path', path: { id: 'original', points: [{ x: .1, y: .5, t: 0 }, { x: .9, y: .5, t: 1000 }], duration: 1000, events: [{ soundId: 'seed-0', at: 400 }] } });
  const before = state;
  state = reducer(state, { type: 'configure', id: 'seed-0', scale: 2.5 });
  assert.equal(state.history.length, before.history.length + 1); assert.equal(state.paths, before.paths);
  assert.equal(state.sounds[0].outline, before.sounds[0].outline); assert.equal(state.sounds[0].scale, 2.5);
  assert.deepEqual(reducer(state, { type: 'undo' }), before);
  const reopened = await openProjectBundle(await createProjectBundle(state, new Map()));
  assert.deepEqual(reopened.state, state); assert.deepEqual(reducer(reopened.state, { type: 'undo' }), before);
});
test('invalid saved sizes are rejected and selecting the existing size makes no Undo step', () => {
  const state = initialState(); assert.equal(reducer(state, { type: 'configure', id: 'seed-0', scale: 1 }), state);
  for (const scale of [0, -2, 5000, NaN, Infinity, '2']) {
    assert.equal(reducer(state, { type: 'configure', id: 'seed-0', scale }), state);
    const data = structuredClone(packState(state, new Map())); data.frames.at(-1).sounds[0].scale = scale;
    assert.throws(() => unpackState(data));
  }
});
