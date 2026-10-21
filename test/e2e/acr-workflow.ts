// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { generateDeployWorkflow } from '../../plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathTemplates';
import type { createServices } from './acr-services';

const yaml: {
  parse: (text: string) => unknown;
  stringify: (value: unknown, options: { lineWidth: number }) => string;
} = createRequire(path.resolve(__dirname, '../../plugins/aks-desktop/package.json'))('yaml');

/** Repository-relative sandbox workflow path; its default-branch copy is installed by the owner. */
export const WORKFLOW_PATH = '.github/workflows/aksd-acr-e2e.yml';
/** No-op deployment job name used to verify that the generated build gates deployment. */
export const GATE_NAME = 'ACR E2E deployment gate';
/** Repository-relative nested build context used by all scenarios. */
export const CONTEXT_PATH = 'fixtures/acr-e2e/services/api';
/** Success, Dockerfile outside the context, intentional build failure, and workflow cancellation. */
export const SCENARIOS = ['success', 'external', 'failure', 'cancel'] as const;
/** One supported generated-workflow acceptance scenario. */
export type Scenario = (typeof SCENARIOS)[number];
/** Repository-relative fixture paths mapped to their UTF-8 file contents. */
export type Files = Record<string, string>;

/** Owner-provisioned sandbox resources; the helpers do not create or delete the branch or registry. */
export interface Config {
  /** GitHub repository in `owner/name` form. */
  repository: string;
  /** Existing dedicated `aksd-acr-e2e` branch, never the default branch. */
  branch: string;
  /** Full ARM ID of the exclusive test registry. */
  registryId: string;
  /** Registry name derived from the final segment of `registryId`. */
  registryName: string;
  /** Public Azure registry login server matching `registryName` (name.azurecr.io). */
  loginServer: string;
}

/** ACR Tasks run snapshot used for correlation and output-image evidence. */
export interface AcrRun {
  /** Registry-local ACR run ID, not an ARM resource ID. */
  id: string;
  /** ACR service status, such as `Running`, `Succeeded`, `Failed` or `Canceled`. */
  status: string;
  /** Output images reported by ACR; may be empty before completion or after a failed build. */
  images: Array<{
    /** Image repository without the registry hostname. */
    repository: string;
    /** Published image tag, expected to match the fixture commit SHA. */
    tag: string;
  }>;
}

/** GitHub Actions run snapshot correlated with a published fixture commit. */
export interface WorkflowRun {
  /** GitHub Actions run ID used for polling and cancellation. */
  id: number;
  /** Head commit SHA used to correlate the workflow with its fixture. */
  sha: string;
  /** GitHub run status; `completed` is terminal. */
  status: string;
  /** GitHub outcome, or `null` while no conclusion is available. */
  conclusion: string | null;
  /** Browser URL for inspecting the workflow run. */
  url: string;
}

/** Job outcome used to check the generated build/deployment dependency. */
export interface Job {
  /** Display name of the GitHub Actions job. */
  name: string;
  /** GitHub job outcome, or `null` before it has concluded. */
  conclusion: string | null;
}

/** Mutable scenario evidence, persisted before and after cleanup without changing its verdict. */
export interface Evidence {
  /** Acceptance scenario being exercised. */
  scenario: Scenario;
  /** Local checkout's HEAD commit when the fixture was generated. */
  generatorRevision: string;
  /** Whether the local checkout had uncommitted changes at generation time. */
  generatorDirty: boolean;
  /** Unique `rest29-` image repository owned by this scenario. */
  imageName: string;
  /** Published fixture commit SHA, also used as the image tag; absent before publication. */
  fixtureSha?: string;
  /** Correlated GitHub run snapshot, once discovered. */
  githubRun?: WorkflowRun;
  /** Correlated ACR run snapshot; recovery may fill it if initial discovery was interrupted. */
  acrRun?: AcrRun;
  /** Test verdict recorded before cleanup; cleanup success cannot establish cancellation success. */
  verdict?: 'passed' | 'failed';
  /** Redacted scenario failure message, when a failure was recorded. */
  error?: string;
  /** Redacted recovery failures appended separately from the scenario verdict. */
  cleanupErrors: string[];
}

