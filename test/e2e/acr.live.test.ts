// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';
import { getAcrBuildFiles } from '../../plugins/aks-desktop/src/components/GitHubPipeline/utils/acrTasks/acrTaskRunner';
import { createOctokitClient } from '../../plugins/aks-desktop/src/utils/github/github-api';
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
    timeout: 60 * 60_000,
  },
  async t => {
    const config = readConfig(process.env);
    const nonce = randomUUID().slice(0, 8);
    const outputRoot = path.resolve(__dirname, '../../out/acr-e2e', nonce);
    try {
      await createServices(config, outputRoot).preflight();
    } catch (error) {
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
        const files: Files = {
          ...getAcrBuildFiles(),
          [WORKFLOW_PATH]: generateWorkflow(config, imageName, marker, dockerfilePath),
          [dockerfilePath]: await fixture(`${external ? 'success' : scenario}.Dockerfile`),
          [`${CONTEXT_PATH}/.dockerignore`]: external ? 'included.txt\n' : ignore,
          ...(external ? { [`${dockerfilePath}.dockerignore`]: ignore } : {}),
          [`${CONTEXT_PATH}/included.txt`]: await fixture('included.txt'),
          [`${CONTEXT_PATH}/ignored.txt`]: 'must-not-be-uploaded',
          [`${CONTEXT_PATH}/ignored/drop.txt`]: 'must-not-be-uploaded',
          [`${CONTEXT_PATH}/ignored/keep.txt`]: marker,
          'fixtures/acr-e2e/outside-context.txt': 'must-not-be-in-nested-context',
        };
        await validateWorkflow(files);
        return { scenario, imageName, marker, files };
      })
    );
    const generatorRevision = (await command('git', ['rev-parse', 'HEAD'])).trim();
    const generatorDirty = (await command('git', ['status', '--porcelain'])).trim().length > 0;
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
      const token = (await command('gh', ['auth', 'token'])).trim();
      assert.ok(token, 'GitHub authentication did not return a token for the publisher check');
      const octokit = createOctokitClient(token);
      octokit.hook.before('request', options => {
        options.request.timeout = 60_000;
      });
      await verifyRuntimePublication(octokit, config);
      await fs.writeFile(
        path.join(outputRoot, 'publication.json'),
        JSON.stringify({ ...publication, status: 'passed' }, null, 2) + '\n'
      );
      t.diagnostic('Production publisher accepted missing, unchanged and outdated runtime files');
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
          skip: stop ? 'Unresolved prior dispatch/cleanup; inspect the sandbox' : false,
        },
        async () => {
          const client = createServices(config, path.join(outputRoot, scenario));
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
            evidence.fixtureSha = await client.publish(files);
            const existing = await client.runs();
            assert.ok(
              existing.every(run => isTerminal(run.status)),
              'Refusing to dispatch while another ACR run is active'
            );
            before = new Set(existing.map(run => run.id));
            dispatched = true;
            await client.dispatch();
            evidence.githubRun = await waitFor(
              'dispatched workflow',
              () => client.findWorkflow(evidence.fixtureSha!),
              run => run !== undefined,
              deadline
            );
            assert.ok(evidence.githubRun);
            assert.equal(evidence.githubRun.sha, evidence.fixtureSha);
            evidence.acrRun = await waitForAcrRun(client, before, deadline);
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
                deadline
              );
              await client.cancelWorkflow(evidence.githubRun.id, evidence.fixtureSha!);
            }
            evidence.acrRun = await waitFor(
              'terminal ACR state',
              () => client.run(acrId),
              run => isTerminal(run.status),
              deadline
            );
            evidence.githubRun = await waitFor(
              'completed workflow',
              () => client.workflow(evidence.githubRun!.id),
              run => run.status === 'completed',
              deadline
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
            evidence.verdict = 'passed';
          } catch (error) {
            evidence.verdict = 'failed';
            evidence.error = redact(error instanceof Error ? error.message : String(error));
            errors.push(error);
          } finally {
            // Persist the verdict before cleanup; cleanup can never satisfy the cancellation oracle.
            for (const action of [
              () => client.save(evidence),
              async () => {
                if (dispatched) await cleanupDispatched(client, evidence, before);
              },
              () => client.save(evidence),
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
  }
);
