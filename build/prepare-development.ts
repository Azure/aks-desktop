#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { dependencyTargetFromEnvironment, dependencyTargetMatches } from './dependency-target';
import {
  azureCliCacheIdentity,
  azureCliRuntimeFilesExist,
  resolveAzureCliTarget,
} from './azure-cli-config';

const { npmInvocation, spawnSync } = require('../packages/headlamp-source/src/lib/npm-command.ts');
const { resolveInstalledHeadlampPaths } = require('../packages/headlamp-source/src/lib/paths.ts');

const ROOT_DIR = path.dirname(__dirname);
const PREPARATION_MARKER = path.join(
  'node_modules',
  '.cache',
  'aks-desktop',
  'development-preparation.json'
);
const IGNORED_INPUT_DIRECTORIES = new Set(['.git', '.private', 'coverage', 'dist', 'node_modules']);

interface PrepareDevelopmentOptions {
  dependenciesCurrent?: (rootDir: string) => boolean;
  assemblyCurrent?: (rootDir: string) => boolean;
  runScript?: (script: string, rootDir: string) => void;
  writeMarker?: (rootDir: string) => void;
}

function hashInput(hash: ReturnType<typeof createHash>, input: string, rootDir: string): void {
  if (!fs.existsSync(input)) return;
  const stat = fs.lstatSync(input);
  const relative = path.relative(rootDir, input);
  if (stat.isSymbolicLink()) {
    hash.update(`${relative}\0${fs.readlinkSync(input)}\0`);
    return;
  }
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(input).sort()) {
      if (IGNORED_INPUT_DIRECTORIES.has(entry)) continue;
      hashInput(hash, path.join(input, entry), rootDir);
    }
    return;
  }
  if (stat.isFile()) {
    hash.update(`${relative}\0`);
    hash.update(fs.readFileSync(input));
    hash.update('\0');
  }
}

/** Returns a content identity for inputs that produce development assets. */
export function developmentPreparationIdentity(rootDir: string): string {
  const project = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const pluginSources = (project.headlamp?.plugins ?? [])
    .map((plugin: { source?: unknown }) => plugin.source)
    .filter((source: unknown): source is string => typeof source === 'string');
  const inputs = ['package.json', 'build', 'Localize', 'resources', ...pluginSources];
  const hash = createHash('sha256');
  for (const input of [...new Set(inputs)].sort()) {
    hashInput(hash, path.join(rootDir, input), rootDir);
  }
  return hash.digest('hex');
}

function requiredDevelopmentOutputsExist(rootDir: string): boolean {
  const project = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const { appDir, sourceDir } = resolveInstalledHeadlampPaths(rootDir);
  const manifest = project.headlamp?.build?.manifest;
  const plugins = project.headlamp?.plugins;
  if (typeof manifest !== 'string' || !Array.isArray(plugins)) return false;

  const target = resolveAzureCliTarget(rootDir, process.platform, process.arch);
  const azCliDir = path.join(appDir, 'resources', 'external-tools', 'az-cli', process.platform);
  let stagedTarget: unknown;
  try {
    stagedTarget = JSON.parse(fs.readFileSync(path.join(azCliDir, '.target.json'), 'utf8'));
  } catch {
    return false;
  }

  return (
    fs.existsSync(path.join(appDir, manifest)) &&
    fs.existsSync(path.join(sourceDir, 'frontend', '.env.local')) &&
    azureCliRuntimeFilesExist(azCliDir, process.platform) &&
    JSON.stringify(stagedTarget) === JSON.stringify(azureCliCacheIdentity(target)) &&
    plugins.every(
      (plugin: { name?: unknown }) =>
        typeof plugin.name === 'string' &&
        fs.existsSync(path.join(sourceDir, '.plugins', plugin.name, 'package.json'))
    )
  );
}

/** Checks whether generated development assets match their current inputs. */
export function developmentAssemblyCurrent(rootDir: string): boolean {
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(rootDir, PREPARATION_MARKER), 'utf8'));
    return (
      marker.identity === developmentPreparationIdentity(rootDir) &&
      requiredDevelopmentOutputsExist(rootDir)
    );
  } catch {
    return false;
  }
}

/** Records a successful development assembly. */
export function writeDevelopmentPreparationMarker(rootDir: string): void {
  const marker = path.join(rootDir, PREPARATION_MARKER);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(
    marker,
    `${JSON.stringify({
      identity: developmentPreparationIdentity(rootDir),
    })}\n`
  );
}

function runNpmScript(script: string, rootDir: string): void {
  const invocation = npmInvocation(
    ['run', script],
    process.platform,
    process.env,
    process.execPath
  );
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`npm run ${script} failed with exit code ${result.status}`);
  }
}

/** Prepares only stale dependencies and generated assets before development starts. */
export function prepareDevelopment(
  rootDir = ROOT_DIR,
  options: PrepareDevelopmentOptions = {}
): void {
  const dependenciesCurrent =
    options.dependenciesCurrent ??
    ((root: string) => dependencyTargetMatches(root, dependencyTargetFromEnvironment()));
  const assemblyCurrent = options.assemblyCurrent ?? developmentAssemblyCurrent;
  const runScript = options.runScript ?? runNpmScript;
  const writeMarker = options.writeMarker ?? writeDevelopmentPreparationMarker;

  if (!dependenciesCurrent(rootDir)) {
    console.log('Headlamp dependencies are stale; reinstalling.');
    runScript('headlamp:install', rootDir);
  }
  if (!assemblyCurrent(rootDir)) {
    console.log('Development assets are stale; assembling.');
    runScript('headlamp:assemble', rootDir);
    writeMarker(rootDir);
    return;
  }
  console.log('Development dependencies and assets are current.');
}

if (require.main === module) {
  prepareDevelopment();
}
