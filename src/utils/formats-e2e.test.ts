import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { formatsStatus, syncFormats } from '../db/formats';
import { refreshFormats } from '../ingest/formats';
import { run } from '../ingest/core';
import { buildPattern, tokenize } from './teach';
import { makeDb } from './testdb';

const load = async (f: string) => (await import(`../../server/collector/${f}`)) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SENDER = 'VM-NEWBNK-S';
const TEXT = 'ALERT: 450.50 INR gone from acct 1234 for SWIGGY ORDER on 20Oct';
const T0 = Date.parse('2026-10-20T10:00:00Z');

/** What the owner publishes for this bank: the pattern Teach would build from the message. */
function libraryFor() {
  const a = tokenize(TEXT).findIndex((t) => t.text === '450.50');
  const built = buildPattern(TEXT, { amount: [a, a] }, 'debit', 'INR');
  if (!built.ok) throw new Error('pattern');
  return { version: 3, formats: [{ id: 'newbnk-0001', sender_key: 'newbnk', direction: 'debit', amount_re: built.pattern.amount_re, merchant_re: built.pattern.merchant_re, account_re: built.pattern.account_re, currency: 'INR' }] };
}

async function serve(lib: unknown) {
  const { createCollector } = await load('app.mjs');
  const { openStore } = await load('store.mjs');
  const { formatsSource } = await load('formats.mjs');
  const file = join(mkdtempSync(join(tmpdir(), 'exman-')), 'formats.json');
  if (lib) writeFileSync(file, JSON.stringify(lib));
  const store = openStore();
  const server = createCollector({ store, formats: formatsSource(file) });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/t/formats`;
  return { url, file, close: () => { server.close(); store.close(); } };
}

test('a bank the app cannot read becomes readable after downloading the published format', async () => {
  const srv = await serve(libraryFor());
  try {
    const { db, raw } = await makeDb();
    await run(db, [{ kind: 'sms', sender: SENDER, text: TEXT, ts: T0 }], 0);
    assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM unparsed').get() as { n: number }).n, 1);
    assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n, 0);

    const r = await refreshFormats(db, { url: srv.url, now: T0 });
    assert.equal(r.status, 'updated');
    assert.equal(r.count, 1);
    assert.equal(r.added, 1); // the message that was stuck in Unrecognised is now a transaction
    assert.equal((raw.prepare('SELECT amount_paise AS a FROM transactions').get() as { a: number }).a, 45050);
    assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM unparsed').get() as { n: number }).n, 0);

    // new messages in that layout are read straight away
    await run(db, [{ kind: 'sms', sender: SENDER, text: TEXT.replace('450.50', '99.00').replace('SWIGGY', 'ZOMATO'), ts: T0 + 3_600_000 }], 0);
    assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM transactions').get() as { n: number }).n, 2);

    // checked today already; forcing asks again and the server says nothing changed only when an etag is sent
    assert.equal((await syncFormats(db, { url: srv.url, now: T0 + 1000 })).status, 'skipped');
    const st = await formatsStatus(db);
    assert.equal(st.version, 3);
    assert.equal(st.count, 1);
    assert.equal((await syncFormats(db, { url: srv.url, now: T0 + 2 * 864e5 })).status, 'unchanged'); // etag matched
  } finally { srv.close(); }
});

test('switching it off, no server, a broken file and a server error all leave reading untouched', async () => {
  const { db } = await makeDb();
  assert.equal((await syncFormats(db, { url: '' })).status, 'unavailable');
  await db.runAsync("INSERT INTO settings (key, value) VALUES ('formats_auto', '0')");
  assert.equal((await syncFormats(db, { url: 'http://127.0.0.1:1/t/formats' })).status, 'off');
  await db.runAsync("DELETE FROM settings WHERE key = 'formats_auto'");
  assert.equal((await syncFormats(db, { url: 'http://127.0.0.1:1/t/formats', force: true })).status, 'error'); // nothing listening

  const bad = await serve(null); // no library file: the server answers with the empty library, which is valid
  try {
    const r = await syncFormats(db, { url: bad.url, force: true });
    assert.equal(r.status, 'updated');
    assert.equal(r.count, 0);
  } finally { bad.close(); }

  const fake = async () => new Response(JSON.stringify({ version: 9, formats: [{ id: 'x', sender_key: 'newbnk', direction: 'debit', amount_re: '(a+)+$', currency: 'INR' }] }), { status: 200 });
  const r = await syncFormats(db, { url: 'http://x/t/formats', force: true, fetchFn: fake as unknown as typeof fetch });
  assert.equal(r.status, 'invalid');
  assert.equal((await formatsStatus(db)).version, 0); // the old library is kept
});

test('the server refuses to serve a malformed library and never exposes anything else', async () => {
  const srv = await serve({ version: 1, formats: [{ id: 'bad id', sender_key: 'x' }] });
  try {
    const res = await fetch(srv.url);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { version: 0, formats: [] });
    assert.equal((await fetch(srv.url.replace('/formats', '/other'))).status, 404);
    assert.equal((await fetch(srv.url, { method: 'POST', body: '{}' })).status, 404);
  } finally { srv.close(); }
});

test('a shared format reaches the server, shows up as a candidate and publishes as a valid library entry', async () => {
  const { createCollector } = await load('app.mjs');
  const { openStore } = await load('store.mjs');
  const { sharedCandidates } = await load('candidates.mjs');
  const { validateFormat } = await load('formats.mjs');
  const { shareableProps } = await import('./formats');
  const store = openStore();
  const server = createCollector({ store });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/t`;
  try {
    const lib = libraryFor().formats[0];
    const props = shareableProps({ amount_re: lib.amount_re, merchant_re: lib.merchant_re, account_re: lib.account_re, direction: 'debit', currency: 'INR' }, SENDER)!;
    assert.ok(props);
    for (const id of ['a'.repeat(32), 'b'.repeat(32)]) {
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ install_id: id, events: [{ ts: Date.now(), name: 'pattern_share', props }] }) });
      assert.equal(res.status, 204);
    }
    // nothing about it is aggregated (the shapes are free text)
    assert.equal((store.db.prepare("SELECT COUNT(*) AS n FROM agg WHERE name = 'pattern_share'").get() as { n: number }).n, 0);
    const c = sharedCandidates(store.db);
    assert.equal(c.length, 1);
    assert.equal(c[0].installs, 2);
    assert.ok(validateFormat({ id: c[0].id, sender_key: c[0].sender_key, direction: c[0].direction, amount_re: c[0].amount_re, merchant_re: c[0].merchant_re, account_re: c[0].account_re, currency: c[0].currency }));
    // a tampered client cannot send a name or message text in the regex slots
    const bad = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ install_id: 'c'.repeat(32), events: [{ ts: Date.now(), name: 'pattern_share', props: { ...props, rx_value: 'x\u0000y' } }] }) });
    assert.equal(bad.status, 204);
    assert.equal(sharedCandidates(store.db).reduce((s: number, x: { n: number }) => s + x.n, 0), 2);
  } finally { server.close(); store.close(); }
});
