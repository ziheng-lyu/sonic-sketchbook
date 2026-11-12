const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set(['https://ziheng-lyu.github.io', 'http://127.0.0.1:4175', 'http://localhost:4175']);
const encoder = new TextEncoder();
function random(size) {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(size)))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
async function digest(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
async function bodyBytes(body) {
  const reader = body?.getReader();
  if (!reader) throw new Error('empty');
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin' };
    if (ALLOWED.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
    const json = (data, status = 200) => Response.json(data, { status, headers });
    const path = new URL(request.url).pathname;
    if (path === '/' && request.method === 'GET') return json({ service: 'Sonic sketchbook encrypted snapshots', ready: !!env.BUCKET });
    if (!ALLOWED.has(origin)) return json({ error: 'Origin not allowed' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Sketch-Intent', 'Access-Control-Max-Age': '3600' } });
    if (!env.BUCKET) return json({ error: 'Storage unavailable' }, 503);
    try {
      if (path === '/v1/tickets' && request.method === 'POST') {
        if (request.headers.get('X-Sketch-Intent') !== 'save') return json({ error: 'Save intent required' }, 400);
        // A bounded, single-use upload grant. No client receives storage credentials.
        // A one-second IP slot limits repeated issuance without retaining raw IPs.
        const ip = request.headers.get('CF-Connecting-IP');
        if (ip) {
          const slot = `limits/${Math.floor(Date.now() / 1000)}/${(await digest(ip)).slice(0, 32)}`;
          const allowed = await env.BUCKET.put(slot, '1', { onlyIf: { etagDoesNotMatch: '*' } });
          if (!allowed) return json({ error: 'Please wait a moment' }, 429);
        }
        const id = random(24), token = random(32);
        await env.BUCKET.put(`tickets/${id}`, JSON.stringify({ hash: await digest(token), expires: Date.now() + 300000 }));
        return json({ id, token }, 201);
      }
      const match = /^\/v1\/sketches\/([\w-]{32})$/.exec(path);
      if (!match) return json({ error: 'Not found' }, 404);
      const id = match[1], key = `sketches/${id}`;
      if (request.method === 'GET') {
        const object = await env.BUCKET.get(key);
        if (!object) return json({ error: 'Sketch not found' }, 404);
        return new Response(object.body, { headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(object.size) } });
      }
      if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);
      const token = /^Bearer ([\w-]{43})$/.exec(request.headers.get('Authorization') || '')?.[1];
      if (!token) return json({ error: 'Upload grant required' }, 401);
      const ticketObject = await env.BUCKET.get(`tickets/${id}`);
      if (!ticketObject) return json({ error: 'Upload grant expired' }, 403);
      const ticket = await ticketObject.json();
      if (ticket.expires < Date.now() || !same(ticket.hash, await digest(token))) return json({ error: 'Invalid upload grant' }, 403);
      if (request.headers.get('Content-Type') !== 'application/octet-stream') return json({ error: 'Encrypted bytes required' }, 415);
      if (Number(request.headers.get('Content-Length')) > MAX_BYTES) return json({ error: 'Sketch too large' }, 413);
      const bytes = await bodyBytes(request.body);
      if (bytes.length < 29) return json({ error: 'Incomplete sketch' }, 400);
      const stored = await env.BUCKET.put(key, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/octet-stream' } });
      if (!stored) return json({ error: 'Snapshot already exists' }, 409);
      await env.BUCKET.delete(`tickets/${id}`);
      return json({ id }, 201);
    } catch (error) {
      if (error.message === 'large') return json({ error: 'Sketch too large' }, 413);
      return json({ error: 'Storage temporarily unavailable' }, 503);
    }
  },
};
