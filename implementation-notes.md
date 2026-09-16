# Native macOS ARM64 repair

## Approved scope

Local implementation approved after read-only comparison of historical ADO build 245500, failed repair 247834, current main, and successful native GitHub CI 35120504316/job 104876780383. Keep a fully native ARM64 payload: no Rosetta fallback and no weakening of the native-host contract. Use the existing ADO GitHub-hosted Agents pool (179), project queue 1531, subject to a separately approved live allocation/build. No pushes, dispatches/retries, cancellations, infrastructure/billing changes, or changes outside aks-desktop are authorized.

Base main: `0383574da8a88ca2bb560300b8a1502c971406c1`.
Existing published repair: `0872a4b5410ae42feac10a47f4f3e68ebe2750f0` on `w70/restore-macos-arm64`; preserve this commit. Worktree was clean before implementation; no PR found.

## Confirmed evidence

- ADO 245500/source 77d87385 produced both final artifacts (ARM 401848, x64 401901). ARM log 41 packages Electron arm64 but installs x86_64 Python/wheels. All eight signing/notarization logs have positive evidence; final app signatures were valid and Gatekeeper accepted them. This does not establish a fully native historical toolchain.
- ADO 247834: ARM failed before allocation with the attempted macOS-15-arm64 label in Azure Pipelines; Intel failed hashing absent `**/go.sum`. SDL Sources also failed allocation of its configured Windows image. No artifacts.
- Current source materializes Headlamp after checkout through npm lifecycle scripts. Ordinary `npm ci` also builds the backend, so moving the Go cache after installation is too late for the initial downloads. Nested Headlamp node_modules caches are replaced by npm ci.
- GitHub CI 35120504316 on current main used actual ARM64 Node, Go, Python, and wheels; built the ARM DMG and passed bundled CLI/Python and app smoke. Developer ID signing was skipped. Go was 1.26.8, not required 1.26.3. No comprehensive Mach-O audit was present.
- ADO GitHub-hosted Agents pool and project queue exist; read-only permissions report all pipelines authorized. No agent allocation has been proved. PAYG/preview semantics apply.
- Actual 1ES release template AgentJob.yml maps `image` to vmImage only for Azure Pipelines. For GitHub-hosted Agents it produces ImageOverride demands. Explicit `vmImage: macos-26-arm64` survives the actual definition 1000 preview with arm64 hostArchitecture. Preview creates no run and proves no allocation.
- Current consumer macOS appId is com.microsoft.aksdesktop; historical signed bundle ID was com.microsoft.aks-desktop. Preserve current configuration until this compatibility/signing question is explicitly resolved; do not silently change identity.

## Implementation checklist

- [x] Native hosted selector and usable pre-install cache inputs, retaining Intel path and pins.
- [x] Strict required-payload architecture and native runtime verification, regression-tested.
- [x] Fail-closed Developer ID / notarization verification with executable regression tests.
- [x] Qualification documentation: final artifact hashes, exact source/run IDs, signing, native runtime, and minimum-macOS evidence gates (live evidence still pending).
- [x] Polish changed code; tests/typechecks/diff inspection and actual 1ES preview.

## Verification boundary

Initial Linux baseline: 76 build tests passed, 1 Windows-only skip; source helper typecheck passed and 67 helper/contract tests passed. Application source was subsequently materialized and patched in this worktree for integration tests; no application was built. No macOS build or new artifact exists. Full qualification is blocked on separately approved publication/dispatch and successful native allocation, signing/notarization, and final signed-app runtime checks. Do not confuse local test fixtures or preview compilation with those gates.

## Local implementation and verification

The final ARM artifact now has an explicit native qualification stage after ESRP notarization. `Notarize_arm64` emits `notarized-dmg-arm64`; only successful `Qualify_arm64` emits the unchanged final name `aks-desktop-signed-arm64`. This is necessary because signing can alter nested payloads: pre-sign smoke alone is insufficient. The final job never builds, signs, or repackages. It publishes the original DMG bytes after checking the copied app, records SHA256/source/build identity in a separate evidence artifact, and isolates application/CLI state. Intel retains its final name and pre-sign native smoke, with strict final signing/notarization checks.

The native checker logs every Mach-O's target-slice deployment minimum and fails if it exceeds the app's advertised minimum. This does NOT establish the historical supported floor or prove execution on the oldest supported macOS. All named Electron/backend/Python payloads are required; all native libraries remain architecture checked. Offline CLI command loading covers all three extensions; native bindings are exercised without cloud credentials or dynamic extension downloads.

Regression failures were observed before repairs for pool/cache inputs, explicit final-app selection, publication dependencies, native payload/runtime errors, deployment minima, signature/notarization rejection, mount cleanup and final-app mutation protection. Local test commands use real Bash/filesystem fixtures with macOS system commands stubbed; no actual macOS execution is claimed.

Prepared source with pinned npm 12.0.1 `headlamp:prepare`, installed root dependencies with `ci --ignore-scripts`, and applied the reviewed installed patch. The first full test:build attempt passed helpers but had four integration errors due to missing frontend/app dependency installations (`@nodelib/fs.walk`, `app-builder-lib`). Installed those two existing lockfiles with pinned npm `ci --ignore-scripts`; no tracked source/lock changes were needed.

Fresh verification:

- `npm run test:build` (npm 12.0.1 on Node 22.22.2): 67 source helper/contracts passed, then 195 build/integration tests passed and one Windows-only test skipped.
- `npm run test:headlamp-patches`: aggregate patch validation, 3 package contracts and 20 consumer integration tests passed.
- `npm run test:i18n`: 10 tests passed.
- Targeted `tsc --noEmit --skipLibCheck --esModuleInterop --target ES2022 --module Node16 --moduleResolution Node16 --types node` covering macOS helpers/tests, bundled verifier and product-manifest test passed.
- `bash -n` and `shellcheck` passed for both macOS shell helpers.
- Prettier check of the changed macOS TypeScript files and `git diff --check` passed.
- Configured LSP diagnostics could not run: Biome executable missing. Install Biome or update its command in pi-lsp.json; no configuration changes made. Explicit TypeScript/ShellCheck checks are recorded above instead.

Proactive polish --fix: independent code and silent-failure reviewers both identified that Python `-I` ignores `PYTHONDONTWRITEBYTECODE`. Added failing command-boundary regressions and explicit `-B`; verified actual local Python reports bytecode writes disabled. Applied formatting to maintained macOS TypeScript files. Documentation and type/API review reported no other actionable findings (type review was static; its attempted ts-node runner was unavailable, so parent ran the supported tsx/tsc commands). Preserved the original positive signing-log markers for downstream evidence readers. POSIX shell/permission tests are explicitly skipped on Windows; no Windows execution was performed here.

Actual definition 1000 revision 2 preview accepted the full local workflow, including both native vmImage selectors and final artifact dependency chain. Input YAML SHA256: `68591a13effa036ff4b6e25a607ae22b14d1bf5119814bc6c7288053dc15affc`. It used published 0872a4b54 as repository context with a local YAML override; there is no new build ID. No source push, dispatch/retry, cancellation, infrastructure or billing change has occurred.
