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
`plugins/aks-desktop/`, `plugins/ai-assistant/`, `plugins/plugin-catalog/`, and
the external `keda`, `cert-manager`, and `prometheus` plugins.

External plugins live in the separate Headlamp plugins repository, expected as a sibling checkout at `../plugins`. Override the location with the `HEADLAMP_PLUGINS_DIR` environment variable. If the repository is not present, those sources are skipped, so CI only verifies the in-repo sources.

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
