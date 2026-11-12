import { packState, unpackState, readLimited } from './snapshot.js';

const MAGIC = new TextEncoder().encode('SONIC02\n');
const MAX_METADATA = 64 * 1024 * 1024;
const MAX_PROJECT = 2 * 1024 * 1024 * 1024;
const damaged = () => { throw new Error('This project file is incomplete or damaged.'); };
export function projectName(value) { return (typeof value === 'string' ? value.trim().slice(0, 120) : '') || 'Untitled sketch'; }

export async function createProjectBundle(state, sources, name = 'Untitled sketch') {
  const layout = packState(state, sources, true);
  const json = new TextEncoder().encode(JSON.stringify({ version: 2, name: projectName(name), layout }));
  if (json.length > MAX_METADATA) throw new Error('This project has too many marks to save.');
  const metadata = await readLimited(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')), MAX_METADATA);
  const header = new Uint8Array(12); header.set(MAGIC);
  new DataView(header.buffer).setUint32(8, metadata.length, true);
  const parts = [header, metadata, ...layout.assets.map(asset => sources.get(asset.id))];
  const blob = new Blob(parts, { type: 'application/x-sonic-sketchbook' });
  if (blob.size > MAX_PROJECT) throw new Error('This project exceeds the 2 GB project-file limit.');
  return blob;
}

export async function openProjectBundle(blob) {
  if (!(blob instanceof Blob) || blob.size < 13 || blob.size > MAX_PROJECT) return damaged();
  const header = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (!MAGIC.every((value, index) => value === header[index])) return damaged();
  const length = new DataView(header.buffer).getUint32(8, true);
  if (!length || length > MAX_METADATA || length + 12 > blob.size) return damaged();
  let meta;
  try {
    const json = await readLimited(blob.slice(12, 12 + length).stream().pipeThrough(new DecompressionStream('gzip')), MAX_METADATA);
    meta = JSON.parse(new TextDecoder().decode(json));
  } catch { return damaged(); }
  if (meta?.version !== 2 || !Array.isArray(meta.layout?.assets)) return damaged();
  const sources = new Map(); let offset = 12 + length;
  for (const asset of meta.layout.assets) {
    if (!Number.isSafeInteger(asset.length) || asset.length <= 0 || offset + asset.length > blob.size || sources.has(asset.id)) return damaged();
    sources.set(asset.id, await blob.slice(offset, offset + asset.length).arrayBuffer());
    offset += asset.length;
  }
  if (offset !== blob.size) return damaged();
  return { ...unpackState(meta.layout, sources), name: projectName(meta.name) };
}
