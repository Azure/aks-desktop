# AKS Desktop Headlamp plugin

The AKS Desktop plugin adds Azure and AKS workflows to Headlamp.

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