/**
 * Narrows an untrusted service or YAML value to a non-array object.
 * @param value Value to check.
 * @param label Context included in assertion failures.
 * @returns The validated object.
 * @throws If the value is null, an array or not an object.
 */
export function record(value: unknown, label: string): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `Invalid ${label}`);
  return value as Record<string, unknown>;
}
/**
 * Parses workflow YAML and validates its top-level shape.
 * @param source Workflow YAML text.
 * @returns Parsed workflow mapping.
 * @throws If the YAML is invalid or does not contain a top-level object.
 */
export const parseWorkflow = (source: string) => record(yaml.parse(source), 'generated workflow');

/**
 * Reads the explicit sandbox opt-in and validates its resource identifiers without remote writes.
 * @param env Environment containing `AKSD_E2E_` settings: `REPOSITORY`, `BRANCH`, `ACR_RESOURCE_ID`,
 * `ACR_LOGIN_SERVER` and `EXCLUSIVE_REGISTRY=1`.
 * @returns Validated sandbox configuration, including the registry name derived from its ARM ID.
 * @throws If required settings, the exclusive-registry acknowledgement or identifier checks fail.
 */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const keys = ['REPOSITORY', 'BRANCH', 'ACR_RESOURCE_ID', 'ACR_LOGIN_SERVER'];
  const values = keys.map(key => env[`AKSD_E2E_${key}`]?.trim());
  assert.ok(
    values.every(Boolean),
    `Missing E2E configuration: ${keys.filter((_, i) => !values[i]).join(', ')}`
  );
  assert.equal(
    env.AKSD_E2E_EXCLUSIVE_REGISTRY,
    '1',
    'Set AKSD_E2E_EXCLUSIVE_REGISTRY=1 only for an exclusive test registry'
  );
  const [repository, branch, registryId, loginServer] = values.map(value => value!);
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/, 'Expected owner/repository');
  assert.match(branch, /^aksd-acr-e2e(?:[-/][a-z0-9-]+)?$/, 'Use a dedicated aksd-acr-e2e branch');
  const registry = registryId.match(
    /^\/subscriptions\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/resourceGroups\/[\p{L}\p{N}_.()-]+\/providers\/Microsoft\.ContainerRegistry\/registries\/([a-z0-9]{5,50})$/iu
  );
  assert.ok(registry, 'Expected a full ACR ARM resource ID');
  assert.equal(loginServer.toLowerCase(), `${registry[1].toLowerCase()}.azurecr.io`);
  return { repository, branch, registryId, registryName: registry[1], loginServer };
}

/**
 * Keeps the generated build unchanged but replaces deployment with a no-op dependency gate.
 * @param source Production-generated workflow YAML.
 * @returns Dispatch-only workflow YAML that performs no AKS deployment.
 * @throws If expected build/deploy jobs, build steps or deployment dependencies are missing.
 */
export function adaptWorkflow(source: string): string {
  const workflow = parseWorkflow(source);
  const jobs = record(workflow.jobs, 'generated jobs');
  const build = structuredClone(record(jobs.buildImage, 'generated buildImage job'));
  const deploy = record(jobs.deploy, 'generated deploy job');
  assert.ok(Array.isArray(build.steps), 'Generated build job must have steps');
  assert.ok(deploy.needs, 'Generated deployment must depend on the build');
  jobs.deploy = {
    ...deploy,
    name: GATE_NAME,
    permissions: {},
    steps: [
      { name: GATE_NAME, run: 'echo "Generated build succeeded; no AKS deployment performed"' },
    ],
  };
  workflow.on = { workflow_dispatch: null };
  assert.deepEqual(jobs.buildImage, build);
  return yaml.stringify(workflow, { lineWidth: 0 });
}

