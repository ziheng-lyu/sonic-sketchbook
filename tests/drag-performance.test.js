import test from 'node:test';
import assert from 'node:assert/strict';
import { frameDrag } from '../src/frame-drag.js';
import { prepareProjectRecord, readProjectRecord } from '../src/project-record.js';
import { createProjectBundle } from '../src/bundle.js';
import { initialState, reducer } from '../src/model.js';
import { makeOutline } from '../src/custom-shape.js';

function scheduler() {
  let id = 0; const pending = new Map();
  return { request: fn => { pending.set(++id, fn); return id; }, cancel: key => pending.delete(key), size: () => pending.size, run() { const items = [...pending.values()]; pending.clear(); items.forEach(fn => fn()); } };
}
test('hundreds of drag samples produce one update per frame using the newest position', () => {
  const frames = scheduler(), positions = [], drag = frameDrag(p => positions.push(p), frames.request, frames.cancel);
  for (let i = 0; i < 500; i++) drag.update({ x: i, y: i });
  assert.equal(frames.size(), 1); assert.equal(positions.length, 0);
  frames.run(); assert.deepEqual(positions, [{ x: 499, y: 499 }]);
  drag.update({ x: 700, y: 600 }); frames.run(); assert.equal(positions.length, 2);
});
test('releasing commits the last position and cancels stale queued movement', () => {
  const frames = scheduler(), positions = [], drag = frameDrag(p => positions.push(p), frames.request, frames.cancel);
  drag.update({ x: 1, y: 2 }); drag.finish({ x: 5, y: 6 }); frames.run();
  drag.update({ x: 9, y: 9 }); frames.run(); assert.deepEqual(positions, [{ x: 5, y: 6 }]);
});
test('canceling a drag prevents all later frame writes', () => {
  const frames = scheduler(), positions = [], drag = frameDrag(p => positions.push(p), frames.request, frames.cancel);
  drag.update({ x: 1, y: 2 }); drag.cancel(); frames.run(); drag.finish({ x: 3, y: 4 });
  assert.equal(positions.length, 0); assert.equal(frames.size(), 0);
});
function material() {
  const outline = makeOutline([{ x: -60, y: -60 }, { x: 60, y: -60 }, { x: 20, y: 60 }, { x: -60, y: 60 }]);
  let state = reducer(initialState(), { type: 'add', sounds: [{ id: 'own', x: .4, y: .5, shape: 'custom', outline, scale: 12 }] });
  state = reducer(state, { type: 'path', path: { id: 'line', duration: 1000, points: [{ x: .1, y: .5, t: 0 }, { x: .9, y: .5, t: 1000 }], events: [{ soundId: 'own', at: 400 }] } });
  state = reducer(state, { type: 'move', id: 'own', position: { x: .6, y: .7 } });
  return { state, sources: new Map([['own', new Uint8Array([82, 73, 70, 70, 1, 2, 3]).buffer]]) };
}
test('local save reuses audio Blobs and shared shape references instead of repacking metadata', async () => {
  const { state, sources } = material();
  const stringify = JSON.stringify; let record;
  JSON.stringify = () => { throw new Error('Local save should not serialize the whole project'); };
  try { record = prepareProjectRecord('local', state, sources); } finally { JSON.stringify = stringify; }
  const next = prepareProjectRecord('local', state, sources);
  assert.equal(record.assets[0].blob, next.assets[0].blob);
  const cloned = structuredClone(record);
  assert.equal(cloned.layout.frames.at(-1).sounds.at(-1).outline, cloned.layout.frames.at(-2).sounds.at(-1).outline);
  const reopened = await readProjectRecord(cloned);
  assert.deepEqual(reopened.state, state); assert.deepEqual(reopened.sources, sources);
  assert.deepEqual(reducer(reopened.state, { type: 'undo' }), reducer(state, { type: 'undo' }));
});
test('existing browser bundles remain readable with exact audio and Undo history', async () => {
  const { state, sources } = material();
  const bundle = await createProjectBundle(state, sources, 'Earlier project');
  const reopened = await readProjectRecord({ id: 'old', blob: bundle });
  assert.deepEqual(reopened.state, state); assert.deepEqual(reopened.sources, sources); assert.equal(reopened.name, 'Earlier project');
});
test('damaged local records are rejected before replacing a project', async () => {
  await assert.rejects(readProjectRecord({ version: 999, assets: [] }));
  await assert.rejects(readProjectRecord({ version: 3, assets: [{ id: 'own', blob: 'invalid' }] }));
  const { state, sources } = material(), record = prepareProjectRecord('local', state, sources);
  record.assets.push(record.assets[0]); await assert.rejects(readProjectRecord(record));
});
