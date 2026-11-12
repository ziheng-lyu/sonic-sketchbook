// Local integration test server. Saved test objects live only in this process.
import http from 'node:http';
import { Readable } from 'node:stream';
import worker from '../sharing-service/worker/index.js';
const objects = new Map();
const BUCKET = {
  async put(key, value, options = {}) {
    if (options.onlyIf && objects.has(key)) return null;
    objects.set(key, typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));
    return { key };
  },
  async get(key) {
    const value = objects.get(key);
    return value ? { size: value.length, body: new Blob([value]).stream(), json: async () => JSON.parse(new TextDecoder().decode(value)) } : null;
  },
  async delete(key) { objects.delete(key); },
};
http.createServer(async (incoming, outgoing) => {
  try {
    const options = { method: incoming.method, headers: incoming.headers };
    if (!['GET', 'HEAD'].includes(incoming.method)) {
      let size = 0; const parts = [];
      for await (const part of incoming) { size += part.length; if (size > 21 * 1024 * 1024) throw Error('too large'); parts.push(part); }
      options.body = Buffer.concat(parts);
    }
    const response = await worker.fetch(new Request(`http://127.0.0.1:4177${incoming.url}`, options), { BUCKET });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing); else outgoing.end();
  } catch { outgoing.writeHead(500); outgoing.end(); }
}).listen(4177, '127.0.0.1', () => console.log('Local snapshot test service http://127.0.0.1:4177'));
