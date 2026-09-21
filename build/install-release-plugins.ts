#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const { resolveInstalledHeadlampPaths } = require(
  '../packages/headlamp-source/src/lib/paths.ts'
);

const ROOT_DIR = path.dirname(__dirname);
const AI_ASSISTANT_SEED_START = 'async function rqe(){';
const AI_ASSISTANT_SEED_END =
  'console.error("Error preconfiguring built-in MCP servers:",o)}}';
const AI_ASSISTANT_RETIREMENT = [
  'async function rqe(){var e,n;',
  'const t=typeof window>"u"||(e=window.desktopApi)==null?void 0:e.mcp;',
  'if(!t)return;try{const r=await t.getConfig();',
  'if(!(r!=null&&r.success)||!Array.isArray((n=r.config)==null?void 0:n.servers))return;',
  'const s={...tqe,...r.config},',
  'o=s.servers.filter(a=>!(gb(a.name)===GUe&&RA(yb(a),yb(JUe()))));',
  'if(o.length===s.servers.length)return;',
  'const i={...s,servers:o},u=await t.updateConfig(i);',
  'u!=null&&u.success&&cn.update({mcpConfig:i,seededBuiltinMCPServers:{}})',
  '}catch(r){console.error("Error retiring built-in AKS MCP server:",r)}}',
].join('');

/** Replaces the pinned release's AKS MCP seeding startup with a retirement migration. */
export function retireBundledAksMcp(bundle: string): string {
  const start = bundle.indexOf(AI_ASSISTANT_SEED_START);
  const end = bundle.indexOf(AI_ASSISTANT_SEED_END, start);
  if (start === -1 || end === -1) {
    throw new Error('Pinned AI Assistant release does not contain the reviewed aks-mcp seed');
  }
  if (bundle.indexOf(AI_ASSISTANT_SEED_START, start + 1) !== -1) {
    throw new Error('Pinned AI Assistant release contains multiple aks-mcp seed functions');
  }
  return bundle.slice(0, start) + AI_ASSISTANT_RETIREMENT +
    bundle.slice(end + AI_ASSISTANT_SEED_END.length);
}

/** Returns the app-manifest subset that installs pinned release plugins. */
export function releasePluginManifest(project: any): { plugins: any[] } {
  const plugins = project?.headlamp?.plugins;
  if (!Array.isArray(plugins)) {
    throw new Error('package.json must declare headlamp.plugins');
  }
  return {
    plugins: plugins.filter(plugin => plugin.archive !== undefined || plugin.file !== undefined),
  };
}

/** Installs release plugins through Headlamp's checksum-verifying app-manifest installer. */
export function installReleasePlugins(rootDir: string = ROOT_DIR): void {
  const project = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const manifest = releasePluginManifest(project);
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'headlamp-release-plugins-'));
  const manifestPath = path.join(temporaryDirectory, 'manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const { appDir, sourceDir } = resolveInstalledHeadlampPaths(rootDir);
  const installer = path.join(appDir, 'scripts', 'setup-plugins.ts');
  try {
    const result = spawnSync(process.execPath, ['--import', 'tsx', installer], {
      cwd: rootDir,
      env: { ...process.env, HEADLAMP_BUILD_MANIFEST: manifestPath },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`Release plugin installation failed with exit code ${result.status}`);
    }
    const aiAssistantBundle = path.join(sourceDir, '.plugins', 'ai-assistant', 'main.js');
    if (manifest.plugins.some(plugin => plugin.name === 'ai-assistant')) {
      const bundle = fs.readFileSync(aiAssistantBundle, 'utf8');
      fs.writeFileSync(aiAssistantBundle, retireBundledAksMcp(bundle));
    }
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  installReleasePlugins();
}