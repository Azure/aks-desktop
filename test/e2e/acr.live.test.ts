// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { getAcrBuildFiles } from '../../plugins/aks-desktop/src/components/GitHubPipeline/utils/acrTasks/acrTaskRunner';
import { createOctokitClient } from '../../plugins/aks-desktop/src/utils/github/github-api';
import {
  INTERRUPTION_GRACE_MS,
  liveInterruption,
  NORMAL_WORK_BUDGET_MS,
  RECOVERY_BUDGET_MS,
  requestDeadline,
} from './acr-interruption';
import { verifyRuntimePublication } from './acr-publication';
import { command, createServices, LiveTestPermissionError, validateWorkflow } from './acr-services';
import {
  assertScenarioOutcome,
  cleanupDispatched,
  CONTEXT_PATH,
  GATE_NAME,
  generateWorkflow,
  isTerminal,
  readConfig,
  redact,
  SCENARIOS,
  waitFor,
  waitForAcrRun,
  WORKFLOW_PATH,
  type Evidence,
  type Files,
} from './acr-workflow';

test(
  'generated GitHub Actions workflow builds via ACR Tasks REST',
  {
    skip:
      process.env.AZ_LIVE_TESTS !== '1'
        ? 'Run npm run test:e2e:azure -- --suite acr explicitly to authorize live sandbox mutations'
        : false,
    timeout: NORMAL_WORK_BUDGET_MS + INTERRUPTION_GRACE_MS,
  },
  async t => {
    const config = readConfig(process.env);
    const interruption = liveInterruption();
    // The test runner's deadline must leave recovery time after normal work stops.
    const signal = AbortSignal.any([
      interruption.signal,
      AbortSignal.timeout(NORMAL_WORK_BUDGET_MS),
    ]);
    const nonce = randomUUID().slice(0, 8);
    const outputRoot = path.resolve(__dirname, '../../out/acr-e2e', nonce);
    const normalCommand: typeof command = (...args) => {
      signal.throwIfAborted();
      return command(...args);
    };
    try {
      signal.throwIfAborted();
      try {
        await createServices(config, outputRoot, normalCommand).preflight();
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof LiveTestPermissionError)) throw error;
        t.skip(`ACR live tests require additional controller access: ${error.message}`);
        return;
      }
      const fixture = async (name: string) =>
        fs.readFile(path.join(__dirname, 'fixtures/acr', name), 'utf8');
      const prepared = await Promise.all(
        SCENARIOS.map(async scenario => {
          const imageName = `rest29-${nonce}-${scenario}`;
          const marker = imageName;
          const external = scenario === 'external';
          const dockerfilePath = external
            ? 'fixtures/acr-e2e/docker/Buildfile'
            : `${CONTEXT_PATH}/Dockerfile`;
          const ignore = await fixture('.dockerignore');
          const rootIgnore = external ? 'included.txt\n' : ignore;
          const files: Files = {
            ...getAcrBuildFiles(),
            [WORKFLOW_PATH]: generateWorkflow(config, imageName, marker, dockerfilePath),
            [dockerfilePath]: await fixture(`${external ? 'success' : scenario}.Dockerfile`),
            [`${CONTEXT_PATH}/.dockerignore`]: rootIgnore,
            [`${CONTEXT_PATH}/expected-root-ignore.txt`]: rootIgnore,
            ...(external ? { [`${dockerfilePath}.dockerignore`]: ignore } : {}),
            [`${CONTEXT_PATH}/included.txt`]: await fixture('included.txt'),
            [`${CONTEXT_PATH}/ignored.txt`]: 'must-not-be-uploaded',
            [`${CONTEXT_PATH}/ignored/drop.txt`]: 'must-not-be-uploaded',
            [`${CONTEXT_PATH}/ignored/keep.txt`]: marker,
            'fixtures/acr-e2e/outside-context.txt': 'must-not-be-in-nested-context',
          };
          await validateWorkflow(files, normalCommand);
          return { scenario, imageName, marker, files };
        })
      );
      const generatorRevision = (await normalCommand('git', ['rev-parse', 'HEAD'])).trim();
      const generatorDirty =
        (await normalCommand('git', ['status', '--porcelain'])).trim().length > 0;
      t.diagnostic(`Evidence directory: ${outputRoot}`);
      const publication = {
        generatorRevision,
        generatorDirty,
        repository: config.repository,
        branch: config.branch,
        artifacts: Object.keys(getAcrBuildFiles()),
      };
      await fs.mkdir(outputRoot, { recursive: true });
      try {
        const token = (await normalCommand('gh', ['auth', 'token'])).trim();
        assert.ok(token, 'GitHub authentication did not return a token for the publisher check');
        const octokit = createOctokitClient(token);
        octokit.hook.before('request', requestDeadline);
        const report = await verifyRuntimePublication(octokit, config, signal);
        signal.throwIfAborted();
        await fs.writeFile(
          path.join(outputRoot, 'publication.json'),
          JSON.stringify({ ...publication, ...report, status: 'passed' }, null, 2) + '\n'
        );
        t.diagnostic(
          `Production publisher verified (${report.created.length} created, ${report.updated.length} updated, unchanged rerun, and outdated repair)`
        );
      } catch (error) {
        try {
          await fs.writeFile(
            path.join(outputRoot, 'publication.json'),
            JSON.stringify(
              {
                ...publication,
                status: 'failed',
                error: redact(error instanceof Error ? error.message : String(error)),
              },
              null,
              2
            ) + '\n'
          );
        } catch (evidenceError) {
          throw new AggregateError(
            [error, evidenceError],
            'Publisher acceptance failed and evidence could not be saved'
          );
        }
        throw error;
      }
      let stop = false;
      for (const { scenario, imageName, marker, files } of prepared) {
        await t.test(
          scenario,
          {
            skip:
              stop || signal.aborted
                ? 'Interrupted or unresolved cleanup; inspect evidence'
                : false,
          },
          async () => {
            const evidenceDir = path.join(outputRoot, scenario);
            const client = createServices(config, evidenceDir, normalCommand);
            const evidence: Evidence = {
              scenario,
              imageName,
              generatorRevision,
              generatorDirty,
              cleanupErrors: [],
            };
            const errors: unknown[] = [];
            let dispatched = false;
            let before = new Set<string>();
            const deadline = Date.now() + 12 * 60_000;
            try {
              signal.throwIfAborted();
              evidence.fixtureSha = await client.publish(files);
              signal.throwIfAborted();
              const existing = await client.runs();
              signal.throwIfAborted();
              assert.ok(
                existing.every(run => isTerminal(run.status)),
                'Refusing to dispatch while another ACR run is active'
              );
              before = new Set(existing.map(run => run.id));
              signal.throwIfAborted();
              dispatched = true;
              await client.dispatch();
              evidence.githubRun = await waitFor(
                'dispatched workflow',
                () => client.findWorkflow(evidence.fixtureSha!),
                run => run !== undefined,
                deadline,
                5000,
                signal
              );
              assert.ok(evidence.githubRun);
              assert.equal(evidence.githubRun.sha, evidence.fixtureSha);
              evidence.acrRun = await waitForAcrRun(client, before, deadline, 5000, signal);
              assert.ok(evidence.acrRun);
              const acrId = evidence.acrRun.id;
              await client.save(evidence);
              if (scenario === 'cancel') {
                await waitFor(
                  'active ACR build',
                  () => client.run(acrId),
                  run => {
                    assert.ok(
                      !isTerminal(run.status),
                      `Build ended before cancellation: ${run.status}`
                    );
                    return run.status === 'Running';
                  },
                  deadline,
                  5000,
                  signal
                );
                await client.cancelWorkflow(evidence.githubRun.id, evidence.fixtureSha!);
              }
              evidence.acrRun = await waitFor(
                'terminal ACR state',
                () => client.run(acrId),
                run => isTerminal(run.status),
                deadline,
                5000,
                signal
              );
              evidence.githubRun = await waitFor(
                'completed workflow',
                () => client.workflow(evidence.githubRun!.id),
                run => run.status === 'completed',
                deadline,
                5000,
                signal
              );
              const gate = (await client.jobs(evidence.githubRun.id)).find(
                job => job.name === GATE_NAME
              );
              assertScenarioOutcome(scenario, evidence.acrRun, evidence.githubRun, gate);
              const logs = await client.logs(acrId);
              await client.save(evidence, logs);
              if (scenario === 'success' || scenario === 'external') {
                assert.ok(
                  evidence.acrRun.images.some(
                    image => image.repository === imageName && image.tag === evidence.fixtureSha
                  ),
                  'Missing expected fixture-SHA image'
                );
                assert.ok(
                  logs.includes(`ACR_E2E_SOURCE_OK:${marker}`),
                  'Missing proof that the fixture verified its context, ignore rules and build argument'
                );
                const output = evidence.acrRun.images.find(
                  image => image.repository === imageName && image.tag === evidence.fixtureSha
                );
                assert.ok(output?.digest, 'Missing immutable fixture image digest');
                await client.verifyImage(`${imageName}:${evidence.fixtureSha}`, output.digest);
              } else {
                assert.equal(
                  evidence.acrRun.images.length,
                  0,
                  'Failed/cancelled fixture produced an image'
                );
                if (scenario === 'failure') assert.match(logs, /deliberately-missing-e2e-file/);
              }
              signal.throwIfAborted();
              evidence.verdict = 'passed';
            } catch (error) {
              evidence.verdict = 'failed';
              evidence.error = redact(error instanceof Error ? error.message : String(error));
              errors.push(error);
            } finally {
              const recordInterruption = () => {
                if (!signal.aborted) return;
                stop = true;
                evidence.verdict = 'failed';
                evidence.error = String(signal.reason);
                if (!errors.includes(signal.reason)) errors.push(signal.reason);
              };
              recordInterruption();
              const recoveryDeadline = Date.now() + RECOVERY_BUDGET_MS;
              const recovery = createServices(config, evidenceDir, (...args) => {
                assert.ok(Date.now() < recoveryDeadline, 'Emergency recovery budget exhausted');
                return command(...args);
              });
              // Persist the verdict before cleanup; cleanup can never satisfy the cancellation oracle.
              for (const action of [
                () => client.save(evidence),
                async () => {
                  if (dispatched) await cleanupDispatched(recovery, evidence, before);
                },
                () => {
                  recordInterruption();
                  return client.save(evidence);
                },
              ]) {
                try {
                  await action();
                } catch (error) {
                  errors.push(error);
                  stop = true;
                }
              }
            }
            if (errors.length)
              throw new AggregateError(errors, `ACR ${scenario} E2E failed; inspect evidence`);
          }
        );
      }
      signal.throwIfAborted();
    } catch (error) {
      if (signal.aborted) {
        await fs.mkdir(outputRoot, { recursive: true });
        await fs.writeFile(
          path.join(outputRoot, 'interruption.json'),
          JSON.stringify({ status: 'failed', error: String(signal.reason) }, null, 2) + '\n'
        );
      }
      throw error;
    } finally {
      interruption.dispose();
    }
  }
);
