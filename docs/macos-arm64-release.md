# Native macOS ARM64 release qualification

## Contract

The ARM64 release contains native ARM64 Electron, Go backend, Python, Azure CLI
native dependencies, and the required CLI extensions. Rosetta is not a fallback.
The existing native-host guard, artifact pins, localization/source-package
assembly, and ESRP developer-signing/notarization operations remain in place.

**Local tests and pipeline preview are not release qualification.** No new
macOS build, final artifact hash, or signed-app execution has been obtained for
this candidate. Each push and build dispatch/retry requires separate approval.

## Why the historical build is not the native reference

- ADO **245500**, source `77d87385acd16b5888f7d7c3be71c4b29c3a357d`, produced both
  final artifacts: ARM64 **401848** and x64 **401901**, version **0.10.0**. ARM
  log 41 shows Electron ARM64 packaging but x86_64 Python and wheels. All eight
  signing/notarization logs contain positive checks, including Microsoft team
  `UBF8T346G9`, Gatekeeper acceptance and valid app signatures. Its overall
  `partiallySucceeded` status does not mean those artifacts were absent.
- ADO **247834**, source `0872a4b5410ae42feac10a47f4f3e68ebe2750f0`, produced no
  artifacts. The attempted `macOS-15-arm64` image in `Azure Pipelines` failed
  before allocation. Intel failed hashing missing `**/go.sum`: source-package
  materialization now happens during npm installation, not recursive checkout.
- Current main **0383574da8a88ca2bb560300b8a1502c971406c1** already passed native
  GitHub CI **35120504316**, job **104876780383**: ARM64 Node/Go/Python, ARM64
  packaging, bundled CLI/Python invocation and application smoke. Developer ID
  signing was skipped, Go was **1.26.8**, and a complete Mach-O audit was absent.
  This supports native feasibility, not qualification of this repair.

## Native ADO selection

The existing `GitHub-hosted Agents` pool (**179**), Kubernetes queue **1531**,
was confirmed through read-only API calls. Pipeline permissions reported all
pipelines authorized. Microsoft documents `macos-26-arm64` for this pool. It is
**PAYG, with no free tier, and in preview**; do not enable billing or provision
another pool without approval. Pool existence/authorization does not guarantee
successful allocation.

The ARM build and final ARM qualification job specify:

```yaml
pool:
  name: GitHub-hosted Agents
  vmImage: macos-26-arm64
  os: macOS
  hostArchitecture: arm64
```

Use **vmImage**, not **image**. The actual 1ES release template translates
`image` to `vmImage` only for the `Azure Pipelines` pool; for this named pool it
instead emits an `ImageOverride` demand. An in-memory preview against definition
1000 confirmed explicit `vmImage` survives compilation. Preview queues no job.
Intel build/signing/notarization retain the `Azure Pipelines` / `macOS-15` pool.
Node **22.22.2**, npm **12.0.1**, and Go **1.26.3** remain the release toolchain.

