# AKS desktop

AKS desktop delivers an application focused experience for deploying and managing workloads on Azure Kubernetes Service.

Built on top of open-source [Headlamp](https://headlamp.dev), AKS desktop provides a guided, self-service UX built on supported AKS features and best practices. Designed to work within your existing environment and tools, it enables team collaboration through RBAC while abstracting complexity without removing control.

To learn how to get started with AKS desktop, create projects, deploy applications, and explore the full set of features, check out the [official AKS desktop documentation](https://aka.ms/aks/aks-desktop).

[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/11652/badge)](https://www.bestpractices.dev/projects/11652)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Azure/aks-desktop/badge)](https://scorecard.dev/viewer/?uri=github.com/Azure/aks-desktop)

## Installation

Please download the latest release for your platform from the [Releases](https://github.com/Azure/aks-desktop/releases/latest) page.

## How to run locally

To run AKS desktop locally, follow these steps:

1. Clone the repository:

   ```bash
   git clone https://github.com/Azure/aks-desktop.git
   ```

2. Navigate to the project directory:

   ```bash
   cd aks-desktop
   ```

3. Install the dependencies:

   ```bash
   ./scripts/headlamp-submodule.sh --reset
   npm install
   npm run install:all
   ```

4. Check for Resource folder:

   Ensure that the `resources` folder exists in the `Headlamp/app` directory.
   If `Headlamp/app/resources` does not exist, run the following command from the root directory.

   ```bash
   npm run plugin:setup
   ```

5. Start the Headlamp backend server:

   Navigate to the `Headlamp` directory and make the backend server

   ```bash
   cd Headlamp
   make backend
   ```

6. Start the application at the root directory:

   Navigate back to the root directory and start the application in development mode:

   ```bash
   npm run dev
   ```

## How to Build

To get started with AKS desktop, follow these steps:

1. Clone the repository:

   ```bash
   git clone https://github.com/Azure/aks-desktop.git
   ```

2. Navigate to the project directory:

   ```bash
   cd aks-desktop
   ```

3. Install the dependencies:

   ```bash
   ./scripts/headlamp-submodule.sh --reset
   npm install
   npm run install:all
   ```

4. Build the project:
   ```bash
   npm run build
   ```

## Contributing

Check out the [CONTRIBUTING.md](CONTRIBUTING.md) file. More
details on how to contribute will come soon.

## Support

See [SUPPORT.md](SUPPORT.md) for information on how to get help with this project.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft trademarks or logos is subject to and must [follow Microsoft’s Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks). Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship. Any use of third-party trademarks or logos are subject to those third-party’s policies.
