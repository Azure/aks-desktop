# AKS Desktop telemetry privacy contract

AKS Desktop telemetry is limited to product-health and aggregate usage events. The plugin must
emit telemetry only through the typed wrappers in `plugins/aks-desktop/src/telemetry/`.

## Approved events

| Event | Approved custom dimensions |
| --- | --- |
| `headlamp.session-start` | `appVersion`, language-only `locale`, `os`, `arch`, `electronVersion`, `headlampVersion` |
| `headlamp.cluster-shape` | `provider`, minor Kubernetes version, bucketed node and namespace counts, sanitized Azure region, AKS tier |
| `headlamp.feature` | closed `feature`, closed `status`, optional sanitized Kubernetes `resourceKind` |
| `headlamp.exception` | `appVersion`, closed `area`, closed `errorClass`, optional closed `phase` |
| `headlamp.plugins-loaded` | aggregate counts and allowlisted first-party plugin IDs |

The SDK envelope may also contain the pseudonymous installation ID in `ai.user.id`, a sanitized
constant route in `ai.operation.name`, and `ai.location.ip = 0.0.0.0` to suppress source-IP
geolocation. Automatic route, AJAX, fetch, and exception tracking remain disabled.

## Prohibited data

Do not add free-form telemetry properties. Telemetry must never contain:

- Error messages, stack traces, causes, exception objects, or raw backend responses.
- Filesystem paths, URLs, command arguments, or CLI standard output/error.
- Tenant, subscription, resource-group, cluster, resource, application, repository, account, or
  namespace names and identifiers.
- Kubernetes object payloads, HTTP bodies, secrets, tokens, or connection strings.
- Geographic country, state/province, or city dimensions.

The runtime scrubber is a final defense, not permission to pass unsafe values into telemetry.
Call sites must construct events from the closed vocabularies in `telemetry/schema.ts`.

## Ingestion-owned fields

`_ResourceId` and `appName` are stamped by Application Insights ingestion from the destination
resource. They cannot be removed by a browser telemetry initializer. If those fields expose an
unacceptable Azure resource hierarchy, move telemetry to a destination whose resource and
application names satisfy the privacy policy, or apply an approved ingestion/export
transformation outside this repository.

Client changes alone must not be reported as resolving those ingestion-owned fields.

## Verification

Use a synthetic workflow and a narrow UTC time window. Never paste real stored rows into issues,
tests, or documentation.

1. Build through the root `plugin:setup` path with Node 20.
2. Confirm the built plugin contains the real AKS Desktop and Headlamp versions and no `unknown`
   version fallback.
3. Restart the Electron application, perform only synthetic activity, and wait for SDK batching.
4. In the Network panel, inspect the `/v2/track` request and confirm HTTP 200.
5. Inspect every serialized envelope in the batch. Confirm event names and custom dimensions match
   the allowlist above, `ai.operation.name` is a fixed route bucket, and `ai.location.ip` is
   `0.0.0.0`.
6. Confirm the outgoing batch contains no resource hierarchy, customer names, local usernames or
   paths, URLs, geographic tags, error text, stack traces, or command output.
7. Query the same narrow window in Application Insights and inspect the complete stored test rows.
8. Confirm stored rows contain only approved client fields. Treat `_ResourceId` and `appName` as an
   external infrastructure finding until the destination or ingestion configuration is changed.
9. Trigger representative synthetic render and asynchronous failures. Confirm only one categorical
   error event is recorded at the intended boundary and automatic exceptions are absent.

Dashboard queries that follow this contract are documented in
[`telemetry-dashboard.md`](./telemetry-dashboard.md).
