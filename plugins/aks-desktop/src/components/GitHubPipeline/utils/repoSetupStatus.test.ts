// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { Octokit } from '@octokit/rest';
import { Buffer } from 'buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';
import { createValidConfig } from '../__fixtures__/pipelineConfig';
import { AGENT_CONFIG_PATH, COPILOT_SETUP_STEPS_PATH } from '../constants';
import { getAcrBuildFiles } from './acrTasks/acrTaskRunner';
import {
  generateAcrWorkflowInstructions,
  generateAgentConfig,
  SETUP_WORKFLOW_CONTENT,
  upgradeAgentConfig,
} from './agentTemplates';
import { getRepoSetupStatus } from './repoSetupStatus';

const config = createValidConfig({ acrLoginServer: 'myregistry.azurecr.io' });
const commitSha = 'a'.repeat(40);
const getRef = vi.fn();
const getContent = vi.fn();
const octokit = { git: { getRef }, repos: { getContent } } as unknown as Octokit;
let files: Record<string, string>;

describe('getRepoSetupStatus', () => {
  beforeEach(() => {
    getRef.mockReset().mockResolvedValue({ data: { object: { sha: commitSha } } });
    files = {
      [COPILOT_SETUP_STEPS_PATH]: SETUP_WORKFLOW_CONTENT,
      [AGENT_CONFIG_PATH]: generateAgentConfig(config),
      ...getAcrBuildFiles(),
    };
    getContent.mockReset().mockImplementation(async ({ path }) => {
      if (!(path in files)) throw Object.assign(new Error('Not found'), { status: 404 });
      return {
        data: {
          type: 'file',
          encoding: 'base64',
          sha: `sha:${path}`,
          content: Buffer.from(files[path]).toString('base64'),
        },
      };
    });
  });

  it('accepts the canonical bundle and preserves unrelated custom agent guidance', async () => {
    files[AGENT_CONFIG_PATH] += '\n## Repository guidance\nUse the existing test runner.\n';
    expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: true });
    for (const path of Object.keys(files)) {
      expect(getContent).toHaveBeenCalledWith({
        owner: config.repo.owner,
        repo: config.repo.repo,
        path,
        ref: commitSha,
      });
    }
    expect(getRef).toHaveBeenCalledTimes(2);
    expect(getRef).toHaveBeenNthCalledWith(1, {
      owner: config.repo.owner,
      repo: config.repo.repo,
      ref: `heads/${config.repo.defaultBranch}`,
    });
    expect(getRef).toHaveBeenNthCalledWith(2, {
      owner: config.repo.owner,
      repo: config.repo.repo,
      ref: `heads/${config.repo.defaultBranch}`,
    });
    expect(getRef.mock.invocationCallOrder[0]).toBeLessThan(getContent.mock.invocationCallOrder[0]);
    expect(getRef.mock.invocationCallOrder[1]).toBeGreaterThan(
      Math.max(...getContent.mock.invocationCallOrder)
    );
  });

  it.each([AGENT_CONFIG_PATH, COPILOT_SETUP_STEPS_PATH, ...Object.keys(getAcrBuildFiles())])(
    'does not fill a missing snapshot file from a later branch revision: %s',
    async missingPath => {
      const snapshot = { ...files };
      delete snapshot[missingPath];
      getContent.mockImplementation(async ({ path, ref }) => {
        const revision = ref === commitSha ? snapshot : files;
        if (!(path in revision)) throw Object.assign(new Error('Not found'), { status: 404 });
        return {
          data: {
            type: 'file',
            encoding: 'base64',
            sha: `sha:${path}`,
            content: Buffer.from(revision[path]).toString('base64'),
          },
        };
      });

      expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: false });
      expect(getContent).toHaveBeenCalledTimes(Object.keys(files).length);
      expect(getContent.mock.calls.every(([{ ref }]) => ref === commitSha)).toBe(true);
    }
  );

  it.each([true, false])(
    'reports retryable verification failure, not obsolete setup, when the branch moves (valid=%s)',
    async valid => {
      const branchConfig = {
        ...config,
        repo: { ...config.repo, defaultBranch: 'release/deploy' },
      };
      getRef.mockResolvedValueOnce({ data: { object: { sha: commitSha } } });
      const readContent = getContent.getMockImplementation()!;
      if (!valid) delete files[AGENT_CONFIG_PATH];
      getContent.mockImplementation(async args => {
        getRef.mockResolvedValue({ data: { object: { sha: 'b'.repeat(40) } } });
        return readContent(args);
      });

      await expect(getRepoSetupStatus(octokit, branchConfig)).rejects.toThrow(
        'Repository branch changed during setup verification. Please retry.'
      );
      expect(getContent.mock.calls.every(([{ ref }]) => ref === commitSha)).toBe(true);
      expect(getRef).toHaveBeenLastCalledWith({
        owner: config.repo.owner,
        repo: config.repo.repo,
        ref: 'heads/release/deploy',
      });
    }
  );

  it('accepts current previously generated REST instructions without requiring new markers', async () => {
    files[AGENT_CONFIG_PATH] = files[AGENT_CONFIG_PATH].replace(
      /<!-- aks-desktop:deployment:v1:(?:start|end) -->\n|<!-- Generated deployment contract:[^\n]*\n/g,
      ''
    );
    expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: true });
  });

  it('accepts the exact legacy marked REST template and custom suffix', async () => {
    const instructions = generateAcrWorkflowInstructions(config);
    files[AGENT_CONFIG_PATH] = files[AGENT_CONFIG_PATH].replace(
      /<!-- aks-desktop:deployment:v1:(?:start|end) -->\n|<!-- Generated deployment contract:[^\n]*\n/g,
      ''
    ).replace(
      instructions.trim(),
      `<!-- aks-desktop:acr-build:start -->${instructions}<!-- aks-desktop:acr-build:end -->\n`
    );
    files[AGENT_CONFIG_PATH] += '\n## Repository guidance\nKeep tests.\n';
    expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: true });
  });

  it('accepts compatible custom setup tool steps, services and permissions', async () => {
    const workflow = YAML.parse(files[COPILOT_SETUP_STEPS_PATH]);
    workflow.permissions = { contents: 'read', 'pull-requests': 'write' };
    const job = workflow.jobs['copilot-setup-steps'];
    job.services = { redis: { image: 'redis:7' } };
    job.steps.push({ name: 'Repository tests', run: 'npm test' });
    files[COPILOT_SETUP_STEPS_PATH] = YAML.stringify(workflow);
    expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: true });
  });

  it.each(['trigger', 'runner'])(
    'does not mark an unexecutable custom setup current (%s)',
    async missing => {
      const workflow = YAML.parse(files[COPILOT_SETUP_STEPS_PATH]);
      if (missing === 'trigger') delete workflow.on;
      else delete workflow.jobs['copilot-setup-steps']['runs-on'];
      files[COPILOT_SETUP_STEPS_PATH] = YAML.stringify(workflow);
      expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: false });
    }
  );

  it('does not accept stale targets simply because the ACR instructions are current', async () => {
    const next = {
      ...config,
      clusterName: 'new-cluster',
      namespace: 'new-namespace',
      resourceGroup: 'new-group',
    };
    expect(await getRepoSetupStatus(octokit, next)).toEqual({ isCurrent: false });
    files[AGENT_CONFIG_PATH] = upgradeAgentConfig(files[AGENT_CONFIG_PATH], next);
    expect(await getRepoSetupStatus(octokit, next)).toEqual({ isCurrent: true });
  });

  it('rejects a stale generated workflow filename and validation target', async () => {
    const current = files[AGENT_CONFIG_PATH];
    for (const stale of [
      current.replace(/deploy-to-aks\.yml/g, 'old-deploy.yml'),
      current.replace(
        'All manifests target namespace `production`',
        'All manifests target namespace `old`'
      ),
    ]) {
      files[AGENT_CONFIG_PATH] = stale;
      expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: false });
    }
  });

  it('requires an upgrade for old CLI instructions even when both setup files exist', async () => {
    files[AGENT_CONFIG_PATH] = '- Build/push image via ACR Tasks: `az acr build --registry old .`';
    for (const path of Object.keys(getAcrBuildFiles())) delete files[path];
    expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: false });
  });

  it.each(Object.keys(getAcrBuildFiles()))(
    'requires the complete current runtime: %s',
    async path => {
      delete files[path];
      expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: false });
      files[path] = '# old runtime version\n';
      expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: false });
    }
  );

  it('checks managed deployment instructions without imposing stock setup tool versions', async () => {
    files[COPILOT_SETUP_STEPS_PATH] = SETUP_WORKFLOW_CONTENT.replace(
      'actions/setup-node@v4',
      'actions/setup-node@v3'
    );
    expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: true });
    files[COPILOT_SETUP_STEPS_PATH] = SETUP_WORKFLOW_CONTENT;
    files[AGENT_CONFIG_PATH] = '# custom agent missing build instructions\n';
    expect(await getRepoSetupStatus(octokit, config)).toEqual({ isCurrent: false });
  });

  it('rejects ID-only deployment setup rather than accepting a guessed registry login host', async () => {
    const idConfig = {
      ...config,
      acrLoginServer: undefined,
      acrResourceId:
        '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerRegistry/registries/myregistry',
    };
    expect(() => generateAgentConfig(idConfig)).toThrow('actual ACR login server');
    expect(await getRepoSetupStatus(octokit, idConfig)).toEqual({ isCurrent: false });
  });

  it('does not require runtime files without a registry', async () => {
    const plainConfig = createValidConfig();
    files[AGENT_CONFIG_PATH] = generateAgentConfig(plainConfig);
    for (const path of Object.keys(getAcrBuildFiles())) delete files[path];
    expect(await getRepoSetupStatus(octokit, plainConfig)).toEqual({ isCurrent: true });
    expect(getContent).toHaveBeenCalledTimes(2);
    expect(getContent.mock.calls.every(([{ ref }]) => ref === commitSha)).toBe(true);
  });

  it('requires an upgrade for retained ACR instructions after the registry is deselected', async () => {
    const plainConfig = createValidConfig();
    expect(await getRepoSetupStatus(octokit, plainConfig)).toEqual({ isCurrent: false });
    files[AGENT_CONFIG_PATH] = upgradeAgentConfig(files[AGENT_CONFIG_PATH], plainConfig);
    expect(await getRepoSetupStatus(octokit, plainConfig)).toEqual({ isCurrent: true });
    files[AGENT_CONFIG_PATH] +=
      '\n<!-- aks-desktop:acr-build:start -->\nUse secrets.AZURE_ACR_NAME\n<!-- aks-desktop:acr-build:end -->';
    expect(await getRepoSetupStatus(octokit, plainConfig)).toEqual({ isCurrent: false });
  });

  it.each([401, 403, 429, 500])(
    'propagates lookup errors (%s), never treating them as current',
    async status => {
      getContent.mockRejectedValueOnce(Object.assign(new Error('Lookup failed'), { status }));
      await expect(getRepoSetupStatus(octokit, config)).rejects.toThrow('Lookup failed');
    }
  );

  it.each([404, 401, 403, 429, 500, undefined])(
    'propagates branch lookup failures on both the initial lookup and recheck (%s)',
    async status => {
      const error = Object.assign(new Error('Branch lookup failed'), { status });
      getRef.mockRejectedValueOnce(error);
      await expect(getRepoSetupStatus(octokit, config)).rejects.toThrow('Branch lookup failed');
      expect(getContent).not.toHaveBeenCalled();

      getRef
        .mockResolvedValueOnce({ data: { object: { sha: commitSha } } })
        .mockRejectedValueOnce(error);
      await expect(getRepoSetupStatus(octokit, config)).rejects.toThrow('Branch lookup failed');
      expect(getContent).toHaveBeenCalled();
    }
  );

  it('rejects directories and unavailable content instead of treating them as current', async () => {
    getContent.mockResolvedValueOnce({ data: [] });
    await expect(getRepoSetupStatus(octokit, config)).rejects.toThrow(
      'not a readable regular file'
    );
    getContent.mockResolvedValueOnce({ data: { type: 'file', sha: 'sha', encoding: 'none' } });
    await expect(getRepoSetupStatus(octokit, config)).rejects.toThrow(
      'not a readable regular file'
    );
  });
});
