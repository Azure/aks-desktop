# Fast-Path Orchestration Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate duplicated code and magic strings from the fast-path async agent feature, and move `withAsyncAgent` intent into the reducer state machine.

**Architecture:** Four independent refactoring tasks: extract `deleteBranch` helper into `github-api.ts`, extract `pushAgentConfigFiles` helper into `agentTemplates.ts`, add path constants to `constants.ts`, and move `withAsyncAgent` from a mutable ref into `FastPathState`. Each task follows TDD — write/update the test first, then implement.

**Tech Stack:** TypeScript, React hooks, Vitest, GitHub Octokit REST API

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `plugins/aks-desktop/src/utils/github/github-api.ts` | Modify | Add `deleteBranch` helper |
| `plugins/aks-desktop/src/utils/github/github-api.test.ts` | Modify | Add `deleteBranch` tests |
| `plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.ts` | Modify | Add `pushAgentConfigFiles` helper |
| `plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.test.ts` | Modify | Add `pushAgentConfigFiles` tests |
| `plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.ts` | Modify | Use `deleteBranch`, `pushAgentConfigFiles`, `MANIFESTS_DIR` |
| `plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.test.ts` | Modify | Mock `deleteBranch`, `pushAgentConfigFiles` |
| `plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.ts` | Modify | Use `deleteBranch`, `pushAgentConfigFiles` |
| `plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.test.ts` | Modify | Mock `deleteBranch`, `pushAgentConfigFiles` |
| `plugins/aks-desktop/src/components/GitHubPipeline/constants.ts` | Modify | Add `DEFAULT_DOCKERFILE_PATH`, `MANIFESTS_DIR` |
| `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.ts` | Modify | Add `withAsyncAgent` to state + reducer |
| `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.test.ts` | Modify | Test `withAsyncAgent` in `setConfig` |
| `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathOrchestration.ts` | Modify | Use constants, remove `withAsyncAgentRef`, read from state |

---

### Task 1: Extract `deleteBranch` helper

**Files:**
- Modify: `plugins/aks-desktop/src/utils/github/github-api.ts` (after `createBranch` at line 270)
- Modify: `plugins/aks-desktop/src/utils/github/github-api.test.ts` (after `createBranch` describe at line 278)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.ts` (lines 5-11 imports, lines 165-177 catch block)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.test.ts` (lines 16-21 mock, lines 162-177 cleanup test)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.ts` (lines 4-12 imports, lines 103-115 catch block)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.test.ts` (lines 11-24 mocks, lines 131-149 cleanup test)

- [ ] **Step 1: Write the failing test for `deleteBranch`**

In `plugins/aks-desktop/src/utils/github/github-api.test.ts`, add `deleteBranch` to the import block (line 73-99) and add a new describe block after the `createBranch` describe (after line 278):

```ts
// Add to import block at line 73:
import {
  assignIssueToCopilot,
  // ... existing imports ...
  createBranch,
  createCopilotAssignedIssue,  // add this
  deleteBranch,                 // add this
  // ... rest of existing imports ...
} from './github-api';
```

```ts
// Add after the createBranch describe block (after line 278):
  describe('deleteBranch', () => {
    it('should delete a branch ref', async () => {
      mockOctokit.request.mockResolvedValue({});

      await deleteBranch(mockOctokit as unknown as Octokit, 'owner', 'repo', 'my-branch');

      expect(mockOctokit.request).toHaveBeenCalledWith(
        'DELETE /repos/{owner}/{repo}/git/refs/{ref}',
        { owner: 'owner', repo: 'repo', ref: 'heads/my-branch' }
      );
    });

    it('should throw on failure', async () => {
      mockOctokit.request.mockRejectedValue(new Error('Not Found'));

      await expect(
        deleteBranch(mockOctokit as unknown as Octokit, 'owner', 'repo', 'bad-branch')
      ).rejects.toThrow('Failed to delete branch');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/aks-desktop/src/utils/github/github-api.test.ts -t "deleteBranch"`
Expected: FAIL — `deleteBranch` is not exported

- [ ] **Step 3: Implement `deleteBranch`**

In `plugins/aks-desktop/src/utils/github/github-api.ts`, add after `createBranch` (after line 270):

