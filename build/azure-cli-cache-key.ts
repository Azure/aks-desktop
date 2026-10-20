#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { azureCliCacheKey, resolveAzureCliTarget } from './azure-cli-config';

const ROOT_DIR = path.dirname(__dirname);

/** Reads a `--name=value` option from command-line arguments. */
function readOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const platform = readOption('platform') || process.platform;
  const arch = readOption('arch');
  console.log(azureCliCacheKey(resolveAzureCliTarget(ROOT_DIR, platform, arch)));
}