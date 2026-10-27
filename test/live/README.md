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

Run the managed namespace deletion suite with a fresh AKS cluster:

```sh
AZ_LIVE_TESTS=1 npm --prefix plugins/aks-desktop run test:unit -- az-managed-namespace-delete.live.test.ts
```

This suite verifies both Keep and Delete policies against the actual Kubernetes
API using ephemeral admin certificates and CA-verified HTTPS, without kubectl.
It requires AKS creation/admin-credential permission and incurs temporary compute
charges. Only run it explicitly on Cloud Native Tools.

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