/**
 * Rejects the legacy CLI build command before the fixture can be published.
 * @param source Generated workflow text to inspect.
 * @returns Normally when no `az acr build` command is present.
 * @throws If the workflow still invokes `az acr build`.
 */
export function assertRestWorkflow(source: string): void {
  assert.doesNotMatch(
    source,
    /\baz\s+acr\s+build\b/,
    'REST-29 is not implemented: the generated workflow still runs az acr build; no remote writes performed'
  );
}

/**
 * Generates the production ACR build workflow with a no-op deployment gate for a sandbox scenario.
 * @param config Validated, owner-provisioned repository and registry settings.
 * @param imageName Scenario-owned image repository name.
 * @param marker Non-secret `E2E_MARKER` build argument used to prove the build inputs.
 * @param dockerfilePath Repository-relative Dockerfile path; defaults to the nested fixture context.
 * @returns Dispatch-only acceptance workflow YAML.
 * @throws If production generation or the REST/build-dependency assertions fail.
 */
export function generateWorkflow(
  config: Config,
  imageName: string,
  marker: string,
  dockerfilePath = `${CONTEXT_PATH}/Dockerfile`
): string {
  const generatorConfig = {
    acrResourceId: config.registryId,
    buildArguments: { E2E_MARKER: marker },
    appName: imageName,
    acrName: config.registryName,
    defaultBranch: config.branch,
    clusterName: 'not-used',
    resourceGroup: 'not-used',
    namespace: 'not-used',
    dockerfilePath,
    buildContextPath: CONTEXT_PATH,
  };
  const source = generateDeployWorkflow(generatorConfig);
  assertRestWorkflow(source);
  return adaptWorkflow(source);
}

/**
 * Removes URL queries, bearer tokens and JWT-shaped values from diagnostic text.
 * @param text Diagnostic output that may contain credentials; arbitrary secrets are not detected.
 * @returns Text with recognized credential forms replaced by redaction markers.
 */
export function redact(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s"'<>?]+)\?[^\s"'<>]*/g, '$1?[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]');
}

/**
 * Recognizes terminal status spellings returned by ACR Tasks.
 * @param status Case-sensitive ACR run status.
 * @returns Whether the run has succeeded, failed, canceled, errored or timed out.
 */
export const isTerminal = (status: string) =>
  ['Succeeded', 'Failed', 'Canceled', 'Error', 'Timeout'].includes(status);

/**
 * Correlates a new run by exclusion in an exclusively used test registry.
 * @param before Registry run IDs captured before dispatch.
 * @param runs Current registry run snapshots.
 * @returns The sole newly observed run, or undefined if none is visible yet.
 * @throws If multiple new runs invalidate the exclusive-registry assumption.
 */
export function newRun(before: Set<string>, runs: AcrRun[]): AcrRun | undefined {
  const added = runs.filter(run => !before.has(run.id));
  assert.ok(
    added.length <= 1,
    'Multiple ACR runs appeared: exclusive-registry assumption violated'
  );
  return added[0];
}

/**
 * Polls until a value satisfies a predicate, bounded by an absolute deadline between reads.
 * @param label Description included in timeout errors.
 * @param read Asynchronous snapshot reader; individual calls must enforce their own timeouts.
 * @param done Predicate identifying an acceptable snapshot.
 * @param deadline Absolute epoch-millisecond deadline; defaults to one minute from now.
 * @param intervalMs Delay between reads, capped by remaining time; defaults to five seconds.
 * @returns The first snapshot accepted by the predicate.
 * @throws If a read/predicate fails or the deadline is reached without an accepted snapshot.
 */
