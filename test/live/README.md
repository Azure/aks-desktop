# Azure REST E2E tests

Live tests require `AZ_LIVE_TESTS=1`, Azure CLI on PATH and an existing `az login`
session. Azure CLI is used to bootstrap an ARM token (refreshed only on expiry); resource
creation, assertions, polling, inventory and cleanup use REST.

The default subscription is **Cloud Native Tools**, not the CLI's current
subscription. For this PR's live validation, use only Cloud Native Tools.
`AZ_LIVE_SUBSCRIPTION` may specify that subscription's GUID instead of its name;
do not point the live run at another subscription or switch to another cloud.
`AZ_LIVE_LOCATION` defaults to `eastus2`.

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
setup deadline). Production conflict
handling remains fail-closed if the exact assignment cannot yet be verified;
an inherited or otherwise nonmatching grant never counts as success.

Migrated role operations omit injected credentials and use production subscription
credentials and configured-cloud resolution through the shared
`azureLiveAuthBridge`. It permits only selected-account public ARM token
acquisition and read-only cloud metadata; resource CLI operations, other accounts
and other clouds are rejected before spawning. Repeated operations must reuse one
production token acquisition and one metadata read. Setup and cleanup retain the
real CLI-bootstrapped REST fixture credential. Assignment-visibility checks use the
same production credential and configured audience as conflict verification, so a
different fixture-token view cannot falsely establish readiness. Nothing mocks
Azure responses or token output. The provider live suite reuses this same bridge.

Non-public cloud defaults, explicit/injected transport overrides and wrong-tenant
rejection are also covered offline in `az-role-assignments-auth.test.ts`.
User/Group grants, Arc scopes, cross-subscription
ACR scopes and denied writes remain unit-tested; this suite does not access other
subscriptions or create directory users/groups.

Each test creates a fresh resource group named
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
