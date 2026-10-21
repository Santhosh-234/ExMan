import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';

import { flush, getState, installId, listEvents, markNoticeSeen, record, resetInstallId, setEnabled } from '../db/telemetry';
import { migrate } from '../db/schema';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

async function setup() {
  const raw = new DatabaseSync(':memory:');
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    getFirstAsync: async (s: string, ...p: any[]) => (s.includes('user_version') ? { user_version: 0 } : raw.prepare(s).get(...p)),
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...p),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...p); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    withExclusiveTransactionAsync: async (fn: any) => fn(db),
  };
  await migrate(db);
  return { raw, db };
}

test('on by default; records only allow-listed events and strips extra fields', async () => {
  const { db } = await setup();
  assert.equal((await getState(db)).enabled, true);
  assert.equal(await record(db, 'review_action', { action: 'confirm', via: 'swipe', merchant: 'Swiggy', amount: 450 }), true);
  assert.equal(await record(db, 'transaction_created', { amount: 450 }), false);
  const ev = await listEvents(db);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].props, { action: 'confirm', via: 'swipe' });
});

test('with telemetry off nothing is recorded and no request is ever made', async () => {
  const { db } = await setup();
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('{}'); }) as typeof fetch;
  await record(db, 'feature_used', { feature: 'manual_add' });
  await markNoticeSeen(db);
  await setEnabled(db, false, ''); // off
  assert.equal(await record(db, 'feature_used', { feature: 'manual_add' }), false);
  assert.equal(await flush(db, 'https://collector.example'), 0);
  assert.equal(calls, 0);
  assert.equal((await listEvents(db)).length, 0); // the queued event was deleted when turned off
});

test('uploads only after the first-run notice has been seen and an endpoint exists', async () => {
  const { db } = await setup();
  const bodies: any[] = [];
  globalThis.fetch = (async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return new Response('{}'); }) as typeof fetch;
  await record(db, 'feature_used', { feature: 'manual_add' });
  assert.equal(await flush(db, 'https://collector.example'), 0); // notice not seen yet
  await markNoticeSeen(db);
  assert.equal(await flush(db, ''), 0); // no endpoint
  assert.equal(bodies.length, 0);
  assert.equal(await flush(db, 'https://collector.example'), 1);
  assert.equal(bodies.length, 1);
  assert.deepEqual(Object.keys(bodies[0]).sort(), ['events', 'install_id']);
  assert.deepEqual(Object.keys(bodies[0].events[0]).sort(), ['name', 'props', 'ts']);
  assert.equal(await flush(db, 'https://collector.example'), 0); // already sent
});

test('failed uploads stay queued; install id can be reset; queue is capped', async () => {
  const { db, raw } = await setup();
  await markNoticeSeen(db);
  globalThis.fetch = (async () => new Response('no', { status: 500 })) as typeof fetch;
  await record(db, 'feature_used', { feature: 'manual_add' });
  assert.equal(await flush(db, 'https://collector.example'), 0);
  assert.equal((raw.prepare('select count(*) c from telemetry_events where sent_at is null').get() as any).c, 1);
  const a = await installId(db);
  assert.equal(a.length, 32);
  assert.notEqual(await resetInstallId(db), a);
  for (let i = 0; i < 520; i++) await record(db, 'feature_used', { feature: 'search_used' });
  assert.ok((raw.prepare('select count(*) c from telemetry_events where sent_at is null').get() as any).c <= 500);
});
