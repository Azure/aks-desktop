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

1. Reads the exact npm pin from `package.json`, checks that `.config/npm/package.json`
   agrees, and reads the working bootstrap CLI from the npm lifecycle's `npm_execpath`.
2. Creates its temporary installation with native Node filesystem paths, outside
   the checkout so `npm ci` cannot delete the CLI executing it. Copies the npm
   manifest and integrity lock from `.config/npm` into that directory.
3. Installs the locked npm package with `ci --ignore-scripts` using `process.execPath`
   plus the bootstrap CLI, without passing temporary paths through Git Bash
   argument conversion.
4. Checks that the new CLI exists and reports the expected version.
5. Runs `ci`, `build:win-ci` (x64), and `test:distribution` through Node and that
   CLI, then `build:win:arm64 -- --reuse-prepared-assets` and `test:post-build`.
   The x64 release host checks the ARM64 bundle without launching its application;
   the native Windows ARM64 CI job verifies bundled tools and launches the unpacked
   application headlessly. It does not install the NSIS installer.
   A **native child-process PATH**, with the platform delimiter and existing key
   casing, also selects pinned npm/Node for nested bare commands. It is never
   exported back into Bash or persisted with `task.prependpath`.
6. Stops on failure and preserves the command's exit status. Temporary-directory
   cleanup is retried finitely; a cleanup failure warns without replacing the
   build result. The agent retains responsibility for its temporary workspace.

The registry/pip proxy settings, package-manager/Node/Go pins, localization,
lockfile, macOS/Linux workflows, ESRP signing and asset names are unchanged.
Both Windows installers are required before ESRP signing and verification, then
published together in the `aks-desktop-signed` ADO pipeline artifact. This pipeline
does not attach assets to a GitHub Release. No new dependency is needed before `ci`.

PR CI retains the unsigned ARM64 installer in `aks-desktop-win-arm64` for seven
days. An ARM64 owner must still validate installation, normal application startup
and uninstallation.

## Native Windows ARM64 performance

[Run 43825605598](https://github.com/illume/aks-desktop/actions/runs/43825605598)
took about 49 minutes on `windows-11-arm` versus 12 minutes on `windows-latest`.
Dependency installation alone took 34 versus 5 minutes. The ARM job used native
ARM64 Node and had npm and Go download-cache hits. The three initial plugin
installs accounted for about 23 minutes, and bundling installed the remaining
`insights-plugin` dependencies for another 7 minutes. The logs locate the
bottleneck in installation, but do not isolate filesystem, antivirus, or npm
implementation costs.

PR and scheduled builds retain native ARM64 packaging, bundled-tool checks, and
application smoke tests. PR CI also retains native packaged-theme tests. Both
Windows workflows cache all four installed workspace-plugin dependency trees
separately by runner OS/architecture, exact Node version, npm pin, manifests,
lockfiles, npm configuration, and installation helper. There are no fallback
restore keys. The npm download-cache key also includes the pinned bootstrap npm
lockfile, so npm upgrades can populate a new cache rather than repeatedly missing
from an already immutable cache entry.
Only trees whose clean-install identity matches the manifests and npm's hidden
lockfile are reused; a missing or stale marker triggers normal `npm ci`. Headlamp
installation, plugin builds, packaging, and native runtime checks still execute.

PR CI runs the Headlamp patch and package contracts after the initial clean
installation, before application assembly mutates the installed source.
The same contract suite previously ran after a second full `npm ci`; moving it
preserves the clean-tree check and removes that duplicate installation.
In run 43961980412, the duplicate x64 install took six minutes, exactly as long as
the initial install. The ARM64 saving must be measured after the workflow can run.

This targets repeated plugin extraction rather than just package downloads.
Cold caches still require installation; warm-cache speedups must be measured on
the Windows ARM64 runner. Compare the cache-hit output and existing
`[build-timing]` install phases with the linked baseline before claiming a
specific time reduction.

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
