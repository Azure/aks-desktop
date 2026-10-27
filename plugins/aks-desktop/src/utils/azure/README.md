# Azure Utilities (`utils/azure/`)

This directory contains the Azure integration layer for AKS Desktop. Domain modules use the shared HTTP/token helpers for migrated REST operations and the CLI helpers for operations that have not yet migrated.

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

| Module                           | Responsibility                                                               |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `az-auth.ts`                     | Login flows and status checks                                                |
| `az-extensions.ts`               | Extension installation, status checks, and Azure CLI configuration           |
| `az-resource-providers.ts`       | Subscription resource-provider registration                                  |
| `az-subscriptions.ts`            | Subscriptions, tenants, resource groups, locations                           |
| `az-clusters.ts`                 | AKS cluster listing (Resource Graph optimized), status, capabilities, addons |
| `az-resource-graph.ts`           | Azure Resource Graph queries for fast cluster lookups                        |
| `az-namespaces.ts`               | Managed namespace CRUD with polling for async operations                     |
| `az-managed-namespace-update.ts` | Typed REST namespace reads and lossless updates with bounded polling         |
| `az-namespace-access.ts`         | Namespace role assignments and access verification                           |
| `az-identity.ts`                 | Managed identity CRUD, role assignments, scope building                      |
| `az-ad.ts`                       | Azure AD user search                                                         |
| `az-acr.ts`                      | Container registry creation, listing, and image discovery                    |
| `az-federation.ts`               | Federated credentials for GitHub Actions and Kubernetes OIDC                 |

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
    ├── az-resource-graph.ts
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

Live tests (`*.live.test.ts`) compare REST results with `az` and require a logged-in `az`: `AZ_LIVE_TESTS=1 npx vitest run --project unit live.test`.

### Managed namespace updates

`getManagedNamespaceDetails` and `updateManagedNamespace` use the managed namespace
GET/PUT API version `2026-01-01`. Updates first read the existing resource and
preserve unrelated writable quotas, network policies, labels, annotations,
adoption/deletion policies, location, and ARM tags. A failed initial read aborts
the update. Read-only identity/status fields are not sent back in the PUT body.

Quota inputs remain numeric millicores for CPU and MiB for memory, serialized as
`m` and `Mi` quantities. Explicit zero is an update; an omitted value leaves the
existing setting unchanged. Project labels merge over existing labels rather
than replacing them. Native namespace labels remain Kubernetes API operations.

`noWait` returns after the service accepts the PUT; otherwise the helper waits
for operation completion and reads the final namespace. Errors and conflicts
are surfaced rather than replaying a failed PUT or reporting accepted work as
completed. Default token acquisition remains CLI-backed through `az-token.ts`;
the migrated resource operations themselves use HTTP.

An empty HTTP 200 or 204 from a `Location` poll ends polling, not success
verification: the final namespace GET must still confirm `Succeeded`. Empty
HTTP 202 responses remain pending, while operation-status and resource polls
still require their expected response bodies.

Reads and updates resolve the selected subscription's account with read-only
`az account show --subscription`, or the current account when no subscription is
provided. The resolved tenant is used for every resource and polling request;
the CLI default account is not changed. Failed account resolution aborts before
requesting a token or sending a resource request.

When Azure supplies an ETag, the update sends it as `If-Match`. Server-side
enforcement still needs live verification; without an ETag the read/modify/write
sequence cannot prevent a concurrent update from being overwritten.

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
