#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import * as path from 'node:path';

const ROOT_DIR = path.dirname(__dirname);

export async function findAvailablePort(startPort = 3000): Promise<number> {
  for (let port = startPort; port <= 65535; port++) {
    const available = await new Promise<boolean>((resolve, reject) => {
      const server = createServer();
      server.once('error', error => {
        if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
          resolve(false);
          return;
        }
        reject(error);
      });
      server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
        server.close(closeError => closeError ? reject(closeError) : resolve(true));
      });
    });
    if (available) {
      return port;
    }
  }

  throw new Error(`No available frontend port at or above ${startPort}`);
}

export function developmentEnvironment(
  frontendPort: number,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return {
    ...env,
    ELECTRON_START_URL: `http://localhost:${frontendPort}`,
    HEADLAMP_FRONTEND_PORT: String(frontendPort),
  };
}

async function startDevelopment(): Promise<void> {
  const frontendPort = await findAvailablePort();
  console.log(`Starting Headlamp frontend on http://localhost:${frontendPort}`);

  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(npmExecutable, ['run', 'dev:services'], {
    cwd: ROOT_DIR,
    env: developmentEnvironment(frontendPort),
    stdio: 'inherit',
  });

  child.once('error', error => {
    throw error;
  });
  child.once('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

if (require.main === module) {
  void startDevelopment();
}