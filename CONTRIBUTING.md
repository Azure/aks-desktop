# Contributing

This project welcomes contributions and suggestions. Most contributions require you to
agree to a Contributor License Agreement (CLA) declaring that you have the right to,
and actually do, grant us the rights to use your contribution. For details, visit
https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need
to provide a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the
instructions provided by the bot. You will only need to do this once across all repositories using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Headlamp Source Contributions

See [MAINTENANCE.md](MAINTENANCE.md) for Headlamp source updates and patches.

## Azure Live Tests

Run `npm run test:e2e:azure` only against approved Azure test resources. This
entry point uses the shared `AZ_LIVE_TESTS` opt-in for REST parity and generated
GitHub Actions/ACR tests; normal test discovery and CI remain offline.
Use `-- --suite rest` or `-- --suite acr` to select one suite.

See [the Azure live-test guide](test/e2e/README.md) for configuration, offline
harness tests, and dedicated-resource ownership and cleanup requirements.

## Script warning checks

CI checks project Python with Ruff, Bash/POSIX shell with ShellCheck, and PowerShell with
PSScriptAnalyzer. These complement the existing plugin and Headlamp lint and
type checks. Any reported Python diagnostic, shell/analyzer warning, or
PowerShell parse error fails CI. Husky hooks are checked as POSIX shell;
standalone shell scripts use their declared interpreter.
Fix findings or document a narrowly scoped false-positive suppression.

Install the root npm dependencies and create `.venv/`, which Git ignores.
For example, on Linux/macOS:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r .config/lint/requirements.txt
```

The full test suite also requires PowerShell. Install PSScriptAnalyzer 1.25.0
using the checksum-verifying installer, then run:

```sh
pwsh -NoProfile -File .config/lint/install-powershell.ps1
npm run test:script-lint
npm run lint:scripts
npm run lint:powershell
```

The checks include pipeline scripts, generated Unix Azure/Python wrappers, and
static Python `-c` snippets in JavaScript/TypeScript build helpers. Pipeline
expressions are replaced with placeholders for analysis; no pipeline or embedded
script is executed. Diagnostics for embedded scripts identify the containing
file and step or source line. New dynamic Python snippets must be moved to
standalone Python files so they can be checked.
Extracted PowerShell snippets receive a UTF-8 BOM in their temporary files;
standalone PowerShell files retain their original bytes for encoding diagnostics.

The Python requirements enforce wheel-only, SHA-256-verified installations;
source distributions and unpinned transitive dependencies are not permitted.
PSScriptAnalyzer is downloaded from its pinned upstream release and its SHA-256
is checked before extraction. It is installed under `node_modules/.cache/`,
not into the user's module directory, and the lint command imports that exact copy.
Reinstall it after a root `npm ci`, which removes `node_modules`.
For offline installation, pass `-ArchivePath /path/to/PSScriptAnalyzer.1.25.0.nupkg`
to the installer; the same checksum is required.
