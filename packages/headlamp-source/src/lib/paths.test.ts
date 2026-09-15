const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveHeadlampPaths, resolveWithin } = require('./paths.ts');

test('rejects manifest paths outside the Headlamp app', () => {
  assert.throws(
    () => resolveHeadlampPaths('/tmp/headlamp-source', '../../../outside.json'),
    /must stay within/
  );
});

test('confines existing inputs and missing outputs through canonical ancestors', context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'confined-paths-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'root');
  const outside = path.join(directory, 'outside');
  fs.mkdirSync(path.join(root, 'inside'), { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret'), 'private');
  fs.writeFileSync(path.join(root, 'inside', 'asset'), 'asset');
  fs.symlinkSync(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(path.join(root, 'inside'), path.join(root, 'safe'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => resolveWithin(root, 'escape/secret', 'Input'), /must stay within/);
  assert.throws(() => resolveWithin(root, 'escape/new/output.json', 'Output'), /must stay within/);
  assert.equal(resolveWithin(root, 'safe/asset', 'Input'), path.join(root, 'safe', 'asset'));
  assert.equal(resolveWithin(root, 'safe/new/output.json', 'Output'), path.join(root, 'safe/new/output.json'));
  assert.equal(resolveWithin(path.join(root, 'missing'), 'new/output.json', 'Output'), path.join(root, 'missing/new/output.json'));
});