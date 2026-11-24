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

Before Insights switched to prebuilt staging,
[run 43825605598](https://github.com/illume/aks-desktop/actions/runs/43825605598)
took about 49 minutes on `windows-11-arm` versus 12 minutes on `windows-latest`.
Dependency installation alone took 34 versus 5 minutes. The ARM job used native
ARM64 Node and had npm and Go download-cache hits. The three initial plugin
installs accounted for about 23 minutes, and bundling installed the remaining
`insights-plugin` dependencies for another 7 minutes. The logs locate the
bottleneck in installation, but do not isolate filesystem, antivirus, or npm
implementation costs.

PR and scheduled builds retain native ARM64 packaging, bundled-tool checks, and
application smoke tests. PR CI also retains native packaged-theme tests. Both
Windows workflows cache the three installed workspace-plugin dependency trees
(`aks-desktop`, `aks-desktop-theme`, and `plugin-catalog`)
separately by runner OS/architecture, exact Node version, npm pin, manifests,
lockfiles, npm configuration, and installation helper. There are no fallback
restore keys. The npm download-cache key also includes the pinned bootstrap npm
lockfile, so npm upgrades can populate a new cache rather than repeatedly missing
from an already immutable cache entry.
The installed-tree key also hashes both `.config/npm/package.json` and
`.config/npm/package-lock.json`, so changing the pinned npm toolchain requires a
fresh installed-plugin cache rather than trusting older dependency markers.
Unless restoration reports an exact cache hit, all three installed plugin trees
are discarded before installation or bundling can reuse them. This also handles
partial extraction that restored valid markers and lockfiles but missed packages.
Only trees whose clean-install identity matches the manifests and npm's hidden
lockfile are reused; a missing or stale marker triggers normal `npm ci`. Backend
builds, plugin builds, packaging, and native runtime checks still execute.

Both workflows call the [shared cache action](../.github/actions/cache-windows-plugin-dependencies/action.yml),
which owns the cache inputs, plugin paths, and reuse selection. Its definition is
also hashed, so changes to that policy populate a new cache. Initial installation
and packaging-time reuse cover the same three trees. Insights is staged from the
prebuilt `insights-plugin` package without a workspace dependency install or SDK
rebuild, so its wrapper metadata and paths are excluded from cache inputs,
cleanup, and dependency reuse.

Scheduled and manually dispatched Windows builds check out the workflow event's
exact commit, keeping executed code within GitHub's cache-write scope. For a
branch build, use the dispatch **Use workflow from** selector or `gh workflow run
build-app-win.yml --ref <branch>`; there is no independent checkout override.
The cache generation was rotated so earlier entries cannot be reused.

PR CI runs the Headlamp patch and package contracts after the initial clean
installation, before application assembly mutates the installed source.
The same contract suite previously ran after a second full `npm ci`; moving it
preserves the clean-tree check and removes that duplicate installation.
In run 43961980412, the duplicate x64 install took six minutes, exactly as long as
the initial install. The ARM64 saving from that change alone has not been isolated.

This targets repeated plugin extraction rather than just package downloads.
Cold caches still require installation. Compare cache-hit output and the existing
`[build-timing]` install phases rather than treating a configured cache as a
measured speedup.

### Installed Headlamp dependency cache

The [Headlamp cache action](../.github/actions/cache-headlamp-dependencies/action.yml)
now separately caches the installed frontend and Electron app dependency trees
on both native Windows architectures. The frontend cache represents the existing
`npm ci --omit=dev` install; the app cache represents the full clean install.

Root `npm ci` still runs its normal lifecycle hooks and materializes/patches the
source package. On Windows only, `HEADLAMP_DEFER_DESKTOP_INSTALL=true` defers the
Headlamp install until that clean install finishes. Restoring earlier would be
ineffective because root `npm ci` deletes the installed source dependency trees.
Normal local installs and non-Windows jobs retain their existing behavior.

Keys use the Headlamp pin/patch identity, actual dependency manifests and locks,
npm configuration, actual Node/npm versions, Node ABI, target architecture,
installation mode, and cache-policy helpers. Root npm script definitions and the
install/timing helpers are execution-policy inputs; unrelated AKS product
metadata does not invalidate this cache. Source, patch, dependency, runtime,
script, or configuration changes do invalidate it.
The cache-input command requires `GITHUB_OUTPUT` and a 64-character hexadecimal
policy fingerprint, then appends the complete key and multiline paths used
unchanged by restore and save.

Unless restoration confirms an exact hit, both trees are discarded. Even on a
hit, both clean-install markers and their installation context must match before
either `npm ci` is skipped. A failed replacement invalidates the completed-target
record. Each project and dependency path is checked through symlinks/junctions
before cleanup, installation, or cache-path output; an escaping path fails rather
than touching dependencies outside the consumer project. Installation repeats
this validation immediately before each step, after earlier lifecycle callbacks
have returned, including when reuse is disabled. This protects the installer's
own operations; it does not sandbox lifecycle scripts or eliminate concurrent
filesystem races. Backend compilation still runs with the existing Go cache.

New caches are verified and saved immediately after successful installation,
before packaging can mutate native dependencies. Verification loads Rsbuild's
Rspack platform binding and runs an esbuild transform in a fresh Node process;
missing native build payloads fail before the immutable snapshot is saved.
Neither incomplete installs nor build-mutated trees are saved as clean snapshots.
The same event-ref checkout boundary applies, and Dependabot covers both cache actions.

Real frontend/app installs were restored across a root-clean-install round trip
locally; both subsequent `npm ci` calls were skipped. Backend compilation was
disabled only for that local dependency-cache smoke, not in the workflows.
Native ARM64 timings for this additional cache must be measured on a confirmed
hit, including its restore cost, root installation, and Headlamp action time.

First native captures on `ad45c0e34`, using Node 22.22.2 / npm 12.0.1:

| Native job | Cold Headlamp action, including first snapshot upload | Archive bytes |
| --- | --- | --- |
| [Windows x64](https://github.com/Azure/aks-desktop/actions/runs/44322951968/job/134866516447) | 2m02s | 290,022,494 |
| [Windows ARM64](https://github.com/Azure/aks-desktop/actions/runs/44322951968/job/134866516297) | 10m10s | 281,341,832 |

Both verified archives were saved before packaging. These confirm native capture,
not warm-cache speedups. Changes to execution-policy fingerprints deliberately
require a new cold fill.

### Measured native ARM64 plugin-cache baseline

This measurement predates the additional installed Headlamp dependency cache.

On `93dd7c5fa`, attempts 1 and 2 of
[run 44169082943](https://github.com/Azure/aks-desktop/actions/runs/44169082943)
used the same commit, runner architecture, and cache key:

| Phase | [Cold run](https://github.com/Azure/aks-desktop/actions/runs/44169082943/job/134342981474) | [Warm run](https://github.com/Azure/aks-desktop/actions/runs/44169082943/job/134402531440) |
| --- | --- | --- |
| Installed-plugin cache restore | 0m02s | 6m53s |
| Install dependencies | 34m22s | 11m58s |
| Restore plus installation | 34m24s | 18m51s |

This is about 45% less dependency-setup time, including the substantial archive
restore cost. It is not a cold-install speedup. The cold run also spent 4m15s
uploading its first 416 MB archive after the build; the exact warm hit did not
upload another archive.

The warm log confirms the exact cache hit and verified reuse of all three
initial plugin installs. Headlamp's uncached frontend/app installation still
took about 9m29s. Both ARM64 jobs passed their native packaging and runtime checks.
The saving from moving patch contracts, independently of caching, was not
isolated by this comparison.

Changes to cache-key inputs deliberately require a new cold fill. In particular,
changing the root manifest's source-patch metadata also changes this key. Measure
restore plus installation on a confirmed hit before comparing a later run.

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
