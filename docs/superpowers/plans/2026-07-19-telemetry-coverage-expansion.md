# Telemetry Coverage Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add privacy-safe lifecycle telemetry for Azure login/logout, AKS cluster registration, namespace creation, and project deletion.

**Architecture:** Keep `plugins/aks-desktop/src/telemetry/index.ts` as the only transport chokepoint. Add a focused typed helper for direct `aksd.*` feature events and a shared hook for one-time `opened` signals, then instrument explicit workflow boundaries without adding properties or identifiers. Each workflow emits categorical feature and error events while preserving its existing behavior when telemetry is disabled or fails.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Application Insights through the existing telemetry module.

---

Implementation checkpoints should remain uncommitted unless the user explicitly asks for commits.

## File Map

- Modify `plugins/aks-desktop/src/telemetry/schema.ts` to define the new closed feature names and error areas.
- Create `plugins/aks-desktop/src/telemetry/aksFeature.ts` for the typed direct-feature helper.
- Create `plugins/aks-desktop/src/hooks/useTelemetryFeatureOpened.ts` for dedicated-surface `opened` events.
- Modify the four workflow areas under `src/components/AzureAuth/`, `src/components/AKS/`, `src/components/CreateNamespace/`, and `src/components/DeleteAKSProject/`.
- Add or extend co-located tests for every new helper and workflow boundary.

### Task 1: Extend Closed Telemetry Vocabularies

**Files:**
- Modify: `plugins/aks-desktop/src/telemetry/schema.ts`
- Modify: `plugins/aks-desktop/src/telemetry/vocabulary.test.ts`

- [ ] **Step 1: Write failing vocabulary tests**

Update the existing exhaustive `KNOWN_FEATURE_TYPES` assertion to include the five new members after `aksd.deploy`:

```ts
expect([...KNOWN_FEATURE_TYPES]).toEqual([
  'headlamp.delete-resource',
  'headlamp.delete-resources',
  'headlamp.create-resource',
  'headlamp.edit-resource',
  'headlamp.scale-resource',
  'headlamp.restart-resource',
  'headlamp.restart-resources',
  'headlamp.rollback-resource',
  'headlamp.logs',
  'headlamp.terminal',
  'headlamp.pod-attach',
  'headlamp.plugin-loading-error',
  'headlamp.details-view',
  'headlamp.list-view',
  'headlamp.object-events',
  'aksd.project-create',
  'aksd.project-import',
  'aksd.deploy',
  'aksd.auth-login',
  'aksd.auth-logout',
  'aksd.cluster-add',
  'aksd.namespace-create',
  'aksd.project-delete',
]);
```

Update the existing exhaustive `ERROR_AREAS` assertion:

```ts
expect([...ERROR_AREAS]).toEqual([
  'project-create',
  'project-import',
  'deploy',
  'kubernetes',
  'plugin-ui',
  'auth-login',
  'auth-logout',
  'cluster-add',
  'namespace-create',
  'project-delete',
]);
```

Also add an assertion that the exported direct AKS feature tuple is the exact approved list:

```ts
import { AKS_FEATURE_TYPES, ERROR_AREAS, KNOWN_FEATURE_TYPES } from './schema';

const expectedAksFeatures = [
  'aksd.project-create',
  'aksd.project-import',
  'aksd.deploy',
  'aksd.auth-login',
  'aksd.auth-logout',
  'aksd.cluster-add',
  'aksd.namespace-create',
  'aksd.project-delete',
] as const;

test('enumerates every direct AKS feature type', () => {
  expect(AKS_FEATURE_TYPES).toEqual(expectedAksFeatures);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run from `plugins/aks-desktop`:

```bash
npm run test:unit -- src/telemetry/vocabulary.test.ts
```

Expected: FAIL because `AKS_FEATURE_TYPES` does not exist and the new values are absent.

- [ ] **Step 3: Add typed feature and error-area constants**

Replace the direct `aksd.*` literals in `KNOWN_FEATURE_TYPES` with:

```ts
export const AKS_FEATURE_TYPES = [
  'aksd.project-create',
  'aksd.project-import',
  'aksd.deploy',
  'aksd.auth-login',
  'aksd.auth-logout',
  'aksd.cluster-add',
  'aksd.namespace-create',
  'aksd.project-delete',
] as const;

export type AksFeatureType = (typeof AKS_FEATURE_TYPES)[number];

