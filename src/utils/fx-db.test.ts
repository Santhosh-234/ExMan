import assert from 'node:assert/strict';
import { test } from 'node:test';

import { updateTxn } from '../db/queries';
import { run } from '../ingest/core';
import { refreshForeignRates } from '../ingest/fx';
import { localDay } from './fx';
import { makeDb } from './testdb';

const at = (iso: string) => Date.parse(`${iso}:00+05:30`);
const usd = (amt: string, iso: string, merchant = 'NETFLIX') => ({ kind: 'sms' as const, sender: 'VM-AXISBK-S', text: `Spent ${amt} USD on card XX1234 at ${merchant}. Avl Limit INR 1,20,000.00`, ts: at(iso) });
const rows = (raw: import('node:sqlite').DatabaseSync) => raw.prepare('SELECT id, amount_paise, fx_rate, fx_source, currency, foreign_minor, merchant FROM transactions ORDER BY ts').all() as { id: number; amount_paise: number; fx_rate: number | null; fx_source: string | null; currency: string; foreign_minor: number; merchant: string }[];

function stub(table: Record<string, number | null>) {
  const calls: string[] = [];
  const fetchRate = async (day: string, code: string) => { calls.push(`${day}|${code}`); return table[`${day}|${code}`] ?? null; };
  return { calls, fetchRate };
}

test('a new foreign spend starts on the approximate rate and is marked as such', async () => {
  const { db, raw } = await makeDb();
  await run(db, [usd('32.00', '2026-10-05T10:00')], 0);
  const [t] = rows(raw);
  assert.equal(t.fx_source, 'default');
  assert.equal(t.fx_rate, 88);
  assert.equal(t.amount_paise, 32 * 88 * 100);
});

test('refresh re-rates each spend at its own day\'s rate, one request per day and currency', async () => {
  const { db, raw } = await makeDb();
  await run(db, [usd('32.00', '2026-10-05T10:00'), usd('10.00', '2026-10-05T22:00', 'SPOTIFY'), usd('5.00', '2026-10-06T09:00', 'UBER')], 0);
  const s = stub({ [`${localDay(at('2026-10-05T10:00'))}|USD`]: 83.1, [`${localDay(at('2026-10-06T09:00'))}|USD`]: 83.4 });
  const r = await refreshForeignRates(db, { fetchRate: s.fetchRate });
  assert.deepEqual(r, { updated: 3, fetched: 2, failed: 0, skipped: 0 });
  assert.equal(s.calls.length, 2);
  const t = rows(raw);
  assert.deepEqual(t.map((x) => x.amount_paise), [Math.round(32 * 83.1 * 100), Math.round(10 * 83.1 * 100), Math.round(5 * 83.4 * 100)]);
  assert.ok(t.every((x) => x.fx_source === 'online'));
  // running it again does nothing and asks for nothing
  const again = await refreshForeignRates(db, { fetchRate: s.fetchRate });
  assert.equal(again.updated, 0);
  assert.equal(s.calls.length, 2);
});

test('a rate fetched earlier is reused by new spends on that day straight away', async () => {
  const { db, raw } = await makeDb();
  await run(db, [usd('32.00', '2026-10-05T10:00')], 0);
  await refreshForeignRates(db, { fetchRate: stub({ [`${localDay(at('2026-10-05T10:00'))}|USD`]: 83.1 }).fetchRate });
  await run(db, [usd('7.00', '2026-10-05T18:00', 'APPLE')], 0);
  const t = rows(raw);
  assert.equal(t[1].fx_source, 'online');
  assert.equal(t[1].amount_paise, Math.round(7 * 83.1 * 100));
});

