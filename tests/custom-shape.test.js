import test from 'node:test';
import assert from 'node:assert/strict';
import { makeOutline, validOutline, insidePolygon, boundaryDistance, customInsetPath } from '../src/custom-shape.js';
import { shapePath, shapeDistance, shapeIntervals } from '../src/shapes.js';
import { ListeningGesture } from '../src/listening.js';
import { initialState, reducer } from '../src/model.js';
import { createProjectBundle, openProjectBundle } from '../src/bundle.js';
import { packState, unpackState } from '../src/snapshot.js';

const concave = [{ x: -75, y: -60 }, { x: 75, y: -60 }, { x: 75, y: 60 }, { x: 30, y: 60 }, { x: 30, y: -15 }, { x: -30, y: -15 }, { x: -30, y: 60 }, { x: -75, y: 60 }, { x: -75, y: -60 }];

test('freehand fitting preserves concavity, fits the material size and anchors an interior point', () => {
  const outline = makeOutline(concave);
  assert.ok(validOutline(outline)); assert.ok(insidePolygon({ x: 0, y: 0 }, outline));
  assert.ok(outline.every(p => Math.hypot(p.x, p.y) <= 1.000001));
  assert.equal(outline.length, concave.length); assert.ok(shapePath('custom', 22, outline).endsWith('Z'));
  assert.ok(shapeDistance({ x: 0, y: 0 }, 'custom', 34, outline) < .02);
  assert.ok(customInsetPath(outline, .33, 34).length > 0);
});
test('dense slow strokes retain a valid outline and excessive samples are bounded', () => {
  const dense = Array.from({ length: 12000 }, (_, i) => ({ x: Math.cos(i / 11999 * Math.PI * 2) * 70, y: Math.sin(i / 11999 * Math.PI * 2) * 55 }));
  const outline = makeOutline(dense);
  assert.ok(validOutline(outline)); assert.ok(outline.length <= 192);
});
test('concave and self-crossing geometry has the same even-odd interior as its visible outline', () => {
  const bow = [{ x: -70, y: -55 }, { x: 70, y: 55 }, { x: -70, y: 55 }, { x: 70, y: -55 }];
  for (const points of [concave, bow]) {
    const outline = makeOutline(points); assert.ok(validOutline(outline));
    let separate = false;
    for (let y = -36; y <= 36; y += 3) {
      const ranges = shapeIntervals({ x: -45, y }, { x: 45, y }, 'custom', 34, outline);
      if (ranges.length > 1) separate = true;
      for (let i = 0; i < 160; i++) {
        const t = (i + .5) / 160, point = { x: -45 + t * 90, y };
        if (boundaryDistance({ x: point.x / 34, y: point.y / 34 }, outline) < 1e-7) continue;
        assert.equal(ranges.some(([start, end]) => t > start && t < end), insidePolygon({ x: point.x / 34, y: point.y / 34 }, outline));
      }
    }
    if (points === concave) assert.ok(separate, 'empty notch splits a stroke into separate visits');
  }
});
test('custom outlines support whole-clip and proximity listening with bounded continuous gain', () => {
  const outline = makeOutline(concave);
  for (const mode of ['trigger', 'proximity']) {
    const g = new ListeningGesture([{ id: 'seed-0', x: .5, y: .5, shape: 'custom', outline, mode }], { width: 1000, height: 600 });
    g.advance({ x: .4, y: .5, t: 0 }, { x: .6, y: .5, t: 1000 });
    assert.ok(g.events.length > 0);
    for (const event of g.events) if (mode === 'proximity') {
      assert.ok(event.envelope.every(p => Number.isFinite(p.gain) && p.gain >= 0 && p.gain <= 1));
      assert.equal(event.envelope.at(-1).gain, 0);
    } else assert.equal(event.envelope, undefined);
  }
});
test('hand-drawn silhouettes survive project files, presets, mode changes, and undo', async () => {
  const outline = makeOutline(concave), before = initialState();
  let state = reducer(before, { type: 'configure', id: 'seed-0', shape: 'custom', outline });
  assert.deepEqual(reducer(state, { type: 'undo' }), before);
  state = reducer(state, { type: 'configure', id: 'seed-0', mode: 'proximity' });
  state = reducer(state, { type: 'configure', id: 'seed-0', shape: 'triangle' });
  assert.equal(state.sounds[0].outline, outline);
  state = reducer(state, { type: 'undo' }); assert.equal(state.sounds[0].shape, 'custom');
  const saved = await openProjectBundle(await createProjectBundle(state, new Map()));
  assert.deepEqual(saved.state, state);
  assert.deepEqual(reducer(saved.state, { type: 'undo' }), reducer(state, { type: 'undo' }));
});
test('degenerate, nonfinite, missing and oversized outlines are safely rejected', () => {
  assert.equal(makeOutline([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]), null);
  const outline = makeOutline(concave), state = reducer(initialState(), { type: 'configure', id: 'seed-0', shape: 'custom', outline });
  for (const bad of [undefined, [], [{ x: Infinity, y: 0 }], Array(193).fill({ x: 0, y: 0 }), [{ x: 0, y: 0 }, { x: 3, y: 1 }, { x: 1, y: 1 }]]) {
    const data = structuredClone(packState(state, new Map()));
    if (bad === undefined) delete data.frames.at(-1).sounds[0].outline;
    else data.frames.at(-1).sounds[0].outline = bad;
    assert.throws(() => unpackState(data));
  }
  const plain = initialState(); assert.equal(reducer(plain, { type: 'configure', id: 'seed-0', shape: 'custom' }), plain);
});
