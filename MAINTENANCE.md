# Maintenance

## Headlamp source

AKS Desktop builds a pinned Headlamp commit from `packages/headlamp-source/`.
The root `package.json#headlampSource` is the source of truth. The setup scripts
copy Headlamp into the ignored `packages/headlamp-source/source/` directory.

The numbered files listed in `patches/series` are the patches we review and
maintain. npm combines them into the tracked
`patches/headlamp-source@<version>.patch` file.

### Update the Headlamp commit

Use a clean Headlamp checkout at the commit to adopt:

```bash
git -C /path/to/headlamp checkout <full-commit-sha>
npm run headlamp:source -- \
  --source /path/to/headlamp \
  --revision <full-commit-sha>
npm install
npm run test:headlamp-patches
npm run test:build
```

`headlamp:source` updates:

- `headlampSource.revision`
- the local package version and dependency
- `package-lock.json`
- the combined patch named for the package version

If a numbered patch no longer applies, rebase it as described below. If its
upstream PR is included in the new commit, remove it from `patches/series` and
delete its numbered patch before rebuilding the combined patch.

Commit the pin, package metadata, lockfile, series, numbered patches, and
combined patch together. Never edit the installed package in `node_modules`.

### Including new PRs as patches

Choose the next number and export the PR's commits from a clean Headlamp
worktree. Use the PR's base and head SHAs so original authorship and dates are
preserved:

```bash
git -C /path/to/headlamp format-patch --stdout --no-signature \
  <pr-base-sha>..<pr-head-sha> \
  > patches/0072-headlamp-upstream-<topic>.patch
```

Add the patch to `patches/series` in numeric order:

```text
0072 source 0072-headlamp-upstream-<topic>.patch
```

Use `source` for changes applied to Headlamp source. Use `package` only for
changes to the source-bearing npm package itself. Then regenerate and validate:

```bash
npm run headlamp:patches
npm install
npm run test:headlamp-patches
npm run test:build
```

When the upstream PR changes, regenerate the same numbered file and rerun these
commands. When it merges and the pin includes it, remove the patch.

### Rebase patches after a conflict

Apply patches in `patches/series` order to a clean checkout of the new Headlamp
commit. Resolve conflicts with Git so commit boundaries and mailbox metadata are
retained:

```bash
root=$PWD
git -C /path/to/headlamp checkout -b rebase-aks-desktop <new-headlamp-sha>
git -C /path/to/headlamp am -3 "$root/patches/0018-headlamp-upstream-<topic>.patch"
```

After resolving any conflict, continue with `git am --continue`, record the
range added by that numbered patch, and export it again with `git format-patch`.
Apply the next patch on top of that result. Rebase `source` entries before
`package` entries.

After all entries apply:

```bash
npm run headlamp:patches
npm install
npm run test:headlamp-patches
npm run test:build
```

Run the Headlamp typecheck, lint, focused tests, and packaged-runtime checks for
the code touched by the rebased patches.

### Validate a distribution

```bash
npm run headlamp:assemble
npm run headlamp:doctor
npm run build
npm run test:distribution
```

`npm run build` targets the current host. Architecture-specific commands include
`build:linux:arm64`, `build:mac:arm64`, and `build:win:arm64`.
Linux headless CI passes `-- --no-sandbox` to `test:distribution`.

Successful build commands print the absolute output directory. Packages and
unpacked applications are in
`node_modules/@headlamp-k8s/headlamp-source/source/app/dist/`, not the repository
root's `dist/`. See [build output](README.md#build-output) for each platform's
installer formats and unpacked paths. Copy artifacts out of this generated
package before reinstalling dependencies or deleting `node_modules`.

### macOS release architecture

The AzureContainerUpstream organization currently has no available hosted
ARM64 macOS runner, and the AKS Desktop project can run only one hosted macOS
job concurrently. Separate x64 and ARM64 build jobs would therefore run one
after the other while repeating checkout, dependency installation, cache
restore, certificate import, and keychain setup.

`.github/workflows/1es-pipeline-mac.yml` intentionally builds both packages in
one Intel-hosted job. It builds x64 first, then cross-packages ARM64. The ARM64
package contains native ARM64 Electron, Go, Azure CLI, Python, and extension
dependencies; host Python is used only to resolve those extension dependencies
without executing target code.

The second package reuses architecture-independent frontend, translation,
plugin, icon, and compiled Electron assets. It must still reinstall native app
dependencies, stage target-specific external tools, regenerate the product
manifest, build the Go backend, run Electron Builder, and verify the package.
The Intel worker cannot launch the ARM64 app, so ARM64 runs packaged-tool checks
instead of the Electron launch smoke. Signing and notarization remain separate
per architecture after the shared build job.

Do not split the build job unless both an ARM64 macOS runner and at least two
concurrent macOS jobs are available. After changing this flow, validate both
unsigned artifacts and their signing and notarization stages.

#### Azure CLI extension wheel lock

Every Azure CLI extension archive is pinned by URL and SHA-256 in
`package.json#config.externalTools.azureCli.extensionPackages`. Native builds
download those exact archives, verify their checksums, and pass the local wheel
to `az extension add --source`; do not replace this with name-based installation
from the live extension index.

Every packaged runtime additionally pins its complete target-specific Python
dependency closure in `build/azure-cli-<platform>-<runtime-arch>-requirements.txt`.
Tracked locks cover macOS x64/ARM64, Linux x64/ARM64, and Windows x64. Windows
ARM64 packages intentionally use the x64 runtime and therefore the Windows x64
lock. Each `# roots` header records which extension owns the locked transitive
closure.

