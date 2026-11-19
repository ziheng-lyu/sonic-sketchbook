// Audio sources are immutable. Reuse the same Blob for local saves and exports;
// IndexedDB can retain a Blob reference without recopying every audio buffer.
const blobs = new WeakMap();
export function sourceBlob(bytes) {
  if (!blobs.has(bytes)) blobs.set(bytes, new Blob([bytes]));
  return blobs.get(bytes);
}