```ts
/** Deletes a branch from the repository. */
export async function deleteBranch(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string
): Promise<void> {
  try {
    await octokit.request('DELETE /repos/{owner}/{repo}/git/refs/{ref}', {
      owner,
      repo,
      ref: `heads/${branchName}`,
    });
  } catch (error) {
    throw apiError(`Failed to delete branch ${branchName} in ${owner}/${repo}`, error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/aks-desktop/src/utils/github/github-api.test.ts -t "deleteBranch"`
Expected: PASS

- [ ] **Step 5: Update `fastPathOrchestration.ts` to use `deleteBranch`**

In imports (line 5-11), add `deleteBranch`:

```ts
import {
  createBranch,
  createCopilotAssignedIssue,
  createOrUpdateFile,
  createPullRequest,
  deleteBranch,
  getDefaultBranchSha,
} from '../../../utils/github/github-api';
```

Replace the catch block (lines 165-177):

```ts
  } catch (err) {
    try {
      await deleteBranch(octokit, owner, repo, branchName);
    } catch (cleanupErr) {
      console.warn(`Failed to clean up branch ${branchName}:`, cleanupErr);
    }
    throw err;
  }
```

- [ ] **Step 6: Update `fastPathOrchestration.test.ts` to mock `deleteBranch`**

Add `mockDeleteBranch` to the hoisted mocks (lines 8-14):

```ts
const { mockGetDefaultBranchSha, mockCreateBranch, mockCreateOrUpdateFile, mockCreatePullRequest, mockDeleteBranch } =
  vi.hoisted(() => ({
    mockGetDefaultBranchSha: vi.fn(),
    mockCreateBranch: vi.fn(),
    mockCreateOrUpdateFile: vi.fn(),
    mockCreatePullRequest: vi.fn(),
    mockDeleteBranch: vi.fn(),
  }));

vi.mock('../../../utils/github/github-api', () => ({
  getDefaultBranchSha: mockGetDefaultBranchSha,
  createBranch: mockCreateBranch,
  createOrUpdateFile: mockCreateOrUpdateFile,
  createPullRequest: mockCreatePullRequest,
  deleteBranch: mockDeleteBranch,
}));
```

Remove `const mockRequest = vi.fn();` (line 38) and update `mockOctokit` to remove the `request` field (line 39):

```ts
const mockOctokit = {} as unknown as Octokit;
```

Update the cleanup test (lines 162-177) to assert on `mockDeleteBranch` instead of `mockRequest`:

```ts
    it('should clean up branch on failure', async () => {
      mockCreateOrUpdateFile.mockRejectedValueOnce(new Error('push failed'));

      await expect(createFastPathPR(mockOctokit, baseFastPathConfig)).rejects.toThrow(
        'push failed'
      );

      expect(mockDeleteBranch).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        expect.stringContaining('aks-project/fast-path-my-app-')
      );
    });
```

- [ ] **Step 7: Update `pipelineOrchestration.ts` to use `deleteBranch`**

In imports (lines 4-12), replace with:

```ts
import {
  createBranch,
  createCopilotAssignedIssue,
  createOrUpdateFile,
  createPullRequest,
  deleteBranch,
  getDefaultBranchSha,
  setRepoSecrets,
} from '../../../utils/github/github-api';
```

Replace the catch block (lines 103-115):

```ts
  } catch (err) {
    try {
      await deleteBranch(octokit, owner, repo, branchName);
    } catch (cleanupErr) {
      console.warn(`Failed to clean up branch ${branchName}:`, cleanupErr);
    }
    throw err;
  }
```

- [ ] **Step 8: Update `pipelineOrchestration.test.ts` to mock `deleteBranch`**

Add `mockDeleteBranch` to hoisted mocks (lines 11-24):