pip downloads the selected lock with `--require-hashes`, then installs the
reviewed extension wheels with `--no-index` from the completed local wheelhouse.
Cache identity includes the target lock checksum and verified-wheel policy
version. Before any version-based reuse decision, cache verification rehashes
every wheel and compares every installed file against authenticated wheel
`RECORD` data. Every platform reads wheels with the packaged or host Python
standard-library `zipfile` module, so minimal build images need no `unzip`
executable. Any mismatch rebuilds the cache.

Wheelhouses always live outside packaged resources. CI may set
`AZ_CLI_EXTENSION_CACHE_DIR`; otherwise staging uses a cache-keyed directory
under the user cache root (`~/.cache/aks-desktop` on Unix or `%LOCALAPPDATA%` on
Windows). Only installed extension directories are copied into app resources.

Regenerate the lock only when changing an extension or one of its reviewed
dependencies. Resolve each runtime independently because native wheel hashes
differ by OS and architecture. Use these target tags:

- `darwin-x64`: `macosx_11_0_x86_64`
- `darwin-arm64`: `macosx_11_0_arm64`
- `linux-x64`: `manylinux_2_17_x86_64`
- `linux-arm64`: `manylinux_2_17_aarch64`
- `win32-x64`: `win_amd64`

```bash
python3 -m venv /tmp/aks-extension-lock
resolver=/tmp/aks-extension-lock/bin/python
"$resolver" -m pip install pip==25.2

target=linux-x64
platform=manylinux_2_17_x86_64
wheel_dir=$(mktemp -d)
report=$(mktemp)

jq -r '.config.externalTools.azureCli.extensionPackages
  | to_entries[] | [.value.url, .value.checksum] | @tsv' package.json |
while IFS=$'\t' read -r url checksum; do
  wheel="$wheel_dir/${url##*/}"
  curl -fsSL "$url" -o "$wheel"
  test "$(shasum -a 256 "$wheel" | awk '{print $1}')" = "$checksum"
done

"$resolver" -m pip install --dry-run --ignore-installed \
  --report "$report" \
  --platform "$platform" \
  --python-version 3.14 \
  --implementation cp \
  --only-binary=:all: \
  "$wheel_dir"/*.whl

{
  echo "# Transitive wheel lock for $target Azure CLI extension builds."
  echo '# Direct extension wheels and hashes are pinned in package.json.'
  echo '# roots: connectedk8s'
  jq -r '.install[]
    | select((.metadata.name | ascii_downcase)
        | IN("resource-graph", "alertsmanagement", "connectedk8s") | not)
    | "\(.metadata.name)==\(.metadata.version) --hash=\(.download_info.archive_info.hash | sub("="; ":"))"' \
    "$report" | LC_ALL=C sort -f
} > "build/azure-cli-$target-requirements.txt"
```

Review every version and hash change. Confirm the report contains only wheels,
remove each target's extension cache, and run cold and warm staging passes.
Tamper with one cached module on each platform and confirm staging rebuilds that
cache. Finish with `npm run test:build` and packaged-tool verification. Never
regenerate locks implicitly during a release build.

### Ship static plugins

Static plugins are declared in `package.json#headlamp.plugins`. Keep package
plugins pinned exactly, keep reviewed capabilities in product configuration,
and run `npm run test:headlamp-package` after changing the list.

See the [source package reference](packages/headlamp-source/README.md) for the
configuration schema and script API.

## Translations

Translation strings from the installed Headlamp source package, the in-repo
plugins, and a set of external Headlamp plugins are managed via OneLocBuild.
English source files are collected into `Localize/locales/en/`, and OneLocBuild
produces translated files into `Localize/locales/{lang}/`. The
`Localize/LocProject.json` file configures this pipeline.

The covered sources are the installed Headlamp frontend,
`plugins/aks-desktop/`, `plugins/plugin-catalog/`, the staged `ai-assistant`
release, and the external `keda`, `cert-manager`, and `prometheus` plugins.

AI Assistant is staged from the pinned GitHub release before collection, and
AKS-managed translations are overlaid onto that release before packaging.
Other external plugins live in the separate Headlamp plugins repository,
expected as a sibling checkout at `../plugins`. Override the location with the
`HEADLAMP_PLUGINS_DIR` environment variable. Missing external sources are
skipped.

### Workflow

1. **Collect English keys**: Run `npm run i18n:collect` to copy English locale
files from every source into `Localize/locales/en/`. These are the source files
OneLocBuild uses. The same step mirrors the English key set into each
`Localize/locales/{lang}/` file, keeping existing translations and leaving new
keys blank.

2. **Translate**: OneLocBuild picks up the English files and produces translated files in `Localize/locales/{lang}/` for each target language.

3. **Distribute**: Run `npm run i18n:distribute` to copy translated files back to their source locale directories.

   - Directories owned by this repo (the installed Headlamp source locale
     directory and `plugins/*/locales/`) are fully replaced.
   - Directories in the external plugins repository are only topped up: a translation is written when the key is missing or empty there, is present in that plugin's own English file, and its English text matches ours. Existing community translations are never overwritten, and the plugin's key order is preserved to keep the diff small.

   Translations for external plugins only reach users once they are merged upstream and the plugin is republished, since Headlamp fetches each plugin's `locales/{lang}/translation.json` from the plugin's own build output.