export const KNOWN_FEATURE_TYPES: ReadonlySet<string> = new Set([
  'headlamp.delete-resource',
  'headlamp.delete-resources',
  'headlamp.create-resource',
  'headlamp.edit-resource',
  'headlamp.scale-resource',
  'headlamp.restart-resource',
  'headlamp.restart-resources',
  'headlamp.rollback-resource',
  'headlamp.logs',
  'headlamp.terminal',
  'headlamp.pod-attach',
  'headlamp.plugin-loading-error',
  'headlamp.details-view',
  'headlamp.list-view',
  'headlamp.object-events',
  ...AKS_FEATURE_TYPES,
]);
```

Extend `ERROR_AREA_VALUES`:

```ts
const ERROR_AREA_VALUES = [
  'project-create',
  'project-import',
  'deploy',
  'kubernetes',
  'plugin-ui',
  'auth-login',
  'auth-logout',
  'cluster-add',
  'namespace-create',
  'project-delete',
] as const;
```

- [ ] **Step 4: Run the tests and verify GREEN**

```bash
npm run test:unit -- src/telemetry/vocabulary.test.ts
```

Expected: PASS.

### Task 2: Add Typed Direct-Feature Helpers

**Files:**
- Create: `plugins/aks-desktop/src/telemetry/aksFeature.ts`
- Create: `plugins/aks-desktop/src/telemetry/aksFeature.test.ts`
- Create: `plugins/aks-desktop/src/hooks/useTelemetryFeatureOpened.ts`
- Create: `plugins/aks-desktop/src/hooks/useTelemetryFeatureOpened.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `src/telemetry/aksFeature.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockTrackFeature = vi.hoisted(() => vi.fn());

vi.mock('./index', () => ({ trackFeature: mockTrackFeature }));

import { trackAksFeature } from './aksFeature';

describe('trackAksFeature', () => {
  beforeEach(() => vi.clearAllMocks());

  test('forwards an allowlisted AKS lifecycle event', () => {
    trackAksFeature('aksd.namespace-create', 'started');
    expect(mockTrackFeature).toHaveBeenCalledWith({
      feature: 'aksd.namespace-create',
      status: 'started',
    });
  });

  test('does not propagate a telemetry failure', () => {
    mockTrackFeature.mockImplementationOnce(() => {
      throw new Error('transport failure');
    });
    expect(() => trackAksFeature('aksd.project-delete', 'failed')).not.toThrow();
  });
});
```

This test intentionally verifies the wrapper's synchronous no-throw contract by making the mocked `trackFeature` throw. Real SDK transport failure remains covered by `src/telemetry/index.test.ts`.

Create `src/hooks/useTelemetryFeatureOpened.test.ts`:

```ts
// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockTrackAksFeature = vi.hoisted(() => vi.fn());

vi.mock('../telemetry/aksFeature', () => ({ trackAksFeature: mockTrackAksFeature }));

import { useTelemetryFeatureOpened } from './useTelemetryFeatureOpened';

describe('useTelemetryFeatureOpened', () => {
  beforeEach(() => vi.clearAllMocks());

  test('emits one opened event for the mounted surface', () => {
    const { rerender } = renderHook(() => useTelemetryFeatureOpened('aksd.cluster-add'));
    rerender();
    expect(mockTrackAksFeature).toHaveBeenCalledTimes(1);
    expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.cluster-add', 'opened');
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
npm run test:unit -- src/telemetry/aksFeature.test.ts src/hooks/useTelemetryFeatureOpened.test.ts
```

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement the minimal typed helper**

Create `src/telemetry/aksFeature.ts`:

```ts
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { trackFeature } from './index';
import type { AksFeatureType, TelemetryStatus } from './schema';

export type AksFeatureLifecycleStatus = Extract<
  TelemetryStatus,
  'opened' | 'started' | 'succeeded' | 'failed' | 'cancelled'
>;

export function trackAksFeature(
  feature: AksFeatureType,
  status: AksFeatureLifecycleStatus
): void {
  try {
    trackFeature({ feature, status });
  } catch {
    // Telemetry must never affect the workflow being measured.
  }
}
```

Create `src/hooks/useTelemetryFeatureOpened.ts`:

