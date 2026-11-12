import { openSnapshot, readLimited, sealSnapshot, MAX_SNAPSHOT_BYTES } from './snapshot.js';

export const SHARE_API = import.meta.env?.VITE_SHARE_API || 'https://sonic-sketchbook-storage-lyu.breezyamber25.chatgpt.site';

export function parseSavedLink(hash) {
  if (!hash.startsWith('#s=')) return null;
  const match = /^#s=([\w-]{32})\.([\w-]{43})$/.exec(hash);
  if (!match) throw new Error('This saved link is incomplete or damaged.');
  return { id: match[1], key: match[2] };
}
async function checked(response) {
  if (response.ok) return response;
  if (response.status === 404) throw new Error('This saved sketch could not be found.');
  if (response.status === 413) throw new Error('This sketch is too large to share. The limit is 20 MB.');
  if (response.status === 429) throw new Error('Please wait a moment before saving again.');
  throw new Error('The sketch could not be saved or opened. Please try again.');
}
export async function saveSketch(state, sources, pageURL = window.location.href, fetcher = fetch) {
  const sealed = await sealSnapshot(state, sources);
  const ticket = await (await checked(await fetcher(`${SHARE_API}/v1/tickets`, {
    method: 'POST', headers: { 'X-Sketch-Intent': 'save' }, credentials: 'omit', signal: AbortSignal.timeout(30000),
  }))).json();
  if (!/^[\w-]{32}$/.test(ticket.id) || !/^[\w-]{43}$/.test(ticket.token)) throw new Error('Saving is temporarily unavailable. Please try again.');
  await checked(await fetcher(`${SHARE_API}/v1/sketches/${ticket.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${ticket.token}`, 'Content-Type': 'application/octet-stream' },
    body: sealed.payload, credentials: 'omit', signal: AbortSignal.timeout(120000),
  }));
  const url = new URL(pageURL); url.search = ''; url.hash = `s=${ticket.id}.${sealed.key}`;
  return url.href;
}
export async function loadSketch(hash, fetcher = fetch) {
  const link = parseSavedLink(hash);
  if (!link) return null;
  const response = await checked(await fetcher(`${SHARE_API}/v1/sketches/${link.id}`, { credentials: 'omit', signal: AbortSignal.timeout(120000) }));
  const bytes = await readLimited(response.body, MAX_SNAPSHOT_BYTES);
  return openSnapshot(bytes, link.key);
}
