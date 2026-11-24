# Developer Cluster plugin for AKS Desktop

Status: **Preview; not published.** Version `0.1.0-alpha`.

Developer Cluster lets an AKS Desktop user create one local AKS cluster on a Windows PC, open it in AKS
Desktop and delete it. The cluster runs in WSL2 on Ubuntu 24.04 and is created by the AKS Devctl
CLI (`aks-devctl`). No Azure sign-in is needed.

This package is the standalone plugin. AKS Desktop grants and runs the CLI commands; the CLI
writes and removes the cluster's kubeconfig entries; the plugin provides the guided workflow.

## What it does

1. **Introduction.** What Developer Cluster is and what the PC needs, with a **Set up Developer Cluster** action.
2. **Environment checks.** Read-only checks of Windows and WSL2. Ubuntu 24.04 is downloaded and
   installed as a new WSL instance named after the cluster only after the user explicitly agrees.
3. **Configuration.** A validated cluster name and a Kubernetes release chosen from the releases
   the CLI reports. The fixed settings are shown read-only.
4. **Review.** **Create Cluster** is the first action that changes the PC.
5. **Creating your Developer Cluster.** One progress message until AKS Desktop confirms the
   cluster is usable, with a note that the first create downloads components for 10-15 minutes.
6. **Overview.** After a successful Create, **Go to Overview** opens it. It shows the cluster's
   name, Kubernetes version and status, **View**, and **Delete** at the bottom of the page.
   **Delete** in the cluster's Actions menu on AKS Desktop's Home starts the same Delete after a
   confirmation and opens Overview, which shows the progress.

AKS Desktop owns discovering and installing Developer Cluster, and the standard cluster views that
**View** leads to. The plugin has no catalog, kubeconfig viewer or Kubernetes resource browser of
its own.

## AKS Devctl CLI interface

AKS Desktop runs three `aks-devctl` commands for the plugin, in the exact shapes it grants. Each
passes `--output json`, and the plugin reads the final `result` event:

* `cluster get-versions`: the Kubernetes versions offered in Configure.
* `cluster create --kubernetes-distribution K8s --name <name> --kubernetes-version <version>`,
  plus `--enable-gpu` for a GPU cluster.
* `cluster delete --name <name> --yes`, only after the plugin's confirmation dialog.

The CLI marks the context it writes with `context_info.managedBy: aks-devctl`; the plugin finds
its cluster that way and reads its name, Kubernetes version and image from the same
`context_info`. The source of truth is the code: [src/cli/commands.ts](src/cli/commands.ts)
(argv and result checks), [src/cli/runner.ts](src/cli/runner.ts) (output and failure codes) and
[src/contract/devctl.ts](src/contract/devctl.ts) (the context metadata).

## Support boundaries

* Windows x64 with WSL2 only. The cluster runs in a cluster-named WSL distribution created from
  Ubuntu 24.04.
* One Developer Cluster per PC: Setup is blocked while one is registered. Each cluster has its
  own WSL instance, named after the cluster.
* Fixed topology: driver `wsl`, distribution `K8s`, CNI `cilium`, one node, reach `shared`,
  control-plane IP `off`. The CLI takes the provider, distro, reach and control-plane IP from
  its settings, whose defaults are these values; the plugin passes only
  `--kubernetes-distribution K8s`.
* Runs only inside an AKS Desktop build that grants the plugin the `aks-devctl` commands. When
  the browser reports a platform other than Windows x64, the environment step blocks Setup;
  without the grants, a command fails with a fixed `unavailable` or `denied` sentence.
* The plugin never downloads, installs or updates the AKS Devctl CLI at runtime. The package does
  not contain the CLI yet; release packaging provides a signed CLI at `bin/aks-devctl.exe`.
* Create automatically merges the cluster's context into the user's default kubeconfig
  (`%USERPROFILE%\.kube\config`, ignoring `KUBECONFIG`) and makes it the current context
  (`cluster create`). The plugin never opens the file and never replaces a conflicting entry,
  so an existing context with the same name fails Create.
  The plugin finds the cluster among the contexts AKS Desktop loaded, by the mark the CLI writes
  in its `context_info` (`managedBy: aks-devctl`). Clusters made by CLIs before 2026-11-06, which
  wrote no such mark, are not recognized; delete them with that CLI before installing this plugin.
* Delete, after a confirmation dialog, removes the cluster's WSL instance and everything in it,
  then the cluster's entries in the default kubeconfig. Other WSL distributions are not touched.
  The plugin then asks AKS Desktop's backend to drop the cluster from its list
  (`DELETE /cluster/{name}`, by the name the list shows) without changing any file, because
  AKS Desktop's kubeconfig watcher can miss a removal that the CLI writes by replacing the file.
  The Home list follows at its next refresh.
* Create can enable an NVIDIA GPU; Configure lists the hardware it needs. Other GPUs are not
  supported.
* Not supported: more than one cluster, Arc connection, Kubernetes upgrades, editing, stopping or
  starting a cluster, and any other driver, distribution or CNI.