```ts
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.

import { useEffect } from 'react';
import { trackAksFeature } from '../telemetry/aksFeature';
import type { AksFeatureType } from '../telemetry/schema';

export function useTelemetryFeatureOpened(feature: AksFeatureType): void {
  useEffect(() => {
    trackAksFeature(feature, 'opened');
  }, [feature]);
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

```bash
npm run test:unit -- src/telemetry/aksFeature.test.ts src/hooks/useTelemetryFeatureOpened.test.ts
```

Expected: PASS.

### Task 3: Instrument Azure Login and Logout

**Files:**
- Create: `plugins/aks-desktop/src/components/AzureAuth/AzureLoginPage.test.tsx`
- Modify: `plugins/aks-desktop/src/components/AzureAuth/AzureLoginPage.tsx`
- Modify: `plugins/aks-desktop/src/components/AzureAuth/hooks/useAzureProfilePage.test.ts`
- Modify: `plugins/aks-desktop/src/components/AzureAuth/hooks/useAzureProfilePage.ts`

- [ ] **Step 1: Add failing login lifecycle tests**

Create a jsdom test that mocks `initiateLogin`, `getLoginStatus`, `trackAksFeature`, `trackError`, and `useTelemetryFeatureOpened`. Cover these exact assertions:

```ts
expect(mockUseTelemetryFeatureOpened).toHaveBeenCalledWith('aksd.auth-login');
expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'started');
expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'succeeded');
expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'failed');
expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.auth-login', 'cancelled');
```

For an unsuccessful initiation, assert only categorical error data:

```ts
expect(mockTrackError).toHaveBeenCalledWith({
  area: 'auth-login',
  errorClass: 'UnknownError',
  phase: 'failed',
});
```

Use fake timers for polling success and timeout; timeout must use `TimeoutError`. In the success test, advance through both `LOGIN_POLL_INTERVAL_MS` and `LOGIN_REDIRECT_DELAY_MS`, then assert the success event was emitted before navigation. The existing transient polling catch continues polling and does not emit a terminal result.

- [ ] **Step 2: Extend failing logout tests**

Add telemetry mocks to `useAzureProfilePage.test.ts`:

```ts
const mockTrackAksFeature = vi.hoisted(() => vi.fn());
const mockTrackError = vi.hoisted(() => vi.fn());

