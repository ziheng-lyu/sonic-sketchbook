import { validOutline } from './custom-shape.js';
import { VALID_SHAPES, MODES, validScale } from './shapes.js';

export const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const invalid = () => { throw new Error('This saved sketch is incomplete or damaged.'); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const idOK = id => typeof id === 'string' && /^[\w-]{1,100}$/.test(id);

export function base64url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function unbase64url(text) {
  if (typeof text !== 'string' || !/^[\w-]*$/.test(text)) return invalid();
  const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export async function readLimited(stream, limit) {
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('This saved sketch is too large to open.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export function packState(state, sources, binary = false) {
  const paths = [], pathIndex = new Map(), frames = [];
  const wanted = new Set();
  for (const frame of [...state.history, state]) {
    frame.sounds.forEach(sound => wanted.add(sound.id));
    const indices = frame.paths.map(path => {
      path.events.forEach(event => wanted.add(event.soundId));
      if (!pathIndex.has(path.id)) { pathIndex.set(path.id, paths.length); paths.push(path); }
      return pathIndex.get(path.id);
    });
    frames.push({ sounds: frame.sounds, paths: indices, selected: frame.selected });
  }
  const assets = [...wanted].filter(id => !/^seed-[0-4]$/.test(id)).map(id => {
    const bytes = sources.get(id);
    if (!bytes) throw new Error('An audio file is missing. Please add it again before saving.');
    return binary ? { id, length: bytes.byteLength } : { id, data: base64url(new Uint8Array(bytes)) };
  });
  return { version: 1, paths, frames, assets };
}

export function unpackState(data, externalSources = null) {
  if (!data || data.version !== 1 || !Array.isArray(data.paths) || !Array.isArray(data.frames) || !Array.isArray(data.assets)) return invalid();
  if (!data.frames.length || data.frames.length > 10000 || data.paths.length > 2000 || data.assets.length > 500) return invalid();
  const knownSounds = new Set(['seed-0', 'seed-1', 'seed-2', 'seed-3', 'seed-4']);
  const sources = new Map();
  let totalBytes = 0, totalPoints = 0, totalEnvelopePoints = 0;
  for (const asset of data.assets) {
    if (!idOK(asset.id) || knownSounds.has(asset.id)) return invalid();
    const external = externalSources?.get(asset.id);
    if (externalSources && (!(external instanceof ArrayBuffer) || external.byteLength !== asset.length)) return invalid();
    const bytes = externalSources ? new Uint8Array(external) : unbase64url(asset.data);
    totalBytes += bytes.length;
    if (!bytes.length || totalBytes > (externalSources ? 2 * 1024 * 1024 * 1024 : MAX_JSON_BYTES)) return invalid();
    sources.set(asset.id, bytes.buffer); knownSounds.add(asset.id);
  }
  const pathIds = new Set();
  const paths = data.paths.map(path => {
    if (!idOK(path.id) || pathIds.has(path.id) || !Array.isArray(path.points) || !Array.isArray(path.events) || !finite(path.duration) || path.duration < 0 || path.duration > 86400000) return invalid();
    pathIds.add(path.id);
    totalPoints += path.points.length;
    if (path.points.length < 2 || totalPoints > 1000000 || path.events.length > 50000) return invalid();
    let lastTime = 0;
    const points = path.points.map(p => {
      if (!finite(p.x) || !finite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || !finite(p.t) || p.t < lastTime || p.t > path.duration) return invalid();
      lastTime = p.t;
      return { x: p.x, y: p.y, t: p.t };
    });
    lastTime = 0;
    const events = path.events.map(event => {
      if (!knownSounds.has(event.soundId) || !finite(event.at) || event.at < lastTime || event.at > path.duration) return invalid();
      lastTime = event.at;
      let envelope;
      if (event.envelope !== undefined) {
        if (!Array.isArray(event.envelope) || event.envelope.length < 2) return invalid();
        totalEnvelopePoints += event.envelope.length;
        if (totalEnvelopePoints > 2000000) return invalid();
        let lastAt = 0;
        envelope = event.envelope.map(point => {
          if (!finite(point.at) || point.at < lastAt || point.at > path.duration - event.at + 20 || !finite(point.gain) || point.gain < 0 || point.gain > 1) return invalid();
          lastAt = point.at;
          return { at: point.at, gain: point.gain };
        });
        if (envelope[0].at !== 0 || envelope.at(-1).gain !== 0) return invalid();
      }
      return { soundId: event.soundId, at: event.at, ...(envelope ? { envelope } : {}) };
    });
    return { id: path.id, points, events, duration: path.duration };
  });
  const outlines = new Map();
  const frames = data.frames.map(frame => {
    if (!Array.isArray(frame.sounds) || !Array.isArray(frame.paths) || frame.sounds.length > 505 || frame.paths.length > 2000) return invalid();
    const ids = new Set();
    const sounds = frame.sounds.map(sound => {
      if (!knownSounds.has(sound.id) || ids.has(sound.id) || !finite(sound.x) || !finite(sound.y) || sound.x < 0 || sound.x > 1 || sound.y < 0 || sound.y > 1) return invalid();
      if (sound.parked !== undefined && (typeof sound.parked !== 'boolean' || (sound.parked && !/^seed-[0-4]$/.test(sound.id)))) return invalid();
      if (sound.mode !== undefined && !MODES.includes(sound.mode)) return invalid();
      if (sound.shape !== undefined && !VALID_SHAPES.includes(sound.shape)) return invalid();
      if (sound.scale !== undefined && !validScale(sound.scale)) return invalid();
      let outline;
      if (sound.outline !== undefined) {
        if (!Array.isArray(sound.outline) || sound.outline.length > 192) return invalid();
        const key = JSON.stringify(sound.outline);
        if (!outlines.has(key)) {
          if (!validOutline(sound.outline)) return invalid();
          outlines.set(key, sound.outline.map(p => ({ x: p.x, y: p.y })));
        }
        outline = outlines.get(key);
      }
      if (sound.shape === 'custom' && !outline) return invalid();
      ids.add(sound.id);
      return { id: sound.id, x: sound.x, y: sound.y, ...(sound.parked !== undefined ? { parked: sound.parked } : {}), ...(sound.mode !== undefined ? { mode: sound.mode } : {}), ...(sound.shape !== undefined ? { shape: sound.shape } : {}), ...(outline ? { outline } : {}), ...(sound.scale !== undefined ? { scale: sound.scale } : {}) };
    });
    const seen = new Set();
    const marks = frame.paths.map(index => {
      if (!Number.isInteger(index) || !paths[index] || seen.has(index)) return invalid();
      seen.add(index); return paths[index];
    });
    if (frame.selected !== null && !marks.some(path => path.id === frame.selected)) return invalid();
    return { sounds, paths: marks, selected: frame.selected };
  });
  const current = frames.pop();
  return { state: { ...current, history: frames }, sources };
}

export async function sealSnapshot(state, sources) {
  const json = new TextEncoder().encode(JSON.stringify(packState(state, sources)));
  if (json.byteLength > MAX_JSON_BYTES) throw new Error('This sketch is too large to share. The limit is 20 MB.');
  const compressed = await readLimited(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')), MAX_SNAPSHOT_BYTES - 28);
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compressed));
  const payload = new Uint8Array(12 + cipher.length); payload.set(iv); payload.set(cipher, 12);
  return { payload, key: base64url(new Uint8Array(await crypto.subtle.exportKey('raw', key))) };
}

export async function openSnapshot(payload, keyText) {
  const bytes = new Uint8Array(payload);
  if (bytes.length < 29 || bytes.length > MAX_SNAPSHOT_BYTES) return invalid();
  const raw = unbase64url(keyText);
  if (raw.length !== 32) return invalid();
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  let compressed;
  try { compressed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)); }
  catch { throw new Error('This saved link is incomplete or damaged.'); }
  const json = await readLimited(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_JSON_BYTES);
  return unpackState(JSON.parse(new TextDecoder().decode(json)));
}