* Preview: not for production workloads. The CLI writes a kubeconfig that does not verify the
  local API server certificate.

Values that are not decided yet appear in files as `UNRESOLVED: <what>`, including values that are
only known when a release is cut, such as the archive checksum. Nobody replaces a placeholder with
an invented value.

## Build, test and package

```sh
npm ci
npm run lint
npm run tsc
npm run i18n            # rewrites locales/en/translation.json from the t() calls in src/
npm test                # Vitest tests under src/; watches in a terminal, press q to quit
npm run build           # dist/main.js, dist/locales/, dist/LICENSE
npm run package         # build, then headlamp-plugin package
```

`npm run package` rebuilds `dist/` and runs the SDK's `headlamp-plugin package`, which writes
`headlamp-k8s-developer-cluster-0.1.0-alpha.tar.gz` in this folder and prints its SHA-256. The
archive holds, in a `developer-cluster/` folder, `package.json` and everything the build writes to
`dist/`: the bundle `main.js` (the build empties `dist/` first and writes no source maps; only
`npm start` does), every file under `locales/`, any `public/` folder (there is none), and
`LICENSE` from `headlamp.extraDist` in `package.json`. `src/contract/releaseMetadata.test.ts` keeps
that `extraDist` entry, because the SDK only warns when it is missing. Nothing checks the archive
itself: never add the CLI, a kubeconfig, credentials or an installation receipt to `src/`,
`locales/`, `public/` or `headlamp.extraDist`, and keep `locales/` to
`<language>/translation.json` files.

The SDK refuses to overwrite an existing archive, so delete the old one first. The archive records
the build machine's owners, timestamps and permissions, so it is not reproducible and two builds of
the same source can have different SHA-256 values. Publish each version once, and set the Artifact
Hub checksum from the archive that is published ("Artifact Hub metadata").

### Verify a local draft without CI or cluster E2E

Use this flow to check a developer change before release automation is available. It does not
require an Artifact Hub listing, Azure sign-in, a CI run, or creating/deleting a cluster.

| Level | What it proves | What it does not prove |
|---|---|---|
| Build, tests and package | The source builds, mocked tests pass and the SDK writes the plugin archive | Desktop permissions, actual CLI execution or cluster lifecycle |
| Optional Desktop load check | A compatible Desktop build can load the staged plugin and render its entry pages | Catalog installation, production artifact acquisition or successful cluster creation |
| Release / E2E qualification | Separate release and lifecycle evidence | Not replaced by either draft check above |

#### 1. Build from the source directory

