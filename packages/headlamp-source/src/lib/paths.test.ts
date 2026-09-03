const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveHeadlampPaths } = require('./paths.ts');

test('rejects manifest paths outside the Headlamp app', () => {
  assert.throws(
    () => resolveHeadlampPaths('/tmp/headlamp-source', '../../../outside.json'),
    /must stay within/
  );
});