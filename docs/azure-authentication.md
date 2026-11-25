# Azure authentication

AKS Desktop supports native Azure sign-in for REST-based features and a separate,
optional Azure CLI sign-in for features that still execute `az`, `kubelogin`, or
other CLI-backed operations.

## Native sign-in

The shipped AKS plugin starts the
[Microsoft identity platform device authorization flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)
through a private Headlamp capability. Device-code polling, refresh-token storage,
token caching, and refresh-token rotation run in Electron's main process. The
renderer receives the user prompt, account metadata, and requested access tokens;
refresh tokens are not exposed to plugin code or persisted in browser storage.

### Client registration and tenant-visible identity

The current implementation deliberately reuses Microsoft's Azure CLI public-client
registration, `04b07795-8ddb-461a-bbee-02f9e1bf7b46`, rather than a dedicated AKS
Desktop registration. Microsoft identifies this application as **Azure CLI** in
[its application-ID guidance](https://learn.microsoft.com/en-ie/answers/questions/5512252/migrate-service-principals-from-the-retiring-azure).
The client ID is a public identifier, not a client secret.

Consequently, tenant-facing consent, sign-in records, and application audit
metadata identify the client as Azure CLI, not a separately registered AKS Desktop
application. Conditional Access, consent restrictions, and enterprise-application
policies targeting Azure CLI can also affect native AKS Desktop sign-in.
Administrators must not infer that an Azure CLI client-ID event necessarily came
from the `az` executable or use that ID alone to distinguish the two products.

"Native" describes where authentication and credential lifecycle run; it does
not imply a distinct tenant-visible application registration. Native credentials
remain separate from CLI session storage, and the private desktop capability
limits plugin access, but neither changes the identity shown by Microsoft Entra.
A dedicated product registration would require separate public-client setup,
cloud/scope validation, and an explicit manifest change; this implementation does
not create that registration or widen consent grants.

The product manifest limits the capability to the exact shipped plugin identity,
known Azure clouds, and approved token scopes. Main-process handlers also require
the trusted main frame. Every login attempt has an unguessable identifier so a
late cancellation or failure cannot clear a newer session. Terminal login
failures, document navigation, and application shutdown clear refresh tokens and
abort pending authorization.

Azure Resource Manager callers sometimes identify ARM by its request endpoint,
while the app registration uses the cloud's configured token resource. AKS Desktop
normalizes that endpoint scope before requesting a token. Microsoft documents the
`{resource}/.default` convention and ARM trailing-slash behavior in
[Scopes and permissions](https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc#trailing-slash-and-default).
Public Azure, Azure US Government, and Azure China use separate, explicitly
allowlisted authorities and endpoints, following Microsoft's
[national cloud authentication guidance](https://learn.microsoft.com/en-us/entra/identity-platform/authentication-national-cloud).
Microsoft Graph requests likewise use the matching national-cloud host and token
scope documented in
[Microsoft Graph national cloud deployments](https://learn.microsoft.com/en-us/graph/deployments).

Subscription discovery first reads the signed-in account's tenants, then requests
subscriptions with a token issued by each tenant. The discovered subscription-to-
tenant binding is retained for subsequent ARM and Graph requests; callers cannot
silently substitute another tenant for a selected subscription. This follows
Microsoft's tenant-specific authority guidance for
[single- and multitenant apps](https://learn.microsoft.com/en-us/entra/identity-platform/howto-convert-app-to-be-multi-tenant#update-your-code-to-send-requests-to-common).

If the effective tenant changes without changing the subscription ID, the project
wizard-wide form state clears tenant-bound assignees, including while the Access
or later steps are active. This protection is not owned by the Basics step.
Directory fields clear cached suggestions
and invalidate queued/in-flight lookups so older results cannot restore an
identity from the previous tenant.
An active submission is invalidated too: no subsequent managed-namespace grants,
Arc RoleBindings, or Arc access grants are issued from its old assignee snapshot.
The wizard reports the tenant change and asks the user to inspect and recover any
partially created project and review existing grants before retrying. Already-issued
writes are not rolled back: an Arc namespace is create-only, so retrying against an
existing namespace fails rather than adopting it. Managed namespaces can also retain
partially completed access grants. Completed attempts keep their success result if
the tenant changes during the delayed success dialog.
Cancellation also reaches the namespace lookup and ensuing role-assignment
request, so a lookup completed after the tenant changes cannot start a new grant.

## Azure CLI boundary

[Azure CLI interactive authentication](https://learn.microsoft.com/en-us/cli/azure/authenticate-azure-cli-interactively)
is offered separately because some cluster registration, proxy, and data-plane
operations still require CLI tooling. Skipping or failing that step blocks those
operations without affecting native REST access.

After native sign-in, detecting an installed CLI only presents an explicit
**Sign in to Azure CLI** action. Skipping before choosing that action does not
start `az login` or change the CLI account. An explicitly started CLI login
cannot be cancelled and may complete after leaving the step; the pending state
retains that warning and a late result cannot approve a different native session.

Before CLI-backed work, AKS Desktop verifies the CLI account, tenant, cloud, and
target subscription against the active native session. Identity-changing CLI
commands are serialized, and capability operations retain a reader lease from
verification through completion so a queued login, logout, account switch, or
cloud switch cannot create a check/use race. Capability operations recheck the
native session generation, CLI epoch, and blocking state immediately before
launching the operation. Capability calls validate the final account response as
well as the preliminary verification, including user, tenant, cloud, and subscription.
Managed namespace creation carries the active submission's cancellation signal
through verification and checks it immediately before spawning the CLI write.
Final namespace access verification receives the same cancellation signal; a
result completed after cancellation cannot report a successful grant batch.

CLI-only subscription observations invalidate only the affected subscription's
credentials when its user, tenant, or cloud changes. Native subscription
discovery resolves older snapshots against current tenant bindings, including
bindings reconciled during CLI verification.
Established CLI tenant changes also clear tenant-bound wizard and directory
state. Scoped credential notifications do not interrupt the authenticated page
or discard unrelated subscriptions' pending Graph lookups.
Resolved cluster context refreshes only for its subscription's tenant changes,
preserving open pipeline-wizard state on unrelated events. Unresolved context
still refreshes because its owning subscription is not yet known.
Graph credentials are retained per subscription, so looking up another subscription
does not invalidate an unchanged subscription's in-flight token.
Unavailable or incomplete subscription accounts clear only their own Graph
context; failed unscoped lookups still invalidate all directory contexts.

Prometheus polling checks the selected CLI subscription identity before reusing
cached credentials. Native metrics sessions do not consult the CLI. Metrics
audiences are currently configured for Azure public cloud and Azure China;
other clouds report an explicit unsupported-cloud error rather than requesting
a public-cloud audience.
Concurrent metrics queries share one pending identity check per subscription;
later refreshes read the account again instead of caching that observation.
Each shared identity observation has its own 30-second deadline, independent of
individual query cancellation or timeouts. A hung observation is discarded so a
later poll can retry.
The merged REST migrations remain in place: Prometheus endpoint discovery,
managed addon provisioning, and federated credentials use ARM requests, not the retired CLI helper,
monitor commands, or alerts-management extension. Range queries retain HTTPS
validation, credential overrides, cancellation/deadlines, and a single 401 retry.
Token refresh evicts only the selected cloud's Prometheus scope, without
invalidating cached or pending ARM tokens. Failures retain main's logged-error
and empty-result contract. Injected credentials do not require CLI discovery.
In native sessions a rejected bearer is forwarded through the private capability;
the main process refreshes only that tenant/scope if it still holds the rejected
token. Concurrent or delayed rejection reports reuse a replacement already acquired.

Signing out clears the in-memory native session, cancels pending device
authorization, blocks implicit CLI reuse, and separately attempts `az logout`.
The signed-out profile card continues to show logout progress while the CLI
operation is queued or pending, rather than disappearing when the native account
is cleared. Native cleanup immediately notifies global authentication consumers
even if CLI logout later fails. The progress card offers **Back** so the user can
leave while logout remains queued, with CLI reuse still blocked; late completion
does not redirect an unmounted profile page.

Recovery instructions distinguish the failed phase: native cleanup failure
requires retrying native sign-out. Manual `az logout` is offered only after native
cleanup has succeeded and the remaining failure belongs to the CLI.
A missing command bridge is a CLI cleanup failure, not evidence that CLI
credentials are absent. When the CLI executable is unavailable, the native-only
completion notice replaces progress while the scheduled redirect is pending.
Every nonzero command exit retains a failure marker, even with warning-only stderr;
failed CLI cleanup remains retryable except for the known no-active-account case.

An explicit CLI choice can remain usable in memory if writing the policy fails.
Every persisted native-login/sign-out block also advances a non-sensitive revision,
so another renderer's recovered write invalidates that exception even when the
stored policy was already blocked.
Storage availability checks use a unique key per probe, preventing overlapping
renderers from deleting one another's probes and falsely blocking valid CLI reuse.

## Offline native-cache regression

Run `npm run test:azure-auth` after installing the patched source dependencies.
It drives the real device-session handler, renderer credential, and Prometheus
query against simulated HTTP/IPC, verifies a 401 uses a new bearer, and checks
that unrelated tenant metrics and ARM tokens remain cached. This test also runs
from the existing `npm run test:headlamp-patches` CI entry point.

## Unattended live checks

With dependencies and the patched Headlamp package installed, run:

```sh
npm run test:live:azure-auth
```

The command runs four opt-in live checks without browser approval or console
input:

- The real main-process OAuth handler requests a Microsoft device challenge,
  observes `authorization_pending`, and cancels. Device codes are never printed
  or approved, and no user session is established.
- Cached Azure CLI credentials authenticate a real ARM subscription read.
  Repeated token use and the ARM request must share one CLI token acquisition.
  The returned subscription ID and tenant metadata are validated. For Azure
  Lighthouse delegation, the resource's owning tenant can differ from the
  credential's managing tenant; successful access does not require those IDs to
  be equal.
- Cluster discovery and identity/context lookup use real Azure responses. An
  empty subscription is checked for successful absence without creating a cluster.
- The profile-page hook loads the real cached account and navigates to cluster
  selection without opening a browser. This is not a packaged-Electron UI test.

The authenticated checks require an existing public-cloud `az login` session in
the current subscription. They never run login/logout, change accounts or clouds,
create resources, or access CLI credential-cache files. The command adapter closes
stdin and bounds CLI reads to 30 seconds. Missing permissions or expired/revoked
credentials fail the run rather than prompting or being counted as passes; renew
credentials separately if required by tenant policy. Tests redact account and
resource identifiers, token contents, and Azure response bodies from failures.

Only the selected child processes receive `AZ_LIVE_TESTS=1`; normal tests skip the
live checks. The command does not select the resource-creating Azure suites.

These checks do **not** prove completed native device-code login, native refresh,
MFA/consent, sovereign-cloud access, Graph permissions, or sign-out of a real
account. Native session races, refresh, expiry, and sign-out remain covered by
deterministic offline tests. A full delegated native login can require human
interaction under tenant policy and cannot be made universally unattended.
