# Fast-Path Orchestration Cleanup

**Date:** 2026-04-02
**Scope:** `plugins/aks-desktop/src/components/GitHubPipeline/` and `plugins/aks-desktop/src/utils/github/github-api.ts`
**Branch:** `thgamble/fast-path-async`

## Problem

The recent async agent review feature (commits `4e5bbb128..fb92612bd`) introduced duplicated code and a ref-based state workaround. A `/simplify` review identified four issues worth resolving:

1. **Branch cleanup duplication** — Identical inline `DELETE /repos/.../git/refs/...` try/catch blocks in both `fastPathOrchestration.ts` and `pipelineOrchestration.ts`, despite `createBranch` already existing in `github-api.ts`.
2. **Agent config push duplication** — Both `createFastPathPR` and `createSetupPR` push the same two files (`copilot-setup-steps.yml` + `containerization.agent.md`) with near-identical code.
3. **Magic strings** — `'./Dockerfile'` and `'deploy/kubernetes/'` are repeated across production code without constants.
4. **`withAsyncAgentRef` outside state machine** — The async agent intent is stored in a mutable ref rather than the reducer state, creating an invisible coupling between `handleDeploy` and a downstream `useEffect`.

## Design

### 1. `deleteBranch` helper in `github-api.ts`

**What:** Add `deleteBranch(octokit, owner, repo, branchName)` next to the existing `createBranch` function.

**Where:** `plugins/aks-desktop/src/utils/github/github-api.ts`

**Behavior:** Wraps `DELETE /repos/{owner}/{repo}/git/refs/heads/{branchName}` with the same `apiError` pattern used by other functions in the file. Callers retain their own try/catch + `console.warn` wrappers since "best-effort, don't rethrow" is caller-specific policy.

**Callers to update:**
- `fastPathOrchestration.ts` lines 167-178
- `pipelineOrchestration.ts` lines 104-115

**Test impact:** Both orchestration test files mock `octokit.request` for the DELETE call. After this change, they mock `deleteBranch` instead. Add a unit test for `deleteBranch` in the github-api test file.

### 2. `pushAgentConfigFiles` helper

**What:** Extract a shared function that pushes both agent config files to a branch.

**Signature:**
```ts
export async function pushAgentConfigFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branchName: string,
  config: PipelineConfig
): Promise<void>
```

**Where:** `plugins/aks-desktop/src/components/GitHubPipeline/utils/agentTemplates.ts` — this file already owns `generateAgentConfig` and `SETUP_WORKFLOW_CONTENT`.

**Behavior:** Calls `generateAgentConfig(config)`, then pushes both files via `Promise.all`. Uses `createOrUpdateFile` from `github-api.ts`. Commit messages:
- `COPILOT_SETUP_STEPS_PATH`: `'Add Copilot setup workflow'`
- `AGENT_CONFIG_PATH`: `` `Add containerization agent config for ${config.appName}` ``

**Callers to update:**
- `fastPathOrchestration.ts` `createFastPathPR` (lines 106-128) — replace inline `Promise.all` block
- `pipelineOrchestration.ts` `createSetupPR` (lines 47-67) — replace sequential `createOrUpdateFile` calls

**Test impact:**
- `fastPathOrchestration.test.ts`: The "should push 5 files with agent config" test currently counts `mockCreateOrUpdateFile` calls (3 core + 2 agent). After extraction, mock `pushAgentConfigFiles` and verify it was called once when `withAsyncAgent` is true.
- `pipelineOrchestration.test.ts`: The `createSetupPR` test currently asserts on individual `mockCreateOrUpdateFile` calls for agent files. After extraction, mock `pushAgentConfigFiles` and verify the call.
- Add a dedicated unit test for `pushAgentConfigFiles` in `agentTemplates.test.ts`.

### 3. Magic string constants

**What:** Add two constants to `constants.ts`:
```ts
export const DEFAULT_DOCKERFILE_PATH = './Dockerfile';
export const MANIFESTS_DIR = 'deploy/kubernetes';
```

**Production code to update:**
- `useFastPathOrchestration.ts` line 251: `pipeline.state.dockerfilePaths[0] ?? DEFAULT_DOCKERFILE_PATH`
- `useFastPathOrchestration.ts` line 263: `` manifestsPath: `${MANIFESTS_DIR}/` ``
- `fastPathOrchestration.ts` line 90: `` `${MANIFESTS_DIR}/deployment.yaml` ``
- `fastPathOrchestration.ts` line 99: `` `${MANIFESTS_DIR}/service.yaml` ``

**Excluded from constant usage:** Test files (keep literal strings for explicit assertions), PR body strings (markdown readability), agent template markdown in `agentTemplates.ts` (generated documentation context).

**Test impact:** None — tests keep literal strings.

### 4. Move `withAsyncAgent` into reducer state

**What:** Replace the imperative `withAsyncAgentRef` with a field on `FastPathState`.

**State change in `useFastPathPipelineState.ts`:**
- Add `withAsyncAgent: boolean` to `FastPathState` interface (default: `false`)
- Extend the `SET_CONFIG` action type to accept an optional `withAsyncAgent` flag: `{ type: 'SET_CONFIG'; config: PipelineConfig; withAsyncAgent?: boolean }`
- In the reducer's `SET_CONFIG` case, set `withAsyncAgent: action.withAsyncAgent ?? false`
- Update `INITIAL_STATE` to include `withAsyncAgent: false`
- Update the `setConfig` action creator to accept the flag: `setConfig: (config: PipelineConfig, withAsyncAgent?: boolean) => void`

**Hook change in `useFastPathOrchestration.ts`:**
- Remove `withAsyncAgentRef` declaration
- Remove `withAsyncAgentRef.current = !!withAsyncAgent` from `handleDeploy`
- Update `pipeline.setConfig(config)` call to `pipeline.setConfig(config, withAsyncAgent)`
- In the async agent `useEffect`, replace `withAsyncAgentRef.current` guard with `pipeline.state.withAsyncAgent`

**Wizard change in `GitHubPipelineWizard.tsx`:** None — the wizard already passes `withAsyncAgent` through `HandleDeployOptions`; the change is internal to the hook.

**Test impact:**
- `useFastPathPipelineState.test.ts`: Add a test that `SET_CONFIG` with `withAsyncAgent: true` persists the flag in state.
- `useFastPathOrchestration.test.ts`: No change needed — tests call `handleDeploy` which internally calls `setConfig`.

## Ordering

These four changes are independent and could be done in parallel. However, for clean commits:

1. `deleteBranch` helper (no dependencies)
2. `pushAgentConfigFiles` helper (no dependencies)
3. Magic string constants (no dependencies)
4. `withAsyncAgent` into reducer (no dependencies)

## Out of scope

- `handleRedeploy` duplication between orchestration hooks (pre-existing, moderate effort, low value for 2 callers)
- Inline error coercion pattern (`err instanceof Error ? err.message : '...'`) — per-site fallback messages are arguably better than a generic utility
- Agent config push commit message customization — the slight message differences between callers don't justify parameterization
