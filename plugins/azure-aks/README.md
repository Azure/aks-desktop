# Azure AKS plugin

Headlamp plugin for Azure authentication and AKS integration

Features include:

- Azure login and account profile
- AKS cluster registration as a stateless cluster and token refresh
- AKS Desktop projects
- Managed namespace project creation, import, configuration, access, and deletion
- Application deployment from container images or Kubernetes YAML

## Architecture

Plugin consists of two parts, regular frontend headlamp plugin (in `src/`) and a Node.js script (in `src-bin/`) that runs on the Headlamp electron side called azure-api.js.
We need a node.js process to initiate Azure authentication using the "@azure/identity" package, that will open an interactive browser login page.
That cli script does 4 things: login, logout, get user information, get an authentication token for a given scope.

The "usual" frontend part will invoke that script using `runCommand('scriptjs', ['azure-api.js' ...])` to login and obtain the token. The rest of the plugin then uses `@azure/*` packages to communicate with Azure APIs using the obtained token directly.
