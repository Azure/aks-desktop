# AKS Desktop theme

An independent Headlamp plugin containing AKS Desktop presentation and branding:

- Azure color palette, registered as the default only when there is no saved
  theme preference or forced host theme
- App logo and cluster empty-state logo (preserves Headlamp's cluster actions)
- AKS documentation and contact links in the desktop Help menu
- Contact action in the desktop app bar, including the narrow-screen overflow menu

The plugin does not import the functional AKS plugin, run commands, or initialize
telemetry. Contact clicks publish `aksd.feedback` through Headlamp's Redux event
stream; the AKS plugin observes them only with telemetry consent.

## Development

```bash
npm install
npm run tsc
npm run lint
npm test
npm run build
npm start
```

The root development command watches both the functional and theme plugins.
Release builds include this plugin through `package.json#headlamp.plugins`.

## Using Headlamp's default appearance

Disable `aks-desktop-theme` in Headlamp's plugin settings and reload, or omit its
entry from the product's `headlamp.plugins` list before assembling a distribution.
Keep `aks-desktop` enabled for Azure authentication, cluster registration, projects,
and other AKS workflows. No replacement theme plugin is required.

This separation concerns plugin-owned UI. Native application names, installer
icons, and product error illustrations remain product-manifest settings.

Translations are maintained in this plugin's locale directory and in
`Localize/locales/*/aks-desktop-theme-translation.json`.

## Packaged application validation

After building the application, run `npm run test:packaged-theme` from the
repository root (`xvfb-run --auto-servernum npm run test:packaged-theme` on
headless Linux). Set `AKS_DESKTOP_EXECUTABLE` to test another packaged executable.

The tests launch the real packaged Electron application with isolated profile,
kubeconfig, and Azure configuration directories. They toggle the theme through
Settings and Save & Apply, verify colors, app/empty-state logos and native Help
menus after reload, and check that AKS workflows and explicit theme preferences
survive disabling, re-enabling and restarting the application.
Azure CLI telemetry is disabled for these tests. Profile cleanup uses bounded
filesystem retries while Windows subprocesses release log handles; persistent
cleanup failures still fail the test.

Headlamp [#8095](https://github.com/kubernetes-sigs/headlamp/pull/8095) resets native
menus when each renderer document loads, so disabling the branding plugin cannot
leave its Help links behind. The pinned Headlamp source already includes merged
[#7655](https://github.com/kubernetes-sigs/headlamp/pull/7655), which waits for the
confirmed backend port and launch token before rendering. This also keeps the
packaged tests isolated from other running Headlamp instances.

Dependency lockfile tests require SHA-512 integrity for every theme dependency.
