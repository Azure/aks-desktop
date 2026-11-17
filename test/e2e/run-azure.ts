// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn, spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  INTERRUPTION_GRACE_MS,
  INTERRUPTION_MESSAGE,
  INTERRUPTION_READY,
} from './acr-interruption';
import { readConfig } from './acr-workflow';

type Suite = 'rest' | 'acr';
type Result = { code: number | null; signal: NodeJS.Signals | null };
const root = path.resolve(__dirname, '../..');

export function parseSuite(args: string[]): Suite | 'all' {
  if (args.length === 0) return 'all';
  let value: string | undefined;
  if (args.length === 2 && args[0] === '--suite') value = args[1];
  else if (args.length === 1 && args[0].startsWith('--suite=')) {
    value = args[0].slice('--suite='.length);
  }
  if (value !== 'rest' && value !== 'acr' && value !== 'all') {
    throw new Error('Usage: npm run test:e2e:azure -- [--suite rest|acr|all]');
  }
  return value;
}

export function stopChild(
  child: ReturnType<typeof spawn>,
  signal: NodeJS.Signals,
  platform = process.platform,
  terminateTree: (
    command: string,
    args: string[],
    options: SpawnSyncOptions
  ) => { status: number | null; error?: Error } = spawnSync,
  probePid: (pid: number) => void = pid => {
    process.kill(pid, 0);
  }
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (!child.pid) {
    child.kill(signal);
  } else if (platform === 'win32') {
    // Windows has no POSIX process groups; terminate the specific child's tree.
    const result = terminateTree(
      path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/pid', String(child.pid), '/T', '/F'],
      { stdio: 'ignore', timeout: 5000, windowsHide: true }
    );
    if (
      (result.error || result.status !== 0) &&
      child.exitCode === null &&
      child.signalCode === null
    ) {
      try {
        probePid(child.pid);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return;
      }
      throw result.error ?? new Error('Owned suite process-tree termination failed');
    }
  } else {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
}

export async function runSuite(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  launch: typeof spawn,
  {
    cooperative = false,
    platform = process.platform,
    graceMs = INTERRUPTION_GRACE_MS,
    terminate = (child: ReturnType<typeof spawn>) => stopChild(child, 'SIGKILL', platform),
  } = {}
): Promise<Result> {
  const child = launch(process.execPath, args, {
    cwd,
    env,
    stdio: cooperative ? ['inherit', 'inherit', 'inherit', 'ipc'] : 'inherit',
    detached: platform !== 'win32',
  });
  let interrupted: NodeJS.Signals | null = null;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let fail: (error: unknown) => void = () => {};
  const notify = () => {
    if (child.connected && interrupted) {
      child.send({ type: INTERRUPTION_MESSAGE, signal: interrupted }, () => {
        // A disconnect/exit race is handled by close or the escalation timer.
      });
    }
  };
  const onMessage = (message: unknown) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === INTERRUPTION_READY
    ) {
      notify(); // Re-deliver an interruption received while the suite was loading.
    }
  };
  child.on('message', onMessage);
  const interrupt = (signal: NodeJS.Signals) => {
    if (interrupted) return; // A second signal must not preempt owned recovery.
    interrupted = signal;
    try {
      if (cooperative) {
        notify();
      } else {
        stopChild(child, signal, platform);
      }
    } catch (error) {
      fail(error);
      return;
    }
    escalation = setTimeout(
      () => {
        try {
          terminate(child);
        } catch (error) {
          fail(error);
        }
      },
      cooperative ? graceMs : 5000
    );
  };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  const onHup = () => interrupt('SIGHUP');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  process.on('SIGHUP', onHup);
  try {
    return await new Promise<Result>((resolve, reject) => {
      fail = reject;
      child.once('error', reject);
      child.once('close', (code, signal) => {
        interrupted ??= signal;
        resolve({ code, signal: interrupted });
      });
    });
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    process.removeListener('SIGHUP', onHup);
    child.removeListener('message', onMessage);
    clearTimeout(escalation);
  }
}

export async function runAzure(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  launch: typeof spawn = spawn
): Promise<Result> {
  const selection = parseSuite(args);
  const suites: Suite[] = selection === 'all' ? ['rest', 'acr'] : [selection];
  // Validate every selected suite before even the read-only REST suite starts.
  if (suites.includes('acr')) readConfig(env);
  const plugin = path.join(root, 'plugins/aks-desktop');
  const restFiles = ['src/utils/azure/az-http.live.test.ts'];
  const vitest = path.join(plugin, 'node_modules/vitest/vitest.mjs');
  if (
    suites.includes('rest') &&
    (!existsSync(vitest) || restFiles.some(file => !existsSync(path.join(plugin, file))))
  ) {
    throw new Error(
      'REST live tests require the plugin-local Vitest installation and live test files'
    );
  }
  const tsx = suites.includes('acr') ? pathToFileURL(require.resolve('tsx')).href : '';
  const childEnv = { ...env, AZ_LIVE_TESTS: '1' };
  for (const suite of suites) {
    console.log(`[azure live] Starting ${suite} suite`);
    const result = await runSuite(
      suite === 'rest'
        ? [vitest, 'run', '-c', 'vitest.config.ts', '--project', 'unit', ...restFiles]
        : ['--import', tsx, 'test/e2e/acr.live.test.ts'],
      suite === 'rest' ? plugin : root,
      childEnv,
      launch,
      { cooperative: suite === 'acr' }
    );
    if (result.signal || result.code !== 0) {
      console.error(`[azure live] ${suite} failed (${result.signal ?? result.code ?? 'unknown'})`);
      return result;
    }
    console.log(`[azure live] Completed ${suite} suite; see test results for passes and skips`);
  }
  return { code: 0, signal: null };
}

if (require.main === module) {
  void runAzure(process.argv.slice(2)).then(
    result => {
      if (result.signal) process.kill(process.pid, result.signal);
      else process.exitCode = result.code ?? 1;
    },
    error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}
