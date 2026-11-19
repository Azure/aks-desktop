// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { makePromiseQueue } from './promiseQueue';

test('resolves with the task result', async () => {
  const queue = makePromiseQueue();
  await expect(queue.enqueuePromise(async () => 42)).resolves.toBe(42);
});

test('rejects with the task error', async () => {
  const queue = makePromiseQueue();
  await expect(
    queue.enqueuePromise(async () => {
      throw new Error('boom');
    })
  ).rejects.toThrow('boom');
});

test('runs tasks in FIFO order', async () => {
  const queue = makePromiseQueue();
  const order: number[] = [];

  const results = await Promise.all([
    queue.enqueuePromise(async () => {
      order.push(1);
      return 1;
    }),
    queue.enqueuePromise(async () => {
      order.push(2);
      return 2;
    }),
    queue.enqueuePromise(async () => {
      order.push(3);
      return 3;
    }),
  ]);

  expect(order).toEqual([1, 2, 3]);
  expect(results).toEqual([1, 2, 3]);
});

test('keeps processing later tasks after one rejects', async () => {
  const queue = makePromiseQueue();

  const failing = queue.enqueuePromise(async () => {
    throw new Error('first failed');
  });
  const following = queue.enqueuePromise(async () => 'second');

  await expect(failing).rejects.toThrow('first failed');
  await expect(following).resolves.toBe('second');
});

test('isolates rejection to its own caller', async () => {
  const queue = makePromiseQueue();

  const results = await Promise.allSettled([
    queue.enqueuePromise(async () => 'a'),
    queue.enqueuePromise(async () => {
      throw new Error('b failed');
    }),
    queue.enqueuePromise(async () => 'c'),
  ]);

  expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
});
