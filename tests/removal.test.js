import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer } from '../src/model.js';
import { makeOutline } from '../src/custom-shape.js';
import { createProjectBundle, openProjectBundle } from '../src/bundle.js';
import { packState, unpackState } from '../src/snapshot.js';
import { ListeningGesture } from '../src/listening.js';

const path = (id, soundId = 'seed-0') => ({ id, duration: 1000, points: [{ x: .1, y: .5, t: 0 }, { x: .9, y: .5, t: 1000 }], events: [{ soundId, at: 400 }] });
test('clear all paths keeps every material unchanged and restores all marks with one Undo', () => {
  let state = reducer(initialState(), { type: 'path', path: path('one') });
  state = reducer(state, { type: 'path', path: path('two') });
  const cleared = reducer(state, { type: 'clear-paths' });
  assert.equal(cleared.sounds, state.sounds); assert.deepEqual(cleared.paths, []); assert.equal(cleared.selected, null);
  assert.equal(cleared.history.length, state.history.length + 1); assert.deepEqual(reducer(cleared, { type: 'undo' }), state);
});
test('remove one sound keeps other materials and recorded paths, and Undo restores its full geometry', () => {
  const outline = makeOutline([{ x: -60, y: -50 }, { x: 60, y: -50 }, { x: 0, y: 60 }]);
  let state = reducer(initialState(), { type: 'configure', id: 'seed-0', shape: 'custom', outline, scale: 7, mode: 'proximity' });
  state = reducer(state, { type: 'path', path: path('one') });
  const removed = reducer(state, { type: 'remove-sound', id: 'seed-0' });
  assert.deepEqual(removed.sounds, state.sounds.slice(1)); assert.equal(removed.paths, state.paths); assert.equal(removed.selected, state.selected);
  assert.deepEqual(reducer(removed, { type: 'undo' }), state);
});
test('new strokes ignore a removed material while earlier paths retain its event sequence', () => {
  let state = reducer(initialState(), { type: 'move', id: 'seed-0', position: { x: .5, y: .5 } });
  state = reducer(state, { type: 'path', path: path('before') });
  state = reducer(state, { type: 'remove-sound', id: 'seed-0' });
  const g = new ListeningGesture(state.sounds, { width: 1000, height: 600 });
  g.advance({ x: .1, y: .5, t: 0 }, { x: .9, y: .5, t: 1000 });
  assert.ok(g.events.every(e => e.soundId !== 'seed-0')); assert.equal(state.paths[0].events[0].soundId, 'seed-0');
});
test('saved projects retain audio needed by earlier paths and Undo after removing its circle', async () => {
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer, sources = new Map([['own-audio', bytes]]);
  let state = reducer(initialState(), { type: 'add', sounds: [{ id: 'own-audio', x: .5, y: .5 }] });
  state = reducer(state, { type: 'path', path: path('own-path', 'own-audio') });
  state = reducer(state, { type: 'remove-sound', id: 'own-audio' });
  const restored = await openProjectBundle(await createProjectBundle(state, sources));
  assert.deepEqual(restored.state, state); assert.deepEqual(restored.sources.get('own-audio'), bytes);
  assert.equal(reducer(restored.state, { type: 'undo' }).sounds.at(-1).id, 'own-audio');
});
test('a project can contain zero sounds and zero paths and can later accept a new material', async () => {
  let state = reducer(initialState(), { type: 'path', path: path('one') });
  for (const sound of state.sounds) state = reducer(state, { type: 'remove-sound', id: sound.id });
  state = reducer(state, { type: 'clear-paths' });
  const restored = await openProjectBundle(await createProjectBundle(state, new Map()));
  assert.deepEqual(restored.state, state); assert.equal(restored.state.sounds.length, 0);
  assert.equal(reducer(restored.state, { type: 'undo' }).paths.length, 1);
  assert.equal(reducer(restored.state, { type: 'add', sounds: [{ id: 'later', x: .5, y: .5 }] }).sounds.length, 1);
  const invalid = packState(state, new Map()); invalid.frames.at(-1).sounds = null; assert.throws(() => unpackState(invalid));
});
test('clearing an empty canvas or removing a missing sound adds no Undo step', () => {
  const state = initialState(); assert.equal(reducer(state, { type: 'clear-paths' }), state);
  assert.equal(reducer(state, { type: 'remove-sound', id: 'missing' }), state);
});