```ts
const {
  mockGetDefaultBranchSha,
  mockCreateBranch,
  mockCreateOrUpdateFile,
  mockCreatePullRequest,
  mockCreateCopilotAssignedIssue,
  mockDeleteBranch,
  mockSetRepoSecrets,
} = vi.hoisted(() => ({
  mockGetDefaultBranchSha: vi.fn(),
  mockCreateBranch: vi.fn(),
  mockCreateOrUpdateFile: vi.fn(),
  mockCreatePullRequest: vi.fn(),
  mockCreateCopilotAssignedIssue: vi.fn(),
  mockDeleteBranch: vi.fn(),
  mockSetRepoSecrets: vi.fn(),
}));

vi.mock('../../../utils/github/github-api', () => ({
  getDefaultBranchSha: mockGetDefaultBranchSha,
  createBranch: mockCreateBranch,
  createOrUpdateFile: mockCreateOrUpdateFile,
  createPullRequest: mockCreatePullRequest,
  createCopilotAssignedIssue: mockCreateCopilotAssignedIssue,
  deleteBranch: mockDeleteBranch,
  setRepoSecrets: mockSetRepoSecrets,
}));
```

Update the cleanup test (lines 131-149). Remove the `mockRequest.mockResolvedValue(undefined)` line (136) and replace the assertion:

```ts
    it('should attempt branch cleanup when PR creation fails', async () => {
      mockGetDefaultBranchSha.mockResolvedValue('abc123');
      mockCreateBranch.mockResolvedValue(undefined);
      mockCreateOrUpdateFile.mockResolvedValue(undefined);
      mockCreatePullRequest.mockRejectedValue(new Error('PR creation failed'));
      mockDeleteBranch.mockResolvedValue(undefined);

      await expect(createSetupPR(mockOctokit, validConfig)).rejects.toThrow('PR creation failed');

      expect(mockDeleteBranch).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'aks-project/setup-my-app-1700000000000'
      );
    });
```

Also remove the `mockRequest` field from `mockOctokit` if it's no longer needed. Check if `mockRequest` (currently `const mockRequest = vi.fn()` / `const mockOctokit = { request: mockRequest } as unknown as Octokit`) is used anywhere else in the file. If not, simplify to `const mockOctokit = {} as unknown as Octokit`.

- [ ] **Step 9: Run all affected tests**

Run: `npx vitest run plugins/aks-desktop/src/utils/github/github-api.test.ts plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.test.ts plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.test.ts`
Expected: All PASS

- [ ] **Step 10: Type check**

Run: `npx tsc --noEmit --project plugins/aks-desktop/tsconfig.json`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add plugins/aks-desktop/src/utils/github/github-api.ts \
       plugins/aks-desktop/src/utils/github/github-api.test.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.test.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.test.ts
git commit -m "refactor: extract deleteBranch helper into github-api"
```

---

### Task 2: Extract `pushAgentConfigFiles` helper

**Files:**
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.ts` (add import + function at end)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.test.ts` (add test describe)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.ts` (lines 13-19 imports, lines 106-128 inline push)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.test.ts` (lines 16-21 mocks, lines 218-248 agent config tests)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.ts` (lines 14-26 imports, lines 47-67 inline push)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.test.ts` (lines 93-112 file push assertions)

- [ ] **Step 1: Write the failing test for `pushAgentConfigFiles`**

In `plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.test.ts`, add a mock for `createOrUpdateFile` and import the new function. Add at the top of the file, before existing imports:

```ts
const { mockCreateOrUpdateFile } = vi.hoisted(() => ({
  mockCreateOrUpdateFile: vi.fn(),
}));

