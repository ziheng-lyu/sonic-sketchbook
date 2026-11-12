import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer } from '../src/model.js';
import { createProjectBundle, openProjectBundle } from '../src/bundle.js';
import { saveSketch, loadSketch, parseSavedLink, CHUNK_SIZE } from '../src/share.js';
import { sealSnapshot } from '../src/snapshot.js';
import worker from '../sharing-service/worker/index.js';

class Bucket {
  data = new Map();
  async put(key, value, options = {}) {
    if (options.onlyIf && this.data.has(key)) return null;
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    this.data.set(key, bytes); return { key };
  }
  async head(key) { const bytes = this.data.get(key); return bytes ? { size: bytes.length } : null; }
  async get(key) { const bytes = this.data.get(key); return bytes ? { size: bytes.length, body: new Blob([bytes]).stream(), json: async () => JSON.parse(new TextDecoder().decode(bytes)) } : null; }
  async delete(key) { this.data.delete(key); }
}
function client(bucket, record = []) {
  return async (url, options = {}) => {
    if (options.body instanceof Blob) options = { ...options, body: new Uint8Array(await options.body.arrayBuffer()) };
    if (options.body) record.push(options.body.byteLength);
    return worker.fetch(new Request(url, { ...options, headers: { Origin: 'https://ziheng-lyu.github.io', ...options.headers } }), { BUCKET: bucket });
  };
}
function material(bytes) {
  let state = initialState();
  state = reducer(state, { type: 'add', sounds: [{ id: 'own-sound', x: .4, y: .4 }] });
  state = reducer(state, { type: 'path', path: { id: 'my-path', points: [{ x: .1, y: .4, t: 0 }, { x: .8, y: .4, t: 3200 }], duration: 3200, events: [{ soundId: 'own-sound', at: 1234.567 }] } });
  return { state, sources: new Map([['own-sound', bytes.buffer]]) };
}

test('project file round trip preserves its name, audio bytes, exact marks and undo history', async () => {
  const { state, sources } = material(new Uint8Array([82, 73, 70, 70, 1, 2, 3]));
  const bundle = await createProjectBundle(state, sources, 'My afternoon');
  const restored = await openProjectBundle(bundle);
  assert.equal(restored.name, 'My afternoon');
  assert.deepEqual(restored.state, state); assert.deepEqual(restored.sources, sources);
  assert.deepEqual(reducer(restored.state, { type: 'undo' }), reducer(state, { type: 'undo' }));
});
test('project files store audio as raw bytes without base64 expansion, beyond the old 20 MB limit', async () => {
  const bytes = new Uint8Array(26 * 1024 * 1024); bytes[0] = 82; bytes[bytes.length - 1] = 255;
  const { state, sources } = material(bytes);
  const bundle = await createProjectBundle(state, sources, 'Large project');
  assert.ok(bundle.size > 20 * 1024 * 1024 && bundle.size < bytes.length + 10000);
  const restored = await openProjectBundle(bundle);
  assert.equal(restored.sources.get('own-sound').byteLength, bytes.length);
  assert.equal(new Uint8Array(restored.sources.get('own-sound')).at(-1), 255);
});
test('large shares use bounded encrypted chunks and reopen without losing source bytes', async () => {
  const bytes = new Uint8Array(26 * 1024 * 1024); bytes[0] = 7; bytes[bytes.length - 1] = 21;
  const { state, sources } = material(bytes), bucket = new Bucket(), requests = [];
  const url = await saveSketch(state, sources, 'https://ziheng-lyu.github.io/sonic-sketchbook/', client(bucket, requests), 'Large share');
  assert.equal(parseSavedLink(new URL(url).hash).version, 2);
  assert.ok(requests.length >= 5 && requests.every(size => size <= CHUNK_SIZE + 28));
  const restored = await loadSketch(new URL(url).hash, client(bucket));
  assert.equal(restored.name, 'Large share'); assert.deepEqual(restored.state, state);
  assert.deepEqual(restored.sources, sources);
});
test('previous single-object share links still reopen with their original state', async () => {
  const bucket = new Bucket(), state = initialState(), sealed = await sealSnapshot(state, new Map());
  const id = 'a'.repeat(32); await bucket.put(`sketches/${id}`, sealed.payload);
  assert.deepEqual((await loadSketch(`#s=${id}.${sealed.key}`, client(bucket))).state, state);
});
test('partial uploads are not published, grants cannot alter completed shares, and chunk bounds are enforced', async () => {
  const bucket = new Bucket(), fetcher = client(bucket);
  const ticket = await (await fetcher('https://storage/v2/tickets', { method: 'POST', headers: { 'X-Sketch-Intent': 'save' } })).json();
  const endpoint = `https://storage/v2/sketches/${ticket.id}`;
  const headers = { Authorization: `Bearer ${ticket.token}`, 'Content-Type': 'application/octet-stream' };
  assert.equal((await fetcher(endpoint, { method: 'PUT', headers: { ...headers, 'X-Chunk-Count': '2' }, body: new Uint8Array(30) })).status, 400);
  assert.equal((await fetcher(`${endpoint}/chunks/0`, { method: 'PUT', headers, body: new Uint8Array(30) })).status, 201);
  assert.equal((await fetcher(`${endpoint}/chunks/0`)).status, 404);
  assert.equal((await fetcher(`${endpoint}/chunks/32`, { method: 'PUT', headers, body: new Uint8Array(30) })).status, 400);
  assert.equal((await fetcher(`${endpoint}/chunks/1`, { method: 'PUT', headers: { ...headers, 'Content-Length': String(CHUNK_SIZE + 29) }, body: new Uint8Array(30) })).status, 413);
  assert.equal((await fetcher(endpoint, { method: 'PUT', headers: { ...headers, 'X-Chunk-Count': '1' }, body: new Uint8Array(30) })).status, 201);
  assert.equal((await fetcher(`${endpoint}/chunks/0`)).status, 200);
  assert.equal((await fetcher(`${endpoint}/chunks/0`, { method: 'PUT', headers, body: new Uint8Array(30) })).status, 403);
});
test('damaged project files are rejected without accepting truncated audio', async () => {
  const { state, sources } = material(new Uint8Array([1, 2, 3, 4]));
  const bundle = await createProjectBundle(state, sources);
  await assert.rejects(openProjectBundle(bundle.slice(0, bundle.size - 1)), /damaged/);
  await assert.rejects(openProjectBundle(new Blob(['wrong file'])), /damaged/);
});
