import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type Release, isTrustedApkUrl, newerApk, parseRuntime } from './apkUpdate';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const rel = (n: number, runtime: string | null, day: number): Release => ({
  tag_name: `build-${n}`, name: `Build ${n}`, published_at: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`, body: runtime ? `Sideload.\n\nruntime: ${runtime}` : 'Sideload.',
  assets: [{ name: 'ExMan.apk', browser_download_url: `https://github.com/Santhosh-234/ExMan/releases/download/build-${n}/ExMan.apk`, size: 52_428_800 }],
});

test('reads the runtime line', () => {
  assert.equal(parseRuntime(`x\nruntime: ${A.toUpperCase()}\n`), A);
  assert.equal(parseRuntime('no runtime here'), null);
  assert.equal(parseRuntime(null), null);
});

test('no update when the newest release is the running build', () => {
  assert.equal(newerApk([rel(14, A, 22), rel(13, B, 21)], A), null);
});

test('update when the newest release has a different runtime', () => {
  const u = newerApk([rel(13, B, 21), rel(14, A, 22)], B)!; // list order does not matter: newest by date wins
  assert.equal(u.tag, 'build-14');
  assert.equal(u.name, 'Build 14');
  assert.equal(u.sizeMb, 50);
  assert.ok(isTrustedApkUrl(u.url));
});

test('older releases without a runtime line do not break the check', () => {
  assert.equal(newerApk([rel(14, A, 22), rel(12, null, 20)], B)?.tag, 'build-14');
  assert.equal(newerApk([rel(14, null, 22), rel(12, null, 20)], B), null); // cannot tell: say nothing
});

test('ignores drafts, releases without an APK, and non-fingerprint runtimes', () => {
  const draft = { ...rel(15, A, 23), draft: true };
  const noApk = { ...rel(16, A, 24), assets: [{ name: 'notes.txt', browser_download_url: 'https://x/y' }] };
  assert.equal(newerApk([draft, noApk, rel(14, B, 22)], B), null);
  assert.equal(newerApk([rel(14, A, 22)], '1.0.0'), null);
  assert.equal(newerApk([rel(14, A, 22)], undefined), null);
});

test('only this repository\'s release APK links are trusted', () => {
  assert.ok(isTrustedApkUrl('https://github.com/Santhosh-234/ExMan/releases/download/build-14/ExMan.apk'));
  assert.ok(!isTrustedApkUrl('https://evil.example/ExMan.apk'));
  assert.ok(!isTrustedApkUrl('https://github.com/other/ExMan/releases/download/build-14/ExMan.apk'));
  assert.ok(!isTrustedApkUrl('http://github.com/Santhosh-234/ExMan/releases/download/build-14/ExMan.apk'));
});


import { cacheStillValid } from './apkUpdate';

test('a remembered update only counts for the build it was found on', () => {
  assert.equal(cacheStillValid({ forRuntime: 'a'.repeat(40) }, 'a'.repeat(40)), true);
  assert.equal(cacheStillValid({ forRuntime: 'a'.repeat(40) }, 'b'.repeat(40)), false); // installed since: hide it at once
  assert.equal(cacheStillValid({}, 'a'.repeat(40)), false); // old cache entries without the field
  assert.equal(cacheStillValid(null, 'a'.repeat(40)), false);
  assert.equal(cacheStillValid({ forRuntime: 'a'.repeat(40) }, null), false);
});
