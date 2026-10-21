import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SCREENS, sanitize } from '../telemetry/schema';
import { SCREEN_NAMES, screenOf } from './screens';

test('routes map to screen names', () => {
  assert.equal(screenOf('/'), 'home');
  assert.equal(screenOf('/activity'), 'activity');
  assert.equal(screenOf('/activity?account=3'), 'activity');
  assert.equal(screenOf('/txn/42'), 'detail');
  assert.equal(screenOf('/account/7'), 'accounts');
  assert.equal(screenOf('/telemetry'), 'privacy');
  assert.equal(screenOf('/budgets'), 'budgets');
  assert.equal(screenOf('/nope'), 'unknown');
});

test('every screen name is allowed by the telemetry schema', () => {
  assert.deepEqual([...SCREENS].sort(), [...SCREEN_NAMES].sort());
  for (const s of SCREEN_NAMES) assert.ok(sanitize('screen_load', { screen: s, ms: 120 }), s);
});

test('screen_load carries only the screen name and a duration', () => {
  assert.equal(sanitize('screen_load', { screen: '/txn/42', ms: 120 }), null);
  assert.deepEqual(sanitize('screen_load', { screen: 'home', ms: 120.4, extra: 'x' })?.props, { screen: 'home', ms: 120 });
});
