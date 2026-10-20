// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION, STORAGE_KEY_PREFIX } from '../constants';
import { setActivePipeline } from '../utils/pipelineStorage';
import { useGitHubPipelineOrchestration } from './useGitHubPipelineOrchestration';

const mocked = vi.hoisted(() => ({
  version: 1,
  active: true,
  access: 'checking',
  client: {} as unknown,
  installation: vi.fn(),
  readiness: vi.fn(),
  secrets: vi.fn(),
  setupPR: vi.fn(),
  agent: vi.fn(),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: { ResourceClasses: { Namespace: { useGet: () => [null] } } },
}));
vi.mock('../GitHubAuthContext', () => ({
  useGitHubAuthContext: () => ({
    octokit: mocked.active ? mocked.client : null,
    authState: {
      isAuthenticated: mocked.active,
      isRestoring: false,
      sessionVersion: mocked.version,
    },
  }),
}));
vi.mock('../../../utils/github/github-session', () => ({
  isGitHubSessionCurrent: (version: number) => mocked.active && version === mocked.version,
}));
vi.mock('./useGitHubRepoAccess', () => ({
  useGitHubRepoAccess: () => ({ status: mocked.access, error: null }),
}));
vi.mock('../../../utils/github/github-api', () => ({
  checkAppInstallation: mocked.installation,
  checkRepoReadiness: mocked.readiness,
  dispatchWorkflow: vi.fn(),
}));
vi.mock('../utils/pipelineOrchestration', () => ({
  createPipelineSecrets: mocked.secrets,
  createSetupPR: mocked.setupPR,
  triggerCopilotAgent: mocked.agent,
}));
vi.mock('./usePRPolling', () => ({ usePRPolling: () => ({ isMerged: false }) }));
vi.mock('./useAgentPRDiscovery', () => ({ useAgentPRDiscovery: () => ({}) }));
vi.mock('./useAgentWorkflowProgress', () => ({ useAgentWorkflowProgress: () => ({}) }));
vi.mock('./useWorkflowPolling', () => ({ useWorkflowPolling: () => ({ runConclusion: null }) }));
vi.mock('./useDeploymentHealth', () => ({
  useDeploymentHealth: () => ({ serviceEndpoint: null }),
}));
vi.mock('./useWorkloadIdentitySetup', () => ({
  useWorkloadIdentitySetup: () => ({ status: 'idle', result: null }),
}));
vi.mock('./usePipelineAnnotationSync', () => ({
  ANNOTATION_WORKLOAD_IDENTITY: 'fixture-workload-identity',
  usePipelineAnnotationSync: () => undefined,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
const props = {
  clusterName: 'cluster',
  namespace: 'namespace',
  subscriptionId: 'subscription',
  resourceGroup: 'resource-group',
  tenantId: 'tenant',
  initialRepo: { owner: 'owner', repo: 'repository', defaultBranch: 'main' },
};
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  Object.assign(mocked, { version: 1, active: true, access: 'checking', client: {} });
  mocked.installation.mockResolvedValue({ installed: true, installUrl: null });
  mocked.readiness.mockResolvedValue({
    hasSetupWorkflow: false,
    hasAgentConfig: false,
    hasDeployWorkflow: false,
    dockerfilePaths: null,
  });
  mocked.setupPR.mockResolvedValue({
    url: 'https://github.com/owner/repository/pull/1',
    number: 1,
    merged: false,
  });
});
afterEach(cleanup);

function renderAt(deploymentState: 'ReadyForSetup' | 'AgentTaskCreating') {
  const initial = renderHook(() => useGitHubPipelineOrchestration(props));
  const saved = initial.result.current.pipeline.state;
  initial.unmount();
  localStorage.setItem(
    `${STORAGE_KEY_PREFIX}owner/repository`,
    JSON.stringify({
      __schemaVersion: SCHEMA_VERSION,
      ...saved,
      deploymentState,
    })
  );
  mocked.access = 'granted';
  return renderHook(() => useGitHubPipelineOrchestration(props));
}

describe('full-pipeline authorization boundary', () => {
  it('does not check or create resources until repository access is granted', async () => {
    const { result } = renderHook(() => useGitHubPipelineOrchestration(props));
    await act(async () => {
      await result.current.checkRepoAndApp();
      await result.current.handleCreateSetupPR();
    });
    expect(mocked.installation).not.toHaveBeenCalled();
    expect(mocked.setupPR).not.toHaveBeenCalled();
  });

  it('does not overwrite advanced persisted progress with auth-needed on disconnected remount', async () => {
    const first = renderHook(() => useGitHubPipelineOrchestration(props));
    const saved = first.result.current.pipeline.state;
    first.unmount();
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}owner/repository`,
      JSON.stringify({
        __schemaVersion: SCHEMA_VERSION,
        ...saved,
        deploymentState: 'PipelineRunning',
      })
    );
    setActivePipeline(props.clusterName, props.namespace, props.initialRepo);
    const before = JSON.stringify(localStorage);
    mocked.active = false;
    mocked.version = 2;
    const next = renderHook(() => useGitHubPipelineOrchestration(props));
    expect(next.result.current.pipeline.state.deploymentState).toBe('PipelineRunning');
    expect(JSON.stringify(localStorage)).toBe(before);
  });

  it('does not let an old installation result continue or release the new session mutex', async () => {
    const a = deferred<{ installed: boolean; installUrl: null }>();
    const b = deferred<{ installed: boolean; installUrl: null }>();
    mocked.access = 'granted';
    mocked.installation.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result, rerender } = renderHook(() => useGitHubPipelineOrchestration(props));
    mocked.version = 2;
    mocked.client = {};
    rerender();
    let operationB!: Promise<void>;
    act(() => {
      operationB = result.current.checkRepoAndApp();
    });
    try {
      expect(mocked.installation).toHaveBeenCalledTimes(2);
      await act(async () => {
        a.resolve({ installed: true, installUrl: null });
      });
      expect(mocked.readiness).not.toHaveBeenCalled();
      await act(async () => {
        await result.current.checkRepoAndApp();
      });
      expect(mocked.installation).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => {
        a.resolve({ installed: true, installUrl: null });
        b.resolve({ installed: true, installUrl: null });
        await operationB;
      });
    }
    expect(mocked.readiness).toHaveBeenCalledTimes(1);
  });

  it('does not publish an old setup PR or let its finally unlock a newer setup request', async () => {
    const a = deferred<{ url: string; number: number; merged: boolean }>();
    const b = deferred<{ url: string; number: number; merged: boolean }>();
    mocked.setupPR.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result, rerender } = renderAt('ReadyForSetup');
    let operationA!: Promise<void>;
    let operationB!: Promise<void>;
    act(() => {
      operationA = result.current.handleCreateSetupPR();
    });
    mocked.version = 2;
    mocked.client = {};
    rerender();
    act(() => {
      operationB = result.current.handleCreateSetupPR();
    });
    const pr = (number: number) => ({
      url: `https://github.com/owner/repository/pull/${number}`,
      number,
      merged: false,
    });
    try {
      expect(mocked.setupPR).toHaveBeenCalledTimes(2);
      await act(async () => {
        a.resolve(pr(1));
        await operationA;
      });
      expect(result.current.pipeline.state.setupPr.number).toBeNull();
      await act(async () => {
        await result.current.handleCreateSetupPR();
      });
      expect(mocked.setupPR).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => {
        a.resolve(pr(1));
        b.resolve(pr(2));
        await operationA;
        await operationB;
      });
    }
    expect(result.current.pipeline.state.setupPr.number).toBe(2);
  });

  it('does not continue an old agent operation or clear the newer operation mutex', async () => {
    const a = deferred<void>();
    const b = deferred<void>();
    mocked.secrets.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    mocked.agent.mockResolvedValue({
      url: 'https://github.com/owner/repository/issues/9',
      number: 9,
    });
    const { result, rerender } = renderAt('AgentTaskCreating');
    mocked.version = 2;
    mocked.client = {};
    rerender();
    try {
      expect(mocked.secrets).toHaveBeenCalledTimes(2);
      await act(async () => {
        a.resolve(undefined);
      });
      expect(mocked.agent).not.toHaveBeenCalled();
      act(() => result.current.pipeline.updateConfig({ serviceType: 'LoadBalancer' }));
      expect(mocked.secrets).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => {
        a.resolve(undefined);
        b.resolve(undefined);
      });
    }
    await waitFor(() => expect(result.current.pipeline.state.triggerIssue.number).toBe(9));
    expect(mocked.agent).toHaveBeenCalledTimes(1);
  });
});
