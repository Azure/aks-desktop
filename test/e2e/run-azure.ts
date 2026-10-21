// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
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

function stopChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) {
    child.kill(signal);
  } else if (process.platform === 'win32') {
    // Windows has no POSIX process groups; terminate the specific child's tree.
    const result = spawnSync(
      path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/pid', String(child.pid), '/T', '/F'],
      { stdio: 'ignore' }
    );
    if (result.error) throw result.error;
  } else {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  }
}

async function runSuite(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  launch: typeof spawn
): Promise<Result> {
  const child = launch(process.execPath, args, {
    cwd,
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  let interrupted: NodeJS.Signals | null = null;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const interrupt = (signal: NodeJS.Signals) => {
    interrupted ??= signal;
    stopChild(child, signal);
    escalation ??= setTimeout(() => stopChild(child, 'SIGKILL'), 5000);
  };
  const onInt = () => interrupt('SIGINT');
  const onTerm = () => interrupt('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  try {
    return await new Promise<Result>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        interrupted ??= signal;
        resolve({ code, signal: interrupted });
      });
    });
  } finally {
    process.removeListener('SIGINT', onInt);
    process.removeListener('SIGTERM', onTerm);
    clearTimeout(escalation);
    if (interrupted) stopChild(child, 'SIGKILL');
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
  const restFiles = suites.includes('rest')
    ? readdirSync(path.join(plugin, 'src/utils/azure'))
        .filter(file => file.endsWith('.live.test.ts'))
        .sort()
        .map(file => `src/utils/azure/${file}`)
    : [];
  const vitest = path.join(plugin, 'node_modules/vitest/vitest.mjs');
  if (suites.includes('rest') && (!restFiles.length || !existsSync(vitest))) {
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
        : ['--import', tsx, '--test', 'test/e2e/acr.live.test.ts'],
      suite === 'rest' ? plugin : root,
      childEnv,
      launch
    );
    if (result.signal || result.code !== 0) {
      console.error(`[azure live] ${suite} failed (${result.signal ?? result.code ?? 'unknown'})`);
      return result;
    }
    console.log(`[azure live] Passed ${suite} suite`);
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