vi.mock('../../../telemetry/aksFeature', () => ({ trackAksFeature: mockTrackAksFeature }));
vi.mock('../../../telemetry', () => ({ trackError: mockTrackError }));
```

Extend the success, stderr-error, and thrown-error tests to assert `started`, `succeeded`, or `failed`, plus:

```ts
expect(mockTrackError).toHaveBeenCalledWith({
  area: 'auth-logout',
  errorClass: 'UnknownError',
  phase: 'failed',
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:unit -- src/components/AzureAuth/AzureLoginPage.test.tsx src/components/AzureAuth/hooks/useAzureProfilePage.test.ts
```

Expected: FAIL because the workflow code does not emit telemetry.

- [ ] **Step 4: Instrument login control-flow boundaries**

Import the opened hook, typed helper, and `trackError`. Call `useTelemetryFeatureOpened('aksd.auth-login')`. Emit `started` at the start of `handleLogin`; `succeeded` when polling confirms login; `failed` for unsuccessful initiation, thrown initiation errors, and timeout; and `cancelled` in `handleCancel` only while `loading` is true. Do not emit a terminal event from the existing transient polling catch because the interval continues.

Use `UnknownError` for initiation failures because the current structured result does not distinguish CLI, network, and authentication causes. Use `TimeoutError` for the existing timeout branch. Never parse or pass `result.message` or an exception into telemetry.

- [ ] **Step 5: Instrument logout control-flow boundaries**

Emit `started` before `runCommandAsync`, `succeeded` after the command passes `isAzError`, and `failed` plus an `UnknownError` `auth-logout` event in both failure branches. Do not add `opened` or `cancelled` for logout.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npm run test:unit -- src/components/AzureAuth/AzureLoginPage.test.tsx src/components/AzureAuth/hooks/useAzureProfilePage.test.ts
```

Expected: PASS.

### Task 4: Instrument AKS Cluster Registration

**Files:**
- Create: `plugins/aks-desktop/src/components/AKS/RegisterAKSClusterPage.test.tsx`
- Create: `plugins/aks-desktop/src/components/AKS/RegisterAKSClusterDialog.test.tsx`
- Modify: `plugins/aks-desktop/src/components/AKS/RegisterAKSClusterPage.tsx`
- Modify: `plugins/aks-desktop/src/components/AKS/RegisterAKSClusterDialog.tsx`

- [ ] **Step 1: Write failing page-level opened/cancelled tests**

Mock `RegisterAKSClusterDialog` so the test can invoke `onClose` and `onClusterRegistered`. Assert the page calls:

```ts
expect(mockUseTelemetryFeatureOpened).toHaveBeenCalledWith('aksd.cluster-add');
```

Closing before registration emits `cancelled`. Calling `onClusterRegistered()` before `onClose()` suppresses `cancelled`.

- [ ] **Step 2: Write failing registration outcome tests**

Mock `RegisterAKSClusterDialogPure` with controls that invoke `onSubscriptionChange`, `onClusterChange`, and `onRegister`. Mock `registerAKSCluster` and data-loading utilities. Assert successful registration emits `started` then `succeeded`. Unsuccessful and thrown results emit `failed` plus:

```ts
expect(mockTrackError).toHaveBeenCalledWith({
  area: 'cluster-add',
  errorClass: 'UnknownError',
  phase: 'failed',
});
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:unit -- src/components/AKS/RegisterAKSClusterPage.test.tsx src/components/AKS/RegisterAKSClusterDialog.test.tsx
```

Expected: FAIL because cluster-registration telemetry is absent.

- [ ] **Step 4: Add opened/cancelled state to the page**

Add `const registrationCompletedRef = useRef(false)` and call `useTelemetryFeatureOpened('aksd.cluster-add')`. Set the ref in `handleClusterRegistered`. In `handleClose`, emit `cancelled` only when the ref is false, then preserve delayed navigation.

- [ ] **Step 5: Add registration outcomes to the dialog**

Emit `started` only after subscription and cluster validation. Emit `failed` plus the categorical error event for both failure branches. Emit `succeeded` after registration succeeds and before the non-critical capability query. Capability-query failure must not become registration failure telemetry.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npm run test:unit -- src/components/AKS/RegisterAKSClusterPage.test.tsx src/components/AKS/RegisterAKSClusterDialog.test.tsx
```

Expected: PASS.

### Task 5: Instrument Namespace Creation

**Files:**
- Create: `plugins/aks-desktop/src/components/CreateNamespace/CreateNamespace.test.tsx`
- Modify: `plugins/aks-desktop/src/components/CreateNamespace/CreateNamespace.tsx`

- [ ] **Step 1: Write failing lifecycle tests**

Mock cluster configuration, `createNamespaceAsProject`, routing, the telemetry helper, `trackError`, and the opened hook. Assert:

```ts
expect(mockUseTelemetryFeatureOpened).toHaveBeenCalledWith('aksd.namespace-create');
expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'started');
expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'succeeded');
expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'failed');
expect(mockTrackAksFeature).toHaveBeenCalledWith('aksd.namespace-create', 'cancelled');
```

The failure test must assert:

```ts
expect(mockTrackError).toHaveBeenCalledWith({
  area: 'namespace-create',
  errorClass: 'UnknownError',
  phase: 'failed',
});
```

- [ ] **Step 2: Run the test and verify RED**

```bash
npm run test:unit -- src/components/CreateNamespace/CreateNamespace.test.tsx
```

Expected: FAIL because namespace telemetry is absent.

- [ ] **Step 3: Implement namespace lifecycle tracking**

Call `useTelemetryFeatureOpened('aksd.namespace-create')`. Add `const terminalTrackedRef = useRef(false)`. Emit `started` when submission begins; `succeeded` after namespace creation and local settings updates complete; `failed` plus the categorical error event in the catch branch; and `cancelled` from the explicit cancel/back-to-home handler only when no terminal result was tracked. Do not instrument Back between wizard steps.

- [ ] **Step 4: Run the test and verify GREEN**

```bash
npm run test:unit -- src/components/CreateNamespace/CreateNamespace.test.tsx
```

Expected: PASS.

### Task 6: Instrument Project Deletion

**Files:**
- Create: `plugins/aks-desktop/src/components/DeleteAKSProject/AKSProjectDeleteButton.test.tsx`
- Modify: `plugins/aks-desktop/src/components/DeleteAKSProject/AKSProjectDeleteButton.tsx`
- Modify: `plugins/aks-desktop/src/components/DeleteAKSProject/hooks/useProjectDeletion.test.ts`
- Modify: `plugins/aks-desktop/src/components/DeleteAKSProject/hooks/useProjectDeletion.ts`

- [ ] **Step 1: Write failing dialog opened/cancelled tests**

Mock permission and deletion hooks. Assert clicking the delete icon emits `opened`, closing without confirming emits `cancelled`, and confirming does not emit `cancelled` through its close callback.

- [ ] **Step 2: Extend failing deletion outcome tests**

Mock `trackAksFeature` and `trackError` in `useProjectDeletion.test.ts`. Successful execution must emit `started` and `succeeded`. A rejected action must emit `failed` and:

```ts
expect(mockTrackError).toHaveBeenCalledWith({
  area: 'project-delete',
  errorClass: 'UnknownError',
  phase: 'failed',
});
```

Assert the original error is rethrown so `clusterAction` retains its notification behavior.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:unit -- src/components/DeleteAKSProject/AKSProjectDeleteButton.test.tsx src/components/DeleteAKSProject/hooks/useProjectDeletion.test.ts
```

