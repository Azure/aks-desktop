# AKS desktop

AKS desktop delivers an application focused experience for deploying and managing workloads on Azure Kubernetes Service.

Built on top of open-source [Headlamp](https://headlamp.dev), AKS desktop provides a guided, self-service UX built on supported AKS features and best practices. Designed to work within your existing environment and tools, it enables team collaboration through RBAC while abstracting complexity without removing control.

To learn how to get started with AKS desktop, create projects, deploy applications, and explore the full set of features, check out the [official AKS desktop documentation](https://aka.ms/aks/aks-desktop).

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/11652/badge)](https://www.bestpractices.dev/projects/11652)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Azure/aks-desktop/badge)](https://scorecard.dev/viewer/?uri=github.com/Azure/aks-desktop)

## Installation

Please download the latest release for your platform from the [Releases](https://github.com/Azure/aks-desktop/releases/latest) page.

## Development

Install Node.js 22.22.2 or newer. npm 10 and newer are supported; the repository
uses npm 12.0.1 in CI and for lockfile maintenance.

```bash
npm install --global npm@12.0.1
npm --version
```

Using the pinned version avoids unrelated lockfile changes when updating
dependencies.

```bash
npm install
npm start
```

To build the application after installing dependencies:

```bash
npm run build
```

The default build targets the host architecture. Release targets can also be
built explicitly with `npm run build:linux:arm64`, `npm run build:mac:arm64`,
or `npm run build:win:arm64` on the corresponding host platform.

### Build output

After a successful build, the command prints the absolute output directory.
Installers, archives, and unpacked applications are written under the installed
Headlamp package, **not** a `dist/` directory at the repository root:

```text
node_modules/@headlamp-k8s/headlamp-source/source/app/dist/
```

| Platform | Packages in that directory | Unpacked application |
| --- | --- | --- |
| macOS | `.dmg` | `mac-arm64/AKS desktop.app` or `mac/AKS desktop.app` for x64 |
| Windows | `.exe` installer | `win-unpacked/AKS desktop.exe` for x64 or `win-arm64-unpacked/AKS desktop.exe` |
| Linux | `.AppImage`, `.tar.gz`, and `.deb` for x64 | `linux-unpacked/aks-desktop` for x64 or `linux-arm64-unpacked/aks-desktop` |

The files at the top level are the distributable packages; the platform
subdirectories contain unpacked builds used by `npm run test:distribution`.
The directory can contain output from earlier builds. Copy packages elsewhere
before cleaning or reinstalling dependencies, which can replace this generated
source package. See [distribution validation](MAINTENANCE.md#validate-a-distribution)
for the verification commands.

## Documentation

- [Cluster Requirements](docs/cluster-requirements.md) — What your AKS cluster needs for the best AKS desktop experience
- [Headlamp source configuration](packages/headlamp-source/README.md) — `headlampSource` and `headlamp` fields
- [Headlamp source maintenance](MAINTENANCE.md#headlamp-distribution) — Source updates and patch rebases
- [AKS Desktop Documentation](https://aka.ms/aks/aks-desktop)
- [AKS Managed Namespaces](https://learn.microsoft.com/en-us/azure/aks/managed-namespaces)

## Contributing

Check out the [CONTRIBUTING.md](CONTRIBUTING.md) file. More
details on how to contribute will come soon.

## Support

See [SUPPORT.md](SUPPORT.md) for information on how to get help with this project.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must [follow Microsoft’s Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party’s policies.
