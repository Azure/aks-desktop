# Azure Utilities (`utils/azure/`)

This directory contains the Azure CLI integration layer for AKS Desktop. Every Azure operation — authentication, cluster management, namespace CRUD, identity setup — flows through these modules.

## Module Map

### Core Layer

| Module             | Responsibility                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `az-cli-path.ts`   | Resolve the `az` command path (bundled Electron build vs system CLI)                                              |
| `az-cli-core.ts`   | Foundation — `runCommandAsync`, `runAzCommand`, debug logging, error detection (`needsRelogin`, `isAzError`)      |
| `az-validation.ts` | Input validation (`isValidAzResourceName`, `isValidGitHubName`) and output parsing (`parseManagedIdentityOutput`) |

### Domain Modules

| Module                     | Responsibility                                                               |
| -------------------------- | ---------------------------------------------------------------------------- |
| `az-auth.ts`               | Login flows and status checks                                                |
| `az-extensions.ts`         | Extension installation, status checks, and Azure CLI configuration           |
| `az-resource-providers.ts` | Subscription resource-provider registration                                  |
| `az-subscriptions.ts`      | Subscriptions, tenants, resource groups, locations                           |
| `az-clusters.ts`           | AKS cluster listing (Resource Graph optimized), status, capabilities, addons |
| `az-resource-graph.ts`     | Azure Resource Graph queries for fast cluster lookups                        |
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

## REST Migration Consumer Audit (REST-32)

[REST-32](https://github.com/Azure/aks-desktop/issues/1008) audited repository imports, tests,
package entry points and declarations, documented contracts, native integration patches, and
available assembled plugin/host outputs. The following internal named exports had no supported
runtime consumers and were removed. An export or a unit test alone is not a supported contract.

| Removed helper                        | Consumer evidence                                                                                                                                                              | Remaining migration scope                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `getSubscriptionIds`                  | No callers; subscription discovery uses `getSubscriptions` via [the resource hook](../../components/CreateAKSProject/hooks/useAzureResources.ts) and [registration](./aks.ts). | [REST-03](https://github.com/Azure/aks-desktop/issues/1010): retain subscription/tenant discovery, not this projection.                        |
| `getVmSizes`                          | No callers or documented external contract.                                                                                                                                    | [REST-05](https://github.com/Azure/aks-desktop/issues/1012): retain `getLocations`; no VM-size workflow is needed.                             |
| `getManagedNamespacesForSubscription` | No callers; [InfoTab](../../components/InfoTab/hooks/useInfoTab.ts) uses cluster-scoped `getManagedNamespaces`.                                                                | [REST-13](https://github.com/Azure/aks-desktop/issues/1019): retain active namespace reads/status; no subscription-wide aggregation is needed. |
| `getAksKubeconfig`                    | No callers; [registration](./aks.ts) uses the native `registerCluster` capability instead.                                                                                     | [REST-25](https://github.com/Azure/aks-desktop/issues/1032): audit the native credential handler, not this helper.                             |
| `getUserAccountInfo`                  | Unit tests only; [Azure auth](../../hooks/useAzureAuth.tsx) uses `getLoginStatus`.                                                                                             | [REST-02](https://github.com/Azure/aks-desktop/issues/1031): retain active login/status flows.                                                 |
| `getAccessToken`                      | Unit tests only; [Prometheus](../prometheus/queryPrometheus.tsx) acquires tokens independently.                                                                                | [REST-02](https://github.com/Azure/aks-desktop/issues/1031): migrate active token consumers, not this wrapper.                                 |

This cleanup does not retire CLI authentication, native credential registration, or the Arc proxy.
The linked migration issues still have live work; no REST workflow should be introduced solely
to replace one of these removed helpers.

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
