// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { describe, expect, it } from 'vitest';
import { getWizardStep } from './getWizardStep';

describe('getWizardStep', () => {
  // Step 0: Connect Source
  it('returns 0 for GitHubAuthorizationNeeded', () => {
    expect(getWizardStep('GitHubAuthorizationNeeded')).toBe(0);
  });

  it('returns 0 for Configured', () => {
    expect(getWizardStep('Configured')).toBe(0);
  });

  it('returns 0 for AppInstallationNeeded', () => {
    expect(getWizardStep('AppInstallationNeeded')).toBe(0);
  });

  // Step 1: Set up Copilot Agent
  it('returns 1 for CheckingRepo', () => {
    expect(getWizardStep('CheckingRepo')).toBe(1);
  });

  it('returns 1 for WorkloadIdentitySetup', () => {
    expect(getWizardStep('WorkloadIdentitySetup')).toBe(1);
  });

  it('returns 1 for ReadyForSetup', () => {
    expect(getWizardStep('ReadyForSetup')).toBe(1);
  });

  // Step 2: Review & Merge
  it('returns 2 for SetupPRCreating', () => {
    expect(getWizardStep('SetupPRCreating')).toBe(2);
  });

  it('returns 2 for SetupPRAwaitingMerge', () => {
    expect(getWizardStep('SetupPRAwaitingMerge')).toBe(2);
  });

  it('returns 2 for AgentTaskCreating', () => {
    expect(getWizardStep('AgentTaskCreating')).toBe(2);
  });

  it('returns 2 for AgentRunning', () => {
    expect(getWizardStep('AgentRunning')).toBe(2);
  });

  it('returns 2 for GeneratedPRAwaitingMerge', () => {
    expect(getWizardStep('GeneratedPRAwaitingMerge')).toBe(2);
  });

  it('returns 2 for PipelineConfigured', () => {
    expect(getWizardStep('PipelineConfigured')).toBe(2);
  });

  it('returns 2 for PipelineRunning', () => {
    expect(getWizardStep('PipelineRunning')).toBe(2);
  });

  it('returns 2 for Deployed', () => {
    expect(getWizardStep('Deployed')).toBe(2);
  });

  // Failed state
  it('returns 0 for Failed', () => {
    expect(getWizardStep('Failed')).toBe(0);
  });
});
