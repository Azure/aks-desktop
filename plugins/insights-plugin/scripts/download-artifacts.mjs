#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import {
  download,
  extractRequiredFiles,
  readManifest,
  releaseUrl,
  verifyChecksum,
  writeDist,
} from './artifacts.mjs';

try {
  const manifest = readManifest();
  console.log(`Downloading insights-plugin v${manifest.version}...`);
  const archive = await download(releaseUrl(manifest.version));
  verifyChecksum(archive, manifest.artifactSha256);
  writeDist(extractRequiredFiles(archive));
  console.log('Done.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
