import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer } from '../src/model.js';
import { packState, unpackState, sealSnapshot, openSnapshot, readLimited } from '../src/snapshot.js';
import { parseSavedLink, saveSketch, loadSketch } from '../src/share.js';
import { AudioEngine } from '../src/audio.js';
import worker from '../sharing-service/worker/index.js';

const ORIGIN = 'https://ziheng-lyu.github.io';
function sample() {
  let state = initialState();
  const id = 'recorded-audio';
  const sources = new Map([[id, new Uint8Array([82, 73, 70, 70, 8, 5, 3, 2]).buffer]]);
  state = reducer(state, { type: 'add', sounds: [{ id, x: .2, y: .3 }] });
  state = reducer(state, { type: 'path', path: { id: 'path-a', points: [{ x: .1, y: .1, t: 0 }, { x: .2, y: .3, t: 1023.75 }, { x: .1, y: .1, t: 4100 }], events: [{ soundId: id, at: 987.125 }, { soundId: 'seed-0', at: 3800.25 }], duration: 4100 } });
  state = reducer(state, { type: 'move', id, position: { x: .8, y: .7 } });
  state = reducer(state, { type: 'path', path: { id: 'path-b', points: [{ x: .1, y: .5, t: 0 }, { x: .8, y: .5, t: 200 }], events: [], duration: 200 } });
  return { state, sources };
}
class MemoryBucket {
  data = new Map();
  async put(key, value, options = {}) {
    if (options.onlyIf && this.data.has(key)) return null;
    this.data.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));
    return { key };
  }
  async get(key) {
    const value = this.data.get(key);
    return value ? { size: value.length, body: new Blob([value]).stream(), json: async () => JSON.parse(new TextDecoder().decode(value)) } : null;
  }
  async delete(key) { this.data.delete(key); }
}
function service(bucket) {
  return (url, options = {}) => worker.fetch(new Request(url, { ...options, headers: { Origin: ORIGIN, ...options.headers } }), { BUCKET: bucket });
}

