# Native Upgrade Insights (Preview)

Upgrade Insights is part of the shipped **AKS Desktop** plugin, not an additional
plugin or a standalone web application. Enable **Upgrade Insights** under
**Settings → AKS Desktop → Preview Features**. It is off by default. Both direct
navigation and sidebar visibility honor the preview setting, and registration is
limited to the desktop application.

## Azure account and subscriptions

1. Sign in through AKS Desktop's existing **Azure Account** flow.
2. Open **Upgrade Insights** from the Home sidebar. No Kubernetes context or
   Kubernetes API connection is required to browse Azure inventory.
3. Explicitly choose one or more enabled subscriptions, then select **Load
   selected subscriptions**. Nothing silently uses the CLI's default subscription.
4. Search the inventory by cluster, ARM ID, subscription, resource group, region,
   environment, or fleet name. Region and inventory sorting apply before
   pagination. Readiness counts, risk filters, readiness sorting, and CSV export
   apply only to the current page; they are not fleet-wide readiness totals.
   Turning readiness sorting off restores the selected inventory order in both
   the table and CSV export.
5. Select the exact cluster ARM resource to inspect its stored evaluations.

The cluster-sidebar route requires an explicit ARM-resource selection as well.
Existing registration metadata may narrow candidates by subscription and
resource group, but it does not supply a complete ARM identity. Even one
candidate is never automatically selected by its display name or context name.
Arc-connected contexts are not mapped to similarly named managed AKS clusters.
Selections last only for the current authenticated page session.

Requests use the native Azure transport and existing Azure authentication;
there is **no bridge server, localhost service, demo provider, additional plugin
installation, or separate token entry**. Account/logout events unmount the
provider immediately, cancel in-flight inventory/detail/target/generation reads,
and discard subscription selection, readiness, and provider state. A late
response from an old account cannot populate the new session.

## Readiness is a snapshot

Inventory uses the latest combined control-plane/all-pools evaluation, without
merging independent stored scopes. Cluster details can select other stored
evaluations, including NodeImage, then inspect each evaluated scope's issues,
impacted resources, remediation guidance, version support, maintenance context,
timestamps, and raw response.

Missing evaluations, unknown statuses or severities, incomplete inventory, expired
or invalid timestamps, snapshots older than 24 hours, and changed source versions
are **not Ready**. Freshness is reassessed every minute. A fresh Ready snapshot is
not a guarantee that a later upgrade will succeed. Errors and partial inventory
are shown explicitly; failures never substitute synthetic successful results.
Fleet-read failures are separate from cluster-read failures, and unknown fleet
membership is not treated as confirmed standalone membership.

The provider caches stored insights in memory for 60 seconds. **Refresh inventory
and current page** invalidates stored insights once and re-reads Azure. Subsequent
navigation, filtering, and detail views can reuse the refreshed cache. Readiness
data is not persisted in local storage. CSV export is an explicit local download;
review resource IDs and issue details before sharing it.

## Generate is not upgrade

Kubernetes targets come from the API for the exact selected control-plane or
node-pool scope. NodeImage does not depend on Kubernetes target discovery and
never sends a Kubernetes target. Its optional image-version field can be left
empty to ask Azure to evaluate the latest available image.

**Review generation request** does not write anything. The confirmation dialog
shows the exact ARM cluster, scope, target, request JSON, and POST endpoint:

```text
POST {clusterArmId}/generateUpgradeInsights?api-version=2026-08-02-preview
```

Only **Confirm POST and generate** writes or replaces a stored insight.
Submission and editing controls are disabled while the request is in flight.
The native provider verifies the generated insight by GETting the exact returned
resource ID; the UI does not issue a duplicate verification GET or claim success
when verification fails. Cancelling an HTTP request cannot undo a POST already
accepted by Azure; after an ambiguous error, refresh before retrying.

This feature never starts a Kubernetes or node-image upgrade, applies remediation,
mutates workloads, or registers Azure preview features. Remediation actions are
informational. Documentation links open only allowlisted HTTPS hosts
(`learn.microsoft.com`, `aka.ms`, `kubernetes.io`) without credentials or unusual
ports, with `noopener noreferrer`.

## API access and validation

Upgrade Insights uses preview API version **`2026-08-02-preview`**. The account
needs Azure RBAC permissions to list/read the selected managed clusters and their
stored upgrade insights and upgrade profiles. Optional fleet/member reads need
their own permissions. Generation additionally needs permission for the managed
cluster's `generateUpgradeInsights` action; read access does not imply write
access. Subscription, tenant, API availability, and authorization errors are
surfaced, not bypassed. Kubernetes RBAC does not grant these Azure permissions.

Co-located Vitest/React Testing Library tests mock native dependencies and cover
the feature/auth gates, subscription choice/errors, partial inventory,
conservative freshness, page scoping, explicit context disambiguation, safe
remediation links, target selection, POST confirmation, errors, refresh, request
cancellation, and account isolation. Mocked tests are not evidence of live API
availability or a successful production evaluation.

For native visual review, the existing Storybook includes
**UpgradeInsights/ReadinessInventory → Light / Dark**. These pure-component
stories use clearly labeled Storybook-only fixtures and make no Azure calls.
They are not shipped default data or evidence of live API behavior.

## Provenance

Domain behavior and UX were adapted from
[`swgriffith/headlamp` commit `23e1dd44da9968077edb4c6614d39a5ab5db54e6`](https://github.com/swgriffith/headlamp/commit/23e1dd44da9968077edb4c6614d39a5ab5db54e6)
and the prototype associated with
[Headlamp PR #8162](https://github.com/kubernetes-sigs/headlamp/pull/8162).
The native integration uses AKS Desktop's MUI/theme, translation, configuration,
telemetry boundary, and Azure account/transport rather than the prototype's CSS,
standalone provider setup, or demo data.
