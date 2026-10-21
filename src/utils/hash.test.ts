import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hashMessage } from './hash';

test('hash is stable and sensitive to ts and text', () => {
  assert.equal(hashMessage(1, 'abc'), hashMessage(1, 'abc'));
  assert.notEqual(hashMessage(1, 'abc'), hashMessage(2, 'abc'));
  assert.notEqual(hashMessage(1, 'abc'), hashMessage(1, 'abd'));
  assert.equal(hashMessage(1, 'abc').length, 16);
});
