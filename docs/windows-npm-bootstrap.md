# Windows CI npm bootstrap

## Observed failure — 2026-09-16

[ADO build 247843](https://dev.azure.com/AzureContainerUpstream/Kubernetes/_build/results?buildId=247843)
used definition 1003, `rc-0.10.0`, source
`97369db5e410a085aff8093ea1dc111ba5a3d40d`, Node 22.22.2 and Go 1.26.3.
Log 36 reported a successful one-package npm bootstrap installation, followed by:

```text
Cannot find module 'A:\_work\_temp\npm.3TCmAE\node_modules\npm\bin\npm-cli.js'
```

This happened before application compilation. Supply-chain warnings were not the
failing step. The published npm 12.0.1 archive contains that CLI and supports the
selected Node version. The log does not reveal the actual installed directory;
do not claim a particular drive-mapping defect has been conclusively reproduced.

## Repair

The Windows pipeline now runs the dependency-free regression suite, then
`npm run ci:windows`. Its [Node entrypoint](../build/windows-ci.cjs):

1. Reads the exact npm pin from `package.json` and the working bootstrap CLI from
   the npm lifecycle's `npm_execpath`.
2. Creates its temporary installation with native Node filesystem paths, outside
   the checkout so `npm ci` cannot delete the CLI executing it.
3. Installs the pin using `process.execPath` plus the bootstrap CLI, without
   passing temporary paths through Git Bash argument conversion.
4. Checks that the new CLI exists and reports the expected version.
5. Runs `ci`, `build:win-ci`, and `test:distribution` through Node and that CLI.
   A **native child-process PATH**, with the platform delimiter and existing key
   casing, also selects pinned npm/Node for nested bare commands. It is never
   exported back into Bash or persisted with `task.prependpath`.
6. Stops on failure and preserves the command's exit status. Temporary-directory
   cleanup is retried finitely; a cleanup failure warns without replacing the
   build result. The agent retains responsibility for its temporary workspace.

The registry/pip proxy settings, package-manager/Node/Go pins, localization,
lockfile, macOS/Linux workflows, distribution checks, ESRP signing, asset names
and publication steps are unchanged. No new dependency is needed before `ci`.

## Verification and remaining gate

```sh
node --test build/windows-ci.test.cjs
node_modules/.bin/tsx --test build/*.test.ts
npm --prefix packages/headlamp-source run test:helpers
git diff --check
```

- **11 new process-level regressions** passed on Linux Node 26.5.0 and the actual
  Windows Node 22.22.2 executable under Wine 9.0, including native `A:` temporary
  paths. External npm install/build work is simulated; filesystem paths, child processes, native shells, nested npm
  lookup, failure propagation and cleanup are exercised.
- **67 existing build tests passed**, with one Windows-only test skipped on Linux;
  **67 source-package helper tests passed**. One later run failed the unchanged
  signal/readiness timing test (`SIGTERM` expected, readiness timeout observed).
  Its focused nine-test suite and a full 67-test recheck passed without changes;
  that intermittent result is not hidden as an entirely clean verification run.
- A separate synthetic Linux project exercised **real npm 10.9.7 → 12.0.1
  installation**, lockfile-format-4 `ci`, nested bare/direct npm calls and cleanup.
  All nested commands reported actual CLI version 12.0.1. Inherited
  `npm_config_user_agent` still mentioned the bootstrap version: use CLI execution,
  not that metadata field, when verifying which npm is running.
- A real-npm Windows smoke was **not qualified**: in this Wine fixture the
  bootstrap npm 10.9.7 CLI itself exited 1 without diagnostics, before the new
  entrypoint ran. Wine tests do not replace the actual Windows agent.
- Independent review identified nested npm fallback and cleanup masking; both
  were reproduced with failing tests before correction.

The next separately approved ADO run must establish actual bootstrap, dependency
installation, Windows packaging, distribution validation and signing success.
These local tests are not a successful installer build, a signed-asset receipt,
or permission to push source or dispatch CI.
