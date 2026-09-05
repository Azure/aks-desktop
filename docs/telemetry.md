# Telemetry in AKS Desktop

AKS Desktop sends a small amount of pseudonymous usage data to Microsoft to
help us find crashes, fix broken workflows, and decide what to build next.

This page lists everything that is collected, everything that is not, and how
to turn it off. It is written to be complete: if something is sent, it is
described here.

## Turning it off

Telemetry is **on by default**. To turn it off, open **Settings**, find the
**AKS Desktop** plugin settings, and switch off **Send pseudonymous usage
data**.

You can change this as often as you like. When you change it, we record that
the setting changed — see [Telemetry setting changes](#telemetry-setting-changes)
below — and nothing further.

## What we collect

Everything below is drawn from a fixed list defined in the source code. The
application cannot send an event or a field that is not on that list — the
check is enforced in code and covered by tests, not by convention. The list
lives in
[`plugins/aks-desktop/src/telemetry/schema.ts`](../plugins/aks-desktop/src/telemetry/schema.ts).

### Session start

Sent once when the application starts.

| Field | Example | Why |
|---|---|---|
| `appVersion` | `1.4.0` | Tells us which release a problem belongs to |
| `headlampVersion` | `0.30.0` | Same, for the underlying Headlamp version |
| `os` | `darwin`, `win32`, `linux` | Which platforms need attention |
| `arch` | `x64`, `arm64` | Catches architecture-specific failures |
| `electronVersion` | `31.2.0` | Narrows down runtime-specific bugs |
| `locale` | `en`, `de` | Language only, never region or country |

### Cluster shape

Sent once per AKS cluster you open, describing its size and configuration.
It never contains the cluster's name, resource group, or subscription.

| Field | Example | Why |
|---|---|---|
| `provider` | `AKS` | Which platform the cluster runs on |
| `kubernetesMinor` | `1.29` | Major and minor version only, never the patch |
| `nodeCountBucket` | `6-20` | A range, never the exact count |
| `namespaceCountBucket` | `11-50` | A range, never the exact count |
| `region` | `eastus` | Where capacity problems cluster |
| `aksTier` | `Standard` | Whether behaviour differs by tier |

Counts are reported as ranges rather than exact numbers specifically so a
cluster cannot be recognised by its size.

### Feature use

Sent when you use a tracked feature. It records *which* feature and *whether it
worked* — never what you typed, selected, or named.

| Field | Example | Why |
|---|---|---|
| `feature` | `aksd.project-create` | Which feature was used |
| `status` | `opened`, `started`, `succeeded`, `failed`, `cancelled` | Whether it completed |
| `resourceKind` | `Pod`, `Deployment` | The *type* of object, never its name |

Tracked features are AKS Desktop workflows — creating and importing projects,
signing in and out, adding clusters, creating namespaces, deploying, deleting
projects — and common Kubernetes actions such as viewing logs, opening a
terminal, scaling, restarting, editing and deleting resources.

`resourceKind` is restricted to a fixed list of standard Kubernetes types.
Anything outside that list is reported as `CustomResource`, so the name of a
custom resource definition is never sent.

### Errors

Sent when something fails. It records the *category* of failure, never the
error message or stack trace.

| Field | Example | Why |
|---|---|---|
| `area` | `deploy`, `auth-login` | Which part of the app failed |
| `errorClass` | `NetworkError`, `TimeoutError`, `PermissionError` | What kind of failure |
| `phase` | `started`, `failed` | Where in the workflow it happened |

`errorClass` is one of six fixed values. Error text is never inspected to pick
one, because doing so risks copying message content into the field.

Repeated failures of the same kind are capped, so a persistent error produces a
handful of events rather than a flood.

### Installed plugins

Sent once per session, describing how many plugins are installed.

| Field | Example | Why |
|---|---|---|
| `totalCount` | `4` | How many plugins are installed |
| `enabledCount` | `3` | How many are turned on |
| `knownEnabledIds` | `aks-desktop` | Which *Microsoft* plugins are enabled |
| `thirdPartyCount` | `2` | How many third-party plugins, as a count only |

Third-party plugins are counted but never named.

### Telemetry setting changes

Sent when you turn telemetry on or off.

| Field | Example | Why |
|---|---|---|
| `consent` | `granted`, `revoked` | Whether telemetry was switched on or off |

**One event is sent immediately after you turn telemetry off.** We are calling
that out rather than leaving it to be discovered: it is the only way to know
how many people opt out, which is something we hold ourselves accountable to.
It carries the single field above and nothing else, and no further events are
sent afterwards.

## What we never collect

None of the following is sent, in any event or field:

- **Your name, email address, or Azure account details.**
- **Cluster, resource group, or subscription names**, or any Azure resource ID.
- **Namespace, application, or Kubernetes resource names.**
- **Kubeconfig contents or any credential, token, or secret.**
- **Application content** — logs, terminal output, YAML, environment
  variables, or anything from inside your workloads.
- **Error messages or stack traces.**
- **File paths or URLs.**
- **Your IP address.** It is explicitly discarded rather than merely unused.
- **Your location.** Country, state and city are removed. The cluster's Azure
  region is collected, which describes where the cluster runs, not where you
  are.
- **What you type**, anywhere in the application.

## How this is enforced

Rather than relying on care alone, the application constrains itself:

- **Fixed lists.** Every event name and field name is checked against a list
  in code. An unlisted field is dropped before sending. Tests pin the exact
  contents of those lists, so adding one is a deliberate, reviewable change.
- **Fixed values.** Fields like error class, status and cluster tier accept
  only known values; anything unrecognised becomes a safe default or is
  dropped rather than passed through.
- **Outbound filter.** Every event passes a final check that removes anything
  resembling a file path, URL, Azure resource ID, or location before it is
  sent — a backstop in case something slips past the earlier stages.
- **Ranges instead of counts**, and version numbers truncated to major and
  minor.
- **No cookies, no browser storage** used for tracking, and no automatic
  page-view tracking.

## The installation identifier

A random identifier is generated the first time the application runs and stored
on your device. It is attached to events so we can tell "one installation used
this feature ten times" from "ten installations used it once" — a distinction
that matters for nearly every question we ask of this data.

It is a random value. It is not derived from your name, account, email,
machine name, or hardware, and it is not combined with anything that could
identify you. We cannot use it to work out who you are.

If you turn telemetry off, it stops being sent.

## Where the data goes

Data is sent over an encrypted HTTPS connection to Microsoft's Azure
Application Insights service, batched in the background so it does not slow the
application down. It is handled under Microsoft's privacy practices, including
GDPR and CCPA obligations, and is kept only for a limited retention period.

See the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

## Questions

If something here is unclear, or you think the application is sending
something this page does not describe, please
[open an issue](https://github.com/Azure/aks-desktop/issues). We would treat
that as a bug.
