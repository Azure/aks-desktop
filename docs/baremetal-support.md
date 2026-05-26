# AKS BareMetal Cluster Support

AKS Desktop supports Azure BareMetal Kubernetes clusters (AKS Arc/BareMetal, AKS local, AKS edge) in addition to standard AKS managed clusters. These clusters appear alongside regular AKS clusters in the registration dialog and can be managed directly from the UI.

## Prerequisites

AKS Desktop bundles the Azure CLI, so no separate CLI installation is needed. When connecting a BareMetal cluster for the first time, AKS Desktop will prompt you to install the required CLI extensions (**connectedk8s** and **aksarc**) if they are not already present. Simply approve the installation when prompted — AKS Desktop handles the rest.

## Registering a BareMetal Cluster

1. Open the **Register AKS/BareMetal Cluster** dialog from the sidebar or cluster list.
2. Select your Azure subscription — AKS Desktop loads both managed AKS and BareMetal clusters.
3. Each cluster entry shows its type (**AKS** or **AKSARC**) so you can identify BareMetal clusters at a glance.
4. Select the BareMetal cluster and click **Register**. AKS Desktop runs the appropriate credential command automatically and merges the kubeconfig.

## Managing the BareMetal Proxy

BareMetal clusters are typically not directly reachable from the local machine. AKS Desktop provides built-in proxy controls that appear automatically when a BareMetal cluster is selected.

### Proxy Controls

| Button | What it does |
| --- | --- |
| **Start** | Launches the connectivity proxy in the background so AKS Desktop can reach the cluster API. |
| **Stop** | Stops the proxy process that was started by AKS Desktop. |
| **Restart** | Stops and re-starts the proxy — useful after credential refreshes or transient failures. |
| **Refresh** | Checks whether the cluster API is currently reachable and updates the displayed status. |

### Status Indicators

- **Running** — The proxy is active and the cluster API is reachable.
- **Starting** — The proxy process has been launched and is initialising.
- **Stopped** — No proxy is running; start one before interacting with the cluster.
- **Error** — The proxy encountered a problem; the error detail is shown below the status.

### Automatic Polling

While the registration dialog is open and a BareMetal cluster is selected, AKS Desktop polls the proxy status every five seconds so the display stays current.

### After a Reload

If AKS Desktop is reloaded or restarted, the in-memory proxy process handle is lost. AKS Desktop automatically probes the cluster to determine whether an external proxy is still running and updates the status accordingly.

## Getting Started with a Test Environment

For a test environment, the aksArc jumpstart project can create a baremetal-style AKS BareMetal environment on an Azure VM:

<https://github.com/Azure/aksArc/tree/main/aksarc_jumpstart>

A shared lab environment can also be used, provided the user has permission to read the connected cluster resource and obtain kubeconfig credentials.

## Troubleshooting

### Cluster appears but does not connect

Start or restart the proxy from the registration dialog. If the proxy is already running outside AKS Desktop, click **Refresh** to verify that the cluster API is reachable.

### Registration fails

Ensure you are signed in to Azure and have the required CLI extensions installed. The error message in the dialog will show details from the underlying credential command.

### Proxy fails to start

Check the error message shown in the proxy panel. Common causes include expired Azure credentials, missing CLI extensions, local port conflicts, or network restrictions.

### Status shows stopped after restart

This can happen if AKS Desktop cannot reach the cluster API during its automatic probe. Click **Start** to launch a new proxy session, or **Refresh** after confirming that an external proxy is running.
