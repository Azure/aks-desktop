# Developer Cluster

Preview; not published.

Developer Cluster lets you create one local AKS cluster on a Windows PC, open it in AKS Desktop and delete
it. The cluster runs in its own WSL 2 instance, created from Ubuntu 24.04. No Azure sign-in is
needed.

## Requirements

* AKS Desktop for Windows x64. Other Headlamp builds cannot run the CLI, so setup cannot finish.
* WSL 2. Setup downloads Ubuntu 24.04 and installs it as the cluster's own WSL instance only after
  you agree.
* The AKS Devctl CLI (`aks-devctl`), which creates the cluster, is installed with the plugin. The
  plugin never downloads it at runtime.

## What you can do

1. Check that the PC is ready. The checks change nothing.
2. Name the cluster, choose a Kubernetes release and, optionally, enable an NVIDIA GPU.
3. Review the settings and create the cluster.
4. Open the cluster in AKS Desktop, or delete it.

## Limits

* One Developer Cluster per PC.
* No Arc connection, Kubernetes upgrades, editing, stopping or starting.
* Delete removes the cluster, its WSL instance and its kubeconfig entries. Other WSL distributions
  are kept.
* Preview, not for production workloads: the local API server certificate is not verified.

Do not post kubeconfig files, credentials or command output in an issue. Report problems through
`UNRESOLVED: issue tracker of the publishing repository`.
