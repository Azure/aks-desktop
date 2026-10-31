// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { ACR_BUILD_SCRIPT_PATH } from './acrTasks/acrTaskRunner';

/** Inputs shared by deterministic workflows and agent-authored ACR Tasks builds. */
interface AcrBuildStepConfig {
  /** Registry name without a login-server suffix; used for discovery when no ID is supplied. */
  acrName: string;
  /** Image repository to push, tagged with the workflow's `GITHUB_SHA`. */
  containerName: string;
  /** Full registry ARM ID; when omitted, discover by name in `AZURE_SUBSCRIPTION_ID`. */
  acrResourceId?: string;
  /** Dockerfile path relative to the checked-out repository, including paths outside the context. */
  dockerfilePath: string;
  /** Repository-relative context directory packaged for upload to ACR Tasks. */
  buildContextPath: string;
  /** Non-secret Docker build arguments serialized into the workflow; defaults to an empty map. */
  buildArguments?: Record<string, string>;
}

/**
 * Generates build/push and unfinished-run cancellation steps for the committed Python runtime.
 * Requires checkout and Azure login first; cancellation uses persisted runner state and does not
 * delete registries or images.
 *
 * @param config Registry, image and local build inputs embedded in the steps.
 * @returns Ordered GitHub Actions steps; cleanup runs whenever the build step did not succeed.
 */
export function generateAcrBuildSteps(config: AcrBuildStepConfig): Record<string, unknown>[] {
  const env = {
    AZURE_ACR_RESOURCE_ID: config.acrResourceId ?? '',
    AZURE_CONTAINER_REGISTRY: config.acrName,
    AZURE_SUBSCRIPTION_ID: '${{ secrets.AZURE_SUBSCRIPTION_ID }}',
    CONTAINER_NAME: config.containerName,
    DOCKER_FILE: config.dockerfilePath,
    BUILD_CONTEXT_PATH: config.buildContextPath,
    BUILD_ARGUMENTS: JSON.stringify(config.buildArguments ?? {}),
  };

  return [
    {
      name: 'Build and push image to ACR',
      id: 'acr_build',
      shell: 'bash',
      env,
      run: `exec python3 ${ACR_BUILD_SCRIPT_PATH}\n`,
    },
    {
      name: 'Cancel unfinished ACR build',
      if: "always() && steps.acr_build.outcome != 'success'",
      shell: 'bash',
      env: { ...env },
      run: `exec python3 ${ACR_BUILD_SCRIPT_PATH} --cancel\n`,
    },
  ];
}