test('snapshot round trip preserves sounds, every mark, exact timing, selection, source bytes and undo history', () => {
  const { state, sources } = sample();
  const packed = packState(state, sources);
  assert.equal(packed.paths.length, 2);
  const saved = unpackState(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(saved.state, state);
  assert.deepEqual(saved.sources, sources);
  assert.deepEqual(reducer(saved.state, { type: 'undo' }), reducer(state, { type: 'undo' }));
  assert.deepEqual(reducer(reducer(saved.state, { type: 'undo' }), { type: 'undo' }), reducer(reducer(state, { type: 'undo' }), { type: 'undo' }));
});
test('AES-GCM snapshots hide audio and coordinates; changed ciphertext and wrong keys are rejected', async () => {
  const { state, sources } = sample();
  const one = await sealSnapshot(state, sources), two = await sealSnapshot(state, sources);
  assert.notDeepEqual(one.payload, two.payload);
  assert.ok(!new TextDecoder().decode(one.payload).includes('recorded-audio'));
  assert.deepEqual((await openSnapshot(one.payload, one.key)).state, state);
  await assert.rejects(openSnapshot(one.payload, two.key));
  one.payload[20] ^= 1;
  await assert.rejects(openSnapshot(one.payload, one.key));
});
test('malformed snapshots reject invalid coordinates, missing assets, invalid selections and unknown sound triggers', () => {
  const { state, sources } = sample();
  for (const mutate of [
    data => { data.frames.at(-1).sounds[0].x = -3; },
    data => { data.assets = []; },
    data => { data.frames.at(-1).selected = 'missing'; },
    data => { data.paths[0].events[0].soundId = 'missing'; },
    data => { data.paths[0].events[0].at = -1; },
    data => { data.frames.at(-1).paths = [999]; },
  ]) {
    const data = structuredClone(packState(state, sources)); mutate(data);
    assert.throws(() => unpackState(data));
  }
});
test('link parser validates complete keys and recognizes clean sketchbooks', () => {
  assert.equal(parseSavedLink(''), null);
  assert.equal(parseSavedLink('#anything'), null);
  assert.throws(() => parseSavedLink('#s=bad'));
  assert.deepEqual(parseSavedLink(`#s=${'a'.repeat(32)}.${'b'.repeat(43)}`), { id: 'a'.repeat(32), key: 'b'.repeat(43) });
});
test('oversized response streams are cancelled before parsing', async () => {
  await assert.rejects(readLimited(new Blob(['123456789']).stream(), 4), /too large/);
});
test('save then reopen works from a fresh client with no browser storage, with immutable independent snapshots', async () => {
  const { state, sources } = sample(), bucket = new MemoryBucket(), fetcher = service(bucket);
  const url = await saveSketch(state, sources, 'https://ziheng-lyu.github.io/sonic-sketchbook/?old=yes', fetcher);
  assert.ok(url.length < 150);
  assert.equal(new URL(url).search, '');
  const restored = await loadSketch(new URL(url).hash, service(bucket));
  assert.deepEqual(restored.state, state); assert.deepEqual(restored.sources, sources);
  const changed = reducer(restored.state, { type: 'move', id: 'seed-0', position: { x: .01, y: .02 } });
  const newURL = await saveSketch(changed, sources, url, fetcher);
  assert.notEqual(newURL, url);
  assert.deepEqual((await loadSketch(new URL(url).hash, fetcher)).state, state);
  assert.deepEqual((await loadSketch(new URL(newURL).hash, fetcher)).state, changed);
});
test('upload grants authorize a single bounded immutable write and cannot overwrite another snapshot', async () => {
  const bucket = new MemoryBucket(), fetcher = service(bucket);
  const ticket = await (await fetcher('https://storage/v1/tickets', { method: 'POST', headers: { 'X-Sketch-Intent': 'save' } })).json();
  const endpoint = `https://storage/v1/sketches/${ticket.id}`;
  const bytes = new Uint8Array(64);
  const put = token => fetcher(endpoint, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: bytes });
  assert.equal((await put('z'.repeat(43))).status, 403);
  assert.equal((await put(ticket.token)).status, 201);
  assert.equal((await put(ticket.token)).status, 403);
  assert.equal((await fetcher(endpoint)).status, 200);
  assert.equal((await fetcher(endpoint, { method: 'DELETE' })).status, 405);
  assert.equal((await fetcher('https://storage/v1/sketches')).status, 404);
});
test('server rejects disallowed origins, expired grants and oversized uploads', async () => {
  const bucket = new MemoryBucket(), fetcher = service(bucket);
  assert.equal((await worker.fetch(new Request('https://storage/v1/tickets', { method: 'POST', headers: { Origin: 'https://unrelated.example', 'X-Sketch-Intent': 'save' } }), { BUCKET: bucket })).status, 403);
  const ticket = await (await fetcher('https://storage/v1/tickets', { method: 'POST', headers: { 'X-Sketch-Intent': 'save' } })).json();
  const key = `tickets/${ticket.id}`;
  const metadata = JSON.parse(new TextDecoder().decode(bucket.data.get(key)));
  const endpoint = `https://storage/v1/sketches/${ticket.id}`;
  const headers = { Authorization: `Bearer ${ticket.token}`, 'Content-Type': 'application/octet-stream' };
  assert.equal((await fetcher(endpoint, { method: 'PUT', headers: { ...headers, 'Content-Length': '25000000' }, body: new Uint8Array(30) })).status, 413);
  metadata.expires = 0; await bucket.put(key, JSON.stringify(metadata));
  assert.equal((await fetcher(endpoint, { method: 'PUT', headers, body: new Uint8Array(30) })).status, 403);
});
test('errors keep caller state intact and never produce a misleading saved link', async () => {
  const { state, sources } = sample(), before = JSON.stringify(state);
  await assert.rejects(saveSketch(state, sources, 'https://example.com', async () => new Response('', { status: 503 })), /could not/);
  assert.equal(JSON.stringify(state), before);
  await assert.rejects(loadSketch(`#s=${'a'.repeat(32)}.${'b'.repeat(43)}`, async () => new Response('', { status: 404 })), /could not be found/);
});

 test('superseded restoration never replaces currently playable audio buffers', async () => {
  const audio = new AudioEngine();
  const oldBuffer = { length: 10 };
  audio.buffers.set('shared', oldBuffer);
  let resolve, active = true;
  audio.context = () => ({ decodeAudioData: () => new Promise(done => { resolve = done; }) });
  const pending = audio.restoreSources(new Map([['shared', new Uint8Array([1, 2, 3]).buffer]]), () => active);
  active = false; resolve({ length: 30 });
  assert.equal(await pending, false);
  assert.equal(audio.buffers.get('shared'), oldBuffer);
});

test('saved links retain corner-row state and moved defaults, and older links keep their arrangement', () => {
  const initial = initialState();
  const moved = reducer(initial, { type: 'move', id: 'seed-1', position: { x: .5, y: .6 } });
  assert.deepEqual(unpackState(packState(moved, new Map())).state, moved);
  const legacy = initialState();
  legacy.sounds = legacy.sounds.map(({ parked, ...sound }) => sound);
  assert.deepEqual(unpackState(packState(legacy, new Map())).state, legacy);
});
