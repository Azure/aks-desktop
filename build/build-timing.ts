// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/** Runs a synchronous build phase with UTC start and elapsed-time logging. */
export function runTimedStep<T>(
  name: string,
  action: () => T,
  now: () => number = Date.now,
  log: (message: string) => void = console.log
): T {
  const startedAt = now();
  log(`[build-timing] ${name} started at ${new Date(startedAt).toISOString()}`);
  try {
    const result = action();
    log(`[build-timing] ${name} completed in ${((now() - startedAt) / 1000).toFixed(3)}s`);
    return result;
  } catch (error) {
    log(`[build-timing] ${name} failed after ${((now() - startedAt) / 1000).toFixed(3)}s`);
    throw error;
  }
}