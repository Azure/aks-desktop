// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { isValidGuid } from '../azure/az-cli-core';
import { ARM_SCOPE } from '../azure/az-token';

/** Restricted native-command adapter for public-Azure production-credential live tests. */
export interface AzureLiveAuthBridge {
  /** Real child-process command bridge; rejects resource operations and other accounts/clouds. */
  runCommand: (executable: string, args: string[]) => ReturnType<typeof spawn>;
  /** Number of allowed production token acquisitions, excluding fixture bootstrap. */
  readonly tokenRequests: number;
  /** Number of allowed local cloud-configuration reads. */
  readonly cloudReads: number;
  /** Number of allowed subscription-scoped account metadata reads. */
  readonly accountReads: number;
}

function isAllowedAccountShow(args: string[], subscriptionId: string): boolean {
  if (args.length !== 6 || args[0] !== 'account' || args[1] !== 'show') return false;
  const target = subscriptionId.toLowerCase();
  const hasJsonAt = (i: number) =>
    (args[i] === '-o' || args[i] === '--output') && args[i + 1] === 'json';
  const hasSubAt = (i: number) =>
    args[i] === '--subscription' && args[i + 1].toLowerCase() === target;
  return (hasJsonAt(2) && hasSubAt(4)) || (hasSubAt(2) && hasJsonAt(4));
}

/**
 * Extracted from the provider live test; does not install or mutate a global bridge.
 * @param subscriptionId - Fixture-selected public-Azure subscription GUID; never a CLI default.
 * @param platform - Host platform; overridable for Windows shell behavior tests.
 * @returns A real command adapter and counters, without retaining token output.
 * @throws Before spawning for unsupported executables, commands, arguments or accounts.
 * The caller installs/restores runCommand for its test lifecycle. Only public ARM
 * token scopes and active/AzureCloud metadata reads are allowed; no cloud switching.
 */
export function createAzureLiveAuthBridge(
  subscriptionId: string,
  platform: NodeJS.Platform = process.platform
): AzureLiveAuthBridge {
  if (!isValidGuid(subscriptionId)) throw new Error('Invalid live-test subscription GUID');
  let tokenRequests = 0;
  let cloudReads = 0;
  let accountReads = 0;
  const scopes = new Set([
    ARM_SCOPE,
    'https://management.core.windows.net/.default',
    'https://management.core.windows.net//.default',
    'https://prometheus.monitor.azure.com/.default',
  ]);
  return {
    runCommand(executable, args) {
      if (!['az', 'az.cmd'].includes(basename(executable).toLowerCase())) {
        throw new Error('Only the Azure CLI authentication/configuration executable is permitted');
      }
      if (
        args.length === 8 &&
        args[0] === 'account' &&
        args[1] === 'get-access-token' &&
        args[2] === '--scope' &&
        scopes.has(args[3]) &&
        args[4] === '-o' &&
        args[5] === 'json' &&
        args[6] === '--subscription' &&
        args[7].toLowerCase() === subscriptionId.toLowerCase()
      ) {
        tokenRequests++;
      } else if (
        args[0] === 'cloud' &&
        args[1] === 'show' &&
        ((args.length === 4 && args[2] === '--output' && args[3] === 'json') ||
          (args.length === 6 &&
            args[2] === '--name' &&
            args[3] === 'AzureCloud' &&
            args[4] === '--output' &&
            args[5] === 'json'))
      ) {
        cloudReads++;
      } else if (isAllowedAccountShow(args, subscriptionId)) {
        accountReads++;
      } else {
        throw new Error(
          'Only selected-account public ARM tokens and read-only cloud metadata are permitted'
        );
      }
      const child = spawn(executable, args, { shell: platform === 'win32' });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      return child;
    },
    get tokenRequests() {
      return tokenRequests;
    },
    get cloudReads() {
      return cloudReads;
    },
    get accountReads() {
      return accountReads;
    },
  };
}
