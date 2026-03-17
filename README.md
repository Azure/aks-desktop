# AKS desktop

AKS desktop delivers an application focused experience for deploying and managing workloads on Azure Kubernetes Service.

Built on top of open-source [Headlamp](https://headlamp.dev), AKS desktop provides a guided, self-service UX built on supported AKS features and best practices. Designed to work within your existing environment and tools, it enables team collaboration through RBAC while abstracting complexity without removing control.

To learn how to get started with AKS desktop, create projects, deploy applications, and explore the full set of features, check out the [official AKS desktop documentation](https://aka.ms/aks/aks-desktop).

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/11652/badge)](https://www.bestpractices.dev/projects/11652)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Azure/aks-desktop/badge)](https://scorecard.dev/viewer/?uri=github.com/Azure/aks-desktop)

## Installation

Please download the latest release for your platform from the [Releases](https://github.com/Azure/aks-desktop/releases/latest) page.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Go](https://go.dev/) 1.22+ (for the Headlamp backend)
- [Git](https://git-scm.com/)
- GNU Make — included on macOS/Linux; on Windows install via `winget install GnuWin32.Make` or [Chocolatey](https://community.chocolatey.org/packages/make) (`choco install make`)

### Quick start

```bash
git clone --recurse-submodules https://github.com/Azure/aks-desktop.git
cd aks-desktop
npm run setup    # resets submodule, installs deps, builds backend
npm run dev      # starts the app in development mode
```

### Optional: use system Azure CLI

If you already have [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and want to skip the bundled download:

```bash
# Linux / macOS
AKS_DESKTOP_SYSTEM_AZ=1 npm run setup

# Windows (cmd)
set AKS_DESKTOP_SYSTEM_AZ=1 && npm run setup

# Windows (PowerShell)
$env:AKS_DESKTOP_SYSTEM_AZ="1"; npm run setup
```

### Manual steps (if you prefer)

```bash
node scripts/setup-submodule.mjs   # or: ./scripts/headlamp-submodule.sh --reset
npm ci
npm run install:all                # installs headlamp, plugin, and ai-assistant in parallel
cd headlamp && make backend && cd ..
npm run dev
```

## How to Build

```bash
git clone --recurse-submodules https://github.com/Azure/aks-desktop.git
cd aks-desktop
npm run setup
npm run build
```

## Documentation

- [Cluster Requirements](docs/cluster-requirements.md) — What your AKS cluster needs for the best AKS desktop experience
- [AKS Desktop Documentation](https://aka.ms/aks/aks-desktop)
- [AKS Managed Namespaces](https://learn.microsoft.com/en-us/azure/aks/manage-namespaces)

## Contributing

Check out the [CONTRIBUTING.md](CONTRIBUTING.md) file. More
details on how to contribute will come soon.

## Support

See [SUPPORT.md](SUPPORT.md) for information on how to get help with this project.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must [follow Microsoft’s Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party’s policies.