Expected: FAIL because deletion telemetry is absent.

- [ ] **Step 4: Track dialog discovery and cancellation**

Replace inline state setters with explicit handlers:

```ts
const handleOpen = () => {
  trackAksFeature('aksd.project-delete', 'opened');
  setOpen(true);
};

const handleCancel = () => {
  trackAksFeature('aksd.project-delete', 'cancelled');
  setOpen(false);
};

const handleConfirm = () => {
  handleDelete(project, deleteNamespaces, () => setOpen(false));
};
```

Use `handleCancel` only for cancel/close and `handleConfirm` for confirmation.

- [ ] **Step 5: Track deletion outcomes inside the action**

Emit `started` before `clusterAction`. Immediately inside the existing async callback, open a `try` block before `const namespacePromises`. Immediately after the existing namespace-processing loop, add the success event and close with this catch block:

```ts
trackAksFeature('aksd.project-delete', 'succeeded');
} catch (error) {
  trackAksFeature('aksd.project-delete', 'failed');
  trackError({
    area: 'project-delete',
    errorClass: 'UnknownError',
    phase: 'failed',
  });
  throw error;
}
```

Preserve the existing `clusterAction` messages, navigation, and `onClose()` behavior.

The current `clusterAction` API exposes a `cancelledMessage` but no cancellation callback to this hook. Therefore this slice intentionally records `cancelled` only when the confirmation dialog closes before deletion starts. Cancelling the underlying cluster action may leave a `started` event without a terminal feature event; adding an action-level cancellation bridge is deferred rather than inferred from UI or error text.

- [ ] **Step 6: Run focused tests and verify GREEN**

```bash
npm run test:unit -- src/components/DeleteAKSProject/AKSProjectDeleteButton.test.tsx src/components/DeleteAKSProject/hooks/useProjectDeletion.test.ts
```

Expected: PASS.

### Task 7: Run Telemetry and Plugin Verification

**Files:**
- Verify all modified and created files above.

- [ ] **Step 1: Run the complete telemetry suite**

```bash
npm run test:unit -- src/telemetry src/hooks/useTelemetryFeatureOpened.test.ts
```

Expected: PASS with no warnings.

- [ ] **Step 2: Run all affected workflow tests together**

```bash
npm run test:unit -- \
  src/components/AzureAuth/AzureLoginPage.test.tsx \
  src/components/AzureAuth/hooks/useAzureProfilePage.test.ts \
  src/components/AKS/RegisterAKSClusterPage.test.tsx \
  src/components/AKS/RegisterAKSClusterDialog.test.tsx \
  src/components/CreateNamespace/CreateNamespace.test.tsx \
  src/components/DeleteAKSProject/AKSProjectDeleteButton.test.tsx \
  src/components/DeleteAKSProject/hooks/useProjectDeletion.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run static validation**

```bash
npm run tsc
npm run lint
npx prettier --check \
  src/telemetry/schema.ts \
  src/telemetry/aksFeature.ts \
  src/telemetry/aksFeature.test.ts \
  src/hooks/useTelemetryFeatureOpened.ts \
  src/hooks/useTelemetryFeatureOpened.test.ts \
  src/components/AzureAuth \
  src/components/AKS/RegisterAKSClusterPage.tsx \
  src/components/AKS/RegisterAKSClusterPage.test.tsx \
  src/components/AKS/RegisterAKSClusterDialog.tsx \
  src/components/AKS/RegisterAKSClusterDialog.test.tsx \
  src/components/CreateNamespace/CreateNamespace.tsx \
  src/components/CreateNamespace/CreateNamespace.test.tsx \
  src/components/DeleteAKSProject
```

Expected: all commands exit successfully.

- [ ] **Step 4: Run the full plugin unit suite**

```bash
npm run test:unit
```

Expected: PASS. Do not fix unrelated failures; report them separately if present.

- [ ] **Step 5: Review the final diff for privacy and scope**

```bash
git diff --check
git diff -- plugins/aks-desktop/src/telemetry plugins/aks-desktop/src/hooks plugins/aks-desktop/src/components
```

Confirm:

- No new telemetry property keys were added.
- No identifiers or raw errors are passed to telemetry.
- Every new feature and error area is closed and typed.
- Only the four approved workflow areas were instrumented.
- Existing workflow behavior remains unchanged when telemetry is unavailable.
