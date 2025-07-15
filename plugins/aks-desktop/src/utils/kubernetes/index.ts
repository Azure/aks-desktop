// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

/**
 * Kubernetes utilities barrel export
 *
 * Provides consolidated exports for all Kubernetes-related utilities including
 * kubectl wrapper, Kubernetes API client, and generic CLI runner.
 */

// Generic CLI runner (selective exports to avoid conflicts)
export {
  runAzCli,
  runCommandWithOutput,
  getNamespaces,
  getDeployments,
  getPods,
  getLogs,
  scaleDeployment,
} from './cli-runner';
