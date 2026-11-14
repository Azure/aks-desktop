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

## Script warning checks

CI checks project Python with Ruff, Bash/POSIX shell with ShellCheck, and PowerShell with
PSScriptAnalyzer. These complement the existing plugin and Headlamp lint and
type checks. Any reported Python diagnostic, shell/analyzer warning, or
PowerShell parse error fails CI. Husky hooks are checked as POSIX shell.
Fix findings or document a narrowly scoped false-positive suppression.

Install the root npm dependencies and the pinned tools in
[`.config/lint/requirements.txt`](.config/lint/requirements.txt) into a Python
virtual environment, then activate it. The full test suite also requires
PowerShell and PSScriptAnalyzer 1.25.0, installed using
`Install-Module PSScriptAnalyzer -RequiredVersion 1.25.0 -Scope CurrentUser`.
Run:

```sh
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