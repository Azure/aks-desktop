# Azure Utilities (`utils/azure/`)

This directory contains the Azure CLI integration layer for AKS Desktop. Every Azure operation — authentication, cluster management, namespace CRUD, identity setup — flows through these modules.

## Module Map

### Core Layer

| Module             | Responsibility                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `az-cli-path.ts`   | Resolve the `az` command path (bundled Electron build vs system CLI)                                              |
| `az-cli-core.ts`   | Foundation — `runCommandAsync`, `runAzCommand`, debug logging, error detection (`needsRelogin`, `isAzError`)      |
| `az-validation.ts` | Input validation (`isValidAzResourceName`, `isValidGitHubName`) and output parsing (`parseManagedIdentityOutput`) |
| `az-token.ts`      | CLI-backed `TokenCredential` (`getAzToken`, `azCliCredential`)                                                    |
| `az-http.ts`       | Azure REST requests (`azRequest`, `azRequestRaw`, `azListAll`)                                                    |

### Domain Modules

| Module                     | Responsibility                                                               |
| -------------------------- | ---------------------------------------------------------------------------- |
| `az-auth.ts`               | Login flows and status checks                                                |
| `az-extensions.ts`         | Extension installation, status checks, and Azure CLI configuration           |
| `az-resource-providers.ts` | Subscription resource-provider registration                                  |
| `az-subscriptions.ts`      | Subscriptions, tenants, resource groups, locations                           |
| `az-clusters.ts`           | AKS cluster listing (Resource Graph optimized), status, capabilities, addons |
| `az-resource-graph.ts`     | Azure Resource Graph queries for clusters, counts, and managed namespaces    |
| `az-namespaces.ts`         | Managed namespace CRUD with polling for async operations                     |
| `az-namespace-access.ts`   | Namespace role assignments and access verification                           |
| `az-identity.ts`           | Managed identity CRUD, role assignments, scope building                      |
| `az-ad.ts`                 | Azure AD user search                                                         |
| `az-acr.ts`                | Container registry creation, listing, and image discovery                    |
| `az-federation.ts`         | Federated credentials for GitHub Actions and Kubernetes OIDC                 |

### Orchestration Modules

These modules compose the `az-*` primitives into higher-level workflows used by UI components:

| Module                 | Responsibility                                                           |
| ---------------------- | ------------------------------------------------------------------------ |
| `aks.ts`               | Legacy cluster registration flow (subscriptions + clusters + kubeconfig) |
| `checkAzureCli.ts`     | Pre-flight check: is the CLI installed and new enough?                   |
| `identitySetup.ts`     | Ensure resource group + managed identity exist (create-if-missing)       |
| `identityRoles.ts`     | Compute required role assignments for a given namespace context          |
| `identityWithRoles.ts` | End-to-end: ensure identity exists with all required roles               |
| `roleAssignment.ts`    | Assign roles to a namespace (used by CreateNamespace flow)               |

## Dependency Diagram

```
az-cli-path.ts  (standalone — CLI path resolution)
    ^
az-cli-core.ts  (foundation — runCommandAsync, runAzCommand, error helpers)
    ^
    ├── az-auth.ts ──────────────────> az-cli-path.ts
    ├── az-extensions.ts
    ├── az-resource-providers.ts
    ├── az-subscriptions.ts ─────────> az-validation.ts
    ├── az-resource-graph.ts ────────> az-http.ts
    ├── az-namespaces.ts
    ├── az-namespace-access.ts ──────> az-namespaces.ts
    ├── az-clusters.ts ──────────────> az-resource-graph.ts, az-subscriptions.ts
    ├── az-identity.ts ──────────────> az-validation.ts
    ├── az-ad.ts
    ├── az-acr.ts ───────────────────> az-validation.ts
    └── az-federation.ts ────────────> az-validation.ts

az-validation.ts  (standalone — no internal imports)
```

No circular dependencies. `az-cli-core.ts` is the single hub — every domain module imports from it.

## Direct REST calls

Use `azRequest`/`azListAll` from `az-http.ts` for Azure REST calls. Tokens come from `azCliCredential` unless a `credential` is passed.

Subscription-bound credentials select the CLI account with `--subscription`,
never both `--subscription` and `--tenant`. An explicit tenant must be a GUID
matching the token response; tenant-only, unbound credentials still accept tenant
domains. Tokens are cached separately by subscription, tenant and audience.

Live tests (`*.live.test.ts`) verify real ARM results through REST and require a
logged-in `az` for authentication, not resource-operation parity commands.

