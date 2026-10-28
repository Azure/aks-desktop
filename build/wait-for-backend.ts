#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Waits for the development backend before Electron starts.
 *
 * `dev:services` starts the backend, frontend and Electron together. The backend compiles
 * with `go build` first, which can outlast Electron's own short wait for it; Electron then
 * never opens a window. Delaying Electron until the backend accepts connections avoids that.
 */

import { connect } from 'node:net';

const DEFAULT_BACKEND_PORT = 4466;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 1000;

interface WaitOptions {
  host?: string;
  timeoutMs?: number;
  retryDelayMs?: number;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
  isListening?: (host: string, port: number) => Promise<boolean>;
}

/** Resolves the backend port the frontend proxy also uses. */
export function developmentBackendPort(env: NodeJS.ProcessEnv = process.env): number {
  const configured = env.HEADLAMP_PORT;
  if (configured === undefined || configured === '') {
    return DEFAULT_BACKEND_PORT;
  }
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`HEADLAMP_PORT must be a TCP port number, got "${configured}"`);
  }
  return port;
}

function acceptsConnections(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = connect({ host, port });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(RETRY_DELAY_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Resolves once `host:port` accepts TCP connections, or rejects after the timeout. */
export async function waitForPort(port: number, options: WaitOptions = {}): Promise<void> {
  const host = options.host ?? '127.0.0.1';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const now = options.now ?? Date.now;
  const delay = options.delay ??
    ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  const isListening = options.isListening ?? acceptsConnections;

  const deadline = now() + timeoutMs;
  while (!(await isListening(host, port))) {
    if (now() >= deadline) {
      throw new Error(
        `Backend did not accept connections on ${host}:${port} within ${Math.round(timeoutMs / 1000)}s`
      );
    }
    await delay(retryDelayMs);
  }
}

if (require.main === module) {
  const port = developmentBackendPort();
  console.log(`Waiting for the backend on 127.0.0.1:${port} before starting Electron...`);
  waitForPort(port).then(
    () => console.log('Backend is accepting connections; starting Electron.'),
    error => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  );
}
