// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'fs';
import * as path from 'path';

import { resolveTargetArch } from './aks-mcp-config';

interface RuntimeConfig {
  url: string;
  checksum: string;
  runtimeArch?: string;
}

interface AzureCliConfig {
  version?: string;
  extensions?: string[];
  win32?: Record<string, RuntimeConfig>;
}

interface PythonConfig {
  linux?: Record<string, RuntimeConfig>;
  darwin?: Record<string, RuntimeConfig>;
}

export interface AzureCliTarget {
  platform: string;
  arch: string;
  version: string;
  extensions: string[];
  python?: RuntimeConfig;
  windowsPackage?: RuntimeConfig;
}

export async function verifyRequiredArtifact(
  verification: Promise<boolean>,
  artifactName: string
): Promise<void> {
  if (!(await verification)) {
    throw new Error(`${artifactName} checksum verification failed`);
  }
}

export function installRequiredExtensions(
  extensions: string[],
  install: (extension: string) => void
): void {
  for (const extension of extensions) {
    install(extension);
  }
}

const SUPPORTED_ARCHES = new Set(['arm64', 'x64']);
const SUPPORTED_PLATFORMS = new Set(['darwin', 'linux', 'win32']);

export function resolveAzureCliTarget(
  rootDir: string,
  platform: string = process.platform,
  arch?: string
): AzureCliTarget {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported platform for Azure CLI: ${platform}`);
  }

  const targetArch = resolveTargetArch(arch);
  if (!SUPPORTED_ARCHES.has(targetArch)) {
    throw new Error(`Unsupported architecture for Azure CLI: ${targetArch}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const externalTools = packageJson.config?.externalTools ?? {};
  const azureCli = (externalTools.azureCli ?? {}) as AzureCliConfig;
  const version = azureCli.version ?? '';
  if (!version) {
    throw new Error('config.externalTools.azureCli.version must be configured');
  }

  const target: AzureCliTarget = {
    platform,
    arch: targetArch,
    version,
    extensions: azureCli.extensions ?? [],
  };

  if (platform === 'win32') {
    target.windowsPackage = azureCli.win32?.[targetArch];
    if (!target.windowsPackage?.url || !target.windowsPackage.checksum) {
      throw new Error(
        `No verified Azure CLI package configured for ${platform}/${targetArch}`
      );
    }
    return target;
  }

  const python = externalTools.python as PythonConfig | undefined;
  const unixPlatform = platform as 'darwin' | 'linux';
  target.python = python?.[unixPlatform]?.[targetArch];
  if (!target.python?.url || !target.python.checksum) {
    throw new Error(`No verified Python runtime configured for ${platform}/${targetArch}`);
  }
  return target;
}
