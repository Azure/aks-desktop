# Native macOS arm64 release qualification

The arm64 release must build natively and retain the same ESRP developer-signing
and notarization chain as the existing release pipeline. An Intel/Rosetta build
or unsigned substitute is not an arm64 release candidate.

## Changes

- `Build_arm64` is enabled on the explicit `macOS-15-arm64` image, with 1ES
  `hostArchitecture: arm64`. A shell host check runs before tool setup; Node and
  Go architecture checks run before dependency caches/install/build steps.
- The default pool is pinned to Intel `macOS-15`, rather than the moving
  `macOS-latest` label. The arm64 build overrides it; existing signing and
  notarization jobs retain the default pool and their successful-stage dependencies.
- npm and Go cache keys and restore prefixes include `$(ARCH)` so native modules
  cannot be restored from a different architecture's cache.
- `npm run test:distribution` now checks the actual macOS application payload.
  Bundled Python must report the target native architecture in isolated mode.
  Every discovered thin/universal Mach-O file must include the target slice,
  including Python extensions and libraries without executable permission bits.
  Framework symlinks are checked once; links escaping the application fail.
  A target marker or a shell-wrapper checksum is not sufficient evidence.
- Existing final artifact names remain `aks-desktop-signed-arm64` and
  `aks-desktop-signed-x64`. No signing connection, certificate, entitlement,
  notarization identity, dependency version or artifact pin was changed.

The prior x64-only comment was stale: `package.json` already selects native
Python for Darwin arm64, and Unix Azure CLI is installed through that Python.
The existing arm64 Python archive was fetched read-only, matched its configured
SHA256 `069ac156f66c6774e332ad55d6e556a5f20c45fbdd7a267a5274ad918d895cde`, and its
Python executable was confirmed to have the arm64 Mach-O CPU type. This is not
a substitute for executing Python and Azure CLI on a real Mac.

## Hosted runner availability

Microsoft's hosted-agent documentation currently says the macOS 15 ARM64
limited public preview is paused for new organizations; existing users can
continue. The `Azure Pipelines` pool exists in AzureContainerUpstream, but its
agent-list API does not expose an allocation/eligibility guarantee for this image.

Do not silently replace the arm64 image with `macOS-15`, weaken the native-host
checks, or remove the arm64 asset if allocation fails. Confirm hosted ARM access
or obtain explicit approval for a native self-hosted macOS pool first.

Reference: [Microsoft-hosted agents](https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/hosted?view=azure-devops&tabs=macos-images).

## Verification performed

From an isolated worktree at base `0383574da8a88ca2bb560300b8a1502c971406c1`:

```sh
# Install metadata/test dependencies without application build lifecycle scripts.
npm exec --yes --package=npm@12.0.1 -- npm ci --ignore-scripts --no-audit --no-fund

node_modules/.bin/tsx --test build/*.test.ts
npm --prefix packages/headlamp-source run test:helpers
```

- Build tests: **76 passed**, one Windows-only ZIP test skipped.
- Source-package helper tests: **67 passed**.
- Targeted TypeScript checking of the new verifier/tests and
  `build/verify-bundled-tools.ts` passed.
- New tests cover wrong Python architecture, missing target slices, thin/fat
  binaries, escaped/internal symlinks, absent native payload, pipeline host
  selection, architecture-isolated caches and retained signing/notarization edges.
- The modified full YAML compiled against the actual ADO definition1000 using
  the `/preview` API with `previewRun: true` and `yamlOverride`. Its compiled
  `BuildJob_arm64` pool retained `vmImage: macOS-15-arm64` and
  `hostArchitecture: arm64`. **Preview created no run and proves neither runner
  allocation nor a successful package/sign/notarize operation.**

## Required live qualification

After separate approval of the exact source branch/commit and build dispatch:

1. Confirm the ARM job is allocated, `uname -m`, Node and Go are native arm64.
2. Verify the pinned Python download, native Azure CLI and required extensions
   install and execute successfully through the bundled runtime.
3. Run packaging and `test:distribution`, including the actual Python and Mach-O
   checks and application smoke test. Do not claim native execution from Linux
   unit tests whose macOS command boundary is stubbed.
4. Complete ESRP developer signing and notarization, and retain positive
   verification evidence for the produced arm64 DMG.
5. Confirm both macOS artifacts are eligible alongside the required Windows EXE,
   Linux DEB and Linux tarball. A partial build cannot authorize publication.

No branch push, build dispatch, signing run or release publication was performed
as part of the local checks or the preview-only compilation above.

## Reviewer focus

1. Why does the native ARM pool override apply to the build job rather than
   replacing the pool for every signing/notarization job?
2. Why is `Agent.OS` alone insufficient to identify these dependency caches?
3. What different failures do Python's execution architecture and Mach-O slice
   checks detect?
4. What does the preview API establish, and what still requires real allocation?
5. Which source publication, build and release operations still require their
   own explicit approvals?
