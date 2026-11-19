# Azure REST E2E tests

Live tests require `AZ_LIVE_TESTS=1`, Azure CLI on PATH and an existing `az login`
session. Azure CLI is used to bootstrap an ARM token (refreshed only on expiry); resource
creation, assertions, polling, inventory and cleanup use REST.

The resource-creating suites default to **Cloud Native Tools**, not the CLI's
current subscription. For their live validation, use only Cloud Native Tools.
`AZ_LIVE_SUBSCRIPTION` may specify that subscription's GUID instead of its name;
do not point the live run at another subscription or switch to another cloud.
`AZ_LIVE_LOCATION` defaults to `eastus2`.

## Read-only managed cluster discovery

```sh
AZ_LIVE_TESTS=1 npm --prefix plugins/aks-desktop run test:unit -- az-clusters.live.test.ts
```

This co-located suite uses the **current CLI subscription**, unlike the
resource-creating suites below; `AZ_LIVE_SUBSCRIPTION` does not select its account.
It never switches accounts/clouds, creates resources or needs cleanup. It is
disabled whenever `CI` is set, even with the live opt-in. The command adapter permits
only `az account show`, `az account get-access-token` and `az cloud show`.

The suite covers normal Graph-first discovery and real ARM fallback list/info/ID-group
reads. ARM cases bypass only Graph; authentication, cloud configuration, tokens,
HTTP and responses remain real. The lookup case skips when no uniquely named
managed cluster exists. Errors are sanitized and assertions use types/booleans to
avoid logging account or resource identifiers. It does not validate managed-detail
projections, packaged-app behavior or sovereign/custom-cloud accounts.

## Resource-creating suites

Run a suite, for example:

```sh
AZ_LIVE_TESTS=1 npm --prefix plugins/aks-desktop run test:unit -- az-resource-providers.live.test.ts
```

The production-credential case runs real `az account get-access-token` and local
`az cloud show` commands through a native-bridge adapter, not injected tokens or
mocked ARM responses. It checks the selected subscription argument, the actual
tenant/principal/audience claims, successful REST registration, and cached reuse
across repeated registration. Tokens are kept in memory and never logged.
Resource-group setup, registration, verification and observed cleanup all use REST.

Sovereign/custom-cloud mappings remain covered by unit tests. No real accounts in
those clouds are used or claimed as live-validated; they are outside the permitted
Cloud Native Tools live-validation scope.

Run the managed namespace deletion suite with a fresh AKS cluster:

```sh
AZ_LIVE_TESTS=1 npm --prefix plugins/aks-desktop run test:unit -- az-managed-namespace-delete.live.test.ts
```

This suite verifies both Keep and Delete policies against the actual Kubernetes
API using ephemeral admin certificates and CA-verified HTTPS, without kubectl.
It requires AKS creation/admin-credential permission and incurs temporary compute
charges. Only run it explicitly on Cloud Native Tools.
The shared AKS fixture gives its initial PUT and polling the remaining 20-minute
provisioning budget, rather than a separate 60-second transport cap. Timing tests
cover a two-minute initial PUT and exact remaining poll budget.
Namespace setup likewise shares one five-minute budget across its PUT and polls;
separate regressions verify a two-minute PUT for both Keep and Delete policies.
Before each namespace write, setup reuses the AKS fixture's readiness poller to
wait out parent-cluster updates. A specific server-rejected `BadRequest` saying
the parent is in `Updating` state may repeat the identical owned setup PUT after
another readiness check, under the same deadline. Other rejected/uncertain writes
are not replayed. This does not change production deletion completion semantics.

The live suite exercises the ARM deletion helper and verifies both ARM absence
and actual Kubernetes retention/deletion, including repeated deletion. It is not
a packaged-Electron/project-dialog test: native/Arc/imported routing, post-ARM
label cleanup, permission failures, terminal operation/resource failures,
unrecognized 404s, cancellation and throttling/deadline behavior are unit-tested.

Deletion calls omit injected credentials and use production subscription
authentication and configured-cloud resolution through the shared
`azureLiveAuthBridge`, also reused by the provider live suite. It permits only
selected-account public ARM token acquisition and read-only cloud metadata, never
resource CLI operations or other accounts/clouds. Both policies and repeated
deletions must reuse one token acquisition and one metadata read. REST setup,
independent verification and cleanup retain the real fixture credential; no token
output or Azure responses are mocked.