test('your own rate, an amount you typed, and already-synced rows are never overwritten', async () => {
  const { db, raw } = await makeDb();
  await run(db, [usd('32.00', '2026-10-05T10:00'), usd('10.00', '2026-10-05T11:00', 'SPOTIFY'), usd('5.00', '2026-10-05T12:00', 'UBER')], 0);
  const [a, b, c] = rows(raw);
  await updateTxn(db, b.id, { amount_paise: 123400 }); // typed by the user
  raw.prepare('UPDATE transactions SET synced_at = 1 WHERE id = ?').run(c.id);
  const r = await refreshForeignRates(db, { fetchRate: stub({ [`${localDay(at('2026-10-05T10:00'))}|USD`]: 83.1 }).fetchRate });
  assert.equal(r.updated, 1);
  const t = rows(raw);
  assert.equal(t[0].fx_source, 'online');
  assert.equal(t[1].fx_source, 'edited');
  assert.equal(t[1].amount_paise, 123400);
  assert.equal(t[2].fx_source, 'default');
  assert.equal(t[2].amount_paise, 5 * 88 * 100);
  void a;
});

test('a rate the user set in Exchange rates wins over the online one', async () => {
  const { db, raw } = await makeDb();
  raw.exec("INSERT INTO settings (key, value) VALUES ('fx_USD', '90')");
  await run(db, [usd('10.00', '2026-10-05T10:00')], 0);
  assert.equal(rows(raw)[0].fx_source, 'user');
  const s = stub({ [`${localDay(at('2026-10-05T10:00'))}|USD`]: 83.1 });
  assert.equal((await refreshForeignRates(db, { fetchRate: s.fetchRate })).updated, 0);
  assert.equal(s.calls.length, 0);
  assert.equal(rows(raw)[0].amount_paise, 10 * 90 * 100);
});

test('unsupported currencies are left alone and not requested', async () => {
  const { db, raw } = await makeDb();
  await run(db, [{ kind: 'sms', sender: 'VM-AXISBK-S', text: 'Spent 40.00 AED on card XX1234 at CARREFOUR. Avl Limit INR 1,20,000.00', ts: at('2026-10-05T10:00') }], 0);
  const s = stub({});
  const r = await refreshForeignRates(db, { fetchRate: s.fetchRate });
  assert.deepEqual([r.updated, r.skipped, s.calls.length], [0, 1, 0]);
  assert.equal(rows(raw)[0].fx_source, 'default');
});

test('offline: nothing changes, it gives up after three failures, and waits before trying again', async () => {
  const { db, raw } = await makeDb();
  await run(db, Array.from({ length: 6 }, (_, i) => usd('1.00', `2026-10-0${i + 1}T10:00`, `SHOP${i}`)), 0);
  const s = stub({});
  const r = await refreshForeignRates(db, { fetchRate: s.fetchRate });
  assert.equal(r.updated, 0);
  assert.equal(r.failed, 3);
  assert.equal(s.calls.length, 3);
  assert.ok(rows(raw).every((x) => x.fx_source === 'default'));
  const again = await refreshForeignRates(db, { fetchRate: s.fetchRate });
  assert.equal(s.calls.length, 3, 'no new requests during the wait');
  assert.equal(again.updated, 0);
  const all = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`${localDay(at(`2026-10-0${i + 1}T10:00`))}|USD`, 83 + i]));
  const forced = await refreshForeignRates(db, { fetchRate: stub(all).fetchRate, force: true });
  assert.equal(forced.updated, 6);
  assert.ok(rows(raw).every((x) => x.fx_source === 'online'));
});

test('the switch turns online lookups off completely', async () => {
  const { db, raw } = await makeDb();
  raw.exec("INSERT INTO settings (key, value) VALUES ('fx_online', '0')");
  await run(db, [usd('32.00', '2026-10-05T10:00')], 0);
  const s = stub({ [`${localDay(at('2026-10-05T10:00'))}|USD`]: 83.1 });
  assert.equal((await refreshForeignRates(db, { fetchRate: s.fetchRate })).updated, 0);
  assert.equal(s.calls.length, 0);
});

test('existing foreign spends are classified by the upgrade (typed amounts stay frozen)', async () => {
  const { db, raw } = await makeDb();
  await run(db, [usd('32.00', '2026-10-05T10:00')], 0);
  raw.exec("UPDATE transactions SET fx_source = NULL"); // as if saved by an older build
  assert.equal((await refreshForeignRates(db, { fetchRate: stub({ [`${localDay(at('2026-10-05T10:00'))}|USD`]: 83.1 }).fetchRate })).updated, 1);
});
