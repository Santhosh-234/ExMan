#!/usr/bin/env node
import { createCollector } from './app.mjs';
import { openStore } from './store.mjs';

const dataDir = process.env.DATA_DIR ?? '.';
const port = Number(process.env.PORT ?? 8787);
const store = openStore(`${dataDir}/collector.db`);
const server = createCollector({ store, base: process.env.BASE_PATH ?? '/t' });

const purge = () => { try { const r = store.purge(Date.now()); if (r.events || r.agg) console.log(`purged ${r.events} events, ${r.agg} aggregate rows`); } catch (e) { console.error('purge failed', e); } };
purge();
setInterval(purge, 3_600_000).unref();

// listen on loopback only: Caddy terminates TLS and forwards here
server.listen(port, '127.0.0.1', () => console.log(`collector listening on 127.0.0.1:${port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => { store.close(); process.exit(0); }));
