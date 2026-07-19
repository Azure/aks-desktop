# Telemetry Coverage Expansion Design

## Summary

Expand AKS Desktop telemetry across a small set of high-value management workflows while preserving the privacy contract introduced by PRs #718 and #773. The first implementation covers Azure authentication, AKS cluster registration, namespace creation, and project deletion.

The change reuses the existing `headlamp.feature` and `headlamp.exception` envelopes. It adds no free-form dimensions, identifiers, automatic collection, or production-ingestion dependencies.

## Goals

- Measure discovery and completion of core AKS Desktop management workflows.
- Record clear operation outcomes using the existing lifecycle statuses.
- Keep direct AKS-specific event names type-safe and centrally allowlisted.
- Reduce repeated telemetry boilerplate at feature call sites.
- Maintain the existing fail-closed, no-throw telemetry behavior.
- Keep the implementation small enough for one focused pull request.

## Non-Goals

- Instrumenting Access, Scaling, GitHub pipelines, Metrics, or Logs in this pull request.
- Capturing field edits, wizard navigation, filters, selections, refreshes, or generic button clicks.
- Adding duration, workflow identifiers, resource identifiers, error messages, or new telemetry properties.
- Changing consent behavior, install correlation, Application Insights configuration, or ingestion infrastructure.
- Refactoring the entire telemetry module.

## Event Model

Continue sending direct product telemetry through `headlamp.feature` with the existing `feature` and `status` properties.

Add these closed feature names:

- `aksd.auth-login`
- `aksd.auth-logout`
- `aksd.cluster-add`
- `aksd.namespace-create`
- `aksd.project-delete`

Use only existing lifecycle statuses:

- `opened`: the user reached a dedicated workflow surface.
- `started`: the user initiated the operation.
- `succeeded`: the operation completed successfully.
- `failed`: the operation reached a definitive failure.
- `cancelled`: the user explicitly abandoned an opened or started workflow before completion.

Not every workflow must emit every status. For example, logout begins from the profile page and therefore does not need a separate `opened` event.

## Shared API

Introduce a typed AKS feature helper alongside the existing generic `trackFeature` API. The helper accepts only allowlisted `aksd.*` feature names and lifecycle statuses, then delegates to the existing telemetry chokepoint.

Add a shared `useTelemetryFeatureOpened` hook under `src/hooks/` for dedicated workflow surfaces. The hook emits one `opened` event when the surface mounts. Operation handlers continue emitting `started`, `succeeded`, `failed`, and `cancelled` at explicit control-flow boundaries.

The telemetry APIs remain no-throw. New call sites should invoke them directly rather than adding local `safelyTrack*` wrappers. Telemetry must never alter navigation, loading state, error handling, or operation results.

## Workflow Instrumentation

### Azure Login

- Emit `opened` when the login page mounts.
- Emit `started` immediately before initiating Azure login.
- Emit `succeeded` after authentication is confirmed, before redirecting.
- Emit `failed` when login initiation or polling reaches a definitive failure.
- Emit `cancelled` when the user explicitly cancels an active login attempt.
- Emit `headlamp.exception` using area `auth-login` for failures.

### Azure Logout

- Emit `started` immediately before invoking Azure logout.
- Emit `succeeded` after the logout command succeeds.
- Emit `failed` when logout fails.
- Emit `headlamp.exception` using area `auth-logout` for failures.
- Do not emit `opened` merely because the profile page or logout button is visible.

### Add/Register Cluster

- Emit `opened` when the AKS cluster-registration surface mounts.
- Emit `started` when registration is submitted.
- Emit `succeeded` after the cluster is successfully registered.
- Emit `failed` when registration definitively fails.
- Emit `cancelled` for an explicit cancel or back action before a terminal result.
- Emit `headlamp.exception` using area `cluster-add` for failures.

### Namespace Creation

- Emit `opened` when the namespace-creation surface mounts.
- Emit `started` when creation is submitted.
- Emit `succeeded` after all required namespace setup completes.
- Emit `failed` when the workflow definitively fails.
- Emit `cancelled` for an explicit cancel or back action before a terminal result.
- Emit `headlamp.exception` using area `namespace-create` for failures.

### Project Deletion

- Emit `opened` when the delete confirmation workflow opens.
- Emit `started` when deletion is confirmed.
- Emit `succeeded` after deletion completes.
- Emit `failed` when deletion definitively fails.
- Emit `cancelled` when the confirmation workflow closes without starting deletion.
- Emit `headlamp.exception` using area `project-delete` for failures.

## Error Classification

Use only the existing categorical error classes:

- `AuthenticationError` for explicit authentication failures.
- `PermissionError` for explicit authorization or role failures.
- `ValidationError` for rejected local or service validation.
- `NetworkError` for explicit connectivity failures.
- `TimeoutError` for existing timeout branches.
- `UnknownError` when the code cannot safely determine a category.

Classification must be based on existing structured branches or result types. This pull request will not inspect or transmit raw error messages to derive categories.

## Privacy Requirements

- Feature and error values must be members of closed vocabularies.
- No subscription, tenant, resource group, cluster, namespace, project, user, or file identifiers may be added.
- No raw error messages, command output, URLs, routes, or form values may be transmitted.
- Existing property filtering and final envelope scrubbing remain unchanged.
- Existing consent and pre-initialization buffering behavior remain unchanged.

## Testing Strategy

Development follows test-driven development for each workflow:

1. Extend vocabulary tests for the new feature names and error areas.
2. Add tests for the typed AKS feature helper and opened-event hook.
3. Add or extend workflow tests to verify lifecycle events at success, failure, and cancellation boundaries.
4. Verify telemetry failures do not change workflow behavior.
5. Run focused telemetry and affected component tests, followed by TypeScript, lint, formatting, and the plugin unit suite.

Tests assert categorical telemetry properties only. They must not snapshot or expose user-controlled values.

## Follow-Up Slices

After this pull request, expand coverage in separate reviews:

1. Access and Scaling operations.
2. GitHub pipeline configuration and workflow dispatch.
3. Metrics and Logs feature-open signals and meaningful configuration failures.
4. Optional coarse duration buckets and improved structured error classification.

