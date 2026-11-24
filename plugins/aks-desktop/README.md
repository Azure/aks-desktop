# AKS Desktop Headlamp plugin

The AKS Desktop plugin adds Azure and AKS workflows to Headlamp.

Application branding lives in the independent
[aks-desktop-theme plugin](../aks-desktop-theme/README.md). Without that plugin,
AKS workflows use Headlamp's default theme, logo, empty state, and Help menu.

## Upgrade Insights preview

The native Upgrade Insights UI is disabled by default in **Preview Features**.
It uses the existing Azure Account login and native Azure HTTP transport; no
standalone plugin or bridge installation is needed. Users explicitly choose
subscriptions to browse readiness, inspect stored scoped evaluations, and
confirm generation of a new stored insight. It never initiates an upgrade.
See the [feature guide](src/components/UpgradeInsights/README.md) for permissions,
the preview API contract, account isolation, and provenance.

## Azure sign-in and reloads

Native Azure credentials remain in memory and require sign-in again after an app
reload. The plugin stores only a non-secret policy to prevent silently switching
to an unrelated Azure CLI account after native sign-in or sign-out. A fresh
installation still supports the existing CLI account, and the CLI sign-in option
can explicitly restore CLI fallback.

If application storage is unavailable, implicit CLI fallback is blocked and
native sign-in cannot start safely. If storage fails during sign-out, the
in-memory session is cleared but the policy may not survive a reload; sign out
of Azure CLI manually and restore application storage.

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
