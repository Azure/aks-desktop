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
