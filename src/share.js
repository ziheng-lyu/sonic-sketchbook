import { openSnapshot, readLimited, MAX_SNAPSHOT_BYTES, base64url, unbase64url } from './snapshot.js';
import { createProjectBundle, openProjectBundle } from './bundle.js';

export const SHARE_API = import.meta.env?.VITE_SHARE_API || 'https://sonic-sketchbook-storage-lyu.breezyamber25.chatgpt.site';
export const SHARE_LIMIT = 250 * 1024 * 1024;
export const CHUNK_SIZE = 8 * 1024 * 1024;
export function isSavedLink(hash) { return hash.startsWith('#s=') || hash.startsWith('#s2='); }
export function parseSavedLink(hash) {
  if (!isSavedLink(hash)) return null;
  const match = /^#(s2|s)=([\w-]{32})\.([\w-]{43})$/.exec(hash);
  if (!match) throw new Error('This saved link is incomplete or damaged.');
  return { id: match[2], key: match[3], ...(match[1] === 's2' ? { version: 2 } : {}) };
}
async function checked(response) {
  if (response.ok) return response;
  if (response.status === 404) throw new Error('This saved sketch could not be found.');
  if (response.status === 413) throw new Error('This share is too large. Save or export the project instead.');
  if (response.status === 429) throw new Error('Please wait a moment before sharing again.');
  throw new Error('The shared sketch could not be saved or opened. Please try again. Your project is unchanged.');
}
async function sealBytes(bytes, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return new Blob([iv, cipher]);
}
async function openBytes(blob, key, limit) {
  if (blob.size < 29 || blob.size > limit) throw new Error('This saved link is incomplete or damaged.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  try { return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)); }
  catch { throw new Error('This saved link is incomplete or damaged.'); }
}
export async function saveSketch(state, sources, pageURL = window.location.href, fetcher = fetch, name = 'Untitled sketch') {
  const bundle = await createProjectBundle(state, sources, name);
  if (bundle.size > SHARE_LIMIT) throw new Error('This project is larger than the 250 MB sharing limit. Save or export it as a project to keep everything.');
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const ticket = await (await checked(await fetcher(`${SHARE_API}/v2/tickets`, {
    method: 'POST', headers: { 'X-Sketch-Intent': 'save' }, credentials: 'omit', signal: AbortSignal.timeout(30000),
  }))).json();
  if (!/^[\w-]{32}$/.test(ticket.id) || !/^[\w-]{43}$/.test(ticket.token)) throw new Error('Sharing is temporarily unavailable. Please try again.');
  const endpoint = `${SHARE_API}/v2/sketches/${ticket.id}`;
  const chunks = [];
  for (let offset = 0, index = 0; offset < bundle.size; offset += CHUNK_SIZE, index++) {
    const bytes = await bundle.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    const encrypted = await sealBytes(bytes, key); chunks.push(encrypted.size);
    await checked(await fetcher(`${endpoint}/chunks/${index}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${ticket.token}`, 'Content-Type': 'application/octet-stream' },
      body: encrypted, credentials: 'omit', signal: AbortSignal.timeout(120000),
    }));
  }
  const manifest = await sealBytes(new TextEncoder().encode(JSON.stringify({ version: 2, size: bundle.size, chunks })), key);
  await checked(await fetcher(endpoint, {
    method: 'PUT', headers: { Authorization: `Bearer ${ticket.token}`, 'Content-Type': 'application/octet-stream', 'X-Chunk-Count': String(chunks.length) },
    body: manifest, credentials: 'omit', signal: AbortSignal.timeout(30000),
  }));
  const raw = base64url(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
  const url = new URL(pageURL); url.search = ''; url.hash = `s2=${ticket.id}.${raw}`;
  return url.href;
}
export async function loadSketch(hash, fetcher = fetch) {
  const link = parseSavedLink(hash);
  if (!link) return null;
  if (link.version !== 2) {
    const response = await checked(await fetcher(`${SHARE_API}/v1/sketches/${link.id}`, { credentials: 'omit', signal: AbortSignal.timeout(120000) }));
    return openSnapshot(await readLimited(response.body, MAX_SNAPSHOT_BYTES), link.key);
  }
  const raw = unbase64url(link.key);
  if (raw.length !== 32) throw new Error('This saved link is incomplete or damaged.');
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
  const endpoint = `${SHARE_API}/v2/sketches/${link.id}`;
  const response = await checked(await fetcher(endpoint, { credentials: 'omit', signal: AbortSignal.timeout(30000) }));
  const manifestBlob = new Blob([await readLimited(response.body, 65536)]);
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(await openBytes(manifestBlob, key, 65536))); }
  catch { throw new Error('This saved link is incomplete or damaged.'); }
  if (manifest.version !== 2 || !Number.isSafeInteger(manifest.size) || manifest.size <= 0 || manifest.size > SHARE_LIMIT || !Array.isArray(manifest.chunks) || manifest.chunks.length !== Math.ceil(manifest.size / CHUNK_SIZE) || manifest.chunks.some((size, index) => size !== Math.min(CHUNK_SIZE, manifest.size - index * CHUNK_SIZE) + 28)) throw new Error('This saved link is incomplete or damaged.');
  const parts = [];
  for (let i = 0; i < manifest.chunks.length; i++) {
    const result = await checked(await fetcher(`${endpoint}/chunks/${i}`, { credentials: 'omit', signal: AbortSignal.timeout(120000) }));
    const bytes = await readLimited(result.body, CHUNK_SIZE + 28);
    if (bytes.length !== manifest.chunks[i]) throw new Error('This saved link is incomplete or damaged.');
    parts.push(await openBytes(new Blob([bytes]), key, CHUNK_SIZE + 28));
  }
  return openProjectBundle(new Blob(parts));
}