vi.mock('../../../utils/github/github-api', () => ({
  createOrUpdateFile: mockCreateOrUpdateFile,
}));
```

Add `pushAgentConfigFiles` to the import from `./agentTemplates` (line 7-12):

```ts
import {
  generateAgentConfig,
  generateBranchName,
  pushAgentConfigFiles,
  SETUP_WORKFLOW_CONTENT,
  validatePipelineConfig,
} from './agentTemplates';
```

Add `Octokit` type import:

```ts
import type { Octokit } from '@octokit/rest';
```

Add a new describe block at the end of the outer `describe('agentTemplates', ...)`, before the closing `});`:

```ts
  describe('pushAgentConfigFiles', () => {
    const mockOctokit = {} as unknown as Octokit;

    beforeEach(() => {
      mockCreateOrUpdateFile.mockResolvedValue(undefined);
    });

    it('should push both agent config files to the branch', async () => {
      await pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'my-branch', validConfig);

      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(2);
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'owner',
        'repo',
        '.github/workflows/copilot-setup-steps.yml',
        SETUP_WORKFLOW_CONTENT,
        'Add Copilot setup workflow',
        'my-branch'
      );
      expect(mockCreateOrUpdateFile).toHaveBeenCalledWith(
        mockOctokit,
        'owner',
        'repo',
        '.github/agents/containerization.agent.md',
        expect.stringContaining('containerize-and-deploy'),
        expect.stringContaining(validConfig.appName),
        'my-branch'
      );
    });

    it('should propagate errors from createOrUpdateFile', async () => {
      mockCreateOrUpdateFile.mockRejectedValueOnce(new Error('push failed'));

      await expect(
        pushAgentConfigFiles(mockOctokit, 'owner', 'repo', 'my-branch', validConfig)
      ).rejects.toThrow('push failed');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.test.ts -t "pushAgentConfigFiles"`
Expected: FAIL — `pushAgentConfigFiles` is not exported

- [ ] **Step 3: Implement `pushAgentConfigFiles`**

In `plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.ts`:

Add new imports at the top (after line 3):

```ts
import type { Octokit } from '@octokit/rest';
import { createOrUpdateFile } from '../../../utils/github/github-api';
```

Extend the existing `../constants` import (lines 5-9) to include `AGENT_CONFIG_PATH` and `COPILOT_SETUP_STEPS_PATH`:

```ts
import {
  AGENT_CONFIG_PATH,
  CONTAINERIZATION_MCP_VERSION,
  COPILOT_SETUP_STEPS_PATH,
  DEFAULT_IMAGE_TAG,
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
```

Add the function at the end of the file (after `validatePipelineConfig`):

```ts
/**
 * Pushes both Copilot agent config files to a branch.
 * Used by both the agent-path setup PR and the fast-path PR (when async agent is enabled).
 */
export async function pushAgentConfigFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  config: PipelineConfig
): Promise<void> {
  const agentConfig = generateAgentConfig(config);
  await Promise.all([
    createOrUpdateFile(
      octokit,
      owner,
      repo,
      COPILOT_SETUP_STEPS_PATH,
      SETUP_WORKFLOW_CONTENT,
      'Add Copilot setup workflow',
      branchName
    ),
    createOrUpdateFile(
      octokit,
      owner,
      repo,
      AGENT_CONFIG_PATH,
      agentConfig,
      `Add containerization agent config for ${config.appName}`,
      branchName
    ),
  ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.test.ts -t "pushAgentConfigFiles"`
Expected: PASS

- [ ] **Step 5: Update `fastPathOrchestration.ts` to use `pushAgentConfigFiles`**

Remove `AGENT_CONFIG_PATH`, `COPILOT_SETUP_STEPS_PATH` from `../constants` import (lines 13-17):

```ts
import {
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
```

Replace the `./agentTemplates` import (line 19) to use `pushAgentConfigFiles` instead of `generateAgentConfig` and `SETUP_WORKFLOW_CONTENT`:

```ts
import { pushAgentConfigFiles } from './agentTemplates';
```

Replace the inline agent config push block (lines 106-128):

```ts
    if (withAsyncAgent) {
      await pushAgentConfigFiles(octokit, owner, repo, branchName, pipelineConfig);
    }
```

Update the PR body (lines 146-149) — the constants `COPILOT_SETUP_STEPS_PATH` and `AGENT_CONFIG_PATH` are no longer imported. Inline the strings or re-import just for the PR body. Simplest: re-import from constants since they're used in the PR description:

```ts
import {
  AGENT_CONFIG_PATH,
  COPILOT_SETUP_STEPS_PATH,
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
```

Actually, the import of `AGENT_CONFIG_PATH` and `COPILOT_SETUP_STEPS_PATH` is still needed for the PR body text at lines 146-149. Keep them in the constants import. Only remove `generateAgentConfig` and `SETUP_WORKFLOW_CONTENT` from the `./agentTemplates` import.

So the final imports should be:

```ts
import {
  AGENT_CONFIG_PATH,
  COPILOT_SETUP_STEPS_PATH,
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
import type { PipelineConfig, PRTracking } from '../types';
import { pushAgentConfigFiles } from './agentTemplates';
```

And `createOrUpdateFile` stays in the github-api import (still needed for the 3 core files).

- [ ] **Step 6: Update `fastPathOrchestration.test.ts` to mock `pushAgentConfigFiles`**

Add `mockPushAgentConfigFiles` to the hoisted mocks and mock `./agentTemplates`:

```ts
const { mockPushAgentConfigFiles } = vi.hoisted(() => ({
  mockPushAgentConfigFiles: vi.fn(),
}));

vi.mock('./agentTemplates', () => ({
  pushAgentConfigFiles: mockPushAgentConfigFiles,
}));
```

Add `mockPushAgentConfigFiles.mockResolvedValue(undefined)` to the `beforeEach` block.

Replace the two agent config tests (lines 218-248):

```ts
    it('should push 3 files without agent config when withAsyncAgent is false', async () => {
      await createFastPathPR(mockOctokit, baseFastPathConfig);
      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(3);
      expect(mockPushAgentConfigFiles).not.toHaveBeenCalled();
    });

    it('should call pushAgentConfigFiles when withAsyncAgent is true', async () => {
      await createFastPathPR(mockOctokit, {
        ...baseFastPathConfig,
        withAsyncAgent: true,
      });
      expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(3);
      expect(mockPushAgentConfigFiles).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        expect.stringContaining('aks-project/fast-path-my-app-'),
        baseFastPathConfig.pipelineConfig
      );
    });
```

- [ ] **Step 7: Update `pipelineOrchestration.ts` to use `pushAgentConfigFiles`**

Replace the `./agentTemplates` import (lines 20-26) — remove `generateAgentConfig` and `SETUP_WORKFLOW_CONTENT`, add `pushAgentConfigFiles`:

```ts
import {
  generateBranchName,
  getActiveEnvVars,
  pushAgentConfigFiles,
  validatePipelineConfig,
} from './agentTemplates';
```

Remove `AGENT_CONFIG_PATH` and `COPILOT_SETUP_STEPS_PATH` from the `../constants` import (lines 14-18) only if they're no longer used in the file. Check: they ARE still used in the PR body at lines 80-81. Keep them.

Replace the inline push block in `createSetupPR` (lines 47-67):

```ts
  try {
    await pushAgentConfigFiles(octokit, owner, repo, branchName, config);

    const pr = await createPullRequest(
```

- [ ] **Step 8: Update `pipelineOrchestration.test.ts` to mock `pushAgentConfigFiles`**

Add `mockPushAgentConfigFiles` to the hoisted mocks and add a mock for `./agentTemplates`:

```ts
const { mockPushAgentConfigFiles } = vi.hoisted(() => ({
  mockPushAgentConfigFiles: vi.fn(),
}));
```

Update the existing `vi.mock('./agentTemplates', ...)` block (lines 39-45) to also include the new mock:

```ts
vi.mock('./agentTemplates', async () => {
  const actual = await vi.importActual('./agentTemplates');
  return {
    ...actual,
    generateBranchName: vi.fn(() => 'aks-project/setup-my-app-1700000000000'),
    pushAgentConfigFiles: mockPushAgentConfigFiles,
  };
});
```

Add `mockPushAgentConfigFiles.mockResolvedValue(undefined)` to `beforeEach` (inside the outer describe, around line 61).

Update the `createSetupPR` test (lines 64-122). Remove the assertions on `mockCreateOrUpdateFile` for the two agent files (lines 93-112) and replace with:

```ts
      expect(mockPushAgentConfigFiles).toHaveBeenCalledWith(
        mockOctokit,
        'testuser',
        'my-repo',
        'aks-project/setup-my-app-1700000000000',
        validConfig
      );
```

Also remove `expect(mockCreateOrUpdateFile).toHaveBeenCalledTimes(2)` (line 94) since `createOrUpdateFile` is no longer called directly by `createSetupPR`. If `mockCreateOrUpdateFile` is no longer used by any test in this file, remove it from the hoisted mocks and module mock. Check: it's used in the cleanup test (line 134: `mockCreateOrUpdateFile.mockResolvedValue(undefined)`). That test still needs it because the test mocks the module — but wait, `createSetupPR` no longer calls `createOrUpdateFile` directly. The `mockCreateOrUpdateFile.mockResolvedValue(undefined)` in the cleanup test is no longer needed for `createSetupPR` but may be needed if `pushAgentConfigFiles` is mocked separately (which it is). Remove the `mockCreateOrUpdateFile` setup from the cleanup test and keep the mock in the module mock (it's still imported by the module even if not called directly by `createSetupPR`).

- [ ] **Step 9: Run all affected tests**

Run: `npx vitest run plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.test.ts plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.test.ts plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.test.ts`
Expected: All PASS

- [ ] **Step 10: Type check**

Run: `npx tsc --noEmit --project plugins/aks-desktop/tsconfig.json`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.test.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.test.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/pipelineOrchestration.test.ts
git commit -m "refactor: extract pushAgentConfigFiles into agentTemplates"
```

---

### Task 3: Add magic string constants

**Files:**
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/constants.ts` (add 2 constants)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.ts` (lines 88-101 manifest paths)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathOrchestration.ts` (lines 251, 263)

- [ ] **Step 1: Add constants to `constants.ts`**

In `plugins/aks-desktop/src/components/GitHubPipeline/constants.ts`, add after `PIPELINE_WORKFLOW_FILENAME` (line 5):

```ts
/** Default Dockerfile path used as fallback when no Dockerfile is detected. */
export const DEFAULT_DOCKERFILE_PATH = './Dockerfile';

/** Directory containing Kubernetes deployment manifests. */
export const MANIFESTS_DIR = 'deploy/kubernetes';
```

- [ ] **Step 2: Update `fastPathOrchestration.ts` to use `MANIFESTS_DIR`**

Add `MANIFESTS_DIR` to the constants import (lines 13-17):

```ts
import {
  AGENT_CONFIG_PATH,
  COPILOT_SETUP_STEPS_PATH,
  MANIFESTS_DIR,
  PIPELINE_WORKFLOW_FILENAME,
} from '../constants';
```

Replace the two manifest paths (lines 90, 99):

```ts
        `${MANIFESTS_DIR}/deployment.yaml`,
```

```ts
        `${MANIFESTS_DIR}/service.yaml`,
```

- [ ] **Step 3: Update `useFastPathOrchestration.ts` to use constants**

Add imports from constants (line 8 area):

```ts
import { DEFAULT_DOCKERFILE_PATH, MANIFESTS_DIR, PIPELINE_WORKFLOW_FILENAME } from '../constants';
```

(This replaces the existing `import { PIPELINE_WORKFLOW_FILENAME } from '../constants';`)

Replace line 251:

```ts
    const dockerfilePath = pipeline.state.dockerfilePaths[0] ?? DEFAULT_DOCKERFILE_PATH;
```

Replace line 263:

```ts
          manifestsPath: `${MANIFESTS_DIR}/`,
```

- [ ] **Step 4: Run affected tests**

Run: `npx vitest run plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.test.ts plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration-async.test.ts`
Expected: All PASS

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit --project plugins/aks-desktop/tsconfig.json`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add plugins/aks-desktop/src/components/GitHubPipeline/constants.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/utils/fastPathOrchestration.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathOrchestration.ts
git commit -m "refactor: replace magic path strings with constants"
```

---

### Task 4: Move `withAsyncAgent` into reducer state

**Files:**
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.ts` (state interface, action type, reducer, initial state, action creator, result interface)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.test.ts` (add test)
- Modify: `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathOrchestration.ts` (remove ref, use state)

- [ ] **Step 1: Write the failing test**

In `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.test.ts`, add a test inside the `describe('config management', ...)` block (after the "should set config" test, around line 227):

```ts
    it('should store withAsyncAgent flag when set via setConfig', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      act(() => result.current.setConfig(validConfig, true));
      expect(result.current.state.withAsyncAgent).toBe(true);
    });

    it('should default withAsyncAgent to false', () => {
      const { result } = renderHook(() => useFastPathPipelineState(repoKey));

      act(() => result.current.setConfig(validConfig));
      expect(result.current.state.withAsyncAgent).toBe(false);
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.test.ts -t "withAsyncAgent"`
Expected: FAIL — `withAsyncAgent` does not exist on `FastPathState`, `setConfig` does not accept second argument

- [ ] **Step 3: Update `FastPathState` interface**

In `plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.ts`, add `withAsyncAgent` to the state interface (line 27-38):

```ts
export interface FastPathState {
  deploymentState: FastPathDeploymentState;
  config: PipelineConfig | null;
  dockerfilePaths: string[];
  fastPathPr: PRTracking;
  asyncAgentIssueUrl: string | null;
  /** Whether the user opted for async agent review on this deploy. */
  withAsyncAgent: boolean;
  serviceEndpoint: string | null;
  lastSuccessfulState: FastPathDeploymentState | null;
  error: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}
```

- [ ] **Step 4: Update the action type**

Update the `SET_CONFIG` action variant (line 41):

```ts
  | { type: 'SET_CONFIG'; config: PipelineConfig; withAsyncAgent?: boolean }
```

- [ ] **Step 5: Update `INITIAL_STATE`**

Add `withAsyncAgent: false` to `INITIAL_STATE` (lines 78-89):

```ts
const INITIAL_STATE: FastPathState = {
  deploymentState: 'Configured',
  config: null,
  dockerfilePaths: [],
  fastPathPr: { url: null, number: null, merged: false },
  asyncAgentIssueUrl: null,
  withAsyncAgent: false,
  serviceEndpoint: null,
  lastSuccessfulState: null,
  error: null,
  createdAt: null,
  updatedAt: null,
};
```

- [ ] **Step 6: Update the reducer `SET_CONFIG` case**

In the reducer (lines 187-195):

```ts
      case 'SET_CONFIG':
        next = {
          ...state,
          deploymentState: 'Configured',
          config: action.config,
          withAsyncAgent: action.withAsyncAgent ?? false,
          createdAt: state.createdAt ?? now(),
          updatedAt: now(),
        };
        break;
```

- [ ] **Step 7: Update the `UseFastPathPipelineStateResult` interface and action creator**

Update `setConfig` signature in the result interface (line 293):

```ts
  setConfig: (config: PipelineConfig, withAsyncAgent?: boolean) => void;
```

Update the `setConfig` action creator in the `useMemo` block (line 361):

```ts
      setConfig: (config: PipelineConfig, withAsyncAgent?: boolean) =>
        dispatch({ type: 'SET_CONFIG', config, withAsyncAgent }),
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.test.ts -t "withAsyncAgent"`
Expected: PASS

- [ ] **Step 9: Update `useFastPathOrchestration.ts` to use state instead of ref**

Remove the `withAsyncAgentRef` declaration (line 81):

```ts
  // DELETE: const withAsyncAgentRef = useRef(false);
```

Remove the `withAsyncAgentRef.current = !!withAsyncAgent` assignment in `handleDeploy` (line 125):

```ts
  // DELETE: withAsyncAgentRef.current = !!withAsyncAgent;
```

Update `pipeline.setConfig(config)` call (line 140) to pass `withAsyncAgent`:

```ts
      pipeline.setConfig(config, withAsyncAgent);
```

Update the async agent `useEffect` guard (line 245) to read from state:

```ts
    if (!pipeline.state.withAsyncAgent) return;
```

Add `pipeline.state.withAsyncAgent` to the effect's dependency array (lines 273-280):

```ts
  }, [
    pipeline.state.deploymentState,
    pipeline.state.withAsyncAgent,
    pipeline.state.config,
    pipeline.state.dockerfilePaths,
    gitHubAuth.octokit,
    selectedRepo,
    pipeline.setAsyncAgentTriggered,
  ]);
```

- [ ] **Step 10: Run all affected tests**

Run: `npx vitest run plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.test.ts plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathOrchestration.test.ts`
Expected: All PASS (the orchestration hook test uses jsdom and may fail in npx vitest — if so, run via the project's test script or verify with `tsc` only)

- [ ] **Step 11: Type check**

Run: `npx tsc --noEmit --project plugins/aks-desktop/tsconfig.json`
Expected: No errors

- [ ] **Step 12: Commit**

```bash
git add plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathPipelineState.test.ts \
       plugins/aks-desktop/src/components/GitHubPipeline/hooks/useFastPathOrchestration.ts
git commit -m "refactor: move withAsyncAgent from ref into reducer state"
```