Resource-provider registration uses direct REST and requires an explicit selected
subscription. Success means accepted; pass `waitUntilRegistered: true` to poll for
completion. An optional signal and timeout bound the entire operation.
The wizard retains the selected account's tenant and normalizes CLI `cloudName`
(or legacy `environmentName`) into its internal `environmentName`. Registration
resolves that named cloud's configured ARM endpoint and token audience, including
Government, China and custom clouds. Local `az cloud show` metadata is cached per
cloud and invalidated on account changes; it does not switch the active CLI cloud.
Metadata failures are reported without falling back to public Azure. Registration
itself remains REST-only, and the product grants only read-only `cloud show`.
The token resource is preserved verbatim: a configured trailing slash remains
before the appended `/.default` (for example, `https://management.core.windows.net//.default`).
Submission captures that registration's cancellation signal: closing the wizard or
changing subscriptions cannot resume namespace creation or success handling when
an aborted registration resolves its failure result.
After a timeout, retrying in the same subscription starts a fresh registration
lifecycle; the old attempt remains cancelled. Cancelling during the delayed success
dialog also releases busy/progress state only for the current, still-mounted attempt.

Run its opt-in E2E test from the plugin directory:
`AZ_LIVE_TESTS=1 npm run test:unit -- az-resource-providers.live.test.ts`.
`az` must be available and logged in. The default subscription is Cloud Native
Tools; `AZ_LIVE_SUBSCRIPTION` may select that same subscription by GUID.
Each test uses a uniquely prefixed/tagged group with per-test cleanup, including
failure paths. This idempotently registers Microsoft.ContainerService, so the
account also needs provider-registration permission. Registration is subscription
state and is not undone by cleanup. Authentication tokens are cached;
registration and verification use REST, with no CLI resource calls.
See [live test setup and inventory](../../../../../test/live/README.md).

The opt-in production-credential E2E case omits a registration credential override,
executes real account-bound CLI token acquisition, checks tenant/principal/audience
claims without logging tokens, and verifies registration plus cached reuse.
Live validation is restricted to Cloud Native Tools/public Azure; sovereign/custom
routing is unit-tested but is not claimed to have real-account live coverage.

## Adding a New Function

1. **Find the right module.** Match the Azure resource type: subscriptions go in `az-subscriptions.ts`, cluster operations in `az-clusters.ts`, etc.
2. **Create a new module** only when the function targets a new Azure resource domain (e.g., `az-dns.ts` for DNS zones). Prefix with `az-` and import from `az-cli-core.ts`.
3. **Use `runAzCommand`** for typed JSON responses with automatic error handling. Use `runCommandAsync` when you need raw stdout/stderr control.
4. **Validate inputs** with `isValidGuid` (from `az-cli-core`) or helpers from `az-validation.ts` before interpolating values into KQL queries, OData `--filter` expressions, or JMESPath `--query` strings — this prevents query injection. (CLI args are passed as arrays via `pluginRunCommand`, so shell injection is not a concern.)

## Return Type Conventions

**Operations that can fail gracefully:**

```typescript
{ success: boolean; error?: string }
```

**Operations returning raw CLI output:**

```typescript
{
  stdout: string;
  stderr: string;
}
```

Returned by `runCommandAsync`. Callers check `stderr` for errors.

**Operations returning data with status:**

```typescript
{ success: boolean; stdout: string; stderr: string; error?: string }
```

Used by domain functions (e.g., `az-extensions.ts`, `az-namespaces.ts`) that need to expose both the success flag and raw CLI output.

**`runAzCommand<T>`** — runs an `az` CLI command and returns `{ success: boolean; data?: T; error?: string }`. Does **not** throw on CLI errors — returns `success: false` with an `error` message instead. JSON parsing is not automatic; callers pass an optional `parseOutput` function (commonly `JSON.parse`) to convert stdout into `T`. Handles `needsRelogin` detection internally.

**`runCommandAsync`** — always resolves (never throws). Returns `{ stdout, stderr }`. Callers must check stderr.

## Error Handling

- **`runCommandAsync`** uses Headlamp's `pluginRunCommand` bridge under the hood and always resolves. Check `stderr` for errors.
- **`runAzCommand`** builds on `runCommandAsync` and adds optional JSON parsing via a caller-provided `parseOutput` function, plus `needsRelogin` detection and `isAzError` checking. It never throws on CLI errors; instead it returns `{ success: false, error }`.
- **`needsRelogin(stderr)`** — returns `true` when the error indicates an expired/invalid token. UI components use this to redirect to the login page.
- **`isAzError(stderr)`** — returns `true` when stderr includes the Azure CLI `ERROR:` prefix. Other stderr output (warnings, informational messages) does not trigger this check.
- **`isValidGuid(value)`** — validates subscription/tenant IDs before interpolating into KQL queries or other string-based query contexts to prevent query injection.