Non-public default routing, resolved-cloud operation origins, overrides,
wrong-tenant rejection and cancellation/deadlines during metadata lookup are
separately tested in `az-managed-namespace-delete-auth.test.ts`.

Run the managed cluster detail suite with a fresh AKS cluster:

```sh
AZ_LIVE_TESTS=1 npm --prefix plugins/aks-desktop run test:unit -- az-managed-clusters.live.test.ts
```

The suite checks cluster identity/type, SKU, readiness/version and every projected
capability against the actual ARM profiles. It compares the kubelet object ID
with the raw identity profile and requires a real HTTPS OIDC issuer plus enabled
workload identity, not just a success flag.

Detail consumers omit injected credentials and exercise production subscription
authentication and configured-cloud lookup through the shared
`azureLiveAuthBridge`, also reused by the provider live suite. The adapter permits
only selected-account public ARM token acquisition and read-only cloud metadata,
never resource CLI operations or other accounts/clouds. All consumers must reuse
one token acquisition and one metadata read. REST setup/cleanup retain the real
fixture credential; no token output or Azure responses are mocked.

Non-public configured-cloud defaults, explicit/injected overrides and cancellation
are separately tested in `az-managed-clusters-auth.test.ts`. Stopped/failed states, missing
profiles, malformed/Arc responses and denied reads are covered by unit tests,
without deliberately damaging or reconfiguring a real cluster.
The shared AKS fixture gives the initial PUT and subsequent polling the remaining
20-minute provisioning budget, rather than a separate 60-second transport cap.
Timing regressions cover a two-minute initial PUT and exact remaining poll time.

Run the role-assignment suite with an isolated group and identity:

```sh
AZ_LIVE_TESTS=1 npm --prefix plugins/aks-desktop run test:unit -- az-role-assignments.live.test.ts
```

The suite checks the exact Reader definition, principal type, resource-group
scope and single-assignment result after repeated creation. It also seeds a
Reader assignment with a different name at the owned identity's resource scope,
then verifies reuse of that exact assignment through the real conflict path.
An inherited resource-group assignment is not accepted as that resource assignment.
ARM assignment lists can lag creation, so the fixture observes both the first
group grant and the seeded assignment in REST reads (each with a five-minute
setup deadline). Production conflict handling polls stale lists once per second
under one bounded verification deadline (60 seconds by default), then remains fail-closed
if the exact assignment still cannot be verified;
an inherited or otherwise nonmatching grant never counts as success.

Migrated role operations omit injected credentials and use production subscription
credentials and configured-cloud resolution through the shared
`azureLiveAuthBridge`. It permits only selected-account public ARM token
acquisition and read-only cloud metadata; resource CLI operations, other accounts
and other clouds are rejected before spawning. Repeated operations must reuse one
production token acquisition and one metadata read. Setup and cleanup retain the
real CLI-bootstrapped REST fixture credential. Assignment-visibility checks use the
same production credential, configured audience and ARM `atScope()` lookup as conflict verification, so a
different fixture-token view cannot falsely establish readiness. Nothing mocks
Azure responses or token output. The provider live suite reuses this same bridge.

Non-public cloud defaults, explicit/injected transport overrides and wrong-tenant
rejection are also covered offline in `az-role-assignments-auth.test.ts`.
User/Group grants, Arc scopes, cross-subscription
ACR scopes and denied writes remain unit-tested; this suite does not access other
subscriptions or create directory users/groups.

Each resource-creating test creates a fresh resource group named
`aksd-rest-e2e-<suite>-<UTC timestamp>-<random ID>`. Tags record the test suite,
run ID and creation time. AKS node groups use the same name with `-nodes`.
Tests clean up both groups in a per-test `finally` block even when setup or an
assertion fails, and observe deletion rather than merely accepting a DELETE.
Cleanup errors are reported alongside test failures, never silently ignored.
AKS teardown can exceed twenty minutes, so cleanup allows up to thirty minutes
per group; live test timeouts reserve a longer budget for cleanup to finish.
Idempotent deletion of the exact run-owned groups retries transient transport and
server failures with bounded attempts; authorization failures still fail immediately.
The account needs permission to create/delete test resources; AKS suites can
incur temporary compute charges.

List any leftover test groups and their resources without modifying them:

```sh
npm run test:azure:list
```

Inventory uses the same default subscription/override and naming prefix, so it
also finds node groups created by AKS. A killed process or revoked permission
can prevent automatic cleanup; this read-only script makes those leftovers
discoverable. Do not remove resources outside the run-owned groups.
