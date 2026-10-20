# AKS Desktop Headlamp plugin

The AKS Desktop plugin adds Azure and AKS workflows to Headlamp.

## Namespace settings cache

The project Info tab uses a plugin-owned TanStack Query client, independent of
Headlamp's internal cache. Managed namespace settings are keyed by Azure account
generation, subscription, resource group, cluster, and namespace name.

Settings stay fresh for 60 seconds and inactive entries expire after five
minutes. Reopening a fresh tab does not launch another Azure CLI read; stale
settings remain visible during background refresh. **Refresh** bypasses freshness.
Reads are deduplicated, with no automatic retries, polling, or focus/reconnect
refetches.

Refresh preserves unsaved edits and reports failures without hiding the editor.
Successful saves publish confirmed settings to the cache while preserving edits
made during the update. Label-preserving reads before updates are still required.
The tab supports AKS managed namespaces, not native Arc namespace settings.

Detected Azure account changes clear cached settings and drafts using the
existing authentication event and account-check flow. External CLI account
changes are detected on that flow's next check, not instantaneously. Discarding
an obsolete query result does not terminate an already-running Azure CLI process.

## Command policy

The plugin requests commands through `pluginRunCommand`, but it does not define
its own permissions. The product owner reviews and declares allowed commands in
the root `package.json#headlamp.runCommands` policy. Each policy selects the
runtime environment and plugin installation location, identifies this plugin by bundle and
package name, and lists allowed commands:

```json
{
  "environment": "production",
  "pluginLocation": "shipped",
  "plugins": [{ "bundleName": "aks-desktop", "packageName": "aks-desktop" }],
  "commands": [
    {
      "tool": "kubectl",
      "args": ["config"],
      "allowTrailingArgs": true
    }
  ]
}
```

Do not add `headlamp.runCommands` to this plugin's `package.json`. A plugin-owned
policy would let the plugin grant commands to itself. The Headlamp source
package copies the product-owned policy into the generated product manifest.

Headlamp validates the selected product policy and enforces it in Electron's
main process before starting a command.
