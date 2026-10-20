// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { Octokit } from '@octokit/rest';

export class SessionInvalidatedError extends Error {
  constructor() {
    super('The GitHub session is no longer available. Connect GitHub again.');
    this.name = 'SessionInvalidatedError';
  }
}

/** Keep one client per account session; token rotation is not an identity change. */
export function createSessionOctokit(
  sessionVersion: number,
  readAuth: () => { sessionVersion: number; accessToken: string | null; usable: boolean }
): Octokit {
  // A constructor auth strategy would reapply its captured token after a before hook.
  const client = new Octokit({ log: { debug() {}, info() {}, warn() {}, error() {} } });
  client.hook.wrap('request', (request, options) => {
    const current = readAuth();
    if (current.sessionVersion !== sessionVersion || !current.usable || !current.accessToken) {
      throw new SessionInvalidatedError();
    }
    // Octokit's composed wrappers share this options object; replacing it would
    // leave inner wrappers bound to stale headers.
    options.headers.authorization = `Bearer ${current.accessToken}`;
    return request(options);
  });
  return client;
}
