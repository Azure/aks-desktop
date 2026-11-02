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
| `az-resource-graph.ts`           | Azure Resource Graph queries for clusters, counts, and managed namespaces    |
| `az-namespaces.ts`               | Managed namespace CRUD with polling for async operations                     |
| `az-managed-namespace-update.ts` | Typed REST namespace reads and lossless updates with bounded polling         |
| `az-namespace-access.ts`         | Namespace role assignments and access verification                           |
| `az-identity.ts`                 | Managed identity CRUD, role assignments, scope building                      |
| `az-ad.ts`                       | Microsoft Graph Entra user search and identifier resolution                  |
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
    ├── az-resource-graph.ts ────────> az-http.ts
    ├── az-namespaces.ts
    ├── az-namespace-access.ts ──────> az-namespaces.ts
    ├── az-clusters.ts ──────────────> az-resource-graph.ts, az-subscriptions.ts
    ├── az-identity.ts ──────────────> az-validation.ts
    ├── az-ad.ts ────────────────────> az-http.ts
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

### Entra user lookup

`searchAzureADUsers` and `resolveAzureADUser` use Microsoft Graph
`v1.0/users` endpoints through `az-http.ts`. Each lookup checks the current CLI
account and resolves its named cloud's `microsoftGraphResourceId` from local
`az cloud show` metadata. The endpoint and token audience follow that Graph
configuration, not the ARM or legacy Azure AD Graph endpoint. Missing or invalid
configuration fails explicitly without falling back to public Graph.

Authentication remains CLI-backed through the shared token provider. Graph
credentials are scoped to the observed user, tenant, subscription, and cloud;
switching accounts externally cannot reuse the previous context's cached token
on the next lookup. Unchanged contexts retain shared token caching and refresh.
The existing focus/periodic account checks also invalidate token and cloud
metadata caches when the observed account changes or becomes unavailable, using
a separate notification that does not trigger another login-status check.
Overlapping account reads follow the newest observation, including lookup
failures, so a delayed older result cannot invalidate newer caches or restore
an earlier Graph context.
These helpers do not change the selected account or request directory writes.

Search retains a two-character minimum, prefix matching on display name, mail,
and UPN, and a maximum of 15 results. Resolution returns both the object ID and
UPN, including guest UPNs and users without mail: Azure role assignments require
the object ID, while Kubernetes user subjects require the UPN.

The signed-in identity needs delegated permission to read other users' basic
profiles, such as `User.ReadBasic.All`, with consent permitted by tenant policy.
`User.Read` alone is not sufficient for directory search; acquiring a Graph token
does not grant missing permissions. The helper does not request consent or
bypass conditional access. Guests may be returned as records, but a guest
signed-in account cannot use Graph's list-users API.

Directory, consent, and authentication failures remain explicit lookup errors
so the existing manual-entry UI stays available. Submission requires a
well-formed object ID and, for native Kubernetes RBAC, a well-formed UPN.
Missing or invalid required identifiers block submission; a failed Graph lookup
does not block it when those identifiers have been supplied manually. Directory
resolution is not required in that case, and the UI preserves a manually entered
UPN when an object-ID lookup fails. Grant operations still require the caller's
Azure or Kubernetes authorization; manual entry does not grant directory access.

See the Graph [list users](https://learn.microsoft.com/en-us/graph/api/user-list?view=graph-rest-1.0)
and [get user](https://learn.microsoft.com/en-us/graph/api/user-get?view=graph-rest-1.0)
permission requirements. Offline transport and caller tests do not establish
live consent or conditional-access behavior in a particular tenant. Public,
Government, and China Graph routing is tested with mocked cloud configuration;
this is not a claim of live sovereign-cloud validation.

### Managed namespace deletion

Managed namespace deletion uses ARM 2026-01-01 DELETE, follows trusted operation
URLs and Retry-After, and waits for both operation completion and resource absence.
One deadline/cancellation signal covers all requests and polling.
Production deletion also resolves missing endpoint/scope defaults from the
configured CLI cloud under this signal. The resolved endpoint governs trusted
operation origins. Explicit overrides win; injected credentials retain
caller-controlled transport defaults without local metadata reads. Configuration
failures never fall back to public ARM; non-public defaults are unit-tested only.
The transport shares this deadline budget, including throttled GET retries with
long `Retry-After` delays, rather than imposing a separate one-minute cutoff.
Transport retries and deletion polling reuse `waitForAzureRetry` for seconds/date
`Retry-After` parsing and abortable waits. Without a valid header, deletion polling
waits one second; transport retries use capped exponential backoff. Explicit server
delays are not capped, but still stop at the shared cancellation/deadline.
Keep/Delete policy is honored, never overwritten. Only positively ARM-marked,
AKS-owned namespaces take this path; native/Arc and imported projects retain their
native deletion or label-removal paths.
Namespace names must match the existing Kubernetes DNS-label validator before any
authentication or HTTP request; dot segments cannot retarget the DELETE. A 404
when refetching labels after ARM deletion also completes successfully, while
authorization and server errors still fail.
Post-ARM label cleanup reuses `fetchNamespaceData` for the latest raw namespace
and resourceVersion, including API subscription cleanup and preserved HTTP status.

Run `AZ_LIVE_TESTS=1 npm run test:unit -- az-managed-namespace-delete.live.test.ts`.
The E2E suite creates a fresh AKS cluster in Cloud Native Tools, exercises Keep and
Delete policies, and verifies actual Kubernetes namespace retention/deletion using
ephemeral admin certificates and CA-verified direct HTTPS (no kubectl or resource
CLI calls). The account needs AKS creation/admin-credential permission.
All run-owned groups/resources are cleaned in per-test `finally`, including failures.
See [live test setup and inventory](../../../../../test/live/README.md).

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

The credential is bound to the resolved subscription, not just its tenant, so
other signed-in identities in the same tenant do not supply the request token.
The selected account's named cloud (or the active CLI cloud when older account
metadata omits it) supplies both the ARM endpoint and exact token audience.
Polling URLs must stay on that resolved ARM origin; missing cloud configuration
fails without falling back to public Azure. Public, Government, China, and custom
cloud routing is covered offline, not claimed verified against live services.

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
