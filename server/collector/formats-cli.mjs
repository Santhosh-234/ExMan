#!/usr/bin/env node
// Manage the bank-format library served to the app. Run on the VM:
//   node formats-cli.mjs candidates          formats people shared, numbered
//   node formats-cli.mjs promote <n> ["a sample message"]   add candidate n to the library (checks it reads the sample if given)
//   node formats-cli.mjs list                what the library holds now
//   node formats-cli.mjs remove <id>         take a format out
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { sharedCandidates } from './candidates.mjs';
import { EMPTY, validateFormat, validateLibrary } from './formats.mjs';

const dir = process.env.DATA_DIR ?? '.';
const file = `${dir}/formats.json`;
const load = () => (existsSync(file) ? validateLibrary(JSON.parse(readFileSync(file, 'utf8'))) ?? (() => { throw new Error('formats.json is invalid; fix or delete it first'); })() : { ...EMPTY });
const save = (lib) => { const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify({ version: lib.version, formats: lib.formats }, null, 1)); renameSync(tmp, file); };
const [cmd, arg, sample] = process.argv.slice(2);

if (cmd === 'list') {
  const lib = load();
  console.log(`library v${lib.version}: ${lib.formats.length} format(s)`);
  for (const f of lib.formats) console.log(`  ${f.id}  [${f.sender_key}] ${f.direction} ${f.currency}  amount: ${f.amount_re}`);
} else if (cmd === 'candidates') {
  const db = new DatabaseSync(`${dir}/collector.db`, { readOnly: true });
  const have = new Set(load().formats.map((f) => f.id));
  const list = sharedCandidates(db);
  if (!list.length) console.log('(nobody has shared a format yet)');
  list.forEach((c, i) => console.log(`${i + 1}. ${have.has(c.id) ? '[in library] ' : ''}${c.installs} install(s), ${c.n}x  [${c.sender_key}] ${c.direction} ${c.currency}\n     amount:   ${c.amount_re}\n     merchant: ${c.merchant_re ?? '-'}\n     account:  ${c.account_re ?? '-'}`));
} else if (cmd === 'promote') {
  const db = new DatabaseSync(`${dir}/collector.db`, { readOnly: true });
  const c = sharedCandidates(db)[Number(arg) - 1];
  if (!c) { console.error('no such candidate; run: candidates'); process.exit(1); }
  const f = validateFormat({ id: c.id, sender_key: c.sender_key, direction: c.direction, amount_re: c.amount_re, merchant_re: c.merchant_re, account_re: c.account_re, currency: c.currency });
  if (!f) { console.error('that format fails validation and cannot be published'); process.exit(1); }
  if (sample) {
    const m = new RegExp(f.amount_re, 'i').exec(sample);
    if (!m || !(parseFloat(String(m[1]).replace(/,/g, '')) > 0)) { console.error('the format does not read the sample message; not added'); process.exit(1); }
    console.log(`reads the sample: amount ${m[1]}`);
  }
  const lib = load();
  if (lib.formats.some((x) => x.id === f.id)) { console.log('already in the library'); process.exit(0); }
  lib.formats.push(f); lib.version++;
  save(lib);
  console.log(`added ${f.id}; library is now v${lib.version} with ${lib.formats.length} format(s). Apps pick it up within a day.`);
} else if (cmd === 'remove') {
  const lib = load();
  const n = lib.formats.length;
  lib.formats = lib.formats.filter((f) => f.id !== arg);
  if (lib.formats.length === n) { console.error('no such id'); process.exit(1); }
  lib.version++; save(lib);
  console.log(`removed ${arg}; library is now v${lib.version}`);
} else {
  console.log('usage: formats-cli.mjs candidates | promote <n> ["sample message"] | list | remove <id>');
}
