const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  copyDirectoryContents,
  removePathPattern,
} = require('./file-operations.ts');

test('copies visible directory contents recursively', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-copy-'));
  const source = path.join(root, 'source');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(source, 'nested', 'file'), 'contents');
  fs.writeFileSync(path.join(source, '.hidden'), 'excluded');
  try {
    copyDirectoryContents(source, destination);
    assert.equal(
      fs.readFileSync(path.join(destination, 'nested', 'file'), 'utf8'),
      'contents'
    );
    assert.equal(fs.existsSync(path.join(destination, '.hidden')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('removes exact and wildcard path matches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-remove-'));
  for (const name of ['pip', 'pip-1.dist-info', 'setuptools-1.dist-info', 'keep']) {
    fs.mkdirSync(path.join(root, name));
  }
  try {
    removePathPattern(path.join(root, 'pip'));
    removePathPattern(path.join(root, 'pip*.dist-info'));
    assert.deepEqual(fs.readdirSync(root).sort(), ['keep', 'setuptools-1.dist-info']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});