Run the commands in [Build, test and package](#build-test-and-package) from
`Developer-Cluster-Plugin/developer-cluster`, with Node.js/npm supported by the pinned plugin SDK.
Stop at the first failed command. The source checkout must contain `src/` and
`package-lock.json`; the extracted preview ZIP is a runtime bundle, not a build checkout.

The unit/component tests mock Headlamp and CLI calls. These commands do not start Desktop, WSL,
devctl or a cluster. `npm run package` prints the archive's SHA-256. To record it in PowerShell
after a successful package:

```powershell
$version = (Get-Content -Raw .\package.json | ConvertFrom-Json).version
$archive = Join-Path $PWD "headlamp-k8s-developer-cluster-$version.tar.gz"
Get-FileHash -LiteralPath $archive -Algorithm SHA256
```

A draft needs no publication metadata: leave the `UNRESOLVED` placeholders and do not
invent URLs, signers or compatibility values. Do not add a CLI executable to this archive.

#### 2. Optionally load the draft in a compatible Desktop preview

This Windows recipe uses an existing, approved Developer Cluster preview bundle with this layout:

```text
Developer-Cluster-Preview\
  app\AKS desktop.exe
  plugin\developer-cluster\main.js
  plugin\developer-cluster\package.json
  plugin\developer-cluster\bin\aks-devctl.exe
  Start Developer Cluster Preview.cmd
```

The ZIP is a full local integration bundle: Desktop, a compiled plugin, a staged CLI and a
launcher. It is not the plugin-only catalog archive. Obtain the matching Desktop/CLI pair from
the integration owner; an arbitrary installed Desktop or an old preview may not grant the new
plugin's command shapes. Do not weaken command permissions to make a draft load.

1. Close the preview app normally. Make a separate copy of the approved bundle, for example
   `C:\DeveloperClusterDraft\Developer-Cluster-Preview`. Keep the original unchanged.
2. In the copy, rename `plugin\developer-cluster` to `plugin\previous-plugin`. This preserves
   the original plugin and its approved CLI without overlaying stale assets.
3. Extract the plugin-only archive into the copy's `plugin` directory. Its
   `developer-cluster` top-level directory supplies the new `main.js`, `package.json`, `LICENSE`
   and `locales`.
4. If the draft uses the same CLI contract as the approved bundle, copy
   `plugin\previous-plugin\bin` into `plugin\developer-cluster\bin`. Otherwise obtain the
   corresponding approved CLI and host build before testing. The staged executable is for
   local testing only; it must not be added back into the plugin-only archive.
5. In the copied launcher, use a fresh profile by changing its `PROFILE` assignment, for example
   to `set "PROFILE=%LOCALAPPDATA%\DeveloperClusterDraftProfile"`. Confirm that this launcher
   enables Plugin Development Mode and redirects both `USERPROFILE` and Desktop user data to
   that profile. Copying the bundle alone does not change the launcher's profile.
6. Run the copied `Start Developer Cluster Preview.cmd`. It stages the plugin into the preview
   profile's development-plugin location and starts the bundled Desktop. Open Developer Cluster
   and confirm the page renders. Missing WSL/prerequisite messages can be expected on a clean
   machine; do not install WSL merely to perform this load check.

For step 3, run this from the same PowerShell session that defined `$archive`; the destination
must be the fresh copy prepared above:

```powershell
tar -xf "$archive" -C "C:\DeveloperClusterDraft\Developer-Cluster-Preview\plugin"
if ($LASTEXITCODE -ne 0) { throw 'Draft plugin extraction failed.' }
```

For this check, stop before **Create**, **Delete**, guest installation, or update/cleanup scripts.
Opening pages may make read-only environment queries. A separate profile isolates app data and
kubeconfig paths, **not WSL guests or other machine-wide resources**. Use a disposable test
machine for later lifecycle testing. Record the source commit, Desktop/plugin/CLI versions,
archive hash and observed UI result; do not attach kubeconfigs, credentials or raw CLI output.

#### 3. Keep local verification separate from publication

No Artifact Hub upload is needed for either draft check. Artifact Hub indexes metadata that
points to an externally hosted plugin archive; it is not the archive upload destination.
A dev/prerelease label does not make an artifact private. Hosted `artifacthub.io` does not enable
[private repositories](https://artifacthub.io/docs/topics/repositories/#private-repositories).
Public experimental publication requires the approved repository, artifact location and release
metadata, plus the normal publication approvals. See the
[Headlamp repository format](https://artifacthub.io/docs/topics/repositories/headlamp-plugins/).
Local sideloading does not qualify catalog trust, signing, production installation or E2E behavior.

### Localization and dependency checks

`npm run i18n` is the SDK's `headlamp-plugin i18n`. It runs i18next-parser with the SDK's
configuration and rewrites `locales/en/translation.json` from the `t()` calls in `src/`; each key is
its English text. Nothing else checks translations. After you change shown text, run `npm run i18n`
and commit the change to `locales/`; `git diff --exit-code locales/` after `npm run i18n` shows
whether the file is up to date. Pass every shown string, including `title`, `aria-label` and `label`
values, to `t()` with a string literal key, and give each `{{name}}` placeholder a value; review
catches these. When `src/` no longer uses a key, the parser moves it to
`locales/en/translation_old.json`; delete that file before you commit. When the plugin moves to
`plugins/developer-cluster` in Azure/aks-desktop, register it with that repository's `translations`
CI job, which then regenerates the file, collects it into `Localize/` and fails when that changes
`Localize/`.

`npm ci` installs the packages that `package-lock.json` records. It fails when a dependency range in
`package.json` does not match the lock, or when a downloaded package does not match its integrity
hash. Nothing else checks the lock. `npm ci` does not require an integrity hash or a
`registry.npmjs.org` URL, and it installs git, `file:` and linked sources, so review every
`package-lock.json` diff for changed `resolved`, `integrity` and `link` fields.

## Artifact Hub metadata

The plugin is to be delivered as an Artifact Hub user plugin. Until then it ships as an early-access
zip installed as a development-location plugin.

[0.1.0-alpha/artifacthub-pkg.yml](0.1.0-alpha/artifacthub-pkg.yml) follows the per-version layout of
the `headlamp-k8s/plugins` repository. Its package name, logo, home page, maintainers, archive URL,
`version-compat`, checksum and creation date are `UNRESOLVED` placeholders until the publishing
repository is chosen. It has no `extra-files` entry: the plugin never downloads the CLI.

Before a release:

1. Replace every `UNRESOLVED` placeholder and remove the draft header comment.
2. Set `headlamp/plugin/archive-checksum` to `SHA256:<hex>`, the SHA-256 that `npm run package`
   printed for the archive that is published. Headlamp downloads the archive from
   `headlamp/plugin/archive-url`, checks it against this checksum and refuses the plugin when they
   differ; nothing else compares them, so after uploading, download the archive from that URL and
   compare its SHA-256 (`sha256sum`, or `Get-FileHash` on Windows) with the checksum.
3. Run Artifact Hub's `ah lint --kind headlamp` on the metadata folder. It checks the required
   fields, the SemVer version, the RFC 3339 `createdAt` and that both archive annotations are
   present; it does not compare the checksum with the archive.

Screenshots are added only after PM approves the UI.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Never attach kubeconfigs, credentials or raw CLI output to
an issue.

## License

Copyright (c) Microsoft Corporation. Licensed under the Apache License 2.0; see
[LICENSE](LICENSE), which ships in the plugin archive.
