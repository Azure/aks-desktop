// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGitHubAuthFixture } from '../__fixtures__/github-auth';
import {
  GitHubPipelineWizardPure,
  type GitHubPipelineWizardPureProps,
} from './GitHubPipelineWizardPure';
import { FastPathAwaitingMerge } from './GitHubPipelineWizardPure.stories';

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@iconify/react', () => ({ Icon: () => null }));
vi.mock('./AcrSelector', () => ({ AcrSelector: () => null }));
vi.mock('./AgentSetupReview', () => ({ AgentSetupReview: () => null }));
vi.mock('./DockerfileConfirmation', () => ({ DockerfileConfirmation: () => null }));
vi.mock('./PathSelectionStep', () => ({ PathSelectionStep: () => null }));
vi.mock('./ReviewAndMergeStep', () => ({ ReviewAndMergeStep: () => null }));
vi.mock('./WorkloadIdentitySetup', () => ({ WorkloadIdentitySetup: () => null }));
vi.mock('./RepoSelector', () => ({ RepoSelector: () => <div>Repository selector</div> }));
vi.mock('./WizardShell', () => ({
  AGENT_PATH_STEPS: [],
  FAST_PATH_STEPS: [],
  WizardShell: ({
    children,
    footerActions,
  }: {
    children: React.ReactNode;
    footerActions: React.ReactNode;
  }) => (
    <section>
      {children}
      {footerActions}
    </section>
  ),
}));
afterEach(cleanup);
const storyProps = () =>
  (FastPathAwaitingMerge as () => React.ReactElement<GitHubPipelineWizardPureProps>)().props;

describe('presentational authentication overlay', () => {
  it('offers access retry instead of logout for a transient repository check failure', () => {
    const props = storyProps();
    const auth = createGitHubAuthFixture({ isAuthenticated: true });
    const retry = vi.fn();
    props.orchestration.gitHubAuth = auth;
    props.orchestration.repoAccess = props.fastPath.repoAccess = {
      status: 'checking',
      error: 'Repository access could not be checked. Try again.',
      retry,
    };
    render(<GitHubPipelineWizardPure {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry repository access' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(auth.reset).not.toHaveBeenCalled();
  });

  it('asks to reconnect over advanced progress without resetting its PR/config or exposing unsafe actions', () => {
    const props = storyProps();
    props.orchestration.gitHubAuth = createGitHubAuthFixture();
    props.orchestration.repoAccess = { status: 'none', error: null, retry: vi.fn() };
    props.fastPath.repoAccess = { status: 'none', error: null, retry: vi.fn() };
    const before = JSON.stringify([
      props.orchestration.pipeline.state,
      props.fastPath.pipeline.state,
    ]);
    render(<GitHubPipelineWizardPure {...props} />);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Review PR on GitHub' })).not.toBeInTheDocument();
    expect(
      JSON.stringify([props.orchestration.pipeline.state, props.fastPath.pipeline.state])
    ).toBe(before);
  });

  it('offers reconnect with an authorized account on denial, not repository replacement or replay', () => {
    const props = storyProps();
    const auth = createGitHubAuthFixture({ isAuthenticated: true, username: 'account-b' });
    props.orchestration.gitHubAuth = auth;
    props.orchestration.repoAccess = props.fastPath.repoAccess = {
      status: 'denied',
      error: 'denied',
      retry: vi.fn(),
    };
    render(<GitHubPipelineWizardPure {...props} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Repository access could not be verified.');
    expect(screen.queryByText('Repository selector')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review PR on GitHub' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));
    expect(auth.reset).toHaveBeenCalledTimes(1);
  });
});
