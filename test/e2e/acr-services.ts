// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  record,
  redact,
  WORKFLOW_PATH,
  type AcrRun,
  type Config,
  type Evidence,
  type Files,
  type WorkflowRun,
} from './acr-workflow';

const batchMeta = /[()\][%!^"`<>&|;, *?]/g;

function batchArgument(value: string): string {
  assert.doesNotMatch(
    value,
    /[\r\n\0]/,
    'Windows batch arguments cannot contain line breaks or NUL'
  );
  let escaped = `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
  for (let level = 0; level < 2; level++) {
    escaped = escaped.replace(batchMeta, '^$&');
  }
  return escaped;
}

/**
 * Injectable CLI boundary; rejects on command failure and resolves to captured stdout.
 * @param binary Executable name.
 * @param args Argument vector; Windows Azure batch shims use escaped cmd.exe arguments.
 * @param input Optional text written to stdin.
 * @returns Command stdout.
 */
export type Command = (binary: string, args: string[], input?: string) => Promise<string>;

/**
 * Runs a CLI with a one-minute deadline and withholds output from failure messages.
 * Windows Azure termination additionally allows up to five seconds for process-tree cleanup.
 * @param binary Executable name.
 * @param args Argument vector; only Windows Azure batch shims may require cmd.exe.
 * @param input Optional text written to stdin.
 * @returns Captured stdout, limited to a 16 MiB buffer.
 * @throws If execution, stdin, timeout or output-buffer handling fails.
 */
export const command: Command = (binary, args, input) =>
  new Promise((resolve, reject) => {
    const failure = (code: string | number = 'unknown') =>
      reject(
        new Error(
          `${binary} ${
            args[0] ?? ''
          } failed (code ${code}). Check authentication, permissions, network and tool availability; command output withheld to protect credentials.`
        )
      );
    const env = { ...process.env, GH_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
    if (process.platform === 'win32' && binary === 'az') {
      const deadline = Date.now() + 60_000;
      const system32 = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
      const lookup = spawnSync(path.win32.join(system32, 'where.exe'), ['az'], {
        env,
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true,
      });
      if (lookup.error || lookup.status !== 0) {
        failure('ENOENT');
        return;
      }
      const executable = lookup.stdout.trim().split(/\r?\n/)[0];
      const batch = /\.(cmd|bat)$/i.test(executable);
      assert.ok(
        batch || /\.(exe|com)$/i.test(executable),
        'Azure CLI resolved to an unsupported Windows entry point'
      );
      // Arguments pass through cmd.exe and then the batch wrapper's %* expansion.
      const argv = batch
        ? [
            '/d',
            '/s',
            '/v:off',
            '/c',
            `"${executable.replace(batchMeta, '^$&')} ${args.map(batchArgument).join(' ')}"`,
          ]
        : args;
      const child = spawn(batch ? path.win32.join(system32, 'cmd.exe') : executable, argv, {
        env,
        windowsHide: true,
        stdio: 'pipe',
        windowsVerbatimArguments: batch,
      });
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const finish = (code?: string | number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === undefined) resolve(Buffer.concat(chunks).toString('utf8'));
        else failure(code);
      };
      const stop = (reason: string) => {
        if (settled) return;
        // Do not wait for close: descendants can retain inherited output pipes.
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (child.pid) {
          const cleanup = spawnSync(
            path.win32.join(system32, 'taskkill.exe'),
            ['/pid', String(child.pid), '/T', '/F'],
            { timeout: 5000, windowsHide: true, stdio: 'ignore' }
          );
          if (cleanup.error || cleanup.status !== 0) {
            reason += '; owned Windows process-tree cleanup could not be confirmed';
          }
        } else {
          child.kill();
        }
        finish(reason);
      };
      const timer = setTimeout(() => stop('ETIMEDOUT'), Math.max(0, deadline - Date.now()));
      child.stdout?.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 16 * 1024 * 1024) {
          stop('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
        } else {
          chunks.push(chunk);
        }
      });
      child.stderr?.resume();
      child.once('error', (error: NodeJS.ErrnoException) => finish(error.code ?? 'unknown'));
      child.once('close', (code, signal) => {
        if (code === 0) finish();
        else finish(code ?? signal ?? 'unknown');
      });
      child.stdin?.on('error', () => stop('EPIPE'));
      child.stdin?.end(input);
      return;
    }
    const child = execFile(
      binary,
      args,
      {
        encoding: 'utf8',
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
        env,
      },
      (error, stdout) => {
        if (error) {
          failure(error.code);
        } else {
          resolve(stdout);
        }
      }
    );
    child.stdin?.on('error', reject);
    child.stdin?.end(input);
  });

function text(value: unknown, label: string): string {
  assert.equal(typeof value, 'string', `Invalid ${label}`);
  return value as string;
}
function list(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `Invalid ${label}`);
  return value;
}
function number(value: unknown, label: string): number {
  assert.equal(typeof value, 'number', `Invalid ${label}`);
  return value as number;
}
function nullableText(value: unknown, label: string): string | null {
  return value === null ? null : text(value, label);
}

/**
 * Validates an ARM ACR run response and extracts correlation/output-image evidence.
 * @param value Untrusted ACR run response.
 * @returns Run ID, status and output-image repository/tag pairs; missing images become an empty list.
 * @throws If required response fields have unexpected shapes or types.
 */
export function parseAcrRun(value: unknown): AcrRun {
  const run = record(value, 'ACR run');
  const properties = record(run.properties, 'ACR run properties');
  return {
    id: text(properties.runId, 'ACR run ID'),
    status: text(properties.status, 'ACR run status'),
    images: list(properties.outputImages ?? [], 'ACR output images').map(value => {
      const image = record(value, 'ACR output image');
      return {
        repository: text(image.repository, 'image repository'),
        tag: text(image.tag, 'image tag'),
      };
    }),
  };
}

function parseWorkflowRun(value: unknown): WorkflowRun {
  const run = record(value, 'workflow run');
  return {
    id: number(run.id, 'GitHub run ID'),
    sha: text(run.head_sha, 'fixture SHA'),
    status: text(run.status, 'GitHub status'),
    conclusion: nullableText(run.conclusion, 'GitHub conclusion'),
    url: text(run.html_url, 'GitHub run URL'),
  };
}

/**
 * Creates sandbox-scoped GitHub/ACR adapters; constructing them performs no remote operations.
 * Resources are owner-provisioned: no implicit branch/registry deletion occurs. Cancellation
 * and image deletion are explicit operations. Methods reject on CLI/API or response-validation errors.
 *
 * @param config Validated sandbox repository, existing branch and exclusive test registry.
 * @param outputDir Local directory for evidence.json and optional redacted acr.log.
 * @param execute Injectable CLI runner; defaults to the bounded real-command implementation.
 * @returns Remote read/write, cancellation, image cleanup and local evidence operations.
 */
export function createServices(config: Config, outputDir: string, execute: Command = command) {
  const repo = `repos/${config.repository}`;
  const arm = `https://management.azure.com${config.registryId}`;
  const registryPath = new URL(arm).pathname.toLowerCase();
  const apiVersion = '2019-04-01';
  const armUrl = (suffix: string) => `${arm}/${suffix}?api-version=${apiVersion}`;
  const github = async (endpoint: string, method = 'GET', body?: unknown): Promise<unknown> => {
    const output = await execute(
      'gh',
      ['api', endpoint, '--method', method, ...(body === undefined ? [] : ['--input', '-'])],
      body === undefined ? undefined : JSON.stringify(body)
    );
    return output.trim() ? JSON.parse(output) : undefined;
  };
  const azure = async (url: string, method = 'GET'): Promise<unknown> => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://management.azure.com');
    assert.ok(target.pathname.toLowerCase().startsWith(`${registryPath}/`));
    const output = await execute('az', [
      'rest',
      '--method',
      method,
      '--url',
      target.href,
      '--only-show-errors',
      '--output',
      'json',
    ]);
    return output.trim() ? JSON.parse(output) : undefined;
  };
  const branchPath = `git/refs/heads/${config.branch.split('/').map(encodeURIComponent).join('/')}`;
  const assertImage = (image: string) => {
    assert.match(image, /^rest29-[a-z0-9-]+:[0-9a-f]{40}$/, 'Refusing non-E2E image mutation');
  };
  return {
    /**
     * Checks the existing sandbox branch, owner-installed workflow and registry public-network setting.
     * @returns Resolves when all prerequisites pass; performs no remote writes.
     * @throws If resources cannot be read, the target is the default branch, the workflow is inactive,
     * the registry login server differs, or public network access is disabled.
     */
    preflight: async () => {
      const metadata = record(await github(repo), 'repository');
      const defaultBranch = text(metadata.default_branch, 'default branch');
      assert.notEqual(config.branch, defaultBranch, 'Never publish fixtures to the default branch');
      await github(`${repo}/git/ref/heads/${config.branch}`);
      // Dispatch discovery requires a workflow file on the default branch, installed by its owner.
      await github(`${repo}/contents/${WORKFLOW_PATH}?ref=${encodeURIComponent(defaultBranch)}`);
      const workflow = record(
        await github(`${repo}/actions/workflows/aksd-acr-e2e.yml`),
        'registered workflow'
      );
      assert.equal(workflow.state, 'active', 'The sandbox dispatch workflow must be active');
      const registry = record(
        await execute('az', [
          'acr',
          'show',
          '--name',
          config.registryName,
          '--resource-group',
          config.registryId.split('/')[4],
          '--subscription',
          config.registryId.split('/')[2],
          '--only-show-errors',
          '--output',
          'json',
        ]).then(JSON.parse),
        'registry'
      );
      assert.equal(registry.loginServer, config.loginServer, 'Registry login server mismatch');
      assert.notEqual(
        registry.publicNetworkAccess,
        'Disabled',
        'Use a registry reachable from GitHub-hosted runners'
      );
    },
    /**
     * Commits fixtures and advances the existing branch without force; does not dispatch a workflow.
     * @param files Repository-relative text files, including the generated workflow.
     * @returns Published fixture commit SHA.
     * @throws If paths are unsafe, the workflow is missing, the branch changes concurrently or an API
     * call fails. Created trees/commits are not rolled back after failure.
     */
    publish: async (files: Files) => {
      const entries = Object.entries(files);
      assert.ok(
        entries.some(([file]) => file === WORKFLOW_PATH),
        'Missing generated workflow'
      );
      for (const [file] of entries) {
        assert.ok(!file.startsWith('/') && !file.split('/').includes('..'), 'Unsafe fixture path');
      }
      const ref = record(await github(`${repo}/git/ref/heads/${config.branch}`), 'fixture branch');
      const parent = text(record(ref.object, 'branch object').sha, 'parent SHA');
      const commit = record(await github(`${repo}/git/commits/${parent}`), 'parent commit');
      const tree = record(
        await github(`${repo}/git/trees`, 'POST', {
          base_tree: text(record(commit.tree, 'base tree').sha, 'base tree SHA'),
          tree: entries.map(([file, content]) => ({
            path: file,
            mode: '100644',
            type: 'blob',
            content,
          })),
        }),
        'new tree'
      );
      const created = record(
        await github(`${repo}/git/commits`, 'POST', {
          message: 'test: Generated ACR Tasks E2E fixture',
          tree: text(tree.sha, 'new tree SHA'),
          parents: [parent],
        }),
        'fixture commit'
      );
      const sha = text(created.sha, 'fixture SHA');
      const current = record(
        await github(`${repo}/git/ref/heads/${config.branch}`),
        'current branch'
      );
      assert.equal(
        record(current.object, 'current branch object').sha,
        parent,
        'Sandbox branch changed concurrently'
      );
      await github(`${repo}/${branchPath}`, 'PATCH', { sha, force: false });
      return sha;
    },
    /**
     * Requests workflow dispatch on the configured branch; acceptance may precede run visibility.
     * @returns Resolves when the dispatch request succeeds, not when the workflow finishes.
     */
    dispatch: async () => {
      await github(`${repo}/actions/workflows/aksd-acr-e2e.yml/dispatches`, 'POST', {
        ref: config.branch,
      });
    },
    /**
     * Finds a dispatch run by fixture SHA on the configured branch.
     * @param sha Published fixture commit SHA.
     * @returns The sole matching run among the first 100 results, or undefined if not yet visible.
     * @throws If multiple matching runs make correlation ambiguous, or the API read fails.
     */
    findWorkflow: async (sha: string): Promise<WorkflowRun | undefined> => {
      const response = record(
        await github(
          `${repo}/actions/workflows/aksd-acr-e2e.yml/runs?event=workflow_dispatch&head_sha=${sha}&branch=${encodeURIComponent(
            config.branch
          )}&per_page=100`
        ),
        'workflow runs'
      );
      const runs = list(response.workflow_runs, 'workflow runs')
        .map(parseWorkflowRun)
        .filter(run => run.sha === sha);
      assert.ok(runs.length <= 1, 'Multiple workflows found for the fixture SHA');
      return runs[0];
    },
    /**
     * Reads a GitHub workflow run snapshot.
     * @param id GitHub Actions run ID.
     * @returns Current status, conclusion and fixture-correlation metadata.
     */
    workflow: async (id: number) => parseWorkflowRun(await github(`${repo}/actions/runs/${id}`)),
    /**
     * Reads job outcomes for the build/deployment gate checks.
     * @param id GitHub Actions run ID.
     * @returns Job display names and nullable conclusions.
     * @throws If the workflow has more than 100 jobs or the response cannot be read/validated.
     */
    jobs: async (id: number) => {
      const response = record(await github(`${repo}/actions/runs/${id}/jobs?per_page=100`), 'jobs');
      assert.ok(number(response.total_count, 'job count') <= 100, 'Too many jobs for this fixture');
      return list(response.jobs, 'jobs').map(value => {
        const job = record(value, 'job');
        return {
          name: text(job.name, 'job name'),
          conclusion: nullableText(job.conclusion, 'job conclusion'),
        };
      });
    },
    /**
     * Reads the configured registry's paginated run history for exclusive-registry correlation.
     * @returns All run snapshots in up to 20 pages.
     * @throws If pagination exceeds the limit, leaves the registry's ARM scope or a read fails.
     */
    runs: async () => {
      const runs: AcrRun[] = [];
      let url: string | undefined = armUrl('runs');
      for (let page = 0; url; page++) {
        assert.ok(page < 20, 'Too many run-history pages; use a dedicated test registry');
        const response = record(await azure(url), 'ACR run list');
        runs.push(...list(response.value, 'ACR runs').map(parseAcrRun));
        url = response.nextLink ? text(response.nextLink, 'ACR nextLink') : undefined;
      }
      return runs;
    },
    /**
     * Reads a single ACR run snapshot.
     * @param id Registry-local ACR run ID.
     * @returns Current run status and reported output images.
     */
    run: async (id: string) => parseAcrRun(await azure(armUrl(`runs/${encodeURIComponent(id)}`))),
    /**
     * Requests GitHub cancellation without waiting for completion or deleting cloud resources.
     * @param id GitHub Actions run ID.
     * @returns Resolves when the cancellation request succeeds.
     */
    cancelWorkflow: async (id: number) => {
      await github(`${repo}/actions/runs/${id}/cancel`, 'POST');
    },
    /**
     * Requests ACR cancellation without waiting for a terminal status or deleting images.
     * @param id Registry-local ACR run ID.
     * @returns Resolves when the cancellation request succeeds.
     */
    cancelAcr: async (id: string) => {
      await azure(armUrl(`runs/${encodeURIComponent(id)}/cancel`), 'POST');
    },
    /**
     * Downloads a build log through an ACR-issued HTTPS Blob SAS URL without redirects.
     * @param id Registry-local ACR run ID.
     * @returns Raw log text; callers must redact it before persisting or displaying it.
     * @throws If the URL is invalid, the download fails/times out or the log reaches its size limit.
     */
    logs: async (id: string) => {
      const response = record(
        await azure(armUrl(`runs/${encodeURIComponent(id)}/listLogSasUrl`), 'POST'),
        'log URL response'
      );
      const url = new URL(text(response.logLink, 'log link'));
      assert.ok(
        url.protocol === 'https:' && url.hostname.endsWith('.blob.core.windows.net'),
        'Unexpected ACR log host'
      );
      const result = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
      });
      assert.ok(result.ok, `ACR log download returned HTTP ${result.status}`);
      const logs = await result.text();
      assert.ok(logs.length < 5 * 1024 * 1024, 'Unexpectedly large fixture log');
      return logs;
    },
    /**
     * Verifies that an E2E image has a SHA-256 digest in the configured registry.
     * @param image Scenario-owned `rest29-...:<40-character fixture SHA>` image reference.
     * @returns Resolves when registry metadata contains a valid digest; does not pull the image.
     * @throws If the image is not an E2E reference or the metadata lookup/digest check fails.
     */
    verifyImage: async (image: string) => {
      assertImage(image);
      const metadata = record(
        JSON.parse(
          await execute('az', [
            'acr',
            'repository',
            'show',
            '--name',
            config.registryName,
            '--subscription',
            config.registryId.split('/')[2],
            '--image',
            image,
            '--only-show-errors',
            '--output',
            'json',
          ])
        ),
        'registry image'
      );
      assert.match(
        text(metadata.digest, 'image digest'),
        /^sha256:[0-9a-f]{64}$/,
        'Invalid image digest'
      );
    },
    /**
     * Explicitly deletes the manifest addressed by an E2E tag, including any other tags on it.
     * @param image Scenario-owned `rest29-...:<40-character fixture SHA>` image reference.
     * @returns Resolves after the registry deletion command succeeds; the registry itself remains.
     * @throws If the image is not an E2E reference or the deletion command fails.
     */
    deleteImage: async (image: string) => {
      assertImage(image);
      await execute('az', [
        'acr',
        'repository',
        'delete',
        '--name',
        config.registryName,
        '--subscription',
        config.registryId.split('/')[2],
        '--image',
        image,
        '--yes',
        '--only-show-errors',
      ]);
    },
    /**
     * Writes local evidence and, when supplied, a redacted log; performs no cloud cleanup.
     * @param evidence Snapshot serialized as supplied; error fields must already be redacted.
     * @param logs Optional raw log text to redact and write as acr.log.
     * @returns Resolves after evidence.json and any supplied log have been written.
     */
    save: async (evidence: Evidence, logs?: string) => {
      await fs.mkdir(outputDir, { recursive: true });
      await fs.writeFile(
        path.join(outputDir, 'evidence.json'),
        JSON.stringify(evidence, null, 2) + '\n'
      );
      if (logs !== undefined) await fs.writeFile(path.join(outputDir, 'acr.log'), redact(logs));
    },
  };
}

/**
 * Runs local actionlint against the generated fixture workflow with shellcheck disabled.
 * @param files Fixture map containing `WORKFLOW_PATH`.
 * @param execute Injectable CLI runner; defaults to the bounded real-command implementation.
 * @returns Resolves when actionlint accepts the workflow.
 * @throws If actionlint is unavailable, rejects the workflow or command execution fails.
 */
export async function validateWorkflow(files: Files, execute: Command = command): Promise<void> {
  await execute('actionlint', ['-shellcheck=', '-'], files[WORKFLOW_PATH]);
}