export async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  deadline = Date.now() + 60_000,
  intervalMs = 5000
): Promise<T> {
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    assert.ok(Date.now() < deadline, `Timed out waiting for ${label}`);
    await setTimeout(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
}

/**
 * Waits for exactly one ACR run to appear after the pre-dispatch snapshot.
 * @param client Registry run-list reader.
 * @param before Registry run IDs captured before dispatch.
 * @param deadline Absolute epoch-millisecond deadline.
 * @param intervalMs Polling delay in milliseconds; defaults to five seconds.
 * @returns The newly observed run.
 * @throws If polling fails, times out or observes multiple new runs.
 */
export async function waitForAcrRun(
  client: Pick<ReturnType<typeof createServices>, 'runs'>,
  before: Set<string>,
  deadline: number,
  intervalMs = 5000
): Promise<AcrRun> {
  const run = await waitFor(
    'one correlated ACR run',
    async () => newRun(before, await client.runs()),
    run => run !== undefined,
    deadline,
    intervalMs
  );
  assert.ok(run);
  return run;
}

/**
 * Recovers a possibly accepted dispatch, cancels unfinished runs, and deletes a reported fixture image.
 * Mutates correlation/error evidence but never its pre-recorded verdict. Leaves the owner-provisioned
 * branch and registry intact; cleanup cannot serve as the scenario's cancellation-success oracle.
 *
 * @param client GitHub/ACR recovery operations, scoped to the configured sandbox.
 * @param evidence Mutable evidence with a recorded verdict and published fixture SHA.
 * @param before Registry run IDs captured before dispatch for exclusive-registry correlation.
 * @param budgetMs Shared recovery polling budget in milliseconds; defaults to one minute.
 * @param intervalMs Polling delay in milliseconds; defaults to five seconds.
 * @returns Resolves after both GitHub and ACR recovery have completed.
 * @throws If prerequisite evidence is missing, or an AggregateError if either recovery fails;
 * recovery errors are also appended to `evidence.cleanupErrors`.
 */
export async function cleanupDispatched(
  client: Pick<
    ReturnType<typeof createServices>,
    'findWorkflow' | 'workflow' | 'runs' | 'run' | 'cancelWorkflow' | 'cancelAcr' | 'deleteImage'
  >,
  evidence: Evidence,
  before: Set<string>,
  budgetMs = 60_000,
  intervalMs = 5000
): Promise<void> {
  assert.ok(evidence.verdict, 'Record the verdict before emergency cleanup');
  assert.ok(evidence.fixtureSha, 'Missing dispatched fixture SHA');
  const deadline = Date.now() + budgetMs;
  const errors: Error[] = [];
  const attempt = async (label: string, action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      const failure = new Error(
        `${label}: ${redact(error instanceof Error ? error.message : String(error))}`
      );
      evidence.cleanupErrors.push(failure.message);
      errors.push(failure);
    }
  };
  await attempt('GitHub recovery', async () => {
    const github =
      evidence.githubRun ??
      (await waitFor(
        'accepted GitHub dispatch to become visible',
        () => client.findWorkflow(evidence.fixtureSha!),
        run => run !== undefined,
        deadline,
        intervalMs
      ));
    assert.ok(github);
    evidence.githubRun = github;
    if ((await client.workflow(github.id)).status !== 'completed') {
      await client.cancelWorkflow(github.id);
      await waitFor(
        'GitHub cancellation',
        () => client.workflow(github.id),
        run => run.status === 'completed',
        deadline,
        intervalMs
      );
    }
  });
  await attempt('ACR recovery', async () => {
    const acr = evidence.acrRun ?? (await waitForAcrRun(client, before, deadline, intervalMs));
    evidence.acrRun = acr;
    if (!isTerminal((await client.run(acr.id)).status)) {
      await client.cancelAcr(acr.id);
      await waitFor(
        'ACR cancellation',
        () => client.run(acr.id),
        run => isTerminal(run.status),
        deadline,
        intervalMs
      );
    }
    const final = await client.run(acr.id);
    if (
      final.images.some(
        image => image.repository === evidence.imageName && image.tag === evidence.fixtureSha
      )
    ) {
      await client.deleteImage(`${evidence.imageName}:${evidence.fixtureSha}`);
    }
  });
  if (errors.length)
    throw new AggregateError(
      errors,
      'Unresolved dispatch or cleanup failure; do not start another scenario'
    );
}
