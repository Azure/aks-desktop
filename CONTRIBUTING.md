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
