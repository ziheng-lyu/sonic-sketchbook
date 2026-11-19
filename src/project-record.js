import { packState, unpackState } from './snapshot.js';
import { openProjectBundle } from './bundle.js';
import { sourceBlob } from './materials.js';

// Browser-local records use structured cloning. It preserves shared outline and
// path references across Undo frames, avoiding repeated JSON encoding and gzip
// during autosave. Portable files and shared links keep the existing format.
export function prepareProjectRecord(id, state, sources) {
  const layout = packState(state, sources, true);
  if (layout.assets.reduce((sum, asset) => sum + asset.length, 0) > 2 * 1024 * 1024 * 1024) throw new Error('This project exceeds the 2 GB project-file limit.');
  return { id, version: 3, layout, assets: layout.assets.map(asset => ({ id: asset.id, blob: sourceBlob(sources.get(asset.id)) })) };
}
export async function readProjectRecord(record) {
  // Existing browser projects and deletion recovery bundles remain readable.
  if (record?.blob instanceof Blob) return openProjectBundle(record.blob);
  if (record?.version !== 3 || !Array.isArray(record.assets) || record.assets.length > 500) throw new Error('This project could not be opened.');
  const sources = new Map(); let bytes = 0;
  for (const asset of record.assets) {
    if (!(asset.blob instanceof Blob) || sources.has(asset.id)) throw new Error('This project could not be opened.');
    bytes += asset.blob.size;
    if (bytes > 2 * 1024 * 1024 * 1024) throw new Error('This project exceeds the 2 GB project-file limit.');
    sources.set(asset.id, await asset.blob.arrayBuffer());
  }
  return unpackState(record.layout, sources);
}
