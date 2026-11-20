# Contributing

Follow AKS Desktop's [contributing guidelines](../../CONTRIBUTING.md). [README.md](README.md)
describes what the plugin does and the AKS Devctl CLI (`aks-devctl`) commands it runs.

## Rules

* Never add the CLI, another executable, a kubeconfig, a credential, a receipt, raw command
  output or a local path to the package or the repository.
* Never open a kubeconfig file. The CLI merges the cluster's context into the default kubeconfig
  automatically and removes it on Delete; the plugin reads contexts only through Headlamp's
  `/config`.
* Build every command in `src/cli/commands.ts`, in the exact shapes AKS Desktop grants, and
  update `commands.test.ts` with them. Never pass `--kubeconfig` or `--overwrite-kubeconfig`.
  Pass `--yes` to Delete only after the plugin's confirmation dialog.
* Never show text from the CLI or AKS Desktop. A failure is a code that selects a fixed sentence.
* Never invent a public name, URL, maintainer, signer or schema field. Write
  `UNRESOLVED: <what is missing>` instead.
* Keep lifecycle state in memory.

## Source files

Every source file starts with this header (Apache-2.0):

```ts
// Copyright (c) Microsoft Corporation.
// Licensed under the Apache 2.0.
```

User-visible strings go through `useTranslation()` from `@kinvolk/headlamp-plugin/lib`. Run
`npm run i18n` to update `locales/en/translation.json` and commit the result. The README explains
what nothing checks for you and why to delete any `translation_old.json` the parser writes.

Every page has one level-1 heading, every control has a visible label, and progress and
failures are announced to screen readers.

## SDK upgrades

`headlamp-plugin upgrade` (SDK 0.14.0) rewrites settings that this package sets on purpose:

* It overwrites `tsconfig.json` with the SDK template, which drops `"module": "esnext"`, and
  adds or overwrites `src/headlamp-plugin.d.ts`, `.vscode/*.json` and `AGENTS.md`.
* It adds the `storybook` and `storybook-build` scripts. The other scripts already use the SDK's
  commands.
* It replaces `eslintConfig`, which drops the `no-restricted-globals` rule, and
  `overrides`, which drops `ws` and `vitest`.
* Unless you pass `--skip-package-updates`, it deletes `node_modules` and `package-lock.json`,
  installs the SDK at `--headlamp-plugin-version` (`latest` by default), runs `npm audit fix`
  and then `npm run format`, `npm run lint` and `npm run tsc`.

After an upgrade, review the whole diff, restore these settings unless a change is intended,
and run every check below. Nothing checks the new `package-lock.json` for you: review its diff as
README.md describes ("Build, test and package").

## Checks

Run these before you open a pull request:

```sh
npm ci
npm run format
npm run lint
npm run tsc
npm run i18n            # then check that locales/ did not change
npm test                # watches in a terminal: press q when it finishes; CI runs it once
npm run build
npm run package
```

Tests never start AKS Desktop, Headlamp, WSL or the CLI. Each test file fakes what it needs:
Headlamp's library with `vi.mock`, and CLI output with a stubbed `pluginRunCommand`.
