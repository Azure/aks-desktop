# Telemetry in AKS Desktop

## Turning it off

Telemetry is **on by default**. To turn it off, open **Settings**, find the
**AKS Desktop** plugin settings, and switch off **Send pseudonymous usage
data**. No restart is required.

Opting out immediately gates new ordinary telemetry events. The client attempts
to send a `revoked` consent event and flush events already buffered in the SDK,
then disables and unloads the SDK. The consent event and buffered events still
include the common metadata described below. Delivery is best-effort, so opting
out does not mean exactly one event is delivered or that all outgoing traffic
stops at the instant of the click.

Switching the setting back on initializes telemetry again and resumes collection.
See [Telemetry setting changes](#telemetry-setting-changes) for the transition
events.

## Scope

This page describes the AKS Desktop plugin's usage telemetry and client-side
filters. When enabled in the desktop app, the plugin sends custom events through
the Application Insights SDK. It is not an inventory of other plugins, external
feedback forms, or native crash reporting.

The custom event names, property names and value vocabularies are defined in
[`telemetry/schema.ts`](../plugins/aks-desktop/src/telemetry/schema.ts).
The custom-property allowlist does not cover every field in the SDK's serialized
envelope.

## Common metadata

Every event sent by an initialized client includes the application version as
`appVersion`, in addition to its event-specific properties. The client also adds:

- `ai.user.id`: a randomly generated installation identifier, described below.
- `ai.operation.name`: a sanitized route category, not the original URL. Its
  values are `/index`, `/login`, `/profile`, `/projects`, `/project-create`,
  `/project-import`, `/namespace-create`, `/add-cluster`, `/settings`, or `unknown`.
- `ai.location.ip`: overwritten with `0.0.0.0` by the client initializer.

The SDK also adds envelope and context metadata, including event timestamps and
SDK version information. These are separate from the custom event properties.
The client scrubber removes the named country, province/state and city fields
listed in [`telemetry/privacy.ts`](../plugins/aks-desktop/src/telemetry/privacy.ts).

## Events and properties

### Session start

`headlamp.session-start` is emitted when telemetry initializes successfully.
This includes initialization after switching telemetry back on during a session,
not just application startup. Starting with telemetry disabled does not emit it.

| Field             | Example                    | Description                                       |
| ----------------- | -------------------------- | ------------------------------------------------- |
| `appVersion`      | `1.4.0`                    | Application version                               |
| `headlampVersion` | `0.30.0`                   | Underlying Headlamp version                       |
| `os`              | `darwin`, `win32`, `linux` | Runtime platform                                  |
| `arch`            | `x64`, `arm64`             | Architecture inferred from the runtime user agent |
| `electronVersion` | `31.2.0`                   | Electron version parsed from the user agent       |
| `locale`          | `en`, `de`                 | Language portion of the locale, without region    |

Application, Headlamp and Electron version strings retain their patch versions.

### Cluster shape

`headlamp.cluster-shape` is emitted from the AKS project overview when project
labels, cluster capabilities, node data and namespace data are available. The
client deduplicates it by Azure resource ID for the lifetime of the loaded
telemetry module, including across opt-out/opt-in cycles. The deduplication ID
itself is not included in the event.

| Field                  | Example    | Description                                                                      |
| ---------------------- | ---------- | -------------------------------------------------------------------------------- |
| `provider`             | `AKS`      | Fixed provider value                                                             |
| `kubernetesMinor`      | `1.29`     | Kubernetes major and minor version only                                          |
| `nodeCountBucket`      | `6-20`     | `0`, `1-5`, `6-20`, `21-100`, or `100+`                                          |
| `namespaceCountBucket` | `11-50`    | `0`, `1-10`, `11-50`, `51-200`, or `200+`                                        |
| `region`               | `eastus`   | Cluster's Azure region, checked against a region-name pattern; otherwise `Other` |
| `aksTier`              | `Standard` | `Free`, `Standard`, `Premium`, or `Unknown`                                      |

Positive counts are ranges; zero is reported as `0`. Only the Kubernetes version
is truncated to major and minor.

### Feature use

`headlamp.feature` records a tracked action and its status. It does not include
resource names or the contents of logs, terminals, edited resources or forms.

| Field          | Example               | Description                                   |
| -------------- | --------------------- | --------------------------------------------- |
| `feature`      | `aksd.project-create` | One of the tracked feature names below        |
| `status`       | `opened`, `succeeded` | One of the shared status values below         |
| `resourceKind` | `Pod`, `Deployment`   | Optional Kubernetes object type, not its name |

The tracked AKS Desktop features are:

| Feature                 | Action                   |
| ----------------------- | ------------------------ |
| `aksd.project-create`   | Project creation         |
| `aksd.project-import`   | Project import           |
| `aksd.deploy`           | Deployment               |
| `aksd.auth-login`       | Azure sign-in            |
| `aksd.auth-logout`      | Azure sign-out           |
| `aksd.cluster-add`      | Cluster registration     |
| `aksd.namespace-create` | Namespace creation       |
| `aksd.project-delete`   | Project deletion         |
| `aksd.feedback`         | App-bar Contact us click |

The Contact us action records `opened` after attempting external navigation. It
does not confirm that the destination loaded or record feedback form contents or
submission.

The Headlamp actions forwarded by the plugin are `headlamp.create-resource`,
`headlamp.edit-resource`, `headlamp.delete-resource`, `headlamp.delete-resources`,
`headlamp.scale-resource`, `headlamp.restart-resource`,
`headlamp.restart-resources`, `headlamp.rollback-resource`, `headlamp.logs`,
`headlamp.terminal`, `headlamp.pod-attach`, `headlamp.plugin-loading-error`,
`headlamp.details-view`, `headlamp.list-view`, and `headlamp.object-events`.

The shared status vocabulary is `unknown`, `open`, `closed`, `confirmed`,
`finished`, `opened`, `started`, `succeeded`, `failed`, `cancelled`, and
`completed`. Not every action emits every status; some have no success/failure
result. Partial project imports, for example, use `completed`.

`resourceKind` uses the fixed built-in kind list in the schema. Other kind names
become `CustomResource`; missing kind input can become `Unknown`, and mixed-kind
batch actions use `Multiple`. Producers can omit the field when no resource kind
is available. Custom resource-specific kind names are not forwarded.

### Errors

`headlamp.exception` records a categorical failure, not an error message or
stack trace.

| Field        | Example                | Description                                      |
| ------------ | ---------------------- | ------------------------------------------------ |
| `area`       | `deploy`, `auth-login` | One of the areas below                           |
| `errorClass` | `NetworkError`         | One of the six classes below                     |
| `phase`      | `failed`, `completed`  | Optional value from the shared status vocabulary |

Areas are `project-create`, `project-import`, `deploy`, `kubernetes`, `plugin-ui`,
`auth-login`, `auth-logout`, `cluster-add`, `namespace-create`, and
`project-delete`. Classes are `AuthenticationError`, `PermissionError`,
`NetworkError`, `ValidationError`, `TimeoutError`, and `UnknownError`.

The client caps errors at five events per area/class pair for the lifetime of
the loaded telemetry module. Opting out and back in does not reset that quota.

### Plugin-load snapshot

`headlamp.plugins-loaded` describes the entries supplied by Headlamp's
`PLUGINS_LOADED` notification. Headlamp builds that snapshot from entries marked
`isLoaded`; it is not a complete inventory of every installed or disabled plugin.
The telemetry bridge has no separate once-per-session delivery latch.

| Field             | Example       | Description                                                         |
| ----------------- | ------------- | ------------------------------------------------------------------- |
| `totalCount`      | `4`           | Number of entries in the supplied snapshot                          |
| `enabledCount`    | `3`           | Number of snapshot entries marked enabled                           |
| `knownEnabledIds` | `aks-desktop` | Enabled IDs in the fixed known-ID set, currently only `aks-desktop` |
| `thirdPartyCount` | `2`           | Enabled entries outside that known-ID set                           |

These counts are exact, not bucketed. The known-ID set is not a publisher check:
`thirdPartyCount` does not establish who published those plugins. Names outside
the known-ID set are not included.

### Telemetry setting changes

`headlamp.telemetry-consent` is attempted when the enabled setting transitions
on or off, with `consent` set to `granted` or `revoked`. Like other events, it
includes common metadata; `consent` is not its entire payload.

Ordinary application startup is not a consent transition. A mid-session grant
can also emit session-start and allow cluster-shape collection when data becomes
available, subject to the existing deduplication state. A revoke gates new
ordinary events, attempts the revoke event and flushes the SDK backlog before
unloading. Events may be dropped if initialization or transport fails.

## Client-side data restrictions

The typed telemetry producers and the Redux event bridge do not forward account
details, cluster/resource-group/subscription names, Azure resource IDs, namespace
or resource names, kubeconfig contents, credentials, logs, terminal output, YAML,
application content, raw form input, error messages or stack traces.

The client applies these restrictions:

- Custom event names and custom property keys are checked against fixed lists.
  Unlisted names are rejected and unlisted properties are dropped. Tests pin
  these lists.
- Feature names, resource kinds, status, consent, error class, error area and
  cluster tier are checked or mapped to defined values.
- The outbound scrubber recursively removes defined path/URL/Azure-resource-ID
  patterns and named geographic fields. Approved route categories are retained.
  This is a pattern/key filter, not a general detector for arbitrary sensitive
  text.
- The Application Insights SDK's automatic fetch, AJAX, exception and route
  tracking are disabled. SDK cookies and SDK browser storage are disabled too.
  The plugin's own installation identifier does use localStorage.

## The installation identifier

On enabled telemetry initialization, the plugin reads or creates a random UUID
in renderer localStorage. The UUID is attached as `ai.user.id` so events from
that stored identifier can be correlated. It is generated with
`crypto.randomUUID()`, not derived from an account, machine name or hardware.

A valid stored UUID is reused. An invalid stored value is replaced. If storage
is unavailable, the UUID is kept only in module memory for that session.

Opting out gates new ordinary events, but the revoke event and already-buffered
events can still carry the identifier while the client flushes. The stored UUID
is not deleted by the telemetry toggle.

## Transport and source

The plugin configures the Application Insights SDK and its background batching.
The client implementation is in
[`telemetry/index.ts`](../plugins/aks-desktop/src/telemetry/index.ts),
[`telemetry/consent.ts`](../plugins/aks-desktop/src/telemetry/consent.ts), and
[`telemetry/privacy.ts`](../plugins/aks-desktop/src/telemetry/privacy.ts).
