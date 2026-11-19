// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Non-concurrent promise queue */
export const makePromiseQueue = () => {
  let tail = Promise.resolve();

  return {
    /** Place promise in a queue and wait for it to resolve */
    enqueuePromise<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        tail = tail.then(() => fn()).then(resolve, reject);
      });
    },
  };
};
