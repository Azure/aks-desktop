const assert = require('node:assert/strict');
const test = require('node:test');

const { fetchHtmlWithin, reserveReadinessPort } = require('../scripts/smoke-app.ts');

test('reserves an available readiness port exclusively', async () => {
  const first: any = await reserveReadinessPort();
  try {
    await assert.rejects(reserveReadinessPort(first.port), error => {
      return error && error.code === 'EADDRINUSE';
    });
  } finally {
    await first.release();
  }

  const second: any = await reserveReadinessPort(first.port);
  await second.release();
});

test('aborts an HTTP probe that does not respond', async () => {
  const fetchFn = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    });

  await assert.rejects(fetchHtmlWithin('http://127.0.0.1:4466', 5, fetchFn), error => {
    return error?.name === 'AbortError';
  });
});