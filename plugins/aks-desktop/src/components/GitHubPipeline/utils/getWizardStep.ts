// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import type { PipelineDeploymentState } from '../types';

/**
 * Maps a PipelineDeploymentState to the 5-step wizard index:
 *   0 = Connect Source
 *   1 = Configure
 *   2 = Setup PR
 *   3 = Agent
 *   4 = Complete
 */
export function getWizardStep(state: PipelineDeploymentState): 0 | 1 | 2 | 3 | 4 {
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
      return 2;
    case 'AgentTaskCreating':
    case 'AgentRunning':
    case 'GeneratedPRAwaitingMerge':
      return 3;
    case 'PipelineConfigured':
    case 'PipelineRunning':
    case 'Deployed':
      return 4;
    case 'Failed':
      return 0;
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}
