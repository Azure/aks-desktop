// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { PipelineDeploymentState } from '../types';

/**
 * Maps a PipelineDeploymentState to the 3-step wizard index:
 *   0 = Connect Source
 *   1 = Set up Copilot Agent
 *   2 = Review & Merge
 */
export function getWizardStep(state: PipelineDeploymentState): 0 | 1 | 2 {
  switch (state) {
    case 'GitHubAuthorizationNeeded':
    case 'Configured':
    case 'AppInstallationNeeded':
      return 0;
    case 'CheckingRepo':
    case 'WorkloadIdentitySetup':
    case 'ReadyForSetup':
      return 1;
    case 'SetupPRCreating':
    case 'SetupPRAwaitingMerge':
    case 'AgentTaskCreating':
    case 'AgentRunning':
    case 'GeneratedPRAwaitingMerge':
    case 'PipelineConfigured':
    case 'PipelineRunning':
    case 'Deployed':
      return 2;
    case 'Failed':
      return 0;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
