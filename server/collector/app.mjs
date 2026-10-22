import { createServer } from 'node:http';

import { sanitize } from './schema.mjs';
import { openStore } from './store.mjs';

const INSTALL_ID = /^[0-9a-f]{32}$/;
const MAX_BODY = 256 * 1024;
const MAX_EVENTS = 100;

/** Fixed-window counter per key; the map is swept so it cannot grow without bound. */
function limiter(limit, windowMs) {
  const hits = new Map();
  return (key, now) => {
    const h = hits.get(key);
    if (!h || now - h.start >= windowMs) {
      if (hits.size > 10_000) for (const [k, v] of hits) if (now - v.start >= windowMs) hits.delete(k);
      hits.set(key, { start: now, n: 1 });
      return true;
    }
    return ++h.n <= limit;
  };
}

/**
 * The app posts batches to `${base}` and "forget me" requests to `${base}/delete`.
 * Nothing about the caller (IP, user agent) is stored; the IP is only used in memory for rate limiting.
 */
export function createCollector({ store, base = '/t', now = Date.now, trustProxy = true, perIpPerMin = 120, perInstallPerDay = 3000 } = {}) {
  const ipOk = limiter(perIpPerMin, 60_000);
  const dayOk = limiter(perInstallPerDay, 86_400_000);

  const send = (res, status, body) => {
    res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json', ...(status === 413 ? { Connection: 'close' } : {}) });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (tooBig) return; // keep draining (nothing is kept) so the client can read our 413; the request timeout bounds this
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; reject(Object.assign(new Error('too large'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (tooBig) return; try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', reject);
  });

  const handler = async (req, res) => {
    try {
      const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';
      if (req.method === 'GET' && path === '/healthz') return send(res, 200, { ok: true });
      if (req.method !== 'POST' || (path !== base && path !== `${base}/delete`)) return send(res, 404, { error: 'not found' });

      const ip = (trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '') || req.socket.remoteAddress || 'unknown';
      if (!ipOk(ip, now())) return send(res, 429, { error: 'slow down' });

      const body = await readJson(req);
      if (!body || typeof body !== 'object' || typeof body.install_id !== 'string' || !INSTALL_ID.test(body.install_id)) return send(res, 400, { error: 'bad install_id' });

      if (path === `${base}/delete`) { store.forget(body.install_id); return send(res, 204); }

      if (!Array.isArray(body.events) || body.events.length > MAX_EVENTS) return send(res, 400, { error: 'bad events' });
      if (!dayOk(body.install_id, now())) return send(res, 429, { error: 'daily limit' });
      // invalid events are dropped, never stored; the batch still succeeds so the app does not retry a bad event forever
      const good = [];
      for (const e of body.events) {
        const s = e && typeof e === 'object' ? sanitize(e.name, e.props) : null;
        if (s) good.push({ ts: typeof e.ts === 'number' ? e.ts : NaN, ...s });
      }
      if (good.length) store.add(body.install_id, good, now());
      return send(res, 204);
    } catch (err) {
      const status = err && typeof err === 'object' && 'status' in err ? err.status : 500;
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'server error' : err.message });
    }
  };
  const server = createServer(handler);
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

export { openStore };
