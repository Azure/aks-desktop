# AKS Cluster Requirements for AKS Desktop

This guide describes the cluster configuration needed for the best experience with AKS Desktop. **AKS Automatic** clusters meet all requirements out of the box and require no additional setup. If you are using an **AKS Standard** cluster, review the sections below to ensure your cluster is configured correctly.

## Minimum requirements

These are hard requirements. AKS Desktop will not function without them.

| Requirement | Why it is needed | How to check | How to enable |
| --- | --- | --- | --- |
| **Azure Entra ID (AAD) authentication** | Required for Azure RBAC and managed namespace role assignments. Clusters without Entra ID do not appear in the AKS Desktop cluster picker. | `az aks show -g <rg> -n <cluster> --query aadProfile` -- must not be `null` | Must be set at cluster creation: `--enable-aad --enable-azure-rbac` |
| **Azure RBAC for Kubernetes authorization** | Required for assigning users to projects with Admin, Writer, or Reader roles. | `az aks show -g <rg> -n <cluster> --query aadProfile.enableAzureRbac` -- must be `true` | Must be set at cluster creation: `--enable-azure-rbac` |
| **aks-preview CLI extension** | Required for `az aks namespace` commands used to create managed namespaces (AKS Projects). | `az extension show --name aks-preview` | AKS Desktop installs this automatically if it is missing. To install manually: `az extension add --name aks-preview` |

## Recommended configuration

These addons and settings are optional but strongly recommended. Without them, specific AKS Desktop features will be unavailable or degraded.

| Feature | What it enables in AKS Desktop | Can be enabled after cluster creation? | How to enable |
| --- | --- | --- | --- |
| **Network policy engine** (Cilium recommended) | Ingress and egress network policies on managed namespaces. Without a network policy engine, policies are silently ignored. | **No** -- must be set at cluster creation. | `--network-plugin azure --network-policy cilium` |
| **Azure Monitor Metrics** (Managed Prometheus) | Metrics tab (CPU, memory, and request-rate charts) and the Scaling chart (CPU %). | Yes | `az aks update -g <rg> -n <cluster> --enable-azure-monitor-metrics` |
| **Managed Grafana** | Visualization for metrics dashboards. | Yes | Enabled alongside Azure Monitor Metrics when using the Azure Portal. Via CLI, link a Grafana workspace with `--enable-azure-monitor-metrics --azure-monitor-workspace-resource-id <id>`. |
| **KEDA** | Kubernetes Event-Driven Autoscaling in the Scaling tab. | Yes | `az aks update -g <rg> -n <cluster> --enable-keda` |
| **VPA** (Vertical Pod Autoscaler) | Vertical pod autoscaling recommendations in the Scaling tab. | Yes | `az aks update -g <rg> -n <cluster> --enable-vpa` |

## Feature availability matrix

The table below is a quick reference showing which AKS Desktop features work when specific cluster addons are missing.

| AKS Desktop Feature | Works without addon? | Required addon | Can be enabled after cluster creation? |
| --- | --- | --- | --- |
| Project creation | Yes | Azure RBAC + Entra ID | No (creation-time only) |
| Network policies | No (silently ignored) | Cilium, Calico, or Azure network policy | No (creation-time only) |
| Metrics tab | No (shows error) | Managed Prometheus | Yes |
| Scaling chart (CPU %) | No (shows error) | Managed Prometheus | Yes |
| HPA (horizontal scaling) | Yes | metrics-server (included by default) | Yes |
| KEDA scaling | No | KEDA addon | Yes |
| VPA scaling | No | VPA addon | Yes |

## Creating a fully compatible AKS Standard cluster

The following command creates a Standard-tier AKS cluster with all recommended features enabled:

```bash
az aks create \
  --resource-group <resource-group> \
  --name <cluster-name> \
  --location <location> \
  --tier standard \
  --enable-aad \
  --enable-azure-rbac \
  --network-plugin azure \
  --network-policy cilium \
  --enable-azure-monitor-metrics \
  --enable-keda \
  --enable-vpa \
  --generate-ssh-keys
```

Replace `<resource-group>`, `<cluster-name>`, and `<location>` with your own values. A cluster created with these flags will support every AKS Desktop feature without additional configuration.

## Enabling features on an existing cluster

Some features can be added to an existing cluster after creation. However, the **network policy engine cannot be changed after cluster creation**. If your cluster was created without a network policy engine, you must create a new cluster with the `--network-policy cilium` flag for full network policy support.

### Enable Azure Monitor Metrics (Managed Prometheus)

```bash
az aks update -g <rg> -n <cluster> --enable-azure-monitor-metrics
```

This enables the Metrics tab and the Scaling chart (CPU %) in AKS Desktop.

### Enable KEDA

```bash
az aks update -g <rg> -n <cluster> --enable-keda
```

This enables Kubernetes Event-Driven Autoscaling in the Scaling tab.

### Enable VPA

```bash
az aks update -g <rg> -n <cluster> --enable-vpa
```

This enables Vertical Pod Autoscaler recommendations in the Scaling tab.

> **Note:** These commands may take several minutes to complete. Each addon may incur additional Azure costs. See [AKS pricing](https://azure.microsoft.com/pricing/details/kubernetes-service/) for details.

## AKS Automatic vs AKS Standard

[AKS Automatic](https://learn.microsoft.com/azure/aks/intro-aks-automatic) clusters come with all of the above features preconfigured and require no additional setup. If you do not need fine-grained control over your cluster configuration, AKS Automatic is the easiest path to a fully compatible cluster.

See the [official feature comparison](https://learn.microsoft.com/azure/aks/intro-aks-automatic#aks-automatic-and-standard-feature-comparison) for a complete breakdown of differences between AKS Automatic and AKS Standard.