References: [Microsoft documentation](https://learn.microsoft.com/en-us/azure/devops/pipelines/agents/github-hosted)
and [Apple Silicon announcement](https://devblogs.microsoft.com/devops/apple-silicon-and-xcode-27-images-availabile-in-pay-as-you-go-preview/).

## Cache and verification changes

- Cache npm downloads outside `node_modules`; root `npm ci` replaces the old
  cached Headlamp dependency directories. Child installs inherit the download
  cache through `NPM_CONFIG_CACHE`.
- Restore Go modules before npm lifecycle scripts materialize and build the
  backend. Cache keys hash tracked package metadata, locks and reviewed patches
  available at checkout, rather than a not-yet-existing `go.sum`. Restore
  prefixes retain OS/architecture/toolchain isolation.
- Require native verifier execution and reject translated processes. Require
  actual Electron, backend and Python executables, then check every discovered
  Mach-O target slice, including non-executable native libraries and extensions.
  Confined framework symlinks are deduplicated; escaped links fail.
- Inspect target-slice Mach-O deployment commands with `otool`. A payload whose
  minimum macOS exceeds the app's `LSMinimumSystemVersion`, or lacks deployment
  metadata, fails. Logs record per-file minimum versions. This checks consistency
  with the advertised minimum; it does not establish an approved historical
  support floor or substitute for running on that oldest supported OS.
- Execute isolated bundled Python native-binding exercises (SSL, SQLite, ctypes,
  cryptography, psutil, OpenSSL), verify module origins stay in the bundled CLI,
  check the pinned CLI version and load actual commands from `resource-graph`,
  `alertsmanagement`, and `connectedk8s`. Dynamic extension installation and
  telemetry are disabled. These are offline loading checks, not cloud mutation
  or authenticated cluster-operation tests.
- `verify-macos-signing.sh` requires valid DMG/app signatures, exact Microsoft
  Developer ID authority/team, the expected product bundle ID, and exactly one
  root app. Notarized mode also requires a valid stapled DMG ticket and positive
  Gatekeeper assessments. Missing bundles or failed checks cannot become warnings.

## Final artifact gate

`Notarize_arm64` publishes intermediate `notarized-dmg-arm64`. A native
`Qualify_arm64` job downloads those exact bytes, verifies signatures/notarization,
mounts read-only, and copies the app into temporary storage. It runs the product,
architecture and runtime checks against that copied app, then the existing
application/backend HTTP-readiness smoke test. Signature verification runs again
following execution. No build, re-signing or repackaging is permitted in this job.

Only after success does it copy the original DMG into final artifact
**aks-desktop-signed-arm64**. Its SHA256, ADO build/source IDs and checks are
recorded in **macos-qualification-arm64** / `qualification.log`. The Intel final
artifact remains **aks-desktop-signed-x64**, with native pre-sign distribution
smoke and fail-closed final signature/notarization checks.

The same ARM qualification can be run from this checkout on a native ARM Mac:

```sh
# Install verifier dependencies only with pinned npm; do not rebuild the app.
npm ci --ignore-scripts --no-audit --no-fund
BUILD_BUILDID='<actual ADO build ID>' BUILD_SOURCEVERSION='<actual source SHA>' \
  bash build/qualify-macos-dmg.sh \
    /path/to/notarized-dmgs /path/to/qualified-output com.microsoft.aksdesktop
```

Use the expected bundle ID from the approved source, not a value inferred from
an arbitrary downloaded app. Normal packaged verification also accepts an
explicit final app: `PYTHONDONTWRITEBYTECODE=1 npm run test:post-build -- --app='/path/AKS desktop.app'`.
The app and backend smoke is separate: `npm run headlamp:smoke -- --executable
'/path/AKS desktop.app/Contents/MacOS/AKS desktop'`.

## Remaining live gates and decisions

1. Obtain approval for the exact source push, then separately for one build
   dispatch with its source SHA and toolchain. No automatic external retries.
2. Prove native allocation, installed tool versions, dependency installation,
   actual packaging, all signature/notarization checks and final ARM qualification.
   Collect final ARM and Intel artifact IDs, filenames, sizes and SHA256 hashes.
3. The failed run's **SDL Sources** job also could not allocate its configured
   Windows image. This repair does not change that pool or bypass the security
   scan; its owner must resolve the blocker under separate authorization.
4. Current consumer macOS bundle ID is **com.microsoft.aksdesktop**, whereas
   historical signing reported **com.microsoft.aks-desktop**. This repair does
   not silently change current identity. Reconcile supported upgrade/keychain/
   provisioning behavior before release. A copied provisioning file alone is
   not proof the generated Electron Builder configuration uses it.
5. Confirm the advertised minimum macOS against the supported release baseline
   and test on that OS. New-host compilation and load-command consistency alone
   cannot prove backwards compatibility.
6. Complete a normal interactive launch of the final signed app on Apple Silicon
   in addition to the automated headless/backend smoke. No such manual check has
   been performed in this Linux session.

See `implementation-notes.md` for fresh local commands/results and limitations.

## Reviewer focus

Scrutinize the actual compiled pool selectors, cache inputs before npm lifecycle
execution, and the final publication dependency. Signing checks intentionally
fail closed; real macOS output/exit behavior still needs qualification. No
source-package, localization, product identity or tool-version pins changed.

1. Why does this named hosted pool require explicit `vmImage` in 1ES?
2. Why is moving the Go cache after ordinary `npm ci` too late?
3. What does the Mach-O deployment check establish, and what does it not prove?
4. Why must isolated Python probes also use `-B` against a signed application?
5. Which evidence is still required before this candidate can be called qualified?
