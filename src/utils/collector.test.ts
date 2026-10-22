import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';

import { EVENTS as APP_EVENTS, sanitize as appSanitize } from '../telemetry/schema';

// the collector is plain JS that ships separately (server/collector), so it is loaded dynamically
const load = async (f: string) => (await import(`../../server/collector/${f}`)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const norm = (spec: Record<string, unknown>) => JSON.stringify(spec, (_k, v) => (v instanceof RegExp ? `re:${v.source}` : v));

test('the collector allow-list is identical to the app allow-list', async () => {
  const { EVENTS } = await load('schema.mjs');
  assert.equal(norm(EVENTS), norm(APP_EVENTS));
});

test('collector and app sanitise events the same way', async () => {
  const { sanitize } = await load('schema.mjs');
  const cases: [string, Record<string, unknown>][] = [
    ['screen_load', { screen: 'home', ms: 120.4 }], ['screen_load', { screen: '/txn/9', ms: 1 }], ['screen_load', { screen: 'home', ms: -1 }],
    ['feature_used', { feature: 'budget_set', amount: 500 }], ['nope', {}], ['app_open', { version: '1.2.3', runtime: 'abcdef12', update: 'ota', os_version: 34 }],
    ['gap_report', { sender_key: 'indbnk', template: 'Spent Rs <NUM> at <WORD>' }], ['gap_report', { sender_key: 'x', template: 'bad' }],
  ];
  for (const [n, p] of cases) assert.deepEqual(sanitize(n, p), appSanitize(n, p), `${n} ${JSON.stringify(p)}`);
});

const ID = 'a'.repeat(32);
async function boot(opts: Record<string, unknown> = {}) {
  const { createCollector } = await load('app.mjs');
  const { openStore } = await load('store.mjs');
  const store = openStore();
  let t = Date.parse('2026-10-22T10:00:00Z');
  const server = createCollector({ store, now: () => t, ...opts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const close = () => { server.close(); store.close(); };
  return { store, post, url, close, advance: (ms: number) => { t += ms; }, now: () => t };
}
const count = (s: any, sql = 'SELECT COUNT(*) AS n FROM events') => (s.db.prepare(sql).get() as { n: number }).n; // eslint-disable-line @typescript-eslint/no-explicit-any

test('stores valid events, drops invalid ones, and still answers 204', async () => {
  const c = await boot();
  try {
    const r = await c.post('/t', { install_id: ID, events: [
      { ts: c.now(), name: 'screen_load', props: { screen: 'home', ms: 180 } },
      { ts: c.now(), name: 'screen_load', props: { screen: '/txn/42', ms: 5 } },
      { ts: c.now(), name: 'feature_used', props: { feature: 'budget_set', merchant: 'Swiggy' } },
      { ts: c.now(), name: 'secret_event', props: { amount: 1 } },
      null, 7,
    ] });
    assert.equal(r.status, 204);
    assert.equal(count(c.store), 2);
    const row = c.store.db.prepare("SELECT props FROM events WHERE name = 'feature_used'").get() as { props: string };
    assert.equal(row.props, '{"feature":"budget_set"}'); // the extra "merchant" field was stripped
  } finally { c.close(); }
});

test('aggregates counts, sums and a time histogram per day', async () => {
  const c = await boot();
  try {
    const ev = (ms: number) => ({ ts: c.now(), name: 'screen_load', props: { screen: 'home', ms } });
    await c.post('/t', { install_id: ID, events: [ev(50), ev(200), ev(200), ev(9000)] });
    await c.post('/t', { install_id: ID, events: [{ ts: c.now(), name: 'parser_stats', props: { bank: 'HDFC', parsed: 10, unrecognised: 2, taught: 1 } }, { ts: c.now(), name: 'parser_stats', props: { bank: 'HDFC', parsed: 5, unrecognised: 0, taught: 0 } }] });
    const get = (name: string, key: string) => (c.store.db.prepare('SELECT SUM(value) AS n FROM agg WHERE name = ? AND key = ?').get(name, key) as { n: number }).n;
    assert.equal(get('screen_load', '#count'), 4);
    assert.equal(get('screen_load', 'ms<=100'), 1);
    assert.equal(get('screen_load', 'ms<=250'), 2);
    assert.equal(get('screen_load', 'ms>5000'), 1);
    assert.equal(get('parser_stats', 'sum:parsed'), 15);
    assert.equal(get('parser_stats', 'sum:unrecognised'), 2);
    assert.equal((c.store.db.prepare("SELECT dim FROM agg WHERE name = 'parser_stats' LIMIT 1").get() as { dim: string }).dim, 'bank=HDFC');
  } finally { c.close(); }
});

test('gap reports are kept as raw events only, never aggregated', async () => {
  const c = await boot();
  try {
    await c.post('/t', { install_id: ID, events: [{ ts: c.now(), name: 'gap_report', props: { sender_key: 'indbnk', template: 'Spent Rs <NUM> at <WORD>' } }] });
    assert.equal(count(c.store), 1);
    assert.equal(count(c.store, "SELECT COUNT(*) AS n FROM agg WHERE name = 'gap_report'"), 0);
  } finally { c.close(); }
});

test('forget-me removes that install only, and keeps anonymous aggregates', async () => {
  const c = await boot();
  try {
    const e = { ts: c.now(), name: 'feature_used', props: { feature: 'manual_add' } };
    await c.post('/t', { install_id: ID, events: [e, e] });
    await c.post('/t', { install_id: 'b'.repeat(32), events: [e] });
    assert.equal((await c.post('/t/delete', { install_id: ID })).status, 204);
    assert.equal(count(c.store), 1);
    assert.equal(count(c.store, "SELECT SUM(value) AS n FROM agg WHERE key = '#count'"), 3);
  } finally { c.close(); }
});

test('retention: raw events after 90 days, aggregates after 12 months', async () => {
  const c = await boot();
  try {
    await c.post('/t', { install_id: ID, events: [{ ts: c.now(), name: 'feature_used', props: { feature: 'manual_add' } }] });
    c.advance(89 * 864e5);
    assert.deepEqual(c.store.purge(c.now()), { events: 0, agg: 0 });
    c.advance(2 * 864e5);
    assert.deepEqual(c.store.purge(c.now()), { events: 1, agg: 0 });
    c.advance(300 * 864e5);
    assert.equal(c.store.purge(c.now()).agg, 1);
    assert.equal(count(c.store, 'SELECT COUNT(*) AS n FROM agg'), 0);
  } finally { c.close(); }
});

test('rejects malformed requests and unknown routes', async () => {
  const c = await boot();
  try {
    assert.equal((await c.post('/t', 'not json')).status, 400);
    assert.equal((await c.post('/t', { install_id: 'short', events: [] })).status, 400);
    assert.equal((await c.post('/t', { install_id: ID, events: 'x' })).status, 400);
    assert.equal((await c.post('/t', { install_id: ID, events: new Array(101).fill({}) })).status, 400);
    assert.equal((await c.post('/other', { install_id: ID, events: [] })).status, 404);
    assert.equal((await fetch(c.url + '/t')).status, 404);
    assert.equal((await fetch(c.url + '/healthz')).status, 200);
    assert.equal((await c.post('/t', 'x'.repeat(300_000))).status, 413);
  } finally { c.close(); }
});

test('rate limits per IP and per install per day', async () => {
  const c = await boot({ perIpPerMin: 3, perInstallPerDay: 2 });
  try {
    const ok = { install_id: ID, events: [] };
    assert.equal((await c.post('/t', ok, { 'x-forwarded-for': '1.1.1.1' })).status, 204);
    assert.equal((await c.post('/t', ok, { 'x-forwarded-for': '1.1.1.1' })).status, 204);
    assert.equal((await c.post('/t', ok, { 'x-forwarded-for': '1.1.1.1' })).status, 429); // 3rd request for this install today
    assert.equal((await c.post('/t', { install_id: 'c'.repeat(32), events: [] }, { 'x-forwarded-for': '2.2.2.2' })).status, 204);
    for (let i = 0; i < 3; i++) await c.post('/t', { install_id: 'd'.repeat(32), events: [] }, { 'x-forwarded-for': '3.3.3.3' });
    assert.equal((await c.post('/t', ok, { 'x-forwarded-for': '3.3.3.3' })).status, 429); // IP over its per-minute budget
  } finally { c.close(); }
});

test('the app uploads exactly what the collector accepts', async () => {
  // same envelope the app sends in src/db/telemetry.ts flush(): { install_id, events: [{ ts, name, props }] }
  const c = await boot();
  try {
    const events = [{ ts: c.now(), name: 'app_open', props: { version: '1.0.0', runtime: '038326b6', update: 'ota', os_version: 34 } }, { ts: c.now(), name: 'error', props: { kind: 'js_error', screen: 'home', code: 'TypeError' } }];
    assert.equal((await c.post('/t', { install_id: ID, events })).status, 204);
    assert.equal(count(c.store), 2);
  } finally { c.close(); }
});
